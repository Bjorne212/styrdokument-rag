/**
 * Chat-API:t.
 *
 * En förfrågan går genom fyra steg: kontrollera lösenordet, hämta relevanta
 * dokumentstycken ur Vectorize, bygga en prompt av dem, och strömma tillbaka
 * modellens svar.
 *
 * Ingenting sparas. Ingen fråga, inget svar, ingen IP-adress, ingen
 * sessionsdata. Workern har medvetet varken KV, D1 eller R2 bundet till sig,
 * så det finns ingenstans att spara ens av misstag.
 *
 * Statiska filer (chattsidan) serveras av samma Worker via [assets] i
 * wrangler.toml. Att UI och API delar origin gör att vi slipper CORS helt
 * och att andra webbplatser inte kan anropa API:t från sina egna sidor.
 */

import { checkPassword } from "./auth.ts";
import { limitsFromEnv, retrievalQuery, sanitizeHistory, type Exchange } from "./history.ts";
import { looksRepetitive } from "./loopguard.ts";
import { buildMessages } from "./prompt.ts";
import { retrieve, type RetrievedChunk } from "./retrieve.ts";

/**
 * Modellen som skriver svaren, och reserven.
 *
 * 70B ger bättre svenska men kostar ~103 neurons per fråga av dagskvoten på
 * 10 000. Tar kvoten slut faller vi tillbaka på 8B (~62 neurons) i stället för
 * att gå ner. Tjänsten blir enklare i svaren sista timmarna på dygnet, men
 * fortsätter fungera.
 */
const PRIMARY_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const FALLBACK_MODEL = "@cf/meta/llama-3.1-8b-instruct";

const MAX_QUESTION_LENGTH = 1000;

/**
 * Hur länge vi väntar på att modellen ska börja svara.
 *
 * Ett anrop som aldrig återkommer skulle annars hålla strömmen öppen tills
 * klienten ger upp, och användaren ser bara en tom ruta. Hellre ett tydligt
 * fel som kan visas.
 */
const MODEL_TIMEOUT_MS = 45000;

/** Kastar om löftet inte hunnit bli klart i tid. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} svarade inte inom ${ms / 1000} s`)), ms),
    ),
  ]);
}

/**
 * Översätter ett tekniskt fel till något användaren kan agera på.
 *
 * Den vanligaste orsaken i drift är att dagens gratiskvot tagit slut, och det
 * är värt att säga rakt ut, annars ser det ut som att tjänsten är trasig.
 */
function explainFailure(error: unknown): string {
  const message = String((error as Error)?.message ?? error).toLowerCase();

  if (message.includes("429") || message.includes("quota") || message.includes("limit")) {
    return "Dagens gratiskvot för AI-svar är slut. Den återställs vid midnatt UTC.";
  }
  if (message.includes("capacity") || message.includes("overload")) {
    return "Modellen är överbelastad just nu. Försök igen om en stund.";
  }
  if (message.includes("svarade inte inom")) {
    return "Modellen svarade inte i tid. Försök igen, gärna med en kortare fråga.";
  }
  return "Kunde inte generera ett svar just nu. Försök igen om en stund.";
}

/** Ett meddelande i vår egen SSE-ström till webbläsaren. */
function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Källhänvisningarna som visas under svaret. Ett kort per dokument, inte per chunk. */
function uniqueSources(chunks: RetrievedChunk[]) {
  const seen = new Map<string, { title: string; url: string; sectionLabel: string; headings: string[] }>();

  for (const chunk of chunks) {
    const existing = seen.get(chunk.url);
    if (existing) {
      if (chunk.heading && !existing.headings.includes(chunk.heading)) {
        existing.headings.push(chunk.heading);
      }
      continue;
    }

    seen.set(chunk.url, {
      title: chunk.title,
      url: chunk.url,
      sectionLabel: chunk.sectionLabel,
      headings: chunk.heading ? [chunk.heading] : [],
    });
  }

  return [...seen.values()];
}

/**
 * Kör modellen och skickar vidare texten bit för bit.
 *
 * Workers AI svarar med SSE där varje rad ser ut som `data: {"response":"ord"}`.
 * Vi tolkar den strömmen och skickar om innehållet i vårt eget format, så att
 * webbläsaren kan visa svaret medan det skrivs i stället för att vänta på hela.
 */
