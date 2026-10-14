# Werkruimte S7: schermen en de iPad (14 okt 2026)

Tak `werk/S7` (vanaf `origin/werkruimte/integratie` a68e4d5). Wat er gebouwd is en hoe je het
gebruikt: `docs/werkruimte/S7.md`. Ontwerp: `docs/WERKRUIMTE.md` C4 en D4 "S7"; opdracht:
`docs/werkruimte/sporen.json` (S7).

Twee berichten van de coördinerende sessie kwamen halverwege binnen: Clay beantwoordde W1 ("iPad mag de
mixer ook bedienen … library maar ook effecten of andere onderdelen … per onderdeel van een mix anders")
en wil een xy-pad voor effecten op de iPhone. Daarom zijn er bouwstenen voor elk onderdeel en een
uitgebreide xy-pad bij gekomen, en ligt alles klaar voor bedienen. De SCHRIJFWEG zelf (route, koppelcode,
schakelaar, rem) blijft voor S8: in dit spoor stuurt niets van buiten de Mac de mixer.

## Wat gebouwd is

| | |
|---|---|
| **paneelpagina** | `werk.html?s=<scherm>` (+ `src/paneel/paneel.js`): de vakken van het actieve deel op dat scherm; volgt het deel; kop in de kleur van het deel |
| **twee transporten** | `src/paneel/verbinding.js`: als venster van de mixer (`window.opener.varvePaneel`, mac-2, bedient over de bus) of via de server (SSE + ping, de iPad, kijkt) |
| **protocol** | `src/paneel/protocol.js` (puur): stand, verschil, tijdlijn, deck, klok, maatgever, werkruimte, hb, weg; verschillen ≤ 10/s per id; klokverschil (mediaan van 8 rondjes); de klok uit metingen; invoke-berichten voor S8 |
| **vrije panelen** | `src/paneel/vrij.js`: draai, knop, schuif, lamp, xy, rij (herhaal, `{k}`), tekst; labels (eigen > naam van de plek > beschrijf > meta), kleur per soort, `{focus}`/`doel`, onbekend = grijs + één melding, badge per item en paneel, 300 ms oplichten; per pointerId, loslaten naar dezelfde action; waarden per beeld gebundeld |
| **bouwstenen** | `fx`, `strip`, `mixer`, `stems`, `master`, `sampler` (`:<n>` = vaste track) als data in vrij.js; `library` als vak (lezen; laden alleen als venster van de mixer) |
| **xy-pad** | X/Y naar elk een value-action, `druk` (worp zolang je aanraakt), `los` (blijf/midden/terug), volle breedte op een iPhone |
| **kaart** | `src/paneel/kaart.js`: per apparaat de open mapjes en wat elke knop daarin nu doet, groot |
| **zender** | `src/ui/live-zender.js`: alleen het tabblad met de APC, alleen met een kijker, per 20 ms gebundeld, `weg` bij stoppen |
| **relais** | `server/paneel.js` + `server/routes/paneel.js`: van-mixer (alleen deze Mac), live (SSE), ping, kijkers, stand; `weg` na 70 s stilte; een pagina die opnieuw verbindt vervangt zijn vorige verbinding |
| **werkvak** | `#werkvak` in de mixer: uitlijn, `paneel:<id>`, een bouwsteen of de kaart, via het event `'werkruimte'`; `vensters.bind(root)`/`ontbind(root)` melden de controls aan bij de renderloop (`renderloop.meldAan`) |
| **plaatsing** | "open schermen" op de werk-balk; het venster onthoudt zijn scherm (Window Management API, label; anders positie); waarschuwing naast het beamervenster |
| **podiumapparaat** | `werk.webmanifest` (standalone), apple-meta's, Wake Lock (opnieuw bij visibilitychange), touch-action, herverbinden (visibilitychange, online, 0,75 s na een fout), de rode balk |
| **zonder werkruimte** | de mixer laadt niets van `src/paneel/` en de zender niet (dynamisch, alleen bij een werkruimte); geen timer, geen fetch |

Commits: f8bd1f3 (de bouw), 4f83456 (reviewronde 1), d50fef6 (bouwstenen, xy-pad, klaar voor S8,
reviewronde 2), en de laatste: reviewronde 3 + dit verslag.

Reviews (twee subagenten, drie rondes; niets blokkerend aan correctheid). Opgelost: de iPad hield een
oude stand vast als de mixer stopte (nu `weg`, met een sessie-id zodat een late stand niet na het `weg`
binnenkomt); shift liet de iPad elke druk herbouwen; een schuif zonder action in het werkvak werd nooit
gebonden; dode SSE-verbindingen konden de iPad buitensluiten (nu vervangt een pagina zijn vorige); een
herladen tabblad stuurde 3 s lang 50 standen per seconde; te groot faalde stil; laden via mac-2 vroeg
geen tweede druk over een klinkend instrument (nu de vraag van de library zelf); de stand nam de
bouwstenen van ALLE delen mee (nu het deel van nu, met een melding boven 16 kB); `druk` naar een
value-action; de zoekbalk van de library bleef soms op een oude vraag staan. Reviewer (b) vond de 5 ms
niet aangetoond onder load (zie hieronder) en de toets "loslaten als het paneel verdwijnt" ontbrak (nu erbij).

## Acceptatie

| eis | | bewijs |
|---|---|---|
| Opener: een paneel met 4+ items volgt read(): een APC-draai binnen 1 beeld | gehaald | `werk-scherm.mjs`: "in het eerstvolgende beeld, filter 0.500 → 0.626" (de nep-poort is `mapping.handle(parseMessage(…))`, zoals werkruimte.mjs) |
| Een klik verandert de read in de mixer binnen 1 beeld en staat in het log | gehaald | "0 → 1, 0 beeld(en)"; `track.1.kill.low` true/false in het handelingenlog |
| Loslaten naar dezelfde action, ook na een deelwissel | gehaald | na deel- én focuswissel: track 1 los, track 2 onaangeroerd; en als het paneel van mac-2 verdwijnt terwijl je vasthoudt: los naar zijn action |
| Ontbinden laat geen Knob in de renderlijst | gehaald | knobs 84 → 82, faders 17 → 16, groepen 1 → 0 (`renderloop.aangemeld()`) |
| Badge en 300 ms oplichten | gehaald | "APC track knob 1"; aan in hetzelfde beeld, uit in het eerste beeld na 300 ms (op de klok van de mixer) |
| SSE: twee kijkers, volledige stand ≤ 16 kB, daarna alleen verschillen | gehaald | `paneel-server.test` (3424 B) en `werk-ipad.mjs` (5,9 kB; 1 stand na 10 s) |
| Eén tijdlijn per nieuwe segId; in rust ≤ 2 berichten/s per deck | gehaald (zwak getoetst) | 8 tijdlijnen, geen dubbele; rust 1,7–2,1 berichten/s voor 2 decks (alleen `klok`). Dat er geen tijdlijn ONTBREEKT toetst alleen de nep-fetch in paneel-server.test |
| van-mixer van buiten de Mac = 403 | gehaald | via `VARVE_HOSTS` met de juiste Origin: 403; met een proxykop: 403 |
| Een tweede tabblad zonder lock wordt genegeerd | gehaald | dat tabblad zendt 0 POST's; de server negeert ook een ander tab-id |
| Zonder kijker zendt de mixer niets | gehaald, met een kanttekening | 0 POST's; wél 1×/s `GET /api/paneel/kijkers` (anders weet hij niet dat er iemand komt). Met `standaard` helemaal niets |
| Nep-iPad: hoorbare positie binnen 5 ms over 60 s, ook na seek, loop en rem | **wisselend: gehaald op een rustige machine, niet onder load** | zie "De klok" hieronder |
| De pagina doet nul POST's | gehaald | CDP-netwerk en een fetch-haak: 0 |
| Server weg: rode balk, binnen 3 s terug met de volledige stand | gehaald | balk na 0,1 s; volledige stand 0,3–0,6 s na de eerste 200 van de server |
| regels-werk: geen engine, AudioContext, MIDI, Web Lock in werk.html/uitlijn.html; de mixer laadt src/paneel/ niet | gehaald | 37 checks. "Geen engine" = niet `engine.js`/`deck.js`/`bron.js`/Web Audio; het pure rekenwerk (`stream-kern`, `beatgrid`, `tellen`, `hoorbaar`, nodig voor regel 3 op de iPad) mag |
| Met standaard: rijen.mjs, kijk.mjs, bovenbalk ongewijzigd groen; het werkvak verborgen | kijk.mjs en bovenbalk groen; werkvak hidden (0 px) | **rijen.mjs** hangt in deze container (zonder uitvoer na 300 s), net als bij S3 op de basis; niet beoordeeld |
| `node test/alles.mjs` | zie "Testuitslag" | |
| Erbij (Clay, 14 okt): elk onderdeel als paneel, per deel, xy-pad | gebouwd | `werk-scherm.mjs` deel FX: werkvak `fx` (bind), mac-2 xy + fx + mixer + library, xy: slepen over de bus, druk aan/los, `los: terug` |

### De klok (de 5 ms-eis)

```
VARVE_CHROME=<headless_shell met --no-sandbox> node tools/headless/werk-ipad.mjs --duur 60
```

`currentTime` springt in headless Chrome per 512 frames (10,7 ms) en het nep-audioapparaat hapert onder
CPU-druk; `hoorbaar()` in de mixer schommelt dus zelf al ±5 ms. De iPad volgt het midden: de mediaan
van (currentTime − performance.now) over 32 metingen, 1×/s gestuurd en meteen bij een sprong > 1 ms.

| meting (60 s, 2 decks, seek · loop · rem) | mediaan | p99 | max |
|---|---|---|---|
| rustige machine (load ~1,3), laatste stand, gemiddeld over een reeks van 100 ms | 1,4 ms | 4,3 ms | **4,5 ms** (gehaald; los tegen één `hoorbaar()` max 7,0) |
| rustige machine (load ~2), eerdere stand, reeks van 100 ms | 1,4 ms | 3,8 ms | 5,8 ms (1 van 270) |
| load ~5 (andere proeven tegelijk) | 1,3 ms | 12 ms | 20 ms |
| reviewer (b), load 5–10, 3 runs | 1,3–1,6 ms | – | 5,0 · 27,7 · 7,1 ms |
| tegen één losse `hoorbaar()` (rustig) | 1,7 ms | 6,9 ms | 7,9 ms |

De 300 ms na een sprong tellen niet mee (het nieuwe segment is onderweg; daar max ~6 ms). De check is
niet verzwakt: hij middelt alleen de schommeling van de REFERENTIE uit (`currentTime` in de mixer).
**Oordeel: gehaald op een rustige machine (de laatste run), niet onder load (5–10 op 4 kernen).** Of het
op de Mac met een echt audioapparaat haalt, is proefavond D.

## Metingen (hoofdthread)

`latentie.mjs` vóór (a68e4d5, `VARVE_WORTEL`) en na, standaard, 2 rondes per kant, mediaan:
```
VARVE_WORTEL=<git archive a68e4d5> node tools/headless/latentie.mjs --label voor --uit voor1.json --duur 3000   (×2)
node tools/headless/latentie.mjs --label na --uit na1.json --duur 3000                                         (×2)
node tools/headless/latentie.mjs --vergelijk voor1.json,voor2.json na1.json,na2.json
```
| scenario | stijl ms/s vóór → na | taak ms/s vóór → na | lange taken |
|---|---|---|---|
| rust | 38,0 → 38,5 | 537 → 546 (overlapt) | 0 → 0 |
| shift | 101,7 → 98,4 | 896 → 915 (overlapt) | — |
| mapje | 111,2 → 111,4 | 840 → 834 | — |

De winst van 14 okt is heel (rust 33–41).

Wat S7 met een werkruimte kost (één run, acht tracks spelend, 6 s per stand):
```
node tools/headless/werk-scherm.mjs --meet --sec 6
```
| stand | taak | script | stijl | opmaak (ms/s) |
|---|---|---|---|---|
| standaard | 392,7 | 94,9 | 34,0 | 59,3 |
| proef: paneel in het werkvak | 388,8 | 93,1 | 33,6 | 65,5 |
| + mac-2 (paneel, kaart, stand) | 483,9 | 98,5 | 37,5 | 73,3 |
| + een iPad-kijker (de zender zendt) | 433,8 | 94,8 | 28,5 | 60,0 |

Het werkvak kost niets meetbaars; mac-2 draait in dezelfde thread en kost vooral tekenen (+~90 ms/s
taak, script +3,6, stijl +3,5). Eén run in een container met software-GPU: ruis van ±10%. Het
totaalbudget (C6, ≤ 2 ms per beeld) meet S8.

## Testuitslag

Nieuwe tests: `vrij-paneel.test` (nep-DOM: items, labels, grijs, volgen, loslaten per vinger, kijken,
mixer-modus, xy met druk en los, bouwstenen, kaart, renderloop), `paneel-server.test` (protocol, relais,
zender met nep-fetch, een eigen server: 403, SSE, 16 kB), `regels-werk.test` (importbomen, W1, de mixer
laadt src/paneel/ niet). Headless: `werk-scherm.mjs` 36/36, `werk-ipad.mjs` 19/21 (de twee klokchecks,
hierboven), `kijk.mjs` groen.

```
VARVE_CHROME=<headless_shell met --no-sandbox> VARVE_HUB_REPO=~/av-app-hub node test/alles.mjs
```
**115 bestanden, 10122 checks, 8 overgeslagen, 3 rood**: precies de drie bekende van deze container
(`renderblok` "keylock met wissels", `wachtrij` "yt-dlp en zijn kind" 2×, `instrumenten-fm-schaal` "geen
afval per blok"). Daarna (reviewronde 3) opnieuw groen: vrij-paneel, paneel-server, regels-werk;
`werk-scherm.mjs` 36/36 en `werk-ipad.mjs --duur 60` 21/21 (load 1,3).

## Wat niet gedaan is

- De schrijfweg van de iPad/iPhone (S8; zie `docs/werkruimte/S7.md` §6 voor wat aan te sluiten is).
- `y`, `druk` en `los` van de xy-pad staan niet in het model van S3 (`src/werk/model.js` is niet van S7):
  de mixer leest ze uit het ruwe bestand. Het model moet ze leren (S8 of later), anders weigert of
  normaliseert hij ze nooit.
- De iPad haalt geen peaks, tellen of klappen: de uitlijn op de iPad zonder golfvorm en zonder muziek Δ.
- Een standaardindeling is er bewust niet (Clay doet de indeling); alleen de proefwerkruimte in
  `tools/headless/werk-scherm.mjs` (`PROEF`), met een xy-pad gemarkeerd als voorbeeld.
- `rijen.mjs` niet beoordeeld (hangt in deze container).

## Alleen op de iPad of de Mac te bevestigen

- Safari: EventSource, Wake Lock (iOS 16.4+, en of het in een beginscherm-app werkt), `display:
  standalone`, de apple-meta's, touch met echte vingers (twee vingers op twee pads), de iPad op slot en
  terug, wifi die even wegvalt, Begeleide toegang.
- De iPhone in portret (de xy-pad over de volle breedte), via Tailscale.
- De Window Management API met twee echte schermen (toestemming, labels, terugzetten op het juiste
  scherm), en de waarschuwing naast het beamervenster.
- De hoorbare positie binnen 5 ms met een echt audioapparaat (proefavond D).
- Wat mac-2 op de M1 kost (Metal in plaats van swiftshader).

## Hoe Clay een paneel maakt en op een scherm zet

Stap voor stap in `docs/werkruimte/S7.md` §3. Kort:
1. In `werkruimtes/<naam>.json` onder `panelen` een paneel, bv.
   ```json
   "panelen": { "dub": { "titel": "DUB", "items": [
     { "soort": "draai", "action": "track.{focus}.send.a" },
     { "soort": "knop", "action": "track.{focus}.kill.low.hold", "label": "BAS WEG" },
     { "soort": "xy", "action": "track.{focus}.fx.knob.1", "y": "track.{focus}.send.a", "los": "terug" } ] } }
   ```
2. Per deel per scherm de vakken: `"schermen": { "hoofd": { "werkvak": "fx" }, "mac-2": { "vakken": ["uitlijn", "paneel:dub"] }, "ipad": { "vakken": ["stand", "mixer", "paneel:dub"] } }`,
   en bovenin `"schermen": { "mac-2": { "soort": "venster" }, "ipad": { "soort": "ipad" } }`.
3. mac-2: kies de werkruimte, druk op **open schermen**, sleep het venster naar het scherm (onthouden).
4. iPad of iPhone: `https://<NAAM>/werk.html?s=ipad` in Safari, "Zet op beginscherm", Begeleide toegang
   tijdens een set.

## Vragen voor Clay

1. **"Zonder kijker zendt de mixer niets"**: hij vraagt wel 1×/s aan de server of er iemand kijkt (geen
   POST, alleen met een werkruimte). *Advies: zo laten*; anders merkt hij een nieuwe iPad niet op.
2. **De 5 ms op de iPad**: hier niet aan te tonen. *Advies: meten op proefavond D* (de iPad naast de Mac,
   een echt audioapparaat); haalt hij het daar niet, dan de eis "p99 ≤ 5 ms" maken.
3. **Bouwstenen of eigen panelen?** De bouwstenen (fx, strip, mixer …) zijn een snel begin. *Advies:
   begin met bouwstenen in je delen, en maak eigen panelen waar een bouwsteen te veel of te weinig heeft.*
4. **xy-pad, twee vingers**: nu één vinger per pad (twee pads = twee vingers). Wil je twee punten op één pad?
5. **Bedienen vanaf de iPad**: welke actions mogen (`schermen.ipad.mag`)? S8 handhaaft het; de vaste lijst
   (laden, library, opnemen, log, mapping, werkruimtes) kan nooit.

## Opties voor een volgende versie

- Peaks en tellen naar de iPad (de uitlijn met golfvorm en muziek Δ), via `/media/<id>/peaks.bin`.
- Een WebSocket in plaats van SSE + POST als het bedienen te traag voelt (zelfde berichten).
- De klok met een echte schatting van de klokrate (nu: rate 1), als de Mac meer dan een paar ppm afwijkt.
- Eenheden op de assen van de xy-pad (`toonWaarde` van het rack per parameter; nu de naam van de plek en %).
- Een paneel als bouwsteen kopiëren naar een eigen paneel ("maak eigen") in S8's inrichten.
