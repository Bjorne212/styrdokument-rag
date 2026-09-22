---
layout: default
title: Hålla dokumenten korrekta
permalink: /uppdatera/
---

# Hålla dokumenten korrekta

<p class="lead">Boten läser kårens publika dokumentarkiv och ingenting annat. Den som ändrar i arkivet ändrar vad boten svarar. Den här sidan beskriver hur det går till, och hur man ser till att boten citerar rätt version.</p>

## Arkivet är facit

Det finns inget eget uppladdningsgränssnitt för boten, och det är avsiktligt. Dokumenten publiceras på samma ställe som förut, till exempel kårens webbplats eller GitLab-arkiv, och boten hämtar dem därifrån. Det finns alltså bara en plats att hålla uppdaterad, och boten kan aldrig visa ett dokument som medlemmarna inte själva kan öppna.

Konsekvensen är enkel: **allt som ligger i arkivet kan citeras**. Ligger en upphävd policy kvar i listan är den lika giltig för boten som den nya.

## Från beslut till svar

```
Kårfullmäktige fattar beslut
   ▼
Justerad PDF publiceras i arkivet
   ▼
Nästa indexering (inom 6 timmar, eller direkt för hand)
   │  upptäcker ändringen, läser in texten, ersätter de gamla styckena
   ▼
Chatten svarar utifrån den nya versionen
```

Indexeringen körs automatiskt klockan 00, 06, 12 och 18 (UTC). Vill ni inte vänta:

1. Öppna repot på GitHub och gå till fliken **Actions**.
2. Välj **Indexera styrdokument** i listan till vänster.
3. Klicka **Run workflow** och sedan den gröna knappen.

Körningen tar någon minut när bara ett fåtal dokument ändrats.

## Ersätta ett dokument

**Behåll filnamnet.** Ett dokument identifieras av sektion och sökväg, till exempel `allmant/pdf/Reglemente.pdf`. Laddas en ny version upp under samma namn känner indexeringen igen den som *samma dokument*, byter ut dess stycken och tar bort de som inte längre finns. Inga gamla rester ligger kvar.

**Byter ni filnamn** (till exempel `Mottagningspolicy-2022.pdf` → `Mottagningspolicy-2024.pdf`) blir den nya filen ett nytt dokument. Den gamla filen måste då tas bort ur arkivet, annars indexeras båda och boten kan citera fel årgång. Det här är det vanligaste felet i praktiken: LinTeks arkiv innehåller i skrivande stund både `Mottagningspolicy-2020.pdf` och `Mottagningspolicy-2022.pdf`.

Rekommendationen är därför:

- Filnamn utan år eller versionsnummer: `Mottagningspolicy.pdf`, inte `Mottagningspolicy-2022.pdf`.
- Versionshistoriken skrivs *i* dokumentet, i en ändringstabell. Boten kan då svara på frågor som "när ändrades reglementet senast?".
- Äldre versioner som ska sparas för eftervärlden läggs i ett arkiv som inte är en del av den publika listan.

### Om arkivet är en vanlig webbsida

