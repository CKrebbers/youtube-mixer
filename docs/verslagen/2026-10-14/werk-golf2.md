# Werkruimte golf 2: samengevoegd (14 okt 2026)

Tak `werkruimte/integratie` (worktree buiten iCloud), gepusht naar origin. Samengevoegd, één voor
één met `git merge --no-edit`: `werk/S1` (precisie), `werk/S2` (uitlijnweergave), `werk/S3`
(werkruimte-kern), `werk/S4` (combinaties en effecten), `werk/S5` (mapping per apparaat). De
verslagen per spoor: `werk-S1.md` … `werk-S5.md` hiernaast; wat er gebouwd is: `docs/werkruimte/S1–S5.md`.

## Kort

- Twee echte git-conflicten (CLAUDE.md, `test/aanhaakpunten.test.mjs`), allebei omdat twee sporen
  dezelfde regel van golf 1 vervingen. Beide kanten gehouden.
- Drie botsingen ZONDER git-conflict, gevonden door de sporen naast elkaar te leggen: het model van
  S3 kende de regelvelden van S4 maar half, een stuk dat S1 of S4 al als proef had opgezet brak een
  werkruimte, en de superknoppen van een werkruimte kwamen nergens aan. Alle drie klein gerepareerd,
  met checks die op de oude code rood zijn.
- `node test/alles.mjs`: 112 bestanden, 9936 checks, rood alleen de drie bekende van de container.
- Headless: de proeven van S1, S2, S3 en S5 plus `kijk.mjs` groen. Latentie: stijlwerk in rust
  37,8 ms/s, gelijk aan de basis van vóór golf 2 in dezelfde ronde (41,3); de winst van 14 okt is heel.

## Commits

| commit | wat |
|---|---|
| (fast-forward) 1f71ba1 … 9523e98 | `werk/S1`: de basis was precies de tak van S1, dus geen merge-commit |
| ad7aa63 | merge `werk/S2` (schoon) |
| a76b965 | merge `werk/S3`: conflict in CLAUDE.md (zie onder) |
| d5a3c38 | merge `werk/S4` (schoon) |
| 32bb2e3 | merge `werk/S5`: conflict in `test/aanhaakpunten.test.mjs` |
| 9d6c97b | `.gitignore`: `/proef/` in plaats van `proef/` |
| dc5fbf1 | het werkruimte-model (S3) neemt de regels van S4 aan zoals `mapping.js` |
| 632c2ff | een werkruimte neemt een stuk over dat er al als proef op stond (S1 `?uitlijn=1`, S4 `?stukken=`) |
| 770e48b | superknoppen uit de werkruimte (S3) komen op de superknoppen van S4 |
| (dit verslag) | `docs/verslagen/2026-10-14/werk-golf2.md` |

`node tools/mapping/eerder.mjs` is gedraaid: geen enkele golf-2-tak veranderde `mappings/apc40mk2.json`,
dus niets te doen (15 voorgangers, alle terug te rekenen). `mappings/toetsen.json` (S5) en de stukken in
`mappings/stukken/` hebben geen `eerder`.

## Wat botste en hoe het is opgelost

### Git-conflicten

