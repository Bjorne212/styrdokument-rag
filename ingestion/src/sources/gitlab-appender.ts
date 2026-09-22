/**
 * Källtyp "gitlab-appender": LinTeks format.
 *
 * Arkivet är en statisk GitLab Pages-sajt. Varje sektion har en egen sida
 * (t.ex. /allmant/) där dokumenttabellen fylls i av webbläsaren via en
 * JavaScript-fil: /<sektion>/js/document-appender.js
 *
 * Den JS-filen är alltså den egentliga "databasen" vi läser ifrån. Den ser ut
 * ungefär så här:
 *
 *   cell1.innerHTML = ("<a href=\"pdf/Reglemente.pdf\">Reglemente.pdf</a>");
 *   cell2.innerHTML = ("2026-04-17");
 *
 * Ett dokument = en cell1-rad (länk) följd av en cell2-rad (uppladdningsdatum).
 * Vi läser filen rad för rad och parar ihop dem i den ordningen, vilket är
 * mer förlåtande än att försöka matcha allt i ett enda stort regex.
 *
 * GitLab Pages sätter samma ETag på allt innehåll i en sektion, så ett
 * HEAD-anrop mot JS-filen räcker som fingeravtryck för hela sektionen.
 */

import type { GitlabAppenderSource } from "../../../shared/config.ts";
import { encodePath, fetchText, type ArchiveDocument, type ArchiveSource } from "./types.ts";

/** Matchar länkraden och fångar sökväg + synlig text. */
const LINK_ROW = /cell1\.innerHTML\s*=\s*\(\s*"<a href=\\"(.+?)\\">(.*?)<\/a>"\s*\)/;
/** Matchar datumraden och fångar innehållet. */
const DATE_ROW = /cell2\.innerHTML\s*=\s*\(\s*"(.*?)"\s*\)/;

/**
 * Plockar ut dokumenten ur en document-appender.js.
 * Exporterad separat från nedladdningen så att den går att testa på en sträng.
 */
export function parseAppender(
  config: GitlabAppenderSource,
  section: { id: string; label: string },
  source: string,
): ArchiveDocument[] {
  const documents: ArchiveDocument[] = [];
  let pending: { path: string; title: string } | null = null;

  for (const line of source.split("\n")) {
    const link = line.match(LINK_ROW);
    if (link) {
      // Två länkrader i följd betyder att en datumrad saknas. Vi låter den
      // senaste vinna hellre än att para ihop fel dokument med fel datum.
      pending = { path: link[1], title: link[2] || link[1] };
      continue;
    }

    const date = line.match(DATE_ROW);
    if (date && pending) {
      documents.push({
        section: section.id,
        sectionLabel: section.label,
        title: pending.title,
        path: pending.path,
        url: `${config.baseUrl}/${section.id}/${encodePath(pending.path)}`,
        uploaded: date[1].trim(),
        id: `${section.id}/${pending.path}`,
      });
      pending = null;
    }
  }

  return documents;
}

export function gitlabAppenderSource(config: GitlabAppenderSource): ArchiveSource {
  const appenderUrl = (sectionId: string) => `${config.baseUrl}/${sectionId}/js/document-appender.js`;
  const find = (sectionId: string) => config.sections.find((section) => section.id === sectionId)!;

  return {
    sections: config.sections,

    async listDocuments(sectionId) {
      const documents = parseAppender(config, find(sectionId), await fetchText(appenderUrl(sectionId)));
      if (documents.length === 0) {
        // Tom sektion är antagligen ett trasigt antagande om filformatet,
        // inte ett tomt arkiv. Skrik hellre än att tyst tappa dokument.
        throw new Error(
          `Hittade inga dokument i sektionen "${sectionId}". Har formatet på document-appender.js ändrats?`,
        );
      }
      return documents;
    },

    async fingerprint(sectionId) {
      const response = await fetch(appenderUrl(sectionId), { method: "HEAD" });
      return response.headers.get("etag");
    },
  };
}
