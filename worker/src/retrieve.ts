/**
 * Hämtning (the "R" i RAG): hitta de textstycken som kan svara på frågan.
 *
 * Frågan görs om till en vektor med samma modell som användes vid indexeringen
 *: det är ett krav, två olika modeller ger vektorer i olika "rum" och
 * jämförelsen blir meningslös. Sedan letar Vectorize upp de chunkar vars
 * vektorer ligger närmast, alltså de stycken som betyder ungefär samma sak
 * som frågan.
 */

export const EMBEDDING_MODEL = "@cf/baai/bge-m3";

/**
 * Hur många stycken vi hämtar.
 *
 * Fler ger modellen bättre chans att hitta rätt, men varje stycke kostar
 * input-tokens av dagskvoten. Åtta stycken à ~250 tokens är en rimlig
 * avvägning: tillräckligt för att täcka en fråga som berör flera dokument.
 */
export const TOP_K = 8;

/**
 * Under det här poängvärdet är träffen troligen irrelevant och tas bort.
 *
 * Exporterad för att den lokala utvecklingsservern ska kunna använda samma
 * tröskel: annars kan lokala tester visa andra träffar än produktionen utan
 * att någon märker det.
 */
export const MIN_SCORE = 0.4;

export type RetrievedChunk = {
  text: string;
  title: string;
  url: string;
  heading: string | null;
  sectionLabel: string;
  page: number;
  score: number;
};

export async function retrieve(
  env: Env,
  question: string,
  options: { searchText?: string; topK?: number } = {},
): Promise<RetrievedChunk[]> {
  // Vid en följdfråga söker vi på frågan plus tidigare frågor, se history.ts.
  const embedding = await env.AI.run(EMBEDDING_MODEL, { text: [options.searchText ?? question] });
  const queryVector = (embedding as { data: number[][] }).data[0];

  const results = await env.VECTORIZE.query(queryVector, {
    topK: options.topK ?? TOP_K,
    returnMetadata: "all",
  });

  return results.matches
    .filter((match) => match.score >= MIN_SCORE)
    .map((match) => {
      const metadata = (match.metadata ?? {}) as Record<string, string | number>;
      return {
        text: String(metadata.text ?? ""),
        title: String(metadata.title ?? "Okänt dokument"),
        url: String(metadata.url ?? ""),
        heading: metadata.heading ? String(metadata.heading) : null,
        sectionLabel: String(metadata.sectionLabel ?? ""),
        page: Number(metadata.page ?? 0),
        score: match.score,
      };
    })
    .filter((chunk) => chunk.text.length > 0);
}
