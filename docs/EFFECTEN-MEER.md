# Meer effecten en meer mogelijkheden bij het maken (spoor S10, 14 okt 2026)

Clay, 14 okt: *"En maak meer template effecten en voeg ook meer mogelijkheden toe bij het maken
van nieuwe effecten."* Eerder: complete vrijheid ("een werkruimte in plaats van een app") en
effecten met alle combinatieknoppen. De combinaties (worpen, superknoppen, morph, fx-matrix,
bus-racks) bouwde S4. Dit spoor gaat over wat er IN een rack kan, en hoeveel racks er klaarstaan.

Stand van de bouw: zie **Gebouwd** onderaan. Het verslag met metingen staat in
`docs/verslagen/2026-10-14/werk-S10.md`.

## 1. Wat anderen doen, en wat daarvan past

| programma | wat | past hier? |
|---|---|---|
| **Traktor** FX-units, Macro FX | een unit = 3 effecten in serie, of één effect met 3 knoppen; Macro FX = vooraf gemaakte ketens achter één knop | ja: dat is een rack met knoppen; de sjablonen zijn onze Macro FX |
| **Pioneer/Serato** Beat FX, Color FX | Beat FX op de tel (echo, roll, trans, flanger op een deling), Color FX = één knop links/rechts (filter, dub echo, noise, crush, space) | ja: één-knop-sweeps als sjabloon met een bipolaire knop; "trans" = de ducker/tel-gate |
| **Ableton** Audio Effect Racks | ketens parallel (chains), macro's met min/max per doel, "map to macro", randomize macro's | gedeeltelijk: parallel per effect (droog/nat per effect), willekeurig/muteer met zaad. Volledige parallelle ketens NIET (zie §5) |
| **Bitwig** modulators | LFO, stappen, omhullende, random als bron op elke knop, diepte per doel, modulator op modulator | ja, als OFFSET op de knopstand (zoals `zetModulatie` bij de vormen): de knop blijft de basis |
| **Octatrack** scenes | knop tussen twee standen | bestaat al (DICHT/OPEN) |

## 2. Keuzes (genomen, geen vraag voor Clay)

1. **Alles blijft in het rackformaat (schema 1), met optionele velden.** Een rack zonder de nieuwe
   velden laadt en klinkt bit voor bit als gisteren; een nieuw veld dat een oudere versie niet kent
   gaat er ongeschonden weer uit (`schrijfRack` bewaart ook onbekende velden op het hoogste niveau).
2. **Modulators rekenen op de hoofdthread, op de audioklok.** De parameters van een effect hebben
   een niet-lineaire schaling in `zet()` (Hz, ms, dB); een AudioParam rechtstreeks moduleren zou die
   schaling omzeilen (regel 2). Dus: elke 33 ms (dezelfde timer als glijden) de waarde van de
   modulator op `ctx.currentTime` uitrekenen, als OFFSET op de basis (knopstand of eigen stand), en
   alleen doorgeven wat veranderde; het effect glijdt zelf (τ 20 ms). De timer zegt alleen WANNEER,
   de waarde komt van de klok (regel 3). Op de maat via `fxKlok()` van het deck (tel en maat).
   Gevolg: een modulator is een besturing, geen audiosnelheid-LFO. Tot ~8 Hz klinkt het als een
   LFO; sneller wordt het een trap (daarom vrij hooguit 8 Hz). Voor snelle modulatie zijn er de
   effecten zelf (tremolo, autopan, vibrato, chorus).
3. **Een modulator kan naar een parameter, naar een knop (`plek.K`) of naar de diepte van een andere
   modulator (`mod.N.diepte`).** Naar een knop = alles wat die knop doet beweegt mee, met zijn eigen
   bereik en curve. Een knop kan de diepte van een modulator sturen ("hoeveel wiebel").
4. **Een knop kan een andere knop sturen** (link naar `plek.K`), één niveau diep: een knop die door
   een andere wordt gestuurd stuurt zelf geen knoppen door (geen lussen, voorspelbaar). Botsen: de
   hoogste plek wint, zoals bij parameters.
