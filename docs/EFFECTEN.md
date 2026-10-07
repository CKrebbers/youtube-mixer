# Effecten uit de filter app (gebouwd 5 okt 2026)

**STUDIO S2c.** Tien effecten uit Clay's filter app (`~/Projects/filter app/`,
9 sep: `effects.js` en `worklets.js`) zitten nu in de racks, achter de zeven die
Varve al had. Daar waren het klassieke scripts op `window.FX` met
`{ params, build(), apply(k, v) }`; hier is het hetzelfde geluid in het contract
van `fx.js` (EFFECTEN): parameters 0..1, de schaling in code, een `eenheid` per
parameter met dezelfde formule als `zet()`, een staarttijd, `vernietig()`.

Code: `src/engine/fx-meer.js` (de effecten), `fx-lfo.js` (de LFO van tremolo en
autopan, vrij of op de maat), `fx-kern.js` (rekenkernen van de worklets, puur),
`fx-worklet.js` (de worklet, laadt pas bij gebruik). `fx.js` zet `MEER_EFFECTEN`
achter zijn eigen zeven in `EFFECTEN`: kiezer, editor, `track.N.fx.next` en de
racks kennen ze daarmee vanzelf.

Bewaking: `test/effecten.test.mjs` (Node, in `test/alles.mjs`) en
`tools/headless/effecten.mjs` (echte Chrome, OfflineAudioContext, geen MIDI, geen
app; `VARVE_KIJK_POORT`/`VARVE_KIJK_DEBUG`, `--snel` = 6 s in plaats van 20 s).

## Kort

| effect | herkomst (filter app) | parameters | staart |
|---|---|---|---|
| Distortion | `DEFS.distortion`, `makeCurve` | drive, soort, toon, niveau, meng | 0 |
| Chorus | `DEFS.chorus` | snelheid, diepte, vertraging, meng | langste vertraging (≤ 80 ms) |
| Flanger | `DEFS.flanger` | snelheid, diepte, vertraging, feedback, meng | rondgangen tot −60 dB (≤ 4 s) |
| Vibrato | `DEFS.vibrato` | snelheid, diepte | ≤ 22 ms |
| Tremolo | `DEFS.tremolo` | snelheid, diepte, vorm, sync | 0 |
| Autopan | `DEFS.autopan` | snelheid, diepte, vorm, sync | 0 |
| Auto-wah | `DEFS.autowah` + `EnvelopeProcessor` | gevoel, basis, bereik, reso, aanzet, verval, meng | naklinken bandpass (≤ 2 s) |
| Pitch | `DEFS.pitch` + `PitchShiftProcessor` | interval, meng | 0,1 s |
| Compressor | `DEFS.compressor` | drempel, ratio, aanzet, verval, makeup, meng | 11 ms |
| Breedte | `DEFS.widener` | breedte, haas | haas + 5 ms |

**Niet overgenomen**, met reden:
- **Geheugen** (90 s ringbuffer, brengt af en toe een fragment van 40 s geleden
  terug). Niet zinvol in een insert-rack: elke rackwissel en elke ketenwijziging in
  de editor bouwt een nieuwe keten, dus het geheugen begint steeds leeg; 17 MB per
  exemplaar; het kiest met `Math.random` op de audiothread (een teruggespeeld
  handelingenlog klinkt dan anders); en de "samenval" waar hij op reageerde bestaat
  in Varve niet. Hoort eerder bij een instrument of de master (S5).
- **Dubbel met wat er al is** (niet vervangen): filter, delay, galm, bitcrusher,
  ringmod, phaser; ook de 3-bands EQ (de kanaalstrip) en Volume/Pan. Waar de
  filter app iets heeft wat Varve mist, staat onderaan ("Wat de filter app beter doet").

## De regels, en hoe ze hier zijn gehouden

