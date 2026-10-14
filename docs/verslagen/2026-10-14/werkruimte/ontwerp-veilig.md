# Ontwerp "veilig": de werkruimte als dunne laag data (13 okt 2026)

*Architect "veilig" (kleinste risico). Gelezen: `youtube-mixer` op `studio/afmaken` (339310b, schoon), de
vier verkenningen in deze map, `origin/visie/handen` (HANDEN.md), `docs/STANDEN.md` en `stand-model.js`,
`mapping.js`, `lagen.js`, `mapping-opslag.js`, `maschine.js` en het Maschine-profiel, `actions.js`
(drukknop, nudge, bend, xfade), `feedback.js` (ringtype), `server/index.js` (mapping-route, `MAG`), en de
ongecommitte worktrees van de andere workflow (`wt/controller-invoer`, `wt/controller-uitvoer`: alleen
gelezen). Niets in de repo gewijzigd.*

Clay (13 okt), zes punten: (1) de knoppen logischer over de twee controllers verdelen, (2) meerdere
schermen tegelijk, met de iPad, (3) een track met precisie op zijn plek zetten, (4) alle tracks tegelijk
zien lopen, grid en muziek, om ze gelijk te laten lopen, (5) meer effecten met alle combinatieknoppen die
hij kan bedenken, (6) vrijheid over UI en knoppen: een werkruimte in plaats van een app, per onderdeel van
de mix een andere, "echt complete vrijheid".

---

## 0. Het idee in vijf zinnen

1. Een **werkruimte** is één JSON-bestand dat alleen zegt WAAR dingen staan: welke **fragmenten**
   (extra mappingregels) per apparaat meedoen, welke **mapjes** er bij komen, en per **deel** van de mix
   (decks, uitlijnen, effecten, stems, spelen, beeld, bladeren) welke mapjes open gaan op APC en Maschine
   en welke **indeling** elk scherm toont. Ze zet niets uit, verbergt niets en start geen geluid.
2. De standaardmapping (702 regels), de opbouw van `index.html`, de engine en het audiopad blijven
   precies zoals ze zijn: alles nieuws komt als **fragment** (de bestaande `Mapping.voegToe`, die alleen
   lege plekken vult), als **nieuwe mapjes** (zoals `voegVormMapjeToe` al doet) en als **nieuwe pagina's**
   (`paneel.html`, `uitlijn.html`) die via `window.opener` meelezen, het patroon dat drie keer bewezen is.
3. **Combinatieknoppen** worden geen nieuw regelveld maar een **houd-mapje**: een knop die je vasthoudt
   opent een mapje, en omdat de mapjes gedeeld zijn werkt dat ook over apparaten heen (SOLO op de Maschine
   vast + een APC-knop). Dat is het bestaande gluren, als data.
4. **Precisie** komt zonder nieuw buscontract: `track.N.phase.offset` (de fase als 0..1-stand, 0,5 =
   gelijk; draaien = duwen, de LED-ring = de fasemeter) en `track.N.jog` (een middenknop) werken meteen
   met de bestaande `endless`/`relative-2c`-modi. De mapping weet nog steeds niets van ms (regel 2).
5. Elk spoor is los te proeven op één avond en breekt het live-pad niet. De **iPad** begint als
   alleen-lezen scherm (de uitlijnweergave, SSE zonder dependency), en schrijven komt pas na Clay's ja,
   met een koppelcode, een witte lijst per indeling en "alles loslaten" als de verbinding wegvalt.

---

## 1. Uitgangspunten (wat dit ontwerp NIET doet)

| Blijft precies zoals het is | Waarom |
|---|---|
| `mappings/apc40mk2.json` (702 regels, `eerder`), `maschine-mk2.json` (73), `xboard49.json` | niets is op de hardware geproefd (VISIE §5.4); `mapping.test`, `eerder.mjs`, spiegel- en handentests blijven groen zonder ze aan te raken |
| Clay's eigen verschil (sleutel `mapping`, 4 regels cc:0:20–23 @device.rack) | blijft laden; een fragment wint nooit van een eigen regel (`_pasExtraToe` vult alleen) |
| `index.html`, `vensters.js`-binding, `renderloop.js` | de andere workflow werkt nu in `renderloop.js`, `spiegel.js`, `bovenbalk.js`, `mapje-balk.js`; en de headless-tools rekenen op vaste id's |
| engine, worklets, segmentvorm (7 velden), gouden hash | regel 1 en het audiopad; precisie gaat via `deck.nudge`/`seek(doorlopend)` die er al zijn |
| de action-bus (value 0..1, trigger boolean) | geen soort "delta" erbij; de middenknop lost jog op binnen regel 2 |
| standen (`VERBODEN_DELEN` met `panelen`, `mapjes`) | een stand mag een werkruimte NOEMEN (nieuw deel `werkruimte: { naam }`), de werkruimte zelf zegt alleen WAAR |
| één tabblad praat met de APC (Web Lock, hub 4001) | `paneel.html`/`uitlijn.html` openen nooit MIDI of een AudioContext (test zoals `regels-companion`) |

Twee harde afspraken die het ontwerp "veilig" maken:

- **Toevoegen, niet vervangen.** Elke nieuwe knopfunctie komt op een plek die in de standaard VRIJ is
  (nagerekend, §3.4) of in een NIEUW mapje. Een fragment kan een standaardregel niet overschrijven; dat is
  geen beperking maar de garantie dat "APC alleen" en Clay's verschil blijven werken.
- **Alles blijft bereikbaar.** Een werkruimte kan de rondgang (▲ ▼) korter maken of rijen dichtklappen,
  maar elk mapje houdt zijn kiesknop en elke rij zijn knop. `normaliseerWerkruimte` weigert een
  werkruimte die een mapje zonder kiesknop achterlaat (test).

---

## 2. Het datamodel

### 2.1 Vijf lagen, van onder naar boven

| Laag | Wat | Waar | Van wie | Bestaat al? |
|---|---|---|---|---|
| 1. standaard per apparaat | de 702/73/17 regels | `mappings/<apparaat>.json` (git) | de app | ja |
| 2. eigen verschil per apparaat | wat Clay met learn koppelt | server `mapping` (APC, blijft) en `mapping:<apparaat>` (nieuw, W6); localStorage reserve | Clay | alleen APC |
| 3. fragmenten | extra regels op vrije plekken en in nieuwe mapjes, plus `mapjes`-declaraties | `mappings/werkruimte/<naam>.json` (git) | de app (voorbeelden) of Clay (eigen, W8) | mechanisme ja (`voegToe`, vormen) |
| 4. werkruimte | welke fragmenten, mapjes, delen, indelingen, superknoppen | `werkruimtes/<naam>.json` (eigen, niet in git, zoals `patronen/`) en `tools/werkruimte/voorbeelden/<naam>.json` (git) | Clay of Claude (schrijven met versie + 409) | nee (W3) |
| 5. deel | per onderdeel: open mapjes per apparaat, indeling per scherm, rijen open | binnen het werkruimtebestand | idem | nee (W3) |

Learn verandert niets aan dit model: koppel je in een mapje van een werkruimte, dan komt de regel met
`laag` in je eigen verschil (laag 2), zoals nu. Mapjes zijn globaal, dus die regel werkt in elke
werkruimte die dat mapje opent. Zo ontstaat er nooit een kopie van 702 regels per werkruimte.

### 2.2 Het werkruimtebestand (schema 1), volledig voorbeeld `twee-handen`

