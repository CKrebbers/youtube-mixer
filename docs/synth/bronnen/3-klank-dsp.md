# Ambient sound design in een AudioWorklet: onderzoeksrapport

**Hoe ik heb gewerkt.** De broncode heb ik zelf gelezen: Mutable `eurorack` en `stmlib`, PaulStretch, ChowTape, Airwindows, KR-106 en phaze, gekloond of via raw.githubusercontent. Licenties heb ik gecontroleerd in het LICENSE-bestand of in de bestandskop.

Kosten heb ik zelf gemeten met een Node-benchmark: 18 kernels, blokken van 128 samples, 48 kHz, zonder afval. Dat draaide op Node 22 met een **Xeon van 2,1 GHz, niet op de M1**. Lees de getallen daarom als ordegrootte. Een M1-kern is per thread waarschijnlijk even snel of sneller.

Twee beperkingen in dit onderzoek:
- De proxy blokkeerde valhalladsp.com, ccrma.stanford.edu, soundonsound.com, readthedocs en cprimozic.net. Wat ik daarover zeg komt uit zoekresultaat-fragmenten en is als zodanig gemarkeerd.
- De zoeklimiet van de sessie (200) was halverwege op. Het blok "ruis als materiaal" steunt daarom op code en vakkennis, niet op literatuur.

## Licenties (gecontroleerd)

| Bron | Licentie | Bron-URL |
|---|---|---|
| Mutable `eurorack` (Clouds, Rings, Elements, Plaits) | MIT voor STM32-code; GPL3 voor AVR; hardware CC-BY-SA. De naam "Mutable Instruments" mag je niet gebruiken. [sterk] | https://github.com/pichenettes/eurorack |
| **Beads** | **Staat niet in de repo**: geen broncode beschikbaar. [sterk] | (zelfde repo, map ontbreekt) |
| stmlib | MIT [sterk] | https://github.com/pichenettes/stmlib |
| PaulStretch Python | Public domain [sterk] | https://github.com/paulnasca/paulstretch_python |
| PaulStretch C++ | GPL2 [sterk] | https://github.com/paulnasca/paulstretch_cpp |
| STK | MIT-achtig [sterk] | https://github.com/thestk/stk/blob/master/LICENSE |
| Airwindows (ToTape, Flutter, Ensemble, Galactic …) | MIT [sterk] | https://github.com/airwindows/airwindows |
| Signalsmith dsp | MIT [sterk] | https://github.com/Signalsmith-Audio/dsp |
| phaze (OLA/phase-vocoder-worklet) | Unlicense [sterk] | https://github.com/olvb/phaze |
| fft.js | MIT [sterk] | https://github.com/indutny/fft.js |
| VCV AudibleInstruments (Mutable-ports) | **GPL3** [sterk] | https://github.com/VCVRack/AudibleInstruments |
| ChowTape | **GPL3** [sterk] | https://github.com/jatinchowdhury18/AnalogTapeModel |
| KR-106 (Juno-emulatie) | **GPL3** [sterk] | https://github.com/kayrockscreenprinting/ultramaster_kr106 |

De GPL-projecten kun je gebruiken voor parameters en ideeën, maar je kunt hun code niet overnemen. Port Mutable-code daarom vanuit het origineel, niet vanuit VCV.

## 1. Granulair

**Wat het doet.** Granulaire synthese maakt van elk materiaal een wolk of drone. Ambient-makers gebruiken het om bestaand geluid op te rekken tot een stilstaande textuur.

**Clouds, uit de code gelezen:**
- **Korrelgrootte**: 1024 tot 16384 samples op 32 kHz, dus 32–512 ms, exponentieel verdeeld (`1024·2^(4x)`). [sterk] https://github.com/pichenettes/eurorack/blob/master/clouds/resources/lookup_tables.py
- **Dichtheid**: de knop wordt eerst tot de derde macht genomen. Daarna wordt het aantal korrels `max·overlap³`, maximaal 40 mono of 32 stereo (`kMaxNumGrains` 64).
  - Boven 12 uur triggert de korrels willekeurig (Bernoulli per sample).
  - Onder 12 uur triggert ze deterministisch, met een vaste afstand.
