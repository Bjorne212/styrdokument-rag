/**
 * Embeddings från antingen Ollama (lokalt, gratis) eller Cloudflare (produktion).
 *
 * Båda kör samma modell, bge-m3. Det är verifierat att de ger identiska
 * vektorer: cosinuslikheten mellan Cloudflares och Ollamas embedding av samma
 * text är 1,0000, och likheten mellan två texter skiljer sig först i fjärde
 * decimalen. Därför går det att trimma chunkning och sökning lokalt utan att
 * bränna dagskvoten, och lita på att slutsatserna gäller i produktion.
 *
 * Ollama används som standard lokalt. GitHub Actions har ingen Ollama, så där
 * sätts EMBEDDING_PROVIDER=cloudflare.
 */

import { embed as embedViaCloudflare, type CloudflareConfig } from "../../ingestion/src/cloudflare.ts";

export const EMBEDDING_MODEL = "bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;

export type Provider = "ollama" | "cloudflare";

export function providerFromEnv(): Provider {
  const provider = process.env.EMBEDDING_PROVIDER;
  if (provider === "cloudflare" || provider === "ollama") return provider;
  // Utan uttryckligt val: Cloudflare om nycklar finns (alltså i CI), annars lokalt.
  return process.env.CLOUDFLARE_API_TOKEN ? "cloudflare" : "ollama";
}

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

async function embedViaOllama(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama svarade ${response.status}. Kör servern igång? Starta med \`ollama serve\` ` +
        `och hämta modellen med \`ollama pull ${EMBEDDING_MODEL}\`.`,
    );
  }

  const result = (await response.json()) as { embeddings?: number[][] };
  if (!result.embeddings || result.embeddings.length !== texts.length) {
    throw new Error(
      `Ollama gav ${result.embeddings?.length ?? 0} vektorer för ${texts.length} texter.`,
    );
  }

  return result.embeddings;
}

/**
 * Gör om texter till vektorer med vald leverantör.
 *
 * Cloudflare kräver konfiguration; Ollama kräver bara att servern kör lokalt.
 */
export async function embedTexts(
  texts: string[],
  options: { provider?: Provider; config?: CloudflareConfig } = {},
): Promise<number[][]> {
  const provider = options.provider ?? providerFromEnv();

  if (provider === "ollama") {
    return embedViaOllama(texts);
  }

  if (!options.config) {
    throw new Error("Cloudflare valdes som leverantör men ingen konfiguration skickades med.");
  }

  return embedViaCloudflare(options.config, texts);
}