```json
{
  "schema": 1,
  "titel": "Twee handen · APC + Maschine",
  "uitleg": "APC = de mixer en de zaal (kolommen, performance-grid). Maschine = de focus-track in detail: uitlijnen, effecten met naam, secties, sampler, spelen.",
  "apparaten": {
    "apc40mk2":     { "fragmenten": ["apc-basis", "apc-fx", "apc-uitlijn"] },
    "maschine-mk2": { "fragmenten": ["maschine-basis", "maschine-houd", "maschine-uitlijn"] }
  },
  "mapjes": {
    "device": { "uitlijn": { "kiesknop": "uitlijn", "naam": "uitlijnen (fase per track · shift = fijn)" } },
    "grid":   { "fx":      { "kiesknop": "fx", "naam": "fx (worp per plek per track · rij 5 dub-worp)", "kleur": "violet" } },
    "houd":   { "stems": {}, "sends": {}, "beeld": {}, "deel": {} }
  },
  "rondgang": { "grid": ["hotcues", "loops", "klank", "stems", "fx", "video", "auto"] },
  "begin": "decks",
  "delen": {
    "decks": {
      "mapjes": { "apc40mk2": { "device": "strip", "grid": "hotcues" },
                  "maschine-mk2": { "pagina": "strip", "padmodus": "secties" } },
      "schermen": { "mac-2": "overzicht", "ipad": "overzicht" }
    },
    "uitlijnen": {
      "mapjes": { "apc40mk2": { "device": "uitlijn", "grid": "loops" },
                  "maschine-mk2": { "pagina": "uitlijn", "padmodus": "secties" } },
      "schermen": { "mac-2": "uitlijn-groot", "ipad": "uitlijn-groot" }
    },
    "effecten": {
      "mapjes": { "apc40mk2": { "device": "rack", "grid": "fx" },
                  "maschine-mk2": { "pagina": "rack", "padmodus": "spelen" } },
      "rijen": { "master": true },
      "schermen": { "mac-2": "mijn-fx", "ipad": "mijn-fx" }
    },
    "stems": {
      "mapjes": { "apc40mk2": { "device": "strip", "grid": "stems" },
                  "maschine-mk2": { "pagina": "strip", "padmodus": "secties" } },
      "rijen": { "stems": true, "koptelefoon": true },
      "schermen": { "mac-2": "stems" }
    },
    "spelen": {
      "mapjes": { "apc40mk2": { "device": "inst", "grid": "patronen" },
                  "maschine-mk2": { "pagina": "instrument", "padmodus": "spelen" } },
      "rijen": { "instrument": true, "patronen": true }
    },
    "beeld": {
      "mapjes": { "apc40mk2": { "device": "beeld", "grid": "video" } },
      "rijen": { "beeld": true },
      "schermen": { "mac-2": "beeld", "ipad": "beeld" }
    },
    "bladeren": {
      "mapjes": { "apc40mk2": { "device": "strip", "grid": "hotcues" },
                  "maschine-mk2": { "pagina": "strip", "padmodus": "spelen" } },
      "onderpaneel": "library"
    }
  },
  "indelingen": {
    "overzicht":     { "raster": "1x2", "vakken": [ { "soort": "uitlijn", "vorm": "pagina", "maten": 1 },
                                                      { "soort": "kaart", "apparaten": ["apc40mk2", "maschine-mk2"] } ] },
    "uitlijn-groot": { "raster": "1x1", "vakken": [ { "soort": "uitlijn", "vorm": "pagina", "maten": 2, "getallen": true } ] },
    "mijn-fx": { "raster": "2x1", "vakken": [
      { "soort": "vrij", "titel": "FX focus", "items": [
        { "soort": "draai", "action": "track.{focus}.fx.knob.1" },
        { "soort": "draai", "action": "track.{focus}.fx.knob.2" },
        { "soort": "knop",  "action": "track.{focus}.fx.knob.1.hold", "label": "WORP 1" },
        { "soort": "knop",  "action": "track.{focus}.send.a.hold", "label": "DUB" },
        { "soort": "draai", "action": "super.1", "label": "OPLOSSEN" } ] },
      { "soort": "vrij", "titel": "bussen", "items": [
        { "soort": "draai", "action": "send.a.knob.1" }, { "soort": "draai", "action": "send.a.knob.2" },
        { "soort": "draai", "action": "send.b.knob.1" }, { "soort": "knop", "action": "send.a.rack.next" } ] } ] },
    "stems": { "raster": "1x1", "vakken": [ { "soort": "vrij", "titel": "stems focus", "sjabloon": "stems-focus" } ] },
    "beeld": { "raster": "1x1", "vakken": [ { "soort": "vrij", "titel": "beeld", "items": [
      { "soort": "draai", "action": "video.fx.pixel" }, { "soort": "draai", "action": "video.fx.trails" },
      { "soort": "draai", "action": "video.fx.grain" }, { "soort": "draai", "action": "video.fx.mirror" },
      { "soort": "draai", "action": "video.master" },   { "soort": "knop",  "action": "video.black.hold", "label": "ZWART" } ] } ] }
  },
  "superknoppen": {
    "1": { "naam": "oplossen", "links": [
      { "action": "track.{focus}.send.a", "in": [0, 0.4], "from": 0, "to": 0.8 },
      { "action": "send.a.knob.2",        "in": [0.3, 1], "from": 0.5, "to": 0.9 },
      { "action": "track.{focus}.filter", "in": [0.2, 1], "from": 0.5, "to": 0.8, "curve": "s" },
      { "action": "video.fx.trails",      "in": [0.5, 1], "from": 0, "to": 0.6 } ] }
  }
}
```

`apc-alleen` (K1, onderweg, zonder hub) is hetzelfde bestand met alleen `apc40mk2` onder `apparaten`,
de volledige rondgang (alle negen modi + fx) en dezelfde delen zonder `maschine-mk2`. Op de APC zijn de
delen dan net zo bruikbaar; de Maschine-kolom valt gewoon weg.

### 2.3 Een fragment (bestaand formaat, twee velden erbij)

```json
{
  "name": "apc-uitlijn", "device": "apc40mk2", "version": 3, "kind": "fragment",
  "mapjes": { "device": { "uitlijn": { "kiesknop": "uitlijn", "naam": "uitlijnen" } } },
  "rules": [
    { "in": "note:0:63", "shift": true, "action": "layer.device.uitlijn", "mode": "trigger", "label": "uitlijnen" },
    { "in": "cc:0:16", "laag": "device.uitlijn", "action": "track.1.phase.offset", "mode": "endless", "takeover": 1 },
    { "in": "cc:0:16", "laag": "device.uitlijn", "shift": true, "action": "track.1.phase.offset.fine", "mode": "endless", "takeover": 1 }
  ]
}
```

- `kind: "fragment"` en `mapjes` zijn nieuw; `leesRegels` negeert ze nu al (onbekende velden), dus een
  oudere versie leest een fragment gewoon als regels.
- `takeover: 1` staat in de mapping-documentatie al voor "doorlopend bewegende waarde" (scrub): de read van
  `phase.offset` schuift met drift mee, en zonder dat zou `_endless` na elke duw één bericht weggooien.
- `mapjes` wordt bij het opstarten geregistreerd vóór `bindLagen`, precies zoals `voegVormMapjeToe()` dat
  voor het vormmapje doet; de `layer.*`-actions volgen dan vanzelf uit `GROEPEN`.

### 2.4 Velden en regels (`src/werkruimte/model.js`, puur, geen imports)

| veld | regel |
|---|---|
| `schema` | 1; anders weigeren |
| `titel` ≤ 60, `uitleg` ≤ 300 | zoals standen |
| naam | bestandsnaam `^[a-z0-9_-]{1,60}$`, niet `actief`/`terug` (zelfde regel als `stand-model.js`) |
| `apparaten.<id>.fragmenten` | namen in `mappings/werkruimte/`; onbekend = waarschuwing, overslaan |
| `mapjes.<groep>.<laag>` | groep `device`, `grid` of `houd`; laag `^[a-z]{2,16}$`; botsing met een bestaand mapje = fout; `kiesknop` verplicht behalve bij `houd` |
| `rondgang.<groep>` | lijst bestaande mapjes; mapjes die eruit vallen MOETEN een kiesknop hebben (anders fout) |
| `delen` | ≤ 8 (want `werkruimte.deel.1–8` en groep A–H); naam `^[a-z]{2,16}$`; `mapjes` alleen bestaande mapjes; Maschine-sleutels `pagina` (uit `PAGINAS`) en `padmodus` (uit `PADMODI`) |
| `rijen` | alleen bekende rij-id's (`stems`, `master`, `koptelefoon`, `instrument`, `patronen`, `auto`, `klankschaal`, `beeld`): `true` = open. Nooit `false`-verbergen: dicht is gewoon de rij dichtklappen, de knop blijft |
| `onderpaneel` | `library`, `midi`, `rack` of afwezig |
| `schermen.<scherm>` | scherm `mac-2`, `mac-3`, `ipad`; waarde = een naam uit `indelingen` |
| `indelingen.<naam>` | `raster` `1x1`…`3x3`; `vakken[].soort` uit het paneelregister (§4.3); onbekend = grijs vak met melding, nooit crash (zoals een onbekend effect in een rack) |
| `items[].action` | moet bestaan na `resolveTarget` met een voorbeeld-focus (`metaOf`); anders grijs |
| `superknoppen.<1–8>` | `links[]` zoals een rack-macro (`in`, `from`, `to`, `curve`, `steps`); rekenregel = `resolveLink` uit `rack.js` |
| verboden velden | `uit`, `verberg`, `acties`, `pijlers`, `start`, `opname`: fout (dezelfde geest als `VERBODEN_DELEN`) |

### 2.5 Waar het staat en hoe het verschilt van stand, mapping en hub-set

| | **mapping (verschil)** | **fragment** | **werkruimte** | **stand (opstelling)** | **hub-set** |
|---|---|---|---|---|---|
| zegt | welke knop welke action doet | extra regels en mapjes | waar dingen staan, per deel | met welke keuzes een avond begint | welke apps, focus, beginsnapshot |
| per | apparaat | apparaat | situatie (een manier van werken) | avond | hub-sessie |
| bestand | server `mapping[:<apparaat>]` | `mappings/werkruimte/*.json` | `werkruimtes/*.json` (+ voorbeelden) | `standen/*.json` | `AV-app-hub/sets/*.json` |
| wisselen | learn, meteen | met de werkruimte, meteen | meteen, zonder herladen | bij activeren; mixer bij de volgende start | hub |
| mag verbergen | — | — | nee (alleen dichtklappen, rondgang korter met kiesknop) | nee | n.v.t. |
| verwijst naar | — | — | fragmenten, indelingen | **een werkruimte** (nieuw deel `werkruimte: { naam }`) | — |

Waarom een werkruimte live mag wisselen en een stand niet: een werkruimte raakt geen audio, geen
library, geen nacht; ze vervangt alleen de fragmenten (`voegToe(bron)` vervangt per bron al), opent
mapjes en herschikt vensters. Wisselen kan alleen vanaf het scherm of de Controlekamer
(`werkruimte.kies` is GEEN controller-action in v1: een per ongeluk gewisselde indeling midden in een
set is precies het soort verrassing dat dit ontwerp wil vermijden). Delen wisselen mag wel vanaf de
controllers.

---

## 3. De knoppenverdeling

### 3.1 Het principe (rolverdeling in één regel per apparaat)

- **APC40 mkII = de mixer en de zaal.** Kolommen = tracks, nooit in een mapje (kern blijft). Het grid is
  de performance over ALLE tracks tegelijk: hotcues, loops, klank, stems, fx, video. Rechts de strip of het
  rack van de focus-track, of acht fasemeters (uitlijnen).
