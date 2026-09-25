# Spoor 3: fx-hellingen (kruisfades en kill klikvrij in Chrome)

Branch `spoor3/fx-hellingen`, vanaf `spoor2/dj-klank-c` (938796c). Worktree
`.claude/worktrees/agent-a50b5a02cf30f425c`, aan het eind losgekoppeld (`git switch --detach`).
Niet gemerged, niet gepusht, niets verwijderd. CLAUDE.md, HANDOFF, ROADMAP, VRAGEN en de mapping
niet aangeraakt.

## Commits

| commit | onderwerp |
|---|---|
| 1b37b34 | Effectwissel: kruisfade als hellingen na startDrempel, want Chrome breekt een curve niet netjes af |
| 83a62b4 | EQ-kill: begint pas na startDrempel, anders maakte een voorlopende renderthread de kill tot één stap |

Elke commit los getest (engine + regels uit de index na commit 1; alles na commit 2).

## Wat er aan de hand was: twee dingen, niet één

1. **De opgedragen fout (curve afbreken).** In `src/` stond precies één `setValueCurveAtTime`:
   `zetCurve` in `fx.js`. Die zette (a) de kruisfade van elke effect- en rackwissel (40 ms,
   `zetRack`: nieuwe keten erin, vorige eruit) en (b) de koppenwissel van de delay (80 ms,
   `wissel`). Onderbroken werd hij door `zetDoel` (mix, bypass: `_pasNiveausToe`) en door een
   tweede `zetRack` binnen de 40 ms (de vorige keten wordt dan midden in zijn fade-in
   uitgefaded). De delay-koppen worden in de praktijk niet onderbroken (`klaarOm` wacht), maar
   gaan via dezelfde functie mee. Macro's en glijden raken alleen `setTargetAtTime` op
   effectparameters (geen curve); via de delay-tijd komen ze bij `wissel`. De send-bussen zijn
   gewone InsertSlots: zelfde code. Alle andere automatisering in de engine is setTarget of
   lineair.

2. **Een tweede valkuil, door de oplossing zelf (hellingen te laat).** De aanpak van b53f74d
   (beginpunt + hellingen op `ctx.currentTime`) is realtime NIET klikvrij: de renderthread kan
   een paar ms vóór `currentTime` lopen (headless gemeten tot 7,5 ms, onder zware belasting vaker),
   en Chrome zet een nieuw automatiseringspunt dat voor hem al voorbij is op zijn eigen nu. Van
   een curve schuift dan alleen het begin op (daarom viel het bij curves nooit op); van hellingen
   vallen alle punten die al voorbij zijn samen tot één sprong. Bij de kill van 5 ms kan dat de
   HELE kill zijn: 0 dB -> -70 dB in één sample. Een `setTargetAtTime` die te laat komt heeft dit
   niet: die begint gewoon vanaf waar de parameter dan is.

## Oplossing

- Nieuw `src/engine/overgang.js` (geen imports, regel 1 blijft heel):
  - `startDrempel(ctx)` (verhuisd uit fx.js, fx.js exporteert hem nog: sampler en tests ongewijzigd)
  - `houdVast(param, nu)`: cancelAndHoldAtTime; zonder die API cancelScheduledValues + een punt op
    de huidige waarde (anders sprong een lopende helling terug)
  - `zetHellingen(param, punten(van), nu, duur, wacht)`: vasthouden op nu, beginpunt op nu, zelfde
    punt op nu+wacht, dan lineaire hellingen over `duur`.
- `fx.js`: `zetCurve` -> `zetOvergang(param, naar, ctx, duur)`: equal-power (`fadePunten`, 33 punten,
  zelfde vorm als de oude curve: een curve interpoleert ook lineair tussen zijn punten), wacht =
  startDrempel, geeft het eindmoment terug. `zetRack` ruimt de oude keten op na (drempel + fade +
  staart) + 50 ms; delay `klaarOm` = einde van de fade + 5 ms. `zetDoel` blijft op nu
  (houdVast + setTargetAtTime), nu met de gedeelde houdVast.
- `audio-graph.js`: `killEqBand(param, norm, kill, now, wacht = 0)` via zetHellingen (zelfde S in
  amplitude); `setEqBand` gebruikt de gedeelde houdVast. `deck._pasKillToe` geeft startDrempel mee.
- Gevolg: kruisfade en kill beginnen ~9 ms later (startDrempel = max(baseLatency, 128/sr) + 3 ms;
  headless 8,8 ms). Mix- en EQ-knop reageren direct zoals voorheen. Een mixdraai BINNEN die ~9 ms na
  een wissel annuleert de nog niet begonnen fade-in en brengt de nieuwe keten met setTarget
  (tau 10 ms) naar nat: glad, gemeten.

