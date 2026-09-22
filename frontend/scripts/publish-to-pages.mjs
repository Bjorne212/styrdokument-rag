/**
 * Kopierar det byggda gränssnittet till pages/, som Workern serverar.
 *
 * Två saker behöver hända utöver en ren kopiering:
 *
 *  1. TanStack Start kallar sitt förrenderade skal `_shell.html`. Cloudflares
 *     assets-hantering letar efter `index.html`, så filen döps om.
 *  2. Gamla filer städas bort först. Bygget ger filnamn med innehållshash,
 *     så utan städning växer mappen för varje bygge med filer ingen använder.
 */

import { cp, mkdir, rename, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, inte URL.pathname: den senare behåller procent-kodning, så en
// sökväg med mellanslag blir "%20" och alla filoperationer misslyckas.
const BUILD_DIR = fileURLToPath(new URL("../dist/client/", import.meta.url));
const PAGES_DIR = fileURLToPath(new URL("../../pages/", import.meta.url));

await rm(PAGES_DIR, { recursive: true, force: true });
await mkdir(PAGES_DIR, { recursive: true });
await cp(BUILD_DIR, PAGES_DIR, { recursive: true });

await rename(join(PAGES_DIR, "_shell.html"), join(PAGES_DIR, "index.html"));

const files = await readdir(PAGES_DIR, { recursive: true });
console.log(`Publicerade ${files.length} filer till pages/`);
