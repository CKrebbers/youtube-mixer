# VarveDJ v2 — architectuur

Bron van waarheid voor hoe v2 in elkaar zit. Het ontwerp (wat het moet doen) staat in
`v2/ontwerp/*.json`; dit bestand zegt hoe de code dat waarmaakt. Clay's woorden in `v2/WENSEN.md`
gaan voor alles.

## Uitgangspunten

1. **Eén maatklok.** Alles wat op de maat loopt leest de klok (`src/kern/klok.js`). Niemand rekent
   zelf een tel uit. De klok loopt door tot klokbediening hem verandert (ontwerp klok-B02).
2. **Positie komt van de audioklok.** Nooit een eigen teller of `setInterval` voor tijd. Een timer
   zegt alleen WANNEER er gepland wordt, nooit WAT de tijd is.
3. **Lagen met een vaste richting.** `kern/` (puur rekenwerk, geen Web Audio, geen DOM) ←
   `audio/` (Web Audio, geen DOM) ← `engine/` (lijm, geen DOM) ← `ui/` (DOM). Nooit omgekeerd.
   `test/regels.test.mjs` controleert dat.
4. **Alles via de bus.** Elke handeling is een actie op `src/kern/bus.js`, met zijn aard in de
   definitie (meta), niet in losse lijsten. Waarden zijn 0..1, triggers een boolean. De engine
   schaalt naar dB, Hz en bpm.
5. **Scenario's zijn tests.** Elk scenario uit `v2/ontwerp/*.json` heeft een test in `test/` met
   het id in de naam (`klok-S03`). Een scenario zonder test is niet af.
6. **Het audiopad maakt geen afval.** In de worklet en in `renderBlok`: niets aanmaken per blok.
   Tussenresultaten in vooraf gemaakte buffers.
7. **Nul afhankelijkheden in de app.** Plain ES-modules, geen bundler. Tests met `node --test`.
   Headless met Playwright (staat globaal op de machine, niet in de app).

## Structuur

```
v2/app/
  index.html            de mixer
  beeld.html            het losse beeldvenster (de beamer): mengt zelf, leest de stand van de mixer
  server.mjs            statisch (no-store, COOP/COEP) + /api/library (+ /audio, /stems, /peaks, /video) uit de
                        v1-library (alleen lezen) + /api/v2/* (eigen data: nummers, instellingen, opnames, log)
  server/data.mjs       de eigen data in VARVE_V2_DATA (standaard ~/.varve/v2)
  indelingen/           apc40mk2.json, toetsen.json: wat elke knop doet (data)
  racks/                sjablonen.json: kant-en-klare effect-racks (data)
  src/
    kern/               puur: geen DOM, geen Web Audio, geen eigen klok of toeval
      klok.js           de maatklok: gebroken lijn {T, C, R}, tel/tijd, glijden zonder sprong
      grid.js           het beatgrid (tempokaart) — overgenomen uit v1 src/engine/beatgrid.js
      koppeling.js      klok-tel + verschuiving -> plek in het nummer, als segmenten {T, P, R}
      bus.js            acties met meta en trackparameter ({n} = 1..8)
      herhaal.js        een POST herhalen zolang de server weg is (uit v1)
      patronen/         model.js (de set als lijst), venster.js (384 PPQN, swing, micro)
      smf.js, patronen-smf.js   patronen als MIDI-bestand (byte voor byte v1)
    audio/              Web Audio, geen DOM
      speler-kern.js    rekenkern van de afspeler (puur, in Node te testen): pagina's, segmenten, lus, stems
      speler-worklet.js de AudioWorklet eromheen (vier stereo-uitgangen)
      speler.js         de node-kant: laden, streamen, segmenten plannen, een gain per stem
      stroom.js         welke pagina's nodig zijn (uit het plan) en het ophalen
      overgang.js       hellingen op een AudioParam — overgenomen uit v1
      strip.js          de kanaalstrip van één track (insert-slot, sends, cue vóór de fader)
      mixer.js          crossfader, master, limiter, meter, send-bussen
      koptelefoon.js    zaal op 1/2, koptelefoon op 3/4 van één context
      fx/               effecten, racks, modulators, sends (uit v1)
      instrumenten/     poly, fm, drums, klankschaal (schaal); aansluiting.js = op de strip
      opnemer.js        de master opnemen (SharedArrayBuffer-ring)
      sampler-uitgang.js  de acht pads naar de master
    engine/             lijm: geen DOM, geen Web Audio-nodes
      engine.js         klok + acht tracks + mixer + bus + sampler + patronen + log
      track.js          één track: nummer óf instrument, transport, lus, hotcues, stems, koppeling -> speler
      acties*.js        alles op de bus (transport, strip, fx, patronen, auto)
      sampler.js        acht pads als lus op de klok
      patronen.js       de patronenspeler op de klok
      log.js            het handelingenlog
    control/            controllers: leest alleen kern/ (MIDI en lock komen van buiten)
    auto/               de auto-DJ: een bron van acties (leest de engine, schrijft via de bus)
    beeld/              video per track, vormlagen, het losse venster (leest de engine)
    koppel/             de Stroommachine: klok, kenmerken en tracks naar de relay (leest de engine)
    ui/                 DOM: app.js zet alles op
  test/                 node --test; *.test.mjs
  tools/                headless proeven (Playwright), één per plak
```

