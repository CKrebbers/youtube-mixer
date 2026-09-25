# Spoor C, TRANSPORT: beatjump, loop in/out, quantize en starten op de maat

Branch `spoor2/dj-transport`, 5 commits bovenop `cc527e3`. De worktree staat aan het eind los (detached).

```
a937548 Loop out: lampje uit zolang er geen loop in klaarstaat (B4: niets te doen)
6289c79 Toetsen en uitleg voor beatjump, loop in/out, quantize en starten op de maat
aaa579e Transport: beatjump, loop in/out/reloop, quantize en starten op de maat
f9c25d2 Bron en worklet: gepland starten op de audioklok, loop en start in één keer
c7bae44 Beatgrid: rekenwerk voor beatjump, fasebehoudend springen en maatbegin
```

`node test/alles.mjs`: 29 bestanden, 2049 checks, groen. Dat zijn er 126 meer dan de 1923 van de
overdracht. Na de laatste commit zijn engine, feedback, mapping en spiegel nog een keer gedraaid,
ook groen; engine heeft er daarmee één check bij. `tools/headless/kijk.mjs` is groen op eigen
poorten (8867/9467). Een eigen headless-proef liet starten op de maat door de echte worklet lopen:
ook groen (zie Tests).

## Wat er gebouwd is

### 1. Beatjump
- `deck.beatjump(richting, tellen = deck.sprongTellen)`. Mogelijke lengtes: `SPRONG_TELLEN = [1, 2, 4, 8, 16, 32]`, standaard 4, per track.
- De sprong rekent in TELLEN: `Beatgrid.verschuif(t, n) = timeOf(beatAt(t) + n)`. De fase binnen de tel blijft dus exact gelijk, ook over een stukgrens van de tempokaart. Nergens wordt `grid.bpm` gebruikt.
- **In een loop schuift de loop mee**, zoals in Traktor, rekordbox en Serato. Begin, einde en speelkop schuiven elk n tellen, dus de speelkop houdt zijn plek in de loop. `loopBeats` blijft kloppen, want begin en einde schuiven evenveel tellen. Over een stukgrens verandert de lengte in seconden, maar het aantal tellen niet.
- Weigert in drie gevallen, telkens met een melding via de action:
  - zonder grid;
  - als het stuk bij de speelkop, bij het doel of bij de verschoven loop onzeker is en het grid niet op slot staat. De melding is dezelfde `ONZEKER` als bij beat-loops;
  - als een verschoven loop buiten het nummer zou vallen.
- Zonder loop wordt voorbij begin of einde geklemd, zoals op een CDJ. Daar houdt de fase dus op.
- Een sprong met een loop zet loop en positie in één keer (`deck._spring` → `bron.start(p, { loop })`). De streamkern krijgt daardoor één segment en niet twee vlak na elkaar met een tussenstand. Zo blijft de sprong klikvrij via de gewone segmentovergang.

### 2. Loop in / loop out / reloop
- `deck.loopIn()` zet het begin (`loopInPunt`), met quantize op de dichtstbijzijnde tel. Er klinkt nog niets. Nog een keer drukken zet een nieuw begin.
- `deck.loopOut()` zet het einde op de positie, en de loop gaat meteen aan.
  - Met quantize op een zeker grid wordt het een heel aantal tellen, minstens één. `loopBeats` wordt dan gezet, dus het lampje van "loop 4" brandt en halveren/verdubbelen rekent in tellen.
  - Staat de speelkop meer dan een halve tel vóór het in-punt, dan gebeurt er niets en blijft het in-punt wachten.
  - Een loop in/out vervangt een lopende loop van welke soort ook.
  - Geklemd op het trackeinde: geen `loopBeats`, zoals bij de andere loops.
- `deck.reloop()` werkt als reloop/exit op een CDJ:
  - Loopt er een loop, dan gaat die eraf.
  - Anders komt de laatste loop terug en springt de speelkop naar zijn begin. Met quantize gebeurt dat fasebehoudend, teruggevouwen in de loop.
  - "De laatste loop" (`vorigeLoop`) wordt onthouden bij elke manier waarop een loop eraf gaat: `clearLoop`, `loop.exit`, `loop.toggle`, of een sprong buiten de loop (`_verlaatLoop`).
  - Een ander nummer laden wist `loopInPunt` en `vorigeLoop`.
