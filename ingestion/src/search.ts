/**
 * Sökverktyg för felsökning.
 *
 * Kör en fråga genom samma embedding och samma index som Workern använder, men
 * utan att generera något svar. Visar vilka stycken som faktiskt hämtas och hur
 * höga poäng de får.
 *
 * Det här är verktyget att ta till när chatten svarar fel: gav sökningen fel
 * stycken (då är det chunkning eller embedding som ska justeras), eller gav den
 * rätt stycken men modellen svarade ändå fel (då är det prompten)?
 *
 * Kör:  node --env-file=.env src/search.ts "hur väljs kårstyrelsen?"
 *       node --env-file=.env src/search.ts --full "..."   (hela chunktexten)
 */

import { configFromEnv, embed, queryVectors } from "./cloudflare.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const full = args.includes("--full");
  const question = args.filter((arg) => !arg.startsWith("--")).join(" ");

  if (!question) {
    console.error('Ange en fråga, t.ex.: node --env-file=.env src/search.ts "hur väljs kårstyrelsen?"');
    process.exit(1);
  }

  const config = configFromEnv();
  const [vector] = await embed(config, [question]);
  const matches = await queryVectors(config, vector, 5);

  console.log(`Fråga: ${question}\n`);

  if (matches.length === 0) {
    console.log("Inga träffar. Är indexet tomt?");
    return;
  }

  for (const [index, match] of matches.entries()) {
    const metadata = match.metadata ?? {};
    const heading = metadata.heading ? `, ${metadata.heading}` : "";
    const text = String(metadata.text ?? "");

    console.log(`${index + 1}. ${match.score.toFixed(3)}  ${metadata.title}${heading}`);
    console.log(`   ${metadata.sectionLabel}, sida ${metadata.page}, ${metadata.lang}`);
    console.log(`   ${full ? text : text.replace(/\n/g, " ").slice(0, 220) + "…"}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
