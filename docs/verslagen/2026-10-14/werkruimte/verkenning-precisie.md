# Verkenning "precisie": een track op de juiste plek, en alle tracks zien lopen (13 okt)

Verkenner precisie, tak `studio/afmaken` (339310b). Alleen gelezen; niets in de repo gewijzigd.
Twee kleine metingen in `werkruimte/meet/`: `uitlijn-reken.mjs` (rekenwerk van een uitlijnweergave,
Node) en `teken.html` (tekenkosten van acht banen, headless Chromium ZONDER GPU: alleen de
verhoudingen zeggen iets, de absolute ms niet voor de M1). Clay's punten: **3** ("meer controle over
de track zodat ik hem op de juiste plek kan zetten met precisie") en **4** ("alle tracks tegelijk
zien lopen, wat er met het grid en de tracks gebeurt, om ze op de juiste manier gelijk te laten
lopen"). Raakt ook 1 (welke knop) en 2 (iPad).

## 0. In het kort

- Het **gereedschap** om een track te verzetten is er bijna allemaal, maar het zit op de verkeerde
  plek voor fijn werk: de APC heeft alleen **bend** (±4 % zolang je drukt) en de **tempo-encoder**
  (0,1 % / 0,01 %); de **50 ms-nudge** zit alleen op het toetsenbord; er is **geen draaiknop die
  de fase verzet**, geen jog/scrub, en de Maschine doet niets met transport.
- Het **zien** is het grootste gat: één fasewijzer van 70 px voor alleen de focus-track (7,5 ms per
  pixel, het getal staat alleen in de tooltip), de acht banen tonen het HELE nummer (niet
  uitgelijnd, geen tellen). Er is geen weergave waarin je twee tracks op dezelfde tel naast elkaar ziet.
- Het **echte** probleem bij gelijk laten lopen is meestal niet "grid tegen grid" (sync rekent dat
  exact uit), maar "grid tegen de muziek": sync zet de GRIDS gelijk; ligt het grid van één track
  10 ms naast zijn kicks, dan flamt het. De app meet dat al per track (Beat This!-tellen,
  `afwijkingBij`), maar laat het niet zien TUSSEN tracks.
- Voorstel: **(1)** een uitlijnweergave in TELLEN van de maatgever, met paginamodus (de lijnen
  staan stil, alleen een speelkopstreep beweegt) zodat hij bijna niets kost; **(2)** een
  "vouw"-variant (fasescoop) die alleen per tel tekent; **(3)** één nieuwe value-action
  `track.N.phase.offset` (fase t.o.v. de maatgever, 0,5 = gelijk) die op een draaiknop zowel
  duwt als op de LED-ring de fase TOONT; **(4)** een mappingmodus "stappen" (encoder → trigger per
  klik) voor jog/scrub/library; **(5)** de audio-fase tussen tracks uit de gevonden tellen.
  Alles data (mapping), geen nieuwe dependency, de engine blijft blind voor MIDI/DOM.

## 1. Hoe zet je nu een track op de juiste plek (a)

