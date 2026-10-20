# Wat Clay's handen doen: wat we nu al weten (zonder de Mac)

Bron: de top-40 en de telling per groep in `docs/HANDEN.md` §4 (27 handelingenlogs,
`set-20260930-001113` … `set-20261010-190959`, 62.282 handelingen), het action-register
(`tools/handen/register.mjs`, 3.251 actions) en de vier standaardmappings. De getallen staan in
`nu.json` (opnieuw maken: `node v2/telling/nu.mjs`). "Genormaliseerd" = zoals
`src/handen/telling.js` telt: `track.3.fader` → `track.N.fader`; de 3.251 ruwe actions zijn
dan 325 genormaliseerde.

## De getallen

| Groep | Handelingen | Aandeel | Actions (genorm.) | Ruw | Op een knop in een standaardmapping | In de top-40 |
|---|---:|---:|---:|---:|---:|---:|
| track (transport/mixer) | 28.089 | 45,1% | 100 | 1.536 | 63 | 14 |
| effecten/sends | 17.359 | 27,9% | 42 | 413 | 8 | 7 |
| video/vormen | 10.619 | 17,1% | 34 | 42 | 21 | 10 |
| overig (xfader, master) | 2.686 | 4,3% | 13 | 27 | 10 | 2 |
| klankschaal | 860 | 1,4% | 16 | 23 | 0 | 2 |
| sampler | 838 | 1,3% | 8 | 36 | 7 | 1 |
| instrument | 629 | 1,0% | 6 | 104 | 4 | 1 |
| stems | 597 | 1,0% | 45 | 360 | 10 | 2 |
| library | 195 | 0,3% | 5 | 5 | 3 | 0 |
| koptelefoon | 178 | 0,3% | 3 | 10 | 3 | 1 |
| mapjes | 128 | 0,2% | 16 | 16 | 16 | 0 |
| patronen | 72 | 0,1% | 16 | 658 | 11 | 0 |
| auto-dj (knoppen) | 32 | 0,05% | 5 | 5 | 5 | 0 |
| beeld (Stroommachine) | 0 | 0 | 14 | 14 | 14 | 0 |
| master (rack, zonder fx) | 0 | 0 | 2 | 2 | 2 | 0 |
| **samen** | **62.282** | | **325** | **3.251** | **177** | **40** |

Mappings: APC 710 regels (156 actions), waarvan 103 regels naar een top-40-action wijzen; fragment
vorm 14 (8); Maschine 73 (56); Xboard 17 (17).

## Conclusies voor v2

1. **De kanaalstrip is het instrument.** Elf actions (fader, filter, fx-knoppen, fx-mix, send A/B,
   laag, hoog, trim, crossfader, master) zijn samen 39.461 handelingen = **63,4%**; fader + filter +
   fx-knoppen alleen al 23.312 = **37,4%**. v2 moet deze elf eerst en foutloos hebben.
2. **Een korte kop, een lange staart.** De top-10 is 71,5%, de top-40 95,9%. De andere **285 van de
   325** genormaliseerde actions (**2.895 van de 3.251** ruwe) zijn samen hooguit 2.576 handelingen
   (4,1%), en elk van hen kwam in 27 logs hooguit 135 keer voor (plek 40).
3. **Beeld is in de praktijk de tweede pijler**: video/vormen = 10.619 handelingen (**17,1%**), meer
   dan alles behalve de kanaalstrip. `video.layer.knob.K` staat op **#3** (5.799), en de vormlagen
   bestaan alleen met `?vormen=1`. In v2 hoort beeld in de kern, niet achter een vlag.
4. **Zes video-effecten zonder plek op een controller** (pixel, trails, grain, mirror, rgb, color)
   zijn samen 3.068 handelingen (**4,9%**): die gaan via het scherm. Verwerk ze in v2 op een vaste
   plek, of meet eerst of het scherm hier juist goed werkt.
5. **De auto-DJ werd gebruikt; zijn knoppen niet.** `auto.*` is 32 handelingen (0,05%), patronen +
   auto-knoppen samen **104 = 0,17%**. Maar wat de automaat zelf stuurt (`*.glide` en
   `track.N.xfade.thru`, src/auto/automaat.js) is **4.890 = 7,9%** van het log. "Weinig knoppen" is
   dus niet "weinig gebruikt", en v2 moet de bron in het log zetten.
