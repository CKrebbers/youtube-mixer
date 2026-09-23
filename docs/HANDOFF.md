# Overdracht — waar we staan (23 september 2026, avond)

Lees in deze volgorde: `CLAUDE.md` (architectuur, regels, valkuilen), dan dit
bestand, dan `docs/VERBETERINGEN.md` (rondes 1–3), `docs/VRAGEN.md` (open
vragen voor Clay) en `docs/APC40.md` (de indeling zoals gebouwd).

## Stand

- Alles is gecommit; laatste commit `c2d580f` (scherm op een laptop, één
  tabblad op de APC). Alleen deze docs-bijwerking staat nog open.
- Vandaag gebouwd: het hoofdscherm spiegelt de APC (`119d4df`, `c2d580f`),
  interactieve APC-kaart `apc.html` (`a96a596`), APC-indeling herzien na
  onderzoek (`53e8551`, `docs/APC40-onderzoek.md`), mode 0x42 (`08e9a86`),
  mapjes en shift (`ed0540a`), spiegel-CSS hersteld met een test (`9afd29c`).
  Verbeterronde 1 (`7555b8a` controllaag, `0b28833` opname, `d509ed3` engine,
  `d2f6844` server) en ronde 2 (`5e297f4` APC-lampjes, `c2d580f` scherm) uit
  `docs/VERBETERINGEN.md`.
- Tests: `node test/alles.mjs` → 19 bestanden, 1125 checks, alles groen.
- Server: `node server/index.js` (poort 8777). Na elke serverwijziging
  herstarten (`pkill -f "node server/index.js"` en opnieuw), anders draait de
  oude code: de witte lijst, Host/Origin-controle en de analyse-worker van
  `d2f6844` zitten pas na een herstart in de lucht. Opstarten duurt ~2 s.

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

- Visueel na ronde 2: het scherm op 1440×900 en op 1920×1080 (de
  laptop-indeling is gebouwd op een meting, niet daarna opnieuw bekeken).
- De APC opnieuw aansluiten in echte Chrome (init en LED's na hotplug; de
  hubfix is alleen in een nagebouwde hub bewezen).
- Op het apparaat: knipperen op de tel (loop-pads, Track Select van de
  maatgever), de endless-ringknoppen, de drie LED-standen en de A|B-kleuren.
- Echofilter voor de APC: staat nog aan; na een sessie `hub.status().echoes`
  bekijken — nog 0, dan mag hij uit.
- Een RF64-opname (> 6,2 uur) afspelen in de browser (ffmpeg leest hem wel).
- Video-opname: geluidsspoor en vloeiende 30 fps (alleen in een zichtbaar venster).
- Uit eerdere rondes nog open: luistertest streamen/loops/seek (VRAGEN A2),
  keylock-demo (A3), sends en sampler op het gehoor.

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

1. Clay test op de APC, in zijn eigen tabblad (zie de regel hierboven): de
   indeling (`apc.html` ernaast), lampjes, knipperen, ringknoppen, opnieuw
   aansluiten. Wat niet klopt eerst repareren.
2. Daarna ronde 3 uit `docs/VERBETERINGEN.md`, punt voor punt met Clay
   kiezen — dat zijn functies, geen reparaties, dus niets bouwen zonder zijn ja.
