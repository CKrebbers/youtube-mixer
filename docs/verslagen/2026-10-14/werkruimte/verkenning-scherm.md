# Verkenning "scherm": hoe vrij is de UI nu, en hoe komen we bij een werkruimte (13 okt)

Verkenner scherm, tak `studio/afmaken` (339310b). Alleen gelezen; gemeten met een eigen proefserver op
:8899 (scratch-media, `VARVE_TESTSERVER=1`, daarna gestopt) en twee meetscripts in
`werkruimte/meet/` (`acties.mjs`, `rondje.mjs`, `relais.mjs`). Clay's punten waar dit over gaat:
2 (meerdere schermen, iPad), 4 (alle tracks tegelijk zien lopen; alleen het scherm-deel) en 6 (vrijheid
over UI en knoppen, werkruimte per onderdeel van de mix).

## 1. Hoe de UI nu in elkaar zit

**Eén pagina, vaste HTML, modules die er een stuk van overnemen.**

- `index.html` (688 regels) bevat de hele opbouw als vaste HTML: bovenbalk met 20 knoppen/links
  (r.11-47), `main.spiegel` (focus-deck, `#kolommen`, `#focusdeel`, sampler, video-paneel), daarna
  `#rijen` met 9 secties (stems, koptelefoon, instrument, patronen, master, auto, klankschaal, beeld, …),
  dan de onderpanelen (library, MIDI, rack-editor), meldingen en de helpkaart. 197 `data-action`-attributen
  en 64 `.knob`'s staan letterlijk in de HTML.
- `src/ui/app.js` maakt de engine en roept ~25 `opzet…()`-functies in een vaste volgorde aan
  (video → opname → spiegel → vensters → beeld → racks/sampler/klankschaal/hotcues → laden → stems/
  koptelefoon/master → logboek → auto/plan → onderpanelen → bovenbalk → toetsenbord → lagen/MIDI/hub →
  instrument → speelapparaten → patronen → status-zender → renderloop → bindApp). Elke module zoekt
  ZIJN vaste element op met `getElementById` (bv. `stems-paneel.js` r.33 `#stems`). Er is geen
  register van panelen; "een paneel" = een stuk HTML in index.html + een opzet-functie die het vasthoudt.
- **Layout**: CSS grid op `main` met twee kolommen (`minmax(0,1fr) 390px`, styles.css r.70), een derde
  kolom als het video-paneel open is (r.594), één kolom onder 1100 px (r.159). `#rijen` scrolt zelf
  (r.674). Geen verslepen, geen formaat, geen tweede indeling.
- **Open/dicht**: elke rij onthoudt zijn eigen stand in localStorage (`varve.stems.open`,
  `varve.master.open`, … acht sleutels, `*-paneel.js` r.6-30). Per browser, niet in een bestand.
  Onderpanelen: één tegelijk (`onderpanelen.js`), Esc sluit.
- **Renderloop** (`renderloop.js`): één rAF, elke module geeft een `teken`-stap mee (app.js
  `stappen: {…}`); `volgEngine()` leest elke frame `read(action)` voor alle knoppen en faders.

**Wat al generiek is (de goede nieuws):**

- `controls.js`: elk element met `class="knob" data-action=…` wordt een Knob, elk
  `[data-kind="button"]` een knop (`bindButtons`, r.78-105), elke `input[type=range][data-action]` een
  fader (`vensters.js` r.45). De action wordt bij het INDRUKKEN gelezen, loslaten gaat naar dezelfde.
  Dus: een knop op het scherm = een action-naam in een attribuut. Shift-variant (`data-action-shift`),
  alt = `.hold`-variant, dubbelklik = default, wiel = ±0,02: allemaal al aanwezig.
