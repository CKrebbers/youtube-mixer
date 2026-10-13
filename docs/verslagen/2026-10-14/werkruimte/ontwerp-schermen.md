# Ontwerp "schermen": de werkruimte, scherm-eerst (13 okt 2026)

*Architect "schermen". Gelezen: `studio/afmaken` (339310b), `origin/visie/handen` (HANDEN.md,
`handen/voorstel.json`), de hub (`av-app-hub`, PROTOCOL §5, §6, §8, §13, §17), de vier verkenningen
in deze map, en de ongecommitte worktrees van de andere workflow (`wt/controller-invoer`,
`wt/controller-uitvoer`: caches in `mapping.js`/`lagen.js`, LED-laag, `maschine.js`, `midi.js`).
Niets in de repo gewijzigd.*

Clay (13 okt), zes punten: (1) knoppen logisch verdelen over de twee controllers, (2) meerdere
schermen met de iPad, (3) precisie bij het plaatsen van een track, (4) alle tracks tegelijk zien
lopen op het grid, (5) effecten met alle combinatieknoppen die hij kan bedenken, (6) vrijheid over
UI en knoppen: een werkruimte in plaats van een app, per onderdeel van de mix een andere, "echt
complete vrijheid".

---

## 0. Het idee in vijf zinnen

1. **Een werkruimte is één JSON-bestand** (`werkruimtes/<naam>.json`, met versie en 409 zoals de
   plannen) dat zegt welke **panelen** er bestaan, **waar** ze op elk **scherm** staan (Mac,
   tweede venster, iPad) en welke **controller-zones** naar welk paneel wijzen.
2. **Een paneel is een bouwsteen** die zelf zijn stand leest (`read()`) en alleen via de bus stuurt
   (`invoke()`). Dat geldt voor de bestaande rijen (stems, master, …), voor nieuwe vaste panelen
   (uitlijnweergave, fx-matrix, superknoppen) en voor het **vrije paneel**: een lijst actions die
   Clay zelf samenstelt. Zo staat hetzelfde paneel op de Mac, in een los venster of op de iPad.
3. **Controllers wijzen naar panelen, niet naar losse functies.** "De draaiknoppen van de Maschine
   bedienen het paneel FX focus" wordt een fragment van mappingregels in een eigen mapje
   (`werk.<deel>`). Het scherm laat zien welke controller welk paneel bedient. Daardoor is de
   rolverdeling zichtbaar: de APC is de zaal (kolom = track), de Maschine is de focus-track in
   detail.
4. **Per onderdeel van de mix een ander deel van de werkruimte** (`delen` + `volgt`): open je het
   master-mapje, krijgt de focus-track een instrument of gaat de library open, dan schikken
   schermen en controllers zich mee. Dat gebeurt op signalen die al bestaan (lagen, engine,
   library). Er komt geen nieuwe toestand bij, en een deel *erft* van de basis, zodat alleen het
   verschil wordt opgeslagen.
5. **Een werkruimte zegt alleen WAAR iets staat, nooit wat weg is.** Elk scherm heeft een vaste
   lade "alle panelen", de standaardwerkruimte is precies de huidige indeling, en de engine, de
   drie regels en het audiopad veranderen niet. Alleen precisie (spoor W5) voegt een paar
   getallen-actions toe.

---

## 1. Begrippen (één woordenschat)

| woord | wat | waar het staat |
|---|---|---|
| **werkruimte** | het bestand: panelen, schermen, handen, delen, superknoppen | `werkruimtes/<naam>.json`, `/api/werkruimtes` |
| **scherm** | een plek waar panelen staan: `hoofd` (de mixer), `mac-2` (los venster, `paneel.html?s=mac-2`), `ipad`, … | `schermen.<naam>` |
| **vak** | een gebied op een scherm (CSS grid-area), met één paneel of een stapel tabs | `schermen.<naam>.vakken` |
| **paneel** | een bouwsteen: `soort` + `doel` + `items`/`opties` | `panelen.<id>` |
| **item** | één knop, draaiknop, schuif, lamp of rij in een vrij paneel: altijd een action | `panelen.<id>.items[]` |
| **doel** | welke track: `focus` · `tweede` · `speel` · `maatgever` · `kolom` · een getal 1–8 | per paneel, `{doel}` in de action |
| **zone** | een groep fysieke controls: `apc40mk2.device-knobs` (8), `apc40mk2.grid` (40), `maschine-mk2.draaiknoppen` (8), `maschine-mk2.f` (8), `maschine-mk2.pads` (16), … | `zones` in `mappings/<apparaat>.json` |
| **handen** | koppelingen zone → paneel(sloten), optioneel in een mapje of padmodus | `delen.<deel>.handen[]` |
| **deel** | het stuk van de werkruimte dat bij een onderdeel van de mix hoort (`basis`, `master`, `instrument`, `bladeren`, …) | `delen`, gekozen via `volgt` |

**Eén woordenschat voor "welke track".** Nu bestaan er vier: `{focus}`, `{speel}`, kolom en
`{L}`/`{R}`. Er komt één lijst variabelen voor elk apparaat, het toetsenbord en elk paneel:
`{focus}`, `{tweede}` (de vorige focus, nu `{R}`), `{speel}`, `{maatgever}` (nieuw:
`syncMaster()`), `{plek}`, plus `{k}` in herhaalde regels. `{L}` en `{R}` blijven als alias
bestaan, want oude toetsenbord- en mappingbestanden moeten blijven laden (`migreerAction`).

---

## 2. Het datamodel

### 2.1 Het bestand (schema 1), volledig voorbeeld `apc-maschine`

```json
{
  "schema": 1,
  "naam": "apc-maschine",
  "titel": "APC + Maschine (hub)",
  "uitleg": "APC = de zaal (een kolom is altijd een track). Maschine = de focus-track in detail: precisie, effecten met naam, sampler, secties, patronen, bladeren.",
  "vereist": ["apc40mk2", "maschine-mk2"],
  "terugval": "apc-alleen",

  "panelen": {
    "fx-focus": {
      "soort": "vrij", "titel": "FX focus", "doel": "focus",
      "items": [
        { "soort": "rij", "herhaal": "1-8", "item": { "soort": "draai", "action": "track.{doel}.fx.knob.{k}" } },
        { "soort": "rij", "herhaal": "1-8", "item": { "soort": "knop",  "action": "track.{doel}.fx.knob.{k}.hold" } },
        { "soort": "draai", "action": "track.{doel}.fx.mix", "label": "MIX" },
        { "soort": "knop",  "action": "track.{doel}.send.a", "mode": "druk", "naar": 1, "label": "ECHO-WORP" }
      ]
    },
    "precisie": {
      "soort": "vrij", "titel": "Precisie", "doel": "focus",
      "items": [
        { "soort": "draai", "action": "track.{doel}.phase.offset",      "label": "FASE ±½ tel" },
        { "soort": "draai", "action": "track.{doel}.phase.offset.fine", "label": "FASE fijn" },
        { "soort": "draai", "action": "track.{doel}.tempo",             "label": "TEMPO" },
        { "soort": "draai", "action": "track.{doel}.bend.amount",       "label": "BEND %" },
        { "soort": "knop",  "action": "track.{doel}.scrub.back" },
        { "soort": "knop",  "action": "track.{doel}.scrub.fwd" },
        { "soort": "knop",  "action": "track.{doel}.nudge.fine.back", "label": "−1 ms" },
        { "soort": "knop",  "action": "track.{doel}.nudge.fine.fwd",  "label": "+1 ms" },
        { "soort": "knop",  "action": "track.{doel}.sync.bar",        "label": "OP DE 1" },
        { "soort": "lamp",  "action": "track.{doel}.bar.offset",      "label": "MAAT" }
      ]
    },
    "fase-alle": {
      "soort": "vrij", "titel": "Fase per track", "doel": "kolom",
      "items": [ { "soort": "rij", "herhaal": "1-8", "item": { "soort": "draai", "action": "track.{k}.phase.offset" } } ]
    },
    "alle-tracks": { "soort": "uitlijn", "opties": { "vorm": "pagina", "maten": 2, "banen": "spelend+wachtend" } },
    "worpen":      { "soort": "fx-matrix", "opties": { "tracks": "1-8", "plekken": [1, 2, 3, 4, 5], "boven": "master" } },
    "dub":         { "soort": "superknop", "opties": { "nr": 1 } }
  },

  "superknoppen": [
    { "nr": 1, "naam": "dub-druk", "glijden": 0, "links": [
      { "action": "track.{focus}.send.a",  "in": [0, 0.3], "from": 0,   "to": 1 },
      { "action": "send.a.knob.2",         "in": [0.3, 1], "from": 0.5, "to": 0.9 },
      { "action": "track.{focus}.filter",  "from": 0.5, "to": 0.75, "curve": "s" },
      { "action": "video.fx.trails",       "from": 0,   "to": 0.6 }
    ] }
  ],

  "mapjes": {
    "nieuw": {
      "grid.fx":        { "groep": "grid",   "titel": "fx-matrix (kolom = track · rij = plek · scene = master)", "kleur": "violet" },
      "device.uitlijn": { "groep": "device", "onder": "view", "titel": "fase per track (ring = fase t.o.v. de maatgever)", "opAanvraag": "maatgever-en-tweede" }
    },
    "alias":    { "grid.sampler": "grid.fx" },
    "volgorde": { "grid": ["hotcues", "loops", "fx", "video", "klank", "stems", "patronen", "auto"] }
  },

  "delen": {
    "basis": {
      "schermen": {
        "hoofd": {
          "raster": ["focus focus", "kolommen focusdeel", "rijen rijen"],
          "kolommen": "minmax(0,1fr) 390px",
          "vakken": { "focus": ["focus-deck"], "kolommen": ["spiegel"], "focusdeel": ["focusdeel"], "rijen": ["stems", "master", "auto"] }
        },
        "mac-2": { "raster": ["boven", "onder"], "rijen": "2fr 1fr",
                   "vakken": { "boven": ["alle-tracks"], "onder": ["precisie", "fx-focus"] } },
        "ipad":  { "raster": ["a b"], "vakken": { "a": ["worpen"], "b": ["fx-focus", "dub"] } }
      },
      "handen": [
        { "zone": "maschine-mk2.draaiknoppen", "paneel": "fx-focus",  "sloten": "draai", "pagina": "rack" },
        { "zone": "maschine-mk2.draaiknoppen", "paneel": "precisie",  "sloten": "draai", "pagina": "precisie" },
        { "zone": "maschine-mk2.f",            "paneel": "fx-focus",  "sloten": "knop" },
        { "zone": "maschine-mk2.pads",         "paneel": "worpen",    "padmodus": "grid" },
        { "zone": "apc40mk2.device-knobs",     "paneel": "fase-alle", "mapje": "device.uitlijn" },
        { "zone": "apc40mk2.grid",             "paneel": "worpen",    "mapje": "grid.fx" }
      ],
      "regels": {
        "apc40mk2": [
          { "herhaal": "1-8", "in": "note:{k-1}:66", "shift": true, "action": "track.{k}.send.a.hold", "mode": "trigger", "label": "echo-worp {k}" }
        ],
        "maschine-mk2": [
          { "in": "cc:0:24", "met": "note:1:17", "action": "track.{focus}.phase.offset", "mode": "relative-2c", "step": 0.0079, "label": "SWING + wiel = fase" },
          { "in": "cc:0:24", "met": "note:1:18", "action": "track.{focus}.tempo",        "mode": "relative-2c", "step": 0.000667, "label": "TEMPO + wiel" },
          { "in": "cc:0:24", "met": "note:1:16", "action": "track.{focus}.fader",        "mode": "relative-2c", "label": "VOLUME + wiel" },
          { "in": "cc:0:24", "mode": "stappen", "actions": ["track.{focus}.scrub.back", "track.{focus}.scrub.fwd"], "pagina": "precisie", "label": "wiel = jog" }
        ]
      }
    },
    "master":     { "erft": "basis", "schermen": { "hoofd": { "vakken": { "rijen": ["master", "stems"] } } } },
    "instrument": { "erft": "basis", "schermen": { "ipad":  { "vakken": { "b": ["instrument", "patronen"] } } } },
    "bladeren":   { "erft": "basis", "schermen": { "ipad":  { "vakken": { "a": ["library-blader"] } } } }
  },

  "volgt": [
    { "als": { "mapje": "device.master" }, "deel": "master" },
    { "als": { "focus": "instrument" },    "deel": "instrument" },
    { "als": { "library": "open" },        "deel": "bladeren", "schermen": ["ipad"] }
  ]
}
```

