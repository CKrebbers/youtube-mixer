# Verkenning "effecten": effecten en combinaties (13 okt 2026)

*Verkenner "effecten" voor Clay's werkruimte-vraag. Alleen gelezen: `studio/afmaken` in
`/home/user/youtube-mixer`, `origin/visie/handen` (HANDEN.md, top-40) en de hub-repo. Niets
gewijzigd. Clay's punt 5: "meer effecten toe kunnen passen met alle combinatieknoppen die ik kan
bedenken"; raakt ook punt 1 (knoppen verdelen over APC en Maschine) en punt 6 (werkruimte per
onderdeel van de mix).*

---

## 0. Kort

- **Er zijn 17 effecten** (7 eigen in `fx.js` + 10 uit de filter app in `fx-meer.js`), allemaal in
  één contract (0..1, `eenheid` = `zet()`, staart, `vernietig()`), klikvrij, afvalvrij. Daarboven
  het **rack**: een seriële keten van willekeurig veel effecten met **8 plekken** (macro's) die elk
  meerdere parameters tegelijk bewegen (venster `in`, `from/to`, curve, trappen, glijden). Een
  "knop die veel tegelijk doet" bestaat dus al, **binnen één slot**.
- **Plekken in de keten zijn vast**: per track 1 insert (na EQ, vóór filter en fader), 2 gedeelde
  send-bussen (echo, galm) met een VAST rack, 1 master-insert (vóór de limiter), per stem alleen
  filter + echo/galm-send. Geen vrije routing, geen extra bussen, geen insert per stem, geen
  parallelle takken in een rack.
- **Bediening**: effecten/sends zijn met 17.359 handelingen de tweede groep in Clay's logs (na
  transport/mixer); `track.N.fx.knob.K` staat op #4, `send.a` #5, `fx.mix` #6. Maar: de
  drukvarianten (`*.knob.K.hold`) staan op **geen enkele** controller, de knoppen van de echo- en
  galmbus (`send.a/b.knob.K`) staan op geen controller én niet op het scherm, stemfilter/-sends en
  `video.fx.*` hebben geen vaste plek.
- **"Combinatieknoppen"** kan vijf (eigenlijk zeven) dingen betekenen. Het goede nieuws: het
  belangrijkste deel past in de **control-laag** (mapping + een "superknop"-laag boven de bus) en
  in **data** (racks, mapping, een fx-modus op het grid), zonder de engine te raken. Engine-werk
  is nodig voor vrije routing, extra bussen, parallelle ketens, insert per stem, loop roll/slip en
  modulatie van plekken; daar zitten de drie harde regels (nooit herbedraden met signaal erop,
  geen afval op de audiothread, CPU).
- **Snelste winst, bijna alleen data**: een grid-modus **fx** op de APC (8 kolommen = tracks,
  rijen = `fx.knob.K.hold` = de "worp" per plek). Met tien vingers maak je dan zelf elke
  combinatie: twee pads tegelijk = twee plekken open, op twee tracks tegelijk = twee racks. Kost
  één regel in `lagen.js` (GROEPEN) + mappingregels + `eerder.mjs`.

---

## 1. Wat er is

### 1.1 De effecten (EFFECTEN, `src/engine/fx.js:180`, `...MEER_EFFECTEN` op `fx.js:771`)

| id | naam | parameters (0..1) | staart | bijzonder |
|---|---|---|---|---|
| delay | Delay | tijd, feedback, toon, sync | tot 8 s | twee leeskoppen (geen doppler), op de maat (`DELINGEN`), inloop 30 ms |
| filter | Filter | freq, reso | 0 | |
| crush | Bitcrush | bits, toon | 0 | alleen bits, geen samplereductie |
| gate | Gate | deling, vorm, diepte | 0 | op de maat via playbackRate (exact) |
| phaser | Phaser | snelheid, diepte, feedback | 0,05 s | |
| ringmod | Ringmod | toon, meng | 0 | alleen sinus |
| reverb | Reverb | grootte, toon, meng, freeze | tot 30 s (rt60) | FDN 8 lijnen, freeze houdt vast |
| distortion | Distortion | drive, soort, toon, niveau, meng | 0 | gelijke luidheid, geen oversampling |
| chorus | Chorus | snelheid, diepte, vertraging, meng | ≤ 80 ms | twee koppen per stem |
| flanger | Flanger | snelheid, diepte, vertraging, feedback, meng | ≤ 4 s | zwaai ≥ 2,8 ms (lus) |
| vibrato | Vibrato | snelheid, diepte | ≤ 22 ms | |
| tremolo | Tremolo | snelheid, diepte, vorm, sync | 0 | LFO-buffer op de maat (`fx-lfo.js`) |
| autopan | Autopan | snelheid, diepte, vorm, sync | 0 | idem |
| autowah | Auto-wah | gevoel, basis, bereik, reso, aanzet, verval, meng | ≤ 2 s | worklet (omhullende) |
| pitch | Pitch | interval, meng | 0,1 s | worklet, ~45 ms achter met meng 1 |
| compressor | Compressor | drempel, ratio, aanzet, verval, makeup, meng | 11 ms | schuift de track 6 ms |
| widener | Breedte | breedte, haas | haas + 5 ms | |

