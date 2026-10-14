# Werkruimte S1: precisie (14 okt 2026)

Tak `werk/S1` (vanaf `werkruimte/integratie` e8dcd98, met S0 erin), worktree buiten iCloud, niet
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
9. `test/precisie.test.mjs` (nieuw, 73 checks), `tools/headless/precisie.mjs` (nieuw, 14 checks).
10. Docs: `docs/werkruimte/S1.md`, WERKRUIMTE.md S1 "Gebouwd", CLAUDE.md drie structuurregels en
    twee zinnen in het blok "Werkruimte: aanhaakpunten".

Buiten de grens: in ronde 1 één aanhaker in `src/control/terugspelen.js` (`nummerNodig`, zie
"Review ronde 1"); verder niets. (De grens noemde `docs/werkruimte/S1.md`; dit verslag en de regels in
WERKRUIMTE.md en CLAUDE.md vroeg de opdracht van de werkstroom.)

## Afspraak met Clay: het stuk is een VOORBEELD

Clay maakt zelf de knoppenverdeling (14 okt). Wat dit spoor levert is het MECHANIEK (de actions op
de bus, de Duwer, de duoklik, `zetStukOp`) plus één klein voorbeeld: `mappings/stukken/uitlijn.json`
heeft `"voorbeeld": true`, de titel begint met "Voorbeeld:" en `_uitleg` met "VOORBEELD" (de test
controleert het). Er is geen standaardindeling bijgekomen: `mappings/apc40mk2.json` is niet
veranderd, en zonder `?uitlijn=1` (of later: zonder een werkruimte die het stuk noemt) doet VARVE
precies wat hij deed. De actions staan wel altijd op de bus, maar doen niets tot iets ze aanroept.

## Zelf invullen (voor Clay)

Er zijn drie manieren, van snel naar blijvend. Geen ervan vraagt code.

**1. Eén knop koppelen (meteen, blijft bewaard als jouw verschil).**
Koppelmodus aan, kies de action (bv. `track.2.phase.offset`, of `track.{focus}.jog.fwd`), beweeg
de knop. Klaar: hij staat in je eigen mapping, zoals elke andere koppeling. Handig om te proeven.

**2. Een eigen stuk (een idee over de hele APC, aan en uit als geheel).**
Kopieer `mappings/stukken/uitlijn.json` naar bv. `mappings/stukken/mijn-uitlijn.json` en pas aan:
- `"stuk": "mijn-uitlijn"`, een eigen `titel`, haal `"voorbeeld": true` weg.
- In `mapjes.nieuw` het mapje (naam, kleur, kiesknop). Wil je geen nieuw mapje, laat `mapjes` weg
  en zet je regels zonder `laag` op knoppen die in de standaard nog vrij zijn.
- In `regels.apc40mk2` per knop één regel: `in` (de knop, zie `docs/APC40.md`), `action`, `mode`.
  Draaiknoppen `endless` (zonder `takeover`-veld: zie "Review ronde 1"); drukknoppen `trigger`.
  `shift: true` = met Shift.

Voorbeeld (een aanpassing van `uitlijn.json`, dus in het mapje `device.uitlijn` van dat bestand):
met Shift doen Device ◀ ▶ fijn joggen, en knop 1 wordt de bend-sterkte van de focus-track. Vervang
in `regels.apc40mk2` de regels met dezelfde `in` + `laag` + `shift` door deze (vervangen, niet erbij
zetten: één regel per knop per mapje, met en zonder Shift):

```json
[
    { "in": "note:0:58", "laag": "device.uitlijn", "action": "track.{focus}.jog.fine.back", "mode": "trigger", "shift": true },
    { "in": "note:0:59", "laag": "device.uitlijn", "action": "track.{focus}.jog.fine.fwd",  "mode": "trigger", "shift": true },
    { "in": "cc:0:16",   "laag": "device.uitlijn", "action": "track.{focus}.bend.amount",  "mode": "endless" }
]
```

Proeven: open VARVE met `?uitlijn=1`, ⇧ Lock. Zolang S3 de stukken nog niet laadt, laadt de vlag
alleen `uitlijn.json`; een eigen bestand ernaast werkt pas via een werkruimte (manier 3). Let op
botsingen met de standaard: `node test/precisie.test.mjs` telt de botsingen van `uitlijn.json` (moet 0 blijven); voor een eigen
stuk doet de werkruimte-kern (S3) dat met een waarschuwing.

**3. In een werkruimte (S3).** Noem het stuk in je werkruimte (`"stukken": ["basis", "mijn-uitlijn"]`,
WERKRUIMTE.md "Werkruimte"): dan staat het aan als die werkruimte aan staat, zonder vlag.

