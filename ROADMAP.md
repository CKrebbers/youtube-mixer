# Roadmap

Eén fase per keer. Maak een fase af en laat hem draaien voordat de volgende begint.
Vink af in dit bestand zodra een fase draait.

| Fase | Status | Resultaat |
|---|---|---|
| 1 | **klaar** | Audio-engine, 2 decks, EQ/filter/xfader, waveform, toetsenbord |
| 2 | **klaar** | MIDI-laag, MIDI-learn, APC40 mkII-mapping, LED-feedback |
| 0 | **klaar** | Ingest: yt-dlp + ffmpeg + library |
| 3 | **volgende** | Beatgrid, BPM, sync, keylock, beat-loops |
| 4 | | Video-mixer (WebGL) |
| 5 | **begonnen** | FX-racks per link draaien met zes effecten incl. tempo-gesynchroniseerde gate; nog: sends, 4 decks, sampler, recording |


---

## Waar dit heen gaat (vastgelegd 22 september 2026)

Clay heeft het einddoel scherper gemaakt. Dit is geen losse wens maar een andere
vorm van hetzelfde instrument, en het raakt de volgorde hieronder.

**Acht tracks, geen twee decks.** Elke fader op de APC40 mkII is één track.
Het apparaat heeft er precies acht plus master; dat past één op één.

**Effect-racks horen bij een nummer, niet bij een track.** Per YouTube-link
kunnen meerdere voorgeprogrammeerde racks bestaan, opgeslagen bij die link.
Laad je dat nummer op track 3, dan komen zijn racks mee. Nieuwe racks maken en
ertussen wisselen hoort erbij.

**Track select 1-8 kiest wiens knoppen je vasthoudt.** Dat werkt al: de acht
device knobs verhuizen van MIDI-kanaal met de bankkeuze, en de mapping matcht
op `type:kanaal:nummer`. Bank N wordt track N.

### Drie beslissingen die vóór fase 0 op tafel moeten

Ze zijn later allemaal duurder dan nu.

1. **Hoe heten de actions?** Nu `deck.A.filter`. Bij acht tracks wordt dat
   `track.3.filter`. Elke mapping, de LED-laag en de UI hangen aan die namen.
   Er is nu één mapping in omloop; straks heeft Clay er zelf een paar.

2. **Waar staan de racks?** In de library van fase 0, aan de link gekoppeld, met
   meerdere racks per link en een aanwijzing welke actief is. Als het schema daar
   nu geen plek voor heeft, wordt het later een migratie.

3. **Wijst de mapping naar een parameter of naar een plek?** Dit is de
   belangrijkste. Wijst `cc:2:16` rechtstreeks naar "delay feedback", dan moet je
   bij elk nieuw rack opnieuw koppelen. Wijst hij naar `track.3.fx.knop.1` en
   bepaalt het rack wat die plek doet, dan hoef je nooit meer te koppelen.
   Het rack wordt dan data, net als de mapping.

### Twee gevolgen die niet weg te wensen zijn

**Geheugen.** Een uur stereo is ~1,4 GB float32. Bij twee decks is dat een
bekende grens; bij acht tracks is het een muur. Streamen via een AudioWorklet
stond als "bewust uitgesteld" in CLAUDE.md en komt hiermee waarschijnlijk naar
voren.

**De crossfader is voor twee.** Met acht tracks doet hij weinig meer. De faders
worden de mix.

### De open vraag: twee tracks tegelijk

Clay noemt dit zelf als het onopgeloste stuk. Er ligt al een aanknopingspunt in
het protocol: de APC40 mkII heeft **twee rijen knoppen**. De acht *device knobs*
verhuizen met de bank mee — die volgen de geselecteerde track. De acht *track
knobs* (CC 0x30-0x37) worden **niet** gebankt; die staan altijd op hetzelfde
kanaal. Eén rij voor de track die je vasthoudt, één rij vastgezet op een tweede
track, is dus met de hardware zelf te doen zonder modustoestanden te verzinnen.


---

## Onderzocht en vastgelegd (22 september 2026)

Vijf onderzoeksrondes naar de open technische vragen. De conclusies staan hier
zodat niemand ze opnieuw hoeft uit te zoeken. Waar een cijfer gemeten is staat
dat erbij; de rest is beredeneerd en dus te herzien.

### De volgorde die eruit kwam

