# Stems — spoor engine (3 okt 2026)

Branch `stems/engine` (vanaf `dfd7ea5`, het contract), worktree
`~/Projects/varve-stems/engine`. Contract: `docs/STEMS.md` §3. Niet gepusht,
niet gemerged.

## Commits

1. `fdab6fc` Stems: streamen met 2, 4 of 8 kanalen
2. `a99b4ad` Stems op het deck: niveau en kill per stem, actions
3. `6a9316d` Auto-DJ: een stem aanraken tijdens een overgang is overnemen
4. `e42969a` Stems: paar 1-3 hergebruiken wat paar 0 al uitrekende; bench met stems
5. (dit verslag)

## Wat gebouwd is

### Streamkern (`stream-kern.js`)
- `renderBlok({ …, stride, paar })`: één stereopaar uit een pagina met 2, 4
  of 8 kanalen per frame. `stride` en `paar` staan per blok op `klad` (hele
  getallen, beginwaarde 2 en 0, geen NaN), net als t0: `leesFrame` en
  `leesKubisch` rekenen `j = frame × stride + paar`. Voor stereo zijn dat
  precies de oude indexen, dus bit voor bit dezelfde uitvoer: de gouden hash
  `9dfaeb73` (renderblok.test) en `a6c215d9` (bench, 60 s) staan.
- `controleerWav` accepteert 2, 4 en 8 kanalen (`KANALEN_TOEGESTAAN`), met een
  reden voor de rest. `bytesPerFrame(kop)` en `UITGANGEN = 4` erbij.
- `hergebruik` (zie "Keuzes"): voor paar 1–3 van hetzelfde blok slaat
  renderBlok over wat niet van het paar afhangt.

### Worklet (`stream-lezer.js`)
- Altijd vier uitgangen van twee kanalen. `{ type: 'bron', duur, sr, kanalen }`
  (ontbreekt kanalen: 2). Per blok paar 0, dan paar 1..(paren−1), elk met een
  eigen `staat`; uitgangen zonder paar elk blok `fill(0)`. 'einde' komt van
  paar 0 (één melding, niet vier). Bij een nieuwe 'bron' lopen de staten van
  alle paren weer in de pas met paar 0.

### StreamBron (`bron.js`)
- `new StreamBron(ctx, uitgang)`: een array van vier nodes (uitgang k →
  uitgang[k]) of één node (alle vier daarheen: de som). De node:
  `numberOfOutputs: 4, outputChannelCount: [2,2,2,2]`.
- Bytes per frame en paginagrootte uit de kop (`bestand.bpf`,
  `bestand.paginaBytes`), `bron.kanalen` (getter, 0 als er niets is).
- `laad({ url, haal, kanalen })`: met `kanalen` (wat de aanroeper verwacht)
  weigert hij een ander aantal met een reden, vóór er iets verandert.
- `knip(van, tot, gewichten)`: bij stems de som van de paren, paar k ×
  `gewichten[k]`; zonder gewichten telt elk paar voor 1; stereo zonder
  gewichten exact als vroeger.

### Kanaalstrip en deck (`audio-graph.js`, `deck.js`)
- `createDeckChain` geeft `stemIn: [g0, g1, g2, g3]`, alle vier naar `trim`
  (vóór de EQ). `chain.input` blijft `trim` (BufferBron).
- `deck.laadStream(url, titel, { haal, stems: { namen, schaal } })`:
  `controleerStems` eerst (2 of 4 namen, precies die van één stand in elke
  volgorde, elk één keer; schaal ontbreekt = 1, anders 0 < schaal ≤ 1), dan
  eist de bron namen × 2 kanalen (zonder stems: 2). Mislukt het: een fout met
  de reden, de oude track blijft (cue, hotcues, stems en hun stand).
- `deck.stems`: `null | { namen, aantal, schaal }` (bevroren).
- Per stem `stemNiveaus` (0..1) en `stemKill`/`stemKillVast` (schakelaar en
  drukknop). Methodes: `stemBestaat`, `stemNiveau` (null als n.v.t.),
  `stemGekild`, `setStemNiveau`, `setStemKill`, `toggleStemKill`,
  `houdStemKill`, `stemVersterking(k)`, `knipGewichten()`, `stemStand()`.
- Versterking van uitgang k precies volgens het contract:
  `(1/schaal) × niveau(n) × kill(n) × (vier en n ≠ vocals ? niveau(inst) × kill(inst) : 1)`,
  kill = 0 of 1. Een uitgang zonder stem (en alles zonder stems): 1.