Med källtypen `html-links` upptäcks ändringar genom att sidan med länkarna ändras. Byts en PDF ut under **exakt samma filnamn** ändras inte sidan, och ändringen syns inte förrän sidan ändras av någon annan anledning. Kör då indexeringen för hand med rutan **Indexera om allt** ikryssad. Den läser in alla dokument på nytt, vilket kostar omkring 300 neurons för ett arkiv av LinTeks storlek. Se [Konfiguration](../konfiguration/#kalltyper) för hur de andra källtyperna upptäcker ändringar.

## Lägga till och ta bort

- **Nytt dokument:** publicera det i arkivet. Nästa indexering tar med det.
- **Upphävt dokument:** ta bort det ur arkivet. Nästa indexering tar bort dess stycken ur boten.
- **Ny sektion** (till exempel en ny sida för "Reglementen för utskott"): lägg till den i `source.sections` i `kar.config.json`. Det kräver en ändring i repot, inte bara i arkivet.

## Så blir PDF:en läsbar

Boten läser texten i PDF:en, inte bilden av den. Hur dokumentet är gjort påverkar hur bra svaren blir.

| Gör | Undvik |
|---|---|
| Exportera från Word eller Google Docs som PDF | Skanna ett utskrivet dokument. Utan textlager finns ingen text att läsa. |
| Numrerade rubriker, som "4.2 Kårstyrelsen" | Rubriker som bara är fetstil. De numrerade känns igen och gör att svaret kan hänvisa till rätt avsnitt. |
| Text som text | Viktiga regler i tabeller eller bilder. Tabeller blir ofta rader utan sammanhang. |
| Öppna PDF:er | Lösenordsskyddade PDF:er. De kan inte läsas. |

Snabbtest: öppna PDF:en och försök markera en mening med musen. Går det inte saknas textlager.

**Ny sidfot eller ny mall?** Rader som står på varje sida (adress, organisationsnummer, "Sida 3 av 12") rensas bort med hjälp av listan `cleanup.boilerplate` i `kar.config.json`. Byter kåren dokumentmall med en ny sidfot, lägg till textbitarna där. Annars blir sidfoten den mest förekommande texten i hela indexet.

## Svenska och engelska versioner

Finns samma dokument på både svenska och engelska tävlar versionerna om samma platser i svaret, och boten kan citera samma regel två gånger. Översättningar hoppas därför över med hjälp av listan `ingestion/duplicates.json`.

När en ny översättning publiceras, lägg till dess id i `skip`:

```json
{
  "skip": [
    "allmant/pdf/Job descriptions.pdf",
    "allmant/pdf/Goals and Visions document.pdf"
  ]
}
```

Id:t är sektionens id, ett snedstreck och filens sökväg som den står i `ingestion/manifest.json`. För många nya översättningar samtidigt går det att köra den automatiska dubblettanalysen, se [Utvärdering](../utvardering/#dubbletter).

## Kontrollera att boten har rätt version

Tre ställen, från snabbast till mest detaljerat:

1. **Fråga boten.** Ställ en fråga vars svar bara står i den nya versionen och kontrollera att källan som visas ovanför svaret är rätt dokument.
2. **Loggen från körningen.** Under *Actions → Indexera styrdokument →* senaste körningen står varje dokument som uppdaterats (`uppdaterade allmant/pdf/Reglemente.pdf (42 chunkar)`) eller tagits bort (`tog bort ...`).
3. **`ingestion/manifest.json`** i repot. Här står varje dokument som finns i boten, med titel, adress, uppladdningsdatum och en hash av filen. Saknas ett dokument här finns det inte i boten.

## Checklista efter ett kårfullmäktige {#checklista}

Lämpligt ansvar för den som redan publicerar protokoll och justerade dokument, till exempel talperson eller sekreterare.

1. Publicera de justerade dokumenten i arkivet, **under samma filnamn** som tidigare versioner.
2. Ta bort upphävda dokument och gamla årgångar ur den publika listan.
3. Kör **Indexera styrdokument** för hand, eller vänta högst sex timmar.
4. Kontrollera att körningen blev grön och att de ändrade dokumenten står i loggen.
5. Ställ en kontrollfråga i chatten om något som ändrades.

## När boten citerar något gammalt {#gammalt}

| Trolig orsak | Åtgärd |
|---|---|
| Den gamla versionen ligger kvar i arkivet under ett annat namn | Ta bort den ur arkivet och kör indexeringen. |
| Filen byttes ut under samma namn på en vanlig webbsida (`html-links`) | Kör indexeringen med **Indexera om allt** ikryssad. |
| Indexeringen har inte körts sedan ändringen | Kör den för hand. |
| Senaste körningen misslyckades | Se [Drift](../drift/#felsokning). |
| En avbruten körning har lämnat gamla stycken kvar | Kör `npm run prune` i `ingestion/`, se [Drift](../drift/#for-hand). |