| middel | action / code | hand nu | kleinste stap | snelheid | opmerking |
|---|---|---|---|---|---|
| springen (klik) | `track.N.seek` value = tracktijd/duur (`actions.js:641`) | klik op overzicht of baan (`vensters.js:111`, `spiegel.js:132`) | 1 px van het overzicht (5 min op ~300 px ≈ 1 s) | meteen | als MIDI-CC: 1/127 van de duur (≈ 2,4 s op 5 min). Absoluut: onbruikbaar voor fijn werk |
| nudge | `track.N.nudge.back/fwd` = `deck.nudge(±0.05)` (`actions.js:611`, `deck.js:564`) | alleen toetsenbord Z/X en , . (`keyboard.js:23,37`) | **50 ms**, vast | meteen (4 ms overvloei in de streamkern) | fasebehoudende seek (`doorlopend`); met keylock gepland op het zoekrooster (63–98 ms later, exact). 50 ms = ~1/10 tel op 124: te grof voor de laatste ms |
| bend | `track.N.bend.back/fwd` (`actions.js:615`, `deck.js:602`, `BEND = 0.04` `deck.js:33`) | APC Nudge −/+ | 4 % × hoe lang je drukt: 100 ms = 4 ms, 1 s = 40 ms | 40 ms per s drukken; een kwart tel (121 ms) = 3 s | precies terug bij loslaten (rate blijft). Eén snelheid, geen versnelling. Niet op het scherm, niet op het toetsenbord, niet op de Maschine |
| tempo | `track.N.tempo` (`actions.js:637`), mapping `relative-2c` step 1/1500 | APC tempo-encoder; shift = fijn | 0,1 % rate (shift 0,01 %) = 0,124 / 0,012 bpm op 124 | per klik | 0,01 % rest = 6 ms drift per minuut |
| pitchfader | `track.N.pitch` | scherm (`index.html:83`, step 0,0005) | 0,016 % op ±16 % | slepen | staat in de top-40 (658×), vaker dan de encoder (152×): de muis wint nu |
| sync | `engine.sync(id)` (`engine.js:698`) | APC Solo 1–8 | tempo exact op de bpm van de maatgever, fase binnen ±½ tel | één keer | **eenmalig** (geen sync-lock: een tempowissel in de kaart van de maatgever volgt hij niet), **niet op de maat** (alleen de tel: de "1" kan een tel naast liggen), alleen op GRIDS |
| beatjump | `deck.beatjump` (`deck.js:892`), `SPRONG_TELLEN` 1–32 (`deck.js:39`) | APC Bank ◀ ▶, shift = lengte | 1 tel | meteen, fasebehoudend | geen ½ of ¼ tel |
| hotcue + quantize | `_faseDoel` → `metFaseVan` (`deck.js:842`) | pads (grid.hotcues) | fasebehoudend | meteen | zetten met quantize snapt op de tel |
| tel 1 hier / grid ‹ › / pin | `track.N.grid.*` (`actions.js:279-330`) | APC grid-modus: Nudge ±5 ms (shift 1 ms), encoder 0,01 bpm | 1 ms, 0,01 bpm | per klik | verzet het GRID, niet de track. Snapt ±30 ms naar een klap |
| starten op de maat | `track.N.play.quant` | Shift + activator | sample-exact op de "1" van de maatgever | — | de tel van het startpunt valt op de "1" |

**Wat je op het scherm ziet tijdens het gelijkzetten** (`renderloop.js:209-220`, `styles.css:471`):
een balkje van 70 px met een wijzer over ±½ tel (≈ 7,5 ms per px op 124 bpm), groen onder 6 ms,
het getal in ms alleen als tooltip; alleen voor de FOCUS-track; gerekend op de grids
(`engine.faseVerschil`, `engine.js:752`), niet op de muziek. De sync-knop brandt "gelijk" bij
< 0,05 bpm verschil (`actions.js:222`): op 124 bpm is dat ~0,04 % = tot ~24 ms drift per minuut terwijl hij
"gelijk" zegt.

**Wat ontbreekt (gemeten in de code, niet gegokt):**

1. **Een draaiknop die de fase verzet.** Op de APC is er geen; bend is tijd × druk en dus grof
   als je een vaste afstand wilt. De 50 ms-nudge (de enige "afstand") is te grof en zit niet op
   hardware. ONTBREEKT B6 ("fijn zoeken in pauze") staat sinds 2 okt open.
2. **De fase zien zonder naar de focus te wisselen.** Alleen de focus-track heeft een wijzer.
3. **De maat.** Sync zet de tel, niet de "1"; nergens staat "track 3 ligt een tel naast de maat".
4. **Grid-fout tegen muziek-fout uit elkaar houden.** De wijzer zegt 0 ms terwijl de kicks 12 ms
   flammen als één grid naast zijn muziek ligt. De bouwstenen bestaan: `afwijkingBij`
   (`tellen.js:452`, mediaan van de laatste 16 gevonden tellen tegen het eigen grid) en de
   live ⚠ N ms naast de bpm (BEATGRID.md §11) — maar per track, nooit TUSSEN twee tracks.
