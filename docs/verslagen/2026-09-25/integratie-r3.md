# Integratie ronde 3 — 25 september 2026

Branch **`integratie-r3`** (afgetakt van `integratie-r2` 6749793), eindcommit
**711a866**. Niet gepusht, niet naar main, `integratie-r2` niet verzet, geen
worktrees of branches weggehaald. Aan het eind `git switch --detach`.

## Commits (first-parent)

| commit | wat |
|---|---|
| 23d2d07 | merge `spoor2/beatgrid-rest-c` (conflict: laden.js) |
| 273557a | merge `spoor2/vormen` (conflicten: tools/README.md, tools/headless/kijk.mjs) |
| 8f7ac85 | merge `spoor2/dj-transport-c` (actions.js, beatgrid.js, deck.js, video-mixer.js, beatgrid.test, engine.test) + naden |
| f08633b | merge `spoor2/dj-klank-c` (engine.js, apc-beschrijf.js, puls.js, video-mixer.js) + naden |
| f80319e | naad: hoorbaar.js kent wachten op de maat en remmen |
| 450eaed | naad: handelingenlog — kill, quantize, beatjump-lengte, wachten in de beginstand |
| 4ef04f8 | vorm-maat.mjs: maatlezers met de engine-maatgever, wissel na MAAT_WACHT |
| 711a866 | engine.test: hotcue-opslag bewaart met quantize de gesnapte tijd |

Geen `fatal: stash failed` gezien. Merges met `--no-edit` en daarna een
Nederlandse boodschap met Co-Authored-By (via `git commit -F`).

## Conflicten en hoe opgelost

1. **beatgrid-rest-c × laden.js**: basis = `laadLibrary()` van ronde 2 (gat met
   `deckTrack = null` na laadStream, hotcues via `haalHotcues`, toonsoort,
   `naLaad`, terugspelen). Daarin de ene regel van beatgrid-rest:
   `gridBewaard = JSON.stringify(engine.deck(id).grid?.toJSON() ?? null)` (wat
   de ENGINE ervan maakte, met `maat` per stuk). Laden schrijft dus niets; de
   bewaarlus slaat terugspeelDecks sowieso over.
