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

Vóór = `339310b` (de basis van deze tak; `studio/afmaken` is intussen verder), na = deze tak.
Eerst wat bij herhalen exact terugkomt (threadtijd, tellingen, benches); de wandklok-latentie
daarna, als bereik over 8 rondes, want die schommelt met de belasting van de machine.

1. **Een MIDI-bericht kost zelf weinig; het WACHT.** Een faderbericht doet ~0,2 ms werk (parse,
   mapping, bus, engine, AudioParam). Maar het moet wachten tot de hoofdthread klaar is met de
   rest, en die was in rust (acht tracks spelend, rijen open) **~75% van de tijd bezig**.
2. **Hoofdthread in threadtijd** (CDP, telt andere processen niet mee; 8 rondes, mediaan
   [min–max]): stijlberekening in rust **180 [166–189] → 33 [29–34] ms/s**, de hele hoofdthread
   **751 [714–794] → 467 [428–485] ms/s**; bij de fader-sweep stijl **172 → 23**, taak **819 → 623**.
   De reviewer kreeg in rust 185 → 33 en 765 → 478. Oorzaak: brede `:has()`-regels in styles.css
   (`body:has(#rijen > section:not(.hidden)) .kol .spg-pad` en negen andere): elke tekstwissel (elk
   beeld: tijden, bpm) liet Chrome ~**256 elementen per beeld** opnieuw stylen (trace: "Affected by
   :has()"). Nu klassen.
3. **Een echte fout op de controller: het echofilter slikte drukken** (synthetisch,
   `tools/bench/echo.mjs`: een nep-hand op Sends met een loop op 124 bpm). Op een knop die knippert
   viel **13% van de drukken en 12% van het loslaten** weg (519 en 480 van 4000; de reviewer kreeg
   exact dezelfde tellingen); nu **0**. Dat een kill of bend daardoor bleef hangen is niet
   aangetoond: hun lampje staat nooit op 0 of 127.
4. **Werk IN het bericht bij shift en mapjes** (schermwerk naar het volgende beeld), p99 over 8
   rondes: shift **6,0 [5,1–6,6] → 1,4 [0,9–1,6] ms**, mapje wisselen **6,5 [5,9–7,2] → 2,8
   [1,5–3,8] ms**; de bereiken raken elkaar niet. Zonder browser (`tools/bench/invoer.mjs`): de
   mapping per LED-tik **~290 → ~8 µs** (285 → 8,1 en, bij herhalen in review ronde 1, 307 → 7,7), per
   faderbericht 1,8 → 0,6 µs (1,7 → 0,7).
5. **Wandklok, van bericht tot het geluid gepland is** (8 rondes, met jitter op het rooster, zie
   "Review ronde 1, tweede herstel"), mediaan [min–max] per ronde:
   - één fader (120/s): p50 **4,2 [3,0–6,3] → 0,8 [0,3–1,3] ms**, p99 **17,9 [13,3–53,4] → 11,3
     [9,8–12,5] ms**: geen overlap. De reviewer (6 rondes, vast rooster) kreeg p50 ~2,6 → ~1,4 en
     p99 ~17 → ~11,4. De richting is zeker, **de factor op p50 niet** (hangt van het meten af); p99
     **~17 → ~11 ms** kwam bij allebei terug.
   - acht faders (sweep, 960/s): p50 4,6 → 2,2 ms (geen overlap), maar **p99 18,8 → 14,1 met
     overlappende bereiken [16,1–22,4] en [12,3–22,5]: NIET aangetoond** (bij de reviewer ook niet).
   - shift met een fader erdoor: p99 37,6 → 25,5 hier zonder overlap, maar bij de reviewer (vast
     rooster) gelijk (34,7 → 37,4): **niet eenduidig**.
   De eerste versie van dit verslag noemde fader 7,4 / 37,6 → 1,9 / 11,9 en sweep-p99 40,6 → 18,3.
   Die getallen (3 rondes, vast rooster, belasting tot 8,7) waren niet te herhalen en zijn vervangen.

## Hoe gemeten (herhaalbaar)

Vier instrumenten, alle vier nieuw in deze tak:

- `tools/headless/latentie.mjs` — de echte mixer in headless Chrome. `navigator.requestMIDIAccess`
  is nep vóór de pagina laadt (één invoer- en uitvoerpoort "APC40 mkII"); de mixer kiest die
  zelf, dus elk bericht gaat door het ECHTE pad: `onmidimessage → MidiHub._onMessage → monitor →
  onInput → mapping.handle → invoke → engine` plus spiegel en wat er verder per bericht gebeurt.
  De berichten komen uit een Worker op hun eigen tijd (Atomics.wait), elk als eigen taak, zoals
  Chrome MIDI aflevert; hun `timeStamp` is het moment van versturen. Wanneer welk bericht gaat staat in
  `tools/headless/latentie-plan.mjs`: met jitter uit een vast zaad (`--zaad`), zodat de fase ten opzichte van
  rAF niet een hele ronde vastzit (review ronde 1). Acht tracks met de demotrack
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

Commando's (de vóór-versie is de basiscommit van deze tak: `git archive 339310b | tar -x -C $VOOR`;
NIET de huidige `studio/afmaken`, die is intussen verder):

