# Controller-uitvoer: LED's, ringen, Maschine en de hub, snel en juist (14 okt 2026)

Tak `afmaken/controller-uitvoer` (vanaf `studio/afmaken` 339310b). Spoor: het UITVOERpad naar de
controllers (feedback.js, de wachtrijen en bundels in midi.js en hub.js, de lampjes en schermen van
de Maschine). Het invoerpad (mapping.js, actions.js, renderloop) en het beatgrid zijn van andere sporen
en zijn niet aangeraakt.

Clay: "Ik merkte dat het op veel punten erg laggy was." Voor het uitvoerpad klopte dat, en er was
erger: het echofilter **slikte echte knoppen in**.

## Kort

| | vóór | na |
|---|---|---|
| druk -> lampje, echte Chrome + echte hub (p50, mediaan van 3 runs) | 51 ms | 6 ms |
| druk -> lampje, Node, direct op de MidiHub (p50) | 16,6 ms | 1,2 ms |
| ingeslikte druk/los (Chrome + hub, van 240) | 15–17 | 0 |
| ingeslikte druk/los (Node, van ~220) | 20 | 0 |
| kosten van één LED-tik (p50, rust / spelen) | 454 / 457 µs | 45 / 61 µs |
| mapje wisselen -> laatste lampje (p50) | 56 ms | 11 ms |
| Maschine: pad -> lampje (p50 / p99) | 38 / 71 ms | 2 / 25 ms |
| Maschine: draaien -> scherm (p50 / p99) | 15,5 / 43 ms | 3,9 / 15 ms |
| draaiknop heen en terug: verloren tikken van 219 (4 / 8 / 20 ms per tik, knop gelijk met de ring) | 9 / 12 / 28 | 0 / 0 / 0 |
| idem, een APC die de ring als knopwaarde overneemt (hub-proef V1) | 41 / 40 / 56 | 0 / 0 / 0 |

De twee draaiknop-rijen komen uit review ronde 1 (onder): de eerste versie van deze tak maakte de
draaiknoppen juist SLECHTER (32 / 24 / 6 verloren van 75). Dat is gerepareerd en nagemeten.

Alles hieronder komt uit commando's die ik draaide; de machine was druk (load average 10–17 op 4
kernen, andere agenten): de mediaan (p50) is betrouwbaar, de staart (p99, max) is vooral ruis van de
machine. Daarom drie runs per kant, om en om.

## Hoe gemeten (herhalen)

Twee instrumenten, allebei nieuw:

1. `tools/bench/feedback.mjs` (Node): de ECHTE `mappings/apc40mk2.json`, de echte Engine met acht
   tracks (nep-Web Audio zoals de tests), de echte Feedback, MidiHub, HubMidi en Maschine, en nep-poorten
   die de tijd van elk bericht noteren. Meet: (1) de tik in vier standen, (2) druk -> lampje op echte
   timers met een nep-APC die niets terugkaatst en een die elke ring-CC na 2 ms terugstuurt, met per
   soort knop hoeveel druk/los het echofilter inslikte, (3) hetzelfde via HubMidi + nep-WebSocket,
   (4) mapje wisselen, (5) de Maschine (tik, schermen per seconde, pad -> lampje, draaien -> scherm).
   `--bron <map>` laat dezelfde meting lopen op een andere checkout.
2. `tools/headless/led-vertraging.mjs`: echte Chrome (headless shell) met de pagina met `?hub=`, de
   ECHTE hub (`startHub`) en een nep-APC. Druk op track select (focus) en A|B, en meet tot het lampje
   op de nep-APC (zelfde Node-klok voor injecteren en ontvangen); telt wat het echofilter van de pagina
   als echo weggooide (`midi.echoes`). `VARVE_BRON` = de server uit een andere checkout.

```
# vóór: een worktree op de basis
git -C /home/user/youtube-mixer worktree add --detach <wt>/controller-uitvoer-voor studio/afmaken
# Node, drie keer om en om, dan de mediaan
node tools/bench/feedback.mjs --bron <wt>/controller-uitvoer-voor --json voor1.json
node tools/bench/feedback.mjs --json na1.json
#   … voor2/na2, voor3/na3
node tools/bench/feedback-samen.mjs voor1.json,voor2.json,voor3.json na1.json,na2.json,na3.json
# Chrome + echte hub (een kloon van AV-app-hub met node_modules; de repo zelf heeft er geen)
VARVE_CHROME=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell \
VARVE_HUB_REPO=<kloon van av-app-hub> VARVE_KIJK_POORT=8856 node tools/headless/led-vertraging.mjs
VARVE_BRON=<wt>/controller-uitvoer-voor … node tools/headless/led-vertraging.mjs     # vóór
```

