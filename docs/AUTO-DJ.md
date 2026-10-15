# Auto-DJ (fase 1, gebouwd 30 september 2026)

Clay (30 sep): "ik wil een soort auto dj modus bouwen, en dit zien als de basis
voor het programma; juist de samenwerking tussen jou en het programma maakt het
interessant … de app altijd goed laten klinken door de keuzes die hij zelf maakt
en de keuzes die hij jou weergeeft als gebruiker." Daarna: "laten we het gewoon
gaan proberen."

Vooraf onderzocht door vier agenten (wat Varve al kan, auto-DJ in producten en
onderzoek, de samenwerking, de koppeling met Claude); de conclusies staan hieronder
waar ze gebruikt zijn.

## 1. Drie partijen, drie tijdschalen

| Wie | Tijdschaal | Doet |
|---|---|---|
| **De app** (`src/auto/`) | ms tot maten | kiest het moment, de soort overgang en de knopstanden, met harde bewakers. Klinkt altijd, ook zonder plan en zonder internet |
| **Clay** | altijd | ok / overslaan / langer / nu; wie een track in de overgang aanraakt, neemt hem over |
| **Claude** | minuten tot de set | schrijft het setplan (`plannen/auto-plan.json`): volgorde, beginpunten, speelduur, soort overgang, waarom. Nooit in het audiopad, nooit op de bus |

De automaat bedient Varve zoals Clay dat doet: **via de action-bus**. Alles
staat dus in het handelingenlog en speelt terug. Laden gaat via de laadlaag
(`laden.laadLibrary`, geen action). De engine weet niets van de auto-DJ (regel 1).

## 2. De bewakers ("altijd goed klinken")

- **Soort overgang** (`kiesOvergang`), de veiligste die past:
  - **lange blend** (16 maten, bas gewisseld in het midden): alleen als BEIDE
    grids op het mengpunt zeker zijn, het tempo ≤ 6% verschilt en de toonsoorten
    ≤ 1 stap op het Camelot-wiel liggen, **gerekend na de sync** (zonder keylock
    schuift de toon mee: Am op 121 → 128 klinkt als B♭m);
  - **filter-uit** (8 maten highpass + echo, de nieuwe valt in op de "1"): als
    het grid van de uitgaande zeker is maar tempo, toon of het andere grid niet;
  - **overvloeien** (24 s, beatloos: de uitgaande sluit met lowpass en galm, de
    nieuwe opent eronder): als het grid van de uitgaande onzeker is.
    **In Clay's library de hoofdroute**: bijna alle grids zijn onzeker.
  - Een plan mag altijd een veiligere soort vragen, nooit een riskantere: dan
    staat erbij "plan wilde …, maar dat klinkt hier niet goed".
- **Moment** (`planMoment`): blend en filter op een frasegrens (veelvouden van
  16 maten vanaf het maat-anker, anders de eerstvolgende 4-maatsgrens), zo laat
  mogelijk vóór het einde van het fragment. Beatloos: 24 s vóór het einde.
  Met een sectiekaart bij voorkeur op een sectiegrens: de outro, een break,
  nooit midden in een drop als het anders kan (§3b).
- **Nooit twee bassen** tegelijk (blend: getest over de hele curve).
- **Nooit een gat**: speelt er niets meer (einde, of Clay zette alles stil),
  dan start de klaarstaande meteen, of wordt er meteen iets gekozen.
- **Clay wint**: fader, EQ, filter, play, sync, seek, tempo, sends, hotcue of
  een sectie (`section.K`, `.K.loop`, `.next`, `.prev`) van een track in de
  overgang (of de crossfader) = overgenomen. De automaat laat los en gaat
  verder als er weer één track duidelijk klinkt.

## 2b. Hoe hij aan de knoppen draait: glijdend (A7, 2 okt)

Een overgang is een curve (`standen()` in planner.js). Die gaat niet meer als
een trapje van 0,01 per tik van 40 ms over de bus, maar als **glijbeurten**:

- **Actions** `track.N.fader.glide`, `track.N.filter.glide`, `track.N.send.a.glide`,
  `track.N.send.b.glide`: een gewone value-action (0..1, regel 2) met als
  betekenis "glijd hierheen in `GLIJ` = 0,5 s". Geen `read` (de stand lees je
  van de knop zelf), dus niet in de beginstand van het handelingenlog.
