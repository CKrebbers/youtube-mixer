# Wat er nog ontbreekt (2 oktober 2026)

Drie onderzoeken samengevoegd: de open punten in de eigen docs (ROADMAP, VRAGEN,
VERBETERINGEN, de blauwdruk uit `Input/`, opnieuw nagelopen tegen de code), een
vergelijking met rekordbox 7, Traktor Pro 4, Serato DJ Pro 4, Mixxx 2.5/2.6 en
VirtualDJ, en wat een koppeling met Logic Pro en TouchDesigner vraagt. De indeling
in groepen is een VOORSTEL; Clay kiest. Bron 1 (wat Clay mist tijdens het spelen)
komt na de proefsessie en een echte set met het handelingenlog.

Grootte: S < halve dag, M 1–2 dagen, L meer. Geschat, niet gemeten.

## A. Nodig om standalone te kloppen

Wat je bij een live set merkbaar mist of wat je handwerk beschermt. Op belang.

| # | Wat | Waarom / stand | Bron | Grootte |
|---|---|---|---|---|
| A1 | **Koptelefoon-cue (PFL, cue-mix)** | Een volgend nummer voorbeluisteren zonder dat de zaal het hoort. Eén geluidskaart met uitgang 3/4 houdt één klok (regel 3); twee apparaten geven twee klokken. Eerst de hardware kiezen. Dezelfde meerkanaals-uitgang is later de weg naar Logic. | ROADMAP 25 · VRAGEN F1 · alle DJ-software | M–L |
| A2 | **Keylock en toon verschuiven** | Bij sync schuift nu de toon mee met het tempo, en daardoor staat de auto-DJ veel blends niet toe. Ontwerp en metingen liggen klaar (Signalsmith in de streamlezer). Wacht op luistertest A3. | ROADMAP 15 · KEYLOCK.md · VRAGEN I1–I4 | L |
| A3 | **Sync die blijft volgen (sync-lock)** | Sync zet het tempo nu één keer gelijk (engine.js:437). Wisselt de maatgever van tempo (een nieuw stuk in zijn tempokaart), dan loopt elke gesyncte track weg. | VERBETERINGEN ronde 3 · alle DJ-software | M |
| A4 | **Beeld-noodknoppen: zwart, bevriezen, master-dekking, flits (gebouwd 2 okt)** | Basisgereedschap voor de beamer; zwart moet altijd kunnen. Bestaat nu niet (alleen de zes video-effecten). | ROADMAP 23 · blauwdruk | S |
| A5 | **Herstel na crash of herladen** | Welke nummers op welke track stonden, posities, loops. Nu weg na een herlaad; Chrome crashte al eens in de MIDI-dienst. De beginstand van het handelingenlog is herbruikbaar. | DJ-vergelijking | M |
| A6 | **Backup van de library (gebouwd 2 okt)** | library.db bevat handwerk: grids op slot, hotcues, racks, toonsoorten. Er is geen backup en geen Time Machine. | DJ-vergelijking | S |
| A7 | **Auto-DJ: vloeiende fades (gebouwd 2 okt)** | Overgangen lopen nu in stapjes van ~0,45 dB per 40 ms over de bus; een opname bewaart die trapjes. Wordt een helling op de audioklok. | AUTO-DJ.md §7 | S–M |
| A8 | **APC-knoppen voor de auto-DJ (gebouwd 2 okt)** | ok, overslaan, langer en nu als eigen mapje, zodat je zonder muis bijstuurt. De actions bestaan al. | VRAGEN AU1 | S |
| A9 | **Vier live-randgevallen (gebouwd 2 okt)** | Een lege hotcue vlak na het laden overschrijft de bewaarde · sync kan terugvallen op een remmende track · na stilstand telt een track nog even als remmend · gate zonder maat start op "nu". | VERBETERINGEN ronde 4 | S |
| A10 | **Luistertests A2 en A3 (jij)** | Streamen, loops en springen beluisteren (A2), en de keylock-proef (A3). Geen bouwwerk, wel nodig vóór een echte set. | ROADMAP 19 · VRAGEN A2, A3 | — |

