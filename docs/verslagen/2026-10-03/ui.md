# Stems — spoor ui (3 okt 2026)

Branch `stems/ui` (worktree `~/Projects/varve-stems/ui`), op het contract `dfd7ea5`
(`docs/STEMS.md`). Server en engine bouwden tegelijk in hun eigen worktree; hun werk
zit niet in deze branch.

| commit | onderwerp |
|---|---|
| `20acd72` | Stems in de mixer: stems.wav laden met terugval, de STEMS-rij en een teken in de kolomkop |
| `fbeb6e4` | Stems in de library: kolom met splitsen en annuleren, keuze 2 · 4 · geen bij binnenhalen |
| `0ca8a44` | Controlekamer: tegel Stems (wat loopt, wat wacht, of de splitter er is) |
| `7df1559` | Headless: tools/headless/stems.mjs, de stems van binnenhalen tot kill gemeten |
| (laatste) | Verslag ui-spoor; stems.mjs wacht na een kill-klik op de bus voor hij meet |

Alleen bestanden van het ui-spoor (contract §5). Geen dependency, geen schema, geen
APC-mapping.

---

## Wat er gebouwd is

### 1. Laden (`src/ui/laden.js`)
- Heeft de library-rij `stems`, dan `deck.laadStream('/' + stems.bestand, titel,
  { stems: { namen, schaal } })`. Weigert de engine het (ander aantal kanalen), is het
  bestand er niet (404) of gooit het om een andere reden: een **foutmelding** onderaan
  ("track N: stems van "…" niet geladen (reden) — hij speelt zonder stems (audio.wav)") en
  dan gewoon `audio.wav`. Een nieuwere laad op dezelfde track wint (`nogDeLaatste`), ook
  tussen de mislukte stems-poging en de terugval.
- `staat.deckStems[id] = { aantal, mislukt } | null` (nieuw in `staat`, app.js): wat de
  library zei bij het laden en of het mislukte. Los bestand en demo: null.
- Hoeveel stems er ECHT spelen komt van de bus (`aantalOpBus`), niet van de library.
  De melding in het paneel zegt "staat op track 1, met 2 stems".
- Komen er stems binnen terwijl het nummer al op een track staat: **niet wisselen**.
  Wel: een melding ("2 stems van "…" staan klaar — laad het nummer opnieuw op track 3"),
  een gestippeld teken in de kolomkop en de tekst in de STEMS-rij.
- Auto-DJ en terugspelen laden via dezelfde `laadLibrary`, dus ook met stems.

### 2. De STEMS-rij (`src/ui/stems-paneel.js`, `index.html`, `styles.css`)
- **Waar:** een rij onder de mixer, net als AUTO en KLANKSCHAAL (een `section` na `main`),
  vóór die twee. Knop **stems** in de balk, naast klankschaal. Standaard dicht, onthouden in
  localStorage `varve.stems.open` (in try/catch).
- **Voor de track met focus.** De actions staan vast in index.html op track 1
  (`track.1.stem.<s>`, `.kill`, `.hold`); de rij schrijft ze om bij een focuswissel. Zo
  bindt vensters.js ze bij het opstarten zoals alle andere knoppen en faders, en zet de
  renderloop de schuiven elke frame op hun `read()` (`volgEngine`). De kills leest de rij
  zelf elke frame terug (knop rood, strip doorgestreept).
- **Per stem:** naam, een niveau**schuif** (0..1, dubbelklik = vol) en **kill**: klik =
  schakelaar (`.kill`), **shift + vasthouden = weg zolang je drukt** (`.hold`, via
  `data-action-shift`, de bestaande knoppenbinding).
- **Welke stems** er zijn zegt `read()`: drums niet null = vier, zang niet null = twee,
  anders nul. Twee: zang · rest. Vier: drums · bas · overig · zang, en **rest als
  groepsknop** erachter (gestippeld, iets apart; werkt op drums + bas + overig samen).
  Zonder stem-actions (een engine van vóór de stems, zoals in deze branch) leest alles
  null en staat er "geen stems": niets crasht.
