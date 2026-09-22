/**
 * Mäter hur bra sökningen är.
 *
 * Utan det här måttet är varje ändring i chunkning, embedding eller rankning
 * en gissning. Med det går det att se om en ändring hjälpte, skadade, eller
 * inte gjorde någon skillnad alls.
 *
 * Två mått används:
 *
 *   Träffsäkerhet@8  Andel frågor där rätt stycke finns bland de åtta som
 *                    skickas till modellen. Saknas det kan inget svar bli rätt,
 *                    hur bra modellen än är, det här är golvet.
 *
 *   MRR              Genomsnittet av 1/placering. Rätt svar på plats 1 ger 1,0,
 *                    plats 2 ger 0,5, plats 4 ger 0,25. Fångar det som
 *                    träffsäkerheten missar: att ligga överst är bättre än att
 *                    nätt och jämnt komma med, eftersom modellen läser de
 *                    översta styckena noggrannast.
 *
 * Körs mot det lokala indexet, alltså gratis.
 *
 * Kör:  node src/evaluate.ts
 *       node src/evaluate.ts --verbose   (visa varje frågas träffar)
 */

import {
  loadQuestions,
  meanReciprocalRank,
  rankOf,
  type EvalQuestion,
} from "./evalcore.ts";
import { loadLocalIndex, searchText, type SearchHit } from "./localindex.ts";

const TOP_K = 8;

async function main(): Promise<void> {
  const verbose = process.argv.includes("--verbose");
  const questions = await loadQuestions();

  const index = await loadLocalIndex();
  console.log(`Index: ${index.entries.length} chunkar\nFrågor: ${questions.length}\n`);

  const results: { question: EvalQuestion; rank: number | null; hits: SearchHit[] }[] = [];

  for (const question of questions) {
    const hits = await searchText(index, question.question, TOP_K);
    results.push({ question, rank: rankOf(hits, question), hits });
  }

  console.log("plats  frågetyp      fråga");
  console.log("-".repeat(78));
  for (const { question, rank } of results) {
    const label = rank === null ? "  ✗  " : String(rank).padStart(3) + "  ";
    console.log(`${label}  ${question.kind.padEnd(12)}  ${question.question}`);
  }

  const found = results.filter((result) => result.rank !== null);
  const mrr = meanReciprocalRank(results.map((r) => r.rank));
  const top1 = results.filter((r) => r.rank === 1).length;
  const top3 = results.filter((r) => r.rank !== null && r.rank <= 3).length;

  console.log("\nResultat");
  console.log(`  Träffsäkerhet@${TOP_K}:  ${found.length}/${results.length}  (${Math.round((found.length / results.length) * 100)} %)`);
  console.log(`  Rätt på plats 1:  ${top1}/${results.length}`);
  console.log(`  Rätt topp 3:      ${top3}/${results.length}`);
  console.log(`  MRR:              ${mrr.toFixed(3)}`);

  // Per frågetyp: visar var svagheten sitter.
  const kinds = [...new Set(questions.map((q) => q.kind))];
  console.log("\nPer frågetyp");
  for (const kind of kinds) {
    const subset = results.filter((r) => r.question.kind === kind);
    const hit = subset.filter((r) => r.rank !== null).length;
    const kindMrr = meanReciprocalRank(subset.map((r) => r.rank));
    console.log(`  ${kind.padEnd(12)} ${hit}/${subset.length}   MRR ${kindMrr.toFixed(3)}`);
  }

  const missed = results.filter((r) => r.rank === null || r.rank > 3);
  if (missed.length) {
    console.log("\nSvaga frågor (utanför topp 3):");
    for (const { question, rank, hits } of missed) {
      console.log(`\n  ${question.question}  →  ${rank === null ? "hittades inte" : "plats " + rank}`);
      if (verbose) {
        hits.slice(0, 3).forEach((hit, i) =>
          console.log(`     ${i + 1}. ${hit.score.toFixed(3)} ${hit.metadata.title} / ${hit.metadata.heading ?? "-"}`),
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
