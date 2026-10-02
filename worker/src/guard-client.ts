/**
 * Guardrails-tillägget: frågar en extern guard-tjänst hur frågan ska hanteras.
 *
 * Tillägget är avstängt så länge GUARD_KEY saknas, och då beter sig Workern
 * precis som utan det. Med en nyckel skickas varje fråga till GUARD_URL, som
 * svarar med ett beslut:
 *
 *   ALLOW     svara som vanligt
 *   FILTERED  svara med skärpt prompt, utan tidigare samtal och kortare
 *   REJECT    skicka en färdig text ur kar.config.json, utan modellanrop
 *
 * Hur beslutet fattas finns inte här, bara hur det följs. Svarar guarden
 * inte, eller med något oväntat, blir beslutet FILTERED: tjänsten fortsätter
 * svara, men försiktigare, och ingen fråga avvisas för att guarden är nere.
 *
 * Till guarden skickas frågan, tidigare frågor och kårens namn, beskrivning
 * och sektioner. Aldrig tidigare svar, lösenordet eller något om användaren.
 */

import { kar, type GuardrailsTexts } from "../../shared/config.ts";
import type { Exchange } from "./history.ts";

// Typerna nedan är en kopia av guardens kontrakt (version 1). Ändras de där
// höjs versionen, och den gamla fortsätter fungera tills mallen uppdaterats.

export type Decision =
  | { route: "ALLOW" }
  | { route: "FILTERED"; kind: "caution" | "legal" | "personal" }
  | { route: "REJECT"; kind: "refusal" | "greeting" | "meta" };

export type GuardResponse = { v: 1; withHits: Decision; withoutHits: Decision };

type GuardRequest = {
  v: 1;
  question: string;
  previousQuestions: string[];
  scope: { name: string; description: string; sections: string[] };
};

export const FAIL_SAFE: Decision = { route: "FILTERED", kind: "caution" };
const FAIL_SAFE_RESPONSE: GuardResponse = { v: 1, withHits: FAIL_SAFE, withoutHits: FAIL_SAFE };

/**
 * Hur länge vi väntar på guarden.
 *
 * Anropet görs medan dokumenten söks, så den första halvsekunden kostar
 * ingenting. Guarden har en egen, kortare gräns mot sin modell och svarar
 * FILTERED när den passeras, så det här är gränsen för nätverket ovanpå.
 */
const DEFAULT_TIMEOUT_MS = 1500;

const DEFAULT_TEXTS: GuardrailsTexts = {
  refusal: `Jag kan bara svara på frågor om ${kar.nameGenitive} styrdokument. Vad vill du veta om dem?`,
  greeting: `Hej! Fråga mig om ${kar.nameGenitive} styrdokument, till exempel vem som beslutar om något eller vad en policy säger.`,
  meta: `Jag söker i ${kar.nameGenitive} publicerade styrdokument och svarar med hänvisning till var det står.`,
};

/** Den färdiga texten för ett REJECT-beslut. */
export function rejectText(kind: "refusal" | "greeting" | "meta"): string {
  return kar.guardrails?.[kind] || DEFAULT_TEXTS[kind];
}

/**
 * Är adressen en vi kan skicka nyckeln till?
 *
 * Nyckeln är kårens betalda åtkomst. Över okrypterad http kan den läsas av
 * vem som helst på vägen, så bara https godtas, utom mot den egna datorn
 * under utveckling.
 */
export function isSafeGuardUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

const isDecision = (value: unknown): value is Decision => {
  if (typeof value !== "object" || value === null) return false;
  const { route, kind } = value as { route?: unknown; kind?: unknown };
  if (route === "ALLOW") return true;
  if (route === "FILTERED") return kind === "caution" || kind === "legal" || kind === "personal";
  if (route === "REJECT") return kind === "refusal" || kind === "greeting" || kind === "meta";
  return false;
};

/**
 * Frågar guarden. null betyder att tillägget är avstängt.
 *
 * Löftet avvisas aldrig: varje fel blir FILTERED, så att anroparen kan starta
 * det parallellt med sökningen och invänta det utan felhantering.
 */
export async function askGuard(env: Env, question: string, history: Exchange[]): Promise<GuardResponse | null> {
  if (!env.GUARD_KEY) return null;

  const url = env.GUARD_URL ?? "";
  if (!isSafeGuardUrl(url)) {
    console.log("Guardrails: GUARD_KEY finns men GUARD_URL saknas eller är inte https. Frågan behandlas som FILTERED.");
    return FAIL_SAFE_RESPONSE;
  }

  const body: GuardRequest = {
    v: 1,
    question,
    previousQuestions: history.map((exchange) => exchange.question),
    scope: {
      name: kar.name,
      description: kar.description,
      sections: kar.source.sections.map((section) => section.label),
    },
  };

  const timeout = Number(env.GUARD_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.GUARD_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      // 401/403 betyder fel eller utgången nyckel. Det loggas, eftersom det
      // är något kåren behöver åtgärda, men utan frågetext.
      console.log(`Guardrails: guarden svarade ${response.status}. Frågan behandlas som FILTERED.`);
      return FAIL_SAFE_RESPONSE;
    }

    const data = (await response.json()) as Partial<GuardResponse>;
    if (data.v !== 1 || !isDecision(data.withHits) || !isDecision(data.withoutHits)) {
      console.log("Guardrails: oväntat svar från guarden. Frågan behandlas som FILTERED.");
      return FAIL_SAFE_RESPONSE;
    }
    return { v: 1, withHits: data.withHits, withoutHits: data.withoutHits };
  } catch (error) {
    console.log(`Guardrails: ${(error as Error)?.name ?? "fel"} mot guarden. Frågan behandlas som FILTERED.`);
    return FAIL_SAFE_RESPONSE;
  }
}
