/**
 * Lokal kopia av chat-API:t, för utveckling utan att röra dagskvoten.
 *
 * Servern talar samma protokoll som Workern och serverar samma chattsida, men
 * använder det lokala indexet i stället för Vectorize och Ollama i stället för
 * Workers AI. Systemprompten importeras från worker/src/prompt.ts, så det som
 * testas här är samma instruktioner som körs i produktion.
 *
 * Det som INTE testas här: Cloudflares modellbeteende (Ollama kör samma vikter
 * men annan kvantisering), streamingens exakta timing, och Vectorizes
 * approximativa sökning, lokalt jämförs alla vektorer exakt.
 *
 * Kör:  node src/devserver.ts
 *       node src/devserver.ts --model gemma4
 */

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize as normalizePath } from "node:path";
import { buildMessages } from "../../worker/src/prompt.ts";
import { retrievalQuery, sanitizeHistory } from "../../worker/src/history.ts";
import { looksRepetitive } from "../../worker/src/loopguard.ts";
import { MIN_SCORE, TOP_K } from "../../worker/src/retrieve.ts";
import { loadLocalIndex, searchText } from "./localindex.ts";

const PORT = Number(process.env.PORT ?? 8788);
const PAGES_DIR = join(import.meta.dirname, "../../pages");
/** Motsvarar HISTORY_TURNS i wrangler.toml. */
const HISTORY_TURNS = Number(process.env.HISTORY_TURNS ?? "2");
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** Läser lösenordet ur worker/.dev.vars, så lokalt och skarpt beter sig lika. */
async function readDevPassword(): Promise<string> {
  try {
    const contents = await readFile(join(import.meta.dirname, "../../worker/.dev.vars"), "utf8");
    const match = contents.match(/^SHARED_PASSWORD=(.*)$/m);
    if (match) return match[1].trim();
  } catch {
    // Ingen fil: använd reservvärdet nedan.
  }
  return "lokalt";
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function main(): Promise<void> {
  const modelIndex = process.argv.indexOf("--model");
  const model = modelIndex !== -1 ? process.argv[modelIndex + 1] : "llama3.1:8b";

  const password = await readDevPassword();
  const index = await loadLocalIndex();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        response.writeHead(405).end('{"error":"Endast POST stöds."}');
        return;
      }

      if (request.headers["x-chat-password"] !== password) {
        response
          .writeHead(401, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify({ error: "Fel lösenord." }));
        return;
      }

      const body = await new Promise<string>((resolve) => {
        let data = "";
        request.on("data", (chunk) => (data += chunk));
        request.on("end", () => resolve(data));
      });

      let question = "";
      let history: { question: string; answer: string }[] = [];
      try {
        const parsed = JSON.parse(body);
        question = String(parsed.question ?? "").trim();
        // Samma beskärning som Workern gör, med samma standardvärden.
        history = sanitizeHistory(parsed.history, { turns: HISTORY_TURNS, answerChars: 500 });
      } catch {
        response.writeHead(400).end('{"error":"Ogiltig JSON."}');
        return;
      }

      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
      });

      try {
        const hits = (
          await searchText(index, retrievalQuery(question, history), TOP_K)
        ).filter((hit) => hit.score >= MIN_SCORE);

        const sources = [...new Map(hits.map((hit) => [hit.metadata.url, hit])).values()].map(
          (hit) => ({
            title: hit.metadata.title,
            url: hit.metadata.url,
            sectionLabel: hit.metadata.sectionLabel,
            headings: hit.metadata.heading ? [hit.metadata.heading] : [],
          }),
        );
        response.write(sse("sources", sources));
        response.write(
          sse(
            "notice",
            `Lokal körning: ${model}, ${hits.length} stycken` +
              (history.length ? `, ${history.length} tidigare utbyte(n) som sammanhang` : ""),
          ),
        );

        const messages = buildMessages(
          question,
          hits.map((hit) => ({
            text: hit.text,
            title: hit.metadata.title,
            url: hit.metadata.url,
            heading: hit.metadata.heading,
            sectionLabel: hit.metadata.sectionLabel,
            page: hit.metadata.page,
            score: hit.score,
          })),
          history,
        );

        const ollama = await fetch(`${OLLAMA_URL}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            // Utan num_ctx allokerar Ollama modellens hela kontextfönster
            // för llama3.1 är det 128k tokens, vilket kräver 30 GB och tvingar
            // ut modellen på CPU. Vår prompt är ~2500 tokens, så 8k räcker väl
            // och håller allt i grafikminnet.
            options: {
              num_ctx: 8192,
              // Samma resonemang som i Workern: 0,2 gav upprepningsslingor.
              temperature: 0.3,
              repeat_penalty: 1.15,
              // Utan gräns kan en slinga skriva tills kontexten tar slut.
              num_predict: 800,
            },
            // Håll modellen laddad. Utan det laddas den ur mellan frågor, och
            // ett anrop som kommer in mitt under urladdningen hänger sig.
            keep_alive: "30m",
          }),
          // Samma skäl som i Workern: ett svar som aldrig kommer ska bli ett
          // fel, inte en evig väntan.
          signal: AbortSignal.timeout(180000),
        });

        if (!ollama.ok || !ollama.body) {
          throw new Error(`Ollama svarade ${ollama.status}`);
        }

        // Ollama strömmar en JSON-rad per token.
        const reader = ollama.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        let answer = "";
        let stopped = false;

        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            const parsed = JSON.parse(line) as { message?: { content?: string } };
            if (parsed.message?.content) {
              answer += parsed.message.content;
              response.write(sse("token", parsed.message.content));

              if (looksRepetitive(answer)) {
                response.write(sse("notice", "Svaret avbröts: modellen började upprepa sig."));
                await reader.cancel();
                stopped = true;
                break;
              }
            }
          }
        }

        response.write(sse("done", {}));
      } catch (error) {
        response.write(sse("error", `Lokalt fel: ${(error as Error).message}`));
      }

      response.end();
      return;
    }

    // Statiska filer. normalizePath hindrar ../-trick i sökvägen.
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const safe = normalizePath(requested).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(PAGES_DIR, safe);

    const serve = (path: string, fallback: boolean) => {
      createReadStream(path)
        .on("open", () =>
          response.writeHead(200, {
            "content-type": MIME[extname(path)] ?? "application/octet-stream",
          }),
        )
        .on("error", () => {
          // Gränssnittet är en enkelsidig app: sökvägar som /chat motsvarar
          // ingen fil utan hanteras av routern i webbläsaren. Samma beteende
          // som Workerns not_found_handling = "single-page-application".
          if (fallback) {
            serve(join(PAGES_DIR, "index.html"), false);
          } else {
            response.writeHead(404).end("Not found");
          }
        })
        .pipe(response);
    };

    serve(filePath, !extname(safe));
  });

  server.listen(PORT, () => {
    console.log(`Lokal chatt:  http://localhost:${PORT}`);
    console.log(`Modell:       ${model}`);
    console.log(`Index:        ${index.entries.length} chunkar`);
    console.log(`Lösenord:     ${password}`);
    console.log(`\nIngen Cloudflare-kvot används.`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
