/**
 * Källtyp "html-links": en vanlig webbsida per sektion med länkar till PDF:er.
 *
 * Den vanligaste formen av dokumentarkiv: en sida på kårens webbplats där
 * styrdokumenten ligger som en lista med länkar. Varje <a href> som pekar på
 * en .pdf blir ett dokument. Länktexten blir titeln om den finns, annars
 * filnamnet.
 *
 * Fingeravtrycket är en hash av sidans HTML. Läggs ett dokument till, byts ut
 * eller tas bort ändras nästan alltid länkarna på sidan. Byts en PDF ut under
 * exakt samma namn fångas det inte förrän sidan ändras på annat sätt; kör
 * ingestionen med --force om det händer.
 *
 * Sidor som bygger sin lista med JavaScript i webbläsaren syns inte här,
 * eftersom vi läser rå HTML. Använd då "pdf-list", eller skriv en egen
 * källtyp på samma sätt som gitlab-appender.ts.
 */

import { createHash } from "node:crypto";
import type { HtmlLinksSource } from "../../../shared/config.ts";
import { decodedPath, fetchText, fileName, type ArchiveDocument, type ArchiveSource } from "./types.ts";

/** <a ... href="..." ...>text</a>, med citattecken av båda sorterna. */
const ANCHOR = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/** Plockar ut alla PDF-länkar ur en HTML-sida. Exporterad för att kunna testas på en sträng. */
export function parseLinks(
  section: { id: string; label: string },
  pageUrl: string,
  html: string,
): ArchiveDocument[] {
  const seen = new Map<string, ArchiveDocument>();

  for (const [, , rawHref, rawText] of html.matchAll(ANCHOR)) {
    const href = decodeEntities(rawHref.trim());
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (!/\.pdf$/i.test(url.pathname)) continue;

    url.hash = "";
    const path = decodedPath(url.href);
    if (seen.has(path)) continue;

    const text = decodeEntities(rawText.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    seen.set(path, {
      section: section.id,
      sectionLabel: section.label,
      title: text || fileName(url.href),
      path,
      url: url.href,
      uploaded: "",
      id: `${section.id}/${path}`,
    });
  }

  return [...seen.values()];
}

export function htmlLinksSource(config: HtmlLinksSource): ArchiveSource {
  const find = (sectionId: string) => config.sections.find((section) => section.id === sectionId)!;

  return {
    sections: config.sections,

    async listDocuments(sectionId) {
      const section = find(sectionId);
      const documents = parseLinks(section, section.url, await fetchText(section.url));
      if (documents.length === 0) {
        throw new Error(
          `Hittade inga PDF-länkar på ${section.url}. Byggs listan med JavaScript? Använd i så fall "pdf-list".`,
        );
      }
      return documents;
    },

    async fingerprint(sectionId) {
      const html = await fetchText(find(sectionId).url);
      return createHash("sha256").update(html).digest("hex");
    },
  };
}
