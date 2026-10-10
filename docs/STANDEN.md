# Standen: het systeem per moment instellen (10 oktober 2026)

Pijler 4 van `docs/VISIE.md`: *"precies zo kunnen instellen hoe ik het voor dat moment nodig heb"*,
zonder code. Een **stand** is één JSON-bestand per situatie (een avond met alleen de APC, een avond
met APC en Maschine via de hub, alleen de laptop) dat vastlegt met welke **beginwaarden** je begint.
In de Controlekamer heet het **Opstelling** (één constante, `LABEL` in `src/standen/stand-model.js`;
"stand" betekent in VARVE al zes dingen). Routes en bestanden heten `standen`.

Ontwerp en afwegingen: de uitwerking van 10 okt (`uitwerking/standen/5-ontwerp-definitief.md`).
Status: **gebouwd, niet geproefd** (zie "Wat niet getest is"). Tak `visie/standen`.

## 1. Wat een stand is, en wat hij nooit doet

- **Alleen waarden** die VARVE vandaag al aanneemt: een sjabloonnaam, een krat-id, de rem van de
  nacht, een profielnaam. Geen voorwaarden, geen volgorde, geen commando's, geen paden of adressen.
  Daarom is het data en geen code: `normaliseerStand` (puur, zonder imports) is de witte lijst.
- **Activeren is één gebeurtenis.** De server zet wat hij zelf bezit (de mapping, de rem van de
  nacht), kijkt na wat hij kan zien (krat, profiel, hub-set, sjabloon) en legt vast wat de mixer
  later overneemt (het master-rack).
- **Startpunt, geen slot.** Wat je daarna met de hand verandert blijft staan tot je opnieuw activeert.
- **Een stand zet alleen beginwaarden. Hij verbergt, blokkeert of schakelt nooit een pijler, paneel
  of action uit** (de crossover is de kern, VISIE §2). `panelen`, `acties`, `pijlers` en `mapjes`
  zijn verboden delen.
- **Hij start nooit geluid, een opname of een download.** De nacht kan hij alleen *remmen*.
- **De mixer herlaadt nooit vanzelf**; de Controlekamer laat de mixer niets doen.
- De stand leeft op de server, **op de Mac zelf**. Via Tailscale (iPad) pas als die route werkt
  (spoor companion).

### Wat er NIET in een stand mag (sessietoestand en beleid)

| hoort er niet in | waarom | waar het wel staat |
|---|---|---|
| knopstanden, faders, wat er speelt, de positie, loops, hotcues | sessietoestand: verandert elke seconde | de engine; het handelingenlog |
| de nacht AANzetten, `perNacht`, `venster`, `pauze`, `standaardVolgorde` | nachtbeleid; een stand haalt nooit binnen | de knoppen van de kaart (`/api/nacht`) |
| `speeldagen`, `vandaagNietDatum` | datums verlopen; "vannacht niet" is `nacht.vannacht: false` | `/api/nacht` |
| adressen (`beeld.adres`, relay, een `?hub=`-adres) | per machine, niet per avond | het beeldpaneel; `vlag.js` |
| een hele standaardmapping (> 64 KiB) | dat is de standaard zelf | `mappings/apc40mk2.json` |
| een sjabloon op plaats (`s:2`) | de volgorde van `racks/sjablonen.json` kan veranderen | op naam: `"Dub-worp"` |
| panelen verbergen, acties uitzetten | breekt de crossover | nergens |
| uitzenden | wacht op Clay's keuze in VISIE §4 | — |

Taakverdeling met de hub (W14): de **snapshot** van een hub-set zet 0..1-parameters live via de hub;
een **stand** zet keuzes (rack, krat, mapping, nachtrem, hub ja/nee, profiel). Nooit allebei voor
hetzelfde.

## 2. Het bestand (schema 1)

```json
{
  "schema": 1,
  "titel": "Avond 2 · APC + Maschine via de hub",
  "uitleg": "Hub-set studio, mixer via de hub, vannacht niet binnenhalen, master Dub-worp staat klaar.",
  "delen": {
    "pakket": { "profiel": "alles" },
    "nacht":  { "vannacht": false },
    "kaart":  { "krat": "slim:proefkrat" },
    "master": { "sjabloon": "Dub-worp" },
    "hub":    { "set": "studio", "mixerVia": true }
  }
}
```