## Contracten

### Klok (`kern/klok.js`)
```
klok.loopt                       // false tot de eerste start (klok-B05)
klok.start(T, C, R)              // één lijn: op T tel C, R tellen per seconde
klok.tel(t) / klok.tijd(c)       // audiokloktijd <-> klok-tel (doorlopend, niet modulo)
klok.rate(t)                     // tellen per seconde
klok.bpm(t)                      // rate × 60
klok.perMaat                     // 4; de "1" ligt op tel 0, 4, 8, …
klok.volgendeEen(t)              // eerste maatbegin na t
klok.houd(A, R)                  // vanaf A een ander tempo (nieuw stuk lijn, geen sprong)
klok.richt(A, a, L)              // glijden naar een doellijn (uit v1 patronen/klok.js)
klok.on('verander', fn)          // na elke wijziging van de lijn
```

### Koppeling (`kern/koppeling.js`)
Een gekoppeld nummer: tel van het nummer = `klok.tel(t) + v`, plek = `grid.timeOf(tel)`.
```
segmenten(klok, grid, v, van, tot) -> [{ T, P, R }]   // stuksgewijs recht, op de grenzen van klok én grid
verschuivingBijKoppelen(klok, grid, t, P) -> v        // dichtstbijzijnde tel: sprong ≤ ½ tel (klok-B07)
verschuivingUitPlek(klok, grid, t, P) -> v            // na bend/jog: de plek van nu is de waarheid
```

### Speler (`audio/speler.js`, `speler-kern.js`, `speler-worklet.js`)
De afspeelmotor van één track. Weet niets van grid, klok of muziek: alleen segmenten.
```
const s = await Speler.maak(ctx)        // laadt de worklet hooguit één keer per context
s.node                                  // AudioWorkletNode, 1 uitgang, 2 kanalen
s.laad({ sr, kanalen, frames, paginas }) // paginas: Int16Array's van PAGINA frames, interleaved stereo
s.laad({ sr, kanalen, frames, stroom })  // of STREAMEN: stroom.lees(i, signaal) -> Int16Array (audio/stroom.js)
s.bijvullen(pins)                       // streamen bijhouden (de engine doet het bij elke tik, pins = [cue])
s.plan(segmenten)                       // [{ T, P, R, speelt }]: vervangt alles vanaf segmenten[0].T
s.leeg()                                // stil, bron weg
s.vernietig()                           // 'stop' naar de worklet, dan los
```
Segment `{ T, P, R, speelt }`: vanaf audiokloktijd T staat de plek op P seconden in het nummer en
loopt hij R seconden nummer per seconde audioklok. `speelt: false` = stil. Een segment met een
sprong in P vloeit 10 ms over (equal-gain), start en stop 4 ms; een segment dat precies aansluit
(P = vorige plek op T) niet (gemeten in `meting/klik.mjs`, zie de kop van `speler-kern.js`).
Een nummer uit de library STREAMT (`audio/stroom.js`, budget M7): de pagina's die het plan nodig
heeft (30 s vooruit, één terug, het cuepunt vast) komen met Range-verzoeken; een pagina die er nog
niet is, is stilte. Demonummers en de tests laden alles in één keer.

