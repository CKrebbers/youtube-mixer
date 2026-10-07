# Stems — spoor server

Bouwer, 3 okt 2026. Branch **`stems/server`** (vanaf `dfd7ea5`, het contract),
worktree `~/Projects/varve-stems/server`. Niet gemerged, niet gepusht. Contract:
`docs/STEMS.md` §1, §2 en §5.

## Commits

| commit | wat |
|---|---|
| `b495fe9` | De splitter `server/stems/splits.py` (Demucs in stukken) en `tools/stems/vergelijk.py` |
| `bb7fe56` | Schema v8 (`tracks.stems_json`) en `stems` in elke library-rij |
| `3bfe1bd` | `server/stems.js` (splitter, rij, één opdracht), de routes, de koppeling met de ingest, `test/nep-stems.mjs`, `test/stems.test.mjs` |
| `09d69cd` | De rest van het model naar inst/other: alle stems vol = audio.wav (afwijking, zie onder) |
| (dit verslag) | |

`node test/alles.mjs`: **41 bestanden, 3781 checks, alles groen** (ook vormen-isomorf,
terwijl de andere sporen de machine belastten). `VARVE_STEMS_ECHT=1 node test/stems.test.mjs`
(met de echte Demucs): groen.

Na mergen: **server op :8777 herstarten**. Bij de eerste start migreert `library.db`
naar **schema v8** (één `ALTER TABLE`, alles erin blijft). Geen npm-dependency. Python
met Demucs staat al in `~/.varve/stems-venv`.

---

## Wat er gebouwd is

### `server/stems/splits.py` — de splitter

`<python> server/stems/splits.py --in <audio.wav> --uit <map> --aantal 2|4 [--apparaat auto|mps|cuda|cpu] [--model htdemucs]`,
precies zoals het contract. Erbij: `--controle` (importeert torch/torchaudio/demucs,
geeft JSON; laadt het model niet, dat kan downloaden), `--threads N` (standaard de helft
van de kernen, hooguit 4) en `--stuk-s` (alleen voor metingen; `0` = alles in één keer).

- **In stukken.** Demucs' `apply_model` houdt invoer en vier bronnen van het hele nummer
  als float32 vast: een uur is ~6,5 GB plus tussenresultaten. Hier gaat er telkens
  **46,8 s** door het model (8 strides van htdemucs, zodat `apply_model` geen half segment
  verspilt), met **4 s overlap**: 1 s context aan weerskanten plus een **lineaire
  kruisfade van 2 s** op de grens. Lineair, niet equal-power: de twee stukken schatten
  hetzelfde signaal (sterk gecorreleerd), dan telt lineair op tot 1. Hop 42,8 s; een
  laatste stuk korter dan 10 s gaat bij het vorige. Extra rekenwerk door de overlap ~9%.
- **Uitgelijnd hersamplen.** 48 → 44,1 → 48 kHz met `torchaudio.functional.resample`
  (niet `torchaudio.load/save`, die vragen torchcodec). Elk stuk begint op een veelvoud
  van 160 frames (= 147 op 44,1 kHz): dan ligt het rooster van elk stuk precies op dat
  van het hele nummer. Exact evenveel frames als de invoer (bijknippen/aanvullen per stuk).
- **Normaliseren** zoals `demucs.separate` (gemiddelde eraf, delen door de spreiding van
  de mono-mix), maar met de cijfers van het HELE nummer (eerste pas over het bestand),
  niet per stuk.
- **De rest van het model** gaat naar inst/other (zie "Afwijkingen"): som van de stems =
  audio.wav op 16-bit afronding na.
- **`schaal` exact**: pas 1 schrijft float32 naar `<map>/.stems-tmp.f32` en houdt de
  grootste piek bij; pas 2 schaalt één keer naar 16 bit (`schaal = min(1, 32767 / (32768·piek))`,
  de engine leest `/32768`). Vooraf: vrije schijfruimte (float32 + wav), en boven 4 GB
  data (WAV-grens: 4 stems > ~3,1 uur, 2 stems > ~6,2 uur) een duidelijke fout.
