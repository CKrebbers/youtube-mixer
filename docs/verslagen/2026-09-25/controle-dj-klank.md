# Controle ROADMAP 16b, spoor C (klank): EQ-kill, rem, hysterese

Branch: `spoor2/dj-klank-c`, vanaf `spoor2/dj-klank` (b07eb9d). Worktree
`.claude/worktrees/agent-af4edab74753b0dde`, aan het eind losgekoppeld. Niet gemerged,
niet gepusht, niets verwijderd. CLAUDE.md, HANDOFF, ROADMAP, VRAGEN en de mapping niet aangeraakt.

## Commits

| commit | onderwerp |
|---|---|
| b53f74d | EQ-kill: hellingen in plaats van een curve, want Chrome breekt een curve niet netjes af |
| 439aac6 | Sync op een track die remt: alleen het tempo, de rem loopt door |
| 938796c | Rem: een loopwissel tijdens het uitdoven maakt het geluid niet weer vol |

Elk met een test die op de oude code faalt (mutatieproef gedaan: 6 / 1 / 1 checks rood).

## Bevindingen

### 1. EQ-kill klikt in Chrome bij snel schakelen of een knopdraai in de 5 ms (HOOG, hersteld)

De bouwer brak een lopende `setValueCurveAtTime` af met `cancelAndHoldAtTime` en zette
daarna een nieuwe curve of `setTargetAtTime`. Dat voorkomt de NotSupportedError, maar
**Chrome 153 houdt dan niet vast: het speelt het afgekapte stuk van de curve opnieuw af
vanaf het begin** (gemeten offline met `suspend` én in een realtime AudioContext met een
opname-worklet). Kill aan en een blok (2,7 ms) later weer uit, of aan de knop draaien in die
5 ms: de band springt van −37 dB terug naar 0 dB en loopt de curve nog eens af. In amplitude
een stap van **0,55 in één sample** (met de echte `killEqBand` uit de branch, in Chrome).
De mock in engine.test was hier makkelijker dan Chrome: hij kortte de curve netjes in.

Herstel: `killEqBand` zet een beginpunt (`setValueAtTime(van, nu)`) en 32
`linearRampToValueAtTime`-punten: dezelfde S in amplitude, lineair in dB tussen de punten
(precies wat een curve ook doet). Midden in een helling houdt Chrome wél netjes vast
(gemeten). Grootste stap nu 0,007 / 0,012 / 0,017 (drie volgordes). Een helling kan ook
nooit de NotSupportedError geven. De mock telt nu een curve die midden in wordt afgebroken
(`CURVE_BREUK`, Chrome gooit niet, dus de mock ook niet); de kill-test controleert dat.
`kijk.mjs` draait de echte functies in Chrome's automatisering (OfflineAudioContext +
suspend) en eist een stap < 0,05.

Niet hersteld, buiten deze branch (MIDDEL, voor Clay/integrator): **fx.js heeft dezelfde
fout al sinds main**. `zetCurve` (kruisfade 40 ms bij een rack-/effectwissel) en `zetDoel`
(mix-knop) doen `cancelAndHoldAtTime` midden in een curve: aan de mix draaien binnen 40 ms na
een effectwissel, of twee rackwissels binnen 40 ms, geeft in Chrome een sprong in de
kruisfade. In engine.test gebeurt het 2 keer (CURVE_BREUK = 2 over de hele test, tijdelijk
geteld). De CLAUDE.md-regel "gebruik zetDoel, die breekt de curve af" klopt dus maar half:
geen fout, wel een tik. Zelfde herstel: hellingen in plaats van `setValueCurveAtTime`
(fadeCurve als reeks lineaire hellingen). Proefscripts: `scratchpad/controle/param*.mjs`,
`kill-chrome.mjs` (met `cdp.mjs`).

### 2. Sync op een remmende track hief de rem op (MIDDEL, hersteld)

Het verslag zegt "sync-tempo wordt tijdens de rem onthouden, de rem loopt door", maar
`Engine.sync` zette daarna de fase met een `seek`, en een seek start de bron opnieuw: de
track stond meteen weer op volle snelheid. Nu: remt de slave, dan alleen het tempo (geldt
na de rem), `fase: false`, reden "tempo gelijk; de fase niet tijdens het remmen". In de echte
app nagelopen (snelheid 0,958 -> 0,958, rem loopt door).

### 3. Loop aan/uit tijdens het uitdoven: het geluid werd weer vol (LAAG-MIDDEL, hersteld)

