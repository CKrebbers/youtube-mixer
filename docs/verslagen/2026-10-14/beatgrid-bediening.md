# Beatgrid gelijkzetten: de bediening (14 oktober 2026)

Spoor `afmaken/beatgrid-bediening`. Vraag van Clay: *"Alles eerst is het belangrijk dat het
op de juiste manier met de controllers werkt. Ik merkte dat het op veel punten erg laggy was.
Verder moet de beatgrid ook beter. Probeer hem volledig af te maken en geef opties voor een
volgende versie. Laat me het bewijs zien."*

Dit spoor ging over de BEDIENING van het grid: hoe snel en hoe zeker je een fout grid
rechtzet op de APC (grid-modus, Shift + Metronome), en of je daarna zeker weet dat het
klopt. De analyse (welk grid er binnenkomt) was een ander spoor, het algemene invoer- en
uitvoerpad van de controllers ook. De volledige uitleg staat in `docs/BEATGRID.md` §12 en
`docs/APC40.md` "Grid-modus: gelijkzetten en controleren".

## De focuspunten in één oogopslag

1. **Vast (pin) kon stil fout gaan.** Lag het grid meer dan een halve tel uit de pas, dan koos
   vast de buurtel, zette het tempo de verkeerde kant op en meldde "vastgezet". Nu telt vast
   op de klappen. *Was: 0,58 s naast aan het eind van het nummer; nu: exact.*
2. **Een bewerking ging verloren als je het nummer opnieuw laadde.** De library-rij kende
   het nieuwe grid niet. *Was: track 2 kreeg 124,33 bpm terwijl track 1 op 248,65 stond;
   nu: hetzelfde.*
3. **↶ zette niet precies terug** (het voorstel van de analyse werd "met de hand").
4. **Op de APC ontbraken ↶, de "1" verschuiven, tellen gelijk zonder de "1", en het
   controleren.** Dat zit er nu op, met een lampje dat zegt of het klopt.
5. **Lag**: de grid-actions zelf zijn snel (0,01–0,05 ms). Wat traag was: bewaren (een timer
   van 1,5 s), en de weergave die bij elke encodertik een uur aan tellen opnieuw mat.

## Wat ik mat, en hoe je het herhaalt

Alles hieronder komt uit deze commando's (in de worktree; `<basis>` = een checkout van
`studio/afmaken` vóór dit spoor, commit `7debab6`):

```
node test/grid-bediening.test.mjs                                        # nameting (en de test)
VARVE_WORTEL=<basis> VARVE_GRID_UIT=voor.json node test/grid-bediening.test.mjs   # nulmeting
VARVE_CHROME=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell \
  node tools/headless/grid-bediening.mjs na.json                        # echte server + app
VARVE_WORTEL=<basis> VARVE_CHROME=… node tools/headless/grid-bediening.mjs voor.json
```

`test/grid-bediening.test.mjs`: een plaat van 6 minuten op 124,317 bpm, een bekend fout
grid, en een "gebruiker" die MIDI-berichten stuurt op de standaardmapping (de echte Mapping,
Lagen, engine op de Web Audio-mock en de LED-laag) zodra hij de klap hoort, 12 ms te laat. Na
de route wordt elke tel van het nummer nagelopen: ≤ 2 ms, tempo ≤ 0,01%, elke "1" goed,
zeker. Een route die een knop nodig heeft die op de basis niet op de APC zit, staat als
"niet op de APC". Drukken tellen "grid-modus aan" mee (dus 2 = grid-modus + één knop).

### Scenario's: vóór en na

