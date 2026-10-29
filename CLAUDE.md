# YouTube Mixer — projectgeheugen

Lees dit voordat je iets wijzigt. Dit bestand is de bron van waarheid voor
architectuurbeslissingen; `ROADMAP.md` is de bron van waarheid voor de volgorde;
`docs/VISIE.md` zegt waar het geheel heen moet (Clay's beeld, 10 okt: dj'en +
produceren + audio programmeren + zelf instellen, met beeld en controllers, als
draagbare set die overal kan streamen). Toets elke keuze daaraan (VISIE §5).

**Dit bestand is de kern; de details staan sinds 29 okt 2026 in twee bestanden ernaast**
(verplaatst, niet ingekort, zodat niet elke beurt 200 kB inleest):
- `docs/BOUWREGELS.md`: wat een bouwer niet mag breken, per onderwerp, met dezelfde koppen als
  vroeger hier. Een verwijzing "CLAUDE.md, <onderwerp>" in code, tests of docs staat daar.
- `docs/STRUCTUUR.md`: per map en per bestand wat erin staat.

**Werk je aan een onderwerp uit de index onderaan, lees dan eerst die sectie in
`docs/BOUWREGELS.md`.** Daar staan de valkuilen die al eens misgingen.

Hervatten na een pauze: `docs/HANDOFF.md` (stand, wat ongecommit is, wat
niet getest is), `docs/VRAGEN.md` (open vragen voor Clay),
`docs/VERBETERINGEN.md` (verbeterlijst in rondes), `docs/APC40.md` (wat de
controller kan en de indeling zoals gebouwd).

## Wat dit is

Een DJ-programma dat YouTube-audio en -video als bron gebruikt, bediend met een
MIDI-controller (referentie-hardware: **Akai APC40 mkII**), maar volledig bruikbaar
met muis en toetsenbord. Mapping moet door de gebruiker zelf aanpasbaar zijn.

Gebruiker: Clay (Varve). Nederlands in commits, comments, docs en gesprek.

## Gekozen aanpak (vastgelegd, niet heropenen zonder aanleiding)

YouTube's IFrame Player geeft **geen toegang tot de audiobuffer**. Daarmee zijn EQ,
filters, waveforms, beatgrids, keylock en scratch onmogelijk via de officiële weg.
Daarom: **lokale cache**. `yt-dlp` + `ffmpeg` halen media binnen en normaliseren die,
daarna draait alles op Web Audio en WebGL.

Consequentie: dit is een persoonlijk instrument, geen distributieplatform. **Geen
distributie van de cache**: bouw geen deelfuncties, geen publieke streaming en geen
upload van de cache naar buiten. Een **uitgang** is geen distributie en mag: een
bestand, een poort op 127.0.0.1, een export naar je eigen schijf. Eigen opnames en
renders naar de eigen library mogen ook (de upload-route bestaat al). Dit opent niets
naar buiten: Varve zelf naar een dienst laten sturen blijft een aparte keuze (U1b,
`docs/VRAGEN.md`). Als een feature om meer vraagt: eerst melden, niet stilletjes bouwen.
(VI1, 11 okt.)

## De drie regels

Deze regels zijn de reden dat het project uitbreidbaar blijft. Breek ze niet;
als een feature erom lijkt te vragen, is dat bijna altijd een ontwerpfout elders.

1. **De engine kent geen MIDI, geen DOM en geen YouTube.** `src/engine/` mag niets
   importeren uit `src/ui/`, `src/control/` of de ingest-laag. Alles wat de engine
   wil aansturen gaat via de action-bus.
2. **Alle `value`-actions zijn genormaliseerd 0..1.** MIDI CC is dat ook (na `/127`).
   Een mapping weet daardoor niets van dB, Hz of seconden. De engine doet de
   schaling, altijd. `trigger`-actions krijgen een boolean (true = indrukken).
3. **Positie komt van `ctx.currentTime`, nooit van een eigen teller of `setInterval`.**
   De AudioContext-klok is de enige die niet wegloopt als de UI hapert.

