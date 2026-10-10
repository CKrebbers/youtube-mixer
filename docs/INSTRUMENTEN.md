# Instrumenten — het contract (STUDIO S3)

*5 oktober 2026 · het contract voor de bouw, zoals `docs/STEMS.md` dat was voor de stems.
Besluit van Clay (STUDIO.md ST7): **een track draagt een nummer óf een instrument.***

---

## 1. Waar het klinkt

Een instrument speelt in de kanaalstrip van zijn track: hij sluit aan op `chain.input`
(trim) en gaat dan door EQ, insert-effect, filter, fader en crossfader. Sends (echo,
galm) en de koptelefoon (cue vóór de fader) werken daardoor vanzelf, net als bij een
nummer. Een track met een instrument heeft geen nummer; een nummer laden haalt het
instrument weg (en andersom). Wat de APC met de kolom doet blijft gelijk.

## 2. Een instrumentmodule

Elke module in `src/engine/instrumenten/` exporteert één definitie, en
`src/engine/instrumenten/index.js` zet ze in `INSTRUMENTEN` (expliciete lijst, geen
registratie via bijwerkingen van imports):

```js
export const POLY = {
  soort: 'poly',                 // vaste id, [a-z0-9-]
  naam: 'Poly',                  // op het scherm
  maak(ctx, { uit, klok, toon }) { return new Poly(ctx, uit); },
};
```

- `uit`: de AudioNode waar het instrument op aansluit (de engine geeft `chain.input`).
- `klok`: `() => fxKlok()` van de maatgever, of `null` zonder maat (voor iets dat op de
  tel moet; mag genegeerd worden).
- `toon`: `() => deck.toonsoort` van de maatgever (voor een schaal; mag genegeerd).

## 3. Het instrument-object

| Lid | Betekenis |
|---|---|
| `soort`, `naam` | zoals de definitie |
| `params` | `[{ id, label, standaard, eenheid?, gebaar? }]`, hooguit 8; plek `k` (1..8) = `params[k-1]`. `standaard` 0..1, `eenheid(v)` → tekst in echte eenheden (zoals `eenheid` in `fx.js`). `gebaar: true` = een knop die zelf klank maakt (wrijven op de Schaal): de patronenset onthoudt hem niet, zodat er na het laden niets vanzelf klinkt (PATRONEN.md §7.6) |
| `start()` | `Promise`, laadt wat er lazy moet (een worklet). Idempotent. Een `noteOn` vóór `start()` klaar is mag stil blijven, nooit gooien |
| `noteOn(noot, snelheid, t?)` | `noot` 0..127 (MIDI, A4 = 69 = 440 Hz), `snelheid` 0..1 (> 0), `t` = ctx-tijd; `undefined` of in het verleden = nu |
| `noteOff(noot, t?)` | los; de stem klinkt uit volgens zijn release |
| `alleUit(t?)` | alle noten los (klinken uit) |
| `stil()` | meteen stil (paniek), met een korte fade: nooit een tik |
| `druk(w, noot?)` | aftertouch 0..1; zonder `noot` = voor het hele kanaal |
| `buig(w)` | pitchbend −1..1 (± 2 halve tonen) |
| `mod(w)` | modwiel 0..1 |
| `houd(aan)` | sustainpedaal: `noteOff` wacht tot het pedaal los is |
| `zetParam(k, v)` / `leesParam(k)` | plek 1..8, 0..1; `leesParam` = `null` voor een plek die er niet is |
| `stand()` | `{ soort, naam, klinkt, params: [0..1, …] }` (`klinkt` = aantal stemmen dat klinkt) |
| `vernietig()` | alles los en weg; daarna niets meer aanroepen |

## 4. Regels (dezelfde als de rest van de engine)

1. **Tijd van de audioklok** (regel 3). Noten in de toekomst plannen met `t` op de
   Web Audio-klok, nooit met `setTimeout` (de sequencer van S4 plant vooruit).
2. **Geen afval op de audiothread** in een worklet (`docs/AUDIOPAD.md`):
   tussenresultaten in vooraf gemaakte Float64Arrays, niets aanmaken per blok.
3. **Nooit `setValueCurveAtTime`**; envelopes vanaf `houdVast` met
   `setTargetAtTime`/`linearRampToValueAtTime` (`overgang.js`).
4. **Stemroof** bij een volle polyfonie: de oudste, met een korte fade, zonder tik.
5. **Luidheid**: een akkoord van drie noten op snelheid 0,8 ongeveer even luid als een
   nummer (−14 LUFS, zoals de klankschaal); meet het en zet de ophoging vast.
6. **Chromatisch, met tempo** (ST4): geen toonladderslot en geen invarianten uit de
   oorspronkelijke app. Een schaalinstrument (de klankschaal) mag zijn noten wel op
   zijn eigen velden leggen, maar elke MIDI-noot moet iets doen.
7. **De engine kent geen MIDI** (regel 1): noten komen binnen als getallen. Wat een
   MIDI-bericht is, weet `src/control/`.

## 5. Wat hier nog niet vastligt

De track-kant (de API op de engine, de actions `track.N.inst…`, hoe noten van een
toetsenbord binnenkomen, het scherm en de APC) staat in §6 hieronder (gebouwd 5 okt).

## 6. Op de track (ingevuld door het spoor instrumenten, gebouwd 5 okt)

### 6.1 De engine

| API | Wat |
|---|---|
| `engine.zetInstrument(deckId, soort \| null)` | `{ ok, reden? }`. `soort` uit `INSTRUMENTEN`; null = weghalen. Dezelfde soort nog eens doet niets. |
| `engine.instrumentOp(deckId)` | het instrument-object (§3), of null |
| `engine.speeltrack()` | waar noten heen gaan: de focus-track als die een instrument heeft, anders de laatste focus-track met een instrument, anders de eerste track met een instrument; null als er nergens een is |
| event `'instrument'` | `{ id, soort }` na elke wissel (soort null = weg) |
| `snapshot().decks[id].instrument` | `stand()` van het instrument, of null; `snapshot().speel` = de speeltrack |
| `deck.leeg()`, `deck.laadt` | het nummer eraf (de track is daarna leeg); loopt er een laad? |

