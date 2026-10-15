# Werkruimte S6: de Maschine per deel, en de kaarten (14 okt 2026)

Tak `werk/S6` (vanaf `werkruimte/integratie` a68e4d5, golf 2 samengevoegd). Ontwerp:
`docs/WERKRUIMTE.md` A3, A9, A10, B4, C5, D4 "S6"; bouwopdracht `docs/werkruimte/sporen.json` (S6).
Wat er gebouwd is, voor wie eraan komt: `docs/werkruimte/S6.md`.

## Kort

Clay (14 okt): **jij maakt de knoppenverdeling, ook op de Maschine.** S6 bouwde het mechaniek:
F1–F8 kiezen het deel; per deel zijn padmodus, knoppagina, wiel en schermen van de Maschine data
(regels met een laag); houd-knoppen via `houd.js`; de fasescoop en de getallen van de uitlijnweergave
op het scherm; en kaarten en een spiekbrief die elke werkruimte en elk deel laten zien zonder ze aan
te zetten. Van elke soort één klein voorbeeld (`maschine-delen`, `maschine-houd`), als VOORBEELD
gemarkeerd. `mappings/maschine-mk2.json` en `apc40mk2.json` zijn niet aangeraakt. Zonder werkruimte
doet de Maschine bit voor bit wat hij deed (verschilproef: 20 000 berichten, 0 verschillen).

## Gebouwd

1. **`src/control/maschine.js`**
   - Open mapjes voor de mapping: `bladeren` (library open) · `sampler` of `pads.<x>` · `wiel.<x>` ·
     `pagina.<x>`; de houd-mapjes zet de Mapping er zelf voor.
   - Padmodi uit data (`pads.<x>`): pads naar de mapping, loslaten naar waar het indrukken heen ging
     (`padVast = 'mapping'`). STEP, SCENE, SAMPLING blijven code.
   - Pagina's uit data (`pagina.<x>`): ◄ ► links boven loopt erlangs; het scherm toont per draaiknop
     wat de mapping NU kiest (label, read in procenten, bipolair waar de action dat zegt).
   - Het wiel (en indrukken/ENTER) vraagt eerst de mapping; met de library open alleen de laag
     `bladeren`; anders het oude gedrag.
   - Houd-regels op pads winnen van elke padmodus zolang de houd-knop vastzit.
   - Kiesknoppen van een stuk (`layer.pads/pagina/wiel.<x>`) doet de Maschine zelf (niet de bus).
   - Lampjes: pads in een padmodus uit data = de read van hun regel (deelkleur); knoppen met een
     regel die maschine.js zelf geen lampje geeft (F1–F8, VOLUME, SOLO, MUTE …) = de read.
   - SCENE: SHIFT + pad = de sectie als loop, alleen in een werkruimte.
   - `maakMaschineAdapter(m)` voor de werkruimte (zetMapjes, mapjes, standaard = THUIS, aanwezig, stil).
   - `stand()` met `delen` en, als een deel ze vraagt, de fasescoop en de getallen (afgerond).
   - Een padmodus, pagina of wiel die na een werkruimtewissel niet meer bestaat: terug naar spelen,
     Instrument, het oude wiel.
2. **`src/control/maschine-scherm.js`**: `tekenDeelLabels`, `tekenFasescoop`, `tekenGetallen`; met delen
   schuift het scherm 9 px omlaag; een deel kan per scherm `fasescoop` of `getallen` kiezen.
3. **`src/ui/aanhakers/maschine.js`**: alleen met `?hub=` (wacht op `ctx.maschine`, laadt de Maschine-
   code dynamisch): adapter, deelnamen en deelkleur, de fasescoop uit `src/uitlijn/reken.js`, de
   terugval als de poort wegvalt; een werkruimte die al vóór de adapter gekozen was wordt één keer
   opnieuw opgezet.
4. **`src/ui/beschrijf/maschine.js`**: uitleg van `layer.pads/pagina/wiel.<x>` en `track.N.jog(.fine)`.
5. **Stukken (VOORBEELD)**: `mappings/stukken/maschine-delen.json` (41 regels: F1–F8, SHIFT + F1,
   padmodus `worpen`, pagina `uitlijn`, wiel `jog`) en `maschine-houd.json` (21 regels + 2 kiesknoppen:
   VOLUME + draaiknop = fader, SOLO + pad 1–4 = stem solo, MUTE = bypass).