Daarnaast, buiten de racks: EQ-kill per band (`.kill.*`, `.kill.*.hold`), bipolair trackfilter,
stem-kill/-niveau/-filter/-sends/-toon (`track.N.stem.<s>.*`), rem, bend, keylock/transpositie,
en het beeld: `video.fx.*` (met `.hold`), vormlagen, `video.black/freeze/flash`.

**Ontbreekt t.o.v. DJ-software / de filter app** (EFFECTEN.md "Wat de filter app beter doet" en
eigen zoektocht in `actions.js`/`deck.js`): loop roll / beat repeat (stotteren op de tel), slip
(na een roll of rem verder waar je had moeten zijn), reverse/backspin, ping-pong delay,
samplereductie in de crush, auto-filter op de maat (kan met `fx-lfo.js`), ruis-riser, het
"geheugen" van de filter app (bewust niet: zie EFFECTEN.md).

### 1.2 Het rack (`src/engine/rack.js`)

- Keten in serie (`bouwKeten`, `fx.js:792`); onbekend effect blijft bewaard en staat uit.
- Macro = plek 1..8 (`actions.js:819` definieert er 8 per slot) met links
  `{ target: 'slot.param', in:[a,b], from, to, curve: lin|exp|log|s, steps }` (`resolveLink`,
  `rack.js:47`). Venster `in` laat links NA elkaar komen op één knop ("eerst mix open, dan
  feedback"). `from > to` keert om.
- `glide` per macro (s, ≤ 600): knop meteen, geluid glijdt op de audioklok (`fx.js:1004`, `:1045`).
- Botsing: **hoogste plek wint** (`rack.js:73`). Het veld `conflict` staat al in het schema
  (`rack.js:102`, `:199`) maar `resolveMacros` kijkt er niet naar; `out: {trim, mix}` ook niet.
- Instellen op het gehoor: DICHT/OPEN (`neemOp`, `rack.js:241`).
- Racks horen bij het NUMMER (library, `tracks.id`); 8 sjablonen in `racks/sjablonen.json`:
  Oplossen (filter>delay>reverb>phaser), Dub-worp, Getij, Draaikolk, Oude band, Hakker, Koor, Kwaak.
- De rack-editor (`src/ui/rack-editor.js:118`) werkt ALLEEN op `engine.deck(id).fx`: niet op de
  master (MASTER.md:233) en niet op de bussen.

### 1.3 Drukvariant (momentary) — `drukknop`, `actions.js:95`

Indrukken = plek op 1 (direct, geen glijden), loslaten = terug naar de stand van vóór; wisselt het
rack tijdens het drukken, dan niet terug. Bestaat voor `track.N.fx.knob.K.hold` (`:825`),
`send.a/b.knob.K.hold` (`:893`), `master.fx.knob.K.hold` (`:913`). Verder `.hold` op kill
(`:677`), stem (`:694`), video.fx (`:1295`), `video.black.hold`. **Geen** hold op `send.a/b`
(de dub-worp van een track naar de echo), `fx.mix`, `filter`, `fx.bypass`.

---

## 2. Waar zitten ze in de keten

```
track (deck A..H, 8 stuks; engine.js:17)
  bron (worklet, 4 stereo-uitgangen) ─ stemIn[k] ─┬─ (stemfilter op aanvraag) ─┐
                                                   └─ stem-sends A/B ── spiegel van de fader ──┐
  trim → EQ laag/mid/hoog → [INSERT-SLOT: rack] → hpf → lpf (trackfilter) → fader → xfade → master
                                     (deck.js:132-137, audio-graph.js:63-64)    │
                                                                         send A / send B (na fader, vóór xfader)
                                                                                │
  bus A "Echo" (InsertSlot, delay op de maat, mix 1)  ←─────────────────────────┤ engine.js:37-53, :167-179
  bus B "Galm" (InsertSlot, reverb, mix 1)            ←─────────────────────────┘
        └──→ master.input
  sampler, klankschaal, instrumenten (instrument via chain.input, dus door de hele strip)
master: input (gain) → [INSERT-SLOT: master-rack] → limiter (worklet) → analyser → zaal/kop/opname/vormen
```

| Onderdeel | Effectplek | Aantal | Wisselbaar | Bediening |
|---|---|---|---|---|
| track | 1 insert (rack, serieel, 8 plekken) | 8 | ja: rack per nummer, `rack.next/prev`, `fx.next` | APC device.rack, Maschine pagina.rack, Xboard knop 9–16 |
| stem | filter (bipolair), echo- en galm-send, kill, niveau, toon | 8×4 (of ×2) | nee (vaste functies) | scherm STEMS-rij; APC alleen kill (grid.stems) |
| send-bus | 1 rack per bus, VAST (`SEND_RACKS`) | 2 | **nee** (geen action, geen UI; engine kan het wel: `zetRack`) | `send.a/b.knob.K` bestaan, maar staan nergens |
| master | 1 insert (rack) | 1 | ja: `master.rack.next/prev` (sjablonen, localStorage) | APC device.master (Shift + Clip/Device View) |
| sampler/klankschaal | geen eigen insert; klankschaal stuurt naar de bussen | — | — | — |

**Hoeveel tegelijk:** per track één rack, maar dat rack mag zo lang zijn als je wilt (geen grens
in de code; CPU is de grens). In totaal dus 8 + 2 + 1 = 11 inserts tegelijk, elk een keten. Tijdens
een rackwissel bestaan oud en nieuw naast elkaar tot fade + staart (`fx.js:941-944`): bij een
reverb tot 30 s, en snel doorbladeren stapelt oude ketens op (`this.oud`).

---

## 3. CPU (wat gemeten is)

| Meting | Waarde | Bron |
|---|---|---|
| Graaf met 8 tracks, niets speelt | 129–132 ms CPU per s audio (~13% van een M1-kern) | STEMS.md:377-381 (offline, ±10%, belaste machine) |
| Alle stems spelen, stemkanalen open | 164–170 ms/s | idem |
| 32 stemfilters aan | 246 ms/s (≈ 2,5 ms per filter) | idem |
| 64 stem-sends open | 171 ms/s (gains zijn bijna gratis) | idem |
| **Een insert-slot per stem (delay, mix 0)** | 345 ms/s: **≈ 5,5 ms/s per slot, ook stil** | STEMS.md:383-386 → niet gebouwd |
| Streamkern, 8 decks | 57,5 ms/s (5,75%) | AUDIOPAD.md:11 |
| Keylock, 8 decks | ~16% van een kern (gespreid rekenen verplicht) | CLAUDE.md keylock |
| fx-worklets (toonhoogte + omhullende) | 11 µs per blok (~4 ms/s) | EFFECTEN.md |
| Limiter | ~16 µs per luid blok (~6 ms/s) | MASTER.md:200 |
| 8 decks × rack van 4 nieuwe effecten | **niet gemeten** | EFFECTEN.md "Wat NIET getest is" |

Afleiding (aanname, niet gemeten): elke track heeft nu al een insert met een delay op mix 0
(`deck.js:136`), dus de 8 track-inserts kosten stil al ~44 ms/s. Een extra slot (bus, stem-insert,
groep) kost minstens ~5,5 ms/s, plus wat zijn effecten rekenen (Chrome's eigen nodes per effect
zijn niet gemeten). Een "matrix van alles overal" is dus geen optie; **op aanvraag aanmaken** (zoals
de stemkanalen, STEMS.md §5) wel. Het audiobudget per blok is 2,67 ms; waar Chrome op de M1 echt
gaat haperen met video/WebGL ernaast is niet gemeten.

---

## 4. Bediening nu (mapping, controllers, logs)

- **APC** (`mappings/apc40mk2.json`, 702 regels): device.rack = `fx.knob.1–8` van de focus;
  device.strip knop 7 = `fx.mix`, knop 8 = `fx.knob.1`; Device ◀ ▶ = rack; On/Off = bypass;
  device.master = `master.fx.knob.1–7` + mix. **Geen enkele `.hold`-regel voor fx**, geen
  `send.a/b.knob`, geen stemfilter/-send, geen grid-modus voor effecten.
- **Maschine** (`mappings/maschine-mk2.json`, 73 regels): pagina.rack = `fx.knob.1–8`
  (relative-2c, shift = fijn), pagina.strip = sends/fx.mix/filter. Pads: geen fx-modus. Vrij volgens
  MASCHINE.md:67: F1–F8, GRID, NOTE REPEAT (en meer).
- **Xboard49**: knop 9–16 = `track.{speel}.fx.knob.1–8` (CC's zijn een aanname).
- **LPD8** (via de hub): rollen alleen beeld.
- **Vrije APC-plekken** (HANDEN.md op `origin/visie/handen`): 23 shift-combinaties in de basis
  (A|B 1–8 met shift, ◄ ► device, On/Off, Lock, master, Stop All, Pan/Sends/User, Play, ▲▼◄►,
  footswitch), 35 vrije pads in grid.auto, 28 in grid.video, 15 in grid.sampler.
- **Top-40 uit Clay's logs** (HANDEN.md §4): `track.N.fx.knob.K` 5.064, `send.a` 4.765, `fx.mix`
  3.717, `send.b` 2.280, `filter.glide`/`send.a.glide` (auto-DJ), `video.fx.pixel` 1.117,
  `video.fx.trails` 596, `video.fx.grain` 490, `track.N.stem.drums.send.b` 220. Per groep:
  effecten/sends 17.359 (tweede, na transport/mixer 28.089). Effecten zijn dus een hoofdzaak.

### Wat de mapping kan en niet kan (`src/control/mapping.js`)

- Eén regel = één signature → één action (`leesRegels`, `:117-147`; dubbel = "laatste wint").
- Modi: trigger, absolute (soft-takeover), relative-2c, relative-bin, endless (`:52`).
- Eén modifier: shift (`shiftSig`, `:654-660`). Mapjes (`laag`) per groep, met **gluren**
  (vasthouden ≥ 400 ms = tijdelijk mapje, `lagen.js:75`): dat is al een vorm van
  "knop A vast + knop B = iets anders".
- Loslaten gaat naar de action van het indrukken (`vast`, `:663-670`).
- Variabelen `{focus}`, `{speel}`, `{plek}` (`resolveTarget`).
- Kan NIET: één knop → meerdere actions; een willekeurige knop als modifier (akkoord); een
  value-action momentary of latch maken met een eigen waarde; tap-vs-hold per regel.

---

## 5. "Alle combinatieknoppen die ik kan bedenken": zeven betekenissen

Voor elke betekenis: wat er al is, wat als DATA kan, wat code vraagt (control-laag of engine), en
de toets aan de drie regels en VISIE §5.

### (1) Eén knop beweegt veel tegelijk ("macro van macro's")

- **Er al**: binnen één rack: een plek stuurt willekeurig veel parameters, met vensters
  na elkaar, curves en glijden. Sjablonen "Oplossen" (6 macro's, 9 links), "Koor" (vensters).
- **Ontbreekt**: één knop over SLOTS heen (twee tracks, track + bus + master, track + video), of een
  knop die andere plekken stuurt.
- **Voorstel: "superknop" in de control-laag** (`src/control/superknop.js`, puur): data
  `{ naam, links: [{ action, in, from, to, curve, steps }] }`, opgelost met DEZELFDE `resolveLink`
  uit rack.js (één rekenregel), en uitgevoerd als gewone `invoke()`s op de bus. Een superknop is
  zelf een action (`super.K`, 0..1, met read = eigen stand) en dus te koppelen, te leren en op het
  scherm. Voorbeeld "dub-druk": `track.{focus}.send.a` 0→1 (in 0–0,3), `send.a.knob.2` (herhaling)
  0,5→0,9 (in 0,3–1), `track.{focus}.filter` 0,5→0,75, `video.fx.trails` 0→0,6.
  - Regel 1: engine raakt niets (alles via de bus). Regel 2: alles 0..1. Regel 3: glijden van de
    superknop via de bestaande `.glide`-actions of via `zetDoel`, niet met een eigen teller.
  - Handelingenlog: óf de superknop loggen en zijn kinderen bij terugspelen overslaan
    (OVERSLAAN-lijst), óf alleen de kinderen loggen. Kies één, anders dubbel. Advies: de kinderen
    loggen (dan klopt terugspelen ook als de superknop-definitie later verandert) en `super.*` in
    OVERSLAAN.
  - Soft-takeover/LED: de kinderen veranderen onder de knoppen van de APC; met endless-ringen is
  dat geen sprong (de ring toont de softwarestand), met faders wel takeover.
  - Kosten: control-laag + scherm (een editor zoals DICHT/OPEN) + opslag. Geen CPU.
- **Klein engine-alternatief**: `conflict` in rack.js echt gebruiken (`som`, `max`, `vermenigvuldig`
  naast `hoogste-plek-wint`): dan kunnen twee plekken op één parameter samenwerken in plaats van
  dat de hoogste wint. Puur rekenwerk in `resolveMacros`, data-keuze per rack, gouden test in
  rack.test. Combineert met (2): plek 1 + plek 2 ingedrukt = som.

### (2) Knoppen combineren: A+B ingedrukt = iets anders, akkoorden op de pads

- **Er al**: shift (één modifier), gluren (scene-knop vasthouden + pad = pad uit dat mapje),
  CONTROL op de Maschine (vasthouden = uitleg), de hubtoets-akkoorden in de hub (Bank + …).
  En: **meerdere `.hold` tegelijk vasthouden IS al een akkoord**: elke drukknop werkt los, dus
  twee pads = twee plekken open. Dat geeft zonder akkoordlogica 2^n combinaties.
- **Voorstel A (data, na (5))**: de fx-matrix hieronder maakt dat bespeelbaar.
- **Voorstel B (control-laag)**: een veld `met` in een regel: `{ in: "note:0:53", met:
  "note:0:82", action: … }` = geldt alleen zolang `note:0:82` ingedrukt is. Generaliseert shift
  (`sleutelVan` wordt `sig#met@laag`). Probleem: de knop die je vasthoudt heeft zelf ook een
  action. Oplossingen, kies per knop in de data: (a) alleen knoppen zonder tijdkritische action
  als modifier (scene-knoppen, Bank, footswitch, Shift) — zoals gluren al doet; (b) "tap of hold":
  de eigen action pas bij loslaten als er geen akkoord was (vertraagt die action: nooit op play,
  cue of een worp). Over twee apparaten (Maschine-knop vast + APC-knop) vraagt het een gedeelde
  "ingedrukt"-stand tussen `maschine.js` en de APC-mapping: dat is apart werk, eerst melden.
- **Akkoorden op de pads** in de muzikale zin (meerdere pads = één nieuwe action): alleen zinvol
  als "pads tegelijk" iets ANDERS moet doen dan de som van elk; voor effecten is de som (A) bijna
  altijd wat je wilt. Niet bouwen zonder concreet voorbeeld van Clay.

### (3) Effecten stapelen per onderdeel (track, stem, bus, master) met vrije routing

| Wens | Wat het vraagt | Data / code | Risico |
|---|---|---|---|
| ander rack op de echo- of galmbus | `send.a/b.rack.next/prev` + opslaan + UI; engine heeft `zetRack` al | klein: actions + scherm + opslag | geen (klikvrij bestaat) |
| rack-editor op master en bussen | editor laten werken op elke InsertSlot (nu `deck.fx` vast, `rack-editor.js:118`) | klein-middel, ui | bewaren: master-rack nu op naam in localStorage |
| langere/rijkere ketens per track | al mogelijk (data in racks) | data | CPU (niet gemeten) |
| parallelle takken in een rack (droog + galm + crush naast elkaar) | `bouwKeten` met takken; nog steeds "hele keten bouwen en kruisfaden" | engine, middel | CPU per tak |
| extra bussen (C, D) of groepsbussen (tracks 1–4) | per deck extra send-gains + stem-spiegels (de spiegels moeten mee in `applyUi`, `_glijParams`, `_glijDoelen`) | engine, middel | +5,5 ms/s per bus-slot; vergeten spiegel = echo blijft open |
| vrije routing (bus → bus, track → bus → master-tak) | een matrix van VASTE gains (altijd verbonden, op 0) in plaats van connect/disconnect | engine, groot | feedbacklussen (Q-regel: elke lus een vertraging en geen bult); nooit herbedraden met signaal erop |
| insert per stem | InsertSlot per stem, op aanvraag (zoals stemkanalen) | engine, middel | gemeten 5,5 ms/s per slot stil; 32 = +110% |
| pre/post-fader keuze van de insert | tweede aansluitpunt + kruisfade | engine, klein-middel | twee paden even lang (latentie-effecten: compressor 6 ms, pitch 45 ms) |
| effect op sampler/klankschaal | eigen InsertSlot op hun uitgang | engine, klein | CPU |

Advies: eerst de twee kleine (bus-racks wisselbaar, editor op alle slots). Vrije routing is het
grootste engine-werk en het grootste risico; alleen bouwen als Clay een concreet geval noemt dat
niet met "rack op de bus" kan.

### (4) Momentary versus vast

- **Er al**: `.hold` (momentary naar 1) voor plekken van track/bus/master, kill, stem, video.fx;
  schakelaars voor bypass/kill (shift + pad in grid.klank/stems = vastzetten).
- **Ontbreekt**: hold op `send.a/b` (de klassieke dub-worp), `fx.mix`, `filter`, bypass; een
  worp naar een ANDERE waarde dan 1; latch (druk = aan, nog eens = uit) voor elke value-action;
  "kort = vast, lang = momentary" (Traktor/Ableton).
- **Voorstel (control-laag, één keer, dan data)**: een mapping-modus `druk` voor ELKE
  value-action: `{ in, action: "track.{focus}.send.a", mode: "druk", naar: 1 }` = indrukken zet
  `naar` (direct), loslaten zet terug wat er stond (de logica van `drukknop`, `actions.js:95`,
  maar in mapping.js, zodat hij voor alle 3234 actions werkt). Plus `mode: "latch"` (wisselt
  tussen `naar` en de vorige stand) en een optie `lang: 400` (kort = latch, lang = momentary,
  dezelfde 400 ms als gluren). Daarna is elke combinatie van momentary/vast een DATA-keuze.
  - Let op: terugzetten bij loslaten moet via de bus (anders mist het log de terugweg) en de
    regel "loslaten gaat naar de action van het indrukken" geldt al.
  - De bestaande `.hold`-actions blijven (oude mappings, het log).

### (5) Een effect-matrix op het grid

- **Voorstel grid-modus `fx`** op de APC (vierde letterkleur, bv. paars/violet; Shift + een vrije
  plek of ▲ ▼): kolom = track 1–8, rij 1–5 = `track.N.fx.knob.{1..5}.hold` (of 4–8: de "worp"-plekken
  van de sjablonen), LED uit de read (`druk.ingedrukt`) en donker als de plek in dat rack niet
  bestaat (read null → uit). Scene 1–5 = `master.fx.knob.K.hold` of `send.a/b.knob.K.hold`;
  Stop All = alles los. Shift + pad = latch (zodra (4) er is), anders shift + pad = `fx.bypass`.
  - **Kost**: één regel in `src/control/lagen.js:77-91` (GROEPEN.grid.knoppen + volgorde) +
    `LAAGNAAM`; de `layer.grid.fx`-action volgt vanzelf (`actions.js:1467`); 40–50 mappingregels;
    `node tools/mapping/eerder.mjs`; beschrijvingen bestaan al grotendeels (`apc-beschrijf.js:195`
    voor master; track-hold controleren); `soorten.js` kent de soort fx al.
  - Omdat een plek een PLEK is (wat hij doet zegt het rack), werkt de matrix voor elk rack en elk
  nummer zonder opnieuw koppelen. Combinaties = vingers.
- **Maschine**: een padmodus fx (bv. op GRID of NOTE REPEAT, beide vrij) met 16 pads = 8 plekken
  van de focus-track + 8 van de master, of 4×4 tracks × plekken. Code in `maschine.js`
  (padmodi zijn code: `UITLEG`, `PADMODI` in maschine-kaart-plan.js), daarna data in
  `maschine-mk2.json`. NOTE REPEAT is de natuurlijke plek voor een loop roll / beat repeat (zie 7).
- **Taakverdeling APC ↔ Maschine (punt 1 van Clay)**: APC = per track (kolommen: worp per track,
  faders, sends), Maschine = per focus-track diep (rack-pagina op de 8 draaiknoppen + pads als
  worpen + scherm met de echte eenheden). Zo doen de twee nooit hetzelfde.

### (6) Combinaties met de muziek zelf: modulatie van plekken (extra)

- De router voor vormlagen bestaat (`src/analysis/router.js`, `zetModulatie(i, offset)`): bron
  (bas, klap, tel, sectie.nieuw …) → knop, als OFFSET bovenop de knopstand. Voor audio-effecten
  bestaat dat niet.
- Voorstel: `InsertSlot.zetModulatie(plek, offset)` (engine, klein: optellen in
  `_effectieveStanden`), en de router (analysis/, buiten de engine) stuurt hem; bijvoorbeeld de
  echo-feedback die opengaat op `sectie.nieuw`, of de filter die pompt op de klap. Regel 1 blijft
  (engine kent geen analysis). Regel 3: de router loopt op rAF (30–60 Hz): voor een filterzwaai
  prima, voor iets op de tel niet (daarvoor bestaat `fxKlok`).

### (7) Scènes en morphen (extra; "Octatrack-idee", al genoemd in `rack.js:228`)

- Een **scène** = de stand van alle plekken van alle slots (+ sends, filter) als data; een
  **morph-knop** = een superknop van scène A naar scène B. Valt samen met (1): de superknop met
  `from` = stand in A en `to` = stand in B. Opslag bij de werkruimte (zie §7).
- Plus nieuwe "transport-effecten" die echt engine zijn: **loop roll** (momentary beatloop) met
  **slip** (bij loslaten verder waar je zonder roll was: schaduwpositie P0 + R·(t − T0), regel 3
  past precies op de segmenten van de StreamBron), beat repeat, reverse. Dat zijn de meest
  gevraagde "combinatieknoppen" in DJ-software en ze ontbreken (`grep roll|slip|reverse` = niets).

---

## 6. Wat kan als DATA, wat vraagt code

| | Data (nu) | Control-laag (eenmalig code, daarna data) | Engine (code, regels audiopad) |
|---|---|---|---|
| (1) veel tegelijk | macro's in racks, sjablonen | superknop over slots, scènes/morph | `conflict`-modi in rack.js |
| (2) A+B | meerdere `.hold` tegelijk vasthouden; gluren | `met` in een regel; tap-of-hold | — |
| (3) stapelen/routing | langere ketens | bus-racks kiezen, editor op master/bussen | parallelle takken, extra bussen, routingmatrix, insert per stem, pre/post |
| (4) momentary/vast | bestaande `.hold` koppelen (learn) | modus `druk`/`latch`/`lang` voor elke value-action | — |
| (5) matrix | — | grid-modus fx (één regel lagen.js + regels), Maschine-padmodus | — |
| (6) modulatie | — | router → plekken | `zetModulatie` op InsertSlot |
| (7) roll/slip | — | — | loop roll, slip, beat repeat |

**Vandaag al zonder één regel code** (learn, Clay's eigen verschil): `track.{focus}.fx.knob.K.hold`
op vrije shift-plekken (bv. Shift + A|B 1–8 = worp plek 1–8 van de focus), `send.a.knob.2`
(echo-herhaling) op een vrije knop, `video.fx.*.hold` op de 28 vrije pads in grid.video.

---

## 7. Effecten in de "werkruimte" (Clay's punt 6)

Wat van effecten in een werkruimte hoort (per onderdeel van de mix een andere):

- welke racks op de bussen staan (nu vast) en welk master-rack (nu localStorage `varve.master.rack`);
- superknoppen en scènes;
- de fx-matrix-indeling (mappingregels als verschil, zoals nu);
- NIET: de racks per nummer (die horen bij het nummer, library) en NIET de live knopstand (sessie).

Zelfde opslagpatroon als mapping/plan/patronen: JSON op de server met `versie` (409 bij botsing),
zodat Claude een werkruimte ook kan schrijven (pijler 3/4: programmeren en instellen).

---

## 8. Voorstel volgorde (klein en geproefd eerst, VISIE §5.4)

1. **E0 (data, geen code)**: met learn de bestaande holds op vrije plekken proberen op de APC.
   Levert het antwoord op "wil ik worpen op pads of op knoppen".
2. **E1 grid-modus fx** (lagen.js één regel + mappingregels + eerder.mjs + mapping.test/spiegel.test).
3. **E2 mapping-modus `druk`/`latch`** (mapping.js + tests): elke value-action momentary of vast.
4. **E3 bus-racks wisselbaar + rack-editor op master/bussen** (actions + ui + opslag).
5. **E4 superknop + scènes** (control-laag, puur, met resolveLink; log-keuze vastleggen).
6. **E5 engine, alleen op Clay's vraag**: `conflict`-modi, loop roll/slip, modulatie van plekken,
   parallelle takken, extra bussen, insert per stem op aanvraag. Elk met renderblok/engine-tests en
   een CPU-meting zoals STEMS.md §5.

---

## 9. Risico's

- **CPU**: elk extra InsertSlot ~5,5 ms/s stil; 8 × rack van 4 effecten nooit gemeten; snel
  doorbladeren van racks stapelt oude ketens tot fade + staart (reverb tot 30 s).
- **Klikken**: vrije routing verleidt tot connect/disconnect met signaal erop. Altijd vaste gains
  en kruisfaden van complete ketens (CLAUDE.md "Effecten wisselen").
- **Lussen**: bus → bus maakt feedback; elk filter in een lus negatieve Q; elke lus een vertraging.
- **Latentie**: compressor (6 ms) en pitch (~45 ms) schuiven een track; in een parallelle tak of
  op een bus geeft dat een kam (EFFECTEN.md open vraag 3).
- **Log dubbel**: een superknop die zelf én zijn kinderen logt speelt dubbel terug.
- **Soft-takeover/LED's**: knoppen die door een superknop of morph veranderen zonder dat je ze
  aanraakt: faders vallen uit takeover, ringen tonen de nieuwe stand (endless is veilig).
- **Te veel vrijheid op het podium**: "alle combinaties" zonder beeld van wat open staat. De
  matrix-LED's (fel = open) en de mapje-balk moeten laten zien welke worpen vastzitten (latch).
- **Proefachterstand** (VISIE §5.4): niets van de effecten (5 okt) is beluisterd, niets van de
  device.master-indeling op de APC nagelopen; eerst proeven, dan bouwen.
- **Akkoorden over twee apparaten**: maschine.js en de APC-mapping delen geen "ingedrukt"-stand;
  dat koppelen raakt de hub/lease-laag.

## 10. Vragen voor Clay

1. Combinatie = vooral **worpen tegelijk** (pads vasthouden) of **één knop die veel doet**
   (superknop/morph)? Of allebei, en welke eerst?
2. Fx-matrix op de APC: kolommen = tracks en rijen = plekken (per track), of 8 plekken van alleen de
   focus-track over meer rijen?
3. Momentary/vast: wil je per knop kunnen kiezen (kort = vast, lang = momentary)?
4. Moet de echo- en galmbus een ander rack kunnen krijgen (bv. per werkruimte), of blijven die vast?
5. Loop roll / slip / beat repeat: gewenst (en op welke controller: NOTE REPEAT op de Maschine?)
6. Een effect per stem (insert), ondanks ~5,5 ms CPU per slot, of genoeg met filter + sends?
7. Vrije routing (bussen naar elkaar, groepen): een concreet voorbeeld dat je nu mist?

## 11. Bronnen (bestand:regel)

- `src/engine/fx.js:180` EFFECTEN · `:771` MEER_EFFECTEN · `:792` bouwKeten · `:845` InsertSlot ·
  `:906` zetRack · `:941-944` oude keten na fade + staart · `:1004` plekEffectief · `:1045` setPlek
- `src/engine/fx-meer.js:314-1035` de tien effecten (distortion … widener)
- `src/engine/rack.js:47` resolveLink · `:73` resolveMacros (hoogste plek wint) · `:102`/`:199`
  `conflict` en `out` in het schema, niet gebruikt · `:152` glide · `:241` neemOp
- `src/engine/engine.js:17` 8 decks · `:37-53` SEND_RACKS (vast) · `:167-179` bussen bedraden
- `src/engine/deck.js:132-137` insert na EQ, vóór hpf; `delay` op mix 0 · `:227-228` stem-spiegels
- `src/engine/audio-graph.js:63-64` trim → EQ → hpf → lpf → fader → xfade
- `src/control/actions.js:95` drukknop · `:793` sends · `:812-833` fx-actions · `:888-895`
  bus-knoppen · `:904-921` master · `:1387-1392` rack.next/prev · `:1467` layer-actions uit GROEPEN
- `src/control/mapping.js:52` MODES · `:117-147` regelvelden · `:573-585` kies · `:654-670` shift en loslaten
- `src/control/lagen.js:75` GLUREN · `:77-91` GROEPEN (grid-modi)
- `src/ui/rack-editor.js:118` editor alleen op `deck.fx`
- `mappings/apc40mk2.json` (702 regels, 0 fx-holds) · `mappings/maschine-mk2.json` (pagina.rack/strip)
  · `mappings/xboard49.json` (knop 9–16)
- `racks/sjablonen.json` (8 sjablonen)
- `docs/EFFECTEN.md`, `docs/MASTER.md:213-234`, `docs/STEMS.md:373-386` (CPU), `docs/AUDIOPAD.md:11`
- `origin/visie/handen:docs/HANDEN.md` §4 (vrije plekken, top-40, groepstelling)