### 2.2 Velden en regels

| veld | betekenis | regels (gecontroleerd door `normaliseerWerkruimte`, puur) |
|---|---|---|
| `schema` | 1 | anders 400; migratie per schema zoals `MAPPING_VERSIE` |
| `naam` | bestandsnaam | kleine letters, cijfers, `-`/`_`, ≤ 60 (zoals standen: de Mac-schijf ziet hoofdletters niet) |
| `vereist` | apparaten die er moeten zijn | ontbreekt er één (hub weg, Maschine los), dan geldt `terugval`, met een melding; nooit een half werkende indeling |
| `panelen` | id → `{ soort, titel?, doel?, items?, opties? }` | onbekende `soort` blijft ongeschonden bewaard en toont grijs ("onbekend paneel X"), zoals een onbekend effect in een rack; onbekende action = grijs item + één melding |
| `items[].soort` | `draai` (Knob, endless op de muis), `knop` (pointerdown/up), `schuif` (fader, absolute), `lamp` (alleen lezen), `rij` (`herhaal` + `item` met `{k}`), `tekst` (vaste uitleg) | `mode` alleen `trigger`/`druk`/`latch`; `druk`/`latch` op een value-action met `naar` (0..1); geen `value` die geen 0..1 is (regel 2) |
| `doel` | `focus`·`tweede`·`speel`·`maatgever`·`kolom`·1–8 | wordt `{focus}` enz. vóór de mapping (`resolveTarget` vult in bij het INDRUKKEN, zoals nu) |
| `superknoppen` | `{ nr, naam, glijden?, links:[{ action, in?, from, to, curve?, steps? }] }` | `links` met DEZELFDE velden als een macro in een rack; opgelost met `resolveLink` uit `rack.js`; ≤ 32 links; geen superknop in zijn eigen links (geen lus) |
| `mapjes.nieuw` | nieuwe mapjes in een bestaande groep | alleen groep `device`/`grid`; `onder` = kiesknop waar hij in de rondgang komt; `opAanvraag` = een benoemde voorwaarde uit een vaste lijst (`instrument`, `maatgever-en-tweede`, `stems`), geen vrije code |
| `mapjes.alias` | "dit mapje opent in deze werkruimte dat mapje" | alleen tussen bestaande of nieuwe mapjes van dezelfde groep; zo worden alle regels en lampjes van scene 3 hergebruikt |
| `mapjes.volgorde` | rondgang van ▲ ▼ | alleen namen die bestaan |
| `delen.<deel>` | `{ erft?, schermen?, handen?, regels? }` | `erft` één niveau diep is genoeg (geen ketens > 3); opgeslagen = alleen het verschil |
| `schermen.<s>` | `{ raster: [rijen als grid-areas], kolommen?, rijen?, vakken: { vak: [paneel-id, …] }, vast? }` | het raster is CSS `grid-template-areas`, maar dan gevalideerd (rechthoekige gebieden, ≤ 6×6); `vast: true` = dit scherm volgt geen delen |
| `handen[]` | `{ zone, paneel, sloten?, mapje?, pagina?, padmodus? }` | zone moet bestaan; het aantal sloten en controls hoeft niet gelijk te zijn (de rest blijft leeg); een LPD8-zone en de hubtoets (Bank 0x67) zijn **geweigerd** |
| `regels.<apparaat>` | extra mappingregels, dezelfde vorm als nu, plus `herhaal`, `met`, `mode: stappen/druk/latch` | worden een **fragment** (`bron: 'werk:<naam>'`), gaan nooit in Clay's eigen verschil |
| `volgt[]` | `{ als, deel, schermen? }` | `als` uit een vaste lijst: `mapje` (alleen VAST open, gluren telt niet), `focus` (`nummer`/`instrument`/`leeg`), `library` (`open`), `grid-modus` (`aan`), `hand` (`werk.deel.<naam>` gedrukt); de eerste die klopt wint, anders `basis` |

**Wat er NIET in een werkruimte mag** (witte lijst, net als bij een stand): knopstanden, faders en
posities (dat is sessietoestand: engine en log); racks per nummer (die horen bij het nummer, in de
library); adressen (hub, relay, beeld); "verberg" of "uit" van een paneel of action. Er bestaat
geen veld om de lade "alle panelen" weg te halen. De crossover-regel (`VERBODEN_DELEN` in
`stand-model.js`) blijft dus ook voor werkruimtes gelden.

### 2.3 Waar het staat, en hoe het verschilt van stand en mapping

| | **werkruimte** (nieuw) | **stand / opstelling** (bestaat) | **eigen mapping** (bestaat) |
|---|---|---|---|
| zegt | WAAR panelen staan en welke zone wat bedient, per deel van de mix | met welke BEGINWAARDEN de avond begint (rack, krat, nachtrem, hub-set) | welke knop welke action doet (jouw verschil met de standaard) |
| wisselt | live, zonder herladen; ook vanzelf per deel (`volgt`) | één gebeurtenis (activeren), pas bij de volgende start in de mixer | live (learn) |
| bestand | `werkruimtes/<naam>.json` + `.versies/`, `/api/werkruimtes` (GET/PUT met `versie`, 409) | `standen/*.json`, `/api/standen` | `/api/mapping/<apparaat>` (nu: één sleutel `mapping`) |
| regels | fragment `werk:<naam>`, in mapje `werk.<deel>` en nieuwe mapjes | mag een mapping zetten (alleen APC) | jouw regels winnen altijd van een fragment op dezelfde sleutel |
| verbergt | nooit (lade "alle panelen") | nooit (`VERBODEN_DELEN`) | n.v.t. |
| koppeling | — | een stand mag een werkruimte NOEMEN: nieuw deel `werkruimte: { naam }` in `DELEN` | — |
| in git | de standaardwerkruimtes (`standaard`, `apc-alleen`, `apc-maschine`, `studio`) | `tools/standen/voorbeelden/` | `mappings/*.json` |

Opslag zoals plannen en patronen (`server/plannen.js` als voorbeeld): de server schrijft atomisch,
bewaart de vorige versie in `werkruimtes/.versies/` en weigert met 409 als de `versie` niet meer
klopt. Claude mag het bestand direct schrijven; de mixer en open paneelpagina's zien dat binnen
3 s (dezelfde peiling als `plan-koppeling.js`). Data hoort in de Bureaublad-map (zoals
`patronen/`), de standaardwerkruimtes staan in git.

### 2.4 Hoe het in de mapping valt (geen tweede systeem)

- De mapping zoekt nu in de open mapjes (`edit → device → grid`) en daarna in de regels zonder
  mapje. Het mapje **`werk.<deel>`** (en de erfketen, bijvoorbeeld `werk.master` en dan
  `werk.basis`) komt als **laatste open mapje** in `Lagen.actief()`, ná `grid`. Een werkregel gaat
  dus voor een kale regel (de kern), maar niet voor een regel in een open mapje. Zo kan het
  mapje beeld nooit per ongeluk zijn scene-regie verliezen.
- Wil een werkruimte een mapje zelf anders, dan doet ze dat met een **alias** (`grid.sampler` →
  `grid.fx`) of met **nieuwe mapjes**. Ze overschrijft nooit een regel binnen een bestaand mapje.
  Dat is een bewuste grens: een werkruimte vult aan en verlegt, ze herschrijft niet.
- `handen` worden bij het laden gegenereerd tot regels (`werk-handen.js`, puur): zone-slot *i* →
  het *i*-de item van de gekozen `sloten` in het paneel, in het genoemde mapje (of `werk.<deel>`),
  met de modus die bij de zone hoort (APC-ringen `endless`, Maschine `relative-2c`, pads `trigger`).
- `Mapping.vervangFragment(bron, doc)` (nieuw): eerst alle regels met die `bron` weg, dan
  opnieuw. `voegToe` vult nu alleen aan en laat oude regels staan. Jouw eigen regel op dezelfde
  sleutel wint, zoals altijd. Leer je terwijl `werk.basis` open staat, dan komt de regel daar
  (dezelfde logica als `set()` nu) en wordt hij van jou.
- `met` (combinatie): `"met": "note:1:17"` betekent dat de regel alleen geldt zolang die control
  is ingedrukt. Dat is shift, maar dan voor elke knop. De sleutel wordt `sig#met:<sig>@laag`, en
  `kies()` probeert eerst de regels met een `met` die nu vastzit. Een knop die als `met` dient,
  verliest zijn eigen action niet als hij geen tijdkritische action heeft (SWING, TEMPO, VOLUME
  zijn vrij). Bij twijfel kiest de validator "eigen action pas bij loslaten zonder combinatie" en
  waarschuwt hij als dat op `play`/`cue`/een worp zou vallen.
