# Werkruimte S1: precisie (14 okt 2026)

Tak `werk/S1` (vanaf `werkruimte/integratie` 72f15c3, met S0 erin), worktree buiten iCloud, niet
gepusht. Ontwerp: `docs/WERKRUIMTE.md` A6 en D4 "S1". Wat er gebouwd is, voor wie eraan komt:
`docs/werkruimte/S1.md`.

## Kort

Clay's punt 3 ("een track met precisie op de juiste plek zetten") als actions op de bus: de fase
t.o.v. de maatgever als draaiknop (3,81 ms per APC-tik op 124 bpm, fijn 0,48 ms), jog (ook in
pauze), ±1 ms, beatjump ¼/½/1 tel, "op de 1", bend-sterkte 1–16%, de duoklik in de koptelefoon en
een eerlijker sync-lampje. Op de APC als het stuk `uitlijn` (⇧ Lock = acht fasemeters), alleen met
`?uitlijn=1`. De standaardmapping is niet veranderd; zonder vlag is de APC precies zoals hij was.

## Gebouwd

1. `src/control/acties-precisie.js` (nieuw): `bindPrecisie(engine)` met alle actions per track,
   de `Duwer` (samenvoegen: hooguit één nudge/seek per 15 ms per track; met keylock nooit twee
   geplande sprongen tegelijk), `faseTegen`, `naarDeEen` (op de 1 via `barPhase` op de plek NA de
   sprong).
2. `src/engine/deck.js`: `deck.bendSterkte` (veld, standaard `BEND` = 0,04, `BEND` blijft
   export); `beatjump(richting, lengte)` neemt ook `{ tellen }` (een getal kon al).
3. `src/engine/grid-klik.js`: `GridKlik(ctx, uitgang, { een, tel })`, `KLIK_TONEN` (de oude
   1760/1175, standaard) en `DUO_TONEN` (880/587). Zonder optie bit voor bit hetzelfde.
4. `src/engine/engine.js`: `engine.duoKlik` (tweede GridKlik naar dezelfde uitgang als de
   controleklik), `engine.duoklik(id|null)`, `duoklikDeck`; `gridControle` van een ander deck zet
   de duoklik uit.
5. `src/control/actions.js`: alleen de drempel van de sync-read, 0,05 → 0,005 bpm.
6. `src/ui/aanhakers/precisie.js`: `bindPrecisie`, en met `?uitlijn=1` het stuk (`zetStukOp`:
   `voegMapjeToe` + `herbindLagen` + `vervangFragment('stuk:uitlijn')`) en één info-melding.
7. `src/ui/beschrijf/precisie.js`: uitleg (kort + lang) van elke nieuwe action en van
   `layer.device.uitlijn`.
8. `mappings/stukken/uitlijn.json` (nieuw, formaat B4): 20 regels, 0 botsingen.
9. `test/precisie.test.mjs` (nieuw, 72 checks), `tools/headless/precisie.mjs` (nieuw, 14 checks).
10. Docs: `docs/werkruimte/S1.md`, WERKRUIMTE.md S1 "Gebouwd", CLAUDE.md drie structuurregels en
    twee zinnen in het blok "Werkruimte: aanhaakpunten".

Buiten de grens: niets. (De grens noemde `docs/werkruimte/S1.md`; dit verslag en de regels in
WERKRUIMTE.md en CLAUDE.md vroeg de opdracht van de werkstroom.)

## Gemeten (exacte commando's)

Alles vanuit `…/scratchpad/wt/werk-S1`. Chrome als root vraagt `--no-sandbox`: `VARVE_CHROME` wees
naar `scratchpad/chrome-shell.sh` (`exec …/headless_shell --no-sandbox "$@"`).

