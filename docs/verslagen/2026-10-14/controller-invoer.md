# Controller-invoer: lag van knop tot geluid en scherm (14 okt 2026)

Tak `afmaken/controller-invoer` (vanaf `studio/afmaken` 339310b). Spoor: het INVOERpad —
midi.js (ontvangst), mapping.js, de bus, en de hoofdthread (renderloop, spiegel, panelen)
die elk MIDI-bericht laat wachten. Niet aangeraakt: feedback.js, de LED- en schermuitvoer van
hub.js, maschine-scherm.js (spoor controller-uitvoer), het beatgrid.

Clay: "Ik merkte dat het op veel punten erg laggy was." Er is hier geen APC, geen Maschine,
geen Scarlett en geen muziek van Clay. Alles hieronder is gemeten met een nep-APC, een
synthetische demotrack (acht keer, eigen zaad) en headless Chrome, in een Linux-container met
vier kernen die ik deelde met andere agenten (belasting 2–17). Wat alleen op het apparaat te
bevestigen is, staat apart.

## Kort

1. **Een MIDI-bericht kost zelf weinig; het WACHT.** Een faderbericht deed ~0,2 ms werk (parse,
   mapping, bus, engine, AudioParam). Maar het moest wachten tot de hoofdthread klaar was met
   de rest, en die was in rust (acht tracks spelend, rijen open) **71% van de tijd bezig**
   (713 ms per seconde threadtijd), waarvan 166 ms/s stijlberekening.
2. **De grootste oorzaak: brede `:has()`-regels in styles.css.** `body:has(#rijen > section:not(.hidden)) .kol .spg-pad`
   en negen andere: elke tekstwissel ergens op de pagina (elk beeld: tijden, bpm) liet Chrome
   ~**256 elementen per beeld** opnieuw stylen (trace: "Affected by :has()"). Nu klassen. Stijl
   **166 → 31 ms/s**, hoofdthread in rust **713 → 457 ms/s**.
3. **Een echte fout op de controller: het echofilter slikte drukken.** Op een knop die
   knippert (Sends met een loop, de Track Select van de maatgever) viel **13% van de drukken
   en 12% van het loslaten** weg: een druk die niets deed (focus op de maatgever, de
   loop-knoppen). Nu **0%**. Dat een kill of bend daardoor bleef hangen is niet aangetoond:
   hun lampje staat nooit op 0 of 127, dus daar sloeg het filter niet aan.
4. Shift en de modusknoppen deden 2–13 ms schermwerk midden in hun MIDI-bericht (en alles
   erachter wachtte). Nu bij het volgende beeld: werk per bericht p99 **5,5 → 1,8 ms** (shift),
   **7,0 → 2,3 ms** (mapjes).
5. Netto, fader (120 berichten/s), van bericht tot het geluid gepland is: **p50 7,4 → 1,9 ms,
   p99 37,6 → 11,9 ms**. Fader-sweep (acht faders, 960/s): **p50 8,5 → 2,8, p99 40,6 → 18,3 ms**.

## Hoe gemeten (herhaalbaar)

Vier instrumenten, alle vier nieuw in deze tak:

- `tools/headless/latentie.mjs` — de echte mixer in headless Chrome. `navigator.requestMIDIAccess`
  is nep vóór de pagina laadt (één invoer- en uitvoerpoort "APC40 mkII"); de mixer kiest die
  zelf, dus elk bericht gaat door het ECHTE pad: `onmidimessage → MidiHub._onMessage → monitor →
  onInput → mapping.handle → invoke → engine` plus spiegel en wat er verder per bericht gebeurt.
  De berichten komen uit een Worker op hun eigen tijd (Atomics.wait), elk als eigen taak, zoals
  Chrome MIDI aflevert; hun `timeStamp` is het moment van versturen. Acht tracks met de demotrack
  (eigen zaad, grid op slot), spelend, alle acht rijen open, videopaneel dicht (zie "Wat niet").
  Per scenario: **wacht** (versturen → handler begint), **werk** (de handler), **tot geluid**
  (versturen → eerste AudioParam- of worklet-aanroep), **tot scherm** (versturen → de fader op het
  scherm staat goed aan het eind van een beeld), frame-interval, lange taken, rAF per callback,
  hoofdthread in THREADtijd (CDP Performance, `threadTicks`: andere processen tellen niet mee),
  `--profiel` (CPU-profiel, zelftijd per functie), `--spoor` (een trace met de redenen van elke
  stijlberekening). `--hub`: dezelfde meting door de echte AV-app-hub (in hetzelfde proces, met een
  nep-APC van de hub zelf; klokken via CDP gelijk, ±0,5 ms). `--vergelijk a1,a2,a3 b1,b2,b3`: tabel,
  mediaan over rondes.