- **Klikvrij verzetten.** Een gain, frequentie of Q glijdt (`setTargetAtTime`,
  τ 20 ms). Alles met een **vertraging** (chorus, flanger, vibrato, haas) gaat
  met de **twee koppen** van de delay: een nieuwe vertraging of diepte op de stille
  kop, en daar lineair naartoe (50 ms, na `startDrempel`); snel doordraaien wacht
  tot de overgang klaar is en pakt dan de LAATSTE stand. Hetzelfde patroon
  (`wisselaar` in fx-meer.js) voor een andere **vorm** van de distortion en een
  andere **drempel/ratio** van de compressor (Chrome rekent die per blok: trapjes).
  Lineair en niet equal-power: beide paden dragen (bijna) hetzelfde signaal, en
  lineair komt nooit boven 1, ook niet in de lus van de flanger.
- **Inloop.** Een nieuwe keten begint met lege vertragingslijnen; de vertraagde
  kopie begon dan abrupt midden in een golf (gemeten: chorus ×21, compressor ×23
  boven de gewone tweede afgeleide). Alles met geheugen zit achter een gain die in
  30 ms opengaat (`inloop`); de test loopt de graaf na.
- **Tijdens het bouwen meteen** (`zetter`): zolang de klok niet verder is dan bij
  het bouwen, zet `zet()` de waarde direct in plaats van te glijden, en elk effect
  zet zichzelf bij het bouwen op zijn standaard (`opStandaard`). Zo klinkt een
  effect vanaf de eerste sample zoals zijn knoppen staan, niet een tiende seconde
  lang op de beginwaarden van Web Audio (gain 1, een lowpass op 350 Hz).
- **Een stand die wacht** wordt niet alsnog gezet als er intussen een nieuwere kwam
  (de timer vuurt pas ná het einde van de overgang; de delay van fx.js wist dat niet).
- **Lussen.** Alleen de flanger heeft er een (met een DelayNode, geen filter).
  Chrome klemt een vertraging in een lus op één render quantum (2,67 ms): de zwaai
  blijft daarom boven 2,8 ms. De test loopt voor alle zeventien effecten na dat elke
  lus een vertraging heeft en geen lowpass/highpass met een bult (Q > −3 dB).
- **Worklets lui en één keer.** `laadFxWorklet(ctx)`: `addModule` één keer per
  AudioContext, pas bij het eerste effect dat hem nodig heeft. Tot hij er is klinkt
  pitch helemaal droog en staat de auto-wah stil op zijn basis; daarna vloeien ze in
  (50 ms). Is de module er al, dan komt de node meteen, tijdens het bouwen. Mislukt
  laden: droog, geen fout, het volgende effect probeert het opnieuw. Een context
  zonder `audioWorklet` (de mock) bouwt gewoon. `vernietig()` stuurt de processor
  'stop' (daarna geeft `process()` false: anders houdt hij zichzelf in leven).
- **Geen afval op de audiothread.** `fx-kern.js` volgt `docs/AUDIOPAD.md`: buffers
  in de constructor, per-blokwaarden als veld, geen double over een functiegrens.
  Gemeten: 0 GC over 12 000 blokken, 256 bytes heapgroei (het object van
  `memoryUsage` zelf), 11 µs per blok voor toonhoogte + omhullende samen.
- **Op de maat** (tremolo, autopan): de klok van het deck (`fxKlok`), net als delay
  en gate. Zie "De LFO".
- **Bypass** is bit voor bit de invoer: zowel de FX-knop van het rack als een effect
  dat in het rack uit staat (gemeten in Chrome, alle tien: 0 afwijkende samples).

## Per effect

Eenheden zoals het scherm ze toont (`toonWaarde`). De test leest voor elk effect,
elke parameter en 21 standen wat `zet()` echt op de nodes zette en vergelijkt dat
met de tekst tot op de laatste decimaal (861 standen in totaal).

### Distortion
- **drive** 0..1 → voorversterking ×1 tot ×31 (zacht), ×61 (hard, fuzz), ×11
  (vouw), zoals de filter app (`k = 60·drive`). Scherm: `+29,8 dB`.
- **soort** zacht (tanh) · hard (klippen) · fuzz (1 − e^−|x|) · vouw (driehoek),
  vier trappen.
