# De programmering: het planvenster (fase 1, gebouwd 30 september 2026)

Clay (30 sep): "een nieuwe pagina in de app waar je de totale huidige
programmering ziet, die je daar helemaal kunt neerzetten zoals je hem wilt, en
dan live mee spelen op de manier hoe je hem hebt geprogrammeerd." Vooraf
onderzocht door vier agenten (andere software, datamodel, techniek, de rol van
Claude); Clay koos: fase 1, apart venster.

## 1. Wat het is

Knop **plan** in de balk van de mixer opent `plan.html` als eigen venster (op
het tweede scherm naast de mixer). Het toont het setplan van de auto-DJ als
**cuelijst**, met bovenaan een **tijdlijnstrook** van de hele set.

Per stap: nummer (en waar het in de set valt, welk stuk van het bestand), toon
en bpm (met `?` als de analyse onzeker is), **begin** en **duur** (m:ss; leeg =
de app kiest), de **overgang ernaartoe** (auto / lange blend / filter-uit /
overvloeien, plus een eigen lengte in maten of seconden), wat de app daar
**echt** van maakt ("→ overvloeien", oranje als het niet is wat je vroeg; de
tooltip zegt waarom), **waarom**, en **door** (jij of Claude). Tussen twee
stappen: de toonstap (groen 0–1, oranje 2, rood ≥ 3), het tempoverschil en de
lengte van de overgang.

**Secties** (6 okt, §2b): heeft een nummer een sectiekaart, dan toont zijn
balk in de strook de secties als banden in de groepskleur (dezelfde letter =
dezelfde kleur, zoals boven de golfvorm in de mixer), en kies je onder
**begin** een sectie als **in** (de stap begint daar) en onder **duur** een
sectie als **uit** (de overgang naar de volgende begint daar). Een witte streep
in de strook markeert de gekozen in en uit.

Bewerken: typen, een nummer rechts uit de library erbij (na de gekozen stap),
slepen aan ⋮⋮, ↑ ↓ kiezen, alt+↑ ↓ verplaatsen, Del weg, ctrl+z / ctrl+shift+z,
ctrl+s opslaan. De uitleg van het plan onderaan rechts. Plannen kiezen en
nieuwe maken in de keuzelijst linksboven; **gebruik dit plan** geeft het aan de
auto-DJ.

**Live** (geopend vanuit de mixer): "speelt nu" met een voortgangsbalk,
"klaar · over 12 maten", gespeelde stappen gedimd met wat er gebeurde
("overgeslagen", "jij nam over", "de app koos overvloeien", "2× langer"), de
afspeelkop in de strook, en de knoppen auto / ok / overslaan / langer / nu. Die
gaan over de bus van de MIXER: het venster maakt geen AudioContext, praat niet
met MIDI en neemt de Web Lock niet (de één-tabblad-regel blijft heel).

Los geopend (zonder mixer) is het alleen een editor.

## 2. Het planformaat (v2) — `src/plan/plan-model.js`

```json
{ "versie": 2, "naam": "piano naar piek", "door": "Claude, 30 sep 2026", "uitleg": "…",
  "stappen": [
    { "id": "s4", "track": "<library-id>", "van": 177, "speelduur": 300,
      "overgang": "auto|blend|filter|ambient", "lengte": { "maten": 16 } ,
      "waarom": "…", "notitie": "", "door": "claude|clay|null" } ] }
```

- `id` is vast: zo weet de automaat waar hij is, ook als het plan tijdens het
  spelen verandert. Een nieuwe stap krijgt een id die nooit eerder bestond.
- Tijden in tracktijd (s), niet in maten: een maatnummer verschuift als het grid
  bewerkt wordt, en de meeste grids zijn onzeker. `null` = de app kiest.
- `overgang` is een WENS: de bewakers (planner.js) gaan voor. `lengte`:
  `{maten}` (4–64) of `{sec}` (4–120); leeg = de standaard.
- Een v1-plan (het eerste auto-plan) wordt vanzelf omgezet. `normaliseerPlan`
  gooit nooit: rommel wordt weggelaten of begrensd, en staat in `fouten`.

## 2b. In en uit: een stap op een sectie (6 okt, docs/SECTIES.md)

Twee OPTIONELE velden per stap; het formaat blijft v2 (zonder in/uit staan ze
er niet, een oud plan verandert niet):

```json
{ "id": "s4", "track": "<id>", "van": 46.08, "in":  { "sectie": 3, "label": "drop",  "groep": "C" },
  "speelduur": null,             "uit": { "sectie": 5, "label": "outro", "groep": "E" }, … }
```