- `tools/bench/invoer.mjs` — zonder browser: parseMessage + Mapping.handle met de echte
  standaardmapping, en het mapping-deel van een LED-tik. µs en bytes afval per bericht.
- `tools/bench/echo.mjs` — de echte MidiHub (echofilter aan), Mapping en Feedback op een nep-klok:
  een track op 124 bpm met een loop, de LED-tik elke 33 ms, een "hand" die 4000 keer op willekeurige
  momenten drukt en 60–200 ms later loslaat (vast zaad). Telt wat de mapping niet bereikte.
- `tools/headless/meldingen.mjs` (review ronde 1) — de echte `meld()` in de mixer: licht een herhaalde
  melding elke keer op (animationstart geteld) en leest `meld()` daarbij geen opmaak uit.

Commando's (de vóór-versie is `git archive studio/afmaken` uitgepakt in `$VOOR`):

```sh
# headless, vóór en na om de beurt, 3 rondes (zo zijn de tabellen hieronder gemaakt)
export VARVE_CHROME=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell VARVE_TMP=<tmp>
VARVE_WORTEL=$VOOR node tools/headless/latentie.mjs --label voor --duur 4000 --uit voor-1.json
node tools/headless/latentie.mjs --label na --duur 4000 --uit na-1.json
#   … rondes 2 en 3, dan:
node tools/headless/latentie.mjs --vergelijk voor-1.json,voor-2.json,voor-3.json na-1.json,na-2.json,na-3.json
# via de hub (een kopie van AV-app-hub MET node_modules)
VARVE_HUB_REPO=<hub-kopie> node tools/headless/latentie.mjs --hub --scenario fader,sweep,ringen,pads,shift
# waar de stijltijd vandaan komt
node tools/headless/latentie.mjs --scenario rust --duur 2000 --spoor rust --uit spoor.json
# een herhaalde melding licht elke keer op (animationstart geteld), zonder opmaak te lezen
VARVE_CHROME=<headless_shell> node tools/headless/meldingen.mjs
# zonder browser
node --expose-gc tools/bench/invoer.mjs --vergelijk $VOOR
node tools/bench/echo.mjs $VOOR ; node tools/bench/echo.mjs
```

Belangrijke kanttekening bij de omgeving: met SwiftShader (de standaard van de andere
headless-tools) at de GPU-process drie van de vier kernen op en zakten de beelden naar
~6 per seconde; dat is niet de Mac. Daarom draait `latentie.mjs` standaard met
`--disable-gpu --disable-gpu-compositing` (60 beelden/s, software); `VARVE_LAT_GPU=swiftshader`
zet het terug. Software-rendering zet canvastekenen op de hoofdthread: absolute getallen zijn
dus pessimistischer dan op een M1, de verhoudingen niet. Wandkloktijden (wacht, tot geluid)
schommelen met de belasting van de machine (andere agenten draaiden tests); daarom drie rondes
om de beurt en de mediaan. Threadtijden (taak, stijl, opmaak) zijn daar ongevoelig voor.

## Nulmeting en nameting

Mediaan van drie rondes elk, vóór en na om de beurt (belasting tijdens de rondes 2,4–8,7).
Tijden in ms, `p50 / p99`; "hoofdthread" in ms threadtijd per seconde.

