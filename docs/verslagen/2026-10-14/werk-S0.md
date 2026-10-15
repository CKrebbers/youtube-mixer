# Werkruimte S0: aanhaakpunten en fragment-mechaniek (14 okt 2026)

Tak `werk/S0` (vanaf `werkruimte/integratie` 07e158a, waarin `afmaken/controller-invoer` en
`-uitvoer` al zitten), worktree buiten iCloud, niet gepusht. Ontwerp: `docs/WERKRUIMTE.md`
deel A–C en D4 "S0". Wat er gebouwd is, voor wie eraan komt: `docs/werkruimte/S0.md`.

## Kort

Golf 1 van de werkruimte: de gedeelde bestanden één keer openzetten, zodat S1–S8 alleen hun
eigen bestanden aanraken. **Er verandert geen gedrag**: alle bestaande tests en de headless
proeven zijn groen zonder één aangepaste verwachting; de drie rode tests zijn de bekende van
deze container en zijn op de basis precies zo rood.

## Gebouwd

1. **Aanhakers.** `src/ui/aanhakers.js` (`startAanhakers`, `maakRenderloop`) en acht lege
   `src/ui/aanhakers/<spoor>.js`. Eén blok onderaan `app.js`, na alle opzet; vaste volgorde,
   na elkaar; een aanhaker die gooit (of niet laadt) geeft één melding, de rest start.
   `ctx` zoals het ontwerp; `ctx.renderloop` = `{ stap(naam, fn) }` (eigen rAF, alleen met
   stappen); `ctx.maschine` = Promise (de Maschine met `?hub=`, anders null).
2. **Uitleg.** `src/ui/beschrijf/index.js` + vijf lege sporen; `beschrijf()` vraagt ze eerst.
   apc.html en maschine.html laden zonder bus (headless nagelopen).
3. **Meta-vlaggen.** `log: 'overslaan'` (`slaOver` in terugspelen.js), `beginstand: false`
   (leesStand in handelingen.js, waarden én rondlopers), `overneem: true` (`neemtOver` in
   automaat.js), `alleenScherm: true` (Mapping weigert de regel bij laden, fragment en koppelen,
   met een melding via het app.js-blok).
4. **Mapjes en fragmenten.** `voegMapjeToe`, `haalMapjeWeg`, `zetVolgorde` in lagen.js;
   `voegVormMapjeToe()` is er een aanroep van (GROEPEN en LAAGNAAM deepEqual). `herbindLagen()`
   in actions.js (idempotent, haalt verdwenen layer-actions van de bus; `bindLagen` gebruikt
   hem). `vervangFragment`/`haalWeg` in mapping.js; `mapjes` in een document telt niet mee.
5. **Rijenregister.** `src/ui/rijen.js`; de acht panelen melden zich aan met hun eigen `zet`.
6. **`Deck.tijdlijn()`**: alleen lezen, uit `bron.seg`/`_segId`/`_vorig`.
7. **Server.** `server/routes/index.js` + drie lege routebestanden, vorm gecontroleerd bij het
   starten; routes vlak vóór de 404 (na Host/Origin en de JSON-regel), `mag` bij de witte lijst;
   `werk.html`, `uitlijn.html`, `spiekbrief.html`, `werk.webmanifest` op de witte lijst
   (`.webmanifest` = `application/manifest+json`).
8. **HTML/CSS.** `#werk-balk` (ná de bovenbalk) en `#werkvak` (vóór `#rijen`), leeg en `hidden`;
   drie lege stylesheets gelinkt. `styles.css` niet aangeraakt.
9. **regels.test**: de engine importeert niets uit `src/werk|uitlijn|paneel/`; de vier pure
   modules (zodra ze bestaan) geen DOM, geen dynamische import, niets uit ui/server/video/opname of
   niet-pure control. Nagelopen met tijdelijke foute bestanden: ze worden rood.
10. **`test/aanhaakpunten.test.mjs`** (88 checks), `docs/werkruimte/S0.md`, CLAUDE.md
    (structuurregels + een kort blok "Werkruimte: aanhaakpunten"), WERKRUIMTE.md S0 "Gebouwd".

## Gemeten (exacte commando's)

Alles vanuit `…/scratchpad/wt/werk-S0`. Chrome als root vraagt `--no-sandbox`: `VARVE_CHROME`
wees naar een wrapper `exec …/headless_shell --no-sandbox "$@"` (`scratchpad/tmp-werk-S0/chrome.sh`).

