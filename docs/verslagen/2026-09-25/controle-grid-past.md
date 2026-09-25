# Controle + integratie "grid moet passen per stuk" — integratie-r5

Branch `integratie-r5` (vanaf main 07832b2), eindcommit **0484b10** (worktree weer detached).

| commit | wat |
|---|---|
| `a0c3dad` | merge `spoor3/grid-past-2` (bfc5070 + 3e72a44), zonder conflict (tools/README auto-merge) |
| `b1606b7` | herstel: een break is geen ander nummer (detect.js + 4 checks in detect.test) |
| `0484b10` | docs: CLAUDE.md Beatgrid, HANDOFF 14 + stand, ROADMAP (afwijking + 24), VERBETERINGEN r4, BEATGRID punt 4 |

Niets in media/ geschreven (onset.bin en library.db alleen gelezen, read-only), geen Chrome,
:8777 niet aangeraakt, geen pkill, geen " 2"-bestanden, `git add` per pad.

## Bevindingen

### 1. ERNSTIG (hersteld): een break werd een eigen grid, of een onzeker gat
Synthetisch 128 bpm, kick + zachte offbeat-hat, in de break ALLEEN hats op de offbeat
(ook: bas op de offbeat, claps op 2/4 + hats). De toets per stuk ziet in de break vensters
een halve tel naast → splitst.
- break 60 s: eigen ZEKER stuk 60–120 met het grid op de offbeat (100% van de tellen >0,15 tel
  naast, 228 ms) — sync zou daar een halve tel naast zetten.
- break 16 / 32 s, bas-offbeat, claps: onzeker gat (z 0,25–0,50) waar vóór de toets één
  zeker stuk met het goede grid lag.
Herstel (`doorlopend` in analyseerGrid, na het samenvoegen van buren): liggen de stukken vóór
en na een tussendeel van ≤ 32 maten (+2 stappen) op één doorlopend grid (tempo ≤ 0,5%, tel van
b binnen 0,1 tel op het grid van a, a∪b passen op dat grid), geen venster `anders` in het
tussendeel, en ligt de fase per blok van 4 s in het tussendeel OVERAL binnen 0,1 van de tel of
OVERAL binnen 0,1 van de offbeat (≥ 2 blokken met puls) → weer één stuk met het grid door
beide kanten (tel-tot-tel). Over een segmentgrens (clap-geval: segmenteer knipte al op 72 s):
één stuk per segment, beide met dat grid.
Twee eerdere versies verworpen, met meting:
- elke VASTE fase: plakte let it all go 31:18-32:22 weer vast. Klappenhistogram per 1/16 tel op
  het doorlopende grid: vóór en na 42/30/14% op tel/¼/½, het midden (31:40-32:00) exact
  hetzelfde patroon 0,2 tel (70 ms) verschoven → een ander grid; splitsen had daar gelijk.
- fase per venster van 12 s: bij een kort tussendeel (V, 11 s rest) overlappen de vensters
  bijna helemaal en leek de versnelling "vast" → V werd één zeker stuk. Nu blokken van 4 s.
Tests (detect.test, "elk stuk moet passen"): breaks 16/32/60 s → één zeker stuk op de tel
(alle drie FAIL op 3e72a44, gecontroleerd met een kopie); "hetzelfde patroon 0,2 tel verschoven:
blijft gesplitst" (FAIL met de versie "elke vaste fase", gecontroleerd). V blijft groen.

### 2. Bekende grenzen, niet hersteld (in BEATGRID/VERBETERINGEN)
- Hetzelfde patroon precies een halve tel verschoven tussen twee stukken op één grid wordt één
  stuk (synthetisch VERSCH_05: vals zeker). Prijs van de break-regel; niet te onderscheiden van
  offbeat-hats zonder patroonvergelijking. Niet gezien in de 48 fragmenten.
- Rubato met een golvend tempo (±2%, periode 30 s): vensters van 12 s middelen de fase weg,
  stukken blijven zeker met >5% tellen >0,15 tel naast (240 s: 2 van 4 zekere stukken; een uur:
  13 van 15). Vóór de toets: één vals zeker stuk over alles. Niet slechter, niet opgelost.
