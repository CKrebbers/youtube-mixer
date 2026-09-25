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
| `src/video/beamer.js` | puur: `wieMengt()`, `Beamer` (aanmelden, afmelden, dicht of verborgen gevonden, bron van de opname) |
| `src/video/beamer-venster.js` | het losse venster: mixer maken, aanmelden, elk beeld `neemOver` + `teken` |
| `video.html` | alleen nog een canvas en het hulpje; de module doet de rest |
| `src/video/video-mixer.js` | `neemOver(hoofd)`, `bron(id)`, `maakVideo`, `onFout`, `beelden` |
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

Er wordt dus **één keer gemengd**. Het paneel laat het beeld van het losse
venster zien via `captureStream`, net als het losse venster vroeger dat van het
hoofdvenster. Dat kost hetzelfde als vroeger. Als het hoofdtabblad verborgen
is, gaat die stream uit (`visibilitychange`).

Eén uitzondering mengt twee keer: een video-opname die begon toen het
hoofdvenster mengde, en daarna gaat het losse venster open. Een MediaRecorder
kan niet van bron wisselen. Die opname neemt daarom het hoofdcanvas op tot je
hem stopt, en het losse venster mengt voor de beamer. Daarna mengt weer alleen
het losse venster.

## Video-opname

Een nieuwe video-opname neemt het canvas van het losse venster als dat mengt
(`Beamer.opnameCanvas`), en anders het eigen canvas. Het geluid blijft de tap
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
  - Uitkomst: 38 controles groen. Zie de tabel hieronder.
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

## Niet getest

- In Clay's echte Chrome, met een echte beamer op een tweede scherm.
- Volledig scherm (dubbelklik), langer dan een minuut verborgen, en Chrome's
  "intensive throttling" na 5 min. De lus van het losse venster hangt niet af van
  timers in het hoofdvenster, maar dit is niet gemeten.
- Acht video's tegelijk in het losse venster. Er is één video gebruikt.
- De vertraging tussen canvas en scherm (zie hierboven).
- `beforeunload` in het losse venster tijdens een opname. Chrome toont die
  vraag alleen na een klik in dat venster.
