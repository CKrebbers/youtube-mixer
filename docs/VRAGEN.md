# Open vragen voor Clay

Stand: 25 september 2026. Open: A2, A3 (keylock-luistertest staat klaar), F1, H3,
H5 (deels beantwoord), I1–I4 (keylock na het luisteren) en het nieuwe blok J (keuzes
uit de sporen van 25 sep). G1–G6, H1, H2, H4 en H6 zijn beslist; de toonsoort- en
keylockkeuzes staan in blok I. Per vraag: wat er speelt, de opties, mijn advies, en wat er
nodig is om hem te beantwoorden. Afvinken zodra beslist; het besluit komt
daarna in CLAUDE.md of ROADMAP.md.

Legenda — nodig: 🎧 luisteren · 🎛 de APC erbij · 👀 kijken · 💬 alleen een keuze

Nieuwste blokken (14–15 okt): **AR, de architectuurronde** (15 okt), **W, de werkruimte** en **GA, afmaken:
controllers en beatgrid** (hieronder), en achteraan **S9**, **S10**, **S11** en **HA, handen** (de controllers en de
hub-middag, 11 okt, gemerged 15 okt).

---

## W. De werkruimte (14 okt, docs/WERKRUIMTE.md, docs/werkruimte/S0–S8.md, tak werk/S8)

Alle open vragen van de sporen S0–S8, ontdubbeld (bronnen: WERKRUIMTE.md E1, docs/verslagen/2026-10-14/werk-S0…S8.md
en werk-golf2.md). Niets hiervan houdt de proef tegen: waar je niets zegt, geldt het advies (zo is het gebouwd).
De proefavonden staan in de Controlekamer (blokken "Werkruimte · E0 … D").

**Ontwerp**
- [x] **W1. Mag de iPad de mixer bedienen?** 💬 Beantwoord 14 okt: ja ("per onderdeel van een mix anders"), plus een
  xy-pad op de iPhone. Gebouwd in S8 (docs/werkruimte/S8.md): standaard uit, aanzetten in de Controlekamer, koppelen
  met een code, alleen via Tailscale; opnemen, het log, mappings, werkruimtes, library en laden nooit.
- [ ] **W2. Hoe staan de controllers op tafel?** 👀 Maschine links of rechts, links- of rechtshandig? Bepaalt alleen
  welke houd-knoppen het makkelijkst samen gaan, niet de indeling. **Advies:** zeg het na proefavond C.
- [ ] **W3. Effecten die de engine raken** (loop roll/beat repeat op NOTE REPEAT, reverse, effect per stem, extra bus,
  vrije routing)? 🎧 Welk moment in een set mis je nu? **Advies:** niets bouwen zonder een concreet voorbeeld; noteer het
  bij proefpunt E0 als je iets mist.