## Bewijs (headless Chromium 153.0.8010.12, poorten 8911/9511)

Echte InsertSlot, elke gain (droog en elke keten) een ConstantSource van 1 als invoer en een eigen
kanaal in een ChannelMerger: het kanaal IS de gain, sample voor sample. Realtime opgenomen met een
AudioWorklet (controle op aaneensluitende frames; een ScriptProcessor liet onder belasting buffers
vallen en gaf spooksprongen op alle kanalen tegelijk).

| scenario (grootste stap per sample in een gain) | oud (HEAD 938796c) | nieuw |
|---|---|---|
| offline: wissel, 5 ms later mix | 0,146 | 0,0021 |
| offline: twee wissels 8 ms na elkaar | 0,275 | 0,0007 |
| offline: snel (filter/phaser/mix+bypass/crush, zoals engine.test) | 0,328 | 0,0015 |
| offline: mix elk blok tijdens de wissel | 0,047 | 0,0017 |
| realtime: wissel + mix 5–13 ms later, 15 rondes | 14/15 sprong, tot 0,353 | 0/15, max 0,0021 |
| realtime: twee wissels 11–19 ms na elkaar, 15 rondes | 12/15 sprong, tot 0,596 | 0/15, max 0,0019 |

Start-race, realtime, 150 overgangen elk (load average 113–140 tijdens de meting):

| variant | sprongen > 0,01 | grootste |
|---|---|---|
| curve op nu | 0 / 150 | 0,0008 |
| hellingen op nu (aanpak b53f74d) | 12–14 / 150 | 0,29 |
| hellingen na startDrempel (nieuw) | 0 / 150 | 0,0008 |
| knopdraai: setTarget op nu | 0 / 150 | 0,0006 |
| knopdraai: houdVast + setTarget op nu (zetDoel) | 0 / 150 | 0,0006 |
| kill oud (b53f74d, op nu), grens 0,05 | 7–8 / 150 | 1,0 (hele kill in één sample) |
| kill nieuw (na startDrempel) | 0 / 150 | 0,0068 |

Deterministisch nagebootst (offline op blok 40 plannen alsof het blok 38 is = renderthread 5,3 ms
voor): curve 0,0008; hellingen op nu 0,195; hellingen na drempel 0,0008; kill op nu 1,000; kill
na drempel 0,0068.

In `tools/headless/kijk.mjs` staan nu (naast de bestaande kill-check):
- "effectwissel: binnen de kruisfade aan de mix draaien of nog eens wisselen, in Chrome geen sprong":
  echte InsertSlot, drie volgordes, grens 0,01 (gemeten 0,0021 / 0,0017 / 0,0017; oud 0,15–0,33).
- "renderthread 5,3 ms voor": kruisfade en kill na de drempel < 0,01 / < 0,05, én op nu nog steeds
  > 0,1 / > 0,5 (de check bewijst dus ook dat de valkuil echt bestaat).
Hele kijk.mjs: alles groen.

Proefscripts in `scratchpad/fx-hellingen/`: `meet.mjs` (InsertSlot offline + realtime, `WORTEL=`
worktree of `oud/`), `race-alles.mjs` (start-race, knop, kill), `verleden.mjs` (nagebootste
voorloop), `opname.mjs` (worklet-opnemer), `cdp.mjs` (8911/9511). Uitvoer: `voor3.txt`, `na3.txt`,
`race-alles2.txt`, `verleden.txt`, `kijk.txt`.

## Tests

- engine.test: mock telt `CURVE_BREUK` al (b53f74d); nu een check over de HELE test: 0 afgebroken
  curves (was 2: `snel wisselen` op deck C, tweede wissel + mixdraai). Nieuwe check-blok
  "effectwissel": beginpunt + 32 hellingen op sin, na startDrempel, oude keten ook als hellingen,
  mixdraai en tweede wissel binnen de fade zonder curvebreuk, nergens een setValueCurveAtTime.
  Mutatieproef: 6 checks rood op de oude fx.js; 1 rood (kill na drempel) op de oude deck.js.
- Kill-test aangepast: registreert twee setValueAtTime-punten (nu en nu+drempel); "knop tijdens de
  kill" en "twee keer drukken" vallen nu na de drempel, dus echt midden in de overgang.
- `nice -n 10 node test/alles.mjs`: 30 bestanden, 2027 checks, alles groen (was 2017). Geen wankele
  tijdchecks deze keer (vormen-zwaar 72 s onder load ~130, groen).

## Niet getest