| wat | commando | uitkomst |
|---|---|---|
| de nieuwe test | `node test/precisie.test.mjs` | 72 ok. phase.offset 0,5000; één tik 3,810 ms, fijn 0,476 ms; 50 invokes in 100 ms = **7 seeks**, eindfase 48,387 = 48,387 ms (één invoke met de som); keylock 100 tikken: 6 sprongen, **0 erbovenop**, 96,774 ms aangekomen; jog in pauze **30,242 ms**, stil, cuepunt gelijk; jog spelend in een loop 4 × 30,24 ms en in de loop; zonder grid 5,000 ms; op de 1 ook over een stukgrens met maat-anker (waar doortellen een tel naast was); onzeker grid geweigerd; sync-lampje 0,0100 → 0, 0,0040 → 1; duoklik op ctxTimeOf, controleklik dezelfde samples; duwen speelt terug als dezelfde duw (48,387 ms); APC-knop 2 via de echte Mapping één tik 3,810 ms, ⇧ 0,476 ms |
| headless | `VARVE_CHROME=…/chrome-shell.sh VARVE_PRECISIE_TMP=…/scratchpad/tmp-werk-S1 node tools/headless/precisie.mjs …/tmp-werk-S1/uit` (poorten 8912/8913, `VARVE_TESTSERVER=1`, alle VARVE_*-paden in tmp) | 14 ok. App: zonder vlag geen regel, met `?uitlijn=1` 20 regels `stuk:uitlijn`, ⇧ Lock opent `device.uitlijn`, `?uitlijn=0` weer uit, geen consolefout. Offline 48 kHz, demotrack, uitvoer per deck: **7,000 ms → na 15 tikken fijn −0,145 ms** (verwacht −0,144; < 1 ms); 50 tikken/s: na 1 s 190,50 ms (50 × 3,81), terug 0,000 ms, geen tik verloren; **grootste knik 0,2545 met duwen, 0,2897 zonder** (+−0,035 ≤ 0,05; een harde knip van één tik zou tot 0,728 geven); duoklik: 11 lage (587–880 Hz) en 10 hoge (1175–1760 Hz) tikken **hooguit 0,84 sample** van ctxTimeOf + de vooruitblik van de limiter, flam precies 50 ms |
| alle tests | `node test/alles.mjs` | 104 bestanden, 9218 checks, 283 s. **Rood: alleen de bekende drie** van deze container: renderblok "keylock met wissels … 89,7 bytes per bericht" (de gouden hash `9dfaeb73` en 0 GC wel groen), wachtrij "yt-dlp en zijn kind" (2×), instrumenten-fm-schaal "geen afval per blok" (31168 bytes, 0 GC). Alle andere groen, geen bestaande verwachting veranderd |

## Wat niet gedaan is

- Geen schermknoppen of toetsen voor de nieuwe actions (de opdracht vroeg alleen bus + stuk; het
  paneel/de uitlijnweergave is S2, panelen S7). Te koppelen met koppelen, zoals altijd.
- Het stuk laden als stuk (zonder vlag) is van S3.
- Maschine-plekken (UITLIJN-pads, SWING + wiel, knop 4 = bend-sterkte) zijn van S6: de actions
  bestaan.
- Geen schrijfweg van buiten de Mac (W1), geen engine-effecten (W3).

## Alleen op de hardware te bevestigen

- Is de pan-ring van de APC leesbaar als fasemeter (15 lampjes: grof ~32 ms, fijn ~4 ms per
  lampje)? Gaat het rond draaien over de rand goed onder de vinger?
- Hoor je een duw van 0,48 ms, en klinkt een duw van 3,81 ms met 4 ms overvloei als niets?
- De duoklik in de echte koptelefoon (vier kanalen): zijn hoog/laag goed uit elkaar te houden,
  en is het volume (0,5, als de controleklik) goed?
- Met keylock in Chrome op de M1 (de Signalsmith-worklet): het samenvoegen is in de mock getest.

## Vragen voor Clay

- Duoklik: hoog op de track die je gelijkzet en laag op de maatgever (zoals gebouwd), of andersom
  (zoals A6 in het ontwerp het zei)?
- Moet "op de 1" bij gelijkspel (precies twee tellen naast) liever vooruit dan terug springen?
  Nu: terug (een vooruitsprong slaat muziek over).
- Wil je de nieuwe actions ook op het toetsenbord (bv. ⇧ + R/T = jog)? Dat is S5 (toetsenbord als
  data); nu niets.

## Volgende versie

- Duwen samenvoegen in de engine (één segment met een kleine helling i.p.v. een sprong) als de
  proef zegt dat 4 ms overvloei bij 50 tikken/s toch hoorbaar is (E2).
- "Buig precies d seconden" als segment (bend met een eindpunt) in plaats van springen.
- De ring van de fasemeter in twee snelheden (grof/fijn) automatisch, naar hoe dicht je bij 0 zit.
- Sync-lock: de fase vasthouden over een tempowissel van de maatgever.