- `read()` van de bus geeft de stand terug; de renderloop volgt hem (tweede bron = MIDI werkt al).
- De **spiegel** (`spiegel.js` + `spiegel-plan.js`) is volledig data-gedreven vanuit de MAPPING:
  wat een gespiegelde knop doet komt uit `mapping.kies(sig)` + `resolveTarget` (shift, open mapje,
  `{focus}`), uitleg uit `apc-beschrijf.js`, kleur uit `soorten.js`. Verander je de mapping, dan
  verhuist het scherm mee. Maar: de PLEKKEN zijn de APC (kolommen, focusdeel); het scherm is een
  APC-kaart, geen vrije indeling.
- `resolveTarget` kent `{focus}`, `{speel}`, `{plek}` (mapping.js): dezelfde variabelen bruikbaar
  voor een vrij paneel.
- Companion: `mappings/companion.json` kiest tabs en kratten bovenaan: het enige stuk UI dat Clay
  zonder code inricht.

**Wat hard gecodeerd is (de vrijheid die ontbreekt):**

| wat | waar | gevolg voor Clay |
|---|---|---|
| welke panelen er zijn en in welke volgorde | index.html + app.js | niet te verplaatsen zonder code |
| wat er IN een rij staat (bv. de 8 master-knoppen, stems-kanalen) | index.html r.268-520 | geen eigen knoppen erbij |
| de focus-deck-inhoud (hotcues, loops, grid-tools) | index.html r.55-141 | idem |
| layout (2-3 kolommen) | styles.css r.70/594 | geen tweede indeling, geen "per onderdeel" |
| toetsenbord | `KEYMAP` in `control/keyboard.js` r.12 (tabel in code, niet JSON zoals MIDI) | toetsen niet zelf te kiezen |
| open/dicht van rijen | localStorage per browser | niet per werkruimte, niet in een stand |
| welke track een rij volgt | altijd de focus (herschrijfFocus, `vensters.js` r.61) | geen rij die vast op track 3 staat |
| binden van knoppen | één keer bij het opstarten (`vensters.js` r.40: `querySelectorAll('.knob')`), `knobs` als vaste lijst naar de renderloop | een paneel dat later verschijnt wordt niet gebonden en niet gevolgd |

**Bewaking die meespeelt**: `docs/STANDEN.md` §1 en `stand-model.js` r.55 `VERBODEN_DELEN = ['panelen',
'acties', 'pijlers', 'mapjes']`: een stand mag nooit een paneel verbergen of een action uitzetten (de
crossover, VISIE §2). Een werkruimte moet daarom anders gedefinieerd worden dan "wat er weg is": ze
zegt WAAR iets staat; alles blijft altijd bereikbaar (bovenbalk/lijst "alle panelen", de bus, de
controllers). Dat moet expliciet in het ontwerp, anders botst het met een vastgelegde regel.

## 2. De vensters en schermen die er al zijn

| pagina | rol | transport naar de mixer | richting | getest |
|---|---|---|---|---|
| `video.html` (beamer) | mengt zelf, eigen WebGL + `<video>` | `window.opener.varveBeamer` (app.js r.104), elk beeld | lezen; bus blijft bij hoofdvenster | headless (`beamer.mjs`) |
| `plan.html` | planvenster, bewerken | `window.opener.varvePlan` | lezen + knoppen over de bus van de mixer | ja |
| `maschine.html` | kaart, live | `window.opener.maschine` (alleen `?hub=`) | alleen lezen, stuurt niets | ja |
| `apc.html` | kaart | eigen Web MIDI (alleen invoer) of niets met de hub | alleen lezen | ja |
| `controle.html` (Controlekamer) | stand van alles, mixer openen | BroadcastChannel `varve-status` (controle.js r.266) + `navigator.locks.query()` (r.258), polls 2 s | alleen lezen | ja |
| `companion.html` (iPad/iPhone) | kaart, wensen, "nu" | `GET /api/mixer` 1×/s (de mixer POST hooguit 1×/900 ms, `status-zender.js`) | alleen lezen; "stuurt nooit iets naar de mixer" (COMPANION.md) | headless; mixer-post nooit live geproefd |

