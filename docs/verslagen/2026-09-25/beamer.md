# Spoor 2: beamer — video mengen in het losse venster (ROADMAP 18)

Branch `spoor2/beamer` (worktree `agent-a6258e47b6d35c5e3`), bovenop `main` = `cc527e3`.
Na de laatste commit gedetacht (`git switch --detach`).

| commit | onderwerp |
|---|---|
| `99dca97` | Video: melding in de strook als de video van een nummer ontbreekt of niet laadt |
| `5a36373` | Beamer: het losse venster mengt zelf en loopt door als het hoofdtabblad verborgen is |
| `af11eec` | Headless: beamer.mjs toont dat het beamerbeeld doorloopt met het hoofdtabblad verborgen; rVFC gemeten en niet gebruikt |

**Tests:** `nice -n 10 node test/alles.mjs` geeft 29 bestanden, 1959 checks, alles groen (main: 1923).
`video.test.mjs` heeft 88 checks, dat waren er 52.

- **Onder belasting:** één keer was `vormen-isomorf.test.mjs` rood op
  "tv: max < 16 ms per stap". Dat is een timingcheck in een bestand dat ik niet
  aanraakte. Los opnieuw gedraaid was hij groen, en bij de laatste volle run ook.
- **`tools/headless/kijk.mjs`** (poorten 8865/9465): alles groen.
- **`tools/headless/beamer.mjs`** (nieuw): 38 controles groen.
  - Op de oude code (`git archive main`) FAALT de hoofdcontrole: het blok blijft staan op 495 → 495 px.

## Wat en hoe

### Het losse venster mengt zelf
- **`video.html`**: alleen nog een canvas plus het hulpje; de module
  `src/video/beamer-venster.js` doet de rest.
  - Het losse venster maakt een eigen `VideoMixer`, met eigen `<video>`'s in ZIJN
    document en een eigen WebGL2-canvas. Het tekent op ZIJN `requestAnimationFrame`.
  - Die lus loopt door als het hoofdtabblad verborgen is, want het losse venster
    staat op de beamer en is zichtbaar.
- **Koppeling**: het losse venster leest `window.opener.varveBeamer`. Dat is
  same-origin met één gedeelde thread, dus gewone objecten, geen berichten.
  - De app zet `varveBeamer` = `api` uit `video-paneel.js`, met: `engine`,
    `videoMixer`, `meldAan`, `meldAf`, `mengtLos`, `losOpen`, `opnameUitLos` en `meldVideoFout`.
  - Berichten zijn bewust NIET gebruikt: de timers van een verborgen tabblad worden geknepen.
- **Elk beeld** roept het losse venster `mixer.neemOver(hoofdMixer)` aan. Dat
  neemt over: engine, fx-knoppen, mengvorm, puls en doel, passend/vullen, de
  video-url per track (`bron(id)`) en de beeldlagen. Wat niet verandert kost niets.
  - **Regel 1:** het losse venster leest alleen. De bus blijft bij de mixer in het
    hoofdvenster (`bindVideo`), dus APC, toetsenbord en muis zijn niet veranderd.
  - **Regel 3:** posities komen van de audioklok van het hoofdvenster
    (`deck.position`, `ctx.outputLatency + baseLatency`). `synchroniseer()` in
    `volg.js` is ongewijzigd.
- **Wie mengt** staat puur in `src/video/beamer.js` (`wieMengt`, klasse `Beamer`):
  - Is het losse venster open, dan mengt het hoofdvenster NIET. Het paneel toont
    dan het beeld van het losse venster via `captureStream` in een
    `<video class="vid-voorbeeld">`: de oude weg, andersom. Er wordt dus één keer gemengd.
  - Is het hoofdtabblad verborgen, dan gaat de voorbeeldstream uit.
  - Is het losse venster zelf verborgen (geminimaliseerd), dan staat zijn lus stil
    en mengt het paneel weer zelf.