- **toon** lowpass 300 Hz – 20 kHz (Q −3 dB: geen bult). **niveau** −12..+12 dB
  (bipolair). **meng** droog/nat equal-power (filter app: standaard 1).
- **Anders dan de filter app:**
  - de vorm ligt VAST per soort (16385 punten over invoer × [−128, 128]) en drive is
    een gain ervoor: draaien glijdt, in plaats van bij elke stap een nieuwe curve
    (een curve vervangen is een sprong). Een andere soort gaat op een tweede vormer;
  - **gelijke luidheid**: bij elke drive komt een sinus met piek 0,3 (rms −13,5 dBFS)
    even luid uit (`compVan`, binnen 0,001 dB). Gemeten op ruis + tonen: drive 0 / ½ / 1
    = +0,0 / +1,9 / +2,2 dB (zacht), −0,0 / +2,3 / +2,4 (hard), +0,2 / +2,1 / +2,3 (fuzz),
    −0,0 / +3,5 / +1,6 (vouw). In de filter app werd elke draai tot ~13 dB harder;
  - **geen oversampling**. Gemeten in Chrome: `2x` vertraagt de vormer 128 samples,
    `4x` 192. Met de mix-knop van het rack (droog + nat) is dat een kamfilter over
    het hele nummer. De prijs: aliasing. Hard, drive 1, een zuivere toon van 3150 Hz:
    de spiegeling ligt 14,8 dB onder de harmonischen (op een vol nummer valt het weg
    in de vervorming zelf, op een fluittoon niet).

### Chorus
- **snelheid** 0,05–10 Hz (exp), stem 2 op × 1,23. **diepte** = uitslag ±0..0,6 ×
  vertraging (scherm `±4,3 ms`). **vertraging** 3–40 ms (exp), stem 2 op × 1,35.
  **meng** equal-power.
- Twee stemmen als in de filter app: sinus en driehoek in tegenfase, een halve kant
  links en rechts (StereoPanner ∓0,5). **Anders:** de stemmen tellen voor de helft
  (in de filter app werd de bas met de mix in het midden 6 dB luider), en verzetten
  gaat met twee koppen per stem.
- Gemeten (standaard): −0,8 dB, zij/midden +19,8 dB (breder), modulatie +0,39.

### Flanger
- **snelheid** 0,02–10 Hz. **vertraging** 3–15 ms (het midden van de zwaai).
  **diepte**: zwaai van 2,8 ms tot 2 × vertraging − 2,8 ms (scherm `2,8–7,0 ms`).
  **feedback** −95%..+95% (bipolair). **meng** equal-power.
- **Anders dan de filter app:**
  - de zwaai blijft boven 2,8 ms. Chrome klemt een vertraging in een lus op 2,67 ms;
    in de filter app (0,5–12 ms, zwaai tot ×0,9) bleef hij daar hangen. De
    "jet" door nul kan dus niet; dat kan alleen in een worklet;
  - de lus krijgt √(1 − fb²) als ingang: een kam met terugkoppeling g versterkt
    ruis met 1/(1 − g²), zo blijft hij bij elke feedback even luid. De pieken op de
    resonanties blijven (bij 95%: ~+16 dB op een toon die er precies op valt).
- Gemeten: 20 s op volle feedback, beide tekens: eindig, groei 0,0 dB, piek ≤ 0,67.
  Staart 3,67 s op +95%, daarna −133 dB.

### Vibrato
- **snelheid** 0,1–15 Hz. **diepte** ±0..8 ms (filter app). Geen meng: 100% nat.
- **Anders:** de basisvertraging volgt de diepte (uitslag + 0,5 ms; op 0 precies 0)
  in plaats van vast 10 ms: een ondiepe vibrato schuift het nummer niet 10 ms t.o.v.
  de andere tracks. Gemeten (standaard, 5 Hz ±2,4 ms): piek 440 → 464 Hz.