2. **vormen × tools/**: README krijgt `vormen-plaat.mjs` naast de proeven van
   ronde 1/2; kijk.mjs houdt het handelingenlog-blok en krijgt de twee
   oriëntatiechecks (16:9-laag, vierkante laag).
3. **dj-transport-c**:
   - actions.js: beide imports (`SPRONG_TELLEN`, hoorbaar.js). `track.N.barbeat`
     is null zolang een track wacht (net als phase/beat).
   - beatgrid.js: `telInMaat`/`isMaatbegin` én `verschuif`/`metFaseVan`/
     `volgendeVeelvoud`. **volgendeVeelvoud telt nu vanaf de "1" van het stuk**
     (maat-anker): play.quant valt op het maatbegin dat golfvorm en lampjes
     tonen. Oude grids (zonder `maat`) = zelfde uitkomst als vroeger.
   - deck.js `hotcue()`: snippet uit controle-dj-transport.md (`_snap` bij
     zetten, `_naarHotcue` bij springen, 'hotcue'-melding NA het zetten →
     gesnapte tijd), `restoreHotcues` en de del-tak van library blijven.
   - video-mixer.js: `_pulsNu` via `maatgever()` (puls.js), `_volg` met
     `naVertraging` en `speelt && !wacht`.
   - tests: beide blokken. engine.test: track 8 is sinds de hotcue-test van
     ronde 1 geladen; de lege-track-check van transport maakt hem eerst leeg
     (`dM.bron.vernietig()`, de load erna zet alles terug).
4. **dj-klank-c**:
   - engine.js `syncMaster`: `maatgever()` (hysterese) → luidste andere via
     `_kanMaat` → luidste WACHTENDE als er verder niets klinkt (dj-transport) →
     eerste geladen met grid. `_kanMaat = buffer && grid && playing && !wacht
     && !remt`. `sync()`: eerst de wacht-return, dan de rem-return.
   - apc-beschrijf.js: kill/rem-regels + de "tel 1 hier"-tekst van beatgrid-rest.
   - puls.js: `klinkt` en `klokTrack` blijven; `maatgever()` = engine.syncMaster()
     als je hem hoort (speelt, !wacht, !remt, grid, klinkt() > 0,001);
     klokTrack alleen als terugval zonder engine.
   - video-mixer.js: `_volg` doel `naVertraging(pos, v, deck.snelheid ?? deck.rate)`,
     rate `deck.snelheid ?? deck.rate`, `speelt && !wacht`.

## Naden hersteld (verplichte lijst)

- `Deck.rem()`: `if (!this.buffer || !this.playing || this.wacht) return false;` ✔
- `_kanMaat(d)` met `!d.wacht && !d.remt` ✔; syncMaster houdt hysterese én
  de wachtende-stap ✔.
- klokTrack: bleef bestaan. `puls.maatgever()` en `MaatLezer.kies()` (via de
  nieuwe optie `maatgever` en `engineMaatLezer(engine, ids, vertraging)` in
  vorm-paneel.js) gebruiken de ENGINE-maatgever. Puls, vormen, MAAT-badge,
  sync, sampler en bussen volgen dezelfde track; "een track die je niet hoort
  geeft geen tel" blijft. analyse.test: badge/vorm/puls wisselen SAMEN (pas na
  3 dB en 250 ms); faalt met de oude klokTrack-keuze (mutatie gedaan: 2 rood).
  MaatLezer telt een wachtende track niet als "speelde" (starten, geen overnemen).
  Paneeltekst noemt "wacht op de maat" / "remt".
- hoorbaar.js blijft de enige formule: nu ook `!wacht` (positie zelf) en
  tijdens een rem `deck.snelheid`. `naVertraging` nam rate 0 als "geen rate"
  (→ 1): aan het eind van een rem viel wat je hoort een hele uitgangsvertraging
  vóór de stilstand. Nu is 0 echt (4 checks).
- `_volg` (ook het losse venster: zelfde klasse, `neemOver` zet de engine):
  snelheid + naVertraging + `speelt && !wacht` (video.test: rem → playbackRate
  0,5, wacht → gepauzeerd).
- transport-test "na zijn start geeft hij de maat": eerst H (hysterese), na
  `MAAT_WACHT + 0,01` F.
- hotcue: gesnapte tijd naar de server — deck-check (melding) én opslag-check
  met nagebouwde server (1,37 → 1,5 s).
- play.quant op het maat-anker (volgendeVeelvoud; beatgrid.test: tel 20 → 22
  = 10,9 s bij een eigen "1", eerste stuk doorgeteld). Docstring van
  startOpDeMaat aangepast.
- Handelingenlog: per track `kill` (schakelaars), `sprong`, `wacht` (speelt
  false; terugspelen start hem opnieuw op de maat nadat de rest speelt);
  `transport.quantize` als RONDLOPER; remtijd zit als value-action in `waarden`.
  Ouder log zonder kill/quantize → uit. NUMMER_NODIG + `beatjump.(back|fwd)`
  en `brake`. Bewust niet: lopende rem, loop-in-punt, vorige loop.
  handelingenlog.test +8 (o.a. een log dat met kill aan begint en hem uitzet:
  na terugspelen UIT, niet omgekeerd). docs/HANDELINGENLOG.md bijgewerkt.
  Terugspelen schrijft niets naar de library (ongewijzigd; kijk.mjs groen).
- Beamer: het losse venster neemt de lagen over (dezelfde objecten, maat per
  beeld uit `maatVan`), 640 × 360 werkt vanzelf; beamer.mjs groen (zie onder),
  schermafdruk: Lorenz rond in het midden over de vier kwarten.
- Laden bewaart het grid niet meer × laden.js: zie conflict 1.
- actions/apc-beschrijf/keyboard/feedback/index.html: additief. 40 toetsen,
  geen dubbele. index.html: MAAT-uitleg noemt starten op de maat en vormen.
- Aanrader 10 (dj-klank): gepland segment krijgt `rem: null` ✔.

## Tests

- Run 1 (load 55–150): 36 bestanden, 3164 checks, 1 rood: vormen-isomorf
  "sn/tv max < 16 ms per stap" (tijd). Los opnieuw: groen.
- Run 2 (eindstand 711a866, load 80–300): 3 rood: server.test (ECONNREFUSED:
  eigen server niet op tijd op), vormen-isomorf (4× max < 16 ms), vormen-meer
  (6× max < 16 ms, "if 0,25 goedkoper"). Alle drie los opnieuw: groen
  (server 98, isomorf 118, meer 114). Checks niet aangepast.
- Run 3 (eindstand, load 13–80): **36 bestanden, 3165 checks, 1 rood**:
  vormen-isomorf "tv/ep/dw max < 16 ms per stap" (tijd). Los opnieuw (load
  11): groen, 118. Alles buiten de vormen-tijdchecks groen.
- iCloud-conflictkopieën (" 2" in de naam): `git ls-files` en de diff
  integratie-r2..HEAD bevatten er geen; de werkmap ook niet. Bij twee
  merge-commits (8f7ac85, f08633b) is `git add -A` gebruikt; nagelopen: er
  kwam niets extra's mee (59 bestanden, allemaal uit de sporen of naden).
- Per bestand op de eindstand: engine 588, stream 111, renderblok 6 (gouden
  hash ongewijzigd, 0 GC), handelingenlog 121, analyse 119, video 101,
  beatgrid 143, detect 98, library 155, server 98.

## Headless (na elkaar, VARVE_KIJK_POORT=8921, VARVE_KIJK_DEBUG=9521)

- kijk.mjs: alles groen (67 checks; Worker-bitmaps 640 × 360, 16:9- en
  vierkante laag rechtop, kill 0,62 → 0,00 → 0,66, rem, handelingenlog,
  hotcues/toon bij terugspelen).
- vormen-plaat.mjs: 26 × 16:9, 0 fout; contactblad bekeken
  (scratchpad/r3/plaat/plaat.png): geen uitrekken, hg/fy gebruiken de breedte.
- toon-keten.mjs 27/27 · library.mjs groen (56) · kijk-ingest.mjs groen (25).
- vorm-maat.mjs: groen (met nieuwe check: wissel na 256/264 ms = MAAT_WACHT).
  Eén run faalde op "de tel duwt knop 1 via de haak" (afwijking 2,4e-2 tussen
  de paneellezer en een eigen lezer): de paneellezer wordt ook door de
  animatielus bemonsterd (extra punten → hogere staart); bestond al, volgende
  run 0,0. Niet aangepast.
- beamer.mjs: groen twee keer (load 10–12). Twee eerdere runs (load 28–55)
  rood op sync (−17,5 ms) en "in de opname loopt het beeld door" (1,25 en
  4,5 s stil). Dezelfde proef op de code van integratie-r2 (git archive,
  VARVE_WORTEL) was in dat venster groen; daarna r3 twee keer groen. Ik houd
  het op belasting, maar een iets zwaardere r3 (16:9-laag) sluit ik niet uit.
  Opname nu ~3,5 MB tegen ~8 MB op r2: de lz-laag is kleiner (16:9 in plaats
  van 2,5× opgeschaald), dus minder beeldinhoud.
- Controleproeven (kopie in scratchpad/r3, poorten via env):
  kijk-transport.mjs (dj-transport-c) groen: klikvrij beatjump/loop in-out/
  reloop, maatgever +3% tijdens wachten (12,8 µs na T1), pauze en laden tijdens
  wachten. klank-app.mjs (dj-klank-c) groen: rem in loop, rem tot trackeinde,
  sync/hotcue tijdens rem, hysterese op de echte audioklok (wissel na 0,256 s),
  40× kill.

## Wat NIET getest is

- Niets in Clay's Chrome, niets op de APC, niets beluisterd; :8777 niet
  aangeraakt. Na mergen server herstarten (detect.js, library.js).
- ↻ op het album (tweede kans + eenGridPast op de echte library).
- play.quant op een grid met een eigen "1" in een LATER stuk alleen in de
  unittest, niet in de browser; niet met Clay's grids.
- Terugspelen met kill/quantize/wacht alleen tegen de Web Audio-mock
  (handelingenlog.test), niet in kijk.mjs.
- Hysterese × vormen alleen headless met twee demotracks en de crossfader.
- Het losse venster tijdens een rem of een wachtende track (alleen de
  rekenregel in video.test).
- Openstaand uit de controles (niet in deze ronde): fx.js zetCurve/zetDoel
  breekt een curve af zoals kill deed (spoor3/fx-hellingen); beatjump vooruit
  voorbij het einde stopt de track; quantize heeft geen zichtbare stand;
  shift+Q op een spelende track doet niets; nudge haalt de rem eraf; tussen
  stilstand en pauzetimer telt een track nog als remmend; eenGridPast alleen
  voor de tweede kans; ½ op tel 2/4 schuift de "1".

## Voorstel CLAUDE.md (aanvulling op de voorstellen in de vier verslagen)

- Maatgever: puls.js `maatgever()` en de vormen (`engineMaatLezer`) volgen
  `engine.syncMaster()` met hysterese, maar geven alleen een tel als je de track
  hoort (speelt, wacht niet, remt niet, klinkt). klokTrack alleen nog zonder
  engine.
- syncMaster: maatgever → luidste andere (_kanMaat: !wacht, !remt) → luidste
  wachtende als er verder niets klinkt → eerste geladen met grid.
- hoorbaar.js: wacht = positie zelf; rem = snelheid van nu; rate 0 is echt.
- play.quant/volgendeVeelvoud tellen vanaf de "1" van het stuk (maat-anker).
- HANDELINGENLOG: stand per track `kill`, `sprong`, `wacht`; quantize als
  rondloper; ouder log = kill en quantize uit; NUMMER_NODIG ook beatjump en rem.
