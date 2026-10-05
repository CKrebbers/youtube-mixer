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
