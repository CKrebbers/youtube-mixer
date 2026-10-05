# Stems: zang en rest (of vier) per nummer

**Gebouwd 3 okt 2026** (ROADMAP 17), in drie parallelle sporen (server, engine,
ui) op een gedeeld contract, daarna samengevoegd (`stems/integratie`). Besluiten
in VRAGEN H1–H3 en blok N. Details per spoor: `docs/verslagen/2026-10-03/`
(server.md, engine.md, ui.md). De proef van 24 sep: `tools/stems/meet.py` en
`docs/HANDOFF.md` ("Stems splitsen — proef").

## Wat Clay besliste

- H1: de stems klinken goed genoeg om live mee te spelen.
- H2: **kiesbaar per nummer**. Standaard twee (zang, rest); vier als je dat bij
  het binnenhalen vraagt.
- Advies van 24 sep, overgenomen: splitsen bij de ingest (vooraf rekenen, live
  bedienen, zoals Serato/rekordbox/djay), de stem-fader VÓÓR de EQ. Geen
  realtime splitsen in de browser.
- 3 okt: "bouw met meerdere subagenten tegelijk aan de stem splitter" (eerder
  dan "na 25 okt").
- H3 (splitsen op de Omarchy-machine) blijft open. De splitter kent
  `--apparaat cuda`, maar er is geen netwerkdienst.

## Gebruiken

- **Binnenhalen**: in het library-paneel staat naast de invoer `stems 2 · 4 · geen`
  (onthouden, standaard 2). Na een geslaagde ingest gaat het nummer vanzelf de
  stems-rij in; de ingest wacht daar niet op.
- **Bestaande nummers**: library-kolom `stems`: `—` met knoppen **2 · 4**, `wacht`,
  `42%` met **×**, `2`/`4` als ze er zijn (bij 2 een knop **4**: opnieuw in vier),
  `fout` met de reden in de tooltip.
- **Spelen**: een nummer met stems laadt `stems.wav` in plaats van `audio.wav`.
  Kolomkop **S2/S4** = speelt met stems; gestippeld = klaar, herlaad het nummer om
  ze te horen (een spelend deck wisselt nooit vanzelf); **S!** = laden mislukt,
  je hoort audio.wav.
- **De STEMS-rij** (knop `stems` in de balk, standaard dicht) voor de track met
  focus: per stem een niveauschuif (dubbelklik = vol) en **kill** (klik =
  aan/uit, shift + vasthouden = weg zolang je drukt). Twee: zang · rest. Vier:
  drums · bas · overig · zang, en **rest** als groepsknop (drums + bas + overig).
  Sinds 5 okt per stem ook een **filter**, **echo**, **galm** en **cue** (§5).
- **Koppelen**: alle stem-actions staan op de bus (zie Actions). Op de APC sinds
  5 okt de grid-modus **stems** (Shift + scene 3, of ▲ ▼; §5); koppelen werkt ook.
- **Controlekamer**: tegel Stems (wat loopt, wat wacht, of de splitter er is).

## Model en meting

Demucs `htdemucs` (4.1.0, MIT). Het model levert altijd vier bronnen (drums,
bass, other, vocals) op 44,1 kHz; twee stems = vocals + de rest, even veel
rekenwerk, de helft van de opslag.

Gemeten op de M1 (MPS, `docs/verslagen/2026-10-03/server.md`): **2,6–3,2×
realtime** op een rustige machine (79 s en 214 s), 1–1,8× als de GPU gedeeld wordt
met WebGL van een ander proces. Geheugen **~1 GB RSS, hoe lang het nummer ook is**
(in stukken; zonder stukken 640 s al 3,5 GB / 8 GB footprint). Opslag: 2 stems ≈
22 MB per minuut, 4 stems ≈ 44 MB per minuut, naast audio.wav. Tijdelijk tijdens
het splitsen: float32 = 2× de uiteindelijke stems.wav.

