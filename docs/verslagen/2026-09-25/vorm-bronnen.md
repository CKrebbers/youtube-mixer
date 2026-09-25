# Spoor 2 — vormen reageren op de maat (ROADMAP 23, deel)

Branch `spoor2/vorm-bronnen` (worktree `agent-a2ec750db0bdfd56d`), drie commits op `cc527e3`:

| commit | onderwerp |
|---|---|
| `2a10096` | Vormen reageren op de maat: klappen en tel van de maatgever als bron (maat.js, router, label, uitleg, tests) |
| `9b07b67` | Vorm-paneel: de maatbronnen kiezen en zien wie de maat geeft |
| `ee4e894` | Headless: vorm-maat.mjs meet de maatbronnen in Chromium met ?vormen=1 |

```
 src/analysis/maat.js         | 214 +++++  (nieuw)
 src/analysis/router.js       |  45 +-
 src/control/actions.js       |   2 +-   (alleen het label van video.layer.react.source)
 src/ui/apc-beschrijf.js      |   3 +-   (uitleg react.source)
 src/ui/vorm-paneel.js        |  46 +-
 test/analyse.test.mjs        | 266 +++++-
 tools/README.md              |   6 +
 tools/headless/vorm-maat.mjs | 244 +++++  (nieuw)
```

NIET aangeraakt: `src/vormen/*`, `src/video/lagen.js` (ander spoor), `kijk.mjs` (om botsingen met het
16:9-spoor te vermijden staat de headless-proef in een eigen script), CLAUDE.md, HANDOFF, ROADMAP,
VRAGEN, beide mappings. Geen nieuwe actions: de twee bronnen zijn extra standen van de bestaande
`video.layer.react.source` (rondlopen), dus er kwam geen `define()` bij.

---

## Wat

Twee nieuwe route-bronnen voor de vormlagen, naast de vijf uit de master-analyse:

| id | scherm | wat |
|---|---|---|
| `maatklap` | klap (maat) | de klappen van de maatgever uit de offline onset-analyse (`deck.onsets`, `GET /api/library/<id>/onsets`) |
| `tel` | tel | de tel van de maatgever, dezelfde vorm als `video.pulse` (`pulsVorm` uit puls.js) |

`BRONNEN` = `laag, midden, hoog, onset, rms, maatklap, tel` (in die volgorde rondlopen met
`video.layer.react.source` / APC in het mapje vorm). Daarnaast `MIX_BRONNEN` en `MAAT_BRONNEN`.

## Hoe

### `src/analysis/maat.js` (nieuw, puur)
- **Maatgever** = `klokTrack` uit `src/video/puls.js`: speelt, heeft een grid, hardst te zien/horen
  (fader × crossfader via `zichtbaarheid`). Precies dezelfde keuze als de video-puls, zodat vorm en
  video op dezelfde tel slaan. `engineTracks(engine, ids)` bouwt de invoer uit de engine (duck-typed,
  importeert de engine niet).
- **Hoorbaar** = `deck.position − vertraging × rate` (zoals video-puls, LED-fase, `hoorbaar()` in
  actions.js). Positie komt van `bron.positie` → audioklok (regel 3). De vertraging is
  `outputLatency + baseLatency`, dezelfde die de mixer van `ctx.currentTime` aftrekt voor `t`.
- **Klap-vorm** (`klapVorm`, `klapOmhullende`): 0 tot `KLAP_OP` = 12 ms vóór de klap, dan recht
  omhoog naar 1 PRECIES op de klap, daarna `exp(−d/KLAP_TAU)` met τ = 0,1 s (zoals de live-klap).
  Omdat de klappen vooraf bekend zijn ligt de opkomst vóór de klap: de piek valt op wat je hoort, niet
  een beeld later. Afstanden gaan in KLOKtijd (tracktijd ÷ rate): op 1,25× dooft een klap in 0,1 s
  echte tijd. Binair zoeken (een uur ≈ 18.000 klappen); max van laatste klap (uitdovend) en volgende
  (opkomend). De ijking van 68,5 ms zit al in de tijden van de server (`PIEK_GEIJKT` in analyze.js);
  de client verschuift niets.
- **Tel** (`telPuls`): `pulsVorm(beatAt − floor)`, identiek aan `grid.phase` + `pulsVorm` van de
  video-puls; geeft ook de lengte van DEZE tel (timeOf(n+1) − timeOf(n)), zodat het uitdoven met een
  tempokaart (overgangstellen) klopt.