- **Schrijven**: `stems.wav` (RIFF, PCM formaat 1, kop van 44 bytes, interleaved,
  kanaalpaar k = `namen[k]`) en `stems.json` eerst onder een tijdelijke naam, dan
  `os.replace`: wie `stems.json` ziet, ziet een complete set. Verder niets in `<map>`.
- **Stdout** `voortgang x` (per segment van het model, hooguit 2× per seconde, minstens
  één per stuk), als laatste `klaar`. **Stderr**: de laatste regel is de reden
  (`fout: …`); regels die met `info:` beginnen zijn meetwaarden. Exit 0 / 1 / 130.
- **SIGINT én SIGTERM** = KeyboardInterrupt (expliciet gezet: een proces dat met SIGINT
  op "negeren" start krijgt anders niets), tijdelijke bestanden weg, exit 130. Echt
  gemeten: annuleren midden in een split van 120 s → weg na **1,1 s**.
- htdemucs is een "bag" van één model: dat model wordt er direct uit gehaald en blijft op
  het apparaat (anders zet `apply_model` het per stuk heen en terug naar de CPU).
- `PYTORCH_ENABLE_MPS_FALLBACK=1` (een ontbrekende MPS-bewerking valt terug op de CPU).

### `server/stems.js`

- **`Splitter`**: welk commando (`stemsCommando`, bij elke aanroep gelezen):
  `VARVE_STEMS_CMD` (vervangt alles, krijgt dezelfde argumenten), anders
  `VARVE_STEMS_PY` + splits.py, anders `~/.varve/stems-venv/bin/python` + splits.py.
  **Een testserver (`VARVE_MEDIA` gezet) zonder een van beide splitst niet** (zie
  Afwijkingen). `controleer()` draait `--controle` één keer en onthoudt de uitkomst
  (`{ ok, reden?, python? | commando?, apparaat?, demucs?, torch? }`); `hercontrole`
  kijkt na 30 s opnieuw als het níet klaar was (een venv die je aanmaakt terwijl de
  server draait werkt zonder herstart). `splits()` draait via **`run()` uit
  ingest.js** — dezelfde SIGINT → 3 s → SIGKILL voor de hele procesfamilie, het
  resultaat pas als het proces echt weg is — met **`nice -n 10`** ervoor (`nice` doet
  exec: zelfde pid, dus de signalen komen bij Python aan). Time-out
  `max(30 min, 10 min + 4 × duur)`: de vaste 30 min van `run()` zou op de CPU (0,85×)
  een album halverwege afbreken.
- **`StemsRij`**: één tegelijk, zoals `wachtrij.js`, met de vorm uit het contract
  (`{ id, track, titel, aantal, status, voortgang, fout, begon, klaar }`, status
  `wacht|bezig|klaar|fout|geannuleerd`). Annuleren: wacht → meteen; bezig → signal,
  blijft `bezig` met `stoppen: true` tot proces en werkmap weg zijn. `zoek(track)`
  slaat een opdracht die al stopt over (na opnieuw binnenhalen moet er een nieuwe achter
  kunnen). `voegFoutToe` voor "gevraagd, maar de splitter is er niet". `stop()` voor het
  afsluiten. Volgorde "nieuwste eerst" met een volgnummer (twee opdrachten in dezelfde
  milliseconde stonden anders willekeurig).
- **`maakStems`** (één opdracht): werkmap `media/.bezig-stems-<id>-<hex>`, splitsen,
  **nalopen** (aantal, kanalen = 2 × aantal, 16-bit PCM, 48 kHz, frames van stems.wav
  én stems.json gelijk aan audio.wav), dan pas `stems.wav` + `stems.json` naar
  `media/<id>/` (een bestaande set wordt vervangen, 2 → 4) en `lib.bewaarStems`. Is
  **audio.wav intussen vervangen** (ander inode/grootte/mtime: opnieuw binnengehaald)
  of het nummer weggehaald, dan gaat de set weg met die reden. Gooit nooit; de werkmap
  is weg als het terugkomt.
