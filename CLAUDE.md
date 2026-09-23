# YouTube Mixer — projectgeheugen

Lees dit voordat je iets wijzigt. Dit bestand is de bron van waarheid voor
architectuurbeslissingen; `ROADMAP.md` is de bron van waarheid voor de volgorde.

Hervatten na een pauze: `docs/HANDOFF.md` (stand, wat ongecommit is, wat
niet getest is), `docs/VRAGEN.md` (open vragen voor Clay),
`docs/VERBETERINGEN.md` (verbeterlijst in rondes), `docs/APC40.md` (wat de
controller kan en de indeling zoals gebouwd).

## Wat dit is

Een DJ-programma dat YouTube-audio en -video als bron gebruikt, bediend met een
MIDI-controller (referentie-hardware: **Akai APC40 mkII**), maar volledig bruikbaar
met muis en toetsenbord. Mapping moet door de gebruiker zelf aanpasbaar zijn.

Gebruiker: Clay (Varve). Nederlands in commits, comments, docs en gesprek.

## Gekozen aanpak (vastgelegd, niet heropenen zonder aanleiding)

YouTube's IFrame Player geeft **geen toegang tot de audiobuffer**. Daarmee zijn EQ,
filters, waveforms, beatgrids, keylock en scratch onmogelijk via de officiële weg.
Daarom: **lokale cache**. `yt-dlp` + `ffmpeg` halen media binnen en normaliseren die,
daarna draait alles op Web Audio en WebGL.

Consequentie: dit is een persoonlijk instrument, geen distributieplatform. Bouw geen
deelfuncties, geen publieke streaming, geen upload. Als een feature erom vraagt:
eerst melden, niet stilletjes bouwen.

## De drie regels

Deze regels zijn de reden dat het project uitbreidbaar blijft. Breek ze niet;
als een feature erom lijkt te vragen, is dat bijna altijd een ontwerpfout elders.

1. **De engine kent geen MIDI, geen DOM en geen YouTube.** `src/engine/` mag niets
   importeren uit `src/ui/`, `src/control/` of de ingest-laag. Alles wat de engine
   wil aansturen gaat via de action-bus.
2. **Alle `value`-actions zijn genormaliseerd 0..1.** MIDI CC is dat ook (na `/127`).
   Een mapping weet daardoor niets van dB, Hz of seconden. De engine doet de
   schaling, altijd. `trigger`-actions krijgen een boolean (true = indrukken).
3. **Positie komt van `ctx.currentTime`, nooit van een eigen teller of `setInterval`.**
   De AudioContext-klok is de enige die niet wegloopt als de UI hapert.

## Structuur

```
index.html          geen build-stap, plain ES-modules
apc.html            interactieve APC-kaart: knoppen op hun echte plek, wat ze doen (src/ui/apc-kaart.js)
styles.css
src/
  engine/           audio-graph.js  kanaalstrip, EQ, bipolair filter, master, xfader
                    beatgrid.js     tempo + anker, tap tempo. Puur rekenwerk.
                    bron.js         HOE een track geluid wordt: BufferBron en StreamBron
                    stream-kern.js  streamen als puur rekenwerk: segment, pagina's, WAV
                    stream-lezer.js de AudioWorklet die pagina's afspeelt
                    fx.js           insert-slot: ketens bouwen, klikvrij wisselen
                    rack.js         racks als data: macro's, curves, migratie
                    deck.js         transport, cues, loops, beatgrid (geluid zit in bron.js)
                    sampler.js      acht pads: knippen op het grid, loopen op de maat van wat je hoort
                    engine.js       decks + mixer + snapshot()
  control/          actions.js      DE ACTION-BUS — alles gaat hierdoorheen
                    keyboard.js     toetsen -> actions
                    midi.js         Web MIDI: poorten, parsen, sysex. Kent geen actions.
                    mapping.js      signature -> action, soft-takeover, shift, mapjes. Kent geen hardware.
                    lagen.js        mapjes (lagen): welk mapje open staat, vastzetten en gluren
                    feedback.js     engine-stand -> LED's, met diffing. Leest de mapping.
                    midi-learn.js   action kiezen, control bewegen, gekoppeld
                    devices/        apc40mk2.js, generic.js — wat er op het apparaat zit
  analysis/         peaks.js        golfvorm-peaks + ruwe RMS
                    demo-track.js   synthetische 124-bpm testtrack
  ui/               app.js (instappunt: engine + modules in volgorde opzetten)
                    vensters, laden, racks, sampler-opslag, meldingen,
                    onderpanelen, midi-opzet, opname-knop, video-paneel,
                    renderloop, mapje-balk — elk een opzet…()-functie
                    waveform.js, controls.js, midi-monitor.js,
                    mapping-panel.js (de lijst), learn-mode.js (aanwijzen op het scherm),
                    rack-editor.js (racks bouwen met de muis, werkt op een kopie)
                    spiegel-plan.js het scherm als APC: welke control waar, wat hij doet. Puur.
                    spiegel.js      acht kolommen, focusdeel, acht banen; data-actions uit de mapping
                    vensters.js     de track met focus bovenaan + vensters als model (L/R)
                    tabblad.js      Web Lock 'varve-mixer': maar één tabblad praat met de APC
                    apc-kaart.js    apc.html: de APC met knoppen op hun echte plek, klik = uitleg
                    apc-beschrijf.js elke action in gewone taal (de test eist er een voor de hele standaardmapping)
  video/            volg.js         hoe een video de audio volgt. Puur rekenwerk.
                    video-mixer.js  <video> per track, gemengd met WebGL2. Leest de engine alleen uit.
                    instellingen.js welke video-effecten en mengvormen er zijn (data)
                    puls.js         effecten op de tel: vorm, welke track de maat geeft
  opname/           opnemer.js      je set opnemen: worklet aan de master, stukken naar de server
                    opnemer-worklet.js  telt frames, zet om naar 16-bit, geeft per seconde door
  lib/              emitter.js      Emitter + clamp/lerp/expMap/dbToGain/fmtTime
server/             draait apart: `node server/index.js`
  index.js          HTTP, statische bestanden (no-store), ingest-API, library-API
  ingest.js         yt-dlp -> ffmpeg -> media/<id>/. Gooit nooit; geeft resultaat terug.
  library.js        SQLite via node:sqlite. Tracks, peaks, effect-racks.
  analyze.js        golfvorm-peaks én onset-envelope vooraf, streamend uit ffmpeg
  analyse-werker.js peaks, onset en tap-verfijning in een worker_thread (server blijft vrij)
  detect.js         FFT, onset-envelope, tempo, segmentatie. Geen dependencies.
  opname.js         opnames: WAV dat groeit, kop herstellen na een crash
mappings/
  apc40mk2.json     standaardmapping (data, geen code)
  generic.json      leeg startpunt
racks/
  sjablonen.json    kant-en-klare racks voor elk nummer (data, geen code)
media/              binnengehaalde bestanden + library.db (niet in git)
opnames/            je opgenomen sets als WAV (niet in git)
test/
  engine.test.mjs   engine tegen gemockte Web Audio API, draait in Node
  mapping.test.mjs  mapping + soft-takeover, puur logica, geen mock nodig
  feedback.test.mjs LED-diffing en paletproef, bytes worden opgevangen
  learn.test.mjs    MIDI-learn, modusherkenning, export/import-rondje
  midi.test.mjs     parsen, poortkeuze op naam, echodetectie
  library.test.mjs  database, effect-racks per link, cascade bij verwijderen
  ingest.test.mjs   pipeline zonder netwerk; ffmpeg maakt zijn eigen testmateriaal
  analyze.test.mjs  peaks van de server tegen die van de browser, bit voor bit
  beatgrid.test.mjs beatrekenen, grid bewerken, tap tempo met een misser erin
  detect.test.mjs   beatdetectie op materiaal waarvan het antwoord bekend is
  rack.test.mjs     macro-resolutie met een gouden bestand, migratie, onbekende effecten
  stream.test.mjs   streamkern tegen ffmpeg (bit voor bit), pagina-plan, StreamBron
  video.test.mjs    video volgt audio: bijsturen, springen, zichtbaarheid
  server.test.mjs   eigen server op eigen poort + tijdelijke db: witte lijst, Range, racks per nummer
  regels.test.mjs   regel 1 als test: engine importeert niets uit ui/control/server, geen DOM
  spiegel.test.mjs  scherm-als-APC: actions uit de mapping, mapjes, shift, venster volgt focus
  tabblad.test.mjs  Web Lock met een nagebouwde navigator.locks: eerste, tweede, overnemen
  opname.test.mjs   opname-WAV: stukken op ?frame=N, kop, RF64, herstel na crash, geen ../
  opnemer.test.mjs  opnemer tegen de echte opname.js met een haperend netwerk: geen dubbel, gat = stilte
  alles.mjs         alle tests in één keer met overzicht
docs/
  HANDOFF.md        stand, wat niet getest is, volgende stap
  VRAGEN.md         open vragen voor Clay
  VERBETERINGEN.md  verbeterlijst uit de reviewagenten, in rondes
  APC40.md          wat het apparaat kan en de indeling zoals gebouwd
  APC40-onderzoek.md DJ-conventies, bestaande mappings, fysieke indeling (bron van de indeling)
```

