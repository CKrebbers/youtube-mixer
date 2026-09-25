# ROADMAP 16, spoor C, deel KLANK: EQ-kill, rem (vinylstop), hysterese op de maatgever

Branch: `spoor2/dj-klank`, vanaf `spoor2/renderblok` (7b6904a). Worktree
`.claude/worktrees/agent-a18b43068fd14f669`, aan het eind losgekoppeld (`git switch --detach`).
Niet gemerged, niet gepusht, niets verwijderd.

## Commits

| commit | onderwerp |
|---|---|
| 91cbbeb | Streamkern: rem (vinylstop) als segment met een vertraging, zonder afval |
| 9a5c6f4 | Rem (vinylstop): per track remmen tot stilstand, nog eens drukken = los |
| 3c0e402 | EQ-kill per band: schakelaar en drukknop, klikvrij, de knop blijft staan |
| bf7fd70 | Maatgever met hysterese: wisselt pas na 3 dB en 250 ms, meteen bij stoppen |
| b07eb9d | bron.js: rem-hulpjes onder de BufferBron, niet op de plek van dj-transport |

Elke commit apart getest (index uitgepakt, gerichte tests groen). 18 bestanden, +1080 −94.
Gewijzigd: `src/engine/{stream-kern,bron,deck,engine,audio-graph}.js`,
`src/control/{actions,keyboard,feedback}.js`, `src/ui/apc-beschrijf.js`,
`src/video/{video-mixer,puls}.js`, `src/analysis/luisteraar.js` (één woord in commentaar),
`index.html` (toetsenkaart), `tools/headless/kijk.mjs`, tests `engine`, `stream`,
`renderblok`, `video`. NIET gewijzigd: CLAUDE.md, HANDOFF, ROADMAP, VRAGEN, mappings,
`stream-lezer.js` (de worklet hoefde niet te veranderen).

## 1. EQ-kill per band

**Wat.** Per track een kill voor laag, midden en hoog, als schakelaar én als drukknop.
De band gaat naar −70 dB (`EQ_KILL_DB`, even diep als de knop in zijn onderste 3%). De
knopstand (`deck.ui.low/mid/high`) blijft staan: kill uit is precies terug; draaien
tijdens een kill wordt onthouden en pas hoorbaar als de kill eraf gaat.

**Hoe.**
- `audio-graph.js`: `eqDb(norm)` (de oude formule, los), `setEqBand(param, norm, now, kill)`
  en `killEqBand(param, norm, kill, now)`.
- Klikvrij: een `setValueCurveAtTime` van 5 ms (`KILL_FADE`), 33 punten, in dB, maar
  zo dat de AMPLITUDE een zachte S volgt (raised cosine). Een rechte lijn in dB doet bijna
  alle amplitude in de eerste stapjes (heen) of de laatste (terug): gemeten 23% van de weg
  in één stap, nu 4,9%.
- NotSupportedError-valkuil: elke EQ-zet (ook de gewone knop) doet eerst
  `cancelAndHoldAtTime(now)`; de kill-curve begint vanaf de vastgehouden waarde. Zonder dat
  gooit een knopdraai vlak na een kill (of twee kills binnen 5 ms) NotSupportedError; de
  strenge mock in engine.test controleert beide gevallen.
- `deck.js`: `kill` (schakelaar), `killVast` (drukknop), `gekild(band)`, `setKill`,
  `toggleKill`, `houdKill`. Alleen als het HOORBAAR verandert komt er een curve
  (`_killHoorbaar`): schakelaar aan terwijl je drukt doet niets aan de EQ. `applyUi`
  respecteert de kill.
- Lampje (B4), voor schakelaar en drukknop hetzelfde: 1 = band weg, 0 = open (bruikbaar),
  null = lege track zonder kill (niets te doen). Kleur rood (`feedback.js`).

**Actions:** `track.N.kill.low|mid|high` (trigger, aan/uit), `track.N.kill.low|mid|high.hold`
(trigger, weg zolang ingedrukt). Uitleg in `apc-beschrijf.js`. **Geen toetsen**: het
toetsenbord is vol (zie onder); geen APC-indeling (Clay kiest).

## 2. Rem (vinylstop)

