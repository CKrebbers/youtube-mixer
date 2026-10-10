# Handelingenlog

ROADMAP 20, spoor D. VRAGEN G3 (ja, niet hash-exact) en G4 (geen blauwdruk-import).

Alles wat er op de action-bus gebeurt wordt vastgelegd, met het moment op de
AUDIOKLOK, plus genoeg om de set terug te vinden: welk nummer er op welke track
kwam, de focus, rack-, grid- en padwissels. Een log is terug te spelen: dezelfde
nummers op dezelfde tracks, en de actions op dezelfde momenten opnieuw de bus op.
Om een set opnieuw te renderen (met andere visuals, of opnieuw opgenomen) of een
fout na te spelen.

Niet hash-exact: de engine is niet deterministisch (streamen, netwerk, timers,
de audiothread), en regel 3 maakt een hash over de engine-staat onmogelijk. Wat
wel klopt: dezelfde actions, in dezelfde volgorde, hooguit één tik (10 ms) naast
hun moment.

## Waar het zit

| Laag | Bestand | Wat |
|---|---|---|
| bus | `src/control/actions.js` | `bijInvoke(fn)`: meeluisteren, vóór de action draait. `bindLog`: `log.toggle`, `log.replay.stop` |
| log | `src/control/handelingen.js` | `Handelingenlog` (vastleggen, per seconde wegschrijven), `leesLog`, `leesStand` |
| terugspelen | `src/control/terugspelen.js` | `maakPlan`, `Terugspeler` (klok, volgorde, laden), `maakUitvoerder` (wat een gebeurtenis voor de engine betekent), `kentSecties` |
| scherm | `src/ui/logboek.js` | knop en lijst, rack/grid/hotcues/sectiekaart/pads vergelijken, focus, koppeling met de opname |
| laden | `src/ui/laden.js` | `naLaad` (wat er geladen werd), `laadVoorTerugspelen`, `staat.terugspeelDecks` |
| sectiesprong | `src/engine/deck.js` | `drukPlek` (vanaf waar een sprong rekent), meldt `sectiedruk` |
| server | `server/handelingen.js` + routes in `server/index.js` | start, stuk op zijn plek, lijst, lezen |

De engine weet van niets (regel 1). Het log hangt aan de bus en aan de laadlaag.

## Waar het bewaard wordt

Naast de opnames: `opnames/set-<id>.acties.jsonl`.

Gekozen boven een eigen map, omdat:
- wat bij elkaar hoort bij elkaar blijft. Loopt er een opname, dan heeft het log
  HETZELFDE id als `set-<id>.wav` (en `.mp4`). Een set kopiëren, weggooien of
  meenemen neemt het log vanzelf mee; het is de partituur van die WAV.
- dezelfde id-reeks (datum-tijd, `-2` bij twee in één seconde), dezelfde
  `VARVE_OPNAMES` voor tests, en `opnames/` staat al buiten git.
- een los log (zonder opname) gewoon een set is die je niet opnam; die krijgt
  een eigen id uit dezelfde reeks. `opname.start()` kiest sinds nu ook geen id
  waar al een log op staat: anders schreef het log van een opname in dezelfde
  seconde in dat losse log.

`opname.lijst()` ziet alleen `set-*.wav`; logs komen via `/api/handelingen`.

## Wanneer het loopt

- **○ log** (naast de opnameknop) zet een los log aan en uit. Ook op de bus:
  `log.toggle` (geen APC-knop, bewust).
- **Een opname neemt er vanzelf een mee**, met hetzelfde id (`opnemer.onBegin` /
  `onEind`). Liep er al een los log, dan wordt dat afgesloten en gaat het na de
  opname als nieuw los log verder. Stop en start lopen synchroon tot hun eerste
  await: er valt geen handeling tussen het oude en het nieuwe log.
- Vastleggen begint METEEN (klok en buffer), niet pas als de server antwoordt.
  Mislukt de start, dan wordt het weggegooid en gemeld.