- StreamBron: `loopInPunt` en `vorigeLoop.start` staan in de `vastpunten`. Zo is het begin er nog als de loop langer dan 5 s is. Bij loop out wrapt hij meteen naar het begin, en daar mag geen gat zitten.
- `stream-kern.js` en `LOOP_NAAD` zijn niet aangeraakt. Een loop in/out is gewoon een loop voor de kern, dus de naad werkt vanzelf.

### 3. Quantize (één schakelaar voor de hele engine)
- `engine.setQuantize(aan)` zet de vlag `deck.quantize` op alle acht decks. De action is `transport.quantize`.
- **Keuze: engine-breed, niet per track.**
  - Met acht tracks wil je niet per track onthouden of quantize aan stond.
  - Het kost op de APC één knop in plaats van acht.
  - rekordbox, Traktor en Serato doen het ook zo.
  - De blauwdruk had er één per deck, maar die denkt in twee decks.
- Aan betekent:
  - **Zetten** snapt naar de dichtstbijzijnde tel. Dat geldt voor hotcues, voor het cuepunt (pauze + cue, en de speelkop gaat mee, anders zette de volgende druk steeds een nieuwe cue in plaats van te spelen) en voor loop in/out.
  - **Springen naar een hotcue** is fasebehoudend en gebeurt meteen: `Beatgrid.metFaseVan(doel, positie)`. Een hotcue op de tel, ingedrukt op 0,3 van een tel, landt op 0,3 na de hotcue, hooguit een halve tel ervandaan. Zo doen Traktor en Mixxx het.
  - **Keuze:** niet wachten tot de volgende tel. Dat klinkt hetzelfde, maar reageert tot een tel trager en vraagt een geplande sprong terwijl hij speelt.
  - Stilstaand springt een hotcue precies naar de hotcue.
- Alleen op een ZEKER grid (of op slot). In een onzeker stuk komt de hotcue precies waar je drukt: een cue op een verkeerde tel is erger dan een cue een fractie naast de tel.
- Beatjump heeft geen quantize nodig: die springt al in hele tellen.

### 4. Starten op de maat (`track.N.play.quant`)
- `engine.startOpDeMaat(id, { tellen })`: het geluid begint op het volgende **MAATbegin** van de maatgever. Dat is `syncMaster(id)`, de track die je het hardst hoort, dezelfde als voor sync, sampler en sends.
- **Keuze: maat, niet tel.**
  - De blauwdruk zegt "start op volgende maat".
  - Het plan (`docs/plugins/01-plan.md`) zegt "een track die precies op de volgende maat invalt".
  - Ableton start op de APC ook op de volgende maat.
  - Wachten duurt hooguit één maat (2 s op 120 bpm).
  - `tellen: 1` geeft de volgende tel; dat zit in de engine, maar er is geen action voor.
- Het maatbegin is dat van het grid: tel 0 van het eerste stuk en elke `beatsPerBar`-de tel daarna, zoals de golfvorm het tekent (`Beatgrid.volgendeVeelvoud`).
- **Fase:** de tel van deze track die het dichtst bij het startpunt ligt, valt precies op het maatbegin. Een cue die 10 ms naast de klap staat (zonder quantize) begint 10 ms eerder of later, en de klap valt toch op de "1". Zonder zeker grid op deze track geldt het startpunt zelf als tel.
- **Regel 3:**
  - Het moment komt van `ctxTimeOf` van de maatgever. Dat klopt voor rate en tempokaart.
  - Staat de maatgever in een loop, dan wordt vanaf de volgende tel met tellen van gelijke lengte doorgeteld (via fxKlok). `ctxTimeOf` kent geen tel voorbij het loopeinde.
  - Ligt het maatbegin binnen `startDrempel` (de uitgangsbuffer), dan wordt het de maat erna. Dat is dezelfde regel als `startOpDeTel`.
  - Er is geen timer.
