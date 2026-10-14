# Verslag werkruimte S5 (14 okt 2026): elk apparaat zelf instellen

*Tak `werk/S5`, vanaf `werkruimte/integratie`. Wat er gebouwd is en de regels staan in
`docs/werkruimte/S5.md`; dit is het verslag: wat, gemeten hoe, wat niet, en hoe Clay het gebruikt.*

## Kort

Clay maakt de knoppenverdeling zelf. Dit spoor bouwt het mechaniek daarvoor, geen nieuwe
indeling:

- elk apparaat (APC, Maschine, Xboard, toetsenbord) heeft een eigen mapping;
- die bewaar je als **verschil** met de standaard, op de server en in de browser;
- je kunt op elk apparaat **koppelen**: kies het apparaat, klik een action, raak de control aan;
- het **toetsenbord is data** (`mappings/toetsen.json`): precies de oude tabel, geen nieuwe toetsen;
- er is een **Maschine-ijkproef** (`tools/proef/maschine-ijk.html`): poort M, de proef die
  bepaalt of het Maschine-werk van golf 3 klopt.

Wat niet veranderde: `mappings/apc40mk2.json`, `maschine-mk2.json` en `xboard49.json` zijn
dezelfde bestanden. Clay's APC-verschil (4 regels op cc:0:20–23 @device.rack) blijft staan
waar het staat en is byte voor byte hetzelfde. `maschine.js`, `mapping.js`, `lagen.js`,
`midi-opzet.js`, `app.js`, `index.html`, `styles.css` en `server/index.js` zijn niet aangeraakt.

## Gebouwd

| bestand | wat |
|---|---|
| `server/routes/mapping-apparaat.js` | GET/POST/DELETE `/api/mapping/<apparaat>`. De APC staat onder de oude sleutel `mapping`, de rest onder `mapping:<apparaat>`. Een document voor een ander apparaat geeft 400. Witte lijst: de ijkproef. |
| `src/ui/mapping-opslag.js` | `laadEigen`, `opzetMappingOpslag` en `bewaarEigen` per apparaat, plus `plekVan` en `opslagVan`. Zonder apparaat is het de APC, zoals vroeger. |
| `src/ui/speelapparaten.js` | de Maschine laadt standaard + verschil; koppelen met CONTROL |
| `src/ui/instrument-paneel.js` | de Xboard (elk MIDI-keyboard) laadt standaard + verschil; koppelen |
| `src/control/midi-learn.js` | `vangLeren` (leren vóór `ontvang()` van een apparaat), `maschineMagLeren`, `keyboardMagLeren`, `KEYBOARD_APPARAAT` |
| `src/ui/mapping-panel.js`, `src/ui/learn-mode.js` | de apparaatkiezer (APC · Maschine · Xboard · toetsen) in het koppelpaneel en de koppelmodus; "standaard herstellen" per apparaat; meldingen "niet te koppelen" |
| `src/control/keyboard.js` | voert een Mapping uit; HID-tabel, `toetsenStandaard()`, `toetsenbord()`, koppelen met een toets |
| `mappings/toetsen.json` | 66 regels: KEYMAP + SHIFT_TOETS, als data |
| `src/ui/aanhakers/apparaten.js` | de opslag van de toetsen, en alle apparaten in de kiezer |
| `tools/proef/maschine-ijk.html` + `.mjs` | de ijkproef en zijn headless runner (die koppelt ook in de echte mixer) |
| tests | `test/keyboard.test.mjs` (gouden, nieuw), `test/mapping-opslag.test.mjs` (echte server, nieuw), `test/learn.test.mjs` (nieuwe gevallen), `test/aanhaakpunten.test.mjs` (één check, zie onder) |

## Metingen (opnieuw te draaien)

Omgeving:

- Linux-container, Node 22.22.
- Chrome = `headless_shell` 141 via een wrapper met `--no-sandbox` (als root start hij anders niet).
- De hub komt uit `~/av-app-hub`.

```
export VARVE_HUB_REPO=~/av-app-hub
export VARVE_CHROME=<wrapper: headless_shell --no-sandbox "$@">
```

