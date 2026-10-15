# Spoor A: audio-gezondheid (architectuurronde, 15 okt)

Tak `arch/audio` (vanaf `studio/architectuur`). Vijf punten: worklets die echt
stoppen (A1), fouten in een worklet melden (A2), de AudioContext bewaken (A3),
een lange set als proef (A4) en eerst meten wat de renderloop per beeld kost (A5).

Gemeten in een Linux-container (4 kernen, belasting 6–11 door andere sporen),
Chromium 1194 headless, Node 22. Tijden zijn daardoor ruim; bytes niet.

## A1. Worklets stoppen echt na vernietigen

**Wat er mis was.** Een AudioWorkletNode waarvan `process()` `true` blijft geven
ruimt de browser nooit op, ook als niets er meer aan hangt (Web Audio: de
processor houdt zichzelf actief). `StreamBron.vernietig()` koppelde alleen los.
Elke keer dat er een instrument op een track kwam (`deck.leeg()` → `vernietig()`
na 100 ms) bleef er een stream-lezer draaien, met zijn Signalsmith-stretchers
als er keylock aan stond. Hetzelfde voor het instrument schaal (`vernietig()`
sloot alleen de poort).

**Gebouwd.**
- `src/engine/stream-lezer.js`: bericht `{ type: 'stop' }` → `_stop()`: pagina's
  en stretchers los, geen berichten meer, `blok = null`; `process()` geeft dan
  `false`. Geen nieuw veld in de constructor (een veld meer maakte de afvaltest per
  bericht eerder wisselvallig); de tak staat achteraan in `onmessage`.
- `src/engine/bron.js` `vernietig()`: eerst de lege `'bron'` zoals altijd, dan
  `'stop'`, los, `onprocessorerror = null`, `port.onmessage = null`, `port.close()`.
  Alleen daar; `laad()` gebruikt dezelfde node opnieuw (getoetst).
- `src/engine/instrumenten/schaal-worklet.js` + `schaal.js`: `{ t: 'stop' }` vóór
  `port.close()`, process daarna `false`.
- `klankschaal-worklet.js` en `limiter-worklet.js`: een `'stop'` erbij (process
  daarna `false`). Er is nog geen aanroeper: de klankschaal en de master leven zo
  lang als de AudioContext.
- `fx-worklet.js` en `opname/opnemer-worklet.js` deden het al goed. In `fx-meer.js`
  sluit `w.stop()` de poort niet; die regels mocht ik niet aanraken (alleen de
  regel waar de node gemaakt wordt). Het `'stop'` zelf komt wel aan.

**In Chrome nagekeken** (`tools/headless/gezondheid.mjs`, deel 2): een eigen
processor die per blok een teller in een SharedArrayBuffer ophoogt. `'stop'` en
meteen `close()` in dezelfde taak: het bericht komt aan, de teller staat stil
(112 → 112). Alleen los en dicht (zoals vroeger): de node rekent door (229 → 417).

**Gouden hash en 0 GC** in `test/renderblok.test.mjs` onveranderd (9dfaeb73);
alleen de bekende rode check "keylock met wissels: … bytes per bericht" (89,7 hier).

## A2. `onprocessorerror` op elke AudioWorkletNode

Een fout in een worklet is vanaf dat moment stilte, voor altijd; tot nu toe
zonder melding. De engine kent geen DOM, en de objecten met een worklet kennen de
engine niet: de melding gaat daarom over de **AudioContext zelf** (een EventTarget,
iedereen heeft hem). `src/engine/worklet-fout.js`: `meldWorkletFout(ctx, wat,
{ reden, hint })` stuurt het event `varve-workletfout`; de engine luistert en maakt
er `emit('melding', { tekst, soort: 'fout', sleutel: 'worklet:<wat>' })` van.