| scenario | maat | vóór | na |
|---|---|---|---|
| rust (spelend, niets aanraken; pings 100/s) | wacht | 7,39 / 28,76 | **0,29 / 9,86** |
| | frame-interval | 17,33 / 42,76 | 16,73 / 21,25 |
| | hoofdthread: taak · script · stijl · opmaak | 713 · 152 · 166 · 81 | **457** · 145 · **31** · **29** |
| fader (één, 120/s) | wacht | 6,75 / 36,12 | 1,61 / 11,62 |
| | werk per bericht | 0,18 / 1,72 | 0,18 / 1,04 |
| | **tot geluid gepland** | 7,37 / 37,63 | **1,87 / 11,88** |
| | tot scherm | 13,74 / 50,87 | 12,78 / 20,67 |
| | lange taken (> 50 ms) | 1 (50 ms) | 0 |
| sweep (acht faders, elk 120/s) | tot geluid gepland | 8,49 / 40,57 | **2,78 / 18,30** |
| | tot scherm | 14,78 / 48,34 | 11,42 / 25,57 |
| | hoofdthread: taak · stijl | 707 · 137 | 626 · 23 |
| ringen (acht track knobs, endless, 120/s) | tot geluid gepland | 4,16 / 23,86 | 1,91 / 14,04 |
| | hoofdthread: stijl | 148 | 9 |
| device (acht device knobs, 120/s) | tot geluid gepland | 3,34 / 14,38 | 2,24 / 19,57 |
| | hoofdthread: taak · stijl | 743 · 158 | 582 · 10 |
| xfader (120/s) | tot geluid gepland | 3,83 / 15,70 | 2,28 / 10,36 |
| pads (hotcue-pads, 16/s) | tot geluid gepland | 2,16 / 16,05 | 1,16 / 12,42 |
| shift (8/s, met een fader erdoor) | werk per bericht | 0,16 / **5,52** | 0,17 / **1,75** |
| | tot geluid gepland | 8,49 / 31,48 | 6,34 / 27,62 |
| | hoofdthread: stijl | 269 | 85 |
| mapje (grid-modus wisselen 4/s + pads) | werk per bericht | 0,87 / **6,97** | 0,13 / **2,29** |
| | tot geluid gepland | 9,03 / 16,48 | 3,41 / 9,22 |

**"Tot scherm" claim ik NIET als verbetering.** De reviewer kreeg hem niet terug (twee rondes:
11,97 / 20,04 vóór, 14,7 / 21,56 na); de vóór-p99 van ~50 ms hierboven komt waarschijnlijk van de
belasting op de machine tijdens mijn rondes. De andere getallen kwamen bij hem in dezelfde richting terug.

`device` p99 is na iets slechter (14,4 → 19,6) en de frame-interval p99 ook; bij `device` en
`xfader` zie ik dat terug in één ronde met een hoge belasting. Ik reken het tot ruis, maar het is
een getal dat ik niet weg kan verklaren met de metingen die er zijn.

Via de echte hub (2 rondes, `--hub`): fader tot geluid **6,75 / 32,75 → 3,37 / 17,52**, shift
22,26 / 56,33 → 10,74 / 44,40, pads 3,86 / 22,72 → 2,86 / 21,53; stijl op de hoofdthread
177 → 33 ms/s. Sweep en ringen via de hub NIET beter in wandkloktijd (10,4 / 42,6 → 11,2 / 55,3):
daar draait de nep-APC in hetzelfde Node-proces als de hub en de afleverlus houdt een kern bezig
(960 berichten/s, draaiend wachten op de laatste 2 ms). Voor hoge snelheden via de hub is dit
meetinstrument dus niet goed genoeg; de threadtijd op de hoofdthread daalde wel (stijl 161 → 22).
De hub zelf voegt bij 120/s ~1–2 ms p50 toe (vergelijk fader direct en via de hub, na).

Zonder browser (`tools/bench/invoer.mjs --vergelijk`, µs en bytes per bericht):