## Conventies

| Onderwerp | Afspraak |
|---|---|
| Taal | Nederlands in comments, commits, docs. Code-identifiers in het Engels. |
| Build | Geen. Plain ES-modules. Introduceer geen bundler zonder te vragen. |
| Server | `node server/index.js` op poort 8777. Serveert met `no-store`: Chrome houdt ES-modules anders vast en dan debug je een versie die niet meer bestaat. |
| Dependencies | Nul in de frontend. Elke toevoeging eerst voorleggen met reden. |
| Nieuwe functie | Eerst `define()` in `actions.js`, daarna pas UI en mapping. |
| Formatting | 2 spaties, single quotes, semicolons. Volg de bestaande stijl. |
| Tests | Alle bestanden in `test/` moeten groen blijven: `node test/alles.mjs`. Bij wijzigingen: check toevoegen. |
| Mocks | Een mock die makkelijker is dan de echte API verbergt bugs. De Web Audio-mock vuurt `onended` asynchroon omdat de browser dat ook doet. |
| Browser | Chrome. Web MIDI bestaat niet in Safari — geen polyfill-pogingen. |

## Bekende grenzen (niet als bug rapporteren)

- Wat uit de library komt STREAMT (`StreamBron`, sinds 23 september 2026): alleen
  pagina's van ~1,4 s rond de positie, de loop, het cuepunt en de hotcues staan
  in het geheugen, ~4-6 MB per track, hoe lang hij ook is. Gemeten: acht keer
  een album van 31 minuten ~30 MB, waar het uitgepakt 5,7 GB was.
- ÉÉN afspeelmotor (Clay 23 sep): losgesleepte bestanden en de demotrack gaan
  ook door de StreamBron. `deck.laadGeheugen(buffer)` zet de AudioBuffer om
  naar het formaat van de ingest (`maakWav`, 16-bit stereo) en geeft de
  StreamBron een `geheugenHaal` die Range-verzoeken uit dat geheugen
  beantwoordt. Kost ~11 MB per minuut (de hele WAV staat in RAM, maar als
  16-bit: de helft van een AudioBuffer). `deck.load()` met de BufferBron
  bestaat nog als reserve, voor de engine-tests en straks keylock.
- Streamen leest `audio.wav` rechtstreeks met Range-verzoeken, en kan daarom
  alleen 16-bit PCM stereo. De ingest zet dat formaat expliciet. Verander je
  het formaat van `audio.wav`, dan weigert de StreamBron het met een reden.
- Springen naar een plek die nog niet binnen is, geeft een paar tientallen ms
  stilte (een gat is stilte, nooit een herhaling). Hotcues en cuepunt zijn
  vastgepind en klinken direct.
- Een loop springt van einde naar begin, en die twee samples liggen bijna
  nooit op dezelfde hoogte: een tik. De streamkern vloeit daarom de laatste
  5 ms (`LOOP_NAAD`) equal-power over naar wat er vlak vóór het loop-BEGIN
  staat. Gemeten op het ADRIANA-album: sprongen tot 0,147 werden niet groter
  dan een gewone stap in de muziek. Alleen voor de StreamBron (dus alles in de
  app); de BufferBron (reserve) loopt via de native loop en tikt nog.