Drie van de vijf rondes wezen, elk vanuit hun eigen onderwerp, naar hetzelfde
eerste bouwblok: **het deck achter één interface zetten**
(`play / stop / seek / setRate / position`), zodat `AudioBufferSourceNode`, een
time-stretcher en later een streamende leeslus inwisselbaar zijn. Twee tot drie
uur werk dat keylock, streamen én scratchen tegelijk ontgrendelt. Sla je het
over, dan bouw je keylock ergens omheen en mag je het later opnieuw doen.

### Keylock — Signalsmith Stretch (MIT)

Eén gevendord bestand van 112 KB met de WASM erin; geen npm, geen bundler, geen
build-stap. Registreert zijn eigen AudioWorklet. API leest als
`AudioBufferSourceNode` en heeft `loopStart`/`loopEnd` ingebouwd. Gemeten: 2,91%
van één core per stereodeck, ~23% voor acht — CPU is geen argument. Latentie
120 ms, maar zelfcompenserend: plan wijzigingen ~150 ms vooruit.

**De licentie is doorslaggevend, niet de kwaliteit.** GPL treedt in werking bij
distributie, en een browser-app serveren ís distributie — de JavaScript gaat
naar de bezoeker. Op localhost mag alles; zodra dit op varve.nl staat zou Rubber
Band de hele app GPL maken. Signalsmith is MIT en heeft dat probleem niet.

**Niet SoundTouch/WSOLA voor dit repertoire.** WSOLA zoekt één plakplek en
warbelt hoorbaar op aangehouden polyfone klanken — pads, drones, strijkers.
Mixxx noemt SoundTouch de optie voor machines met weinig vermogen. De
scene-wijsheid "tot 8% is prima" gaat over clubtracks met drums, niet hierover.

### Streamen — nog niet bouwen, wél voorbereiden

Een **ringbuffer is het verkeerde model** voor een deck: die gaat uit van vooruit
en monotoon consumeren, terwijl een deck achteruit gaat, springt en herhaalt.
Het juiste model is een **pagina-cache op absolute samplepositie** met
vastgepinde pagina's voor hotcues — wat Mixxx al vijftien jaar doet. Circa
140 MB voor acht decks tegenover 5,7 GB. Gemeten: acht decks met cubic
interpolatie kosten 0,53% van het audio-thread-budget.

### Beatdetectie — de envelope is waarschijnlijk de bottleneck

Niet de autocorrelatie. Vier ingrepen van samen ~40 regels: FFT-bins groeperen
naar ~40 log-verdeelde banden, de superflux-truc (max-filter over frequentie),
een lopende mediaan in plaats van het globale gemiddelde, en lokale normalisatie.

Octaaffouten: een Fourier-tempogram heeft de omgekeerde bias van autocorrelatie;
die twee vermenigvuldigen laat alleen het echte tempo staan. Plus de
pulstrein-test van Percival met gewicht op 1,5× de periode.

**Bouw eerst een meetlat** met zelf ingetikte referentietracks. Het synthetische
klikspoor scoort altijd 1,0 en vertelt dus niets. En de nuchtere verwachting:
op materiaal met een duidelijke puls zijn we er bijna; op ambient haalt het
beste systeem ter wereld F = 0,63.

**De beste tien regels uit het hele onderzoek:** tap acht tellen en voer die bpm
als `bpmStart` in `verfijnTempoFase` met ±2% marge. De tap geeft het octaaf, de
machine de precisie.

### Toonsoort — FFT met kernelprojectie, niet een echte CQT

libKeyFinder's "direct spectral kernel" is een CQT-benadering van ~40 regels
bovenop een gewone FFT. Downsamplen naar 4410 Hz met ffmpeg is de truc die de
resolutie in de lage octaven geeft (binafstand van 2,93 naar 0,27 Hz) én gratis
het percussieve materiaal wegfiltert.

Profiel `edma` (uit een EDM-corpus) met Temperley als tweede mening; oneens =
lagere zekerheid. Profielen van muziektheoretici verliezen op audio omdat ze
nóten tellen terwijl een chromavector noten plús boventonen telt.

**Bewaar `chroma.bin` naast `peaks.bin`** (173 kB per uur). Daarna is elke
latere afstemming een kwestie van milliseconden in plaats van opnieuw rekenen.

`playbackRate` verschuift de toonsoort: +5,946% is een halve toon, en dat is
**zeven uren op de Camelot-wijzer**. Toon de effectieve code bij de huidige rate.

### Effect-racks — Ableton's model, rekordbox' routing

De "plek" *is* een macro; geen extra indirectielaag nodig. Mixxx' vijf link-types
zijn alle vijf uit te drukken als één invoervenster `in: [a, b]` op een link.