- Sluit je de pagina, dan gaat het laatste stuk nog weg met `keepalive`
  (`pagehide`), met een `eind`-regel `afgebroken: "pagina dicht"`.

## Het formaat (versie 1)

JSON Lines. Eén regel per handeling, `\n` ertussen. **Alleen ASCII**: alles
boven 0x7E staat er als `\uXXXX` (`asciiJson`), dus één teken is één byte. Zo
weet de browser precies op welke byte het volgende stuk begint, wat er ook in
een titel staat (JSON.parse geeft precies hetzelfde terug).

**Tijd `t`**: seconden op de audioklok (`ctx.currentTime`) sinds het begin van
het log, afgerond op 1 µs (ruim onder één sample van 21 µs). Staat de
AudioContext stil (vóór de eerste klik), dan staat ook `t` stil.

Twee soorten regels:

```
[t, "actie", waarde]                   een action van de bus
{"t": t, "e": "soort", ...}            een gebeurtenis
```

### Actieregel

```
[12.345667,"track.1.fader",0.5039370078740157]
[12.4,"track.1.play",true]
[12.4,"track.1.play",false]
```

Precies wat `invoke(id, waarde)` kreeg, van MIDI, toetsenbord, muis of
terugspelen: `value`-actions 0..1 in volle precisie (regel 2), triggers
`true`/`false`. Niets uitgedund: elke fader-stap staat erin. Een onbekende
action (niet in het register) komt er niet in.

Een regel die terugspelen de bus op zette, staat op het moment waarop hij
BEDOELD was: terugspelen komt tot een tik te laat en geeft dat mee
(`invoke(id, waarde, { laat })`), `neem` trekt het eraf. Zo schuift een
opname van een terugspelen (opnieuw renderen) niet per generatie een tik op.
Twee grenzen: een regel die op een laad of een stand wachtte krijgt geen
`laat` (anders stond hij vóór die laad, en speelde de volgende generatie hem
op het oude nummer), en geen regel komt eerder dan de regel ervóór: de
volgorde in het bestand blijft die van de bus.

