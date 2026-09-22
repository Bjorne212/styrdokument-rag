/**
 * Steg 2 i pipelinen: hämta PDF:erna och få ut texten ur dem.
 *
 * En PDF innehåller inte text i löpande form, utan bokstäver med koordinater.
 * unpdf (en Node-vänlig förpackning av Mozillas pdf.js) tolkar koordinaterna
 * tillbaka till text, en sträng per sida.
 *
 * Nedladdade filer sparas i cache/ så att upprepade körningar under utveckling
 * inte laddar ner arkivet om och om igen. Cachen är bortignorerad i git.
 *
 * Kör:  node src/extract.ts            (alla dokument, kvalitetsrapport)
 *       node src/extract.ts --limit 5  (bara de första 5)
 *       node src/extract.ts --show Reglemente   (skriv ut början av texten)
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { scrapeArchive, type ArchiveDocument } from "./scrape.ts";
import { USER_AGENT } from "./sources/types.ts";

const CACHE_DIR = join(import.meta.dirname, "../cache");

export type ExtractedDocument = {
  document: ArchiveDocument;
  /** sha256 av PDF-filens bytes: vår exakta signal för "har filen ändrats?". */
  sha256: string;
  /** Filstorlek i bytes. */
  bytes: number;
  /** En textsträng per sida, i sidordning. */
  pages: string[];
};

/** Laddar ner en PDF, eller läser den från cache om den redan finns. */
export async function fetchPdf(doc: ArchiveDocument): Promise<Uint8Array> {
  const cachePath = join(CACHE_DIR, doc.section, doc.path);

  try {
    return new Uint8Array(await readFile(cachePath));
  } catch {
    // Inte cachad ännu: hämta från arkivet.
  }

  const response = await fetch(doc.url, {
    headers: { "user-agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} för ${doc.url}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, bytes);
  return bytes;
}

/** Kör pdf.js på filens bytes och returnerar en sträng per sida. */
export async function extractPages(bytes: Uint8Array): Promise<string[]> {
  // getDocumentProxy konsumerar arrayen, så vi ger den en kopia och behåller
  // originalet för hashningen.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

/** Hämtar + extraherar ett dokument. */
export async function extractDocument(doc: ArchiveDocument): Promise<ExtractedDocument> {
  const bytes = await fetchPdf(doc);
  const pages = await extractPages(bytes);

  return {
    document: doc,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    pages,
  };
}

/** Städar bort mjuka radbrytningar och dubbla mellanslag för läsbarhet. */
export function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Quality = {
  doc: ArchiveDocument;
  pageCount: number;
  chars: number;
  charsPerPage: number;
  emptyPages: number;
  bytes: number;
};

function assess(extracted: ExtractedDocument): Quality {
  const chars = extracted.pages.reduce((sum, page) => sum + normalize(page).length, 0);
  const emptyPages = extracted.pages.filter((page) => normalize(page).length < 20).length;

  return {
    doc: extracted.document,
    pageCount: extracted.pages.length,
    chars,
    charsPerPage: extracted.pages.length ? Math.round(chars / extracted.pages.length) : 0,
    emptyPages,
    bytes: extracted.bytes,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex !== -1 ? Number(args[limitIndex + 1]) : Infinity;
  const showIndex = args.indexOf("--show");
  const show = showIndex !== -1 ? args[showIndex + 1] : null;

  const all = await scrapeArchive();
  const documents = all.slice(0, limit);

  console.log(`Extraherar text ur ${documents.length} dokument ...\n`);

  const results: Quality[] = [];
  const failures: string[] = [];

  for (const doc of documents) {
    try {
      const extracted = await extractDocument(doc);
      results.push(assess(extracted));

      if (show && doc.id.toLowerCase().includes(show.toLowerCase())) {
        console.log(`\n${"=".repeat(70)}\n${doc.id}\n${"=".repeat(70)}`);
        console.log(normalize(extracted.pages[0] ?? "").slice(0, 1500));
        console.log(`${"=".repeat(70)}\n`);
      }
    } catch (error) {
      failures.push(`${doc.id}: ${(error as Error).message}`);
    }
  }

  // Dokument utan text är nästan alltid inskannade bilder, de kan inte
  // indexeras utan OCR, och måste därför synas tydligt i rapporten.
  const empty = results.filter((result) => result.chars < 200);
  const mostlyEmpty = results.filter(
    (result) => result.chars >= 200 && result.emptyPages > result.pageCount / 2,
  );

  console.log("Sammanfattning");
  console.log(`  Dokument:            ${results.length}`);
  console.log(`  Sidor totalt:        ${results.reduce((sum, r) => sum + r.pageCount, 0)}`);
  console.log(`  Tecken totalt:       ${results.reduce((sum, r) => sum + r.chars, 0).toLocaleString("sv-SE")}`);
  console.log(`  Utan text (OCR?):    ${empty.length}`);
  console.log(`  Delvis tomma:        ${mostlyEmpty.length}`);
  console.log(`  Misslyckades:        ${failures.length}`);

  if (empty.length) {
    console.log("\nDokument utan utläsbar text:");
    for (const result of empty) {
      console.log(`  ${result.doc.id} (${result.pageCount} sidor, ${result.chars} tecken)`);
    }
  }

  if (mostlyEmpty.length) {
    console.log("\nDokument där de flesta sidor är tomma:");
    for (const result of mostlyEmpty) {
      console.log(`  ${result.doc.id} (${result.emptyPages}/${result.pageCount} tomma sidor)`);
    }
  }

  if (failures.length) {
    console.log("\nFel:");
    for (const failure of failures) console.log(`  ${failure}`);
  }

  const thinnest = [...results].sort((a, b) => a.charsPerPage - b.charsPerPage).slice(0, 5);
  console.log("\nMinst text per sida (misstänkta problemfall):");
  for (const result of thinnest) {
    console.log(`  ${String(result.charsPerPage).padStart(5)} tecken/sida  ${result.doc.id}`);
  }
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
