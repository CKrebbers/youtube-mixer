# Kleine opruimingen uit de architectuur-audit (15 okt 2026)

Spoor E, tak `arch/opruimen`, vanaf `studio/architectuur` (99fb3f3). Punt 1 en 4 van de audit:
geen herstructurering. De centrale registers (`EFFECTEN` in fx.js, `SYSTEMEN` in systemen.js,
`AANHAKERS` in aanhakers.js) blijven zoals ze zijn, net als het besluit "geen pluginsysteem"
(docs/plugins/01-plan.md) en de opzet van S0 dat een spoor alleen zijn eigen stub aanraakt.
Er verandert geen gedrag: elke tekst, elk bericht op de lijn en elke lijst is gelijk gebleven,
en dat is telkens vóór en na nagemeten.

## E1. Effecttests op id in plaats van plek

`test/effecten.test.mjs` pakte de tien effecten van de filter app met `EFFECTEN.slice(7, 17)`,
`test/effecten-s10.test.mjs` die van S10 met `EFFECTEN.slice(17)`. Een achtste effect in fx.js
brak ze allebei. Nu zoeken ze elk effect op id, en toetsen ze strenger dan eerst:

- elk effect van `MEER_EFFECTEN` en `S10_EFFECTEN` staat in `EFFECTEN`, als **hetzelfde object**
  (en `effectVan(id)` vindt het);
- elk blok is aaneengesloten en in zijn eigen volgorde. Die volgorde doet ertoe: het is die van de
  kiezer (`master-paneel.js`, de rack-editor) en van `track.N.fx.next/prev` (actions.js);
- de eigen effecten van fx.js staan ervóór, de filter app daarna, S10 achteraan.

De oude `slice(17).every(…)` was ook stil goed als `EFFECTEN` korter werd; dat kan nu niet meer.

## E2. Gekopieerde hulpjes op één plek

| wat | was | nu |
|---|---|---|
| `komma`, `hz`, `pct`, `ms`, `teken`, `db` | fx.js (hz, pct), fx-meer.js (alle zes), fx-s10.js (alle zes), drums.js en fm.js (komma, hz), schaal.js (komma), rack-editor.js (komma), toon-weergave.js (komma met vast 2 decimalen) | `src/lib/notatie.js` (geen imports; de engine mag uit src/lib lezen, regel 1) |
| `pct` in `src/ui/dom.js` | eigen formule met een controle op het type | dezelfde controle, rekent via notatie.js |
| `WORKLET_FADE` | fx-meer.js en fx-s10.js, elk 0,05 | `export` in fx-meer.js; fx-s10.js importeert hem (het importeerde daar al tien dingen vandaan). Niet uit fx-worklet.js: dat is de module van de audiothread |
| `wie(t)` | combi.js en effecten.js (gelijk), precisie.js ("vorige focus", "maatgever"), apc-beschrijf.js (alleen focus en speeltrack) | `src/ui/wie.js`: `wie(t, namen)` met de tabellen `WIE` (combi, effecten), `WIE_KERN` (apc-beschrijf) en `wieMet({...})` (precisie). Geen imports, bevroren tabellen zonder prototype |

In fx-meer.js en fx-s10.js zijn alleen de regels bovenin geraakt (imports, de constanten, de
helpers); de regels waar AudioWorkletNodes gemaakt worden niet (dat doet een ander spoor).
`wie.js` staat in `src/ui/`, niet in `src/ui/beschrijf/`: elk bestand daar is een spoor (zie E3).
apc.html en maschine.html laden de uitleg statisch; `/src/` staat op de witte lijst, dus de nieuwe
module komt gewoon mee.

**Teken voor teken gelijk**, gemeten met twee wegwerpscripts (niet in de repo):
- elke `eenheid` van elk effect (ook via `toonWaarde`, met de andere parameter op 0 en op 1) en
  van elk instrument, op 1001 standen plus vier buiten 0..1: 192 998 regels, vóór en na `cmp`-gelijk;
- `beschrijf()` en elk spoor van de uitleg over 3 683 actions (alle uit de mappings en de
  letterlijke `track.…`-namen in src/, elk met `{focus}`, `{speel}`, `{tweede}`, `{R}`, `{L}`,
  `{maatgever}`, `1`, `8`, `constructor`, `toString`, `{plek}`): gelijk.

