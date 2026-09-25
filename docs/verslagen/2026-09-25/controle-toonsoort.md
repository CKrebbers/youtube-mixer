# Controle ROADMAP 14 (toonsoort): server × scherm — 25 september 2026

Branch `spoor2/toonsoort` (worktree agent-a8f04fae0cd813d9e) = `spoor/toon-server`
+ merge `spoor/toon-scherm` (zonder conflicten) + vier commits van de controleur.
Aan het eind `git switch --detach`; branch blijft staan.

## Commits van de controleur

| commit | wat |
|---|---|
| 91910d4 | Laden over een track wiste grid en toonsoort van het VORIGE nummer (laden.js) |
| bca7b84 | ↻ in de library doet grid én toonsoort (library-panel.js) |
| 9a2711b | tools/headless/toon-keten.mjs: de hele keten met de echte server (+ tools/README.md) |
| f8ca2ce | splits() weigert t < 0; stilte in een auto-kaart heet geen "met de hand" (+ naadtest in toonsoort.test) |

## Bevindingen

### HOOG — laden over een track wist grid én toonsoort van het vorige nummer (hersteld, 91910d4)

`onLaad` (laden.js): na `await laadStream(...)` staat het nieuwe nummer al op het
deck (`_naLaden`: `grid = null`, `toonKaart = null`), maar `deckTrack[deckId]` wees
nog naar het VORIGE nummer tot `laadPeaks` klaar was. Viel de bewaarlus
(`setInterval` 1,5 s: `bewaarGrid` + `bewaarToon`) in dat gat, dan zag hij een
deck zonder grid/kaart en postte `grid: null` en `toon: null` naar het vorige
nummer. Gevolg: slot, tap-grid en correcties met de hand weg; bij de volgende start
analyseert de achtergrond ze opnieuw als "auto" (het werk van Clay is dan kwijt).

- Kans per laad over een track met een library-nummer ≈ duur van de peaks-fetch /
  1,5 s: bij een uur audio (peaks.bin 5–6 MB) niet klein.
- Het grid-deel bestond al vóór de toonsoort; `bewaarToon` nam hetzelfde patroon over.
- Herstel: direct na een geslaagde `laadStream` `deckTrack[deckId] = null`; aan het
  eind zet de bestaande code hem op het nieuwe nummer (en gridBewaard/toonBewaard
  tegelijk). Sampler-opslag en racks lezen `deckTrack` ook; voor hen is null in dat
  gat ook juist (het deck houdt het vorige nummer niet meer).
- Bewijs: `toon-keten.mjs` vertraagt peaks.bin van het tweede nummer 2,5 s. Oude
  code: "GEWIST" (kaart en grid). Nieuwe code: slot en 2 stukken blijven, grid ook.

### MIDDEL — ↻ deed alleen het grid; geen weg terug naar de analyse (hersteld, bca7b84)

TOONSOORT.md §4/§7 en §13: ↻ = grid én toonsoort; de client roept beide routes aan.
Beide bouwers lieten dat aan de ander (de serverbouwer: "de client doet dat", de
schermbouwer: "↻ doet nog alleen het grid"). Gevolg: na één druk op kwint/maj-min
(bron 'hand') liet de achtergrond de kaart voorgoed staan, en de kiezer haalt alleen
het slot eraf. Nu: ↻ vraagt `/grid/analyseer` en `/toon/analyseer` tegelijk (elk in
een worker), zet wat bewaard is op de geladen tracks (onGrid/onToon, zonder
dubbele POST), meldt beide. Tweede klik als grid OF toonsoort op slot staat;
`forceer` geldt dan voor beide. Titel van de knop aangepast.

### LAAG — "nieuw stuk" vlak na play maakte een kaart die de server voorgoed weigert (hersteld, f8ca2ce)

`track.N.key.split` werkt op `hoorbaar()` = positie − uitgangsvertraging × rate; vlak
na play op 0 is dat negatief → stuk met `van < 0` → `normaliseerToon` → 400. laden.js
meldt een 4xx één keer en probeert DIE kaart niet opnieuw; elke volgende bewerking
van die kaart (die het stuk nog heeft) weigert ook. `splits(t)` weigert nu t < 0.
Naadtest: elke bewerking uit het menu/de kiezer door de echte `normaliseerToon` van
de server (faalde op de oude code bij precies dit geval).

### LAAG — stilte in een automatische kaart heette "met de hand gezet" (hersteld, f8ca2ce)

