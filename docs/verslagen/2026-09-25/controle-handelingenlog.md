# Controle spoor D — handelingenlog met terugspelen (ROADMAP 20)

Branch `spoor2/handelingenlog-c` (afgetakt van `spoor2/handelingenlog`, d67281b), worktree
`agent-a50a395a9e98cf802`. Zeven commits bovenop de vier van de bouwer. Niet gemerged, niet
gepusht, geen worktrees of branches weggehaald. Laatste stap: `git switch --detach`.

```
3c9fe98 leesJson verzamelt bytes: een teken over een pakketgrens bleef stuk
d5ce927 Statische /opnames/-paden uit VARVE_OPNAMES, niet uit de projectmap
038b97e Terugspelen: stoppen tijdens het laden van de beginstand stopt ook echt
6dd04e7 Terugspelen: de beginstand zet ook het grid van een demotrack terug
eaa38c8 Terugspelen tijdens een log: de opname van een replay is zelf terug te spelen
7b6b79d kijk.mjs: opnemen tijdens terugspelen, en dat log weer terugspelen
36e276d Handelingenlog: een opname-log dat al iets bevat niet opnieuw beginnen
```

**Server herstarten na mergen** (server/index.js en server/handelingen.js gewijzigd; de
bouwer vroeg dat al). :8777 niet aangeraakt.

## Bevindingen en herstel

Elke herstelde fout heeft een check die op de oude code faalde (zelf gezien, uitkomst tussen
haakjes).

| # | Ernst | Wat | Hersteld |
|---|---|---|---|
| 1 | middel | **Opnieuw renderen gaf een log dat zelf niet terug te spelen was.** Een opname neemt vanzelf een log mee; "eerst ● opnemen, dan speel" is de weg om opnieuw te renderen. De beginstand van het terugspelen zet posities, tempo, cues, hotcues, loops, bereik, kant en wat speelt BUITEN de bus om; het lopende log zag alleen de actions. De docs beloofden "een nieuwe versie van de set". Derde generatie: A stil op 0 s in plaats van spelend op 2,7 s. | ja (eaa38c8, 7b6b79d) |
| 2 | middel | **Stoppen tijdens het laden van de beginstand stopte niet.** Na het laden zette `stand()` toch posities, faders en racks en startte hij alles wat toen speelde. (speelt true, positie 1,5, fader terug op 1) | ja (038b97e) |
| 3 | laag-middel | **Grid van een demotrack in de beginstand ging verloren.** Een library-nummer krijgt het grid bij `laadLibrary`, maar de demo komt zonder grid uit zijn zaad; een getikt grid was weg, daarna gedroegen beat-loops en sync zich anders. De test van de bouwer tikte wel een grid maar controleerde het niet. (geen grid) | ja (6dd04e7) |
| 4 | laag-middel | **leesJson (buiten spoor) brak UTF-8 over een pakketgrens**: `data += d` decodeert elk pakket los → twee keer U+FFFD. Echt: racknamen, mapping, alle JSON-routes. Test stuurt een mapping in drie stukken met de grens midden in é en “. (`"caf�� — ��zoned out”"`) Ook `max` telt nu bytes. | ja (3c9fe98) |
| 5 | laag | **/opnames/ (buiten spoor)**: statische paden lazen uit `WORTEL/opnames`, de API schreef naar `VARVE_OPNAMES`. Klein: OPNAMES naar moduleniveau, statisch() gebruikt hem. (404) | ja (d5ce927) |
| 6 | laag | **Start met een opname-id gaf "ok, bestond" ook als dat log al regels had**; wie dat krijgt schrijft vanaf byte 0 over het bestaande log. De huidige client doet dat niet (geen herhaalde start), dus latent. Nu alleen goed als het log leeg is, anders 400. | ja (36e276d) |

### Hoe #1 is opgelost (terugspelen.js, logboek.js)
- `Terugspeler.onStand` na elke stand die buiten de bus om gezet wordt; logboek.js schrijft dan
  `leesStand()` in het lopende log (een `stand`-regel midden in het log).
- `maakPlan(regels, { beginstand })`: de beginstand gaat er niet in, een latere `stand` wel
  (soort `stand`).
- `Terugspeler._stand`: alles wacht (sleutel `ALLES` in `laadt`), eerst op lopende laden
  (`_bezig`), dan `doe.stand`; de klok van het log staat zolang stil (T0 schuift op), zoals bij
  de beginstand. `_tik` doet niets zolang `ALLES` loopt. `zonder` wordt vervangen.
- `maakUitvoerder({ huidig })`: een nummer dat er al staat wordt niet nog eens geladen. In
  logboek.js alleen voor wat terugspelen zelf laadde (`terugspeelDecks`) of een demo — een
  gewoon geladen library-nummer wordt wél opnieuw geladen, zodat het in `terugspeelDecks` komt
  en niets naar de library bewaart.
- Tests: drie generaties met de echte engine (Node), een stand van 0,4 s midden in het log met
  nep-klok (alles wacht, 0,3 s valt op 0,7 s), en headless door de echte logboek.js.

## Nagelopen en in orde

- **Vastleggen**: `bijInvoke` hoort alles wat `invoke` doet, vóór de action; MIDI (mapping.js),
  toetsenbord en scherm (controls.js, spiegel/vensters seek) gaan allemaal via `invoke`.
  Loslaten na shift/mapjewissel gaat via `mapping.vast` naar dezelfde action, dus staat erin.
  Spatie (play) stuurt geen loslaten; onschuldig (play doet niets met false).
- **Tijden**: `ctx.currentTime - t0`, 1 µs. Geen eigen teller. Terugspelen: T0 + t op de
  audioklok, 10 ms-timer alleen om te kijken. Laadduur gemeten met performance.now() (een duur,
  geen positie) — prima.