## B. Later

Gewenst of gangbaar, maar een set lukt zonder.


### Mixen en transport

| # | Wat | Waarom / stand | Bron | Grootte |
|---|---|---|---|---|
| B1 | **Stems per nummer** | Twee, of vier op verzoek; splitsen bij binnenhalen; stem-fader vóór de EQ. Al besloten (H1, H2), nog niet gebouwd. Gangbaar sinds 2024; ik zet hem na keylock. | ROADMAP 17 · VRAGEN H2, H3 | L |
| B2 | **8 hotcues per track, met kleur** | Nu 4; de library kan er al 8 bewaren. Het werk zit in de plek op de APC. | blauwdruk · DJ-vergelijking | S–M |
| B3 | **Loops en cuepunt bewaren per nummer** | Hotcues komen terug, loops en het cuepunt niet. | DJ-vergelijking | S–M |
| B4 | **Slip-modus, daarna roll, censor, reverse** | Effectspel; reverse vraagt een streamkern die achteruit kan. | blauwdruk · alle DJ-software | M–L |
| B5 | **Intro/outro-markers en auto-cue op de eerste tel** | YouTube-bronnen beginnen vaak met stilte of een intro. | DJ-vergelijking | S–M |
| B6 | **Fijn zoeken in pauze, knop naar het midden, pitch naar 0** | Kleine gemakken; nu alleen springen en dubbelklik op het scherm. | blauwdruk · DJ-vergelijking | S |
| B7 | **Meer effecten en spin-up** | Flanger, roll, noise-sweep; spin-up na de rem (J7). Elk effect is klein dankzij de racks. | blauwdruk · VRAGEN J7 | S per stuk |
| B8 | **Look-ahead limiter, isolator-EQ, filterresonantie in de strip** | Nu een DynamicsCompressor, shelf/peak-EQ met kill, vaste Q. | DJ-vergelijking · blauwdruk | S–M |
| B9 | **Echo-worp en galm vasthouden op de APC** | De .hold-actions bestaan; alleen een mapping-regel. | VRAGEN D3 | S |

### Library

| # | Wat | Waarom / stand | Bron | Grootte |
|---|---|---|---|---|
| B10 | **Bladeren en laden vanaf de APC** | Er is geen vrije encoder: vraagt een keuze op het apparaat. | blauwdruk · alle DJ-software | M |
| B11 | **Harmonisch zoeken** | Sorteren op toonsoort, passende nummers laten oplichten. De toonsoort ligt er al. | VRAGEN T6, T7 | S |
| B12 | **Tracklist per set** | Naast elke opname een lijst wat er speelde; het handelingenlog heeft het al. | DJ-vergelijking | S |
| B13 | **Crates, tags, playlists; playlist in de ingest** | Zodra de library groeit. | VERBETERINGEN ronde 3 · VRAGEN J13 | M–L |
| B14 | **Golfvorm in kleur (laag/mid/hoog)** | Breaks en drops sneller zien; vraagt peaks per band bij binnenhalen. | DJ-vergelijking | M |

### Beeld

| # | Wat | Waarom / stand | Bron | Grootte |
|---|---|---|---|---|
| B15 | **Beeldscènes (opslaan, laden, op de maat)** | Een scène is data, de overgang een tijd. | ROADMAP 23 · blauwdruk | M |
| B16 | **Vormen: routes per nummer, meer routes, puls als route** | Nu één route per laag, als sessietoestand. | ROADMAP 23 | S–M |
| B17 | **Geluid van de isomorfe vormen** | Via een eigen vormbus, na de AV-kern-module. | ROADMAP 23 · VRAGEN H6 | M |
| B18 | **Beamervertraging meten, dan een vaste voorsprong** | Nu aangenomen 16–33 ms. | VRAGEN J16, J28 | S |

