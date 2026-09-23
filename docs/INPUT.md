# Input/ — wat erin zit en wat we ermee kunnen (23 september 2026)

Clay zette op 23 september een map `Input/` neer met vier bestanden (~868 KB),
plus een lege map `modules/` (alleen `.DS_Store`). Alleen gelezen: niets
uitgepakt in het project, niets gewijzigd, niets gecommit. Uitgepakt om te
lezen in `/tmp/varve-input`.

## Per bestand

| Bestand | Grootte | Wat het is |
|---|---|---|
| `varve-dj-fase1.zip` | 25 KB | **De voorloper van dit project.** Fase 1 van VARVE DJ, 22 sep 11:06, vóór de eerste commit (`32cf81f`, 23 sep 08:29). 16 bestanden, plain JS |
| `av-kern.zip` | 688 KB | **Een ander project:** AV-kern, een instrument voor AV-meditatie op de APC40. Vite + TypeScript, eigen git-repo (1 commit, 23 sep 21:39) |
| `av-kern-lokaal.html` | 134 KB | AV-kern gebouwd als één bestand (Vite-uitvoer met alles erin). Draait zonder `npm` |
| `blueprint-varvedj.json` | 33 KB | Een APC-indeling voor "Varve DJ — twee decks, vier beeldlagen" in het blauwdrukformaat van AV-kern (export uit "Bedienplan") |

### varve-dj-fase1.zip

`index.html`, `styles.css`, `README.md`, engine (`audio-graph`, `deck`,
`engine`), control (`actions`, `keyboard`), analysis (`peaks`, `demo-track`),
ui (`app`, `controls`, `waveform`), `lib/emitter.js`, `test/engine.test.mjs`.
Drie bestanden zijn bytegelijk aan de eerste commit (`audio-graph.js` zelfs
nog aan vandaag, `demo-track.js`, `emitter.js`); de rest is in de eerste
commit al gegroeid (`actions.js` 3 → 9 KB, de test 5 → 20 KB). Dezelfde drie
regels staan al in de README. **Niets om over te nemen**: dit is geschiedenis.
Eén achterhaalde uitspraak: de README noemt SoundTouch of Rubberband voor
keylock; dat is Signalsmith geworden (ROADMAP, "Onderzocht en vastgelegd").

### av-kern.zip

Een instrument voor AV-meditatie, "water en diepte". Geen tracks, geen
YouTube: een **Drone** (Web Audio-oscillatoren) en een **Veld** (WebGL2-shader,
onderwaterlicht; `look1.png`/`look4.png` zijn screenshots) in 8 plekken × 5
varianten, 5 scènes met crossfades van 15–30 s, 8 macro's en een ademklok.
Zes van de acht modules zijn nog stubs ("fase 2 van het Totaalplan").

Opbouw (`src/kern/`, bevroren volgens zijn eigen CLAUDE.md):
- `apc40.ts` — de APC-kaart met element-id's (`pad3-5`, `tk1`, `dk4`, `fader8`);
  `midi.ts` — driver: parsen, **pick-up**, Shift-laag, LED's alleen als ze
  verschillen, zet het apparaat in **mode 0x41**.
- `blueprint.ts` — de loader: blauwdruk-JSON → per element en laag een
  functie, een gedrag (`mom/tog/abs/pick/rel/slew/trig`) en een status
  (`kern` / `alias` / `stub` / `ontbreekt`, met reden).
- `functions.ts` — het register (`reg('naam', { sig, run, key, led, stub })`)
  plus `FNMAP` van functie-id's in de blauwdruk naar registernamen.
- `bus.ts` — parameters met slew, **deterministisch**: vaste tick van 60 Hz,
  geen klok, geen `Math.random`.
- `log.ts` — **actielog**: ruwe MIDI per tick opnemen, exact terugspelen, en
  met een hash controleren dat de eindstand gelijk is.
- UI: virtuele APC40 (stuurt dezelfde bytes als de echte), een "signaalpad"
  dat per druk vijf kaarten laat oplichten (driver → loader → register → bus →
  modules), video-opname met MediaRecorder (WebM, download).
- Zeven blauwdrukken: Ademmachine, Vier handen, Partituur, Matrixmodus,
  Veldopnames, Controlekamer, Harmonie-orgel. 17 vitest-tests.
- Dependencies: `typescript`, `vite`, `vitest` (dev), `npm install` nodig.

### av-kern-lokaal.html

Dezelfde app als de zip, gebouwd en ingepakt in één HTML-bestand: CSS en JS
inline, de zeven blauwdrukken ingebakken (Varve DJ zit er **niet** in). Het
enige dat naar buiten gaat is Google Fonts. Gebruikt Web MIDI met sysex,
`localStorage` (eigen blauwdrukken) en MediaRecorder. Aanname: het is dezelfde
versie als de zip (niet bit voor bit vergeleken; er zit geen `dist/` in de
zip). Plak je `blueprint-varvedj.json` erin (*Bewerken als JSON*), dan kleurt
de kaart vrijwel alles rood: het register kent geen deck-functies.