## Structuur (kort; volledig in `docs/STRUCTUUR.md`)

```
index.html, *.html  geen build-stap, plain ES-modules; plan/uitlijn/werk/apc/maschine/companion/controle.html zijn vensters en pagina's
src/engine/         audio: decks, bron (streamen), effecten, master, sampler, instrumenten, patronen. Puur, geen DOM (regel 1)
src/control/        de action-bus (actions.js), keyboard, MIDI, mapping, mapjes, LED's, hub, Maschine
src/ui/             het scherm: app.js (instappunt) en een opzet…()-module per onderdeel; aanhakers/ beschrijf/ css/ per spoor
src/analysis/ video/ vormen/ uitlijn/ plan/ auto/ opname/ koppel/ werk/ paneel/ library/ sets/ standen/ export/ lib/
server/             node server/index.js: HTTP, ingest, library (SQLite), stems, kaart, nacht, standen, backups; routes/ per spoor
mappings/           standaardmappings als data (apc40mk2.json + `eerder`), fragmenten en stukken
racks/ plannen/ patronen/ handen/ avondpakket/   data die wél in git staat
test/               node test/alles.mjs
tools/              headless-proeven, metingen, backup, varve-app (Dock-app en herstartlus); zie tools/README.md
docs/               ontwerp en verslagen; BOUWREGELS.md en STRUCTUUR.md horen bij dit bestand
media/ opnames/     niet in git
```

## Conventies

| Onderwerp | Afspraak |
|---|---|
| Taal | Nederlands in comments, commits, docs. Code-identifiers in het Engels. |
| Build | Geen. Plain ES-modules. Introduceer geen bundler zonder te vragen. |
| Server | `node server/index.js` op poort 8777. Serveert met `no-store`: Chrome houdt ES-modules anders vast en dan debug je een versie die niet meer bestaat. |
| Dependencies | Nul in de frontend. Elke toevoeging eerst voorleggen met reden. |
| Nieuwe functie | Eerst `define()` in `actions.js`, daarna pas UI en mapping. |
| Formatting | 2 spaties, single quotes, semicolons. Volg de bestaande stijl. |
| Tests | Alle bestanden in `test/` moeten groen blijven: `node test/alles.mjs`. Bij wijzigingen: check toevoegen. Hij draait in een pool (zoveel tegelijk als er kernen zijn, langste eerst uit `test/.duur.json`); een test met een tijdsgrens op de wandklok, een afvalmeting of een vaste poort krijgt bovenaan `// @alleen: <waarom>` en loopt daarna alleen. `--serieel` = alles na elkaar, `--banen N`. De Node van de suite staat in `.node-version` (26.8.2, de Mac en de workflow); een andere Node meldt `alles.mjs` boven en onder met de checks die op een andere V8 anders uitvallen (`test/node-versie.mjs`, VERSIEGEVOELIG; een nieuwe afvalmeting met een grens op één V8 hoort daarin). Een test die vraagt "is dit proces weg" telt een zombie als weg (`leeftNog` in wachtrij.test: PID 1 van een container ruimt wezen niet op). |
| Mocks | Een mock die makkelijker is dan de echte API verbergt bugs. De Web Audio-mock vuurt `onended` asynchroon omdat de browser dat ook doet. |
| Browser | Chrome. Web MIDI bestaat niet in Safari — geen polyfill-pogingen. |
| Git | Committen en pushen mag. `git add` per pad, nooit `-A`: de repo staat op het Bureaublad (iCloud), en bestanden met " 2" in de naam zijn conflictkopieën (meestal een oude versie): die NOOIT committen. Groter werk per spoor op een eigen tak in een worktree buiten iCloud (`~/Projects/varve-stems/<spoor>`), samenvoegen in `studio/integratie`, naar main met een PR; daarna de worktree weg. Data staat niet in git en hoort in de Bureaublad-map: `media/`, `opnames/`, `patronen/`, `proef/`, `standen/`, `sets/`, `racks/eigen.json` (eigen sjablonen; `racks/sjablonen.json` hoort WEL in git). Een server die vanuit een worktree draait schrijft patronen, de speellijst, de standen, de sets en de eigen sjablonen in die worktree: link `media`/`opnames` en zet de rest terug vóór je de worktree weghaalt. |

