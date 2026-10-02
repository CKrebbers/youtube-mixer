# Een synth om te spelen en te programmeren: onderzoek en voorstel

2 oktober 2026 · gevraagd door Clay · onderzoek met vijf agenten, synthese door Claude.
Ruwe rapporten met alle bronnen: `docs/synth/bronnen/1-invoer.md` … `5-webtechniek.md`.

> "we gaan een web synth maken die je kunt spelen en programeren met je keyboard en
> muis of touch pad. het is bedoelt om ambient sound design te maken en kan worden
> gebruikt als meditatie tool. … denk eraan dit is allemaal uit liefde"

Dit document is onderzoek plus een voorstel. Er is nog niets gebouwd.

## 0. In het kort

1. **Je hebt dit al half gemaakt, vier keer.**
   - MediSynth (2 sep) heeft de belofte: "wat je ook doet, het blijft kalm".
   - De Waterschaal (28 sep) heeft het lichaam: een schaal om te wrijven en aan te slaan, met adem, sessies en een dagboek.
   - AV-kern (23 sep) heeft het idee van scènes en macro's.
   - Varve heeft de discipline: de audioklok en een audiopad dat geen afval maakt.

   Het nieuwe in deze vraag zit in drie woorden: **programmeren**, **sound design**, **laptop**. Al het andere bestaat al.
