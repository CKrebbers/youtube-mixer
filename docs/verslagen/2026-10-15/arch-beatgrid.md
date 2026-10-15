# Spoor B: fase en tel 1 (15 okt 2026)

Architectuurronde, spoor B. Tak `arch/beatgrid` vanaf `origin/studio/architectuur` (99fb3f3). Doc:
`docs/BEATGRID.md` §14. Vier punten: B2 snappen naar de tellen, B3 een tweede mening over de "1",
B1 het echte Beat This! op de benchmark (GA3), B4 tools/beatmeting opruimen.

## 1. Wat er gebouwd is

### B2. "Tel 1 hier", "tellen hier" en vast snappen naar de tel van Beat This!

- `snapNaarTel(tellen, onsets, t)` in `src/engine/beatgrid.js`: de tel uit `deck.tellen.beats` die het
  dichtst bij t ligt binnen 30 ms (`SNAP_VENSTER`); is die er niet, de klap (`deck.onsets`) zoals
  `snapNaarOnset`; anders t zelf. Puur, geen DOM.
- `klappenEnTellen(tellen, onsets)`: tellen en klappen samen, gesorteerd, onthouden per paar
  (WeakMap). Voor `Beatgrid.pin(t, { klappen })`: die telt hoeveel gridlijnen tussen anker en t raak
  vallen (binnen 15 ms) om n−1/n/n+1 tellen te kiezen. Met alleen de tellen viel bij een netwerk op het
  halve tempo elke tweede lijn naast (score ~0,5 = precies de grens van pin, en met 3% gemiste tellen
  eronder); met alleen de klappen liggen die tot 15 ms scheef. Samen valt elke lijn op een tel of een klap.
- `src/control/actions.js`: `grid.here`, `grid.align`, `grid.pin` (en `grid.pin.op`) en `grid.here.op`
  (klik in de golfvorm) gebruiken het. Labels: "snapt naar een tel of klap".
- Checks: `test/beatgrid.test.mjs` (10 nieuw: met tellen de tel, zonder de klap, buiten het venster de
  positie zelf, tellen zonder klappen, samenvoegen en onthouden) en `test/grid-bediening.test.mjs` (5 nieuw,
  op de echte engine via de APC: met tellen landt tel 1 hier op ≤ 3 ms van de tel waar de klap 10 ms vroeg
  ligt; zonder tellen −10 ms zoals vroeger; Beat This! op het halve tempo: op een tel de tel, ertussen de
  klap; niets = de positie zelf (12 ms, de mens); vast op 5:00 met tellen op het halve tempo en scheve
  klappen: geteld, tempo ≤ 0,01%, fase ≤ 3 ms).
- Meting: `tools/beatmeting/synth/snap.mjs` (nieuw), en kolom T in `tools/beatmeting/rest/tel1-echt.mjs`.

### B3. Een tweede mening over de "1" uit de lage band

- `laagEnvelope(x, sr)` in `server/detect.js`: de energie onder 150 Hz (hoogdoorlaat 30 Hz, twee keer
  laagdoorlaat 150 Hz, één pool elk, per sample) in vakjes van 4 ms. Los van `onsetEnvelope` (die blijft
  bit voor bit gelijk; `analyze.test` groen).
- `maatSterkte(st, tot, per, laag)` en `maatMening(kaart, laag)` in `src/engine/tellen.js` (puur): per tel
  van de maat de mediaan van wat er na de gridlijn BIJ komt in de lage band; is de "1" < 0,6 × de sterkste
  tel (`MAAT_LAAG`), komt die sterkste boven 2 × de vloer uit (`MAAT_LAAG_VLOER`: het gemiddelde van wat er
  midden tussen twee tellen bijkomt) en zijn er ≥ 8 maten (`MAAT_LAAG_MATEN`), dan `twijfel: 'maat'`. Geen
  andere "1", de zekerheid blijft; een stuk met een andere twijfel houdt die. De uitleg van 'maat'
  (`TWIJFEL_TEKST`) zegt nu ook "of de kick en de bas vallen vooral op een andere tel".
- Server: `maakLaag` (worker-taak `laag`, `LAAG_VERSIE` 1) in `server/analyze.js`; `leesLaag` /
  `bewaarLaagMeta` / `LAAG_BESTAND` in `server/tellen.js` (`media/<id>/laag.bin` + `laag.json`, de json pas
  na de bin; `wisTellen` haalt ze weg bij nieuwe audio); `pasTellenToe` in `server/index.js` leest of
  rekent de lage band (op de achtergrond pas als er geen deck speelt, ↻ rekent altijd opnieuw) en past
  `maatMening` toe na `vergelijk`. Het logboek zegt "lage band bewaard/uitgerekend/geen".
