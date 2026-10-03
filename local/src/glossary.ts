/**
 * Expanderar förkortningar i frågan innan den embeddas.
 *
 * "SA" är två bokstäver som betyder nästan ingenting för en embeddingmodell,
 * medan "Studiesocialt ansvariga" bär massor av betydelse. Genom att lägga
 * till den fullständiga benämningen i söktexten får sökningen det innehållet
 * utan att kosta ett enda extra anrop.
 *
 * Endast söktexten expanderas: frågan som visas för modellen lämnas orörd, så
 * att svaret inte låter som om användaren skrivit något annat än hen gjorde.
 *
 * Ordlistan genereras ur dokumenten med `npm run glossary` och skrivs till
 * local/out/glossary.json. Den är inte handskriven: ändras dokumenten körs
 * verktyget om.
 *
 * ANVÄNDS INTE av Workern. Uppmätt effekt på utvärderingen var negativ: MRR
 * föll från 0,605 till 0,576. Orsaken är att en expanderad fråga ("Vad står SA
 * för? SA = Studiesocialt ansvariga") börjar likna alla stycken som
 * *beskriver* SA i stället för det enda som *definierar* förkortningen.
 *
 * Modulen ligger därför bland verktygen i local/, där mätningen går att göra
 * om (`npm run glossary:compare`). Den kan bli användbar den dag
 * nyckelordssökning (D1/FTS5) läggs till: där matchas ord ordagrant, och då
 * är det en fördel att ha både förkortningen och dess fulltext i söksträngen.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const GLOSSARY_PATH = join(import.meta.dirname, "../out/glossary.json");

/** Läser ordlistan som `npm run glossary` skrivit. */
export async function loadGlossary(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(GLOSSARY_PATH, "utf8")) as Record<string, string>;
  } catch {
    throw new Error(`Hittar ingen ordlista i ${GLOSSARY_PATH}. Kör npm run glossary först.`);
  }
}

/**
 * Förkortningar matchas skiftlägeskänsligt och bara som hela ord.
 *
 * "SA" ska träffa i "Vad står SA för?" men inte inuti "SAmarbete", och inte
 * heller i ordet "sa", därav både ordgränser och skiftläge.
 */
export function expandAbbreviations(text: string, abbreviations: Record<string, string>): string {
  const found: string[] = [];

  for (const [abbreviation, expansion] of Object.entries(abbreviations)) {
    const pattern = new RegExp(`(?<![\\p{L}])${abbreviation}(?![\\p{L}])`, "u");
    if (pattern.test(text) && !text.toLowerCase().includes(expansion.toLowerCase())) {
      found.push(`${abbreviation} = ${expansion}`);
    }
  }

  return found.length ? `${text}\n${found.join(". ")}` : text;
}
