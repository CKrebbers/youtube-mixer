# Secties — het nummer in stukken die je speelt (6 okt 2026)

Een nummer zo spelen als jij wilt: niet van begin tot eind, maar de stukken
waaruit het bestaat (intro, opbouw, drop, break, outro) los lanceren en loopen,
op de maat, vanaf de APC. Samen met de stems (welk instrument) en twee of meer
tracks (welk nummer) is dit de derde as om een nummer te herschikken: **welk
stuk**.

Achtergrond: het onderzoek "Nummers bespelen" (Claude Doc, 6 okt). DJ-apps doen
live stems al (djay, Serato, Traktor, rekordbox). Geen ervan laat je secties per
nummer lanceren zoals clips in Ableton's Session view. Dat is wat Varve hier
erbij krijgt.

Tak: `studio/secties` (van `studio/integratie`, 6 okt), samengevoegd in `studio/integratie`.
Vragen: VRAGEN blok SE, en blok SV voor wat ermee verweven is (§7).
Proberen: speellijst, blok "Avond 1 · Secties" en de blokken van §7.

## 1. Wat je krijgt

- **Op het scherm**: boven de golfvorm (het overzicht) een strook met een band
  per sectie, in de kleur van zijn groep. Dezelfde letter = dezelfde kleur, dus
  je ziet wat terugkomt. De sectie die je hoort is vol, de rest gedimd.
- **Op de APC**: grid-modus SECTIES (hemelsblauw), Shift + scene 1, of ▲ ▼
  (achteraan, na patronen). De 40 pads zijn de secties van de FOCUS-track op
  volgorde: rij 1 = sectie 1–8, rij 2 = 9–16, enzovoort.
  - pad = naar die sectie; hij valt in op de volgende "1" (§3)
  - shift + pad = die sectie als loop; nog eens = loop eraf
  - lampje: wit = die hoor je (knippert op de tel), donker hemelsblauw = er is
    een sectie, uit = geen sectie op die pad
  - op het scherm-als-APC staat op elke pad de naam van de sectie ("drop D");
    een pad zonder sectie is leeg en gedimd
  - scene 1 zonder shift blijft "modus hotcues"; zijn lampje zegt "secties open"
- **Op de bus**: `track.N.section.1` … `.40` (trigger), `.section.K.loop`,
  `.section.next` en `.section.prev` (op de volgende maat, gerekend vanaf de
  sectie waar je straks bent: ook tijdens een aanloop gaat "volgende" verder
  dan de sectie waar je al heen sprong). Reads: null = geen sectie, 0,5 = er is
  er een, 1 = die hoor je (of je drukt hem in).

## 2. Hoe de secties gevonden worden (server/secties.js)

Puur rekenwerk zonder dependencies, zoals detect.js en toon.js, in een worker
(analyze.js `maakSecties`):

1. **Maten**: de maatbegins van het grid (de "1" per stuk, beatgrid.js). Een
   opmaat vóór de eerste "1" is een eigen korte maat vanaf 0. Zonder grid:
   stukken van 2 s (`opGrid: false`).
2. **Kenmerken per maat** (mono 11025 Hz, FFT 2048, hop 1024): chroma
   (12, gecentreerd op het nummer), vijf banden in dB, rms, flux, en flux apart
   onder 150 Hz (kick) en boven 3 kHz (hihat). Heeft het nummer stems, dan ook
   het niveau per stem (stems.wav op 4000 Hz, ~0,25 s per frame).
3. **Nieuwheid op elke maatgrens**: Foote op de zelf-gelijkenis van de maten op
   twee schalen (2 × 8 en 2 × 4 maten: een opbouw van 8 maten valt anders weg),
   plus de sprong in energie en in de stems over 4 maten. Eén stem die erbij
   komt of wegvalt telt al (de drums in een break).
