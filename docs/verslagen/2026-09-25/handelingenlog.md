# Spoor D — handelingenlog met terugspelen (ROADMAP 20)

Branch `spoor2/handelingenlog` (worktree `agent-a67bf0478bb9cc5c7`), vier commits op
`cc527e3`, daarna `git switch --detach`. Niet gemerged, niet gepusht.

```
59eba6c Handelingenlog op de server: naast de opname, elk stuk op zijn plek
3249ec6 Handelingenlog en terugspelen: meeluisteren op de bus, terug op de audioklok
a1d27c2 Handelingenlog in het scherm: knop naast de opname, lijst om terug te spelen
d67281b Handelingenlog: test, headless-controle en het formaat in docs
```

**Server herstarten na mergen** (nieuwe routes + `server/handelingen.js`, en
`server/opname.js` is gewijzigd). Dat heb ik niet gedaan (:8777 niet aangeraakt).

## Wat er is

- **Vastleggen.** Elke action op de bus (MIDI, toetsenbord, muis, terugspelen) als
  `[t, "actie", waarde]`, t = `ctx.currentTime` sinds de start, op 1 µs, waarde in volle
  precisie. Plus gebeurtenissen: `laad` (library-id/demo/los, titel, grid, laadduur),
  `focus`, `rack` (inhoud + live standen + mix/bypass), `grid`, `pads` (bewaarde
  sampler-pads), en een `stand` (beginstand) als tweede regel, zodat een log dat midden
  in een set begint op zichzelf afspeelbaar is. `kop` eerst, `eind` laatst.
- **Bewaren** naast de opnames: `opnames/set-<id>.acties.jsonl`. Loopt er een opname, dan
  hetzelfde id als de WAV. Elke seconde een stuk `{van, tekst}` (JSON), de server zet het
  op byte `van` (zoals `?frame=N`): herhalen na een verloren antwoord = geen dubbel, een
  verloren stuk = gat van nullen dat de lezer overslaat, crash = hooguit 1 s kwijt. Alles
  ASCII (`\uXXXX`), dus tekens = bytes en `van` klopt altijd.
- **Terugspelen.** Beginstand (alle nummers tegelijk laden, standen zetten, alles wat
  speelde in één keer aan), dan elke regel op T0 + t de bus op (tik 10 ms op de
  audioklok). Laden begint op `t - duur`; handelingen voor een track die nog laadt
  wachten (geteld als "te laat"), de rest loopt door. Klaar als alles gedaan is én de
  duur van het log om is. Stop/klaar laat ingedrukte knoppen los.
- **UI.** `○ log` naast de opnameknop (toont `◉ log 0:03 · 10 kB`), `↺` opent de lijst
  (datum, duur, grootte, "● opname", "afgebroken"), `speel` (tweede klik als er iets op
  de tracks staat). Tijdens terugspelen toont ↺ `■ 0:12 / 45:00`, klik = stoppen.
  Geen APC-knop. Actions: `log.toggle`, `log.replay.stop` (define + apc-beschrijf).

## Hoe (bestanden)

| Bestand | Rol |
|---|---|
| `src/control/actions.js` | `bijInvoke(fn)`: meeluisteren, vóór de action draait (luisteraar die gooit breekt de bus niet). `bindLog()` |
| `src/control/handelingen.js` | `Handelingenlog` (start meteen vastleggen, per seconde wegschrijven, 3 pogingen, `noodstop` bij pagehide met keepalive), `asciiJson`, `leesLog`, `leesStand`, `rackStand` |
| `src/control/terugspelen.js` | `maakPlan`, `Terugspeler`, `maakUitvoerder` (wat laad/rack/grid/focus/pads/beginstand voor de engine betekent; testbaar met de Web Audio-mock) |
| `src/ui/logboek.js` | knop, lijst, koppeling met de opname, focus meteen, rack/grid/pads vergelijken (microtask na elke knop + elke 100 ms) |
| `src/ui/laden.js` | `naLaad` bij elke geslaagde laad, `staat.deckHerkomst`, `laadLibrary` (uit onLaad gehaald), `laadVoorTerugspelen`, `staat.terugspeelDecks` |
| `src/ui/racks.js` | `naRack(deckId)` na elke rackwissel (meteen in het log) |
| `src/ui/sampler-opslag.js` | geen POST/DELETE van pads voor teruggespeelde tracks |
| `src/ui/vensters.js`, `spiegel.js` | klikken op golfvorm/baan = `track.N.seek` via de bus (was `d.seek` direct: het log zag het niet). Demo geeft `{bron:'demo', demo:{seed,bars}}` mee |
| `src/opname/opnemer.js` | `onBegin(id)` / `onEind(id)` |
| `src/ui/renderloop.js` | stap `logboek` |
| `server/handelingen.js` | start (met/zonder opname-id), schrijf (keuring), pad, samenvatting, lijst |
| `server/index.js` | `GET /api/handelingen`, `POST /api/handelingen/start`, `POST /api/handelingen/<id>/stuk`, `GET /api/handelingen/<id>` |
| `server/opname.js` | `ID`, `nieuwId`, `LOG_EXT` geëxporteerd; `start()` kiest geen id waar al een los log op staat |
| `index.html`, `styles.css` | twee knoppen + `#log-lijst` |
| `docs/HANDELINGENLOG.md` | formaat, keuzes, routes, grenzen |