- **Aansluiten.** De engine maakt per instrument een eigen GainNode (de `uit` die
  `maak()` krijgt) en verbindt die met `chain.input` (trim) van de track. Daarachter
  de hele strip: EQ, insert-effect, filter, fader, crossfader, sends (na de fader) en
  de koptelefoon-cue (op het filter). `klok` en `toon` in `maak()` komen van
  `syncMaster(id)`: dezelfde maatgever als sync, sampler en de bussen.
- **Een nummer óf een instrument.** Een instrument erop haalt het nummer eraf
  (`deck.leeg()`: de bron vloeit uit en wordt na 100 ms opgeruimd; cue, hotcues,
  grid, toonsoort, stems en loops weg; de strip blijft staan; meldt `'load'`). Een laad
  die nog loopt geeft dan `false`. Andersom: een nummer laden (deck `'load'` met een
  buffer) haalt het instrument weg.
- **Weghalen** is klikvrij: eerst `alleUit()`, dan gaat de aansluiting dicht met
  `killVersterking` (5 ms zachte S, na `startDrempel`), en pas daarna (een timer, met
  marge) `vernietig()` en losmaken. Een instrumentmodule hoeft daar dus niets voor te
  doen, maar `vernietig()` moet ook zonder die fade geen tik geven (de Poly: eerst `stil()`).
- **Geen nummer, wel geluid.** Een instrumenttrack heeft geen buffer, grid of
  transport: hij geeft nooit de maat (`maatgever`, `syncMaster`), sync en starten op de
  maat weigeren ("leeg"), sampler-knippen ook. `level()` en de meters werken (de
  analyser zit achter de strip). De video ziet een lege track. De auto-DJ laadt nooit
  op een track met een instrument (`_vrijDeck`). Het handelingenlog: de beginstand ziet
  de track als leeg; `track.N.inst*` gaat wel het log in maar terugspelen slaat het over
  (de noten staan niet op de bus), en de knoppen staan niet in de beginstand
  (`OVERSLAAN`, `NIET_IN_WAARDEN`).

### 6.2 De actions (per track N)

| action | soort | read |
|---|---|---|
| `track.N.inst` | trigger: rondlopend geen → elk instrument → geen | 0 = geen, anders index / (aantal) |
| `track.N.inst.next` / `.prev` | trigger: bladeren door de instrumenten (zonder "geen") | null zonder instrument, anders 0 |
| `track.N.inst.knob.1..8` | value 0..1: plek k van het instrument (`zetParam`) | `leesParam(k)`, null zonder instrument |
| `track.N.inst.stil` | trigger: paniek (`stil()`) | null zonder instrument, 1 ingedrukt, 0,5 klinkt, 0 stil |

Staat er een nummer dat SPEELT, dan haalt kiezen het er pas af bij een tweede druk
binnen 3 s (eerst een melding): ook op de APC. Een stil nummer gaat meteen. Andersom,
in de library: een instrument dat klinkt telt als "speelt", dus laden erover vraagt de
tweede klik. Noten gaan NIET over de bus.

### 6.3 Noten van een toetsenbord (`src/control/noten.js`)

- Elke MIDI-ingang die niet de APC is (op naam, `/apc40/i`). Geen eigen
  `requestMIDIAccess`: `hoorHub(midi)` luistert mee op de MidiHub van midi-opzet.js,
  dus alleen in het eerste VARVE-tabblad (Web Lock). Een poortobject van buiten (straks
  "Xboard49 (hub)" van de AV-app-hub) sluit aan met `koppel(poort)`: `addEventListener`
  als die er is (een bestaande `onmidimessage` blijft staan), anders `onmidimessage`
  (achter een handler die er al stond). Berichten `{ data, timeStamp }`.
- note on/off (velocity 0 = off) → `noteOn(noot, v/127)` / `noteOff`; pitchbend →
  `buig` (8192 = 0, de aanslagen precies ±1); kanaal- en polyfone aftertouch → `druk(w)`
  / `druk(w, noot)`; CC 1 → `mod`; CC 64 → `houd`; CC 120 → `stil()`, CC 123 →
  `alleUit()` (op de speeltrack en waar die poort nog noten heeft).
- Een noot-uit gaat naar het instrument waar zijn noot-aan heen ging, ook als de focus
  intussen wisselde; het pedaal ook. Verdwijnt een poort (state niet meer `connected`,
  of `ontkoppel`), dan laten zijn noten en zijn pedaal los.
- De knoppen: `mappings/xboard49.json`, een gewone Mapping met `{speel}` = de
  speeltrack: CC 21–28 (elk kanaal) → `track.{speel}.inst.knob.1–8`, absoluut, dus
  soft-takeover zoals een fader (eerst oppakken). **AANNAME uit Ardour's xboard-map, te
  controleren met een proef**; knop 9–16 (CC 31–38) sturen sinds 5 okt de FX-knoppen van de speeltrack en de schuif
  (SysEx Master Volume) zijn volume: `docs/MASCHINE.md` §6.
- Het schermtoetsenbord gebruikt dezelfde weg: `noten.speel(noot, v)` / `noten.laat(noot)`.

### 6.4 Het scherm en de APC

- **INSTRUMENT-rij** (knop "instrument" in de balk, standaard dicht, onthouden): voor de
  focus-track kiezen (`track.N.inst`), de acht knoppen met de namen van de plekken (titel:
  de waarde in echte eenheden, dubbelklik = standaard), stil, een toetsenbord van twee
  octaven (C3–C5, ◀ ▶ per octaaf, lager op de toets = harder, glijden speelt mee) dat op
  de speeltrack speelt, en welk MIDI-keyboard er is (licht op als er net iets binnenkwam).
- Kolom, baan en focuskop tonen `♪ <naam>` (violet) in plaats van een titel; de golfvorm
  blijft leeg. Een ▶ in de kolomkop zolang het instrument klinkt.