- **Maschine MK2 = de focus-track in detail en spelen.** Draaiknoppen met naam en eenheid op het scherm,
  het wiel voor precisie, de pads voor secties, sampler, stappen en spelen, F1–F8 als worpen, en vier
  houd-knoppen (SOLO, MUTE, NOTE REPEAT, SELECT) die de draaiknoppen tijdelijk iets anders laten doen.
- **Eén woord per vraag "welke track":** APC links = kolom, APC rechts en Maschine = `{focus}`, spelen =
  `{speel}`. In de fragmenten komt er geen vijfde bij; het toetsenbord houdt `{L}/{R}` (code, later).
- **Eén betekenis van shift per apparaat in de nieuwe regels:** APC = "de tweede functie / de fijne
  variant", Maschine = "fijn" (draaiknoppen, zoals nu) of "master" (F1–F8). Bestaande regels veranderen niet.

### 3.2 Per onderdeel: wie doet wat (werkruimte `twee-handen`)

*Vet = nieuw (fragment of nieuwe action). Gewoon = bestaat al en blijft zo.*

| Onderdeel | APC40 mkII | Maschine MK2 (hub) | LPD8 (hub) | Xboard49 | Scherm (Mac-2 / iPad) |
|---|---|---|---|---|---|
| **decks / mixer** | kolom: filter, fader, play (⇧ op de maat), sync (⇧ tap), A\|B (**⇧ = thru**), PFL (⇧ cue), Clip Stop loop; crossfader, master, Cue Level; tempo-encoder; Bank ◀ ▶ beatjump; Nudge ± bend | groep A–H = focus; pagina Strip: trim/hoog/mid/laag/echo/galm/fx-mix/filter (⇧ fijn); pads = secties (SCENE) | — | schuif = fader speeltrack | `overzicht`: uitlijnweergave + kaart van wat de knoppen nu doen |
| **uitlijnen (precisie)** | **⇧ Lock = mapje uitlijn: device knob k = fase van track k (ring = fasemeter, middelste LED = gelijk), ⇧ = fijn** | **pagina Uitlijn: knop 1 fase grof, 2 fase fijn, 3 tempo (0,01 %), 4 jog, 5 bend-sterkte, 6–8 vrij; wiel = jog (⇧ fijn); ENTER = op de maat (alleen met de library dicht)** | — | — | `uitlijn-groot`: twee maten, grid Δ, muziek Δ, drift per baan |
| **effecten** | device.rack fx 1–8 (bestaat); **⇧ On/Off = grid-modus fx: kolom = track, rij 1–4 = worp plek 1–4 (vasthouden), rij 5 = dub-worp naar de echo; ⇧ rij 1 = bypass, ⇧ rij 5 = worp naar de galm** | pagina Rack (bestaat); **F1–F8 = worp plek 1–8 van de focus, ⇧ F1–F8 = worp master-plek 1–8; MUTE vast = draaiknoppen op de echo- en galmbus (send.a/b.knob.1–4)** | — | knop 9–16 = fx speeltrack (bestaat) | `mijn-fx`: vrij paneel met plekken, worpen, **superknoppen**, bus-racks kiezen |
| **stems** | grid-modus stems (bestaat: rij 1–5 weg zolang je drukt) | **SOLO vast = draaiknoppen op de stems van de focus: 1–4 niveau zang/drums/bas/overig, 5–8 filter van die vier (⇧ fijn)** | — | — | `stems`: per stem filter, echo, galm, cue |
| **sampler / instrumenten / patronen** | device.inst als de focus een instrument heeft; grid patronen, sampler (bestaan; in de rondgang van `twee-handen` niet meer, wel via ⇧ scene) | pads: SAMPLING, STEP, PATTERN, spelen (bestaan); pagina Instrument (bestaat) | — | toetsen + knop 1–8 (bestaat) | rijen instrument + patronen open |
| **beeld** | master-knop = zwart (bestaat); ⇧ Detail View = mapje beeld (bestaat); grid video (bestaat) | **NOTE REPEAT vast = draaiknoppen op het beeld: pixel, sporen, korrel, spiegel, rgb, kleur, helderheid (video.master), puls** | K2 helderheid, K4 puls, P1 zwart vasthouden (bestaat) | — | `beeld`: video-fx-knoppen, zwart |
| **bladeren** | — | BROWSE, wiel, ◄ ►, ENTER (bestaat) | — | — | onderpaneel library open |
| **delen wisselen** | **⇧ ◀ ▶ (pijlen) = vorig/volgend deel** | **SELECT vast + groep A–G = deel 1–7** | — | — | tabbalk met de delen |

Wat hiermee rechtgezet wordt (de problemen uit de verkenning):

- **De Maschine ontlast de APC in plaats van haar te herhalen**: in `twee-handen` zitten sampler,
  patronen en secties niet meer in de ▲ ▼-rondgang van de APC (ze blijven bereikbaar met ⇧ scene). De
  APC houdt de modi waarin acht kolommen tegelijk iets betekenen.
- **De meestgebruikte muishandelingen krijgen een knop**: `track.N.xfade.thru` (1.306×) = ⇧ A\|B;
  `video.fx.*` (pixel 1.117, sporen 596, korrel 490, spiegel 369, rgb 257, kleur 239) = NOTE REPEAT vast +
  draaiknop; `stem.drums` (248) = SOLO vast + knop 2; `track.N.pitch` (658) blijft de tempo-encoder plus de
  fijne knop 3 op de pagina Uitlijn.
- **Precisie op hardware**: er was geen jog en geen fase-draaiknop; nu op twee plekken.
- **Drukvarianten op een controller**: `fx.knob.K.hold` stond nergens; nu F1–F8 en het fx-grid.
- **Strip-knop 8 verschilt per apparaat** (APC fx 1, Maschine filter): blijft zo (bestaande regels), staat
  in de vragen (W-V3), omdat gelijktrekken een standaardregel verandert.

### 3.3 `apc-alleen` (K1, onderweg)

Dezelfde APC-regels als hierboven, plus de volledige rondgang (hotcues, loops, sampler, video, klank,
auto, stems, patronen, secties, **fx**). Uitlijnen gaat met ⇧ Lock (fasemeters) en de tempo-encoder; jog
alleen via het mapje uitlijn met ⇧ (fijn) of het scherm. Er gaat niets verloren t.o.v. vandaag: elke
regel van de standaard staat er nog, de fragmenten vullen alleen.

### 3.4 Nieuwe regels, exact (nagerekend tegen de standaard: alle sleutels vrij)

| Fragment | Sleutels | Action(s) | Regels |
|---|---|---|---|
| `apc-basis` | `note:0..7:66#shift` | `track.{1..8}.xfade.thru` | 8 |
| | `note:0:96#shift`, `note:0:97#shift` | `werkruimte.deel.next` / `.prev` | 2 |
| `apc-uitlijn` | `note:0:63#shift` (⇧ Lock) | `layer.device.uitlijn` | 1 |
| | `cc:0:16..23@device.uitlijn` (+ `#shift`) | `track.k.phase.offset` (+ `.fine`), `endless`, `takeover: 1` | 16 |
| `apc-fx` | `note:0:62#shift` (⇧ On/Off) | `layer.grid.fx` | 1 |
| | pads `note:0:32..39@grid.fx` (rij 1 = boven), `24..31`, `16..23`, `8..15` | `track.k.fx.knob.{1..4}.hold` | 32 |
| | pads `note:0:0..7@grid.fx` (rij 5) | `track.k.send.a.hold` | 8 |
| | `note:0:32..39#shift@grid.fx`, `note:0:0..7#shift@grid.fx` | `track.k.fx.bypass`, `track.k.send.b.hold` | 16 |
| **APC totaal** | | | **84** (standaard blijft 702) |
| `maschine-basis` | `note:1:0..7` (F1–F8), `#shift` | `track.{focus}.fx.knob.K.hold`, `master.fx.knob.K.hold` | 16 |
| `maschine-houd` | `note:1:46` SOLO, `47` MUTE, `22` NOTE REPEAT, `45` SELECT | `layer.houd.stems/.sends/.beeld/.deel` | 4 |
| | `cc:0:16..23@houd.stems/.sends/.beeld` (+ `#shift` fijn) | stems, `send.a/b.knob.1–4`, `video.fx.*`/`video.master`/`video.pulse` | 48 |
| | `note:1:24..30@houd.deel` (groep A–G) | `werkruimte.deel.1–7` | 7 |
| `maschine-uitlijn` | `cc:0:16..20@pagina.uitlijn` (+ `#shift`), `cc:0:24@pagina.uitlijn` (wiel, + `#shift`), `note:1:21@pagina.uitlijn` (ENTER) | §5 | 13 |
| **Maschine totaal** | | | **88** (standaard blijft 73) |

Vrij in de standaard en hier NIET gebruikt (blijft voor Clay): APC ⇧ Stop All, ⇧ Pan/Sends/User,
⇧ Device ◀ ▶, ⇧ ▲ ▼, ⇧ master-knop, footswitch, 35 pads in auto, 28 in video, 15 in sampler; Maschine
ALL, AUTO, VOLUME, SWING, TEMPO, GRID, PAD MODE, NAVIGATE, DUPLICATE; LPD8 K1, K3, K5–K8 (rollen van de hub,
bewust niet: de K1-dip 0,80 → 0,43).

---

## 4. Meerdere schermen en de iPad

### 4.1 Drie soorten scherm

