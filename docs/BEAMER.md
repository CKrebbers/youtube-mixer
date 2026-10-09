# Beamer: mengen in het losse venster (ROADMAP 18)

25 september 2026. Uit `docs/VERBETERINGEN.md` ronde 3, "Video".

## Het probleem

Het losse venster (`video.html`) toonde het canvas van het hoofdvenster via
`captureStream`. Ga je in het hoofdvenster naar een ander tabblad (of
minimaliseer je het), dan zet Chrome daar `requestAnimationFrame` stil en
decodeert het geen `<video>` meer. Er wordt dan niets meer getekend en de beamer
bevriest, terwijl de muziek doorspeelt. Een video-opname bevriest om dezelfde
reden.

Nagebouwd in headless Chrome, met de oude code (`main`, `cc527e3`): het blok
in het testbeeld staat op 495 px en blijft daar staan, en de twee
schermafdrukken zijn bit voor bit gelijk.

## De oplossing

Zodra het losse venster open is, **mengt het zelf**. Het heeft eigen `<video>`'s
in zijn eigen document, een eigen WebGL-canvas en een eigen animatielus. Het
losse venster staat op de beamer en is dus zichtbaar. Zijn lus blijft lopen, en
zijn video's worden gedecodeerd, ook als het hoofdtabblad verborgen is.

- Het venster is same-origin (`window.open`), en de twee delen één thread. Het
  leest de engine van het hoofdvenster daarom rechtstreeks: `window.opener.varveBeamer`
  met `engine`, `videoMixer` en een paar functies. Er gaan geen berichten heen en weer.
  Timers in een verborgen tabblad worden geknepen, dus daar zou elk bericht op wachten.
- **Regel 1**: het losse venster leest alleen. Knoppen, mengvorm, puls,
  passend/vullen, de video per track en de beeldlagen neemt het elk beeld over van de mixer
  in het hoofdvenster (`VideoMixer.neemOver`). Die mixer blijft de enige die op de
  action-bus zit (`bindVideo`). APC, toetsenbord en muis werken dus
  onveranderd.
- **Regel 3**: posities komen van de audioklok van het hoofdvenster
  (`engine.deck(id).position`, `ctx.outputLatency + baseLatency`). De video blijft
  slaaf van de audio via dezelfde `synchroniseer()` in `volg.js`.

Bestanden:

| bestand | wat |
|---|---|
| `src/video/beamer.js` | puur: `wieMengt()`, `inloopStap()`, `Beamer` (aanmelden, afmelden, dicht of verborgen gevonden, inloop, bron van de opname) |
| `src/video/beamer-venster.js` | het losse venster: mixer maken, aanmelden, elk beeld `neemOver` + `teken` (of tijdens de inloop `loopIn`) |
| `video.html` | alleen nog een canvas en het hulpje; de module doet de rest |
| `src/video/video-mixer.js` | `neemOver(hoofd)`, `bron(id)`, `maakVideo`, `onFout`, `beelden`, `loopIn()`, `toonBeeld(canvas)` |
| `src/video/eindbeeld.js` | puur: de noodknoppen (zwart, bevriezen, master, flits) en hun klok, zie "Noodknoppen" |
| `src/video/volg.js` | `inDePas()`: lopen de zichtbare video's in de pas (voor het einde van de inloop) |
| `src/ui/video-paneel.js` | `window.varveBeamer` (via app.js), wie er mengt, het voorbeeld in het paneel |

## Wie mengt er

| los venster | paneel | video-opname | hoofdvenster mengt | los venster mengt | paneel toont |
|---|---|---|---|---|---|
| dicht | open | – | ja | – | eigen canvas |
| open | open | – | **nee** | ja | beeld van het losse venster (`captureStream`) |
| open | dicht | – | nee | ja | – |
| open | – | uit het losse venster | nee | ja | beeld van het losse venster |
| open | open | uit het hoofdvenster | ja | ja | eigen canvas |
| open maar geminimaliseerd | open | – | ja | nee (zijn lus staat stil) | eigen canvas |
| net open of terug, **inloop** | open of dicht | – of uit het losse venster | ja, en zet zijn beeld op het losse canvas | nee, stuurt alleen zijn eigen video's bij | eigen canvas |