## Altijd, waar je ook aan werkt

De regels die het vaakst geraakt worden. De reden en de meting staan in `docs/BOUWREGELS.md`.

- **Het audiopad maakt geen afval** (renderBlok, worklets, kernen): 0 GC, gouden hash in `renderblok.test.mjs`. → "HET AUDIOPAD MAAKT GEEN AFVAL"
- **Nooit `setValueCurveAtTime`** op een AudioParam; hellingen via `zetHellingen()` na `startDrempel`. → "Overgangen op een AudioParam"
- **Effecten wisselen nooit door bedrading te veranderen** waar signaal doorheen loopt: twee ketens kruisfaden. → "Effecten wisselen"
- **Wat je HOORT staat op één plek** (`src/engine/hoorbaar.js`); sync, puls, vormen en beeld volgen de maatgever. → "Wat je HOORT", "Sync kent geen"
- **APC-nummers alleen uit Akai's protocoldocument v1.2**; grid-noten lopen van onder naar boven. → "De nummers in `devices/apc40mk2.js`"
- **Na elke wijziging aan `mappings/apc40mk2.json`: `node tools/mapping/eerder.mjs`** vóór de commit (anders faalt `mapping.test`). Een nieuwe action krijgt een uitleg in `apc-beschrijf.js` (of `src/ui/beschrijf/<spoor>.js`). → "Eigen mapping = VERSCHIL", "MAPJES"
- **Eén VARVE-tabblad praat met de APC.** Open nooit een extra VARVE-tabblad terwijl de APC aangesloten is en Clay's tabblad open staat; Varve en AV-kern nooit tegelijk open met de APC. Alles naar buiten door de wachtrij (16 per 4 ms). → "ÉÉN VARVE-tabblad", "Alles wat naar buiten gaat"
- **Elke testserver zet `VARVE_TESTSERVER=1`** plus zijn eigen `VARVE_MEDIA`/`VARVE_DB`/`VARVE_PATRONEN`/`VARVE_PLANNEN`/`VARVE_SETS`/`VARVE_SJABLONEN`, anders schrijft hij in de echte data. → "Waar media/ staat", "Verbeterronde 23 september"
- **Elke fetch leest zijn antwoord** (`leesWeg`), ook als hij gelukt is; zwaar werk in de server hoort in een worker of kindproces. → "Opnemen tapt de master", "De server mag even weg zijn"
- **Een AudioWorkletNode die weg moet krijgt eerst `'stop'`** en `onprocessorerror` via `meldWorkletFout`. → "Audio-gezondheid"
- **Meta-vlaggen op een action, geen regex**: `log: 'overslaan'`, `beginstand: false`, `overneem: true`, `alleenScherm: true`, `nummer: true`. Gevaarlijk van buiten de Mac = `VAST_NOOIT` in `src/werk/model.js`. → "Werkruimte: aanhaakpunten", "Werkruimte (S0–S8"
- **Met de werkruimte `standaard` is alles bit voor bit zoals vandaag.** → "Werkruimte (S0–S8"
- Na een serverwijziging: server herstarten.

## Index van `docs/BOUWREGELS.md`

Zoek in dat bestand op de kop of het kopwoord. Alles onder "Bekende grenzen" is één lange lijst; het kopwoord staat vooraan het punt.