2. **De spanning.** MediSynth sloot programmeren bewust uit (invariant I7: "geen knoppen, geen getallen, geen patchbay"). Nu vraag je erom. Dat valt te verzoenen: **programmeren wordt een tweede manier van spelen, en niet een editor ernaast.** De muziek stopt nooit. Elke wijziging glijdt in seconden. Alles is met één toets terug te zetten.
3. **Het model voor de laptop is Laurie Spiegels Music Mouse (1986).** De muis speelt de lijn. Het toetsenbord zet de regels: toonladder, stemvoering, articulatie. Spelen en programmeren gebeuren tegelijk, met twee handen, zonder van modus te wisselen. Spiegel: *"I automate whatever can be automated to be freer to focus on those aspects of music that can't be automated."*
4. **Programmeren betekent regels per stem, niet noten.** Het gaat om hooguit zes stemmen, elk van een eigen soort (zoals in Eno's Koan) en elk met één regel in Elektron-stijl (`70%`, `1:4`, "alleen als stem 2 speelde"). Daarbij:
   - per stem één knop **herhaal ↔ verander** (déjà vu bij Marbles, de Turing Machine);
   - snapshot A/B met een morph;
   - "tijdelijk bewaren en terug" zoals Elektron's temp save.

   Patchen en live coding passen niet: ze nodigen uit tot eindeloos ontwerpen, het risico dat je zelf benoemde.
5. **De klank.** Hergebruik de schaal, de FDN-galm met freeze en de bewaking (guard) die er al liggen. Bouw er in deze volgorde bij:
   1. ensemble en tape;
   2. een granulair geheugen van wat je speelt;
   3. een resonator op ruis (wind, zee, adem op de toon);
   4. shimmer;
   5. spectrale freeze, als laatste.

   Het hele palet past gemeten onder 15% van één kern, in plain JS.
6. **Meditatie, eerlijk.**
   - Langzaam ademen heeft het beste bewijs. Een vaste 6 per minuut werkt even goed als een persoonlijk gemeten tempo (RCT 2026).
   - Het bewijs voor klankschalen is zwak.
   - Een geluid dat je zelf maakt, laat je minder schrikken dan een onverwacht geluid.
   - Beloof geen gezondheid.
7. **Mijn advies voor de eerste stap.** Bouw verder in de **MediSynth-repo**, niet in een vijfde nieuwe. Maak één kleine plak die je een avond kunt spelen (§6), en houd AV-kern's publicatie van 25 oktober voorrang.

---

## 1. Wat er al ligt: de eerdere gesprekken

| Project | Datum | Wat het vond | Wat het mist voor deze vraag |
|---|---|---|---|
| **MediSynth** (`CKrebbers/medisynth`) | 2 sep | Onderzoek met bewijsgraden, negen testbare invarianten (I1 altijd consonant, I2 nooit abrupt, I3 nooit stil, I4 geen grid…). Lagen: Ground, Weather, Touch, Voices, Room, Guard, Mood. **Weather en Touch maken dezelfde gebeurtenissen**, daardoor kun je niet fout spelen. v0 "One Room" (stemming Glass) draait, met 45 tests. | Programmeren en sound design sluit het bewust uit (I7, "out of scope: a general synth, patch bay, knobs"). Het toetsenbord is een rechte ladder over 25 toetsen, met `e.key`. |
| **Waterschaal** (`CKrebbers/waterschaal`, `td/waterschaal-lokaal.html` v0.5) | 28 sep | Een modale klankschaal (wrijven met stick-slip, acht velden zoals een handpan, vier soorten plus "Eigen", gemeten uit een opname). Adempatronen (resonant, 4-7-8, vierkant, zucht), resonantietempo uit een hartslagtest, sessies van 5/10/20/vrij met "rond af", dagboek, "Wat nam je waar?", weer en zon/maan boven Arnhem, een stand "zonder scherm", opname als WAV. Plus je stemlijst "Mogelijkheden". | Je kiest uit wat er is, maar je kunt het niet programmeren. Alles staat in één HTML-bestand. |
| **AV-kern** (`CKrebbers/av-kern`) | 23 sep | Meditatie op de APC: scènes met overgangen van 15–30 s, acht macro's (kleur, ruimte, beweging, dichtheid, korrel, helderheid, contrast, adem), een ademklok, een actielog met replay. Gepland: Pad, Korrelwolk, Resonator. Publicatie 1 op 25 okt. | Het is gebouwd voor de APC, niet voor toetsenbord en muis. De Drone is nog Web Audio-oscillatoren. |
| **Klankschaal in Varve** (`src/engine/klankschaal*.js`) | 29 sep | De Waterschaal als pure kern in een AudioWorklet: geen afval per blok, slaapt bij stilte, gemeten 0,08–0,13 ms per blok. Stemming per toonsoort en ladder (Kurd, Celtic, Hijaz…), alles getest. | Het is een instrument naast een DJ-mixer, geen zelfstandige synth. |

**Wat ik daaruit opmaak.** Het patroon dat je zelf noemt in het Totaalplan van AV-kern, "systeemgeneratie zeven: ontwerpen in plaats van spelen", is zichtbaar: vier projecten in een maand, alle vier deels af. Het beste dat dit nieuwe idee kan doen, is die vier **samenbrengen** in plaats van er een vijfde naast te zetten. Het onderzoek hieronder richt zich daarom op wat nog ontbrak, en herhaalt niet wat MediSynth's `docs/RESEARCH.md` al goed onderbouwde. Lees dat er gewoon naast.

---

## 2. Wat het onderzoek vond

Bewijsgraden zoals in MediSynth:
- **[sterk]** gerepliceerd, een meta-analyse of gemeten;
- **[matig]** één goede studie of een gangbare techniek;
- **[praktijk]** vakkennis;
- **[zwak]** klein of omstreden.

### 2.1 De laptop als instrument (`bronnen/1-invoer.md`)

**Music Mouse is het voorbeeld.**
- De x- en de y-as van de muis zijn elk een eigen melodielijn. De software zet er twee stemmen bij, in parallelle of tegenbeweging.
- Met de muisknop ingedrukt verplaats je stil. Zo ga je naar een andere toonhoogte zonder alle tussentonen te spelen.
- Het toetsenbord kiest:
  - de modus (chromatisch, octatonisch, diatonisch, pentatonisch, kwarten…);
  - de voicing (akkoord, arpeggio, lijn, improvisatie);
  - de articulatie en de transpositie.
- [matig–sterk]

Verwant zijn M en Jam Factory (Zicarelli, 1986). Daar stuurt één XY-gebaar een gekozen bundel parameters tegelijk: one-to-many, en dat al in 1986.

**Toetsenbord.**
- **Indeling.** De verspringende QWERTY-rijen zijn in feite een scheef zeshoekig raster. Een *harmonic table* of Tonnetz past daar natuurlijk op: een drieklank is één handvorm. Dat is sterker voor drones en akkoorden dan een pianorij met 13 toetsen. [praktijk]
- **Conventies uit Logic (Musical Typing):** Z/X octaaf, Tab sustain. Spiergeheugen telt. [sterk]
- **Cmd houdt keyup tegen.** Op macOS komt geen keyup voor andere toetsen zolang Cmd ingedrukt is, in elke browser. Daardoor blijven noten hangen. Laat dus alles los bij keyup van Meta, bij `blur` en bij `visibilitychange`. [sterk]
- **Layoutonafhankelijk:** gebruik `event.code`. `getLayoutMap()` bestaat alleen in Chrome en is alleen bruikbaar voor labels op toetsen. Een dode toets meldt `key === 'Dead'`. [sterk]
- **Rollover.** Een MacBook-toetsenbord heeft geen n-key rollover; welke combinaties ghosten is niet gemeten. Ontwerp voor hooguit 3–4 toetsen tegelijk, en laat een drone **aan/uit schakelen** in plaats van vasthouden. [zwak → voorzichtig ontwerpen]

**Touchpad: wat de browser echt geeft (okt 2026).**

| Gebaar | Chrome (macOS) | Safari (macOS) |
|---|---|---|
| Wijzen, slepen, zweven (`buttons === 0`) | ja; tussenpunten via `getCoalescedEvents()` | ja (sinds 18.2) |
| Twee vingers schuiven | `wheel`; inertie herkenbaar via **`WheelEvent.momentum`** (volgens het zoekresultaat Chrome 151, juli 2026; niet zelf geopend) | `wheel`, inertie alleen met een heuristiek |
| Knijpen | `wheel` + `ctrlKey`, kleine deltaY (0,5–3) | `gesturechange.scale` |
| Draaien met twee vingers | nee | `gesturechange.rotation` |
| Druk (Force Touch) | nee (pressure 0 of 0,5) | `webkitForce` |
| Meerdere vingers apart | **nee** | **nee** |
| Eindeloos relatief (Pointer Lock) | ja, ook zonder versnelling | ja, maar met OS-versnelling |

Gevolg: bouw niets dat afhangt van druk of van meerdere vingers. Knijpen is in beide browsers een bruikbare derde as.

De inertie na het loslaten is een gratis, natuurlijk uitdovende curve. Die past bij "laten uitklinken". Dat is een ontwerpidee, niet getest.

**Veel expressie uit één punt.**
- Hunt & Kirk vergeleken mappings experimenteel: one-to-many-mapping werd boeiender en spelers werden er beter mee dan met één-op-één. [matig]
- Uit één punt haal je afgeleide kenmerken: snelheid, versnelling en vooral **hoeksnelheid**. Cirkelen is wrijven, zoals de Waterschaal al doet en zoals PLOrk met het trackpad deed. [matig]
- Fels: een metafoor maakt de mapping doorzichtig. Een schaal wrijven is zo'n metafoor.

### 2.2 Wat "programmeren" kan zijn (`bronnen/2-programmeren.md`)

| Manier | Voorbeeld | Past het? |
|---|---|---|
| Regels per stem | Koan (Eno, *Generative Music 1*): stemtypes Ambient, Rhythmic, Follows, Repeat, Fixed Pattern, plus regels voor toonladder, harmonie, volgende noot en ritme | **Ja, als basis.** Klein, deelbaar, reproduceerbaar. Maar Koan had ~200 parameters en Eno gebruikte er ~150 per stuk: die hoeveelheid is precies de val. |
| Kans en condities | Elektron: `X%`, `A:B` (ronde A van B), `PRE`/`NEI` ("als de vorige of de buurman speelde") | **Ja.** Eén veld per stem is genoeg. `PRE`/`NEI` is Scape's "speel alleen als…" in drie letters. |
| Herhaal ↔ verander | Marbles déjà vu, Turing Machine (één knop: vast, slippend, vrij) | **Ja, het belangrijkste idee van dit hoofdstuk:** "het systeem bijstellen" wordt een speelbare knop. |
| Scènes en morphen | Octatrack: twee scènes op de crossfader, alles ertussen geïnterpoleerd | **Ja.** Programmeren = twee toestanden neerzetten, spelen = ertussen schuiven. |
| Patchen | VCV, Bitwig Grid, Max/Pd | **Nee.** Geen bodem, een verbinding breekt het geluid, en je kijkt als architect. |
| Live coding | Strudel, Tidal, Glicol | **Nee als hoofdweg.** De syntaxis maakt het analytisch. Wel het **gedrag** overnemen: Glicol vervangt alleen wat veranderde, oscillatoren houden hun fase, en bij een fout speelt het oude door (liveness-niveau 4, Tanimoto). |
| Tekenen | UPIC (Xenakis), IanniX (curves met een cursor) | **Ja, voor één ding:** de boog van een sessie over 10–60 minuten. Niet voor noten. |

**Over eindeloos tweaken:**
- Keuzestress is zwakker dan de folklore: een meta-analyse vond een effect van ~0. [sterk]
- Beperkingen werken als een omgekeerde U: een beetje helpt, te veel verstikt. [sterk, review]
- Parallel varianten maken (drie naast elkaar) gaf betere resultaten dan één ding steeds bijvijlen (Dow e.a. 2010). [matig]
- Flow bij improvisatie ging samen met *minder* frontale controle. Een zichtbare editor nodigt uit tot bijsturen. [matig]

Eno over zichzelf (*Discreet Music*): *"I tend towards the roles of the planner and programmer, and then become an audience to the results."* Misschien is het risico niet het ontwerpen zelf, maar **niet stoppen met ontwerpen**. Dan helpt een speelstand waarin de structuur op slot zit meer dan minder functies.

**Makers in getallen:** Eno 7 stemmen, Ciani 4–5 sequenties, Barbieri 4 sporen en één oscillator, Drift 3 modulatieslots. Cycli van 20 seconden tot minuten. Eén primaire handeling tijdens het spelen. Oliveros' EIS: ~40 vertragingslijnen, en de speler stuurt het systeem bij. Dat is de voorloper van een "geheugen" dat je eigen spel terugbrengt.

### 2.3 De klank (`bronnen/3-klank-dsp.md`)

De agent las de broncode zelf (Mutable eurorack, stmlib, PaulStretch, Airwindows) en mat de kosten in Node. Dat was op een Xeon, dus het is een ordegrootte, niet de M1.

**Licenties, gecontroleerd:**
- **MIT** (vrij te porten): Mutable Clouds, Rings, Elements en Plaits; stmlib; Airwindows; Signalsmith.
- **Public domain**: PaulStretch (Python) en khoin's Dattorro-worklet.
- **GPL3, alleen voor ideeën en parameters**: VCV's Mutable-ports, ChowTape en KR-106.
- **Geen broncode**: Beads.
- De naam "Mutable Instruments" mag je niet gebruiken.

**Kosten per bouwsteen (% van één kern, 48 kHz):**

| Bouwsteen | Kosten |
|---|---|
| Granulair, 32 korrels stereo | ~1,5 |
| 64 modale SVF's | 1,3 |
| 8 sympathische snaren | 0,5 |
| Ensemble | 0,3 |
| Ruisbank van 24 banden | 0,4 |
| STFT 4096 | ~1,8 |

Een volledig palet blijft onder 15%. **Het knelpunt is niet de snelheid maar de piek.**
- Een FFT-frame valt in één quantum: bij 16384 punten kost dat 2,4 ms van de 2,67 ms.
- Spectrale effecten moeten hun FFT daarom spreiden over quanta, of in een Worker draaien.

**Wat het toevoegt aan wat er al is:**
- **Ensemble en chorus** naar Plaits: 3 taps rond 4 ms, en twee driefasige LFO's van 0,75 en 6,57 Hz.
- **Tape-wow en flutter** in dezelfde vertragingslijn: wow tot 3,5 Hz, flutter als harmonischen 1, 2 en 3.
- Samen kost dat ~0,3% en maakt het alles wat er al klinkt breder en warmer.
- **Granulair** naar Clouds:
  - korrel 80–500 ms, overlap 4–12, spray, toonhoogte per korrel uit {−12, 0, +7, +12};
  - "texture" is de vensterVORM;
  - freeze = niet meer schrijven.

  Op een buffer van je **eigen spel** is dit Oliveros' EIS in klein, en het antwoord op MediSynth's v2 ("echo-geheugen met steeds meer bewerking").
- **Resonator op invoer** naar Rings: 64 modes, of 8 sympathische snaren op grondtoon, kwint en octaven. Ruis en korrels krijgen zo de toonsoort, en snaren vullen de inharmonische schaal harmonisch aan, met een tanpura-achtig karakter.
- **Ruis als materiaal:**
  - wind: bandpass met een trage OU-"windsnelheid";
  - zee: een golfritme van 0,08–0,15 Hz;
  - adem: bandpass-ruis met een omhullende van een ademhaling, en meteen de ademklok.
- **Shimmer:** +12 halve tonen in de lus van de FDN, met een *gerandomiseerde* pitch shifter (2–4 leeskoppen, korrels van 50–120 ms), een laagdoorlaat van 4–6 kHz en een lusgain ≤ 0,4.
- **Bewaking in feedbacklussen:**
  - `SoftClip` (geklemd op ±3), niet `SoftLimit`: die is onbegrensd.
  - Een hoogdoorlaat in de lus die meestijgt met de feedback, zoals in Clouds.
  - NaN-reset per blok, zoals de panic in Elements.
  - Denormals zelf flushen: Chrome laat ze bewust staan in worklets.

### 2.4 Meditatie, eerlijk (`bronnen/4-meditatie.md`)

**Wat er bewezen is:**
- **Langzaam ademen** verhoogt HRV tijdens de oefening, met een middelgroot effect (Laborde 2022, 223 studies). [sterk]
- **Een vaste 6 per minuut werkt even goed als je persoonlijke resonantietempo** (Sumińska 2026, RCT, n = 88). Dat corrigeert de aanname achter de hartslagtest in de Waterschaal: die test is comfort, geen noodzaak. [matig]
- **Langer uitademen** verhoogt HRV niet betrouwbaar, maar kan prettig zijn. [matig]
- **Cyclic sighing**, 5 minuten per dag, gaf meer positief affect dan mindfulness (Balban 2023). [matig]
- **Vasthoudpauzes** zoals 4-7-8 hebben vrijwel geen bewijs en kunnen angstige mensen benauwen. [zwak]
- **Meeademen met muziek zonder instructie** is inconsistent: bij een kale tel wel, ingebed in muziek niet (Khalfa 2008). Ga er dus niet van uit dat een zwellende pad de adem meeneemt. Zeg het als de gids aan staat. [matig]
- **Geluid of beeld als ademgids:** geen winnaar. Laat het kiezen.

**Zelf spelen of luisteren:**
- Muziekinterventies werken matig: d ≈ 0,4–0,55 (104 RCT's). [sterk]
- "Zelf spelen werkt beter dan luisteren" heeft geen meta-analyse. [zwak]
- Wel robuust: **een geluid dat je zelf maakt, laat je brein minder schrikken** (N1-onderdrukking). Wat jij speelt mag dus directer klinken dan wat het instrument zelf doet. [sterk, als mechanisme]
- Spelen vraagt keuzes, en keuzes trekken naar oordelen. Daarom past het **focused attention**-model goed: één toets voor een aangehouden grondtoon als anker. Een open, vanzelf bewegend klankveld past bij open monitoring. Twee houdingen dus.

**Klankschalen:**
- Goldsby 2017: n = 62, zonder controlegroep. [zwak]
- Stanhope & Weinstein 2020: kon klankschaaltherapie niet aanbevelen.
- RCT 2023: even goed als progressieve spierontspanning, niet beter. [matig/zwak]
- Een schaal is een mooi instrument, geen therapie.

**Nieuwigheid:** een nieuw geluid trekt aandacht (oriëntatiereactie). Variatie moet dus binnen een voorspelbaar kader blijven, langzaam schuivend. Nooit midden in een sessie een abrupt nieuw timbre. [sterk, klassiek]

**Duur:** langer is niet beter (203 studies). 5 minuten is een volwaardige sessie. [sterk]

**Zorg:**
- Gemiddeld 8% van de mensen ervaart nadelige effecten van meditatie (Farias 2020). [sterk]
- Trauma-sensitief betekent:
  - ogen open mag;
  - het **geluid** is het anker, niet de adem;
  - stoppen is altijd zichtbaar en mag.
- Misofonie: wees voorzichtig met ademgeluiden of neuriën als standaard.
- WCAG: hooguit 3 flitsen per seconde.

**Wat we niet beloven:**
- Geen behandeling van angst, slaap, tinnitus of trauma.
- Geen "verhoogt je HRV" of "activeert de nervus vagus".
- Geen 432 Hz of solfeggio (geen bewijs; 432 Hz mag als smaakkeuze bestaan).
- Niet "meditatie is altijd veilig".

Wel verdedigbaar: *"een instrument om rustig te spelen en mee te ademen; veel mensen vinden dat ontspannend."*

### 2.5 De browser (`bronnen/5-webtechniek.md`)

De agent las de broncode van Chromium en WebKit (main, 2 okt) en MDN's compat-data.

- **Chrome noemt alles onder −72 dBFS stilte** (`kSilenceThresholdDBFS`). Na 30 s stilte gebeuren twee dingen:
  - de pagina geldt als "op de achtergrond" en de timers op de hoofdthread worden geknepen;
  - **de wake lock "Playing audio" valt weg, en de Mac kan gaan slapen.**

  Voor een meditatie met lange stiltes is dat belangrijk. Twee maatregelen: houd tijdens een sessie een ruisvloer boven −72 dBFS (een zachte adem- of luchtlaag), en laat de generatieve klok in de worklet lopen. De worklet-thread draait op realtime-prioriteit en wordt niet geknepen. [sterk, broncode]
- **Deksel dicht zonder extern scherm** = slaap = stilte. Daar helpt geen API tegen. [afgeleid]
- **Bediening op het vergrendelscherm:**
  - Safari: met `audioSession.type = 'playback'` komt een AudioContext in aanmerking voor "Now Playing", zonder `<audio>`. [sterk, WebKit main; vanaf welke versie is onzeker]
  - Chrome: een `<audio>`-element is nodig. Het zekerst is een lussende, bijna stille WAV-blob van meer dan 5 s. [afgeleid uit de code]
- **iOS als geïnstalleerde PWA** blijft wankel: stil na terugkeer uit de achtergrond, en een `resume()` die hangt in iOS 26. Mac en Chrome eerst; de iPhone komt later. [matig]
- **`playbackStats`** (Chrome 146+) meet onderbrekingen en de echte latency. Gebruik dat in plaats van te gokken. `renderCapacity` is uit de spec verdwenen.
- **`renderSizeHint`** (Chrome 153) is alleen een hint. Safari heeft het niet. Bouw er niet op.
- **Opslag:**
  - Werelden: localStorage plus de URL-hash.
  - Opnames: OPFS of IndexedDB.
  - WAV-export: een eigen RIFF-kop met `DataView`, geen bibliotheek.
  - Safari wist opslag na 7 dagen zonder bezoek, tenzij de app op het beginscherm staat.
- **Bluetooth (AirPods):** 150–250 ms latency. Zodra de microfoon aangaat, zakt de samplerate. **Vraag nooit de microfoon tijdens een sessie.** [afgeleid]

---

## 3. Mijn idee

Ik heb geprobeerd er zelf een beeld van te vormen, uit de vier eerdere projecten en dit onderzoek samen. Wat volgt is een voorstel en geen besluit. Waar ik iets aanneem, staat dat erbij.

### 3.1 Eén zin

**Een tuin die je speelt: zes stemmen die vanzelf leven. Je hand op het touchpad speelt mee, je andere hand op het toetsenbord verzet langzaam de regels. Programmeren klinkt net zo rustig als spelen, want het is spelen.**

### 3.2 Drie houdingen, één ruimte (geen modi)

| Houding | Wat je doet | Wat er gebeurt | Komt uit |
|---|---|---|---|
| **Laten** | niets | De tuin speelt zichzelf: Weather, incommensurabele cycli, het geheugen brengt terug wat je speelde. Nooit stil. | MediSynth I3/I4 |
| **Spelen** | touchpad (en letters) | De punter speelt lijnen in de toonladder; de software zet er stemmen bij. Cirkelen = wrijven, aanslaan = tik, zweven = een zachte aanwezigheid. | Music Mouse, Waterschaal, Blob Opera |
| **Stemmen** (programmeren) | een cijfer vasthouden + bewegen | Je verzet de regels van die stem terwijl hij klinkt; elke wijziging glijdt. Loslaten = het blijft zo. | Elektron (trig vasthouden + knop = p-lock), Octatrack, Marbles |

Het verschil met MediSynth: daar was "diepte zonder bediening" de regel. Hier is diepte **bereikbaar, maar onder een vinger die je vasthoudt**. Laat je los, dan is het scherm weer leeg en speel je weer. Een editor die je openzet en laat staan bestaat niet. Daarmee blijft I7 ("hooguit drie woorden op het scherm") waar in de rust, en wordt hij alleen opgeschort zolang je met opzet iets vasthoudt.

### 3.3 Een wereld = zes stemmen + regels (de data)

Bouw verder op MediSynth's `Mood`, uitgebreid:

```js
{
  versie: 2,
  naam: 'Water en diepte',
  zin: 'Begin met luisteren naar je adem. Laat de schaal pas zingen als het stil is.', // Oliveros: een wereld mag een tekstpartituur hebben
  grond: { hz: 73.42, ladder: 'kurd', stemming: 'just' },
  stemmen: [   // hooguit 6; elk een SOORT, zoals Koan
    { soort: 'drone',   bron: 'snaren',    regel: '100%',      herhaal: 1.0, zaad: 11 },
    { soort: 'veld',    bron: 'ruis-wind', regel: '1:3',       herhaal: 0.7, zaad: 12 },
    { soort: 'schaal',  bron: 'brons',     regel: '60%',       herhaal: 0.4, zaad: 13 },
    { soort: 'volger',  bron: 'glas',      regel: 'NEI 3',     herhaal: 0.6, zaad: 14 },
    { soort: 'geheugen',bron: 'korrels',   regel: '40%',       herhaal: 0.8, zaad: 15 },
    { soort: 'patroon', bron: 'fm-bel',    regel: '2:5',       herhaal: 0.9, zaad: 16 }
  ],
  macros: { diepte, ruimte, licht, dichtheid, adem, korrel, warmte, afstand }, // 8, zoals AV-kern
  scenes: { A: {…}, B: {…} },   // morph ertussen
  boog: [ /* optioneel: per macro een curve over de sessie (IanniX-lite) */ ]
}
```

- **Soorten** beperken wat je kunt instellen, en dat is precies het punt:
  - drone (houdt aan);
  - veld (textuur);
  - schaal (aanslaan en wrijven);
  - volger (reageert op een andere stem);
  - patroon (vast, met een percentage exactheid);
  - geheugen (speelt jouw spel terug, bewerkt).
- **Regel**: één veld in Elektron-stijl:
  - `60%`: kans;
  - `2:5`: ronde 2 van 5;
  - `NEI 3`: alleen als stem 3 net speelde.

  De cycli van stemmen staan onderling incommensurabel (MediSynth 17 : 23 : 31 : 41 s).
- **Herhaal ↔ verander** per stem: 0 = steeds nieuw, 1 = vast, ertussen slipt hij.
- **Zaad per stem**: "opnieuw dobbelen" verandert één stem en laat de rest staan. Varve doet dit al voor de vormen (`g.r()`).
- Bewaren als JSON in de URL-hash en in localStorage. Persoonlijk, geen platform.

### 3.4 De handen (concreet voorstel, eerst proberen)

**Rechterhand: touchpad.**

| Gebaar | Klank | Uit het onderzoek |
|---|---|---|
| Zweven (geen klik) | De dichtstbijzijnde stem kleurt zacht mee (helderheid, plaats). Bewegen zonder te drukken is al spelen. | Hover als eigen kanaal |
| Klik + slepen | Een lijn in de toonladder. y = toonhoogte (alleen ladderstappen), x = kleur en stereo; de software zet er een tweede stem bij (parallel of tegenbeweging). | Music Mouse, MediSynth Touch |
| Rondjes draaien | Wrijven: hoeksnelheid → energie in een lekkende integrator → de schaal gaat zingen | Waterschaal, PLOrk |
| Twee vingers schuiven | Een trage macro (standaard **diepte**: ruimte + donkerte); de inertie na het loslaten dooft vanzelf uit | `wheel` + momentum |
| Knijpen | **Afstand**: dichtbij (droog, helder) ↔ ver (nat, donker) | Chrome `ctrlKey`, Safari `scale` |

**Linkerhand: toetsenbord** (op `event.code`, dus ook op een andere indeling):

| Toets | Wat | Waarom |
|---|---|---|
| `1`–`6` kort | stem aan/uit (glijdend, 3–8 s) | aan/uit in plaats van vasthouden: geen rollover-zorgen |
| `1`–`6` vast + touchpad | **stemmen**: x/y = de twee belangrijkste regels van die stem (bv. dichtheid en register), schuiven = herhaal ↔ verander | Elektron: trig vasthouden + draaien |
| `1`–`6` vast + `R` | die stem opnieuw dobbelen (nieuw zaad) | zaad per stem |
| letters (3 rijen) | noten in de toonladder als harmonic table: één handvorm = een drieklank; `Z`/`X` octaaf (Logic) | QWERTY = scheef hexraster |
| `Spatie` vast | **anker**: de grondtoon zwelt aan zolang je drukt (focused attention) | meditatie §2.4 |
| `Tab` | morph naar de andere scène (A ↔ B), in 20–30 s | Octatrack, AV-kern-scènes |
| `Enter` / `Backspace` | **tijdelijk bewaren / terug naar bewaard** (glijdend) | Elektron temp save |
| `V` | drie varianten van deze wereld om naast elkaar te beluisteren | parallel prototyping |
| `Esc` | rond af: alles in 30 s naar stilte, één zachte eindbel | AV-kern "Stop all", Waterschaal "rond af" |
| `/` | een command palette voor wat geen toets heeft (wereld kiezen, ademgids, opnemen) | geen knoppenmuur |

**Wat nooit mag:** een Cmd-combinatie die een noot vasthoudt. Alles laat los bij Meta-up, `blur` en `visibilitychange`.

**Aanname:** deze indeling is bedacht, niet bespeeld. Pas haar aan na een eerste avond, op basis van wat je hand doet.

### 3.5 De klank: bouwen op wat er is

| Stap | Wat | Bron in je eigen werk | Nieuw |
|---|---|---|---|
| 0 | Bewaking (NaN, DC, soft clip, limiter, LUFS-meter), FDN met freeze, de schaal | MediSynth `dsp.js`/`reverb.js`; Varve `fx.js` (freeze); Varve `klankschaal-kern.js` (afvalvrij) | – |
| 1 | Ensemble + tape-wow/flutter | – | Plaits-recept, ~150 regels |
| 2 | Geheugen: granulair op de laatste 8–20 s van je eigen spel, met freeze | MediSynth echo-geheugen | Clouds-parameters |
| 3 | Velden: ruis door een resonatorbank op de toonsoort (wind, zee, adem), plus sympathische snaren | Waterschaal "Bedding" en weer | Rings-modaal, Elements-Flow |
| 4 | Shimmer in de FDN | Varve FDN | gerandomiseerde shifter |
| 5 | Spectrale freeze / PaulStretch | – | FFT gespreid over quanta of in een Worker; als laatste |

**Regels die meegaan** (uit Varve, en bewezen in AUDIOPAD.md):
- De positie en de klok komen van `ctx.currentTime`.
- Geen afval per blok.
- Toeval uit een eigen LCG, niet uit `Math.random`.
- De worklet slaapt bij stilte, maar **tijdens een sessie** blijft er een ruisvloer boven −72 dBFS (§2.5).

**Nuance op MediSynth I2.** "Attack ≥ 200 ms" blijft voor alles wat het instrument **zelf** doet. Wat jij aanslaat mag een zachte klop van enkele ms hebben, zoals de Waterschaal al doet: eigen geluid laat je niet schrikken (§2.4). Dit is een voorstel om I2 te verfijnen en geen besluit. Eerst horen.

### 3.6 Meditatie: wat er al is, eerlijker gemaakt

- **Sessies** 5 / 10 / 20 / vrij met "rond af". Geen klok in beeld. Overgenomen uit de Waterschaal.
- **Ademgids optioneel**:
  - standaard 6/min, in 4,5–7;
  - verhouding 4:6;
  - geen vasthoudpauzes als standaard;
  - kies geluid, beeld of beide;
  - een vooraf ingestelde oefening "zucht" (cyclic sighing, 5 min).
- De **resonantietest** wordt een extra, geen voorwaarde (Sumińska 2026).
- **Anker of open veld** als twee manieren om te zitten, niet als twee apps.
- De **eerste keer** één zin: "ongemak kan voorkomen, stoppen mag altijd". Ogen open mag.
- **Dagboek en "Wat nam je waar?"** blijven. Dat is het mooiste wat de Waterschaal heeft: het maakt van spelen een praktijk.
- **Geen** frequentiemystiek, **geen** gezondheidsclaims (§2.4).

### 3.7 Beeld

Kort, want het was niet de vraag. Er is meer dan genoeg om uit te kiezen, en niets nieuws nodig:
- Bloom-vlekken en contrails (MediSynth `canvas.js`).
- De Vormmachines uit Varve als pure modules (`src/vormen/`, deterministisch en 16:9).
- De stand "zonder scherm" uit de Waterschaal: een zwart scherm met een ademende stip.

Regel: het beeld volgt de klank traag. Minder dan 0,5 Hz in helderheid, en `prefers-reduced-motion` wordt gerespecteerd.

---

## 4. Waar het moet wonen

**Advies: in de MediSynth-repo, als volgende versie.** Geen nieuwe repo.

- **Waarom:**
  - MediSynth heeft precies de vangrails die "uit liefde" verdient: invarianten als tests, offline renders die gemeten worden, en een DoD op basis van gebruik.
  - Het is gebouwd voor de browser, zonder APC.
  - Wat ontbreekt (de laptopbediening, programmeren, de schaal, meer klank) past in zijn lagen: Touch krijgt de handen, Weather wordt de zes stemmen, Voices krijgt de nieuwe bronnen, Mood wordt de Wereld.
- **Wat erheen gaat:**
  - De kern van de schaal: Varve's `klankschaal-kern.js` is puur en getest, en kan zo mee.
  - De FDN-freeze uit Varve.
  - Uit de Waterschaal: de sessie, het dagboek en de adempatronen.
- **De stack: niet heropenen.** MediSynth koos Vite single-file + vitest omdat een wereld als één HTML-bestand te delen moet zijn. Varve koos geen build. Beide zijn verdedigbaar. Er is geen reden om MediSynth om te gooien.
- **Wat het niet is:** geen deel van Varve en geen deel van AV-kern. AV-kern blijft het APC-meditatie-instrument met publicatie op 25 oktober. Dit is het laptop-instrument. Ze delen modules (de schaal, de vormen), geen app.

## 5. De volgorde ten opzichte van AV-kern

Afspraak van 24 sep: tot 25 oktober gaat AV-kern voor. Dit onderzoek verandert dat niet. Een kleine plak (§6) past ernaast als avondinstrument. Toch moet jij het zeggen, want het is precies het soort project dat de publicatie kan verdringen (VRAGEN H5).

## 6. De eerste plak (voorstel)

**"Twee handen", bovenop MediSynth v0 One Room:**

1. `event.code`, alles loslaten bij Meta-up, `blur` en `visibilitychange`, de letters als harmonic table.
2. Touchpad: zweven, slepen met Music Mouse-tweede stem, cirkelen = wrijven, schuiven = diepte.
3. De schaal (uit Varve) als één nieuwe stem naast de glazen bellen.
4. Stemmen: `1`–`4` vast + bewegen. Per stem alleen **dichtheid** en **herhaal ↔ verander**. Plus `Enter`/`Backspace` (tijdelijk bewaren en terug).
5. Ruisvloer tijdens het spelen en een sessie van 10 minuten met "rond af".

**Klaar als:**
- je een avond 20 minuten speelt en de stemmen-handgreep minstens één keer gebruikt zonder naar de code te grijpen;
- je na tien minuten niets doen nog niet wilt stoppen.

Precies MediSynth §6, met één regel erbij. Nog niet in deze plak:
- granulair en shimmer;
- scènes A/B;
- varianten;
- de boog;
- opname.

## 7. Vragen voor jou

1. **Waar wonen?** MediSynth uitbreiden (advies), of toch een nieuwe repo met een nieuwe naam?
2. **Wanneer?** Na 25 oktober (AV-kern eerst), of nu al de kleine plak als avondinstrument?
3. **Wat is "programmeren" voor jou?** Klopt "regels per stem verzetten met een vastgehouden toets" met wat je voor ogen had? Of bedoelde je iets anders, zoals code typen (Strudel-achtig), tekenen, of een sequencer?
4. **De eerste wereld.** Glass (MediSynth), "Water en diepte" (Waterschaal + AV-kern), of iets anders?
5. **Alleen de laptop, of ook telefoon/iPad?** Advies: eerst de laptop. iOS als PWA is nog wankel (§2.5).

## 8. Hoe dit onderzocht is, en de grenzen

- **Eerdere projecten gelezen:**
  - de repo's `medisynth` (docs en code), `waterschaal` (v0.5, de tekst en de stemlijst) en `av-kern` (README, LOG, CLAUDE.md, drone);
  - in Varve `KLANKSCHAAL.md`, `INPUT.md`, `plugins/` en ROADMAP.
- **Vijf agenten** werkten parallel: invoer, programmeren, klank/DSP, meditatie en webtechniek. Hun rapporten staan ongewijzigd in `bronnen/`, met alle URL's en bewijsgraden.
- **Grens 1: WebFetch was voor alle agenten geblokkeerd** door de proxy. Ze lazen zoekresultaten en samenvattingen, geen volledige artikelen. Uitzonderingen zijn de klank- en de web-agent, die broncode via GitHub lazen. Cijfers uit abstracts zijn als zodanig gemarkeerd. Bij twee agenten raakte ook het zoekbudget op.
- **Grens 2: de DSP-kosten zijn gemeten op een Xeon in Node, niet op een M1 in Chrome.** Ordegrootte, geen belofte.
- **Grens 3: niets hiervan is bespeeld of beluisterd.** De toetsenindeling, de gebaren en de klankvolgorde zijn ontwerpvoorstellen. Pas ze aan na het spelen.

Dit is met zorg gemaakt. Het mooiste aan deze vraag vind ik dat al het nodige er al ligt. Het hoeft alleen samen te komen.