- **Uitgangsniveau**: genormaliseerd met `1/√(n−1)`.
- **Pan per korrel**: `0,5 + spread·(rnd−0,5)`.
- [sterk] https://github.com/pichenettes/eurorack/blob/master/clouds/dsp/granular_sample_player.h
- **"Texture" is de vensterVORM**: van rechthoek via driehoek naar Hann. Boven 0,75 stuurt dezelfde knop een diffuser en galm na de korrels. [sterk] https://github.com/pichenettes/eurorack/blob/master/clouds/dsp/grain.h
- **Buffer**: 1 s (32 kHz, 16-bit, stereo) tot 8 s (16 kHz, µ-law, mono). [sterk] https://www.modulargrid.net/e/mutable-instruments-clouds
- **Freeze**: stopt alleen met schrijven in de buffer.
- **Looping delay**: speelt de buffer zonder korrels af; POSITION is de afstand tussen lees- en schrijfkop.
- **Spectral**: een phase vocoder met FFT 4096 en hop 1024 (factor 4), met freeze, warp, quantize, faseverstrooiing en glitch. [sterk] https://github.com/pichenettes/eurorack/blob/master/clouds/dsp/pvoc/frame_transformation.cc

**Morphagene** (snippet-bron) [matig], https://www.soundonsound.com/reviews/make-noise-morphagene:
- MORPH loopt van één "gene" met een gat eromheen, via naadloos, naar 4 overlappende genes rond twee uur. Aan het eind krijgt elke gene een willekeurige toonhoogte en pan.
- Reels zijn 48 kHz, 32-bit.

Bruikbaar idee: één knop die gat → overlap → toonhoogte-strooiing doorloopt.

**Live buffer of sample.**
- Een live buffer (Clouds) reageert op wat je speelt en kan feedback hebben. De positie is wel begrensd door de schrijfkop: een korrel mag niet over de schrijfkop heen lezen. Clouds klemt de korrel daarom op `buffer/4/pitch`.
- Een sample geeft een vrije positiescan en eindeloze freeze zonder dat randen inhalen.
- Voor een meditatie-instrument is een sample of een vastgezette buffer rustiger.

**Zinvolle bereiken voor ambient** [praktijk]:

| Parameter | Bereik |
|---|---|
| Korrel | 80–500 ms |
| Overlap | 4–12 |
| Spray (positie-jitter) | 0–300 ms |
| Venster | Hann of Tukey |
| Toonhoogte | 0, of een kwantisering uit {−12, 0, +7, +12} die per korrel gekozen wordt |
| Stereo-spreiding | 0,5–1 |

## 2. Spectraal

**PaulStretch** (public domain) [sterk], https://github.com/paulnasca/paulstretch_python/blob/master/paulstretch_stereo.py:
- Venster van standaard 0,25 s, vorm `(1−x²)^1,25`, en 50% overlap-add.
- Per frame houdt het alleen de magnitude en krijgt elke bin een **willekeurige fase**.
- De invoer schuift per frame `venster/2/stretch` op; standaard is de stretch ×8.
- Hoe groter het venster, hoe gladder en "koraal-achtiger" het resultaat. Vensters van 0,25–1 s zijn 12k–48k samples.

**Freeze.**
- Variant 1, PaulStretch: één magnitudespectrum vasthouden met een nieuwe willekeurige fase per frame. Dat geeft een wolk.
- Variant 2, Clouds: de fasedelta per bin doorschuiven. Dat geeft een stilstaande toon.

**Blur en smear.** Middel per bin de amplitude- en frequentiefunctie over de tijd, of gebruik een éénpolig laagdoorlaatfilter (pvsmooth). Dat laatste heeft vaste kosten, hoe sterk de blur ook is. [sterk] https://csound.com/docs/manual/pvsblur.html, https://csound.com/manual/pvsmooth.html

**Morphing.** Interpoleer de magnitudes (bij voorkeur in log) tussen twee bevroren spectra, met random of doorgeschoven fase. [praktijk]

**FFT in een worklet: dit is het knelpunt.**
- Een quantum is 128 samples (2,67 ms op 48 kHz). FFT 4096 met hop 1024 betekent 85 ms latentie, en dat is prima voor ambient.
- Gemeten: gemiddeld zijn de kosten laag, 1,6–1,9% van een kern voor FFT 2048–8192 met hop/4, inclusief willekeurige fase en een complexe FFT op reële data.
- Maar het hele frame valt in ÉÉN quantum. Die pieken heb ik gemeten (p99,9 per blok):
  - FFT 2048: **344 µs**
  - FFT 4096: **800 µs**
  - FFT 16384: **2419 µs van de 2667**
