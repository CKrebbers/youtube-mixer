# Verkenning "controllers": hoe de knoppen nu verdeeld zijn, en wat "logisch voor twee controllers" vraagt

*13 okt 2026 · verkenner controllers · alleen gelezen: `youtube-mixer` op `studio/afmaken` (339310b),
`origin/visie/handen` (docs/HANDEN.md, de handenkaart met de top-40 uit 27 handelingenlogs), de hub
(`/home/user/ckrebbers/av-app-hub`, 95ae5aa). Niets in de repo gewijzigd.*

Clay (13 okt), punt 1 en 6: "een betere manier om alle knoppen te verdelen die het veel logischer maakt
om de twee controllers te gebruiken" en "meer vrijheid over welke knoppen ik voor wat gebruik … per
onderdeel van de mix een andere werkruimte". Deze notitie is de feitenbasis daarvoor; de punten 2–5
(iPad, precisie, alle tracks zien, effecten) raak ik alleen waar ze op de handen landen.

---

## 1. Wie bezit welk apparaat (de hub bepaalt de grenzen)

| Apparaat | Zonder hub | Met `?hub=` (AV-app-hub) | Wie beslist | Terug naar het apparaat |
|---|---|---|---|---|
| **APC40 mkII** | Web MIDI, "de controller" (één poort, `midi.js` inputId; Web Lock: één tabblad) | **lease**: ruwe MIDI zolang Varve APC-focus heeft; **Bank (0x67) = hubtoets**, komt nooit aan (PROTOCOL §5) | hub-focus (Bank + Track Select) | LED's via Varve (`feedback.js`, leest de mapping) |
| **Maschine MK2** | **kan niet** (USB-HID, alleen de hub opent hem) | virtuele MIDI op eigen nep-poort "Maschine MK2 (hub)" (`speelt` in het manifest) | hub: de app met APC-focus die hem in `speelt` heeft, anders de laatst gefocuste (PROTOCOL §17) | lampjes + 2 schermen, in **code** (`maschine.js`) |
| **Xboard49** | Web MIDI, elke ingang behalve "de controller" → `noten.js` | eigen nep-poort "Xboard49 (hub)" → `noten.koppel` | idem §17 | niets (het keyboard ontvangt niets) |
| **LPD8** | niet in Varve | **altijd globaal**, nooit als MIDI naar een lease-app; K1–K8 = rollen (`macro.*`), P1 paniek, P2–P8 van de hub | hub; pickup volgt de EERSTE app met die rol | — |
| **Toetsenbord** | `keyboard.js`, KEYMAP in **code** | idem | — | — |

Gevolgen die elke herverdeling erven:
- De Maschine bestaat in Varve alleen met de hub. Een werkruimte "APC + Maschine" ís dus altijd K2 uit
  HANDEN §3 (hub nodig, nul keer geproefd).
- De hub verdeelt per APPARAAT over APPS (sets, focus, `speelt`), niet per functie binnen Varve. Een
  "werkruimte per onderdeel van de mix" is dus volledig Varve's zaak; de hub hoeft niets te weten.
- LPD8-knoppen zijn géén Varve-knoppen maar rollen: Varve gebruikt er drie (K2 `video.master`, K4
  `video.pulse`, P1 `video.black.hold`; `src/control/hub.js:134-135`). K1 bewust niet (dip 0,80 → 0,43
  doordat de pickup de eerste app met de rol volgt; VRAGEN O1).

## 2. Hoe de mapping als DATA werkt (en waar het ophoudt data te zijn)

**Wel data:**
- Regel = `{ in: "type:kanaal:nummer", action, mode, label, shift?, laag?, step?, led? }`
  (`mappings/*.json`). Sleutel `sig[#shift][@laag]` (`src/control/mapping.js:62`), dus één knop heeft
  meerdere regels.
- `kies()` (`mapping.js:573`): met shift eerst shift-regels, dan gewone; binnen elk eerst de open mapjes
  (in de volgorde edit → device → grid), dan zonder mapje; exacte sig vóór wildcard `cc:*:N`. Loslaten
  gaat altijd naar de action van het indrukken (`vast`).
- Modi: `trigger`, `absolute` (soft-takeover), `relative-2c`, `relative-bin`, `endless` (APC-ringen),
  plus `step` per regel (tempo 0,1%/tik, grid-bpm ±0,01).