Patroon dat werkt: **een venster op de Mac = `window.open` + `window.opener.<api>`**, zelfde origin,
zelfde thread, nul latentie, drie keer bewezen (beamer, plan, maschine). Nadeel: zelfde hoofdthread,
dus zwaar tekenen in het tweede venster kost frames van de mixer (de audio niet: die zit in worklets);
en bij herladen van de mixer is de koppeling weg (venster moet `opener.closed` afvangen, doen ze al).

Er is **geen enkel pad waarmee een ander apparaat iets in de mixer zet.** De server heeft geen
WebSocket (alleen `node:http`, nul dependencies; `server/index.js`), `/api/mixer` schrijven mag alleen
vanaf deze Mac (`vanDezeMac`, index.js r.1641), en de companion is per ontwerp alleen-lezen.

Wel bestaat er al een tweede weg buiten VARVE: de **hub-cockpit** (`av-app-hub`, PROTOCOL §8) heeft een
virtuele APC/LPD8 (`{t:"virtueel", dev, bytes}`) en kan met `--lan` + token op een tablet
(`docs/NETWERK.md` in de hub). Via lease komt dat bij VARVE binnen als APC-invoer. Dat is "iPad als
APC-namaak", niet "iPad met VARVE-panelen", en het staat in STATUS.md van de hub nog open
(`[ ] cockpit op de tablet`). Let op: de hub zegt zelf "zet geen tunnel (tailscale serve) op 7700";
via het tailnet-IP met token kan het wel (aanname, niet geprobeerd).

Web Lock (`tabblad.js`): maar één mixer-tabblad. Een tweede scherm kan dus nooit `index.html` zijn;
het moet een pagina zonder AudioContext en zonder MIDI zijn (zoals plan.html). Via localhost én de
ts.net-naam zijn het twee origins en beschermt de lock niet (TAILSCALE.md r.105).

## 3. Gemeten in deze container

Loopback, Node 22, geen wifi en geen Tailscale (die komen er bovenop; niet meetbaar hier).

| meting | mediaan | p95 | p99 | max |
|---|---|---|---|---|
| `GET /api/mixer` op de echte VARVE-server (fetch, keep-alive), 1540 B antwoord | 0,71 ms | 1,82 | 4,15 | 7,6 |
| `POST /api/mixer` met een melding van 8 tracks (1484 B, gebouwd met de echte `maakStatus`) | 0,98 ms | 3,67 | 10,5 | 16,2 |
| WebSocket-rondje, klein bericht (46 B `{t:'invoke', id, v}`), eigen minimale server zonder deps | 0,06 ms | 0,21 | 0,90 | 18,6 |
| idem met de melding van 1484 B | 0,07 ms | 0,30 | 1,65 | 3,3 |
| **relais in twee sprongen** paneel → server → "mixer" (zet, antwoordt met de nieuwe stand) → server → paneel | **0,13 ms** | 0,33 | 0,50 | 1,3 |

Bus (`acties.mjs`, engine met de Web Audio-mock uit engine.test, alleen `bindEngine`):
**3018 actions** (2451 trigger, 567 value), waarvan 2888 per track (361 per track × 8) en 130 globaal;
521 met een `read()` die niet null is (lege decks). De hele leesbare stand als JSON = **11,3 kB**;
alle reads één keer aflopen = **0,70 ms**. Met `bindVideo/bindApp/bindAuto/...` komen er nog meer bij.

Wat dat zegt:
- De server en het protocol zijn nooit de flessenhals: een relais kost 0,1-0,5 ms. Wat telt is het
  netwerk (wifi + WireGuard: AANNAME enkele ms tot ~15 ms per richting, met uitschieters op een
  hotspot), het aanraakscherm van de iPad (AANNAME tientallen ms van vinger tot `touchstart`) en de
  hoofdthread van de mixer (een bericht wacht als de renderloop hapert).
- Een iPad-knop is dus prima voor draaien, schakelen, kiezen, laden, secties, effecten; NIET voor
  timing op de tel uit de vrije hand. Tijdkritische knoppen vanaf de iPad moeten gequantiseerde
  actions zijn (`track.N.play.quant`, secties op de "1", hotcue met quantize) — die bestaan al.
