# De Controlekamer (2 oktober 2026)

Clay: "maak 1 plek waar de hele controle room samen komt". Dit is die plek:
`http://localhost:8777/controle` (`controle.html`). Begin een sessie hier, niet in
de mixer.

## Wat erop staat

1. **Stand**, zes tegels met een lampje:
   - **Server** draait, met het aantal nummers in de library.
   - **Binnenhalen**: yt-dlp en ffmpeg (`/api/tooling`).
   - **Ingest-rij**: hoeveel er bezig is en wacht (`/api/ingest`).
   - **Mixer**: open of niet, uit de Web Lock `varve-mixer` (`src/ui/tabblad.js`).
     Rood als er een tweede mixer-tabblad wacht.
   - **Audio** en **APC40**: uit wat de mixer zelf meldt (zie hieronder). Bij de
     APC staat de echo-teller (ROADMAP 2: is hij na een sessie 0, dan mag het
     echofilter voor de APC uit).
   - Daaronder: wat er in de mixer staat (track, bpm, toonsoort, MAAT, auto, opname).
2. **Openen**: de knop "mixer openen" staat uit zolang er al een mixer open is.
   Zo komen er nooit twee tabbladen op de APC (Chrome-MIDI kan daar van crashen).
   Planvenster en los venster open je vanuit de mixer: die hebben de mixer als
   `opener` nodig.
3. **Speellijst**: de punten van een proefsessie (`src/controle/speellijst.js`).
   Per punt ok, fout of overslaan (nog eens klikken = terug naar open) en een
   notitie. "Nieuwe ronde" (twee keer klikken) zet de sessie in
   `proef/archief/<tijd>.json` en begint leeg.

## Hoe het werkt

- **De Controlekamer opent GEEN MIDI.** De APC heeft maar één client: de mixer.
- **De mixer meldt zich** (`src/ui/status-zender.js`): elke seconde een bericht
  op het BroadcastChannel `varve-status` met audio, MIDI-status (invoer, echo's,
  verkeerde poort), geladen tracks, focus, maat, auto en opname. Alleen het
  tabblad met de Web Lock meldt. Op de achtergrond knijpt Chrome timers, daarom
  vraagt de Controlekamer elke 2 s `{ vraag: 'status' }`: daar antwoordt de mixer
  meteen op. Ouder dan 5 s = "wacht op melding".
- **De speellijst op de server** (`server/proef.js`):
  - `GET /api/proef` → `{ begonnen, items: { <id>: { status, notitie, tijd } } }`
  - `PUT /api/proef/<id>` `{ status, notitie }` → één punt; `open` zonder notitie haalt het weg
  - `POST /api/proef/nieuw` `{}` → archiveren en leeg (JSON, zoals elke POST)
  - Bestand: `proef/sessie.json` (`VARVE_PROEF` om te verleggen). Niet via de
    witte lijst te lezen, alleen via de API. Per punt opslaan en na elkaar
    schrijven: twee tabbladen overschrijven elkaar niet.
- **Claude leest na een sessie** `proef/sessie.json` (fout + notitie = eerst repareren).

## Een punt toevoegen of veranderen

In `src/controle/speellijst.js`. Verander geen bestaande `id`: de stand op de
server hangt eraan. `test/controle.test.mjs` controleert dat ids uniek zijn en
op de server passen.

## Getest

- `test/controle.test.mjs`: opslag (fouten, gelijktijdig, kapot bestand,
  archief), de speellijst, het bericht van de mixer.
- `test/server.test.mjs`: de routes, de witte lijst, 415 zonder JSON.
- `tools/headless/controle.mjs`: Controlekamer en een echte mixer in twee
  tabbladen van één headless Chromium. Mixer open/dicht, een tweede mixer, de
  knop, de demotrack in "in de mixer", afvinken en notities na herladen.
- NIET getest: met de echte APC (de headless mixer heeft geen MIDI), en op de
  Mac in Clay's Chrome.
