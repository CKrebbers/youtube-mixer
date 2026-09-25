# Integratie ronde 2 — 25 september 2026

Branch **`integratie-r2`** (afgetakt van `integratie-r1` e5ca616), eindcommit
**6749793**. Niet gepusht, niet naar main, `integratie-r1` niet verzet, geen
worktrees of branches weggehaald. Aan het eind `git switch --detach`.

## Commits (first-parent)

| commit | wat |
|---|---|
| 2f095d9 | merge `spoor2/renderblok-c` (geen conflict) |
| 30287ee | merge `spoor2/vorm-bronnen-c` (midi-opzet.js, tools/README.md) |
| 6660974 | merge `spoor2/beamer-c` (tools/README.md) |
| ba3f801 | merge `spoor2/handelingenlog-c` (laden.js, app.js, server.test, README) |
| a4bb1a8 | naad handelingenlog × ronde 1: toonsoort niet terugspelen, hotcues vastleggen |
| 6ec465f | naad: deck.toonsoort rekent op wat je hoort (hoorbaar.js) |
| c9180f5 | merge `spoor2/ingest-wachtrij-c` (server/index.js, library-panel.js, README) |
| 8bedfd0 | naad ingest × toonsoort: stap 'toon' in de strook, annuleren stopt hem |
| 1d1dbfc | headless: toon-keten wacht ook op 'wacht'; kijk.mjs hotcues/toon bij terugspelen |
| 83a72bc | beamer.mjs: maatbron (tel) loopt door als alleen het losse venster mengt |
| 516b49d | server.test: nieuwe routes achter Host/Origin en de JSON-regel |
| 1ec21fb | docs/TOONSOORT.md: toonsoortstap in de wachtrij |
| 6749793 | naad ingest × library: trackMetUrl met de RIJ-query (peaks) |

Merge-commits zijn na `git merge --no-edit` herschreven met een Nederlandse
boodschap + Co-Authored-By (geen `fatal: stash failed` gezien).

## Conflicten en hoe opgelost

- **midi-opzet.js** (vorm-bronnen): beide imports (`opzetMappingOpslag` van
  mapping-verschil, `uitgangsVertraging` uit hoorbaar.js).
- **tools/README.md** (vier keer): alle beschrijvingen naast elkaar; de
  handelingenlog-zin hoort achter "zegt hier niets." van kijk.mjs.
- **src/ui/app.js** (handelingenlog): `opzetLaden` krijgt `haalHotcues` (ronde 1)
  én `naLaad` (logboek).
- **src/ui/laden.js** (handelingenlog): basis = `laadLibrary()` van het
  handelingenlog (gedeeld door library en terugspelen); daarin wat ronde 1 in
  `onLaad` had: `deckTrack = null` in het gat na `laadStream`, `haalHotcues`,
  de toonsoort van de plaat, `onToon` naast `onGrid`; `losVanLibrary` wist
  `toonBewaard` én `terugspeelDecks`. Bij terugspelen GEEN `haalHotcues` (dan
  kent de hotcue-opslag het nummer niet en stuurt niets); `bewaarToon` slaat
  `terugspeelDecks` over zoals `bewaarGrid`. De toonkaart komt bij terugspelen
  wel uit de library (van de plaat, alleen om te zien).
- **test/server.test.mjs**: beide blokken (leeg mapping-verschil; UTF-8 over een
  pakketgrens).
- **server/index.js** (ingest-wachtrij): imports samengevoegd (startOpdracht,
  randomUUID, normaliseerLink vervallen); `bewaarInLibrary` van de wachtrij met
  `bewaarAutoToon` van ronde 1 erin; de achtergrondanalyse (grid + toonsoort)
  wacht op `wachtrij.open` (ook wachtende opdrachten).
