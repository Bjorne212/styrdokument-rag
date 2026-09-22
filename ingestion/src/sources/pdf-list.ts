/**
 * Källtyp "pdf-list": en handskriven lista med PDF-adresser i kar.config.json.
 *
 * För arkiv som inte går att läsa av automatiskt, till exempel dokument som
 * ligger utspridda på flera sidor eller i en molntjänst med publika länkar.
 * Nackdelen är att listan måste hållas uppdaterad för hand.
 *
 * Fingeravtrycket byggs av varje fils ETag eller Last-Modified. Saknar någon
 * fil båda returneras null, och då laddas sektionen ner och hashas varje
 * gång. Det fungerar, men kostar lite mer tid i det schemalagda jobbet.
 */

import type { PdfListSource } from "../../../shared/config.ts";
import { decodedPath, fileName, USER_AGENT, type ArchiveSource } from "./types.ts";

export function pdfListSource(config: PdfListSource): ArchiveSource {
  const find = (sectionId: string) => config.sections.find((section) => section.id === sectionId)!;

  return {
    sections: config.sections,

    async listDocuments(sectionId) {
      const section = find(sectionId);
      return section.documents.map((entry) => {
        const url = new URL(entry.url).href;
        const path = decodedPath(url);
        return {
          section: section.id,
          sectionLabel: section.label,
          title: entry.title ?? fileName(url),
          path,
          url,
          uploaded: "",
          id: `${section.id}/${path}`,
        };
      });
    },

    async fingerprint(sectionId) {
      const parts: string[] = [];
      for (const entry of find(sectionId).documents) {
        const response = await fetch(entry.url, {
          method: "HEAD",
          headers: { "user-agent": USER_AGENT },
        });
        const marker = response.headers.get("etag") ?? response.headers.get("last-modified");
        if (!response.ok || !marker) return null;
        parts.push(marker);
      }
      return parts.join("|");
    },
  };
}
