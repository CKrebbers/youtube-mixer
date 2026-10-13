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
| direct: mapje wisselen, laatste lampje p50 / max ms | 56,4 / 81,3 | 11,4 / 40,1 |
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

De tik-p99 van "spelen" is na hoger (2,9 ms tegen 1,5 ms): dat is de machine (in dezelfde run is
de p99 van rust en loops na juist lager). De tik is per definitie niet duurder geworden: hij doet een
strikte deelverzameling van het werk (test 1 hieronder eist dezelfde uitkomst).

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
   druk/los in Node (9%), 16 van 240 in Chrome (7%). Een lus kan alleen via een ring (CC); op noten ving het
   filter nooit een echte echo.
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
    dubbel (de tik stuurt alleen verschillen). `stop()` haalt hem weg.
  - `MAX_PER_TIK` 160 (was 24): een hele verversing in één tik; de wachtrij spreidt.
- `src/ui/midi-opzet.js`: `wek` op `bijInvoke` (elke action: APC, muis, toetsenbord, auto-DJ) en op
  een ander mapje (`lagen` `change`).
- `src/control/midi.js`
  - echofilter **alleen CC** (ook het geheugen van het filter: lampjes vullen het niet meer);
  - wachtrij als **schuivend venster**: in elk venster van 4 ms hooguit 16, meteen als er plaats is.
    `this.klok` (HubMidi geeft de zijne, zodat de nep-klok van de test ook de wachtrij stuurt).
- `src/control/hub.js`: de bundel per beeld met een **voorflank** (na `BEELD_MS` stilte meteen, na de
  lopende taak; anders 16 ms na de vorige); de wachtrij naar de speelapparaten ook als schuivend
  venster (een lampje meteen als er plaats is; een scherm blijft via de rij, zodat een nieuwer beeld
  een ouder vervangt).
- `src/control/maschine.js`: `wek()` na elk bericht van de Maschine (lampje meteen), en vlak na invoer
  een scherm per 40 ms (`SCHERM_SNEL_MS`) in plaats van 100.
- Hub-patch (niet gecommit in de hub, alleen voorgesteld): zie onder.

## Tests (elke wijziging een check)

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
- De USB-kant: wat de APC en de Maschine doen met de nu snellere lampjes (een ring krijgt nu een bericht
  per binnenkomend CC in plaats van hooguit 30 per seconde; hoeveel CC een APC-knop per seconde stuurt
  heb ik niet gemeten, de wachtrij houdt het hoe dan ook onder 16 per 4 ms) en de schermen
  met 25 beelden per seconde bij draaien (de hub stuurt per scherm alleen de stukken van 8 regels die
  veranderden, `per_burst` 4).
- Hoe het voelt: of "laggy" nu weg is, of dat (ook) het invoerpad was (ander spoor).

## Opties voor een volgende versie

1. **Echofilter voor de APC uit** na een meting op het apparaat. Kosten: 10 minuten met de APC (een set
   draaien, dan `midi.status().echoes` lezen). Baten: geen enkele ingeslikte beweging meer, ook niet op
   een ring. Laag risico; terug te zetten met `echoFilter: true` in het profiel.
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
- De ringen volgen je draai nu per bericht in plaats van 30 keer per seconde. Ziet dat er op de APC
  rustig uit, of flikkert er iets?
- Op de Maschine loopt het scherm bij draaien nu met ~25 beelden per seconde: prettig, of liever
  rustiger (100 ms zoals eerst)?