- **src/ui/library-panel.js** (ingest-wachtrij): basis = het paneel van ronde 1
  (PaginaCache, virtuele lijst, sorteren, toon-kolom en kiezer). Van de
  wachtrij alleen: `IngestStrook` in de constructor (met `onNieuw: ververs()`,
  dus verversen zonder verspringen), `haalBinnen`/`uploadBestand(en)` via de
  strook, `_laadTrack` (via `cache.extra` als het nummer in geen geladen pagina
  staat), `_laadNaIngest(track, deck)`. `pollJobs`, `pollen`, `tekenJobs`,
  `opdrachten`, `uploads`, `naLaden` weg; `this.tracks = []` van de wachtrij
  NIET overgenomen (in ronde 1 is `tracks` een getter).
- actions.js, apc-beschrijf.js, keyboard.js, video-mixer.js, puls.js,
  styles.css, index.html, kijk.mjs: automatisch goed samengevoegd, nagelopen.

## Naden (geen tekstconflict) die hersteld zijn

1. **Handelingenlog × toonsoort**: `track.N.key` stond in de beginstand
   (`waarden`); terugzetten bewerkte de kaart en maakte een automatische kaart
   "met de hand". Nu in `NIET_IN_WAARDEN`. `track.N.key` en `track.N.key.*`
   staan in `OVERSLAAN`: wel vastgelegd, niet teruggespeeld (de correctie van
   toen staat al in de library; nog eens toepassen = dubbel). Tegenproef: drie
   checks rood met de oude regels.
2. **Handelingenlog × hotcues bij het nummer**: hotcues die na het laden van de
   server terugkomen gaan buiten de bus om; de replay ZETTE dan een nieuwe hotcue
   waar hij toen naar een bewaarde sprong (headless tegenproef op ba3f801:
   hotcues [0,…], positie 0 in plaats van 4). Nu vergelijkt logboek.js hotcues
   zoals rack/grid → gebeurtenis `hotcues`; terugspelen zet precies die tijden
   via `restoreHotcues` (geen 'hotcue'-melding, dus niets naar de server).
   `grid`/`hotcues`-gebeurtenissen worden op een track zonder zijn nummer van
   toen overgeslagen (anders kreeg een gewoon geladen nummer, na een mislukte
   laad, het grid van een ander nummer en bewaarde de lus dat).
   docs/HANDELINGENLOG.md bijgewerkt. Oudere terugspelers tellen `hotcues` als
   onbekend; LOG_VERSIE blijft 1.
3. **Niets naar de library bij terugspelen**: grid (bestond), toon (nieuw:
   bewaarToon slaat terugspeelDecks over), hotcues (geen haalHotcues), pads
   (bestond). Headless bewezen: hotcue 2 en `track.2.key` op een teruggespeelde
   track → server-hotcues en server-toon ongewijzigd, deck wel veranderd.
4. **hoorbaar.js × toonsoort**: `deck.toonsoort` las op de positie, terwijl
   `track.N.key.*` al op `hoorbaar()` corrigeerde. Past vanzelf: nu
   `hoorbaar(this, uitgangsVertraging(this.ctx))` (twee checks, stukgrens).
5. **Ingest-wachtrij × toonsoort**: `stappenVoor()` miste 'toon' (strook: 8
   streepjes, bij de toonsoortstap geen enkele op "nu"); nu grid → toon →
   video, label "toonsoort". De stap meldde zich met `onStap` en `maakToon`
   kreeg geen signal: annuleren rekende door. Nu `stap()` + `maakToon(audio,
   { signal })` (check: toonsoort-worker stopt in ~150 ms).
6. **Ingest-wachtrij × library (ronde 1)**: `trackMetUrl` deed `SELECT *`, maar
   `_verrijk` verwacht sinds ronde 1 de RIJ-query → "al binnen" op de link gaf
   `peaks: null` en geen racks; laden uit de strook zonder golfvorm (als het
   nummer in geen geladen pagina stond). Nu de RIJ-query (library.test).
7. **toon-keten.mjs**: las een opdracht als af zodra hij niet 'bezig' was; kan
   nu ook 'wacht' zijn.
8. **Beamer × vormen/maatbronnen**: geen herstel nodig (zelfde laag-objecten,
   de haak zit op de laag), wel gemeten in beamer.mjs: hoofdtabblad verborgen,
   tel-offset beweegt (max 0,75, 23 standen).
