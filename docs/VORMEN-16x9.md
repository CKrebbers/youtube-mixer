# Vormen 16:9 (ROADMAP 7)

Stand 25 september 2026 (branch `spoor2/vormen`): **alle 26 systemen tekenen
echt 16:9** op een doek van 640 × 360. Er is geen `g.S` meer (de zijde van het
oude vierkant) en geen `rooster(g, getal)`; `vormen.test.mjs` controleert dat.
De basis (doek, API, plaat) kwam uit spoor `vormen-basis`, de omzetting uit
vier sporen (licht, zwaar, meer, isomorf), samengevoegd en nagelopen door de
controleur.

## Clay's keuze (25 sep)

Vormen rond een middelpunt blijven **heel en rond in het midden**: links en
rechts is ruimte, en die is doorzichtig boven de video (de shader trekt de
achtergrond #07090c af). Niets wordt uitgerekt. Twee uitzonderingen gebruiken
de breedte, omdat dat daar natuurlijk is:

- **Harmonograaf (hg)**: de x-slinger zwaait W / H zo ver als de y-slinger
  (16/9 op 640 × 360, `Rx = 0,42 W`, `Ry = 0,42 H`). De figuur vult de breedte;
  een cirkel (a = b) wordt een ellips, dat is afgesproken. Op het scherm is hij
  zo breed als op 24 sep (538 schermpixels van het midden), maar nu heel: toen
  viel boven en onder weg. Zelfde 6000 punten, zelfde rekentijd.
- **Zonnebloem (fy)**: de spiraal loopt door tot in de hoeken, zonder rand
  (een ingezoomde zonnebloem). De rand van de bloem ligt in de hoek (straal =
  halve diagonaal): daar zijn de zaden het grootst en het lichtst, zoals vroeger
  aan de rand. Zaden buiten beeld worden berekend maar niet getekend.
  Dichtheid `DICHT = 0,6` (was 0,46): n zaden op een schijf van 0,6 × de korte
  zijde, dus zaden **30% groter** dan op het oude vierkant (de omzetter schatte
  22%; met de halve zaden langs de rand kwam dat net boven 16/9 uit). Op het
  scherm 27% kleiner dan op 24 sep. Tekenaanroepen op de standaard (1400 zaden)
  ×1,60; over het hele bereik (n 100–3000, zaadgrootte 0,3–2) hooguit 16/9 ×
  het oude vierkant, op een handvol halve zaden na bij n = 100. Met drift
  ontstaan armen met ruimte ertussen, zoals altijd; met de gulden hoek zelf is
  elk punt van het doek binnen 1,6 zaadafstand van een zaad.

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
- In de mixer krijgt een 16:9-laag schaal [1, 1]. `LAAG_FIT` (`video/lagen.js`)
  blijft 'vullen' voor een laag met een andere verhouding (een vierkante vult
  de breedte en verliest boven en onder).

Alternatieven die afvielen: 768 × 432 (27% meer pixels, geen hele factor naar
1280) en 682 × 384 (zelfde oppervlak als 512², maar geen 16:9 en geen hele factor).

## De API

Staat bovenaan `src/vormen/hulp.js`. Kort:

| wat | geeft | voor |
|---|---|---|
| `g.W`, `g.H` | 640, 360 | het doek |
| `g.D` | 1,125 | lijndikte, kleine afstanden (korte zijde / 320) |
| `maten(W, H)` | `{ W, H, D }` | laag.js en tests die zelf een `g` bouwen |
| `clear(g)`, `fade(g, a)` | | het hele doek |
| `cellen(g, n, veelvoud = 1)` | `{ nx, ny, cel }` | rooster met vierkante cellen, evenveel als n × n |
| `rooster(g, { nx, ny })` | `{ nx, ny, c, x, img, px }` (+ `cel` als je `cellen()` doorgeeft) | pixelrooster; een los getal gooit |
| `blit(gr, g, pix, vak?)` | | rooster over het hele doek, of in `vak` `{ x, y, b, h }` |
| `midden(g)` | `{ cx, cy, kort, vak }` | systemen rond een middelpunt |

## Per systeem

"Rooster" = cellen (nx × ny); "×" = tekenaanroepen per stap t.o.v. het oude
vierkant (zaad 7, nep-canvas) of rekentijd waar dat de maat is. De ms zijn
Node-metingen van de omzetters (rekenen zonder echt tekenen), op een drukke
machine; onderling vergelijken.

### Licht (systemen.js)

| id | hoe het 16:9 gebruikt | × |
|---|---|---|
| lz Lorenz | heel in het midden, schaal op de korte zijde | 1,00 |
| hg Harmonograaf | **uitzondering (Clay)**: vult de breedte, zie boven | 1,00 |
| bd Boids | veld: wereld 568,9 × 320 eenheden, 302 boids (even dicht als 170 op 320²). Buren in vakken, bit-gelijk aan alle paren | 1,78 (rekentijd ×1,09) |
| fl Stromingsveld | veld: 3911 deeltjes (even dicht als 2200). Luistert naar `g.kwaliteit`: alleen de eerste n · kwaliteit bewegen en tekenen, even snel | 1,78 |
| sf Superformule | heel in het midden | 1,00 |
| ec Elementaire automaat | rooster 213 × 120 (= 160²), een rij over de breedte | 1,00 |
| cc Cyclische automaat | rooster 171 × 96 (= 128²) | 1,00 |
| km Kuramoto | heel in het midden | 1,00 |
| dp Dubbele slinger | heel in het midden, ophangpunt op 0,42 van de hoogte | 1,00 |
| fy Zonnebloem | **uitzondering (Clay)**: tot in de hoeken, zie boven | 1,60 |

### Zwaar (systemen-zwaar.js)

| id | hoe het 16:9 gebruikt | rekentijd × |
|---|---|---|
| gs Reactie-diffusie | rooster 170 × 96 (= 128²), halve maat 85 × 48 | 0,85–1,0 |
| cl Vreemde attractor | **heel in het midden**: vierkant histogram van 320² in `midden(g).vak` (de baan is begrensd) | 1,02 |
| ln Lenia | rooster 118 × 66 (= 88²), halve maat 59 × 33 met een kernel van precies R / 2 | 1,00 |
| ph Physarum | 284 × 160 cellen (cel = H / 160: schaal en snelheid t.o.v. de hoogte als het oude vierkant), 8875 agents (evenveel per cel) | 1,69 |
| sp Zandhoop | rooster 161 × 91 (oneven: exact midden, symmetrisch). "Vol" als de hoop de ZIJKANT raakt; boven en onder vallen korrels van de rand | 1,0 per stap, ~1,15 per cyclus |

### Middelzwaar (systemen-meer.js)

| id | hoe het 16:9 gebruikt | rekentijd × |
|---|---|---|
| ch Chladni | rooster 341 × 192 (= 256²); de plaat is 16:9, het oude vierkant in het midden, het veld loopt door | 0,90 |
| jl Julia | rooster 240 × 135 (= 180²), hetzelfde stuk complex vlak (4 × 2,25 i.p.v. 3 × 3) | 1,08 |
| ls L-systeem | past in het 16:9-vak (88%), heel in het midden | 0,95 |
| dl Diffusie-aggregatie | rooster 201 × 113 (celmaat van 24 sep). Bodemlijn over de hele breedte | 1,0 |
| lg Logistieke afbeelding | rooster 427 × 240 (= 320²): r over de breedte, x over de hoogte (een grafiek, geen vorm) | 1,00 |
| wv Golfinterferentie | rooster 201 × 113 (= 150²), golflengte in de oude eenheid; het oude beeld in het midden, de golven lopen door | 0,97–1,09 |
| if IFS-varen | **heel in het midden**: vierkant rooster 320² in `midden(g).vak` | 1,02 |

### Beeld = geluid (systemen-isomorf.js)

Het geluid van alle vier is niet veranderd (sample voor sample getest tegen het
oude vierkant); in Varve is het nog nergens aangesloten.

| id | hoe het 16:9 gebruikt | rekentijd × |
|---|---|---|
| sn Trillende snaar | de snaar over de hele breedte (rand 8% van de hoogte), hoogtes op H | 1,00 |
| tv Trommelvlies | het vel blijft ROND (110² in het midden, dezelfde Bessel-modi); daaromheen de lucht | 1,23 |
| ep Epicykels | de figuur heel in het midden; links en rechts de kanalen L (x) en R (y) als golfvorm | 1,35 |
| dw Korrelwolk | beweging in echte eenheden (isotroop), begint over de hele breedte en trekt samen; stroken en toonlijnen over de breedte | 1,02 |

## Bewuste uitzonderingen

Wat niet "veld van rand tot rand" of "vorm heel in het midden" is, en waarom:

- **hg, fy**: gebruiken de breedte (Clay 25 sep, zie boven).
- **cl** (vreemde attractor) en **if** (varen): een begrensde of staande vorm,
  bewust een vierkant rooster in het middenvak. Een breder rooster zou alleen
  lege cellen erbij rekenen. Brede Clifford-attractors (|c| > |d|) zouden met een
  histogram over het hele doek tot ~18% groter kunnen: niet gebouwd.
- **dl, punt**: een ronde DLA-figuur groeit tot 0,45 × de BREEDTE en steekt
  boven en onder buiten beeld (zoals het bijgesneden beeld van 24 sep). Hij
  rekent daarvoor op een bezettingskaart van 201 × 201 en toont de middelste
  113 rijen. Met een kaart even hoog als het beeld groeide er een X.
- **jl**: hetzelfde complexe oppervlak als het oude 3 × 3, dus een hoge
  verzameling valt boven en onder iets weg. Links en rechts soms een donkere,
  zachte rand van ~5–9%: de kleurformule van het origineel maakt |z| > ~1,8
  zwart. Uitzoomen kan met de zoomknop.
- **tv, de lucht**: naast het ronde vel loopt per uitstralende modus (m ≤ 2)
  een golf naar buiten, een slag als front met vier slagen geschiedenis. Een
  beeldkeuze, geen akoestiek (`LUCHT_C`, `LUCHT_FEL`).
- **dw, stereo**: x blijft voor het geluid de fractie van de breedte (buffer en
  panorama). Omdat de wolk niet mee uitrekt, bestrijkt een samengetrokken wolk
  ×0,56 van de breedte: een smaller stereobeeld en een smaller stuk buffer.
  Beeld = geluid; de oude breedte in het geluid zou dat breken.
- **ep, kanalen**: de breedte naast de figuur toont wat de twee oscillatoren
  spelen (een scoop), niet meer van de figuur.
- **ls**: alle vijf vormen zijn smaller dan 16:9, dus heel in het midden; de
  Koch-vlok (breder dan hoog) wordt 15% groter.
- **sp**: "vol" aan de zijkant is een gedragswijziging (vroeger ook aan de
  bovenrand); anders bleef het een cirkel in het midden.
- **ph**: met de standaardknoppen trekt Physarum op den duur samen tot één of
  twee banden, ook op het oude vierkant. Op 16:9 kan zo'n band verticaal lopen,
  met veel donker ernaast. Dat is de fysica met deze knoppen, geen omzetfout.

## g.kwaliteit (budget.js)

Onder budget zakt `g.kwaliteit` (0,25..1). Het beeld wordt grover, de beweging
nooit trager: gs/ln op het halve rooster, ph minder agents, cl/if minder
punten, sp minder omvallers per stap, ch minder bewegende korrels, jl/wv
grotere blokken, tv een kleiner vel en grovere lucht, sn en ep minder punten,
dw één pad per kleurband,
en sinds 16:9 ook **fl** (minder deeltjes; hij kost ×1,78 en regelde eerst niet
mee). dl negeert hem bewust; ls, lg en de andere lichte zijn goedkoop genoeg.

## Omzetrecept (voor een nieuw systeem)

1. **Rond een middelpunt** (attractors, rozetten, slingers, cirkels):
   ```js
   const { cx, cy, kort } = midden(g), R = kort * 0.42;
   const X = cx + x * R, Y = cy + y * R;
   ```
   De vorm blijft HEEL in beeld; de breedte eromheen is ruimte, niet iets om uit
   te rekken. Wil een systeem de breedte echt gebruiken (zoals hg en fy), dan is
   dat een keuze per systeem: eerst voorleggen.
2. **Velden over het hele doek**: x over `g.W`, y over `g.H`; maten van
   elementen (stippen, lijnen) in `g.D`.
3. **320-eenheden** (Boids, Stromingsveld): de wereld is `g.W / g.D` × `g.H / g.D`
   (568,9 × 320). Rondlopen en opnieuw plaatsen per as apart.
4. **Roosters**: `rooster(g, cellen(g, n))`; arrays van `nx * ny`, index
   `y * nx + x`, rondlopen per as. Een halve maat (gs, ln): vol =
   `cellen(g, n, 2)`, half = `{ nx: vol.nx / 2, ny: vol.ny / 2 }`. Een rooster
   dat bewust vierkant blijft: `rooster(g, { nx: n, ny: n })` en
   `blit(gr, g, pix, midden(g).vak)`. `cellen(g, n)` houdt de REKENTIJD gelijk
   (evenveel cellen); op het scherm zijn cellen ~25% kleiner dan in het
   bijgesneden beeld van 24 sep. Even groot als toen is `cellen(g, 0.75 * n)`.
5. **`pointer(s, p, x, y, …, g)`** (x, y in 0..1): per as, `x * nx` en `y * ny`;
   rond een middelpunt in eenheden van de halve korte zijde (anders wordt een
   getekende cirkel een ovaal).
6. **Tests** bouwen een `g` met `maten(LAAG_BREEDTE, LAAG_HOOGTE)` en meten de
   ms per stap op 640 × 360.

## Nalopen met de plaat

```
VARVE_KIJK_POORT=<eigen> VARVE_KIJK_DEBUG=<eigen> node tools/headless/vormen-plaat.mjs <uitmap> [--stappen 180] [--zaad 7] [--kwaliteit 0.25] [--alleen gs,ln]
```
Headless, geen MIDI, eigen server met tijdelijke db (zoals kijk.mjs). Per
systeem `<id>.png` (640 × 360), `plaat.png` en `plaat.json`, en op stdout per
systeem licht%, licht rechts van x = 1,05 H, midden-x en het **x-bereik** van
wat er te zien is. Een vorm heel in het midden heeft midden-x ≈ 0,5 en een
x-bereik van hooguit ~0,56 (de korte zijde); wie de breedte vult ~0,9 of meer.
Een kleine vorm in het midden (lz vroeg in zijn baan, ph als één streng) kan
"vierkant" heten omdat hij rechts van 1,05 H niets heeft: kijk naar midden-x en
de PNG. De classificatie zegt alleen dát er iets staat, niet dat het klopt.

Controle 25 sep (zaad 7): op 3 s alle 26 "16:9"; op kwaliteit 0,25 na 5 s
24 × "16:9", lz en ph "vierkant" om die reden.
