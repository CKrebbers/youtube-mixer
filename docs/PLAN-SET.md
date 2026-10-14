# Een set klaarzetten en live bijmixen (spoor S9, 14 okt 2026)

Clay (14 okt): "En bij het plan moet je makkelijk en snel een hele set klaar kunnen zetten waar
je dan zelf nog onderdelen live moet bij kunnen mixen." En later die dag: "Voeg ook toe dat ik
sets kan opslaan en terugladen." (docs/werkruimte/S9-aanvulling.md)

Bouwt op docs/PLAN.md (het planvenster, formaat v2), docs/AUTO-DJ.md (de automaat en zijn
bewakers), docs/SECTIES.md §7 en de werkruimte (S3, S7, S8). Dit is het ontwerp; §9 zegt wat er
gebouwd is.

## 1. Het idee in één alinea

Een plan wordt een **set**: een volgorde van nummers die de automaat speelt op **zijn eigen
tracks**, terwijl Clay op **zijn tracks** live bijmixt (extra nummers, stems, sampler,
instrumenten, patronen, effecten). Klaarzetten is één keuze (een krat, een selectie of een
"past bij"-keten) en één knop; daarna is de set een gewone lijst die je sleept en per stap
bijstelt. Een stap kan wachten op **GO**, en kan een **laag** meenemen: een extra stuk op een
track van Clay (een acapella, een sample, een patroon) dat Clay overneemt of overslaat. Een
**live-stand** zegt NU / VOLGENDE / DAARNA en hoe laat de set klaar is. Een **set** als geheel
(plan + patronen + werkruimte + optioneel een momentopname van de mixer) bewaar je op naam en
laad je terug.

## 2. Snel klaarzetten

**Bron, één keuze.** In het planvenster, linksboven bij "maak set van":
- een **krat** van de kaart (alleen de nummers die binnen zijn, `GET /api/kaart/nummers?krat=`);
- een **selectie** in de lijst rechts (aanvinken, shift-klik voor een reeks);
- een **"past bij"-keten** vanaf een nummer (het gekozen nummer, of wat er op de focus-track staat):
  steeds het best passende volgende nummer volgens `beoordeel()` van past-bij.js, dezelfde regels
  als de bewakers;
- de **hele library** (als laatste: handig om te proberen).

**Volgorde, voorstel** (`src/plan/klaarzetten.js`, puur): elk nummer krijgt een ENERGIE uit wat we
weten (bpm, luidheid, de energie van de luidste sectie als er een kaart is), genormaliseerd binnen
de keuze. De set volgt een **boog** (rustig begin, piek op ~70%, iets terug aan het eind) of
**oplopend**, of **zoals gekozen** (de volgorde van de krat of selectie). Gulzig: elke plek kiest
het nummer dat het dichtst bij de boog ligt plus de kosten van de overgang vanaf het vorige
(tempo, toon na de sync, en of de bewakers er een blend of filter van maken). Deterministisch:
dezelfde keuze geeft dezelfde set (geen toeval).

**Lengte of eindtijd.** "duur 90 min" of "tot 01:30" (vanaf nu, of vanaf een begintijd). De
voorspelling (`voorspel`, tijdlijn.js) rekent de echte lengte uit; is hij te lang, dan krijgt elk
stuk eerst een kortere speelduur (nooit korter dan 2 min, en nooit langer dan het nummer), en
blijft het te lang dan vallen de laatste nummers af (gemeld). Te kort: gemeld, niets verzonnen.

**Herschikken**: slepen aan ⋮⋮ (bestaat), alt+↑↓ (bestaat). **Overgang per stap**: de keuzelijst,
of met de stap gekozen de toetsen 1 auto · 2 blend · 3 filter · 4 overvloeien · G = GO-stap aan/uit.

**Claude** blijft het plan schrijven (PUT met versie, 409, docs/PLAN.md §3). De nieuwe velden
(§5) staan in `kent`, zodat een oud venster ze niet wist (zelfde mechaniek als in/uit).