Regel 1: de engine weet van niets (`regels.test` groen). Regel 3: alle tijden van
`ctx.currentTime`; de 10 ms-timer bepaalt alleen hoe vaak we kijken.

## Keuzes (gemotiveerd)

1. **Naast de opname, niet een eigen map.** Wat bij elkaar hoort blijft bij elkaar
   (kopiëren/weggooien neemt het log mee), zelfde id-reeks en `VARVE_OPNAMES`, `opnames/`
   is al niet in git. Een los log is een set die je niet opnam, met een eigen id.
2. **Stukken als JSON `{van, tekst}` in plaats van octet-stream.** Houdt de JSON-regel
   heel; ASCII maakt de byte-telling exact. De server leest de body rauw (leesJson kan
   een teken over een pakketgrens breken — zie bevindingen).
3. **MIDI/toetsenbord doen mee tijdens terugspelen.** Opnieuw renderen met andere visuals
   = live beeld spelen over de replay (01-plan §5.5); een fader dichtdraaien moet altijd
   kunnen; blokkeren vraagt een poort op het hete pad van `invoke`. Wie een fout exact
   wil naspelen: niets aanraken. Soft-takeover voorkomt springende faders.
4. **Rack/grid/pads vergelijken in plaats van overal meldingen inbouwen.** Zo komen ook de
   rack-editor, de server-verfijning en "opnieuw analyseren" erin zonder dat die modules
   van het log weten. Knopstanden zitten NIET in de rack-vergelijking (staan al als
   actions; anders 2 kB per knopdraai).
5. **Terugspelen bewaart niets in de library** (`terugspeelDecks`: grid, tap-verfijning,
   pads). Anders schreef bv. "×2" uit de set van toen opnieuw over het grid van nu
   (dat al ×2 was). Racks/pads van het nummer komen uit het log, niet uit de library.
   Een library-id als rack-herkomst wordt niet overgenomen (anders overschrijft "bewaar"
   een rack dat inmiddels anders kan zijn); een sjabloon wel.
6. **Niet opnieuw de bus op:** `record.*`, `log.*`, `layer.*` (zou de APC onder je handen
   omzetten), `track.N.rack.next/prev` (hangt af van de library van nu; de `rack`-
   gebeurtenis zegt welk rack het werd). **Track zonder zijn nummer van toen** (weg uit de
   library, los bestand, leeg): transport/cues/loops/grid/seek overgeslagen (anders speelt
   `play` wat er toevallig staat), faders/EQ/focus/kant wel.
7. **Het log start handmatig (○ log) en vanzelf met een opname**, niet altijd. Zie vraag 1.

## Formaat (kort; volledig in docs/HANDELINGENLOG.md)

```
{"t":0,"e":"kop","versie":1,"begon":"…Z","klok":1234.567,"opname":"20260925-201302"|null,"sampleRate":48000,"tracks":8}
{"t":0,"e":"stand","focus":1,"tracks":[{track,bron,nummer|demo,titel,positie,speelt,rate,bereik,cue,hotcues,loop,grid,kant,rack}…],
 "waarden":{value-actions behalve seek/pitch/tempo/grid.bpm},"rond":{curve,tellen,mengvorm,…},"pads":[…8],"herinneringen":[…8]}
[12.345667,"track.1.fader",0.5039370078740157]
{"t":45.2,"e":"laad","track":2,"bron":"library","nummer":"abc","titel":"…","duur":0.412,"grid":{…}}
{"t":…,"e":"focus","track":3}   {"t":…,"e":"rack","track":1,"rack":{…}}   {"t":…,"e":"grid","track":1,"grid":…}
{"t":…,"e":"pads","herinneringen":[…]}   {"t":…,"e":"eind","regels":N[,"afgebroken":"pagina dicht"]}
```

## Grootte (gemeten met de echte klasse, een uur)

| scenario | handelingen/s | MB per uur |
|---|---|---|
| rustig | 5 | 0,8 |
| druk (¾ draaien, ¼ drukken) | 50 | 8,4 |
| extreem: 300/s alleen draaien, een uur | 300 | 53 |

