---
layout: default
title: Konfiguration
permalink: /konfiguration/
---

# Konfiguration

Allt som skiljer en kår från en annan står i `kar.config.json` i repots rot. Indexeringen, Workern och gränssnittet läser samma fil via `shared/config.ts`, så ett namn ändras på ett ställe och slår igenom överallt.

Kör alltid det här efter en ändring:

```bash
node scripts/configure.mjs
```

Skriptet kontrollerar att filen är komplett och skriver över Workerns namn och indexets namn till `worker/wrangler.toml`, som inte kan läsa JSON själv. Deploy-jobbet kör det automatiskt, men det är bra att fånga fel innan man pushar.

## Fälten

```json
{
  "id": "lintek",
  "name": "LinTek",
  "nameGenitive": "LinTeks",
  "description": "teknologsektionernas studentkår vid Linköpings universitet",
  "botName": "Styrdokumentsboten",
  "documentsUrl": "https://lintek-styrdokument.gitlab-pages.liu.se/allmant/",
  "author": { "name": "Theodor Lindberg", "url": "https://..." },
  "cloudflare": {
    "workerName": "lintek-styrdokument-rag",
    "indexName": "lintek-styrdokument"
  },
  "source": { "type": "gitlab-appender", "...": "se nedan" },
  "cleanup": {
    "boilerplate": ["Postadress LinTek", "Org.nr 822001-0683"],
    "swedishMarkers": ["kårfullmäktige", "LinTeks"]
  }
}
```