Er wordt dus **één keer gemengd**. Het paneel laat het beeld van het losse
venster zien via `captureStream`, net als het losse venster vroeger dat van het
hoofdvenster. Dat kost hetzelfde als vroeger. Als het hoofdtabblad verborgen
is, gaat die stream uit (`visibilitychange`).

Eén uitzondering mengt twee keer: een video-opname die begon toen het
hoofdvenster mengde, en daarna gaat het losse venster open. Een MediaRecorder
kan niet van bron wisselen. Die opname neemt daarom het hoofdcanvas op tot je
hem stopt, en het losse venster mengt voor de beamer. Daarna mengt weer alleen
het losse venster.

De tweede uitzondering is de inloop (hieronder): de eerste seconden nadat het
losse venster opengaat, mengt het hoofdvenster nog, tot de video's van het
losse venster in de pas lopen.

## Inloop: de eerste seconden na het openen

Het losse venster heeft eigen `<video>`'s. Die moeten eerst laden en naar de plek
van het geluid springen. Met acht tracks tegelijk duurde dat seconden. Al die tijd
ontbraken er tracks op de beamer, of liepen ze 1 tot 5,7 s naast het geluid
(controleur, bevinding 4).

**Oplossing.** Mengde het hoofdvenster net nog? Dan blijft het mengen. Direct na elk
beeld zet het dat beeld ook op het canvas van het losse venster
(`VideoMixer.toonBeeld`). Het losse venster stuurt ondertussen zijn eigen video's
bij en uploadt ze, maar mengt niets (`VideoMixer.loopIn`). Het neemt het mengen
over zodra alle zichtbare video's in de pas lopen, en dat 0,3 s lang blijven doen
(`inDePas`, volg.js). In de pas betekent: beeld binnen, niet aan het springen, hooguit
50 ms naast wat je hoort. Na 20 s neemt het losse venster het hoe dan ook over
(`INLOOP_MAX`). Een video met een fout telt niet mee. Het beeld op de beamer wisselt
dan van bron, maar niet van inhoud.

- **Wanneer.** Bij aanmelden: openen, of herladen van een van beide vensters. En
  wanneer een verborgen los venster weer zichtbaar wordt, want zijn video's stonden
  stil. Alleen als het hoofdvenster op dat moment mengde. Met het paneel dicht mengde
  het niet: dan staan zijn video's stil op een oude plek, en is zijn beeld niet beter.
- **Hoofdtabblad verborgen: meteen zelf mengen.** Een verborgen tabblad heeft geen
  animatielus en decodeert geen video. Er is dan geen beeld om te lenen. Wordt het
  hoofdtabblad verborgen tijdens de inloop, dan neemt het losse venster meteen over.
  Zijn video's lopen dan nog in, dus de eerste seconden kan het beeld naast het
  geluid lopen, net als vóór de inloop.
- **Twee keer mengen, alleen tijdens de inloop.** Het hoofdvenster mengt dan, en het
  losse venster decodeert zijn eigen video's. Bij acht tracks zijn dat zestien video's
  tegelijk. Daarna mengt weer één venster.
- **Video-opname.** Op het losse canvas staat altijd het goede beeld, ook tijdens de
  inloop. Een opname die dan start, neemt daarom het losse canvas. Daarna loopt die
  opname gewoon door.
- **Waarom geen stream en geen eigen lus.** Eerst toonde het losse venster het
  hoofdcanvas via `captureStream` in een `<video>`. Onder belasting liep dat beeld
  steeds verder achter, tot 2,9 s. Daarna las het losse venster het hoofdcanvas in
  zijn eigen lus. Dat gaf een leeg beeld: een WebGL-canvas zonder
  `preserveDrawingBuffer` is leeg zodra het getoond is. Nu uploadt het hoofdvenster
  zijn canvas in dezelfde taak waarin het tekent. Dat kan, want beide vensters
  draaien op dezelfde thread.
- **Uploaden tijdens de inloop.** Een `<video>` die niemand uitleest, krijgt in
  Chrome geen vers beeld. Zonder upload was het eerste eigen beeld na de overname
  200–400 ms oud. `teken()` en `loopIn()` delen daarom één lus (`_bijwerken`).

### De inloop bleef hangen: `seekDuur` mat de verkeerde sprong

