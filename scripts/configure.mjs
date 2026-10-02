/**
 * Kontrollerar kar/kar.config.json och skriver worker/wrangler.toml.
 *
 * wrangler.toml kan inte läsa JSON, så Workerns namn och indexets namn måste
 * stå i den filen också. Filen byggs därför ur worker/wrangler.template.toml
 * och checkas inte in: på så sätt ändrar en kårs klon aldrig en fil som
 * mallrepot också ändrar, och uppdateringar från mallen går in utan konflikt.
 *
 * Körs automatiskt före `npm run dev` och `npm run deploy` i worker/, och av
 * deploy-jobbet i GitHub Actions.
 *
 * Kör:  node scripts/configure.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(await readFile(`${root}kar/kar.config.json`, "utf8"));

const problems = [];
const need = (path, value) => {
  if (typeof value !== "string" || value.trim() === "") problems.push(`${path} saknas eller är tom`);
};

need("id", config.id);
need("name", config.name);
need("nameGenitive", config.nameGenitive);
need("description", config.description);
need("botName", config.botName);
need("documentsUrl", config.documentsUrl);
need("cloudflare.workerName", config.cloudflare?.workerName);
need("cloudflare.indexName", config.cloudflare?.indexName);

// Cloudflare tillåter bara gemener, siffror och bindestreck i namnen.
for (const key of ["workerName", "indexName"]) {
  const value = config.cloudflare?.[key] ?? "";
  if (value && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) {
    problems.push(`cloudflare.${key} får bara innehålla a-z, 0-9 och bindestreck`);
  }
}

const source = config.source ?? {};
const types = ["gitlab-appender", "html-links", "pdf-list"];
if (!types.includes(source.type)) {
  problems.push(`source.type måste vara en av ${types.join(", ")}`);
}
if (!Array.isArray(source.sections) || source.sections.length === 0) {
  problems.push("source.sections måste innehålla minst en sektion");
} else {
  const ids = new Set();
  source.sections.forEach((section, i) => {
    need(`source.sections[${i}].id`, section.id);
    need(`source.sections[${i}].label`, section.label);
    if (ids.has(section.id)) problems.push(`source.sections: id "${section.id}" förekommer två gånger`);
    ids.add(section.id);
    if (source.type === "html-links") need(`source.sections[${i}].url`, section.url);
    if (source.type === "pdf-list" && !Array.isArray(section.documents)) {
      problems.push(`source.sections[${i}].documents måste vara en lista`);
    }
  });
}
if (source.type === "gitlab-appender") need("source.baseUrl", source.baseUrl);
if (!Array.isArray(config.cleanup?.boilerplate)) problems.push("cleanup.boilerplate måste vara en lista");
if (!Array.isArray(config.cleanup?.swedishMarkers)) problems.push("cleanup.swedishMarkers måste vara en lista");

if (problems.length) {
  console.error("kar/kar.config.json har fel:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const template = await readFile(`${root}worker/wrangler.template.toml`, "utf8");
const toml =
  "# GENERERAD av scripts/configure.mjs ur wrangler.template.toml. Ändra inte här.\n\n" +
  template
    .replaceAll("{{workerName}}", config.cloudflare.workerName)
    .replaceAll("{{indexName}}", config.cloudflare.indexName);

// En platshållare som inte fylldes i skulle bli ett Worker-namn med klamrar,
// som Cloudflare avvisar först vid deploy. Bättre att stoppa här.
const leftover = toml.match(/{{\w+}}/);
if (leftover) {
  console.error(`wrangler.template.toml har en okänd platshållare: ${leftover[0]}`);
  process.exit(1);
}

await writeFile(`${root}worker/wrangler.toml`, toml, "utf8");

console.log(`OK: ${config.name}, Worker "${config.cloudflare.workerName}", index "${config.cloudflare.indexName}".`);