| wat | commando | uitkomst |
|---|---|---|
| alle tests | `node test/alles.mjs` | 103 bestanden, 9147 checks, 268 s. **Rood: alleen de bekende drie**: renderblok "keylock met wissels … bytes per bericht" (83,7–89,7), wachtrij "yt-dlp en zijn kind" (2×), instrumenten-fm-schaal "geen afval per blok" (29288 bytes, 0 GC). Op de basis (`git archive werkruimte/integratie`) zijn renderblok en wachtrij precies zo rood (89,7 bytes; 2× yt-dlp). |
| gouden hash, 0 GC | `node test/renderblok.test.mjs` | hash `9dfaeb73` = de gouden (stereo en 8 kanalen), stabiel 0 GC, stems 0 GC: ongewijzigd |
| de nieuwe test | `node test/aanhaakpunten.test.mjs` | 88 ok |
| rijen | `VARVE_KIJK_POORT=8900 VARVE_KIJK_DEBUG=8901 node tools/headless/rijen.mjs <uit>` | 565/565 ok, zonder aanpassing |
| kijk | `VARVE_KIJK_POORT=8902 VARVE_KIJK_DEBUG=8903 node tools/headless/kijk.mjs` | 77 ok, 0 FAIL ("Alles groen") |
| bovenbalk | `node test/bovenbalk.test.mjs` (in alles) | 10 ok |
| hub | `VARVE_HUB_REPO=<kopie> VARVE_KIJK_POORT=8906 node tools/headless/hub.mjs` (zonder VARVE_CHROME) | 34 ok, "varve-dj conform PROTOCOL.md". De hub in `/home/user/ckrebbers/av-app-hub` heeft geen `node_modules`; de proef draaide op een KOPIE in de scratchpad met `npm install --omit=dev --omit=optional --ignore-scripts` (alleen `ws`) en een link naar `/opt/node-tools/node_modules/playwright-core`. Het origineel is niet aangeraakt. |
| aanhakers in de mixer | `VARVE_CHROME=…/chrome.sh node scratchpad/tmp-werk-S0/aanhakers-headless.mjs <worktree>` (poorten 8904/8905, eigen server met VARVE_TESTSERVER=1 en alle VARVE_*-paden in tmp) | 13 ok: acht lege aanhakers starten, geen melding, **geen consolefout of uitzondering** (Runtime + Log; alleen de netwerk-404 van `/api/patronen/set` bij een lege patronenmap, die Chrome zelf logt; hij komt uit patronen-opslag.js, dat niet veranderd is); werk-balk en werkvak verborgen en 0 px; de acht rijen in het register, `rij('stems').zet(true)` opent hem zoals de knop; combi via CDP Fetch vervangen door een module die gooit: 7 gestart, **precies één melding** ("aanhaker combi niet gestart: proef: kapot"), geen consolefout; apc.html en maschine.html laden zonder consolefout. Het script staat in de scratchpad, niet in de repo (buiten de grens van S0). |

## Niet gedaan / anders dan het ontwerp

- `Deck.tijdlijn()` heeft een veld `vorig` erbij (zonder klopt `positieIn` niet vóór een
  geplande sprong met keylock); op de BufferBron (reserve) geeft hij `null`.
- `ctx.renderloop` is een eigen requestAnimationFrame naast `renderloop.js` (dat bestand is van
  S7, buiten mijn grens).
- Per paneel twee regels (import + aanmelding), niet één.
- `voegMapjeToe` kan geen NIEUWE groep maken (`houd`, Maschine `pads`/`pagina` uit B3/B5): de stand
  per groep zit in de constructor van Lagen. Dat is werk voor S4 (lagen.js in golf 2) of S6.
- `herbindLagen()` laat geen 'change' gaan; wie een mapje toevoegt terwijl de mixer draait en
  wil dat de mapje-balk en de spiegel het meteen tonen, laat zelf een 'change' gaan.
- Geen aanpassing aan de headless tools: een eigen proef voor de aanhakers staat in de
  scratchpad (de grens noemt geen `tools/`).
- CLAUDE.md: de grens in sporen.json zegt "NIET: CLAUDE.md", de opdracht van de workflow staat
  "alleen de structuurregel van je nieuwe bestanden en een korte regel" toe. Ik deed het laatste,
  in een EIGEN commit (structuurregels + het blok "Werkruimte: aanhaakpunten"), zodat de
  integrator hem los kan nemen of laten.
- Verder buiten de grens geraakt: geen. `server/index.js` kreeg ook `isTestserver` uit media-plek.js in
  zijn import (voor `ctx.testserver`) en `.webmanifest` in TYPES; beide in server/index.js zelf.

## Alleen op hardware te bevestigen

Niets nieuws: er komt geen regel bij in de mapping, de LED-laag is niet aangeraakt en de APC
krijgt precies dezelfde berichten. Wat ik niet kon nagaan: de mixer met `?hub=` en een echte
Maschine, waar `ctx.maschine` de instantie moet geven (headless alleen hub.mjs met nep-APC/LPD8,
niet speelapparaten.mjs).

## Vragen voor Clay

Geen voor S0 zelf. Voor de sporen erna (geen blokkade, ze kiezen zelf als jij niets zegt):
- Mag een action met `overneem: true` maar zonder track (een superknop) de auto-DJ altijd laten
  loslaten? Zo is hij nu gebouwd (zoals de crossfader).

## Opties voor een volgende versie

- `voegGroepToe(groep, { standaard, schakel })` in lagen.js (houd-mapjes, Maschine-mapjes), met
  een stand erbij in elke bestaande Lagen.
- `herbindLagen()` die zelf `lagen.emit('change')` doet, zodat scherm en kaart meteen volgen.
- `Deck.tijdlijn()` ook voor de BufferBron (een segment uit `_startedAt`/`_offset`/`_rem`), als
  keylock ooit de reserve wordt.
- Een headless proef `tools/headless/aanhakers.mjs` in de repo (nu in de scratchpad), zodat elk
  spoor zijn aanhaker in Chrome kan toetsen.
