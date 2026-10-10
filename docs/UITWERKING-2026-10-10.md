# Uitwerking van de visie: zeven sporen (10 oktober 2026)

*Synthese, geschreven 10 okt 16:40–17:15 door de synthesizer-agent, uit de zeven spoorrapporten
(`8-spoorrapport.md`), de zeven verdiepingen (`9-verdieping*.md`) en, waar nodig, de definitieve
ontwerpen, bouwverslagen en reviews in `scratchpad/uitwerking/<spoor>/`. Getoetst aan `docs/VISIE.md` §5.
Ik heb zelf niets gebouwd, geen test gedraaid, geen server gestart en niets gemerged; alle cijfers komen
uit de verslagen van de agenten en de PR-teksten (door mij nagekeken via `gh pr list` om 16:35). Een
kopie staat in `scratchpad/uitwerking/SYNTHESE.md`. Eerlijkheidshalve: in deze sessie waren geen
subagenten beschikbaar (`ListAgents`: geen), dus de synthese is door één agent geschreven; "elkaar
aansturen" gebeurde vandaag via de bestanden in de spoormappen, niet live.*

---

## 0. Vanavond (proefavond 1): vier dingen die niets met de sporen te maken hebben

Deze vier zijn door meerdere spoorleiders gezien en door niemand gedaan (regel: niets van een ander
stoppen of verwijderen). Ze zijn jouw besluit, vóór de proef:

1. **Klep open.** Sinds 15:03 staat `AppleClamshellState = Yes`; met de klep dicht rendert de
   audio-uitgang 0 samples en staat Varve's audioklok stil (gezien door spoor beeld, 15:30 en 16:12).
   Doe de klep open en controleer dat VARVE klinkt vóór de proef.
2. **De wees stoppen.** Een headless Chrome van de review-server van 9 okt (pid 24091 = node op poort
   8904, 24092, 24139 = `chrome-headless-shell`), sinds gisteren 21:01, trekt 8–38 % van een kern. Op een
   passief gekoelde Air die vanavond speelt wil je hem niet: `kill 24091 24092`.
3. **Bluetooth uit (of de AirPods in het doosje) vóór je de mixer opent.** Spoor draagbaar zag de
   standaarduitgang binnen een kwartier drie keer wisselen zodra de AirPods verbinden; Chrome kiest de
   uitgang bij het openen en wisselt daarna niet meer.
4. **Laat een log lopen** (● opname, ○ log, of het vinkje "altijd" achter ↺). Zonder log heeft het
   setboek van morgen niets te lezen (spoor produceren-uit).

Bijvangst om te weten: je laadt met een 8 W-lader (`pmset -g ac`, 12:09), accu 78 % gezondheid na 591
cycli; `fileproviderd` (iCloud) stond om 15:24 op 241 % CPU. Niets daarvan is vanavond gevaarlijk; het is
wel precies waar de sporen draagbaar en uitzenden over gaan.

---

## 1. Eén pagina voor Clay: wat er vandaag per spoor gebeurde, en wat je morgen kunt proberen

Zeven sporen, elk in dezelfde estafette (verkenner → twee ontwerpers → jury → twee critici → definitief
ontwerp → bouwer → reviewer → herstel → reviewer → herstel → spoorleider → één verdieping). **Acht PR's,
allemaal naar `studio/integratie`, allemaal "[na de proefavond]", geen enkele gemerged.** Nulmeting van
de testsuite op `origin/main` (`a3c81a4`): 71 bestanden, 7107 checks. Alle takken: suite groen (per
spoor hieronder). Je echte checkout, `media/library.db`, de server op 8777, de hardware en je Chrome zijn
door geen enkel spoor aangeraakt (één incident, companion, binnen 2 minuten gestopt en nagekeken: geen schade).

