# Stems — zang en rest (of vier) per nummer

Status: **contract voor de bouw (3 okt 2026)**. Drie sporen bouwen hier tegelijk
tegenaan (server, engine, ui); na de integratie wordt dit het naslagdocument.
ROADMAP 17, besluiten in VRAGEN H1–H3. De proef van 24 sep staat in
`docs/HANDOFF.md` ("Stems splitsen — proef") en `tools/stems/meet.py`.

## Wat Clay besliste

- H1: de stems klinken goed genoeg om live mee te spelen.
- H2: **kiesbaar per nummer**. Standaard twee (zang, rest); vier als je dat bij
  het binnenhalen vraagt.
- Advies van 24 sep, overgenomen: splitsen bij de ingest (vooraf rekenen, live
  bedienen, zoals Serato/rekordbox/djay), de stem-fader VÓÓR de EQ. Geen
  realtime splitsen in de browser.
- 3 okt: Clay laat het nu bouwen (eerder dan "na 25 okt").
- H3 (splitsen op de Omarchy-machine) blijft open. De splitter kent daarom
  `--apparaat cuda`, maar er komt geen netwerkdienst.

## Model en meting

Demucs `htdemucs` (4.1.0, MIT), op de M1 via MPS 1,9–2,4× realtime, op de CPU
0,85×. Een uur muziek ≈ 27 min rekenen. Het model levert altijd vier bronnen
(drums, bass, other, vocals) op 44,1 kHz. Twee stems = vocals + (drums + bass +
other): even veel rekenwerk, de helft van de opslag.

Python: een venv BUITEN de repo, `~/.varve/stems-venv` (met
`--system-site-packages`, torch 2.9.1 staat systeembreed; `pip install demucs`).
Het model staat in `~/.cache/torch/hub/checkpoints/`. Opnieuw opzetten:

```
python3 -m venv --system-site-packages ~/.varve/stems-venv
~/.varve/stems-venv/bin/pip install demucs
```

## 1. Bestandsformaat (de naad tussen server en engine)

Naast `audio.wav` in `media/<id>/`:

**`stems.wav`**: RIFF/WAVE, PCM 16-bit, 48 000 Hz, INTERLEAVED, `kanalen = 2 ×
aantal stems` (4 of 8). Kanaalpaar k (kanalen 2k, 2k+1 = links, rechts) is stem
k in de volgorde van `stems.json.namen`. Precies evenveel frames als
`audio.wav` (bijknippen of aanvullen met stilte). Formaatcode 1 (PCM) of
0xFFFE (extensible) mag; de kop mag een LIST-chunk hebben (`leesWavKop` zoekt
de data-chunk zelf).

**`stems.json`**:

```json
{
  "versie": 1,
  "model": "htdemucs",
  "aantal": 2,
  "namen": ["vocals", "inst"],
  "schaal": 0.93,
  "frames": 3801600,
  "sr": 48000,
  "apparaat": "mps",
  "rekentijd_s": 34.6,
  "gemaakt": "2026-10-03T14:00:00Z"
}
```

- `namen`: twee stems = `["vocals", "inst"]` (inst = drums + bass + other);
  vier = `["drums", "bass", "other", "vocals"]` (de volgorde van Demucs).
- `schaal` (0 < schaal ≤ 1): alle stems zijn met dezelfde factor
  vermenigvuldigd zodat geen enkele stem clipt in 16 bit. De engine zet er
  `1 / schaal` bovenop, zodat de som van de stems even hard klinkt als
  `audio.wav`.

`audio.wav` blijft de bron van golfvorm, beatgrid, toonsoort en onsets. Alleen
het AFSPELEN gaat via `stems.wav` als die er is.

## 2. Server (spoor server)

### De splitter: `server/stems/splits.py`

```
<python> server/stems/splits.py --in <audio.wav> --uit <map> --aantal 2|4
         [--apparaat auto|mps|cuda|cpu] [--model htdemucs]
```

- Schrijft `<map>/stems.wav` en `<map>/stems.json`, verder niets in `<map>`
  (tijdelijke bestanden worden opgeruimd).
