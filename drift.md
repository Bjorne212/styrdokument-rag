---
layout: default
title: Drift
permalink: /drift/
---

# Drift

<p class="lead">När boten väl är uppe sköter den sig själv. Den här sidan beskriver det lilla som behöver göras, vem som bör göra det, och vad man gör när något inte fungerar.</p>

## Vad som finns och var {#resurser}

| Del | Plats | Vad den gör |
|---|---|---|
| Repot | GitHub | Koden, `kar.config.json` och `ingestion/manifest.json` (vad som finns i boten) |
| Indexera styrdokument | GitHub Actions | Håller boten i synk med arkivet, var sjätte timme |
| Deploya chatten | GitHub Actions | Bygger och publicerar chatten vid ändringar i koden |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub, repovariabel | Vilket Cloudflare-konto jobben ska använda. Saknas den körs inga jobb. |
| `CLOUDFLARE_API_TOKEN` | GitHub, secret | Ger jobben rätt att skriva till Cloudflare |
| `SHARED_PASSWORD` | GitHub, secret | Lösenordet till chatten, sätts på Workern vid varje deploy |
| Workern | Cloudflare | Chattsidan och API:t |
| Vectorize-indexet | Cloudflare | Styckena ur dokumenten, som vektorer |
| Workers AI | Cloudflare | Språkmodellen och embeddingmodellen |

Secrets och variabler finns under *Settings → Secrets and variables → Actions* i repot. API-token behöver behörigheterna *Workers Scripts: Edit*, *Workers AI: Read* och *Vectorize: Edit*.

## Löpande rutiner