- PaulStretch met grote vensters kapt dus zonder spreiding. [sterk, eigen meting]

Clouds lost dit op door de FFT in de hoofdlus te draaien, los van de audio-interrupt (`processor.Prepare()` in `clouds.cc`, `phase_vocoder_.Buffer()`). [sterk] https://github.com/pichenettes/eurorack/blob/master/clouds/clouds.cc

In de browser zijn er twee opties:
- (a) De FFT-stappen spreiden over hop/128 quanta. Dat is hetzelfde principe als `splitComputation` in het keylock-ontwerp.
- (b) De FFT in een Worker draaien met een SharedArrayBuffer-ring. COOP/COEP staan in Varve al aan.

`renderSizeHint` (een configureerbaar quantum) staat bij Chrome gepland voor ongeveer M153, maar lost frames van 4096+ niet op. [matig] https://groups.google.com/a/chromium.org/g/blink-dev/c/i4c1unRSmcE

Een real-FFT-truc (fft.js `realTransform`, ~25% sneller) halveert de piek ongeveer. phaze laat een OLA-worklet zien met hop = 128. [sterk] https://github.com/olvb/phaze

## 3. Fysieke modellen en resonatoren

**Rings** (MIT, 48 kHz, blok 24) [sterk]:
- **Modaal**: tot 64 SVF-banddoorlaten.
  - Partials lopen als `harmonic·stretch`; de stijfheid rekt ze op of drukt ze samen (×0,98 en ×0,93 per mode).
  - Q daalt per mode met `q_loss`.
  - "Position" is een cosinus-amplitudereeks over de modes; oneven en even modes gaan naar L en R.
  - https://github.com/pichenettes/eurorack/blob/master/rings/dsp/resonator.cc
- **Sympathische snaren**: 8 Karplus-Strong-snaren gestemd op grondtoon, −12, −7,02 (zuivere kwint), 0, +7,02, +12, +19,02 en +24.
  - Ze zijn een fractie ontstemd (detuningtabel 0,007–0,017).
  - Langzame LFO's per snaar van 0,17–0,5 Hz.
  - Ingangsniveau `1/√(2n)`.
  - https://github.com/pichenettes/eurorack/blob/master/rings/dsp/part.cc
- **String-model**: vertragingslijn van 2048 samples, dempingsfilter en een dispersie-allpass voor stijfheid.

**Elements** (MIT, 32 kHz):
- 64 modes, waarvan de eerste **8 als banded waveguide gestreken** worden: een vertraging per mode plus een smalle bandpass, met een strijktabel `x·clamp(0,25/(|6x|+0,75)⁴)`. [sterk] https://github.com/pichenettes/eurorack/blob/master/elements/dsp/resonator.h
- De strijk-exciter is "Flow": ruis die willekeurig van teken wisselt.
- Blazen gebeurt met een granulaire sample-speler plus een buis.
- [sterk] https://github.com/pichenettes/eurorack/blob/master/elements/dsp/exciter.cc

Banded waveguides (Essl & Cook, 1999) werden juist gemaakt voor gestreken staven, wijnglazen en Tibetaanse klankschalen. [sterk] https://en.wikipedia.org/wiki/Banded_waveguide_synthesis

**Extended Karplus-Strong** (Jaffe & Smith):
- Filters voor plukrichting en plukpositie (kam).
- Dempingsfilter, stijfheids-allpass, stem-allpass en een dynamiek-laagdoorlaat.
- [sterk] https://ccrma.stanford.edu/~jos/pasp/Extended_Karplus_Strong_Algorithm.html (via snippet)

**Wat dit toevoegt boven je modale klankschaal** [praktijk]:
1. Een **resonator op externe invoer**, zodat ruis, korrels of een drone door 64 modes of 8 snaren gaan. Dat geeft tonale kleur aan elk materiaal, op de toonsoort.
2. **Harmonische snaren met dispersie.** Een klankschaal is inharmonisch; snaren geven warmte en een tanpura-achtig karakter.
3. **Echte, aanhoudende strijkdynamiek** via banded waveguides, ook voor harmonische klanken, waar stick-slip op één mode dat niet geeft.

Gemeten kosten:

| Kernel | Kosten |
|---|---|
| 64 SVF-modes | 1,3% |
| 32 SVF-modes | 0,6% |
| 8 KS-snaren met 5 allpasses | 0,5–0,6% |
| 1 KS-snaar | 0,06–0,08% |

## 4. Pads en klanken

**Additief met driftende partials.**
- Per partial een amplitude als Ornstein-Uhlenbeck-wandeling (τ 2–20 s) en ±1–3 cent frequentiedrift. [praktijk]
- Plaits gebruikt 36 harmonischen in batches van 12. [sterk] https://github.com/pichenettes/eurorack/blob/master/plaits/dsp/engine/additive_engine.h
- Gemeten: 64 partials 1,2–1,35%, 256 partials 5,6–6,2%.

**Wavetable-morph.** Reken bandbegrensde tabellen per octaaf (mipmaps) vooraf uit op de hoofdthread, uit additieve spectra, en kruisfade tussen frames. Dat kost bijna niets en geeft geen aliasing. [matig]

**Ensemble en chorus.**
- **Plaits Ensemble (MIT)**: drie gemoduleerde taps rond 192 samples (4 ms op 48 kHz). Twee driefasige LFO's (0°, 120°, 240°): **0,75 Hz** met diepte tot ±160 samples en **6,57 Hz** met ±16 samples. [sterk] https://github.com/pichenettes/eurorack/blob/master/plaits/dsp/fx/ensemble.h
- **Plaits "string machine"** combineert divide-down orgelregistraties, twee SVF-laagdoorlaten en die Ensemble. Dat is een kant-en-klaar Solina-recept. [sterk] https://github.com/pichenettes/eurorack/blob/master/plaits/dsp/engine2/string_machine_engine.cc
- **Solina**: drie BBD's met 1–5 ms, LFO's rond 0,2–0,6 Hz plus 5–7 Hz, 120° uit fase. [matig] https://www.kvraudio.com/forum/viewtopic.php?p=2623291
- **Juno-chorus** volgens KR-106 (GPL, alleen als parameterbron):
  - Driehoeks-LFO; mode I 0,513 Hz ±0,5 ms, mode II 0,863 Hz ±1,1 ms.
  - Midden-vertraging 3,5 ms, L/R 180° uit fase.
  - BBD-bandbreedte als LP `256/(4·delay)`, en zachte verzadiging boven 0,7.
  - [matig] https://github.com/kayrockscreenprinting/ultramaster_kr106/blob/main/docs/DSP_ARCHITECTURE.md
- Gemeten: 3 Hermite-lijnen 0,3%.

**Supersaw.** 7 PolyBLEP-zaagtanden kosten 0,07%. Voor ambient: ±3–8 cent spreiding (trance gebruikt meer), daarna een LP van 1–3 kHz en het ensemble. [praktijk]

**Formant- en vocale pads.** Stuur zaagtand of ruis door 3–5 parallelle bandpasses op klinkerformanten (bv. /a/ ≈ 700/1220/2600 Hz) en morph traag tussen klinkers. Plaits heeft formant- en spraak-engines (MIT). [matig]

**Shimmer** (snippets van Valhalla) [matig], https://valhalladsp.com/2010/05/11/enolanois-shimmer-sound-how-it-is-made/, https://valhalladsp.com/?p=549:
- Het recept: pitch-shift +12 in de terugkoppeling van een lange galm, met gain en EQ in die lus.
- Valhalla **randomiseert** de shifter om de kamfilter-artefacten van een simpele shifter te vermijden.

Zonder metaalklank, vakkennis [praktijk]:
- Een shifter met 2–4 overlappende leeskoppen (Hann) en willekeurige korrellengte van 50–120 ms.
- Een LP van 4–6 kHz en een HP voor de shifter.
- Lusgain ≤ 0,3–0,5 per omloop.
- Alleen +12 (eventueel +19).
- De shifter in de lus van de FDN, zodat de diffusie de artefacten uitsmeert.

Je FDN kan dit dragen. Het kost ongeveer één korrel-delay.

**Tape.**
- Wow en flutter als vertragingsmodulatie. Uit ChowTape (GPL, alleen parameters) [sterk], https://github.com/jatinchowdhury18/AnalogTapeModel/tree/master/Plugin/Source/Processors/Timing_Effects:
  - Wow 0–3,5 Hz, met variatie via een Ornstein-Uhlenbeck-proces.
  - Flutter 0,1–100 Hz als som van **harmonischen 1, 2 en 3**, amplitudeverhouding 230 : 80 : 99.
