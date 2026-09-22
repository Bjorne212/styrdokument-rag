---
layout: default
title: Kom igång för en ny kår
permalink: /kom-igang/
---

# Kom igång för en ny kår

Den här guiden tar dig från ingenting till en fungerande bot för din kår. Räkna med ungefär en timme första gången. Du behöver [Node.js 24](https://nodejs.org), git och en terminal.

> Kodblocken utgår från repots rot om inget annat sägs. Kör dem i den ordning de står. Flera steg beror på att det förra är klart, till exempel måste indexet finnas i Cloudflare innan Workern kan deployas.

## 1. Skapa ett eget repo från mallen

Gå till [mallrepot på GitHub]({{ site.repository_url }}) och klicka på **Use this template → Create a new repository**. Välj ett namn, till exempel `karen-styrdokument-rag`. Klona sedan ditt nya repo:

```bash
git clone https://github.com/<ditt-konto>/<ditt-repo>.git
cd <ditt-repo>
```

Mallen levereras konfigurerad för LinTek, som är referensinstansen. Två datafiler gäller bara LinTeks arkiv. Nollställ dem direkt:

```bash
rm ingestion/duplicates.json
echo '{}' > worker/src/glossary.json
```

`eval/questions.json` innehåller LinTeks utvärderingsfrågor. Skriv om den för din kår när du kommit igång, se [Utvärdering](../utvardering/).

## 2. Beskriv kåren i kar.config.json

Öppna `kar.config.json` i repots rot och fyll i kårens uppgifter. Det viktigaste är `source`, som talar om var dokumenten finns. Alla fält beskrivs på sidan [Konfiguration](../konfiguration/), och det finns färdiga exempel i `examples/`.

Kontrollera filen och för över namnen till Workerns inställningar:

```bash
node scripts/configure.mjs
```

Testa sedan att dokumenten hittas. Det här läser bara arkivet och rör ingenting i Cloudflare:

```bash
cd ingestion
npm ci
node src/scrape.ts --verify
```

Du ska se en rad per sektion med antal dokument, och `OK: alla ... URL:er svarade`. Titta också, fortfarande i `ingestion/`, på hur texten blir när den städats:

```bash
node src/chunk.ts --limit 5
```

Står kårens adress, organisationsnummer eller liknande sidfot på varje sida? Lägg in de textbitarna i `cleanup.boilerplate` och kör igen.

## 3. Byt logga och färger

| Fil | Vad |
|---|---|
| `frontend/src/assets/logo.png` | Loggan i sidhuvudet. Gärna ljus, bakgrunden är mörk. |
| `frontend/public/favicon.png` | Ikonen i webbläsarfliken. |
| `frontend/src/styles.css` | `--primary` (knappar och länkar) och `--hero-glow-1`, `--hero-glow-2` (startsidan). Kommentarerna i filen visar var. |

## 4. Skapa Cloudflare-resurserna {#cloudflare}

Skapa ett gratis konto på [cloudflare.com](https://dash.cloudflare.com/sign-up) om kåren inte har ett. Logga sedan in från terminalen och skapa vektordatabasen. Indexnamnet ska vara samma som `cloudflare.indexName` i `kar.config.json`. Från repots rot:

```bash
cd worker
npm ci
npx wrangler login
npx wrangler vectorize create <indexName> --dimensions=1024 --metric=cosine
```

1024 dimensioner är vad embeddingmodellen `bge-m3` ger. Ett index med andra dimensioner avvisas av indexeringen.

Skapa därefter en **API-token** under *My Profile → API Tokens → Create Token*. Utgå från mallen **Edit Cloudflare Workers**, som ger det deploy-jobbet behöver, och lägg till två behörigheter på kontonivå:

| Behörighet | Nivå | Används av |
|---|---|---|
| Workers AI | Read | Indexeringen (embeddings) |
| Vectorize | Edit | Indexeringen (skriva och ta bort vektorer) |
| Workers Scripts | Edit | Deploy-jobbet (ingår i mallen) |

Begränsa gärna token till kårens konto under *Account Resources*.

Kopiera också ditt **Account ID**. Det står i högerspalten på översiktssidan för Workers & Pages.

## 5. Lägg in hemligheterna i GitHub {#hemligheter}

I ditt repo på GitHub, gå till *Settings → Secrets and variables → Actions*.

| Typ | Namn | Värde |
|---|---|---|
| Variables | `CLOUDFLARE_ACCOUNT_ID` | Account ID från steg 4 |
| Secrets | `CLOUDFLARE_API_TOKEN` | Token från steg 4 |
| Secrets | `SHARED_PASSWORD` | Lösenordet som användarna ska skriva in i chatten |

Account ID läggs som *variabel*, inte som secret. Den är inte hemlig, och jobben använder den för att avgöra om repot är konfigurerat: saknas den hoppas jobben över i stället för att misslyckas.

## 6. Pusha och indexera

Committa ändringarna och pusha:

```bash
git add -A
git commit -m "Konfigurera för <kåren>"
git push
```

Pushen startar jobbet **Deploya chatten**, som bygger gränssnittet och deployar Workern. Gå sedan till fliken *Actions*, välj **Indexera styrdokument** och klicka **Run workflow**. Den första körningen indexerar hela arkivet och tar några minuter. Den sparar ett `ingestion/manifest.json` i repot, som nästa körning jämför mot.

När båda jobben är gröna finns chatten på

```
https://<workerName>.<ditt-konto>.workers.dev
```

Adressen syns också i loggen från deploy-jobbet. Vill ni ha en egen domän, lägg till den under Workerns *Settings → Domains & Routes* i Cloudflare.

## 7. Efteråt

- Indexeringen körs nu automatiskt var sjätte timme. Den kostar nästan ingenting när inget ändrats.
- Varje push som rör `frontend/`, `worker/`, `shared/` eller `kar.config.json` deployar om chatten.
- Skriv 15 till 20 egna utvärderingsfrågor i `eval/questions.json`. Det är det enda sättet att veta om en ändring gör sökningen bättre eller sämre. Se [Utvärdering](../utvardering/).
- Har arkivet samma dokument på både svenska och engelska? Kör dubblettanalysen, se [Utvärdering](../utvardering/#dubbletter).

## Köra lokalt

Allt går att köra på din egen dator utan att röra Cloudflare-kvoten, med [Ollama](https://ollama.com) i stället för Workers AI:

```bash
ollama pull bge-m3
ollama pull llama3.1:8b

cd frontend && npm ci && npm run build:pages && cd ..
echo 'SHARED_PASSWORD=test' > worker/.dev.vars

cd local
node src/localindex.ts     # bygger ett lokalt index
node src/devserver.ts      # chatten på http://localhost:8788
```

`devserver.ts` använder exakt samma systemprompt och historikhantering som Workern. Skillnaden är språkmodellen: lokalt körs en mindre modell än i produktion.
