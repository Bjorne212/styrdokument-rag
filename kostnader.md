---
layout: default
title: Kostnader
permalink: /kostnader/
---

# Kostnader

<p class="lead">För en vanlig kår kostar boten ingenting. Allt ryms i GitHubs och Cloudflares gratisnivåer. Den här sidan visar vad som förbrukar vad, var gränserna går och vad det kostar om de passeras.</p>

Priserna är hämtade från Cloudflares och GitHubs prislistor i september 2026 och anges i US-dollar, som tjänsterna faktureras i. Kronbeloppen är avrundade med ungefär 10,5 kr per dollar. Kontrollera aktuella priser hos [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Vectorize](https://developers.cloudflare.com/vectorize/platform/pricing/) och [Workers](https://developers.cloudflare.com/workers/platform/pricing/) innan ni räknar på en budget.

## Var kostnaden uppstår

Boten använder fem tjänster. Bara en av dem, språkmodellen i Workers AI, kan i praktiken ta slut.

| Tjänst | Används till | Ingår gratis | Förbrukning för LinTek |
|---|---|---|---|
| **Workers AI** | Språkmodellen som skriver svaren, och embeddings av frågor och dokument | 10 000 neurons per dygn | Omkring 125 neurons per fråga. **Den här gränsen styr allt.** |
| **Vectorize** | Lagrar styckena ur dokumenten och söker bland dem | 5 miljoner lagrade dimensioner, 30 miljoner sökta dimensioner per månad | 0,94 miljoner lagrade (19 %). Sökningarna är försumbara. |
| **Workers** | Chattsidan och API:t | 100 000 anrop per dygn. Statiska filer är gratis och obegränsade. | Ett anrop per fråga |
| **GitHub Actions** | Indexeringen var sjätte timme, och deploy | Obegränsat i publika repon, 2 000 minuter per månad i privata | Under en minut per körning, omkring 120 minuter per månad |
| **GitHub Pages** | Den här dokumentationen | Gratis för publika repon | Ingen |

Det finns inga engångskostnader. En egen domän (till exempel `boten.karen.se`) är valfri; utan den nås chatten på en gratis `workers.dev`-adress.

## Vad en fråga kostar

Workers AI räknar i *neurons*, en enhet som Cloudflare räknar om från antalet tokens (ungefär ordbitar) in och ut ur modellen. Priset skiljer sig mellan modellerna.

En typisk fråga i LinTeks bot:

| Steg | Modell | Tokens | Neurons |
|---|---|---|---|
| Göra om frågan till en vektor | `bge-m3` | omkring 30 | under 0,1 |
| Läsa systemprompt, åtta stycken och historik | `llama-3.3-70b` (in) | omkring 3 500 | omkring 93 |
| Skriva svaret | `llama-3.3-70b` (ut) | omkring 150 | omkring 31 |
| **Totalt** | | | **omkring 125** |

Det är de åtta dokumentstyckena som kostar mest, inte svaret. Därför är antalet stycken (`TOP_K`) och hur mycket historik som skickas med (`HISTORY_TURNS`) de två rattarna som påverkar kostnaden mest, se [Sänka förbrukningen](#sanka).

**10 000 neurons per dygn räcker alltså till ungefär 80 frågor**, delat av alla användare. Långa svar och följdfrågor med historik drar mer, korta frågor mindre.

Priser per miljon tokens för modellerna boten använder:

| Modell | Roll | In | Ut |
|---|---|---|---|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Svar | 26 668 neurons (0,293 USD) | 204 805 neurons (2,253 USD) |
| `@cf/meta/llama-3.1-8b-instruct` | Reserv | 25 608 neurons (0,282 USD) | 75 147 neurons (0,827 USD) |
| `@cf/baai/bge-m3` | Embeddings | 1 075 neurons (0,012 USD) | |

## Vad indexeringen kostar

Indexeringen använder bara embeddingmodellen, som är ungefär 25 gånger billigare än språkmodellen per token.

| Händelse | Förbrukning |
|---|---|
| Schemalagd körning utan ändringar | 0 neurons. Inga dokument läses. |
| Ett ändrat dokument (omkring 15 stycken) | omkring 5 neurons |
| Hela LinTeks arkiv, 914 stycken | omkring 350 neurons |

Även en fullständig omindexering tar alltså under 4 % av dagskvoten.

## När gratiskvoten tar slut

Kvoten på 10 000 neurons nollställs vid midnatt UTC (klockan 01 eller 02 svensk tid).

**På Cloudflares gratisplan** slutar modellerna svara när kvoten är förbrukad. Workern försöker då med den mindre reservmodellen, men den drar från samma kvot. När kvoten är helt slut får användaren meddelandet "Dagens gratiskvot för AI-svar är slut. Den återställs vid midnatt UTC." Ingenting debiteras.

**På Workers Paid** fortsätter allt att fungera, och förbrukningen över 10 000 neurons per dygn faktureras i efterhand.

| Plan | Månadskostnad | Ingår | Över det som ingår |
|---|---|---|---|
| Workers Free | 0 | 10 000 neurons per dygn, sedan stopp | Går inte |
| Workers Paid | 5 USD (omkring 55 kr) | 10 000 neurons per dygn, samt mer utrymme i Vectorize och Workers | 0,011 USD per 1 000 neurons |

Varje fråga över gratiskvoten kostar alltså omkring 0,0014 USD, **ungefär 1,50 kr per hundra frågor**.

## Räkneexempel

| Kår | Frågor per dygn | Neurons per dygn | Plan | Kostnad per månad |
|---|---|---|---|---|
| Liten kår | 20 | 2 500 | Free | 0 kr |
| LinTek, vanlig vecka | 40 till 60 | 5 000 till 7 500 | Free | 0 kr |
| LinTek, inför fullmäktige | 80 | 10 000 | Free | 0 kr, men nära taket |
| Stor kår | 300 | 37 500 | Paid | omkring 14 USD (150 kr) |

Så räknas den stora kåren fram: 37 500 minus de 10 000 som ingår är 27 500 neurons per dygn, eller 825 000 per månad. Det kostar 825 × 0,011 = 9,08 USD. Med planavgiften på 5 USD blir det omkring 14 USD. Vectorize och Workers ryms fortfarande i det som ingår i Paid: 9 000 frågor i månaden ger omkring 10 miljoner sökta dimensioner av 50 miljoner.

## Lagring och sökning i Vectorize

Vectorize tar betalt för hur många dimensioner som lagras och söks. Varje stycke är en vektor med 1 024 dimensioner.

- **Lagrat:** 914 stycken × 1 024 = 0,94 miljoner dimensioner. Gratisnivån rymmer 5 miljoner, alltså omkring 4 800 stycken eller ungefär fem gånger LinTeks arkiv.
- **Sökt:** Cloudflare räknar (antal frågor + antal lagrade stycken) × 1 024 per månad. Med 2 500 frågor i månaden blir det 3,5 miljoner av 30 miljoner gratis.

Vectorize blir alltså aldrig den begränsande faktorn för en kår; språkmodellens kvot tar slut långt innan.

## Sänka förbrukningen {#sanka}

Om kvoten inte räcker, i ordning från minst till mest påverkan på svaren:

| Åtgärd | Var | Effekt |
|---|---|---|
| Stäng av följdfrågor | `HISTORY_TURNS = "0"` i `worker/wrangler.toml` | Sparar upp till omkring 10 neurons per följdfråga. Korta frågor som "vad gör den?" slutar fungera. |
| Kortare historik | `HISTORY_ANSWER_CHARS` | Mindre besparing, mindre påverkan |
| Färre stycken per fråga | `TOP_K`, till exempel `"5"` | Omkring 30 neurons mindre per fråga, alltså cirka 30 % fler frågor per dygn. Svaren hittar oftare fel eller inget. Mät med [utvärderingen](../utvardering/) först. |
| Byt till Workers Paid | Cloudflare-dashboarden | Ingen påverkan på svaren. Omkring 55 kr i månaden plus förbrukning. |

## Följa förbrukningen

I Cloudflare-dashboarden, under **AI → Workers AI**, visas förbrukade neurons per dag och per modell. Under **Storage & Databases → Vectorize** syns lagrade och sökta dimensioner. Ligger förbrukningen regelbundet över 8 000 neurons per dag är det dags att sänka förbrukningen eller byta plan.
