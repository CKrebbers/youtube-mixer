# YouTube Mixer — projectgeheugen

Lees dit voordat je iets wijzigt. Dit bestand is de bron van waarheid voor
architectuurbeslissingen; `ROADMAP.md` is de bron van waarheid voor de volgorde.

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
                    engine.js       decks + mixer + snapshot()
  control/          actions.js      DE ACTION-BUS — alles gaat hierdoorheen
                    keyboard.js     toetsen -> actions
                    midi.js         Web MIDI: poorten, parsen, sysex. Kent geen actions.
                    mapping.js      signature -> action, soft-takeover. Kent geen hardware.
                    feedback.js     engine-stand -> LED's, met diffing. Leest de mapping.
                    midi-learn.js   action kiezen, control bewegen, gekoppeld
                    devices/        apc40mk2.js, generic.js — wat er op het apparaat zit
  analysis/         peaks.js        golfvorm-peaks + ruwe RMS
                    demo-track.js   synthetische 124-bpm testtrack
  ui/               app.js, waveform.js, controls.js, midi-monitor.js,
                    mapping-panel.js (de lijst), learn-mode.js (aanwijzen op het scherm),
                    rack-editor.js (racks bouwen met de muis, werkt op een kopie)
  video/            volg.js         hoe een video de audio volgt. Puur rekenwerk.
                    video-mixer.js  <video> per track, gemengd met WebGL2. Leest de engine alleen uit.
  lib/              emitter.js      Emitter + clamp/lerp/expMap/dbToGain/fmtTime
server/             draait apart: `node server/index.js`
  index.js          HTTP, statische bestanden (no-store), ingest-API, library-API
  ingest.js         yt-dlp -> ffmpeg -> media/<id>/. Gooit nooit; geeft resultaat terug.
  library.js        SQLite via node:sqlite. Tracks, peaks, effect-racks.
  analyze.js        golfvorm-peaks én onset-envelope vooraf, streamend uit ffmpeg
  detect.js         FFT, onset-envelope, tempo, segmentatie. Geen dependencies.
mappings/
  apc40mk2.json     standaardmapping (data, geen code)
  generic.json      leeg startpunt
racks/
  sjablonen.json    kant-en-klare racks voor elk nummer (data, geen code)
media/              binnengehaalde bestanden + library.db (niet in git)
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
| Tests | Alle bestanden in `test/` moeten groen blijven. Bij wijzigingen: check toevoegen. |
| Mocks | Een mock die makkelijker is dan de echte API verbergt bugs. De Web Audio-mock vuurt `onended` asynchroon omdat de browser dat ook doet. |
| Browser | Chrome. Web MIDI bestaat niet in Safari — geen polyfill-pogingen. |

## Bekende grenzen (niet als bug rapporteren)

- Wat uit de library komt STREAMT (`StreamBron`, sinds 23 september 2026): alleen
  pagina's van ~1,4 s rond de positie, de loop, het cuepunt en de hotcues staan
  in het geheugen, ~4-6 MB per track, hoe lang hij ook is. Gemeten: acht keer
  een album van 31 minuten ~30 MB, waar het uitgepakt 5,7 GB was. Losgesleepte
  bestanden en de demotrack gebruiken nog `BufferBron` (hele track in RAM).
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
  dan een gewone stap in de muziek. Alleen voor de StreamBron; BufferBron
  (losgesleepte bestanden, demotrack) loopt via de native loop en tikt nog.