### Tremolo en autopan (de LFO)
- **snelheid**: op de maat een deling (`4/1 2/1 1/1 1/2 1/4 1/8 1/8T 1/16 1/16T 1/32`,
  knop rechts = sneller), vrij 0,1–30 Hz (tremolo) of 0,05–20 Hz (autopan).
  **diepte** 0–100%. **vorm** sinus · driehoek · blok · zaag. **sync** vrij / op de maat
  (standaard **op de maat**).
- Tremolo: gain = 1 − d/2 + d/2 · golf (filter app), vol op de tel. Autopan:
  pan = −d · golf, links op de tel.
- **De LFO** (`fx-lfo.js`) is geen OscillatorNode maar één cyclus als AudioBuffer,
  lopend, met een playbackRate die de periode exact maakt (zoals de gate). Een
  nieuwe bron start METEEN op de fase waar hij hoort te zijn (`start(t, offset)`) en
  vloeit 20 ms in de oude over: herankeren na tempo, sprong of grid is geen gat van
  een tel en geen sprong in de gain. Klopt tempo en fase al, dan gebeurt er niets.
  Een golf van meer tellen (1/1 = vier) houdt na een sprong de tel van de cyclus waar
  hij zat. Zonder klok de laatst bekende tel (niet terug naar 120 bpm). Vrij: een
  andere snelheid glijdt op dezelfde bron.
- Blok en zaag hebben randen van 3% van de periode (een halve cosinus): een harde
  rand is een tik.
- **Op de "1" van de maat kan hij niet**: `fxKlok()` geeft alleen de volgende tel.
  Een 1/1-tremolo begint dus op een tel, niet per se op de eerste van de maat (de
  gate doet hetzelfde). Daarvoor zou `fxKlok` de maatfase moeten meegeven (deck.js).
- Gemeten (standaard): tremolo −3,8 dB, modulatie +0,48; autopan +2,2 dB (StereoPanner
  legt de ene kant bij de andere), balans +0,47. Herankeren 120 → 128 bpm midden in een
  toon: tremolo ×2,7 (2,8e-4: onder de drempel van een tik), autopan ×1,5.

### Auto-wah
- **gevoel** ×1..×13 op de omhullende (filter app). **basis** 60–3000 Hz. **bereik**
  0–4 octaven omhoog, nooit boven 20 kHz (scherm `2,4 oct`, met de basis erbij).
  **reso** Q 0,5–20. **aanzet** 1–300 ms, **verval** 10 ms–1 s. **meng** equal-power.
- De omhullende is de `EnvelopeProcessor` van de filter app (fx-kern.js, gemeten:
  63% na de aanzet, 37% na het verval). Daarachter een zachte begrenzing (tanh)
  en dan pas het bereik.
- **Anders dan de filter app:**
  - de filter app duwde het filter met omhullende × gevoel × 4800 cent omhoog, zonder
    grens: op een luid nummer liep het tegen Nyquist en viel de wah weg;
  - nat × √(2Q), hooguit × 4: op roze ruis was de wah met meng 1 in de filter app
    7 (Q 0,5) tot 21 dB (Q 20) zachter dan droog, nu 5–9 dB. Een toon precies op de
    piek komt hooguit 12 dB boven zichzelf.
- Gemeten in Chrome: zwaartepunt 491 Hz bij zachte ruis, 1567 Hz bij harde.

### Pitch
- **interval** −24..+24 halve tonen (49 trappen, bipolair, scherm `+7 ht`).
  **meng** equal-power. Standaard +7 (filter app).
- Granulair (filter app): twee leeskoppen in een sinusvenster, korrel 90 ms, een halve
  korrel uit fase. Gemeten in Chrome: +7 / −12 / +12 → 100% van het vermogen binnen
  30 Hz van het nieuwe interval, 0,00% op 440; +0,8 dB.
- **Let op:** het nat loopt gemiddeld ~45 ms achter (een halve korrel). Met meng 1 op
  een heel nummer staat dat 45 ms naast het grid. Als harmonizer (meng ½) is dat
  geen probleem; voor transponeren is keylock (`docs/KEYLOCK.md`) de weg. Op 0
  halve tonen is het een vaste kam van twee vertragingen, niet droog.