- **`MaatLezer.lees(t)`**: één keer per beeld, dezelfde t twee keer = zelfde object (twee lagen).
  Terug in de tijd of > 1 s niets: opnieuw beginnen (zoals `Kenmerken`). Geen timer, geen eigen klok.
- **Geen sprong die schokt** — drie regels:
  1. De uitvoer zakt nooit sneller dan de puls zelf uitdooft: `max(nieuw, vorige · exp(−dt/τ))` met
     τ = 0,1 s voor de klap en de ECHTE uitdooftijd van de tel (tellengte / (5 · rate)). In rust is
     dat precies de vorm zelf (30/60/120 fps geven dezelfde waarden, 1e-16); valt de maatgever weg,
     stopt hij of springt hij, dan sterft de staart uit in plaats van naar 0 te vallen.
  2. Neemt een ANDERE track die al speelde de maat over, dan tellen alleen klappen/tellen vanaf de
     hoorbare positie van het vorige beeld. Zonder die regel sprong het beeld naar het midden van een
     klap die net op de nieuwe track viel (test: 0,04 → 0,43 zonder regel, headless 0,08 → 0,74).
  3. Begint de nieuwe maatgever net te spelen (speelde vorig beeld niet), dan telt alles: anders viel
     de eerste tel na play weg als de vertraging kleiner is dan een beeld.
  Een wissel is ook: de klappen of het grid van de maatgever veranderen van object (klappen komen na
  het laden binnen, `haalOnsets`). Een sprong OMHOOG binnen dezelfde track (loop rond, hotcue op de
  tel) mag wel: die klap hoor je ook.
- `NUL = 1e-4`: wat daaronder zakt wordt 0. Anders dooft een staart eindeloos uit en stuurt
  `zetModulatie` elk beeld een parameterbericht naar de Worker. Een tel komt nooit zo laag
  (minimum exp(−5) = 0,007), een klap na ~0,9 s.
- Zonder maatgever, grid of klappen: 0, geen fout (ook zonder `tracks`-functie).

### `src/analysis/router.js`
- `MIX_BRONNEN`, `MAAT_BRONNEN`, `BRONNEN` (7), `BRON_NAAM` (+ 'klap (maat)', 'tel').
- `router.nodig()` → Set van bronnen met een open sterkte.
- `leesKenmerken(t, nodig, { mix, maat })`: leest ALLEEN de lezer die nodig is (alleen `tel` open =
  de master-analyser wordt niet gelezen; alleen `laag` = de maatlezer niet); voegt samen; null als
  niets. Een route blijft een OFFSET via `zetModulatie` (pasToe ongewijzigd), nooit actions/zetKnop.

### `src/ui/vorm-paneel.js`
- De haak in `laag.frame` gebruikt `router.nodig()` + `leesKenmerken` (was: `actief()` +
  `luisteraar.lees`). Alle sterktes dicht = niets gelezen, één laatste `pasToe(null)` zoals voorheen.
- `MaatLezer` met `engineTracks(engine, videoMixer.decks)` en de vertraging van de mixer.
- Bronkeuze in twee `<optgroup>`s: "de zaal (master)" en "de maatgever". Bij een maatbron een klein
  label (11 px) ernaast: `maat 2`, `maat 2 · geen klappen` (los bestand/demo) of `geen maat`; bijgewerkt
  bij elke routewissel en op de bestaande 500 ms-weergavetimer (alleen weergave; `maat.kies()` verandert
  geen toestand).
- Alleen met `?vormen=1`: alles zit achter vorm-paneel.js (pas geïmporteerd met de vlag).

### Label en uitleg
- actions.js: label van `video.layer.react.source` noemt de zeven bronnen.
- apc-beschrijf.js: uitleg react.source: "wat de zaal hoort: laag · midden · hoog · klap · luid; dan
  de maatgever (…): zijn klappen uit de analyse van het nummer · zijn tel".

---

## Tests

### Node — `test/analyse.test.mjs` (103 ok, was 58)
Nieuwe blokken "de maat: …" en "de router: alleen uitlezen wat nodig is", plus:
- klapVorm/omhullende: opkomst vóór de klap, piek op de klap, rate 2 in kloktijd, null/NaN = 0.
- **30/60/120 fps op een nep-klok** (V = 40 ms): klap én tel op hetzelfde moment even hoog (max
  verschil 1,7e-16); elke klap op elke fps te zien (eerste beeld erna ≥ exp(−(1/fps)/τ)); uitdoven.
