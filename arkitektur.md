---
layout: default
title: Arkitektur
permalink: /arkitektur/
---

# Arkitektur

Repot är uppdelat efter var koden körs. Varje mapp är ett eget Node-paket med egna beroenden, och ingen mapp behöver byggas för att en annan ska fungera.

```
kar.config.json  Kårens konfiguration                     (läses av alla delar)
shared/          Typad inläsning av konfigurationen
ingestion/       Hämta, extrahera, dela, embedda          (GitHub Actions)
worker/          Chatt-API och webbplats                  (Cloudflare Workers)
frontend/        Gränssnittets källkod                    (React, byggs till pages/)
local/           Utvecklings- och mätverktyg              (Ollama, din dator)
eval/            Utvärderingsfrågor med facit
scripts/         configure.mjs: kontrollerar konfigurationen
examples/        Exempelkonfigurationer för andra källtyper
```

Den här dokumentationen ligger inte i koden. Den finns i grenen `gh-pages` i mallrepot och publiceras därifrån med GitHub Pages, så den följer inte med när en kår forkar eller kopierar mallen.

All kod är TypeScript. I `ingestion/` och `local/` körs den direkt av Node 24 utan byggsteg (Node tar bort typerna själv). Workern paketeras av Wrangler och gränssnittet av Vite.

## Konfigurationen

`kar.config.json` importeras som JSON av `shared/config.ts`, som ger den typer och exporterar objektet `kar`. Samma import fungerar i alla tre miljöer, så det finns ingen generering och inga miljövariabler att hålla i synk. Det enda undantaget är `worker/wrangler.toml`, som Wrangler läser innan någon kod körs; där skriver `scripts/configure.mjs` in Workerns och indexets namn.

## ingestion/: hålla indexet i synk

Körs i GitHub Actions av `.github/workflows/ingest.yml`, var sjätte timme och på begäran.

