# Ontwerp "handen": de werkruimte, vanuit de controllers gedacht (13 okt 2026)

*Architect "handen". Hoek: CONTROLLER-EERST. Een werkruimte is in de kern een verdeling van
rollen over APC40 mkII, Maschine MK2 (en LPD8, Xboard49, toetsenbord) per onderdeel van de mix;
het scherm volgt de handen. Gelezen: `studio/afmaken` (339310b), `origin/visie/handen`
(HANDEN.md, top-40), de hub (`av-app-hub` PROTOCOL §5–8, §17), de vier verkenningen in deze map,
en de lopende worktrees van de andere workflow (`wt/controller-invoer`, `wt/controller-uitvoer`).
Niets in de repo gewijzigd.*

Clay (13 okt), de zes punten:
1. de knoppen logischer verdelen over de twee controllers;
2. meerdere schermen tegelijk, met de iPad;
3. een track met precisie op de juiste plek zetten;
4. alle tracks tegelijk zien lopen (grid en tracks) om ze gelijk te laten lopen;
5. meer effecten met alle combinatieknoppen die hij kan bedenken;
6. vrijheid over UI en knoppen: een werkruimte in plaats van een app, per onderdeel van de mix
   een andere, "echt complete vrijheid".

---

## 0. Het idee in vijf zinnen

1. **Twee handen, twee breedtes:** de APC is *breed* (alle acht tracks tegelijk, één kolom = één
   track, de zaal) en de Maschine is *diep* (één track, de focus-track, met wiel, 16 pads, namen en
   eenheden op twee schermen). Dat geldt in elk onderdeel, zodat de twee nooit hetzelfde doen.
2. **Een onderdeel ("deel") is waar je handen nu mee bezig zijn**: MIX · UITLIJN · FX · STEMS ·
   SECTIES · SPELEN · BEELD · BLADEREN. Een deel kies je met één knop (Maschine F1–F8, met de naam
   op het scherm erboven; zonder Maschine volgt het deel de grid-modus van de APC). Een deel zet op
   elk apparaat de juiste mapjes open en op elk scherm het juiste paneel. Het zet nooit een
   klankwaarde.
3. **Een werkruimte is DATA** (`werkruimtes/<naam>.json`): per deel de open mapjes per apparaat en
   de panelen per scherm, plus een mapping-verschil per apparaat, eigen mapjes, combinatieknoppen,
   superknoppen en vrije panelen. Alles staat op één standaard, als verschil, nooit als kopie.
   Zonder werkruimte werkt alles precies zoals vandaag.
4. **Precisie en overzicht staan op alle drie de oppervlakken tegelijk.** Op het scherm een
   uitlijnweergave van alle tracks in tellen van de maatgever. Op de APC acht LED-ringen als
   fasemeter, en draaien = duwen. Op de Maschine jog met het wiel en de fasescoop van de focus-track
   op het scherm.
5. **Combinaties zijn regels, geen code:** een knop mag een andere knop als voorwaarde hebben, ook
   over apparaten heen (`met`). Elke value-action kan drukken, vastzetten of kort/lang (`druk`,
   `latch`, `lang`). Een superknop beweegt veel actions tegelijk. De APC krijgt een fx-matrix. De
   engine verandert daarvoor niet.

---

## 1. Uitgangspunten (waarom zo, en wat het nooit doet)

| | |
|---|---|
| Controller eerst | Eerst wordt beslist wat elke hand doet. Het scherm toont daarna wat de handen nu kunnen, en het paneel van het deel komt vanzelf. Een deel wissel je met een knop, niet met de muis. |
| Breed ↔ diep | De APC houdt zijn **kern**, die verandert in geen enkel deel en in geen enkele werkruimte. Per kolom: fader, trackknop = filter, 2×2 (play · sync · A\|B · PFL), Clip Stop, Track Select. Rechts: masterfader, crossfader, tempo-encoder, Nudge, Cue Level, transport. Per deel verandert alleen het **grid** (40 pads + scene) en de **device knobs**. De Maschine heeft één kern: groep A–H = focus, CONTROL = uitleg, SHIFT, F1–F8 = deel. Per deel veranderen pads, draaiknoppen, wiel en schermen. |
| Eén woordenschat | `{focus}` = de track waar je aan werkt. `{speel}` = de track die je bespeelt (instrument). `{tweede}` = de vorige focus (was `{L}`/`{R}`; `{R}` blijft als alias). `{plek}` = het gekozen patroon. Regel: **wat SPEELT (Xboard, Maschine-pads in SPELEN) werkt op `{speel}`, al het andere op `{focus}`**. |
| Eén shift | Op een draaiknop: shift = **fijn** (APC tempo, Maschine draaiknoppen, wiel), zoals nu. Op een pad met inhoud (hotcue, sampler-pad): shift = **leegmaken**. Op een drukpad (kill, stem, worp): shift = **vastzetten**. Op een sectie: shift = **als loop** (de uitzondering die al bestaat). Een toets die anders werkt, wordt in deze tabel rechtgezet en niet in een nieuwe regel. |
| Een deel zet nooit klank | Een deelwissel voert alleen `layer.*`/`werk.*` uit. Faders, knoppen, effecten en wat er speelt blijven staan. Test: een wissel geeft 0 andere invokes. |
| Alles blijft bereikbaar | Een werkruimte zegt alleen WAAR iets staat, nooit wat weg is (STANDEN `VERBODEN_DELEN`: panelen, acties, pijlers, mapjes). Elk mapje houdt zijn kiesknop. Een kernregel en een `layer.*`-kiesknop zijn niet weg te halen. Rijen gaan dicht, maar verdwijnen niet. |
| Draagbaar | `apc-alleen` is volwaardig (K1). `twee-handen` vraagt de hub (K2). De iPad is optioneel, en alleen lezen is genoeg voor de eerste stap. |
| Eerst proeven | De nieuwe indeling zit in **voorbeeld-werkruimtes en stukken**, niet in `mappings/apc40mk2.json`. De standaard en `eerder.mjs` blijven ongemoeid tot na de proef (hub-middag + avond 2b). Pas daarna gaat er iets van de stukken naar de standaard. |

---

## 2. Het datamodel

### 2.1 Vier lagen data, van onder naar boven

```
mappings/<apparaat>.json            de STANDAARD per apparaat (in git): regels + (nieuw) "mapjes"
  + werkruimtes/stukken/*.json      bouwstenen: mapjes + regels + superknoppen + panelen (voorbeelden in git)
  + algemeen eigen verschil         wat Clay overal anders wil (= wat /api/mapping nu bewaart)
  + werkruimte-eigen verschil       wat Clay alleen in DEZE werkruimte anders wil
  = de mapping die per apparaat geldt
  + "delen"                         per deel: welke mapjes open, welk paneel op welk scherm
```

Volgorde: standaard < stukken (in de volgorde van `gebruik`) < algemeen < werkruimte-eigen. Wat
Clay leert, wint altijd van wat er geleverd wordt, en wat hij in een werkruimte leert, wint van
wat hij overal leerde. Learn schrijft standaard in het werkruimte-eigen verschil. Met de schakelaar
"voor alle werkruimtes" gaat het naar algemeen. Is er geen werkruimte actief, dan gaat learn naar
algemeen, en dat is precies wat er vandaag gebeurt.

### 2.2 Het werkruimte-bestand (schema 1)

`werkruimtes/<naam>.json` (Bureaublad-data, niet in git; `VARVE_WERKRUIMTES` voor tests, net als
`VARVE_STANDEN`), met `werkruimtes/.versies/<naam>/` bij elke opslag. De voorbeelden staan in
`tools/werkruimtes/voorbeelden/` en de stukken in `tools/werkruimtes/stukken/` (in git). Een eigen
bestand gaat vóór een voorbeeld met dezelfde naam. Opslaan gaat met `versie` (hash van de inhoud):
409 bij een botsing, nooit stil overschrijven. Claude mag het bestand direct schrijven, en de
mixer ziet het binnen 3 s, net als bij de plannen.

```json
{
  "schema": 1,
  "naam": "twee-handen",
  "titel": "APC breed · Maschine diep",
  "uitleg": "APC = alle tracks (kolommen, grid over alle tracks). Maschine = de focus-track: precisie, secties, sampler, spelen, bladeren. F1–F8 kiezen het deel.",
  "vereist": { "apparaten": ["apc40mk2", "maschine-mk2"] },
  "gebruik": ["uitlijn", "fx-matrix", "maschine-delen", "beeld-op-maschine", "stems-op-maschine"],

  "deel": { "start": "mix", "kiezen": "expliciet", "onthoud": true },

  "delen": {
    "mix": {
      "label": "MIX", "kleur": "wit",
      "apc40mk2":     { "grid": "hotcues", "device": "strip" },
      "maschine-mk2": { "pads": "transport", "pagina": "strip", "wiel": "jog", "scherm": ["strip", "fasescoop"] },
      "scherm": { "hoofd": { "vak": "uitlijn-strook", "rijen": [] }, "ipad": { "vakken": ["uitlijn", "paneel:mijn-mix"] } }
    },
    "uitlijn": {
      "label": "UITLIJN", "kleur": "groen",
      "apc40mk2":     { "device": "uitlijn" },
      "maschine-mk2": { "pads": "transport", "pagina": "uitlijn", "wiel": "jog", "scherm": ["fasescoop", "getallen"] },
      "scherm": { "hoofd": { "vak": "uitlijn" }, "mac-2": { "vakken": ["uitlijn"] }, "ipad": { "vakken": ["uitlijn"] } }
    },
    "fx": {
      "label": "FX", "kleur": "violet",
      "apc40mk2":     { "grid": "fx", "device": "rack" },
      "maschine-mk2": { "pads": "worpen", "pagina": "rack", "wiel": "rack", "scherm": ["rack", "super"] },
      "scherm": { "hoofd": { "vak": "paneel:super", "rijen": ["master"] }, "ipad": { "vakken": ["paneel:super", "paneel:worpen"] } }
    },
    "stems": {
      "label": "STEMS", "kleur": "zeegroen",
      "apc40mk2":     { "grid": "stems" },
      "maschine-mk2": { "pads": "stems", "pagina": "stems", "scherm": ["stems"] },
      "scherm": { "hoofd": { "rijen": ["stems"] } }
    },
    "secties": {
      "label": "SECTIES", "kleur": "hemelsblauw",
      "apc40mk2":     { "grid": "loops" },
      "maschine-mk2": { "pads": "secties", "pagina": "strip", "wiel": "sectie", "scherm": ["secties"] }
    },
    "spelen": {
      "label": "SPELEN", "kleur": "oranje",
      "apc40mk2":     { "grid": "patronen", "device": { "als": { "focus.instrument": "inst" }, "anders": "strip" } },
      "maschine-mk2": { "pads": { "als": { "speel.instrument": "spelen" }, "anders": "sampler" }, "pagina": "instrument", "wiel": "instrument" },
      "scherm": { "hoofd": { "rijen": ["instrument", "patronen"] } }
    },
    "beeld": {
      "label": "BEELD", "kleur": "geel",
      "apc40mk2":     { "grid": "video", "device": "beeld" },
      "maschine-mk2": { "pads": "beeld", "pagina": "beeld", "wiel": "mengvorm", "scherm": ["beeld"] },
      "scherm": { "hoofd": { "rijen": ["beeld"] }, "ipad": { "vakken": ["paneel:video-fx"] } }
    },
    "bladeren": {
      "label": "LIBRARY", "kleur": "grijs",
      "maschine-mk2": { "pads": "laden", "pagina": "strip", "wiel": "bladeren", "scherm": ["blader"] },
      "scherm": { "hoofd": { "onderpaneel": "library" }, "ipad": { "vakken": ["kaart"] } }
    }
  },

  "volgt": [],

  "mapjes": {
    "apc40mk2": { "grid": { "volgorde": ["hotcues", "loops", "klank", "stems", "fx", "video"] } }
  },

  "mapping": {
    "apc40mk2":     { "kind": "diff", "device": "apc40mk2",     "base": "<vingerafdruk>", "rules": [], "removed": [] },
    "maschine-mk2": { "kind": "diff", "device": "maschine-mk2", "base": "<vingerafdruk>", "rules": [], "removed": [] },
    "toetsen":      { "kind": "diff", "device": "toetsen",      "base": "<vingerafdruk>", "rules": [], "removed": [] }
  },

  "superknoppen": [
    { "nr": 1, "naam": "DUB", "glide": 0,
      "links": [
        { "action": "track.{focus}.send.a",        "in": [0, 0.3], "from": 0,   "to": 1 },
        { "action": "send.a.knob.2",               "in": [0.3, 1], "from": 0.5, "to": 0.9 },
        { "action": "track.{focus}.filter",        "in": [0, 1],   "from": 0.5, "to": 0.72, "curve": "s" },
        { "action": "video.fx.trails",             "in": [0.5, 1], "from": 0,   "to": 0.6 } ] }
  ],

  "panelen": {
    "mijn-mix": { "titel": "MIX", "volgt": "focus", "items": [
      { "soort": "knop",  "action": "track.{focus}.play.quant", "label": "OP DE 1" },
      { "soort": "knop",  "action": "track.{focus}.bar.align",  "label": "OP DE MAAT" },
      { "soort": "knob",  "action": "track.{focus}.phase.offset" },
      { "soort": "knob",  "action": "super.1" } ] }
  },

  "schermen": {
    "hoofd": { "soort": "mixer" },
    "mac-2": { "soort": "venster" },
    "ipad":  { "soort": "ipad",
               "mag":   ["track.*.section.*", "track.*.play.quant", "track.*.phase.offset", "super.*", "video.fx.*", "video.layer.*", "werk.deel.*", "track.*.stem.*"],
               "nooit": ["record.*", "log.*", "track.*.play", "track.*.cue", "mapping.*"] }
  },

  "lpd8": null
}
```