### Compressor
- **drempel** −60..0 dB. **ratio** 1–20 (exp). **aanzet** 1 ms–1 s, **verval**
  10 ms–1 s. **makeup** −12..+12 dB (bipolair, standaard +6). **meng** (standaard 1).
  Knie vast 12 dB (filter app).
- **Anders dan de filter app:**
  - Chrome's DynamicsCompressor doet ZELF make-up: (1 / curve(1))^0,6. Op drempel
    −24, ratio 4 is dat +8,21 dB (gemeten in Chrome; `chromeMakeup` rekent +8,207).
    Die wordt eruit gedeeld: onder de drempel komt het signaal er even luid uit, en
    `makeup` is echt wat erbij komt. In de filter app kwam er op de standaard ~12 dB bij;
  - Chrome kijkt 6 ms vooruit (288 samples op 48 kHz, gemeten): het droge pad van
    `meng` wacht even lang. Gemeten met meng ½: spectrum vlak binnen 0,1 dB; zonder
    die wachttijd een kam van 7,0 dB;
  - twee compressoren voor drempel en ratio (zie de regels).
- **Let op:** de hele track komt 6 ms later dan de andere (ook het droge pad). En de
  **mix-knop van het rack** heeft die 6 ms niet: daarmee half nat is een kam. Voor
  parallel comprimeren: de eigen `meng`.
- Gemeten: op stappen van 20 dB (kwartseconden) −5,2 dB minder dynamiek.

### Breedte
- **breedte**: de zijkant × 0..2 (scherm `150%`; 100% = onveranderd, 0% = mono).
  **haas**: rechts 0–25 ms later (scherm `uit` op 0).
- De filter app had alleen haas. Midden/zijkant komt erbij omdat dat mono-
  compatibel is (een PA die naar mono optelt hoort niets wegvallen); haas werkt ook
  op een mono stem maar is een kam in mono, en de mix-knop van het rack maakt er dan
  ook een kam van. Haas verzetten gaat met twee koppen.
- Gemeten (standaard 150%): zij/midden +3,5 dB, verder niets.

## Sjablonen (`racks/sjablonen.json`)

Vijf nieuwe, allemaal met de beginstand op droog (gemeten: +0,0 dB t.o.v. de invoer):

| sjabloon | keten | knoppen |
|---|---|---|
| Draaikolk | autopan (op de maat) → flanger → filter | Draai (pan + flanger erin), Tempo (1/2 … 1/16), Straal (feedback), Kleur (filter) |
| Oude band | vibrato → distortion → chorus → filter | Slijtage (wiebel + vervorming + dof), Wiebel, Zweef (chorus), Vuil (drive), Dof (toon) |
| Hakker | tremolo (blok, op de maat) → autopan → filter | Hakken, Deling (1/4 … 1/16), Zwaai, Vorm (blok → zaag), Dun (highpass) |
| Koor | pitch → chorus → reverb | Koor (alles erin), Interval (kwint / octaaf), Ruimte, Glans |
| Kwaak | auto-wah → distortion → breedte | Kwaak, Toon (basis), Vuil, Breed |

Alle knoppen open (ruis + 440 Hz): Draaikolk −16,1 dB (het highpass), Oude band
+0,9, Hakker −10,1, Koor +0,2, Kwaak −9,7; nergens boven 0,83 piek.

## Wat gemeten is (5 okt)

Node (`test/effecten.test.mjs`): contract, alle parameters op 0/1/NaN/±Infinity
zonder fout en zonder één niet-eindige waarde op een node, staarten, vernietig,
lussen (17 effecten), inloop, eenheden (861 standen), twee koppen, distortion,
compressor, LFO (fase op de tel, herankeren, zonder klok), worklets (één keer laden,
droog tot hij er is, opruimen tijdens het laden, mislukken), de insert-slot, de
kernen (toonhoogte, omhullende, 0 GC). `rack.test`: de vijf sjablonen, en een
oudere versie die een nieuw effect niet kent bewaart het ongeschonden.

