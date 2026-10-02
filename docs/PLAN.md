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
- De mixer kijkt ook elke 3 s (`plan-koppeling.js`) en geeft een nieuwe versie
  live aan de automaat (`vervangPlan`): wat klinkt blijft klinken, een lopende
  overgang loopt door, de klaarstaande wordt opnieuw gekozen als zijn stap
  veranderde (of alleen opnieuw gepland als alleen de overgang anders is), en
  een nieuwe speelduur van wat nu klinkt verschuift het einde.

## 4. Bestanden

| Bestand | Wat |
|---|---|
| `plan.html` | het venster (eigen opmaak, kleuren uit styles.css) |
| `src/plan/plan-model.js` | formaat, `normaliseerPlan`, `bewerk`, `verschil` (puur; ook door de server gebruikt) |
| `src/plan/tijdlijn.js` | `voorspel`: fragmenten, set-tijden, de overgang die de app kiest (puur) |
| `src/plan/plan-venster.js` | het venster: lijst, strook, bewerken, opslaan, live |
| `src/ui/plan-koppeling.js` | in de mixer: actief plan, ophalen met versie, live bijwerken, `window.varvePlan`, knop "plan" |
| `server/plannen.js` | opslag met versies, atomisch, `.versies` |
| `src/auto/automaat.js` | stap-id's, `vervangPlan`, `geschiedenis`, `hoofdStap`, eigen overgangslengte |
| `src/auto/planner.js` | `overgangMaten`, `overgangSec`, `planMoment(… lengte)` |
| `test/plan.test.mjs` | formaat, bewerken, verschil, voorspelling, opslag met versies |
| `tools/headless/plan.mjs` | het venster vanuit de mixer, bewerken, opslaan, live, Claude's wijziging, botsing |

## 5. Getest

`plan.test` (47), `auto.test` (74, met vervangPlan tijdens het spelen),
`server.test` (setplannen: 409, witte lijst, 415, 403, vreemde namen), en
`tools/headless/plan.mjs` in headless Chromium: het venster opent vanuit de
mixer, toont de voorspelling, bewerkt en slaat op (de vorige versie bewaard),
zet de auto-DJ aan over de bus van de mixer, volgt live ("speelt nu", "klaar ·
over 0:08"), een wijziging van buitenaf komt in venster én automaat, een
botsing wordt gemeld; op 1280 en 900 px breed past de lijst. Niet: met de echte
library in Clay's Chrome, op het tweede scherm, met de APC.

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