5. **Drift zichtbaar.** Er is geen "loopt 3 ms per 16 tellen weg"; je merkt het aan de flam.
6. **Scrub/jog.** `track.N.seek` is absoluut over de hele duur; een relatieve encoder erop zou een
   stap per seconde nummer vragen (de mapping moet dan de duur kennen: botst met regel 2). Geen
   golfvorm slepen. Scratchen (geluid dat de hand volgt) bestaat niet (ONTBREEKT D2).
7. **De Maschine** doet niets met transport of fase: masterwiel = instrument kiezen of bladeren
   (`maschine.js:377-381`), TEMPO, VOLUME, SWING, AUTO, ALL en NOTE REPEAT zijn VRIJ (HANDEN.md,
   tak `visie/handen`).
8. **"Duw tot het klopt" met je oor.** De controleklik (BEATGRID.md §11) tikt de gridlijnen van
   ÉÉN deck. Een tik van de maatgever tegen een tik van de track (hoog/laag) in de koptelefoon,
   zodat je de flam hoort, bestaat niet.

## 2. Voorstellen voor precisie (a)

Volgorde = wat het meest oplevert per regel code. Elk voorstel: eerst `define()` in `actions.js`,
dan mapping (data), dan scherm. De engine krijgt alleen getallen (regel 1 en 2).

**P1 `track.N.phase.offset` (value, de fase als stand).** `read()` = (fase t.o.v. de maatgever /
één tel) + 0,5, dus 0,5 = gelijk, 0 / 1 = een halve tel ervoor / erachter, null zonder grid,
zonder maatgever of als dit de maatgever is. `invoke(v)` = duw met `deck.nudge((v − read()) × tel)`
(bestaat, fasebehoudend, binnen de loop). Waarom zo en niet in ms:
- De mapping weet niets van ms (regel 2), en een fractie van de tel is muzikaal: een stap van
  0,002 is op 124 bpm ~1 ms, op 174 bpm ~0,7 ms — op elke bpm "even fijn".
- `_relative` in `mapping.js:772` doet al read + stap → invoke, en de APC-knoppen in `endless`
  tellen het verschil op bij de softwarestand. Dus een device knob of ringknop werkt meteen,
  zonder nieuwe mappingcode.
- De LED-ring LAAT DE FASE ZIEN: ring-type `pan` (`devices/apc40mk2.js:99`) = middelste LED is
  "gelijk". Een mapje (bijv. `device.uitlijn`) met device knob k = `track.k.phase.offset` geeft
  acht fasemeters op het apparaat, en draaien = duwen. AANNAME: 15 LED's over ±½ tel is op 124 bpm ~32 ms
  per LED; de read moet daarom niet-lineair (dicht bij 0 fijner), anders zie je de laatste 10 ms niet.
- Handelingenlog: een value-action staat er vanzelf in en speelt terug als "deze fase t.o.v. de
  maatgever" — robuuster dan een sprong in seconden.
- Niet op een fader (soft-takeover op een read die met drift meeschuift is onzin): alleen
  `endless`/`relative-*`. In de mapping-documentatie zetten.

**P2 nudge-klikken samenvoegen.** Elke klik is nu een seek = nieuw segment + 4 ms overvloei
(zonder keylock) of een gepland segment op het zoekrooster (met keylock). Een encoder geeft tot
~50 berichten/s. Voorstel: in `deck.nudge` de klikken binnen één blok/frame optellen tot één seek.
Te meten: met keylock aan (KEYLOCK.md §9: segment met zeven velden, `rekPlanT`) en zonder, in
Chrome (`tools/headless/*`). Als de overvloei hoorbaar blijkt: later een "buig precies d
seconden"-segment (rate × (1+k) van T tot T+d) — dat raakt het audiopad (vaste segmentvorm,
gouden hash, 0 GC), dus pas als P1 + P2 tekortschiet.