6. **Patronen: groot in de code, klein in de handen.** 658 van de 3.251 ruwe actions (**20%**) zijn
   patronen, tegen 72 handelingen (**0,12%**). Stems idem: 360 ruwe actions (11%) tegen 597 handelingen
   (0,96%), en in de top-40 alleen drums, other en de galm op drums. Kandidaten om in v2 kleiner
   (of later) te bouwen.
7. **De standaardmappings zijn vooral leeg gebleven ruimte.** Van de 177 genormaliseerde actions op
   een knop staan er **22 (12%)** in de top-40; van de 710 APC-regels wijzen er **103 (14,5%)** naar
   een top-40-action. De Xboard is het omgekeerde: alle 17 regels (3 actions) in de top-40.
8. **18 van de top-40 hebben geen vaste plek** (10.170 handelingen, **16,3%**): de automaat (4.890),
   video-effecten (3.068), klankschaal (716), stems (684), pitch (658) en seek (154). Dat is wat
   Clay buiten de controllers om doet, of wat niet van zijn hand komt.
9. **De klankschaal heeft nul plekken en toch 860 handelingen (1,4%)**: meer dan sampler (838),
   instrument (629) of stems (597). Een kandidaat voor een plek op een controller in v2.
10. **Laag, niet hoog.** `track.N.low` 1.560 tegen `track.N.high` 135; `mid` haalt de top-40 niet
    (≤ 135). De bas-EQ is een werkknop, de rest van de EQ nauwelijks.
11. **Mapjes worden zelden gewisseld**: 128 handelingen (0,2%) over 27 logs, met indrukken en
    loslaten is dat ~2 wissels per log. De gelaagde APC-indeling (16 mapje-actions, alle 16 op een
    knop) draagt in de praktijk weinig: v2 kan met minder lagen.
12. **Nooit aangeraakt (t/m 10 okt)**: beeld via de Stroommachine (14 actions, alle 14 op de APC) en
    het master-rack (2). Allebei pas 5–6 okt gebouwd, dus maar een paar logs konden ze bevatten.
13. **Knoppen zijn weinig, gebaren veel.** play 166, hotcues 876, focus 279, seek 154: samen 2,4%.
    Een druk is twee regels, één fader-draai tientallen; play 166 is ~83 drukken in 27 logs, ~3 per
    log. Tel in v2 ook GEBAREN (een druk, een draai), niet alleen regels.

## De grens (lees dit voor je iets weggooit)

- **27 logs, 30 sep t/m 10 okt.** Wat daarna kwam (werkruimte S0–S11, 14 okt: precisie, sets,
  tags, de iPad) zit er niet in. Het register kent die actions bovendien niet (docs/HANDEN.md §6).
- **Het log kent geen bron.** Muis, MIDI, toets, de automaat en terugspelen staan er allemaal
  hetzelfde in. "De handen" is hier "de bus"; punt 5 laat zien hoeveel dat scheelt.
- **De top-40 zegt niets over wat erbuiten viel**, behalve de groep: 2.576 handelingen (4,1%)
  zonder naam. Een action die niet in de top-40 staat kan tot 135 keer gebruikt zijn, of nooit.
  "Nooit gebruikt" kan pas met `tel.mjs` op de echte logs.
- **Aantal is geen belang.** Een knop die één keer per avond de set redt telt 2. Een continue knop
  telt per stap. Vergelijk binnen een soort (knoppen met knoppen, faders met faders).
- **Hoe de logs over de avonden verdeeld zijn** staat niet in HANDEN.md: één lange proefavond kan
  de hele telling kleuren. `tel.mjs` geeft per action het aantal logs en avonden.
- De groepen zijn die van `src/handen/telling.js`, met zijn eigenaardigheden: `stem.drums.send.b`
  valt onder effecten/sends, `mixer.*` onder overig, `master.fx.*` onder effecten/sends.

Volgende stap: Clay draait `tel.mjs` op een kopie van alle logs (zie `LEESMIJ.md`); dan worden
punt 2, 6, 7, 11 en 12 harde getallen ("nooit", "in N avonden") in plaats van "onder plek 40".