Routing: per kanaal een insert-keten (het rack van de link) plus twee gedeelde
**post-fader** sends — fader dicht, staart blijft hangen. Dat past op de hardware:
de gebankte device-knoppen bedienen de track die je vasthoudt, de ongebankte
track-knoppen alle acht tegelijk. Dat is het antwoord op "twee tracks tegelijk"
zonder een modustoestand die je tijdens het draaien moet onthouden.

Wisselen van rack = **crossfaden tussen twee complete ketens**, nooit nodes
hergebruiken, en pas opruimen na fade plus staarttijd.

Een rack bewaart `default` per macro; de live knopstand is sessietoestand en
gaat nergens heen. Anders is elk rack na drie seconden spelen "gewijzigd".

### Zes vastleggingen die nu goedkoop zijn en later duur

1. `new AudioContext({ sampleRate: 48000 })` — ruimt ook de hersampling-val op
2. `duration` uit de library in plaats van uit `buffer.duration`
3. COOP/COEP-headers in de server (gecontroleerd: breekt vandaag niets)
4. `deck.ctxTimeOf(trackTijd)` — drie regels, brug naar de audioklok
5. Chromagram op schijf, zodra toonsoort gebouwd wordt
6. De tap-hybride in de beatdetectie

### De vraag die de volgorde bepaalt

**Wat staat er op die acht faders?** Acht albums van 31 minuten is 5,7 GB en dan
is streamen onvermijdelijk. Acht nummers van vier minuten is 920 MB — krap maar
haalbaar, en dan scheelt "niets doen" een maand werk.

---

## Fase 2 — MIDI-laag en APC40 mkII

**Doel:** de app is volledig bespeelbaar vanaf de controller, met kloppende LED's,
en elke gebruiker kan zijn eigen mapping maken zonder code aan te raken.

### Stand (22 september 2026)

| Stap | Status | Wat er staat |
|---|---|---|
| 1 | klaar | `midi.js` + MIDI-monitorpaneel. Poorten op naam onthouden, hotplug, sysex-terugval. |
| 2 | klaar | `mapping.js` + `devices/apc40mk2.js` + `mappings/apc40mk2.json`. Soft-takeover, relatieve encoders, wildcard-kanalen, `{focus}`. |
| 3 | klaar | `feedback.js`. Init-sysex automatisch, volledige blackout bij overname, diffing, ringtypes, paletproef. |
| 4 | klaar | `midi-learn.js` + koppelpaneel: leren, wissen, importeren, exporteren. Latency gemeten. |

Geverifieerd op echte hardware: 117 LED-posities schoongeveegd bij overname, 21
aangestuurd, één bericht per verandering en nul in rust. 142 checks groen over
vier testbestanden.

**Latency, zoals ROADMAP hieronder vraagt:** ~0 ms tussen de hardware-timestamp
en onze handler, plus 5,3 ms uitvoerlatency van de audio = **circa 5 ms** rond.
Ruim onder de 15 ms waarboven het als rubber voelt. Eerlijk erbij: Chrome zet
zijn timestamp pas bij binnenkomst, dus de USB-overdracht en de scansnelheid van
de controller zelf zitten er niet in. Een echte meting van knop tot luidspreker
vraagt een microfoon of een loopback.

### Op te leveren

```
src/control/
  midi.js           Web MIDI in/out, poortselectie, sysex
  mapping.js        mapping laden/opslaan/toepassen (JSON)
  midi-learn.js     leer-modus: klik action -> beweeg control -> gekoppeld
  feedback.js       engine-snapshot -> LED's, met diffing
  devices/
    apc40mk2.js     device-profiel: layout, LED-palet, ringtypes, init-sysex
    generic.js      leeg profiel voor onbekende controllers
mappings/
  apc40mk2.json     standaardmapping
```

### Ontwerpeisen

1. **`midi.js` kent geen actions, `mapping.js` kent geen MIDI-hardware.**
   Een device-profiel beschrijft alleen wát er op het apparaat zit, niet wat het doet.
2. **Mapping is data, geen code.** JSON, exporteerbaar en importeerbaar via de UI.
   Vorm per regel: `{ "in": "cc:0:48", "action": "deck.A.filter", "mode": "absolute" }`
   waarbij `in` = `type:channel:number`.
3. **Feedback diffen.** Stuur alleen LED's die veranderd zijn. De hele grid elke
   frame verversen spamt de MIDI-bus en geeft zichtbare lag.
4. **Soft-takeover** voor absolute knoppen/faders: een fysieke knop pakt de waarde
   pas over als hij door de huidige softwarewaarde heen beweegt. Zonder dit springt
   je filter bij elke deck-switch. Dit is geen luxe.