9. **Server-veiligheid**: alle routes achter de globale Host/Origin-controle
   en de JSON-regel (die staan vóór elke route). Nieuwe checks in server.test:
   toon, toon/analyseer, hotcues POST/DELETE, handelingen start/stuk, ingest
   POST/DELETE → 403 bij andere Origin en vreemde Host, 415 bij text/plain;
   lezen (pagina's, hotcues, toon, logs, wachtrij) met vreemde Host 403; niets
   veranderd.

## Tests

- `nice -n 10 node test/alles.mjs` op de eindstand: **36 bestanden, 2690
  checks, alles groen** (load ~3–5; ook de vormen-tijdchecks groen, twee
  volle runs). handelingenlog 113, server 98, library 151, wachtrij 71,
  toonsoort 111, renderblok 5 (gouden hash 9dfaeb73, 0 GC).

## Headless (na elkaar, VARVE_KIJK_POORT=8901, VARVE_KIJK_DEBUG=9501)

- `kijk.mjs`: alles groen (incl. 3 nieuwe checks hotcues/toon bij terugspelen).
  Tegenproef op ba3f801 (vóór de naad): 2 rood.
- `toon-keten.mjs`: 27/27.
- `library.mjs` (5002 nummers): alles groen.
- `kijk-ingest.mjs`: alles groen (twee keer, ook na de trackMetUrl-fix);
  klaar-rij toont nu 9 streepjes (toon erbij).
- `vorm-maat.mjs`: alles groen.
- `beamer.mjs` (Chrome for Testing, --headless=new, Metal): alles groen, twee
  keer (tweede keer met de maatbron-check).
- Schermafdrukken bekeken: ingest-voortgang (strook boven de lijst: DOWNLOAD
  met %, WACHT 1/2), ingest-klaar (strook + nieuwe lijst met TOON-kolom),
  keten-library (KLAAR-rijen + "8A Am", "5B E♭ +1").
  Map: scratchpad/r2-foto.

## Wat NIET getest is

- Niets in Clay's Chrome, niets op de APC, niets beluisterd; :8777 niet
  aangeraakt (na mergen server herstarten: index.js, ingest.js, library.js,
  analyze.js, links.js, handelingen.js, wachtrij.js, opname.js).
- Terugspelen van een log met ECHTE library-nummers en hotcues op Clay's
  library; alleen headless met een klikspoor.
- Hotcues-gebeurtenis: ~100 ms na het terugkomen van de server vastgelegd (de
  vergelijkingslus); een hotcue indrukken binnen die 100 ms na het laden wordt
  bij terugspelen mogelijk nog "zetten".
- De strook met een echte muis en een grote library (alleen headless, 1–2
  nummers); `_laadTrack` via `cache.extra` voor een nummer buiten de geladen
  pagina's niet headless gezien (wel de server-vorm in library.test).
- Annuleren tijdens de toonsoortstap alleen als worker-check, niet door de
  hele pijplijn met de nep-yt-dlp.
- Openstaande punten uit de controles blijven open (zombie-ffmpeg na annuleren,
  livestreams niet geweigerd, inloop met acht video's in het losse venster,
  hervat-flits van de klap, korte stilte bij start terugspelen, vormlagen niet
  in de beginstand, afvaltest-dekking van het stabiele venster).

## Voorstel CLAUDE.md (aanvulling op de voorstellen in de zes verslagen)

- HANDELINGENLOG: "Hotcues worden ook VERGELEKEN (`hotcues`-gebeurtenis): die
  van het nummer komen na het laden buiten de bus om terug. `track.N.key(.*)`
  staat niet in de beginstand en wordt niet teruggespeeld (de kaart is van de
  plaat). grid/hotcues-gebeurtenissen niet op een track zonder zijn nummer.
  Terugspelen bewaart ook geen toonsoort en geen hotcues (geen haalHotcues)."
- hoorbaar.js: ook de toonsoort (deck.toonsoort) rekent op wat je hoort.
- INGEST-WACHTRIJ: stappen … grid, toon, video; de toonsoortstap stopt op het
  signal. `trackMetUrl` gebruikt dezelfde RIJ-query als `track()`.