- Variabelen (`resolveTarget`, `mapping.js:65`): APC alleen `{focus}` (`src/ui/midi-opzet.js:51-56`);
  Maschine `{focus}`, `{speel}`, `{plek}` (`src/control/maschine.js:203-205`); Xboard `{speel}`
  (`src/control/noten.js:75`); toetsenbord `{L}`/`{R}` (eigen mechanisme, `keyboard.js`).
- Eigen mapping = VERSCHIL met de standaard (`{kind:'diff', device, base, rules, removed}`), met de
  voorgangers in `eerder` (vingerafdrukken) zodat een oude kopie tegen de juiste standaard afgezet wordt.
  Clay's verschil: 4 regels (cc:0:20–23 in `device.rack`, video-effecten).
- Fragmenten (`Mapping.voegToe`, `mapping.js:492`): regels erbij die niet van jou worden (vormen).
- Learn (`midi-learn.js`, `learn-mode.js`): action kiezen, control bewegen; de regel komt in het mapje
  dat open staat en met shift in de shift-laag (`set()`, `mapping.js:535`). Modus wordt geraden.
- Een **stand/opstelling** (`docs/STANDEN.md`) kan een mapping zetten, maar alleen voor `apc40mk2` en
  pas bij de volgende start van de mixer.

**Geen data (code), en daarom geen "complete vrijheid":**
1. **Welke mapjes er bestaan** staat in `src/control/lagen.js:77` (`GROEPEN`: edit/device/grid, de
   negen grid-modi, `volgorde`), `OP_AANVRAAG` (r. 108), `LAAGNAAM`. Een nieuw mapje = code + `layer.*`-
   actions. `voegVormMapjeToe()` (r. 100) muteert zelfs de globale GROEPEN.
