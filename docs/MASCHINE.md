# Maschine MK2 en Xboard49 in VARVE (via de AV-app-hub)

*5 oktober 2026 · spoor speelapparaten (tak `studio/speelapparaten`). Gebouwd en getest in Node
en in een headless Chromium tegen de echte hub met een nep-Maschine op HID-niveau; nog niet op
Clay's toestellen.*

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

## 2. De Maschine: de speelmodus

Wat elke knop doet. Data in `mappings/maschine-mk2.json` (groepen, draaiknoppen, shift),
de rest in `src/control/maschine.js`. Het profiel (welke knop welk bericht stuurt) staat in
`src/control/devices/maschine-mk2.js`.

| Knop | Doet in VARVE |
|---|---|
| **pads 1–16** | noten 36–51 naar de **speeltrack** (via noten.js, zoals een keyboard), velocity van de hub. De drums liggen er precies op (pad 1 = KICK, linksonder); elk ander instrument speelt ze als C2–D♯3. Loslaten gaat naar waar de aanslag heen ging, ook na een focuswissel. Polyfone aftertouch = `druk(w, noot)` |
| **groep A–H** | focus op track 1–8 (`track.N.focus`) |
| **draaiknop 1–8** | de acht instrumentknoppen van de speeltrack (`track.{speel}.inst.knob.1–8`), relatief: één omwenteling (±1000 tellen van de hub) = de hele knop |
| **SHIFT** + draaiknop | fijn: vijf omwentelingen voor de hele knop |
| **masterwiel** draaien | een ander instrument KIEZEN voor de **focus-track** (geen → Poly → FM → Schaal → Drums, rondlopend): het staat alleen op het scherm, er verandert nog niets |
| **masterwiel** indrukken of **ENTER** | de keuze zetten (`track.N.inst.choose`). Speelt daar een nummer: eerst "druk nog eens" (de bus wil een tweede druk binnen 3 s, zoals overal), de keuze blijft staan. Een keuze vervalt na 8 s of als de focus wisselt |
| PLAY, REC, RESTART, ERASE, STEP, PATTERN, F1–F8, … | nog vrij: voor de stapmodus en de patronen (§5) |

**Waarom het wiel kiest en niet meteen wisselt:** een tik tegen het wiel zou anders je
instrument (met zijn knopstanden) vervangen. Kiezen werkt op de FOCUS-track en niet op de
speeltrack: zo zet je ook een instrument op een lege track (groep C, wiel, indrukken), en
die wordt dan de speeltrack.

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
- **SHIFT**: zacht aan, fel zolang hij vastzit. **ENTER**: fel zolang het wiel een keuze heeft.
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

- Kop links: de speeltrack en zijn instrument (waar pads, keyboard en draaiknoppen heen gaan);
  kop rechts: de keuze van het wiel, of de focus-track als die anders is dan de speeltrack.
- Per knop (vier per scherm, 64 px): de naam, de waarde in echte eenheden (dezelfde `eenheid()`
  als de INSTRUMENT-rij; te lang = zonder spatie vóór de eenheid, "halve tonen" → "ht", dan
  afgekapt op een woord, hooguit 10 tekens) en een balk 0..1.
- Alleen opnieuw als de stand veranderde (en dan alleen het scherm dat anders is), hooguit
  eens per 100 ms per scherm (`SCHERM_MS`). De hub stuurt daarna alleen de stukken die veranderden.

## 5. De stapmodus (nog niet gebouwd: wacht op het patronen-spoor)

Het patronen-spoor (S4, tak `studio/patronen`, `docs/PATRONEN.md`) zat bij het bouwen niet in
`studio/integratie`. Wat de stapmodus straks gebruikt (namen zoals op die tak, 5 okt):

