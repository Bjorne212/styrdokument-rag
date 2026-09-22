/**
 * Lösenordskontroll.
 *
 * Ett enda delat lösenord, ingen inloggning, inga konton, ingen session på
 * servern. Syftet är att hindra utomstående från att bränna dagskvoten hos
 * Workers AI: inte att skydda hemligheter. Dokumenten som systemet svarar om
 * är offentliga.
 *
 * Ingenting om försöken loggas eller räknas: inga IP-adresser, ingen historik.
 * Det är därför systemet inte behandlar några personuppgifter alls.
 */

const HEADER = "x-chat-password";

/**
 * Jämför två strängar utan att läcka hur många tecken som stämde.
 *
 * En vanlig `===` avbryter vid första felaktiga tecknet, vilket gör att
 * svarstiden avslöjar hur långt en gissning kom. Vi hashar därför båda
 * värdena först, då blir längden alltid densamma, och jämför sedan med
 * en tidskonstant funktion.
 */
async function equalsSecurely(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);

  return crypto.subtle.timingSafeEqual(hashA, hashB);
}

export type AuthResult = { ok: true } | { ok: false; reason: string };

export async function checkPassword(
  request: Request,
  expected: string | undefined,
): Promise<AuthResult> {
  if (!expected) {
    // Hellre stängd tjänst än öppen kvot: saknas hemligheten släpper vi inte
    // igenom någon.
    return { ok: false, reason: "Servern saknar konfigurerat lösenord." };
  }

  const provided = request.headers.get(HEADER);
  if (!provided) {
    return { ok: false, reason: "Lösenord saknas." };
  }

  return (await equalsSecurely(provided, expected))
    ? { ok: true }
    : { ok: false, reason: "Fel lösenord." };
}