Handelingen voor een set van 12 nummers uit een krat: krat kiezen (1), "maak set" (2), "gebruik
dit plan" (3, slaat ook op), auto aan (4). Gemeten in §9.

## 3. Klaar voor de set

Per nummer in het plan een kolom **klaar**: vijf tekens, groen/oranje/grijs:
`G` grid zeker (deels = oranje) · `T` toon zeker · `S` stems · `§` secties (op het grid van nu)
· `V` video. Komt van `POST /api/set/klaar { ids }` (één verzoek voor de hele set, alleen lezen).

Eén knop **maak klaar** zet wat ontbreekt in de BESTAANDE rijen: stems (`nieuweStems`, de
stems-rij) en secties (één voor één in de worker, zoals de achtergrond). De server weigert (409,
met de reden) als er een deck speelt (`speeltDeck`) of als het vandaag een speeldag is (de
speeldagen van de nachtwachtrij, ook de nacht erna). Het secties-werk stopt zodra er een deck gaat
spelen en gaat later verder; de stems-rij gaat zoals altijd (nice, één tegelijk). Niets van het
internet: de ingest blijft van de kaart en de nacht.

## 4. Live bijmixen

**Tracks van de automaat en tracks voor jou.** Per plan `tracks: { auto: [1, 2] }`: de automaat
laadt, start en mixt alleen daar; de rest is van Clay. Zonder `tracks` (elk oud plan) doet hij wat
hij altijd deed, met één regel erbij die altijd geldt: **een track waar Clay de laatste 2 minuten
iets aan deed en die niet van de automaat is, laadt hij nooit** (ook geen lege). Wat speelt raakt
hij al nooit. Na een overname wacht hij tot er op ZIJN tracks één klinkt (Clay's tracks tellen
niet mee), anders zou een acapella op track 5 hem eeuwig laten wachten. OVERNEEM blijft zoals het
is (wie een track in de overgang aanraakt, neemt hem over).

**GO per stap.** `go: 'wacht'`: de automaat zet de stap klaar zoals altijd, maar begint de overgang
pas na **GO** (`plan.go`). Komt GO niet, dan gaat hij toch op het laatste moment dat de overgang nog
voor het einde van de uitgaande past ("nooit stilte" gaat voor): de live-stand telt dat af. GO bij
een gewone stap = "nu" (de eerstvolgende 4 maten, of de volgende sectiegrens).

**Lagen.** Een stap mag `lagen` hebben: extra stukken op een track van Clay.
```json
"lagen": [{ "id": "l1", "soort": "nummer", "track": "<library-id>", "van": 32, "stem": "vocals",
            "op": { "sectie": 5, "label": "drop", "groep": "C" }, "deck": 5, "duur": 64, "start": "auto" },
          { "id": "l2", "soort": "sampler", "pad": 3, "op": { "sec": 90 } },
          { "id": "l3", "soort": "patroon", "deck": 7, "plek": 2, "op": { "sectie": 3 } }]
```
- `op` = waar in de STAP (het nummer van de stap): een sectie van zijn kaart, of seconden tracktijd
  vanaf het begin van de stap. Zonder kaart terug naar `sec` (of de laag valt weg, gemeld).
- `soort: nummer`: de automaat laadt het nummer ruim vooraf op `deck` (of de eerste vrije track van
  Clay), fader dicht, sync, en start hem op de maat op het moment (`start: 'auto'`), fader in 4
  maten open; met `stem` alleen die stem (de rest weg, via de stem-kills). `start: 'jij'` = alleen
  klaarzetten: Clay start hem. `duur` (s) = daarna in 4 maten dicht; zonder duur blijft hij tot
  Clay hem stopt of de stap eindigt.
- `soort: sampler`: op het moment `sampler.K` (een pad die gevuld is; leeg = gemeld en overgeslagen).
- `soort: patroon`: op het moment `track.N.pattern.K` (het patroon start op de maat; een track
  zonder instrument = gemeld en overgeslagen).