| scherm | pagina | rol | transport | schrijven | wanneer |
|---|---|---|---|---|---|
| **hoofd** (Mac, het mixer-tabblad) | `index.html`, ongewijzigd | audio, MIDI, Web Lock, voert alles uit | — | ja | nu |
| **mac-2, mac-3** (tweede monitor, beamerscherm) | `paneel.html?s=mac-2` en `uitlijn.html` | indeling van het actieve deel | `window.opener.varvePanelen` (zelfde thread, 0 ms) | ja, via de bus van de opener | W2/W3 |
| **ipad** (Safari, via Tailscale) | dezelfde `paneel.html?s=ipad` | indeling van het actieve deel | SSE + POST via de server (relais) | eerst NEE; daarna na Clay's ja, met witte lijst | W7a / W7b |

Eén paneelcode, twee transporten: `src/paneel/verbinding.js` kiest `opener` als die er is en van
dezelfde oorsprong is, anders de server. De pagina weet daarna alleen `{ invoke, read, meta, op, klok }`.

### 4.2 Wat er op elk scherm kan

- **Hoofd**: alles zoals nu. De werkruimte opent alleen mapjes, klapt rijen open (`rijen`) en opent een
  onderpaneel. Geen herbouw van `index.html` in dit ontwerp (later spoor, §9 "na W8").
- **mac-2/3**: elke indeling. Omdat het een venster van de mixer is, deelt het de hoofdthread (de audio
  niet): de uitlijnweergave tekent daarom in paginavorm (~1 Mpx/s, §6), niet scrollend.
- **iPad, alleen lezen (W7a)**: uitlijnweergave (tekent op de GPU van de iPad), kaart (wat doen de knoppen
  nu), standen van knoppen (lampjes, ringen als balkjes). Geen enkel bericht naar de mixer.
- **iPad, schrijven (W7b)**: alleen de actions die in de indeling van dat scherm staan, na
  `resolveTarget`. Draaien, schakelen, worpen, secties (op de maat), `play.quant`, superknoppen. Geen
  bend (hangt af van hoe lang je drukt: wifi-jitter), geen ongequantiseerde start.

### 4.3 Het paneelregister v1 (klein gehouden)

| soort | wat | code |
|---|---|---|
| `vrij` | items `draai` / `knop` / `schuif` / `lamp` met een action; label uit `beschrijf()` als je er geen geeft, kleur uit `soorten.js` | `src/paneel/vrij.js` (eigen kleine renderer met de semantiek van `controls.js`: indrukken leest de action, loslaten naar dezelfde; alt = `.hold` niet, die staat als eigen item) |
| `uitlijn` | §6 | `src/uitlijn/teken.js` |
| `kaart` | per apparaat: de open mapjes en per knop wat hij nu doet (`mapping.kies` + `beschrijf`), zoals de mapje-balk maar groot | `src/paneel/kaart.js` |
| `sjabloon` (in `vrij`) | `stems-focus`, `kolom-k`, `bussen`: kant-en-klare itemlijsten in `tools/werkruimte/sjablonen.json`, data | data |

Bewust NIET in v1: library, rack-editor, planvenster in een vak (die hebben hun eigen pagina's of zitten
op het hoofdscherm). Een bestaande rij als bouwsteen (`stems`, `master` …) is het spoor na W8.

### 4.4 Het protocol (puur, `src/paneel/protocol.js`, gedeeld door mixer, server en paneel)

| richting | route | bericht | wanneer |
|---|---|---|---|
| mixer → server | `POST /api/paneel/van-mixer` (alleen `vanDezeMac` en alleen het tabblad dat `statusVanMij()` is) | `[{ t:'stand', reads }, { t:'verschil', id, v }, { t:'tijdlijn', deck, segId, T, P, R, loop, rem, speelt, wacht, gridVersie }, { t:'klok', ctxT, perfT }, { t:'maatgever', deck }, { t:'werkruimte', naam, deel }]` | gebundeld per 20 ms; verschillen ≤ 10/s per id; tijdlijn bij elke nieuwe `segId`; klok 1×/s (`getOutputTimestamp()`) |
| server → paneel | `GET /api/paneel/live?s=ipad` (SSE, `node:http`, geen dependency) | dezelfde berichten; bij verbinden eerst de laatste `stand`, `tijdlijn` per deck, `klok`, `werkruimte` | push |
| paneel → server | `GET /api/paneel/ping` | `{ t: Date.now() }` (klokverschil, mediaan van 8 rondjes) | bij verbinden, daarna 1×/10 s |
| paneel → server (W7b) | `POST /api/paneel/invoke` | `{ id, v, druk: 'aan'\|'los'\|null, seq }` | per gebaar; waarden per beeld samengevoegd |
| server → mixer (W7b) | `GET /api/paneel/naar-mixer` (SSE, alleen `vanDezeMac`) | het invoke, met `scherm` en `seq` | push |

Posities gaan nooit per beeld over het net: de iPad rekent zelf `positieIn(seg, t)` met de formule uit
`stream-kern.js` op zijn eigen klok + het klokverschil, en trekt de uitgangsvertraging af zoals
`hoorbaar.js`. Regel 3 over een netwerkgrens, zoals al over de draadgrens in de streamkern.

Waarom SSE + POST en niet een WebSocket (afweging, gekozen): SSE is in de browser standaard en aan de
serverkant twintig regels `res.write`; een WebSocket vraagt een eigen frameparser (~100–150 regels) of de
eerste server-dependency (`ws`). Op loopback is het verschil verwaarloosbaar (relais WebSocket 0,13 ms
mediaan, POST 0,98 ms mediaan, p99 10,5 ms gemeten in de verkenning). Een POST per draai kost op de iPad
een paar ms extra, en een iPad is toch niet voor timing (§4.5). Blijkt het tekort: WebSocket in een
volgend spoor, dezelfde berichten.

### 4.5 Latentie: wat de iPad wel en niet doet

| keten | gemeten (loopback) | aanname (echt) | gevolg |
|---|---|---|---|
| mac-2 via opener | 0 netwerk | + renderloop van de mixer | alles mag |
| mixer → server → iPad (lezen) | relais 0,13 ms med., POST 0,98 ms med. | wifi + WireGuard 5–30 ms, uitschieters op een hotspot | de iPad toont wat al gepland is; posities geëxtrapoleerd, fout ≈ fout in het klokverschil (½ rondje, enkele ms) |
| iPad → mixer (schrijven) | ±1 ms | touch 30–60 ms + netwerk | alleen gequantiseerde of doorlopende actions: `play.quant`, `section.K` (valt op de "1"), worpen, draaien, superknoppen; nooit een vrije start of bend |

### 4.6 Veiligheid (eerste schrijfweg van buiten de Mac, W7b, alleen na Clay's ja)

1. **Standaard uit.** `/api/paneel/invoke` bestaat pas als Clay het in de Controlekamer aanzet (instelling
   op de server, zichtbaar als tegel); zonder: 404. Eerst melden (CLAUDE.md), vraag W-V1.
2. **Alleen via de tailnet of localhost** (`VARVE_HOSTS`, HTTPS door `tailscale serve`), Origin precies de
   eigen pagina, Host-controle zoals nu (`vreemdVerzoek`).
3. **Koppelen met een code**: de mixer toont zes cijfers (60 s geldig); de iPad tikt ze in; de server
   geeft een token (32 bytes) in een `HttpOnly; Secure; SameSite=Strict`-cookie. Tokens gehasht bewaard,
   per apparaat een naam, intrekken in de Controlekamer.
4. **Witte lijst bij de UITVOERDER**: de mixer voert een invoke alleen uit als de action (na
   `resolveTarget`) in de indeling van dat scherm in het actieve deel staat. Altijd geweigerd, ook als ze
   in de indeling staan: `record.*`, `log.*`, `broadcast.*`, `werkruimte.kies`, `*.load*`, `library.*`.
   Destructieve actions houden hun tweede-druk-regel.
5. **Loslaten bij wegvallen**: de mixer houdt per scherm bij welke triggers `druk:'aan'` kregen; geen SSE
   of ping meer binnen 1,5 s = elke vastgehouden knop los (zoals `mapping.losgekoppeld()`).
6. **Rem**: hooguit 120 invokes/s per scherm (daarboven 429), `seq` tegen dubbel na een herhaalde POST.
7. **Log**: een invoke van buiten krijgt `{ bron: 'ipad' }` in de 4e kolom van het handelingenlog (die
   bestaat al voor `van`).

Eén tabblad: de server stuurt invokes alleen naar de mixer die zich als lockhouder meldde; een tweede
mixer-tabblad krijgt niets (zelfde beslisser als `statusVanMij` in `app.js`).

---

## 5. Precisie (punt 3)

### 5.1 De nieuwe actions (W1, alleen `actions.js`, engine ongewijzigd)