- `_pasStemsToe`: alleen uitgangen waarvan het doel verandert worden
  aangeraakt. Kill (aan, uit, laden) via `killVersterking` (nieuw in
  audio-graph.js): `zetHellingen` met 33 punten op een zachte S in amplitude,
  5 ms, na `startDrempel`; NOOIT setValueCurveAtTime. Niveau: vasthouden +
  setTargetAtTime (zoals een EQ-knop).
- Bij elke laad (`_naLaden` → `_zetStems`): alle niveaus 1, alle kills
  (schakelaar én drukknop) uit, stems van het nieuwe nummer of null.
- `snapshot()` → `decks[X].stems: null | { namen, niveau: {…}, weg: {…} }`
  voor elke stem die er is (bij vier ook `inst`).
- Sampler: `deck.bron.knip(van, tot, deck.knipGewichten?.() ?? null)`.

### Actions (`actions.js`), uitleg, auto-DJ
- Per track N en s ∈ vocals, inst, drums, bass, other: `track.N.stem.<s>`
  (value, niveau), `.kill` (trigger, schakelaar), `.hold` (trigger, zolang je
  drukt). Read: niveau / 1 = weg, 0 = open; `null` zonder stems of als de stem
  in deze stand niet bestaat. Labels Nederlands; `STEM_LABELS` geëxporteerd
  (zang, rest, drums, bas, overig) voor de ui.
- `apc-beschrijf.js`: uitleg voor alle 15 vormen (kort: "zang", "zang weg",
  "zang weg!").
- `automaat.js`: `stem.(vocals|inst|drums|bass|other)(.kill|.hold)?` in `OVERNEEM`.
- Terugspelen slaat ze niet over (`OVERSLAAN` raakt ze niet, getest), het
  handelingenlog hoort ze via `bijInvoke` (getest). Zie "Nodig van andere
  sporen" voor de beginstand.

