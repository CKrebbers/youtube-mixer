# VARVE DJ — fase 1: audio-engine + 2 decks

Fundament van de DJ-app. Geen build-stap, geen dependencies: plain ES-modules.

## Starten

Klik op **VARVE** in het Dock (of open `~/Applications/VARVE.app`). Draait de server nog
niet, dan start de app hem vanuit de Bureaublad-map (poort 8777) en wacht tot hij antwoordt.
Daarna haalt hij de Controlekamer (**http://localhost:8777/controle**) in Chrome naar voren,
of opent hem. Begin daar; *mixer openen* opent de mixer. De bron van de app staat in
`tools/varve-app/` (opnieuw bouwen: `zsh tools/varve-app/maak.sh`).

Terugval, met de hand:

```bash
cd ~/Desktop/"1. Projects/Youtube mixer" && node server/index.js
```

en open **http://localhost:8777/controle** in **Chrome** (Web MIDI werkt niet in Safari).

Het log: wat de app start, schrijft naar `~/.varve-server.log` (meekijken:
`tail -f ~/.varve-server.log`; de melding bij een mislukte start heeft een knop *Log openen*).
Met de hand gestart staat het gewoon in de Terminal.

In de mixer: klik eerst op *audio starten* — browsers laten geen AudioContext lopen zonder klik.
`/` opent de toetsenlijst.

## Tests

```bash
node test/engine.test.mjs
```

Draait de engine tegen een gemockte Web Audio API. Geen browser nodig.
Handig als vangnet zodra je aan het transport of de loops gaat sleutelen.

## Architectuur

```
src/
  engine/       audio-graph.js   kanaalstrip, EQ, bipolair filter, master, xfader-curves
                deck.js          buffer, transport, cues, loops
                engine.js        decks + mixer + snapshot()
  control/      actions.js       DE ACTION-BUS  <- hier hangt fase 2 aan
                keyboard.js      toetsen -> actions
  analysis/     peaks.js         golfvorm-peaks + ruwe RMS
                demo-track.js    synthetische 124-bpm testtrack
  ui/           app.js, waveform.js, controls.js
```

### De drie regels die de app bij elkaar houden

1. **De engine kent geen MIDI, geen DOM en geen YouTube.** Hij kent decks, een
   mixer en een klok. Alles wat naar binnen wil, gaat via `actions.js`.
2. **Alle value-actions zijn genormaliseerd 0..1.** MIDI CC is dat ook (na `/127`),
   dus een mapping hoeft niets te weten van dB's, hertz of seconden. Dit is de
   reden dat fase 2 straks een middag is in plaats van een week.
3. **Positie komt van `ctx.currentTime`, nooit van een eigen teller.** De
   AudioContext-klok is de enige die niet wegloopt als de UI hapert.

### Toevoegen van een nieuwe functie

```js
// in actions.js
define('deck.A.reverse', 'trigger', (on) => { if (on) deck.reverse(); }, { label: 'Deck A reverse' });
```

Daarna werkt hij meteen vanaf toetsenbord (`KEYMAP`), UI (`data-action`) én — in
fase 2 — vanaf elke MIDI-knop die je eraan mapt. Je hoeft nergens anders iets te doen.

## Wat er bewust nog NIET in zit

| Ontbreekt | Komt in |
|---|---|
| Beatgrid, BPM, sync, beat-loops | fase 3 |
| Keylock / time-stretch | fase 3 (SoundTouch of een Rubberband-WASM build) |
| Loudness-normalisatie (EBU R128) | fase 0 / ingest, met ffmpeg |
| Cue-monitoring (pre-fader listen) | fase 1.5 — vereist een tweede audio-device |
| MIDI, APC40 mkII, LED-feedback | fase 2 |
| YouTube-ingest (yt-dlp) | fase 0 |
| Video-mixer (WebGL) | fase 4 |

## Bekende grenzen van deze fase

- **Alles in RAM.** `AudioBufferSourceNode` vraagt de hele track als buffer. Een
  uur aan 48k stereo ≈ 1,4 GB float32. Voor lange mixes moet dit later naar een
  streaming-oplossing of een AudioWorklet met eigen ringbuffer.
- **Pitch schuift mee met tempo.** Dat is `playbackRate`, geen bug. Keylock is fase 3.
- **De limiter is een `DynamicsCompressor`**, geen look-ahead limiter. Hij vangt
  pieken af, maar vervangt geen fatsoenlijke gainstaging.
- **Loops zijn in seconden, niet in beats.** Zonder beatgrid kan het niet anders,
  en dat is eerlijker dan doen alsof.