- **De automaat** (`_glij`) stuurt per knop het punt van de curve dat GLIJ
  seconden verderop ligt, gerekend vanaf de POSITIE van de uitgaande (GLIJ s
  klok = GLIJ × rate tracktijd, regel 3), en een nieuw punt zodra de lopende
  helling nog 0,1 s te gaan heeft (`HERRICHT`). Zo volgt de knop de curve als
  een reeks rechte stukken van ~0,4 s (afwijking van de curve < 0,05 dB), en
  hapert de timer een paar tikken, dan komt de helling aan en staat hij even
  stil: nooit een sprong. Net vóór het einde kijkt hij niet voorbij p = 1
  (`BIJNA`): het einde zelf (filter-uit: fader dicht op de "1"; alles terug
  naar neutraal) blijft een directe stand van `_rondAf`.
- **De bas** (`low`) glijdt NIET: in de curves is hij een schakelaar (de
  baswissel in het midden van de blend), en die gaat direct en voor beide
  tracks in dezelfde tik, zoals vroeger. Zo blijft "nooit twee bassen" waar
  en ontstaat er geen gat in de bas. De crossfader stuurt de automaat niet
  (alleen de kant per track bij het klaarzetten).
- **De engine** (`Deck.glide`, deck.js): per glijbeurt acht lineaire
  hellingen op de AudioParams (fader in gain langs de dB-schaal van de knop,
  filter in Hz langs `filterDoelen()`, sends kwadratisch), beginnend na
  `startDrempel`. Een nieuwe glijbeurt laat de lopende helling DOORLOPEN tot
  dat beginpunt en gaat daar verder (`zetVervolg` in overgang.js:
  `cancelAndHoldAtTime` in de toekomst): geen sprong en geen plateau.
  Nooit `setValueCurveAtTime`.
- **Ingrijpen**: een gewone `set` (Clay's fader, of een directe stand van de
  automaat) midden in een glijbeurt houdt de parameter vast waar het geluid NU
  is (`houdVast`) en gaat van daar met `setTargetAtTime` naar de nieuwe stand;
  de rest van de glijbeurt is weg. Overneemt Clay, dan stuurt de automaat
  niets meer; wat op de andere track nog glijdt loopt hooguit 0,5 s uit.
- **read()** van fader, filter en sends geeft tijdens het glijden de stand van
  NU, afgeleid van `ctx.currentTime` (`deck.ui` leest via een getter
  `_stand()`), dus scherm, LED-ringen, soft-takeover, maatgever en
  video-zichtbaarheid lopen mee zonder extra bus-acties.
- **Handelingenlog en terugspelen**: de glijregels staan in het log als elke
  andere action (`[t, "track.2.fader.glide", 0.37]`), een paar per seconde per
  knop die beweegt (in auto.test een hele blend 84 bus-acties, was 174; een
  beatloze overgang met klaarzetten 209, was 291). Terugspelen zet ze op
  T0 + t opnieuw op de bus en legt dezelfde hellingen (getest: hetzelfde
  aantal, en hooguit 0,02 dB ernaast, binnen één tik van 10 ms).
- **Headless Chromium** (`tools/headless/auto.mjs`, 2 okt): tijdens de blend
  steeg de fader van track 2 gelijkmatig (1 van 987 metingen van ~10 ms
  bijna stil; met de oude trapjes 762 van 982), read() en AudioParam hooguit
  0,04 dB uit elkaar (was 0,63), langste stilte op de master 0 ms, geen
  consolefouten. Niet beluisterd.

Waarom zo en niet anders: een tweede getal (de duur) past niet in een
value-action; een "glijtijd" per track als losse instelling zou ook Clay's
eigen fader laten glijden zolang hij aan stond, en in het log zou de volgorde
van die twee regels ertoe doen. Een vaste duur in de engine houdt elke regel
op zichzelf terug te spelen, en de automaat hoeft niets van dB of Hz te weten.

## 3. Wat hij speelt

