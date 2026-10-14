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
6. **Bewaren is robuust** (review ronde 1): elk antwoord gelezen (`leesWeg`, ook bij een fout),
   een hangende POST afgebroken na 5 s, de library-rij ook als de track intussen iets anders
   laadde, en andere tracks met hetzelfde nummer pas na de reeks. *Was: 0 van 3 antwoorden
   gelezen, en één hangende POST = 1 POST in 6 s; nu 3 van 3, en 6 POSTs.*

## Wat ik mat, en hoe je het herhaalt

Alles hieronder komt uit deze commando's (in de worktree; `<basis>` = een checkout van
`studio/afmaken` vóór dit spoor, commit `7debab6`):

```
git worktree add --detach <basis> 7debab6                                # de boom van vóór dit spoor
node test/grid-bediening.test.mjs                                        # nameting (en de test)
VARVE_WORTEL=<basis> VARVE_GRID_UIT=voor.json node test/grid-bediening.test.mjs   # nulmeting
VARVE_CHROME=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell \
  node tools/headless/grid-bediening.mjs na.json                        # echte server + app
VARVE_WORTEL=<basis> VARVE_CHROME=… node tools/headless/grid-bediening.mjs voor.json
node test/grid-bewaren.test.mjs                                          # bewaren op een nep-klok (ronde 1)
git worktree add --detach <tip> 3c6aabf                                  # de tak vóór review ronde 1
node tools/bench/grid-hang.mjs; node tools/bench/grid-hang.mjs <tip>     # één hangende POST: na / vóór
VARVE_WORTEL=<tip> node test/grid-bediening.test.mjs | grep bewaarGelezen   # gelezen antwoorden vóór ronde 1
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
| druk → POST (Node, nep-fetch) | timer van 1500 ms: 0–1500 | 250 ms (gemeten 251–252) |
| antwoorden van de grid-POST gelezen (`bewaarGelezen`) | 0 van 3 (tip `3c6aabf`, vóór ronde 1) | 3 van 3 |
| één POST blijft hangen: POSTs in de 6 s erna, met elke seconde een bewerking (`hang-meting.mjs`, hieronder) | 1 (alles erna blijft liggen) | 6 |
| draaien aan de bpm, 30 tikken/s, met de tellen van een uur: metingen in 3 s | 91 | 20 |
| … rekenen voor de weergave per seconde | 154–310 ms (twee runs) | rond de 50: 37 · 40 · 48 · 70 ms (vier runs) |

### In echte Chrome tegen de echte server (`tools/headless/grid-bediening.mjs`)

| wat | vóór | na |
|---|---|---|
| druk → server heeft het grid (6 keer, verspreid over de 1,5 s van de oude timer) | 849 · 714 · 380 · 103 · 1263 · 932 ms, gemiddeld **707** | na ronde 1: 271 · 134 · 255 · 87 · 258 · 268 ms, gemiddeld **212**, max 271 (eerdere runs: gemiddeld 297 en 279). 250 ms is de bovengrens plus de weg naar de server; waarden eronder (87, 134) komen van het vangnet van 1,5 s dat toevallig eerder was |
| hetzelfde nummer daarna op track 2 | **124,33 bpm** (het grid van vóór de bewerking; track 1 stond op 248,65) | 248,65: hetzelfde |
| daarna nog een bewerking op track 1: volgt track 2? | nee | ja |
| één gridversie (bewerken + meetGrid) met de tellen van een uur | 5,66 ms mediaan | 5,66 ms; de run na ronde 1 8,27 ms (dezelfde code, een drukkere container). Dat is meetGrid zelf; het gaat nu minder vaak |

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
  elk antwoord gelezen (`leesWeg`), een time-out van 5 s per POST (`TIJDSLIMIET_MS`); na elke POST
  `naBewaard` (de library-rij, `library.zetGrid`, nieuw, ook als de track intussen iets anders laadde),
  en pas als de reeks klaar is `naReeks`: dan krijgen andere tracks met hetzelfde nummer het grid (alleen
  als die zelf niets bewerkten), één keer. Klok en wekker zijn in te spuiten (de test draait op een nep-klok).
  `laden.js` gebruikt hem; elke plek die een geladen grid als bewaard markeert gaat via `grids.alsBewaard`.
- `index.html`: knop ≡ (tellen hier) naast "1"; de tooltips noemen de APC-knoppen.
- Tests: `test/grid-bediening.test.mjs` (nieuw, 17 checks over 21 routes, `// @alleen:` want hij toetst op de
  wandklok), `test/grid-bewaren.test.mjs` (nieuw, 15 checks, nep-klok en nep-wekker), `test/beatgrid.test.mjs`
  (pin met klappen, 5 checks), `test/mapping.test.mjs` (de acht nieuwe sleutels in de "niets bestaands
  veranderd"-checks).
- Docs: `docs/BEATGRID.md` §12, `docs/APC40.md`, `docs/HANDELINGENLOG.md` (vasthouden en terugspelen),
  één alinea in CLAUDE.md (Beatgrid).

## Tests

Na review ronde 1 (samengevoegd met `studio/afmaken` 849af2d, dus in de pool):
`node test/alles.mjs`: 98 bestanden, 8864 checks, 8 overgeslagen, 3 rood, precies de drie die in
deze container ook op main rood zijn (renderblok "keylock met wissels … bytes per bericht",
instrumenten-fm-schaal "geen afval per blok", wachtrij "yt-dlp en zijn kind zijn allebei weg" 2×).
grid-bediening 17 ok (alleen, na de pool), grid-bewaren 15 ok, beatgrid 165 ok, mapping 307 ok,
engine 826 ok. Vóór ronde 1: 95 bestanden, 8817 checks, dezelfde drie rood.

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

## Review ronde 1

**Blokkerend: de tak botste met `studio/afmaken`, en `grid-bewaren.js` las zijn antwoord niet.**
- Samengevoegd: `studio/afmaken` (849af2d) in de tak (merge-commit). Het conflict in `laden.js`
  opgelost met het nieuwe bewaren, en de import van `leesWeg` blijft (bewaarToon gebruikt hem).
  `mappings/` veranderde op `studio/afmaken` niet (`git diff 7debab6 studio/afmaken -- mappings/`
  is leeg), dus `eerder.mjs` hoefde niet opnieuw.
- `grid-bewaren.js` leest elk antwoord met `await leesWeg(res)` vóór de controle op `res.ok`, dus
  ook bij een fout. Gemeten met de nep-fetch van `grid-bediening.test` (die telt elke `json()`):
  vóór (tip `3c6aabf`) **0 van 3** gelezen, na **3 van 3**. `grid-bewaren.test` toetst het ook op
  het foutpad (een 500: gelezen, geen library-rij, het vangnet doet hem opnieuw).
- `grid-bediening.test.mjs` heeft bovenaan `// @alleen: tijdsgrenzen op de wandklok (…)`: hij loopt
  in `alles.mjs` na de pool, alleen.

**Kleine punten:**
- *Vraag 1 onvolledig*: klopt. Nagelopen op de mapping: Device ◀ ▶ en On/Off hebben ook regels in
  `device.inst` en `device.master`, en het vormfragment in `device.vorm`; `edit` staat vooraan, dus de
  grid-modus wint. Vraag 1 en `docs/APC40.md` noemen ze nu allemaal.
- *On/Off start de controle op een stilstaand deck*: klopt (dat gedrag bestond al op het scherm).
  Niet veranderd, wel genoemd: nieuwe vraag 2 met twee voorstellen, en in `docs/APC40.md`.
- *naGridBewaard alleen als de track het nummer nog draagt*: opgelost. `naBewaard` (de library-rij)
  draait na elke geslaagde POST, los van het deck. Check: "ander nummer geladen tijdens de POST".
- *Tussenstanden naar andere tracks*: opgelost zoals voorgesteld ("pas na de reeks"). Andere tracks
  met hetzelfde nummer krijgen het grid via `naReeks`: als er 250 ms geen bewerking was en alles
  bewaard is, één keer. Check: 2 s draaien = 2 POSTs en 0 tussenstanden, daarna één `naReeks` met het
  eindgrid, 250 ms na de laatste tik. Dat het geen lus A → B → A wordt, toetst de laatste check
  (`laden.js` markeert het overgenomen grid als bewaard vóór `setGrid`). Of een SPELENDE track het
  dan ook moet krijgen, blijft vraag 3.
- *Eén hangende fetch legt alles stil*: opgelost met `AbortSignal.timeout(5000)` per POST. Gemeten met
  `tools/bench/grid-hang.mjs` (time-out daar 300 ms): vóór **1** POST in 6 s, na **6**.
- *Vasthouden bij terugspelen*: beschreven in `docs/HANDELINGENLOG.md` (`grid`) en BEATGRID §12.
- *Getal draaien*: nu "rond de 50" (vier runs: 37 · 40 · 48 · 70 ms per seconde).
- *Getal headless*: opnieuw gemeten na ronde 1: 271 · 134 · 255 · 87 · 258 · 268 ms, gemiddeld 212.
  250 ms is de bovengrens (plus de weg naar de server); 87 en 134 komen van het vangnet.
- *Maschine en toetsenbord*: niet gebouwd, staat in "wat niet" en optie A.
- *Wandklok in grid-bediening.test*: `// @alleen:` erbij; het nieuwe `grid-bewaren.test` draait op een
  nep-klok en een nep-wekker (de klok en de timers zijn in te spuiten), alleen de time-out van
  `AbortSignal` is echte tijd (60 ms, met 200 ms wachten).

## Vragen voor Clay

1. In de grid-modus doen Device ◀ ▶, On/Off, Clip/Device View en Detail View nu iets met het grid
   (de "1", controle/✓, tellen hier, ↶). De grid-modus wint dan van ELK open device-mapje: in
   strip/rack het rack kiezen, het effect aan/uit en strip ↔ rack; in het mapje master het
   master-rack kiezen en de master aan/uit; in het mapje inst vorige/volgende instrument en alles
   stil; met `?vormen=1` het mapje vorm openen (Detail View) en daarin vorm kiezen en de laag
   aan/uit. De device knobs (trim/EQ/sends), Bank en de shift-varianten die een mapje openen
   blijven werken. Is dat goed, of wil je die liever op een andere plek?
2. On/Off is in de grid-modus "controleren". Op een STILSTAAND deck zoekt die een plek op en
   drukt hij op play, en zonder koptelefoonuitgang van vier kanalen gaat de tik naar de master.
   Wie uit gewoonte op On/Off drukt (vroeger: effect aan/uit) laat de zaal dan de track en de tik
   horen. Op het scherm deed de knop dat al; op de APC is het nu één greep. Zal ik controleren op
   een stilstaand deck alleen laten klaarzetten (plek opzoeken, tik aan, niet starten), of zonder
   koptelefoon weigeren met een melding?
3. Staat hetzelfde nummer op twee tracks, dan krijgt de andere track het bewerkte grid ook (als hij
   zelf niets bewerkte), ook als hij in de zaal speelt. Sinds review ronde 1 pas als je klaar bent
   (250 ms geen bewerking), één keer, niet elke seconde een tussenstand van de encoder. Zo hoort het
   grid bij het nummer; maar wil je dat ook midden in een set, of alleen op tracks die niet spelen?
4. Oranje op "tel 1 hier" = twijfel. Is dat genoeg, of wil je bij "geen puls" liever uit of rood?
5. Tap tempo zet na vier tikken het HELE grid op slot (al van vóór dit spoor). Zo laten?
