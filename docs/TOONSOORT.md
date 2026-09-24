# Toonsoort: meting en ontwerp (24 september 2026)

Clay wil de toonsoort (key) van een nummer vastleggen zoals het beatgrid: per
link, in stukken, met een zekerheid, en met de hand te bevestigen. Dit document
is het onderzoek en het ontwerp. Er is NIETS in `src/` of `server/` veranderd.
Keylock en transponeren doet een andere agent; hoe die hierop aansluiten staat
in §6.

Meetinstrument: `tools/toonsoort/` (zie `tools/README.md`). Uitkomsten:
`tools/toonsoort/synth.txt` (synthetisch) en `tools/toonsoort/meting.txt`
(Clay's library, 8 nummers, 2 uur 38 min audio). Bekende toonsoorten met bron
in `tools/toonsoort/bekend.json`.

## Kort

- **Algoritme:** chroma uit een gewone FFT op 4410 Hz (ROADMAP "Toonsoort"),
  met STEMMINGSCORRECTIE (A = 432 komt voor, en zoned out staat op +43 cent),
  harmonisch/percussief scheiden en log-compressie. Profiel **Temperley 2005**.
  Een KAART in stukken (Viterbi over vensters van 24 s) met per stuk een eigen
  stemming.
- **Zekerheid:** boven een geschudde nul (dezelfde twaalf toonklassen in een
  willekeurige volgorde) × de marge tot de beste toonsoort met een ander
  Camelot-getal.
- **Gemeten:** 8 van de 10 stukken met een bekende toonsoort goed (edma, het
  ROADMAP-voorstel: 5; Krumhansl: 5). De kaart geeft zonder de grenzen te
  kennen 81% van de tijd het goede Camelot-getal (edma 50%). In het
  ADRIANA-album liggen alle 17 kaartgrenzen binnen 15 s van een echte
  nummergrens (mediaan 3,5 s).
- **Snel:** ~0,10 s per minuut audio op de M1 in rust (een uur: 6 s), tot
  ~0,45 s per minuut als de machine druk is. Past in de bestaande worker.
- **Eerlijk:** de helft van de tijd in Clay's library krijgt een zekerheid
  onder 0,15. Dat is ambient, drone en harmonisch rijke piano: "geen duidelijke
  toonsoort" is daar een echt antwoord, geen fout.

## 1. Wat er gemeten is

### Synthetisch (`synth.txt`)

Akkoordenreeksen op 48 kHz, door DEZELFDE ffmpeg-hersampler als de library.

| Proef | Uitkomst (Temperley 2005, hpss+log) |
|---|---|
| Alle 24 toonsoorten (cadens, drums, melodie, ruis) | 24/24 |
| Stemming 440 / 432 / +25 / −45 cent | gemeten −1 / −33 / +24 / −46 cent (±1,5); toonsoort 8/8 goed. ZONDER correctie 3/8 fout (432 Hz: C → Em) |
| Mineur tegenover relatief majeur | Am met leidtoon goed; Am F C G wordt F (een fout die elk profiel maakt of niet; Krumhansl en edma hadden hem hier goed) |
| Ruis, alleen drums, willekeurige drieklanken | zekerheid 0,00 |
| Drone A-E zonder terts | 0,10: goed onzeker |
| Modulatie C → Es → stilte → Fis mineur | grenzen op 87/182/238 s (echt 90/180/240) |
| Mix met stukken op 0, +45, −40 cent | met stemming per stuk: C, C, Es. Met één stemming voor het geheel: F, Des, Es |

### Clay's library (`meting.txt`)

Bekende toonsoorten zijn schaars. Bron H = bladmuziek, transcriptie of analyse;
M = Spotify's algoritme via songbpm.com (zelf een algoritme, dus geen echte
grondwaarheid); X = bronnen spreken elkaar tegen (telt niet mee). Welke opname
Clay heeft is uit de duur afgeleid (koko 4:18 = de "Instrumental" in As;
The Last Emperor 5:54 = de soundtrackversie).