- Mapping per apparaat: `/api/mapping/<apparaat>` (APC, Maschine, Xboard, `toetsen`), met
  `/api/mapping` als alias voor `apc40mk2` (Clay's huidige verschil en oude kopieën blijven laden
  via `verschilVanKopie` en `eerder`).

---

## 3. De knoppenverdeling

### 3.1 Het principe

**Op de APC is een kolom altijd een track; de APC is de zaal.** Faders, filters, play, sync, kant,
PFL en loops zitten in de kern en veranderen in GEEN enkele werkruimte (spiergeheugen, VISIE
§5.4). De grid-modi die "per kolom" werken (hotcues, loops, klank, stems, patronen, de nieuwe
fx-matrix) blijven op de APC.

**De Maschine is de focus-track in detail.** Alles wat over ÉÉN track gaat en een naam, een getal
of 16 pads nodig heeft: precisie (het wiel als jog), het rack met namen en eenheden op het scherm,
secties, sampler, stappen, spelen en bladeren. Met de Maschine erbij (`apc-maschine`) neemt hij de
modi over die op de APC "focus-track" zijn (sampler, secties). Hun plek op de APC komt vrij voor
de fx-matrix. Zonder Maschine (`apc-alleen`, K1 onderweg) kan de APC alles wat hij nu kan, plus
de fx-matrix en de fasemeters.

**Het scherm en de iPad zijn voor wat geen vaste hand nodig heeft of meer vingers vraagt:**
overzicht (uitlijnweergave), kiezen (library, kaart), instellen (rack-editor, superknoppen), en
multitouch-worpen (fx-matrix, video-fx), nooit voor timing uit de losse hand (§4.4).

**Shift betekent overal hetzelfde: "de tweede functie van deze knop".** De Maschine-modifiers
(SWING, TEMPO, VOLUME) zijn `met`-combinaties met een naam, geen tweede shift. "Fijn" is op elk
apparaat shift op een draaiknop. "Leegmaken" is op elk apparaat shift op een pad (in K2 krijgt de
APC-sampler daarom ook shift = leeg, net als de Maschine).

### 3.2 Per onderdeel: wie doet wat

Afkortingen: **K1** = werkruimte `apc-alleen`, **K2** = `apc-maschine`. "=" betekent: zoals nu.
**Vet** = nieuw of verplaatst. Alles is een voorstel tot de proef (§9): eerst via learn in Clay's
verschil, pas daarna in de standaard.

| onderdeel | APC40 mkII in K1 | APC40 mkII in K2 | Maschine MK2 (K2) | toetsenbord (`toetsen.json`) | scherm / iPad |
|---|---|---|---|---|---|
| **decks en mixer** (kern) | = per kolom: trackknop filter, fader, Clip Stop loop (⇧ weg), Track Select focus (⇧ tweede), play (⇧ op de maat), S sync (⇧ tap), A\|B kant, ● PFL (⇧ cue); master, crossfader, Cue Level | = (identiek aan K1) | = groep A–H focus; **VOLUME vast + wiel = fader focus** | = Q/P play, W/O cue, ` = rem … (`{L}`/`{R}` worden `{focus}`/`{tweede}`) | hoofd: de spiegel; iPad: geen faders standaard (wel mogelijk in een vrij paneel) |
| **precisie** | = Nudge ± bend; Bank ◀ ▶ beatjump, **⇧ Bank lengte nu ook ½ en ¼ tel**; tempo-encoder (⇧ fijn); **device-mapje `uitlijn`** (Clip/Device View: strip → rack → uitlijn, alleen als er een maatgever én een tweede track met grid speelt): knob *k* = `track.k.phase.offset`, ring type `pan` = fasemeter, **⇧ knob = `.fine`** | = K1 | **pagina Precisie** (◄ ► links boven, na Rack): **wiel = jog 1/16 tel (⇧ 1/64), ook in pauze**; knop 1 fase, 2 fase fijn, 3 tempo, 4 bend-sterkte, 5 beatjump-lengte; **SWING vast + wiel = fase duwen**, **TEMPO vast + wiel = tempo**; scherm rechts = de vouw van de focus-track tegen de maatgever met ms | = Z/X , . nudge 50 ms; **in deel `precisie` (eigen keuze): Z/X = jog 1/16 tel** | paneel **uitlijn** (alle tracks) op `mac-2` of iPad; slepen in een baan = `phase.offset` |
| **effecten** | = device.rack (fx 1–8 focus), strip 7 = fx-mix, 8 = fx 1; Device ◀ ▶ rack, On/Off bypass; device.master (⇧ Clip/Device View); **grid-modus `fx` via ▲ ▼**: kolom = track, rij 1–5 = `track.k.fx.knob.1–5.hold`, scene 1–5 = `master.fx.knob.1–5.hold`, Stop All = alles los, ⇧ pad = vast (latch); **⇧ A\|B k = echo-worp op track k** (`track.k.send.a.hold`) | = K1, en **scene 3 = fx-matrix** (alias `grid.sampler` → `grid.fx`) | **F1–F8 = worp plek 1–8 focus** (`fx.knob.K.hold`, ⇧ F = vast); pagina Rack = (namen + eenheden); **GRID = padmodus fx**: pads 1–8 = plek 1–8 focus (druk), 9–16 = master plek 1–8 (druk); NOTE REPEAT vrij (later: loop roll, alleen op vraag) | — | paneel **fx-matrix** (iPad: tien vingers = elke combinatie), paneel **superknoppen**, rack-editor op elk slot (track, echo, galm, master) |
| **stems** | = grid-modus stems per kolom (⇧ scene 3 of ▲ ▼) | = K1 | **pagina Stems**: knop 1–4 niveau zang/drums/bas/overig, 5–8 filter van die stems (focus); **MUTE = padmodus stems**: rij = stem, kolom = kill druk · kill vast · echo-worp · cue | — | = STEMS-rij als paneel (hoofd); vrij paneel met stem-sends (top-40: `stem.drums.send.b`) |
| **sampler** | = grid-modus sampler (scene 3): rij 1 pads, rij 2 leeg, rij 3 sectie | **naar de Maschine**; op de APC alleen via ▲ ▼ niet meer (scene 3 = fx); de functies blijven op Maschine + scherm | = SAMPLING: boven 8 pads, onder sectie, ⇧ pad = leeg, ◄ ► lengte, knop 5 volume | — | = sampler-rij |
| **secties** | = ⇧ scene 1 (40 pads focus, ⇧ = als loop) | = ⇧ scene 1 (blijft: geen kernwijziging, kost niets) | = SCENE (16 pads), **⇧ pad = als loop** (het gat dat de verkenning vond) | = ⇧ W/E, ⇧ I/O | paneel secties-lijst (iPad: groot, op de "1") |
| **patronen en instrumenten** | = ⇧ scene 2 (pad = plek × track), device.inst | = K1 | = STEP, PATTERN + pad, PLAY/RESTART/REC/ERASE, pads spelen, pagina Instrument, wiel kiest instrument (alleen op die pagina) | — | = PATROON- en INSTRUMENT-rij; deel `instrument` legt ze op de iPad zodra de focus-track een instrument heeft |
| **beeld** | = master-knop zwart (elk mapje), grid-modus video, device.beeld (⇧ Detail View); voorstel HANDEN: ⇧ master-knop = clips uit | = K1 | — (beeld hoort niet bij de focus-track) | — | paneel **beeld-pads**: `video.fx.*.hold` als multitouch-pads (top-40: pixel 1117×, sporen 596×, korrel 490× met de muis), beeld-rij |
| **bladeren** | — (muis, B, iPad) | — | = BROWSE, wiel bladert, ◄ ► pagina, ENTER/wiel laadt op de focus-track | = B | deel `bladeren`: iPad toont **library-blader** zodra de library open is; laden = `track.N.load.selected` (tweede druk over een spelende track blijft) |
| **werkruimte zelf** | — | — | — | — | knop **✎ inrichten** en de lade "alle panelen" op elk scherm; `werk.deel.<naam>` is een action (te koppelen) |

**LPD8** (alleen met de hub): ongewijzigd. K2 = `video.master`, K4 = `video.pulse`, P1 =
`video.black.hold`. De rollen worden ook door andere apps gelezen (de K1-dip, VRAGEN O1), dus een
werkruimte mag geen LPD8-zone of -rol gebruiken; de validator weigert dat. **Xboard49**: = altijd
de speeltrack (`{speel}`), knop 1–8 instrument, 9–16 fx, schuif fader. De CC's blijven een
aanname tot de hub-middag. **Bank** is met de hub de hubtoets; zonder hub laat K1 hem vrij voor
keylock (VRAGEN I4/N2), en de validator weigert hem in elke werkruimte met `vereist` de hub.

### 3.3 Wat er in K2 verschuift (de verschillen die Clay moet onthouden)

| knop | K1 | K2 | waarom |
|---|---|---|---|
| APC scene 3 | sampler | fx-matrix | de Maschine heeft SAMPLING met 16 pads en een scherm; de fx-matrix is per kolom, dus APC-werk |
| Maschine wiel | instrument kiezen / bladeren | per pagina: Instrument = kiezen, Strip/Rack/Precisie/Stems = jog, library open = bladeren | het wiel is de enige jog op de hardware |
| Maschine F1–F8, GRID, MUTE, SWING, TEMPO, VOLUME | vrij | worpen, fx-pads, stems-pads, combinaties met het wiel | waren vrij (HANDEN) |

Dat is alles: drie regels om te onthouden. De kaarten (`apc.html?w=apc-maschine`,
`maschine.html`, de mapje-balk) tonen de werkruimte die geldt.

### 3.4 Regels tellen

K1 = de huidige 702 regels + fx-matrix (≈ 46: 40 pads, 5 scenes, Stop All) + uitlijn (16: 8
knoppen, met en zonder shift) + echo-worp (8) + beatjump-lengte (aanpassing van 2) ≈ **72 regels
erbij**, als fragment van `apc-alleen`, niet in de standaard tot na de proef. K2 = K1 + alias + ≈
45 Maschine-regels (F1–F8 met en zonder shift, de pagina's Precisie en Stems, GRID/MUTE-pads,
vier wielregels). Geen kopie van 702 regels: het blijven verschillen op één standaard.

---

## 4. Meerdere schermen en de iPad

### 4.1 Eén paneelpagina, twee manieren van transport

`paneel.html?w=<werkruimte>&s=<scherm>` is DE pagina voor elk scherm buiten het mixertabblad. Ze
opent nooit een AudioContext, MIDI of de Web Lock. `regels-paneel.test.mjs` bewaakt dat met de
importboom, net als `regels-companion.test.mjs`. Ze mag alleen pure modules uit de engine
importeren (`stream-kern.js` voor `positieIn`, `beatgrid.js`), nooit `engine.js` of `bron.js`.

| transport | wanneer | hoe | kosten |
|---|---|---|---|
| **opener** | een tweede venster op de Mac (extern scherm, beamerscherm naast de mixer) | de mixer opent hem met `window.open`; `window.opener.varvePanelen = { invoke, read, metaOf, beschrijf, abonneer, segmenten, werkruimte }`; bewezen patroon (beamer, plan, maschine) | nul latentie; deelt de hoofdthread van de mixer, dus zwaar tekenen kost mixer-frames (de audio niet) |
| **WebSocket** | iPad, iPhone, een tweede Mac | `paneel.html` ⇄ `wss://<naam>.ts.net/paneel` ⇄ **relais in de VARVE-server** ⇄ het mixertabblad (de lockhouder, `statusVanMij`) dat uitvoert | relais gemeten op loopback: mediaan 0,13 ms, p99 0,50 ms (verkenning-scherm §3); het netwerk en de aanraking zijn de rem (AANNAME: wifi+WireGuard enkele tot ~15 ms per richting, touch tientallen ms) |