### Node (`feedback-samen.mjs`, mediaan van 3 runs per kant)

| meting | vóór | na |
|---|---|---|
| tik rust (8 tracks geladen, stil): p50 µs | 454 | 45,2 |
| tik rust: p99 µs | 3296 | 1355 |
| tik spelen (8 tracks, knipperen op de tel): p50 µs | 456,7 | 60,6 |
| tik spelen: p99 µs | 1474 | 2863 |
| tik spelen + mapje loops open: p50 µs | 500,2 | 60,6 |
| tik spelen + mapje loops open: berichten/s | 44 | 44 |
| tik spelen + shift vast: p50 µs | 524,6 | 46,4 |
| direct: druk -> lampje p50 / p99 ms | 16,6 / 41,2 | 1,2 / 19,2 |
| direct: ingeslikt (druk of los, ~110 knoppen × 2) | 20 | 0 |
| direct: echo's die de mapping bereikten | 0 | 0 |
| direct: mapje wisselen, laatste lampje p50 / max ms | 56,4 / 81,3 | 11,4 / 40,1 (max: zie review ronde 1) |
| direct: wachtrij MidiHub max tijdens spelen / bij een mapje | 7 / 24 | 0 / 27 |
| direct: berichten/s naar de APC (spelen, knipperen, drukken) | 24,1 | 24,1 |
| APC kaatst ringen terug: druk -> lampje p50 / p99 ms | 17,4 / 68,4 | 1,1 / 7,7 |
| APC kaatst ringen terug: ingeslikt | 21 | 0 |
| APC kaatst ringen terug: echo's die de mapping bereikten | 0 | 0 |
| via de hub: druk -> {t:'led'} p50 / p99 ms | 33,7 / 69,8 | 2,7 / 19,7 |
| via de hub: ingeslikt | 15 | 0 |
| via de hub: led-bundels/s | 11,2 | 11,7 |
| Maschine tik p50 / p99 µs (in de timer, koud) | 319 / 5240 | 274 / 3655 |
| Maschine stand() per s | 28,8 | 40,2 |
| Maschine schermen per s | 2,2 | 2,2 |
| Maschine pad -> lampje p50 / p99 ms | 38,3 / 70,8 | 2 / 25 |
| Maschine draaien -> scherm p50 / p99 ms | 15,5 / 42,9 | 3,9 / 14,9 |
| Maschine wachtrij hub.js max | 44 | 28 |
| Maschine stand()+JSON p50 µs / twee schermen tekenen p50 µs | 8,8 / 62,1 | 8,9 / 64,7 |

De tik-p99 van "spelen" is na hoger (2,9 ms tegen 1,5 ms): dat is vooral de machine (in dezelfde run
is de p99 van rust en loops na juist lager). Het werk per tik is bijna een deelverzameling van het oude
(test 1 hieronder eist dezelfde uitkomst), maar niet helemaal: er komt per tik een sleutel bij (een
string plakken plus `JSON.stringify(vars)`), en bij een andere sleutel een volledige herbouw van het
plan. Dat is gemeten verwaarloosbaar (de p50 zakte van ~455 naar ~45–60 µs), maar "per definitie niet
duurder" was te sterk gezegd.

### Chrome + echte hub (`led-vertraging.mjs`, 120 drukken per run, 3 runs)

| | run 1 | run 2 | run 3 | mediaan |
|---|---|---|---|---|
| vóór: p50 / p90 / p99 ms | 49,8 / 62,8 / 83,5 | 51,1 / 84,4 / 148,4 | 59,0 / 111,2 / 192,1 | 51,1 / 84,4 / 148,4 |
| vóór: ingeslikt (van 240) | 17 | 15 | 16 | 16 |
| na: p50 / p90 / p99 ms | 5,6 / 25,4 / 71,6 | 6,3 / 24,3 / 58,6 | 8,7 / 43,7 / 153 | 6,3 / 25,4 / 71,6 |
| na: ingeslikt | 0 | 0 | 0 | 0 |
| na + hub-patch (Wachtrij): p50 / p90 / p99 ms | 4,5 / 34,2 / 96,2 | 5,3 / 26,7 / 62,8 | 5,4 / 41,6 / 114,3 | 5,3 / 34,2 / 96,2 |

