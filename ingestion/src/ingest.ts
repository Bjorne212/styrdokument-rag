/**
 * Steg 5 + 6: håll Vectorize-indexet i synk med arkivet.
 *
 * Det här är jobbet som GitHub Actions kör på schema. Det ska vara billigt när
 * ingenting hänt, och exakt när något hänt. Därför två nivåer av kontroll:
 *
 *   1. Ett billigt fingeravtryck per sektion, som källtypen tar fram (för
 *      LinTeks GitLab-arkiv: ETaggen från ett HEAD-anrop). Oförändrat
 *      fingeravtryck betyder att ingenting i hela sektionen ändrats. Då
 *      hoppas den över helt, noll nedladdningar.
 *
 *   2. För sektioner som ändrats: ladda ner filerna och jämför sha256 mot
 *      manifestet. Bara dokument med ny hash extraheras, chunkas och embeddas
 *      om. Fingeravtrycket säger *att* något hänt, hashen säger *vad*.
 *
 * Dokument som försvunnit ur arkivet får sina vektorer borttagna, liksom
 * överblivna chunkar när ett dokument blivit kortare än förut.
 *
 * Kör:  node --env-file=.env src/ingest.ts            (inkrementellt)
 *       node --env-file=.env src/ingest.ts --force    (indexera om allt)
 *       node src/ingest.ts --dry-run                  (visa plan, rör inget)
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  configFromEnv,
  deleteVectors,
  describeIndex,
  embed,
  EMBEDDING_DIMENSIONS,
  upsertVectors,
  type CloudflareConfig,
  type VectorRecord,
} from "./cloudflare.ts";
import { chunkDocument, embeddingText } from "./chunk.ts";
import { extractDocument } from "./extract.ts";
import { scrapeArchive, type ArchiveDocument } from "./scrape.ts";
import { source } from "./sources/index.ts";
import { loadSkipList } from "./skiplist.ts";

const MANIFEST_PATH = join(import.meta.dirname, "../manifest.json");

/** Så många texter per embedding-anrop. Färre anrop, samma tokenkostnad. */
const EMBED_BATCH = 50;
/** Så många vektorer per skrivning till Vectorize. Gränsen är 5000 via REST. */
const UPSERT_BATCH = 200;
/**
 * Så många id:n per borttagning. Vectorize tillåter bara 100 åt gången
 * en annan gräns än för upsert, vilket är lätt att missa eftersom felet dyker
 * upp först när ett dokument fått färre chunkar än det hade förut.
 */
const DELETE_BATCH = 100;

type Manifest = {
  version: 1;
  updatedAt: string | null;
  /** Fingeravtryck per sektion, vår billiga "har något ändrats alls?"-signal. */
  sections: Record<string, { etag: string | null }>;
  /** Vad vi vet om varje dokument sedan förra körningen. */
  documents: Record<
    string,
    {
      sha256: string;
      uploaded: string;
      title: string;
      url: string;
      chunkIds: string[];
    }
  >;
};

const EMPTY_MANIFEST: Manifest = {
  version: 1,
  updatedAt: null,
  sections: {},
  documents: {},
};

async function loadManifest(): Promise<Manifest> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    // Första körningen: inget manifest ännu, allt är nytt.
    return structuredClone(EMPTY_MANIFEST);
  }
}