- **Zonder stems:** lege track; "alleen nummers uit de library worden gesplitst" (los
  bestand, demo); "stems niet geladen (reden) — je hoort audio.wav"; "wacht op splitsen in
  4" met ×; "splitsen in 2: 42%" met balk en × (stoppen = tweede klik); "2 stems staan klaar —
  laad het nummer opnieuw"; "splitsen mislukt: reden" met splitsen in 2 · 4; "geen stems"
  met splitsen in 2 · 4 (uit, met de reden, als de splitter ontbreekt).
- **Past:** één regel van 40 px (strips 30 px + 10 px marge), ook zonder stems (geen sprong
  bij een focuswissel). Op 1440×790 met vier stems + rest: de kolommen houden faders van
  124 px, niets loopt over, geen tekst onder 11 px. Op 1920×1080 groeien de strips tot
  320 px, faders 200 px. Met de rij open wordt het focusdeck wat lager, dezelfde regels als
  bij AUTO/KLANKSCHAAL (`body:has(#stems:not(.hidden))`).
- **Meldingen boven een open rij:** de meldingen stonden onderaan in het midden, precies
  over de zang/rest-knoppen van de rij (een foutmelding blijft staan tot je klikt). Met een
  rij onderaan open (stems, auto óf klankschaal) staan ze nu 58 px hoger, over de onderkant
  van de mixer zoals zonder rij. Kleine CSS-regel, ook voor de twee bestaande rijen.

### 3. De library-kolom (`src/ui/library-lijst.js`, `src/ui/library-panel.js`)
- Kolom **stems** tussen grid en LUFS, 84 px, niet sorteerbaar: `—`, `2`, `4`, `wacht`,
  `42%` (hele procenten, nooit 100% zolang hij bezig is), `fout` (reden in de tooltip).
- Knoppen in de cel: zonder stems of na een fout **2 · 4**; met twee stems **4** (opnieuw in
  vier, vervangt de twee); met vier niets; open **×** (annuleren; een lopende split stoppen =
  tweede klik binnen 3 s). Ontbreekt de splitter, dan staan 2 en 4 uit met de reden.
- `stemsCelHtml(t, staat)` is puur en geëxporteerd: het paneel werkt bij elke peiling
  **alleen de stems-cellen** bij (vergeleken met wat het zelf schreef), en niet terwijl je
  in de lijst drukt (`_vast`, zoals de ingest-strook): een knop die tussen indrukken en
  loslaten vervangen wordt krijgt in Chrome geen klik — dat gold ook voor de laadknoppen.
- **Opnieuw splitsen terwijl een track het nummer MET stems speelt: geweigerd**, met uitleg.
  De server vervangt `stems.wav` bij succes (2 → 4); het deck leest daar met Range-verzoeken
  uit, en met een ander aantal kanalen is dat ruis. Zie "Nodig van andere sporen".
- Klaar → de lijst ververst (de rij krijgt `stems` van de server).

### 4. Ingest-strook (`src/ui/ingest-strook.js`)
- In de kop van het library-paneel: **stems 2 · 4 · geen**, onthouden in localStorage
  `varve.stems.standaard` (standaard 2; lezen én schrijven in try/catch, ook een
  localStorage die al bij het lezen gooit).
- Mee in `POST /api/ingest` (`stems` bij `{ url }` en bij `{ urls }`), in de upload
  (`&stems=`, ook met `&vooraan=1`) en bij "opnieuw" na een serverherstart (dan de keuze van
  NU: de lijst van de server zegt niet wat er toen gekozen was).
- Ontbreekt de splitter, dan is de keuze gedimd met de reden in de tooltip (binnenhalen
  werkt wel).

### 5. De stems-rij van de server (`src/ui/stems-wachtrij.js`)
- Eén `StemsWachtrij` voor de hele mixer (`window.stemsWachtrij`): kolom, rij en kolomkop
  lezen eruit. Peilt `GET /api/stems` elke 1,5 s **alleen** zolang er iets open staat (wacht,
  bezig) of iemand kijkt (library-paneel open, STEMS-rij open); verder bij het opstarten, na
  een ingest en na elke splits/annuleer.
