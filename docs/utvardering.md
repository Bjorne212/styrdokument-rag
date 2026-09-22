---
layout: default
title: Utvärdering
permalink: /utvardering/
---

# Utvärdering

Svarens kvalitet avgörs mycket mer av **sökningen** än av språkmodellen. Hittar sökningen inte rätt stycke kan inget svar bli rätt, hur bra modellen än är. Därför mäts sökningen, och ändringar som låter självklara prövas innan de behålls.

## Frågor med facit

`eval/questions.json` innehåller frågor där svaret är känt. Varje fråga har fraser som måste finnas i ett hämtat stycke och dokument som stycket måste komma ifrån:

```json
{
  "id": "kf-karstyrelse-storlek",
  "question": "Hur många ledamöter har kårstyrelsen?",
  "kind": "specifik",
  "expectPhrases": ["2-4 ledamöter", "två (2) till fyra (4)"],
  "expectDocuments": ["Reglemente.pdf", "Stadga.pdf"]
}
```

En fråga räknas som träff om något av de hämtade styckena kommer från ett av `expectDocuments` *och* innehåller minst en av `expectPhrases`. Jämförelsen bryr sig inte om skiftläge eller radbrytningar.

`expectDocuments` jämförs med dokumentets titel. För `gitlab-appender` är titeln filnamnet, för `html-links` är den länktexten. Kör `node ingestion/src/scrape.ts` och titta i `ingestion/out/documents.json` om du är osäker.

### Skriva frågor för en ny kår

Mallen innehåller LinTeks tjugo frågor. En ny kår behöver egna, 15 till 20 stycken räcker långt. Blanda sorterna:

| Sort | Exempel | Varför |
|---|---|---|
| Specifik | "Hur många ledamöter har styrelsen?" | Det vanligaste. Ett svar på ett ställe. |
| Förkortning | "Vad står SA för?" | Korta ord ger svaga vektorer. |
| Generell | "Hur går ett val till?" | Svaret är utspritt över flera stycken. |
| Historik | "När ändrades reglementet senast?" | Ändringstabeller är svåra att hitta. |

Hämta facit ur dokumenten, inte ur minnet, och kopiera fraserna ordagrant. En fras som inte står i texten gör att frågan aldrig kan räknas som träff.

## Mått

- **Recall@8:** andelen frågor där rätt stycke finns bland de åtta som skickas till modellen. Under 100 % finns frågor som inte kan få rätt svar.
- **MRR** (mean reciprocal rank): hur högt rätt stycke rankas. Plats 1 ger 1,0, plats 4 ger 0,25. Högre betyder att modellen får det viktiga först.

LinTeks nuvarande värden: recall 20 av 20, MRR 0,718.

## Köra utvärderingen

Lokalt med Ollama, utan att röra Cloudflare-kvoten:

```bash
ollama pull bge-m3
cd local
node src/localindex.ts    # första gången tar det några minuter
node src/evaluate.ts
```

`evaluate.ts` visar varje fråga med rangen för rätt stycke, och sammanfattningen. Ändra något i `ingestion/src/chunk.ts`, bygg om indexet med `node src/localindex.ts --rebuild` och kör igen.

`node src/experiments.ts` jämför flera styckestorlekar i samma körning.

## Beslut som kom ur mätningar {#beslut}

Tre ändringar som verkade självklart bra prövades i stället för att antas. Två av dem var fel.

| Ändring | Förväntan | Uppmätt | Beslut |
|---|---|---|---|
| Mindre stycken (900 i stället för 1 200 tecken) | Fler frågor per dygn, mindre lagring | MRR föll från 0,605 till 0,548 | Återställd |
| Expandera förkortningar i frågan | Bättre träff på "vad står SA för" | MRR föll från 0,605 till 0,576 | Bortkopplad |
| Ta bort engelska översättningar | Färre dubbletter som tävlar om platserna | MRR steg från 0,605 till 0,718 | Behållen |

Siffrorna gäller LinTeks arkiv. En annan kårs dokument kan bete sig annorlunda, så mät med egna frågor innan du ändrar standardvärdena.

## Dubbletter {#dubbletter}

Många kårer publicerar samma dokument på svenska och engelska. Båda versionerna tävlar då om samma åtta platser, och svaret kan citera samma regel två gånger på två språk. För LinTek var det enskilt största förbättringen att hoppa över översättningarna.

Filnamnen avslöjar inte släktskapet ("Stadga" och "Bylaw" delar inget ord), men innehållet gör det: `bge-m3` är flerspråkig och placerar en text och dess översättning nära varandra. `duplicates.ts` jämför dokumentens genomsnittsvektorer och parar ihop dem girigt:

```bash
cd local
node src/localindex.ts
node src/duplicates.ts --threshold 0.75
```

Resultatet skrivs till `ingestion/duplicates.json`. Läs igenom paren innan du committar. Filen är avsiktligt lätt att redigera för hand: ta bort ett par som blivit fel. Nästa indexering tar bort vektorerna för dokumenten i `skip`.