2. **De Maschine is grotendeels code**: padmodi (spelen/STEP/SCENE/SAMPLING/PATTERN), het wiel, ◄ ►
   (pagina's, `PAGINAS`), CONTROL-uitleg, lampjes, schermen: `maschine.js` (935 r.). Alleen draaiknoppen,
   groepen, transport en een paar knoppen staan in `mappings/maschine-mk2.json` (73 regels). Pads hebben
   géén mappingregels.
3. **Drie losse Mapping-instanties**, maar alleen de hoofdmapping (APC) heeft learn, verschil en opslag.
   Maschine en Xboard laden het standaardbestand met `fetch` (`ui/speelapparaten.js:30`,
   `ui/instrument-paneel.js:57`); hun berichten komen nooit bij `midi-learn`. Koppelen op de Maschine
   kan dus NIET zonder code. (MASCHINE.md §5f zegt "koppelen met learn" voor `sampler.N.drums` op de
   Maschine: dat werkt alleen als die knop via de hoofdmapping loopt, wat hij niet doet. Aanname/check.)
4. **Eén eigen mapping op de server**: sleutel `mapping` (`server/index.js:1585-1593`),
   `STANDAARD_APPARAAT = 'apc40mk2'` (`ui/mapping-opslag.js:20`). Geen mapping per apparaat, geen
   meerdere bewaarde mappings per situatie.
5. **Eén "controller"-poort** (`midi.js`): elke andere ingang is een notenbron. Twee
   class-compliant controllers naast elkaar zonder hub (bv. APC + een tweede knoppenbak) kan niet.
6. **Toetsenbord** = `KEYMAP`/`SHIFT_TOETS` in code (`keyboard.js:12, 74`), plus hard gecodeerd Space,
   `[`/`]`, `/`, Cmd+Z. Niet te koppelen.
7. **LED's en scherm-spiegel** zijn APC-specifiek: `feedback.js` leest de hoofdmapping, `spiegel-plan.js`
   leest `apc40mk2.json` als de geladen mapping niet voor een APC is.

## 3. Wat zit waar (samengevat; volledig in HANDEN §4 op `visie/handen`)

### APC40 mkII (702 regels, 145 signatures; + 14 in het fragment vorm)
- **Kern per kolom** (nooit in een mapje): trackknop = filter, fader, Clip Stop = loop (⇧ loop weg),
  Track Select = focus (⇧ tweede track), 2×2: play (⇧ op de maat), S = sync (⇧ tap), A|B = kant,
  ● = PFL (⇧ cue). Rechts: masterfader, crossfader, Cue Level = koptelefoon (⇧ mix), tempo-encoder
  (⇧ fijn), Tap (⇧ keylock), Nudge ± = bend (⇧ toon ±1), Bank ◀ ▶ = beatjump (⇧ lengte),
  Pan/Sends/User = loop in/out/reloop, Lock = quantize, Stop All = rem, Play, Record (⇧ stop),
  Session = samplerlengte (⇧ opnamesoort), Metronome = xfadercurve (⇧ grid-modus), pijlen ◀ ▶ = focus,
  ▲ ▼ = grid-modus, master-knop = beeld zwart.
- **Device knobs** (8 endless) per mapje: strip (trim/hoog/mid/laag/echo/galm/fx-mix/fx1) · rack
  (fx 1–8) · inst (alleen met instrument) · master (⇧ Clip/Device View) · beeld (⇧ Detail View) · vorm
  (Detail View, `?vormen=1`).
- **Grid 5×8**, negen modi: hotcues · loops · sampler · video (scene 1–4) en secties · patronen ·
  stems · auto · klank (⇧ scene 1–5), ▲ ▼ rondlopend. Plus de grid-modus (beatgrid bewerken) als
  schakelaar op ⇧ Metronome, die scene, nudge, Cue Level en Lock overneemt.
- Regels per mapje: kern 96 + 57 met shift; edit 25; device.* 53; grid.* 437 (hotcues 72, klank 65,
  patronen 87, secties 81, stems 81, loops 40, sampler 26, video 13, auto 6).

### Maschine MK2 (alleen via de hub; 27 van 48 knoppen in gebruik)
Groep A–H = focus · draaiknoppen = instrument van de **speeltrack** (pagina Instrument) of strip/rack van
de **focus-track** (pagina's, ◄ ► links boven) · pads = noten naar de speeltrack, of STEP (stappen),
SCENE (secties focus-track), SAMPLING (sampler), PATTERN vast + pad (plek kiezen) · PLAY/RESTART/REC/
ERASE = patroon van de speeltrack · BROWSE = library, wiel bladert, ENTER laadt op de focus-track ·
wiel zonder library = instrument kiezen · CONTROL vast = uitleg.

### Xboard49 (17 regels, CC's zijn een AANNAME)
Toetsen/pedaal/bend/aftertouch → speeltrack (noten.js); knop 1–8 = instrument, knop 9–16 = **fx van de
speeltrack**, schuif (SysEx Master Volume) = fader van de speeltrack.

### Toetsenbord (code)
Linkerhand = focus `{L}`, rechterhand = vorige focus `{R}`: play, cue, rem, hotcue 1–4, loops 1/2/4/8 +
exit, nudge 50 ms, focus, beatjump, loop in/out, keylock; ⇧ = wissen / op de maat / lengte / reloop /
toon / sectie ±. 6 = quantize, Space = play focus, `[` `]` crossfader, B = library, Cmd+Z = grid terug.

## 4. Wat zit DUBBEL (en of dat erg is)

| Functie | Plekken | Oordeel |
|---|---|---|
| focus | APC Track Select 1–8, APC pijlen ◀ ▶ (`focus.next/prev`), Maschine groep A–H, toetsen E/I | goed: elk apparaat kan de focus zetten; maar de pijlen ◀ ▶ zijn met 8 Track Selects grotendeels overbodig |
| loop weg | APC scene 5, ⇧ Clip Stop per kolom, grid.klank scene 5, toets 5/− | bewust (snel kwijt) |
| play | APC activator per kolom én Play (focus), Space, Q/P | ok |
| brake | Stop All (focus), grid.klank rij 4 per kolom, ` / = | ok, maar Stop All is ook patronen-stop en beeld-paniek (drie betekenissen op één knop) |
| strip van de focus-track | APC device.strip én Maschine pagina Strip | **met een andere indeling**: APC knop 8 = fx 1 (filter zit op de trackknop), Maschine knop 8 = filter |
| rack fx 1–8 | APC device.rack (`{focus}`), Maschine pagina Rack (`{focus}`), Xboard 9–16 (**`{speel}`**) | **zelfde knopplek, andere track** per apparaat |
| instrumentknoppen | APC device.inst (`{focus}`, alleen als focus een instrument heeft), Maschine (`{speel}`), Xboard 1–8 (`{speel}`) | meestal dezelfde track, maar niet per se |
| sampler | APC grid.sampler (rij 1 pads, rij 2 leeg, rij 3 sectie, linksonder lengte; volume = ⇧ Cue Level) en Maschine SAMPLING (boven 8 pads, onder sectie, ⇧ = leeg; ◄ ► lengte; knop 5 volume) | **twee verschillende indelingen** voor hetzelfde ding; leegmaken = een rij op de APC, shift op de Maschine |
| secties | APC grid.secties (40 pads, ⇧ = als loop), Maschine SCENE (16 pads, ⇧ niets), ⇧ W/E/I/O | Maschine mist "als loop" |
| patronen | APC grid.patronen (pad = plek × track, scene = rij), Maschine PATTERN+pad / PLAY / RESTART | twee denkwijzen (Ableton-clips vs. Maschine-transport) |
| beeld zwart | APC master-knop (aan/uit), APC grid.video pad 8 (vasthouden) en 7/2 (aan/uit), LPD8 P1 (vasthouden) | bewust: noodknop overal |
| samplerlengte | APC Session, APC grid.sampler pad 1/5, Maschine ◄ ► in SAMPLING | drie plekken |
| tempo | APC tempo-encoder (`track.N.tempo`), scherm pitchfader (`track.N.pitch`) | twee actions voor bijna hetzelfde |

## 5. Wat is ONLOGISCH verdeeld

1. **Vier soorten "welke track"**: `{focus}` (APC rechts, Maschine Strip/Rack/secties/sampler/laden),
   `{speel}` (Maschine pads/draaiknoppen op Instrument, Xboard, patroontransport), kolom = track (APC
   links, grid-modi klank/stems/hotcues/loops/patronen), `{L}/{R}` (toetsen). Op de Maschine wisselt
   binnen één apparaat het doel per pagina: Instrument = speeltrack, Strip = focus-track. Groep A–H zet
   de focus; of de speeltrack meeverhuist hangt ervan af of die track een instrument heeft.
2. **Shift betekent per apparaat iets anders**: APC = tweede functie (cue, tap, wissen, op de maat,
   modus kiezen); Maschine = fijn draaien / meteen / korter-langer / leegmaken; toetsen = wissen / op de
   maat / lengte / sectie. Hotcue-wissen (APC ⇧ pad) en sampler-leeg (Maschine ⇧ pad, APC rij 2) zijn
   hetzelfde gebaar in een andere vorm.
3. **Mapjes om te onthouden op de APC**: 9 grid-modi, waarvan 5 alleen via ⇧ scene (de modusknop doet
   dan iets anders dan zijn opschrift), plus de grid-modus (⇧ Metronome) die scene/nudge/Cue Level/Lock
   omzet, plus 6 device-mapjes (strip/rack/inst onder één knop, master en beeld onder ⇧ van twee andere
   knoppen, vorm achter een vlag). Elke modus is er "bij gekomen zonder bestaande regels te veranderen":
   de indeling is een aanbouw, geen ontwerp.
4. **Scene-knoppen hebben vijf betekenissen**: modus kiezen, rij van patronen (in patronen), regie van de
   Stroommachine (in beeld, wint in elke grid-modus), grid bewerken (in edit), en "lampje = modus" (in
   klank/auto/stems branden ze de kleur van een andere modus).
5. **Stop All Clips**: rem (kern), alle patronen stoppen (in patronen), paniek beeld (in beeld). Een
   noodgebaar dat per modus iets anders stopt.
6. **De Maschine dupliceert de APC-performance-modi** (sampler, secties, patronen) met een eigen
   indeling, in plaats van de APC te ontlasten. Met beide aangesloten zit dezelfde functie op twee
   plekken die net anders werken, en de APC houdt zijn volle grid-modi.
7. **Wat Clay het meest met de MUIS doet heeft geen knop** (top-40 uit 62.282 handelingen, HANDEN §4):
   `video.fx.pixel` (1.117), `trails` (596), `grain` (490), `mirror` (369), `rgb` (257), `color` (239)
   alleen als drukvariant in grid.video; `track.N.xfade.thru` (1.306) alleen via rondlopen A|B;
   `track.N.pitch` (658) niet (de APC heeft `tempo`); stems (`stem.drums` 248, `stem.drums.send.b` 220,
   `stem.other` 216) geen knoppen voor filter/sends; `klankschaal.veld.K` (426) geen; `track.N.seek`
   (154) alleen klikken. En `video.layer.knob.K` (5.799, nr. 3!) alleen achter `?vormen=1`.

## 6. Functies zonder knop (relevant voor Clay's punten 3–5)

- **Precisie (punt 3)**: er is GEEN jog/scrub op een controller. Wat er is: bend (APC Nudge, 4% zolang
  je drukt), tempo-encoder 0,1%/0,01%, beatjump (1–32 tellen), grid ±5/±1 ms alleen in de grid-modus,
  nudge 50 ms alleen op het toetsenbord, `track.N.seek` (0..1 over het hele nummer: met `step` 1/127 is
  dat bij 6 min ~2,8 s per tik; het wiel van de Maschine bladert of kiest instrumenten). Korte beatloops
  (¼, ½) en beatjump < 1 tel: niet op de APC.
- **Alle tracks zien (punt 4)**: geen controllerkant nodig, maar: de lampjes kunnen al op de tel knipperen
  (`track.N.phase`), Track Select van de maatgever knippert omgekeerd. Een "fase-vergelijk"-weergave op
  pads of op de Maschine-schermen bestaat niet.
- **Effecten (punt 5)**: per track is er één insert-rack (8 plekken, macro's) + 2 sends; master-rack;
  stems: filter/echo/galm per stem zonder knop; `*.knob.K.hold` (drukvariant, 10 actions) heeft geen
  knop; `send.*.knob.K` (rack van de busen, 8) geen; `*.fx.next` (los effect wisselen) geen. "Alle
  combinatieknoppen die ik kan bedenken" botst op: één knop = één action (geen combinatie/chord-regels,
  geen "knop A vast + knop B" behalve shift en mapjes), en een macro is per rack, niet per gebaar.
- **Bewust zonder knop** (HANDEN): `track.N.key*` (T6), `*.glide` (auto-DJ), `log.*`, `broadcast.toggle`.

## 7. Vrije knoppen (feiten uit de standaard)

- **APC zonder enige regel**: Bank (zonder hub; met hub de hubtoets), footswitch (`cc:0:64`).
  Detail View zonder shift (bezet met `?vormen=1`).
- **APC ⇧ + knop vrij** (23): A|B 1–8, Device ◀ ▶, On/Off, Lock, master-knop, Stop All, Pan, Sends,
  User, Play, ▲ ▼ ◀ ▶, footswitch.
- **APC pads vrij per modus**: auto 35, video 28, sampler 15 (rij 4 heel = voorstel `sampler.N.drums`).
- **Maschine vrij** (21): F1–F8, ALL, AUTO, VOLUME, SWING, TEMPO, NOTE REPEAT, GRID, PAD MODE, NAVIGATE,
  DUPLICATE (voorstel `sampler.N.drums`), SELECT, SOLO, MUTE. Het masterwiel is "vrij" zodra de library
  dicht is en je geen instrument kiest.
- **LPD8 vrij voor Varve**: K1 (bewust niet, O1), K3, K5, K6, K7, K8 — maar dat zijn rollen die andere
  apps ook lezen; P2–P8 zijn van de hub.
- **Xboard**: niets vrij (CC's onbevestigd).

## 8. Wat "logisch voor twee controllers" zou kunnen betekenen

**Rolverdeling (voorstel, niet besloten; toetsen aan de proef):**

| | APC40 mkII = **de mixer en de zaal** | Maschine MK2 = **de focus-track in detail, spelen en bladeren** |
|---|---|---|
| per track | kolom: fader, filter, play, sync, kant, PFL, loop | — (A–H kiest welke track de Maschine bedient) |
| focus-track | blijft (device knobs strip/rack) | **precisie**: wiel = jog in tellen/ms, ⇧ wiel fijn; TEMPO + wiel = tempo; SWING/NOTE REPEAT als modifiers; beatjump ◄ ► |
| grid / pads | hotcues · loops · klank · stems · video (performance per kolom, alle tracks tegelijk) | secties · sampler · patronen/stappen · spelen (één track, 16 pads + scherm) |
| effecten | strip, rack-knoppen | rack per plek met naam en eenheid op het scherm; F1–F8 = effecten met druk (`*.knob.K.hold`), SOLO/MUTE = stem-kill of bypass |
| library | — | BROWSE/wiel/ENTER (bestaat al) |
| beeld | master-knop zwart, mapje beeld | — (of: LPD8 voor `video.fx.*`, de meestgebruikte zonder knop) |

Consequentie: met de Maschine erbij hoeven de APC-modi secties/sampler/patronen niet meer onder ⇧ scene
te zitten; die plekken komen vrij voor wat nu alleen met de muis kan (video-fx, stems, xfade.thru). Zonder
Maschine (K1, "APC alleen") moet de APC alles blijven kunnen. Dat is precies het argument voor
**werkruimtes**: dezelfde knop doet in "APC alleen" iets anders dan in "APC + Maschine".

## 9. Wat dat technisch van de mappinglaag vraagt

1. **Mapping per apparaat, bewaard per apparaat**: `/api/mapping/<device>` (of een sleutel per device)
   in plaats van één `mapping`; `laadEigen`/verschil per device. Maschine en Xboard door dezelfde
   opslag-en-verschilroute als de APC (nu alleen `fetch` van de standaard).
2. **Learn voor elk apparaat**: Maschine- en Xboard-berichten (eigen nep-poorten) naar een MidiLearn
   die in hún Mapping schrijft. Nu bereiken ze `midi-learn` nooit.
3. **Mapjes als data**: `GROEPEN`/`volgorde`/`OP_AANVRAAG`/`LAAGNAAM` uit `lagen.js` naar het
   mappingdocument (bv. `"mapjes": { "grid": { "volgorde": [...], "kleur": ... } }`), met de `layer.*`-
   actions afgeleid uit de data. Zonder dit is "een eigen mapje voor mijn effecten" code.
4. **Padmodi van de Maschine als mapjes in de mapping**: pads als regels (`note:0:36@padmodus.secties`),
   met "lees"-regels voor de lampjes (zoals `led.lees` op de APC). Het rekenwerk (blad, sectie K +
   16·b) blijft code, maar dan als variabele (`{blad}`, `{sectie}`), niet als vaste afhandeling.
5. **Eén woordenschat voor "welke track"**: `{focus}`, `{speel}`, `{tweede}` (= `{R}`), `{plek}` op alle
   apparaten en het toetsenbord; het toetsenbord als device `keyboard` met signatures `key:KeyQ`.
6. **Werkruimte = data die per apparaat een mapping (standaard + verschil) en per "onderdeel" de
   beginmapjes kiest**, bv. `{ apparaten: { apc40mk2: "apc-met-maschine", "maschine-mk2": "dj-precisie" },
   bij: [{ als: "focus.instrument", mapjes: { device: "inst" } }, { als: "focus.nummer", ... }] }`.
   Voorlopers die al bestaan: `OP_AANVRAAG` (inst alleen met instrument), de Maschine-pagina die het
   doel wisselt, de opstellingen (`docs/STANDEN.md`) die al een mapping kunnen zetten (alleen APC, alleen
   bij de volgende start). Wisselen tijdens het spelen moet dan zonder herladen (nu herlaadt de mixer
   nooit vanzelf, en de stand werkt pas bij de volgende start).
7. **Combinaties (punt 5)**: een regel met een tweede voorwaarde (`"met": "note:1:46"` = alleen zolang
   SOLO vast zit) is een veralgemening van `shift` (één modifier per apparaat → meerdere). Over apparaten
   heen (APC-knop + Maschine-knop) vraagt een gedeelde "vast"-stand buiten de Mapping-instanties.
8. **Precisie zonder regel 2 te breken**: een jog in tellen/ms is geen 0..1-waarde. Opties: triggers
   (`track.N.jog.back/fwd` met een engine-gekozen stap, ⇧ = fijn), of een nieuwe action-soort "delta"
   waarbij de mapping alleen ±n tikken doorgeeft en de engine de eenheid kiest (tel/64, of ms). De
   tweede is netter maar is een nieuw contract op de bus. **Ontwerpkeuze, niet besloten.**
9. **LED's/scherm volgen de werkruimte**: `feedback.js` en de spiegel lezen al de mapping; de Maschine-
   lampjes moeten dat ook gaan doen in plaats van code per modus.

## 10. Toets aan VISIE §5 en de drie regels

- §5.1 pijlers: een rolverdeling dient pijler 1 (APC dj'en) én 2–3 (Maschine spelen/sequencen); pijler 4
  (zelf instellen) alleen als mapjes, padmodi en werkruimtes DATA worden (§9.3–9.6).
- §5.2 draagbaar: niets nieuws in de tas; maar "APC + Maschine" vraagt altijd de hub (K2). De APC-alleen-
  werkruimte moet volwaardig blijven.
- §5.3 zonder code: vandaag is alleen de APC-mapping zonder code aan te passen. Maschine, Xboard,
  toetsenbord, mapjes en padmodi niet.
- §5.4 geproefd: **niets** van de Maschine, de hub, de lease of de indeling van na 5 okt is op de hardware
  geproefd. Een grote herverdeling vóór de hub-middag/avond 2 bouwt op aannames.
- Regel 1: werkruimtes horen in `src/control/` en data, niet in de engine — geen probleem.
- Regel 2: zie §9.8 (jog). Combinatieknoppen en mapjes raken regel 2 niet.
- Regel 3: precisie-jog moet via deck-segmenten op de audioklok (seek met `doorlopend`), niet via een
  timer die stapjes zet.

## 11. Risico's

- `test/mapping.test.mjs`, `handen.test.mjs`, `spiegel.test.mjs`, `feedback.test.mjs`,
  `maschine-kaart.test.mjs` en de `apc-beschrijf`-eis zijn hard gekoppeld aan `apc40mk2.json` en
  `maschine-mk2.json`; `tools/mapping/eerder.mjs` na elke wijziging. Een werkruimtemodel raakt dit allemaal.
- Clay's eigen verschil (4 regels op cc:0:20–23 @device.rack) en oude volledige kopieën moeten blijven
  laden (verschilVanKopie + `eerder`); per-apparaat-opslag moet die migratie meenemen.
- Regels per werkruimte KOPIËREN laat 702 regels exploderen; werkruimtes moeten verschillen/lagen op één
  standaard zijn, niet kopieën.
- Hub: Bank is de hubtoets; de Maschine kan maar naar één app tegelijk; LPD8-rollen worden door andere
  apps ook gelezen (K1-dip). Een werkruimte mag geen LPD8-rol "pakken" die een beeld-app gebruikt.
- Twee tabbladen/Web Lock: een werkruimte-editor op de iPad mag geen tweede mixer worden (één tabblad
  praat met de APC; de iPad is companion, geen MIDI).
- Meer mapjes = meer om te onthouden: "complete vrijheid" kan het onlogischer maken. Zonder zichtbare
  kaart (apc.html, maschine.html, Maschine-schermen) per werkruimte is het onbruikbaar in het donker.
- De Maschine-pads lopen via `noten.js` (latentie gemeten 2,6–3,1 ms JS); padregels via de bus mogen
  het spelen niet vertragen. De andere workflow (lag op de controllers) meet dit nu
  (`tools/headless/latentie.mjs`, `tools/bench/feedback.mjs` in hun worktrees, ongecommit).

## 12. Kansen

- Er is al veel vrije ruimte: 21 Maschine-knoppen, 23 ⇧-plekken en 78 vrije pads op de APC, 5 LPD8-knoppen.
- Het verschilmodel, fragmenten (`voegToe`), `led.lees`, `OP_AANVRAAG` en de Maschine-pagina's als
  "open mapje" zijn de bouwstenen van werkruimtes; ze hoeven alleen naar data en per apparaat.
- De handenkaart (`visie/handen`, `tools/handen/handenkaart.mjs`) rekent al vrije plekken en de top-40
  uit de logs: een werkruimte-editor kan die als "wat doe je het meest met de muis" gebruiken.
- `apc.html`/`maschine.html` lezen al de mapping: per werkruimte een kaart is bijna gratis.
- Opstellingen (STANDEN) zijn de natuurlijke drager voor "welke werkruimte vanavond".
- De Maschine-schermen (2 × 256×64) zijn de enige plek op de hardware waar je een fase/grid-vergelijking
  van de focus-track tegen de maatgever kunt tonen (punt 4) en precisie in ms/tellen kunt aflezen (punt 3).
