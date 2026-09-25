# Controle ROADMAP 13: eigen mapping als verschil

25 september 2026. Controleur van spoor `spoor/mapping-verschil` (7f7e2e7, 4ce76aa).
Branch met de herstellingen: **`spoor2/mapping-verschil`**.

## Commits (bovenop die van de bouwer)

| commit | wat |
|---|---|
| efb6cbd | Mapping-opslag: bij opstarten niet naar de server als die niet gelezen is |
| d55ebd5 | Mapping-opslag: eigen mapping niet geladen = die sessie niets bewaren |
| d098653 | Mapping-opslag: de reserve in de browser volgt de server bij opstarten |
| 2d3959a | docs/MAPPING-VERSCHIL.md: wanneer opstarten niet bewaart, en grenzen uit de controle |

Elk herstel heeft een check in `test/mapping.test.mjs` (blok "controleur: …") die
op de code van de bouwer FAALDE (gecontroleerd vóór elk herstel) en nu groen is.

Let op: de branch `integratie` heeft `spoor/mapping-verschil` al samengevoegd
(e0b9e41). De herstellingen staan daar nog NIET in: `spoor2/mapping-verschil`
moet er ook in.

## Clay's verschil, zelf uitgerekend

GET `http://localhost:8777/api/mapping` (alleen gelezen): 291 regels, 30.768 bytes,
version 3, naam "APC40 mkII — standaard", shift note:0:98, device apc40mk2.
Met een eigen vergelijking (niet `normaliseer` van de bouwer: zelf geschreven
betekenis per regel, sleutels gesorteerd) tegen `mappings/apc40mk2.json`:

- zelfde 291 sleutels, niets alleen in de kopie of alleen in de standaard;
- 4 regels anders: `cc:0:20..23@device.rack` = `video.fx.pixel/rgb/trails/grain`,
  mode `absolute` (standaard: `track.{focus}.fx.knob.5..8`, `endless`), labels gelijk;
- 208 regels met andere RUWE tekst maar dezelfde betekenis (alleen veldvolgorde,
  bv. `shift` voor/na `label`): terecht NIET als eigen gezien.

Berekend verschil (524 bytes): `{ kind:'diff', version:3, device:'apc40mk2',
base:'35823dda-291', top:{}, rules:[die 4], removed:[] }`. Standaard + verschil =
de kopie als verzameling (ook naam en shift): waar, zowel met `pasVerschilToe`
als via `Mapping.laadStandaard` + `load`. Na laden rekent `verschil()` precies
hetzelfde terug; met het vormen-fragment erbij ook. Geen enkele andere branch
wijzigt `mappings/apc40mk2.json` (laatste: 1196c2b), dus het omzetten is exact.

## Bevindingen

### 1. Opstarten zette een oude reserve over Clay's verschil heen (middel, HERSTELD efb6cbd)
GET `/api/mapping` faalt (500), POST werkt; in de browser staat een oude volledige
kopie. `start()` zette die om en POSTte meteen, zonder dat Clay iets deed. Een
kopie van vóór de grid-modus werd zo een verschil met de 21 grid-modusregels
(`@edit.aan`) als "weggehaald", over zijn goede verschil heen. Waarschijnlijk
staat er zo'n kopie in Chrome/Comet: de samenvoeging van 23 sep ging alleen naar
de server, en de oude code schreef localStorage alleen bij een wijziging. Nu:
opstarten bewaart alleen als de server gelezen is.

### 2. Eén haperende standaard kostte de volgende koppeling al zijn eigen regels (middel, HERSTELD d55ebd5)
`mappings/apc40mk2.json` eerst 500, bij de tweede poging goed: de catch-tak in
`start()` laadde de standaard en zette bewaren AAN. De eerstvolgende koppeling
verving Clay's verschil (4 regels) door een verschil van 1 regel. Gemeten in een
probe. Nu: die sessie bewaart niets tot herladen of bewust "standaard
herstellen"; de foutmelding (blijft staan) zegt het.

### 3. De reserve in de browser bleef een oude kopie (laag-middel, HERSTELD d098653)
Laden van de server werkte localStorage niet bij. In een tweede browser (Comet)
bleef de oude volledige kopie liggen: de brandstof voor bevinding 1. Nu wordt de
reserve bij opstarten hetzelfde verschil (alleen de browser, geen POST).

### 4. Oude code leest het verschil als volledige mapping (middel, NIET hersteld: ontwerpkeuze)
Draait er ooit code van vóór dit spoor op :8777 (terugdraaien, of Clay test een
branch zonder dit spoor), dan: `rules.length` 4 > 0 → de APC heeft alleen 4
regels, geen shift, naam "naamloos". Koppelt Clay daar iets, dan POST de oude
code 5 regels; de nieuwe code zet dat later om met 286 standaardregels
"weggehaald" en `top.shift: null` (gemeten met de mapping.js van main). Niet stil
(de APC is zichtbaar dood), wel vervelend. Mogelijke bescherming (niet gebouwd):
de eigen regels in een ander veld (bv. `eigen`) en `rules: []` houden; de server
eist alleen een lijst `rules`, en oude code valt dan terug op de standaard.
Kost een formaatwijziging; beslissing voor de hoofdsessie. Gedocumenteerd.