| Stuk | Bekend (bron) | Gevonden (T05) | Zekerheid | Kaart goed |
|---|---|---|---|---|
| Sakamoto – Aqua 0:00–3:35 | G (M) | G · 9B | 0,87 | 100% |
| Aqua, slot 3:35–4:31 | — | **As · 4B**: een modulatie een halve toon omhoog, in beide versies gevonden en in de chroma te zien | 0,83 | |
| Merry Christmas Mr. Lawrence | Des / Bes m (H) | Bes m · 3A | 0,31 | 100% |
| Bolerish | C (H, transcriptie; Spotify zegt F) | C · 8B | 0,56 | 97% |
| Rain | B of Es m (X) | Es m · 2A | 0,00 | — |
| The Last Emperor (Theme) | G / E m (M) | E m · 9A | 0,00 | 67% |
| koko | As (M) | As · 4B | 0,42 | 98% |
| Solitude | F m / As (H) | As · 4B | 0,00 | 97% |
| Blu | A m of F (X) | C · 8B | 0,17 | — |
| Ieta | F (M, enige bron) | C · 8B (kwint) | 0,00 | 0% |
| Germination | B m / D (H) | D m · 7A (parallel) | 0,00 | 0% |
| The Sheltering Sky | C m of G m (X) | G m · 6A | 0,04 | — |
| MCML (orkest) | Bes m (M) | Des · 3B | 0,00 | 94% |
| Aqua (orkest) | G (M) | G · 9B | 0,81 | 100% |
| Bay Ledges – Ciel (demo) | niet te vinden | D · 10B, alle profielen eens | 0,77 | |
| No Surprises (cover Lennon Stella, TikTok) | origineel F (H) op ~−34 cent; cover onbekend | D · 10B / B m, −8 cent | 0,18 | |
| ADRIANA – figure xiii (19 nummers) | niet te vinden | 18 stukken, stemming per nummer −45 … +25 cent | 0,00–0,52 | grenzen 17/17 raak |
| Ambient2K – zoned out (mix) | niet te vinden | 11 stukken; −48, +43, +25, −5 cent; na 25:30 dezelfde kaart opnieuw | 0,00–0,74 | |
| Clay's sets (3 opnames) | — | Fis (0,31), G (0,09), 5 stukken | | stemming schuift mee met de pitch |