| commando | uitkomst |
|---|---|
| `node test/keyboard.test.mjs` | groen. Gouden lijst: 84 gevallen (42 toetsen, met en zonder shift), 0 verschillen; geen regel buiten KEYMAP en geen regel op een schermgebaar. Ook getoetst: typen, Cmd+F, Cmd+Z, spatie, blur, verborgen tabblad, koppelen (ook lang vasthouden), het verschil onder `mapping:toetsen`. |
| `node test/mapping-opslag.test.mjs` | groen, tegen een echte server (`VARVE_TESTSERVER=1`, tijdelijke data). Clay's verschil komt via beide routes byte voor byte terug; een oude kopie gaat via `eerder`; de Maschine-regel overleeft een serverherstart; herstellen raakt de APC niet; koppelen op Maschine of Xboard raakt de APC nooit; `isSpeelapparaat` klopt. |
| `node test/learn.test.mjs` | groen (met de nieuwe gevallen voor `vangLeren`, Maschine en keyboard) |
| `node test/mapping.test.mjs`, `engine.test.mjs` | groen, ZONDER aanpassing (de bestaande toetsentests) |
| `node test/maschine.test.mjs`, `hub.test.mjs`, `aanhaakpunten.test.mjs` | groen |
| `node tools/proef/maschine-ijk.mjs` | groen: 36 checks. Ijkproef: 73/73 "klopt", niets onverwacht, het wiel ±1, SOLO/MUTE/VOLUME aan en uit, vóór de klik geen pixels, daarna bit voor bit het testbeeld, geen requestMIDIAccess. Mixer: CONTROL+F1 geleerd onder `mapping:maschine-mk2`; blijft na herladen en een serverherstart; herstellen raakt de APC niet; F2 als toets geleerd; paneel dicht stopt het leren; APC byte voor byte. |
| `node tools/headless/speelapparaten.mjs` | groen (40 checks) |
| `node tools/headless/kijk.mjs`, `maschine-kaart.mjs`, `bladeren.mjs` | groen |
| `node tools/headless/rijen.mjs`, `knoppen.mjs` | zie "Testuitslag" |
| `node test/alles.mjs` | zie "Testuitslag" |

## Review (twee subagenten, ronde 1)

- **(b) acceptatie:** elke eis zelf nagelopen en gehaald.
  - Een eigen onafhankelijke proef: de OUDE `keyboard.js` tegen `toetsen.json`, 182 gevallen, 0 verschillen.
  - De rode tests in `alles.mjs` zijn op de basis even rood.
- **(a) correctheid:** twee bugs gevonden in het nieuwe koppelen. Beide opgelost en getoetst:
  - **B1.** Lang vasthouden tijdens het koppelen van een toets: de herhaalde keydown voerde de nieuwe action al uit, en zijn keyup werd ingeslikt. Een druk zonder los. Nu doet een net gekoppelde toets niets tot zijn keyup (`keyboard.test`).
  - **B2.** Het koppelpaneel sluiten stopte alleen het leren van de APC. Dat van de toetsen of de Xboard bleef aan, en koppelde de volgende toets stil. Nu stopt de aanhaker het ook (`maschine-ijk.mjs`).
- Kleiner, ook opgelost:
  - een oude "geslikt"-stand wordt gewist bij een nieuwe leerbeurt;
  - "niet te koppelen" meldt per draaiknop één keer per leerbeurt, niet per MIDI-bericht (anders schermwerk per bericht; `learn.test`);
  - `weigerAlleenScherm` voor de toetsen komt na alle aanhakers;
  - de dode `.catch`-meldingen zijn weg.
- Niet veranderd: twee tabbladen die allebei koppelen. Het laatste wint, net als bij de APC.

## Review ronde 2

- **B1:** bevestigd opgelost. Overgenomen: alleen een HERHAALDE keydown wordt ingeslikt. Kwam de
  keyup van het koppelen nooit (onder Cmd), dan is de volgende echte druk gewoon een druk
  (`keyboard.test`).