### Strip en mixer (`audio/strip.js`, `audio/mixer.js`)
```
const m = maakMixer(ctx)                // master: gain -> limiter -> analyser -> ctx.destination
m.zet('xfader' | 'master', v01)
const st = maakStrip(ctx, m)            // in -> trim -> eq(laag, mid, hoog) -> filter -> fader -> kant -> mixer
st.in                                   // AudioNode: hier sluit de speler (of een instrument) op aan
st.zet('trim' | 'laag' | 'mid' | 'hoog' | 'filter' | 'fader', v01)
st.kill('laag' | 'mid' | 'hoog', aan)
st.kant('A' | 'B' | 'thru')
st.lees(naam)                           // terug als 0..1
st.vernietig()
```
Alle overgangen klikvrij via `overgang.js` (hellingen na startDrempel, nooit `setValueCurveAtTime`).
Filters in een terugkoppellus krijgen een negatieve Q.

### Bus (`kern/bus.js`)
```
bus.defineer({ id: 'track.{n}.filter', soort: 'waarde' | 'trigger', meta, doe(v, n), lees(n) })
bus.doe('track.3.filter', 0.7)          // waarde 0..1, trigger true/false
bus.lees('track.3.filter')
bus.on('actie', ({ id, v, bron }) => …)  // voor het log
```
`meta`: `log: 'overslaan'`, `beginstand: false`, `nummer: true` (hoort bij het nummer), `gevaarlijk: true`.

## Plak 1 — "de klok speelt"
Klok, koppeling, bus, speler, strip en mixer; acht tracks met een nummer (uit de v1-library of een
demonummer); sync aan/uit, jog, nudge, pitchfader = klok-tempo (alleen hoorbaar), tempoknop van de
klok, Shift + Sync = klok naar dit nummer, starten op de maat. Scenario's klok-S01 … klok-S21 als
tests. Nog niet: sends, cue, stems, effecten, sampler, instrumenten, MIDI.

## Plak 2 — het DJ-instrument

- **Lus** (`speler-kern.js`, `track.js`):
  - Een segment mag `la`/`lb` hebben (seconden). De kern vouwt terug en vloeit de laatste 10 ms
    (`LOOP_NAAD`) lineair over naar wat vlak vóór `la` staat.
  - Op de track ligt een lus in tellen, vanaf de tel onder de plek, binnen één stuk van de
    tempokaart.
  - Gekoppeld rekent de motor in de tellengte van de lus.
  - Lus uit = hele lussen terug in de verschuiving: geen sprong, de fase blijft.
  - Sprong buiten de lus = lus eraf; beatjump in een lus = de lus schuift mee.
- **Hotcues en cue** horen bij het nummer. De engine meldt `hotcue` en `cue`, de app bewaart ze op
  `/api/v2/nummer/<id>`, en ze komen terug bij het laden. Cue en hotcues staan vast in de
  pagina-cache.
- **Log** (`engine/log.js`):
  - Altijd aan zodra de context loopt.
  - Eerst een beginstand, dan `[t, id, v, {bron}]` op de audioklok, en laden als regel.
  - ASCII; per seconde een stuk op zijn byte.