- HTTP-pollen (zoals de companion) is voor bediening te traag en te duur in richting mixer: de mixer
  zou moeten pollen om opdrachten op te halen. Push is nodig: WebSocket (of SSE + POST).
- Een volledige stand sturen kan (11 kB), maar alleen bij verbinden; daarna verschillen (zoals de
  LED-diffing in `feedback.js`). Posities NIET per frame sturen: stuur segmenten `{T, P, R}` bij
  verandering en laat de iPad zelf extrapoleren met een klokverschil (ping/pong, zoals de Stroommachine
  doet; regel 3 over een netwerkgrens, zoals al over de draadgrens in stream-kern).

## 4. Meerdere schermen: drie routes

**A. Tweede venster op de Mac (zelfde machine).** `paneel.html?w=<werkruimte>&s=<scherm>` geopend met
`window.open` vanuit de mixer, leest `window.opener.varvePanelen = { invoke, read, metaOf, beschrijf,
snapshot, on }`. Kosten: één nieuwe html in de witte lijst (`MAG`, index.js r.947), een api-object in
app.js. Latentie nul. Dit is de kleinste stap en volgt een bewezen patroon. Grens: zelfde hoofdthread.
Alternatief zonder opener (overleeft herladen van de mixer): BroadcastChannel met `{invoke}`-berichten
(asynchroon, eigen proces); kan ook, maar dan staat er voor het eerst een schrijfkanaal op 'varve-…'.

**B. iPad met echte bediening (ander apparaat).** Alleen via de server:
`iPad ─WS─> server ─WS─> mixer-tabblad (voert invoke uit) ─> server ─> iPad`.
- De server wordt alleen doorgeefluik (geen engine, regel 1 blijft); de mixer met de Web Lock is de
  enige die uitvoert (zelfde beslisser als `statusVanMij` in app.js).
- Transport: WebSocket op de VARVE-server. Nul dependencies houden kan: een minimale server-kant is
  ~80-150 regels (`node:http` upgrade, frames, ping); in `meet/rondje.mjs` staat een werkende versie van
  ~25 regels voor tekstframes < 64 kB. Of `ws` als eerste server-dependency (de hub gebruikt hem al):
  voorleggen. SSE + POST kan zonder WebSocket-code, maar is twee kanalen en één POST per draai.
  `tailscale serve` geeft WebSocket door (AANNAME, niet geprobeerd).
- Veiligheid (het belangrijkste ontwerpwerk): nu is "schrijven alleen vanaf deze Mac" de regel. Een
  bedieningskanaal verandert dat. Voorstel: (1) alleen via `VARVE_HOSTS` (tailnet, HTTPS) of localhost,
  nooit LAN zonder versleuteling; (2) Origin precies de eigen pagina; (3) koppelen met een code die de
  mixer toont (pairing, token in een `HttpOnly`-cookie, zoals de hub); (4) een iPad mag alleen de actions
  die in ZIJN werkruimte staan (witte lijst per paneel; geen `record.*`, `log.*`, laden-over-spelend zonder
  tweede druk); (5) bij wegvallen laat de mixer elke vastgehouden knop los (zoals `mapping.losgekoppeld()`
  en de hub met triggers doet); (6) `tailscale-user-login` als identiteit is een AANNAME.
- Wat de iPad zelf kan halen zonder de mixer: peaks (`/media/<id>/peaks.bin` staat al op de witte lijst),
  grid, toonsoort en secties uit `/api/library/...`. Alleen de LIVE stand (segmenten, reads) komt van de mixer.
- Safari: geen Web MIDI, geen Web Lock nodig; de pagina mag geen AudioContext openen (zoals companion,
  `regels-companion.test.mjs` bewaakt die grens met de importboom; een paneelpagina krijgt dezelfde test).

**C. De hub-cockpit (bestaat al).** Virtuele APC op de iPad via de hub. Goedkoop als noodweg en voor
"de APC thuislaten", maar geen VARVE-panelen, geen golfvormen. Niet de weg naar een werkruimte.

