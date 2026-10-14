# Verslag werkruimte S2 — de uitlijnweergave (14 okt)

Tak `werk/S2` (vanaf `werkruimte/integratie`), worktree buiten de repo. Niet gepusht.
Details en de rekenregel: `docs/werkruimte/S2.md`.

## Wat gebouwd is

Alle tracks tegelijk zien lopen (Clay punt 4), in tellen van de maatgever zoals je hem hoort:

- `src/uitlijn/reken.js` (puur): de as (1 of 2 maten, pagina die omslaat), per baan de tracktijd
  uit `Deck.tijdlijn()` met `positieIn` (loop zonder sprong, wachtende track valt in op de "1",
  rem, geplande sprong met keylock, pauze), gridlijnen/tellen/klappen op x, de getallen grid Δ,
  muziek Δ (`faseTussen`, hier en niet in de engine: `tellen.js` had hem niet), drift per 16
  tellen, maat, ⚠ via `afwijkingBij`, de vouw, de tekensleutel. Invoer `{ decks, maatgever, V, nu }`,
  dus ook bruikbaar op de iPad met segmenten van buiten.
- `src/uitlijn/teken.js`: pagina (standaard), vouw en strook; tegels in tracktijd, tekenen alleen
  bij een nieuwe sleutel, speelkop als CSS-transform, slepen = `track.N.phase.offset` als die
  action bestaat (S1), anders niets.
- `uitlijn.html` + `src/uitlijn/venster.js`: los venster via `window.opener.varveUitlijn`; geen
  AudioContext, MIDI of Web Lock (de test volgt de hele importboom; headless geteld: 0/0/0).
- `src/ui/aanhakers/uitlijn.js`: `window.varveUitlijn`, de knop "uitlijn" achteraan de
  transportrij van de focus-track, `toonInWerkvak(el, vorm)`, en (voor de werkruimte als data)
  `toonVak(el, naam)` en `open(naam)` met de vaknamen `uitlijn`, `uitlijn-strook`, `uitlijn-vouw`,
  `uitlijn:<vorm>:<maten>` (dezelfde namen als in de voorbeeldwerkruimte van S3).
- `src/ui/css/uitlijn.css` (alles onder `.ul`, geen `:has()`, `contain` per vlak).
- Buiten de grens, klein: twee structuurregels in `CLAUDE.md` (toegestaan door de opdracht), en de
  "Gebouwd"-alinea in de sectie S2 van `docs/WERKRUIMTE.md`. De engine, app.js, index.html,
  styles.css, server/index.js en de mappings zijn niet geraakt (uitlijn.html stond al op de witte
  lijst van S0).

Zonder werkruimte verandert er niets aan wat VARVE doet: er komt alleen één knop bij, en de
weergave rekent en tekent pas als hij open staat.

## Gemeten (exacte commando's)

```
node test/uitlijn.test.mjs
VARVE_TMP=<scratchpad>/tmp-werk-S2 VARVE_CHROME=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell \
  node tools/headless/uitlijn.mjs <scratchpad>/tmp-werk-S2/uit
node test/alles.mjs
```

- `test/uitlijn.test.mjs`: alle checks groen. Gridlijnen bij 124 en 128,3 bpm gesynct: 0,00 px
  verschil op 1200 px; +10 ms → grid Δ 10,0000; drift 0,5% → 38,517092 ms/16 tellen (exact); maat
  ±1/±2 herkend; loop rondgaan: grid Δ gelijk vóór en na de naad, lijnen op dezelfde x; wachtende
  track: eerste lijn op x = 204 (de "1" van de maatgever); muziek Δ bij 12 ms flam met gelijke
  grids 12 ± 1; vouw met flam = twee stapels; 60 beelden zonder verandering = 0 keer tekenen.
- Headless (8 tracks, 31 checks groen): pagina 0,16 Mpx/s, vouw 1,06 Mpx/s, rekenwerk 0,267 ms per
  beeld, hoofdvenster verliest 0,29 b/s met uitlijn.html open, strook in de mixer +0,18 Mpx/s,
  DOM tegen `engine.faseVerschil` 0,000 ms op zeven tracks, transportrij en focusdeck niet hoger op
  1440×900 en 1440×790, geen consolefouten.
- `node test/alles.mjs`: zie de samenvatting onder "Tests".

## Wat niet gedaan is

- Slepen duwt pas als S1 (`track.N.phase.offset`) erbij komt; getest op een nep-bus (juiste
  fractie) en headless zonder S1 (doet niets).
- Het werkvak per deel (S3) en de iPad/mac-2 (S7) roepen `toonVak` aan; dat koppelen is hun werk.
- De vouw op het Maschine-scherm (A7) is S6.

## Alleen op hardware te bevestigen

- GPU-kosten op de M1 (Metal) van tegels en speelkop; deze container rendert met swiftshader.
- Of "muziek Δ" klopt met het oor op echte muziek (proefavond A), en of de kleuren (3/10 ms)
  goed voelen.
- Het venster op een tweede fysiek scherm naast de mixer met acht echte tracks.

## Vragen voor Clay

- Is twee maten per pagina goed als standaard, of liever één (groter per tel)?
- Wil je de knop "uitlijn" in de transportrij houden als het werkvak er is, of mag hij dan weg?
- Moet een track zonder gevonden tellen (alleen klappen) "grof" blijven tonen, of liever leeg?

## Hoe je het zelf invult

1. Knop **uitlijn** (achteraan de transportrij van de focus-track) opent het venster; kies bovenin
   pagina · vouw · strook en 1 of 2 maten. Het venster onthoudt het. Sleep het naar je tweede scherm.
2. Een vaste vorm als bladwijzer: `http://localhost:8777/uitlijn.html?vorm=vouw&maten=1` (open hem
   wel vanuit de mixer: het venster leest de mixer via `window.opener`).
3. In je werkruimte (S3) zet je een vaknaam bij een deel en scherm, bijvoorbeeld:
   ```json
   "uitlijn": { "schermen": { "hoofd": { "werkvak": "uitlijn-strook" }, "mac-2": { "vakken": ["uitlijn:pagina:1"] } } }
   ```
   Namen: `uitlijn`, `uitlijn-pagina`, `uitlijn-strook`, `uitlijn-vouw`, `uitlijn:<vorm>[:1|2]`.
4. Welke knop duwt kies je in je mapping (S1's `track.N.phase.offset`); slepen in een baan gebruikt
   dezelfde action.

## Volgende versie (opties)

- Zoom in de baan (een halve of kwart tel breed) voor de laatste millisecondes.
- De vouw als klein vak naast elke kolom (8 × één maat).
- Golfvorm per stem (drums) in de baan, zodat de kicks duidelijker zijn dan de hele mix.
- Een "pak de flam"-hulp: muziek Δ als voorstel voor `phase.offset` met één druk.