async function saveManifest(manifest: Manifest): Promise<void> {
  manifest.updatedAt = new Date().toISOString();
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

/** Delar upp en lista i bitar av given storlek. */
function batched<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Bygger vektorer för ett dokument: extrahera text, chunka, embedda.
 *
 * Chunkens text följer med som metadata. Vectorize returnerar metadatan vid
 * sökning, så Workern får själva texten direkt ur sökträffen och behöver
 * ingen separat lagring av dokumentinnehållet.
 */
async function vectorsForDocument(
  config: CloudflareConfig,
  doc: ArchiveDocument,
): Promise<{ vectors: VectorRecord[]; sha256: string }> {
  const extracted = await extractDocument(doc);
  const chunks = chunkDocument(doc, extracted.pages);
  const vectors: VectorRecord[] = [];

  for (const batch of batched(chunks, EMBED_BATCH)) {
    // Rubrik och dokumentnamn embeddas tillsammans med texten, se embeddingText.
    const embeddings = await embed(
      config,
      batch.map((chunk) => embeddingText(chunk)),
    );

    batch.forEach((chunk, index) => {
      vectors.push({
        id: chunk.id,
        values: embeddings[index],
        metadata: { ...chunk.metadata, text: chunk.text },
      });
    });
  }

  return { vectors, sha256: extracted.sha256 };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const prune = args.includes("--prune");

  const manifest = await loadManifest();

  // Översättningar av dokument som redan finns i indexet utelämnas. Ett
  // dokument som hamnar på listan i efterhand behandlas som borttaget, så dess
  // vektorer städas bort automatiskt av samma logik som hanterar dokument som
  // försvunnit ur arkivet.
  const skip = await loadSkipList();
  const documents = (await scrapeArchive()).filter((doc) => !skip.has(doc.id));

  // --prune: räkna ut vilka chunk-id:n den nuvarande koden skulle ge, ta bort
  // allt i indexet som inte längre hör dit, och skriv om manifestet. Ingen
  // embedding sker, så det kostar inga neurons. Används för att städa efter en
  // avbruten körning, eller efter att chunkningen ändrats.
  if (prune) {
    const config = configFromEnv();
    const stale: string[] = [];

    for (const doc of documents) {
      const known = manifest.documents[doc.id];
      if (!known) continue;

      const extracted = await extractDocument(doc);
      const current = chunkDocument(doc, extracted.pages).map((chunk) => chunk.id);
      const currentIds = new Set(current);

      stale.push(...known.chunkIds.filter((id) => !currentIds.has(id)));
      manifest.documents[doc.id] = { ...known, chunkIds: current };
    }

    console.log(`Städar ${stale.length} överblivna vektorer ...`);
    for (const batch of batched(stale, DELETE_BATCH)) {
      await deleteVectors(config, batch);
    }

    await saveManifest(manifest);
    console.log("Klart. Inga neurons förbrukade.");
    return;
  }

  // --- Nivå 1: vilka sektioner har ändrats alls? ---
  const etags = new Map<string, string | null>();
  const changedSections = new Set<string>();

  for (const { id: section } of source.sections) {
    const etag = await source.fingerprint(section);
    etags.set(section, etag);

    const known = manifest.sections[section]?.etag ?? null;
    if (force || etag === null || known === null || etag !== known) {
      changedSections.add(section);
    }
  }

  // Dokument i en oförändrad sektion behöver inte ens laddas ner. Ett dokument
  // som saknas i manifestet måste dock alltid med, även om fingeravtrycket matchar
  // annars skulle en avbruten körning lämna hål i indexet för alltid.
  const candidates = documents.filter(
    (doc) => changedSections.has(doc.section) || !manifest.documents[doc.id],
  );

  console.log(`Överhoppade dubbletter: ${skip.size}`);
  console.log(`Sektioner att granska: ${changedSections.size} av ${source.sections.length}`);
  console.log(`Dokument att granska:  ${candidates.length} av ${documents.length}`);

  // --- Dokument som försvunnit ur arkivet ---
  const currentIds = new Set(documents.map((doc) => doc.id));
  const removed = Object.keys(manifest.documents).filter((id) => !currentIds.has(id));
  const staleVectorIds = removed.flatMap((id) => manifest.documents[id].chunkIds);

  if (dryRun) {
    console.log("\n--dry-run: inget skrivs.");
    for (const doc of candidates) console.log(`  skulle granska  ${doc.id}`);
    for (const id of removed) console.log(`  skulle ta bort   ${id}`);
    return;
  }

  const config = configFromEnv();

  // Fångar det vanligaste felet, index saknas eller har fel dimensioner
  // innan vi bränner tid och kvot på att embedda.
  const index = await describeIndex(config);
  const dimensions = index?.config?.dimensions;
  if (dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Indexet "${config.indexName}" har ${dimensions} dimensioner, förväntade ${EMBEDDING_DIMENSIONS}.`,
    );
  }

  // --- Nivå 2: vilka dokument har faktiskt nytt innehåll? ---
  let updated = 0;
  let unchanged = 0;
  const toDelete = [...staleVectorIds];

  for (const doc of candidates) {
    const known = manifest.documents[doc.id];
    const { vectors, sha256 } = await vectorsForDocument(config, doc);

    if (known && known.sha256 === sha256 && !force) {
      unchanged++;
      continue;
    }

    // Blev dokumentet kortare har det färre chunkar än förut. De överblivna
    // id:na måste bort, annars ligger gammal text kvar och kan bli sökträff.
    if (known) {
      const newIds = new Set(vectors.map((vector) => vector.id));
      toDelete.push(...known.chunkIds.filter((id) => !newIds.has(id)));
    }

    for (const batch of batched(vectors, UPSERT_BATCH)) {
      await upsertVectors(config, batch);
    }

    manifest.documents[doc.id] = {
      sha256,
      uploaded: doc.uploaded,
      title: doc.title,
      url: doc.url,
      chunkIds: vectors.map((vector) => vector.id),
    };

    updated++;
    console.log(`  uppdaterade ${doc.id} (${vectors.length} chunkar)`);
  }

  for (const id of removed) {
    delete manifest.documents[id];
    console.log(`  tog bort ${id}`);
  }

  for (const batch of batched(toDelete, DELETE_BATCH)) {
    await deleteVectors(config, batch);
  }

  // Sektioner som tagits bort ur konfigurationen ska inte ligga kvar.
  manifest.sections = {};
  for (const { id: section } of source.sections) {
    manifest.sections[section] = { etag: etags.get(section) ?? null };
  }

  await saveManifest(manifest);

  console.log("\nKlart.");
  console.log(`  Uppdaterade dokument:  ${updated}`);
  console.log(`  Oförändrade:           ${unchanged}`);
  console.log(`  Borttagna dokument:    ${removed.length}`);
  console.log(`  Borttagna vektorer:    ${toDelete.length}`);
  console.log(`  Dokument i indexet:    ${Object.keys(manifest.documents).length}`);
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