- **tel = video-puls**: `pulsVorm(grid.phase(positie − V·rate))` bij rate 1, rate 1,1 en een
  tempokaart 120 → 150 bpm met overgangstel (30 = 120 fps).
- **rate 1,25**: piek op het moment dat je hem hoort (c = 2,05/1,25), uitdoven exp(−1) na 0,1 s echt.
- **geen maatgever**: geen tracks, geen tracks-functie, stil, fader dicht, geen grid → 0; zonder
  klappen tel wel; dezelfde t = hetzelfde object.
- maatgever **stopt midden in een klap**: staart dooft uit (0,82 → 0,67), na 1,2 s PRECIES 0.
- **wisselende maatgever** A → B → A → B (A op de tel, B een halve tel later): geen sprong omhoog bij
  een wissel midden in een klap van de nieuwe (zonder de regel 0,43 en 0,85), geen val bij een wissel
  vlak na een klap van de oude, daarna komen klap en tel van de nieuwe door; over 360 beelden nergens
  omhoog zonder klap of tel van de maatgever.
- **play op de tel** (vertraging 0): de eerste tel/klap wordt niet weggefilterd (0,92).
- **klappen die later binnenkomen**: geen sprong naar een klap van 70 ms geleden.
- **loop rond**: de klap op het loopbegin komt door (0,01 → 0,90).
- router: `nodig()`, `leesKenmerken` leest alleen wat nodig is (tellers op nep-lezers), zonder
  analyser werkt de maat; rondlopen over 7; `tel` als route = offset 0,8 × 0,5 op een echte
  VormLaag, knop blijft staan; action-bus loopt door naar `tel`; uitleg noemt maatgever/klappen/tel;
  regelcheck: maat.js geen DOM/timer/Math.random/performance.now, importeert alleen lib/emitter,
  video/puls, video/volg.

**Mutatieproeven** (scratchpad/mutaties.sh, maat.js telkens teruggezet): vaste τ voor de tel,
geen staart, altijd overname, nooit overname, geen vertraging, vertraging zonder rate, uitdoven in
tracktijd — elke mutatie laat 2–7 checks falen.

### Headless
- `kijk.mjs` (poorten 8877/9477): **alles groen**, ook het bestaande "reageren op de mix"-blok (de
  eerste vijf bronnen staan in dezelfde volgorde).
- Nieuw `tools/headless/vorm-maat.mjs` (8877/9477): **23/23 groen**. Twee demotracks (grid + klappen
  met de hand, want de demo komt niet uit de library): optgroups, zes keer bron → tel, "maat 1",
  de haak in `laag.frame` geeft offset = tel × sterkte (afwijking 6e-17) en de knop blijft staan,
  6 tellen en 6 klappen in 3 s op 124 bpm, nergens omhoog zonder klap/tel, crossfader naar B midden
  in een klap van B (25–75 ms erna): geen sprong (0,08 → 0,07, zonder regel 0,74), MAAT-badge
  (syncMaster) is het eens, "maat 2", "maat 2 · geen klappen", "geen maat", alles stil = offset 0,
  geen fouten.
  Let op: de animatielus haalt headless (swiftshader, drukke machine) maar ~1 beeld per paar seconden,
  dus het script roept `laag.frame(t)` (mét de haak van het paneel) zelf aan op ~60 Hz.

### Volledige suite
`nice -n 10 node test/alles.mjs`: 29 bestanden, 1968 checks, **1 rood door timing**:
`vormen-meer.test.mjs` "if: max < 16 ms per stap bij kwaliteit 1" (ander spoor, vormsysteem, niet
aangeraakt). Los opnieuw gedraaid: **groen**.

---

## Wat NIET getest is
- Niet in Clay's eigen Chrome en niet met zijn library: echte `onsets` van de server, echte
  `outputLatency` (headless is die ~0), een lang album met tempokaart. Of de klap-puls op het oog op de
  bas/kick valt, en of 12 ms opkomst vóór de klap goed voelt, is niet bekeken.
- Het getekende beeld zelf (headless te traag voor een beeldreeks); alleen de offsets op `laag.mod`.
- Hoeveel parameterberichten per beeld naar de Worker gaan met twee lagen op een maatbron (één per
  beeld per gemoduleerde knop, zoals bij de mix-bronnen) — niet gemeten.
- Sync (fasecorrectie = sprong binnen dezelfde track), hotcue tijdens spelen, bend: alleen via de
  algemene regels (staart / omhoog mag), niet apart getest.
- De APC: niet aangesloten (headless zonder MIDI). react.source op de APC is dezelfde action als
  voorheen.