| geval | vóór µs | na µs | vóór bytes | na bytes |
|---|---|---|---|---|
| fader | 1,84 | 0,62 | 1982 | 636 |
| ringknop | 1,52 | 0,35 | 1686 | 348 |
| deviceknop | 2,31 | 0,44 | 2159 | 591 |
| pad | 1,38 | 0,38 | 1134 | 384 |
| pad (shift, mapje klank) | 1,34 | 0,38 | 1196 | 384 |
| LED-tik: actieveRegels + resolveTarget | **285,36** | **8,14** | 62166 | 1385 |

Echofilter (`tools/bench/echo.mjs`, Sends = loop out met een lopende loop, 4000 drukken):

| | vóór | na |
|---|---|---|
| drukken die aankwamen | 3481 / 4000 (13,0% weg) | 4000 / 4000 |
| loslaten dat aankwam | 3520 / 4000 (12,0% weg) | 4000 / 4000 |
| ter vergelijking: Lock (lampje wisselt bijna nooit) | 0% weg | 0% weg |

Trace in rust (`--spoor rust`, 2 s, met invalidation tracking; de trace zelf kost veel, dus
alleen de verhouding telt): vóór de :has-wijziging 75 stijlberekeningen van elk **256**
elementen, 805 ms; erna 58 van elk **9** elementen, 96 ms. De top van de redenen vóór:
"Invalidation set matched class" op `knob-ind` (4028×), `knob-dial` (3952×), `spg-pad` (3040×),
`spg-mini`, `spg-knop`, `CANVAS`, `pad`, `baan`, met "Affected by :has() · MAIN" en
"ScheduleStyle · has · BODY" ervoor, en "Node was inserted into tree · #text" als aanleiding.

## Oorzaken (wat ik vond)

1. **Brede `:has()` in styles.css.** `body:has(#rijen > section:not(.hidden)) …` (9 regels),
   `body:has(#auto|#klankschaal|#stems:not(.hidden)) …` (4) en `.stems-rij:has(…) …` (9). Elke
   wijziging die de `:has()` opnieuw laat beoordelen (een tekstknoop die vervangen wordt via
   `textContent`, elk beeld) liet Chrome alle elementen achter die regels opnieuw stylen.
2. **Het echofilter op noten.** Het filter (60 ms) moet LED-ringen die terugkaatsen tegenhouden;
   het keek ook naar noten. Een LED zetten IS een note-on (kleur = velocity), dus een lampje op
   127 of uit en jouw druk of loslaten op die knop binnen 60 ms was een "echo".
3. **Schermwerk in het MIDI-bericht.** Shift en elke modusknop lieten de spiegel ~200 elementen
   opnieuw afleiden (mapping, beschrijving, attributen) en de mapje-balk 702 regels filteren en
   HTML bouwen, synchroon in de handler: 2–13 ms waarin geen ander bericht aan de beurt kwam.
   Per bericht ook een klasse plus `clearTimeout` + `setTimeout` per element (oplichten).
4. **Gedwongen opmaak buiten een beeld.** De bovenbalk las elke seconde `scrollWidth` (tot ~12 ms
   opmaak van de hele pagina in een timer), en `meld()` las `offsetWidth` bij een herhaalde
   melding (een pad die steeds "geen secties" zegt: elke druk).
5. **Opmaak per beeld door de meters.** De staande meters (8 kolommen, master, gain reduction)
   bewogen met `height` en een `transition` op height.
6. **De mapping zocht per bericht en per LED-tik opnieuw.** `kies()` maakte per aanroep nieuwe
   teksten en vroeg per aanroep een nieuwe lijst open mapjes; de LED-laag deed dat voor 702 regels,
   30× per seconde (62 kB afval per tik). `resolveTarget` met een regex en een terugroepfunctie.

## Wat ik veranderde

- `styles.css` + `src/ui/rij-klassen.js` (nieuw): dezelfde voorwaarden als klassen
  (`body.rij-open`, `body.rij-hoog`, `div.rijen.open`, `.stems-rij.vier-stems`,
  `.stems-rij.zonder-stemmen`), bijgehouden door één MutationObserver op `#rijen`; met **dezelfde
  specificiteit** als de :has() (herhaalde klasse, `:not(#rij-x)`, `div.`/`html`), zodat er niets
  anders gaat winnen. Over: alleen `main:has(> .video-panel…)` (een direct kind, kwam niet in de
  trace voor). `tools/headless/rijen.mjs` gaf vóór en na exact dezelfde maten voor de 182 checks
  die hij hier haalt (daarna hangt hij in deze container bij "video + alle rijen", vóór én na).