- **Opname:**
  - `Beamer.opnameCanvas()` geeft voor een nieuwe video-opname het canvas van
    het losse venster als dat mengt, anders het eigen canvas.
  - `opname-knop.js` krijgt `videoCanvas()` in plaats van `videoMixer`.
  - Een opname die in het hoofdvenster begon blijft daar, want een MediaRecorder
    wisselt niet van bron. Gaat het losse venster tijdens die opname open, dan mengen
    ze tijdelijk ALLEBEI. Dat is de enige dubbele menging, en hij staat gemotiveerd
    in `docs/BEAMER.md`.
  - Gaat het losse venster dicht tijdens zijn eigen opname, dan:
    - vraagt het eerst om bevestiging (`beforeunload`);
    - zet het hoofdvenster een fout in de strook: het beeld in de opname staat vanaf
      dan stil, het geluid loopt door.
- **Herladen:**
  - **Los venster:** `pagehide` meldt het af. Het nieuwe document meldt zich weer aan.
  - **Hoofdvenster:** het losse venster ziet `varveBeamer` verdwijnen. Het laatste
    beeld blijft staan, zonder tekst voor de zaal, en de video's pauzeren.
    Daarna meldt het zich bij de nieuwe app aan, en `neemOver` brengt de nieuwe engine mee.
  - **"los venster" na herladen:** de knop focust het aangemelde venster in plaats
    van `window.open` (dat zou het herladen).
  - **Crash of dicht:** `closed` wordt gevonden en opgeruimd.
- **Vormlagen:** het losse venster gebruikt DEZELFDE beeldlaag-objecten. Een vorm
  rekent dus één keer, voor wie er mengt. `_maakLagenStap` wordt in het losse
  venster pas gebouwd bij de eerste laag, en een mislukte bouw wordt niet elk beeld
  opnieuw geprobeerd (`lagenMislukt`).
  - De Worker van een vormlaag hoort bij het hoofdvenster en levert ook door als dat verborgen is (gemeten).
  - Reageren op de mix (luisteraar op de master) werkt vanuit de lus van het losse venster.
  - `src/vormen/*` en `src/video/lagen.js` NIET aangeraakt (ander spoor).
- **Zonder WebGL2** in het losse venster meldt het zich niet aan. Dan blijft het
  hoofdvenster mengen, en staat er een fout in de strook.

### Foutmelding als de video ontbreekt of niet laadt
- `src/video/fouten.js` is puur.
- **`error` op een `<video>`** geeft een fout in de strook, bijvoorbeeld:
  "video van track 1 (kwarten): het bestand ontbreekt of het formaat wordt niet
  ondersteund". Een 404 geeft MediaError code 4.
- **Te lang laden:** zichtbaar en na 10 s nog geen beeld geeft "na 10 s nog geen beeld".
  De teller loopt vanaf het moment dat de laag zichtbaar werd, niet vanaf het laden:
  een video die in een verborgen tabblad niet laadde, meldt dan niet ten onrechte.
- **Eén melding per bron.** De fouten van het losse venster gaan via het hoofdvenster
  naar de strook, want de beamer toont geen tekst voor de zaal.
  - Dezelfde fout van twee mixers staat één keer in de strook: `meld()` stapelt geen gelijke fouten.
- Een nummer zonder video (alleen audio) geeft geen melding.

### requestVideoFrameCallback: gemeten, niet gebruikt
- **Meetmethode:** een testvideo met een wit blok dat met 200 px/s schuift. Na elke
  `teken()` wordt de middelste rij van het canvas gelezen, en daaruit volgt welk
  beeld er ECHT op het canvas staat. Dat is vergeleken met wat je op dat moment hoort.
- **Sturen op `currentTime` (zoals nu):** 8 metingen, gemiddeld −6,5 … +5,8 ms, |fout| 8,3–11,5 ms.
  - Het minimum bij 30 fps is 8,3 ms.
  - De uitschieters tot 11,5 kwamen vermoedelijk door de belasting (load 10–37). Dat is niet apart gemeten.