Nieuw: `test/notatie.test.mjs` legt de nieuwe hulpjes tegen de oude kopieën (honderden getallen,
de randen bij 1000 en 10 000 Hz en 0,1 s, `-0`, NaN en geen-getal voor dom.pct), de drie
wie-tabellen tegen de drie oude functies, en dat er geen kopie terugkomt in de bestanden waar ze
stonden (en WORKLET_FADE maar één keer in src/engine).

**Niet gedaan, bewust:**
- `pct` in schaal.js klemt (`clamp(v)`) en blijft; `pct` in past-bij.js heeft een decimaal; de
  `ms` van master-paneel.js en server/index.js zijn een andere notatie. Gelijke naam, ander ding.
- `hz` en `komma` in `src/control/maschine.js` en `maschine-scherm.js` (komma op een string):
  zelfde uitkomst, maar dat is het bestand van de Maschine (S6) en het stond niet in de opdracht.
- De `toFixed(…).replace('.', ',')` die in fx.js midden in een regel staan (reso, bits, snelheid,
  grootte): geen kopie van een helper, niet aangeraakt.
- apc-beschrijf.js gebruikt `WIE_KERN` (alleen focus en speeltrack), niet de volle tabel, omdat
  zijn tekst gelijk moest blijven. Komt er ooit een standaardregel met `{R}` of `{maatgever}`,
  dan zegt hij "track {R}": met `WIE` in plaats van `WIE_KERN` is dat één woord.

## E3. De vijf lijsten met de hand: een check

Er was al een check op de exacte inhoud van `AANHAKERS`, op de vorm van de routes en op de drie
eerste stylesheets in index.html. Nieuw in `test/aanhaakpunten.test.mjs`, sectie "de lijsten van
de sporen tegen de bestanden", beide kanten op:

1. `AANHAKERS` = de bestanden in `src/ui/aanhakers/` (geen dubbele);
2. `SPOREN` van de uitleg (gelezen uit de bron van `src/ui/beschrijf/index.js`: de imports en de
   lijst; hij is niet geëxporteerd en daar ben ik afgebleven) = de bestanden in `src/ui/beschrijf/`;
   elk is een default-functie en hoort bij een aanhaker met dezelfde naam;
3. een aanhaker die actions definieert (zelf `define(`, of een `bind…` uit `src/control/acties-*.js`
   die `define(` doet) heeft een uitleg in SPOREN. Nu: precisie, werk, combi, inrichten, set,
   effecten, indeling;
4. `SPOREN` van de server = de bestanden in `server/routes/`, en elke naam hoort bij zijn eigen
   module (op identiteit);
5. elk bestand in `src/ui/css/` staat in index.html; geen pagina linkt naar een stylesheet die er
   niet is of twee keer; werk.html en uitlijn.html laden precies wat in de tabel `OOK` in de test
   staat, en andere pagina's geen.

Met nepbestanden nagegaan dat elke check afgaat (een css, een uitleg, een route en een aanhaker
met `define` erbij; daarna weer weg). Grens: welke action precies een tekst heeft, toetst deze
check niet (alleen dat het spoor een uitleg heeft); dat doet de bestaande test op de
standaardmapping. Of een stylesheet ook in werk.html hoort, weet de schijf niet: daarom de tabel.
`docs/werkruimte/S0.md` §8b: "Een spoor erbij: deze vijf plekken (de test bewaakt ze)".

## E4. server/paneel.js: één keer stringify-en

`_stuur` maakte per kijker opnieuw `JSON.stringify` van elk bericht (tot 16 kijkers). Nu maakt
`_tekst(lijst)` de SSE-tekst één keer en schrijft `_schrijf(k, tekst, n)` hem naar elke kijker;
de eerste stand bij het verbinden gaat langs dezelfde weg. De stats (`naarKijkers`, `bytes`)
tellen nog per kijker. Een nagespeelde reeks (stand met é€😀 en een aanhalingsteken, verschillen,
een kijker die gooit, een met een volle buffer, hb, weg na 70 s, twintig kijkers waarvan de oudste
eruit moeten) geeft vóór en na dezelfde bytes per kijker en dezelfde stats. Nieuw in
`test/paneel-server.test.mjs`: zestien kijkers, twee berichten = twee stringify's (was 32), elke
kijker precies dezelfde tekst, de stats per kijker.

## E5. Twee voorstellen (niet gebouwd)

### a. De schermen van de Maschine binair naar de hub (voorstel voor de repo AV-app-hub)