- Met een plan: de stappen op volgorde (onbekende of overgeslagen nummers eruit).
- Zonder plan, of als het op is: de **kiezer** (`kiesVolgende`): niet wat speelt
  of deze sessie al speelde, dan tempo dichtbij, toon dichtbij (alleen als beide
  zeker), luidheid dichtbij, en wat toeval.
- **Fragmenten**: een nummer tot 12 minuten helemaal (of zo lang als het plan
  zegt); een mix of album in een stuk van 6 minuten, bij voorkeur waar een zeker
  toon- of gridstuk begint. Het plan kan `van` en `speelduur` geven. Met een
  sectiekaart: in op de intro, of op een sectiegrens (§3b).
- Laden: heen en weer tussen de tracks die de automaat al gebruikt (zoals twee
  decks), anders een lege. Nooit een track die speelt. De nieuwe krijgt dezelfde
  crossfaderkant als de uitgaande.

## 3b. Secties als frasegrenzen (6 okt, tak `studio/sec-auto`)

Met de sectiekaart van een nummer (docs/SECTIES.md) mixt de automaat op de
vorm van het nummer in plaats van op een teller vanaf het maat-anker. Puur in
`planner.js` (`fragment`, `planMoment`, `sectieGrens`, `momentArgs`); de
automaat haalt de kaarten en geeft ze mee.

**Wanneer telt een kaart.** Alleen een kaart die op het grid gerekend is
(`opGrid`, `sectiesVan`), en een sectiebegin alleen als het grid daar zeker is.
Een sectiebegin ligt op een maat; afgerond (4 decimalen) telt 0,02 tel ervoor
nog als die maat. Zonder kaart, of zonder zeker grid: precies het oude gedrag
(`test/auto.test.mjs` is ongewijzigd groen).

**Inmixen** (`fragment`, de nieuwe). De voorrang:
1. `in` van de planstap van de nieuwe (`{ sectie: K, label, groep }`, het spoor
   plan), teruggevonden zoals hieronder ("Terugvinden"), als er daarna nog
   minstens 60 s te spelen is (`MIN_FRAGMENT`, of de kortere speelduur van het
   plan); anders valt hij door;
2. `van` uit het plan;
3. een keuze uit de secties: een nummer tot 12 minuten op de **intro**; een mix
   op een sectiegrens met ruimte voor een heel fragment, de rustigste soort
   eerst (intro, break, opbouw, deel, drop, outro), daaruit de zekerste helft
   (`zeker` van de grens) en daaruit een willekeurige;
4. het oude gedrag.

**Uitmixen** (`planMoment`, de uitgaande). De voorrang:
1. `uit` van de planstap die NU klinkt (teruggevonden zoals hieronder): de
   overgang BEGINT op het begin van die sectie (als hij tussen "vroegst" en
   het einde past en de bewakers het toelaten; een plan mag verder naar voren
   dan het venster hieronder);
2. zelf kiezen, binnen 32 maten (beatloos 60 s) vóór het laatste moment dat nog
   past (anders trekt een vroege break de overgang minuten naar voren):
   waar de **outro** begint → de laatste **break** → het oude moment, als dat
   niet midden in een drop valt → het laatste begin van iets anders dan een drop
   → het begin van een drop → het oude moment.
De overgang begint altijd op de "1" van de sectie en duurt even lang als
zonder secties (16 of 8 maten, of de lengte uit het plan); past hij niet vóór
het einde, dan telt die sectie niet. Voorbeeld (`test/auto-secties`, 120 bpm,
einde op 190 s): zonder secties begint de blend op 128 s, midden in de tweede
drop; met secties op 144 s, waar de outro begint.

**Terugvinden** (`vindSectie`, review 7 okt). De kaart kan sinds het plannen
opnieuw berekend zijn (een stuk erbij of eraf: andere nummers), en labels komen
terug ("drop D" twee keer). Kandidaten zijn de stukken met dezelfde label en
groep (zonder label en groep alleen stuk K). Daarvan het stuk dat het dichtst
ligt bij de tijd van toen: `van` van de stap (voor `in`) of `van` in de
verwijzing zelf; zonder tijd bij waar stuk K NU begint. Met een tijd telt de
sectie alleen binnen 30 s (`SECTIE_SPELING`): anders is die tijd de waarheid
(het contract: `van` blijft de waarheid en de terugval). Voorbeeld: het plan
zei `uit` = sectie 6 "drop D" (de tweede drop, 112 s); na een herberekening
met een stuk extra vooraan is dat sectie 7. Vroeger koos hij de eerste drop D
(64 s, 48 s te vroeg), nu die op 112 s.