6. **Kaarten**: `apc.html` en `maschine.html` krijgen een kiezer werkruimte + deel (voorbeeldmodus: een
   eigen Mapping/Maschine, niets naar de mixer), knoppen voor mapjes/padmodi/pagina's uit een stuk, de
   houd-mapjes op de APC-kaart. Volgt de Maschine-kaart de mixer, dan neemt hij de fragmenten van de
   mixer-Maschine over.
7. **Spiekbrief**: `spiekbrief.html` + `src/ui/spiekbrief.js`: per werkruimte, per apparaat en per deel
   één pagina (print: A4, één blad per pagina) in de deelkleur, met de houd-mapjes.
8. **Toetsen**: `test/maschine-delen.test.mjs` (nieuw), nieuwe gevallen onderaan
   `test/maschine-kaart.test.mjs`; `tools/headless/werk-maschine.mjs` (nieuw, met `--bench`).

## Acceptatie

| eis | gehaald | bewijs |
|---|---|---|
| elke bestaande Maschine-test groen zonder andere verwachting | ja | `node test/maschine.test.mjs`, `maschine-kaart`, `maschine-sampler`, `bladeren`, `sec-maschine`: groen; in die bestanden is niets veranderd behalve nieuwe gevallen onderaan `maschine-kaart.test.mjs` |
| zonder stukken bit voor bit als nu | ja | verschilproef (hieronder): 20 000 berichten, 0 verschillen in invokes, noten, lampjes, stand en schermbytes |
| headless: F1–F8 wisselen het deel | ja | `werk-maschine.mjs`: 5 rondes × 8 delen |
| de APC-grid-LED's krijgen de kleur van het deel binnen 33 ms | half: mediaan ja, de staart niet | F (HID in de hub) → eerste grid-LED van het nieuwe mapje op de nep-APC: mediaan 6,0 ms, p95 47 ms, max 66 ms; in VARVE mediaan 2,9 ms. Dezelfde staart zonder de Maschine (werk.kiesDeel vanuit de pagina): p95 42 ms, max 70 ms. FX: de fx-matrix violet in elke ronde. NB: alleen FX heeft een grid in de deelkleur; hotcues/loops/stems/patronen/video tonen hun inhoud (en in `twee-handen` passen SECTIES/loops en BEELD/video niet bij hun deelkleur: de werkruimte waarschuwt daar zelf voor) |
| het Maschine-scherm toont de 8 labels met het actieve omgekeerd | ja | beide schermen bit voor bit `tekenScherm(stand)` als HID-rapport; vak FX 95% vol, de andere 8–17% |
| FX: twee pads tegelijk twee worpen, na loslaten de oude stand | ja | reads 0,00/0,30 → 1/1 → 0,000/0,300 |
| VOLUME vast + draaiknop 3 beweegt track.3.fader | ja | 200 tellen: 1,000 → 0,808; los = houd-mapje dicht |
| UITLIJN: de ring van device knob 2 volgt track.2.phase.offset | ja | drie standen, ring = round(read × 127) ± 1 (0,554 → 70, 0,434 → 55, 0,514 → 65) |
| het wiel is jog in MIX en bladert met de library open | ja | `track.1.jog.fwd`; met de library open `library.next` en geen jog |
| SHIFT + F1 is thuis vanuit elk deel | ja | vanuit UITLIJN … LIBRARY: deel MIX, door THUIS, Maschine op spelen (7/7) |
| de nep-Maschine weg geeft apc-alleen met één melding | nee met de echte hub; ja als de poort wegvalt | werkt zodra de nep-poort `disconnected` wordt: apc-alleen, precies één melding, het deel bleef. Maar de hub meldt een lease-app niet dat één speelapparaat wegviel; de proef zet de poortstatus daarom zelf (zoals hub.js het bij een weggevallen hub doet). Zie "Vragen" |
| volgorde over twee apparaten: 1000 × SOLO + APC-knop, 5 ms, ≥ 99,9% | ja | 1000/1000 in drie runs; scheefheid p99 **10,3 / 17,8 / 20,9 ms** (drie runs), p50 −0,5 … −3,7 ms, min −5,0 ms. Kanttekening: de weg via de Maschine (HID) is ~3,6 ms trager dan de APC; in het krapste geval bleef van de 5 ms nog 0,02 ms over. Met minder dan ~5 ms tussen houd-knop en doelknop draait de volgorde om (dan geldt C5: de doelknop krijgt zijn gewone regel) |
| speellatentie pads in SPELEN ≤ +0,1 ms mediaan | ja | `--bench`: 0,23 → 0,20–0,23 µs per bericht (−0,00003 ms); `tools/bench/invoer.mjs --vergelijk`: gelijk |
| LED-tik van de Maschine niet duurder (± 10%) | ja hier; reviewer b: in zijn run niet te beslissen (ruis ±30% bij load 6,7) | `--bench`: 8,0–8,6 µs → 7,9–8,6 µs (−0,5 … −1,8%); in de browser per deel 0,03–0,10 ms voor lampjes + stand |
| schermen: 2048 bytes, pixeltest labels en fasescoop | ja | `node test/maschine-delen.test.mjs` "de schermen" |
| kaarten: per werkruimte × deel × padmodus geen lege uitleg waar een regel staat | ja | `maschine-kaart.test`: standaard 345, apc-alleen 2760, twee-handen 6832 plekken; APC per deel ook |
| maschine.html stuurt niets | ja | `maschine-kaart.test` (invoke doet niets, ook de voorbeeld-Maschine) en `tools/headless/maschine-kaart.mjs` groen |
| zonder ?hub= laadt de mixer geen Maschine-code | ja | `VARVE_HUB_REPO=… node test/hub.test.mjs` groen (eerst rood toen spiekbrief.js de Maschine statisch laadde: verplaatst naar maschine-kaart-plan.js) |
| spiekbrief: één pagina per apparaat × deel, elke regel met tekst | ja | `maschine-kaart.test`: standaard 1×1, apc-alleen 1×8, twee-handen 2×8; 16 bladen ook in Chromium |
| `node test/alles.mjs` groen | REVIEW | zie Tests |