**Wat.** De track remt in de remtijd lineair af tot stilstand en staat dan stil
(gepauzeerd op de plek waar hij stilviel); play speelt daarna gewoon verder. In het laatste
kwart van de snelheid dooft hij uit tot stilte op het moment van stilstand.

**Keuzes (gemotiveerd, ook in het commentaar):**
- **Remtijd in SECONDEN**, niet in tellen: een rem is een gebaar van de draaitafel (de motor
  gaat uit), geen maatlengte; hij moet werken zonder grid of met een onzeker grid (ambient,
  lange sets: juist daar faalt de autodetectie); de knop betekent dan altijd hetzelfde. Knop
  `track.N.brake.time` exponentieel 0,1–5 s (`REM_MIN`/`REM_MAX`), midden ≈ 0,71 s,
  standaard 1 s (`REM_STANDAARD`). Per track, sessietoestand.
- **Tweede druk tijdens het remmen = LOS**: meteen weer op tempo (de start/stop-knop van een
  draaitafel die nog uitloopt: de motor pakt hem weer op), en je kunt er een "tape stop"
  mee maken die op de drop weer invalt. Play tijdens het remmen doet hetzelfde (niet
  pauzeren). Wie meteen stil wil: pauze.
- **Op een stilstaand deck doet rem niets**: een rem mag nooit onverwacht iets starten.
- **Uitdoven (`REM_UIT` = 0,25)**: vol tot de snelheid onder 25% van de beginsnelheid komt,
  dan lineair naar 0 op het moment van stilstand. Zonder dat bleef er op stilstand een
  gelijkspanning staan (de laatste sample, vastgehouden) die als plof en tik wegviel; een
  draaitafel doet dit vanzelf (een element geeft spanning naar snelheid).
- Tijdens het remmen: tempo (pitchfader, tempo-encoder, bend, sync-tempo) wordt onthouden
  maar de rem loopt door; loop aan/uit remt door (stilstand op hetzelfde moment, geen
  sprong); start/seek/hotcue/cue/pauze halen de rem eraf.
- Een remmende track geeft geen maat meer (zie 3) en `fxKlok()` geeft tijdens de rem null:
  effecten op de tel van dat deck worden niet opnieuw aangehaakt en houden hun laatste
  tempo (echo houdt de laatste tel, zoals al geregeld was).

**Hoe (regel 3 over de draadgrens).**
- `stream-kern.js`: segment `{ T, P, R, loop, speelt, rem }` met `rem = null | { a }`,
  a < 0. `positieOp`: `P + dt·(R + a·dt/2)` met dt geklemd op `-R/a` (daarna stil), vóór
  het vouwen in de loop. Zonder rem precies de oude regel (bit voor bit). `ctxTijdVan`
  rekent de rem terug met de numeriek stabiele wortel `τ = 2s/(v + √(v² + 2as))`, en geeft
  null als hij eerder stilvalt; binnen een loop die rondging telt de ronde mee.
  `snelheidOp(seg, t)` en `remStil(seg)` zijn hulpjes voor de hoofdthread. In het audiopad
  alleen: de term in positieOp (via `posities()`, ingelijfd) en `remUit()` (uitdoven, in
  `leesSegment`, alleen objecten en hele getallen erin, niets terug: afvalvrij). `vooruit`
  in renderBlok blijft |R| als bovengrens: bij remmen kijkt hij iets verder vooruit dan
  nodig, veilige kant. De worklet (`stream-lezer.js`) is ongewijzigd.
