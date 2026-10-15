# Integratie S9 in werkruimte/integratie (14 okt 2026)

## Wat samengevoegd is

`origin/werk/S9` (tip 2945eee) in `werkruimte/integratie` (was 82cf3ec). S9 bevatte 82cf3ec al, dus de merge
was een **fast-forward**, zonder conflicten: 39 bestanden, +4035 −44. Wat S9 bouwde staat in
`docs/PLAN-SET.md` en `docs/verslagen/2026-10-14/werk-S9.md`:
- snel een set klaarzetten;
- klaar-voor-de-set;
- de automaat die een set speelt terwijl Clay live bijmixt (tracks, GO, lagen, live-stand);
- sets opslaan en terugladen;
- de vakken `plan` en `sets`.

Omgeving: Linux-container met 4 kernen, Node 22, headless Chromium 1194 (`headless_shell --no-sandbox`,
software-GL). yt-dlp 2026.08.19 en ffmpeg zijn aanwezig.

## Hersteld

1. **Regressie van review ronde 3: de automaat startte niet in de echte app.** Dit is de belangrijkste.
   - Commit 2945eee liet `_laadZelf` (src/auto/automaat.js) een laad die `null` teruggeeft lezen als
     "verdrongen door Clay": het deck werd dan van Clay.
   - Maar `laden.laadLibrary` gaf ook bij een GELUKTE laad `null` terug, als de context loopt en er geen stems zijn
     (`return metStems ? { stems } : null`).
   - Gevolg: elke laad van de auto-DJ telde als een laad van Clay. `tools/headless/set-proef.mjs` stap 4
     was 2 van 2 keer rood: `{"hoofd":null,"eigen":[],"clay":["B"]}`, en de automaat kwam nooit in 'klaar'.
   - De mock in `test/auto-set.test.mjs` gaf `undefined` terug. Die was dus makkelijker dan de echte API, en
     daardoor zag de suite het niet (CLAUDE.md, "Mocks").
   - Herstel: een gelukte `laadLibrary` geeft nu altijd een object (`{}`). `null` betekent alleen nog
     "verdrongen". Het contract staat in het commentaar van laadLibrary en in CLAUDE.md bij `_laadZelf`.
   - De mock geeft nu ook `{}`, zoals de echte.
   - De andere gebruikers van de uitkomst kijken niet naar null:
     - library-panel leest `r?.stems`/`r?.hint`;
     - sets.js kijkt naar `=== false`;
     - terugspelen gebruikt de uitkomst niet.
   - Na het herstel is set-proef **26/26 groen**: `{"hoofd":"B","volgende":"A","eigen":["B","A"],"clay":[]}`.
2. **`tools/headless/sec-plan.mjs`** verwachtte nog dat `kent` precies `['in','uit']` was.
   - S9 breidde het planvenster bewust uit naar `KENT` (in, uit, go, lagen, tracks).
   - De check vergelijkt nu met `KENT` uit plan-model.js en eist dat in en uit erin staan. Dat is niet zwakker:
     het is precies wat het venster hoort te sturen.
   - Daarbij een dubbele, verouderde commentaarregel in plan-venster.js weggehaald.
3. **`sets/` stond niet in .gitignore**, terwijl PLAN-SET.md en CLAUDE.md "niet in git" zeggen.
   - Toegevoegd: `/sets/`, met de slash, want `src/sets/` hoort wel in git.
   - CLAUDE.md: `sets/` staat nu bij de datamappen in de Git-conventie.
4. **VARVE_SETS in de proefservers**: `harnas()` (werk-scherm.mjs, en daarmee alle werk-*-proeven en
   inrichten), latentie.mjs, sec-plan.mjs en sec-auto.mjs. Zonder die regel schrijft een proefserver die een
   set bewaart in `<worktree>/sets`. Set-proef en de tests zetten hem al.

## De suite

`node test/alles.mjs`, vóór en na het herstel: 122 bestanden, 10.549 checks, 10 overgeslagen, **3 rood**. Alle drie
zijn bekende omgevingsfouten, ook rood op d097a3e/82cf3ec:

| test | oorzaak |
|---|---|
| `wachtrij.test.mjs`: "yt-dlp en zijn kind zijn allebei weg" (2×) | procesboom van de container |
| `renderblok.test.mjs`: "keylock met wissels" (89,7 bytes per bericht) | afvalmeting van de WASM in deze V8 |
| `instrumenten-fm-schaal.test.mjs`: "geen afval per blok" (29–33 kB, 0 GC) | wisselt per run, op beide kanten |

De nieuwe tests van S9 zijn groen: `plan-set` 43, `auto-set` 51, `sets-server` 32 en `sets-mixer` 24.

## De flaky midi-test

`test/midi.test.mjs`, de uitgaande wachtrij. S9 raakt `src/control/midi.js` en `test/midi.test.mjs` niet.
Ik heb hem los 20× gedraaid op beide kanten (82cf3ec in een tijdelijke worktree, die daarna weer weg is):

| conditie | 82cf3ec | tip (S9) |
|---|---|---|
| rustige container | 1/20 rood | 0/20 rood |
| 4 kernen bezet (busy-loops) | 2/20 rood | 2/20 rood |

**Even flaky op beide kanten, dus geen regressie.** Er wisselen twee checks:
- **"na één tik is er een hap verstuurd, niet alles"**: de test wacht `setTimeout(6)` en verwacht hooguit twee
  vensters van 4 ms. Onder last duurt die wachttijd langer, en dan zijn er terecht meer berichten weg.