Python: een venv BUITEN de repo, `~/.varve/stems-venv` (met
`--system-site-packages`, torch 2.9.1 staat systeembreed). Het model staat in
`~/.cache/huggingface/hub/models--adefossez--HTDemucs` (84 MB; demucs 4.1 haalt
het van Hugging Face, de eerste split op een nieuwe machine heeft internet nodig).
Opnieuw opzetten:

```
python3 -m venv --system-site-packages ~/.varve/stems-venv
~/.varve/stems-venv/bin/pip install demucs
```

## 1. Bestandsformaat (de naad tussen server en engine)

Naast `audio.wav` in `media/<id>/`:

**`stems.wav`**: RIFF/WAVE, PCM 16-bit, 48 000 Hz, INTERLEAVED, `kanalen = 2 ×
aantal stems` (4 of 8). Kanaalpaar k (kanalen 2k, 2k+1) is stem k in de volgorde
van `stems.json.namen`. Precies evenveel frames als `audio.wav`. Hooguit 4 GB
data (geen RF64): 4 stems tot ~3,1 uur, 2 stems tot ~6,2 uur; daarboven weigert
de splitter met een reden.

**`stems.json`**: `{ versie: 1, model, aantal, namen, schaal, frames, sr,
apparaat, rekentijd_s, gemaakt }`.

- `namen`: twee = `["vocals", "inst"]`; vier = `["drums", "bass", "other", "vocals"]`.
- **De som van de stems is audio.wav** (op 16-bit afronding na, −111 dB): wat het
  model nergens onderbrengt gaat naar `inst` (twee) of `other` (vier). Zonder dat
  klonk "alles open" net anders dan het nummer (Demucs telt op Clay's muziek op tot
  −25 dB (ambient) à −38 dB). Prijs: wat het model miste, ook een beetje zang, zit
  in de rest en blijft hoorbaar als de zang uit staat, zoals bij "instrumentaal =
  mix − zang" in karaoke-tools. Terugdraaien is één regel in splits.py (VRAGEN N2).
- `schaal` (0 < schaal ≤ 1): alle stems met dezelfde factor, zodat geen stem clipt
  in 16 bit; de engine zet `1 / schaal` erbovenop. In alle metingen 1,0000.

`audio.wav` blijft de bron van golfvorm, beatgrid, toonsoort en onsets. Alleen
het AFSPELEN gaat via `stems.wav`.

## 2. Server

### De splitter: `server/stems/splits.py`

```
<python> server/stems/splits.py --in <audio.wav> --uit <map> --aantal 2|4
         [--apparaat auto|mps|cuda|cpu] [--model htdemucs]
         [--controle] [--threads N] [--stuk-s S]
```

- **In stukken** van 46,8 s (8 strides van htdemucs) met 4 s overlap: 1 s context
  aan weerskanten en een lineaire kruisfade van 2 s (de twee stukken schatten
  hetzelfde signaal, dan telt lineair op tot 1). Aan de grenzen is niets te meten:
  het verschil met de versie zonder stukken is daar even groot als midden in een
  stuk (`tools/stems/vergelijk.py`).
- 48 → 44,1 → 48 kHz met `torchaudio.functional.resample` (niet torchaudio.load/save:
  die vragen in 2.9 torchcodec); elk stuk begint op een veelvoud van 160 frames, dan
  ligt het rooster gelijk met dat van het hele nummer. Normaliseren zoals
  `demucs.separate`, maar met de cijfers van het HELE nummer.
- Twee passen: float32 naar `<map>/.stems-tmp.f32` met de grootste piek, dan één
  keer naar 16 bit met de exacte `schaal`. `stems.wav` en `stems.json` onder een
  tijdelijke naam en dan `os.replace`: wie stems.json ziet, ziet een complete set.
