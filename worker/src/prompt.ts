/**
 * Prompten (the "A" i RAG: augmented).
 *
 * Modellen får inte svara ur eget minne. Den får de hämtade styckena och
 * instruktionen att hålla sig till dem. Det är skillnaden mellan en chattbot
 * som låter övertygande och en som faktiskt går att lita på i en
 * föreningskontext: hellre "det står inte i dokumenten" än ett påhittat svar
 * om vad stadgan säger.
 */

import { kar } from "../../shared/config.ts";
import type { Exchange } from "./history.ts";
import type { RetrievedChunk } from "./retrieve.ts";

const SYSTEM_PROMPT = `Du är en assistent som svarar på frågor om ${kar.nameGenitive} styrande dokument. ${kar.name} är ${kar.description}.

Regler du alltid följer:

1. Svara ENDAST utifrån de dokumentutdrag du får. Använd aldrig egen kunskap om studentkårer, föreningar eller lagstiftning.
2. Står svaret inte i utdragen: säg det rakt ut, till exempel "Det framgår inte av de styrdokument jag har tillgång till." Gissa aldrig.
3. Hänvisa alltid till källan i löptexten, med dokumentets namn och avsnitt när det finns: "Enligt Reglemente, avsnitt 4.2 ...". Skriv aldrig "utdrag", "stycke 1" eller liknande. Läsaren ser bara ditt svar, inte materialet du fått.
4. Citerar du en formulering ordagrant, sätt den inom citattecken.
5. Svara på samma språk som frågan ställdes på. Utdragen kan vara på svenska eller engelska oavsett frågans språk.
6. Var koncis. Ett stycke räcker oftast. Punktlista när svaret har flera delar.
7. Motsäger utdragen varandra, säg det och redovisa båda uppgifterna med sina källor.
8. Det sista meddelandet innehåller den AKTUELLA frågan. Tidigare meddelanden finns bara med som sammanhang, så att korta följdfrågor ("vad beslutades?", "vad ansvarar den för?") går att tolka. Besvara aldrig en tidigare fråga igen, svara på den aktuella, med den tidigare frågan som tolkningsnyckel.`;

/**
 * Formaterar de hämtade styckena så att modellen ser var varje bit kommer ifrån.
 *
 * Utdragen numreras inte. Med numrering skrev modellen "Enligt Utdrag 1,
 * Reglemente.pdf ...", en intern etikett som är meningslös för läsaren.
 * Källan står i stället som en rubrik med dokumentnamn och avsnitt, alltså
 * precis den form hänvisningen ska ha i svaret.
 */
function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk) => {
      const heading = chunk.heading ? `, avsnitt ${chunk.heading}` : "";
      return `### ${chunk.title}${heading} (${chunk.sectionLabel}, sida ${chunk.page})\n${chunk.text}`;
    })
    .join("\n\n");
}

export function buildMessages(
  question: string,
  chunks: RetrievedChunk[],
  history: Exchange[] = [],
) {
  // Tidigare utbyten läggs in som riktiga turer i samtalet, inte som text
  // inuti frågan, då vet modellen vad den själv sagt och kan hänvisa till det.
  const priorTurns = history.flatMap((exchange) => [
    { role: "user", content: exchange.question },
    { role: "assistant", content: exchange.answer },
  ]);

  if (chunks.length === 0) {
    return [
      { role: "system", content: SYSTEM_PROMPT },
      ...priorTurns,
      {
        role: "user",
        content: `Fråga: ${question}\n\nInga dokumentutdrag matchade frågan. Svara att du inte hittar något om detta i ${kar.nameGenitive} styrdokument, och föreslå gärna hur frågan kan omformuleras.`,
      },
    ];
  }

  // Vid en följdfråga behöver den aktuella frågan sticka ut mot allt annat i
  // meddelandet. Utan det fortsätter mindre modeller hellre det förra spåret
  // och besvarar föregående fråga en gång till.
  const askedNow = history.length
    ? `AKTUELL FRÅGA (det är denna, och endast denna, du ska besvara): ${question}\n\n` +
      `Sammanhang: frågan är en följdfråga till "${history[history.length - 1].question}". ` +
      `Använd den bara för att förstå vad korta ord som "den" eller "det" syftar på.`
    : `Fråga: ${question}`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...priorTurns,
    {
      role: "user",
      content: `Dokumentutdrag:\n\n${formatContext(chunks)}\n\n---\n\n${askedNow}`,
    },
  ];
}
