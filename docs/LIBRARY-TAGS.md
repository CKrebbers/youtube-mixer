# Categorieën en tags in de library (spoor S11, 14 okt 2026)

Clay, letterlijk: "Voeg daar ook toe dat je categorieën kunt maken in de library zodat je makkelijk
en snel nummers bij elkaar kunt vinden met categorieën maar ook met tags."
Opdracht: `docs/werkruimte/S11.md`. Vragen: VRAGEN blok S11. Verslag: `docs/verslagen/2026-10-14/werk-S11.md`.

## 1. De begrippen (en waarom zo)

| begrip | wat | waar |
|---|---|---|
| **categorie** | een eigen bak nummers met een VOLGORDE (een "krat" van jezelf). Een nummer kan in veel categorieën staan. | `library.db`, tabellen `categorieen` + `categorie_nummers` |
| **slimme categorie** | een bewaard FILTER (tags en/of/niet, bpm, toon, grid, stems, energie, zoektekst, eventueel binnen één categorie). Werkt zichzelf bij: de server rekent hem bij elke vraag. | `categorieen.regel` (JSON) |
| **tag** | een vrij label met een kleur; meerdere per nummer. | `tags` + `nummer_tags` |
| **snel-tag 1–8** | een PLEK die naar een tag wijst (zoals de FX-knoppen naar een plek wijzen): de bus kent geen namen, alleen plekken. | instelling `snel_tags` in `instellingen` |
| **krat** | blijft wat het was: een krat van de MUZIEKKAART (kaart.db / varve-kaart.json), alleen lezen. | `server/kaart.js` |

Keuzes:
- **Plat, geen mappen in mappen.** Een nummer staat in meerdere categorieën en draagt meerdere tags;
  een boom vraagt dan "waar staat hij echt?" en dat heeft geen antwoord. Wat je met een boom zou doen
  ("dub › traag") is een slimme categorie: `#dub bpm:60-90`. Eén niveau is snel te overzien op de
  Maschine (◄ ► door de categorieën) en op de iPad.
- **Twee namen, twee begrippen voor "krat".** In VARVE heet een eigen bak een *categorie*, zodat hij
  nooit verward wordt met een krat van de kaart. Een kaartkrat **overnemen** maakt (of vult) een
  categorie met de nummers die binnen zijn, in de volgorde van de krat. Het is een KOPIE, geen link:
  de kaart is van buiten en verandert zonder dat VARVE het weet; een categorie die stil van inhoud
  wisselt, is in een set een verrassing. Nog eens overnemen voegt alleen toe wat erbij kwam.
- **Tags van nummers en tags van racks zijn twee dingen.** Racks hebben `tags` in hun eigen JSON
  (rack.js, S10 "sjablonen per tag"). Die van nummers staan in de library en heten in de API
  `/api/indeling/…`; ze delen geen lijst. Een rack-tag "dub" en een nummer-tag "dub" mogen
  bestaan zonder elkaar te raken. Bewust niet één begrip: een rack hoort bij geen nummer.
- **Een tag heeft een naam en een sleutel.** De sleutel is de naam in kleine letters, zonder accenten
  en met enkele spaties (`sorteertitel`-achtig): "Dub" en "dub" zijn dezelfde tag. Verboden in een
  naam: `, | # @ "` en stuurtekens (die zijn van de zoekregel), hooguit 40 tekens.
- **Slimme regels noemen tags bij NAAM** (leesbaar, ook voor Claude). Hernoemen of samenvoegen
  schrijft de regels mee om, in dezelfde transactie.
- **Kleuren uit een vaste lijst** (`KLEUREN`): grijs rood oranje geel groen cyaan blauw violet roze.

## 2. Vinden: het filter

Eén filter-object, puur gedefinieerd in `src/library/indeling.js` (server en browser gebruiken het):

```
{ zoek, categorie, tags: { en: [], of: [], niet: [] }, bpm: [lo, hi], toon: [k…], grid, stems, energie: [lo, hi] }
```

