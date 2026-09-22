/**
 * Bryter strömmen när modellen har fastnat i en slinga.
 *
 * Små modeller kan börja upprepa samma mening om och om igen, särskilt vid låg
 * temperatur. Utan skydd fyller upprepningen hela svarsutrymmet: användaren får
 * en vägg av identisk text, och varje upprepad token kostar av dagskvoten.
 *
 * Rätt parametrar (temperatur och repetitionsstraff) gör det ovanligt, men inte
 * omöjligt. Det här är bältet till hängslena, vi vill hellre klippa ett svar
 * än att skicka nonsens.
 */

/** Så många tecken bakåt vi jämför. Ungefär en mening. */
const WINDOW = 100;
/** Så många gånger samma textstycke får förekomma innan vi avbryter. */
const MAX_REPEATS = 3;
/** Under den här längden är upprepning inte meningsfull att leta efter. */
const MIN_LENGTH = 250;

export function looksRepetitive(answer: string): boolean {
  if (answer.length < MIN_LENGTH) return false;

  const tail = answer.slice(-WINDOW);
  if (tail.trim().length < WINDOW / 2) return false;

  let count = 0;
  let position = answer.indexOf(tail);
  while (position !== -1) {
    count++;
    if (count >= MAX_REPEATS) return true;
    position = answer.indexOf(tail, position + 1);
  }

  return false;
}
