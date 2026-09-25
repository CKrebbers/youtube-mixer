# Eigen mapping als verschil (ROADMAP 13)

25 september 2026. Spoor `spoor/mapping-verschil`.

## Het probleem

Tot nu toe bewaarde de app je eigen MIDI-mapping als VOLLEDIGE kopie (server
`/api/mapping` + localStorage `varve.mapping`). Zolang die kopie bestond, las de
app `mappings/apc40mk2.json` niet meer: een nieuwe standaardmapping kwam nooit bij
je binnen. Op 23 september ontbrak daardoor de grid-modus op de APC, en moest de
kopie met de hand worden samengevoegd.

## Wat er nu bewaard wordt

Alleen wat JIJ anders hebt dan de standaard van je apparaat:

```json
{
  "kind": "diff",
  "version": 3,
  "device": "apc40mk2",
  "base": "35823dda-291",
  "top": {},
  "rules": [
    { "in": "cc:0:20", "action": "video.fx.pixel",  "mode": "absolute", "laag": "device.rack", "label": "device knob 5" },
    { "in": "cc:0:21", "action": "video.fx.rgb",    "mode": "absolute", "laag": "device.rack", "label": "device knob 6" },
    { "in": "cc:0:22", "action": "video.fx.trails", "mode": "absolute", "laag": "device.rack", "label": "device knob 7" },
    { "in": "cc:0:23", "action": "video.fx.grain",  "mode": "absolute", "laag": "device.rack", "label": "device knob 8" }
  ],
  "removed": []
}
```

Dit is Clay's echte verschil: zijn kopie van 24 september (gelezen met GET, 291
regels, 30,8 kB) tegen de huidige standaard. Rack-knoppen 5–8 staan op
video-effecten; verder is alles de standaard. 524 bytes.

| veld | betekenis |
|---|---|
| `kind: "diff"` | herkenning: dit is geen hele mapping |
| `version` | generatie van de action-namen, net als in een volledig document; `migreerAction` werkt ook op een verschil |
| `device` | bij welke standaard het hoort (`mappings/<device>.json`) |
| `base` | vingerafdruk van die standaard (FNV-1a over apparaat, shiftknop en regels op sleutel gesorteerd; naam en volgorde tellen niet), met het aantal regels erachter |
| `top` | alleen topvelden die anders zijn: `shift` (`null` = geen shiftknop) en `name` |
| `rules` | regels die je toevoegde of veranderde, volledig, op hun sleutel `sig[#shift][@laag]` |
| `removed` | sleutels van standaardregels die je weghaalde (een markering) |

## Hoe het werkt

- **Laden** = standaard + verschil (`pasVerschilToe`). Een nieuwe regel in de
  standaard komt vanzelf binnen. Een regel die jij veranderde of weghaalde blijft
  van jou, ook als de standaard hem later verandert.
- **Bewaren**: het verschil wordt bij elke wijziging opnieuw UITGEREKEND
  (standaard tegen wat er nu staat, `maakVerschil`), niet per bewerking
  bijgehouden. Koppel je een knop terug naar wat de standaard doet, dan verdwijnt
  hij vanzelf uit je verschil. Alleen als de tekst van het verschil verandert,
  gaat het naar de browser (meteen) en de server (na 500 ms).
- **Fragmenten** (`Mapping.voegToe`, de vormlagen met `?vormen=1`) horen er nooit
  bij: ze gaan al niet mee in `toJSON()`. Koppel je zelf over een fragmentregel,
  dan is het de jouwe en komt hij wel in het verschil. Haal je een standaardregel
  weg op een plek waar ook een fragment staat, dan bewaart het verschil alleen de
  markering; het fragment vult aan zolang het aan staat.
- **Standaard herstellen** = een LEEG verschil bewaren (server en browser), niet
  wissen. Een leeg verschil zegt "ik wil de standaard", en daardoor komt een oude
  kopie uit een andere browser niet meer terug (bij wissen gebeurde dat wel: een
  lege server laat de browser voorgaan).
- **Exporteren** geeft het VOLLEDIGE document, zoals altijd. Dat is een bestand
  voor mensen en voor een andere computer: het leest zonder te weten op welke
  standaard het rustte, en inladen geeft precies wat erin staat. **Importeren**
  van zo'n bestand laadt het zoals het is; bewaard wordt daarna het verschil tegen
  de standaard van zijn apparaat. Een verschil als bestand inladen kan ook (het
  komt bovenop de standaard); een verschil zonder standaard eronder wordt
  geweigerd, anders laad je stilletjes vier regels als hele mapping.
- **Een ander apparaat** (bv. `generic`): de standaard is `mappings/generic.json`
  (leeg), dus het verschil is je hele mapping. Een apparaat zonder bestand krijgt
  een lege standaard (404 is geen fout). Een andere fout bij het ophalen van de
  standaard wordt WEL een fout: een verschil tegen een standaard die niet
  binnenkwam zou alles als "nieuw" zien.