~47 bytes per actieregel, beginstand ~10 kB. Geen uitdunning, geen afronding van
waarden. In het geheugen staat hooguit één seconde. (WAV van een uur: ~690 MB.)

## Tests

- **`test/handelingenlog.test.mjs`** (nieuw, 94 checks, groen, ~3 s): ASCII/leesLog;
  bus-luisteraar (vóór de action, onbekend niet, kapotte luisteraar breekt niets);
  vastleggen met nep-klok (tijden relatief, 1 µs, volle precisie, volgorde, kop/stand/eind,
  bytes = bestandsgrootte); haperend netwerk tegen de ECHTE server/handelingen.js
  (antwoord kwijt → zelfde plek, verzoek kwijt → tweede poging, 3× weg → gemeld + gat van
  nullen, alles erna op zijn plek, niets dubbel); veilige paden en keuring (../, lege/
  getal-id's, niet-ASCII, geen JSON, geen regeleinde, van negatief/gebroken/te ver, log
  of opname die niet bestaat, opname en los log in dezelfde seconde → eigen id's, lijst:
  af/duur/crash-staart/volgorde); Terugspeler met nep-klok (binnen één tik op tijd,
  volgorde bij gelijke t, overslaan, laden op t − duur, wachtende track vs doorlopende
  track, te laat geteld, loslaten bij stop, duurt zo lang als het log, track zonder
  nummer); rondje met de ECHTE engine (Web Audio-mock): leesStand-velden, opnemen,
  alles door elkaar, terugspelen → zelfde eindstand (speelt, fader, low, xfader, curve,
  fx-mix, hotcue binnen een tik, positie), rack alleen als het anders is; grootte van een
  uur; routes op een EIGEN server (tijdelijke db/opnames/media): 415 als formulier,
  stukken idempotent, GET precies terug, niet-ASCII 400, Origin vreemd 403 / eigen 200,
  `../` en `%2f` nooit 200, log bij opname = zelfde id.
- **`tools/headless/kijk.mjs`** (uitgebreid; `VARVE_KIJK_POORT=8866 VARVE_KIJK_DEBUG=9466`,
  headless Chromium zonder MIDI, eigen server): knop start/stopt, knop toont tijd en
  grootte, log bewaard en af, beginstand = demo, actions en focus-gebeurtenissen in
  volgorde, lijst + "nog eens", terugspelen → zelfde eindstand; opname start → log met
  hetzelfde id, stop → log ook; een klikspoor door de echte ingest → library-nummer →
  log → iets anders op de track → terugspelen laadt het nummer streamend terug op track
  2, fader en positie kloppen; **tegenproef**: grid op een teruggespeelde track gaat niet
  naar de library, na een gewone laad wél. Alles groen, geen fouten in de console.
  Schermafdrukken: scratchpad `kijk/handelingenlog-lijst.png`, `handelingenlog-loopt.png`.
- **`nice -n 10 node test/alles.mjs`**: 30 bestanden, 2017 checks; 1 rood:
  `vormen-zwaar.test.mjs` "cl: kwaliteit 0,25 is goedkoper (3.90 tegen 4.50 ms)" —
  timing onder belasting (andere sporen draaiden), los opnieuw groen (2.96 tegen 5.50 ms).
  Niets met dit spoor te maken.

## Wat NIET getest is

- In Clay's eigen Chrome met de APC: MIDI tijdens terugspelen, soft-takeover op faders
  die niet staan waar de replay ze zette, LED's die de replay volgen.
- Een echt uur spelen in realtime (de grootte is synthetisch gemeten met echte regels).
- `noodstop` bij tab dicht/herladen (pagehide + keepalive) — niet gemeten.
- De rack-editor in het log (vergelijken op identiteit): de logica in logboek.js is
  alleen headless-indirect gedekt; niet getest dat een editor-draai als `rack`-gebeurtenis
  verschijnt. `maakUitvoerder.rack` zelf is wel getest.
- Sampler-pads in de beginstand (opnieuw knippen via `herstel`, spelende pads op de tel).
- Een `laad` midden in een log met echte laadtijd in de browser (alleen de beginstand-laad
  is headless getest; laden op t − duur en wachten is in Node met een nep-klok getest).
- Een los log dat al liep als de opname start (sluiten + na de opname opnieuw beginnen).
- Vormen/video-standen terugzetten (`waarden`/`rond` voor video.*: via de bus, niet apart
  gecontroleerd).
- Uitlijning `kop.klok` ↔ frame 0 van de WAV (enkele ms, niet gemeten).
- Achtergrondtab (timers geremd als er niets klinkt).

## Aannames (kunnen verkeerd zijn)

- Een rack verandert alleen via nieuwe objecten/lijsten (`zetRack`, `bewerkMacros`,
  `zetParam`, `hernoem`) of `bypass`. Muteert iets ooit `fx.rack` ter plekke, dan ziet het
  log het niet (het staat dan wel in de volgende `rack`-gebeurtenis).