- Zonder spelende maatgever met grid start hij meteen. Heeft de maatgever daar een onzeker grid, dan ook meteen, met een info-melding.
- **Het wachten zelf** heet in de code "gepland starten" (bron.js):
  - `deck.play({ op })` → `bron.start(p, { op })`. De bron "speelt" al (`playing` = true, `wacht` = true), maar klinkt pas vanaf `op`, sample-exact.
    - BufferBron: via `src.start(op, p)` en een gain-envelop vanaf `op`.
    - StreamBron: via een segment met `T = op` en `gepland: true`.
  - Tot T staat de positie stil op het startpunt. Dat werkt net als bij een sampler-pad (`t <= T ? P`).
  - `ctxTimeOf` en `fxKlok` kloppen al vóór T, dus gate, sampler en sends zien de goede tel.
  - Pauze (gewone play of pauze) annuleert het wachten.
  - Deze wijzigingen houden het startmoment vast:
    - tempo, bend en loop (bron.setRate, setLoop en clearLoop kennen `wachtTot`);
    - een sprong: hotcue, beatjump en nudge. `deck.seek` plant opnieuw op hetzelfde moment.
  - `engine.sync` doet tijdens het wachten alleen het tempo; de fase komt van de start.
  - **Worklet (`stream-lezer.js`)**:
    - Bij `gepland` begint de overgang op T (`wisselT = max(nu, T)`), met als vorig segment STIL (of het klinkende segment). Vóór T is het dus stil.
    - Een gepland segment dat nog niet begonnen is, telt niet als "klinkend". Wordt het vervangen (pauze, of een ander startpunt), dan vloeit er niets uit, dus geen tikje.
    - `stream-kern.js` is NIET gewijzigd: `renderBlok` kon het al met `vorig` en `wisselT`.
- Lampjes en video tijdens het wachten:
  - `track.N.phase` = null en `track.N.beat` = 0 (niets knippert op een stilstaande track).
  - De video wacht ook: `video-mixer.js` `_volg` en `_pulsNu` gebruiken `deck.playing && !deck.wacht`. Anders liep het beeld weg en sprong het terug.

## Actions (allemaal eerst `define()` in actions.js)

| action | type | read (B4: null = niets te doen · 0 = bruikbaar · 0,5 = gevuld · 1 = actief) |
|---|---|---|
| `track.N.beatjump.back` / `.fwd` | trigger | null zonder track/grid of in een onzeker stuk · 1 zolang ingedrukt · 0 |
| `track.N.beatjump.halve` / `.double` | trigger | lengte als keuze: index / 5 (zoals `sampler.length`) |
| `track.N.loop.in` | trigger | null zonder track · 1 = in-punt wacht op out · 0 |
| `track.N.loop.out` | trigger | null zonder track of zonder in-punt · 1 = loop aan · 0 = in-punt klaar |
| `track.N.loop.reloop` | trigger | null = niets · 1 = loop aan (drukken = eraf) · 0,5 = vorige loop terug te halen |
| `track.N.play.quant` | trigger | null zonder track of als hij al speelt · 1 = wacht op de maat · 0 |
| `transport.quantize` | trigger (toggle) | 1 aan · 0 uit |

- Meldingen:
  - beatjump zonder grid: "beatjump kan niet zonder beatgrid — tik eerst het tempo (TAP)";
  - onzeker: `ONZEKER`;
  - rand: "de loop komt dan buiten het nummer te liggen";
  - play.quant met een onzekere maatgever: info-melding.
- LED-kleuren (feedback.js, KLEURSCHEMA):
  - `play.quant` groen;
  - `beatjump.back/fwd` cyaan;
  - `beatjump.halve/double` altijd cyaandonker (een keuze, geen niveau);
  - `loop.in/out/reloop` vallen onder de bestaande `.loop.`-regel (cyaan, knipperen op de tel als ze aan staan).
- Uitleg voor apc.html: `src/ui/apc-beschrijf.js` beschrijft elke nieuwe action. De test controleert dat.
- Snapshot per deck: `loopIn`, `wacht` en `sprongTellen`. Bovenaan: `quantize`.

## Toetsen (keyboard.js; de toetsenkaart onder `/` in index.html is bijgewerkt)

| | links (track met focus) | rechts (tweede track) |
|---|---|---|
| beatjump − / + | R / T | Y / U |
| shift: lengte ½ / ×2 | shift+R / shift+T | shift+Y / shift+U |
| loop in · loop out | G · C | H · N |
| shift: reloop/exit | shift+G | shift+H |
| starten op de maat | shift+Q | shift+P |
| quantize (alle tracks) | 6 | |

- De shift-varianten staan in één tabel, `SHIFT_VARIANT` (geëxporteerd als `SHIFT_ALIAS`). Hotcue → wissen werkt zoals voorheen.
- **Let op:** shift+Q en shift+P deden eerst hetzelfde als Q en P (play). Nu starten ze op de maat.
- Vrije toetsen die ik niet heb gebruikt: 6 was vrij, net als R T Y U G H C N. V, B en M zijn bezet.

