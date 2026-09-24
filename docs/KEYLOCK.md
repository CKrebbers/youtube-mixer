# Keylock en toonsoort verschuiven

Stand: 24 september 2026. Onderzoek op branch `onderzoek/keylock`; er is niets in
`src/` gebouwd. Meetinstrument: `tools/keylock/` (`proef.mjs`, `kern.mjs`), uitkomst in
`tools/keylock/metingen-2026-09-24.txt`, luisterbestanden in `tools/keylock/uit/` met
`tools/keylock/LUISTER.md` als leeswijzer (VRAGEN A3). Toonsoort-DETECTIE hoort hier
niet bij (andere agent).

Twee wensen van Clay:
1. **Keylock**: tempo veranderen zonder dat de toon meegaat.
2. **Toon verschuiven**: de toonsoort los van het tempo, in halve tonen.

Beide doet dezelfde stretcher: die kent een `rate` (hoe snel de invoer gelezen wordt)
en een `semitones` (hoeveel de toon verschuift), onafhankelijk van elkaar.

## Kort

- Signalsmith Stretch 1.3.2 werkt, in Node gemeten op de echte WASM: keylock houdt de
  toon exact (440,00 Hz bij 0,92 en 1,08), transponeren zit er 2–4 cent naast.
- **Hij past IN onze eigen worklet** (`stream-lezer.js`), maar niet door zijn `.mjs` te
  importeren: dat registreert in een worklet zijn eigen processor en exporteert `{}`. De
  WASM-fabriek moet er los uit (`tools/keylock/kern.mjs` laat zien hoe).
- **Regel 3 blijft heel.** Met de juiste vooruitblik (uitvoerlatentie PLUS één blok
  van 128) klinkt tracktijd x op T + (x − P)/R, binnen ±0,6 ms. Dezelfde segmenten
  {T, P, R}, dezelfde formule als nu; de hoofdthread hoeft niets anders te rekenen.
- **Rekenwerk is geen probleem, pieken wel.** ~2% van een M1-kern per deck (8 decks
  ~16%), goedkoper ~1,3% (8 decks ~11%). Maar zonder "gespreid rekenen" valt één
  STFT-blok (~0,6 ms) in één quantum; vallen de blokken van acht decks samen, dan is
  dat 4,5 ms tegen een budget van 2,67 ms. Gespreid: hooguit 0,85 ms.
- **Springen is het echte ontwerpprobleem.** Een stretcher heeft 60 ms uitvoerlatentie.
  Ter plekke springen verliest die eerste 60 ms (de aanslag van je hotcue is weg). Twee
  nette uitwegen: de sprong PLANNEN (63–93 ms later, exact, geen extra rekenwerk), of
  een tweede, verse stretcher opwarmen (2,5 ms rekenwerk in één keer: een tik bij
  acht decks, dus gespreid over ~20 ms aanloop).
- **Advies:** optie A (stretcher in de eigen worklet), preset standaard gespreid
  (tenzij "goedkoper" op je gehoor niet onder doet), eerst geplande sprongen, keylock
  standaard uit. Ongeveer 2,5–4 sessies. Eerst luisteren (A3), dan K1–K8 hieronder.

---

## 1. Wat Signalsmith Stretch 1.3.2 is

**Pakket** (`npm pack signalsmith-stretch@1.3.2`, 96 KB, integriteit gecontroleerd):

| bestand | grootte |
|---|---|
| `SignalsmithStretch.mjs` (ES-module) | 111,2 KB |
| `SignalsmithStretch.js` (UMD) | 111,1 KB |
| `README.md`, `package.json` | 4,5 KB |

- Het `.mjs` is één bestand: Emscripten-glue (~20 KB) plus de WASM als base64
  (84 KB tekst = **63 KB binair**), plus de schil van Signalsmith (AudioWorkletNode,
  berichten). Geen dependencies. De WASM gebruikt **geen SIMD** (geen v128 in de
  functies): er is ruimte voor een snellere eigen build, maar die is niet nodig.
- Geheugen: WASM begint op 512 KB en groeit bij het configureren tot **1,7 MB per
  stretcher** (standaard), 1,2 MB (goedkoper), 0,8 MB (kort).
- **Licentie: MIT** volgens `package.json`, maar **het pakket bevat geen
  LICENSE-bestand**. MIT eist dat de copyright- en toestemmingstekst meegaat. Bij het
  vendoren de LICENSE uit de bron-repo (signalsmith-audio.co.uk/code/stretch.git)
  bovenin het bestand zetten. Niet geverifieerd welke tekst daar precies staat (geen
  netwerkcontrole gedaan behalve npm).

**Hun API** (de AudioWorkletNode die `SignalsmithStretch(ctx)` teruggeeft):

| | |
|---|---|
| `schedule({ output, active, input, rate, semitones, tonalityHz, formantSemitones, formantCompensation, formantBaseHz, loopStart, loopEnd })` | een tijdkaart van uitvoertijd naar invoertijd, net als onze segmenten |
| `start(when, offset, duration, rate, semitones)` / `stop(when)` | gemak rond `schedule` |
| `addBuffers([L, R])` / `dropBuffers(tot)` | invoer als AANEENGESLOTEN rij buffers: achteraan toevoegen, vooraan weggooien (een FIFO) |
| `latency()` | invoer- plus uitvoerlatentie |
| `configure({ blockMs, intervalMs, splitComputation, preset })` | blokgrootte, stapgrootte, rekenwerk spreiden |
| `inputTime`, `setUpdateInterval(s, fn)` | positieberichten (om de 0,1 s) |