- **Eerste versie, sturen op rVFC-mediaTime** (integrerend, met anti-windup):
  |fout| 11,5–12,2 ms, tegen 8,3–8,4 ms zonder rVFC. Dat is slechter.
- **Oorzaak:** het `mediaTime` van rVFC loopt meestal 9–13 ms ACHTER op het beeld
  dat `texImage2D` bij een `<video>` buiten het DOM werkelijk uploadt. Eén meting
  gaf +2,5 ms: ook niet stabiel.
  - `currentTime` zit binnen ±6,6 ms van het beeld op het canvas.
- **Besluit:** rVFC is uit de app gehaald. De meting staat in `tools/headless/beamer.mjs`
  met een eigen waarnemer, dus te herhalen. De uitleg staat bij `_volg()` en in `docs/BEAMER.md`.

### Headless: `tools/headless/beamer.mjs`
- **Browser:** de volledige Chrome for Testing met `--headless=new`. Alleen daar maakt
  een tweede tabblad dat naar voren komt het hoofdtabblad echt 'hidden', met rAF
  stil. De headless shell kan dat niet.
- **WebGL op Metal.** Met swiftshader haalde de mixer op deze drukke machine 1
  beeld per seconde; `VARVE_KIJK_GL=swiftshader` zet het terug.
- **Veiligheid:**
  - MIDI gaat eruit vóór ELKE pagina: `Target.setAutoAttach` met
    waitForDebuggerOnStart, dus ook het losse venster en het extra tabblad.
  - Een eigen server met tijdelijke db, media en opnames.
  - De poorten komen uit `VARVE_KIJK_POORT`/`VARVE_KIJK_DEBUG`. Ik gebruikte 8865/9465.
- **Testmateriaal:** ffmpeg maakt een video met vier gekleurde kwarten (asymmetrisch)
  plus het schuivende blok. Die gaat door de echte upload en ingest.
- **Schermafdrukken** (in de scratchpad, niet in git) bekeken met Read:
  - `beamer-verborgen-1/2.png`: kwarten rechtop, het blok verschoven, de Lorenz-vormlaag erover;
  - `beamer-hoofd.png`: het paneel toont het beamerbeeld.
- **Wat het controleert:**
  - Het losse venster mengt op 60/s en het hoofdvenster op 0/s.
  - Het paneel toont het voorbeeld.
  - Het beeld staat rechtop (vier kwarten).
  - De sync op het canvas klopt.
  - Een video-opname komt uit het losse venster.
  - Met het hoofdtabblad verborgen:
    - staat de rAF van het hoofdtabblad stil, en loopt de audio door;
    - schuift het blok 434–480 px in ~2,3 s, en verschillen de schermafdrukken;
    - blijft het losse venster mengen;
    - levert de vorm-Worker door (115–155 beelden);
    - klopt de sync nog: −0,8 … +5,8 ms.
  - In de opname-mp4 staat het beeld nergens langer dan 0,25 s stil.
  - Herladen werkt van beide kanten.
  - Een geminimaliseerd los venster laat het paneel het overnemen.
  - Een ontbrekende `video.mp4` geeft een fout in de strook.
  - De console bevat geen fouten.

## Bestanden

**Nieuw:**
- `src/video/beamer.js`
- `src/video/beamer-venster.js`
- `src/video/fouten.js`
- `tools/headless/beamer.mjs`
- `docs/BEAMER.md`

**Gewijzigd:**
- `video.html`
- `src/video/video-mixer.js`: `neemOver`, `bron`, `bronnen`, `maakVideo`,
  `onFout`, `beelden`, `lagenMislukt`, error-listener, laadgeduld
- `src/ui/video-paneel.js`
- `src/ui/app.js`: `window.varveBeamer`, `opzetOpname({ videoCanvas })`
- `src/ui/opname-knop.js`
- `index.html`: `.vid-voorbeeld`
- `styles.css`
- `test/video.test.mjs`
- `tools/README.md`

