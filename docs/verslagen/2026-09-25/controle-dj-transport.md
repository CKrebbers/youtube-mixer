# Controle spoor C (ROADMAP 16a, transport): beatjump, loop in/out/reloop, quantize, starten op de maat

Branch `spoor2/dj-transport-c`, afgesplitst van `spoor2/dj-transport` (a937548). Vijf herstelcommits
erbovenop. De worktree staat aan het eind los (detached). Niets gemerged, niets gepusht.

```
7460034 Meelopen met de maat: een sprong van de wachtende track zelf houdt zijn startmoment
8d2912a Beatjump-lengte: lampje uit op een lege track (B4)
dfda35e Starten op de maat: een wachtende track loopt mee als de tel verschuift
b60e6be Een track die op de maat wacht geeft de maat niet: syncMaster slaat hem over
c23e965 Hotcue met quantize in een loop: de hotcue beslist of de loop blijft, niet de sprong
```

Gewijzigd t.o.v. de bouwer: `src/engine/deck.js`, `src/engine/engine.js`, `src/control/actions.js`,
`test/engine.test.mjs` (235 regels erbij, 27 eruit). Niet aangeraakt: CLAUDE.md, HANDOFF, ROADMAP,
VRAGEN, mappings/apc40mk2.json, stream-kern.js, stream-lezer.js, bron.js.

## Testuitkomst

- `nice -n 10 node test/alles.mjs`: 29 bestanden, 2066 checks. Eén rood: `vormen-meer.test.mjs`,
  "ch: max < 16 ms per stap bij kwaliteit 1" (een tijdmeting onder belasting). Los opnieuw gedraaid:
  groen.
- `engine.test.mjs`: 500 checks, groen. Elke nieuwe check faalt op de code van vóór het herstel
  (nagegaan door de src-wijziging tijdelijk terug te draaien).
- `tools/headless/kijk.mjs` op 8896/9496: helemaal groen. De eerste run faalde alleen omdat de
  genegeerde map `tools/headless/uit/` in de worktree ontbrak (screenshot). Na `mkdir` groen.
- Eigen headless-controle in echte Chromium, met de echte StreamBron en worklet:
  `scratchpad/controle/dj-transport/kijk-transport.mjs`. Daarin een recorder-worklet op de ruwe
  uitgang van het deck, en de demotrack op 124 bpm. Groen:
  - **Klikvrij:** beatloop 4, beatjump + en − in de loop, loop eraf, beatjump zonder loop, loop in,
    loop out, reloop eraf en reloop terug, allemaal tijdens het spelen. De grootste stap rond een
    handeling (±25 ms) was 0,25 (eerste afgeleide) en 0,42 (tweede afgeleide). Elders in de muziek
    was dat 0,27 en 0,55. De demotrack heeft zelf scherpe klappen, dus deze maat is grof. Er is geen
    aanwijzing voor een tik.
  - **Maatgever +3% halverwege het wachten:** T verschoof 21,5 ms. Het eerste geluid kwam 12,8 µs na
    het nieuwe T, minder dan één frame.
  - **Pauze tijdens het wachten:** stil tot na T, ook geen tikje.
  - **Ander nummer laden tijdens het wachten:** stil, en de track speelt daarna niet.
  - Geen fouten in de console.

## Bevindingen

### 1. MIDDEL, hersteld (c23e965): hotcue met quantize in een loop

`_faseDoel` laat de sprong tot een halve tel naast de hotcue landen. `seek()` besliste daarna op het
LANDINGSPUNT of de loop bleef.

- **Hotcue op het loopbegin**, ingedrukt op 0,6 van een tel: de speelkop landde vóór de loop en
  haalde hem eraf. Zonder quantize blijft de loop in dat geval staan.
- **Hotcue op het loopeinde** (net buiten de loop), ingedrukt op 0,8: de speelkop landde erin en
  bleef in de loop hangen, terwijl de hotcue erbuiten ligt.

Herstel: nieuwe hulpfunctie `Deck._naarHotcue(h)`. Ligt de hotcue in de loop, dan
`seek(doel, { binnenLoop: true })`: de sprong vouwt terug, zoals bij reloop. Ligt hij erbuiten, dan
eerst `_verlaatLoop()` (die de loop onthoudt voor reloop). `hotcue()` zelf verandert maar in één
regel; dat is belangrijk voor het samenvoegen, zie hieronder.

Checks: "hotcue op het loopbegin met quantize: de loop blijft…" en "hotcue net buiten de loop…".

### 2. MIDDEL, hersteld (b60e6be): een wachtende track nam de maat over

`syncMaster()` telde een track die op de maat wacht als "spelend". Met een hogere fader werd hij
tot een maat vóór zijn start de maatgever. Gevolgen:

- sync van een derde track ging naar ZIJN tempo: gemeten 125 in plaats van de 120 die je hoort;
- echo-bus en sampler herankerden op zijn klok;
- zijn Track Select knipperde als maatgever;
- een nieuw startende sampler-pad wachtte tot zijn eerste tel (tot een maat).