De pagina kiest zelf: is er `opener.varvePanelen`, dan dat, anders de WebSocket. Er is dus één
paneelcode. **De server is alleen doorgeefluik**: hij kent geen actions en geen engine (regel 1),
en alleen de mixer met de Web Lock voert uit. Valt de mixer weg, dan worden alle panelen grijs
met "mixer weg". Komt hij terug, dan wordt de volledige stand opnieuw gestuurd.

Het relais (`server/relais.js`) gebruikt GEEN dependency. Het bestaat uit een `upgrade` op
`node:http`, tekstframes, ping/pong en een berichtgrens van 4 kB, samen ~150 regels. In
`meet/rondje.mjs` werkt een kern van ~25 regels. Het alternatief is `ws` als eerste
server-dependency (de hub gebruikt hem al); dat leggen we pas voor als het eigen relais in de
duurtest faalt.

### 4.2 Het protocol (puur, `src/paneel/protocol.js`)

| richting | bericht | wanneer |
|---|---|---|
| paneel → server | `{t:'hallo', v:1, scherm, werkruimte}` (cookie `varve_paneel`) | bij verbinden |
| mixer → server | `{t:'mixer', inst}` (alleen vanaf localhost, alleen de lockhouder) | bij verbinden; de server stuurt alles door naar die ene |
| paneel → mixer | `{t:'abonneer', ids:[…]}` | na `welkom` en na een wissel van werkruimte of deel |
| mixer → paneel | `{t:'stand', reads:{id:v}}` (volledig, ≤ 12 kB) · `{t:'delta', reads:{…}}` (alleen wat veranderde, hooguit 30×/s per action, diff zoals `feedback.js`) | bij abonneren · daarna |
| paneel → mixer | `{t:'invoke', n, id, v}` | elke druk en draai; `n` = volgnummer |
| mixer → paneel | `{t:'geweigerd', n, id, waarom}` | buiten de witte lijst, of de action faalt |
| mixer → paneel | `{t:'seg', track, seg:{T,P,R,loop,speelt,rem}, V, rate}` · `{t:'grid', track, versie, grid}` · `{t:'maat', track}` | bij elk nieuw segment (`_segId`), elke gridwijziging, elke wissel van maatgever |
| beide | `{t:'ping', n, perf}` / `{t:'pong', n, perf, audio}` | elke 1 s; het paneel rekent het klokverschil (mediaan van de laatste 16, zoals de Stroommachine) |
| server → mixer | `{t:'weg', scherm}` | een paneel valt weg (close, of 2 s geen pong) |

Posities gaan NOOIT per beeld over het netwerk. Het paneel rekent zelf `positieIn(seg, t)` op de
audioklok van de mixer, met het klokverschil: regel 3 over een netwerkgrens, zoals de streamkern
dat al over de draadgrens doet. Peaks, tellen, klappen en secties haalt het paneel zelf van de
server (`/media/<id>/peaks.bin` staat al op de witte lijst), zodat de mixer alleen de live stand
stuurt.

### 4.3 Wat er op elk scherm kan

Elk paneel heeft een `waar`: **hoofd** (gebonden aan de DOM van de mixer, dus alleen in het
mixertabblad), of **overal** (alleen bus en reads, dus ook in paneel.html).

