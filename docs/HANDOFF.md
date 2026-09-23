# Overdracht — waar we staan (23 september 2026, avond)

Lees in deze volgorde: `CLAUDE.md` (architectuur, regels, valkuilen), dan dit
bestand, dan `docs/VERBETERINGEN.md` (rondes 1–3), `docs/VRAGEN.md` (open
vragen voor Clay) en `docs/APC40.md` (de indeling zoals gebouwd).

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