- `leesWavKop(pad)` (fmt/data zelf zoeken, ook 0xFFFE en een LIST-chunk) en
  `wisStemsBestanden`.

### Database (`server/library.js`)

Schema **v8**: `ALTER TABLE tracks ADD COLUMN stems_json TEXT` (de hele stems.json plus
`bestand`). Elke rij (lijst, pagina, los nummer, `trackMetUrl`) krijgt
`stems: null | { aantal, namen, schaal, bestand }`; `stems_json` zelf niet.
`normaliseerStems` laat alleen een bruikbare set door (aantal 2|4, namen met dat aantal,
`0 < schaal ≤ 1`, `bestand` = `media/<id>/stems.wav`); `bewaarStems` gooit op onzin en
wist met null; `stemsInfo` geeft de hele bewaarde JSON. Een kapotte JSON in de database
= `stems: null`, de rij leest gewoon.

### Routes (`server/index.js`)

- `GET /api/stems` → `{ opdrachten, server, beschikbaar, reden? }` (dezelfde run-id als
  `GET /api/ingest`).
- `POST /api/stems { track, aantal, opnieuw? }` → 202 `{ opdracht }`; 400 (aantal niet
  2|4, ook `"2"`), 404 (onbekend, rare id, of geen audio op schijf), 200
  `{ opdracht, dubbel: true }` als het nummer al in de rij staat (ook met een ander
  aantal), 200 `{ al: true, stems }` als het die stems al heeft, 503 `{ fout, reden }`
  zonder splitter.
- `DELETE /api/stems/<id>` → annuleren (`{ ok, opdracht }`) of wegklikken (`{ ok, weg: true }`), 404 onbekend.
- Witte lijst: `/media/<id>/stems.wav` (Range zoals audio.wav). `stems.json` en
  `.bezig-*` niet.
- `POST /api/ingest { url | urls, stems?: 0|2|4 }` (standaard 2; anders 400) en
  `/api/upload?…&stems=0|2|4` (anders 400 vóór het lezen). Na een **geslaagde** ingest
  (nieuwe audio.wav): de stems in de rij gewist (in `bewaarInLibrary`, dus de
  teruggegeven track zegt al `stems: null`), de bestanden weg, een split van de OUDE
  audio die nog loopt geannuleerd, en met `stems > 0` het nummer de stems-rij in. De
  ingest-rij wacht daar niet op (getest: de volgende ingest is klaar terwijl de split
  nog loopt); vlak na het opstarten, als de controle van de splitter nog loopt, gaat
  het zelfs helemaal los van de ingest.
- `DELETE /api/library/<id>` annuleert een open split van dat nummer.
- `/api/tooling` → `{ …, stems: { ok, reden?, python?, … } }` (met hercontrole).
- Alle bestaande regels gelden (JSON-only, Host/Origin, `leesJson`); `server.test.mjs`
  heeft de nieuwe routes bij de 403/415-lijsten gezet.
- **Afsluiten**: SIGTERM/SIGINT met een lopende split → eerst de rij stoppen (Python
  krijgt SIGINT via `run()`), dan het signaal opnieuw met de gewone afloop; hooguit 5 s,
  een tweede signaal = meteen. Loopt er niets, dan meteen weg zoals altijd. Zonder dit
  bleef Demucs na `kill <server>` een half uur rekenen voor een werkmap die bij de
  volgende start weggaat. Achtergebleven `.bezig-stems-*` ruimt de bestaande opruimlus
  bij het opstarten op (alle `.bezig-*`, alleen in `VARVE_MEDIA`).
- Bij het opstarten: de controle op de achtergrond, met een logregel
  (`stems: Demucs klaar (…/python, mps)` of `[stems] geen stems: <reden>`).

### Tests

