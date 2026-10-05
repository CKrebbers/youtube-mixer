# Studio: VARVE groeit uit tot een muziekprogramma

*5 oktober 2026 · besloten met Clay, uitgewerkt na een inventaris van alle repo's
(vier parallelle onderzoeken: Varve DJ + stems, de synth-repo's, de effect- en
sequencer-repo's, en de twee nieuwe controllers). Volgorde: `ROADMAP.md` punt 27.*

---

## 0. In het kort

Clay's wens, letterlijk: *"een soort dj programma waar je stems kunt mixen en
effecten kunt toepassen op het geheel maar ook op aparte stems. Maar je kunt ook
stukken programmeren zodat je dat weer kunt mixen. En er zitten synthesizers in die
je kunt spelen of voor kunt programmeren. En je kunt alle onderdelen ook
voorbeluisteren met de koptelefoon."* Met vier controllers: APC40 mkII, LPD8,
Maschine MK2 en E-MU Xboard49. Onderdelen die al gebouwd zijn hergebruiken.

**Besluiten (Clay, 5 okt):**

| # | Vraag | Besluit |
|---|---|---|
| ST1 | Waar woont het? | **VARVE groeit uit.** Geen nieuw programma: decks, beatgrid, sync, racks, sends, sampler, opnemen, de action-bus en de APC-indeling zijn er al. |
| ST2 | Geluidskaart | **Scarlett 2i2** voor de zaal, de **koptelefoonuitgang van de Mac** voor de cue, samen één Aggregate Device (§3). |
| ST3 | De stems-takken | Gepusht en als PR #3 naar `main` (5 okt). |
| ST4 | Regels van de oorspronkelijke instrumenten | **Gelden niet in VARVE.** MediSynth (geen tempo, alleen pentatonisch, aanslag ≥ 200 ms), het toonladderslot van AVBRNC en de filter-app: in hun eigen app blijven ze, hier spelen instrumenten chromatisch en op de maat. |
| ST5 | Repo uit iCloud | Ja (§6, de commando's staan in HANDOFF). |
| ST6 | Koptelefoon op de APC | Cue Level = volume, shift + Cue Level = mix. |
| ST7 | Waar een instrument woont | **Op een van de acht tracks**: een track draagt een nummer óf een instrument, met dezelfde strip, fader, sends en cue. De APC-indeling verandert niet. |

**De controllers** komen via de hub (`~/Projects/AV-app-hub`), die als enige een
controller opent. VARVE wordt een app van de hub (hub-fase 1, "lease"); tot dan
praat VARVE zelf met de APC, zoals nu.

---

## 1. Wat er al is, en waar het vandaan komt

| Wens | Al gebouwd | Waar | In fase |
|---|---|---|---|
| Stems mixen | Demucs bij de ingest, `stems.wav`, niveau + kill per stem | hier, PR #3 (`docs/STEMS.md`) | — |
| Effecten op een track | insert-rack per track, 7 effecten, twee send-bussen | hier (`fx.js`, `rack.js`) | — |
| Meer effecten | 19 effecten met een net contract `{params, build(), apply()}`, waarvan 4 als AudioWorklet (bitcrusher, envelope, pitch shift, geheugen) | `~/Projects/filter app/effects.js` (637 r), `worklets.js` (151 r); klassieke scripts op `window`, om te zetten naar ES-modules | S2 |
| Een echte limiter | tanh-limiter met 4× oversampling, DC-blocker; los daarvan limiter, trage normaliser en BS.1770-meter | `Visual app/src/audio/dsp.js` (522 r, zonder imports); `MediSynth-hub/src/audio/dsp.js` | S2 |
| Synths | FM-stemmen met unison (12 stemmen), kristallen schaal, FDN-galm, korrelwolk, tape-warmte | `MediSynth-hub/src/audio/` (`engine.js` 17 kB, `bowl.js`, `reverb.js`, `grains.js`, `warmth.js`); de DSP-klassen zijn importvrij | S3 |
| | de klankschaal (Waterschaal) | hier (`klankschaal*.js`) | S3: het eerste instrumentkanaal |
| | polysynth met twee oscillatoren | `filter app/` | S3 |
| | Sediment: subtractieve pad, 22 parameters, 8 presets | `Eerste logic plugin/` (C++/JUCE, AU); `src/dsp/Space.*` is JUCE-vrij | S5 (port) |
| Stukken programmeren | transport op 384 PPQN met 120 ms vooruitblik, patronen met p-locks en swing, M8-achtige tracker, deterministische conditionele trigs; 217 tests | `~/Projects/Elektronlearn/src/core/` (`transport.js`, `runtime.js`, `rng.js`), `src/devices/elektron.js`, `m8.js`; puur, draait in Node | S4 |
| | generatieve stemmen op maat en tempo (Markov-akkoorden, toeval via hash) | `Eerste logic plugin/scripter/src/core.js` (Logic Scripter, met simulator) | S4/S5 |
| | Euclidisch, Turing-machine, akkoorden; parameters 0..1 met p-lock-vlag | `AVBRNC/modules/` (C99, ook als WASM) | S5, vooral als ontwerp |
| Modulatie | LFO's tot 600 s, random walk, sample & hold, envelope-volger, Lorenz; matrix met diepte −1..1 | `filter app/mod.js` (830 r, met DOM verweven); `Visual app/src/core/automate.js`, `modulators.js` (puur) | S5 |
| Voorbeluisteren | **nergens** | — | **S1** |
| APC40 + LPD8 | profielen, wachtrij, LED's, hotplug, proeven | `~/Projects/AV-app-hub` | — |
| Xboard49 + Maschine MK2 | **nergens** | hub (§4) | S3, S4 |

Niet gebruikt: AV-kern (bevroren tot de publicatie van 25 okt; VARVE heeft een eigen
APC-laag), Niets iets (geen audio), td-lab.

Verhouding tot `docs/synth/ONDERZOEK.md` (de web-synth, 3 okt): dat blijft een eigen
laptop-instrument in de MediSynth-repo. VARVE en MediSynth delen MODULES, geen app.

---

## 2. Wat er echt nieuw is

1. **Een cue-bus met een eigen uitgang** (S1). Elk kanaal voorbeluisteren terwijl de
   zaal iets anders hoort.
2. **Stems als eigen kanalen** (S2). Nu worden ze vóór de EQ opgeteld: per stem
   alleen niveau en kill. Straks per stem EQ, effect en cue.
3. **Instrumentkanalen** (S3): een kanaalstrip zonder transport, met een
   instrument erin dat noten speelt (`noteOn/noteOff`, druk, buiging, parameters 0..1).
4. **Patronen** (S4): een sequencer op de maat van de maatgever, die instrumenten en
   samples speelt; patronen starten als clips op het APC-grid.
5. **Noten in het hub-protocol** (S3): nu kent het alleen 0..1 en triggers.

---

## 3. De koptelefoon (S1) — gebouwd 5 okt, zie §5

**Het apparaat.** De Scarlett 2i2 heeft twee uitgangen; zijn koptelefoon speelt
hetzelfde als uitgang 1/2. Een eigen cue vraagt dus een tweede uitgang: die van de Mac.
macOS maakt van twee apparaten één, met één klok (regel 3 blijft heel):

1. *Audio-MIDI-configuratie* → **+** → *Maak samengesteld apparaat* (Aggregate Device).
2. Vink **eerst de Scarlett 2i2** aan, **dan de koptelefoonuitgang van de Mac**
   (op de MacBook Air: "Externe koptelefoon", die pas verschijnt als er een koptelefoon
   in zit). De volgorde bepaalt de kanalen:
   Scarlett = 1/2 (de zaal), Mac = 3/4 (de koptelefoon).
3. Klokbron: de Scarlett. Bij de Mac-uitgang **Driftcorrectie** aan.
4. Zet het samengestelde apparaat als uitvoer in *Systeeminstellingen → Geluid*,
   **vóór** je VARVE opent (Chrome kiest het apparaat bij het maken van de AudioContext).

Staan zaal en koptelefoon andersom: de knop **⇄** in de KOPTELEFOON-rij (onthouden,
werkt na herladen), of de volgorde in stap 2 omdraaien.

**Hoe het klinkt.** Per track een cue-knop. De cue hoort het signaal VÓÓR de fader
(na trim, EQ, effect en filter), dus ook een track met de fader dicht. De koptelefoon
mengt cue en zaal (MIX: links alleen cue, rechts alleen de zaal) op een eigen volume
(VOL, met de curve van een fader). Staat er geen enkele cue aan, dan hoort de
koptelefoon de zaal: je hoort altijd iets (een keuze, VRAGEN S3). De zaal, de opname, de vormen en de analyse veranderen niet: de cue gaat
nergens anders heen dan naar kanaal 3/4.

**Zonder vier kanalen** (alleen de Scarlett, of de luidsprekers van de Mac) bestaat
de cue niet: geen enkele node erbij, de master gaat bit voor bit zoals altijd naar de
uitgang, de cue-knoppen staan uit (lampje uit, read `null`) en de rij zegt waarom.

**Op de APC:** ● (record arm) in het 2×2-blok van elke kolom, ZONDER shift = cue aan/uit
(rood lampje = je hoort hem). Met shift blijft ● het cuepunt. **Cue Level** = het
koptelefoonvolume, **shift + Cue Level** = de mix (Clay, 5 okt). Het sampler-volume en de
puls, die op Cue Level stonden, zitten nu op shift + Cue Level in de grid-modus sampler
en video.

**Actions:** `track.N.pfl` (trigger, aan/uit; read 1/0, null zonder cue-uitgang),
`headphone.level` en `headphone.mix` (value 0..1). Terugspelen slaat ze over (de zaal
hoort ze niet) en ze staan niet in de beginstand van het handelingenlog.

**Gemeten in Chrome** (`tools/headless/koptelefoon.mjs`, 5 okt): de echte engine op een
OfflineAudioContext van vier kanalen, track 1 op 440 Hz met de fader dicht, track 2 op
1000 Hz open. Zonder cue: zaal en koptelefoon 1000 Hz, 440 Hz onder −80 dB. Cue op
track 1, mix links: koptelefoon 440 Hz op −9 dB en 1000 Hz op −156 dB, de zaal precies
gelijk aan zonder cue. Mix in het midden: beide. VOL 0,8 → 0,5: 13,50 dB zachter.
Omgewisseld: andersom. Daarnaast 25 checks in `engine.test.mjs` (bedrading, klikvrij,
reads, log, APC). **Nog niet gehoord** op een echt samengesteld apparaat.

---

## 4. De vier controllers

| Controller | Rol (voorstel) | Hoe hij binnenkomt | Bevestigd / te meten |
|---|---|---|---|
| **APC40 mkII** | mixer, tracks, effecten, cue; in S4 patronen starten op het grid (5 × 8) | nu: VARVE zelf (Web MIDI, mode 0x42); straks via de hub (lease) | bevestigd (`docs/APC40.md`) |
| **LPD8** | globale macro's, paniek, tap, opnemen | de hub (globale laag) | in de hub gebouwd, proef op de hardware nog open |
| **Xboard49** | synths spelen; de 16 knoppen bedienen het gekozen instrument | de hub, gewone MIDI-poort | class-compliant op de Mac (geen driver); noten met velocity, kanaal-aftertouch, pitchbend, modwiel, sustain, 16 knoppen (CC/NRPN), één pedaal. **Ontvangt niets**: geen LED's of display aan te sturen. Knoppen zijn absolute potmeters → pickup. Fabrieks-CC's staan niet in de handleiding → leren met een proef, zoals de LPD8. |
| **Maschine MK2** | patronen programmeren: 16 drukgevoelige pads, stappen invoeren, de twee schermen tonen het patroon | de hub, **rechtstreeks over USB-HID** (node-hid), zonder NI-software | NI ondersteunt de MK2 niet meer sinds nov 2024; zijn MIDI-modus werkt alleen mét NI's achtergronddienst. Het HID-protocol is open beschreven (VID:PID 17CC:1140; pads 12-bit druk, RGB-pads, 2 schermen 256 × 64): `jayintheday/maschine-code` (MIT, Node + node-hid, op macOS getest), `shaduzlabs/cabl`, Ardour `maschine2`. Te meten: openen zonder NI-agents, macOS-toestemming *Invoermonitoring*, paddrempels en -oriëntatie, kleuren, schermen. |

---

## 5. De fasen

Eén fase per keer; elke fase eindigt speelbaar. Nieuwe ideeën → VRAGEN of ROADMAP,
niet in de lopende fase.

### S0 — Veiligstellen (5 okt, grotendeels gedaan)
- [x] Stems-takken gepusht; de losse fix (library-laad na een los bestand) gecommit.
- [x] PR #3 (stems → `main`), samengevoegd met de cloudsessies van 2 okt.
- [ ] Clay: PR #3 mergen.
- [ ] Clay: de repo uit iCloud (commando's in HANDOFF; de auto-modus van Claude
      weigerde de verhuizing zelf als onomkeerbaar).
- [ ] Clay: hub-hardware-avond 1 (`AV-app-hub/docs/HARDWARE-AVOND.md`).

### S1 — Koptelefoon (gebouwd 5 okt, niet op de Mac geprobeerd)
De punten staan ook in de speellijst van de Controlekamer (blok Koptelefoon).
Klaar als (op de Mac):
- [ ] met het samengestelde apparaat: de rij zegt "zaal 1/2 · koptelefoon 3/4"; de zaal
      komt uit de Scarlett, de koptelefoon uit de Mac;
- [ ] track 2 in de koptelefoon (● op kolom 2) terwijl de zaal alleen track 1 hoort,
      ook met fader 2 dicht;
- [ ] MIX en VOL doen wat ze zeggen; geen tik bij cue aan/uit;
- [ ] een opname bevat geen cue;
- [ ] zonder het samengestelde apparaat: VARVE werkt als vroeger en de rij zegt waarom
      er geen cue is.

### S2 — Stems als kanalen, effecten overal
- Per stem een eigen strip vóór de som: EQ, insert-rack en cue (`track.N.stem.<s>.pfl`).
  Kost per deck vier extra strips; meten met `renderblok` (0 GC blijft de eis).
- Een insert-rack op de master, en een echte limiter (oversampled, als AudioWorklet)
  in plaats van de DynamicsCompressor.
- De effecten van de filter app als ES-module erbij in `fx.js`, met hun contract.
- VRAGEN N1 (waar stems op de APC staan) eerst beslissen.

Klaar als: zang met echo terwijl de drums droog blijven; alleen de bas in de
koptelefoon; de limiter vangt een piek zonder te pompen (gemeten).

### S3 — Spelen
- Hub: profiel Xboard49 (proef: poortnaam, elke knop één keer) en noten in het protocol
  (`noot`: nummer, snelheid 0..1, druk, buiging).
- VARVE wordt een app van de hub (hub-fase 1, gepland na 25 okt).
- Instrumentkanalen: een strip zonder transport (EQ, insert, fader, sends, cue) met
  één interface: `noteOn(noot, snelheid, t)`, `noteOff(noot, t)`, `druk(w)`,
  `buig(w)`, `zetParam(i, 0..1)`. De klankschaal wordt het eerste; dan de FM-stemmen
  van MediSynth (chromatisch, ST4) en de polysynth van de filter app.
- De knoppen van de Xboard volgen het gekozen instrument, zoals de device knobs de
  focus-track.

Klaar als: op de Xboard49 de FM-synth spelen over een lopend nummer, eerst alleen in de
koptelefoon; velocity en aftertouch hoorbaar; toets → geluid gemeten (doel < 15 ms).

### S4 — Programmeren
- De sequencer van Elektronlearn (transport, patronen, p-locks) op de klok van de
  maatgever: tempo en tel uit `fxKlok()`, nooit een eigen teller (regel 3).
- Een patroon is een clip: per instrumentkanaal patronen, starten op de maat vanaf het
  APC-grid (een grid-modus "patronen").
- Hub: profiel Maschine MK2 via HID (proef eerst, §4); pads met druk = stappen en
  live opnemen; de schermen tonen het patroon.
- Patronen bewaren op de server (JSON), zoals racks.

Klaar als: een drumpatroon van één maat op de Maschine, een baslijn van de Xboard,
beide op de tel van het lopende nummer gestart vanaf de APC en gemixt als tracks; na
herladen zijn ze er nog.

### S5 — Later, alleen als je het mist
Patronen opnemen naar audio in de library; Sediment naar JS/AudioWorklet (eerst
`Space`); AVBRNC via WASM; korrelwolk en modulatoren als routebron.

---

## 6. Open vragen (VRAGEN blok S)

- ~~S1~~: Cue Level = volume, shift = mix (ST6).
- ~~S2~~: een instrument op een van de acht tracks (ST7).
- S3: zonder enige cue hoort de koptelefoon de zaal. Goed zo?
- Uit iCloud: zie HANDOFF.

## 7. Aannames en wat niet geverifieerd is

- Chrome kiest het samengestelde apparaat als het de systeemuitvoer is bij het
  openen van de pagina, en meldt dan `destination.maxChannelCount` = 4. Niet op Clay's
  Mac nagegaan. Wisselen tijdens het spelen volgt Chrome niet altijd: herladen.
- Een samengesteld apparaat met driftcorrectie geeft één klok aan Chrome; de cue loopt
  dus sample voor sample gelijk met de zaal. Aangenomen op grond van hoe macOS het
  beschrijft, niet gemeten.
- De koptelefoonuitgang van de Mac heet per model anders; op Apple Silicon verschijnt
  "Externe koptelefoon" pas als er een koptelefoon in zit.
- Maschine MK2 via HID en de Xboard49: §4, alles wat "te meten" heet.
