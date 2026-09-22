/**
 * Steg 3 i pipelinen: städa texten och dela den i chunkar.
 *
 * Varför chunkar? En embedding är en vektor som representerar *en* betydelse.
 * Kör man ett helt 21-sidigt reglemente genom en embeddingmodell blir vektorn
 * ett genomsnitt av allt dokumentet handlar om, och matchar då ingenting
 * särskilt bra. Delar man istället upp texten i stycken på några hundra ord
 * får varje bit en egen, skarp betydelse, och sökningen kan plocka fram
 * exakt det avsnitt som svarar på frågan.
 *
 * Städningen som sker här bygger på vad vi faktiskt såg i dokumenten i steg 2:
 * återkommande sidhuvuden/sidfötter, innehållsförteckningar med punktledare,
 * och avstavning över radbrytningar.
 *
 * Kör:  node src/chunk.ts --limit 5          (kvalitetsrapport)
 *       node src/chunk.ts --show Reglemente  (skriv ut några chunkar)
 */

import { createHash } from "node:crypto";
import { kar } from "../../shared/config.ts";
import { extractDocument, normalize } from "./extract.ts";
import { scrapeArchive, type ArchiveDocument } from "./scrape.ts";

/**
 * Ungefärlig målstorlek per chunk, i tecken.
 *
 * ~1200 tecken är runt 300 ord: stort nog att rymma ett helt resonemang
 * (en paragraf i reglementet med sina underpunkter), litet nog att inte
 * dränka det viktiga i brus.
 *
 * Valt genom mätning mot utvärderingsuppsättningen (`node src/experiments.ts`),
 * inte på känsla, och efter att en tidigare gissning visat sig fel:
 *
 *   600 tecken:   träffsäkerhet 70 %, MRR 0,435
 *   900 tecken:   träffsäkerhet 95 %, MRR 0,548
 *   1200 tecken:  träffsäkerhet 95 %, MRR 0,605
 *
 * Mindre chunkar ser bättre ut på strukturmått (fler frågor per dygn, mindre
 * lagring) men hittar sämre. Ett stycke behöver tillräckligt med sammanhang
 * för att dess vektor ska betyda något.
 */
const TARGET_CHARS = 1200;

/**
 * Hur mycket text som upprepas mellan två chunkar.
 *
 * Utan överlapp splittras 8,5 % av alla intilliggande radpar mellan två
 * chunkar, och då finns resonemanget ingenstans i sin helhet. Med 75 tecken
 * hålls 100 % samman. Dokumentens rader är omkring 110 tecken, så 75 betyder
 * i praktiken "ta med föregående rad". Mer än så räddar inga fler meningar
 * men kostar lagring: 150 tecken ger 293 extra chunkar till ingen nytta.
 *
 * Andelen skalar med målstorleken, så ändrad chunkstorlek behåller
 * proportionen i stället för att plötsligt utgöra halva chunken.
 */
const OVERLAP_RATIO = 1 / 12;

export type ChunkOptions = {
  targetChars?: number;
  overlapChars?: number;
};

/**
 * Kort, stabil nyckel för ett dokument.
 *
 * Vectorize tillåter bara 64 bytes per vektor-id, och våra filnamn är långa
 * ("Instructions for working with the science and engineering student
 * sections.pdf" blir 94 bytes med löpnummer). Vi hashar därför dokumentets id
 * och behåller det läsbara namnet i metadatan istället.
 */
export function documentKey(documentId: string): string {
  return createHash("sha256").update(documentId).digest("hex").slice(0, 12);
}

export type Chunk = {
  /** Stabilt id: hashat dokument-id + löpnummer. Max 64 bytes, krav från Vectorize. */
  id: string;
  /** Själva texten som embeddas. */
  text: string;
  /** Metadata som följer med till svaret, för källhänvisningar. */
  metadata: {
    documentId: string;
    title: string;
    section: string;
    sectionLabel: string;
    url: string;
    /** Närmaste föregående rubrik, t.ex. "1.2 Reglementesändringar". */
    heading: string | null;
    /** Sidan chunken börjar på, för hänvisningar. */
    page: number;
    /** "sv" eller "en", dokumenten finns ofta i båda språkversionerna. */
    lang: "sv" | "en";
  };
};

/**
 * Texten som faktiskt embeddas: inte samma sak som texten som visas.
 *
 * Chunkens egen text säger ofta inte vad den handlar om. En rad ur
 * ändringshistoriken ("250506 Kårfullmäktigemöte 8 Proposition angående
 * Placeringar 6.3") nämner varken "reglementet" eller "historik", trots att
 * det är exakt det en fråga om saken skulle innehålla. Dokumentets namn och
 * närmaste rubrik finns i metadatan men påverkar inte vektorn, om de inte
 * skrivs in i texten som embeddas.
 *
 * Tankstrecket i formatet är avsiktligt och får inte ändras: de 914 vektorer
 * som ligger i indexet är beräknade på exakt den här strängen.
 *
 * Metadatans `text` behålls oförändrad, så modellen får rent innehåll att
 * citera medan sökningen får sammanhanget.
 */
