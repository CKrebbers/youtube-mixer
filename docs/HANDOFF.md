# Overdracht — waar we staan (5 oktober 2026)

Lees in deze volgorde:
1. `CLAUDE.md`: architectuur, regels, valkuilen. Nieuw sinds 25 sep: transport,
   rem, EQ-kill, maatgever met hysterese, hoorbaar.js, overgangen als hellingen,
   het losse venster dat zelf mengt, handelingenlog, library, ingest-wachtrij,
   mapping als verschil, vormen 16:9, toonsoort.
2. Dit bestand.
3. `ROADMAP.md`: bovenaan staat DE TAKENLIJST OP VOLGORDE.
4. `docs/VRAGEN.md`: open vragen, nieuw zijn blok S (studio) en N (stems).
5. Per onderdeel: `docs/TOONSOORT.md` (§13), `MAPPING-VERSCHIL.md`, `LIBRARY.md`,
   `BEAMER.md`, `HANDELINGENLOG.md`, `AUDIOPAD.md`, `VORMEN-16x9.md`,
   `BEATGRID.md` (restpunten), `APC40.md`.
6. Details van 25 sep (metingen, afwegingen, waarom iets niet hersteld is):
   `docs/verslagen/2026-09-25/` (README = index per spoor).

## 5 OKT (middag): STUDIO S2 EN S3 GEBOUWD, OP `studio/integratie`