## Gewijzigde bestanden

`src/engine/beatgrid.js`, `bron.js`, `stream-lezer.js`, `deck.js`, `engine.js`,
`src/control/actions.js`, `feedback.js`, `keyboard.js`, `src/ui/apc-beschrijf.js`,
`src/video/video-mixer.js`, `index.html`, `test/beatgrid.test.mjs`, `test/engine.test.mjs`,
`test/stream.test.mjs`.

NIET aangeraakt:
- `audio-graph.js` en `stream-kern.js`;
- CLAUDE.md, HANDOFF, ROADMAP en VRAGEN;
- `mappings/apc40mk2.json`: geen APC-indeling.

In `deck.js` is de hotcue-wijziging klein gehouden, voor het library-spoor: in `hotcue()` veranderen
twee regels (`this._snap(...)` bij zetten, `this._faseDoel(...)` bij springen). De hulpfuncties
staan eronder.

## Tests

### beatgrid.test (+15)
`verschuif`, ook over een stukgrens (1,25 + 4 tellen = 3,1, fase gelijk), `metFaseVan` (0,3 en 0,8
van een tel, over een grens) en `volgendeVeelvoud`.

### stream.test (+16)
- **StreamBron:** een gepland segment met `T` en de vlag. Tot T staat de positie stil en `ctxTimeOf` klopt al. Tempo en loop tijdens het wachten houden T vast. Na T is een tempowissel een gewoon segment. `start` met loop geeft één segment. Pauze annuleert.
- **De worklet zelf**, met een nagemaakte AudioWorkletGlobalScope:
  - vóór T volkomen stil;
  - vanaf T precies het startpunt, sample voor sample (afwijking 0);
  - het invloeien begint op T;
  - **zonder de vlag klonk vóór T de muziek van vóór het startpunt.** Deze check bewijst dat de vlag nodig is;
  - pauze vóór T: helemaal stil, ook geen tikje;
  - startpunt verzet tijdens het wachten: stil tot T, dan het nieuwe punt.

### engine.test (+~95)
De mock van `createBufferSource().start` onthoudt nu `wanneer` en `vanaf`.

- **Beatjump:**
  - zonder grid: melding en lampje null;
  - 4 tellen vooruit en terug;
  - lengte ½ en ×2 met grenzen 1 en 32;
  - tijdens spelen blijft de fase exact gelijk;
  - over een stukgrens;
  - in een loop: de loop schuift mee, de speelkop houdt zijn plek, `loopBeats` blijft 4, de loop loopt daar rond;
  - een loop over een stukgrens geschoven: 4 tellen van 150 bpm;
  - de rand: melding bij 8 tellen, 4 tellen past precies;
  - onzeker stuk: weigert met `ONZEKER`, lampje null, ook bij springen vanuit zeker naar onzeker; op slot mag het wel.
- **Loop in/out/reloop:**
  - out zonder in doet niets;
  - in/out zonder quantize: exact, en de loop loopt rond;
  - reloop/exit: eraf, weer aan en terug naar het begin;
  - `loop.exit` onthoudt de loop ook;
  - out vóór het in-punt: niets;
  - een lopende beat-loop wordt vervangen;
  - een nieuw nummer wist alles.
- **Quantize:**
  - via de bus op alle tracks, ook in de snapshot;
  - loop in/out op tellen, met het lampje van loop 4 en halveren;
  - "out vlak na in": minstens één tel;
  - reloop fasebehoudend en teruggevouwen;
  - hotcue zetten snapt; springen fasebehoudend (0,8 → 1,9 en 0,3 → 2,15), stilstaand exact;
  - cue snapt en de speelkop gaat mee, daarna speelt de volgende druk;
  - in een onzeker stuk geen snap.
- **Starten op de maat:**
  - zonder maatgever meteen;
  - met een maatgever gepland op diens maatbegin: `src.start(801,7, 8)` met een nep-klok;
  - tijdens het wachten: lampje 1, positie stil, geen knipperen, `ctxTimeOf` klopt;
  - na T in fase en op dezelfde plek in de maat;
  - startpunt 0,1 s na zijn tel → geluid 0,1 s na het maatbegin, daarna fase gelijk;
  - maatbegin binnen 8 ms → de maat erna;
  - pauze annuleert;
  - tempo, hotcue en sync tijdens het wachten: startmoment blijft;
  - `tellen: 1` met de maatgever op +5%;
  - onzekere maatgever: meteen, met een info-melding.
