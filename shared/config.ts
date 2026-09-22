/**
 * Kårens konfiguration, läst ur kar.config.json i repots rot.
 *
 * Det här är det enda stället som vet vilken kår instansen tillhör. Både
 * ingestionen, Workern och gränssnittet importerar härifrån, så att byta kår
 * betyder att byta en JSON-fil, inte att leta upp namn utspridda i koden.
 *
 * Filen importeras på samma sätt i Node (ingestion, local), i Wrangler
 * (Workern) och i Vite (gränssnittet): alla tre klarar JSON-importer med
 * import-attribut.
 */

import raw from "../kar.config.json" with { type: "json" };

export type SectionConfig = {
  /** Kort id, används i vektor-id:n och cachesökvägar. Byt inte i efterhand. */
  id: string;
  /** Läsbart namn, visas i källhänvisningarna. */
  label: string;
};

/** LinTek-formatet: GitLab Pages med en document-appender.js per sektion. */
export type GitlabAppenderSource = {
  type: "gitlab-appender";
  baseUrl: string;
  sections: SectionConfig[];
};

/** En vanlig webbsida per sektion, där PDF:erna är länkade med <a href>. */
export type HtmlLinksSource = {
  type: "html-links";
  sections: (SectionConfig & { url: string })[];
};

/** En handskriven lista med PDF-adresser, för arkiv som inte går att läsa av. */
export type PdfListSource = {
  type: "pdf-list";
  sections: (SectionConfig & { documents: { url: string; title?: string }[] })[];
};

export type SourceConfig = GitlabAppenderSource | HtmlLinksSource | PdfListSource;

export type KarConfig = {
  /** Kort id i gemener, t.ex. "lintek". */
  id: string;
  /** Kårens namn som det skrivs i löptext, t.ex. "LinTek". */
  name: string;
  /** Genitivform, t.ex. "LinTeks". Svenska genitiver är för oregelbundna att gissa. */
  nameGenitive: string;
  /** Fortsättning på "<name> är ...", används i systemprompten. */
  description: string;
  /** Vad boten heter i gränssnittet. */
  botName: string;
  /** Länk till arkivet där människor själva kan läsa dokumenten. */
  documentsUrl: string;
  author: { name: string; url: string };
  cloudflare: { workerName: string; indexName: string };
  source: SourceConfig;
  cleanup: {
    /** Textbitar ur sidhuvuden och sidfötter. Rader som innehåller någon av dem tas bort. */
    boilerplate: string[];
    /** Extra ord som bara förekommer i svensk text, för språkgissningen. */
    swedishMarkers: string[];
  };
};

export const kar = raw as KarConfig;