Clay: "headphone level is cue level rotary knob. yes instruments can be mapped on 1 of the 8
channels. try to do everything you can to make the app work the way it should". Gebouwd in
parallelle sporen (elk een worktree in `~/Projects/varve-stems/`), samengevoegd op
`studio/integratie` (gepusht), elk met tests en metingen in headless Chrome:
- Cue Level = koptelefoonvolume, shift = mix (PR #4, `studio/koptelefoon`).
- S2: master-insert + limiter (`docs/MASTER.md`), stemkanalen + grid-modus STEMS
  (`docs/STEMS.md` §5), tien effecten uit de filter app (`docs/EFFECTEN.md`).
- S3: instrumenten op een track: Poly, FM, Schaal, Drums (`docs/INSTRUMENTEN.md`), noten van
  een keyboard (`src/control/noten.js`), INSTRUMENT-rij, APC-mapje inst.
- De hub-koppeling van 3 okt (de patches uit AV-app-hub) als commits (`studio/hub`, erin).
- AV-app-hub PR #11 (Xboard49 + Maschine MK2, CI groen) gemerged.
- Twee fouten in de delay hersteld (inloop, achterhaalde wachtende tijd); de cue in de
  koptelefoon schuift mee met de vooruitblik van de limiter.
- `node test/alles.mjs` op de integratietak: groen (tijdmetingen onder zware belasting
  los opnieuw gedraaid: klankschaal-rekentijd en gridauto groen).
- S4 patronen (`docs/PATRONEN.md`), samengevoegd: grid-modus PATRONEN op Shift + scene 2
  (oranje), want Shift + scene 3 (zeegroen) was al stems.
- **In de maak:** Xboard/Maschine via de hub in Varve (`studio/speelapparaten`), met de
  Maschine-stapmodus op de patronen.
- **Eerst doen (Clay):** zie hieronder (PR's, iCloud, samengesteld apparaat), dan de
  speellijst; open vragen: VRAGEN blok S (S3–S14).

## 5 OKT: HET STUDIOPLAN EN DE KOPTELEFOON (docs/STUDIO.md)

Clay: een nieuw soort muziekprogramma (stems mixen, effecten op het geheel en per stem,
stukken programmeren, synths spelen en programmeren, alles voorbeluisteren), met de APC40,
LPD8, Maschine MK2 en Xboard49, en hergebruik van wat er al is. Besluit: VARVE groeit
uit (STUDIO.md §0, ST1–ST5; ROADMAP 27).
- STEMS: de zes `stems/*`-takken gepusht; de losse fix uit de stems-worktree gecommit
  (696ac4b); `origin/main` (de cloudsessies van 2 okt) samengevoegd in `stems/integratie`
  (c0a9930: elf botsingen, overal beide kanten gehouden). PR #3 naar `main` is schoon:
  42 bestanden, 4165 checks groen.
- KOPTELEFOON (S1) op de tak `studio/koptelefoon` (worktree `~/Projects/varve-stems/studio`):
  `src/engine/koptelefoon.js`, ● zonder shift = cue, de KOPTELEFOON-rij, blok Koptelefoon in
  de speellijst. Gemeten in headless Chrome (`tools/headless/koptelefoon.mjs`: de echte engine
  op een OfflineAudioContext van vier kanalen). **Niet gehoord** op het samengestelde apparaat.
- **Eerst doen (Clay):**
  1. PR #3 mergen, daarna de PR van de koptelefoon.
  2. De repo uit iCloud (Claude's auto-modus weigerde de verhuizing als onomkeerbaar).
     Mixer en server dicht, dan:
     ```
     [ -L ~/Projects/"Youtube mixer" ] && rm ~/Projects/"Youtube mixer"   # alleen de snelkoppeling
     mv ~/Desktop/"1. Projects/Youtube mixer" ~/Projects/"Youtube mixer"
     cd ~/Projects/"Youtube mixer" && git worktree repair ~/Projects/varve-stems/*
     mkdir -p ~/.claude/projects/-Users-claykrebbers-Projects-Youtube-mixer
     cp -R ~/.claude/projects/-Users-claykrebbers-Desktop-1--Projects-Youtube-mixer/memory \
           ~/.claude/projects/-Users-claykrebbers-Projects-Youtube-mixer/
     ```
     Daarna de Git-regel in CLAUDE.md ("de repo staat op het Bureaublad (iCloud)") bijwerken.
  3. Het samengestelde apparaat maken (STUDIO.md §3) en het blok Koptelefoon in de speellijst.

## 3 OKT: STEMS GEBOUWD (docs/STEMS.md)

Clay: "de proefstems waren goed, bouw met meerdere subagenten tegelijk aan de stem
splitter in varve dj". Gebouwd in drie parallelle sporen (server, engine, ui) op
een gedeeld contract, elk in een worktree buiten iCloud (`~/Projects/varve-stems/`),
daarna samengevoegd op `stems/integratie`, nagelopen door een reviewer en een
end-to-end-controle met de echte Demucs. Op 5 okt gepusht en als PR #3 naar `main`
(na het samenvoegen met de cloudsessies van 2 okt).

- NIEUW: `server/stems.js`, `server/stems/splits.py`, `src/ui/stems-paneel.js`,
  `stems-wachtrij.js`, `stems-weergave.js`, `test/stems.test.mjs`,
  `test/nep-stems.mjs`, `tools/headless/stems.mjs`, `tools/stems/vergelijk.py`,
  `docs/STEMS.md`, verslagen in `docs/verslagen/2026-10-03/`.
- GEWIJZIGD: streamkern/worklet/StreamBron (2, 4 of 8 kanalen), deck en
  kanaalstrip (`stemIn`), actions (`track.N.stem.*`), auto-DJ (`OVERNEEM`),
  handelingenlog (stem-kills in de beginstand), server (routes, schema v8,
  ingest met `stems`), library-kolom, ingest-strook, Controlekamer, CLAUDE.md,
  ROADMAP 17, VRAGEN blok N, AUDIOPAD, LIBRARY, CONTROLEKAMER, tools/README.
- Python met Demucs staat in `~/.varve/stems-venv` (buiten de repo); het model
  in `~/.cache/huggingface/hub/`.
- De server is herstart (nieuwe routes, schema v8 migreert bij de eerste start).
- **Eerst doen (Clay)**: de mixer herladen; in de library bij een nummer op **2**
  klikken (of iets nieuws binnenhalen, standaard 2 stems); als de kolom `2` zegt
  het nummer laden, knop **stems** in de balk, zang weg/terug. Dan VRAGEN N
  (vooral N1: waar op de APC, en N2: luister naar zang weg).

## 3 OKT: AV-APP-HUB (cloudsessie, CLAUDE.md AV-APP-HUB, repo AV-app-hub)

VARVE als LEASE-app van de AV-app-hub, alleen met de vlag. Openen: hub starten
(`varve-hub start` in de AV-app-hub), dan `http://localhost:8777/?hub=ws://localhost:7700/app`.
Zonder vlag is alles zoals het was (hub.js wordt niet eens geladen).
- **Headless groen** (`node tools/headless/hub.mjs`, `VARVE_HUB_REPO`): toetsApp
  van de hub (conform PROTOCOL.md), nooit requestMIDIAccess (ook niet de APC-kaart),
  de echte hub met nep-APC/LPD8: APC-masterfader → master, K1 laat master staan
  (andere app met intensiteit eerst), K2 → video-master, P1 (paniek) → beeld zwart
  en los, twee hub-tabbladen: het oude meldt "vervangen". `test/hub.test.mjs`:
  hartslag ook in een verborgen tabblad (timers 1×/s en 1×/min), herverbinden.
- **NIET getest:** Clay's echte APC en LPD8 via de hub (LED's, ringen, mapjes,
  leren); twee echte tabbladen in Chrome; het gevoel van K2/K4 en P1 midden in
  een set; een gepauzeerde VARVE langer dan 5 min in een verborgen tabblad (de
  hartslag hangt dan aan de adem van de hub: nagebouwd, niet in Chrome gezien).
- **Open voor Clay:** VRAGEN O1 (K1 in VARVE?) en O2 (Bank: keylock of hubtoets).

## 2 OKT (laat): DE KLEINE VEILIGE PUNTEN GEBOUWD (cloudsessie)

Clay: "begin met de kleine veilige punten" (stap 1 van docs/ONTBREEKT.md). Vijf
agenten in eigen worktrees, daarna samengevoegd op `claude/ecstatic-feynman-sm6x58`:
- **A4 beeld-noodknoppen** (`src/video/eindbeeld.js`): zwart, zwart vasthouden,
  bevriezen, master, flits; ook in het losse venster en de opname. APC: de
  master-knop = zwart in elk mapje; modus video rechts de vier. Gemeten in headless
  Chromium (pixels, fade-tijden), niet in Clay's Chrome met een beamer.
- **A6 backup** (`server/backup.js`): VACUUM INTO in een worker, bij opstarten en
  elk uur als er iets veranderde, 12 + 30 dagen, `media/backups/`; tegel Backup
  in de Controlekamer. **De server moet herstarten** (nieuwe route `/api/backups`).
- **A7 vloeiende fades** in de auto-DJ (`*.glide`-actions, `Deck.glide`, hellingen
  op de audioklok). Headless gemeten; **niet beluisterd**.
- **A8 modus auto** op de APC (Shift + scene 4): ok, overslaan, langer, nu, aan/uit.
- **A9** hotcue vlak na laden, rem-gat, syncMaster-terugval, gate zonder maat.
Tests: 41 bestanden, 3845 checks; `ingest.test` groen met yt-dlp, `wachtrij.test`
rood in de cloudcontainer (weesprocessen; was vóór dit werk al zo). De speellijst
van de Controlekamer heeft 7 punten erbij (auto-APC, glad, zwart, nood, hotcue,
gate, backup). Eerst doen (Clay): `git pull`, server herstarten, mixer herladen,
de nieuwe punten in de speellijst.

## 2 OKT (avond): WAT ER NOG ONTBREEKT (cloudsessie, docs/ONTBREEKT.md)

Drie agenten: open punten in de eigen docs (tegen de code), vergelijking met
rekordbox/Traktor/Serato/Mixxx/VirtualDJ, koppeling met Logic en TouchDesigner.
49 punten in vier groepen (standalone-nodig, later, Logic/TD, niet), een
voorstel voor de volgorde en zeven vragen. Wacht op Clay's keuzes. Kernfeit voor
later: Logic volgt geen MIDI clock, wel Ableton Link (via Carabiner, GPL los).

## 2 OKT (avond): OVERAL OPENEN VIA TAILSCALE (cloudsessie)

Clay wilde VARVE "overal altijd" kunnen openen. Na uitleg (geen openbare server:
distributie van YouTube-media, geen login, yt-dlp geblokkeerd op datacenters)
koos hij Tailscale met de server op de Mac. Gebouwd: `VARVE_HOSTS` in
`server/index.js` (`vreemdVerzoek`), checks in `server.test.mjs` (falen op de
oude code), `docs/TAILSCALE.md`. **Niet getest met een echte Tailscale.**
Eerst doen (Clay): de stappen in `docs/TAILSCALE.md`, server herstarten met
`VARVE_HOSTS`. Op de Mac zelf localhost blijven gebruiken.

## 2 OKT: ALLES GETEST, LAYOUT, CONTROLEKAMER (vanaf de Omarchy-machine)

Clay: VARVE wordt het overkoepelende AV-project; eerst standalone helemaal
kloppend, daarna Logic en TouchDesigner. Er is budget tot zo 4 okt 12:00 en dan
nog één volle week (t/m 11 okt).

- **Getest** (alles wat zonder Clay kan): `alles.mjs` groen op de Mac (na
  `brew install yt-dlp`: die was weg sinds de opruiming van 30 sep), op Linux
  alleen de bekende timer in vormen-isomorf. Headless 11/11 groen op een kopie;
  `beamer.mjs` op de Mac groen (één keer 18,8 ms tegen 17, daarna 3,8 ms).
- **Gecommit**: `a59f548` (het werk van 26-30 sep: VRAGEN J, klankschaal,
  auto-DJ, planvenster) en `649b555` (laptopmaat).
- **Laptopmaat** (`649b555`): op de MacBook (1440x790 in Chrome) vielen de
  faders eraf. Nu: sampler onderin het focusdeel, pitch in de kopregel, de
  fader krimpt in plaats van te verdwijnen. Terugweg: `~/.varve-voor-layout-2okt/`.
- **Controlekamer** (`docs/CONTROLEKAMER.md`): `localhost:8777/controle`. Stand
  van alles, de mixer openen (nooit twee), en de speellijst van de proefsessie
  (33 punten). **De uitkomst van een sessie staat in `proef/sessie.json`: lees
  die eerst.** De server moest herstarten (nieuwe routes).
- **Niet gedaan, wacht op Clay**: VARVE uit iCloud halen. iCloud maakt bij
  bijna elke schrijfactie in deze map een conflictkopie (`index 2.html`,
  `styles 2.css`, `test/regels.test 2.mjs` op 2 okt: alle drie de oude versie,
  nooit committen). Maar volgens de opruimregel van 2 okt (Mac-geheugen
  `mappenstructuur`, er is geen Time Machine) gaat code pas uit iCloud als hij
  gepusht is, en hier is nog geen GitHub-repo, en media/opnames (4,3 GB) staan
  niet in git.
- **Eerst doen (Clay)**: de mixer herladen, `localhost:8777/controle` openen,
  de speellijst spelen.

## 30 SEP (avond): PLANVENSTER FASE 1 (docs/PLAN.md)

Clay: een pagina met de hele programmering, helemaal in te richten, en er live
mee spelen. Onderzocht met vier agenten; Clay koos "fase 1, apart venster".

- NIEUW: `plan.html`, `src/plan/plan-model.js`, `src/plan/tijdlijn.js`,
  `src/plan/plan-venster.js`, `src/ui/plan-koppeling.js`, `server/plannen.js`,
  `test/plan.test.mjs`, `tools/headless/plan.mjs`, `docs/PLAN.md`.
- GEWIJZIGD: `automaat.js` (stap-id's, vervangPlan, geschiedenis),
  `planner.js` (eigen overgangslengte), `server/index.js` (/api/plannen,
  plan.html, VARVE_PLANNEN; de server moest herstarten), `app.js`,
  `index.html` (knop plan), `plannen/auto-plan.json` (omgezet naar v2, door
  Claude), `auto.test`, `server.test`, CLAUDE.md, AUTO-DJ.md, VRAGEN blok M.
- Getest: alles groen behalve de bekende tijdmeting; headless het hele
  venster (bewerken, opslaan, live, Claude's wijziging, botsing).
- Eerst doen: mixer herladen, "plan" klikken, het venster naar het tweede
  scherm, auto aanzetten vanuit het venster. Dan VRAGEN M.

## 30 SEP: AUTO-DJ FASE 1 (vanaf de Omarchy-machine, docs/AUTO-DJ.md)

Clay wil een auto-DJ als basis van het programma: de app kiest en mixt zelf (en
klinkt altijd), Clay stuurt bij, Claude schrijft het setplan. Eerst onderzocht
met vier agenten, toen gebouwd ("laten we het gewoon gaan proberen").

- NIEUW: `src/auto/planner.js`, `src/auto/automaat.js`, `src/ui/auto-paneel.js`,
  `plannen/auto-plan.json` (eerste plan: "piano naar piek", 7 nummers, ~28 min),
  `test/auto.test.mjs`, `tools/headless/auto.mjs`, `docs/AUTO-DJ.md`.
- GEWIJZIGD (toevoegingen): `actions.js` (`bindAuto`), `laden.js` (`laadLibrary`
  naar buiten), `app.js`, `renderloop.js`, `index.html` (knop auto + AUTO-rij),
  `styles.css`, `server/index.js` (witte lijst: `plannen/*.json`, dus de server
  moest herstarten), `server.test`, CLAUDE.md, VRAGEN blok L, tools/README.
- Getest op een kopie: alle tests groen behalve de bekende tijdmeting; headless
  een hele set van drie (blend + filter-uit), langste stilte 0 ms. **Niet met de
  echte library in Clay's Chrome, niet beluisterd.** Droog doorgerekend op de
  echte library: vijf keer overvloeien, één filter-uit (grids bijna overal onzeker).
- Eerst doen: tabblad herladen, "auto" openen, aanzetten, luisteren. Dan VRAGEN L.

## 29 SEP: KLANKSCHAAL (vanaf de Omarchy-machine, docs/KLANKSCHAAL.md)

Clay vroeg de klankschalen (de Waterschaal) als "een soort plugin" in Varve,
gestemd op de audio van de andere tracks en met de hand te veranderen. Gebouwd
als instrument naast de sampler: knop **klankschaal** in de balk opent een rij
onder de sampler. Volgt de toonsoort die je hoort van de maatgever (of de
focus-track, of met de hand), met de cent van de plaat en de pitch erbij.

- NIEUW: `src/engine/klankschaal.js`, `klankschaal-kern.js`, `klankschaal-worklet.js`,
  `src/ui/klankschaal-paneel.js`, `test/klankschaal.test.mjs`,
  `tools/headless/klankschaal.mjs`, `docs/KLANKSCHAAL.md`.
- GEWIJZIGD (alleen toevoegingen): `engine.js` (klankschaal naast de sampler, stemt mee
  in volgMaat), `actions.js` (blok `klankschaal.*` na de sampler, één import),
  `app.js`, `renderloop.js` (één stap), `index.html` (knop + rij), `styles.css`
  (blok "klankschaal"), CLAUDE.md, tools/README.md, VRAGEN (blok K), dit blok.
- Getest op een kopie op de Omarchy-machine: alle tests groen behalve de bekende
  tijdmeting in vormen-isomorf (Linux-timer); headless Chromium groen (toonhoogte
  gemeten, +44,5 ct voor +43). **Niet beluisterd, niet op de APC, niet op de M1.**
- Op de Mac zelf ook groen (klankschaal.test, headless). `alles.mjs` op de Mac: alleen
  `ingest.test` rood: **yt-dlp staat niet op de Mac** (los hiervan; links binnenhalen werkt
  zo niet). Terugweg: `~/.varve-voor-klankschaal-29sep/` (bestanden.tar = de 10 bestanden
  van vóór, nieuwe-bestanden.txt = wat erbij kwam).
- NIET gecommit: dit staat naast het ongecommitte werk van na 25 sep.
- Eerst doen: tabblad herladen, "klankschaal" openen, een track laden en een veld
  aanslaan. Dan VRAGEN blok K.


APC los, dus een eigen tabblad via de Chrome-extensie (`?vormen=1`), via de
action-bus en de library-knoppen. Goed bevonden:
- opstarten zonder fouten; mapping op de server = verschil met 4 eigen regels
  (omzetting was al gebeurd), 388 regels actief (374 + 4 eigen + vorm-fragment);
- laden uit de library (48 kHz, grid, toonsoort); pitch +8% schuift D → E♭;
- beatjump exact 4 tellen (1,382 s tegen 1,379 s op 174 bpm), op een zeker stuk;
- loop in/out/reloop, quantize aan/uit, kill-lampje, rem tot stilstand = pauze;
- starten op de maat: wacht (lamp 1) → speelt (0,5), tel-fase gelijk op 0,002;
  maatgever = de spelende track;
- hotcue bewaard op de server en terug op een andere track;
- ingest: playlist geweigerd met uitleg, bestaand nummer "al in de library";
- library sorteren op bpm/titel, beide richtingen;
- handelingenlog: aan/uit, bewaard, acties en hotcues staan erin.
Grenzen van deze test: het tabblad van de extensie staat voor Chrome op de
ACHTERGROND (timers geknepen tot 1 s, rAF stil), dus video, vormen en beamer
zijn hier niet te beoordelen; niets beluisterd. Testsporen opgeruimd (hotcues
gewist, twee testlogs weg, tabblad dicht).

Bevinding: de meeste grids waren nog de OUDE analyse (Bay Ledges 6 stukken,
0 zeker), dus beatjump/sync/op de maat weigerden daar ("grid hier onzeker").
Daarom ↻ (`POST /api/library/<id>/grid/analyseer`) op alle 10 nummers gedraaid,
na een back-up: `~/.varve-library-voor-herberekening-26sep.db`. Stukken (zeker ≥ 0,65):

| Nummer | vóór | na |
|---|---|---|
| jungle-mix (53 min) | 31 (13 zeker) | 35 (16 zeker) |
| Sakamoto (60 min) | 45 (3) | 55 (10) |
| album "I will delete…" | 7 (0) | 13 (4), met het 156-bpm-stuk |
| let it all go | 6 (1) | 7 (2) |
| zoned out | 1 (0) | 3 (0) |
| Bay Ledges | 6 (0) | 6 (0) |
| drie eigen sets, no surprises | 1 (0) | 1–3 (0) |

Een geladen track houdt zijn oude grid tot je hem opnieuw laadt (of herlaadt).
Bay Ledges blijft onzeker: tik daar het tempo (4× tap) of zet het grid op slot.

Daarna Clay in zijn eigen tabblad (zonder APC): "tot nu toe werkt alles".

VRAGEN blok J: Clay nam alle adviezen over. Gebouwd (tests 36 bestanden, 3411
checks groen; elke nieuwe check faalt op de oude code; server herstart):
- J4 beatjump vóór het begin: geweigerd met een melding (deck.js, actions.js);
- J26 ½ houdt de "1" als tel (beatgrid.js `_schaal`);
- J12 een bestand op een track gesleept gaat vooraan in de ingest-rij
  (wachtrij.js `vooraan`, `/api/upload?…&vooraan=1`, ingest-strook.js);
- J18 vinkje "log altijd aan" in de lijst achter ↺ (logboek.js); in Chrome
  nagelopen, en in dit Chrome-profiel AAN gezet (Clay's keuze);
- J24 rack-knoppen 5–8 (video-effecten) op endless in Clay's verschil op de server;
  back-up van het vorige verschil: `~/.varve-mapping-verschil-voor-J24.json`.
  Clay's open tabblad moet HERLADEN, anders kan het de oude regels terugschrijven.
Nog open (op gevoel of met de APC): J7, J16, J19, J20, J27, J28, J30.
Niets gecommit.

## HERVATTEN (opgeruimd 25 sep, avond)

De repo is schoon: alleen `main`, geen andere branches of worktrees, niets
ongecommit. De server draait met de nieuwe code (`~/.varve-server.log`); na een
herstart van de Mac: `cd` naar de projectmap en
`nohup node server/index.js >> ~/.varve-server.log 2>&1 &`.

De volgende sessie begint met wat Clay zegt over zijn proefsessie. Hervat-prompt:

> We gaan verder met Varve. Lees CLAUDE.md en docs/HANDOFF.md (HERVATTEN en
> BEGIN HIER). Ik heb de proeflijst gedaan; dit klopte niet: … [of: ik heb nog
> niet geprobeerd]. Repareer eerst wat niet klopt, leg me daarna de vragen uit
> VRAGEN blok J voor die op gevoel gaan (🎛/👀), één voor één met advies.

Wat er na de proefsessie open ligt, op volgorde (zie ROADMAP):
1. Reparatieronde voor wat Clay vond (in zijn eigen Chrome, met de APC).
2. VRAGEN blok J (33): de meeste volgen het advies; alleen 🎛/👀 vragen hem.
3. Na een sessie `hub.status().echoes` bekijken: 0 = echofilter voor de APC uit.
4. ↻ in de library op het album, let it all go, Sakamoto en de jungle-mix
   (de nieuwe beatgrid-analyse geldt pas na ↻).
5. Keylock (ROADMAP 15): wacht op de luistertest A3 (`tools/keylock/LUISTER.md`).
6. AV-kern tot publicatie 1 (25 okt), fase 0 met `~/src/av-kern/FASE0-TEST.md`
   (Varve helemaal dicht). Beslissing H5 rond 25 okt.
7. Stems (17), daarna de rest van ROADMAP.
Advies dat nog open staat: de projectmap buiten iCloud zetten (bv. `~/src/varve`):
iCloud maakte conflictkopieën ("detect 2.js") en synchroniseert elke worktree.

## BEGIN HIER (stand 25 sep)

- **Waarom zoveel tegelijk:** Clay vroeg op 24 sep avond "voer met zoveel mogelijk
  sub agents zoveel mogelijk taken uit". Daarom is afgeweken van "tot 25 okt
  AV-kern eerst": ROADMAP 7, 13, 14, 16, 18, 20, 21, 22, 23 (deel) en 24 zijn
  gebouwd. Elk spoor had een bouwer en een controleur in een eigen worktree;
  daarna drie integratierondes (`integratie-r1` → `r2` → `r3`) met naadtests,
  een ronde rest-sporen (`spoor3/*`) en deze docs (`spoor3/docs`).
- **Stand van de code:** alles staat op `main` (25 sep, via
  `integratie-r1` → `r2` → `r3` → `r4a` → `r4b` → `r5` plus deze afronding); `r5`
  is "grid moet passen per stuk" (punt 14), gecontroleerd en met één herstel.
  `node test/alles.mjs`: 36 bestanden, 3402 checks, groen (integrator én
  hoofdsessie; de vormen-tijdchecks meten nu threadtijd en blijven ook onder
  zware belasting groen). Headless groen: `kijk.mjs`, `apc-klank.mjs`,
  `vormen-plaat.mjs`, `toon-keten.mjs`, `library.mjs`, `kijk-ingest.mjs`,
  `vorm-maat.mjs`, `beamer.mjs`.
- **Opgeruimd (Clay: ja):** alleen `main` staat er nog; alle sporen- en
  integratiebranches en worktrees zijn weg (alles zat in main, `git branch -d`).
- **Server:** herstart op 25 sep met main 0484b10, log in `~/.varve-server.log`
  (`nohup node server/index.js >> ~/.varve-server.log 2>&1 &`). Database van
  schema v5 naar v7 gemigreerd; back-ups `~/.varve-library-voor-v7.db` en
  `~/.varve-mapping-voor-verschil.json` (je volledige kopie van 291 regels). De
  toonsoort van alle 10 nummers is op de achtergrond uitgerekend. Bestaande
  auto-grids veranderen pas na ↻ (album, let it all go, Sakamoto, jungle-mix).

### Wat er vandaag gebouwd is
1. **Toonsoort** (14): server (`server/toon.js` in de worker, ingest-stap,
   achtergrond, ↻ doet grid én toonsoort) en scherm (kolomkop onder de bpm,
   focuskop met correctiemenu, library-kolom TOON met kiezer), met de tweede
   kandidaat in de tooltip. Toont wat je HOORT (pitch telt mee).
2. **Mapping als verschil** (13): je eigen mapping (4 regels: rack-knoppen 5–8 =
   video-effecten) wordt bij het eerste herladen een verschil met de standaard;
   een nieuwe standaard komt voortaan vanzelf binnen.
3. **Library** (21): voorbij 200 nummers (pagina's, alleen zichtbare rijen),
   sorteren op titel/bpm/duur/toegevoegd/gespeeld, hotcues bewaard per nummer.
4. **Ingest** (21): wachtrij (één tegelijk, links en bestanden), voortgang per stap
   met percentage, annuleren, playlist/kanaal/livestream geweigerd, dubbel
   herkend, en na een serverherstart "opnieuw".
5. **Beamer** (18): het losse venster mengt zelf en loopt door met het
   hoofdtabblad naar achteren; foutmelding als de video van een nummer ontbreekt.
6. **Handelingenlog** (20): ○ log naast de opname (en vanzelf bij elke opname),
   ↺ om terug te spelen, ook "opnieuw renderen" (● dan speel).
7. **Transport** (16): beatjump, loop in/out/reloop, quantize voor alle tracks,
   starten op de maat.
8. **Klank** (16): EQ-kill per band, rem (vinylstop), en de maatgever wisselt pas
   na 3 dB en 250 ms (geen geflipper meer tussen badge, puls en vormen).
   Effectwissel en kill als hellingen: geen tik meer in Chrome.
9. **Audiopad** (22): renderBlok en worklet maken geen afval meer; acht decks
   ~3× minder CPU.
10. **Vormen 16:9** (7): alle 26 op 640 × 360, jouw keuze "Midden, 2 breder"
    (Harmonograaf breder, Zonnebloem tot in de hoeken). **Maatbronnen** (23 deel):
    klap en tel van de maatgever als REAGEER-bron.
11. **Beatgrid** (24): het 156-bpm-stuk van het album komt terug (na ↻), elk stuk
    heeft zijn eigen "1", en de "1" knippert langer. Verfijnen na "tel 1 hier" is
    gemeten en niet gebouwd (niet beter op jouw muziek).
12. **APC-indeling** (voorstel A, 16): grid-modus 5 "klank" (Shift + scene 5 of
    ▲ ▼: per kolom kill hoog/mid/laag zolang je drukt, rem, op de maat), rechts
    Bank ◀ ▶ beatjump, Pan/Sends/User loop in/out/reloop, Lock quantize, Stop All
    Clips rem, shift + nummer op de maat. 291 → 374 regels; je oude kopie wordt
    tegen de juiste standaard omgezet (`eerder`), dus alles komt op je APC.
13. **Beamer-inloop** (18): het losse venster toont eerst het beeld van het
    hoofdvenster en mengt pas zelf als zijn video's in de pas lopen (acht tracks
    ~8–9 s); sprongen landen weer op tijd (seekduur klopt nu onder belasting).
14. **Grid moet passen** (24): een stuk heet alleen nog "zeker" als zijn ene grid
    er overal op past; anders wordt het gesplitst waar de fase verspringt, of
    onzeker. Een break met de puls op de offbeat blijft één stuk. Bestaande grids
    veranderen pas na ↻ in de library (let it all go, Sakamoto, jungle-mix).

### Wat Clay nu doet
Server is herstart (hoofdsessie). Dan: je tabblad herladen
(`http://localhost:8777`, voor de vormen `?vormen=1`). Open geen tweede
VARVE-tabblad met de APC aangesloten.

Bij het eerste herladen hoort er één melding te komen: "je eigen mapping staat nu
als verschil met de standaard (4 eigen regels) … — en de bijgewerkte standaard
staat er al op"; in MIDI → lijst staat "4 eigen" en 374 regels. Nagerekend met je
echte kopie (GET, niets gepost): 374 regels, je 4 rack-knoppen (device knobs 5–8
in het rack = video-effecten), niets weggehaald.

Proeflijst (wat niet klopt: noteren, dan eerst repareren):
1. **Toonsoort:** in de kolomkop onder de bpm (bv. `9B G`), groot in de focuskop.
   Schuif de pitch: de toonsoort schuift mee. Klik op de toonsoort in de focuskop:
   kwint ±, maj/min, ½ ±, geen, nieuw stuk, slot. Library (B): kolom TOON is de
   plaat, klik = kiezer (kiezen zet hem op slot). ↻ = grid én toonsoort opnieuw.
2. **Library:** klik op een kolomkop = sorteren (nog eens = omgekeerd). Zet een
   hotcue, laad het nummer op een andere track: de hotcue komt terug, ook na
   herladen van de pagina.
3. **Ingest-strook:** plak drie links tegelijk (één per regel): één DOWNLOAD met
   %, de rest WACHT. × op een wachtende, × op de lopende vraagt een tweede klik.
   Een playlist-link wordt geweigerd; een link die er al is geeft "al binnen" met
   laadknoppen.
4. **Beamer:** "los venster" naar de beamer, dubbelklik (volledig scherm). Zet in
   het hoofdvenster een ander tabblad vooraan: het beeld moet doorlopen. Ook een
   video-opname zo proberen. Open het losse venster met een paar video's aan:
   de statusregel zegt eerst "beamer loopt in" (het beeld van het hoofdvenster),
   na een paar seconden "beamer": er mag niets verspringen of ontbreken.
5. **Handelingenlog:** ○ log aan, een paar minuten spelen, uit; ↺ → speel: de set
   komt terug. Of ● opnemen (neemt vanzelf een log mee) en die terugspelen.
6. **Transport en klank op het toetsenbord:** R/T beatjump (shift+R/T: lengte),
   G loop in, C loop out, shift+G reloop, 6 quantize (Lock licht op),
   shift+Q start een tweede track op de maat van de eerste, ` (links van 1) rem.
   Rechterhand: Y/U, H/N, shift+H, shift+P, =. Kill heeft geen toetsen.
   **Op de APC** (voor de track met focus): Bank ◀ ▶ beatjump (shift + Bank:
   lengte ½/×2), Pan loop in, Sends loop out, User reloop, Lock quantize, Stop
   All Clips rem; shift + nummer (2×2) = op de maat. **Modus klank:** Shift +
   scene 5 (of ▲ ▼), scene 5 brandt magenta. Per kolom: rij 1–3 kill hoog/mid/laag
   zolang je drukt (shift + pad = vast), rij 4 rem, rij 5 op de maat. Kijk of de
   kleuren uit elkaar te houden zijn: magenta 53/54, donkerrood (kill open),
   donkeroranje (rem: speelt), donkergroen (op de maat: speelt) tegen donkergrijs
   (stil), en of Pan/Sends/User op de tel knipperen. In de grid-modus (Shift +
   Metronome) is Lock nog steeds het slot. `apc.html` toont alles met uitleg.
7. **Vormen:** `?vormen=1`, videopaneel (V), Detail View, Device ◀ ▶ door alle 26:
   rond in het midden, Harmonograaf breed, Zonnebloem tot in de hoeken, niets
   uitgerekt. REAGEER-bron op "klap (maat)" of "tel": volgt de MAAT-badge.
8. **Album:** in de library ↻ op "I will delete this album…" (twee klikken als het
   grid op slot staat). Daarna staat het stuk op 156 bpm (11:45–13:29, ook
   15:41–16:17) in het grid, als zeker.
9. Nog van eerder: na een sessie `hub.status().echoes` (ROADMAP 2) en de
   keylock-luistertest A3.

### Wat NIET getest is
Voor alles: **niets in Clay's eigen Chrome, niets op de APC, niets beluisterd.**
Getest is in Node en headless (MIDI eruit, eigen server en database), vaak onder
zware belasting van de andere agenten.
- **Toonsoort:** of hij muzikaal klopt op je library (alleen fragmenten: 11/11
  gelijk aan de meting); de eerste achtergrondanalyse op je echte database;
  tooltips zoals Chrome ze toont; de kolom is 13 px hoger (onder 900 px hoogte
  zakt de fader verder weg).
- **Mapping als verschil:** de omzetting in je echte browser, en een oude kopie in
  een tweede browser (Comet); de LED's na het laden op het apparaat.
- **Library:** een echte muis en scrollbalk; een lege hotcue indrukken in de
  tientallen ms tussen laden en terugzetten overschrijft de bewaarde.
- **Ingest:** echte YouTube en TikTok (geen netwerk; de voortgang is gemeten met de
  echte yt-dlp op een lokale server); een echte livestream.
- **Beamer:** een echte beamer op een tweede scherm; langer dan een paar seconden
  verborgen (Chrome knijpt na 5 min harder); acht video's in het losse venster;
  de vertraging tussen canvas en scherm (aanname 16–33 ms).
- **Handelingenlog:** een echt uur; MIDI en LED's tijdens terugspelen; terugspelen
  met echte library-nummers; mogelijk een korte stilte bij de start (uit de code).
- **APC-indeling:** niets op het apparaat: de nieuwe kleuren, het knipperen van
  Pan/Sends/User, de kill-drukknop met echte aanslagen; de omzetting van je kopie
  alleen nagerekend (nep-fetch), de melding niet gezien. Met `?vormen=1` en het
  mapje vorm open is shift + Bank ◀ ▶ de beatjump-lengte, niet de vormlaag (bewust).
- **Beamer-inloop:** een echte beamer, de M1 zonder andere belasting (hoe lang de
  inloop daar duurt), zestien echte YouTube-video's tegelijk tijdens de inloop,
  inloop na herladen en na een geminimaliseerd los venster met acht tracks.
- **Transport, rem, kill:** niets gehoord (beatjump in de maat, starten op de maat,
  het uitdoven van de rem, kill op zware bas); de ~9 ms extra vertraging van kill
  en effectwissel niet op gevoel; de maatgever-wissel in een achtergrondtab.
- **Audiopad:** afvalvrij gemeten in Node, niet in Chrome's audiothread; geen acht
  echte decks gehoord.
- **Vormen:** rekentijd op de M1 in echte Chrome; een lange Worker-sessie; hoe de
  dunnere lijnen (2× in plaats van 2,5× opgeschaald) er op de beamer uitzien.
- **Beatgrid:** ↻ op het hele album (alleen fragmenten gemeten); het langere
  knipperen op de "1" op de APC. "Grid moet passen": niet op hele albums of mixen,
  de rekentijd niet op een echte mix van een uur (synthetisch tot ~4× vroeger, in de
  worker), en of een break op jouw muziek één stuk blijft alleen synthetisch.

### Werkwijze die vandaag werkte
- Per spoor een bouwer en een controleur, elk in een eigen worktree; de
  controleur laat elke herstelde fout eerst falen op de oude code.
- Integreren in rondes, met naadtests voor wat twee sporen samen raken (toonsoort
  × library, handelingenlog × hotcues, transport × klank).
- Bestanden met " 2" in de naam zijn iCloud-conflictkopieën: nooit committen,
  `git add` per pad.
- Tijdmetingen in tests wankelen onder de belasting van tien agenten: los
  opnieuw draaien voor je iets aanpast.

## Geschiedenis: BEGIN HIER van 24 sep (avond), ingekort

- `main` was schoon: 29 bestanden, 1923 checks. AV-kern (`~/src/av-kern`, `main` =
  `ab7e115`, 40 tests) had fase 0 klaargezet.
- Gedaan die dag: AV-kern fase 0 voorbereid; toonsoort en keylock onderzocht en
  gemeten; G4, H1, H2, H4, H6, T3, K3, K8 beslist; vormlagen vulden het beeld en de
  video stond niet meer op zijn kop (door Clay goedgekeurd).
- Clay moest nog: keylock-luistertest A3 (`tools/keylock/LUISTER.md`), AV-kern
  fase 0 met de APC (`~/src/av-kern/FASE0-TEST.md`, Varve helemaal dicht), de
  beatgrid-dingen proberen, `hub.status().echoes` bekijken. Die staan nog open.
- Het plan was: tot 25 okt AV-kern (6–11), daarna 13–15 in Varve. Op 25 sep is
  daarvan afgeweken (zie boven).

## Wat er later op 24 sep nog bij kwam (vormlagen in Clay's Chrome)
- **Vormlagen VULLEN het beeld** (`4addd90`). Clay zag vierkante vormen met lege
  banden. Nu valt boven en onder 22% weg en is het beeld zachter (2,5× opgeschaald).
  Echt 16:9 komt vóór ROADMAP 7.
- **Video op zijn kop onder een vormlaag:** gerepareerd (`cef1d28`). De lagenshader
  las het gemengde beeld (een buffer) met uv, en dat was een derde omkering. Nu
  `1 - uv.y`. `kijk.mjs` meet het met vier gekleurde kwarten en faalt op de oude code.
- **`kijk.mjs` wacht op de app** (`44a2cca`) in plaats van vaste 2,5 s.
- Clay: "het werkt, nu staat alles goed". Het "vierkante" was de oude versie vóór
  het herladen.

## Nieuw (24 september 2026, middag): AV-kern fase 0, toonsoort, keylock

Drie agenten liepen tegelijk.

### AV-kern fase 0 (`~/src/av-kern`)
- **Repo:** uitgepakt uit `Input/av-kern.zip` naar `~/src/av-kern`, naast
  `av-scene-kit`. Er is geen remote. `main` = `ab7e115`: 8 commits bovenop `ca66e0d`.
  `npm test` geeft 40 tests groen (was 17), `npm run build` is groen.
- **Driver veilig gemaakt:**
  - Een wachtrij van hooguit 16 berichten per 4 ms. Vroeger gingen er 135
    LED-berichten in één synchrone lus uit, plus 51 bij het verbinden.
  - Alleen poorten met state `connected`, en de modus-sysex alleen als de
    uitvoerpoort wisselt.
  - Een Web Lock `av-kern-apc`: een tweede tabblad vraagt geen MIDI aan.
  - Shift wordt losgelaten als de invoer wegvalt.
  - De 0x41-keuze is niet veranderd.
- **`npm run niet-gemapt`:** maakt van een actielog de lijst voor Totaalplan 0.1.
- **`FASE0-TEST.md`:** een checklist van ~40 minuten voor Clay.
- **Varve na AV-kern:** Varve stuurt zelf 0x42 en een blackout bij het laden. Helpt
  dat niet, dan de USB-kabel er 5 s uit terwijl Varve open staat.
- **Open:**
  - 0.2: de Ademmachine in Bedienplan nalopen (Clay).
  - 0.4 is gedaan (`ab7e115`): `reference/ademmachine.html` is ongewijzigd uit het
    artifact gehaald. De mockup heeft een eigen MIDI-koppeling zonder wachtrij of lock:
    niet openen met de APC aangesloten (staat in `reference/README.md`).
  - 0.5: `prompts/` (achterhaald: de sessies zijn al gebouwd).
  - Echofilter en LED's in rAF (bevriezen in een achtergrondtab): alleen gemeld.
- **NIET getest:** niets op de echte APC en niets in echte Chrome; alleen een
  nagebouwde Web MIDI en headless met MIDI eruit.

### Toonsoort (`docs/TOONSOORT.md`, `tools/toonsoort/`)
- **Profiel:** Temperley 2005, met harmonisch/percussief scheiden, log en een
  stemming per stuk. 8/10 goed op bekende stukken; edma en Krumhansl 5/10. De
  synthetische proef: 24/24.
- **Kaart:** Viterbi over vensters van 24 s. In ADRIANA liggen alle 17 grenzen binnen
  15 s van een echte nummergrens.
- **Snelheid:** ~0,1 s per minuut audio.
- **Zekerheid:** de helft van de library zit onder 0,15. Dat is ambient: eerlijk.
- **Grondwaarheid dun:** 10 stukken, allemaal Sakamoto. Herijken na ~20 sloten.
- **Uitkomsten:** `meting.txt` en `synth.txt`. De vergelijkingsruns staan in
  `tools/toonsoort/uit/`, niet in git.

### Keylock (`docs/KEYLOCK.md`, `tools/keylock/`)
- **Pakket:** Signalsmith 1.3.2, npm 96 KB, WASM 63 KB. Het pakket staat in
  `tools/keylock/pakket/`, niet in git; `proef.mjs haal` haalt het opnieuw.
- **Toon:** staat exact bij 0,92 en 1,08. Transponeren zit 2–4 cent naast.
- **Positie:** klopt tot ±0,6 ms met een vooruitblik van uitLat + 128 frames.
- **Rekenwerk:** ~2% van een kern per deck, 8 decks ~16%. Gespreid rekenen is
  verplicht. Gemeten in Node onder wisselende belasting; ±2× onzeker.
- **Luisterbestanden:** `tools/keylock/uit/` (429 MB, niet in git): 4 nummers,
  14–16 varianten per nummer, 3 dB zachter. Opnieuw maken met
  `node tools/keylock/proef.mjs luister`.
- **NIET getest:**
  - in echte Chrome (AudioWorklet, baseLatency);
  - beluisterd;
  - korte loops met keylock en de tempo's 0,5 en 2;
  - de polariteitskeuze en het opwarmen: alleen ontworpen.

### Beslist met Clay (24 sep, middag)
- **G4:** Bedienplan alleen voor AV-kern; Varve houdt zijn eigen mapping.
- **H1:** de stems klinken goed.
- **H2:** stems kiesbaar per nummer, standaard twee.
- **H4:** vormlagen "goed voor nu".
- **H6:** isomorf geluid eerst als AV-kern-module, daarna in Varve via een vormbus.
- **Wanneer:** toonsoort en keylock na 25 okt, vooraan.
- **Door Clay gekozen:**
  - T3: wat je hoort;
  - K3: een sprong duurt ~95 ms en is exact;
  - K8: transponeren mag ook zonder keylock.
- **Volgens het advies, tenzij Clay bezwaar maakt:** T1, T2, T4–T7, K5 en K7.
- **Open:** I1–I4 (K1, K2, K4, K6).

## Stems splitsen — proef (24 sep, nacht)

Clay vroeg om een "live stem splitter". Advies en uitkomst:
- **"Live" in DJ-software** (Serato, rekordbox, djay) = vooraf rekenen, live
  bedienen. Voor Varve past dat als stap in de ingest (naast peaks en onsets),
  met stems naast `audio.wav` in de cache en per track stem-faders vóór de EQ.
  Echt realtime splitsen in de browser voor 8 decks: afgeraden.
- **Gemeten met Demucs htdemucs op de M1** (`tools/stems/meet.py`, uitkomst in
  `tools/stems/uit/meting-*.json`, stems om te beluisteren in `tools/stems/uit/<nummer>/`,
  niet in git): GPU (MPS) 1,9–2,4× realtime, CPU 0,85×. Een uur Sakamoto ≈ 27 min.
  De som van de stems ligt −34 tot −43 dB van het origineel. Opslag ≈ 44 MB per minuut.
- **Bij Clay's repertoire:** drums en bas zijn vrijwel leeg. Bij Sakamoto,
  zoned out en het album zit 82–100% in "other". Alleen zang ↔ rest werkt:
  No Surprises 52% zang, Bay Ledges 13,5%. **Advies:** als het goed klinkt, TWEE
  stems (zang en rest) in plaats van vier. Bouwen als spoor ná 25 okt en na
  "mapping als verschil bewaren".
- **Omarchy-machine van Clay** (Ryzen 7 5800X, GTX 1660 6 GB, 32 GB): geschat
  (NIET gemeten) 3–6× sneller dan de M1 op CUDA. Grootste winst: het splitsen
  concurreert daar niet met video en vormen tijdens een set. Voorstel: een batch
  via een gedeelde map (rsync/Syncthing), geen open netwerkdienst. Meten: Clay
  draait meet.py daar (commando's in het gesprek: python3.12-venv,
  `pip install torch torchaudio demucs`, `--apparaat cuda --media <map>`), of
  zet sshd aan en geeft de hostnaam.
- **Demucs staat NIET in de app.** Hij zat in een tijdelijke venv in de sessie-
  scratchpad (weg na de sessie). Opnieuw opzetten:
  `python3 -m venv --system-site-packages <map> && <map>/bin/pip install demucs`.
  PyTorch 2.9.1 met MPS staat al systeembreed op de Mac. Het model (~80 MB)
  staat in de torch-cache.


## Nieuw (24 september 2026, later): sporen A en B plus controleur (stap 2 en 3)

Zes agenten werkten tegelijk, elk in een eigen worktree; daarna is alles
samengevoegd op main.

- **A — reageren op de mix.** `src/analysis/features.js`, `luisteraar.js` en
  `router.js`. Device knob 8 in het mapje vorm is REAGEER; standaard bas → knop 1.
- **B1–B3 — alle 26 vormen.** De zware, de middelzware en de isomorfe. De
  isomorfe zijn hier alleen beeld: de geluidssink is nog niet aangesloten.
- **B4 — Worker en tijdsbudget.** Een Worker per laag en een budget in ms,
  met een noodrem.
- **Controleur.** Tien bevindingen, alle verwerkt:
  - het mapje vorm en de vormcode bestaan alleen met de vlag;
  - de mapping wordt alleen bewaard als jouw deel veranderde;
  - de achtergrondwaas wordt in de shader weggefilterd;
  - bij een systeemwissel wordt de context gereset;
  - de lagenstap wordt buiten teken() gebouwd;
  - een fragmentregel weghalen kan niet (hij komt meteen terug);
  - de mapje-balk nummert alleen de draaiknoppen;
  - bij het starten verschijnt een melding "vormlagen staan aan";
  - sf staat nu bij de middelzware.

Tests: `node test/alles.mjs` geeft 29 bestanden, 1920 checks, groen. Ook
`node tools/headless/kijk.mjs` is groen: Worker-modus, bitmap-oriëntatie,
reageren. Details staan in CLAUDE.md (VORMLAGEN).

### NIET getest
- **Alles op Clay's M1 in echte Chrome.**
  - Is een budget van 4 of 12 ms goed?
  - Grijpt de noodrem in bij zware vormen (Lenia, Clifford) met 8 video's?
  - Throttlet de Air na 30 minuten?
- **De APC:** knob 8 (ring), Detail View, en gluren in het mapje vorm.
- **Of het beeld "zichtbaar inzakt"** bij een bass-kill. Geijkt op
  getallen, niet met het oog.
- **Hoe de 16 nieuwe vormen er echt uitzien.** Ook grovere kwaliteit is
  alleen met getallen gecontroleerd.
- **De drempel in schoon()** (3–8%): mogelijk verdwijnen er zachte sporen die
  Clay juist mooi vond.

### Volgende stap
1. Clay: `http://localhost:8777/?vormen=1`, videopaneel (V), een track met
   video. Probeer Detail View, On/Off, knob 1–8 en Device ◀ ▶ door alle 26 vormen.
   Zet REAGEER open en doe een bass-kill.
2. Daarna volgens het plan eerst AV-kern (publicatie 25 okt): die kan
   `src/vormen/hulp.js` en `systemen*.js` ongewijzigd kopiëren.
3. Na 25 okt: spoor C (DJ-functies) en D (handelingenlog, blauwdruk-import).

## Nieuw (24 september 2026, nacht): vormlagen, stap 1 van het AV-kern-plan

Clay gaf `Input/` plus twee artifacts (Vormmachines, APC40 ontleed) en twee
plannen (Totaalplan AV-kern, projectplan AV-kern × Varve). Tien agenten
bekeken het vanuit negen invalshoeken, met één synthese. Het resultaat staat in
`docs/plugins/`: `00-inventaris.md`, `01-plan.md` (plan en besluiten) en
`02-analyses.md`.

Wat eruit kwam: het projectplan ging uit van een Varve dat nog "alleen plan" was.
Dat klopt niet meer. De AV-kern-ideeën landen daarom als gewone modules in Varve.
Er komt geen pluginsysteem, geen tweede MIDI-driver en geen TypeScript-build.

**Gebouwd (stap 1):**
- Vormmachines als beeldlaag, alleen met `?vormen=1`.
- Tien systemen in `src/vormen/systemen.js`.
- De laag in `laag.js`.
- De mixerhaak in `video-mixer.js` en `video/lagen.js`.
- De actions `video.layer.*`.
- Het mapje "vorm" achter Detail View, als fragment (`mappings/apc40mk2-vormen.json`,
  `Mapping.voegToe`).
- De rij VORM in het videopaneel.

De details staan in CLAUDE.md (VORMLAGEN).

Getest:
- `node test/alles.mjs`: 24 bestanden, 1555 checks, groen. Nieuw is
  `vormen.test.mjs`. `mapping.test.mjs` test nu ook fragmenten.
- `node tools/headless/kijk.mjs`: headless Chromium zonder Web MIDI, eigen server
  op :8791. De app start met en zonder vlag.
- Zonder vlag: geen rij, geen lagen, geen regels.
- Met vlag, via APC-bytes door de mapping: Detail View, On/Off, device knob 1
  (endless), Device ▶ en Bank ▶ werken.
- 60 beelden zonder fouten.
- Er is een schermafdruk: twee vormen over het (lege) videobeeld, en het
  focusdeel toont "vorm 1–6 · dekking".

### Wat hiervan NIET getest is
- Op de echte APC in Clay's tabblad: de lampjes (Detail View licht op, On/Off),
  de ringen van de device knobs in het mapje vorm, en gluren (vasthouden).
- Met echte video eronder: de mengvormen (screen, add, multiply) op beeld, de
  beamer (los venster) en de mp4-opname met lagen.
- De snelheid in echte Chrome op de M1. In headless rekent WebGL in software,
  dus daar zegt het niets. Let op fl (2200 deeltjes) en bd (170² paren) met
  twee lagen plus 8 video's.
- Het mapje vorm met een eigen mapping van Clay (fragmentregels plus zijn
  eigen regels). Getest in Node, niet op zijn echte kopie.

### Volgende stap
Clay opent `http://localhost:8777/?vormen=1` in zijn eigen tabblad. Een
herlaadbeurt is genoeg; de server hoeft niet opnieuw te starten, want er zijn
alleen statische bestanden bij gekomen. Daarna:
1. Videopaneel open (V) en een track met video.
2. Op de APC: Detail View, On/Off, draaien, Device ◀ ▶.
3. Kijken of het beeld hapert.

Daarna stap 2 uit `01-plan.md`: beeld dat de mix hoort (analyse plus router,
knob 8 = reageren). Of eerst de beslissingen 9–12.

## Nieuw (24 september 2026): eigen bestanden, TikTok, staande video

Nog NIET gecommit (de hoofdsessie reviewt). Server moet HERSTART worden
(nieuwe route `/api/upload`, `server/links.js`, nieuwe ingest).

- **Eigen bestanden**: knop "bestand…" in de library (meerdere tegelijk) en
  bestanden slepen op het library-paneel → upload (gestreamd, grens 8 GB,
  `VARVE_UPLOAD_MAX`) → ffprobe → dezelfde pijplijn als een link. Id
  `lokaal-<hash>`: hetzelfde bestand twee keer = hetzelfde nummer. Slepen op
  een baan/kolom/focusdeck: audio speelt direct zoals altijd, een VIDEO (of
  audio die de browser niet leest, bv. aiff) gaat via de library en komt
  daarna op die track, met een melding dat het even duurt. Speelt die track
  tegen die tijd, dan laadt hij niet (melding: laad hem via de lijst).
- **TikTok**: werkt zonder extra software, want `curl_cffi` 0.13.0 is er (yt-dlp
  imiteert daarmee Chrome). Proef op Clay's link (lennonstella, "no surprises -
  Radiohead"): metadata ok, volledige ingest naar een tijdelijke map in 57 s,
  video 720×1280, grid 86,2 bpm (onzeker). Links zonder `?is_copy_url…` en met
  `www.`; korte links (vm./vt./`/t/`) volgt yt-dlp zelf (niet gemeten).
  Beeldformaat nu `-S res:720` — met het oude `[height<=720]` kwam er bij
  staande TikToks geen video (hun formaten zijn 576×1024 en hoger).
- **Library-label** per nummer: YT / TikTok / bestand / web.
- **Staande video**: elke laag houdt zijn beeldverhouding; knop "passend/vullen"
  in het videopaneel (`video.fit`, te koppelen). Randen zijn doorzichtig.
- Tests: `node test/alles.mjs` → 23 bestanden, alles groen (nieuw:
  `bronnen.test.mjs`, `upload.test.mjs`, beeldverhouding in `video.test.mjs`).

### Wat hiervan NIET getest is
- Niets in de browser (geen Chrome gebruikt, APC hing eraan): de knop
  "bestand…", slepen op het paneel en op een track, de uploadbalk (XHR-voortgang),
  het laden na de ingest, de labels, de knop passend/vullen.
- De meng-shader zelf: de rekenregel is getest in JS (`leesLaag`), de GLSL niet
  in een echte WebGL-context. Eerste keer kijken: staande TikTok naast een
  liggende YouTube, beide modi, en het losse venster.
- Echte grote bestanden (GB's) van Clay, mkv/mov van een telefoon (rotatie),
  mp3 met hoesje uit de praktijk; de upload-grens is getest met 768 MB.
- TikTok-korte links, TikTok-video's met inlogplicht of regioblokkade (de
  meldingen daarvoor zijn alleen op tekst getest).
- YouTube met `-S res:720`: niet opnieuw tegen YouTube gedraaid (hoort dezelfde
  720p te kiezen als `[height<=720]`, want res = de kleinste kant).

## Stand (einde sessie 23 september 2026, ~23:45)

- Alles is gecommit behalve `Input/` (Clay's nieuwe map, zie `docs/INPUT.md`) en deze
  laatste docs/tools-bijwerking. Laatste codecommit `1196c2b` (beatgrid C + D).
- Tests: `node test/alles.mjs` → 21 bestanden, 1398 checks, alles groen.
- Server draait met de nieuwe code (herstart ~23:05). Database: schema v5 (grid als
  tempokaart). Kopieën van vóór de migraties staan in je thuismap:
  `~/.varve-library-voor-v4.db`, `~/.varve-library-voor-v5.db`,
  `~/.varve-library-voor-heranalyse.db`; mapping van vóór het samenvoegen:
  `~/.varve-mapping-voor-samenvoegen.json`.
- Na elke serverwijziging herstarten (`pkill -f "node server/index.js"` en opnieuw).

### Wat deze sessie bouwde (in volgorde; commitberichten zijn precies)
1. Alle open werk gecommit in tien stukken; vragen C1–C6, D1–D5, E1–E3 met Clay doorlopen
   en gebouwd (pitchbereik, pitch op 0 bij laden, crossfaderkant, nummer = focus, echo op de
   maat, pads bewaren, pads volgen de maat, drukknoppen, één afspeelmotor, panelen,
   app.js opgesplitst, action-namen Engels, mapping op de server).
2. APC: mode 0x42 (gemeten), mapjes/shift, daarna na onderzoek (`docs/APC40-onderzoek.md`)
   herzien naar "controller eerst": één kolom = één track, strip rechts, grid-modi op de
   scene-knoppen. Hoofdscherm spiegelt de APC. Interactieve APC-kaart `apc.html`.
3. Vijf reviewagenten → `docs/VERBETERINGEN.md`; ronde 1 (live-fouten, server-lek, analyse
   in een worker, opname-integriteit) en ronde 2 (scherm, lampjes B2/B4, endless-knoppen,
   één tabblad op de APC) gebouwd.
4. Beatgrid (`docs/BEATGRID.md`): A tikken betrouwbaar (91% goed, 0% offbeat), B tempokaart
   in stukken (schema v5), C automatisch bij binnenhalen met zekerheid per stuk + strook +
   heranalyse op de achtergrond, D grid-modus op de APC (Shift + Metronome).
5. Clay's eigen mapping (4 knoppen: rack-knoppen 5–8 = video-effecten) samengevoegd met
   de nieuwe standaard (291 regels) — de bewaarde volledige kopie hield de grid-modus buiten
   beeld. Structurele oplossing staat in ronde 3 ("mapping als verschil bewaren").

### Uitkomst heranalyse van Clay's 4 nummers (23:05)
Album: 7 stukken 150/140/150, 0 zeker · Sakamoto: 45 stukken, 3 zeker · Bay Ledges:
6 stukken 153–160 (één op 76 = octaaffout), 0 zeker · zoned out: geen puls. Bijna alles
onzeker = eerlijk; sync/beatloops weigeren daar tot Clay tikt (≥ 4 tikken = slot).

## Chrome-crash van 20:27 — en de regel die eruit volgt

Chrome crashte om 20:27 in `MidiService_TaskService_Thread`, op dezelfde plek
als de vier crashes van 22 september. Vermoedelijke oorzaak: vier
VARVE-tabbladen tegelijk (twee testtabbladen van de sessie, een agent-tabblad
en dat van Clay) die allemaal init en LED's naar de APC stuurden.
Maatregel (`c2d580f`): `src/ui/tabblad.js`, Web Lock `varve-mixer`. Een tweede
tabblad vraagt geen MIDI-toegang aan (`midi-opzet.js` wrapt `midi.init`) en
neemt pas over als het eerste sluit.

**REGEL:** open NOOIT een extra VARVE-tabblad terwijl de APC aangesloten is en
Clay's tabblad open staat. Vraag Clay eerst de APC los te koppelen, of test met
zijn toestemming in zijn tabblad. Let op: `apc.html` leest de APC zelf mee
(zonder sysex, stuurt niets) en valt buiten de lock.

## Wat NIET getest was (23 sep)

- De hele beatgrid-UI in de browser en op de APC: zekerheidsstrook, onset-streepjes,
  "?" bij de bpm, library-kolommen en ↻, grid-modus (Shift + Metronome) met de
  witte scene-LED's en het blijvende balkje.
- Visueel na ronde 2: het scherm op 1440×900 en 1920×1080.
- De APC opnieuw aansluiten in echte Chrome (init en LED's na hotplug).
- Op het apparaat: knipperen op de tel, endless-ringknoppen, drie LED-standen, A|B-kleuren.
- Echofilter voor de APC staat nog aan; na een sessie `hub.status().echoes` bekijken.
- RF64-opname afspelen in de browser; video-opname (geluid, 30 fps).
- Uit eerdere rondes: luistertest streamen/loops/seek (VRAGEN A2), keylock-demo (A3),
  sends en sampler op het gehoor.

## Bekende valkuilen bij testen in Chrome (via de extensie)

- Testtabbladen staan in een venster achter dat van Clay: `document.visibilityState`
  is dan `hidden`. Gevolg: geen requestAnimationFrame, AudioContext blijft
  `suspended`, timers op 1 Hz, en Chrome laadt/decodeert geen video.
  → Logica testen met OfflineAudioContext of door functies direct aan te roepen;
  een screenshot haalt het tabblad heel even naar voren.
- Een nep-video voor de videomixer: een canvas met readyState/currentTime/play/pause
  erop geplakt. Testbeelden ASYMMETRISCH maken (vier kwarten).
- Meet een beat-puls nooit precies óp de tel (afronding valt op de vorige tel).
- Clay speelt soms tegelijk in zijn eigen tabblad. Een eigen testtabblad mag
  ALLEEN als de APC niet aangesloten is (zie de regel hierboven); ruim
  testracks/opnames in zijn library weer op.

## Volgende stap (23 sep; grotendeels gedaan, zie BEGIN HIER)

1. Clay test in zijn EIGEN tabblad (http://localhost:8777; open er zelf geen extra):
   een nummer laden, 4× Tap, grid-modus proberen, `apc.html` ernaast ("live meekijken"
   pas na een klik). Wat niet klopt eerst repareren.
2. `docs/INPUT.md` met Clay doornemen: wat wil hij met `Input/` (oude fase-1-zip,
   av-kern, blueprint)? Beslissen of `Input/` in git hoort.
3. Beatgrid-restpunten: het 156-bpm-stuk van het album valt weg in `segmenteer`
   (minSec); na "tel 1 hier" eventueel `/grid/verfijn` met `anker` aanroepen voor de
   laatste ms; `barPhase` heeft geen maat-anker per stuk.
4. Ronde 3 uit `docs/VERBETERINGEN.md`, punt voor punt met Clay kiezen (functies, geen
   reparaties: niets bouwen zonder zijn ja). Hoogste waarde volgens de reviews: eigen
   mapping als VERSCHIL bewaren (anders bevriest elke nieuwe standaard), library voorbij
   200 nummers + hotcues per nummer, video mengen in het losse venster (beamer bevriest nu
   als het hoofdtabblad wegvalt), renderBlok zonder allocaties (8 decks tegelijk).
5. Open vraag F1: koptelefoon-cue vraagt een tweede audio-uitgang.