- **`test/nep-stems.mjs`**: zoals het contract. Stem k = audio × gewicht (2: vocals 0,75 ·
  inst 0,25; 4: drums 0,1 · bass 0,2 · other 0,3 · vocals 0,4); de laatste stem = origineel
  min de andere in hele samples, dus **de som is bit voor bit audio.wav** (de laatste wijkt
  hooguit 1,5 LSB van zijn gewicht af). schaal 1, model/apparaat `"nep"`, dezelfde
  voortgangsregels, `--controle`, SIGINT/SIGTERM = opruimen + 130. Sturen: `NEP_STEMS_LOG`
  (JSON per aanroep, met pid en **nice-waarde**), `NEP_STEMS_MS`, `NEP_STEMS_TRAAG_MS`,
  `NEP_STEMS_ONTBREEKT` (controle faalt); in het `--in`-pad: `traag`, `kapot`, `doof`
  (negeert SIGINT), `scheef` (één frame te weinig); een bestand **`nep-traag`** naast
  audio.wav = 1000 × 50 ms (een id kan een test na een ingest niet kiezen, een bestand wel).
  `maakNepStems(map)` schrijft het startscript voor `VARVE_STEMS_CMD`.
- **`test/stems.test.mjs`** (102 checks, ~26 s): de rij; commando en controle (ook
  "Demucs ontbreekt", "geen Python", testserver); één opdracht met de nep (argumenten,
  nice ≥ 10, werkmap, stems.json-velden, kanaalpaar/gewicht per sample, som bit voor bit,
  2 → 4 vervangen, fout met de reden, een frame te weinig geweigerd, annuleren midden in
  (32 ms), een splitter die SIGINT negeert (SIGKILL na ~3,2 s), audio.wav vervangen tijdens
  de split); de routes op een eigen server (weigeren, splitsen, library-rij en lijst, witte
  lijst met Range, al/opnieuw, 4 vervangt 2, volgorde, dubbel, DELETE midden in, fout,
  nummer weghalen, ingest-koppeling met 4/standaard/0/lijst/bestond, de ingest-rij wacht
  niet, opnieuw binnenhalen tijdens een split, opnieuw binnenhalen wist de stems, upload
  `?stems=`, SIGTERM met een lopende split, herstart met een achtergebleven werkmap). Met
  `VARVE_STEMS_ECHT=1` daarbovenop de echte Demucs (12 s synthetisch: frames, schaal, som
  −114 dB; annuleren midden in een split van 120 s).
- `test/library.test.mjs`: schema v8, de rij, onzin gooit, kapotte JSON, migratie v7 → v8
  (en de bestaande v5-migratiecheck kent de nieuwe kolom).
- `test/wachtrij-server.test.mjs`: een testserver zonder splitter zegt dat met de reden;
  na een ingest een stems-opdracht met `fout`; `POST /api/stems` 503.
- `test/server.test.mjs`: `/api/stems` en `/media/<id>/stems.wav` bij de Origin/Host-lijsten.

---

## Metingen (echte Demucs, M1 16 GB, MPS)

Kopieën uit `media/` van de hoofdmap (alleen gelezen) in de scratchpad. Python 3.14.0,
torch 2.9.1, demucs 4.1.0, `--threads 4`. Geheugen met `/usr/bin/time -l`.

**Let op de belasting**: de eerste vier runs draaiden op een rustiger machine (load ~4–5).
Tijdens de runs van 10 min draaiden de andere twee sporen headless Chrome (WebGL) en
tests: load 12–22, de GPU gedeeld. Die snelheden zijn dus een ondergrens.

