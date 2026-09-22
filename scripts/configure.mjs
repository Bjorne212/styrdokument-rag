/**
 * Kontrollerar kar.config.json och för över namnen till worker/wrangler.toml.
 *
 * wrangler.toml kan inte läsa JSON, så Workerns namn och indexets namn måste
 * stå i den filen också. Det här skriptet ser till att de två aldrig glider
 * isär: kör det efter varje ändring i kar.config.json. Deploy-jobbet i
 * GitHub Actions kör det automatiskt.
 *
 * Kör:  node scripts/configure.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(await readFile(`${root}kar.config.json`, "utf8"));

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
  console.error("kar.config.json har fel:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const tomlPath = `${root}worker/wrangler.toml`;
const before = await readFile(tomlPath, "utf8");
const after = before
  .replace(/^name = ".*"$/m, `name = "${config.cloudflare.workerName}"`)
  .replace(/^index_name = ".*"$/m, `index_name = "${config.cloudflare.indexName}"`);

if (after !== before) {
  await writeFile(tomlPath, after, "utf8");
  console.log("Uppdaterade worker/wrangler.toml.");
}

console.log(`OK: ${config.name}, Worker "${config.cloudflare.workerName}", index "${config.cloudflare.indexName}".`);