Welke actions er zijn en wat ze precies doen: de tabel in `docs/werkruimte/S1.md`, of klik een
knop aan op `apc.html` (de uitleg komt uit `src/ui/beschrijf/precisie.js`). Wat vast in de code
staat en niet in data: de stapgroottes (1/16 en 1/64 tel, 5 en 1 ms, 15 ms samenvoegen). De
bend-sterkte is wel een knop (`track.N.bend.amount`).

## Gemeten (exacte commando's)

Alles vanuit `…/scratchpad/wt/werk-S1`. Chrome als root vraagt `--no-sandbox`: `VARVE_CHROME` wees
naar `scratchpad/chrome-shell.sh` (`exec …/headless_shell --no-sandbox "$@"`).

| wat | commando | uitkomst |
|---|---|---|
| de nieuwe test | `node test/precisie.test.mjs` | 73 ok (ook: het stuk is gemarkeerd als voorbeeld). phase.offset 0,5000; één tik 3,810 ms, fijn 0,476 ms; 50 invokes in 100 ms = **7 seeks**, eindfase 48,387 = 48,387 ms (één invoke met de som); keylock 100 tikken: 6 sprongen, **0 erbovenop**, 96,774 ms aangekomen; jog in pauze **30,242 ms**, stil, cuepunt gelijk; jog spelend in een loop 4 × 30,24 ms en in de loop; zonder grid 5,000 ms; op de 1 ook over een stukgrens met maat-anker (waar doortellen een tel naast was); onzeker grid geweigerd; sync-lampje 0,0100 → 0, 0,0040 → 1; duoklik op ctxTimeOf, controleklik dezelfde samples; duwen speelt terug als dezelfde duw (48,387 ms); APC-knop 2 via de echte Mapping één tik 3,810 ms, ⇧ 0,476 ms |
| headless | `VARVE_CHROME=…/chrome-shell.sh VARVE_PRECISIE_TMP=…/scratchpad/tmp-werk-S1 node tools/headless/precisie.mjs …/tmp-werk-S1/uit` (poorten 8912/8913, `VARVE_TESTSERVER=1`, alle VARVE_*-paden in tmp) | 14 ok. App: zonder vlag geen regel, met `?uitlijn=1` 20 regels `stuk:uitlijn`, ⇧ Lock opent `device.uitlijn`, `?uitlijn=0` weer uit, geen consolefout. Offline 48 kHz, demotrack, uitvoer per deck: **7,000 ms → na 15 tikken fijn −0,145 ms** (verwacht −0,144; < 1 ms); 50 tikken/s: na 1 s 190,50 ms (50 × 3,81), terug 0,000 ms, geen tik verloren; **grootste knik 0,2545 met duwen, 0,2897 zonder** (+−0,035 ≤ 0,05; een harde knip van één tik zou tot 0,728 geven); duoklik: 11 lage (587–880 Hz) en 10 hoge (1175–1760 Hz) tikken **hooguit 0,84 sample** van ctxTimeOf + de vooruitblik van de limiter, flam precies 50 ms |
| alle tests | `node test/alles.mjs` | Na de rebase op e8dcd98 en de voorbeeld-markering: 104 bestanden, 9220 checks, 343 s. **Rood: de bekende drie** van deze container (renderblok "keylock met wissels … 74,4 bytes per bericht", met gouden hash `9dfaeb73` en 0 GC groen; wachtrij "yt-dlp en zijn kind" 2×; instrumenten-fm-schaal "geen afval per blok") **plus midi.test** "in elk schuivend venster van 4 ms hooguit 16 (gemeten 17)": een wandklok-meting zonder `// @alleen` die onder load wankelt. `src/control/midi.js` en `test/midi.test.mjs` zijn gelijk aan de basis; los gedraaid daarna 0/12 rood (en 0/8 op de basis). Buiten mijn grens, niet aangeraakt. Alle andere groen |

## Wat niet gedaan is

- Geen schermknoppen of toetsen voor de nieuwe actions (de opdracht vroeg alleen bus + stuk; het
  paneel/de uitlijnweergave is S2, panelen S7). Te koppelen met koppelen, zoals altijd.
- Het stuk laden als stuk (zonder vlag) is van S3.
- Maschine-plekken (UITLIJN-pads, SWING + wiel, knop 4 = bend-sterkte) zijn van S6: de actions
  bestaan.
- Geen schrijfweg van buiten de Mac (W1), geen engine-effecten (W3).