- Stdout: regels `voortgang <0..1>` (minstens één per stuk), als laatste
  `klaar`. Fouten naar stderr, exitcode ≠ 0. SIGINT = netjes stoppen (exit 130).
- In STUKKEN (orde 30–60 s met overlap en kruisfade), zodat een album van een
  uur niet in één keer in het geheugen hoeft (16 GB RAM). 48 → 44,1 kHz voor het
  model, terug naar 48 kHz erna (torchaudio.functional; NIET torchaudio.load/save,
  die vragen in 2.9 torchcodec — zie `tools/stems/meet.py`).
- `schaal` exact uit de grootste piek over alle stems (twee passen mag, met een
  tijdelijk float-bestand in `<map>`).
- `--apparaat auto` = cuda als die er is, anders mps, anders cpu.

### De wachtrij: `server/stems.js`

- Eén opdracht tegelijk, zoals `server/wachtrij.js` (annuleren met een
  AbortSignal; SIGINT, na 3 s SIGKILL voor de hele procesfamilie). Lage
  prioriteit (`nice`): het mag de server, die de pagina's van spelende decks
  levert, nooit ophouden.
- Werkmap `media/.bezig-stems-<id>-*`, pas bij succes `stems.wav` en
  `stems.json` naar `media/<id>/` verhuizen (een bestaande set stems wordt dan
  vervangen, bv. 2 → 4). Opruimen van achtergebleven werkmappen bij het
  opstarten, alleen binnen `VARVE_MEDIA`.
- Python: `VARVE_STEMS_PY` (standaard `~/.varve/stems-venv/bin/python`).
  `VARVE_STEMS_CMD` vervangt het hele commando voor de tests (een nep-splitter,
  `test/nep-stems.mjs`, zoals `VARVE_YTDLP` met `nep-ytdlp.mjs`); die krijgt
  dezelfde argumenten.
- Ontbreekt Python of Demucs, dan zegt de wachtrij dat (`beschikbaar: false,
  reden`) en weigert hij opdrachten met die reden. Nooit stil niets doen.
- `/api/tooling` meldt de splitter erbij (`stems: { ok, reden?, python? }`).

### De nep-splitter: `test/nep-stems.mjs`

Voor tests en headless (ook het ui-spoor rekent erop). Zelfde argumenten als
splits.py, geen Python. Schrijft stem k = `audio.wav × gewicht[k]`, zodat de som
precies het origineel is en je aan het NIVEAU ziet welke uitgang welke stem is:

- twee: `vocals` 0,75 · `inst` 0,25
- vier: `drums` 0,1 · `bass` 0,2 · `other` 0,3 · `vocals` 0,4

`schaal` 1, `model` `"nep"`, `apparaat` `"nep"`. Voortgangsregels zoals de echte.
Extra's voor de wachtrijtests via omgevingsvariabelen (traag, laten mislukken)
mag het serverspoor zelf kiezen.

### Database

Schema-versie erbij: `ALTER TABLE tracks ADD COLUMN stems_json TEXT` (de inhoud
van stems.json plus `bestand`). Tests rekenen met `SCHEMA.length`. Gezet als
een split slaagt; gewist als `audio.wav` opnieuw binnengehaald wordt (dan
passen de frames niet meer: oude stems weg, en opnieuw splitsen als daarom
gevraagd is).

Een library-rij krijgt:

```
stems: null | { aantal: 2|4, namen: [...], schaal, bestand: "media/<id>/stems.wav" }
```

### Routes

- `GET /api/stems` → `{ opdrachten: [...], server: <run-id>, beschikbaar, reden? }`
  met per opdracht
  `{ id, track, titel, aantal, status: 'wacht'|'bezig'|'klaar'|'fout'|'geannuleerd', voortgang: 0..1, fout?, begon?, klaar? }`.
- `POST /api/stems` `{ track: "<id>", aantal: 2|4, opnieuw?: true }`
  → 202 `{ opdracht }`. 400 bij een ander aantal, 404 bij een onbekend nummer,
  503 als de splitter er niet is (met reden). Staat dat nummer al in de rij:
  200 met die opdracht. Heeft het al stems met dat aantal (en geen `opnieuw`):
  200 `{ al: true, stems }`.