- `src/control/midi.js`: het echofilter alleen voor CC (ontvangen en onthouden).
- `src/ui/spiegel.js`: herberekenen na shift/mapje/mapping bij het volgende beeld (`straks`;
  `teken()` doet het vóór de lampjes); attributen en klassen alleen schrijven als ze anders zijn;
  `markeer()` onthoudt alleen tot wanneer een element oplicht, `teken()` zet en haalt de klasse;
  sectie-pad en `lampOm` één keer per regel uitgerekend, niet per beeld per knop.
- `src/ui/mapje-balk.js`: de uitleg van een mapje bij het volgende beeld (de laatste wissel telt).
- `src/ui/meldingen.js`: opnieuw laten oplichten zonder `offsetWidth`: om de beurt twee klassen met elk
  een eigen keyframes-naam (na review ronde 1; eerst klasse eraf + rAF erop, en dat lichtte maar één keer op).
- `src/ui/bovenbalk.js`: ResizeObserver (na de opmaak van een beeld) i.p.v. een timer.
- Meters: `transform: scaleY()` (styles.css `.meter.vmeter i`, spiegel, renderloop, master-paneel);
  de gradient hoort bij het element, dus het beeld is hetzelfde.
- `src/ui/dom.js` `zetTekst`: tekst in de bestaande tekstknoop; elf panelen gebruiken hem.
- `src/control/mapping.js` + `lagen.js`: caches voor `kies()` en `actieveRegels()` (ongeldig bij
  set/remove/load/voegToe/rules toewijzen, een ander mapje, ook `stand` direct gezet; shift een eigen
  vak), `Lagen.actief()` dezelfde bevroren lijst zolang de stand gelijk is, `resolveTarget` knipt
  een sjabloon één keer. Zelfde API, zelfde uitkomst (de test vergelijkt elke knop met de zoektocht).

Checks: `test/invoer.test.mjs` (nieuw: CSS zonder brede :has(), specificiteit gelijk, rij-klassen,
zetTekst, per beeld i.p.v. per bericht, meters, bovenbalk), `test/mapping.test.mjs` (+17: de cache
tegen de zoektocht, elke soort wijziging, resolveTarget gelijk aan de regex), `test/midi.test.mjs`
(+3: noten zijn geen echo; faalt op de oude code).

Regel 3 en het audiopad: niet aangeraakt. Het GELUID blijft direct: alleen scherm en uitleg
wachten op het volgende beeld.

## Wat ik niet deed (en waarom)

- **Engine-werk per faderbericht.** Elke `deck.set` geeft 'change', en de engine herankert dan
  bussen, master-rack, sampler, klankschaal en zoekt de maatgever (`volgMaat`): in het profiel van de sweep samen ~100 ms over 3840 berichten, een schatting van ~0,03 ms per
  bericht in het profiel (`maatgever`, `_stand`, `get speelt`). Bundelen per beeld zou de engine
  laten afhangen van een beeldklok (regel 1 en 3) of een microtaak (helpt niet: elk MIDI-bericht is
  een eigen taak). Niet de moeite tegen het risico.
- **feedback.js** (LED-tik: `desired()` leest elke regel, `kleurVoor` zoekt met een regex per regel
  per tik, `read` ~20 ms/s): spoor controller-uitvoer. Mijn cache maakt zijn mapping-deel 35× goedkoper
  zonder dat feedback.js verandert.
- **Het videopaneel** in de meting: in deze container rendert SwiftShader WebGL op de CPU en zakken de
  beelden naar ~6/s. Op de Mac doet de GPU dat. Met `--video 1` te meten.
- **De Maschine en de Xboard via de hub** (noten → noten.js → instrument): niet gemeten.
- **De eerste tik van een endless-knop na een focuswissel gaat verloren** (bewust in `_endless`, omdat
  niet bekend is of de APC zijn interne knopstand gelijkzet met de ring). Alleen op het apparaat te
  beslissen; zie de vragen.