export function embeddingText(chunk: Chunk): string {
  const title = chunk.metadata.title.replace(/\.pdf$/i, "");
  const heading = chunk.metadata.heading ? ` — ${chunk.metadata.heading}` : "";
  return `${title}${heading} (${chunk.metadata.sectionLabel})\n${chunk.text}`;
}

/** Rader som ser ut som sidnummer: "3 (21)". */
const PAGE_NUMBER = /^\d+\s*\(\d+\)$/;
/** Rader som bara är ett datum. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Innehållsförteckningsrader med punktledare: "6.10 Motion . . . . . 13". */
const TOC_LINE = /\.\s?\.\s?\.\s?\./;

/**
 * Innehållsförteckningsrader utan punktledare: "1 Arbetsbeskrivningar 4".
 *
 * Avsnittsnummer, rubriktext, och ett sidnummer sist. Kravet på högst två
 * siffror per nivå är det som skiljer dem från ändringshistorikens rader
 * ("160503 Kårfullmäktigemöte 8 Representationsutredning [2016] 4"), som
 * också börjar med siffror och slutar med en siffra, men vars datumkod har
 * sex siffror. Verifierat mot arkivet: 391 träffar, varav noll i historiken.
 */
const TOC_ENTRY = /^\d{1,2}(?:\.\d{1,2}){0,3}\s+\p{Lu}.*\s+\d{1,3}$/u;
/**
 * Rubriker: "1 Inledning", "1.2 Reglementesändringar", "4.2.1 Något".
 *
 * Numret får ha högst två siffror per nivå, och rubriktexten måste börja med
 * versal. Utan de kraven fastnar rader ur ändringshistoriken ("140506
 * Kårfullmäktigemöte 10 ...") i samma mönster och blir felaktiga rubriker.
 */
const HEADING = /^\d{1,2}(?:\.\d{1,2}){0,3}\s+\p{Lu}/u;

/**
 * Rader ur kårens sidhuvud och sidfot, från cleanup.boilerplate i
 * kar.config.json. De står på varje sida i varje dokument och skulle annars
 * bli den mest välrepresenterade texten i hela indexet.
 */
const FOOTER_FRAGMENTS = kar.cleanup.boilerplate;

function isBoilerplate(line: string): boolean {
  if (line.length === 0) return true;
  if (PAGE_NUMBER.test(line)) return true;
  if (BARE_DATE.test(line)) return true;
  if (TOC_LINE.test(line)) return true;
  if (TOC_ENTRY.test(line)) return true;
  return FOOTER_FRAGMENTS.some((fragment) => line.includes(fragment));
}

/**
 * Sätter ihop ord som avstavats över en radbrytning: "styrdoku-\nment".
 *
 * Vi gör det bara när nästa rad börjar med gemen bokstav, annars riskerar vi
 * att slå ihop ett legitimt bindestreck i slutet av en rad ("Mål- och...").
 */
function dehyphenate(text: string): string {
  return text.replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2");
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Vanliga svenska ord, plus kårens egna från cleanup.swedishMarkers. */
const SWEDISH_MARKERS = new RegExp(
  `\\b(${["och", "att", "för", "som", "är", "inte", "ska", ...kar.cleanup.swedishMarkers]
    .map(escapeRegExp)
    .join("|")})\\b`,
  "gi",
);

/** Gissar språk utifrån vanliga svenska ord. Dokumenten är antingen sv eller en. */
function detectLanguage(text: string): "sv" | "en" {
  const swedishMarkers = SWEDISH_MARKERS;
  const englishMarkers = /\b(and|the|shall|of|for|that|is|not)\b/gi;
  const swedish = (text.match(swedishMarkers) ?? []).length;
  const english = (text.match(englishMarkers) ?? []).length;
  return swedish >= english ? "sv" : "en";
}

type CleanLine = { text: string; page: number; heading: string | null };

/**
 * Städar sidorna och returnerar kvarvarande rader, var och en med sidnummer
 * och närmaste föregående rubrik.
 */
export function cleanPages(pages: string[]): CleanLine[] {
  const lines: CleanLine[] = [];
  let currentHeading: string | null = null;

  pages.forEach((rawPage, index) => {
    const page = index + 1;
    const text = dehyphenate(normalize(rawPage));

    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (isBoilerplate(line)) continue;

      // En rubrik är kort: "4.2 Kårstyrelsen", inte en hel paragraf som
      // råkar börja med en siffra.
      if (HEADING.test(line) && line.length < 80) {
        currentHeading = line;
      }

      lines.push({ text: line, page, heading: currentHeading });
    }
  });

  return lines;
}