4. **Grenzen**: pieken in die nieuwheid. Een piek telt als hij boven de drempel
   van het hele nummer komt, of als hij in zijn eigen buurt duidelijk uitsteekt
   (couplet → refrein is zwakker dan een break, maar binnen 8 maten even
   duidelijk). Minstens 4 maten uit elkaar, bij voorkeur op een frase van 4
   maten (de fase van die frases komt uit de nieuwheid zelf). Langer dan 32
   maten: splitsen op de beste frasegrens. Hooguit 40 secties (het grid van de
   APC; in een mix de sterkste grenzen).
5. **Groepen**: gemiddelde koppeling op 1 − gelijkenis (35% harmonie, 65%
   klank en stems), onder 0,3 samen. Letters in volgorde van eerste keer.
6. **Labels**: begin zacht = intro, eind zacht = outro, zacht ertussen (of
   zonder drums waar het nummer ze wel heeft) = break, de luidste groep (≥ 0,7)
   = drop, vlak vóór een drop en oplopend (≥ 2 dB) = opbouw, de rest alleen een
   letter (`deel`). Zonder drums in het hele nummer (stems), of zonder zekere
   puls in het grid (geen stems): nooit "drop".

Gemeten (test/secties.test.mjs, synthetisch met een bekend antwoord):

| nummer | grenzen | groepen en labels |
| --- | --- | --- |
| EDM 124 bpm, 7 secties, met en zonder stems | alle 7 op hun maat | goed |
| pop 96 bpm, opmaat 1,1 s, 8 secties (refrein 3×) | alle 8, ook couplet → refrein | goed |
| ambient 70 bpm, geen drums | alle 5 | goed, geen drop |
| EDM zonder grid | binnen 2,5 s | — |
| mix van 62 minuten | 40 secties | 4,3 s rekenen |

In echte Chrome (`tools/headless/secties.mjs`, 6 okt): het synthetische nummer
via de ingest binnengehaald, het grid door de eigen analyse: alle zeven grenzen
gevonden, maar 0,25–0,5 s te vroeg. Dat is het GRID (zijn "1" lag een tel vóór de
echte), niet de secties: die volgen de maten van het grid. Klopt de "1" niet,
zet hem dan eerst goed (grid-modus, "1"); bij het volgende laden schuiven de
secties mee.

Op Clay's library: nog niet gemeten (VRAGEN SE2). Rekentijd (worker, ffmpeg
erbij, in de Linux-VM op de M1): een nummer van 2,5 minuten 0,3 s zonder stems,
1,1 s met stems.

## 3. De sprong op de maat (src/engine/secties.js, `sectieDoel`)

Een sectie moet op de "1" invallen, zonder dat de groove struikelt en zonder
dat je wacht. Daarom springt het deck NU, naar vlak vóór de sectie: precies zo
ver vóór haar "1" als jij nu van de volgende "1" af zit. De rest van deze maat
hoor je de aanloop uit het nummer zelf (het einde van de maat vóór die sectie,
vaak een fill), en op de maatstreep valt de sectie in. Het is een gewone
fasebehoudende sprong (`seek` met `doorlopend`, zoals een gequantiseerde
hotcue), dus ook met keylock exact.

- Op de "1" (binnen 0,02 tel): meteen de sectie, met de fase in de tel.
- Een sectie op 0 heeft geen aanloop: dan in haar eerste maat, op dezelfde plek.
- Stilstaand: de speelkop naar het begin van de sectie.
- Zonder (zeker) grid, of een kaart zonder grid: gewoon naar het begin.
- Als loop: speel je er al in, dan blijft de speelkop staan en komt de loop om
  de sectie; anders dezelfde sprong met de loop er meteen om (`_spring`).

Waarom niet wachten tot de maat om is (zoals Ableton)? Dat vraagt een GEPLANDE
sprong terwijl het oude doorspeelt; de streamkern kan dat nu alleen voor
keylock (`_vorig`, rekPlanT). Met een timer springen is niet exact (regel 3).
Zie VRAGEN SE1.

## 4. Opslag en wanneer opnieuw

- Kolom `secties_json` (schema v9), NIET in de lijst (`/api/library`): de app
  haalt de kaart bij het laden op met `GET /api/library/<id>/secties?maak=1`.
  Moet hij (opnieuw) berekend worden, dan doet de server dat eerst.
