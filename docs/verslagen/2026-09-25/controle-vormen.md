# Controle ROADMAP 7: alle 26 vormen 16:9 (samenvoeger + controleur)

Branch `spoor2/vormen` (vanaf `spoor/vormen-basis`), worktree staat na afloop
op detached HEAD. Niets naar main, niets gepusht, geen branches/worktrees weg.

## Commits

- `5e09f47` Merge spoor2/vormen-licht
- `de6bb79` Merge spoor2/vormen-zwaar
- `e740a17` Merge spoor2/vormen-meer
- `4f4d252` Merge spoor2/vormen-isomorf (geen conflicten; één keer "stash failed"
  van git zelf, vermoedelijk een gelijktijdige stash-lock van een andere sessie;
  opnieuw geprobeerd, schoon)
- `3aedeaa` Harmonograaf en zonnebloem gebruiken de breedte, fl volgt g.kwaliteit, g.S is weg
- `8e4cfd3` vormen-plaat.mjs meldt het x-bereik; kijk.mjs maakt zijn uitmap
- `a8424dd` docs/VORMEN-16x9.md: alle 26 om, per systeem, Clay's keuze en de uitzonderingen

## Clay's keuze gebouwd

### hg (Harmonograaf)
- `Rx = 0,42 · g.W`, `Ry = 0,42 · g.H` (was beide `0,42 · kort`): de x-slinger
  zwaait W / H zo ver. Figuur x 9–92%, y 9–91% (gemeten over 30 s), heel in beeld.
- Op het scherm even breed als op 24 sep (538 schermpixels vanaf het midden),
  maar nu heel (toen viel boven en onder weg). Zelfde 6000 punten: segmenten op
  het scherm even lang als op 24 sep, dus even glad. Tekenaanroepen ×1,00.
- Test: x-bereik/W ≈ y-bereik/H (±8%), ≥ 75% van de breedte, midden, heel in beeld.

### fy (Zonnebloem)
- De spiraal loopt door tot in de hoeken; de RAND van de bloem ligt in de hoek
  (straal = halve diagonaal): groei (0,4 → 1) en kleur (0,3 → 1) lopen tot daar,
  zoals vroeger tot de rand. Zaden die helemaal buiten beeld vallen worden
  berekend maar niet getekend (lus stopt voorbij de hoeken).
- Dichtheid `DICHT: 0.6` op het systeem (was 0,46): `c = kort · 0,6 / √n`.
  Zaden 30% groter dan op het oude vierkant van 360, 27% kleiner dan op 24 sep
  op het scherm. Gekozen na tellen (scratchpad/controle/fy/tel.mjs):
  - met c = kort/√(πn) (de 22% van de omzetter) was de standaard ×1,81: de halve
    zaden langs de rand tellen mee, dus net boven 16/9;
  - 0,6: standaard ×1,60, n 3000 ×1,59, n 100 met zaadgrootte 2 ×1,79–1,81
    (een paar honderd aanroepen, 16 halve zaden speling in de test);
  - 0,61/0,62 had meer marge, 0,6 is rond en ziet er goed uit (zelf bekeken:
    t = 3 s armen tot in de hoeken, t = 5 s gelijkmatig veld van zaden).
- Beeld: donker, klein zaad in het midden, lichter en groter naar de zijkanten
  en hoeken. Boven de video is het donkere midden bijna doorzichtig.
- Tests: alleen zaden die (deels) in beeld vallen; met de gulden hoek (drift 0)
  geen gat of rand (verste punt 1,60 zaadafstand, grens 1,7); zaden groeien naar
  de hoeken; aanroepen ≤ 16/9 × het oude vierkant over n 100–3000 × zaadgrootte
  0,3–2 × drie tijden; standaard < 16/9. Met drift ontstaan armen met ruimte
  ertussen (tot 5 zaadafstanden bij drift 1): dat is het patroon, geen gat.

## Wat ik verder deed

1. **g.S weg** (niemand gebruikte hem nog; alleen tests pakten hem uit om hem
   weg te laten, en commentaar). `maten()` → `{ W, H, D }`; `rooster(g, getal)`
   gooit een TypeError; `blit` kent geen `gr.oud`. Tests bijgewerkt; nieuwe check
   "geen enkel systeembestand noemt g.S" (ook `{ S } = g`). `tools/bench/vm-bench.cjs`
   heeft een eigen g.S: dat is een losse kopie van het artifact, niet geraakt.
2. **fl volgt g.kwaliteit** (was ×1,78 en regelde niet mee): alleen de eerste
   `round(n · kwaliteit)` deeltjes bewegen, tekenen en worden opnieuw geplaatst;
   de rest ligt stil. Op kwaliteit 1 bit-gelijk aan vroeger. Test: 0,25 → 978 van
   3911 tekenen, 2933 liggen exact stil, snelheid 1,400 = knop op beide.