- **Opname** (`audio/opnemer.js`):
  - Tapt de master ná de limiter via een SharedArrayBuffer-ring, zodat de audiothread geen afval
    maakt.
  - Elk stuk gaat op zijn frame; een gat is stilte.
  - De opname krijgt de id van het log en zet een regel `{ opname, vanaf }` in het log.
- **Schrijven** (`ui/schrijver.js`): opnieuw proberen zolang de server weg is (`kern/herhaal.js`,
  uit v1), met een begrensde rij en één melding.
- **Eigen data** (`server/data.mjs`):
  - Staat in `VARVE_V2_DATA`, standaard `~/.varve/v2`: `nummers/`, `opnames/` en `instellingen/`.
  - Een proefserver schrijft altijd in een tijdelijke map.
- **Effecten** (`audio/fx/`, `engine/acties-fx.js`): een insert-slot per strip ná het filter en vóór
  de fader, lui (pas een keten als de mix open gaat: zonder effect bit voor bit plak 1, gouden hash).
  Racks als data, acht knoppen + mix, wisselen met een kruisfade. Twee sends (A echo, B galm) na de
  fader en vóór de kant, naar gedeelde bussen op de master; de echo op de maatklok.
- **Koptelefoon** (`audio/koptelefoon.js`): alleen met een uitgang van vier kanalen (Mac: een
  samengesteld apparaat), anders bestaat hij niet en is de master bit voor bit dezelfde. Zaal 1/2,
  koptelefoon 3/4 (omwisselen na herladen). De cue tapt vóór de fader, ook de natte weg van het
  effect, en loopt even laat als de zaal (de vooruitblik van de limiter). `track.{n}.pfl`,
  `koptelefoon.volume`, `koptelefoon.mix` — niet in het log.
- **Library** (`ui/library-lijst.js` puur, `ui/library.js` scherm):
  - Een virtuele lijst, met sorteren en zoeken zonder accenten.
  - `library.volgende/.vorige/.laad` op de bus; laden gaat naar de focus-track, met de tweede druk
    over een spelende track.
  - Streamen van audio en het overzicht uit v1's `peaks.bin`.

## Plak 3 — controllers (`src/control/`, `ui/controllers.js`, `indelingen/*.json`)

- **Laag:** `control/` leest alleen `kern/`. MIDI, de Web Lock en het venster komen van buiten
  (`ui/controllers.js`).
- **Een indeling is data:** `{ schema: 1, naam, apparaat, regels: [{ control, actie, gedrag, shift?, laag?, led? }] }`.
  - Het gedrag is `absoluut` (soft-takeover), `eindeloos` (alleen het verschil), `trigger` of
    `schakelaar`.
  - Een actie mag `{k}` (kolom) en `{focus}` bevatten.
  - Eerst de laag, dan shift daarbinnen.
  - Loslaten gaat altijd naar de actie van het indrukken.
- **Per nummer:** `ctl.kiesVoorNummer(id)` bij elke focuswissel en elke laad op de focus-track.
  Geleerde indelingen en de koppeling per nummer staan in `instellingen/`.
- **Lampjes** lezen de bus volgens de actieve indeling, met diffing:
  - `null` = uit, 0 = leeg, gevuld = de donkere kleur, 1 = aan;
  - knipperen op de tel van de klok zoals je hem hoort (`klok.fase`);
  - wachtrij van 16 berichten per 4 ms.

## Plak 4 — beeld (`src/beeld/`, `beeld.html`)

- **Video is slaaf van wat je hoort:** het doel is `plek(nu − V)` van de track, op zijn snelheid;
  zichtbaar = `engine.zaalVersterking(n)` (fader × kant): een track die niet speelt is zwart.
