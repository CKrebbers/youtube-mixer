# ROADMAP 22: het audiopad zonder allocaties (renderBlok, 8 decks)

Branch: `spoor2/renderblok` (vanaf `spoor/renderblok`, 47412e4 = de bench van de vorige
agent). Worktree `.claude/worktrees/agent-af90350d5b01a16f7`, aan het eind losgekoppeld
(`git switch --detach`). Niet gemerged, niet gepusht.

## Commits

| commit | onderwerp |
|---|---|
| 8c3a68f | Audiopad zonder afval: renderBlok en de worklet maken per blok niets meer aan (+ test/renderblok.test.mjs) |
| 917c890 | Audiopad sneller: vier buren met één paginaopzoeking, gat-controle onthoudt twee pagina's |
| b656e20 | Bench audiopad: --profiel ook op 60 s, en vindt de ref-bestanden op macOS |
| 277024d | renderBlok: een eerste blok van 0 frames valt niet meer (+ check) |
| 7b6904a | docs/AUDIOPAD.md: waar het afval zat, de regels en de cijfers; tools/README bijgewerkt |

Gewijzigde bestanden: `src/engine/stream-kern.js`, `src/engine/stream-lezer.js`,
`test/renderblok.test.mjs` (nieuw), `tools/bench/renderblok.mjs`, `tools/README.md`,
`docs/AUDIOPAD.md` (nieuw; tools/README verwees er al naar). NIET gewijzigd: CLAUDE.md,
HANDOFF, ROADMAP, VRAGEN, mappings.

## Cijfers (bench, vóór en ná)

`nice -n 10 node --expose-gc tools/bench/renderblok.mjs --sec 60 --rondes 3 --ref 47412e4 --profiel`
Node 26.8.2 (V8 14.6), Apple M1, belasting 28–42 op 8 kernen. 8 decks × 60 s = 180 000
blokken, 239 segmentwissels (loops + naad, seeks, hotcues, tempowissels, pauze, gat, einde).

| | vóór (47412e4) | ná (7b6904a) |
|---|---:|---:|
| uitvoer (FNV-1a over alle bits) | a6c215d9 | a6c215d9 (gelijk) |
| CPU per seconde audio, 8 decks (beste van 3) | 194,0 ms (19,4% kern) | 57,5 ms (5,75%) |
| blokken per seconde CPU | 15 464 | 52 136 |
| per stap (8 decks één blok) p50 | 540 µs | 155 µs |
| afval per blok, hele run incl. opwarmen (v8 total_allocated_bytes) | 12 687 B | 5,2 B (leeg harnas 2,5 B = meetruis) |
| afval in stream-kern/-lezer (heap-profiler) | 12 712 B | 0,4 B (opwarmen van verse processors) |
| kleine GC's tijdens de run | 273 (eerdere run: 548) | 0 |
| stabiele toestand (renderblok.test, 12 000 blokken) | 22 GC's per venster | 256 B totaal = de meting zelf, 0 GC |

Tussenstappen: alleen afvalvrij (8c3a68f) 190 → 116 ms/s (60 s, belasting 17–32);
de snelheidscommit daarbovenop 119 → 58 ms/s (20 s). Eerdere meting vóór bij lagere
belasting: 156,7 ms/s, 548 GC's. p99/max per stap zeggen op deze machine niets (max
~60 ms bij oud én nieuw: andere processen).

Waar het afval zat (profiel op 47412e4, per blok): renderBlok 8 911 B (een array
`[L, R]` per frame + doubles als HeapNumber naar `lees`), `lees` 3 594 B (de double die
hij teruggaf: niet geïnlined, 241 bytes bytecode, over het budget van 920), `process`
153 B (argumentobject per blok), sample/leesSegment 54 B.

## Wat gebouwd, hoe het werkt

renderBlok per blok in drie stappen, zelfde API (`renderBlok({ seg, paginas, uit,
frames, t0, ctxRate, trackRate, duur, vorig, wisselT, staat })`, zelfde returnwaarde):
1. `posities(seg, pos, tot)`: `positieOp(seg, t0 + i / ctxRate)` per frame in een
   Float64Array. De ENIGE aanroep van positieOp in het audiopad, in een eigen lusje
   (daar is hij de enige inline-kandidaat; gecontroleerd met --trace-turbo-inlining).
2. `leesSegment(seg, paginas, S, tot)`: per frame soort (VOORBIJ/GEWOON/NAAD),
   leespositie, en in de naad tweede positie + gewicht; dan `leesKubisch` (exact of
   Catmull-Rom) naar Float64Arrays, in de naad een tweede lezing en de equal-power-menging.
   Voor `vorig` alleen de frames die in de overgang vallen.