## Alleen op de hardware te bevestigen

- Zet de APC in 0x42 zijn interne knopstand gelijk aan de ring die wij sturen? (mapping.js weet
  het niet.) Na ronde 1 geeft geen van beide gevallen een sprong, maar proef het: jog ▶ (Device ▶
  in het mapje uitlijn), dan één tik aan knop 2: 3,81 ms of niets, nooit ~30 ms.

- Is de pan-ring van de APC leesbaar als fasemeter (15 lampjes: grof ~32 ms, fijn ~4 ms per
  lampje)? Gaat het rond draaien over de rand goed onder de vinger?
- Hoor je een duw van 0,48 ms, en klinkt een duw van 3,81 ms met 4 ms overvloei als niets?
- De duoklik in de echte koptelefoon (vier kanalen): zijn hoog/laag goed uit elkaar te houden,
  en is het volume (0,5, als de controleklik) goed?
- Met keylock in Chrome op de M1 (de Signalsmith-worklet): het samenvoegen is in de mock getest.

## Vragen voor Clay

- (Voor wie samenvoegt, niet voor Clay:) `test/midi.test.mjs` meet de wachtrij van 4 ms op de
  wandklok in de pool; onder load soms 17 in een venster. Een `// @alleen` bovenaan zou het oplossen
  (de regel uit CLAUDE.md); dat bestand is van controller-uitvoer, niet van S1.

- Duoklik: hoog op de track die je gelijkzet en laag op de maatgever (zoals gebouwd), of andersom
  (zoals A6 in het ontwerp het zei)?
- Moet "op de 1" bij gelijkspel (precies twee tellen naast) liever vooruit dan terug springen?
  Nu: terug (een vooruitsprong slaat muziek over).
- Wil je de nieuwe actions ook op het toetsenbord (bv. ⇧ + R/T = jog)? Dat is S5 (toetsenbord als
  data); nu niets.

## Volgende versie

- De stapgroottes (jog 1/16 en 1/64 tel, zonder grid 5/1 ms) als instelling in een werkruimte of
  stand, als Clay na de proef andere wil (nu constanten in `acties-precisie.js`).
- `?uitlijn=<naam>` of, beter, S3 die elk stuk uit `mappings/stukken/` laadt: dan proeft Clay
  een eigen stuk zonder het voorbeeld te overschrijven.

- Duwen samenvoegen in de engine (één segment met een kleine helling i.p.v. een sprong) als de
  proef zegt dat 4 ms overvloei bij 50 tikken/s toch hoorbaar is (E2).
- "Buig precies d seconden" als segment (bend met een eindpunt) in plaats van springen.
- De ring van de fasemeter in twee snelheden (grof/fijn) automatisch, naar hoe dicht je bij 0 zit.
- Sync-lock: de fase vasthouden over een tempowissel van de maatgever.

## Review ronde 1 (14 okt)

Twee blokkerende punten, beide opgelost; van de kleine punten vier opgelost, de rest weerlegd of als
grens vastgelegd.

**B1. Terugspelen sloeg de nieuwe transport-actions niet over op een track zonder zijn nummer.**
Klopte: `NUMMER_NODIG` ving alleen `nudge.fine.*`. Opgelost met een meta-vlag, zoals S0 het voor
`log: 'overslaan'` deed: `nummer: true` in de define() van `phase.offset(.fine)`, `jog.*`,
`jog.fine.*`, `nudge.fine.*`, `beatjump.quarter|half|beat.*` en `bar.align`, en in
`src/control/terugspelen.js` een aanhaker `nummerNodig(a, metaOf)` = `NUMMER_NODIG.test(a) ||
meta.nummer === true`, gebruikt waar `NUMMER_NODIG` stond (één regel in `_doe`). **Buiten de grens
van S1** (terugspelen.js is van S0): 9 regels erbij, NUMMER_NODIG zelf niet veranderd. Wie samenvoegt:
het is een toevoeging naast `slaOver`, botst met niets. Check: een Terugspeler met `zonder: [2]` en
alle elf soorten op track 2 slaat ze alle elf over; `track.2.fader` en `track.1.jog.fwd` gaan door.
`bend.amount` en `duoklik` horen bij de track en hebben de vlag niet.