**De bewakers gaan voor.** Eerst kiest `kiesOvergang` de soort, op het eind
van het fragment, zoals altijd. Secties veranderen die soort nooit en maken
niets onveiliger: een sectiebegin telt alleen als dezelfde soort daar OOK mag
(`mag`: `kiesOvergang` met de kenmerken van de uitgaande op dat begin, dus
tempo, toon en grid dáár). Ligt een break in een stuk met een ander tempo, dan
mixt hij daar niet, ook niet als het plan het vraagt. Dat geldt ook voor een
sectiegrens bij `langer` en `nu`; de gewone 8 en 4 maten toetsen het niet
(zoals vroeger).

**Eén rekenregel voor automaat en planvenster.** `momentArgs` (planner.js)
maakt de argumenten voor `planMoment` uit wat ook het planvenster heeft: de
soort, het grid en het library-nummer (of de kenmerken) van de uitgaande, de
kenmerken van de nieuwe, de sectiekaart en `uit`. De automaat gebruikt hem zelf
in `_planOvergang`. Bij beatloos geeft hij `grid: null` voor de timing maar
houdt `zeker` op het grid van de uitgaande, en `mag` (de bewakers) zit erin:
zelfde invoer, zelfde moment (getest voor blend en beatloos).

**De race.** `/api/library` geeft geen secties; `laden.js` haalt de kaart pas
NA het laden op, zonder te wachten. Daarom krijgt de automaat een eigen
`haalSecties(trackId)` (app.js: `GET /api/library/<id>/secties?maak=1`; twee
vragen tegelijk rekent de server één keer):
- `_bereidVoor` vraagt de kaart tegelijk met het laden, en wacht daarna nog
  hooguit 3 s (`wachtSecties`); komt hij niet, dan het oude beginpunt. Hij
  wacht nooit zo lang dat de overgang zonder kaart zou verschuiven: hij rekent
  het moment uit dat hij NU zou plannen (met en zonder de secties van de
  uitgaande) en stopt met wachten vóór "vroegst" (positie + 8 s × rate) daar
  aankomt (bij elke tik gekeken, op de positie: regel 3). Zo is het zonder kaart
  precies het oude gedrag, ook als de kaart traag is (review 7 okt: kort vóór
  het eind maakte 3 s wachten van een blend op 160 s een overgang die niet meer
  paste, elke tik opnieuw gepland, en een harde knip aan het eind). Speelt er
  niets (meteen starten), of valt wat klinkt stil terwijl hij wacht, dan wacht
  hij niet (langer): nooit dode lucht voor een kaart.
- Wat later binnenkomt wordt toch bewaard (per track, de laatste vraag wint).
- De kaart van de UITGAANDE: die van het deck (laden.js), anders die de
  automaat zelf ophaalde (alleen voor het nummer dat er nu op staat). Komt er
  een andere binnen terwijl de volgende klaarstaat, dan plant hij het moment
  opnieuw, maar niet als Clay `ok`, `langer` of `nu` drukte, en niet binnen 2
  maten of 8 s vóór de start (het aftellen springt dan niet meer). Dezelfde
  kaart nog eens (laden.js na de automaat) doet niets.
- Gemeten in Chrome (`tools/headless/sec-auto.mjs`, eerste versie zonder de
  kaarten vooraf te rekenen, op een drukke machine): de kaart van de eerste
  track kwam 5,3 s na het laden. De automaat plande eerst zonder (147,4 s),
  plande opnieuw toen hij binnenkwam, en de nieuwe viel in op de outro (~139,7 s).