| När | Vad | Vem |
|---|---|---|
| Efter varje beslut som ändrar ett styrdokument | Publicera den nya versionen, ta bort den gamla, kontrollera. Se [checklistan](../uppdatera/#checklista). | Den som publicerar dokumenten |
| Någon gång per termin | Titta i *Actions* att indexeringen är grön. Ställ ett par kontrollfrågor. | Driftansvarig |
| Vid terminsstart | Byt lösenordet om det spridits för brett. | Driftansvarig |
| Vid styrelseskifte | Överlämning, se nedan. | Avgående och tillträdande driftansvarig |
| När API-token går ut | Skapa en ny i Cloudflare och byt `CLOUDFLARE_API_TOKEN`. | Driftansvarig |

## Övervakning {#overvakning}

**Misslyckade körningar mejlas.** GitHub skickar ett mejl när ett schemalagt jobb misslyckas, till den som senast ändrade schemat i `.github/workflows/ingest.yml`. Se till att det är driftansvarig, eller att den personen bevakar repot under *Watch → Custom → Actions*.

**Jobbet håller sig självt vid liv.** GitHub stänger av schemalagda jobb i publika repon efter 60 dagar utan aktivitet. Indexeringen skriver en ny tidsstämpel i `manifest.json` och committar den vid varje körning, så repot räknas som aktivt så länge jobbet går. Har jobbet ändå stängts av syns en gul banner under *Actions*; klicka **Enable workflow**.

**Kvoten syns i Cloudflare.** Under *Workers AI* i Cloudflare-dashboarden visas förbrukade neurons per dag. Ligger förbrukningen nära 10 000 räcker kvoten inte till alla som vill fråga, se [Kostnader](#kostnader).

## Överlämning mellan styrelser {#overlamning}

Boten överlever bara om någon i nästa styrelse vet att den finns. Det vanligaste sättet att förlora en sådan här tjänst är att kontona ägs av en person som slutar.

1. **Äg kontona som kår, inte som person.** Cloudflare-kontot bör registreras på en funktionsadress (till exempel `it@karen.se`), och repot bör ligga i en GitHub-organisation för kåren i stället för på ett personligt konto.
2. **Lägg till efterträdaren** som medlem i Cloudflare-kontot och som *Admin* i GitHub-repot innan du tar bort dig själv.
3. **Byt API-token** om den avgående skapade den under sitt eget konto: skapa en ny, lägg in den i GitHub, ta bort den gamla.
4. **Byt lösenordet** till chatten och meddela det till dem som ska ha det.
5. **Gå igenom** [Hålla dokumenten korrekta](../uppdatera/) tillsammans med den som publicerar dokumenten.

## Kostnader {#kostnader}

Ingenting, så länge användningen håller sig inom gratisnivåerna. Varje kår har sitt eget Cloudflare-konto och därmed sin egen kvot.

| Gräns | Vad den betyder |
|---|---|
| 10 000 neurons per dygn i Workers AI | Ungefär 80 till 90 frågor per dygn, delat av alla användare |
| 5 miljoner lagrade vektordimensioner i Vectorize | Omkring 4 800 stycken. LinTeks arkiv, 60 dokument och 930 sidor, använder 914. |
| 100 000 anrop per dygn till Workers | Räcker med mycket stor marginal |
| 2 000 minuter per månad i GitHub Actions (privata repon) | Ett indexeringsjobb utan ändringar tar under en minut. Publika repon har ingen gräns. |

Att indexera om ett helt arkiv av LinTeks storlek kostar omkring 300 neurons, så det schemalagda jobbet hotar aldrig kvoten. Det är frågorna som förbrukar den.

Kvoten nollställs vid midnatt UTC. När den tar slut går Workern över till en mindre reservmodell. Tar även den slut får användaren ett felmeddelande som förklarar varför.

**Om kvoten inte räcker:** sänk `TOP_K` eller `HISTORY_TURNS` i `worker/wrangler.toml` (fler frågor per dygn, men sämre svar), eller byt Cloudflare-kontot till Workers Paid för 5 USD i månaden. Förbrukning över gratisnivån kostar då 0,011 USD per 1 000 neurons, ungefär en krona per hundra frågor.

## Integritet {#integritet}

Ingenting sparas. Det finns inga konton, ingen chatthistorik, inga IP-adresser och inga loggar av frågor eller svar. Workern har ingen bindning till KV, D1 eller R2, så det finns ingenstans att skriva något ens av misstag.

Följdfrågor fungerar utan tillstånd på servern: webbläsaren skickar med de senaste utbytena i varje anrop, och servern trimmar dem, använder dem och glömmer dem. De lever i fliken och försvinner när sidan laddas om.

Frågorna skickas till Cloudflares Workers AI för att besvaras. Kåren bör nämna det i sin information till användarna. Typsnitten serveras från samma adress som sidan, så besökare kontaktar ingen tredje part.

### Lösenordet

Tillgången styrs av ett enda delat lösenord. Det skyddar dagskvoten från främlingar snarare än hemligheter, eftersom dokumenten ändå är publika. Byt det genom att ändra `SHARED_PASSWORD` i GitHub och köra **Deploya chatten** under *Actions*, eller direkt:

```bash
cd worker
npx wrangler secret put SHARED_PASSWORD
```

Sajten stängs ute från sökmotorer med `robots.txt`, huvudet `X-Robots-Tag` och en meta-tagg.

## Felsökning {#felsokning}

| Symptom | Trolig orsak och åtgärd |
|---|---|
| Boten citerar en gammal version | Se [När boten citerar något gammalt](../uppdatera/#gammalt). |
| Ett nytt dokument syns inte i svaren | Finns det i `ingestion/manifest.json`? Om inte: har indexeringen körts, och står det i `duplicates.json`? Är PDF:en skannad utan textlager går den inte att läsa. |
| Jobben i Actions körs inte alls | Variabeln `CLOUDFLARE_ACCOUNT_ID` saknas, ligger som secret i stället för variabel, eller så har GitHub stängt av schemat (se [Övervakning](#overvakning)). |
| `Hittade inga dokument i sektionen` | Arkivets format eller adress har ändrats. Kör `node src/scrape.ts` i `ingestion/` och jämför med `source` i `kar.config.json`. |
| `Hittade inga PDF-länkar på ...` | Sidan har gjorts om och bygger nu listan med JavaScript. Byt till `pdf-list`, se [Konfiguration](../konfiguration/#kalltyper). |
| `Indexet "..." har undefined dimensioner` | Indexet finns inte eller heter något annat än `cloudflare.indexName`. Skapa det med `npx wrangler vectorize create <namn> --dimensions=1024 --metric=cosine`. |
| `Authentication error` i ett jobb | API-token har gått ut, återkallats eller saknar behörighet. Skapa en ny, se [Vad som finns och var](#resurser). |
| Chatten svarar "Fel lösenord" för alla | `SHARED_PASSWORD` är inte satt på Workern. Kör **Deploya chatten** eller `wrangler secret put`. |
| Chatten svarar att reservmodellen används | Dagskvoten är nästan slut. Se [Kostnader](#kostnader). |
| Boten hittar fel stycken | Titta på träffarna med `npm run search -- "din fråga"` i `ingestion/`. Skriv en utvärderingsfråga för fallet och mät, se [Utvärdering](../utvardering/). |

## Köra indexeringen för hand {#for-hand}

Oftast räcker **Run workflow** under *Actions*. För felsökning går det att köra från en egen dator. Skapa `ingestion/.env`, som är ignorerad av git:

```bash
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

Sedan i `ingestion/`:

| Kommando | Vad |
|---|---|
| `npm run ingest:dry` | Visar vad som skulle hända, rör ingenting |
| `npm run ingest` | Inkrementell indexering, samma som det schemalagda jobbet |
| `npm run ingest:force` | Indexerar om allt, även oförändrade dokument |
| `npm run prune` | Tar bort överblivna stycken utan att läsa in något nytt. Kostar inga neurons. |
| `npm run search -- "fråga"` | Kör en fråga mot boten och visar vilka stycken som hittas |

Committa `manifest.json` efter en körning för hand. Annars gör nästa schemalagda körning om samma arbete.

## Uppdatera koden

Förbättringar i mallen hämtas med git, se [Arkitektur](../arkitektur/#uppdatera-fran-mallen). Kårens egna filer (`kar.config.json`, logga, färger, datafiler) påverkas inte.
