# tools/

Hulpmiddelen voor ontwikkelen en meten. Niets hiervan draait in de app.

## beatmeting/
Metingen van het beatgrid op Clay's ECHTE library (docs/BEATGRID.md). Lezen alleen
`media/<id>/onset.bin` en `audio.wav` en de library via de draaiende server
(`http://localhost:8777/api/library`); schrijven niets in media/ of de database.
Draai met `node tools/beatmeting/<script>.mjs` vanuit de projectmap.

| script | wat |
|---|---|
| lib.mjs | gedeeld: library ophalen, onset laden, pasmaten; importeert server/detect.js |
| overzicht.mjs | tempo over de hele track, curve, segmenten, verfijning op 5 plekken |
| gridfit.mjs, fasespoor.mjs `<id> <bpm> <firstBeat>` | klopt een grid, per venster, tegen een nul |
| puls.mjs | is er een puls, en voorspelt de zekerheid dat |
| regio.mjs | verfijnen en fase-spoor in één gebied |
| tap-sim.mjs | tikken simuleren (40 proeven per plek) — de cijfers in BEATGRID.md |
| tijd.mjs | rekentijd en bit-vergelijking met onset.bin |
| offset-synth.mjs, offset-check.mjs | fase-afwijking van de onset-ijking |
| stapA/sim.mjs e.a. | de metingen vóór/na stap A (tap 53% → 91% goed, 0% offbeat) |
De *.txt-bestanden zijn de uitkomsten van 23 september 2026, ter vergelijking.

## git/
- `test-index.sh` — test precies wat er in de git-index staat (niet de werkmap): pakt de
  index uit in een tijdelijke map en draait daar alle tests. Handig bij het splitsen van
  werk in meerdere commits.
- `hunks.py` — `list <bestand>` toont de hunks van een bestand; `stage <bestand> '[0,2]'`
  zet alleen die hunks klaar; `strip <bestand> 'a-b,c-d'` zet de werkversie min die regels klaar.