## Metingen (exacte commando's)

Omgeving: Linux-container, `headless_shell` 1194 met `--no-sandbox` (`VARVE_CHROME` = een wrapper),
de hub geklond in `~/av-app-hub` met `npm install`. `$S` = de scratchpad van deze sessie; `$S/oud` =
`git archive origin/werkruimte/integratie src mappings` uitgepakt (de basis).

```sh
# headless: echte hub, nep-APC, nep-Maschine, twee-handen (1000 × de volgorde)
TMPDIR=$S/tmp VARVE_HUB_REPO=~/av-app-hub VARVE_CHROME=$S/chrome.sh node tools/headless/werk-maschine.mjs
# pads in SPELEN en de LED-tik, voor en na (5 × om en om, mediaan van 9 rondes)
node tools/headless/werk-maschine.mjs --bench $S/oud
# het APC-pad (S6 raakt het niet)
node --expose-gc tools/bench/invoer.mjs --vergelijk $S/oud .
# de verschilproef (scratch, niet in de repo): oud en nieuw maschine.js op 20 000 berichten
node $S/verschil.mjs $S/oud . 20000
```

De verschilproef bouwt twee Maschines (oud uit `$S/oud`, nieuw uit de tak) met dezelfde nep-engine
(een nummer met secties op track 2, een instrument dat aan en uit gaat, patronen, sampler) en de
standaardmapping, en voert ze dezelfde willekeurige reeks: 35% pads, 40% knoppen (alle 48), 20%
draaiknoppen, 5% wiel, af en toe de library open/dicht en een instrument erbij/weg. Elke 7 berichten:
`ledBeeld()`, `stand()` en `tekenScherm(stand, 0/1)` vergeleken. Uitkomst: 6968 invokes/noten, 0
verschillen.

Uitkomst `werk-maschine.mjs` (laatste run):

```
F (HID in de hub) -> eerste grid-LED op de nep-APC: mediaan 5.98 ms, p95 47.40 ms, max 66.32 ms (30 wissels)
daarvan in VARVE (F binnen -> LED naar de hub): mediaan 2.87 ms, p95 39.47 ms, max 58.78 ms
ter vergelijking zonder de Maschine (werk.kiesDeel -> LED naar de hub): mediaan 5.96 ms, p95 41.61 ms, max 69.76 ms
wat een tik kost: MIX lampjes 0.040 ms, stand 0.069 ms · UITLIJN 0.034/0.040 · FX 0.067/0.012 · … (alle < 0,1 ms)
de volgorde klopt in ≥ 99,9% (1000/1000)
scheefheid (aankomst APC − aankomst SOLO − 5 ms, in VARVE): p50 -1.96 ms, p99 17.83 ms, min -4.97 ms, max 25.94 ms
```

De staart van de deelwissel (p95 ~40–65 ms) zit niet in S6: dezelfde wissels vanuit de pagina,
zonder de Maschine, hebben hem ook. In deze container rendert Chrome in software; een paar wissels
vallen in een beeld van de mixer. Op de Mac opnieuw meten.

