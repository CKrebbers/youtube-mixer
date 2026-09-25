# Controle spoor 2 — maatbronnen voor de vormlagen (ROADMAP 23, deel)

Branch `spoor2/vorm-bronnen-c` (vanaf `spoor2/vorm-bronnen` = `ee4e894`), vier commits erbovenop:

| commit | wat |
|---|---|
| `093461f` | Maatbronnen: de grens van een overname vervalt als de maatgever terugspringt |
| `63f1124` | Maatgever: vorm en video-puls rangschikken op het echte volume, zoals de MAAT-badge |
| `8931413` | Wat je hoort: één formule in engine/hoorbaar.js |
| `30900d9` | Vorm-paneel: zeg waarom er geen maat is als de MAAT-badge wel op een track staat |

```
 src/analysis/maat.js         | 31 ++++---
 src/control/actions.js       |  8 +-
 src/engine/hoorbaar.js       | 33 +++++  (nieuw)
 src/ui/midi-opzet.js         |  6 +-
 src/ui/vorm-paneel.js        | 14 ++-
 src/video/puls.js            | 25 +++-
 src/video/video-mixer.js     | 23 ++--
 test/analyse.test.mjs        | 96 +++++-
 tools/headless/vorm-maat.mjs | 13 +-
```
Niet aangeraakt: CLAUDE.md, HANDOFF, ROADMAP, VRAGEN, beide mappings, src/vormen/*, src/video/lagen.js,
kijk.mjs.

---

## Bevindingen

### 1. ERNSTIG — hersteld (`093461f`): na een overname bleef de maatgever stil in zijn loop / na een hotcue terug
`MaatLezer._bron` zette bij een wissel `b.vanaf` (alleen klappen/tellen vanaf het vorige beeld tellen) en
liet die grens staan tot de VOLGENDE wissel. Neemt track B de maat over midden in zijn loop (veelvoorkomend:
loop op B, crossfader erheen), dan gaat de loop terug tot vóór die grens en werden alle klappen en tellen
daar weggefilterd: klap én tel 0,00 op elke tel van de loop, zolang B de maat gaf. Idem na een hotcue terug,
en na het binnenkomen van de klappen (haalOnsets) gevolgd door een sprong terug.
Herstel: de grens vervalt zodra de hoorbare positie er weer vóór komt (`else if (pos < b.vanaf) b.vanaf = -Infinity`).
De rest van de wisselregel blijft. Test "maatgever B in een loop die terug gaat tot vóór de wissel" faalt op
de oude code (klap 0,00, tel 0,00), nu 0,92/0,92 op het eerste beeld na elke klap.

### 2. MIDDEL — hersteld (`63f1124`): vorm én video-puls kozen een andere maatgever dan de MAAT-badge
`klokTrack` kreeg de LINEAIRE zichtbaarheid (fader × crossfader, bedoeld voor beeldmenging), terwijl
`engine.syncMaster` (sync, sampler, sends, MAAT-badge) rangschikt op `faderGain(fader)` (dB-curve) ×
crossfader. Voorbeeld: track 1 (A-kant) fader 1, track 3 (thru) fader 0,8, crossfader midden → MAAT op 1,
puls en vormen op 3, terwijl 3 zes dB zachter klinkt. Over 400 willekeurige standen 23 keer anders.
Dit zat al in de video-puls (bestaand), de maatbronnen erfden het.
Herstel: `klinkt(fader, xfadeGain)` en `maatgever(engine, ids)` in `puls.js`; `_pulsNu` en `engineTracks`
gebruiken ze. klokTrack zelf en de drempel (0,001) zijn ongewijzigd, dus "fader dicht telt niet mee"
(video.test) blijft. Tests vergelijken met `Engine.prototype.syncMaster` zelf (vast voorbeeld + 400 standen);
met de oude lineaire rangorde: 3 FAIL (A·C·C, 23 keer anders).

Het verschil dat het bouwverslag noemde (spelende track met fader dicht: MAAT-badge wel, paneel "geen
maat") BLIJFT bewust: syncMaster neemt elke spelende track (ook onhoorbaar, want sync moet ergens heen),
de puls en de vormen niet (je hoort geen tel). Dat is nu de enige afwijking: in alle 400 standen volgen vorm
en puls de badge zolang je die track hoort. Wel gelijkgetrokken in weergave (`30900d9`): het paneel zegt
dan "geen maat · track N hoor je niet" of "geen maat · track N staat stil" (badge "MAAT (stil)").
Headless getest (vorm-maat.mjs, twee nieuwe checks).

### 3. Samengebracht (`8931413`): "wat je HOORT" op één plek, `src/engine/hoorbaar.js`
Klein en veilig, gedrag ongewijzigd:
- `uitgangsVertraging(ctx)` = outputLatency + baseLatency (was 4×: actions.js, video-mixer, vorm-paneel,
  midi-opzet).
- `hoorbaar(deck, vertraging)` = positie − vertraging × rate tijdens spelen, stilstaand de positie
  (actions.js `hoorbaar`, video-mixer `_pulsNu`, maat.js).
- `naVertraging(positie, vertraging, rate)` voor video `_volg`, die OOK stilstaand de vertraging aftrekt.
  Dat heb ik bewust zo gelaten: met `hoorbaar()` zou de video bij elke pauze V×rate vooruit seeken (boven
  1/60 s → seek, met Bluetooth zeker). Aanname: dat is de reden van het huidige gedrag.
- Test: de formules, en een wacht: `outputLatency` staat in geen ander bestand onder src/ (geen vijfde kopie).
- maat.js importeert nu ook `../engine/hoorbaar.js` (puur, geen engine-klasse); de importlijst-check is
  aangepast. regels.test groen (hoorbaar.js importeert niets).

### Nagelopen en in orde
- **Wat je hoort / ijking**: positie − vertraging × rate; de 68,5 ms (`PIEK_GEIJKT`) zit in de servertijden
  (`onsetPieken(..., PIEK_GEIJKT)`), maat.js verschuift niets. Niet dubbel.
- **Regel 3**: geen timer, geen eigen teller; `t` alleen voor dt, posities van `bron.positie`. De 500 ms-timer
  in het paneel is alleen weergave (`kies()` verandert niets).
- **Werk per beeld**: binair zoeken, stateloos → loops en sprongen terug werken vanzelf. ~8 kleine objecten
  per beeld; verwaarloosbaar.
- **Rate ≠ 1**: uitdoven in kloktijd (klap τ, tel lengte/(5·rate)); getest. Een rate-sprong midden in een klap
  geeft een klein stapje omhoog (bv. 0,37 → 0,45 bij 1 → 1,25), via max toegestaan. Verwaarloosbaar.
- **Bend**: telt niet mee (deck.rate is zonder bend), net als LED-fase, grid-modus, video en toonsoort-ontwerp.
  Fout ≈ 4% van de vertraging (< 1 ms). Consequent; nu gedocumenteerd in hoorbaar.js.
- **Routes**: een OFFSET via `pasToe → zetModulatie` (met wijzigingsdetectie), nooit actions/zetKnop.
  Alle sterktes dicht = `nodig()` leeg = niets gelezen, ook de maatlezer niet; alleen `tel` open = de
  master-analyser niet gelezen (getest met tellers).
- **Zonder ?vormen=1**: maat.js en router.js alleen via vorm-paneel.js (dynamische import achter de vlag);
  kijk.mjs "zonder ?vormen" groen. puls.js importeert nu `engine/audio-graph.js` (puur, wordt toch al geladen).
- **Stoppen/starten**: stoppen = staart dooft uit, na ~0,9 s precies 0.

### Niet hersteld (laag)
- **Hervatten na een pauze kort na een klap geeft een flits van die oude klap.** Gemeten: pauze 83 ms na
  een klap, 3 s later play → eerste beeld maatklap 0,53 (en tel 0,53). Oorzaak: regel 3 van de bouwer
  ("track die net begint: alles telt"). Voor de TEL is dat precies wat de video-puls ook doet (consistent);
  voor de klap is het een klap die je seconden eerder hoorde. Herstel zou de stopplek per track moeten
  bijhouden plus een marge voor de ±15 ms van de onsets; niet gedaan (ontwerpkeuze, klein effect).
- **Loop-naad (bestaand, app-breed)**: vlak nadat een loop rondging valt positie − vertraging vóór het
  loopbegin (hooguit V lang), terwijl je het loopeinde nog hoort. De tel/klap op het loopbegin valt wél op
  het goede moment. Genoteerd in hoorbaar.js; `ctxTijdVan` zou het exact kunnen.
- **Snel heen-en-weer wisselen** (fader-jitter rond gelijke stand) kan een klap missen (bouwer meldde het al).
- **kijk.mjs** schrijft foto's naar `tools/headless/uit/` (gitignored) en faalt met ENOENT in een verse
  worktree waar die map niet bestaat. Map aangemaakt om te draaien; kijk.mjs niet aangepast (mkdir erbij
  zou het oplossen, maar dat bestand hoort bij het andere spoor).

---

## Tests
- `analyse.test.mjs`: 111 ok (was 103). Nieuw: loop na overname, maatgever = badge (vast + 400 standen),
  hoorbaar.js + wacht op kopieën.
- Gericht groen: video, vormen, werker, feedback, mapping, regels, spiegel.
- Headless (8898/9498): `vorm-maat.mjs` 23/23 groen (1 nieuw: fader dicht; 1 aangescherpt: alles stil
  zegt waarom). Eén run viel om bij het verbinden met Chromium (`webSocketDebuggerUrl`, onder belasting),
  daarna weer groen. `kijk.mjs` alles groen (na `mkdir tools/headless/uit`).
- `nice -n 10 node test/alles.mjs`: 29 bestanden, 1978 checks, 1 ROOD: `vormen-meer.test.mjs` "max < 16 ms
  per stap" (ch/jl/dl/if). Los opnieuw: nog steeds rood, maar steeds andere systemen (4 → 1: alleen ch,
  max 24,5 ms bij gem 4,1 ms). Load average ~40. Dat bestand importeert alleen src/vormen/* (niet
  aangeraakt): timing onder belasting.

## Wat NIET getest is
- Niet in Clay's Chrome, niet met zijn library (echte onsets, echte outputLatency, tempokaart op een album).
- De veranderde rangorde van de video-puls niet op het oog: alleen in Node tegen syncMaster en headless via
  het paneel.
- Hervatten-flits niet hersteld (zie boven); sync-fasecorrectie op de maatgever zelf alleen via de
  algemene regel (omhoog binnen dezelfde track mag).

## Voorstel CLAUDE.md-tekst
Structuur, onder `engine/`:
```
                    hoorbaar.js     wat je HOORT: uitgangsVertraging(ctx), hoorbaar(deck, V) = positie − V × rate. Eén plek.
```
onder `analysis/` (van de bouwer):
```
                    maat.js         klappen (deck.onsets) en tel van de maatgever als bron, op wat je hoort. Puur.
```
Bij video "Effecten op de tel": "de maat komt van de track die het hardst KLINKT (klinkt() in puls.js:
faderGain × crossfader, dezelfde rangorde als syncMaster/MAAT-badge), speelt, een grid heeft en die je
hoort (> 0,001)".
In VORMLAGEN het blok van de bouwer, met twee wijzigingen:
- "Maatgever = klokTrack (…; NIET syncMaster …)" wordt: "Maatgever = maatgever()/klokTrack op klinkt():
  dezelfde track als de MAAT-badge zolang je hem hoort; een spelende track die je niet hoort krijgt wel MAAT
  (sync moet ergens heen) maar geeft geen tel, en het paneel zegt 'geen maat · track N hoor je niet /
  staat stil'."
- Bij de overname-regel erbij: "die grens vervalt zodra de maatgever terugspringt tot ervóór (loop rond,
  hotcue), anders bleef een loop die vóór de wissel begint stil."
- "Nog niet: … één hoorbaar.js (01-plan)" vervalt: gebouwd (engine/hoorbaar.js).