**Clay springt.** Een sectie, sectie-loop, volgende of vorige op een track in
de overgang = overgenomen (OVERNEEM), maar alleen als die sectie daar bestaat:
een pad zonder sectie (op de Maschine bij 7 secties 9 van de 16 pads), een
track zonder kaart of volgende/vorige aan het eind springt niet en telt dus
niet (`sectieSpringt`, review spoor maschine). Op de track die nu klinkt terwijl de
volgende klaarstaat is het geen overnemen. Sprong de positie echt (de bus hoort
de druk vóór de sprong; bij de volgende tik vergelijkt hij de positie met
gewoon doorspelen, > 0,1 s ernaast = een sprong), dan plant hij opnieuw. Een
druk die niets doet (geen kaart op het deck, een pad zonder sectie, een loop om
de sectie waar je al bent) verandert niets. Past een nieuw moment niet meer
vóór het einde van de track, dan blijft het oude, en loopt de overgang vanaf
waar je bent, zoals na een seek of hotcue. Een sectie-LOOP vóór het moment
houdt de automaat (net als een gewone loop) aan het wachten tot je hem eraf haalt.

**Langer en nu.** `langer` gaat naar de volgende sectiegrens als die binnen 16
maten (beatloos 60 s, alleen op een zeker grid) komt; anders 8 maten (30 s)
zoals altijd. `nu` gaat naar de volgende sectiegrens als die binnen 8 maten
komt; anders de eerstvolgende 4-maatsgrens. Beatloos blijft `nu` meteen.

**Uitleg.** De tooltip van de AUTO-rij zegt erbij "uit op outro F (sectie 7)"
en "in op intro A (sectie 1)" (`stand().volgende.redenen`).

**Planstappen.** `in` en `uit` worden defensief gelezen (`{ sectie ≥ 1 }` of
een label/groep; anders genegeerd): in deze tak gooit `normaliseerPlan` ze nog
weg, het spoor plan voegt ze toe. Lezing: `in` van stap i = waar het nummer van
stap i begint; `uit` van stap i = waar het nummer van stap i eruit gaat (de
overgang naar stap i+1 begint daar). `uit` past alleen binnen het einde van
het fragment (`van` + `speelduur`): wie later uit wil, geeft een langere
speelduur.

## 4. Bediening

Knop **auto** in de balk opent de AUTO-rij (blijft onthouden; de knop kleurt als
de automaat aan staat). In de rij: aan/uit met de fase (kiest, laadt, klaar,
mixt, jij mixt) · wat nu klinkt en hoe lang nog · wat er komt: track, toon,
soort overgang, over hoeveel maten (of mm:ss), "plan" · tooltip = waarom ·
**ok** (bevestigd) · **overslaan** · **langer** (+8 maten, beatloos +30 s) ·
**nu** (eerstvolgende 4 maten) · het plan en de stap.

Actions: `auto.aan`, `auto.ok`, `auto.skip`, `auto.langer`, `auto.nu`.
Op de APC: modus auto (Shift + scene 4 of ▲ ▼), bovenste rij ok · overslaan ·
langer · nu en pad 8 aan/uit, met lampjes die tonen of er een voorstel klaarstaat
(docs/APC40.md, "Modus auto"; gebouwd 2 okt, AU1).

## 5. Het setplan (Claude schrijft, de app volgt)

`plannen/auto-plan.json` (formaat v2 en opslaan met versie: docs/PLAN.md). Het
plan wordt gelezen bij het aanzetten, en daarna elke 3 s gecontroleerd: een
nieuwe versie (planvenster of Claude) gaat live naar de automaat.

```json
{ "naam": "piano naar piek", "door": "Claude, 30 sep 2026", "uitleg": "…",
  "stappen": [
    { "track": "<library-id>", "van": 177, "speelduur": 300,
      "overgang": "auto|blend|filter|ambient", "waarom": "…" } ] }
```

`overgang` geldt voor de overgang NAAR die stap. Zo maakt Claude een plan:
`curl -s localhost:8777/api/library?aantal=500` op de Mac (alleen metadata),
per nummer de toon- en gridstukken met hun zekerheid lezen, een boog kiezen
(energie, toon naast elkaar op het wiel), beginpunten op zekere stukken, en het
plan droog doorrekenen met `planner.js` (`kenmerken`, `kiesOvergang`) om te zien
welke overgangen de app zal kiezen. Het eerste plan (30 sep) liep zo: 28 min,
vijf keer overvloeien en één filter-uit (uit de jungle-piek, waar het grid zeker is).