Nu: `HubMidi._scherm` maakt van 2048 bytes (256 × 64, 1 bit) een base64-string (een lus van 2048
`String.fromCharCode` plus `btoa`) en stuurt `{t:'scherm', dev, nr, data}` als JSON: ~2,8 kB per
scherm. Twee schermen, hooguit eens per 100 ms, vlak na invoer eens per 40 ms
(`SCHERM_MS`/`SCHERM_SNEL_MS` in maschine.js): normaal tot ~56 kB/s, na invoer tot ~140 kB/s, en
aan de kant van de hub per scherm `JSON.parse` en base64 terug. Een nieuwer beeld vervangt al een
ouder in de rij, en er gaat alleen iets als het beeld anders is.

Voorstel voor PROTOCOL.md van de hub (een nieuwe paragraaf, "binaire frames"):
1. **Afspreken, niet aannemen.** De hub zegt in zijn `hallo` wat hij kan, bv.
   `kan: ['scherm-bin']`. Een app stuurt alleen binair als de hub dat zei; anders blijft het
   JSON met base64. Een oude hub en een oude app werken dus allebei door.
2. **Het frame.** Een binair WebSocket-bericht: byte 0 = soort (`0x01` = scherm), byte 1 = de
   lengte L van de apparaat-id, bytes 2…L+1 = de id in ASCII (`maschine-mk2`), dan één byte
   schermnummer (0 of 1), dan precies 2048 bytes. Alles wat niet precies zo lang is: weigeren en
   tellen (zoals `geweigerd` nu). Geen versie in het frame: die zit in `kan`.
3. **Hub-kant.** `ws.on('message', (data, isBinary) => …)`: binair en soort 0x01 = dezelfde weg
   als het JSON-scherm nu (rechtstreeks naar de HID-schrijver). De volgorde tussen JSON- en
   binaire berichten is die van de socket; een scherm hoeft niet op een lampje te wachten.
4. **VARVE-kant** (pas na de hub): `_scherm` zet het frame in een `Uint8Array` (één per scherm,
   hergebruikt), de wachtrij en het vervangen van een ouder beeld blijven zoals ze zijn,
   `socket.binaryType` doet er niet toe (we sturen alleen).

Winst: ~25% minder bytes en geen base64 aan beide kanten. Eerlijk: 56 kB/s over localhost is weinig.
Doe het pas als een meting (`tools/headless/werk-maschine.mjs`, `tools/bench/feedback.mjs`)
laat zien dat de schermen tijd kosten in de mixer of in de hub; anders is het een
protocolwijziging in twee repo's voor bijna niets.

### b. De status-zender ook zonder kijker (en hoe dat te poorten is)

`startStatusZender` (src/ui/status-zender.js) stuurt elke seconde, in het tabblad met de Web Lock:
een bericht op het BroadcastChannel `varve-status` (voor de Controlekamer) en, sinds de companion,
een `POST /api/mixer` van ~1–2 kB (hooguit eens per 900 ms). Dat gebeurt ook als niemand kijkt.
Het kanaal kost bijna niets (een bericht zonder luisteraar wordt niet afgeleverd). De POST kost
wel iets: een HTTP-verzoek per seconde op dezelfde host als de StreamBron (een van de zes
verbindingen van Chrome, kort), JSON maken en lezen, en op de server `isMelding`.

Voorstel, zonder de companion te breken:
1. De server onthoudt wanneer `GET /api/mixer` het laatst gevraagd werd (de companion peilt elke
   seconde zolang zijn pagina zichtbaar is, `PEIL_MS`). Het antwoord op de POST wordt
   `{ ok: true, kijker: nu − laatstGelezen < KIJK_MS }` (bv. 10 s). Een oude mixer leest alleen
   `r.ok`, dus dat breekt niets.
2. De zender: met `kijker: true` (of zolang hij het nog niet weet) zoals nu, eens per 900 ms. Met
   `kijker: false` een **rustige hartslag** van eens per 4 s. Waarom 4 s en niet stil: de companion
   noemt een melding ouder dan `VERS_MS` (5 s) "meldt zich niet", en `TWEE_MS` (5 s) moet twee
   mixers nog kunnen zien. Onder de 5 s blijft alles wat de companion zegt waar.
3. Wat de companion merkt: kijkt hij na een stilte weer, dan is het eerste antwoord tot 4 s oud
   (de resttijd krijgt dan een ≈, `SCHATTING_MS`), en binnen één POST staat de mixer weer op 900 ms.
