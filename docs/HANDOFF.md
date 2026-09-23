# Overdracht — waar we staan (23 september 2026, einde sessie)

Lees in deze volgorde: `CLAUDE.md` (architectuur, regels, valkuilen — ook de
sectie "Verbeterronde 23 september"), dan dit bestand, dan `docs/VRAGEN.md`
(de open vragen voor Clay, één voor één afwerken), dan `docs/APC40.md`.

## Stand

- Alles is gecommit (23 september 2026) in tien commits: server · klikvrij
  transport · engine-correctheid · opnemer · sends · sampler · APC-actions ·
  interface · tests · docs. Elke commit apart getest.
- Tests: `node test/alles.mjs` → 16 bestanden, 792 checks, alles groen.
- Server: `node server/index.js` (poort 8777). Draait al op de achtergrond;
  na serverwijzigingen herstarten (`pkill -f "node server/index.js"` en opnieuw).
  Opstarten duurt ~2 s (tooling-check).
- De app laadt in Chrome zonder consolefouten (laatst gecontroleerd na alle wijzigingen).

## Hoofdscherm = spiegel van de APC (23 september 2026, NIET gecommit)

- Nieuw: `src/ui/spiegel-plan.js` (puur), `src/ui/spiegel.js`, `test/spiegel.test.mjs`.
  Herschreven: `index.html` (main), `vensters.js`, `renderloop.js`, `racks.js`
  (rack-rij volgt focus), CSS. De twee vensters, de mixerstrook en de trackrij
  zijn weg; zie CLAUDE.md "Het scherm spiegelt de APC40 mkII".
- Getest in Chrome (eigen tabblad, master op 0): kolommen, actions uit de
  mapping, mapjes, shift, focuswissel, strip/rack, oplichten, panelen,
  sneltoetsen, koppelmodus. Niet getest: de APC zelf aanraken (oplichten
  alleen gesimuleerd), bestanden slepen op banen/kolommen, schermen smaller
  dan ~1500 px.

## Wat NIET getest is (vraagt Clay)

- Luisteren: streamen, loops, seek/hotcue na de declick-wijzigingen (VRAGEN A2).
- Keylock-demo (VRAGEN A3).
- Alles met de APC (VRAGEN B): eerst de modus/kanalen controleren.
- Video-opname: geluidsspoor en vloeiende 30 fps (alleen in een zichtbaar venster te zien).
- Sends (echo-out) en sampler op het gehoor.

## Bekende valkuilen bij testen in Chrome (via de extensie)

- Testtabbladen staan in een venster achter dat van Clay: `document.visibilityState`
  is dan `hidden`. Gevolg: geen requestAnimationFrame, AudioContext blijft
  `suspended`, timers op 1 Hz, en Chrome laadt/decodeert geen video.
  → Logica testen met OfflineAudioContext of door functies direct aan te roepen;
  een screenshot haalt het tabblad heel even naar voren.
- Een nep-video voor de videomixer: een canvas met readyState/currentTime/play/pause
  erop geplakt. Testbeelden ASYMMETRISCH maken (vier kwarten).
- Meet een beat-puls nooit precies óp de tel (afronding valt op de vorige tel).
- Clay speelt soms tegelijk in zijn eigen tabblad: open voor tests altijd een
  EIGEN tabblad, en ruim testracks/opnames in zijn library weer op.

## Volgende stap

Clay vroeg: "alle vragen in kaart brengen zodat we die een voor een op de
juiste manier kunnen behandelen" en "grote stappen maken". Begin met
`docs/VRAGEN.md` A1 (committen) en loop de lijst af. E1 (app.js opsplitsen,
± 1100 regels) mag zonder hem, maar pas na de commit.