- `sectie` telt vanaf 1, zoals `track.N.section.K` en de pads (1..64).
- `in` = de stap begint op die sectie (het inmixpunt). `uit` = de overgang naar
  de volgende BEGINT op die sectie. `uit` moet ná `in` liggen, anders valt hij
  weg (met een fout).
- `label` en `groep` zijn er om de sectie terug te vinden als de kaart opnieuw
  berekend is (een nieuwe `SECTIE_VERSIE`, een ander grid). `null` mag.
- **`van` blijft de waarheid en de terugval.** Wie een sectie als `in` kiest,
  schrijft ook `van` = haar begin (het venster doet dat). Zonder kaart, of als
  de sectie niet terug te vinden is, speelt `van`. Typ je in het venster een
  ander begin, dan vervalt `in`.
- `normaliseerPlan` houdt ze in een vaste vorm `{ sectie, label, groep }` en
  gooit rommel weg; `bewerk` (`zet` met `in: null` = weg) en `verschil` kennen
  ze; de automaat (`vervangPlan`) kiest de klaarstaande stap opnieuw als zijn
  in of uit verandert.

Het venster haalt de kaart per nummer met `GET /api/library/<id>/secties`,
ZONDER `?maak=1`: een plan van dertig nummers zou anders dertig nummers
tegelijk laten rekenen. Alleen wat er al is (de mixer rekent bij het laden).
Geen kaart = geen keuze; een keuze die er al stond blijft zichtbaar (oranje
als de kaart hem niet meer kent of hij nu anders heet).

**De voorspelling** (`tijdlijn.js voorspel`) geeft de secties door aan de
planner, volgens het contract met het spoor auto:

```
fragment(track, { van, speelduur, rnd, secties, inSectie })
planMoment({ type, grid, positie, eind, rate, vooruit, lengte, secties, uitSectie })
```

`secties` = de stukken van de kaart (bij `planMoment` die van de UITGAANDE),
`inSectie`/`uitSectie` = de `in`/`uit` van de stap. Heeft de uitgaande stap
een `uit`, dan volgt de strook het moment van de planner (daar begint de
overgang, de uitgaande is klaar aan het eind ervan); zonder `uit` de schatting
van altijd (de overgang eindigt op het eind van het stuk). Zo voorspelt een
plan zonder secties precies als voorheen. Het moment staat per stap in
`moment` (tracktijd van de uitgaande).

## 3. Opslaan en samenwerken

- `GET /api/plannen` (lijst), `GET /api/plannen/<naam>` (`{ plan, versie, fouten }`),
  `PUT /api/plannen/<naam>` met `{ plan, versie }`. `versie` = een hash van de
  inhoud; klopt hij niet meer, dan **409** met wat er nu staat. `null` = nieuw.
- Elke opslag bewaart de vorige in `plannen/.versies/<naam>/` (laatste 50;
  niet via de witte lijst). Schrijven is atomisch.
- Claude kan het bestand gewoon schrijven (de versie is een hash, dus het telt
  mee) of `curl -X PUT` doen. Het venster kijkt elke 3 s: zonder eigen
  wijzigingen neemt het een nieuwe versie over en zegt wat er veranderde; mét
  eigen wijzigingen meldt het een botsing: **hun versie laden** of **mijn
  versie bewaren**. Niemand overschrijft stilletjes een ander.
- **Een oud venster wist in/uit niet** (6 okt). Een planvenster dat nog open
  stond tijdens een update draait de oude code: zijn `normaliseerPlan` kent
  in/uit niet en gooit ze weg bij elke stap die het bewerkt (de 409 dekt
  alleen gelijktijdig werk, niet dit). Daarom: wie in/uit kent zegt dat bij
  het opslaan (`PUT { plan, versie, kent: ['in', 'uit'] }`, het venster doet
  dat). Zonder `kent` zet de server in/uit terug op elke stap die er nu staat
  met hetzelfde id en nummer (`in` alleen als `van` niet veranderde), en zegt
  dat in `fouten` ("stap s3: in bewaard (opgeslagen door een venster dat ze
  niet kent: herlaad dat venster)"); het oude venster toont die opmerking na
  het opslaan. Geen nieuwe versie, geen oude schrijver geweigerd, de 409-regel
  precies zoals hij was. **Claude via `curl -X PUT`: stuur `kent` mee** als je
  in/uit bewust weghaalt; het bestand direct schrijven kan altijd.
