# Hoek: prestaties en opstart (13 okt 2026, tak studio/afmaken, niets gewijzigd)

Gemeten in deze container (4 kernen, Linux, Node 22.22, chrome-headless-shell 155 met swiftshader),
eigen servers op 8892 (repo zoals hij is) en 8893 (kopie in scratchpad met één proefregel), eigen
tijdelijke media/library. **Let op:** de container werd gedeeld met andere workflows (load 10–25 op
4 kernen tijdens de metingen). Absolute ms zijn dus pessimistisch tegenover de M1/Air; de
VERSCHILLEN tussen scenario's in dezelfde run zijn wat telt. Scripts staan naast dit bestand
(`cdp.mjs`, `opstart-mixer.mjs`, `rust.mjs`, `laad.mjs`, `acht.mjs`, `taint.mjs`, `stappen.mjs`).

Testmateriaal: 8 nummers van 150 s met video 1280×720/30 (ffmpeg testsrc2 + synthetische beat,
via `/api/upload`, echte ingest), één album van 30 min (alleen audio), stems via de nep-splitter
(2 stems → `stems.wav` 4 kanalen).

## Wat ik mat (kort)

| wat | uitkomst |
|---|---|
| server opstarten tot eerste antwoord | 556–623 ms (lege library). `controleerTooling()` (yt-dlp/ffmpeg/ffprobe `--version` + PyPI met 5 s time-out) zit vóór `server.listen` (server/index.js:1885–1908, ingest.js:193) |
| mixer openen (localhost) | 0,65–1,2 s tot engine+library+spiegel; 138 verzoeken (119 ES-modules, 1,66 MB bron, 2,4 MB over de lijn, geen compressie, `no-store`); bij 30 ms RTT 1,5 s, bij 80 ms 2,5 s |
| mixer in rust, niets geladen, audio uit | 135–154 ms/s hoofdthread (script ~97 ms/s), 60 rAF/s; top: `spiegel.teken` 11–14 ms/s, `actions.read` 10 ms/s; 132–147 verzoeken/min (`/api/mixer` 60/min, `/api/ingest` 51/min zolang er iets in de rij staat, patronen 21/min) |
| 8 nummers geladen, stil, audio aan | 194 ms/s hoofdthread |
| 8 nummers spelen (geen video) | 448 ms/s (stijl 75 + layout 49 ms/s), rAF zakte naar 15/s (headless+swiftshader+load; niet 1-op-1 naar de Mac) |
| een nummer laden (150 s, 2 stems) | `library.laad` 613 ms: eerst kop + 15 pagina's (7,5 MB) via 2 Range-verzoeken, dán peaks, dán racks/samples/hotcues/onsets/secties/tellen parallel |
| album van 30 min laden | 1,7 s (peaks.bin 2,6 MB pas ná de stream) |
| secties bij de EERSTE laad (`?maak=1`) | 3,1 s (150 s) en **15,1 s** (30 min); daarna 6 ms. Niet in de ingest (server/index.js:853–871, alleen vanuit de GET en de opstart-heranalyse) |
| ingest van 150 s met video | 54–107 s; bij nr2 (107 s) **video 80 s** (x264 veryfast crf 20); meten 8 s, normaliseren 12 s, peaks+onset+grid+toon 7 s. Los: x264 veryfast 14,4 s voor 30 s video, `-c:v copy` 0,15 s |
| 30 min album ingest | 316 s in de rij (normaliseren 2 passes, onset 12 s, grid 2 s, toon 8 s) |
| **8 decks spelen + videopaneel open, 6–8 video's zichtbaar** | zie kans 1: audio-verzoeken wachten tot **24,5 s** op een verbinding, gaten tot 17 s per deck |

## Kans 1 — Video naar een eigen host: anders verdringen zes video's de audio (stilte live)