| action | soort | read | invoke | waarom zo |
|---|---|---|---|---|
| `track.N.phase.offset` | value, `bipolar: true` | 0,5 + (fase t.o.v. de maatgever in tellen), geklemd 0..1; **null** zonder grid, zonder maatgever, of als N de maatgever is | `deck.nudge((v − read) × tel)` (fasebehoudend, binnen de loop, met keylock gepland op het zoekrooster) | regel 2: fractie van een tel, de engine rekent ms; `bipolar` geeft vanzelf de pan-ring (`feedback.js:225`), dus de ring IS de fasemeter |
| `track.N.phase.offset.fine` | value, `bipolar: true` | 0,5 + fase / (⅛ tel), geklemd | idem, × ⅛ tel | de grove ring toont ±½ tel (~32 ms per LED op 124 bpm); de fijne ±1/16 tel (~4 ms per LED) |
| `track.N.jog` | value (middenknop) | altijd 0,5 (null zonder nummer) | Δ = (v − 0,5) × 2 tellen (zonder grid × 2 s); spelend `nudge(Δ)`, stil `seek(positie + Δ)` | jog/scrub zonder "delta"-soort op de bus; werkt met `endless` en `relative-2c`; ook in pauze (ONTBREEKT B6) |
| `track.N.bar.align` | trigger | 1 als de "1" van N binnen 0,01 tel op die van de maatgever valt, 0 anders, null zonder | beatjump van −2…+2 tellen naar de dichtstbijzijnde "1" van de maatgever (`barPhase`/`telInMaat`, nooit `beat % 4`) | sync zet de tel, niet de maat (P6) |
| `track.N.bend.amount` | value | (sterkte − 1 %) / 15 % | sterkte 1–16 % (standaard 4 %) | bend sterker/zwakker (P3); `BEND` wordt een veld op het deck, dat is de enige engine-regel (een getal, geen audiopad) |

Samenvoegen (P2): elke klik is een seek = een nieuw segment. `phase.offset`, `.fine` en `jog` tellen hun
Δ op per deck en voeren het hooguit eens per 15 ms uit (een timer die alleen WANNEER zegt; de positie komt
van het deck, regel 3). Zo worden 50 berichten per seconde ≤ 67 seeks, en met keylock komt er niet een
gepland segment per klik bovenop het vorige.

Handelingenlog: `phase.offset`, `.fine` en `jog` horen niet in de beginstand (`NIET_IN_WAARDEN`): de
beginstand zou anders bij terugspelen een fase "terugzetten". In het log staan ze wel, en ze spelen terug
als dezelfde duw. In `OVERNEEM` van de auto-DJ: ja (duwen tijdens een overgang is van Clay).

### 5.2 Op welke knop

| | APC | Maschine | scherm / iPad |
|---|---|---|---|
| fase grof | ⇧ Lock → device knob k (track k) | pagina Uitlijn knop 1 (`relative-2c`, step 0,002 = ~1 ms op 124 bpm per tik) | uitlijnweergave: een baan slepen = `phase.offset` met de versleepte fractie (afstand, ongevoelig voor netwerkvertraging) |
| fase fijn | ⇧ + device knob k | knop 2 (step 0,002 van ⅛ tel ≈ 0,12 ms) | ⇧ + slepen |
| jog | — (vrij te koppelen) | wiel op pagina Uitlijn (1/64 tel per klik, ⇧ 1/512) en knop 4 | — |
| tempo | tempo-encoder (bestaat, ⇧ 0,01 %) | knop 3 = `track.{focus}.tempo` step 0,0001 | — |
| bend-sterkte | — | knop 5 = `track.{focus}.bend.amount` | — |
| grid ‹ › | grid-modus (bestaat, ongewijzigd) | — (het grid verzetten is iets anders dan de track verzetten; blijft in de grid-modus) | — |
| op de maat | — | **ENTER op pagina Uitlijn** = `track.{focus}.bar.align` (alleen als de library dicht is; anders laadt ENTER zoals nu, laag `bladeren` gaat voor) | knop in de baan |

Het wiel staat in `maschine.js` in code. De kleinste ingreep: `maschine.js` vraagt eerst de mapping of er in
de open mapjes een regel voor `cc:0:24` staat; zo ja, dan gaat het wiel daarheen, anders het oude gedrag
(instrument kiezen / bladeren). Dat verandert niets zolang er geen regel is.

---

## 6. De uitlijnweergave (punt 4)

### 6.1 Wat je ziet

```
 maatgever ▸ 3 · 124,00          |1 . . . |2 . . . |1 . . . |2 . . .      ← tellen van de maatgever ZOALS JE HEM HOORT
 ─────────────────────────────────┼────────┼────────┼────────┼────────
 ■ 3  124,00  (maatgever)         ▌▌ ▌  ▌ ▌▌ ▌  ▌ ▌▌ ▌  ▌ ▌▌ ▌  ▌
 ■ 1  123,98  grid +0,4  muz +9,8  drift −0,8/16  maat 0   ▌▌ ▌  ▌ …     ← rood: het grid zegt gelijk, de kicks niet
 ■ 5  124,00  grid −0,1  muz −0,3  drift 0,0      maat +1  ▌▌ ▌  ▌ …     ← een tel naast de maat: knop "op de maat"
 □ 2  wacht op de maat (start op de 1 over 1,3 maat)                    ← gestippeld: wat er straks valt
                                    ▲ speelkop (alleen deze streep beweegt)
```

- **x-as in tellen van de maatgever, zoals je hem hoort**: `beatAt(hoorbaar(M))`. Eén tel is overal even
  breed, wat het tempo ook is. Standaard twee maten.
- **Per baan** (spelende, wachtende en geladen tracks met een grid): de golf (lage band zodra die er is,
  anders min/max), de eigen gridlijnen (de "1" voller), de gevonden tellen (groen) en klappen; vallen die
  op de lijnen van de maatgever, dan klinkt het gelijk.
- **Drie getallen per baan**: **grid Δ** (ms, `engine.faseVerschil`), **muziek Δ** (ms, mediaan over de
  laatste 8 gehoorde tellen van i tegen die van de maatgever, uit `deck.tellen`, anders klappen met
  "±15 ms"), **drift** (ms per 16 tellen uit het bpm-verschil), plus **maat** (tellen naast de "1").
  Kleur: groen < 3 ms, geel < 10 ms, rood daarboven. Het verschil tussen grid Δ en muziek Δ zegt welk grid
  naast zijn muziek ligt (`afwijkingBij` per track): dat wil je vastzetten, niet duwen.
- Loop gearceerd, hotcues, stukgrenzen en zekerheidsstrook van het grid; een remmende of wachtende track
  komt vanzelf goed, want de baan leest het segment.

### 6.2 De rekenregel (regel 3)

De baan van track i op tel x van de maatgever toont de tracktijd die je hoort op het audioklokmoment
waarop de maatgever tel x laat horen: `positieIn(seg_i, t) − V × rate_i`, met
`t = nu + (x − x_nu) × hoorbare tellengte van M`. Het segment `{T, P, R, loop, rem, speelt, wacht}` komt
van een nieuwe alleen-lezen getter `Deck.tijdlijn()` (W2: een kopie van wat de bron al heeft, plus
`_segId` en `gridVersie` als sleutel). Geen eigen teller, geen nieuwe timer. Rekenwerk puur in
`src/uitlijn/reken.js`, dezelfde module op de Mac en de iPad.

### 6.3 Twee vormen, en wat het kost

| vorm | wat | opnieuw tekenen | ≈ Mpx/s |
|---|---|---|---|
| **pagina** (standaard) | het venster staat stil op twee maten en slaat om; alleen de speelkopstreep (CSS-transform, compositor) beweegt; wat gelijk loopt staat stil onder elkaar | bij omslaan, een nieuwe `segId`, `gridVersie` of zoom | ~1 (+ de streep) |
| **vouw** (fasescoop) | per track één maat breed; elke gehoorde tel als stip op zijn fase t.o.v. de maatgever, dooft uit; gelijk = smalle stapel, drift = een schuin spoor, flam = twee stapels | per tel | ~0,5 |

Scrollend op 60 fps zou ~110 Mpx/s kosten (5 okt halveerde 29 Mpx/s Demucs): niet in dit ontwerp.
Tekenen met een voorgetekende strook per track en per beeld `drawImage` (1,7 ms voor acht banen tegen
10,3 ms met `fillRect`, gemeten in de verkenning, software-rendering: alleen de verhouding telt).

### 6.4 Op de hardware

- **APC**: ⇧ Lock = acht fasemeters op de ringen (pan-ring, middelste LED = gelijk), draaien = duwen. De
  Track Select van de maatgever knippert al omgekeerd.
- **Maschine** (later, W4-uitbreiding): het linkerscherm in vouwvorm voor de focus-track tegen de
  maatgever, rechts de getallen in ms (`maschine-scherm.js`, 1 bit). AANNAME: leesbaar op 256 × 64.

---

## 7. Effecten en combinatieknoppen (punt 5)

Wat "alle combinatieknoppen" in dit ontwerp betekent, van klein naar groot, en waar het zit:

| # | combinatie | hoe | waar | engine? |
|---|---|---|---|---|
| C1 | **meerdere worpen tegelijk** | elke `.hold` werkt los, dus twee vingers = twee plekken open, op twee tracks = twee racks; het fx-grid (40 pads) en F1–F8 maken dat bespeelbaar | fragmenten `apc-fx`, `maschine-basis` | nee |
| C2 | **knop A vast + knop B = iets anders, ook over apparaten** | houd-mapje: `layer.houd.<naam>` (trigger: indrukken = open, loslaten = dicht als het nog het zijne is). Regels met `"laag": "houd.<naam>"` gelden zolang hij vastzit. De Maschine-mapping kijkt naar dezelfde gedeelde `houd.*`-mapjes, dus SOLO op de Maschine vast verandert ook APC-regels als Clay die in `houd.stems` leert | `lagen.js` (groep `houd`, vooraan in de zoekvolgorde), `maschine.js` (`lagen()` + de gedeelde houd-mapjes) | nee |
| C3 | **momentary op elke worp** | nieuwe drukvarianten met de bestaande `drukknop`-logica: `track.N.send.a.hold`, `.send.b.hold` (de dub-worp), `track.N.fx.mix.hold`; indrukken = 1 direct, loslaten = terug | `actions.js` | nee |
| C4 | **één knop beweegt veel, over slots heen** | superknop `super.K` (value, read = eigen stand) + `super.K.hold`; links als een rack-macro, uitgerekend met `resolveLink` uit `rack.js` (één rekenregel), uitgevoerd als gewone `invoke`s. In het log staan de KINDEREN; `super.*` staat in OVERSLAAN (anders dubbel terugspelen) | `src/werkruimte/superknop.js` (puur) + bind | nee |
| C5 | **andere racks op de bussen** | `send.a.rack.next/prev`, `send.b.rack.next/prev` (de engine heeft `zetRack` al, met kruisfade); welke staat bewaart de schermlaag zoals het master-rack (localStorage op naam) | `actions.js` + een kiezer in `mijn-fx` | nee |
| C6 | **een leeg eigen mapje vol eigen combinaties** | `mapjes.device.mijndub: { kiesknop: … }` in de werkruimte, mapje openen, learn: de regels komen met `laag` in Clay's verschil | data + learn | nee |