- Stdout `voortgang x` (hooguit 2× per seconde), als laatste `klaar`; stderr:
  laatste regel = de reden, `info:`-regels zijn meetwaarden. Exit 0 / 1 / 130.
  SIGINT én SIGTERM = netjes stoppen (gemeten: weg na 1,1 s).
- `--controle`: importeert torch/torchaudio/demucs en geeft JSON (laadt het model
  niet). `--threads` standaard de helft van de kernen, hooguit 4.

### De wachtrij: `server/stems.js`

- **`Splitter`**: welk commando. `VARVE_STEMS_CMD` (één uitvoerbaar bestand, krijgt
  dezelfde argumenten; de tests: het startscript van `maakNepStems`), anders
  `VARVE_STEMS_PY` + splits.py, anders `~/.varve/stems-venv/bin/python`. **Een
  testserver (`VARVE_MEDIA` gezet) zonder een van beide splitst niet**, met die
  reden: anders zette elke test die iets binnenhaalt (2 is de standaard) de echte
  Demucs aan. `controleer()` één keer, na 30 s opnieuw als het niet klaar was.
  Draait via `run()` uit ingest.js (SIGINT → 3 s → SIGKILL voor de procesfamilie)
  met `nice -n 10` ervoor; time-out `max(30 min, 10 min + 4 × duur)`.
- **`StemsRij`**: één tegelijk, zoals `wachtrij.js`. Opdracht
  `{ id, track, titel, aantal, status, voortgang, fout, toegevoegd, begon, klaar, plek, stoppen?, opnieuw?, stems? }`,
  status `wacht|bezig|klaar|fout|geannuleerd`. Overleeft geen herstart (zoals de
  ingest-rij); de ui ziet een andere `server`-id.
- **`maakStems`**: werkmap `media/.bezig-stems-<id>-<hex>`, splitsen, nalopen
  (kanalen, 16-bit, 48 kHz, frames = audio.wav), dan pas naar `media/<id>/` en
  `lib.bewaarStems`. Is audio.wav intussen vervangen of het nummer weg: de set
  gaat weg met die reden.
- Afsluiten (SIGTERM/SIGINT) met een lopende split: eerst de split stoppen
  (hooguit 5 s), anders rekende Demucs als wees door.

### Database

Schema **v8**: `tracks.stems_json` (stems.json plus `bestand`). Elke rij krijgt
`stems: null | { aantal, namen, schaal, bestand }`. Gewist (met de bestanden) als
audio.wav opnieuw binnengehaald wordt; een split van de oude audio die nog loopt
wordt geannuleerd.

### Routes

- `GET /api/stems` → `{ opdrachten, server, beschikbaar, reden? }`.
- `POST /api/stems { track, aantal: 2|4, opnieuw? }` → 202 `{ opdracht }`; 400 (ander
  aantal), 404 (onbekend of geen audio), 503 `{ fout, reden }` (geen splitter);
  200 `{ opdracht, dubbel: true }` als het nummer al in de rij staat; 200
  `{ al: true, stems }` als het die stems al heeft.
- `DELETE /api/stems/<opdracht-id>` → annuleren of wegklikken.
- Witte lijst: `/media/<id>/stems.wav` (Range). `stems.json` en `.bezig-*` niet.
- `POST /api/ingest { url | urls, stems?: 0|2|4 }` (standaard 2) en
  `/api/upload?…&stems=0|2|4`. Een nummer dat al in de library stond wordt na een
  ingest niet gesplitst (een lijst opnieuw plakken zou anders de hele library door
  Demucs halen). Is de splitter er niet: een opdracht met `fout` en de reden.
- `DELETE /api/library/<id>` annuleert een open split. `/api/tooling` meldt de splitter.

## 3. Engine

Regel 1: `src/engine/` weet niets van de server of de library; het krijgt een
url en `{ namen, schaal }`.