Advies: A eerst (week 1: zelfde code als B, nul netwerk), dan B met precies dezelfde paneelpagina:
de pagina kiest haar transport (`opener` als die er is, anders WebSocket). Zo is er één paneelcode.

## 5. "Een paneel = een bouwsteen die je overal kunt neerzetten": de kleinste stap

Stap 1 (klein, los van alles): **het vrije paneel als data.**
```json
{ "id": "mijn-fx", "titel": "FX focus", "volgt": "focus",
  "items": [
    { "soort": "knob",  "action": "track.{focus}.fx.knob.1", "label": "WORP" },
    { "soort": "knop",  "action": "track.{focus}.fx.knob.1.hold" },
    { "soort": "fader", "action": "track.{focus}.filter" },
    { "soort": "knop",  "action": "track.{focus}.play.quant", "label": "OP DE 1" } ] }
```
- Een renderer maakt er de bestaande elementen van (`.knob[data-action]`, `[data-kind=button]`,
  `input[type=range][data-action]`) en roept dezelfde binding aan; labels vallen terug op `beschrijf()`,
  kleur op `soorten.js`; `{focus}`/`{speel}` via `resolveTarget`. Valideren met `metaOf(action)` (onbekend
  = grijs met melding, nooit crash; zoals onbekende effecten in een rack).
- Nodig in de bestaande code: (a) binden per container in plaats van één keer voor het hele document
  (`vensters.js` r.40/45 → een `bind(root)` die Knobs aan de renderlijst toevoegt en weer weghaalt);
  (b) de renderloop een registreerbare lijst knobs/faders geven; (c) lampjes van knoppen uit `read()`
  (zoals `lichtVan` in spiegel-plan.js) ook buiten de spiegel.
- Dit beantwoordt meteen Clay's "welke knoppen ik voor wat gebruik" op het scherm, als DATA, en het
  combineert met racks/macro's (één knop = een macro-plek; combinaties van effecten = rack, al data).

Stap 2: **de bestaande rijen als bouwsteen.** Elke `opzetX` krijgt `{ maak(container), teken(), sluit() }`
en zijn HTML uit index.html naar een template in de module; een register `PANELEN = { stems, master,
koptelefoon, instrument, patronen, auto, klankschaal, beeld, sampler, library, … }`. Mechanisch werk
(9 rijen + onderpanelen), maar elke rij is al een losse module met een eigen `teken`; het lastigste zijn
`focus-deck` en de spiegel (veel id's en vaste querySelectors in renderloop.js r.20-60).

Stap 3: **de werkruimte als data** (eigen map `werkruimtes/<naam>.json`, opslaan met versie + 409 zoals
plannen/patronen/standen):
```json
{ "schema": 1, "naam": "overgang",
  "schermen": {
    "hoofd": { "raster": "2x2", "vakken": { "a": "spiegel", "b": "alle-tracks", "c": "mijn-fx", "d": "stems" } },
    "mac-2": { "vakken": { "a": "library" } },
    "ipad":  { "vakken": { "a": "mijn-fx", "b": "secties" } } },
  "volgt": { "laag:grid.stems": "stems-werk", "laag:device.master": "master-werk" } }
```
- "Per onderdeel van de mix een andere werkruimte": `volgt` koppelt aan wat er al bestaat en al een
  `change` meldt: het open mapje (`lagen`), de focus-track met een instrument (`instrumentOp`), de
  grid-modus. Geen nieuwe toestand nodig. Wisselen = alleen herschikken, nooit iets uitzetten.
- Regel voor de standen: een stand mag een werkruimte NOEMEN (een keuze, zoals een sjabloonnaam); de
  werkruimte zelf zegt alleen WAAR. Altijd een vaste weg naar "alle panelen" (bovenbalk), zodat de
  crossover-regel (VERBODEN_DELEN) niet sneuvelt.
- Toetsenbord als data (`mappings/toetsen.json`, zelfde vorm als een MIDI-mapping, `KEYMAP` als
  standaard en migratie) hoort in dezelfde beweging: dan zijn ALLE invoer en ALLE plekken data.

## 6. Punt 4 (alle tracks tegelijk zien lopen): wat het scherm nu heeft

- De acht **banen** (`BaanView`, waveform.js r.375) tonen elk het HELE nummer op hun eigen lengte:
  positie, loop, hotcues, zekerheidsstrook van het grid. Niet uitgelijnd, geen tellen, niet ingezoomd.
- Alleen de focus-track heeft een ingezoomde golfvorm met grid (`WaveformView` 'zoom') en een
  fasewijzer t.o.v. de maatgever (`.fase`, renderloop.js r.211-219).
- Er is dus geen gestapelde, op de tel uitgelijnde weergave van meerdere tracks (zoals Rekordbox/Serato
  "stacked"). Dat is precies een bouwsteen: paneel "alle-tracks" = N zoom-views met hetzelfde
  tijdvenster rond NU, uitgelijnd op de maat van de maatgever, met de tellen van elk grid en de
  fasefout per track. Rekenwerk bestaat al (`beatgrid.js` timeOf/beatAt, `hoorbaar.js`, `tellen.js`
  `oordeelBij/afwijkingBij`). Tekenkosten: 8 × zoom per frame is veel GPU-upload (AUDIOPAD/5 okt: zonder
  sleutel ~29 Mpx/s); met de `zelfde()`-sleutel en een lager framerate (30 fps) of in een tweede venster.
  Zo'n paneel op een tweede scherm of de iPad is het natuurlijke eerste "echte" paneel (alleen lezen,
  dus veilig voor route B vóór de schrijfkant af is).