De processor laadt zichzelf als Blob-module per AudioContext. Elk blok van 128 frames
doet hij een volledige `seek` (constant seeken: kopieert ~5.760 samples per kanaal en
analyseert steeds ook het vorige venster) en maakt nieuwe `Float32Array`-views: dat
kost ~50–80% meer dan nodig (zie de meting) en alloceert op de audiothread.

**De kern** (WASM-exports, wat wij zouden gebruiken):
`_presetDefault(ch, sr)` · `_presetCheaper(ch, sr)` · `_configure(ch, blok, interval,
gespreid)` · `_setBuffers(ch, lengte)` → pointer · `_seek(n, rate)` · `_process(nIn,
nUit)` · `_setTransposeSemitones(st, tonaliteit/sr)` · `_setFormantSemitones(st,
behoud)` · `_setFormantBase(hz/sr)` · `_reset()` · `_flush(n)` · `_inputLatency()` ·
`_outputLatency()` · `_blockSamples()` · `_intervalSamples()`.
**Eén stretcher per WASM-instantie** (de glue heeft één globaal object). Twee stretchers
per deck = twee instanties.

**Presets** (gemeten, 48 kHz):

| preset | blok | stap | invoerlatentie | uitvoerlatentie | geheugen |
|---|---|---|---|---|---|
| standaard (`presetDefault`) | 120 ms | 30 ms | 60 ms | 60 ms | 1,7 MB |
| standaard gespreid | 120 ms | 30 ms | 60 ms | **90 ms** | 1,7 MB |
| goedkoper | 100 ms | 40 ms | 50 ms | 50 ms | 1,2 MB |
| goedkoper gespreid (`presetCheaper`) | 100 ms | 40 ms | 50 ms | **90 ms** | 1,2 MB |
| kort (eigen keuze) | 60 ms | 15 ms | 30 ms | 30 ms | 0,8 MB |

Gespreid rekenen verdeelt het werk van één blok over de hele stap, en kost daardoor één
stap extra uitvoerlatentie.

**Binnen onze eigen AudioWorkletProcessor?** Ja. De fabriek draait in een
AudioWorkletGlobalScope (Emscripten ziet daar geen `window`, `process` of
`WorkerGlobalScope` en gedraagt zich als "shell"; hun eigen processor doet precies
dat). Twee dingen:
- Het `.mjs` importeren in een worklet werkt NIET: het ziet `registerProcessor`,
  registreert ZIJN processor en exporteert `{}`. De fabriek zit dan onbereikbaar in een
  closure. Oplossing: een afgeleid bestand vendoren met alleen de fabriek plus
  `export default` (de knip staat in `laadFabriek()` in `tools/keylock/kern.mjs`;
  als script te herhalen vanaf de gecontroleerde tarball).
- De glue noemt `document.currentScript` (achter een `typeof`). `test/regels.test.mjs`
  vlagt `document.` in elk bestand in `src/engine/`. Het gevendorde bestand dus in een
  submap (`src/engine/vendor/`, die leest de test niet) of die ene regel bij het
  vendoren vervangen.
- Er is geen `instantiateWasm`-haak: elke instantie compileert zelf de 63 KB (async,
  enkele ms). Geen probleem.

---

## 2. Metingen

In Node 26 op de M1, met de echte WASM uit het pakket. **Node is geen AudioWorklet**:
geen realtime-thread, geen render-quanta van de browser. Wel dezelfde V8 en dezelfde
WASM. Alles in `tools/keylock/metingen-2026-09-24.txt`; opnieuw met
`node tools/keylock/proef.mjs alles`.

### Klopt het?

| controle | uitkomst |
|---|---|
| toon bij keylock 0,92 / 1,00 / 1,08 (sinus 440 Hz) | 440,00 Hz, 0,00 cent |
| transponeren +2 / −1 / +1 op 1,08 | +2,1 / +3,6 / +1,7 cent naast (hoorbaar pas vanaf ~5 cent) |
| zoals nu (renderBlok) op 1,08 | 475,20 Hz: toon schuift mee, zoals bedoeld |
| hoorbare positie (klikken om de 0,5 s, 25 s lang) | 1,00: ±0,02 ms · 0,92: −0,3 (max 0,6) · 1,08: +0,25 (max 0,6) · goedkoper gespreid: max 1,1 ms |
| klankbalans op 1,00 (energie per octaaf 63 Hz–16 kHz, vier nummers) | 0,0 dB in elke band |
| golfvorm op 1,00 | niet gelijk: correlatie +0,86 tot −0,87 (zie "polariteit") |
| pieken | tot 3,6 dB hoger dan het origineel (zang), 1,3 dB (album) |
| loop van 4 tellen op 1,05 | periode 1,52 s, gelijk aan zoals nu |
| tempo wijzigen zonder plannen | eerste 90 ms ongeveer uitLat × ΔR (tot 5,4 ms bij 8%, 2,7 bij 4%), na 150 ms weer ±0,5 ms |