- **Streamkern**: een bestand mag 2, 4 of 8 kanalen hebben (`controleerWav`).
  `renderBlok` leest één STEREOPAAR per aanroep (`stride`, `paar`, op `klad` als
  hele getallen). Voor stereo bit voor bit als vroeger (gouden hash `9dfaeb73`,
  bench `a6c215d9`). `hergebruik`: paar 1–3 nemen van paar 0 over wat niet van het
  paar afhangt (posities, soort, naad, en de gat-envelop als het paar met dezelfde
  stand begon); alleen de worklet zet die vlag.
- **Worklet**: ALTIJD vier uitgangen van twee kanalen, ook voor stereo (de node
  hoeft nooit opnieuw gebouwd te worden). Ongebruikte uitgangen elk blok op nul
  (Chrome belooft dat niet hard, en vuilnis van een vorig nummer hoor je). 'einde'
  van paar 0.
- **StreamBron**: uitgang k → `stemIn[k]` (of alles naar één node = de som); bytes
  per frame uit de kop; `laad({ …, kanalen })` weigert een ander aantal vóór er
  iets verandert; `knip(van, tot, gewichten)` voor de sampler (wat je hoort vóór
  de EQ: een pad die je knipt terwijl de zang weg is, klinkt zonder zang).
  **Vervangen onder het spelen**: de totale grootte uit `Content-Range` wordt bij
  de laad onthouden; verandert die (opnieuw gesplitst 2 → 4, opnieuw
  binnengehaald), dan haalt hij niets meer op en meldt het één keer. Wat er al
  was speelt uit, daarna stilte, nooit ruis.
- **Deck**: `createDeckChain` geeft `stemIn: [g0…g3]` naar `trim` (vóór de EQ).
  `deck.laadStream(url, titel, { stems: { namen, schaal } })`, `deck.stems`.
  Versterking van uitgang k (stem n):
  `(1 / schaal) × niveau(n) × kill(n) × (vier en n ≠ vocals ? niveau(inst) × kill(inst) : 1)`.
  Kill = 0 (niet −70 dB), klikvrij in 5 ms als een zachte S in AMPLITUDE na
  `startDrempel` (`killVersterking` in audio-graph.js, via `zetHellingen`). Niveau:
  vasthouden + setTargetAtTime. Zonder stems: alles 1, uitgang 0 draagt de mix.
  **Bij elke laad alles open** (stems horen bij het NUMMER, niet bij het kanaal;
  afwijkend van de EQ-knoppen). `snapshot().decks[X].stems`.

### Actions

Voor elke track N en `s` uit `vocals, inst, drums, bass, other`:

| action | type | wat | read |
|---|---|---|---|
| `track.N.stem.<s>` | value | niveau 0..1 | het niveau, of `null` zonder stems of als de stem in deze stand niet bestaat |
| `track.N.stem.<s>.kill` | trigger | kill aan/uit | 1 = weg, 0 = open, `null` = n.v.t. |
| `track.N.stem.<s>.hold` | trigger | weg zolang je drukt | idem |

Labels (`STEM_LABELS`): zang, rest, drums, bas, overig. Uitleg in
`apc-beschrijf.js`. Auto-DJ: in `OVERNEEM`. Handelingenlog: de kill-schakelaars
staan in de beginstand (`stemKill`, alleen met stems), terugspelen zet ze na het
laden; `track.N.stem.*` hoort bij het nummer (`NUMMER_NODIG`).

## 4. Ui

- `laden.js`: met `track.stems` → `stems.bestand` met `{ stems }`; mislukt dat →
  `audio.wav` met een melding. `staat.deckStems[id] = { aantal, mislukt } | null`.
  Hoeveel stems er ECHT spelen komt van de bus (`aantalOpBus`).
- `stems-paneel.js` (de rij), `stems-wachtrij.js` (één `StemsWachtrij`, peilt
  `GET /api/stems` elke 1,5 s zolang er iets open staat of iemand kijkt),
  `stems-weergave.js` (puur: namen, cel, rijstand, kolomteken, tegel).