Er zijn geen nieuwe actions: het losse venster was al een knop in de UI en staat
niet op de bus.

## NIET getest
- In Clay's echte Chrome, met een echte beamer op een tweede scherm en in volledig scherm (dubbelklik).
- Langer dan een paar seconden verborgen:
  - "intensive throttling" na 5 min;
  - een hoofdtabblad zonder geluid, dat niet "audible" is en dus bevroren zou kunnen worden.
  - Het ontwerp hangt niet af van timers in het hoofdvenster, maar dit is niet gemeten.
- Acht video's tegelijk in het losse venster. De test gebruikt er één.
- **De vertraging tussen canvas en echt scherm.** In headless is
  `expectedDisplayTime − nu` ≈ 0. Op een echte 60 Hz-beamer is die waarschijnlijk
  16–33 ms: het beeld loopt dan zoveel achter op het geluid. Dat is een AANNAME.
  Meten kan alleen met een camera die scherm en klik tegelijk opneemt.
- `beforeunload` in het losse venster tijdens een opname. Chrome toont die vraag
  alleen na een klik in dat venster.
- "Laadt te lang" (10 s) in een browser. Alleen de pure regel en het 404-pad zijn getest.
- Een tweede los venster naast het eerste. Volgens de code mengt alleen het
  aangemelde, en wacht het andere; niet in een browser geprobeerd.
- Het voorbeeld in het paneel (`captureStream` van het losse canvas) in een
  zichtbare Chrome. Headless: `readyState ≥ 2` en zichtbaar.

## Aannames
- Een same-origin popup deelt de thread en de V8-isolate met de opener. Een
  ImageBitmap, OffscreenCanvas of canvas uit de ene realm uploaden naar de
  WebGL van de andere werkt dan (gemeten in Chrome 153). Andere browsers doen niet mee.
- Een hoofdtabblad dat geluid maakt wordt door Chrome niet bevroren. Worker-berichten
  naar een verborgen tabblad komen door (gemeten: ja, over ~2,5 s).
- De load van 10–37 tijdens de metingen maakt de sync-cijfers eerder slechter dan beter.

## Vragen voor Clay
1. **Beamer testen in je eigen Chrome.** Een extra VARVE-tabblad mag niet, dus in
   je eigen tabblad:
   - los venster open, naar de beamer, dubbelklik;
   - een ander tabblad in het hoofdvenster, en kijken of het beeld doorloopt;
   - ook een video-opname en kijken of die doorloopt.
2. **Mag de dubbele menging blijven** in het randgeval "opname begon zonder los
   venster, daarna los venster open"? Het alternatief is dat de beamer dan
   (tijdelijk) de oude captureStream-weg gebruikt en weer bevriest als het
   hoofdtabblad verborgen is.
3. **De vertraging tussen canvas en scherm meten?** Met een telefooncamera op
   240 fps, gericht op beamer plus luidspreker, en een klik met een witte flits.
   Pas daarna heeft een vaste voorsprong voor het beeld zin.
4. **Moet een nummer zonder video een (info-)melding geven** als het losse venster
   open is? Nu niet: alleen een ontbrekend of kapot bestand is een fout.

## Voorstel CLAUDE.md-tekst
(vervangt de laatste zin van "Video is SLAAF van de audio" en de beamerzinnen in
"Met video erbij"; nieuwe regels in de structuur)

Structuur, onder `video/`:
```
                    beamer.js       wie mengt: hoofdvenster of los venster (de beamer). Puur.
                    beamer-venster.js  video.html: het losse venster mengt ZELF (eigen <video>'s, WebGL, lus)
                    fouten.js       video ontbreekt/laadt niet: tekst en wachtregel. Puur.
```
En onder `tools/`: `headless/beamer.mjs` (Chrome for Testing `--headless=new`, hoofdtabblad echt verborgen).

