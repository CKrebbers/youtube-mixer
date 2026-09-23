# Overdracht — waar we staan (23 september 2026, avond)

Lees in deze volgorde: `CLAUDE.md` (architectuur, regels, valkuilen), dan dit
bestand, dan `docs/VERBETERINGEN.md` (rondes 1–3), `docs/VRAGEN.md` (open
vragen voor Clay) en `docs/APC40.md` (de indeling zoals gebouwd).

## Nieuw (24 september 2026): eigen bestanden, TikTok, staande video

Nog NIET gecommit (de hoofdsessie reviewt). Server moet HERSTART worden
(nieuwe route `/api/upload`, `server/links.js`, nieuwe ingest).

- **Eigen bestanden**: knop "bestand…" in de library (meerdere tegelijk) en
  bestanden slepen op het library-paneel → upload (gestreamd, grens 8 GB,
  `VARVE_UPLOAD_MAX`) → ffprobe → dezelfde pijplijn als een link. Id
  `lokaal-<hash>`: hetzelfde bestand twee keer = hetzelfde nummer. Slepen op
  een baan/kolom/focusdeck: audio speelt direct zoals altijd, een VIDEO (of
  audio die de browser niet leest, bv. aiff) gaat via de library en komt
  daarna op die track, met een melding dat het even duurt. Speelt die track
  tegen die tijd, dan laadt hij niet (melding: laad hem via de lijst).
- **TikTok**: werkt zonder extra software, want `curl_cffi` 0.13.0 is er (yt-dlp
  imiteert daarmee Chrome). Proef op Clay's link (lennonstella, "no surprises -
  Radiohead"): metadata ok, volledige ingest naar een tijdelijke map in 57 s,
  video 720×1280, grid 86,2 bpm (onzeker). Links zonder `?is_copy_url…` en met
  `www.`; korte links (vm./vt./`/t/`) volgt yt-dlp zelf (niet gemeten).
  Beeldformaat nu `-S res:720` — met het oude `[height<=720]` kwam er bij
  staande TikToks geen video (hun formaten zijn 576×1024 en hoger).
- **Library-label** per nummer: YT / TikTok / bestand / web.
- **Staande video**: elke laag houdt zijn beeldverhouding; knop "passend/vullen"
  in het videopaneel (`video.fit`, te koppelen). Randen zijn doorzichtig.
- Tests: `node test/alles.mjs` → 23 bestanden, alles groen (nieuw:
  `bronnen.test.mjs`, `upload.test.mjs`, beeldverhouding in `video.test.mjs`).

### Wat hiervan NIET getest is
- Niets in de browser (geen Chrome gebruikt, APC hing eraan): de knop
  "bestand…", slepen op het paneel en op een track, de uploadbalk (XHR-voortgang),
  het laden na de ingest, de labels, de knop passend/vullen.
- De meng-shader zelf: de rekenregel is getest in JS (`leesLaag`), de GLSL niet
  in een echte WebGL-context. Eerste keer kijken: staande TikTok naast een
  liggende YouTube, beide modi, en het losse venster.
- Echte grote bestanden (GB's) van Clay, mkv/mov van een telefoon (rotatie),
  mp3 met hoesje uit de praktijk; de upload-grens is getest met 768 MB.
- TikTok-korte links, TikTok-video's met inlogplicht of regioblokkade (de
  meldingen daarvoor zijn alleen op tekst getest).
- YouTube met `-S res:720`: niet opnieuw tegen YouTube gedraaid (hoort dezelfde
  720p te kiezen als `[height<=720]`, want res = de kleinste kant).

## Stand (einde sessie 23 september 2026, ~23:45)