- Opnieuw als: er geen kaart is; de kaart automatisch is en (a) van een
  oudere `SECTIE_VERSIE`, (b) op een ander grid gerekend (vingerafdruk
  `grid`, FNV over de stukken), of (c) zonder stems terwijl het nummer ze nu
  heeft. Met de hand (`bron: 'hand'`) of op slot: nooit.
- Opnieuw binnenhalen (nieuwe audio.wav) wist een automatische kaart.
- De achtergrond (`heranalyseOpAchtergrond`) doet de secties per nummer na
  grid en toonsoort.
- `normaliseerSecties` in library.js is de poort: labels uit `SECTIE_LABELS`,
  groep één hoofdletter, oplopend, de eerste op 0, hooguit 64 stukken.

## 5. Grenzen (niet als bug melden)

- Labels zijn een gok uit energie en drums, geen muziekanalyse: "drop" is de
  luidste groep, ook in een popnummer (dan het refrein).
- Een grens ligt altijd op een maatbegin van het grid zoals het was bij het
  rekenen. Verander je het grid met de hand, dan blijft de kaart staan tot het
  nummer opnieuw geladen wordt (dan wordt hij opnieuw berekend).
- Komen de tellen van Beat This! later binnen en wordt het grid vervangen,
  dan horen de secties bij het oude grid tot het volgende laden.
- Twee servers van verschillende takken op dezelfde library.db: schema v9 is
  hier `secties_json`; een andere tak met een eigen v9 past dan niet (zie de
  waarschuwing bij v7 in library.js).
- De pads tonen geen groepskleuren (VRAGEN SE4).

## 6. Bestanden

| bestand | wat |
| --- | --- |
| `server/secties.js` | het rekenwerk (puur), `SECTIE_VERSIE`, `gridSleutel` |
| `server/analyze.js` | `maakSecties` (worker): audio en stems lezen via ffmpeg |
| `server/library.js` | schema v9, `normaliseerSecties`, `moetSectieAnalyse`, `secties()`, `bewaarAutoSecties()` |
| `server/index.js` | `analyseerSecties`, `GET /api/library/<id>/secties`, achtergrond |
| `src/engine/secties.js` | `SectieKaart`, `sectieDoel`, groepskleuren (puur) |
| `src/engine/deck.js` | `setSectieKaart`, `sectieHier`, `sectieOpDeMaat`, `naarSectie` |
| `src/control/actions.js` | `track.N.section.*` (40 pads), meldingen zonder kaart |
| `src/control/lagen.js`, `feedback.js`, `devices/apc40mk2.js` | de grid-modus, de kleuren (`hemelsblauwdonker` = 42) |
| `mappings/apc40mk2.json` | 82 regels erbij (Shift + scene 1, het lampje, 40 + 40 pads); `eerder` bijgewerkt |
| `src/ui/laden.js`, `waveform.js` | ophalen bij het laden, de strook boven het overzicht |
| `src/ui/spiegel.js` | in de modus secties de NAAM van de sectie op de pad ("drop D"), een pad zonder sectie leeg en gedimd |
| `test/secties.test.mjs`, `test/synth-nummer.mjs` | de metingen hierboven, worker, library, deck, server |
| `tools/headless/secties.mjs` | in echte Chrome: binnenhalen (nep-yt-dlp), laden, kaart, strook, modus, pads, sprong, loop |
| `src/control/keyboard.js` | `SHIFT_TOETS`: shift+W/E en shift+I/O = vorige/volgende sectie (§7) |
| `src/engine/sampler.js`, `src/engine/fx.js` | `knipSectie`, `startOpDeEen`, `fxKlok().tellenTotEen` (§7) |
| `src/plan/plan-model.js`, `plan-venster.js`, `tijdlijn.js`, `server/plannen.js` | `in`/`uit` per stap, `herstelSecties`, `kent`, banden in de strook (§7, docs/PLAN.md §2b) |
| `src/control/handelingen.js`, `terugspelen.js`, `src/engine/deck.js` | de kaart in het log, `van` bij een sectiedruk, `drukPlek`, `naarSectieStap` (§7, docs/HANDELINGENLOG.md) |
| `test/sec-sampler.test.mjs`, `test/secties-log.test.mjs` | sampler en log met secties |
| `tools/headless/sec-toets.mjs`, `sec-sampler.mjs`, `sec-plan.mjs`, `sec-log.mjs` | elk onderdeel van §7 in echte Chrome |

