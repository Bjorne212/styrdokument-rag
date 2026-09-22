---
layout: default
title: Drift och gränser
permalink: /drift/
---

# Drift och gränser

## Kostnader

Ingenting, så länge användningen håller sig inom gratisnivåerna. Varje kår har sitt eget Cloudflare-konto och därmed sin egen kvot.

| Gräns | Vad den betyder |
|---|---|
| 10 000 neurons per dygn i Workers AI | Ungefär 80 till 90 frågor per dygn, delat av alla användare |
| 5 miljoner lagrade vektordimensioner i Vectorize | Omkring 4 800 stycken. LinTeks arkiv, 60 dokument och 930 sidor, använder 914. |
| 100 000 anrop per dygn till Workers | Räcker med mycket stor marginal |
| 2 000 minuter per månad i GitHub Actions (privata repon) | Ett indexeringsjobb utan ändringar tar under en minut. Publika repon har ingen gräns. |

Att indexera om ett helt arkiv av LinTeks storlek kostar omkring 300 neurons, så det schemalagda jobbet hotar aldrig kvoten. Det är frågorna som förbrukar den.

Kvoten nollställs vid midnatt UTC. När den tar slut svarar huvudmodellen inte längre, och Workern går över till den mindre reservmodellen. Tar även den slut får användaren ett felmeddelande som förklarar varför.

### Om kvoten inte räcker

- Sänk `TOP_K` eller `HISTORY_TURNS` i `worker/wrangler.toml`. Färre stycken och kortare historik ger fler frågor per dygn, men sämre svar. Mät först.
- Byt Cloudflare-kontot till Workers Paid (5 USD i månaden). Förbrukning utöver gratisnivån kostar då 0,011 USD per 1 000 neurons, alltså runt en krona per hundra frågor.

## Integritet {#integritet}

Ingenting sparas. Det finns inga konton, ingen chatthistorik, inga IP-adresser och inga loggar av frågor eller svar. Workern har ingen bindning till KV, D1 eller R2, så det finns ingenstans att skriva något ens av misstag.

Följdfrågor fungerar utan tillstånd på servern: webbläsaren skickar med de senaste utbytena i varje anrop, och servern trimmar dem, använder dem och glömmer dem. De lever i fliken och försvinner när sidan laddas om.

Frågorna skickas till Cloudflares Workers AI för att besvaras. Enligt Cloudflares villkor används de inte för att träna modeller. Kåren bör ändå nämna i sin information till användarna att frågorna behandlas av Cloudflare.

Typsnitten serveras från samma adress som sidan, så besökare kontaktar ingen tredje part.

### Lösenordet

Tillgången styrs av ett enda delat lösenord, som sparas som secret i Cloudflare och i besökarens `sessionStorage`. Det skyddar dagskvoten från främlingar snarare än hemligheter, eftersom dokumenten boten svarar om ändå är publika. Byt det genom att ändra `SHARED_PASSWORD` i GitHub och köra deploy-jobbet, eller direkt:

```bash
cd worker
npx wrangler secret put SHARED_PASSWORD
```

Sajten stängs ute från sökmotorer med `robots.txt`, huvudet `X-Robots-Tag` och en meta-tagg.

## Felsökning

| Symptom | Trolig orsak och åtgärd |
|---|---|
| Jobben i Actions körs inte alls | Variabeln `CLOUDFLARE_ACCOUNT_ID` saknas, eller ligger som secret i stället för variabel. |
| `Indexet "..." har undefined dimensioner` | Indexet finns inte, eller heter något annat än `cloudflare.indexName`. Skapa det, se [Kom igång](../kom-igang/#cloudflare). |
| `Hittade inga dokument i sektionen` | Arkivets format har ändrats, eller fel `baseUrl`/sektions-id. Kör `node src/scrape.ts` i `ingestion/`. |
| `Hittade inga PDF-länkar på ...` | Sidan bygger listan med JavaScript. Använd `pdf-list`, se [Konfiguration](../konfiguration/#kalltyper). |
| Deploy misslyckas med `Authentication error` | API-token saknar *Workers Scripts: Edit*, eller gäller ett annat konto. |
| Chatten svarar "Fel lösenord" hela tiden | `SHARED_PASSWORD` är inte satt på Workern. Kör deploy-jobbet igen eller sätt den med `wrangler secret put`. |
| Svaren hänvisar till text som inte finns längre | En avbruten körning har lämnat gamla vektorer. Kör `npm run prune` i `ingestion/` med `.env` ifylld. Det kostar inga neurons. |
| Ett dokument syns inte i svaren | Kontrollera att det finns i `ingestion/manifest.json`. Står det i `duplicates.json` hoppas det över med flit. Är PDF:en skannad utan textlager går den inte att läsa. |
| Boten hittar fel stycken | Skriv en utvärderingsfråga för fallet och mät, se [Utvärdering](../utvardering/). Titta på träffarna med `npm run search -- "din fråga"` i `ingestion/`. |

### Köra indexeringen för hand

Skapa `ingestion/.env`, som är ignorerad av git:

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
| `npm run prune` | Tar bort överblivna vektorer utan att embedda något |
| `npm run search -- "fråga"` | Kör en fråga mot det skarpa indexet och visar träffarna |

Committa `manifest.json` efter en körning för hand. Annars gör nästa schemalagda körning om samma arbete.
