# Transport-rest: open punten van het dj-transport-spoor afgemaakt

Branch `spoor3/transport-rest`, afgesplitst van `spoor2/dj-transport-c` (7460034). Vier commits,
één per punt. Aan het eind is de worktree losgezet (detached). Niets gemerged, niets gepusht.

```
669d239 ctxTimeOf tijdens het wachten: rekenen vanaf de geplande start, ook in een loop
5be4923 Beatjump voorbij het einde: weigeren met een melding in plaats van stoppen
7e90906 Quantize zichtbaar: een Q in de hoek van Lock, en een melding bij toets 6
99ebed6 Starten op de maat: shift+Q op een spelende of wachtende track pauzeert weer
```

Gewijzigd: `src/control/actions.js`, `feedback.js`, `keyboard.js`, `src/engine/deck.js`,
`stream-kern.js`, `bron.js` (alleen commentaar), `src/ui/spiegel.js`, `apc-beschrijf.js`,
`styles.css`, `index.html` (toetsenkaart), `test/engine.test.mjs`, `test/spiegel.test.mjs`.

Niet aangeraakt: CLAUDE.md, docs/HANDOFF.md, ROADMAP.md, docs/VRAGEN.md,
mappings/apc40mk2.json, stream-lezer.js.

## 1. play.quant op een spelende of wachtende track = pauze (99ebed6)

- `track.N.play.quant` op een track die speelt of op de maat wacht, doet nu `d.pause()`, net als
  play. Pauze annuleerde het wachten al; nog een keer shift+Q tijdens het wachten annuleert dus nu ook.
  Op een stilstaande track: starten op de maat, zoals voorheen.
- Het lampje (B4):
  - 1 = wacht op de maat;
  - **0,5 = speelt** (drukken = pauze). Op de APC is dat `groendonker`: `half` erbij in KLEURSCHEMA;
  - 0 = stil;
  - null = leeg.
  - Vroeger gaf "speelt" null (uit). Dat klopte niet meer, want er is nu wel iets te doen.
- De uitleg in `apc-beschrijf.js` zegt nu: "speelt of wacht hij al: pauze, zoals play; lampje vol
  = wacht, gedimd = speelt". Het label en de toetsenkaart (Q/W en P/O) zijn ook bijgewerkt.
- De toggle zit in de action, zoals `track.N.play` → `togglePlay()`. `engine.startOpDeMaat` blijft
  "starten" en weigert nog steeds op een spelende track.

## 2. Quantize zichtbaar (7e90906)

- **Plek:** een kleine **Q** in de rechterbovenhoek van **Lock**, in het focusdeel (device-knoppen,
  rij 2, knop 2). Daar komt quantize later op de APC. Het element is 15×15 px, met een lettertype
  van 11 px (de regel is labels ≥ 11 px).
  - Uit: dof, met een grijze rand.
  - Aan: vol, in de accentkleur, met een donkere ring. Daardoor blijft hij ook te zien op een
    brandende "slot"-knop in de grid-modus.
- **Positie:** `position:absolute` binnen `.fd-devknoppen`, met
  `top/right: calc(50% + 1,5 px halve gap + 2 px)`.
  - Het is bewust geen extra grid-item: een geplaatst item verschuift de auto-plaatsing van de
    acht APC-knoppen.
  - `spiegel.test` bewaakt dat Lock rij 2, knop 2 is (note 63, "device lock").
  - In de koppelmodus heeft de Q een eigen outline-regel. De gedeelde regel zet
    `position:relative`, en daarmee zou hij uit de hoek springen.
- **Klikbaar:** `data-kind="button" data-action="transport.quantize"`, dus klik = aan/uit. Zo is het
  ook met de muis te bedienen. In de koppelmodus is hij aan te wijzen, dus Clay kan quantize zelf
  op Lock leggen.
  - Het is geen gespiegelde control (geen `data-sig`).
  - Wijst Lock in de mapping zelf naar `transport.quantize`, dan verdwijnt de Q in `herbereken()`.
    Die knop toont het dan al.
- **Renderloop:** de Q leest `s.quantize` uit de snapshot in `spiegel.teken()`. Hij schrijft
  alleen als de stand verandert (data-licht, aria-pressed, title). Headless gemeten:
  - vijf beelden zonder wisseling: 0 mutaties;
  - na toets 6: precies 3 (licht, aria-pressed, title);
  - daarna weer 0.