- **Overnemen of overslaan**: `plan.laag.skip` (de eerstvolgende laag niet), `plan.laag.nu` (nu
  starten). Raakt Clay de track van een laag aan (wat dan ook), dan is de laag van hem: de automaat
  doet er niets meer mee, ook niet het dichtdraaien. Is de track van een laag in gebruik
  (speelt, of Clay deed er net iets), dan slaat de automaat de laag over, met een melding. Een laag
  komt nooit op een track van de automaat.

**Buiten plan, en terug.** `plan.buiten`: de automaat laat alles los (een lopende overgang maakt
hij af), zet niets meer klaar en kijkt alleen. Clay doet wat hij wil. `plan.terug`: wat er dan het
hardst klinkt wordt de hoofdtrack (Clay geeft hem expliciet terug, dus vanaf dat moment mag de
automaat hem uitmixen) en het plan gaat verder na de laatste stap die echt speelde. Klinkt er
niets: meteen de volgende stap.

**Live-stand** (`src/plan/live.js`, puur): NU (titel, nog m:ss), VOLGENDE (titel, soort overgang,
over m:ss of N maten, "wacht op GO · uiterlijk over m:ss"), DAARNA, de volgende laag, en de
**verwachte eindtijd** (klok van nu + rest van NU + de voorspelde duur van de rest, met de overlap
van de overgangen). In de AUTO-rij, in het planvenster en als vak `plan` op werk.html (mac-2 en
de iPad).

## 5. Het planformaat groeit (v2 blijft v2)

Alle nieuwe velden zijn optioneel; zonder staan ze er niet (een oud plan verandert niet).
- plan: `tracks: { auto: [1..8] }` (uniek, oplopend, minstens één; leeg = weg).
- stap: `go: 'wacht'` (alleen die waarde; zonder = automatisch).
- stap: `lagen: [...]` (hooguit 8 per stap, vorm als hierboven; rommel weg met een fout).
- `kent` bij opslaan: het venster en Claude sturen `['in', 'uit', 'go', 'lagen', 'tracks']`. Een
  schrijver die ze niet noemt (een oud venster) krijgt ze terug zoals in/uit nu (`herstelSecties`
  wordt `herstelVelden`, dezelfde regels; `tracks` per plan: terug als de payload geen `tracks` had).

## 6. Sets opslaan en terugladen (de aanvulling)

Een SET (`src/sets/model.js`, puur, ook op de server):
```json
{ "schema": 1, "naam": "vrijdag", "uitleg": "…", "gemaakt": "2026-10-14T20:00:00Z",
  "plan": { …plan v2… }, "patronen": { "naam": "set", "set": { …patronenset… } } | null,
  "werkruimte": "twee-handen" | null, "momentopname": { …leesStand zonder 'speelt'… } | null }
```
- **Plan en patronen als kopie** (een set is een momentopname van je voorbereiding; plannen en
  patronen hebben hun eigen versies). **Werkruimte op naam** (dat is Clay's indeling, die je niet per
  set dupliceert). **Momentopname** = de beginstand van het handelingenlog (`leesStand`): welk nummer
  op welke track (tracks.id), positie, cue, hotcues, loop, EQ/filter/fader/sends (de waarden op de
  bus), racks met herkomst, kant, kills, stem-kills, instrumenten, sampler-pads (alleen WAAR het stuk
  zit), patronen. Geen audio, geen library.
- **Opslaan**: `PUT /api/sets/<naam> { set, versie }`, versie = hash van de inhoud, 409 met de
  huidige inhoud, elke opslag bewaart de vorige in `sets/.versies/<naam>/` (laatste 50), atomisch.
  `POST /api/sets/<naam>/kopie { naar }` (dupliceren), `POST /api/sets/<naam>/hernoem { naar,
  versie }`. `sets/` niet in git, `VARVE_SETS` voor tests. Opslaan alleen vanaf deze Mac (zoals
  werkruimtes). Claude kan een set schrijven zoals een plan.
