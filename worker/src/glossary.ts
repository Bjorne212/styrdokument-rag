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
 * Ordlistan är genererad ur dokumenten (`node src/glossary-build.ts` i
 * ingestion/), inte handskriven. Ändras dokumenten körs den om.
 *
 * ANVÄNDS INTE av vektorsökningen. Uppmätt effekt på utvärderingen var
 * negativ: MRR föll från 0,605 till 0,576. Orsaken är att en expanderad fråga
 * ("Vad står SA för? SA = Studiesocialt ansvariga") börjar likna alla stycken
 * som *beskriver* SA i stället för det enda som *definierar* förkortningen.
 *
 * Modulen finns kvar för att den blir användbar den dag nyckelordssökning
 * (D1/FTS5) läggs till: där matchas ord ordagrant, och då är det en fördel att
 * ha både förkortningen och dess fulltext i söksträngen. Mät om innan den
 * kopplas på igen, se ingestion/src/compare-glossary.ts.
 */

import glossary from "./glossary.json" with { type: "json" };

const ABBREVIATIONS = glossary as Record<string, string>;

/**
 * Förkortningar matchas skiftlägeskänsligt och bara som hela ord.
 *
 * "SA" ska träffa i "Vad står SA för?" men inte inuti "SAmarbete", och inte
 * heller i ordet "sa", därav både ordgränser och skiftläge.
 */
export function expandAbbreviations(text: string): string {
  const found: string[] = [];

  for (const [abbreviation, expansion] of Object.entries(ABBREVIATIONS)) {
    const pattern = new RegExp(`(?<![\\p{L}])${abbreviation}(?![\\p{L}])`, "u");
    if (pattern.test(text) && !text.toLowerCase().includes(expansion.toLowerCase())) {
      found.push(`${abbreviation} = ${expansion}`);
    }
  }

  return found.length ? `${text}\n${found.join(". ")}` : text;
}