## Alleen op het apparaat te bevestigen

- Hoe het VOELT. Mijn getallen zijn een headless Chrome met software-rendering op vier gedeelde kernen.
- De uitgangsvertraging van de AudioContext op de Scarlett / het samengestelde apparaat van vier
  kanalen: die komt bovenop "tot geluid gepland" (hier 10 + 32 ms gerapporteerd door een nep-uitgang,
  dus niets waard). Het MIDI-paneel toont "latency: … in + … audio": dat getal wil ik graag zien.
- Of de APC in 0x42 ringwaarden terugstuurt: na een sessie `midi.status().echoes` in de console. Zegt
  hij 0, dan mag het filter voor de APC helemaal uit (`echoFilter: false` in `devices/apc40mk2.js`).
- Of knipperende knoppen (Sends, Clip Stop met een loop, de Track Select van de maatgever) nu elke druk
  pakken.
- Via de hub: wat de hub toevoegt bij hoge snelheid (mijn meting was daar niet goed genoeg).

## Opties voor een volgende versie

1. **De feedback-tik goedkoper (spoor uitvoer).** `desired()` per regel een vooraf uitgerekende kleur
   (nu `kleurVoor` met een regex per regel per tik) en alleen de reads die kunnen veranderen. Kosten:
   een middag + de LED-tests. Baten: ~20–30 ms/s hoofdthread minder (het grootste JS-blok na de
   renderloop), dus minder wachten voor elk bericht.
2. **MIDI-invoer van de hoofdthread af.** Web MIDI kan niet in een Worker, maar de hub wel: hub.js in
   een Worker (WebSocket + parse + mapping) die alleen `invoke` naar de hoofdthread post. Kosten: groot
   (de bus en de engine wonen op de hoofdthread, dus de winst is alleen het parsen). Baten: klein zolang
   de engine-aanroep zelf op de hoofdthread moet. Pas zinvol samen met optie 3.
3. **De renderloop op een budget.** Elk beeld ~2,5 ms JS (spiegel-lampjes ~200 reads, volgEngine, acht
   golfvormen). Lampjes en tekst om het andere beeld, golfvormen van tracks die niet klinken op 15/s.
   Kosten: een dag + kijken op de Mac of het niet schokt. Baten: de helft van de rAF-tijd; minder kans
   dat een bericht achter een beeld wacht.
4. **Gemeten latentie in de app zelf.** De MIDI-monitor meet nu alleen `performance.now() − timeStamp`.
   Toevoegen: p50/p99 van "tot geluid gepland" (zoals latentie.mjs) en een waarschuwing als de
   hoofdthread > 50% bezig is. Kosten: klein. Baten: Clay ziet op het apparaat wat ik hier alleen kan
   nabootsen, en we zien welke rij of welk paneel de boosdoener is.
5. **De hub-meting beter.** De nep-APC in een eigen proces (of de echte hub met rtmidi en een virtuele
   poort) en de klok via de hub zelf; dan is "wat voegt de hub toe bij 960 berichten/s" te beantwoorden.
   Kosten: een halve dag. Baten: zekerheid over de hub als bron van lag.
6. **Endless-knoppen zonder verloren eerste tik** — als op het apparaat blijkt dat de APC zijn interne
   stand NIET aan de ring gelijkzet: de laatste fysieke stand per knop bewaren over een focus- of
   mapjewissel heen. Kosten: klein. Baten: geen "dode" eerste tik na elke focuswissel.

## Vragen voor Clay

- C1: Wat zegt het MIDI-paneel bij "latency: … in + … audio" op de Mac met de Scarlett? Boven ~15 ms
  audio is het de uitgang, niet de code.
- C2: Waar voelde het laggy: de fader (geluid), het scherm dat achterloopt, de lampjes op de APC, of
  knoppen die soms niets deden? Dat laatste past precies bij het echofilter dat nu weg is.