| Fil | Ansvar |
|---|---|
| `sources/` | Källtyperna. `index.ts` väljer typ utifrån konfigurationen, se [Konfiguration](../konfiguration/#kalltyper). |
| `scrape.ts` | Går igenom alla sektioner och samlar dokumentlistan |
| `extract.ts` | Laddar ner PDF:er, extraherar text med `unpdf` (pdf.js), hashar filerna |
| `chunk.ts` | Städar bort sidhuvuden och innehållsförteckningar, lagar avstavning, delar texten i överlappande stycken med metadata |
| `skiplist.ts` | Läser listan över dubbletter som inte ska indexeras (`duplicates.json`) |
| `cloudflare.ts` | REST-klient för Workers AI (embeddings) och Vectorize |
| `ingest.ts` | Styr allt ovan, underhåller `manifest.json`, tar bort inaktuella vektorer |
| `search.ts` | Felsökning: kör en fråga mot det skarpa indexet och skriv ut träffarna |

### Ändringskontroll i två nivåer

Den billiga signalen är grov, den exakta är dyr. Därför används båda:

1. **Fingeravtryck per sektion.** Källtypen tar fram något som ändras när sektionen ändras: en `ETag`, en hash av en HTML-sida. Är det samma som i `manifest.json` hoppas hela sektionen över utan att en enda PDF laddas ner.
2. **sha256 per dokument.** I ändrade sektioner laddas filerna ner och hashas. Bara dokument med ny hash extraheras, delas och embeddas om.

Fingeravtrycket säger *att* något hänt, hashen säger *vad*. Ett ändrat dokument kostar ett dokuments arbete, inte hela arkivets.

Dokument som försvunnit ur arkivet får sina vektorer borttagna. Blir ett dokument kortare försvinner också de överblivna styckena, annars kunde gammal text ligga kvar och bli sökträff.

### manifest.json

Indexeringens minne mellan körningar. Det committas tillbaka till repot av jobbet, så att nästa körning vet vad som redan finns i Vectorize. Filen innehåller fingeravtryck per sektion och, per dokument, hash, titel, adress och vilka vektor-id:n det gav upphov till.

Tas filen bort indexeras allt om vid nästa körning. Det är ofarligt men kostar några hundra neurons.

### Från PDF till stycken

- **Städning.** Rader som bara är sidnummer, datum, innehållsförteckning (med eller utan punktledare) eller innehåller en bit av `cleanup.boilerplate` tas bort. Avstavning över radbrytning ("styrdoku-\nment") lagas.
- **Rubriker.** Rader som "4.2 Kårstyrelsen" känns igen och följer med varje efterföljande stycke som metadata, så att svaret kan hänvisa till avsnittet.
- **Storlek.** Omkring 1 200 tecken per stycke, med cirka 100 tecken överlapp. Nya rubriker startar gärna ett nytt stycke. Storleken valdes genom mätning, se [Utvärdering](../utvardering/#beslut).
- **Det som embeddas** är dokumentets namn, rubriken och texten tillsammans. Stycket "250506 Kårfullmäktigemöte 8" säger inget i sig, men "Reglemente, Ändringshistorik" gör det.
- **Vektor-id** är en hash av dokumentets id plus löpnummer, eftersom Vectorize bara tillåter 64 byte.

Styckets text sparas som metadata på vektorn. Workern får den direkt ur sökträffen och behöver ingen egen lagring.

## worker/: chatten

Körs på Cloudflare Workers och serverar både API:t och det byggda gränssnittet. De delar därmed adress, och det behövs inga CORS-regler.

| Fil | Ansvar |
|---|---|
| `index.ts` | Routning, validering, strömning av svaret, reservmodell |
| `auth.ts` | Kontroll av det delade lösenordet, i konstant tid |
| `retrieve.ts` | Embeddar frågan och söker i Vectorize |
| `prompt.ts` | Systemprompten och hur styckena presenteras för modellen |
| `history.ts` | Trimmar och tvättar samtalshistoriken från webbläsaren |
| `loopguard.ts` | Avbryter svaret om modellen börjar upprepa sig |
| `glossary.ts` | Expansion av förkortningar. Mätt, visade sig inte hjälpa, bortkopplad |

### Ett anrop

`POST /api/chat` med huvudet `x-chat-password` och kroppen `{ "question": "...", "history": [...] }`. Svaret är en ström av server-sent events:

| Händelse | Innehåll |
|---|---|
| `sources` | Dokumenten som svaret bygger på, skickas först så att de syns direkt |
| `token` | En bit av svaret |
| `notice` | Meddelande till läsaren, t.ex. att reservmodellen används |
| `error` | Något gick fel, med en förklaring |
| `done` | Klart |

### Modeller

| Roll | Modell |
|---|---|
| Embeddings | `@cf/baai/bge-m3`, flerspråkig, 1 024 dimensioner |
| Svar | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| Reserv | `@cf/meta/llama-3.1-8b-instruct` |

Misslyckas huvudmodellen, oftast för att dagskvoten är slut, försöker Workern igen med den mindre reservmodellen. Tjänsten blir sämre i stället för att sluta fungera. Embeddingmodellen måste vara densamma vid indexering och sökning, annars hamnar vektorerna i olika "rum" och ingenting matchar.

### Stycken med för låg likhet

Stycken med likhet under 0,4 skickas inte till modellen. Hittas inget över gränsen får modellen instruktionen att säga att dokumenten inte svarar på frågan.

## frontend/: gränssnittet

React med TanStack Start i SPA-läge, byggt till statiska filer. Det finns inga serverfunktioner; gränssnittet är en klient som gör ett `fetch` mot `/api/chat`. `npm run build:pages` bygger och kopierar resultatet till `pages/`, som Workern serverar.

`pages/` checkas inte in. Deploy-jobbet bygger det, och lokalt byggs det vid behov. Lösenordet sparas i `sessionStorage` och följer inte med mellan flikar eller efter att fliken stängts.

## local/: mäta utan att förbruka kvot

Samma pipeline som i produktion, men mot [Ollama](https://ollama.com) på din egen dator. Att bygga indexet och köra utvärderingen kostar ingenting lokalt, medan det i produktion drar från dagskvoten.

Det går att lita på eftersom båda sidor kör samma embeddingmodell, `bge-m3`, och ger identiska vektorer: cosinuslikheten mellan en Cloudflare-embedding och en Ollama-embedding av samma text är 1,0000.

| Verktyg | Syfte |
|---|---|
| `localindex.ts` | Bygger ett lokalt vektorindex, återanvänder embeddings för oförändrade stycken |
| `evaluate.ts` | Kör utvärderingsfrågorna, rapporterar recall@8 och MRR |
| `experiments.ts` | Jämför styckestorlekar och inställningar mot varandra |
| `tune.ts` | Strukturmått: antal stycken, lagring, kontextkostnad per fråga |
| `duplicates.ts` | Hittar översättningspar och skriver `ingestion/duplicates.json` |
| `devserver.ts` | Hela chatten lokalt, med produktionens systemprompt |
| `evalcore.ts` | Gemensam inläsning och poängsättning, så att alla verktyg mäter samma sak |

## GitHub Actions

| Workflow | När | Vad |
|---|---|---|
| `ingest.yml` | Var sjätte timme, och för hand | Indexerar, committar `manifest.json` |
| `deploy.yml` | Push till `main` som rör chatten, och för hand | Kontrollerar konfigurationen, bygger gränssnittet, deployar Workern, sätter lösenordet |

Båda hoppar över sig själva om repovariabeln `CLOUDFLARE_ACCOUNT_ID` saknas, så att en ny kopia av mallen inte får misslyckade jobb innan den är konfigurerad.

## Uppdatera från mallen {#uppdatera-fran-mallen}

Kårernas repon är kopior, inte forkar, och får inte uppdateringar automatiskt. För att hämta förbättringar från mallen:

```bash
git remote add mall {{ site.repository_url }}.git
git fetch mall
git merge mall/main --allow-unrelated-histories
```

Konflikter ska bara uppstå i kårens egna filer: `kar.config.json`, loggan, favicon, färgerna i `styles.css` och datafilerna (`eval/questions.json`, `ingestion/duplicates.json`, `ingestion/manifest.json`, `worker/src/glossary.json`). Behåll kårens version av dem, till exempel med `git checkout --ours <fil>`. Resten av koden är gemensam.