- De rij staat onder de mixer zoals AUTO en KLANKSCHAAL, één regel van 40 px; op
  1440×790 houden de kolommen faders van 124 px. Meldingen staan boven een open
  rij onderaan (gold ook al voor auto en klankschaal).
- Opnieuw splitsen wordt geweigerd zolang een track het nummer MET stems speelt
  (het vervangt het bestand waar hij uit leest). De StreamBron vangt het ook af
  als het toch gebeurt (zie Engine).

## 5. Stemkanalen: filter, sends en cue per stem (gebouwd 5 okt)

Clay (STUDIO, 5 okt): *"effecten toepassen op het geheel maar ook op aparte stems"*,
en alles voorbeluisteren. ROADMAP 27 / `docs/STUDIO.md` S2, spoor **S2b**. Per stem,
naast niveau en kill: een **filter**, een **echo** en een **galm** (sends naar de
gedeelde bussen) en een **cue** (de koptelefoon, `docs/STUDIO.md` §3). De meting:
`node tools/headless/stemkanalen.mjs [--vergelijk <revisie>] [--cpu]`.

### Gebruiken

- **Rij**: per stem na kill drie kleine draaiknoppen en een knop **cue**. De kleur van
  de wijzer zegt welke: geel = filter (midden = open, links lowpass, rechts
  highpass; dubbelklik = open), cyaan = echo, violet = galm (dubbelklik = dicht).
  Cue rood = die stem in de koptelefoon; dof = geen koptelefoonuitgang. Met twee
  stems (of vanaf 1700 px breed) staat er een legenda naast "track N"; met vier op
  1440 px alleen de tooltips. Past op 1440×900 en 1440×790 (gemeten, faders 200 en
  124 px, zoals vóór de stemkanalen).
- **APC: grid-modus stems** (VRAGEN N1, het advies van daar): **Shift + scene 3**
  (scene 3 zelf blijft sampler; in de modus brandt scene 3 fel zeegroen) of ▲ ▼
  (achteraan, na auto). Per kolom = track, van boven naar onder: **zang · rest ·
  drums · bas · overig**, weg zolang je drukt, **shift + pad** = vastzetten (zoals de
  kill in klank). Lampjes: fel rood = weg, donkerrood = open, uit = die stem heeft
  de track niet (rij 3–5 bij twee stems). Filter, sends en cue per stem staan niet
  op de APC (geen ruimte zonder bestaande regels te veranderen); koppelen werkt.

### Actions

Voor elke track N en `s` uit `vocals, inst, drums, bass, other`:

| action | type | wat | read |
|---|---|---|---|
| `track.N.stem.<s>.filter` | value, bipolair | filter 0..1, 0,5 = open | de stand, `null` zonder die stem |
| `track.N.stem.<s>.send.a` | value | echo 0..1 (kwadratisch, zoals de track-send) | idem |
| `track.N.stem.<s>.send.b` | value | galm 0..1 | idem |
| `track.N.stem.<s>.pfl` | trigger | die stem in de koptelefoon aan/uit | 1/0, `null` zonder die stem of zonder koptelefoonuitgang |

Uitleg in `apc-beschrijf.js`. **Auto-DJ**: filter en sends staan in `OVERNEEM`
(een stem filteren of insturen in een overgang = jij neemt hem over), de cue niet.
**Handelingenlog**: filter en sends zijn value-actions, dus vanzelf in de beginstand
(alleen voor stems die er zijn); de cue niet (een trigger). **Terugspelen** slaat
`track.N.stem.<s>.pfl` over (`OVERSLAAN`, zoals `track.N.pfl`: de zaal hoort hem
niet); de rest hoort bij het nummer (`NUMMER_NODIG`).

### De groepsknop `inst` bij vier stems