3. De framelus in renderBlok: gat-envelop (`staat.env`, nu een lokale die aan het eind
   wordt teruggeschreven) en de overgang met `vorig` (SEGMENT_FADE), dezelfde formules.

Regels (staan als commentaar boven "samples lezen" in stream-kern.js):
- Tussenresultaten in `klad`: vaste Float64Arrays, één set voor alle decks (de worklet
  rendert ze na elkaar), groeit één keer (128 frames in de worklet). Float64 = een
  JS-getal, dus niets afgerond: bit voor bit.
- Hulpfuncties op het hete pad (`leesKubisch`, `leesFrame`, `leesSegment`, `heeftFrame`,
  `heeftPagina`) krijgen alleen objecten en hele getallen, geven niets of een boolean
  terug. Afvalvrij, ook als V8 ze niet inlinet (leesKubisch en leesSegment worden het
  niet, en dat mag).
- Per-blok-doubles (t0, ctxRate, trackRate, duur) als velden op `klad` (NaN-geïnitialiseerd
  zodat het meteen double-velden zijn), niet als argument.
- Worklet: één argumentobject per deck (`this.blok`), elk blok bijgewerkt; `segId` in de
  constructor (vaste vorm).
- Sneller (917c890): de vier cubische buren meestal met één `paginas.get`; de
  gat-controle onthoudt per blok de laatste twee `paginas.has`-antwoorden (gewist bij
  elk blok: berichten komen tussen blokken, elk deck heeft eigen pagina's).

Voor dj-klank (rem): de structuur seg `{ T, P, R, loop, speelt }` is ongewijzigd. Een
versnelling komt in `positieOp`, in de regel `let p = seg.P + (t - seg.T) * seg.R;`
(gedocumenteerd in het JSDoc van positieOp en de kop van stream-kern.js), en als veld
op het segment. renderBlok hoeft dan niet te veranderen (elke positie komt uit
positieOp via `posities()`). Wel nalopen: `ctxTijdVan` (het omgekeerde, nu lineair),
`vooruit` in renderBlok (|R| als bovengrens: klopt zolang het alleen afremt), en de
gouden hash in test/renderblok.test.mjs (zonder rem moet hij blijven).

## Tests

- `nice -n 10 node test/alles.mjs`: 30 bestanden, 1928 checks, alles groen (25 sep 11:37,
  belasting 20–27).
- `test/stream.test.mjs` (bit voor bit tegen ffmpeg): ongewijzigd groen.
- NIEUW `test/renderblok.test.mjs` (5 checks, ~1,3–4,5 s): de echte worklet in een
  nagebouwde AudioWorkletGlobalScope, 8 decks die samen elk pad raken (exact, cubisch,
  loops met naad (kort, krom, vanaf 1 ms), loop tegen een gat aan, voorbij het einde,
  stilstaand).
  1. gouden hash 9dfaeb73 over 3000 blokken mét segmentwissels = de uitvoer van 47412e4
     (gemeten door dezelfde test op de oude kern+worklet te draaien);
  2. trackeinde gemeld;
  3. een eerste blok van 0 frames valt niet (vers module-exemplaar);
  4. stabiele toestand: na opwarmen een venster van 12 000 blokken: gc, heapUsed, draaien,
     heapUsed, `v8.GCProfiler` voor GC's in het venster. Eis 0 GC's en < 1024 B. Geen
     tijd gemeten; is V8 nog niet klaar met optimaliseren, dan telt het volgende venster
     (max 30). Gemeten: 256 B, venster 7.
  5. met ~323 segmentwissels in het venster: ≤ 16 B per bericht + 1 kB; gemeten ~4 B per
     bericht (dat zijn de einde-meldingen).
  Controle dat hij onderscheidt: op de oude code rood (22–25 GC's per venster); met één
  kleine array per blok erin gesmokkeld rood (40 B/blok); zonder de 0-frames-fix rood.
- Fuzz (scratch, niet gecommit: `scratchpad/fuzz2.mjs`): 60 000 willekeurige renderBlok-
  aanroepen oud (47412e4) tegen nieuw, bits + returnwaarde + staat.env: 0 verschillen.
  Met R = 0, negatieve R, lege/negatieve loops, loops vanaf 0 en 1–2 ms, afgekapte
  laatste pagina's, gaten, 44,1 en 48 kHz, blokken van 1–3000 frames, posities vlak vóór
  elke paginagrens en vlak vóór het einde.
- Headless (`tools/headless/kijk.mjs`, VARVE_KIJK_POORT=8864, DEBUG=9464, eigen server en
  tijdelijke db, geen MIDI): alles groen; de demotrack speelt via StreamBron door de
  nieuwe worklet in echte Chromium ("de bas duwt knop 1", 25 klappen, bass-kill werkt).
  Server en Chromium na afloop weg.
- engine.test en regels.test groen (ook los gedraaid).

## Wat NIET getest is

- Niet in Clay's Chrome/Comet met de APC en acht echte decks gehoord of gemeten. De
  afvalvrijheid is gemeten in Node (V8 14.6); Chrome draait een andere V8-versie. Door
  de opzet (geen doubles over functiegrenzen, behalve positieOp in zijn eigen lusje)
  hangt het niet van inline-beslissingen af, maar gemeten in de audiothread van Chrome
  is het niet (dat kan met de DevTools Memory-tab op de worklet, of een performance-trace).
- Geen luistertest: bit-identiek bewezen tegen de oude code, dus er is niets te horen
  dat anders is; tikken door GC in de browser vóór/na niet vergeleken.
- CPU in de browser niet gemeten; de bench-cijfers zijn Node op een zwaar belaste M1.
- Wat Chrome zelf op de audiothread alloceert (outputs-arrays, berichten deserialiseren)
  is buiten beeld.

## Aannames (kunnen verkeerd zijn)

- Dat Chrome's V8 double-velden net zo ter plekke overschrijft en een ingelijfde
  positieOp net zo optimaliseert als Node 26. Zo niet, dan hooguit één HeapNumber per
  frame via positieOp, en de test in Node zou dat niet zien.
- Opwarmen: de eerste honderden blokken na het laden van de worklet draaien in de
  interpreter en maken wél afval. Aangenomen dat een eventuele GC in de eerste seconde
  na het openen acceptabel is.
- Framenummers boven 2^30 (tracks > 6,2 uur) passen niet meer in een Smi; dan kost een
  niet-ingelijfde aanroep met een framenummer weer een object. Nu niet aan de orde (wel
  bij het afspelen van lange opnames, ROADMAP 26 RF64).
- `klad` is gedeeld door alle decks in één AudioWorkletGlobalScope: klopt zolang
  renderBlok niet herintredend wordt aangeroepen (nu nergens).

## Voorstel CLAUDE.md

Structuurlijst, onder `test/`:
```
  renderblok.test.mjs  audiopad zonder afval: echte worklet, 8 decks, gouden hash, heap over 12 000 blokken (0 GC)
```
onder `docs/`:
```
  AUDIOPAD.md       audiopad zonder afval: waar het zat, de regels, cijfers vóór/na
```
en bij `tools/`: `bench/ (renderblok.mjs: CPU en afval van het audiopad)`.

Bij "Bekende grenzen", na de streamkern-punten:
```
- HET AUDIOPAD MAAKT GEEN AFVAL (25 sep 2026, ROADMAP 22, docs/AUDIOPAD.md): een GC
  draait op de audiothread, en daar is een pauze een tik. renderBlok en stream-lezer
  maken per blok niets aan (was 12,7 kB per blok, 273–548 kleine GC's per minuut bij
  acht decks). Regels: tussenresultaten in `klad` (Float64Arrays, gedeeld door alle
  decks, groeit één keer); hulpfuncties op het hete pad krijgen alleen objecten en hele
  getallen en geven niets of een boolean terug (een double over een functiegrens wordt
  een HeapNumber zodra V8 niet inlinet, en dat budget verschilt per versie);
  per-blok-getallen als velden op `klad`; positieOp alleen via `posities()`; de worklet
  hergebruikt één argumentobject per deck. Een rem/versnelling komt ALLEEN in positieOp
  (+ veld op het segment), plus ctxTijdVan en `vooruit` nalopen. test/renderblok.test.mjs
  eist 0 GC's en < 1 kB over 12 000 blokken na opwarmen, en een gouden hash (9dfaeb73)
  van de uitvoer van vóór de ombouw. Wat blijft: per BERICHT (binnenkomend, en 'einde'
  terug), opwarmen na het laden, en tracks > 6,2 uur (framenummer geen Smi meer).
  Bijvangst: 8 decks van 194 naar 57,5 ms CPU per seconde audio (M1).
```
ROADMAP: punt 22 kan op "klaar" (na Clay's eigen luister-/speelsessie met acht decks).

## Voor de volgende (dj-klank)

Begin vanaf `spoor2/renderblok` (7b6904a). Rem = veld op het segment + term in
positieOp (zie het JSDoc daar). Draai daarna `node test/renderblok.test.mjs`: de gouden
hash moet blijven voor segmenten zonder rem, en "0 GC's" moet blijven; zo niet,
`node --expose-gc tools/bench/renderblok.mjs --sec 20 --profiel` zegt waar het zit.