5. **Relatieve encoders** ondersteunen als modus (`relative-2c`, `relative-bin`),
   want de APC40 mkII device-knoppen kunnen beide.

### APC40 mkII — geverifieerde protocolfeiten

Bron: [Akai APC40 Mk2 Communications Protocol v1.2](https://cdn.inmusicbrands.com/akai/attachments/apc40II/APC40Mk2_Communications_Protocol_v1.2.pdf) — raadpleeg dit document voor de volledige tabellen.

**Init-sysex (verplicht, anders blijven de LED's grotendeels dood):**

```
F0 47 7F 29 60 00 04 <mode> <v1> <v2> <v3> F7
   ^  ^  ^  ^     ^
   |  |  |  |     data-lengte (0x0004)
   |  |  |  message type: 0x60 = introduction
   |  |  product model ID: 0x29 = APC40 mkII
   |  device ID: 0x7F = broadcast
   manufacturer ID: 0x47 = Akai
```

Modes: `0x40` generic · `0x41` Ableton Live · `0x42` alternate Ableton Live.
Gebruik **0x41**: pas dan heb je volledige RGB-controle over het grid.
Web MIDI vereist hiervoor `navigator.requestMIDIAccess({ sysex: true })`.

**Clip-grid:** 8×5 pads, note `0x00`–`0x27`. De **velocity** kiest de kleur uit een
palet van 60+ kleuren; het **MIDI-kanaal** kiest het gedrag (vaste helderheid,
oneshot, of knipperen/pulseren in verschillende tempo's). Note On met velocity 0 = Note Off.

**Knop-LED-ringen:** CC `0x18`–`0x1F` (device knobs) en `0x38`–`0x3F` (track knobs).
Waarde: `0` = uit, `1` = single, `2` = volume-stijl, `3` = pan-stijl, `4`–`127` = single.
Zet de EQ-knoppen op pan-stijl (bipolair) en trim/fader op volume-stijl.

### Voorgestelde mapping

| Control | Action |
|---|---|
| Grid rij 1–2 | `deck.{A,B}.hotcue.1-4` + ruimte voor 8 straks |
| Grid rij 3 | `deck.{A,B}.loop.{0.5,1,2,4,8}` |
| Grid rij 4–5 | vrij — video-scenes in fase 4 |
| Faders 1–2 | `deck.{A,B}.fader` |
| Master fader | `mixer.master` |
| Crossfader | `mixer.xfader` |
| Device knobs, bank 1 | `deck.A.high / mid / low / filter / trim / pitch` |
| Device knobs, bank 2 | `deck.B.` idem — de bank zit in het MIDI-kanaal |
| Device knobs, bank 3–9 | vrij: 48 posities over voor FX in fase 5 |
| Track knobs | vrij — FX in fase 5 |
| Play / Cue | `deck.{focus}.play` / `.cue` |
| Bank select | `deck.{A,B}.focus` |

### Klaar wanneer

- Controller aansluiten → init-sysex gaat automatisch, LED's kloppen binnen een seconde.
- Een mapping wijzigen kan volledig via MIDI-learn in de UI, zonder herstart.
- Mapping exporteren en weer importeren geeft exact dezelfde staat.
- Soft-takeover werkt: geen sprongen bij deck-switch.
- Ronde MIDI→audio latency gemeten en genoteerd. Boven ~15 ms voelt het als rubber.

---

## Fase 0 — Ingest en library

**Doel:** een YouTube-URL erin, een genormaliseerd bestand plus metadata eruit,
doorzoekbaar in een browser-paneel.

### Op te leveren

```
server/
  index.js          kleine HTTP-server (Node, geen framework)
  ingest.js         yt-dlp -> ffmpeg -> outputmap
  library.js        SQLite via node:sqlite
  analyze.js        duur, loudness, peaks-cache
```

### Eisen

1. **yt-dlp breekt om de paar weken.** Pin de versie, voeg een `--update`-check toe,
   en laat een mislukte ingest de app nooit meenemen in zijn val.
2. **Loudness-normalisatie is niet optioneel.** YouTube-uploads liggen makkelijk
   15 dB uit elkaar. Gebruik ffmpeg `loudnorm` (EBU R128) in twee passes en schrijf
   de gemeten waarden weg in de database, zodat je later kunt kiezen tussen
   normaliseren op bestand of op afspeelgain.
3. **Forceer constante framerate** bij video, anders loopt je A/V-sync in fase 4
   weg. Let op: `-vsync` is uit ffmpeg 9 verwijderd en heet nu **`-fps_mode cfr`**.
   `ingest.js` probeert de nieuwe naam en valt terug op de oude.
4. **Cache peaks op schijf.** Peaks opnieuw berekenen bij elke load is verspilling.
5. **Geen deelfuncties.** Zie CLAUDE.md.

### Stand (22 september 2026)

Serverkant af en gemeten op een echte track van 31 minuten:

- download via yt-dlp, loudness in twee passes: **-18,27 → -14,02 LUFS**, piek
  exact op -1,50 dBTP
- video 1280×720 met **constante** framerate (`r_frame_rate` = `avg_frame_rate`
  = 30/1 over 55.789 frames)
- peaks vooraf: 348.694 buckets in 1,5 s, bit voor bit gelijk aan wat de browser
  zou uitrekenen
- library met schemaversies, en racks per link

Twee lessen die in de code zijn vastgelegd: `-vsync` bestaat niet meer in
ffmpeg 9 (nu `-fps_mode`), en een verouderde yt-dlp geeft een HTTP 403 die
nergens naar wijst — daarom controleert de server nu zelf of er een nieuwere is.

Browserkant bevestigd in Chrome 153 op 22 september 2026: de track staat in het
paneel, laadt in 9 seconden op een deck (0,66 GB werkgeheugen) en de golfvorm
komt uit de cache.

**Let op bij de browserkeuze.** Comet 152 legt zijn eigen MIDI-service om zodra
je een burst LED-berichten stuurt — vier crashes op 22 september, alle vier in
`MidiService_TaskService_Thread` op dezelfde codeplek. Chrome 153 doet hetzelfde
werk zonder morren. CLAUDE.md schreef Chrome al voor; dit is de harde reden.

### Klaar wanneer

URL plakken → binnen redelijke tijd verschijnt de track in het library-paneel,
met duur, loudness en golfvorm, en laadt met één klik op een deck.

---

## Fase 3 — Beatgrid, sync, keylock

### Stand (22 september 2026)

| Stap | Status | Wat er staat |
|---|---|---|
| Beatgrid + tap | klaar | `engine/beatgrid.js`: tempo plus anker, tap tempo op de mediaan. Grid schuiven, bpm x2 / /2, tel 1 hier leggen. |
| Beat-loops | klaar | 1/2/4/8 tellen, ingeklikt op het grid. De secondeloops staan er nog naast. |
| Opslaan | klaar | Het grid hoort bij de link (schema v2), dus je meet een track één keer uit. |
| In beeld | klaar | Beatlijnen op de zoomgolfvorm, maatbegin voller. Bpm-uitlezing volgt de pitch. |
| Sync | klaar | Tempo én fase, met een fasemeter in beeld. Weigert met een reden als het niet kan. |
| BPM-detectie | grotendeels | `server/detect.js`: banden + superflux, gezamenlijke tempo/fase-verfijning, segmentatie. De **tap-hybride** draait: jij tikt, de server verfijnt op de bewaarde onset-envelope. |
| Keylock | klaar om te bouwen | De bron-abstractie staat (`src/engine/bron.js`); Signalsmith Stretch erin schuiven is nu een bronwissel. Wacht op de luistertest. |
| Key-detectie | te doen | Voor harmonisch mixen. |

- BPM-detectie, maar **met de aanname dat hij faalt.** Op ambient, live-sets en lange
  mixes — precies dit repertoire — is autodetectie onbetrouwbaar. Bouw daarom eerst
  de handmatige tap en een sleepbare beatgrid-editor; automatiek is de bonus.
- Beat-gebaseerde loops (1/4, 1/2, 1, 2, 4, 8 beats) vervangen de secondenloops.
- Sync: tempo én fase matchen.
- Keylock: externe time-stretcher nodig (SoundTouch of een Rubberband-WASM build).
  Dit is de eerste plek waar een dependency echt te rechtvaardigen is.
- Key-detectie (Krumhansl-Schmuckler of chroma-based) voor harmonisch mixen.

---

## Fase 4 — Video-mixer

- Eén `<video>` per deck, muted, als WebGL-texture.
- Audio blijft uit de AudioBuffer komen; video is **slave**: per frame corrigeren op
  `deckTime`. Drift > 40 ms → `currentTime` bijzetten, anders `playbackRate` micro-nudgen.
- Mixer-shader: crossfade, blend modes, en een effect-chain die past bij het
  glitch/texture-werk.
- Output naar canvas, met optie om naar een tweede scherm te sturen.

---

## Fase 5 — Perform

FX-sends (delay, reverb, bitcrush, filter-sweep), 4 decks, sampler op het grid,
master recording naar bestand.
