/**
 * Steg 1 i pipelinen: hitta alla styrdokument i kårens arkiv.
 *
 * Hur arkivet läses bestäms av källtypen i kar.config.json, se sources/.
 * Den här filen går igenom alla sektioner och samlar ihop resultatet.
 *
 * Kör:  node src/scrape.ts [--verify] [--out fil.json]
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { source, type ArchiveDocument } from "./sources/index.ts";

export type { ArchiveDocument } from "./sources/index.ts";

/** Hämtar och parsar alla sektioner. */
export async function scrapeArchive(): Promise<ArchiveDocument[]> {
  const perSection = await Promise.all(
    source.sections.map((section) => source.listDocuments(section.id)),
  );
  return perSection.flat();
}

/** Kontrollerar att varje PDF-URL faktiskt går att nå (HEAD-anrop). */
async function verifyUrls(documents: ArchiveDocument[]): Promise<string[]> {
  const problems: string[] = [];

  // Några i taget, för att inte spamma servern med hundra parallella anrop.
  const batchSize = 8;
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (doc) => {
        try {
          const response = await fetch(doc.url, { method: "HEAD" });
          if (!response.ok) {
            problems.push(`${response.status} ${doc.id}`);
          }
        } catch (error) {
          problems.push(`nätverksfel ${doc.id}: ${(error as Error).message}`);
        }
      }),
    );
  }

  return problems;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verify = args.includes("--verify");
  const outIndex = args.indexOf("--out");
  const outPath = outIndex !== -1 ? args[outIndex + 1] : join(import.meta.dirname, "../out/documents.json");

  const documents = await scrapeArchive();

  console.log(`Hittade ${documents.length} dokument:\n`);
  for (const section of source.sections) {
    const inSection = documents.filter((doc) => doc.section === section.id);
    const newest = inSection.reduce(
      (latest, doc) => (doc.uploaded > latest ? doc.uploaded : latest),
      "",
    );
    console.log(
      `  ${section.label.padEnd(20)} ${String(inSection.length).padStart(3)} st` +
        (newest ? `   senast uppladdat ${newest}` : ""),
    );
  }

  if (verify) {
    console.log("\nKontrollerar att alla PDF-URL:er svarar ...");
    const problems = await verifyUrls(documents);
    if (problems.length === 0) {
      console.log(`  OK: alla ${documents.length} URL:er svarade.`);
    } else {
      console.log(`  ${problems.length} problem:`);
      for (const problem of problems) console.log(`    ${problem}`);
    }
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(documents, null, 2) + "\n", "utf8");
  console.log(`\nSkrev ${outPath}`);
}

// Kör bara main när filen startas direkt, inte när den importeras av annan kod.
if (import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