| Je werkt aan | Lees in `docs/BOUWREGELS.md` |
|---|---|
| Afspelen, streamen, loops, `bron.js`, `stream-kern.js` | Bekende grenzen: STREAMT, ÉÉN afspeelmotor, Streamen leest, loop springt, Hoofdthread en worklet, HET AUDIOPAD |
| Transport: beatjump, loops, quantize, op de maat, rem, kill, pitch, bend | Bekende grenzen: TRANSPORT, REM, EQ-KILL, Pitch, Nudge, Pitchbereik, tempo-encoder, loops |
| Sync, maatgever, wat je hoort | Bekende grenzen: Sync kent geen, Wat je HOORT |
| Effecten, racks, rack-editor, macro's, sends, delay, reverb, gate | Bekende grenzen: Een rack bewaart … Effecten wisselen, Sends, De delay kan op de maat; Effecten uit de filter app; Meer effecten, sjablonen en modulators (S10) |
| Sampler | Bekende grenzen: Sampler, Sampler-pads, Spelende pads; Secties (sampler) |
| Beatgrid, tap, tellen | Beatgrid; Bekende grenzen: Het beatgrid staat in TRACKTIJD |
| Toonsoort, keylock | Toonsoort (gebouwd 25 sep) en keylock |
| Golfvorm, scherm, spiegel, vensters | Bekende grenzen: Het scherm spiegelt de APC40, Vensters, Teken de golfvorm NOOIT, Peaks |
| APC, mapping, mapjes, LED's, shift | Bekende grenzen: De nummers in `devices/apc40mk2.js`, MAPJES, Eigen mapping = VERSCHIL, De LED-laag, LED's in drie standen, Knipperen, ringknoppen, LED's lopen, mode 0x42 |
| MIDI-tabbladen, hub, echo's | Bekende grenzen: Alles wat naar buiten gaat, ÉÉN VARVE-tabblad, De hub telt, De hub negeert echo's, AV-APP-HUB |
| Video, beamer, beeldlagen, noodknoppen | Bekende grenzen: Video is SLAAF, HET LOSSE VENSTER, sleutelbeeld, OPEN Range-verzoek, Het videobeeld, Chrome laadt, BEELD-NOODKNOPPEN, ZAALBEELD, Beeldverhouding |
| Vormlagen (`?vormen=1`) | Bekende grenzen: VORMLAGEN |
| Opnemen, handelingenlog, terugspelen | Bekende grenzen: Opnemen tapt, Met video erbij, HANDELINGENLOG; De server mag even weg zijn |
| Server, ingest, uploads, library, hotcues, backup | Bekende grenzen: Verbeterronde 23 september, Eigen bestanden, TikTok, INGEST-WACHTRIJ, LIBRARY, Hotcues, BACKUP, RANDGEVALLEN, OVERAL OPENEN; Waar media/ staat; De server mag even weg zijn |
| Categorieën en tags | Categorieën en tags in de library (S11) |
| Auto-DJ, planvenster, sets | Auto-DJ; Het planvenster; Een set klaarzetten, live bijmixen, sets (S9) |
| Klankschaal, instrumenten, patronen | Klankschaal; Instrumenten op een track; Patronen |
| Stems, stemkanalen, koptelefoon, master | Stems; Stemkanalen; Koptelefoon; Master en limiter |
| Xboard49, Maschine | Xboard49 en Maschine via de hub |
| Secties | Secties |
| Stroommachine (beeld) | Beeld: de Stroommachine |
| Worklets, AudioContext bewaken | Audio-gezondheid |
| Avondpakket | Het avondpakket per platform |
| Werkruimte, iPad/iPhone, panelen | Werkruimte: aanhaakpunten (S0); Werkruimte (S0–S8) |
| Waarom streamen, keylock-keuze | Onderzochte keuzes |

## Werkwijze die hier werkt

- Eén fase per keer. Maak fase N af en laat hem draaien voordat fase N+1 begint.
- Bij een keuze met gevolgen: benoem de trade-off en kies, wacht niet op goedkeuring.
- Meld het expliciet als iets een aanname is die verkeerd kan zijn.
- Geen features bouwen die niet gevraagd zijn, ook niet als ze voor de hand liggen.
- Niets verwijderen (Clay): geen data, geen takken, geen bestanden van een ander; ordenen door
  verplaatsen. Een backup wordt nooit met `--delete` gesynchroniseerd (docs/BACKUP.md §5).