Per soort:
- **StreamBron**: één keer per laad een **nieuwe node op dezelfde plek**: hetzelfde
  segment {T, P, R} (regel 3: hij speelt waar hij nu hoort te zijn), het bestand
  opnieuw aangekondigd, de pagina's opnieuw opgehaald (ze waren naar de oude worklet
  overgedragen; tot ze er zijn een gat, zoals na een sprong). Melding via `onFout`
  (deck `'fout'`). Gaat het nog eens mis: stil, melding "blijft stil tot je een
  nummer laadt", `node = null`; de volgende laad bouwt een nieuwe. Een gepland
  segment gaat met `gepland` terug; een lopende geplande sprong met keylock
  (`_vorig`) speelt tot T niet meer (stilte tot T): randgeval, niet gebouwd.
- **Master-limiter**: zonder ingreep is de hele master stil. Terug naar de
  compressor van vroeger (fx → compressor → limiter-uitgang), ingevloeid van 0 naar
  1 in `LIMITER_FADE` na `startDrempel` (de worklet zwijgt al), `soort`
  'compressor', de reden in `limiterStand().fout`, vertraging weer 6 ms.
- **Klankschaal** en **instrument schaal**: los, melding, de volgende aanslag/noot
  bouwt hem opnieuw (`start()` vanaf nul).
- **Effecten** (fx-meer.js `metWorklet`, één regel bij het maken): melding "effect
  kam liep vast …; kies het opnieuw". Geen herstel.