| fout | route op de APC | vóór | na |
|---|---|---|---|
| octaaf: grid op de helft | ×2 (scene 2) | 2, goed | 2, goed |
| octaaf: grid op het dubbele | ½ (scene 3), op tel 3 ingedrukt | 2, goed | 2, goed |
| "1" een tel verschoven | tel 1 hier op een echte "1" (snapt) | 2, goed | 2, goed |
| | idem ZONDER klappen (ambient) | 2, fout (12 ms naast) | 2, fout (12 ms naast) |
| | ← 1 (Device ◀), waar dan ook | niet op de APC | **2, goed** (ook zonder klappen) |
| fase 12 ms naast | nudge −5 −5 −1 −1 | 5, goed | 5, goed |
| | tel 1 hier op een "1" | 2, goed | 2, goed |
| | tellen hier (Clip/Device View) op elke tel | niet op de APC | **2, goed** |
| fase 47 ms naast | nudge 9× −5, 2× −1 | 12, goed | 12, goed |
| | nudge −5 vasthouden, dan 2× −1 | 4, fout (40 ms naast) | **4, goed** (830 ms vastgehouden) |
| | tellen hier op een tel | niet op de APC | **2, goed** |
| tempo 0,1% naast (0,7 tel na 6 min) | encoder +0,1, +0,01 ×3 | 1 + 4 tikken, fout (5 ms) | idem: de resolutie van 0,01 |
| | vast op 2:30 | 2, goed | 2, goed |
| | vast pas op 5:00 (0,63 tel uit de pas) | **2, fout (579 ms, "1" fout)** | **2, goed** |
| | idem ZONDER klappen | 2, fout | 2, fout, maar nu met "LET OP" in de melding |
| tempowissel op 3:00 (124,317 → 128) | nieuw stuk, tel 1 hier, vast 8 tellen later | 4, goed | 4, goed |
| geen grid | 8× tap, tel 1 hier, vast | 11, goed | 11, goed |
| op slot maar fout (+20 ms, "1" op tel 2) | tel 1 hier op een "1" | 2, goed | 2, goed |
| | tellen hier + ← 1 | niet op de APC | 3, goed |
| klopt, maar de analyse twijfelt | Lock | 2, goed | 2, goed |
| | ✓ klopt (Shift + On/Off) | niet op de APC | 2, goed |

### Rond de scenario's

| wat | vóór | na |
|---|---|---|
| ↶ op de APC | niet (alleen scherm/Cmd+Z) | Detail View in de grid-modus |
| ↶ zet precies terug (een voorstel `bron: 'auto'`, uit de tellen, met twijfel) | nee: `bron` werd `'hand'` | ja |
| lampje scene 1 bij twijfel / als het klopt | wit / wit | **oranje** / wit |
| de controletik volgt een bewerking | bij de volgende timertik (≤ 30 ms) | in dezelfde taak |
| na een bewerking herankerd: sampler, echo-bus, de tel van het deck | ja | ja (ongewijzigd) |
| onzeker: sync, beat-loop, beatjump weigeren met een melding | 3 van 3 | 3 van 3 |
| na ✓: sync en beat-loop mogen | ja (via de bus) | ja (ook op de APC) |
| vast zonder klappen ver uit de pas: waarschuwing | nee | "LET OP … controleer met de tik" |
| MIDI → grid per knop, mediaan / p95 (Node, CPU) | 0,012–0,054 / ≤ 0,21 ms | 0,003–0,049 / ≤ 0,13 ms |
| druk → POST (Node, nep-fetch) | timer van 1500 ms: 0–1500 | 250 ms |
| draaien aan de bpm, 30 tikken/s, met de tellen van een uur: metingen in 3 s | 91 | 20 |
| … rekenen voor de weergave per seconde (twee runs) | 154–310 ms | 36–49 ms |

### In echte Chrome tegen de echte server (`tools/headless/grid-bediening.mjs`)

| wat | vóór | na |
|---|---|---|
| druk → server heeft het grid (6 keer, verspreid over de 1,5 s van de oude timer) | 849 · 714 · 380 · 103 · 1263 · 932 ms, gemiddeld **707** | 282 · 271 · 426 · 280 · 259 · 263 ms, gemiddeld **297** (een eerdere run: 279) |
| hetzelfde nummer daarna op track 2 | **124,33 bpm** (het grid van vóór de bewerking; track 1 stond op 248,65) | 248,65: hetzelfde |
| daarna nog een bewerking op track 1: volgt track 2? | nee | ja |
| één gridversie (bewerken + meetGrid) met de tellen van een uur | 5,66 ms mediaan | 5,66 ms (dat is meetGrid zelf; het gaat nu minder vaak) |

