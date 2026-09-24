# Vormen 16:9 (ROADMAP 7): de basis en het omzetrecept

Stand 25 september 2026 (spoor `vormen-basis`): het doek van een vormlaag is
**640 × 360**, `hulp.js` heeft de API, de mixer legt een 16:9-laag 1:1 op het
beeld. **Nog geen systeem is omgezet**: alle 26 tekenen hun oude vierkant links
(`g.S` = `g.H` = 360). Dat is de tussenstand; de plaat laat het zien.

## Waarom 640 × 360

- 230 400 pixels, 12% minder dan 512². Wat met het doek meegroeit (clear/fade,
  blit, de ImageBitmap-kopie in de Worker, de upload naar de GPU) wordt niet
  duurder: de budgetten in `budget.js` (4 ms / 12 ms) blijven kloppen.
- Precies 2× naar het mixerdoek van 1280 × 720 (elke pixel 2 × 2). Van het oude
  vierkant was maar 512 × 288 te zien, 2,5× opgeschaald.
- Precies 16:9 (ggd 40): een rooster met `ny` een veelvoud van 9 heeft exact
  vierkante cellen.
- `g.D` = korte zijde / 320 = 1,125: lijnen zijn t.o.v. de vorm even dik als
  vroeger (512 / 320 op het vierkant).

Alternatieven die afvielen: 768 × 432 (27% meer pixels, geen hele factor naar
1280) en 682 × 384 (zelfde oppervlak als 512², maar geen 16:9 en geen hele factor).

## De API

Staat bovenaan `src/vormen/hulp.js`. Kort:

| wat | geeft | voor |
|---|---|---|
| `g.W`, `g.H` | 640, 360 | het doek |
| `g.D` | 1,125 | lijndikte, kleine afstanden (korte zijde / 320) |
| `g.S` | = `g.H` | VEROUDERD, alleen tot alle systemen om zijn |
| `maten(W, H)` | `{ W, H, D, S }` | laag.js en tests die zelf een `g` bouwen |
| `clear(g)`, `fade(g, a)` | | het hele doek |
| `cellen(g, n, veelvoud = 1)` | `{ nx, ny, cel }` | rooster met vierkante cellen, evenveel als n × n |
| `rooster(g, { nx, ny })` | `{ nx, ny, c, x, img, px }` (+ `cel` als je `cellen()` doorgeeft) | pixelrooster |
| `blit(gr, g, pix, vak?)` | | rooster over het hele doek, of in `vak` `{ x, y, b, h }` |
| `midden(g)` | `{ cx, cy, kort, vak }` | systemen rond een middelpunt |

## Omzetrecept per patroon

1. **Rond een middelpunt** (attractors, rozetten, slingers, cirkels):
   `S / 2` wordt `cx` of `cy`, een straal of schaal `S * f` wordt `kort * f`.
   ```js
   const { cx, cy, kort } = midden(g), R = kort * 0.42;
   const X = cx + x * R, Y = cy + y * R;
   ```
   De vorm blijft HEEL in beeld (op het oude bijgesneden beeld vielen grote
   vormen boven en onder weg); de breedte eromheen is ruimte, niet iets om uit
   te rekken. Wil een systeem de breedte echt gebruiken (meer banen, meer
   deeltjes, een bredere spreiding), dan is dat een keuze per systeem: meld hem.
2. **Velden over het hele doek in S-coördinaten** (golven, lijnen, balken):
   x over `g.W`, y over `g.H`; maten van elementen (stippen, lijnen) in `g.D`.
3. **320-eenheden** (Boids, Stromingsveld): de wereld is `g.W / g.D` × `g.H / g.D`
   (568,9 × 320). Rondlopen en opnieuw plaatsen per as apart.
4. **n × n-roosters**: `rooster(g, N)` wordt `rooster(g, cellen(g, N))`;
   arrays van `nx * ny`, index `y * nx + x`, rondlopen per as. Een halve maat
   (gs, ln): vol = `cellen(g, n, 2)`, half = `{ nx: vol.nx / 2, ny: vol.ny / 2 }`.
   Een rooster dat bewust vierkant blijft (een rond vel): `rooster(g, { nx: n, ny: n })`
   en `blit(gr, g, pix, midden(g).vak)`.
   `cellen(g, n)` houdt de REKENTIJD gelijk (evenveel cellen). Op het scherm
   worden cellen en vlekken daardoor ~25% kleiner dan in het bijgesneden beeld
   van 24 sep (cel 960/n i.p.v. 1280/n schermpixels). Even groot als toen is
   `cellen(g, 0.75 * n)`: 56% van de cellen, dus goedkoper. Standaard is de
   oude n; kies anders per systeem en zeg waarom.
5. **`pointer(s, p, x, y, g)`** (x, y in 0..1): per as, `x * nx` en `y * ny`.
6. **Tests** (vormen-zwaar/-meer/-isomorf bouwen zelf een `g` op een vierkant):
   ```js
   import { maten } from '../src/vormen/hulp.js';
   import { LAAG_BREEDTE, LAAG_HOOGTE } from '../src/vormen/laag.js';
   const canvas = maakCanvas(LAAG_BREEDTE, LAAG_HOOGTE);
   const g = { ctx: canvas.getContext('2d'), ...maten(LAAG_BREEDTE, LAAG_HOOGTE), t: 0, pal: sys.pal, L: LUTS[sys.pal], r: maakRng(zaad), maakCanvas };
   ```
   De ms per stap opnieuw meten op 640 × 360.

## Nalopen met de plaat

```
VARVE_KIJK_POORT=<eigen> VARVE_KIJK_DEBUG=<eigen> node tools/headless/vormen-plaat.mjs <uitmap> --alleen gs,ln
```
Headless, geen MIDI, eigen server met tijdelijke db (zoals kijk.mjs). Per systeem
`<id>.png` (640 × 360), `plaat.png` en `plaat.json`. Een omgezet systeem hoort
"16:9" te zijn (er is licht rechts van x = 1,05 H); een systeem rond het midden
heeft midden-x ≈ 0,5, een niet-omgezet ≈ 0,28. Bekijk de PNG ook zelf: de
classificatie zegt alleen dát er rechts iets staat, niet dat het klopt.
Opties: `--stappen 180` (3 s), `--zaad 7`, `--kwaliteit 0,25..1` (vast, het
budget regelt niet terug).

## Als alle 26 om zijn

- `g.S` uit `maten()`, het getal-geval uit `rooster()` en `gr.oud` uit `blit()`
  halen; de check "verouderd rooster(g, n)" in `vormen.test.mjs` gaat mee weg.
- Een check erbij dat geen `systemen*.js` nog `g.S` noemt.
- De plaat: 26 × "16:9" (of een bewuste uitzondering die in dit document staat).