| Fält | Används till |
|---|---|
| `id` | Kort id i gemener. Nyckel för lösenordet i webbläsarens `sessionStorage`. |
| `name` | Kårens namn i löptext, i systemprompten och som alt-text på loggan. |
| `nameGenitive` | Genitivformen, t.ex. "LinTeks" eller "Kårens". Svenska genitiver går inte att gissa (Stockholms universitets studentkår, Karlstads studentkår), så den skrivs ut. |
| `description` | Fortsättningen på meningen "*name* är ..." i systemprompten. Ger modellen sammanhang om vad för organisation det gäller. |
| `botName` | Botens namn i fliktiteln och sidhuvudet. |
| `documentsUrl` | Länken "Öppna fullständiga styrdokument" på startsidan. |
| `author` | Namn och länk i sidfoten. |
| `cloudflare.workerName` | Workerns namn. Blir en del av adressen: `https://<workerName>.<konto>.workers.dev`. Gemener, siffror och bindestreck. |
| `cloudflare.indexName` | Vectorize-indexets namn. Måste finnas i Cloudflare, se [Kom igång](../kom-igang/#cloudflare). |
| `source` | Var dokumenten finns och hur de läses. Se nästa avsnitt. |
| `cleanup.boilerplate` | Textbitar ur sidhuvud och sidfot. Varje rad som *innehåller* någon av dem tas bort före indexering. |
| `cleanup.swedishMarkers` | Extra ord som bara förekommer i svensk text. Används för att märka varje stycke som svenska eller engelska. |

> Byt inte sektionernas `id` i efterhand. Id:t ingår i varje dokuments identitet, så en ändring gör att alla dokument i sektionen ser nya ut och indexeras om, medan de gamla vektorerna tas bort. Det fungerar men kostar kvot i onödan.

## Källtyper {#kalltyper}

Kårer publicerar sina styrdokument på olika sätt. `source.type` väljer hur arkivet läses. Alla källtyper delar in dokumenten i **sektioner**. En sektion är en grupp som visas i källhänvisningen ("Reglemente, *Allmänt*") och är enheten för ändringskontroll.

### html-links: en webbsida med länkar

Det vanligaste fallet. Varje sektion är en webbsida, och varje `<a href>` på sidan som pekar på en `.pdf` blir ett dokument. Länktexten blir titeln, eller filnamnet om länken saknar text.

```json
"source": {
  "type": "html-links",
  "sections": [
    { "id": "stadga", "label": "Stadga och reglemente", "url": "https://karen.se/styrdokument" },
    { "id": "policyer", "label": "Policyer", "url": "https://karen.se/styrdokument/policyer" }
  ]
}
```

Har kåren alla dokument på en sida räcker en sektion. Relativa länkar (`pdf/stadga.pdf`, `/filer/stadga.pdf`) löses mot sidans adress.

**Ändringskontroll:** en hash av sidans HTML. Läggs ett dokument till eller tas bort ändras sidan. Byts en PDF ut under exakt samma filnamn märks det först när sidan ändras på annat sätt; kör då **Indexera styrdokument** med *force* ikryssat.

**Fungerar inte** om sidan bygger dokumentlistan med JavaScript i webbläsaren, eftersom indexeringen läser den råa HTML:en. Testa med `curl -s <url> | grep -i pdf`: syns inga länkar, använd `pdf-list` eller skriv en egen källtyp.

### pdf-list: en handskriven lista

För arkiv som inte går att läsa av, eller dokument utspridda på flera ställen.

```json
"source": {
  "type": "pdf-list",
  "sections": [
    {
      "id": "grund",
      "label": "Grundläggande dokument",
      "documents": [
        { "title": "Stadga", "url": "https://karen.se/filer/stadga.pdf" },
        { "url": "https://karen.se/filer/reglemente.pdf" }
      ]
    }
  ]
}
```

`title` är valfri; utan den används filnamnet. Nackdelen är uppenbar: listan måste uppdateras för hand när ett dokument tillkommer.

**Ändringskontroll:** ett HEAD-anrop per fil, och `ETag` eller `Last-Modified` från servern. Svarar servern utan någon av dem laddas sektionen ner och hashas vid varje körning. Det fungerar, men tar lite längre tid.

### gitlab-appender: LinTeks arkiv

LinTeks arkiv på GitLab Pages har en sida per sektion där tabellen fylls i av en JavaScript-fil, `/<sektion>/js/document-appender.js`. Källtypen läser den filen direkt.

```json
"source": {
  "type": "gitlab-appender",
  "baseUrl": "https://lintek-styrdokument.gitlab-pages.liu.se",
  "sections": [
    { "id": "allmant", "label": "Allmänt" },
    { "id": "policys", "label": "Policys" }
  ]
}
```

Sektionens `id` är samtidigt dess sökväg i arkivet. Använder er kår samma arkivmall som LinTek fungerar den direkt.

**Ändringskontroll:** GitLab Pages sätter samma `ETag` på allt i en sektion, så ett HEAD-anrop per sektion räcker.

### En egen källtyp

Om inget av ovanstående passar är en ny källtyp ungefär 50 rader. En källa behöver bara kunna två saker:

```ts
type ArchiveSource = {
  sections: { id: string; label: string }[];
  /** Alla dokument i en sektion. */
  listDocuments(sectionId: string): Promise<ArchiveDocument[]>;
  /** Något som ändras när sektionen ändras. null = kontrollera alltid. */
  fingerprint(sectionId: string): Promise<string | null>;
};
```

1. Skriv en fil i `ingestion/src/sources/` som returnerar en `ArchiveSource`. Utgå från `html-links.ts`.
2. Lägg till konfigurationstypen i `SourceConfig` i `shared/config.ts`.
3. Lägg till en rad i switchen i `ingestion/src/sources/index.ts` och typen i listan i `scripts/configure.mjs`.

Ett dokuments `id` ska vara stabilt mellan körningar, eftersom vektorernas id:n räknas fram ur det. Konventionen är `<sektion>/<sökväg>`.

## Utseende

Gränssnittet hämtar alla texter om kåren ur konfigurationen. Tre saker ligger som filer:

| Fil | Innehåll |
|---|---|
| `frontend/src/assets/logo.png` | Loggan. Visas mot mörk bakgrund, så en ljus eller vit variant fungerar bäst. |
| `frontend/public/favicon.png` | Flikikonen. |
| `frontend/src/styles.css` | Färgerna. `--primary` styr knappar och länkar, `--hero-glow-1` och `--hero-glow-2` den tonade bakgrunden på startsidan. Färgerna skrivs i `oklch`; [oklch.com](https://oklch.com) räknar om från hex. |

Typsnittet D-DIN ligger lokalt i `frontend/public/fonts/` och får spridas vidare (SIL OFL). Det serveras från samma adress som sidan, så att ingen besökare kontaktar en tredje part.

## Justerbara värden i Workern

I `worker/wrangler.toml` under `[vars]`. Ändras utan kodändring, slår igenom vid nästa deploy.

| Variabel | Standard | Betydelse |
|---|---|---|
| `TOP_K` | `8` | Antal stycken som hämtas och skickas till modellen. Fler ger bättre täckning men kostar mer kvot per fråga. |
| `HISTORY_TURNS` | `2` | Antal tidigare fråga/svar-par som följer med en följdfråga. `0` stänger av följdfrågor. |
| `HISTORY_ANSWER_CHARS` | `500` | Hur mycket av ett tidigare svar som skickas med. |

Lösenordet sätts som secret, aldrig här. Se [Kom igång](../kom-igang/#hemligheter).

## Systemprompten

Prompten ligger i `worker/src/prompt.ts` och är gemensam för alla kårer. Den kräver att modellen bara svarar ur de hämtade styckena, säger ifrån när svaret saknas, hänvisar till dokument och avsnitt, och svarar på frågans språk. Kårens namn och beskrivning fylls i från konfigurationen.

Vill en kår ändra tonen eller lägga till regler görs det i den filen. Mät med utvärderingen före och efter, se [Utvärdering](../utvardering/).