De server zet bij stilte `toonsoort: null, zekerheid: 0` (TOONSOORT §13); §3 zei
"null = met de hand". De client volgde §3: tooltip "geen toonsoort (met de hand
gezet)" bij stilte uit de analyse. Nu: null MET zekerheid = "stilte: de analyse vond
hier geen klank", null ZONDER zekerheid = "geen toonsoort (met de hand gezet)"
(kolomkop/focus-tooltip, library-tooltip en de stukkenlijst).

### MIDDEL — `tweede` bestaat alleen aan de client-kant (NIET hersteld)

T4(a) wil de tweede kandidaat in de tooltip ("best passend: E, of A"). De client
leest en schrijft een optioneel stukveld `tweede`; de server maakt hem niet
(`kies()` in server/toon.js heeft hem wél: `kAnder`, de beste met een ander
Camelot-getal) en `normaliseerToon` gooit hem weg. In de praktijk staat er dus
altijd alleen "best passend: E". Niet hersteld: het verandert het bewaarde formaat
(§3/§13) en de bit-gelijkheid met het meetinstrument (toon.test vergelijkt
kaartPerStuk als JSON). Voorstel: `kAnder` meegeven uit kaartPerStuk (instrument
en server gelijk houden), `tweede` in `toonKaart` en in `normaliseerToon`
(gelezen met leesToonsoort, vaste spelling). Nog vóór de eerste serverstart op
Clay's library kost het niets extra; daarna TOON_VERSIE 2 (alleen auto-kaarten
worden opnieuw gedaan, 16–70 s).

### LAAG — hetzelfde nummer op twee tracks: de tweede houdt een oude kaart (NIET hersteld)

Correctie op track A gaat naar de server; track B (zelfde nummer) houdt zijn kaart
en post hem bij zijn volgende bewerking over die van A heen. Het grid heeft
hetzelfde patroon (al vóór de toonsoort). Kan door na een geslaagde POST de kaart
op de andere tracks met dat nummer te zetten (zoals `onToon` bij de kiezer doet).

### LAAG — kolomkop 13 px hoger; onder 900 px hoogte zakt de fader verder weg (NIET hersteld)

Gemeten (headless, zonder nummers): kolom 416 → 429 px bij 1440×800 en 1366×768.
Op main valt de kolomfader daar al deels achter de sampler-rij (onderrand 777 bij
een venster van 768); met de toonsoort 790. Op 1440×900 verandert er niets (481 px,
past). Layoutkeuze, niet van dit spoor alleen.

### Geen fout gevonden (nagelopen)

- Contract: veldnamen `versie, stemming, stukken[{van, toonsoort, stemming,
  zekerheid}], bron, slot` aan beide kanten gelijk, ook de volgorde van de sleutels
  (dus `toonTekst` na laden = geen valse POST). Spelling `C Db D Eb E F F# G Ab A Bb B`
  + `m` in `SPELLING` aan beide kanten identiek; client schrijft altijd via
  `spelling()`, server leest strikter (`[A-G](#|b)?m?`) en dat volstaat.
- Null/afwezig: client laat `versie`/`stemming` weg als ze null zijn; server vult
  `stemming` (geheel = eerste stuk) en laat `versie` weg (telt als oud, maar bron
  'hand' wordt nooit geheranalyseerd). `bron` ontbreekt nooit vanuit de client.
- 400/404/415: de client stuurt altijd `{ toon }` als application/json; 4xx wordt
  één keer gemeld (meld), 5xx/netwerk volgende ronde opnieuw. Kiezer: fout → melding.
- Host/Origin/witte lijst: nieuwe routes zitten ná `vreemdVerzoek` en onder de
  JSON-regel (415 getest in server.test en toon.test); geen nieuwe statische paden.
- Zware analyse in de worker: `maakToon` → `inWerker('toon')`; op de hoofdthread
  alleen normaliseren en de logregel. `analyseerToon` dedupliceert per nummer.
- Regel 1: `src/engine/toonsoort.js` importeert niets; deck importeert alleen die;
  regels.test groen. Regel 3: `deck.toonsoort` leest `this.position`.
- Renderloop en spiegel schrijven alleen bij verandering (`tekst`/`klasse`/title-
  vergelijking); het menu leest reads alleen als het open is.
- Merge: geen conflicten; `library.test` gebruikt `SCHEMA.length` i.p.v. 5.

## De ingest.test/upload.test-rood uit de integratierun: belasting, geen fout

