# Maschine MK2 en Xboard49 in VARVE (via de AV-app-hub)

*5 oktober 2026 · spoor speelapparaten (tak `studio/speelapparaten`, op `studio/integratie` met
de patronen). Gebouwd en getest in Node en in een headless Chromium tegen de echte hub met een
nep-Maschine op HID-niveau; nog niet op Clay's toestellen. 6 okt: SCENE = padmodus secties (§5b,
tak `studio/sec-maschine`). 7 okt: knoppagina's Strip en Rack en uitleg met CONTROL (§5c, tak
`studio/maschine-dj`).*

De AV-app-hub opent de **E-MU Xboard49** (MIDI) en de **Maschine MK2** (USB-HID, zonder
NI-software) en geeft ze door aan de lease-app die ze "speelt" (AV-app-hub: PROTOCOL §17,
`docs/MASCHINE.md` daar voor de virtuele MIDI-indeling). VARVE speelt ze **alleen met
`?hub=ws://…`**: zonder de vlag wordt er geen byte van deze code geladen.

---

## 1. Hoe het binnenkomt

| Wat | Van de hub | In VARVE |
|---|---|---|
| manifest | — | `speelt: ["xboard49", "maschine-mk2"]` (`src/control/hub.js`) |
| Xboard49 | `{t:"midi", dev:"xboard49", bytes}` | nep-poort **"Xboard49 (hub)"** → `noten.koppel()` |
| Maschine | `{t:"midi", dev:"maschine-mk2", bytes}` (virtuele MIDI) | nep-poort **"Maschine MK2 (hub)"** → `src/control/maschine.js` |
| lampjes | ← `{t:"led", dev:"maschine-mk2", bytes}` | uitgang van die nep-poort, door de wachtrij (16 per 4 ms), per beeld gebundeld |
| schermen | ← `{t:"scherm", dev:"maschine-mk2", nr, data}` | `scherm(nr, bytes)`: base64 van precies 2048 bytes, door dezelfde wachtrij |

- De nep-poorten (`midi.speelPoort(dev)`) hebben de interface van een MIDIInput
  (`onmidimessage`, `onstatechange`, `state`) maar staan **niet** in de lijst van de MidiHub:
  de APC-mapping, het echofilter en de poortkeuze zien ze nooit.