## Aannames (kunnen verkeerd zijn)
1. **Maatgever = `klokTrack` (video-puls), niet `engine.syncMaster()` (MAAT-badge).** Ze verschillen
   in randgevallen: syncMaster valt terug op een stilstaande track (voor ons toch 0) en neemt een
   spelende track met fader dicht; klokTrack niet (je hoort hem niet). Dan kan de badge "MAAT" bij een
   track zetten terwijl het vorm-paneel "geen maat" zegt. Gekozen omdat de opdracht "zoals video.pulse"
   zegt en vorm en video dan op dezelfde tel slaan.
2. De klap: 12 ms opkomst vóór de klap (≈ de ±15 ms onzekerheid van de onsets), τ 0,1 s zoals de
   live-klap. Getallen niet op het oog afgesteld.
3. Overname-regel: bij een wissel naar een track die al speelde tellen klappen/tellen vanaf het vorige
   beeld (een klap in dat laatste beeld verschijnt zoals elke klap: één beeld later, nog bijna vol).
   Snel heen-en-weer wisselen (crossfader precies in het midden) kan zo een klap missen.
4. Sprongen omhoog binnen dezelfde track (loop rond, hotcue op de tel) zijn gewenst; alleen omlaag
   wordt afgevangen.
5. De bron-id's zijn `maatklap` en `tel` (sessietoestand, nergens bewaard, dus later te hernoemen).
6. Weergave "maat N" gebruikt `videoMixer.decks.indexOf(id) + 1` als tracknummer (decks = DECK_IDS).

## Opmerkingen
- De formule "positie − vertraging × rate" staat nu op een vierde plek (actions.js `hoorbaar`,
  video-mixer `_pulsNu`/`_volg`, maat.js). `docs/plugins/01-plan.md` stap 2 noemt een `hoorbaar.js`
  die de kopieën vervangt; dat is niet gedaan (niet gevraagd).
- `metPuls` zelf (video.pulse) is niet omgezet naar een route; de tel is een route-BRON met dezelfde
  vorm, zoals gevraagd.
- Botsingen met het 16:9-spoor verwacht ik niet: geen gedeelde bestanden (vorm-paneel.js raakt
  laag.js niet; analyse.test gebruikt `new VormLaag({ systeem: 'bd' })` zoals de bestaande test).

---

## Voorstel CLAUDE.md-tekst

In **Structuur**, onder `analysis/` na `router.js`:
```
                    maat.js         klappen (deck.onsets) en tel van de maatgever als bron, op wat je hoort. Puur.
```
en onder `tools/`: `headless/kijk.mjs` → `headless/kijk.mjs, vorm-maat.mjs (headless zonder MIDI)`;
bij `test/analyse.test.mjs`: `…, maatbronnen op 30/60/120 fps en bij een wisselende maatgever, …`.

In **VORMLAGEN**, de laatste zin "Nog niet: onset.bin (offline), metPuls als route." vervangen door:

```
  - DE MAAT ALS BRON (25 sep, ROADMAP 23): naast de vijf master-bronnen `maatklap`
    (de klappen uit de offline onset-analyse, deck.onsets) en `tel` (pulsVorm, als
    video.pulse), in `src/analysis/maat.js`. Maatgever = klokTrack (dezelfde als de
    video-puls; NIET syncMaster: die neemt ook een track met fader dicht). Hoorbaar =
    positie − vertraging × rate; uitdoven in KLOKtijd. De klap loopt 12 ms VÓÓR de klap
    op tot 1 op de klap (ze zijn vooraf bekend), τ 0,1 s; de ijking (68,5 ms) zit al in
    de servertijden. Geen sprong: de uitvoer zakt nooit sneller dan de puls uitdooft
    (max(nieuw, vorige·exp(−dt/τ)), τ van de tel = tellengte/(5·rate)); neemt een track
    die AL SPEELDE de maat over, dan telt alleen wat sinds het vorige beeld komt; een
    track die net start telt alles; nieuwe klappen of grid = wissel. Omhoog binnen
    dezelfde track (loop rond, hotcue) mag. Onder 1e-4 = 0 (anders elk beeld een
    parameterbericht). `router.nodig()` + `leesKenmerken()`: alleen de lezer die een
    open route nodig heeft wordt gelezen. Het paneel toont "maat N", "· geen klappen"
    of "geen maat". Headless: tools/headless/vorm-maat.mjs.
    Nog niet: metPuls (video.pulse) zelf als route; één `hoorbaar.js` (01-plan).
```