4. Het BroadcastChannel niet poorten: dat is gratis, en de Controlekamer vraagt met
   `{ vraag: 'status' }` toch al meteen.

Winst: van ~1,1 naar 0,25 POST per seconde als niemand kijkt (−78%). Toetsen die erbij moeten:
`test/status-zender.test.mjs` (de twee tempo's met een nepklok, een oude server zonder `kijker`),
`test/mixer-melding.test.mjs` en `test/companion-server.test.mjs` (het eerste antwoord na een
stilte is nog 'vers'). Niet gebouwd: het raakt de companion (docs/COMPANION.md) en de server, en
de opdracht was beschrijven.

## Tests

`node test/alles.mjs --banen 2`, één keer aan het eind: zie het eindrapport hieronder.

Slotregel: `134 bestanden, 11463 checks, 10 overgeslagen — 5 ROOD · 2 tegelijk, 619 s`.
Rood: `backup-kopie`, `instrumenten-fm-schaal`, `paneel-schrijf`, `renderblok`, `wachtrij`. Alle vijf
zijn van de omgeving, niet van deze tak; elk is op de basis (99fb3f3, een schone `git archive` in
een eigen map) nagedraaid:

- `wachtrij` ("yt-dlp en zijn kind", 2×) en `renderblok` ("keylock met wissels", 89,7 bytes per
  bericht): de bekende fouten van deze Linux-container.
- `instrumenten-fm-schaal` ("geen afval per blok", 26–29 kB): ook los, en op de basis even rood
  (29 200 bytes).
- `backup-kopie`: "één regel" (de Node 22-waarschuwing) én "controleer: exit 0, alles ok". Die
  tweede staat niet in het lijstje van bekende fouten, maar is op de basis precies zo rood.
- `paneel-schrijf`: "de keten kost hooguit drie gewone rondjes plus 2 ms", een meting op de
  wandklok (`@alleen`). Los een keer groen; acht keer om en om tak/basis gedraaid terwijl andere
  sporen de container belasten: de tak 2 van 4 rood, de basis 1 van 4 rood (p99 tot 70 ms waar de
  grens tussen 19 en 94 ms schommelt). Deze tak raakt die keten niet (PaneelSchrijf en de nep-mixer
  zijn ongewijzigd; alleen de relais van de kijkers, die nu minder doet). Wisselvallig onder load,
  zoals "na één tik een hap" van midi.

Los gedraaid na elke stap (groen): effecten, effecten-s10, notatie, regels, rack, instrumenten,
instrumenten-drums, klankschaal, toonsoort, mapping, spiegel, maschine-kaart, maschine,
aanhaakpunten, precisie, master, engine, sampler-drums, sjablonen-paneel, modulatie,
paneel-server, paneel-schrijf, werkruimte, werkruimte-server, inrichten.

## Voor CLAUDE.md (voorstel, niet zelf gewijzigd)

- Getallen als tekst (komma, hz, pct, ms, teken, db) staan in `src/lib/notatie.js` (geen imports,
  ook voor de engine). Een nieuwe eenheid: gebruik die, schrijf geen eigen kopie
  (`test/notatie.test.mjs` vangt een kopie in de bestanden waar ze stonden).
- "Welke track" in een uitleg (`— focus-track`, `— track 3`): `src/ui/wie.js` (`wie(t, namen)`,
  `WIE`, `WIE_KERN`, `wieMet`), ook voor een nieuw spoor in `src/ui/beschrijf/`.
- `WORKLET_FADE` (0,05 s) is één export in fx-meer.js; niet uit fx-worklet.js halen (audiothread).
- Een effect toetsen op id, nooit op zijn plek in `EFFECTEN` (de volgorde is die van de kiezer en
  van fx.next/prev; de tests toetsen hem als blok).
- Een spoor erbij: vijf plekken (AANHAKERS, SPOREN van de uitleg, SPOREN van de server, de
  stylesheet in index.html, en in werk.html/uitlijn.html plus de tabel `OOK` in de test);
  `test/aanhaakpunten.test.mjs` legt ze tegen de bestanden (docs/werkruimte/S0.md §8b).
- `PaneelRelais._stuur` maakt de tekst één keer per bericht (`_tekst`); wie er iets per kijker
  aan toevoegt, houdt dat zo.