- **B2:** nog half open. Het MIDI-paneel gaat ook dicht via `sluitOnderpanelen` (toets B,
  library, rack-editor), en dan stopte niemand het leren. Nu kijkt een MutationObserver op de
  klasse van `#midi-panel` en de lijst. Die vuurt alleen bij openen en sluiten, niet per
  MIDI-bericht. Getoetst met toets B in `maschine-ijk.mjs`.
- **Terugval door mijn N1-fix:** `geslikt` legen bij een nieuwe leerbeurt liet het loslaten
  van een knop die je nog vasthield toch door (een los zonder druk). Teruggedraaid. De oude
  stand ruimt `vangLeren` al op bij de volgende gewone druk (`learn.test`).

## Testuitslag

- **`node test/alles.mjs`** (na ronde 2): 105 bestanden, 9255 checks, 3 rood.
  - `instrumenten-fm-schaal` ("geen afval per blok"): de bekende wisselvallige van main. Na
    ronde 1 was hij groen.
- **Na ronde 1:** 9253 checks, 2 rood.
  - `renderblok` ("keylock met wissels: 83,7 bytes per bericht") en `wachtrij` ("yt-dlp en zijn
    kind zijn allebei weg").
  - Allebei op main in deze Linux-container al rood (omgeving). Reviewer (b) draaide ze op de
    basistak met dezelfde FAILs.
  - Geen van beide raakt iets van S5.
- **Headless, met de wrapper:**
  - `speelapparaten.mjs`: groen.
  - `rijen.mjs`: 565/565 ok (745 s op software-rendering).
  - `knoppen.mjs`: groen.
  - `kijk.mjs`, `maschine-kaart.mjs`, `bladeren.mjs`: groen.
  - `tools/proef/maschine-ijk.mjs`: groen.

## Wat niet / alleen op hardware

- **De ijkproef zelf (poort M).** Headless draait hij tegen de nep-Maschine van de hub-tests, en die rust op dezelfde nummers. Groen zegt dat de pagina werkt, niet dat het profiel klopt. Dat beslist alleen Clay's echte Maschine. Ook de labels boven F1–F8 en onder de draaiknoppen kun je alleen met je ogen beoordelen.
- **De Xboard-knoppen** (CC 21–28/31–38) blijven een AANNAME in `xboard49.json`. Met koppelen kun je het nu zelf rechtzetten op wat er echt binnenkomt.
- **Een oude VOLLEDIGE APC-kopie** past niet meer in één POST: de server neemt 64 kB, een kopie van de huidige standaard is ~84 kB. Dat was al zo. Zo'n kopie komt alleen nog uit de browser, en het omzetten werkt (getest).
- **Twee tabbladen** die tegelijk koppelen: het laatste wint, zoals bij de APC.
- **Koppelen met een toets van een niet-Amerikaanse indeling.** De signature is de FYSIEKE toets (HID). Het label toont de US-naam (op een AZERTY heet de toets met een A erop "toets Q"). Op het apparaat nagaan.

## Zelf een knop koppelen en bewaren (Clay, stap voor stap)

Algemeen: wat je koppelt wordt meteen bewaard, als verschil met de standaard. Op de server
(overleeft een andere browser) en in de browser (reserve). Een nieuwe standaard komt vanzelf
binnen; jouw regels winnen.

1. Klik in de bovenbalk op **MIDI**, dan op **lijst**. Bovenaan staat **koppelen op: APC ·
   Maschine · Xboard · toetsen** (de Maschine alleen met `?hub=`). Kies het apparaat.
2. Zoek de functie in het filter (bv. `track.2.focus`) en klik **leer**. Of zet **koppelmodus**
   aan (de knop in de balk) en klik de knop op het scherm aan. De balk van de koppelmodus toont
   dezelfde apparaatknoppen.
3. Raak de control aan:
   - **APC**: zoals altijd. De regel komt in het mapje dat open staat, en met shift vast in de
     shift-laag.
   - **Maschine**: houd **CONTROL** vast en druk de knop of draai de draaiknop. Een draaiknop
     draai je daarna nog even door, zodat leren het type herkent. Zonder CONTROL gebeurt er
     niets. De pads, het wiel, SHIFT, CONTROL, de pagina- en padmodusknoppen zijn van de
     Maschine zelf: daar krijg je een melding.
   - **Xboard**: beweeg de knop of de schuif. Pedaal en modwiel horen bij het instrument.
   - **toetsen**: druk de toets, met shift erbij voor een shift-regel. Spatie, `[` `]`, `/`, Esc
     en B blijven van het scherm.
4. Klaar. De lijst toont de koppeling, en de statusregel zegt hoeveel regels van jou zijn.
   Losmaken: **wis** in de lijst, of shift-klik in de koppelmodus.
5. **Standaard herstellen** (twee keer klikken) haalt alleen de eigen regels van het GEKOZEN
   apparaat weg. De andere apparaten blijven zoals ze zijn.
6. **Exporteren** geeft een volledige mapping van het gekozen apparaat als bestand.
   **Importeren** neemt alleen een bestand voor hetzelfde apparaat (bij de APC alles, zoals
   altijd).

De ijkproef zelf: stappen in `docs/werkruimte/S5.md`, "De ijkproef doen".

## Voorbeelden (één per soort, alleen ter illustratie)

Een verschil zoals het op de server staat. Dit is een VOORBEELD; zo staat het niet in de repo.

```json
{ "kind": "diff", "version": 3, "device": "maschine-mk2", "base": "…", "top": {},
  "rules": [{ "in": "note:1:0", "action": "track.2.focus", "mode": "trigger", "label": "F1" }], "removed": [] }
```

Voor de toetsen `"device": "toetsen"` met bv. `{ "in": "key:0:59", "action": "track.3.focus",
"mode": "trigger", "label": "toets F2" }`. Voor de Xboard `"device": "xboard49"` met bv.
`{ "in": "cc:0:40", "action": "track.{speel}.fx.knob.2", "mode": "absolute" }`.

## Buiten de bestandsgrens (en waarom)

- **`test/aanhaakpunten.test.mjs` (van S0).** De check "de drie routebestanden zijn leeg" kan
  niet meer groen zijn zodra een spoor zijn stub vult. Vervangen door: elke route onder
  `/api/`, en geen witte-lijstregel die data openzet. S3 en S7 lopen hier anders ook tegenaan.
- **`tools/proef/maschine-ijk.mjs`.** Een nieuwe headless runner naast de pagina: de
  acceptatie vraagt de ijkproef headless.
- **`tools/proef/` staat in `.gitignore`** via de regel `proef/` (bedoeld voor de datamap).
  Daarom met `git add -f` toegevoegd. `.gitignore` hoort `/proef/` te zeggen; dat is aan S3.
- **`maschine.js` is NIET aangeraakt**, ook de toegestane ene regel niet. Het is niet nodig:
  `maschine.mapping` bestaat al.
- **Signature `key:0:<HID>` in plaats van `key:<code>`.** `mapping.js` (S4) neemt alleen
  `type:kanaal:nummer` aan.

## Vragen voor Clay

1. Moet koppelen op de Maschine echt alleen met CONTROL? Het voordeel: nooit per ongeluk. Het
   alternatief: elke aanraking koppelt zolang leren aan staat, zoals op de APC.
2. Wil je de pads van de Maschine ook kunnen koppelen (bv. een padmodus "knoppen")? Nu spelen
   ze altijd noten, stappen, secties of de sampler. Dat zou een wijziging aan `maschine.js` zijn
   (S6).
3. Bewaren, zoals bij de APC, voor elk tabblad apart? Of alleen vanuit het tabblad dat de APC
   heeft?

## Opties voor een volgende versie

- `key:<code>` als signature, zodra `mapping.js` het aanneemt (S4/S8). Eén omzetting in
  `toetsen.json`.
- De kiezer in de koppelmodus laten volgen welk apparaat je het laatst aanraakte (automatisch
  apparaat kiezen).
- Een voorbeeldmodus in de kaarten (`apc.html`, `maschine.html`) die je eigen verschil toont
  (S6).
- De ijkproef-JSON automatisch vergelijken met het profiel en een voorstel voor
  `devices/maschine-mk2.js` maken als er iets afwijkt.