## 6. Getest

- `test/auto.test.mjs` (91 checks): de planner (Camelot, soort, sync-verschuiving,
  frasegrenzen, curves, fragment, kiezer) en de automaat op een echte engine met
  nep-Web Audio: van stilte, klaarzetten, langer/nu/ok, een hele blend (sync, op
  de maat, nooit twee bassen, netjes terug), de volgende op de andere track,
  overslaan naar de kiezer, overnemen, dode lucht, en een hele beatloze overgang
  (nooit een gat). Sinds A7 op een nep-Web Audio met een TIJDLIJN per
  AudioParam (`test/nep-tijdlijn.mjs`, net zo streng als engine.test): de fader
  gaat open als helling (0 van ~2450 stukjes van 5 ms staan stil; met de oude
  trapjes 2023), read() geeft de tussenstand, Clay grijpt midden in een
  glijbeurt in zonder sprong, en terugspelen op een tweede engine legt dezelfde
  hellingen. `engine.test` test `Deck.glide` zelf (opnieuw richten zonder
  plateau, set breekt af, filter in octaven, sends kwadratisch, de bus).
- `test/auto-secties.test.mjs` (6 okt, §3b; 85 checks na de review): de planner met secties (outro,
  break, het venster, niet midden in een drop, uitSectie/inSectie en hun
  terugval, alleen op een zeker grid, `mag`) en de automaat op een engine: uit
  op de outro en in op de intro, een kaart die later komt (opnieuw plannen;
  dezelfde nog eens niet), de race (wachten, nooit, mislukt, stil terwijl hij
  wacht), `uit` uit de
  planstap, langer en nu naar de volgende grens, een sectiesprong van Clay
  (opnieuw plannen, niet meteen beginnen), de bewakers boven de secties, en
  OVERNEEM voor `section.*`. Na de review (7 okt) ook: een trage kaart kort
  vóór het eind (zelfde moment als zonder kaart), herhaalde labels na een
  herberekening, `in` zonder ruimte, `momentArgs` = de automaat (blend en
  beatloos), de wachters bij een late kaart (ok, langer, nu, vlak voor de
  start), een druk zonder sprong, secties net naast de maat, het volgnummer
  per vraag, en `mag` bij langer en nu. 19 mutaties van de review gevangen.
- `tools/headless/sec-auto.mjs` (6 okt) in Chrome (headless shell): twee
  synthetische nummers (`test/synth-nummer.mjs`, outro van 24 maten) via de
  ingest, het grid op het bekende antwoord, de kaarten van de server. Blend uit
  op de outro van A (139,65 s; zonder secties 124,17 s, midden in de tweede
  drop), in op de intro van B (0,30 s, de eerste "1"); B begon te spelen toen A
  op 139,67 s was, daarna klinkt B alleen; langste stilte op de master 59 ms;
  geen consolefouten. Eigen lege plannenmap (`VARVE_PLANNEN`), poorten 8901/9501.
- `tools/headless/auto.mjs` in headless Chromium (Linux): een set van drie
  demotracks via de rij en de knoppen: blend (gesynct op 124), dan filter-uit naar
  een track met een onzeker grid; langste stilte op de master **0 ms**; geen
  consolefouten. Foto's `tools/headless/uit/auto-*.png`.
- `server.test`: `plannen/` in de witte lijst, alleen `.json`, geen uitstapjes.

Niet getest: met Clay's echte library in zijn Chrome (streaming, lange mixen,
seek naar een beginpunt midden in een uur), met de APC, op de M1. Niet beluisterd.

## 6b. Een set waar Clay live bij mixt (spoor S9, 14 okt)

Volledig in `docs/PLAN-SET.md` §4. Wat de automaat erbij kreeg (`test/auto-set.test.mjs`):
- **Tracks van de automaat** (`plan.tracks.auto`): hij laadt, start en mixt alleen daar; na een
  overname wacht hij alleen op ZIJN tracks. Zonder `tracks` kiest hij zelf, maar **nooit een track
  waar Clay de laatste 2 minuten iets aan deed** (`CLAY_RECENT`, elke `track.N.*` op de bus van
  iemand anders dan de automaat) en nooit een track met een laag. AU4 is daarmee beantwoord.
