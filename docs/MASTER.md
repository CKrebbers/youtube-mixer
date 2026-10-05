# De master: effecten op het geheel en een echte limiter

*5 oktober 2026 · ROADMAP 27, STUDIO S2a. Gebouwd in `src/engine/master.js`,
`src/engine/limiter-kern.js`, `src/engine/limiter-worklet.js`; scherm
`src/ui/master-paneel.js` en `src/ui/master-weergave.js`. Bewaking
`test/master.test.mjs`, meting `tools/headless/master.mjs`. Nog niet gehoord.*

---

## Kort

- **Een insert-rack op de hele mix**, vóór de limiter: hetzelfde racksysteem als
  een track (racks, acht knoppen, mix, aan/uit, glijden, drukvariant), op de maat
  van de maatgever. Actions `master.fx.*` en `master.rack.next/prev`.
- **Een echte limiter** in plaats van de DynamicsCompressor: een AudioWorklet met
  1,5 ms vooruitblik, plafond **−1 dBFS true peak** (piekdetectie met 4×
  oversampling), links en rechts gekoppeld, release 80 ms, 0 afval per blok.
  Onder het plafond doet hij niets: de uitvoer is bit voor bit de invoer, 1,5 ms later.
- **Wat je hoort** telt de vooruitblik mee (`hoorbaar.js`): LED-fase, "tel 1 hier",
  video, puls en vormen volgen.
- **Scherm**: een MASTER-rij (knop "master" in de balk) en de gain reduction als
  rode balk naast de mastermeter. **APC**: Shift + Clip/Device View = het mapje master.

## De keten

```
tracks, bussen, sampler, klankschaal
        │
  input = gain (masterfader)
        │
  fx  (InsertSlot: droog ─┬─ keten (rack) × nat ─┐)
        │                                       │
        ├────────── compressor ── compUit ──┐   (tot de worklet er is)
        └────────── limiter-worklet ── wl ──┴── limiter (uitgang van de stap)
                          └ uitgang 1: de gain per sample ── analyser (gain reduction)
                                                  │
                                              analyser ── de zaal (uitgang, of kanaal 1/2)
                                                  ├── koptelefoon: de zaal (zaalKant)
                                                  ├── opname (opnemer.js)
                                                  └── vormen, luisteraar ("wat de zaal hoort")
```

`master.analyser` blijft het eind: opname, de zaal in de koptelefoon en de vormen
tappen daar, na de limiter, zoals altijd. `master.limiter` is de UITGANG van de
limiterstap (daar komen compressor- en workletpad samen); de compressor zelf is
`master.compressor`, de worklet `master.limiterNode`.

`createMasterChain(ctx, uit)` bestaat nog (audio-graph.js zet hem door naar
master.js), dus de engine maakt de master zoals vroeger.

## De limiter

Per sample (`LimiterKern.render`, `limiter-kern.js`, zonder imports):

1. **Piek** van het stuk tussen sample j en j+1: |x[j]| en drie tussenwaarden
   (¼, ½, ¾), per kanaal, met een windowed sinc (Blackman) van **24 tikken per
   fase**. Niet de 12 van ITU-R BS.1770: die zakken boven 15 kHz weg (−0,9 dB op
   18 kHz) en lazen muziek met hihats 0,08 dB te laag. 24 tikken: vlak tot 18 kHz
   (−0,002 dB), −0,19 dB op 20 kHz. Daarvoor kijkt hij K = 12 samples vooruit.
2. **Nodig**: de gain die die piek op het doel zet. Het doel ligt **0,1 dB** onder
   het plafond (`MARGE_DB`): vier punten per sample missen de top van een golf die
   ertussen valt (bij 5 kHz hooguit 0,03 dB, bij een zuivere toon van 10 kHz 0,12 dB).
3. **Vasthouden**: het minimum van "nodig" over L + 1 = 61 samples (een deque),
   dan de envelop: meteen omlaag, terug met een release van 80 ms (één-polig, in
   amplitude: in dB eerst snel, dan zacht; na 80 ms van −7,1 dB nog −2,0 dB).