Onder zware belasting kwamen de eigen video's in 20 s niet in de pas. Het spoor
(`VARVE_BEAMER_SPOOR=1`) liet zien waarom. De mixer houdt per video bij hoe lang een
sprong duurt (`seekDuur`), en springt zoveel verder vooruit. Die tijd werd gemeten tot
het `seeked`-event. Dat event is een taak, en onder belasting kwam het pas ná het
volgende beeld. Sprong de mixer in dat beeld opnieuw, omdat de vorige sprong te laat
landde, dan hoorde het event bij de vorige sprong. De nieuwe sprong telde dan als 0 s.
`seekDuur` zakte zo naar 0,00–0,04 s, terwijl sprongen 0,8–1,7 s duurden. Elke sprong
landde daardoor een seconde te laat, en de video bleef springen.

Nu meet `_volg` tot het eerste beeld waarin `seeking` weer false is. Tijd waarin de
mixer niet tekende, of waarin de track niet te zien was, telt niet mee. Dit geldt ook
voor het hoofdvenster, bijvoorbeeld bij hotcues onder belasting. `video.test.mjs`
bootst het na, met sprongen van 0,8 s en een `seeked` dat een beeld te laat komt. Op
de oude code faalt die test: de video komt nooit in de pas.

### Gemeten

Headless (`VARVE_BEAMER_DEEL=inloop`), acht tracks met elk een blok op een eigen rij,
mengvorm "licht", alle faders open. Per beeld wordt gemeten wat er op het losse canvas
komt, direct na het tekenen. Per track staat daar hoe ver het beeld van het geluid af
zit. Rijen die omgedraaid of verwisseld zijn, geven hier fouten van seconden: de
tracks spelen elk op een andere plek.

| code | belasting (load, 8 kernen) | beelden waarin een track ontbrak | grootste fout | eigen mengen vanaf |
|---|---|---|---|---|
| vóór (`spoor2/beamer-c`) | ~130 | 359 van 1090, de eerste ~8,5 s | 136 ms | meteen |
| vóór, eerdere meting (rAF) | 10–35 | alle beelden in de eerste 6,5 s | 202 ms | meteen |
| inloop, zonder de `seekDuur`-fix | 100–200 | 0 tijdens de inloop, daarna 259 van 804 | 151 ms | 19 s (time-out) |
| **na** | 14–28 | **0 van 1045** | **94 ms** | 8,0 s |
| **na** | 40–90 | **0 van 988** | 127 ms (één beeld na een hapering van 100 ms) | 9,4 s |

Het paneel zelf (de maatstaf, in dezelfde meting) haalt 48–84 ms. Bij 30 fps is één
beeld 33 ms, en de meting telt ook de uitgangsvertraging mee. De grens in de test is
150 ms (`SPRING_VANAF`).

## Video-opname

Een nieuwe video-opname neemt het canvas van het losse venster als dat mengt of
inloopt (`Beamer.opnameCanvas`), en anders het eigen canvas. Het geluid blijft de tap
op de master in het hoofdvenster. Gemeten met het hoofdtabblad 2,5 s verborgen
tijdens de opname: 54–55 beelden op 4 fps uit de mp4, en het beeld stond nergens langer dan één zo'n beeld (0,25 s) stil.

Een VERBORGEN los venster (geminimaliseerd, of op hetzelfde scherm helemaal
achter het hoofdvenster: macOS meldt dat als verborgen) mengt niet, want zijn
lus staat stil. Een opname die dan start neemt het eigen canvas (controleur,
25 sep: eerst nam hij het stilstaande canvas van het losse venster). Wordt het
losse venster pas TIJDENS zijn eigen opname verborgen, dan staat het beeld in
die opname stil tot het weer zichtbaar is. Op een beamer op een tweede scherm
gebeurt dat niet.

Gaat het losse venster dicht tijdens zijn eigen opname, dan staat het beeld in
die opname vanaf dan stil. Het geluid loopt door. Daarom:

- vraagt het losse venster eerst om bevestiging (`beforeunload`);
- zet het hoofdvenster een foutmelding in de strook ("stop de opname en start een nieuwe").

## Herladen en sluiten

- **Los venster herladen**: `pagehide` meldt het af. Het nieuwe document meldt
  zich weer aan en haalt de video's opnieuw op. Getest.