Bewust NIET in dit ontwerp (engine-werk, groot risico, eerst een concreet geval van Clay): vrije routing
en extra bussen (vaste-gain-matrix, spiegels in `applyUi`/`_glijParams`/`_glijDoelen`), parallelle takken
in een rack, insert per stem (gemeten ~5,5 ms CPU per s per slot, ook stil; 32 = +110 %), loop roll/slip,
modulatie van plekken door de muziek, `conflict`-modi in `rack.js`. Elk staat als vraag in §11.

---

## 8. "Echt complete vrijheid" zonder dat het onbruikbaar wordt

- **Vrij**: elke knop van elk apparaat via learn (W6 maakt dat ook voor Maschine en Xboard waar), eigen
  mapjes, eigen houd-mapjes, eigen delen, eigen indelingen met eigen knoppen per scherm, superknoppen.
  Alles data, alles door Claude te schrijven (versie + 409, zoals plannen en patronen).
- **Bruikbaar**: na elke deelwissel toont de mapje-balk (bestaat) wat de knoppen nu doen; `kaart` op
  mac-2/iPad doet dat groot; `apc.html` en `maschine.html` lezen fragmenten mee (W8). Elk mapje houdt een
  kiesknop. Wisselen van werkruimte alleen vanaf het scherm.
- **Instellen zonder JSON** (later, na de proef): een werkruimte-editor in `paneel.html` (items slepen,
  action kiezen met de zoekbalk van `apc.html`), en "wat doe ik het meest met de muis" uit de top-40 van
  de handenkaart als voorstellijst. In v1 is het bestand de editor en Claude de hulp.

---

## 9. Bouwsporen

Volgorde en parallel werken. De andere workflow heeft ongecommit werk in `mapping.js`, `lagen.js`,
`maschine.js`, `feedback.js`, `midi.js`, `hub.js`, `midi-opzet.js`, `spiegel.js`, `renderloop.js`,
`bovenbalk.js`, `mapje-balk.js`, `master-paneel.js` (takken `afmaken/controller-invoer`,
`-uitvoer`). Sporen die die bestanden raken (W4, W6) beginnen pas na hun samenvoeging in
`studio/afmaken`; de rest raakt ze niet en kan nu.

```
nu:     W1 precisie ─┐        W2 uitlijn ─┐        W3 kern ─┐        W5 effecten        W7a iPad lezen (na W2+W3)
                     │                    └──────── W3 embed │
na de controller-workflow:   W4 mapjes/fragmenten (na W1, W3, W5)   W6 mapping per apparaat
daarna:                      W7b iPad schrijven (na W7a + Clay's ja)   W8 kaarten, proef, docs, samenvoegen
```

Elk spoor: eigen tak in een worktree buiten iCloud (`~/Projects/varve-stems/<spoor>`), samenvoegen in
`studio/integratie`, `node test/alles.mjs` groen, en een proefpunt in de speellijst.

### W1 Precisie-actions
- **Wat**: `track.N.phase.offset`, `.phase.offset.fine`, `.jog`, `.bar.align`, `.bend.amount`; samenvoegen
  van klikken per 15 ms; beschrijvingen; log/auto-DJ-lijsten. Nog geen mappingregels (die komen in W4).
- **Bestanden**: `src/control/actions.js` (een nieuw blok per track), `src/engine/deck.js` (alleen
  `this.bend = BEND` als veld), `src/ui/apc-beschrijf.js`, `src/ui/soorten.js` (soort "uitlijnen"),
  `src/control/handelingen.js` (`NIET_IN_WAARDEN`), `src/auto/automaat.js` (`OVERNEEM`),
  `test/precisie.test.mjs` (nieuw).
- **Hangt af van**: niets.
- **Acceptatie** (engine met de Web Audio-mock, nep-klok): na sync leest `phase.offset` 0,500 ± 0,001;
  invoke 0,5 + 1/127 verschuift `faseVerschil` met tel/127 ± 0,1 ms; `.fine` met tel/1016 ± 0,05 ms; 50
  invokes in 100 ms geven ≤ 7 seeks en dezelfde eindfase (± 0,1 ms) als één invoke met de som; `jog` in
  pauze verplaatst de positie exact Δ; `bar.align` brengt `telInMaat` gelijk aan die van de maatgever;
  read null zonder grid/maatgever en op de maatgever; met keylock aan ≤ 1 gepland segment tegelijk;
  `renderblok.test.mjs` gouden hash ongewijzigd, 0 GC; de beschrijvingstest eist een uitleg voor elke
  nieuwe action. Headless (`tools/headless/precisie.mjs`, echte Chrome, demotrack op twee decks, 7 ms
  naast): na 7 tikken fijn `faseVerschil` < 1 ms.
- **Risico**: een seek van ~1 ms met 4 ms overvloei kan hoorbaar zijn bij snel draaien (AANNAME; meten
  in de headless-proef op de uitvoer: geen sprong > 0,05 bovenop de muziek, zoals de loopnaad); de read
  van `phase.offset` schuift met drift: nooit op een fader (documenteren, `takeover: 1` in elke regel).

### W2 De uitlijnweergave
- **Wat**: rekenwerk (puur), tekenen (pagina + vouw, voorgetekende stroken), `uitlijn.html` als los venster
  via `window.opener.varveUitlijn`, de alleen-lezen getter `Deck.tijdlijn()`.
- **Bestanden**: `src/uitlijn/reken.js`, `src/uitlijn/teken.js`, `src/uitlijn/venster.js`, `uitlijn.html`,
  `src/engine/deck.js` + `src/engine/bron.js` (alleen de getter, geen audiopad), `src/ui/app.js` (één
  regel `window.varveUitlijn = …` en een knop in het bestaande menu "vensters" van de MIDI-/videobalk; NIET
  in `bovenbalk.js`), `server/index.js` (`MAG` + `uitlijn`), `test/uitlijn.test.mjs`,
  `tools/headless/uitlijn.mjs`.
- **Hangt af van**: niets (W1 maakt het slepen mogelijk, maar lezen kan zonder).
- **Acceptatie**: puur: twee synthetische decks met grids, 10 ms naast → grid Δ 10,0 ± 0,1 ms; drift
  0,5 % → ms/16 tellen exact; maat +1 herkend; een loop die rondgaat geeft geen sprong in de baan; een
  wachtende track staat op de "1" waar hij zal invallen; muziek Δ uit nep-tellen = de ingestelde 12 ms.
  Headless (echte Chrome): in rust ≤ 3 Mpx/s getekend (teller op `drawImage`/`fillRect`), < 2 ms per beeld
  in het venster, het hoofdvenster verliest < 1 beeld per seconde met het venster open, en de getallen in
  het DOM kloppen met `engine.faseVerschil` binnen 0,5 ms. `regels.test`: `src/uitlijn/` importeert niets
  uit `ui/`, `control/`, `server/`.
- **Risico**: zelfde hoofdthread als de mixer (gemeten in de acceptatie); de muziek-Δ is grover zonder
  Beat This!-tellen (en zegt dat).

### W3 De werkruimte-kern (data, delen, paneel.html via opener)
- **Wat**: model (puur), server-opslag met versie/409 en `.versies`, voorbeelden `twee-handen` en
  `apc-alleen`, delen toepassen (mapjes openen, rijen openklappen, onderpaneel), actions
  `werkruimte.deel.1–8/.next/.prev` (read = 1 als actief) en `werkruimte.kies` (alleen scherm),
  `paneel.html` met de renderers `vrij` en `kaart` en het vak `uitlijn` (uit W2), een kleine
  werkruimtestrook (deel-tabs) als nieuwe module, stand-deel `werkruimte: { naam }`.
- **Bestanden**: `src/werkruimte/model.js`, `src/werkruimte/deel.js`, `src/werkruimte/bind.js` (defines,
  eigen bestand), `src/paneel/paneel.js`, `src/paneel/vrij.js`, `src/paneel/kaart.js`,
  `src/paneel/verbinding.js` (alleen opener in W3), `paneel.html`, `src/ui/werkruimte-strook.js` +
  één `<div>` in `index.html` + één aanroep in `app.js`, `server/werkruimtes.js`, `server/index.js` (routes,
  `MAG`), `src/standen/stand-model.js` + `server/standen.js` (deel `werkruimte`),
  `tools/werkruimte/voorbeelden/*.json`, `tools/werkruimte/sjablonen.json`, `test/werkruimte.test.mjs`,
  `test/werkruimte-server.test.mjs`, `tools/headless/werkruimte.mjs`.
- **Hangt af van**: W2 voor het vak `uitlijn` (zonder: grijs vak). Raakt `lagen.js` NIET (openen gaat via
  de bestaande `layer.*`-actions over de bus).
