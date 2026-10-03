---
layout: default
title: Arkitektur
permalink: /arkitektur/
---

# Arkitektur

Repot är uppdelat efter var koden körs. Varje mapp är ett eget Node-paket med egna beroenden, och ingen mapp behöver byggas för att en annan ska fungera.

```
kar/             Allt som är kårens eget: konfiguration, logga,
                 färger, utvärderingsfrågor och genererade data
shared/          Typad inläsning av konfigurationen
ingestion/       Hämta, extrahera, dela, embedda          (GitHub Actions)
worker/          Chatt-API och webbplats                  (Cloudflare Workers)
frontend/        Gränssnittets källkod                    (React, byggs till pages/)
local/           Utvecklings- och mätverktyg              (Ollama, din dator)
scripts/         configure.mjs: kontrollerar konfigurationen och skriver worker/wrangler.toml
examples/        Exempelkonfigurationer för andra källtyper
```

Den här dokumentationen ligger inte i koden. Den finns i grenen `gh-pages` i mallrepot och publiceras därifrån med GitHub Pages, så den följer inte med när en kår forkar eller kopierar mallen.

All kod är TypeScript. I `ingestion/` och `local/` körs den direkt av Node 24 utan byggsteg (Node tar bort typerna själv). Workern paketeras av Wrangler och gränssnittet av Vite.

## Konfigurationen

`kar/kar.config.json` importeras som JSON av `shared/config.ts`, som ger den typer och exporterar objektet `kar`. Samma import fungerar i alla tre miljöer, så det finns inga miljövariabler att hålla i synk. Det enda undantaget är `worker/wrangler.toml`, som Wrangler läser innan någon kod körs. Den checkas inte in: `scripts/configure.mjs` skriver den ur `worker/wrangler.template.toml` med Workerns och indexets namn, och Workerns `dev`- och `deploy`-skript kör det först.

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
| `ingest.ts` | Styr allt ovan, underhåller `kar/manifest.json`, tar bort inaktuella vektorer |
| `search.ts` | Felsökning: kör en fråga mot det skarpa indexet och skriv ut träffarna |

### Ändringskontroll i två nivåer

Den billiga signalen är grov, den exakta är dyr. Därför används båda:

1. **Fingeravtryck per sektion.** Källtypen tar fram något som ändras när sektionen ändras: en `ETag`, en hash av en HTML-sida. Är det samma som i `manifest.json` hoppas hela sektionen över utan att en enda PDF laddas ner.
2. **sha256 per dokument.** I ändrade sektioner laddas filerna ner och hashas. Bara dokument med ny hash delas och embeddas om.

Fingeravtrycket säger *att* något hänt, hashen säger *vad*. Ett ändrat dokument kostar ett dokuments arbete, inte hela arkivets.

Dokument som försvunnit ur arkivet får sina vektorer borttagna. Blir ett dokument kortare försvinner också de överblivna styckena, annars kunde gammal text ligga kvar och bli sökträff.

Ett dokument som inte går att hämta eller läsa hoppas över och syns som en varning i körningen. Resten indexeras och sparas, och nästa körning försöker med dokumentet igen. Körningen markeras som misslyckad, så att det syns i Actions.

### manifest.json

Indexeringens minne mellan körningar, i `kar/manifest.json`. Det committas tillbaka till repot av jobbet, så att nästa körning vet vad som redan finns i Vectorize, men bara när något faktiskt ändrats. Filen innehåller fingeravtryck per sektion och, per dokument, hash, titel, adress och vilka vektor-id:n det gav upphov till.

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
| `index.ts` | Routning, validering, tak för antal frågor, strömning av svaret, reservmodell |
| `auth.ts` | Kontroll av det delade lösenordet, i konstant tid |
| `retrieve.ts` | Embeddar frågan och söker i Vectorize |
| `prompt.ts` | Systemprompten och hur styckena, det tidigare samtalet och frågan presenteras för modellen |
| `history.ts` | Trimmar och tvättar samtalshistoriken från webbläsaren |
| `loopguard.ts` | Avbryter svaret om modellen börjar upprepa sig |
| `guard-client.ts` | Guardrails-tillägget, se nedan |

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
| Reserv | `@cf/mistralai/mistral-small-3.1-24b-instruct` |

Misslyckas huvudmodellen innan den hunnit skriva något, till exempel vid överbelastning, försöker Workern igen med reservmodellen, som kommer från en annan leverantör. Har huvudmodellen redan skrivit en del av svaret visas i stället ett fel, så att två svar aldrig klistras ihop. Reserven hjälper inte när dagskvoten är slut: på gratisplanen stoppas då alla anrop. Embeddingmodellen måste vara densamma vid indexering och sökning, annars hamnar vektorerna i olika "rum" och ingenting matchar.

### Prompten och avgränsningarna

Dokumentstyckena, det tidigare samtalet och frågan ligger inom egna taggar (`<dokument>`, `<tidigare_samtal>`, `<fråga>`), och systemprompten säger att allt inom dem är material och inte instruktioner. Våra egna taggar rensas bort ur texten innan den läggs in, så att en fråga inte kan stänga sin egen avgränsning. Det tidigare samtalet kommer från webbläsaren och skickas som citat, inte som modellens egna tidigare svar, eftersom det kan vara ändrat.

