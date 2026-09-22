---
layout: default
title: Så fungerar det
permalink: /oversikt/
---

# Så fungerar det

<p class="lead">Styrdokumentsboten svarar på frågor om en kårs styrdokument: stadga, reglemente, policyer, riktlinjer och verksamhetsplaner. Svaren bygger enbart på dokumenten och hänvisar alltid till källan.</p>

Projektet började som [LinTeks styrdokumentsbot](https://github.com/Bjorne212/linus) och är nu en mall som vilken kår som helst kan använda. Allt som är specifikt för en kår står i en enda fil, `kar.config.json`. Resten av koden är gemensam. Hela systemet ryms i GitHubs och Cloudflares gratisnivåer.

## Grundidén

En kårs styrdokument är ofta hundratals sidor PDF. En språkmodell kan inte få hela arkivet med varje fråga: det får inte plats och skulle bli orimligt dyrt.

Lösningen heter *retrieval-augmented generation* (RAG): hitta de få stycken som troligast innehåller svaret, ge bara dem till modellen och kräv att den håller sig till dem. Står svaret inte i dokumenten säger boten det i stället för att gissa.

Det betyder också att **boten aldrig är bättre än arkivet den läser**. Ligger en gammal version av en policy kvar bredvid den nya kan boten citera båda. Därför handlar det mesta av driften om att hålla arkivet rätt, se [Hålla dokumenten korrekta](../uppdatera/).

## Två delar

**Indexeringen** körs i GitHub Actions var sjätte timme. Den kontrollerar om något ändrats i kårens dokumentarkiv, och bara då laddar den ner PDF:erna, delar texten i stycken och gör om varje stycke till en vektor som sparas i Cloudflare Vectorize.

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

Workern läser alltid det som ligger i indexet just då. En ändring i arkivet syns i chatten efter nästa indexering, utan omstart eller ny deploy.

## Vad boten inte klarar

| Begränsning | Varför |
|---|---|
| Sammanställande frågor, som "i vilka verksamhetsplaner nämns X?" | Modellen ser bara åtta stycken per fråga, inte hela arkivet. |
| Ungefär 80 till 90 frågor per dygn totalt | Gratisnivån i Workers AI är 10 000 neurons per dygn, delat av alla användare. |
| Skannade PDF:er utan textlager | Texten läses ur PDF:en, det görs ingen OCR. |
| Källdokumentet är alltid facit | Boten kan missa ett stycke eller formulera om fel. Läs originalet innan du agerar. |

## Integritet

Ingenting sparas. Inga konton, ingen chatthistorik på servern, inga IP-adresser, inga loggar av frågor eller svar. Workern har ingen databas att skriva till. Följdfrågor fungerar ändå, eftersom webbläsaren skickar med de senaste utbytena i varje anrop. Mer i [Drift](../drift/#integritet).

## Dokumentationen

| Sida | Innehåll |
|---|---|
| [Hålla dokumenten korrekta](../uppdatera/) | Hur nya och ändrade PDF:er når boten, och hur man undviker att den citerar gamla versioner |
| [Drift](../drift/) | Rutiner, övervakning, överlämning mellan styrelser och felsökning |
| [Kostnader](../kostnader/) | Vad som ingår gratis, vad en fråga kostar och vad som händer vid större användning |
| [Konfiguration](../konfiguration/) | Alla fält i `kar.config.json`, källtyper, färger och logga |
| [Arkitektur](../arkitektur/) | Hur koden är uppdelad, fil för fil, och varför |
| [Utvärdering](../utvardering/) | Hur man mäter att sökningen hittar rätt |