- **De stand is één object** (`stand.js`): effecten, mengvorm, puls, noodknoppen, vormen. Het losse
  venster leest datzelfde object en mengt zelf (eigen `<video>`'s en rAF), zodat de beamer doorloopt
  met het hoofdtabblad op de achtergrond.
- **Puls op de maatklok**: de tel komt van `klok.tel(nu − vertraging)`, niet van een "maatgever".
- **Vormlagen**: de 26 systemen uit v1, elk in een Worker, rekenen pas als ze aan staan.
- **Laag:** beeld/ leest kern/ en de engine duck-typed; niemand importeert uit beeld/.
- De server zegt per nummer of er video is (`video` in /api/library), de pagina vraagt dan pas
  `/api/library/<id>/video` op (een open Range hooguit 2 MB, zoals v1).

## Plak 5 — produceren op de klok

- **Een track draagt een nummer óf een instrument** (`audio/instrumenten/`: poly, fm, drums,
  klankschaal). Het instrument sluit via een eigen gain aan op de strip: EQ, effect, fader, sends en
  cue werken vanzelf. Weghalen: aansluiting dicht langs de zachte S, dan pas `vernietig()`.
- **De klankschaal** speelt op de toonsoort van wat je hoort (`engine.hoorbareToon()`: het luidste
  nummer met een toonsoort, + 1200·log2(R) cent zonder keylock).
- **Noten gaan niet over de bus** (`control/noten.js` → `engine.noot`) naar de speeltrack.
- **De sampler** (`engine/sampler.js`): acht pads, elk een kleine speler met DEZELFDE afspeelmotor,
  als lus op de maatklok; knippen in tellen van wat je hoort (met stems: gemengd zoals je ze hoort).
- **Patronen** (`engine/patronen.js`, `kern/patronen/`): een tick is `klok.tel × 384`; de timer zegt
  alleen wanneer er gepland wordt (120 ms vooruit), elke noot gaat met zijn tijd op de audioklok
  naar het instrument. De set is een LIJST patronen op (track, plek); de speler leest bij elke tik
  wat er nu staat, dus bewerken klinkt meteen. Starten, wisselen en stoppen op de eerste "1" na wat
  al gepland is. Een stap schrijft de laatst gespeelde noot. De set staat in `instellingen/patronen`.
- **APC**: scene 5 = patronen (per kolom de vijf plekken), Stop All Clips = alles stoppen.

## Plak 6 — stems, auto-DJ en de koppelingen

- **Stems** (vooraf door Demucs in v1, `stems.wav` = 2 of 4 stereoparen):
  - De afspeelkern leest 4 of 8 kanalen in een eigen functie (`stemBlokMeer`): dezelfde lijn, lus,
    naad en gaten; elk paar is bit voor bit een stereobron met dezelfde samples. Stereo blijft door
    het oude pad (gouden hash gelijk).
  - De worklet heeft altijd vier stereo-uitgangen; de speler een gain per uitgang (kill = 0 langs de
    zachte S in 5 ms, niveau als knop), opgeteld naar `speler.uitgang`.
  - Versterking per stem (v1): `(1/schaal) × niveau × kill × (vier en niet zang ? niveau(rest) × kill(rest) : 1)`.
    Bij elke laad alles open: stems horen bij het nummer.
  - Kosten: acht decks met vier stems ~6% van een kern in de kern (stereo 3%).
  - Acties `track.{n}.stem.<zang|rest|drums|bas|overig>` (niveau), `.kill`, `.kill.hold`; APC
    scene 4; de sectie STEMS in het trackpaneel.
- **Auto-DJ** (`src/auto/`): een bron van acties op de bus met bron 'auto' (dus in het log), de
  bewakers van v1 (blend alleen met twee zekere grids, tempo ≤ 6%, toon ≤ 1 stap ná de sync),
  overgangen in tellen van de maatklok, de nieuwe op de "1" via `play.quant`, de bas wisselt in het
  midden, Clay wint altijd (CLAY_RECENT 120 s), nooit stilte.

