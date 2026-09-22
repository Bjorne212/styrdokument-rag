/**
 * Tunn klient mot de två Cloudflare-API:er som ingestionen behöver:
 * Workers AI (för att göra text till vektorer) och Vectorize (för att lagra dem).
 *
 * Den här filen körs i GitHub Actions, alltså utanför Cloudflare. Därför går
 * anropen över REST med en API-token, till skillnad från Workern som får
 * direkta bindings.
 *
 * Miljövariabler som krävs:
 *   CLOUDFLARE_ACCOUNT_ID   – syns i Cloudflare-dashboarden
 *   CLOUDFLARE_API_TOKEN    – token med behörigheterna Workers AI: Read
 *                             och Vectorize: Edit
 *   VECTORIZE_INDEX         – indexets namn (valfri, annars cloudflare.indexName
 *                             i kar.config.json)
 */

import { kar } from "../../shared/config.ts";

/** Embeddingmodell. bge-m3 är flerspråkig och klarar svenska. 1024 dimensioner. */
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;

export type CloudflareConfig = {
  accountId: string;
  apiToken: string;
  indexName: string;
};

export function configFromEnv(): CloudflareConfig {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error(
      "Saknar CLOUDFLARE_ACCOUNT_ID och/eller CLOUDFLARE_API_TOKEN. " +
        "Lokalt: lägg dem i ingestion/.env och kör med `node --env-file=.env`. " +
        "I CI: lägg dem som repository secrets.",
    );
  }

  return {
    accountId,
    apiToken,
    indexName: process.env.VECTORIZE_INDEX ?? kar.cloudflare.indexName,
  };
}

const API_BASE = "https://api.cloudflare.com/client/v4";

async function callApi(
  config: CloudflareConfig,
  path: string,
  init: RequestInit & { body?: BodyInit },
): Promise<any> {
  const response = await fetch(`${API_BASE}/accounts/${config.accountId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Cloudflare API ${response.status} på ${path}: ${text.slice(0, 500)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Kunde inte tolka svaret från ${path}: ${text.slice(0, 200)}`);
  }
}

/**
 * Gör om texter till vektorer.
 *
 * Vi skickar flera texter per anrop: det är både snabbare och billigare än
 * ett anrop per chunk, eftersom kostnaden räknas på tokens och inte på anrop.
 */
export async function embed(config: CloudflareConfig, texts: string[]): Promise<number[][]> {
  const result = await callApi(config, `/ai/run/${EMBEDDING_MODEL}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: texts }),
  });

  const vectors: number[][] | undefined = result?.result?.data;
  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new Error(
      `Oväntat svar från ${EMBEDDING_MODEL}: fick ${vectors?.length ?? "inga"} vektorer för ${texts.length} texter`,
    );
  }

  return vectors;
}

export type VectorRecord = {
  id: string;
  values: number[];
  metadata: Record<string, unknown>;
};

/**
 * Skriver vektorer till indexet.
 *
 * Vectorize tar emot NDJSON: en JSON-rad per vektor, inte en vanlig
 * JSON-array. Upsert betyder att befintliga id:n skrivs över, vilket är precis
 * vad vi vill när ett dokument uppdaterats.
 */
export async function upsertVectors(
  config: CloudflareConfig,
  vectors: VectorRecord[],
): Promise<void> {
  if (vectors.length === 0) return;

  const ndjson = vectors.map((vector) => JSON.stringify(vector)).join("\n");

  await callApi(config, `/vectorize/v2/indexes/${config.indexName}/upsert`, {
    method: "POST",
    headers: { "content-type": "application/x-ndjson" },
    body: ndjson,
  });
}

/** Tar bort vektorer, t.ex. när ett dokument försvunnit ur arkivet. */
export async function deleteVectors(config: CloudflareConfig, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  await callApi(config, `/vectorize/v2/indexes/${config.indexName}/delete_by_ids`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

export type QueryMatch = {
  id: string;
  score: number;
  metadata?: Record<string, string | number>;
};

/**
 * Söker i indexet. Används av sökverktyget för att kunna kontrollera
 * träffkvaliteten utan att behöva deploya Workern.
 */
export async function queryVectors(
  config: CloudflareConfig,
  vector: number[],
  topK = 5,
): Promise<QueryMatch[]> {
  const result = await callApi(config, `/vectorize/v2/indexes/${config.indexName}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vector, topK, returnMetadata: "all" }),
  });

  return result?.result?.matches ?? [];
}

/** Hämtar indexets konfiguration. Används för att kontrollera att det finns och har rätt dimensioner. */
export async function describeIndex(config: CloudflareConfig): Promise<any> {
  const result = await callApi(config, `/vectorize/v2/indexes/${config.indexName}`, {
    method: "GET",
  });
  return result?.result;
}