- **Toetsen:** elke toets MET shift wijst naar een bestaande action. Een keer echt drukken via de handler: shift+T, T, shift+R, G, C, shift+G, 6, shift+P, shift+Q. Daarnaast heeft elke nieuwe action een uitleg.

### Headless-proef in echte Chromium
Script: `scratchpad/proef-maat.mjs`, niet in de repo. Eigen server op 8867 met tijdelijke
database, media en opnames, geen MIDI. De demotrack op A en B via `laadGeheugen`, dus door de
echte StreamBron en worklet. Een meter-worklet hing aan de ruwe uitgang van B.
- `track.2.play.quant` plant B op het maatbegin van A.
- De worklet is stil tot T.
- **Het eerste geluid kwam 16 µs na T**, minder dan één frame (20,8 µs).
- Daarna speelde B in fase en op dezelfde maatfase als A.
- Geen fouten in de console.

`kijk.mjs` is daarnaast helemaal groen.

## Wat NIET getest is
- **Luisteren (Clay):**
  - een beatjump van 4 tellen die in de maat blijft;
  - een track die precies op de volgende maat invalt;
  - klikvrij springen in een loop en bij loop out (theoretisch via de bestaande segmentovergang en LOOP_NAAD);
  - quantize-hotcues onder de vingers.
- Het gedrag van de BufferBron bij gepland starten staat alleen in de mock. De app gebruikt overal de StreamBron, en die is in echte Chromium gemeten.
- Starten op de maat terwijl de maatgever in een loop korter dan een maat staat: dat pad (tellen van de fxKlok) is niet apart getest.
- Tempo of nudge van de MAATGEVER tijdens het wachten: T staat vast op het moment van drukken en wordt niet opnieuw uitgerekend. Bij hooguit één maat verwaarloosbaar, maar niet gemeten.
- Hoe het wachten eruitziet: video, golfvorm en lampjes op het scherm zijn niet bekeken, ook de video-wijziging niet (alleen code).
- De LED-kleuren op de APC zelf: er zit nog geen mapping op.

## Aannames (kunnen verkeerd zijn)
- **Maatbegin = het grid-maatbegin**, geteld vanaf tel 0 van het eerste stuk. In een later stuk loopt de telling door. "Tel 1 hier" in een later stuk legt daar een tel, maar maakt die NIET per se tot maatbegin. Staan de maatstrepen van de maatgever verkeerd, dan valt de track daar consequent naast (op de "3" in plaats van de "1").
- Een track die op de maat wacht, telt als "spelend", ook voor `syncMaster`. Staat zijn fader hoger dan die van de huidige maatgever, dan wordt hij tijdens het wachten de maatgever. Zijn tellen vallen op die van de oude maatgever, dus de klok blijft consistent. Niet expliciet getest.
- Hotcue, cue en loop in/out zetten op `deck.position`, niet op wat je HOORT (positie min uitgangsvertraging). Zo deed de hotcue het al. Met quantize maakt het niet uit. Zonder quantize komt het punt 10–40 ms later dan je hoort, net als voorheen.
- Play en play.quant zijn gescheiden: gewone play wacht nooit, ook niet met quantize aan.
- Tijdens het wachten brandt het play-lampje al: de track is gestart, alleen gepland.

## Vragen voor Clay
1. **Maat of tel** voor starten op de maat? Gekozen: maat (blauwdruk en plan). `tellen: 1` is een regel werk als je liever de volgende tel wilt, of beide op twee knoppen.
2. **Maatstrepen in een later gridstuk:** moet "tel 1 hier" daar ook het maatbegin worden? Nu telt hij door vanaf het eerste stuk. Pas dan valt starten op de maat in elk stuk op de echte "1".
3. **Quantize voor alle tracks** (gekozen) of per track?
4. **Hotcue met quantize:** meteen fasebehoudend (gekozen) of wachten tot de volgende tel (Serato-achtig)?
5. **APC-plek**, na "mapping als verschil". De twee voorstellen hieronder komen uit VERBETERINGEN ronde 3 en het plan. De quantize-plek staat nog open.
   - shift + Activator = play.quant. Volgens `01-plan.md` is die vrij.
   - shift + Bank ◀▶ = beatjump −/+ (focus-track). Bank ◀▶ zelf = loop ½/×2.