- Hoofdthread en worklet delen GEEN teller: ze rekenen allebei met dezelfde
  formule uit `stream-kern.js` op dezelfde audioklok ("vanaf T staat de
  positie op P met snelheid R"). Elke wijziging is een nieuw segment; een
  bericht dat laat aankomt rekent vanaf T door. Regel 3 over een draadgrens.
- Pitch schuift mee met tempo. Dat is `playbackRate`. Keylock hoort bij fase 3.
- Nudge op de APC = BEND (`deck.bend`, actions `track.N.bend.back/fwd`): zolang
  je drukt draait alleen de BRON 4% trager/sneller; `deck.rate` (pitchfader,
  bpm, sync) blijft staan, dus loslaten is precies terug. `nudge.back/fwd`
  (50 ms springen) bestaat nog voor het toetsenbord.
- Pitchbereik per track: ±8, ±16 (standaard) of ±50% (`PITCH_BEREIKEN` in
  `deck.js`, action `track.N.pitch.range`). De fader blijft 0..1, de engine
  schaalt. Bereik wisselen laat het tempo staan; alleen de faderstand verschuift.
  Sync mag verder (0,5–2): dan staat de fader tegen de aanslag (read geklemd).
  Een nieuw nummer begint op 0% pitch (`_naLaden`); het bereik blijft staan.
- De tempo-encoder van de APC stuurt `track.N.tempo`, NIET de pitchfader:
  lineair over de hele rate (0,5–2×), 0,1% per tik (shift 0,01%), read niet
  geklemd. Via de geklemde pitch-read sprong één tik na een sync buiten het
  bereik van 1,30 naar 1,16.
- De master-"limiter" is een `DynamicsCompressor`, geen look-ahead limiter.
- Er zijn twee soorten loops naast elkaar: in seconden en in tellen. De
  beat-loops klikken in op het grid; zonder grid doen ze niets.
- Een loop wordt geklemd op het trackeinde, dus `loop 4s` vlak voor het eind geeft
  een kortere loop. Correct gedrag.
- Springen (seek, hotcue, cue) naar een plek BUITEN de loop verlaat hem; binnen
  blijft hij staan. Fasecorrectie (sync, nudge) vouwt terug in de loop via
  `seek(p, { binnenLoop: true })`: een verschuiving van een paar ms mag de loop
  niet opheffen. Vroeger landde een hotcue tijdens een loop ergens ín de loop.
- Een mislukte laad laat cue en hotcues van de track staan; een loop vanaf 0 s
  vloeit bij de naad niet meer naar stilte (er staat niets vóór 0).
- De nummers in `devices/apc40mk2.js` komen uit Akai's protocoldocument v1.2
  (tabellen op p13-17 en p23-26), niet uit herinnering. Wijk er niet van af
  zonder het document erbij. Twee dingen die makkelijk misgaan: de grid-noten
  lopen van ONDER naar boven (0x00 is linksonder), en de device knobs melden
  alleen in generic mode (0x40) via het MIDI-kanaal bij welke trackstrip ze
  horen. Wij draaien in 0x42 (zie hieronder): daar staan ze op kanaal 0.
- De UI stuurt de engine aan via actions, maar VOLGT hem ook: knoppen en faders
  op het scherm lezen elke frame hun stand terug via `read()`. Zonder dat loopt
  het scherm achter zodra er een tweede bron is (MIDI, en straks automatisering).
- Een rack bewaart per macro alleen de `default`. De live knopstand is
  sessietoestand en gaat nergens heen — anders is elk rack na drie seconden
  spelen "gewijzigd" en verdrink je in opslaan-vragen.
- De rack-editor toont eerst de acht KNOPPEN, dan de keten als effecten met
  draaiknoppen in echte eenheden (`eenheid` per effect in `fx.js`, dezelfde
  formule als `zet()` — wijkt er één af, dan liegt het scherm). Drie soorten
  wijzigingen: KETEN (erbij, weg, volgorde, aan/uit) bouwt opnieuw via
  `zetRack(..., { behoudStanden: true })` met kruisfade; een PARAMETER gaat via
  `zetParam()` zonder nieuwe keten; MACRO'S (bereik, venster, curve) via
  `bewerkMacros()`, geen node. Een parameter die door een knop gestuurd wordt
  is op het scherm niet te draaien: de knop wint, dus draaien zou liegen.
  Tijdens het slepen wordt niets opnieuw getekend.
- Een knop instellen gaat op het gehoor: DICHT zet hem op 0, OPEN op 1, en elke
  draai aan een effect wordt die kant (`neemOp()` in `rack.js`: `from` = dicht,
  `to` = open, wat venster en curve ook zijn). Een parameter die de knop nog
  niet stuurde komt erbij met zijn huidige stand als andere kant; worden beide
  kanten gelijk, dan verdwijnt de koppeling. Draai je aan de knop zelf (scherm,
  FX-rij, APC), dan stopt het instellen — gecontroleerd op een timer, niet in
  de animatielus, want die staat stil als het venster achter iets anders zit.
- Glijden per knop (`macro.glide`, seconden, hooguit 600): de KNOP staat meteen
  waar je hem zet (`leesPlek`, dat leest soft-takeover), het GELUID glijdt
  (`plekEffectief`, afgeleid van de audioklok). Een timer van 33 ms geeft de
  tussenstanden alleen door; `_pasMacrosToe` stuurt alleen wat echt veranderd
  is, anders bouwt een gate 30x per seconde zijn buffer opnieuw. De editor
  zet bij DICHT/OPEN en startstand `direct: true`: instellen wacht niet.
- Kant-en-klare racks staan in `racks/sjablonen.json` en zijn voor elk nummer
  te kiezen. Laden geeft herkomst `"s:<nr>"`; bewaren overschrijft alleen een
  GETAL (library-id), dus een sjabloon wordt altijd een nieuw rack van het
  nummer. `rack.test.mjs` loopt elk sjabloon na: bestaat elke parameter, staat
  geen parameter op twee knoppen, staat het filter open bij de beginstand.
- `fx.herkomst` zegt uit welk bewaard rack wat er klinkt komt (library-id), of
  null. Bewerken in de editor houdt hem; elk ander rack (volgend effect, los
  effect) wist hem. Bewaren schrijft ALLEEN over een rack heen als de herkomst
  klopt, anders wordt het een nieuw rack. Zonder die regel overschreef
  "volgend effect + bewaar" een bewaard rack met één los effect.
- Elke knopplek heeft een DRUKvariant (Clay 23 sep): `track.N.fx.knob.K.hold`
  en `send.a/b.knob.K.hold`. Indrukken = vol open (direct, geen glijden),
  loslaten = terug naar de stand van vóór het drukken. Wisselt het rack tijdens
  het drukken, dan niet terugzetten. Op het scherm: alt + vasthouden (shift is
  al fijn slepen). Op de APC nog geen knop toegewezen; voorstel voor vrije
  knoppen (Lock, Detail View) in `docs/VERBETERINGEN.md` ronde 3.
- Botsen twee macro's op dezelfde parameter, dan wint de HOOGSTE plek. Saai en
  voorspelbaar; "laatste in de lijst wint" hangt van de volgorde af.
- Een onbekend effecttype in een rack wordt NIET weggegooid: het blijft als ruwe
  JSON bewaard, staat uit, en komt er bij het opslaan ongeschonden weer uit.
  Eén keer openen in een oudere versie mag geen rack slopen.
- **Het scherm spiegelt de APC40 mkII** (sinds 23 september 2026): onder links
  acht kolommen precies zoals een APC-kolom (track knob · 5 pads · Clip Stop ·
  Track Select · 2×2 · fader), rechts het focusdeel (scene launch, transport,
  device knobs 2×4, pijlen/shift, masterfader, crossfader), boven de track met
  focus groot plus acht dunne banen. Wat een knop doet komt UIT DE MAPPING:
  elk element heeft een `data-sig`, en `leesControl()` (spiegel-plan.js) vraagt
  `mapping.kies(sig)` + `resolveTarget` — shift, open mapje en focus tellen mee.
  Herberekend bij mapping-`change`, `shift`, lagen-`change` en focuswissel. Is
  de geladen mapping niet voor een APC, dan leest het scherm een eigen
  exemplaar van `mappings/apc40mk2.json`. Raak je de APC aan, dan licht het
  element 300 ms op (`geraakt` uit midi-opzet.js -> `spiegel.markeer`). Knoppen
  lezen hun action bij het INDRUKKEN, en loslaten gaat naar dezelfde action.
  Maat: past op 1440×900 (daar verdwenen eerst de banen achter de kolommen):
  het focusdeck houdt zijn hoogte, de banen staan in twee kolommen, faders
  krimpen mee, onder 900 px hoogte compacter. Per kolom bovenaan resterende
  tijd (14 px, rood onder 30 s als hij speelt) en BPM, groot genoeg voor de
  zaal. Labels ≥ 11 px. APC-knopnamen alleen in de KOPPELMODUS (anders ruis).
  MAAT-badge zegt "(stil)" als de maatgever stilstaat; hotcues overal geel met
  nummer; foutmeldingen blijven staan tot je ze wegklikt. De renderloop leest
  het focusoverzicht uit een cache en schrijft alleen wat verandert.
- Vensters bestaan nog, maar als MODEL (`staat.venster`), niet als UI:
  L = de track met focus (volgt engine.focus), R = de VORIGE focus-track
  (`volgFocus`/`zetTweede` in spiegel-plan.js). Het toetsenbord volgt dat
  (`{L}`/`{R}`): linkerhand = focus, rechterhand = waar je vandaan kwam, I =
  wisselen. `window.L.show.N` = focus op N, `window.R.show.N` = N als tweede.
  De RACK-rij en de rack-editor horen bij de track met focus.
- Clip/Device View (`layer.device.view`) licht alleen op in het RACK: een
  kiesknop met meer mapjes brandt niet in zijn standaardmapje.
- Crossfader-toewijzing per track: A, B of thru. Standaard 1 op A, 2 op B, de
  rest thru — zo klinkt een set voor twee als vroeger.
  Eén plek voor de kant, op scherm én APC: de A|B-knop in het 2×2-blok
  (`track.N.xfade.side`, rondlopen A → B → thru). Op de APC de tweekleurige
  LED (geel = A, oranje = B, uit = thru), op het scherm de letter in die
  kleur. De drie segmenten van C3 zijn weg van het scherm; de actions
  `track.N.xfade.a/.thru/.b` bestaan nog om te koppelen.
- Sync kent geen "het andere deck" meer: een track synct naar de track die je
  het hardst hoort (fader × crossfader, spelend, met grid). Speelt er niets,
  dan de eerste geladen track met grid.
- De action-bus spreekt in TRACKS (`track.1.filter`), de engine in decks (A, B).
  De vertaling staat op één plek: `TRACKS` in `actions.js`. `{focus}` in een
  mapping wordt een tracknummer. Mappings van versie 1 (`deck.A.…`) en 2
  (Nederlandse namen: `fx.knop`, `sampler.1.wis`, `venster.L.toon.3`…) worden bij
  het laden omgezet door `migreerAction()` (`NIEUWE_NAMEN`); niet weghalen, er
  kunnen nog geëxporteerde bestanden rondslingeren. Sinds versie 3 (23 sep) zijn
  ALLE action-namen Engels; labels op het scherm blijven Nederlands.
- De FX-knoppen wijzen naar een PLEK (`track.1.fx.knob.1`), niet naar een
  parameter. Wissel je van effect, dan betekent plek 1 iets anders en hoef je
  niets opnieuw te koppelen. Dat is de opzet waar de effect-racks op verder
  bouwen: het rack bepaalt wat een plek doet, de mapping blijft staan.
- Zet nooit `setTargetAtTime` op een AudioParam waar nog een `setValueCurveAtTime`
  op loopt: Web Audio gooit dan een NotSupportedError die je hele aanroepketen
  meeneemt. Gebruik `zetDoel()` uit `fx.js`; die breekt de curve eerst af met
  `cancelAndHoldAtTime`. Dit gebeurt precies wanneer je aan de mix draait vlak
  na een effectwissel — dus tijdens het spelen.
- Een tempo-gesynchroniseerd effect krijgt zijn klok van het DECK, niet van een
  grid dat het zelf opzoekt: `fxKlok()` levert de hoorbare tellengte plus het
  moment waarop de volgende tel valt op de audioklok. Herankeren is verplicht
  bij seek, hotcue, tempowijziging en gridbewerking — vergeet er één en je gate
  loopt na twintig minuten een zestiende naast.
- Gate en sampler lopen EXACT op de maat via `playbackRate`, niet via de
  bufferlengte: een buffer heeft hele samples, dus een periode die een fractie
  van een sample afwijkt loopt weg (gemeten ~1/16 naast na 26 min). Gate: buffer op
  hele samples, rate maakt de periode exact, buffer hergebruikt bij kleine
  tempowissels. Sampler: rate = duur / (tellen × tellengte).
- Starten op de tel gaat via `startOpDeTel()` (fx.js): valt de volgende tel
  binnen de uitgangsbuffer, dan wordt het de tel erna. Anders start het
  blijvend een paar ms te laat (Web Audio begint een bron in het verleden gewoon nu).
- **Q van een Web Audio-lowpass is een piek in DECIBEL, geen factor.** De
  standaard (1 dB) is al 12% boven 1 bij de afsnijfrequentie. In een
  feedbacklus groeit dat: de reverb zwol aan in plaats van uit te sterven, en
  de delay op volle feedback deed hetzelfde (lusversterking 1,03). Elk filter
  in een lus krijgt een negatieve Q; `engine.test.mjs` controleert het.
- De reverb is een FDN (acht lijnen, Householder-matrix), geen ConvolverNode:
  alleen zo kan freeze vasthouden (invoer dicht, lus verliesloos). Galmtijd
  meet je aan de HELLING van het uitsterven, niet aan de eerste -60 dB na de
  piek; zo gemeten klopt de knop (3,46 s beloofd, 3,5 s gemeten).
- Delaytijd wordt NIET verschoven op één DelayNode: dat laat de toonhoogte van
  de echo glijden (gemeten: een toon van 1000 Hz zwiepte tot 4293 Hz). Er zijn
  twee leeskoppen op hetzelfde signaal; een nieuwe tijd gaat op de stille kop
  en daar wordt 80 ms naartoe gefaded (5 Hz afwijking). Snel draaien wacht tot
  de fade klaar is en pakt dan de laatste stand — twee fades over elkaar
  klikken. Loopt de audio niet, dan direct: een fade op een stilstaande klok
  wordt nooit klaar.
- Effecten wisselen gaat NOOIT door de bedrading te veranderen waar signaal
  doorheen loopt: twee complete ketens equal-power kruisfaden, en de oude pas
  opruimen na fade plus staarttijd. `disconnect()` is niet sample-accuraat en
  klikt; of je het hoort hangt af van het niveau, dus je merkt het pas laat.
- Het deck weet niet HOE er geluid uit een track komt; dat staat in `bron.js`.
  Transport, cues, loops en grid zijn muzikaal, de bron is technisch. Daardoor
  kan er een time-stretcher (keylock) of een streamende leeslus voor in de
  plaats zonder dat het deck verandert. Een bron moet regel 3 waarmaken:
  positie uit `ctx.currentTime`, nooit een eigen teller.
- De AudioContext wordt expliciet op 48 kHz gezet, gelijk aan wat de ingest
  levert. Laat je dat aan de geluidskaart over, dan hersamplet `decodeAudioData`
  en klopt de golfvorm niet meer.
- De server stuurt COOP/COEP-headers. Dat is nu nog nergens voor nodig, maar het
  is de voorwaarde voor SharedArrayBuffer in de streaming-engine, en het kost
  vandaag niets omdat de pagina geen enkele cross-origin verwijzing heeft.
- Het beatgrid staat in TRACKTIJD, niet in afspeeltijd. Draait een deck op
  1,05x, dan verschuift het grid niet — de track klinkt alleen sneller. `deck.bpm`
  is de hoorbare bpm (grid × rate); `grid.bpm` is wat er op de plaat staat.
- Een beatgrid hoort bij de link, net als een effect-rack. Eén keer uitmeten en
  hij klopt voorgoed, op welke track je hem ook laadt (schema v2).
- **Teken de golfvorm NOOIT met `buffer.sampleRate`.** De server rekent peaks op
  48 kHz, maar `decodeAudioData` hersamplet naar de snelheid van de geluidskaart.
  Op een 44,1 kHz-kaart trekt dat de golfvorm 8,8% uit de pas — gemeten
  correlatie met de audio zakte daardoor van 0,95 naar 0,004. Gebruik
  `effectieveSampleRate(count, perBucket, duration)`; die klopt per definitie.
- Peaks worden bij de ingest uitgerekend en op schijf gezet (`peaks.bin`, per
  bucket een min en een max als float32). De browser leest dat bestand en valt
  alleen terug op zelf rekenen als het er niet is. Het formaat is identiek aan
  `computePeaks()`; `analyze.test.mjs` vergelijkt ze bit voor bit.
- Video is SLAAF van de audio (`src/video/`, fase 4). Klein verschil: een
  fractie sneller of trager (hooguit 10%); boven 150 ms: springen, naar waar
  de audio is ALS de seek klaar is (gemeten seekduur per video). Het doel is
  wat je HOORT: deckpositie min uitgangsvertraging. Zichtbaarheid = fader ×
  crossfader; wat onzichtbaar is wordt gepauzeerd en niet geüpload. Het losse
  venster (`video.html`) toont het canvas van het hoofdvenster via
  captureStream: er wordt één keer gemengd.
- De video's hebben een sleutelbeeld per 8,3 s (zoals YouTube ze levert).
  Springen midden in zo'n stuk laat de decoder tot 8 s beeld doorrekenen.
  Clay zag loops en sprongen op 23 september 2026 netjes meelopen, dus de GOP
  blijft zoals hij is. Hapert het ooit alsnog: kortere GOP bij de ingest
  (-g 30), niet slimmer springen.
- Het videobeeld gaat in drie shaderstappen: mengen (mengvorm) -> effecten
  (met het VORIGE eindbeeld voor sporen, twee buffers om de beurt) -> tonen.
  Vast op 1280×720. Het paneel is een inklapbare kolom rechts in `main`, naast
  kolommen en focusdeel (CSS `main:has(> .video-panel:not(.hidden))`), nooit
  een laag over de bediening. Effecten en mengvorm staan op de action-bus
  (`video.fx.*`, `video.mode`, via `bindVideo`), dus ze zijn te koppelen.
  Effecten op de tel (`video.pulse`, `video.pulse.target`): de maat komt van de
  track die het hardst klinkt, speelt en een grid heeft, op het moment dat je
  hem HOORT. De puls komt bovenop de knopstand en dooft binnen een halve tel.
  Meet je dit, meet dan NIET precies op de tel: door afronding val je dan op
  het einde van de vorige tel en zie je niets.
  Testen zonder zichtbaar venster: geef de mixer een canvas als nep-video,
  en maak dat testbeeld ASYMMETRISCH (vier verschillende kwarten). Een beeld
  dat alleen links-rechts verschilt verstopte dat sporen ondersteboven stond:
  een buffer-texture staat omgekeerd t.o.v. een video-texture.
- Chrome laadt en decodeert geen media in een tabblad dat niet zichtbaar is,
  en pauzeert daar de animatielus. Video-gedrag test je dus met het venster
  vooraan; in een achtergrondtab meet je niets.
- Opnemen tapt de master NA de limiter: wat de zaal hoort. De worklet geeft
  per seconde een stuk; elk stuk gaat met `?frame=N` (frames van de audioklok)
  en de server schrijft het OP DIE PLEK, niet erachter. Daardoor is herhalen
  na een verloren antwoord veilig (geen dubbel stuk), en wordt een weggevallen
  stuk stilte op zijn plek in plaats van dat alles erna t.o.v. de video
  verschuift. `klaar?frames=N` vult een weggevallen staart aan. Een crash kost
  hooguit een seconde. De WAV-kop krijgt zijn lengte pas bij "klaar" (alleen
  hele frames); is dat nooit gebeurd, dan herstelt `lijst()` hem bij het
  opstarten uit de bestandsgrootte. Alleen op 48 kHz: de kop zegt 48000.
  Nieuwe opnames hebben een kop van 80 bytes met een JUNK-chunk die boven
  4 GB (~6,2 uur) `ds64` wordt: RF64 (ffmpeg las 7 uur volledig). Oude koppen
  worden geklemd met een waarschuwing. Starten via de APC zet de AudioContext
  aan of weigert duidelijk; verloren videostukken gaan naar `onFout` (scherm).
- Met video erbij: naast de WAV een set-<id>.mp4 (H.264, 1280×720, 30 fps,
  8 Mbit/s — ~3,6 GB per uur) met eigen geluidsspoor, via MediaRecorder op
  het mixer-canvas. mp4 als Chrome het kan, anders webm. Ook per seconde
  weggeschreven. Tijdens een video-opname rendert de mixer door, ook als het
  paneel dicht is, anders neem je zwart op. Maar NIET in een achtergrondtab:
  dan staat `requestAnimationFrame` stil en bevriezen zowel de beamer (het
  losse venster toont het canvas van het hoofdtabblad) als de video-opname.
  Hoofdtabblad dus zichtbaar houden (ronde 3: mengen naar het losse venster). Het beeld loopt een paar ms
  achter op het geluid in de video (de mixer mikt op wat je HOORT, de
  opname-tap zit vóór de uitgangsvertraging): minder dan één beeld.
- Sends: per track A (echo) en B (galm), getapt NA de fader en vóór de
  crossfader, naar twee gedeelde bussen in de engine (`engine.sends`). Een bus
  is een gewone InsertSlot met een rack (`SEND_RACKS`), maar helemaal nat: het
  droge signaal komt al via de track. Fader dicht = niets meer insturen, de
  staart sterft vanzelf uit (echo-out). Het insert-effect per track zit
  daarentegen VÓÓR de fader en wordt dus mee dichtgedraaid. Sendknop is
  kwadratisch: het eerste stuk subtiel, het laatste gooit.
  Bewust vóór de crossfader (Clay, 23 sep): wegdraaien met de crossfader
  stuurt nog in, zodat echo-out ook met de crossfader werkt.
- De delay kan op de maat (`sync`, Clay 23 sep: "met een schakelaar"). Op de maat
  kiest dezelfde tijdknop een deling uit `ECHO_DELINGEN` (1/16 … 1/1, kort naar
  lang) × de hoorbare tel van de klok; vrij is het weer 20 ms–1,2 s. Zonder klok
  houdt hij de laatst bekende tel (niet terugvallen: dat verspringt midden in een
  set). Tempo/seek/grid herankert, via `wissel()` dus zonder doppler. De bussen
  horen bij geen deck: de engine herankert ze bij elke 'change' van een deck.
  Echo-bus: standaard op de maat, 1/4 tel, knop 4 = schakelaar. `toonWaarde`
  krijgt een `lees` mee zodat de eenheid ("1/8 tel" of "250 ms") klopt.
- Sampler: een lege pad knipt de laatste N tellen van de track met FOCUS, in
  tracktijd, eindigend op de laatste tel vóór de positie (`knipBereik`). Een
  streamende track wordt daarvoor opnieuw van schijf gelezen (`bron.knip`),
  want de pagina's zitten in de worklet. Afspelen: loop, gestart op de
  volgende tel van de klok die sync ook gebruikt, op diens tempo
  (playbackRate = hoorbare bpm / sample-bpm). De naad wordt bij het knippen
  al naadloos gemaakt (`naadloos`).
- Sampler-pads horen bij het NUMMER (schema v4, tabel `samples`; Clay 23 sep).
  Bewaard wordt alleen WAAR het stuk zit (van/tot in tracktijd, tellen, bpm),
  geen audio: herstellen knipt opnieuw van schijf. De engine kent geen library:
  de sampler heeft `herinneringen` (pure data) en meldt `onGevuld`/`onVergeet`;
  de app vult en bewaart. Laad je het nummer, dan staan zijn pads als "bewaard"
  (↺) op lege pads; klik = terughalen, ongeacht focus of positie. Shift op een
  gevulde pad = leeg (blijft bewaard); shift op een lege, bewaarde pad = vergeten.
  Een track die iets anders laadt neemt zijn herinneringen mee weg. Pads van een
  los bestand of de demo worden niet bewaard.
- Spelende pads lopen mee met de maat (Clay 23 sep): tempo én tel. Elke pad
  houdt een segment { T, P, R } bij (regel 3). `heranker()` rekent uit waar de
  pad op de volgende tel van de maat is; daar start een nieuwe bron op het
  nieuwe tempo, op de dichtstbijzijnde hele tel van het sample, en de oude
  vloeit er 5 ms in over. Klopt tempo en fase al, dan gebeurt er niets. De
  engine roept dit (en `heranker` van de bussen) aan bij elke 'change' van een
  deck of van de mixer: niemand anders weet wanneer de maat verandert.
- Verbeterronde 23 september 2026 (vier auditagenten). Wat daaruit vastligt:
  - Tap tempo deelt door `d.rate`: je tikt wat je HOORT, het grid staat in tracktijd.
  - Transport is klikvrij: BufferBron vloeit 4 ms in/uit per start (`DECLICK`);
    de streamkern vloeit bij elke segmentwissel 4 ms over (`vorig`/`wisselT`)
    en ziet een gat 3 ms vooruit aankomen (`GAT_FADE`, `staat.env`).
  - De gate laat de oude puls doorlopen tot de nieuwe op de tel begint.
  - `ctxTimeOf`/`ctxTijdVan` houden rekening met een loop die al rondging.
  - Elk effect heeft `vernietig()` (oscillatoren en bronnen stoppen); `_ruimOp`
    roept die aan. Losmaken alleen lekte complete ketens.
  - `zetCurve` breekt een lopende curve eerst af (`cancelAndHoldAtTime`): twee
    rackwissels binnen 40 ms gooiden anders NotSupportedError. De mock in
    engine.test is daarom net zo streng als Chrome over overlappende automatisering.
  - StreamBron.laad nummert elke laad en controleert na elke await; de app doet
    hetzelfde (`nieuweLaad`/`nogDeLaatste`). Opnemer: start en stop na elkaar.
  - Server: witte lijst voor statische bestanden, Range geklemd, POST-routes
    alleen JSON, racks bijwerken/wissen alleen binnen het eigen nummer, ingest
    in een werkmap (`media/.bezig-*`) en pas bij succes verhuizen, video-id
    gecontroleerd, migraties in een transactie. `VARVE_DB`/`VARVE_OPNAMES`/
    `VARVE_MEDIA` voor tests (een testserver ruimde anders `.bezig-*` op in de
    echte media/).
  - Server, tweede ronde (d2f6844): de witte lijst kijkt naar het pad NÁ
    decoderen en normaliseren; `%2f`, `%5c`, `..`-segmenten en backslashes
    worden geweigerd (`/src/..%2fmedia%2flibrary.db` gaf 200). Mediatype exact
    `application/json`; Host alleen localhost/127.0.0.1/[::1] met de eigen poort
    (DNS-rebinding); Origin moet gelijk zijn bij alles behalve GET/HEAD
    (zonder Origin mag het, voor curl). Peaks, onset en tap-verfijning draaien
    in een `worker_thread` (`analyse-werker.js`), bit-identiek: de langste
    blokkade was 2,6 s bij verfijnen, nu enkele ms — anders gaten in spelende
    decks, want de server levert ook hun pagina's. Tap-verfijning scoort
    ±45 s rond `positie` (tracktijd) als die meekomt: lange albums hebben
    tempowissels. Na een serverwijziging: server herstarten.
  - UI: fouten naar `meld()` (strook onderaan), nooit alleen console. Geen
    `prompt()` (legt de pagina stil). Library = toets B (L is hotcue 3 van de
    vorige focus, `{R}`). Sneltoetsen alleen uit tijdens TYPEN (`isTypen`).
    Het toetsenbord negeert alles met Cmd/Ctrl/Alt (Cmd+F startte een hotcue)
    en laat alles los bij blur of een verborgen tabblad; loslaten gaat naar
    de action van het indrukken, ook met shift. Eén onderpaneel tegelijk
    (library, MIDI, rack-editor: `sluitOnderpanelen`), Esc sluit. Destructief = tweede klik
    binnen 3 s (laden over een spelende track, nummer weghalen, opname stoppen,
    mapping resetten, DICHT/OPEN op een hoorbare track). Eigen MIDI-mapping op de
    server (`/api/mapping`, instellingen-tabel) en in localStorage als reserve;
    bij opstarten gaat de server voor. "Standaard herstellen" wist beide, zodat
    de app daarna weer `mappings/apc40mk2.json` volgt (Clay 23 sep, E3). MAAT-badge toont wie de maat geeft.
- Een effect-rack hangt aan een LINK (`tracks.id`), niet aan een fader. Laad je
  hetzelfde nummer op een andere track, dan komen zijn racks mee. Meerdere per
  nummer, één actief. De inhoud is JSON: wat er ín een rack staat is een zaak
  van de FX-laag, zodat het schema niet mee hoeft te veranderen met elk effect.
- Alles wat naar buiten gaat loopt door een wachtrij: maximaal 16 berichten per
  4 ms. Comet (Chromium 152) legt zijn eigen MIDI-service om bij een burst —
  vier crashes op 22 september 2026, alle vier in `MidiService_TaskService_Thread`
  op dezelfde codeplek. Dat is hun bug, maar honderd berichten in één synchrone
  lus is sowieso geen net gedrag. Alleen bij het sluiten van de pagina mag het
  direct, want dan is er geen volgende tik meer.
- ÉÉN VARVE-tabblad praat met de APC (`tabblad.js`, Web Lock `varve-mixer`).
  Op 23 september 2026 om 20:27 crashte Chrome in `MidiService_TaskService_Thread`,
  op dezelfde plek als de vier crashes van 22 sep; vermoedelijk omdat vier
  VARVE-tabbladen tegelijk init en LED's naar de APC stuurden (twee
  testtabbladen, een agent-tabblad en dat van Clay). Wie de lock heeft is het
  tabblad; een tweede tabblad vraagt helemaal GEEN MIDI-toegang aan
  (`midi-opzet.js` wrapt `midi.init`) en neemt het pas over als het eerste
  sluit. Een lock verdwijnt ook bij een crash, dus er blijft geen spook hangen.
  Uitzondering: `apc.html` vraagt zelf MIDI-toegang aan, zonder sysex en zonder
  iets te sturen (alleen meelezen), en doet niet mee aan de lock.
  **Regel voor sessies:** open NOOIT een extra VARVE-tabblad terwijl de APC
  aangesloten is en Clay's tabblad open staat. Vraag Clay eerst de APC los te
  koppelen, of test met zijn toestemming in zijn tabblad. De lock beschermt
  pas vanaf deze versie; een tabblad met oude code in het geheugen doet niet mee.