- Alles is gecommit behalve `Input/` (Clay's nieuwe map, zie `docs/INPUT.md`) en deze
  laatste docs/tools-bijwerking. Laatste codecommit `1196c2b` (beatgrid C + D).
- Tests: `node test/alles.mjs` → 21 bestanden, 1398 checks, alles groen.
- Server draait met de nieuwe code (herstart ~23:05). Database: schema v5 (grid als
  tempokaart). Kopieën van vóór de migraties staan in je thuismap:
  `~/.varve-library-voor-v4.db`, `~/.varve-library-voor-v5.db`,
  `~/.varve-library-voor-heranalyse.db`; mapping van vóór het samenvoegen:
  `~/.varve-mapping-voor-samenvoegen.json`.
- Na elke serverwijziging herstarten (`pkill -f "node server/index.js"` en opnieuw).

### Wat deze sessie bouwde (in volgorde; commitberichten zijn precies)
1. Alle open werk gecommit in tien stukken; vragen C1–C6, D1–D5, E1–E3 met Clay doorlopen
   en gebouwd (pitchbereik, pitch op 0 bij laden, crossfaderkant, nummer = focus, echo op de
   maat, pads bewaren, pads volgen de maat, drukknoppen, één afspeelmotor, panelen,
   app.js opgesplitst, action-namen Engels, mapping op de server).
2. APC: mode 0x42 (gemeten), mapjes/shift, daarna na onderzoek (`docs/APC40-onderzoek.md`)
   herzien naar "controller eerst": één kolom = één track, strip rechts, grid-modi op de
   scene-knoppen. Hoofdscherm spiegelt de APC. Interactieve APC-kaart `apc.html`.
3. Vijf reviewagenten → `docs/VERBETERINGEN.md`; ronde 1 (live-fouten, server-lek, analyse
   in een worker, opname-integriteit) en ronde 2 (scherm, lampjes B2/B4, endless-knoppen,
   één tabblad op de APC) gebouwd.
4. Beatgrid (`docs/BEATGRID.md`): A tikken betrouwbaar (91% goed, 0% offbeat), B tempokaart
   in stukken (schema v5), C automatisch bij binnenhalen met zekerheid per stuk + strook +
   heranalyse op de achtergrond, D grid-modus op de APC (Shift + Metronome).
5. Clay's eigen mapping (4 knoppen: rack-knoppen 5–8 = video-effecten) samengevoegd met
   de nieuwe standaard (291 regels) — de bewaarde volledige kopie hield de grid-modus buiten
   beeld. Structurele oplossing staat in ronde 3 ("mapping als verschil bewaren").

### Uitkomst heranalyse van Clay's 4 nummers (23:05)
Album: 7 stukken 150/140/150, 0 zeker · Sakamoto: 45 stukken, 3 zeker · Bay Ledges:
6 stukken 153–160 (één op 76 = octaaffout), 0 zeker · zoned out: geen puls. Bijna alles
onzeker = eerlijk; sync/beatloops weigeren daar tot Clay tikt (≥ 4 tikken = slot).

## Chrome-crash van 20:27 — en de regel die eruit volgt

Chrome crashte om 20:27 in `MidiService_TaskService_Thread`, op dezelfde plek
als de vier crashes van 22 september. Vermoedelijke oorzaak: vier
VARVE-tabbladen tegelijk (twee testtabbladen van de sessie, een agent-tabblad
en dat van Clay) die allemaal init en LED's naar de APC stuurden.
Maatregel (`c2d580f`): `src/ui/tabblad.js`, Web Lock `varve-mixer`. Een tweede
tabblad vraagt geen MIDI-toegang aan (`midi-opzet.js` wrapt `midi.init`) en
neemt pas over als het eerste sluit.

**REGEL:** open NOOIT een extra VARVE-tabblad terwijl de APC aangesloten is en
Clay's tabblad open staat. Vraag Clay eerst de APC los te koppelen, of test met
zijn toestemming in zijn tabblad. Let op: `apc.html` leest de APC zelf mee
(zonder sysex, stuurt niets) en valt buiten de lock.

## Wat NIET getest is

- De hele beatgrid-UI in de browser en op de APC: zekerheidsstrook, onset-streepjes,
  "?" bij de bpm, library-kolommen en ↻, grid-modus (Shift + Metronome) met de
  witte scene-LED's en het blijvende balkje.
- Visueel na ronde 2: het scherm op 1440×900 en 1920×1080.
- De APC opnieuw aansluiten in echte Chrome (init en LED's na hotplug).
- Op het apparaat: knipperen op de tel, endless-ringknoppen, drie LED-standen, A|B-kleuren.
- Echofilter voor de APC staat nog aan; na een sessie `hub.status().echoes` bekijken.
- RF64-opname afspelen in de browser; video-opname (geluid, 30 fps).
- Uit eerdere rondes: luistertest streamen/loops/seek (VRAGEN A2), keylock-demo (A3),
  sends en sampler op het gehoor.

## Bekende valkuilen bij testen in Chrome (via de extensie)

- Testtabbladen staan in een venster achter dat van Clay: `document.visibilityState`
  is dan `hidden`. Gevolg: geen requestAnimationFrame, AudioContext blijft
  `suspended`, timers op 1 Hz, en Chrome laadt/decodeert geen video.
  → Logica testen met OfflineAudioContext of door functies direct aan te roepen;
  een screenshot haalt het tabblad heel even naar voren.
- Een nep-video voor de videomixer: een canvas met readyState/currentTime/play/pause
  erop geplakt. Testbeelden ASYMMETRISCH maken (vier kwarten).
- Meet een beat-puls nooit precies óp de tel (afronding valt op de vorige tel).
- Clay speelt soms tegelijk in zijn eigen tabblad. Een eigen testtabblad mag
  ALLEEN als de APC niet aangesloten is (zie de regel hierboven); ruim
  testracks/opnames in zijn library weer op.

## Volgende stap

1. Clay test in zijn EIGEN tabblad (http://localhost:8777; open er zelf geen extra):
   een nummer laden, 4× Tap, grid-modus proberen, `apc.html` ernaast ("live meekijken"
   pas na een klik). Wat niet klopt eerst repareren.
2. `docs/INPUT.md` met Clay doornemen: wat wil hij met `Input/` (oude fase-1-zip,
   av-kern, blueprint)? Beslissen of `Input/` in git hoort.
3. Beatgrid-restpunten: het 156-bpm-stuk van het album valt weg in `segmenteer`
   (minSec); na "tel 1 hier" eventueel `/grid/verfijn` met `anker` aanroepen voor de
   laatste ms; `barPhase` heeft geen maat-anker per stuk.
4. Ronde 3 uit `docs/VERBETERINGEN.md`, punt voor punt met Clay kiezen (functies, geen
   reparaties: niets bouwen zonder zijn ja). Hoogste waarde volgens de reviews: eigen
   mapping als VERSCHIL bewaren (anders bevriest elke nieuwe standaard), library voorbij
   200 nummers + hotcues per nummer, video mengen in het losse venster (beamer bevriest nu
   als het hoofdtabblad wegvalt), renderBlok zonder allocaties (8 decks tegelijk).
5. Open vraag F1: koptelefoon-cue vraagt een tweede audio-uitgang.