6. Moet het play-lampje tijdens het wachten gedimd branden in plaats van vol? Dat kan met read 0,5 plus `half` in KLEURSCHEMA.

## Voorstel CLAUDE.md-tekst (onder "Bekende grenzen")

```
- TRANSPORT (spoor C, 25 sep): beatjump, loop in/out/reloop, quantize, starten op de maat.
  - Beatjump (`track.N.beatjump.back/fwd`, lengte `.halve/.double` uit 1/2/4/8/16/32, standaard 4,
    per track) rekent in TELLEN: `Beatgrid.verschuif`, dus de fase in de tel blijft exact, ook over
    een stukgrens. In een loop schuift de LOOP mee (begin, einde en speelkop evenveel tellen,
    loopBeats blijft). Zonder grid, in een onzeker stuk (speelkop, doel of verschoven loop) zonder
    slot, of met een loop die buiten het nummer zou vallen: weigeren met een melding.
  - Loop in/out (`track.N.loop.in/.out`): in = begin (wacht), out = einde en meteen aan; met
    quantize een heel aantal tellen (minstens 1, loopBeats gezet). Reloop/exit (`.loop.reloop`):
    loop eraf, of de laatste loop terug (`vorigeLoop`, onthouden bij elke manier van eraf gaan) en
    naar zijn begin. loopInPunt en vorigeLoop.start zijn vastpunten van de StreamBron.
  - Quantize is ÉÉN schakelaar voor de hele engine (`transport.quantize`, Engine.setQuantize zet
    deck.quantize). Zetten (hotcue, cue, loop in/out) snapt naar de dichtstbijzijnde tel; een
    hotcue-SPRONG tijdens spelen is fasebehoudend en meteen (`Beatgrid.metFaseVan`, hooguit een
    halve tel naast de hotcue), niet wachten tot de tel. Alleen op een zeker grid: in een onzeker
    stuk komt een cue precies waar je drukt.
  - Starten op de maat (`track.N.play.quant`, Engine.startOpDeMaat): het geluid begint op het
    volgende MAATbegin (grid: tel 0 van het eerste stuk, elke 4e daarna) van de maatgever
    (syncMaster), en de tel van de track bij het startpunt valt erop. Moment via ctxTimeOf van de
    maatgever, binnen startDrempel de maat erna, geen timer. Zonder maatgever meteen.
  - GEPLAND STARTEN (bron.js): start(p, { op }) met op later dan nu. De bron speelt al
    (playing = true, deck.wacht = true, pauze annuleert) maar klinkt pas vanaf op, sample-exact;
    tot dan staat de positie stil op p. Tempo, loop, bend en sprongen tijdens het wachten houden
    het startmoment (wachtTot). De worklet krijgt `gepland: true`: de overgang begint op T,
    een nog niet begonnen gepland segment vloeit nergens uit. ZONDER die vlag klinkt vóór T de
    muziek van vóór het startpunt (stream.test bewijst het). Gemeten in headless Chromium: eerste
    geluid 16 µs na T. Video, fase- en tel-lampjes staan stil zolang een track wacht; sync doet dan
    alleen het tempo.
  - start(p, { loop }) zet loop en positie in één segment (beatjump in een loop, reloop).
  - Toetsen: R/T en Y/U beatjump (shift: lengte), G/C en H/N loop in/out (shift+G/H reloop),
    shift+Q/P op de maat, 6 quantize. Nog geen APC-plek (na "mapping als verschil").
```

## Na het samenvoegen bijwerken (dat laat ik aan de samenvoeger)
- `docs/VERBETERINGEN.md` regel 45: "beatjump, quantize voor hotcues" als gedaan markeren.
- `docs/INPUT.md` tabel, rijen 93/100/103/104: start op de maat, quantize, loop in/out en beatjump zijn nu "ja".
- HANDOFF en ROADMAP 16: transport is gedaan; EQ-kill en brake horen bij het andere spoor.
- Mogelijke conflicten met parallelle sporen:
  - `engine.js`, `actions.js`, `feedback.js` (KLEURSCHEMA), `keyboard.js` en `apc-beschrijf.js` (dj-klank);
  - `deck.js` `hotcue()`, twee regels (library);
  - `index.html` toetsenkaart.