## Wat niet gebouwd is

- Geen standaardindeling: transport (MIX), stems, beeld, laden (padmodi), stems/beeld/super (pagina's),
  rack/sectie/mengvorm (wielen), TEMPO, SWING, DUPLICATE. Recepten in S6.md §3.
- Wielregels voor `rack.next/prev`, `section.next/prev` en `video.mode`: `stappen` (mapping.js, S4)
  roept alleen `.fwd`/`.back`; die actions hebben andere namen. Niet omheen gebouwd.
- Schermsoorten `strip`, `rack`, `super`, `stems`, `secties`, `beeld`, `blader` als aparte weergave: ze
  tonen wat de pagina of padmodus al laat zien. Alleen `fasescoop` en `getallen` zijn nieuw.
- Bij `twee-handen` geen `volgt` voor de Maschine (STEP of SCENE kiezen geen deel).
- De hub meldt het wegvallen van één speelapparaat niet (zie Vragen); `hub.js` niet veranderd.

## Wat alleen op de hardware te bevestigen is

- Poort M (de ijkproef van S5): F1–F8 op note:1:0–7 onder de schermlabels, VOLUME/SOLO/MUTE noot aan
  én uit, het wiel ±1 per klik. Alles hier rust op het profiel en de nep-Maschine van de hub.
- Of de deelnamen (5×7, 64 px per vak) leesbaar zijn onder F1–F8, en of 9 px minder scherm stoort.
- Of de fasescoop (4 px/ms, ±32 ms) leesbaar is en klopt met wat je hoort (UITLIJN, met een duw).
- De volgorde en scheefheid met de echte USB-HID van de Maschine en de echte APC (andere tijden).
- Of de violette fx-matrix en de deelkleur op de echte APC even helder zijn als op het scherm.

## Zelf een deel op de Maschine inrichten

Stap voor stap met voorbeeld-JSON: `docs/werkruimte/S6.md` §3. Kort:

1. Een stuk `mappings/stukken/mijn-maschine.json` met regels in een laag (`pads.<x>`, `pagina.<x>`,
   `wiel.<x>`, `houd.<x>`), zoals een APC-regel (`trigger`, `relative-2c`, `druk`/`latch` met `naar`,
   `stappen`, `shift`).
2. Een nieuwe naam melden als mapje (`"maschine-mk2.pads.dub": { "naam": …, "kiesknop": { "in": "note:1:22" } }`),
   een houd-knop met zijn knop als kiesknop.
3. In de werkruimte: het stuk bij `stukken`, en per deel `"maschine-mk2": { "pads": …, "pagina": …, "wiel": …, "scherm": [ … ] }`.
4. Bekijken zonder aanzetten: `maschine.html` / `apc.html` (kiezer bovenaan) en `spiekbrief.html?werk=<naam>`.

## Vragen voor Clay

1. **De Maschine weg terwijl de hub blijft.** De hub zegt VARVE niet dat één speelapparaat wegviel.
   Moet de hub dat melden (een bericht per apparaat, dan zet `hub.js` de speelpoort op
   `disconnected`)? *Advies: ja, in de hub (§17); dan werkt de terugval naar apc-alleen vanzelf.*
   Tot dan valt `twee-handen` alleen terug als de hub zelf wegvalt.
2. **Een wiel dat racks of secties kiest.** `stappen` kent alleen `.fwd`/`.back`. Mag `stappen`
   (mapping.js, S4) ook `.next`/`.prev` proberen? *Advies: ja, klein en in één plek.*
3. **De onderregel van de schermen** valt in een werkruimte weg (9 px voor de deelnamen). Goed zo, of
   liever de deelnamen alleen tonen zolang je een F-knop vasthoudt? *Advies: eerst zo proberen.*
4. **SHIFT + pad in SCENE = als loop** alleen in een werkruimte (zonder werkruimte bleef het zoals het
   was). Ook zonder werkruimte? *Advies: ja na de proefavond, dan is shift overal hetzelfde (A2).*
5. **Welke padmodi en pagina's wil je echt?** Het voorbeeld heeft er één van elk. *Advies: begin met
   de worpen in FX en de pagina uitlijn, en vul de rest na avond C in.*

## Opties voor een volgende versie

- Padmodi, pagina's en wielen volledig als data, ook STEP/SCENE/SAMPLING als regels (E2).
- `stappen` met `.next`/`.prev` (vraag 2), zodat FX-wiel = rack en SECTIES-wiel = sectie data wordt.
- `volgt` voor de Maschine (STEP of SCENE kiest een deel), met `bij()` in de adapter.
- Schermsoorten per deel als data (strip, rack, super, stems … met hun eigen indeling).
- De kaart in een oefenmodus ("druk de knop voor X").
- De APC-kaart live laten volgen welke werkruimte de mixer heeft (nu: kiezen).

## Review

Twee subagenten, ronde 1, op de diff t.o.v. `origin/werkruimte/integratie`:

**(a) correctheid en de regels**: niets blokkerends; één "moet" en vijf "kan". Opgelost:
- MOET: in een werkruimte viel de onderregel weg, en daarmee meldingen als "T1 speelt: druk nog eens"
  (de vraag om een tweede druk). Nu staat een melding zolang bovenaan, omgekeerd, in plaats van de
  deelnamen (`metDeelLabels`; check in `maschine-delen.test` "review ronde 1").
- `adapter.mapjes()`/`zetMapjes()` controleren eerst of de padmodus, pagina of wiel nog bestaat
  (anders "herstelde" een herlaad een weggehaalde padmodus).
- `layer.pads.stap` (de werk-naam) maakte een dode padmodus "stap"; nu = STEP, en het lampje leest de stand.
- De fasescoop vroeg ook de getallen (muziek Δ) als geen scherm die toont: de sleutel liep elke tik
  en reken.js rekende muziek Δ 30×/s. Nu alleen wat een scherm toont (bij alleen de scoop: alleen bpm).
- Race in de voorbeeldkiezer van apc.html (twee snelle keuzes): alleen de laatste telt.
- Niet opgelost (zeldzaam, staat er ook op de APC): een data-pad vasthouden terwijl de MAPPING opnieuw
  laadt én de focus wisselt: het loslaten gaat dan naar de nieuwe focus (`Mapping._laad` wist `vast`).

**(b) acceptatie en bewijs**: twee blokkerende punten, allebei afgehandeld:
- `docs/werkruimte/S6.md` ontbrak in de versie die hij las (nu gecommit).
- "Maschine weg → apc-alleen" werkt niet met de echte hub: de hub meldt het wegvallen van één
  speelapparaat niet aan een lease-app. Nu eerlijk in de proef (de stap heet GESIMULEERD en zegt dat er
  met de echte hub niets gebeurt), in S6.md §6 en als vraag 1 hieronder. Ook: een SOLO die vastzat
  tijdens het uittrekken blijft dan open, ook voor de APC (houd.js ziet geen loslaten).
- Niet blokkerend, overgenomen in de tabel: de 33 ms is alleen als mediaan gehaald (de staart zit ook
  zonder de Maschine, in het deelwissel-mechaniek van S3 en het renderen in deze container); de kleur
  van het deel is alleen bij FX te zien; de banken meten zonder stukken en de LED-tik is in een drukke
  container niet op ±10% te beslissen; de volgordemarge van ~3,6 ms.

Na de fixes: alle Maschine-tests groen, verschilproef opnieuw 0 verschillen, `werk-maschine.mjs` groen
(scheefheid p99 10,3 ms). Een tweede ronde is niet gedraaid: de fixes zijn klein en elk heeft een check.

## Tests

`TMPDIR=$S/tmp VARVE_HUB_REPO=~/av-app-hub VARVE_CHROME=$S/chrome.sh node test/alles.mjs`:
**113 bestanden, 10056 checks (na de reviewfixes; daarvoor 10051), 8 overgeslagen, 3 rood**, precies de bekende van deze container:
`renderblok` "keylock met wissels" (afval per bericht), `wachtrij` "yt-dlp en zijn kind" (2×),
`instrumenten-fm-schaal` "geen afval per blok". Reviewer b zag dezelfde drie op een `git archive` van de basis.
`werkruimte.test` (een `@alleen`-wandkloktest van S3) wankelde in de review onder belasting; alleen groen.

Headless, met deze tak: `speelapparaten.mjs`, `bladeren.mjs`, `maschine-sampler.mjs`, `maschine-kaart.mjs`,
`werkruimte.mjs`, `werk-maschine.mjs` groen. `sec-maschine.mjs` geeft 2 FOUT ("op de maat … doorlopend",
"in de aanloop"), op de basis (`git worktree` van origin/werkruimte/integratie) precies dezelfde 2, twee
keer gedraaid: een tijdsproef die in deze container niet haalt, niet van S6.

## Commits

`git log --oneline origin/werkruimte/integratie..werk/S6` (de mechaniek, de kaarten en spiekbrief, de
headless proef en de bank, de docs, de reviewfixes en dit verslag).