- Omrekening: een sinusmodulatie van A seconden op f Hz geeft een snelheidsafwijking van 2πfA. Voor 0,1% bij 1 Hz is A ≈ 0,16 ms. [sterk, wiskunde]
- Hiss: roze ruis met een hoogshelf, rond −60 tot −50 dBFS.
- Verzadiging: SoftClip met pre- en de-emphasis. [praktijk]
- Airwindows (MIT) heeft ToTape5–9, Flutter/Flutter2 en TapeDust als leesbare referentie.

**Lo-fi die kalm blijft.** Gebruik bandbegrenzing met een zachte helling in plaats van sample-rate-reductie (aliasing is scherp), en bitreductie alleen met dither. [praktijk]

## 5. Ruis als materiaal

- **Wind**: roze of witte ruis door 1–3 resonante bandpasses (Q 2–10). Middenfrequentie en gain volgen een trage OU-"windsnelheid" (τ 3–15 s); vlagen schuiven de frequentie omhoog. [praktijk]
- **Zee**: ruis-LP met een cutoff en amplitude die een traag golfritme volgen van 0,08–0,15 Hz, licht onregelmatig, plus een hoge "schuim"-band op de golftop. [praktijk]
- **Adem**: bandpass-ruis van 0,5–3 kHz met een omhullende van 4–6 tellen in/uit. Dat geeft meteen een meditatieklok. [praktijk]
- **Resonante bandpass-bank** (24 biquads, gemeten 0,4–0,45%): ruis gestemd op de toonsoort klinkt als een "zingend veld".
- **Druppels en krakers**: Plaits **Particle** is dust door resonante filters met diffusie; Elements **Flow** is ruis met willekeurige tekenwissels. Beide zijn MIT. [sterk] https://github.com/pichenettes/eurorack/blob/master/plaits/dsp/engine/particle_engine.cc
- Het eerlijke voorbehoud: Farnell's *Designing Sound* is de standaard voor dit blok, maar ik kon hem niet ophalen. [zwak qua verificatie]

## 6. Feedbacksystemen veilig

- **Lusgain onder 1 bij ELKE frequentie.** Filters in de lus krijgen een negatieve of lage Q; dat ken je al. Zet de begrenzer IN de lus.
  - stmlib `SoftLimit = x(27+x²)/(27+9x²)` is **niet begrensd**: SoftLimit(10) = 1,37.
  - Gebruik `SoftClip`: klemmen op ±3, daaronder SoftLimit, en precies 1 bij 3.
  - Gemeten: deze rationele functie kost 0,11–0,15%, tegen 0,29–0,32% voor `Math.tanh`.
  - [sterk] https://github.com/pichenettes/stmlib/blob/master/dsp/dsp.h
- **DC.** Clouds zet een **hoogdoorlaat in de terugkoppeling die meestijgt met de feedback**: `(20 + 100·fb²)` Hz. De feedback mengt via SoftLimit(1,4·fb·x + in). [sterk] https://github.com/pichenettes/eurorack/blob/master/clouds/dsp/granular_processor.cc
- **NaN.** Elements heeft een `panic`-pad dat de filterstaat op 0 zet als een resonator "opblaast". Dat is in de praktijk één keer gezien. [sterk] https://github.com/pichenettes/eurorack/blob/master/elements/dsp/part.cc
  - In JS: per blok één controle `if (!(Math.abs(som) < 1e3))`, dan de staat resetten en het niveau opnieuw laten oplopen.
- **Denormals.** JS rekent in doubles. Op x86 kosten subnormals 10–100× zoveel. [sterk] https://en.wikipedia.org/wiki/Subnormal_number
  - Of de M1 er last van heeft, kon ik niet verifiëren. [zwak]
  - Goedkoop en sowieso nuttig: zet een vervallende staat onder ~1e-15 op 0. Dat geeft ook "slapen bij stilte".
- **Eindeloos zonder ophoping.**
  - Freeze is verliesloos, maar met invoer dicht.
  - Anders: lusgain 0,9–0,98 met een LP in de lus, zodat hoog sneller uitsterft.
  - Laat modulatie de modes en zwevingen breken, maar niet de energie toevoegen.
  - Zet een trage RMS-bewaking op de lusgain. [praktijk]

## 7. Rekenbudget