- **APC: het mapje inst.** Clip/Device View loopt strip → rack → **inst** → strip, maar
  alleen als de focus-track een instrument heeft (`OP_AANVRAAG` in lagen.js; zonder
  instrument blijft het strip ↔ rack zoals altijd). In inst: device knobs 1–8 =
  `track.{focus}.inst.knob.1–8` (endless), Device ◀ ▶ = vorig/volgend instrument, On/Off
  = stil (lampje = er klinkt iets). Gaat het instrument weg terwijl inst open staat: terug
  naar de strip. Alleen regels erbij (11, in `device.inst`); voorganger `a067b3f2-397`.

### 6.5 De Poly (`src/engine/instrumenten/poly.js`)

De polysynth uit de filter app: per stem twee oscillatoren (±ontstemming), een lowpass
met envelope, een VCA met ADSR; 12 stemmen, stemroof (eerst wat los is, dan het pedaal,
dan de oudste toets; 5 ms zachte S). Acht plekken: golf (zaag/blok/driehoek/sinus, vanaf
de volgende noot) · ontstem (±0–40 ct) · filter (60 Hz–18 kHz) · reso (−3..18 dB) · env
(0–5 octaven, × snelheid) · attack (2 ms–3 s) · decay/rel (10 ms–6 s; één knop, zoals de
Volca Keys: een volle ADSR plus de rest zou negen zijn) · sustain. Buig ±2 halve tonen,
druk opent het filter (2 octaven), modwiel = vibrato (25 ct, 5,5 Hz). Snelheid² op de
amplitude.

**Gemeten in Chrome** (`tools/headless/instrument.mjs`, OfflineAudioContext 48 kHz):
A4 = 440,000 Hz (0,000 ct), C4 = 261,626 Hz; standaardklank 437,96 en 442,05 Hz
(symmetrisch, midden 0,00 ct). Een akkoord C4 E4 G4 op 0,8 met de standaardknoppen:
**−13,99 LUFS** (BS.1770, gegate), piek −3,6 dBFS, met `OPHOGING = 0,52` (bij 0,4 was het
−16,3). noteOff: uitgeklonken tot stilte, alleen dalend. Stemroof: rond het roven 1,24×
de tweede afgeleide van de rust (gepland én live); hard afkappen gaf 97×. Door de echte
engine: fader dicht = −94 dB, de filterknop van de strip neemt het hoog weg.
Gevonden en opgelost: in Chrome begon een lineaire helling na `cancelAndHoldAtTime`
midden in een `setTargetAtTime` (een GEPLANDE roof) op 0, een sprong; nu rekent de Poly
de stand van zijn envelope op dat moment uit (`_envOp`) en zet een expliciet beginpunt.

### 6.6 Wat nog niet getest is

- **Het echte Xboard49**: de CC-nummers van de knoppen (aanname), velocity-curve,
  aftertouch (kanaal of polyfoon?), het pedaal, en de latency toets → geluid (doel
  < 15 ms; noten spelen "nu", dus Web MIDI + uitgangsbuffer).
- Clay's oren: klinkt de Poly goed naast een nummer (luidheid gemeten, karakter niet),
  zijn de bereiken van de knoppen fijn, is 12 stemmen genoeg met het pedaal.
- De APC in het mapje inst (lampjes, of drie standen onder Clip/Device View lekker zijn).

## 7. FM en schaal

*5 oktober 2026 · spoor fm-schaal. Twee instrumenten volgens §2–§4; de track-kant
(§6) bouwt het spoor instrumenten. Nog door niemand beluisterd.*

| Bestand | Wat |
|---|---|
| `src/engine/instrumenten/fm.js` | `FM` / `Fm`: de FM-stemmen van MediSynth, alleen gewone Web Audio-nodes |
| `src/engine/instrumenten/schaal.js` | `SCHAAL` / `Schaal`: de klankschaal als track-instrument (hoofdthread) |
| `src/engine/instrumenten/schaal-kern.js` | `SchaalInstrumentKern extends SchaalKern`: tien notenvelden, berichten op hun sample. Puur |
| `src/engine/instrumenten/schaal-worklet.js` | de AudioWorklet `varve-schaal-instrument`, één per track, laadt bij `start()` |
| `test/instrumenten-fm-schaal.test.mjs` | het contract, tijdlijnen, de kern, de echte worklet (0 GC), de regels |
| `tools/headless/instrumenten.mjs` | Chrome, OfflineAudioContext: toonhoogte, luidheid (BS.1770), uitklinken, twee tracks |

### 7.1 FM

**Herkomst.** MediSynth-hub `src/audio/engine.js` (`noteOn`, `noteOff`, `wave`) en de stem
van de stemming "Glass" (`src/core/mood.js`, `voice`): harmonische FM (modulator =
ratio × de noot) met een index die na de halve aanslag naar 5% zakt (τ = verval / 2),
een draaggolf als PeriodicWave (`[1, 0,5, 0,22, 0,1, 0,05, 0,02]`), twee draaggolven in
unison die een vast aantal **Hz** tegen elkaar zweven (`detuneCents`: de zweving is in
de bas even traag als in de hoogte), een lowpass (Q 0,6 dB), een envelope en een panner.
Twaalf stemmen.

**Niet meegenomen** (ST4, en `src/core/invariants.js`): de toonladder en de zwaartekracht
(een MIDI-noot is een toonhoogte), de aanslag van minstens 200 ms, het plafond van 5 kHz
op het filter, de maximale zweving van 4 Hz, de swell (× 1,3 in 6 s), de weer-laag, de
galm, de korrelwolk, de tape-warmte en de bewaker (normaliser, limiter, meter). Het
instrument is droog en hangt aan `uit`, niet aan `ctx.destination`: galm en echo zijn de
sends van de track, de limiter is die van de master. De DSP-klassen van MediSynth
(`dsp.js`, `reverb.js`, `grains.js`, `warmth.js`) zijn dus niet nodig; alleen de stem.

