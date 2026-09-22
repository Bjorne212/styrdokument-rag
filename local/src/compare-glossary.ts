/**
 * Mäter om ordlistan förbättrar sökningen.
 *
 * Samma frågor, samma index, enda skillnaden är om förkortningar expanderas
 * innan frågan embeddas. Kör lokalt mot Ollama, alltså gratis.
 */

import { expandAbbreviations } from "../../worker/src/glossary.ts";
import { loadQuestions, meanReciprocalRank, rankOf, type EvalQuestion } from "./evalcore.ts";
import { embedTexts } from "./embeddings.ts";
import { loadLocalIndex, search } from "./localindex.ts";

const TOP_K = 8;

async function measure(questions: EvalQuestion[], texts: string[], index: Awaited<ReturnType<typeof loadLocalIndex>>) {
  const vectors = await embedTexts(texts);
  const ranks = questions.map((question, i) => rankOf(search(index, vectors[i], TOP_K), question));

  return {
    ranks,
    recall: ranks.filter((rank) => rank !== null).length / ranks.length,
    top1: ranks.filter((rank) => rank === 1).length,
    mrr: meanReciprocalRank(ranks),
  };
}

async function main(): Promise<void> {
  const questions = await loadQuestions();
  const index = await loadLocalIndex();

  const utan = await measure(questions, questions.map((q) => q.question), index);
  const med = await measure(questions, questions.map((q) => expandAbbreviations(q.question)), index);

  console.log("                     träff@8  plats1    MRR");
  console.log("-".repeat(46));
  console.log(`utan ordlista        ${(Math.round(utan.recall * 100) + " %").padStart(6)}  ${String(utan.top1).padStart(4)}/20  ${utan.mrr.toFixed(3)}`);
  console.log(`med ordlista         ${(Math.round(med.recall * 100) + " %").padStart(6)}  ${String(med.top1).padStart(4)}/20  ${med.mrr.toFixed(3)}`);

  console.log("\nFrågor som ändrade placering:");
  let changed = 0;
  questions.forEach((question, i) => {
    if (utan.ranks[i] === med.ranks[i]) return;
    changed++;
    const before = utan.ranks[i] ?? "miss";
    const after = med.ranks[i] ?? "miss";
    const arrow = (med.ranks[i] ?? 99) < (utan.ranks[i] ?? 99) ? "bättre" : "sämre";
    console.log(`  ${String(before).padStart(4)} → ${String(after).padEnd(4)} ${arrow.padEnd(7)} ${question.question}`);
  });
  if (changed === 0) console.log("  (ingen)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