## 7. Verweven in de rest van VARVE (6 okt, avond)

Doel (Clay): een bestaand nummer precies spelen zoals hij wil, en snel mixen en
remixen tussen nummers. Elk onderdeel kwam als eigen tak van `studio/integratie`
(`studio/sec-*`), met een review, en is één voor één samengevoegd. Plan en
verantwoording: `TASKS-SECTIES.md` (blok "Verweven"). Vragen: VRAGEN blok SV.

- Toetsenbord (studio/sec-toets): shift+W/E = vorige/volgende sectie van de focus-track, shift+I/O die van de rechterhand, op de maat (`SHIFT_TOETS` in keyboard.js; helpkaart `/`). Daarbij gerepareerd: een sectiebegin dat de server afrondde (0,1 ms) en net ná zijn "1" lag, viel een maat te laat in (`sectieEen`, marge nu 0,01 tel), en volgende/vorige rekenden in de laatste maat vóór zo'n grens met de verkeerde sectie (`SectieKaart.index`, marge nu 1 ms). Aan het eind van de kaart geven vorige/volgende een melding.
- Sampler (studio/sec-sampler): rij 3 van de modus sampler knipt de sectie die je hoort op de focus-track heel in een pad (`sampler.N.section`): van haar "1" tot de "1" van de volgende, in hele maten (`knipSectie`), hooguit 32 maten en 90 s, bewaard bij het nummer zoals een gewone pad. Zo'n pad start op de "1" van de maatgever (`fxKlok().tellenTotEen`, `startOpDeEen`) en houdt bij herankeren ook de maat vast.
- Planvenster (studio/sec-plan): een stap kan op een sectie beginnen (`in`) en zijn overgang op een sectie laten beginnen (`uit`), `{ sectie, label, groep }` naast `van` (de waarheid en de terugval). De strook toont de secties als banden in de groepskleur; het venster haalt de kaart zonder `maak=1`. Wat de auto-DJ ermee doet hangt aan de planner (`fragment`/`planMoment` krijgen `secties`, `inSectie`, `uitSectie`). docs/PLAN.md §2b.
- Handelingenlog (studio/sec-log, docs/HANDELINGENLOG.md): de sectiekaart staat in de beginstand en als gebeurtenis `secties`; terugspelen haalt hem niet van de server, dus `section.5` landt ook na een herberekening waar hij toen landde. Een sectiedruk draagt in het log de plek waarvan hij rekende (`van`): een druk vlak na de "1" valt teruggespeeld niet een maat later. Een sectie-loop staat als gewone `loop` in de stand (niet apart als `section.K.loop`: de loop van het deck is al de waarheid). Een druk die tijdens een loop rond de terugsprong viel, wordt teruggespeeld herkend als een loop verder.

## 8. Volgende stappen (niet gebouwd)

1. Clay's oordeel op echte muziek (SE2), dan de drempels bijstellen.
2. Groepskleuren op de pads (SE4).
3. Met de hand verschuiven/hernoemen (SE5), zodra een grens steeds mist.
4. Stem × sectie: een sectie van één stem op een andere track (de zang uit het
   refrein over de break). Kan nu al met de hand: hetzelfde nummer op twee
   tracks, gesynct, per track andere stems weg. Een knop "stem naar eigen
   track" zou dat in één druk doen.
5. Melodie van een stem als MIDI (Basic Pitch, Apache-2.0) naar een patroon,
   zodat een instrument hem kan spelen.