### Auto-DJ en plan

| # | Wat | Waarom / stand | Bron | Grootte |
|---|---|---|---|---|
| B19 | **Planvenster fase 2** | Live-stand: nu/volgende/daarna, GO per stap, een bewaker bewust breken. | PLAN.md · VRAGEN PL1, PL2 | M–L |
| B20 | **Auto-DJ slimmer** | Tempo terug na een blend, frase- en energieanalyse, hotcues als mix-punten, paargeheugen; later Claude live en leren uit het log. | AUTO-DJ.md §7–8 | L |

### Overig

| # | Wat | Waarom / stand | Bron | Grootte |
|---|---|---|---|---|
| B21 | **Klankschaal op de APC en verder** | Mapje (KS1), omstemmen bij de volgende aanslag (KS2), op de tel (KS4), eigen schaal (KS5). | VRAGEN KS1–KS5 | S per stuk |
| B22 | **Handelingenlog: opnieuw renderen in één knop, alleen-kijken** | Eerst gebruiken, dan kiezen. | VRAGEN J19 | S |
| B23 | **Melding bij overbelasting van de audiothread** | Nu alleen voor gaten in de stream en de vormlagen. | DJ-vergelijking | S |
| B24 | **Invoer van buiten: microfoon, synth, camera** | Interessant voor een AV-instrument; een nieuwe soort bron. | DJ-vergelijking | M |
| B25 | **Kleine restjes** | Echofilter uit (na meting), 128 LED-kleuren, RF64 afspelen, de rest van ronde 4 (9 punten), beatgrid-grenzen. | ROADMAP 2, 26 · VERBETERINGEN ronde 4 · BEATGRID.md | S per stuk |

## C. Koppeling met Logic en TouchDesigner

Na standalone. Drie dingen kunnen nu al, zonder code in de app.


### Kan nu al, zonder app-code

| # | Wat | Waarom / stand | Bron | Grootte |
|---|---|---|---|---|
| C1 | **Koppelontwerp vastleggen** | Eén berichtvorm voor alles wat naar buiten gaat: adressen = de action-namen (al 0..1), tijden met een klokanker, alleen op 127.0.0.1. | onderzoek Logic/TD | S |
| C2 | **Meting op de Mac: geluid naar BlackHole** | Hoeveel uitgangskanalen Chrome toestaat (er is een bug boven 8) en welke vertraging. Bepaalt of stems live of achteraf naar Logic gaan. | onderzoek Logic/TD | S |
| C3 | **Proef: Logic en TouchDesigner in één Link-sessie** | Logic volgt geen MIDI clock, wel Ableton Link (sinds 10.7.5); TouchDesigner heeft een Link CHOP. Met Carabiner (los programma) kijken of Logic live tempowissels volgt. | onderzoek Logic/TD | S |

### Koppelfase

| # | Wat | Waarom / stand | Bron | Grootte |
|---|---|---|---|---|
| C4 | **WebSocket en uitgang in de server** | Een eigen WebSocket-server zonder dependency; de mixer stuurt stand, maat, audiokenmerken en elke action. Basis voor alles hieronder. | onderzoek Logic/TD | M |
| C5 | **OSC naar TouchDesigner (en terug)** | Elke APC-beweging wordt vanzelf een TD-parameter. TD → VARVE vraagt een besluit: telt dat als "jij raakt aan" voor de auto-DJ? | onderzoek Logic/TD | S–M |
| C6 | **Ableton Link via Carabiner** | Tempo, fase en start/stop delen met Logic en TD. Link is GPL: als los programma blijft VARVE vrij. | onderzoek Logic/TD | M |
| C7 | **Geluid naar Logic** | Uitgang kiezen (setSinkId) plus één instelling extra vertraging in hoorbaar.js; meerkanaals als de meting (C2) het toelaat. | onderzoek Logic/TD | S–M |
| C8 | **Set naar Logic als multitrack met tempokaart** | Per track opnemen plus een MIDI-bestand met het tempo van de set uit het handelingenlog: in Logic kloppen de maten. Geen realtime koppeling nodig. | onderzoek Logic/TD | M |
| C9 | **Beeld naar TouchDesigner** | Eerst het losse venster laten vangen (Screen Grab TOP of SpectraBridge → Syphon): nul regels code, ~1 beeld vertraging. Terug: TD-beeld als beeldlaag via een virtuele camera. | onderzoek Logic/TD | 0 / M |

