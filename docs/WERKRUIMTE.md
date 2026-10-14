# De werkruimte: één ontwerp (13 okt 2026)

*Samengesteld uit de drie ontwerpen in deze map (`ontwerp-handen.md` als basis, met de beste
ideeën uit `ontwerp-veilig.md` en `ontwerp-schermen.md`) en de gaten die de beoordelaars vonden.
Gelezen: `studio/afmaken` (339310b), `origin/visie/handen`, de hub (`av-app-hub`), de vier
verkenningen in deze map en de worktrees van de andere workflow (`wt/controller-invoer`,
`wt/controller-uitvoer`). In de repo is niets gewijzigd.*

Clay, 13 oktober:
1. de knoppen logischer verdelen over de twee controllers;
2. meerdere schermen tegelijk gebruiken, met de iPad;
3. een track met precisie op de juiste plek zetten;
4. alle tracks tegelijk zien lopen (grid en tracks), om ze gelijk te laten lopen;
5. meer effecten, met alle combinatieknoppen die je kunt bedenken;
6. vrijheid over de UI en over welke knop wat doet: een werkruimte in plaats van een app, per
   onderdeel van de mix een andere. "Echt complete vrijheid."

---

## Deel A: wat er voor jou verandert (gewone taal)

### A1. Het idee in zes zinnen

1. **De APC is breed, de Maschine is diep.** Op de APC zie en bedien je alle acht tracks
   tegelijk (één kolom is één track, net als nu). De Maschine werkt aan één track, de
   focus-track, met het wiel, 16 pads en namen en getallen op twee schermen. Zo doen ze nooit
   twee keer hetzelfde.
2. **Een "deel" is waar je handen nu mee bezig zijn**: MIX · UITLIJN · FX · STEMS · SECTIES ·
   SPELEN · BEELD · LIBRARY. Je kiest een deel met één knop: F1–F8 op de Maschine, met de naam
   op het scherm erboven. Zonder Maschine volgt het deel vanzelf de grid-modus van de APC.
3. **Een deel zet alleen de juiste mapjes en panelen open, nooit een klank.** Faders, knoppen,
   effecten en wat er speelt blijven staan. Alles wat je voor een overgang nodig hebt (faders,
   crossfader, filter, EQ, play, sync, cue, tempo) zit in de APC-kern en verandert in geen enkel
   deel. Met twee handen op de APC kun je dus altijd mixen.
4. **Een werkruimte is een bestand (data)**: per deel welke mapjes open gaan op welk apparaat,
   welk paneel op welk scherm staat, en welke extra knoppen en combinaties erbij komen. Zonder
   werkruimte werkt VARVE precies zoals vandaag, tot op de laatste regel.
5. **Precisie en overzicht staan op alle drie de oppervlakken tegelijk.** Op het scherm zie je
   alle tracks in tellen van de maatgever. Op de APC worden de acht ringen fasemeters (draaien =
   duwen). Op de Maschine is het wiel een jog, en op het scherm ervan staat de fase van de
   focus-track.
6. **Alles wat nieuw is, komt eerst als voorbeeld.** De standaardmapping van de APC blijft
   ongemoeid tot je het op de hardware hebt geproefd. Pas daarna gaat er iets naar de standaard.

### A2. Wat in elk deel hetzelfde blijft (de kern)

| apparaat | blijft altijd zo, in elke werkruimte en elk deel |
|---|---|
| **APC40 mkII** | per kolom: fader · trackknop = filter · ● = PFL (⇧ cue) · S = sync (⇧ tap) · ▶ = play (⇧ op de maat) · A\|B = kant · Clip Stop = loop (⇧ weg) · Track Select = focus (⇧ tweede). Rechts: masterfader, crossfader, tempo-encoder (⇧ fijn), Nudge ± = bend (⇧ toon), Cue Level = koptelefoon (⇧ mix), Tap (⇧ keylock), Pan/Sends/User = loop in/out/reloop, Lock = quantize, Stop All = rem, Play, Record, master-knop = beeld zwart, ◀ ▶ = focus. Met de hub is Bank de hubtoets. **Nieuw: ⇧ + master-knop = THUIS** (zie A8). |
| **Maschine MK2** (alleen met de hub) | **F1–F8 = deel kiezen** (labels op het scherm erboven, het deel van nu omgekeerd) · **SHIFT + F1 = THUIS** · groep A–H = focus · CONTROL vasthouden = uitleg · SHIFT = fijn · STEP / SCENE / SAMPLING = padmodus binnen het deel · ◄ ► links boven = knoppagina · BROWSE = library open/dicht |
| **LPD8** | zoals nu via de hub: K2 helderheid, K4 beweging, P1 paniek (beeld zwart vasthouden). Een werkruimte pakt hier niets. |
| **Xboard49** | toetsen, pedaal en bend naar de speeltrack; knop 1–8 instrument, 9–16 fx, schuif = fader van de speeltrack |
| **Toetsenbord** | zoals nu, maar voortaan ook als data (`mappings/toetsen.json`), dus zelf aan te passen |

**Eén betekenis voor shift**, overal:

| waar | shift betekent |
|---|---|
| draaiknop, wiel, encoder | **fijn** |
| pad met inhoud (hotcue, sampler-pad) | **leegmaken** |
| drukpad (kill, stem, worp) | **vastzetten** |
| sectie | **als loop** (de uitzondering die al bestaat; nu ook op de Maschine) |

**Eén woord per vraag "welke track"**: `{focus}` = waar je aan werkt, `{speel}` = wat je
bespeelt (instrument), `{tweede}` = je vorige focus (was `{R}`), `{maatgever}` = wie de maat
geeft. Regel: wat SPEELT (Xboard, Maschine-pads in SPELEN) gaat naar `{speel}`, al het andere
naar `{focus}`.

### A3. Per deel: wat elke hand doet (werkruimte `twee-handen`)

Maschine-pads van onder (rij 1) naar boven (rij 4), van links naar rechts; pad 1 = linksonder.
**Vet** = nieuw.