Per knop (na, p50 per run): A|B 4,0 / 5,1 / 6,3 ms, track select 8,7 / 7,5 / 14,5 ms. Track select verandert de focus en dat zet in
dezelfde taak het hele scherm om (spiegel, focusdeel): die tijd zit vóór de wektik, en hoort bij het
invoerpad en de renderloop (ander spoor).

## Oorzaken

1. **Een lampje wachtte altijd op de volgende tik** (setInterval 33 ms): gemiddeld +16,5 ms, tot 33 ms.
2. **Via de hub nog eens 16 ms**: `HubMidi` bundelde lampjes per beeld met een timer die altijd
   `BEELD_MS` (16 ms) wachtte, ook na een seconde stilte.
3. **De wachtrij naar buiten** (16 per 4 ms) stuurde elk bericht via een `setTimeout(0)`, ook als er
   niets voor stond (in Chrome ~1–4 ms); de wachtrij van de hub (`src/core/wachtrij.js`) deed hetzelfde.
   En het tempo gold per tik, niet per venster: een rij die net leeg was kon meteen weer 16 sturen.
4. **Het echofilter slikte echte knoppen in.** Het keek ook naar noten. Een lampje UIT is
   `[0x90, n, 0]` en dat is precies het loslaten van die knop; een eenkleurig lampje AAN is
   `[0x90|kanaal, n, 127]`, precies het indrukken, en track select van de maatgever en clip stop van
   een loop knipperen zo op elke tel. Een druk of loslaten binnen 60 ms na zo'n lampje verdween. Een
   ingeslikt loslaten laat een knop hangen (bend, kill vasthouden, een hold). Gemeten: 20 van ~220
   druk/los in Node (9%), 16 van 240 in Chrome (7%). Een lus kan alleen via een ring (CC). Dat een
   lampje (noot) nooit als druk terugkomt, rust op het protocol (in 0x42 zijn alle LED's van de host),
   niet op een meting aan het apparaat; gemeten is alleen dat het filter op noten echte knoppen ving.
5. **De tik was duur**: per tik `actieveRegels()` over ~700 regels (per regel `kies()`, `lagen()`,
   strings plakken), `resolveTarget` per regel en ~70 kleurregexen per regel, ook als er niets
   veranderde: ~0,45 ms per tik, ~14 ms per seconde op de hoofdthread (dezelfde thread als de
   renderloop en de MIDI-invoer).
6. **Hooguit 24 berichten per tik**: een mapje wisselen (~40 lampjes) kostte twee tikken, een hele
   verversing zes (~200 ms).
7. **Maschine**: lampjes op dezelfde tik van 33 ms plus de bundel (p50 38 ms), en een scherm hooguit
   eens per 100 ms, ook terwijl je draait.

## Wat ik veranderde

- `src/control/feedback.js`
  - **Plan**: alles wat per tik niet verandert (welke regels gelden, signature, soort lampje,
    doel-action, kleur) staat in een plan, alleen opnieuw bij een andere mapping (event `change`, plus
    het aantal regels voor een mapping zonder events), shift, open mapjes, vars (`{focus}`) of apparaat.
    Per tik alleen de reads. `kleurVoor` onthoudt per action; de tel per track één keer per tik.
    Diffing op gepakte getallen in plaats van strings/arrays.
  - **`wek()`**: één tik na de lopende taak (microtaak), samengevoegd, hooguit één per 4 ms, niets
    dubbel (de tik stuurt alleen verschillen). Sinds de review ALLEEN LAMPJES: ringen en ringtypes
    blijven op de gewone tik van 33 ms (zie "Review ronde 1"). `stop()` haalt hem weg (bij `pagehide`).
  - `MAX_PER_TIK` 160 (was 24): een hele verversing in één tik; de wachtrij spreidt.
- `src/ui/midi-opzet.js`: `wek` op `bijInvoke` (elke action: APC, muis, toetsenbord, auto-DJ) en op
  een ander mapje (`lagen` `change`).
- `src/control/midi.js`
  - echofilter **alleen CC** (ook het geheugen van het filter: lampjes vullen het niet meer), en een
    ring op de waarde die de knop ons net zelf stuurde wordt niet onthouden (`_laatsteIn`, behalve 0 en
    127; zie "Review ronde 1");
  - wachtrij als **schuivend venster**: in elk venster van 4 ms hooguit 16, meteen als er plaats is.
    `this.klok` (HubMidi geeft de zijne, zodat de nep-klok van de test ook de wachtrij stuurt).
- `src/control/hub.js`: de bundel per beeld met een **voorflank** (na `BEELD_MS` stilte meteen, na de
  lopende taak; anders 16 ms na de vorige); de wachtrij naar de speelapparaten ook als schuivend
  venster (een lampje meteen als er plaats is; een scherm blijft via de rij, zodat een nieuwer beeld
  een ouder vervangt).
- `src/control/maschine.js`: `wek()` na elk bericht van de Maschine (lampje meteen), en vlak na invoer
  een scherm per 40 ms (`SCHERM_SNEL_MS`) in plaats van 100.
- Hub-patch (niet gecommit in de hub, alleen voorgesteld): zie onder.


## Review ronde 1 (14 okt): wat de reviewers vonden en wat ik deed

Twee blokkerende punten, allebei over de DRAAIKNOPPEN (endless: track knobs en device knobs). Allebei
klopten ze. Mijn eerste meting keek alleen naar knoppen en lampjes (druk/los), niet naar draaien.

### Nieuwe meting: knoppen draaien (`tools/bench/feedback.mjs`, sectie 6)

Een endless-knop op cc:0:48 (`track.1.filter`, het filter staat in het midden) via de echte MidiHub,
Mapping en Feedback, met de wektik op de bus zoals in midi-opzet.js. Per ronde 2–6 tikken heen en 0–6
terug (een vast zaad), 4, 8 of 20 ms per tik. Verloren = |software − bedoeld| per ronde opgeteld.
Drie nep-APC's:

- **gelijk**: de knop is onafhankelijk (de ring raakt zijn waarde niet) en staat op de waarde van de ring;
- **naast**: hetzelfde, maar de ring staat één tik naast de knop. Zo staat hij na het eerste bericht na
  het richten (`mapping._endless` telt dat niet) en vaak na een focuswissel;
- **overname**: de knop neemt een ring-CC als zijn waarde over. De hub gaat daarvan uit
  (`ringen_nemen_waarde_over`, standaard true), maar proef V1 is nog niet op Clay's APC gedraaid.

```
S=<scratchpad>
node tools/bench/feedback.mjs --knoppen --rondes 100 --bron <checkout van vóór>   # vóór
node tools/bench/feedback.mjs --knoppen --rondes 100                             # na
# de hele bench (alle zes metingen), 3× om en om, dan de mediaan:
node tools/bench/feedback.mjs --bron <vóór> --json voor1.json ; node tools/bench/feedback.mjs --json na1.json  # …×3
node tools/bench/feedback-samen.mjs voor1.json,voor2.json,voor3.json na1.json,na2.json,na3.json
```

Verloren tikken / door het echofilter ingeslikt (100 rondes, 695 berichten, 219 tikken netto):

| knop | vóór de tak (`studio/afmaken`) | de tak zoals gereviewd (5d03269)* | na de reparatie |
|---|---|---|---|
| gelijk, 4 / 8 / 20 ms | 9 / 12 / 28 (25 / 48 / 60 ingeslikt) | 32 / 24 / 6 van 75 (48 / 43 / 20) | **0 / 0 / 0 (0 / 0 / 0)** |
| overname, 4 / 8 / 20 ms | 41 / 40 / 56 (29 / 38 / 64) | 32 / 24 / 6 van 75 (48 / 43 / 20) | **0 / 0 / 0 (0 / 0 / 0)** |
| naast, 8 ms (4 runs vóór, 5 na) | 19–30, gem. 26 (63–72) | 26 van 75 (58) | 18–42, gem. 30 (85–94) |
| naast, 20 ms | 36–38, gem. 37 (126–135) | 16 van 75 (47) | 38–44, gem. 41 (137–146) |

\* de tak zoals gereviewd: mediaan van 2 runs van 30 rondes (75 tikken netto), dus de getallen zijn kleiner.

De volledige bench (3 runs per kant, mediaan, `feedback-samen.mjs`) gaf in de andere metingen hetzelfde
beeld als eerder: druk -> lampje p50 16,3 -> 1,1 ms (p99 39,6 -> 7,1), via de hub 32,4 -> 2,3 ms,
ingeslikt druk/los 20 -> 0, mapje wisselen p50 52 -> 10,5 ms (max 75,5 -> 17,8), tik in rust p50
444 -> 52 µs, Maschine pad -> lampje p50 31,8 -> 1,7 ms. In Chrome met de echte hub
(`led-vertraging.mjs`, één run na de reparatie): p50 5,4 ms, p90 16,1, p99 35,9, 0 ingeslikt.

### Punt 1: de wektik stuurde ook ringen

De reviewer had gelijk: elke knopstap gaf via de wektik meteen een ring-CC terug. Bij een APC die de ring
als knopwaarde overneemt botst dat met de delta-aanpak van endless (de ring zet de knop terug, de stap
daarna geeft delta 0). Met de nabouw van de reviewer (`scratchpad/review-uitvoer/sim/knop.mjs`, 30 draaien
van 3, 90 bedoeld) haalde de tak 45 / 45 / 45 bij 4 / 8 / 50 ms, vóór de tak 60 / 55–57 / 45.

**Gedaan:** de wektik stuurt alleen nog LAMPJES (`tick(max, { lampjes: true })`): ringen en ringtypes
blijven op de gewone tik van 33 ms, zoals vóór de tak. Een lampjestik zet ook geen ringen uit die hij niet
berekende. Met dezelfde nabouw nu 60 / 53 / 45: terug op vóór. De winst op knoppen (lampjes) blijft.
Check: `test/feedback-plan.test.mjs` (de wektik stuurt het lampje en geen CC, de gewone tik erna de ring,
een lampjestik laat de ringen staan).

De echte oplossing voor een APC met ring-overname ligt in het INVOERpad (dan is `absolute` juist goed, of
endless moet de ring als nieuwe basis nemen): dat is van het spoor controller-invoer. Eerst hub-proef V1
op Clay's APC (zie "Alleen op de hardware").

### Punt 2: ringen plus echofilter aten het terugdraaien op

Ook dit klopte: met een ring per bericht stond elke waarde van een draai in het echogeheugen, en
terugdraaien over die waarden binnen 60 ms werd "echo". De nabouw van de reviewer
(`scratchpad/rev-meet/draai2.mjs`, een onafhankelijke knop) gaf op de tak 101 / 71 / 31 / 23 verloren bij
4 / 8 / 20 / 30 ms tegen 14 / 17 / 34 / 27 vóór.

**Gedaan:** (a) punt 1 haalt de snelle ringen weg; daarmee is de nabouw terug op 16 / 21 / 27 / 27
(vóór, in dezelfde sessie: 13 / 26 / 28 / 29). (b) Het voorstel van de reviewer: een CC wordt NIET in het
echogeheugen gezet als hij gelijk is aan de laatste waarde die op die control BINNENKWAM (`_laatsteIn` in
midi.js), behalve 0 en 127 (op de aanslag is hetzelfde bericht doordraaien, dus die blijven bewaakt). Een
echo van zo'n waarde is onschuldig (endless: delta 0); de lus blijft gevangen, want die begint bij een
ring op een waarde die de knop NIET stuurde. Een andere invoer wist `_laatsteIn`. Met de nabouw met een
knop die gelijk staat (`draai2-gelijk.mjs`): vóór 4 / 8 / 8 / 10 verloren, na 0 / 0 / 0 / 0. Checks in
`test/midi.test.mjs`: 64->65->66->65->64 met de ring er meteen achter komt helemaal aan; een
teruggekaatste ring na een focuswissel wordt gevangen; op 127 blijft het filter bewaken; een andere
invoer wist het. Zonder de regel falen de eerste twee checks (gecontroleerd door hem eruit te halen).

**Wat overblijft (eerlijk):** bij "naast" (de ring één tik naast de knop) helpt (b) niet, want de ring is
nooit gelijk aan wat de knop stuurde, en is het na de reparatie iets slechter dan vóór de tak: gemiddeld
30 tegen 26 verloren bij 8 ms, 41 tegen 37 bij 20 ms (van 219, de spreiding per run is groot: 18–42). De
oorzaak heb ik gevonden: de oude wachtrij stuurde ELK bericht via een `setTimeout(0)` (1–4 ms later). Een
knopbericht dat in die paar ms na de tik binnenkwam, was er vóór de ring in het echogeheugen stond en
kwam dus door. Met de wachtrij van vóór (alleen die, de rest van de tak gelijk) is "naast" terug op vóór:
16–28 / 30–39 verloren, 61–68 / 124–131 ingeslikt in 3 runs (`scratchpad/rev-meet/knop-proef.mjs`,
`OUDE_RIJ=1`). Die vertraging schermde dus toevallig af. Ik heb haar niet teruggezet voor CC: dat zou alle
lampjes in een tik met een ringwissel ook weer laten wachten. Het blijft een gebrek van het echofilter
zelf (60 ms, en een ring die net naast de knop staat). De echte oplossing is optie 1 (het filter voor de
APC uit, na één meting op het apparaat), of in het invoerpad de eerste draai na het richten niet laten
vallen (dan ontstaat "naast" niet).

### De kleine punten

- **Getallen in comments**: feedback.js, maschine.js en midi-opzet.js noemen geen eigen cijfers meer
  maar verwijzen naar dit verslag (één bron).
- **alles.mjs**: zie "Tests" hieronder (run na de reparatie).
- **"Per definitie niet duurder"**: te sterk gezegd, aangepast (de sleutel per tik en de herbouw kosten
  iets; gemeten verwaarloosbaar).
- **Maschine-schermen met 25 beelden/s en HID synchroon in de hub**: bij "Alleen op de hardware".
- **`Feedback.stop()` en `Maschine.stop()`**: hangen nu aan `pagehide` (midi-opzet.js, speelapparaten.js).
- **De hub-patch, `zet()` direct zonder `#klaar()`**: nagekeken, geen probleem. `leeg()` lost meteen op
  als rij en timer leeg zijn; een wachtende bestaat dus alleen zolang er een timer loopt, en dan neemt
  `zet()` de directe weg niet. Er staat nu een comment bij in de patch; `test/kern.test.js` 9/9.
- **Echofilter op noten**: "nooit een echte echo" rust op het protocol, niet op een meting. Zo staat het
  nu in CLAUDE.md en hierboven.
- **De mapje-meting** telde elk pad-bericht in 250 ms, ook knipperende loop-pads op de tel: het maximum
  zei niets. Nu telt ze per pad dat door de wissel moet veranderen (gewild vóór tegen gewild meteen erna)
  het EERSTE bericht, en ze meldt pads die nooit kwamen (0). Mediaan van 3 runs: p50 52 -> 10,5 ms,
  max 75,5 -> 17,8 ms.

## Tests (elke wijziging een check)

- Review ronde 1: `test/feedback-plan.test.mjs` (wektik alleen lampjes, de ring op de gewone tik, een
  lampjestik laat ringen staan) en `test/midi.test.mjs` (draaien en terug komt aan, de lus na een
  focuswissel blijft gevangen, de aanslag, een andere invoer).
- `node test/alles.mjs` (VARVE_HUB_REPO gezet), na de reparatie: **95 bestanden, 8846 checks, 2 ROOD**,
  allebei bekende omgevingsfouten van deze container: renderblok "keylock met wissels: 83,7 bytes per
  bericht" en wachtrij "yt-dlp en zijn kind zijn allebei weg" (2×). instrumenten-fm-schaal was deze keer
  groen. De run vóór de review (eerste versie van de tak): 95 bestanden, 8838 checks, 4 ROOD: dezelfde
  drie plus gridauto ("analyse op de achtergrond duurde 14,9 s", belasting; los gedraaid groen).
- Gericht na de reparatie, allemaal groen: midi, feedback, feedback-plan, mapping, learn, spiegel, hub,
  maschine, maschine-kaart, bladeren, maschine-sampler; headless `tools/headless/hub.mjs` (conform
  PROTOCOL.md) en `led-vertraging.mjs`.

- `test/feedback-plan.test.mjs` (nieuw, echte engine en standaardmapping): wat er brandt is **byte voor
  byte** gelijk aan de oude berekening (letterlijk overgenomen als referentie) in 567 standen: rust,
  spelen met knipperen op de tel (~120 stappen van 33 ms), alle 9 grid-mapjes × 4 focus-tracks (met
  een instrumenttrack en een track zonder grid) × shift, de device-mapjes, de grid-modus. Verder: het
  plan wordt hergebruikt en vernieuwd op de juiste momenten; een mapping zonder events; `wek` (niets
  synchroon, één tik, samengevoegd, timer binnen 4 ms, niets dubbel, paletproef, stop).
- `test/midi.test.mjs`: loslaten na "lampje uit" en indrukken na "lampje aan 127" komen door; een ring
  die terugkaatst wordt nog gevangen; het schuivende venster gemeten op de echte verzendtijden
  (hooguit 16 in elk venster van 4 ms, 110 berichten), het zeventiende wacht.
- `test/hub.test.mjs`: de voorflank (na stilte 0 ms, binnen een beeld wachten, 16 ms na de vorige in
  één bundel); de wachtrij van de speelapparaten (16 meteen, ook na 3 ms niet meer, na 4 ms de rest).
- `test/maschine.test.mjs`: 40 ms vlak na invoer, 100 ms zonder; `wek` (pad 3 fel zonder `tik()`,
  niets dubbel, timer binnen 4 ms, stop).
- Headless met de echte hub: `tools/headless/hub.mjs` (conformiteit, 284 berichten naar de APC),
  `speelapparaten.mjs` en `sec-maschine.mjs` (28 checks) groen.

## Wat ik NIET deed (en waarom)

- **Een microtaak in plaats van `setTimeout(0)` voor de voorflank in hub.js**: gebouwd en gemeten
  (Chrome + hub, 3 runs: p50 6,2 / 8,0 / 6,5 ms tegen 5,6 / 6,3 / 8,7 ms): niet meetbaar beter,
  dus teruggedraaid naar het eenvoudigste.
- **Voorrang in de wachtrij voor wat je net aanraakte**: niet nodig gebleken. Na de wektik staat de
  wachtrij tijdens spelen op 0 (gemeten max 0); alleen bij een mapjewissel staan er even ~27 in
  (~7 ms).
- **Event-gedreven LED's** (alleen herlezen wat veranderde): de tik is met het plan al ~50 µs; de
  winst weegt niet op tegen een tweede bron van waarheid naast de reads.
- **De wachtrij van de hub** (`src/core/wachtrij.js`): de hub-repo is hier alleen-lezen. De patch staat
  klaar (onder). Niet in de hub gecommit.
- Niets aan mapping.js, actions.js, renderloop of beatgrid (andere sporen).

## Hub-patch (voorstel, niet gecommit)

`/tmp/claude-0/-home-user-youtube-mixer/6ff8dd87-3094-5cbd-b3bb-7f262960b5d2/scratchpad/hub-patches/controller-uitvoer.patch`
(3 bestanden, +42 −4):

- `src/core/wachtrij.js`: hetzelfde schuivende venster als VARVE: meteen als er plaats is, en in elk
  venster van 4 ms hooguit 16. Vroeger kon een rij die net leeg was meteen weer 16 sturen (32 in een
  paar ms), en wachtte elk bericht op een timer.
- `test/kern.test.js`: een test voor het venster (meteen, vol, na 4 ms, 77 berichten nooit meer dan 16
  in 4 ms). De bestaande wachtrijtests blijven groen.
- `tools/repetitie-avond.mjs`: de controle "LEDs van de app bereiken de APC" telde vanaf ná de focus,
  terwijl de nep-app zijn lampjes juist BIJ de focus stuurt; dat ging alleen goed omdat de oude
  wachtrij ze op de nep-klok van de proef liet wachten. Nu telt hij vanaf vóór de focus.
- Gedraaid in een kloon met `npm ci`: `test/kern.test.js` 9/9, `test/repetitie.test.js` 28/28 (twee
  keer), de hele suite 1258 groen, 2 rood (oefen-ui in de browser, opname-hub herhaal): die zijn ook
  zonder patch rood of wisselend (zonder patch een volle run 5 rood, waaronder sets-cli; oefen-ui los
  gedraaid zonder patch ook rood); `opname-hub` los gedraaid met en zonder patch 6/6.
- Effect gemeten in Chrome: p50 6,3 -> 5,3 ms (mediaan van 3); de staart is onder deze belasting niet
  te onderscheiden.

## Alleen op de hardware te bevestigen

- Of de APC in 0x42 ooit een ring-CC terugkaatst. Zo niet (`midi.status().echoes` blijft 0 na een
  sessie), dan kan `echoFilter` voor de APC helemaal uit en verdwijnt ook het laatste risico (een knop
  die binnen 60 ms op precies dezelfde waarde terugkomt).
- **Hub-proef V1 (ring-overname) op Clay's APC draaien.** De hub gaat ervan uit
  (`ringen_nemen_waarde_over`, standaard true, kern.js) dat een ring-CC in 0x42 ook de interne waarde
  van de knop zet. Klopt dat, dan past de delta-aanpak van endless (mapping.js) slecht bij de APC en
  hoort de echte oplossing in het INVOERpad (dan is `absolute` juist goed). Tot die proef stuurt de
  wektik geen ringen (Review ronde 1).
- De USB-kant: wat de APC en de Maschine doen met de nu snellere lampjes (ringen blijven op 30 per
  seconde, zoals vóór deze tak; de wachtrij houdt alles onder 16 per 4 ms).
- **Maschine-schermen met 25 beelden per seconde** bij draaien (`SCHERM_SNEL_MS` 40): de hub schrijft
  HID SYNCHROON (av-app-hub `docs/MASCHINE.md`: is een schermupdate veel meer dan ±20 ms, dan moet het
  schrijven naar HIDAsync, zodat een scherm de pads niet vertraagt). Die proef (`ms-scherm`) staat in
  de hub nog open. Tot hij gedraaid is kan sneller schermen in de hub de pads vertragen; terug naar 10
  per seconde is één getal (`SCHERM_SNEL_MS = SCHERM_MS`). De hub stuurt per scherm alleen de stukken
  van 8 regels die veranderden (`per_burst` 4).
- Hoe het voelt: of "laggy" nu weg is, of dat (ook) het invoerpad was (ander spoor).

## Opties voor een volgende versie

1. **Echofilter voor de APC uit** na een meting op het apparaat. Kosten: 10 minuten met de APC (een set
   draaien, dan `midi.status().echoes` lezen). Baten: geen enkele ingeslikte beweging meer, ook niet bij
   een draaiknop waarvan de ring net naast de knop staat (nu nog 30–41 van 219 tikken verloren bij snel
   heen en terug, "naast" in review ronde 1). Laag risico; terug te zetten met `echoFilter: true` in het
   profiel.
2. **Knipperen precies op de tel** in plaats van bemonsterd op de tik van 33 ms: de LED-laag rekent de
   volgende flank van elke knipperende track uit (fase, tellengte, uitgangsvertraging) en zet een wektik
   op dat moment. Kosten: ~een dag (feedback.js, een test met nep-klok). Baten: de lampjes van de
   maatgever en de loops vallen tot op een paar ms op de tel die je hoort (nu tot 33 ms te laat).
3. **De hub-patch toepassen** (wachtrij als schuivend venster). Kosten: review en merge in AV-app-hub.
   Baten: ~1 ms minder per lampje en de 16-per-4-ms-regel ook echt per venster op de draad naar de APC.
4. **MIDI en LED's van de hoofdthread** (met `?hub=`: de WebSocket en de LED-laag in een Worker).
   Kosten: groot (de reads van de engine moeten dan als snapshot naar de Worker). Baten: de staart (p90
   25 ms, p99 70+ ms onder belasting in Chrome) komt van een drukke hoofdthread; een Worker houdt de
   lampjes los van de renderloop. Eerst meten op Clay's M1: misschien is de staart daar geen probleem.
5. **Track select sneller**: het omzetten van het scherm bij een focuswissel (spiegel, focusdeel) zit in
   dezelfde taak vóór de wektik (p50 7,5–14,5 ms tegen 4,0–6,3 ms voor A|B). Kosten: in het invoerpad/renderloop
   (ander spoor): het scherm in het volgende beeld omzetten in plaats van synchroon. Baten: track select
   even snel als de rest.
6. **Maschine: alleen het scherm tekenen dat verandert** (de stand per scherm splitsen). Kosten: klein.
   Baten: klein (twee schermen tekenen kost ~62 µs); alleen zinnig als de schermen rijker worden.

## Vragen voor Clay

- Mag het echofilter voor de APC uit na één avond meten (optie 1)? Dan heb ik `midi.status().echoes` na
  een sessie nodig.
- Wat voelde laggy: het lampje (dit spoor), of dat de knop zelf laat reageert (het geluid, de fader)?
  Dat laatste is het invoerpad.
- Mag ik op de APC één keer de hub-proef V1 (ring-overname) draaien? Die beslist of de draaiknoppen
  in het invoerpad anders moeten (endless of absolute).
- Op de Maschine loopt het scherm bij draaien nu met ~25 beelden per seconde: prettig, of liever
  rustiger (100 ms zoals eerst)?