```
mod (sinus, hz × ratio) ─► vorm (1 → 5%) ─► diepte (Hz) ─┬─► draag 1 .frequency
                                                          └─► draag 2 .frequency
draag 1, draag 2 (PeriodicWave, ± zweving/2) ─► filter ─► env ─► pan ─► som
buiging (ConstantSource) en vibrato (LFO × diepte), in cent ─► .detune van alle drie
som ─┬─► droog (1 − w) ─────────────────────────────┬─► uitGain ─► uit
     └─► voor ─► tanh (WaveShaper, 4×) ─► na (w) ────┘
```

| Plek | Knop | Bereik (0 · standaard · 1) | Wat |
|---|---|---|---|
| 1 | index | 0 · **1,4** · 8 (8v²) | modulatie-index bij de aanslag (Glass: 1,4) |
| 2 | ratio | 1 : 0,5 · **1 : 2** · 1 : 7 | tien standen: 0,5 1 1,41 2 2,76 3 3,5 4 5 7 (heel = harmonisch, 1,41/2,76 = klok) |
| 3 | aanslag | 1 ms · **8 ms** · 4 s | lineair (Glass had 280 ms; ST4: kort mag) |
| 4 | verval | 50 ms · **1,6 s** · ∞ | index τ = verval/2 (Glass 1,6 s), volume τ = 3 × verval; helemaal open = geen verval |
| 5 | release | 5 ms · **1,2 s** · 10 s | na noteOff τ = release/5; na 2 × release (−87 dB) stoppen de oscillatoren |
| 6 | zweving | 0 · **1,0 Hz** · 6 Hz (6v²) | de twee draaggolven (Glass 1,0 Hz) |
| 7 | filter | 200 Hz · **2,6 kHz** · 18 kHz bij A4 | volgt de noot voor de helft (√(hz/440)) |
| 8 | warmte | **uit** · 100% | tanh-verzadiging; klein signaal precies 1×, pieken worden rond |

Index, ratio, zweving en filter zijn meteen hoorbaar op wat klinkt (glijdend, τ 20 ms);
aanslag, verval en release horen bij de volgende noot (of noteOff).

**Spelen.** Snelheid: volume × snelheid^1,5 (0,5 = −9 dB, 0,1 = −30 dB), index ×
(0,4 + 0,6 × snelheid), filter × (0,75 + 0,5 × snelheid). Aftertouch (kanaal of per
noot): index × (1 + 1,5 × druk), filter × (1 + 0,5 × druk). Modwiel: vibrato 5,5 Hz tot
± 30 cent. Pitchbend: ± 200 cent via één ConstantSource op `.detune` van alle
oscillatoren (ook van de volgende noten). Pedaal: noteOff wacht.

**Stemmen.** Dezelfde noot opnieuw: de vorige gaat los (zoals MediSynth). Bij twaalf
stemmen wordt eerst de oudste gestolen die al los is, anders de oudste: vasthouden
(`houdVast`) en in 8 ms lineair naar nul, na `startDrempel` (of in de laatste 8 ms vóór
een noot die vooruit gepland is). `stil()` doet dat met alle stemmen en zet pedaal, druk,
buiging en vibrato terug. Opruimen op de audioklok (`_ruim`), niet op `onended`.

### 7.2 Schaal

**De keuze: elke noot een eigen veld, gestemd op de noot.** Het contract liet twee wegen
open (§4.6). Noten op de bestaande acht velden leggen (de dichtstbijzijnde toon van de
ladder) maakt van een melodie iets anders: Kurd heeft gaten van één tot drie halve
tonen, en twaalf MIDI-noten vallen op acht velden. Het model laat iets beters toe: een
veld is vier resonatoren, en een resonator stemmen is één coëfficiënt. Dus:

- **Tien notenvelden**, elk het handpan-veld van de Waterschaal (grondtoon, zwevende
  partner, boventonen 2 en 3), per noot gestemd op precies zijn toonhoogte (A4 = 440 Hz).
  KARAKTER schuift ze naar de schaal, KLANK bepaalt waarheen (brons = de boventonen van
  het origineel, 2,77 en 5,17; kristal, glas, gong hun eigen; ook de uitklank en het
  glijden van de klank). In de kern: stem 0 = kern, 9 = lichaam, 1–8 en 10–11 = velden;
  53 modi (≤ 64).
- **Dezelfde noot slaat hetzelfde veld** opnieuw aan (zoals op een handpan; twee velden op
  dezelfde toon zouden tegen elkaar zweven).
- **Een nieuwe noot** neemt een veld dat uitgeklonken is (t60 voorbij), anders het oudste
  dat los is, anders het oudste (stemroof). Is de noot vooruit gepland (de sequencer), dan
  wordt het oude veld 20 ms vooraf gedempt (t60 0,04 s, −30 dB). Live gaat de staart mee
  in de nieuwe toon.
- **Omstemmen houdt de amplitude.** `SchaalKern` laat bij een nieuwe stemming de toestand
  (y1, y2) staan; voor een paar cent (de klankschaal die van toonsoort wisselt) is dat
  goed, maar een veld dat van 2 kHz naar 55 Hz gaat klonk zo × 7,8 harder (gemeten). Nu
  blijft y1 (de golfvorm springt niet: geen tik) en wordt y2 uitgerekend voor dezelfde
  amplitude en fase bij de nieuwe frequentie (`_coef`). Geldt ook voor buigen en fijn.
- **De kern** staat op de grondtoon van wat je hoort (`toon()` = `deck.toonsoort` van de
  maatgever, rond D3 via `stemming()`; zonder toonsoort de laatste, nooit terug naar D), in
  dezelfde stemming als de noten: A440 + de cent van de plaat (`toonsoort.cent`, met de
  pitch erbij, begrensd op ±50 zoals de globale schaal; VRAGEN S7) + FIJN. De cent gaat
  mee in de `fijn` van het `param`-bericht (op alles: kern en velden), pas bij een halve
  cent verschil; zonder toonsoort blijft de laatste. Hij zingt als
  je wrijft, en klinkt mee met noten die binnen 2% op zijn boventonen vallen (zoals
  `_meeresoneer`). Het lichaam klopt zacht mee met elke noot.