| deel | waarde | wie past toe | vandaag |
|---|---|---|---|
| `mapping` | `"standaard"` of een mapping-document voor `apc40mk2` (≤ 64 KiB) | server: `lib.zet('mapping', …)`, dezelfde sleutel als `POST /api/mapping` | toegepast; de mixer leest hem bij de volgende start |
| `nacht` | `{ aan: false }` en/of `{ vannacht: false }`, niets anders | server: `nacht.zet`; loopt er een run, dan stopt die na het huidige nummer | toegepast, meteen; `vannacht: false` geldt voor de **komende** nacht, ook als je 's ochtends activeert (`komendeNacht` in `server/nacht.js`); het verschil noemt de nacht ("de nacht van 17 op 18 okt") |
| `kaart` | `{ krat: "<id uit GET /api/kaart>" }` | server kijkt na (bestaat hij, is hij leeg) | nagekeken; **kies hem zelf in de kaart** (stap D) |
| `master` | `{ sjabloon: "<name uit racks/sjablonen.json>" }` | server legt het rack vast in `.actief.json` | **de mixer volgt nog niet** (stap M) |
| `hub` | `{ set?: "<hub-set>", mixerVia?: true\|false }`; `set` is een bestandsnaam uit `AV-app-hub/sets` (letters, cijfers, `-`, `_`) | Controlekamer | genoemd: **start de hub-set zelf** (`npm start -- studio`); `mixerVia` stuurt "mixer openen" naar `/?hub=ws://localhost:7700/app` |
| `pakket` | `{ profiel: "<profiel van het avondpakket>" }` | server kijkt na in `avondpakket/profielen.json` (spoor draagbaar) | nagekeken als dat bestand er is, anders een waarschuwing |
| `beeld` | `{ aan?, latentieMs?: -200..500 }` | mixer | gevalideerd, overgeslagen (stap K) |
| `koptelefoon` | `{ omgewisseld }` | mixer | gevalideerd, overgeslagen (stap K) |
| `vormen` | `{ aan }` | mixer | gevalideerd, overgeslagen (stap K) |
| anders | — | — | blijft staan, waarschuwing "onbekend deel" |

Regels: `schema` moet 1 zijn; `titel` ≤ 60, `uitleg` ≤ 300 tekens; een ontbrekend deel blijft zoals
het is; een fout in een bekend deel = opslaan weigert (400), activeren slaat dat deel over en meldt
het. Namen: **kleine** letters, cijfers, `-` en `_` (≤ 60), niet `actief`, `keuzes` of `terug`. Geen
hoofdletters: de schijf van de Mac ziet `APC.json` en `apc.json` als één bestand. Een bestand dat je met
de hand `Feest.json` noemt, verschijnt als `feest`; "bewaar als" maakt van `Avond3` zelf `avond3`.

**De vier voorbeelden** (`tools/standen/voorbeelden/`, in git) heten als de profielen van het
avondpakket: `apc` (avond 1), `alles` (avond 2), `maschine`, `laptop`. Geen voorbeeld zet iets aan of
noemt mapping of beeld. "Thuis" is geen stand: geen stand actief = thuis. Waarden = voorstel.

## 3. Waar het staat

| pad | wat | git |
|---|---|---|
| `tools/standen/voorbeelden/<naam>.json` | de vertrekpunten | ja |
| `standen/<naam>.json` | jouw eigen standen; eigen gaat vóór voorbeeld | nee (`.gitignore`: `/standen/`) |
| `standen/.versies/<naam>/` | de vorige inhoud bij elke opslag; nooit weggegooid | nee |
| `standen/.vorige/` | wat een activering verving (mapping + nachtrem) en wat ze raakte (`raakt`) | nee |
| `standen/.actief.json` | welke stand actief is, sinds wanneer, het verslag, hoe mapping en nacht erbij stonden (`na`) | nee |

`VARVE_STANDEN` legt de map ergens anders neer. **Doe dat als de repo in iCloud staat**: een bestand
dat iCloud "dataless" maakte komt zonder netwerk niet terug. De server geeft het **antwoord** na 2 s op
(503 "stand niet lokaal beschikbaar (iCloud?)"), maar de draad die op het bestand wacht blijft hangen
tot het er is; de libuv-threadpool heeft er vier, dezelfde die de audio van de decks van schijf leest.
Daarom (review 10 okt): (1) een bestand dat volgens `stat` niet veranderde komt uit het geheugen, dus
de Controlekamer (elke 2 s) leest niets opnieuw; (2) er loopt nooit een tweede lees op hetzelfde pad
zolang de eerste hangt (hooguit één vastzittende draad per bestand; daarna meteen 503). Mappen
(`standen/`, `tools/standen/voorbeelden/`) gaan op dezelfde manier. Wat blijft: één hangend bestand
houdt één draad vast tot het netwerk terug is. Het avondpakket (spoor draagbaar) hoort `standen/` en
`tools/standen/voorbeelden/` mee te nemen in zijn dataless-controle (`INSTELLINGEN_MAPPEN`).

