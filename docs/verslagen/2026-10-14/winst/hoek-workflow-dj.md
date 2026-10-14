# Hoek workflow-dj: van nummer vinden tot terugkijken

*13 okt 2026, gelezen op `studio/afmaken` (7debab6). In de repo niets gewijzigd. Meting:
`winst/meet-pastbij.mjs` (draait tegen de echte `past-bij.js` en `planner.js`).*

## Waar ik naar keek en wat ontbrak

De stroom zoals hij nu is: **kaart** (18.233 nummers, 29 kratten) → wens / "haal binnen" / nacht
(80 per nacht, alleen audio, `stems: 0`, `video: false`, `server/index.js:632`) → **library**
(op 10 okt 15 nummers, `docs/KAART.md:343`) → grid, toon en secties vanzelf op de achtergrond
(`server/index.js:880-930`) → **plan** (Claude of Clay schrijft `plannen/*.json`) → **auto-DJ**
of met de hand → opname + handelingenlog → **setboek** (alleen lezen, `tools/setboek/`).

**Wat Clay echt doet, kon ik niet uit logs halen:** in deze checkout staan geen
`opnames/*.acties.jsonl` (niet in git), en de docs zeggen dat er sinds 23 sep geen proef op de
hardware was (VISIE §5.4). Wat hieronder staat komt dus uit de code, de docs, Clay's verzoeken
en één synthetische meting. Eerste stap na een echte avond: `tools/setboek/setboek.mjs` op een
kopie van de logs (`gebruik.mjs` telt de top-10 actions en de laads) en deze lijst daartegen leggen.

Twee feiten bepalen bijna alles in deze hoek:

1. **Clay's repertoire heeft vooral onzekere grids.** AUTO-DJ.md:36 "bijna alle grids zijn
   onzeker"; HANDOFF 26 sep (tabel na ↻): Bay Ledges 0 van 6 stukken zeker, zoned out 0, drie eigen
   sets en No Surprises 0; alleen de lange mixen hebben zekere stukken. Overvloeien (beatloos) is
   daar de hoofdroute.
2. **De library groeit straks van ~15 naar honderden of duizenden** (de nacht: 80 per nacht).
   Alles wat nu per nummer met de hand gaat (tikken, cue zoeken, stems starten), schaalt niet mee.

## Meting: past bij en de kiezer van de auto-DJ (synthetisch)

`meet-pastbij.mjs` maakt libraries van 15/100/1000 nummers (tempo 80–170, toon willekeurig, 30% met
een zekere toon) met 15%, 40% of 80% zekere grids, en vraagt voor elk nummer `pastBij()` en de
kiezer `kiesVolgende()` (wat de auto-DJ zonder plan doet):

| library | zeker grid | "past bij" geeft iets | met "goed" | kiezer kiest iets uit die lijst | kiezer kiest een onzeker grid |
|---|---|---|---|---|---|
| 15 | 15% | 0% | 0% | 0% | 87% |
| 15 | 80% | 67% | 27% | 20% | 20% |
| 100 | 40% | 32% | 22% | 3% | 63% |
| 1000 | 15% | 15% | 13% | 0% | 90% |
| 1000 | 80% | 83% | 83% | 33% | 15% |

Twee bevindingen:
- Met Clay's verhouding (weinig zeker) is de knop **past bij** meestal leeg ("het grid is nergens
  zeker", `past-bij.js:35-44`), terwijl overvloeien geen grid nodig heeft.