**P3 bend sterker/zwakker en op meer plekken.** `track.N.bend.amount` (value, 1–16 %,
standaard 4 %) en bend op het toetsenbord (nu alleen nudge). Klein. Over het netwerk (iPad) GEEN
bend: het effect hangt af van hoe lang je drukt, en wifi-jitter maakt dat onvoorspelbaar; daar
P1 (een afstand, ongevoelig voor vertraging).

**P4 mappingmodus "stappen" (encoder → een trigger per klik).** `{ mode: 'stappen', actions:
[terug, vooruit] }` in `mapping.js`: elke klik van een relatieve encoder roept de ene of de andere
trigger aan. Data, en nuttig voor veel meer dan precisie: jog (`track.N.scrub.back/fwd` = 1/16
tel, met shift 1/64 tel, ook in pauze = ONTBREEKT B6), library bladeren op de APC (ONTBREEKT B10),
beatjump, secties. Het masterwiel van de Maschine kan zo via de mapping in plaats van in code
(`maschine.js`). De bestaande `nudge.back/fwd` (50 ms) blijft voor het toetsenbord.

**P5 sync die blijft (optioneel, met vraag aan Clay).** Nu eenmalig. Een track die gesynct is en
waarvan de maatgever een stukgrens van zijn tempokaart passeert, loopt daarna weg. Voorstel:
`deck.volgtMaat` (aan na een geslaagde sync, uit bij tempo-encoder/pitchfader/bend? nee — bend
mag), en de engine zet de rate opnieuw bij elke stukwissel van de maatgever (heranker-moment, geen
timer: regel 3). Raakt de auto-DJ (OVERNEEM) en het log. Vraag: wil Clay een "sync-lock"
(Traktor/Rekordbox hebben het) of juist niet (live opnames, rubato)?

**P6 de "1" meenemen.** Na sync de MAAT-afwijking melden ("track 3 ligt 1 tel naast de maat") en
een knop "op de maat" = beatjump van 1–3 tellen naar de dichtstbijzijnde "1" (`barPhase`,
`telInMaat`; nooit `beat % beatsPerBar`, BEATGRID.md §3). Of sync met shift = tel én maat.

**P7 de controleklik voor twee.** `gridControleDeck` (engine) tikt nu één grid. Een tweede stand:
hoge tik = de tel van de maatgever, lage tik = de tel van de focus-track, in de koptelefoon. Dan
hoor je de flam en duw je (P1) tot het één tik is. Hergebruik van wat er staat; vraagt de
koptelefoonuitgang (zonder: in de zaal, zoals nu).

**P8 sync-lampje eerlijker.** `< 0.05 bpm` → `< 0.005 bpm` (≈ 2,4 ms/min op 124) of de drift in
ms per 16 tellen als read. Klein, maar het lampje liegt nu.

## 3. Alle tracks tegelijk zien lopen (b)

### Wat er nu is

- **Zoom** (`WaveformView` mode 'zoom', `waveform.js:271-356`): alleen de focus-track; as in
  SECONDEN (`pxPerSecond` 170, scrollwiel 40–2400, `vensters.js:139-142`); gridlijnen (de "1"
  voller), stukgrenzen met bpm, klappen onderin, gevonden tellen (groen) bovenin, loop, cue,
  hotcues; speelkop in het midden.
- **Overzicht** + **acht banen** (`BaanView`, `waveform.js:375`): het hele nummer, positie,
  loop, hotcues, zekerheidsstrook. Geen tellen, niet uitgelijnd.
- **Peaks**: 256 samples per bucket = 5,3 ms (`peaks.js:8`). Op de standaardzoom ~1 bucket per px;
  op 2400 px/s is een bucket 13 px breed (blokkig). Geen kleur per band (ONTBREEKT B14), dus een
  kick is niet van een hihat te onderscheiden — en kicks zijn wat je uitlijnt.