Beeldduren heb ik NIET gemeten: in deze container met software-rendering duurt elk beeld
van de app al ~300 ms, ook in rust. Dat getal zegt niets over een Mac.

## De oorzaken

1. **Vast koos de buurtel.** `Beatgrid.pin` rondde het aantal tellen sinds het anker af en
   weigerde alleen boven 0,4 tel naast. Een grid 0,1% te traag ligt na 620 tellen 0,63 tel
   achter, dus 0,37 tel vóór de VOLGENDE tel: dat leek binnen de marge, pin telde 619, het
   tempo ging van 124,19 naar 124,12 (de plaat is 124,317) en de melding zei "vastgezet".
2. **De library-rij werd niet bijgewerkt na het bewaren** (`laden.js` deed dat wel voor de
   toonsoort, `zetToon`, niet voor het grid). Laden gebruikt `track.grid` uit die rij.
3. **`gridTerug` liep via `gridGewijzigd()`**, en dat zet `bron = 'hand'` (bedoeld voor een
   bewerking, niet voor terugzetten).
4. **Bewaren op een timer van 1,5 s**: een bewerking stond gemiddeld 0,75 s alleen op het deck.
5. **De weergave mat elke versie**: het oordeel naast de bpm vroeg elke frame `gridMeting`, en
   die meet opnieuw zodra `gridVersie` verandert, dus bij elke encodertik (een uur aan tellen:
   ~5,7 ms in Chrome).
6. **De APC miste knoppen in de grid-modus** voor ↶, de "1" verschuiven, controleren en ✓;
   en "tellen gelijkleggen zonder de "1" te verzetten" bestond nergens (alleen "tel 1 hier",
   die op de "1" moet).

## Wat ik veranderde

- `src/engine/beatgrid.js`: `pin(t, { klappen })` telt op de klappen (n−1, n, n+1; ≥ 50% raak
  binnen 15 ms en 25 procentpunt beter, anders het oude gedrag), `geteld` in de uitkomst.
- `src/engine/deck.js`: `gridTerug` precies; `gridMetingBij(nu)` voor de weergave (hooguit eens
  per 150 ms opnieuw meten tijdens een reeks, als het aantal stukken en de tellen gelijk blijven).
- `src/engine/grid-klik.js`: opnieuw plannen op de 'change' van het deck.
- `src/control/actions.js`: `track.N.grid.align` (nieuw, tellen hier); nudge met herhalen
  (`HERHAAL_NA` 350, `HERHAAL_ELKE` 60, `HERHAAL_MAX` 200); pin met klappen en de LET OP-melding;
  de read van `grid.here` in rust = het oordeel (0 / 0,5).
- `src/control/feedback.js`: één regel in `KLEURSCHEMA` (`.grid.here` half = oranje) en `align` bij de andere gridknoppen.
- `mappings/apc40mk2.json`: 8 regels in `edit.aan` (710 regels), `tools/mapping/eerder.mjs` gedraaid.
- `src/ui/apc-beschrijf.js`: uitleg voor align, controle, ok, check.next/prev (en het lampje van tel 1 hier).
- `src/ui/grid-bewaren.js` (nieuw): bewaren 250 ms na een bewerking, elke seconde tijdens een lange reeks;
  `laden.js` gebruikt hem en werkt daarna de library-rij (`library.zetGrid`, nieuw) en andere tracks met
  hetzelfde nummer bij (alleen als die zelf niets bewerkten).
- `index.html`: knop ≡ (tellen hier) naast "1"; de tooltips noemen de APC-knoppen.
- Tests: `test/grid-bediening.test.mjs` (nieuw, 16 checks over 21 routes), `test/beatgrid.test.mjs` (pin met klappen, 5
  checks), `test/mapping.test.mjs` (de acht nieuwe sleutels in de "niets bestaands veranderd"-checks).
- Docs: `docs/BEATGRID.md` §12, `docs/APC40.md`, één alinea in CLAUDE.md (Beatgrid).

## Wat ik niet veranderde

- `meetGrid` zelf (analyse-spoor): hij gaat nu alleen minder vaak.
- De LED-tik (33 ms) en het invoerpad (mapping, hub): het spoor van de controllers.
- De bpm-encoder (0,01 per tik, shift 0,1): exact komt het tempo met vast.
- Geen ringknop voor de bpm: de device knobs geven 127 stappen per slag, over 40–300 bpm is dat
  2 bpm per tik.
