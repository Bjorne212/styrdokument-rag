/**
 * Mäter vad chunkstorleken kostar och ger.
 *
 * Chunkstorleken är systemets viktigaste inställning, och den går inte att
 * resonera sig fram till: den beror på hur just de här dokumenten är skrivna.
 * Det här verktyget kör chunkningen i flera storlekar mot hela arkivet och
 * visar följderna: antal vektorer, hur nära gratisgränsen det tar oss, hur
 * mycket kontext varje fråga kostar, och om ett känt svar överlever helt
 * inuti en chunk eller klipps mitt itu.
 *
 * Ingen embedding sker här, så det kostar ingenting att köra.
 *
 * Kör:  node src/tune.ts
 *       node src/tune.ts 400 800 1200 2000
 */

import { chunkDocument } from "../../ingestion/src/chunk.ts";
import { extractDocument } from "../../ingestion/src/extract.ts";
import { scrapeArchive } from "../../ingestion/src/scrape.ts";

/** Gratisgräns för lagrade dimensioner i Vectorize. */
const STORAGE_LIMIT = 5_000_000;
const DIMENSIONS = 1024;

/** Neurons per miljon tokens för llama-3.3-70b-fp8-fast. */
const INPUT_NEURONS = 26_668;
const OUTPUT_NEURONS = 204_805;
const DAILY_NEURONS = 10_000;

/** Antal stycken som skickas med till modellen per fråga. */
const TOP_K = 8;
/** Ungefärligt antal tecken per token för svensk text. */
const CHARS_PER_TOKEN = 3.5;
/** Systemprompten plus frågan. */
const FIXED_TOKENS = 350;
/** Typiskt svar. */
const OUTPUT_TOKENS = 300;

/**
 * En formulering vi vet är svaret på en vanlig fråga. Om den ligger hel inuti
 * en chunk kan sökningen hitta den; är den kluven mellan två chunkar blir båda
 * halvorna sämre träffar.
 */
const PROBES = [
  "Kårstyrelsen består av styrelseordförande, presidiet samt ytterligare 2-4 ledamöter",
  "Ledamot i kårstyrelsen får inte under samma verksamhetsår vara ledamot i kårfullmäktige",
];

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

/**
 * Mäter hur ofta överlappet räddar sammanhanget.
 *
 * Skadan ett chunkbrott gör är att två meningar som hör ihop hamnar i varsin
 * chunk: då finns svaret ingenstans i sin helhet. Vi tar därför stickprov på
 * intilliggande radpar ur den städade texten och räknar hur stor andel som
 * hålls samman i minst en chunk. Det är precis vad överlappet ska åstadkomma,
 * så det är också det som ska mätas.
 */
