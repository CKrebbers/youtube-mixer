# Hoek geluid: waar de meeste winst zit (13 okt 2026)

Gelezen op tak `studio/afmaken`, niets in de repo gewijzigd. Alles hieronder is gemeten
in deze sandbox: ffmpeg 6.1.1, Chrome headless shell 155 (OfflineAudioContext /
`getFrequencyResponse`), Node 22 met de echte `LimiterKern` uit de repo. Er staat
geen media of library.db in de sandbox: waar het om Clay's library gaat, ligt er een
script klaar dat hij zelf draait (alleen lezen).

Meetbestanden (allemaal in deze map):

| bestand | wat |
|---|---|
| `ln/meet.sh`, `loudnorm-proef.sh` | de twee passes van `server/ingest.js` letterlijk nagedaan; print `normalization_type` |
| `loudnorm-telling.mjs` | telt in `media/library.db` welke nummers loudnorm dynamisch deed (alleen lezen) |
| `eq.mjs`, `eq-chrome.html` | frequentierespons van de EQ en de kill (Node en Chrome, identiek) |
| `iso-chrome.html`, `iso-resultaat.txt` | prototype isolator-EQ (LR4) in Chrome |
| `iso-cpu.html`, `cdp.mjs` | CPU van shelf-EQ en isolator, 8 tracks, OfflineAudioContext |
| `gs/maak.mjs`, `gs/sim.mjs` | gain staging: twee synthetische dansnummers op −14 LUFS door de echte limiter |

---

## Kans 1: loudnorm schakelt stil over op DYNAMISCH en drukt dan de opbouw plat

**Probleem.** `server/ingest.js:357-372` normaliseert met `loudnorm ... linear=true` en
het commentaar zegt dat dit "één vaste correctie" is. Maar ffmpeg's `af_loudnorm.c`
neemt linear ALLEEN als twee voorwaarden kloppen:
`measured_TP + (−14 − measured_I) ≤ −1,5` (de piek past na de versterking) EN
`measured_LRA ≤ 11`. Anders valt hij zonder fout of melding terug op de dynamische
modus: een AGC met een venster van 3 s plus een limiter. De uitvoer van pass 2
(`print_format=summary`) wordt niet gelezen, dus niemand ziet het.

**Bewijs (gemeten, ffmpeg 6.1.1, `ln/`):**

| bestand | in: I / TP / LRA | uit | modus |
|---|---|---|---|
| A luid, compact | −20,7 / −9,5 / 0,1 | −13,9 LUFS | linear |
| C zacht met losse pieken (PLR 27 dB) | −33,3 / −6,5 / 0,1 | **−15,9 LUFS** (doel gemist) | **dynamic** |
| D sinus, 4 stukken van 6 dB oplopend (PLR 4, LRA 18) | −33,4 / −29,0 / 18,1 | −13,7 | **dynamic** |

D is het sterkste bewijs: de piek past ruim, alleen de LRA is te groot. De vier
stukken liggen in de bron precies 6 dB uit elkaar (−48 / −42 / −36 / −30 LUFS) en
komen eruit als **−32,3 / −18,0 / −12,9 / −12,9**: de laatste twee zijn even luid
geworden. Met een vaste versterking (`volume=19.38dB`) blijven ze −28,6 / −22,6 /
−16,6 / −10,6 (geheel −14,2 LUFS, piek −9,7 dBFS). Precies wat het commentaar wil
voorkomen ("zou de dynamiek van je track platdrukken"), gebeurt dus wél.