- **Acceptatie**: model: weigert `verberg`, een mapje zonder kiesknop na `rondgang`, > 8 delen, een
  onbekend apparaat (waarschuwing); elk voorbeeld normaliseert zonder fout; server: PUT met oude versie =
  409, `.versies` groeit, naam met hoofdletter = 400, stand met `werkruimte` valideert. Engine+bus:
  `werkruimte.deel.3` zet `lagen.actief()` op precies de mapjes van dat deel en emit één `change`;
  de beginstand van het log bevat het deel niet (sessietoestand, zoals mapjes). Headless: `paneel.html`
  via opener; een klik op een `vrij`-knop verandert de read in de mixer binnen één beeld; loslaten gaat
  naar dezelfde action ook na een deelwissel tussendoor; de mixer zelf laadt nooit `src/paneel/`
  (importboomtest); `paneel.html` maakt geen AudioContext en vraagt geen MIDI (test zoals
  `regels-companion`).
- **Risico**: index.html krijgt één element erbij (rijen.mjs en bovenbalk-tests nalopen); het paneel heeft
  een eigen kleine renderer naast `controls.js` (twee implementaties van "indrukken/loslaten": dezelfde
  test op beide).

### W4 Mapjes, houd-mapjes en fragmenten (APC + Maschine)
- **Wat**: `voegMapjeToe(groep, laag, def)` als generalisatie van `voegVormMapjeToe`, de groep `houd`
  (vooraan in de zoekvolgorde, `houd: true`: open zolang vastgehouden), fragmenten laden en per bron
  vervangen of weghalen bij een werkruimtewissel (`Mapping.haalWeg(bron)`, nieuw, drie regels), de
  fragmenten van §3.4, pagina Uitlijn en het wiel via de mapping in `maschine.js` (in `lagen()` komt `bladeren` vóór `pagina.*`, zodat ENTER met de library open blijft laden; vandaag overlappen die twee nergens, dus de volgorde verandert niets aan bestaande regels), padmodus en pagina zetten
  vanuit een deel (`maschine.zetPagina`, `zetPadmodus`), beschrijvingen.
- **Bestanden**: `src/control/lagen.js`, `src/control/mapping.js` (`haalWeg`, `kind: fragment`, `mapjes`
  lezen), `src/control/maschine.js` (`PAGINAS` + Uitlijn, `lagen()` met de gedeelde `houd.*`, wiel),
  `src/ui/midi-opzet.js` en `src/ui/speelapparaten.js` (fragmenten laden), `src/ui/maschine-kaart-plan.js`
  (`PAGINAS`/`PADMODI`), `mappings/werkruimte/*.json`, `src/ui/apc-beschrijf.js`, `test/werkruimte-mapping.test.mjs`,
  aanvullingen in `test/mapping.test.mjs`, `test/maschine.test.mjs`, `test/spiegel.test.mjs`.
- **Hangt af van**: samenvoeging van `afmaken/controller-invoer` en `-uitvoer` (zelfde bestanden; hun cache
  in `kies()` sleutelt op de lijst open mapjes, dus een houd-mapje maakt hem vanzelf ongeldig: toetsen);
  W1 (actions bestaan), W3 (deel toepassen), W5 (drukvarianten).
- **Acceptatie**: elke fragmentregel valt op een sleutel die in de standaard vrij is (de test leest
  `apc40mk2.json` en `maschine-mk2.json`: 0 botsingen); de standaard is bit voor bit ongewijzigd
  (`eerder.mjs` niet nodig, mapping.test groen); met fragment = 702 + 84 regels, zonder = 702; Clay's
  echte verschil (4 regels) laadt en wint; met nep-poorten: SOLO vast + Maschine-knop 2 → `stem.drums`
  verandert, los → knop 2 doet weer de pagina; SOLO vast + een in `houd.stems` geleerde APC-knop werkt
  (over apparaten); SOLO los terwijl MUTE vastzit sluit `houd.sends` niet; poort weg terwijl SOLO vastzit
  → mapje dicht (`losgekoppeld`); ⇧ Lock opent `device.uitlijn` en de ringen gaan naar pan; wiel op pagina
  Uitlijn = `jog`, op een andere pagina het oude gedrag; ENTER op pagina Uitlijn = `bar.align`, met de library open = laden; LED-tik-tijd niet hoger dan vóór (de benchmark van
  de andere workflow, `tools/bench/feedback.mjs`, ±10 %); speellatentie pads ongewijzigd (pads gaan niet via
  de bus).
- **Risico**: twee mapjes tegelijk in `houd` (één stand per groep; de laatste wint, loslaten sluit alleen
  het eigen); `apc.html` en de handenkaart kennen de fragmenten pas na W8.

### W5 Effectcombinaties
- **Wat**: drukvarianten (`send.a/b.hold`, `fx.mix.hold`), bus-racks kiezen (`send.a/b.rack.next/prev`,
  onthouden op naam), superknoppen (`super.1–8`, `.hold`, read), log-regels (kinderen loggen, `super.*` in
  OVERSLAAN), het vak `mijn-fx` als voorbeeldindeling.
- **Bestanden**: `src/control/actions.js` (eigen blok, ander deel dan W1: samenvoegen is mechanisch),
  `src/werkruimte/superknop.js` (puur, importeert `resolveLink` uit `src/engine/rack.js`),
  `src/werkruimte/bind.js` (alleen het superknop-deel; afspraak met W3: twee aparte functies in hetzelfde
  bestand, of W5 maakt `src/werkruimte/bind-super.js`), `src/control/terugspelen.js` (OVERSLAAN),
  `src/ui/apc-beschrijf.js`, `test/superknop.test.mjs`, aanvulling in `test/effecten.test.mjs`.
- **Hangt af van**: niets voor de actions; W3 voor de superknop-definities uit het werkruimtebestand (tot
  dan uit een testbestand).
- **Acceptatie**: superknop: gouden tabel van 11 standen × 4 links gelijk aan `resolveLink` per link
  (zelfde rekenregel als een rack-macro); een opname met een superknop speelt terug met dezelfde reads op
  elk kind (± 1e-9) en zonder dubbele invokes; `send.a.hold` indrukken = 1, loslaten = de stand van vóór,
  ook als intussen de fader bewoog; rackwissel op de bus gaat via de kruisfade (de mock telt
  `CURVE_BREUK` = 0, geen disconnect met signaal); snel tien keer `send.b.rack.next` stapelt niet meer oude
  ketens dan dezelfde wissel op een track-insert (bestaand gedrag van `InsertSlot`, gemeten en vastgelegd).
- **Risico**: een superknop die faders verzet terwijl een APC-fader zijn takeover kwijtraakt (endless-
  ringen zijn veilig; faders: documenteren); CPU van rijkere bus-racks niet gemeten (meten zoals STEMS §5).