- Hoofdthread en worklet delen GEEN teller: ze rekenen allebei met dezelfde
  formule uit `stream-kern.js` op dezelfde audioklok ("vanaf T staat de
  positie op P met snelheid R"). Elke wijziging is een nieuw segment; een
  bericht dat laat aankomt rekent vanaf T door. Regel 3 over een draadgrens.
- Pitch schuift mee met tempo. Dat is `playbackRate`. Keylock hoort bij fase 3.
- De master-"limiter" is een `DynamicsCompressor`, geen look-ahead limiter.
- Er zijn twee soorten loops naast elkaar: in seconden en in tellen. De
  beat-loops klikken in op het grid; zonder grid doen ze niets.
- Een loop wordt geklemd op het trackeinde, dus `loop 4s` vlak voor het eind geeft
  een kortere loop. Correct gedrag.
- De nummers in `devices/apc40mk2.js` komen uit Akai's protocoldocument v1.2
  (tabellen op p13-17 en p23-26), niet uit herinnering. Wijk er niet van af
  zonder het document erbij. Twee dingen die makkelijk misgaan: de grid-noten
  lopen van ONDER naar boven (0x00 is linksonder), en de device knobs melden in
  mode 0 via het MIDI-kanaal bij welke trackstrip ze horen — vandaar de
  wildcard-regels `cc:*:16` in de standaardmapping.
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
- Botsen twee macro's op dezelfde parameter, dan wint de HOOGSTE plek. Saai en
  voorspelbaar; "laatste in de lijst wint" hangt van de volgorde af.
- Een onbekend effecttype in een rack wordt NIET weggegooid: het blijft als ruwe
  JSON bewaard, staat uit, en komt er bij het opslaan ongeschonden weer uit.
  Eén keer openen in een oudere versie mag geen rack slopen.
- Er zijn ACHT tracks (engine: decks A-H) maar twee VENSTERS op het scherm.
  Een venster is een grote weergave plus zijn mixerstrook en toont één track
  naar keuze; wisselen herschrijft alleen de `data-action`-attributen. Knoppen
  lezen hun action daarom bij het INDRUKKEN, niet bij het opstarten, en het
  loslaten gaat naar dezelfde action als het indrukken. Het toetsenbord volgt
  de vensters (`{L}`/`{R}` in `KEYMAP`), spatie volgt de focus.
- Crossfader-toewijzing per track: A, B of thru. Standaard 1 op A, 2 op B, de
  rest thru — zo klinkt een set voor twee als vroeger.
- Sync kent geen "het andere deck" meer: een track synct naar de track die je
  het hardst hoort (fader × crossfader, spelend, met grid). Speelt er niets,
  dan de eerste geladen track met grid.
- De action-bus spreekt in TRACKS (`track.1.filter`), de engine in decks (A, B).
  De vertaling staat op één plek: `TRACKS` in `actions.js`. `{focus}` in een
  mapping wordt een tracknummer. Mappings van versie 1 (`deck.A.…`) worden bij
  het laden omgezet door `migreerAction()`; niet weghalen, er kunnen nog
  geëxporteerde bestanden rondslingeren.
- De FX-knoppen wijzen naar een PLEK (`track.1.fx.knop.1`), niet naar een
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
  Nog niet gemeten in een zichtbaar venster; hapert het bij loops, dan is de
  oplossing een kortere GOP bij de ingest (-g 30), niet slimmer springen.
- Chrome laadt en decodeert geen media in een tabblad dat niet zichtbaar is,
  en pauzeert daar de animatielus. Video-gedrag test je dus met het venster
  vooraan; in een achtergrondtab meet je niets.
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
- De hub negeert echo's: een bericht dat identiek is aan wat wij net stuurden en
  binnen 60 ms terugkomt, bereikt de mapping niet. Zonder die rem maken de
  LED-ringen een lus — wij zetten een ring, het apparaat meldt de stand terug,
  wij verwerken dat als een knopdraai — en loopt de bus vol.
- De LED-laag leest de MAPPING, niet de engine. Koppel je een pad aan iets
  anders, dan verhuist zijn lampje vanzelf mee. Er is bewust geen tweede tabel.
- LED's lopen op een eigen `setInterval`, niet op de renderloop: `requestAnimationFrame`
  staat stil zodra het venster naar de achtergrond gaat, en dan zouden de lampjes
  bevriezen terwijl de muziek doorspeelt.
- De acht device knobs van de APC40 mkII verhuizen van MIDI-kanaal zodra je een
  andere bank kiest (bank 1-8 = kanaal 1-8, master = kanaal 9). Omdat een
  mappingregel de vorm `type:kanaal:nummer` heeft, is de bank al onderdeel van
  de sleutel: acht fysieke knoppen zijn negen keer te koppelen, 72 posities.
  Bank 1 = deck A, bank 2 = deck B, de rest is vrij (FX in fase 5).
- Zolang de init-sysex niet verstuurd is staat het apparaat in generic mode.
  Daar geldt: de TRACK SELECT-knoppen sturen helemaal niets (ze kiezen intern
  alleen de bank), en de hele device-sectie — knobs én de acht schakelaars
  eronder — verhuist mee van MIDI-kanaal met de geselecteerde strip. In Ableton
  Live mode vervalt dat banken en komt alles op kanaal 1. De mapping dekt beide
  met wildcards; het profiel kent beide vormen.

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
