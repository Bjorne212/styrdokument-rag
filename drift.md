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
| Repot | GitHub | Kårens klon av mallen. Kårens egna filer ligger i `kar/`, bland dem `kar/manifest.json` (vad som finns i boten) |
| Indexera styrdokument | GitHub Actions | Håller boten i synk med arkivet, var sjätte timme |
| Deploya chatten | GitHub Actions | Bygger och publicerar chatten vid ändringar i koden |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub, repovariabel | Vilket Cloudflare-konto jobben ska använda. Saknas den körs inga jobb. |
| `CLOUDFLARE_API_TOKEN` | GitHub, secret | Ger jobben rätt att skriva till Cloudflare |
| `SHARED_PASSWORD` | GitHub, secret | Lösenordet till chatten, sätts på Workern vid varje deploy |
| Workern | Cloudflare | Chattsidan och API:t |
| Vectorize-indexet | Cloudflare | Styckena ur dokumenten, som vektorer |
| Workers AI | Cloudflare | Språkmodellen och embeddingmodellen |
| `GUARD_KEY` | Cloudflare, secret på Workern | Bara med guardrails-tillägget. Sätts en gång med `wrangler secret put GUARD_KEY`, inte av deploy-jobbet. |

Secrets och variabler finns under *Settings → Secrets and variables → Actions* i repot. De ska ligga under **Repository** variables och secrets, inte under en environment, och namnen skrivs utan `vars.`. Annars hoppas jobben över. API-token behöver behörigheterna *Workers Scripts: Edit*, *Workers AI: Read* och *Vectorize: Edit*, och bör begränsas till kårens konto.

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

**Jobbet håller sig självt vid liv.** GitHub stänger av schemalagda jobb i publika repon efter 60 dagar utan aktivitet. Indexeringen committar `kar/manifest.json` när något ändrats i arkivet, och annars en ny tidsstämpel en gång i månaden, så repot räknas som aktivt så länge jobbet går. Har jobbet ändå stängts av syns en gul banner under *Actions*; klicka **Enable workflow**.

**Ett trasigt dokument stoppar inte resten.** Går ett dokument inte att hämta eller läsa syns det som en varning i körningen, som markeras som misslyckad. Resten indexeras och sparas, och nästa körning försöker igen.

**Kvoten syns i Cloudflare.** Under *Workers AI* i Cloudflare-dashboarden visas förbrukade neurons per dag. Ligger förbrukningen nära 10 000 räcker kvoten inte till alla som vill fråga, se [Kostnader](../kostnader/).

## Överlämning mellan styrelser {#overlamning}

Boten överlever bara om någon i nästa styrelse vet att den finns. Det vanligaste sättet att förlora en sådan här tjänst är att kontona ägs av en person som slutar.

1. **Äg kontona som kår, inte som person.** Cloudflare-kontot bör registreras på en funktionsadress (till exempel `it@karen.se`), och repot bör ligga i en GitHub-organisation för kåren i stället för på ett personligt konto.
2. **Lägg till efterträdaren** som medlem i Cloudflare-kontot och som *Admin* i GitHub-repot innan du tar bort dig själv.
3. **Byt API-token** om den avgående skapade den under sitt eget konto: skapa en ny, lägg in den i GitHub, ta bort den gamla.
4. **Byt lösenordet** till chatten och meddela det till dem som ska ha det.
5. **Gå igenom** [Hålla dokumenten korrekta](../uppdatera/) tillsammans med den som publicerar dokumenten.

## Kostnader {#kostnader}

Ingenting för en vanlig kår. Gränsen som styr är 10 000 neurons per dygn i Workers AI, vilket räcker till ungefär 80 frågor. Indexeringen kostar nästan ingenting. Hur kostnaden delas upp, vad som ingår gratis och vad som kostar vid större användning står på sidan [Kostnader](../kostnader/).

## Integritet {#integritet}

Chatboten sparar ingenting. Det finns inga konton, ingen chatthistorik, inga IP-adresser och inga loggar av frågor eller svar. Workern har ingen bindning till KV, D1 eller R2, så det finns ingenstans att skriva något ens av misstag.