**Een sectiedruk** (`track.N.section.*`, indrukken, terwijl de track speelt)
heeft een VIERDE element: de tracktijd waarvan de sprong rekende.
```
[12.4,"track.1.section.5",true,{"van":63.66128}]
```
Een sectie valt in op de "1" vanaf waar de speelkop staat, met een marge van
0,02 tel na de "1" (docs/SECTIES.md §3). Terugspelen komt tot een tik (10 ms)
te laat en ligt een stap van de audioklok (2,67 ms) naast het origineel; een
druk vlak na de "1" viel dan buiten die marge en landde een maat later
(gemeten, zie "Terugspelen"). Met deze plek neemt het terugspelen dezelfde
beslissing. De deck meldt hem zelf (`sectiedruk`, tijdens de action) en
logboek.js zet hem bij de regel die de bus net schreef
(`Handelingenlog.vulAan`): de plek waarvan de sprong ECHT rekende, ook als de
audioklok tussen het log en de sprong een stap verder ging. Ook een
"volgende/vorige" aan het eind van de kaart (de melding "al bij de laatste
sectie") draagt hem: terugspelen beslist dat vanaf dezelfde plek. Een oudere
terugspeler leest alleen de eerste drie elementen.

### Gebeurtenissen

**`kop`** (eerste regel, klein, zodat de lijst hem uit de eerste 4 kB leest):
```
{"t":0,"e":"kop","versie":1,"begon":"2026-09-25T18:13:02.123Z","klok":1234.567,"opname":"20260925-201302","sampleRate":48000,"tracks":8}
```
`klok` = de audioklok bij de start (om met een opname te vergelijken), `opname`
= het id van de opname of `null`.

**`stand`** (tweede regel): alles om het log op zichzelf af te spelen, ook als
het midden in een set begint. ~10 kB met acht tracks.
```
{"t":0,"e":"stand","focus":1,
 "tracks":[{"track":1,"bron":"library","nummer":"abc123","titel":"...",
            "positie":83.2,"speelt":true,"wacht":false,"rate":1.02,"bereik":0.16,
            "cue":12.1,"hotcues":[30.5,null,null,null],
            "loop":{"start":64,"end":72,"tellen":16}|null,
            "grid":{"stukken":[...],"beatsPerBar":4,...}|null,
            "secties":{"versie":1,"opGrid":true,"grid":"c94b3270","stukken":[...],...}|null,
            "kant":"A",
            "rack":{"data":{...rack-JSON...},"standen":{"1":0.4},"herkomst":17,"mix":0.5,"bypass":false},
            "kill":{"low":false,"mid":false,"high":false},"sprong":4},
           ...],
 "waarden":{"track.1.fader":1,"mixer.xfader":0.5,"video.fx.pixel":0,...},
 "rond":{"mixer.xfader.curve":0,"sampler.length":0.667,"video.mode":0,"transport.quantize":0,...},
 "pads":[{"track":2,"van":80,"tot":82,"bpm":124,"tellen":4,"speelt":false}|null, ...8],
 "herinneringen":[{"track":2,"van":...,"tot":...,"bpm":...,"tellen":...}|null, ...8]}
```
- `bron`: `library` (+ `nummer` = library-id), `demo` (+ `demo: {seed, bars}`,
  terug te maken), `los` (een losgesleept bestand: niet terug te halen) of `leeg`.
- `waarden`: de `read()` van elke value-action, BEHALVE `track.N.seek`, `.pitch`,
  `.tempo` en `.grid.bpm` (positie, tempo en grid staan per track, precies) en
  `track.N.key`: terugzetten zou de toonsoortkaart van het nummer bewerken (en een
  automatische kaart "met de hand" maken), en die kaart hoort bij de library.
- `rond`: triggers die rondlopen (`RONDLOPERS`): terugzetten = drukken tot de
  read klopt. Ook `transport.quantize` (één schakelaar voor de hele engine).
- Sinds ronde 3 (25 sep, dj-transport en dj-klank) per track ook:
  - `kill`: de kill-SCHAKELAARS per band. `track.N.kill.*` zijn toggles op de
    bus: zonder deze stand speelde een log dat met een kill aan begon omgekeerd
    terug. De drukvariant (`.hold`) niet: loslaten = weg.
  - `sprong`: de beatjump-lengte in tellen (`.halve`/`.double` lopen niet rond).
  - `wacht`: de track wachtte op zijn start op de maat (`play.quant`); dan is
    `speelt` false. Terugspelen start hem, nadat de rest speelt, opnieuw op de
    maat (`engine.startOpDeMaat`).
  - De remtijd (`track.N.brake.time`) is een value-action en staat in `waarden`.
  - Bewust NIET: een lopende rem (hij speelt bij terugspelen gewoon), het
    loop-in-punt en de vorige loop (reloop).
  Een ouder log zonder `kill` of `transport.quantize`: die bestonden toen niet,
  dus terugspelen zet ze UIT, wat er nu ook aan staat.
- Sinds de secties (6 okt) per track ook `secties`: de sectiekaart
  (`SectieKaart.toJSON()`, docs/SECTIES.md), of null. `section.5` betekent
  wat DEZE kaart zegt; de server kan de kaart intussen opnieuw rekenen (een
  ander grid, stems erbij), en dan lag sectie 5 ergens anders. Een
  sectie-loop heeft geen eigen veld: het is een gewone loop van het deck en
  staat in `loop` (met `tellen`); met de kaart erbij herkent `section.K.loop`
  hem weer (lampje aan, nog eens drukken = eraf). Een log zonder `secties`
  (van vóór 6 okt): terugspelen haalt de kaart dan van de server, zoals toen.
- Een `stand` kan ook MIDDEN in een log staan: daar begon een terugspelen terwijl
  dit log liep (opnieuw renderen). De beginstand daarvan zet posities, tempo,
  cues, loops en wat speelt buiten de bus om; zonder die regel was de opname van
  een replay zelf niet terug te spelen. Zie "Terugspelen", punt 5.

**`laad`**: een geslaagde laad, op het moment dat hij KLAAR was.
```
{"t":45.2,"e":"laad","track":2,"bron":"library","nummer":"abc123","titel":"...","duur":0.412,"grid":{...}|null}
```
`duur` = hoe lang het laden toen duurde (s); terugspelen begint zoveel eerder.

**`focus`**: `{"t":..,"e":"focus","track":3}`. Meteen, bij elke `change` van de
engine: de banen op het scherm zetten focus buiten de bus om.

**`rack`**: het rack van een track veranderde (kiezer, APC-bladeren, volgend
effect, de rack-editor). Inhoud én de live knopstanden op dat moment.
```
{"t":..,"e":"rack","track":1,"rack":{"data":{...},"standen":{...},"herkomst":"s:2","mix":0.5,"bypass":false}}
```

**`grid`**: het grid van een track veranderde (tap, grid-modus, de
tap-verfijning van de server, "opnieuw analyseren"): `{"t":..,"e":"grid","track":1,"grid":{...}|null}`.

**`hotcues`**: de hotcues van een track veranderden:
`{"t":..,"e":"hotcues","track":1,"hotcues":[30.5,null,null,null]}`. Vooral voor
de hotcues die na het laden van een library-nummer van de server terugkomen
(hotcue-opslag.js, buiten de bus om): zonder deze gebeurtenis ZETTE een
hotcue-knop bij terugspelen een nieuwe hotcue waar hij toen naar een bewaarde
sprong. Een hotcue-knop geeft er ook een (direct achter de action, zelfde
tijden). Sinds integratie-r2; een oudere terugspeler telt hem als onbekend.

**`secties`**: de sectiekaart van een track veranderde, meestal vlak na een
laad (laden.js haalt hem van de server, die hem misschien eerst uitrekent):
`{"t":..,"e":"secties","track":1,"secties":{...}|null}`. Zoals `grid`: een
gebeurtenis over het NUMMER. Een oudere terugspeler telt hem als onbekend.

**`pads`**: de bewaarde sampler-pads (herinneringen) veranderden:
`{"t":..,"e":"pads","herinneringen":[...8]}`.

**`eind`**: `{"t":..,"e":"eind","regels":N}` (N = alle regels, deze erbij), of
met `"afgebroken":"pagina dicht"`. Zonder `eind` is het log afgebroken (crash).

Rack, grid, hotcues, sectiekaart en pads worden VERGELEKEN, niet gemeld: na
elke knopdruk (een microtask, dus direct achter de action), vóór elke
sectiedruk (synchroon: een kaart die net binnenkwam staat dan vóór de druk;
zonder dat zag de druk bij terugspelen nog geen kaart), en elke 100 ms. Zo
komen ook de rack-editor, de server-verfijning en de library erin, zonder dat
die modules van het log weten. Rack op identiteit (`zetRack` maakt een nieuw
object, `bewerkMacros` een nieuwe lijst, `zetParam` nieuwe params), de
sectiekaart ook (`setSectieKaart` maakt er altijd een nieuwe), grid, hotcues
en pads op JSON. Knopstanden horen NIET bij de rack-vergelijking: die staan al als actions
in het log (anders een rack van 2 kB bij elke knopdraai).

### Lezen

`leesLog(tekst)` haalt nullen weg (een gat, zie hieronder) en slaat kapotte
regels over (een half geschreven staart na een crash) en telt ze. Een lezer
moet onbekende gebeurtenissen overslaan: nieuwe soorten mogen erbij komen
zonder dat oude logs onleesbaar worden. Een log met een HOGERE `versie` dan de
app kent wordt geweigerd.

## Wegschrijven

Elke seconde een stuk: `POST /api/handelingen/<id>/stuk` met
`{"van": <byte>, "tekst": "<regels>\n"}` (application/json). De server zet de
tekst op byte `van`, niet achter het bestand. Zoals de WAV met `?frame=N`
(opname.js):
- herhalen na een verloren antwoord schrijft dezelfde bytes op dezelfde plek:
  geen dubbele regels. Drie pogingen, dan melden.
- een stuk dat helemaal wegvalt laat een gat van nullen; alles erna staat op
  zijn eigen plek. De lezer slaat de nullen over.
- de plek wordt bepaald als het stuk gemaakt wordt, niet als het aankomt: de
  volgorde op schijf is de volgorde van de bus.
- een crash kost hooguit de laatste seconde.

De server keurt elk stuk: alleen afdrukbare ASCII en `\n`, eindigt op `\n`, elke
regel JSON, hooguit 4 MB, `van` een heel getal ≥ 0 en niet meer dan 256 MB
voorbij het eind. Het id moet `YYYYMMDD-HHMMSS(-n)` zijn (geen `../`). De body
wordt rauw gelezen (tot 8 MB) en pas dan gedecodeerd, zodat "te groot" (413)
iets anders is dan kapot (400). `leesJson` plakte pakketten vroeger als tekst
aan elkaar, zodat een teken over een pakketgrens stuk ging; sinds de controle
van 25 sep verzamelt die ook bytes (`server.test.mjs` stuurt een é over de grens).

## Routes

| Route | Wat |
|---|---|
| `POST /api/handelingen/start` `{id?}` | nieuw log. Met `id`: het log van die opname (de WAV moet bestaan; nog eens = goed zolang het log leeg is, anders 400: wie "ok" krijgt schrijft vanaf byte 0). Zonder: een nieuw id |
| `POST /api/handelingen/<id>/stuk` `{van, tekst}` | een stuk op zijn plek |
| `GET /api/handelingen` | alle logs, nieuwste eerst: `{id, bestand, bytes, duur, af, begon, versie, opname}` (kop + staart, niet het hele bestand) |
| `GET /api/handelingen/<id>` | het log (`application/x-ndjson`), precies de bytes van dat moment |

Alles JSON (de JSON-regel geldt), Host en Origin zoals overal. Na een
serverwijziging: server herstarten.

## Terugspelen

**↺** naast de logknop opent de lijst; **speel** (tweede klik binnen 3 s als er
iets op de tracks staat: het vervangt ze). Tijdens terugspelen toont ↺ de tijd;
klik = stoppen (de tracks spelen door). Op de bus: `log.replay.stop`.

1. **Beginstand**: alle nummers tegelijk laden (library streamend, demo opnieuw
   uit zijn zaad), dan per track bereik, kant, rack, kill, beatjump-lengte,
   grid, sectiekaart, rate, cue, hotcues, positie, loop; dan `waarden` via de bus, `rond` door te
   drukken, focus, pads; als laatste alles wat speelde in ÉÉN keer aan, zodat
   de tracks onderling liggen zoals toen, en daarna wie op de maat wachtte
   opnieuw op de maat. De klok loopt dan nog niet.
2. **T0 = ctx.currentTime**, en elke regel gaat de bus op zodra de klok T0 + t
   passeert. Een timer van 10 ms bepaalt hoe vaak we kijken, niet waar we zijn
   (regel 3). Gelijke tijden: in de volgorde van het log.
3. **Laden** begint op `t - duur`, zodat het rond hetzelfde moment klaar is.
   Duurt het langer, dan wachten de handelingen voor DIE track (en worden ze
   geteld als te laat); de andere tracks lopen door.
4. **Klaar** als alle regels gedaan zijn EN de duur van het log om is: opnieuw
   renderen duurt zo lang als het origineel. Stoppen (of klaar) laat los wat
   nog ingedrukt was: geen hangende bend. Stop je terwijl de beginstand nog
   laadt, dan blijft wat al geladen is staan, maar wordt er niets meer gezet
   of gestart (`nogBezig`).
5. **Een stand midden in het log** (zie het formaat) is een nieuwe beginstand:
   alles wacht, eerst op wat nog laadt, dan wordt de stand gezet, en de klok van
   het log staat zolang stil (T0 schuift op), net als bij het begin: vanaf het
   moment van de stand in het log, niet vanaf de tik die hem oppikte (tot 10 ms
   later; de stand zet de posities van dat moment). Een nummer
   dat er al staat (net door terugspelen geladen, of dezelfde demo) wordt niet
   nog eens geladen (`huidig`). Na elke stand roept de Terugspeler `onStand`;
   loopt er een log, dan schrijft logboek.js de stand van dat moment erin.

Wat NIET opnieuw de bus op gaat (`OVERSLAAN`):
- `record.*`, `log.*`: terugspelen start geen opname en geen log. Wil je de
  replay opnemen: eerst zelf ● opnemen, dan speel.
- `track.N.rack.next/prev`: welk rack dat wordt hangt af van wat er NU bij het
  nummer staat; de `rack`-gebeurtenis erna zegt precies welk.
- `layer.*`: welk mapje er op de APC open staat; dat gaat over je handen, en
  het zou de APC onder je vingers omzetten.
- `track.N.key` en `track.N.key.*`: de toonsoort corrigeren. De kaart hoort bij
  de plaat in de library (TOONSOORT.md §7) en de correctie van toen is toen al
  bewaard; terugspelen laadt de kaart van NU, en er nog eens een kwint bij doen
  zou hem twee keer toepassen. Ze staan wel in het log.

Een track zonder zijn nummer van toen (niet meer in de library, een los
bestand, laden mislukt, of leeg): transport, cues, loops, grid en seek, en
sinds ronde 3 ook beatjump en rem, sinds 6 okt ook de secties
(`NUMMER_NODIG`) worden overgeslagen en geteld, anders speelt `play` wat er
toevallig staat en springt `section.5` in een ander nummer. Faders, EQ (ook
kill), focus en kant gaan wel door. Ook de `grid`-, `hotcues`- en
`secties`-gebeurtenissen worden dan overgeslagen: anders kreeg een gewoon
geladen nummer (laden bij terugspelen mislukt) het grid van een ander nummer,
en de bewaarlus zette dat in de library.

**Secties** (6 okt, docs/SECTIES.md):
- De kaart komt uit het log (beginstand en `secties`-gebeurtenissen), NIET van
  de server: laden voor terugspelen roept `haalSecties` niet aan
  (`sectiesUitLog`, als `kentSecties(log)`). Anders overschreef de kaart van nu
  (misschien opnieuw gerekend op een ander grid) die van toen, en sprong
  `section.5` ergens anders heen. Een log zonder secties: de kaart van de
  server, zoals voorheen.
- Een sectiesprong is fasebehoudend (`seek` met `doorlopend`): een tik later
  geeft dezelfde plek. Behalve vlak na de "1": binnen 0,02 tel valt de sectie
  meteen in, daarna pas op de volgende "1". Een tik te laat kon daar een maat
  verschil maken (gemeten in echte Chrome, `sec-log.mjs` zonder `laat`/`van`:
  beide drukken vlak na de "1" landden een maat later, 1,93 s naast; met alleen
  `laat` nog eens één van de twee, door de stap van de audioklok naast het
  origineel). Daarom geeft terugspelen
  `{ laat, van }` mee (`invoke`, derde argument; `LAAT_MEE` = 50 ms, wat langer
  op een laad wachtte niet) en rekent de deck vanaf `drukPlek`: de plek uit het
  log (als die hooguit 50 ms naast ligt, `DRUK_NAAST`; in een loop die
  intussen rond ging, een loop verder), anders nu min `laat`.
  `section.next/prev` beslissen op dezelfde plek welke sectie, en of je al aan
  het eind bent (`naarSectieStap`; de melding komt van de action, niet meer
  van `waaromNiet`, die rekende vanaf de positie van NU en zette zo een
  teruggespeelde "volgende" stil die toen sprong).
- Gemeten (`test/secties-log.test.mjs`, nep-klok): vijf sprongen, een
  sectie-loop, drukken vlak na de "1", 3 ms naast, drie generaties: op elk
  meetmoment dezelfde positie (verschil < 1 µs, of precies de 3 ms naast). In
  echte Chrome (`tools/headless/sec-log.mjs`): dezelfde positie op de audioklok
  op 0 tot 8 ms na, zie Grenzen.

Rack-, grid- en padgebeurtenissen worden alleen toegepast als ze verschillen
van wat er al is (een rack dat de replay zelf al zette via `fx.next` geeft dus
geen tweede kruisfade). Een library-id als rack-herkomst wordt NIET
overgenomen (null): "bewaar" zou anders over een rack heen schrijven dat
inmiddels anders kan zijn. Een sjabloon (`s:2`) wel.

**MIDI en toetsenbord doen mee tijdens terugspelen.** Gekozen omdat:
- opnieuw renderen met andere visuals betekent live beeld spelen over de replay
  (docs/plugins/01-plan.md §5.5);
- een fader dichtdraaien moet altijd kunnen: een replay waar je niet in kunt
  grijpen is live gevaarlijk;
- blokkeren vraagt een poort in `invoke` die de replay omzeilt: meer machinerie
  op het hete pad.
Wil je een fout EXACT naspelen: niets aanraken. Soft-takeover voorkomt dat een
fader springt als hij niet staat waar de replay hem zette. Loopt er tijdens het
terugspelen een log, dan legt dat de replay plus jouw handelingen vast: een
nieuwe versie van de set. Wat de beginstand buiten de bus om zette staat
erin als een `stand` midden in dat log (punt 5), zodat die nieuwe versie zelf
ook terug te spelen is (`handelingenlog.test.mjs`: drie generaties).

**Niets bewaren.** Wat terugspelen laadt staat in `staat.terugspeelDecks` tot er
gewoon iets anders op die track geladen wordt. Voor die tracks gaat er niets
naar de library: geen grid (de bewaarlus slaat ze over), geen toonsoort (de
toon-bewaarlus ook niet), geen hotcues (`haalHotcues` wordt niet aangeroepen,
dus de hotcue-opslag weet niet welk nummer het is en stuurt niets), geen
tap-verfijning (het verfijnde grid van toen staat al in het log), geen
sampler-pads. Racks, pads en hotcues van het nummer worden bij terugspelen
niet uit de library gehaald; ze komen uit het log. De toonsoortkaart wel: die
is van de plaat (van nu), en alleen om te zien. Anders schreef een grid-bewerking uit de set van toen
opnieuw over het grid van nu heen (×2 op een grid dat al ×2 was).

## Grootte (gemeten, `test/handelingenlog.test.mjs`)

Met de echte klasse en echte regels, een uur lang, faders in stappen van 1/127:

| Een uur | Handelingen/s | Grootte |
|---|---|---|
| rustig | 5 | 0,8 MB |
| druk (driekwart draaien, een kwart drukken) | 50 | 8,4 MB |
| extreem: 300/s alleen draaien, een uur lang | 300 | 53 MB |

Een actieregel is ~47 bytes; de beginstand ~10 kB. Ter vergelijking: de WAV van
dat uur is ~690 MB. In het geheugen staat hooguit één seconde (de buffer gaat
elke seconde weg). Er wordt niets uitgedund en niets afgerond (behalve de tijd
op 1 µs).

## Het setboek (lezen achteraf, 10 okt)

`tools/setboek/lees.mjs` leest één of meer logs van een avond (op een KOPIE) en maakt er een
tracklist "hoorbaar (benaderd)" van, plus wat geladen maar niet gehoord werd en het gebruik.
Het gebruikt `leesLog` en dezelfde curves als de engine en de puls. Wat het log niet ziet (het
einde van een nummer, waar sync en beatjump de speelkop zetten, de sampler) staat in
`tools/setboek/LEESMIJ.md`. Een nieuw soort regel die de hoorbaarheid raakt (een nieuwe
knop die een track stil kan zetten): ook daar meenemen, met een check in `test/setboek.test.mjs`.

## Grenzen

- **Een sectiesprong landt op een stap van de audioklok na hetzelfde** (128
  frames = 2,67 ms bij 48 kHz): de beginstand ligt een stap naast (de klok tikt
  tussen het lezen van de stand en T0), en een sprong soms ook (de klok tikt
  tussen het lezen van de positie en het zetten van het segment, in de engine).
  Gemeten in Chrome: meestal 0, 2,7 of 5,3 ms; onder belasting (andere tests
  ernaast) tot 8,0 ms (review, 6 okt). Nooit een maat. Per sprong kan er een
  stap bij of af, dus een lange set met veel sprongen kan iets verder uitlopen
  (niet gemeten). Andere sprongen op de maat of de tel (een hotcue of beatloop
  met quantize, start op de maat) rekenen niet met `laat`/`van`: daar kan een
  tik te laat op de rand van hun marge nog een tel schelen.
- Een log zonder `van` (van vóór deze plek in het log): dan alleen `laat`. Een
  druk vlak na de "1" kan dan nog een maat verschuiven (een stap van de
  audioklok naast), en in een loop die tussen de druk en de tik rond ging,
  rekent hij vanaf vóór het loop-begin (een andere sectie). Met `van` niet.
- Een log dat begint TIJDENS de aanloop van een sectiesprong (minder dan een
  maat): positie, loop en kaart staan in de stand, de aanloop zelf niet
  (`_sectieSprong`); "volgende/vorige" rekent dan vanaf de positie, niet vanaf
  de sectie waar hij heen ging. Alleen anders als die sectie een andere "1"
  heeft (een stukgrens in het grid).
- **Niet hash-exact.** Een regel komt hooguit een tik (10 ms) na zijn moment;
  tap tempo meet met `performance.now()`, dus een replay van een tap kan een
  fractie van een bpm afwijken — de `grid`-gebeurtenis erna zet het grid van
  toen terug.
- Een los bestand is niet terug te halen (er is geen bestand). De demo wel.
- Een track die in het log leeg was wordt stilgezet, niet leeggemaakt (er is
  geen "leeg"-functie op het deck).
- Wat de rack-editor direct aan een knop doet (DICHT/OPEN, startstand) staat er
  alleen in via de volgende `rack`-gebeurtenis (die draagt de standen); de
  mix-knop in de editor ("MIX op 50%") net zo.
- Wijzigingen buiten de bus (rack-editor, server-verfijning) komen tot 100 ms
  later in het log dan ze gebeurden.
- Spelende sampler-pads bij het begin starten opnieuw op de eerste tel na de
  beginstand, niet op hun oude fase.
- De sends (echo, galm) hebben een vast rack: alleen hun knoppen (actions).
- In een achtergrondtab zonder geluid remt Chrome timers af; met spelende audio
  niet. Een replay houd je dus beter vooraan (zoals de video al vraagt).
- Het log van een opname begint in `onBegin`, vlak nadat de opname-worklet is
  aangesloten: `kop.klok` en frame 0 van de WAV liggen enkele ms uit elkaar
  (niet gemeten).
