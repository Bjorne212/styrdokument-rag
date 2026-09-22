/**
 * Följdfrågor.
 *
 * Systemet är statslöst: servern minns ingenting mellan anrop, och sparar
 * ingenting. Ska en följdfråga som "vad ansvarar den för?" kunna besvaras
 * måste sammanhanget alltså komma med i anropet, från webbläsaren, där det
 * lever i fliken och försvinner vid omladdning.
 *
 * Att skicka historik kostar input-tokens av dagskvoten, och klienten kan inte
 * få bestämma hur mycket. Därför beskärs den här, på servern, enligt värden
 * som går att ändra i wrangler.toml utan kodändring.
 *
 * Varför sammanhanget behövs, mätt: frågan "Vad ansvarar den för?" ensam ger
 * toppträffen "Stadga 7.4 Beslutsförhet" (0,486), helt fel dokument. Samma
 * fråga tillsammans med den föregående ("Vad är vKO?") träffar rätt.
 */

export type Exchange = { question: string; answer: string };

export type HistoryLimits = {
  turns: number;
  answerChars: number;
};

const MAX_QUESTION_CHARS = 500;

export function limitsFromEnv(env: Env): HistoryLimits {
  const turns = Number(env.HISTORY_TURNS ?? "2");
  const answerChars = Number(env.HISTORY_ANSWER_CHARS ?? "500");

  return {
    turns: Number.isFinite(turns) ? Math.max(0, Math.min(turns, 5)) : 2,
    answerChars: Number.isFinite(answerChars) ? Math.max(0, Math.min(answerChars, 2000)) : 500,
  };
}

/**
 * Plockar ut giltig historik ur en inkommande förfrågan och beskär den.
 *
 * Allt som inte är två strängar kastas: klienten är inte betrodd, och ett
 * felformat fält ska ge en fråga utan sammanhang, inte ett serverfel.
 */
export function sanitizeHistory(raw: unknown, limits: HistoryLimits): Exchange[] {
  if (!Array.isArray(raw) || limits.turns === 0) return [];

  const valid = raw.filter(
    (item): item is Exchange =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Exchange).question === "string" &&
      typeof (item as Exchange).answer === "string",
  );

  // De senaste utbytena är de relevanta för en följdfråga.
  return valid.slice(-limits.turns).map((exchange) => ({
    question: exchange.question.slice(0, MAX_QUESTION_CHARS),
    answer: exchange.answer.slice(0, limits.answerChars),
  }));
}

/**
 * Texten som embeddas för sökningen.
 *
 * Tidigare *frågor* tas med, men inte svaren: frågorna bär ämnet ("vKO") som
 * följdfrågan saknar, medan svaren är långa och skulle dränka den nya frågan
 * i ord som redan besvarats.
 */
export function retrievalQuery(question: string, history: Exchange[]): string {
  if (history.length === 0) return question;
  return [...history.map((exchange) => exchange.question), question].join("\n");
}