- **Tijd**: elk bericht heeft een `tijd` op de audioklok; de kern zet ze in een vaste,
  gesorteerde rij en past ze toe op hun sample (`blok()` rendert tot dat moment). De klok
  in de worklet is `currentFrame / sampleRate` (de getter `currentTime` maakt elk blok een
  getal-object).

| Plek | Knop | Bereik (0 · standaard · 1) | Wat |
|---|---|---|---|
| 1 | karakter | handpan · **10% schaal** · schaal | zoals de klankschaal (KAR) |
| 2 | uitklank | 2,7 s · **4,3 s** · 6,1 s | t60 van een veld (× 0,4..× 2, UIT); het getal hangt af van karakter en klank |
| 3 | kracht | 0 · **70%** · 100% | hoe hard de stok bij snelheid 1 (KRACHT): luidheid, klop en glijden |
| 4 | klank | **brons** · kristal · glas · gong | vier standen |
| 5 | fijn | −50 ct · **0 ct** · +50 ct | op alles (FIJN), om bij een plaat te stemmen |
| 6 | slag | midden · **30% rand** · rand | waar je slaat: rand = minder grondtoon, meer boventoon, kortere klop |
| 7 | loslaten | vrij · **1,9 s** · 120 ms | wat noteOff doet: vrij (onder 0,02) = laten klinken zoals een handpan, anders dempen tot die t60 |
| 8 | wrijf | **uit** · 100% | de kern zingt zonder toets (de sterkste van wrijf, aftertouch, modwiel telt) |

**Spelen.** Snelheid: (0,25 + 0,75 × kracht) ×
snelheid^1,5, en harder = kortere klop (`ms`) en meer glijden (`pe`). Aftertouch (kanaal of
per toets) en modwiel = wrijven (stokdruk 0,15 + 0,55 × w). Pitchbend ± 200 cent op de
notenvelden, niet op de kern. Pedaal: noteOff wacht. Is niets meer vast (geen toets, geen
pedaal, niet wrijven), dan gaan ook kern en lichaam los (met dezelfde t60). `stil()`: de
uitgang in 10 ms dicht (na `startDrempel`), dan zet de worklet alles op nul en gooit de rij
weg, 0,1 s later weer open: wat in die 0,1 s gespeeld wordt klinkt niet.

### 7.3 Metingen (5 okt, Apple M1, Node 26.8.2, Chromium 1243 headless)

| Wat | Uitkomst |
|---|---|
| `node test/instrumenten-fm-schaal.test.mjs` | 140 checks groen |
| FM A4, zonder zweving | +0,10 ct (C2 +1,15, C4 +0,10, C6 +0,10); met 1 Hz zweving het midden op +0,05 ct |
| Schaal A4 (de partial die het dichtst bij 440 Hz ligt) | −0,95 ct (C2 −0,65, C4 −0,85, C6 −0,90): de drift van de Waterschaal (± 0,9 ct); zonder drift 0,00 ct (Node) |
| Begin van de noot (t = 0,1 s) | FM sample 4801 (4800 is de 0 van de helling), Schaal 4800: op de sample |
| Akkoord C4 E4 G4, snelheid 0,8, 3 s, BS.1770 | FM **−14,03 LUFS** (momentaan max −10,8, piek −0,5 dBFS) → `OPHOGING` 0,55; Schaal **−13,93 LUFS** (drie keer, spreiding 0,67 LU door de hand; momentaan max −8,0, piek +0,9 dBFS) → `OPHOGING` 2,73 |
| noteOff op 0,6 s | FM: −25 → −33 → −61 dB, vanaf 3,2 s exact 0; Schaal: −23 → −37 → −60 dB, vanaf 5,5 s exact 0 (de kern slaapt) |
| Zestien noten op snelheid 1 (stemroof) | eindig, piek +6,9 / +7,0 dBFS (de limiter van de master) |
| Twee schaal-tracks in één AudioContext, naast de globale klankschaal | één keer laden, eigen worklets; B exact 0 als alleen A speelt |
| Worklet, 3000 blokken, tien velden en wrijven | 0 GC, ~0,2–3,5 kB (één getal-object per blok zou 48 kB zijn) |
| Idem met een noot per 25 blokken | 0 GC, 0,3–0,7 kB per noot (per bericht, AUDIOPAD "Wat blijft") |
| Rekentijd schaal per blok (128 frames, alles aan) | ~0,19 ms (van 2,67) |

### 7.4 Niet getest, of Clay's oren nodig

- **Niemand heeft het gehoord.** Vooral: de standaarden (FM aanslag 8 ms en release 1,2 s
  waar Glass 280 ms en 4,5 s had; schaal loslaten 1,9 s), de luidheid (−14 LUFS geeft bij
  beide pieken rond 0 dBFS; een volle aanslag of een groot akkoord gaat erboven en de
  limiter van de master pakt het), de pan op toonhoogte (FM ± 0,35, schaal ± 0,5) en de klop
  van het lichaam onder elke noot (op de toon van de kern).
- **Live stemroof bij de schaal**: de staart van het gestolen veld gaat mee in de nieuwe
  toon (geen tik, wel even zijn klank). Pas bij een elfde noot binnen ~4 s.
- **De cent van de plaat** (S7, gebouwd 5 okt): de Schaal volgt hem nu, zoals de globale
  klankschaal. Nog niet beluisterd: een plaat die 43 cent hoog staat, en de Schaal erop.
- Op een echte track (de API van §6 bestond nog niet), met de Xboard49 (toets → geluid),
  in een realtime AudioContext naast acht streamende decks: alleen offline gemeten.

### 7.5 Raakvlak met het spoor instrumenten

`index.js` heeft nu één import en één regel per instrument, de lijst over meerdere regels
(`FM,` en `SCHAAL,`) zodat `POLY,` er als eigen regel bij kan; de importregels en de
lijstregels zullen bij het samenvoegen wel naast elkaar botsen (triviaal). CLAUDE.md: de
regels voor `instrumenten/…` staan onder `koptelefoon.js`. Geen andere gedeelde bestanden.

