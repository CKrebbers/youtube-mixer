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
- **Nooit twee bassen** tegelijk (blend: getest over de hele curve).
- **Nooit een gat**: speelt er niets meer (einde, of Clay zette alles stil),
  dan start de klaarstaande meteen, of wordt er meteen iets gekozen.
- **Clay wint**: fader, EQ, filter, play, sync, seek, tempo, sends of hotcue van
  een track in de overgang (of de crossfader) = overgenomen. De automaat laat
  los en gaat verder als er weer één track duidelijk klinkt.

## 3. Wat hij speelt

- Met een plan: de stappen op volgorde (onbekende of overgeslagen nummers eruit).
- Zonder plan, of als het op is: de **kiezer** (`kiesVolgende`): niet wat speelt
  of deze sessie al speelde, dan tempo dichtbij, toon dichtbij (alleen als beide
  zeker), luidheid dichtbij, en wat toeval.
- **Fragmenten**: een nummer tot 12 minuten helemaal (of zo lang als het plan
  zegt); een mix of album in een stuk van 6 minuten, bij voorkeur waar een zeker
  toon- of gridstuk begint. Het plan kan `van` en `speelduur` geven.
- Laden: heen en weer tussen de tracks die de automaat al gebruikt (zoals twee
  decks), anders een lege. Nooit een track die speelt. De nieuwe krijgt dezelfde
  crossfaderkant als de uitgaande.

## 4. Bediening

Knop **auto** in de balk opent de AUTO-rij (blijft onthouden; de knop kleurt als
de automaat aan staat). In de rij: aan/uit met de fase (kiest, laadt, klaar,
mixt, jij mixt) · wat nu klinkt en hoe lang nog · wat er komt: track, toon,
soort overgang, over hoeveel maten (of mm:ss), "plan" · tooltip = waarom ·
**ok** (bevestigd) · **overslaan** · **langer** (+8 maten, beatloos +30 s) ·
**nu** (eerstvolgende 4 maten) · het plan en de stap.

Actions: `auto.aan`, `auto.ok`, `auto.skip`, `auto.langer`, `auto.nu`. Geen
plek op de standaard-APC (AU1); koppelen werkt.

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

- `test/auto.test.mjs` (65 checks): de planner (Camelot, soort, sync-verschuiving,
  frasegrenzen, curves, fragment, kiezer) en de automaat op een echte engine met
  nep-Web Audio: van stilte, klaarzetten, langer/nu/ok, een hele blend (sync, op
  de maat, nooit twee bassen, netjes terug), de volgende op de andere track,
  overslaan naar de kiezer, overnemen, dode lucht, en een hele beatloze overgang
  (nooit een gat).
- `tools/headless/auto.mjs` in headless Chromium (Linux): een set van drie
  demotracks via de rij en de knoppen: blend (gesynct op 124), dan filter-uit naar
  een track met een onzeker grid; langste stilte op de master **0 ms**; geen
  consolefouten. Foto's `tools/headless/uit/auto-*.png`.
- `server.test`: `plannen/` in de witte lijst, alleen `.json`, geen uitstapjes.

Niet getest: met Clay's echte library in zijn Chrome (streaming, lange mixen,
seek naar een beginpunt midden in een uur), met de APC, op de M1. Niet beluisterd.

## 7. Bekende grenzen (fase 1)

- Fades gaan in stapjes van 0,01 over de bus (~0,45 dB, elke tik van 40 ms),
  niet als helling op de audioklok: goed genoeg om te horen, niet mooi genoeg om
  te bewaren. Beter: een geplande helling per fader (klein, ~0,5 sessie).
- Geen frase-, intro/outro- of energieanalyse: frasegrenzen tellen vanaf het
  maat-anker, niet vanaf de muziek. Hotcues als mix-in/mix-out: nog niet.
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

- **AU1 🎛** Welke APC-knoppen voor ok/overslaan/langer/nu? Advies: een eigen
  mapje "auto" als fragment (zoals "vorm"), één rij met de vier in kleur.
- **AU2 👂** Klinkt overvloeien in 24 s goed bij jouw muziek, of langer (32–48 s)?
- **AU3 👂** Moet "nu" bij beatloos echt meteen, of 4 s later zodat je het ziet aankomen?
- **AU4 💬** Mag de automaat tracks laden op een lege track als jij daar straks iets wilt? (Nu: eerst zijn eigen twee, dan een lege.)