- **Melding:** alleen bij toets 6 (`MELD_NA` in keyboard.js, info, 5 s):
  - "quantize aan (alle tracks): cue, hotcues en loop in/out op de tel";
  - "quantize uit (alle tracks): cue, hotcues en loop in/out precies waar je drukt".
  - Via de bus (klik op de Q, straks de APC) komt er geen melding, want daar zie je de stand.

## 3. Beatjump voorbij het einde (5be4923)

**Keuze: weigeren, met een melding.** Zonder loop: `doel >= duur` → `{ ok: false, waarom: 'einde' }`.
De melding is "beatjump: dat valt voorbij het einde van het nummer — niet gesprongen". Precies OP
het einde landen telt ook als eindigen.

Motivatie:
- Klemmen op het einde liet de track eindigen en stoppen: midden in een set is dat stilte.
- "Klem op de laatste hele sprong die nog past" helpt niet:
  - de track eindigt dan een tel later alsnog;
  - de sprong is ongemerkt korter dan de lengte die je koos, dus de frase klopt niet meer. Een DJ
    gebruikt beatjump juist om op de frase te blijven.
- Weigeren laat de muziek gewoon doorspelen. Het is dezelfde regel als de loop die buiten het
  nummer zou vallen ('rand'): een beatjump springt precies N tellen, of niet.
- **Voorbij het begin is NIET veranderd:** hij klemt nog op 0 en speelt dan door vanaf het begin.
  Alleen de fase verspringt, zoals op een CDJ. Zie de vragen hieronder.

## 4. ctxTimeOf tijdens het wachten (669d239)

- `ctxTijdVan(seg, x, nu)` rekent nu vanaf `max(nu, seg.T)`. Tot T staat de track stil op P.
- Vroeger liep hij vanaf nu een denkbeeldige positie vóór P terug. Een punt in de loop tussen die
  positie en P kreeg dan een tijd vóór de start. Gemeten in de mock: T − 0,25 in plaats van T + 0,75.
- Na de start (nu ≥ T) is het identiek aan de oude code.
- Een punt achter P buiten de loop geeft een tijd vóór T: daar komt hij niet meer langs. Dat is
  dezelfde betekenis als een punt achter de speelkop, dat een tijd vóór nu geeft. Weigeren (null)
  heb ik niet gedaan: null betekent "staat stil", en fxKlok en `_heranker` rekenen op een getal.
- BufferBron en StreamBron delen deze functie. Alleen het commentaar in bron.js is bijgewerkt.

## Tests

- **engine.test:** 516 checks, groen (was 500).
  - Nieuw: play.quant pauzeert en annuleert (bus en toets shift+Q), lampje 0,5, toets 6 met melding
    en via de bus zonder melding, beatjump voorbij het einde / precies op het einde / wat nog past /
    terug voorbij het begin, ctxTimeOf wachtend in een loop (BufferBron), en ctxTijdVan met een
    gepland segment en rate 1,25 (de formule van de StreamBron).
- **Faalt op de oude code:** de oude `src/` (git archive HEAD) met de nieuwe test geeft 13 FAIL,
  verdeeld over alle vier punten. Eén daarvan, "via de bus geen melding", faalt daar alleen omdat
  de telling erboven al niet klopt.
- **spiegel.test:** +1 check (Lock = rij 2, knop 2), groen.
- **Gericht:** feedback, mapping, learn, regels, beatgrid en stream zijn groen.
- **`nice -n 10 node test/alles.mjs`:** 29 bestanden, 2083 checks. Eén rood: `gridauto.test.mjs`
  ("analyse op de achtergrond duurde 39,6 s", een tijdmeting van de server). Dat gebeurde bij een
  load average van 62–124. Los opnieuw gedraaid: groen. De server is niet aangeraakt. De
  vormen-tijdchecks waren in deze run allemaal groen.
- **Elke commit apart:** de index van elke commit is los getest met `checkout-index` in een kladmap.
  Daarin draaiden engine en, waar het raakte, spiegel, feedback en regels. Groen.
