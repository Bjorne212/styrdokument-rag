/**
 * Jämför inställningar mot utvärderingsuppsättningen.
 *
 * Chunkstorlek och rubrikinbäddning valdes tidigare på strukturmått, antal
 * chunkar, lagringsutrymme, om kända formuleringar överlevde. Inget av det
 * säger om sökningen faktiskt hittar rätt. Det gör det här skriptet: varje
 * variant får ett eget index och samma 20 frågor, och resultaten ställs mot
 * varandra.
 *
 * Allt körs mot Ollama lokalt, så det kostar ingenting att köra om.
 *
 * Kör:  node src/experiments.ts
 */


import { chunkDocument, embeddingText, type Chunk } from "../../ingestion/src/chunk.ts";
import { EMBEDDING_DIMENSIONS, embedTexts } from "./embeddings.ts";
import { extractDocument } from "../../ingestion/src/extract.ts";
import { scrapeArchive } from "../../ingestion/src/scrape.ts";
import { loadQuestions, meanReciprocalRank, rankOf, type EvalQuestion } from "./evalcore.ts";
import { search, type LocalIndex } from "./localindex.ts";

const TOP_K = 8;
const BATCH = 32;

type Variant = {
  name: string;
  targetChars: number;
  /** Om dokumentnamn och rubrik ska embeddas tillsammans med texten. */
  headingPrefix: boolean;
};

const VARIANTS: Variant[] = [
  { name: "600 + rubrik", targetChars: 600, headingPrefix: true },
  { name: "900 + rubrik", targetChars: 900, headingPrefix: true },
  { name: "1200 + rubrik", targetChars: 1200, headingPrefix: true },
  { name: "900 utan rubrik", targetChars: 900, headingPrefix: false },
  { name: "1200 utan rubrik", targetChars: 1200, headingPrefix: false },
];

async function buildIndex(chunks: Chunk[], headingPrefix: boolean): Promise<LocalIndex> {
  const texts = chunks.map((chunk) => (headingPrefix ? embeddingText(chunk) : chunk.text));
  const vectors = new Float32Array(chunks.length * EMBEDDING_DIMENSIONS);

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = await embedTexts(texts.slice(i, i + BATCH));
    batch.forEach((vector, index) => vectors.set(vector, (i + index) * EMBEDDING_DIMENSIONS));
    process.stdout.write(".");
  }

  return {
    entries: chunks.map((chunk) => ({
      id: chunk.id,
      hash: "",
      text: chunk.text,
      metadata: chunk.metadata,
    })),
    vectors,
  };
}

async function main(): Promise<void> {
  const questions = await loadQuestions();

  const documents = await scrapeArchive();
  const extracted = [];
  for (const doc of documents) {
    extracted.push({ doc, pages: (await extractDocument(doc)).pages });
  }

  // Frågornas vektorer är samma i alla varianter, embedda dem en gång.
  const questionVectors = await embedTexts(questions.map((q) => q.question));

  const rows: { variant: Variant; chunks: number; recall: number; top1: number; mrr: number; perKind: Record<string, number> }[] = [];

  for (const variant of VARIANTS) {
    const chunks = extracted.flatMap(({ doc, pages }) =>
      chunkDocument(doc, pages, { targetChars: variant.targetChars }),
    );

    process.stdout.write(`${variant.name.padEnd(18)} ${String(chunks.length).padStart(4)} chunkar `);
    const index = await buildIndex(chunks, variant.headingPrefix);

    let found = 0;
    let top1 = 0;
    let mrrSum = 0;
    const kindMrr: Record<string, { sum: number; count: number }> = {};

    questions.forEach((question, i) => {
      const hits = search(index, questionVectors[i], TOP_K);
      const rank = rankOf(hits, question);

      if (rank) found++;
      if (rank === 1) top1++;
      const reciprocal = rank ? 1 / rank : 0;
      mrrSum += reciprocal;

      kindMrr[question.kind] ??= { sum: 0, count: 0 };
      kindMrr[question.kind].sum += reciprocal;
      kindMrr[question.kind].count++;
    });

    rows.push({
      variant,
      chunks: chunks.length,
      recall: found / questions.length,
      top1,
      mrr: mrrSum / questions.length,
      perKind: Object.fromEntries(
        Object.entries(kindMrr).map(([kind, { sum, count }]) => [kind, sum / count]),
      ),
    });

    process.stdout.write(" klar\n");
  }

  const kinds = [...new Set(questions.map((q) => q.kind))];

  console.log("\n");
  console.log(
    `variant             chunkar  träff@8  plats1   MRR    ${kinds.map((k) => k.slice(0, 9).padStart(10)).join("")}`,
  );
  console.log("-".repeat(70 + kinds.length * 10));

  for (const row of rows) {
    const perKind = kinds.map((kind) => (row.perKind[kind] ?? 0).toFixed(3).padStart(10)).join("");
    console.log(
      `${row.variant.name.padEnd(18)} ${String(row.chunks).padStart(6)}  ${(Math.round(row.recall * 100) + " %").padStart(6)}  ${String(row.top1).padStart(5)}/20  ${row.mrr.toFixed(3)}  ${perKind}`,
    );
  }

  const best = rows.reduce((a, b) => (b.mrr > a.mrr ? b : a));
  console.log(`\nBäst MRR: ${best.variant.name} (${best.mrr.toFixed(3)})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
