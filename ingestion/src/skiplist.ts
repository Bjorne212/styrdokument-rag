/**
 * Dokument som medvetet inte indexeras.
 *
 * Arkivet innehåller 39 dokument som är översättningar av ett annat dokument
 * som redan finns i indexet (Bylaw är Stadgan, Regulations är Reglementet, och
 * så vidare). Båda versionerna konkurrerar annars om de åtta platser som
 * skickas till modellen, vilket gör svaren sämre: ett svar som citerar samma
 * regel två gånger på olika språk ser slarvigt ut och halverar den användbara
 * kontexten.
 *
 * Listan är genererad av `node src/duplicates.ts`, som parar ihop dokumenten
 * på innehåll i stället för filnamn: "Stadga" och "Bylaw" delar inte ett enda
 * ord, men deras texter ligger nära varandra eftersom bge-m3 är flerspråkig.
 *
 * Listan är avsiktligt en fil man kan öppna och rätta i. Blir en parning fel
 * går den att ta bort för hand utan att röra koden.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PATH = join(import.meta.dirname, "../duplicates.json");

let cached: Set<string> | null = null;

export async function loadSkipList(): Promise<Set<string>> {
  if (cached) return cached;

  try {
    const raw = JSON.parse(await readFile(PATH, "utf8")) as { skip?: string[] };
    cached = new Set(raw.skip ?? []);
  } catch {
    // Ingen lista ännu: indexera allt.
    cached = new Set();
  }

  return cached;
}