### W6 Mapping per apparaat (opslag, verschil, learn op Maschine en Xboard)
- **Wat**: `GET/POST/DELETE /api/mapping/<apparaat>` (de oude `/api/mapping` blijft de APC, dezelfde
  sleutel `mapping`, dus Clay's verschil verhuist niet); `laadEigen` per apparaat; Maschine en Xboard laden
  standaard + verschil in plaats van alleen `fetch`; `midi-learn` krijgt per bron de juiste Mapping.
- **Bestanden**: `server/index.js` (route), `src/ui/mapping-opslag.js` (apparaat als argument),
  `src/ui/speelapparaten.js`, `src/ui/instrument-paneel.js`, `src/control/midi-learn.js`,
  `src/ui/learn-mode.js`, `test/mapping-opslag.test.mjs` (aanvulling), `test/learn.test.mjs` (aanvulling).
- **Hangt af van**: samenvoeging van de controller-workflow (`midi-opzet.js`, `maschine.js`, `hub.js`).
- **Acceptatie**: met een nep-server die net zo streng is als de echte: het APC-verschil laadt en bewaart
  onder `mapping` zoals vóór (byte-gelijk); een geleerde Maschine-regel komt in `mapping:maschine-mk2` als
  verschil, overleeft herladen, en "standaard herstellen" op de Maschine raakt de APC niet; learn op de
  nep-Maschine-poort (hub-nep) schrijft in de Maschine-mapping, nooit in de APC-mapping; een
  speelapparaat wordt nog steeds nooit "de controller" (`isSpeelapparaat`).
- **Risico**: oude volledige APC-kopieën (`verschilVanKopie`, `eerder`) moeten blijven werken (bestaande
  tests); learn op de Maschine raakt de hub-lease (alleen met focus).

### W7a iPad: lezen (live-kanaal en uitlijn op de iPad)
- **Wat**: de mixer zendt `stand`/`verschil`/`tijdlijn`/`klok`/`werkruimte` (alleen de lockhouder), de server
  geeft ze door via SSE, `paneel.html?s=ipad` toont `uitlijn` en `kaart` met het klokverschil.
- **Bestanden**: `src/ui/live-zender.js` (zoals `status-zender.js`), `server/paneel.js` (SSE-relais, nul
  dependencies), `server/index.js` (routes), `src/paneel/verbinding.js` (SSE-tak),
  `src/paneel/protocol.js` (puur), `test/paneel-server.test.mjs`, `tools/headless/paneel-ipad.mjs`.
- **Hangt af van**: W2, W3.
- **Acceptatie**: in Node: twee SSE-kijkers krijgen bij verbinden de volledige stand (≤ 16 kB) en daarna
  alleen verschillen; een `tijdlijn` per nieuwe `segId`, niet per beeld (tellen over 10 s spelen: ≤ 2
  berichten/s per deck in rust); `POST /api/paneel/van-mixer` van buiten de Mac = 403, van een tweede
  tabblad dat geen lockhouder is = genegeerd. Headless (echte Chrome, twee pagina's, de "iPad" geopend op
  `http://127.0.0.1` zonder opener): de door de iPad uitgerekende hoorbare positie ligt binnen 5 ms van
  `hoorbaar()` in de mixer (over 60 s, ook na seek, loop, rem); de iPad-pagina doet nul POST's naar de
  mixer. Echt (op Clay's iPad via Tailscale): niet hier te meten, proefpunt.
- **Risico**: `tailscale serve` en SSE (AANNAME: lange verbindingen blijven open); Safari-achtergrond
  sluit SSE (herverbinden met de laatste stand).

### W7b iPad: schrijven (alleen na Clay's ja, vraag W-V1)
- **Wat**: koppelcode, token-cookie, `/api/paneel/invoke`, `/api/paneel/naar-mixer`, witte lijst bij de
  mixer, loslaten bij wegvallen, rem, `bron: 'ipad'` in het log, tegel in de Controlekamer (aan/uit,
  gekoppelde apparaten, intrekken).
- **Bestanden**: `server/paneel.js`, `server/index.js`, `src/ui/live-zender.js` (ontvangen + uitvoeren),
  `src/paneel/verbinding.js`, `src/controle/controle.js` (tegel), `test/paneel-schrijf.test.mjs`,
  `tools/headless/paneel-ipad.mjs` (uitbreiding).
- **Hangt af van**: W7a; Clay's expliciete keuze.
- **Acceptatie**: zonder instelling 404; zonder token 401; verkeerde Origin 403; action buiten de indeling
  (na `resolveTarget`) 403 en NIET uitgevoerd (de engine-read blijft gelijk); `record.start` in een indeling
  gezet wordt toch geweigerd; loopback invoke → read in de mixer p99 < 5 ms over 1000 rondjes; SSE dicht
  terwijl een `.hold` vastzit → los binnen 1,5 s; 200 invokes/s → 429 boven 120; dezelfde `seq` twee keer =
  één invoke; het log toont `bron: 'ipad'`.
- **Risico**: de eerste schrijfweg van buiten de Mac; Safari laat soms geen cookie toe op een
  `ts.net`-naam (AANNAME, proef); de hoofdthread van de mixer kan een bericht vertragen (meten).

### W8 Kaarten, proef, docs, samenvoegen
- **Wat**: `apc.html` en `maschine.html` met een werkruimtekiezer (lezen de fragmenten en houd-mapjes mee),
  de handenkaart (`visie/handen`) met de werkruimteregels, het speellijstblok "Werkruimte" voor de
  proefavond, `docs/WERKRUIMTE.md`, `docs/VRAGEN.md` blok W-V, CLAUDE.md-sectie, samenvoegen naar main.
- **Bestanden**: `src/ui/apc-kaart.js`, `src/ui/maschine-kaart.js`, `src/controle/speellijst.js`, `docs/*`,
  `CLAUDE.md`.
- **Hangt af van**: W1–W5 (W6/W7 kunnen later).
- **Acceptatie**: `maschine-kaart.test` en de apc-kaarttest tonen voor elke fragmentregel een uitleg (geen
  lege), met en zonder werkruimte; de speellijst bevat per spoor ten minste één proefpunt met een meetbaar
  oordeel; `node test/alles.mjs` groen in `studio/integratie`.
- **Risico**: de proefachterstand (VISIE §5.4) groeit met acht sporen; daarom per spoor een proefpunt en
  pas samenvoegen naar main na de proef van W1–W4 op de APC.

### Proefpunten (per avond, zonder risico voor de set)

| avond | wat | oordeel |
|---|---|---|
| A | W1 + W2: ⇧ Lock aan via learn (Clay's eigen verschil, kan vandaag al), uitlijn.html op het tweede scherm | is de ring leesbaar als fasemeter? hoor je een duw van 1 ms? klopt "muziek Δ" met je oor? |
| B | W3 + W5: delen wisselen met ⇧ ◀ ▶ en de strook; worpen met `send.a.hold` op een vrije pad | onthoud je wat er open staat? is de dub-worp wat je wilde? |
| C (hub-avond) | W4: houd-knoppen op de Maschine, F1–F8, pagina Uitlijn, wiel | voelen SOLO/MUTE/NOTE REPEAT als houd-knop logisch? |
| D | W7a: iPad naast de Mac met de uitlijnweergave | loopt hij in de pas met wat je hoort? |

---

## 10. Toets aan de drie regels, het audiopad en VISIE §5

| | hoe |
|---|---|
| **regel 1** | engine krijgt alleen een alleen-lezen getter (`tijdlijn()`) en een getal (`bend`-sterkte); werkruimte, paneel, uitlijn, superknop staan buiten `src/engine/` en importeren alleen pure modules (`rack.js` `resolveLink`, `beatgrid.js`, `stream-kern.js` `positieIn`); `regels.test` krijgt `src/werkruimte/`, `src/paneel/`, `src/uitlijn/` erbij (geen `ui/`-import vanuit pure delen, geen DOM in `reken.js`, `model.js`, `protocol.js`, `superknop.js`) |
| **regel 2** | alle nieuwe values 0..1: `phase.offset` (fractie van een tel + 0,5), `.fine`, `jog` (middenknop), `bend.amount`, `super.K`; alle schaling (ms, tellen, %) in de action/engine; triggers boolean (`.hold`, `layer.houd.*`, `werkruimte.deel.*`, `bar.align`). Geen nieuwe action-soort |
| **regel 3** | uitlijn en iPad rekenen uit segmenten op de audioklok (`positieIn`, `getOutputTimestamp`, klokverschil); de samenvoegtimer zegt alleen WANNEER; superknoppen glijden via de bestaande `.glide`/macro-glijden, geen eigen teller |
| **audiopad** | geen worklet, geen segmentveld, geen node; `renderblok.test` gouden hash en 0 GC als acceptatie van W1 en W2; busrackwissels via de bestaande kruisfade |
| **§5.1 pijlers** | 1 dj'en (precisie, uitlijnen, worpen, verdeling), 2 produceren (Maschine-pagina's, houd-mapjes bij spelen), 3 programmeren (Claude schrijft werkruimtes en superknoppen als data), 4 zelf instellen (dit hele ontwerp) |
| **§5.2 draagbaar** | niets erbij in de tas; de iPad is optioneel; `apc-alleen` is volwaardig zonder hub; SSE zonder dependency |
| **§5.3 zonder code** | fragmenten, mapjes, delen, indelingen, superknoppen, houd-mapjes: data; learn op alle apparaten (W6). Code blijft: het toetsenbord (later), padmodi zelf (rekenwerk), het paneelregister |
| **§5.4 geproefd** | niets verandert aan wat Clay al kent (standaard ongewijzigd); per spoor een proefpunt; samenvoegen naar main na de proef |
| **crossover / standen** | een werkruimte verbergt niets; elk mapje houdt een kiesknop (test); een stand noemt alleen de werkruimte |
| **één tabblad** | paneel- en uitlijnpagina openen nooit MIDI of audio; de server voert alleen door naar de lockhouder |

---

## 11. Vragen voor Clay (voorstel blok W-V in `docs/VRAGEN.md`)

1. **W-V1** Mag de iPad iets in de mixer zetten (W7b), of eerst alleen kijken (W7a)? Het is de eerste
   schrijfweg van buiten de Mac.
2. **W-V2** De rolverdeling "APC = mixer en zaal, Maschine = focus-track in detail": klopt die met hoe je
   speelt? Mogen sampler, patronen en secties in `twee-handen` uit de ▲ ▼-rondgang van de APC?
3. **W-V3** Strip-knop 8 is fx 1 op de APC en filter op de Maschine. Gelijktrekken (een standaardregel
   verandert) of zo laten?
4. **W-V4** Sync die blijft (de maatgever volgen bij een tempowissel in zijn kaart), of juist niet?
5. **W-V5** Combinatie: vooral worpen tegelijk (fx-grid, F1–F8), of één knop die veel doet (superknop)?
6. **W-V6** Wil je vrije routing, extra bussen of een effect per stem? Zo ja: welk concreet geval mis je nu?
7. **W-V7** Welke delen gebruik je echt? Het voorstel heeft er zeven; minder is makkelijker te onthouden.
8. **W-V8** Werkruimte wisselen alleen vanaf het scherm (voorstel), of ook vanaf een controller?

## 12. Aannames (kunnen verkeerd zijn)

- De pan-ring van de APC is leesbaar als fasemeter (15 LED's); een duw van ~1 ms met 4 ms overvloei is
  niet hoorbaar; met keylock stapelen samengevoegde duwen niet op.
- Het masterwiel komt als `relative-2c` ±1 binnen zoals de draaiknoppen (het profiel zegt "relatief, ±1 per
  klik").
- De andere workflow verandert de semantiek van `kies()` en `actief()` niet, alleen de snelheid (hun diff
  leest zo).
- `tailscale serve` houdt SSE-verbindingen open; Safari bewaart een `Secure`-cookie op de `ts.net`-naam.
- Touch op de iPad 30–60 ms, wifi + WireGuard 5–30 ms: niet gemeten.
- Een tweede venster (`uitlijn.html`) in paginavorm kost de mixer minder dan één beeld per seconde: alleen
  in software-rendering verhoudingsgewijs gemeten.
- De houd-knoppen op de Maschine (SOLO, MUTE, NOTE REPEAT, SELECT) sturen noot aan/uit bij indrukken en
  loslaten (het profiel noemt alle 48 knoppen noten op kanaal 1).