| nummer | duur | stems | stukken | × realtime | max RSS | peak footprint | frames gelijk | som − origineel (model) |
|---|---|---|---|---|---|---|---|---|
| No Surprises (`tiktok-7031697544472251694`) | 79,2 s | 2 | 2 | **2,97×** | 0,90 GB | 3,83 GB | ja | −37,8 dB |
| No Surprises | 79,2 s | 4 | 2 | **2,96×** | 1,07 GB | 4,11 GB | ja | −37,8 dB |
| Bay Ledges (`HGv_ySHXtYI`) | 213,9 s | 2 | 5 | **3,17×** | 0,98 GB | 4,02 GB | ja | −33,7 dB |
| Bay Ledges | 213,9 s | 4 | 5 | **2,65×** | 0,98 GB | 4,01 GB | ja | −33,7 dB |
| album (`f3a7DiCsm8k`, 900–1540 s) | 640,0 s | 4 | 15 | 1,79× (belast) | **1,02 GB** | 3,95 GB | ja | −25,0 dB |
| zelfde, **zonder stukken** (`--stuk-s 0`) | 640,0 s | 4 | 1 | 1,54× (belast) | **3,50 GB** | **7,96 GB** | ja | −25,0 dB |
| No Surprises, na "rest naar inst" | 79,2 s | 2 | 2 | 0,99× (belast) | 0,96 GB | 3,68 GB | ja | **−111,7 dB** |

- **Snelheid**: ~3× realtime op een rustige M1 (de proef van 24 sep mat 1,9–2,4×). Met de GPU gedeeld (WebGL van een ander proces)
  1–1,8×. Een uur album: ~20 min rustig, tot ~1 uur als de GPU druk is.
- **Geheugen begrensd**: met stukken blijft de RSS ~1 GB, of het nummer nu 79 s of 640 s
  duurt (0,90 → 0,98 → 1,02 GB); de footprint (met de 2,4 GB die MPS reserveert) ~4 GB.
  Zonder stukken groeit het met de lengte: 640 s = 3,5 GB RSS / 8 GB footprint; een uur
  zou ruim 16 GB vragen. Tijdelijk op schijf: float32 = 2 × de uiteindelijke stems.wav
  (een uur 4 stems: 5,5 GB tijdelijk + 2,8 GB stems.wav).
- **Som tegen het origineel** (wat Demucs zelf haalt, vóór "rest naar inst"): −37,8 /
  −33,7 / −25,0 dB. Het hersamplen heen en terug alleen is −61,5 / −59,2 / −61,0 dB, dus
  de afwijking is het model. De proef van 24 sep gaf −34 tot −43 dB; het ambient album
  zit eronder. Na "rest naar inst": **−111,7 dB** (16-bit afronding).
- **De stukgrenzen** (14 grenzen in de 640 s, met `tools/stems/vergelijk.py` en een
  vergelijking met dezelfde split zonder stukken):
  - som-fout per venster van 100 ms in de kruisfades tegenover de rest: album −36,3
    tegenover −36,8 dB (mediaan), No Surprises −39,9 tegenover −36,4 dB: niet slechter.
  - verschil stukken − zonder stukken in de 2 s-kruisfades tegenover controlevensters
    van 2 s midden in een stuk (absoluut): bass −50,3 tegenover −51,2 dBFS, other −47,6
    tegenover −47,5 dBFS (bij −22 resp. −17 dBFS signaal); drums en zang zijn in dit
    ambient fragment vrijwel stil (−65 / −76 dBFS), verschil −70 / −77 dBFS. Het
    verschil op een grens is dus even groot als midden in een stuk: het komt van
    Demucs' eigen segmenten van 7,8 s die anders vallen (zoals elke andere `shift`),
    niet van de grens.
  - geen sprong: de grootste stap tussen twee samples binnen 1 s van een grens is
    hooguit 0,72× de grootste stap in het hele nummer (per stem; No Surprises zang 0,01×).
  - de som over de grenzen blijft na "rest naar inst" exact (de kruisfade is lineair);
    nagerekend door de rest achteraf in de bestaande uitvoer te zetten (geen nieuwe zware run).
- **Aandeel** (energie): No Surprises zang 52% / rest 48%; Bay Ledges zang 13% / other 86%;
  het album-fragment bass 30% / other 66%, zang 0%.