| paneel | waar | op de iPad nuttig voor |
|---|---|---|
| spiegel, focus-deck, focusdeel, sampler, video-paneel, de negen rijen, library/MIDI/rack-editor (onderpanelen) | hoofd (voorlopig) | — (later per rij een "overal"-versie, als Clay erom vraagt) |
| **vrij** (Clay's eigen knoppen) | overal | eigen knoppen per avond |
| **uitlijn** (alle tracks) | overal | het overzicht op de GPU van de iPad, terwijl de Mac vrij blijft |
| **fx-matrix**, **beeld-pads** | overal | multitouch: elke combinatie van worpen tegelijk |
| **superknoppen** | overal | één vinger = veel tegelijk, met glijden |
| **secties-lijst** | overal | grote knoppen die op de "1" invallen (gequantiseerd, dus de vertraging maakt niet uit) |
| **library-blader**, **kaart** | overal | kiezen en laden (de companion bestaat al voor de kaart) |
| **meters/status** (master, gain reduction, wie de maat geeft, rest-tijd) | overal | alleen lezen, iPhone |

### 4.4 Latentie: wat de iPad wel en niet doet

- **Wel**: draaien, schakelen, kiezen, laden, secties (op de "1"), `play.quant`, hotcues met
  quantize, worpen (een kleine vertraging op een worp is hoorbaar maar niet fout), fase duwen met
  `phase.offset` (een AFSTAND, ongevoelig voor vertraging).
- **Niet** (de validator weigert het voor een scherm dat niet `hoofd`/`mac-2` is): `bend.*` (het
  effect hangt af van hoe lang je drukt; jitter maakt dat onvoorspelbaar), `nudge.back/fwd`
  zonder quantize, `play` zonder `.quant`, `cue`. Een waarschuwing (geen weigering) krijgen
  `hotcue.K` zonder quantize en `scrub`.
- Meten (W3): de tijd van `pointerdown` op de iPad tot `bijInvoke` in de mixer, met de
  klokverschil-rekening van het protocol. Doel (AANNAME tot gemeten): p95 < 40 ms over wifi en
  Tailscale. Haalt het dat niet, dan blijft de iPad bij gequantiseerde knoppen; het ontwerp
  verandert daardoor niet.

### 4.5 Veiligheid (de eerste schrijfweg van buiten de Mac)

Dit is een nieuwe deur. Volgens CLAUDE.md ("eerst melden") gaat de **schrijfkant pas aan als Clay
er uitdrukkelijk voor kiest** (VRAGEN WR1, §10), met `VARVE_PANELEN=schrijven`. Zonder die keuze
is elk extern paneel alleen-lezen. Uitlijn, meters en status werken dan al, en dat is ook de
eerste stap.

1. **Netwerk**: alleen localhost of `VARVE_HOSTS` (de tailnet-naam via `tailscale serve`, HTTPS),
   dezelfde poort als nu (`vreemdVerzoek`). Nooit het LAN onversleuteld, nooit `tailscale funnel`.
   Of `tailscale serve` WebSocket doorgeeft is een AANNAME die W3 eerst meet.
2. **Origin** moet precies de eigen pagina zijn (`https://<naam>.ts.net` of de localhost-poort),
   anders 403 bij de upgrade.
3. **Koppelen**: de mixer toont op verzoek ("+ scherm" in de lade) een code van 6 cijfers, 120 s
   geldig. `POST /api/paneel/koppel {code, scherm}` zet een `HttpOnly; Secure; SameSite=Strict`
   cookie (32 willekeurige bytes; de server bewaart alleen de SHA-256, in `media/paneel-sleutels.json`).
   Hooguit 5 pogingen per minuut. Intrekken kan in de Controlekamer (tegel "Schermen"). Zelfde
   gedachte als het hub-token (PROTOCOL §13), maar dan per apparaat en intrekbaar.
4. **Witte lijst per scherm**: de mixer voert alleen actions uit die in de panelen van DAT scherm
   in de actieve werkruimte (en het actieve deel) staan, na `{doel}`-invulling
   (`toegestaan(werkruimte, scherm)`, puur, W1). Altijd geweigerd: `record.*`, `log.*`, `layer.*`
   behalve wat in het paneel staat, alles wat de library wist, `werk.opslaan`. Destructieve
   actions houden hun eigen tweede druk (laden over een spelende track, `track.N.inst`).
5. **Loslaten bij wegvallen**: de mixer houdt per scherm bij wat er is ingedrukt (zoals
   `mapping.vast`). Bij `weg` (close of 2 s geen pong) roept hij voor elke ingedrukte trigger
   `invoke(id, false)` aan; value-actions blijven staan. Zelfde regel als `mapping.losgekoppeld()`
   en de hub-cockpit (PROTOCOL §10).
6. **Grenzen**: hooguit 4 schermen tegelijk; hooguit 200 berichten/s per verbinding (wat erboven
   zit wordt gedropt, met één melding); berichten ≤ 4 kB.
7. **Log**: iPad-acties gaan over de bus en komen dus vanzelf in het handelingenlog. Een
   `bron`-kolom (`invoke(id, v, { bron: 'ipad' })`) is optioneel en hoort bij W3. Het logformaat
   krijgt dan een optioneel 5e element, en terugspelen negeert het.

De **hub-cockpit** (virtuele APC op de tablet, PROTOCOL §8) blijft de noodweg ("de APC
thuislaten"). VARVE hoeft daar niets voor te doen.

### 4.6 Eén tabblad, en de Web Lock

Een paneelpagina is nooit een tweede mixer. `index.html` blijft het enige tabblad met de APC en de
lock. Een paneel via localhost of via de ts.net-naam opent niets dat de lock nodig heeft. Daarmee
wordt het oude gat (twee origins, de lock beschermt niet, TAILSCALE.md) voor panelen onschadelijk.

---

## 5. Precisie (punt 3)

Het principe: de mapping kent geen milliseconden (regel 2), dus precisie komt uit **actions waarvan
de engine de eenheid kiest**, en uit een **mappingmodus die een encoder in triggers omzet**. Er komt
geen nieuw action-type "delta": dat zou een nieuw buscontract zijn.

| nieuw (W5) | soort | wat het doet | stap |
|---|---|---|---|
| `track.N.phase.offset` | value | read = 0,5 + (fase t.o.v. de maatgever)/tel, over ±½ tel; invoke(v) = `deck.nudge((v − read)·tel)` (fasebehoudend, binnen de loop) | per tik (1/127) = 1/127 tel = 3,8 ms op 124 bpm |
| `track.N.phase.offset.fine` | value | zelfde, over ±1/16 tel (read geklemd aan de randen) | 1/127 × 1/8 tel = 0,48 ms op 124 bpm |
| `track.N.scrub.back/fwd` (+ `.fine`) | trigger | 1/16 tel (fijn 1/64), zonder grid 10 ms (2,5 ms); speelt hij, dan een nudge; staat hij stil, dan een seek (ONTBREEKT B6, fijn zoeken in pauze) | 30 ms / 7,6 ms op 124 |
| `track.N.nudge.fine.back/fwd` | trigger | 1 ms, voor het scherm en het toetsenbord | 1 ms |
| `track.N.bend.amount` | value | bend-sterkte 1–16 % (standaard 4 %); 0..1, de engine schaalt | — |
| `track.N.beatjump.*` | = | `SPRONG_TELLEN` krijgt ½ en ¼ (halveren onder 1 tel) | ¼ tel |
| `track.N.sync.bar` | trigger | na sync: verschuif 0–3 tellen naar de dichtstbijzijnde "1" van de maatgever (`barPhase`/`telInMaat`, nooit `beat % beatsPerBar`) | hele tellen |
| `track.N.bar.offset` | alleen read | hoeveel tellen naast de maat (0..1 over −2..+2), voor de lamp in het precisiepaneel en de uitlijnweergave | — |
| sync-lampje | = | "gelijk" bij < 0,005 bpm in plaats van < 0,05 (nu liegt het: tot ~24 ms drift per minuut) | — |
| mappingmodus `stappen` | mapping | `{ mode: 'stappen', actions: [terug, vooruit] }`: elke tik van een relatieve encoder = één trigger (true en false); voor jog, library, beatjump en secties; ook het masterwiel wordt zo data in plaats van code | — |

**Nudges samenvoegen** (P2 uit de verkenning): `deck.nudge` telt duwen binnen hetzelfde
render-quantum op (`ctx.currentTime` onveranderd = hetzelfde blok, regel 3, geen timer) en maakt
er één seek van. Een encoder geeft ~50 berichten/s; zonder samenvoegen is elke tik een nieuw
segment met 4 ms overvloei. Met keylock is elke sprong een gepland segment op het zoekrooster
(~98 ms), dus samenvoegen is daar nog belangrijker. Het audiopad verandert niet: de vorm van een
segment blijft gelijk, net als de gouden hash en 0 GC. Pas als het hoorbaar tekortschiet komt er
een "buig precies d seconden"-segment, en dat is engine-werk op vraag.

**De ring als fasemeter**: in het mapje `device.uitlijn` toont de pan-ring van device knob *k* de
fase van track *k*. Draaien is duwen. AANNAME: 15 LED's over ±½ tel is ~32 ms per LED; dat is te
grof voor de laatste 10 ms. Daarom staat ⇧ op dezelfde knop voor `.fine` (de ring toont dan
±1/16 tel, ~4 ms per LED). Een niet-lineaire ring (`led.curve`) raakt `feedback.js`, waar de
andere workflow nu in werkt, en komt pas na hun samenvoeging.

Sync-lock (blijven volgen bij een tempowissel van de maatgever) bouwen we NIET zonder Clay's
antwoord (VRAGEN WR4), want het botst met OVERNEEM van de auto-DJ en met rubato in live opnames.

---

## 6. De uitlijnweergave (punt 4)

Paneel `uitlijn`, `waar: overal`: in de mixer, in een los venster of op de iPad.

**De as staat in TELLEN van de maatgever zoals je hem hoort**: x = `beatAt(hoorbaar(M))`, standaard
2 maten. Eén tel is overal even breed, welke bpm ook. Op de achtergrond lopen de tellijnen van de
maatgever over de hele hoogte, de "1" voller.

**Per track één baan** (spelend + wachtend op de maat; leeg en instrumenttracks niet), van boven
naar onder in tracknummer. De maatgever staat bovenaan, gemarkeerd:

- de golfvorm op de tracktijd die je HOORT op het moment dat de maatgever tel x laat horen:
  `positieIn(seg_i, t) − V·rate_i`, met t = nu + (x − x_nu)·tel_M. Loops, een rem en een wachtende
  start weet het segment al. Er is geen eigen teller (regel 3), en een speelkop op `deck.position`
  (de oude fout uit de verkenning) komt er niet;
- de gridlijnen van DIE track op zijn eigen tellen, de "1" voller. Vallen ze op de lijnen van de
  maatgever, dan klopt het grid;
- de gevonden tellen (groene tikjes, `deck.tellen`) en de klappen (`deck.onsets`). Vallen DIE op
  de lijnen van de maatgever, dan klinkt het gelijk, wat de grids ook zeggen;
- links drie getallen en een teken: **grid Δ** ms (`faseVerschil`), **muziek Δ** ms (nieuw,
  `src/analysis/fase.js`, puur: de mediaan over de laatste 8 gehoorde tellen van tel_i − de
  dichtstbijzijnde tel_M op de audioklok via `ctxTimeOf`; alleen met tellen op beide, met alleen
  klappen staat er "±15 ms"), **drift** ms per 16 tellen (`(bpm_i − bpm_M)/bpm_M · 16 · tel`), en
  **maat** (+k tellen, uit `bar.offset`). Groen < 2 ms, geel < 6 ms, rood daarboven;
- de loop gearceerd, hotcues, een stukgrens van het grid en de zekerheidsstrook.

**Wat je ermee doet**: staat er "grid 0 ms, muziek 12 ms", dan ligt een grid naast zijn muziek.
De weergave zegt welke (`afwijkingBij` per track) en biedt "tel 1 hier" aan op die track. Staat
er "grid 9 ms", dan duw je met `phase.offset`, met de ring, de Maschine (SWING + wiel) of door de
baan te slepen (een fractie van een tel, en dus ongevoelig voor netwerkvertraging op de iPad).
"Drift 31 ms/16" betekent het tempo bijstellen; "maat +1" betekent `sync.bar`.

**Twee vormen, en geen scrollende standaard:**

| vorm | wat beweegt | tekenen | kosten (8 banen × 1200 × 48 css px, dpr 2) |
|---|---|---|---|
| **pagina** (standaard) | het venster staat stil op 2 maten en slaat om bij de volgende; alleen een speelkopstreep loopt (CSS-transform op de compositor) | bij omslaan, bij een nieuw segment (seek, nudge, tempo, loop), bij een grid- of zoomwissel | ~1 Mpx/s + de streep; tekenen zelf ~1,7 ms per omslag met tegels + `drawImage` (gemeten, software-rendering) |
| **vouw** (fasescoop) | per track één rij van één maat; elke gehoorde tel komt erin op zijn fase t.o.v. de maatgever en dooft uit | per tel | ~0,5 Mpx/s; past ook op het 1-bit-scherm van de Maschine (rechts in de pagina Precisie) |
| scrollend (keuze, niet standaard) | alles | elk beeld | ~110 Mpx/s op 60 fps: 4× de last die Demucs op 5 okt halveerde; alleen op de iPad (eigen GPU) |

Tekenen gebeurt per track in een voorgetekende strook in tracktijd (in tegels, want een album past
niet in één canvas). Per omslag wordt alleen `drawImage` gedaan met schaal = hoorbare tel × rate;
een andere rate is een andere schaal, geen nieuwe strook. De sleutel is `_segId` + `gridVersie`
per track, geen `JSON.stringify(grid)` per beeld (dat doet de huidige golfvorm wel; dat lossen we
mee op).

Op de iPad stuurt de mixer alleen segmenten, grids en de id van de maatgever (§4.2). De iPad haalt
de peaks en tellen zelf en tekent op zijn eigen GPU. Dat is de ideale eerste toepassing van een
extern scherm: alleen lezen, dus veilig vóór de schrijfkant.

---

## 7. Effecten en combinatieknoppen (punt 5)

"Alle combinaties die ik kan bedenken" valt uiteen in zes gebaren. Elk wordt **data** op één keer
code in de control- of schermlaag. De engine blijft ongemoeid, behalve de laatste rij (alleen op
vraag).

| gebaar | hoe | waar het bediend wordt | spoor |
|---|---|---|---|
| **meerdere worpen tegelijk** | elke `.hold` werkt los, dus twee pads = twee plekken open: 2ⁿ combinaties zonder akkoordlogica; de **fx-matrix** maakt dat bespeelbaar (kolom = track, rij = plek, scene = master) | APC grid.fx (K2: scene 3), Maschine GRID (16 pads), iPad fx-matrix (tien vingers) | W7 (paneel + actions), W8 (regels) |
| **momentary of vast voor ELKE knop** | mappingmodi `druk` (indrukken = `naar`, loslaten = terug naar wat er stond), `latch` (wisselen), `lang` (kort = vast, ≥ 400 ms = momentary, dezelfde 400 ms als gluren); het terugzetten gaat via de bus, dus het log ziet het | elke controller, elk vrij paneel (`"mode": "druk"`) | W6 |
| **knop A vast + knop B** | `met` in een regel (§2.4); ook over apparaten heen via een gedeelde **vast-stand** (`vast-stand.js`: elke Mapping meldt `apparaat:sig` in/uit), bijvoorbeeld Maschine SHIFT + APC-pad | Maschine SWING/TEMPO/VOLUME + wiel, APC ⇧ A\|B = echo-worp | W6 |
| **één knop beweegt veel, over slots heen** | **superknop** (`superknop.js`, puur): links zoals een rack-macro (venster `in`, `from/to`, curve, trappen), opgelost met dezelfde `resolveLink`, uitgevoerd als gewone `invoke`s; zelf een action `super.K` (value, met read) + `super.K.hold` | elke knop (koppelen), het paneel superknoppen, de iPad | W7 |
| **scènes en morph** | een scène = de stand van de plekken van alle slots + sends + filter als data; een morph = een superknop van scène A naar B (`from` = A, `to` = B); glijden via de bestaande `.glide`-actions en `zetDoel`, geen eigen teller (regel 3) | superknop-paneel, een draaiknop | W7 |
| **effecten op meer plekken** | het rack van de echo- en galmbus wisselbaar maken (`send.a/b.rack.next/prev`; `zetRack` bestaat al) + de rack-editor op elk slot (track, bus A/B, master) | Device ◀ ▶ in het master-mapje, de editor | W7 |
| *(engine, alleen op vraag)* | `conflict`-modi in rack.js (`som`/`max`, het veld bestaat al ongebruikt), loop roll + slip (NOTE REPEAT), modulatie van plekken door de router, parallelle takken, extra bussen, een insert per stem (gemeten 5,5 ms CPU/s per slot, ook stil) | — | niet in deze sporen |

**Handelingenlog bij een superknop**: de KINDEREN worden gelogd en `super.*` staat in
`OVERSLAAN` van terugspelen.js. Zo klopt terugspelen ook als de definitie later verandert, en is
er niets dubbel. Bij `druk`/`latch` wordt het terugzetten bij loslaten als gewone invoke gelogd.

**Soft-takeover**: faders onder een superknop vallen uit hun takeover (dat is bestaand en juist
gedrag). Endless-ringen tonen gewoon de nieuwe stand. De validator waarschuwt als een superknop
een action stuurt die ook op een absolute fader in dezelfde werkruimte staat.

---

## 8. "Echt complete vrijheid" (punt 6), en hoe het bruikbaar blijft

- **Indeling**: elk scherm is een raster van vakken uit data. Panelen kunnen verplaatst, gestapeld
  (tabs) of naar een ander scherm gezet worden. In de mixer verplaatst W2 de BESTAANDE elementen
  (`appendChild` van `#stems` enzovoort naar een vak). Er wordt niets herschreven, de ids blijven
  gelijk, en `rijen.mjs`, `kijk.mjs` en `bovenbalk.test` blijven dus geldig.
- **Eigen knoppen**: het vrije paneel. Elke action uit de bus (3018 + wat de sporen toevoegen) kan
  erop, met `{doel}`, label, kleur uit `soorten.js` en uitleg uit `beschrijf()`.
- **Eigen handen**: zones naar panelen, learn op elk apparaat (ook Maschine en Xboard, met hun
  eigen opslag), het toetsenbord als data (`mappings/toetsen.json`, met `KEYMAP` als standaard),
  nieuwe mapjes en aliassen.
- **Per onderdeel**: `delen` + `volgt`. Gluren wisselt nooit van deel, alleen een vast open mapje
  doet dat; anders zou het scherm flikkeren bij elke blik op een mapje.
- **Inrichten op het scherm** (✎, W2): vakken krijgen een rand; een paneel versleep je aan zijn
  kop; "+ paneel" maakt een vrij paneel; "+ knop" kies je met zoeken (de action-lijst met uitleg,
  bovenaan wat Clay het meest met de muis doet, uit de top-40 van `src/handen/telling.js`), of
  met **aanwijzen**: klik een bestaande knop op het scherm of beweeg een control op een controller
  (hergebruik van `learn-mode.js`). Bij een paneel: "wijs toe aan: Maschine-draaiknoppen / APC
  device knobs (mapje …) / F1–F8 / pads (GRID)". Opslaan gaat met PUT en versie; bij 409 laat de
  pagina zien wat er anders is en gaat er niets verloren.
- **Bruikbaar in het donker**: elke werkruimte heeft haar kaart. `apc.html?w=` en `maschine.html`
  lezen de gegenereerde regels; de mapje-balk noemt het deel; op het Maschine-scherm staat de naam
  van het paneel dat de draaiknoppen bedienen. Een paneel op het scherm krijgt een badge "Maschine
  draaiknoppen" als een zone ernaar wijst, en licht 300 ms op als je die aanraakt (zoals
  `spiegel.markeer` nu).

---

## 9. Toets aan de drie regels, het audiopad en VISIE §5

| | hoe het ontwerp het respecteert |
|---|---|
| **Regel 1** (engine kent geen MIDI, DOM, YouTube) | werkruimte-model in `src/werkruimte/` (puur, geen imports uit ui/control/engine), panelen in `src/ui/werkruimte/`, transport in `src/paneel/`, relais in `server/`; `regels.test.mjs` krijgt `src/werkruimte/` en `src/paneel/` erbij (geen DOM in het model, geen engine-import in de paneelpagina behalve de pure `stream-kern.js`/`beatgrid.js`). De engine krijgt alleen getallen: `nudge(seconden)`, een bend-sterkte, beatjump-lengtes |
| **Regel 2** (value = 0..1, trigger = boolean) | elk nieuw item is een bestaande of nieuwe action met 0..1 of een boolean. Precisie loopt via `phase.offset` (0..1 = fractie van een tel), triggers met een stap die de engine kiest, en mappingmodus `stappen`. Er is bewust GEEN action-soort "delta". Superknop, `druk`/`latch` en de iPad sturen 0..1 |
| **Regel 3** (positie van `ctx.currentTime`) | de uitlijnweergave en de iPad rekenen `positieIn(seg)` op de audioklok (de iPad met klokverschil); geen posities per beeld over het netwerk; nudges samenvoegen per render-quantum (`ctx.currentTime`), niet per timer; superknop/morph glijden via `.glide`/`zetDoel` |
| **Audiopad** (geen afval, vaste segmentvorm, gouden hash) | W5 raakt alleen `deck.js` (hoofdthread), geen nieuw segmentveld; `renderblok.test` en de gouden hash moeten ongewijzigd groen blijven (acceptatie W5); geen nieuwe nodes in rust (W7: superknop maakt niets aan) |
| **Overgangen** (geen `setValueCurveAtTime`) | `druk`/`latch` en morph gaan via bestaande actions; `CURVE_BREUK` = 0 is acceptatie |
| **Eén tabblad / Web Lock / de hub** | panelen zijn nooit een tweede mixer; het relais voert alleen uit via de lockhouder; Bank (hubtoets) en LPD8-rollen worden door de validator geweigerd; de Maschine blijft één app tegelijk (de hub beslist) |
| **Persoonlijk instrument** | het relais is bediening van je eigen mixer via je eigen tailnet, geen deelfunctie of publieke stream; nooit `funnel`; de schrijfkant pas na Clay's keuze (WR1) |
| **VISIE §5.1 pijlers** | 1 dj'en (precisie, uitlijn, worpen), 2 produceren (deel `instrument`, Maschine-pads blijven spelen), 3 programmeren (superknoppen en scènes als data, Claude kan een werkruimte schrijven met versie), 4 instellen (de hele werkruimte is data, ook de handen); de crossover blijft: een werkruimte verbergt niets |
| **§5.2 draagbaar** | niets erbij in de tas; de iPad is optioneel; `apc-alleen` (K1) is volwaardig; nul dependencies |
| **§5.3 zonder code** | indeling, panelen, knoppen, handen, mapjes, toetsen, superknoppen en scènes zijn JSON, op het scherm in te richten; alleen nieuwe paneel-SOORTEN zijn code |
| **§5.4 geproefd** | de standaardwerkruimte = precies wat er nu is (acceptatie W2: DOM gelijk, mapping-keuze gelijk), dus bouwen verandert niets aan de avond; `apc-alleen` en `apc-maschine` zijn opt-in; elke nieuwe plek op de hardware gaat eerst via learn in Clay's verschil en komt pas na de hub-middag en avond 2 in een standaardwerkruimte (`handen/voorstel.json` krijgt de voorstellen, zoals HANDEN §1 voorschrijft) |

---

## 10. Vragen voor Clay (blok WR, voor docs/VRAGEN.md)

- **WR1** Mag er een schrijfweg van buiten de Mac komen (iPad bedient de mixer), via je tailnet,
  met een koppelcode per apparaat? Zonder ja blijft de iPad alleen-lezen (uitlijn, meters).
- **WR2** In `apc-maschine`: scene 3 = fx-matrix en de sampler alleen op de Maschine. Akkoord, of
  wil je de fx-matrix alleen onder ▲ ▼?
- **WR3** De fx-matrix: kolom = track en rij = plek 1–5 (voorstel), of de 8 plekken van alleen de
  focus-track?
- **WR4** Sync die blijft volgen (sync-lock) bij een tempowissel van de maatgever: ja of nee?
- **WR5** Moet de echo- en galmbus per werkruimte een ander rack kunnen krijgen?
- **WR6** Loop roll en slip op NOTE REPEAT: gewenst? (engine-werk)
- **WR7** Moet de werkruimte per deel ook vanzelf wisselen op het scherm van de Mac, of alleen op
  het tweede scherm en de iPad (de mixer blijft dan altijd zoals hij is)?

---

## 11. De sporen

Acht sporen, elk een tak `werk/<spoor>` in een worktree buiten iCloud
(`~/Projects/varve-stems/werk-<spoor>`), samenvoegen in `studio/integratie`. Om conflicten
klein te houden komen nieuwe actions in een EIGEN bestand per spoor (`src/control/acties-<x>.js`
met een `bindX()`, zoals `bindVideo`/`bindBeeld`), met één regel in `app.js` en één regel in
`apc-beschrijf.js` die een eigen `beschrijf<X>()` aanroept. Dat wijkt bewust af van "alles in
actions.js": de bus is dezelfde, alleen het bestand verschilt.

**Samenhang met de andere workflow** (lag op de controllers en het beatgrid): die werkt nu
ongecommit in `mapping.js`, `lagen.js`, `maschine.js`, `midi.js`, `midi-opzet.js`, `feedback.js`,
`renderloop.js`, `spiegel.js`, `bovenbalk.js`, `mapje-balk.js` en `styles.css`. Elk spoor dat die
bestanden raakt (W2, W5 deel b, W6, W8) begint pas NA hun samenvoeging in `studio/integratie` en
meet zijn invoerlatentie opnieuw met hun `tools/bench/invoer.mjs` en `tools/headless/latentie.mjs`.

**Golven**: A (meteen, parallel): W1, W4, W5a, W7a · B (na W1 en de andere workflow): W2, W6,
W5b · C: W3, W7b · D: W8.

Headless overal met `VARVE_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (staat in
deze container) en een proefserver met `VARVE_TESTSERVER=1` en eigen `VARVE_MEDIA`/`VARVE_WERKRUIMTES`
(anders schrijft hij in de echte map, zoals bij patronen).

Eerst het overzicht; per spoor de volledige bestandslijst, acceptatie en risico's in §11.1.

| id | wat | hangt af van | belangrijkste acceptatie |
|---|---|---|---|
| W1 | werkruimte-model (puur) + opslag (server, versie/409) | — | normaliseer idempotent, 409, onbekend blijft bewaard, kiesDeel-tabel |
| W2 | werkruimte in de mixer: register, binden per container, raster uit data, delen volgen, lade, inrichten | W1, andere workflow | standaard = huidige DOM; vrij paneel gebonden en volgt MIDI ≤ 1 frame; 50 wissels zonder lek |
| W3 | paneel.html + transport (opener/WS) + relais + koppelen + witte lijst | W1, W2 (vrij.js) | p99 < 2 ms loopback; geweigerd buiten de lijst; loslaten ≤ 2,5 s; extrapolatie < 2 ms |
| W4 | uitlijnweergave (reken puur, teken, paneel) + muziek-fase | — (mount via W2) | grid-/muziek-Δ/drift exact op synthetische decks; pagina ≤ 2 Mpx/s |
| W5 | precisie: phase.offset, scrub, fijn, beatjump ¼ ½, sync.bar, samenvoegen; (b) mappingmodus stappen | — / (b) andere workflow | read 0,5 na sync; 50 duwen per quantum = 1 segment; gouden hash gelijk |
| W6 | handen als data: mapping per apparaat, learn overal, toetsen.json, één woordenschat, werk-mapje, fragment, met/druk/latch/lang, alias, nieuwe mapjes | W1, andere workflow | zonder werkruimte kies() identiek (gouden tabel); Clay's verschil laadt; learn op Maschine |
| W7 | effectcombinaties: superknop + scènes, send-hold, bus-racks, editor op alle slots, fx-matrix-paneel | (a) — / (b) W1 | gouden resolveLink-tabel; log niet dubbel; geen klik bij buswissel |
| W8 | standaardwerkruimtes (apc-alleen, apc-maschine, studio), zones, kaarten, stand-deel, docs | W1, W2, W5, W6, W7 | bereikbaarheid ⊇ standaard; kern ongewijzigd; nep-APC + nep-Maschine |

### 11.1 Per spoor

**W1 · Werkruimte-model en opslag**
- *Bestanden*: NIEUW `src/werkruimte/model.js` (`normaliseerWerkruimte`, witte lijst, schema-migratie),
  `src/werkruimte/delen.js` (`kiesDeel(context)`, erven/verschil, `losOp(werkruimte, deel)`),
  `src/werkruimte/doel.js` (woordenschat, `{L}`/`{R}` → `{focus}`/`{tweede}`), `src/werkruimte/toegestaan.js`
  (witte lijst per scherm), `server/werkruimtes.js` (naar het voorbeeld van `server/plannen.js`),
  `werkruimtes/standaard.json` (= de huidige indeling), `test/werkruimte.test.mjs`,
  `test/werkruimte-server.test.mjs`, `docs/WERKRUIMTE.md`. WIJZIGT `server/index.js` (route
  `/api/werkruimtes`, ~15 regels, `VARVE_WERKRUIMTES`).
- *Hangt af van*: niets.
- *Acceptatie*: (1) normaliseer∘normaliseer = normaliseer op de vier voorbeelden en op 200
  gerandomiseerde werkruimtes (vast zaad); (2) PUT met een oude versie geeft 409 en de vorige versie
  staat in `.versies/`; (3) een onbekende paneel-soort en een onbekend veld komen ongeschonden terug
  na een rondje lezen en opslaan; (4) verboden velden (knopstanden, adressen, `verberg`, een
  LPD8-zone, Bank met `vereist` de hub) geven 400 met een reden; (5) `kiesDeel`: een tabel van 12
  contexten (mapje vast/gluren, focus nummer/instrument/leeg, library open, grid-modus) geeft het
  verwachte deel, en gluren wisselt nooit; (6) een deel met `erft` slaat alleen het verschil op,
  en opgelost = basis + verschil; (7) > 64 KiB wordt geweigerd; (8) `toegestaan('ipad')` bevat
  precies de actions van de iPad-panelen, en nooit `record.*`/`log.*`; (9) `regels.test`: het model
  importeert niets; `node test/alles.mjs` groen.
- *Risico*: het schema te vroeg vastleggen (vandaar `schema: 1` met migratie); overlap met standen
  (opgelost door alleen te NOEMEN, W8).

**W2 · De werkruimte in de mixer**
- *Bestanden*: NIEUW `src/ui/werkruimte/register.js` (PANELEN: id → `{ titel, waar, el | maak }`),
  `indeling.js` (raster → grid-areas, bestaande elementen verplaatsen met `appendChild`, tabs, de lade),
  `vrij.js` (de item-renderer: alleen DOM, krijgt `{ invoke, read, metaOf, beschrijf }` mee, dus herbruikbaar
  in paneel.html), `binding.js` (`bind(root)`/`unbind(root)` naar registreerbare knob- en faderlijsten),
  `inrichten.js` (de editor), `opzet.js` (ophalen met versie, peilen, delen volgen via de events van
  lagen/engine/library), `tools/headless/werkruimte.mjs`. WIJZIGT `src/ui/vensters.js` (binden naar
  binding.js), `src/ui/renderloop.js` (knobs/faders als Set), `src/ui/app.js` (`opzetWerkruimte`),
  `index.html` (vak-containers, de ladeknop), `styles.css` (`.werk-raster`, `.vak`, `.lade`).
- *Hangt af van*: W1; de samenvoeging van de andere workflow (`renderloop.js`, `styles.css`, `spiegel.js`).
- *Acceptatie*: (1) met `standaard.json`: het skelet van `main` en `#rijen` (ids en volgorde) is
  identiek aan nu; `rijen.mjs`, `kijk.mjs` en `bovenbalk.test` groen; (2) een vrij paneel met 8 items:
  de knob-teller van de renderloop gaat +8; een klik verschijnt in `bijInvoke` in dezelfde taak; een
  MIDI-zet op dezelfde action laat het paneel binnen 1 frame volgen; (3) 50× van werkruimte wisselen:
  de knob-teller staat weer op de beginwaarde, en het aantal listeners (geteld met een wrapper rond
  `addEventListener`) groeit niet; (4) `lagen.zet('device','master')` (vast) toont het master-deel
  binnen 1 frame, gluren (400 ms vasthouden) wisselt niet; (5) de lade toont `register.size`
  panelen, ook die niet in de werkruimte staan; (6) slepen in inrichten → PUT met versie; bij 409
  een melding en gaat er niets verloren; (7) renderloop-tijd in rust met de standaardwerkruimte
  binnen ±5 % van nu (`tools/headless/tekenen.mjs`); panelen in een verborgen tab tekenen niet.
- *Risico*: tools rekenen op vaste ids (daarom verplaatsen, niet herschrijven); dubbel binden; de
  editor is het meeste UI-werk (mag in een tweede helft van het spoor).

**W3 · Schermen: de paneelpagina, transport, relais, veiligheid**
- *Bestanden*: NIEUW `paneel.html`, `src/paneel/pagina.js`, `src/paneel/transport.js` (opener | ws),
  `src/paneel/protocol.js` (puur: berichten, diff, grenzen), `src/paneel/klok.js` (puur: klokverschil,
  extrapolatie met `positieIn` uit `stream-kern.js`), `src/ui/paneel-bron.js` (in de mixer:
  `window.varvePanelen`, de WS-client naar het relais, de witte lijst, loslaten per scherm),
  `server/relais.js` (WebSocket zonder dependency), `server/paneel-sleutels.js` (koppelen, intrekken),
  `test/relais.test.mjs`, `test/paneel-protocol.test.mjs`, `test/regels-paneel.test.mjs`,
  `tools/headless/paneel.mjs` (mixerpagina + paneelpagina in één Chrome, via WS). WIJZIGT
  `server/index.js` (upgrade, `MAG` + `paneel.html`, `/api/paneel/koppel`), `src/ui/app.js` (1 regel),
  `src/ui/werkruimte/indeling.js` (knop "+ scherm" in de lade; afspraak met W2).
- *Hangt af van*: W1 (`toegestaan`), W2 (`vrij.js`, het register).
- *Acceptatie*: (1) loopback: 10 000 invokes, p99 < 2 ms, geen verlies, volgorde behouden; (2) zonder
  cookie 401 bij de upgrade, verkeerde Origin 403, een Host buiten localhost/`VARVE_HOSTS` 403; (3)
  koppelcode: 6 cijfers, 120 s, 5 pogingen per minuut, daarna 429; ingetrokken = 401; (4) een action
  buiten de witte lijst van het scherm geeft `geweigerd` en `bijInvoke` telt 0; `record.start` vanaf
  de iPad wordt altijd geweigerd; (5) verbinding weg met een knop ingedrukt → de mixer roept
  `invoke(id, false)` aan binnen 2,5 s; (6) > 200 berichten/s → gedropt plus precies één melding; (7)
  `stand` ≤ 12 kB bij abonneren, `delta` hooguit 30×/s per action en alleen bij verandering; (8) de
  extrapolatie van het paneel wijkt < 2 ms af van de positie in de mixer over 60 s, met een nep-klokverschil
  van 37 ms en ±10 ms jitter; (9) de importboom van paneel.html bevat geen `AudioContext`,
  `requestMIDIAccess` of `navigator.locks`; (10) opener-modus: een tweede venster werkt met nul
  WebSocket-verbindingen; (11) zonder `VARVE_PANELEN=schrijven` is elk extern scherm alleen-lezen.
- *Risico*: de eerste schrijfweg van buiten (alleen na WR1); `tailscale serve` met WebSocket is een
  AANNAME (eerst meten); touch- en wifi-latentie op de iPad ongemeten; de companion-POST is ook nooit
  live geproefd.

**W4 · De uitlijnweergave**
- *Bestanden*: NIEUW `src/ui/uitlijn/reken.js` (puur: tellenvenster van de maatgever, posities uit
  segmenten, gridlijnen, grid-Δ, drift, maat), `src/analysis/fase.js` (puur: de muziek-Δ uit de gevonden
  tellen), `src/ui/uitlijn/teken.js` (tegels per track + `drawImage`, pagina en vouw),
  `src/ui/uitlijn/paneel.js` (de bouwsteen, `waar: overal`, met een bron-interface die in de mixer de
  engine leest en op het paneel het protocol), `test/uitlijn.test.mjs`, `tools/headless/uitlijn.mjs`
  (+ een losse proefpagina tot W2 er is). WIJZIGT bij het samenvoegen alleen `register.js` (1 regel).
- *Hangt af van*: niets om te bouwen; W2 om in te hangen, W3 voor de iPad.
- *Acceptatie*: (1) twee nep-decks op 124 bpm, grid B 10 ms later: grid-Δ = 10,0 ± 0,1 ms; met nep-tellen
  12 ms naast: muziek-Δ = 12 ± 0,5 ms; (2) 124 tegen 124,5 bpm: drift = 31,2 ± 0,2 ms per 16 tellen (op de tel van de maatgever);
  (3) een loop rond, een rem en een wachtende start: positie in de baan = `positieIn` van het deck
  (≤ 0,1 ms); (4) een track die een tel naast de maat ligt geeft "maat +1"; (5) met
  uitgangsvertraging V = 40 ms staat de x-as op `beatAt(hoorbaar(M))`, en die ligt 40 ms · rate
  achter op `position`; (6) pagina-vorm met 8 spelende decks over 30 s: tussen omslagen alleen de
  streep (tekenteller), gemiddeld ≤ 2 Mpx/s, ≤ 3 ms per omslag in headless Chromium; (7) geen
  `JSON.stringify` per beeld (de sleutel is `_segId` + `gridVersie`; een spion telt 0 aanroepen).
- *Risico*: de GPU van de M1 is niet gemeten; zonder tellen (Beat This!) alleen klappen (±15 ms), en
  dat moet erbij staan.

**W5 · Precisie**
- *Bestanden*: NIEUW `src/control/acties-precisie.js` (`bindPrecisie`: `phase.offset`(`.fine`),
  `scrub.*`, `nudge.fine.*`, `bend.amount`, `sync.bar`, `bar.offset`), `src/ui/beschrijf-precisie.js`,
  `test/precisie.test.mjs`, `tools/headless/precisie.mjs`. WIJZIGT `src/engine/deck.js` (nudges
  samenvoegen per quantum, scrub in pauze, `SPRONG_TELLEN` met ½ en ¼, bend-sterkte), `src/engine/engine.js`
  (helper voor de maatfase), `src/control/actions.js` (het sync-lampje op 0,005), `src/ui/app.js` en
  `src/ui/apc-beschrijf.js` (elk 1 regel). Deel b: `src/control/mapping.js` (modus `stappen`).
- *Hangt af van*: a niets; b de samenvoeging van de andere workflow (`mapping.js`).
- *Acceptatie*: (1) na sync is `read(phase.offset)` = 0,500 ± 0,001; `invoke(read + 1/127)` verschuift
  `faseVerschil` met 1/127 tel ± 0,05 ms; `.fine` met 1/1016 tel; (2) 50 invokes binnen één
  render-quantum geven 1 segment (`_segId` +1), 50 over 1 s hooguit 25; (3) scrub in pauze: `beatAt`
  verschuift precies 0,0625 (± 1e-6) en de track speelt niet; (4) beatjump ¼ in een loop schuift de
  loop mee, vóór het begin weigert hij met 'begin'; (5) `renderblok.test`: gouden hash ongewijzigd,
  0 GC; `engine.test`: `CURVE_BREUK` = 0; (6) headless Chrome: een duw van 1 ms zonder keylock geeft
  een piek in het verschilsignaal van ≤ ×2 een gewone stap; met keylock 20 duwen/s zonder gat
  > 5 ms; (7) `stappen`: relative-2c +3 → 3× fwd (true en false), −2 → 2× back, 0 → niets; (8) elke
  nieuwe action heeft een `beschrijf()`.
- *Risico*: met keylock stapelen geplande segmenten zich op; of een duw van 1 ms met 4 ms overvloei
  onhoorbaar is, is een AANNAME.

**W6 · Handen als data**
- *Bestanden*: NIEUW `src/control/werk-handen.js` (puur: werkruimte → fragment-regels, `herhaal`, zones),
  `src/control/vast-stand.js` (ingedrukt over apparaten), `mappings/toetsen.json`, `zones` in
  `mappings/apc40mk2.json`/`maschine-mk2.json`/`xboard49.json` (alleen een nieuw veld, geen regels),
  `test/handen-data.test.mjs`, `test/mapping-gouden.mjs` (de kies-tabel van vóór). WIJZIGT
  `src/control/mapping.js` (`vervangFragment`, `met`, modi `druk`/`latch`/`lang`, variabelen
  `tweede`/`maatgever`, alias L/R), `src/control/lagen.js` (mapje `werk` als laatste open mapje,
  `alias`, nieuwe mapjes en volgorde uit data, `opAanvraag` uit een vaste lijst),
  `src/control/keyboard.js` (leest toetsen.json; `KEYMAP` blijft de standaard),
  `src/control/maschine.js` (padmodus 'paneel' via de mapping, pagina's uit data, learn-hook),
  `src/control/noten.js`, `src/ui/mapping-opslag.js` + `server/index.js` (`/api/mapping/<apparaat>`,
  `/api/mapping` = apc40mk2), `src/ui/midi-opzet.js`, `src/ui/speelapparaten.js`,
  `src/ui/instrument-paneel.js`, `src/ui/learn-mode.js` (apparaat kiezen), `tools/mapping/eerder.mjs`
  (per apparaat).
- *Hangt af van*: W1; de samenvoeging van de andere workflow (zelfde bestanden).
- *Acceptatie*: (1) zonder werkruimte geeft `kies()` voor elke signature × shift × elke combinatie van
  open mapjes precies wat de gouden tabel van vóór zegt (702 regels); alle bestaande tests groen;
  (2) Clay's verschil (4 regels cc:0:20–23 @device.rack) en een oude volledige kopie laden identiek;
  GET `/api/mapping` = GET `/api/mapping/apc40mk2`; (3) learn op een nep-Maschine-draaiknop geeft een
  regel in het maschine-mk2-verschil die herladen overleeft; (4) `toetsen.json` = `KEYMAP`: elke toets
  × shift geeft dezelfde action als nu; (5) `met`: SWING vast + wiel → `phase.offset`, zonder SWING de
  oude functie, SWING loslaten tijdens het draaien laat niets hangen; (6) `druk` op `send.a`: indrukken
  1, loslaten terug op de vorige stand (± 0), beide in het log; `latch` twee keer = terug; `lang`
  ≥ 400 ms = momentary; (7) `vervangFragment` 100× → `rules.size` stabiel; (8) een werkregel wint van
  een kale regel, maar niet van een regel in een open mapje (mapje beeld houdt zijn scenes); (9) de
  kosten per bericht ≤ de meting van de andere workflow + 10 % (`tools/bench/invoer.mjs`); de
  speellatentie van de pads (2,6–3,1 ms JS) gaat niet omhoog.
- *Risico*: het grootste oppervlak, vol in de bestanden van de andere workflow; Maschine-pads via de
  bus alleen voor gebonden padmodi (spelen blijft via `noten.js`).

**W7 · Effectcombinaties**
- *Bestanden*: NIEUW `src/control/superknop.js` (puur, `resolveLink` uit `rack.js`),
  `src/control/acties-super.js` (`bindSuper`: `super.K`, `super.K.hold`, `scene.K.*`,
  `track.N.send.a/b.hold`, `send.a/b.rack.next/prev`), `src/ui/werkruimte/fx-matrix.js` en
  `superknop-paneel.js` (bouwstenen, `waar: overal`), `src/ui/beschrijf-super.js`,
  `test/superknop.test.mjs`, `tools/headless/effecten-combi.mjs`. WIJZIGT `src/ui/rack-editor.js` (elk
  slot: track, bus A/B, master), `src/control/terugspelen.js` (`super.*` in `OVERSLAAN`), `src/ui/app.js`
  en `apc-beschrijf.js` (1 regel); optioneel `src/engine/rack.js` (`conflict` som/max, achter data).
- *Hangt af van*: a niets (puur + actions); b W1 (superknoppen bewaren), W2 (panelen inhangen).
- *Acceptatie*: (1) een superknop met 4 links: `invoke(super.1, x)` voor 21 waarden van x geeft precies de
  `resolveLink`-waarden van de gouden tabel van rack.test; (2) log: de kinderen staan erin, `super.*`
  wordt bij terugspelen overgeslagen, en terugspelen geeft dezelfde eindstand bit voor bit; (3)
  `super.1.hold` en `super.2.hold` tegelijk: beide kindsets open, loslaten in elke volgorde zet terug
  wat er stond; (4) het rack van de echobus wisselen terwijl hij klinkt: piek ≤ ×1,6 (zoals
  effecten.test), de oude keten weg na fade + staart; (5) de rack-editor op de master: een wijziging is
  hoorbaar (offline render) en wordt op naam bewaard; (6) een morph van A naar B in 4 s glijdt via
  `.glide`/`zetDoel`, `CURVE_BREUK` = 0, geen timer met posities; (7) in rust 0 nieuwe AudioNodes
  (een node-teller in de mock).
- *Risico*: faders onder een superknop vallen uit hun takeover (waarschuwing in de validator); een
  morph over veel slots kost hoofdthread per tussenstand (33 ms-timer zoals glijden per knop).

**W8 · Standaardindeling, kaarten en de koppeling met standen**
- *Bestanden*: NIEUW `werkruimtes/apc-alleen.json`, `werkruimtes/apc-maschine.json`, `werkruimtes/studio.json`,
  `test/werkruimte-bereik.test.mjs`. WIJZIGT `src/standen/stand-model.js` (deel `werkruimte: { naam }`,
  één regel in `DELEN`) + `server/standen.js` + `test/standen-model.test.mjs`, `src/ui/apc-kaart.js` en
  `src/ui/maschine-kaart-plan.js` (`?w=`: de kaart van een werkruimte), `docs/APC40.md`,
  `docs/MASCHINE.md`, `docs/WERKRUIMTE.md`, `docs/VRAGEN.md` (blok WR); op `visie/handen`:
  `handen/voorstel.json` (de nieuwe plekken als voorstel), `tools/handen/handenkaart.mjs`.
- *Hangt af van*: W1, W2, W5, W6, W7.
- *Acceptatie*: (1) bereikbaarheid: elke action uit de standaardmapping is in `apc-alleen` bereikbaar op
  de APC, en in `apc-maschine` op APC ∪ Maschine; de 96 + 57 kernregels zijn in geen enkele werkruimte
  veranderd; (2) elke action in elke werkruimte bestaat (`has`) en heeft een `beschrijf()`; (3) geen
  signature twee keer in één laag; geen LPD8-zone; geen Bank (note 0x67) in `apc-maschine`; (4)
  `apc.html?w=apc-maschine` toont scene 3 = fx-matrix, `maschine.html` toont F1 = worp plek 1; (5)
  headless met nep-APC + nep-Maschine (het harnas van `speelapparaten.mjs`): F1 indrukken →
  `read(track.N.fx.knob.1.hold)` = 1; scene 3 → `grid.fx` open; hub weg → terugval naar `apc-alleen`
  met één melding; (6) een stand met `werkruimte: { naam }` activeren laat de mixer wisselen zonder
  herladen, en een onbekende naam geeft een waarschuwing, geen fout; (7) `eerder.mjs` gedraaid,
  `mapping.test` en `handen.test` groen (voorstellen die in een werkruimte staan, blijven voorstel tot
  de standaard).
- *Risico*: alles vóór de proef. Daarom blijft `standaard` (= nu) de werkruimte bij het opstarten tot
  Clay er een kiest; nieuwe plekken eerst via learn (HANDEN §1).