3. **Determinisme voor alle 26**: hash over elke tekenaanroep (getallen, stijlen,
   pixels van putImageData) over ALLE canvassen van een laag, 20 stappen, twee
   keer zaad 7 → gelijk; bd en cc met zaad 8 → anders. Let op: in de app hangt
   fl (net als de zware) nu van het budget af, dus van de wandklok; de test
   gebruikt `nu: () => 0`.
4. `vormen-plaat.mjs`: kolom x-bereik (licht van waar tot waar); header bijgewerkt.
   `kijk.mjs`: `mkdirSync(uitmap)` (faalde anders pas bij de eerste foto, na alle checks).
5. `docs/VORMEN-16x9.md` herschreven.

## Plaat (zelf bekeken, alle 26 als PNG)

- Zaad 7, 180 stappen, kwaliteit 1: **26 × 16:9**.
  Contactblad: `scratchpad/controle/q1-180/plaat.png`
  (vóór hg/fy: `scratchpad/controle/samengevoegd/plaat.png`).
- Kwaliteit 0,25, 300 stappen: 24 × 16:9; lz ("klein in het midden", x 0,40–0,59,
  vroeg in zijn baan) en ph (één streng links van 1,05 H) heten "vierkant":
  classificatie, geen fout. `scratchpad/controle/q025-300/plaat.png`.
- Geen uitrekken gezien (cirkels van sf/km/tv-vel/ep rond), geen onbedoelde lege
  strook. Wel, bewust en gedocumenteerd: jl heeft links/rechts een zachte donkere
  rand van ~6–9% (x-bereik 0,09–0,91; kleurformule van het origineel, |z| > 1,8
  zwart); cl/if/ls/lz/sf/km/dp/tv-vel/ep-figuur heel in het midden.
- sp: op het moment van "vol" staat een half-afgemaakte lawine stil (asymmetrisch,
  midden-x 0,57); het origineel deed hetzelfde (vergeleken met de voor-plaat).
- Lang (Node, nep-canvas, 30 s, kwaliteit 1 en 0,25; `scratchpad/controle/lang.mjs`):
  geen NaN, niets ontploft (alle bereiken binnen −1%..101%), niets valt stil.
  sp en ep leken stil op 10/20/30 s, maar sp heeft een deterministische cyclus van
  ~5,4 s (vol + 2,5 s pauze) en ep een periode van 10 s: met hashes per halve
  seconde nagelopen, ze bewegen. dl groeit en begint opnieuw.
- De 30-s-plaat in headless heb ik na 3 systemen gestopt (minuten per systeem
  bij load 35–48); de Node-run dekt stilvallen/ontploffen.

## Controle (bevindingen, ernst, stand)

| # | bevinding | ernst | stand |
|---|---|---|---|
| 1 | fl ×1,78 luisterde niet naar g.kwaliteit: budget/noodrem konden niets | middel | gebouwd + test |
| 2 | fy: 22% grotere zaden (schatting) haalt 16/9 niet door randzaden (×1,81) | laag | DICHT 0,6 (×1,60) |
| 3 | kijk.mjs faalde met een nieuwe uitmap na alle checks | laag | hersteld |
| 4 | g.S/rooster(g, getal) nog in hulp.js | opruimen | weg, gooit nu |
| 5 | jl: zachte donkere rand links/rechts bij sommige c | laag, bewust | gedocumenteerd |
| 6 | ch op kwaliteit 0,25: veel minder bedekt (3% i.p.v. 8%): stille korrels tellen niet | info, bestaand ontwerp | niet veranderd |
| 7 | ph eindigt in banden (ook verticaal op 16:9) | info, fysica | gedocumenteerd |
| 8 | ep.pointer kreeg g als zesde argument | info | niemand roept pointer aan in Varve |

Nagelopen en in orde: determinisme met zaad (alle 26), g.kwaliteit 0,25 overal
goedkoper of gelijk (zware/meer/isomorf-tests), ms per stap (vormen-test: bd 0,4,
fl 1,4–3,7, sf 1,5–3,3, hg 1,0–2,0, fy 0,6–1,4 ms; alle lichte < 4 ms), budget.js
ongewijzigd (640 × 360 is kleiner dan 512²), ph 8875 agents ~5,4 ms gem / 6 ms max
in Node (Worker-budget 12 ms; op de hoofdthread-terugval regelt het budget hem
omlaag), werker.js (kies-bericht met breedte/hoogte; werker.test groen), kijk.mjs
groen: Worker-modus, ImageBitmap 640 × 360 niet leeg, als texture gelijk aan het
canvas (vier kwarten), video met en zonder laag rechtop, 16:9-laag en vierkante
laag rechtop tot in de hoeken. CLAUDE.md-regels VORMLAGEN: geen DOM/Math.random/
performance.now in systemen (test), systeemwissel zet de context terug (test),
alleen hulp.js-imports in de extra bestanden.

