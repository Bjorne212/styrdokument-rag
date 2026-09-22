/**
 * Gemensamma typer för alla källtyper.
 *
 * En källa behöver bara kunna två saker: lista dokumenten i en sektion, och
 * ge ett billigt fingeravtryck av sektionen. Fingeravtrycket är det som gör
 * det schemalagda jobbet gratis när ingenting hänt: är det oförändrat sedan
 * förra körningen laddas inga PDF:er ner alls.
 */

import { kar } from "../../../shared/config.ts";

export type ArchiveDocument = {
  /** Sektionens id, t.ex. "allmant". */
  section: string;
  /** Läsbart sektionsnamn, t.ex. "Allmänt". */
  sectionLabel: string;
  /** Filnamn eller länktext som det visas i arkivet, t.ex. "Reglemente.pdf". */
  title: string;
  /** Sökväg som identifierar filen inom sektionen, t.ex. "pdf/Reglemente.pdf". */
  path: string;
  /** Fullständig, procent-kodad URL till PDF:en. */
  url: string;
  /** Uppladdningsdatum (YYYY-MM-DD) om arkivet anger ett, annars tom sträng. */
  uploaded: string;
  /**
   * Stabil identitet för dokumentet genom hela pipelinen.
   * Används som underlag för vektor-id:n i Vectorize.
   */
  id: string;
};

export type ArchiveSource = {
  sections: { id: string; label: string }[];
  /** Alla dokument i en sektion. Ska kasta hellre än att tyst returnera en tom lista. */
  listDocuments(sectionId: string): Promise<ArchiveDocument[]>;
  /**
   * Något som ändras när sektionens innehåll ändras, t.ex. en ETag.
   * null betyder "vet inte", och då granskas sektionen varje gång.
   */
  fingerprint(sectionId: string): Promise<string | null>;
};

export const USER_AGENT = `${kar.cloudflare.workerName} (styrdokument-rag)`;

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} för ${url}`);
  }
  return response.text();
}

/** Procent-kodar varje del av en sökväg. Filnamnen har ofta mellanslag och å, ä, ö. */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Sökvägen i en URL, avkodad och utan inledande snedstreck. */
export function decodedPath(url: string): string {
  return decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
}

/** Filnamnet sist i en URL, avkodat. */
export function fileName(url: string): string {
  return decodedPath(url).split("/").pop() || url;
}