- **Geen focusfilter**: wie speelt beslist de hub (de app met APC-focus die het apparaat in
  `speelt` heeft, anders de laatst gefocuste). De APC-lease is ongewijzigd (alleen met focus,
  LED's zonder `dev`).
- Valt de hub-verbinding weg: de poorten gaan op `disconnected` met een statechange; noten.js
  laat de noten en het pedaal van die poort los, maschine.js de pads en shift, en bij terugkomen
  tekent maschine.js alle lampjes en beide schermen opnieuw.
- **Een speelapparaat is nooit "de controller"** (`isSpeelapparaat` in `midi.js`, ook zonder
  hub): de MidiHub kiest een Xboard of Maschine niet automatisch, herstelt zo'n bewaarde keuze
  niet en ook met de hand gekozen valt hij terug. Vroeger pakte hij de Xboard als de APC
  ontbrak, en dan werden zijn noten 36–39 grid-pads van de APC-mapping.

## 2. De Maschine: wat elke knop doet

Data in `mappings/maschine-mk2.json` (groepen, draaiknoppen, shift, transport), de rest in
`src/control/maschine.js` (pads, STEP, SCENE, PATTERN, ◄ ►, het wiel, lampjes, schermen). Het profiel (welke knop welk bericht stuurt) staat in
`src/control/devices/maschine-mk2.js`.

| Knop | Doet in VARVE |
|---|---|
| **pads 1–16** | noten 36–51 naar de **speeltrack** (via noten.js, zoals een keyboard), velocity van de hub. De drums liggen er precies op (pad 1 = KICK, linksonder); elk ander instrument speelt ze als C2–D♯3. Loslaten gaat naar waar de aanslag heen ging, ook na een focuswissel. Polyfone aftertouch = `druk(w, noot)` |
| **groep A–H** | focus op track 1–8 (`track.N.focus`) |
| **draaiknop 1–8** | de acht instrumentknoppen van de speeltrack (`track.{speel}.inst.knob.1–8`), relatief: één omwenteling (±1000 tellen van de hub) = de hele knop |
| **SHIFT** + draaiknop | fijn: vijf omwentelingen voor de hele knop |
| **masterwiel** draaien | een ander instrument KIEZEN voor de **focus-track** (geen → Poly → FM → Schaal → Drums, rondlopend): het staat alleen op het scherm, er verandert nog niets |
| **masterwiel** indrukken of **ENTER** | de keuze zetten (`track.N.inst.choose`). Speelt daar een nummer: eerst "druk nog eens" (de bus wil een tweede druk binnen 3 s, zoals overal), de keuze blijft staan. Een keuze vervalt na 8 s of als de focus wisselt |
| **STEP** | stapmodus aan/uit (§5); lampje fel = aan |
| **SCENE** | padmodus secties aan/uit (§5b): pad K = sectie K van de **focus-track**, valt in op de volgende "1"; lampje zacht = de focus-track heeft secties, fel = aan |
| **PATTERN** vast + pad 1–5 | patroon (plek) 1–5 kiezen op de speeltrack; de pads tonen zolang de vijf plekken |
| **PLAY** | het gekozen patroon op de speeltrack starten op de maat, of stoppen als het speelt (`track.{speel}.pattern.{plek}`); **SHIFT + PLAY** meteen (`.now`) |
| **RESTART** | het patroon op de speeltrack stoppen op de maat (`track.{speel}.pattern.stop`; de MK2 heeft geen STOP-knop); **SHIFT** = meteen |
| **REC** | live opnemen aan/uit (`patterns.record`): wat je op de pads (of het keyboard) speelt komt in het patroon dat speelt |
| **ERASE** | het gekozen patroon leegmaken (`track.{speel}.pattern.clear`, tweede druk binnen 3 s) |
| **◄ ►** (transport) | in de stapmodus: de bladzijde (stap 1–16, 17–32, …); in de modus secties: de bladzijde van de secties (1–16, 17–32, 33–40); **SHIFT + ◄ ►** = korter/langer (`.pattern.length.down/up`) |
| **◄ ►** (links boven) | de knoppagina: **Instrument** (zoals hierboven) · **Strip** · **Rack** van de focus-track (§5c); niet rondlopend, het lampje zegt of het kan |
| **CONTROL** vasthouden | uitleg: wat je dan aanraakt gebeurt niet, het scherm zegt wat het hier doet (§5c) |
| F1–F8, GRID, NOTE REPEAT, BROWSE, … | vrij (ontwerp voor de DJ-kant: de Maschine-kaart, `~/Projects/maschine-lab/kaart/`) |

**Waarom het wiel kiest en niet meteen wisselt:** een tik tegen het wiel zou anders je
instrument (met zijn knopstanden) vervangen. Kiezen werkt op de FOCUS-track en niet op de
speeltrack: zo zet je ook een instrument op een lege track (groep C, wiel, indrukken), en
die wordt dan de speeltrack.

Alles van de patronen gaat over de bus (in het handelingenlog), op de **gekozen plek van de
speeltrack** (`{plek}` in de mapping = `engine.patronen.gekozen(speeltrack)`). Alleen kiezen
(PATTERN + pad) roept `engine.patronen.kies` aan: daar is geen action voor.

**Waar de speeltrack is:** de focus-track als die een instrument heeft, anders de laatste
focus-track met een instrument (`engine.speeltrack()`). Pads, Xboard en draaiknoppen spelen
daar; zonder instrument ergens doen ze niets (en VARVE meldt het één keer).

## 3. De lampjes

Kleuren uit het APC-palet (`devices/apc40mk2.js`): een pad heeft op beide controllers dezelfde
kleur. Gedimd = de "donker"-tint (index + 1, #59xxxx), zoals op de APC.

| Instrument | kleur |
|---|---|
| Poly | violet (49 / gedimd 50) |
| FM | cyaan (37 / 38) |
| Schaal | geel (13 / 14) |
| Drums | oranje (9 / 10) |

- **Pads**: de kleur van het instrument op de speeltrack, gedimd; **fel** bij een aanslag en
  zolang hij vastgehouden wordt, minstens 150 ms (een drumslag duurt op de pad maar ~15 ms).
  Ook een Xboard-noot op 36–51 laat zijn pad oplichten. Lege drumpads (9–16 zonder stuk):
  donkergrijs. Geen instrument ergens: uit.
- **Groep A–H**: track met een instrument = zijn kleur (vol als het de focus is, anders
  gedimd); met een nummer = wit gedimd (grijs; de focus wit); leeg = uit (de focus donkergrijs).
- **Stapmodus**: elke pad = de read van zijn stap: de laatst gespeelde noot staat erop = de
  volle kleur, een andere noot = gedimd, leeg = donkergrijs, voorbij de lengte = uit; de stap
  die je nu HOORT (`stapNu`, alleen als het gekozen patroon speelt) wit.
- **PATTERN vast**: pad 1–5 = de plekken (speelt = vol, gevuld = gedimd, leeg = donkergrijs),
  de gekozen wit; 6–16 uit.
- **Modus secties**: dezelfde kleuren als de grid-modus secties van de APC (de read van
  `track.N.section.K`): wit = die hoor je (of drukt je in), donker hemelsblauw (42) = er is een
  sectie, uit = geen sectie op die pad. Geen knipperen op de tel (de Maschine kent dat niet) en
  geen groepskleuren (VRAGEN SE4).
- **SHIFT**: zacht aan, fel zolang hij vastzit. **ENTER**: fel zolang het wiel een keuze heeft.
- **STEP**, **PATTERN**: zacht aan, fel als ze aan/vast zijn. **SCENE**: zacht als de focus-track
  secties heeft, fel in de modus secties, anders uit. **PLAY**/**RESTART**/**ERASE**:
  hun read als helderheid (speelt = fel, gevuld/iets te stoppen = half, knippert vanzelf als het
  op de maat wacht). **REC** fel tijdens opnemen. **◄ ►** half als er een bladzijde die kant op
  is (stappen, of secties). Zonder instrument op de speeltrack zijn de patroonknoppen uit.
- Alleen wat verandert gaat weg (~30× per seconde gekeken, `TIK_MS` 33 in
  `ui/speelapparaten.js`), door de wachtrij van hub.js.

## 4. De schermen

`src/control/maschine-scherm.js`: een pure functie `tekenScherm(stand, nr) → Uint8Array(2048)`
(256 × 64, 1 bit, rij voor rij, hoogste bit links), met een eigen 5×7-lettertype (ASCII plus ±;
é → e, − → -, × → x, anders ?).

```
 links (nr 0)                                     rechts (nr 1)
 T2 Drums                     (groot)             focus T3: leeg   /  T3 > FM?   /  knop 5-8
 ─────────────────────────────────────            ─────────────────────────────────────
 TOON    │DECAY   │FILTER  │DRIVE                 KICK    │SNARE   │HATS    │NIVEAU
 +2ht    │vol     │open    │uit                   48 Hz   │snaar 50│open 550│0 dB
 [███  ] │[█████] │[█████] │[     ]               [███  ] │[███  ] │[███  ] │[████ ]
 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈          ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
 pads + keyboard spelen hier / SHIFT: …           wiel = instrument kiezen / druk op het wiel = zetten
```

- **Stapmodus** (links, in plaats van knop 1–4): kop `T2 Drums P1`, een regel met stap
  van–tot/lengte, de noot die erop komt, speelt/wacht/stil en REC, dan 16 vakjes (rand = leeg,
  blokje = een andere noot, vol = de laatst gespeelde noot, niets = voorbij de lengte) met een
  streep onder de stap die je hoort. **PATTERN vast**: de vijf plekken als grote vakken (dikke
  rand = gevuld, `>` = speelt), de gekozen onderstreept. Rechts blijft knop 5–8.
- **Modus secties** (links, in plaats van knop 1–4): kop groot = de focus-track en de sectie die
  je HOORT (`T1 4 drop D`; zonder secties `T1 nog geen secties`, `T3 leeg`, `T2 Drums: geen
  nummer`). Daaronder de namen van de 16 pads ZOALS ZE LIGGEN (pad 1 linksonder, 13–16
  bovenaan; een kolom van 64 px per pad): die je hoort of indrukt omgekeerd (wit vlak, zwarte
  letters), een pad zonder sectie leeg. Onderaan wat er op de volgende "1" komt (`op de 1: 4 drop
  D`: in de aanloop van een sprong, of in de laatste maat vóór de volgende sectie; in een loop wat
  er na het rondgaan komt), anders de uitleg en de bladzijde. Rechts blijft knop 5–8 van de speeltrack.

```
 T1 4 drop D                                   (groot: de sectie die je hoort)
 ─────────────────────────────────────
                                               pad 13–16 (leeg: 7 secties)
                                               pad 9–12
 E        drop D    outro F                    pad 5–8
 intro A  B         opbouw C  [drop D]         pad 1–4 ([…] = omgekeerd: die hoor je)
 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
 pad = sectie, valt in op de 1   /   op de 1: 6 drop D   /   pad = sectie op de 1, < > blad 1/3
```
- Kop links: de speeltrack en zijn instrument (waar pads, keyboard en draaiknoppen heen gaan);
  kop rechts: de keuze van het wiel, of de focus-track als die anders is dan de speeltrack.
- Per knop (vier per scherm, 64 px): de naam, de waarde in echte eenheden (dezelfde `eenheid()`
  als de INSTRUMENT-rij; te lang = zonder spatie vóór de eenheid, "halve tonen" → "ht", dan
  afgekapt op een woord, hooguit 10 tekens) en een balk 0..1.
- Alleen opnieuw als de stand veranderde (en dan alleen het scherm dat anders is), hooguit
  eens per 100 ms per scherm (`SCHERM_MS`). De hub stuurt daarna alleen de stukken die veranderden.

## 5. De stapmodus en de patronen (gebouwd 5 okt, op het patronen-spoor)

Op `engine.patronen` (docs/PATRONEN.md §7), na het samenvoegen van `studio/integratie` met de
patronen. Werkwijze op de Maschine:

1. Speel de noot die je wilt (een pad, of het keyboard): dat is "de laatst gespeelde noot" van
   de speeltrack (`engine.patronen.laatsteNoot`).
2. **STEP**: de pads zijn nu stap 1–16 van het gekozen patroon. Een pad zet die noot op zijn stap
   (of haalt hem eraf): `track.{speel}.pattern.step.S` over de bus. Langer dan 16 stappen:
   SHIFT + ► (per 16, tot 64), en ◄ ► bladeren.
3. **PLAY** start het op de maat (zonder maatgever meteen, op het eigen tempo), en de lopende stap
   licht wit op. Nog eens PLAY (of RESTART) = stoppen op de maat.
4. **REC** + spelen in de speelmodus (STEP uit): wat je speelt komt erbij, op de dichtstbijzijnde
   stap van wat je hoorde (overdub; noten.js → `engine.patronen.noot`, zoals het keyboard).
5. **PATTERN** vast + pad 1–5: een andere plek kiezen; PLAY start die (wisselen op de maat).

Wisselt de modus terwijl een pad vastzit, dan gaat zijn loslaten naar waar het indrukken heen
ging (noten.js of de stap-action): er blijft nooit een noot hangen.

## 5b. De padmodus secties (SCENE, gebouwd 6 okt, spoor `studio/sec-maschine`)

Het nummer in secties (docs/SECTIES.md) op de pads, zoals de grid-modus secties van de APC,
maar met 16 pads:

1. **Groep A–H** kiest de track (de focus). De secties horen bij een NUMMER; de speeltrack heeft
   altijd een instrument, daarom de **focus-track** (net als de APC).
2. **SCENE**: de pads zijn de secties van die track op volgorde, pad 1 = sectie 1 (linksonder),
   pad 16 = sectie 16. Meer dan 16 secties: **◄ ►** bladeren (1–16, 17–32, 33–40). Een andere
   focus-track (of SCENE na een focuswissel) begint op de bladzijde met de sectie die je daar
   HOORT, anders op blad 1; terug naar dezelfde track in dezelfde modus houdt je bladzijde.
   Hoor je een sectie boven de 40 (een kaart met de hand mag tot 64), dan staat hij op geen pad,
   maar de kop noemt hem wel ("T8 43 A").
3. **Een pad** = `track.N.section.K` over de bus, precies wat de APC doet: speelt het nummer, dan
   valt de sectie in op de volgende "1" (de aanloop uit het nummer zelf, SECTIES.md §3);
   stilstaand staat de speelkop meteen op haar begin. Omdat het over de bus gaat, komt het in het
   handelingenlog (en speelt het terug) en ziet de auto-DJ het (OVERNEEM, na het spoor auto).
4. Een pad zonder sectie, of een track zonder secties: de bus zegt waarom niet (melding in VARVE:
   "track 1 heeft 7 secties; sectie 21 is er niet", met het nummer van de SECTIE, dus blad 2 pad 5
   = 21), zoals op de APC; er springt niets. De auto-DJ telt zo'n druk niet als overnemen.
   Speelt een sectie als loop, dan flitst na het rondgaan niet meer de sectie ervóór op (lampjes
   en scherm): `deck.sectieHier` vouwt wat je hoort terug in de loop (de uitgangsvertraging).
5. **SCENE** nog eens = weer spelen; **STEP** = de stapmodus (één padmodus tegelijk). **PATTERN**
   vast + pad kiest ook hier een patroon. Een pad die vastzit tijdens een wissel (modus, focus, de
   hub weg) laat los waar hij indrukte.

Niet gebouwd (VRAGEN SVM): SHIFT + pad = sectie als loop (de APC doet dat wel), groepskleuren
(SE4), en een bladzijde die vanzelf meeloopt met wat je hoort.

## 5c. Knoppagina's en uitleg (gebouwd 7 okt, tak `studio/maschine-dj`)

De DJ-kant begint bij de draaiknoppen: met **◄ ►** links boven wissel je van pagina, en het
scherm zegt boven elke knop wat hij doet. Wat een knop doet blijft DATA: de pagina is voor de
mapping een open "mapje" (`lagen: () => ['pagina.<naam>']` in maschine.js), en de regels staan in
`mappings/maschine-mk2.json` met `"laag": "pagina.strip"` of `"pagina.rack"` (64 regels).

| Pagina | Knop 1–8 | Op het scherm |
|---|---|---|
| **Instrument** (standaard) | de acht knoppen van de **speeltrack**, zoals in §2 (regels zonder laag) | zoals in §4 |
| **Strip** | `track.{focus}.trim · high · mid · low · send.a · send.b · fx.mix · filter` | links groot `T3 Strip`, rechts klein de titel en `124,0 BPM  8A Am  -3:12` van de focus-track; per knop de waarde in echte eenheden (`0 dB`, `kill`, `+8,0 dB` uit `eqDb`; `LP 4,4 kHz`/`HP 350 Hz`/`open` uit `filterDoelen`; trim = 2 × knop; sends en mix in %) |
| **Rack** | `track.{focus}.fx.knob.1–8` | de naam van het rack in de kop, per plek de naam die het rack zelf geeft (`fx.plekNaam`), een plek die niet bestaat: alleen het nummer |

- Relatief zoals de instrumentknoppen: één omwenteling (±1000 tellen) = de hele knop, met
  **SHIFT** vijf omwentelingen. Geen overpakken: de knop telt op bij wat de track nu heeft.
- Strip werkt op de **focus-track** (groep A–H), niet op de speeltrack: een nummer heeft geen
  instrument. Op de APC zit de strip op de device knobs met fx 1 op knop 8; hier staat het
  filter op 8, omdat de Maschine geen trackknop heeft.
- EQ, trim en het filter tekenen een balk **vanuit het midden** (0,5 = niets), de rest van
  links. De knop die je net draaide staat een seconde omgekeerd (`GEDRAAID_MS`).
- Lampjes: ◄ ► half als er die kant op een pagina is, anders uit.

**Uitleg (CONTROL vasthouden):** wat je dan aanraakt (knop, draaiknop, pad, het wiel) wordt NIET
uitgevoerd; links staat `UITLEG`, wat je aanraakte en wat het hier doet (te lange tekst loopt door
op het rechterscherm), rechts de vaste knoppen. Teksten: voor wat in de mapping staat `beschrijf()`
uit `ui/apc-beschrijf.js` (dezelfde als op de APC-kaart; speelapparaten.js geeft hem mee), met
SHIFT erbij als die iets anders doet; eigen teksten voor wat maschine.js zelf doet (pads per
padmodus, STEP, SCENE, PATTERN, ◄ ►, het wiel) en voor de knoppen van Strip en Rack. Wat iets
doet knippert (`KNIPPER_MS`), de groepen houden hun kleur. Het loslaten van wat je tijdens de
uitleg indrukte gaat nergens heen; wat al vóór CONTROL in zat, laat gewoon los (geen hangende noot).

Nog niet gebouwd (de Maschine-kaart, VRAGEN volgt): F1–F8 per pagina, de pagina's Echo en galm,
Tempo en loop, Stems en Klankschaal, de DJ-padmodi (cues en loops, sampler, kill en stems,
effecten met druk), bladeren in de library met het wiel, NOTE REPEAT.

## 6. De Xboard49

Via de hub precies zoals een rechtstreeks aangesloten keyboard (`src/control/noten.js`):
noten (velocity), pitchbend (±2 halve tonen), kanaal- en polyfone aftertouch, modwiel (CC 1),
sustain (CC 64), paniek (CC 120/123) naar de speeltrack. De knoppen en de schuif via
`mappings/xboard49.json`, alles absoluut met soft-takeover (eerst oppakken):

| Xboard | VARVE |
|---|---|
| knop 1–8 (CC 21–28) | `track.{speel}.inst.knob.1–8`: het instrument |
| knop 9–16 (CC 31–38) | `track.{speel}.fx.knob.1–8`: de acht FX-knoppen van de speeltrack |
| de schuif (SysEx Master Volume `F0 7F <dev> 04 01 ll mm F7`, 14 bit) | `track.{speel}.fader`: het volume van de speeltrack (signature `master-volume`) |

**AANNAME**: de CC-nummers komen uit Ardour's xboard-map, de handleiding noemt ze niet; de
proef "speelapparaten" van de hub meet ze. Dezelfde mapping geldt voor een Xboard die zonder
hub via Web MIDI binnenkomt (noten.js hoort beide).

## 7. Getest en gemeten

- `test/maschine.test.mjs` (Node, nep-engine, de echte Noten en Mapping): profiel, indeling,
  pads → noten, groepen, draaiknoppen en SHIFT, het wiel (kiezen, zetten, verlopen, focus
  weg, "druk nog eens"), lampjes (kleuren, flits, diff), schermen (tempo, alleen wat
  veranderde), hub weg en terug, de stapmodus met een nep-patroonspeler (stappen over de bus,
  lampjes uit de reads, bladeren, lengte, loslaten na een moduswissel, PATTERN + pad, het
  transport, het scherm), de modus secties met nep-decks en de echte `SectieKaart` (SCENE,
  pads = de reads, `track.N.section.K` indrukken en los, de focus, bladeren tot 20 secties, een
  track zonder secties, wisselen en de hub weg met een pad vast, het scherm pixel voor pixel), het scherm als pure functie (pixels teruglezen, tekst in zijn
  kolom, elke eenheid van Poly/FM/Drums past), Xboard knop 9–16 en de schuif, en
  `isSpeelapparaat` in de MidiHub.
- `test/hub.test.mjs`: `speelt` in het manifest (geldig volgens de hub), routering per `dev`,
  geen focusfilter, lampjes door de wachtrij en met `dev`, schermen (base64, 2048 bytes, een
  nieuwer beeld vervangt het oudere in de rij), statechange bij weg/terug, en dat de nieuwe
  modules nergens statisch geladen worden.
- `tools/headless/speelapparaten.mjs`: de ECHTE hub (startHub, NepSysteem met nep-APC en
  nep-Xboard, NepHidSysteem met de nep-Maschine uit de hub-tests) en VARVE in Chromium: het
  wiel zet de Poly, een Xboard-noot laat hem klinken (piek −12 dBFS op de track), groep B
  zet de focus, het wiel zet de drums, pad 1 slaat de kick aan (−1,9 dBFS), draaiknop +0,2 en
  met SHIFT −0,04, de schuif zet de fader, lampjes en schermen komen als HID-rapporten aan
  (schermen bit voor bit gelijk aan `tekenScherm(stand)`), nooit `requestMIDIAccess`. En op
  de echte patroonspeler: STEP + pad 1, 5, 9, 13 zet de kick op stap 1, 5, 9, 13; PLAY speelt
  het (4 noten in 1,5 s op 120 bpm, de lopende stap wit op de pads); REC + pad 2 neemt de
  clap op in het lopende patroon; PATTERN + pad 2 kiest plek 2; RESTART stopt op de maat.
  Gemeten (JS-deel, zelfde machine, vier runs): Xboard-noot ingespoten → noteOn in VARVE
  3,5–4,4 ms; eerste padrapport → noteOn 2,6–3,1 ms (de hub wacht twee frames op een slag).
  Plus de uitgangsbuffer van de AudioContext.
- `tools/headless/hub.mjs`: de conformiteitstoets van de hub slaagt ook met `speelt` (hun MIDI,
  LED's met `dev`, schermen).
- `test/sec-maschine.test.mjs` (review 7 okt): `deck.sectieHier` vlak na het rondgaan van een
  sectie-loop (geen flits van de sectie ervóór, ook de reads van de lampjes niet; zonder loop
  niets teruggevouwen) en de melding "sectie 21 is er niet". De auto-DJ: een pad zonder sectie is
  geen overname (`test/auto-secties.test.mjs`, 4f).
- `tools/headless/sec-maschine.mjs` (6 okt): de echte hub (poort 7715) met de nep-Maschine en
  VARVE op een eigen server met het synthetische nummer (7 secties, 124 bpm) via de ingest:
  zonder `?hub=` niets geladen; SCENE fel (HID 0x82), pads als HID 0x80 (wit / donker
  hemelsblauw / uit); pad 2 stilstaand = het begin van sectie 2; pad 4 midden in een maat =
  `track.1.section.4` over de bus en de sprong op de maat (fasebehoudend, sectie 4 valt in op de
  "1"); het linkerscherm bit voor bit `tekenScherm`: in de aanloop "op de 1: 4 drop D", daarna
  "T1 4 drop D"; pad 16 zonder sectie = de melding van de bus; nooit `requestMIDIAccess`.

## 8. Niet getest: dit vraagt Clay's handen en hardware

- Het echte toestel: oriëntatie van pads en lampjes, of de kleuren op de Maschine lijken op
  de APC (de "donker"-tinten kunnen te zwak of te fel zijn; dan een andere index in `KLEUREN`
  of de hub-instelling `led_max`), of de groepknoppen echt twee zones hebben.
- Of de stapmodus prettig werkt: de pads als stappen, wit voor de lopende stap (te druk of
  te zwak?), PATTERN vasthouden om te kiezen, RESTART als stopknop.
- Hoe de draaiknoppen voelen (één omwenteling voor de hele knop, vijf met SHIFT) en of de
  drempel van de hub (12 tellen) langzaam draaien niet dood maakt.
- Of de schermen leesbaar zijn (5×7, kop 2×), links/rechts goed, en hoe snel ze bijwerken.
- De modus secties op het echte toestel: of de pads goed liggen (pad 1 linksonder = sectie 1),
  of het donker hemelsblauw op de Maschine te zien is, en of de namen in het raster leesbaar zijn.
- De echte latency toets → geluid (Xboard en pads), en de velocity-curve van de pads.
- De knoppagina's (§5c): of ◄ ► links boven logisch voelt, of een omwenteling voor de hele EQ
  goed draait (of te grof bij 0 dB), of de balk vanuit het midden leesbaar is, en of CONTROL als
  uitlegknop werkt zonder per ongeluk iets te laten liggen.
- De CC's van de Xboard-knoppen en of de schuif echt Master Volume stuurt (§6).
- **Bekend, aan de kant van de hub:** het eerste knoppenrapport na het aansluiten zet daar
  alleen de beginstand van wiel en draaiknoppen. De eerste wielklik (of draai) na het
  insteken telt dus niet; daarna wel.