- Kort stuk op 1–2% ander tempo aan de rand (S8), rest < 20 s = onzeker gat: zoals de bouwer.
- Buiten dit spoor (alle drie de versies gelijk): een schoon uur met offbeat-hat 0,1 naast kick
  0,5 krijgt het anker op 0,24 tel (tussen kick en hat): het anker volgt het zwaartepunt van de
  envelope. En de tweede kans wordt bij twee nummers in één segment door eenGridPast (0,15)
  teruggedraaid vóórdat de splitser kan splitsen (S1: tweede nummer onzeker i.p.v. zeker) —
  conservatief, geen valse zekerheid; ze werken elkaar verder niet tegen (0,1 is strenger en
  komt erna).

### 3. Nagelopen, in orde
- Een stuk dat meteen past houdt precies het oude grid (`toets` → `gridVan(sg)` = oude aanroep).
- 0,1 tel tegen 0,15 van eenGridPast: geen tegenwerking; album 156 (geredde vensters tot 47 ms
  spreiding) blijft bit-gelijk.
- Bijstellen op de helling: teken klopt (b>0 = muziek trager); anker = tel van het oude grid in
  het midden, stukPast toetst de absolute fase niet, maar fijneFase (±30 ms) in maakGridHier
  vangt een kleine rest; let it all go 15:06: blokken 5/-6/25 ms. Geen herstel nodig.
- normaliseerGrid, PAST_NIET 0,5 tussen 0,15 en 0,65, gat-stukken uit een rest (grid van de
  buur): in orde. Heranalyse op de achtergrond: alleen leeg/oud; bestaande auto-grids pas na ↻
  (in HANDOFF 14 gezet).
- Rekentijd blokkeert niets: elke analyse een eigen worker (tap-verfijning niet achter een grid
  in de rij), annuleren via de noodrem na 2 s; alleen de ingest-stap "beatgrid" duurt langer.

## Eigen metingen
Scripts: scratchpad/controle-r5/ (scen.mjs, diag*.mjs, pieken.mjs, gridpast-vs.mjs, uur.mjs).
- Breaks (7 scenario's): bouwer 1 vals zeker + 3 gaten, herstel 0 vals zeker, alles weer zoals
  vóór de toets (stilte blijft een gat).
- Live drums 1–3% drift (240 s): vóór vals zeker 12–37%, nu 2 passende stukken; swing 90/95:
  één zeker stuk, gelijk; DJ-overgang fase 0,3: 52% → 10% (overlap), 1,2% tempo: nu passend.
- 48 fragmenten van Clay (gridpast-vs, OUD=3e72a44): 0 verschillen met de bouwer. Synthetische
  set van de bouwer (met LANGE_MIX): identiek. Vals zeker 14 → 0 blijft.
- Een synthetisch uur (min van 2 rondes, load 5–6 door andere agenten), vóór / bouwer / herstel:
  schoon 3,9 / 4,7 / 4,8 s; 18 nummers op 150 4,1 / 13,4 / 13,5 s (0 vals); live 3,9 / 16,7 /
  17,2 s (vals zeker 1×3600 s → 4×475 s); rubato 4,2 / 14,1 / 14,5 s; 15 nummers met break
  4,0 / 14,4 / 14,0 s (bouwer 4 vals zeker 130 s, herstel 0; zekere tijd 1792 → 1922 s).
  Dus ~3,5–4,3× op materiaal dat gesplitst moet worden; het herstel kost niets extra.

## Tests
- `nice -n 10 node test/alles.mjs`: 36 bestanden, **3402 checks, alles groen** (detect.test 130, 36 s).
- `tools/headless/kijk.mjs` (VARVE_KIJK_POORT=8961, DEBUG=9561): 77 ok, alles groen.

## NIET getest
- Hele albums/mixen (bewust); rekentijd op een echte mix van een uur (alleen synthetisch).
- Of breaks op Clay's eigen muziek zich zo gedragen (de 48 fragmenten bevatten geen geval dat
  de break-regel raakt); niets beluisterd, niets in de browser of op de APC.
- Server niet herstart; na merge: herstarten en ↻ op let it all go, Sakamoto, jungle-mix, album.