## 7. Risico's

- Twee bronnen voor dezelfde knop (scherm, iPad, APC, Maschine) bestaan al voor MIDI + muis; met de iPad
  komen er netwerkvertraging en uitval bij. Soft-takeover en "loslaten = de action van het indrukken"
  moeten ook voor de iPad gelden, en wegvallen = alles loslaten.
- De mixer-hoofdthread wordt de rem: een iPad-bericht wacht op een haperende renderloop. Meten in Chrome
  (niet hier mogelijk: geen Chromium in deze container).
- Opener-vensters delen de hoofdthread van de mixer: een zwaar "alle-tracks"-paneel in een tweede
  venster kan de mixer-UI laten haperen (audio niet).
- Veiligheid: de eerste schrijfweg van buiten de Mac. Moet een expliciete keuze van Clay zijn (CLAUDE.md:
  "eerst melden"; COMPANION.md §Niet: "eerst de mixer laten melden, dan pas opdrachten met id's").
- De companion-stap 2 (mixer POST) is nog nooit live geproefd; daar bovenop een bedieningskanaal bouwen
  zonder proef botst met VISIE §5.4.
- Het refactoren van index.html naar bouwstenen raakt veel headless-tools (rijen.mjs, kijk.mjs,
  bovenbalk, spiegel-tests) die op vaste id's rekenen.
- Handelingenlog: iPad-acties gaan via de bus en komen er dus vanzelf in (goed); maar bron "ipad" is niet
  te onderscheiden. Eventueel `invoke(id, v, { bron })` (de 4e logkolom bestaat al voor `van`).

## 8. Kansen (kort)

1. Het vrije paneel als data (stap 1) is klein en geeft meteen "mijn knoppen, mijn indeling" zonder code.
2. Paneelpagina die via `opener` werkt = tweede scherm op de Mac in één stap; dezelfde pagina later
   via WebSocket naar de iPad.
3. "Alle tracks uitgelijnd op de tel" als eerste paneel: alleen lezen, groot effect (punt 4), veilig.
4. Werkruimte die het open mapje volgt: de APC/Maschine-modus kiest het scherm mee (punt 1 en 6 samen).
5. Toetsenbord naar JSON: laatste stuk invoer dat nog code is.
6. Segmenten `{T,P,R}` + klokverschil naar de iPad: golfvormen draaien vloeiend zonder 60 berichten/s.
