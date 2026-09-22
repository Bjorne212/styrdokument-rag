/**
 * Ett lokalt sökindex, som kopia av det i Vectorize.
 *
 * Med 2000-3000 chunkar behövs ingen vektordatabas för att söka: att jämföra
 * frågans vektor mot alla lagrade vektorer är några miljoner multiplikationer,
 * alltså millisekunder. Vectorize behövs i produktion för att Workern inte kan
 * bära indexet i minnet, men för utvärdering på den här datorn är brute force
 * både enklare och exakt (ingen approximation som i en riktig vektordatabas).
 *
 * Vektorerna sparas i en binärfil och återanvänds mellan körningar, nycklade på
 * innehållet. Ändrar man chunkningen embeddas bara det som faktiskt blev nytt.
 *
 * Kör:  node src/localindex.ts            (bygg/uppdatera indexet)
 *       node src/localindex.ts --rebuild  (bygg om från grunden)
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chunkDocument, embeddingText, type Chunk } from "../../ingestion/src/chunk.ts";
import { EMBEDDING_DIMENSIONS, embedTexts } from "./embeddings.ts";
import { extractDocument } from "../../ingestion/src/extract.ts";
import { scrapeArchive } from "../../ingestion/src/scrape.ts";
import { loadSkipList } from "../../ingestion/src/skiplist.ts";

const CACHE_DIR = join(import.meta.dirname, "../../ingestion/cache");
const VECTORS_PATH = `${CACHE_DIR}/local-index.bin`;
const META_PATH = `${CACHE_DIR}/local-index.json`;

/** Hur många texter som embeddas per anrop till Ollama. */
const BATCH = 32;

type StoredEntry = {
  id: string;
  /** sha256 av den embeddade texten, nyckeln som avgör om vektorn kan återanvändas. */
  hash: string;
  text: string;
  metadata: Chunk["metadata"];
};

export type LocalIndex = {
  entries: StoredEntry[];
  vectors: Float32Array;
};

export type SearchHit = {
  score: number;
  text: string;
  metadata: Chunk["metadata"];
};

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function loadCache(): Promise<Map<string, Float32Array>> {
  try {
    const meta = JSON.parse(await readFile(META_PATH, "utf8")) as StoredEntry[];
    const buffer = await readFile(VECTORS_PATH);
    const all = new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );

    const cache = new Map<string, Float32Array>();
    meta.forEach((entry, index) => {
      cache.set(
        entry.hash,
        all.subarray(index * EMBEDDING_DIMENSIONS, (index + 1) * EMBEDDING_DIMENSIONS),
      );
    });
    return cache;
  } catch {
    return new Map();
  }
}

/** Bygger indexet, och återanvänder vektorer för chunkar som inte ändrats. */
export async function buildLocalIndex(options: { rebuild?: boolean } = {}): Promise<LocalIndex> {
  const cache = options.rebuild ? new Map<string, Float32Array>() : await loadCache();

  // Samma filter som produktionsindexet, annars mäter vi något annat än det
  // som faktiskt körs.
  const skip = await loadSkipList();
  const documents = (await scrapeArchive()).filter((doc) => !skip.has(doc.id));
  const chunks: Chunk[] = [];
  for (const doc of documents) {
    const extracted = await extractDocument(doc);
    chunks.push(...chunkDocument(doc, extracted.pages));
  }

  const entries: StoredEntry[] = chunks.map((chunk) => ({
    id: chunk.id,
    hash: hashText(embeddingText(chunk)),
    text: chunk.text,
    metadata: chunk.metadata,
  }));

  const missing = entries.filter((entry) => !cache.has(entry.hash));
  if (missing.length) {
    process.stdout.write(`Embeddar ${missing.length} av ${entries.length} chunkar `);

    const byHash = new Map(chunks.map((chunk) => [hashText(embeddingText(chunk)), chunk]));
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const vectors = await embedTexts(batch.map((entry) => embeddingText(byHash.get(entry.hash)!)));
      batch.forEach((entry, index) => cache.set(entry.hash, Float32Array.from(vectors[index])));
      process.stdout.write(".");
    }
    process.stdout.write("\n");
  } else {
    console.log(`Alla ${entries.length} chunkar fanns redan i cachen.`);
  }

  const vectors = new Float32Array(entries.length * EMBEDDING_DIMENSIONS);
  entries.forEach((entry, index) => {
    vectors.set(cache.get(entry.hash)!, index * EMBEDDING_DIMENSIONS);
  });

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(META_PATH, JSON.stringify(entries));
  await writeFile(VECTORS_PATH, Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength));

  return { entries, vectors };
}

/** Läser in ett tidigare byggt index utan att embedda något. */
export async function loadLocalIndex(): Promise<LocalIndex> {
  const entries = JSON.parse(await readFile(META_PATH, "utf8")) as StoredEntry[];
  const buffer = await readFile(VECTORS_PATH);
  const vectors = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return { entries, vectors };
}

/**
 * Söker med cosinuslikhet.
 *
 * bge-m3 ger normaliserade vektorer, så cosinuslikhet är samma sak som
 * skalärprodukten, ingen division behövs.
 */
export function search(index: LocalIndex, queryVector: number[], topK = 8): SearchHit[] {
  const scores: { score: number; position: number }[] = [];

  for (let position = 0; position < index.entries.length; position++) {
    const offset = position * EMBEDDING_DIMENSIONS;
    let dot = 0;
    for (let d = 0; d < EMBEDDING_DIMENSIONS; d++) {
      dot += queryVector[d] * index.vectors[offset + d];
    }
    scores.push({ score: dot, position });
  }

  scores.sort((a, b) => b.score - a.score);

  return scores.slice(0, topK).map(({ score, position }) => ({
    score,
    text: index.entries[position].text,
    metadata: index.entries[position].metadata,
  }));
}

/** Söker med en fråga i klartext. */
export async function searchText(
  index: LocalIndex,
  question: string,
  topK = 8,
): Promise<SearchHit[]> {
  const [vector] = await embedTexts([question]);
  return search(index, vector, topK);
}

async function main(): Promise<void> {
  const rebuild = process.argv.includes("--rebuild");
  const started = Date.now();
  const index = await buildLocalIndex({ rebuild });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\nIndex klart: ${index.entries.length} chunkar på ${seconds} s`);
  console.log(`  ${VECTORS_PATH} (${(index.vectors.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
