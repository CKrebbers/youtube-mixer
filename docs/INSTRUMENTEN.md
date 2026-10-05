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
toetsenbord binnenkomen, het scherm en de APC) legt het spoor "instrumenten" vast in
§6 hieronder, zodra het gebouwd is.

## 6. Op de track (ingevuld door het spoor instrumenten)

*(volgt)*

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
  dezelfde stemming als de noten (A440 + FIJN, niet de cent van de plaat). Hij zingt als
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
- **Kern en de cent van de plaat**: de kern volgt de grondtoon van de maatgever maar staat
  in A440 + fijn. Een plaat die 43 cent hoog staat: FIJN op +43, of moet het instrument de
  stemming van de plaat volgen (zoals de globale klankschaal)? Vraag voor Clay.
- Op een echte track (de API van §6 bestond nog niet), met de Xboard49 (toets → geluid),
  in een realtime AudioContext naast acht streamende decks: alleen offline gemeten.

### 7.5 Raakvlak met het spoor instrumenten

`index.js` heeft nu één import en één regel per instrument, de lijst over meerdere regels
(`FM,` en `SCHAAL,`) zodat `POLY,` er als eigen regel bij kan; de importregels en de
lijstregels zullen bij het samenvoegen wel naast elkaar botsen (triviaal). CLAUDE.md: de
regels voor `instrumenten/…` staan onder `koptelefoon.js`. Geen andere gedeelde bestanden.