Regels voor het bestand (alle in `normaliseerWerkruimte`, puur, zonder imports, zoals
`normaliseerStand`):
- `schema` = 1. `naam` bestaat uit kleine letters, cijfers, `-` en `_` (≤ 60), net als bij de
  standen. `titel` ≤ 60 en `uitleg` ≤ 300.
- `delen`: hooguit 16 en elk met een `label` (≤ 8 tekens: zo past het boven F1–F8). Een deel heet
  naar een vaste of eigen naam. Per apparaat staan alleen groepen die dat apparaat kent (uit
  `mapjes` van de standaard, een stuk of de werkruimte). Een onbekend mapje is een waarschuwing en
  wordt overgeslagen, nooit geraden.
- **Condities** (`als`/`anders`): een vaste witte lijst. `focus.instrument`, `focus.nummer`,
  `focus.stems`, `focus.leeg`, `speel.instrument`, `hub`, `apparaat.<id>` (dat apparaat is er).
  Geen expressies, geen code. Het is de veralgemening van `OP_AANVRAAG` (inst alleen met een
  instrument).
- `deel.kiezen`: `"expliciet"` (alleen F-knoppen, werk-balk of iPad wisselen het deel) of
  `"volgt"` (de regels in `volgt` wisselen het ook). `onthoud: true` betekent: kom je terug in een
  deel, dan krijg je de mapjes die je daar het laatst open had (sessietoestand, wordt niet bewaard).
- `volgt`: `[{ "apparaat": "apc40mk2", "mapje": "grid.stems", "deel": "stems" }, …]`. Hiermee
  wisselt een open mapje het deel. Een wissel die uit een `volgt` komt, zet de mapjes van DAT
  apparaat niet opnieuw (geen lus; getest).
- `mapping.*.removed` mag geen kern bevatten: niet `track.N.fader/play/cue/filter/focus`,
  `mixer.*`, `video.black*`, `record.stop` of `layer.*`. Opslaan weigert dan met een reden (400).
- `schermen.<naam>.mag`/`nooit`: patronen met `*` (per segment). `nooit` wint. Er staat altijd een
  vaste lijst bovenop die geen werkruimte kan openzetten: `record.*`, `log.*`, `mapping.*`,
  `werk.opslaan`, en laden over een spelende track zonder tweede druk.
- `superknoppen`: hooguit 16 (`super.1–16`). Links in dezelfde vorm als in `rack.js` en opgelost
  met DEZELFDE `resolveLink` (één rekenregel). Een link naar een onbekende action wordt grijs, met
  een melding, en nooit een crash.
- `lpd8`: null (de hub-rollen zoals ze nu zijn) of `{ "rollen": { "macro.helderheid":
  "video.master", "macro.beweging": "video.pulse" }, "paniek": "video.black.hold" }`. Dit geldt
  **per werkruimte, niet per deel**: het manifest gaat mee bij het verbinden, en wisselen zou
  herverbinden vragen. Rollen die andere apps als beeld gebruiken (`macro.intensiteit`, de K1-dip
  0,80 → 0,43) zijn geweigerd.

### 2.3 Een stuk (bouwsteen)

`tools/werkruimtes/stukken/uitlijn.json`: zelfde velden als een werkruimte, zonder `delen` en
`schermen`. Het levert mapjes, regels (als verschil op de standaard), superknoppen en panelen.
Stukken maken het parallel bouwen mogelijk (elk spoor levert zijn eigen stuk), en Clay kan ze
combineren ("fx-matrix wel, uitlijn niet").

```json
{ "schema": 1, "stuk": "uitlijn", "titel": "Acht fasemeters op de device knobs",
  "mapjes": { "apc40mk2": { "device": { "knoppen": { "uitlijn": ["uitlijn"] },
                                        "namen": { "uitlijn": "uitlijn (fase per track · ring = fasemeter)" } } } },
  "regels": { "apc40mk2": [
    { "in": "note:0:63", "shift": true, "action": "layer.device.uitlijn", "mode": "trigger" },
    { "in": "cc:0:16", "laag": "device.uitlijn", "action": "track.1.phase.offset", "mode": "endless", "ring": "pan" },
    { "in": "cc:0:17", "laag": "device.uitlijn", "action": "track.2.phase.offset", "mode": "endless", "ring": "pan" },
    { "in": "note:0:58", "laag": "device.uitlijn", "action": "track.{focus}.jog.back", "mode": "trigger" },
    { "in": "note:0:59", "laag": "device.uitlijn", "action": "track.{focus}.jog.fwd",  "mode": "trigger" },
    { "in": "note:0:62", "laag": "device.uitlijn", "action": "track.{focus}.bar.align", "mode": "trigger" } ] } }
```

(cc:0:18–23 gaan zo door tot track 8. `ring` is een nieuw regelveld dat het ringtype kiest; nu
komt dat uit het profiel. Zonder `ring` blijft het profiel beslissen.)

### 2.4 Mapjes als data (in de standaard en in stukken)

`GROEPEN`, `volgorde`, `OP_AANVRAAG` en `LAAGNAAM` uit `lagen.js` verhuizen naar het
mappingdocument van het apparaat (veld `mapjes`, naast `rules`). `mappings/apc40mk2.json` krijgt
precies de huidige inhoud (gouden test: daaruit afgeleid = de constante van vandaag).
`mappings/maschine-mk2.json` krijgt zijn eigen groepen:

```json
"mapjes": {
  "pads":   { "standaard": "spelen", "knoppen": { "step": ["stappen"], "scene": ["secties"], "sampling": ["sampler"] },
              "doorgeef": { "spelen": "noten" } },
  "pagina": { "standaard": "instrument", "volgorde": ["instrument", "strip", "rack"], "knoppen": { "browseL": "prev", "browseR": "next" } },
  "wiel":   { "standaard": "instrument" }
}
```

- `doorgeef: noten` betekent: in deze padmodus gaan de pads naar `noten.js`, niet naar de bus.
  Dat is het pad van vandaag (2,6–3,1 ms JS), en het verandert niet.
- De pads van de andere padmodi worden **regels**: `{ "in": "note:0:36", "laag": "pads.secties",
  "action": "track.{focus}.section.{sectie}" }`. Daarbij geeft maschine.js per pad een variabele
  mee (`{sectie}` = 16·blad + pad, `{stap}`, `{sampler}`). Het rekenwerk (bladzijde) blijft code,
  maar WAT een pad doet is data. `resolveTarget` hoeft niet te veranderen.
- `Lagen` wordt per apparaat gemaakt (`new Lagen({ groepen })`), niet uit één globale constante.
  `voegVormMapjeToe()` wordt een stuk (`vormen`) en muteert niets meer.
- De `layer.<groep>.<knop>`-actions worden uit de data afgeleid (zoals `actions.js:1467` nu uit
  GROEPEN). Ze worden opnieuw gedefinieerd als een werkruimte mapjes toevoegt, en zijn per
  apparaat te onderscheiden: `layer.maschine-mk2.pads.secties`. Voor de APC blijven de namen
  `layer.grid.*` en `layer.device.*` (oude mappings en logs).

### 2.5 Nieuwe regelvelden in een mapping (combinaties en precisie)

| veld | voorbeeld | wat het doet |
|---|---|---|
| `met` | `"met": "maschine-mk2:note:1:45"` | geldt alleen zolang die control ingedrukt is, ook op een ander apparaat. Sleutel `sig#shift@laag+met`. `kies()` probeert eerst regels met een `met` die nu vastzit. |
| `mode: "druk"` + `naar` | `{ "action": "track.{focus}.send.a", "mode": "druk", "naar": 1 }` | elke value-action als drukknop: indrukken zet `naar` (direct), loslaten zet terug wat er stond. Beide gaan over de bus, dus allebei in het log. |
| `mode: "latch"` + `naar` | idem | druk = `naar`, nog eens = de stand van daarvoor |
| `lang` | `"lang": 400` (bij `druk`/`latch`) | kort drukken = latch, lang = momentary (dezelfde 400 ms als gluren) |
| `mode: "stappen"` | `{ "in": "cc:0:24", "mode": "stappen", "action": "track.{focus}.jog" }` | een relatieve encoder roept per klik `<action>.fwd` of `<action>.back` aan (triggers, regel 2), hooguit 8 per bericht |
| `ring` | `"ring": "pan"` | ringtype voor deze regel (endless-knoppen op de APC) |
| `als` (in een stuk) | `"als": "focus.instrument"` | regel alleen met deze conditie (zelfde witte lijst) |
| `modifier: "stil"` | op de regel van de knop die als `met` dient | de eigen action van die knop gaat pas af bij loslaten, en alleen als er geen combinatie was. Alleen toegestaan op een knop die niet tijdkritisch is (`normaliseer` weigert dit op play, cue, hotcue, `*.hold`, `layer.*`). |