- Niet gehoord; niet op de APC; niet in Clay's Chrome of Comet (152). Alles gemeten in headless
  153 op deze machine (fake audio-uitgang, baseLatency 5,8 ms, outputLatency 32 ms).
- Hoe ver de renderthread op Clay's Mac voorloopt is NIET gemeten: startDrempel schaalt mee met
  baseLatency, maar dat hij daar altijd ruim genoeg is, is een aanname (headless: lead tot 7,5 ms,
  drempel 8,8 ms, 0/150 onder load 140).
- De ~9 ms extra vertraging van kill en kruisfade niet op gevoel beoordeeld.
- Het terugvalpad zonder cancelAndHoldAtTime (Firefox) alleen in de mock.

## Niet in deze opdracht, wel gezien

- Losse korte hellingen op `nu` elders hebben dezelfde valkuil als de voorsprong groter is dan hun
  lengte (één segment valt pas samen als het HELE segment al voorbij is): gate zonder maat (5 ms,
  fx.js `herstart`), BufferBron `DECLICK` 4 ms (reserve-bron), sampler stop 20 ms (veilig). Met
  een voorsprong tot 7,5 ms kan de gate-helling en de BufferBron-declick dus tikken. Zelfde
  oplossing als hier (zetHellingen met wacht) als het ooit hoorbaar is.
- Een mixdraai binnen de drempel na een kill-druk op die band: setEqBand annuleert de nog niet
  begonnen S-kill en doet een setTarget naar -70 dB (in dB, tau 10 ms): glad (grootste stap ~0,017
  per sample, kijk-grens 0,05), maar niet de S-vorm. Bestond al bij een knopdraai midden in de kill.

## Voor de integrator

- `git merge-tree` met integratie-r2: nieuw triviaal conflict in `src/engine/deck.js`, de imports
  (integratie-r2 `import { hoorbaar, uitgangsVertraging } from './hoorbaar.js';`, hier
  `import { startDrempel } from './overgang.js';`): beide houden. Verder de conflicten die de
  controleur van dj-klank-c al noemde (puls.js, video-mixer.js).
- Met spoor2/dj-transport-c: alleen de al bekende conflicten (engine.js, video-mixer.js); fx.js en
  audio-graph.js voegen schoon samen.
- integratie-r2 en dj-transport-c hebben nog de oude `zetCurve` met setValueCurveAtTime: die gaat
  weg met deze branch. Wie ergens anders `zetCurve` aanroept (niemand, gecontroleerd) moet
  `zetOvergang(param, naar, ctx, duur)` gebruiken.

## Voorstel CLAUDE.md

Vervang de bullet "Zet nooit `setTargetAtTime` op een AudioParam waar nog een
`setValueCurveAtTime` op loopt ..." door:

> - Overgangen op een AudioParam (kruisfade, kill) NOOIT als `setValueCurveAtTime`. Bovenop een
>   lopende curve gooit `setTargetAtTime` NotSupportedError, en een curve afbreken met
>   `cancelAndHoldAtTime` gooit niet maar Chrome (153, offline én realtime) speelt het afgekapte
>   stuk opnieuw af vanaf het begin: een sprong van 0,15–0,6. Gebruik `zetHellingen()` uit
>   `src/engine/overgang.js` (via `zetOvergang` in fx.js, `killEqBand`): vasthouden op nu,
>   beginpunt, lineaire hellingen (zelfde vorm), en pas beginnen na `startDrempel`. Dat laatste
>   omdat de renderthread een paar ms vóór `currentTime` kan lopen (headless tot 7,5 ms) en Chrome
>   een voorbij punt op zijn eigen nu zet: korte hellingen vallen dan samen tot één stap (de kill
>   van 5 ms: 0 -> -70 dB in één sample). Een doelwaarde (mix, EQ-knop) gaat direct op nu via
>   `zetDoel()`/`setEqBand` (houdVast + setTargetAtTime): te laat komen is daar onschuldig. De mock
>   in engine.test gooit bij overlap zoals Chrome en telt een afgebroken curve (`CURVE_BREUK`, moet
>   over de hele test 0 zijn); `kijk.mjs` meet het in Chrome, ook met een nagebootste voorsprong.

En in "Verbeterronde 23 september": "`zetCurve` breekt een lopende curve eerst af ..." wordt
"`zetOvergang` (was zetCurve) houdt een lopende overgang vast en gaat van daar verder ...".
Structuur, onder engine/: `overgang.js  overgangen op een AudioParam: hellingen die Chrome netjes
afbreekt, na startDrempel`. In het EQ-KILL-voorstel van de controleur: "na startDrempel een
beginpunt en 32 lineaire hellingen van 5 ms ...".
