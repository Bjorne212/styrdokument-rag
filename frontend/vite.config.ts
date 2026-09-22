/**
 * Byggkonfiguration.
 *
 * Appen byggdes ursprungligen med @lovable.dev/vite-tanstack-config, som
 * paketerade en hel del vi inte använder: nitro-presets för deras hosting,
 * prerender-rapportering till editorn, sandbox-portstyrning och HMR-bryggor.
 * Den här filen sätter i stället de fyra plugins som faktiskt behövs, så att
 * repot står på egna ben.
 */

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // @-aliaset i tsconfig.json löses av Vite självt sedan version 8, så
  // vite-tsconfig-paths behövs inte längre.
  resolve: { tsconfigPaths: true },
  // kar.config.json och shared/ ligger utanför frontend/, i repots rot.
  server: { fs: { allow: [".."] } },
  plugins: [
    tailwindcss(),
    tanstackStart({
      // SPA-läge: bygget renderar ett statiskt skal och all routing sker i
      // webbläsaren. Appen har inga loaders och inga serverfunktioner, bara
      // ett fetch mot /api/chat, så någon server behövs inte. Utan det här
      // byggs en SSR-Worker, och då hade projektet haft två Workers som måste
      // prata med varandra över CORS.
      spa: { enabled: true },
    }),
    viteReact(),
  ],
});
