/**
 * Väljer källtyp utifrån kar.config.json.
 *
 * Ny källtyp: skriv en fil i den här mappen som returnerar en ArchiveSource,
 * lägg till typen i shared/config.ts och en rad i switchen nedan.
 */

import { kar, type SourceConfig } from "../../../shared/config.ts";
import { gitlabAppenderSource } from "./gitlab-appender.ts";
import { htmlLinksSource } from "./html-links.ts";
import { pdfListSource } from "./pdf-list.ts";
import type { ArchiveSource } from "./types.ts";

export type { ArchiveDocument, ArchiveSource } from "./types.ts";

export function createSource(config: SourceConfig): ArchiveSource {
  switch (config.type) {
    case "gitlab-appender":
      return gitlabAppenderSource(config);
    case "html-links":
      return htmlLinksSource(config);
    case "pdf-list":
      return pdfListSource(config);
    default:
      throw new Error(`Okänd källtyp "${(config as { type: string }).type}" i kar.config.json.`);
  }
}

/** Källan som den här instansen är konfigurerad för. */
export const source = createSource(kar.source);