`met` over apparaten heen leunt op één nieuw register, `src/control/ingedrukt.js` (puur): per
apparaat welke signatures nu vastzitten. Elke Mapping (APC, Maschine, Xboard, toetsen) meldt
indrukken en loslaten, en `losgekoppeld()` maakt dat apparaat leeg. De Mapping-instanties blijven
gescheiden, en alleen dit register is gedeeld.

### 2.6 Hoe het verschilt van een stand en van een mapping

| | mapping | stand (opstelling) | werkruimte |
|---|---|---|---|
| zegt | wat één control doet, per apparaat, per mapje | met welke **beginwaarden** een avond begint (krat, nachtrem, master-rack, hub-set) | **waar** alles zit: rollen per apparaat per deel, panelen per scherm, combinaties |
| wanneer | elk bericht | één keer bij activeren; de mixer leest het bij de volgende start | live, tientallen wissels per set, zonder herladen |
| bestand | `mappings/<apparaat>.json` + verschil op de server | `standen/<naam>.json` | `werkruimtes/<naam>.json` + `werkruimtes/stukken/` |
| verbiedt | — | panelen, acties, pijlers, mapjes | weghalen van kern en kiesknoppen; panelen verbergen |
| relatie | de werkruimte draagt verschillen per apparaat | een stand mag een werkruimte **noemen** (nieuw deel `werkruimte: { naam }`, een keuze zoals een sjabloonnaam) | de werkruimte kent geen standen |

Het deel dat nu open staat is **sessietoestand**. `werk.deel.*` gaat over de bus (en dus in het
log), maar terugspelen slaat `werk.*` over, net als `layer.*`.

---

## 3. De knoppenverdeling

### 3.1 Wat in elk deel hetzelfde blijft

