# Structuur van de repo

Verplaatst uit CLAUDE.md op 29 okt 2026 (ongewijzigd), zodat niet elke beurt deze boom inleest.
Per map en per bestand: wat erin staat.


```
index.html          geen build-stap, plain ES-modules
plan.html           het planvenster: de programmering zien, inrichten, live volgen (src/plan/plan-venster.js)
uitlijn.html        de uitlijnweergave als los venster (window.opener.varveUitlijn): alle tracks in tellen van de maatgever (docs/werkruimte/S2.md)
werk.html           de paneelpagina (?s=<scherm>): mac-2 als venster van de mixer, de iPad/iPhone via de server; bedienen na koppelen (docs/werkruimte/S7.md, S8.md)
apc.html            interactieve APC-kaart: knoppen op hun echte plek, wat ze doen (src/ui/apc-kaart.js)
maschine.html       de Maschine-kaart: wat elke knop nu doet (uitleg van de Maschine zelf), live vanuit de mixer (src/ui/maschine-kaart.js)
companion.html      de companion (/companion) voor iPad en iPhone: kaart met wens/kies/haal nu, nu, beeld. Geen geluid, MIDI of Web Lock (docs/COMPANION.md)
controle.html       de Controlekamer (/controle): stand van alles, mixer openen, speellijst (docs/CONTROLEKAMER.md)
avondpakket/        profielen.json: het avondpakket als data (apparaten, profielen, grenzen, paklijst); niet in MAG (docs/AVONDPAKKET.md)
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
                    fx-s10.js       zeven effecten van spoor S10 (kam … duiker), in EFFECTEN achter fx-meer.js (docs/EFFECTEN-MEER.md)
                    modulatie.js    modulators van een rack (lfo, stap, volger, toeval): offsets op de audioklok. Puur.
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
                    worklet-fout.js meldWorkletFout(ctx, wat, { reden, hint }): een fout in een worklet als event op de context; de engine maakt er een melding van (sleutel worklet:<wat>)
  control/          actions.js      DE ACTION-BUS — alles gaat hierdoorheen
                    acties-effecten.js  spoor S10: track.N.fx.xy.x/.y en master.fx.xy.* (de twee knoppen die het rack in `xy` noemt)
                    acties-precisie.js  werkruimte S1: fase duwen, jog, ±1 ms, beatjump ¼/½/1, op de 1, bend-sterkte, duoklik; Duwer (15 ms samenvoegen) (docs/werkruimte/S1.md)
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
                                    speelt Xboard49 en Maschine (eigen nep-poorten, speelPoort(dev)), lampjes/schermen door een wachtrij
                                    (een scherm binair als de hub `kan: ['scherm-bin']` zegt, AR15);
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
                    vertrek.js      Cmd+R/Cmd+W: eerst vragen zolang er iets speelt, wacht, laadt, de auto-DJ aan staat of er opgenomen wordt (één plek)
                    gezondheid.js   de AudioContext bewaakt (sleutel `audio`): suspend = melding, zelf resume (hooguit 1×/10 s, AR6) en de eerste druk op controller/hub/toets ook; klok stil = melding
                    aanhakers.js    werkruimte S0: startAanhakers(ctx) laadt aanhakers/<spoor>.js (precisie … inrichten) na alle opzet; renderloop.stap
                    aanhakers/, beschrijf/, css/  per spoor één eigen bestand (opzet · uitleg van zijn actions · stijl); docs/werkruimte/S0.md
                    rijen.js        rijenregister: de acht rijen melden zich aan met hun eigen zet (registreerRij, rij, rijNamen)
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
                    live-zender.js  de stand naar de server voor de iPad (S7, alleen met een kijker) + de ontvanger van de schrijfweg (S8,
                                    alleen als die aan staat en alleen in het tabblad met de APC)
                    status-zender.js de stand voor de Controlekamer: BroadcastChannel 'varve-status', alleen het eerste tabblad;
                                    met naarServer ook POST /api/mixer (hooguit 1 per 900 ms, zonder kijker 1 per 4 s (AR16), nooit wachten) voor de companion
                    apc-kaart.js    apc.html: de APC met knoppen op hun echte plek, klik = uitleg
                    apc-beschrijf.js elke action in gewone taal (de test eist er een voor de hele standaardmapping)
                    wie.js          "welke track" in een uitleg (wie, WIE, WIE_KERN, wieMet): voor apc-beschrijf en elk spoor in beschrijf/
                    soorten.js      soort (kleur) van een action voor beide kaarten; de kleuren in styles.css (.s-*). Puur.
                    maschine-kaart.js  maschine.html: plaat, schermen, live volgen via window.opener.maschine. Stuurt niets.
                    maschine-kaart-plan.js  plaatsing + wat een control doet = legUit() van de Maschine (label, soort). Puur.
                    toon-weergave.js toonsoort als tekst: kolomkop, focus, library, tooltip. Puur.
                    library-lijst.js de library als virtuele lijst: kolommen, cellen, pagina-cache (de vraag draagt het filter). Puur.
                    library-indeling.js S11: de kolom CATEGORIEËN/TAGS, de tagbalk, taggen, slepen, snel-tags (docs/LIBRARY-TAGS.md)
                    past-bij.js     "past bij": wat mixt met de focus-track (regels van de auto-DJ, docs/LIBRARY.md). Puur.
                    kaart-lijst.js  de muziekkaart als lijst (tab kaart): kolommen, badges, stand → knop, filters, kratten, nachtteksten. Puur.
                    kaart-panel.js  de tab kaart in het library-paneel: zoeken, kratten, haal binnen/zoek, wenslijst, nachtwachtrij (docs/LIBRARY.md "De kaart-tab")
                    hotcue-opslag.js hotcues per nummer bewaren: welk nummer op welke track, één verzoek tegelijk
                    mapping-opslag.js je eigen mapping als verschil: standaard ophalen, omzetten, bewaren, herstellen
                    instellingen-opslag.js de instrument-sleutels (master-rack, klankschaal, poorten, beeld, stems, koptelefoon, vormen, bus-racks) ook op de server: /api/instellingen, server eerst, vervangen waarden bij varve.instellingen.vorige; witte lijst in instellingen-lijst.js (docs/LIBRARY.md)
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
  uitlijn/          reken.js        de uitlijnweergave, puur: as in tellen van de maatgever zoals je hem hoort, banen uit Deck.tijdlijn(),
                                    grid Δ, muziek Δ (faseTussen), drift, maat, vouw, tekensleutel; invoer { decks, maatgever, V, nu }
                    teken.js        pagina · vouw · strook: tegels in tracktijd, tekenen alleen bij een nieuwe sleutel; vaknamen (vakVorm)
                    venster.js      uitlijn.html (geen AudioContext, MIDI of Web Lock); docs/werkruimte/S2.md
  plan/             plan-model.js   het setplan als data: formaat v2 (+ tracks, go, lagen), normaliseerPlan, bewerk, verschil, herstelVelden. Puur (ook de server)
                    klaarzetten.js  een set uit een keuze: volgorde (boog/oplopend), lengte of eindtijd, "past bij"-keten (docs/PLAN-SET.md). Puur.
                    live.js         NU / VOLGENDE / DAARNA, de laag, de verwachte eindtijd uit automaat.stand(). Puur.
                    tijdlijn.js     voorspel: set-tijden en de overgang die de app echt kiest. Puur.
                    plan-venster.js het planvenster (plan.html): lijst, strook, bewerken, opslaan met versie, live via opener
  companion/        companion.js    de pagina voor iPad en iPhone: alleen fetch naar /api; companion-lijst.js het rekenwerk en de HTML (puur)
  controle/         controle.js     de Controlekamer: tegels (server, ingest, mixer via de Web Lock, APC via het kanaal), speellijst
                    speellijst.js   de punten van een proefsessie, in blokken. Puur data; de stand staat in proef/sessie.json
                    backup-tegel.js de tegel "Backup" (laatste kopie, of de fout). Puur.
                    versie-tegel.js de tegel "Versie": draait = op schijf = main = GitHub? Anders wat eerst moet. Puur.
                    speellijst-weergave.js de speellijst per deel: één punt tegelijk, kern, verslag (het oude artifact). Puur.
                    server-tegel.js de tegel "Server": draait hij, de herstarts van de lus (AR9, uit /api/leeft), de secties. Puur.
                    stand-tegel.js  de tegel "Opstelling", het adres van "mixer openen", de tekst onder de kiezer (docs/STANDEN.md). Puur.
                    stand-bewerker.js een opstelling instellen zonder JSON: keuzelijsten → stand. Puur.
                    avondpakket-tegel.js  de tegel "Avondpakket" (vertrek/aankomst, docs/AVONDPAKKET.md). Puur.
                    bedienen-tegel.js  het blok "Bedienen vanaf iPad en iPhone" (S8): aan/uit, koppelcode, apparaten, intrekken
  sets/             model.js        een set als geheel (plan, patronen, werkruimte, momentopname): normaliseerSet, nummersVan. Puur, ook de server (docs/PLAN-SET.md §6)
  standen/          stand-model.js  het formaat van een stand (schema 1): witte lijst van delen, de nacht alleen remmen,
                                    normaliseerStand. Puur, geen DOM, geen imports; ook door de server gebruikt
                                    (server/standen.js importeert dit en src/control/mapping.js, allebei puur)
  library/          indeling.js     spoor S11: het filter (cat, tags en/of/niet, bpm, toon, grid, stems, energie), de zoekregel
                                    (#tag -#tag @categorie bpm:70-90 …), namen/sleutels, plekken, import; k_grid/k_toon/k_energie. Puur, ook de server
  werk/             model.js        de werkruimte als data (schema 1): normaliseerWerkruimte/-Stuk (fouten en waarschuwingen apart), samenstellen,
                                    kern, telNieuwePlekken, kleurControle; S8: waaromNietOpScherm, VAST_NOOIT, TIJDKRITISCH, xy y/druk/los.
                                    Puur, geen imports; ook de server (docs/werkruimte/S3.md)
                    werkruimte.js   de werkruimte in de mixer: deel, wie koos, onthoud, volgt, THUIS, vereist/terugval, vastleggen, peilen
                    apparaten.js    registreerApparaat(id, { zetMapjes, mapjes, aanwezig }); de APC-adapter (layer.* over de bus)
                    kleuren.js      deel -> paletnaam (MIX wit … LIBRARY grijs). Puur.
                    inrichten.js    ✎ inrichten zonder JSON (S8): item erbij/weg, op een scherm, toewijzen aan een groep knoppen
                                    (eigen mapje p-<paneel>), de zoeker (top-40), de Inrichter (opslaan met versie, terug). Puur, alleen het model
  paneel/           protocol.js     de berichten mixer <-> server <-> paneel (S7), invokeBericht/isInvoke (S8). Puur
                    verbinding.js   opener (mac-2) of server (SSE + ping); zetSchrijver = bedienen (S8)
                    paneel.js, vrij.js, kaart.js  werk.html: de vakken, het vrije paneel en de bouwstenen, de kaart (S7); koppelen en ✎ (S8)
                    schrijver.js    de iPad/iPhone: POST invoke (seq, één herhaling), ping met ?k= zolang iets vastzit, wie/koppel (S8)
                    uitvoer.js      in de mixer: de Uitvoerder beslist (panelen van DAT scherm, waaromNietOpScherm), loslaten, bron in het log (S8)
  handen/           kaart.js        de handenkaart: wat elke control doet, vrije plekken, voorstel per nieuwe actie (docs/HANDEN.md). Puur
                    telling.js      de telling van de handelingenlogs: normaliseren, groepen, top. Puur. apc-controls.js: de 148 APC-controls van de hub (kopie)
  auto/             planner.js      de auto-DJ, puur: welk fragment, welke overgang (bewakers), wanneer (frasegrens), de curves
                    automaat.js     de auto-DJ, uitvoeren: laden, klaarzetten, overgang via de bus, overnemen, nooit stilte
  opname/           opnemer.js      je set opnemen: worklet aan de master, stukken naar de server
                    opnemer-worklet.js  telt frames, zet om naar 16-bit, geeft per seconde door
  koppel/           varve-beeld-zender.js  de zender van de Stroommachine, ONGEWIJZIGD overgenomen (herkomstregel bovenaan; wijzigen in haar repo)
                    beeld.js        spoor beeld: klok, kenmerken, track per crossfaderkant, mix, poorten naar de Stroommachine. Leest de engine alleen.
                    niveau.js       laag/midden/hoog/luid voor de zender op de schaal van wat er nu klinkt (8 s, p10–p95, ≥ 6 dB). Puur.
  export/           patronen-smf.js patronen/set <-> Standard MIDI File (type 1, 384 PPQN) voor Logic; buiten de engine (docs/PATRONEN.md §8). Puur.
  lib/              emitter.js      Emitter + clamp/lerp/expMap/dbToGain/fmtTime
                    antwoord.js     leesWeg(res): het antwoord van een fetch lezen, ook als het gelukt is (anders lekt Chrome)
                    notatie.js      getallen als tekst (komma, hz, pct, ms, teken, db), geen imports: ook voor de engine; geen eigen kopie (test/notatie.test.mjs)
                    herhaal.js      een POST herhalen zolang de server weg is (0,25 → 2 s, time-out 10 s, 4xx hooguit 3×, `vol` nooit): opname, video, log
                    smf.js          een MIDI-bestand als bytes: schrijven (zonder running status) en lezen (ook running status). Geen imports.
server/             draait apart: `node server/index.js`
  index.js          HTTP, statische bestanden (no-store), ingest-API, library-API
  ingest.js         yt-dlp (of een eigen bestand) -> ffmpeg -> media/<id>/. Gooit nooit.
  links.js          links netjes maken (TikTok), bron van een nummer, id's, bestandsnamen
  media-plek.js     waar media/ staat: VARVE_MEDIA, media-VERHUISD.txt, binnen iCloud?, isTestserver (VARVE_TESTSERVER=1)
  library.js        SQLite via node:sqlite. Tracks (pagina's, sorteren, filter), peaks, racks, grid, toonsoort, hotcues, stems.
  indeling.js       S11: tags, categorieën (gewoon/slim), snel-tags, het filter als SQL, kaartkrat overnemen, export/import (lib.indeling)
  backup.js         backups van library.db: wanneer, hoeveel, opruimen; het werk in backup-werker.js (worker)
  avondpakket.js    het avondpakket: parsers (pmset, ioreg, df, system_profiler, tailscale, find), profielen, fase, oordeel. Puur
  avondpakket-meet.js  de sondes in kindprocessen met time-outs (nooit fs op media/), cache, bevroren als er een deck speelt, NEP-fixtures
  analyze.js        golfvorm-peaks, onset-envelope en toonsoort vooraf, streamend uit ffmpeg
  analyse-werker.js peaks, onset, tap-verfijning en toonsoort in een worker_thread (server blijft vrij)
  detect.js         FFT, onset-envelope, tempo, segmentatie (+ tweede kans). Geen dependencies.
  toon.js           toonsoort: stemming per stuk, chroma, Temperley 2005, kaart (Viterbi). Puur.
  secties.js        secties per maat: kenmerken, nieuwheid (Foote, energie, stems), grenzen, groepen, labels. Puur (docs/SECTIES.md)
  wachtrij.js       de ingest-wachtrij: één tegelijk (links en uploads), annuleren met een AbortSignal
  opname.js         opnames: WAV dat groeit, kop herstellen na een crash
  patronen.js       patronen per set: patronen/<naam>.json met versie (409), .versies (docs/PATRONEN.md)
  proef.js          de speellijst van de Controlekamer: proef/sessie.json, per punt, atomisch; archief per ronde
  mixer-melding.js  de melding van de mixer voor de companion (POST/GET /api/mixer): isMelding, vanDezeMac, MixerStand (alleen geheugen). Puur.
  handelingen.js    handelingenlogs naast de opnames: stukken op hun plek, lijst, lezen
  sjablonen.js      spoor S10: eigen sjablonen (racks/eigen.json, VARVE_SJABLONEN), versie + 409, alleen deze Mac (routes/sjablonen.js)
  stems.js          de stems-rij: Demucs starten (nice), één tegelijk, annuleren, werkmap, nalopen, verhuizen
  stems/splits.py   de splitter: Demucs htdemucs in stukken met kruisfade, 16-bit stems.wav + stems.json (docs/STEMS.md)
  kaart.js          de muziekkaart als zoeklaag: varve-kaart.json in het geheugen (zoeken/filteren/sorteren/pagineren), binnen = tracks.id,
                    wensen en nacht_runs in een EIGEN media/kaart.db, een YouTube-versie zoeken (ytsearch5, nooit cookies) (docs/KAART.md)
  nacht.js          de nachtwachtrij: venster, speeldagen, wensen dan standaardvolgorde, één tegelijk met pauze, stopt bij een deck of 403; media/nacht.json;
                    "vandaag niet" geldt voor de komende nacht (komendeNacht), ook 's ochtends gezet
  standen.js        standen (docs/STANDEN.md): standen/<naam>.json met versie (409) en .versies, activeren (mapping, nachtrem,
                    nakijken, master vastleggen), verschil, vastleggen, terug (.vorige/ met `raakt`), .actief.json; VARVE_STANDEN;
                    lezen uit het geheugen zolang stat niets nieuws zegt, één lees per pad en hooguit 2 tegelijk voor de hele
                    server (MAX_DRADEN: iCloud mag de threadpool niet vullen, de andere 2 draden blijven voor de audio)
  poort.js          poortBezet(poort): vóór alles kijken of de poort vrij is (AR20); index.js stopt dan met exit 3 zonder iets aan te raken
  versie.js         welke commit draait, staat er op schijf, heeft main op GitHub (git in een kindproces, caches 15 s / 10 min); GET /api/versie
  lus.js            leesLus(env): wat de herstartlus meegaf (VARVE_LUS_SINDS/_AANTAL/_HERSTARTS) voor GET /api/leeft (AR9). Puur
  uitzend.js        uitzenden stap 1: een UITGANG, geen bron. Volgt de opname die al groeit en duwt hem via ffmpeg naar een LOKAAL doel
                    (bestand, rtmp/udp op 127.0.0.1); slot tegen elke dienst; nog geen route of knop (docs/UITZENDEN.md)
  routes/           werkruimte S0: index.js laadt werkruimtes/mapping-apparaat/paneel/sets/sjablonen/indeling.js ({ routes, mag }), vlak vóór de 404;
                    indeling.js = /api/indeling/* (S11, elke POST alleen deze Mac)
  paneel.js         S7 PaneelRelais (de stand naar de kijkers, SSE) + S8 PaneelSchrijf: schakelaar (standaard uit = 404), koppelcode,
                    token-cookie (alleen de hash op schijf), Origin, rem 120/s, seq, het kanaal naar de mixer, loslaten na 1,5 s
  werkruimtes.js    werkruimte S3: werkruimtes/<naam>.json met versie (409 met de huidige inhoud) en .versies/, voorbeelden uit
                    tools/werkruimtes/voorbeelden/ (een eigen bestand gaat voor), VARVE_WERKRUIMTES; opslaan alleen vanaf deze Mac (W1);
                    S8: POST …/terug (de vorige versie, 409); tools/werkruimtes/top40.json op de witte lijst (de zoeker van ✎);
                    lezen onder dezelfde grens als de standen (`beperkt` + ANDERE_LEZERS in standen.js: samen hooguit 2, 503 na 2 s)
tools/              beatmeting/ (metingen op Clay's library, alleen lezen; LEESMIJ.md zegt wat leeft: synth/ voor beatbench.test,
                    synth/bench.mjs --beatthis <python> = het echte model, synth/snap.mjs; ar2.mjs = de metingen van AR2 in één opdracht (droog, --meet,
                    verslag in uit/); vloer.mjs = AR4, stukken met vier op de vloer waar de downbeats niet op de "1" vallen; de rest is onderzoek van sep), git/ (test-index.sh, hunks.py),
                    media-verhuis.mjs (media/ buiten iCloud: --droog, --doe; docs/LIBRARY.md "Waar media/ staat"),
                    lokaal/ (importeer.mjs + kies.mjs: Clay's eigen muziek via /api/upload met video=0, --droog; LEESMIJ.md),
                    headless/ (kaart.mjs: de tab kaart op de nep-server kaart-nep.mjs; kaart-echt.mjs: de tab kaart tegen de
                    echte kaart-routes van een server die al draait (kopie van de library, nep-yt-dlp, echte varve-kaart.json); kijk.mjs, apc-klank.mjs, toon.mjs, toon-keten.mjs, library.mjs, kijk-ingest.mjs,
                    vorm-maat.mjs, vormen-plaat.mjs, past-bij.mjs, beamer.mjs, stems.mjs, secties.mjs, sec-toets.mjs, sec-sampler.mjs, sec-plan.mjs, sec-log.mjs, sec-auto.mjs, sec-vorm.mjs, sec-controle.mjs, companion.mjs, koptelefoon.mjs, instrument.mjs, instrumenten.mjs, master.mjs, effecten.mjs, stemkanalen.mjs, patronen.mjs, rijen.mjs, beeld.mjs: headless zonder MIDI;
                    beeld-e2e.mjs: met de echte relay en Stroommachine uit ~/Projects/stroommachine;
                    zaalbeeld.mjs: video.clips op Metal, eigen server 8806 (--opruimen na een harde stop);
                    beeld-lokaal.mjs: de Stroommachine naast VARVE meten (--zelftest zonder GPU; de volledige run NIET op een speeldag);
                    werk-scherm.mjs, werk-ipad.mjs (S7 + S8: koppelen, de xy-pad op een nep-iPhone, weigeren, loslaten), werk-maschine.mjs,
                    inrichten.mjs (✎ in echte Chrome), werk-alles.mjs (de totaalmeting van de werkruimte, C6);
                    avondpakket.mjs: de tegel Avondpakket (eigen server 8914, NEP-fixtures, de mixer-lock in een tweede tab);
                    herstart.mjs: de tegel Server na een kill -9 en een hang onder de echte herstartlus (AR9, poorten 8916/9516);
                    en los: tools/avondpakket.mjs, de CLI van het avondpakket (exit 0/1/2/3; docs/AVONDPAKKET.md);
                    maschine-kaart.mjs: de Maschine-kaart los en live vanuit de mixer (nep-poort, geen hub);
                    bladeren.mjs: BROWSE, wiel en ENTER op een nep-Maschine met een echte library (twee testnummers);
                    maschine-sampler.mjs: SAMPLING op een nep-Maschine met de echte sampler (knippen, spelen, tellen, volume);
                    sampler-drums.mjs: crossover, een sampler-pad als drumpad 13 in de echte Web Audio (inhoud, strip, patroon,
                    tempo, koptelefoon) en de knoppen 1→13 … 8→12 in de app op 1440×900 en 1440×790 (muisklik, koppelmodus);
                    sampler-drums-stems.mjs: hetzelfde met een GESTREAMD library-nummer met vier stems (synthetisch, tijdelijke db),
                    kills, knip, drumpad 13, Goertzel per stem, deck-vergelijking met de crossfaderkant erin (proefpunt cx-stems);
                    hub.mjs, speelapparaten.mjs, sec-maschine.mjs en sec-hub.mjs: met de echte hub, nep-APC/LPD8/Xboard/Maschine;
                    led-vertraging.mjs: druk -> lampje in Chrome met de echte hub), bench/ (renderblok.mjs:
                    CPU en afval; draadpool.mjs: hangende iCloud-bestanden tegen de decks, standaard vs UV_THREADPOOL_SIZE=16;
                    feedback.mjs + feedback-samen.mjs: de LED-laag, druk -> lampje, echo's, de Maschine),
                    headless/lek.mjs (groeit de renderer: PROEF=opname, laad (60×) en wissel (50× instrument ↔ nummer), eis ≤ +20 MB privé na GC), headless/gezondheid.mjs (suspend + nep-APC = weer aan, 'stop' komt aan, processorerror hersteld), headless/beeld-afval.mjs (afval per beeld met 8 spelende tracks) en headless/acht-video.mjs (acht decks + acht video's: wacht de audio?), mapping/ (eerder.mjs: voorgangers van de standaardmapping),
                    stems/ (Demucs-proef meet.py, vergelijk.py, snelheid.py), toonsoort/ (meetinstrument), keylock/ (Signalsmith-proef +
                    luisterbestanden), varve-app/ (de Dock-app VARVE: start de server via server-lus.sh, de hub alleen als de opstelling "via de hub" zegt (hub-nodig.mjs, AR21), opent de Controlekamer;
                    server-lus.sh: POSIX sh, herstart hooguit 5×/min, `stop`/`status`, ~/.varve/server-lus.pid;
                    een wachter peilt /api/leeft en zet een server die hangt neer, AR18),
                    headless/server-weg.mjs (de server 30 s weg met twee decks, opname en log: 0 stille vensters, WAV zonder gat;
                    VARVE_WEG_SOORT=hang = SIGSTOP/SIGCONT, =lus = onder de echte lus zonder SIGCONT, VARVE_WEG_KOPIE = de opnames bewaren),
                    proef/ar-na.mjs (na de proefavond van de architectuurronde: nullen in de WAV in een storing, het log, de herstartlus
                    in ~/.varve-server.log, het grid tegen de tellen; alleen lezen, op kopieën, droog standaard; docs/verslagen/2026-10-15/ar-proef.md),
                    setboek/ (lees.mjs: wat er op een avond KLONK uit de handelingenlogs, puur; gebruik.mjs: de teller;
                    setboek.mjs: de CLI op KOPIEËN, --dag/--vanaf/--log, --db, --proef, stdout; LEESMIJ.md),
                    patronen/ (midi.mjs: een set patronen als MIDI-bestand voor Logic, op een kopie; LEESMIJ.md),
                    beeld-lokaal.sh (beeld op één machine: relay + Stroommachine in een eigen Chrome-bundel, --droog/--stop/--installeer) — zie tools/README.md
                    backup/: kopie.mjs, controleer.mjs, herstel.mjs, launchd/ — de staat buiten de laptop (docs/BACKUP.md)
Input/              door Clay aangeleverd materiaal (zips, blueprint) — zie docs/INPUT.md
mappings/
  apc40mk2.json     standaardmapping (data, geen code), met zijn voorgangers in `eerder`
  generic.json      leeg startpunt
  apc40mk2-vormen.json  fragment: het mapje "vorm" (alleen met ?vormen=1, komt BIJ de mapping)
  stukken/          stukken van de werkruimte (WERKRUIMTE.md B4: fragmenten per apparaat, alleen VRIJE plekken); basis.json = ⇧ master-knop THUIS (S3);
                    uitlijn.json = mapje device.uitlijn op ⇧ Lock, acht fasemeters (S1; ook los met ?uitlijn=1)
  xboard49.json     E-MU Xboard49: knop 1–8 -> instrument, 9–16 -> FX, schuif -> fader van de speeltrack (AANNAME, te controleren met een proef)
  maschine-mk2.json Maschine MK2 (via de hub): groep A–H = focus, draaiknoppen = instrumentknoppen van de speeltrack (relatief, shift fijn), transport van de patronen ({plek}); laag pagina.strip / pagina.rack = de knoppagina's van de focus-track
handen/
  voorstel.json     per actie zonder plek op een controller het voorstel of "bewust geen" (docs/HANDEN.md); de mixer leest het niet
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
  instellingen-server.test.mjs / instellingen-opslag.test.mjs  de browser-sleutels van het instrument (elf, met de bus-racks): route en witte lijst; server eerst, eenmalig omhoog
  feedback.test.mjs LED-diffing en paletproef, bytes worden opgevangen
  feedback-plan.test.mjs  het plan van de LED-laag (byte voor byte de oude berekening, 567 standen) en de wektik
  learn.test.mjs    MIDI-learn, modusherkenning, export/import-rondje
  midi.test.mjs     parsen, poortkeuze op naam, echodetectie
  library.test.mjs  database, effect-racks per link, cascade bij verwijderen, migraties (SCHEMA.length)
  backup.test.mjs   backups: geldige kopie uit de WAL, niet dubbel, opruimen, mislukken, niet via HTTP
  avondpakket.test.mjs  het avondpakket puur: parsers op echte en HANDGEMAAKT-uitvoer (fixtures/avondpakket), fase, oordeel, paklijst, tegel, privacy
  avondpakket-meet.test.mjs  sondes met een nep-exec (time-outs 50 ms), cache en bevriezing, de CLI via spawnSync (nooit een server)
  avondpakket-server.test.mjs  GET /api/avondpakket op een eigen server: compleet, onbekend profiel, bevroren na een Range-verzoek, schrijft niets
  backup-kopie.test.mjs  tools/backup: WAL-rijen in de kopie, manifest, niets weg, --droog, rsync zonder --delete, doel in de bron (ook via symlink), slot, herstel weigert
  library-lijst.test.mjs  virtuele lijst, pagina-cache (ook de race bij een nieuwe sortering), kolommen
  indeling.test.mjs, indeling-server.test.mjs, indeling-ui.test.mjs  S11: model en zoekregel, schema v10 + migratie met data, filter-SQL,
                    volgorde, slim, hernoemen/samenvoegen/wissen, export/import; de routes (403 van buiten, 409, kaartkrat); URL, race bij een nieuw filter, bus
  past-bij.test.mjs  "past bij": goed/bijna per paar, toon na de sync, half tempo, volgorde, meetpunt (t, eind, zeker deel)
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
  modulatie.test.mjs, effecten-s10.test.mjs, sjablonen-server.test.mjs, sjablonen-paneel.test.mjs  spoor S10: modulators, rackformaat,
                    muteren; de zeven effecten en hun kernen (0 GC); /api/sjablonen; de bouwsteen sjablonen en de XY-actions (nep-fx.mjs = de mock)
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
                    stemindeling, lampjes, terugspelen, na herladen, de knoppen in index.html, de omgeving van de
                    proefservers van tools/headless/sampler-drums*.mjs), zonder DOM
  bovenbalk.test.mjs  de bovenbalk scrollt opzij als hij niet past (randen, CSS: niet hoger, geen schuifbalk)
  patronen.test.mjs model, venster (swing, micro, omlopen), klok, speler met nep-maatgever (op de maat, herankeren zonder dubbele/gemiste), opnemen, opslag (409), server
  patronen-engine.test.mjs  patronen op de echte engine: actions en reads, een deck als maatgever, instrument weg, log, terugspelen, modus patronen, LED's
  smf.test.mjs      de bytes van een MIDI-bestand (src/lib/smf.js): vlq, meta, tempo, ascii, sporen, lezen (running status, SysEx, kapot = byte-offset)
  patronen-midi.test.mjs  patronen als MIDI-bestand: S1–S13/L1–L2, de kick bytegewijs (met de hand + fixtures), 500 patronen tegen de vensters van de speler, rondreis, de CLI tools/patronen/midi.mjs
  ar-na.test.mjs    tools/proef/ar-na.mjs op synthetisch materiaal: WAV met een gat, log met NUL, het log van de lus, grid vs tellen, droog leest niets, --meet laat de bronnen staan
  ar-meters.test.mjs  tools/beatmeting/ar2.mjs (plan: wat ontbreekt, de stappen) en vloer.mjs (vloerOordeel, meetNummer) zonder model of library
  setboek.test.mjs  het setboek (tools/setboek): hoorbaar (fader, kant, trim, kills, stems, master via faderGain), cue/play/laad/rem/gridcontrole zoals het deck, trackeinde met lengte, positie in de bron (secties), één stuk over de grens van twee logs (ook door een log zonder acties), proefpunten (alleen van deze avond), Buma/Stemra, --vanaf op de klok (ook binnen één log), de CLI
  fixtures/midi/    gouden .mid's (kick met en zonder meta, proef-set): de test vergelijkt ermee, en ze zijn het materiaal voor de Logic-proef
  secties.test.mjs  secties: synthetische nummers met een bekend antwoord, worker, library, deck, actions, server, marges op de "1"
  sec-sampler.test.mjs  een sectie in een sampler-pad: knipSectie, start op de "1", herankeren (ook keylock), grenzen, meldingen
  secties-log.test.mjs  secties in het handelingenlog: kaart in de stand, `van` bij een druk, volgorde, precies terugspelen
  auto-secties.test.mjs  auto-DJ met secties: fragment/planMoment/momentArgs, terugvinden, wachten op de kaart, OVERNEEM, langer/nu, zonder kaart identiek
  sec-maschine.test.mjs  secties en loops: sectieHier na het rondgaan, sectieOpDeMaat in een loop, de melding, de Maschine
  sec-controle.test.mjs  sectieTelling (zelfde regel als moetSecties, cache per rij, ROLLBACK), /api/secties, de tegel
  niveau.test.mjs   het niveau van de beeldzender: pompt op een luide master, volume-onafhankelijk, vlak/stilte/tijd, de ruwe dB in features.js
  beeld.test.mjs    spoor beeld: adres, latentie, id's, kiesKant, de tel met latentie, track/mix/poort, aanwezig en opnieuw, de echte zender op een nep-WebSocket
  beeld-meting.test.mjs  de pure delen van tools/headless/beeld-lokaal.mjs: opties, ps optellen, fps-oordeel, wat --opruimen mag, de CPU-poort (systeem/ander), de proefserver-omgeving, de hartslag-worklet met een nepklok
  beeld-lokaal.test.mjs  tools/beeld-lokaal.sh als kopie in een map met een spatie: --droog, de URL, --installeer (weigert com.google.Chrome), starten met nep-relay en nep-open, --stop
  varve-beeld-zender.test.mjs  de zendertest van de Stroommachine (overgenomen; alles.mjs telt zijn eigen formaat)
  kaart.test.mjs    de kaart op een verzonnen varve-kaart.json (nep-kaart.mjs): laden/herladen, zoeken, filters, sorteren, pagina's, wensen (20, dubbel), score, standaardvolgorde, cookie-bewaker
  nacht.test.mjs    de zes nachtregels één voor één met nepklok, nep-deck en nep-ingest (geen tijd, geen netwerk)
  standen-model.test.mjs, standen.test.mjs, standen-server.test.mjs  standen: formaat, server/standen.js (echte Kaart en Nacht), /api/standen op een eigen server
  stand-tegel.test.mjs, stand-bewerker.test.mjs  de tegel Opstelling en de bewerker (puur)
  kaart-server.test.mjs  kaart en nacht op een eigen server met de nep-yt-dlp: routes, 409 bij een deck (echt Range-verzoek), ingest zonder video, nachtrun, herstart
  companion-lijst.test.mjs, companion-server.test.mjs  de companion: rekenwerk; en tegen eigen servers (Tailscale-Host, wens, kies, haal nu, speeldag)
  regels-companion.test.mjs  de companion volgt zijn hele importboom: geen AudioContext, MIDI, Web Lock; alleen /api
  mixer-melding.test.mjs, status-zender.test.mjs  stap 2 van de companion: de melding, wie mag schrijven, de stand; de POST van de mixer (900 ms, rust, nooit storen)
  uitzend.test.mjs  uitzenden: doelen (lokaal-slot), profielen stil/beeld, nooit overschrijven of in opnames/, ffmpeg sneller dan echte tijd
                    (VARVE_TEST_ECHTETIJD=1: ook in echte tijd, ~2 min; niet tijdens een speelavond)
  nep-kaart.mjs     de verzonnen kaart (twaalf nummers die elke regel raken) — geen test zelf
  media-verhuis.test.mjs  media buiten iCloud: iCloud-herkenning, het briefje, droogloop/--doe op een nepmap, VARVE_TESTSERVER-bewaker
  aanhaakpunten.test.mjs  werkruimte S0: mapjes erbij/weg/volgorde, fragmenten, meta-vlaggen, alleenScherm, Deck.tijdlijn, aanhakers, routes (kopie-server)
  precisie.test.mjs werkruimte S1: duwen (3,81/0,48 ms per tik), samenvoegen, keylock, jog, op de 1 (stukgrens), duoklik, sync-lampje, het stuk uitlijn
  werkruimte-model.test.mjs, werkruimte.test.mjs, werkruimte-server.test.mjs  werkruimte S3: het model (weigeren/waarschuwen, samenstellen =
                    de mapping van vandaag), de runtime (bus-spion, volgt, onthoud, THUIS, terugval, LED-tik), /api/werkruimtes (409, W1)
  paneel-schrijf.test.mjs  werkruimte S8: de schrijfweg (model, Uitvoerder, de bron in het log, PaneelSchrijf met nepklok, een eigen server
                    met nep-mixer nep-mixer.mjs (geen test zelf): 404/401/403, invoke -> read, 429, seq, los binnen 1,5 s), de tegel
  inrichten.test.mjs  werkruimte S8: ✎ inrichten (bewerkingen, toewijzen: het model beslist, de zoeker, de Inrichter, terug met 409 op een eigen server)
  handen.test.mjs   de handenkaart: controls, register, vrije plekken (exact), voorstel/uitzonderingen, puur, de telling, blok hub-f0, VRAGEN HA
  gezondheid.test.mjs  src/ui/gezondheid.js: suspend, resume bij invoer, klok stil, geen alarm vóór de start
  meldingen.test.mjs  de meldingen met een sleutel (één die meegroeit) op een nagebouwd document
  server-poort.test.mjs  AR20: een tweede server op een bezette poort stopt met exit 3 vóór hij .bezig-*, de stems-rij of library.db aanraakt
  herstart.test.mjs AR9: leesLus, de herstartregel en de tegel Server (puur), en /api/leeft van een echte server met de omgeving van de lus
  notatie.test.mjs, server-lus.test.mjs, node-versie.test.mjs  src/lib/notatie.js; de herstartlus met een nep-node (ook de wachter: SIGSTOP); de Node-waarschuwing van alles.mjs
  versie.test.mjs, speellijst-weergave.test.mjs  de tegel Versie op echte git-mappen en /api/versie; de speellijst per deel (één punt, kern, verslag)
  hub-nodig.test.mjs  AR21: VARVE.app start de hub alleen met hub.mixerVia (de regel van mixer openen), een nep-server en de AppleScript-tekst
  alles.mjs         alle tests in één keer met overzicht (een andere Node dan .node-version: waarschuwing boven en onder, niets overgeslagen)
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
  LIBRARY.md        library: pagina's, sorteren, hotcues per nummer, schema v6/v7; S11 kort
  LIBRARY-TAGS.md   categorieën, slimme categorieën en tags (S11): begrippen, filter en zoekregel, bediening, opslag v10, routes
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
  COMPANION.md      iPad en iPhone als eigen deel van de set (/companion): rol per apparaat, grenzen, instellen, testen
  UITZENDEN.md      uitzenden als uitgang (spoor uitzenden, 10 okt): drie routes, grenzen G1–G9, profielen, rechten, metingen, niet getest
  ONTBREEKT.md      wat er nog ontbreekt (2 okt): eigen docs, DJ-software, Logic/TD; voorstel en vragen
  STUDIO.md         VARVE als muziekprogramma (5 okt): hergebruik, vier controllers, fasen S0–S5; §3 de koptelefoon
  INSTRUMENTEN.md   het contract van een instrument (§1–5) en hoe het op een track woont (§6: engine, actions, noten, scherm, APC, metingen)
  MASCHINE.md       Maschine MK2 en Xboard49 via de hub (5 okt): wat elke knop doet, lampjes, schermen, de stapmodus straks, metingen
  MASTER.md         effecten op het geheel en de limiter (S2a, 5 okt): keten, algoritme, laden, opslag, APC, metingen
  EFFECTEN.md       effecten uit de filter app (S2c): per effect herkomst, eenheden, staart, metingen, wat niet
  PATRONEN.md       patronen (S4): het contract (§1–6) en wat gebouwd is (§7: klok, opnemen, API, APC, opslag, metingen; §8 naar Logic als MIDI-bestand)
  BEELD.md          spoor beeld (6 okt): VARVE stuurt de Stroommachine via de relay; instellen, wat er gaat, APC-mapje, problemen, tests
  STANDEN.md        standen (10 okt, pijler 4): één bestand per situatie met beginwaarden, wat er niet in mag, routes, Controlekamer, grenzen
  AVONDPAKKET.md    één controle vóór vertrek en bij aankomst (10 okt): profielen, fase, oordeel, paklijst, ritueel, tegel en CLI
  KAART.md          de muziekkaart in Varve (10 okt): het bestand, de API (+ §3b de afspraken met de UI), de nachtregels, "er speelt een deck",
                    §9 gemeten op het echte bestand, §10 na de proefavond, wat niet getest is
  WERKRUIMTE.md     de werkruimte: het ontwerp (A–E) en "Gebouwd" (S0–S8 samengevat)
  werkruimte/       per spoor van de werkruimte wat het bouwde (S0.md: de aanhaakpunten … S8.md: inrichten, bedienen, totaalmeting)
  BACKUP.md         back-up en herstel van het hele instrument (11 okt): iCloud is geen backup, de WAL-les, set A/B, herstel in acht stappen, launchd
  verslagen/        eindverslagen van de agenten per dag (2026-09-25/README.md = index per spoor)
```