- Alles tekent op `d.position` (de audioklok), NIET op wat je hoort (`hoorbaar.js`). De speelkop
  staat dus een uitgangsvertraging vóór het geluid. Voor uitlijnen tussen tracks maakt dat bijna
  niets uit (iedereen schuift evenveel, verschil = V × Δrate ≈ 1 ms bij 5 % tempoverschil), maar de
  regel "wat je hoort staat op één plek" geldt hier niet. Een nieuwe weergave moet `hoorbaar()`
  gebruiken.
- Tekenen gaat alleen als de sleutel verandert (`zelfde()`, `waveform.js:212`): goed. Maar de
  sleutel bevat `JSON.stringify(grid)` per weergave per frame (`_gridTekst`, regel 284/385), en
  `engine.snapshot()` maakt elke frame `grid.toJSON()` voor acht decks (`engine.js:773`). Met een
  tempokaart van 100 stukken (live opname) is dat negen keer stringify per frame. `deck.gridVersie`
  (`deck.js:173`) bestaat al als goedkope sleutel. Niet gemeten; wel een kans.

### De uitlijnweergave (voorstel)

**As in TELLEN van de maatgever.** x = tel van de maatgever ZOALS JE HEM HOORT
(`beatAt(hoorbaar(M))`), bijvoorbeeld −4 … +4 tellen of 2 maten. Eén tel is overal even breed,
welke bpm ook. Per spelende (of klaarstaande) track één baan eronder.

**Rekenregel per baan (regel 3, geen eigen teller):** de baan van track i op tel x van de
maatgever toont de tracktijd die je HOORT op het audioklokmoment waarop de maatgever tel x laat
horen. Dat is `positieIn(seg_i, vorig, t) − V × rate`, met t = nu + (x − x_nu) × hoorbare tel van
de maatgever en `seg_i` het segment {T, P, R, loop, speelt, rem, rek} van de bron
(`bron.js:532`, `stream-kern.js:113`). Loops, een rem, een wachtende start op de maat: het segment
weet het al, de weergave hoeft niets apart te doen. `bron._segId` (`bron.js:714`) telt bij elk
nieuw segment: precies de sleutel om te weten wanneer opnieuw tekenen nodig is.

**Wat er per baan staat:**
- de golfvorm (liefst de lage band, zie B14; anders min/max zoals nu);
- de gridlijnen van DIE track op haar eigen tellen, de "1" voller — vallen ze op de lijnen van de
  maatgever (achtergrond, over de hele hoogte), dan is het grid gelijk;
- de gevonden tellen (groen, `deck.tellen`) en klappen (`deck.onsets`): vallen DIE op de lijnen
  van de maatgever, dan klinkt het gelijk, wat de grids ook zeggen;
- links drie getallen: **grid** Δ in ms (`faseVerschil`), **muziek** Δ in ms (P9 hieronder),
  **drift** in ms per 16 tellen ((bpm_i − bpm_M) / bpm_M × 16 tellen), plus de maat-afwijking in
  tellen ("+1") als hij er is;
- loop gearceerd, hotcues, de stukgrens en zekerheid (strook) van zijn grid.

**P9 muziek-fase tussen twee tracks** (puur, nieuw, klein): de mediaan over de laatste ~8
gehoorde tellen van (tijd van gevonden tel van i − tijd van de dichtstbijzijnde gevonden tel van
de maatgever), beide omgerekend naar de audioklok met `ctxTimeOf`. Dat is wat je hoort als flam,
los van de grids. Valt "grid 0 ms, muziek 12 ms" op, dan zegt de weergave welk grid naast zijn
muziek ligt (`afwijkingBij` per track) en dus welke je moet vastzetten (pin). Alleen met tellen
(Beat This!) op beide; met alleen klappen grover (±15 ms ijking).

**Twee vormen:**