- [ ] **W4. Op 1440×790 met een rij open krimpt het werkvak tot 9 px** (in feite weg; tools/headless/werkruimte.mjs, deel
  FX met de MASTER-rij). 👀 Het werkvak geeft als eerste ruimte af, zodat faders en rijen heel blijven. Kiezen: zo laten ·
  in dat deel de MASTER-rij niet openzetten (`schermen.hoofd.rijen`) · het werkvak ten koste van de rijen (dan scrollt
  #rijen meer) · het werkvak naar mac-2. **Advies:** zo laten; zet wat je in FX op het werkvak wilt op mac-2 of de iPad.

**Bedienen vanaf iPad en iPhone (S7, S8)**
- [ ] **W5. Wat mag de iPad, wat de iPhone (`schermen.<s>.mag`)?** 💬 Het voorbeeld twee-handen: de iPad de bouwsteen fx,
  mijn-mix en de video-worpen; de iPhone de xy-pad. **Advies:** begin daarmee, breid uit na avond D.
- [ ] **W6. Tijdkritisch blijft uit?** 💬 Bend, play, cue, nudge, hotcues, loop in/out en tap weigert een scherm buiten de
  Mac, tenzij `"tijdkritisch": true`. **Advies:** uit laten (A5: wifi en aanraking zijn tientallen ms).
- [ ] **W7. De schakelaar na een herstart van de server weer uit?** 💬 Nu wel: aanzetten is een handeling, nooit een
  overblijfsel. Gekoppelde apparaten blijven gekoppeld. **Advies:** zo laten.
- [ ] **W8. De iPad: delen kiezen (`werk.deel.*`), maar nooit werkruimtes schrijven?** 💬 Zo is het (werk.kies, terug,
  vastleggen staan in VAST_NOOIT). **Advies:** zo laten.
- [ ] **W9. Standen (`PUT /api/standen`, `…/activeer`) ook alleen vanaf de Mac?** 💬 Nu kan de Controlekamer via Tailscale
  een stand activeren. **Advies:** ja, alleen vanaf de Mac (een kleine wijziging in server/index.js, nog niet gedaan).
- [ ] **W10. Vertraging op de echte iPhone.** 🎧 Headless (loopback, software-GL): POST -> mixer p50 13 ms, p99 38 ms; met
  het tekenen van de pagina erbij p50 ~30 ms, maar een staart tot ~700 ms (aan de kant van de headless pagina met
  software-GL). **Advies:** meten op avond D (proefpunt wd-xy); voelt het traag, dan een
  WebSocket in plaats van POST (volgende versie).
- [ ] **W11. Twee vingers op één xy-pad?** 👀 Nu: één vinger per pad (twee pads = twee vingers). **Advies:** zo laten.
- [ ] **W12. De positie op de iPad binnen 5 ms** is hier niet aan te tonen (de headless audioklok hapert). 🎧 **Advies:**
  meten op avond D; haalt hij het niet, dan de eis p99 ≤ 5 ms maken.
- [ ] **W13. Bouwstenen of eigen panelen?** 💬 **Advies:** begin met de bouwstenen, maak een eigen paneel (✎) waar een
  bouwsteen te veel of te weinig heeft.

**Inrichten (S8)**
- [ ] **W14. Toewijzen in een eigen mapje per paneel (`p-<paneel>`) dat het deel openzet: goed?** 💬 Zo raakt het nooit de
  standaard en doet het alleen in dat deel iets. Let op: het VERVANGT het mapje van dat deel voor die groep (in
  twee-handen FX wordt de Maschine-pagina dan p-dub in plaats van rack; ◄ ► bladert nog naar rack). Aanwijzen door een
  control te bewegen voert die control ook uit (een klik op het scherm niet). **Advies:** zo laten; na de proef kan wat bevalt naar de standaard.
- [ ] **W15. F1–F8 als groep voor een paneel** kan alleen in een werkruimte zonder het stuk maschine-delen (anders kiezen
  F1–F8 het deel). 💬 **Advies:** zo laten.

**Precisie en uitlijnen (S1, S2)**
- [ ] **W16. Duoklik: hoog op de gelijkgezette track, laag op de maatgever** (gebouwd) of andersom? 🎧 **Advies:** zo laten.
- [ ] **W17. "Op de 1" bij gelijkspel: terug** (gebouwd) of vooruit? 🎧 **Advies:** terug.
- [ ] **W18. Precisie op het toetsenbord?** 💬 **Advies:** geen standaard; koppel zelf (S5), na de proef in toetsen.json.
- [ ] **W19. `?uitlijn=1` wordt onthouden.** 💬 **Advies:** laten tot de proefavond, daarna weghalen.
- [ ] **W20. Twee maten per pagina** in de uitlijnweergave (gebouwd) of één? 👀 **Advies:** twee.
- [ ] **W21. Knop "uitlijn" in de transportrij houden** nu het werkvak er is (kost 4 px)? 👀 **Advies:** beslissen op avond A.
- [ ] **W22. Een track zonder tellen: "grof" tonen** (gebouwd) of leeg? 👀 **Advies:** grof, met het label.

**Werkruimte-kern en combinaties (S0, S3, S4)**
- [ ] **W23. De voorbeelden apc-alleen en twee-handen houden?** 💬 **Advies:** alle drie houden tot je een eigen hebt.
- [ ] **W24. De eerste keer "⚠ 74 nieuw": zo laten?** 👀 **Advies:** zo laten (klik = gezien).
- [ ] **W25. "Leg vast" ook op de APC?** 💬 **Advies:** nee (op de balk en met ✎).
- [ ] **W26. Mag een werkruimte een rack op de echo/galmbus zetten (`bussen`)?** 💬 **Advies:** alleen bij een uitdrukkelijke
  keuze in de kiezer, niet bij peilen of opstarten, en alleen als er niets op die bus klinkt.
- [ ] **W27. Twee solo's tegelijk = stilte; moeten solo drums + solo bas die twee laten horen?** 🎧 **Advies:** ja, samen.
- [ ] **W28. Welke racks op de echo- en galmbus?** 🎧 **Advies:** begin met één dub-echo, kies na de proefavond.
- [ ] **W29. ⇧ On/Off in de mapjes master en instrument** opent met de fx-matrix ook daar de fx-matrix (was bypass/stil). 🎛
  **Advies:** daar laten wat het was (een `laag` per regel).
- [ ] **W30. Een worp die vastzit bij het begin van een opname: bij terugspelen ook?** 🎧 **Advies:** nee.
- [ ] **W31. Druk/latch op een toets van het toetsenbord doet nu niets.** 💬 **Advies:** zo laten tot je het mist.
- [ ] **W32. Een superknop met `overneem: true` zonder track laat de auto-DJ altijd los.** 💬 **Advies:** zo (zoals de crossfader).

**Maschine (S5, S6; poort M eerst)**
- [ ] **W33. Koppelen op de Maschine alleen met CONTROL?** 🎛 **Advies:** ja.
- [ ] **W34. De Maschine-pads ook koppelen (padmodus "knoppen")?** 🎛 **Advies:** na de ijkproef (S6).
- [ ] **W35. Mapping bewaren alleen vanuit het tabblad met de APC?** 💬 **Advies:** ja.
- [ ] **W36. Maschine weg terwijl de hub blijft: moet de hub dat per apparaat melden?** 💬 **Advies:** ja, in de hub (§17);
  dan werkt de terugval naar apc-alleen vanzelf.
- [ ] **W37. `stappen` ook `.next`/`.prev`** (een wiel dat racks of secties kiest)? 💬 **Advies:** ja, klein.
- [ ] **W38. De deelnamen op de Maschine-schermen** (de onderregel valt weg): zo, of alleen zolang een F-knop vastzit? 👀
  **Advies:** eerst zo proberen.
- [ ] **W39. SHIFT + pad in SCENE = als loop, ook zonder werkruimte?** 🎛 **Advies:** ja, na de proefavond.
- [ ] **W40. Welke padmodi en pagina's wil je echt?** 🎛 **Advies:** begin met de worpen in FX en de pagina uitlijn.

Zelf gekozen (zeg het als je het anders wilt): acht delen op F1–F8 in deze volgorde; THUIS op ⇧ + master-knop; werkruimte
wisselen alleen vanaf het scherm; fase lineair met een fijne variant op shift; SSE (plus POST voor bedienen) in plaats van
WebSocket; sampler, secties, patronen en auto in twee-handen uit de ▲ ▼-rondgang; de zender vraagt zonder kijker 1×/s of er
iemand kijkt.

---

## AR. De architectuurronde (15 okt, tak `studio/architectuur`, docs/verslagen/2026-10-15/arch-*.md)

Vijf sporen: A audio-gezondheid, B fase en tel 1, C Linux, D de server mag even weg zijn, E kleine opruimingen.

**Beatgrid (B)**
- [ ] **AR1. Kaart-VERSIE 3, zodat de hele library de tweede mening over de "1" krijgt?** 💬 Bij de eerste start
  rekent de server elk automatisch grid uit de tellen opnieuw: milliseconden per nummer plus één keer de lage
  band (~0,5 s per 3 minuten), wachtend zolang er een deck speelt. Tempo, tellen en "1" blijven gelijk; alleen
  staat er bij een verdachte "1" een "?". **Advies:** ja, samen met GA2, op een dag zonder optreden, na de
  meting van AR2.
- [ ] **AR2. Twee metingen op je Mac.** 🎧 (a) het echte Beat This! op de bench (GA3): `node
  tools/beatmeting/synth/bench.mjs --beatthis <python van ~/.varve/tellen-venv>`; (b) het snappen op je eigen
  fragmenten: `node tools/beatmeting/rest/tel1-echt.mjs` (kolom T = naar de tel van Beat This!). De exacte
  opdrachten staan in docs/verslagen/2026-10-15/arch-beatgrid.md §5. Het checkpoint was hier niet te downloaden.
- [ ] **AR3. Twijfel over de "1" en sync.** 💬 Bij twijfel 'maat' mogen sync en beat-loops (tempo en tel
  kloppen); starten op de maat, secties en de auto-DJ gebruiken die "1" gewoon. Liever ook onzeker (sync
  weigert)? **Advies:** zo laten; de "1" zet je met ← 1 / → 1 in twee drukken.
- [ ] **AR4. Vier op de vloer.** 🎧 Een "1" die bij house/techno een tel naast staat krijgt geen "?" (elke tel
  heeft een kick). Komt het bij jou voor? Dan is de bas-toon of de crash de volgende bron. **Advies:** eerst
  kijken of het voorkomt.

**Audio (A)**
- [ ] **AR5. Een vastgelopen effect.** 💬 Bij een fout in een effect-worklet nu alleen een melding (de
  klankschaal bouwt zichzelf bij de volgende aanslag opnieuw, de StreamBron één keer per laad, de limiter valt
  terug op de compressor). Moet een effect zichzelf ook opnieuw opbouwen? **Advies:** eerst zien of het ooit
  gebeurt.
- [ ] **AR6. Audio staat stil.** 💬 De melding is rood tot hij weer loopt, en de eerste druk op de APC,
  Maschine of een toets zet hem weer aan. Ook meteen (zonder druk) een poging? **Advies:** zo laten; zonder
  gebaar weigert Chrome het soms, en dan zie je de melding.
- [ ] **AR7. Het grid in de snapshot als gedeeld object.** 💬 `grid.toJSON()` kost nog ~14–17 kB per beeld.
  Gedeeld kan, maar dan mag niemand het aanpassen. **Advies:** ja, met een check die het bevriest.

**De server even weg (D)**
- [ ] **AR8. Na de merge: VARVE.app opnieuw bouwen** 💬 (`zsh tools/varve-app/maak.sh`), anders start hij de
  server nog zonder lus. Had je de LaunchAgent uit TAILSCALE.md geladen: eerst `launchctl unload
  ~/Library/LaunchAgents/nl.varve.server.plist`. En die LaunchAgent: weg of houden? **Advies:** de lus gebruiken.
- [ ] **AR9. Een herstart van de server in de Controlekamer** ("server herstart om 22:14, 1 keer")? 💬 Nu alleen
  in ~/.varve-server.log. **Advies:** ja, klein.
- [ ] **AR10. Rij vol na 5 minuten weg:** nu valt het OUDSTE stuk weg (je houdt de laatste 5 minuten). Liever de
  eerste 5 houden? 💬 **Advies:** zo laten.
- [ ] **AR11. Vooruit halen met hysterese** (pas na ~30 s niet-hoorbaar terug van 60 naar 20 s)? 💬 Nu haalt een
  fader die even dicht gaat de extra 40 s later opnieuw op. **Advies:** pas als je het ziet.

**Linux (C)**
- [ ] **AR12. Eén keer `node tools/avondpakket.mjs --json` op de Omarchy-pc** 🎛 met de APC eraan (en met en
  zonder lader als hij een accu heeft): dan vervallen de HANDGEMAAKT-fixtures voor Linux.
- [ ] **AR13. Moet het avondpakket op de pc iets eigens meten** (de Stroommachine, de HDMI-uitgang, de verbinding
  naar de Mac), of is "eerlijk grijs" genoeg? 💬 **Advies:** eerlijk grijs, tot de pc mee op reis gaat.
- [ ] **AR14. Node 26.8.2 op de pc** (dan is de suite daar gelijk aan de Mac) of de afwijking accepteren? 💬
  **Advies:** 26.8.2 installeren (`.node-version` staat erin).

**Opruimen (E), alleen voorstellen**
- [ ] **AR15. Binaire schermframes voor de Maschine** in de AV-app-hub (aangekondigd met `kan` in `hallo`)? 💬
  ~56–140 kB/s base64 in JSON. **Advies:** pas na de hub-proef ms-scherm, als die laat zien dat de pads wachten.
- [ ] **AR16. De status-zender rustiger zonder kijker** (het POST-antwoord krijgt `kijker`; zonder kijker 1× per
  4 s, onder VERS_MS)? 💬 **Advies:** klein, maar pas na de proefavond.

**Uit de droogloop van de proefpunten (16 okt, docs/verslagen/2026-10-15/ar-proef.md)**
- [x] **AR17. "stream hapert" tijdens een storing.** 💬 **Gebouwd 16 okt** (`studio/ar-vervolg`): één melding per track met de
  sleutel `stream:<deck>`, die "track N: stream weer goed" wordt bij de eerste pagina die weer binnenkomt (bron.js `onHapert`).
  De vraag was: Is de server even weg, dan krijgt elke hoorbare track één
  rode melding "track N: stream hapert: Failed to fetch" die blijft staan tot je hem wegklikt, naast de ene
  opname-melding die meegroeit (gemeten: 30 s weg, twee tracks = drie meldingen). Het geluid loopt door (60 s
  vooruit). Liever ook één melding per track met een sleutel, die "weer goed" wordt als de pagina's weer komen?
  **Advies:** ja, klein (de sleutel bestaat al: `meld(…, { sleutel })`); eerst zien of het je op de avond stoort.
- [x] **AR18. Een server die HANGT** 💬 **Gebouwd 16 okt** (`studio/ar-hang`): een wachter in de herstartlus peilt elke
  5 s `/api/leeft` (uit het geheugen, 2 s wachten); drie keer niets = kill -9 op de server en wat hij startte, en de lus
  start hem opnieuw (telt mee in de 5 per minuut). Gemeten onder de echte lus met de mixer: 21,2 s van vastzetten tot
  een nieuwe server, 0 stille vensters, WAV zonder gat. Een nieuwe server krijgt 120 s tot zijn eerste antwoord. Een
  schijf die hangt ziet hij bewust niet (een herstart lost dat niet op; de route raakt de schijf niet). Het proefpunt
  ar-hang laat hem nu hangen zonder los te laten. De vraag was: een server die hangt (geen antwoord, wel een poort:
  SIGSTOP, een volle schijf die blokkeert) ziet de herstartlus niet: hij herstart alleen een server die stopt. De mixer redt het 60 s (gemeten: 30 s
  hangen = geen gat, de opname-melding pas na de time-out van 10 s); daarna wordt het stil. Een hang-detectie in
  de lus (bv. `curl -m 2 /api/proef` elke 5 s, drie keer niets = kill -9)? **Advies:** ja, maar pas na de
  proefavond: eerst zien of het ooit gebeurt (CLAUDE.md "De server mag even weg": niet gebouwd).
- [x] **AR19. Het avondpakket op een machine zonder library** — **Gebouwd 16 okt**: op een machine die geen Mac is
  en geen library.db heeft, is backup grijs "geen library"; zonder mediamap gaat de CLI daar door (exit 3 alleen op de Mac);
  "op deze machine" in plaats van "op deze Mac". De vraag was: (de pc) zegt rood "backup: nog nooit" en dus "nog
  niet vertrekken" (exit 2), en zonder `VARVE_MEDIA` stopt hij meteen (exit 3, "geen mediamap"). Op de pc is
  dat vals rood. Grijs maken als er geen library is ("geen library op deze machine")? En zegt de regel "servers"
  daar "op deze Mac". **Advies:** ja, bij het eerstvolgende werk aan het avondpakket; de proef (ar-pakket) zegt
  het er nu bij.
- [x] **AR20. Een tweede server ruimt eerst op, en stopt pas daarna.** 💬 **Gebouwd 16 okt**: de server kijkt EERST of de
  poort vrij is (`server/poort.js`), vóór hij iets op schijf doet; bezet = exit 3 en niets aangeraakt (test/server-poort.test.mjs).
  De vraag was: Start je met de hand een tweede
  `node server/index.js` terwijl er al een draait, dan wist hij bij het opstarten de `.bezig-*`-werkmappen (een
  ingest of split die NU loopt mislukt) en zet hij de stems-rij terug, en pas bij het luisteren ziet hij de
  bezette poort (exit 3). De herstartlus en VARVE.app starten nooit een tweede (ze kijken eerst naar de poort);
  met de hand of met de LaunchAgent naast de lus kan het wel. De poort eerst proberen, vóór het opruimen?
  **Advies:** ja, klein; tot dan: nooit met de hand een server starten als VARVE draait.

## GA. Afmaken: controllers en beatgrid (14 okt, tak `studio/afmaken`, PR #41)

De vragen uit de vier verslagen van afmaken, letterlijk overgenomen en ingekort (bronnen:
docs/verslagen/2026-10-14/beatgrid-analyse.md §8, beatgrid-bediening.md, controller-invoer.md,
controller-uitvoer.md). Waar je niets zegt, geldt wat er gebouwd is. BEATGRID.md §12–13 en APC40.md
leggen de achtergrond uit.

**Beatgrid-analyse** (BEATGRID.md §12)
- [ ] **GA1. Het dansbereik.** 🎧 Hoort Beat This! een nummer op 70–87, dan wordt het tempo nu verdubbeld
  (Ciel 77 → 154, zoals jij tikt). Reggae of downtempo die je echt op 75 telt, krijgt dan ook 150. Is dat
  goed, of draai je genoeg van die muziek om het per krat te willen regelen?
  Aan de bovenkant (181–300) blijft het tempo staan; daar wordt alleen gehalveerd als de downbeats én de
  oude analyse het bevestigen.
  **Advies:** zo laten, en per krat pas als je het mist. Let op: de winst op het DJ-tempo is deels
  op nep-tellen gemeten; daarom bestaat GA3.
- [ ] **GA2. Alle automatische grids één keer opnieuw rekenen bij de eerste start (VERSIE 2)?** 💬
  Dat kost 0,7–4 s per nummer in een worker, voor 300 nummers 4–20 minuten achtergrondwerk, één keer.
  Het wacht zolang er een deck speelt. Grids op slot en grids die met de hand zijn gezet blijven staan;
  bewaarde sampler-pads rekenen mee; lengtes in maten in het setplan niet.
  Zo niet: VERSIE op 1 laten, dan geldt het alleen voor nieuwe nummers en na ↻.
  **Advies:** ja, op een dag zonder optreden.
- [ ] **GA3. Eén keer het echte Beat This! op de benchmark draaien?** 💬 Drie commando's op de Mac
  (beatgrid-analyse.md §1). Dan weten we of de nep-tellen kloppen. **Advies:** ja, vóór GA1 en GA2.
- [ ] **GA4. Krijgt de oude analyse ook een versie?** 💬 Nummers zonder tellen (Beat This! stond er niet
  op toen ze binnenkwamen) houden het grid van de oude analyse, ook op 70–87. Met een versie komen ze
  bij het opstarten in het dansbereik: een paar seconden per nummer in de worker.
  **Advies:** ja, samen met GA2.
- [ ] **GA5. Wat gebeurt er met een dubbel tempo dat niemand bevestigt?** 💬 Telt Beat This! onder 300
  het dubbele tempo en kan de oude analyse het niet bevestigen, dan blijft het tempo van het netwerk
  staan en geldt het als zeker. Sync tegen een nummer op 120 speelt dan op halve snelheid. Boven 300
  wordt gehalveerd, en dat blijft onzeker tot het bevestigd is.
  Is dat goed, of liever een melding "dubbel tempo?" als voorstel?
  **Advies:** de melding, als het in de praktijk voorkomt.

**Beatgrid-bediening op de APC** (BEATGRID.md §13, APC40.md)
- [ ] **GA6. De grid-modus neemt Device ◀ ▶, On/Off, Clip/Device View en Detail View over.** 🎛 Dat zijn
  de "1", controle/✓, tellen hier en ↶. De grid-modus wint dan van elk open device-mapje: rack kiezen,
  effect aan/uit, strip ↔ rack, het master-rack, het instrument, het mapje vorm. De device knobs, Bank
  en de shift-varianten blijven werken. Goed zo, of liever een andere plek? **Advies:** proberen op de
  proefavond.
- [ ] **GA7. On/Off (controleren) op een stilstaand deck.** 🎛 Die zoekt een plek op en drukt op play.
  Zonder koptelefoonuitgang van vier kanalen gaat de tik naar de master, en wie uit gewoonte op On/Off
  drukt, laat de zaal de track en de tik horen. Liever alleen klaarzetten (plek, tik aan, niet starten),
  of zonder koptelefoon weigeren met een melding? **Advies:** alleen klaarzetten.
- [ ] **GA8. Een bewerkt grid op twee tracks met hetzelfde nummer.** 💬 De andere track krijgt het grid
  ook, ook als hij in de zaal speelt (pas na 250 ms rust, één keer). Ook midden in een set, of alleen
  op tracks die niet spelen? **Advies:** alleen op tracks die niet spelen.
- [ ] **GA9. Oranje op "tel 1 hier" = twijfel.** 👀 Genoeg, of bij "geen puls" liever uit of rood?
  **Advies:** zo laten.
- [ ] **GA10. Tap tempo zet na vier tikken het hele grid op slot** (al van vóór afmaken). 💬 Zo laten?
  **Advies:** ja.

**Controllers: invoer** (controller-invoer.md)
- [ ] **GA11 (C1). De latentie in het MIDI-paneel.** 🎛 Wat zegt "latency: … in + … audio" op de Mac met
  de Scarlett? Boven ~15 ms audio ligt het aan de uitgang, niet aan de code.
- [ ] **GA12 (C2). Waar voelde het laggy?** 🎛 De fader (geluid), het scherm dat achterloopt, de lampjes
  op de APC, of knoppen die soms niets deden? Dat laatste past precies bij het echofilter dat nu voor
  noten weg is.
- [ ] **GA13 (C3). Na een avond spelen: `midi.status().echoes` in de console.** 🎛 Staat daar 0, dan mag
  het echofilter voor de APC helemaal uit (zie ook GA15).
- [ ] **GA14 (C4). Mag de LED-tik verder om?** 💬 Optie 1 van controller-invoer raakt feedback.js.
  Het uitvoer-spoor heeft de tik al van 454 naar 45 µs gebracht. **Advies:** alleen als GA12 de lampjes
  noemt.

**Controllers: uitvoer** (controller-uitvoer.md)
- [ ] **GA15. Het echofilter voor de APC uit na één avond meten?** 🎛 Daarvoor is `midi.status().echoes`
  na een sessie nodig (GA13). **Advies:** ja; dat staat ook bovenaan de opties in HANDOFF.
- [ ] **GA16. Laggy: het lampje of de knop zelf?** 🎛 Ligt het aan het lampje (dit spoor), of reageert
  de knop zelf laat (het geluid, de fader)? Dat laatste is het invoerpad. Hoort samen met GA12.
- [ ] **GA17. Eén keer de hub-proef V1 (ring-overname) op de APC?** 🎛 Die beslist of de draaiknoppen in
  het invoerpad anders moeten (endless of absoluut). **Advies:** ja, bij dezelfde meting als GA13.
- [ ] **GA18. Het schermtempo van de Maschine bij draaien.** 👀 Nu ~25 beelden per seconde. Prettig, of
  liever rustiger (100 ms, zoals eerst)?

---

## A. Eerst: wat er nu klaarstaat

- [x] **A1. Committen.** 💬 — gedaan 23 sep, tien commits, elk apart getest.
  Er staat veel ongecommit: sends, sampler, en de hele verbeterronde (engine,
  klikvrij transport, races, server, live-veiligheid, APC-actions, tests).
  **Advies:** nu committen, in een paar logische stukken (sends · sampler ·
  engine-correctheid · klikvrij · server · interface · tests). Hoe langer het
  wacht, hoe moeilijker netjes te splitsen.

- [ ] **A2. Luistertest: streamen, loops, seek.** 🎧
  Alles is gemeten, niets is beluisterd. Tien minuten: een album spelen,
  springen in de golfvorm, hotcues, loops van 4 tellen, pitch schuiven.
  Hoor je ergens nog een tik of gat?

- [x] **A3. Luistertest: keylock (Signalsmith-demo).** 🎧 — 5 okt, Clay: "klinkt goed".
  Keylock is gebouwd (`docs/KEYLOCK.md` §9).
  Staat al sinds fase 3 open. Een kwartier met de demo op je eigen ambient,
  ±5% en ±8%. Beslist of keylock Signalsmith wordt. Daarmee is fase 3 af.
  **Klaar om te luisteren (24 sep):** niet de demo maar je eigen nummers, door
  de echte Signalsmith 1.3.2 gehaald: `tools/keylock/uit/` (sakamoto, zoned-out,
  adriana, no-surprises), leeswijzer en scorekaart in `tools/keylock/LUISTER.md`.
  Daarna de beslissingen K1–K8 in `docs/KEYLOCK.md` (ontwerp, metingen, advies).

---

## B. De APC40 mkII — eerst testen, dan kiezen 🎛

- [x] **B1. In welke modus zetten we het apparaat?** — OPGELOST: Clay koos
  0x42 (23 sep, `08e9a86`). Gemeten in 0x41: device knob 1 op `cc:0:16`, welke
  track je ook selecteerde. Init stuurt nu 0x42; device knobs
  `cc:0:16-23` → `track.{focus}.…`, Track Select → focus. De tegenstrijdigheid
  (init 0x41, mapping met generic-banken) bestaat niet meer.
  Oorspronkelijke vraag: we stuurden de init voor 0x41, maar de mapping rekende
  met banken op aparte MIDI-kanalen die alleen in generic mode bestaan.
  - **0x42 (Alternate Ableton):** alles momentary, álle LED's en ringen van
    ons, track select stuurt MIDI. Banken doen we zelf met `{focus}`.
  - 0x40 (generic): het apparaat doet banken zelf, maar track select stuurt
    niets en ringen zijn alleen "single".
  **Advies:** 0x42, en de device knobs via `{focus}` (werkt in elke modus).
  **Eerst:** met de MIDI-monitor kijken welke kanalen er nu echt binnenkomen.

- [x] **B2. Knipperen op de tel: door de APC of door ons?** — gebouwd
  (`5e297f4`): zelf gerekend uit `track.N.phase` (positie min
  uitgangsvertraging); loop-pads en de Track Select van de maatgever. MIDI
  clock niet geprobeerd.
  Het grid kan zelf pulseren/knipperen, maar alleen synchroon als wij MIDI
  clock sturen (onbevestigd). Zelf knipperen via `track.N.tel` kan altijd.
  **Advies:** zelf (klokvast volgens regel 3); MIDI clock proberen als extra.

- [x] **B3. De indeling.** GEBOUWD 23 sep, daarna HERZIEN na onderzoek (`docs/APC40-onderzoek.md`): controller eerst, één kolom = één track, filter boven elke kolom (Clay), grid-modi op de scene-knoppen. Tabel in `docs/APC40.md`, alles op `apc.html`. Eerste versie: Richting gekozen door Clay: **mapjes (lagen)**.
  Vaste kern die nooit wisselt (faders, crossfader, master, play/cue/sync,
  tempo, Track Select); drie soorten mapjes met een oplichtende kiesknop —
  track knobs (Pan/Sends/User), device knobs (rack / EQ-strip / send-bussen /
  video), grid (Shift + scene launch: hotcues / loops / sampler / video);
  kort drukken = vast, vasthouden = even gluren; een balkje op het scherm zegt
  wat de knoppen nu doen; mapjes zijn data in de mapping en zelf te vullen.
  Eerst meten wat 0x42 stuurt, dan het volledige voorstel.
  Oorspronkelijk voorstel: Voorstel uit het onderzoek (volledig: `docs/APC40.md`; samengevat):
  - kolom = track 1–8, fader = volume, **Activator** = play (shift: cue),
    **Solo** = sync (shift: tap), **Track select** = focus,
    **Clip stop** = loop aan/uit, **A/B** = crossfaderkant
  - **device knobs** = het rack van de track met focus (`fx.knop.1–8`)
  - **track knobs** met de knoppen Pan/Sends/User als laagkeuze:
    Pan = filter per track, Sends = send echo (shift: galm), User = rack van
    het rechtervenster ("twee tracks tegelijk")
  - **grid rij 1–4** = hotcues per track, **rij 5** = sampler-pads;
    **scene launch** = beatloops van de focus-track
  - **Record** = opname start (shift: stop), tempo-encoder = pitch,
    cue-encoder = sampler-volume, pijlen = focus / video
  Deelkeuzes (VERVALLEN door de herziene indeling van `53e8551`; wat er nu
  staat: Track Select = focus, shift = tweede track; filter vast boven elke
  kolom, geen lagen voor de track knobs; grid-modi op de scene-knoppen;
  opname stoppen = shift + Record; cue alleen met shift + ●; Stop All vrij):
  - [-] **B3a. Volgt het linkervenster de focus?** Advies: ja; Arm zet een track rechts.
  - [-] **B3b. Standaardlaag van de track knobs: filter of sends?** Advies: filter.
  - [-] **B3c. Een tweede gridpagina** (loops per track, video-toggles)? Advies: nog niet.
  - [-] **B3d. Opname stoppen op de APC:** shift+Record of dubbel drukken? Advies: shift.
  - [-] **B3e. Cue alleen onder shift?** Advies: ja; bij lange stukken wil je zelden live terug.
  - [-] **B3f. Stop All Clips** bewust leeg laten? Advies: ja.

- [x] **B4. Kleurbetekenis op het grid** — gebouwd (`5e297f4`): "zachte tint"
  werd de DONKERE variant (paletindex n+1, #59xxxx), niet de pastels; drie
  standen uit `read()`, wis-regels rood zolang shift vastzit.
  Voorstel was: uit = niets te doen,
  donkergrijs = leeg, zachte tint = gevuld, volle tint = actief, knipperen =
  loopt in de tijd, rood = opname/wissen. Akkoord of eigen kleuren?

---

## C. Spelen en mixen 💬

- [x] **C1. Pitchbereik.** — Clay: kiesbaar, standaard ±16% (gebouwd 23 sep). De fader doet ±8%, sync mag tot 0,5–2×. Na een
  grote sync staat de fader tegen de aanslag en springt terug als je hem
  aanraakt. Opties: ±8 / ±16 / ±50%, of het bereik schuift mee met sync.
  **Advies:** kiesbaar ±8/±16/±50, standaard ±16.

- [x] **C2. Pitch terug op 0 bij een nieuw nummer?** — Clay: ja (gebouwd 23 sep). Nu houdt een track de
  pitch van het vorige nummer. **Advies:** ja, terug naar 0.

- [x] **C3. Crossfaderkant: één knop die rondloopt (A→B→thru) of drie aparte?**
  Rondlopen kan een hoorbare track per ongeluk stil zetten. **Advies:** drie
  kleine segmenten op het scherm; op de APC blijft het één knop.
  — Clay: drie segmenten (gebouwd 23 sep). Later vervangen (`5e297f4`,
  `c2d580f`): één A|B-knop op scherm én APC met de kant als kleur (geel A,
  oranje B, uit thru): je ziet waar je naartoe loopt. Cue kwam achter
  shift + ●, want een per ongeluk ingedrukte cue zette een hoorbare track stil.

- [x] **C4. Klik op het tracknummer in de trackrij = play?** Je verwacht
  eerder "selecteren". **Advies:** nummer = focus, play op een eigen knopje.
  — Clay: zo doen (gebouwd 23 sep: nummer = `track.N.focus`, ▶ = play).

- [x] **C5. Sends: vóór of na de crossfader?** Nu na de fader, vóór de
  crossfader: een track die je met de crossfader wegdraait, blijft insturen.
  **Advies:** zo laten (echo-out met de crossfader werkt dan ook).
  — Clay: zo laten (23 sep).

- [x] **C6. De echo op de bus op de maat?** Nu een vaste tijd (~250 ms).
  **Advies:** ja, een tijd in tellen (1/8, 3/16, 1/4) op de klok van de maat.
  — Clay: ja, met een schakelaar (gebouwd 23 sep: delay-parameter `sync`, echo-bus knop 4).

---

## D. Nieuwe onderdelen — ja of nee? 💬

- [x] **D1. Samples bewaren bij een nummer** (nu alleen deze sessie).
  — Clay: ja, bij het nummer (gebouwd 23 sep: plek bewaren, opnieuw knippen, ↺ op de pad).
- [x] **D2. Pads die meelopen met tempowijzigingen** van de maat-track.
  — Clay: ja, tempo én tel (gebouwd 23 sep: `Sampler.heranker`).
- [x] **D3. Dub-worp en Vasthouden als drukknop** (werkt zolang je vasthoudt) — hoort bij B3.
  — Clay: elke knopplek (gebouwd 23 sep: `.hold`-actions, alt+vasthouden op het scherm).
  Op de APC nog NIET toegewezen: voorstel (Lock = dub-worp, Detail View = galm
  vasthouden) staat in `docs/VERBETERINGEN.md` ronde 3.
- [x] **D4. Losse bestanden ook via de streamkern** (geen tik bij loops, één afspeelmotor).
  — Clay: ja (gebouwd 23 sep: `laadGeheugen`, `maakWav`, `geheugenHaal`).
- [x] **D5. Eén paneel tegelijk onderin** (library, rack-editor, MIDI overlappen nu),
  en video als inklapbare kolom in plaats van over het rechtervenster.
  — Clay: beide (gebouwd 23 sep).

---

## E. Techniek — mag ik dit gewoon doen? 💬

- [x] **E1. app.js opsplitsen** (± 1000 regels) in modules: vensters, racks,
  sessie/laden, MIDI-opzet, opname-knop, video-paneel, renderloop.
  Verandert niets aan wat je ziet. **Advies:** ja, na de commit.
  — Clay: ja (gedaan 23 sep: app.js 1183 → 128 regels, tien modules).

- [x] **E2. Action-namen gelijktrekken** (nu Engels en Nederlands door elkaar:
  `hotcue.1.delete` naast `sampler.1.wis`). Kan zonder dat je mappings breken
  (de omzetting bestaat al). **Advies:** ja, vóór de APC-indeling definitief wordt.
  — Clay: alles Engels (gedaan 23 sep: mapping versie 3, `NIEUWE_NAMEN` zet oude namen om).

- [x] **E3. Mappings ook op de server bewaren** in plaats van alleen in de
  browser (localStorage). Dan overleven ze een andere browser of gewiste data.
  — Clay: ja (gebouwd 23 sep: server eerst, localStorage reserve; herstellen wist beide).

---

## F. Nieuw uit het APC-onderzoek

- [x] **F1. Koptelefoon-cue (PFL).** — 5 okt: de Scarlett 2i2 voor de zaal en de
  koptelefoonuitgang van de Mac, samen één samengesteld apparaat (vier kanalen, één
  klok). Gebouwd als STUDIO S1, `docs/STUDIO.md` §3. (De vraag was: VARVE heeft één
  audio-uitgang; een cue vraagt een tweede, of kanaal 3/4 van een interface.)

---

## G. Clay's map `Input/` (23 sep, zie docs/INPUT.md)

- [x] **G1. Wat wil je met `Input/`?** — 24 sep: AV-kern en Varve samenbrengen; uitgewerkt in docs/plugins/01-plan.md. Naslag, ideeënbak, of iets waarin VARVE en AV-kern
  samenkomen? (fase1-zip = oude versie van dit project; av-kern = eigen project met eigen
  .git, Vite/TS; blueprint-varvedj.json = Bedienplan-export: twee decks, vier beeldlagen.)
- [x] **G2. Is de blauwdruk een nieuwe wens?** — 24 sep: nee, losse functies plukken (spoor C); Varve wordt geen blauwdruk op AV-kern. Hij botst met vastgelegde keuzes (acht
  tracks / één kolom = één track, beeld = video van de track, fader = volume). Heropenen
  of alleen losse functies plukken (hotcues 5–8, loop in/out, brake/slip/kill, tempo-master)?
- [x] **G3. Actielog met terugspelen** — 24 sep: ja, als spoor D (ROADMAP punt 20), niet hash-exact. (idee uit AV-kern, ~1 dag): set opnieuw renderen of
  een fout naspelen. Willen?
- [x] **G4. Bedienplan blijven gebruiken?** — 24 sep, middag: Clay vroeg of "alleen
  AV-kern" de beste aanpak is; advies ja, genoteerd als besluit tenzij hij het anders
  wil. Bedienplan blijft de bron voor AV-kern; Varve houdt zijn eigen mapping, koppelen
  en `apc.html`. Geen importeur (spoor D wordt alleen het handelingenlog). Mist Clay
  ooit het overzicht van Bedienplan voor Varve, dan een EXPORT Varve → blauwdruk
  (alleen lezen), niet andersom. Pas dan loont een import naar de VARVE-mapping.
- [x] **G5. Wat is een "Vormmachine"** — gevonden: Clay's artifact, nu `Input/vormmachines.html`, gebouwd als vormlagen. (26 in de blauwdruk, nergens gevonden)?
- [x] **G6. `Input/` in git of in .gitignore?** — Clay: .gitignore (e285371). Open: waar is `modules/` voor? Advies: .gitignore (zips + een complete
  .git van AV-kern); alleen de blauwdruk eventueel naar docs/. En waar is de lege map
  `modules/` voor?

---

## H. Nieuw (24 sep, nacht): vormlagen en stems

- [x] **H1. Klinken de stems goed genoeg?** — Clay (24 sep, middag): ja, ze klinken
  goed, ook al hadden de nummers weinig lagen. Door naar H2. 🎧 Luister naar `tools/stems/uit/no-surprises/`
  (4-vocals, 3-other) en `bay-ledges/`. Is zang ↔ instrumentaal schoon genoeg om live
  mee te spelen? Nee = stems parkeren. Ja = H2.
- [x] **H2. Twee stems of vier?** — Clay (24 sep, middag): **kiesbaar per nummer**.
  Standaard twee (zang, rest); vier als je dat bij het binnenhalen vraagt. Bouwen na
  25 okt (ROADMAP 17). 💬 Bij Clay's repertoire zijn drums en bas vrijwel leeg.
  **Advies:** twee (zang, rest): half de opslag, één knop per track.
- [ ] **H3. Splitsen op de Omarchy-machine?** 💬 (GTX 1660; geschat 3–6× sneller, en het
  concurreert niet met de set.) Eerst meten met meet.py daar. Daarna: batch via een
  gedeelde map, geen open dienst.
- [x] **H4. Vormlagen op de APC en de beamer: bevalt het?** — Clay (24 sep, middag):
  "goed voor nu". Budgetten en waasdrempel blijven zoals ze zijn tot er iets opvalt. 🎛 Zie ROADMAP punt 1. Specifiek:
  is de waasdrempel (3–8%) te streng voor zachte sporen, en werken de budgetten
  van 4 en 12 ms op de M1 met 8 video's?
- [ ] **H5. Na 25 okt: eerst de AI-laag van AV-kern of eerst Varve (ROADMAP 13–26)?** 💬
  — Deels beantwoord door 25 sep: op Clay's vraag ("zoveel mogelijk met sub agents")
  zijn 13, 14, 16, 18, 20, 21, 22, 23 (deel) en 24 al gebouwd. Van Varve blijven
  vooral 15 keylock, 17 stems, 23 (rest), 25 en 26 over (volgorde in ROADMAP). Open
  blijft: gaat AV-kern (publicatie 25 okt, daarna de AI-laag) vóór keylock en stems?
- [x] **H6. Isomorfe vormen met geluid?** — Clay (24 sep, middag): **eerst AV-kern, dan
  Varve**. Het geluid wordt één audiomodule (AudioWorklet: aanslagen komen als berichten
  uit de Worker, de modale synthese rekent in de worklet in plaats van 12–32 ms op de
  hoofdthread), eerst voor AV-kern 06a–c (Resonator, Korrelwolk). Na 25 okt in Varve via
  een eigen vormbus vóór de limiter, standaard dicht; grondtoon = toonsoort van de
  maatgever (zodra toonsoort-detectie er is), zelf spelen op de tel, korrelwolk op een
  sampler-pad. 💬 Snaar, trommelvlies, epicykels en korrelwolk
  kunnen ook klinken (sink vóór de limiter, eigen gain, standaard dicht). Willen, en zo
  ja: welke bus?

---

## I. Toonsoort en keylock (24 sep, middag)

Onderzocht met twee agenten: `docs/TOONSOORT.md` en `docs/KEYLOCK.md`. Clay koos
**bouwen na 25 okt, vooraan**: direct na "mapping als verschil bewaren", eerst
toonsoort en dan keylock.

Beslist:
- **T3, door Clay:** kolomkop en focusdeel tonen de toonsoort die je HOORT, met pitch
  en transpositie; de library toont de plaat.
- **K3, door Clay:** een sprong met keylock aan duurt ~95 ms en komt exact uit.
- **K8, door Clay:** toon verschuiven mag ook als keylock uit staat.
- **Volgens advies, tenzij Clay bezwaar maakt:**
  - T1: Temperley 2005;
  - T2: `9B G`, met de volle naam in het focusdeel;
  - T4: onzeker = gedimd met "?", onder 0,15 een "~";
  - T5: cent tonen vanaf 20 cent afwijking;
  - T6: corrigeren op de APC komt later;
  - T7: harmonisch mixen komt later en staat standaard uit;
  - K5: ±12 halve tonen, terug naar 0 bij een nieuw nummer;
  - K7: de sampler blijft zoals hij is.

Open:
- [x] **I1 (= K1). Wordt het Signalsmith?** 🎧 — JA (A3 klinkt goed), gebouwd 5 okt. Na A3. Scoort ±5% op sakamoto en zoned-out
  een 0 of 1 op de scorekaart, dan ja.
- [x] **I2 (= K2). Welke instelling?** 🎧 — volgens advies: standaard, gespreid (5 okt). Standaard, goedkoper of kort. Luister naar
  13 en 14 tegen 08. **Advies:** standaard, gespreid; goedkoper als je 13 niet van 08
  onderscheidt.
- [x] **I3 (= K4). Keylock standaard aan of uit?** 🎧 — volgens advies: uit, en hij blijft staan bij een nieuw nummer (5 okt). Luister naar 01 tegen 04.
  **Advies:** uit, en keylock blijft staan bij een nieuw nummer.
- [ ] **I4 (= K6). Waar op de APC?** 🎛 GEBOUWD 5 okt, niet op het apparaat nagelopen:
  **Shift + Tap = keylock, Shift + Nudge −/+ = toon −1/+1** (focus-track); toon terug
  naar 0 op het scherm (en vanzelf bij een nieuw nummer). Niet Bank: met de hub is
  dat de hubtoets. **Advies:** zo proberen. Was: Clay 25 sep (voorstel A): keylock krijgt
  later Bank. De rest van het voorstel hieronder staat nog open. **Voorstel:**
  - Bank = keylock;
  - Shift + Bank = pitchbereik;
  - Shift + Nudge ± = toon;
  - Shift + Tap = toon terug naar 0.

  Eerst op `apc.html` bekijken of het in de hand ligt.
  **Let op (3 okt):** met de AV-app-hub (`?hub=`) is Bank de hubtoets en komt
  hij nooit bij VARVE aan. Zie N2.

---

## J. Keuzes uit de sporen van 25 september

Elk spoor bouwde met een keuze die Clay kan omdraaien. Wat er nu staat is het
advies van de bouwer of controleur, tenzij anders vermeld. Alleen wat echt een
keuze is; de rest staat in `docs/HANDOFF.md` (wat niet getest is).

**Clay 26 sep: alle adviezen overgenomen** (afgevinkt). Daarvoor gebouwd: J4
(beatjump vóór het begin geweigerd), J12 (op een track gesleept = vooraan in de
rij), J18 (vinkje "log altijd aan" achter ↺), J24 (rack-knoppen 5–8 endless in
zijn verschil), J26 (½ houdt de "1"). Nog open, op gevoel of met de APC: J7, J16,
J19, J20, J27, J28, J30.

Transport (beatjump, loop in/out, quantize, op de maat):
- [x] **J1. Starten op de maat: volgende MAAT of volgende tel?** 🎧 Nu: maat. **Advies:** maat (blauwdruk, plan en Ableton doen het zo); een tel-knop erbij is één regel.
- [x] **J2. Quantize voor alle tracks of per track?** 💬 Nu: één schakelaar voor alle tracks. **Advies:** zo laten (één knop, zoals rekordbox, Traktor en Serato).
- [x] **J3. Hotcue met quantize: meteen of op de volgende tel?** 🎧 Nu: meteen, fasebehoudend. **Advies:** meteen (klinkt hetzelfde, reageert tot een tel sneller).
- [x] **J4. Beatjump terug voorbij het begin: klemmen of weigeren?** 💬 Nu: klemmen op 0 (voorbij het einde wordt al geweigerd). **Advies:** weigeren, net als het einde: klemmen breekt de beatmatch van een track die je net inmixt. Eén regel.

Klank (rem, kill, maatgever):
- [x] **J5. Remtijd in seconden of in tellen?** 🎧 Nu: seconden, 0,1–5 s, standaard 1 s. **Advies:** seconden (een gebaar van de draaitafel, werkt ook zonder grid).
- [x] **J6. Tweede druk op rem tijdens het remmen: los of meteen stil?** 🎧 Nu: los, meteen weer op tempo (tape stop die op de drop invalt); pauze = meteen stil. **Advies:** zo laten.
- [ ] **J7. Klinkt het uitdoven als een vinylstop, en wil je een spin-up na loslaten?** 🎧 Nu: uitdoven in het laatste kwart van de snelheid, loslaten = meteen op tempo. **Advies:** eerst luisteren; eerder/later uitdoven is één getal, een spin-up ~een uur werk.
- [x] **J8. Maatgever-hysterese: 3 dB en 250 ms goed?** 🎛 Nu: een andere track neemt de maat pas over na 3 dB harder gedurende 250 ms. **Advies:** zo laten tot het in een set opvalt.

Toonsoort:
- [x] **J9. Toonsoort in de kolomkop onder de bpm (`9B G`), of alleen Camelot?** 👀 Nu: onder de bpm (naast het nummer drukte de MAAT-badge hem weg). **Advies:** zo laten (T2).
- [x] **J10. Sneltoetsen om de toonsoort te corrigeren?** 💬 Nu: alleen het menu in de focuskop en de kiezer in de library. **Advies:** geen toetsen: een per ongeluk verzette kwint wordt als "met de hand" bewaard.
- [x] **J11. Library "+N": aantal andere toonsoorten of aantal stukken?** 💬 Nu: andere toonsoorten (ADRIANA: 18 stukken in 6 toonsoorten = +5). **Advies:** zo laten.

Library en ingest:
- [x] **J12. Voorrang in de ingest-rij voor een bestand dat je op een TRACK sleept?** 💬 Nu: achteraan, dus een video voor track 3 wacht achter een lange download. Geen advies van de bouwer; **voorstel:** alleen wat je op een track sleept vooraan (dat wil je nu spelen).
- [x] **J13. Een hele playlist in de wachtrij zetten?** 💬 Nu: geweigerd, zoals gevraagd. **Advies:** blijven weigeren tot je erom vraagt (met `--flat-playlist` is het daarna een klein stapje).
- [x] **J14. Tweede klik voor "opnieuw binnenhalen" en voor × op een lopende download: goed, of te voorzichtig?** 💬 **Advies:** zo laten (dezelfde regel als elke destructieve knop); een ↻-knop bij "al binnen" kan ook.

Beamer:
- [x] **J15. Dubbele menging in het randgeval "opname begon zonder los venster, daarna open"?** 💬 Nu: dan mengen beide tijdelijk. **Advies:** laten (het alternatief bevriest de beamer weer met het hoofdtabblad naar achteren).
- [ ] **J16. De vertraging tussen canvas en beamer meten?** 🎛 Telefooncamera op 240 fps, beamer en luidspreker in beeld, een klik met een witte flits. **Advies:** eerst meten, pas daarna het beeld een vaste voorsprong geven (nu aangenomen: 16–33 ms).
- [x] **J17. Melding als een nummer zonder video op de beamer staat?** 💬 Nu: alleen een ontbrekend of kapot bestand is een fout. **Advies:** geen melding.
- [ ] **J27. Inloop: hoe snel neemt het losse venster over?** 👀 Nu: als alle zichtbare video's 0,3 s binnen 50 ms van het geluid lopen, uiterlijk na 20 s; tot dan toont het het beeld van het hoofdvenster ("beamer loopt in"). Gemeten onder belasting: acht tracks 8–9,4 s. **Advies:** zo laten; kijk op je M1 hoe lang "beamer loopt in" blijft staan.
- [ ] **J28. Tijdens de inloop mengen beide vensters (bij acht tracks zestien video's).** 🎛 Hapert het hoofdvenster in die seconden? **Advies:** eerst kijken; zo ja, dan is de bovengrens van 20 s korter zetten één getal.

Handelingenlog:
- [x] **J18. Log altijd aan, vanaf het openen?** 💬 Nu: met ○ log en vanzelf met elke opname. Altijd aan kost ~1–8 MB per uur in `opnames/`, en dan is ook een onverwachte fout na te spelen. **Advies:** ja, als keuze die onthouden wordt.
- [ ] **J19. Opnieuw renderen in één knop, een "alleen kijken"-stand (MIDI uit tijdens terugspelen), logs weghalen uit de lijst?** 💬 Geen van drie gebouwd; geen advies van de bouwer. Eerst gebruiken en dan kiezen.

Vormen 16:9:
- [ ] **J20. tv (Trommelvlies): de "lucht" naast het ronde vel.** 👀 Een golf die van het vel naar buiten loopt. Bevalt hij, rustiger (`LUCHT_FEL` lager), of alleen het vel op zwart? Geen advies (een beeldvondst).
- [x] **J21. dw (Korrelwolk): smaller stereobeeld?** 🎧 Beeld = geluid: een samengetrokken wolk bestrijkt nu ×0,56 van de korrelbuffer en het stereobeeld. Of het geluid over de oude breedte, minder letterlijk isomorf? **Advies:** zo laten; het geluid is in Varve nog nergens aangesloten (H6).
- [x] **J22. ls, if (en cl): heel in het midden, of breder?** 👀 Nu: heel in het midden (valt onder "Midden"). Anders: een rij planten/varens, groter en bijgesneden zoals op 24 sep, of cl tot 18% groter over de hele breedte. **Advies:** zo houden.
- [x] **J23. Roosters (gs, ln, cc, ec, …): vlekken ~25% kleiner dan op 24 sep.** 👀 Nu: evenveel cellen, dus zelfde rekentijd. Even groot als 24 sep is goedkoper maar grover. **Advies:** zo laten.

Mapping en beatgrid:
- [x] **J24. Rack-knoppen 5–8 (video-effecten) op "endless" zetten?** 🎛 Koppelen raadt een CC altijd als absoluut (soft-takeover); de andere ringknoppen staan op endless (meteen doordraaien vanaf de ring). **Advies:** ja, in je verschil.
- [x] **J25. Bij een nieuwe standaardmapping zien WELKE regels erbij kwamen?** 💬 Nu alleen de melding "de standaardmapping is bijgewerkt". **Advies:** nog niet (dan moet het verschil per regel onthouden wat de standaard had).
- [x] **J26. ½ op tel 2 of 4 schuift de "1" een tel op.** 🎛 Moet ½ de "1" houden? **Advies:** ja (`docs/BEATGRID.md`, open punt; eerst jouw ja).

APC-indeling (voorstel A):
- [x] **J29. Modus klank op Shift + scene 5?** 🎛 Scene 5 blijft één druk "loop weg"; in klank brandt hij magenta, dus daar zie je niet of er een loop loopt (Clip Stop per kolom wel). **Advies:** zo laten; ▲ ▼ werkt ook.
- [ ] **J30. Zijn de nieuwe kleuren op het apparaat uit elkaar te houden?** 🎛 Magenta 53/54 (klank), donkerrood 6 (kill: open), donkeroranje 10 (rem: speelt), donkergroen 22 (op de maat: speelt) tegen donkergrijs (stil); Pan/Sends/User knipperen op de tel. **Advies:** eerst kijken; een kleur wisselen is één regel in `feedback.js`.
- [x] **J31. Rij 5 (op de maat) als de track al speelt: donkergroen of uit?** 👀 De APC-indeling koos "uit" (rij 5 toont alleen wat je nog kunt inzetten). Sinds shift+Q op een spelende track pauzeert, volgt het lampje de read: fel = wacht, donkergroen = speelt (drukken = pauze), donkergrijs = stil. **Advies:** zo laten: drukken doet iets, dus het lampje brandt.
- [x] **J32. Stop All Clips = rem van de focus-track?** 💬 Die knop heeft geen lampje op de APC. **Advies:** zo laten.
- [x] **J33. Met `?vormen=1` in het mapje vorm: shift + Bank ◀ ▶ = beatjump-lengte, niet de vormlaag.** 💬 Een shift-regel gaat overal voor het open mapje; Bank ◀ ▶ zonder shift kiest daar de laag. **Advies:** zo laten.

## K. Klankschaal (29 sep, docs/KLANKSCHAAL.md)

- [ ] **KS1. Waar komt de klankschaal op de APC?** 🎛 Nu nergens (koppelen werkt wel). **Advies:** een eigen mapje "klankschaal" als fragment (zoals "vorm"): acht velden op grid-rij 1, kern en wrijf/demp op rij 2, FIJN en KRACHT op de device knobs. Eerst luisteren.
- [ ] **KS2. Een ringende schaal die van toonsoort wisselt: meteen mee, of pas bij de volgende aanslag?** 👂 Nu meteen mee (glijdt direct). **Advies:** eerst horen met een mix die van toonsoort wisselt.
- [ ] **KS3. Is VOL 0,8 de goede standaard naast je tracks?** 👂 Gemeten: velden pieken ~−12..−17 dBFS, tracks staan op −14 LUFS.
- [ ] **KS4. Aanslagen op de tel als quantize aan staat?** 💬 Niet gebouwd (niet gevraagd). **Advies:** alleen als je het mist bij het spelen.
- [ ] **KS5. Je eigen schaal meten (zoals in de Waterschaal) als vijfde soort?** 💬 Niet gebouwd.

## L. Auto-DJ (30 sep, docs/AUTO-DJ.md)

- [x] **AU1. Welke APC-knoppen voor ok/overslaan/langer/nu?** 🎛 Nu nergens (koppelen werkt). **Advies:** een eigen mapje "auto" als fragment (zoals "vorm"), één rij met de vier in kleur. **Gebouwd 2 okt, als zesde grid-modus "auto" (limoen) in de standaardmapping, niet als fragment:** de auto-DJ hangt niet aan een vlag, en zo staat hij vanzelf op apc.html, op het scherm en in je eigen mapping (verschil). Openen met Shift + scene 4 of ▲ ▼ (na klank). Bovenste rij: pad 1 ok (groen), 2 overslaan (oranje), 3 langer (cyaan), 4 nu (geel), pad 8 aan/uit (limoen). Donker = er staat een voorstel klaar, fel = bevestigd / aan, uit = niets te doen. In de grid-modus blijft Shift + scene 4 "halve tel". Zie docs/APC40.md, "Modus auto". Nog op het apparaat nalopen.
- [ ] **AU2. Is 24 s overvloeien goed bij jouw muziek, of langer (32–48 s)?** 👂
- [ ] **AU3. "Nu" bij beatloos: meteen, of een paar seconden later zodat je het ziet aankomen?** 👂 Nu: na ~0,5 s.
- [ ] **AU4. Mag de automaat een lege track gebruiken?** 💬 Nu: eerst zijn eigen twee tracks, dan een lege, nooit wat speelt. **Advies:** zo laten.

## M. Planvenster (30 sep, docs/PLAN.md)

- [ ] **PL1. Mag jij een bewaker bewust breken?** 💬 Bijvoorbeeld een blend afdwingen over een onzeker grid, met een "ik weet het"-vinkje per stap. Nu winnen de bewakers altijd. **Advies:** toestaan, maar alleen vanuit het venster (door jou), nooit door Claude.
- [ ] **PL2. Per stap: automatisch, of wachten op jouw GO?** 🎛 Voor fase 2 (live-stand). **Advies:** standaard automatisch, per stap om te zetten.
- [ ] **PL3. Past het venster op je tweede scherm, en mist er iets in de lijst?** 👀

## N. Stems (3 okt, docs/STEMS.md)

- [ ] **N1. Waar op de APC?** 🎛 — GEBOUWD (5 okt, het advies hieronder): grid-modus STEMS, Shift + scene 3 of ▲ ▼ (achteraan), zeegroen; per kolom rij 1 zang · 2 rest · 3 drums · 4 bas · 5 overig weg zolang je drukt, shift + pad = vastzetten (`docs/APC40.md` "Modus stems", `docs/STEMS.md` §5). **Open: alleen nog proberen op de echte APC** (niet op het apparaat nagelopen). Oorspronkelijke vraag: nu nergens (koppelen werkte: `track.N.stem.vocals.kill` enz.); advies was een grid-modus STEMS naast KLANK (eigen kleur, bereikbaar met ▲ ▼ zoals de andere grid-modi).
- [ ] **N2. De rest van het model naar "rest"?** 👂 — OPEN, wacht op luisteren. Nu: rest = mix − zang (bij vier: overig krijgt wat het model nergens onderbracht), zodat alles open precies klinkt als het nummer. Prijs: wat Demucs miste (ook een beetje zang) blijft hoorbaar als de zang weg is. Alternatief: rest = alleen drums + bas + overig; dan is zang weg schoner, maar alles open klinkt tot −25 dB (ambient) anders dan het origineel. **Advies:** zo laten; luister naar zang weg bij No Surprises en Bay Ledges.
- [ ] **N3. Splitsen tijdens een set?** 💬 Demucs deelt de GPU met de video (WebGL); `nice` helpt alleen de CPU. Nu splitst hij gewoon door (na elke ingest standaard 2). **Advies:** zo laten tot het hapert; dan een knop "stems pauzeren" in de Controlekamer, of splitsen op de Omarchy-machine (H3).
- [ ] **N4. Standaard 2 bij elke ingest, ook als je even snel iets binnenhaalt?** 💬 Een nummer van 5 minuten kost ~2 minuten rekenen en ~110 MB. De keuze `2 · 4 · geen` staat naast de invoer en wordt onthouden. **Advies:** zo laten (H2).

---

## S. Studio (5 okt, docs/STUDIO.md)

- [x] **S1. Koptelefoonvolume en mix op de APC?** — 5 okt: Cue Level = volume, shift + Cue Level = mix; sampler-volume en puls naar shift + Cue Level in hun grid-modus. 🎛 De cue zelf zit op ● (zonder shift). VOL en MIX staan nu alleen in de KOPTELEFOON-rij; koppelen werkt. Cue Level is het voor de hand liggende label, maar dat is nu het sampler-volume (shift: puls). **Advies:** eerst een avond met de rij spelen; mis je hem, dan Cue Level = koptelefoonvolume en shift + Cue Level = mix, en krijgen sampler-volume en puls een andere plek.
- [x] **S2. Een instrument of patroon: een van de acht tracks, of eigen kolommen?** — 5 okt: op een van de acht tracks. 💬 Beslissen vóór S3. Acht tracks = acht kolommen op de APC; een instrument erbij kost een kolom of een mapje. **Advies:** een track kan een nummer OF een instrument dragen (dezelfde strip, fader, sends en cue), zodat de APC-indeling niet verandert.
- [ ] **S3. Zonder enige cue hoort de koptelefoon de zaal.** 🎧 Gekozen zodat je altijd iets hoort. Alternatief: stil tot je een cue aanzet. **Advies:** zo laten.
- [ ] **S4. Drums: −14 LUFS of iets zachter?** 🎧 Een maat vier-op-de-vloer op −14 LUFS piekt op +3,5 dBFS (kick en snare samen); de limiter knijpt dan op 2 en 4. **Advies:** eerst luisteren; pompt het, dan `UIT_OPHOGING` in drums.js omlaag (−16 LUFS).
- [ ] **S5. Stems op de APC: filter, echo en cue per stem?** 🎛 Nu alleen op het scherm (en weg/terug in de grid-modus STEMS). **Advies:** een derde mapje onder Clip/Device View (strip → rack → stems): device knobs 1–4 = filter, 5–8 = echo, shift = galm.
- [ ] **S6. Een stem-echo door het trackfilter?** 🎧 De echo en galm van een stem gaan nu NIET door EQ, effect en filter van de track (wel door de fader). **Advies:** zo laten; zeg het als je het filter-dichtdraaien ook op de echo wilt horen.
- [x] **S7. Schaal: de cent van de plaat volgen?** 🎧 — GEBOUWD 5 okt (advies gevolgd): de Schaal staat nu op A440 + de cent van wat je hoort (met de pitch erbij, ±50) + FIJN, zoals de globale schaal. Nog te beluisteren: speel hem over een plaat die niet op A440 staat. Poly en FM staan nog op A440 + hun eigen stemknop; zeg het als die ook mee moeten.
- [ ] **S8. FM: zachter inzetten?** 🎧 Standaard aanslag 8 ms en release 1,2 s (MediSynth's Glass: 280 ms en 4,5 s). **Advies:** luisteren; het zijn knoppen 3 en 5.
- [ ] **S9. Effecten: oversampling voor de distortion?** 🎧 Zonder: aliasing (−14,8 dB bij hard, drive vol). Met: 128–192 samples vertraging en dus een kamfilter met de mix-knop. **Advies:** zonder laten.
- [ ] **S10. Compressor en pitch als insert schuiven de track op** (6 ms, pitch op meng 1 ~45 ms). 🎧 **Advies:** acceptabel voor een effect; niet voor de beatmatch-track zelf.
- [ ] **S11. Tremolo en autopan standaard op de maat?** 🎧 **Advies:** ja. Op de "1" van de maat beginnen vraagt dat `fxKlok` ook de maatfase meegeeft (later).
- [ ] **S12. Geheugen (90 s buffer uit de filter app)** niet als insert gebouwd (begint leeg bij elke wissel, 17 MB). 💬 **Advies:** later als instrument of op de master, als je het mist.
- [ ] **S13. Master: knop 8 = mix in het mapje master, release 80 ms.** 🎛🎧 Proberen op de APC; vervormt de limiter als je hem hard raakt, zeg het. De master klinkt ~0,8 dB zachter dan met de oude compressor (die tilde op).
- [x] **S15. Patronen: de instrumenten vanzelf terug bij het laden van de set?** — GEBOUWD 5 okt (advies gevolgd): de set onthoudt per track met patronen het instrument en zijn knoppen; na het laden (ook herladen) komt het terug op een lege track. Een track met een nummer houdt dat. Wrijven op de Schaal wordt niet onthouden (er klinkt niets vanzelf). PATRONEN.md §7.6.
- [ ] **S16. Patronen na een sprong (hotcue, beatjump) die geen hele maat is.** 🎧 Lopende patronen blijven in hun eigen fase en de klok glijdt in één à twee tellen terug (geen dubbele of gemiste noot). Alternatief: een korte stilte en dan op de nieuwe tel. **Advies:** glijden laten.
- [ ] **S17. Patronen op de APC: Shift + scene 2, en Stop All Clips = alles stoppen in die modus.** 🎛 (Shift + scene 3 werd stems, daarom 2.) **Advies:** zo proberen.
- [ ] **S18. Maschine: zijn de gedimde padkleuren zichtbaar?** 👀 Poly gedimd is #190064 (heel donker violet). **Advies:** kijken op het apparaat; te zwak, dan een lichtere basiskleur per instrument.
- [ ] **S19. Maschine-wiel: eerst kiezen, indrukken = zetten.** 🎛 Zo vervangt een tik tegen het wiel nooit per ongeluk je instrument. De eerste wielstap na het insteken telt niet (de hub kent dan nog geen beginstand). **Advies:** zo laten.
- [ ] **S21. Grid uit de tellen (Beat This!) en controleren: zo goed?** 🎧 (6 okt, docs/BEATGRID.md §11) Elk nummer krijgt zijn grid nu uit de tellen die Beat This! hoort; naast de bpm staat of het klopt (✓ / ? met de reden / 🔒 / ⚠ als het live wegloopt), de gevonden tellen staan groen in de zoom, en een klik op het oordeel start de controle: een tik op elke gridlijn in de koptelefoon, ✓ per stuk, alles goed = op slot. Je met de hand gezette grids (jungle-mix, album) zijn NIET overschreven, alleen gemeten — ↻ in de library zet ze om (op slot: tweede klik). **Advies:** eerst de controle op Loving arms en Ciel (band zonder klik), dan ↻ op de jungle-mix en luisteren of het beter is dan je eigen grid.
- [ ] **S23. Toon per stem: ook op de APC?** 🎛 (6 okt, docs/STEMS.md §7) Nu alleen in de STEMS-rij (draaiknop per stem, klik op het getal = 0). Voorstel: in grid-modus STEMS (Shift + scene 3) shift + de onderste twee pads van een kolom = toon − / + van die stem. **Advies:** eerst met de muis proberen; zeg het als je hem live wilt.
- [ ] **S24. Toon per stem: klinkt het goed genoeg?** 🎧 Zang een paar halve tonen omhoog/omlaag, en de rest (bas!) een kwint. **Advies:** luisteren bij Loving arms (vier stems); drums verschuiven klinkt altijd "anders".
- [ ] **S22. Tik in de zaal als er geen koptelefoon is?** 💬 Zonder samengesteld apparaat (Scarlett + Mac-uitgang) hoort de controletik door de zaal. **Advies:** zo laten (controleren doe je bij het voorbereiden); zeg het als hij dan beter stil kan blijven.
- [ ] **S20. Beatgrid: vastzetten (pin) en terug zo proberen?** 🎛 (5 okt, docs/BEATGRID.md §10) Een correctie bevestigt nu het stuk (sync en loops mogen meteen), ↶/Cmd+Z zet terug, en "vast" haalt drift weg: "1" op een kick aan het begin, een paar minuten later "vast" op een kick. In grid-modus: klik in de golfvorm = tel 1, shift + klik = vast; scrollen = zoomen. Op de APC: grid-modus Shift + scene 1 = vast (terug niet op de APC: Shift + scene 5 blijft klank, Lock het slot). **Advies:** zo proberen op een lang nummer met drift; zeg het als vier tikken nog steeds niet het hele grid op slot moeten zetten.
- [ ] **S14. Xboard49: knop 9–16 = de FX-knoppen van de speeltrack, de schuif = zijn fader.** 🎛 Voorstel; de CC-nummers van de knoppen komen uit de proef (`AV-app-hub`: proef speelapparaten).

---

## SE. Secties (6 okt, docs/SECTIES.md, tak `studio/secties`)

- [ ] **SE1. Een sectie valt in op de volgende "1" met een aanloop uit het nummer zelf.** 🎧 Druk je midden in een maat, dan springt hij naar vlak vóór de sectie, precies zo ver als jij van de volgende "1" af zit: de rest van de maat hoor je het einde van de maat vóór die sectie (vaak een fill), en op de maatstreep valt hij in. Geen wachten en de groove struikelt nooit. Alternatief: blijven spelen tot de maat om is en dan springen (zoals Ableton). Dat vraagt een geplande sprong in de streamkern; die bestaat nu alleen voor keylock. **Advies:** zo proberen; mis je "eerst de maat afmaken", zeg het.
- [ ] **SE2. Kloppen de grenzen en de namen op je eigen muziek?** 👂 Gemeten op synthetische nummers (EDM, pop met opmaat, ambient): elke grens op zijn maat, groepen en labels goed. Op echte muziek nog niet: de drempels zijn een eerste keuze. Labels: intro · opbouw · drop · break · outro, de rest alleen een letter. **Advies:** speel vijf verschillende nummers en noteer per nummer wat niet klopt (een gemiste grens, een grens te veel, een verkeerde naam). Dan stel ik bij en verhoog ik `SECTIE_VERSIE` (alles wordt vanzelf opnieuw berekend).
- [ ] **SE3. De 40 pads = de secties van de FOCUS-track.** 🎛 Zo past een heel nummer (tot 40 secties) op het grid en blijft de volgorde vast. Alternatief: per kolom een track met 5 secties (zoals stems en patronen), maar dan moet je bladeren. **Advies:** zo laten; wisselen met Track Select.
- [ ] **SE4. Kleur op de pads: wit = die hoor je (knippert op de tel), donker hemelsblauw = er is een sectie.** 👀 Op het scherm heeft elke groep (A, B, C …) een eigen kleur. Op de APC kan dat ook, maar de lampjes kennen nu alleen een vaste kleur per soort knop. **Advies:** eerst zo; mis je de groepen, dan bouw ik groepskleuren op de pads.
- [ ] **SE5. Secties met de hand verschuiven, splitsen of hernoemen?** 💬 Niet gebouwd. De kaart kent al `bron: 'hand'` en `slot` (dan rekent de server er nooit overheen). **Advies:** eerst een paar avonden zonder; als je steeds dezelfde grens mist, dan een bewerkmodus zoals bij het grid.
- [ ] **SE6. Labels uit een getraind model (all-in-one-infer, MIT, draait op Apple Silicon)?** 💬 Python in de venv van de stems, zoals Demucs. Beter op popstructuren (couplet/refrein), niet getest op jouw ambient en jungle. **Advies:** alleen als SE2 tegenvalt.


## SV. Secties verweven (6 okt, avond; docs/SECTIES.md §7)

De secties zitten nu ook in het toetsenbord, de sampler, het planvenster, het handelingenlog, de auto-DJ, de vormen en de video-puls, de Controlekamer, de Maschine en de globale laag van de hub.
Per onderdeel een blok in de speellijst; daar staan de codes hieronder bij.

**Toetsenbord** (speellijst "Secties op het toetsenbord")
- [ ] **SVT1. Shift+W/E (links) en shift+I/O (rechts) voor vorige/volgende sectie.** 🎧 Links naar rechts = terug naar vooruit (zoals R/T, Y/U, , / .). Zonder modifier is geen letter of cijfer vrij; Cmd/Ctrl/Alt blijven van het systeem. **Advies:** zo proberen.
- [ ] **SVT2. Shift+I wisselde eerst de focus (net als I), shift+W/O waren cue.** 💬 Nu springen ze naar een sectie; hou je shift nog vast na shift+Q/P (starten op de maat) en tik je dan W of O voor cue, dan spring je in plaats daarvan. **Advies:** zo laten; zonder shift doen ze wat ze deden.
- [ ] **SVT3. Vorige/volgende op de eerste of laatste sectie geeft een melding** ("track 1: al bij de laatste sectie (8 van 8)"), de speelkop blijft staan. 💬 Liever rondgaan (na de laatste weer de eerste)? **Advies:** de melding laten; rondgaan springt ongemerkt terug naar de intro.

**Sampler** (speellijst "Een sectie in de sampler")
- [ ] **SVS1. Een sectie in een pad loopt van haar "1" tot de "1" van de volgende, in hele maten.** 🎧 De opmaat vóór de eerste "1" komt in geen pad; de laatste sectie stopt op de laatste hele maat. Verspringt de "1" van het grid binnen de sectie (een maat van bv. 6 tellen), dan stopt de pad op de "1" ervóór en zegt een melding hoeveel tellen wegvallen. **Advies:** zo; mis je een staartje (een fill), zeg het.
- [ ] **SVS2. Een sectie-pad start op de volgende "1" van de maatgever, niet op de tel.** 🎧 Hij wacht dus tot bijna een maat. Gewone pads (1–8 tellen) starten zoals altijd op de volgende tel. Een pad is een sectie als hij meer dan 8 tellen heeft (ook een bewaarde pad weet het zo, zonder nieuw veld); een sectie van 2 maten of korter start daardoor op de tel (de APC-kaart zegt dat). **Advies:** zo; wil je soms meteen, dan een shift-variant.
- [ ] **SVS3. Een sectie-pad houdt bij herankeren ook de maat vast.** 🎧 Springt de maatgever een tel (beatjump 1), dan schuift de pad tot twee tellen mee zodat de "1"-en gelijk blijven; in een loop die geen hele maten is alleen de tel. Ook met keylock en een sprong terug blijft een wachtende pad op zijn "1". **Advies:** proberen met beatjump 1 en 4, ook met keylock aan.
- [ ] **SVS4. Grens 32 maten en 90 s per pad.** 💬 Een pad houdt de audio vast: ~23 MB per minuut, acht volle pads ~280 MB. 32 maten is de langste sectie van de analyse; tot 86 bpm past die in 90 s. Langer (een mix, ambient op 70 bpm): een melding en het lampje uit (als loop op de track kan het wel). **Advies:** zo; loop je er vaak tegenaan, naar 120 s.
- [ ] **SVS5. Bediening: rij 3 van de modus sampler, zonder shift.** 🎛 Shift + een lege pad betekent al "vergeten" (scherm). Rij 3 was leeg, onder "leegmaken". Lampje: donker hemelsblauw = kan, uit = kan niet (een druk zegt waarom). Op het scherm-als-APC, niet in de SAMPLER-rij. **Advies:** zo laten; wil je hem ook in de SAMPLER-rij, zeg het.
- [ ] **SVS6. Een sectie op een onzeker grid wordt geweigerd.** 🎧 Een pad die naast de tel loopt hoor je meteen; waar de analyse het grid onzeker vindt, komt een melding en blijft het lampje uit (zoals bij beat-loops). Op het synthetische nummer in Chrome 2 van de 7 secties. **Advies:** klinkt het grid goed, zet het op slot (Lock in grid-modus); daarna kan het.

**Handelingenlog** (speellijst "Secties terugspelen")
- [ ] **SVL1. Speelt een set met sectiesprongen precies zo terug?** 🎧 Het log bewaart de sectiekaart, en bij elke sectiedruk de plek waarvan de sprong rekende; dat geldt ook voor "volgende" aan het eind van het nummer. Terugspelen haalt de kaart niet van de server, dus na een herberekening (ander grid) landt `section.5` waar hij toen landde. Gemeten in Chrome: 0–8 ms naast, nooit een maat. **Advies:** speellijst "Secties terugspelen". Hoor je een sprong een maat te laat, op een andere plek, of een melding "al bij de laatste sectie" die er toen niet was, zeg welke.
- [ ] **SVL2. Logs van vóór deze tak met sectiedrukken spelen terug met de kaart van nu.** 💬 Een log zonder sectiekaart speelt terug zoals voorheen, met de kaart die de server nu geeft; is die opnieuw gerekend, dan springt `section.5` ergens anders. **Advies:** zo laten (hooguit de logs van vandaag).
- [ ] **SVL3. Ook hotcues met quantize, beatloops en starten op de maat zo exact terugspelen?** 💬 Een regel komt tot een tik (10 ms) te laat; voor secties is dat opgevangen, bij die andere sprongen kan een tik op de rand van hun marge nog een tel schelen (starten op de maat misschien een maat). Niet gemeten. **Advies:** pas bouwen als je het hoort.

**Planvenster** (speellijst "Planvenster met secties")
- [ ] **SVP1. Secties berekenen vanuit het planvenster?** 💬 Het venster vraagt alleen kaarten die er al zijn (zonder `maak=1`; anders gaan dertig nummers tegelijk rekenen); een nummer dat nooit geladen is krijgt geen in/uit-keuze. **Advies:** eerst zo; kom je vaak een nummer zonder kaart tegen, dan een knop "secties" per rij (één tegelijk).
- [ ] **SVP2. In kiezen met een keuzelijst of in de strook?** 👀 Nu een lijst onder "begin" ("3 drop C"). **Advies:** zo; klikken op een band als de lijst te klein of te traag voelt.
- [ ] **SVP3. Uit en duur samen: welke wint?** 🎧 Nu is de duur de grens: een uit telt alleen als de overgang vóór het einde van de duur past; anders kiest de auto-DJ zelf (outro, break, frasegrens). Het venster maakt zo'n uit niet oranje; je ziet het alleen doordat de overgang in de strook ergens anders begint. **Advies:** uit wint en de duur wordt alleen de terugval zonder kaart; dan moet het venster bij een gekozen uit de duur leeg laten of verlengen.
- [x] **SVP4. Strook altijd waar de auto-DJ de overgang echt begint?** 👀 — gedaan 6 okt (avond): de strook toont het moment van de planner (`momentArgs`, dezelfde regel als de automaat), ook zonder uit. Een blend begint daardoor tot 16 maten eerder dan de oude tekening.


**Auto-DJ** (speellijst "Auto-DJ met secties")
- [ ] **SVA1. Uitmixen op de outro.** 👂 Met een sectiekaart op een zeker grid begint de overgang waar de outro van de uitgaande begint (als hij daar nog vóór het eind past), niet meer op een veelvoud van 16 maten vanaf het anker (vaak midden in de laatste drop); de nieuwe begint op zijn intro. **Advies:** zo laten; zeg het als hij bij een lange outro te vroeg weggaat.
- [ ] **SVA2. Past de outro niet: de laatste break.** 👂 Volgorde: de laatste break binnen 32 maten van het eind → het oude moment als dat niet in een drop valt → het begin van iets anders dan een drop → het begin van een drop. **Advies:** proberen; is de break te vroeg, dan het venster naar 16 maten.
- [ ] **SVA3. Secties ook bij beatloos overvloeien op een onzeker grid?** 💬 Nu alleen op een zeker grid; in jouw library (overvloeien is de hoofdroute) doen ze bij het uitmixen dus bijna niets. **Advies:** ja, maar pas als SE2 laat zien dat de grenzen op onzekere grids kloppen.
- [ ] **SVA4. langer en nu naar de volgende sectiegrens?** 🎛 langer = volgende grens binnen 16 maten (anders 8), nu = volgende grens binnen 8 maten (anders de eerstvolgende 4); beatloos blijft nu meteen. **Advies:** zo laten.
- [ ] **SVA5. Een sectie drukken terwijl de volgende klaarstaat.** 🎛 Op wat nu klinkt: springt hij echt, dan plant hij opnieuw vanaf de nieuwe plek (geen overname); past de overgang daar niet meer vóór het einde, dan loopt hij vanaf waar je bent, zoals na een seek. Een druk die niets doet (geen sectie, loop om de sectie waar je al bent) verandert niets. Op de klaarstaande track: overname, zoals seek en hotcue. Alternatief: die sectie wordt het nieuwe beginpunt en de automaat mixt door. **Advies:** zo laten; het alternatief als je het mist.


**Controlekamer** (speellijst "Avond 1 · Secties")
- [ ] **SVC1. Secties meteen na het binnenhalen uitrekenen?** 💬 Nu krijgt een nieuw nummer pas secties als je het laadt (het laden wacht dan ~0,3–1 s op de server) of na een herstart van de server (de achtergrond). Tot dan staat het in de Controlekamer als "nog zonder". Na een split in stems of een ander grid staat de kaart als "verouderd" tot je het nummer laadt. Meteen rekenen, achter grid en toonsoort in de worker, kost de server ~1 s per nummer terwijl je mixt. **Advies:** ja, na het binnenhalen en na een split; dan hoeft het laden nooit te wachten.

**Maschine** (speellijst "Secties op de Maschine")
- [ ] **SVM1. De pads in de modus secties zijn de secties van de FOCUS-track?** 🎛 Groep A–H kiest de track, net als Track Select op de APC (SE3). De speeltrack kan niet: die heeft altijd een instrument en dus geen secties. **Advies:** zo laten.
- [ ] **SVM2. Kleuren zoals op de APC: wit = die hoor je, donker hemelsblauw = er is een sectie, uit = geen?** 👀 De Maschine kan niet knipperen op de tel. De sectie waar je heen springt licht pas op bij de "1"; tot dan zegt het scherm "op de 1: …". **Advies:** eerst zo. Groepskleuren volgen SE4, dan op beide controllers tegelijk.
- [ ] **SVM3. SHIFT + pad = die sectie als loop, zoals op de APC?** 💬 Niet gebouwd (niet gevraagd). De action `track.N.section.K.loop` bestaat al op de bus. **Advies:** ja, als je het op de APC gebruikt; het is een kleine stap.
- [ ] **SVM4. Meer dan 16 secties: bladeren met ◄ ► (transport)?** 🎛 Bij een andere focus-track begint hij op de bladzijde met de sectie die je hoort; daarna loopt de bladzijde niet mee, dus de pads verspringen nooit onder je vingers. De kop noemt altijd wat je hoort, ook boven de 40. **Advies:** zo laten.
- [ ] **SVM5. Het linkerscherm: de namen in een raster zoals de pads liggen, de sectie die je hoort omgekeerd, de kop groot?** 👀 Letters 5×7 in kolommen van 64 px; een naam is hooguit 8 tekens ("opbouw B"). **Advies:** op het echte toestel kijken; is het te klein, dan minder tekst en grotere letters.


**In beeld** (speellijst "Secties in beeld")
- [ ] **SVV1. De video-puls slaat op een nieuwe sectie vol, ook als je de puls zacht hebt staan: goed zo?** 👀 Het accent komt op de puls die er al is: het gekozen doel gaat op elke nieuwe sectie VOL, wat de diepte ook is; alleen met de puls aan (PULS op 0 = ook geen accent). Bij doel flits is dat een witte flits op de grens. Bij pixel, spiegel en korrel is het bij elke grens het volle effect, ook met PULS op 0,01, en de hub-macro `macro.beweging` (K4 = PULS) geeft op een lage stand al volle flitsen of effecten op elke grens. Geen nieuw puls-doel en geen nieuwe knop (de doelen lopen rond in het handelingenlog). Alternatieven: (a) zo laten; (b) vol alleen bij flits, bij de effecten met de diepte mee (bv. 3 × de diepte); (c) een schakelaar "puls op: tel · sectie · beide" (één knop, als stand in het log). **Advies:** (b). Probeer eerst doel flits met de puls laag, en zeg wat je bij pixel ziet.
- [ ] **SVV2. Hoe lang gloeit een nieuwe sectie na?** 👀 Als een klap, maar twee keer zo lang: vol op de grens, na 0,3 s nog 22 %, na ~1,8 s weg (`NIEUW_TAU` 0,2 s). Dezelfde vorm voor de vormlaag (bron "nieuwe sectie") en de video-puls. Niet op de beamer bekeken. **Advies:** zo laten, tenzij de flits te kort is om op de beamer te zien; dan 0,3–0,5 s (één getal).
- [ ] **SVV3. Sectie-energie als bron: springen op de grens, glijden bij een wissel?** 👀 De vorm krijgt de energie van de sectie die je hoort (0..1 binnen het nummer, van de server). Op een grens, een sectiesprong of een loop springt hij mee. Neemt een andere track de maat over of komt de kaart later binnen, dan glijdt hij in ~0,75 s naar de nieuwe waarde. Valt de maatgever weg, dan blijft de energie eerst 0,5 s staan (een cut in de mix) en glijdt dan in ~1,5 s naar 0. **Advies:** zo proberen. Kloppen de stappen niet met wat je hoort, dan ligt het waarschijnlijk aan de energie per sectie (SE2).
- [ ] **SVV4. Op een nieuwe sectie ook de mengvorm wisselen?** 💬 Niet gebouwd: het verandert een stand die in het log staat (`video.mode`), en elke grens zou de mengvorm één plek doorschuiven. **Advies:** eerst de flits; wil je het, dan als eigen schakelaar.
- [ ] **SVV5. Een korte loop of stutter op een sectiebegin: één accent?** 👀 Gekozen (7 okt): het rondgaan van een loop korter dan een maat, en hetzelfde sectiebegin binnen een maat (hotcue- of pad-stutter), is geen nieuwe sectie, in beeld én in de hub. Een sectie-loop (≥ 1 maat) klapt elke ronde. **Advies:** op de beamer kijken; mis je de flits per rondgang bij een korte loop, zeg het.
- [ ] **SVV6. Energie vasthouden bij een cut?** 👀 Gekozen (7 okt): korter dan 0,5 s geen maatgever (een cut met de fader of crossfader) houdt de energie vast, in beeld en in de hub; daarna glijdt hij naar 0. **Advies:** proberen; is een halve seconde te kort of te lang, één getal (`HOUD`).


**Hub** (speellijst "Secties naar de hub"; AV-app-hub PROTOCOL.md §18)
- [ ] **SVH1. Een nieuw nummer: een klap of niet?** 👀 Stopt A en start B op zijn cue op een sectiebegin, dan een klap (dat is starten). Neemt een nummer dat al speelde de maat over in een mix, dan geen klap; label en energie gaan wel mee, en de volgende grens in dat nummer klapt wel. Spelen vanaf het begin van een nummer en een hotcue midden in een sectie geven geen klap (zoals in beeld). **Advies:** zo laten: een overname valt op de hysterese, niet op een "1".
- [ ] **SVH2. Pauze: label laten staan?** 💬 Het label blijft staan met energie 0 ("drop, 0"). Energie 0 is ook een intro (de energie is relatief binnen het nummer): een beeld-app ziet geen verschil tussen pauze en intro. **Advies:** zo laten tot een beeld-app het verschil nodig heeft; anders een label `stil`.
- [ ] **SVH3. Hoe vaak mag de hub een nieuwe sectie krijgen?** 💬 Gekozen (7 okt): hooguit één per seconde (vangnet in hub.js), en alles samen hooguit 10 per seconde in een schuivend venster waarin de `nieuw` meetelt; de `nieuw` gaat altijd meteen, gewone berichten wachten. **Advies:** zo laten.
- [ ] **SVH4. Welke energie draagt een nieuwe sectie?** 💬 Gekozen (7 okt): die van de sectie zelf (het doel), niet die van het glijden; daarna glijdt de hub-energie niet van onderen op. **Advies:** zo laten.

## BE. Beeld: VARVE stuurt de Stroommachine (6 okt, docs/BEELD.md, tak `studio/beeld`)

- [ ] **BE1. De acht macro's op de device knobs, niet op de faders.** 🎛 De opdracht noemde "8 faders", maar de track-faders zijn de kern (volume) en die zit nooit in een mapje. Nu: Shift + Detail View opent het mapje beeld, device knob 1–8 = intensiteit · snelheid · helderheid · feedback · tint · dichtheid · glitch · balans (endless, de ring toont de stand). **Advies:** zo proberen; wil je toch faders, dan alleen via koppelen (op eigen risico: een fader is dan geen volume meer).
- [ ] **BE2. Thru-tracks geven geen scène.** 🎛 Het protocol kent deck A en B; VARVE maakt daarvan de crossfaderkant: deck A = de track op kant A die speelt (of het laatst geladen werd), deck B idem. Tracks op thru (standaard 3–8) sturen niets. Alternatief: een thru-track telt bij de kant waar de crossfader nu staat. **Advies:** zo laten (voorspelbaar: zet een track op A of B met de A|B-knop als hij een scène moet krijgen).
- [ ] **BE3. De ringen beginnen op de neutrale stand van de Stroommachine.** 🎛 Ze meldt haar macro-standen niet terug; je eerste draai zet de macro op de neutrale stand plus de draai (heb je op de pc intussen iets anders gezet, dan springt hij). **Advies:** vragen aan de Stroommachine-kant: de macro-standen in `beeld-status` meesturen; dan volgen de ringen haar.
- [ ] **BE4. Lampjes van de regie: nu alleen "verbonden" en "ingedrukt".** 👀 Vasthouden en paniek zijn schakelaars in de Stroommachine; VARVE weet hun stand niet, dus scene 3 en Stop All tonen niet of ze aan staan. **Advies:** later, samen met BE3 (`hold` en `paniek` in `beeld-status`).
- [ ] **BE5. Volgorde op de scene-knoppen: ontdek · volgende · vasthouden · flits · vrij, Stop All = paniek.** 🎛 De Stroommachine zelf heeft op scene 1–5 ontdek · mutatie · kweek · volgende · vasthouden, flits op Metronome en vrij op Lock; die twee knoppen zijn in VARVE bezet. **Advies:** zo proberen; zeg het als je spiergeheugen van de Stroommachine wint (dan mutatie en kweek erbij en flits/vrij ergens anders).
- [ ] **BE6. De extra latentie afstellen.** 🎧👀 Standaard 0 ms. **Advies:** op de eerste avond met de beamer: een nummer met een harde kick, kijk naar een flits op de tel, en ijk op één plek (een beamer loopt vaak 50–120 ms achter): met Stroommachine v10 IJken op de pc (tab Live → Varve DJ) en de latentie in Varve op 0; zonder v10 de latentie in Varve hoger tot de flits op de kick valt. Noteer de waarde, dan zet ik het als standaard.
- [ ] **BE7. Zonder pc: beeld uitzetten, of laten zoeken?** 💬 Staat beeld aan zonder relay, dan probeert VARVE het elke 10 s opnieuw: één melding na 8 s, verder stil, maar Chrome logt elke mislukte poging zelf rood in zijn console (niet te onderdrukken; ~3 regels per poging). Het spelen merkt er niets van. **Advies:** zo laten; zet beeld uit (BEELD-rij) als je weet dat de pc niet meekomt.
- [ ] **BE8. Een relay buiten het LAN mag.** 💬 De hub (`?hub=`) weigert een host buiten deze machine, het LAN en de tailnet zonder `&hub_extern=1`. Het relay-adres typ je zelf in (geen link die iemand je stuurt), en er gaat alleen klok, kenmerken, titels en de crossfader heen. **Advies:** zo laten.
- [ ] **BE9. Terugspelen stuurt de macro's opnieuw, de regieknoppen niet.** 💬 `beeld.*` staat in het log zoals elke action. Bij terugspelen gaan de macro's opnieuw naar de Stroommachine (als beeld aan staat); de regie (`beeld.regie.*`) wordt overgeslagen, want vasthouden en paniek zijn schakelaars waarvan VARVE de stand niet kent (terugspelen kon ze omgekeerd zetten). **Advies:** zo laten.
- [ ] **BE10. Scène wisselen op de stand van de crossfader, of op wat je hoort?** 🎧 De Stroommachine wisselt van scène voorbij 0,5. Met een scherpe crossfadercurve (Metronome) hoor je B al bijna helemaal bij 0,1, maar blijft het beeld op A tot 0,5. Alternatief: VARVE stuurt een "effectieve" stand (hoe hard B klinkt t.o.v. A). **Advies:** eerst zo; pas als het met de scherpe curve vreemd voelt.
- [ ] **BE11. Wanneer is "de Stroommachine op de Mac zelf" goed genoeg?** 🎧👀 (10 okt, docs/BEELD.md §8) Voorstel: op 1920 × 1080 in Licht p50 ≥ 55 en p10 ≥ 30 fps (eigen rAF-meter); 0 hartslaggaten > 15 ms in 120 s in nul, Licht en het zaalbeeld (positieve controle geslaagd); VARVE-rAF p99 hooguit 4 ms boven nul; Stroommachine + relay samen < 1 kern; na 20 min nog steeds, warmte hooguit `fair`. Gemeten wordt met `tools/headless/beeld-lokaal.mjs` (nog niet gedraaid). **Advies:** deze drempels; je beslist na de speelproef met je oren.
- [ ] **BE12. Wat komt er op het doek, nu en later?** 👀 Nu, één HDMI: het zaalbeeld (vormen zonder clips, `video.clips`; standaard onderweg) of het venster van de Stroommachine (upgrade). Later: de Stroommachine ín het losse venster van Varve, onder de vormen, met `video.black` en in de opname (eerst een meting). **Advies:** zaalbeeld als standaard; "beide in één beeld" als richting, pas na die meting.
- [ ] **BE13. Welke beamer?** 💬 Model, eigen resolutie (1080p?), Hz (60 graag: 75 Hz via de hub viel thuis zwart) en de HDMI-weg (een USB-C-hub met PD-doorvoer: de Air heeft twee poorten voor beamer, Scarlett, APC en lader). Feiten die de meting en de paklijst nodig hebben.
- [ ] **BE14. Standaarden voor beeld op één machine (ok = besloten).** 💬 (a) De Stroommachine draait straks in een eigen Chrome-bundel (een kopie van Chrome for Testing in `~/Applications/`), zodat VARVE.app nooit de verkeerde Chrome aanspreekt; (b) eerst een script, na de speelproef een Dock-app "VARVE + beeld"; (c) clips uit is de standaard onderweg zodra er een stand voor is, thuis alles aan; (d) lokaal de stand Licht; (e) v10 van de Stroommachine samenvoegen (jouw repo); (f) `video.window` (venster openen vanaf de APC) niet bouwen: Chrome blokkeert het zonder klik; (g) de fps-meter op het doek alleen tijdens de proef. **Advies:** alles zo, zeg het als je iets anders wilt.

- [ ] **BE15. De klap: de hele mix of alleen de bas?** 👀🎧 (13 okt, docs/BEELD.md §2a) `mix.klap` is de onset van de hele master; op de eerste avond met de pc piekte hij vaak tussen de kicks (hats, snare), en de Stroommachine flitst op het maximum van `mix.klap` en `maat.klap`. Alternatief: de onset alleen op de band laag, of `mix.klap` weglaten zodat alleen de tel flitst. **Advies:** eerst een avond met het nieuwe niveau (laag/midden/hoog/luid pompen nu); pas als de flitsen dan nog tussen de kicks storen.

## U. Uitzenden (10 okt, docs/UITZENDEN.md, tak `visie/uitzenden`)

Zin één: wat uitgezonden wordt is het **mengcanvas van de Mac**, niet wat op de beamer staat als daar de
Stroommachine draait. En met beeld gaat in v1 nooit iets naar buiten: het mengcanvas bevat de YouTube-clips van
de decks (I78); naar buiten met beeld = jouw vormen, niet de clips. Gebouwd is alleen stap 1 (`server/uitzend.js`,
lokaal: bestand, 127.0.0.1-RTMP, udp naar OBS); niets in de mixer of de server roept hem nog aan.

- [ ] **U1a. Een uitgang naar een bestand of 127.0.0.1 valt binnen "geen publieke streaming"?** 💬 Voorgestelde zin onder `CLAUDE.md` r.29-31: *"Een uitgang naar een bestand of naar 127.0.0.1 (een lokale ontvanger, OBS) is geen publieke streaming: wat de master en het mengcanvas samen maken verlaat de machine daarmee niet. De cache (`media/`, `library.db`) verlaat deze machine nooit."* Dit opent niets; het zegt alleen dat de proef- en OBS-doelen binnen de regel vallen (VISIE §4: de regel ging over de cache). Nodig voor stap 1-7. Bij U1a komen ook de drie structuurregels in `CLAUDE.md` erbij (`server/uitzend.js`, `test/uitzend.test.mjs`, `docs/UITZENDEN.md`): stap 1 raakt `CLAUDE.md` bewust niet, dus tot dan kent de "bron van waarheid" deze bestanden niet. **Advies:** ja.
- [ ] **U1b. In-app naar buiten (stap 8), alleen als OBS te zwaar blijkt?** 💬 Dan laat `toegestaan()` `rtmp(s)://` naar een dienst toe voor een doel dat jij zelf in `uitzend/doelen.json` zet, met een verplicht veld `rechten`, en met beeld alleen als de zaalmodus-schakelaar de clips dooft. Regeltekst: *"Uitzenden van de eigen set mag, als afgeleide van een lopende opname, naar een doel dat Clay zelf in `uitzend/doelen.json` heeft gezet en dat een rechtenregel draagt. Wil een feature de cache zelf naar buiten: eerst melden, niet stilletjes bouwen."* Zolang dit geen "ja" is, zit het slot in de code (een eigen PR opent het, geen instelling). **Advies:** nog niet; eerst de thuisproef via OBS (stap 5b).
- [ ] **U2. De eerste echte route en de eerste echte uitzending?** 💬 Uit het record van 9 okt (I77), niet nagekeken bij de diensten, geen juridisch advies: (a) **Varve -> OBS -> Twitch via het DJ Program**: het doel staat al in je OBS, het programma regelt de rechten voor muziek van anderen (geen VOD's, clips zonder muziek); (b) **Mixcloud Live**: ≤ 4 per artiest, ≤ 3 achter elkaar, ≤ 3 per release, met tracklist uit het setboek (aanname: betaald account); (c) **eigen kanaal (YouTube/Twitch/Icecast) alleen met eigen werk of CC**, nooit met muziek van anderen (Content ID, drie strikes). Een eigen avond met inkomsten die je zelf streamt: Sena-livestreamlicentie (3 %, min. € 60,25, vooraf). Of voorlopig alleen de thuisproef. **Advies:** als eerste een **eigen-werk-sessie** (klankschaal, instrumenten, sampler, patronen, je eigen zes items, je vormen als beeld) op je eigen kanaal: kan zonder rechtenzorg en is precies de crossover uit VISIE §2. Daarna (a).
- [ ] **U3. iCloud en de opnamemap?** 💬 `opnames/` staat op het iCloud-Bureaublad. Tijdens een uitzending wil iCloud de opname (~9,5 Mbit/s met beeld) uploaden over dezelfde wifi of hotspot als de stream (2,5-3,5 Mbit/s); een set van 2 uur is ~8,6 GB. De uitzendbestanden zelf staan al buiten iCloud (`~/Movies/VARVE-uitzend/`), en `stand()` waarschuwt. Keuze: (a) iCloud Drive pauzeren tijdens een uitzending (handwerk, checklist); (b) de opnamemap verhuizen naar een `.nosync`-map of `~/Movies` (raakt "opnames blijven in iCloud" en het avondpakket, spoor draagbaar); (c) alleen thuis op wifi uitzenden. **Advies:** (a) nu, (b) als je echt vanaf elke plek wilt.

Standaardkeuzes zonder vraag (zeg het als je het anders wilt; docs/UITZENDEN.md §8): standaardbeeld zwart (golf en een eigen png als variant), 2 fps lokaal en 15 voor een dienst, `kopie` alleen intern, proefbestanden in `~/Movies/VARVE-uitzend/`, `cut` dempt later alleen de stream, een sleutel ooit uit de sleutelhanger, geen iPhone-monitor via HLS.

---

## CX. Crossover (10 okt, docs/INSTRUMENTEN.md "Uit de sampler", PR #26)

Een knip uit de sampler als drumpad op de Drums (`sampler.N.drums`, knoppen `1→13 … 8→12`
onder de sampler-pads): het stuk krijgt de strip en de cue van een track en speelt in een
patroon. Proef: het speellijstblok `crossover` (Controlekamer).

- [ ] **CX1. Welke Drums krijgt de knip?** 💬 Gebouwd: de **speeltrack** (waar het toetsenbord en de speelmodus van de Maschine spelen: de focus, anders de laatst gefocuste instrumenttrack) als die de Drums heeft, anders de enige Drums-track; geweigerd alleen als de speeltrack een ander instrument is en er twee of meer Drums zijn. De melding noemt altijd de track. Je knipt met de focus op het nummer, dus met twee Drums beslist de speeltrack zonder dat je de focus verzet. Alternatief (het eerste ontwerp): bij twee Drums altijd weigeren tot je de focus op een Drums zet. **Advies:** zo laten: het stuk landt waar noot 48 ook aankomt.
- [ ] **CX2. Drumpads bewaren bij de set?** 💬 Nu zijn pads 9–16 na herladen leeg; gebruikt een patroon ze, dan zegt een melding het. Bewaren (stap 2, ~2–2,5 dagen) zet per pad het library-nummer, van–tot, tellen, bpm en de stems in de patronenset, en knipt het stuk bij het laden opnieuw; alleen stukken uit de library (niet de demo of een los bestand). **Advies:** beslissen na de proef: miste je ze na herladen, dan bouwen.
- [ ] **CX3. Eigen opnames naar de library?** 💬 `CLAUDE.md` zegt "geen upload". Stap 3a gebruikt alleen wat er al is: een kopie van een opname in een kladmap, `node tools/lokaal/importeer.mjs --droog` (alleen lezen), en op je ja echt importeren op een dag zonder set (stems en video uit). Stap 3b zou een knop `record.library` en een route toevoegen; dan zou de regel worden "geen upload van buiten, geen distributie van de cache; eigen opnames en renders naar de eigen library mag", en dan kies je ook hoe een opname genormaliseerd wordt. **Advies:** 3a proberen na de proefavonden; 3b niet bouwen zonder je ja op 3a én op de regel.
- [ ] **CX4. Wanneer de proef, en dus wanneer mergen?** 💬 Hangt aan keuze 1 uit het verbeterplan van 9 okt ("Tot na avond 2 alleen repareren wat op de proefavond fout gaat?"). **Ja** → PR #26 pas mergen na de verwerking van avond 2, de proef op de avond daarna (bij het mergen gaat het blok `crossover` naar avond 3: titel "Avond 3 · …", achter `beeld-pc`, en de tellingen in `docs/CONTROLEKAMER.md` en `HANDOFF.md` mee). **Nee** → mergen na de verwerking van avond 1, de proef op avond 2 (het blok staat daar al, na de sampler op de Maschine). De crossover is nieuw werk, geen reparatie. **Advies:** volg wat je bij keuze 1 kiest (het verbeterplan raadt ja aan).
- [ ] **CX5. Leegmaken en het opschrift `1→13`?** 👀 Er is geen knop om een drumpad leeg te maken: een nieuwe `1→13` overschrijft. Het opschrift noemt de sampler-pad en de drumpad (de pads staan 4 × 2, de knoppen 8 × 1). **Advies:** zo laten tot je leegmaken mist; zeg het als `1→13` niet duidelijk is.

---

## O. AV-app-hub (3 okt, `?hub=`, CLAUDE.md AV-APP-HUB)

- [ ] **O1. LPD8 K1 (intensiteit) in VARVE?** 🎛 K1 hing eerst aan het
  audio-eindvolume (master). Weggehaald: de pickup van K1 volgt de EERSTE app met
  die rol, en andere apps gebruiken intensiteit als beeld (av-scene-kit 0,35);
  wie K1 dichtdraait om het beeld rustig te maken, zette ook de mix stil (gemeten
  0,80 → 0,43). Nu doet K1 niets in VARVE. Wil je hem wel: aan een BEELD-param
  (bv. de video-fx-intensiteit of de puls), of zo laten? **Advies:** zo laten;
  K2 (helderheid = video-master) en K4 (beweging = puls) doen al het beeld.
- [ ] **O2. Bank: keylock of hubtoets?** 🎛 Je koos 25 sep (I4) Bank voor keylock,
  met Shift + Bank = pitchbereik. De hub gebruikt Bank als hubtoets
  (`config.json` → `hubtoets`): met `?hub=` komt Bank nooit bij VARVE aan.
  Kiezen: keylock krijgt een andere toets (bv. Detail View, nu vrij zonder
  `?vormen=1`), óf de hubtoets van de hub wordt een andere (dat raakt alle
  apps, PROTOCOL §5/§7). **Advies:** keylock naar een andere toets; de hubtoets
  is voor elke app hetzelfde.

---

## AP. Avondpakket (10 okt, docs/AVONDPAKKET.md §14, tak `visie/draagbaar`)

De elf open keuzes van het avondpakket (de controle vóór vertrek en bij aankomst) staan met
de stand van nu in **docs/AVONDPAKKET.md §14**: speaker en koptelefoon, PD-doorvoer van de
hub, een kopie buiten de laptop, iCloud en `media/`, wat "de speellijst" is, profielen en
grenzen, fase `auto`, Tailscale serve, stap 7a, stap 8/9, de LPD8.

- [ ] **AP9. Stap 7a (morgenochtend, eerst nodig).** 💬 Mag een agent, met de mixer dicht en
  de apparaten van de proefavond nog aangesloten, twee alleen-lezen-commando's draaien
  (`system_profiler … -json`, `ioreg -p IOUSB …`)? Of doe je het zelf: de commando's staan
  letterlijk in §14 punt 9. **Advies:** een agent, dan zijn de fixtures dezelfde ochtend echt.

## S9. Een set klaarzetten, live bijmixen, sets (14 okt, docs/PLAN-SET.md, tak `werk/S9`)

- [ ] **S9-1 💬 De boog.** "maak set" zet de nummers standaard in een boog (rustig, piek op 70%,
  iets terug). De energie is een gok uit bpm, luidheid en de luidste sectie. Klopt de vorm voor jouw
  avonden, of liever oplopend als standaard (of iets anders: een golf met twee pieken)?
- [ ] **S9-2 👂 De niveaus van een laag.** Een laag gaat in 4 maten open tot fader 0,8 en na zijn
  duur in 4 maten dicht. Is 0,8 goed bovenop de mix, en 4 maten?
- [ ] **S9-3 💬 Tracks van de automaat.** Zonder `tracks` in het plan laadt hij nooit op een track
  waar jij de laatste 2 minuten iets aan deed. Is 2 minuten goed, of liever een vaste verdeling als
  standaard (bv. 1–2 voor de automaat, 3–8 voor jou)? **Advies:** zet het per plan (veld "tracks
  auto"); 2 minuten is de vangrail.
- [ ] **S9-4 💬 GO en terugladen vanaf de iPad.** `plan.*` (GO, buiten/terug, lagen) en een set
  KIEZEN mogen van buiten de Mac als je ze in `mag` van dat scherm zet; `set.bewaar` en
  `set.terugladen` nooit (terugladen laadt nummers en kiest een werkruimte, net als wat VAST_NOOIT al
  verbiedt). Wil je terugladen toch vanaf de iPad (met de tweede druk)? En moet GO, dat de automaat
  laat laden, juist ook nooit van buiten?
- [ ] **S9-5 💬 Wat zit er in een set.** Plan en patronen als kopie, de werkruimte op naam, de mixer
  alleen met "met mixer". Moet de werkruimte ook als kopie mee (dan is een set helemaal draagbaar,
  maar een latere aanpassing van je werkruimte zit niet in oude sets)?
- [ ] **S9-6 💬 Backup van sets.** De backup neemt alleen `library.db` mee; `sets/`, `plannen/` en
  `patronen/` zijn bestanden in de Bureaublad-map. Moet de backup ze ook kopiëren?
- [ ] **S9-7 💬 Een set kiezen in de Controlekamer** ("een set kiezen voor vanavond", de aanvulling)
  is niet gebouwd: de keuze en het terugladen zitten in het planvenster, het vak `sets` en de
  actions. Wil je hem ook als tegel in de Controlekamer?
- [ ] **S9-8 👂 Live te bevestigen**: een laag op de maat (sync + op de maat) met echte nummers, GO
  op de APC (het voorbeeldstuk `set-voorbeeld`), terugladen van een set met acht tracks op de M1.

## S10. Meer effecten en meer mogelijkheden bij het maken (14 okt, docs/EFFECTEN-MEER.md, tak `werk/S10`)

- [ ] **S10-1 👂 De sjablonen.** 25 nieuwe (de lijst met één zin per stuk: `docs/verslagen/2026-10-14/werk-S10.md`).
  Alles is gemeten (droog in de beginstand, begrensd, klikvrij), niets beluisterd. Welke houd je, welke
  gaan weg, en liggen de knoppen op het gehoor goed? Een sjabloon aanpassen kan in de editor en dan
  "als sjabloon" (een eigen sjabloon), of in `racks/sjablonen.json`.
- [ ] **S10-2 💬 Modulators als besturing.** Een modulator rekent elke 33 ms op de audioklok en het
  effect glijdt (vrij hooguit 8 Hz). Genoeg, of wil je een LFO op audiosnelheid op elke parameter
  (dan moet elk effect zijn schaling in een worklet doen: een groot werk)? **Advies:** zo laten; voor
  snel zijn tremolo, autopan, vibrato en chorus er.
- [ ] **S10-3 👂 De kam glijdt.** Een nieuwe toon schuift in 20 ms (het hele naklinken gaat mee
  omhoog of omlaag), anders dan de delay (twee koppen, nooit glijden). Klinkt dat als een instrument,
  of liever springen met overvloeien?
- [ ] **S10-4 👂 De klinker.** Make-up ×1,2·Q, hooguit ×8: op Q 20 is hij 12 dB zachter dan droog, en
  een toon precies op een formant kan +18 dB komen. Liever even luid (en meer risico op pieken), of zo?
- [ ] **S10-5 💬 Eigen sjablonen vanaf de iPad.** Kiezen (sjabloon ◀ ▶), de knoppen en de XY-pad mag
  van de iPad (bouwsteen `sjablonen`, als `mag` het noemt). Bewaren en wissen niet: dat staat niet op
  de bus en de editor is alleen in de mixer. **Advies:** zo laten (een rack bewaren schrijft naar de
  server, zoals werk.opslaan dat nooit van buiten mag).
- [ ] **S10-6 💬 De XY-pad van een sjabloon.** Elk sjabloon zegt welke twee knoppen samen op de XY-pad
  passen (`xy`), en `track.N.fx.xy.x/.y` volgen dat. Wil je dat de bouwsteen `sjablonen` (of jouw
  xy-paneel) standaard die actions gebruikt in plaats van knop 1 en 2?
- [ ] **S10-7 💬 Master-lijm op de master.** Het sjabloon staat in de lijst van de master-racks (zoals
  alle sjablonen). In de beginstand pakt hij alleen pieken boven −9 dB; MIX begint op 0. Wil je hem
  standaard op de master, of alleen als je hem kiest?
- [ ] **S10-8 💬 Band is het zwaarste nieuwe effect** (6,7% van een kern voor acht, gemeten in deze
  container; twee vibrato-trappen). Goed, of liever één trap (alleen wow)?
- [ ] **S10-9 💬 Volgende stap**: echte parallelle ketens (twee ketens naast elkaar met elk een mix),
  een stutter/korrel-effect binnen het rack, of eerst de sjablonen op het gehoor afmaken?

## S11. Categorieën en tags in de library (14 okt, docs/LIBRARY-TAGS.md, tak `werk/S11`)

- [ ] **S11-1 💬 Plat, geen mappen in mappen.** Een categorie is een eigen bak met een volgorde; een
  nummer kan in veel categorieën staan. Wat je met mappen zou doen ("dub › traag") is een slimme
  categorie (`#dub bpm:60-90`). **Advies:** zo laten; een boom maakt "waar staat hij?" onbeantwoordbaar
  en past niet op het scherm van de Maschine.
- [ ] **S11-2 💬 Een krat van de kaart overnemen = een kopie.** "→ categorie" in de kaart-tab neemt wat
  binnen is, in kratvolgorde; nog eens = wat erbij kwam. Hij volgt de krat niet vanzelf (de kaart is van
  buiten en verandert stil). Wil je ook een gekoppelde (die meeloopt met de krat), of is kopiëren goed?
- [ ] **S11-3 💬 De kolom links kost ruimte.** Met CATEGORIEËN/TAGS open vallen LUFS en racks uit de
  lijst, zodat de acht laadknoppen op 1440 passen; ☰ indeling = dicht en alles terug (onthouden). Goed,
  of liever een andere kolom eruit, of de kolom standaard dicht?
- [ ] **S11-4 💬 Taggen vanaf de iPad: alleen het nummer op een track.** De bouwsteen `tags` zet de
  acht snel-tags op het nummer van de focus-track (of een vaste track), via de schrijfweg van S8 als
  `mag` `track.*.tag.*` noemt. Een rij in de lijst taggen kan van de iPad niet: de bus kent geen
  nummer-id. Genoeg, of wil je een "gekozen nummer" dat de iPad zelf aanwijst (dan een nieuw veld op de
  schrijfweg)?
- [ ] **S11-5 💬 Welke acht snel-tags?** Je zet ze in de library (⋯ bij een tag, "snel 1–8"). Ze staan
  op geen knop; de sneltoetsen zijn alt+1…8 (en alt+T = het tagveld). Wil je ze op de APC of de
  Maschine, en waar?
- [ ] **S11-6 💬 De Maschine bij BROWSE.** Het voorbeeldstuk `indeling-voorbeeld` (noem het in je werkruimte, `"stukken"`) zet SHIFT + ◄ ►
  op de categorie en SHIFT + ENTER op "filter leeg". Overnemen in je mapping, of liever andere knoppen?
- [ ] **S11-7 💬 Wat is "energie" van een nummer?** Nu: de energie van de secties gewogen naar hun
  lengte (`energie:hoog` = ≥ 0,66). De set-klaarzetter (S9) rekent met de LUIDSTE sectie. Zelfde regel
  voor allebei? Welke?
- [ ] **S11-8 💬 Zoeken vindt ook tags.** "dub" in het zoekveld vindt ook nummers met #dub (naast titel
  en artiest). Handig, of liever alleen met `#`?
- [ ] **S11-9 💬 Wissen.** Een categorie of tag wissen kan alleen in het paneel op de Mac (tweede klik;
  gebruikt een slimme hem, dan nog een klik). Niet op de bus, niet van de iPad, zoals gevraagd. Een
  categorie bewaart geen "prullenbak": weg is weg (de backup van het uur ervoor heeft hem nog). Goed?

## HA. Handen: de controllers en de hub als drager (11 okt, docs/HANDEN.md, tak `visie/handen`)

In het ontwerp (mini-spoor extra-2 §7) heette dit blok H; hier HA, want blok H (24 sep) heeft al H1–H6.
HA1, HA2, HA3 en HA4/HA5 zijn dezelfde keuzes als VI13, VI16, VI17 en VI18 in de synthese.

- [ ] **HA1. Is proefavond 1 (10 okt) als DJ-proef op de APC doorgegaan?** 💬 Het enige log van die avond
  (19:09–19:17) is zeven minuten beeld zonder nummer; de speellijst heeft 0 vinkjes. **Zo ja:** wat ging
  fout, dan verwerken we dat eerst (VISIE §5.4) en kan de hub-middag gepland worden. **Zo nee:** avond 1
  opnieuw plannen vóór alles hieronder; de PR's blijven "[na de proefavond]".
- [ ] **HA2. De F0-proef van de hub als eigen hub-middag (overdag, 80 min, zonder muziek) vóór avond 2?** 🎛
  Alternatief: aan het begin van avond 2 (dan wordt avond 2 ≥ 4 uur, of de kern van avond 2 schuift naar
  avond 3). **Advies: hub-middag**, met 7a van het avondpakket in dezelfde minuut. In de Controlekamer
  staat hij als blok "Avond 2 · Hub-middag" (docs/HANDEN.md §2).
- [ ] **HA3. Kernset onderweg: K1 (APC alleen) nu, K2 (APC + Maschine via de hub) als doel?** 💬 Zie
  docs/HANDEN.md §3. **Advies: ja**; dat is ook wat standen en het avondpakket al als standaard hebben (`apc`).
- [ ] **HA4. `video.clips` op Shift + master-knop (naast zwart), eerst via learn?** 👀 Alternatief: een pad in
  de modus video. **Advies: Shift + master-knop**, pas in de standaard na de beeld-speelproef (VI7).
- [ ] **HA5. `sampler.N.drums` op de APC in de modus sampler, rij 4; op de Maschine DUPLICATE + pad?** 🎛
  Nooit SHIFT + pad (K10: dat is leegmaken). **Advies: ja, eerst learn**, standaard na het
  crossover-proefblok (CX4).
- [ ] **HA6. LPD8 mee onderweg?** 💬 In Varve doet hij drie dingen (K2 beeld, K4 puls, P1 zwart) en vraagt
  hij de hub. **Advies: alleen als av-kern in de set zit** (na 25 okt); O1 (K1) blijft open.
- [ ] **HA7. Xboard49 thuis?** 💬 Het avondpakket noemt hem geen reisspul; de Maschine-pads geven noten
  36–51. **Advies: thuis.**
- [ ] **HA8. `broadcast.toggle` nooit op een controller?** 💬 Uitzenden stap 6 kiest stand + iPhone.
  **Advies: ja, nooit op een pad.**
- [ ] **HA9. De handenkaart als A4-afdruk (HTML, ⌘P) én `docs/HANDEN.md`, of alleen het document?** 👀
  Beide bestaan nu (`node tools/handen/handenkaart.mjs --html`). **Advies: beide**; de afdruk ligt op
  avond 2 naast de controllers, zoals de spiekbrief van de hub bedoeld is.
- [ ] **HA10. De tien regels voor `AV-app-hub/docs/HARDWARE-AVOND.md` (docs/HANDEN.md §5) overnemen?** 💬
  Alleen tekst, in de hub-repo, met jouw OK. **Advies: ja.**