Eén meetfout onderweg die in het ontwerp hoort: met vooruitblik = uitvoerlatentie klonk
alles **2,6 ms te laat**, precies één quantum. Wat `process()` teruggeeft hoort bij
invoer die één blok later "klaar" is. De vooruitblik is dus **uitLat + 128 frames**.
Signalsmith's eigen processor rekent met alleen uitLat en zit daardoor ook 2,7 ms achter.

### Springen

Een klik 20 ms na het doel van een sprong; wanneer klinkt hij, en hoe hard?

| manier | latentie | klik | sterkte |
|---|---|---|---|
| ter plekke seeken (de stretcher die al speelt) | 0 | – | **−37,5 dB: weg** |
| gepland seeken (T = nu + uitLat + 1 blok) | 63 ms | 0,0 ms | −0,2 dB |
| verse stretcher, niet opgewarmd | 0 | −2,5 ms | −12,8 dB (inzwellen over 40 ms) |
| verse stretcher, 60 ms opgewarmd | 0 | −2,4 ms | −2,7 dB |
| verse stretcher, 120 ms (één blok) opgewarmd | 0 | 0,0 ms | 0,0 dB |

Op muziek (Sakamoto) hetzelfde beeld: verse stretcher zonder opwarmen begint op −40 dB
en is pas na 40 ms op sterkte; met één blok opwarmen of gepland seeken zit hij vanaf de
eerste 5 ms binnen ~1 dB van een stretcher die er al doorheen speelde.

### Rekenwerk

CPU-tijd van de thread (`process.threadCpuUsage`), drie keer gemeten, per quantum het
minimum. Eén deck: load ~3 op 8 kernen (rustig). Runs met Clay's Chrome op ~300%
(load 12–22) gaven tot **2–3× hogere** getallen: macOS zet een gewone thread dan op
een efficiëntiekern en de runs worden onderbroken. Chrome's audiothread is realtime en
krijgt een prestatiekern; de rustige getallen liggen daar het dichtst bij.

**Eén stereodeck**, keylock 1,08 (0,92 / 0,95 / 1,05 en toon ±1/±2 kosten hetzelfde,
binnen ±0,1%):

| | % van één kern | per quantum (typisch) | quantum met een STFT-blok |
|---|---|---|---|
| zoals nu (renderBlok, cubisch) | 1,33% | 33 µs | – |
| standaard | 2,00% | 4 µs | ~550 µs, 1 op de 11 |
| standaard gespreid | 2,07% | 54 µs, max 109 | – |
| goedkoper | 1,33% | 4 µs | ~470 µs, 1 op de 15 |
| goedkoper gespreid | 1,37% | 40 µs, max 59 | – |
| kort | 1,99% | 4 µs | ~280 µs, 1 op de 5,6 |
| hun AudioWorkletProcessor (optie C), standaard | 2,96% | 29 µs | ~580 µs |
| idem, "cheaper" | 2,45% | 67 µs | – |

Transponeren kost hetzelfde als keylock; formantbehoud ~20% meer. Hun eigen processor
kost ~50–80% meer dan dezelfde kern met onze aansturing.