Wie valt erin: alles met een PLR (piek min luidheid) boven 12,5 dB of een LRA boven
11 LU. Uit de literatuur (aanname, niet op Clay's library gemeten): moderne
dance-masters PLR 6–10 en LRA 3–8 (die gaan goed); oudere opnames, ambient, akoestisch
en vooral HELE ALBUMS en mixen op YouTube (stille intro's, interludes) PLR 12–20 en
LRA 10–20. Clay heeft precies dat repertoire (het ADRIANA-album van 31 minuten, zoned
out, ambient als hoofdroute van de auto-DJ, AUTO-DJ.md). De library-kolom LUFS
(`src/ui/library-lijst.js:309-310`) toont voor al die nummers "I → −14 LUFS", ook als
het resultaat −15,9 is of dynamisch is platgedrukt.

Hoeveel van Clay's nummers: de meetwaarden staan al in de database
(`loudness_i/tp/lra`, `server/library.js:35`). Draai op de Mac:

```
node <scratchpad>/winst/loudnorm-telling.mjs ~/Desktop/youtube-mixer/media/library.db
```

Dat geeft het aantal en de lijst (op LRA gesorteerd), met hoeveel dB er tekort is.

**Ook: losgesleepte audio wordt helemaal niet genormaliseerd.** `src/ui/laden.js:112-125`
decodeert en speelt; alleen de RMS gaat naar de console. Een mp3 op −8 LUFS naast de
library op −14 is 6 dB harder, en dat merk je pas als hij open gaat.

**Winst voor Clay.** Albums, ambient en dynamische nummers houden hun opbouw en breaks
(beter geluid); "−14 LUFS" in de library klopt dan echt, dus overgangen tussen een luid
nummer en een album klinken gelijk (minder kans op een gat of een klap bij een
overgang, ook bij de auto-DJ). Een losgesleept bestand komt op hetzelfde niveau binnen.

**Hoe toepassen.**
1. `server/ingest.js` `normaliseer()`: geen loudnorm meer in pass 2. Reken zelf
   `nodig = −14 − I`, `toegepast = min(nodig, −1,5 − TP)` en schrijf met
   `-af volume=${toegepast}dB` (altijd lineair, LRA doet er niet meer toe). Pass 1
   (meten) blijft zoals hij is. `rest = nodig − toegepast` (≥ 0) is wat er nog
   ontbreekt, geklemd op bijvoorbeeld +6 dB.
2. Schema: kolom `loudness_rest` (dB) in `tracks` (een migratie erbij;
   `library.test` rekent met `SCHEMA.length`), mee in `/api/library`.
3. Engine: een luidheidsversterking per deck, los van de trimknop (die blijft van
   Clay). In `deck.js` op de drie plekken waar `this._ui.trim * 2` staat (r.1438,
   1749, 1772) een `trimVersterking()` = `u.trim × 2 × dbToGain(rest)`. Een nieuw
   nummer zet hem (`_naLaden`). De pieken boven 0 dBFS zijn in de float-graaf geen
   probleem; de limiter vangt ze (master 0,8 = −9 dB heeft ruim ruimte).
4. `laadGeheugen` (losse bestanden, demo): integrated loudness volgens BS.1770
   uitrekenen op de AudioBuffer (K-weging + 400 ms blokken + de twee gates, ~40
   regels puur rekenwerk, bij het laden, niet op de audiothread) en dezelfde
   versterking zetten.
5. Wat al dynamisch binnenkwam: het origineel is weg (CLAUDE.md "Eigen bestanden").
   De nummers uit `loudnorm-telling.mjs` opnieuw binnenhalen via de nachtwachtrij
   (`server/nacht.js`, stopt al als er een deck speelt), daarna stems opnieuw
   splitsen (stems.wav is van audio.wav afgeleid). Eigen uploads (`lokaal-…`): lijst
   voor Clay. Grid, toonsoort en secties hoeven niet opnieuw (een vaste versterking
   verschuift geen tel; slot blijft staan).
6. Toetsen: `test/ingest.test.mjs` uitbreiden met bestand D (LRA 18) en C (PLR 27):
   eis dat de stukken van D na de ingest nog 6 dB uit elkaar liggen. De kolom LUFS
   toont "−14 (+x dB in de mixer)" of "x dB onder doel" als de klem raakt.

Moeite: ~1 dag code en tests; het opnieuw binnenhalen is nachtwerk zonder Clay.
Risico: laag tot middel. Nieuwe nummers met een positieve rest liggen in het bestand
zachter dan −14 (de golfvorm is kleiner); een vergeten plek die `trim` leest klinkt
dan zachter (vandaar één helper). Aanname: Clay's ffmpeg (Homebrew 8/9) heeft dezelfde
voorwaarde; `loudnorm-proef.sh D.wav` op de Mac beslist het in een minuut.

---

## Kans 2: de kill en de EQ snijden veel breder dan "bas weg": een isolator-EQ

**Probleem.** De kanaal-EQ is lowshelf 200 Hz, peaking 1 kHz (Q 0,9) en highshelf
4 kHz (`src/engine/audio-graph.js:39-46`), en de kill zet die op −70 dB
(`EQ_KILL_DB`, r.97; ook de onderste 3% van de knop, `eqDb` r.102). Een shelf of
piek uit het RBJ-kookboek is bij zo'n diepe stand extreem breed: de frequentie ligt
op de HELFT van de versterking in dB, dus −35 dB op 200 Hz, en het gat loopt ver de
middentonen in.

**Bewijs (Chrome 155 `getFrequencyResponse`, gelijk aan `eq.mjs` tot op 0,1 dB):**

| Hz | 50 | 100 | 200 | 400 | 600 | 1000 | 2000 | 4000 | 12000 |
|---|---|---|---|---|---|---|---|---|---|
| low kill nu | −58,7 | −47,0 | −35,0 | −23,0 | **−16,0** | **−7,8** | −1,2 | −0,1 | 0 |
| mid kill nu | **−10,3** | **−16,1** | −22,3 | −29,5 | −35,3 | −70 | −32,3 | −24,2 | **−12,5** |
| high kill nu | 0 | 0 | −0,1 | −1,1 | −3,9 | **−10,9** | −22,7 | −35 | −57,6 |
| low kill isolator (LR4, prototype) | −47,5 | −24,6 | −6,0 | −0,5 | −0,1 | 0,0 | 0 | 0 | 0 |
| mid kill isolator | 0 | −0,5 | −6,0 | −24,6 | −37,8 | −45,2 | −25,1 | −6,0 | 0 |
| high kill isolator | 0 | 0 | 0 | 0 | 0 | 0 | −0,5 | −6,0 | −45,3 |
| low-knop −30 dB nu / isolator | −29,5 / −29,0 | −25,3 / −21,1 | −15,0 / −5,8 | −4,7 / −0,5 | −1,4 / −0,1 | −0,2 / 0 | 0 | 0 | 0 |

Een bass-kill haalt nu ook 600 Hz met 16 dB en 1 kHz met 8 dB weg: zang, snare en
de body van het nummer worden dof. Een mid-kill haalt ook 16 dB uit de bas en 12–24
dB uit het hoog: dat is bijna alles weg. En de sprong van knop 0,03 (−28 dB) naar
de kill verandert 600 Hz van −1,4 naar −16 dB: de kill klinkt als een ander filter
dan de knop helemaal omlaag.

Dit raakt de kernbeweging van een DJ (de bas wisselen) op drie plekken: de kill-knoppen
in de grid-modus klank (APC), de EQ-knoppen, en de auto-DJ: de blend zet `low: 0`
(= kill) op de binnenkomende in de eerste helft en op de uitgaande in de tweede
(`src/auto/planner.js:519-523`, "nooit twee bassen"). Daardoor klinkt in een blend
van 16 maten steeds één van de twee nummers hol tot 1 kHz.

**Winst voor Clay.** Bas eruit is alleen bas eruit; een mid-kill laat bas en hoog
staan (zoals op een DJ-isolator). Schonere bass swaps, met de hand en in de auto-DJ.
De knop zelf voelt bijna gelijk (laatste rij van de tabel), alleen de kill wordt echt.

**Hoe toepassen.**
1. `createDeckChain` (`audio-graph.js:28-67`): een drieweg-isolator met
   Linkwitz-Riley 4e orde (twee Butterworth-biquads per kant; in Web Audio is de Q
   van lowpass/highpass in dB: Butterworth = −3,0103):
   laag = LP200·LP200·AP4000 (allpass, Q lineair 0,7071, voor de fase), midden =
   HP200·HP200·LP4000·LP4000, hoog = HP200·HP200·HP4000·HP4000, elk door een
   GainNode naar een som. Op 1/1/1 is de som een allpass: vlak tot op 0,0 dB
   (gemeten), alleen fase. Dezelfde bedrading voor de stems: zij komen vóór trim
   samen, dus niets verandert daar.
2. De banden zijn nu versterkingen in AMPLITUDE: `setEqBand` wordt
   `zetDoel(gain, dbToGain(eqDb(norm)))`, `killEqBand` wordt `killVersterking`
   (die bestaat al, r.164, dezelfde zachte S na `startDrempel`). `eqDb` en de knop
   blijven gelijk (regel 2: de engine schaalt).
3. `deck.js` r.133-134 (fx-insert na `eqHigh`), r.1442-1444 en r.1485 naar de nieuwe
   namen; `test/engine.test.mjs` r.152-154, 1436-1505 en `test/instrumenten.test.mjs`
   r.294 lezen nu dB van een biquad en moeten amplitude lezen. Een toets erbij: de
   frequentierespons van de kill (zoals `iso-chrome.html`) in `tools/headless/`.
4. Kosten gemeten (`iso-cpu.html`, 8 tracks, 60 s, beste van 3): 1325 ms → 3371 ms
   renderen, dus ~2 s per minuut = ~3,4% van één kern voor acht tracks (~0,4% per
   track; Linux x86 in de sandbox, op de M1 opnieuw meten met `tools/bench/`).
5. Luisteren: kill, EQ-knop en een auto-DJ-blend op twee nummers, oud tegen nieuw.

Moeite: ~1 dag inclusief tests en een headless meting. Risico: middel. De fase in de
lage band verschuift (allpass, een paar ms groepsvertraging bij 50 Hz); alle tracks
gelijk, dus beatmatch en cue verschuiven niet t.o.v. elkaar, maar een vergelijking
"bit voor bit het oude pad" op de EQ zelf verdwijnt. Mag alleen na Clay's oor
(VISIE §5.4: eerst proeven).

---

## Kans 3: gain staging zichtbaar maken: luidheidsmeter, werkniveau, opname/stream op niveau

**Probleem.** Er is geen enkele luidheidsmeter: alleen piek (`engine.masterPeak`,
`engine.js:762`) en gain reduction. De masterfader staat standaard op 0,8 = −9 dB
(`engine.js:224-229`, `faderGain` = (1 − norm) × −45 dB): één nummer van −14 LUFS
komt dan op **−23 LUFS** naar buiten, en daarmee ook de opname (getapt na de limiter)
en de uitzending (`server/uitzend.js` leest het opnamebestand, G4). Voor een stream is
dat 9 dB zachter dan wat platforms gewend zijn. Zet Clay de master hoger, dan werkt
de limiter in elke blend. Het bovenste vijfde van de masterfader is 9 dB.

**Bewijs (`gs/sim.mjs`: twee synthetische dansnummers, kick op dezelfde tel zoals in
een beatmatch, eerst door de ingest-loudnorm naar −14 LUFS / TP −3,7, dan door de
echte `LimiterKern`):**

| scenario | master 0,8 (−9 dB) | master 0,9 (−4,5) | master 1,0 (0 dB) |
|---|---|---|---|
| 1 nummer | uit −23 dB rms, GR 0 | GR 0 | GR 0 (piek −3,8) |
| blend A+B, crossfader midden | GR 0 | GR 0 | GR max −1,1 dB |
| blend 2× thru (tracks 3–8 staan standaard op thru) | GR 0 | GR 0 | **GR max −4,1 dB, 25% van de tijd > 1 dB** |
| 1 nummer + low +6 dB | GR 0 | GR 0 | GR max −3,4 dB, 20% > 1 dB |
| 2× thru + low +6 op één | GR 0 | GR −2,4, 13% > 1 dB | **GR max −6,9 dB, 44% > 1 dB, 19% > 3 dB** |

De limiter heeft een vaste release van 80 ms (MASTER.md "Niet gehoord", VRAGEN S13):
bij 4–7 dB gain reduction op een kick van 124 bpm haalt hij tussen de kicks weer
adem, dus dat pompt. De auto-DJ-blend geeft bovendien +3 dB op de baswissel (beide
nummers vol, `planner.js:519-523`, uitgerekend met `standen()` en `faderGain`).

**Winst voor Clay.** Hij ziet waar de master moet staan zodat de limiter alleen
pieken vangt (beter geluid, geen pompen in een blend), en de opname en een stream
komen op een voorspelbaar niveau (draagbare set, VISIE §3). Op de iPhone
(Controlekamer) kan hij het van afstand zien.

**Hoe toepassen.**
1. Engine (`master.js`): een tak na `master.analyser` door een `IIRFilterNode` met
   de K-weging van ITU-R BS.1770 op 48 kHz (de twee biquads exact als coëfficiënten;
   een highshelf van Web Audio heeft geen Q en zit er net naast) naar een
   AnalyserNode met fftSize 32768 (0,68 s). Loopt nergens heen, zoals de analyser per
   strip (`audio-graph.js:59-65`). Geen worklet: een postMessage per blok zou afval op
   de audiothread zijn (AUDIOPAD.md).
2. Lezen op de LED-timer (setInterval, loopt ook op de achtergrond): elke 100 ms de
   laatste 400 ms (momentary) en een lopend gemiddelde van 3 s (short-term) in LUFS;
   een puur rekenbestand (`src/analysis/luidheid.js`) met een test op de ijking uit
   BS.1770 (een sinus van 997 Hz op 0 dBFS in één kanaal = −3,01 LUFS) en roze ruis.
3. Scherm: "S −14,2 LUFS" naast de mastermeter en de rode GR-balk, met een streepje
   op het werkniveau; in `status-zender.js` mee naar de Controlekamer.
4. Opname: na "klaar" een kopie `set-<id>.-14lufs.wav` met de lineaire normalisatie
   van kans 1 (ffmpeg, op de server, buiten het opnamepad). Voor live uitzenden zet
   Clay de master op de meter; geen AGC in de stroom.
5. Daarna pas beslissen of de masterfader een fijnere bovenkant nodig heeft, of de
   release programma-afhankelijk moet (`release` is al een optie van de kern).

Moeite: ½–1 dag. Risico: laag (alleen een tak die nergens heen loopt, en lezen).

---

## Kans 4: de vormlagen reageren op de stand van de masterfader, niet op de muziek

**Probleem.** De vormlagen (`?vormen=1`) lezen de master NA de masterfader
(`src/ui/vorm-paneel.js:46`) op vaste dB-bereiken die geijkt zijn met de master op
0,8 (`src/analysis/features.js:36-43`: rms mediaan −29, 95% −22 dBFS; `RMS_DB` =
[−50, −15]). Op master 1,0 komt alles 9 dB hoger: de 95% van rms wordt −13 en van laag
−33 dB, boven de bovengrens, dus continu 1,00. Dat is wat Clay op 13 okt zag
(BEELD.md r.101); de oplossing van toen (`src/koppel/niveau.js`) geldt ALLEEN voor de
zender naar de Stroommachine. VARVE's eigen vormlagen, de routes (bas → knop) en de
vaste terugval van de zender in de eerste seconde hebben het probleem nog.

**Winst voor Clay.** Het beeld in VARVE pompt even hard op master 0,8 als op 1,0;
de master instellen voor de zaal of de stream (kans 3) breekt het beeld niet meer.

**Hoe toepassen.**
1. `src/analysis/luisteraar.js`: een optie `compensatieDb: () => dB(faderGain(engine.masterLevel)) − dB(faderGain(0.8))`.
   Na `getFloatFrequencyData` die waarde van elk bin aftrekken (in de bestaande
   Float32Array, geen afval), het tijdsignaal met `1 / g` vermenigvuldigen. De ijking
   in BAND_DB blijft dan geldig ("alsof de master op 0,8 staat").
2. `vorm-paneel.js` en `src/koppel/beeld.js:261` geven de optie mee.
3. `test/analyse.test.mjs`: hetzelfde nep-spectrum op master 0,8 en 1,0 geeft
   dezelfde banden.

Moeite: 2–3 uur. Risico: laag. De gain reduction van de limiter telt niet mee (hooguit
een paar dB op pieken); een fader-mute (master 0) moet stilte blijven: compensatie
alleen boven bijvoorbeeld −40 dB.

---

## Bekeken en geen kans (of al goed)

- **Stems en headroom**: `server/stems/splits.py:369` schaalt alle stems met één factor
  als er één clipt en de engine zet 1/schaal terug (`deck.js:1560`). Klopt.
- **Keylock +3,6 dB pieken**: de keten is float tot de limiter; met master 0,8 is er
  9 dB ruimte. Pas een probleem op master 1,0, dus onderdeel van kans 3.
- **Limiter zelf**: degelijk gemeten (MASTER.md: −1,04 dBTP, 0 GC, onder het plafond
  bit voor bit). De ~0,8 dB "zachter dan vroeger" is make-up van de oude compressor die
  wegviel, geen fout; met een meter (kans 3) is het een kwestie van de master 1 mm
  hoger.
- **Auto-DJ-curves**: het commentaar zegt "equal power", maar sin/cos gaan door de
  dB-fader (`faderGain`), dus in een blend van 16 maten is de binnenkomende pas
  hoorbaar (−20 dB) vanaf maat 3 en vol op maat 7, en de uitgaande is na maat 13
  weg (`standen('blend', q)` uitgerekend). Dat lijkt op een echte fader en is geen
  fout, alleen het commentaar klopt niet. De bump van +3 dB op de wissel hoort bij
  kans 3; de holle klank tijdens de blend bij kans 2.
- **Filterresonantie**: tot +5,7 dB rond de afsnijfrequentie aan de uiteinden (Q 6,7 dB,
  `filterDoelen`). Een bewuste DJ-filterkleur; alleen op master 1,0 voelt de limiter het.

## Raakvlakken met de andere twee onderzoeken

- Kans 2 (isolator) en kans 3 (meter, GR) zijn knoppen en lampjes die de
  werkruimte-workflow kan willen plaatsen (welke kill waar, de meter op de iPhone).
- Kans 1 raakt het beatgrid niet: een vaste versterking verschuift geen onset.