### 5. Een oud exportbestand importeren markeert nieuwe standaardregels als weggehaald (laag, niet hersteld)
Import laadt het bestand zoals het is (bewuste keuze van de bouwer); wat de
standaard sindsdien kreeg, staat daarna als `removed`. Precies het probleem van
ROADMAP 13, maar dan via import. Een export draagt geen `base`. Gedocumenteerd.

### 6. Kleiner (niet hersteld, gedocumenteerd)
- Koppelen en binnen 500 ms herladen: de koppeling is weg (server wint). Was zo.
- `led` met andere sleutelvolgorde = "eigen" regel (tekstvergelijking). Elke `led`
  in de standaard heeft nu één sleutel: speelt niet.
- Na omzetten zonder bereikbare server zegt de melding toch "staat nu als
  verschil" (het wordt pas bij de volgende keer bewaard). Cosmetisch.
- Twee tabbladen: laatste schrijft wint (was zo). Twee tabbladen die tegelijk de
  oude kopie omzetten POSTen hetzelfde verschil: gemeten, onschuldig.

### Nagelopen en in orde
- Omzetten exact (tegen wat de OUDE code na `load()` had) voor: v2-namen
  (`fx.knop.5.druk` → `fx.knob.5.hold`), versie ontbreekt (=1), shift-regels,
  mapjes (`#shift@grid.hotcues`), `led`, `step`/`takeover`/`invert`, relative-2c,
  dubbele sleutels (laatste wint, zoals vroeger), ongeldige regels, generic,
  kopie zonder device.
- Fragment (vormen) blijft buiten het verschil, ook als het tijdens `start()`
  binnenkomt; over een fragmentregel koppelen maakt hem van Clay.
- Nieuwe standaardregel komt binnen; eigen regel wint; weggehaald blijft weg;
  base-mismatch → `standaardNieuw`, melding, opnieuw bewaard met de nieuwe base.
- Standaard herstellen = leeg verschil (server + browser); een oude kopie in een
  andere browser komt daarna niet terug.
- Export volledig (290/291 regels, naam, shift); import volledig → verschil van
  precies 4; import generic → verschil tegen generic.json, na herladen weer generic.
- apc.html: `laadEigen` zonder opslag, POST niets (ook headless via Network gemeten).
- Mapping-paneel (status "4 eigen …", wis-knop), MidiLearn (`learn.start/feed`),
  soft-takeover, feedback/LED's (`actieveRegels`): tests groen, headless groen.

## Tests

- `nice -n 10 node test/alles.mjs`: 29 bestanden, 1999 checks, alles groen.
- `mapping.test.mjs` 209 ok (8 nieuw van de controle), `learn.test.mjs` 36 ok.
- Headless, eigen script `scratchpad/controle/kijk-controle.mjs` (server 8862,
  debug 9462, tijdelijke db, MIDI weg), Clay's ECHTE kopie op die testserver en
  een kopie van vóór de grid-modus in localStorage: 27/27 groen. Rondje:
  opstarten → melding "staat nu als verschil" → server en browser hetzelfde
  verschil van 524 bytes, precies 1 POST → mapping == Clay's kopie → paneel
  "4 eigen" → koppelen via MidiLearn + wis in het paneel → 5 eigen + 1
  weggehaald → herladen zonder POST → apc.html "de standaard + 5 eigen regels,
  1 weggehaald", geen POST → export volledig → import van de kopie → 4 →
  standaard herstellen (twee klikken) → leeg verschil → herladen: standaard, geen
  POST → geen consolefouten. (Eén eerdere run had 4 rood doordat mijn script
  vast 1,2 s wachtte op het paneel onder belasting; met wachten-op-element groen.)
- Probes: `scratchpad/controle/echt.mjs` (Clay's kopie), `probe.mjs` (20
  randgevallen), `terugdraai.mjs` (oude code tegen het verschil).

## Niet getest

- Niets in Clay's echte Chrome/Comet en niets op de APC (LED's, echte MIDI-learn).
  De echte omzetting gebeurt bij zijn eerste herlaad na de merge.
- Echte bestandskiezer/download (alleen `importeer()`/`export()` aangeroepen).
- Twee echte browsers na elkaar; een tabblad met oude code dat open staat.
- :8777 alleen met één GET gelezen; niets gePOST, niet herstart.

## Voorstel CLAUDE.md (vervangt het laatste punt onder "## Beatgrid")

- Eigen mapping = VERSCHIL met de standaard (ROADMAP 13, docs/MAPPING-VERSCHIL.md):
  `{ kind:'diff', version, device, base, top, rules, removed }` op de server en in
  localStorage. Laden = mappings/<device>.json + verschil; nieuwe standaardregels
  komen vanzelf binnen, een eigen of weggehaalde regel blijft van Clay (stil).
  Export blijft VOLLEDIG; "standaard herstellen" = een LEEG verschil. Opstarten
  bewaart alleen als de server gelezen is; kwam de eigen mapping niet binnen, dan
  die sessie niets bewaren (tot herladen/herstellen); de browserreserve volgt de
  server. OUDE code leest een verschil als volledige mapping (4 regels): niet
  terugdraaien zonder eerst een export terug te zetten. Wie de standaard
  verandert, hoeft Clay's kopie niet meer samen te voegen.