## 8. Drums (`drums`, gebouwd 5 okt)

`src/engine/instrumenten/drums.js`, definitie `DRUMS` (soort `drums`, naam `Drums`), in
`INSTRUMENTEN`. Een drumcomputer: zestien pads, per aanslag één stem met native nodes,
geen worklet. Test: `test/instrumenten-drums.test.mjs` (Node, nep-Web Audio met een
tijdlijn per AudioParam); in Chrome gemeten met `tools/headless/drums.mjs`.

### Pads

Pad 1 = noot 36, linksonder op de Maschine, per rij van vier naar boven. Elke andere
noot valt erop terug: pad = (noot − 36) mod 16 + 1 (noot 52 = pad 1, 35 = pad 16).

```
 13  14  15  16        (noot 48–51)   pads 9–16: leeg, laadPad()   ← sampler-pad 1–4 (sampler.N.drums)
  9  10  11  12        (noot 44–47)                                 ← sampler-pad 5–8
  5   6   7   8        (noot 40–43)   TOM   RIM   BAS   HAT OPEN
  1   2   3   4        (noot 36–39)   KICK  SNARE CLAP  HAT
```

De hats staan boven elkaar (4 en 8): één vinger kapt de open hat af.

| Pad | Noot | Geluid | Herkomst | Niveau | Pan |
|---|---|---|---|---|---|
| 1 | 36 | KICK: sinus 130 → 48 Hz, tik | Elektronlearn | 1 | 0 |
| 2 | 37 | SNARE: toon 186 Hz + ruis (hoogdoorlaat) | Elektronlearn | 0,8 | 0 |
| 3 | 38 | CLAP: drie ruisstoten 11 ms uit elkaar + staart, ~1–3 kHz | nieuw | 0,95 | 0 |
| 4 | 39 | HAT: ruis, hoogdoorlaat, 16 ms | Elektronlearn | 0,5 | +0,15 |
| 5 | 40 | TOM: sinus 180 → 120 Hz (fase opgeteld) + tikje ruis | nieuw | 0,45 | −0,15 |
| 6 | 41 | RIM: 420 Hz + ruis, 20 ms | Elektronlearn | 0,9 | −0,2 |
| 7 | 42 | BAS: twee zagen op A1 (55 Hz) met een sluitend filter | Elektronlearn (BASS) | 0,7 | 0 |
| 8 | 43 | HAT OPEN: dezelfde ruis, staart 130 ms | Elektronlearn | 0,3 | +0,15 |

De kit wordt bij `start()` gerekend op `ctx.sampleRate` (~18 ms voor alle acht), met de
formules van Elektronlearn's `sounds.js` en hetzelfde zaad (`mulberry32(0x5eed)`): bit voor
bit wat Elektronlearn maakt, behalve een fade van 5 ms aan het einde (de kick hield op
−35 dB op: een tik). Geen sample-bestanden. STAB en SWEEP uit Elektronlearn zitten er niet
in. Niveau en pan mengen de kit onderling (gemeten per slag, zie onder).

### Pads 9–16

- `laadPad(pad, buffer, naam?)` → `true`/`false`. Alleen pad 9..16. De pad krijgt een KOPIE
  (hooguit twee kanalen, eigen sampleRate) met 2 ms in- en 5 ms uitfade: een stuk uit een
  nummer begint en eindigt zelden op 0. Zonder naam heet hij `PAD n`.
- `wisPad(pad)` → `true` als er iets op stond; wat er nog klinkt fadet weg (6 ms).
- Een lege pad (of de kit vóór `start()`) is stil en gooit niet.
- `stand().pads` = `[{ pad, noot, naam, gevuld, kit }]` (extra naast het contract).

### Uit de sampler (crossover, 10 okt)

**Een knip uit de sampler krijgt een eigen strip**: fader, filter, echo, galm, fx en
koptelefoon. `sampler.N.drums` zet sampler-pad N als drumpad op de Drums, op **dezelfde
fysieke pad** als in de padmodus sampler van de Maschine (docs/MASCHINE.md §5f): wat je
in SAMPLING op pad 13 knipt, sla je in de speelmodus op pad 13 aan. Het stuk speelt
one-shot door de strip van die track en in een patroon op zijn noot. De sampler-pad
blijft staan.