- **Een oude server** (nog niet herstart na een update) gooit in/uit weg bij
  het opslaan. Het venster ziet dat (het stuurde in/uit, het antwoord heeft ze
  niet), houdt ze als niet opgeslagen en zegt: herstart de server en sla
  opnieuw op.
- De mixer kijkt ook elke 3 s (`plan-koppeling.js`) en geeft een nieuwe versie
  live aan de automaat (`vervangPlan`): wat klinkt blijft klinken, een lopende
  overgang loopt door, de klaarstaande wordt opnieuw gekozen als zijn stap
  veranderde (of alleen opnieuw gepland als alleen de overgang anders is), en
  een nieuwe speelduur van wat nu klinkt verschuift het einde.

## 4. Bestanden

| Bestand | Wat |
|---|---|
| `plan.html` | het venster (eigen opmaak, kleuren uit styles.css) |
| `src/plan/plan-model.js` | formaat, `normaliseerPlan`, `bewerk`, `verschil`, `herstelSecties` (puur; ook door de server gebruikt) |
| `src/plan/tijdlijn.js` | `voorspel`: fragmenten, set-tijden, de overgang die de app kiest, secties naar de planner (puur) |
| `src/plan/plan-venster.js` | het venster: lijst, strook (met sectiebanden), in/uit kiezen, bewerken, opslaan, live |
| `src/ui/plan-koppeling.js` | in de mixer: actief plan, ophalen met versie, live bijwerken, `window.varvePlan`, knop "plan" |
| `server/plannen.js` | opslag met versies, atomisch, `.versies`; in/uit terug voor wie ze niet kent |
| `src/auto/automaat.js` | stap-id's, `vervangPlan`, `geschiedenis`, `hoofdStap`, eigen overgangslengte |
| `src/auto/planner.js` | `overgangMaten`, `overgangSec`, `planMoment(… lengte)` |
| `test/plan.test.mjs` | formaat, bewerken, verschil, voorspelling, opslag met versies |
| `tools/headless/plan.mjs` | het venster vanuit de mixer, bewerken, opslaan, live, Claude's wijziging, botsing |
| `tools/headless/sec-plan.mjs` | secties: banden in de strook, in/uit kiezen, opslaan en herladen, 409 (poorten 8903/9503) |

## 5. Getest

`plan.test` (47), `auto.test` (74, met vervangPlan tijdens het spelen),
`server.test` (setplannen: 409, witte lijst, 415, 403, vreemde namen), en
`tools/headless/plan.mjs` in headless Chromium: het venster opent vanuit de
mixer, toont de voorspelling, bewerkt en slaat op (de vorige versie bewaard),
zet de auto-DJ aan over de bus van de mixer, volgt live ("speelt nu", "klaar ·
over 0:08"), een wijziging van buitenaf komt in venster én automaat, een
botsing wordt gemeld; op 1280 en 900 px breed past de lijst. Niet: met de echte
library in Clay's Chrome, op het tweede scherm, met de APC.

Secties (6 okt): `plan.test` (in/uit in het formaat, bewerken, verschil, het
contract met de planner via een spion, een oud venster, `vervangPlan`),
`server.test` (in/uit over HTTP, `kent`), en `tools/headless/sec-plan.mjs` in
headless Chromium: een library met twee sectiekaarten, de banden in de strook
in de groepskleur, in en uit kiezen (van springt naar het begin van de
sectie, uit alleen na in), opslaan en herladen (ze staan er nog), een 409
bij een gelijktijdige wijziging, en "mijn versie eroverheen" houdt in/uit.
Niet: met de planner van het spoor auto (die negeert in/uit in deze tak), en
niet op Clay's library.

## 6. Volgende fases (uit het onderzoek)

2. **Live-stand**: groot NU / VOLGENDE / DAARNA, GO per stap (automatisch /
   wacht op GO / direct), "buiten plan" + **terug naar plan**, een klok met de
   verwachte eindtijd, en een APC-mapje "auto".
3. **Claude als medeprogrammeur**: een plan uit een wens in gewone taal,
   voorstellen als gestippelde stappen die je per stuk aanneemt, en na de set
   het handelingenlog nalezen voor een stijlnotitie.
4. **Klank**: fades als helling op de audioklok, sporen per overgang (galm,
   echo, klankschaal-accent, vormen-scène), paargeheugen (een bijgestelde
   overgang tussen twee nummers onthouden), en een overgang vooraf beluisteren.

Open (VRAGEN blok M): mag Clay een bewaker bewust breken; de standaard per stap
(automatisch of wachten op GO).