- `DELETE /api/stems/<opdracht-id>` → annuleren (wacht of bezig) of, als hij
  klaar is, uit de lijst halen. Zoals `DELETE /api/ingest/<id>`.
- Witte lijst: `/media/<id>/stems.wav` erbij (Range, zoals audio.wav).
- Ingest: `POST /api/ingest` met `{ url | urls, stems?: 0|2|4 }` (standaard 2)
  en `/api/upload?…&stems=0|2|4`. Na een GESLAAGDE ingest gaat het nummer in
  de stems-rij met dat aantal (0 = niet). De ingest-rij wacht daar niet op.
- Alle bestaande regels gelden: POST alleen JSON, Host/Origin-controle,
  `leesJson`, geen paden van buiten.

## 3. Engine (spoor engine)

Regel 1: `src/engine/` weet niets van de server of de library. Het krijgt een
url en `{ namen, schaal }`.

### Streamen met meer kanalen

- `stream-kern.js`: een bestand mag 2, 4 of 8 kanalen hebben (16-bit PCM).
  `renderBlok` leest één STEREOPAAR per aanroep: nieuwe velden `stride`
  (kanalen per frame in de pagina, standaard 2) en `paar` (eerste kanaal van
  het paar: 0, 2, 4, 6). `PAGINA` blijft 65 536 FRAMES; een pagina is dan
  `PAGINA × kanalen × 2` bytes. Voor stereo moet alles bit voor bit blijven:
  de gouden hash in `renderblok.test.mjs` verandert NIET en het blijft
  afvalvrij (0 GC), ook met stems (zie de regels bovenaan "samples lezen").
  `controleerWav` accepteert 2, 4 en 8 kanalen.
- `stream-lezer.js`: de node heeft ALTIJD vier uitgangen van twee kanalen
  (`numberOfOutputs: 4, outputChannelCount: [2,2,2,2]`). Bericht
  `{ type: 'bron', duur, sr, kanalen }`. Per blok `renderBlok` voor elk paar
  dat er is, elk met een eigen `staat` (env); ongebruikte uitgangen op nul
  zetten (zonder afval). 'einde' komt van paar 0.
- `bron.js` (StreamBron): `new StreamBron(ctx, uitgangen)` met een ARRAY van
  vier nodes (uitgang k → uitgangen[k]); een losse node mag nog (dan gaan alle
  uitgangen daarheen: de som). Bytes per frame uit de kop. `bron.kanalen`
  (getter). `knip()` van een stems-bestand geeft de som van de paren met
  gewichten die het deck meegeeft (wat je HOORT vóór de EQ), zodat een pad
  zonder zang ook zonder zang klinkt.

### Het deck

- `createDeckChain` krijgt `stemIn: [g0, g1, g2, g3]` (GainNodes), die allemaal
  op `trim` aansluiten. `chain.input` blijft `trim` (BufferBron).
- `deck.laadStream(url, title, { haal?, stems? })` met
  `stems = { namen, schaal }`. Klopt het aantal kanalen van het bestand niet
  met `namen.length × 2`: weigeren met een reden (de ui valt dan terug op
  audio.wav).
- `deck.stems`: `null | { namen, aantal, schaal }`.
- Per stem een niveau 0..1 (1 = vol, 0 = uit) en een kill (schakelaar + drukknop,
  zoals de EQ-kill: weg zolang je drukt, de niveaustand blijft staan, kill uit
  = precies terug, klikvrij in ~5 ms als een zachte S in amplitude, na
  `startDrempel`, met `zetHellingen` uit `overgang.js`; NOOIT
  `setValueCurveAtTime`).
- Effectieve versterking van uitgang k (stem `n = namen[k]`):
  `(1 / schaal) × niveau(n) × kill(n) × (aantal = 4 en n ≠ 'vocals' ? niveau('inst') × kill('inst') : 1)`.
  Dus `inst` werkt in beide standen (bij vier: drums, bass en other samen), en
  drums/bass/other doen niets bij twee.
- Zonder stems: alle `stemIn` op 1, uitgang 0 draagt de hele mix, bit voor bit
  zoals nu.
