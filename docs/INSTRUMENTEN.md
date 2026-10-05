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



## 8. Drums (`drums`, gebouwd 5 okt)

`src/engine/instrumenten/drums.js`, definitie `DRUMS` (soort `drums`, naam `Drums`), in
`INSTRUMENTEN`. Een drumcomputer: zestien pads, per aanslag één stem met native nodes,
geen worklet. Test: `test/instrumenten-drums.test.mjs` (Node, nep-Web Audio met een
tijdlijn per AudioParam); in Chrome gemeten met `tools/headless/drums.mjs`.

### Pads

Pad 1 = noot 36, linksonder op de Maschine, per rij van vier naar boven. Elke andere
noot valt erop terug: pad = (noot − 36) mod 16 + 1 (noot 52 = pad 1, 35 = pad 16).

```
 13  14  15  16        (noot 48–51)   pads 9–16: leeg, laadPad()
  9  10  11  12        (noot 44–47)
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