```sh
# headless, vóór en na om de beurt, 8 rondes, de volgorde wisselt per ronde, zaad = ronde (zo is de
# tabel hieronder gemaakt; ~17 min). Hetzelfde zaad = exact hetzelfde berichtenplan voor vóór en na.
export VARVE_CHROME=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell VARVE_TMP=<tmp>
for r in 1 2 3 4 5 6 7 8; do
  VARVE_WORTEL=$VOOR node tools/headless/latentie.mjs --label voor --duur 5000 --zaad $r --uit voor-$r.json
  node tools/headless/latentie.mjs --label na --duur 5000 --zaad $r --uit na-$r.json   # (even rondes: na eerst)
done
# mediaan van elk getal, en daaronder per maat mediaan [min–max] over de rondes met "(overlapt)":
node tools/headless/latentie.mjs --vergelijk voor-1.json,…,voor-8.json na-1.json,…,na-8.json
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
schommelen met de belasting van de machine (andere agenten draaiden tests); daarom acht rondes
om de beurt, en per getal het bereik over de rondes: alleen wat NIET overlapt noem ik een
verbetering. Threadtijden (taak, stijl, opmaak) zijn daar ongevoelig voor.

## Nulmeting en nameting

Vóór = `339310b`, na = deze tak. 8 rondes van 5 s per scenario, vóór en na om de beurt (de
volgorde wisselt per ronde), zaad = ronde, jitter aan (review ronde 1, tweede herstel); belasting tijdens de rondes
0,9–3,6. Per maat de **mediaan [min–max] over de 8 rondes** van de p50 en de p99 binnen een ronde;
**vet** = de bereiken van vóór en na raken elkaar niet. Tijden in ms; "hoofdthread" in ms
threadtijd per seconde. Uit `--vergelijk` (onderste tabel).

| scenario | maat | vóór p50 | na p50 | vóór p99 | na p99 |
|---|---|---|---|---|---|
| rust (pings 100/s) | wacht | 3,8 [2,7–4,4] | **0,3 [0,2–0,6]** | 16,3 [15,1–19,6] | **9,9 [8,9–11,7]** |
| | hoofdthread taak · stijl | 751 · 180 | **467 · 33** | | |
| fader (één, 120/s) | tot geluid gepland | 4,2 [3,0–6,3] | **0,8 [0,3–1,3]** | 17,9 [13,3–53,4] | **11,3 [9,8–12,5]** |
| | werk per bericht | 0,21 | 0,20 (overlapt) | 0,8 | 0,8 (overlapt) |
| | tot scherm | 11,2 | 11,1 (overlapt) | 22,5 | 20,8 (overlapt) |
| | hoofdthread taak · stijl | 790 · 180 | **525 · 31** | | |
| sweep (acht faders, 960/s) | tot geluid gepland | 4,6 [3,9–6,2] | **2,2 [1,1–3,1]** | 18,8 [16,1–22,4] | 14,1 [12,3–22,5] (overlapt) |
| | tot scherm | 11,8 | 11,3 (overlapt) | 25,6 | 22,9 (overlapt) |
| | hoofdthread taak · stijl | 819 · 172 | **623 · 23** | | |
| ringen (acht track knobs, 960/s) | tot geluid gepland | 5,2 [4,3–7,0] | **2,3 [1,7–3,4]** | 19,1 [16,5–26,1] | 14,4 [11,7–17,5] (overlapt) |
| device (acht device knobs, 960/s) | tot geluid gepland | 5,3 [3,8–6,0] | **1,6 [0,6–2,1]** | 18,4 [15,5–31,2] | **12,0 [10,3–13,4]** |
| xfader (120/s) | tot geluid gepland | 4,4 [3,0–7,6] | **0,6 [0,4–1,2]** | 18,1 [13,5–32,8] | **12,6 [10,6–13,4]** |
| pads (hotcues, 16/s) | tot geluid gepland | 4,9 [3,6–8,1] | 2,3 [0,7–3,9] (overlapt) | 19,2 [15,4–25,2] | 13,7 [10,5–21,1] (overlapt) |
| shift (8/s + een fader) | werk per bericht | 0,16 | 0,15 (overlapt) | 6,0 [5,1–6,6] | **1,4 [0,9–1,6]** |
| | tot geluid gepland | 9,6 [8,4–11,7] | **5,6 [3,7–6,6]** | 37,6 [32,1–154,5] | **25,5 [23,0–30,6]** |
| | tot scherm | 17,0 [15,7–20,4] | **13,7 [11,6–14,3]** | 58,0 [42,0–269,1] | **33,5 [28,6–39,5]** |
| | hoofdthread stijl | 250 | **91** | | |
| mapje (grid-modus 4/s + pads) | werk per bericht | 0,75 [0,50–0,80] | **0,12 [0,11–0,13]** | 6,5 [5,9–7,2] | **2,8 [1,5–3,8]** |
| | tot geluid gepland | 7,0 [4,9–9,6] | 5,6 [1,5–7,7] (overlapt) | 19,2 [12,2–33,8] | 14,4 [8,1–21,5] (overlapt) |

Wat ik daaruit wel en niet claim:
- **Wel**: threadtijd (overal, met grote marge), werk per bericht bij shift en mapjes, en de
  wachttijd in rust en bij één fader, crossfader en de device knobs (p50 én p99).
- **Niet**: de p99 van de sweep, de ringen, de pads en het mapje (bereiken overlappen); "tot scherm"
  bij fader en sweep (de reviewer kreeg hem ook niet terug). Shift wel hier, niet bij de reviewer
  met het vaste rooster (34,7 → 37,4): niet eenduidig.
- De p50-factor bij één fader (hier ~5×, bij de reviewer ~2×) hangt van het meten af; de p99
  ~17 → ~11 ms kwam bij allebei terug.

Via de echte hub (`--hub`, 6 rondes van 5 s, om de beurt, zaad = ronde, jitter aan; alleen fader, pads
en shift), tot geluid gepland, mediaan [min–max]: fader p50 **6,6 [3,8–8,1] → 1,2 [1,0–2,1]**, p99
**31,9 [29,6–37,0] → 11,4 [10,7–19,1]**; shift p50 **21,1 [18,9–28,2] → 6,8 [5,0–8,0]**, p99 **60,2
[49,9–70,7] → 33,7 [30,4–41,3]**; pads p50 5,5 → 2,0 en p99 26,9 → 15,1, maar beide overlappend.
Stijl op de hoofdthread 186 → 32 ms/s (fader). Commando: zoals hierboven met `--hub --scenario
fader,pads,shift`, `VARVE_HUB_REPO=<kopie van AV-app-hub MET node_modules>`, poorten
`VARVE_LAT_POORT=8847 VARVE_LAT_DEBUG=8848 VARVE_LAT_HUB=7741`. Sweep en ringen via de hub heb ik
niet opnieuw gemeten: daar draait de nep-APC in hetzelfde Node-proces als de hub en houdt de
afleverlus (960 berichten/s) een kern bezig; voor hoge snelheden via de hub is dit meetinstrument
niet goed genoeg (optie 5).

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

## Review ronde 1, tweede herstel (14 okt): de wandklok-getallen

**Blokkerend: de wandklok-koppen in "Kort" waren niet te herhalen op de grootte die er stond; de
p99 van de sweep helemaal niet.** Klopte. De reviewer draaide het commando zelf (6 rondes, vóór =
`339310b`) en kreeg sweep-p99 vóór 22,6–38,0 en na 17,1–33,4 (overlap), fader p50 ~2,6 → ~1,4 en
p99 ~17 → ~11,4 in plaats van 7,4 / 37,6 → 1,9 / 11,9. Wat ik deed:

1. **De oorzaak in het meetinstrument gerepareerd: jitter op het rooster.** De Worker verstuurde op
   een vast rooster (`i * 1000 / 120`): de fase ten opzichte van rAF bleef een hele ronde gelijk en de
   p50 per ronde sprong mee (identieke vóór-code gaf bij de reviewer fader-p50 0,45 en 5,28 ms). De
   plannen staan nu in `tools/headless/latentie-plan.mjs` (puur): elke reeks een eigen beginfase
   (0..1 beeld) en elk bericht een eigen verschuiving (een stroom 0..1 interval, knoppen 0..½), uit
   mulberry32 met een vast zaad (`--zaad`, standaard 1; `--jitter 0` = het oude rooster, bit voor
   bit). Zelfde zaad = exact hetzelfde plan, dus vóór en na krijgen in een ronde dezelfde berichten.
   Een eerste versie schoof elk bericht maar 0..½ interval: bij 120/s viel dat binnen een ronde op
   de helft van een beeld (de test hieronder ving het: twee lege achtsten); verbeterd vóór de meting.
   Effect, zichtbaar in de vóór-reeks: fader-p50 per ronde nu 3,0–6,3 ms (was 0,45–5,3 bij identieke
   code), p99 13,3–20,6 op één uitschieter na (53,4).
2. **Opnieuw gemeten: 8 rondes, vóór en na om de beurt, de volgorde wisselend, zaad = ronde**, met
   vóór = `339310b` (genoemd in "Kort" en bij de commando's). `--vergelijk` met meerdere rondes geeft
   nu onder de mediaan-tabel per maat ook mediaan [min–max] en "(overlapt)".
3. **"Kort" herschreven**: eerst wat exact terugkomt (threadtijd: stijl 180 → 33 en taak 751 → 467
   ms/s in rust, de reviewer 185 → 33 en 765 → 478; het echofilter 519/480 van 4000 → 0, bij de
   reviewer bit voor bit gelijk; werk per bericht bij shift en mapjes; de mapping-bench), daarna de
   wandklok als bereik. De sweep-p99 staat er expliciet als **niet aangetoond**; de fader-p99 als
   ~17 → ~11 ms met de cijfers van de reviewer erbij; shift als niet eenduidig.
4. **De oude tabel (3 rondes, vast rooster) is vervangen** door de tabel van 8 rondes met bereiken.
   De oude opmerking "device p99 na iets slechter (14,4 → 19,6)" is daarmee ook weg: met jitter is
   device p99 18,4 [15,5–31,2] → 12,0 [10,3–13,4], zonder overlap. Dat het oude getal ruis was, past
   daarbij, maar bewezen is het niet.

Check: `test/latentie-plan.test.mjs` (nieuw, 27 checks): zelfde zaad = zelfde plan en een ander
zaad andere tijden (alle 9 scenario's); zonder jitter het oude rooster bit voor bit (fader, pads);
met jitter per control dezelfde berichten in dezelfde volgorde; een loslaten vóór de volgende druk
(20 zaden); zonder jitter alle faderberichten op 0 of ½ beeld, met jitter in elk achtste van een
beeld ≥ 5%; de beginfase spreidt over > 10 ms van een beeld (16 zaden); latentie.mjs gebruikt de
module en schrijft zaad en jitter in de uitkomst.

Kleine punten:
- **CLAUDE.md en APC40.md**: bij "13% van de drukken / 12% van het loslaten" staat nu "synthetisch,
  `tools/bench/echo.mjs`: een nep-hand op Sends met een loop op 124 bpm; niet op het apparaat gemeten".
- **De bovenbalk gedragsmatig getoetst** (was alleen een regex): `tools/headless/meldingen.mjs`
  deel 3 laat een tekst in `.opname-groep` (een kleinkind van `.topbar-right`, naast de log-knop)
  groeien en eist dat de vervaging `meer` binnen 150 ms komt (de oude timer keek pas na 1 s), zonder
  resize-event, en weer weggaat als hij krimpt. Met de ResizeObserver tijdelijk uitgezet (alleen de
  timer, zoals vroeger) faalt die check: `{"meer":false,"past":false}`. Nu 8 van 8 groen.
- **Echofilter alleen voor CC, ook voor andere apparaten**: stond al in het verslag en in midi.js;
  een apparaat of MIDI-thru-lus die NOTEN terugkaatst, zou nu een druk met de LED-kleur als
  velocity geven (een mogelijke lus). Geen apparaat in Clay's set doet dat. Ongewijzigd.
- **Spiegel en mapje-balk bij het volgende beeld** (bekend, verwaarloosbaar, geen regelbreuk): klik
  je binnen ~16 ms na shift of een modusknop op de APC met de MUIS op een spiegelknop, dan pakt die
  de action van vóór de wissel; indrukken en loslaten blijven gepaard (controls.js onthoudt
  'ingedrukt'), er blijft niets hangen. In een verborgen tabblad wacht de uitleg van de mapje-balk
  in de rAF-rij en verschijnt hij bij terugkomen even met een oude wissel. Niet veranderd.
- Wat de reviewer nakeek en in orde vond (cache-invalidatie, loslaten naar de action van het
  indrukken, soft-takeover, wachtrij, log, engine en audiopad niet aangeraakt, specificiteit van de
  :has()-vervangers, geen mapping-JSON of action veranderd): niets aan gedaan.

Na dit herstel: `node test/alles.mjs` (met `VARVE_HUB_REPO` naar de hub-kopie): 96 bestanden, 8874 checks
(27 erbij: `test/latentie-plan.test.mjs`), 3 rood, dezelfde drie als op main in deze container
(renderblok "keylock met wissels … bytes per bericht", instrumenten-fm-schaal "geen afval per blok",
wachtrij "yt-dlp en zijn kind zijn allebei weg" 2×). `node tools/headless/meldingen.mjs`: 8 van 8 groen.
`node test/latentie-plan.test.mjs`, `invoer`, `mapping`, `midi`: groen.
