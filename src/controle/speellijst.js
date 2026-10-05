/**
 * De speellijst van de Controlekamer: wat Clay bij een proefsessie doet, op
 * volgorde, in blokken. Puur data. De stand (ok/fout/notitie) staat op de
 * server in proef/sessie.json, per `id`; verander een id dus niet zomaar, anders
 * raakt een punt zijn notitie kwijt.
 *
 * Bron (2 okt): de proeflijst in docs/HANDOFF.md, de "Eerst doen" van de
 * blokken van 29 en 30 sep, en de vragen op gevoel uit docs/VRAGEN.md K, L, M.
 * Erbij (2 okt, avond): de vijf kleine punten uit docs/ONTBREEKT.md (A4, A6–A9).
 * Elk punt: `doe` = wat je doet, `let` = waar je op let.
 */
export const SPEELLIJST = [
  { id: 'start', titel: 'Opstarten', minuten: 2, punten: [
    { id: 'start-apc', doe: 'Sluit de APC40 aan (Ableton dicht) en open de mixer met de knop hierboven.',
      let: 'APC hierboven groen, geen melding "verkeerde poort".' },
    { id: 'start-audio', doe: 'Klik in de mixer op "audio starten".', let: 'Audio hierboven: aan.' },
    { id: 'start-scherm', doe: 'Kijk of de mixer op je MacBook-scherm past zonder scrollen.',
      let: 'Alle acht faders helemaal te zien? Is er iets te klein om te lezen?' },
  ] },
  { id: 'draaien', titel: 'Draaien op de APC', minuten: 15, punten: [
    { id: 'dr-laden', doe: 'Laad twee nummers op track 1 en 2 (library: B).', let: 'Grid en toonsoort staan erbij, geen foutmelding.' },
    { id: 'dr-opdemaat', doe: 'Start track 1. Start track 2 met shift + zijn track-knop: op de maat.',
      let: 'Valt track 2 precies op de 1 van de maat?' },
    { id: 'dr-beatjump', doe: 'Bank ◀ ▶ = beatjump; shift + Bank = de lengte (½ of ×2).', let: 'Springt hij in de maat, zonder hapering?' },
    { id: 'dr-loop', doe: 'Pan = loop in, Sends = loop out, User = reloop.', let: 'Loopt de loop zonder tik op de naad?' },
    { id: 'dr-quantize', doe: 'Lock = quantize aan en uit.', let: 'Licht Lock op, vallen cues dan op de tel?' },
    { id: 'dr-rem', doe: 'Stop All Clips = rem.', let: 'Klinkt het als een draaitafel die uitloopt?' },
    { id: 'dr-mix', doe: 'Mix een overgang met faders, EQ, filter en crossfader.', let: 'Reageert alles direct, zonder vertraging?' },
  ] },
  { id: 'klank', titel: 'Modus klank', minuten: 5, punten: [
    { id: 'kl-modus', doe: 'Shift + scene 5: modus klank.', let: 'Scene 5 brandt magenta.' },
    { id: 'kl-kill', doe: 'Rij 1–3 vasthouden = kill hoog, mid, laag. Shift + pad = vast.', let: 'Valt de band echt weg, ook bij zware bas?' },
    { id: 'kl-kleuren', doe: 'Kijk naar de pads: rood = kill, oranje = rem, groen = op de maat, grijs = stil.',
      let: 'Zijn de kleuren op het apparaat uit elkaar te houden?' },
    { id: 'kl-knipper', doe: 'Kijk naar Pan, Sends en User terwijl er een loop loopt.', let: 'Knipperen ze op de tel?' },
  ] },
  { id: 'toon', titel: 'Toonsoort en library', minuten: 5, punten: [
    { id: 'to-pitch', doe: 'Schuif de pitch van een spelend nummer.', let: 'Schuift de toonsoort in de kolomkop mee?' },
    { id: 'to-klopt', doe: 'Vergelijk de toonsoort met wat je hoort.', let: 'Klopt hij muzikaal? Zo niet: bij welk nummer?' },
    { id: 'to-sorteer', doe: 'Library: klik op een kolomkop, en nog eens.', let: 'Sorteert hij, en de tweede keer omgekeerd?' },
    { id: 'to-hotcue', doe: 'Zet een hotcue, laad het nummer op een andere track en herlaad de pagina.', let: 'Komt de hotcue terug?' },
  ] },
  { id: 'ingest', titel: 'Nummers binnenhalen', minuten: 5, punten: [
    { id: 'in-drie', doe: 'Plak drie YouTube-links tegelijk in de ingest-strook, één per regel.',
      let: 'Eén downloadt met een percentage, de rest wacht; alle drie komen binnen.' },
    { id: 'in-dubbel', doe: 'Plak een link die er al is.', let: 'Melding "al binnen", met laadknoppen.' },
    { id: 'in-playlist', doe: 'Plak een playlist-link.', let: 'Geweigerd, met uitleg.' },
  ] },
  { id: 'auto', titel: 'Auto-DJ', minuten: 10, punten: [
    { id: 'au-aan', doe: 'Knop auto in de mixer, aanzetten, laten draaien.', let: 'Valt er ooit stilte?' },
    { id: 'au-overgang', doe: 'Luister naar een overgang (24 s overvloeien).', let: 'Goed zo, of liever 32–48 s? (VRAGEN AU2)' },
    { id: 'au-knoppen', doe: 'Probeer ok, overslaan, langer en nu.',
      let: 'Doen ze wat je verwacht? Komt "nu" bij een nummer zonder beat snel genoeg? (AU3)' },
    { id: 'au-apc', doe: 'Shift + scene 4: modus auto. Bovenste rij: ok, overslaan, langer, nu; pad 8 = aan/uit.',
      let: 'Is limoen te onderscheiden van groen en geel? Licht ok op als er een voorstel klaarstaat?' },
    { id: 'au-glad', doe: 'Luister naar een overgang van de auto-DJ, en grijp midden erin een fader.',
      let: 'Gaat de fade glad (geen trapjes)? Neem je het over zonder sprong?' },
  ] },
  { id: 'plan', titel: 'Planvenster', minuten: 5, punten: [
    { id: 'pl-open', doe: 'Knop plan in de mixer; zet het venster op je tweede scherm.', let: 'Past het venster daar? (PL3)' },
    { id: 'pl-live', doe: 'Zet auto aan vanuit het planvenster.', let: 'Volgt het venster live wat er speelt?' },
    { id: 'pl-mist', doe: 'Loop de lijst met stappen door.', let: 'Mist er iets? Schrijf het in de notitie.' },
  ] },
  { id: 'klankschaal', titel: 'Klankschaal', minuten: 5, punten: [
    { id: 'ks-toon', doe: 'Knop klankschaal; sla een veld aan terwijl er een nummer speelt.', let: 'Klinkt hij in de toon van het nummer?' },
    { id: 'ks-vol', doe: 'Vergelijk het volume van de schaal met de tracks.', let: 'Is VOL 0,8 goed naast je muziek? (KS3)' },
    { id: 'ks-wissel', doe: 'Laat de schaal ringen bij een nummer dat van toonsoort wisselt.',
      let: 'Meteen mee, of liever pas bij de volgende aanslag? (KS2)' },
  ] },
  { id: 'beeld', titel: 'Beamer en vormen', minuten: 10, punten: [
    { id: 'be-los', doe: 'Videopaneel (V) → los venster naar het tweede scherm, dubbelklik voor volledig scherm.',
      let: 'Eerst "beamer loopt in", dan "beamer": niets verspringt of ontbreekt.' },
    { id: 'be-achter', doe: 'Zet in het mixervenster een ander tabblad vooraan.', let: 'Loopt het beeld op de beamer door?' },
    { id: 'be-vormen', doe: 'Vormen aan; Device ◀ ▶ door alle 26 systemen.', let: 'Niets uitgerekt: rond blijft rond, breed blijft breed.' },
    { id: 'be-zwart', doe: 'Master-knop (boven de masterfader) = zwart; nog eens = terug. Ook in het losse venster.',
      let: 'Wordt de beamer echt zwart, met een korte fade? Brandt het lampje?' },
    { id: 'be-nood', doe: 'Modus video (scene 4), rechts: flits, zwart vasthouden, zwart, bevriezen. MASTER in het videopaneel.',
      let: 'Bevriest het beeld terwijl de muziek doorloopt? Is de flits niet te fel?' },
  ] },
  { id: 'koptelefoon', titel: 'Koptelefoon', minuten: 10, punten: [
    { id: 'kp-apparaat', doe: 'Audio-MIDI-configuratie: samengesteld apparaat, eerst de Scarlett, dan de koptelefoonuitgang van de Mac (driftcorrectie aan). Zet het als uitvoer en herlaad de mixer (docs/STUDIO.md §3).',
      let: 'De rij KOPTELEFOON zegt "zaal 1/2 · koptelefoon 3/4". Komt de zaal uit de Scarlett en de koptelefoon uit de Mac?' },
    { id: 'kp-cue', doe: 'Track 1 speelt. Laad track 2, fader 2 dicht, ● (zonder shift) op kolom 2.',
      let: 'Hoor je track 2 in de koptelefoon en niet in de zaal? Brandt ● rood?' },
    { id: 'kp-mix', doe: 'Draai MIX en VOL in de rij; zet ● weer uit.',
      let: 'MIX gaat van cue naar zaal; geen tik bij aan en uit; zonder cue hoor je de zaal.' },
    { id: 'kp-opname', doe: 'Neem 30 s op met een cue aan.', let: 'Staat de cue NIET in de opname?' },
  ] },
  { id: 'rand', titel: 'Kleine dingen', minuten: 5, punten: [
    { id: 'ra-hotcue', doe: 'Laad een nummer met hotcues en druk METEEN hotcue 1.',
      let: 'Springt hij naar de bewaarde hotcue, en is die er na herladen nog?' },
    { id: 'ra-gate', doe: 'Zet een gate aan op een track zonder grid.', let: 'Opent hij zonder tikken?' },
    { id: 'ra-backup', doe: 'Kijk in de Controlekamer naar de tegel Backup.', let: 'Groen, met een tijd van vandaag?' },
  ] },
];

/** Alle punten achter elkaar, met hun blok erbij. */
export const allePunten = () => SPEELLIJST.flatMap((b) => b.punten.map((p) => ({ ...p, blok: b.id })));
