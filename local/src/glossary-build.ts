/**
 * Bygger en ordlista över kårens förkortningar, ur dokumenten själva.
 *
 * Vektorsökning är svag på förkortningar: "SA" är två bokstäver utan
 * betydelse för en embeddingmodell, medan "Studiesocialt ansvariga" bär
 * massor. Genom att expandera kända förkortningar i frågan innan den embeddas
 * får sökningen det innehållet gratis: ingen extra modell, inga neurons.
 *
 * Listan skrivs till worker/src/glossary.json, som Workern importerar. Den är
 * genererad, inte handskriven: ändras dokumenten körs det här om.
 *
 * Kör:  node src/glossary-build.ts
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chunkDocument } from "../../ingestion/src/chunk.ts";
import { extractDocument } from "../../ingestion/src/extract.ts";
import { scrapeArchive } from "../../ingestion/src/scrape.ts";

const OUTPUT = join(import.meta.dirname, "../../worker/src/glossary.json");

/**
 * Dokumenten introducerar förkortningar på formen
 * "Studiesocialt ansvariga, SA, är ..." eller "Projektledaren för LARM, PL, ansvarar".
 * Vi fångar den fullständiga benämningen före kommatecknet och förkortningen
 * mellan kommatecknen.
 */
const DEFINITION =
  /([A-ZÅÄÖ][\wåäöÅÄÖ]*(?:[ -](?:för |och |av )?[\wåäöÅÄÖ]+){0,3}), (v?[A-ZÅÄÖ]{1,5}),? (?:är|ansvarar|skall|ska|har|utses|väljs)/g;

async function main(): Promise<void> {
  const documents = await scrapeArchive();
  const counts = new Map<string, Map<string, number>>();

  const allChunks = [];
  for (const doc of documents) {
    const extracted = await extractDocument(doc);
    allChunks.push(...chunkDocument(doc, extracted.pages));
  }

  // Rubriker står kvar i löptexten ("3.1 Allmänt Vice kårordförande, vKO, ..."),
  // så en definition som följer direkt efter en rubrik får med rubrikordet i
  // förklaringen. Vi samlar därför alla rubrikord som förekommer i arkivet och
  // stryker dem från början av en förklaring.
  const headingWords = new Set<string>();
  for (const chunk of allChunks) {
    const heading = chunk.metadata.heading?.replace(/^\d[\d.]*\s*/, "");
    if (heading) headingWords.add(heading.split(" ")[0]);
  }

  {
    for (const chunk of allChunks) {
      const text = chunk.text.replace(/\s+/g, " ");

      for (const match of text.matchAll(DEFINITION)) {
        let expansion = match[1].trim();
        const abbreviation = match[2];

        // Skala bort inledande rubrikord: men bara om det som återstår börjar
        // med versal. Utan det villkoret strippas "Vice" ur "Vice
        // kårordförande" (eftersom "Vice" också är ett rubrikord), och vKO
        // skulle få samma förklaring som KO.
        let parts = expansion.split(" ");
        while (parts.length > 1 && headingWords.has(parts[0]) && /^[A-ZÅÄÖ]/.test(parts[1])) {
          parts = parts.slice(1);
        }
        expansion = parts.join(" ");

        // Enbokstavsförkortningar och sådana som är längre än sin förklaring
        // är nästan alltid felmatchningar.
        if (abbreviation.length < 2 || expansion.length <= abbreviation.length + 3) continue;

        counts.set(abbreviation, counts.get(abbreviation) ?? new Map());
        const forAbbreviation = counts.get(abbreviation)!;
        forAbbreviation.set(expansion, (forAbbreviation.get(expansion) ?? 0) + 1);
      }
    }
  }

  // En förkortning kan fångas med flera olika formuleringar. Den vanligaste
  // vinner, den är oftast den korrekta benämningen snarare än en bisats.
  const glossary: Record<string, string> = {};
  for (const [abbreviation, expansions] of counts) {
    // Varje förkortning definieras oftast på exakt ett ställe i arkivet, så
    // vi kan inte kräva upprepning. Vid flera formuleringar vinner den
    // vanligaste.
    const [best] = [...expansions].sort((a, b) => b[1] - a[1])[0];
    glossary[abbreviation] = best;
  }

  const sorted = Object.fromEntries(Object.entries(glossary).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(OUTPUT, JSON.stringify(sorted, null, 2) + "\n", "utf8");

  console.log(`${Object.keys(sorted).length} förkortningar skrivna till ${OUTPUT}:\n`);
  for (const [abbreviation, expansion] of Object.entries(sorted)) {
    console.log(`  ${abbreviation.padEnd(6)} ${expansion}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