Chrome (`tools/headless/effecten.mjs`, 75 checks): zie de getallen hierboven; verder:
- 20 s met elke knop op 0 en op 1 (en de uitersten van flanger en wah): eindig, groei
  hooguit 0,0 dB, piek ≤ 1,58 (distortion met niveau +12 dB);
- na `staart()` is elk effect stil (hooguit −91,9 dB t.o.v. het signaal, de flanger
  op −95%; de rest onder −130 dB);
- elke knop van de standaard naar het uiterste midden in een toon van 110 Hz, een
  effectwissel vanaf het filter, en herankeren: geen sprong. De tweede afgeleide
  steekt hooguit ×2,5 boven vóór/erna uit, of blijft onder 2e-3 (een sprong van
  −54 dBFS). Alleen door het glijden zelf erboven: flanger meng ×5,3 (6,3e-4),
  compressor makeup ×4,4 (3,5e-4), pitch interval ×3,1 (9,9e-4), tremolo
  herankeren ×2,7 (2,8e-4);
- Ter vergelijking de oude: de **delay** van fx.js gewisseld vanaf het filter gaf
  ×46 (4,9e-3): zijn echo begon abrupt na de echotijd. Sinds 5 okt heeft hij dezelfde
  `inloop()`: ×1,61 (1,7e-4).

## Wat NIET getest is (oren nodig)

- Of het klinkt: alles hierboven is gemeten, niets beluisterd. Vooral: de chorus
  (twee stemmen, ∓0,5 gepand, zoals de filter app), de flanger zonder "jet" onder
  2,8 ms, de distortion zonder oversampling, de wah met de nieuwe niveaucompensatie,
  de korrel van de pitch (90 ms) op zang.
- Tremolo en autopan op de maat met een echt nummer en de APC (tempo, sprongen, loops).
- De sjablonen: of de knoppen musicaal liggen.
- Belasting: acht decks met elk een rack van vier nieuwe effecten (de worklets zijn
  goedkoop: 11 µs per blok; Chrome's eigen nodes niet gemeten).

## Wat de filter app beter doet (niet overgenomen, alleen gemeld)

- **Bitcrusher**: de filter app heeft ook sample-reductie (vasthouden, 1–64×), de
  klassieke "lage samplefrequentie"-krak. Varve's `crush` doet alleen de bits.
- **Delay**: ping-pong. Verder is Varve's delay beter (twee koppen, op de maat; de
  filter app verschuift de tijd met setTargetAtTime en bouwt bij ping-pong de
  bedrading om terwijl er geluid doorheen gaat: tikken).
- **Ringmod**: vier golfvormen (Varve: sinus).
- **Filter**: zeven soorten en een LFO (auto-filter). Varve's bipolaire DJ-filter is
  voor mixen beter; een auto-filter op de maat zou met de LFO uit `fx-lfo.js` kunnen.
- **Phaser**: aantal trappen en het midden instelbaar (maar trappen wisselen bouwt in
  de filter app de bedrading om).
- Galm: Varve's FDN (met freeze) is beter dan de convolver van de filter app (die
  bij elke draai een nieuwe impuls rekent en hem hard verwisselt).

## Open vragen voor Clay

1. Geheugen: later als instrument of op de master (S5), of niet?
2. Distortion zonder oversampling (aliasing bij veel drive) in plaats van met (een kam
   met de mix-knop): goed zo?
3. De compressor schuift de track 6 ms (Chrome's vooruitblik); pitch met meng 1 ~45 ms.
   Mag een insert dat, of moet zo'n effect alleen op de bussen/master?
4. Tremolo en autopan op de "1" van de maat: dan moet `fxKlok` de maatfase meegeven.
5. Tremolo en autopan staan standaard op de maat. Goed zo?
6. ~~De delay van fx.js: zijn echo begon na een wissel abrupt (×46), en een tijd die
   wachtte kon na een nieuwere alsnog gezet worden.~~ Allebei opgelost op 5 okt (inloop,
   `wachtend = null` bij een directe wissel; check in engine.test).