- **ASCII**: `asciiJson` escapet alles vanaf 0x7F (ook emoji-surrogaten, U+2028, U+FFFF);
  JSON.parse geeft exact terug. Server keurt `^[\x20-\x7e\n]*$`. Niet-ASCII titels en
  racknamen zijn dus veilig.
- **Wegschrijven**: stuk krijgt zijn plek bij het maken, server schrijft op `van`, herhalen
  idempotent, gat = nullen, lezer slaat ze over. Wachtrij per sessie; stop/start bij een
  opname lopen synchroon tot hun eerste await.
- **Server**: Host/Origin en de JSON-regel gelden globaal vóór de routes; id via `ID`-regex;
  statische witte lijst laat `.acties.jsonl` niet door; stuk ≤ 4 MB (body ≤ 8 MB+), `van` ≤
  eind + 256 MB.
- **Regel 1**: engine importeert niets nieuws (`regels.test` groen). terugspelen.js (control)
  importeert alleen `PITCH_BEREIKEN` uit de engine.
- **Heet pad**: gemeten 2,6 µs per action met log aan (0,35 µs zonder): 300/s = 0,8 ms per
  seconde. Wegschrijven van 300 regels ~0,05 ms. `kijk()` alleen na booleans en elke 100 ms.
- **Rack-rondje**: `zetRack(naarJSON())` geeft voor alle sjablonen en alle effecten precies
  hetzelfde terug (aanname van de bouwer klopt): geen kruisfade voor niets.

## Niet hersteld (laag, of een keuze)

- **Korte stilte bij de start van terugspelen op streamende tracks**: de beginstand doet
  `seek` en direct `play`, zonder de pagina's rond de nieuwe plek af te wachten → een paar
  tientallen ms stilte + fade-in aan het begin van een re-render. Onderling blijven de tracks
  goed liggen. Voorstel: vóór het starten `await` op het bijvullen (vraagt een deck-methode
  "klaar op positie"; niet zelf in `d.bron` grijpen vanuit control).
- **Focus wacht achter een laad van die track**: een focus-gebeurtenis heeft een `track` en
  komt dus pas na die laad. Een sampler-pad in dat venster knipt van de vorige focus. Zeldzaam.
- **Vormlagen** (?vormen=1): aan/uit, welk systeem, mengvorm en gekozen laag staan niet in de
  beginstand; de systeemkeuze in het paneel (`vormen.zetSysteem`) gaat niet over de bus en
  komt dus niet in het log. Beeld, geen geluid; de bouwer noemde video/vormen al als niet getest.
- **Rack-editor** `setPlek`/`setMix` direct (DICHT/OPEN, "MIX op 50%"): alleen via de volgende
  rack-gebeurtenis (gedocumenteerd door de bouwer).
- Cosmetisch: `terugspeler.seconden` springt na een stand midden in het log een stukje terug;
  `_verstuur` probeert ook na een 400 (keuring) nog twee keer; de regex in `asciiJson` heeft
  een letterlijke U+FFFF in de bron (werkt; `￿` is leesbaarder).
- `laadVoorTerugspelen` geeft `deckTrack[deckId] === track.id` terug: als de laad mislukt maar
  hetzelfde nummer er al stond, telt dat als gelukt. Randgeval.

## Testuitkomst

- `nice -n 10 node test/alles.mjs`: **30 bestanden, 2032 checks, alles groen** (geen
  timing-rood deze keer). handelingenlog.test.mjs 107 checks (was 94), server.test.mjs 60.
- `VARVE_KIJK_POORT=8895 VARVE_KIJK_DEBUG=9495 node tools/headless/kijk.mjs <scratchpad>`:
  alles groen, inclusief de twee nieuwe checks (opname van een replay heeft 2 standen, en
  speelt terug naar dezelfde eindstand). Let op: in headless liep de audioklok ~4x sneller
  dan de wandklok (een log van 13 s audioklok in ~3 s); de wachtlus is daarom ruimer gemaakt.

## Wat NIET getest is

- Alles uit de lijst van de bouwer blijft staan: Clay's Chrome met de APC (MIDI tijdens
  terugspelen, soft-takeover, LED's), een echt uur, `noodstop` bij pagehide, de rack-editor
  in het log, pads in de beginstand, uitlijning kop.klok ↔ frame 0.
- Opnieuw renderen met ECHTE library-nummers en echte laadtijden (de derde generatie is met
  demo's getest, in Node en headless). Een laad die blijft hangen blokkeert bij een stand
  midden in het log nu het hele terugspelen (stoppen kan altijd).
- De korte stilte bij het starten (hierboven) is niet gemeten, alleen uit de code afgeleid.

## Voorstel CLAUDE.md-tekst (aanvulling op die van de bouwer)

Onder de bekende grens HANDELINGENLOG, na "...anders zag het log het niet.":
```
  Terugspelen terwijl er een log loopt (opnieuw renderen = eerst ● opnemen, dan
  speel): de beginstand van het terugspelen gaat buiten de bus om, dus
  `Terugspeler.onStand` laat logboek.js een `stand` midden in dat log schrijven.
  Een latere `stand` is bij terugspelen een nieuwe beginstand: alles wacht (ook
  op lopende laden), de klok van het log staat zolang stil (T0 schuift op).
  `huidig` laadt niet opnieuw wat terugspelen zelf al laadde (of dezelfde demo).
  Stoppen tijdens het laden van een stand zet daarna niets meer (`nogBezig`).
- leesJson verzamelt Buffers en decodeert één keer (25 sep): `data += d` brak een
  UTF-8-teken over een pakketgrens. /opnames/ komt uit VARVE_OPNAMES.
```
