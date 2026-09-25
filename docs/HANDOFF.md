# Overdracht — waar we staan (25 september 2026)

Lees in deze volgorde:
1. `CLAUDE.md`: architectuur, regels, valkuilen. Nieuw sinds 25 sep: transport,
   rem, EQ-kill, maatgever met hysterese, hoorbaar.js, overgangen als hellingen,
   het losse venster dat zelf mengt, handelingenlog, library, ingest-wachtrij,
   mapping als verschil, vormen 16:9, toonsoort.
2. Dit bestand.
3. `ROADMAP.md`: bovenaan staat DE TAKENLIJST OP VOLGORDE.
4. `docs/VRAGEN.md`: open vragen, nieuw is blok J.
5. Per onderdeel: `docs/TOONSOORT.md` (§13), `MAPPING-VERSCHIL.md`, `LIBRARY.md`,
   `BEAMER.md`, `HANDELINGENLOG.md`, `AUDIOPAD.md`, `VORMEN-16x9.md`,
   `BEATGRID.md` (restpunten), `APC40.md`.

## BEGIN HIER (stand 25 sep)

- **Waarom zoveel tegelijk:** Clay vroeg op 24 sep avond "voer met zoveel mogelijk
  sub agents zoveel mogelijk taken uit". Daarom is afgeweken van "tot 25 okt
  AV-kern eerst": ROADMAP 7, 13, 14, 16, 18, 20, 21, 22, 23 (deel) en 24 zijn
  gebouwd. Elk spoor had een bouwer en een controleur in een eigen worktree;
  daarna drie integratierondes (`integratie-r1` → `r2` → `r3`) met naadtests,
  een ronde rest-sporen (`spoor3/*`) en deze docs (`spoor3/docs`).
- **Stand van de code:** `integratie-r3` (nog niet op `main`) plus de rest-sporen
  `spoor3/transport-rest`, `toon-tweede`, `fx-hellingen`, `vormen-tijd` en
  `ingest-rest-2`.
  <!-- TODO hoofdsessie: eindbranch en eindcommit na het samenvoegen van de
  rest-sporen, APC-indeling (voorstel A), beamer-inloop en grid-past; testuitkomst
  van de eindstand (`node test/alles.mjs`, kijk.mjs). -->
  Op `integratie-r3`: 36 bestanden, 3165 checks, alleen de vormen-tijdchecks
  wankelden onder zware belasting (`spoor3/vormen-tijd` meet nu in threadtijd).
  Headless groen: `kijk.mjs`, `vormen-plaat.mjs`, `toon-keten.mjs`,
  `library.mjs`, `kijk-ingest.mjs`, `vorm-maat.mjs`, `beamer.mjs`.
- **Server:** herstart gebeurt door de hoofdsessie (bijna alles in `server/` is
  veranderd). Vóór de herstart een kopie van `media/library.db` en `-wal` naar
  `~/.varve-library-voor-v7.db`, zoals bij v4 en v5. Bij de eerste start migreert de
  database van schema v5 naar v7 (`toon_json`, tabel `hotcues`, `titel_sleutel`;
  op een kopie van Clay's db gemeten: 6 ms, alles gelijk) en analyseert de server
  op de achtergrond de toonsoort van alle nummers (samen ~16–70 s, in een worker).

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
14. <!-- TODO hoofdsessie: grid-past: één regel. -->

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
  knipperen op de "1" op de APC.

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