- **Headless, poorten 8916/9516:**
  - `tools/headless/kijk.mjs`: helemaal groen.
  - Eigen proef `scratchpad/controle/rest-transport/kijk-rest.mjs`, in echte Chromium met de
    StreamBron, de worklet en de demotrack. Groen:
    - de Q zit binnen de Lock-cel, rechtsboven, is 11 px, ligt bovenop (klikbaar) en de acht
      knoppen staan nog in hun raster;
    - hij schrijft alleen bij een wisseling (zie punt 2);
    - toets 6 → Q aan plus een melding in de strook; klik op de Q → uit, zonder melding;
    - play.quant: wacht → nog een keer = geannuleerd, spelend → pauze, lampje 0,5;
    - ctxTimeOf wachtend in een loop op de StreamBron: T + 0,75 tel;
    - beatjump 1 s voor het einde: niet gesprongen, speelt door, met een melding;
    - geen consolefouten.
  - Foto's: `q-aan.png` en `q-aan-zoom.png` in die map.
  - Onder deze belasting tekende headless ~1 beeld per 7 s. De proef wacht daarom op
    animatiebeelden, niet op milliseconden.

## Niet getest

- **Clay zelf:**
  - de Q in zijn eigen Chrome: is hij op zaalafstand leesbaar genoeg, en klopt de kleur;
  - shift+Q onder de vingers.
- **APC:**
  - Lock heeft nog geen quantize-regel, want de mapping is niet aangeraakt;
  - het `groendonker`-lampje van play.quant is niet op het apparaat gezien.
- **Focusring:** na een muisklik op de Q en daarna een toets tekent Chrome zijn focusring om de Q.
  Dat is hetzelfde gedrag als bij de andere knoppen.
- **BufferBron in de browser:** alleen in de mock (de app gebruikt de StreamBron).

## Vragen voor Clay

1. **Beatjump terug voorbij het begin:** nu klemt hij op 0 (de track speelt door, de fase
   verspringt). Weigeren kan ook, net als bij het einde, en dat is één regel. Het verschil:
   bij een track die je net inmixt breekt klemmen de beatmatch.
2. **Lampje van beatjump ▶:** moet het uit gaan (null, B4) als de sprong er niet meer in past? Nu
   brandt het en weigert de druk met een melding.
3. **Quantize op Lock:** dat komt pas met "mapping als verschil". Tot dan kan Clay hem zelf leggen:
   koppelmodus, klik de Q, druk op Lock.

## Voorstel CLAUDE.md-tekst (aanvulling op het transport-blok)

```
  - play.quant (shift+Q/P) op een track die speelt of op de maat wacht = pauze, zoals play (nog
    een keer tijdens het wachten annuleert). Lampje: 1 wacht · 0,5 speelt (groendonker) · 0 stil.
  - Quantize heeft op het scherm een Q in de hoek van Lock (focusdeel, spiegel.js .fd-quantize,
    absoluut in de cel: geen grid-item, anders verschuiven de APC-knoppen). Klik = aan/uit; de
    renderloop schrijft alleen bij een wisseling; verdwijnt als Lock in de mapping zelf quantize
    is. Toets 6 meldt de nieuwe stand (keyboard.js MELD_NA); via de bus geen melding.
  - Beatjump zonder loop voorbij (of precies op) het einde: weigeren ('einde') met een melding,
    niet klemmen (dan stopte de track). Voorbij het begin: klemmen op 0.
  - ctxTijdVan rekent vanaf max(nu, T): tijdens het wachten staat hij stil op P, dus een punt in
    de loop vóór P komt na een ronde (niet vóór T).
```

## Samenvoegen

- Mogelijke conflicten met parallelle sporen:
  - `actions.js`: de play.quant-define en `sprongMelding`;
  - `feedback.js`: de KLEURSCHEMA-regel van play.quant;
  - `keyboard.js`: `MELD_NA` en de keydown-regel;
  - `apc-beschrijf.js`: de play.quant-regel;
  - `index.html`: toetsenkaart, drie regels;
  - `styles.css`: de leermodus-regels en `.fd-devknoppen`;
  - `spiegel.js`: het blok met de device-knoppen en `teken()`;
  - `engine.test.mjs`: het transport-blok.
- `stream-kern.js` verandert maar drie regels in `ctxTijdVan`.
- `tools/headless/uit/` is aangemaakt voor kijk.mjs. Die map staat in .gitignore en zit niet in
  de commits.