**B2. `takeover: 1` op de fasemeters gaf een sprong na een jog of sync.** Klopte, nagemeten met het
script van de reviewer: +30,48 ms na jog ▶ en −41,91 ms na een sync (de reviewer mat −34,29; het
hangt af van waar de fase stond), in plaats van 3,81. Opgelost: `takeover` weg uit de 16 regels
(standaard 0,02 van `_endless`). Nieuwe checks in precisie.test, via de echte Mapping en het stuk,
in twee gevallen (de APC zet zijn knopstand gelijk aan de ring, of niet): jog ▶ = 30,24 ms, de
eerste tik daarna 0,00 ms (alleen onthouden), de volgende 3,81 ms; na een sync hetzelfde. Met
`takeover: 1` terug falen ze (nagegaan). Drift kost nu hooguit één tik per 0,02 (≈ 10 ms; fijn
≈ 1,2 ms). Of de APC zijn knopstand gelijkzet staat nu bij "Alleen op de hardware".

**Kleine punten:**
- ⇧ Lock in de grid-modus: klopte (viel terug op de regel van `edit.aan`, dus slot; met het stuk
  opende hij uitlijn). Opgelost met een 21e regel in het stuk: `note:0:63` shift `laag: edit.aan`
  = `track.{focus}.grid.lock`. Check: met en zonder stuk slot in de grid-modus, erbuiten opent hij
  uitlijn. 0 botsingen.
- takeover en de gelijkzet-vraag: zie B2.
- De rand van de ring (0,999 + 1/127 = 1: 0,001 tel): klopt, niet opgelost. De action krijgt de
  geklemde waarde en weet niet hoe groot de tik bedoeld was; een uitzondering op v = 1 zou de muis
  (slepen tot 1) verkeerd laten duwen. Daar sta je een halve tel naast: jog of beatjump ¼. In S1.md
  bij "Wat niet getest is".
- De Duwer in een verborgen tabblad: opgelost voor het geval dat ertoe doet (pauze): verborgen en de
  track staat stil = elke duw meteen, zonder timer (een seek in pauze is goedkoop). Spelend blijft
  het via de timer (een hoorbaar tabblad wordt niet geknepen). De eerste tik direct uitvoeren en
  daarna samenvoegen is NIET gedaan: dat geeft 8 sprongen in 100 ms en breekt de eis ≤ 7. Check:
  `verborgen: () => true` → twee duwen, 0 timers, 5,000 ms; zichtbaar: via de timer.
- phase.offset als absolute stand in het log: klopt, zo is het log (waarden, geen verschillen).
  Vastgelegd als grens in S1.md; getest is het stabiele geval.
- De flam van de duoklik kwam ~150 ms te laat: opgelost. Zolang de duoklik aan staat hebben beide
  GridKliks `volg = true`: na elke `change` wordt een tik die klaarstaat maar niet meer op
  `ctxTimeOf` van zijn tel valt (> 0,5 ms) gestopt en opnieuw gepland. De controleklik alleen houdt
  `volg = false` en gedraagt zich precies als voorheen (check: een klaarstaande tik blijft staan).
  Check: na een duw van 5 ms staat de hoge tik meteen 5,000 ms eerder, op `ctxTimeOf`.
- Het stuk niet binnen gaf "aanhaker precisie niet gestart": opgelost, de aanhaker vangt het zelf
  en meldt "het stuk … kwam niet binnen (HTTP 404). De precisie-actions werken wel". Check met een
  nep-fetch.
- Duwen op een remmende track doet niets: bewust (een sprong haalt de rem eraf). De knop meldt het
  al bij de druk (`nietNu`: "remt: eerst los"); alleen als de rem begint in de 15 ms tussen tik en
  timer is hij stil. Niet veranderd.

**Gemeten na ronde 1:**

| wat | commando | uitkomst |
|---|---|---|
| precisie | `node test/precisie.test.mjs` | 90 ok (was 73) |
| headless | `VARVE_CHROME=…/scratchpad/chrome-shell.sh VARVE_PRECISIE_TMP=…/scratchpad/tmp-werk-S1 node tools/headless/precisie.mjs …/scratchpad/tmp-werk-S1/uit` | 14 ok; in de app nu 21 regels `stuk:uitlijn`; de rest gelijk (−0,145 ms na 15 fijne tikken, knik 0,2545 tegen 0,2897, duoklik ≤ 0,84 sample) |
| los | handelingenlog, engine, mapping, aanhaakpunten, grid-bediening, secties-log, auto, spiegel, feedback, regels, learn | alle groen |
| alles | `node test/alles.mjs` | 104 bestanden, 9237 checks, 266 s. Rood alleen de bekende drie van deze container: renderblok "keylock met wissels … 83,7 bytes per bericht" (gouden hash `9dfaeb73` en 0 GC groen), wachtrij "yt-dlp en zijn kind" 2×, instrumenten-fm-schaal "geen afval per blok". midi.test deze keer groen |