- `schrijfRack(leesRack(x))` geeft x terug (anders bouwt terugspelen een rack twee keer:
  een extra kruisfade, geen fout). Voor het standaard-delayrack getest.
- Chrome remt timers niet af in een tabblad dat geluid maakt.
- 10 ms tik en 100 ms vergelijken zijn fijn genoeg; niet op Clay's M1 onder last gemeten.

## Bevindingen buiten dit spoor

1. **`leesJson` in `server/index.js` plakt pakketten als tekst aan elkaar** (`data += d`):
   een UTF-8-teken dat over een TCP-pakketgrens valt wordt �. Geldt voor alle JSON-routes
   (racknamen, mapping, …), alleen bij grote bodies. Mijn route leest rauw. Voorstel:
   Buffers verzamelen en één keer `toString('utf8')`.
2. **`/opnames/set-*.wav` via de witte lijst serveert uit `WORTEL/opnames`, niet uit
   `VARVE_OPNAMES`** — in tests met een tijdelijke opnamemap wijst dat naar de echte map.
3. **Scratchpad is gedeeld met de andere sporen**: ik heb `scratchpad/commit1.txt` en
   `commit2.txt` overschreven (bestonden al) voordat ik naar `scratchpad/hlog/` uitweek.
   Als een ander spoor die bestanden voor een commitbericht gebruikte: dat bericht
   controleren (begint dan met "Handelingenlog …").

## Vragen voor Clay

1. **Log altijd aan?** Nu: met ○ log en vanzelf met elke opname. Altijd aan (vanaf het
   openen) betekent dat ook een onverwachte fout na te spelen is, voor ~1–8 MB per uur
   in `opnames/`. Advies: ja, als keuze die onthouden wordt.
2. **Opnieuw renderen in één knop** (terugspelen + meteen opnemen)? Nu: eerst ● opnemen,
   dan speel (de beginstand laadt dan in de eerste halve seconde van de opname mee).
3. **MIDI tijdens terugspelen**: nu aan (zie keuze 3). Een "alleen kijken"-stand erbij?
4. **Logs opruimen** (weghalen uit de lijst)? Niet gebouwd.

## Voorstel CLAUDE.md-tekst

Onder Structuur:
```
  control/          handelingen.js  het handelingenlog: [t, action, waarde] op de audioklok, per seconde weg
                    terugspelen.js  een log terugspelen: beginstand, dan elke regel op T0 + t; maakUitvoerder
  ui/               logboek.js      ○ log en ↺ naast de opname: vastleggen, vergelijken, lijst, terugspelen
server/             handelingen.js  handelingenlogs naast de opnames: stukken op hun plek, lijst, lezen
test/               handelingenlog.test.mjs  vastleggen (nep-klok), haperend netwerk, terugspelen, paden, grootte, eigen server
docs/               HANDELINGENLOG.md  formaat, keuzes en grenzen van het handelingenlog
```

Onder Bekende grenzen:
```
- HANDELINGENLOG (25 sep, ROADMAP 20, docs/HANDELINGENLOG.md): alles op de bus als
  [t, action, waarde], t = ctx.currentTime sinds de start (1 µs), plus laad/focus/rack/
  grid/pads en een beginstand. Het log hangt aan de bus (`bijInvoke`, vóór de action) en
  aan de laadlaag (`naLaad`); de engine weet van niets. Bewaard NAAST de opname:
  opnames/set-<id>.acties.jsonl, met het id van de WAV als er een opname loopt (een
  opname neemt er vanzelf een mee; ○ log voor een los log). Stukken {van, tekst} op hun
  byte, zoals ?frame=N: geen dubbel, gat = nullen, crash = 1 s. Alleen ASCII (\uXXXX),
  dus tekens = bytes. ~8 MB per druk uur, niets uitgedund. Rack/grid/pads worden
  VERGELEKEN (microtask na elke knop + 100 ms), niet gemeld: zo komen editor en server
  erin. Terugspelen: beginstand, dan T0 + t op de audioklok (tik 10 ms), laden op
  t − duur, klaar na de volle duur. Slaat record.*, log.*, layer.* en rack.next/prev
  over; op een track zonder zijn nummer van toen ook transport/cues/loops/grid.
  MIDI en toetsenbord doen mee (live beeld erover, fader moet altijd kunnen). Wat
  terugspelen laadt staat in staat.terugspeelDecks: daarvan gaat niets naar de library
  (grid, tap-verfijning, pads) tot er gewoon iets anders op geladen wordt. Klikken op
  golfvorm/baan springt via de bus (track.N.seek), anders zag het log het niet.
```