- De hub telt alleen poorten met state `connected`: Chrome laat een
  losgetrokken poort staan (`disconnected`), dus opnieuw aansluiten gaf eerst
  geen init en dode LED's. Valt de invoer weg, dan laat `mapping.losgekoppeld()`
  shift en ingedrukte knoppen los.
- De hub negeert echo's: een bericht dat identiek is aan wat wij net stuurden en
  binnen 60 ms terugkomt, bereikt de mapping niet. Zonder die rem maken de
  LED-ringen een lus — wij zetten een ring, het apparaat meldt de stand terug,
  wij verwerken dat als een knopdraai — en loopt de bus vol. Het filter is per
  apparaat uit te zetten (`echoFilter` in het profiel); voor de APC staat het
  nog AAN tot gemeten is dat hij in 0x42 niets terugkaatst (`hub.status().echoes`
  na een sessie nog 0 → mag uit).
- MAPJES (lagen) en SHIFT op de controller (Clay, 23 sep, VRAGEN B3). Een regel
  kan `"shift": true` en/of `"laag": "device.rack"` hebben; de sleutel is
  `sig[#shift][@laag]`, dus één knop heeft meerdere regels. `mapping.kies()`
  zoekt: met shift eerst shift-regels, dan gewone (een fader blijft werken met
  shift vast); binnen elk eerst het open mapje, dan zonder mapje. Loslaten gaat
  ALTIJD naar de action van het indrukken (`mapping.vast`), ook als shift of het
  mapje intussen wisselde. De shiftknop staat bovenaan de mapping (`"shift"`)
  en gaat nooit de bus op. Groepen en mapjes staan in `lagen.js`. HERZIEN na
  het onderzoek (`docs/APC40-onderzoek.md`, Clay 23 sep): de KERN zit nooit in
  een mapje — één kolom = één track (filter boven, fader onder, play/sync/A-B
  in het 2×2-blok, cue onder shift), rechts de strip van de focus-track in DJ-mixervolgorde.
  Alleen twee groepen: `device` (strip ↔ rack, één oplichtende knop) en `grid`
  (hotcues/loops/sampler/video op de scene-knoppen, elk een eigen kleur).
  Kort drukken = vast, vasthouden ≥ 400 ms vanuit een ander mapje = gluren.
  Kiesknoppen zijn actions (`layer.<groep>.<knop>`, `layer.grid.next/prev`). Koppelen komt in het mapje
  dat open staat, en met shift vast in de shift-laag. De LED's volgen
  `mapping.actieveRegels()`; wat bij een dicht mapje hoort gaat uit, en het
  ringtype wisselt mee. `mapje-balk.js` toont bij elke wissel wat de knoppen
  doen. De standaardmapping (269 regels) is gegenereerd volgens de tabel in
  `docs/APC40.md`; aanpassen mag gewoon in de JSON of met koppelen.
  `apc.html` is een interactieve kaart: één APC met de knoppen op hun ECHTE
  plek (uitgemeten op de Features-tekening, User Guide p4: apparaat x 70–1040,
  y 392–970 → procenten). Schakelaars voor grid-modus, strip/rack en shift;
  klik = uitleg (nu, met shift, per modus); zoeken markeert waar een functie
  zit; kleur per soort. Hij luistert zelf mee met de APC (alleen invoer, stuurt
  niets) en volgt shift en modusknoppen via een eigen Mapping die alleen
  `layer.*` uitvoert. Wat een knop doet komt uit de mapping via `kies()`; geef
  een nieuwe action een uitleg in `apc-beschrijf.js` (de test eist dat).