Eigen meting, Xeon 2,1 GHz, Node 22, 48 kHz, gemiddelde van twee runs, in % van één kern:

| Kernel | Kosten |
|---|---|
| Granulair, 16 / 32 / 64 korrels stereo | 0,65 / 1,4–1,7 / 3,0–3,3 |
| STFT 2048 / 4096 / 8192, hop/4 | 1,6 / 1,7–1,8 / 1,85 (gemiddeld; **pieken zie §2**) |
| STFT 16384, hop 2048 | 3,9–5,6 (piek 2,4 ms per quantum) |
| Modaal 64 SVF | 1,3 |
| 8 sympathische KS-snaren | 0,5–0,6 |
| Additief 64 / 256 partials | 1,2–1,35 / 5,6–6,2 |
| Ensemble 3 lijnen | 0,3 |
| Ruisbank 24 BP | 0,4–0,45 |
| Supersaw 7 | 0,07 |

Conclusies:
- **Een volledig palet past ruim onder 15% van één kern in plain JS.** [sterk, eigen meting, niet op de M1]
- **WASM of SIMD loont pas** bij honderden partials of modes, grote FFT's of keylock. Emscripten heeft een Wasm Audio Worklets-API, maar plain JS is voor dit palet niet de bottleneck. Het knelpunt is de FFT-piek: dat is een planningsprobleem, geen snelheidsprobleem. https://emscripten.org/docs/api_reference/wasm_audio_worklets.html [matig]
- **Geen afval per blok**: alles voorgealloceerd in Float32Array of Float64Array, geen objecten of closures in `process()`, en willekeur uit een eigen LCG (geen `Math.random`, vanwege reproduceerbaarheid). De benchmark volgt dit.

## Shortlist: rijkste palet voor de laagste complexiteit, in bouwvolgorde

1. **Ensemble/chorus (Plaits-recept: 3 taps, 0,75 Hz + 6,57 Hz driefasig) plus tape-wow/flutter in dezelfde vertragingslijn.** Kost ~0,3% en ~150 regels. Het maakt alles wat je al hebt (FM-bellen, drone, schaal) breder en warmer. De eerste stap met de meeste winst.
2. **Granulaire speler op een buffer van 8–20 s, met freeze.** Vensterknop rechthoek → Hann, overlap³, spray en gekwantiseerde toonhoogte, Clouds-normalisatie. Hij voedt zich met je eigen synth of een sample en maakt van elke klank een textuur. Kost ~1,5%.
3. **Resonatorbank op externe invoer (Rings-modaal + 8 sympathische snaren op de just-ladder).** Ruis en korrels krijgen dan de toonsoort. De snaren vullen de inharmonische klankschaal harmonisch aan. Kost ~2%.
4. **Ruisbron met trage OU-modulatoren** (wind, zee, adem) en een resonante BP-bank. Dit is meteen de ademklok voor meditatie. Kost <0,5% en is de eenvoudigste stap.
5. **Shimmer in je bestaande FDN** (gerandomiseerde shifter, LP, lusgain ≤ 0,4). Grote klankwinst voor één extra korrel-delay. Bouw hem na de SoftClip- en NaN-bewaking.
6. **Spectrale freeze en PaulStretch (FFT 4096–16384), verdeeld over quanta of in een Worker.** Bouw dit als laatste: dit is het enige onderdeel met een echt planningsrisico. Zonder spreiding kapt een frame van 16384 de audio (gemeten).

Additief met drift en wavetable laat ik bewust buiten de top 6. Je FM-bellen, drone en supersaw met ensemble dekken dat gebied al grotendeels.

## Onzekerheden

- Alle kosten zijn gemeten op een Xeon in Node, niet in Chrome op een M1. Meet de echte pieken in de worklet opnieuw.
- Denormal-gedrag op de M1 in V8 is niet geverifieerd.
- De Valhalla-, Morphagene- en Solina-details komen uit zoekfragmenten; de bronpagina's waren geblokkeerd. Hetzelfde geldt voor Chrome M153 voor `renderSizeHint`.
- Beads heeft geen open code; wat "Beads-achtig" is, moet je dus van Clouds afleiden.
- De bereiken voor wind, zee en adem en voor shimmer zonder metaal zijn vakkennis, niet gemeten.
- De vertaling van de LFO-waarden van de Plaits Ensemble naar Hz neem ik over uit de broncode-comments, uitgaande van een update per sample.