## 4. Routes

| route | wat |
|---|---|
| `GET /api/standen` | `{ standen: [{ naam, titel, bron, versie, gewijzigd, fouten }], actief, label }` |
| `GET /api/standen/actief` | `{ naam: null }` of de actieve stand met verslag, `mixer.master`, `hub`, `pakket`, `kaart` |
| `GET /api/standen/keuzes` | sjablonen, kratten, profielen (of `null`), `bekendeProfielen`, hub-sets, `mappingNu` |
| `GET /api/standen/<naam>` | `{ stand, versie, bron, fouten, waarschuwingen }` / 404 |
| `GET /api/standen/<naam>/verschil` | per deel `{ van, naar, moment }`: wat activeren zou veranderen |
| `PUT /api/standen/<naam>` | `{ stand, versie }`; versie = die van het effectieve bestand (eigen, anders voorbeeld); `null` = nieuw. 200 / 400 / 409 met wat er nu staat / 415 |
| `POST /api/standen/<naam>/activeer` | `{ ok, naam, sinds, verslag: { toegepast, gecontroleerd, genoemd, mixer, overgeslagen, fouten, waarschuwingen } }` |
| `POST /api/standen/<naam>/vastleggen` | `{ versie, behoud? }`: je huidige mapping en nachtrem in de stand; hub, pakket, kaart en master blijven; een nachtrem die al in de stand stond blijft ook (`opmerkingen` zegt het) |
| `POST /api/standen/terug` | `{ ok, delen, raakte, overgeslagen, fouten }`: zet terug wat de laatste activering veranderde; schrijft eerst zelf een `.vorige/` |
| `DELETE` | 405: weghalen = het bestand met de hand verplaatsen |

Een body boven 65 KiB krijgt 413 (op de `Content-Length`); een mapping wordt gemeten zoals hij in het
bestand komt (ingesprongen, UTF-8), zodat opslaan niet pas bij het schrijven weigert.

**Vorige terugzetten.** Elke activering schrijft eerst een `.vorige/` met de mapping en de nacht van dat
moment én `raakt`: welke van die twee de stand echt zet. "Vorige terugzetten" zet alleen die delen terug:
na `apc` (noemt geen mapping) blijft een regel die je daarna in de mixer koppelde staan, en na `maschine`
(noemt geen nacht) blijft de nacht zoals jij hem daarna zette. Twee grenzen erbij:
- de **nacht** blijft ook staan als de activering hem wel zette maar jij hem daarna met de hand
  veranderde (`.actief.json` houdt bij hoe hij erbij stond, `na`): terugzetten zet de nacht nooit tegen
  je eigen latere keuze in weer aan. De melding zegt het ("nacht: met de hand veranderd na de
  activering: blijft zoals hij is");
- de **mapping** gaat wel terug, ook als je daarna koppelde: dat terugzetten schrijft zelf weer een
  `.vorige/`, dus nog eens "vorige terugzetten" brengt je koppeling terug. Was er vóór de activering geen
  eigen mapping, dan wordt het een leeg verschil (= de standaard), niet "niets": anders laadt de mixer
  zijn reserve uit de browser, en daar staat dan de mapping van de stand.
Raakte de laatste activering niets: "vorige teruggezet: niets (de laatste activering veranderde mapping
en nacht niet)".

## 5. In de Controlekamer

- **Tegel "Opstelling"**, direct na Server: `geen` · de titel met `sinds 18:40` · oranje bij een
  waarschuwing (`sinds 18:40 · krat "proefkrat" is leeg (+1)`) · rood bij een fout · `vorige
  teruggezet 18:50`. Daaronder wat je zelf nog doet: *krat proefkrat (kies hem in de kaart) · hub-set
  studio: start hem zelf (npm start -- studio) · master Dub-worp: mixer volgt nog niet · profiel alles*.