- De LED-laag leest de MAPPING, niet de engine. Koppel je een pad aan iets
  anders, dan verhuist zijn lampje vanzelf mee. Er is bewust geen tweede tabel.
- LED's in drie standen uit `read()` (VRAGEN B4): `null` = UIT (niets te doen,
  bv. hotcue op een lege track), donkergrijs = leeg maar bruikbaar, DONKERE
  kleur = gevuld/dicht, volle kleur = actief. Donker is paletindex n+1 (de
  #59xxxx-tinten), NIET de "zacht"-pastels (12/36/44/48): die zijn op het
  apparaat even fel als de volle kleur, dus gedimd zou niet te zien zijn. Zo zijn een
  gevulde en een spelende sampler-pad te onderscheiden. De LED's volgen shift
  (wis-regels rood zolang shift vastzit); On/Off brandt als het effect AAN staat.
- Knipperen op de tel rekenen we ZELF (B2), niet met het knipperkanaal van de
  APC (dat vraagt MIDI clock): `track.N.phase` = gridfase op positie min
  uitgangsvertraging, dus op wat je hoort. Loop-pads knipperen zolang ze aan
  staan; de Track Select van de maatgever knippert omgekeerd. Een kwart tel
  fel, twee berichten per LED per tel.
- De 16 ringknoppen (track knobs en device knobs) staan in modus `endless`:
  de knop stuurt absolute waarden, maar we gebruiken alleen het verschil met
  zijn vorige waarde, opgeteld bij de softwarestand. De ring toont al die
  stand, dus na een focus- of mapjewissel draai je meteen door vanaf wat je
  ziet, zonder overpakken. Faders (geen ring) houden absolute + soft-takeover.
- LED's lopen op een eigen `setInterval`, niet op de renderloop: `requestAnimationFrame`
  staat stil zodra het venster naar de achtergrond gaat, en dan zouden de lampjes
  bevriezen terwijl de muziek doorspeelt.
- De APC draait in mode 0x42, Alternate Ableton Live (Clay, 23 sep, VRAGEN
  B1). Alles momentary, ALLE LED's en ringen van ons, Track Select stuurt MIDI,
  de device-sectie is NIET gebankt: device knobs op kanaal 0 (`cc:0:16-23`),
  gemeten. Welke track ze bedienen bepaalt de mapping met `{focus}`
  (`track.{focus}.fx.knob.1-8`). Controls per trackstrip (fader, activator,
  solo, clip stop, track select) melden via het KANAAL welke strip.
  Na loskoppelen staat hij weer in generic (0x40): init opnieuw bij elke hotplug.
  In generic mode verhuisde de device-sectie mee met de geselecteerde strip
  (bank 1-8 = kanaal 0-7) en stuurde Track Select niets; daar rekende de oude
  standaardmapping mee, en dat klopte in 0x41/0x42 niet.

## Onderzochte keuzes

De uitkomsten van het onderzoek van 22 september 2026 staan in ROADMAP.md onder
"Onderzocht en vastgelegd". Kort wat daar voor de architectuur uit volgt:

- Het deck staat achter één interface (`src/engine/bron.js`), zodat
  `AudioBufferSourceNode`, een time-stretcher en een streamende leeslus
  inwisselbaar zijn. Gebouwd op 22 september 2026; keylock is nu een bronwissel.
- Keylock wordt Signalsmith Stretch (MIT, één gevendord bestand). Niet
  SoundTouch: WSOLA warbelt op aangehouden polyfone klanken, en dat is precies
  dit repertoire. Niet Rubber Band: GPL, en een browser-app serveren is
  distributie — dat zou de hele app GPL maken zodra hij op varve.nl staat.
- Streamen gebruikt een pagina-cache op samplepositie met vastgepinde pagina's
  voor hotcues, geen ringbuffer. Een ringbuffer gaat uit van vooruit consumeren;
  een deck springt en gaat achteruit.

## Werkwijze die hier werkt

- Eén fase per keer. Maak fase N af en laat hem draaien voordat fase N+1 begint.
- Bij een keuze met gevolgen: benoem de trade-off en kies, wacht niet op goedkeuring.
- Meld het expliciet als iets een aanname is die verkeerd kan zijn.
- Geen features bouwen die niet gevraagd zijn, ook niet als ze voor de hand liggen.