## D. Niet

Botst met een vastgelegde keuze (CLAUDE.md, VRAGEN).

| # | Wat | Waarom / stand | Bron | Grootte |
|---|---|---|---|---|
| D1 | **Streamingdiensten, cloud-sync, delen, live uitzenden** | VARVE is een persoonlijk instrument met een lokale cache. | CLAUDE.md | — |
| D2 | **Scratchen, jogwiel, DVS** | De APC heeft geen jogwiel; fijn zoeken (B6) dekt wat wel kan. | DJ-vergelijking | — |
| D3 | **Booth-uitgang, karaoke, USB-export voor CDJ's** | Past niet bij het doel. | DJ-vergelijking | — |
| D4 | **De indeling van de blauwdruk (2 decks spiegelbeeldig)** | Acht tracks, één kolom = één track. Ook: beeld-crossfader los van het geluid, vier beeldlagen, tempo-master met de hand, blauwdruk-import. | CLAUDE.md · VRAGEN G4 | — |
| D5 | **Link als native module, eigen Syphon/NDI-helper, VARVE in TouchDesigner draaien, Link Audio** | GPL of native code in het serverproces, of een tweede beamer over het netwerk. Pas heroverwegen als de goedkope routes tekortschieten. | onderzoek Logic/TD | — |

## Voorstel voor de volgorde

**Stand 2 okt (avond):** stap 1 is gebouwd (A4, A6, A7, A8, A9), zie HANDOFF.

1. Eén sessie "klein en veilig": A6 backup, A4 beeld-noodknoppen, A8 auto-DJ op de APC,
   A9 de vier randgevallen, A7 vloeiende fades.
2. A3 sync-lock, dan A5 herstel na een crash.
3. A2 keylock, zodra A3 (luistertest) goed is.
4. A1 koptelefoon-cue, zodra de geluidskaart gekozen is.
5. C1–C3 tussendoor: ontwerp en twee proeven, geen app-code.

## Vragen die de keuze bepalen

1. Koptelefoon: welke geluidskaart gebruik je live, en heeft die een tweede stereo-uitgang (3/4)?
2. Logic: wat moet het doen? De set opnemen en nabewerken (dan C8), of live meespelen op het tempo van VARVE (dan C6)? En welke versie?
3. TouchDesigner: beeld maken op de maat en de klank van VARVE, VARVE-beeld ontvangen en bewerken, of wordt TD de beamer?
4. Tempo: is VARVE altijd de baas, of mogen Logic en TD het tempo zetten?
5. Telt een actie van TD of Logic als "jij raakt aan" voor de auto-DJ?
6. Mag Carabiner (gratis, GPL, een los programma) op de Mac voor Ableton Link?
7. Draaien Logic en TD op dezelfde Mac als VARVE?

## Aannames en wat niet geverifieerd is

- De sites van Apple, Derivative, Serato en Mixxx waren voor de agenten niet te lezen
  (alleen zoekresultaten). Niet geverifieerd: of Logic live tempowissels van een
  Link-peer volgt, of Chrome op de Mac meer dan 8 uitgangskanalen goed doet, of een
  bedekt venster gevangen blijft, en TD's WebRTC en Web Render TOP op macOS.
- Nagekeken in de code: sync stelt één keer gelijk (`engine.js:437`); `deck.keylock` en
  `deck.transpositie` bestaan als velden maar doen nog niets (`deck.js:101`); 4 hotcues
  per track, de library kan er 8 bewaren.
