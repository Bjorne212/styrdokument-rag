---
layout: default
title: Översikt
---

# Styrdokument-RAG

<p class="lead">En chattbot som svarar på frågor om en studentkårs styrdokument: stadga, reglemente, policyer, riktlinjer och verksamhetsplaner. Svaren bygger enbart på dokumenten och hänvisar alltid till källan.</p>

Projektet började som [LinTeks styrdokumentsbot](https://github.com/Bjorne212/linus) och är nu en mall som vilken kår som helst kan använda. Allt som är specifikt för en kår står i en enda fil, `kar.config.json`. Resten av koden är gemensam.

Hela systemet ryms i GitHubs och Cloudflares gratisnivåer. Det finns ingen server att sköta och inget att betala.

## Vad problemet är

En kårs styrdokument är ofta hundratals sidor PDF. Ingen läser igenom dem för att ta reda på hur många ledamöter styrelsen har, och en språkmodell kan inte få hela arkivet med varje fråga: det får inte plats och skulle bli orimligt dyrt.

Lösningen heter *retrieval-augmented generation* (RAG): hitta de få stycken som troligast innehåller svaret, ge bara dem till modellen och kräv att den håller sig till dem. Om svaret inte står i dokumenten säger boten det i stället för att gissa.

## Så fungerar det

Systemet har två delar som arbetar oberoende av varandra.

**Indexeringen** körs i GitHub Actions var sjätte timme. Den kontrollerar om något ändrats i kårens dokumentarkiv, och bara om något ändrats laddar den ner PDF:erna, delar texten i stycken och gör om varje stycke till en vektor som sparas i Cloudflare Vectorize.

```
GitHub Actions (var sjätte timme)
   │  1. Billigt fingeravtryck per sektion (t.ex. ETag). Oförändrat = klart.
   │  2. Ladda ner ändrade PDF:er, jämför sha256 mot manifestet
   │  3. Extrahera text, dela i stycken, gör om till vektorer (bge-m3)
   │  4. Skriv till Vectorize, ta bort vektorer för borttagna dokument
   ▼
Cloudflare Vectorize
```

**Chatten** är en Cloudflare Worker som både serverar webbsidan och svarar på frågor.

```
Webbläsaren
   │  POST /api/chat  { question, history }
   ▼
Cloudflare Worker
   │  1. Kontrollera lösenordet (konstant tid)
   │  2. Gör om frågan till en vektor (bge-m3)
   │  3. Hämta de 8 närmaste styckena ur Vectorize
   │  4. Bygg en prompt som förbjuder svar utanför styckena
   │  5. Strömma svaret tillbaka, källorna först
   ▼
Webbläsaren visar svaret medan det skrivs, med länkar till PDF:erna
```

Workern läser alltid det som ligger i indexet just då. En ändring i arkivet syns alltså i chatten utan omstart eller ny deploy.

## Vad en kår behöver

- Ett **publikt dokumentarkiv** med styrdokumenten som PDF. Det kan vara en sida med länkar, ett GitLab- eller GitHub Pages-arkiv, eller en lista med adresser. Se [källtyper](konfiguration/#kalltyper).
- Ett **GitHub-konto** för att kopiera mallen och köra det schemalagda jobbet.
- Ett **Cloudflare-konto** (gratis) för Workern, språkmodellen och vektordatabasen.
- Någon som klarar att följa en steg-för-steg-guide i en terminal, ungefär en timme första gången.

Nästa steg: [Kom igång för en ny kår](kom-igang/).

## Vad boten inte klarar

| Begränsning | Varför |
|---|---|
| Sammanställande frågor, som "i vilka verksamhetsplaner nämns X?" | Modellen ser bara åtta stycken per fråga, inte hela arkivet. |
| Ungefär 80 till 90 frågor per dygn totalt | Gratisnivån i Workers AI är 10 000 neurons per dygn, delat av alla användare. |
| Skannade PDF:er utan textlager | Texten läses ur PDF:en, det görs ingen OCR. |
| Källdokumentet är alltid facit | Boten kan missa ett stycke eller formulera om fel. Läs originalet innan du agerar. |

## Integritet

Ingenting sparas. Inga konton, ingen chatthistorik på servern, inga IP-adresser, inga loggar av frågor eller svar. Workern har ingen databas att skriva till. Följdfrågor fungerar ändå, eftersom webbläsaren skickar med de senaste utbytena i varje anrop. Mer i [Drift och gränser](drift/#integritet).

## Dokumentationen

| Sida | Innehåll |
|---|---|
| [Kom igång](kom-igang/) | Steg för steg från tomt Cloudflare-konto till en fungerande bot |
| [Konfiguration](konfiguration/) | Alla fält i `kar.config.json`, källtyper, färger och logga |
| [Arkitektur](arkitektur/) | Hur koden är uppdelad, fil för fil, och varför |
| [Utvärdering](utvardering/) | Hur man mäter att sökningen hittar rätt, och beslut som kom ur mätningar |
| [Drift och gränser](drift/) | Kvoter, kostnader, felsökning och integritet |