- **Opnemer**: `onFout` ("vanaf hier wordt niets meer opgenomen, stop en begin
  opnieuw"); stoppen werkt daarna gewoon.

**In Chrome nagekeken** (`gezondheid.mjs`, deel 3): een segment met een BigInt in P
(alleen als proef) laat `process()` van de echte stream-lezer gooien. Chrome vuurt
`processorerror` ("an error thrown from AudioWorkletProcessor::process() method"),
de StreamBron bouwt opnieuw op, het geluid is terug (piek 0,078) en de positie liep
door (2,965 s, verwacht 2,965 s). De tweede keer: stil (piek 2·10⁻¹⁸) met de melding
die blijft staan; een nieuw nummer laden klinkt weer.

## A3. De AudioContext bewaken

`src/ui/gezondheid.js` (schermlaag; de engine weet van niets):
- puur: `audioMelding({ state, klokStil, gestart })` → tekst en ernst, en
  `KlokWachter` (contexttijd tegen wandklok);
- `opzetGezondheid({ ctx, meld, midi, venster })`, aangeroepen in `app.js` na
  `opzetMidi`. Bij `statechange` uit 'running' (niet 'closed') een fout met
  sleutel `audio`; de eerstvolgende invoer van de controller (`MidiHub.onInput`,
  dus ook via de hub) of een toets probeert `ctx.resume()`. Weer 'running' = dezelfde
  sleutel wordt "audio loopt weer" (info, 4 s). Klokwachter: elke 1 s; twee keer
  achter elkaar > 0,5 s achter terwijl 'running' = "audio-uitgang staat stil".
  Vóór de audio ooit liep: niets (de gewone beginstand), ook geen hervat-poging
  (dat doet "audio starten", dat ook MIDI initialiseert).

**In Chrome nagekeken** (`gezondheid.mjs`, deel 1), ZONDER autoplay-vlag: een echte
klik (CDP Input) op "audio starten", daarna `ctx.suspend()` → de melding; een druk
op een nep-APC → 'running' en "audio loopt weer" (resume zonder nieuw gebaar werkt
dus na de eerste klik); idem met Shift. 3,5 s met een lopende klok: geen vals alarm
(achter 0,008 s per meting). Een stilstaande klok bij 'running' is in Chrome niet
na te maken zonder de uitgang weg te halen; die zit alleen in
`test/gezondheid.test.mjs` (nep-klok).

## A4. Lange set als proef

`tools/headless/lek.mjs`: `PROEF=laad` (60× een library-nummer laden en spelen, om
en om op track 1 en 2, keylock om de beurt) en `PROEF=wissel` (50× op track 1 een
instrument, poly en schaal om en om, en dan weer een nummer met keylock dat speelt).
Eis: de renderer na GC (`HeapProfiler.collectGarbage` + een gc() in de
AudioWorkletGlobalScope) hooguit +20 MB t.o.v. het begin, na 4 stappen opwarmen;
anders exit 1. Zonder `PROEF` meet hij de opname zoals voorheen.

**Waarom privé en niet RSS.** De eerste metingen gaven ook bij `laad` (waar geen
node verdwijnt) +52 tot +84 MB RSS. Uit `/proc/<pid>/smaps_rollup`: dat was bijna
helemaal `Shared_Clean` (+45 MB rond stap 20, daarna vlak): code van Chrome die pas
dan voor het eerst draait. Geen lek. Op Linux telt de eis daarom het privé geheugen
(`Anonymous`), elders RSS; beide staan in de uitvoer.

| proef | vóór A1 (basis) | na A1 |
|---|---:|---:|
| `wissel` 50×, privé na GC | **+68 MB** (122 → 190), ~1,4 MB per wissel vanaf stap 20 | **+3 MB** (119 → 122) |
| `wissel` 50×, RSS na GC | +115 MB | +49 MB (de gedeelde code) |
| `laad` 60×, privé na GC | +3 MB | −5 MB |
| `laad` 60×, RSS na GC | +50 MB | +44 MB |

`laad` lekte dus niet (de node wordt hergebruikt); `wissel` wel, en dat is weg. Een
run van 100 wissels na A1 (diagnose) bleef vlak in JavaScript (25 MB volgens
`measureUserAgentSpecificMemory`) met wat ruis in het privé deel (±10 MB).

## A5. Eerst meten, dan bouwen

`tools/headless/beeld-afval.mjs`: acht spelende tracks (de demotrack via de knop
demo, dus met golfvorm), CPU-tijd per functie omwikkeld, CDP-heapsampling (elke
256 bytes, inclusief wat de GC al opruimde). Twee grids: één stuk en een tempokaart
van 12 stukken. Headless haalde hier maar 6–31 beelden/s (belasting); de bytes per
beeld zijn de betrouwbare maat.

| per beeld (12 stukken) | vóór | na |
|---|---:|---:|
| golfvorm-sleutels (`_gridTekst` + `_grid`) | 8 066 B, 1,54 ms/s bij 25 b/s | 328 B, 0,21 ms/s bij 31 b/s |
| `engine.snapshot()` met alles eronder | 37 kB | 26 kB |
| hele pagina | 176 kB | 92 kB |

Met één stuk: sleutels 1 795 → 817 B per beeld. Meetbaar (bij 60 beelden/s op de
M1 ~0,5 MB/s afval en ~1 ms/s alleen voor de sleutels met een tempokaart), dus
gebouwd:
- snapshot geeft `gridVersie`; de golfvorm-sleutel is `${id}#${gridVersie}` (een
  stand zonder `gridVersie` valt terug op de tekst). `engine.test` loopt elke
  grid-action na (25; 23 veranderden het grid) en eist dat gridVersie dan omhoog
  gaat. In de broncode gaat elke bewerking (zetStuk, schuif, pin, setBpm, keurGoed,
  `slot = true` …) via `gridGewijzigd()` of `setGrid()`; nagelopen met grep.
- Bijvangst, de grootste post: `StreamBron.buffer` maakte bij ELKE aanroep een nieuw
  object, ~945 kB/s. Nu één per geladen bestand (`bestand.info`).

**Niet gedaan, wel de volgende stap:** `grid.toJSON()` in `snapshot()` (~14–17 kB
per beeld met 12 stukken, ~0,5 MB/s bij 31 b/s). Zelfde truc (op gridVersie
onthouden) kan, maar dan delen alle beelden één object; wie de snapshot aanpast zou
het grid van de volgende beelden veranderen. Eerst nalopen wie `snap.decks[x].grid`
leest. Verder in de top: `maatgever`/`volgMaatgever`/`syncMaster` (tientallen kB/s)
en de `fx.plekken`-lijst in `deckState`.

## Tests

- Nieuw: `test/gezondheid.test.mjs` (32 checks). Erbij: `stream.test` (stop,
  vernietig, herladen, processorerror, buffer), `engine.test` (melding met sleutel,
  gridVersie bij elke grid-action), `master.test` (limiter-fout → compressor, stop),
  `klankschaal.test`, `instrumenten-fm-schaal.test`, `effecten-s10.test`,
  `opnemer.test`.
- Mocks strenger: `port.close()` waar AudioWorkletNode nagebootst wordt (na close
  komt er niets meer aan, zoals bij een echte MessagePort); de nep-contexten in
  engine, master, klankschaal, instrumenten-fm-schaal en nep-fx zijn EventTargets.
- `node test/alles.mjs --banen 2`: **134 bestanden, 11503 checks, 10 overgeslagen —
  4 ROOD**, alle vier bekend van deze container en ook rood op de basis: backup-kopie
  ("één regel" en "controleer: exit 0", allebei ook op `studio/architectuur`),
  wachtrij ("yt-dlp en zijn kind"), instrumenten-fm-schaal (afval per blok, ook op
  de basis rood: 26–30 kB), renderblok ("keylock met wissels: 89,7 bytes per bericht").
- Headless: `tools/headless/gezondheid.mjs` (alles groen), `lek.mjs` (zie A4),
  `beeld-afval.mjs` (zie A5). Allemaal op eigen poorten (8931–8938) met een
  tijdelijke map en `VARVE_TESTSERVER=1`.

## Voor CLAUDE.md (kort)

- Een AudioWorkletNode die weg moet krijgt eerst `'stop'` (of `{ t: 'stop' }`) en
  geeft daarna `false` uit `process()`; pas dan los en `port.close()`. Alleen los of
  dicht = hij draait voor altijd (gemeten: +68 MB na 50 instrumentwissels). Nooit op
  het herlaadpad van de StreamBron (`laad()` hergebruikt de node).
- Elke AudioWorkletNode krijgt `onprocessorerror`. Melden over de context:
  `meldWorkletFout(ctx, wat, { reden, hint })` (`src/engine/worklet-fout.js`); de
  engine maakt er een melding met sleutel `worklet:<wat>` van. StreamBron bouwt één
  keer per laad opnieuw op (zelfde segment), de limiter valt terug op de compressor.
- `src/ui/gezondheid.js`: de AudioContext bewaakt (sleutel `audio`); de eerste druk
  op controller/hub/toetsenbord na een suspend doet `ctx.resume()`.
- Golfvorm-sleutels lezen `gridVersie` uit de snapshot. Een nieuwe plek die het grid
  verandert: via `gridGewijzigd()`/`setGrid()`, anders tekent de golfvorm oude lijnen
  (`engine.test` "gridVersie volgt elke gridwijziging").
- `deck.buffer` van een StreamBron is één object per bestand (geen afval per beeld);
  vergelijken op identiteit blijft af te raden (laadSleutel = `bron.bestand`).
- `lek.mjs` meet op Linux het privé geheugen (smaps `Anonymous`): RSS telt gedeelde
  code van Chrome mee die pas laat voor het eerst draait.

## Open vragen voor Clay

1. Effect-worklets en klankschaal: bij een fout nu alleen een melding (effect) of
   opnieuw opbouwen bij de volgende aanslag (klankschaal). Wil je dat een vastgelopen
   effect zichzelf ook opnieuw opbouwt, of liever zelf kiezen?
2. De melding "audio staat stil" is rood en blijft staan tot hij weer loopt. Goed zo,
   of wil je bij een suspend ook meteen (zonder druk) een poging tot hervatten?
3. `grid.toJSON()` in elke snapshot (A5, de volgende stap): mag de snapshot het grid
   als gedeeld object geven (dan mag niemand het aanpassen), of liever zo laten?