- De benchmark: `scoor.mjs` meet nu ook `eenVals` (de "1" fout en het stuk zegt zeker zonder twijfel),
  `eenOnterecht` (de "1" goed maar twijfel 'maat') en `eenMaat`; `bench.mjs` rekent de lage band zoals de
  server (`maakLaag`, onthouden), kolom `"1"?`, optie `--geen-maat`.
- Checks: `test/beatbench.test.mjs` (9 nieuw, op echte audio door de worker: eenfout gemarkeerd in de
  zeven nummers met een accent op de "1", en zonder de lage band waren ze fout zonder twijfel; een goede
  "1" nooit onterecht; vier op de vloer zegt niets; de zekerheid verandert nergens; zonder lage band of met
  alleen ruis niets; een andere twijfel blijft). `test/tellen-server.test.mjs` (7 nieuw: laag.bin/laag.json
  lezen, versie, een te korte bin, een vreemd id, wisTellen; op een eigen server: de lage band bewaard en
  in het logboek).

### B1. Het echte Beat This! op de benchmark (GA3): kon hier niet, de bench is klaar

Geprobeerd (~10 minuten): PyPI en files.pythonhosted.org zijn bereikbaar (`beat-this` 1.1.0 is er, torch
zou kunnen), maar het checkpoint `final0.ckpt` staat alleen op cloud.cp.jku.at (403 van de proxy), en
huggingface.co en zenodo.org geven ook 403. Zonder checkpoint geen model; torch is daarom niet
geïnstalleerd. Wel: `bench.mjs --beatthis <python>` draait het echte `server/tellen/tellen.py` op de wav's
van de benchmark en neemt het mee als variant `echt` (tellen.json onthouden in `$TMPDIR/varve-beatbench`,
per audio, python en tellen.py). Getoetst met een nep-python (een script dat tellen schrijft).

### B4. tools/beatmeting opgeruimd, niets weggehaald

- `tools/beatmeting/LEESMIJ.md` (nieuw): wat leeft (`synth/`, door `test/beatbench.test.mjs` gebruikt;
  `rest/gridpast*.mjs`, `rest/tel1-echt.mjs`, `rest/lib.mjs`) en wat eenmalig onderzoek van september was
  (bovenaan, `stapA/`, `rest/fragment.mjs`, `rest/tel1-synth.mjs`).
- `stapA/detect-oud.js` teruggezet uit de geschiedenis: `git show a22c5ae^:server/detect.js`, de detect.js
  van vlak vóór "Beatgrid stap A" (a22c5ae), met een kop over de herkomst. Gekozen omdat `drietwee-lib.mjs`
  `tempoUitEnvelope` oud tegen nieuw vergelijkt en de drie-twee-keuze in a22c5ae kwam; `ag-lib.mjs` gebruikt
  `segmenteer` en `tempoCurve`, die die versie ook exporteert (nagekeken). Hij was nooit gecommit. (De
  container had een ondiepe clone; `git fetch --deepen=2000` gaf de hele geschiedenis.)
- Twee kapotte verwijzingen gerepareerd: `stapA/stab.mjs` importeerde `../varve-beat/gridfit.mjs` (de oude
  naam van de map), nu `../gridfit.mjs`; `tools/beatmeting/lib.mjs` las `ROOT/media/…`, wat sinds media/
  buiten iCloud staat (VI2) niets meer vond: nu de media-map van `rest/lib.mjs`.
- `tools/README.md`: verwijzing naar de LEESMIJ, `--beatthis`, `--geen-maat`, `synth/snap.mjs`.

## 2. Metingen

### B2, synthetisch (`node tools/beatmeting/synth/snap.mjs`)

20 nummers (ambient niet), elke derde tel, ±25/12/0 ms naast gedrukt: 12 505 drukken. De klappen ECHT (de wav
door maakOnset/maakOnsets met PIEK_GEIJKT), de tellen nep (σ 6 ms, géén vaste afwijking).

| | gem | \|p50\| | \|p90\| | > 10 ms |
|---|---|---|---|---|
| klap (tot nu) | −3,1 ms | 10,4 | 25,0 | 53% |
| … alleen waar een klap binnen 30 ms lag | −8,9 | 9,0 | 14,1 | 42% |
| tel (`bt`) | −0,2 | 2,3 | 6,6 | 6% |
| tel, netwerk +5 / +10 / +15 ms scheef | +2,7 / +5,2 / +7,8 | 5,1 / 9,9 / 13,7 | 10,6 / 14,1 / 18,2 | 12 / 48 / 79% |
| tel (`ruis`: σ 10 ms, 10% gemist) | −0,2 | 3,9 | 12,0 | 14% |
| tel (`half`: elke tweede tel, ertussen de klap) | −1,4 | 4,5 | 15,2 | 26% |