`StreamBron._remVerder` maakte een segment met T = nu en R = de snelheid die er nog over
was. `remUit` rekent het uitdoven vanaf T en R als BEGINsnelheid, dus in het laatste kwart
begon het uitdoven opnieuw: gemeten **3× harder (+9,5 dB) vlak voor stilstand** (loop aan bij
12,5% snelheid). Nu blijft het dezelfde rem (T, R, rem ongewijzigd) en schuift alleen P zo
dat de plek nu klopt; stilstand valt exact op hetzelfde moment (was: bijna), de uitvoer is
bit-gelijk aan die zonder loop. Worklet en rem-object ongewijzigd, dus gouden hash en
afvaltest raken niet. De BufferBron (reserve) heeft geen remUit en bleef zoals hij was.

### Gecontroleerd en in orde

- Positieformule met rem in hoofdthread en worklet: één `positieOp`, stilstand geklemd vóór
  het vouwen; `ctxTijdVan` met de stabiele wortel en null voorbij stilstand; loop-ronde telt.
- Afvalvrij: renderblok-test groen (gouden hash 9dfaeb73, 0 GC's ook met 323 remsegmenten).
- Rem in een loop (echte worklet, headless): positie blijft in de loop, stil en gepauzeerd
  in de loop. Rem voorbij het trackeinde: stopt op het einde (30,968/30,968), geen rem meer.
- Gat = stilte tijdens een rem: `vooruit` met |R| blijft de veilige kant.
- Tweede druk / play = los (1,39× stap, de gewone 4 ms-overgang); pauze, seek, hotcue, cue
  halen de rem eraf (in de app: hotcue tijdens de rem speelt vanaf de hotcue).
- fxKlok null tijdens de rem: gate/echo op dat deck houden hun laatste tempo; bussen en
  sampler gaan meteen naar de nieuwe maatgever.
- Video `_volg` gebruikt `deck.snelheid` (clamp 0,0625 zat er al). Beamer op integratie-r2
  leest de echte engine (same-origin), dus volgt mee zodra `_volg` samengevoegd is.
- Hysterese: puur (`volgMaatgever`), 3 dB en 250 ms op de audioklok, geen flapperen bij ±2 dB,
  opnieuw wachten onder de drempel, meteen bij stoppen/remmen. In de echte app gemeten: wissel
  na 0,259 s audioklok, gemeld zonder dat iemand vroeg.
- Kill blijft staan bij het laden van een nieuw nummer: zoals de EQ-knoppen (mixerstand, geen
  trackstand), zoals op een DJM of in Traktor. Knopstand terug na kill uit; LED 1/0/null;
  soft-takeover niet geraakt (de knop-read blijft de knopstand). 40× kill + knop door elkaar
  op een spelende track in Chrome: geen fouten. Geen auto-repeat op de remtoets.

### Klein, niet hersteld

- Tussen stilstand en de pauze-timer (5 ms + timerlatentie; in een achtergrondtab tot ~1 s)
  geldt het deck nog als remmend en spelend: rem of play dan = los = hij speelt weer. Botst
  met "een rem mag nooit iets starten" in dat venster. Lui afronden bij elke vraag (zoals
  `maatgever()`) zou het dichten.
- Nudge van 50 ms (toetsen Z/X, `track.N.nudge.*`) is een seek en haalt de rem eraf. Past bij
  "seek haalt de rem eraf", maar het is fasecorrectie (zoals sync). Keuze voor Clay.
- Speelt er verder niets, dan kan de fallback van syncMaster ("eerste geladen met grid") een
  remmende track zijn: MAAT-badge zonder "(stil)" op een track die remt.
- Bestaand: elke segmentwissel (ook het begin van de rem) vloeit equal-power over: +3 dB in
  4 ms bij gelijke signalen.
- De maatgever-timer pollt (elke ≤ 250 ms) zolang de AudioContext stilstaat en er een wissel
  wacht. Onschuldig.

## Voor de integrator

Proefsamenvoeging (`git merge-tree`) van `spoor2/dj-klank-c`:
- met **spoor2/dj-transport-c**: conflict in `src/engine/engine.js` (syncMaster, sync) en
  `src/video/video-mixer.js`. (De bouwer mat tegen dj-transport a937548; dj-transport-c heeft
  sindsdien b60e6be "wachtende track geeft de maat niet" met een eigen syncMaster.)
- met **integratie-r2**: conflict in `src/video/puls.js` en `src/video/video-mixer.js`.

Wat er moet staan na het samenvoegen:
1. `Deck.rem()`: `if (!this.buffer || !this.playing || this.wacht) return false;` — een
   wachtend deck (start op de maat) zou anders NU beginnen te spelen, remmend.
2. `Engine._kanMaat(d)`: `!!(d.buffer && d.grid && d.playing && !d.wacht && !d.remt)`.
3. `Engine.syncMaster(id)`: eerst `maatgever()` (hysterese); dan de luidste andere via
   `_kanMaat`; dan — dj-transport-c's regel behouden — de luidste WACHTENDE (`d.playing &&
   d.wacht && d.grid && !d.remt`, k !== id) "als er verder niets klinkt"; dan de eerste
   geladen met grid. Het builder-voorstel (alleen `!d.wacht` in `_kanMaat`) verliest die
   tweede stap.
4. `Engine.sync`: beide vroege returns houden: eerst `master.wacht || slave.wacht` (dj-transport),
   dan `slave.remt` (deze branch).
5. dj-transport-c's test "na zijn start geeft hij de maat wel (hardste fader)" rekent zonder
   hysterese: na de start eerst `NOW += MAAT_WACHT` (+ε) en opnieuw vragen. Dat is het
   bedoelde gedrag, geen regressie.
6. `video-mixer._volg`: `doel: Math.max(0, naVertraging(deck.position, vertraging,
   deck.snelheid ?? deck.rate))`, `rate: deck.snelheid ?? deck.rate`, `speelt: deck.playing
   && !deck.wacht`.
7. `puls.js` (integratie-r2): `klinkt` en `klokTrack` HOUDEN (maat.js en video.test gebruiken
   ze; deze branch haalde klokTrack weg). Maar `maatgever(engine, ids)` moet de maatgever van
   de ENGINE geven: `const d = engine.syncMaster?.(); return d && ids.includes(d.id) &&
   d.playing && d.grid && klinkt(d.ui.fader, engine.xfadeGain(d.id)) > 0.001 ? d.id : null;`
   (terugval op klokTrack als de engine geen syncMaster heeft). `_pulsNu` dan zoals op
   integratie-r2 (`maatgever(...)` + `hoorbaar(deck, vertraging)`).
8. `src/analysis/maat.js` (vorm-bronnen, integratie-r2): `kies()` kiest met klokTrack, zonder
   hysterese. Laat hem dezelfde engine-maatgever gebruiken, anders flappert de maatklap van de
   vormen terwijl badge, bussen en puls stil staan.
9. Handelingenlog (integratie-r2): de kill-schakelaar (`d.kill`) staat niet in de beginstand
   (`leesStand`) en `track.N.kill.*` zijn toggles: een log dat begint met een kill aan speelt
   omgekeerd terug. `kill: { ...d.kill }` in de beginstand en `setKill` bij terugspelen.
   `brake.time` is een value-action en gaat vanzelf mee.
10. Aanrader: in dj-transport-c's `StreamBron.start(…, { op })` het segment ook `rem: null`
    geven (zelfde vorm als `_segment`).
11. Toetsen botsen niet (gecontroleerd op integratie-r2, dj-transport-c, beatgrid-rest-c).

## Tests

- `nice -n 10 node test/alles.mjs`: **30 bestanden, 2017 checks, alles groen** (geen
  wankele tijdchecks deze keer).
- Headless `kijk.mjs` (poorten 8902/9502, eigen server en db, geen MIDI): alles groen, met
  de nieuwe kill-check in Chrome's automatisering.
- Eigen headless proef in de app (`scratchpad/controle/klank-app.mjs`): rem in een loop, rem
  voorbij het einde, sync en hotcue tijdens de rem, hysterese op de echte audioklok, 40× kill
  en knop door elkaar: alles groen.

## Niet getest

- Niet gehoord (geen luistertest op echte muziek, niet door Clay); niet op de APC, niet in
  Clay's Chrome/Comet (152). Chrome-gedrag gemeten op headless 153.
- BufferBron-rem alleen tegen de mock. Video tijdens een rem niet met echte video bekeken.
- De maatgever-timer in een achtergrondtab. De proefsamenvoegingen alleen als merge-tree,
  niet uitgevoerd en niet getest.

## Voorstel CLAUDE.md

Het voorstel van de bouwer (sync/maatgever, REM, EQ-KILL) klopt, met deze wijzigingen:
- In EQ-KILL: "Klikvrij: een beginpunt en 32 lineaire hellingen van 5 ms die in AMPLITUDE een
  zachte S volgen, GEEN setValueCurveAtTime (zie hieronder). Elke EQ-zet doet eerst
  cancelAndHoldAtTime."
- In REM: "Sync van een remmende track zet alleen het tempo. Een loopwissel tijdens de rem
  houdt dezelfde rem (T, R), alleen P schuift: het uitdoven loopt door."
- De bestaande bullet over setTargetAtTime/zetDoel aanvullen:
  "cancelAndHoldAtTime MIDDEN in een lopende setValueCurveAtTime gooit niet, maar Chrome
  (gemeten 153, offline en realtime) speelt het afgekapte stuk dan opnieuw af vanaf het begin
  van de curve: een sprong. Moet een overgang onderbroken kunnen worden (kill, en eigenlijk ook
  zetCurve/zetDoel in fx.js), gebruik dan lineaire hellingen: daar houdt Chrome wel vast. De
  mock telt het (CURVE_BREUK)."