- Geen Maschine-pagina voor het grid (zie de opties): op de APC was het meest te winnen.
- Geen toetsenbord-sneltoetsen voor het grid erbij (alleen Cmd+Z bestond al).

## Alleen op de hardware te bevestigen

- Of oranje en wit op scene 1 in het donker goed te onderscheiden zijn (paletindex 9 en wit).
- Of vasthouden van Nudge lekker voelt (350 ms wachten, dan 83 ms per seconde schuiven).
- Of de lampjes van Device ◀ ▶, On/Off, Clip/Device View en Detail View in de grid-modus doen wat
  de tabel zegt (eenkleurig; Detail View brandt als er iets terug te zetten is).
- De echte vertraging van USB-MIDI en de LED-tik; hier alleen de CPU-tijd in Node en Chrome.
- Of de klappen (`deck.onsets` van de server) op echte muziek dicht genoeg op de kicks liggen voor
  het tellen in vast (gemeten op een synthetisch klikspoor, en met hi-hats op elke zestiende).

## Opties voor een volgende versie

| optie | kosten | baten |
|---|---|---|
| A. **Maschine-pagina "Grid"**: draaiknop 1 = bpm met 0,001 per tel (de Maschine geeft 1000 tellen per slag), knop 2–3 fase in 1 ms; een padmodus GRID met de knoppen van de APC-grid-modus | ½–1 dag (pagina's, kaart, uitleg, tests) | het tempo exact zonder vast, en alles op het apparaat dat Clay naast de APC heeft |
| B. **Vast op de tellen van Beat This!** (`deck.tellen`) waar geen klappen zijn, en dezelfde telling ook voor "tel 1 hier" (de dichtstbijzijnde gevonden downbeat) | 2–3 u, samen met het analyse-spoor | vast en tel 1 hier ook goed op ambient en live opnames, waar nu de menselijke 12 ms erin blijft |
| C. **De tellen op de pads zien**: in de grid-modus de 8 tellen rond de speelkop op rij 5, kleur = hoe ver de gridlijn van de klap ligt (groen < 5 ms, geel < 15, rood erboven) | ½ dag (een read per pad, kleurschema, mapping, uitleg) | zekerheid zonder naar het scherm te kijken; je ziet drift aankomen voordat je hem hoort |
| D. **Encoder met versnelling**: snel draaien aan Cue Level = grotere stappen (0,01 → 0,1), langzaam fijner dan nu (0,001) | 1–2 u, maar een bestaande knop gedraagt zich anders: eerst vragen | minder tikken, en het tempo exact zonder vast |
| E. **Meten per stuk** (meetGrid alleen opnieuw voor het stuk dat veranderde) | 2 u, in het analyse-spoor | de weergave en de controle altijd vers, zonder de 150 ms van nu, ook op lange live sets |
| F. **Tikken op de tel middelt de fase** (zonder het tempo te veranderen): 4× drukken op de tel = de fase uit het gemiddelde, voor muziek zonder klappen | 2 u | ambient zonder menselijke fout: nu blijft daar 12 ms in |

## Vragen voor Clay

1. In de grid-modus doen Device ◀ ▶, On/Off, Clip/Device View en Detail View nu iets met het grid
   (de "1", controle/✓, tellen hier, ↶). Daar kon je eerst het rack kiezen, het effect aan/uit
   zetten en strip ↔ rack wisselen (de device knobs blijven trim/EQ/sends). Is dat goed, of wil je
   die liever op een andere plek?
2. Staat hetzelfde nummer op twee tracks, dan krijgt de andere track het bewerkte grid ook (als hij
   zelf niets bewerkte), ook als hij in de zaal speelt. Zo hoort het grid bij het nummer; maar wil je
   dat ook midden in een set?
3. Oranje op "tel 1 hier" = twijfel. Is dat genoeg, of wil je bij "geen puls" liever uit of rood?
4. Tap tempo zet na vier tikken het HELE grid op slot (al van vóór dit spoor). Zo laten?