### blueprint-varvedj.json

Formaat: `{ id, name, controller: "apc40", notes, layers[2], functions[83], assign{147} }`,
`assign[element][laag] = { fn, beh, note }`, lagen Basis en Shift. Beschrijft
**twee decks spiegelbeeldig rond het midden**: deck A kolom 1–4, deck B kolom
5–8; kanaalfaders 4|5 in het midden, pitchfaders buitenaan (1|8), FX-wet op
2|7, beeldzijde-opaciteit op 3|6. Grid van onder: rij 1–2 hotcues 1–8, rij 3
loops, rij 4 cue/play/sync/keylock, rij 5 acht beeldscènes. Track knobs = EQ +
filter (pick-up), Clip Stop eronder = kill. Vier FX-slots per deck (echo,
reverb, flanger, roll). Device knobs = FX van het gekozen deck, met Shift de
parameters van de gekozen **beeldlaag**; vier beeldlagen met elk een van 26
"Vormmachines". De pijlen zijn de bibliotheek. Plus: koptelefoon (PFL, cue-mix,
split), slip, brake, censor, quantize, beatjump, scènes opslaan, en opnemen van
handelingen (replay).

## Blauwdruk → stand in VARVE

"Botst" = strijdig met een vastgelegde keuze; tussen haakjes waar die staat.

| Blauwdruk | Stand in VARVE |
|---|---|
| **Indeling: 2 decks spiegelbeeldig over 8 kolommen** | **botst** — acht tracks, één kolom = één track (ROADMAP "Waar dit heen gaat", `docs/APC40.md`) |
| Faders 1/8 = pitch, 2/7 = FX-wet, 3/6 = beeldopaciteit | **botst** — fader = volume van die track; tempo via encoder `track.{focus}.tempo` |
| Track knobs = EQ laag/mid/hoog + filter, pick-up | **botst** — track knob = filter van de eigen kolom, endless; EQ op de device knobs (strip) |
| Clip Stop = EQ-kill | niet (geen kill); Clip Stop = loop aan/uit |
| play, cue, cue zetten | gebouwd (cue alleen met Shift + ●, VRAGEN C3) |
| start op volgende maat (`deck-play-quant`) | niet |
| sync | gebouwd, naar de luidste track (CLAUDE.md) |
| tempo-master (`deck-sync-master`) | niet — botst met "sync naar de luidste"; sync-lock staat in ronde 3 |
| keylock | niet — wacht op luistertest Signalsmith (VRAGEN A3) |
| pitch ±8 %, bereik 8/16/50, pitch naar 0 | gebouwd (`pitch.range`, standaard ±16, reset bij laden: VRAGEN C1/C2) |
| pitch fijn, pitch bend −/+ | gebouwd (tempo-encoder met Shift 0,01 %; nudge = bend) |
| brake, censor/reverse, slip | niet |
| quantize (cues/loops op het grid) | deels — beat-loops klikken in op het grid; quantize voor hotcues staat in ronde 3 |
| hotcues 1–8, wissen met Shift | deels — 4 per track, wissen met Shift |
| loop ½ / ×2 / autoloop / reloop-exit | gebouwd (`loop.halve/double/toggle/exit`, beat-loops 1–16) |
| loop in / loop out (handmatig) | niet (alleen loops in tellen of seconden) |
| beatjump ± en grootte | niet — ronde 3 |
| gain, filter | gebouwd (trim, bipolair filter) |
| filter-resonantie | deels — alleen in het FX-filter, niet in de strip |
| knop naar midden (reset) | niet |
| 4 FX-slots per deck met typewissel, wet, beat-lengte, tempo-sync | **anders gebouwd** — één insert-rack per track met 8 knopplekken + twee sends (echo, galm); tempo-sync in delay en gate (CLAUDE.md, racks) |
| flanger, roll | niet (wel phaser, delay, gate, bitcrush, ringmod, reverb) |
| crossfader, curve, toewijzing kant/thru | gebouwd |
| master | gebouwd |
| koptelefoon: PFL, niveau, cue-mix, split | niet — één audio-uitgang, VRAGEN F1 open |
| bibliotheek bladeren/laden met de pijlen | **botst** deels — pijlen = focus en grid-modus; library via toets B op het scherm |
| tap tempo, grid schuiven, grid ÷2/×2 | gebouwd (`tap`, `grid.back/fwd`, `grid.halve/double`) |
| beat-LED (master-beat) | gebouwd — Track Select van de maatgever knippert op de tel |
| deck-select (device knobs volgen) | gebouwd (focus, mode 0x42) |
| onsets flitsen het beeld | deels — puls op de TEL (`video.puls`), niet op onsets |
| **vier beeldlagen, 26 Vormmachines, laagparameters, willekeur** | niet — en een ander model: VARVE-beeld is de YouTube-video van elke track, geen generatieve lagen (CLAUDE.md, "Video is SLAAF") |
| beeld: reactiviteit per band, analysebron A/B/master | niet (puls volgt de track die de maat geeft) |
| blendmodus | gebouwd — 4 mengvormen (`video.mode`) |
| beeld-crossfader los van de audio | **botst** — zichtbaarheid = fader × crossfader, per ontwerp |
| beeldscènes laden/opslaan/bank/op de maat | niet |
| beeld bevriezen, naar zwart, flits, master-intensiteit, snelheid | niet (wel zes effecten, vasthoudbaar op het grid) |
| opname audio + beeld | gebouwd (WAV + 720p mp4, per seconde naar schijf) |
| opname handelingen (replay) | niet |
| Shift als tweede laag | gebouwd |