1. **CLAUDE.md (S1 tegen S3).** Allebei een regel `stukken/` onder `mappings/` en een testregel op
   dezelfde plek. Opgelost: één regel `stukken/` die beide noemt (`basis.json` van S3, `uitlijn.json`
   van S1), en `precisie.test.mjs` naast de drie werkruimte-tests. De rest van CLAUDE.md en
   `docs/WERKRUIMTE.md` (de "Gebouwd"-alinea's van alle vijf) voegde git zelf samen.
2. **`test/aanhaakpunten.test.mjs` (S3 tegen S5).** Golf 1 eiste "de drie routebestanden zijn leeg";
   S3 en S5 vulden elk hun eigen routebestand en vervingen die check elk op hun manier. S3: "elke route
   hoort bij een spoor en zit onder /api/" plus "mag is leeg". S5 zet BEWUST één pagina op de witte
   lijst (`tools/proef/maschine-ijk.html`) en eiste "geen witte-lijstregel zet data open". Samen:
   de spoor- en /api/-check van S3, de data-check van S5 (met `/werkruimtes/` erbij), en in plaats van
   "mag is leeg": "op de witte lijst staat alleen de ijkproef".
3. **`.gitignore`** (geen conflict, wel een vraag van S5 aan S3): `proef/` ving ook `tools/proef/`
   (S5 moest met `git add -f`). Nu `/proef/`; `proef/sessie.json` blijft genegeerd.

### Botsingen zonder git-conflict

4. **Het model van S3 tegen de regels van S4** (`src/werk/model.js`). Een stuk dat met `?stukken=`
   werkte, werkte niet altijd in een werkruimte:
   - S4 zette de groep `houd` in `lagen.js`; S3's kopie `STANDAARD_MAPJES` kende hem niet:
     `werkruimte-model.test` was na het samenvoegen rood. Nu staat `houd` erin (geen stand, geen eigen
     mapjes; een stuk of werkruimte zet ze erbij, kiesknop = het mapje zelf).
   - `codering` (stappen: "2c" of "bin") viel weg: een "bin"-encoder las in een werkruimte verkeerd om.
   - `lang: true` (= 400 ms in `mapping.js`) werd geweigerd.
   - De sleutel van een regel had geen `?als`: een knop met en zonder conditie heette "dubbel". Nu
     dezelfde sleutel als `sleutelVan` in `mapping.js`; een regel MET `als` op een plek van de
     standaard blijft geweigerd (B1: de standaard blijft bit voor bit).
   Acht checks in `werkruimte-model.test` (ook een houd-mapje in een stuk, samengesteld).
5. **Een proef-stuk en een werkruimte op hetzelfde stuk** (`src/werk/werkruimte.js`,
   `src/ui/aanhakers/combi.js`). S1 zet met `?uitlijn=1` het stuk `uitlijn` zelf op (en ONTHOUDT de
   vlag in localStorage), vóór de aanhaker `werk`. Een werkruimte die `uitlijn` noemt (`apc-alleen`,
   `twee-handen`) gaf dan "stuk uitlijn: het mapje device.uitlijn bestaat al" en het stuk deed niets.
   Nu haalt de werkruimte zo'n proefversie (fragment `stuk:<naam>` en de nieuwe mapjes van dat stuk)
   eerst weg en zet het stuk zelf op. Omgekeerd slaat S4's `?stukken=` (aanhaker `combi`, ná `werk`)
   een stuk over dat de werkruimte al zette, met een info-melding. Drie checks in `werkruimte.test`
   (rood op de oude `werkruimte.js`).
6. **Superknoppen in een werkruimte** (`src/control/acties-combi.js`, `src/ui/aanhakers/combi.js`,
   `src/werk/model.js`). S3 valideerde `superknoppen` (vorm WERKRUIMTE.md B2: `nr` + links met
   `action`) maar paste ze niet toe; S4 schreef in S4.md dat ze "in de werkruimte (`superknoppen`)"
   kunnen, in zijn eigen vorm (`target`, `glide`), die het model van S3 weigerde ("action ontbreekt").
   Nu: `superknoppenVanWerk()` (puur) zet de S3-vorm om, de aanhaker `combi` luistert op `ctx.werk` en
   zet ze bij elke (her)laad (zonder superknoppen weer het voorbeeld op 1), en het model neemt `target`
   als andere naam voor `action` en bewaart `glide: true` per link. S4.md zegt nu dat `nr` erbij moet.
   Zes checks in `superknop.test`.

### Nagelopen en in orde (S4 tegen S5)

- S5's toetsenbord is een gewone `Mapping` (`keyboard.js`): hij krijgt vanzelf het gedeelde
  houd-register van S4, `{tweede}` werkt (S5 geeft hem zelf, S4 valt terug op `{R}`), en de weigering
  van S4 (`controleerRegel`: geen druk/latch/houd op de kern) geldt ook voor wat je op een toets koppelt.
- Koppelen (S5, `midi-learn.js`) gaat door `mapping.set()`; S4's controle zit daarin, dus een
  geweigerde regel komt er bij elk apparaat niet in. De open houd-mapjes staan vooraan in
  `mapping.lagen()`: koppel je terwijl je een houd-knop vasthoudt, dan komt de regel in dat houd-mapje
  (zoals "koppelen komt in het mapje dat open staat").
- S5's opslag als verschil vergelijkt regels via `regelNaarJSON`, waarin S4 `naar`/`lang`/`codering`/
  `als` meeneemt: een eigen druk-regel overleeft bewaren en herladen. Fragmenten (stukken) gaan nooit
  mee in het verschil (`toJSON` slaat `extra` over).
- `mapping-opslag.test`, `keyboard.test`, `learn.test`, `combinaties.test`, `mapping.test`,
  `maschine-ijk.mjs` en `speelapparaten.mjs` zijn samen groen.

## Testuitslag

```
VARVE_HUB_REPO=/home/user/ckrebbers/av-app-hub \
VARVE_CHROME=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell node test/alles.mjs
```

**112 bestanden, 9936 checks, 8 overgeslagen, 287 s (pool 141 s + alleen 146 s), 3 rood**, precies de
bekende van deze container:
- `renderblok` "keylock met wissels: 89,7 bytes per bericht" (gouden hash en 0 GC groen);
- `wachtrij` "yt-dlp en zijn kind zijn allebei weg" (2×);
- `instrumenten-fm-schaal` "geen afval per blok" (28136 bytes, 0 GC).

De eerste ronde (direct na de vijf merges) had er één bij: `werkruimte-model` (punt 4 hierboven).
Nieuw groen: `precisie` 90, `uitlijn` 115, `werkruimte-model` 115, `werkruimte` 119 (alleen),
`werkruimte-server` 57, `combinaties` 129, `superknop` 35, `keyboard` 42, `mapping-opslag` 47,
`hub` 151 (met de hub). `midi.test` (S1 zag hem eens wankelen) was groen.

## Headless-proeven van de vijf sporen

Alles met `VARVE_TESTSERVER=1`, `VARVE_CHROME` = `headless_shell --no-sandbox` (als root start hij
anders niet; `scratchpad/chrome-shell.sh`), `TMPDIR` en alle `VARVE_*`-paden in
`scratchpad/golf2-hl/`, poorten 8990–8999. Het script: `scratchpad/golf2-hl.sh`.

| spoor | proef | poorten | uitkomst |
|---|---|---|---|
| S1 | `tools/headless/precisie.mjs` | 8990/8991 | 14/14 ok: 21 regels `stuk:uitlijn` met `?uitlijn=1`, ⇧ Lock opent het mapje, `?uitlijn=0` weer uit; 15 fijne tikken −0,145 ms (verwacht −0,144); 50 tikken/s 190,50 ms; duoklik op de sample |
| S2 | `tools/headless/uitlijn.mjs` | 8992/8993 | 31/31 ok: venster in rust 0,16 Mpx/s, rekenwerk 0,281 ms per beeld, DOM = `engine.faseVerschil` (0,000 ms op zeven tracks), geen consolefouten |
| S3 | `tools/headless/werkruimte.mjs` | 8994/8995 | 35/35 ok, nu met de ECHTE stukken van S1 en S4 in `apc-alleen` (geen namaak meer): 1440×790 per deel zonder scrollen, Claude-bestand binnen 2224 ms, herlaad houdt je mapje (`dub`, `mijndub`, 0 wissels door volgt) |
| S4 | geen proef in de repo (S4 had een scratch-rookproef) | — | gedekt door `werkruimte.mjs` (fx-matrix en mix-extra laden nu via de werkruimte) en de node-tests |
| S5 | `tools/proef/maschine-ijk.mjs` | 8996 + hub op een vrije poort | groen: ijkproef 73/73, CONTROL+F1 geleerd onder `mapping:maschine-mk2`, APC byte voor byte, geen requestMIDIAccess |
| S5 | `tools/headless/speelapparaten.mjs` | 8997 + hub op een vrije poort | groen, ook "de APC-lease werkt nog" |
| — | `tools/headless/kijk.mjs` | 8998/8999 | Alles groen |

De hub-proeven draaien met `VARVE_HUB_REPO=scratchpad/hub-kopie`: `/home/user/ckrebbers/av-app-hub` heeft
geen `node_modules` (playwright-core ontbreekt); de kopie is dezelfde commit (95ae5aa) mét node_modules.
Niet gedraaid: `rijen.mjs` (hangt in deze container ook op de basis, zie werk-S3.md; alleen op de Mac).

## De latentie-ronde

`node tools/headless/latentie.mjs --duur 3000` (8990/8991; 8 tracks spelend, 710 regels in de mapping).
Hoofdthread in threadtijd, ms/s:

| scenario | stijl | taak | wacht p50/p99 (ms) |
|---|---|---|---|
| rust | **37,7** | 529 | 0,41 / 19,6 |
| fader | 36,0 | 653 | 1,89 / 12,3 |
| sweep | 36,1 | 835 | 4,5 / 19,7 |
| shift | 102,8 | 908 | 8,0 / 29,7 |
| mapje | 112,6 | 868 | 4,9 / 30,6 |

Om te zien of golf 2 iets terugbracht, meteen erna één ronde voor en na op dezelfde machine
(`VARVE_WORTEL=<git archive e8dcd98>` = golf 1 zonder golf 2, poorten 8992/8993):

| | rust stijl | shift stijl | mapje stijl |
|---|---|---|---|
| vóór golf 2 (e8dcd98) | 41,3 | 100,4 | 119,4 |
| na golf 2 (770e48b) | 37,8 | 99,7 | 118,0 |

**De winst van 14 okt is heel**: in rust rond de 33–41 (controller-invoer mat 33 [29–34] over 8
rondes op een rustiger moment), nergens richting 180. Shift en mapje kosten ~100–120 ms/s stijl, maar
dat deden ze vóór golf 2 ook: de werk-balk, de werkruimte en de combi-aanhaker voegen niets toe. Eén
ronde per kant, dus ±10% is ruis.

## Wat niet lukte of open blijft

- **Het werkvak** (`#werkvak`): S2 levert `varveUitlijn.toonVak(el, naam)`, S3 geeft het event
  `'werkruimte'` met `schermen.hoofd.werkvak`, maar niemand verbindt ze: dat is S7 (golf 3,
  WERKRUIMTE.md D4 S7). Een `werkvak` in een werkruimte wordt nu gevalideerd en doet nog niets.
- **`bussen` in een werkruimte** blijft ongebruikt: een rack op de echo/galmbus verandert de klank, en
  een werkruimte zet nooit een klank. Vraag hieronder (W-B).
- **Druk/latch op een toets**: het toetsenbord (S5) voert alleen trigger-regels uit; een `druk`-regel
  op een toets doet niets (zoals een fader op een toets). Niet veranderd; vraag hieronder.
- **`lang`**: `mapping.js` neemt 1–10000 ms, het model van S3 100–2000 ms. Een stuk met `lang: 3000`
  werkt met `?stukken=`, maar wordt in een werkruimte geweigerd (met reden). Bewust zo gelaten.
- `rijen.mjs` niet gedraaid (hangt in de container).
- Op hardware: alles uit de "alleen op de hardware"-lijsten van de vijf verslagen blijft open
  (APC-knopstand na een jog, de pan-ring als fasemeter, de duoklik in de echte koptelefoon, de
  ijkproef op de echte Maschine, de violette lampjes van fx-matrix, ⇧ master-knop in 0x42).

## Vragen voor Clay (alle vijf verslagen, ontdubbeld)

Per onderdeel; achter elke vraag het advies.

### Precisie (S1)

1. **Duoklik: welke toon waar?** Nu hoog op de track die je gelijkzet en laag op de maatgever (het
   ontwerp A6 zei andersom). *Advies: zo laten.* De track die je beweegt hoort de opvallende toon te
   hebben; de maatgever is het fundament.
2. **"Op de 1" bij gelijkspel** (precies twee tellen naast): nu terug. *Advies: terug laten.* Vooruit
   slaat muziek over; terug herhaalt hooguit twee tellen.
3. **De precisie-actions op het toetsenbord** (bv. ⇧ + R/T = jog)? *Advies: geen standaard toevoegen;
   koppel ze zelf* (dat kan nu, S5: "koppelen op: toetsen"), en zet ze pas in `toetsen.json` als je
   ze na de proefavond echt elke keer gebruikt.
4. **`?uitlijn=1` wordt onthouden.** Nu de werkruimte stukken laadt, is de vlag alleen nog een proef
   zonder werkruimte (en een werkruimte neemt hem over, zie botsing 5). *Advies: laten tot de
   proefavond, daarna weghalen.*

### Uitlijnweergave (S2)

5. **Twee maten per pagina als standaard, of één?** *Advies: twee* (je ziet fase én drift); één maat
   kies je in het venster of met `?maten=1` als je op de laatste ms zit.
6. **De knop "uitlijn" in de transportrij houden als het werkvak er is?** *Advies: houden tot S7 het
   werkvak vult; dan beslissen op de proefavond* (hij kost 4 px).
7. **Een track zonder tellen (alleen klappen): "grof" tonen of leeg?** *Advies: grof tonen, met het
   label "grof"*: leeg lijkt op "kapot".

### Werkruimte (S3)

8. **De voorbeelden `apc-alleen` en `twee-handen` houden, of één klein voorbeeld?** *Advies: alle drie
   houden zolang je nog geen eigen hebt* (ze staan als "(voorbeeld)" in de kiezer); weg zodra jouw
   eerste werkruimte er is.
9. **De eerste keer "⚠ 74 nieuw" (tegen de standaard, rood boven 12)**: zo, of stil beginnen?
   *Advies: zo laten.* Het zegt eerlijk dat er veel verandert; op een proefavond niet alles tegelijk.
10. **"Leg vast" ook op de APC?** *Advies: nee.* Twee keer klikken op de balk is genoeg, en vrije
    APC-plekken zijn schaars.
11. **W1: zodra de iPad mag schrijven, ook delen kiezen (`werk.deel.*`)?** *Advies: delen kiezen wel*
    (zet nooit een klank), werkruimtes schrijven niet.
12. **W1 en de standen**: `PUT /api/standen/<naam>` en `…/activeer` mogen nu via Tailscale, en een
    stand kan sinds S3 een werkruimte noemen (de indeling bij de VOLGENDE start). Ook alleen vanaf
    deze Mac? *Advies: ja, alleen vanaf de Mac* (zoals de werkruimtes); de Controlekamer via
    Tailscale kan dan kijken maar niet activeren. Dat is een wijziging in `server/index.js`.
13. **(Nieuw bij het samenvoegen) `bussen` in een werkruimte**: nu ongebruikt. Moet een werkruimte een
    rack op de echo/galmbus mogen zetten bij het kiezen? *Advies: alleen bij een uitdrukkelijke keuze
    (de kiezer, niet bij het peilen of opstarten), en alleen als er niets op die bus klinkt.*

### Combinaties en effecten (S4)

14. **Twee solo's tegelijk geven stilte** (elk zet de ander weg). "Solo drums + solo bas" = die twee
    horen? *Advies: ja*, solo's tellen samen (zoals in elke DAW); één solo blijft zoals nu.
15. **Welke racks op de echo- en galmbus?** Ze moeten in hun beginstand nat klinken. *Advies: begin
    met één: een dub-echo* (`"bus": true` in `racks/sjablonen.json`), en kies na de proefavond.
16. **⇧ On/Off opent met fx-matrix ook in de mapjes master en instrument de fx-matrix** (daar deed
    hij bypass/stil). *Advies: in master en instrument laten wat het was*: de regel in het stuk
    alleen in strip en rack laten gelden (een `laag` per regel), zodat bypass bereikbaar blijft.
17. **Een worp die je vasthoudt bij het begin van een opname: bij terugspelen ook terug?** *Advies:
    nee.* Zeldzaam, en het log blijft eenvoudig (druk/los).
18. **(Nieuw bij het samenvoegen) druk/latch op een toets van het toetsenbord**: nu doet zo'n regel
    niets (alleen triggers). *Advies: zo laten tot je het mist*; een worp hoort op een knop die je
    voelt.

### Mapping per apparaat (S5)

19. **Koppelen op de Maschine alleen met CONTROL?** *Advies: ja.* Nooit per ongeluk iets koppelen
    terwijl je speelt.
20. **De pads van de Maschine ook koppelen (een padmodus "knoppen")?** *Advies: later*, bij S6, als
    de ijkproef klopt; dat is een wijziging in `maschine.js`.
21. **Bewaren per tabblad, of alleen vanuit het tabblad dat de APC heeft?** *Advies: alleen het
    tabblad met de Web Lock* (zoals de status-zender); een tweede tabblad leest.

(De vraag van S1 over `midi.test` was voor de samenvoeger, niet voor Clay: in deze ronde groen;
een `// @alleen` erbij is aan het spoor controller-uitvoer.)

## Zelf invullen: stap voor stap

Clay maakt de knoppenverdeling, de panelen en de effecten zelf. Wat de sporen leverden is mechaniek
en hooguit één voorbeeld per soort.

### Welke bestanden van jou zijn

| wat | waar | in git? |
|---|---|---|
| je werkruimtes | `werkruimtes/<naam>.json` (oude versies in `werkruimtes/.versies/<naam>/`) | nee (`.gitignore`), in de Bureaublad-map |
| je eigen stukken | `mappings/stukken/<eigen-naam>.json` (NIET de voorbeelden overschrijven: `uitlijn`, `fx-matrix`, `mix-extra`) | ja, als je wilt |
| je koppelingen per apparaat | op de server als VERSCHIL: APC `/api/mapping`, Maschine/Xboard/toetsen `/api/mapping/<apparaat>` (in `library.db`); reserve in de browser (`varve.mapping`, `varve.mapping:<apparaat>`) | nee; **exporteren** geeft een bestand |
| racks voor de bussen | `racks/sjablonen.json`, met `"bus": true` | ja |
| superknoppen | in je werkruimte, `superknoppen` | (via de werkruimte) |

Niet van jou (de standaard; jouw verschil gaat erbovenop): `mappings/apc40mk2.json`,
`maschine-mk2.json`, `xboard49.json`, `toetsen.json`, `mappings/stukken/basis.json` (THUIS).

### 1. De knoppenverdeling

**a. Eén knop koppelen (meteen, op elk apparaat).**
1. Bovenbalk: **MIDI** → **lijst**. Bovenaan "koppelen op: **APC · Maschine · Xboard · toetsen**"
   (de Maschine alleen met `?hub=`). Kies het apparaat.
2. Zoek de functie (bv. `track.2.phase.offset`, `track.{focus}.jog.fwd`, `super.2`,
   `track.{focus}.send.a.hold`) en klik **leer**. Of: **koppelmodus** aan en klik de knop op het scherm.
3. Raak de control aan. APC: zoals altijd (in het mapje dat open staat; shift vast = shift-laag).
   Maschine: houd **CONTROL** vast en druk of draai (draai daarna nog even door). Xboard: beweeg de
   knop of schuif. Toetsen: druk de toets (shift erbij = shift-regel; spatie, `[` `]`, `/`, Esc, B en
   Cmd+Z blijven van het scherm).
4. Klaar: bewaard als jouw verschil. Losmaken: **wis** in de lijst, of shift-klik in de koppelmodus.
   **Standaard herstellen** (twee klikken) haalt alleen de eigen regels van het gekozen apparaat weg.

**b. Een eigen stuk (een idee over de hele APC, als geheel aan en uit).**
1. Kopieer `mappings/stukken/uitlijn.json` of `fx-matrix.json` naar
   `mappings/stukken/mijn-<iets>.json`. Zet `"stuk": "mijn-<iets>"`, een eigen `titel`, en haal
   `"voorbeeld": true` weg.
2. `mapjes.nieuw`: het nieuwe mapje (`"apc40mk2.device.mijn"` of `"apc40mk2.grid.mijn"`), met `naam`,
   `kleur` (APC-palet) en `kiesknop` (`{ "in": "note:0:58", "shift": true }`). Een houd-mapje (zolang je
   een knop vasthoudt): `"apc40mk2.houd.solo"`, kiesknop = de knop die je vasthoudt.
3. `regels.apc40mk2`: per knop één regel `{ in, laag, action, mode }`. Draaiknoppen `endless`,
   drukknoppen `trigger`; nieuw: `druk` met `naar` (zolang je drukt), `latch` (aan/uit), `lang: 400`
   (kort vast, lang zolang je drukt), `stappen` (encoder → `.fwd`/`.back`), `als`
   (`focus.instrument`, `focus.stems` …). Alleen VRIJE plekken; de kern (faders, play, cue, sync, A|B
   …) weigert het model met een reden.
4. Proeven zonder werkruimte: `http://localhost:8777/?stukken=mijn-<iets>` (alleen die pagina).
5. Nakijken: `node test/combinaties.test.mjs` (blok "de stukken": botsingen met de standaard).

**c. Een werkruimte (de delen MIX, STEMS, FX … met één knop).**
1. Maak `werkruimtes/mijn.json`; begin bij `tools/werkruimtes/voorbeelden/standaard.json` of
   `apc-alleen.json` (zie `docs/werkruimte/S3.md` §2 voor elk veld).
2. `"stukken": ["basis", "mijn-<iets>", "uitlijn"]`: welke stukken aan staan (basis = THUIS op
   ⇧ master-knop).
3. `delen`: hooguit 8 (= tab 1–8, `werk.deel.1–8`), per deel `label`, `kleur`, welke mapjes op de APC
   open gaan (`"apc40mk2": { "grid": "stems", "device": "rack" }`), eventueel met een conditie
   (`{ "als": "focus.instrument", "dan": "inst", "anders": "strip" }`).
4. `volgt`: welk vast geopend APC-mapje welk deel kiest.
5. Eigen regels alleen voor deze werkruimte: `mapjes.nieuw` + `regels` (zelfde vorm als een stuk).
6. Openen met `http://localhost:8777/?werk=mijn` (onthouden), of kiezen op de werk-balk.
7. **Inrichten door te doen**: zet in een deel de mapjes en rijen zoals je wilt en klik twee keer
   "leg vast in <deel>". Claude mag het bestand ook schrijven: de mixer peilt elke 2,5 s.

### 2. De panelen

1. **Rijen per deel** (werkt nu): in een deel `"schermen": { "hoofd": { "rijen": ["stems", "master"],
   "onderpaneel": "library" } }`. Rijen: auto, beeld, instrument, klankschaal, koptelefoon, master,
   stems, patronen. Een deel zet alleen open wat het noemt en sluit alleen wat het zelf openzette.
   Sneller: open de rijen met de hand en "leg vast".
2. **De uitlijnweergave** (werkt nu als venster): knop **uitlijn** achteraan de transportrij; bovenin
   pagina · vouw · strook en 1 of 2 maten (onthouden). Een bladwijzer:
   `uitlijn.html?vorm=vouw&maten=1` (open hem vanuit de mixer). Slepen in een baan duwt via
   `track.N.phase.offset`.
3. **Het werkvak en de schermen** (komt met S7, golf 3): in een deel
   `"schermen": { "hoofd": { "werkvak": "uitlijn-strook" }, "mac-2": { "vakken": ["uitlijn:pagina:1"] } }`.
   Namen: `uitlijn`, `uitlijn-pagina`, `uitlijn-strook`, `uitlijn-vouw`, `uitlijn:<vorm>[:1|2]`,
   later `paneel:<id>`. Je kunt ze nu al in je werkruimte zetten (ze worden nagekeken); ze doen pas
   iets als S7 het werkvak vult.

### 3. De effecten

1. **Een worp op een knop**: koppel `track.{focus}.send.a.hold` (echo vol zolang je drukt),
   `track.{focus}.send.b.hold`, `track.{focus}.fx.mix.hold`, `track.{focus}.fx.knob.K.hold`, of
   `track.{focus}.stem.drums.solo`. Of in een stuk: `{ "action": "track.{focus}.filter", "mode": "druk",
   "naar": 0.85 }` (elke value-action als drukknop).
2. **De fx-matrix proberen**: `?stukken=fx-matrix` of in een werkruimte; ⇧ On/Off opent `grid.fx`
   (violet): kolom = track, rij 1–4 = effectplek 1–4 vol zolang je drukt (⇧ = vastzetten), rij 5 =
   echo-worp, scene 1–4 = master-rack plek 1–4. Het is een VOORBEELD: kopieer het en verdeel zelf.
3. **Een superknop** (één draai beweegt veel): in je werkruimte
   ```json
   "superknoppen": [ { "nr": 2, "naam": "opbouw", "links": [
     { "action": "track.{focus}.filter", "from": 0.5, "to": 0.85, "curve": "s" },
     { "action": "track.{focus}.send.b", "in": [0.5, 1], "from": 0, "to": 0.6 },
     { "action": "track.{focus}.fader", "from": 1, "to": 0.7, "glide": true } ] } ]
   ```
   (`target` mag ook in plaats van `action`). Dan een knop koppelen op `super.2`. Morph: zet alles
   als begin en druk `super.2.vastA`, dan het eind en `super.2.vastB`. Zonder `superknoppen` in de
   werkruimte staat op 1 het voorbeeld "dub (voorbeeld)" (zonder knop).
4. **Een rack op de echo- of galmbus**: zet `"bus": true` bij een rack in `racks/sjablonen.json` (het
   moet in zijn beginstand nat klinken), dan `send.a.rack.next` / `send.b.rack.next` op een knop.
   Welk rack er zat, wordt onthouden (localStorage). Uit een werkruimte (`bussen`) nog niet (vraag 13).
5. **Precisie** (geen effect, wel een knoppenvraag): de actions `track.N.phase.offset(.fine)`,
   `jog.*`, `nudge.fine.*`, `beatjump.quarter/half/beat.*`, `bar.align`, `bend.amount`, `duoklik`
   staan altijd op de bus; zet ze waar jij wilt (1a of 1b). Het stuk `uitlijn` (⇧ Lock = acht
   fasemeters) is het voorbeeld.