- `categorie`: id van een categorie (gewoon of slim). Een slimme regel mag zelf hooguit naar een
  GEWONE categorie wijzen (geen slim in slim: geen lussen).
- `toon`: toonsoorten als getal 0..23 (wijzervolgorde van ToonKaart); de hoofdtoonsoort van de plaat.
- `grid`: `zeker` (status zeker, slot of hand: wat de lijst als bruikbaar toont), `onzeker`, `geen`.
- `stems`: `ja`, `nee`, `2`, `4`.
- `energie` 0..1: de energie van de secties, gewogen naar hun lengte (nog geen kaart = geen waarde).

Om dat op 20.000 nummers in SQL te kunnen, bewaart schema v10 drie AFGELEIDE kolommen naast de JSON
(`k_grid`, `k_toon`, `k_energie`). Ze worden gezet waar grid, toon en secties bewaard worden, met
dezelfde formules als de lijst (`gridStatus` van grid-strook.js, `ToonKaart.hoofd`), en bij de
migratie één keer uitgerekend. Nooit een tweede formule.

**De zoekregel** (het zoekveld van de library, de iPad, het planvenster): woorden zijn zoektekst,
met daartussen:

| | betekent |
|---|---|
| `#dub` | tag dub (en) |
| `#dub|reggae` | dub óf reggae |
| `-#vocal` | niet vocal |
| `#"deep house"` | een tag met een spatie |
| `@warm` / `@"warm op"` | in categorie warm |
| `bpm:70-90` `bpm:128` | tempo (één getal = ±1) |
| `toon:8A` `toon:Am,C` | hoofdtoonsoort (Camelot of naam) |
| `grid:zeker` | grid zeker / onzeker / geen |
| `stems` `-stems` `stems:4` | met / zonder / met vier |
| `energie:hoog` `energie:0.5-1` | hoog (≥ 0,66), midden, laag (≤ 0,33) of een bereik |

`leesZoekregel(tekst, { tags, categorieen })` maakt er een filter van en zegt wat hij niet begreep;
`zoekregelVan(filter)` schrijft hem terug. De lijst toont het filter als chips; × haalt er één weg.

**Sorteren** blijft hetzelfde (titel, bpm, duur, toegevoegd, gespeeld) met één erbij: `plek`, de
volgorde binnen een gewone categorie (alleen met een categorie; standaard zodra je er een kiest).
De lijst blijft een virtuele lijst met pagina's van de server (hooguit 500), de pagina-cache weet
nu ook het filter: een nieuw filter is een nieuwe vraag (generatie), een laat antwoord van het oude
komt er niet meer overheen.

## 3. Bedienen

**Op de Mac (library-paneel)**:
- links een smalle kolom INDELING: alles · de categorieën (met aantal) · de slimme (✦) · de tags
  (chips in hun kleur, met aantal). Klik = filter; alt-klik op een tag = "niet".
- een nummer KIEZEN = klik (zoals nu). Meer kiezen: cmd-klik (erbij/eraf), shift-klik (een reeks).
- **taggen**: het tagveld boven de lijst (aanvullen uit de bestaande tags), Enter = op alles wat
  gekozen is; `-naam` haalt hem eraf. Alt+T = naar het tagveld. Alt+1…8 = snel-tag 1–8 aan/uit op
  wat gekozen is. Een tagchip in een rij: klik = filter, × = eraf.
- **slepen** van een (of de gekozen) rij(en) naar een categorie = erin; binnen een categorie
  (gesorteerd op plek) op een andere rij = daarvóór zetten.
- `+ categorie` (naam typen, Enter), `+ slim` = het filter van nu bewaren als slimme categorie.
  Per categorie/tag `⋯`: hernoemen, kleur, wissen (tweede klik binnen 3 s). Een tag hernoemen naar
  een bestaande = samenvoegen (tweede klik).
- `kaartkrat →` in de kaart-tab: neem deze krat over als categorie.