- **GO** (`go: 'wacht'`, `plan.go`): klaarzetten zoals altijd, beginnen pas na GO; zonder GO op
  het laatste moment dat de overgang nog past (`_goUiterst`), met een melding. Nooit stilte.
- **Buiten plan / terug** (`plan.buiten`, `plan.terug`): los laten (een lopende overgang eerst
  af), en terug = wat het hardst klinkt wordt de hoofdtrack. Ook uit "jij mixt" (overgenomen).
- **Lagen**: 30 s vooraf laden op een track van Clay (fader dicht), op zijn moment (sectie of tijd,
  op de POSITIE van de hoofdtrack) starten (op de maat met sync als beide grids zeker zijn), de
  fader in 4 maten naar 0,8, na `duur` weer dicht. Raakt Clay de track aan: de laag is van hem.
  Sampler en patroon: op het moment de action, anders niets.
- **Nooit stilte na een overname**: speelt er helemaal niets meer (ook niet op Clay's tracks), dan
  gaat hij meteen verder met de set.
- Actions `plan.*` met `log: 'overslaan'`: terugspelen herhaalt wat de automaat deed, niet de knop.

## 7. Bekende grenzen (fase 1)

- Fades zijn sinds 2 okt (A7) glijbeurten: rechte stukken van ~0,4 s op de
  audioklok (§2b), geen trapjes meer. Nog niet: de baswissel is een directe
  stand (setTarget, ~30 ms) op de tik waarop p ≥ 0,5, dus tot één tik (40 ms)
  na het midden, niet sample-exact op de tel. Niet beluisterd: alleen gemeten
  in de nep-Web Audio en headless.
- Frasegrenzen uit de muziek alleen met een sectiekaart op een ZEKER grid
  (§3b). In Clay's library zijn de meeste grids onzeker: daar blijft het
  overvloeien op tijd (24 s vóór het einde), zonder secties. Labels zijn een gok
  uit energie en drums (SECTIES.md §5): "drop" is de luidste groep, ook in een
  popnummer. Hotcues als mix-in/mix-out: nog niet.
- Na een blend blijft de nieuwe op het tempo van de oude (geen "tempo terug").
- De timer (40 ms) kijkt alleen wanneer; in een achtergrondtab zonder geluid
  knijpt Chrome timers (HANDELINGENLOG "Grenzen"), maar er speelt dan altijd iets.
- Claude plant alleen vooraf. Live bijsturen (fase 2) vraagt een kanaal server ↔
  tabblad; zie §8.

## 8. Volgende fases (voorstel)

- **Fase 2, Claude live:** `/api/auto/*` (status, wachtrij voorstellen, plan
  vervangen) met een token, en een SSE-kanaal naar het tabblad; Claude Code
  praat daar met curl of een kleine MCP-server buiten de app. Clay: "meer
  energie" in gewone taal → het plan van de volgende 3–6 nummers.
- **Fase 3, leren:** uit het handelingenlog (ook van vóór de auto-DJ) lezen hoe
  Clay zelf overgangen maakt (lengte, EQ, welke hij overneemt) en dat als
  gewichten in de planner; na een set leest Claude het log en schrijft een
  stijlnotitie voor het volgende plan.
- Klankschaal als brug bij beatloze overgangen (een kern-aanslag op de toon van
  de nieuwe), frase- en energieanalyse, keylock (dan mag de blend verder).

## 9. Open vragen (VRAGEN blok L)

- ~~**AU1 🎛** Welke APC-knoppen voor ok/overslaan/langer/nu?~~ Gebouwd 2 okt als
  zesde grid-modus (geen fragment: de auto-DJ hangt niet aan een vlag), zie §4.
- **AU2 👂** Klinkt overvloeien in 24 s goed bij jouw muziek, of langer (32–48 s)?
- **AU3 👂** Moet "nu" bij beatloos echt meteen, of 4 s later zodat je het ziet aankomen?
- ~~**AU4 💬** Mag de automaat tracks laden op een lege track als jij daar straks iets wilt?~~
  S9: `tracks` per plan, en zonder: nooit een track die je de laatste 2 minuten aanraakte (§6b).