- **"in elk schuivend venster van 4 ms hooguit 16 berichten (gemeten 17)"**, één keer op de basis:
  - De hub zet de tijd in zijn ring (`_uitRij`: eerst `klok()`, dan versturen).
  - De nep-poort van de test neemt zijn eigen `performance.now()` pas ín `send`.
  - Een onderbreking tussen die twee verschuift de tijd van de test. Het venster van de hub zelf klopt dan nog.
  - Dit is een meetartefact van de test, geen overtreding van de Comet-regel. Wel een kandidaat om ooit
    deterministisch te maken met een nep-klok (`hub.klok` bestaat). Niet aangeraakt: het hoort niet bij S9.

## Headless

`VARVE_CHROME` = wrapper met `--no-sandbox`, `VARVE_TMP` in de scratchpad. Elke proefserver draait met
`VARVE_TESTSERVER=1` en tijdelijke paden (nu ook VARVE_SETS).

| proef | uitslag |
|---|---|
| `set-proef.mjs` (S9: klaarzetten, opslaan → alles anders → terugladen, tweede druk, auto-DJ op gestreamde tracks) | vóór het herstel 24/26 (stap 4, 2× na elkaar); daarna **26/26** |
| `sec-plan.mjs` | vóór 36/37 (de `kent`-check); daarna **37/37** |
| `sec-auto.mjs` | **18/18** |
| `werk-scherm.mjs` | **36/36** |
| `inrichten.mjs` | **15/15** |

Set-proef liet zien:
- een set van twaalf nummers in 3 handelingen;
- de boog met de piek op plek 9;
- na terugladen dezelfde stand, met plan en patronen, en er speelt niets;
- de tweede druk over een spelende track.

## Latentie (`latentie.mjs`, één volle ronde per kant, daarna twee keer fader + sweep)

| scenario | maat | 82cf3ec | S9 (na herstel) | S8 (ter vergelijking) |
|---|---|---|---|---|
| fader | tot geluid p50 / p99 | 0,53 / 11,7 ms | **0,39** / 9,24 ms | 0,40 / 8,13 ms |
| fader | werk per bericht p50 | 0,19 ms | 0,19 ms | 0,19 ms |
| fader | tot scherm p50 | 10,9 ms | 10,5 ms | 11,2 ms |
| rust | stijl ms/s · taak ms/s | 29,0 · 425 | **28,0** · 412 | 30,8 · 435 |
| shift / mapje | stijl ms/s | 71,8 / 88,6 | 72,5 / 88,3 | 82,1 / 87,6 |
| alle | lange taken | 0 | 0 | 0 |

In de eerste volle ronde van S9 was de sweep 4,0 / 45 ms (basis 0,44 / 10). Het systeem was toen drukker
(belasting 2,6 tegen 1,65). Twee herhalingen van fader + sweep, om en om met de basis:

| run | S9 | basis |
|---|---|---|
| 1 | 0,55 / 10,7 ms | 0,69 / 13,0 ms |
| 2 | 0,85 / 12,7 ms | 0,69 / 12,2 ms |

Dat was dus ruis. **De winst van vandaag is heel.**

## Wat S9 bewust niet bouwde (werk-S9.md §3, VRAGEN blok S9)

| niet gebouwd | waarom |
|---|---|
| een set kiezen in de Controlekamer (S9-7) | kiezen en terugladen zitten in het planvenster, het vak `sets` en de actions; eerst Clay vragen of hij een tegel wil |
| terugladen vanaf de iPad (S9-4) | `set.terugladen` en `set.bewaar` staan in VAST_NOOIT: terugladen laadt nummers en kiest een werkruimte, en dat verbiedt VAST_NOOIT al voor andere routes; `plan.*` mag via `mag` |
| backup van `sets/` (S9-6) | de backup neemt alleen `library.db`; ook `plannen/` en `patronen/` zitten er niet in, dus een keuze voor Clay |
| een begintijd voor "tot 01:30" | rekent vanaf nu |
| lagen over meer stappen of tot een sectie | volgende versie |
| de krat-route headless | de proef draait zonder kaart |

Alleen live te bevestigen (S9-8): een hele set met overnames in de echte browser, een laag op de maat met echte
muziek, GO op de APC, terugladen van acht tracks met stems op de M1, de vakken op de echte iPad en de boog op
Clay's eigen library.

## Voor S10

- Begin vanaf `werkruimte/integratie` (deze tip) en voeg eerst `origin/werkruimte/integratie` bij je tak samen.
- **`laden.laadLibrary`: gelukt = een object, null = verdrongen.**
  - De automaat leunt erop.
  - Een nieuwe `return null` in laadLibrary voor iets anders dan "een nieuwere laad won" breekt de auto-DJ.
  - Test-mocks van `laad` moeten een object teruggeven.
- Een nieuwe proefserver zet ook `VARVE_SETS` (zoals PLANNEN/PATRONEN/STANDEN). `harnas()` doet het al.
- Effect-sjablonen die S10 toevoegt, gaan in een set alleen mee via het plan en de mixer-momentopname. Racks horen bij
  het nummer, niet bij een set. Raakt S10 aan wat een set bewaart (`leesStand`), draai dan `test/sets-mixer` en
  `tools/headless/set-proef.mjs` mee.
- `set-proef.mjs` hoort bij de regressieproeven van de werkruimte: de suite ving de regressie hierboven niet,
  set-proef wel.
- De flaky midi-test (zie boven) is niet van S9 en niet van S10. Rood daar alleen op die twee checks = de omgeving.