/**
 * Delar de städade raderna i chunkar om ~TARGET_CHARS tecken med överlapp.
 *
 * Vi bryter hellre vid en rubrik än mitt i ett stycke: en ny rubrik betyder
 * nytt ämne, och då tjänar chunken på att börja där.
 */
export function chunkDocument(
  doc: ArchiveDocument,
  pages: string[],
  options: ChunkOptions = {},
): Chunk[] {
  const targetChars = options.targetChars ?? TARGET_CHARS;
  const overlapChars = options.overlapChars ?? Math.round(targetChars * OVERLAP_RATIO);

  const lines = cleanPages(pages);
  const chunks: Chunk[] = [];

  let buffer: CleanLine[] = [];
  let bufferChars = 0;

  const flush = () => {
    if (buffer.length === 0) return;

    const text = buffer.map((line) => line.text).join("\n").trim();
    if (text.length < 100) {
      // För kort för att bära egen betydelse, oftast en ensam rubrik.
      buffer = [];
      bufferChars = 0;
      return;
    }

    const first = buffer[0];
    chunks.push({
      id: `${documentKey(doc.id)}#${chunks.length}`,
      text,
      metadata: {
        documentId: doc.id,
        title: doc.title,
        section: doc.section,
        sectionLabel: doc.sectionLabel,
        url: doc.url,
        heading: first.heading,
        page: first.page,
        lang: detectLanguage(text),
      },
    });

    // Behåll slutet av chunken som början på nästa, så att sammanhanget
    // inte klipps av mitt i.
    const overlap: CleanLine[] = [];
    let overlapSoFar = 0;
    for (let i = buffer.length - 1; i >= 0 && overlapSoFar < overlapChars; i--) {
      overlap.unshift(buffer[i]);
      overlapSoFar += buffer[i].text.length + 1;
    }

    buffer = overlap;
    bufferChars = overlapSoFar;
  };

  for (const line of lines) {
    const startsNewSection =
      HEADING.test(line.text) && line.text.length < 80 && bufferChars > targetChars / 2;

    if (bufferChars + line.text.length > targetChars || startsNewSection) {
      flush();
    }

    buffer.push(line);
    bufferChars += line.text.length + 1;
  }

  flush();
  return chunks;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex !== -1 ? Number(args[limitIndex + 1]) : Infinity;
  const showIndex = args.indexOf("--show");
  const show = showIndex !== -1 ? args[showIndex + 1] : null;

  const documents = (await scrapeArchive()).slice(0, limit);
  const allChunks: Chunk[] = [];
  let rawChars = 0;
  let cleanedChars = 0;

  for (const doc of documents) {
    const extracted = await extractDocument(doc);
    rawChars += extracted.pages.reduce((sum, page) => sum + page.length, 0);
    cleanedChars += cleanPages(extracted.pages).reduce((sum, line) => sum + line.text.length + 1, 0);
    const chunks = chunkDocument(doc, extracted.pages);
    allChunks.push(...chunks);

    if (show && doc.id.toLowerCase().includes(show.toLowerCase())) {
      for (const chunk of chunks.slice(1, 3)) {
        console.log(`\n${"=".repeat(70)}`);
        console.log(`${chunk.id}  |  sida ${chunk.metadata.page}  |  ${chunk.metadata.lang}`);
        console.log(`rubrik: ${chunk.metadata.heading ?? "(ingen)"}`);
        console.log("=".repeat(70));
        console.log(chunk.text);
      }
      console.log();
    }
  }

  const chunkChars = allChunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const withHeading = allChunks.filter((chunk) => chunk.metadata.heading).length;
  const swedish = allChunks.filter((chunk) => chunk.metadata.lang === "sv").length;

  console.log("Sammanfattning");
  console.log(`  Dokument:              ${documents.length}`);
  console.log(`  Chunkar:               ${allChunks.length}`);
  console.log(`  Snittlängd:            ${Math.round(chunkChars / allChunks.length)} tecken`);
  console.log(`  Med rubrik i metadata: ${withHeading} (${Math.round((withHeading / allChunks.length) * 100)} %)`);
  console.log(`  Svenska / engelska:    ${swedish} / ${allChunks.length - swedish}`);
  console.log(
    `  Bortstädat brus:       ${Math.round((1 - cleanedChars / rawChars) * 100)} % av råtexten (sidhuvuden, sidfötter, innehållsförteckningar)`,
  );
  // Överlappet gör att chunkarna tillsammans är längre än den städade texten.
  // Det är avsiktligt, men värt att kunna se storleken på.
  console.log(
    `  Överlapp:              ${Math.round((chunkChars / cleanedChars - 1) * 100)} % extra text (avsiktlig upprepning mellan chunkar)`,
  );
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