- **De app laat Clay iets anders zien dan hij zelf doet.** `kiesVolgende` (`planner.js:167-189`)
  gebruikt het tempo ook van een onzeker grid, telt de toon alleen als beide zeker zijn, kijkt naar
  de luidheid van de upload (`loudness_i`, van vóór de normalisatie naar −14 LUFS) en voegt toeval toe.
  `pastBij` eist zekere grids en telt een gegokte toon wel. Zelfs met 80% zeker kiest de automaat
  in 67–90% van de gevallen iets dat niet in "past bij" staat. Dat raakt AUTO-DJ.md §1 ("de keuzes
  die hij jou weergeeft").

## Kansen (meeste winst eerst)

### K1. Eén oordeel over "wat komt hierna", dat ook zonder zeker grid werkt
- **Probleem:** twee regels voor hetzelfde (zie meting), en de lijst is leeg precies waar Clay het
  meest speelt (beatloos).
- **Toepassen** (1–2 dagen):
  1. `src/auto/planner.js`: `beoordeel()` uit `past-bij.js` hierheen (of `past-bij.js` importeren)
     als DE regel; een derde soort **"overvloeien"**: grid niet nodig, toon ≤ 1 stap (gegokt mag,
     met "?"), het tempo alleen als aanwijzing. Volgorde: goed (blend) > bijna > overvloeien.
  2. `kiesVolgende` rangschikt met diezelfde score (+ niet gespeeld, + toeval als gelijkspel-breker,
     niet als gewicht van 2,5% tempo). Zo is de keuze van de automaat altijd regel 1 van "past bij".
  3. `pastBij` geeft bij een onzeker grid geen lege lijst meer, maar de overvloei-lijst met de reden
     erboven ("geen zeker grid: alleen overvloeien"). Kop in `pastBijKop`.
  4. Later (K4): een plus voor nummers die eerder goed na dit nummer kwamen; uit de kaart een plus
     voor de kratten "vertrouwd"/"eigen keuze" (die staan alleen in de kaart, nu niet in de library).
  5. Tests: `test/past-bij.test.mjs` (de bestaande checks blijven; erbij: onzeker grid geeft
     overvloeien, kiezer = eerste van de lijst), `test/auto.test.mjs` (de kiezer).
- **Winst:** suggesties die passen bij wat Clay echt draait; wat het scherm (en straks het
  Maschine-scherm in het deel LIBRARY, WERKRUIMTE.md:83) toont is wat de automaat doet.
- **Risico:** klein, alles puur en getest. De volgorde van de auto-DJ zonder plan verandert
  (bedoeld). Hangt samen met de beatgrid-workflow: meer zekere grids = meer "goed"; deze kans helpt
  ook als die niets oplevert.

### K2. "Zet de set klaar": een plan vooraf echt speelklaar maken
- **Probleem:** wat van de kaart komt heeft geen stems (`server/index.js:632`). Een plan kan dus
  vol nummers staan zonder stems, en dat zie je pas op de avond. Splitsen gaat met ~3× realtime
  (STEMS.md:438): een mix van 53 minuten kost ~18 minuten, en split tijdens het spelen = Demucs naast
  het audiopad (CLAUDE.md: tekenen liet hem al op de helft lopen). Het Avondpakket kijkt naar
  bestanden, schijf en apparaten, maar niet naar het plan (`server/avondpakket.js`, geen
  plan-controle). Het planvenster toont tempo en toon met "?" maar niet stems, secties of waar het
  grid op het mengpunt onzeker is (`src/plan/` kent geen stems).
- **Toepassen** (1–2 dagen):
  1. Puur `src/plan/klaar.js`: per stap `{ stems, secties, gridOpMengpunt, toon, cue }` uit
     `/api/library` + de sectiekaart; "klaar", "let op" of "mist".
  2. In `plan-venster.js` een kolom met die stand en een knop **zet klaar**: stems voor de stappen
     zonder (`POST /api/stems … vooraan`, 2 stems), secties met `?maak=1`; geweigerd als er een deck
     speelt en op een speeldag (zelfde regel als de nacht).
  3. Avondpakket (`server/avondpakket.js`, fase vertrek): een punt "plan klaar" (het actieve plan,
     elke stap lokaal, met stems, met secties).
  4. Waar het grid op het mengpunt onzeker is: "tik hier" met een knop die het nummer op de
     MENGPLEK laadt (de hand-taak die overblijft, en alleen voor nummers die je echt speelt).
- **Winst:** geen verrassing op de avond, geen Demucs tijdens de set, en het handwerk (tikken)
  alleen waar het een overgang raakt.
- **Risico:** klein. Een split van een uur-mix duurt lang: de knop zegt vooraf hoe lang (duur / 3).

### K3. Het cuepunt op het begin van de muziek, en bewaard per nummer
- **Probleem:** na elke laad staat de cue op 0 (`deck.js:400`, `_naLaden`) en hij wordt nergens
  bewaard (tabel `hotcues`, `nr` 1..4, `server/library.js:124-130`; `hotcue-opslag.js` doet alleen
  hotcues). YouTube-video's (9.753 in de kaart) beginnen vaak met stilte of een niet-muzikaal intro
  (aanname, niet gemeten: er staat geen media in deze checkout). Met de hand draaien = bij elke laad
  eerst zoeken.
- **Toepassen** (een halve tot een hele dag):
  1. Server (`analyze.js`, al in de worker): het eerste moment boven ~−40 dBFS uit `peaks.bin`;
     ligt daar een zeker grid, dan de eerste "1" vanaf dat punt; heeft het nummer een sectiekaart,
     dan het begin van de intro. Als `cue_auto` bij de track (geen schema-wijziging nodig: `nr` 0 in
     `hotcues`, met een bron 'auto' / 'hand').
  2. `hotcue-opslag.js`: cue mee terugzetten na het laden (alleen als Clay nog niets zette, de regel
     van `HOTCUE_VERS`); Shift + ● (cuepunt zetten) bewaart hem als 'hand', en 'hand' wint altijd.
  3. Test in `test/library.test.mjs` en een check in de engine-test dat cue 0 blijft zonder bewaarde.
- **Winst:** elke laad staat meteen op de muziek; schaalt vanzelf mee met de nacht.
- **Niet doen:** automatische hotcues op de secties. Die heb je al als 40 pads in grid-modus
  secties (SECTIES.md §1) en op de Maschine (SCENE); dubbel bewaren maakt alleen ruis in je 4 hotcues.

### K4. Terugkijken voedt de library: wat klonk en welke overgangen werkten
- **Probleem:** het setboek weet na een avond wat hoorbaar was en wat na wat kwam, maar schrijft
  niets terug (LEESMIJ: "leest alleen"). "Gespeeld" in de library is `laatst_geladen`, dus laden,
  niet horen (`server/library.js:173`). De kiezer onthoudt gespeelde nummers alleen in de sessie
  (`automaat.js:114`). Fase 3 van de auto-DJ ("leren uit het handelingenlog", AUTO-DJ.md §8) heeft
  daardoor geen bron.
- **Toepassen** (1–2 dagen):
  1. `tools/setboek/setboek.mjs --json` levert al de tracklist; erbij een lijst van paren
     `{ van, naar, soort overgang, wie (Clay/automaat), overgenomen? }` (uit `laad`-gebeurtenissen en
     de hoorbaarheid in `lees.mjs`).
  2. Een eigen bestand naast de library (zoals `kaart.db`): `media/geschiedenis.db` met `gehoord`
     (track, avond, seconden) en `paren`. Vullen met een losse CLI op een KOPIE van de logs, nooit
     tijdens een set (de regel van het setboek), en pas na Clay's ja.
  3. Gebruik: K1 krijgt "eerder na X (10 okt)" als plus, de kiezer vermijdt wat de vorige 2 avonden
     al klonk, de library krijgt een kolom "gehoord" naast "geladen".
- **Winst:** de set wordt per avond beter en minder herhalend; het begin van "leren van Clay".
- **Risico:** klein (offline, eigen bestand). Vraag voor Clay: wil hij dat zijn avonden onthouden
  worden (en wat telt als "werkte": niet overgenomen, of langer dan N seconden samen)?

### K5. De energieboog van een set, in het planvenster
- **Probleem:** een plan is een volgorde met een verhaal, maar niets laat de boog zien. De energie
  van een sectie is relatief binnen het nummer (`server/secties.js:14` en `:451`), dus tussen
  nummers niet te vergelijken; de normalisatie naar −14 LUFS haalt luidheid weg. Het enige plan in
  git (`plannen/auto-plan.json`) spreekt zijn eigen uitleg tegen: volgorde s7 ("uitlopen") eerst,
  s6 ("de piek") laatst, en s1 (de piano waar het mee begint) ontbreekt; de vorige versie in
  `plannen/.versies/auto-plan/2026-09-30T00-04…` heeft nog s1–s7 op volgorde. Of dat een
  ongeluk was weet ik niet (vraag aan Clay); een boog in beeld had het meteen laten zien.
- **Toepassen** (2–3 dagen):
  1. Server: per sectie naast de relatieve ook een absolute maat bewaren ("drukte": klappen per
     seconde uit `onset.bin` + het niveau in dB vóór het schalen, `s.eDb`); `SECTIE_VERSIE` omhoog,
     dan rekent alles vanzelf opnieuw.
  2. `src/plan/tijdlijn.js`: de boog (drukte per stap over de settijd); `strook.js` tekent hem
     boven de banden.
  3. Een knop **orden** die een voorstel doet (niet stil toepassen): een volgorde die de gekozen
     boog volgt (opbouw, piek, uitloop) met de score van K1 tussen buren; Clay of Claude neemt
     het over of niet.
- **Winst:** sneller een set bouwen, en Claude krijgt een meetbare boog om het plan op te schrijven.
- **Risico:** middel. "Drukte" is een AANNAME voor wat Clay energie noemt; ijken door hem tien
  nummers een cijfer te laten geven en te vergelijken.

### K6. Achtervang zonder auto-DJ: nooit stilte als je met de hand draait
- **Probleem:** "nooit een gat" bestaat alleen als de auto-DJ AAN staat (`automaat.js:_tik`); die
  neemt dan ook de overgangen. Draait Clay zelf en loopt het laatste hoorbare nummer af, dan is het
  stil (de resttijd wordt rood onder 30 s, verder niets).
- **Toepassen** (1 dag): een stand `achtervang` in `automaat.js`: geen overgangen, alleen als er
  ~30 s vóór het einde van het enige hoorbare nummer niets anders klinkt of klaarstaat, de eerste van
  K1 (of de volgende planstap) op een LEGE track laden (nooit op een track met een nummer:
  `_vrijDeck` valt nu terug op een stille geladen track) en op het einde overvloeien. Op het scherm
  en in de AUTO-rij "achtervang start over 20 s", één druk = niet doen. Een action `auto.vangnet`
  in `actions.js` (eerst `define()`), een lampje in modus auto.
- **Winst:** minder kans op stilte live, juist als je even met iets anders bezig bent (Maschine,
  patronen, beeld).
- **Risico:** middel: iets dat zelf start mag nooit verrassen (AU4 in VRAGEN). Daarom alleen op een
  lege track, met aftellen, en standaard uit tot Clay het geprobeerd heeft.

## Volgorde die ik zou kiezen

K1 eerst (klein, maakt K2, K4, K5 en K6 beter), dan K3 (uren, elke laad), dan K2 vóór de eerste
avond met kaartnummers, K6 als Clay vaak alleen draait. K4 en K5 na een echte avond met logs:
dan weten we wat Clay echt doet in plaats van wat de docs zeggen.
