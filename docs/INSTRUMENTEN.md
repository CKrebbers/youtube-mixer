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
| `params` | `[{ id, label, standaard, eenheid? }]`, hooguit 8; plek `k` (1..8) = `params[k-1]`. `standaard` 0..1, `eenheid(v)` → tekst in echte eenheden (zoals `eenheid` in `fx.js`) |
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
  controleren met een proef**; knop 9–16 (CC 31–38) zijn nog vrij.
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