- **Annuleren met de echte Demucs**: SIGINT midden in → proces weg na 1,1 s, geen werkmap.

---

## Keuzes en afwegingen

- **Stuklengte 46,8 s, overlap 4 s.** Groter scheelt overlap (9% nu) maar niets aan
  geheugen dat ertoe doet; 1 s context is ruim boven wat de triangle-weging van Demucs
  zelf tussen zijn segmenten gebruikt, en de meting laat aan de grenzen niets zien.
- **Rekentijd in `stems.json`** = de hele split, inclusief torch importeren en het model
  laden (~2 s) en beide passen; de `info:`-regel op stderr splitst het uit.
- **`nice -n 10` via het programma `nice`** in plaats van `os.setPriority` na de spawn:
  zo kan `run()` uit ingest.js ongewijzigd blijven (één plek voor starten en stoppen). De
  GPU kent geen nice: tijdens een set met veel video concurreert Demucs met WebGL (zie
  "Niet getest").
- **Een al aanwezig nummer ("bestond") wordt niet gesplitst** na `POST /api/ingest`: er
  is niets binnengehaald, en een lijst opnieuw plakken zou anders de hele library door
  Demucs halen. Splitsen kan via `POST /api/stems`.
- **Splitter er niet bij een ingest met stems** → een opdracht met `fout` en de reden in
  de stems-rij ("nooit stil niets"). Op een machine zonder Demucs krijgt dus elk
  binnengehaald nummer zo'n regel tot je in de strook "geen" kiest.
- **Een opdracht in de rij met een ander aantal** → 200 met die opdracht (contract),
  niet bijwerken: voorspelbaar; annuleren en opnieuw kan.
- **De rij overleeft geen herstart** (zoals de ingest-rij): na een herstart ziet de ui
  een andere `server`-id. Wat liep is weg; de werkmap wordt opgeruimd.
- **stems.wav vervangen terwijl het speelt**: een nieuwe set (2 → 4, of `opnieuw`) gaat
  met `rename` over de oude. Een deck dat die stems.wav aan het streamen is, leest bij
  het volgende Range-verzoek het NIEUWE bestand (andere kanalen). Zie "Nodig van andere
  sporen". Hetzelfde geldt al jaren voor audio.wav bij opnieuw binnenhalen.

## Afwijkingen van het contract

1. **De rest van het model gaat naar inst (2) of other (4)** — `inst = mix − zang`
   in plaats van `drums + bass + other`. Waarom: Demucs telt op Clay's nummers maar op tot
   −25 (ambient) à −38 dB onder het origineel; "alle stems vol" klonk dus net anders dan
   het nummer, en het contract gaat ervan uit dat de som klinkt als audio.wav. Nu is de
   som audio.wav op −111 dB na. Prijs: wat het model nergens onderbracht (ook een beetje
   zang die het miste) zit in inst/other en blijft hoorbaar als de zang uit staat — zoals
   bij "instrumentaal = mix − zang" in de meeste karaoke-tools. Terugdraaien is één regel
   in splits.py (`rest` niet optellen). Vraag voor Clay/integratie of dit zo blijft.
2. **Testserver zonder splitter**: `VARVE_MEDIA` gezet en geen `VARVE_STEMS_CMD` of
   `VARVE_STEMS_PY` → `beschikbaar: false` met de reden. Anders zette elke test die iets
   binnenhaalt (2 stems is de standaard) de echte Demucs op zijn testgeluid, met een
   `.bezig-stems-*` in media/ — `upload.test.mjs` (niet van dit spoor) telt `.bezig-`-mappen
   en faalde dan. Clay's server zet `VARVE_MEDIA` niet.
3. **Het model staat niet in `~/.cache/torch/hub/checkpoints/`** maar (demucs 4.1.0 haalt
   het van Hugging Face) in `~/.cache/huggingface/hub/models--adefossez--HTDemucs`
   (84 MB, 24 sep). De tekst in STEMS.md klopt daar niet.