4. **Gladmaken**: het gemiddelde van de envelop over dezelfde 61 samples. De gain
   zakt zo lineair in 1,25 ms naar het niveau van de piek en staat er precies als
   de piek naar buiten komt. Elke envelopwaarde in dat venster is ≤ wat de
   uitgaande sample nodig heeft, dus het gemiddelde ook: het plafond is gegarandeerd.

Het geluid gaat **N = L + K = 72 samples** (1,5 ms) vertraagd naar buiten. Links
en rechts krijgen dezelfde gain (de piek is het maximum van beide). NaN of ±∞ van
verderop wordt 0. Een hard vangnet op het plafond telt wat het moest klemmen
(`geklemd`; in alle metingen 0).

**Onder het plafond precies niets.** Waar geen piek het doel haalt is "nodig" 1,
de envelop 1 en de lopende som van 1 − e precies 0 (die som wordt elk blok exact
opnieuw opgeteld, tegen drift), dus de gain is precies 1: geen pompen, geen ruis
van afronding. En kan geen enkele piek het doel halen (elke sample onder doel /
som van de tikken, −8,5 dBFS), dan rekent hij de interpolatie niet eens uit.

**Rekentijd en afval.** Luid (elke sample geïnterpoleerd) ~16 µs per blok van 128
(0,6% van de 2,67 ms), zacht bijna niets. Geen afval per blok: alles staat vooraf
in Float64Arrays, de invoer twee keer achter elkaar (dan hoeft de binnenste lus
niet te maskeren), de rest zijn hele getallen en doubles in velden (docs/AUDIOPAD.md).
De worklet geeft uitgang 1 (de gain per sample) door: de hoofdthread leest de gain
reduction met een AnalyserNode, zonder berichten of SharedArrayBuffer.

## Laden: van compressor naar worklet

De worklet laadt async (`addModule`). Daarom maakt de master eerst de compressor
van vroeger, en zet de engine het laden meteen in gang (bij het maken, dus vóór
"audio starten"):

- **De context staat nog stil** (de gewone gang): compressor eruit, worklet erin.
  Er loopt geen geluid, dus herbedraden mag.
- **De audio loopt al** (laden duurde lang, of Chrome startte de context meteen):
  een equal-power kruisfade van 40 ms van het ene complete pad naar het andere,
  na de startdrempel, met hellingen (geen setValueCurveAtTime). Het compressorpad
  gaat pas los als de fade op de audioklok voorbij is. Gemeten midden in een toon
  van 440 Hz: geen sprong in de golf. Let op: de compressor is 6 ms vertraging,
  de worklet 1,5 ms; in die 40 ms hoor je ze allebei, 4,5 ms uit elkaar.
- **Laden mislukt** (geen AudioWorklet, een fout): de compressor blijft, en de rij
  zegt het (oranje, met de reden in de tooltip).