- Na een POST of DELETE wacht hij een peiling af die al onderweg was en peilt dan opnieuw
  (`peilNa`): anders zag de rij zijn eigen nieuwe opdracht pas een tik later (gevonden in de
  headless-doorloop, nu getest).
- Gebeurtenissen: `klaar` en `fout` alleen voor wat veranderde terwijl de pagina meekeek
  (niet bij de eerste peiling); `herstart` als de server een andere run-id geeft terwijl er
  iets open stond (die rij staat in zijn geheugen). De rij meldt ze onderaan.
- Een server zonder stems (404): `ontbreekt`, beschikbaar false met "deze server kent
  /api/stems niet". Splitsen geeft een tekst voor `meld()`, gooit nooit.

### 6. Kolomkop
- Naast het tracknummer in elke kolom een klein teken (11 px): **S2** / **S4** = de track
  speelt met stems; **gestippeld S2** = staan klaar, herladen geeft ze; **S!** (rood) =
  stems.wav laden mislukte, je hoort audio.wav. Uitleg in de tooltip. `spiegel.js` vraagt
  het per kolom aan de rij (`stemsVan`).

### 7. Controlekamer (`src/controle/controle.js`)
- Tegel **Stems** na Ingest-rij: "1 bezig, 2 wacht" met wat er loopt ("een album · in 4 ·
  31%"); "leeg · splitter klaar"; rood "splitter ontbreekt" met de reden; de laatste
  mislukte; "onbekend" bij een server zonder de route (geen reden om de server als weg te
  tonen). De tegel is puur (`stemsTegel` in `stems-weergave.js`).

### 8. Pure kant (`src/ui/stems-weergave.js`)
`STEM_NAAM` (zang, rest, drums, bas, overig), `VOLGORDE`, `aantalOpBus`, `opdrachtVoor`
(een open opdracht gaat voor, anders de laatste afgelopen), `perNummer`, `stemsCel`,
`rijStand`, `kolomTeken`, `stemsTegel`. Geen DOM, geen fetch.

---

## Getest

- `node test/alles.mjs`: **40 bestanden, 3759 checks, alles groen**, twee keer (na de code en
  vlak voor de laatste commit); de bekende tijdmeting in vormen-isomorf bleef groen.
  - `library-lijst.test`: 66 → 128 (kolom en cel in alle standen, ontsnappen, opdracht die
    telt, StemsWachtrij met een nep-fetch: 404, eerste peiling, klaar/fout één keer, herstart,
    kijkers, POST/DELETE, `peilNa` met een peiling onderweg; de keuze: lezen/bewaren met een
    opslag die gooit, en wat de strook naar de server stuurt, ook de upload-url).
  - `spiegel.test`: 61 → 86 (`aantalOpBus` met en zonder actions, volgorde en namen, de rij
    in index.html met schuif/kill/hold per stem, `rijStand` en `kolomTeken`).
  - `controle.test`: 29 → 38 (de tegel).
  - `wachtrij.test` (van het serverspoor, test de strook): ongewijzigd groen.
- **Headless in deze branch: `node tools/headless/stems.mjs --nep`** — 52 checks groen
  (machine zwaar belast, load ~20, soms 1–3 beelden per seconde: daarom wacht het script op
  wat het scherm laat zien, nooit een vaste tijd). Wat het doet: de keuze (standaard 2, 4
  onthouden na herladen), POST /api/ingest met `stems: 2`, de kolom in alle standen met de
  muis (splitter weg, wacht, 42%, × tweede klik, klaar, fout + melding), laden met een
  ontbrekend stems.wav (terugval op audio.wav, melding, S!), de rij met nagebootste stem-actions
  (twee en vier, kill met de muis, schuif volgt de bus, dubbelklik, shift + vasthouden),
  opnieuw splitsen geweigerd, klaar terwijl het nummer al op een track staat (herladen,
  gestippeld, melding), de voortgang in de rij, layout op 1440×790 en 1920×1080, de
  Controlekamer (leeg, 1 bezig/1 wacht, splitter weg).
- **Met de echte engine (niet gecommit):** een kladkopie in de scratchpad met mijn ui plus de
  engine-bestanden van `stems/engine` (`6a9316d`), stems.wav uit het geheugen
  (`geheugenHaal`, toon × gewicht zoals de nep-splitter). Gemeten aan de master-analyser,
  met de muis op de kill-knoppen:
  - twee stems: zang weg **0,250**, zang + rest weg **0,000**, zang terug **0,750**, alles
    terug **1,000**; shift + vasthouden **0,250**, losgelaten 1,000;
  - vier stems: drums weg **0,900**, + bas **0,700**, rest (groep) weg **0,400**, alles weg
    **0,000**, terug **1,001**;
  - schuif volgt de engine, dubbelklik = vol, een demo erna op dezelfde track = "geen stems",
    teken weg; layout op beide maten groen. Mijn tests (spiegel, library-lijst, controle) en
    engine/regels draaien ook groen in die kopie.
- Foto's (in `tools/headless/uit/`, niet in git): `stems-nep-twee-1440.png`,
  `stems-nep-vier-1440.png`, `stems-nep-vier-1920.png`, `stems-nep-library-1440.png`,
  `stems-nep-library-1920.png`, `stems-nep-kolom-bezig.png`, `stems-nep-rij-bezig-1440.png`,
  `stems-nep-herladen-1440.png`, `stems-nep-controle.png`.

## Niet getest

- **De volledige doorloop van `stems.mjs` (zonder `--nep`)**: de routes `/api/stems`, de
  witte lijst voor `stems.wav`, `test/nep-stems.mjs` en de stems-rij na de ingest bestaan
  nog niet in `stems/server` (`bb7fe56`: splitter en schema v8). Het script stopt in deze
  branch netjes met "deze server kent /api/stems niet". De meetlogica ervan is gelijk aan de
  engine-proef hierboven.
- Niets in Clay's Chrome, niets op de APC, niets beluisterd (alleen gemeten).
- De upload met `&stems=` tegen een echte server; de "herstart"-melding live.
- Een album van een uur met stems in de rij (alleen de 14 s-toon).

## Afwijkingen van het contract (klein)

1. **Kill op het scherm: klik = schakelaar, shift + vasthouden = drukknop.** Het contract
   noemt `.kill` en `.hold` maar niet hoe het scherm ze bedient. (In de APC-klankmodus is
   het andersom, pad = vasthouden; voor de muis is een schakelaar handiger. De APC-mapping
   is een vraag voor Clay.)
2. **Opnieuw splitsen wordt geweigerd** zolang een track het nummer met stems speelt (zie
   boven). Niet in het contract; zonder dit kan één klik in de library ruis op de zaal geven.
3. **Bij twee stems een knop "4"** in de kolom (opnieuw splitsen in vier). Valt onder
   "splitsen (2 of 4)", en het contract noemt 2 → 4 bij de server.
4. **Kolomkop met drie standen** (speelt met stems / klaar, herladen / mislukt) in plaats
   van alleen "heeft stems": zo is "herladen geeft ze" ook zichtbaar met de rij dicht.
5. **Meldingen boven een open rij onderaan** (CSS, ook voor auto en klankschaal).
6. `laadLibrary` geeft `{ stems }` terug (voor de melding "met 2 stems"); de auto-DJ gebruikt
   de terugkeerwaarde niet.

## Nodig van andere sporen

**Server**
1. **stems.wav niet vervangen onder een spelend deck.** Bij succes verhuist de wachtrij
   `stems.wav` over de oude heen (2 → 4, `opnieuw`); een deck dat het oude bestand speelt,
   leest daarna met Range-verzoeken uit het NIEUWE bestand, met een ander aantal kanalen:
   ruis. De ui weigert een nieuwe split zolang een track het nummer met stems speelt, maar
   kan niet voorkomen dat een split die al in de rij stond klaar komt terwijl het nummer
   (net) met stems geladen is, en ook niet "opnieuw binnenhalen". Voorstel: een bestandsnaam
   per set (`stems-<aantal>-<tijd>.wav`, `bestand` in `stems_json` wijst ernaar, de oude pas
   later opruimen). Dan kan de weigering in de ui weer weg.
2. `VARVE_STEMS_CMD`: `stems.mjs` zet standaard `node test/nep-stems.mjs` en start de server
   met cwd = de repo (Clay's pad heeft spaties: "1. Projects"). Graag een commando met
   argumenten accepteren (splitsen op spaties is genoeg met dit relatieve pad), of zeg hoe
   het wel moet; `VARVE_STEMS_CMD=… node tools/headless/stems.mjs` overschrijft het.
3. In `GET /api/stems` per opdracht graag `titel` (meldingen en de tegel tonen die; anders het
   id) en `begon`/`klaar` als getal (ms): de ui kiest daarmee de laatste afgelopen opdracht
   van een nummer.
4. `stems` in elke library-rij én in `GET /api/library/<id>` (terugspelen laadt zo) — staat
   er in `bb7fe56`.
5. Zet de server na een herstart open stems-opdrachten zelf terug in de rij? Dan is de
   melding "de server is herstart: N stems-opdrachten zijn weg" misleidend; zeg het, dan haal
   ik hem weg.

**Engine**
- Niets: met `stems/engine` (`6a9316d`) werkt alles zoals het contract zegt (laadStream gooit
  met een reden bij een verkeerd bestand → terugval; read null; inst als groep; hold).

**Integratie**
- Docs bijwerken: `docs/LIBRARY.md` ("Een kolom erbij": de stems-kolom),
  `docs/CONTROLEKAMER.md` (zeven tegels), `CLAUDE.md` (structuur: `stems-paneel.js`,
  `stems-wachtrij.js`, `stems-weergave.js`, `tools/headless/stems.mjs`), `docs/STEMS.md` §4
  naar "gebouwd", `tools/README.md` (stems.mjs).
- Na het samenvoegen: `node tools/headless/stems.mjs` (zonder `--nep`) draaien.

## Zo draai je `tools/headless/stems.mjs`

```
node tools/headless/stems.mjs              # na de integratie: server + engine + ui samen
node tools/headless/stems.mjs --nep        # alleen de ui (deze branch): /api/stems en de
                                           # stem-actions nagebootst in de pagina
node tools/headless/stems.mjs [--nep] map  # foto's in een andere map (standaard tools/headless/uit)
```

- Eigen server op poort `VARVE_KIJK_POORT` (8793), DevTools op `VARVE_KIJK_DEBUG` (9339),
  tijdelijke database/media/opnames, nep-yt-dlp, de nep-splitter via `VARVE_STEMS_CMD`
  (standaard `node test/nep-stems.mjs`, server-cwd = repo). Chromium headless shell uit de
  Playwright-cache of `VARVE_CHROME`; `navigator.requestMIDIAccess` weggehaald (veilig met de
  APC aangesloten). Raakt :8777 en Clay's library niet.
- Zonder `--nep`, na de integratie: binnenhalen met stems=2 (de kolom wordt "2"), laden op
  track 1, de STEMS-rij, kill met de muis gemeten aan de master (zang weg 0,25 · alles weg 0 ·
  zang terug 0,75 · terug 1 · shift + vasthouden 0,25); een tweede link met "geen", eerst op
  track 3, dan splitsen in 4 via de kolom (track 3 wisselt niet, gestippeld + melding),
  opnieuw splitsen geweigerd, op track 2 (drums weg 0,9 · + bas 0,7 · rest weg 0,4 · alles
  weg 0 · terug 1); layout en foto's op 1440×790 en 1920×1080; de tegel in de Controlekamer.
  Marge op de verhoudingen: ±0,04.