### Tak för antal frågor

Högst 10 frågor per minut för hela tjänsten, räknat efter godkänt lösenord. Taket gäller alla användare tillsammans, eftersom systemet inte använder IP-adresser och lösenordet är delat. Det hindrar att dagskvoten bränns på några minuter. Räknarna är ungefärliga och gäller per Cloudflare-plats.

### Stycken med för låg likhet

Stycken med likhet under 0,4 skickas inte till modellen. Hittas inget över gränsen svarar Workern själv att den inte hittar något i dokumenten, utan att anropa modellen. Det sparar ungefär 100 neurons per sådan fråga.

## Guardrails-tillägget

Valfritt och avstängt om inte Workern har en `GUARD_KEY` (secret) och `guardrails.url` finns i `kar/kar.config.json`. Båda följer med tillägget. Med tillägget skickas varje fråga och de tidigare frågorna i samtalet, aldrig svaren, till en separat guard-tjänst, samtidigt som dokumenten söks. Tjänsten svarar med ett av tre beslut:

| Beslut | Vad Workern gör |
|---|---|
| `ALLOW` | Svarar som vanligt |
| `FILTERED` | Svarar med skärpt prompt, utan tidigare samtal, med högst 400 tokens |
| `REJECT` | Skickar en färdig text ur `guardrails` i `kar/kar.config.json`, utan att anropa modellen |

Svarar guarden inte, eller avvisar den nyckeln, behandlas frågan som `FILTERED` och chatboten fortsätter svara. Guard-tjänsten själv ingår inte i mallen.

## frontend/: gränssnittet

React med TanStack Start i SPA-läge, byggt till statiska filer. Det finns inga serverfunktioner; gränssnittet är en klient som gör ett `fetch` mot `/api/chat`. `npm run build:pages` bygger och kopierar resultatet till `pages/`, som Workern serverar.

`pages/` checkas inte in. Deploy-jobbet bygger det, och lokalt byggs det vid behov. Lösenordet sparas i `sessionStorage` och följer inte med mellan flikar eller efter att fliken stängts. Sidan får inte bäddas in på andra webbplatser.

## local/: mäta utan att förbruka kvot

Samma pipeline som i produktion, men mot [Ollama](https://ollama.com) på din egen dator. Att bygga indexet och köra utvärderingen kostar ingenting lokalt, medan det i produktion drar från dagskvoten.

Det går att lita på eftersom båda sidor kör samma embeddingmodell, `bge-m3`, och ger identiska vektorer: cosinuslikheten mellan en Cloudflare-embedding och en Ollama-embedding av samma text är 1,0000.

| Verktyg | Syfte |
|---|---|
| `localindex.ts` | Bygger ett lokalt vektorindex, återanvänder embeddings för oförändrade stycken |
| `evaluate.ts` | Kör utvärderingsfrågorna, rapporterar recall@8 och MRR |
| `experiments.ts` | Jämför styckestorlekar och inställningar mot varandra |
| `tune.ts` | Strukturmått: antal stycken, lagring, kontextkostnad per fråga |
| `duplicates.ts` | Hittar översättningspar och skriver `kar/duplicates.json` |
| `glossary-build.ts`, `compare-glossary.ts` | Bygger en ordlista över förkortningar och mäter om den hjälper sökningen. Den gjorde det inte, så den används inte i drift. |
| `devserver.ts` | Hela chatten lokalt, med produktionens systemprompt. Lyssnar bara på den egna datorn. |
| `evalcore.ts` | Gemensam inläsning och poängsättning, så att alla verktyg mäter samma sak |

## GitHub Actions

| Workflow | När | Vad |
|---|---|---|
| `ingest.yml` | Var sjätte timme, och för hand | Indexerar, committar `manifest.json` |
| `deploy.yml` | Push till `main` som rör chatten, och för hand | Kontrollerar konfigurationen, bygger gränssnittet, deployar Workern, sätter lösenordet |

Båda hoppar över sig själva om repovariabeln `CLOUDFLARE_ACCOUNT_ID` saknas, så att en ny kopia av mallen inte får misslyckade jobb innan den är konfigurerad. Cloudflare-nyckeln ges bara till de steg som deployar och indexerar, inte till installationen av beroenden.

## Tester

```bash
cd worker && npm test       # chattflödet, prompten, historiken, guardrails-klienten
cd ingestion && npm test    # källtyperna
cd frontend && npm run lint && npm run format:check
```

Testerna ersätter Workers AI, Vectorize och guarden, så de kostar ingen kvot och kräver inget konto.

## Uppdatera från mallen {#uppdatera-fran-mallen}

En kårs repo är en klon av mallen, med mallen som `upstream`. Förbättringar hämtas med git:

```bash
git remote add upstream {{ site.repository_url }}.git
git config merge.ours.driver true
git pull upstream main
```

De två första raderna görs en gång. Mallen ändrar aldrig `kar/` efter att en kår skapat sin klon, och `.gitattributes` behåller kårens version av `kar/` om den ändå skulle göra det; det är vad `merge.ours.driver` slår på. Allt annat är gemensam kod. Ändra den i mallen, inte i klonen, annars blir det konflikter vid nästa uppdatering.