Bekende grenzen, nieuwe tekst:
- HET LOSSE VENSTER MENGT ZELF (ROADMAP 18, 25 sep, `docs/BEAMER.md`).
  - **Wat het losse venster is:**
    - `video.html` heeft een eigen `VideoMixer`, eigen `<video>`'s in ZIJN
      document en een eigen WebGL-canvas op ZIJN rAF. Daardoor loopt de beamer
      door als het hoofdtabblad verborgen is.
    - Het leest `window.opener.varveBeamer` (same-origin, zelfde thread, geen berichten).
    - Elk beeld neemt het via `neemOver()` over: engine, knoppen, mengvorm, puls,
      fit, video per track en DEZELFDE beeldlaag-objecten.
    - De bus blijft bij de mixer in het hoofdvenster.
  - **Eén keer mengen:**
    - Is het losse venster open, dan mengt het hoofdvenster niet. Het paneel toont
      het beeld van het losse venster (`captureStream`); verborgen staat die stream uit.
    - Is het losse venster geminimaliseerd, dan mengt het paneel weer zelf.
  - **Video-opname:**
    - Een nieuwe opname neemt het canvas van wie er mengt (`Beamer.opnameCanvas`).
    - Een opname die in het hoofdvenster begon blijft daar, want een MediaRecorder
      wisselt niet van bron. Dan mengen ze tijdelijk allebei.
    - Het losse venster dicht tijdens zijn eigen opname: eerst een
      `beforeunload`-vraag, daarna een fout in de strook (beeld staat stil, geluid loopt door).
  - **Herladen van beide kanten:** opnieuw aanmelden. `window.open` met dezelfde naam
    herlaadt het venster, dus "los venster" focust het aangemelde venster.
  - **Geen tekst op de beamer** behalve het hulpje bij het eerste koppelen. Fouten
    van het losse venster gaan naar de strook van het hoofdvenster.
  - **Headless testen** met `tools/headless/beamer.mjs`: volledige Chrome for Testing
    met `--headless=new`, niet de headless shell. Alleen daar wordt een tabblad
    echt verborgen. WebGL op Metal.
- **requestVideoFrameCallback is gemeten en NIET gebruikt.** Het `mediaTime` loopt
  ~9–13 ms achter op wat `texImage2D` uploadt bij een `<video>` buiten het DOM.
  Bijsturen erop gaf |11,5–12,2| ms tegen |8,3–8,4| op `currentTime`; 8,3 ms is het
  minimum bij 30 fps. De vertraging tussen canvas en scherm is niet gemeten (aanname 16–33 ms).
- **Video van een nummer ontbreekt of laadt niet:** een fout in de strook
  (`fouten.js`), één keer per bron. "Na 10 s nog geen beeld" telt vanaf zichtbaar
  worden, niet vanaf laden.

De zin "Hoofdtabblad dus zichtbaar houden (ronde 3: mengen naar het losse venster)"
in "Met video erbij" kan weg; daar in de plaats: "Met het losse venster open mag het
hoofdtabblad verborgen zijn: dat venster mengt zelf en de opname komt van zijn canvas."

Nog één kleine onnauwkeurigheid voor het vormen-spoor: in het commentaar bovenaan
`src/video/lagen.js` staat "opname en het losse venster krijgen hem vanzelf mee
(zelfde canvas)". Dat klopt nog, maar niet meer omdat het hetzelfde canvas is: het
losse venster gebruikt dezelfde lagen-objecten. Ik heb dat bestand bewust niet
aangeraakt.

## Voor HANDOFF/ROADMAP (niet door mij gewijzigd)
- **ROADMAP 18:** gebouwd op `spoor2/beamer`. Te doen: Clay test in zijn eigen Chrome (vraag 1).
- **VERBETERINGEN ronde 3 "Video":**
  - mengen naar het losse venster: gedaan;
  - beeldverhouding: was al gedaan;
  - rVFC: gemeten en niet gebruikt;
  - foutmelding bij een ontbrekende video: gedaan.