- **De oude volledige kopie** wordt bij het eerste laden omgezet: verschil tegen
  de huidige standaard, dan standaard + verschil geladen (dus wat je ziet is
  precies wat je na herladen krijgt), en meteen bewaard op server en in de
  browser. Een melding onderaan zegt het één keer.
- **Standaard bijgewerkt** (de `base` in je verschil klopt niet meer): melding
  "de standaardmapping is bijgewerkt …" en het verschil wordt meteen tegen de
  nieuwe standaard bewaard.
- **Server**: niets veranderd. `/api/mapping` eist alleen een lijst `rules`
  (`rules` staat er dus altijd, ook leeg) en bewaart de rest ongeschonden
  (`server.test.mjs`). Deze versie vraagt dus geen herstart van de server,
  alleen herladen van de pagina.
- **apc.html** leest dezelfde weg (`laadEigen`), bewaart niets.

## Opstarten: wanneer er NIET bewaard wordt (controleur, 25 sep)

Bewaren vervangt wat er op de server staat. Dat mag alleen als de app weet wat
daar staat:

- **Server niet gelezen** (GET `/api/mapping` faalt, POST misschien wel): de
  reserve uit de browser wordt geladen, maar opstarten stuurt NIETS naar de
  server, ook niet na omzetten of een nieuwe standaard. Een oude kopie van vóór
  de grid-modus in de browser zou anders, omgezet, de grid-modus als
  "weggehaald" over Clay's verschil heen zetten zonder dat hij iets deed. Een
  koppeling daarna wordt wel bewaard, zoals altijd.
- **Eigen mapping niet geladen** (de standaard kwam de eerste keer niet binnen,
  de tweede keer wel): de standaard staat erop, maar die sessie wordt NIETS
  bewaard tot je herlaadt of bewust "standaard herstellen" kiest; de
  foutmelding zegt het. Anders verving de eerste koppeling al je eigen regels
  door één.
- **Van de server geladen**: de reserve in de browser wordt hetzelfde verschil
  (alleen de browser). Anders bleef in een tweede browser (Comet) een oude
  volledige kopie liggen die het overneemt zodra de server even niet antwoordt.

## Waarom het omzetten exact is

`git log -- mappings/apc40mk2.json`: de laatste wijziging is 1196c2b (23 sep
22:31, grid-modus). Clay's kopie is daarna met de hand samengevoegd en heeft
dezelfde 291 sleutels; alleen de vier rack-knoppen verschillen. De standaard is
sindsdien niet meer veranderd, dus "verschil ten opzichte van de huidige
standaard" is precies wat Clay zelf veranderde.

Dat blijft zo zolang `mappings/apc40mk2.json` niet verandert vóór Clay de eerste
keer laadt met deze versie. Verandert de standaard eerder (een ander spoor dat
tegelijk landt), dan is het omzetten nog steeds verliesvrij (standaard + verschil
= zijn kopie), maar ziet het een standaardwijziging als de zijne: een nieuwe
standaardregel zou dan als "weggehaald" gemarkeerd worden. Daarom: dit spoor
eerst, en pas daarna iets aan de standaardmapping.

## Eerdere standaarden (25 sep, spoor3/apc-indeling)

Wat hierboven stond gebeurde ook echt: de APC-indeling "Voorstel A" (83 nieuwe
regels) landt terwijl Clay's server nog zijn VOLLEDIGE kopie van 24 september
heeft (gelezen met GET op 25 sep: 291 regels, standaard `35823dda-291` + de vier
rack-knoppen). Omgezet tegen de nieuwe standaard zou dat 4 eigen regels en 83
"weggehaald" geven: de nieuwe functies kwamen nooit op zijn APC.

Daarom draagt het standaardbestand zijn voorgangers mee, onder `eerder`, elk als
verschil met de huidige regels:

```json
"eerder": [
  { "vingerafdruk": "35823dda-291", "tot": "2026-09-25", "rules": [], "removed": ["note:0:50#shift", "…83 sleutels"] }
]
```

- Een oude volledige kopie wordt afgezet tegen de standaard waar hij het DICHTST
  bij ligt (minste regels + weggehaald), de huidige of een voorganger; bij
  gelijkspel de huidige (`verschilVanKopie` in mapping.js, gebruikt door
  `laadEigen`). Het verschil draagt dan de vingerafdruk van de voorganger, dus
  laden = nieuwe standaard + zijn eigen regels, en `standaardNieuw` zorgt dat
  het meteen opnieuw bewaard wordt tegen de nieuwe standaard.
- Een voorganger telt alleen mee als "huidige + verschil" precies zijn
  vingerafdruk geeft (`eerdereStandaarden`): liever niets dan een verkeerde basis.
