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
in de strook markeert de gekozen in en uit (bovenop alles getekend). De strook
toont waar de auto-DJ de overgang ECHT begint (§2b).

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
  "speelduur": null,             "uit": { "sectie": 5, "label": "outro", "groep": "E", "van": 214.5 }, … }
```

- `sectie` telt vanaf 1, zoals `track.N.section.K` en de pads (1..64).
- `in` = de stap begint op die sectie (het inmixpunt). `uit` = de overgang naar
  de volgende BEGINT op die sectie. `uit` moet ná `in` liggen, anders valt hij
  weg (met een fout).
- `label` en `groep` zijn er om de sectie terug te vinden als de kaart opnieuw
  berekend is (een nieuwe `SECTIE_VERSIE`, een ander grid). `null` mag.
- `van` in `uit` (optioneel, 7 okt) = waar die sectie begon toen ze gekozen
  werd (het venster zet hem). Komt een label vaker voor ("drop C" twee keer) en
  is de kaart opnieuw berekend met een stuk erbij, dan vindt de planner zo de
  goede terug (`vindSectie`: het dichtst bij die tijd, binnen 30 s), niet de
  eerste. Bij `in` is de `van` van de stap al die tijd.
- **`van` blijft de waarheid en de terugval.** Wie een sectie als `in` kiest,
  schrijft ook `van` = haar begin (het venster doet dat). Zonder kaart, of als
  de sectie niet terug te vinden is, speelt `van`. Typ je in het venster een
  ander begin, dan vervalt `in`.
- `normaliseerPlan` houdt ze in een vaste vorm `{ sectie, label, groep, van? }` en
  gooit rommel weg; `bewerk` (`zet` met `in: null` = weg) en `verschil` kennen
  ze; de automaat (`vervangPlan`) kiest de klaarstaande stap opnieuw als zijn
  `in` verandert. Zijn `uit` bepaalt alleen de overgang DAARNA (die wordt
  gepland als hij klinkt), dus die herlaadt niets; een `uit` van de stap die
  nu klinkt komt via het opnieuw plannen van de overgang.

Het venster haalt de kaart per nummer met `GET /api/library/<id>/secties`,
ZONDER `?maak=1`: een plan van dertig nummers zou anders dertig nummers
tegelijk laten rekenen. Alleen wat er al is (de mixer rekent bij het laden).
Bij het laden van een plan, en als het venster de focus krijgt (hooguit eens
per 10 s), vraagt het ALLE kaarten opnieuw: een kaart die de mixer intussen
opnieuw berekende komt zo binnen. Geen kaart = geen keuze; een keuze die er
al stond blijft zichtbaar, oranje met de reden als de kaart hem niet meer
kent, als hij nu anders heet ("de kaart is opnieuw berekend: sectie 3 is nu
break C, gekozen was drop C"), of als een `uit` niet meer na het begin ligt
(een later begin getypt).

**De voorspelling** (`tijdlijn.js voorspel`, 7 okt) rekent elke overgang
zoals de automaat (`_overgangVoor`, docs/AUTO-DJ.md §3b):

```
fragment(track, { van, speelduur, rnd, secties: sectiesVan(kaart), inSectie: stap.in })
kiesOvergang(kenmerken(uitgaande, eind van zijn stuk), kenmerken(nieuwe, zijn begin))
planMoment(momentArgs({ type, grid, uit: uitgaande, inn, positie: van, eind: tot, rate: 1,
  vooruit: 0, lengte, kaart: kaart van de UITGAANDE, uitSectie: stap.uit }))
