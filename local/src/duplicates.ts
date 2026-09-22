/**
 * Hittar dokument som är samma sak två gånger.
 *
 * Arkivet innehåller både svenska och engelska versioner av samma styrdokument
 * (Stadga/Bylaw, Reglemente/Regulations), och ibland flera årgångar av samma
 * policy. Båda konkurrerar om platserna bland de åtta stycken som skickas till
 * modellen, vilket gör svaren sämre: ett svar som citerar samma regel på två
 * språk ser slarvigt ut och slösar hälften av kontexten.
 *
 * Filnamnen avslöjar inte släktskapet: "Stadga" och "Bylaw" delar inte ett
 * enda ord. Däremot gör innehållet det: bge-m3 är flerspråkig, så en svensk och
 * en engelsk version av samma text hamnar nära varandra i vektorrummet. Vi
 * beräknar därför ett medelvärde av varje dokuments chunkvektorer och jämför
 * dokumenten med varandra.
 *
 * Kör:  node src/duplicates.ts
 *       node src/duplicates.ts --threshold 0.9
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EMBEDDING_DIMENSIONS } from "./embeddings.ts";
import { loadLocalIndex } from "./localindex.ts";

const OUTPUT = join(import.meta.dirname, "../../ingestion/duplicates.json");

/** Under detta räknas två dokument inte som samma sak. Satt efter inspektion. */
const DEFAULT_THRESHOLD = 0.86;

type DocumentVector = {
  documentId: string;
  title: string;
  section: string;
  lang: string;
  chunks: number;
  vector: Float32Array;
};

function meanVectors(index: Awaited<ReturnType<typeof loadLocalIndex>>): DocumentVector[] {
  const groups = new Map<string, { entries: number[]; meta: (typeof index.entries)[number] }>();

  index.entries.forEach((entry, position) => {
    const key = entry.metadata.documentId;
    if (!groups.has(key)) groups.set(key, { entries: [], meta: entry });
    groups.get(key)!.entries.push(position);
  });

  return [...groups.entries()].map(([documentId, { entries, meta }]) => {
    const vector = new Float32Array(EMBEDDING_DIMENSIONS);

    for (const position of entries) {
      const offset = position * EMBEDDING_DIMENSIONS;
      for (let d = 0; d < EMBEDDING_DIMENSIONS; d++) vector[d] += index.vectors[offset + d];
    }

    // Normalisera, så att jämförelsen blir en ren cosinuslikhet.
    let norm = 0;
    for (let d = 0; d < EMBEDDING_DIMENSIONS; d++) norm += vector[d] * vector[d];
    norm = Math.sqrt(norm);
    for (let d = 0; d < EMBEDDING_DIMENSIONS; d++) vector[d] /= norm;

    // Dokumentets språk = det som flest av dess chunkar fick.
    const swedish = entries.filter((p) => index.entries[p].metadata.lang === "sv").length;

    return {
      documentId,
      title: meta.metadata.title,
      section: meta.metadata.sectionLabel,
      lang: swedish >= entries.length / 2 ? "sv" : "en",
      chunks: entries.length,
      vector,
    };
  });
}

function similarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let d = 0; d < EMBEDDING_DIMENSIONS; d++) dot += a[d] * b[d];
  return dot;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const thresholdIndex = args.indexOf("--threshold");
  const threshold =
    thresholdIndex !== -1 ? Number(args[thresholdIndex + 1]) : DEFAULT_THRESHOLD;

  const index = await loadLocalIndex();
  const documents = meanVectors(index);

  console.log(`${documents.length} dokument, tröskel ${threshold}\n`);

  /**
   * Parar ihop dokument giriga: högsta likhet först, och varje dokument får
   * bara ingå i ett par.
   *
   * Varken tröskel eller "bästa match" räcker ensamt. Enbart tröskel parar
   * ihop truckpolicyn med bilpolicyn (0,866). Ömsesidigt bästa match missar i
   * stället Stadga/Bylaw, eftersom Stadga, Reglemente, Regulations och Bylaw
   * alla liknar varandra och bästa-matchen pekar fel inom klungan. Girig
   * parning löser båda: Reglemente/Regulations tar varandra först på högre
   * poäng, och då återstår Stadga och Bylaw åt varandra.
   */
  const candidates: { sv: DocumentVector; en: DocumentVector; score: number }[] = [];

  for (const sv of documents.filter((doc) => doc.lang === "sv")) {
    for (const en of documents.filter((doc) => doc.lang === "en")) {
      const score = similarity(sv.vector, en.vector);
      if (score >= threshold) candidates.push({ sv, en, score });
    }
  }

  candidates.sort((x, y) => y.score - x.score);

  type Pair = { sv: DocumentVector; en: DocumentVector; score: number };
  const pairs: Pair[] = [];
  const taken = new Set<string>();

  for (const candidate of candidates) {
    if (taken.has(candidate.sv.documentId) || taken.has(candidate.en.documentId)) continue;
    taken.add(candidate.sv.documentId);
    taken.add(candidate.en.documentId);
    pairs.push(candidate);
  }

  pairs.sort((x, y) => y.score - x.score);

  console.log(`### Översättningspar (girig parning): ${pairs.length} st\n`);
  for (const { sv, en, score } of pairs) {
    console.log(`  ${score.toFixed(3)}  ${sv.title}`);
    console.log(`         ↔  ${en.title}   [${sv.section}]`);
  }

  // Dokument utan motpart måste behållas oavsett språk: annars tappar vi
  // innehåll som bara finns på ett språk.
  const paired = new Set(pairs.flatMap(({ sv, en }) => [sv.documentId, en.documentId]));
  const englishOnly = documents.filter((doc) => doc.lang === "en" && !paired.has(doc.documentId));

  console.log(`\n### Engelska dokument UTAN svensk motsvarighet (behålls): ${englishOnly.length} st\n`);
  for (const doc of englishOnly) console.log(`  ${doc.title}   [${doc.section}]`);

  const skip = pairs.map(({ en }) => en.documentId);
  const removedChunks = pairs.reduce((sum, { en }) => sum + en.chunks, 0);

  await writeFile(
    OUTPUT,
    JSON.stringify(
      {
        comment:
          "Genererad av src/duplicates.ts. Dokumenten i skip är engelska versioner av ett svenskt dokument som redan finns i indexet, och hoppas över vid indexering.",
        threshold,
        pairs: pairs.map(({ sv, en, score }) => ({
          score: Number(score.toFixed(4)),
          keep: sv.documentId,
          skip: en.documentId,
        })),
        skip,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(`\nSkrev ${OUTPUT}`);
  console.log(`Skulle hoppa över ${skip.length} dokument = ${removedChunks} chunkar av ${index.entries.length}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