### Tests
- `stream.test.mjs` (+34 checks): controleerWav 2/4/8; met 4 en 8 kanalen
  per paar bit voor bit gelijk aan hetzelfde paar als stereobestand in tien
  gevallen (exact, cubisch, paginagrens, loop-naad, loop vanaf 1 ms, gat uit
  en in, rem, overgang, trackeinde met afgekapte pagina); rechtstreeks tegen
  de samples; hergebruik = zelf rekenen, en een paar met een andere envelop
  rekent zelf; de worklet met vier uitgangen (8, 4 en 2 kanalen, vuilnis in
  de ongebruikte uitgangen, één einde); StreamBron met een stems-bestand
  (node, verbindingen, pagina's, geheugen, knip met gewichten, weigeren).
  Een strengere `AudioWorkletNode`-mock voor het hele bestand.
- `renderblok.test.mjs` (+6): het harnas geeft vier uitgangen (zoals Chrome);
  stems-variant: 8 decks × 4 paren met dezelfde berichten, uitgang 0 geeft de
  gouden hash, uitgang 1–3 sample voor sample (R/L, −L/−R, L/L), 38 eindes;
  afval: 0 GC. De klok gaat per set decks terug op 0 (een harnasfout: het
  eerste segment van een tweede set kwam binnen op de klok van de vorige).
- `engine.test.mjs` (+48 checks): dezelfde strenge mock (ook in het bestaande
  streamstuk); zonder stems niets aangeraakt; 4- en 2-stand, inst als groep,
  make-up, de vorm van de kill-overgang (vasthouden, drempel, 32 hellingen,
  S), kill uit midden in de overgang zonder CURVE_BREUK, drukknop/schakelaar,
  snapshot, knipGewichten en een sampler-pad zonder zang, reset bij laden,
  weigeren (kanalen, namen, dubbel, schaal), actions/read/uitleg, terugspelen
  en log.
- `auto.test.mjs` (+3): stem-actions op een track in de overgang = overgenomen.
- `regels.test.mjs` (+2): de worklets importeren alleen hun eigen kern.

`node test/alles.mjs` op `e42969a`: 40 bestanden, 3754 checks, alles groen
(ook vormen-isomorf deze keer).

## Keuzes en afwegingen

- **Altijd vier uitgangen, ook voor stereo.** Dan hoeft de node nooit opnieuw
  gebouwd te worden als een volgend nummer wel stems heeft. Kost: de drie
  stille uitgangen worden elk blok op nul gezet (6 × `fill` van 128 floats per
  deck) en tellen bij trim op. Gemeten ~2–3% bij stereo (binnen de ruis). Ik
  reken NIET op Chrome die uitgangen zelf op nul zet: dat staat niet hard in
  de spec, en vuilnis van een vorig nummer op uitgang 3 hoor je.
- **`hergebruik` (optimalisatie binnen het contract).** Nog steeds één paar per
  renderBlok-aanroep. Wat niet van het paar afhangt (posities, soort, naad,
  en de gat-envelop als het paar met dezelfde stand begon) rekent paar 0, paar
  1–3 gebruiken het uit `klad`. Alleen de worklet zet de vlag, direct na paar 0
  van hetzelfde deck (de audiothread rendert decks na elkaar). Winst: 4 stems
  79,3 → 63,9 ms/s, 2 stems 40,2 → 34,6 (zelfde run, zelfde machine), uitvoer
  bit voor bit gelijk. Wat overblijft is vooral het lezen zelf
  (`leesKubisch` + `leesFrame` ~58% in een profiel): dat is per paar echt werk.
- **Een kill is 0, niet −70 dB.** Een stem-versterking is amplitude; weg is weg.
  De S zit dus direct op de amplitude (bij de EQ op dB, omgerekend).
- **Bij laden ook een S-overgang** (niet hard zetten): laadGeheugen kan binnen
  een paar ms klaar zijn terwijl het vorige nummer nog 4 ms uitvloeit; een
  stem die weg stond zou dan even terugkomen.
- **Ongebruikte uitgangen op 1** (bij twee stems uitgang 2 en 3): de worklet
  zet ze toch op nul; zo is "zonder stems: alles 1" de enige regel.
- **knip met de DOELversterking**, niet met de waarde midden in een overgang:
  deterministisch, en dat is wat je hoort zodra de 5 ms voorbij zijn. Een
  bewaarde pad die later hersteld wordt, knipt met de stand van dat moment
  (na een laad dus alles open).
- **Weigeren in de bron, met een verwacht aantal**, zodat er niets verandert
  (geen 'bron'-bericht, geen nieuwe duur) voordat het aantal klopt.
- **Een stem-action op een track zonder stems doet niets** (read null). De
  auto-DJ neemt een overgang toch over als Clay zo'n knop aanraakt, net als bij
  de EQ-kill: hij raakte de track aan.

## Metingen

`nice -n 10 node --expose-gc tools/bench/renderblok.mjs --sec 60 --rondes 3 --ref fdab6fc --ref-stems`,
Node 26.8.2, Apple M1, belasting 7,8 / 15,1 / 11,9. Acht decks × 60 s =
180 000 deck-blokken, 239 segmentwissels, loops, seeks, tempo, pauze, gat, einde.
Uitgang 0 in alle varianten `a6c215d9` (= AUDIOPAD.md).

| | CPU per s audio (beste van 3) | % van een kern | per deck-blok | per stap (8 decks) p50 / p99 |
|---|---:|---:|---:|---:|
| stereo, vóór stems (`dfd7ea5`, aparte run, 5 rondes) | 19,1 ms | 1,9% | 6,4 µs | 51 / 69 µs |
| stereo, werkmap (zelfde run) | 19,7 ms | 2,0% | 6,6 µs | 52 / 70 µs |
| 2 stems, zonder hergebruik (`fdab6fc`) | 40,2 ms | 4,0% | 13,4 µs | 106 / 226 µs |
| 2 stems, werkmap | 34,6 ms | 3,5% | 11,5 µs | 93 / 124 µs |
| 4 stems, zonder hergebruik (`fdab6fc`) | 79,3 ms | 7,9% | 26,4 µs | 210 / 298 µs |
| 4 stems, werkmap | **63,9 ms** | **6,4%** | 21,3 µs | 169 / 231 µs |

Dus 8 decks × 4 stems ≈ 3,2× stereo, 8 decks × 2 stems ≈ 1,75×. Het budget
van een blok is 2667 µs; 8 × 4 stems gebruikt daar p50 ~6% van. Let op: AUDIOPAD
meldde voor stereo 57,5 ms/s bij belasting 28–42; dezelfde code doet nu 19 ms/s
bij belasting ~10. Absolute getallen hangen sterk van de machine af (een eerdere
run vandaag onder belasting ~34: stereo 64,7, 4 stems 252 ms/s zonder
hergebruik); de verhoudingen binnen één run zijn het cijfer. Stilstaande decks
kosten bijna niets (renderBlok keert meteen terug), dus in een set met twee of
drie spelende decks is het een fractie hiervan.

Afval: `renderblok.test` stems-variant 256 bytes over 12 000 deck-blokken
(× 4 paren) = het object van `memoryUsage()`, 0 GC; met segmentwissels
4,3 bytes per bericht, 0 GC. Stereo onveranderd (0,021 bytes per blok, 0 GC).
Bench: 0 kleine GC's in alle varianten.

Geheugen en netwerk (uitgerekend, niet gemeten in Chrome): een pagina is
PAGINA frames × kanalen × 2 bytes, dus met twee stems ×2 en met vier ×4 per
deck. Een typisch pagina-plan (positie, 20 s vooruit, 5 s terug, vijf
vastpunten) = 35 pagina's: 9,2 MB stereo, 18,4 MB bij twee stems, 36,7 MB bij
vier. Streamen op rate 1: 192 / 384 / 768 kB/s per deck. De eerste
`bijvullen` na een laad haalt tot 24 pagina's: bij vier stems ~25 MB uit
`stems.wav`.

## Niet getest

- **Niet gehoord en niet in echte Chrome gedraaid.** Alles is Node met een
  nagebouwde AudioWorkletGlobalScope en een Web Audio-mock. Niet gezien: een
  AudioWorkletNode met vier uitgangen in Chrome, de echte versterkingen op
  stemIn, of de kill klikvrij klinkt (de vorm is dezelfde als de EQ-kill, die
  in Chrome is gemeten). Geen headless meting gedaan (kijk.mjs-patroon); de
  CPU op de echte audiothread is niet gemeten.
- Geen echte `stems.wav` van de splitter of de nep-splitter geladen (die
  bestaan in het serverspoor); alleen zelfgemaakte WAV's in de tests.
- Geheugen en laadtijd met stems in de app (zie boven: uitgerekend).

## Afwijkingen van het contract

Geen inhoudelijke. Details die het contract niet vastlegde:
- `bron.laad` kreeg `kanalen` (het verwachte aantal); het deck geeft
  `namen × 2` of 2 mee. Zo weigert de bron vóór hij iets verandert.
- renderBlok kreeg naast `stride` en `paar` een optioneel `hergebruik`
  (alleen voor de worklet).
- `knip(van, tot, gewichten)`; de sampler vraagt `deck.knipGewichten()`.
- Ongebruikte uitgangen (bij twee stems) staan op 1.
- `snapshot().stems.niveau` heeft bij vier stems ook `inst`.
- `STEM_LABELS` in actions.js (extra export, voor de ui).

## Nodig van andere sporen

**ui** (laden.js, STEMS-rij):
- Laden: `deck.laadStream(stems.bestand, titel, { stems: { namen, schaal } })`
  (de url zoals bij audio.wav).
  Gooit hij, dan `meld()` met `err.message` en `audio.wav` laden. Redenen die je
  kunt zien: "het bestand heeft 4 kanalen, verwacht 8 (4 stems × 2)", "stems
  vocals, drums: verwacht vocals, inst", "stems: schaal 0 moet tussen 0 en 1
  liggen". (Een mislukte laad stopt het spelende nummer, zoals elke laad.)
- De rij: per stem `read('track.N.stem.<s>')` (null = niet tonen of grijs),
  `track.N.stem.<s>.kill` / `.hold`; welke stems er zijn: `deck.stems.namen`
  of `snapshot().decks[X].stems` (bij vier: ook `inst` als groepsknop).
  Labels: `STEM_LABELS` uit actions.js.

**integratie** (bestanden die niet op een spoor staan):
- `src/control/handelingen.js` `leesStand`: neem `stemKill: { ...d.stemKill }`
  op, zoals `kill` voor de EQ. De stem-kills zijn toggles; een log dat met
  "zang weg" begint speelt nu omgekeerd terug. De niveaus komen er al vanzelf
  in (value-actions in `waarden`), en worden ná het laden gezet (goed: een
  laad zet ze op open).
- `src/control/terugspelen.js` `stand()`: na het laden `d.setStemKill(s, aan)`
  per stem. En overweeg `stem\.` in `NUMMER_NODIG`: stems horen bij het nummer;
  op een track zonder zijn nummer van toen doen ze nu niets (zonder stems) of
  iets op het verkeerde nummer.
- `docs/AUDIOPAD.md`: een alinea stems (de cijfers hierboven, `hergebruik`,
  waarom de ongebruikte uitgangen elk blok op nul gaan).
- `CLAUDE.md` "Bekende grenzen": "Streamen … kan daarom alleen 16-bit PCM
  stereo" klopt niet meer: 16-bit, 2/4/8 kanalen; het geheugen per track ×2/×4
  met stems.
- `tools/README.md`: `renderblok.mjs --stems 2,4` (standaard aan) en `--ref-stems`.
- Een APC-plek voor de stems: eerst VRAGEN (contract).