```

Dezelfde argumenten dus, ook `zeker` (bij beatloos op het grid van de
uitgaande) en `mag` (de bewakers op elk sectiebegin), en alleen een kaart op
het grid (`sectiesVan`). De strook volgt dat moment ALTIJD: de overgang begint
daar, de uitgaande is klaar aan het eind ervan, de nieuwe begint aan het
begin (blend, beatloos) of het eind (filter) van de overgang. Het moment staat
per stap in `moment` (tracktijd van de uitgaande, met `sectie` als hij op een
sectie begint). Enig verschil met de automaat: die plant vanaf waar de
uitgaande dan is, het venster vanaf het begin van zijn stuk.

Wat daardoor verschoof (ook zonder secties): vroeger tekende de strook de
overgang zo dat hij op het eind van het stuk eindigde. De automaat begint een
blend of filter echter op een frasegrens (de laatste 16-maatsgrens die nog
past), dus tot 16 maten eerder, en is dan ook eerder klaar. Voorbeeld
(`plan.test`): een stuk van 120 s op 124 bpm, blend naar de volgende; vroeger
begon de volgende op 89,0 s, nu op 61,9 s (128 tellen), zoals de automaat het
speelt. Beatloos verandert zonder secties niets (24 s vóór het eind).

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
  in/uit niet en gooit ze weg bij de stap die het bewerkt; de andere stappen
  houden ze (het kopieert ze ongezien). De 409 dekt alleen gelijktijdig werk,
  niet dit. Daarom: wie in/uit kent zegt dat bij het opslaan
  (`PUT { plan, versie, kent: ['in', 'uit'] }`). Zonder `kent` zet de server
  in/uit terug, maar alleen op een stap die
  - in de payload een EIGEN id had (een nieuw plan zonder ids, of een stap
    waarvan normaliseerPlan de id gaf, is nieuw: niets terug);
  - in de payload GEEN `in`- of `uit`-sleutel heeft, ook niet `null` of
    rommel (wie er een schrijft kent ze; wat hij schreef is zijn keuze);
  - er nu staat met hetzelfde nummer en hetzelfde begin (`van`): een ander
    begin is een ander inmixpunt, en een uit kan dan vóór het begin liggen.
  De server zegt het in `fouten` ("stap s3: in bewaard (opgeslagen door een
  venster dat ze niet kent: herlaad dat venster)"), en alleen voor wat het
  normaliseren overleeft; het oude venster toont die opmerking na het
  opslaan. Geen nieuwe versie, geen oude schrijver geweigerd, de 409-regel
  precies zoals hij was.
- **Claude stuurt `kent: ['in', 'uit']` ALTIJD mee** bij `curl -X PUT`, ook
  als het plan geen in/uit heeft. Zonder komt een in/uit die Claude op een
  verder ongewijzigde stap bewust weghaalt (beide sleutels weg) terug. Het
  bestand direct schrijven gaat buiten de server om en kan altijd.
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
| `src/plan/plan-venster.js` | het venster: lijst, in/uit kiezen, bewerken, opslaan, live |
| `src/plan/strook.js` | de tijdlijnstrook (balken, overgangen, sectiebanden, in/uit) op een 2D-context; in Node te toetsen |
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
contract met de planner via een spion, een oud venster en de bewuste
wijzigingen die NIET terugkomen (review (a)–(e)), `vervangPlan`: in herlaadt,
uit niet), `server.test` (in/uit over HTTP, `kent`), en
`tools/headless/sec-plan.mjs` in headless Chromium en Google Chrome: een
library met twee sectiekaarten, de banden in de strook in de groepskleur, in
en uit kiezen (van springt naar het begin van de sectie, uit alleen na in),
opslaan en herladen (ze staan er nog), een uit vóór een later begin wordt
oranje, een 409 bij een gelijktijdige wijziging, "mijn versie eroverheen"
houdt in/uit, een uit weghalen en opslaan blijft weg (op schijf), en een
kaart die buiten het venster opnieuw berekend is komt bij het laden binnen
("kaart opnieuw berekend"). Na het samenvoegen met sec-auto (7 okt):
`plan.test` rekent het moment ook zelf uit zoals de automaat
(`planMoment(momentArgs(…))`) en vergelijkt: beatloos op een outro (onzeker
grid op het eind), een outro die de bewakers weigeren (ander tempo daar), een
kaart zonder grid, `van` in `uit` na een herberekening, en de strook op een
nep-context (de witte strepen liggen bovenop).
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