| sampler-pad | drumpad | noot | Maschine-pad (SAMPLING én spelen) | schermklavier (vanaf C3) |
|---|---|---|---|---|
| S1–S4 | 13–16 | 48–51 (C3–D#3) | bovenste rij | ja |
| S5–S8 | 9–12 | 44–47 (G#2–B2) | tweede rij | een octaaf omlaag |

De tabel staat in `src/control/drumpads.js` (`DRUMPAD_VAN_SAMPLER`, her-exporteerd door
`actions.js`); de engine blijft neutraal: `engine.samplerNaarDrums(n, { pad })`, met `pad`
verplicht (zonder: "geen drumpad gekozen"; buiten 9–16: geweigerd, 1–8 is de kit).

- **Welke Drums** (`engine.drumsDoel()`): de **speeltrack** (waar het toetsenbord en de
  speelmodus van de Maschine spelen: de focus, anders de laatst gefocuste instrumenttrack,
  anders de eerste track met een instrument) als die de Drums heeft; anders de enige
  track met de Drums. Geweigerd alleen als de speeltrack een ander instrument is en er
  twee of meer Drums zijn: "meer dan één Drums (track 7 en 8): zet de focus op de track
  die je bedoelt". De melding noemt altijd de track. Let op: je knipt met de focus op het
  nummer, dus met twee Drums beslist de speeltrack zonder dat je de focus verzet. Drums op
  7 en 8 en nooit een instrumenttrack gefocust: track 7 (de eerste); na focus op 8 en
  terug naar het nummer: track 8. Zo landt het stuk altijd waar noot 48 aankomt.
- **De melding** zegt wat je moet weten: `S1 staat op drumpad 13 van track 8 (noot C3 · 48)`,
  plus ` · stems: drums` als niet alle stems in de knip zaten (de stand van de stems bij
  het knippen: `gewichten` en `stemNamen` op de sampler-pad), en een tempowaarschuwing
  als het stuk meer dan 0,5 % van de maat afwijkt: `let op: dit stuk is 124 bpm, de maat
  staat op 128: als drumpad speelt het op 124 (loops blijven in de sampler)`.
- **Tempo**: een drumpad speelt het stuk op het tempo waarop het geknipt is (snelheid 1,
  one-shot). **Drumpads voor slagen en stukjes; loops blijven in de sampler** (die volgt
  het tempo). Rekenvoorbeeld met Clay's knips (2–4 tellen op 174 en 146 bpm, 0,69–1,64 s):
  bij de mediane tempowisseling in de library (1,43 %) is een knip van 4 tellen ~20 ms te
  lang of te kort per aanslag; een knip van 4 tellen op 174 is in een set op 146 265 ms
  korter dan de maat.
- **Lampje**: fel violet = er ligt een stuk op drumpad P (niet per se de knip van nu: na
  een nieuwe knip op S1 blijft het fel, maar drumpad 13 houdt het oude stuk tot je opnieuw
  `1→13` drukt), donker violet = kan, uit = kan niet (sampler-pad leeg of geen Drums).
- **Niet bewaard**: na herladen zijn 9–16 leeg. Gebruikt een patroon ze (een noot die op
  9–16 valt, ook via de terugval mod 16), dan zegt `herstelInstrumenten` het: "track N: de
  patronen gebruiken drumpads 9–16, en die zijn na herladen leeg; stonden er stukken uit
  de sampler op, zet ze dan terug met de knoppen 1→13 … 8→12 onder de sampler (of je
  gekoppelde knop); bewaren komt later". De voorwaarde staat erin omdat de set niet weet
  of er ooit iets op lag: een patroon op noot 60 (= drumpad 9) zonder crossover speelde daar
  altijd al stil. Bewaren is stap 2.
- **Leegmaken** is er niet: een nieuwe `sampler.N.drums` overschrijft (`wisPad` blijft in
  de engine, voor als je het mist).
- **Terugspelen**: `sampler.N.drums` staat wel in het log, maar terugspelen slaat hem over
  (`OVERSLAAN`): de instrumenten zelf staan niet in het log, dus hij zou de drumpads van nu
  overschrijven met een stuk dat er toen misschien niet lag (docs/HANDELINGENLOG.md).
- **Naar Logic** (nog niet gebouwd; komt met produceren-uit): in een MIDI-export komen
  noten 44–51 aan zonder het stuk; een GM-drumkit speelt er iets anders op (44 =
  pedaal-hihat). De padnaam (`S1 · track 2`) hoort dan in de meta, de audio bij de
  stems-stap.

**Koppelen**: MIDI (bovenbalk) → filter "drumpad" → leer → druk de knop. Of met de muis:
de acht knoppen `1→13 … 8→12` onder de sampler-pads (ook in de koppelmodus: klik
"koppelen", dan de knop, dan de controller). Geen vaste APC- of Maschine-knop (huisregel:
geen nieuwe controllerfuncties vóór de proefavond).

**Gemeten** in Chrome (`node tools/headless/sampler-drums.mjs`, OfflineAudioContext, de hele
engine): hetzelfde signaal als dat stuk op een deck met dezelfde strip (correlatie 0,9994),
bij snelheid 1 en NIVEAU 0,8 +2,1 dB (bij 0,8: −0,8 dB); fader 0 = −70 dB; in een patroon
elke aanslag op de tel van de maatgever (afwijking 0,000 ms), ook als de maat op 128 staat
en het stuk op 124 geknipt is (het stuk blijft dan 124: niet uitgerekt); `laadPad` van
90 s kost ~3 ms; met de fader van de drumtrack dicht en PFL aan staat het stuk in de
koptelefoon (kanaal 3/4, −24 dB) en is de zaal stil (−97 dB). Op het scherm (1440 × 900 en
de laptopmaat 1440 × 790): de knoppen passen als derde regel onder de pads (+26 px, de pads
even breed, het focusdeel scrolt niet, ook niet met de rijen instrument en patronen open),
een muisklik op `1→13` werkt, de koppelmodus ziet de knop.

**Testen**: `node test/sampler-drums.test.mjs` (zonder DOM: de tabel, de actions, de
melding, welke Drums, de lampjes, terugspelen, na herladen, de knoppen in `index.html`),
`node test/maschine-sampler.test.mjs` (dezelfde fysieke pad) en de headless hierboven.

**Niet getest**: niet gehoord, niet op de Maschine of de APC, niet realtime (alleen
`OfflineAudioContext`); de bron was de demotrack via `laadGeheugen`, niet een gestreamd
library-nummer (`StreamBron.knip`); niet gemeten met echte stems (de stems-tekst is
alleen in Node getest, met de echte `deck.knipGewichten` en `STEM_STANDEN`); de koptelefoon
alleen in een 4-kanaals OfflineAudioContext, niet op het samengestelde apparaat; het scherm
alleen op 1440 × 900 en 1440 × 790 (met en zonder videopaneel en de rijen instrument en
patronen), niet op de iPad (de knoppen zijn 20 px hoog, klein om aan te raken). Onder
790 px hoog (review 10 okt, headless gemeten, niet op een echt apparaat): op 1180 × 740 met
een rij open loopt de pagina 34 px over de rand in plaats van 8 px (de knoppen kosten 26 px);
op 1280 × 720 zonder rij vallen de knoppen net onder de rand; op 1024 breed met het
videopaneel open past het opschrift `1→13` niet. Dat zijn bestaande grenzen van de layout.

### De stem

`bron (AudioBufferSourceNode) → [WaveShaper bij DRIVE] → laagdoorlaat → versterking →
StereoPanner → uitgang (NIVEAU)`. De nodes bestaan per aanslag en gaan los bij `onended`.

- **Snelheid → niveau**: v^1,5 (0,8 = −2,9 dB, 0,5 = −9 dB). Een mono-bron door de panner
  krijgt ×√2 (equal power geeft op het midden −3 dB per kant): mono en stereo zijn op het
  midden even luid, in Chrome gemeten.
- **Mono per pad**: een nieuwe aanslag kapt de vorige van dezelfde pad af (zoals een
  drumcomputer; ook voor de stukken op 9–16). **Choke**: de twee hats zijn één groep, de
  gesloten hat kapt de open hat af (en andersom). Alleen stemmen die eerder beginnen.
- **Afkappen** (choke, zelfde pad, stemroof: 6 ms; `stil()`: 12 ms): vasthouden en lineair
  naar precies 0, op zijn vroegst na `startDrempel`. Het beginpunt zet `_kap` zelf met de
  waarde uit de punten van de stem: `cancelAndHoldAtTime` zet alleen een punt als hij een
  helling doorsnijdt, en anders begint de helling bij het VORIGE punt. In Chrome gemeten:
  de open hat zakte zo al vanaf zijn aanslag weg. De mock in de test doet het nu ook zo.
- **Stemroof**: hooguit 12 stemmen; de oudste die nog klinkt gaat weg.
- **Plannen**: `noteOn(noot, snelheid, t)` start op `t` (audioklok), sample-exact; `t`
  weggelaten of voorbij = nu.
- `noteOff`, `alleUit`, `houd`, `druk`, `mod`: doen niets (een drumgeluid klinkt uit).
  `buig` = ±2 halve tonen, ook op wat klinkt.
- KICK/SNARE/HATS rekenen het geluid opnieuw, maar pas bij de volgende aanslag op die pad
  (een kick kost ~3 ms; bij elke knopstap zou dat 300 ms per seconde draaien zijn).

### Parameters

| Plek | Id | Label | Standaard | Wat | Geldt |
|---|---|---|---|---|---|
| 1 | `toon` | TOON | 0,5 | alles ±12 hele halve tonen (playbackRate) | ook wat klinkt (glijdt 10 ms) |
| 2 | `decay` | DECAY | 1 = vol | hoe lang een aanslag hooguit klinkt: 30 ms … 3 s, bovenste 2% = het hele geluid; vasthouden 30%, dan in acht lineaire stukken naar 0 | volgende aanslag |
| 3 | `filter` | FILTER | 1 = open | laagdoorlaat 50 Hz … 24 kHz, Q 1 dB; open = Nyquist (Chrome geeft dan door) | ook wat klinkt |
| 4 | `drive` | DRIVE | 0 = uit | tanh, 16 trappen, vóór het filter; ongeveer even luid (kleine signalen omhoog, pieken omlaag) | volgende aanslag |
| 5 | `kick` | KICK | 0,5 = 48 Hz | toon van de kick ±7 halve tonen (opnieuw gerekend, de staart blijft) | volgende kick |
| 6 | `snare` | SNARE | 0,5 | vel ↔ snaar: 0 = alleen de toon, 1 = alleen de ruis (0,5 = Elektronlearn) | volgende snare |
| 7 | `hats` | HATS | 0,5 = 550 ms | staart van beide hats ×0,35 … ×2,86 | volgende hat |
| 8 | `niveau` | NIVEAU | 0,8 = 0 dB | uitgang, `faderGain` (zoals VOL van de klankschaal) × `UIT_OPHOGING` | meteen (20 ms) |

Op de device knobs (2 × 4): boven klank voor alles, onder per geluid en het niveau.

### Gemeten (Chrome, OfflineAudioContext 48 kHz, `tools/headless/drums.mjs`, 28 checks)

- **Luidheid** (BS.1770): een maat vier-op-de-vloer op 124 bpm (kick op elke tel, snare op
  2 en 4, gesloten hat op elke achtste ertussen), snelheid 0,8: zonder ophoging −25,1
  LUFS, dus `UIT_OPHOGING` = 3,6 → **−14,0 LUFS**. De maat piekt op +3,5 dBFS (kick en
  snare vallen samen); de limiter van de master vangt dat. Met DRIVE 1: −13,0 LUFS, piek −2,9.
- **Per slag** (snelheid 0,8, piek / luidste 400 ms): KICK −1,5 dBFS / −14,6 LUFS · SNARE
  −3,4 / −15,9 · CLAP −2,0 / −16,8 · HAT −6,6 / −23,3 · TOM −7,5 / −17,1 · RIM −1,3 / −23,5 ·
  BAS −4,6 / −15,5 · HAT OPEN −11,1 / −19,2. Alle eindig, piek ≤ 1.
- **Spectrum**: kick 97% van zijn energie onder 120 Hz; hat en open hat 83% boven 5 kHz.
- **Choke**: de open hat is tot de gesloten hat precies zichzelf, daarna 6 ms de open hat
  maal een lineaire helling (afwijking 3·10⁻⁸), en daarna precies 0.
- **stil()** (via `suspend`): tot het houdpunt gelijk, dan lineair in 12 ms naar 0, ook
  midden in een DECAY-helling (afwijking 6·10⁻⁹); een geplande snare klinkt nooit.
- **Plannen**: een kick op t = 12345/48000 begint op sample 12 345, ook met het filter
  dicht. Op een halve sample: de volgende hele. Met DRIVE: 1 sample later (de 2x
  oversampling van de WaveShaper).

### Niet getest, of wat Clay's oren nodig heeft

- De mix van de kit (niveau en pan per pad) is gezet op gemeten luidheid per slag, niet op
  het gehoor. Kort spul (RIM, HAT) meet laag in vensters van 400 ms.
- De CLAP en de TOM zijn nieuw; de rest klinkt zoals in Elektronlearn (de kick zakt even
  onder 48 Hz en komt terug: zo staat het daar ook).
- BAS staat op A: past niet bij elk nummer (TOON verschuift alles, niet alleen de bas).
- De pieken boven 0 dBFS bij −14 LUFS: de master-limiter knijpt op 2 en 4. Liever iets
  zachter (en minder pomp)? Dan `UIT_OPHOGING` omlaag.
- Niet op een echte track (de track-kant bouwt een ander spoor), niet realtime, niet met
  de Maschine.