**Op de bus** (`define` in de aanhaker `indeling`, uitleg in `src/ui/beschrijf/indeling.js`):

| action | wat | van de iPad? |
|---|---|---|
| `library.category.next` / `.prev` | de volgende/vorige categorie als filter (alles → gewone → slimme → alles) | nee (library.*) |
| `library.category.clear` | terug naar alles, filter leeg | nee |
| `library.quicktag.K` | snel-tag K aan/uit op het GEKOZEN nummer (of de selectie) in de library | nee |
| `library.quickfilter.K` | filter op snel-tag K aan/uit | nee |
| `track.N.tag.K` | snel-tag K aan/uit op het NUMMER op track N (read: 1 = heeft hem, 0 = niet, null = leeg of geen tag op die plek) | ja, als `mag` het noemt |

Alle met `log: 'overslaan'` en `beginstand: false`: een tag is data van het nummer, geen klank, en
terugspelen mag de library niet omschrijven. Wissen, hernoemen, samenvoegen, kleuren, categorieën
maken en de volgorde staan NIET op de bus (zoals sjablonen bewaren in S10): alleen in het paneel op
de Mac, en de routes weigeren alles wat niet van deze Mac komt (`vanDezeMac`). `library.*` staat al
in VAST_NOOIT; daar verandert niets. `track.*.tag.*` is bewust NIET vast-nooit: taggen is wat de
iPad mag (Clay's wens "overal"), en het raakt alleen het label van het nummer dat speelt.

**Maschine (BROWSE, docs/MASCHINE.md §5e)**: de kop van het linkerscherm toont het filter
(`@warm #dub`) in plaats van "LIBRARY". Welke knop `library.category.*` of `library.quick*` doet,
kiest Clay: `mappings/*.json` blijven ongemoeid; een voorbeeld staat in
`mappings/stukken/indeling-voorbeeld.json` (een fragment, alleen met `?stukken=indeling-voorbeeld`).

**iPad/iPhone en werk.html**: het vak `library` krijgt een categoriekeuze en leest de zoekregel
(alleen GET, zoals nu). De bouwsteen `tags` (src/paneel/vrij.js) = acht knoppen
`track.{focus}.tag.1–8` voor de focus-track: taggen via de schrijfweg van S8 (koppelcode,
schakelaar, rem, loslaten), alleen als de werkruimte hem op dat scherm zet en `mag` hem noemt.

**Een set uit een categorie of filter (S9)**: in het planvenster staan bij "krat" ook de eigen
categorieën, de slimme en "het filter van de library" (van de mixer). Kiezen = de selectie rechts
wordt die nummers, in de volgorde van de categorie (gewoon) of van de lijst (filter); "maak set"
werkt zoals altijd.

## 4. Opslag

Schema v10 (één element achteraan `SCHEMA`, in een transactie; tests rekenen met SCHEMA.length):

```sql
CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, naam TEXT NOT NULL, sleutel TEXT NOT NULL UNIQUE,
  kleur TEXT, gemaakt INTEGER NOT NULL);
CREATE TABLE nummer_tags (track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, gezet INTEGER NOT NULL, PRIMARY KEY (track_id, tag_id));
CREATE TABLE categorieen (id INTEGER PRIMARY KEY AUTOINCREMENT, naam TEXT NOT NULL, sleutel TEXT NOT NULL UNIQUE,
  soort TEXT NOT NULL, regel TEXT, kleur TEXT, volgorde INTEGER NOT NULL, gemaakt INTEGER NOT NULL, gewijzigd INTEGER NOT NULL);
CREATE TABLE categorie_nummers (categorie_id INTEGER NOT NULL REFERENCES categorieen(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, plek REAL NOT NULL, gezet INTEGER NOT NULL,
  PRIMARY KEY (categorie_id, track_id));
ALTER TABLE tracks ADD COLUMN k_grid TEXT; ALTER TABLE tracks ADD COLUMN k_toon INTEGER; ALTER TABLE tracks ADD COLUMN k_energie REAL;
+ indexen (nummer_tags op tag, categorie_nummers op (categorie, plek) en op track, tracks op k_grid/k_toon/k_energie)
```

Een nummer weghalen haalt zijn tags en plekken mee weg (cascade). Backups (`VACUUM INTO`) en de
kopie nemen alles vanzelf mee; er komt geen bestand naast de database bij, dus geen nieuwe
VARVE_*-variabele. Ids in de database blijven `tracks.id`; geen paden.

**Export/import** (`GET/POST /api/indeling`): `{ soort: 'varve-indeling', schema: 1, tags:
[{ naam, kleur }], categorieen: [{ naam, soort, kleur, regel?, nummers? }], snel: [8] }`. Importeren
VOEGT SAMEN en wist nooit: nieuwe tags en categorieën komen erbij, een gewone categorie met dezelfde
naam krijgt de ontbrekende nummers achteraan, een slimme met dezelfde naam krijgt de nieuwe regel.
Onbekende nummers worden overgeslagen en genoemd. `?droog=1` zegt wat er zou gebeuren. Zo kan Claude
een indeling schrijven zonder iets kapot te maken.

## 5. Routes (server/routes/indeling.js, in SPOREN)

Onder `/api/indeling`, niet onder `/api/library/<x>`: daar is `<x>` een nummer (GET /api/library/<id>).

| | |
|---|---|
| `GET /api/library?…&cat=&tag=&of=&niet=&bpm=&toon=&grid=&stems=&energie=&sorteer=plek` | de lijst, gefilterd (zelfde pagina's, totaal = treffers); een fout filter = 400 met de reden, een onbekende categorie 404 |
| `GET /api/indeling/stand` | `{ tags: [{naam, sleutel, kleur, aantal}], categorieen: [{id, naam, soort, kleur, volgorde, regel, aantal}], snel }` |
| `GET /api/indeling` | de export (namen, geen ids) |
| `POST /api/indeling[?droog=1]` | importeren: samenvoegen, nooit wissen; het verslag |
| `POST /api/indeling/tags/zet` | `{ ids, tags, aan }`: taggen in één keer (≤ 5000 ids, ≤ 20 tags) |
| `POST /api/indeling/tags/tag` | `{ naam, nieuw?, kleur?, samenvoegen? }`: hernoemen (op een bestaande: 409 met `bestaat`, tenzij samenvoegen), kleur |
| `POST /api/indeling/tags/wis` | `{ naam, forceer? }` (in een regel: 409 met `gebruikt`, tenzij forceer) |
| `POST /api/indeling/tags/snel` | `{ snel: [8 namen of null] }` |
| `POST /api/indeling/categorie` | `{ id?, naam, soort, regel?, kleur? }`: maken of bijwerken (dezelfde naam: 409) |
| `POST /api/indeling/categorie/wis` | `{ id, forceer? }` (een slimme zoekt erin: 409 met `gebruikt`, tenzij forceer) |
| `POST /api/indeling/categorie/nummers` | `{ id, ids, aan, voor?, naarEind? }`: erin (achteraan, of vóór `voor`), eruit |
| `POST /api/indeling/categorie/volgorde` | `{ ids }`: de volgorde van de categorieën zelf |
| `POST /api/indeling/categorie/van-kaart` | `{ krat, naam? }`: een kaartkrat overnemen |

Alle POST: alleen deze Mac (403), alleen JSON (de algemene regel, 415), Host/Origin zoals altijd.

## 6. Tegen de drie regels

1. De engine weet van niets: categorieën, tags en filters leven in de server, het paneel en de
   aanhaker. `track.N.tag.K` leest welk nummer er op de track staat via de laadlaag (`deckHerkomst`),
   niet via de engine.
2. Alle actions zijn triggers (boolean); geen value-action nodig.
3. Er is geen tijd in het spel.