Kort: van de DJ-functies is ongeveer twee derde er al (vaak anders ingedeeld),
de beeldkant van de blauwdruk bestaat in VARVE niet, en de indeling zelf is
de oude twee-deckgedachte die op 22 september is losgelaten.

## Wat waardevol is om over te nemen

| Idee | Uit | Waarom | Grootte |
|---|---|---|---|
| Actielog + terugspelen | `av-kern/src/kern/log.ts` | Een set opnieuw renderen (bijv. met video) zonder erbij te zitten; en een fout naspelen. In VARVE: actions van de bus met hun audiokloktijd opnemen, niet ruwe MIDI. Niet hash-exact: streamen en de audioklok zijn niet deterministisch | ~1 dag |
| Blauwdruk-import (Bedienplan → mapping) | `blueprint.ts` + deze JSON | Alleen als Clay indelingen in Bedienplan wil blijven ontwerpen. Element-id's → `note:ch:n`, `fn` → action, `beh` → modus. Wat niet bestaat wordt gemeld, niet geraden | ~halve dag |
| Dekking per indeling (bestaat / komt later / ontbreekt) | loader-status | Klein en handig op `apc.html`: zie in één blik welke knoppen nergens heen gaan | 1–2 uur |
| Losse functies uit de blauwdruk | blueprint | beatjump, quantize, loop in/out, start op de maat, brake, kill, knop-reset: de eerste drie staan al in ronde 3 | per stuk 1–3 uur |
| Scènes met lange crossfade | `bus.ts` `loadScene` | Als VARVE ooit beeldscènes krijgt: een scène is data, de fade is een tijd | pas bij een beeldfase |

Niet overnemen: Vite/TypeScript/npm (VARVE: geen build, nul dependencies);
mode 0x41 (VARVE mat dat de device knobs dan op track 1 blijven, koos 0x42);
de 60 Hz-tick als tijdsbron voor audio (regel 3); de virtuele APC en het
signaalpad (VARVE heeft `apc.html`, het gespiegelde scherm en de MIDI-monitor).

## Git

`Input/` staat nu ongetrackt. Het zijn zips (binaire bestanden), en
`av-kern.zip` bevat een complete eigen `.git`. **Advies:** `Input/` in
`.gitignore` en lokaal bewaren; AV-kern hoort in zijn eigen repo (zijn README
beschrijft `gh repo create av-kern --private`). Wil Clay de blauwdruk als
ontwerpstuk bewaren, dan alleen `blueprint-varvedj.json` naar `docs/`
(33 KB tekst). `varve-dj-fase1` voegt niets toe aan de git-geschiedenis
behalve de stand van vóór de eerste commit. Aan Clay de keuze.

## Vragen voor Clay

1. **Wat wil je met deze input?** Naslag, ideeënbak, of moet VARVE en AV-kern
   iets samen gaan doen (bijv. AV-kern-beeld als laag in VARVE)?
2. **De blauwdruk: is dit een wens of een oud ontwerp?** Hij gaat uit van twee
   decks en vier generatieve beeldlagen. Dat botst met acht tracks en met
   "beeld = de video van de track". Heropenen we die keuzes, of plukken we
   alleen losse functies?
3. **Wat is een "Vormmachine" en waar staan ze (26)?** Niet in AV-kern, niet in
   VARVE. Bestaat er nog een derde project?
4. **Blijf je Bedienplan gebruiken** om indelingen te ontwerpen? Dan is een
   import naar de VARVE-mapping de moeite waard; anders niet.
5. **Actielog/replay**: wil je dat in VARVE (set naspelen, opnieuw renderen)?
6. **Waar is `modules/` voor?** Leeg (alleen `.DS_Store`). Hoort daar AV-kern
   in, of iets anders?
7. **Git:** `Input/` negeren (advies) of committen?