- Bij elke laad: alle niveaus terug op 1, alle kills uit. (Keuze: stems horen
  bij het NUMMER, niet bij het kanaal. Een nieuw nummer dat stil zonder zang
  begint, omdat het vorige zonder zang speelde, is erger dan opnieuw drukken.
  Afwijkend van de EQ-knoppen, die bij het kanaal horen.)
- `snapshot()` krijgt per deck `stems: null | { namen, niveau: {…}, weg: {…} }`.

### Actions (eerst `define()`, dan pas ui)

Voor elke track N en elke stem `s` uit `vocals, inst, drums, bass, other`:

| action | type | wat | read |
|---|---|---|---|
| `track.N.stem.<s>` | value | niveau 0..1 | het niveau, of `null` als de track geen stems heeft of deze stem in deze stand niet bestaat |
| `track.N.stem.<s>.kill` | trigger | kill aan/uit | 1 = weg, 0 = open, `null` = n.v.t. |
| `track.N.stem.<s>.hold` | trigger | weg zolang je drukt | idem |

Labels in het Nederlands: zang (`vocals`), rest (`inst`), drums, bas (`bass`),
overig (`other`). Elke nieuwe action krijgt een uitleg in
`src/ui/apc-beschrijf.js`. De auto-DJ: stem-actions horen bij `OVERNEEM`
(`src/auto/automaat.js`): wat Clay aanraakt tijdens een overgang is van hem.
Geen plek in de standaard-APC-mapping in deze ronde (eerst VRAGEN; koppelen
werkt wel).

## 4. Ui (spoor ui)

- `laden.js` / `laadLibrary`: heeft de rij `stems`, dan `stems.bestand` laden
  met `{ stems: { namen, schaal } }`; mislukt dat, dan `audio.wav` met een
  `meld()`. Komen er stems binnen terwijl het nummer al op een track staat:
  NIET vanzelf wisselen (het speelt misschien), wel laten zien dat herladen ze
  geeft.
- Een STEMS-rij voor de track met focus (zoals KLANKSCHAAL en AUTO: standaard
  dicht, een knop om te openen). Per stem: naam, een niveauknop/schuif en een
  kill-knop, via de bus en elke frame teruggelezen met `read()`. Zonder stems:
  "geen stems" met splitsknoppen (2 · 4) als het een library-nummer is, en de
  voortgang als het in de rij staat. Past op 1440×790 (laptopmaat, `649b555`).
- Library: een kolom `stems`: `—`, `2`, `4`, `wacht`, `42%`, `fout` (tooltip
  met reden), en een knop om te splitsen (2 of 4) of te annuleren. Peilen op
  `GET /api/stems` zolang er iets open staat.
- Ingest-strook: keuze stems `2 · 4 · geen` (onthouden in localStorage
  `varve.stems.standaard`, standaard 2), mee in `POST /api/ingest` en de upload.
- Controlekamer: een tegel voor de stems-rij (wat loopt, wat wacht, of de
  splitter er is).
- Kolomkop of baan: een klein teken als de track stems heeft.

## 5. Wie raakt wat aan (tegen botsingen)

| spoor | bestanden |
|---|---|
| server | `server/**`, `test/stems.test.mjs`, `test/nep-stems.mjs`, toevoegingen in `test/server.test.mjs`, `test/library.test.mjs`, `test/ingest.test.mjs`, `test/wachtrij*.test.mjs`, `tools/stems/` |
| engine | `src/engine/**`, `src/control/actions.js`, `src/auto/automaat.js`, `src/ui/apc-beschrijf.js`, `test/stream.test.mjs`, `test/engine.test.mjs`, `test/renderblok.test.mjs`, `test/auto.test.mjs`, `test/regels.test.mjs`, `tools/bench/` |
| ui | `src/ui/**` (behalve `apc-beschrijf.js`), `src/controle/**`, `index.html`, `controle.html`, `styles.css`, `test/library-lijst.test.mjs`, `test/controle.test.mjs`, `test/spiegel.test.mjs`, `tools/headless/stems.mjs` |
| integratie | `docs/STEMS.md`, `CLAUDE.md`, `ROADMAP.md`, `docs/VRAGEN.md`, `docs/HANDOFF.md`, `tools/README.md` |

Elk spoor schrijft zijn verslag in `docs/verslagen/2026-10-03/<spoor>.md`.