5. **Droog/nat per effect** (`chain[i].meng`, doel `<slot>._nat`): een effect half in de keten.
   Afwezig = de oude bedrading, bit voor bit. Let op: de compressor (6 ms) en pitch (45 ms) lopen
   achter; half nat is dan een kam. Dat staat in de editor bij die effecten.
6. **Eigen kromme** per koppeling (`kromme: [5 punten]`), met de muis te trekken. Gaat voor `curve`.
7. **A/B, willekeurig en muteren met zaad** zijn pure functies in `rack.js` (`muteer`): hetzelfde
   zaad = hetzelfde resultaat. De filterfrequentie raakt muteren niet (een dicht filter is stilte).
8. **Eigen sjablonen** (bewaren vanuit de editor, dupliceren, wissen) gaan naar de server
   (`/api/sjablonen`, `racks/eigen.json`, niet in git), alleen vanaf deze Mac, met versie (409).
   Ze staan in de kiezer achter de kant-en-klare. Bewaren en wissen kan niet van de iPad: het zit niet
   op de bus, en de editor staat alleen in de mixer.
9. **Een sjabloon zegt welke twee knoppen samen op de XY-pad passen** (`xy: [x, y]`). De actions
   `track.N.fx.xy.x/.y` en `master.fx.xy.x/.y` sturen die plekken; een XY-pad op de iPad wijst naar
   die actions en speelt dus bij elk rack de goede twee knoppen. Zonder `xy`: knop 1 en 2.
10. **Zeven nieuwe effecten**, gekozen op licht en meetbaar:
    - **Kam** (resonante kamfilter, worklet): toon 30 Hz–2 kHz, feedback ±, demping, meng. In een
      worklet omdat Chrome een vertraging in een lus op 2,67 ms klemt (dan kan de kam niet boven
      375 Hz). Verzetten van de toon GLIJDT (20 ms): bij een resonator is de toon die meeschuift het
      instrument zelf; bij een echo (delay) was dat de fout. Bewuste uitzondering op de regel van de
      twee koppen.
    - **Klinker** (formant-/vocaalfilter): drie bandpass-filters op de formanten van a-e-i-o-u,
      één knop schuift door de klinkers; reso, verschuiven, meng. Geen lus.
    - **Frequentieschuif** (worklet): Hilbert-paar (Niemitalo, 2 × 4 allpass) en een draaiende fasor;
      −1 kHz … +1 kHz (bipolair), meng. Geen lus.
    - **Band** (tape-saturatie met wow en flutter): twee vibrato-trappen (twee koppen elk) en een
      tanh-vormer met gelijke luidheid; drive, wow, flutter, toon, meng.
    - **Kanteling** (tilt-EQ): lowshelf en highshelf rond een middenfrequentie, ±6 dB elk tegengesteld.
    - **Aanslag** (transient-shaper, worklet): snelle en trage omhullende, aanslag ± en sustain ±
      (±12 dB), gekoppeld stereo, geen vooruitblik (geen latentie).
    - **Duiker** (ducker op de maat): gain duikt op elke tel (deling), herstelt kort/middel/lang,
      diepte. De golf van de LFO van tremolo (`fx-lfo.js`), dus op de tel na elke sprong.
11. **Geen nieuwe APC-regels.** `mappings/*.json` blijft zoals het is. Alles via de bestaande plekken
    (`track.N.fx.knob.K`, `.hold`, `master.fx.*`, de bus-racks).

## 3. Sjablonen (A)

Minstens twintig nieuwe in `racks/sjablonen.json`, voor ambient, house, jungle/dnb, dub en live:
dub-echo, wash-out, opbouw (riser), band die wegzakt, tel-gate per 1/8, Color-FX-achtige
één-knop-sweeps (filter, dub, ruimte, crush, klinker), ruimte-freeze, stem-vriendelijke filters,
master-lijm, en paren voor de XY-pad. Elk sjabloon: `name`, `uitleg`, knoppen met namen, `xy`, een
veilige beginstand (filter open, meng 0 waar dat hoort) en curves op het gehoor. `rack.test` loopt
ze na (zie §6).