**Probleem.** De server praat HTTP/1.1; Chrome geeft per host hooguit 6 verbindingen. Elke
`<video>` (preload `auto`, `src/video/video-mixer.js:458`) houdt tijdens het bufferen een
verbinding vast (buffer liep tot 66–119 s vooruit). De StreamBron haalt zijn pagina's over
dezelfde host (`src/engine/bron.js:626`, `fetch` met Range). Met 6 zichtbare video's wacht de
audio op een vrije verbinding.

**Bewijs (acht.mjs, 8 decks spelen, 30 sprongen om de 1,5 s, zelfde run):**

| zichtbare video's | sprong → pagina p50 / p90 | audio-verzoek wacht vóór verzenden p90 / max | gat per deck (45 s) |
|---|---|---|---|
| geen video | 237 / 576 ms | 30 / 150 ms | 80–420 ms |
| 3 | 428 / 888 ms | 87 / 439 ms | 90–1150 ms |
| 4 (4 decks) | 323 / 621 ms | 49 / 134 ms | 480–720 ms |
| 5 | 678 / 1579 ms | 474 / 3133 ms | 350–2490 ms |
| **6** | 1117 / ≥5000 ms | **17 225 / 24 117 ms** | **4,8–17,5 s** |
| 8 | 851 / ≥5000 ms | 18 020 / 24 544 ms | 4,5–17,4 s |
| 8, audio `priority:'high'` | 704 / ≥5000 ms | 5 861 / 10 597 ms | 1,3–7,8 s |
| **8, video via 127.0.0.1 (kopie-server met CORS)** | **388 / 719 ms** | **74 / 270 ms** | **260–660 ms** |

De knik tussen 5 en 6 is precies de verbindingslimiet. Met de video op een andere host is het
gedrag gelijk aan "geen video". Proef `taint.mjs`: de video van 127.0.0.1 met `crossOrigin =
'anonymous'` en `Access-Control-Allow-Origin` speelt (readyState 4) en `texImage2D` geeft geen
SecurityError (WebGL blijft schoon, dus ook opname en captureStream).

**Wanneer Clay het raakt:** zes of meer tracks met video zichtbaar in het paneel (fader ×
crossfader > 0), of vermoedelijk al eerder met het losse venster erbij (dat heeft EIGEN
`<video>`'s op dezelfde host; met 4 decks + beamer zag ik geen ramp, maar zijn verzoeken heb ik
niet apart gezien — te bevestigen met `tools/headless/beamer.mjs`). De 20 s vooruit van de
StreamBron vangt een korte verdringing op; een sprong (hotcue, sectie, auto-DJ) niet, en bij
6+ video's ook het gewone doorspelen niet meer.

**Toepassen (½–1 dag):**
1. `server/index.js` `statisch()` (r. 991): alleen voor `/^\/media\/[\w-]+\/video\.mp4$/`
   `Cross-Origin-Resource-Policy: cross-origin`, `Access-Control-Allow-Origin` = de Origin als
   die van ons is (localhost/127.0.0.1 met eigen poort, of VARVE_HOSTS), plus `Vary: Origin`.
   Andere bestanden houden `same-origin`.
2. Een pure helper (bv. `src/video/video-host.js`): `videoUrl(pad, location)` = de ANDERE
   loopback-naam (localhost ↔ 127.0.0.1, zelfde poort); op https (Tailscale, HTTP/2, één
   verbinding met multiplexing — aanname, te controleren) gewoon same-origin.