1. **Pagina** (standaard, voorstel): het venster staat stil op een maat (of twee) van de maatgever
   en slaat om bij de volgende; alleen een speelkopstreep loopt eroverheen. De streep is een
   element met een CSS-transform (compositor, geen canvas). Opnieuw tekenen alleen bij omslaan,
   een nieuw segment van een baan (seek, nudge, bend, tempo, loop), een grid- of zoomwissel. Voor
   uitlijnen is dit ook BETER om naar te kijken: wat gelijk loopt staat stil onder elkaar.
2. **Vouw** (fasescoop): per track één rij van één maat breed; elke gehoorde tel (klap of gevonden
   tel) komt erin op zijn fase t.o.v. de maatgever en dooft langzaam. Gelijk = een smalle stapel op
   de lijn; drift = een spoor dat schuin wegloopt; flam = twee stapels. Tekenen alleen per tel.
   Past ook op de 1-bit schermen van de Maschine (256 × 64, `maschine-scherm.js`).

Scrollend (zoals Rekordbox "stacked") kan als derde keuze, maar is de dure.

### Wat kost het

| vorm | pixels (8 banen × 1200 × 48 css px, dpr 2) | wanneer | ≈ Mpx/s |
|---|---|---|---|
| scrollend, 60 fps | 1,84 Mpx per beeld | elk beeld | **~110** (5 okt: 29 Mpx/s in rust halveerde Demucs) |
| scrollend, dpr 1, 30 fps | 0,46 Mpx | elk beeld | ~14 |
| pagina (1 maat op 124 bpm) | 1,84 Mpx | ~0,5×/s + per segmentwissel | **~1** + de streep (compositor) |
| vouw | 8 × 200 × 40 × 4 = 0,26 Mpx | per tel (~2×/s) | ~0,5 |

Gemeten in deze container (`werkruimte/meet/`, software-rendering, alleen de verhouding telt):
- rekenwerk voor acht banen × 1200 px (positieIn + peaks + gridlijnen): **0,25 ms per beeld**
  (`uitlijn-reken.mjs`) — het rekenen is nooit het probleem;
- tekenen per pixel met `fillRect` (zoals `tekenGolf` nu): **10,3 ms per beeld** voor acht banen;
  één pad met `rect` + `fill`: 64,7 ms (slechter); **de golf één keer in een strook tekenen en per
  beeld met `drawImage` het stuk eruit halen: 1,7 ms** (`teken.html`). Dus: per track een
  voorgetekende strook in tracktijd (in tegels, een album past niet in één canvas), en per beeld
  alleen `drawImage` met schaal = hoorbare tel × rate. Een andere rate is een andere schaal, geen
  nieuwe strook.
- Zwaarder geschut als het ooit moet: WebGL2 (bestaat al in `video-mixer.js`): peaks één keer als
  textuur, per beeld alleen uniforms (tel, fase, rate per baan). Niet nodig voor pagina/vouw.

### Los venster en iPad

- **Los venster op de Mac** (`uitlijn.html`, zoals `video.html`/`plan.html`/`maschine.html` via
  `window.opener`): leest engine, analyses en segmenten rechtstreeks. Let op: zelfde origin = zelfde
  renderproces en dezelfde hoofdthread (BEAMER.md: "zelfde thread"), dus het spaart GEEN CPU; het
  spaart wel ruimte op het hoofdscherm, en het blijft tekenen met het hoofdtabblad verborgen.
- **iPad**: ideaal voor deze weergave, want hij tekent op ZIJN GPU. De mixer hoeft alleen per
  verandering te sturen: per track het segment {T, P, R, loop, speelt, rem}, grid-JSON bij een
  gridwissel, de id van de maatgever, V (uitgangsvertraging). Peaks (`/media/<id>/peaks.bin`, al op
  de witte lijst), klappen en tellen haalt de iPad zelf van de server. Met een klokverschil
  (ping/pong, zoals de Stroommachine) rekent de iPad `positieIn` zelf: regel 3 over een
  netwerkgrens, zoals al over de draadgrens in de streamkern. Geen posities per beeld over wifi.
  Zie verkenning-scherm §3-4 voor het relais (0,13 ms) en de routes.