- **Hoofdvenster herladen**: `varveBeamer` is even weg. Het laatste beeld blijft
  staan, zonder tekst voor de zaal, en de video's pauzeren. Daarna meldt het
  losse venster zich bij de nieuwe app aan, en `neemOver` brengt de nieuwe engine
  mee. De oude video's gaan weg, want de nieuwe app heeft nog niets geladen. Getest.
- **Hoofdvenster na herladen**: de knop "los venster" focust het aangemelde venster.
  `window.open` met dezelfde naam zou het herladen.
- **Los venster dicht**: het hoofdvenster merkt het via `pagehide`, of via
  `closed` na een crash, en mengt het paneel weer zelf. Getest.
- **Hoofdvenster dicht**: het losse venster zegt "de app is dicht".
- **Los venster geminimaliseerd**: dan staat zijn lus stil. Het hoofdvenster ziet
  `document.hidden` en mengt het paneel weer zelf. Getest.

## Vormlagen (`?vormen=1`)

Het losse venster gebruikt DEZELFDE beeldlaag-objecten als het hoofdvenster:
`neemOver` neemt `beeldlagen` over. Er rekent dus één vorm, voor wie er mengt.
De lagenstap (programma, doek, texturen) wordt ook in het losse venster pas
gebouwd bij de eerste laag.

- **Worker-modus**: de Worker hoort bij het hoofdvenster. Hij levert ook door
  als dat verborgen is: gemeten 115–155 vormbeelden in ~2,3 s verborgen.
- Een ImageBitmap, OffscreenCanvas of canvas uit het hoofdvenster uploaden naar de WebGL van
  het losse venster werkt: dezelfde isolate, gemeten in de proef.
- **Reageren op de mix**: de luisteraar leest de master-analyser van het
  hoofdvenster, vanuit de lus van het losse venster.

## Noodknoppen: zwart, bevriezen, master, flits (A4, 2 okt)

Basisgereedschap voor de beamer: "zwart moet altijd kunnen". Op de bus
(`bindVideo`), zodat scherm, APC en het handelingenlog ze kennen:

| action | soort | wat |
|---|---|---|
| `video.black` | trigger (schakelaar) | zwart met een lineaire fade van 250 ms (`ZWART_FADE`), uit even snel terug |
| `video.black.hold` | trigger | zwart zolang je drukt, DIRECT; loslaten = direct terug naar wat de schakelaar zegt |
| `video.freeze` | trigger (schakelaar) | het eerste beeld na het indrukken blijft staan; de video's lopen door |
| `video.master` | value 0..1 | helderheid van het eindbeeld, standaard 1; 0 = zwart |
| `video.flash` | trigger | wit, kwadratisch uitdovend in 300 ms (`FLITS_DUUR`) |

**Waar**: in de LAATSTE stap (tonen), `src/video/eindbeeld.js` rekent, de
toonshader doet `mix(beeld, wit, flits) × master × (1 − zwart)`. Zo zien de zaal,
het losse venster en een video-opname (MediaRecorder op het canvas van wie mengt)
hetzelfde, en onthouden de sporen er niets van (die lezen het eindbeeld vóór de
toonstap). Zwart wint van alles, ook van een flits; helemaal zwart is precies 0.

**Bevriezen**: de mixer slaat mengen, lagen en effecten over en toont het
laatste eindbeeld (`eind[1 − beurt]`) elk beeld opnieuw (zonder
`preserveDrawingBuffer` is het canvas na elk getoond beeld leeg). De video's
worden intussen bijgestuurd en geüpload, dus loslaten geeft meteen het beeld van
nu. Alleen een eindbeeld van NA het indrukken telt (`laatsteEindMs >=
bevrorenSinds`): een mixer die toen niet mengde (het andere venster deed het)
maakt eerst één vers beeld en houdt dat vast, in plaats van een oud beeld of een
leeg canvas te tonen.

**De klok**: `performance.timeOrigin + performance.now()` (`wandklok`). Niet de
audioklok: die staat stil zolang de AudioContext niet loopt, en een fade op een
stilstaande klok wordt nooit klaar. Absoluut, omdat het losse venster een eigen
`performance.now()` met een ander nulpunt heeft: zo rekenen beide vensters met
dezelfde overgangen. Een verborgen tabblad houdt deze klok bij.