De klap is synthetisch even scheef als op Clay's muziek (−8,9 tegen −6 … −12 ms). Of het echte netwerk
een vaste afwijking per klank heeft, weet alleen de meting op de Mac (§5): onder ~10 ms scheef wint de tel.

### B3, de benchmark (`bench.mjs`, met en zonder `--geen-maat`)

21 nummers × 8 soorten fouten = 168 gevallen, de oude analyse als tweede mening zoals de server.

| | zonder (= vóór) | met |
|---|---|---|
| vals zeker | 0 van 168 | **0 van 168** |
| dekking / tempo / DJ-tempo / naast | 90 / 71 / 81 / 5% | gelijk, in elk geval |
| `eenfout`: "1" fout zonder twijfel | 99% | 50% |
| `eenfout`: nummers gemarkeerd (≥ 80% van de "1"-en) | 0 van 20 | **10 van 20** |
| `dubbel-laat` / `dubbel-kaal`: "1" fout zonder twijfel | 70 / 65% | 1 / 1% |
| een goede "1" onterecht met twijfel 'maat' | 0 | **0 — in geen enkel van de 168 gevallen** |

Gemarkeerd: vast-72, vast-96, vast-160, swing-118, wals-150, reggae-75, jungle-172, halftime-140,
opmaat-126 (100%) en indie-154 (87%). Niet: vier op de vloer (house-124, vast-140, 178, 186, 192,
break-124, intro-128, wissel-124-131, oplopend: elke tel een kick) en live-drift (11%: daar is het al
'rubato'). `test/beatbench.test.mjs`: 59 → 68 checks, groen (~47 s).

De eerste versie (een FFT-flux per frame van 11,6 ms) markeerde ten onrechte in `oplopend/bt` en
`indie-154/dubbel` (16–17% van de "1"-en): de plek van de aanslag tussen twee frames schuift per tel op,
en op 122,3 bpm is dat precies één ronde per maat. Daarom energie per sample.

Kosten: `maakLaag` 0,45 s voor 3 minuten, 4–5 s voor een uur (deze container). `maatMening`: microseconden.

## 3. Wat niet, en waarom

- **De kaart-VERSIE (2) is niet verhoogd** (de opdracht: niet zonder vraag). Gevolg: in Clay's library
  krijgen alleen nieuwe nummers en ↻ de tweede mening over de "1". Zie vraag AB1.
- **Vier op de vloer**: de lage band vindt daar een verkeerde "1" niet (elke tel een kick, de bas op de
  offbeat). Een volgende stap zou de bas-TOON zijn (een nieuwe noot op de "1") of de hihat/crash; niet
  gebouwd.
- **De "1" kiezen** doet de lage band nooit; alleen twijfel. Ook niet waar hij overtuigend is (reggae).
- **Het echte Beat This!** draaide niet (geen checkpoint); de getallen van GA3 komen van de Mac.
- **Getest op synthetische muziek** (de bench) en met nep-tellen. Op Clay's muziek: niets gemeten (geen
  media in de container). De drempels (0,6 en 2) zijn gekozen op de bench met ruime marge (de verhouding "1" /
  sterkste tel over 180 stukken met een goede "1": laagste 0,92; foute "1"-en met een accent in de lage band
  liggen ver onder 0,6, in vier op de vloer op ~1,0), niet op echte muziek.