- **Waarom `rem: { a }` en geen getal `a`**: eerst was het een getal-veld. Dan maakte V8 in
  de worklet per blok per deck een getal-object (gemeten 260 bytes/blok, 3 GC's per venster):
  een getal-veld dat op sommige segmenten ontbreekt moet bij het lezen als "getal of
  undefined" worden ingepakt. Een object-veld (zoals `loop`) lezen maakt niets aan, ook als
  het ontbreekt. Nu: 0 GC's, 6,5 bytes per bericht (zelfde budget als gewone wissels).
- `bron.js` StreamBron: `rem(duur)` stuurt één remsegment; `_remVerder()` bij een loopwissel
  (zelfde vertraging, stilstand op hetzelfde moment); `_planRemKlaar()` maakt er op
  stilstand een pauze-segment van op `positieOp(seg, remStil(seg))`. Een timer
  (`planRem`) bepaalt alleen WANNEER; loopt de audioklok achter op de timer, dan nog eens.
  `remt`, `snelheid`. `_segment()` zet `rem: null`; `setRate` tijdens een rem onthoudt alleen.
- BufferBron (reserve, eenvoudiger zoals gevraagd): playbackRate `linearRamp` naar 0
  (Web Audio per blok van 128) en het bron-volume in het laatste kwart naar 0; de positie
  rekent met dezelfde `positieOp`. Op stilstand `stop()` + offset.
- `deck.js`: `rem()`, `laatRemLos()`, `remt`, `snelheid`, `setRemTijd(norm)`, `remKnop`;
  `togglePlay` laat tijdens een rem los; `bron.onRemKlaar` → herankeren + 'change'.
- Video volgt: `video-mixer.js` `_volg` gebruikt `deck.snelheid` (rate met bend, tijdens een
  rem wat ervan over is) in plaats van `deck.rate`, voor doel én rate. Anders liep het beeld
  de rem voorbij en sprong het elke 150 ms terug. Bijvangst: bend volgt het beeld nu exact
  in plaats van via bijsturen.

**Actions en toetsen:** `track.N.brake` (trigger; lampje 1 = remt, 0 = speelt, null =
stil; oranje), `track.N.brake.time` (value 0..1). Toetsen: **`` ` `` (links van 1) = rem
van de focus-track**, ook als `IntlBackslash` (op een Mac-ISO-toetsenbord heten de twee
linkertoetsen per browser zo, dus beide), **`=` = rem van de rechterhand**. Toetsenkaart in
`index.html` bijgewerkt. Alle letters en cijfers waren al bezet (met dj-transport: R T G C
Y U H N 6); Tab en pijlen heb ik NIET genomen (Tab om te navigeren zou een spelende track
remmen, pijlen verzetten een fader met focus).

## 3. Hysterese op de maatgever

**Wat.** De maatgever wisselt pas als een andere track **minstens 3 dB harder** klinkt
(`MAAT_MARGE_DB`) en dat **250 ms op de audioklok** volhoudt (`MAAT_WACHT`). Stopt de
maatgever (pauze, rem, trackeinde, grid weg, leeg), dan **meteen** de luidste. "Hard" is
zoals sync het altijd al rekende: fader maal crossfader (faderGain × xfadeGain), niet het
gemeten niveau van de muziek.

**250 ms en geen halve tel**: de maatgever bepaalt juist het tempo, en een halve tel van
welke track? Vast in tijd is eenduidig.

**Hoe.** `engine.js`:
- `volgMaatgever(staat, niveaus, nu)`: de regel, puur (nep-niveaus, nep-klok). Staat =
  `{ id, sinds }`: sinds wanneer de maatgever verslagen wordt (door wie dan ook); na 250 ms
  aaneen wordt de luidste het. Even onder de drempel = opnieuw wachten.
- `Engine.maatgever()`: bijgewerkt bij elke 'change' (fader, crossfader, kant, play, rem: alles
  wat de niveaus verandert meldt dat al) en bij elke vraag; een timer (`unref`) zorgt dat de
  wissel ook komt als niemand iets vraagt. Een wissel meldt `'change'` via een microtask, zodat
  bussen en sampler opnieuw aanhaken (en niet midden in een snapshot).
- `syncMaster(id)` = de maatgever, dus MAAT-badge, `track.N.leads`, bussen (echo/gate op de
  maat), sampler, faseVerschil, sync én straks startOpDeMaat (dj-transport) wijzen dezelfde
  track aan. Is de track die synct zelf de maatgever, dan de luidste andere (zonder hysterese).
  Speelt er niets: zoals altijd de eerste geladen track met grid.
- Een remmende track kan geen maatgever zijn (`_kanMaat`).
- Video-puls: `video-mixer.js` `_pulsNu` vraagt `engine.syncMaster()` in plaats van zijn eigen
  `klokTrack` (die sprong los van de badge); een maatgever die niet te zien is (fader of
  crossfader dicht) geeft geen puls, zoals vroeger. `klokTrack` is weg uit `puls.js` (niet meer
  gebruikt); de drie checks erop in video.test zijn vervangen door vier op de mixer zelf.

## Tests

- `nice -n 10 node test/alles.mjs` (25 sep, belasting 12–30): **30 bestanden, 2015 checks,
  1 rood: `vormen-zwaar` "cl: kwaliteit 0,25 is goedkoper (3,98 tegen 4,03 ms)"**, een
  tijdmeting onder belasting in bestanden die ik niet aanraakte. Los opnieuw: groen
  (2,76 tegen 4,03 ms).
- **engine.test** (+59 checks): EQ-kill (curve 5 ms vanaf nu, amplitude-S 4,9% tegen 23%,
  knop blijft staan, knopdraai tijdens de curve en twee kills binnen 2 ms zonder
  NotSupportedError, terug op de knopstand, drukknop, schakelaar + drukknop, per band,
  lampjes 1/0/null); rem op de reserve (positie P + R·t − R·t²/2D, snelheid, playbackRate en
  volume naar 0, fxKlok leeg, stil op P + R·D/2, daarna een echte pauze via de timer, play
  verder, tweede druk = los, play = los, tempo tijdens de rem onthouden, pauze haalt hem
  eraf, remtijd-knop 0/0,5/1 = 0,1/0,71/5 s); maatgever (puur: ±2 dB dansen 10 s = 0
  wissels, 3,5 dB: na 200 ms nog niet, na 250 ms wel, even onder de drempel = opnieuw
  wachten, stoppen = meteen, niets = null; in de engine: 1,35 dB harder blijft een seconde
  bij A, bussen op A's tempo, sync naar de badge en niet naar wie nét harder staat, na
  250 ms B door de TIMER (niemand vroeg) met melding en bussen op B's tempo, pauze en rem van
  de maatgever = meteen); toetsen `` ` ``/IntlBackslash/`=`.
  Aangepast bestaand: "speelt er iets: de luidste die speelt" (acht tracks) kreeg
  `NOW += 0.3` ervoor, plus een check dat hij de eerste 250 ms NIET wisselt.
- **stream.test** (+26): formule (zonder rem bit voor bit de oude regel, stilstand op
  P + R·D/2, ctxTijdVan omgekeerd en null voorbij de stilstand, rem in een loop); StreamBron
  met nagemaakte worklet: het remsegment, **positie hoofdthread = worklet frame voor frame
  over 9000 frames (grootste verschil 4,8·10⁻⁴ frame)**, gelezen uit een helling-signaal
  (sample n = n mod 30000) door renderBlok; geen gat; na stilstand exact stil; laatste 63 ms
  dooft monotoon uit; na de timer een pauze-segment op de plek, één melding; play verder;
  tempo/loop aan/loop uit tijdens de rem; start haalt hem eraf. Klikvrij op een sinus zoals de
  worklet het krijgt (remsegment 3 ms na T, pauze 5 ms na stilstand): na de wissel aan het
  begin **0,98× een normale stap**, stil door de overgang naar pauze heen; los tijdens het
  remmen 1,39×. Mutatieproef: zonder `remUit` drie checks rood.
- **renderblok.test** (+1): gouden hash 9dfaeb73 ongewijzigd (segmenten zonder rem); nieuw
  venster met 323 remsegmenten (rem in 0,1–2 s, in loops, tegen het gat, voorbij het einde):
  **2096 bytes, 0 GC's (6,5 B per bericht)**.
- **video.test**: de puls volgt de maatgever van de engine, wisselt mee, geen maatgever = 0,
  onzichtbaar = 0.
- **Headless** (`VARVE_KIJK_POORT=8892 VARVE_KIJK_DEBUG=9492 node tools/headless/kijk.mjs`,
  eigen server en db, geen MIDI): alles groen, met twee nieuwe metingen in echte Chromium via
  de echte worklet: **kill laag 0,63 → 0,00 → 0,62** (bas-band van de master), **rem 0,4 s:
  klinkt eerst (piek 0,11), stil na stilstand (2·10⁻⁷), gepauzeerd na 0,2000 s afgelegd
  (verwacht 0,2000)**, positie nooit terug. Server en Chromium daarna weg (poorten vrij).

## Samenvoegen met spoor2/dj-transport (gecontroleerd met `git merge-tree`)

Na b07eb9d conflicteert alleen `src/video/video-mixer.js`, twee kleine plekken; alles
anders voegt vanzelf samen. Oplossing (proefsamenvoeging in de scratchpad, daarna engine,
stream, renderblok, video, regels, beatgrid, mapping, feedback, spiegel allemaal groen,
inclusief de tests van dj-transport):
1. `_pulsNu`: de versie van dj-klank (`engine.syncMaster()`); `klokTrack` bestaat niet meer.
2. `_volg`: `doel`/`rate` van dj-klank (`deck.snelheid`), `speelt` van dj-transport
   (`deck.playing && !deck.wacht`).
En twee regels die pas na samenvoegen kunnen (anders remt of dirigeert een wachtend deck):
3. `Deck.rem()`: `if (!this.buffer || !this.playing || this.wacht) return false;`
4. `Engine._kanMaat(d)`: `… && d.playing && !d.wacht && !d.remt`.
Aanrader: in dj-transport's `StreamBron.start(…, { op })` het segment ook `rem: null` geven
(vorm gelijk aan `_segment`; niet nodig voor de werking of voor afvalvrij).
Toetsen botsen niet (dj-transport: R T G C Y U H N 6; dj-klank: `` ` ``, IntlBackslash, `=`).

## Wat NIET getest is

- Niet gehoord door Clay, en geen luistertest op echte muziek: hoe de rem klinkt (vorm van
  het uitdoven, REM_UIT = 0,25), of 5 ms kill op zware bas nergens plopt. Gemeten is alleen
  op een sinus/demo (geen stap groter dan de toon zelf, bas weg en terug).
- Niet op Clay's APC (geen indeling), niet in Clay's Chrome/Comet. De afvalvrijheid is in
  Node gemeten (V8 14.6), niet in Chrome's audiothread.
- De BufferBron-rem alleen tegen de mock (in de app speelt alles via de StreamBron).
- De video tijdens een rem niet met echte video bekeken (alleen de rekenregel: de mixer krijgt
  `deck.snelheid`). Chrome klemt playbackRate op ≥ 0,0625: het laatste stukje van een rem
  loopt het beeld een paar ms voor en springt dan (< 1 beeld) terug.
- De maatgever-wissel in een achtergrondtab: timers worden daar tot 1× per seconde
  vertraagd, dus zonder andere aanleiding kan de wissel tot ~1 s later komen dan 250 ms.
- Toetscodes van Clay's eigen toetsenbord (Backquote/IntlBackslash).

## Aannames (kunnen verkeerd zijn)

- 3 dB en 250 ms zijn de voorbeeldwaarden uit de opdracht, zo overgenomen.
- "Hoe hard" = fader × crossfader, niet het gemeten niveau van de muziek: een zachte track
  op volle fader telt als hard. Zo rekende sync al; een gemeten niveau zou flikkeren.
- Sync gaat nu naar de maatgever (de badge). Wie binnen 250 ms na een fader-beweging op sync
  drukt, synct nog naar de vorige maatgever.
- Kill = −70 dB, gelijk aan de knop-kill; 5 ms, amplitude-S.
- Rem start vanaf de huidige bronsnelheid (dus inclusief een ingedrukte bend).
- Tijdens een rem kan de tempokaart-timer van het deck één keer `_heranker` doen; dan krijgt
  een gate op dat deck geen klok en gaat zijn poort open (effect van een halve seconde, bij
  een rem die toch uitdooft).
- Bestaand, niet door de rem: bij elke segmentwissel (ook pitch) vloeien oud en nieuw 4 ms
  equal-power over; voor (bijna) gelijke signalen geeft dat tot +3 dB (√2) in die 4 ms. Zelfde
  grens die de seek-test al toestaat (1,5×). Een lineaire overgang voor een tempowissel op
  dezelfde plek zou dat wegnemen; niet aangeraakt.

## Vragen voor Clay

1. Remtijd in seconden (0,1–5 s, standaard 1 s) goed, of liever in tellen?
2. Tweede druk tijdens het remmen = los (weer op tempo). Of liever: meteen stil?
3. Na loslaten springt hij direct op tempo. Wil je een "spin-up" (optrekken in een instelbare
   tijd)? Dat is een versnelling omhoog in hetzelfde segment (a > 0 tot R), ~een uur werk.
4. Klinkt het uitdoven in het laatste kwart als een vinylstop, of wil je eerder/later uitdoven?
5. APC-plek voor kill (3 per track, schakelaar en/of drukknop) en rem + remtijd: jij kiest.
   Toetsenbord: geen kill-toetsen (vol). Wil je daar toetsen voor opofferen?
6. Hysterese 3 dB / 250 ms: goed zo, of liever een grotere marge?

## Voorstel CLAUDE.md

Bij "Bekende grenzen", de bullet "Sync kent geen het andere deck meer" vervangen door:
```
- Sync kent geen "het andere deck" meer: een track synct naar de MAATGEVER
  (Engine.maatgever): de track die je het hardst hoort (fader × crossfader,
  spelend, met grid, niet remmend), met HYSTERESE (25 sep, VRAGEN G2): een andere
  track neemt het pas over als hij 3 dB harder klinkt (MAAT_MARGE_DB) en dat
  250 ms op de audioklok volhoudt (MAAT_WACHT); stopt of remt de maatgever, dan
  meteen. De regel is puur (volgMaatgever), bijgewerkt bij elke 'change' en elke
  vraag; een timer (alleen WANNEER) zorgt dat de wissel ook komt als niemand
  vraagt, en een wissel meldt 'change' (bussen en sampler haken aan).
  syncMaster(id) = die maatgever; MAAT-badge, bussen, sampler, video-puls en sync
  wijzen dus dezelfde track aan. Is de synccende track zelf de maatgever, dan de
  luidste andere. Speelt er niets, dan de eerste geladen track met grid.
```
In de video-bullet: "de maat komt van de track die het hardst klinkt, speelt en een grid
heeft" → "de maat komt van de maatgever van de engine (hysterese, zie sync)".

Nieuw, na de streamkern-bullets:
```
- REM (vinylstop, 25 sep): track.N.brake remt in de remtijd (track.N.brake.time,
  SECONDEN 0,1–5, standaard 1: een gebaar van de draaitafel, ook zonder grid)
  lineair tot stilstand; daarna een gewone pauze op die plek. Nog eens drukken of
  play tijdens het remmen = los (meteen op tempo); op een stilstaand deck niets.
  Het segment krijgt rem = null | { a } (a < 0): positieOp = P + R·dt + a·dt²/2
  tot R + a·dt = 0, hoofdthread en worklet dezelfde formule; ctxTijdVan rekent
  terug (null als hij eerder stilvalt). EEN OBJECT, GEEN GETAL-VELD: een getal-veld
  dat op sommige segmenten ontbreekt liet V8 per blok een getal-object maken
  (260 B/blok); een object-veld lezen maakt niets aan. Onder REM_UIT (25%) van de
  beginsnelheid dooft de worklet uit tot stilte op stilstand (anders een
  gelijkspanning die als plof wegvalt). Tijdens een rem: tempo onthouden, loop
  remt door, start/seek/hotcue/pauze halen hem eraf; fxKlok = null en geen
  maatgever. De video volgt deck.snelheid (niet de pitchfader). BufferBron
  (reserve): playbackRate-ramp naar 0 + volume, positie met dezelfde formule.
  Toetsen: ` (links van 1, ook IntlBackslash) = focus, = = rechterhand.
- EQ-KILL (25 sep): track.N.kill.low/mid/high (schakelaar) en .hold (zolang je
  drukt), −70 dB zoals de knop-kill. De knopstand blijft staan (kill uit =
  precies terug). Klikvrij: setValueCurveAtTime van 5 ms die in AMPLITUDE een
  zachte S volgt; ELKE EQ-zet (ook de knop) doet eerst cancelAndHoldAtTime,
  anders gooit een knopdraai vlak na een kill NotSupportedError. Lampje 1 = band
  weg, 0 = open, null = lege track. Nog geen APC-plek, geen toetsen.
```
Structuurlijst: bij `test/renderblok.test.mjs` "… en remmende decks (0 GC)"; bij
`src/video/puls.js` "effecten op de tel: vorm" (klokTrack is weg).
docs/VERBETERINGEN.md ronde 3 "Engine": "hysterese op wie de maat geeft" kan op gedaan
(bf7fd70); brake en kill zijn gebouwd (G2-lijst: brake/kill).