| apparaat | vast in elke werkruimte en elk deel |
|---|---|
| **APC40 mkII** (de kern) | per kolom: fader · trackknop = filter · ● = PFL (⇧ cue) · S = sync (⇧ tap) · ▶ = play (⇧ op de maat) · A\|B = kant · Clip Stop = loop (⇧ weg) · Track Select = focus (⇧ tweede). Rechts: masterfader, crossfader, tempo-encoder (⇧ fijn), Nudge ± = bend (⇧ toon), Cue Level = koptelefoon (⇧ mix), Tap (⇧ keylock), Pan/Sends/User = loop in/out/reloop, Lock = quantize, Stop All = rem, Play, Record (⇧ stop), master-knop = beeld zwart, ◀ ▶ = focus. Met de hub is Bank de hubtoets. |
| **Maschine MK2** (alleen met de hub) | F1–F8 = deel kiezen (het scherm toont de 8 labels erboven, het deel van nu omgekeerd) · groep A–H = focus · CONTROL = uitleg · SHIFT = fijn / tweede · STEP, SCENE, SAMPLING = de padmodus binnen het deel (onthouden per deel) · PATTERN + pad = plek · PLAY/RESTART/REC/ERASE = patroon van de speeltrack · ◄ ► links boven = knoppagina binnen het deel · BROWSE = naar het deel BLADEREN en weer terug |
| **LPD8** | hub: K2 helderheid = `video.master`, K4 beweging = `video.pulse`, P1 paniek = `video.black.hold`. Varve pakt geen extra rollen, ook niet per deel. |
| **Xboard49** | toetsen, pedaal, bend → `{speel}`. Knop 1–8 = instrument `{speel}`, knop 9–16 = fx `{speel}`, schuif = fader `{speel}` (CC's: AANNAME tot de hub-middag) |
| **Toetsenbord** | KEYMAP wordt `mappings/toetsen.json` met dezelfde regels. Linkerhand `{focus}`, rechterhand `{tweede}`. Space, `[` `]`, B en Cmd+Z blijven. |

### 3.2 Per deel: wat elke hand doet (`twee-handen`)

Pads van de Maschine worden van onder (rij 1) naar boven (rij 4) beschreven, van links naar
rechts, zoals op het apparaat (pad 1 = linksonder).

| deel | APC grid (40 pads · scene 1–5) | APC device knobs (8) | Maschine pads (4×4) | Maschine draaiknoppen (8) | Maschine wiel | Maschine schermen (links · rechts) | scherm hoofd | iPad |
|---|---|---|---|---|---|---|---|---|
| **MIX** (F1) | hotcues per kolom (zoals nu). Met ▲ ▼: loops · klank · stems · fx · video | strip (trim · H · M · L · echo · galm · fx-mix · fx1) | r1: play.quant · sync · cue · bar.align. r2: beatloop ¼ · ½ · 1 · loop weg. r3: beatloop 2 · 4 · 8 · 16. r4: hotcue 1–4 (⇧ = wis) | strip van de focus (zoals pagina Strip nu, 8 = filter) | **jog** ±1/16 tel (⇧ 1/64); TEMPO vast + wiel = tempo ±0,01%; SWING vast + wiel = `phase.offset` | strip in eenheden · fasescoop van de focus tegen de maatgever + bpm, Δ ms | spiegel + uitlijnstrook (alle tracks, één maat) onder de banen | uitlijn + paneel "mijn-mix" |
| **UITLIJN** (F2) | blijft wat het was (hotcues) | **acht fasemeters**: knop k = `track.k.phase.offset`, ring = pan (midden = gelijk), draaien = duwen. Device ◀ ▶ = jog focus, On/Off = op de maat | zoals MIX r1–r3; r4: beatjump −1 · −¼ · +¼ · +1 tel | 1 `phase.offset` focus · 2 tempo (step 0,0001) · 3 bend-sterkte · 4 grid-bpm (alleen met het slot uit) · 5 grid ‹ › (±1 ms) · 6 `headphone.mix` · 7 duoklik (P7) · 8 filter | jog (⇧ fijn) | **fasescoop** (vouw) van de focus · getallen: grid Δ, muziek Δ, drift ms/16 tellen, maat ±N | **uitlijnweergave** groot (pagina-vorm) | uitlijn (vouw + banen) |
| **FX** (F3) | **fx-matrix**: kolom = track, rij 1–4 = worp plek 1–4 (`track.N.fx.knob.K.hold`), rij 5 = echo-worp (`track.N.send.a`, druk → 1). ⇧ + pad = vastzetten (latch). Scene 1–4 = master-worp 1–4, scene 5 = loop weg | rack van de focus (fx 1–8) | r1–r2: worp plek 1–8 van de focus (hold, ⇧ latch). r3: galm-worp · echo-worp · bypass · fx-mix druk. r4: superknop 1–4 als drukknop | rack van de focus, met naam en eenheid per plek | rack kiezen (stappen → `rack.next/prev`) | rack: 8 namen + waarden · superknoppen 1–8: naam + stand | spiegel; master-rij open; paneel "super" in het werkvak | superknoppen + worpen (touch) |
| **STEMS** (F4) | stems per kolom: zang · rest · drums · bas · overig weg zolang je drukt (⇧ vast), zoals nu | strip | kolom = stem (zang · drums · bas · overig). r1: weg (⇧ vast). r2: echo-worp van de stem. r3: galm-worp. r4: cue (PFL) | pagina **stems**: 1–4 niveau per stem, 5–8 filter per stem. Met ◄ ► de pagina "stem-sends": 1–4 echo, 5–8 galm | — | de vier stems met niveau, filter en wat er weg is · de stemkill van alle tracks (8×4 raster) | STEMS-rij open | stems van de focus (schuiven) |
| **SECTIES** (F5) | loops per kolom (zoals nu) | strip | secties van de focus, 16 per blad (◄ ► transport), **⇧ = als loop** (dat ontbreekt nu op de Maschine) | strip | sectie volgende/vorige (stappen → `section.next/prev`, valt in op de "1") | de sectiekaart van de focus met wat je hoort · 4×4-raster met namen | spiegel (het focusdeck toont de secties al) | secties van de focus (tikken = op de "1", veilig over wifi) |
| **SPELEN** (F6) | patronen: pad = plek per track, scene = rij | inst als de focus een instrument heeft, anders strip | met een instrument op de speeltrack: noten (via noten.js). Zonder: sampler (SAMPLING-indeling). STEP/SCENE wisselen zoals nu | instrument `{speel}` (zoals nu) | instrument kiezen, ENTER = zetten (zoals nu) | instrument + knoppen (zoals nu) | INSTRUMENT- en PATROON-rij open | — (geen spelen over wifi) |
| **BEELD** (F7) | video (holds, zoals nu) | beeld (Stroommachine-macro's 1–8) | r1: `video.fx.pixel/trails/grain/mirror` hold. r2: `rgb/color` hold · freeze · flash. r3: `beeld.regie.*` 1–4. r4: zwart vasthouden · zwart · `beeld.regie.vrij` · vormlaag aan | 1–6 = `video.fx.pixel · trails · grain · mirror · rgb · color` (de top-14 muisactions zonder knop) · 7 `video.master` · 8 `video.pulse` | mengvorm (stappen → `video.mode`) | de zes video-fx met stand · beeld: zwart/bevroren/master | BEELD-rij open | video-fx-schuiven (touch werkt hier goed) |
| **BLADEREN** (F8) | blijft wat het was | strip | r4–r3: **laad op track 1–8** (`track.N.load.selected`, tweede druk over een spelende track). r1: library-pagina − · + · sorteer · krat | strip | door de lijst (zoals nu) | de lijst (zoals nu) · het gekozen nummer: bpm, toon, past-bij | library-onderpaneel open | kaart (companion-tab) |

Wat er bij de **APC** verandert, staat allemaal in stukken (`uitlijn`, `fx-matrix`) en in de
`mapjes`-volgorde van de werkruimte. Er verandert **geen enkele regel van de standaard**:
- de ▲ ▼-volgorde in `twee-handen` wordt hotcues · loops · klank · stems · fx · video. Secties,
  sampler, patronen en auto blijven op ⇧ + scene zoals nu, maar draaien niet meer mee in ▲ ▼: die
  zitten op de Maschine. Het mapje blijft bestaan en bereikbaar;
- nieuw mapje `grid.fx` (kiesknop ⇧ + On/Off, nu vrij), nieuw mapje `device.uitlijn` (⇧ + Lock,
  nu vrij; Lock is quantize en hoort bij timing).

Wat er bij de **Maschine** verandert: de pads worden data (§2.4). De nieuwe padmodi `transport`,
`worpen`, `stems`, `beeld` en `laden` en de pagina's `uitlijn`, `stems` en `beeld` staan in het
stuk `maschine-delen`. In het stuk `maschine-knoppen` krijgen de vrije knoppen een rol als
modifier voor `met`:
- TEMPO vast + wiel = tempo fijn;
- SWING vast + wiel = `phase.offset`;
- **VOLUME vast + draaiknop k = fader van track k** (relatief). Daarmee heeft K3 ("Maschine alleen")
  toch faders;
- SOLO vast + stem-pad = alleen deze stem: een superknop die de andere drie killt (data, geen
  nieuwe action);
- MUTE = `track.{focus}.fx.bypass`;
- DUPLICATE vast + sampler-pad = `sampler.N.drums` (het HANDEN-voorstel).

ALL, AUTO, GRID, NOTE REPEAT, PAD MODE, NAVIGATE en SELECT blijven vrij. NOTE REPEAT is
gereserveerd voor loop roll, als Clay dat wil (VRAGEN W6).

### 3.3 `apc-alleen` (K1, onderweg)

- `deel.kiezen: "volgt"`, met `volgt`: grid.hotcues/loops/klank → MIX, device.uitlijn → UITLIJN,
  grid.fx → FX, grid.stems → STEMS, grid.secties → SECTIES, grid.patronen/sampler → SPELEN,
  grid.video en device.beeld → BEELD. Zo volgt het scherm de APC: druk ⇧ + scene 3 en de STEMS-rij
  gaat open.
- Mapjes en volgorde zoals vandaag (alle negen grid-modi in ▲ ▼), plus de stukken `uitlijn` en
  `fx-matrix` (die alleen via hun eigen ⇧-kiesknop opengaan, niet in ▲ ▼).
- Gevolg: met een lege werkruimte (`standaard`) ben je bit voor bit in de app van vandaag;
  `apc-alleen` geeft er twee mapjes bij en laat het scherm meelopen.

### 3.4 Wat zo rechtgezet wordt (de problemen uit de verkenning)

| probleem | oplossing |
|---|---|
| vier woorden voor "welke track" | §1: één woordenschat. Op de Maschine wisselt het doel nog maar op één plek: SPELEN = `{speel}`, de rest `{focus}` |
| shift betekent per apparaat iets anders | §1: één shift-tabel. `normaliseer` waarschuwt bij een regel die ervan afwijkt |
| 9 grid-modi + 6 device-mapjes om te onthouden | met de Maschine erbij nog 6 in ▲ ▼. Het deel zet ze zelf open. De werk-balk en het Maschine-scherm zeggen altijd waar je bent |
| de Maschine doet sampler, secties en patronen nog eens, anders | in `twee-handen` doet de APC ze niet meer in ▲ ▼. De Maschine-indeling volgt de APC (⇧ = als loop bij secties, ⇧ = leeg bij de sampler, zoals op de APC) |
| strip knop 8 is fx1 op de APC en filter op de Maschine | blijft zo, maar nu bewust: op de APC zit het filter al op de trackknop. De uitleg (CONTROL, kaarten) noemt het verschil |
| de meest gebruikte muishandelingen zonder knop | video-fx (BEELD: Maschine knop 1–6), pitch/tempo (UITLIJN knop 2), stems per stem (STEMS-pagina), xfade.thru (stuk `mix-extra`: ⇧ + A\|B = thru, nu vrij), seek (jog), klankschaal (blijft vrij; koppelen kan) |
| geen jog of scrub | §5 |
| geen combinatieknoppen | §7 |
| alleen de APC-mapping is data | §2: elk apparaat en het toetsenbord. Mapjes en padmodi worden data |

---

## 4. Schermen en de iPad

### 4.1 Drie soorten scherm

| scherm | wat | transport | latentie | wat het mag |
|---|---|---|---|---|
| **hoofd** (`index.html`) | de mixer zoals nu (spiegel, kolommen, rijen) + **werk-balk** (8 delen, wie het koos: "F3 · Maschine") + **werkvak** boven `#rijen` (het paneel van het deel: uitlijn, een vrij paneel) | — | — | alles, zoals nu |
| **mac-2** (`werk.html?scherm=mac-2`, tweede monitor) | de vakken uit de werkruimte voor dit scherm, en ze volgen het deel | `window.opener.varveWerk` (zoals beamer, plan, maschine-kaart: drie keer bewezen) | 0: dezelfde thread, een synchrone aanroep | lezen + knoppen uit vrije panelen (via de bus van de mixer) |
| **ipad** (`werk.html?scherm=ipad`, Safari via Tailscale) | idem, met touch-maten | WebSocket naar de VARVE-server, relais naar het mixertabblad met de Web Lock | relais 0,13 ms mediaan, p99 0,5 ms (gemeten op loopback). Daarbovenop wifi + WireGuard (AANNAME: 2–15 ms per richting) en touch (AANNAME: tientallen ms) | fase 1 alleen lezen; fase 2 de actions uit `mag` min `nooit` |

`werk.html` is één pagina met één code. Ze kiest haar transport zelf: `opener` als die er is,
anders de WebSocket. Ze opent **nooit** een AudioContext of MIDI en vraagt geen Web Lock. Een test
bewaakt dat aan de importboom, zoals `regels-companion.test.mjs` dat voor de companion doet.

### 4.2 Wat er op een scherm kan (paneelregister, v1)

- `uitlijn` (alle tracks, §6), `uitlijn-strook` (één maat, klein, in het hoofdvenster onder de
  banen);
- `paneel:<id>`: een vrij paneel uit `panelen` (`knob`, `knop`, `fader`, `schuif`, `xy`
  (twee value-actions), `stand` (een read als tekst/lampje), `label`). Het maakt dezelfde elementen
  die `controls.js` al bindt (`.knob[data-action]`, `[data-kind=button]`, `input[type=range]`). De
  labels komen uit `beschrijf()`, de kleur uit `soorten.js`, en `{focus}`/`{speel}` gaan via
  `resolveTarget`;
- `stand` (het deel, de maatgever, de tijd, wat er speelt), `secties` (de kaart van de focus),
  `kaart` (de companion-weergave, alleen lezen);
- in het hoofdvenster ook de bestaande rijen bij naam (`rijen: ["stems"]` = die rij open en in
  beeld scrollen; andere rijen gaan dicht, maar hun kop blijft) en `onderpaneel: "library"`.

De bestaande rijen worden in v1 niet omgebouwd tot losse bouwstenen: dat raakt te veel headless
tools die op vaste id's rekenen (rijen.mjs, kijk.mjs, bovenbalk). Op mac-2 en de iPad kunnen dus
in v1 alleen de panelen hierboven. De rijen als bouwsteen komen in een latere stap, buiten deze
acht sporen.

### 4.3 Vrij paneel en binden

Nu bindt `vensters.js` (r. 40/45) knoppen één keer bij het opstarten, en de renderloop krijgt die
lijst. Nodig is `bind(root)` / `ontbind(root)`: een paneel dat verschijnt, meldt zijn Knobs en
faders aan bij de renderloop en haalt ze weer weg. Op mac-2 en de iPad draait een eigen kleine
renderloop die dezelfde `read()`'s volgt (opener: direct; iPad: uit de stand die de mixer stuurt).

### 4.4 Het protocol naar de iPad (WebSocket, server = alleen doorgeefluik)

```
iPad  → server  { t:"hallo", scherm:"ipad", werkruimte:"twee-handen", token }      (cookie, na koppelen)
server → mixer  { t:"scherm", id, scherm:"ipad" }                                  (alleen naar het tabblad met de Web Lock)
mixer → iPad    { t:"stand", deel, reads:{…}, panelen:[…], maatgever, V, klok }   (volledig bij verbinden, ~11 kB)
mixer → iPad    { t:"verschil", reads:{ "track.3.phase.offset": 0.53, … } }        (hooguit 20×/s, alleen wat veranderde)
mixer → iPad    { t:"seg", track:3, id:812, seg:{T,P,R,loop,speelt,rem} }          (bij elk nieuw segment: _segId)
mixer → iPad    { t:"grid", track:3, versie:14, grid:{…} }                         (bij een nieuwe gridVersie)
iPad  → mixer   { t:"invoke", n:41, action:"track.3.section.5", v:true }           (pas na de witte lijst van de mixer)
iPad  → mixer   { t:"los", n:41 }                                                  (loslaten naar wat n indrukte)
beide           { t:"ping", id, t } / { t:"pong", id, t, tu }                      (klokverschil, zoals de Stroommachine)
```

- **Regel 3 over het netwerk:** posities gaan niet per beeld over wifi. De iPad rekent zelf
  `positieIn(seg, t_mixer)` met het klokverschil uit ping/pong, zoals de streamkern dat al over de
  draadgrens doet. Peaks, grid, onsets en tellen haalt de iPad zelf van de server (`peaks.bin`
  staat al op de witte lijst).
- **De mixer beslist, niet de server.** De server stuurt alleen door naar het tabblad met de Web
  Lock (zelfde beslisser als `statusVanMij` in app.js). Een tweede mixer-tabblad krijgt niets.
- **Veiligheid** (de eerste schrijfweg van buiten de Mac: dit vraagt een expliciete keuze van
  Clay, VRAGEN W1):
  - alleen via `VARVE_HOSTS` (tailnet, HTTPS via `tailscale serve`) of localhost. Nooit LAN zonder
    versleuteling, nooit funnel;
  - Origin precies de eigen pagina;
  - **koppelen**: de mixer toont een code van 6 cijfers, de iPad tikt hem in en krijgt een token
    in een `HttpOnly`-cookie, zoals bij de hub;
  - de mixer voert alleen actions uit die in `mag` van DAT scherm staan, niet in `nooit`, en niet
    in de vaste lijst (§2.2);
  - een destructieve action (laden over een spelende track) vraagt ook vanaf de iPad een tweede
    druk;
  - **wegvallen = alles loslaten**: een hartslag elke 0,5 s; na 1,5 s stilte laat de mixer elke
    `n` los die nog vastzit (zoals `mapping.losgekoppeld()`);
  - `invoke(id, v, { bron: 'ipad' })`: de bron komt in de 4e logkolom (die bestaat al voor `van`).
- **Tijdkritisch hoort niet op de iPad.** Een knop die "play" heet, is op de iPad
  `track.N.play.quant`. Secties vallen in op de "1", hotcues met quantize. Bend nooit: het effect
  hangt af van hoe lang je drukt, en wifi-jitter maakt dat onvoorspelbaar. Duwen wel, als afstand
  (`phase.offset`), want dat is ongevoelig voor vertraging.
- **Twee bronnen op één knop** (APC + iPad): soft-takeover geldt al via `read()` (een fader op de
  APC die de iPad verzette, moet opnieuw overpakken). "Loslaten = de action van het indrukken"
  geldt ook voor de iPad (`n`).

### 4.5 De volgorde

7a: `werk.html` via `opener` op een tweede Mac-scherm. Daarna 7b: dezelfde pagina via de
WebSocket op de iPad, **alleen lezen** (uitlijn, stand, secties). Pas daarna 7c: de iPad stuurt,
na Clay's keuze (W1) en na de proef van companion-stap 2 (de mixer-POST is nog nooit live
geproefd).

---

## 5. Precisie (punt 3)

Wat er nu is: bend 4% zolang je drukt (APC Nudge), de tempo-encoder (0,1% / 0,01%), nudge 50 ms
(alleen op het toetsenbord), beatjump vanaf 1 tel, en seek, dat absoluut over het hele nummer
werkt. Er is geen draaiknop die de fase verzet en geen jog. Het ontwerp voegt actions toe (data
op de bus); de engine krijgt alleen getallen.

| # | action | soort | wat | waar de hand hem vindt |
|---|---|---|---|---|
| P1 | `track.N.phase.offset` | value | read = fase t.o.v. de maatgever als fractie f van een tel (−½…+½), **niet-lineair** op 0..1: `v = ½ + ½·sign(f)·√(2|f|)`, dus 0,5 = gelijk. null zonder grid, zonder maatgever, of als dit de maatgever is. invoke(v) = duwen met `deck.nudge((f(v) − f_nu) × tel)`; dat bestaat al, is fasebehoudend en blijft binnen de loop. Met de √: de eerste LED naast het midden zit op ~5 ms (124 bpm), daarna ~20 ms. Een tik vanuit het midden is ~0,06 ms, 10 ms duwen kost ~13 tikken, het hele bereik ±½ tel ~64 tikken | APC device.uitlijn (ring = pan), Maschine UITLIJN knop 1, SWING + wiel, vrij paneel |
| P2 | `track.N.jog.back/.fwd` (+ `.fine`) | trigger | 1/16 tel (fijn 1/64) via het grid op de positie (`beatLengthAt`). Speelt hij: `seek(…, { doorlopend: true, binnenLoop: true })`. Staat hij stil of in pauze: een gewone seek, en dan verschuift ook het cuepunt niet mee (ONTBREEKT B6, fijn zoeken in pauze). Zonder grid: 5 ms (fijn 1 ms) | Maschine wiel (`stappen`), APC device.uitlijn Device ◀ ▶ |
| P3 | `track.N.bar.align` | trigger | beatjump van −2…+2 tellen naar de dichtstbijzijnde "1" van de maatgever (`telInMaat`/`barPhase`, nooit `beat % 4`). Zonder twee zekere grids wordt hij geweigerd, met een melding | MIX r1, APC device.uitlijn On/Off |
| P4 | `track.N.bend.amount` | value | 1–16% (standaard 4%) | UITLIJN knop 3 |
| P5 | mappingmodus `stappen` | — | encoder → trigger per klik (§2.5). Gebruikt voor jog, secties, rack kiezen, mengvorm en de library (ONTBREEKT B10). Daarmee gaat het wiel van de Maschine via de mapping in plaats van via code | overal |
| P6 | nudge-klikken samenvoegen | engine (alleen als het gemeten nodig is) | meerdere `nudge`/`jog` binnen hetzelfde render-quantum worden één seek (één segment). **Eerst meten**: 50 klikken per s, met en zonder keylock (dan elke klik een gepland segment op het rooster van ~98 ms), en tellen hoeveel segmenten en hoeveel overvloeiers er komen. Alleen bouwen als dat hoorbaar of duur is | — |
| P7 | duoklik | engine-klein (`gridControleDeck`) | in de koptelefoon een hoge tik voor de tel van de maatgever en een lage voor de focus: je hoort de flam en duwt tot het één tik is | UITLIJN knop 7 (schakelaar) |
| P8 | sync-lampje eerlijker | read | "gelijk" bij < 0,005 bpm (nu 0,05: tot ~24 ms drift per minuut terwijl hij "gelijk" zegt) | — |

Niet gebouwd zonder Clay: **sync-lock** (VRAGEN W5; raakt de auto-DJ, OVERNEEM en rubato in live
opnames), en "buig precies d seconden" als segment (raakt het audiopad: zeven velden, de gouden
hash, 0 GC). Dat laatste pas als P1 + P6 hoorbaar tekortschieten.

`phase.offset` mag nooit op een fader of in `absolute`: de read schuift mee met de drift, dus
soft-takeover zou niets betekenen. `normaliseer` weigert dat; alleen `endless` en `relative-*`
mogen.

---

## 6. De uitlijnweergave (punt 4)

**De as staat in TELLEN van de maatgever, zoals je die hoort.** Eén tel is overal even breed,
welke bpm een track ook heeft. Per spelende of klaarstaande track is er één baan.

**Rekenregel per baan** (regel 3, geen eigen teller): op tel x van de maatgever toont baan i de
tracktijd die je hoort op het moment dat de maatgever tel x laat horen:
`t = nu + (x − x_nu) × hoorbare tel van M`, en dan `pos_i = positieIn(seg_i, vorig_i, t) − V × rate_i`.
`seg_i` is het segment van de bron (`bron.seg`, `_segId`) en V komt uit `uitgangsVertraging()`
(hoorbaar.js). Loops, een rem en wachten op de maat staan al in het segment.

**Per baan:**
- de golfvorm (de lage band als B14 er is, anders min/max);
- de gridlijnen van DIE track op haar eigen tellen, met de "1" voller;
- de gevonden tellen (groen, `deck.tellen`) en de klappen (`deck.onsets`);
- achtergrond: de lijnen van de maatgever over de hele hoogte;
- links drie getallen:
  - **grid Δ** in ms (`faseVerschil`);
  - **muziek Δ** in ms: nieuw, puur, `faseTussen()` in `tellen.js`, de mediaan van de laatste ~8
    gehoorde tellen van i tegen de dichtstbijzijnde van M op de audioklok. Met alleen klappen
    (±15 ms) staat er "grof" bij;
  - **drift** in ms per 16 tellen;
- plus "maat +1" als de "1" naast ligt, en een ⚠ met welk grid naast zijn muziek ligt
  (`afwijkingBij` per track: dat grid moet je vastzetten, niet de track duwen).

**Twee vormen, allebei goedkoop:**
1. **pagina** (standaard). Het venster staat stil op 1 of 2 maten van M en slaat om bij de
   volgende; alleen de speelkopstreep loopt, als CSS-transform op de compositor. Opnieuw tekenen
   gebeurt alleen bij omslaan, een nieuw `_segId`, een nieuwe `gridVersie`, of een andere zoom of
   breedte. Per track staat er een voorgetekende strook in tracktijd (in tegels), en per keer
   tekenen gaat het met `drawImage` met schaal = tel × rate. Gemeten in deze container (software,
   alleen de verhouding telt): rekenwerk 0,25 ms per beeld; `fillRect` per pixel 10,3 ms;
   strook + `drawImage` 1,7 ms. Geschat ~1 Mpx/s tegen ~110 voor scrollend op 60 fps (5 okt: al
   29 Mpx/s halveerde Demucs);
2. **fasescoop** (vouw). Per track één rij van één maat. Elke gehoorde tel komt erin op zijn fase
   t.o.v. M en dooft langzaam: gelijk = een smalle stapel, drift = een schuin spoor, flam = twee
   stapels. Er wordt alleen per tel getekend. Op de **Maschine** (1 bit, 256×64) staat links de
   focus tegen M en rechts de getallen.

**Op de drie oppervlakken tegelijk** (controller eerst):
- **APC**: device.uitlijn = 8 ringen, die elk de fase van hun track tonen (midden = gelijk), en
  draaien = duwen;
- **Maschine**: fasescoop en getallen van de focus, en het wiel = jog;
- **scherm**: alle tracks. Hoofd: de strook in MIX, groot in UITLIJN. Op mac-2 en de iPad op het
  eigen scherm (de iPad tekent op zijn eigen GPU en krijgt alleen segmenten).

De sleutel van tekenen is (`deck`, `_segId`, `gridVersie`, pagina, breedte). Geen
`JSON.stringify(grid)` per beeld, zoals `_gridTekst` nu doet.

---

## 7. Effecten en combinatieknoppen (punt 5)

Er zijn 17 effecten. Een rack is een keten met 8 plekken (macro's). Per track is er 1 insert, er
zijn 2 send-bussen en 1 master-insert. "Alle combinatieknoppen die ik kan bedenken" valt uiteen in
zeven betekenissen. Dit ontwerp bouwt de vijf die in de control-laag en in data passen. De
engine-dingen worden alleen benoemd.

| # | combinatie | hoe | waar | spoor |
|---|---|---|---|---|
| C1 | **worpen tegelijk** (pads vasthouden) | fx-matrix op de APC: 8 tracks × 4 plekken + echo-worp, en de master-worpen op de scènes. Twee vingers = twee plekken open, op twee tracks = twee racks. 2^n combinaties zonder akkoordlogica | APC grid.fx; Maschine FX r1–r2 | S8 (stuk), S3 (latch) |
| C2 | **momentary / vast / kort-lang voor elke value-action** | `mode: druk/latch`, `naar`, `lang: 400` (§2.5) | elke regel; de dub-worp `send.a` druk → 1, `fx.mix` druk, `filter` druk naar 0,85 | S3 |
| C3 | **knop A vast + knop B = iets anders**, ook over apparaten | `met` + `ingedrukt.js`. Voorbeelden: Maschine SELECT vast + APC trackknop N = `track.N.send.a` (de filterknop wordt een echoknop). VOLUME vast + draaiknop k = fader k. SOLO vast + stem-pad = solo. TEMPO + wiel = tempo fijn | alle apparaten | S3 |
| C4 | **één knop beweegt veel** (over slots heen: tracks, bussen, master, beeld) | superknop (`src/control/superknop.js`, puur). Links `{action, in, from, to, curve, steps}` met de `resolveLink` van rack.js; als action `super.K` (value, read = eigen stand), dus te koppelen, te leren en op een paneel te zetten. Glijden alleen via de bestaande `.glide`-actions of `zetDoel`, geen eigen timer. **Het log**: de kinderen worden gelogd en `super.*` staat in OVERSLAAN, dus terugspelen klopt ook als de definitie later verandert | Maschine FX r4, iPad, elke knop | S3 |
| C5 | **morph tussen twee standen** (Octatrack-idee, `rack.js:228`) | een superknop met `from` = stand A en `to` = stand B. "Leg vast A" en "leg vast B" (twee knoppen op het superpaneel) vullen de links met de reads van nu van een gekozen lijst actions | superpaneel | S3 |
| C6 | ander rack op de echo- en galmbus | `send.a/b.rack.next/prev` (de engine heeft `zetRack` al; alleen actions en opslag). De bus-racks staan in de werkruimte (`bussen: { a: "Dub-worp" }`), op naam | FX-paneel | S3 (klein, optioneel) |
| C7 | engine: conflict-modi in het rack (som/max), loop roll + slip, beat repeat, reverse, insert per stem (~5,5 ms CPU per slot, ook stil), extra bussen, vrije routing | **niet in deze sporen.** Elk zou het audiopad raken (0 GC, gouden hash, nooit herbedraden met signaal erop). Alleen op Clay's concrete vraag (W6, W7) | — | — |

Vandaag al zonder één regel code (proef E0, via learn): `track.{focus}.fx.knob.K.hold` op ⇧ +
A\|B 1–8, en `video.fx.*.hold` op de 28 vrije pads in grid.video. Dat beantwoordt "worpen op pads
of op knoppen?" vóór er iets gebouwd wordt.

---

## 8. Hoe Clay het zelf instelt (pijler 4, zonder JSON)

- **Learn op elk apparaat** (S1): het MIDI-paneel kiest het apparaat (APC, Maschine, Xboard,
  toetsen). De regel komt in het mapje dat open staat, en in het werkruimte-eigen verschil (de
  schakelaar "overal" = algemeen). Op de Maschine is het "CONTROL vast + aanraken" ook voor learn:
  eerst de action kiezen, dan de knop aanraken.
- **Leg vast in dit deel** (S5): richt je handen in (mapjes open, padmodus, pagina, rijen open) en
  druk twee keer "leg vast in FX". De open mapjes van elk apparaat en de open rijen gaan in dat
  deel. Dat is controller eerst: je stelt in met de handen, niet in een formulier.
- **Paneel** (S7): in de koppelmodus op het scherm "zet op paneel <naam>" bij een action. Een item
  verwijder je met een tweede klik.
- **Stukken aan of uit** in de werkruimte-tab (S5): een lijst met vinkjes.
- **Claude** schrijft het bestand (versie/409), en mixer en vensters zien het binnen 3 s.
- **De kaarten** (`apc.html`, `maschine.html`, de handenkaart) tonen per werkruimte en per deel
  wat elke knop doet: met de bestaande `kies()`, en het deel als extra schakelaar (S8). In het
  donker: CONTROL vast op de Maschine en het scherm van het deel.

---

## 9. Bouwsporen

Elk spoor heeft een eigen tak in een worktree buiten iCloud (`~/Projects/varve-stems/<spoor>`),
wordt samengevoegd in `studio/integratie` en gaat met een PR naar main. Een spoor wijzigt alleen
zijn eigen bestanden. Waar twee sporen in hetzelfde gedeelde bestand iets toevoegen (`app.js`,
`apc-beschrijf.js`, `server/index.js` routes), voegt elk een **eigen blok** toe, en het
samenvoegen gebeurt in S8.

**Externe afhankelijkheid: de andere workflow.** `afmaken/controller-invoer` verandert
`mapping.js` (caches in `kies`, sjablonen in `resolveTarget`), `lagen.js` (bevroren `actief()`),
`renderloop.js`, `spiegel.js`, `mapje-balk.js` en `bovenbalk.js`. `afmaken/controller-uitvoer`
verandert `feedback.js`, `hub.js`, `maschine.js`, `midi.js` en `midi-opzet.js`. **S1, S2, S3 en
S7 beginnen pas als die twee in `studio/afmaken` zitten.** Let op bij S3: de cache van `kies()`
moet de vastgehouden `met`-modifiers meenemen in zijn sleutel, anders geeft hij een oude regel
terug. S4, S5 (model en server), S6 en de stukken van S8 kunnen meteen. Bij het beatgrid: kijk
vóór S4 `tellen.js` aanraakt of de andere workflow daar werkt.

| spoor | wat | hangt af van |
|---|---|---|
| S1 | mapping per apparaat: opslag, verschil, learn, toetsenbord als data | andere workflow (midi-opzet) |
| S2 | mapjes als data; Maschine-pads als regels | andere workflow (lagen, maschine); S1 voor de opslag |
| S3 | combinaties in de mapping: druk/latch/lang/stappen/met, ingedrukt-register, superknoppen, morph, bus-racks | andere workflow (mapping.js) |
| S4 | precisie-actions (phase.offset, jog, bar.align, bend.amount, duoklik, sync-lampje), faseTussen | — |
| S5 | de werkruimte-kern: model, server, wisselen, werk-balk, leg vast, stand-deel | model/server: —; runtime: S1, S2 |
| S6 | de uitlijnweergave: rekenwerk, paneel, los venster, Maschine-fasescoop | S4 voor muziek Δ (te stubben) |
| S7 | schermen en iPad: vrij paneel, bind(root), werk.html, WebSocket, koppelen | andere workflow (renderloop, vensters); S5 |
| S8 | de rolverdeling als data: stukken + voorbeelden, kaarten per deel, proeflijst, samenvoegen | S2, S3, S4, S5 |

Bestanden, acceptatie en risico per spoor: §13.
Gemeenschappelijk voor elk spoor: `node test/alles.mjs` groen, en met de werkruimte `standaard`
(geen werkruimte) blijft elke bestaande test en headless tool zonder verandering in de
verwachtingen groen. **Dat is de toets dat er niets stilletjes verandert.**

---

## 10. De regels, het audiopad en VISIE §5

| | |
|---|---|
| Regel 1 | De werkruimte woont in `src/werk/` (model, runtime), `src/control/` (mapping, ingedrukt, superknop, acties) en `src/ui/`. De engine importeert er niets van, en `regels.test.mjs` krijgt `src/werk/` erbij als "mag de engine niet importeren". De nieuwe actions roepen bestaande engine-methodes aan (`nudge`, `seek`, `beatjump`, `zetRack`). Alleen P6 (samenvoegen) en P7 (duoklik) raken de engine, en die zijn optioneel en eerst gemeten. |
| Regel 2 | `phase.offset`, superknoppen, `bend.amount` en `druk`/`naar` werken op 0..1. Jog en `stappen` zijn triggers. De engine schaalt: tel, ms en procent zitten nooit in een mapping. Een delta-soort op de bus komt er niet: dat zou een nieuw buscontract zijn. |
| Regel 3 | Jog en duwen = seek met `doorlopend` op de audioklok. De uitlijnweergave en de iPad rekenen uit segmenten {T,P,R} + `hoorbaar()`. Superknoppen glijden via `.glide`, met geen eigen timer. De timer van de LED-laag (33 ms) zegt alleen WANNEER er gekeken wordt. |
| Audiopad | Geen enkel spoor verandert `renderBlok`, de worklet of de segmentvorm. De gouden hash en 0 GC (`renderblok.test.mjs`) blijven staan. P6, als het er ooit komt, verandert alleen hoeveel segmenten er gemaakt worden, niet hun vorm. |
| Speellatentie | De pads in `spelen` blijven via `doorgeef: noten` buiten de bus (2,6–3,1 ms). S2 meet dat met de bench van de andere workflow (`tools/bench/invoer.mjs`): hooguit +0,1 ms mediaan. |
| Eén tabblad | Alleen het tabblad met de Web Lock (of de hub-verbinding) voert iPad-invoer uit. `werk.html` opent geen MIDI en geen audio. |
| Hub | Bank blijft de hubtoets. Een werkruimte pakt geen LPD8-rol die een beeld-app gebruikt. Het manifest verandert alleen per werkruimte (bij het verbinden), nooit per deel. |
| §5.1 pijlers | MIX/UITLIJN/FX/STEMS/SECTIES = dj'en (1). SPELEN = produceren (2). Superknoppen, morph en stukken = programmeren (3). De werkruimte zelf = instellen (4). BEELD = de drager beeld. De crossover blijft heel: één track mag in elk deel nummer of instrument zijn, en een deel zet nooit iets uit. |
| §5.2 draagbaar | Niets erbij in de tas. `apc-alleen` = K1 volwaardig, en de iPad is optioneel. |
| §5.3 zonder code | Na S1–S5 is alle invoer data: elk apparaat, het toetsenbord, de mapjes, de padmodi, de delen, de panelen en de combinaties. Code blijft nodig voor nieuwe action-soorten, nieuwe paneelsoorten en nieuwe Maschine-schermindelingen (data kiest uit een vaste set). |
| §5.4 geproefd | De standaard verandert niet. Alles nieuw zit in de voorbeelden en stukken, en de proefpunten komen in de speellijst (S8): eerst E0 (holds via learn), de hub-middag, dan avond 2b met `twee-handen`. Pas na de proef gaat er iets naar `mappings/apc40mk2.json` (+ `eerder.mjs`). |

---

## 11. Vragen voor Clay (blok W)

- **W1** Mag de iPad de mixer **bedienen** (eerste schrijfweg van buiten de Mac, via het tailnet,
  met een koppelcode), of eerst alleen kijken?
- **W2** De verdeling "APC breed, Maschine diep": klopt dat met hoe je speelt? En liggen de acht
  delen goed (MIX · UITLIJN · FX · STEMS · SECTIES · SPELEN · BEELD · LIBRARY) op F1–F8?
- **W3** Moet het deel ook vanzelf de APC volgen in `twee-handen` (▲ ▼ naar stems = STEMS op de
  Maschine), of kies je het liever alleen met F1–F8?
- **W4** Combinaties: eerst worpen tegelijk (fx-matrix) of eerst superknoppen? En welke knoppen
  wil je als modifier (SELECT, SOLO, VOLUME, TEMPO, SWING)?
- **W5** Sync die blijft (sync-lock) of eenmalig zoals nu?
- **W6** Loop roll / slip / beat repeat op NOTE REPEAT: gewenst? (engine-werk)
- **W7** Een concreet voorbeeld van routing dat je nu mist (bus naar bus, groepen, effect per
  stem)? Zonder voorbeeld bouwen we het niet.
- **W8** Stop All Clips heeft nu drie betekenissen (rem, patronen stoppen, beeldpaniek): houden
  of opsplitsen?

## 12. Aannames (kunnen verkeerd zijn)

- De pan-ring van de APC is leesbaar als fasemeter met √-schaal (15 LED's; eerste stap ~5 ms).
  Niet geproefd.
- Een seek van 0,06–1 ms met 4 ms overvloei is onhoorbaar; snel draaien met keylock stapelt geen
  hoorbare geplande segmenten. Te meten in P6.
- `tailscale serve` geeft WebSocket door; touch + wifi kost tientallen ms. Niet gemeten.
- De Maschine-knoppen F1–F8 zitten boven de schermen (MK2), zodat het label erboven leesbaar is.
  Na te lopen op de hub-middag.
- De CC's van de Xboard (Ardour-map) blijven een aanname tot de hub-middag.
- Een opener-venster (mac-2) met de uitlijnweergave in pagina-vorm kost de mixer-hoofdthread
  minder dan 1 ms per beeld. Gemeten zonder GPU; opnieuw meten in echte Chrome.

---

## 13. De sporen in detail (bestanden · afhankelijk · acceptatie · risico)

### S1 Mapping per apparaat (opslag, verschil, learn, toetsenbord)
- **Wat:** elk apparaat (apc40mk2, maschine-mk2, xboard49, toetsen) krijgt hetzelfde: standaard +
  algemeen verschil + werkruimte-eigen verschil, opslag op de server per apparaat, en learn.
  `KEYMAP`/`SHIFT_TOETS` worden `mappings/toetsen.json` (signature `key:KeyQ`, `shift` zoals bij
  MIDI, `{focus}`/`{tweede}`; `{L}`/`{R}` blijven als alias). keyboard.js voert een Mapping uit in
  plaats van een tabel. Space, `[` `]`, B en Cmd+Z blijven code (dat zijn schermgebaren, geen
  mapping).
- **Bestanden:** `src/ui/mapping-opslag.js` (`laadEigen(mapping, { apparaat })`), `server/index.js`
  (blok `/api/mapping/<apparaat>`; `/api/mapping` = apc40mk2, ongewijzigd), `src/control/keyboard.js`,
  `mappings/toetsen.json` (nieuw), `src/control/midi-learn.js` (Mapping als parameter, al zo
  opgezet), `src/ui/speelapparaten.js` en `src/ui/instrument-paneel.js` (laadEigen in plaats van
  fetch), `src/ui/mapping-panel.js` (apparaatkiezer), `src/control/maschine.js` (alleen: de Mapping
  van buiten aannemen in plaats van zelf maken: één regel); tests `test/mapping-opslag.test.mjs`
  (nieuw), `test/learn.test.mjs`, `test/keyboard.test.mjs` (nieuw, gouden).
- **Hangt af van:** `afmaken/controller-uitvoer` (midi-opzet, maschine.js) in `studio/afmaken`.
- **Acceptatie:**
  - Clay's verschil van nu (4 regels op cc:0:20–23 @device.rack) laadt via `/api/mapping`
    ongewijzigd, en wordt na een opslag via `/api/mapping/apc40mk2` hetzelfde document;
  - een oude volledige kopie gaat nog door `verschilVanKopie` + `eerder`;
  - voor elke toets in KEYMAP en SHIFT_TOETS geeft `toetsen.json` dezelfde action (gouden lijst, 0
    verschillen), en de bestaande toetsentests blijven groen zonder aanpassing;
  - learn op een nep-Maschine-poort (zoals in `maschine.test.mjs`) schrijft een regel in de
    Maschine-mapping, die na herladen terug is;
  - een Maschine-verschil op de server overleeft een herstart (testserver, `VARVE_TESTSERVER=1`).
- **Risico:** de migratie van de bestaande sleutel `mapping` (een verloren eigen mapping is de
  zwaarste fout); toetsen tijdens TYPEN (`isTypen`) moeten uit blijven; Cmd/Ctrl/Alt worden genegeerd.

### S2 Mapjes als data; Maschine-pads als regels
- **Wat:**
  - `GROEPEN`, `volgorde`, `OP_AANVRAAG` en `LAAGNAAM` naar het veld `mapjes` in
    `mappings/apc40mk2.json` (dezelfde inhoud);
  - `Lagen` per apparaat (`new Lagen({ groepen })`), en `layer.*`-actions die uit de data komen
    (opnieuw bij een werkruimtewissel);
  - de Maschine krijgt groepen `pads`, `pagina` en `wiel`;
  - de pads van stappen, secties en sampler worden regels met variabelen per pad
    (`{sectie}`, `{stap}`, `{sampler}`, door maschine.js gezet vóór `mapping.handle`);
  - `spelen` = `doorgeef: noten`;
  - de lampjes van de Maschine uit de regels (`led`, `led.lees`), zoals op de APC;
  - het wiel via `stappen` (S3; tot dan blijft het wiel in code).
- **Bestanden:** `src/control/lagen.js`, `src/control/maschine.js`, `mappings/apc40mk2.json` (alleen
  het veld `mapjes` erbij, geen regel; `eerder.mjs` bevestigen dat de vingerafdruk alleen over
  `rules` gaat, anders ook dat), `mappings/maschine-mk2.json` (pad-regels + `mapjes`),
  `src/ui/maschine-kaart-plan.js` (PADMODI uit de data), `src/control/actions.js` (alleen het blok
  dat de `layer.*`-actions maakt: een functie `bindLagen(lagenPerApparaat)`); tests
  `test/maschine.test.mjs`, `maschine-kaart`, `maschine-sampler`, `bladeren`, `sec-maschine`,
  `mapping`, `spiegel`, `feedback` (allemaal ongewijzigde verwachtingen) + `test/mapjes-data.test.mjs`
  (nieuw, gouden).
- **Hangt af van:** beide takken van de andere workflow (lagen.js, maschine.js, feedback.js); S1
  voor de opslag van het Maschine-verschil (kan ook eerst met fetch).
- **Acceptatie:**
  - de GROEPEN uit de data zijn `deepEqual` aan de constante van 339310b;
  - elke bestaande Maschine-test is groen zonder dat er een verwachting verandert;
  - `tools/headless/speelapparaten.mjs`, `bladeren.mjs`, `maschine-sampler.mjs` en `sec-maschine.mjs`
    zijn groen;
  - de latentie van de pads in `spelen` is hooguit +0,1 ms mediaan (`tools/bench/invoer.mjs` van
    de andere workflow, voor en na);
  - de LED-tik van de Maschine wordt niet duurder (zelfde bench);
  - nieuw, alleen data: in SCENE geeft ⇧ + pad `track.{focus}.section.K.loop`;
  - zonder `?hub=` laadt de mixer nog steeds geen Maschine-code (hub.test).
- **Risico:** groot en midden in code die net door de andere workflow verandert. De Maschine is
  nooit op de hardware geproefd, dus "gedrag gelijk" toetst alleen tegen de tests, niet tegen het
  apparaat. `voegVormMapjeToe` en de APC-kaart lezen GROEPEN direct; die moeten mee.

### S3 Combinaties in de mapping
- **Wat:**
  - modi `druk`, `latch`, `lang`, `stappen`;
  - de velden `met`, `naar`, `ring`, `als` en `modifier: "stil"`;
  - `src/control/ingedrukt.js` (puur, gedeeld door alle Mappings);
  - superknoppen (`src/control/superknop.js`, puur, `resolveLink` uit rack.js; actions
    `super.1–16`), morph (leg vast A/B);
  - `send.a/b.rack.next/prev`;
  - OVERSLAAN krijgt `super\.` en `werk\.`.
- **Bestanden:** `src/control/mapping.js` (handle, MODES, leesRegels, regelNaarJSON, sleutelVan; de
  kies-cache van de andere workflow krijgt de versie van `ingedrukt` in zijn sleutel),
  `src/control/ingedrukt.js` (nieuw), `src/control/superknop.js` (nieuw), `src/control/acties-combi.js`
  (nieuw: `bindSuper`, bus-racks), `src/control/terugspelen.js` (alleen de OVERSLAAN-regex),
  `src/ui/apc-beschrijf.js` (eigen blok); tests `test/mapping.test.mjs` (nieuwe gevallen),
  `test/combinaties.test.mjs` (nieuw), `test/superknop.test.mjs` (nieuw, gouden tegen
  `resolveLink`), `test/handelingenlog.test.mjs` (super terugspelen).
- **Hangt af van:** `afmaken/controller-invoer` (mapping.js) in `studio/afmaken`.
- **Acceptatie:**
  - `druk` op `track.1.send.a` met `naar` 1: het log bevat twee regels (1 en de oude stand), en
    terugspelen geeft dezelfde stand;
  - `latch`: druk → `naar`, druk → oud;
  - `lang`: < 400 ms = latch, ≥ 400 ms = momentary (nep-klok);
  - `met` over twee nep-apparaten: knop B doet X alleen zolang A vastzit; laat A eerst los, dan gaat
    B toch naar X (`vast`);
  - `losgekoppeld()` van apparaat A maakt zijn `met`-modifiers leeg;
  - `modifier: "stil"` wordt geweigerd op play, cue, hotcue en `*.hold`;
  - `stappen`: +3 klikken = 3 × `.fwd`, en hooguit 8 per bericht;
  - superknop: kinderen in het log, `super.*` overgeslagen; terugspelen = bit voor bit dezelfde
    reads als live;
  - zonder deze velden is elke bestaande mappingtest groen, en de kies-cache geeft na het
    loslaten van een modifier meteen de gewone regel (geen oude cache).
- **Risico:** `kies()` wordt het hete pad (per bericht, per LED-tik): `met` mag de cache van de
  andere workflow niet ongeldig maken bij elke tik (versie van ingedrukt alleen bij een
  modifier-verandering). Twee bronnen op één knop (superknop + APC-ring): faders vallen uit
  takeover, en dat is de bedoeling.

### S4 Precisie-actions
- **Wat:**
  - `track.N.phase.offset` (value, √-schaal);
  - `track.N.jog.back/fwd(.fine)` (ook in pauze);
  - `track.N.bar.align`;
  - `track.N.bend.amount`;
  - het sync-lampje op 0,005 bpm;
  - `faseTussen()` (muziek Δ, puur);
  - optioneel P6 (samenvoegen, alleen na een meting) en P7 (duoklik).
- **Bestanden:** `src/control/acties-precisie.js` (nieuw, `bindPrecisie(engine)` met `define`),
  `src/engine/tellen.js` (alleen `faseTussen` erbij), `src/engine/deck.js` (alleen `bendSterkte` en,
  als P6 nodig blijkt, `nudge`), `src/ui/apc-beschrijf.js` (eigen blok),
  `tools/werkruimtes/stukken/uitlijn.json` (nieuw), `tools/headless/precisie.mjs` (nieuw); tests
  `test/precisie.test.mjs` (nieuw, engine-mock).
- **Hangt af van:** niets; kijk of de andere workflow `tellen.js` of `beatgrid.js` aanraakt.
- **Acceptatie:**
  - in engine.test-stijl, twee gesyncte decks: `phase.offset` leest 0,5 ± 0,001;
  - na `invoke(read + δ)` is de fase verschoven met f(δ)·tel, binnen 0,1 ms;
  - 10 ms duwen vanuit het midden kost 12–14 endless-tikken;
  - read null zonder maatgever en voor de maatgever zelf;
  - jog in pauze verplaatst precies 1/16 tel (op 124 bpm 30,24 ms ± 0,01) en laat de track stil;
  - jog tijdens het spelen is fasebehoudend (`doorlopend`) en blijft in de loop;
  - `bar.align` brengt `telInMaat` gelijk aan die van de maatgever over een stukgrens (tempokaart
    met maat-anker);
  - `faseTussen` geeft op synthetische tellen met 12 ms flam 12 ± 1 ms, ook als de grids gelijk
    staan;
  - headless in Chrome: 50 jog-klikken per seconde, met en zonder keylock, tellen hoeveel segmenten
    er komen (het besluit over P6);
  - `renderblok.test.mjs` heeft dezelfde gouden hash.
- **Risico:** de √-schaal is een aanname (proef: is de ring leesbaar?). Met keylock is elke klik een
  gepland segment (~98 ms): snel draaien kan achterlopen. De auto-DJ (`OVERNEEM`) moet
  `phase.offset`, `jog` en `bar.align` kennen als "Clay raakt de mix aan".

### S5 De werkruimte-kern
- **Wat:**
  - `src/werk/model.js` (puur): `normaliseerWerkruimte`, `samenstellen(standaard, stukken,
    algemeen, eigen)` → per apparaat een mapping-document + mapjes; condities; de bereikbaarheidstoets;
  - `src/werk/werkruimte.js` (runtime): het actieve deel, toepassen op de Lagen van elk apparaat en
    op het scherm, `volgt`, `onthoud`, events;
  - actions `werk.deel.<naam>`, `werk.deel.next/prev` en `werk.vastleggen`;
  - de werk-balk;
  - een werkruimte-tab in het MIDI-paneel (kiezen, stukken aan of uit);
  - de server: `GET/PUT /api/werkruimtes[/<naam>]` met versie/409 en `.versies`;
  - het deel `werkruimte` in de standen.
- **Bestanden:** `src/werk/model.js`, `src/werk/werkruimte.js`, `src/control/acties-werk.js`,
  `src/ui/werk-balk.js` (nieuw), `server/werkruimtes.js` (nieuw) + een eigen blok routes in
  `server/index.js`, `tools/werkruimtes/voorbeelden/{apc-alleen,twee-handen,laptop}.json`,
  `src/standen/stand-model.js` (deel `werkruimte`), `src/ui/app.js` (eigen blok opzetWerk); tests
  `test/werkruimte-model.test.mjs`, `test/werkruimte.test.mjs`, `test/werkruimte-server.test.mjs`,
  `test/regels.test.mjs` (`src/werk/` niet importeerbaar door de engine).
- **Hangt af van:** model en server nergens van; de runtime van S1 (laden per apparaat) en S2
  (Lagen per apparaat). Tot dan werkt de runtime met de APC-Lagen van nu.
- **Acceptatie:**
  - `samenstellen` met een lege werkruimte = de mapping van vandaag (deepEqual, 702 regels);
  - `apc-alleen` = standaard + precies de regels van de stukken uitlijn en fx-matrix;
  - een werkruimte die `track.1.fader` of `layer.grid.stems` weghaalt: 400 met reden;
  - een deelwissel geeft 0 invokes buiten `layer.*`/`werk.*` (bus-spion);
  - na de wissel: de APC-LED-diff en de Maschine-lampjes binnen één tik (33 ms, nep-klok), JS
    ≤ 1 ms;
  - `volgt` geeft geen lus (de APC wisselt grid → het deel → de APC wordt niet opnieuw gezet; 1
    `change`);
  - `onthoud`: FX → STEP aan → MIX → FX geeft STEP terug;
  - condities: SPELEN zonder instrument = sampler, met instrument = spelen;
  - de server: PUT zonder versie of met een oude versie = 409 met de huidige inhoud; `.versies`
    groeit; een kapotte JSON wordt geweigerd en nooit half geschreven;
  - een stand met `werkruimte: { naam }` wordt gevalideerd zoals een sjabloonnaam;
  - terugspelen slaat `werk.*` over.
- **Risico:** "complete vrijheid" kan het onlogischer maken (meer om te onthouden). Daarom zijn de
  werk-balk en het Maschine-scherm verplicht: altijd zichtbaar welk deel actief is en wie het
  koos. Een lus tussen `volgt` en "zet". Gluren of een vastgehouden knop tijdens een wissel:
  loslaten gaat naar de action van het indrukken (bestaat al); het gluren wordt afgebroken.

### S6 De uitlijnweergave
- **Wat:**
  - `src/ui/uitlijn-plan.js` (puur): het venster in tellen van de maatgever, per baan de tracktijd
    op x, gridlijnen, tellen en klappen, de getallen, de paginagrenzen en de sleutel;
  - `src/ui/uitlijn.js` (teken: stroken in tegels + `drawImage`, speelkop als CSS-transform,
    pagina- en vouwvorm);
  - de strook in het hoofdvenster;
  - `uitlijn.html` als los venster (opener);
  - de Maschine-fasescoop in `maschine-scherm.js` (een tekenfunctie, data kiest hem);
  - de reads voor de APC-ringen komen uit S4.
- **Bestanden:** `src/ui/uitlijn-plan.js`, `src/ui/uitlijn.js`, `uitlijn.html` (nieuw; MAG-regel in
  een eigen blok van `server/index.js`), `src/control/maschine-scherm.js` (alleen een nieuwe export
  `tekenFasescoop`), `src/ui/app.js` (eigen blok: tekenstap), `styles.css` (eigen blok `.uitlijn`);
  tests `test/uitlijn.test.mjs` (nieuw), `tools/headless/uitlijn.mjs` (nieuw).
- **Hangt af van:** S4 voor muziek Δ en `phase.offset` (te stubben: dan staat het getal op "–").
- **Acceptatie:**
  - puur: twee tracks gesynct op 124 en 128,3 bpm → gridlijnen op x gelijk binnen 0,5 px op
    1200 px;
  - een fase van +10 ms → grid Δ "+10 ms" en een baan die 10 ms × px/s verschoven is;
  - een loop die rondgaat: de baan toont het begin van de loop na het eind (segment met `loop`);
  - een track die wacht op de maat: "wacht" en stil;
  - de vouw met 12 ms flam: twee stapels;
  - de sleutel verandert alleen bij een nieuw `_segId`, `gridVersie`, pagina of breedte (60 beelden
    zonder verandering = 0 keer tekenen);
  - headless Chrome met 8 tracks: pagina-vorm ≤ 2 Mpx/s getekend (de teller van `zelfde()` of de
    canvas-uploads), rekenwerk ≤ 0,5 ms per beeld, hoofdthread niet boven de nulmeting + 1 ms per
    beeld;
  - het Maschine-scherm: 2048 bytes en een pixeltest zoals in `maschine.test`.
- **Risico:** GPU-last op de M1 is niet gemeten (er is geen GPU in de container). De muziek Δ met
  alleen klappen is ±15 ms en moet als "grof" in beeld staan. Een venster op mac-2 deelt de
  hoofdthread.

### S7 Schermen en de iPad
- **Wat:**
  - 7a: `bind(root)`/`ontbind(root)` in `vensters.js` en de renderloop; het vrije paneel
    (`src/ui/vrij-paneel.js`); `werk.html` + `src/werk/paneel-pagina.js` via
    `window.opener.varveWerk`; "zet op paneel" in de koppelmodus.
  - 7b: `server/ws.js` (een minimale WebSocket zonder dependency, ~150 regels, of `ws` voorleggen
    als eerste server-dependency); het relais naar het tabblad met de Web Lock; stand, verschil,
    seg en grid naar de iPad; het klokverschil; alleen lezen.
  - 7c (na W1): invoke en los van de iPad met witte lijst, koppelcode, token-cookie, hartslag, en
    loslaten bij wegvallen.
- **Bestanden:** `src/ui/vensters.js`, `src/ui/renderloop.js` (alleen het register), `src/ui/vrij-paneel.js`,
  `werk.html`, `src/werk/paneel-pagina.js`, `src/werk/relais.js` (mixerkant), `server/ws.js`,
  `server/index.js` (eigen blok: upgrade, koppelen, MAG), `src/ui/learn-mode.js` ("zet op paneel");
  tests `test/vrij-paneel.test.mjs`, `test/ws.test.mjs`, `test/relais.test.mjs`,
  `test/regels-werk.test.mjs` (de importboom van `werk.html`: geen engine, geen AudioContext, geen
  MIDI, geen Web Lock), `tools/headless/werk-scherm.mjs` (opener) en `tools/headless/werk-ipad.mjs`
  (een tweede Chrome-context als iPad via de WebSocket).
- **Hangt af van:** `afmaken/controller-invoer` (renderloop); S5 (schermen en delen in de
  werkruimte). Voor 7c: Clay's keuze W1 en de proef van companion-stap 2.
- **Acceptatie:**
  - 7a: een paneel met 4 items dat na het opstarten verschijnt, volgt `read()` (een APC-draai via
    een nep-poort is zichtbaar in het paneel binnen 1 beeld) en stuurt via de bus (in het log);
    ontbinden laat geen Knob in de renderlijst achter;
  - 7b: de relais-latentie op loopback is p99 < 2 ms (mediaan ~0,13 zoals gemeten); een tweede
    mixer-tabblad zonder lock krijgt 0 berichten; de iPad-baan staat in Chrome gelijk met de
    mixer, binnen 2 ms tracktijd na 60 s (alleen segmenten + klokverschil, gemeten); ≤ 20
    verschilberichten per seconde;
  - 7c: een action buiten `mag`, in `nooit` of in de vaste lijst = geweigerd met een reden, en de
    mixer voert niets uit; zonder geldig token of met een verkeerde Origin = 403; de verbinding
    wegtrekken tijdens een ingedrukte `n` = loslaten binnen 1,5 s (nep-klok); laden over een
    spelende track vraagt ook hier een tweede druk; het log zegt `bron: 'ipad'`.
- **Risico:** de eerste schrijfweg van buiten de Mac (veiligheid). Touch- en wifi-latentie zijn
  niet gemeten. Een haperende renderloop van de mixer vertraagt elk iPad-bericht. Twee origins
  (localhost en ts.net): de Web Lock beschermt daartussen niet, en alleen het relais beslist.
  Headless tools die op vaste id's rekenen (rijen.mjs, kijk.mjs) mogen niet breken; het werkvak
  is daarom een nieuw element, en `#rijen` verandert niet.

### S8 De rolverdeling als data; kaarten; proef; samenvoegen
- **Wat:**
  - de stukken `fx-matrix`, `maschine-delen` (padmodi transport, worpen, stems, beeld en laden, en
    de pagina's uitlijn, stems en beeld), `maschine-knoppen` (TEMPO, SWING, VOLUME, SOLO, MUTE en
    DUPLICATE als `met`), `beeld-op-maschine`, `stems-op-maschine` en `mix-extra` (⇧ + A\|B = thru);
  - de voorbeelden `apc-alleen` en `twee-handen` af;
  - `apc.html` en `maschine.html` met een kiezer voor werkruimte en deel (via `kies()`);
  - de handenkaart per werkruimte (`tools/handen/handenkaart.mjs --werkruimte`, uit
    `origin/visie/handen`);
  - de proefpunten in de speellijst (blok "Werkruimte": E0 holds via learn, deelwissel op de
    Maschine, ringen als fasemeter, jog, fx-matrix met twee handen, iPad alleen lezen);
  - `docs/WERKRUIMTE.md` en een CLAUDE.md-stukje;
  - alle sporen samenvoegen in `studio/integratie`.
- **Bestanden:** `tools/werkruimtes/stukken/*.json`, `tools/werkruimtes/voorbeelden/*.json`,
  `src/ui/apc-kaart.js`, `src/ui/maschine-kaart-plan.js`, `src/ui/apc-beschrijf.js` (samenvoegen),
  `src/controle/speellijst.js`, `docs/WERKRUIMTE.md`, `docs/VRAGEN.md` (blok W), `CLAUDE.md`; tests
  `test/werkruimte-voorbeelden.test.mjs` (elke voorbeeldwerkruimte normaliseert zonder fout; elke
  action in een stuk bestaat (`metaOf`) en heeft een beschrijving; geen twee regels op dezelfde
  sleutel; elke `layer.*` uit de standaard blijft bereikbaar; het kernoverzicht §3.1 is per deel
  gelijk), `test/maschine-kaart.test.mjs` (per deel × padmodus geen lege uitleg).
- **Hangt af van:** S2, S3, S4 en S5 (S6 en S7 voor de schermdelen).
- **Acceptatie:**
  - de toets uit §9: met `standaard` is elke bestaande test en headless tool groen;
  - `twee-handen` normaliseert zonder waarschuwing;
  - headless `tools/headless/werkruimte.mjs` met de echte hub + nep-APC + nep-Maschine
    (zoals `speelapparaten.mjs`, `opname: false`):
    - F1–F8 wisselen het deel;
    - de APC-grid-LED's krijgen de kleur van het deel binnen 33 ms;
    - het Maschine-scherm toont de 8 labels;
    - in FX geven twee pads tegelijk twee worpen (reads 1 en 1, na loslaten de oude stand);
    - VOLUME + draaiknop 3 beweegt `track.3.fader`;
    - in UITLIJN volgt de ring van device knob 2 `track.2.phase.offset`;
  - `apc.html` toont per deel wat elke knop doet, zonder lege plek waar een regel staat;
  - het speellijstblok staat in de Controlekamer.
- **Risico:**
  - te veel tegelijk op een indeling die nooit geproefd is (VISIE §5.4). Daarom gaat niets naar de
    standaard vóór de proef, en `standaard` blijft de beginwerkruimte tot Clay kiest;
  - de stukken zijn de plek waar de "logica" zit: een slechte verdeling is een datafout, en die is
    makkelijk terug te draaien (`.versies`, stuk uitzetten).