`master.klaar` is een belofte: waar als de worklet erin zit. Wie op een
OfflineAudioContext meet (tools/headless/*.mjs) wacht daarop vóór het renderen.

**De compressor van vroeger, gemeten in Chrome:** 288 samples (6,0 ms) vertraging
(zijn eigen vooruitblik, nergens meegeteld) en ~0,7–0,85 dB versterking onder de
drempel (de automatische make-up van DynamicsCompressor). De nieuwe limiter is
onder het plafond 0 dB: **de master klinkt dus ~0,8 dB zachter dan vroeger** tot
de limiter werkt, en pieken komen niet meer tot ~−0,6 dBFS maar tot −1 dBTP.

## Wat je hoort

`uitgangsVertraging(ctx)` = outputLatency + baseLatency + **`ctx.graafVertraging`**
(hoorbaar.js). De master zet die (`zetGraafVertraging`) op 1,5 ms met de worklet,
6 ms met de compressor. Op de context zelf en niet in de module: het losse
videovenster (video.html) laadt zijn eigen kopie van hoorbaar.js en leest dezelfde ctx.

## Het insert-rack

`engine.master.fx` is een gewone `InsertSlot` (fx.js): de engine geeft hem de klok
van de maatgever (zoals de bussen) en herankert hem bij elke 'change'. Standaard
het filter, mix 0: niet hoorbaar tot je MIX opendraait, net als bij een track.

**Opslag**: in `localStorage` (`varve.master.rack`): de inhoud van het rack
(`naarJSON`) en, als het een sjabloon was, zijn NAAM. Terugzetten bij het
opstarten (master-paneel.js): eerst de inhoud (die klinkt), en als
`racks/sjablonen.json` binnen is de herkomst, op naam (verschuift de volgorde in
het bestand, dan blijft het hetzelfde sjabloon). MIX en de knopstanden worden niet
bewaard: sessietoestand, zoals bij een track, en een master die nat opstart wil je
nooit. Geen server: de master hoort bij deze browser, niet bij een nummer
(een instelling op de server kan later, als het op twee machines moet).

**Kiezen**: de kant-en-klare racks (`racks/sjablonen.json`) en de zeven losse
effecten. `master.rack.next/prev` bladert door de kant-en-klare, `master.fx.next`
door de losse effecten. De rack-editor werkt (nog) niet op de master.

## Actions

| action | soort | doet | read |
|---|---|---|---|
| `master.fx.mix` | value | dry/wet (equal power) | de mix |
| `master.fx.bypass` | trigger | effect aan/uit | 1 = uit, 0 = aan, null = geen effect |
| `master.fx.knob.1`–`8` | value | plek 1–8 van het rack | de stand, null als het rack die plek niet heeft |
| `master.fx.knob.N.hold` | trigger | vol open zolang je drukt, loslaten = terug | 1 zolang ingedrukt |
| `master.fx.next` | trigger | volgend los effect | — |
| `master.rack.next` / `.prev` | trigger | volgend / vorig kant-en-klaar rack | — |

Zelfde namen als bij een track (`track.N.fx.*`, `track.N.rack.*`). De fx-actions
staan in `bindEngine`, de rack-actions in `bindApp` (de lijst kent de schermlaag).
Terugspelen slaat ze niet over (de zaal hoorde ze); de knopstanden staan in de
beginstand van het handelingenlog.

## APC: het mapje master

Shift + Clip/Device View opent het (een derde mapje van de device-groep, zoals
"vorm"; vasthouden = gluren). Alleen regels ERBIJ (13), niets bestaands veranderd.

| knop | in het mapje master |
|---|---|
| device knob 1–7 | `master.fx.knob.1`–`7` (ring = stand) |
| device knob 8 | `master.fx.mix` |
| shift + device knob 8 | `master.fx.knob.8` |
| Device ◀ ▶ | `master.rack.prev` / `next` |
| Device On/Off | `master.fx.bypass` (groen = effect aan) |
| Clip/Device View | terug naar de strip |

Bank (beatjump), Lock (quantize), Detail View en de rest doen wat ze deden.
Knop 8 = mix is een keuze: de mix is op de master de knop die je het meest nodig
hebt, en geen sjabloon en geen los effect gebruikt plek 8. Clip/Device View brandt
niet in het mapje master (zijn lampje hoort bij strip/rack; die regel is niet aangeraakt).

## Scherm

De MASTER-rij (knop "master" in de balk, onthouden, standaard dicht): rackkiezer,
› (volgend los effect), aan/uit, MIX, de acht knoppen met de namen van het rack
(lege plekken dof; alt + vasthouden = de drukvariant), en rechts de gain
reduction (balk tot 12 dB, tekst) en wat er werkt ("limiter −1 dBTP · 1,5 ms", of
oranje "compressor"). Naast de mastermeter in het focusdeel een dunne rode balk
die van boven naar beneden groeit: de gain reduction, ook als de rij dicht is.
Getoond: meteen dieper, terug met 20 dB/s (anders flikkert het). In het mapje
master tonen de device knobs op het scherm de namen van het master-rack.

Snapshot: `masterFx` (zoals `fx` van een track, plus `herkomst`) en `limiter`
(`soort`, `gr` in dB ≤ 0, `vertraging`, `plafond`, `fout`).

## Metingen (5 okt)

`node test/master.test.mjs` (kern in Node, worklet in een nagebouwde
AudioWorkletGlobalScope, keten en bus op een nep-Web Audio):
- muziek-achtig (kick tot +6,2 dB, akkoord, hihat-ruis): sample-piek −1,10 dBFS,
  true peak (16×, 96 tikken) **−1,04 dBTP**; zuivere tonen 1–15 kHz op +6 dB ≤ −1,06;
- stationair onder het plafond, 10 s: gain in elke sample precies 1, uitvoer bit
  voor bit de invoer 72 samples later;
- de aanval begint binnen de vooruitblik (hooguit 60 samples) vóór de piek, grootste stap 0,009 per sample; release
  zonder terugzakken; stereo gekoppeld (afwijking 6·10⁻⁸);
- 0 GC over 12 000 blokken (kern én worklet), ~16 µs per luid blok.

`node tools/headless/master.mjs` (Chrome, de echte engine op een OfflineAudioContext):
- pieken tot +6,2 dB: true peak (16×) **−1,04 dBTP**, gain reduction tijdens het
  renderen −5,6 dB (ook in de snapshot);
- stationair op −2,1 dBFS: 0 dB gain reduction op 0,5 / 1,0 / 1,5 s, uitvoer = invoer
  72 samples later (afwijking 8·10⁻¹⁸);
- een tik: 72 samples later, = `ctx.graafVertraging`;
- insert-rack: droog stilte na de toon (−364 dBFS), delay −40 dBFS staart, galm −28 dBFS,
  eindig en onder het plafond;
- compressor → worklet midden in 440 Hz: geen sprong; de compressor van vroeger 6,0 ms en +0,85 dB;
- de app: worklet geladen, de rij, kiezer, onthouden na herladen, het mapje master op het scherm.

## Grenzen en open punten

- **Niet gehoord.** Of 80 ms release goed klinkt als de master echt hard in de
  limiter staat (bij een korte release gaat de gain mee met de bas: vervorming) is
  aan Clay's oren. Programma-afhankelijke release is niet gebouwd; de release is
  een optie van de kern (`release`), dus proberen kost één getal.
- ~~De cue in de koptelefoon liep 1,5 ms vóór de zaal~~ (kamfilter met MIX in het
  midden). Opgelost op 5 okt: een DelayNode van `master.vertraging` op de cue-som in
  koptelefoon.js (`zetVertraging`, ook na de wissel compressor → worklet). Gemeten in
  Chrome: cue en zaal van dezelfde track tellen precies op (verhouding 1,0000).
  Effecten met eigen vertraging in het MASTER-rack (compressor 6 ms, pitch) zitten daar
  niet in: dan loopt de cue weer iets voor.
- **Breedbandig materiaal op volle sterkte tot de Nyquist** (een bitcrush op de
  master, ruis): 4× ziet de top tussen de punten niet altijd; tot ~0,25 dB over het
  plafond gemeten op gealiaste ruis, 0,02 dB op een blokgolf zonder bandbegrenzing.
  Muziek en de bestaande effecten blijven eronder.
- **De master klinkt ~0,8 dB zachter dan met de compressor** (die tilde alles op).
- **Handelingenlog**: welk master-rack er in zit staat er niet in als gebeurtenis
  (bij tracks wel). `master.rack.next/prev` en `master.fx.next` worden teruggespeeld
  vanaf het rack dat dan in de master zit; meestal hetzelfde (het is onthouden).
- **De rack-editor** bewerkt de master niet; bewaren als eigen rack kan niet.
- **Op de APC** niet nagelopen: of Shift + Clip/Device View lekker ligt, en knop 8 = mix.