**Acht decks** (tempo's 0,92–1,08, twee getransponeerd), som per quantum, budget
2.667 µs per 128 frames. Rustigste run (load 8 → 4); tijdens een piek (load 18,5)
kwam hetzelfde uit op 25–42% van een kern met quanta tot 52 ms, en ook gespreid
4–6 ms. Beide staan in het meetverslag.

| | gemiddeld (% van een kern) | zwaarste quantum | boven budget |
|---|---|---|---|
| standaard, blokken toevallig verspreid | 16% | 1,2 ms (45%) | 0% |
| **standaard, blokken tegelijk** | 16% | **4,5 ms (170%)** | **8,9% van de quanta** |
| standaard gespreid, tegelijk | 16% | 0,85 ms (32%) | 0% |
| goedkoper, verspreid | 10,5% | 0,53 ms (20%) | 0% |
| goedkoper gespreid, tegelijk | 11% | 0,45 ms (17%) | 0% |

**Opwarmen** (verse stretcher bij een sprong, in één keer):

| preset | 60/50/30 ms (uitLat) | één blok |
|---|---|---|
| standaard | 1,8 ms | 2,5 ms |
| goedkoper | 1,0 ms | 1,6 ms |
| kort | 0,9 ms | 1,5 ms |

2,5 ms in één quantum is 92% van het budget van dat quantum, voor één deck. Onder
belasting gemeten: 4,7–5,7 ms.

**Omgerekend naar acht decks op de M1:** gemiddeld 11–16% van één kern voor keylock op
alle acht, tegen ~10% voor de leeslus van nu. Dat past. Wat NIET past: acht decks
zonder gespreid rekenen waarvan de blokken samenvallen, en opwarmen in één quantum.
Onbekend en niet gemeten: de rest van de graaf (EQ, FX, galm, analysers) op dezelfde
thread, en hoeveel frames Chrome per callback vraagt (de audioknop toont
`baseLatency`; bij 256 of 512 frames vangt een callback een piek beter op).

### Polariteit bij keylock op 1,00

Op 1,00 trekt Signalsmith naar bijna-identiek (correlatie tot 0,96–1,00 met het
origineel), maar soms met de golf **omgekeerd** (−0,85 tot −0,95), en dat kan onderweg
omslaan (Sakamoto op +3,3 s: eerst −0,6, na 6 s +0,96). Hoor je niet, zolang je niet
kruisfadet tussen de gewone weg en keylock. Doe je dat wel (keylock aanzetten tijdens
het spelen op 1,00), dan geeft een kruisfade van 4 ms een dip tot **−15,5 dB**
(zoned-out), −13,7 (album), −7,8 (zang). Zie 4.5.

---

## 3. Drie manieren om hem in te bouwen

### (A) De stretcher BINNEN `stream-lezer.js` — advies

De worklet leest de pagina's zelf. Met keylock voert hij de stretcher hele frames
tracktijd (geen interpolatie), in het tempo van het segment, en de stretcher maakt er
uitvoer van op de toon die gevraagd is. Zonder keylock en zonder toonverschuiving blijft
alles zoals nu (`renderBlok`).

- \+ Past op de pagina-cache: vastgepinde hotcues, gat = stilte, geen tweede kopie van
  de track. De stretcher heeft willekeurige toegang tot de invoer, dus hij kan
  VOORUITLEZEN en zijn invoerlatentie verdwijnt; alleen de uitvoerlatentie blijft.
- \+ Eén segmentformule voor hoofdthread en worklet, ook met stretcher (gemeten ±0,6 ms).
- \+ Loops: de invoer loopt uitgerold door de loop, met dezelfde LOOP_NAAD. De
  stretcher ziet één doorlopend signaal en hoeft bij de naad niet te seeken.
- \+ Geen allocaties per blok, geen constant seeken: goedkoopste variant (2,0% tegen
  3,0% voor hun processor).
- − Wij schrijven de aansturing zelf (~150 regels, prototype in `kern.mjs`:
  `StretchSpeler`) en vendoren een afgeleid bestand (alleen de fabriek).
- − Springen vraagt een keuze (4.4).

### (B) Een aparte AudioWorkletNode ACHTER de bron

De streamkern speelt zoals nu op snelheid R (toon schuift mee), en een Signalsmith-node
in "live"-modus transponeert daarna met −12·log2(R) plus Clay's verschuiving.

- \+ Niets aan `stream-lezer.js`; keylock is een insert, ook bruikbaar voor de sampler.
- − Live-modus kan niet vooruitlezen: **120 ms vertraging op ALLES** van dat deck
  (play, hotcue, cue), en de hoorbare positie is `positieOp(seg, t − 0,12)`. Golfvorm,
  video, fxKlok, sync en LED's moeten dan per deck een latentie aftrekken.
- − Keylock aan/uit tijdens het spelen verschuift het deck 120 ms t.o.v. de rest (uit de
  maat), tenzij ook decks zónder keylock 120 ms vertraging krijgen.
- − Twee bewerkingen na elkaar (cubisch hersamplen, dan STFT-transponeren).

### (C) Wat Signalsmith zelf voorstelt: hun node met `addBuffers` + `schedule`

- \+ Klaar: tijdkaart, loops, `semitones`, zelfcompenserend.
- − `addBuffers` is een FIFO van aaneengesloten buffers vanaf één begin. Dat is precies
  het ringbuffermodel dat de ROADMAP afwees: een hotcue achter wat al weggegooid is,
  is stilte tot hij opnieuw is aangevuld (en invoegen vóóraan kan niet). Het
  alternatief is de hele track als Float32 in het geheugen: 23 MB per minuut, 5,7 GB
  voor acht albums. Streamen was er juist om dat te voorkomen.
- − Constant seeken en allocaties per blok: ~50–80% meer rekenwerk (gemeten).
- − Hun loop is een harde sprong in de invoer (geen naad); hun latentiecompensatie zit
  een quantum (2,7 ms) naast.
- − Een Blob-module per AudioContext en `inputTime`-berichten: een tweede klok naast
  onze segmenten, die we zouden moeten negeren.

**Advies: A.** B botst met regel 3 en met hotcues, C met streamen. A is meer werk in de
worklet, maar het is het enige dat bij de rest van de engine past.

---

## 4. Ontwerp van optie A

### 4.1 Wat de stretcher krijgt

Per segment twee getallen voor de worklet: `R` (zoals nu) en `semitonen`.

    semitonen = toon                       als keylock aan staat
    semitonen = 12 · log2(R) + toon        als keylock uit staat en toon ≠ 0
    (keylock uit en toon = 0: geen stretcher, renderBlok zoals nu)

In optie A rekt de stretcher de tijd zelf op; hij hoeft dus niet terug te
transponeren. "Keylock = transponeren met −12·log2(R)" is de formulering van optie B
(eerst hersamplen, dan terugschuiven); het klinkt hetzelfde. Bend (nudge ±4%) verandert
alleen de bron-rate: met keylock aan buigt het tempo zonder dat de toon wiebelt.

### 4.2 De worklet

- `stream-lezer.js` importeert een gevendorde fabriek (`src/engine/vendor/`, zie hoofdstuk 1) en
  maakt bij de eerste keylock-aanvraag een stretcher (async, enkele ms; tot hij klaar
  is blijft renderBlok spelen of klinkt stilte).
- Een nieuwe pure functie in `stream-kern.js`, `leesInvoer(seg, paginas, van, n, L, R)`:
  hele frames tracktijd, loop uitgerold met LOOP_NAAD, gat = 0. Puur, dus in Node te
  testen, zoals renderBlok nu.
- Per blok van 128 (de logica van `StretchSpeler.blok` in `kern.mjs`):
  `doel = frame(positie(seg, t0 + (uitLat + 128)/sr)) + inLat`. Loopt dat netjes
  door: voeren en `_process(n, 128)`. Ligt het doel een klein stukje terug (tempo
  omlaag): even niet voeren. Verder weg (> één stap): `_seek`.
- Geen allocaties per blok: views één keer maken, opnieuw alleen als het WASM-geheugen
  groeide (`HEAP8.buffer` veranderd).
- Gespreid rekenen aan (4.6). Buffer-lengte ≥ inLat + uitLat.

### 4.3 Regel 3 over de draadgrens, met een stretcher ertussen

Het segment blijft "vanaf T staat de positie op P met snelheid R". De worklet voert de
stretcher vooruit met de vaste vooruitblik, en wat eruit komt op t is positie(seg, t):
gemeten ±0,6 ms (controle 2). Hoofdthread, golfvorm, video, fxKlok en LED's rekenen
dus niets anders.

Eén uitbreiding: **een segment mag een T in de toekomst hebben** (geplande sprong,
4.4). Tot T geldt het vorige segment. De StreamBron houdt daarvoor het vorige segment
bij, en `positie`/`ctxTimeOf` kiezen op t < T het vorige. Dat hoort als pure functie
in `stream-kern.js` (`positieIn({vorig, seg}, t)`), zodat hoofdthread en worklet weer
dezelfde code draaien.

Tempo (pitchfader, tempo-encoder, bend, de rate van sync) wordt NIET gepland: T = nu.
De vooruitblik verspringt dan met uitLat × ΔR; gemeten (controle 5) wijkt de hoorbare
positie in de eerste 90 ms ongeveer zoveel af (tot 5,4 ms bij een sprong van 8%, 2,7 ms bij
bend) en na 150 ms is hij weer ±0,5 ms. Dat is ~0,6 ms per procent tempowissel,
en alleen vlak na de wissel zelf.

### 4.4 Springen met keylock: drie manieren

Springen = play, cue, hotcue, seek, sync-fase, nudge van 50 ms, loop aan/uit, keylock
aan/uit. De lopende stretcher heeft 60–90 ms uitvoer in de pijplijn zitten; die moet
eerst op.

| | latentie | extra rekenwerk | stretchers per deck | klopt de aanslag? |
|---|---|---|---|---|
| **S1 gepland**: segment krijgt T = nu + uitLat + 1 blok + marge; de lopende stretcher seekt als zijn vooruitblik T bereikt | 63 ms (standaard), 93 ms (gespreid), 53 (goedkoper), 33 (kort), plus een paar ms marge voor het bericht | geen | 1 | ja, gemeten 0,0 ms / −0,2 dB |
| **S2 aanloop**: een tweede, verse stretcher warmt één blok op, VERSPREID over ~20 ms, daarna 4 ms kruisfade | ~20 ms | 2,5 ms per sprong, gespreid (~0,3 ms per quantum) | 2 | ja (opwarmen één blok: 0,0 ms / 0,0 dB) |
| S3 meteen: verse stretcher, opwarmen in één quantum | 0 | 2,5 ms in één quantum (onder belasting 5 ms) | 2 | ja, maar een tik zodra de audiothread het niet haalt |

Zonder keylock verandert er niets: springen blijft direct, zoals nu.

**Advies:** S1 eerst. Het is exact, kost niets, en het verschil met nu merk je alleen
op een deck waar keylock aan staat. Voelt 95 ms bij een hotcue te traag, dan S2 als
losse stap (+1 sessie). S3 niet.

Met S1 moet wie springt ook uitrekenen voor T, niet voor nu: sync rekent de fase die
het deck op T moet hebben, en `_heranker` (gate, echo, sampler) gaat op T af (een
timer zoals `_wisselTimer`), niet op het moment van drukken.

### 4.5 Per situatie

| situatie | met keylock |
|---|---|
| **seek, hotcue, cue, play** | een sprong (4.4). Hotcues en cue zijn al vastgepind, dus de pagina's zijn er. Pauze = de stretcher niet meer aanroepen (geen CPU) en de uitgang 4 ms uitvloeien; play = sprong naar de positie. |
| **loop en LOOP_NAAD** | de invoer loopt uitgerold door de loop (`loopArrayBron` in `kern.mjs`), met dezelfde naad van 5 ms naar wat er vóór het loopbegin staat. De stretcher seekt niet bij de naad. Periode gemeten gelijk aan zoals nu (1,52 s op 1,05). Luisterbestand adriana 15/16. |
| **loop aan/uit, halveren** | de invoer liep al uitLat vooruit onder de oude loop. Daarom ook een geplande wissel (T = nu + vooruitblik). Een loop die korter is dan de vooruitblik en vlak voor zijn einde gezet wordt, gaat één keer "te ver"; setBeatLoop kiest het einde ná de positie, dus dat gebeurt pas bij loops onder ~100 ms. Heel korte loops (< 2 blokken, 240 ms) smeren in de stretcher: niet beluisterd. |
| **bend (nudge ±4%)** | alleen de rate, T = nu. Met keylock geen toonwiebel. |
| **sync** | tempo meteen (T = nu), fase als sprong op T. Alternatief voor kleine fasecorrecties: even buigen in plaats van springen (geen latentie, geen seek). |
| **gat = stilte** | de invoer krijgt nullen waar een pagina ontbreekt; de stretcher smeert de randen over zijn blok. Een gat blijft stilte, nooit herhaling. |
| **`bron.knip` (sampler)** | leest van schijf, niet door de stretcher. Een pad speelt met playbackRate op de maat, dus zijn toon schuift mee met het tempo en volgt keylock en toon NIET. Met een deck op keylock 0,92 klinkt een pad van dat deck 1,4 halve toon lager dan het deck. Beslissing K7. |
| **video volgt audio** | ongewijzigd: de hoorbare positie is de segmentformule. Bij een geplande sprong springt het doel op T. |
| **fxKlok, gate, echo op de maat** | ongewijzigd (de klok komt uit de segmentformule, die klopt). Herankeren op T bij geplande sprongen. |
| **opname** | ongewijzigd (tapt de master). |
| **BufferBron (reserve)** | krijgt geen keylock (`get keylock() { return false; }` blijft). Voor tests en als terugval. |
| **keylock aan/uit tijdens het spelen** | wissel van weg, gepland op T; rond T draaien renderBlok en de stretcher allebei. Op R ≠ 1 zijn ze ongecorreleerd (andere toon): gewone equal-power fade. Op R ≈ 1 kiest de worklet de polariteit van de stretcher (teken van Σ a·b over de eerste ms van de fade, daarna vast voor dat deck); anders een dip tot −15 dB. |
| **toon wijzigen tijdens het spelen** | `_setTransposeSemitones` per blok, T = nu; de stretcher glijdt over één blok (120 ms). |
| **nieuw nummer laden** | toon terug naar 0 (zoals de pitch in `_naLaden`); keylock blijft zoals hij stond (een voorkeur, zoals het pitchbereik). Stretcher `_reset`. |
| **pieken** | tot 3,6 dB hoger (zang). De keten is float tot aan de master-limiter, dus niets clipt, maar de limiter werkt harder. Geen compensatie voorgesteld; meten in de app. |

### 4.6 Rekenwerk voor acht decks

- Gespreid rekenen AAN. Zonder: gemiddeld hetzelfde, maar samenvallende blokken van
  acht decks = 4,5 ms in één quantum (gemeten). Met: hooguit 0,85 ms (standaard) of
  0,45 ms (goedkoper) voor acht decks samen. Kost: +30 ms (standaard) of +40 ms
  (goedkoper) uitvoerlatentie, en die zie je alleen terug in de latentie van S1.
  (Alternatief zonder die latentie: blokken per deck in een eigen fase leggen, 180
  samples uit elkaar. Kan, maar moet over pauzes heen bewaakt worden; niet voorgesteld.)
- Gemiddeld 16% (standaard) of 11% (goedkoper) van één kern voor acht decks met
  keylock, tegen ~10% voor acht decks zoals nu. Een deck zonder keylock kost niets extra;
  een stilstaand deck ook niet.
- Twee stretchers per deck (alleen bij S2): de tweede rekent alleen tijdens een sprong.
  Geheugen 8 × 2 × 1,7 MB = 27 MB.
- Een snellere eigen build (SIMD, meerdere stretchers per module) kan later, vanaf de
  C++-bron (MIT, header-only), met emsdk als eenmalig gereedschap. Niet nodig.

### 4.7 Actions, stand en bediening

Volgens de conventies: eerst `define()` in `actions.js`, `value` genormaliseerd 0..1,
`trigger` een boolean.

```js
// Keylock per track. Standaard uit (K4).
define(`${n}.keylock`, 'trigger', (on) => { if (on) d.setKeylock(!d.keylock); },
  { label: `Track ${nr} keylock aan/uit`, read: () => (d.keylock ? 1 : 0) });

// Toon in halve tonen, ±12. De engine rondt af (K5); 0,5 = geen verschuiving.
define(`${n}.key.shift`, 'value', (v) => d.setToon(Math.round(clamp(v) * 24 - 12)),
  { label: `Track ${nr} toon (±12 halve tonen)`, bipolar: true, read: () => (d.toon + 12) / 24 });
define(`${n}.key.up`, 'trigger', (on) => { if (on) d.setToon(d.toon + 1); },
  { label: `Track ${nr} toon +1`, read: () => (d.toon > 0 ? 1 : 0) });
define(`${n}.key.down`, 'trigger', (on) => { if (on) d.setToon(d.toon - 1); },
  { label: `Track ${nr} toon −1`, read: () => (d.toon < 0 ? 1 : 0) });
define(`${n}.key.reset`, 'trigger', (on) => { if (on) d.setToon(0); },
  { label: `Track ${nr} toon terug naar 0`, read: () => (d.toon !== 0 ? 1 : 0) });
```

- Deck: `keylock` (bool), `toon` (geheel getal), `setKeylock()`, `setToon()`; beide
  melden `change`. De bron krijgt ze via het segment (`{ ..., keylock, toon }`), want
  een wissel is een tijdstip: regel 3.
- Elke nieuwe action krijgt een uitleg in `apc-beschrijf.js` (de test eist dat).
- Scherm: per kolom een KEY-badge (toon ±n, keylock-slotje) naast de BPM. Wordt de
  toonsoort gedetecteerd (andere agent), dan toont het scherm: gedetecteerde toonsoort
  + toon + (12·log2 R als keylock uit staat).
- Toetsenbord: een vrije toets voor keylock van de focus-track; niet uitgezocht welke.

**APC-voorstel** (focus-track, rechterkant, bij tempo-encoder, nudge en tap):

| knop | doet | LED |
|---|---|---|
| Bank (0x67, nu vrij) | keylock aan/uit | brandt als keylock aan staat |
| Shift + Bank | pitchbereik ±8/16/50 (was in VERBETERINGEN ronde 3 het voorstel voor Bank alleen) | – |
| Shift + Nudge − / + | toon −1 / +1 | (nudge heeft geen LED) |
| Shift + Tap Tempo | toon terug naar 0 | (tap heeft geen LED) |

In de grid-modus (`edit`) is Shift + Nudge al "grid ±1 ms"; mapje-regels gaan voor, dus
dat botst niet. **Kanttekening:** Clay's eigen mapping is een VOLLEDIGE kopie; nieuwe
regels in `mappings/apc40mk2.json` bereiken hem niet. Eerst ROADMAP 13 ("eigen mapping
als verschil bewaren"), of de handmatige samenvoeg-stap uit CLAUDE.md (Beatgrid,
laatste punt).

### 4.8 Wat er getest moet worden (in Node, zoals nu)

- `leesInvoer`: loop uitgerold, naad bit-gelijk aan leesSegment op R = 1, gat = 0.
- Hoorbare positie met klikken (controle 2) als test: ±1 ms op 0,92/1,00/1,08.
- Geplande sprong: klik op T, volle sterkte (controle 4).
- Segment met T in de toekomst: `positieIn` geeft tot T het oude segment, hoofdthread en
  worklet gelijk.
- Polariteitskeuze bij keylock aan/uit op 1,00: geen dip dieper dan −3 dB.
- De WASM laadt in Node via dezelfde fabriek (zoals `kern.mjs`), dus de engine-tests
  kunnen de echte stretcher gebruiken; geen mock die makkelijker is dan het echte ding.

---

## 5. Risico's

1. **Latentie bij springen** (S1: 63–93 ms, alleen op decks met keylock). Merkbaar bij
   hotcue-drummen, waarschijnlijk niet bij lange ambient-overgangen. Uitweg: S2.
2. **Pieken op de audiothread** zonder gespreid rekenen (gemeten 170% van het budget bij
   acht samenvallende decks), en bij opwarmen in één keer (S3). Uitweg: gespreid, S1/S2.
3. **Rekenwerk onder belasting** was tot 2× hoger (efficiëntiekernen). Chrome's
   audiothread is realtime; niet in Chrome gemeten.
4. **Polariteit** bij aan/uit op R ≈ 1: dip tot −15 dB zonder polariteitskeuze.
5. **Klank**: aanslagen smeren (blok van 120 ms), zang kan hol klinken, pieken tot
   +3,6 dB. Alleen het oor beslist (A3).
6. **Korte loops** (< 240 ms) met keylock niet beluisterd.
7. **Sampler** volgt keylock en toon niet (K7).
8. **Licentie**: MIT zonder LICENSE-bestand in het pakket; tekst uit de bron-repo halen.
9. **Vendoren**: een afgeleid bestand (knip uit het pakket) i.p.v. het origineel; de knip
   moet bij een nieuwe versie opnieuw (script, met hash-controle). De regeltest vlagt
   `document.` (submap of regel vervangen).
10. **Transponeren** zit 2–4 cent naast op een sinus. Niet te horen, wel meetbaar; bij
    stemgevoelig materiaal opletten.

## 6. Schatting

| stap | sessies |
|---|---|
| vendoren (script + LICENSE), `leesInvoer`, keylock-weg in `stream-lezer.js`, segment met toekomstige T in StreamBron en stream-kern, S1, gespreid, tests in Node | 1,5–2 |
| deck (`keylock`, `toon`), actions, `apc-beschrijf.js`, scherm (KEY-badge), toetsenbord, CLAUDE.md | 1 |
| APC-regels (na ROADMAP 13) | 0,25 |
| optioneel: S2 (aanloop ~20 ms), polariteitskeuze, sampler met toon | 1 |

Totaal **2,5–4 sessies**, na de luistertest (15 minuten).

## 7. Beslissingen voor Clay

> **Besloten op 24 september 2026:**
> - **Wanneer:** na 25 okt, vooraan in de Varve-lijst, direct na "mapping als
>   verschil bewaren" (ROADMAP 13) en na toonsoort.
> - **Door Clay gekozen:**
>   - K3: (a) ~95 ms, exact.
>   - K8: toestaan.
> - **Volgens het advies, tenzij Clay bezwaar maakt:**
>   - K5: halve tonen, ±12, terug naar 0 bij een nieuw nummer.
>   - K7: (a), de sampler blijft zoals hij is.
> - **Open:**
>   - K1, K2 en K4: na de luistertest (VRAGEN A3, `tools/keylock/LUISTER.md`).
>   - K6: na ROADMAP 13, eerst op `apc.html` bekijken.

Eén voor één, elk met een advies.

**K1. Wordt het Signalsmith?** 🎧 (VRAGEN A3)
Opties: ja · ja maar goedkoper (K2) · nee, verder zoeken.
Advies: ja, als 06/07 (±5%) op sakamoto en zoned-out een 0 of 1 scoren op de
scorekaart in `LUISTER.md`.

**K2. Welke instelling?** 🎧
Opties: standaard (120/30, beste bas) · goedkoper (100/40, ~35% minder rekenwerk) ·
kort (60/15, halve latentie bij springen, minder basdetail).
Advies: standaard, gespreid. Is 13 op je gehoor niet van 08 te onderscheiden, dan
goedkoper. Kort alleen als springen met keylock snel moet en 14 je bevalt.

**K3. Hoe snel moet een sprong zijn als keylock aan staat?** 💬
Opties: (a) ~95 ms, exact, eenvoudig (S1) · (b) ~20 ms, tweede stretcher per deck, +1
sessie (S2) · (c) meteen, met kans op tikken (S3).
Advies: (a), en (b) pas als het in een set stoort. Zonder keylock blijft springen direct.

**K4. Keylock standaard aan of uit?** 💬
Opties: uit (zoals nu, geen extra rekenwerk) · aan (het DJ-gebruik; op 1,00 gemeten
zonder klankverschil per octaaf, maar niet bit-gelijk).
Advies: uit, en keylock blijft staan bij een nieuw nummer (een voorkeur, net als het
pitchbereik). Blijk je hem altijd aan te zetten, dan later een instelling "standaard
aan".

**K5. Toonverschuiving: in welke stappen, en wat bij een nieuw nummer?** 💬
Opties: halve tonen ±12 · halve tonen ±6 · ook fijn (cent, bv. voor 432-Hz-opnames).
Advies: halve tonen, ±12, terug naar 0 bij een nieuw nummer (zoals de pitch). Fijn
pas als er een nummer om vraagt.

**K6. Waar op de APC?** 🎛
Voorstel: Bank = keylock (LED), Shift + Bank = pitchbereik, Shift + Nudge ± = toon,
Shift + Tap = toon 0. Na ROADMAP 13.
Advies: dit voorstel, maar eerst op `apc.html` kijken of het in de hand ligt.

**K7. Moet de sampler de toon van zijn deck volgen?** 💬
Nu: een pad speelt op de maat via playbackRate, dus zijn toon schuift mee met het tempo.
Opties: (a) zo laten · (b) pads met de toonverschuiving van hun deck (zonder keylock) ·
(c) pads door een stretcher (acht pads = acht stretchers).
Advies: (a) nu; (b) als je pads in een getransponeerd nummer gebruikt.

**K8. Transponeren zonder keylock?** 💬
Keylock uit maar toon ≠ 0: de toon schuift mee met het tempo PLUS de verschuiving.
Opties: toestaan (de stretcher draait dan) · toon alleen met keylock aan.
Advies: toestaan; het is dezelfde stretcher en het is voorspelbaar.

## 8. Aangenomen en niet gemeten

- Alles is in **Node** gemeten, niet in Chrome's AudioWorklet. Zelfde V8 en WASM, maar
  geen realtime-thread. De absolute rekentijd kan in Chrome anders uitvallen (naar
  verwachting eerder lager: prestatiekern).
- De M1 was tijdens de metingen niet stil (Clay's Chrome, andere agenten). Getallen
  onder zware belasting tot 2× hoger; de tabel is de rustigste run.
- **Niet beluisterd**: ik kan niet luisteren. Of het warbelt, smeert of hol klinkt,
  beslist Clay (A3).
- Niet gemeten: de rest van de audiograaf op dezelfde thread; Chrome's callbackgrootte
  (`baseLatency`); korte loops met keylock; formantbehoud op iets anders dan zang;
  keylock bij extreme tempo's (0,5 / 2).
- De fragmenten zijn gekozen op een scan van volume en aanslagen, niet op inhoud.
- De polariteitskeuze (4.5) en de spreiding van opwarmen (S2) zijn ontworpen, niet
  gebouwd of gemeten.
- ROADMAP noemde "2,91% per deck, ~23% voor acht" en "plan ~150 ms vooruit". Gemeten:
  2,0% / 16% (rustig) tot 5% / 30% (belast); vooruit plannen is alleen nodig voor
  sprongen, en dan uitLat + één blok (63–93 ms), niet voor tempo.