## 4. Het formaat (alle velden optioneel)

```json
{
  "schema": 1, "name": "Dub-echo", "uitleg": "…", "xy": [1, 2],
  "chain": [ { "slot": "a", "type": "delay", "params": {…}, "meng": 0.7 }, … ],
  "macros": [ { "place": 1, "label": "Gooi", "links": [
      { "target": "a.feedback", "from": 0.2, "to": 0.9, "kromme": [0, 0.1, 0.3, 0.6, 1] },
      { "target": "plek.3", "from": 0, "to": 1 },
      { "target": "a._nat", "from": 0, "to": 1 },
      { "target": "mod.1.diepte", "from": 0, "to": 1 } ] } ],
  "mods": [ { "soort": "lfo", "vorm": "sinus", "sync": true, "deling": "1/2", "hz": 0.5, "diepte": 1,
      "doelen": [ { "target": "b.freq", "diepte": 0.3 } ] },
    { "soort": "stap", "deling": "1/8", "stappen": [1, 0, 0.5, 0], "glad": 0.2, "doelen": [ … ] },
    { "soort": "volger", "aanzet": 0.01, "verval": 0.3, "gevoel": 0.5, "doelen": [ … ] },
    { "soort": "toeval", "deling": "1/4", "zaad": 7, "glad": 0, "doelen": [ … ] } ]
}
```

- Een doel: `<slot>.<param>`, `<slot>._nat`, `plek.K` (1–8) of `mod.N.diepte` (N vanaf 1).
- Een modulator: waarde −1..1 (lfo, toeval) of 0..1 (stap, volger) × `diepte` × doel-`diepte`
  (−1..1) = offset op de basis (geklemd 0..1). Hooguit vier modulators per rack, acht doelen elk.
- Op de maat: `deling` uit `LFO_DELINGEN` (`4/1` … `1/32`); stappen en toeval tellen vanaf de "1"
  van de maat als de klok die kent (`tellenTotEen`), anders vanaf de tel.

## 5. Niet gebouwd, met reden

- **Volledig parallelle ketens** (twee ketens naast elkaar met elk hun mix): droog/nat per effect
  dekt het meeste (een effect "half erbij"); echte vertakking vraagt een andere bedrading in
  `bouwKeten` en een andere editor. Optie voor een volgende versie.
- **Stutter/grain binnen het rack**: zit dicht tegen beat repeat (deckniveau, niet dit spoor) en vraagt
  de klok in de worklet. Optie.
- **Modulatie op audiosnelheid**: zie keuze 2.

## 6. Bewijs (wat de tests eisen)

- `rack.test`: elk sjabloon (oud en nieuw): elke parameter bestaat, geen parameter op twee knoppen,
  het filter open bij de beginstand, `meng`/MIX op 0 waar nat de beginstand zou kleuren, `xy` wijst naar
  twee bestaande knoppen, elk doel van een modulator bestaat, naam en uitleg. Lezen en schrijven van
  alle nieuwe velden; een onbekende modulator of een onbekend veld blijft bewaard.
- `modulatie.test` (nieuw): de modulators als functie van de klok (vrij, op de maat, na een sprong),
  zaad = zelfde reeks, offset op de basis (knopstand blijft), alleen doorgeven wat verandert,
  knop → knop, knop → diepte, timer alleen zolang er iets te moduleren is.
- `effecten-s10.test` (nieuw): het contract van fx.js voor de zeven, eindig bij elke stand, eenheid =
  `zet()`, lussen met vertraging, inloop, vernietig, de kernen (toon, frequentieschuif, aanslag)
  gemeten, 0 GC per blok.
- `tools/headless/effecten-meer.mjs` (nieuw): in Chrome, OfflineAudioContext: klikvrij (elke knop
  verzetten midden in een toon, effect wisselen), staart (stil na `staart()`), luidheid (beginstand
  vs droog), elke sjabloon in beginstand en open, CPU per effect (acht tegelijk).

## Gebouwd

(zie onderaan dit bestand, bijgewerkt bij het afronden)