Följdfrågor fungerar utan tillstånd på servern: webbläsaren skickar med de senaste utbytena i varje anrop, och servern trimmar dem, använder dem och glömmer dem. De lever i fliken och försvinner när sidan laddas om.

Frågorna skickas till Cloudflares Workers AI för att besvaras. Kåren bör nämna det i sin information till användarna. Typsnitten serveras från samma adress som sidan, så besökare kontaktar ingen tredje part.

Med guardrails-tillägget skickas dessutom frågan och de tidigare frågorna i samtalet, aldrig svaren, till guard-tjänsten, som låter en AI-modell från TypeSafe bedöma dem via Cloudflare. Gränssnittet säger då "Skriv inga personuppgifter" i stället för "Inget sparas", och svaret på "Sparas mina frågor?" beskriver bedömningen.

### Lösenordet

Tillgången styrs av ett enda delat lösenord. Det skyddar dagskvoten från främlingar snarare än hemligheter, eftersom dokumenten ändå är publika. Byt det genom att ändra `SHARED_PASSWORD` i GitHub och köra **Deploya chatten** under *Actions*, eller direkt:

```bash
cd worker
npx wrangler secret put SHARED_PASSWORD
```

Sajten stängs ute från sökmotorer med `robots.txt`, huvudet `X-Robots-Tag` och en meta-tagg, och får inte bäddas in på andra webbplatser.

Felaktiga lösenordsförsök begränsas inte, eftersom ett tak skulle behöva räkna per avsändare och systemet inte använder IP-adresser. Ett gissat lösenord kostar inga neurons, så skyddet är ett långt lösenord.

## Felsökning {#felsokning}

| Symptom | Trolig orsak och åtgärd |
|---|---|
| Boten citerar en gammal version | Se [När boten citerar något gammalt](../uppdatera/#gammalt). |
| Ett nytt dokument syns inte i svaren | Finns det i `kar/manifest.json`? Om inte: har indexeringen körts, står det i `kar/duplicates.json`, och finns det en varning om det i körningen? Är PDF:en skannad utan textlager går den inte att läsa. |
| Jobben i Actions körs inte alls | Variabeln `CLOUDFLARE_ACCOUNT_ID` saknas, ligger som secret eller under en environment i stället för som repovariabel, eller så har GitHub stängt av schemat (se [Övervakning](#overvakning)). |
| `Hittade inga dokument i sektionen` | Arkivets format eller adress har ändrats. Kör `node src/scrape.ts` i `ingestion/` och jämför med `source` i `kar/kar.config.json`. |
| `Hittade inga PDF-länkar på ...` | Sidan har gjorts om och bygger nu listan med JavaScript. Byt till `pdf-list`, se [Konfiguration](../konfiguration/#kalltyper). |
| `vectorize.index.not_found` eller `Indexet "..." har undefined dimensioner` | Indexet finns inte eller heter något annat än `cloudflare.indexName`. Det går inte att skapa i dashboarden. Kör `npx wrangler login` så att kårens konto syns, och sedan `CLOUDFLARE_ACCOUNT_ID=<kårens konto-ID> npx wrangler vectorize create <namn> --dimensions=1024 --metric=cosine` i `worker/`. |
| `Authentication error` i ett jobb | API-token har gått ut, återkallats eller saknar behörighet. Skapa en ny, se [Vad som finns och var](#resurser). |
| Chatten svarar "Fel lösenord" för alla | `SHARED_PASSWORD` är inte satt på Workern. Kör **Deploya chatten** eller `wrangler secret put`. |
| Chatten svarar att reservmodellen används | Huvudmodellen är överbelastad eller nere. Tillfälligt. |
| Chatten svarar att gratiskvoten är slut | Dagskvoten är förbrukad. Den återställs vid midnatt UTC. Se [Kostnader](../kostnader/). |
| "Många frågor just nu" | Taket på 10 frågor per minut för hela tjänsten är nått. Vänta en minut. |
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

Committa `kar/manifest.json` efter en körning för hand. Annars gör nästa schemalagda körning om samma arbete.

## Uppdatera koden

Förbättringar i mallen hämtas med `git pull upstream main`, se [Arkitektur](../arkitektur/#uppdatera-fran-mallen). Kårens egna filer i `kar/` påverkas inte.
