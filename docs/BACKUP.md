# Back-up en herstel van het hele instrument

*11 oktober 2026, tak `visie/backup-kopie` (PR #28); bijgewerkt 15 okt op `studio/backup-instellingen`,
samen met de instrument-sleutels op de server (PR #31) en na de werkruimte (#42). Achtergrond:
`docs/VISIE.md` (de draagbare set) en de uitwerking van 10/11 okt §4b.3 (mini-spoor 3, `docs/verslagen/2026-10-10/UITWERKING.md`). Dit document gaat over de DATA
van het instrument, niet over de code (die staat op GitHub). De uurlijkse kopie van de library door
de server zelf staat in `docs/LIBRARY.md` "Backup"; die blijft zoals hij is.*

*De keuzecodes BK1–BK6 komen uit het backup-ontwerp van 11 okt (daar B1–B6); hernoemd zodat ze
niet botsen met blok B (de APC, B1–B4) in `docs/VRAGEN.md`.*

## 1. Waarom: iCloud is geen backup

Op 11 okt stond er **nul** kopieën van de data buiten deze laptop: geen Time Machine, geen
externe schijf, geen launchd. Alleen iCloud, en iCloud is synchronisatie:

- het synchroniseert ook wissen (een per ongeluk gewiste map is binnen seconden overal weg; 30 dagen
  "onlangs verwijderd" is de enige rem);
- het plaatst bestanden uit ("Optimaliseer Mac-opslag" staat aan) en kent geen versies;
- het zet `library.db`, `-wal` en `-shm` op verschillende momenten over, en dan klopt de set
  onderling niet (§2).

Wat Clay zelf instelde is klein (~16–20 MB): de library, patronen, plannen, racks, mappings, de
speellijst, 27 handelingenlogs, de hub-staat en de kaart. Daarnaast ~32 GB media (herbouwbaar, met
uren en alleen als YouTube ze nog heeft) en ~0,6 GB opnames (niet herbouwbaar).

## 2. De WAL-les: kopieer `library.db` NOOIT als bestand

De library draait in WAL-modus. Wat net bewaard is staat vaak alleen in `library.db-wal`, niet in
`library.db`. Gemeten op 11 okt, op kopieën (extra-3 §1.5):

| Kopie | tracks | hotcues | racks | pads | grid op slot | kolom `secties_json` | quick_check |
|---|---|---|---|---|---|---|---|
| live `library.db` + `-wal` | 15 | 15 | 1 | 6 | 2 | ja | ok |
| **alleen `library.db` (266 KB, van 6 okt)** | **14** | **14** | 1 | **3** | 2 | **nee** | **ok** |
| `VACUUM INTO` (server-backup van 8 okt) | 15 | 15 | 1 | 6 | 2 | ja | ok |

De gewone bestandskopie mist één nummer, één hotcue, drie sampler-pads, twee stems-sets en zelfs
de v9-migratie, en `quick_check` zegt tóch "ok": een onvolledige kopie ziet er gezond uit. Daarom
gebruikt `kopie.mjs` dezelfde `VACUUM INTO` als de server (`server/backup.js`: een eigen
alleen-lezen verbinding in een worker, fsync, quick_check). Ook met de hand: `sqlite3 library.db
"VACUUM INTO '<doel>/library.db'"`, nooit `cp`. `test/backup-kopie.test.mjs` houdt deze fout vast.

## 3. Wat er gebouwd is

| | |
|---|---|
| `tools/backup/kopie.mjs --doel <map>` | maakt `<map>/varve/staat/` (set A) en met `--media` ook `<map>/varve/media/` en `opnames/` (set B) |
| `tools/backup/controleer.mjs --doel <map>` | is de kopie heel (manifest, SHA-256, quick_check, tellingen), is hij bij (tellingen naast de library van nu), heeft set B elk nummer? |
| `tools/backup/herstel.mjs --van <map>/varve --naar <checkout>` | zet set A terug; weigert als er al een `library.db` staat; overschrijft nooit iets |
| `tools/backup/launchd/` | `maak.sh` + sjabloon + `dagelijks.sh`: elke ochtend 08:00 set A. **Standaard niet geïnstalleerd** (§6) |

Alle drie lezen dezelfde `VARVE_*`-variabelen als de server (en zonder `VARVE_MEDIA` ook
`~/.varve/media-pad`, zoals VARVE.app; §5) en werken standaard op de checkout waar ze in staan; `--bron <checkout>` (kopie, controleer) leest een andere. Geen server nodig; ze
mogen draaien terwijl de server draait (in WAL blokkeert een lezer geen schrijver). Geen
dependency: node, sqlite (`node:sqlite`) en rsync.

### Set A "staat" (klein, dagelijks en vóór elke reis)

```
<doel>/varve/staat/
  MANIFEST.json            wanneer, host, commit, tellingen (nummers, hotcues, racks, pads, grids
                           op slot, stems, secties, schema), per bestand bytes en SHA-256
  library.db, kaart.db     VACUUM INTO-kopie: één bestand, journal-modus, quick_check ok. In
                           library.db zit ook de tabel instellingen: de mapping (ook per apparaat),
                           de browser-sleutels van het instrument (PR #31: master-rack, klankschaal,
                           poorten, beeld, stems, cue-wissel, vormen, bus-racks) en de snel-tags;
                           en de tags en categorieën (S11)
  nacht.json, stems-rij.json, paneel-apparaten.json               ← naast de library / in media/
  uitzend/doelen.json      ← <checkout>/uitzend/ (niet in git; zonder bestand de ingebouwde doelen)
  patronen/ plannen/ proef/ standen/ sets/ werkruimtes/ racks/ mappings/ Input/   met hun .versies/
                           (sets/ = VARVE_SETS, werkruimtes/ = VARVE_WERKRUIMTES; racks/ met eigen.json)
  sjablonen/eigen.json     alleen als VARVE_SJABLONEN de eigen sjablonen buiten racks/ legt
  handelingen/set-*.acties.jsonl                                  ← opnames/ (alleen de logs)
  hub/staat.json           ← ~/.varve-hub/staat.json (of $VARVE_HUB_STAAT)
  kaart/varve-kaart.json   ← VARVE_KAART, de instelling kaart_pad, of ~/Desktop/3. Resources/Data/Muziekkaart/
  versies/library-<stempel>.db, kaart-<stempel>.db, MANIFEST-<stempel>.json
  .vorige/<stempel>/…      wat in de kopie anders was dan in de bron, vóór het vervangen
```

Een map of bestand dat in de bron ontbreekt wordt overgeslagen en staat in het manifest onder
`ontbreekt` (bv. `uitzend/doelen.json` zolang je geen eigen doelen hebt). `.DS_Store` gaat niet mee; conflictkopieën
("… 2") wel: ook dat is data.

### Set B "media" (groot, vóór elke reis en na een nacht-run of opname)

`kopie.mjs --media` draait `rsync -a --backup --backup-dir=<doel>/varve/.vorige/<stempel>/…` van
`media/` naar `<doel>/varve/media/` en van `opnames/` naar `<doel>/varve/opnames/`. **Zonder
`--delete`.** `library.db*` en `kaart.db*` gaan daar niet als bestand mee (§2: die staan goed in
set A), lopend ingest-werk (`.bezig-*`) ook niet; `media/backups/` (de VACUUM-kopieën van de
server) wel. Set B is tegelijk de reiskopie: op reis kan `VARVE_MEDIA` naar de SSD wijzen.

### Chrome: wat erin zit en wat niet

De sleutels die het instrument zijn (`varve.master.rack`, `varve.klankschaal`, `varve.midi.ports`,
`varve.beeld.adres/.latentie/.aan`, `varve.stems.standaard`, `varve.koptelefoon.omgewisseld`,
`varve.vormen`, en sinds 15 okt `varve.send.a.rack`/`.b.rack`) staan sinds PR #31 (keuze BK4) ook
op de server, in de tabel `instellingen` van `library.db`, en gaan dus mee in set A. Het manifest
telt ze (`instrument`). Een nieuw Chrome-profiel krijgt ze bij de eerste start van de server terug
(`docs/LIBRARY.md` "De zeven browser-instellingen op de server"). Let op: wat je in Chrome
instelde vóór de eerste start van een server mét PR #31, gaat pas bij die start omhoog.

### Wat er NIET in zit (nog)

- **Gemak in Chrome**: panelen open/dicht, sorteringen, de gekozen werkruimte per scherm
  (`varve.werkruimte`), de schermplek van vensters, de pins van de companion. Bewust per browser
  (LIBRARY.md); na een herstel even opnieuw kiezen.
- **De track-scènes van de Stroommachine** (op de pc, in de browser): alleen via haar knop
  "Track-scènes als JSON" (handwerk, BK6). Leg zo'n export in `<doel>/varve/staat/beeld/`; herstel
  meldt hem dan.
- **De bronnen van de muziekkaart** (`~/Desktop/3. Resources/Data/`, de exports) en de code van de
  muziekkaart (geen remote; BK5). De kaart zelf (`varve-kaart.json`) gaat wel mee.
- De sets van de AV-app-hub (`~/Projects/AV-app-hub/sets/`): die staan in de git van de hub. De
  hub-staat (`~/.varve-hub/staat.json`) gaat wel mee.
- De code: die staat op GitHub.

## 4. De herstelprocedure

1. **Code**: `git clone git@github.com:CKrebbers/youtube-mixer.git` (+ AV-app-hub, stroommachine,
   maschine-lab, av-kern, en na BK5 de muziekkaart). 1 minuut.
2. **Gereedschap**: node, ffmpeg, yt-dlp, de Demucs-venv (`docs/STEMS.md`), Tailscale. ~30 min
   (schatting; niet gemeten).
3. **Set A**: `node tools/backup/herstel.mjs --van /Volumes/<SSD>/varve --naar <checkout>`.
   Zonder tool kan het ook met de Finder: `staat/library.db` → `media/library.db` (zonder -wal/-shm:
   de kopie is al in journal-modus), `kaart.db`, `nacht.json` en `stems-rij.json` ernaast, de mappen
   op hun plek, `paneel-apparaten.json` → `media/`, `uitzend/doelen.json` → `uitzend/`,
   `handelingen/*` → `opnames/`, `hub/staat.json` → `~/.varve-hub/`,
   `kaart/varve-kaart.json` → `~/Desktop/3. Resources/Data/Muziekkaart/`. 1 minuut.
   `herstel.mjs` weigert als er al een `library.db` (of een `-wal`, `-shm` of `-journal`) staat,
   of een losse `kaart.db-wal`/`-shm`/`-journal` zonder `kaart.db` (SQLite zou die op het
   teruggezette bestand toepassen): eerst zelf opzij zetten (`docs/LIBRARY.md` "Terugzetten").
   Andere bestanden die er al staan blijven staan; is er een anders dan in de kopie, dan zegt hij
   dat en kies je zelf. Let op: herstel zet ook bestanden terug die sinds de kopie bewust uit de
   bron verdwenen zijn (ze blijven in `staat/` en staan in het manifest, §5); haal die daarna zelf
   weer weg.
4. **Set B**: `rsync -a /Volumes/<SSD>/varve/media/ <checkout>/media/` (of `VARVE_MEDIA` naar de SSD
   laten wijzen en later verhuizen); `opnames/` idem. Minuten (niet gemeten). Zonder set B: de
   server start gewoon, de library kent de nummers, `library compleet` wordt rood, en elk nummer is
   opnieuw binnen te halen vanuit `tracks.url` (plus Demucs). Uren; alleen op een niet-speeldag.
5. **Server starten** (VARVE.app of `node server/index.js`): de schema-migratie gebeurt vanzelf als
   de kopie ouder is dan de code (`SCHEMA` in `library.js`); andersom (nieuwere kopie, oudere code)
   niet — dus de code altijd eerst bijwerken.
6. **Chrome**: niets voor het instrument: de browser-sleutels zitten in `library.db` en de mixer
   haalt ze bij de eerste start op (`herstel.mjs` zegt hoeveel er in de kopie staan). Een kopie
   van vóór PR #31 heeft ze niet: dan master-rack, klankschaal, MIDI-poorten, beeld-adres,
   stems-standaard, cue-wissel en vormen-vlag opnieuw instellen. Gemak (panelen, sortering,
   werkruimte per scherm) altijd opnieuw.
7. **Beeld**: op de pc de Stroommachine → Live → "Importeer track-scènes" met
   `staat/beeld/track-scenes-<datum>.json` (als die er is).
8. **Controle**: `node tools/backup/controleer.mjs --doel /Volumes/<SSD> --bron <checkout>` en de
   Controlekamer: tegel Backup groen.

Gemeten (11 okt, extra-3 §1.6): een verse worktree met een hersteldataset van 85 MB → server op in
~1 s, 15/15 nummers, mapping, samples, patronen, plan, 27 logs. Herhaal die proef elk kwartaal
(10 min): een backup die nooit hersteld is, is geen backup.

## 5. Nooit iets weggooien

- Een backup wordt **nooit met `--delete` gesynchroniseerd** (ook niet met de hand): wat in de bron
  verdween, per ongeluk of niet, blijft in de kopie staan. `test/backup-kopie.test.mjs` controleert
  dat `kopie.mjs` rsync zonder `--delete` aanroept.
- Wat in de kopie anders is dan in de bron, gaat eerst naar `.vorige/<stempel>/` en wordt pas dan
  vervangen (set A door `kopie.mjs` zelf, set B door rsync's `--backup-dir`).
- Elke run met een andere library voegt een versie toe in `versies/`; dezelfde inhoud (SHA-256)
  geeft geen nieuwe versie. Elke run bewaart zijn manifest als `versies/MANIFEST-<stempel>.json`.
- Er wordt **niets automatisch opgeruimd** in het doel (anders dan `media/backups/` van de server,
  12 + 30 dagen). Set A groeit ~0,3 MB per gewijzigde dag: ~100 MB per jaar. Opruimen is altijd
  handwerk van Clay.
- De bron wordt alleen gelezen. Een doel binnen de bron weigert `kopie.mjs` (een backup in
  `media/` gaat mee de prullenbak in, en `--media` zou `media/` elke run dieper in zichzelf
  kopiëren). Hij vergelijkt de echte paden (symlinks opgelost), van de checkout, `media/`,
  `opnames/`, de map van de library en elke map van set A: een symlink of een alias-pad (iCloud
  `…/com~apple~CloudDocs/Desktop` → `~/Desktop`) komt er niet langs.
- Welke library: dezelfde als de server (`server/index.js`, `kiesMedia` in `server/media-plek.js`,
  dat `gedeeld.mjs` importeert): `VARVE_DB`, anders `<media>/library.db`. Media = `VARVE_MEDIA`;
  anders `~/.varve/media-pad` (zoals VARVE.app de server start: launchd heeft geen `VARVE_MEDIA`);
  anders `<checkout>/media`, of (na de verhuizing VI2) het pad uit `media-VERHUISD.txt`. Een
  testomgeving (`VARVE_TESTSERVER=1`) leest het media-pad en het briefje nooit. Paden zonder slash
  aan het eind (`/x/media/` = `/x/media`). Ligt er daarnaast nog een `<checkout>/media/library.db`
  (die een server zonder `VARVE_MEDIA` zou pakken), dan gaat de gekozen mee en zegt hij "LET OP
  er staan twee libraries … zet VARVE_DB" (kopie, controleer, herstel). Het manifest noemt de
  library en de media (`library_pad`, `media.via`).
- Eén run tegelijk per doel: een slot in `staat/.werk/slot` (pid, host, tijd). Een tweede run
  (launchd om 08:00 en een run met de hand) zegt "er loopt al een kopie" en stopt (exit 2). Een
  slot van een proces dat niet meer leeft gaat opzij naar `.werk/slot-<tijd>`.
- Een doel op dezelfde schijf als de bron weigert hij ook, tenzij `--zelfde-schijf`: dat is een
  extra versie, geen backup buiten de laptop. Het manifest en de stempel zeggen het dan
  (`zelfdeSchijf: true`).

## 6. Hoe vaak, en automatisch

| | Set A | Set B |
|---|---|---|
| automatisch | dagelijks 08:00 via launchd (na het nachtvenster 01–07, vóór een speeldag begint); overslaan met één logregel als het doel er niet is | niet (32 GB; de SSD hangt er niet altijd) |
| met de hand | vóór vertrek, en na een sessie met veel handwerk | vóór elke reis; na een nacht-run of opname |

**launchd (standaard NIET geïnstalleerd).** Vanuit de echte checkout (de plist wijst naar het
`dagelijks.sh` van de checkout waar je hem maakt):

```
zsh tools/backup/launchd/maak.sh --doel /Volumes/<SSD>               # laat alleen de plist zien
zsh tools/backup/launchd/maak.sh --doel /Volumes/<SSD> --installeer  # zet hem in ~/Library/LaunchAgents
```

`--installeer` weigert als er al een `nl.varve.backup.plist` staat. Stoppen: `launchctl bootout
gui/$UID/nl.varve.backup` en de plist zelf opzij zetten. Log: `~/.varve-backup.log`. Is het doel
een git-repo (de privé-repo `varve-staat`, keuze BK1), dan doet `dagelijks.sh` daarna `git add -A
-- varve/staat`, commit en push. Zo'n repo bevat titels, YouTube-id's en luistergeschiedenis:
**altijd privé**, nooit in `AV-app-hub` (publiek), en nooit `media/` of `muziekkaart.db` erin.

**Het avondpakket.** `kopie.mjs` schrijft na elke run `~/.varve/backup-laatste.json`
(`{ doel, tijd, setA, setB, bytes, zelfdeSchijf, tracks, host }`). Het punt "backup" van het
avondpakket (sinds 11 okt in main, `docs/AVONDPAKKET.md`) kan daar "kopie buiten de laptop: n dagen
geleden" uit halen (groen ≤ 1 dag, oranje ≤ 7, rood ouder of nooit; `zelfdeSchijf` telt niet als
buiten de laptop). Nog niet gebouwd: dat is de sonde "reiskopie" (AVONDPAKKET.md §13 punt 10), een
kleine eigen PR.

## 7. Getest en niet getest

**Getest** (`test/backup-kopie.test.mjs`, in `node test/alles.mjs`): rijen die nog in de WAL staan
komen mee (en een gewone bestandskopie mist ze); de tellingen in het manifest; `.versies/` mee,
alleen de logs uit `opnames/`, geen `.DS_Store`; een tweede run zonder wijziging: geen versie erbij
en niets weg; een run na een wijziging: een versie erbij, een in de bron verdwenen bestand blijft,
het oude van een veranderd bestand staat in `.vorige/`; versies sorteren op tijd (`…_33-2.db` ná
`…_33.db`); een tweede run tegelijk stopt op het slot, een slot van een dood proces gaat opzij;
`--droog` schrijft niets (geen doel, geen stempel, bron ongewijzigd); zelfde schijf, een doel binnen
de bron (ook via een symlink), een `/Volumes/<x>` die er niet is en geen library = exit 2; welke
library (`media-VERHUISD.txt`, `~/.varve/media-pad`, `VARVE_MEDIA` gaat voor, een testomgeving leest
geen media-pad, `VARVE_DB`, twee libraries = de gekozen plus LET OP, een slash aan het eind);
sets/, werkruimtes/, `racks/eigen.json`, `paneel-apparaten.json`, `uitzend/doelen.json` en de
instrument-sleutels in `library.db` gaan mee en komen terug; `--overslaan-zonder-doel`; `--media` met
een nep-rsync via `PATH` (altijd `-a`, nooit `--delete`, de databases uitgesloten,
`--backup-dir`); controleer (alles ok, nummers nieuwer dan de kopie, nummers zonder media-kopie, een
veranderd bestand = NIET OK); herstel (`--droog`, terugzetten, een ander bestand niet
overschreven, weigeren bij een bestaande `library.db`, alleen een `-wal`, een losse
`library.db-journal` of een losse `kaart.db-wal`).

Niet als test: twee runs na elkaar in dezelfde seconde (de stempel krijgt dan `-2`; de code staat
er, maar zonder nepklok is dat niet betrouwbaar te toetsen).

Met de hand, 15 okt (`studio/backup-instellingen`): kopie, controleer en herstel naar een lege map
op tijdelijke kopieën van een library (`VARVE_*` naar `/private/tmp/…`), met sets, werkruimtes en
instrument-sleutels; nooit de echte library als bron met een echte plek.

Met de hand, 11 okt: `kopie.mjs --droog` tegen de echte checkout (alleen lezen), één echte run naar
`~/Backups/varve-staat --zelfde-schijf`, `controleer.mjs` daarop, en een herstel in een tijdelijke
map (zie het verslag van de bouwer). `dagelijks.sh` tegen een tijdelijke library en een tijdelijke
git-repo met een kale remote (overslaan zonder doel; commit en push). `maak.sh` zonder
`--installeer` (de plist is geldig volgens `plutil -lint`).

**Niet getest:** rsync naar een echte externe SSD (er is er geen), de duur van 32 GB, launchd zelf
(niet geïnstalleerd; of een LaunchAgent zonder Volledige schijftoegang bij `~/Desktop` mag, is
**niet** gemeten — macOS kan dat weigeren), een push naar een echte GitHub-repo, Chrome, de
Stroommachine-export, herstel van de hub-staat met een draaiende hub.