## Tests

- `vormen.test.mjs` 149 ok, `vormen-zwaar` 86, `vormen-meer` 114, `vormen-isomorf`
  118, `werker.test` 66, `video.test` 52: groen.
- `nice -n 10 node test/alles.mjs` (load 27–36): 29 bestanden, 2079 checks,
  1 ROOD: "tv: max < 16 ms per stap bij kwaliteit 1" (tijdcheck). Het bestand
  opnieuw (load 32): groen (tv gem 3,3 ms, max 9,6 ms).
- Losse runs onder load 34–43: ook ch/jl/dl/if "max < 16 ms" (meer) en tv
  (isomorf) wisselend rood, if max 17,1 ms bij gem 4,2 ms (op 0,25 zelfs 48 ms max
  bij gem 3,3): inplannen, geen rekenwerk. Opnieuw gedraaid: groen. De checks zijn
  NIET losser gemaakt.
- `kijk.mjs` (8891/9491): alles groen.

## Niet getest

- Niets in echte Chrome (alleen headless shell/swiftshader en Node), niets op de
  APC, geen tabblad, niets op de beamer, rekentijd niet op de M1.
- Het geluid van de isomorfe systemen (nergens aangesloten; de omzetter bewees
  sample-gelijkheid).
- Worker-modus alleen kijk.mjs (60 beelden, lagen lz/bd/hg), geen lange sessie
  met alle 26 in de Worker.
- De 30-s-plaat headless (gestopt), alleen de Node-run.

## Voorstel CLAUDE.md (VORMLAGEN)

Het punt "Een vormlaag VULT het beeld (LAAG_FIT ...)" vervangen door:

  - Het doek van een vormlaag is 16:9, 640 × 360 (ROADMAP 7, `LAAG_BREEDTE`/
    `LAAG_HOOGTE` in laag.js): 12% minder pixels dan het oude 512², precies 2×
    naar 1280 × 720, dus de budgetten blijven kloppen. Een 16:9-laag krijgt in de
    mixer schaal [1, 1]; `LAAG_FIT` blijft 'vullen' voor een laag met een andere
    verhouding. g heeft W, H en D (korte zijde / 320: lijnen t.o.v. de vorm even
    dik). g.S bestaat niet meer en `rooster(g, getal)` gooit; vormen.test
    controleert dat geen systeem g.S noemt. API bovenaan hulp.js: maten,
    clear/fade, cellen(g, n) (vierkante cellen, evenveel als n × n: zelfde
    rekentijd), rooster(g, { nx, ny }), blit(gr, g, pix, vak?), midden(g).
  - Clay 25 sep: vormen rond een middelpunt blijven HEEL en ROND in het midden
    (lz, sf, km, dp, cl, ls, if, het vel van tv, de figuur van ep); links en
    rechts is doorzichtig boven de video. Velden en roosters vullen het doek.
    Twee uitzonderingen gebruiken de breedte: hg (de x-slinger zwaait W / H zo
    ver; een cirkel wordt een ellips) en fy (spiraal tot in de hoeken, de rand
    van de bloem in de hoek, `DICHT` 0,6: zaden 30% groter, ≤ 16/9 aanroepen).
    Verder bewust: dl-punt (kaart 201², boven en onder bijgesneden), jl (zelfde
    stuk complex vlak; soms een zachte donkere rand links/rechts), tv (lucht
    naast het ronde vel), ep (kanalen L/R naast de figuur), dw (een
    samengetrokken wolk bestrijkt ×0,56 van buffer en stereobeeld), sp ("vol" aan
    de zijkant). Per systeem: docs/VORMEN-16x9.md.
  - Nalopen: `tools/headless/vormen-plaat.mjs <uitmap> [--kwaliteit 0.25]
    [--alleen ids]` (eigen poorten): PNG per systeem, contactblad, midden-x en
    x-bereik. "vierkant" bij een kleine vorm in het midden is geen fout.

In het punt `g.kwaliteit`: "... ph minder agents; cl/if minder punten; fl minder
deeltjes (sinds 16:9 ×1,78) ..." toevoegen.

In Structuur: `tools/headless/vormen-plaat.mjs` (alle vormen op één plaat) en
`docs/VORMEN-16x9.md`.
