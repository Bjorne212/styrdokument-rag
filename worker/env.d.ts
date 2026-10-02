/**
 * Bindningarna Workern får av Cloudflare, deklarerade enligt wrangler.toml.
 *
 * SHARED_PASSWORD är avsiktligt optional: den sätts som secret och finns
 * alltså inte i koden. Saknas den vägrar auth.ts släppa igenom någon.
 */
interface Env {
  AI: Ai;
  /** Statiska filer i pages/, för att kunna servera skalet vid klientsidig routing. */
  ASSETS: Fetcher;
  VECTORIZE: VectorizeIndex;
  SHARED_PASSWORD?: string;
  /**
   * Tak för hela tjänsten, se [[ratelimits]] i wrangler.template.toml.
   * Optional så att en Worker utan bindningen fungerar som förut.
   */
  CHAT_LIMIT?: RateLimit;
  /** Guardrails-tillägget, se guard-client.ts. Avstängt utan GUARD_KEY. */
  GUARD_URL?: string;
  /** Secret: kårens nyckel till guarden. */
  GUARD_KEY?: string;
  GUARD_TIMEOUT_MS?: string;
  /** Justerbara värden från [vars] i wrangler.toml. */
  HISTORY_TURNS?: string;
  HISTORY_ANSWER_CHARS?: string;
  TOP_K?: string;
}
