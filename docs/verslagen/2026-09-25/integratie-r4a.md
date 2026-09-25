# Integratie ronde 4a: 25 september 2026

Branch **`integratie-r4a`**, afgetakt van `integratie-r3` (711a866, niet verzet).
Eindcommit **35ddad1**. Worktree `agent-a57704608e0f617a2`, aan het eind
`git switch --detach`. Niet gepusht, niet naar main. Geen worktrees of branches
weggehaald.

## Commits (first-parent)

| commit | wat |
|---|---|
| 25646f7 | merge `spoor3/vormen-tijd`, geen conflict |
| 8f7d03b | merge `spoor3/toon-tweede`, geen conflict |
| 15c403a | merge `spoor3/ingest-rest-2`, geen conflict |
| 0484fe4 | merge `spoor3/transport-rest`: conflict in stream-kern.js, plus de naad play.quant × rem |
| 506536d | merge `spoor3/fx-hellingen`: conflict in de imports van deck.js |
| 35ddad1 | kijk.mjs: nieuwe check dat de Q bij Lock de mapping volgt, plus tools/README |

Elke merge is gedaan met `git merge --no-edit`. Daarna kreeg de commit een
Nederlandse boodschap met Co-Authored-By (`commit --amend -F`, bij een conflict
`commit -F`). Geen `fatal: stash failed` gezien. Er is niets met " 2" in de naam
gecommit: `git ls-files` en de diff van r3 naar HEAD zijn nagelopen, en de werkmap
is schoon. `git add` alleen per pad.

## Conflicten

1. **transport-rest: `src/engine/stream-kern.js`, `ctxTijdVan`.**
   - r3 (dj-klank-c) bracht daar het rempad in: de wortelformule en `snelheidOp`.
   - transport-rest rekent tijdens het wachten vanaf `max(nu, T)`.
   - Beide gehouden. `const vanaf = Math.max(nu, seg.T)` geldt nu voor het gewone pad én
     voor het rempad: positie, snelheid, `s === 0` en de uitkomst gaan allemaal vanaf
     `vanaf`.
   - Een gepland segment krijgt `rem: null` (aanrader 10 uit r3). Tijdens een rem is
     `vanaf` dus gewoon `nu`. Dat staat in het commentaar.
   - Het commentaar van beide kanten is samengevoegd.
2. **fx-hellingen: `src/engine/deck.js`, de imports.**
   - `hoorbaar.js` (r3) en `overgang.js` (fx-hellingen): allebei gehouden, zoals de
     controleur voorspelde.

## Naden

- **vormen-tijd tegenover de vormtests uit spoor2/vormen.**
  - De merge-base van vormen-tijd is precies de tip van spoor2/vormen (a8424dd). In r3
    kwam daarna niets meer aan de vier vormtests.
  - De omzetters en de samenvoeger zitten dus al in de basis van vormen-tijd.
  - Alle tijdmetingen gebruiken `draadMs()` (`process.threadCpuUsage`).
    `performance.now` staat er alleen nog in de console-informatieregel van isomorf
    (geen check).
  - De diff r3..merge verandert geen enkele `ok(`-regel: er is geen check kwijt.
- **toon-tweede tegenover de toon-kolom en toon-keten.mjs.**
  - De kolom in `library-lijst.js` maakt zijn tooltip met `libraryToon()`, en die
    noemt de tweede nu via `hoofd().tweede`. Er hoefde niets aangepast te worden.
  - toon-keten.mjs voegde schoon samen en haalt 33/33.
- **ingest-rest-2 tegenover rondes 1–3.**
  - In analyze.js start alleen `startFfmpeg()` nog een ffmpeg, ook voor de toonsoort
    (`leesPcm`).
  - De ingest geeft `maakToon` het signal mee, dus een geannuleerde toon-stap ruimt zijn
    ffmpeg op.
  - `STAP_NAAM` kent `toon: 'toonsoort'`.
  - De laden.js-regel `library.strook.meldBuiten = (tekst) => meld(tekst, 'fout')` staat
    na de LibraryPanel-constructor van r2/r3.
  - `meld()` geeft het element terug, dus `_buiten.remove()` werkt. `--warn` bestaat.
  - kijk-ingest.mjs is groen, met het herstartdeel.
- **transport-rest: de Q bij Lock tegenover de spiegel.**
  - De logica staat erin: in `herbereken()` wordt `quantizeEl.classList.toggle('hidden',
    lock?.r?.action === 'transport.quantize')` gezet. Hij luistert naar mapping-change,
    shift en lagen-change.
  - In de huidige mapping heeft Lock (`note:0:63`) alleen een regel in `edit.aan`
    (`grid.lock`). Buiten de grid-modus doet Lock dus niets, en de Q staat er.
  - **Nieuw in kijk.mjs** (6 checks, onafhankelijk van wat de standaardmapping met Lock doet):
    - Q zichtbaar ⇔ Lock is geen quantize;
    - Lock tijdelijk op `transport.quantize` → de Q is weg;
    - in de grid-modus is Lock `track.1.grid.lock` → de Q is terug;
    - de regel teruggezet → dezelfde stand als eerst.
  - **Tegenproef:** zonder de hidden-regel precies 1 FAIL ("de Q is weg").
  - Daarmee is ronde 4b gedekt: als Lock daar quantize wordt, moet de check blijven
    kloppen.