- C3: Na een avond spelen: `midi.status().echoes` in de console. 0 → het filter mag voor de APC uit.
- C4: Mag ik (of het uitvoer-spoor) de LED-tik ombouwen (optie 1)? Die raakt feedback.js.

## Tests

`node test/alles.mjs` op de tak (met `VARVE_HUB_REPO` naar een kopie van de hub): 95 bestanden,
8846 checks, 3 rood — precies de drie die in deze container ook op main rood zijn (omgeving):
renderblok "keylock met wissels … bytes per bericht", instrumenten-fm-schaal "geen afval per blok",
wachtrij "yt-dlp en zijn kind zijn allebei weg" (2×). Nieuw groen: `test/invoer.test.mjs`, en de
extra checks in `test/mapping.test.mjs` en `test/midi.test.mjs`.

## Review ronde 1 (14 okt)

**Blokkerend: een herhaalde melding lichtte maar één keer op.** Klopte. `remove('flits')` en de
klasse er in een `requestAnimationFrame` weer op start de CSS-animatie niet opnieuw: tussen de taak
en die rAF rekent Chrome geen stijl, dus de klasse is voor de stijlberekening nooit weg geweest.
Nu wisselt `meld()` om de beurt twee klassen (`flits`, `flits2`) met elk een eigen, gelijke
keyframes-naam (`melding-flits`, `melding-flits2`): een andere `animation-name` is voor Chrome een
nieuwe animatie, bij de eerstvolgende stijlberekening, zonder dat wij die afdwingen en zonder rAF
(werkt dus ook als het beeld stilstaat). Nieuwe gedragscheck `tools/headless/meldingen.mjs` (echte
mixer, `?vormen=0`, zes herhalingen met 500 ms ertussen, animationstart geteld; plus een teller op
offsetWidth/clientWidth/getBoundingClientRect/getComputedStyle tijdens `meld()`):

```
VARVE_CHROME=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell node tools/headless/meldingen.mjs
```

| code | info: oplichten | fout: oplichten | opmaak gelezen in meld() |
|---|---|---|---|
| vóór 7e178ff (offsetWidth) | 6 van 6 | 6 van 6 | **1** (FAIL) |
| 7e178ff (klasse eraf, rAF erop) | **1 van 6** (FAIL) | **1 van 6** (FAIL) | 0 |
| nu (twee namen om de beurt) | 6 van 6 | 6 van 6 | 0 |

Ter vergelijking meet het hulpmiddel ook de twee oude vormen op een los element (rAF 1 van 6,
offsetWidth 6 van 6): zo is te zien dat de meting zelf onderscheid maakt.

Kleine punten:
- Echofilter alleen voor CC, ook voor andere apparaten: één zin erbij in midi.js en APC40.md
  (een apparaat dat noten terugkaatst zou nu een druk dubbel geven; geen bekend apparaat in Clay's set).
- "Een gemist loslaten = een kill of bend die blijft hangen": niet aangetoond, aangepast in het
  verslag, het midi.js-commentaar en APC40.md. Het gemeten effect is een druk die wegvalt (13%) op
  knipperende knoppen.
- "Tot scherm": niet als verbetering geclaimd (zie de opmerking onder de tabel).
- `zetTekst`: `undefined`/`null` wordt nu leeg en een getal tekst, zoals `textContent`; check in
  `test/invoer.test.mjs`.
- `test/invoer.test.mjs` is voor een groot deel regex op de broncode en dus broos bij een andere naam.
  Laten staan (hij vangt het terugkomen van een brede `:has()` of `offsetWidth` goedkoop), maar het
  gedrag zelf toetsen rijen.mjs, latentie.mjs, meldingen.mjs en de spiegel-/mapping-tests. Een
  gedragstest in Node voor de CSS-specificiteit zou een CSS-parser vragen (een dependency): niet gedaan.

Na review ronde 1 opnieuw: `node test/alles.mjs` (met `VARVE_HUB_REPO` naar de hub-kopie): 95 bestanden,
8847 checks (één erbij: zetTekst), 3 rood, dezelfde drie als op main in deze container.
`node tools/headless/meldingen.mjs`: 5 van 5 groen.