| deel | APC grid (40 pads + scene) | APC device knobs | Maschine pads | Maschine draaiknoppen | Maschine wiel | Maschine schermen | scherm |
|---|---|---|---|---|---|---|---|
| **MIX** (F1) | hotcues per kolom (zoals nu); ▲ ▼: loops · klank · stems · fx · video | strip (zoals nu) | **r1** op de maat · sync · cue · **op de 1**. **r2** beatloop ¼ · ½ · 1 · loop weg. **r3** beatloop 2 · 4 · 8 · 16. **r4** hotcue 1–4 (⇧ wis) | strip van de focus | **jog** 1/16 tel (⇧ 1/64) | strip in eenheden · **fasescoop** van de focus + Δ ms | spiegel + **uitlijnstrook** (één maat, alle tracks) in het werkvak |
| **UITLIJN** (F2) | hotcues (zoals nu) | **acht fasemeters**: knop k = fase van track k (ring = fasemeter, midden = gelijk), draaien = duwen, ⇧ = fijn. Device ◀ ▶ = jog focus, On/Off = op de 1 | r1 zoals MIX. **r2** beatjump −1 · −¼ · +¼ · +1 tel. **r3** −1 ms · +1 ms · jog fijn − · + . **r4** duoklik · gridklik · PFL focus · loop weg | **1** fase · **2** fase fijn · **3** tempo fijn · **4** bend-sterkte · 5 koptelefoon mix · 6 koptelefoon volume · 7 vrij · 8 filter | jog (⇧ fijn) | **fasescoop** · getallen: grid Δ, muziek Δ, drift, maat ±N | **uitlijnweergave groot** |
| **FX** (F3) | **fx-matrix**: kolom = track, rij 1–4 = worp plek 1–4, rij 5 = echo-worp; ⇧ pad = vastzetten. Scene 1–4 = master-worp 1–4, scene 5 = loop weg (zoals nu) | rack van de focus | **r1–r2** worp plek 1–8 van de focus (⇧ vast). **r3** galm-worp · echo-worp · bypass · fx-mix vol. **r4** superknop 1–4 als drukknop | rack van de focus; ◄ ► = pagina **superknoppen 1–8** | rack kiezen | rack: namen + waarden · superknoppen | master-rij open; paneel superknoppen in het werkvak |
| **STEMS** (F4) | stems per kolom (zoals nu) | strip | **kolom = stem** (zang · drums · bas · overig). r1 weg (⇧ vast) · r2 echo-worp · r3 galm-worp · r4 cue | **pagina stems**: 1–4 niveau, 5–8 filter. ◄ ►: 1–4 echo, 5–8 galm | — | de vier stems · stemkill van alle tracks (8×4) | STEMS-rij open |
| **SECTIES** (F5) | loops per kolom (zoals nu) | strip | secties van de focus, 16 per blad, **⇧ = als loop** | strip | sectie volgende/vorige (valt in op de "1") | sectiekaart + 4×4 met namen | spiegel |
| **SPELEN** (F6) | patronen: pad = plek per track | inst als de focus een instrument heeft, anders strip | met instrument op de speeltrack: noten (zoals nu, buiten de bus). Zonder: sampler | instrument (zoals nu) | instrument kiezen, ENTER = zetten | instrument (zoals nu) | INSTRUMENT- en PATROON-rij open |
| **BEELD** (F7) | video (zoals nu) | beeld (Stroommachine-macro's) | **r1** pixel · sporen · korrel · spiegel (vasthouden). **r2** rgb · kleur · bevriezen · flits. **r3** regie 1–4. **r4** zwart vasthouden · zwart · regie vrij · vormlaag aan | **1–6** pixel · sporen · korrel · spiegel · rgb · kleur · **7** helderheid · **8** puls | mengvorm | de zes video-fx · zwart/bevroren/master | BEELD-rij open |
| **LIBRARY** (F8) | zoals het was | strip | **r3–r4 laad op track 1–8** (tweede druk over een spelende track). r1 pagina − · + · sorteer · krat | strip | door de lijst (zoals nu) | de lijst · het gekozen nummer: bpm, toon, past-bij | library open |

**Vasthoudknoppen op de Maschine** (een knop vasthouden = een tijdelijk mapje, ook over
apparaten heen): **VOLUME vast + draaiknop k = fader van track k** (zo heeft de Maschine toch
faders) · **TEMPO vast + wiel = tempo fijn** · **SWING vast + wiel = fase duwen** · **SOLO vast +
stem-pad = alleen deze stem** · **DUPLICATE vast + sampler-pad = naar de drumcomputer**. MUTE =
effect van de focus aan/uit. ALL, AUTO, GRID, NOTE REPEAT, PAD MODE, NAVIGATE en SELECT blijven
vrij voor jou.

**Wat er op de APC verandert:** geen enkele bestaande regel. Er komen twee mapjes bij op knoppen
die nu niets doen: **⇧ + On/Off = fx-matrix**, **⇧ + Lock = fasemeters (uitlijn)**. En
**⇧ + A\|B = thru** (de meest gebruikte muisklik zonder knop, 1.306 keer). In `twee-handen` lopen
sampler, secties, patronen en auto niet meer mee in ▲ ▼ (die doet de Maschine), maar ze blijven
bereikbaar met ⇧ + scene zoals nu.

### A4. Zonder Maschine (`apc-alleen`, onderweg)

- Alles van vandaag, plus de fx-matrix (⇧ On/Off), de fasemeters (⇧ Lock), ⇧ A|B = thru en THUIS.
- Het deel volgt de grid-modus: open je stems (⇧ scene 3), dan wordt het deel STEMS en gaat de
  STEMS-rij open. **Even vasthouden om te gluren wisselt het deel niet**, alleen echt openzetten.
- Valt de Maschine of de hub weg terwijl je in `twee-handen` zit, dan gaat VARVE vanzelf naar
  `apc-alleen`, met één melding. Nooit een half werkende indeling.

### A5. Op je schermen

| scherm | wat | hoe |
|---|---|---|
| **hoofd** (de mixer) | zoals nu, plus de **werk-balk** (acht delen in hun kleur, en wie het koos: "F3 · Maschine") en een **werkvak** boven de rijen (het paneel van het deel: de uitlijnstrook, de superknoppen, een eigen paneel) | per deel gaan de juiste rijen open; dichte rijen houden hun kop |
| **tweede Mac-scherm** | `werk.html?s=mac-2`: de vakken die je voor dat scherm koos (bijv. de uitlijnweergave groot), ze volgen het deel | een venster van de mixer (zoals de beamer): geen vertraging. VARVE onthoudt op welk fysiek scherm het hoort en zet het daar terug (één klik "open schermen") |
| **iPad** | dezelfde pagina, via Tailscale in Safari, schermvullend vanaf het beginscherm, scherm blijft wakker | eerst alleen kijken. Bedienen pas als jij het in de Controlekamer aanzet (vraag W1) |

**Op elk paneel zie je welke hand het bedient**: een badge "Maschine draaiknoppen" of "APC device
knobs", en het item licht 300 ms op als je de knop aanraakt. Het paneel **kaart** laat groot zien
wat elke knop NU doet (per apparaat, in het open deel); goud voor in het donker.

**Waarom de iPad geen timing doet:** tussen je vinger en de mixer zitten wifi en aanraking
(tientallen ms, onvoorspelbaar). Daarom staan er op de iPad alleen knoppen die dat niet erg
vinden: "op de maat" in plaats van play, secties (vallen in op de "1"), worpen, draaien, duwen
als afstand. Nooit bend of een vrije start.

### A6. Precisie (punt 3)

| wat | waar | hoeveel |
|---|---|---|
| **fase duwen** (`phase.offset`) | APC ⇧ Lock → device knob k (track k) · Maschine UITLIJN knop 1 · SWING + wiel · slepen in een baan van de uitlijnweergave | lineair: één tik op de APC = 1/127 tel = **3,8 ms** op 124 bpm; de ring toont ±½ tel |
| **fase fijn** (`phase.offset.fine`) | ⇧ + dezelfde knop · Maschine knop 2 | één tik = **0,48 ms**; de ring toont ±1/16 tel (~4 ms per lampje) |
| **jog** | Maschine-wiel (MIX, UITLIJN) · APC Device ◀ ▶ in uitlijn | 1/16 tel (⇧ 1/64). **Ook in pauze**, en dan verschuift het cuepunt niet mee |
| **±1 ms** | Maschine UITLIJN r3, scherm, toetsenbord (vrij te koppelen) | precies 1 ms |
| **beatjump ¼ ½ 1 tel** | Maschine UITLIJN r2 | vaste lengte, los van de beatjump-lengte van Bank ◀ ▶ |
| **op de 1** (`bar.align`) | Maschine r1 pad 4 · APC On/Off in uitlijn | springt −2…+2 tellen naar de "1" van de maatgever (sync zet de tel, niet de maat). Lampje = staat goed |
| **bend-sterkte** | Maschine UITLIJN knop 4 | 1–16% (nu vast 4%) |
| **duoklik** | Maschine UITLIJN r4 pad 1 | in de koptelefoon een hoge tik op de tel van de maatgever en een lage op de focus: je hoort de flam en duwt tot het één tik is |
| **eerlijker sync-lampje** | overal | "gelijk" pas onder 0,005 bpm (nu 0,05: tot ~24 ms drift per minuut terwijl hij "gelijk" zei) |

Snel draaien wordt samengevoegd: hooguit één sprong per 15 ms per track, en met keylock nooit
meer dan één geplande sprong tegelijk. Het grid verzetten blijft in de grid-modus (Shift +
Metronome): de track duwen en het grid verzetten zijn twee verschillende dingen.

### A7. Alle tracks tegelijk zien lopen (punt 4)

```
 maatgever ▸ 3 · 124,00          |1 . . . |2 . . . |1 . . . |2 . . .      ← tellen van de maatgever ZOALS JE HEM HOORT
 ─────────────────────────────────┼────────┼────────┼────────┼────────
 ■ 3  124,00  (maatgever)         ▌▌ ▌  ▌ ▌▌ ▌  ▌ ▌▌ ▌  ▌ ▌▌ ▌  ▌
 ■ 1  123,98  grid +0,4  muz +9,8  drift −0,8/16  maat 0   ▌▌ ▌  ▌ …     ← rood: het grid zegt gelijk, de kicks niet
 ■ 5  124,00  grid −0,1  muz −0,3  drift 0,0      maat +1  ▌▌ ▌  ▌ …     ← een tel naast de maat: pad "op de 1"
 □ 2  wacht op de maat (valt in over 1,3 maat)                          ← gestippeld: wat er straks valt
                                    ▲ speelkop (alleen deze streep beweegt)
```

- De as staat in **tellen van de maatgever**: één tel is overal even breed, welk tempo een track
  ook heeft. Dus wat gelijk loopt, staat recht onder elkaar.
- Per baan: de golfvorm, de eigen gridlijnen (de "1" voller), de gevonden tellen en klappen.
- Drie getallen per baan: **grid Δ** (wat het grid zegt), **muziek Δ** (wat de kicks zeggen),
  **drift** (ms per 16 tellen), plus **maat** (tellen naast de "1"). Groen < 3 ms, geel < 10 ms,
  rood daarboven. Zegt het grid "gelijk" maar de muziek niet, dan ligt het **grid** naast zijn
  muziek: dat moet je vastzetten, niet de track duwen (er staat een ⚠).
- Twee vormen: **pagina** (staat stil, slaat om per twee maten, alleen de speelkop beweegt;
  kost bijna niets) en **vouw** (per track één maat; elke tel als stip op zijn fase: gelijk = één
  smalle stapel, drift = een schuin spoor, flam = twee stapels). De vouw staat ook op het
  Maschine-scherm voor de focus-track.

### A8. Effecten en combinaties (punt 5)

| combinatie | wat je doet | waar |
|---|---|---|
| **worpen tegelijk** | pads vasthouden: elke pad is een worp (effectplek vol open zolang je drukt). Twee vingers = twee plekken, op twee tracks = twee racks. 2^n combinaties zonder akkoordlogica | APC fx-matrix (8 tracks × 4 plekken + echo-worp, master op de scènes), Maschine FX r1–r2 |
| **drukken, vastzetten of kort/lang voor elke knop** | elke regel kan "zolang je drukt" (`druk`), "aan/uit" (`latch`) of "kort = vast, lang = zolang je drukt" (`lang`) worden, naar een stand naar keuze. Bijv. echo-send vol zolang je drukt, filter naar 0,85 zolang je drukt | elke knop, via de mapping |
| **knop A vast + knop B = iets anders** | een vasthoudknop opent een tijdelijk mapje; dat werkt ook over apparaten heen (Maschine VOLUME vast + draaiknop = fader; SOLO vast + een APC-knop die jij in `houd.solo` leerde) | alle apparaten |
| **één knop beweegt veel** | superknop: één draai beweegt echo, galm, filter en beeld tegelijk, elk met zijn eigen bereik en curve (dezelfde rekenregel als een rack-knop) | Maschine FX-pagina super, iPad, elke knop die jij kiest |
| **morph tussen twee standen** | "leg vast A", "leg vast B": de superknop schuift tussen twee momentopnamen | superknoppaneel |
| **ander rack op echo- en galmbus** | rack wisselen op de bus, zoals op een track | FX-paneel |

Wat de engine zou raken (loop roll, beat repeat, reverse, effect per stem, extra bussen, vrije
routing) zit **niet** in dit ontwerp. Dat bouwen we alleen op een concreet voorbeeld van jou
(vraag W3).

Al vandaag mogelijk, zonder één regel code (proef E0): via koppelen `track.{focus}.fx.knob.K.hold`
op ⇧ + A|B 1–8, of de 28 vrije pads in grid-modus video op `video.fx.*.hold`. Dat beantwoordt
"worpen op pads of op knoppen?" voordat er iets gebouwd is.

### A9. Zelf instellen (zonder JSON)

- **Koppelen op elk apparaat**: APC, Maschine, Xboard en toetsenbord. De regel komt in het mapje
  dat open staat. Ook een **eigen leeg mapje per deel**: zet het open in jouw deel, koppel, en
  die knoppen doen alleen in dat deel iets anders.
- **Leg vast in dit deel**: richt je handen in (mapjes open, padmodus, pagina, rijen open) en
  druk twee keer op "leg vast in FX". Inrichten met je handen, niet in een formulier.
- **✎ inrichten** op elk scherm: wijs een knop aan (klik een knop op het scherm of beweeg een
  control) en zet hem op een paneel; de zoeker zet je meest gebruikte muishandelingen bovenaan.
  Je kunt een paneel toewijzen aan een groep knoppen ("dit paneel op de Maschine-draaiknoppen").
- **Eerst bekijken, dan aanzetten**: de kaarten (`apc.html`, `maschine.html`) tonen elke
  werkruimte en elk deel zonder ze te activeren (voorbeeldmodus). Er is een spiekbrief om te
  printen per apparaat en per deel.
- **Ongedaan maken**: "terug naar de vorige inrichting" (elke opslag bewaart de vorige versie).
- **Claude** kan het bestand ook schrijven; mixer en vensters zien het binnen 3 s.
- **THUIS** (⇧ + master-knop op de APC, SHIFT + F1 op de Maschine, en op de werk-balk): ben je
  verdwaald, dan zet één druk alles terug op de basis: deel MIX, de standaardmapjes, gluren en
  vasthouden los. Klank, faders en wat er speelt blijven zoals ze zijn.
- **Werkruimte wisselen** kan alleen vanaf het scherm of de Controlekamer, niet van een
  controller: zo krijg je nooit per ongeluk een andere indeling midden in een set. Een **deel**
  wissel je wel met je handen.

### A10. Eén kleurtaal

Elk deel heeft één kleur (een naam uit het APC-palet), en die kleur is overal dezelfde: het
lampje van de grid-modus op de APC (FX = violet als de fx-matrix, STEMS = zeegroen als de
stems-modus), het tabblad op de werk-balk, de kop van mac-2 en de iPad, de pads van de Maschine
(die gebruiken hetzelfde palet als de APC). Een deel met een APC-grid-modus moet de kleur van die
modus hebben; de controle waarschuwt als het niet klopt.

| deel | kleur | waar je hem ziet op de APC |
|---|---|---|
| MIX | wit | hotcues (zoals nu) |
| UITLIJN | groen | ⇧ Lock brandt groen in uitlijn |
| FX | violet | fx-matrix |
| STEMS | zeegroen | stems-modus (zoals nu) |
| SECTIES | hemelsblauw | secties-modus (zoals nu) |
| SPELEN | oranje | patronen-modus (zoals nu) |
| BEELD | geel | video-modus |
| LIBRARY | grijs | — |

### A11. Leren zonder te verdwalen

- **Hooguit acht delen** (F1–F8, één knop per deel). Meer kan niet in v1; minder mag.
- **Per proefavond hooguit twaalf nieuwe plekken.** De controle telt hoeveel knoppen anders
  doen dan bij de vorige proef en zet het getal op de werk-balk ("⚠ 14 nieuw"). Boven twaalf is
  het een waarschuwing, geen blokkade.
- De werk-balk en het Maschine-scherm zeggen altijd in welk deel je bent en wie het koos.
- Proefavonden met een meetbaar oordeel staan in de speellijst van de Controlekamer (§D3).

### A12. Wat nooit gebeurt

- Een deelwissel zet nooit een klank (getest: 0 andere acties).
- Een werkruimte haalt nooit iets weg: de kern niet, een kiesknop niet, een rij niet (alleen
  dichtklappen). Elke functie blijft bereikbaar.
- Een extra regel uit een werkruimte wint nooit van een regel die jij koppelde.
- De iPad bedient niets tot jij het aanzet. Opnemen, het log, mappings opslaan en werkruimtes
  wisselen kunnen nooit vanaf de iPad, ook niet als een werkruimte dat zou willen.
- Engine en audiopad veranderen niet (op twee kleine, gemeten uitzonderingen na: de bend-sterkte
  als getal en de duoklik als tweede controleklik; §C3).

---

## Deel B: het datamodel

### B1. Vier lagen, van onder naar boven

```
mappings/<apparaat>.json         de STANDAARD per apparaat (git, ongewijzigd in dit ontwerp)
  + mappings/stukken/*.json      STUKKEN: extra regels op vrije plekken en in NIEUWE mapjes (git)
  + regels van de werkruimte     idem, maar alleen in die werkruimte (fragment `werk:<naam>`)
  + jouw verschil per apparaat   wat jij koppelde (server: `mapping` = APC zoals nu, `mapping:<apparaat>` nieuw)
  = de mapping die per apparaat geldt
  + "delen"                      per deel: welke mapjes open per apparaat, welk paneel op welk scherm, welke rijen
```

- Een stuk en de werkruimteregels gaan via `Mapping.vervangFragment(bron, doc)`: ze vullen
  alleen aan (zoals `voegToe` nu, de vormlagen). **Jouw regel op dezelfde sleutel wint altijd.**
- **In v1 mag een stuk geen sleutel gebruiken die in de standaard bezet is**: alleen vrije
  plekken of nieuwe mapjes. Nagerekend: de nieuwe APC-regels in dit ontwerp vallen allemaal op
  vrije sleutels (`note:0:63#shift`, `note:0:62#shift`, `note:0..7:66#shift`, `note:0:80#shift`,
  `note:0:58#shift` en nieuwe mapjes `device.uitlijn`, `grid.fx`). Een test leest `apc40mk2.json` en
  `maschine-mk2.json` en eist 0 botsingen. Daardoor is de standaard bit voor bit dezelfde.
- Mapjes zijn gedeeld per groep: wat jij in `houd.solo` koppelt, werkt in elke werkruimte die
  `houd.solo` kent.

### B2. Het werkruimtebestand (schema 1)

`werkruimtes/<naam>.json` (data in de Bureaublad-map, niet in git; `VARVE_WERKRUIMTES` voor
tests), `.versies/<naam>/` bij elke opslag. De voorbeelden staan in
`tools/werkruimtes/voorbeelden/` (git). Een eigen bestand gaat vóór een voorbeeld met dezelfde
naam. Opslaan alleen met `versie` (hash van de inhoud): 409 bij een botsing, nooit stil
overschrijven, zoals plannen en patronen.

```json
{
  "schema": 1,
  "naam": "twee-handen",
  "titel": "APC breed · Maschine diep",
  "uitleg": "APC = alle tracks. Maschine = de focus-track: precisie, secties, sampler, spelen, bladeren. F1–F8 kiezen het deel.",
  "vereist": ["apc40mk2", "maschine-mk2"],
  "terugval": "apc-alleen",
  "stukken": ["basis", "uitlijn", "fx-matrix", "mix-extra", "maschine-delen", "maschine-houd"],

  "deel": { "start": "mix", "kiezen": "expliciet", "onthoud": true },

  "mapjes": {
    "nieuw": {
      "device.mijndub": { "naam": "mijn dub (leeg, zelf koppelen)", "kiesknop": { "in": "note:0:58", "shift": true } }
    },
    "volgorde": { "apc40mk2.grid": ["hotcues", "loops", "klank", "stems", "fx", "video"] }
  },

  "delen": {
    "mix": {
      "label": "MIX", "kleur": "wit",
      "apc40mk2":     { "grid": "hotcues", "device": "strip" },
      "maschine-mk2": { "pads": "transport", "pagina": "strip", "wiel": "jog", "scherm": ["strip", "fasescoop"] },
      "schermen": { "hoofd": { "werkvak": "uitlijn-strook", "rijen": [] },
                    "ipad":  { "vakken": ["uitlijn", "paneel:mijn-mix"] } }
    },
    "uitlijn": {
      "label": "UITLIJN", "kleur": "groen",
      "apc40mk2":     { "device": "uitlijn" },
      "maschine-mk2": { "pads": "uitlijn", "pagina": "uitlijn", "wiel": "jog", "scherm": ["fasescoop", "getallen"] },
      "schermen": { "hoofd": { "werkvak": "uitlijn" }, "mac-2": { "vakken": ["uitlijn"] }, "ipad": { "vakken": ["uitlijn"] } }
    },
    "fx": {
      "label": "FX", "kleur": "violet",
      "apc40mk2":     { "grid": "fx", "device": "rack" },
      "maschine-mk2": { "pads": "worpen", "pagina": "rack", "wiel": "rack", "scherm": ["rack", "super"] },
      "schermen": { "hoofd": { "werkvak": "paneel:super", "rijen": ["master"] }, "ipad": { "vakken": ["paneel:super", "kaart"] } }
    },
    "stems": {
      "label": "STEMS", "kleur": "zeegroen",
      "apc40mk2":     { "grid": "stems" },
      "maschine-mk2": { "pads": "stems", "pagina": "stems", "scherm": ["stems"] },
      "schermen": { "hoofd": { "rijen": ["stems"] } }
    },
    "secties": {
      "label": "SECTIES", "kleur": "hemelsblauw",
      "apc40mk2":     { "grid": "loops" },
      "maschine-mk2": { "pads": "secties", "pagina": "strip", "wiel": "sectie", "scherm": ["secties"] }
    },
    "spelen": {
      "label": "SPELEN", "kleur": "oranje",
      "apc40mk2":     { "grid": "patronen", "device": { "als": "focus.instrument", "dan": "inst", "anders": "strip" } },
      "maschine-mk2": { "pads": { "als": "speel.instrument", "dan": "spelen", "anders": "sampler" }, "pagina": "instrument", "wiel": "instrument" },
      "schermen": { "hoofd": { "rijen": ["instrument", "patronen"] } }
    },
    "beeld": {
      "label": "BEELD", "kleur": "geel",
      "apc40mk2":     { "grid": "video", "device": "beeld" },
      "maschine-mk2": { "pads": "beeld", "pagina": "beeld", "wiel": "mengvorm", "scherm": ["beeld"] },
      "schermen": { "hoofd": { "rijen": ["beeld"] }, "ipad": { "vakken": ["paneel:video-fx"] } }
    },
    "bladeren": {
      "label": "LIBRARY", "kleur": "grijs",
      "maschine-mk2": { "pads": "laden", "pagina": "strip", "wiel": "bladeren", "scherm": ["blader"] },
      "schermen": { "hoofd": { "onderpaneel": "library" }, "ipad": { "vakken": ["kaart"] } }
    }
  },

  "volgt": [],

  "regels": {
    "apc40mk2": [
      { "in": "note:0:58", "laag": "device.mijndub", "action": "track.{focus}.send.a", "mode": "druk", "naar": 1 }
    ]
  },

  "superknoppen": [
    { "nr": 1, "naam": "DUB", "links": [
      { "action": "track.{focus}.send.a", "in": [0, 0.3], "from": 0,   "to": 1 },
      { "action": "send.a.knob.2",        "in": [0.3, 1], "from": 0.5, "to": 0.9 },
      { "action": "track.{focus}.filter", "in": [0, 1],   "from": 0.5, "to": 0.72, "curve": "s" },
      { "action": "video.fx.trails",      "in": [0.5, 1], "from": 0,   "to": 0.6 } ] }
  ],

  "bussen": { "a": "Dub-echo", "b": null },

  "panelen": {
    "mijn-mix": { "titel": "MIX", "doel": "focus", "items": [
      { "soort": "knop", "action": "track.{focus}.play.quant", "label": "OP DE MAAT" },
      { "soort": "knop", "action": "track.{focus}.bar.align",  "label": "OP DE 1" },
      { "soort": "draai", "action": "track.{focus}.phase.offset" },
      { "soort": "draai", "action": "super.1" } ] },
    "video-fx": { "titel": "BEELD", "items": [
      { "soort": "rij", "herhaal": ["pixel", "trails", "grain", "mirror", "rgb", "color"],
        "item": { "soort": "knop", "action": "video.fx.{k}.hold" } } ] }
  },

  "schermen": {
    "hoofd": { "soort": "mixer" },
    "mac-2": { "soort": "venster", "plek": "onthouden" },
    "ipad":  { "soort": "ipad",
               "mag":   ["track.*.section.*", "track.*.play.quant", "track.*.phase.offset*", "super.*", "video.fx.*", "werk.deel.*", "track.*.stem.*"],
               "nooit": ["track.*.play", "track.*.cue", "track.*.bend.*"] }
  }
}
```

### B3. Regels voor het bestand (`normaliseerWerkruimte`, puur, zonder imports)

| veld | regel |
|---|---|
| `schema` | 1, anders weigeren (400) |
| `naam` | `^[a-z0-9_-]{1,60}$`, niet `actief`/`terug` (zoals standen); `titel` ≤ 60, `uitleg` ≤ 300 |
| `vereist` / `terugval` | apparaten uit een vaste lijst (`apc40mk2`, `maschine-mk2`, `xboard49`, `lpd8`, `hub`); ontbreekt er één, dan geldt `terugval` met één melding; een terugval die zelf iets ontbreekt = `standaard` |
| `stukken` | namen in `mappings/stukken/`; onbekend = waarschuwing, overslaan |
| `deel.kiezen` | `expliciet` (F-knoppen, werk-balk, iPad) of `volgt` (ook de regels in `volgt`) |
| `delen` | **hooguit 8**; naam `^[a-z]{2,16}$`; `label` ≤ 8 tekens; `kleur` = naam uit het APC-palet. Per apparaat alleen groepen die dat apparaat kent; onbekend mapje = waarschuwing, overslaan, nooit raden |
| condities | `{ als, dan, anders }` met `als` uit een vaste witte lijst: `focus.instrument`, `focus.nummer`, `focus.stems`, `focus.leeg`, `speel.instrument`, `hub`, `apparaat.<id>`. Geen expressies |
| `volgt` | `[{ apparaat, mapje, deel }]`; telt alleen een VAST open mapje (gluren niet); een wissel die uit `volgt` komt zet de mapjes van dát apparaat niet opnieuw (geen lus) |
| `mapjes.nieuw` | groep `device`, `grid` of `houd` (+ Maschine `pads`, `pagina`); botsing met een bestaand mapje = fout; `kiesknop` = de knop die hem opent (het model maakt er een regel `layer.<groep>.<laag>` van, alleen op een vrije sleutel), of null (alleen via een deel); een mapje zonder kiesknop moet in minstens één deel staan |
| `mapjes.volgorde` | alleen bestaande mapjes; wat eruit valt MOET een kiesknop hebben (anders fout: alles blijft bereikbaar) |
| `regels.<apparaat>` | zelfde vorm als mappingregels (+ de modi van B5); alleen op vrije sleutels of in nieuwe/eigen mapjes; worden fragment `werk:<naam>` |
| `superknoppen` | ≤ 16; `links[]` met de velden van een rack-macro (`in`, `from`, `to`, `curve`, `steps`), opgelost met `resolveLink` uit `rack.js`; ≤ 32 links; geen `super.*` in de eigen links |
| `bussen` | racknaam (sjabloon of bewaard) of null |
| `panelen` | `items[].soort` uit `draai`, `knop`, `schuif`, `lamp`, `xy`, `rij` (met `herhaal`), `tekst`; action moet bestaan na `resolveTarget` met een voorbeeld-focus (`metaOf`), anders grijs + één melding |
| `schermen.<s>.mag/nooit` | patronen met `*` per segment; `nooit` wint; bovenop altijd een vaste lijst die geen werkruimte kan openzetten: `record.*`, `log.*`, `mapping.*`, `werk.kies`, `werk.opslaan`, `werk.terug`, `library.*`, `*.load*` |
| verboden velden | `uit`, `verberg`, `acties`, `pijlers`, `start`, `opname`, knopstanden, posities, adressen: fout (de geest van `VERBODEN_DELEN`) |
| kern | geen regel (stuk, werkruimte) op een kernsleutel; geen `houd`-regel of `modifier` op `play`, `cue`, `play.quant`, `hotcue.*`, `load.*`, `layer.*` |
| kleur | heeft een deel een APC-grid-mapje, dan moet zijn kleur die van het mapje zijn (waarschuwing) |
| nieuw | `telNieuwePlekken(vorige, deze)` = het aantal sleutels dat anders doet; > 12 = waarschuwing |

### B4. Een stuk (`mappings/stukken/<naam>.json`)

Eén idee over alle apparaten heen. Zelfde velden als het regel-/mapjesdeel van een werkruimte,
zonder `delen` en `schermen`. Elk stuk heeft één eigenaar-spoor.

```json
{ "schema": 1, "stuk": "uitlijn", "titel": "Acht fasemeters op de device knobs",
  "mapjes": { "nieuw": { "apc40mk2.device.uitlijn": { "naam": "uitlijn (fase per track · ring = fasemeter · ⇧ fijn)",
                                                      "kiesknop": { "in": "note:0:63", "shift": true }, "kleur": "groen" } } },
  "regels": { "apc40mk2": [
    { "in": "note:0:63", "shift": true, "action": "layer.device.uitlijn", "mode": "trigger" },
    { "in": "cc:0:16", "laag": "device.uitlijn", "action": "track.1.phase.offset", "mode": "endless", "takeover": 1 },
    { "in": "cc:0:16", "laag": "device.uitlijn", "shift": true, "action": "track.1.phase.offset.fine", "mode": "endless", "takeover": 1 },
    { "in": "note:0:58", "laag": "device.uitlijn", "action": "track.{focus}.jog.back", "mode": "trigger" },
    { "in": "note:0:59", "laag": "device.uitlijn", "action": "track.{focus}.jog.fwd",  "mode": "trigger" },
    { "in": "note:0:62", "laag": "device.uitlijn", "action": "track.{focus}.bar.align", "mode": "trigger" } ] } }
```

(cc:0:17–23 gaan zo door tot track 8. De pan-ring komt vanzelf: `phase.offset` heeft
`bipolar: true` in zijn meta, en `feedback.js` kiest dan al de pan-ring. `takeover: 1` omdat de
read met de drift meeschuift.)

De stukken van v1 en hun eigenaar:

| stuk | wat | eigenaar |
|---|---|---|
| `basis` | ⇧ master-knop = `werk.thuis` (APC) | S3 |
| `uitlijn` | mapje `device.uitlijn` (⇧ Lock), 16 knopregels + jog + op de 1 | S1 |
| `fx-matrix` | mapje `grid.fx` (⇧ On/Off), 40 pads (`.hold`, ⇧ = latch), scene 1–4 master-worp | S4 |
| `mix-extra` | ⇧ A\|B = `track.k.xfade.thru` (8 regels) | S4 |
| `maschine-delen` | F1–F8 = `werk.deel.1–8`, SHIFT + F1 = thuis, pagina's uitlijn/stems/beeld/super, padmodi transport/uitlijn/worpen/stems/beeld/laden, wielregels | S6 |
| `maschine-houd` | VOLUME, TEMPO, SWING, SOLO, DUPLICATE als houd-mapjes; MUTE = bypass | S6 |

### B5. Nieuwe regelvelden in een mapping

| veld | voorbeeld | wat het doet |
|---|---|---|
| `mode: "druk"` + `naar` | `{ "action": "track.{focus}.send.a", "mode": "druk", "naar": 1 }` | elke value-action als drukknop: indrukken zet `naar` (direct), loslaten zet terug wat er stond. Beide over de bus, dus allebei in het log |
| `mode: "latch"` + `naar` | idem | druk = `naar`, nog eens = de stand van ervoor |
| `lang` | `"lang": 400` (bij `druk`/`latch`) | kort = latch, lang = zolang je drukt (dezelfde 400 ms als gluren) |
| `mode: "stappen"` | `{ "in": "cc:0:24", "mode": "stappen", "action": "track.{focus}.jog" }` | een relatieve encoder roept per klik `<action>.fwd` of `<action>.back` aan (triggers, regel 2), hooguit 8 per bericht |
| `"laag": "houd.<naam>"` | `{ "in": "cc:0:16", "laag": "houd.volume", "action": "track.1.fader", "mode": "relative-2c" }` | geldt zolang de houd-knop vastzit (`layer.houd.volume`: indrukken = open, loslaten = dicht als het nog de zijne is). Houd-mapjes zijn gedeeld over alle apparaten |
| `als` | `"als": "focus.instrument"` | regel alleen met deze conditie (witte lijst van B3) |
| variabelen | `{focus}`, `{speel}`, `{tweede}` (= `{R}`), `{maatgever}`, `{plek}`, `{k}` in `herhaal` | `{maatgever}` = `syncMaster()`; `{L}`/`{R}` blijven als alias |

Bewust **niet** in v1: het `met`-veld van het handen-ontwerp (een regel die geldt zolang een
andere control vastzit). Houd-mapjes doen hetzelfde met het mechanisme van gluren dat er al is.
Het volle `met` komt pas als de houd-mapjes op de hardware tekortschieten.

### B6. Hoe het zich verhoudt tot mapping, stand en hub-set

| | mapping (verschil) | stuk | werkruimte | stand (opstelling) | hub-set |
|---|---|---|---|---|---|
| zegt | welke knop welke action doet | extra regels en mapjes | WAAR alles zit, per deel | met welke beginwaarden een avond start | welke apps, focus, snapshot |
| bestand | server `mapping[:<apparaat>]` | `mappings/stukken/*.json` | `werkruimtes/*.json` | `standen/*.json` | hub `sets/*.json` |
| wisselen | koppelen, meteen | met de werkruimte | live, zonder herladen; deel tientallen keren per set | bij activeren | hub |
| verbergt | — | — | nooit | nooit (`VERBODEN_DELEN`) | — |
| verwijst | — | — | stukken, panelen | **een werkruimte** (nieuw deel `werkruimte: { naam }`) | — |

Het deel dat nu open staat is sessietoestand. `werk.*` gaat over de bus (dus in het log), maar
terugspelen slaat het over, net als `layer.*`.

---

## Deel C: architectuur en regels

### C1. Waar de code woont

```
src/werk/        model.js (puur), werkruimte.js (runtime: deel, volgt, onthoud, thuis, terugval),
                 kleuren.js (deel → paletnaam), apparaten.js (adapters per apparaat: zetMapjes)
src/uitlijn/     reken.js (puur: venster in tellen, banen, getallen, sleutel), teken.js (pagina, vouw),
                 venster.js (uitlijn.html)
src/paneel/      protocol.js (puur), verbinding.js (opener of SSE), paneel.js, vrij.js, kaart.js
src/control/     acties-precisie.js, acties-combi.js, acties-werk.js (eigen define-blokken),
                 houd.js (puur register: welke houd-mapjes open, per apparaat), superknop.js (puur)
src/ui/aanhakers/<spoor>.js   per spoor één opzetfunctie (app.js roept ze in vaste volgorde)
src/ui/beschrijf/<spoor>.js   per spoor de uitleg van zijn actions (apc-beschrijf.js vraagt ze eerst)
src/ui/css/<spoor>.css        per spoor zijn stijl (index.html linkt ze)
server/routes/<spoor>.js      per spoor zijn routes en zijn witte-lijstregels
mappings/stukken/*.json       de stukken
tools/werkruimtes/voorbeelden/standaard.json, apc-alleen.json, twee-handen.json
werk.html, uitlijn.html, spiekbrief.html
```

### C2. Een deelwissel, stap voor stap

1. `werk.deel.fx` komt binnen (F3 op de Maschine, de werk-balk, de iPad).
2. `werkruimte.js` rekent het deel uit (condities, `onthoud`), en roept per apparaat de adapter
   aan: APC `lagen.zet('grid', 'fx')`, Maschine `zetMapjes({ pads, pagina, wiel, scherm })`.
   Dat gaat via de `layer.*`-actions, dus over de bus.
3. Het scherm: rijen open/dicht via het rijenregister, werkvak, onderpaneel; mac-2 en de iPad
   krijgen `{ t: 'werkruimte', naam, deel }`.
4. Eén `change`. LED's en lampjes volgen bij de volgende tik (33 ms), want de LED-laag leest de
   mapping (`actieveRegels()`).
5. Een knop die tijdens de wissel vastzat, laat los naar de action van het indrukken (bestaat al);
   gluren en houd-mapjes worden afgebroken.

Toets: een wissel geeft 0 invokes buiten `layer.*`/`werk.*` (bus-spion).

### C3. De drie regels, het audiopad en VISIE §5

| | hoe |
|---|---|
| **Regel 1** | Alles nieuw staat buiten `src/engine/`. `regels.test.mjs` krijgt `src/werk/`, `src/uitlijn/`, `src/paneel/` erbij (de engine importeert ze niet; de pure modules importeren geen ui/control/server en kennen geen DOM). De engine krijgt alleen: een alleen-lezen getter `Deck.tijdlijn()`, het getal `deck.bendSterkte` (was de constante `BEND`), een optionele lengte bij `beatjump`, en een tweede `GridKlik` voor de duoklik (een paar tikken per seconde op de hoofdthread, niet in het audiopad; de controleklik bestaat al). |
| **Regel 2** | `phase.offset(.fine)`, `super.K`, `bend.amount` en `druk`/`naar` werken op 0..1. Jog, ±1 ms, beatjump-vast, `bar.align` en `stappen` zijn triggers. Ms, tellen en procent zitten nooit in een mapping. Geen "delta"-soort op de bus. |
| **Regel 3** | Jog en duwen = `nudge`/`seek` met `doorlopend` op de audioklok. De uitlijnweergave en de iPad rekenen uit segmenten `{T,P,R}` + `hoorbaar()`/klokverschil. De samenvoegtimer (15 ms) en de LED-tik (33 ms) zeggen alleen WANNEER. Superknoppen glijden via de bestaande `.glide`-actions, geen eigen teller. |
| **Audiopad** | Geen spoor verandert `renderBlok`, de worklet of de segmentvorm (zeven velden). Gouden hash en 0 GC (`renderblok.test.mjs`) zijn acceptatie van elk spoor dat in `src/engine/` komt. |
| **Speellatentie** | De pads in SPELEN blijven buiten de bus (`noten.js`). Bench van de andere workflow (`tools/bench/invoer.mjs`): hooguit +0,1 ms mediaan. |
| **Eén tabblad** | Alleen het tabblad met de Web Lock (met `?hub=`: met de hubverbinding) zendt naar de server en voert iPad-invoer uit. `werk.html`/`uitlijn.html` openen nooit MIDI, audio of een Web Lock (importboomtest, zoals `regels-companion`). |
| **Hub** | Bank blijft de hubtoets. Geen LPD8-rol (de K1-dip 0,80 → 0,43). Het manifest verandert niet per deel. |
| **§5.1 pijlers** | MIX/UITLIJN/FX/STEMS/SECTIES = dj'en; SPELEN = produceren; superknoppen, morph en stukken = programmeren; de werkruimte = zelf instellen; BEELD = de drager beeld. Een deel zet nooit iets uit (crossover heel). |
| **§5.2 draagbaar** | Niets erbij in de tas. `apc-alleen` is volwaardig, de iPad optioneel, SSE zonder dependency. |
| **§5.3 zonder code** | Stukken, mapjes, delen, panelen, superknoppen, houd-mapjes, toetsenbord: data. Koppelen op elk apparaat. Code blijft nodig voor nieuwe action-soorten, paneelsoorten en Maschine-schermindelingen (data kiest uit een vaste set). |
| **§5.4 geproefd** | De standaard verandert niet. Per spoor een proefpunt; de Maschine-ijkproef is een poort; naar main pas na de proef (§D3). |

### C4. iPad en tweede scherm: het protocol

Eén paneelpagina (`werk.html`), twee transporten (`src/paneel/verbinding.js`): `window.opener`
als die er is en dezelfde oorsprong heeft (mac-2: dezelfde thread, 0 ms), anders de server.

| richting | route | bericht | wanneer |
|---|---|---|---|
| mixer → server | `POST /api/paneel/van-mixer` (alleen `vanDezeMac` en alleen het tabblad dat `statusVanMij()` is) | `stand` (alle reads die panelen gebruiken), `verschil`, `tijdlijn` (deck, segId, T, P, R, loop, rem, speelt, wacht, gridVersie), `klok` (ctxT, perfT via `getOutputTimestamp()`), `maatgever`, `werkruimte` (naam, deel) | gebundeld per 20 ms; verschillen ≤ 10/s per id; tijdlijn bij elke nieuwe `segId`; klok 1×/s |
| server → paneel | `GET /api/paneel/live?s=ipad` (SSE, `node:http`) | dezelfde berichten; bij verbinden eerst de volledige stand | push |
| paneel → server | `GET /api/paneel/ping` | `{ t }` (klokverschil: mediaan van 8 rondjes) | bij verbinden, daarna 1×/10 s |
| paneel → server (pas na W1) | `POST /api/paneel/invoke` | `{ id, v, druk: 'aan'\|'los'\|null, seq }` | per gebaar; waarden per beeld samengevoegd |
| server → mixer (pas na W1) | `GET /api/paneel/naar-mixer` (SSE, alleen `vanDezeMac`) | het invoke met `scherm` en `seq` | push |

- **Regel 3 over het netwerk:** posities gaan niet per beeld over wifi. De iPad rekent zelf
  `positieIn(seg, t)` met de formule uit `stream-kern.js`, op zijn klok plus het klokverschil, en
  trekt de uitgangsvertraging af. Peaks, grid, tellen haalt de iPad zelf (`peaks.bin` staat al op
  de witte lijst).
- **SSE + POST, geen WebSocket** (gekozen): SSE is twintig regels aan de serverkant, zonder
  dependency. Op loopback gemeten: relais 0,13 ms mediaan, POST 0,98 ms mediaan. Een iPad is
  toch niet voor timing. Schiet het tekort, dan een WebSocket in een volgende versie, met
  dezelfde berichten.
- **Veiligheid** (de eerste schrijfweg van buiten de Mac): standaard **404** tot jij het in de
  Controlekamer aanzet (tegel); alleen via de tailnet of localhost (`VARVE_HOSTS`, `tailscale
  serve`, nooit funnel); Origin precies de eigen pagina; **koppelen met een code** van zes
  cijfers (60 s geldig) → token van 32 bytes in een `HttpOnly; Secure; SameSite=Strict`-cookie,
  gehasht bewaard, per apparaat een naam, intrekken in de Controlekamer; de **mixer** voert alleen
  uit wat in de panelen van dat scherm in het actieve deel staat én in `mag` en niet in `nooit`
  of de vaste lijst; destructief houdt zijn tweede druk; **wegvallen = alles loslaten** (geen
  SSE of ping binnen 1,5 s); rem 120 invokes/s per scherm (429); `seq` tegen dubbel; het log
  krijgt `bron: 'ipad'` in de vierde kolom.
- **De iPad als podiumapparaat:** `werk.webmanifest` (`display: standalone`) en
  `apple-mobile-web-app-capable`, zodat hij schermvullend vanaf het beginscherm draait; Screen
  Wake Lock (opnieuw aanvragen bij `visibilitychange`); `touch-action: none` op bedieningen en
  `manipulation` op de pagina (geen zoom of scroll bij tikken); pointer events per `pointerId`
  (meerdere vingers = meerdere worpen, elk laat los naar wat hij indrukte); herverbinden bij
  `visibilitychange`/`online` met de laatste stand; een grote rode balk "geen verbinding". Tip in
  de docs: Begeleide toegang (Guided Access) aan tijdens een set.
- **Tweede Mac-scherm:** met de Window Management API (`getScreenDetails`, toestemming
  "vensterbeheer") onthoudt VARVE per scherm-naam op welk fysiek scherm het hoort (op het label,
  in localStorage) en opent één klik "open schermen" alle vensters op hun plek. Zonder
  toestemming: gewoon `window.open` en zelf slepen. Het beamervenster (`video.html`) houdt zijn
  scherm: staat een werk-venster op hetzelfde scherm, dan een waarschuwing.
- **Noodweg:** de hub-cockpit (een nagemaakte APC op de iPad via de hub) bestaat al; die blijft
  de reserve als het paneel niet werkt.

### C5. De volgorde van berichten over twee apparaten

Een houd-knop op de Maschine en een doelknop op de APC komen met de hub allebei over dezelfde
WebSocket van de hub (de APC als lease, de Maschine als speelapparaat), dus in volgorde van
aankomst bij de hub. Zonder hub is er geen Maschine. Regels:
- Een doelknop kiest zijn regel bij het **indrukken**. Komt de houd-knop een paar ms later, dan
  krijgt de doelknop zijn gewone regel; loslaten gaat naar wat hij indrukte. Niets met
  terugwerkende kracht.
- Daarom geen houd-regels op tijdkritische acties (B3, kern).
- Gemeten in S6: 1000 keer houd-knop en doelknop met 5 ms ertussen via de echte hub; de volgorde
  klopt in ≥ 99,9%; de scheefheid p99 wordt vastgelegd.

### C6. Lasten op de hoofdthread (totaalbudget)

Alles samen (mixer met 8 tracks, renderloop, LED-laag, werkvak met uitlijnstrook, venster mac-2
met uitlijn groot, zender naar de server, één SSE-kijker) mag de mixer **hooguit 2 ms per beeld
extra** kosten tegen de nulmeting, **geen lange taak boven 50 ms**, de LED-tik **p99 niet meer dan
+10%**, en in rust **≤ 3 Mpx/s** getekend. Gemeten headless in S8 (`tools/headless/werk-alles.mjs`);
op de M1 met Demucs erbij als proefpunt: de stems-snelheid zakt niet meer dan 10%.

---

## Deel D: het bouwplan

### D1. Golven en afhankelijkheden

```
golf 0 (extern)  de andere workflow (afmaken/controller-invoer + -uitvoer: lag op de controllers en
                 het beatgrid) is samengevoegd in studio/afmaken. De integrator zet studio/integratie
                 gelijk aan studio/afmaken. Pas dan begint golf 1.
golf 1           S0 aanhaakpunten (klein, alleen)
golf 2           S1 precisie · S2 uitlijnweergave · S3 werkruimte-kern · S4 combinaties en effecten ·
                 S5 mapping per apparaat, koppelen overal, toetsenbord als data (+ Maschine-ijkproef)
  poort M        Clay doet de Maschine-ijkproef (S5 levert hem) op de hub; uitkomst in S6
golf 3           S6 Maschine-delen en de kaarten · S7 schermen en de iPad (kijken)
golf 4           S8 inrichten, iPad bedienen (alleen na W1), totaalmeting, proef, docs, CLAUDE.md
na golf 4        proefavonden A–D; daarna pas naar main (PR)
```

Elk spoor: eigen tak `werk/<spoor>` in een eigen git-worktree, vanaf `studio/integratie` zoals
die na de vorige golf is (golf 1 vanaf `studio/afmaken`). Na een golf voegt de integrator alle
sporen samen in `studio/integratie` en draait `node test/alles.mjs`. Gemeenschappelijke toets voor
elk spoor: **met de werkruimte `standaard` (geen werkruimte) is elke bestaande test en headless
tool groen zonder verandering in de verwachtingen.** Dat is de toets dat er niets stilletjes
verandert.

### D2. Botsplekken per golf (wie mag wat)

| bestand | golf 1 | golf 2 | golf 3 | golf 4 |
|---|---|---|---|---|
| `src/ui/app.js` | S0 | niemand | niemand | S8 (alleen als nodig) |
| `index.html` | S0 | niemand | niemand | S8 |
| `styles.css` | niemand (S0 linkt `src/ui/css/*.css`) | niemand | niemand | niemand |
| `src/control/actions.js` | S0 | S1 (alleen de sync-drempel) | niemand | niemand |
| `server/index.js` | S0 | niemand (routes in `server/routes/<spoor>.js`) | niemand | niemand |
| `mappings/apc40mk2.json`, `maschine-mk2.json` | niemand | niemand | niemand | niemand (pas na de proef) |
| `CLAUDE.md`, `docs/VRAGEN.md` | niemand | niemand | niemand | S8 |
| `src/control/mapping.js`, `lagen.js` | S0 | S4 | niemand | niemand |
| `src/ui/apc-beschrijf.js` | S0 | niemand (elk `src/ui/beschrijf/<spoor>.js`) | niemand | niemand |
| `src/control/terugspelen.js`, `handelingen.js`, `src/auto/automaat.js` | S0 | niemand (meta-vlaggen) | niemand | niemand |
| `src/engine/deck.js` | S0 (alleen `tijdlijn()`) | S1 | niemand | niemand |
| `src/engine/engine.js`, `grid-klik.js` | niemand | S1 | niemand | niemand |
| `src/standen/stand-model.js`, `server/standen.js`, `.gitignore` | niemand | S3 | niemand | niemand |
| `src/ui/mapping-opslag.js`, `midi-learn.js`, `keyboard.js`, `midi-opzet.js`, `speelapparaten.js`, `instrument-paneel.js`, `mapping-panel.js`, `learn-mode.js` | niemand | S5 | niemand | S8 (alleen `learn-mode.js`) |
| `src/control/maschine.js` | niemand | S5 (één regel: Mapping van buiten aannemen) | S6 | niemand |
| `src/control/maschine-scherm.js`, `src/ui/maschine-kaart*.js`, `src/ui/apc-kaart.js` | niemand | niemand | S6 | niemand |
| `src/ui/vensters.js`, `renderloop.js`, `controls.js` | niemand | niemand | S7 | niemand |
| `src/controle/*.js` | niemand | niemand | niemand | S8 |
| eigen stubs `src/ui/aanhakers/<spoor>.js`, `src/ui/beschrijf/<spoor>.js`, `src/ui/css/<spoor>.css`, `server/routes/<spoor>.js` | S0 maakt ze leeg | elk spoor alleen de zijne | idem | idem |

### D3. Proef (VISIE §5.4)

| avond | na | wat | oordeel |
|---|---|---|---|
| E0 | nu al | worpen via koppelen (`fx.knob.K.hold` op ⇧ A\|B, `video.fx.*.hold` op vrije pads) | pads of knoppen voor worpen? |
| poort M | golf 2 | **Maschine-ijkproef** op de hub: elke knop, het wiel, de draaiknoppen, F1–F8, schermen, labels boven F1–F8 | kloppen de nummers van het profiel; is het wiel relatief ±1; sturen SOLO/MUTE/VOLUME noot aan en uit; staan F1–F8 onder de schermlabels? Pas dan wordt `twee-handen` activeerbaar |
| A | golf 2 | ⇧ Lock (fasemeters), uitlijnweergave op het tweede scherm, duoklik | is de ring leesbaar als fasemeter? hoor je een duw van 1 ms? klopt "muziek Δ" met je oor? |
| B | golf 2 | delen wisselen (werk-balk, `apc-alleen` die de grid-modus volgt), fx-matrix, dub-worp, superknop | onthoud je wat er open staat? is de dub-worp wat je wilde? hoeveel nieuwe plekken was te veel? |
| C (hub) | golf 3 | `twee-handen`: F1–F8, houd-knoppen, wiel als jog, de kaarten | voelt APC breed / Maschine diep logisch? kom je met THUIS altijd terug? |
| D | golf 3–4 | iPad naast de Mac (kijken; bedienen na W1) | loopt hij in de pas met wat je hoort? valt hij weg bij auto-lock? |

Naar `main` met een PR pas na avond A–C. Wat goed bevalt, gaat dáárna van de stukken naar de
standaard (+ `node tools/mapping/eerder.mjs`).

### D4. De sporen

De volledige, zelfstandige opdrachten staan hieronder. Elke opdracht begint met hetzelfde blok
"Voor elk spoor".

**Voor elk spoor (lees dit eerst):**
- Repo: `/home/user/youtube-mixer` (VARVE). Lees `CLAUDE.md` helemaal (de drie regels, Bekende
  grenzen, Conventies), `docs/VISIE.md` §5 en dit ontwerp:
  `/tmp/claude-0/-home-user-youtube-mixer/6ff8dd87-3094-5cbd-b3bb-7f262960b5d2/scratchpad/werkruimte/ONTWERP.md`.
- Voorwaarde: `studio/afmaken` bevat de samenvoeging van `afmaken/controller-invoer` en
  `afmaken/controller-uitvoer` (`git log --oneline studio/afmaken | grep -i controller`). Zo niet:
  stop en meld het. Begin golf 1 vanaf `studio/afmaken`, latere golven vanaf `studio/integratie`
  met de vorige golf erin.
- Werk in een eigen git-worktree (buiten iCloud), tak `werk/<spoor>`. Wijzig alleen de bestanden
  die je opdracht noemt. Een bestand dat niet in je lijst staat en dat je toch nodig hebt: stop en
  meld het, niet stilletjes aanpassen.
- Nederlands in comments, commits en docs; identifiers in het Engels; 2 spaties, single quotes,
  semicolons. Geen dependencies, geen bundler. `git add` per pad, nooit `-A`; nooit een bestand
  met " 2" in de naam. Volg de attributieregels van je sessie.
- Tests: `node test/alles.mjs` groen; geen bestaande verwachting veranderen. Data-mappen
  (`werkruimtes/`, `patronen/`, `plannen/`, `proef/`, `media/`) in tests en headless tools via
  hun env-var naar een tijdelijke map (`VARVE_WERKRUIMTES`, `VARVE_PATRONEN`, `VARVE_PLANNEN`,
  `VARVE_TESTSERVER=1`, …). De hub in headless proeven altijd met `opname: false`.
- Schrijf je documentatie in `docs/werkruimte/<spoor>.md` (wat gebouwd is, regels voor wie
  eraan komt, wat niet getest is, aannames). `CLAUDE.md` en `docs/VRAGEN.md` raakt alleen S8.
- Open NOOIT een extra VARVE-tabblad tegen een aangesloten APC.

---

#### S0 — Aanhaakpunten en fragment-mechaniek (golf 1)

**Doel:** de gedeelde bestanden één keer openzetten, zodat alle latere sporen alleen hun eigen
bestanden aanraken. Geen gedrag verandert.

**Bouw:**
1. **UI-aanhakers.** `src/ui/aanhakers.js` met `startAanhakers(ctx)`: laadt in vaste volgorde
   `['precisie', 'uitlijn', 'werk', 'combi', 'apparaten', 'maschine', 'schermen', 'inrichten']`
   de modules `src/ui/aanhakers/<naam>.js` (elk `export default async function opzet(ctx) {}`,
   leeg) met `await import()`, en vangt een fout per aanhaker af (melding via `ctx.meld`, de
   rest gaat door). `ctx` = `{ engine, mapping, lagen, midi, staat, meld, invoke, define, read,
   metaOf, laden, videoMixer, renderloop, rijen, maschine }`, waarbij `maschine` een Promise is die
   de Maschine-instantie geeft als `speelapparaten.js` hem maakte (met `?hub=`), anders null. Eén
   blok onderaan `src/ui/app.js` roept `startAanhakers` aan na alle bestaande opzet.
2. **Uitleg.** `src/ui/beschrijf/index.js` importeert statisch de lege
   `src/ui/beschrijf/{precisie,combi,werk,maschine,schermen}.js` (elk
   `export default (action) => null`); `beschrijf()` in `apc-beschrijf.js` vraagt die eerst en
   valt anders terug op zijn eigen logica. `apc.html` laadt geen bus (blijft zo).
3. **Meta-vlaggen voor het log en de auto-DJ.** In `terugspelen.js`: overslaan als `OVERSLAAN`
   matcht **of** `metaOf(id)?.log === 'overslaan'`. In `handelingen.js`: niet in de beginstand
   als `NIET_IN_WAARDEN` matcht **of** `meta.beginstand === false`. In `src/auto/automaat.js`:
   overnemen als `OVERNEEM` matcht **of** `meta.overneem === true`. Een `meta.alleenScherm: true`
   betekent: een mappingregel met deze action wordt bij het laden geweigerd (met een melding).
4. **Mapjes en fragmenten.** In `lagen.js`: `voegMapjeToe(groep, laag, { naam, kiesknop, kleur,
   opAanvraag })`, `haalMapjeWeg(groep, laag)`, `zetVolgorde(groep, lijst | null)` (null = de
   standaardvolgorde). `voegVormMapjeToe()` wordt een aanroep van `voegMapjeToe` (zelfde
   uitkomst). In `actions.js`: `herbindLagen()` maakt de `layer.*`-actions opnieuw na een
   wijziging (idempotent; `bindLagen` gebruikt hem). In `mapping.js`:
   `vervangFragment(bron, doc)` (alle regels van die bron weg, dan opnieuw, met de semantiek van
   `voegToe`: alleen aanvullen) en `haalWeg(bron)`. `leesRegels` negeert een veld `mapjes` in het
   document (het wordt door de aanroeper geregistreerd).
5. **Rijenregister.** `src/ui/rijen.js`: `registreerRij(naam, { zet(open), isOpen() })`,
   `rij(naam)`, `rijNamen()`. Eén regel in elk van `auto-paneel.js`, `beeld-paneel.js`,
   `instrument-paneel.js`, `klankschaal-paneel.js`, `koptelefoon-paneel.js`, `master-paneel.js`,
   `stems-paneel.js`, `patronen-paneel.js` die zich aanmeldt met zijn bestaande `zet`.
6. **Engine-getter.** `Deck.tijdlijn()`: alleen lezen, `{ segId, gridVersie, T, P, R, loop, rem,
   speelt, wacht, remt, rate }` uit wat de bron al heeft (`bron.seg`, `_segId`). Geen nieuwe
   timer, niets in het audiopad.
7. **Server.** `server/routes/index.js` laadt in vaste volgorde de lege
   `server/routes/{werkruimtes,mapping-apparaat,paneel}.js` (elk
   `export default { routes: [], mag: [] }`, waarbij `routes` = `[{ methode, pad (regex),
   handler(req, res, ctx) }]`). `server/index.js` vraagt die routes vóór de 404 en voegt `mag`
   toe aan `MAG`. Zet ook `werk.html`, `uitlijn.html`, `spiekbrief.html` en `werk.webmanifest`
   op de witte lijst (een ontbrekend bestand blijft gewoon 404).
8. **HTML en CSS.** In `index.html`: een leeg `<div id="werk-balk" hidden></div>` direct ná de
   bovenbalk (niet erin) en een leeg `<section id="werkvak" hidden></section>` direct vóór
   `#rijen` (niet erin), en `<link rel="stylesheet">` naar de lege `src/ui/css/{werk,uitlijn,
   panelen}.css`. `styles.css` niet aanraken.
9. **Regels-test.** `test/regels.test.mjs`: de engine importeert niets uit `src/werk/`,
   `src/uitlijn/`, `src/paneel/`; `src/werk/model.js`, `src/uitlijn/reken.js`,
   `src/paneel/protocol.js` en `src/control/superknop.js` (zodra ze bestaan) kennen geen DOM en
   importeren niets uit `ui/`, `control/` (behalve pure modules), `server/`.

**Bestanden (alleen deze):** `src/ui/app.js`, `src/ui/aanhakers.js` + `src/ui/aanhakers/*.js`
(nieuw, leeg), `src/ui/apc-beschrijf.js`, `src/ui/beschrijf/*.js` (nieuw), `src/control/terugspelen.js`,
`src/control/handelingen.js`, `src/auto/automaat.js`, `src/control/lagen.js`,
`src/control/actions.js` (alleen `herbindLagen`), `src/control/mapping.js`, `src/ui/rijen.js`
(nieuw) + de acht paneelbestanden (één regel elk), `src/engine/deck.js` (alleen `tijdlijn()`),
`server/index.js`, `server/routes/*.js` (nieuw), `index.html`, `src/ui/css/*.css` (nieuw, leeg),
`test/regels.test.mjs`, `test/aanhaakpunten.test.mjs` (nieuw), `docs/werkruimte/S0.md`.

**Acceptatie:**
- `node test/alles.mjs` groen, zonder dat een verwachting verandert.
- `test/aanhaakpunten.test.mjs`: `voegVormMapjeToe()` geeft `deepEqual` dezelfde `GROEPEN` als
  vóór; `voegMapjeToe` + `herbindLagen` maakt `layer.device.x`, `haalMapjeWeg` haalt hem weg;
  `zetVolgorde(null)` = de oude volgorde; `vervangFragment` twee keer = één keer de regels, een
  eigen regel op dezelfde sleutel wint, `haalWeg` laat 0 regels van die bron over; een action met
  `meta.log = 'overslaan'` wordt niet teruggespeeld, met `beginstand: false` staat hij niet in de
  beginstand, met `overneem: true` neemt de auto-DJ over; een regel met een `alleenScherm`-action
  wordt geweigerd; `Deck.tijdlijn()` geeft na seek, loop en rem dezelfde positie als `positieIn`
  (± 1e-9) en een hogere `segId`.
- Headless: `tools/headless/rijen.mjs`, `kijk.mjs`, `bovenbalk`-test en `hub.mjs` (als de hub er
  is) groen zonder aanpassing; de mixer start zonder consolefout met acht lege aanhakers; een
  aanhaker die gooit geeft één melding en de rest start.
- `renderblok.test.mjs`: gouden hash en 0 GC ongewijzigd.

**Gebouwd (14 okt, tak `werk/S0`, `docs/werkruimte/S0.md`).** Wat anders werd dan hierboven:
- `Deck.tijdlijn()` geeft ook `vorig` (het segment dat tot een geplande sprong met keylock nog
  speelt; zonder klopt `positieIn` dan niet). Op een BufferBron (de reserve) `null`.
- `ctx.renderloop` is `{ stap(naam, fn) }`: een eigen requestAnimationFrame in `aanhakers.js`,
  naast `renderloop.js` (dat is van S7), die alleen loopt als er een stap is.
- De acht panelen: twee regels elk (de import van `rijen.js` en de aanmelding).
- `alleenScherm` werkt in een Mapping met `metaOf`; app.js zet die op de APC-, Maschine- en
  Xboard-mapping, en na de aanhakers loopt `weigerAlleenScherm()` alles nog eens langs (hun
  actions bestaan pas na het laden). `set()` geeft dan null.
- `voegMapjeToe` alleen in een bestaande groep met mapjes (`device`, `grid`). Een NIEUWE groep
  (`houd` uit B5, Maschine `pads`/`pagina`) kan nog niet: de stand per groep rekent de
  constructor van Lagen uit. Dat hoort bij S4 (lagen.js in golf 2) of S6.
- `meta.overneem` zonder track in de id (bv. `super.1`) telt als "raakt elke overgang", zoals de
  crossfader.
- terugspelen.js en automaat.js lezen de meta via `metaOf` uit actions.js (als standaard; een
  test kan een eigen meegeven: `maakPlan(regels, { metaOf })`, `new Automaat({ metaOf })`).

---

#### S1 — Precisie (golf 2)

**Doel:** een track met precisie op zijn plek zetten (punt 3), met nieuwe actions op de bus en
het stuk `uitlijn` voor de APC.

**Bouw:** in `src/control/acties-precisie.js` (`bindPrecisie(engine)`, aangeroepen uit
`src/ui/aanhakers/precisie.js`), per track N:
- `track.N.phase.offset` (value, meta `bipolar: true`, `beginstand: false`, `overneem: true`):
  read = 0,5 + f, met f = fase t.o.v. de maatgever als fractie van een tel in [−½, ½), lineair;
  null zonder grid, zonder maatgever, of als N de maatgever is. invoke(v) = duwen met
  `deck.nudge((v − read) × tellengte)` (fasebehoudend, binnen de loop; met keylock gepland).
- `track.N.phase.offset.fine`: idem met bereik ±1/16 tel (read = 0,5 + f·8, geklemd).
- `track.N.jog.back/.fwd` en `.jog.fine.back/.fwd` (trigger, `overneem: true`): 1/16 tel (fijn
  1/64) via `beatLengthAt(positie)`. Speelt hij: `seek(…, { doorlopend: true, binnenLoop: true })`.
  Stil of in pauze: een gewone seek, en het cuepunt blijft staan. Zonder grid: 5 ms (fijn 1 ms).
- `track.N.nudge.fine.back/.fwd` (trigger): precies 1 ms.
- `track.N.beatjump.quarter|half|beat.back|fwd` (trigger): beatjump van ¼, ½ of 1 tel met
  dezelfde weigerregels en meldingen als de bestaande beatjump; daarvoor krijgt
  `Deck.beatjump(richting, { tellen })` een optionele lengte (zonder = de bestaande lengte, dus
  `SPRONG_TELLEN` en ⇧ Bank blijven precies zoals ze zijn).
- `track.N.bar.align` (trigger, `overneem: true`): beatjump van −2…+2 tellen naar de dichtstbijzijnde
  "1" van de maatgever (`barPhase`/`telInMaat`, nooit `beat % 4`); weigeren met een melding
  zonder twee zekere grids. read = 1 als de "1" binnen 0,01 tel op die van de maatgever valt,
  0 anders, null zonder.
- `track.N.bend.amount` (value): 1–16% (read = (s − 0,01)/0,15); `deck.bendSterkte` wordt een
  veld (standaard 0,04 = de oude `BEND`, die als export blijft bestaan).
- **Samenvoegen** in de control-laag: duwen en jog tellen hun Δ per deck op en voeren hooguit
  één `nudge`/`seek` per 15 ms uit (een timer die alleen WANNEER zegt; de positie komt van het
  deck). Met keylock nooit meer dan één gepland segment tegelijk (wacht tot het vorige ingaat).
- **Duoklik** `track.N.duoklik` (trigger, schakelaar; meta `log: 'overslaan'`, `beginstand: false`):
  een tweede `GridKlik` in de engine op de maatgever, met lagere tonen (`grid-klik.js` krijgt de
  frequenties als optie), naar dezelfde uitgang als de controleklik (de koptelefoon, anders de
  master). De bestaande controleklik blijft precies gelijk.
- **Sync-lampje:** de drempel in de sync-read in `actions.js` van 0,05 naar 0,005 bpm.
- Uitleg van elke nieuwe action in `src/ui/beschrijf/precisie.js`.
- Het stuk `mappings/stukken/uitlijn.json` (B4): ⇧ Lock = `layer.device.uitlijn` (mapje
  geregistreerd met `voegMapjeToe` vanuit de aanhaker zolang S3 er nog niet is; daarna laadt S3
  het als stuk), cc:0:16–23 = `track.1–8.phase.offset` (⇧ `.fine`), `endless`, `takeover: 1`,
  Device ◀ ▶ = jog, On/Off = `bar.align`.

**Bestanden:** `src/control/acties-precisie.js` (nieuw), `src/ui/aanhakers/precisie.js`,
`src/ui/beschrijf/precisie.js`, `src/engine/deck.js` (bendSterkte, beatjump-lengte),
`src/engine/engine.js` + `src/engine/grid-klik.js` (duoklik), `src/control/actions.js` (alleen de
sync-drempel), `mappings/stukken/uitlijn.json` (nieuw), `test/precisie.test.mjs` (nieuw),
`tools/headless/precisie.mjs` (nieuw), `docs/werkruimte/S1.md`.

**Acceptatie:**
- In engine.test-stijl (Web Audio-mock, nep-klok), twee gesyncte decks op 124 bpm: `phase.offset`
  leest 0,500 ± 0,001; invoke(read + 1/127) verschuift `engine.faseVerschil` met tel/127 = 3,81
  ± 0,1 ms; `.fine` met tel/1016 ± 0,05 ms; read null zonder maatgever en op de maatgever.
- 50 invokes in 100 ms geven ≤ 7 seeks en dezelfde eindfase (± 0,1 ms) als één invoke met de
  som; met keylock nooit twee geplande segmenten tegelijk.
- jog in pauze: 1/16 tel = 30,24 ± 0,01 ms, track blijft stil, cuepunt ongewijzigd; tijdens
  spelen fasebehoudend en binnen de loop; zonder grid 5 ms.
- `bar.align` brengt `telInMaat` gelijk aan die van de maatgever, ook over een stukgrens met
  maat-anker; geweigerd met melding zonder zeker grid.
- `beatjump.quarter` verschuift ¼ tel, weigert zoals beatjump; de bestaande beatjump-tests
  ongewijzigd groen.
- Duoklik: tikken op de tellen van de maatgever op `ctxTimeOf` (± 1 sample in OfflineAudioContext),
  de controleklik ongewijzigd.
- Sync-lampje: 0,01 bpm verschil = 0, 0,004 = 1.
- Log: duwen speelt terug als dezelfde duw; `phase.offset` niet in de beginstand; de auto-DJ
  neemt over bij duwen, jog en `bar.align`.
- Het stuk: 0 botsingen met `apc40mk2.json`; elke action bestaat (`metaOf`) en heeft een uitleg.
- Headless (`tools/headless/precisie.mjs`, echte Chrome, demotrack op twee decks, 7 ms naast):
  na 15 tikken fijn < 1 ms naast; geen sprong > 0,05 in de uitvoer bovenop de muziek bij 50
  tikken per seconde.
- `renderblok.test.mjs`: gouden hash en 0 GC ongewijzigd.

**Gebouwd (14 okt, tak `werk/S1`, `docs/werkruimte/S1.md`).** Wat anders werd dan hierboven:
- `Deck.beatjump` had al een optionele lengte (een getal); er kwam `{ tellen }` bij. Zonder lengte
  blijft het `sprongTellen`.
- `phase.offset` duwt de afstand op een CIRKEL (`omtrek(v − read)`): over de rand van de ring gaat
  hij rond, en dezelfde v twee keer duwt maar één keer. De read telt mee wat nog niet ingegaan is.
- De Duwer voert de eerste tik pas na 15 ms uit (anders 8 sprongen in 100 ms in plaats van ≤ 7).
- Vaste beatjumps en op de 1 gaan ook door de Duwer (`sprong`): met keylock wachten ze op een
  geplande sprong die nog onderweg is. Ze en ±1 ms hebben ook `overneem: true`.
- 5 ms en 1 ms zijn wat je hoort (× rate). De maatgever is `syncMaster()`: speelt er niets, dan de
  eerste andere track met een grid (zoals sync); read null alleen op de maatgever zelf of zonder.
- Duoklik: hoog = de controleklik op de track zelf (met zijn cue), laag = de maatgever (zoals de
  opdracht hierboven; A6 zei het omgekeerd). Een ander deck controleren zet hem uit.
- De headless meting rendert offline (OfflineAudioContext) met per deck een eigen kanaal, en meet
  de sprong als de grootste tweede afgeleide tegen dezelfde muziek zonder duwen.
- Het stuk `uitlijn.json` is een VOORBEELD (`"voorbeeld": true`, afspraak met Clay 14 okt: hij maakt
  de knoppenverdeling zelf); hoe hij het invult: `docs/verslagen/2026-10-14/werk-S1.md` "Zelf invullen".
- Review ronde 1: de fasemeters hebben GEEN `takeover: 1` (de standaard 0,02 van endless): met 1 gaf
  de eerste tik na een jog of sync een sprong van ~30 ms als de APC zijn knopstand gelijkzet met de
  ring. Het stuk heeft een 21e regel: ⇧ Lock in de grid-modus (`edit.aan`) blijft slot.
- Terugspelen: `nummer: true` in de meta (terugspelen.js `nummerNodig`, een aanhaker naast
  NUMMER_NODIG, zoals `log: 'overslaan'` naast OVERSLAAN): duwen, jog, op de 1 en de vaste beatjumps
  op een track zonder zijn nummer van toen worden overgeslagen.

---

#### S2 — De uitlijnweergave (golf 2)

**Doel:** alle tracks tegelijk zien lopen in tellen van de maatgever (punt 4), als bouwsteen voor
elk scherm.

**Bouw:**
- `src/uitlijn/reken.js` (puur): het venster in tellen van de maatgever zoals je hem hoort
  (`beatAt(hoorbaar(M))`, 1 of 2 maten, pagina die omslaat); per baan de tracktijd op x:
  `t = nu + (x − x_nu) × hoorbare tellengte van M`, `pos = positieIn(tijdlijn, t) − V × rate`
  (V uit `uitgangsVertraging`, `tijdlijn` uit `Deck.tijdlijn()`); gridlijnen van de track op zijn
  eigen tellen ("1" voller); gevonden tellen (`deck.tellen`) en klappen (`deck.onsets`); de
  getallen **grid Δ** (`engine.faseVerschil`), **muziek Δ** (`faseTussen`: mediaan van de laatste
  ~8 gehoorde tellen van i tegen de dichtstbijzijnde van M; met alleen klappen "grof ±15 ms"),
  **drift** (ms per 16 tellen), **maat** (tellen naast de "1"); ⚠ als `afwijkingBij` zegt dat het
  grid naast zijn muziek ligt; kleur groen < 3, geel < 10, rood. Plus de **vouw**: per track de
  fasen van de gehoorde tellen t.o.v. M, voor een stapelweergave. Plus de **sleutel** van tekenen:
  (deck, segId, gridVersie, pagina, breedte, zoom). Geen `JSON.stringify(grid)` per beeld.
  Werkt met een object `{ decks, maatgever, V, nu }` zodat dezelfde code op de iPad draait
  (segmenten van buiten, eigen klok).
- `src/uitlijn/teken.js`: per track een voorgetekende strook in tracktijd (in tegels), per keer
  tekenen `drawImage` met schaal tel × rate; speelkop als CSS-transform; tekent alleen als de
  sleutel verandert. Vorm `pagina` (standaard), `vouw`, en `strook` (één maat, klein).
  Een baan slepen = `track.N.phase.offset` invoke met de versleepte fractie (als S1 er is; anders
  niets).
- `uitlijn.html` + `src/uitlijn/venster.js`: los venster via `window.opener.varveUitlijn` (zoals
  beamer en plan); geen AudioContext, geen MIDI, geen Web Lock. `src/ui/aanhakers/uitlijn.js`
  zet `window.varveUitlijn` en een knop "uitlijn" in het werkvak (S3 vult het werkvak later per
  deel; tot dan opent de knop het venster).
- Stijl in `src/ui/css/uitlijn.css`.

**Bestanden:** `src/uitlijn/reken.js`, `src/uitlijn/teken.js`, `src/uitlijn/venster.js`,
`uitlijn.html` (nieuw), `src/ui/aanhakers/uitlijn.js`, `src/ui/css/uitlijn.css`,
`test/uitlijn.test.mjs` (nieuw), `tools/headless/uitlijn.mjs` (nieuw), `docs/werkruimte/S2.md`.
Kijk vóór je `src/engine/tellen.js` nodig hebt of `faseTussen` er al is; zet hem anders in
`src/uitlijn/reken.js` (niet in de engine).

**Acceptatie:**
- Puur: twee tracks gesynct op 124 en 128,3 bpm → gridlijnen op x gelijk binnen 0,5 px op
  1200 px; een fase van +10 ms → grid Δ 10,0 ± 0,1 ms en een baan die 10 ms verschoven is;
  drift 0,5% → ms/16 tellen exact; maat +1 herkend; een loop die rondgaat geeft geen sprong;
  een wachtende track staat op de "1" waar hij invalt; muziek Δ op synthetische tellen met 12 ms
  flam = 12 ± 1 ms, ook als de grids gelijk staan; vouw met 12 ms flam = twee stapels.
- De sleutel verandert alleen bij een nieuwe segId, gridVersie, pagina of breedte: 60 beelden
  zonder verandering = 0 keer tekenen.
- Headless (echte Chrome, 8 tracks): pagina-vorm in rust ≤ 3 Mpx/s getekend (teller op
  `drawImage`/`fillRect`), rekenwerk ≤ 0,5 ms per beeld, met `uitlijn.html` open verliest het
  hoofdvenster < 1 beeld per seconde; de getallen in het DOM kloppen met `engine.faseVerschil`
  binnen 0,5 ms; `uitlijn.html` maakt geen AudioContext en vraagt geen MIDI.
- `regels.test.mjs`: `src/uitlijn/reken.js` zonder DOM en zonder imports uit ui/control/server.

**Gebouwd (14 okt, tak `werk/S2`, `docs/werkruimte/S2.md`).** Wat anders werd dan hierboven:
- De knop "uitlijn" staat achteraan de transportrij van de focus-track (de bovenbalk had in rust
  nog 4 px over op 1440 px); tot S3 het werkvak vult opent hij het losse venster.
- Een werkruimte plaatst de weergave met een VAKNAAM (data): `uitlijn` (pagina), `uitlijn-strook`,
  `uitlijn-vouw`, of `uitlijn:<vorm>:<maten>` (bv. `uitlijn:pagina:1`). `vakVorm(naam)` in
  `teken.js`, `varveUitlijn.toonVak(el, naam)` en `varveUitlijn.open(naam)`; `uitlijn.html?vorm=&maten=`.
- `faseTussen` staat in `reken.js` (`src/engine/tellen.js` had hem niet); de engine is niet geraakt.
- Een track die STIL staat wordt getekend alsof hij nu zou starten, vastgemaakt aan de speelkop:
  zo zie je ook in pauze waar zijn tellen vallen.

---

#### S3 — De werkruimte-kern (golf 2)

**Doel:** werkruimtes als data: model, opslag, delen wisselen, THUIS, terugval, werk-balk,
voorbeelden (punt 1 en 6).

**Bouw:**
- `src/werk/model.js` (puur, geen imports): `normaliseerWerkruimte` met alle regels van B3
  (fouten en waarschuwingen apart), `samenstellen(standaarden, stukken, werkruimte)` → per
  apparaat de fragmenten, nieuwe mapjes en volgorde; condities; de bereikbaarheidstoets (elk
  mapje een kiesknop of in een deel; geen kern weg); `telNieuwePlekken(vorige, deze)`;
  kleurcontrole.
- `src/werk/werkruimte.js` (runtime): de actieve werkruimte, het actieve deel, `onthoud`
  (sessietoestand), `volgt` (alleen vast open mapjes, geen lus), `vereist`/`terugval` (luistert
  naar poorten en de hub; één melding), toepassen via adapters per apparaat
  (`src/werk/apparaten.js`: `registreerApparaat(id, { zetMapjes(def), mapjes(), aanwezig() })`;
  de APC-adapter zit hier, de Maschine-adapter levert S6), rijen via `ctx.rijen`, werkvak,
  onderpaneel, en een event `'werkruimte'` voor schermen.
- Stukken en werkruimteregels laden met `mapping.vervangFragment('stuk:<naam>' / 'werk:<naam>')`
  en nieuwe mapjes met `lagen.voegMapjeToe`; een wissel van werkruimte haalt de vorige weg.
- `src/control/acties-werk.js`: `werk.deel.<naam>`, `werk.deel.1–8` (read = 1 als actief, 0,
  null als het deel niet bestaat), `werk.deel.next/prev`, `werk.thuis` (deel = start,
  standaardmapjes per apparaat, gluren en houd los; 0 andere invokes), `werk.vastleggen` (de open
  mapjes per apparaat en de open rijen in het actieve deel, opslaan met versie; tweede druk
  binnen 3 s), `werk.kies` (meta `alleenScherm: true`). Alle met meta `log: 'overslaan'`.
- `src/werk/kleuren.js`: deel → paletnaam (A10).
- `src/ui/werk-balk.js` in `#werk-balk`: de delen als tabs in hun kleur, wie het koos ("F3 ·
  Maschine"), "⚠ N nieuw", THUIS, werkruimte kiezen (alleen hier), "leg vast in <deel>". Toont
  zich alleen met een werkruimte actief; met `standaard` blijft hij `hidden`. Stijl in
  `src/ui/css/werk.css`.
- `server/werkruimtes.js` + `server/routes/werkruimtes.js`: `GET /api/werkruimtes` (lijst eigen +
  voorbeelden, met `versie`), `GET/PUT /api/werkruimtes/<naam>` met versie/409 en de huidige
  inhoud bij 409, atomisch schrijven, `.versies/<naam>/`, `GET /api/werkruimtes/<naam>/versies`
  (voor terugzetten in S8), `normaliseerWerkruimte` vóór opslaan (400 met reden), alleen JSON,
  Host/Origin zoals de rest. Peilen elke 3 s in de mixer (zoals `plan-koppeling.js`); Claude mag
  het bestand direct schrijven.
- `src/standen/stand-model.js` + `server/standen.js`: een nieuw deel `werkruimte: { naam }`
  (gevalideerd zoals een sjabloonnaam); activeren zet de werkruimte bij de volgende start.
- Voorbeelden in `tools/werkruimtes/voorbeelden/`: `standaard.json` (leeg), `apc-alleen.json`
  (`kiezen: volgt` met de `volgt`-lijst van A4, stukken basis, uitlijn, fx-matrix, mix-extra),
  `twee-handen.json` (B2). Stukken die nog niet bestaan geven een waarschuwing, geen fout.
- Het stuk `mappings/stukken/basis.json`: ⇧ master-knop (`note:0:80`, shift) = `werk.thuis`.
- `.gitignore`: `werkruimtes/`.
- Uitleg in `src/ui/beschrijf/werk.js`; de aanhaker `src/ui/aanhakers/werk.js` zet alles op en
  leest de laatst gekozen werkruimte uit localStorage (`varve.werkruimte`), zonder = `standaard`.

**Bestanden:** `src/werk/{model,werkruimte,apparaten,kleuren}.js`, `src/control/acties-werk.js`,
`src/ui/werk-balk.js`, `src/ui/aanhakers/werk.js`, `src/ui/beschrijf/werk.js`,
`src/ui/css/werk.css`, `server/werkruimtes.js`, `server/routes/werkruimtes.js`,
`src/standen/stand-model.js`, `server/standen.js`, `tools/werkruimtes/voorbeelden/*.json`,
`mappings/stukken/basis.json`, `.gitignore`, tests `test/werkruimte-model.test.mjs`,
`test/werkruimte.test.mjs`, `test/werkruimte-server.test.mjs` (nieuw),
`tools/headless/werkruimte.mjs` (nieuw), `docs/werkruimte/S3.md`.

**Acceptatie:**
- `samenstellen` met `standaard` = de mapping van vandaag (deepEqual op alle regels van
  `apc40mk2.json` + Clay's verschil van 4 regels op cc:0:20–23 @device.rack).
- `apc-alleen` = standaard + precies de regels van de genoemde stukken; 0 botsingen.
- Model weigert: `verberg`, > 8 delen, een mapje zonder kiesknop dat in geen deel staat, een
  regel op een kernsleutel, een houd-regel op `play`; waarschuwt bij een onbekend stuk of mapje,
  een kleur die niet bij het grid-mapje past, > 12 nieuwe plekken. Elk voorbeeld normaliseert
  zonder fout.
- Een deelwissel geeft 0 invokes buiten `layer.*`/`werk.*` (bus-spion); na de wissel de APC-LED-
  diff binnen één tik (33 ms, nep-klok), JS ≤ 1 ms.
- `volgt`: grid stems vast open → deel STEMS, 1 `change`, de APC niet opnieuw gezet; gluren
  (≥ 400 ms vasthouden) wisselt het deel niet.
- `onthoud`: FX → ander mapje → MIX → FX geeft het andere mapje terug.
- `werk.thuis` vanuit elk deel: deel = start, standaardmapjes, 0 andere invokes; ⇧ master-knop
  doet het via het stuk `basis`.
- `vereist`/`terugval`: nep-Maschine weg → `apc-alleen`, één melding; terug → niet vanzelf
  terug (melding met knop).
- Server: PUT zonder of met oude versie = 409 met de huidige inhoud; `.versies` groeit; kapotte
  JSON of een fout uit het model = 400 en niets geschreven; naam met hoofdletter = 400; een
  bestand dat Claude schrijft is binnen 3 s in de mixer.
- Stand met `werkruimte: { naam }` valideert; terugspelen slaat `werk.*` over.
- Headless (`tools/headless/werkruimte.mjs`, nep-APC zoals in de bestaande headless tools):
  werk-balk zichtbaar met `apc-alleen`, verborgen met `standaard`; ⇧ scene 3 → STEMS-rij open;
  `rijen.mjs` en `kijk.mjs` met `standaard` ongewijzigd groen.

**Gebouwd (14 okt, tak `werk/S3`; `docs/werkruimte/S3.md`, verslag `docs/verslagen/2026-10-14/werk-S3.md`).**
Zoals hierboven, met drie verschillen:
- W1 (iPad kijkt alleen): `PUT /api/werkruimtes/<naam>` mag alleen vanaf deze Mac (`ctx.vanDezeMac`, zoals
  `/api/mixer`); via Tailscale of met een proxykop 403. Lezen mag zoals de rest.
- Afspraak met Clay (14 okt): de indeling maakt hij zelf. De drie bestanden in
  `tools/werkruimtes/voorbeelden/` zijn VOORBEELDEN (de kiezer zet er "(voorbeeld)" achter); S3 levert
  één echt stuk (`basis`: THUIS). `apc-alleen` en `twee-handen` noemen stukken van andere sporen; zolang
  die er niet zijn: een waarschuwing per stuk, de rest werkt.
- De Maschine-adapter (`registreerApparaat('maschine-mk2', …)`) levert S6; de toets van vereist/terugval
  draait met een nep-adapter.
- Review ronde 1 (14 okt): de werk-balk (30 px, tot 1000 px hoog 26) gaat NIET van de pagina af. Op
  1440×790 is er met een rij open geen pixel over (main wordt nooit lager dan het focusdeel); zolang de balk
  staat zet `werk-balk.js` `body.werk-balk-aan` (alleen bij een wissel) en maakt `werk.css` topbar, main en
  de kolom rechts in het focusdeel samen 30 px lager. Met `standaard` geldt niets daarvan.
  `tools/headless/werkruimte.mjs` toetst 1440×790 per deel. Peilen elke 2,5 s (niet 3), zodat "binnen 3 s"
  ook met de rondgang klopt.

---

#### S4 — Combinaties en effecten (golf 2)

**Doel:** meer effecten met alle combinatieknoppen die Clay kan bedenken (punt 5), in de
mapping en de control-laag, zonder de engine.

**Bouw:**
- In `src/control/mapping.js`: de modi `druk` en `latch` met `naar` (B5), `lang` (kort = latch,
  lang = momentary, 400 ms, op de audioklok of `performance.now` zoals gluren), `stappen`
  (relatieve encoder → per klik `<action>.fwd`/`.back`, hooguit 8 per bericht); het veld `als`
  (witte lijst van B3, conditie van buiten aangeleverd); de variabelen `{tweede}` (= `{R}`) en
  `{maatgever}` in `resolveTarget`; de houd-mapjes (hieronder) in de zoekvolgorde, vóór de andere
  mapjes. De kies-cache van de andere workflow krijgt de versie van het houd-register in zijn
  sleutel (alleen ophogen bij een verandering, niet per tik). Regelvalidatie: geen houd-regel en
  geen `druk`/`latch` op `play`, `cue`, `play.quant`, `hotcue.*`, `load.*`, `layer.*`.
- `src/control/houd.js` (puur): register van open houd-mapjes per apparaat; `layer.houd.<naam>`
  (trigger: indrukken = open, loslaten = dicht als het nog de zijne is); `losgekoppeld(apparaat)`
  maakt de zijne leeg. In `lagen.js`: groep `houd` die het register leest (gedeeld door alle
  Mappings). Een houd-mapje wordt met `voegMapjeToe('houd', naam, …)` gedeclareerd.
- `src/control/superknop.js` (puur): links oplossen met `resolveLink` uit `src/engine/rack.js`
  (één rekenregel). `src/control/acties-combi.js`: `super.1–16` (value, read = eigen stand,
  meta `log: 'overslaan'`; de kinderen gaan als gewone invokes over de bus en staan dus in het
  log), `super.K.hold` (druk → 1, los → terug), morph `super.K.vastA/.vastB` (meta
  `alleenScherm: true`: leg de reads van nu vast als from/to van de links); glijden alleen via de
  bestaande `.glide`-actions waar die bestaan, anders direct.
- Drukvarianten met de bestaande `drukknop`-logica: `track.N.send.a.hold`, `track.N.send.b.hold`
  (dub-worp), `track.N.fx.mix.hold`. `track.N.stem.<s>.solo` (trigger: zolang je drukt de andere
  stems weg via hun `.hold`; meta `log: 'overslaan'`, de kinderen gaan in het log).
- Bus-racks: `send.a.rack.next/prev`, `send.b.rack.next/prev` (de engine heeft `zetRack` met
  kruisfade), welk rack onthoudt de schermlaag in localStorage op naam (zoals het master-rack);
  `bussen` uit de werkruimte via een functie die S3 kan aanroepen (`zetBusRack(bus, naam)`).
- Stukken `mappings/stukken/fx-matrix.json` (mapje `grid.fx` violet, ⇧ On/Off `note:0:62` shift;
  pads rij 1–4 (noten 32–39, 24–31, 16–23, 8–15) = `track.k.fx.knob.1–4.hold`, ⇧ = `latch` op
  `track.k.fx.knob.1–4` naar 1; rij 5 (noten 0–7) = `track.k.send.a.hold`, ⇧ = latch; scene 1–4
  in `grid.fx` = `master.fx.knob.1–4.hold`; scene 5 blijft loop weg) en
  `mappings/stukken/mix-extra.json` (⇧ A|B `note:k−1:66` shift = `track.k.xfade.thru`).
- Uitleg in `src/ui/beschrijf/combi.js`; opzet in `src/ui/aanhakers/combi.js`.

**Bestanden:** `src/control/mapping.js`, `src/control/lagen.js` (groep `houd`),
`src/control/houd.js`, `src/control/superknop.js`, `src/control/acties-combi.js` (nieuw),
`src/ui/aanhakers/combi.js`, `src/ui/beschrijf/combi.js`, `mappings/stukken/fx-matrix.json`,
`mappings/stukken/mix-extra.json`, tests `test/combinaties.test.mjs`, `test/superknop.test.mjs`
(nieuw), aanvullingen in `test/mapping.test.mjs` en `test/handelingenlog.test.mjs` (alleen nieuwe
gevallen), `docs/werkruimte/S4.md`.

**Acceptatie:**
- `druk` op `track.1.send.a` met `naar` 1: het log bevat twee regels (1 en de oude stand), en
  terugspelen geeft dezelfde stand. `latch`: druk → `naar`, druk → oud. `lang`: < 400 ms = latch,
  ≥ 400 ms = momentary (nep-klok). `stappen`: +3 klikken = 3 × `.fwd`, hooguit 8 per bericht.
- Houd over twee nep-apparaten: APC-knop B doet X alleen zolang houd-knop A (ander apparaat)
  vastzit; laat A eerst los, dan gaat het loslaten van B toch naar X; `losgekoppeld()` van A
  sluit zijn houd-mapjes; twee houd-mapjes tegelijk: loslaten van het ene sluit het andere niet.
- Een houd-regel of `druk` op `play`/`cue`/`hotcue.*` wordt geweigerd met een reden.
- De kies-cache geeft na het loslaten van een houd-knop meteen de gewone regel; de LED-tik is
  niet duurder dan vóór (`tools/bench/feedback.mjs` van de andere workflow, ± 10%).
- Superknop: gouden tabel van 11 standen × 4 links gelijk aan `resolveLink` per link; een opname
  met een superknop speelt terug met dezelfde reads op elk kind (± 1e-9) zonder dubbele invokes;
  een link naar een onbekende action wordt grijs met één melding, geen crash.
- `send.a.hold`: 1 bij indrukken, terug naar de stand van vóór bij loslaten, ook als de fader
  intussen bewoog; `stem.drums.solo` zet zang/bas/overig weg en terug.
- Bus-rack: wissel via de kruisfade (mock: `CURVE_BREUK` = 0, geen disconnect met signaal); tien
  keer snel `send.b.rack.next` stapelt niet meer ketens dan dezelfde wissel op een track-insert.
- Stukken: 0 botsingen met de standaard; elke action bestaat en heeft een uitleg; zonder deze
  velden is elke bestaande mappingtest groen.

**Gebouwd (14 okt, tak `werk/S4`, `docs/werkruimte/S4.md`).** Clay koos (14 okt): hij bepaalt zelf
welke effecten, worpen, superknoppen en racks er zijn; S4 bouwde het mechaniek, met per soort
hooguit één voorbeeld. Wat anders werd dan hierboven:
- Geen grote standaardindeling: het enige voorbeeld is superknop 1 "dub (voorbeeld)" (zonder knop
  erop) en de twee stukken zoals beschreven. Zonder werkruimte (of `?stukken=` voor één pagina)
  verandert er aan de knoppen niets.
- `mapping.lagen`/`mapping.vars` zijn een getter/setter geworden (de houd-mapjes ervoor, de
  variabelen van buiten erbij); een lezer terugzetten zet zijn bron terug (apc-kaart.js).
  `{maatgever}` = `engine.maatgever()` (wat je hoort), niet `syncMaster()`; hij staat alleen in
  `vars()` van een mapping die hem gebruikt.
- Druk/latch alleen op een value-action (met `metaOf`); twee drukknoppen op één doel: de eerste
  stand telt. Stappen naar een `.fwd`/`.back` die niet bestaat doet niets.
- Houd-register telt per apparaat en mapje (twee knoppen van één apparaat); de eigenaar staat bij
  het indrukken vast; een andere mapping laden sluit wat die mapping vasthield.
- Bus-racks: alleen de eigen echo en galm, plus racks met `"bus": true` in `racks/sjablonen.json`
  (een gewoon insert-rack klinkt op een natte bus droog). Nog geen enkel sjabloon heeft dat: Clay kiest.
- Solo per stem telt per stem; `fx.mix.hold` zet niet terug na een rackwissel (zoals drukknop()).
- `zetStuk(doc, { mapping, voegMapjeToe, herbind })` in acties-combi.js zet één stuk (mapjes, dan
  het fragment `stuk:<naam>`); S3 kan hem gebruiken of zijn eigen doen.
- Open voor anderen: feedback.js kent de condities van `als` niet in de sleutel van het LED-plan
  (één regel, `m._alsStand?.()`); regels.test.mjs kent `control/houd.js` nog niet als pure module.

---

#### S5 — Mapping per apparaat, koppelen overal, toetsenbord als data, Maschine-ijkproef (golf 2)

**Doel:** elk apparaat (APC, Maschine, Xboard, toetsenbord) is zelf in te stellen met koppelen,
met een eigen verschil op de server (punt 6, VISIE §5.3), en de hardwareproef voor de Maschine.

**Bouw:**
- `server/routes/mapping-apparaat.js`: `GET/POST/DELETE /api/mapping/<apparaat>` met
  `<apparaat>` ∈ `apc40mk2`, `maschine-mk2`, `xboard49`, `toetsen`; de oude `/api/mapping` blijft
  de APC (dezelfde sleutel `mapping` in de instellingen-tabel, Clay's verschil verhuist niet); de
  andere onder `mapping:<apparaat>`. Zelfde validatie en Host/Origin als de oude route.
- `src/ui/mapping-opslag.js`: `laadEigen(mapping, { apparaat })`, `bewaarEigen(…, { apparaat })`;
  zonder apparaat = APC zoals nu. `src/ui/speelapparaten.js` en `src/ui/instrument-paneel.js`
  laden standaard + verschil via `laadEigen` in plaats van alleen `fetch`.
- `src/control/midi-learn.js` en `src/ui/learn-mode.js`: koppelen per bron in de juiste Mapping;
  `src/ui/mapping-panel.js`: een apparaatkiezer (APC · Maschine · Xboard · toetsen) en "standaard
  herstellen" per apparaat. Op de Maschine: CONTROL vasthouden + aanraken = de control kiezen
  tijdens koppelen.
- `src/control/maschine.js`: alleen de Mapping van buiten aannemen in plaats van zelf maken (één
  regel).
- `mappings/toetsen.json` (nieuw): alle toetsen van `KEYMAP` en `SHIFT_TOETS` als regels
  (signature `key:<code>`, `shift` zoals bij MIDI, `{focus}`/`{tweede}`; `{L}`/`{R}` blijven
  alias). `src/control/keyboard.js` voert een Mapping uit in plaats van de tabel; Space, `[` `]`,
  B, Esc en Cmd+Z blijven code (schermgebaren). `isTypen`, het negeren van Cmd/Ctrl/Alt en
  loslaten bij blur blijven zoals ze zijn.
- **Maschine-ijkproef** (`tools/proef/maschine-ijk.html` + uitleg in je doc): een pagina die via
  `?hub=` meeleest (geen MIDI, stuurt niets behalve een testpatroon op de schermen en lampjes als
  je dat aanklikt), elke knop, pad, draaiknop en het wiel laat aanraken, en per control toont:
  verwacht (profiel `devices/maschine-mk2.js`) tegen ontvangen (signature, noot aan/uit, waarde,
  relatief ±1). Uitkomst als JSON om te bewaren. Op het scherm een testpatroon met labels boven
  F1–F8 om te zien of ze onder de schermlabels zitten.

**Bestanden:** `server/routes/mapping-apparaat.js`, `src/ui/mapping-opslag.js`,
`src/ui/speelapparaten.js`, `src/ui/instrument-paneel.js`, `src/control/midi-learn.js`,
`src/ui/learn-mode.js`, `src/ui/mapping-panel.js`, `src/control/maschine.js` (één regel),
`src/control/keyboard.js`, `src/ui/midi-opzet.js` (alleen als laden per apparaat het vraagt),
`mappings/toetsen.json` (nieuw), `src/ui/aanhakers/apparaten.js`, `tools/proef/maschine-ijk.html`
(nieuw), tests `test/mapping-opslag.test.mjs` (nieuw of aanvulling), `test/learn.test.mjs`
(aanvulling), `test/keyboard.test.mjs` (nieuw, gouden), `docs/werkruimte/S5.md`.

**Acceptatie:**
- Clay's verschil (4 regels op cc:0:20–23 @device.rack) laadt via `/api/mapping` ongewijzigd en
  is na een opslag via `/api/mapping/apc40mk2` byte-gelijk hetzelfde document; een oude volledige
  kopie gaat nog door `verschilVanKopie` + `eerder`.
- Een geleerde Maschine-regel komt in `mapping:maschine-mk2` als verschil, overleeft herladen en
  een serverherstart (`VARVE_TESTSERVER=1`); "standaard herstellen" op de Maschine raakt de APC
  niet; koppelen op de nep-Maschine-poort schrijft nooit in de APC-mapping; een speelapparaat
  wordt nog steeds nooit "de controller" (`isSpeelapparaat`).
- Voor elke toets in `KEYMAP` en `SHIFT_TOETS` geeft `toetsen.json` dezelfde action (gouden lijst,
  0 verschillen); de bestaande toetsentests groen zonder aanpassing; tijdens typen doet geen toets
  iets; Cmd+F start geen hotcue.
- Alle bestaande Maschine-tests en `tools/headless/speelapparaten.mjs` groen.
- De ijkproef draait headless tegen de nep-Maschine van `speelapparaten.mjs` en geeft voor elke
  control "klopt".

**Gebouwd (14 okt, tak `werk/S5`, `docs/werkruimte/S5.md`).** Wat anders werd dan hierboven:
- `src/control/maschine.js` is niet aangeraakt: de opslag laadt standaard + verschil in
  `maschine.mapping` zelf, en het leren hangt vóór `maschine.ontvang` (`vangLeren` in
  `midi-learn.js`). Het bestand blijft helemaal van S6.
- Signature van een toets: `key:0:<HID-gebruikscode>` (A = 4 … § = 100) met de toets als label,
  niet `key:<code>`: `mapping.js` (S4) neemt alleen `type:kanaal:nummer` aan.
- Niet te koppelen op de Maschine (melding): pads, wiel, ENTER, CONTROL, SHIFT, ◄ ► (pagina en
  transport), STEP, SCENE, SAMPLING, PATTERN — die handelt `maschine.js` af vóór de mapping.
- De Xboard-plek geldt voor elk MIDI-keyboard (`noten.js` heeft één mapping voor alle poorten
  behalve de APC).
- De server weigert een document voor een ander apparaat (400) op `/api/mapping/<apparaat>`.
- Erbij: `tools/proef/maschine-ijk.mjs` (headless runner, ook koppelen in de echte mixer), en
  `test/aanhaakpunten.test.mjs`: "de routebestanden zijn leeg" werd "elke route onder /api/, geen
  witte-lijstregel die data openzet" (een gevulde stub kon nooit meer groen zijn).
- `tools/proef/` valt onder `proef/` in `.gitignore` (de datamap): met `git add -f` toegevoegd;
  `.gitignore` hoort `/proef/` te zeggen (S3).

---

#### S6 — Maschine-delen en de kaarten (golf 3)

**Doel:** de Maschine als diepe hand per deel (punt 1), F1–F8 als deelkiezer, houd-knoppen,
fasescoop op het scherm, en de kaarten die elke werkruimte en elk deel laten zien.

**Voorwaarde:** golf 2 (S1–S5) zit in `studio/integratie`. Lees de uitkomst van de
Maschine-ijkproef (poort M) als die er is; bouw tegen de nep-Maschine, maar wijk niet af van het
profiel zonder de uitkomst.

**Bouw:**
- `src/control/maschine.js`:
  - pagina's uit data: `PAGINAS` krijgt de pagina's die een stuk declareert (`uitlijn`, `stems`,
    `beeld`, `super`); bestaande pagina's ongewijzigd;
  - padmodi uit data: een padmodus die een stuk declareert (`transport`, `uitlijn`, `worpen`,
    `stems`, `beeld`, `laden`) stuurt de pads naar de mapping met laag `pads.<modus>`; STEP,
    SCENE en SAMPLING blijven code; in SCENE wordt ⇧ + pad `track.{focus}.section.K.loop`;
  - het wiel vraagt eerst de mapping of er in de open mapjes een regel op `cc:0:24` staat
    (laag `bladeren` gaat voor als de library open is), anders het oude gedrag;
  - de houd-knoppen via `houd.js` (gedeeld met de APC);
  - de Maschine-adapter voor S3 (`registreerApparaat('maschine-mk2', { zetMapjes({ pads,
    pagina, wiel, scherm }), mapjes(), aanwezig() })`);
  - een pad laat los waar hij indrukte, ook na een deelwissel (`padVast`, bestaat).
- `src/control/maschine-scherm.js`: nieuwe exports `tekenDeelLabels(delen, actief)` (bovenste
  regel, het actieve omgekeerd), `tekenFasescoop(vouw)` en `tekenGetallen(getallen)` (uit
  `src/uitlijn/reken.js`), 1 bit, 256×64.
- Stukken `mappings/stukken/maschine-delen.json` (F1–F8 `note:1:0–7` = `werk.deel.1–8`, SHIFT +
  F1 = `werk.thuis`; de pagina's en padmodi van A3 met hun regels; wielregels met `stappen`:
  MIX/UITLIJN jog, FX `rack.next/prev`, SECTIES `section.next/prev`, BEELD `video.mode`) en
  `mappings/stukken/maschine-houd.json` (VOLUME `note:1:16` = `layer.houd.volume` met cc:0:16–23
  = `track.1–8.fader` relatief; TEMPO `note:1:18` = `layer.houd.tempo` met wiel = tempo fijn;
  SWING `note:1:17` = `layer.houd.swing` met wiel = `phase.offset` focus; SOLO `note:1:46` =
  `layer.houd.solo` met stem-pads = `stem.<s>.solo`; DUPLICATE `note:1:44` = `layer.houd.dup` met
  sampler-pads = `sampler.N.drums`; MUTE `note:1:47` = `track.{focus}.fx.bypass`).
- `src/ui/maschine-kaart-plan.js` en `src/ui/maschine-kaart.js`: `PADMODI`/`PAGINAS` uit de data;
  een kiezer werkruimte + deel (voorbeeldmodus: niets activeren, alleen tonen via `kies()`).
- `src/ui/apc-kaart.js`: dezelfde kiezer, toont de stukken en houd-mapjes per deel.
- `spiekbrief.html` + `src/ui/spiekbrief.js`: per werkruimte, per apparaat, per deel één
  printbare pagina met wat elke knop doet (uit `kies()` + `beschrijf()`), in de deelkleur.
- `src/ui/aanhakers/maschine.js` (wacht op `ctx.maschine`), `src/ui/beschrijf/maschine.js`.

**Bestanden:** `src/control/maschine.js`, `src/control/maschine-scherm.js`,
`src/ui/maschine-kaart-plan.js`, `src/ui/maschine-kaart.js`, `src/ui/apc-kaart.js`,
`spiekbrief.html`, `src/ui/spiekbrief.js` (nieuw), `mappings/stukken/maschine-delen.json`,
`mappings/stukken/maschine-houd.json`, `src/ui/aanhakers/maschine.js`,
`src/ui/beschrijf/maschine.js`, tests `test/maschine-delen.test.mjs` (nieuw), aanvullingen in
`test/maschine.test.mjs` en `test/maschine-kaart.test.mjs` (alleen nieuwe gevallen),
`tools/headless/werk-maschine.mjs` (nieuw), `docs/werkruimte/S6.md`.

**Acceptatie:**
- Elke bestaande Maschine-test (`maschine`, `maschine-kaart`, `maschine-sampler`, `bladeren`,
  `sec-maschine`) groen zonder verwachting te veranderen; zonder stukken gedraagt de Maschine zich
  bit voor bit als nu.
- Headless `tools/headless/werk-maschine.mjs` met de echte hub, nep-APC en nep-Maschine
  (`opname: false`, zoals `speelapparaten.mjs`): F1–F8 wisselen het deel; de APC-grid-LED's
  krijgen de kleur van het deel binnen 33 ms; het Maschine-scherm toont de 8 labels met het
  actieve omgekeerd; in FX geven twee pads tegelijk twee worpen (reads 1 en 1, na loslaten de oude
  stand); VOLUME vast + draaiknop 3 beweegt `track.3.fader`; in UITLIJN volgt de ring van device
  knob 2 `track.2.phase.offset`; het wiel is jog in MIX en bladert met de library open; SHIFT + F1
  = thuis vanuit elk deel; nep-Maschine weg → `apc-alleen` met één melding.
- Volgorde over twee apparaten: 1000 keer SOLO dan een APC-knop met 5 ms ertussen via de echte
  hub; de volgorde klopt in ≥ 99,9%; de scheefheid p99 staat in je doc.
- Speellatentie van de pads in SPELEN hooguit +0,1 ms mediaan (`tools/bench/invoer.mjs`, voor en
  na); de LED-tik van de Maschine niet duurder (± 10%).
- Schermen: 2048 bytes per scherm; pixeltest van labels en fasescoop zoals in `maschine.test`.
- De kaarten: per werkruimte × deel × padmodus geen lege uitleg waar een regel staat;
  `maschine.html` stuurt nog steeds niets; zonder `?hub=` laadt de mixer geen Maschine-code
  (hub.test).
- Spiekbrief: één pagina per apparaat × deel, elke regel met tekst.

---

#### S7 — Schermen en de iPad (kijken) (golf 3)

**Doel:** meerdere schermen tegelijk (punt 2): een paneelpagina op een tweede Mac-scherm en op de
iPad (eerst alleen kijken), het werkvak in de mixer, vrije panelen, en de iPad als
podiumapparaat.

**Voorwaarde:** golf 2 zit in `studio/integratie` (S2 uitlijn, S3 werkruimte).

**Bouw:**
- `src/ui/vensters.js` + `src/ui/renderloop.js`: `bind(root)`/`ontbind(root)` zodat een paneel
  dat verschijnt zijn Knobs, knoppen en faders bij de renderloop aanmeldt en weer weghaalt
  (nu één keer bij het opstarten).
- `src/paneel/vrij.js`: een vrij paneel uit `panelen` (B2/B3: `draai`, `knop`, `schuif`, `lamp`,
  `xy`, `rij`, `tekst`) met de semantiek van `controls.js` (indrukken leest de action, loslaten
  naar dezelfde); labels uit `beschrijf()`, kleur uit `soorten.js`, `{focus}` enz. via
  `resolveTarget`; een onbekende action grijs met één melding. **Badge** per item/paneel: welke
  control in de open mapjes ernaar wijst (omgekeerd zoeken in `mapping.actieveRegels()`), en 300 ms
  oplichten bij aanraken (zoals `spiegel.markeer`).
- `src/paneel/kaart.js`: per apparaat de open mapjes en wat elke knop NU doet (`kies()` +
  `beschrijf()`), groot.
- `src/paneel/protocol.js` (puur, C4), `src/paneel/verbinding.js` (opener als die er is en
  dezelfde oorsprong heeft, anders SSE + ping), `src/paneel/paneel.js` en `werk.html?s=<scherm>`:
  de vakken van dat scherm in het actieve deel (`uitlijn` via `src/uitlijn/teken.js` uit
  segmenten, `kaart`, `paneel:<id>`, `stand`, `secties`); volgt het deel. Geen AudioContext,
  geen MIDI, geen Web Lock. Schrijven alleen via opener (mac-2); de SSE-tak is in dit spoor
  **alleen lezen** (geen POST naar de mixer).
- `src/ui/live-zender.js`: de mixer zendt naar `POST /api/paneel/van-mixer` (alleen de lockhouder
  of met `?hub=` het verbonden tabblad, `statusVanMij()`), gebundeld per 20 ms; alleen als er een
  kijker is (de server zegt het in het antwoord), anders niets.
  `server/paneel.js` + `server/routes/paneel.js`: `van-mixer` (alleen `vanDezeMac`), `live` (SSE),
  `ping`. Nul dependencies.
- Werkvak in de mixer (`#werkvak`): het `werkvak` van het deel (`uitlijn-strook`, `uitlijn`,
  `paneel:<id>`), via het event `'werkruimte'` van S3; met `standaard` blijft hij `hidden`.
- Plaatsing: met de Window Management API per scherm-naam het fysieke scherm onthouden, één knop
  "open schermen" op de werk-balk (via een functie die S3's balk aanbiedt of een eigen knop in het
  werkvak), waarschuwing als het beamervenster op hetzelfde scherm staat; zonder toestemming
  gewoon `window.open`.
- iPad als podiumapparaat (C4): `werk.webmanifest`, apple-meta's, Screen Wake Lock,
  `touch-action`, pointer events per `pointerId`, herverbinden, de rode balk.
- Stijl in `src/ui/css/panelen.css`; opzet in `src/ui/aanhakers/schermen.js`; uitleg van nieuwe
  dingen in `src/ui/beschrijf/schermen.js`.

**Bestanden:** `src/ui/vensters.js`, `src/ui/renderloop.js`, `src/ui/controls.js` (alleen als
`bind(root)` het vraagt), `src/paneel/{protocol,verbinding,paneel,vrij,kaart}.js`, `werk.html`,
`werk.webmanifest`, `src/ui/live-zender.js`, `server/paneel.js`, `server/routes/paneel.js`,
`src/ui/aanhakers/schermen.js`, `src/ui/beschrijf/schermen.js`, `src/ui/css/panelen.css`, tests
`test/vrij-paneel.test.mjs`, `test/paneel-server.test.mjs`, `test/regels-werk.test.mjs` (nieuw),
`tools/headless/werk-scherm.mjs` (opener) en `tools/headless/werk-ipad.mjs` (nep-iPad = een tweede
headless browsercontext zonder opener), `docs/werkruimte/S7.md`.

**Acceptatie:**
- Opener: een paneel met 4 items op `werk.html?s=mac-2` volgt `read()`: een APC-draai via een
  nep-poort is binnen 1 beeld zichtbaar; een klik verandert de read in de mixer binnen 1 beeld en
  staat in het log; loslaten gaat naar dezelfde action, ook na een deelwissel tussendoor;
  ontbinden laat geen Knob in de renderlijst achter. Badge en oplichten werken.
- SSE: twee kijkers krijgen bij verbinden de volledige stand (≤ 16 kB) en daarna alleen
  verschillen; een `tijdlijn` per nieuwe segId, in rust ≤ 2 berichten/s per deck; `van-mixer`
  van buiten de Mac = 403, van een tweede tabblad zonder lock genegeerd; zonder kijker zendt de
  mixer niets.
- Nep-iPad (tweede browsercontext op `http://127.0.0.1`, zonder opener): de uitgerekende hoorbare
  positie ligt binnen 5 ms van `hoorbaar()` in de mixer over 60 s, ook na seek, loop en rem; de
  pagina doet nul POST's naar de mixer; na het wegvallen van de server toont hij de rode balk en
  herstelt hij binnen 3 s na terugkomst met de volledige stand.
- `test/regels-werk.test.mjs`: de importboom van `werk.html` en `uitlijn.html` bevat geen engine,
  geen AudioContext, geen requestMIDIAccess, geen Web Lock; de mixer laadt `src/paneel/` niet.
- Met `standaard`: `rijen.mjs`, `kijk.mjs`, `bovenbalk` ongewijzigd groen; het werkvak verborgen.

**Gebouwd (14 okt, tak `werk/S7`, `docs/werkruimte/S7.md`, verslag `docs/verslagen/2026-10-14/werk-S7.md`):**
het mechaniek zoals hierboven, als data; Clay bepaalt de indeling (geen standaardindeling, alleen
een proefwerkruimte in de headless proeven). Wat afwijkt of erbij kwam:
- De mixer laadt `src/paneel/` en de zender pas bij een werkruimte (niet `standaard`), dynamisch in de
  aanhaker `schermen` (`regels-werk.test.mjs`). Zonder werkruimte: geen timer, geen fetch naar `/api/paneel/`.
- Vakken op mac-2 en de iPad: `uitlijn…`, `paneel:<id>`, `kaart`, `stand`, `secties`; in het werkvak:
  `uitlijn…`, `paneel:<id>`, `kaart`. `xy` stuurt twee actions via `{as}` (1 = links–rechts, 2 = onder–boven).
- De server stuurt 1×/s een `hb`; de pagina toont de rode balk na 2,5 s stilte en verbindt zelf opnieuw
  (één poging per 0,75 s). Een tweede mixer-tabblad wordt ook op de server genegeerd (tab-id; overnemen
  pas na 3 s stilte en met een stand). `GET /api/paneel/kijkers` en `/api/paneel/stand` erbij (lezen).
- De klok: `getOutputTimestamp()` + het gemiddelde verschil met `currentTime` (het midden van de
  schommeling per audioblok), 1×/s en meteen bij een sprong > 1 ms (hooguit 10×/s).
- Gemeten in deze container: zie het verslag (de hoorbare positie op de nep-iPad haalt de 5 ms gemiddeld
  over een reeks van 50 ms; tegen één losse `hoorbaar()` niet, die schommelt in headless zelf 10,7 ms).

---

#### S8 — Inrichten, iPad bedienen (na W1), totaalmeting, proef en docs (golf 4)

**Doel:** Clay richt zelf in zonder JSON, de iPad mag bedienen als Clay ja zegt, alles samen blijft
binnen het budget, en de proef en de docs liggen klaar.

**Voorwaarde:** golf 3 zit in `studio/integratie`. Het deel "iPad bedienen" alleen als Clay W1 met
ja heeft beantwoord (staat in `docs/VRAGEN.md` of de orkestrator zegt het); anders sla je dat
deel over en meld je dat.

**Bouw:**
- **✎ inrichten** (`src/werk/inrichten.js` + UI op de werk-balk en in `werk.html`): aanwijzen
  (klik een bestaande knop met `data-action`, of beweeg een control: `learn-mode.js` levert het
  signaal) → item op een paneel; een action-zoeker die de top-40 muishandelingen bovenaan zet (de
  lijst uit `origin/visie/handen` als data overnemen in `tools/werkruimtes/top40.json`, met
  bronvermelding; niet de tak samenvoegen); "wijs dit paneel toe aan: APC device knobs / Maschine
  draaiknoppen / Maschine pads / F1–F8" → regels in `regels` van de werkruimte (alleen vrije
  sleutels of nieuwe/eigen mapjes, gecontroleerd door het model); een item weghalen met een tweede
  klik; "leg vast in dit deel" (de action van S3) op de balk; **terug naar de vorige inrichting**
  (`werk.terug`, meta `alleenScherm`, uit `GET /api/werkruimtes/<naam>/versies`).
- **iPad bedienen** (alleen na W1): `POST /api/paneel/invoke`, `GET /api/paneel/naar-mixer`,
  koppelcode, token-cookie, de witte lijst bij de mixer (C4), loslaten bij wegvallen (1,5 s), rem
  120/s, `seq`, `bron: 'ipad'` in het log, destructief met tweede druk; een tegel in de
  Controlekamer (aan/uit, gekoppelde apparaten, intrekken); standaard uit = 404.
- **Totaalmeting** `tools/headless/werk-alles.mjs`: de budgetten van C6.
- **Proef:** blok "Werkruimte" in `src/controle/speellijst.js` met de punten van D3 (E0, poort M,
  A–D), elk met een meetbaar oordeel.
- **Docs:** `docs/WERKRUIMTE.md` (samengevoegd uit `docs/werkruimte/S0–S8.md`: wat gebouwd is,
  de regels, wat niet getest is), `docs/VRAGEN.md` blok W (de open vragen), een sectie
  "Werkruimte" in `CLAUDE.md` (regels voor bouwers: stukken alleen op vrije sleutels, een deel
  zet nooit klank, de botsplekken, `alleenScherm`, de meta-vlaggen, de iPad-regels) en de
  structuurlijst in `CLAUDE.md` bijgewerkt.

**Bestanden:** `src/werk/inrichten.js` (nieuw), `src/ui/werk-balk.js` (alleen de ✎-knop en
terug), `src/paneel/paneel.js` (✎ in `werk.html`), `src/ui/learn-mode.js` (alleen het
aanwijs-signaal), `tools/werkruimtes/top40.json`, `server/paneel.js` + `server/routes/paneel.js`
(invoke, naar-mixer, koppelen; alleen na W1), `src/ui/live-zender.js` (ontvangen en uitvoeren;
alleen na W1), `src/paneel/verbinding.js` (POST-tak; alleen na W1), `src/controle/controle.js`
(tegel), `src/controle/speellijst.js`, `src/ui/aanhakers/inrichten.js`, `index.html` en
`src/ui/app.js` (alleen als echt nodig), `docs/WERKRUIMTE.md`, `docs/VRAGEN.md`, `CLAUDE.md`,
tests `test/inrichten.test.mjs`, `test/paneel-schrijf.test.mjs` (nieuw),
`tools/headless/werk-alles.mjs`, uitbreiding van `tools/headless/werk-ipad.mjs`.

**Acceptatie:**
- Inrichten: aanwijzen van een knop zet het juiste item op het paneel (headless); een toewijzing
  aan de Maschine-draaiknoppen geeft regels die het model accepteert en die na herladen werken;
  een toewijzing op een kernsleutel wordt geweigerd met een reden; terug zet de vorige versie
  terug (409 als iemand anders intussen opsloeg).
- iPad bedienen (na W1): zonder instelling 404; zonder token 401; verkeerde Origin 403; een action
  buiten de panelen van dat scherm (na `resolveTarget`) 403 en niet uitgevoerd (de read blijft
  gelijk); `record.start` in een paneel toch geweigerd; loopback invoke → read p99 < 5 ms over
  1000 rondjes; SSE dicht terwijl een `.hold` vastzit → los binnen 1,5 s; 200 invokes/s → 429
  boven 120; dezelfde `seq` twee keer = één invoke; het log toont `bron: 'ipad'`; laden over een
  spelende track vraagt ook hier een tweede druk.
- Totaalmeting: hooguit 2 ms per beeld extra, geen lange taak > 50 ms, LED-tik p99 ≤ +10%,
  ≤ 3 Mpx/s in rust.
- Het speellijstblok staat in de Controlekamer; `node test/alles.mjs` groen in
  `studio/integratie`; met `standaard` elke bestaande headless tool groen.

---

## Deel E: vragen, volgende versie, aannames

### E1. Vragen voor Clay (blok W)

- **W1** Mag de iPad de mixer **bedienen** (de eerste schrijfweg van buiten de Mac, alleen via de
  tailnet, met een koppelcode en een schakelaar in de Controlekamer), of eerst alleen kijken? Tot
  je ja zegt, kijkt hij alleen.
- **W2** Hoe staan de controllers op tafel, en met welke hand doe je wat? Het ontwerp gaat uit
  van: de APC voor beide handen bij een overgang (de kern), de Maschine voor één hand naast de
  laptop. Staat de Maschine links of rechts, en ben je links- of rechtshandig? Dat bepaalt
  alleen welke houd-knoppen het makkelijkst te combineren zijn, niet de indeling.
- **W3** Effecten die de engine raken (loop roll of beat repeat op NOTE REPEAT, reverse, effect
  per stem, een extra bus, vrije routing): wil je die, en welk concreet moment in een set mis je
  nu? Zonder voorbeeld bouwen we het niet.

Zelf gekozen (zeg het als je het anders wilt): acht delen op F1–F8 in deze volgorde; THUIS op
⇧ + master-knop (het voorstel "⇧ master = clips uit" van de handenkaart schuift daarmee op);
werkruimte wisselen alleen vanaf het scherm; fase lineair met een fijne variant op shift (geen
√-schaal); SSE in plaats van WebSocket; sampler, secties, patronen en auto in `twee-handen` uit de
▲ ▼-rondgang (wel via ⇧ + scene).

### E2. Volgende versie (na de proef)

- Wat bevalt van de stukken naar `mappings/apc40mk2.json` (+ `eerder.mjs`); de stukken die
  overbodig worden weg.
- Mapjes en Maschine-padmodi volledig als data (`GROEPEN`, `OP_AANVRAAG`, `LAAGNAAM` naar het
  mappingdocument; STEP/SCENE/SAMPLING als regels).
- Het volle `met`-regelveld als de houd-mapjes op de hardware tekortschieten.
- Een mappingverschil per werkruimte (koppelen alleen voor deze werkruimte).
- Het hoofdscherm als vrij raster: de bestaande rijen verplaatsbaar met `appendChild` (id's
  heel), een lade "alle panelen" op elk scherm, delen die erven (alleen het verschil bewaard).
- Sync-lock; "buig precies d seconden" als segment; duwen samenvoegen in de engine.
- Engine-effecten op Clay's concrete vraag (W3).
- De rack-editor op elk slot (echo-bus, galm-bus, master).
- Een WebSocket in plaats van SSE als de iPad tekortschiet; LPD8-rollen per werkruimte (met de
  hub afstemmen); werkruimte wisselen vanaf een controller.
- Een oefenmodus ("druk de knop voor X") op de kaarten.

### E3. Aannames (kunnen verkeerd zijn)

- De pan-ring van de APC is leesbaar als fasemeter (15 lampjes; grof ~35 ms, fijn ~4 ms per
  lampje). Proef A.
- Een duw van ~0,5–4 ms met 4 ms overvloei is onhoorbaar; samengevoegd stapelt hij met keylock
  niet op. Gemeten in S1.
- De Maschine-knoppen sturen noot aan/uit bij indrukken en loslaten, het wiel is relatief ±1 per
  klik, en F1–F8 zitten onder de schermlabels. Poort M.
- De hub geeft APC (lease) en Maschine in volgorde van aankomst door. Gemeten in S6.
- `tailscale serve` houdt SSE-verbindingen open; Safari bewaart een `Secure`-cookie op de
  `ts.net`-naam; Screen Wake Lock werkt als beginschermapp. Proef D.
- Touch op de iPad 30–60 ms, wifi + WireGuard 5–30 ms: niet gemeten.
- De Window Management API mag meerdere vensters per klik openen met toestemming (Chrome).
- Een tweede venster met de uitlijnweergave in pagina-vorm kost de mixer minder dan één beeld per
  seconde; alleen in software-rendering verhoudingsgewijs gemeten. Opnieuw op de M1.
- De CC's van de Xboard (Ardour-map) blijven een aanname tot de hub-middag.