- `tools/beatmeting/stapA/` en de scripts bovenaan zijn niet gedraaid (ze lezen de library via een
  draaiende server op 8777 en Clay's media); alleen nagekeken dat elke import bestaat en de exports kloppen.

## 4. Tekst voor CLAUDE.md (sectie "Beatgrid", bullets)

- SNAPPEN (15 okt, BEATGRID.md §14): tel 1 hier, tellen hier, vast en de klik in de golfvorm snappen via
  `snapNaarTel(d.tellen, d.onsets, t)`: eerst de tel van Beat This! binnen 30 ms, dan de klap, dan de positie.
  De klappen hebben een vaste ijking (synthetisch −8,9 ms gemiddeld). Vast telt op `klappenEnTellen` (tellen
  en klappen samen). Een nieuwe plek die snapt: dezelfde helper, nooit `snapNaarOnset(d.onsets, …)` alleen.
- DE "1" TEGEN DE LAGE BAND (15 okt, §14): `maatMening(kaart, laag)` na `vergelijk` in `pasTellenToe`; de
  lage band (`laagEnvelope`, energie < 150 Hz per 4 ms) staat in `media/<id>/laag.bin` + `laag.json`
  (`LAAG_VERSIE`). Alleen `twijfel: 'maat'` (de zekerheid blijft, nooit een andere "1"); vier op de vloer zegt
  niets. Verander je `laagEnvelope`: `LAAG_VERSIE` omhoog. Verander je `maatMening`: `node
  tools/beatmeting/synth/bench.mjs` met en zonder `--geen-maat` en `test/beatbench.test.mjs` (geen goede "1"
  onterecht, vals zeker 0). Een FFT-flux per frame is hiervoor NIET goed (aliasing tegen de maat, §14).
- `tools/beatmeting/LEESMIJ.md` zegt wat er leeft; `bench.mjs --beatthis <python>` draait het echte model.

## 5. Opdrachten voor Clay's Mac

Vanuit de projectmap (of een worktree van `arch/beatgrid`), met de server UIT voor de metingen die niets
met de server te maken hebben:

```
# GA3: het echte Beat This! op de benchmark (een paar minuten; de oude analyse ~1 min de eerste keer)
node tools/beatmeting/synth/bench.mjs --beatthis ~/.varve/stems-venv/bin/python --json /tmp/echt.json
node tools/beatmeting/synth/groep.mjs /tmp/echt.json          # 'bt' (de nep) naast 'echt' per soort

# B2 op Clay's eigen fragmenten: kolom T (snappen naar de tel) naast A (de klap); de fragmenten van 25 sep
node tools/beatmeting/rest/tel1-echt.mjs _x5K5Ihutbw:1414:100:174 CVeYI-gmX00:889:56:170 \
  f3a7DiCsm8k:120:48:150 f3a7DiCsm8k:705:100:156 mOzW9KQKfzA:1710:80:115.2 HGv_ySHXtYI:0:44:156.69
```

De tweede opdracht leest `media/<id>/onset.bin`, `audio.wav` en (nieuw) `tellen.json`; schrijft alleen in de
tijdelijke map. Zonder tellen.json staat er "(geen tellen.json voor dit nummer)". Let op: de derde mening
daar is zelf 4–8 ms laat op een scherpe aanzet (geijkt, staat bovenaan de uitvoer); kijk dus vooral naar het
verschil tussen A en T, en of T dichter bij 0 ligt dan A. (De bpm-getallen achter de laatste dubbelepunt
zijn een startwaarde, uit `rest/tel1.txt` overgenomen; de oorspronkelijke aanroep van 25 sep staat nergens.)

## 6. Open vragen voor Clay (voor docs/VRAGEN.md)

- **AB1. Kaart-VERSIE 3, zodat de hele library de tweede mening over de "1" krijgt?** 💬 Bij de eerste start
  rekent de server elk automatisch grid uit de tellen opnieuw: milliseconden per nummer (de tweede mening is
  bewaard) plus één keer de lage band (~0,5 s per 3 minuten, een uur ~5 s), wachtend zolang er een deck
  speelt. Tempo, tellen en "1" blijven precies hetzelfde; alleen staat er bij een verdachte "1" een "?".
  Samen te nemen met GA2 (die ook al een herberekening vraagt). **Advies:** ja, samen met GA2, op een dag
  zonder optreden; eerst de meting van §5.
- **AB2. Twijfel over de "1" en sync.** 💬 Bij 'maat' mogen sync en beat-loops (het tempo en de tel kloppen),
  alleen de "1" staat op "?". Gevolg: starten op de maat, secties en de frasegrenzen van de auto-DJ gebruiken
  die "1" gewoon. Liever bij twijfel over de "1" ook onzeker (sync weigert)? **Advies:** zo laten; de "1" zet
  je met ← 1 / → 1 in twee drukken.
- **AB3. Vier op de vloer.** 🎧 Komt het bij jou voor dat de "1" van een house/techno-nummer een tel naast
  staat zonder dat het vraagteken komt? Dan is de bas-toon of de crash de volgende bron. **Advies:** eerst
  kijken of het voorkomt.

## 7. Tests

`node test/alles.mjs --banen 2` (één keer, aan het eind): **133 bestanden, 11457 checks, 10 overgeslagen —
4 ROOD**, 689 s. Rood, allemaal de bekende omgevingsfouten van deze Linux-container, geen enkel bestand
van deze tak erbij: wachtrij (2× "yt-dlp en zijn kind zijn allebei weg"), renderblok ("keylock met
wissels"), instrumenten-fm-schaal (afval per blok onder load), backup-kopie (2: "één regel" en
"controleer: exit 0, alles ok"; tools/backup en de test zijn hier niet aangeraakt). Groen wat deze tak
raakt: beatgrid (175), beatbench (68, was 59), grid-bediening (22), tellen (90), tellen-server (74),
detect (130), analyze (24).
