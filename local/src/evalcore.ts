/**
 * Delad grund för utvärderingsverktygen.
 *
 * Frågorna, facit och regeln för vad som räknas som en träff måste vara exakt
 * samma i alla verktyg. Låg man dem i varje skript för sig kunde någon skärpa
 * matchningen i `evaluate.ts` och glömma `experiments.ts`: och då jämför man
 * plötsligt två mätningar som mäter olika saker, utan att det syns.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const QUESTIONS_PATH = join(import.meta.dirname, "../../eval/questions.json");

export type EvalQuestion = {
  id: string;
  question: string;
  /** "specifik", "förkortning", "generell" eller "historik". */
  kind: string;
  /** Minst en av dessa fraser måste förekomma i stycket. */
  expectPhrases: string[];
  /** Och stycket måste komma från ett av dessa dokument. */
  expectDocuments: string[];
};

export type Candidate = {
  text: string;
  metadata: { title: string };
};

export async function loadQuestions(): Promise<EvalQuestion[]> {
  const { questions } = JSON.parse(await readFile(QUESTIONS_PATH, "utf8")) as {
    questions: EvalQuestion[];
  };
  return questions;
}

/** Jämför utan hänsyn till skiftläge och radbrytningar. */
export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

/**
 * Är det här stycket ett godtagbart svar?
 *
 * Båda villkoren måste gälla: rätt formulering *och* rätt dokument. Enbart
 * frasen räcker inte, eftersom samma mening kan förekomma i en översättning
 * eller i en äldre årgång av samma policy.
 */
export function isCorrect(hit: Candidate, question: EvalQuestion): boolean {
  const text = normalize(hit.text);
  return (
    question.expectPhrases.some((phrase) => text.includes(normalize(phrase))) &&
    question.expectDocuments.includes(hit.metadata.title)
  );
}

/** Placeringen för första korrekta träffen, eller null om ingen finns med. */
export function rankOf(hits: Candidate[], question: EvalQuestion): number | null {
  const position = hits.findIndex((hit) => isCorrect(hit, question));
  return position === -1 ? null : position + 1;
}

/** Mean Reciprocal Rank: 1/placering, i genomsnitt över alla frågor. */
export function meanReciprocalRank(ranks: (number | null)[]): number {
  return ranks.reduce((sum: number, rank) => sum + (rank ? 1 / rank : 0), 0) / ranks.length;
}