| Maschine | wordt |
|---|---|
| **STEP** (noot 9) | stapmodus aan/uit (lampje fel = aan) |
| **pads 1–16** in de stapmodus | stap 1–16 van de gekozen plek op de speeltrack: `track.{speel}.pattern.step.S` (de laatst gespeelde noot erop, of eraf). Lampje = de read van die action (stap gezet = de kleur van het instrument, de lopende stap fel) |
| **PLAY** | het gekozen patroon op de speeltrack starten/stoppen op de maat (`track.{speel}.pattern.K`; met SHIFT meteen: `.now`) |
| **REC** | live opnemen aan/uit (`patterns.record`); de pads in de speelmodus nemen dan op via noten.js, zoals het keyboard |
| **ERASE** / **RESTART** | `track.{speel}.pattern.clear` / `track.{speel}.pattern.stop` |
| ◄ ► (transport) | stap 17–32, 33–48, 49–64 (patronen tot 64 stappen) |
| scherm | het patroon: 16 vakjes, de lopende stap, lengte en swing |

Waar het in de code komt: `Maschine.ontvang()` (de tak voor de pads: in de stapmodus naar de
bus in plaats van naar noten.js), `Maschine.ledBeeld()` (de padkleuren uit de reads) en
`stand()`/`tekenScherm()`. De knoppen erbij in `mappings/maschine-mk2.json`. De pads in de
speelmodus gaan al via noten.js, dus live opnemen werkt daar vanzelf zodra noten.js opneemt.

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
  veranderde), hub weg en terug, het scherm als pure functie (pixels teruglezen, tekst in zijn
  kolom, elke eenheid van Poly/FM/Drums past), Xboard knop 9–16 en de schuif, en
  `isSpeelapparaat` in de MidiHub.
- `test/hub.test.mjs`: `speelt` in het manifest (geldig volgens de hub), routering per `dev`,
  geen focusfilter, lampjes door de wachtrij en met `dev`, schermen (base64, 2048 bytes, een
  nieuwer beeld vervangt het oudere in de rij), statechange bij weg/terug, en dat de nieuwe
  modules nergens statisch geladen worden.
- `tools/headless/speelapparaten.mjs`: de ECHTE hub (startHub, NepSysteem met nep-APC en
  nep-Xboard, NepHidSysteem met de nep-Maschine uit de hub-tests) en VARVE in Chromium: het
  wiel zet de Poly, een Xboard-noot laat hem klinken (piek −12,6 dBFS op de track), groep B
  zet de focus, het wiel zet de drums, pad 1 slaat de kick aan (−1,9 dBFS), draaiknop +0,2 en
  met SHIFT −0,04, de schuif zet de fader, lampjes en schermen komen als HID-rapporten aan
  (schermen bit voor bit gelijk aan `tekenScherm(stand)`), nooit `requestMIDIAccess`.
  Gemeten (JS-deel, zelfde machine): Xboard-noot ingespoten → noteOn in VARVE 4,4 ms; eerste
  padrapport → noteOn 3,1 ms. Plus de uitgangsbuffer van de AudioContext.
- `tools/headless/hub.mjs`: de conformiteitstoets van de hub slaagt ook met `speelt` (hun MIDI,
  LED's met `dev`, schermen).

## 8. Niet getest: dit vraagt Clay's handen en hardware

- Het echte toestel: oriëntatie van pads en lampjes, of de kleuren op de Maschine lijken op
  de APC (de "donker"-tinten kunnen te zwak of te fel zijn; dan een andere index in `KLEUREN`
  of de hub-instelling `led_max`), of de groepknoppen echt twee zones hebben.
- Hoe de draaiknoppen voelen (één omwenteling voor de hele knop, vijf met SHIFT) en of de
  drempel van de hub (12 tellen) langzaam draaien niet dood maakt.
- Of de schermen leesbaar zijn (5×7, kop 2×), links/rechts goed, en hoe snel ze bijwerken.
- De echte latency toets → geluid (Xboard en pads), en de velocity-curve van de pads.
- De CC's van de Xboard-knoppen en of de schuif echt Master Volume stuurt (§6).
- **Bekend, aan de kant van de hub:** het eerste knoppenrapport na het aansluiten zet daar
  alleen de beginstand van wiel en draaiknoppen. De eerste wielklik (of draai) na het
  insteken telt dus niet; daarna wel.