- **transport-rest × rem (nieuw gevonden).**
  - `track.N.play.quant` op een spelende track deed `d.pause()`. Tijdens een rem is
    `playing` true, dus shift+Q zette een remmende track meteen stil.
  - "Zoals play" betekent tijdens een rem echter LOS (`togglePlay` → `laatRemLos`).
  - Nu: `if (d.playing) { d.togglePlay(); return; }`. Dat geeft: speelt → pauze,
    wacht → annuleren (zoals eerst), remt → los.
  - engine.test heeft er een check bij: "play.quant tijdens het remmen: ook los, zoals
    play".
  - Keuze, niet gevraagd. Wil Clay pauze tijdens een rem, dan is het één regel terug.
- **fx-hellingen tegenover hoorbaar.js, de handelingenlog-beginstand met kill en de rem.**
  - In `src/` staat geen `setValueCurveAtTime` en geen `zetCurve` meer.
  - engine.js en de sampler halen `startDrempel` via fx.js, die hem doorgeeft.
  - Terugspelen met kill aan gaat via dezelfde `_pasKillToe` → `killEqBand(..., startDrempel)`.
  - De check "geen afgebroken curve in de hele test" staat onderaan engine.test, dus
    ná de blokken van transport, rem, hysterese en handelingenlog-kill: groen.
  - handelingenlog.test is groen (121).
  - kijk.mjs, met een echte InsertSlot en de nagebootste voorloop:
    - effectwissel 0,0021 / 0,0017 / 0,0017;
    - voorloop: fade 0,0008 (op nu 0,195), kill 0,0068 (op nu 1,000);
    - app-kill 0,63 → 0,00 → 0,65;
    - kill-automatisering 0,007 / 0,012 / 0,017.

## Tests

- `nice -n 10 node test/alles.mjs` (eindstand zonder de kijk-commit, die raakt geen
  Node-test): **36 bestanden, 3242 checks, alles groen**. Load 3–7, dus rustig.
- Daarom ook apart onder kunstmatige belasting: `scratchpad/bouw/last.mjs`,
  16 reken- en 8 geheugenlussen, load opgelopen tot ~60.
  - vormen, vormen-zwaar, vormen-meer en vormen-isomorf: alle vier groen.
  - Slechtste max per stap: ln 8,1 ms, gs 7,6 ms, cl 6,4 ms (drempel 16).
  - Uitvoer in `scratchpad/r4a/last-*.txt`.
- Aantallen per bestand:
  - engine 613 (r3: 588; transport-rest en fx-hellingen erbij, +1 van mij);
  - toon 51, toonsoort 117;
  - wachtrij 100, wachtrij-server 44;
  - spiegel 48.

## Headless

Na elkaar, poorten 8941/9541, uitvoer in `scratchpad/r4a/uit`:

| script | checks | tijd | load |
|---|---|---|---|
| kijk.mjs | 75 ok | – | 43 bij de start, dalend |
| toon-keten.mjs | 33/33 | 45 s | – |
| library.mjs | 56 | 17 s | – |
| kijk-ingest.mjs | 35, ook "server herstart" | 21 s | – |
| vorm-maat.mjs | 24 | 21 s | – |
| vormen-plaat.mjs | 26 × 16:9, 0 leeg, 0 fout | 35 s | – |
| beamer.mjs | 39, sync en opname ook groen | 53 s | ~7 |

Alles groen, in één keer.

## Niet getest

- Niets in Clay's Chrome, niets op de APC, niets beluisterd. :8777 niet aangeraakt.
- **Na het mergen de server op :8777 herstarten.** Veranderd zijn index.js, analyze.js,
  analyse-werker.js, ingest.js, toon.js en library.js.
- play.quant tijdens een rem alleen in de mock (engine.test), niet in Chrome.
- De combinatie ctxTijdVan + rem + gepland segment bestaat niet: een gepland segment
  heeft geen rem. Die combinatie is daarom niet apart getest.
- Het contactblad van vormen-plaat niet met het oog bekeken (26 × 16:9, 0 fout).
- Belasting tijdens de headless-runs was laag tot matig. Onder zware last viel eerder
  beamer.mjs op sync en opname (r3). Dat is hier niet opnieuw geprobeerd.

## Voorstel CLAUDE.md (aanvulling op de voorstellen in de vijf verslagen)

- play.quant (shift+Q/P) op een spelende track = togglePlay: speelt → pauze, wacht →
  annuleren, remt → los (zoals play).
- ctxTijdVan rekent vanaf max(nu, T), ook in het rempad.