- **Terugladen**: de lijst toont naam, datum, aantal nummers en duur. "laad set" zet het plan
  (als plan `<setnaam>` en meteen actief), de patronen (naar de set die de mixer gebruikt, met
  versie; de mixer neemt hem over zoals elke wijziging van buiten) en de werkruimte. De momentopname
  alleen met het vinkje "ook de mixer"; dan NOOIT over een spelende track zonder de tweede druk
  binnen 3 s. Er start niets (speelt en wacht op false, pads en patronen stil). Een nummer dat er
  niet meer is: een melding per nummer, de rest laadt.
- **Backup**: de backup van de library neemt alleen `library.db` mee (server/backup.js); sets zijn
  bestanden zoals plannen en patronen, en staan in de Bureaublad-map (CLAUDE.md "Git"). Niet
  meegenomen in backup.js (dat is de database): genoemd in de vragen.

## 7. Bediening: alles op de bus

| action | wat |
|---|---|
| `plan.go` | de klaarstaande overgang nu (bij een GO-stap: de enige manier, op het laatste moment na) |
| `plan.buiten` / `plan.terug` | buiten het plan / terug naar het plan (read: 1 = buiten) |
| `plan.laag.nu` / `plan.laag.skip` | de eerstvolgende laag nu starten / overslaan |
| `set.bewaar` | de huidige set bewaren onder de gekozen naam (met versie) |
| `set.next` / `set.prev` | de gekozen set in de lijst |
| `set.terugladen` | de gekozen set terugladen (plan, patronen, werkruimte); met momentopname over een spelende track: tweede druk binnen 3 s |

Geen enkele mapping verandert (Clay verdeelt de knoppen zelf). Elke action heeft een uitleg in
`src/ui/beschrijf/set.js`. Eén voorbeeld (gemarkeerd als voorbeeld): `mappings/stukken/set-voorbeeld.json`
(niet geladen tenzij je hem noemt, `?stukken=set-voorbeeld`).

**iPad.** Twee bouwstenen in het paneelregister (S7): `plan` (live-stand + GO, buiten/terug, laag
nu/overslaan) en `sets` (de lijst + terugladen). Ze gaan over de schrijfweg van S8: alleen als de
werkruimte ze op dat scherm zet én `mag` ze noemt (`plan.*`, `set.*`). `set.bewaar` staat in
VAST_NOOIT (schrijft naar de server, zoals `werk.opslaan`); terugladen mag dus alleen als Clay het
expliciet in `mag` zet, en ook dan met de tweede druk.

## 8. Tegen de regels getoetst

- **Regel 1** (engine kent geen MIDI/DOM/YouTube): alles staat in `src/plan`, `src/auto`,
  `src/sets`, `src/ui` en de server. De engine verandert niet.
- **Regel 2** (0..1): de nieuwe actions zijn triggers; de fader van een laag gaat met `fader.glide`.
- **Regel 3** (de audioklok): het moment van een laag en van GO komt van de POSITIE van de
  hoofdtrack; de timer van 40 ms beslist alleen wanneer er gekeken wordt. De eindtijd is een
  voorspelling op de wandklok (alleen tekst).
- **De automaat is een bron van actions**: lagen laden via de laadlaag (zoals nu), al het andere
  over de bus, dus in het handelingenlog. `plan.*` en `set.*` staan met `log: 'overslaan'` in hun
  define: terugspelen herhaalt de GEVOLGEN (de actions die de automaat stuurde), niet de knop, anders
  zou terugspelen een set terugladen.
- **De bewakers gaan voor het plan**: GO en lagen veranderen nooit de soort overgang; een laag is een
  extra track en wordt niet gesynct als zijn grid onzeker is (dan start hij niet vanzelf: gemeld).
- **Nooit stilte**: GO wachten heeft een uiterste moment; buiten plan laat wat klinkt klinken.
- **VISIE §5**: één draagbare set (de set is één bestand), bedienbaar vanaf elk scherm, niets naar
  buiten (sets blijven op de Mac).
- **De lag-winst van 14 okt**: geen `:has()` met body, niets in het MIDI-bericht (de actions zetten
  een vlag; de automaat kijkt bij zijn tik), geen opmaak lezen in een lus.

## 9. Gebouwd

(zie onder; bijgewerkt na het bouwen)