| Spoor | PR | Wat er nu is, in één zin | Suite | Morgen proberen (kort; recept in §2) |
|---|---|---|---|---|
| **uitzenden** | [#24](https://github.com/CKrebbers/youtube-mixer/pull/24) draft, `visie/uitzenden` `4ed7b2c` | `server/uitzend.js`: leest de opname die al groeit en duwt hem via ffmpeg naar een **lokaal** doel (bestand, rtmp/udp op 127.0.0.1); slot tegen elke dienst; geen route, geen knop; rechten bij de bron nagekeken | 72 / 7195 | `node test/uitzend.test.mjs` (40 s, 88 ok); er is nog niets te zíen tot stap 3 |
| **companion** | [#20](https://github.com/CKrebbers/youtube-mixer/pull/20) draft (stap 1), [#25](https://github.com/CKrebbers/youtube-mixer/pull/25) draft (stap 2, bevat #20) | `/companion`: iPad = de kaart (zoeken, wens, kies, haal nu, speeldag); iPhone = "nu speelt per track" met resttijd en de beeldstand; maakt nooit audio of MIDI | 74 / 7305 en 76 / 7407 | proefserver op 8840 met een kopie van je library, `http://localhost:8840/companion` (§2) |
| **beeld-een-machine** | [#23](https://github.com/CKrebbers/youtube-mixer/pull/23), `visie/beeld-een-machine` `886a54b` | knop **CLIPS** (`video.clips`): deck-video's uit, eigen vormen door = het **zaalbeeld**; knopjes "deze Mac · pc"; startscript en meetscript voor de Stroommachine op de Mac; Licht-1080 alleen haalt 60 fps | 73 / 7246 | de 14-minuten-meting `node tools/headless/beeld-lokaal.mjs` (klep open, wees weg, geen muziek) |
| **crossover** | [#26](https://github.com/CKrebbers/youtube-mixer/pull/26), `visie/crossover` `3a341cd` | `sampler.N.drums`: een knip uit de sampler op een drumpad van de Drums, op **dezelfde** Maschine-pad; de knip krijgt zo een strip, cue, fx en speelt in een patroon; werkt ook met gestreamde stems (verdieping) | 72 / 7197 | niet zonder merge; proefblok "Avond 2 · Crossover" staat klaar in de Controlekamer-speellijst |
| **standen** | [#21](https://github.com/CKrebbers/youtube-mixer/pull/21) draft, `visie/standen` `fddb1a3` | **Opstelling**: één JSON per situatie (`apc`, `alles`, `maschine`, `laptop`), tegel in de Controlekamer met activeer/verschil/vastleggen/terug en een bewerker zonder JSON; nacht alleen remmen; VARVE.app kan straks droplet én argument | 76 / 7453 | proefserver op 8821 met een kopie, `http://localhost:8821/controle` → tegel Opstelling |
| **draagbaar** | [#19](https://github.com/CKrebbers/youtube-mixer/pull/19) draft, `visie/draagbaar` `2de9c5b` | **Avondpakket**: 14 controles (media lokaal, iCloud, accu, lader, uitgang, APC, Scarlett, backup…) als tegel + CLI; paklijst en ritueel; iCloud-detectie end-to-end bewezen | 74 / 7475 | `node tools/avondpakket.mjs --profiel apc` tegen je echte mediamap (alleen lezen, 0,2 s); **7a vóór je de stekkers eruit trekt** |
| **produceren-uit** | [#22](https://github.com/CKrebbers/youtube-mixer/pull/22), `visie/produceren-uit` `df8de87` | patronen → MIDI-bestand (type 1, 384 PPQN, verliesvrij terug) en het **setboek**: uit het handelingenlog wat er echt klonk, tracklist, Buma-lijst; op 18 echte logs gedraaid: 17/17 ok | 74 / 7368 | **het setboek van vanavond** op een kopie van de logs (§2); de Logic-proef op een rustige dag |

**De vier ontdekkingen van de dag die boven de sporen uitstijgen:**

1. **Uitzenden is een uitgang, geen bron.** De regel "geen publieke streaming" in `CLAUDE.md` ging over de
   YouTube-cache. Drie sporen (uitzenden U1a, produceren-uit K-D, crossover CX3) lopen tegen dezelfde zin
   aan en stellen dezelfde verduidelijking voor. Eén keuze van jou (VI1) maakt ze alle drie los.
2. **iCloud is het ding dat "vanaf elke plek" breekt.** Een uitgeplaatst `stems.wav` laat de server bij de
   eerste `read()` hangen tot het héle bestand (3,9 GB) binnen is; vanaf vier open lezingen staat elke
   `fs`-aanroep stil (gemeten, draagbaar §9). Tijdens een uitzending wil iCloud de groeiende opname
   uploaden over dezelfde hotspot (uitzenden). Antwoord: `media/` (en de opnames) buiten iCloud (VI2).
3. **Je speelt je eigen beeld, niet de Stroommachine.** 4.576 acties op vormen en video-effecten tegenover
   0 op de Stroommachine-knoppen. Dus: zaalbeeld (vormen zonder clips) is de standaard onderweg, de
   Stroommachine op de Mac een upgrade na een groene meting. De CLIPS-knop is tegelijk precies de
   schakelaar die uitzenden nodig heeft voor beeld naar buiten (G8).
4. **Alles wat je wilt instellen is nu data**: opstellingen, avondpakket-profielen, uitzenddoelen,
   companion-kratten, MIDI-export, drumpad-toewijzing. Geen enkel spoor heeft code nodig om iets anders
   in te stellen (pijler 4). De drie regels van `CLAUDE.md` zijn in geen enkel spoor geraakt
   (`regels.test.mjs` overal groen).

---

## 2. Per spoor: ontwerp in het kort, gebouwd, open, keuzes

### 2.1 Uitzenden (`scratchpad/uitwerking/uitzenden/`, `docs/UITZENDEN.md` op de tak)

**Ontwerp.** Niet "Varve zendt naar YouTube" maar "Varve levert het signaal lokaal; OBS (dat al op je Mac
staat, 36× gebruikt, met Twitch-doel en capture-stick) doet camera, sleutel en dienst". De module leest
de opname die toch al groeit (één tap, één waarheid; WAV met en zonder uitzending byte voor byte gelijk).
Twee profielen: **stil** (master-WAV + beeld uit het geluid zelf: zwart, golf, of png met golf; 2 fps,
~300 kbit/s, ~10 % kern) en **beeld** (de opname-mp4 opnieuw gecodeerd met videotoolbox, 2,5 Mbit/s,
keyframe elke 2 s; ~3–5 % kern; alleen samen met de opname te starten). Een **lokaal-slot**: een doel mag
alleen een bestand zijn of 127.0.0.1/[::1]; alles anders "staat uit tot Clay U1 beslist".

**Gebouwd.** `server/uitzend.js` (704 regels), `test/uitzend.test.mjs` (88 checks + 8 in echte tijd),
`docs/UITZENDEN.md`, `uitzend/doelen.voorbeeld.json`, blok U in VRAGEN. `server/index.js` en `src/`
onaangeroerd: geen route, geen knop, geen action. Chrome's eigen opname (14,6 s) door de module naar
bestand en lokale RTMP: keyframes precies 2,00 s, achterstand max 5,0 s, niet groeiend. Review 2: "klaar = ja".

**Verdieping (rechten bij de bron).** Twitch DJ Program: opt-in voor iedereen (geen affiliate nodig),
NL ok, alleen catalogusnummers, **audio-only/automatisch verboden** (dus het stil-profiel mag daar nooit
heen). Mixcloud Live: betaald (€ 11/maand), audio-only mag, "unlisted" testen kan, regels bijten alleen
op de bewaarde opname. Sena livestream € 62,00 (2026), ook bij gratis stream via eigen site. Buma op
Twitch/YouTube zonder inkomsten niet nodig. **U2-volgorde wordt: eigen-werk-sessie → Mixcloud Live
unlisted → Twitch DJ Program → eigen server nooit met muziek van anderen zonder Sena+Buma.** Geen
juridisch advies.

**Open.** M1 (stop de opname tijdens het starten: stand liegt "bron stil"; 2 regels) en L1–L6 vóór de
merge. Daarna stap 0 (**één hele set opnemen met beeld, ≥ 45 min**: de langste opname tot nu toe is
5,6 min) → stap 2 (headless Chrome 10 min, rustige machine) → stap 3 (routes; dan is er iets te zien) →
stap 5 (thuisproef Varve → OBS → niets, met jou) → stap 6 (als stand + `broadcast.toggle` + iPhone) →
stap 7 (setboek-module) → stap 8 (in-app naar buiten, alleen als OBS te zwaar is). Niet getest: OBS zelf,
Chrome's opname langer dan 14,6 s, CPU/warmte naast acht decks, een echte dienst, iCloud-upload tijdens
het schrijven.

**Keuzes.** U1a (de zin in CLAUDE.md: **ja**, zie VI1), U1b (Varve zelf naar een dienst: **nog niet**),
U2 (eerste echte route: **eigen werk eerst**, dan Mixcloud unlisted), U3 (iCloud: **nu (a) pauzeren,
straks (b) verhuizen** = VI2), volgorde stap 0 vóór 3–6: **ja**.

### 2.2 Companion (`scratchpad/uitwerking/companion/`, `docs/COMPANION.md` op de tak)

**Ontwerp.** iPad = de bibliotheek in je handen (vooral tussen avonden); iPhone = de blik in je zak (op
locatie zonder tweede scherm). Eén adres `/companion`, drie tabs **nu · kaart · beeld**; geen noodknoppen
op touch (19 tikken in 172 min, alleen bij testen, en ze raken de pc-beamer niet), geen intrekken van een
wens (niets verwijderen), geen YouTube-zoeken vanaf de iPad. De companion maakt nooit een AudioContext,
opent nooit MIDI, neemt nooit de Web Lock; een test loopt de hele importboom na.

**Gebouwd.** Stap 1 (#20): de pagina, de kaart compleet, "nu" en "beeld" eerlijk leeg; 4 regels in
`server/index.js`. Stap 2 (#25): de mixer meldt zich elke 900 ms (`POST /api/mixer`, 6 regels in
`app.js`), de telefoon leest (`GET /api/mixer`): A "nog 49:59", BEVRIES aan · MASTER 80 %, "mixer meldt
zich niet" na ~4,3 s. 390×844, 1024×768, 768×1024 in headless Chromium met echte aanraking: geen zijwaarts
scrollen, tikdoelen ≥ 44 px, ~2,0 s laden bij 200 ms vertraging. Wenslijst-peiling licht (`?licht=1`,
ETag/304). Review 1 vond één echte bug (haal nu haalde ook buiten de wenslijst: tot 20 extra downloads),
opgelost met `alleenWensen`.

**Verdieping (Tailscale, broncode v1.102.3).** `tailscale serve` geeft de Host door zoals de client hem
stuurt (dus `VARVE_HOSTS` is nodig) en zet **altijd** `X-Forwarded-For`; een tailnet-apparaat kán de Host
vervalsen naar `localhost:8777` (serve routeert op SNI), dus de `x-forwarded-for`-controle in `vanDezeMac`
is dragend, niet extra; hij houdt. **Hotspot zonder internet: koude start werkt waarschijnlijk niet**
(peer-adressen komen van control/DERP; iOS zet de hotspot niet eens aan zonder data). `zsh -lc` leest
`~/.zprofile` (bewezen), niet `~/.zshrc`. Thuis gaat Mac↔iPhone direct over het LAN (gemeten).

**Open.** Deel (b) van stap 2 (één keer `index.html` headless die echt post) vóór #25; iOS Safari zelf
(geen WebKit in de repo); een echte serve-meting (eerst naar een proefserver op 8790); de ACL vóór serve
(anders staat de hele server open voor de tailnet, ook `POST /api/ingest`); twee kleine verbeteringen
uit de verdieping (ook `x-forwarded-host`/`-proto` afwijzen; testgeval vervalste Host).

**Keuzes.** Wees stoppen (**ja**), haal nu alleen de wenslijst (**ja**), #20 op de eerste dag zonder set
en #25 na deel (b) en na de verwerking van vanavond, Tailscale instellen dezelfde dag als #20 (**ACL
eerst**), noodknoppen op touch (**nee, tot je ze mist**), beeldhand op de iPad (**nog niet beslissen**),
één adres `/companion` (**ja**).

### 2.3 Beeld op één machine (`scratchpad/uitwerking/beeld-een-machine/`, `docs/BEELD.md` §8, `docs/BEAMER.md` "Zaalbeeld")

**Ontwerp.** Omgedraaid ten opzichte van de opdracht: **zaalbeeld als standaard** (Varve's eigen
vormlagen in het losse beamervenster, zonder de clips van anderen, met werkende zwart-knop, in de
opname), **de Stroommachine op de Mac als upgrade** na een groene meting naast Varve én een speelproef.
Reden: jouw logs (4.576 vorm/fx-acties, 0 Stroommachine), rechten (clips van anderen alleen thuis), en
de zwart-knop en de opname bereiken de Stroommachine niet.

**Gebouwd.** Knop **CLIPS** (`video.clips`, standaard aan, koppelbaar, in het log); knopjes "deze Mac ·
pc" in de BEELD-rij (`ws://127.0.0.1:7702/app` ↔ `ws://clayk:7702/app`); `tools/beeld-lokaal.sh` (start
relay + Stroommachine in een eigen Chrome-bundel `~/Applications/Stroommachine-Chrome.app`; alleen
droog getest); `tools/headless/beeld-lokaal.mjs` (meet fps, CPU, warmte en **gaten in het geluid** met
een hartslag-worklet; alleen de zelftest gedraaid). De haalbaar-criticus bewees dat twee van drie meters
in de eerste ontwerpen stuk waren (fps vast op 60; gatenmeter zag 0 van 12 gaten): zonder die kritiek had
de meting "alles goed" gezegd.

**Verdieping (Licht-1080 alleen).** 1920×1080 dpr 1, Licht vast (1152×648): **p50 59,9 / p10 59,9 fps,
0 beelden > 20 ms, ~0,23 kern**. Normaal en Auto op 1080p zitten op de rand (15–30 % gemiste beelden in
twee van drie runs; Auto blijft in Normaal hangen). Dus: lokaal **Licht én vast**, en de 14-minuten-meting
kan korter (`nul`, `licht-1080`, `samen`, `licht-720`). Het plafond is niet het probleem; de combinatie
met Varve blijft de beslissende meting.

**Open.** De volledige meting naast Varve (klep open, wees weg, geen muziek); het startscript echt
starten; de VARVE.app-toets met twee Chrome-bundels; speelproef 2 × 10 min (zaalbeeld, dan Stroommachine);
Dock-app "VARVE + beeld"; stand `onderweg-licht` in standen (`5-voorstel-standen.md`); voorstellen aan de
Stroommachine-repo (echte fps in `beeld-status`, Auto-drempel, `resize()` zonder `build()`, v10
samenvoegen). Bijvangst op `main`: `VideoMixer` zonder WebGL2 met `?vormen=1` crasht (`this.beeldlagen`
na de WebGL-return); `.btn.warn.on` contrast ≈ 1,05.

**Keuzes.** BE12 (**zaalbeeld standaard**, Stroommachine als upgrade, "beide in één beeld" als eindbeeld),
BE11 (meetlat: p50 ≥ 55, p10 ≥ 30, 0 gaten > 15 ms, < 1 kern; **beslis met je oren**), BE13 (welke
beamer, HDMI-pad, PD-lader ≥ 30 W), BE14 (standaarden: **alles zo**, met (d) aangescherpt tot Licht + vast).

### 2.4 Crossover (`scratchpad/uitwerking/crossover/`, `docs/INSTRUMENTEN.md` "Uit de sampler", `docs/MASCHINE.md` §5f)

**Ontwerp.** De kleinste schakel die de kringloop sluit: **een knip uit de sampler met één druk op een
drumpad van de Drums**. Daarmee krijgt de knip voor het eerst een strip (fader, filter, echo, galm, fx,
cue), speelt hij in een patroon op de maat, en sla je hem op de Maschine aan op dezelfde fysieke pad als
waar je hem knipte (S1–S4 → drumpad 13–16, S5–S8 → 9–12). One-shot op het eigen tempo (geen tijdrek;
loops blijven in de sampler); de melding waarschuwt boven 0,5 % tempoverschil. Geen bounce naar de
library (B's richting, ~50 uur, schrijft in je library en normaliseert naar −14 LUFS).

**Gebouwd.** Acties `sampler.1.drums … sampler.8.drums`, acht schermknoppen `1→13 … 8→12`, lampjes,
meldingen; geen vaste APC/Maschine-knop. Gemeten (offline, zonder oren): correlatie 0,99936 met hetzelfde
stuk op een deck, fader dicht −104 dBFS, patroon 0,000 ms van de tellen, PFL koptelefoon −24 dB / zaal
−97 dB, kopie van 90 s in 3,0 ms, 0 px overloop op 1440×900. Proefblok "Avond 2 · Crossover" (5 punten) in
`src/controle/speellijst.js`.

**Verdieping (gestreamd nummer met stems).** 21/21 groen: `laadStream` op `stems.wav` (8 kanalen) →
kills → knip → `sampler.1.drums` → melding *"S1 staat op drumpad 13 van track 8 (noot C3 · 48) · stems:
drums"*; andere stems ≥ 62,9 dB lager; knip 4,06 ms. **Nieuw:** het niveauverschil is **+5,1 dB** met de
crossfader in het midden (track 1 op A ×0,707, Drums op thru ×1), +2,1 dB met beide op dezelfde kant.
Geen fout; wel iets om bij `cx-strip` te weten (NIVEAU 0,8 → ~0,55, of track 8 op kant A).

**Open.** Niemand heeft het gehoord; niet op de Maschine/APC; stap 2 (drumpads bewaren bij de set,
2–2,5 dagen); stap 3a (eigen opname naar de library met de bestaande CLI, geen code); stap 3b (knop +
route, alleen na CX3); stap 4 (bevriezen met eigen stems en grid, ~50 uur).

**Keuzes.** CX4 (wanneer mergen → proef op avond 2 of 3; volgt keuze 1 van het verbeterplan 9 okt),
CX1 (welke Drums: **zo laten**), CX2 (bewaren: **na de proef**), CX3 (eigen opnames naar de library:
**3a proberen, 3b niet zonder je ja** = VI1), CX5 (leegmaken: **zo laten**), K4 (+5,1 dB: **zo laten,
knop**), K10 (welke pad na de proef: **learn, nooit SHIFT + pad in SAMPLING**).

### 2.5 Standen (`scratchpad/uitwerking/standen/`, `docs/STANDEN.md` op de tak)

**Ontwerp.** Een **opstelling** is één klein JSON-bestand per situatie met beginwaarden voor `nacht`
(alleen remmen), `mapping`, `kaart` (krat), `master` (sjabloon), `hub` (set + mixer via de hub), `pakket`
(avondpakket-profiel). Drie harde afspraken: een opstelling is een startpunt, geen slot; zet nooit iets
aan dat geluid, opname of download start; gooit nooit iets weg (versies, "vorige terugzetten", geen
verwijderknop). Het label is **"Opstelling"** (het woord "stand" betekent in VARVE al zes dingen). Geen
opstelling per pijler ("produceren" zou DJ'en en produceren twee modi maken: tegen de crossover).

**Gebouwd.** Schema 1, vier voorbeelden met **dezelfde namen als de avondpakket-profielen** (`apc`,
`alles`, `maschine`, `laptop`), `/api/standen` (lijst, lezen, opslaan met 409, activeer, verschil,
vastleggen, terug, keuzes), tegel in de Controlekamer met bewerker (keuzelijsten, "bewaar als", "leg vast")
en "mixer openen" via de hub als de opstelling dat zegt, CLI `tools/standen/activeer.mjs`. Rooktest met een
kopie van je echte mapping (4 regels bleven staan) en de echte proefkrat. Review 1 vond drie fouten die er
anders in hadden gezeten, waarvan één gevaarlijk: pollen op een iCloud-bestand dat "niet lokaal" is kon
alle vier de leesdraden van de server vastzetten (stilte midden in een set); nu hooguit twee draden. Plus
een fix in `server/nacht.js` ("vannacht niet" vóór 12:00 remde niet) die ook jouw kaartknop raakt.

**Verdieping (VARVE.app met argument).** `open -a VARVE --args apc` komt aan (niet in `argv`, wel via
`ps -o args= -p $PPID`, 7/7); de droplet (`apc.json` op het icoon) werkt (`on open`); beide in één applet
gaan samen. **Dus één VARVE.app met drie ingangen** (Dock-klik, argument, slepen); geen Dock-icoon per
opstelling. Stap S en H (de hub kan `open -a VARVE --args alles` doen) worden één kleine stap. Alles in
`try` met `display notification`: een onopgevangen fout opent een modaal venster en het applet hangt.

**Open.** Master-rack in de mixer (nul keer bediend in 30.478 handelingen: uitgesteld), kaart opent nog
niet op de krat, hub-set wordt genoemd, niet gestart; beeld/koptelefoon/vormen "stap K"; mapping uit een
opstelling geldt bij de volgende mixerstart (uit de code afgeleid); **herstelronde 2 is niet door een
derde review nagekeken**; `server/kaart.js` leest `varve-kaart.json` (~10 MB in iCloud) synchroon
(gemeld aan kaart-brug/draagbaar).

**Keuzes.** Label (**Opstelling**), één tegel "Vanavond" of twee (**eerst twee**, VI9), voorbeeldwaarden
(**laten tot na de proef**), `apc` je 4 mapping-regels vasthouden (**ja, één keer "leg vast"**), VARVE.app
(**droplet + argument**), speellijstpunten (**niets tot na avond 2**), schema 2 (**wacht**), activering in
het log (**ja, stap M**), mergen (**na §2 proberen en een derde review**).

### 2.6 Draagbaar (`scratchpad/uitwerking/draagbaar/`, `docs/AVONDPAKKET.md` op de tak)

**Ontwerp.** Het **avondpakket**: één controle die thuis ("kan ik met deze tas vertrekken?") en ter plekke
("kan ik hier beginnen?") dezelfde vraag beantwoordt. Kijkt, repareert niets, schrijft niets, meet nooit
terwijl er een deck speelt. Profiel + fase (vertrek/aankomst, `auto`): "geen Maschine" is rood op avond 2
en normaal op avond 1. Onbekend is nooit rood; vals groen bestaat ook niet. Paklijst en kan/kan-niet
per profiel als data.

**Gebouwd.** `server/avondpakket.js` (847 regels puur), `avondpakket-meet.js` (sondes met time-out,
cache 10 s, bevriezing bij een spelend deck), `avondpakket/profielen.json`, `GET /api/avondpakket`, tegel
+ uitklapblok, CLI (exit 0/1/2/3), 362 eigen checks. Echte metingen (alleen lezen): CLI zonder server
0,2 s; route 211–377 ms, uit cache 31–55 ms; 122 GiB vrij, accu 78 %/591 cycli, 8 W-lader, "Optimaliseer
Mac-opslag" aan, 0 van 131 mediabestanden uitgeplaatst. `system_profiler SPUSBDataType` is op jouw macOS
altijd leeg (jury, gemeten); `SPUSBHostDataType` + `ioreg` in plaats daarvan. **Welke velden een echte
APC daar heeft, heeft niemand gezien**: fixtures zijn handgemaakt, `hardwareBevestigd: false`, PR in draft.

**Verdieping (iCloud end-to-end).** Uitplaatsen (`NSFileManager.evictUbiquitousItemAtURL`, wat de Finder
doet; `brctl evict` bestaat niet op macOS 27.0.1) → vlag `dataless` binnen 60 ms; `find -flags +dataless`
ziet het, leest niets, haalt niets binnen. **Lezen laat de server wel hangen**: `open()` meteen, de eerste
`read()` blokkeert tot het hele bestand binnen is (een Range van 64 KB aan het eind haalt 3,9 GB);
`stream.destroy()` breekt dat niet af; vanaf vier open lezingen wacht elke `fs`-aanroep (gemeten 1,6–2,1 s
uit de lokale cache; over het netwerk ~5 min voor `stems.wav`, zonder internet nooit). Vlag `0x40` op
`library.db` is `UF_TRACKED`, onschuldig. De `find`-sondes halen de grens van 2 s met een factor 1000.
Voorstel buiten dit spoor: `statisch()` geeft bij `blocks === 0 && size > 0` een 503 "bestand staat in
iCloud" in plaats van te streamen.

**Open.** 7a (morgenochtend, 10 min, apparaten nog aangesloten: echte `system_profiler`/`ioreg`-uitvoer
vastleggen en anonimiseren), 7b (met jou, ~1 uur: elk apparaat uittrekken; één bestand uitplaatsen), review
3 (één punt ligt al klaar: "aankomst" kiezen bij een spelend deck kan groen "klaar" geven met alles grijs),
stap 8 (mixer meldt zijn kanalen), 9 (ritueel op de iPhone), 10 (sonde reiskopie). **Het grootste risico zit
niet in de code: geen Time Machine, geen externe schijf; `media/` (32 GB) staat alleen op deze Mac plus
iCloud (dat ook wissen synchroniseert).**

**Keuzes.** Speaker/koptelefoon (**bedraad, allebei**), PD-hub (**kijk op je hub; anders ~30–50 euro**),
kopie buiten de laptop (**ja, snel**: externe SSD, `VARVE_BACKUPS` erheen, `rsync` van `media/` vóór elke
reis), `media/` buiten iCloud (**ja** = VI2), "de speellijst" = het plan/de krat van de avond, fase `auto`
houden, Tailscale serve na de proefavonden (= companion keuze 4), 7a door een agent (**ja**), stap 8 na 7b.

### 2.7 Produceren-uit (`scratchpad/uitwerking/produceren-uit/`, `docs/PATRONEN.md` §8, `tools/setboek/LEESMIJ.md`)

**Ontwerp.** De brug naar Logic in de richting die het minste kost: **bestanden**. Varve schrijft een
MIDI-bestand, Logic leest het; Logic bounct, Varve leest (de terugweg bestaat al: slepen op het
library-paneel of `tools/lokaal/importeer.mjs`). De MIDI-export dient een gebruik dat er nog niet is (geen
patroonactie in de top 40 van 56.743 handelingen), dus knop en route wachten. Het **setboek** heeft wél
direct nut: na elke set wat er echt klonk, volgens dezelfde `faderGain`/`xfaderGains`/`klinkt` als de
engine (fader × crossfaderkant × trim boven −30 dB, EQ niet helemaal weg, stems niet allemaal dicht,
master open; < 20 s telt niet; gaten < 5 s gelijmd), met de positie in de bron ("jungle-mix 30:47–39:27").

**Gebouwd.** `src/lib/smf.js`, `src/export/patronen-smf.js` (buiten `src/engine/`, met een test dat de
engine geen MIDI-bytes bevat), `tools/patronen/midi.mjs`, `tools/setboek/{lees,gebruik,setboek}.mjs`, drie
gouden `.mid`-fixtures; 3000 willekeurige sets bytegewijs gelijk aan een onafhankelijke tweede exporter;
rondreis met meta 500/500 exact; Python-mido leest alles. Engine, bus, mapping, log, scherm, server:
onaangeroerd. Drumpads niet naar General MIDI vertaald (eerst zien wat Logic doet); noot 44–51 nooit
vertaald (dat zijn de sample-pads van crossover).

**Verdieping (18 echte logs).** 17 runs, 17× exit 0, 0 crashes; 6 okt met `--vanaf 17:00` = exact de
telling van 9 okt (21.916 acties, 57 laads, 70 actieve minuten); 28 hoorbare stukken; Unicode-titels
heel. **Het setboek draait morgen zonder reparatie.** Vijf leesbaarheidspunten (B5: "niet hoorbaar" zegt
niet waarom, zoals 12 auto-DJ-nummers met master op 0,02; B3: wie handelde, Clay of de auto-DJ; B2
laad-salvo's; B4 hotcue-gehamer; B1 `--db` zet `-shm/-wal` naast de kopie). Gratis inzicht voor het
auto-spoor: op 6 okt koos de automaat drie keer hetzelfde fragment en liep 36 min door met de master dicht.

**Open.** Logic niet gestart (tempo-import, kanaal 10, klank van 36–39, `varve:patroon`-tekst, markers,
48 kHz-WAV); route `GET /api/patronen/<naam>/midi` (~2 u, na de proefavond); knop `.mid` (na stap 0 én een
patroon); markers (pas als de offset log → WAV gemeten is); stems als losse WAV's naar `~/Music/Logic/Varve/`;
etiket "eigen/van Logic" (library-spoor I72).

**Keuzes.** K-A (Logic-proef: **ja, eerste rustige dag, 10 min**), K-B (setboek lezen: **morgen**; elke
afwijking wordt een test), K-C (knop: **pas na stap 0 en een patroon**), K-D (CLAUDE.md-zin: **ja** = VI1),
K-E (Logic-richting: **C8 opnemen en nabewerken**, geen Ableton Link), K-F (mergen: **na K-B**, B1 in de
LEESMIJ).

---

## 3. Hoe de sporen elkaar raken

### 3.1 De draagbare set: standen × draagbaar × companion × uitzenden × beeld

Dit is één keten, en de sporen hebben dat vandaag al gezien en op elkaar afgestemd zonder elkaar live te
spreken:

- **Standen en draagbaar delen de vier namen** `laptop`, `apc`, `maschine`, `alles`. Een opstelling noemt
  zijn avondpakket-profiel (`pakket`); de avondpakket-tegel zou het profiel van de actieve opstelling
  overnemen, en `standen/` hoort in de "is alles lokaal"-controle. Twee lijsten met situaties zou het
  juist méér verspreid maken. Niemand van beide sporen heeft de ander bevestigd: dat is werk voor de
  integrator (één tak, twee tegels naast elkaar, later misschien één tegel "Vanavond", VI9).
- **Beeld levert aan standen** de stand `onderweg-licht` (vormen aan, clips uit, beeld uit): dan is
  "onderweg" één klik in plaats van zeven handelingen. Standen heeft `beeld.aan` bewust overgeslagen tot
  beeld zijn proef heeft gehad.
- **Beeld levert aan uitzenden** de schakelaar die G8 vraagt: pas als de clips gedoofd kunnen worden
  (`video.clips` uit) mag beeld naar buiten. De CLIPS-knop is dus niet alleen een zaalbeeld-knop maar de
  voorwaarde voor elk beeld-doel buiten 127.0.0.1. Uitzenden moet daar straks op controleren (de server
  kan niet zien wat er op het canvas staat; de stand van `video.clips` komt wel in het log en in de
  mixer-melding van companion stap 2).
- **Uitzenden levert aan standen** de doelkeuze als stand (geen nieuwe elementen in een bovenbalk die al
  12 px te smal is) en aan companion één regel "uitzending: aan/uit" op de iPhone, met `broadcast.toggle`.
  Omgekeerd geeft companion de iPhone via OBS (Continuity Camera) een echte eigen rol in de uitzending.
- **Draagbaar en companion delen Tailscale**: draagbaar keuze 8 = companion keuze 4 (serve + `VARVE_HOSTS`
  in `~/.zprofile`, ACL eerst, nooit Funnel). De verdieping van companion zet daar een voorwaarde bij die
  de visie raakt: **"vanaf elke plek streamen" betekent in de praktijk "de iPhone heeft data"**. Zonder
  internet werkt de companion niet via Tailscale (koude start); wil je dat toch, dan is het LAN zelf
  (`VARVE_BIND` op het hotspot-adres) een eigen klein spoor.
- **iCloud raakt vier sporen tegelijk**: draagbaar (uitgeplaatst `stems.wav` laat de server hangen),
  uitzenden (de groeiende opname wil omhoog over dezelfde hotspot, ~8,6 GB per set van 2 uur),
  standen (pollen op een niet-lokaal standbestand kon de leesdraden vastzetten; nu begrensd) en
  produceren-uit (`opnames/` staat in iCloud; het setboek schrijft daarom standaard naar het scherm).
  Eén keuze (VI2) lost drie van de vier op.
- **Stroom en poorten** komen uit draagbaar én beeld: twee USB-C-poorten, lader + Scarlett + APC = drie
  stekkers, dus een PD-hub; en de beamer op 60 Hz (thuis viel 75 Hz via de hub zwart).

### 3.2 De crossover: crossover × produceren-uit (× uitzenden × standen)

- **Dezelfde noten, twee kanten op.** Crossover zet knips op drumpad 9–16 (noot 44–51); produceren-uit
  vertaalt die noten bewust nooit naar MIDI (dat zijn stukken uit een deck, geen klank die Logic kent).
  Zodra crossover stap 2 (drumpads bewaren bij de set) er is, kan de MIDI-export de knip als tekst meenemen
  (`varve:patroon` kent al zo'n metablok), en kan een "kit-pakket" (MIDI + de padstukken als WAV) Logic laten
  klinken zoals Varve. Nu nog niet: eerst de Logic-proef (K-A).
- **Dezelfde terugweg.** Crossover stap 3a ("eigen opname naar de library") en produceren-uit's "Logic-bounce
  terug" zijn letterlijk dezelfde opdracht: `tools/lokaal/importeer.mjs` (of slepen op het library-paneel),
  stems op 0, minstens 20 s, nooit op een speeldag. Crossover stap 4 (bevriezen met eigen stems en exact
  grid) is wat produceren-uit "B's partituur" noemde; beide sporen zetten het achter dezelfde poort: CX3 en
  K-D, dus VI1.
- **Het setboek ziet de crossover nog niet als klank.** Sampler, instrumenten en patronen staan in het
  setboek als "wat het log niet ziet". Dat is eerlijk; het betekent ook dat een eigen-werk-sessie (de eerste
  uitzending die U2 aanbeveelt) in het setboek alleen als handelingen verschijnt, niet als tracklist. Voor
  Buma/Stemra is dat juist goed (eigen werk), voor jouw terugblik niet. Een later veld "instrument/knip" in
  het setboek hoort bij produceren-uit, na K-B.
- **Setboek × uitzenden.** De rechtenverdieping vraagt het setboek om een Mixcloud-telling (met de correctie
  "≤ 2 per release achter elkaar"), een kolom "in Twitch DJ-catalogus?" en een exportknop in Mixcloud's
  plakformaat ("Artist - Title - HH:MM:SS"). Dat is uitzenden stap 7 en produceren-uit's B-lijst: één
  module, één tak, na K-B.
- **Standen bewaart géén pijler-modus** en dat is de bewuste keuze van de crossover: DJ'en, produceren en
  programmeren blijven altijd alle drie beschikbaar; een opstelling verbergt nooit een paneel. De crossover
  heeft dus geen opstelling nodig; wat hij nodig heeft is dat de Drums op track 8 en het nummer op track 1
  kunnen staan zoals het proefblok zegt, en dat is een krat/plan, geen stand.

### 3.3 Wat alle zeven sporen gemeen hebben

- **Dezelfde ene zin in `CLAUDE.md`** (r. 29–31, "geen deelfuncties, geen publieke streaming, geen upload"):
  uitzenden (U1a), produceren-uit (K-D) en crossover (CX3) vragen dezelfde verduidelijking. Dat hoort in één
  PR, niet in drie takken (VI1).
- **Dezelfde afwijking in de commits**: alle takken eindigen op `Co-Authored-By: Claude Opus 5.5` (het model
  dat de commits schreef; de harness-regel woog zwaarder dan de scripttekst). Alle spoorleiders adviseren
  "laten staan" (VI4).
- **Dezelfde werkregels, allemaal nagekomen**: eigen worktree, eigen poort, kopie van de library, nep-yt-dlp,
  niets gemerged, harde eindtijd 17:00 voor CPU-werk, nooit `pkill`, niets verwijderd.
- **Dezelfde eerlijkheid**: elk rapport eindigt met "niet getest", en bij alle zeven staat bovenaan: **niet
  op de hardware geproefd** (VISIE §5.4). Daarom zijn alle PR's "[na de proefavond]".
- **Conflicten tussen de acht takken**: uitzenden mat droog dat #24 zonder conflict mergt met de zeven
  andere; standen meldt een klein conflict in `server/nacht.js` (fix 7c) met kaart-brug; companion stap 2 en
  draagbaar raken allebei `server/index.js` (companion 4 regels + wenslijst-route; draagbaar +31). Dat is
  werk voor de integrator na de proefavond, in de volgorde van §4.

---

## 4. Roadmap-volgorde NA de proefavond (voorstel)

Het ritme uit VISIE §5.4 en `docs/HANDOFF.md`: **eerst de proefuitkomst verwerken, dan bouwen.** Daarom
staat hieronder de verwerking van avond 1 vóór elke merge, en elke merge vóór zijn eigen proef. Per stap:
waarom, wat het jou oplevert, en de toets aan VISIE §5 (1 pijler · 2 draagbaar · 3 zelf instellen · 4 op
de hardware geproefd).

| # | Stap | Waarom nu | Wat het jou oplevert | VISIE §5 |
|---|---|---|---|---|
| **0** | **Avond 1 verwerken** (de ochtend erna): wat ging fout op de APC, in de Scarlett/koptelefoon, in de kaart; het verbeterplan van 9 okt. Tegelijk **7a** (draagbaar: echte `system_profiler`/`ioreg`-uitvoer vastleggen vóór je de stekkers eruit trekt; een agent, alleen lezen) en **het setboek van avond 1** (produceren-uit K-B, op een kopie van de logs, uitvoer op het scherm). | Dit is de eerste echte hardware-proef sinds 23 sep (ruim 500 commits). Alles hierna hangt ervan af. 7a en het setboek kosten samen 15 min en vragen geen merge. | Een tracklist van je eerste avond, de eerste echte hardware-fixtures, en de lijst reparaties die vóór al het nieuwe gaan. | 4 (eindelijk), 1 |
| **1** | **De drie keuzes die alles ontgrendelen**: VI1 (de zin in CLAUDE.md), VI2 (`media/` en opnames buiten iCloud + een kopie buiten de laptop), VI3 (merge-ritme). | Zonder VI1 kunnen uitzenden stap 3, produceren-uit K-D en crossover 3a niet eerlijk gemerged worden. Zonder VI2 rekent elke reis-set op iCloud dat het stil kan slopen. | Drie zinnen van jou; daarna hoeft geen agent meer om te stilstaan. | 2, 3 |
| **2** | **Lichte, additieve merges naar `studio/integratie`** (eerste dag zonder set, na stap 0): **#22** produceren-uit (nieuwe bestanden ernaast; B1 in de LEESMIJ), **#20** companion stap 1 (raakt de mixer niet), **#23** beeld (CLIPS; eerst één groene `zaalbeeld.mjs` met de klep open), **#24** uitzenden (na M1; nog zonder route). | Vier takken die het live-pad niet raken en elk twee reviews hebben. Hoe langer ze open staan, hoe meer conflicten met kaart/secties. | Setboek na elke set; de iPad als bibliotheek; de CLIPS-knop; de uitzend-module klaar voor stap 3. | 1, 3 |
| **3** | **Metingen die een rustige machine vragen** (zelfde dag of de dag erna, niet tussen 18:00 en een proefavond): beeld 14 min (`nul`, `licht-1080`, `samen`, `licht-720`), uitzenden stap 2 (headless Chrome 10 min), standen een derde review van herstelronde 2, companion deel (b). | Elk hiervan is "de beslissende meting" van zijn spoor, en vandaag geblokkeerd door de proefavond, de dichte klep en de wees. | Het antwoord op "Stroommachine op de Mac: ja/nee", "blijft de uitzending bij", "is standen merge-klaar". | 4 (headless) |
| **4** | **Standen en draagbaar samen** mergen (**#21** na review 3, **#19** na 7a; 7b met jou ~1 uur), dan één keer "leg vast" op `apc`, de twee tegels naast elkaar, en op een rustige dag VARVE.app herbouwen als droplet + argument (proefbouw naar een tijdelijk doel, proefserver op 8790). | Dit is pijler 4 in de praktijk: "precies zo instellen hoe ik het voor dat moment nodig heb" zonder code, en de checklist die de tas controleert. Samen zijn ze het verschil tussen "aankomen en beginnen" en "aankomen en zoeken". | Eén klik voor "avond met APC", "avond via de hub", "alleen laptop"; groen/oranje/rood vóór vertrek; je indeling terug als Chrome zijn opslag kwijt is. | 3, 2 |
| **5** | **Tailscale eenmalig** (companion keuze 4 = draagbaar keuze 8), nooit op een speeldag: iPad in de tailnet, ACL (geen `tag:*`), `tailscale serve --bg 8777`, `VARVE_HOSTS` in `~/.zprofile`; eerst een meting naar een proefserver op 8790 die zijn koppen logt; key expiry nakijken. Daarna **#25** (companion stap 2) en het proefblok ≤ 15 min (thuis-wifi, hotspot mét data, dan data weg). | Zonder dit doet de companion niets buiten de Mac. De verdieping heeft de aannames nagekeken (serve-koppen, `.zprofile`); wat rest is de echte meting. | iPhone in je zak met "nog 3:10" per track, iPad op de bank met de kaart. | 2 (met de voorwaarde: data) |
| **6** | **Avond 2** (via de hub, opstelling `alles`): koptelefoon/Scarlett-check uit het avondpakket; beeld-speelproef 2 × 10 min (zaalbeeld, dan Stroommachine op de Mac als stap 3 groen was); **uitzenden stap 0: één hele set opnemen met beeld (≥ 45 min)**; crossover-proefblok als CX4 "nee" is (anders avond 3). | Avond 2 is de eerste avond met Maschine en hub, en de eerste opname langer dan 5,6 min. Drie sporen hebben hun proef hieraan gehangen. | Het eerste echte oordeel over beeld zonder pc, een opname waar uitzenden mee verder kan, en de knip-als-drumpad in de vingers. | 4, 1 |
| **7** | **Uitzenden stap 3–6** na stap 0: routes, bediening als stand + `broadcast.toggle` + de regel op de iPhone, de **thuisproef Varve → OBS → (nog) niets** (20 min, jij erbij, `apple_h264` 1280×720 30 fps), dan pas U1b/U2 beslissen met de rechtenfeiten erbij: **eigen-werk-sessie eerst** (klankschaal, instrumenten, sampler, patronen, je eigen vormen; precies de crossover), daarna Mixcloud Live unlisted (€ 11, één maand), daarna Twitch DJ Program (nooit audio-only). | De route via OBS is de goedkoopste en veiligste; of OBS op de Air te zwaar is weet je pas na de thuisproef. De eigen-werk-sessie heeft geen rechtenzorg. | "Streamen: niets" in VISIE §3 wordt "streamen: lokaal bewezen, via OBS geproefd, eerste uitzending gepland". | 2 (OBS staat er al), 1 |
| **8** | **Crossover en produceren-uit verdiepen** na hun proeven: crossover stap 2 (bewaren bij de set) als je ze na herladen miste; 3a (één CLI-opdracht, een eigen opname in de library) na VI1; de Logic-proef (K-A, 10 min, zeven vragen); daarna route + knop `.mid` (K-C) als er een patroon is; de setboek-leesbaarheid B5/B3 (~2 u) en de Mixcloud/Twitch-kolommen (uitzenden stap 7). | Dit is de crossover-kern van de visie (pijler 2 en 3), maar hij vraagt eerst gebruik: je hebt nog geen patroon dat naar Logic moet, en sinds 30 sep niets opgenomen. | Eén nummer tegelijk mixen, knippen, programmeren en bespelen, en wat je maakt landt in Logic en komt terug als eigen nummer. | 1 (pijler 2–3), 3 |
| **9** | **De richtingen B** (allemaal pas na een speelproef die erom vraagt): Stroommachine ín Varve's beamervenster (één zwart-knop, in de opname; eerst een meetspike van de hoofdthread); de beeldhand op de iPad (`video.layer.*`, 9 % van je acties; vraagt sneller transport dan één peiling per seconde); live wisselen van opstelling; crossover stap 4 (bevriezen met eigen stems en grid); uitzenden in-app naar een dienst (alleen als OBS te zwaar blijkt); stap 8–10 van draagbaar. | Elk hiervan raakt het live-pad of de hoofdthread. De jury's kozen overal A als eerste stap en B als richting; de proeven in stap 6–8 zeggen welke B het eerst verdiend is. | Het eindbeeld van VISIE §3, maar pas als de kleine versie bewezen is. | 4 (eerst), dan 1–3 |

**Wat de volgorde niet is:** een belofte van dagen. Stap 0–2 passen in de eerste twee dagen na de
proefavond, stap 3–5 in de week erna, stap 6 is avond 2, stap 7–8 de weken daarna, stap 9 heeft geen
datum. AV-kern (ROADMAP: "tot 25 oktober gaat AV-kern voor") staat er los van; deze lijst is wat er
gebeurt op de dagen dat Varve aan de beurt is.

**Toets van de hele lijst aan VISIE §5:**
1. Elke stap dient minstens één pijler en breekt er geen: engine, bus en de drie regels zijn in geen
   enkel spoor geraakt.
2. Niets voegt een tweede machine of een cloud toe; de enige nieuwe afhankelijkheden zijn OBS (staat er
   al), Tailscale (staat er al) en ffmpeg (staat er al). De twee dingen die de set zwaarder maakten, iCloud
   en een 8 W-lader, worden juist weggehaald.
3. Alles wat je instelt is data: opstellingen, profielen, doelen, kratten, paklijst, drumpad-toewijzing.
4. Geen enkele merge vóór zijn proef; geen enkele richting B vóór een speelproef die erom vraagt.

---

## 5. Keuzes voor Clay: blok VI (ook in `docs/VRAGEN.md`)

Legenda zoals in VRAGEN: 🎧 luisteren · 🎛 de APC erbij · 👀 kijken · 💬 alleen een keuze.

- [ ] **VI1. Eén zin in `CLAUDE.md` over uitgangen.** 💬 Drie sporen vragen dezelfde verduidelijking van
  "geen deelfuncties, geen publieke streaming, geen upload" (r. 29–31): *geen distributie van de cache; een
  uitgang (een bestand, 127.0.0.1, een export naar eigen schijf) is geen distributie en mag; eigen opnames
  en renders naar de eigen library mogen.* Dit opent niets naar buiten (het lokaal-slot van uitzenden blijft
  dicht tot U1b) en legt vast wat al zo is (de upload-route bestaat). **Advies: ja, in één aparte kleine PR,
  niet in drie takken.** Daarmee kunnen uitzenden stap 3, produceren-uit K-D en crossover 3a verder.
- [ ] **VI2. `media/` en de opnames buiten iCloud, en een kopie buiten de laptop.** 💬👀 Gemeten: een
  uitgeplaatst bestand laat de server bij de eerste lezing hangen tot het hele bestand binnen is (3,9 GB
  voor `stems.wav`; zonder internet nooit); "Optimaliseer Mac-opslag" staat aan, de schijf is 72 % vol, en
  iCloud is geen backup (het synchroniseert ook wissen). **Advies: ja, na de proefavond en vóór de eerste
  reis-set**: `VARVE_MEDIA` naar bijv. `~/Varve-media` (in VARVE.app en in de hub-set), `media/` verhuizen
  met `rsync -a` terwijl de server uit staat (`library.db` bewaart relatieve paden), `VARVE_BACKUPS` naar een
  externe SSD, en vóór elke reis een `rsync` van `media/`. Dit vervangt uitzenden U3(b) en draagbaar keuze 3+4.
- [ ] **VI3. Merge-ritme: wat na avond 1, wat na avond 2?** 💬 Keuze 1 van het verbeterplan (9 okt) zei:
  tot na avond 2 alleen repareren wat op de proefavond fout gaat. **Advies: houd dat voor alles wat het
  live-pad raakt (#21 standen, #25 companion stap 2, #26 crossover, de uitzend-routes), maar laat de vier
  additieve takken (#22, #20, #23, #24 zonder route) na de verwerking van avond 1 in `studio/integratie`**:
  ze raken de mixer niet, hebben elk twee reviews, en elke dag open kost conflicten. Zeg "nee" en alles
  wacht op avond 2; zeg "ja" en crossover (CX4) schuift ook naar avond 2.
- [ ] **VI4. De commit-trailers.** 💬 Alle acht takken eindigen op `Co-Authored-By: Claude Opus 5.5` in
  plaats van `Claude Fable 5.1`; het is het model dat de commits schreef. **Advies: laten staan.** Herschrijven
  kost een amend op ~70 commits en een force-push op acht takken en levert niets op.
- [ ] **VI5. Wat doet avond 2?** 🎛🎧 Kandidaten: via de hub met opstelling `alles`; beeld-speelproef
  zaalbeeld (en Stroommachine op de Mac als de meting groen is); uitzenden stap 0 (één hele set opnemen met
  beeld, ≥ 45 min); het crossover-proefblok (5 punten, ~8 min). **Advies: hub + avondpakket + zaalbeeld +
  de lange opname; de crossover op avond 2 alleen als VI3 "ja" is, anders avond 3.** Vier nieuwe dingen op
  één avond is het maximum; de speellijst is al van 33 naar 172 punten gegroeid.
- [ ] **VI6. De eerste echte uitzending.** 💬 Na de thuisproef via OBS: (1) een eigen-werk-sessie op je
  eigen kanaal (geen rechtenzorg; precies de crossover), (2) Mixcloud Live unlisted (€ 11 voor één maand,
  audio-only mag, een fout kost alleen een draft-show), (3) Twitch DJ Program (opt-in, NL ok, maar nooit
  audio-only of automatisch; alleen catalogusnummers). **Advies: in deze volgorde, en U1b (Varve zelf naar
  een dienst) pas beslissen als OBS op de Air te zwaar blijkt.** Geen juridisch advies; cijfers nagekeken op
  10 okt bij de bronnen.
- [ ] **VI7. Beeld onderweg = zaalbeeld.** 👀 Vormen aan, clips uit, Stroommachine uit, als stand
  `onderweg-licht` in standen; de Stroommachine op de Mac (Licht, vast, 1152×648) als upgrade na een groene
  meting naast Varve én een speelproef. **Advies: ja.** Je speelt je eigen beeld (4.576 acties); de clips van
  anderen mogen de zaal niet in; de zwart-knop en de opname werken alleen op het zaalbeeld.
- [ ] **VI8. "Vanaf elke plek" = de iPhone heeft data.** 💬 De companion via Tailscale werkt op een hotspot
  mét data en loopt waarschijnlijk door als de data wegvalt, maar een koude start zonder internet werkt
  waarschijnlijk niet (en iOS zet de hotspot niet aan zonder data). Alternatief: de server op het
  hotspot-adres laten luisteren (`VARVE_BIND`, klein spoor). **Advies: accepteer "data" als voorwaarde en
  bouw het LAN-pad pas als een locatie het echt vraagt.**
- [ ] **VI9. Eén tegel "Vanavond" of twee (Opstelling, Avondpakket)?** 💬 Beide sporen gebruiken dezelfde
  profielnamen. **Advies: eerst twee tegels (elk spoor mergt los), na avond 2 samenvoegen als je ze altijd
  samen gebruikt.** En het label blijft "Opstelling", niet "Stand".
- [ ] **VI10. De kernset onderweg en de spullen.** 💬👀 APC + Scarlett + bedrade koptelefoon + PD-hub +
  Apple-lader ≥ 30 W is de kleinste set voor een volledige set; Maschine en AV-hub pas na avond 2. Te checken:
  heeft je USB-C-hub stroomdoorvoer (PD-opdruk)? Welke beamer (BE13: model, 1080p, 60 Hz, HDMI-pad)?
  **Advies: kijk morgen op je hub; zo niet, een PD-hub van ~30–50 euro; beamer-gegevens doorgeven vóór de
  beeld-speelproef.**
- [ ] **VI11. Wie doet 7a morgenochtend?** 👀 Twee alleen-lezen-commando's met de APC en Scarlett nog
  aangesloten (`system_profiler SPAudioDataType SPUSBHostDataType -json`, `ioreg -p IOUSB …`), daarna
  anonimiseren (serienummers). **Advies: een agent, vóór je de stekkers eruit trekt.** Zonder 7a blijft het
  avondpakket op `hardwareBevestigd: false` en de PR in draft.
- [ ] **VI12. De richtingen B: welke het eerst?** 💬 Stroommachine ín Varve's beamer; beeldhand op de iPad;
  live wisselen van opstelling; bevriezen naar een nieuw nummer met eigen stems; in-app uitzenden. **Advies:
  nu geen; laat de speelproeven van stap 6–8 kiezen.** Mijn verwachting: de beeldhand op de iPad komt het
  eerst (het is 9 % van je acties), daarna bevriezen (de crossover-belofte).

---

## 6. De niet-lijst voor deze visie

Wat de sporen bewust **niet** doen, en waarom. Dit is geen wensenlijst voor later; het zijn grenzen die
de kern klein houden (VISIE §6).

**Nooit, zolang de visie staat**
- Geen distributie van de YouTube-cache: de server wordt nooit een openbare muziekbron. Uitzenden is een
  uitgang; het lokaal-slot en de regel in `CLAUDE.md` blijven. Geen Funnel, nooit.
- Geen beeld met clips van anderen naar buiten (G8); geen audio-only of automatische stream naar het Twitch
  DJ Program; geen muziek van anderen op een eigen server zonder Sena + Buma.
- Niets verwijderen: geen wens intrekken op touch, geen opstelling wissen, geen `.flv` opruimen, geen
  commits herschrijven voor cosmetiek, geen `pkill`/`killall`.
- Geen tweede machine, geen cloud-dienst, geen nieuwe dependency om iets draagbaarder te maken (OBS,
  Tailscale, ffmpeg en Logic staan er al).
- Geen opstelling die geluid, opname of download start; de nacht kan alleen geremd worden. Geen
  opstelling per pijler ("produceren-modus"): de crossover is de kern, geen stand.
- Geen headless mixer op de Air op een speeldag; geen CPU-zware run na 17:00 op een proefavond; geen
  hardware aansturen zonder Clay erbij.
- Geen merge door een agent; geen tak zonder "[na de proefavond]" tot de proef gedaan is.

**Niet nu (pas na de proef die erom vraagt)**
- Geen noodknoppen op touch; geen meters op de iPhone (één getal per seconde is geen meter); geen drie
  telefoonpagina's.
- Geen bounce naar de library vanuit de crossover (stap 3b/4) vóór CX3/VI1; geen General-MIDI-vertaling van
  de drumpads vóór de Logic-proef; geen `.mid`-knop vóór er een patroon is; geen markers vóór de offset
  log → WAV gemeten is; geen Ableton Link (C8 opnemen en nabewerken is de richting).
- Geen Stroommachine op de Mac in Normaal of Auto op 1080p (gemeten op de rand); geen `video.window` vanaf
  de APC (Chrome blokkeert het); geen Dock-app "VARVE + beeld" vóór het script één keer echt gedraaid heeft.
- Geen Dock-icoon per opstelling (vijf keer bouwen, vijf keer Automatisering toestaan); geen live wisselen
  van mapping in een draaiende mixer; geen master-rack via de opstelling tot je het ooit bediend hebt.
- Geen in-app uitzenden naar een dienst (stap 8) tenzij OBS op de Air te zwaar blijkt; geen iPhone-monitor
  via HLS; geen tekst op het stil-beeld (deze ffmpeg heeft geen `drawtext`; een png-plaat is data).
- Geen schema 2 voor opstellingen, geen nieuwe VRAGEN-blokken per spoor bovenop de ~100 open vragen zonder
  dat er eerst beslist is.

**Niet van deze sporen (wel gezien, doorgegeven)**
- `server/kaart.js` leest `varve-kaart.json` (~10 MB, in iCloud) synchroon: niet lokaal = hele server stil
  (kaart-brug).
- `statisch()` streamt een uitgeplaatst bestand en bezet een draad per lezing: een 503 "staat in iCloud" bij
  `blocks === 0` is een klein eigen spoor.
- Bug op `main`: `VideoMixer` zonder WebGL2 met `?vormen=1` crasht; `.btn.warn.on` is onleesbaar.
- Het auto-spoor: op 6 okt koos de automaat drie keer hetzelfde fragment en liep 36 minuten door met de
  master dicht (uit het setboek).
- Een externe backup bestaat niet: geen Time Machine, geen tweede schijf. Dat is VI2, en het is urgenter dan
  elk spoor.

---

## 7. Eerlijkheid: wat deze synthese wel en niet is

- **Nagekeken door mij:** de acht PR's bestaan, staan open, gaan naar `studio/integratie`, hebben
  "[na de proefavond]" in de titel en zijn niet gemerged (`gh pr list`, 16:35); `origin/main` =
  `origin/studio/integratie` = `a3c81a4`; `docs/VISIE.md` op `main` is byte voor byte de versie waaraan
  de sporen toetsten.
- **Niet door mij gedaan:** geen test gedraaid (ook `node test/alles.mjs` niet: deze tak raakt alleen
  `docs/`, `ROADMAP.md` en `CLAUDE.md`, en het is na 16:40 op een proefavond; de suite kost ~290 s CPU op
  de Air die vanavond speelt), geen code gelezen regel voor regel, geen server gestart, niets gemeten. Alle
  cijfers zijn van de agenten; waar zij "niet getest" schreven, staat dat hier ook.
- **Geen subagenten:** `ListAgents` gaf in deze sessie niets terug; de synthese is door één agent
  geschreven. De "aansturing" tussen agenten liep vandaag via de bestanden in `scratchpad/uitwerking/`.
- **Aannames die dit document draagt:** dat de spoorrapporten de reviews juist samenvatten (ik heb de reviews
  alleen via de rapporten en de verdiepingen gelezen, niet elk apart); dat `~/Movies` niet door iCloud
  gesynchroniseerd wordt (uitzenden, niet nagekeken); dat de acht takken samen mergen zoals uitzenden droog
  mat (één meting, op 15:00).

*Bronnen: `scratchpad/uitwerking/<spoor>/8-spoorrapport.md` en `9-verdieping*.md` voor uitzenden,
companion, beeld-een-machine, crossover, standen, draagbaar en produceren-uit; `docs/VISIE.md`; de
PR-teksten van #19–#26. Een kopie van dit bestand: `scratchpad/uitwerking/SYNTHESE.md`.*
