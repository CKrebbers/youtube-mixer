# YouTube Mixer — projectgeheugen

Lees dit voordat je iets wijzigt. Dit bestand is de bron van waarheid voor
architectuurbeslissingen; `ROADMAP.md` is de bron van waarheid voor de volgorde;
`docs/VISIE.md` zegt waar het geheel heen moet (Clay's beeld, 10 okt: dj'en +
produceren + audio programmeren + zelf instellen, met beeld en controllers, als
draagbare set die overal kan streamen). Toets elke keuze daaraan (VISIE §5).

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
plan.html           het planvenster: de programmering zien, inrichten, live volgen (src/plan/plan-venster.js)
apc.html            interactieve APC-kaart: knoppen op hun echte plek, wat ze doen (src/ui/apc-kaart.js)
maschine.html       de Maschine-kaart: wat elke knop nu doet (uitleg van de Maschine zelf), live vanuit de mixer (src/ui/maschine-kaart.js)
controle.html       de Controlekamer (/controle): stand van alles, mixer openen, speellijst (docs/CONTROLEKAMER.md)
styles.css
src/
  engine/           audio-graph.js  kanaalstrip, EQ (+ kill), bipolair filter, master, xfader, het stemfilter (maakStemFilter)
                    beatgrid.js     tempokaart + maat-anker per stuk, tap tempo, beatjump-rekenwerk. Puur.
                    toonsoort.js    ToonKaart: toonsoort per stuk, wat je hoort, bewerken. Puur.
                    secties.js      SectieKaart (het nummer in secties) + sectieDoel: de sprong die op de volgende "1" invalt. Puur.
                    hoorbaar.js     wat je HOORT: uitgangsVertraging(ctx), hoorbaar(deck, V). Eén plek.
                    overgang.js     overgangen op een AudioParam: hellingen na startDrempel (geen curves)
                    bron.js         HOE een track geluid wordt: BufferBron en StreamBron (ook gepland starten, rem)
                    stream-kern.js  streamen als puur rekenwerk: segment, pagina's, WAV, rem; afvalvrij
                    stream-lezer.js de AudioWorklet die pagina's afspeelt
                    fx.js           insert-slot: ketens bouwen, klikvrij wisselen
                    fx-meer.js      tien effecten uit de filter app (distortion … breedte), in EFFECTEN achter de zeven van fx.js
                    fx-lfo.js       LFO van tremolo/autopan: vrij of op de maat (buffer + playbackRate, fase op de audioklok)
                    fx-kern.js      rekenkernen van de effect-worklets (toonhoogte, omhullende), afvalvrij. Puur.
                    fx-worklet.js   de AudioWorklet eromheen (laadt pas bij gebruik, één keer per context)
                    rack.js         racks als data: macro's, curves, migratie
                    deck.js         transport, cues, loops, beatjump, quantize, rem, beatgrid, stems + stemkanalen (geluid zit in bron.js)
                    sampler.js      acht pads: knippen op het grid, loopen op de maat van wat je hoort
                    klankschaal.js  instrument op de toon van wat je hoort: stemming(), volgen (maat/focus/hand), aanslaan, wrijven
                    klankschaal-kern.js  het modale model van de Waterschaal, per sample, afvalvrij. Puur.
                    klankschaal-worklet.js  de AudioWorklet eromheen (laadt pas bij gebruik)
                    engine.js       decks + mixer + maatgever (hysterese) + starten op de maat + snapshot()
                    koptelefoon.js  de koptelefoon (PFL): uitgang met vier kanalen, cue vóór de fader, mix en volume
                    instrumenten/   index.js (INSTRUMENTEN, instrumentDef) · poly.js de polysynth: twee oscillatoren, 12 stemmen (docs/INSTRUMENTEN.md)
                    instrumenten/drums.js  drumcomputer: 16 pads op noot 36–51, kit met zaad op 1–8, eigen buffers op 9–16 (INSTRUMENTEN.md §8)
                    instrumenten/fm.js  FM-stemmen van MediSynth als track-instrument: 12 stemmen, harmonische FM, unison, droog (INSTRUMENTEN.md §7)
                    instrumenten/schaal.js  de klankschaal als track-instrument: elke noot een eigen veld op zijn toon, kern op de toon van wat je hoort
                    instrumenten/schaal-kern.js  tien notenvelden + kern op SchaalKern, berichten op hun sample, omstemmen houdt de amplitude. Puur.
                    instrumenten/schaal-worklet.js  de AudioWorklet van schaal (één per track, laadt bij start())
                    patronen/model.js  patroon en set als data: normaliseerPatroon/-Set, bewerkingen (docs/PATRONEN.md). Puur, ook de server
                    patronen/venster.js  uit Elektronlearn: 384 PPQN, swing, micro, omlopen, notenInVenster. Puur.
                    patronen/klok.js  klok-tellen <-> audioklok (gebroken lijn), richten op de maatgever zonder sprong, maten. Puur.
                    patronen/speler.js  de sequencer (engine.patronen): 120 ms vooruit plannen, op de maat starten/wisselen/stoppen, opnemen
                    master.js       de master: gain -> insert-rack -> limiter (compressor tot de worklet er is) -> analyser
                    limiter-kern.js de limiter als rekenwerk: vooruitblik 1,5 ms, −1 dBTP (4×), gekoppeld, afvalvrij. Puur.
                    limiter-worklet.js  de AudioWorklet eromheen (uitgang 1 = de gain, voor de gain reduction)
  control/          actions.js      DE ACTION-BUS — alles gaat hierdoorheen
                    keyboard.js     toetsen -> actions
                    midi.js         Web MIDI: poorten, parsen, sysex. Kent geen actions.
                    mapping.js      signature -> action, soft-takeover, shift, mapjes. Kent geen hardware.
                    lagen.js        mapjes (lagen): welk mapje open staat, vastzetten en gluren
                    feedback.js     engine-stand -> LED's, met diffing. Leest de mapping.
                    drumpads.js     sampler-pad -> drumpad (DRUMPAD_VAN_SAMPLER, nootnamen), zonder imports: ook voor apc-beschrijf op apc.html
                    midi-learn.js   action kiezen, control bewegen, gekoppeld
                    noten.js        MIDI-noten (elke ingang behalve de APC) naar het instrument op de speeltrack; knoppen en de schuif (SysEx Master Volume) via een apparaatmapping
                    maschine.js     de Maschine MK2 via de hub (alleen ?hub=): pads -> noten.js of stappen (STEP), PATTERN, transport, groepen/draaiknoppen (mapping), knoppagina's (◄ ►: Instrument/Strip/Rack als open mapje), uitleg (CONTROL), masterwiel, lampjes, schermen
                    maschine-scherm.js  de twee schermen van de Maschine: stand -> 2048 bytes (256×64, 1 bit), eigen 5×7-font. Puur.
                    handelingen.js  het handelingenlog: [t, action, waarde] op de audioklok, per seconde weg
                    terugspelen.js  een log terugspelen: beginstand, dan elke regel op T0 + t
                    devices/        apc40mk2.js, generic.js, maschine-mk2.js (de virtuele MIDI van de hub) — wat er op het apparaat zit
                    hub.js          AV-app-hub (alleen ?hub=ws://…): HubMidi = MidiHub met de hub als poort (lease), manifest, herverbinden;
                                    speelt Xboard49 en Maschine (eigen nep-poorten, speelPoort(dev)), lampjes/schermen door een wachtrij;
                                    de sectie naar de globale laag (§18, engineSecties)
  analysis/         peaks.js        golfvorm-peaks + ruwe RMS
                    features.js     banden laag/midden/hoog, rms, zwaartepunt, onsets uit een spectrum. Puur, tijd van buiten.
                    luisteraar.js   leest de master-AnalyserNode uit (alleen lezen) -> features
                    router.js       route { bron, doel, sterkte }: offset bovenop een vormknop. Puur.
                    maat.js         klappen (deck.onsets) en tel van de maatgever als bron, op wat je hoort. Puur.
                    demo-track.js   synthetische 124-bpm testtrack
  ui/               app.js (instappunt: engine + modules in volgorde opzetten)
                    vensters, laden, racks, sampler-opslag, meldingen,
                    onderpanelen, midi-opzet, opname-knop, video-paneel,
                    renderloop, mapje-balk — elk een opzet…()-functie
                    vlag.js + vorm-paneel.js: ?vormen=1 en de VORM-rij (paneel pas geladen als de vlag aan staat)
                    vlag.js ook ?hub=ws://… (hubAdres): dan laadt app.js control/hub.js, anders niet
                    bovenbalk.js    past de balk niet (tijdens het spelen), dan scrollt het rechterdeel opzij: vervaging, wiel
                    waveform.js, controls.js, midi-monitor.js,
                    mapping-panel.js (de lijst), learn-mode.js (aanwijzen op het scherm),
                    rack-editor.js (racks bouwen met de muis, werkt op een kopie)
                    spiegel-plan.js het scherm als APC: welke control waar, wat hij doet. Puur.
                    spiegel.js      acht kolommen, focusdeel, acht banen; data-actions uit de mapping
                    vensters.js     de track met focus bovenaan + vensters als model (L/R)
                    tabblad.js      Web Lock 'varve-mixer': maar één tabblad praat met de APC
                    status-zender.js de stand voor de Controlekamer: BroadcastChannel 'varve-status', alleen het eerste tabblad
                    apc-kaart.js    apc.html: de APC met knoppen op hun echte plek, klik = uitleg
                    apc-beschrijf.js elke action in gewone taal (de test eist er een voor de hele standaardmapping)
                    soorten.js      soort (kleur) van een action voor beide kaarten; de kleuren in styles.css (.s-*). Puur.
                    maschine-kaart.js  maschine.html: plaat, schermen, live volgen via window.opener.maschine. Stuurt niets.
                    maschine-kaart-plan.js  plaatsing + wat een control doet = legUit() van de Maschine (label, soort). Puur.
                    toon-weergave.js toonsoort als tekst: kolomkop, focus, library, tooltip. Puur.
                    library-lijst.js de library als virtuele lijst: kolommen, cellen, pagina-cache. Puur.
                    kaart-lijst.js  de muziekkaart als lijst (tab kaart): kolommen, badges, stand → knop, filters, kratten, nachtteksten. Puur.
                    kaart-panel.js  de tab kaart in het library-paneel: zoeken, kratten, haal binnen/zoek, wenslijst, nachtwachtrij (docs/LIBRARY.md "De kaart-tab")
                    hotcue-opslag.js hotcues per nummer bewaren: welk nummer op welke track, één verzoek tegelijk
                    mapping-opslag.js je eigen mapping als verschil: standaard ophalen, omzetten, bewaren, herstellen
                    ingest-strook.js de ingest-wachtrij in het library-paneel: plakken, voortgang, ×, laadknoppen
                    logboek.js      ○ log en ↺ naast de opname: vastleggen, vergelijken, lijst, terugspelen
                    klankschaal-paneel.js de KLANKSCHAAL-rij: openen, instellingen bewaren, per frame tonen
                    plan-koppeling.js in de mixer: actief plan, ophalen met versie, live naar de automaat, window.varvePlan, knop plan
                    auto-paneel.js  de AUTO-rij: wat er klinkt, wat er komt en waarom, ok/overslaan/langer/nu
                    beeld-paneel.js de BEELD-rij: aan/uit, relay-adres, latentie, de stand; het lampje op de knop beeld
                    beeld-weergave.js de stand van beeld als tekst, lampje en tegel (rij, knop, Controlekamer). Puur.
                    stems-paneel.js de STEMS-rij voor de focus-track: niveau, kill, filter, echo, galm, cue per stem, splitsen, voortgang
                    stems-wachtrij.js de stems-rij van de server (GET /api/stems): peilen zolang iets open staat of iemand kijkt
                    stems-weergave.js stems als tekst: namen, library-cel, rijstand, kolomteken, tegel. Puur.
                    koptelefoon-paneel.js de KOPTELEFOON-rij: cue per track, VOL, MIX, ⇄ (zaal en koptelefoon wisselen, na herladen)
                    instrument-paneel.js de INSTRUMENT-rij: kiezen, acht knoppen, toetsenbord (via noten.js), welk MIDI-keyboard
                    speelapparaten.js alleen met ?hub= (app.js laadt hem dynamisch): Xboard49 -> noten.koppel, Maschine -> maschine.js + tik
                    master-paneel.js de MASTER-rij: rack kiezen en onthouden, MIX, acht knoppen, gain reduction (ook bij de mastermeter)
                    master-weergave.js de master als tekst en getal (gain reduction, kiezer, opslag). Puur.
                    patronen-paneel.js de PATROON-rij: plekken, stappen, lengte, swing, opnemen, tempo; noten.js naar de speler
                    patronen-opslag.js de set op de server: ophalen en bewaren met versie, van buiten overnemen, botsing (geen DOM)
  vormen/           hulp.js         paletten, toeval met zaad, ruis, tekenhulp (gedeeld door de systemen)
                    systemen.js     de Vormmachines (Clay's artifact): 10 lichte + de lijst van alle 26
                    systemen-zwaar.js / -meer.js / -isomorf.js  de andere 16 (zwaar · middel · beeld = geluid)
                    laag.js         een vorm als beeldlaag: 1/60 s-stappen op de audioklok, knoppen 0..1, Worker of hoofdthread
                    werker.js       de Worker van een laag: OffscreenCanvas -> ImageBitmap; draaiWerker() is testbaar
                    budget.js       tijdsbudget in ms: EMA, kwaliteit in stapjes, noodrem. Puur.
  video/            volg.js         hoe een video de audio volgt. Puur rekenwerk.
                    video-mixer.js  <video> per track, gemengd met WebGL2. Leest de engine alleen uit.
                    instellingen.js welke video-effecten en mengvormen er zijn (data)
                    puls.js         effecten op de tel: vorm, maatgever() zoals je hem hoort
                    passen.js       beeldverhouding per laag: passend (randen) of vullen. Puur.
                    lagen.js        beeldlagen over de mix: welke tellen mee, uniforms. Puur.
                    beamer.js       wie mengt: hoofdvenster of los venster (de beamer), en de inloop. Puur.
                    beamer-venster.js video.html: het losse venster mengt ZELF (eigen <video>'s, WebGL, lus)
                    fouten.js       video ontbreekt of laadt niet: tekst en wachtregel. Puur.
                    eindbeeld.js    beeld-noodknoppen: zwart, bevriezen, master, flits (laatste stap). Puur.
  plan/             plan-model.js   het setplan als data: formaat v2, normaliseerPlan, bewerk, verschil. Puur (ook door de server gebruikt)
                    tijdlijn.js     voorspel: set-tijden en de overgang die de app echt kiest. Puur.
                    plan-venster.js het planvenster (plan.html): lijst, strook, bewerken, opslaan met versie, live via opener
  controle/         controle.js     de Controlekamer: tegels (server, ingest, mixer via de Web Lock, APC via het kanaal), speellijst
                    speellijst.js   de punten van een proefsessie, in blokken. Puur data; de stand staat in proef/sessie.json
                    backup-tegel.js de tegel "Backup" (laatste kopie, of de fout). Puur.
  auto/             planner.js      de auto-DJ, puur: welk fragment, welke overgang (bewakers), wanneer (frasegrens), de curves
                    automaat.js     de auto-DJ, uitvoeren: laden, klaarzetten, overgang via de bus, overnemen, nooit stilte
  opname/           opnemer.js      je set opnemen: worklet aan de master, stukken naar de server
                    opnemer-worklet.js  telt frames, zet om naar 16-bit, geeft per seconde door
  koppel/           varve-beeld-zender.js  de zender van de Stroommachine, ONGEWIJZIGD overgenomen (herkomstregel bovenaan; wijzigen in haar repo)
                    beeld.js        spoor beeld: klok, kenmerken, track per crossfaderkant, mix, poorten naar de Stroommachine. Leest de engine alleen.
  lib/              emitter.js      Emitter + clamp/lerp/expMap/dbToGain/fmtTime
server/             draait apart: `node server/index.js`
  index.js          HTTP, statische bestanden (no-store), ingest-API, library-API
  ingest.js         yt-dlp (of een eigen bestand) -> ffmpeg -> media/<id>/. Gooit nooit.
  links.js          links netjes maken (TikTok), bron van een nummer, id's, bestandsnamen
  library.js        SQLite via node:sqlite. Tracks (pagina's, sorteren), peaks, racks, grid, toonsoort, hotcues, stems.
  backup.js         backups van library.db: wanneer, hoeveel, opruimen; het werk in backup-werker.js (worker)
  analyze.js        golfvorm-peaks, onset-envelope en toonsoort vooraf, streamend uit ffmpeg
  analyse-werker.js peaks, onset, tap-verfijning en toonsoort in een worker_thread (server blijft vrij)
  detect.js         FFT, onset-envelope, tempo, segmentatie (+ tweede kans). Geen dependencies.
  toon.js           toonsoort: stemming per stuk, chroma, Temperley 2005, kaart (Viterbi). Puur.
  secties.js        secties per maat: kenmerken, nieuwheid (Foote, energie, stems), grenzen, groepen, labels. Puur (docs/SECTIES.md)
  wachtrij.js       de ingest-wachtrij: één tegelijk (links en uploads), annuleren met een AbortSignal
  opname.js         opnames: WAV dat groeit, kop herstellen na een crash
  patronen.js       patronen per set: patronen/<naam>.json met versie (409), .versies (docs/PATRONEN.md)
  proef.js          de speellijst van de Controlekamer: proef/sessie.json, per punt, atomisch; archief per ronde
  handelingen.js    handelingenlogs naast de opnames: stukken op hun plek, lijst, lezen
  stems.js          de stems-rij: Demucs starten (nice), één tegelijk, annuleren, werkmap, nalopen, verhuizen
  stems/splits.py   de splitter: Demucs htdemucs in stukken met kruisfade, 16-bit stems.wav + stems.json (docs/STEMS.md)
  kaart.js          de muziekkaart als zoeklaag: varve-kaart.json in het geheugen (zoeken/filteren/sorteren/pagineren), binnen = tracks.id,
                    wensen en nacht_runs in een EIGEN media/kaart.db, een YouTube-versie zoeken (ytsearch5, nooit cookies) (docs/KAART.md)
  nacht.js          de nachtwachtrij: venster, speeldagen, wensen dan standaardvolgorde, één tegelijk met pauze, stopt bij een deck of 403; media/nacht.json
tools/              beatmeting/ (metingen op Clay's library, alleen lezen), git/ (test-index.sh, hunks.py),
                    lokaal/ (importeer.mjs + kies.mjs: Clay's eigen muziek via /api/upload met video=0, --droog; LEESMIJ.md),
                    headless/ (kaart.mjs: de tab kaart op de nep-server kaart-nep.mjs; kaart-echt.mjs: de tab kaart tegen de
                    echte kaart-routes van een server die al draait (kopie van de library, nep-yt-dlp, echte varve-kaart.json); kijk.mjs, apc-klank.mjs, toon.mjs, toon-keten.mjs, library.mjs, kijk-ingest.mjs,
                    vorm-maat.mjs, vormen-plaat.mjs, beamer.mjs, stems.mjs, secties.mjs, sec-toets.mjs, sec-sampler.mjs, sec-plan.mjs, sec-log.mjs, sec-auto.mjs, sec-vorm.mjs, sec-controle.mjs, koptelefoon.mjs, instrument.mjs, instrumenten.mjs, master.mjs, effecten.mjs, stemkanalen.mjs, patronen.mjs, rijen.mjs, beeld.mjs: headless zonder MIDI;
                    beeld-e2e.mjs: met de echte relay en Stroommachine uit ~/Projects/stroommachine;
                    maschine-kaart.mjs: de Maschine-kaart los en live vanuit de mixer (nep-poort, geen hub);
                    bladeren.mjs: BROWSE, wiel en ENTER op een nep-Maschine met een echte library (twee testnummers);
                    maschine-sampler.mjs: SAMPLING op een nep-Maschine met de echte sampler (knippen, spelen, tellen, volume);
                    sampler-drums.mjs: crossover, een sampler-pad als drumpad 13 in de echte Web Audio (inhoud, strip, patroon,
                    tempo, koptelefoon) en de knoppen 1→13 … 8→12 in de app op 1440×900 en 1440×790 (muisklik, koppelmodus);
                    hub.mjs, speelapparaten.mjs, sec-maschine.mjs en sec-hub.mjs: met de echte hub, nep-APC/LPD8/Xboard/Maschine), bench/ (renderblok.mjs:
                    CPU en afval), mapping/ (eerder.mjs: voorgangers van de standaardmapping),
                    stems/ (Demucs-proef meet.py, vergelijk.py, snelheid.py), toonsoort/ (meetinstrument), keylock/ (Signalsmith-proef +
                    luisterbestanden), varve-app/ (de Dock-app VARVE: start de server, opent de Controlekamer) — zie tools/README.md
Input/              door Clay aangeleverd materiaal (zips, blueprint) — zie docs/INPUT.md
mappings/
  apc40mk2.json     standaardmapping (data, geen code), met zijn voorgangers in `eerder`
  generic.json      leeg startpunt
  apc40mk2-vormen.json  fragment: het mapje "vorm" (alleen met ?vormen=1, komt BIJ de mapping)
  xboard49.json     E-MU Xboard49: knop 1–8 -> instrument, 9–16 -> FX, schuif -> fader van de speeltrack (AANNAME, te controleren met een proef)
  maschine-mk2.json Maschine MK2 (via de hub): groep A–H = focus, draaiknoppen = instrumentknoppen van de speeltrack (relatief, shift fijn), transport van de patronen ({plek}); laag pagina.strip / pagina.rack = de knoppagina's van de focus-track
racks/
  sjablonen.json    kant-en-klare racks voor elk nummer (data, geen code)
plannen/
  auto-plan.json    het setplan (v2, docs/PLAN.md); lezen/opslaan via /api/plannen met versie; .versies/ = oude versies
patronen/
  set.json          de patronen van de set (docs/PATRONEN.md); lezen/opslaan via /api/patronen met versie; .versies/ = oude versies
media/              binnengehaalde bestanden + library.db (niet in git)
opnames/            je opgenomen sets als WAV (niet in git)
test/
  engine.test.mjs   engine tegen gemockte Web Audio API, draait in Node
  mapping.test.mjs  mapping + soft-takeover, puur logica, geen mock nodig
  feedback.test.mjs LED-diffing en paletproef, bytes worden opgevangen
  learn.test.mjs    MIDI-learn, modusherkenning, export/import-rondje
  midi.test.mjs     parsen, poortkeuze op naam, echodetectie
  library.test.mjs  database, effect-racks per link, cascade bij verwijderen, migraties (SCHEMA.length)
  backup.test.mjs   backups: geldige kopie uit de WAL, niet dubbel, opruimen, mislukken, niet via HTTP
  library-lijst.test.mjs  virtuele lijst, pagina-cache (ook de race bij een nieuwe sortering), kolommen
  kaart-lijst.test.mjs  de tab kaart als rekenwerk, en de nep-server (tools/headless/kaart-nep.mjs) tegen het contract van de kaart-API
  ingest.test.mjs   pipeline zonder netwerk; ffmpeg maakt zijn eigen testmateriaal
  wachtrij.test.mjs wachtrij, annuleren (ook midden in een nep-download), playlist, dubbel, voortgang, strook
  wachtrij-server.test.mjs  eigen server + nep-yt-dlp: urls, volgorde, DELETE, dubbel, upload in de rij, herstart
  nep-ytdlp.mjs     nep-yt-dlp voor de tests (VARVE_YTDLP), geen netwerk — geen test zelf
  stems.test.mjs    stems-rij, routes, ingest-koppeling, schema v8, annuleren, herstart (VARVE_STEMS_ECHT=1: echte Demucs)
  nep-stems.mjs     nep-splitter (VARVE_STEMS_CMD via maakNepStems): stem k = audio × gewicht — geen test zelf
  toon.test.mjs     toonsoort van de server: synthetisch via ffmpeg + worker, gelijk aan het meetinstrument
  toonsoort.test.mjs ToonKaart, wat je hoort, key-actions, weergave; elke bewerking door normaliseerToon
  handelingenlog.test.mjs  vastleggen (nep-klok), haperend netwerk, terugspelen, paden, grootte, eigen server
  renderblok.test.mjs  audiopad zonder afval: echte worklet, 8 decks, gouden hash, 0 GC over 12 000 blokken
  gridauto.test.mjs, gridzeker.test.mjs  grid bij binnenhalen en op de achtergrond; zekerheid per stuk
  analyze.test.mjs  peaks van de server tegen die van de browser, bit voor bit
  beatgrid.test.mjs beatrekenen, grid bewerken, tap tempo met een misser erin
  detect.test.mjs   beatdetectie op materiaal waarvan het antwoord bekend is
  rack.test.mjs     macro-resolutie met een gouden bestand, migratie, onbekende effecten
  effecten.test.mjs de effecten uit de filter app: contract, eenheden = zet(), lussen, inloop, twee koppen, LFO op de maat, worklets, 0 GC
  stream.test.mjs   streamkern tegen ffmpeg (bit voor bit), pagina-plan, StreamBron
  video.test.mjs    video volgt audio: bijsturen, springen, zichtbaarheid
  server.test.mjs   eigen server op eigen poort + tijdelijke db: witte lijst, Range, racks per nummer
  regels.test.mjs   regel 1 als test: engine importeert niets uit ui/control/server, geen DOM
  spiegel.test.mjs  scherm-als-APC: actions uit de mapping, mapjes, shift, venster volgt focus
  tabblad.test.mjs  Web Lock met een nagebouwde navigator.locks: eerste, tweede, overnemen
  opname.test.mjs   opname-WAV: stukken op ?frame=N, kop, RF64, herstel na crash, geen ../
  opnemer.test.mjs  opnemer tegen de echte opname.js met een haperend netwerk: geen dubbel, gat = stilte
  bronnen.test.mjs  TikTok-links zonder netwerk, ffprobe-controle, eigen staande video door de pijplijn
  upload.test.mjs   upload-route op een eigen server: grens, geen media, hash-id, streamen i.p.v. geheugen, ?video=0/?titel=/?artiest=
  lokaal-importeer.test.mjs  tools/lokaal: welke bestanden, overslaan (al binnen, .acties.jsonl, mp4 naast wav, < 20 s), de droogloop
  vormen.test.mjs   vormlagen: elk systeem, zaad, 1/60 s-stappen, knoppen, bus, fragment, mixer (nep-WebGL)
  vormen-zwaar/-meer/-isomorf.test.mjs  de 16 extra systemen: puur, zaad, g.kwaliteit, ms per stap, nep-sink
                    (ms per stap in THREADtijd, beste van 3: de wandklok telde onder load de planner mee)
  werker.test.mjs   Worker-logica zonder Worker, budget met nep-klok, noodrem, terugval
  plan.test.mjs     setplan: formaat, bewerken, verschil, voorspelling, opslag met versies (409, .versies)
  auto.test.mjs     auto-DJ: planner (bewakers, frasegrenzen, curves, kiezer) en de automaat op een engine (blend, beatloos, overnemen, glijden)
  nep-tijdlijn.mjs  nep-AudioParam die uitrekent wat de param op elk moment doet (geen test zelf)
  klankschaal.test.mjs  stemming (24 toonsoorten × ladders), toonhoogte gemeten, slapen, wrijven, afval, engine en bus
  instrumenten-fm-schaal.test.mjs  fm en schaal tegen het contract: tijdlijnen (geen curves, stemroof, stil), berichten op hun sample, toonhoogte, 0 GC
  master.test.mjs   limiter (plafond, true peak, vooruitblik, geen pompen, 0 GC), worklet, keten, wissel, actions, APC
  analyse.test.mjs  banden op nep-spectra, klapreeks op 30/60/120 fps, router-offset, react-actions, maatbronnen
  instrumenten.test.mjs  Poly (contract, ADSR, stemroof, pedaal), engine (nummer óf instrument, speeltrack, maatgever), actions, noten.js met nep-poorten, mapje inst
  hub.test.mjs      AV-app-hub: nep-WebSocket + nep-klok (ook verborgen tabblad: 1×/s, 1×/min); vlag (lokaal), manifest, LED's per beeld, focus, zet, paniek, hartslag, 0,5→5 s, open-en-dicht, 4001→30 s;
                    speelapparaten: speelt, routering per dev, lampjes/schermen met dev door de wachtrij, statechange, niets statisch geladen
  maschine.test.mjs de Maschine (pads, groepen, draaiknoppen, wiel, lampjes, schermtempo), maschine-scherm (pixels), Xboard knop 9–16 en schuif, isSpeelapparaat
  maschine-kaart.test.mjs  de Maschine-kaart: tekst = legUit in elke pagina × padmodus, geen regel vrij, stand blijft staan, stuurt niets
  bladeren.test.mjs  bladeren in de library met de Maschine: bindLibrary, keuze/venster, terugspelen, wiel/ENTER/◄ ►, lampjes, schermen
  maschine-sampler.test.mjs  de padmodus sampler op de Maschine: pads per rij, SHIFT, ◄ ► tellen, knop 5 volume, lampjes, scherm
  sampler-drums.test.mjs  crossover: sampler-pad als drumpad (tabel, actions, welke Drums, melding tempo/stems met de echte
                    stemindeling, lampjes, terugspelen, na herladen, de knoppen in index.html), zonder DOM
  bovenbalk.test.mjs  de bovenbalk scrollt opzij als hij niet past (randen, CSS: niet hoger, geen schuifbalk)
  patronen.test.mjs model, venster (swing, micro, omlopen), klok, speler met nep-maatgever (op de maat, herankeren zonder dubbele/gemiste), opnemen, opslag (409), server
  patronen-engine.test.mjs  patronen op de echte engine: actions en reads, een deck als maatgever, instrument weg, log, terugspelen, modus patronen, LED's
  secties.test.mjs  secties: synthetische nummers met een bekend antwoord, worker, library, deck, actions, server, marges op de "1"
  sec-sampler.test.mjs  een sectie in een sampler-pad: knipSectie, start op de "1", herankeren (ook keylock), grenzen, meldingen
  secties-log.test.mjs  secties in het handelingenlog: kaart in de stand, `van` bij een druk, volgorde, precies terugspelen
  auto-secties.test.mjs  auto-DJ met secties: fragment/planMoment/momentArgs, terugvinden, wachten op de kaart, OVERNEEM, langer/nu, zonder kaart identiek
  sec-maschine.test.mjs  secties en loops: sectieHier na het rondgaan, sectieOpDeMaat in een loop, de melding, de Maschine
  sec-controle.test.mjs  sectieTelling (zelfde regel als moetSecties, cache per rij, ROLLBACK), /api/secties, de tegel
  beeld.test.mjs    spoor beeld: adres, latentie, id's, kiesKant, de tel met latentie, track/mix/poort, aanwezig en opnieuw, de echte zender op een nep-WebSocket
  varve-beeld-zender.test.mjs  de zendertest van de Stroommachine (overgenomen; alles.mjs telt zijn eigen formaat)
  kaart.test.mjs    de kaart op een verzonnen varve-kaart.json (nep-kaart.mjs): laden/herladen, zoeken, filters, sorteren, pagina's, wensen (20, dubbel), score, standaardvolgorde, cookie-bewaker
  nacht.test.mjs    de zes nachtregels één voor één met nepklok, nep-deck en nep-ingest (geen tijd, geen netwerk)
  kaart-server.test.mjs  kaart en nacht op een eigen server met de nep-yt-dlp: routes, 409 bij een deck (echt Range-verzoek), ingest zonder video, nachtrun, herstart
  nep-kaart.mjs     de verzonnen kaart (twaalf nummers die elke regel raken) — geen test zelf
  alles.mjs         alle tests in één keer met overzicht
docs/
  VISIE.md          Clay's beeld van het geheel (10 okt): vier pijlers, twee dragers, de draagbare set, de streamvraag (§4)
  HANDOFF.md        stand, wat niet getest is, volgende stap
  VRAGEN.md         open vragen voor Clay
  VERBETERINGEN.md  verbeterlijst uit de reviewagenten, in rondes
  APC40.md          wat het apparaat kan en de indeling zoals gebouwd
  APC40-onderzoek.md DJ-conventies, bestaande mappings, fysieke indeling (bron van de indeling)
  plugins/          AV-kern × Varve: inventaris, plan (01-plan.md), negen analyses
  BEATGRID.md       beatgrid: meting, plan, restpunten (tweede kans, maat-anker)
  TOONSOORT.md      toonsoort per nummer: meting, ontwerp, en wat gebouwd is (§13)
  KEYLOCK.md        keylock en toon verschuiven met Signalsmith: meting, ontwerp, gebouwd (§9)
  MAPPING-VERSCHIL.md  eigen mapping als verschil: vorm, gedrag, Clay's echte verschil
  LIBRARY.md        library: pagina's, sorteren, hotcues per nummer, schema v6/v7
  BEAMER.md         het losse venster mengt zelf: wie mengt, opname, herladen, rVFC-meting
  HANDELINGENLOG.md formaat, keuzes en grenzen van het handelingenlog
  AUDIOPAD.md       audiopad zonder afval: waar het zat, de regels, cijfers vóór/na
  VORMEN-16x9.md    vormen op 640 × 360: API, per systeem, Clay's keuze, uitzonderingen
  PLAN.md           het planvenster: formaat v2, opslaan met versie, samenwerken met Claude, live, fases
  AUTO-DJ.md        auto-DJ: drie partijen, bewakers, overgangen, bediening, het setplan, grenzen, volgende fases
  KLANKSCHAAL.md    de klankschaal: stemming, bouw, bediening, metingen, open vragen (KS1–KS5)
  STEMS.md          stems per nummer: Demucs bij de ingest, stems.wav, de engine, de rij, metingen; §5 de stemkanalen
  SECTIES.md        secties per nummer (6 okt): rekenwerk, de sprong op de maat, opslag, grid-modus SECTIES, grenzen
  TAILSCALE.md      overal openen via Tailscale: VARVE_HOSTS, tailscale serve, wat waar werkt
  ONTBREEKT.md      wat er nog ontbreekt (2 okt): eigen docs, DJ-software, Logic/TD; voorstel en vragen
  STUDIO.md         VARVE als muziekprogramma (5 okt): hergebruik, vier controllers, fasen S0–S5; §3 de koptelefoon
  INSTRUMENTEN.md   het contract van een instrument (§1–5) en hoe het op een track woont (§6: engine, actions, noten, scherm, APC, metingen)
  MASCHINE.md       Maschine MK2 en Xboard49 via de hub (5 okt): wat elke knop doet, lampjes, schermen, de stapmodus straks, metingen
  MASTER.md         effecten op het geheel en de limiter (S2a, 5 okt): keten, algoritme, laden, opslag, APC, metingen
  EFFECTEN.md       effecten uit de filter app (S2c): per effect herkomst, eenheden, staart, metingen, wat niet
  PATRONEN.md       patronen (S4): het contract (§1–6) en wat gebouwd is (§7: klok, opnemen, API, APC, opslag, metingen)
  BEELD.md          spoor beeld (6 okt): VARVE stuurt de Stroommachine via de relay; instellen, wat er gaat, APC-mapje, problemen, tests
  KAART.md          de muziekkaart in Varve (10 okt): het bestand, de API (+ §3b de afspraken met de UI), de nachtregels, "er speelt een deck",
                    §9 gemeten op het echte bestand, §10 na de proefavond, wat niet getest is
  verslagen/        eindverslagen van de agenten per dag (2026-09-25/README.md = index per spoor)
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
| Git | Committen en pushen mag. `git add` per pad, nooit `-A`: de repo staat op het Bureaublad (iCloud), en bestanden met " 2" in de naam zijn conflictkopieën (meestal een oude versie): die NOOIT committen. Groter werk per spoor op een eigen tak in een worktree buiten iCloud (`~/Projects/varve-stems/<spoor>`), samenvoegen in `studio/integratie`, naar main met een PR; daarna de worktree weg. Data staat niet in git en hoort in de Bureaublad-map: `media/`, `opnames/`, `patronen/`, `proef/`. Een server die vanuit een worktree draait schrijft patronen en de speellijst in die worktree: link `media`/`opnames` en zet de rest terug vóór je de worktree weghaalt. |

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
- Streamen leest `audio.wav` (of `stems.wav`) rechtstreeks met Range-verzoeken,
  en kan daarom alleen 16-bit PCM met 2, 4 of 8 kanalen (stereo, of 2/4 stems
  interleaved). De ingest zet dat formaat expliciet. Verander je het formaat van
  `audio.wav`, dan weigert de StreamBron het met een reden. Met stems kost een
  deck ×2 (twee) of ×4 (vier) aan geheugen en netwerk. Wordt het bestand op de
  server vervangen terwijl een deck het streamt (Content-Range-totaal anders),
  dan haalt de StreamBron niets meer op: stilte en een melding, nooit ruis.
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
- HET AUDIOPAD MAAKT GEEN AFVAL (25 sep, ROADMAP 22, `docs/AUDIOPAD.md`): een GC
  op de audiothread is een tik. `renderBlok` en de worklet maken per blok niets
  aan: tussenresultaten in `klad` (Float64Arrays), hulpfuncties op het hete pad
  krijgen alleen objecten en hele getallen en geven niets of een boolean terug
  (een double over een functiegrens wordt een HeapNumber zodra V8 niet inlinet),
  `positieOp` alleen via `posities()`. Een nieuw segmentveld is een OBJECT
  (`rem: { a }`), geen getal dat soms ontbreekt (dat maakte per blok een
  getal-object). `renderblok.test.mjs` eist 0 GC's en een gouden hash; die hangt
  van V8's sin/cos af: na een Node-update opnieuw meten op de oude kern, niet
  blind overnemen.
- TRANSPORT (25 sep, ROADMAP 16):
  - Beatjump (`track.N.beatjump.*`, lengte 1–32, standaard 4) rekent in TELLEN
    (`Beatgrid.verschuif`): fase exact, ook over een stukgrens; in een loop
    schuift de LOOP mee. Weigeren met een melding: zonder grid, onzeker stuk
    zonder slot, loop buiten het nummer, voorbij het einde (klemmen liet de
    track midden in een set stoppen), en vóór het begin ('begin', Clay 26 sep,
    J4: klemmen op 0 brak de beatmatch). Precies op 0 landen mag.
  - Loop in/out/reloop: out zet de loop meteen aan; reloop = eraf, of de vorige
    loop (`vorigeLoop`) terug. In-punt en vorige loop zijn vastpunten.
  - Quantize is ÉÉN schakelaar voor de hele engine (`transport.quantize`): zetten
    snapt naar de tel; een hotcue-SPRONG is fasebehoudend en meteen
    (`metFaseVan`), en de HOTCUE beslist of een loop blijft (`_naarHotcue`), niet
    het landingspunt. Alleen op een zeker grid. Op de APC en het scherm = Lock,
    met zijn stand. Doet Lock in het open mapje iets anders (grid-modus: slot),
    dan staat er een Q in de hoek van Lock (`herbereken()` in spiegel.js;
    absoluut in de cel: een extra grid-item verschuift de APC-knoppen).
  - Starten op de maat (`track.N.play.quant`): het geluid begint op het volgende
    maatbegin van de maatgever en de tel van de track bij het startpunt valt
    erop; zonder maatgever meteen. Op een actieve track als play (`togglePlay`):
    speelt = pauze, wacht = annuleren, remt = los. Lampje (read): 1 = wacht
    (fel groen), 0,5 = speelt (donkergroen), 0 = stil (donkergrijs), null = leeg.
    GEPLAND STARTEN (`bron.start(p, { op })`): de bron speelt al (`deck.wacht`)
    maar klinkt pas vanaf `op`, sample-exact; de worklet krijgt `gepland: true`
    (zonder klinkt vóór T wat er vóór het startpunt staat); `ctxTijdVan` rekent
    vanaf max(nu, T). Een wachtende track geeft de maat niet (tenzij verder niets
    klinkt), volgt DEZELFDE tel van de maatgever als die verschuift
    (`_volgWachtenden`; "de volgende maat" opnieuw uitrekenen schoof in een
    korte loop elke ronde op), en sync doet dan alleen het tempo.
  - Toetsen: R/T en Y/U beatjump (shift: lengte), G/C en H/N loop in/out
    (shift: reloop), shift+Q/P op de maat, 6 quantize.
  - Op de APC (voorstel A, 25 sep, `docs/APC40.md`), rechts voor de focus-track:
    Bank ◀ ▶ beatjump (shift: lengte ½/×2), Pan/Sends/User loop in/out/reloop,
    Lock quantize, Stop All Clips rem (geen LED op het apparaat); shift + nummer
    (2×2) = op de maat. Keylock = Shift + Tap, toon = Shift + Nudge ± (VRAGEN I4; Bank is met de hub de hubtoets). Kill,
    rem en op de maat per kolom: de grid-modus klank (MAPJES).
- REM (vinylstop, 25 sep): `track.N.brake` remt in `track.N.brake.time`
  (SECONDEN 0,1–5, standaard 1: een gebaar van de draaitafel, ook zonder grid)
  lineair tot stilstand, daarna een gewone pauze. Nog eens drukken of play = los;
  op een stilstaand of wachtend deck niets. Segment `rem: { a }`: positieOp =
  P + R·dt + a·dt²/2 tot stilstand, zelfde formule in hoofdthread en worklet.
  Onder 25% snelheid (`REM_UIT`) dooft de worklet uit (anders een plof van de
  vastgehouden laatste sample). Tijdens een rem: sync zet alleen het tempo, een
  loopwissel houdt dezelfde rem (alleen P schuift), seek/hotcue/pauze/nudge
  halen hem eraf, geen maatgever, `fxKlok` null; de video volgt `deck.snelheid`.
  Toetsen: ` (links van 1) = focus, = = rechterhand.
- EQ-KILL (25 sep): `track.N.kill.low/mid/high` (schakelaar) en `.hold`, −70 dB
  zoals de knop-kill. De knopstand blijft staan (kill uit = precies terug), ook
  bij een nieuw nummer, zoals de EQ-knoppen. Klikvrij met hellingen van 5 ms die
  in AMPLITUDE een zachte S volgen (zie overgangen). Lampje 1 = weg, 0 = open.
- Pitch schuift mee met tempo (zonder keylock). Keylock en toon: `docs/KEYLOCK.md` §9.
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
- De master-limiter is sinds 5 okt een AudioWorklet met vooruitblik (−1 dBTP,
  `docs/MASTER.md`); tot hij geladen is (of als laden mislukt) de oude
  `DynamicsCompressor`. Zie "Master en limiter" hieronder.
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
  al fijn slepen). Op de APC nog geen knop toegewezen (Lock werd quantize,
  voorstel A van 25 sep; `docs/VERBETERINGEN.md` ronde 3).
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
  krimpen mee, onder 900 px hoogte compacter. De rijen onder de mixer (stems …
  klankschaal) staan samen in `#rijen`, dat zelf scrolt: main wordt nooit lager
  dan zijn inhoud met de faders op 56 px (`min-height:min-content`), dus faders
  en sampler blijven heel met welke rijen ook open (6 okt, `tools/headless/rijen.mjs`).
  Een nieuwe rij hoort in `#rijen`. `#rijen` houdt rechts 8 px vrij: met alleen een
  trackpad zweeft de schuifbalk van macOS over de inhoud (een muis: hij neemt zelf 15 px);
  rijen.mjs toetst beide standen, los van wat er aan de Mac hangt. Per kolom bovenaan resterende
  tijd (14 px, rood onder 30 s als hij speelt) en BPM, groot genoeg voor de
  zaal. Labels ≥ 11 px. APC-knopnamen alleen in de KOPPELMODUS (anders ruis).
  MAAT-badge zegt "(stil)" als de maatgever stilstaat; hotcues overal geel met
  nummer; foutmeldingen blijven staan tot je ze wegklikt. De renderloop leest
  het focusoverzicht uit een cache en schrijft alleen wat verandert. De golfvormen (zoom,
  overzicht, de acht banen) TEKENEN alleen als hun sleutel verandert (`zelfde()` in waveform.js:
  analyse, maat, positie in hele apparaatpixels, loop, cue, hotcues, grid, zoom). Elke teken-actie
  is een upload naar de GPU: zonder sleutel tekende VARVE in rust ~29 Mpx/s en liep Demucs (stems)
  op de helft (gemeten 5 okt). Tekent een nieuw element iets in een draw(), zet het in de sleutel.
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
- Sync kent geen "het andere deck" meer: een track synct naar de MAATGEVER
  (`Engine.maatgever()`): de hardst klinkende (faderGain × crossfader) die speelt,
  een grid heeft, niet wacht en niet remt, met HYSTERESE (25 sep): een ander
  neemt het pas over als hij 3 dB harder klinkt (`MAAT_MARGE_DB`) en dat 250 ms
  audioklok volhoudt (`MAAT_WACHT`); stopt of remt de maatgever, dan meteen. Puur
  (`volgMaatgever`); een timer bepaalt alleen WANNEER, een wissel meldt 'change'.
  `syncMaster(id)`: maatgever → luidste andere → luidste wachtende als verder
  niets klinkt → eerste geladen met grid. MAAT-badge, bussen, sampler, sync,
  starten op de maat, video-puls en vormen volgen zo dezelfde track; puls en
  vormen alleen als je hem hoort (`maatgever()` in puls.js).
- Wat je HOORT staat op één plek, `src/engine/hoorbaar.js`: positie −
  (outputLatency + baseLatency) × rate tijdens spelen (tijdens een rem de
  snelheid van nu; rate 0 is echt), de positie zelf als hij stilstaat of wacht.
  Video `_volg` gebruikt `naVertraging()`, dat ook stilstaand aftrekt (anders
  seekt de video bij elke pauze). Bend telt niet mee (< 1 ms).
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
- Overgangen op een AudioParam (kruisfade, kill) NOOIT als `setValueCurveAtTime`
  (25 sep): bovenop een lopende curve gooit `setTargetAtTime` NotSupportedError,
  en afbreken met `cancelAndHoldAtTime` gooit niet, maar Chrome speelt het
  afgekapte stuk dan opnieuw af vanaf het begin (sprong 0,15–0,6). Gebruik
  `zetHellingen()` (`src/engine/overgang.js`, via `zetOvergang` in fx.js en
  `killEqBand`): vasthouden, beginpunt, lineaire hellingen, en pas beginnen na
  `startDrempel`, want de renderthread loopt tot ~7,5 ms vóór `currentTime` en
  Chrome zet een voorbij punt op zijn eigen nu: korte hellingen vallen dan samen
  tot één stap (de kill van 5 ms in één sample). Een doelwaarde (mix, EQ-knop)
  gaat direct via `zetDoel()`/`setEqBand` (houdVast + setTargetAtTime). De mock
  telt afgebroken curves (`CURVE_BREUK` = 0); `kijk.mjs` meet het in Chrome. Nog
  op nu: gate zonder maat (5 ms) en de declick van de BufferBron (4 ms).
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
  de audio is ALS de seek klaar is (seekduur per video, gemeten in `_volg` tot
  het eerste beeld met `seeking` weer false; NIET met het `seeked`-event: dat
  komt onder belasting na de volgende sprong, seekduur zakte naar ~0 en de
  video's bleven springen). Het doel is
  wat je HOORT: deckpositie min uitgangsvertraging, op `deck.snelheid` (ook bend
  en rem). Zichtbaarheid = fader × crossfader; wat onzichtbaar is of op de maat
  wacht wordt gepauzeerd en niet geüpload. requestVideoFrameCallback is gemeten en
  NIET gebruikt: zijn `mediaTime` loopt ~10 ms achter op wat `texImage2D` uploadt.
  Ontbrekende of kapotte video: een fout in de strook (`fouten.js`), één per bron.
- HET LOSSE VENSTER MENGT ZELF (25 sep, ROADMAP 18, `docs/BEAMER.md`):
  `video.html` heeft een eigen VideoMixer, eigen `<video>`'s en WebGL op ZIJN rAF,
  dus de beamer loopt door met het hoofdtabblad verborgen. Het leest
  `window.opener.varveBeamer` (same-origin, zelfde thread; geen berichten, want
  de timers van een verborgen tabblad worden geknepen) en neemt elk beeld via
  `neemOver()` alles over, ook DEZELFDE beeldlaag-objecten; de bus blijft bij het
  hoofdvenster. Open en zichtbaar = het hoofdvenster mengt niet en toont het
  beamerbeeld via captureStream (`wieMengt`); verborgen = het paneel mengt weer.
  INLOOP (`beamer.js`): gaat het losse venster open of komt het terug van
  verborgen terwijl het hoofdvenster mengde, dan blijft DAT mengen en zet het
  elk beeld meteen op het losse canvas (`toonBeeld`, in dezelfde taak: een
  WebGL-canvas zonder preserveDrawingBuffer is leeg zodra hij getoond is;
  captureStream liep onder belasting tot 2,9 s weg). Het losse venster stuurt
  en uploadt intussen zijn eigen video's zonder te mengen (`loopIn`: een
  `<video>` die niemand uitleest krijgt geen vers beeld) en neemt over als alle
  zichtbare 0,3 s binnen 50 ms lopen (`inDePas`), of na 20 s. Hoofdtabblad
  verborgen = meteen zelf mengen. Gemeten: acht tracks 8–9,4 s inloop, elk
  beeld binnen 150 ms, overname naadloos.
  Headless: `tools/headless/beamer.mjs` (Chrome for Testing `--headless=new`:
  alleen daar wordt een tabblad echt verborgen).
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
  maatgever van de engine (zie Sync), alleen als je hem hoort, op het moment dat
  je hem HOORT. De puls komt bovenop de knopstand en dooft binnen een halve tel.
  Een nieuwe sectie van de maatgever is een ACCENT op de puls (6 okt, `metPuls(…, accent)`,
  `VideoMixer._accentNu` met een `SectieLezer`): vol, wat de diepte ook is, alleen met de puls aan. Geen
  nieuw PULS_DOEL: de doelen lopen rond in het handelingenlog.
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
  paneel dicht is, anders neem je zwart op. Een nieuwe opname neemt het canvas
  van wie er mengt (`Beamer.opnameCanvas`): met het losse venster open mag het
  hoofdtabblad verborgen zijn, zonder bevriest de opname in een achtergrondtab.
  Een opname die in het hoofdvenster begon blijft daar (MediaRecorder wisselt
  niet van bron). Het beeld loopt een paar ms
  achter op het geluid in de video (de mixer mikt op wat je HOORT, de
  opname-tap zit vóór de uitgangsvertraging): minder dan één beeld.
- HANDELINGENLOG (25 sep, ROADMAP 20, `docs/HANDELINGENLOG.md`): elke action als
  `[t, action, waarde]` op de audioklok, plus laad/focus/rack/grid/hotcues/pads en
  een beginstand. Het hangt aan de bus (`bijInvoke`, vóór de action) en de
  laadlaag (`naLaad`); de engine weet van niets. Bewaard NAAST de opname
  (`opnames/set-<id>.acties.jsonl`, zelfde id), in stukken op hun byte zoals
  `?frame=N`, alleen ASCII (tekens = bytes). Rack, grid, pads en hotcues worden
  VERGELEKEN, niet gemeld: zo komen editor, server en de hotcues die na het laden
  terugkomen erin. Terugspelen: beginstand, dan T0 + t op de audioklok; slaat
  `record.*`, `log.*`, `layer.*`, `rack.next/prev` en `track.N.key*` over, en op
  een track zonder zijn nummer van toen ook transport. MIDI doet mee (een fader
  moet altijd kunnen). Terugspelen bewaart NIETS in de library
  (`staat.terugspeelDecks`). Opnieuw renderen (● dan speel): de beginstand gaat
  buiten de bus om, dus `Terugspeler.onStand` schrijft een `stand` midden in het
  lopende log. Klikken op golfvorm/baan springt via de bus (`track.N.seek`).
  ALTIJD AAN (Clay 26 sep, J18): vinkje in de lijst achter ↺, onthouden in
  localStorage `varve.log.altijd`; het log begint vanzelf zodra de AudioContext
  loopt (niet eerder: de klok van het log staat dan stil), één keer per pagina,
  dus ○ log stopt hem voor deze keer.
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
  - `zetOvergang` (was `zetCurve`) houdt een lopende overgang vast en gaat van
    daar verder: twee rackwissels binnen 40 ms gooiden anders NotSupportedError.
    De mock in engine.test is daarom net zo streng als Chrome.
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
    tempowissels. Na een serverwijziging: server herstarten. `leesJson`
    verzamelt Buffers en decodeert één keer (25 sep: `data += d` brak een
    UTF-8-teken over een pakketgrens); statische `/opnames/` komt uit `VARVE_OPNAMES`.
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
    bij opstarten gaat de server voor (E3; sinds 25 sep als VERSCHIL, zie onder
    MAPJES). MAAT-badge toont wie de maat geeft.
- BEELD-NOODKNOPPEN (2 okt, ONTBREEKT A4, `docs/BEAMER.md`): `video.black` (fade
  250 ms), `.black.hold` (direct), `video.freeze`, `video.master` (0..1) en
  `video.flash` (300 ms) werken in de LAATSTE stap (tonen, `src/video/eindbeeld.js`):
  zaal, los venster en opname zien hetzelfde, de sporen onthouden er niets van.
  Zwart wint van alles en is precies 0. De klok is `performance.timeOrigin +
  performance.now()`, NIET de audioklok: een fade op een stilstaande AudioContext
  wordt nooit klaar, en de absolute klok is in beide vensters dezelfde. Het losse
  venster neemt de stand over in `neemOver`; `toonBeeld` (inloop) zet de toon
  neutraal, want het geleende beeld heeft hem al. Bevroren toont het laatste
  eindbeeld van NA het indrukken; de video's lopen door. Zwart en bevriezen staan
  in de beginstand van het log. APC: de master-knop (`note:0:80`) = zwart in elk
  mapje; in de modus video rechts flits, zwart vasthouden, zwart, bevriezen.
- BACKUP VAN DE LIBRARY (2 okt, ONTBREEKT A6, `server/backup.js`, docs/LIBRARY.md
  "Backup"): `VACUUM INTO` op een eigen alleen-lezen verbinding in een
  worker_thread, NOOIT het bestand kopiëren (in WAL staat recent werk alleen in
  `-wal`). Bij het opstarten en elk uur als `lib.wijzigingen()` veranderde; alleen
  bewaard als de SHA-256 afwijkt van de nieuwste kopie; fsync en quick_check vóór
  het hernoemen. Bewaard: de laatste 12 plus de nieuwste per dag van 30 dagen,
  alleen namen `library-JJJJ-MM-DD_UU-MM-SS.db`. Standaard `media/backups/`,
  `VARVE_BACKUPS` om te verleggen. Mislukt = `[backup] MISLUKT` in het log en een
  rode tegel in de Controlekamer; de server draait door. `GET /api/backups` geeft
  alleen de stand; de kopieën staan niet op de witte lijst. Terugzetten met de
  hand: server stoppen, `library.db` plus `-wal`/`-shm` opzij, kopie als `library.db`.
- RANDGEVALLEN (2 okt, ONTBREEKT A9, VERBETERINGEN ronde 4):
  - Hotcues: van 'load' tot het antwoord van de server is een gezette hotcue
    VOORLOPIG en gaat niet naar de server. Een bewaarde op die plek wint, en het
    deck springt erheen als de druk ≤ `HOTCUE_VERS` (1 s) oud is; een lege plek
    houdt de jouwe. Mislukt het ophalen, dan blijft de voorlopige alleen op het
    deck. (De sprong naar de bewaarde gaat niet via de bus.)
  - Geen enkele trap van `syncMaster` kiest een track die remt.
  - `speelt` en `remt` komen van de audioklok (`remVoorbij` in bron.js): vanaf de
    stilstand is het een pauze, ook als de timer nog niet vuurde; tempo, loop of
    pauze in dat gat maken de pauze eerst af (`_remAfAlsStil`).
  - Gate zonder maat: de poort gaat open via `zetHellingen` na `startDrempel`,
    elke puls met een eigen gain die uitvloeit voordat de bron stopt. Op nu staat
    alleen nog de declick van de BufferBron.
- OVERAL OPENEN (2 okt, `docs/TAILSCALE.md`): niet publiek, via Tailscale.
  `tailscale serve --bg 8777` zet HTTPS voor de server; `VARVE_HOSTS=<naam>.ts.net`
  laat die naam door `vreemdVerzoek` (Host zonder poort of :443, Origin
  `https://<naam>`); de server blijft op 127.0.0.1. Nooit `tailscale funnel`.
  `localhost` en de ts.net-naam zijn twee oorsprongen: de Web Lock beschermt
  daartussen NIET, dus op de Mac zelf altijd localhost.
- Eigen bestanden (24 september 2026): `POST /api/upload?naam=…` met het
  bestand als body (application/octet-stream, audio/* of video/*; de enige
  uitzondering op de JSON-regel, Host/Origin blijft). GESTREAMD naar een
  werkmap `media/.bezig-upload-*`, onderweg geteld en gehasht; boven
  `VARVE_UPLOAD_MAX` (standaard 8 GB) 413. Dan ffprobe (`onderzoek()`): zonder
  geluidsspoor of geen media = 415 met reden; een hoesje in een mp3 telt NIET
  als beeld. Id `lokaal-<12 hex van de SHA-256>`, url `bestand:<hash>:<naam>`:
  hetzelfde bestand nog eens = hetzelfde nummer, niets opnieuw. De naam is
  alleen titel (tags gaan voor), nooit een pad. Daarna DEZELFDE pijplijn als
  een link (`ingest` en `ingestBestand` delen `verwerk()`). Slepen op een
  track: audio speelt direct zoals altijd; VIDEO (en audio die de browser niet
  leest) gaat via de library en komt daarna op die track — niet als die track
  dan speelt. Het origineel wordt niet bewaard, alleen wat de pijplijn maakt.
  Sinds 10 okt (kaart, `tools/lokaal/`) drie optionele parameters: `?video=0`
  (alleen de audio, ook met beeld), `?titel=` en `?artiest=` (gaan vóór de
  tags). Zonder die drie gedraagt de route zich als voorheen.
- TikTok (en wat yt-dlp verder kent) werkt; gemeten met yt-dlp 2026.08.19 op
  Clay's link (79 s nummer, 57 s ingest, video 720×1280). TikTok vraagt
  browser-imitatie; yt-dlp doet dat zelf zolang `curl_cffi` geïnstalleerd is
  (hier 0.13.0). Zonder curl_cffi, of bij een video die inloggen vraagt, zegt
  de ingest wat er nodig is (`tiktokHint`). Cookies uit de browser lezen zit
  er bewust NIET in. Links worden `https://www.tiktok.com/@naam/video/<id>`
  (zonder "www." herkent yt-dlp ze niet; parameters eraf, zodat dezelfde
  video hetzelfde nummer is). Id's van andere sites dan YouTube krijgen de
  extractor ervoor (`tiktok-<getal>`). Beeld met `-S res:720` (720 op de
  KORTE kant): `[height<=720]` gaf op een staande TikTok niets. De transcode
  schaalt naar hooguit 720 op de korte kant (4K eigen video's ook).
- INGEST-WACHTRIJ (25 sep, ROADMAP 21, `server/wachtrij.js`): één opdracht
  tegelijk, links én eigen bestanden in één rij; `POST /api/ingest` met `{ url }`
  of `{ urls }` (≤ 100), `DELETE /api/ingest/<id>` annuleert. Een bestand dat
  je op een TRACK sleept gaat vooraan (`/api/upload?…&vooraan=1`, achter eerdere
  vooraan-opdrachten; wat loopt blijft lopen; Clay 26 sep, J12). Annuleren met
  SIGINT, niet SIGTERM: yt-dlp (Python) valt op SIGTERM om en laat de ffmpeg
  staan die hij bij live/HLS start; die erft onze pijpen, dus `run()` hing en de
  rij stond stil. Na 3 s SIGKILL voor de hele familie. Een analyse-worker ruimt
  eerst zijn eigen ffmpeg's op (`startFfmpeg`), anders een zombie per annulering.
  yt-dlp meldt voortgang op STDOUT (`--newline`, eigen `--progress-template`).
  Vooraf geweigerd: playlist, kanaal, profiel (`bekijkLink`); in de metadata
  playlists en livestreams. Dubbel (in de rij, of in de library met audio op
  schijf) = geen download. Na een serverherstart (ander `server`-id in
  `GET /api/ingest`) zet de strook "opnieuw" klaar. De strook tekent niet tijdens
  een druk: een knop die tussen indrukken en loslaten vervangen wordt, krijgt in
  Chrome geen klik. `VARVE_YTDLP` = een andere yt-dlp (tests: `nep-ytdlp.mjs`).
- Beeldverhouding: elke videolaag houdt zijn eigen verhouding
  (`videoWidth/videoHeight`, `passen.js`). `video.fit`: passend (standaard,
  zwarte randen) of vullen (bijsnijden). Buiten zijn beeld is een laag
  DOORZICHTIG, niet zwart: naast een liggende video zie je die in de randen.
- Een effect-rack hangt aan een LINK (`tracks.id`), niet aan een fader. Laad je
  hetzelfde nummer op een andere track, dan komen zijn racks mee. Meerdere per
  nummer, één actief. De inhoud is JSON: wat er ín een rack staat is een zaak
  van de FX-laag, zodat het schema niet mee hoeft te veranderen met elk effect.
- LIBRARY (25 sep, ROADMAP 21, `docs/LIBRARY.md`): PAGINA'S van de server
  (`GET /api/library?sorteer=&richting=&van=&aantal=`, hooguit 500; zonder
  `aantal` alles), en het paneel tekent alleen de zichtbare rijen (vaste hoogte
  28 px; iets zwevends, zoals de toonsoortkiezer, staat absoluut onder zijn rij).
  Sorteren alleen op eigen sleutels (`isSortering`), NULL achteraan, gelijkspel op
  toegevoegd + rowid. Schema v6 = `toon_json`, v7 = `hotcues` + `titel_sleutel`;
  tests rekenen met `SCHEMA.length`.
- Hotcues horen bij het NUMMER (tabel `hotcues`, zoals de pads): het deck meldt
  'hotcue' alleen bij zetten/wissen (met quantize de gesnapte tijd),
  `restoreHotcues()` vult alleen lege plekken en meldt niets; `hotcue-opslag.js`
  houdt zelf bij welk nummer waar staat. Laden zet `deckTrack` op null zodra
  `laadStream` slaagt: anders zag de bewaarlus het nieuwe nummer onder het oude
  id en postte grid en toon als null naar het vorige (slot en al weg).
- Alles wat naar buiten gaat loopt door een wachtrij: maximaal 16 berichten per
  4 ms. Comet (Chromium 152) legt zijn eigen MIDI-service om bij een burst —
  vier crashes op 22 september 2026, alle vier in `MidiService_TaskService_Thread`
  op dezelfde codeplek. Dat is hun bug, maar honderd berichten in één synchrone
  lus is sowieso geen net gedrag. Alleen bij het sluiten van de pagina mag het
  direct, want dan is er geen volgende tik meer.
- ÉÉN VARVE-tabblad praat met de APC (`tabblad.js`, Web Lock `varve-mixer`), sinds
  Chrome op 23 sep in `MidiService_TaskService_Thread` crashte met vier
  VARVE-tabbladen die tegelijk init en LED's stuurden. Een tweede tabblad vraagt
  helemaal GEEN MIDI-toegang aan (`midi-opzet.js` wrapt `midi.init`) en neemt het
  pas over als het eerste sluit (een lock verdwijnt ook bij een crash).
  Uitzondering: `apc.html` leest zelf mee, zonder sysex en zonder iets te sturen.
  **Regel voor sessies:** open NOOIT een extra VARVE-tabblad terwijl de APC
  aangesloten is en Clay's tabblad open staat. Vraag Clay eerst de APC los te
  koppelen, of test met zijn toestemming in zijn tabblad.
  AV-kern (`~/src/av-kern`, Vite op :5173) heeft sinds 24 sep dezelfde wachtrij
  en een eigen lock (`av-kern-apc`), maar een Web Lock geldt per ORIGIN: tegen
  elkaar beschermen ze niet. Varve en AV-kern nooit tegelijk open met de APC.
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
  (hotcues/loops/sampler/video/klank op de scene-knoppen, elk een eigen kleur).
  Kort drukken = vast, vasthouden ≥ 400 ms vanuit een ander mapje = gluren.
  Kiesknoppen zijn actions (`layer.<groep>.<knop>`, `layer.grid.next/prev`). Koppelen komt in het mapje
  dat open staat, en met shift vast in de shift-laag. De LED's volgen
  `mapping.actieveRegels()`; wat bij een dicht mapje hoort gaat uit, en het
  ringtype wisselt mee. `mapje-balk.js` toont bij elke wissel wat de knoppen
  doen. De standaardmapping (374 regels sinds voorstel A, 25 sep; 387 sinds 2 okt: modus auto en beeld-noodknoppen) volgt de
  tabel in `docs/APC40.md`; aanpassen mag gewoon in de JSON of met koppelen.
  Grid-modus KLANK (magenta): Shift + scene 5 (scene 5 zelf blijft één druk
  "loop weg") of ▲ ▼. Per kolom rij 1–3 kill hoog/mid/laag zolang je drukt
  (`.hold`; shift + pad = schakelaar), rij 4 rem, rij 5 op de maat. In klank
  brandt scene 5 magenta via `led.lees` (lees bepaalt ook KLEUR en tel). Kill
  fel rood = weg, donkerrood = open; rem fel oranje = remt, donker = speelt. De
  spiegel licht op zoals de LED (`lamp`/`lampOm` = led.lees/led.invert).
  MODUS AUTO (2 okt, VRAGEN AU1, `docs/APC40.md` "Modus auto"): zesde grid-modus
  `grid.auto` (limoen) in de STANDAARDmapping, geen fragment: de auto-DJ hangt niet
  aan een vlag. Openen: Shift + scene 4 of ▲ ▼ (na klank); in auto brandt scene 4
  fel limoen via `led.lees`, de knop blijft video. Bovenste rij: pad 1 ok, 2
  overslaan, 3 langer, 4 nu, 8 aan/uit; lampjes uit de reads van `bindAuto`. In de
  grid-modus blijft Shift + scene 4 "halve tel" (eigen regel
  `note:0:85#shift@edit.aan`). Standaardmapping 387 regels (met de noodknoppen).
  `apc.html` is een interactieve kaart: één APC met de knoppen op hun ECHTE
  plek (uitgemeten op de Features-tekening, User Guide p4: apparaat x 70–1040,
  y 392–970 → procenten). Schakelaars voor grid-modus, strip/rack en shift;
  klik = uitleg (nu, met shift, per modus); zoeken markeert waar een functie
  zit; kleur per soort. Hij luistert zelf mee met de APC (alleen invoer, stuurt
  niets) en volgt shift en modusknoppen via een eigen Mapping die alleen
  `layer.*` uitvoert. Wat een knop doet komt uit de mapping via `kies()`; geef
  een nieuwe action een uitleg in `apc-beschrijf.js` (de test eist dat).
- Eigen mapping = VERSCHIL met de standaard (25 sep, ROADMAP 13,
  `docs/MAPPING-VERSCHIL.md`): `{ kind:'diff', device, base, top, rules, removed }`
  op de server en in localStorage. Laden = `mappings/<device>.json` + verschil, dus
  een nieuwe standaardregel komt vanzelf binnen en een eigen regel wint (stil). Wie
  de standaard verandert, hoeft Clay's kopie niet meer samen te voegen. Export
  blijft VOLLEDIG; "standaard herstellen" = een LEEG verschil (wissen liet een
  kopie uit een andere browser terugkomen). Opstarten bewaart alleen als de server
  gelezen is; kwam de standaard niet binnen, dan die sessie niets bewaren. Code
  van vóór 25 sep leest een verschil als volledige mapping (APC dood): niet
  terugdraaien zonder eerst een export terug te zetten.
  Een oude VOLLEDIGE kopie wordt afgezet tegen de standaard waar hij het
  dichtst bij ligt (`verschilVanKopie`): de huidige of een voorganger uit
  `eerder` in het standaardbestand (verschil met de huidige regels, op
  vingerafdruk gecontroleerd). Zonder voorganger gold alles wat de standaard
  erbij kreeg als "door jou weggehaald". **Na elke wijziging aan
  `mappings/apc40mk2.json`: `node tools/mapping/eerder.mjs`** (vóór de commit;
  idempotent; `mapping.test` faalt anders).
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
  fel, op de "1" van de maat een halve (`track.N.barbeat`, `TEL_VENSTER_EEN`),
  twee berichten per LED per tel.
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

- AV-APP-HUB (3 okt 2026, repo AV-app-hub, PROTOCOL.md §5): alleen met
  `?hub=ws://localhost:7700/app`. De hub bezit APC40 en LPD8; VARVE is een
  LEASE-app: `HubMidi` (src/control/hub.js) is een MidiHub met één nep-poort
  "APC40 mkII (hub)", dus mapping, LED-laag, mapjes en leren blijven gelijk.
  Invoer = `{t:'midi'}` (alleen met focus; loslaten altijd), LED's gaan per
  beeld gebundeld als `{t:'led'}`. Met de vlag: GEEN requestMIDIAccess (ook
  niet in de APC-kaart: de knop geeft de vlag door en apc.html kijkt dan niet
  live mee; vanuit de Controlekamer opent hij zonder vlag), de Web Lock
  beslist niets over MIDI, de init-SysEx wordt ingeslikt (de hub zet 0x42),
  en Clay's bewaarde poortkeuze blijft onaangeroerd.
  - De sectie (PROTOCOL §18 van de hub, 7 okt, `studio/sec-hub`): `levert: ['sectie']`. `engineSecties` =
    een SectieLezer op de maatgever die je hoort (dezelfde als vormbron en video-accent), plus een seintje
    van elke deck. Elke grens die je hoort: één `globaal {sectie.nieuw: true, sectie.energie (die van de
    sectie zelf), sectie.label}`, meteen; vangnet hooguit één per seconde; alles samen hooguit 10/s
    (schuivend venster, de nieuw telt mee). Verder energie (stap ≥ 0,01) en label bij verandering. Na
    (her)verbinden de sectie van nu ZONDER nieuw. t loopt nooit terug; een nieuwe sectie is een GROTERE
    teller. Lezen elke 50 ms + een wekker op de grens of de hoorbare sprong + op hub-berichten (≥ 20 ms).
    Een oude hub negeert het. Toets: `tools/headless/sec-hub.mjs` (8921/9521/7721, `opname: false`).
  - Twee tabbladen: de hub laat de nieuwste winnen, de oude krijgt 4001, wacht
    30 s en MELDT dat (fout-melding, weg na een stabiele herverbinding). De
    status voor de Controlekamer komt van het tabblad dat met de hub verbonden
    is (geen: de lockhouder, tenzij vervangen).
  - Hartslag op de TIJD (`HB_MS` 0,6 s stilte), niet op tikken: in een
    verborgen, stil tabblad lopen timers 1×/s (na 5 min 1×/min). Elk bericht
    van de hub (`globaal`/adem ~10×/s; WebSocket-events worden niet geknepen)
    kijkt ook of er een hb moet. Anders wordt een gepauzeerde DJ op de
    achtergrond `stil`/`weg` en zet de hub de APC uit.
  - Herverbinden 0,5 → 1 → 2 → 5 s; terug naar 0,5 s pas na 3 s stabiel open
    (een hub die aanneemt en meteen sluit: geen lus van 0,5 s); een socket die
    na 5 s nog niet open is, sluiten we zelf.
  - `?hub=` alleen naar deze machine, het privé-LAN (10/8, 172.16/12,
    192.168/16) of de tailnet (100.64/10, *.ts.net, *.local); een andere host
    alleen met `&hub_extern=1`, anders een fout-melding en gewoon Web MIDI.
  - Rollen ALLEEN op het beeld: K2 helderheid = `video.master` (slew 0,25 s),
    K4 beweging = `video.pulse`. K1 (`macro.intensiteit`) NIET op
    `mixer.master`: de pickup van een LPD8-knop volgt de EERSTE app met die
    rol, en andere apps gebruiken intensiteit als beeld (av-scene-kit 0,35);
    dat gaf een hoorbare dip 0,80 → 0,43. Master en crossfader staan zonder
    rol en zonder slew in de cockpit (de hub laat alleen rol-zets glijden;
    snapshots slaan lease-apps over). K1 in VARVE: VRAGEN O1.
  - `paniek` (LPD8 P1, 1 s vasthouden) = `video.black.hold`: het eindbeeld
    zwart zolang hij vastzit, loslaten = de schakelaar beslist weer; de audio
    blijft. Valt de verbinding weg terwijl hij vastzit, dan laat VARVE zelf los.
  - De hubtoets is Bank (0x67, config.json `hubtoets`): met de vlag komt Bank
    (en alles wat je indrukt terwijl hij vastzit) nooit bij VARVE aan. Bank
    was bedoeld voor keylock (VRAGEN I4): open vraag N2.
  Zonder vlag wordt hub.js niet geladen. Toets: `node tools/headless/hub.mjs`
  (toetsApp van de hub + de echte hub met nep-APC/LPD8 en een andere app met
  intensiteit; `VARVE_HUB_REPO`). `test/hub.test.mjs` valideert het manifest
  met de hub als die naast deze map staat; anders meldt `alles.mjs` het als
  overgeslagen (een fout als `VARVE_HUB_REPO` gezet is maar niet klopt).

- VORMLAGEN (24 september 2026, docs/plugins/01-plan.md, stap 1): de
  Vormmachines uit Clay's artifact als generatief beeld over de video. Alleen
  met `?vormen=1` (onthouden in localStorage, `?vormen=0` = uit); zonder vlag
  wordt er niets gemaakt, gebonden of geladen. Clay koos: eerst Varve stap 1,
  dan AV-kern (publicatie 25 okt); lagen tussen mengen en effecten. Op zijn
  vraag "wat denk jij?" was het advies, waarop hij stap 1 liet bouwen: GEEN
  tweede MIDI-driver (de AV-kern-driver zet 0x41, stuurt zonder wachtrij en
  herkent 5 van de 83 blauwdrukfuncties), en de bron van de vormen staat HIER
  (`src/vormen/systemen.js`, AV-kern kopieert). Regels:
  - "Video is slaaf van de positie, beeldlagen zijn slaaf van de maat." Een laag
    krijgt `ctx.currentTime` min uitgangsvertraging en doet stappen van 1/60 s
    (hooguit 3 per beeld, niet inhalen). Stille audioklok = stil beeld.
  - `systemen.js` kent geen DOM, geen `Math.random` (zaad: `g.r()`), geen
    `performance.now`; de test controleert dat. Zo kan hij later in een Worker.
  - De mixer kent geen vormen: `voegBeeldlaagToe({ aan, dekking, mengvorm,
    frame(t) })`. Geen laag aan = de oude drie stappen, bit voor bit; het doek
    `gelaagd` bestaat pas na de eerste laag. De bijna-zwarte achtergrond van
    een vorm (#07090c) wordt in de shader afgetrokken.
  - Het doek van een vormlaag is 16:9, 640 × 360 (25 sep, ROADMAP 7,
    `docs/VORMEN-16x9.md`): 12% minder pixels dan het oude 512², precies 2× naar
    1280 × 720 (de budgetten kloppen), schaal [1, 1] in de mixer; `LAAG_FIT`
    'vullen' geldt alleen nog voor een laag met een andere verhouding. g heeft W,
    H en D (korte zijde / 320); `g.S` bestaat niet meer (vormen.test controleert
    het). De API staat bovenaan hulp.js (`cellen`, `rooster(g, { nx, ny })`,
    `blit`, `midden`); nalopen met `tools/headless/vormen-plaat.mjs`.
  - Clay 25 sep, letterlijk: "Midden, 2 breder". Vormen rond een middelpunt
    blijven heel en rond in het midden (links en rechts doorzichtig boven de
    video); de Harmonograaf slingert breder (een cirkel wordt een ellips) en de
    Zonnebloem loopt door tot in de hoeken. Velden en roosters vullen het doek.
    De bewuste uitzonderingen per systeem (dl, jl, tv-lucht, ep-kanalen, dw, sp,
    ph) staan in VORMEN-16x9.md. Het geluid van de isomorfe is sample voor sample
    gelijk gebleven, maar een samengetrokken dw-wolk bestrijkt ×0,56 van buffer
    en stereobeeld (beeld = geluid).
  - De lagenstap leest het gemengde beeld (een BUFFER) met `1.0 - uv.y`. Met `uv`
    was het een derde omkering en stond de video onder een vormlaag op zijn kop
    (Clay, 24 sep). De lagen zelf zijn canvas-texturen en gaan zoals een video.
    `kijk.mjs` meet het met vier gekleurde kwarten, met en zonder laag, en faalt
    op de oude shader.
  - Knoppen wijzen naar een PLEK (`video.layer.knob.1–6`), op de GEKOZEN laag,
    zoals de FX-knoppen: een andere vorm vraagt geen nieuwe koppeling. Alleen
    knoppen zonder `sel`/`re` (keuzelijsten en herstart-knoppen niet).
  - APC: Detail View opent het mapje `device.vorm` (derde mapje van de
    device-groep; bestaat alleen met de vlag: `voegVormMapjeToe()` vóór
    bindLagen). Daarin device knobs 1–6 = vorm, 7 = dekking, 8 = reageren op
    de mix (`video.layer.react`), Device ◀ ▶ = vorm, On/Off = laag aan/uit,
    Bank ◀ ▶ = laag 1/2 (het open mapje wint van beatjump; shift + Bank blijft
    de beatjump-lengte: een shift-regel gaat voor het mapje, bewust). De
    videomodus op scene 4 is NIET veranderd.
  - Die regels staan in een FRAGMENT (`mappings/apc40mk2-vormen.json`) dat
    `Mapping.voegToe()` erbij zet: het gaat niet mee in `toJSON()`, dus niet in
    Clay's bewaarde mapping, en overleeft het laden van een andere mapping.
    Een eigen regel op dezelfde plek wint; weghalen kan niet (hij komt meteen
    terug). midi-opzet bewaart je mapping alleen als JOUW deel veranderde
    (vergelijking met het laatst bewaarde), anders maakte het fragment van de
    standaard stilletjes een volledige eigen kopie.
  - Alle 26 systemen (24 sep, sporen B1–B3): tien lichte in systemen.js, vijf
    zware (gs, cl, ln, ph, sp), zeven middel (ch, jl, ls, dl, lg, wv, if) en vier
    isomorf (sn, tv, ep, dw). Alleen imports uit hulp.js. sf is middelzwaar
    (~1,4 ms), niet licht. Twee lagen tegelijk, niet meer.
  - `g.kwaliteit` (0,25..1, ontbreekt = 1): zware lussen schalen mee, het BEELD
    wordt grover, de BEWEGING nooit trager (gs/ln op het halve rooster met
    meegeschaalde diffusie/kernel; ph minder agents; cl/if minder punten; fl minder
    deeltjes, sinds 16:9 ×1,78; sp hooguit 150000 × kwaliteit omvallers per stap,
    de rest de volgende stap — abels, dus zelfde eindvorm). dl negeert hem bewust.
  - Isomorf: geluid alleen achter `g.geluid = null | { ctx, uit, grondtoon?,
    toonladder?, korrelBuffer? }`; in Varve nog NERGENS aangesloten, dus alleen
    beeld. Knoppen met `geluid: 1` (volume) slaat draaiKnoppen over. Een
    aanslag met sink rekent 12–32 ms op de hoofdthread: vóór aansluiten naar
    een worklet of cachen.
  - WORKER (stap 3): elke laag een module-Worker als Worker, OffscreenCanvas
    en createImageBitmap bestaan, anders hoofdthread (`laag.modus`). In de
    Worker draait dezelfde VormLaag in hoofd-modus. Terug komt per beeld een
    ImageBitmap via createImageBitmap (NIET transferToImageBitmap: dat wist
    het canvas en de vormen tekenen op hun vorige beeld). `frame(t)` wacht
    nooit. Parameters ALTIJD via `laag.zetParams()` (ook modulatie), niet
    `laag.p` direct. Een ImageBitmap negeert UNPACK_FLIP_Y: zet je dat ooit
    aan in video-mixer.js, dan staan vormen in werker-modus ondersteboven.
  - Tijdsbudget per laag in ms (budget.js): 4 ms hoofdthread, 12 ms Worker
    (aannames, niet op de M1 gemeten). EMA; erboven kwaliteit −0,125, onder de
    helft trager omhoog; noodrem na 3 beelden boven 2× budget: meteen 0,25 en
    een melding, de laag gaat niet uit. Het scherm toont "12 ms · 50%".
  - Een systeemwissel zet de 2D-context terug (`ctx.reset()`) en wist het
    canvas: anders lekten lineCap/imageSmoothing van het ene systeem naar het
    volgende. De lagenstap (programma, doek, texturen) wordt pas gebouwd bij de
    eerste `voegBeeldlaagToe`, buiten teken(). `schoon()` in de shader trekt
    #07090c per kanaal af met een zachte drempel (3–8%): een 8-bits canvas dat
    met kleine alpha vervaagt komt nooit terug op de achtergrond, en die waas
    hoort niet over de video. Bij fl met spoor 0,01 blijft er meer over.
  - REAGEREN OP DE MIX (stap 2): de vorm hoort de MASTER (na de limiter: kill,
    fader, crossfader, sends en sampler tellen mee), niet de hardst klinkende
    track (die wissel gaf sprongen). Analysers per strip en master op fftSize
    2048, smoothing 0; gladmaken doet features.js met exp(-dt/τ) op de
    audioklok (0,02 s op, 0,12 s neer). Banden = gemiddeld vermogen per bin op
    een eigen dB-bereik per band (BAND_DB), geijkt op Clay's library met
    master 0,8. Onset = spectrale flux gemiddeld per band, drempel mediaan(1 s)
    × 1,4 + 0,01, refractair 80 ms; op 30 fps vindt hij er minder (bekend).
  - Een route schrijft een OFFSET via `zetModulatie(i, offset)`: leesKnop/read()
    blijven de basisstand, dus scherm, LED-ring en soft-takeover bewegen niet
    mee. Nooit moduleren via actions of zetKnop. De analyse loopt mee met het
    tekenen (vlak voor laag.frame), geen eigen timer; alle sterktes dicht =
    niets uitgelezen. Eén route per laag, standaard bas → knop 1, sterkte 0;
    `video.layer.react.source/.target` lopen rond. Sessietoestand, niet bewaard.
  - DE MAAT ALS BRON (25 sep, ROADMAP 23, `src/analysis/maat.js`): naast de vijf
    master-bronnen `maatklap` (de klappen uit de offline onset-analyse,
    `deck.onsets`) en `tel` (`pulsVorm`, als `video.pulse`), van de maatgever van
    de engine (`engineMaatLezer`), alleen als je hem hoort. De klap loopt 12 ms
    VÓÓR de klap op tot 1 op de klap (ze zijn vooraf bekend), τ 0,1 s in KLOKtijd.
    Geen sprong: de uitvoer zakt nooit sneller dan de puls uitdooft; neemt een
    track die al speelde de maat over, dan telt alleen wat sinds het vorige beeld
    komt, tot hij terugspringt tot ervóór (loop rond, hotcue). Sinds 6 okt ook `sectie.energie`
    en `sectie.nieuw` (achteraan in BRONNEN, uit `SectieLezer`: geen objecten per beeld, stil na
    een sprong tot je hem hoort, een grens uit een gat > 1 s telt niet; NIEUW_TAU 0,2 s,
    ENERGIE_TAU 0,25 s). Alleen de lezer die
    een open route nodig heeft wordt gelezen (`router.nodig()`). Nog niet:
    `metPuls` zelf als route.

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

## Toonsoort (gebouwd 25 sep) en keylock (gebouwd 5 okt)

Volledig in `docs/TOONSOORT.md` (§13: wat gebouwd is) en `docs/KEYLOCK.md`,
besluiten in VRAGEN blok I. Toonsoort is op 25 sep gebouwd (ROADMAP 14), eerder
dan "na 25 okt" (Clay 24 sep avond: zoveel mogelijk met agenten). Keylock is op
5 okt gebouwd na de luistertest (Clay: "klinkt goed"; `docs/KEYLOCK.md` §9). Wat
een bouwer niet mag missen:
- **Toonsoort is een KAART** in tracktijd, van de plaat, zoals het grid:
  `{stukken:[{van, toonsoort, stemming, zekerheid, tweede?}], bron, slot, versie}`
  per link (schema v6, kolom `toon_json`). Een stemming PER STUK (zoned out +43 ct,
  ADRIANA −45…+25 ct); zonder stemmingscorrectie gaan synthetische proeven fout.
  Profiel Temperley 2005 (8/10 op bekende stukken; edma en Krumhansl 5/10: die
  kiezen op piano de kwint). Zeker ≥ 0,40, onder 0,15 = "~" (geen duidelijke
  toonsoort: bij ambient een eerlijk antwoord); de drempels staan in
  `src/engine/toonsoort.js`. Ze rusten op ~15 stukken: herijken na ~20 sloten.
- SERVER: `server/toon.js` rekent getal voor getal hetzelfde als
  `tools/toonsoort/toon.mjs` (toon.test controleert het); worker-taak, ingest-stap
  na het grid, op de achtergrond per nummer eerst grid dan toonsoort.
  `TOON_VERSIE`: alleen AUTO-kaarten met een lagere versie worden opnieuw gedaan;
  verhoog hem bij een beter algoritme en meet opnieuw (`fragmenten.mjs`). Regels
  als het grid: slot nooit overschrijven, 'hand' alleen via ↻ (↻ = grid én
  toonsoort). `POST .../toon` zonder `toon` = 400, NIET wissen. Alles wat de
  browser post gaat door `normaliseerToon` (vaste spelling C Db D Eb E F F# G Ab A
  Bb B, m voor mineur); toonsoort.test stuurt elke bewerking erdoorheen. null in
  een AUTO-kaart = stilte (zekerheid 0), met de hand = "geen toonsoort". `tweede`
  (de beste met een ANDER Camelot-getal) hoort bij de zekerheid: een stuk dat je
  met de hand zet verliest beide.
- CLIENT: `src/engine/toonsoort.js` (ToonKaart, puur). Het deck krijgt `toonKaart`
  van laden.js (laden wist hem, zoals het grid); `deck.toonsoort` = wat je HOORT.
  Actions `track.N.key.*` en `track.N.key` (24 standen in wijzervolgorde) werken op
  het stuk rond wat je hoort. Geen APC-knoppen (T6) en geen sneltoetsen: een per
  ongeluk verzette kwint wordt bewaard als 'hand'. Kolom: toonsoort ONDER de bpm
  (ernaast drukte de MAAT-badge hem weg); focuskop: klik = correctiemenu;
  library-kolom 'toon' = de PLAAT, klik = kiezer (bron 'hand' + slot). laden.js
  POST elke 1,5 s wat veranderde; een 4xx één keer melden, niet herhalen.
- **Wat je HOORT** (Clay, T3): halve tonen erbij = transpositie + (keylock ? 0 :
  12·log2(rate)) + stemming/100; `bend` telt niet mee (flikkert). De library toont de plaat.
- **Keylock = Signalsmith 1.3.2 BINNEN `stream-lezer.js`** (optie A), gevoed met hele
  frames uit de pagina's; dezelfde segmenten {T, P, R}. NIET hun `.mjs` importeren in
  onze worklet: dat registreert hun eigen processor; de WASM-fabriek moet er los uit
  (`tools/keylock/kern.mjs`, `laadFabriek`). Het npm-pakket heeft GEEN LICENSE-bestand:
  bij vendoren de MIT-tekst uit de bron-repo erbij. De Emscripten-code noemt
  `document.currentScript`: `regels.test.mjs` vlagt dat, dus vendoren in een submap
  of de regel aanpassen. Wat erbij komt in de worklet houdt zich aan de regels van
  het audiopad (geen afval per blok; `renderblok.test.mjs`).
- Hoorbare positie klopt (±0,6 ms) alleen met vooruitblik uitLat + 128 frames.
  Tempo en bend gaan direct in (T = nu); een SPRONG met keylock aan wordt gepland op
  uitLat + één blok (63–93 ms, exact, volle sterkte; Clay K3). Ter plekke seeken
  verliest de eerste ~60 ms. Zonder keylock blijft springen direct.
- Acht decks ~16% van een kern, maar zonder `splitComputation` vallen de STFT-blokken
  samen tot 170% van een quantum: gespreid rekenen is verplicht. Pieken tot +3,6 dB
  bij zang (headroom). Keylock aan/uit wisselen vraagt een polariteitskeuze, anders
  een dip tot −15 dB (ontworpen, niet gebouwd).
- Namen op het deck, gedeeld door beide ontwerpen: `deck.keylock` (boolean) en
  `deck.transpositie` (halve tonen). Transponeren mag ook zonder keylock (K8).
- **Gebouwd (5 okt), regels voor wie eraan komt:**
  - Een segment heeft ZEVEN velden in vaste volgorde (`StreamBron._maak`, `rek`
    erbij): één hidden class voor de worklet. Een segment in een andere vorm liet
    in de test renderBlok weer afval maken (polymorf).
  - Segmenten zonder `rek` gaan door renderBlok zoals altijd: de gouden hash in
    renderblok.test mag niet veranderen. Een rem gaat ook met keylock via renderBlok.
  - Een sprong met keylock = een GEPLAND segment op het zoekrooster (`rekPlanT`,
    ~98 ms): tot T speelt het vorige (`StreamBron._vorig`, `positieIn`). Dat is geen
    start op de maat: `wachtTot` blijft null, `_wacht` is "er ligt iets in de
    toekomst". Fasebehoudende sprongen (sync, nudge, beatjump, gequantiseerde
    hotcue) met `doorlopend`.
  - Zoeken: doel op t0 + uitLat; doorlopen: t0 + uitLat + één blok (gemeten, §9.2).
  - In het hete pad van de worklet geen double als argument (ook niet naar de WASM
    per blok): `_mengB` leest de klok uit `this.t0`. Een WASM-aanroep met een
    niet-geheel getal kost ~48 bytes; alleen per sprong of toonwissel.
  - `src/engine/vendor/` wordt gemaakt door `tools/keylock/vendor.mjs`, niet met de hand.

## Auto-DJ (fase 1, gebouwd 30 sep)

Volledig in `docs/AUTO-DJ.md`. Wat een bouwer niet mag missen:
- De automaat is een extra BRON van actions (zoals terugspelen): alles via de
  bus, dus in het handelingenlog. Laden via `laden.laadLibrary`. Nooit in de
  engine, nooit Claude in het audiopad: Claude levert alleen het setplan.
- De bewakers (`kiesOvergang`) gaan boven het plan: blend alleen met twee zekere
  grids, tempo ≤ 6% en toon ≤ 1 stap NA de sync; anders filter-uit of beatloos.
  Beatloos is in Clay's library de hoofdroute, geen noodgeval.
- Wat Clay aanraakt tijdens een overgang is van hem (`OVERNEEM` in automaat.js).
  Nieuwe knoppen op een deck die de mix raken: daar ook bij zetten.
- Waar de overgang is komt van de POSITIE van de uitgaande (regel 3); de timer
  van 40 ms beslist alleen wanneer er gekeken wordt.
- Fades GLIJDEN (2 okt, ONTBREEKT A7, AUTO-DJ.md §2b):
  `track.N.{fader,filter,send.a,send.b}.glide` = "glijd hierheen in GLIJ = 0,5 s"
  (0..1, geen read, dus niet in de beginstand van het log). De automaat stuurt het
  punt van de curve dat GLIJ verderop ligt (vanaf de positie van de uitgaande),
  opnieuw zodra er nog 0,1 s te gaan is. De bas (wissel) en het einde blijven
  directe standen. `Deck.glide`: lineaire hellingen na startDrempel; een nieuwe
  glijbeurt laat de lopende doorlopen tot daar (`zetVervolg`, cancelAndHold in de
  TOEKOMST op lineaire hellingen, geen curve), een gewone set houdt vast waar het
  geluid nu is. `deck.ui` leest via getters de stand van NU (ctx.currentTime);
  schrijven stopt het glijden. Test met `test/nep-tijdlijn.mjs`.

## Het planvenster (fase 1, gebouwd 30 sep)

Volledig in `docs/PLAN.md`. Wat een bouwer niet mag missen:
- `plan.html` is een VENSTER van de mixer (window.opener.varvePlan, zoals de
  beamer): geen AudioContext, geen MIDI, geen Web Lock. Knoppen gaan over de
  bus van de mixer. Los geopend = alleen editor.
- Eén definitie van een plan: `src/plan/plan-model.js` (puur), gebruikt door
  venster, automaat, server en tests. Stap-id's zijn vast en worden nooit
  hergebruikt; tijden in tracktijd, null = de app kiest.
- Opslaan alleen met `versie` (hash van de inhoud): 409 bij een botsing, nooit
  stil overschrijven. Claude mag het bestand direct schrijven; venster en
  mixer zien het binnen 3 s. `vervangPlan` laat klinken wat klinkt.

## Klankschaal (gebouwd 29 sep)

Volledig in `docs/KLANKSCHAAL.md`. Wat een bouwer niet mag missen:
- Geen pluginsysteem: een instrument naast de sampler (`engine.klankschaal`),
  actions `klankschaal.*`, een rij op het scherm (standaard dicht). Geen plek op
  de standaard-APC (KS1): koppelen werkt.
- De toon komt van `deck.toonsoort` (wat je HOORT, met stemming in cent) van de
  maatgever of de focus-track; `stemming()` is puur en getest over alle 24
  toonsoorten. Past de ladder niet bij majeur/mineur: de RELATIEVE toonsoort.
  Zonder toonsoort: de laatste toon blijven houden, nooit terug naar D.
- De kern (`klankschaal-kern.js`) volgt de regels van het audiopad: geen afval
  per blok, geen Math.random op de audiothread, slapen bij stilte. De test
  meet het (GCProfiler) en meet de toonhoogte (Goertzel).
- Luidheid is gemeten tegen −14 LUFS (`UIT_OPHOGING`, `VELD_OPHOGING`): verander
  je het model, meet dan opnieuw.

## Stems (gebouwd 3 okt)

Volledig in `docs/STEMS.md`. Wat een bouwer niet mag missen:
- De rij (`StemsRij`) gaat niet op aankomst maar op VOLGORDE (5 okt, STEMS.md §6): eerst `vooraan`
  (de STEMS-rij, in de volgorde van vragen), dan de kortste eerst; wat loopt, loopt door. htdemucs
  haalt op de M1 ~3× realtime; fp16 en minder overlap zijn gemeten en NIET de moeite (of hoorbaar).
- Splitsen gebeurt VOORAF, bij de ingest of met de knop in de library, door
  Demucs (`server/stems/splits.py`, Python in `~/.varve/stems-venv`), nooit
  realtime. De engine speelt alleen `stems.wav`: 16-bit, 48 kHz, 4 of 8 kanalen
  interleaved, kanaalpaar k = `namen[k]`, evenveel frames als audio.wav. De SOM
  van de stems is audio.wav (de rest van het model zit in inst/other).
- ÉÉN worklet per deck met ALTIJD vier stereo-uitgangen naar `chain.stemIn`
  (vóór trim en EQ); de streamkern leest één paar per renderBlok-aanroep
  (`stride`/`paar`, `hergebruik` voor paar 1–3). Stereo blijft bit voor bit (de
  gouden hash), stems blijven afvalvrij (0 GC). Geen tweede afspeelmotor per stem.
- Stem-kill is 0 in amplitude met de zachte S van de EQ-kill (`killVersterking`,
  na `startDrempel`, nooit setValueCurveAtTime). Bij elke laad alles open: stems
  horen bij het NUMMER. `inst` werkt in beide standen (bij vier: drums + bas +
  overig samen).
- Een testserver (`VARVE_MEDIA`) splitst alleen met `VARVE_STEMS_CMD` (één
  uitvoerbaar bestand: `maakNepStems(map)`) of `VARVE_STEMS_PY`. Na een
  serverwijziging: server herstarten; schema v8 migreert vanzelf.
- Opnieuw splitsen vervangt `stems.wav`: de ui weigert het zolang een track dat
  nummer met stems speelt, en de StreamBron vangt het af (zie Bekende grenzen).
- Op de APC sinds 5 okt de grid-modus stems (zie Stemkanalen). Een nieuwe
  stem-knop op een deck: ook in `OVERNEEM` (auto-DJ) en, als het een schakelaar
  is, in de beginstand van het handelingenlog (`stemKill`).

## Koptelefoon (gebouwd 5 okt, ROADMAP 27 S1)

Volledig in `docs/STUDIO.md` §3. Wat een bouwer niet mag missen:
- Eén AudioContext, één uitgang met VIER kanalen (op de Mac een samengesteld
  apparaat: Scarlett 2i2 = 1/2 de zaal, koptelefoonuitgang van de Mac = 3/4). Eén
  klok, regel 3. Geen tweede AudioContext met setSinkId: dat zijn twee klokken.
- Zonder vier kanalen (`kanApart(ctx)` false) bestaat de koptelefoon niet: geen node
  erbij, `createMasterChain(ctx, koptelefoon.zaalIn)` gaat dan naar `ctx.destination`
  zoals altijd, en `track.N.pfl`/`headphone.*` lezen null.
- De cue tapt `chain.lpf` (vóór de fader, na trim/EQ/effect/filter); aan en uit met
  `killVersterking` (zachte S na startDrempel). Volume en mix via `zetDoel`. De zaal in
  de koptelefoon tapt `master.analyser` (na de limiter), zoals de opname.
- Zaal en koptelefoon omwisselen is BEDRADING: alleen bij het maken
  (`new Engine({ koptelefoon: { omgewisseld } })`, de app leest localStorage).
- `headphone.*` en `track.N.pfl` horen niet bij wat er klinkt: OVERSLAAN in
  terugspelen.js, NIET_IN_WAARDEN in handelingen.js, niet in OVERNEEM (auto-DJ).
- APC: ● (record arm) zonder shift = `track.N.pfl`; shift + ● blijft het cuepunt.
  Cue Level = `headphone.level`, shift + Cue Level = `headphone.mix` (Clay 5 okt);
  sampler-volume en puls op shift + Cue Level in grid-modus sampler en video.
- Gemeten met `tools/headless/koptelefoon.mjs` (echte Chrome, OfflineAudioContext van
  vier kanalen); de mock in engine.test kent geen echte splitter/merger.

## Instrumenten op een track (gebouwd 5 okt)

Volledig in `docs/INSTRUMENTEN.md` (§3 het contract, §6 de track). Wat een bouwer niet mag missen:
- Een track draagt een nummer óf een instrument (ST7). `engine.zetInstrument(id, soort|null)`,
  `instrumentOp(id)`, `speeltrack()`. Het instrument sluit via een eigen GainNode aan op
  `chain.input`: EQ, effect, filter, fader, sends en cue werken vanzelf. Een instrument erop =
  `deck.leeg()` (het nummer eraf, een lopende laad geeft false); een nummer laden haalt het
  instrument weg. Weghalen: aansluiting klikvrij dicht, dan pas `vernietig()` en losmaken.
- Een instrumenttrack heeft geen buffer: geen maatgever, geen sync of op de maat, de auto-DJ
  laadt er niet op (`_vrijDeck`). Nieuwe code die "een lege track" zoekt: kijk ook naar
  `instrumentOp(id)`.
- Noten gaan NIET over de bus (`src/control/noten.js`): elke MIDI-ingang behalve de APC, via de
  MidiHub (geen eigen requestMIDIAccess, dus alleen het eerste tabblad); een poort van buiten
  (de hub, straks) met `koppel(poort)`. Noot-uit en pedaal gaan naar waar de noot-aan heen ging.
  Knoppen van het keyboard via `mappings/xboard49.json` (`{speel}`, absoluut = soft-takeover);
  de CC-nummers zijn een AANNAME.
- Actions `track.N.inst` (rondlopend; een SPELEND nummer eraf pas bij een tweede druk binnen
  3 s, ook op de APC), `.inst.next/.prev`, `.inst.knob.1–8`, `.inst.stil`. Terugspelen slaat ze
  over, de knoppen staan niet in de beginstand.
- APC: het mapje `device.inst` (Clip/Device View strip → rack → inst) bestaat alleen als de
  focus-track een instrument heeft (`OP_AANVRAAG` + `beschikbaar` in lagen.js); zonder blijft het
  strip ↔ rack.
- De Poly plant zijn envelopes op de audioklok en kent zijn eigen stand (`_envOp`): in Chrome
  begon een lineaire helling na `cancelAndHoldAtTime` midden in een `setTargetAtTime` op 0 (een
  tik bij een GEPLANDE stemroof). Luidheid gemeten: `OPHOGING` 0,52 = −14 LUFS voor een akkoord
  van drie op 0,8; verander je de klank, meet opnieuw (`tools/headless/instrument.mjs`).
- Crossover (10 okt, `docs/INSTRUMENTEN.md` "Uit de sampler"): `sampler.N.drums` zet sampler-pad N
  op drumpad `DRUMPAD_VAN_SAMPLER[N−1]` (S1–S4 → 13–16, S5–S8 → 9–12: dezelfde fysieke
  Maschine-pad als in de padmodus sampler) van `engine.drumsDoel()`, via
  `engine.samplerNaarDrums(n, { pad })`; `pad` is verplicht (de engine kent de tabel niet).
  `drumsDoel()` = de speeltrack als die de Drums heeft, anders de enige Drums; geweigerd alleen
  als de speeltrack een ander instrument is en er twee of meer Drums zijn. Pads 9–16 staan NIET
  in de set; `sampler.N.drums` staat wel in het log, maar terugspelen slaat hem over
  (`OVERSLAAN`): na herladen zijn ze leeg, en `herstelInstrumenten` meldt het als een patroon
  ze gebruikt ("stonden er stukken uit de sampler op, zet ze dan terug …").

## Master en limiter (gebouwd 5 okt)

Volledig in `docs/MASTER.md`. Wat een bouwer niet mag missen:
- `input (gain) -> fx (InsertSlot) -> limiter -> analyser -> uit`. `master.analyser`
  blijft het EIND: opname, de zaal in de koptelefoon en de vormen tappen daar.
  `master.limiter` is de uitgang van de limiterstap, niet de compressor.
- De limiter (`limiter-kern.js`, puur) houdt zich aan de regels van het audiopad:
  0 GC (`master.test` meet het). Onder het plafond is de gain PRECIES 1 (geen
  pompen, de uitvoer is bit voor bit de invoer, 72 samples later). Verander je de
  kern: `node test/master.test.mjs` en `tools/headless/master.mjs` (true peak 16×).
- De vooruitblik is vertraging en telt mee in wat je hoort: `ctx.graafVertraging`
  in `uitgangsVertraging` (hoorbaar.js), op de context zelf (het losse venster).
- De worklet laadt async: nooit live herbedraden. Context stil = direct erin; de
  audio loopt = equal-power kruisfade van 40 ms, het oude pad weg na de fade.
  Op een OfflineAudioContext eerst `await engine.master.klaar`, dan renderen.
- Het master-rack (`master.fx.*`, `master.rack.next/prev`) is een gewone
  InsertSlot op de klok van de maatgever; welk rack bewaart de schermlaag in
  localStorage (`varve.master.rack`, sjabloon op naam). MIX start altijd op 0.
- APC: Shift + Clip/Device View = mapje `device.master` (knop 1–7, 8 = mix,
  shift + 8 = knop 8, Device ◀ ▶ = rack, On/Off = aan/uit). Alleen regels erbij.
- De cue in de koptelefoon is even laat als de zaal: `koptelefoon.zetVertraging(master.vertraging)`
  (de engine zet hem, ook na `master.klaar`). Open (docs/MASTER.md, "Grenzen"): de master klinkt ~0,8 dB zachter dan met de compressor (die tilde
  op); het master-rack staat niet als gebeurtenis in het handelingenlog.

## Effecten uit de filter app (gebouwd 5 okt)

Volledig in `docs/EFFECTEN.md` (STUDIO S2c). Wat een bouwer niet mag missen:
- Tien effecten in `fx-meer.js` (distortion, chorus, flanger, vibrato, tremolo,
  autopan, auto-wah, pitch, compressor, breedte), in `EFFECTEN` achter de zeven van
  fx.js. Geheugen (90 s) bewust niet: in een insert-rack begint hij bij elke
  ketenwissel leeg. Wat dubbel was (filter, delay, galm, crush, ringmod, phaser) niet.
- Alles met een vertraging of een andere vorm verzet je met TWEE PADEN
  (`wisselaar`: de twee koppen van de delay, lineair, de laatste stand wint), ook
  drempel/ratio van de compressor (Chrome rekent die per blok: trapjes).
- Alles met geheugen zit achter een INLOOP (30 ms): een nieuwe keten begint met
  lege vertragingen, en de vertraagde kopie begon anders abrupt (×21 gemeten).
  De delay van fx.js heeft hem sinds 5 okt ook (was ×46 bij een wissel, nu ×1,6).
- Tijdens het bouwen (klok niet verder) zet `zet()` direct (`zetter`), daarna glijdt hij.
- Worklets: `laadFxWorklet(ctx)` één keer per context, pas bij gebruik; tot dan droog,
  daarna invloeien; was hij er al, dan meteen. `vernietig()` stuurt 'stop'.
- Tremolo/autopan op de maat via `fx-lfo.js`: één cyclus als buffer, start METEEN op
  de fase die hij hoort te hebben en vloeit 20 ms over. Op de "1" van de maat kan
  niet (fxKlok kent alleen de tel).
- Chrome-feiten (gemeten): WaveShaper 2x/4x = 128/192 samples later (daarom geen
  oversampling: met de mix-knop is dat een kam); DynamicsCompressor kijkt 288 samples
  (6 ms) vooruit en doet zelf make-up ((1/curve(1))^0,6, `chromeMakeup`), die wordt
  eruit gedeeld; een DelayNode op 0 is bit voor bit door.
- Een effect dat een oudere versie niet kent, bewaart zijn eigen `bypass` (`_bypass`
  in rack.js); vroeger kwam het er na één keer bewaren als `bypass: true` uit.

## Stemkanalen (gebouwd 5 okt)

Volledig in `docs/STEMS.md` §5 (ROADMAP 27, STUDIO S2b). Wat een bouwer niet mag missen:
- Per stem een filter (`track.N.stem.<s>.filter`, bipolair, zoals het trackfilter), een
  echo en een galm (`.send.a/.b`) en een cue (`.pfl`); read null zonder die stem, de cue
  ook zonder koptelefoonuitgang. Bij vier stems werkt `inst` op drums + bas + overig:
  filter in serie (per kant het sterkste), sends de grootste, cue "of".
- De droge weg `stemIn[k] -> trim` is NIET veranderd. Het filter is een correctie ernaast
  (`maakStemFilter`: x + H(g·x) − g·x), en elk deel (filter, send, cue) komt er pas bij
  als het voor het eerst iets doet, stil, zoals een nieuwe keten in de insert-slot. Er
  gaat nooit iets los. Zonder stems of met alles open: bit voor bit het oude pad en
  dezelfde CPU (gemeten met `tools/headless/stemkanalen.mjs --vergelijk`).
- Stem-sends gaan door een SPIEGEL van de fader (`deck.stemSends[A|B].fader`): elke
  nieuwe code die `chain.fader.gain` aanraakt, moet de spiegels mee nemen (`applyUi`,
  `_glijParams`, `_glijDoelen`), anders blijft de echo van een stem open als de fader
  dicht gaat. Trim zit in de versterking per stem. Niet door EQ, effect en trackfilter.
- De cue van de stems is ÉÉN ingang per track in de koptelefoon (`A:stems`, de engine
  volgt `deck.stemPflIets`); `track.N.stem.<s>.pfl` staat in OVERSLAAN, niet in OVERNEEM
  en niet in de beginstand. Filter en sends wel in OVERNEEM; als value-action vanzelf
  in de beginstand.
- APC: grid-modus stems (zeegroen, Shift + scene 3 of ▲ ▼, achteraan): per kolom rij
  1–5 zang · rest · drums · bas · overig weg zolang je drukt, shift = vastzetten. 83
  regels erbij (480), geen bestaande veranderd; `note:0:84#shift@edit.aan` houdt bpm ½.
- Een insert-effect per stem is gemeten en NIET gebouwd: ~5,5 ms CPU per s audio per
  slot, ook stil (acht tracks × vier stems: +110%).
- Chrome offline is niet deterministisch op de bits als een ingang twee klinkende
  verbindingen optelt (een hashset: 1 ULP), of als er timers in het renderen vallen:
  vergelijk bit voor bit alleen met één klinkende bron per optelpunt.

## Patronen (gebouwd 5 okt)

Volledig in `docs/PATRONEN.md` (§1–6 het contract, §7 wat gebouwd is). Wat een bouwer niet mag missen:
- `engine.patronen` (PatroonSpeler, `src/engine/patronen/`) speelt per track met een instrument vijf
  plekken. Eén KLOK voor alle patronen: klok-tellen <-> audioklok als gebroken lijn (klok.js). Met een
  maatgever (`syncMaster()`, `fxKlok()`) richt hij zich op diens tellen en maat-anker; zonder een eigen
  tempo (`set.tempo`); valt de maatgever weg terwijl er iets speelt, dan het laatste tempo vasthouden.
- Regel 3: de timer (25 ms) zegt alleen WANNEER; noten gaan met `t` op de audioklok, 120 ms vooruit.
  Wat gepland is staat vast: de klok verandert alleen NA `geplandTot`, en dan zonder sprong (in een
  tel naar de doellijn). Vensters zijn halfopen in klok-ticks (384 PPQN): elke noot precies één keer.
  Verander je de klok of de vensters: `test/patronen.test.mjs` (doorlopend, op de tel) en
  `tools/headless/patronen.mjs` (in Chrome, ook in de opname).
- Starten/wisselen/stoppen staan in klok-TICKS, op het eerste maatbegin na wat al gepland is;
  `alleUit(t)` op het maatbegin VÓÓR de eerste noot van het volgende patroon. Instrument weg = patroon
  weg (engine `'instrument'`); een ander instrument = het patroon speelt daarop verder.
- Noten gaan niet over de bus: live opnemen luistert op `noten.js` (`'noot'` met snelheid); stap voor
  stap = de laatst gespeelde noot. Bewerken gaat wel over de bus (`track.N.pattern.step.S`, …) maar
  terugspelen slaat het over (OVERSLAAN): de set is al bewaard. Starten/stoppen/rijen/tempo spelen terug.
- De set staat op de server (`patronen/<naam>.json`, `/api/patronen`, versie + 409, zoals de plannen);
  `server/patronen.js` gebruikt `model.js` (puur). Instrumenten staan er alleen als hint in.
- APC: grid-modus `patronen` (oranje 9/10): Shift + scene 2 of ▲ ▼; pad = plek per track, shift =
  meteen, scene = rij, Stop All Clips = alles stoppen. De read knippert zelf (een instrumenttrack heeft
  geen `track.N.phase`). Alleen regels erbij.

## Xboard49 en Maschine via de hub (gebouwd 5 okt)

Volledig in `docs/MASCHINE.md` (wat elke knop doet). Wat een bouwer niet mag missen:
- Alleen met `?hub=`: `MANIFEST.speelt = ['xboard49', 'maschine-mk2']`; app.js laadt
  `ui/speelapparaten.js` (en daarmee maschine.js, maschine-scherm.js, het profiel en
  `mappings/maschine-mk2.json`) pas binnen `if (hubUrl)`. hub.test controleert dat niemand ze
  statisch importeert. Uitzondering: de Maschine-kaart (`maschine.html`, een EIGEN pagina); hub.test
  controleert ook dat de mixer die nooit laadt.
- Elk speelapparaat heeft een EIGEN nep-poort (`midi.speelPoort(dev)`: "Xboard49 (hub)",
  "Maschine MK2 (hub)", interface van een MIDIInput), NIET in `access.inputs`: de MidiHub, de
  APC-mapping en het echofilter zien ze nooit. Geen focusfilter (de hub beslist wie speelt).
  Weg/terug = `state` + `onstatechange`: noten.koppel en maschine.js laten dan los.
- Wat naar de Maschine gaat (lampjes `{t:'led', dev:'maschine-mk2'}`, schermen
  `{t:'scherm', dev, nr, data}`) loopt door een eigen wachtrij in hub.js (16 per 4 ms, zoals de
  MidiHub), lampjes daarna per beeld gebundeld. De APC-lease is ongewijzigd (LED's zonder `dev`).
- Pads = noten via noten.js (`noten.ontvang` met bron `hub-maschine-mk2-input`), nooit over de
  bus. Knoppen 0–47 zitten op kanaal 1: NOOIT de Maschine-poort aan noten.koppel hangen.
- Het masterwiel KIEST voor de focus-track (scherm), indrukken/ENTER ZET (`track.N.inst.choose`,
  value 0..1 zoals de read van `track.N.inst`; terugspelen slaat hem over zoals alle `inst`).
- Een speelapparaat is nooit "de controller" (`isSpeelapparaat` in midi.js, OOK zonder hub):
  niet automatisch, niet uit localStorage, niet met de hand.
- De schuif van de Xboard is SysEx Master Volume: signature `master-volume` in een
  apparaatmapping (noten.js). Knop 9–16 = FX van de speeltrack. CC's: AANNAME.
- Patronen op de Maschine (`docs/MASCHINE.md` §5): STEP = stapmodus (pad = `track.{speel}.pattern.step.S`,
  lampje = die read, de lopende stap wit via `engine.patronen.stand/stapNu`), PATTERN + pad 1–5 =
  `engine.patronen.kies` (geen action voor kiezen), PLAY/RESTART/REC/ERASE en SHIFT + ◄ ► via de
  mapping met `{plek}` (= de gekozen plek van de speeltrack). Live opnemen gaat vanzelf: de pads
  spelen via noten.js. Een pad laat los waar hij indrukte, ook na een moduswissel (`padVast`).
  Headless: `VARVE_PATRONEN` naar een tijdelijke map, anders schrijft de testserver `patronen/set.json`.
- Secties op de Maschine (`docs/MASCHINE.md` §5b, 6 okt): SCENE = padmodus secties, de 16 pads = de secties
  van de FOCUS-track (groep A–H), pad = `track.N.section.K` via `invoke` (dus log en auto-DJ zien het), ◄ ►
  bladert boven de 16, kleuren uit de read zoals de APC, links op het scherm wat je hoort + een 4×4-raster.
  Eén padmodus tegelijk (STEP, SCENE). De hub in een headless-proef altijd met `opname: false`: de echte
  config heeft een `avondmap`.
- Knoppagina's en uitleg (`docs/MASCHINE.md` §5c, 7 okt, tak `studio/maschine-dj`): ◄ ► links boven wisselt
  Instrument · Strip · Rack. De pagina is een open MAPJE voor de mapping (`lagen` in maschine.js), dus wat een
  knop doet staat in `mappings/maschine-mk2.json` (`"laag": "pagina.strip"`); een nieuwe pagina = regels erbij
  plus een naam in `PAGINAS`. Strip en Rack werken op de FOCUS-track (Instrument op de speeltrack). Waarden in
  echte eenheden uit de engine-formules (`eqDb`, `filterDoelen`), nooit zelf een tweede formule. CONTROL
  vasthouden = uitleg: niets uitvoeren, wel uitleggen (`beschrijf` uit apc-beschrijf.js, meegegeven door
  speelapparaten.js); het loslaten van wat tijdens de uitleg werd ingedrukt gaat nergens heen.
- De Maschine-kaart (`maschine.html`, `docs/MASCHINE.md` §5d, 7 okt): de tekst per control is `legUit()` van een
  eigen Maschine-exemplaar, dus nooit een tweede beschrijving. Knoppen die maschine.js zelf afhandelt staan in
  `UITLEG` als `{ kort, soort, tekst }` (label en kleur voor de kaart naast de tekst van CONTROL). Een nieuwe
  pagina: `PAGINAS` (de kaart volgt vanzelf); een nieuwe padmodus: ook `PADMODI` in maschine-kaart-plan.js. Live
  via `window.opener.maschine` (alleen met `?hub=`): stand overnemen, `maschine.geraakt` (laatst ingedrukt of
  gedraaid) en `maschine.schermen` (wat er naar het apparaat ging). De kaart stuurt NIETS (`invoke` doet niets).
- Bladeren (`docs/MASCHINE.md` §5e, 8 okt): BROWSE = `library.toggle`; zolang de library OPEN is (hoe ook geopend)
  bladert het wiel (`library.next/prev`, maschine.js), ◄ ► = `library.page.*` en ENTER/wiel indrukken =
  `track.{focus}.load.selected` (laag `bladeren` in de mapping). De keuze leeft in het paneel (`gekozen`, een rij
  van de huidige sortering); laden gaat door het paneel, met de tweede druk over een spelende track. Terugspelen
  slaat `library.*` en `load.selected` over: de laad zelf staat al in het log.
- De sampler (`docs/MASCHINE.md` §5f, 8 okt): SAMPLING = padmodus sampler (één padmodus tegelijk). Boven de 8
  sampler-pads (`sampler.K`), onder een sectie in pad 1–8 (`sampler.K.section`), SHIFT + pad = `sampler.K.clear`
  (`samplerPad`/`samplerActie` in maschine.js). Laag `sampler` VOORAAN in `lagen`: ◄ ► = `sampler.length.down/up`,
  draaiknop 5 = `sampler.volume`; de andere draaiknoppen blijven van de pagina.
- Toetsen: `node test/maschine.test.mjs`, `node test/hub.test.mjs`, en headless
  `VARVE_HUB_REPO=<hub> node tools/headless/speelapparaten.mjs` (echte hub, nep-Maschine op
  HID-niveau, eigen poorten; het eerste knoppenrapport na aansluiten is in de hub alleen een
  beginstand).

## Secties (gebouwd 6 okt, tak `studio/secties`; verweven 6 okt avond, `studio/sec-*`)

Volledig in `docs/SECTIES.md`, vragen in VRAGEN blok SE. Wat een bouwer niet mag missen:
- Een SECTIEKAART zoals de toonsoortkaart: `{ versie, opGrid, grid, stukken: [{ van, label, groep,
  energie, zeker?, stems? }], bron, slot }` in tracktijd, kolom `secties_json` (schema v9). NIET in
  `/api/library` (de lijst blijft klein): laden.js haalt hem met `GET /api/library/<id>/secties?maak=1`,
  en de server rekent dan eerst als `moetSecties` ja zegt (geen kaart, oudere `SECTIE_VERSIE`, een ander
  grid — `grid` is een FNV-vingerafdruk van het grid — of stems erbij). 'hand' en slot: nooit overschrijven.
- Grenzen liggen op maatbegins van het grid van TOEN. Verandert het grid, dan wordt de kaart bij het
  volgende laden opnieuw berekend; tijdens een sessie blijft hij staan.
- De sprong (`sectieDoel`): NU springen naar vlak vóór de sectie, zo ver vóór haar "1" als je van de
  volgende "1" af zit (fasebehoudend, `seek` met `doorlopend`); geen timer, geen wachten (regel 3).
  `sectieOpDeMaat` = de sectie op de volgende "1": volgende/vorige rekenen daarvanaf (tijdens een
  aanloop hoor je nog de maat ervóór: `sectieHier` is wat je HOORT).
- APC: grid-modus `secties` (Shift + scene 1, achteraan in ▲ ▼), 40 pads = secties van de FOCUS-track,
  shift = als loop. Kleuren: wit (hoor je, `tel: 'aan'`) / `hemelsblauwdonker` (42) / uit. 82 regels
  erbij, geen bestaande veranderd; `eerder` bijgewerkt met `tools/mapping/eerder.mjs`.
- Labels zijn een gok uit energie en drums (intro · opbouw · drop · break · outro · `deel`); gemeten
  op synthetisch materiaal (`test/synth-nummer.mjs`), nog niet op Clay's library (SE2). Een beter
  algoritme = `SECTIE_VERSIE` omhoog; dan rekent alles vanzelf opnieuw.
- VERWEVEN (docs/SECTIES.md §7, TASKS-SECTIES.md, VRAGEN blok SV). Wat je niet mag breken:
  - Marges: `sectieEen` 0,01 tel en `SectieKaart.index` 1 ms. De server rondt sectiebegins af op 0,1 ms;
    zonder marge viel een begin net ná zijn "1" een maat te laat in. Niet weghalen.
  - Toetsenbord: `SHIFT_TOETS` in keyboard.js (shift+W/E de focus-track, shift+I/O de rechterhand),
    `toetsActie(code, shift)`. Aan het eind van de kaart een melding uit de action zelf (`naarSectieStap`
    geeft `waarom`), niet uit `waaromNiet`.
  - Sampler: `knipSectie` (hele maten van "1" tot "1", stopt vóór een maat die niet vol is; hooguit
    `SECTIE_MAX_MATEN` 32 en `SECTIE_MAX_SEC` 90). Een pad van meer dan 8 tellen IS een sectie en start op
    de "1" van de maatgever (`startOpDeEen`, `fxKlok().tellenTotEen`). Action `sampler.N.section`, rij 3.
  - Plan: een stap mag `in`/`uit` = `{ sectie: K (vanaf 1), label, groep }` hebben; `van` blijft de
    waarheid en de terugval. Een PUT zonder `kent` zet in/uit per stap terug (`herstelSecties`); Claude
    stuurt `kent` ALTIJD mee (docs/PLAN.md §2b).
  - Log: de kaart staat in de beginstand en als gebeurtenis `secties`; terugspelen haalt hem NIET van de
    server. Een sectiedruk draagt `{ van }` (de plek waarvan hij rekende, 4e element van de logregel,
    `invoke(id, v, { laat, van })`). `section.K.loop` staat niet apart in de stand: de loop van het deck
    is de waarheid.
  - Auto-DJ (AUTO-DJ.md §3b): secties alleen met een kaart op een ZEKER grid; zonder kaart precies het oude
    gedrag (ook bij een trage kaart: het wachten stopt vóór het oude moment). De bewakers gaan voor, de soort
    overgang verandert nooit. `momentArgs` (planner.js) is DE rekenregel voor automaat én planvenster: geef
    planMoment nooit losse argumenten. `vindSectie`: dezelfde label+groep, het dichtst bij de tijd van toen
    (binnen `SECTIE_SPELING` 30 s, anders wint `van`).
  - Loops: `sectieHier` vouwt wat je hoort terug in de loop (anders 1–40 ms de vorige sectie na het
    rondgaan), en `sectieOpDeMaat` geeft in de laatste maat van een loop wat er NA het rondgaan komt.
  - Controlekamer: `Library.sectieTelling()` gebruikt dezelfde helpers als `moetSecties`; verander je die
    regel, verander hem op één plek (sec-controle.test vergelijkt ze).
  - `SectieLezer` (src/analysis/maat.js; vormbron, video-accent en hub): een stap terug in t kleiner dan
    GAT (1 s) is geen nieuwe klok (de uitgangsvertraging kan groeien); hetzelfde sectiebegin binnen 0,99
    maat is een herhaling, geen nieuwe sectie; zonder maatgever blijft de energie `HOUD` (0,5 s) staan.
  - Headless: elke `tools/headless/sec-*.mjs` zet VARVE_PATRONEN en VARVE_PLANNEN op zijn tmp-map. Anders
    leest de proefserver `patronen/` van de worktree, en in `sintegratie` is dat de map van de echte mixer.

## Beeld: de Stroommachine (gebouwd 6 okt, tak `studio/beeld`)

Volledig in `docs/BEELD.md`, vragen in VRAGEN blok BE. Het protocol is van de Stroommachine-repo
(`~/Projects/stroommachine`, `github.com/CKrebbers/stroommachine`): `koppel/PROTOCOL-dj.md`. Wat een
bouwer niet mag missen:
- DE KOPPEL-LAAG (`src/koppel/`) staat buiten engine en scherm: geen DOM, geen import uit ui/control/
  server/video (`regels.test.mjs`). `beeld.js` LEEST de engine (duck-typed, zoals maat.js) en schrijft
  er nooit in; de bus roept hem aan via `bindBeeld` (actions.js), het scherm via `beeld-paneel.js`.
- De zender (`varve-beeld-zender.js`) is ONGEWIJZIGD overgenomen (herkomstregel `stroommachine@<commit>`).
  Wijzig hem in de Stroommachine-repo en neem hem opnieuw over, met zijn test (`test/varve-beeld-zender.test.mjs`,
  alleen het importpad anders).
- Ontwerpregel: uit, zonder adres of zonder relay verandert er NIETS (geen WebSocket, geen timer, geen
  melding die terugkomt). Hooguit één melding "verbonden" en één "antwoordt niet" per start.
- De tel = `engineTel` (maat.js): de maatgever die je HOORT, positie − (uitgangsvertraging − extra
  latentie) × rate. + latentie = de tel vóór = het beeld eerder (beamer). Geen maatgever = `speelt:false`
  met de laatste tel. `t` in de berichten is performance.now() (de zender): de Stroommachine rekent het
  klokverschil zelf met ping/pong.
- Track en mix zijn TOESTAND: pas sturen als de Stroommachine er is (verse `beeld-status` of ping,
  < 3 s), en opnieuw na (her)verbinden of als ze HERLADEN is: haar ping-teller begint per pagina bij 1,
  dus een ping-id die niet hoger is dan de vorige = een nieuwe pagina (`hoorBericht`; we luisteren mee
  via een WebSocket-subklasse rond die van de zender, `_meeluisterWS`). Hooguit eens per 10 s
  (`OPNIEUW_MS`), uitgesteld, nooit verloren. De gezette macro's gaan dan ook opnieuw. NOOIT in het
  'status'-event van de zender: die meldt "verbonden" vóór zijn manifest, en de relay wil het manifest
  eerst. Klok, kenmerken en regie gaan altijd.
- EÉN TABBLAD zendt: `magZenden(statusVanMij())` in app.js (de Web Lock, met `?hub=` de hub), anders
  antwoorden twee tabbladen op elke ping en is het klokverschil onzin. Het paneel maakt de koppeling met
  `mag: false`; een start uit localStorage is `vanzelf` (de melding "geen relay" is dan info, niet rood).
- Kenmerken: zolang er iets KLINKT (een track speelt of de master > `STIL`), daarna nog `STIL_MS` door
  (naar ~0) en dan null; anders bevriezen de bronnen van de Stroommachine op de laatste luide waarde.
- Deck A/B = de crossfaderKANT (`kiesKant`): wie speelt met de kanaalfader open, dan wie speelt (fader
  dicht = voorbeluisteren), anders wie het laatst geladen of gestart werd; thru telt niet. Id per nummer: `yt:<videoId>`, `<site>:<id>`, `lokaal:<hash>`, `varve:demo-<zaad>`,
  `bestand:<naam>` (`stabieleId`). De laad komt via `naLaad` van laden.js, net als het handelingenlog.
- APC: mapje `device.beeld` op Shift + Detail View (een device-mapje, want de faders zijn de kern en alleen
  de device-groep wisselt de device knobs). Knob 1–8 = `beeld.macro.*`, scene 1–5 = `beeld.regie.*`, Stop
  All = paniek. Read null zonder verbinding (ring en lampje uit). 15 regels erbij, eerder.mjs gedraaid.
- Een mislukte WebSocket logt Chrome zelf rood in de console (Log-domein); JavaScript kan dat niet
  onderdrukken. Headless-tools tellen dat apart van fouten van onze code.

## Werkwijze die hier werkt

- Eén fase per keer. Maak fase N af en laat hem draaien voordat fase N+1 begint.
- Bij een keuze met gevolgen: benoem de trade-off en kies, wacht niet op goedkeuring.
- Meld het expliciet als iets een aanname is die verkeerd kan zijn.
- Geen features bouwen die niet gevraagd zijn, ook niet als ze voor de hand liggen.

## Beatgrid (23 sep 2026, restpunten 25 sep, docs/BEATGRID.md)
- Het grid is een TEMPOKAART: stukken {van, bpm, anker, zekerheid?, maat?} in tracktijd; tellen
  lopen door over de grenzen. Reken in tellen (timeOf/beatAt) en met bpmAt/beatLengthAt(pos) — nooit
  grid.bpm/beatLength (alleen het eerste stuk). Bewerken raakt alleen het stuk rond de positie
  en loopt via deck.gridGewijzigd() (herankert, zet bron:'hand'). slot = met de hand bevestigd
  (Lock of een tap van ≥ 4 tikken).
- MAAT-ANKER (25 sep): `maat` = tracktijd van een tel 1 op het eigen rooster van het stuk. Zonder
  (oude JSON, analyse) telt hij door vanaf het vorige stuk = de oude maten; daarna houdt elk stuk
  zijn eigen "1". Tel 1 hier zet tel én "1". Reken met maten ALTIJD via barPhase/telInMaat/
  isMaatbegin/beatsBetween, nooit met beat % beatsPerBar. Laden bewaart niets (alleen een bewerking).
- TWEEDE KANS (25 sep, `tweedeKans` in detect.js): de tempocurve van 12 s kiest midden in een
  nummer vaak een toevallig tempo, en dan telt het venster als gat. Een korte keten met binnen
  60 s een keten op hetzelfde tempo T laat de vensters ertussen opnieuw meten op T (T/2 gaat mee,
  2T blijft staan, twee lange ketens nooit samen). Het moet wel ÉÉN grid opleveren
  (`eenGridPast`: > 10% van de vensters > 0,15 tel naast = niet), anders plakte hij een volgend
  nummer op hetzelfde tempo "zeker" vast. Het 156-bpm-stuk van het album staat er na ↻ in.
  ELK STUK MOET PASSEN (25 sep, `stukPast` in analyseerGrid, BEATGRID.md punt 4): per venster de
  fase op het grid van zijn stuk, 0,1 tel rond de fase met de meeste buren (0,15 liet een sprong
  van 0,3 tel toe). Past het niet: splitsen waar de fase verspringt, anders bijstellen op de
  helling, anders onzeker (`PAST_NIET`). Een stuk dat meteen past houdt precies zijn oude grid.
  Een kant of rest < 20 s is een onzeker gat, ook als er een grid op past. Een break tussen twee
  stukken op één grid (≤ 32 maten, puls op de tel of precies op de offbeat) blijft één stuk.
  Bekende grens: een kort stuk op 1–2% ander tempo aan de rand van een lang stuk blijft erin.
  Meten op fragmenten (`tools/beatmeting/rest/fragment.mjs`): met de nul van het hele nummer.
- Verfijnen na "tel 1 hier" (`/grid/verfijn` met anker) is gemeten en NIET gebouwd: op Clay's
  muziek niet beter (de voorflank lukt op 2 van 6 fragmenten).
- Tap: rechte lijn door de tikken; de server verfijnt alleen ±25% rond de getikte fase; geen
  puls (score niet boven een geschudde nul) → zeker:false en de tap blijft staan.
- Bij binnenhalen automatisch analyseGrid (bron:'auto', zekerheid per stuk = fase-stabiliteit
  boven een geschudde nul; blokken worden ook rondgedraaid, anders kreeg een schone 120 bpm
  "geen puls"). Bij opstarten heranalyseert de server op de achtergrond (één tegelijk, worker)
  alleen lege of oude grids (geen slot, geen bron). Slot wordt nooit overschreven, bron:'hand'
  alleen via ↻ in de library. VARVE_HERANALYSE=uit voor tests.
- Zeker ≥ 0,65, geen puls < 0,15 (gemeten op Clay's library: drie groepen 0–0,06 / 0,20–0,62 /
  0,69–0,94). In een onzeker stuk weigeren sync en beat-loops met een melding; op slot geldt
  het hele grid als zeker. Strook onder overzicht en banen; onset-streepjes in de zoom.
- deck.onsets = klappen in tracktijd (GET /api/library/<id>/onsets, eigen ijking 68,5 ms, ±15 ms):
  goed om te snappen, niet om een fase op te zetten.
- Grid-modus op de APC: Shift + Metronome (mapje `edit`, een schakelaar, vooraan in GROEPEN).
  Scene 1 tel 1 hier (snapt ±30 ms naar een onset, vanaf wat je HOORT: positie min
  uitgangsvertraging × rate) · 2 ×2 · 3 ½ · 4 halve tel · 5 nieuw stuk · Nudge ±5 ms (shift ±1) ·
  Cue level bpm ±0,01 (shift ±0,1; track.N.grid.bpm lineair over 40–300) · Lock = slot (alleen in
  grid-modus, het open mapje wint; erbuiten is Lock quantize). Wat de grid-modus niet
  definieert blijft werken. regel.led.lees laat een lampje de stand van een andere action tonen.