De "fouten" met hoge zekerheid bleken bij nazoeken de bron te zijn die niet
klopte: Bolerish heeft in de transcriptie geen voortekening en een orgelpunt op
C (de passages met bes maken het C mixolydisch, dezelfde tonen als F majeur:
Spotify's algoritme valt daar in dezelfde kwint-valkuil), en het slot van Aqua
is echt As. Na correctie klopten alle vier de bekende kaartstukken boven
zekerheid 0,65.

### Profielen (hpss+log, 10 stukken H/M)

| Profiel | Goed | Goed Camelot-getal | MIREX-score | Kaart: tijd goed | Kaartgrenzen raak |
|---|---|---|---|---|---|
| **Temperley 2005** | **8** | **8** | **0,87** | **81%** | 26/39 (67%) |
| Temperley 1999 | 8 | 8 | 0,87 | 75% | 25/42 |
| Temperley 2005 + edma (gemiddeld) | 7 | 7 | 0,77 | 67% | 23/45 |
| Alle zes gemiddeld | 7 | 7 | 0,77 | 61% | |
| edma (Faraldo, EDM) | 5 | 6 | 0,70 | 50% | 25/41 |
| bgate (Faraldo, Beatport) | 5 | 6 | 0,70 | 54% | |
| Sha'ath (KeyFinder) | 5 | 5 | 0,67 | 52% | |
| Krumhansl-Kessler | 5 | 5 | 0,67 | 45% | |

(MIREX: goed 1, kwint 0,5, relatief 0,3, parallel 0,2.) Waar Krumhansl, Sha'ath
en edma de fout ingaan is het bijna altijd dezelfde: de toonsoort een KWINT
HOGER (Es voor As, C m voor F m, B m voor E m). Dat is de derde harmonische:
elke noot telt in een chroma ook een kwint hoger mee. Twee buurtoonsoorten
verschillen maar in één toon; Temperley 2005 straft tonen buiten de toonladder
veel harder af (0,06–0,10 tegen 0,37–0,75 erbinnen; Krumhansl 2,2–2,5 tegen
2,9–6,4) en weegt die ene toon dus zwaarder.

### Varianten (Temperley 2005)

Lineair, log, hpss+log, met vloer, vanaf 27,5 Hz, boventonen aftrekken,
stemming lopend: op de library allemaal 8/10. Synthetisch: lineair en hpss+log
24/24, log zonder hpss 19/24 (de drums worden dan even luid als de akkoorden).
Gekozen hpss+log: de foute antwoorden krijgen daar zekerheid 0,00 (lineair:
0,08), en een luide basnoot overheerst de chroma minder. Boventonen aftrekken
helpt Krumhansl en edma (5 → 7) maar Temperley niet; niet nodig. FFT op
11025 Hz met 32768: dezelfde uitkomsten, drie keer de rekentijd. Hop 8192
tegen 4096: dezelfde uitkomsten, de helft van de rekentijd.

### Rekentijd (M1, per minuut audio)

| Stap | In rust | Druk (andere processen) |
|---|---|---|
| ffmpeg: audio.wav → mono 4410 Hz | 0,07 s | tot 0,4 s |
| FFT + stemming (hop 8192) | 0,033 s | ~0,1 s |
| chroma, profiel, kaart, stemming per stuk | 0,003 s | |
| **Totaal** | **~0,10 s** (uur: 6 s) | ~0,45 s (uur: 27 s) |

Ter vergelijking: de onset-analyse kost 0,3 s per minuut. Geheugen in de
worker: de pcm op 4410 Hz is 64 MB per uur (streamen kan, zie §4), het fijne
spectrum 6 MB per uur.

## 2. Algoritme en profiel

De keten (`tools/toonsoort/toon.mjs`, hoofdvariant `hpss+log`):

1. **Lezen:** ffmpeg, mono, 4410 Hz (zoals `leesPcm` in `analyze.js`). Het
   downsamplen filtert gratis de hihats weg en geeft met een FFT van 16384
   0,27 Hz per bin: genoeg voor de bas (bij A1 is een halve toon 3,3 Hz).
2. **FFT** van 16384 (3,7 s, Hann), hop 8192. De FFT uit `server/detect.js`.
3. **Fijn spectrum** in stapjes van 10 cent t.o.v. A = 440, 27,5–2000 Hz.
4. **Stemming:** elke spectrale piek (≥ 4× zijn omgeving, parabolisch
   geïnterpoleerd, boven 100 Hz) geeft zijn afwijking in cent modulo 100 als
   een hoek; het gewogen cirkelgemiddelde is de stemming. Per frame bewaard,
   zodat elk stuk van de kaart zijn eigen stemming krijgt. Altijd tussen −50
   en +50 cent: een stuk op +52 heet "C♯ op −48".
5. **Halve tonen** 55–2000 Hz (A1–B6) rond die stemming, cos²-kern (twee buren
   tellen op tot 1).
6. **Harmonisch/percussief:** masker H²/(H²+P²), H = mediaan over ±2 frames,
   P = mediaan over ±4 halve tonen (Fitzgerald, op het halvetoonrooster).
7. **Log-compressie** log(1 + 10·x/mediaan), dan optellen per toonklasse.
8. **Profiel:** Pearson-correlatie met de 24 gedraaide profielen van
   Temperley 2005 (waarden uit Essentia `key.cpp`).
9. **Kaart:** vensters van 24 s om de 6 s; Viterbi over 24 toonsoorten + stilte
   met een straf van 1,2 per wissel (gemeten: 0,35 gaf 66 grenzen voor 30
   echte, 1,2 gaf 39 met dezelfde dekking); per stuk de toonsoort opnieuw over
   al zijn frames; stukken < 24 s gaan op in de langste buur.
10. **Stemming per stuk:** tweede doorgang, elk stuk opnieuw met zijn eigen
    stemming; buren met dezelfde toonsoort en < 20 cent verschil gaan samen.

**De zekerheid** van een stuk = `toon × beslist`:

- `toon` = (r − p97 van de nul) / (1 − p97), geklemd op 0..1. De nul: 64 keer
  dezelfde twaalf chromawaarden in een willekeurige volgorde, met dezelfde
  profielkeuze. Zelfde luidheid, zelfde piekerigheid, geen toonladder.
  Tijd schudden (zoals bij het grid) werkt hier niet: een toonsoort is een SOM
  over de tijd, en die verandert niet als je de volgorde husselt. De eerste
  poging (elk blok van 4 s een willekeurig aantal halve tonen verschuiven) gaf
  zekerheid 0 op ALLES, ook op schone cadensen: een blok van 4 s draagt zelf
  al een toonsoort.
- `beslist` = marge tot de beste toonsoort met een ANDER Camelot-getal, gedeeld
  door 0,15. Relatief majeur/mineur (8A/8B) telt niet als twijfel: zelfde
  tonen, zelfde plek op de wijzer. C tegenover G wel.

**Drempels (voorlopig):** zeker ≥ 0,40, geen duidelijke toonsoort < 0,15.
Onderbouwing uit de kaart van de library: boven 0,40 klopten 5 van de 6
bekende stukken (de zesde is een intro van 33 s die mogelijk echt in c staat),
tussen 0,15 en 0,40 1 van 2, onder 0,15 3 van 5. Dat is weinig; er is geen
gat zoals bij het grid (0,06/0,20 en 0,62/0,69). Herijken zodra Clay twintig
nummers op slot heeft gezet (§7: elk slot is een meetpunt).

**Bekende fouten** en wat ze betekenen voor mixen:

| Soort | Voorbeeld | Voor mixen |
|---|---|---|
| Relatief (A ↔ B) | Am F C G → C of F | onschadelijk: zelfde Camelot-getal, zelfde tonen |
| Kwint (±1 op de wijzer) | Ieta: F → C | meestal onschadelijk: buren op de wijzer passen |
| Parallel | Germination: Bm → Dm | fout: drie tonen verschillen |
| Stemming rond ±50 cent | zoned out +43 | naam springt een halve toon; opgevangen door de stemming per stuk en die te tonen |

**Het ROADMAP-voorstel** (edma, met Temperley als tweede mening) is gemeten
en verliest op dit repertoire: edma is afgeleid uit EDM, en Clay's library is
piano, ambient en liedjes. De combinatie T05+edma zit ertussen (7/10, 67%).
Advies: Temperley 2005 alleen (beslissing T1).

## 3. Opslag

Per link, net als het grid, in tracktijd.

**Schema v6** (`server/library.js`):

```sql
ALTER TABLE tracks ADD COLUMN toon_json TEXT;
```

```json
{
  "versie": 1,
  "stemming": 2.3,
  "stukken": [
    { "van": 0,     "toonsoort": "G",  "stemming": 8, "zekerheid": 0.87 },
    { "van": 215.2, "toonsoort": "Ab", "stemming": 8, "zekerheid": 0.83 }
  ],
  "bron": "auto",
  "slot": false
}
```

- `toonsoort`: vaste spelling `C Db D Eb E F F# G Ab A Bb B`, `m` erachter voor
  mineur. Leesbaar, en Camelot en de Nederlandse naam volgen eruit. `null` =
  met de hand "geen toonsoort" gezet (een automatische kaart geeft altijd een
  toonsoort, met een zekerheid).
- `van` in tracktijd (s); een stuk loopt tot de `van` van het volgende.
- `stemming` in cent, −50..+50: per stuk, en `stemming` bovenaan voor het geheel.
- `zekerheid` alleen bij `bron: 'auto'`; een stuk dat met de hand gezet is, is
  zeker.
- `bron` `'auto'` | `'hand'`, `slot` = met de hand bevestigd: wordt NOOIT
  automatisch overschreven. Precies als het grid (`autoGridWeigert`,
  `moetAnalyse`).
- `versie` = versie van de analyse. Nieuw ten opzichte van het grid: als het
  algoritme beter wordt, analyseert de achtergrond alle `auto`-kaarten met een
  oudere versie opnieuw (slot en hand blijven). Bij het grid ontbreekt dat nu.

In `library.js`, naast de gridfuncties: `normaliseerToon`, `autoToonWeigert`
(`overHand`, `overSlot`, `alleenOud`), `moetToonAnalyse`, `teToonAnalyseren`,
`bewaarToon`, `bewaarAutoToon` (lezen en schrijven in één transactie).
`_verrijk` geeft `toon` mee in `/api/library`.

**Geen `chroma.bin` in versie 1.** ROADMAP noemde hem ("zodat latere
afstemming milliseconden kost"). Met een stemming per stuk is één bewaarde
chroma niet genoeg (een ander stuk = een andere stemming = een andere chroma),
en opnieuw rekenen vanaf `audio.wav` kost 6–27 s per uur in de worker. Een
cachebestand met eigen formaat en ongeldig-maken is dat nu niet waard. Komt er
een interactief "opnieuw analyseren vanaf hier", dan alsnog (~120 kB per uur
voor chroma plus stemming per frame).

## 4. Wanneer

- **Bij het binnenhalen**, in `verwerk()` (`server/ingest.js`), na het grid:
  `onStap({ stap: 'toon', tekst: 'toonsoort zoeken' })`, `maakToon(audio)` in
  de bestaande worker (`inWerker('toon', …)`, `hier.toon` in `analyze.js`).
  Mislukt het, dan is er geen toonsoort en probeert de achtergrond het later;
  de ingest faalt er nooit op.
- **Op de achtergrond** voor wat er al staat: dezelfde wachtrij als het grid
  (`heranalyseOpAchtergrond`), per nummer eerst het grid, dan de toonsoort als
  `moetToonAnalyse`. Eén tegelijk, niet tijdens een ingest, `VARVE_HERANALYSE=uit`
  geldt voor allebei. Clay's acht nummers: 16–70 s in totaal, één keer.
- **↻ in de library** doet grid én toonsoort opnieuw (tweede klik als er een
  slot op staat, zoals nu).
- **Rekenwerk** in een nieuw `server/toon.js` (uit `tools/toonsoort/toon.mjs`,
  zonder de varianten en de oude nul), met `fft` uit `detect.js`. Niet in
  `detect.js` zelf: die is 1100 regels beat.
- **Later goedkoper** als het nodig is: de onset-analyse leest de audio al op
  11025 Hz; door 2 delen (5512,5 Hz, halfband-filter in JS) en dezelfde worker
  bespaart de tweede ffmpeg-lezing (0,07–0,4 s per minuut). De pcm kan ook
  frame voor frame uit ffmpeg komen in plaats van 64 MB per uur in één keer.

## 5. Weergave

**Camelot én naam**, op drie plekken. Camelot omdat je er harmonisch mixen aan
afleest (zelfde getal of ±1 past); de naam omdat een muzikant hem kent.

| Plek | Wat | Voorbeeld |
|---|---|---|
| Library, kolom "toon" naast "bpm" | toonsoort van de PLAAT; bij een album de hoofdtoonsoort (meeste tijd) plus het aantal andere | `9B G`, `3A B♭m +4` |
| Kolomkop (per track, naast de BPM) | Camelot van wat je NU HOORT, op de positie | `9B` |
| Focusdeel, bij de BPM | groot: Camelot + naam + verschuiving + stemming | `4B · As majeur` `+1` `−32 ct` |
| (optie, later) strook onder het overzicht | per stuk een kleur van de wijzer, zoals de gridstrook | albums in één oogopslag |

**Onzeker** gaat zoals bij de BPM (`bpmTekst`: een "?" erachter): tussen 0,15
en 0,40 gedimd met "?", onder 0,15 een `~` met als tooltip "geen duidelijke
toonsoort (best passend: E, of A)". Voor Clay's ambient is dat eerlijk en geen
foutmelding: de helft van de tijd in de library valt daaronder. De tweede
kandidaat staat in de tooltip, want de meest gemaakte fout is een kwint of de
relatieve.

**Stemming** tonen vanaf 20 cent afwijking (`−32 ct`): onder 20 cent hoor je
het niet, erboven zweeft het naast een ander nummer. Tussen twee toonsoorten
(±40–50 cent) zegt de tooltip dat: "tussen C en C♯".

## 6. Samenhang met tempo en transponeren

De kaart staat in TRACKTIJD en is van de PLAAT, zoals `grid.bpm`. Wat je
hoort is afgeleid, zoals `deck.bpm` (= grid × rate):

```
halve tonen erbij = transpositie + (keylock ? 0 : 12 · log2(rate)) + stemming/100
hoorbare toonsoort = plaat + round(halve tonen erbij)
afwijking (cent)   = 100 · (halve tonen erbij − round(halve tonen erbij))
Camelot            = +7 per halve toon (mod 12), letter blijft
```

- Zonder keylock: +5,95% = een halve toon = zeven uren op de wijzer
  (ROADMAP). Het pitchbereik ±8% is −1,4 tot +1,3 halve toon, ±16% −3,0 tot
  +2,6, sync (0,5–2×) een octaaf naar elke kant. Voorbeeld: Ciel (D, 10B) op
  +6% klinkt als Es +1 ct (5B).
- Met de stemming erbij klopt het ook voor platen die niet op 440 staan:
  Radiohead's No Surprises staat ~34 cent laag; op +2% (= +34 cent) klinkt
  hij als F op 0 cent.
- Met keylock blijft de toon staan; alleen `transpositie` (halve tonen, mag
  een breuk zijn) telt.
- `bend` (nudge, ±4% zolang je drukt) telt NIET mee in de weergave: die mag
  niet flikkeren.

**In de engine** (regel 1: de engine kent geen library): een puur
`src/engine/toonsoort.js`, zoals `beatgrid.js`: een `ToonKaart` met
`stukAt(positie)`, `toJSON()`, bewerken per stuk (`zetStuk`, `splits`), en
`hoorbaar(stuk, { rate, transpositie, keylock })` → `{ toonsoort, camelot,
cent }`. Het deck krijgt `toonKaart` van de app (zoals het grid, uit
`laden.js`) en een getter `toonsoort` op `deck.position` (regel 3: de positie
komt al van de audioklok).

**Afspraak met de keylock-agent:** dit ontwerp gaat uit van twee eigenschappen
op het deck: `keylock` (boolean) en `transpositie` (halve tonen). Heten ze
anders, dan verandert alleen de regel hierboven. Tot keylock er is: `keylock =
false`, `transpositie = 0`, en klopt de formule al voor de pitchfader.

## 7. Met de hand

Een automatische toonsoort is een voorstel; met de hand is bevestigd (`bron:
'hand'`, `slot: true`, nooit meer overschreven), zoals een tap van ≥ 4 tikken
het grid op slot zet. Elk slot is ook een meetpunt: `meet.mjs` kan ze later
als grondwaarheid lezen en de drempels herijken.

**Library:** klik op de toon-badge → een kiezer met de 24 toonsoorten in
wijzervolgorde (1A 1B 2A …), "geen toonsoort" en "bevestigen" (slot zonder te
veranderen). Bij een nummer van één stuk geldt het voor het hele nummer; bij
een album vervangt het de kaart door één stuk, met een tweede klik (zoals
laden over een spelende track).

**Per stuk, op de positie** (de track met focus), eerst `define()` in
`src/control/actions.js`:

| Action | Type | Wat |
|---|---|---|
| `track.N.key.fifth.up` / `.fifth.down` | trigger | stuk hier één stap op de wijzer (kwint): de meest gemaakte fout |
| `track.N.key.mode` | trigger | majeur ↔ mineur met hetzelfde getal (relatief) |
| `track.N.key.semitone.up` / `.semitone.down` | trigger | een halve toon (fout rond ±50 cent) |
| `track.N.key` | value 0..1 | 24 standen in wijzervolgorde, voor een encoder; `read` = huidige / 23 |
| `track.N.key.none` | trigger | "geen toonsoort" hier |
| `track.N.key.split` | trigger | nieuw stuk hier |
| `track.N.key.lock` | trigger | bevestigen (slot aan/uit); `read` = slot |

Elke action krijgt een uitleg in `apc-beschrijf.js`. Bewaren zoals het grid:
`laden.js` post elke 1,5 s wat veranderde naar `POST /api/library/<id>/toon`;
`POST /api/library/<id>/toon/analyseer` voor ↻.

**APC:** in versie 1 geen standaardknoppen (beslissing T6). Toonsoort
corrigeer je niet midden in een set, en de acties zijn er om later te koppelen.

## 8. Harmonisch mixen (optie, niet bouwen)

Wat het zou zijn: bij elke track een stip in de kolomkop als hij past bij de
track die je het hardst hoort (hetzelfde begrip als de maatgever van sync):
zelfde getal, ±1, of de relatieve = past; de rest niet. Met de afwijking in
cent erbij, want twee keer "8B" op 40 cent van elkaar zweeft.

Advies: nog niet bouwen. Eerst een paar weken alleen de toonsoort zien; dan
weet Clay of hij het wil, en of het oplichten (kolomkop, Track Select-LED) hem
helpt of afleidt. Het rekenwerk is klein (0,5 sessie) zodra de toonsoort er is.

## 9. Beslissingen voor Clay

Eén voor één, elk met een advies.

**T1. Welk profiel?**
(a) Temperley 2005: 8/10, kaart 81%. (b) edma, het ROADMAP-voorstel: 5/10,
50%. (c) het gemiddelde van beide: 7/10, 67%.
*Advies: (a).* Aanname: de 10 stukken zijn allemaal Sakamoto; voor
elektronische nummers kan edma het beter doen. Na twintig nummers op slot
opnieuw meten.

**T2. Welke notatie op het scherm?**
(a) Camelot + korte naam: `9B G`, `3A B♭m`. (b) Camelot + Nederlandse naam:
`9B G majeur`, `3A Bes mineur`. (c) alleen Camelot. (d) Open Key (Traktor: `2d`).
*Advies: (a)* in library en kolomkop, de volle Nederlandse naam in het
focusdeel en de tooltip.

**T3. Wat tonen kolomkop en focusdeel: wat je hoort of wat op de plaat staat?**
(a) wat je hoort (met pitch en transpositie), de plaat in de tooltip. (b) de
plaat, de verschuiving ernaast.
*Advies: (a)*, net als de BPM ("bpm die je hoort (grid × pitch)"). De library
toont altijd de plaat.

**T4. Hoe ziet onzeker eruit?**
(a) gedimd met "?" (0,15–0,40), `~` onder 0,15, tweede kandidaat in de
tooltip. (b) twee kandidaten naast elkaar (`8B/9B`). (c) niets tonen onder de
drempel.
*Advies: (a).* Hetzelfde patroon als de BPM, en `~` zegt "vrij" in plaats van
"fout" voor ambient.

**T5. De stemming in cent tonen?**
(a) vanaf 20 cent afwijking. (b) altijd. (c) nooit.
*Advies: (a).* ADRIANA (−45 … +25) en zoned out (+43) laten zien dat het bij
Clay's repertoire vaak voorkomt.

**T6. Corrigeren op de APC?**
(a) niet in versie 1: library en scherm. (b) een toonsoortmodus in het
edit-mapje (Shift + Metronome), bijvoorbeeld scene 1/2 = kwint ±, 3 = relatief,
4/5 = halve toon ±, Lock = bevestigen.
*Advies: (a).* Corrigeren is zeldzaam en niet live; de actions bestaan, dus
koppelen kan later zonder code.

**T7. Harmonisch mixen (Camelot-buren oplichten)?**
(a) later, als optie die standaard uit staat. (b) nu meebouwen. (c) nooit.
*Advies: (a)*, zie §8.

## 10. Risico's

- **Dunne grondwaarheid.** 10 stukken, één componist, vooral piano, en 7 van de
  10 alleen via Spotify's algoritme. De profielkeuze kan op elektronische
  nummers anders uitvallen. Tegenmaatregel: elk slot wordt een meetpunt;
  `meet.mjs` opnieuw draaien na twintig.
- **Drempels op ~15 stukken.** Geen natuurlijk gat zoals bij het grid. Voorlopig
  0,40/0,15, en een onzekere toonsoort wordt nooit verborgen, alleen gedimd.
- **De kwint blijft de meest gemaakte fout.** Daarom één druk (`key.fifth.up/down`)
  en de tweede kandidaat in de tooltip.
- **Majeur/mineur bij pop-progressies** (Am F C G) is een muntworp. Voor mixen
  onschadelijk (zelfde getal), voor de naam niet.
- **Rekentijd wisselt** met de drukte (0,10–0,45 s per minuut). In een worker,
  op de achtergrond, één tegelijk: de decks merken niets (dezelfde les als bij
  het grid).
- **Afhankelijk van de keylock-agent** voor `keylock` en `transpositie`. Zonder
  die twee klopt alles al voor de pitchfader.
- **Eigen sets** krijgen de toonsoort die toen klonk, inclusief pitch. Klopt,
  maar kan verwarren: de library zegt dan iets anders dan de bronnummers.

## 11. Schatting

| Stap | Sessies |
|---|---|
| Server: `server/toon.js` uit het instrument, worker-taak, ingest-stap, schema v6 en de library-functies, routes, achtergrond, tests (toon.test met het synthetische materiaal, library.test, server.test) | 1 |
| Engine en actions: `src/engine/toonsoort.js`, deck-getter met de formule uit §6, `track.N.key.*`, apc-beschrijf, bewaren in `laden.js`, tests | 0,5–1 |
| Weergave: library-kolom en kiezer, kolomkop, focusdeel, tooltips | 1 |
| Aansluiten op keylock/transpositie als die er is | 0,25 |
| (optie) harmonisch mixen | 0,5 |

Totaal 2,5–3 sessies zonder de optie. Kan vóór keylock: de formule werkt met
`keylock = false`.

## 12. Wat aangenomen is

- Spotify-waarden (songbpm.com) als grondwaarheid voor 7 van de 10 stukken; welke
  opname Clay heeft is uit de duur afgeleid.
- Het slot van Aqua (As) en Bolerish (C) zijn vastgesteld met onze eigen chroma
  en een transcriptie van derden; niet met de officiële bladmuziek.
- Dat zoned out zichzelf na 25:30 herhaalt, volgt uit twee identieke kaarten,
  niet uit een vergelijking van de audio.
- De tracklist van de Sakamoto-playlist komt uit het videobeeld; de grenzen uit
  de stiltes, gecontroleerd op twee frames.
- De cover van No Surprises: de gevonden D/B m is niet te controleren.
- Rekentijden op deze M1, en wisselend met wat er verder draaide.