- `normaliseer` laat `eerder` weg: het telt niet mee in de vingerafdruk, gaat
  niet mee in `toJSON()`, en de rest van de app ziet het niet.
- **Verander je `mappings/apc40mk2.json`, draai dan `node tools/mapping/eerder.mjs`**
  (de versie in git HEAD wordt een voorganger, de oude voorgangers komen mee).
  `test/mapping.test.mjs` faalt anders, want dan klopt geen voorganger meer.
- Nagerekend met Clay's echte kopie en de code van deze branch (`laadEigen`
  met een nep-fetch, niets gepost): 374 regels, 4 eigen (cc:0:20–23 in het
  rack = video-effecten), 0 weggehaald, alle 83 nieuwe regels geladen, geen
  nieuwe regel op een van zijn sleutels; bewaard wordt daarna een verschil van
  4 regels tegen `e2bef131-374`.

## Bekende grenzen

- Botst jouw regel met een latere wijziging van de standaard op DEZELFDE sleutel,
  dan wint jouw regel, zonder dat de app zegt welke. Het verschil onthoudt niet
  wat de standaard daar had toen jij hem veranderde (dan zou een driewegvergelijking
  kunnen). Je ziet alleen "de standaardmapping is bijgewerkt".
- Een weggehaalde regel blijft weg, ook als de standaard hem later verandert.
- Alles in een regel telt mee in de vergelijking, ook `label`. Leer je een knop
  opnieuw met dezelfde action maar een andere naam, dan is hij van jou.
- De volgorde van regels in de mapping verandert bij het omzetten (volgorde van de
  standaard, jouw nieuwe regels achteraan). Volgorde betekent nergens iets
  (`kies()` zoekt op sleutel, de mapjebalk sorteert zelf).
- `verschil()` kost ~2 ms (gemeten op een drukke M1), bij elke 'change' van de
  mapping; niet per MIDI-bericht.
- De mapping-versie blijft 3: een volledig document is niet veranderd, en de
  action-namen ook niet. Het verschil herken je aan `kind`, niet aan de versie.
- OUDE code (van vóór dit spoor: terugdraaien, of een branch zonder dit spoor op
  :8777) kent `kind` niet en leest een verschil als volledige mapping: de APC
  heeft dan alleen je 4 eigen regels en geen shift. Koppel je daar iets, dan
  bewaart de oude code een "kopie" van 5 regels, en de nieuwe code zet die
  later om met 286 standaardregels als weggehaald en zonder shift (gemeten met
  de code van main; herstellen kan met
  "standaard herstellen", je eigen regels opnieuw koppelen). Dus: niet
  terugdraaien zonder eerst de volledige mapping (export) terug te POSTen.
- Een OUD geëxporteerd bestand importeren (van vóór een standaardwijziging)
  laadt precies dat bestand: wat de standaard sindsdien kreeg, staat daarna als
  "weggehaald" in je verschil. Een export draagt geen `base`.
- Koppelen en binnen 500 ms herladen: de server heeft de koppeling dan nog niet
  (zoals vóór dit spoor) en bij opstarten wint de server.
- Een `led` met dezelfde inhoud maar een andere sleutelvolgorde telt als een
  andere regel (JSON-tekstvergelijking). Nu heeft elke `led` in de standaard
  één sleutel, dus het speelt niet.

## Code en tests

- `src/control/mapping.js`: `normaliseer`, `vingerafdruk`, `maakVerschil`,
  `pasVerschilToe`, `isVerschil`; `Mapping.zetStandaard/laadStandaard/verschil`,
  en `load()` herkent een verschil.
- `src/ui/mapping-opslag.js` (nieuw, geen DOM): `haalStandaard`, `laadEigen`
  (opstarten en omzetten), `opzetMappingOpslag` (bewaren, herstellen).
- `src/ui/midi-opzet.js`, `src/ui/apc-kaart.js`, `src/ui/mapping-panel.js`
  (status: "4 eigen (de rest volgt de standaard)").
- `test/mapping.test.mjs`: oude kopie → verschil, nieuwe standaardregel komt
  binnen, eigen regel wint, weggehaalde regel blijft weg, fragment blijft
  buiten, shift, generic, migreerAction; en het hele opstarten tegen een
  nagebouwde server die net zo streng is als de echte (POST zonder `rules` = 400,
  JSON als tekst in de database), inclusief: standaard onbereikbaar = niets
  bewaren (anders overschreef een fragment Clay's verschil met een lege mapping).
  Controleur: server niet gelezen = niets naar de server bij opstarten; standaard
  één keer niet binnen = die sessie niets bewaren; de reserve volgt de server.
- `test/learn.test.mjs`: leren bovenop de standaard, export volledig, rondje
  export/import geeft hetzelfde verschil.
- `test/server.test.mjs`: een leeg verschil gaat erdoor en komt ongeschonden terug.