Bij twee stems is `inst` een gewone stem (uitgang 1). Bij vier werkt hij op drums,
bas en overig samen, zoals niveau en kill al deden:

| | eigen knop en groepsknop samen | waarom |
|---|---|---|
| niveau, kill | vermenigvuldigen (bestond) | de klank van de stem |
| filter | in serie: per kant het sterkste (hoogste highpass, laagste lowpass; tegenover elkaar een band) | één filter op de groep = hetzelfde filter op elk lid (lineair), met één paar filters per stem |
| sends | de grootste van de twee | twee keer dezelfde stem insturen mag niet dubbel klinken |
| cue | aan als eigen OF groep aan staat | één keer in de koptelefoon, niet twee keer |

### Hoe het klinkt en waarom zo

**De droge weg blijft wat hij was.** `stemIn[k] -> trim` is niet veranderd. Het
filter is een correctie ernaast (`maakStemFilter` in audio-graph.js):

```
stemIn[k] ---------------------------------------------> trim   x
       |-> filterIn (g) -> highpass -> lowpass ---------> trim   H(g·x)
       `-> tegen (−g) ------------------------------------> trim   −g·x
```

Samen `x + H(g·x) − g·x`: met g = 0 precies x, met g = 1 de gefilterde stem; van 0
naar 1 in 5 ms (`killVersterking`, zachte S na startDrempel, nooit een curve) is een
kruisfade droog ↔ gefilterd. Terug in het midden pas na `STEM_FILTER_TERUG` (50 ms,
5 × de τ van het filter), zodat het filter eerst weer open staat; wie binnen die
50 ms weer draait, blijft gewoon in het filter. "Midden" is 0,5 ± 0,004 (63 en 64
van 127: een MIDI-knop landt nooit precies op 0,5). Formules: `filterDoelen`, zoals
het trackfilter.

**Elk deel komt er pas bij als het iets moet doen, stil.** Het filter van een stem
als zijn filter voor het eerst uit het midden gaat, een send als hij voor het eerst
open gaat, een cue als hij voor het eerst aan gaat: versterking 0, en dan een
overgang. Precies zoals een nieuwe keten in de insert-slot (`zetRack`): er komt
alleen iets BIJ dat stil begint, er gaat nooit iets los (geen `disconnect()`, dat
klikt). Een deck zonder stems, of met stems en alles open, heeft er geen enkele node
van: bit voor bit het oude pad, en dezelfde CPU (gemeten, zie onder). Eerst bestonden
alle delen altijd: dat kostte stil al +50% CPU voor de hele graaf (acht tracks).

**Stem-sends en de fader.** Een track-send zit NA de fader (echo-out: fader dicht =
niets meer insturen, de staart sterft uit). Een stem heeft geen eigen fader, dus de
stem-sends van een track gaan samen door een **spiegel van de fader**: per bus één
versterking (`deck.stemSends[A|B].fader`) die in dezelfde codepaden dezelfde
automatisering krijgt als `chain.fader.gain`: `applyUi` (set), `_glijParams` en
`_glijDoelen` (`Deck.glide`, de auto-DJ, ook opnieuw richten en ingrijpen). Gemeten
in de test: de spiegel volgt de fader sample voor sample (verschil 0), ook midden in
een glijbeurt. De spiegels bestaan altijd (twee stille versterkingen per deck): zo
volgen ze de fader vanaf het begin, ook als een stem-send pas later open gaat.
Overwogen en niet gekozen: één ConstantSource die fader én spiegels stuurt (dan
verandert het oude pad, en de tests die de fader-tijdlijn meten), of de stem-sends
door de fader zelf (meer kanalen door de strip: verandert EQ en filter mee).
**Trim** zit in de versterking per stem (send = knop² × trim; trim glijdt niet).
Een stem-send gaat NIET door EQ, insert-effect en trackfilter: die horen bij de som.
Vóór de crossfader, zoals de track-send.

**De cue.** Per stem een versterking (0, of trim als hij aan staat), samen in één
ingang per track in de koptelefoon: `koptelefoon.voegToe('A:stems', …)`, die aan staat
zolang er van die track een stem in de koptelefoon staat (de engine volgt
`deck.stemPflIets` op 'change'). Niet één ingang per stemnaam (`A:vocals`, …): welke
uitgang welke stem is hangt van het bestand af (`namen`), en de groep `inst` is drie
uitgangen; met één ingang per track blijft `koptelefoon.js` onveranderd en werkt "of"
voor de groep vanzelf. Tapt na het stemfilter en vóór de fader (de koptelefoon hoort
een stem ook met de fader dicht), na trim zoals de cue van de track; niet door EQ,
effect en trackfilter. `snapshot().koptelefoon.pfl` noemt nu ook `A:stems` … `H:stems`.

**Bij het nummer.** Filter, sends en cue van de stems gaan bij elke laad terug naar
open (zoals niveau en kill, `_zetStems`); de nodes blijven.

### Gemeten (headless, 5 okt)

`tools/headless/stemkanalen.mjs`: de echte engine op een OfflineAudioContext, een
stems.wav met een toon per stem (drums 2000 Hz, bas 2700, overig 3600, zang 5100,
elk 0,2) via laadStream en de echte worklet. Amplitude per toon over de tweede seconde:

| | |
|---|---|
| alles open | elke stem −25,1 dB in de zaal |
| filter drums dicht (lowpass 250 Hz) | drums −36 dB zachter; bas, overig, zang op 0,01 dB gelijk |
| filter zang helemaal rechts (highpass 9 kHz) | zang −9 dB; de rest gelijk |
| filter van de groep dicht | drums −36, bas −41, overig −47 dB; zang gelijk |
| echo van de zang | aan de ingang van de echobus alleen de zang (−14,0 dB = 0,2), de rest onder −110 dB; niets op de galmbus |
| … en de trackfader dicht | −84 dB (−70 dB: de spiegel); ook als de fader in 0,5 s dicht GLIJDT (de auto-DJ) |
| echo van de groep | drums, bas, overig op de bus, zang −124 dB |
| cue op de zang (vier kanalen) | op 3/4 alleen de zang (−23 dB), de rest onder −120 dB; de zaal (1/2) precies als zonder cue |
| cue op de groep, drums gefilterd | op 3/4 bas en overig, drums −59 dB (na hun filter), zang −133 dB |

**Bit voor bit** (`--vergelijk 481f17a`: dezelfde scène op de oude code en op deze,
eerst de oude server, dan deze, op dezelfde poort): een track zonder stems (zaal en
cue, vier kanalen), een track met vier stems alles open (zaal en cue), en de ingang
van echo- en galmbus: dezelfde hash. Twee valkuilen van Chrome die de scène daarvoor
vermijdt (gemeten: anders verschilt de oude code al van zichzelf): een ingang met
twee of meer klinkende verbindingen telt in een willekeurige volgorde op (1 ULP), en
de natte kant van een insert op mix 0 is cos(π/2) = 6e-17 met een delay die op
timers herankert. De gouden hash en 0 GC van het audiopad (`renderblok.test`) zijn
niet geraakt: de worklet en de streamkern zijn niet veranderd.

**CPU** (`--cpu --vergelijk 481f17a`: offline, één thread, CPU-tijd van het
renderproces, oud en nu om en om op dezelfde pagina, mediaan van vijf; acht tracks
× vier stems; de machine had belasting 15–25 van andere agenten, dus ±10%):

| | ms CPU per s audio |
|---|---|
| niets speelt: oud / nu | 132 / 129 |
| alle stems spelen, stemkanalen open: oud / nu | 164 / 170 |
| alle 32 stemfilters aan | 246 (≈ 2,5 ms per filter) |
| alle 64 stem-sends open | 171 (bijna niets) |
| een insert-slot per stem (delay, mix 0) | 345 (≈ 5,5 ms per slot) |

**Een insert-effect per stem: NIET gebouwd.** Een insert-slot kost ook als hij niets
doet ~5,5 ms per s audio per stem (32 slots: +110%), en vraagt per stem een rack,
knoppen, actions en een plek op het scherm. Als Clay het wil: alleen op aanvraag
maken (zoals hier filter en sends), en de keuze welk effect bij de stem bewaren.

### Grenzen (niet als bug melden)

- Stem-sends en stem-cue gaan niet door EQ, insert-effect en trackfilter van de
  track; een stem-echo blijft dus helder als je het trackfilter dichtdraait.
- De sampler knipt met niveau en kill per stem (`knipGewichten`), niet met het
  stemfilter.
- Een deel van een stemkanaal blijft bestaan als het ooit gebruikt is (er gaat niets
  los): na een avond met overal filters kost dat de CPU van de filters die er zijn,
  ook in het midden (dan stil, en Chrome rekent stille filters niet).
- Niet gehoord: het filter op echte stems (klinkt een snelle draai door het midden
  goed, met de overgang van 5 ms en het terugkeren na 50 ms?), echo en galm per stem
  in een set, de cue per stem op het samengestelde apparaat, en de grid-modus stems
  op de APC (zeegroen naast de andere kleuren, Shift + scene 3).

## Tests en meten

- `test/stems.test.mjs` (wachtrij, routes, ingest-koppeling, schema, annuleren,
  herstart; met `VARVE_STEMS_ECHT=1` ook de echte Demucs), `test/nep-stems.mjs`
  (stem k = audio × gewicht: twee 0,75/0,25, vier 0,1/0,2/0,3/0,4; som bit voor bit
  audio.wav), streamkern 4/8 kanalen in `stream.test`, stems-variant in
  `renderblok.test` (0 GC, uitgang 0 = gouden hash), `engine.test`, `auto.test`,
  `handelingenlog.test`, `library.test`, `library-lijst.test`, `spiegel.test`,
  `controle.test`. `node test/alles.mjs`: 41 bestanden, alles groen.
- Stemkanalen (§5): `test/engine.test.mjs` (blok "stemkanalen", 51 checks: bedrading
  op aanvraag, filter/sends/cue per stem, de groep, de spiegel tijdens het glijden,
  klikvrij), `mapping.test`, `spiegel.test`, `feedback.test` (modus stems), `auto.test`
  (OVERNEEM), `handelingenlog.test` (beginstand); `tools/headless/stemkanalen.mjs`.
- `node tools/headless/stems.mjs`: van binnenhalen tot kill, gemeten aan de master
  (zang weg 0,250 · alles weg 0 · terug 1,000; vier: drums weg 0,90 · rest weg 0,40),
  layout op 1440×790 en 1920×1080, de Controlekamer. `--nep` = alleen de ui.
- CPU (bench, 8 decks, M1): stereo 19,7 ms per s audio (2,0% van een kern), 2 stems
  34,6 (3,5%), 4 stems 63,9 (6,4%); 0 GC. Geheugen per deck ×2 / ×4 (een typisch
  pagina-plan: 9,2 / 18,4 / 36,7 MB).

## Grenzen (niet als bug melden)

- De GPU kent geen `nice`: splitsen tijdens een set met veel video deelt de GPU met
  WebGL (Demucs zakt dan naar 1–1,8×; of beelden haperen is niet gemeten). VRAGEN N3.
- De stems-rij overleeft geen serverherstart; de werkmap wordt opgeruimd.
- Een split van een uur heeft tijdelijk 2× de stems.wav aan schijf nodig (4 stems:
  5,5 GB + 2,8 GB).
- Niet getest: een album van een uur van begin tot eind, CUDA (H3), splitsen met een
  volle schijf.