Herstel: `syncMaster` zoekt eerst tussen de tracks die klinken. Alleen als er niets klinkt, doen
wachtende tracks mee. Zo blijft een keten van play.quant werken als de maatgever stopt.

`Deck._heranker` zet tijdens het wachten een timer op T, hetzelfde patroon als bij een stukgrens.
Op T herankert het deck en meldt het 'change', zodat echo en sampler de nieuwe maatgever volgen.

Checks: "een wachtende track met een hogere fader…", "sync van een andere track gaat naar H…" en
"op dat moment meldt hij 'change'".

### 3. MIDDEL, hersteld (dfda35e en 7460034): het startmoment volgde de maat niet

T lag vast op het moment van drukken. Gemeten afwijkingen:

| wat er tijdens het wachten gebeurt | afwijking van de start |
|---|---|
| pitch van de maatgever +3% halverwege een maat van 120 bpm | 35 ms naast de 1 (mock); 21,5 ms in Chromium bij 124 bpm |
| eigen tempo verzet met sync (rate 1,05), startpunt 0,1 s naast zijn tel | 5 ms; tot 25 ms bij een startpunt verder van de tel |

Herstel: `Engine._volgWachtenden()` draait in `volgMaat`, bij elke 'change'. Zo herankeren de
sampler-pads ook. Daarnaast is er `Deck.herplan(op)`.

Ontwerpkeuzes:

- Hij volgt DEZELFDE tel van de maatgever: de tel die het dichtst bij de geplande ligt. Hij rekent
  dus niet opnieuw "de volgende maat" uit. Mijn eerste versie deed dat wel. In een loop van één tel
  telt de klok door, en dan schoof de start bij elke ronde met een 'change' (bijvoorbeeld de fader
  opendraaien) 500 ms op. Een check vangt dat nu.
- De afstand van het startpunt tot zijn tel ligt vast in TRACKtijd (`naast`). Alleen het eigen
  tempo rekt hem op. Een sprong van de wachtende track zelf (hotcue, beatjump, nudge) houdt dus zijn
  startmoment, zoals de bouwer met `deck.seek` bedoelde.
- Niet meer herplannen als T al binnen `startDrempel` ligt.
- Niet herplannen op een maatgever die stilstaat of zelf wacht, of waarvan het grid onzeker is: dan
  blijft het plan staan.
- Bend telt niet mee, want bend geeft geen 'change'. De sampler doet het net zo.

Checks: "tempo van de maatgever +3%…", "eigen tempo verzet…", "nudge tijdens het wachten…",
"maatgever stopt…" en "maatgever in een loop van één tel…".

### 4. LAAG, hersteld (8d2912a): B4 voor de lengteknoppen

`beatjump.halve/double` lazen ook op een lege track hun index en brandden dan cyaandonker. Nu geven
ze `null`. Er loopt nu een check over alle nieuwe transportlampjes op een lege track.

### Niet hersteld: vragen en grenzen (laag)

- **Beatjump vooruit voorbij het trackeinde** (zonder loop) klemt op het einde, en dan STOPT de
  track (einde). De bouwer koos "zoals een CDJ". Weigeren, zoals bij de loop-'rand', is veiliger
  midden in een set. Vraag voor Clay.
- **Quantize heeft nergens een zichtbare stand:** geen scherm, geen APC. Toets 6 zet hem voor alle
  tracks stil om, en daarna gedragen hotcues en cue zich anders zonder dat je ziet waarom. Voorstel:
  een melding bij omzetten of een indicator bij het scherm. Het staat ook niet op het scherm als een
  in-punt wacht, wat de sprong-lengte is, of dat een track op de maat wacht (alleen het
  play-lampje brandt).
- **shift+Q/P doet op een SPELENDE track nu niets** (vroeger: pauze). Nog een keer shift+Q
  annuleert het wachten niet; Q (play/pauze) doet dat wel. Voor Clay's vingers is dat vooral de
  verandering dat shift+Q niet meer pauzeert.
- **Maatgever in een loop die niet op het grid ligt** (loop in/out zonder quantize), of in een loop
  van 2 tellen buiten het maatbegin: de start valt op een doorgeteld maatbegin. Bij 2 tellen is dat
  een tel (de "3"). Bij een loop naast het grid is het naast de tel: 40 ms gemeten bij 3,23–4,77.
  Er is daar geen echte "1".
- **Cue zetten met quantize, stilstaand in een loop vlak voor het loopeinde:** de cue snapt op het
  loopeinde, dus buiten de loop, en de loop blijft staan. Play speelt dan vanaf het loopbegin.
  Muzikaal is dat hetzelfde; alleen de stand is vreemd.