- Bedienen vanaf de iPad: P1 (een afstand) ja, bend nee (zie P3). Slepen van een baan = P1 met
  de versleepte fractie van een tel: precies, en ongevoelig voor netwerkvertraging.

## 4. Toets aan VISIE §5 en de drie regels

| | |
|---|---|
| pijler | 1 (dj'en) direct; 4 (zelf instellen) via de mapping: P1/P4 zijn data, Clay kiest de knoppen |
| draagbaar | niets erbij in de tas; de iPad is optioneel en alleen-lezen is genoeg voor de eerste stap |
| zelf instellen zonder code | P1, P3, P4, P6 = actions + mappingregels; de weergave is een paneel (verkenning-scherm §5) |
| op de hardware geproefd | NEE, niets hiervan. Te proeven: de pan-ring als fasemeter (leesbaar? genoeg LED's?), hoe een encoder-duw klinkt met en zonder keylock, bend-sterkte |
| regel 1 | engine krijgt `nudge(seconden)` en een rate; de weergave LEEST (zoals `video/`, `koppel/`) |
| regel 2 | `phase.offset` 0..1 (fractie van de tel); bend-sterkte 0..1; de engine schaalt |
| regel 3 | weergave en iPad rekenen uit het segment op de audioklok; geen eigen teller; P5 alleen op heranker-momenten |

## 5. Advies (volgorde)

1. **Uitlijnweergave, pagina-vorm, alleen lezen**, eerst als paneel in de mixer en als los venster;
   met de drie getallen per baan (grid Δ, muziek Δ = P9, drift) en de maat-afwijking. Dit is
   Clay's punt 4 letterlijk, en het maakt meteen zichtbaar of het probleem het grid of de muziek is.
2. **P1 `track.N.phase.offset`** met de pan-ring (mapje met acht fasemeters) + **P2** samenvoegen.
3. **P4 mappingmodus "stappen"** (jog/scrub in pauze, B6; ook de Maschine-wiel en library).
4. P6 (maat), P7 (dubbele klik), P8 (lampje) — klein.
5. iPad-weergave via segmenten (na de schrijfkant van verkenning-scherm, of eerder: alleen lezen).
6. P5 sync-lock pas na een vraag aan Clay; "buig precies d seconden" pas als P2 hoorbaar tekortschiet.

## 6. Risico's en aannames

- **AANNAME**: een seek van 1 ms met 4 ms overvloei is niet hoorbaar; snel draaien = veel segmenten.
  Met keylock elke klik een gepland segment (~98 ms rooster): klikken stapelen zich op. Meten.
- **AANNAME**: de pan-ring van de APC is leesbaar als fasemeter; 15 LED's, niet-lineair schalen.
- `phase.offset` heeft een read die met drift meebeweegt: nooit op een fader (soft-takeover).
- Een uitlijnweergave die scrollt op 60 fps kost ~4× de GPU-last die Demucs op 5 okt halveerde.
  Pagina-vorm of tekenen op de iPad voorkomen dat; de sleutel moet `_segId` en `gridVersie` zijn,
  geen stringify.
- De muziek-fase (P9) hangt aan de gevonden tellen (Beat This!, ~5–7 ms mediaan); zonder model
  (`~/.varve/modellen`) alleen klappen (±15 ms) — dan grover, en dat moet erbij staan.
- Sync-lock (P5) botst mogelijk met de auto-DJ (die zet zelf rate/glijden) en met OVERNEEM.
- Een tweede venster op de Mac deelt de hoofdthread met de mixer (MIDI-lag; de andere workflow
  meet controller-invoer in `wt/controller-invoer`, `tools/headless/latentie.mjs`).
- Mijn metingen zijn software-rendering in een container; de M1 met GPU zal anders uitkomen.
  Opnieuw meten in echte Chrome met `tools/headless` voor een besluit.