**Het losse venster**: `neemOver` kopieert de stand (`Eindbeeld.neemOver`), elk
beeld. Een fade die het hoofdvenster begon loopt in het losse venster af, ook als
het hoofdtabblad verborgen is. Tijdens de INLOOP zet het hoofdvenster zijn canvas
op het losse (`toonBeeld`): daar zitten zwart, master en flits al in, dus
`toonBeeld` zet de toonshader op neutraal (helder 1, flits 0).

**Handelingenlog**: zwart en bevriezen staan als stand in de beginstand
(`RONDLOPERS`), de master als waarde; de drukvariant en de flits niet (een
gebaar, geen stand). Een log van vóór A4 begint met zwart en bevriezen uit.

**Op het scherm**: rij BEELD onder de video-effecten: MASTER-knop, zwart (shift +
vasthouden = de drukvariant), bevries, flits; de knoppen lezen hun stand terug.
Geen sneltoets: elke letter en elk cijfer is al bezet (V is keylock; het paneel opent met de knop video).

Gemeten: `node test/video.test.mjs` (38 checks, symbolische WebGL) en
`node tools/headless/noodknoppen.mjs` (31 controles, echte pixels in headless
Chromium 141 met swiftshader, hoofdvenster én video.html; de rij past op 1440 × 790,
kolomfader 81 px, gelijk aan wat 649b555 met het videopaneel open mat). Fade per beeld:
255 · 230 · 191 · 128 · 64 · 26 · 1 · 0 op 0 · 25 · 62,5 · 125 · 187,5 · 225 ·
249 · 250 ms; flits 255 · 207 · 143 · 64 · 16 · 3 · 0 op 0 · 30 · 75 · 150 · 225 ·
270 · 299 ms. Niet gemeten: in een video-opname (de mp4) en met het
hoofdtabblad echt verborgen (vraagt Chrome for Testing met `--headless=new`,
zoals `beamer.mjs`).

## requestVideoFrameCallback: gemeten, NIET gebruikt

Ronde 3 vroeg om rVFC te gebruiken als dat de synchronisatie meetbaar beter
maakt. Gemeten met het testbeeld: een wit blok schuift met 200 px/s. Na elke
`teken()` wordt de middelste rij van het canvas gelezen. Uit de plek van het blok volgt welk beeld
er ECHT op het canvas staat. Dat is vergeleken met wat je op dat moment hoort
(deckpositie min uitgangsvertraging). Het losse venster draaide op 60 fps, de
video is 30 fps.

| meting (headless Chrome 153, Metal) | uitkomst |
|---|---|
| beeld op canvas min gehoord, sturen op `currentTime` (zoals nu), 8 metingen | gem. −6,5 … +5,8 ms, \|fout\| 8,3–11,5 ms |
| idem, sturen op rVFC (`mediaTime`, integrerend, eerste versie), 2 metingen | gem. +8,2 … +8,7 ms, \|fout\| 11,5–12,2 ms (steeds slechter dan de meting ernaast zonder: 8,3 en 8,4) |
| rVFC `mediaTime` min het beeld op het canvas | meestal −8,8 … −13,2 ms, één keer +2,5: niet eens stabiel |
| `video.currentTime` min het beeld op het canvas | −5,9 … +6,6 ms |

Bij 30 fps is 8,3 ms het minimum voor de gemiddelde |fout|: een beeld staat
33 ms, dus de fout is gelijk verdeeld over ±16,7 ms. Sturen op `currentTime`
zit daar al op. De uitschieters tot 11,5 ms kwamen vermoedelijk door de belasting:
de machine had tijdens de metingen een load van 10 tot 37 op 8 kernen. Dat is niet apart gemeten.

rVFC meldt het beeld dat de compositor had. Maar een `<video>` buiten het DOM die
we met `texImage2D` uploaden, geeft op dat moment een NIEUWER beeld. Sturen op rVFC
schoof het beeld daardoor ~10 ms te ver vooruit. Besluit: niet gebruiken. De
meting staat in `tools/headless/beamer.mjs` (eigen rVFC-waarnemer, zonder
app-code), zodat hij te herhalen is.

Niet gemeten: de tijd tussen tekenen en het echte scherm. In headless is
`expectedDisplayTime − nu` ≈ 0; op een echte 60 Hz-beamer is dat waarschijnlijk
16–33 ms. Dat is een AANNAME. Meten kan alleen met een camera die het scherm en een
klik tegelijk opneemt. Pas daarna kan er een vaste voorsprong bij.

## Foutmelding als de video ontbreekt of niet laadt