- **`ctxTimeOf(x)` tijdens het wachten**, voor een x vóór P binnen een loop: dat geeft een tijd vóór
  T, want de formule rekent met de ongeklemde positie. De huidige aanroepers (fxKlok, stukgrens)
  vragen alleen x ≥ P, dus het gebeurt nu niet. Te herstellen door in `ctxTimeOf`
  `max(nu, seg.T)` mee te geven.
- **Beatjump in een loop** controleert `zekerBij(eind)` op het exclusieve loopeinde. Een loop die
  precies op een grens naar een onzeker stuk eindigt, wordt dus geweigerd.
- **De fasemeter van een wachtende track** zwiept, net als die van een stilstaande track (dat deed
  hij al).

### Hotcue-opslag van het library-spoor (samenvoegen)

`git merge-tree` van deze branch met `integratie-r1` geeft twee conflicten:

- **test/engine.test.mjs:** twee blokken achteraan. Beide houden.
- **src/engine/deck.js, `hotcue()`:** de library wil een 'hotcue'-melding bij zetten en wissen; wij
  willen snappen en `_naarHotcue`.

Oplossing voor `hotcue()`:

```js
    const nieuw = this.hotcues[i] === null;
    if (nieuw) this.hotcues[i] = this._snap(this.position);
    else this._naarHotcue(this.hotcues[i]);
    this.emit('change', this);
    if (nieuw) this.emit('hotcue', { i, tijd: this.hotcues[i] });
```

De melding leest `this.hotcues[i]` NA het zetten, dus de gesnapte tijd gaat naar de server. Verder:

- `_snap` klemt op 0..duur, en de server neemt `tijd >= 0` aan;
- `restoreHotcues` neemt `t <= duur` aan en snapt niet opnieuw. Dat is goed: wat bewaard is, blijft
  zoals het gezet is;
- `restoreHotcues`, de `del`-tak met de melding en de rest van de library-kant blijven zoals ze zijn.

Een check hiervoor kan pas na het samenvoegen: 'hotcue' bestaat op deze branch niet. Voorstel voor
de samenvoeger: in de library-check "bewaren bij zetten" quantize aanzetten en controleren dat de
bewaarde tijd de tel is.

## Wat de bouwer goed had (nagelopen)

- **Beatjump:** in tellen (`verschuif`), over stukgrenzen exact, en in een loop schuift de loop mee.
  Het gebeurt in één segment (`start(p, { loop })`), klikvrij via de segmentovergang (gemeten).
  Onzeker weigeren, maar op slot wel. Zonder grid een melding.
- **Loop in/out:** out vóór in doet niets; een loop korter dan 20 ms weigert; out vervangt beat- en
  seconde-loops. Seek buiten de loop verlaat hem en onthoudt hem voor reloop. LOOP_NAAD werkt
  vanzelf. Het in-punt is een vastpunt.
- **De gepland-vlag in de worklet:** klopt, ook bij herplannen (nieuwe T, vroeger of later), pauze en
  laden. De hoofdthread houdt de positie op P tot T (regel 3).
- **Toetsen:** geen conflicten met B/V/M/Slash/Escape of de andere sneltoetsen; {L}/{R} goed
  verdeeld over de linker- en rechterhand. Loslaten gaat naar de action van het indrukken.

## Wat NIET getest is

- **Luisteren door Clay:**
  - beatjump en loops onder de vingers;
  - starten op de maat met echte muziek;
  - herplannen hoorbaar: een verschuiving tot enkele tientallen ms tijdens het wachten is stil,
    maar niet beluisterd.
- **APC:** er zit nog geen mapping op.
- **BufferBron gepland en herplannen:** alleen in de mock (de app gebruikt de StreamBron).
- **Scherm en video tijdens het wachten:** niet bekeken.
- **Bend van de maatgever tijdens het wachten:** bewust niet gevolgd.

## Voorstel CLAUDE.md-tekst (aanvulling op die van de bouwer)

```
  - Wachten op de maat (deck.wacht) telt NIET als klinken: syncMaster kiest eerst uit wat klinkt,
    wachtende tracks alleen als er verder niets klinkt. Op T herankert het deck en meldt 'change'
    (timer in _heranker, zoals bij een stukgrens), zodat echo en sampler de nieuwe maatgever volgen.
  - Een wachtende track loopt mee met de maat (Engine._volgWachtenden, bij elke 'change'): hij
    volgt DEZELFDE tel van de maatgever (dichtstbijzijnde), niet opnieuw "de volgende maat" (in een
    korte loop schoof hij dan elke ronde op). De afstand startpunt–tel blijft in tracktijd (een
    sprong tijdens het wachten houdt het startmoment); eigen tempo rekt hem op. Niet binnen
    startDrempel, niet op een stilstaande/wachtende maatgever, niet bij bend. +3% op de maatgever
    halverwege een maat was 35 ms naast de 1.
  - Hotcue in een loop (quantize): de HOTCUE beslist of de loop blijft (erin: sprong vouwt terug;
    erbuiten: loop eraf), niet het fasebehoudende landingspunt (Deck._naarHotcue).
```