3. `video-mixer.js` `zetBron` en de video's in `src/video/beamer-venster.js`: `crossOrigin =
   'anonymous'` vóór `src`. Bij een `error` op de vreemde host één keer terugvallen op
   same-origin (dan in elk geval beeld).
4. Goedkoop erbij: `priority: 'high'` in de standaard-`haal` van de StreamBron (bron.js:436);
   gemeten: halveert de ergste wachttijd, lost het niet op.
5. Toetsen: server.test (koppen alleen op video.mp4), een kleine test voor de helper, en
   `acht.mjs` als `tools/headless/acht-video.mjs` met een eis (8 zichtbaar: wacht p90 < 300 ms,
   geen gat > 1 s). Plus `kijk.mjs`/`beamer.mjs` opnieuw (beeld niet zwart, kwarten goed).
6. Wat er nog ontbreekt om dit live te ZIEN: de worklet telt geen gaten. Een teller per deck
   (frames zonder pagina) in een SharedArrayBuffer (COOP/COEP staan er al voor, AUDIOPAD.md
   "Wat blijft") kost niets op het audiopad en kan in de Controlekamer/avondpakket staan.

**Risico:** de pagina krijgt haar eerste cross-origin verwijzing (CLAUDE.md "COOP/COEP"): een
fout in de koppen = zwart beeld of een vergiftigd canvas (WebGL gooit dan). Web Lock en MIDI
veranderen niet (de pagina blijft op dezelfde oorsprong). Met de terugval en de headless toets
klein.

## Kans 2 — Speelstand voor de server: zwaar achtergrondwerk niet tijdens een set

**Probleem.** De server weet al of er gespeeld wordt (`speeltDeck()`: Range op audio/stems.wav
in de laatste 30 s, server/index.js:176–178), maar alleen de nachtwachtrij en het avondpakket
kijken ernaar. Wat er WEL doorloopt tijdens het spelen:
- de heranalyse 5 s na het opstarten (grid, toon, secties van alles wat oud is;
  server/index.js:893–940) — na een `SECTIE_VERSIE`/`TOON_VERSIE`-verhoging de hele library;
- de tellen (Beat This!, GPU) 60 s na het opstarten voor alles zonder tellen
  (server/index.js:562–575; BEATGRID.md: ~1,5 s GPU per minuut muziek → bij ~300 nummers van
  5 min ruim een half uur GPU, net als de set begint);
- de stems-rij na elke ingest en na een herstart (`herstelStemsRij`), wel met `nice` maar op
  dezelfde GPU als het videomengen in Chrome;
- de ingest zelf: ffmpeg normaliseren en x264 op normale prioriteit, alle kernen (geen `nice`,
  geen `-threads` in server/ingest.js; alleen stems.js en tellen.js gebruiken `nice`).

**Bewijs:** de code hierboven; x264 deed in deze container 0,48× realtime en trok de load
omhoog; Clay mat zelf op 5 okt dat Demucs op de helft liep zolang VARVE ~29 Mpx/s tekende (ze
delen de machine dus echt); de MacBook Air heeft geen ventilator: aanhoudend 100% = na een
paar minuten throttling voor ALLES, ook audio en beeld (de warmtemeting `tools/headless/warmte.swift`
en BE11 bestaan al). Niet gemeten op de Air zelf: hoeveel het de audio/het beeld echt raakt.

**Toepassen (½–1 dag):**
1. Eén functie `rustig()` in server/index.js = `!speeltDeck()`; heranalyse, `tellenOpAchtergrond`
   en de AUTOMATISCHE stems (na ingest, na herstart) wachten erop zoals ze nu op `wachtrij.open`
   wachten (`geenIngest`). Wat Clay zelf vraagt (STEMS-rij `vooraan`, ↻) gaat gewoon door.
2. Ingest-ffmpeg via `nice -n 10` en, zolang `speeltDeck()`, `-threads 2` (de rij is één
   tegelijk, dus nooit meer dan twee kernen naast een set).
3. In de Controlekamer/het avondpakket: "achtergrondwerk wacht (er speelt een deck)" —
   `achtergrondMeting` heeft de velden al.
4. Toets in de stijl van nacht.test (nep-klok, nep-deck): niets start terwijl er gestreamd wordt,
   wel binnen 30 s na het laatste verzoek.

**Risico:** een nummer dat tijdens de set binnenkomt krijgt zijn stems/tellen pas na de set
(bewust; het grid van de oude analyse en de secties zijn er wel, zie kans 4). Laag.

## Kans 3 — De videostap van de ingest: kopiëren als het kan, anders de hardware

**Probleem.** `cfrTranscode` (server/ingest.js:382–400) codeert ELKE video opnieuw met libx264
veryfast crf 20. Dat is driekwart van een ingest met beeld, en het draait op de CPU.

**Bewijs:** nr2 (150 s): meten 8 s, normaliseren 12 s, analyse 7 s, **video 80 s** (nr1: 54 s in
totaal, bij minder load). Los op 30 s video: x264 veryfast 14,4 s, `-c:v copy` 0,15 s (~100×).
De keyframe-afstand blijft gelijk: x264's standaard keyint 250 = 8,3 s op 30 fps, precies wat
CLAUDE.md van YouTube beschrijft. Clay's eigen meting: TikTok van 79 s, ingest 57 s.

**Toepassen (½ dag + meten op de Mac):**
1. Na de download `ffprobe`: is het H.264, yuv420p, korte kant ≤ 720, en constante framerate
   (`r_frame_rate` = `avg_frame_rate`, ≈ 30 of 25)? Dan `-c:v copy` (plus `-movflags +faststart`).
2. Anders op macOS `h264_videotoolbox` (`-b:v 4M`, hardware, nauwelijks CPU), en pas als die
   ontbreekt of faalt libx264 zoals nu.
3. `VIDEO_FORMAAT` (ingest.js:418): `-S res:720,vcodec:h264` laat yt-dlp avc1 kiezen als die er
   is (YouTube heeft 720p avc1 voor bijna alles), zodat stap 1 meestal raakt. Bijwerking: de
   M1 decodeert AV1 niet in hardware; avc1 is voor acht lagen tegelijk ook bij het afspelen beter.
4. Meten met `tools/headless/kijk-ingest.mjs` op drie echte nummers: tijd, en of de video in de
   pas blijft met de audio (`video.test`/`beamer.mjs`).

**Risico:** variabele framerate of rare tijdstempels in een "kopie" (dan volgt de video slechter).
De ffprobe-poort en de terugval vangen dat; in twijfel transcoderen zoals nu.

## Kans 4 — Secties (en de rest) klaar bij het binnenhalen, laden niet meer in serie

**Probleem.** Secties worden pas uitgerekend bij de eerste laad (`GET …/secties?maak=1`), en na
stems nog een keer (`moetSecties`: stems erbij). De opstart-heranalyse vangt alleen wat er bij het
opstarten al lag. Een nummer dat Clay tijdens of vlak voor de set binnenhaalt heeft dus geen secties
als hij het laadt: grid-modus SECTIES, de sampler-secties, de auto-DJ (`vindSectie`) en het accent
op de video/hub wachten. Daarnaast laadt `laadLibrary` in serie: eerst kop + 15 pagina's
(`bijvullen` voor de terugkeer uit `laad`, bron.js:598; 7,5 MB met 2 stems, ~15 MB met 4), dán
peaks, dán de rest (src/ui/laden.js:349–420).

**Bewijs:** secties 3,1 s (150 s) en 15,1 s (30 min) bij de eerste laad, 6 ms daarna; laden 613 ms
(150 s) en 1,7 s (30 min), waarvan peaks.bin pas start na de 7,5 MB audio (laad.mjs).

**Toepassen (½ dag):**
1. In de ingest, na grid en toon (en in de stems-rij na een geslaagde split): `analyseerSecties(id)`
   op de achtergrond aanroepen (bestaat al, één tegelijk per nummer via `sectiesBezig`; met de
   speelstand van kans 2 respecteren).
2. `laadLibrary`: peaks, onsets, secties en racks starten zodra `track` bekend is (ze hangen niet
   van de audio af), en `StreamBron.laad` laten terugkeren zodra de pagina('s) van de startpositie
   er zijn; de rest vult de timer van 100 ms vanzelf bij. De bestaande `nogDeLaatste`-controles
   blijven nodig voor alles wat daarna iets zet.
3. Toetsen: secties.test (de kaart staat er na de ingest), server.test; laad.mjs als meting.

**Risico:** laag. Let op de volgorde-regel van CLAUDE.md (deckTrack null tot alles staat) en op
`haalSecties` die nu op `mijnLaad` controleert.

## Kans 5 — De renderloop in rust trager (accu, warmte, ruimte voor Demucs)

**Probleem.** Eén rAF voor de hele UI (src/ui/renderloop.js:107–125) leest elk frame alle knoppen,
faders en spiegel-items via `read()` en `engine.snapshot()`, ook als er niets speelt en niemand iets
aanraakt. Het schrijven is al gedift (alleen wat verandert), het LEZEN niet.

**Bewijs (rust.mjs):** leeg, audio uit: 135–154 ms/s hoofdthread, 60 rAF/s; met 8 nummers geladen en
stil 194 ms/s; top `spiegel.teken` (spiegel.js:274) 11–17 ms/s en `actions.read` (actions.js:159)
10–12 ms/s. Op de M1 is dat naar schatting een derde (dus ~4–6% van een kern in rust), maar het loopt
de hele avond, ook tussen twee sets, en op een externe 120 Hz-monitor het dubbele.

**Toepassen (1 dag):**
1. Een "rust"-stand in renderloop.js: speelt er niets, wacht er niets op de maat, geen MIDI/muis/
   toets in de laatste 2 s en geen open paneel dat animeert → tekenen op ~10 Hz (setTimeout +
   rAF), meteen terug naar 60 Hz bij een `change` van de engine, een MIDI-bericht (`geraakt` uit
   midi-opzet.js) of een pointer-event.
2. LED's lopen al op hun eigen `setInterval`, dus de APC merkt niets.
3. Meten met `tools/headless/tekenen.mjs` (meet al ms/s hoofdthread) vóór en na, en eis in rust
   < 25% van nu.

**Risico:** een stand die op het scherm 100 ms later verandert terwijl niets speelt (bv. een
knop die van buiten verandert via de hub). Elke bron van buiten moet de loop wakker maken; vergeet
je er één, dan loopt het scherm 0,1 s achter, niet meer.

## Kleiner (niet als kans uitgewerkt)

- **Server luistert pas na de tooling-check.** `await controleerTooling()` (yt-dlp, ffmpeg, ffprobe,
  en een PyPI-fetch met 5 s time-out) gaat vóór `server.listen` (index.js:1885). Hier 0,6 s; op
  een zaal-wifi met een hangende DNS tot +5 s voor de eerste pagina. Oplossing: eerst luisteren,
  dan controleren (het resultaat wordt alleen gelogd). Minuten werk.
- **Mixer openen** is lokaal snel genoeg (0,7 s). Via Tailscale (iPad als hele mixer) kost elke
  watervalstap een RTT: 2,5 s bij 80 ms. Pas de moeite waard als de iPad meer gaat doen
  (werkruimte-workflow); dan helpt HTTP/2 van `tailscale serve` waarschijnlijk al vanzelf.
- **Peilen in rust:** 132–147 verzoeken/min (`/api/mixer` elke s, `/api/ingest` elke ~1,2 s zolang er
  iets in de rij staat). Lokaal goedkoop; geen kans.
- **Audiopad:** al gedaan en goed gedocumenteerd (AUDIOPAD.md: 57,5 ms CPU per s audio voor 8 decks,
  0 GC). Niets nieuws gevonden.

## Samenhang met de andere workflows

- Controller-lag: kans 5 raakt de renderloop, niet de LED-`setInterval` of de MIDI-invoer;
  kans 2 (minder CPU/GPU-concurrentie) helpt hun lag-metingen stabieler te maken.
- Beatgrid: kans 2 gaat over WANNEER de tellen/heranalyse draaien, niet hoe.
- Werkruimte (iPad als extra scherm): kans 1 is relevant als de iPad video toont (dan over Tailscale,
  same-origin); de kleine noot over de modulewaterval ook.