- Hier (load 13–16 op 8 kernen) beide groen, los en in alles.mjs.
- Gemeten per stap (20 s audio, upload-pad): meten 1,14 s, normaliseren 1,64 s,
  peaks 0,15, onset 0,22, grid 0,23, **toon 0,29 s** van 3,66 s totaal. upload.test
  wacht 60 s op de ingest; de toonsoort kost daar ~8%.
- Het patroon van 7 FAIL's in ingest.test past precies bij "de hele ingest mislukte
  vóór de grid-stap" (lukt, stap grid, grid auto, zekerheid, 124 bpm, toon,
  klikspoor; daarna TypeError op r.track). De toon-stap komt ná het grid en kan de
  ingest niet laten mislukken: `inWerker` resolvet altijd, en `!tk.ok` → toon null.
  Dus: yt-dlp/ffmpeg onder zware belasting (yt-dlp metadata heeft 90 s time-out),
  niet de nieuwe stap. Geen testwijziging.

## Wat getest is

- Gericht: toon.test, toonsoort.test (+5 naadchecks), ingest.test, upload.test,
  gridauto.test, regels.test — groen.
- `tools/headless/toon.mjs` (nep-library): 29/29.
- `tools/headless/toon-keten.mjs` (echte server, poorten 8861/9461): 22/22 na de
  herstellen, 15/22 ervoor. Keten: 2 nummers via /api/upload → ingest (C 0,73 |
  E♭ 0,67 vanaf 65 s; Am) → /api/library → library-kolom "5B E♭ +1" → laden →
  kolomkop/focus "5B E♭" / "5B · Es majeur" → kwint + → server: C (zekerheid
  behouden) | B♭ (zonder zekerheid), bron hand, 1 POST → bevestigen: slot → ander
  nummer over dezelfde track laden (peaks traag): vorige blijft → pagina herladen →
  library op slot, kolomkop "6B B♭" → ↻ twee klikken → auto C | E♭, track toont het.
- Schermafdrukken bekeken: toon-scherm/-kiezer/-menu (nep), keten-herladen,
  keten-library-na, en 1440×800 met/zonder toonsoort.
- Volledig: `nice -n 10 node test/alles.mjs` op f8ca2ce: 31 bestanden, 2111 checks,
  alles groen (ingest 19,6 s, upload 12,5 s, gridauto 14,4 s). Daarna toon.mjs
  opnieuw: 29/29.

## Wat NIET getest is

- Niets in echte Chrome, niets op de APC, niets beluisterd.
- Clay's database: migratie naar toon_json en de eerste achtergrondanalyse over
  zijn library niet gedraaid (server op :8777 niet aangeraakt). Na samenvoegen:
  server herstarten; de achtergrond doet dan alle nummers zonder toonsoort.
- Samenvoegen met `spoor2/library`: die voegt ook een SCHEMA-element toe
  (hotcues-tabel, titel_sleutel, indexen) en herschrijft /api/library (pagina's,
  sorteren) en library-panel.js. Conflicten te verwachten in SCHEMA (volgorde =
  versienummers; zolang Clay's db op v5 staat maakt de volgorde niet uit),
  `.lib-rij` grid-template-columns en `tekenRijen` (toon-kolom + kiezer).
- Encoder op `track.N.key` met echte MIDI; tooltips zoals Chrome ze toont.

## Voorstel CLAUDE.md (kort)

Onder "Toonsoort en keylock":
- GEBOUWD 25 sep (ROADMAP 14): server/toon.js (worker-taak 'toon', ingest-stap na
  het grid, achtergrond per nummer grid dan toon, TOON_VERSIE voor heranalyse van
  alleen auto-kaarten), kolom toon_json, routes GET/POST /api/library/<id>/toon
  (`{ toon }`, zonder `toon` = 400, niet wissen) en /toon/analyseer. Client:
  src/engine/toonsoort.js (puur), deck.toonKaart/keylock/transpositie + getter
  `toonsoort`, actions track.N.key.* (geen APC-knoppen, T6), laden.js bewaart
  om de 1,5 s. ↻ in de library = grid én toonsoort.
- null in een AUTO-kaart = stilte (met zekerheid 0); met de hand = geen zekerheid.
- De bewaarlus mag nooit een deck zien dat al een nieuw nummer heeft terwijl
  deckTrack nog het vorige noemt: onLaad zet deckTrack op null zodra laadStream
  slaagt (anders gaat grid/toon: null naar het vorige nummer).
- Alles wat de browser post moet door `normaliseerToon`; toonsoort.test loopt elke
  bewerking daar doorheen. Headless: tools/headless/toon-keten.mjs (echte server).