4. **Extra velden** in een opdracht: `plek` (wachtend), `toegevoegd`, `stoppen`
   (annuleren loopt), `opnieuw`, en `stems` als hij klaar is (de ui kan de rij bijwerken
   zonder de library opnieuw te halen). De 200-"dubbel" is `{ opdracht, dubbel: true }`,
   de 503 `{ fout, reden }`. Extra vlaggen op splits.py: `--controle`, `--threads`, `--stuk-s`.
5. Boven 4 GB data weigert splits.py met een reden (geen RF64): 4 stems van meer dan
   ~3,1 uur. Het contract zegt er niets over.

## Niet getest

- **Een album van een uur van begin tot eind** (alleen 640 s; het geheugen is vlak in de
  lengte en de stukken lopen streamend, dus verwacht ~1 GB RSS en ~20 min op een rustige
  M1; 5,5 GB tijdelijk op schijf bij 4 stems).
- **CUDA** (`--apparaat cuda`, Omarchy, H3) en de CPU-terugval: de code kiest ze, niet gedraaid.
- **Splitsen tijdens een set** met veel video: Demucs gebruikt de GPU (MPS), WebGL ook;
  `nice` helpt alleen de CPU. Niet gemeten of beelden haperen of de server trager pagina's
  levert (audio is CPU, en de server leest alleen bestanden). Gemeten wel: met andermans
  WebGL ernaast zakt Demucs naar 1–1,8×.
- Gedrag als de schijf vol raakt tijdens pas 1/2 (er is een controle vooraf; daarna een
  fout van Python met de reden, werkmap weg — niet nagespeeld).
- Het model downloaden als het niet in de cache staat (eerste split op een nieuwe machine
  heeft internet nodig; `--controle` meldt dat niet).
- Een upload/ingest met stems op de echte server op :8777 (hoofdmap is alleen-lezen).

## Nodig van andere sporen

- **engine**: `stems.wav` kan onder een spelend deck vervangen worden (2 → 4 of
  `opnieuw` op een nummer dat speelt). Voorstel: de StreamBron onthoudt de totale grootte
  uit de eerste `Content-Range` en weigert/stopt als die bij een volgend verzoek anders is
  (geldt ook voor audio.wav bij opnieuw binnenhalen). Of de ui waarschuwt (zie hieronder).
- **engine**: de som van de stems is nu audio.wav (−111 dB). Met alle niveaus op 1 en
  `1/schaal` klinkt een track met stems als zonder; `schaal` was in alle metingen 1,0000
  (pieken 0,66–0,88), maar kan kleiner zijn bij luide nummers.
- **ui**: `GET /api/stems` op een testserver geeft `beschikbaar: false` tenzij
  `VARVE_STEMS_CMD` (nep) of `VARVE_STEMS_PY` gezet is — `tools/headless/stems.mjs` moet
  `VARVE_STEMS_CMD = maakNepStems(map)` meegeven (uit `test/nep-stems.mjs`), en voor
  "voortgang zien" een `traag`-id of een `nep-traag`-bestand naast audio.wav.
- **ui**: een opdracht heeft `track` (id), `aantal`, `voortgang` 0..1 en bij klaar `stems`;
  `fout`-opdrachten komen ook van de ingest als de splitter er niet is. Splitsen of
  opnieuw splitsen van een nummer dat op een deck met stems speelt: liever waarschuwen
  (tweede klik), zie het punt bij engine.
- **integratie** (`docs/STEMS.md`, `CLAUDE.md`, `tools/README.md`): afwijkingen 1–3
  hierboven; de structuur (`server/stems.js`, `server/stems/splits.py`,
  `test/stems.test.mjs`, `test/nep-stems.mjs`, `tools/stems/vergelijk.py`); schema v8 =
  `stems_json` (geen ander spoor raakt het schema); `VARVE_STEMS_PY`, `VARVE_STEMS_CMD`,
  `VARVE_STEMS_ECHT=1`; "SIGTERM stopt eerst een lopende split".
