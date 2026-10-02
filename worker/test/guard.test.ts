/**
 * Guardrails-tillägget genom hela chattflödet.
 *
 * Workers AI, Vectorize och guarden är ersatta, så testerna kostar ingen
 * kvot och kräver inget konto. Kör: npm test i worker/.
 */
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { afterEach, test } from "node:test";

// crypto.subtle.timingSafeEqual finns bara i Workers. auth.ts använder den,
// så Node får motsvarande funktion här.
const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: unknown };
subtle.timingSafeEqual ??= (a: ArrayBuffer, b: ArrayBuffer) => timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
import worker from "../src/index.ts";
import { isSafeGuardUrl } from "../src/guard-client.ts";
import { buildMessages } from "../src/prompt.ts";

type Captured = { model?: string; messages?: { role: string; content: string }[]; maxTokens?: number; guardBody?: any };

const CHUNK = {
  id: "1",
  score: 0.7,
  metadata: { text: "Kårstyrelsen består av två (2) till fyra (4) ledamöter.", title: "Stadga", url: "https://x/stadga.pdf", heading: "5.2", sectionLabel: "Allmänt", page: 3 },
};

function sseStream(text: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: text })}\n\ndata: [DONE]\n\n`));
      controller.close();
    },
  });
}

function makeEnv(options: { hits?: boolean; key?: string; url?: string } = {}) {
  const captured: Captured = {};
  const env = {
    SHARED_PASSWORD: "pw",
    GUARD_KEY: options.key,
    GUARD_URL: options.url ?? "https://guard.test/guard",
    AI: {
      run: async (model: string, input: any) => {
        if (model.includes("bge-m3")) return { data: [[0.1, 0.2]] };
        captured.model = model;
        captured.messages = input.messages;
        captured.maxTokens = input.max_tokens;
        return sseStream("Svar.");
      },
    },
    VECTORIZE: { query: async () => ({ matches: options.hits === false ? [] : [CHUNK] }) },
  } as unknown as Env;
  return { env, captured };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockGuard(captured: Captured, reply: (() => Response) | "hang" | "throw") {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    captured.guardBody = JSON.parse(String(init.body));
    if (reply === "throw") throw new TypeError("nätverksfel");
    if (reply === "hang") {
      return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Timeout", "TimeoutError"))));
    }
    return reply();
  }) as typeof fetch;
}

const decisions = (withHits: object, withoutHits: object = withHits) => () =>
  new Response(JSON.stringify({ v: 1, withHits, withoutHits }), { headers: { "content-type": "application/json" } });

async function ask(env: Env, body: object = { question: "Hur många ledamöter har kårstyrelsen?" }) {
  const response = await worker.fetch(
    new Request("https://chat.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-chat-password": "pw" },
      body: JSON.stringify(body),
    }),
    env,
  );
  const text = await response.text();
  const tokens = [...text.matchAll(/event: token\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]!)).join("");
  return { status: response.status, tokens, text };
}

test("utan GUARD_KEY anropas ingen guard och svaret blir som vanligt", async () => {
  const { env, captured } = makeEnv();
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  const res = await ask(env);
  assert.equal(called, false);
  assert.equal(res.tokens, "Svar.");
  assert.equal(captured.maxTokens, 800);
});

test("ALLOW ger vanligt svar, och guarden får frågor men aldrig svar", async () => {
  const { env, captured } = makeEnv({ key: "k" });
  mockGuard(captured, decisions({ route: "ALLOW" }));
  const res = await ask(env, {
    question: "Vad ansvarar den för?",
    history: [{ question: "Vad är vKO?", answer: "HEMLIGT-SVAR" }],
  });
  assert.equal(res.tokens, "Svar.");
  assert.deepEqual(captured.guardBody.previousQuestions, ["Vad är vKO?"]);
  assert.ok(!JSON.stringify(captured.guardBody).includes("HEMLIGT-SVAR"));
  assert.equal(captured.guardBody.scope.name, "LinTek");
  // Tidigare samtal följer med till modellen vid ALLOW.
  assert.match(captured.messages![1]!.content, /tidigare_samtal/);
});

test("REJECT ger kårens färdiga text utan modellanrop", async () => {
  for (const kind of ["refusal", "greeting", "meta"] as const) {
    const { env, captured } = makeEnv({ key: "k" });
    mockGuard(captured, decisions({ route: "REJECT", kind }));
    const res = await ask(env);
    assert.equal(captured.model, undefined, kind);
    assert.ok(res.tokens.length > 20, kind);
    assert.match(res.text, /event: sources\ndata: \[\]/);
  }
});

test("FILTERED: skärpt prompt, inget tidigare samtal, kortare svar", async () => {
  const { env, captured } = makeEnv({ key: "k" });
  mockGuard(captured, decisions({ route: "FILTERED", kind: "legal" }));
  await ask(env, { question: "Får jag?", history: [{ question: "Vad är vKO?", answer: "x" }] });
  assert.equal(captured.maxTokens, 400);
  assert.match(captured.messages![0]!.content, /Extra försiktighet/);
  assert.match(captured.messages![0]!.content, /avgör inte fallet/);
  assert.doesNotMatch(captured.messages![1]!.content, /tidigare_samtal/);
});

test("klienten väljer beslut efter om sökningen gav träffar", async () => {
  const withHits = makeEnv({ key: "k", hits: true });
  mockGuard(withHits.captured, decisions({ route: "ALLOW" }, { route: "REJECT", kind: "refusal" }));
  assert.equal((await ask(withHits.env)).tokens, "Svar.");

  const without = makeEnv({ key: "k", hits: false });
  mockGuard(without.captured, decisions({ route: "ALLOW" }, { route: "REJECT", kind: "refusal" }));
  const res = await ask(without.env);
  assert.match(res.tokens, /bara svara på frågor om LinTeks styrdokument/);
});

test("guard som är nere, hänger, svarar fel eller avvisar nyckeln ger FILTERED", async () => {
  const failures: Parameters<typeof mockGuard>[1][] = [
    "throw",
    "hang",
    () => new Response("{}", { status: 401 }),
    () => new Response("inte json"),
    decisions({ route: "REJECT", kind: "okänd" }),
  ];
  for (const failure of failures) {
    const { env, captured } = makeEnv({ key: "k" });
    (env as any).GUARD_TIMEOUT_MS = "50";
    mockGuard(captured, failure);
    const res = await ask(env);
    assert.equal(res.tokens, "Svar.");
    assert.equal(captured.maxTokens, 400, String(failure));
  }
});

test("nyckeln skickas aldrig över okrypterad http", async () => {
  const { env, captured } = makeEnv({ key: "k", url: "http://guard.test/guard" });
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  await ask(env);
  assert.equal(called, false);
  assert.equal(captured.maxTokens, 400);
  assert.equal(isSafeGuardUrl("https://guard.test/guard"), true);
  assert.equal(isSafeGuardUrl("http://localhost:8797/guard"), true);
  assert.equal(isSafeGuardUrl("http://example.com/guard"), false);
  assert.equal(isSafeGuardUrl(""), false);
});

test("FILTERED-prompten för personärenden", () => {
  const [system] = buildMessages("Fick Kalle rätt?", [], [], "personal");
  assert.match(system!.content, /bedöm inte personen/);
});