async function streamAnswer(
  env: Env,
  model: string,
  messages: ReturnType<typeof buildMessages>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
): Promise<void> {
  // Typerna för AI.run täcker inte strömmande svar per modellnamn, därför
  // castet: med stream: true är returvärdet alltid en ReadableStream.
  const response = (await withTimeout(
    env.AI.run(model as keyof AiModels, {
      messages,
      stream: true,
      max_tokens: 800,
      // Låg temperatur håller svaren nära källtexten, men för låg gör att
      // modellen fastnar i upprepningar. 0,3 med repetitionsstraff är
      // avvägningen mellan trogna och läsbara svar.
      temperature: 0.3,
      repetition_penalty: 1.15,
    }) as Promise<unknown>,
    MODEL_TIMEOUT_MS,
    model,
  )) as ReadableStream;

  const reader = response.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let answer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += value;
    const lines = buffer.split("\n");
    // Sista raden kan vara halv: spara den till nästa varv.
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;

      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;

      try {
        const parsed = JSON.parse(payload) as { response?: string };
        if (parsed.response) {
          answer += parsed.response;
          await writer.write(encoder.encode(sse("token", parsed.response)));

          if (looksRepetitive(answer)) {
            await reader.cancel();
            await writer.write(
              encoder.encode(sse("notice", "Svaret avbröts: modellen började upprepa sig.")),
            );
            return;
          }
        }
      } catch {
        // Ofullständig JSON i strömmen, hoppa över raden.
      }
    }
  }
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  const auth = await checkPassword(request, env.SHARED_PASSWORD);
  if (!auth.ok) {
    return jsonError(401, auth.reason);
  }

  let question: string;
  let history: Exchange[] = [];
  try {
    const body = (await request.json()) as { question?: unknown; history?: unknown };
    question = typeof body.question === "string" ? body.question.trim() : "";
    // Klienten skickar sitt sammanhang, men servern bestämmer hur mycket av det
    // som används: annars kunde vem som helst skicka godtycklig mängd kontext
    // och tömma dagskvoten.
    history = sanitizeHistory(body.history, limitsFromEnv(env));
  } catch {
    return jsonError(400, "Kunde inte tolka förfrågan som JSON.");
  }

  if (question.length === 0) {
    return jsonError(400, "Ingen fråga angiven.");
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return jsonError(400, `Frågan är för lång (max ${MAX_QUESTION_LENGTH} tecken).`);
  }

  const chunks = await retrieve(env, question, {
    searchText: retrievalQuery(question, history),
    topK: Number(env.TOP_K ?? "8"),
  });
  const messages = buildMessages(question, chunks, history);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Källorna skickas först, så att UI:t kan visa dem direkt medan svaret skrivs.
  void (async () => {
    try {
      await writer.write(encoder.encode(sse("sources", uniqueSources(chunks))));

      try {
        await streamAnswer(env, PRIMARY_MODEL, messages, writer, encoder);
      } catch (primaryError) {
        // Vanligaste orsaken är att dagskvoten tagit slut. Reservmodellen är
        // billigare, så den kan fungera även när den stora inte gör det.
        console.log(`Primärmodellen misslyckades: ${(primaryError as Error).message}`);
        await writer.write(encoder.encode(sse("notice", "Svarar med reservmodellen.")));
        await streamAnswer(env, FALLBACK_MODEL, messages, writer, encoder);
      }

      await writer.write(encoder.encode(sse("done", {})));
    } catch (error) {
      await writer.write(encoder.encode(sse("error", explainFailure(error))));
      console.log(`Fel i svarsströmmen: ${(error as Error).message}`);
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return jsonError(405, "Endast POST stöds.");
      }
      return handleChat(request, env);
    }

    // Okända API-sökvägar är verkliga fel.
    if (url.pathname.startsWith("/api/")) {
      return jsonError(404, "Okänd sökväg.");
    }

    // Allt annat är klientsidig routing. Sökvägar som /chat motsvarar ingen
    // fil, så vi svarar med appens skal och låter routern i webbläsaren ta
    // över. Inställningen not_found_handling räcker inte när en Worker finns:
    // förfrågningar som inte matchar en fil skickas hit i stället för att
    // hanteras av assets-lagret.
    const shell = await env.ASSETS.fetch(new Request(new URL("/", request.url), request));

    // Skalet serveras för varje okänd sökväg, så det är den vanligaste sidan en
    // sökrobot skulle hitta. _headers täcker filerna, men svar som går genom
    // Workern behöver taggen satt här.
    const headers = new Headers(shell.headers);
    headers.set("x-robots-tag", "noindex, nofollow, noarchive, nosnippet");
    return new Response(shell.body, { status: shell.status, headers });
  },
} satisfies ExportedHandler<Env>;