- **Blok Openen**: een kiezer, **activeer** en **vorige terugzetten** (elk twee klikken binnen 4 s),
  en onder de kiezer wat activeren verandert ("nacht: uit → uit · vannacht niet · master: — →
  Dub-worp (mixer volgt nog niet)").
- **bewerk** (zonder JSON): per deel een keuzelijst (nacht, mapping, krat, master-rack, hub-set,
  mixer openen, avondpakket); **bewaar** (met versie: "intussen veranderd" als iemand anders het
  bestand veranderde), **bewaar als** (naamveld; Enter doet hetzelfde; hoofdletters worden kleine
  letters), **leg vast** (je huidige mapping en nachtrem erin; een rem die er al stond blijft). Heb je
  een keuze gemaakt en nog niet bewaard, dan weigert "leg vast" met "klik eerst op bewaar" (anders
  was je keuze stil weg); een andere opstelling kiezen meldt dat je keuzes niet bewaard zijn.
  Beeld, koptelefoon en vormen kun je hier nog niet zetten; die blijven zoals ze in het bestand staan.
- **mixer openen** gaat via de hub (`/?hub=ws://localhost:7700/app`) als de actieve opstelling
  `hub.mixerVia: true` zegt; de knop zegt dan "mixer openen via de hub". Daarnaast staat dan
  **zonder hub** (`/`): de uitweg als de hub niet draait (met `?hub=` opent de mixer zelf geen MIDI,
  dus zonder hub doet de APC dan niets).

Zonder browser: `node tools/standen/activeer.mjs` (lijst), `… apc` (activeren, verslag), `… --terug`,
`--poort 8821` voor een andere server. Code 1 bij een fout.

## 6. Grenzen (bekend, geen bug)

- **De mapping uit een stand geldt vanaf de volgende keer dat de mixer opent** (de mixer leest de
  server bij het opstarten). Staat de mixer al open en koppel je daarna iets, dan bewaart de mixer
  zijn eigen versie en wint die. Activeer een stand met een mapping dus niet terwijl je in de mixer
  koppelt. (Afgeleid uit de code van mapping-opslag; niet in de mixer geproefd.)
- **Het master-rack staat klaar voor als je het master-rack gaat gebruiken**: de server legt het
  vast, de mixer neemt het pas over in stap M (na de proefavond). Tot dan kies je het in de MASTER-rij.
- **De krat** wordt nagekeken, niet geopend: kies hem zelf in de kaart (stap D).
- **Een hub-set** start je zelf; een stand start nooit processen.
- **Twee tabbladen** (straks, stap M): het eerste mixer-tabblad neemt de stand over; open nooit een
  tweede (H16).
- **Uitzenden** blijft buiten de standen tot de keuze in VISIE §4 gemaakt is.

## 7. Hoe te testen

```zsh
node test/standen-model.test.mjs     # het formaat en de vier voorbeelden
node test/standen.test.mjs           # server/standen.js zonder server (ook terug, iCloud/threadpool, het geheugen)
node test/standen-server.test.mjs    # /api/standen op een eigen server
node test/stand-tegel.test.mjs       # de tegel, de regel, mixer openen, de meldingen
node test/stand-bewerker.test.mjs    # de bewerker
node test/nacht.test.mjs             # o.a. "vandaag niet" geldt voor de komende nacht
node tools/headless/standen.mjs [uitmap]   # Controlekamer in headless Chromium, 8822/9422
```

De headless-proef draait een eigen server met de verzonnen kaart, de nep-yt-dlp en een tijdelijke
map, Chromium met `--mute-audio` en zonder MIDI, en opent **geen** mixer-tabblad.

## 8. Wat niet getest is

- **Niet op de echte opstelling geproefd**, niet met Clay. Stap P (na de proefavond) eerst.
- De mapping-route is in de mixer niet geproefd (zie §6, eerste grens).
- Activeren terwijl er echt een nachtrun loopt: alleen met een nep-run (`_bezig`) getest.
- `avondpakket/profielen.json` bestaat in deze tak nog niet; de vorm (`{ profielen: { <naam>: … } }`)
  is een aanname uit spoor draagbaar.
- iCloud "dataless": nagebootst met een named pipe die niet terugkomt, niet met iCloud zelf. Dat `stat`
  op een echt dataless bestand niet blijft hangen is een aanname (zo werkt het bij APFS; niet gemeten).
- `varve-kaart.json` leest de kaart zelf synchroon (`server/kaart.js`, `readFileSync`); is dat bestand
  dataless, dan hangt de hele server bij het eerste `laad()`. Niet van deze tak; wel iets voor het
  avondpakket.
- Op 10 okt een rooktest op een proefserver (8821) met een kopie van Clay's library: Clay's eigen
  mapping (4 regels) bleef bij `apc` staan, "vannacht niet" kwam op 2026-10-10, de echte proefkrat
  (15) werd nagekeken, "terug" zette alles precies terug.

## 9. Na de proefavond

P proeven (maat: handelingen Dock → eerste geluid met/zonder stand; gebruikt Clay het op 2 van de
volgende 3 avonden zonder hulp?) → K koptelefoon en beeld → M master via de mixer (+ "mixer volgt") →
D de kaart opent op de krat → S VARVE.app als droplet (`open -a VARVE …/standen/apc.json`) → H de
hub-set noemt een stand → (L) live wisselen, alleen als een proefavond erom vraagt.