- `error` op een `<video>` gaat naar een foutmelding in de strook, bijvoorbeeld:
  "video van track 1 (kwarten): het bestand ontbreekt of het formaat wordt niet
  ondersteund". Een 404 geeft code 4. Getest door `video.mp4` van schijf te halen.
- Zichtbaar en na 10 s nog geen beeld (`LAAD_GEDULD`, `fouten.js`): "na 10 s nog geen beeld".
  Alleen tijd waarin deze mixer ook TEKENT telt: stond hij meer dan 1 s stil
  (tabblad verborgen, het andere venster mengde), dan begint de teller opnieuw.
- Eén melding per bron. Het losse venster meldt via het hoofdvenster, want de beamer
  toont geen tekst voor de zaal. Melden twee mixers dezelfde fout, dan staat die
  één keer in de strook (`meld()` stapelt geen gelijke fouten).
- Een nummer zonder video (alleen audio) is geen fout en geeft geen melding.

## Testen

- `node test/video.test.mjs`: wie er mengt (alle rijen van de tabel),
  aanmelden, afmelden, crash, verborgen, bron van de opname, `neemOver` (eigen
  `<video>`, dezelfde bron, dezelfde beeldlagen, nieuwe engine na herladen) en de
  foutteksten. Nep-WebGL en nep-`<video>`, geen browser.
- `VARVE_KIJK_POORT=8865 VARVE_KIJK_DEBUG=9465 node tools/headless/beamer.mjs [uitmap]`:
  - Chrome for Testing met `--headless=new` en WebGL op Metal. Met swiftshader
    haalde de mixer op een drukke machine 1 beeld per seconde.
  - Eigen server en tijdelijke library. Het testnummer gaat door de echte
    upload en ingest.
  - MIDI gaat eruit vóór elke pagina (`Target.setAutoAttach`, pagina's wachten).
  - Het hoofdtabblad wordt verborgen met een tweede tabblad in hetzelfde venster
    dat naar voren komt. Daarna staat `document.visibilityState` op 'hidden' en
    staat de rAF stil, zoals bij Clay.
  - Acht tracks met video (elk een blok op een eigen rij), voor de inloop.
    `VARVE_BEAMER_DEEL=inloop` draait alleen dat deel.
  - Uitkomst: 46 controles groen. Zie de tabel hieronder.
  - `VARVE_WORTEL=<export van oude code>` draait alleen de beeldcontrole. Op
    `main` faalt die: blok 495 → 495 px.

| controle | uitkomst |
|---|---|
| los venster mengt, hoofdvenster niet | 60–64 beelden/s tegen 0 |
| verborgen: het blok schuift | 434–480 px in ~2,3 s |
| sync verborgen | gem. −0,8 … +5,8 ms, \|8,4–9,8\| ms |
| opname | loopt door |
| herladen | beide kanten |
| geminimaliseerd | het paneel neemt het over |
| video ontbreekt | foutmelding |
| inloop, acht tracks: elke track in elk beeld | 0 van 1045 beelden missen er een |
| inloop: elk beeld binnen 150 ms | grootste 94 ms (paneel 48–58) |
| overname, daarna één keer mengen | na 8,0 s; hoofd 0, los 60 beelden/s |
| geminimaliseerd, weer terug | loopt in, neemt het over na 0,5 s (één video) |

## Niet getest

- In Clay's echte Chrome, met een echte beamer op een tweede scherm.
- Volledig scherm (dubbelklik), langer dan een minuut verborgen, en Chrome's
  "intensive throttling" na 5 min. De lus van het losse venster hangt niet af van
  timers in het hoofdvenster, maar dit is niet gemeten.
- De inloop op Clay's M1 zonder andere belasting. Hier liep de load tijdens de metingen
  van 14 tot 250 op 8 kernen. Hoe lang de inloop daar duurt, is dus niet gemeten.
- Wat zestien video's tegelijk tijdens de inloop kosten, op zijn machine en met echte
  YouTube-video's: 720p, sleutelbeeld per 8,3 s.
- Herladen en terughalen van een geminimaliseerd los venster met acht tracks. Met één
  video is het getest.
- De vertraging tussen canvas en scherm (zie hierboven).
- `beforeunload` in het losse venster tijdens een opname. Chrome toont die
  vraag alleen na een klik in dat venster.