async function measureOverlap(
  extracted: { doc: any; pages: string[] }[],
  targetChars: number,
): Promise<void> {
  const { cleanPages } = await import("./chunk.ts");

  // Bygg stickprovet: varje 40:e intilliggande radpar, jämnt fördelat över
  // hela arkivet. Deterministiskt, så siffrorna går att jämföra mellan körningar.
  const pairs: { docIndex: number; a: string; b: string }[] = [];
  extracted.forEach(({ pages }, docIndex) => {
    const lines = cleanPages(pages);
    for (let i = 0; i + 1 < lines.length; i += 40) {
      if (lines[i].text.length > 40 && lines[i + 1].text.length > 40) {
        pairs.push({ docIndex, a: lines[i].text, b: lines[i + 1].text });
      }
    }
  });

  console.log(`\nSammanhang: ${pairs.length} intilliggande radpar, målstorlek ${targetChars} tecken\n`);
  console.log("överlapp  chunkar  lagring      andel av  par som hålls samman");
  console.log("-".repeat(66));

  for (const overlapChars of [0, 75, 150, 225, 300]) {
    const byDoc = extracted.map(({ doc, pages }) =>
      chunkDocument(doc, pages, { targetChars, overlapChars }),
    );
    const chunkCount = byDoc.reduce((sum, chunks) => sum + chunks.length, 0);
    const storedDims = chunkCount * DIMENSIONS;

    let together = 0;
    for (const pair of pairs) {
      const texts = byDoc[pair.docIndex].map((chunk) => chunk.text);
      if (texts.some((text) => text.includes(pair.a) && text.includes(pair.b))) together++;
    }

    const percent = ((together / pairs.length) * 100).toFixed(1);
    const share = ((storedDims / STORAGE_LIMIT) * 100).toFixed(0);
    console.log(
      `${String(overlapChars).padStart(8)}  ${String(chunkCount).padStart(7)}  ${storedDims.toLocaleString("sv-SE").padStart(9)}  ${(share + " %").padStart(8)}  ${percent.padStart(6)} %`,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const overlapIndex = args.indexOf("--overlap");
  const sizes = args.filter((arg) => !arg.startsWith("--")).map(Number).filter((size) => size > 0);
  const targets = sizes.length ? sizes : [400, 600, 900, 1200, 1800];

  console.log("Läser arkivet ...\n");
  const documents = await scrapeArchive();
  const extracted = [];
  for (const doc of documents) {
    extracted.push({ doc, pages: (await extractDocument(doc)).pages });
  }

  // --overlap <storlek>: mät överlappet i stället för chunkstorleken.
  if (overlapIndex !== -1) {
    await measureOverlap(extracted, Number(args[overlapIndex + 1]) || 900);
    return;
  }

  console.log(
    "storlek  chunkar  snitt  överlapp  lagring        andel av  kontext   neurons  frågor",
  );
  console.log(
    "                                                  gratis    /fråga    /fråga   /dygn",
  );
  console.log("-".repeat(88));

  const probeResults: Record<number, number> = {};

  for (const targetChars of targets) {
    const chunks = extracted.flatMap(({ doc, pages }) => chunkDocument(doc, pages, { targetChars }));

    const totalChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
    const avgChars = Math.round(totalChars / chunks.length);
    const storedDims = chunks.length * DIMENSIONS;

    // Överlappet syns som att chunkarna tillsammans är längre än originaltexten.
    const uniqueChars = extracted.reduce(
      (sum, { doc, pages }) =>
        sum + chunkDocument(doc, pages, { targetChars, overlapChars: 0 }).reduce((s, c) => s + c.text.length, 0),
      0,
    );
    const overlapPercent = Math.round((totalChars / uniqueChars - 1) * 100);

    const contextTokens = Math.round((TOP_K * avgChars) / CHARS_PER_TOKEN) + FIXED_TOKENS;
    const neurons =
      (contextTokens / 1e6) * INPUT_NEURONS + (OUTPUT_TOKENS / 1e6) * OUTPUT_NEURONS;
    const perDay = Math.round(DAILY_NEURONS / neurons);

    // Överlever de kända formuleringarna som hela stycken?
    const intact = PROBES.filter((probe) =>
      chunks.some((chunk) => normalizeForCompare(chunk.text).includes(normalizeForCompare(probe))),
    ).length;
    probeResults[targetChars] = intact;

    const share = ((storedDims / STORAGE_LIMIT) * 100).toFixed(0);
    const overLimit = storedDims > STORAGE_LIMIT ? "  ÖVER GRÄNSEN" : "";

    console.log(
      `${String(targetChars).padStart(6)}   ${String(chunks.length).padStart(6)}  ${String(avgChars).padStart(5)}  ${String(overlapPercent + " %").padStart(8)}  ${storedDims.toLocaleString("sv-SE").padStart(11)}  ${(share + " %").padStart(8)}  ${String(contextTokens).padStart(6)}t  ${neurons.toFixed(0).padStart(7)}  ${String(perDay).padStart(6)}${overLimit}`,
    );
  }

  console.log("\nÖverlever kända svarsformuleringar som hela stycken?");
  for (const [size, intact] of Object.entries(probeResults)) {
    console.log(`  ${String(size).padStart(4)} tecken: ${intact} av ${PROBES.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
