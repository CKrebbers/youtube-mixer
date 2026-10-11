# Uitwerking van de visie: zeven sporen (10 oktober 2026, aangevuld 11 oktober)

*Synthese, geschreven 10 okt 16:40–17:15 door de synthesizer-agent, uit de zeven spoorrapporten
(`8-spoorrapport.md`), de zeven verdiepingen (`9-verdieping*.md`) en, waar nodig, de definitieve
ontwerpen, bouwverslagen en reviews in `scratchpad/uitwerking/<spoor>/`. Getoetst aan `docs/VISIE.md` §5.
Ik heb zelf niets gebouwd, geen test gedraaid, geen server gestart en niets gemerged; alle cijfers komen
uit de verslagen van de agenten en de PR-teksten (door mij nagekeken via `gh pr list` om 16:35). Een
kopie staat in `scratchpad/uitwerking/SYNTHESE.md`. Eerlijkheidshalve: in deze sessie waren geen
subagenten beschikbaar (`ListAgents`: geen), dus de synthese is door één agent geschreven; "elkaar
aansturen" gebeurde vandaag via de bestanden in de spoormappen, niet live.*

> **Tweede ronde, 11 okt 13:00–14:30.** De volledigheidscriticus vond drie gaten; drie mini-sporen hebben ze
> uitgewerkt (`scratchpad/uitwerking/extra-1/`, `extra-2/`, `extra-3/`). Nieuw in dit document: §4b "Wat de
> sporen misten" (per mini-spoor het ontwerp in het kort en de plek in de volgorde van §4) en VI13–VI20 in
> §5. §0–§4 en VI1–VI12 zijn van 10 okt en ongewijzigd gelaten; waar de tweede ronde ze verandert, staat dat
> in §4b (vooral 4b.0: of proefavond 1 is doorgegaan is uit de bestanden niet op te maken). Ook deze ronde
> had geen subagenten: `ListAgents` toont één peer-sessie (Clay's eigen interactieve venster, idle), geen
> agent die ik mocht aansturen; de drie mini-sporen zijn door losse agenten vóór mij geschreven, de
> aansturing liep via de bestanden.

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

## 4b. Wat de sporen misten (tweede ronde, 11 oktober 13:00–14:00)

*De volledigheidscriticus legde de zeven sporen naast `docs/VISIE.md` en vond drie gaten die geen spoor
had: pijler 3 ("de klank zelf bouwen") en de deadline van av-kern; de controllers als tweede drager (VISIE
§2) en de hub die alles draagt maar nooit op hardware draaide; en het ontbreken van een kopie van het
instrument buiten deze laptop (§6 noemde het "urgenter dan elk spoor", niemand werkte het uit). Drie
mini-sporen (verkenner en ontwerper in één, elk ~40–60 minuten, niets gebouwd, niets gemerged, geen
hardware) staan in `scratchpad/uitwerking/extra-1/ontwerp.md`, `extra-2/ontwerp.md` en
`extra-3/ontwerp.md` met hun kladmappen. Hieronder per mini-spoor het ontwerp in het kort en de plek in de
volgorde van §4; de keuzes staan in §5 als VI13–VI20. Let op de datum: de mini-sporen zijn van 11 okt,
de dag ná proefavond 1, en gaan er niet van uit dat die avond gelukt is (zie 4b.0).*

### 4b.0 Eén feit dat vóór alles gaat: is proefavond 1 doorgegaan?

Twee mini-sporen keken onafhankelijk in de bestanden en zagen hetzelfde:

- Het enige handelingenlog van 10 okt (`opnames/set-20261010-190959.acties.jsonl`, 19:09–19:17, 430 s)
  bevat **5.539 handelingen, 100 % beeld** (`video.layer.knob.K` 3.598, `video.fx.pixel` 851, trails,
  grain, mirror, rgb), **acht tracks leeg**, geen `laad`, geen `focus`, geen enkele `track.*`- of
  mixer-handeling, `opname: null` (extra-2 §1.9). Dat is vormen en video-effecten draaien zonder muziek.
- `media/library.db` is sinds 8 okt 14:22 niet gewijzigd (`laatst_geladen` 8 okt; de WAL heeft die mtime);
  geen WAV van 10 okt in `opnames/`; `proef/sessie.json` heeft 0 punten afgevinkt; de hub-map `proef/` is
  leeg (extra-3 §1.5, extra-2 §1.4).

Conclusie als feit: **er is geen bestand dat laat zien dat proefavond 1 als DJ-proef op de APC heeft
plaatsgevonden.** Het kan zonder log zijn gebeurd (het log is optioneel; de "altijd"-vink uit §0 punt 4
stond kennelijk niet aan), of niet. Stap 0 van §4 ("avond 1 verwerken") en alle acht "[na de proefavond]"
gaan ervan uit dat hij wél is geweest. Daarom staat de vraag nu bovenaan (VI13 = H1 van extra-2): zo ja,
wat ging fout; zo nee, avond 1 opnieuw plannen vóór elke merge, en dan is de hub-middag van 4b.2 de eerste
hardwareproef sinds 23 september.

### 4b.1 Extra-1 · Pijler 3 en av-kern: één klankmodule "modaal", twee gastheren

**Wat de criticus miste.** Geen spoor ging over pijler 3 (audio programmeren als *de klank zelf bouwen*),
en de enige concrete afspraak daarover, het H6-besluit van 24 sep (één AudioWorklet-module met modale
synthese, eerst in av-kern, dan in Varve via een vormbus), is door niemand opgepakt. Tegelijk hangt er een
datum aan: av-kern publicatie 1 op 25 okt, waar ROADMAP, het Totaalplan én het hub-plan op rekenen.

**Feiten (nagekeken 11 okt).** av-kern staat in `~/Projects/src/av-kern` (het pad `~/src/av-kern` in
ROADMAP r. 33, Varve `CLAUDE.md`, `FASE0-TEST.md` en av-kern `README.md` bestaat niet); laatste commit
28 sep (13 dagen); 54 tests groen; de tak `waterschaal-hartslag-td` (3 commits) is niet gemerged; **geen
enkele AudioWorklet**; drie audio- en drie beeldplekken leeg (`korrel`, `reson`, `pad`, `strata`,
`deeltjes`, `nasleep`); `FASE0-TEST.md` 0 van ~60 vakjes; `LOG.md` zonder één regel van Clay met de APC.
Het Totaalplan zegt zelf: *"14 dagen zonder sessie met de fysieke APC40 → project parkeren"*. Dat criterium
is sinds ~7 okt van kracht: **formeel geparkeerd.** In Varve bestaan de vier isomorfe systemen (`sn`, `tv`,
`ep`, `dw`) met geluid achter `g.geluid`, maar dat is nergens aangesloten (0 treffers in `vorm-paneel.js`,
`laag.js`, `werker.js`) en kan in werker-modus ook niet (een Worker heeft geen `AudioContext`); per
aanslag kost `modalBuffer` 12–32 ms op de hoofdthread.

**Oordeel over 25 okt.** Drie lezingen: A (zoals het Totaalplan: 8 modules, 20 scènes) is met 0 uur
hardwaretijd sinds 23 sep en Oktoberfest 19–31 okt niet eerlijk te beloven; B ("lelijk mag", het vangnet
dat het plan zelf voorschrijft: Drone + Veld, 5 scènes, 10 minuten online) is haalbaar in **twee avonden
van Clay** (fase 0 van 40 minuten + één opname van 10 minuten); C (parkeren) is de feitelijke stand.
Advies: **B**, en pas daarna 06a–c als gedeelde module (niet ervoor, niet de AI-laag).

**Ontwerp.** Het spectrum is het bericht: een aanslag in `systemen-isomorf.js` levert al per modus
frequentie, amplitude en uitklinktijd (`s.fr`, `s.am`, `s.ta`); dat gaat als bericht van ≤ 1 KB
(`{ t:'slag' | 'golf' | 'korrel' | 'buffer' | 'grond' | 'vol' | 'stil' | 'opt', tijd? }`, `tijd` op de
audioklok) uit de Worker via de hoofdthread naar één worklet `varve-modaal`. **De bron staat in Varve**
(`src/engine/modaal/{modaal-kern,modaal-worklet,modaal}.js`, `src/vormen/klank.js`, een functie-sink
`g.klank` naast `g.geluid`, +12 regels in `werker.js`/`laag.js`, `test/modaal.test.mjs`, `docs/MODAAL.md`);
av-kern vendort met `tools/vendor-varve.sh` en `src/vendor/HERKOMST.md` (commit + SHA-256 per bestand),
zoals de vormen al zouden (beslissing 4a van 24 sep). Kern: 12 stemmen × ≤ 256 modi als complexe
oscillatoren, een golf-stem (≤ 48 harmonischen L/R), een korrel-stem (≤ 64 korrels), berichtenrij met tijd
(het patroon van `instrumenten/schaal-kern.js`), slaapt bij stilte, LCG, 0 GC. Geschat 0,05–0,2 ms per blok
van 128 frames op de M1 in de drukste stand (niet gemeten; boven 0,4 ms gaat `maxModi` omlaag).
Grondtoon in Varve = `deck.toonsoort` van de maatgever, nooit terug naar een standaardtoon; in av-kern
`bus.root`/`bus.scale`. De acht av-kern-plekken per systeem: `reson` = `sn` (precies acht knoppen),
`korrel` = `dw` (+ toonbereik, bufferstart, breedte), `pad` = `ep` (+ vorm, filter, zweving, adem); de
korrelbuffer in Varve = de knip van een sampler-pad (H6 letterlijk), in av-kern 3 s van de eigen Drone.
Beeld blijft byte voor byte gelijk (de bestaande test eist dat al); av-kern's replay-hash blijft gelijk
(de vormen lopen op `bus.nowMs()`, de klank zit niet in de bus).

**Bouwstappen en kosten.** Stap 0: pad-fix in vier docs + de td-brug-tak mergen (0,5 u agent). Fase 0:
40 min Clay met de APC, Varve dicht. Publicatie 1 "lelijk": ~1 u agent (Wake Lock), ~1,5 u Clay. Stap 1
(Varve-kant, puur, **geen wiring**, raakt `engine.js` niet): 4–6 u agent, 0 u Clay, 0 hardware. Stap 2
(av-kern-gastheer `reson`, pas ná fase 0: av-kern's eigen regel 4): 2–3 u agent, 30 min luisteren. Stap 3
(Varve-vormbus op `master.input`, standaard dicht, schuif "geluid"): 2 u agent, 20 min luisteren, raakt
`engine.js` +6 regels, dus na de proefavonden. Som tot "reson klinkt in beide": ~9–12 u agent, ~1,5 u Clay.

**Plek in §4.** Stap 0: AK3 (pad-fix, 0,5 u). Stap 1: AK1 (A/B/C) is de vierde keuze die alles
ontgrendelt voor av-kern. Stap 2: modaal stap 1 als **vierde additieve PR** (nieuwe bestanden, geen wiring,
`regels.test` en de gouden hash van `renderblok.test` ongewijzigd). Nieuwe stap 5b (overdag, zonder set):
fase 0 (40 min) en publicatie 1 "lelijk" vóór 25 okt. Stap 8: modaal stap 2 (av-kern) en stap 3 (Varve
vormbus, raakt de engine: na avond 2). Stap 9: AK5(b), de isomorfe vorm als **instrument op een track**
(strip, cue, fx, sends, patronen; de crossover van pijler 2 en 3).

**Toets VISIE §5.** 1: pijler 3 krijgt voor het eerst een drager, zonder pijler 1 te raken (standaard
dicht, buiten het live-pad tot stap 3). 2: niets erbij in de tas. 3: knoppen en presets blijven data
(`draaiKnoppen`, `vanaf01`). 4: niemand heeft een `ModaalKern` gehoord; geen wiring vóór een luistertest.

### 4b.2 Extra-2 · De controllers en de hub als drager: handenkaart, één proefvolgorde, de kernset

**Wat de criticus miste.** VISIE §2 noemt de controllers als tweede drager; geen spoor ging erover, en de
acht PR's voegen vier dingen toe die alleen een schermknop hebben (`video.clips`, `sampler.1–8.drums`,
`broadcast.toggle`, opstelling activeren). De AV-app-hub, het enige mechanisme waarmee APC, Maschine en
LPD8 samen in één set kunnen (en waarmee drie apps, Varve, av-kern en de Stroommachine, dezelfde APC
delen), is **nooit op hardware gedraaid**: hub `proef/` leeg, `lpd8-profiel.json` en
`xboard49-profiel.json` bestaan niet, V1–V5 van `STATUS.md` onbeantwoord, de 648 tests allemaal met
nep-apparaten. Opstelling `alles`, het crossover-proefblok en avond 2 van de speellijst leunen erop.

**Feiten (berekend, `extra-2/klad/vrij-apc.tsv`).** APC: 702 regels standaardmapping, 148 controls uit de
hub-controltabel; vrij zonder enige regel: Shift (is de shift zelf), **Bank** (zonder hub vrij, met hub de
hubtoets), **footswitch** (CC 64); vrij zonder shift: Detail View (met `?vormen=1` het mapje vorm); **23
knoppen met een basisregel maar zonder shift-variant** (A|B 1–8, Device ◀ ▶, On/Off, Lock, master-knop,
Stop All, Pan, Sends, User, Play, ▲ ▼ ◀ ▶); in de modus sampler is rij 4 (noot 8–15) ongebruikt. Maschine:
27 van 48 knoppen in gebruik, **21 vrij** (F1–F8, ALL, AUTO, VOLUME, SWING, TEMPO, NOTE REPEAT, GRID, PAD
MODE, NAVIGATE, DUPLICATE, SELECT, SOLO, MUTE); `~/Projects/maschine-lab/kaart/data2.js` heeft voor die 21
al een voorstel. LPD8 in Varve: K2 beeld, K4 puls, P1 zwart; K1, K3, K5–K8 vrij. Xboard: alles bezet,
alle CC's een **aanname**. Uit 26 logs (56.743 handelingen, 30 sep–10 okt): de top-15 ligt voor 100 % op
de APC (fader 11.796, filter 6.452, fx.knob 5.064, send.a 4.765, …); `layer.*` 128, patronen 72, auto-DJ
32. Het log kent geen bron (MIDI, muis, toets), dus "op de APC" is een afleiding. Avond 2 heeft nu **twee
proeflijsten zonder brug**: de hub-`HARDWARE-AVOND.md` (±80 min relevant, zonder Varve, zonder draaiende
hub, set `meditatie`) en de Varve-speellijst avond 2 (64 punten, 154 min, mét draaiende hub, set `studio`);
samen ±5 uur, en de volgorde is dwingend (de F0-proef kan niet naast een hub of een Varve-tab).

**Ontwerp.** (a) **De handenkaart**: een gegenereerd document uit de data (mappings, action-register,
hub-controltabel via `VARVE_HUB_REPO`, `src/control/devices/maschine-mk2.js`, de LPD8-rollen in `hub.js`,
`handen/voorstel.json`, de profielen, de logs): per control wat hij doet (basis, shift, per mapje/modus),
of hij vrij is, en voor de vrije plekken het voorstel per nieuwe actie; per controller zijn rol per
profiel; top-40 handelingen → welke hand. Bestanden: `src/handen/kaart.js` en `telling.js` (puur),
`tools/handen/handenkaart.mjs` (CLI; schrijft `docs/HANDEN.md` tussen markers en een A4-HTML voor ⌘P),
`handen/voorstel.json`, `test/handen.test.mjs` (zes checks: elke `in` is een bekende control, elke action
bestaat, de vrije-plekkenlijst is precies §1.6, elke koppelbare actie zonder plek heeft een voorstel of
staat op de uitzonderingslijst, geen import uit `src/engine/`, de telling klopt). **Geen enkele mapping
verandert.** Voorstellen: `video.clips` op **Shift + master-knop** (naast zwart; 0 regels op
`note:0:80#shift`), `sampler.N.drums` in de **modus sampler rij 4** en op de Maschine **DUPLICATE + pad**
(nooit SHIFT + pad: dat is leegmaken, K10), `broadcast.toggle` **nooit** op een pad, opstelling geen
bus-action. Eerst via learn in Clay's eigen verschil, standaard pas na de proef. (b) **Eén proefvolgorde**:
de F0-proef als eigen **hub-middag** (2a, overdag, ±80 min, zonder muziek: `doctor` → F0-proef 26 stappen →
speelapparaten 21 stappen → push → `npm run check -- studio`), als blok `hub-f0` in de
Controlekamer-speellijst (ids `hf-…`, nieuw voorvoegsel) met VRAGEN-blok V (V1–V5) en H; avond 2 wordt 2b
en begint met `check` in plaats van hopen; 7a van draagbaar in dezelfde minuut (zelfde stekkers). Tien
regels tekst als voorstel voor `AV-app-hub/docs/HARDWARE-AVOND.md` (de hub-repo niet aangeraakt). (c) **De
kernset**: K1 APC alleen (= `apc`) nu; K2 APC + Maschine via de hub (= `alles`) als doel zodra de
hub-middag groen is en 2b het bevestigt; LPD8 alleen als av-kern meespeelt (na 25 okt); Xboard thuis.
`standen` en `profielen.json` staan al op `apc`: dit verandert daar niets.

**Kosten.** Kaart + telling + test 4–5 u, CLI/HTML 3–4 u, voorstel en tekst 1–2 u, speellijstblok +
VRAGEN + CONTROLEKAMER 2–3 u: ~1,5 dag agent vóór de proef; hub-middag 80 min Clay; verwerking F0 (golden
tests, `config.json`, de echte Xboard-CC's in `mappings/xboard49.json`) 2–4 u agent in de hub-repo na
Clay's push; standaardplek per actie 2 u, alleen na "bevalt".

**Plek in §4.** Stap 0: **VI13** (H1) gaat vóór "avond 1 verwerken". Stap 2: de handenkaart als **vijfde
additieve PR** (raakt engine, bus, mapping, `apc.html`, `maschine.html` niet). Stap 3: het speellijstblok
`hub-f0` + VRAGEN V/H (headless `controle.mjs` op een kopie, eigen poort). Nieuwe stap 5b (overdag): de
hub-middag mét 7a, vóór avond 2; dit verfijnt VI5 en VI11. Stap 6 (avond 2 = 2b): kern = `check` →
`hb-start` → `hb-lpd8` → spelen (15) → patronen (8), 57 min; secties, Maschine-als-DJ, bladeren en de
crossover alleen als er tijd is. Stap 8: de standaardplekken (handen stap 4) na de proeven; de echte
Xboard-CC's vervangen de aanname. VI10 (kernset) krijgt zijn antwoord: K1 nu, K2 doel.

**Toets VISIE §5.** 1: de kaart maakt zichtbaar waar alle vier de pijlers op de handen liggen; de twee
voorstelplekken dienen pijler 2–3 en de beelddrager op plekken met 0 regels. 2: K1 haalt hub en Maschine
uit de eerste reis-tas. 3: `voorstel.json` en learn-eerst; de kaart herrekent zichzelf. 4: niets hierin is
geproefd; het hele spoor zet de hub-middag vóór elke merge en elke standaardplek.

### 4b.3 Extra-3 · Back-up en herstel van het hele instrument: de data, niet de code

**Wat de criticus miste.** §6 van deze synthese: "een externe backup bestaat niet … urgenter dan elk
spoor", en draagbaar keuze 3+4 en VI2 noemen het, maar niemand inventariseerde wat het instrument *is*
buiten de code, mat of een kopie klopt, of deed een herstelproef.

**Feiten (gemeten 11 okt 13:00–13:15, op kopieën).** Geen Time Machine (`tmutil: No destinations
configured`), geen externe schijf, geen launchd of cron: **nul kopieën van de data buiten deze laptop**;
iCloud is synchronisatie (synct ook wissen, plaatst uit, geen versies). Het handwerk is klein: **~16 MB**
(library.db 0,3 MB, patronen 196 KB, plannen, racks, mappings 256 KB, proef, 27 handelingenlogs 3,8 MB,
hub-staat 1 KB, de kaart `varve-kaart.json` 10,7 MB in `~/Desktop/3. Resources/Data/Muziekkaart/`) plus
**32 GB media** (15 nummers, ~2,2 GB per nummer, herbouwbaar met uren en alleen als YouTube ze nog heeft)
en **0,6 GB opnames** (niet herbouwbaar). Daarnaast **zeven sleutels alleen in Chrome's localStorage**
die nergens anders staan: `varve.master.rack`, `varve.klankschaal`, `varve.midi.ports`,
`varve.beeld.adres/.latentie/.aan`, `varve.stems.standaard`, `varve.koptelefoon.omgewisseld`,
`varve.vormen` (alleen de mapping heeft een serverkopie). De muziekkaart-code (`~/Projects/muziekkaart`)
heeft **geen remote**. **Gemeten: `cp library.db` is fout.** De laatste twee dagen handwerk staan in
`library.db-wal` (4,1 MB, 8 okt), niet in `library.db` (266 KB, 6 okt): een kopie zonder WAL mist één
nummer (FUTURE.666), één hotcue, drie sampler-pads, twee stems-sets en de kolom `secties_json` (de
v9-migratie leeft in de WAL), en `quick_check` zegt toch "ok". De server-backup (`VACUUM INTO`,
`media/backups/`, 14 stuks) is wél compleet. **Herstelproef gedaan**: verse worktree van `origin/main` +
85 MB hersteldataset → proefserver op 8790 → in ~1 s 15/15 nummers, mapping, samples, patronen, plan,
27 logs, secties 15/15; het ene nummer met media speelt (206), de andere veertien 404; opnames en kaart
"weg"; Chrome-staat per constructie weg. De server herstelt alles wat hij zelf schrijft zonder migratie of
handwerk; de gaten zitten buiten de server.

**Ontwerp: twee sets, drie plekken.** **Set A "staat"** (~16 MB, dagelijks 08:00 via launchd + vóór
vertrek, met versies): `MANIFEST.json` (sha256, tellingen), `library.db` en `kaart.db` als VACUUM-kopie,
`patronen/ plannen/ racks/ mappings/ proef/ standen/ Input/` incl. `.versies/`, `handelingen/*.acties.jsonl`,
`hub/staat.json`, `browser/varve-instellingen.json` (na B4), `beeld/track-scenes-<datum>.json` (export uit
de Stroommachine, handwerk), `kaart/varve-kaart.json`, `versies/` (12 + 30 dagen). **Set B "media"**
(~33 GB, vóór elke reis en na elke nacht-run of opname): `rsync -a` van `media/` en `opnames/` **zonder
`--delete`** (nooit verwijderen); tegelijk de reiskopie waar `VARVE_MEDIA` op reis heen kan wijzen.
Plekken: een **externe SSD 1 TB** (A + B; nodig, ook voor VI2: zonder SSD heeft `media/` na de verhuizing
uit iCloud nul kopieën), een **privé GitHub-repo `varve-staat`** voor set A (gratis, versies, buiten huis;
luistergeschiedenis dus nooit publiek en nooit in `AV-app-hub`), de Omarchy-pc als derde optie (SSH wordt
nu door het tailnet-beleid geweigerd), iCloud als restlaag tot VI2. Bestanden: `tools/backup/kopie.mjs`
(hergebruikt de bestaande `Backups`-klasse: VACUUM INTO, quick_check, fsync; `--media`, `--controleer`,
`--droog`; weigert dezelfde schijf zonder `--zelfde-schijf`), `controleer.mjs` (de sonde reiskopie van
draagbaar stap 10: "kopie van 2 dagen geleden; 15/15 nummers; LET OP: 2 nummers nieuwer"), `herstel.mjs`
(weigert een bestaande `library.db` te overschrijven), `test/backup-kopie.test.mjs` (de S1-fout als test:
rijen in de WAL komen mee), `docs/BACKUP.md` met de herstelprocedure in acht stappen. PR 2 (B4): de zeven
Chrome-sleutels naar de library zoals de mapping (`/api/instellingen/<sleutel>`, server eerst, localStorage
reserve). PR 3: launchd-plist + de regel "kopie buiten de laptop: n dagen" in het avondpakket.

**Zonder code, morgen, 10 minuten** (extra-3 §8): `sqlite3 media/library.db "VACUUM INTO '<D>/staat/library.db'"`
(niet `cp`), idem `kaart.db`, `cp -R` van zeven mappen en de logs, `~/.varve-hub/staat.json`,
`varve-kaart.json`; `rsync -a media/ opnames/` naar een echte tweede schijf; `gh repo create muziekkaart
--private --source=. --push`; op de pc één keer "Track-scènes als JSON".

**Kosten.** SSD €80–120 (schatting, niet opgezocht), GitHub €0; PR 1 ~1 dag agent, PR 2 ~½ dag, PR 3
~½ dag; Clay 30 min eenmalig, 1 min vóór elke reis (`kopie.mjs --media`), 2 min na elke Stroommachine-sessie.
Set A in seconden (VACUUM INTO 35 ms gemeten); set B eerste keer 32 GB over USB-C (minuten, niet gemeten).

**Plek in §4.** Stap 0: de **handkopie van 10 minuten** (geen code), vóór alles, ook vóór de verwerking
van avond 1; en de muziekkaart-code naar een privé-repo (1 min). Stap 1: **B2 (SSD) vóór VI2**, want VI2
zonder SSD maakt het aantal kopieën van `media/` nul; VI2 wordt daarmee "SSD → `VARVE_MEDIA` buiten iCloud
→ `VARVE_BACKUPS` op de SSD → `kopie.mjs --media` vóór elke reis". Stap 2: backup PR 1 als **zesde
additieve PR** (alleen `tools/` en `test/`, geen server-, engine- of UI-wijziging). Stap 4: PR 3 (launchd +
avondpakket-regel) direct na de merge van #19; `standen/` gaat mee in set A zodra #21 gemerged is. Stap 8:
PR 2 (B4, raakt `server/index.js` en de ui: na avond 2 volgens VI3). Elk kwartaal: de herstelproef van
extra-3 §1.6 herhalen (10 min); een backup die nooit hersteld is, is geen backup.

**Toets VISIE §5.** 1: dient alle vier (pijler 4 letterlijk: het instellen ís het instrument, en dat staat
nu op nul plekken). 2: de SSD is hardware, geen dienst; GitHub is al in gebruik; het is tegelijk de
reiskopie. 3: een mapstructuur die je met de Finder leest; herstellen is kopiëren. 4: de WAL-meting en de
herstelproef zijn gedaan; rsync naar een SSD, launchd en Chrome niet.

### 4b.4 Hoe de drie mini-sporen de zeven sporen raken

- **Proefavond 1 (VI13)** raakt alles: stap 0 van §4 verandert van "verwerken" in "vaststellen, en zo nodig
  opnieuw plannen". Het setboek van produceren-uit (K-B) heeft dan niets te lezen behalve 7 minuten beeld.
- **Backup × draagbaar × standen**: extra-3 levert de sonde reiskopie (draagbaar stap 10), maakt
  paklijstregel 7 een meting, zet `standen/` in set A, en draait de volgorde van VI2 om (SSD eerst).
- **Backup × produceren-uit × kaart-brug × beeld**: de logs (het setboek) en `varve-kaart.json` gaan in set
  A; de Stroommachine-scènes alleen via de JSON-export op de pc (B6), tot de zender ze ooit meestuurt.
- **Handen × crossover × beeld × uitzenden**: de drie acties zonder knop krijgen een voorstelplek
  (`sampler.N.drums`, `video.clips`) of bewust géén (`broadcast.toggle`); de hub-middag is de voorwaarde
  voor opstelling `alles`, het crossover-proefblok en de LPD8-paniek.
- **Handen × draagbaar**: 7a en de hub-middag zijn dezelfde minuut met dezelfde stekkers; de echte
  Xboard-CC's vervangen de aanname in `mappings/xboard49.json`.
- **Modaal × crossover**: AK5(b) (de isomorfe vorm als instrument op een track) en AK6 (de korrelbuffer uit
  een sampler-pad) zijn de volgende schakels van dezelfde kringloop die crossover met knip → drumpad begon.
- **Modaal × beeld-een-machine**: het zaalbeeld (vormen zonder clips) wordt met de vormbus ook *hoorbaar*
  eigen beeld; de rekenlast komt bovenop de meting van beeld (stap 3), dus meten vóór wiring.
- **Modaal × av-kern × hub**: drie plannen rekenen op 25 okt; AK1 (B) vraagt één PR die ROADMAP 6–11
  bijwerkt plus een zin in het hub-plan; de hub-koppeling van av-kern ("na 25 okt") en de lease-fase
  (wk 44–45) houden hun anker alleen als fase 0 echt gebeurt.

### 4b.5 De volgorde van §4, aangevuld

Dezelfde negen stappen, met de mini-sporen op hun plek (alleen wat erbij komt):

| # | Erbij |
|---|---|
| **0** | **Eerst VI13**: is avond 1 als DJ-proef doorgegaan (log 19:09–19:17 is alleen beeld; 0 vinkjes; library ongewijzigd sinds 8 okt)? Zo nee: avond 1 opnieuw plannen, stap 0 "verwerken" vervalt tot dan. Daarnaast, zonder code: de **handkopie van 10 minuten** naar een stick of de pc (extra-3 §8), de muziekkaart-code naar een privé-repo, en AK3 (pad-fix in vier docs, td-brug-tak mergen). |
| **1** | Vierde en vijfde keuze: **AK1** (av-kern 25 okt: A/B/C, advies B) en **B2** (SSD vóór VI2). VI2 wordt: SSD → `VARVE_MEDIA` buiten iCloud → backups op de SSD → `kopie.mjs --media` vóór elke reis. |
| **2** | Drie extra additieve PR's, nog te bouwen (anders dan #19–#26 bestaan ze alleen als ontwerp): **backup PR 1** (`tools/backup/`, ~1 dag), **handenkaart** (`src/handen/`, `tools/handen/`, ~1,5 dag), **modaal stap 1** (`src/engine/modaal/`, puur, geen wiring, 4–6 u). Geen van de drie raakt engine, bus, mapping of het live-pad. |
| **3** | Het speellijstblok `hub-f0` + VRAGEN V/H (headless `controle.mjs` op een kopie, eigen poort); de ms-per-blok-meting van de modaal-kern in Node en headless, naast de beeldmeting. |
| **4** | Na #19: backup PR 3 (launchd 08:00 + "kopie buiten de laptop: n dagen" in het avondpakket). Na #21: `standen/` in set A. |
| **5** | (ongewijzigd: Tailscale eenmalig) |
| **5b** | **Nieuw, overdag, zonder set, vóór avond 2**: de **hub-middag** (±80 min: `doctor`, F0-proef, speelapparaten, push, `check -- studio`) mét 7a in dezelfde minuut; en **av-kern fase 0** (40 min, Varve dicht, `~/Projects/src/av-kern`) plus publicatie 1 "lelijk" (10 min spelen en opnemen) vóór 25 okt. Twee dagdelen van Clay; de eerste hardwareproeven van hub en av-kern ooit. |
| **6** | Avond 2 = **2b**: begint met `npm run check -- studio`; kern 57 min (hub-start, LPD8, spelen, patronen), de rest alleen als er tijd is; kernset K1 → K2. |
| **7** | (ongewijzigd: uitzenden stap 3–6) |
| **8** | Modaal stap 2 (av-kern-gastheer `reson`, na fase 0) en stap 3 (Varve-vormbus, raakt `engine.js`); backup PR 2 (B4, de zeven Chrome-sleutels); de standaardplekken voor `video.clips` en `sampler.N.drums` na learn en proef; de echte Xboard-CC's. |
| **9** | AK5(b): de isomorfe vorm als instrument op een track; AK9: na een echte M2 pas de AI-laag van av-kern; de Stroommachine-scènes via de zender in plaats van handexport (B6). |

**Toets van de aanvulling aan VISIE §5.** 1: pijler 3 krijgt een drager (modaal) en pijler 4 een kopie
(backup); de handenkaart raakt alle vier zonder er één te breken; geen mini-spoor raakt engine, bus of de
drie regels vóór stap 8. 2: één stuk hardware erbij (de SSD), geen dienst, geen tweede machine; K1 haalt
juist spullen uit de tas. 3: voorstelplekken, profielen, manifest en kaart zijn data. 4: de twee dagdelen
van stap 5b zijn de eerste hardwareproeven van hub en av-kern; daarvóór wordt niets gemerged dat ervan
afhangt, en niets gewired dat niemand gehoord heeft.

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

**Aanvulling 11 okt (tweede ronde, §4b): de keuzes van de drie mini-sporen.** De volledige blokken staan
in de ontwerpen zelf (AK1–AK9 in extra-1, H1–H10 in extra-2, B1–B7 in extra-3); hier wat over de sporen heen
gaat of een eerdere VI-keuze verandert.

- [ ] **VI13. Is proefavond 1 (10 okt) als DJ-proef op de APC doorgegaan?** 💬 Het enige log van die avond
  (19:09–19:17, 430 s) is 5.539 handelingen beeld zonder nummer, acht tracks leeg; de speellijst heeft 0
  vinkjes; de library is sinds 8 okt niet gewijzigd. **Zo ja:** wat ging fout op de APC, in de Scarlett en de
  kaart; dat verwerken we eerst (stap 0). **Zo nee:** avond 1 opnieuw plannen vóór elke merge; alle PR's
  blijven "[na de proefavond]", en de hub-middag (VI16) wordt de eerste hardwareproef sinds 23 sep. Dit gaat
  vóór VI1–VI3.
- [ ] **VI14. av-kern en 25 okt: A, B of C, en wanneer fase 0?** 🎛💬 A (het Totaalplan: 8 modules, 20
  scènes) is met 0 uur hardwaretijd sinds 23 sep en Oktoberfest niet eerlijk te beloven; B ("lelijk mag", het
  vangnet van het plan zelf: Drone + Veld, 5 scènes, 10 min online) kost fase 0 (40 min met de APC, Varve
  dicht) plus één avond van ~1,5 u; C (parkeren) is de feitelijke stand sinds ~7 okt. **Advies: B, met fase 0
  op het eerste dagdeel zonder Varve-set (stap 5b), en daarna 06a–c als gedeelde module, niet de AI-laag.**
  Klein onderhoud nu, zonder hardware: het pad `~/src/av-kern` → `~/Projects/src/av-kern` in vier docs en de
  td-brug-tak (3 commits, 54 tests groen) naar av-kern `main`.
- [ ] **VI15. De modale klankmodule (H6): waar woont de kern, en hoe komt hij in Varve?** 💬🎧 (a) **Varve is
  de bron, av-kern vendort** met `HERKOMST.md` (zoals de vormen, beslissing 4a van 24 sep); het bewijs (de
  eerste keer horen) komt wel eerst in av-kern. In Varve eerst als **vormbus** op `master.input`, standaard
  dicht, één schuif "geluid" in de VORM-rij; de isomorfe vorm als **instrument op een track** (strip, cue,
  patronen, Maschine) als richting B. Grondtoon volgt de maatgever, nooit terug naar een standaardtoon;
  omstemmen tijdens de klank niet (anders dan KS2: beeld en geluid blijven één). Korrelbuffer = de knip van
  een sampler-pad. **Advies: zo; stap 1 (puur, geen wiring) mag nu gebouwd worden, wiring pas na een
  luistertest.**
- [ ] **VI16. De hub-F0-proef als eigen hub-middag vóór avond 2, met 7a in dezelfde minuut?** 🎛 Overdag,
  ±80 min, zonder muziek en zonder speaker: `doctor` → F0-proef (26 stappen, V1–V5) → speelapparaten (21,
  de echte Xboard-CC's) → push → `npm run check -- studio`. Alternatief: aan het begin van avond 2 (dan ≥ 4
  uur). Avond 2 wordt 2b en begint met `check`; kern 57 min. **Advies: hub-middag.** Dit verfijnt VI5 en
  VI11; de tien regels voor `AV-app-hub/docs/HARDWARE-AVOND.md` (extra-2 §3.4) alleen met jouw OK.
- [ ] **VI17. Kernset onderweg: K1 (APC alleen) nu, K2 (APC + Maschine via de hub) als doel?** 💬 LPD8 alleen
  mee als av-kern meespeelt (na 25 okt; in Varve doet hij drie dingen en vraagt de hub); Xboard thuis (de
  Maschine-pads geven dezelfde noten 36–51). **Advies: ja.** Dit is het antwoord op VI10; `standen` en
  `profielen.json` staan al op `apc`.
- [ ] **VI18. Plekken voor de acties zonder knop, eerst via learn?** 👀🎛 `video.clips` op **Shift +
  master-knop** (naast zwart; 0 regels daar), `sampler.N.drums` in de **modus sampler rij 4** en op de
  Maschine **DUPLICATE + pad** (nooit SHIFT + pad: leegmaken), `broadcast.toggle` **nooit op een pad** (stand +
  iPhone). Standaardmapping pas na de beeld-speelproef (VI7) resp. het crossover-proefblok (CX4). De
  handenkaart (`docs/HANDEN.md` + A4-afdruk) toont de vrije plekken: Bank, footswitch, 23 shift-vrije knoppen,
  21 Maschine-knoppen, LPD8 K1/K3/K5–K8. **Advies: ja, learn eerst; kaart als document én afdruk.**
- [ ] **VI19. Een externe SSD (1 TB) vóór VI2, en de kleine set "staat" ook in een privé GitHub-repo?** 💬👀
  Gemeten: nul kopieën van de data buiten deze laptop; `cp library.db` mist twee dagen handwerk (de WAL);
  VACUUM INTO is de enige juiste bron; herstel op een verse worktree werkt in 1 s zodra de bestanden er
  staan. Set A ~16 MB dagelijks 08:00 via launchd + vóór vertrek; set B ~33 GB `rsync -a` zonder `--delete`
  vóór elke reis, tegelijk de reiskopie. "Geen cloud" is een geldig antwoord: dan SSD + een stick in de tas.
  **Advies: SSD + GitHub-privé; VI2 pas ná de SSD.** Morgen zonder code: de handkopie van 10 minuten
  (extra-3 §8).
- [ ] **VI20. De zeven Chrome-sleutels naar de library, de muziekkaart-code naar een privé-repo, de
  Stroommachine-scènes exporteren?** 💬 Master-rack, klankschaal, MIDI-poorten, beeld-adres, stems-standaard,
  cue-wissel en de vormen-vlag staan alleen in localStorage: een nieuw Chrome-profiel wist ze. Spiegelen
  zoals de mapping (`/api/instellingen/<sleutel>`, kleine PR, na avond 2) of een exportknop. De
  muziekkaart (`~/Projects/muziekkaart`) heeft geen remote: `gh repo create muziekkaart --private` (1 min).
  Stroommachine-scènes staan alleen in de browser van de pc: na elke sessie "Track-scènes als JSON" naar de
  SSD, tot de zender ze meestuurt. **Advies: alle drie ja; de repo vandaag, de PR na avond 2.**

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

**Tweede ronde (11 okt), hetzelfde eerlijk:**
- **Nagekeken door mij:** dat PR #27 (`visie/uitwerking` → `studio/integratie`) open staat; dat de drie
  ontwerpen bestaan met hun kladmappen (`extra-2/klad/vrij-apc.tsv`, `telling-uitvoer.txt`,
  `log-10okt-avond.jsonl`; `extra-3/klad/` met S0/S1/S2 en `herstel/`); dat `~/Projects/varve-stems/extra-3-herstel`
  (tak `visie/extra-3`, gelijk aan `origin/main`, geen commits) is achtergelaten zoals extra-3 schrijft.
- **Niet door mij gedaan:** geen meting herhaald (de WAL-vergelijking, de herstelproef, de telling over 26
  logs, de av-kern-tests zijn van de mini-sporen); geen `node test/alles.mjs` (deze tak raakt alleen docs,
  ROADMAP en één regel CLAUDE.md); geen server, geen hardware, geen hub, geen Chrome; niets gemerged.
- **Aannames die §4b draagt:** dat het ontbreken van een DJ-log op 10 okt betekent dat de avond niet als
  DJ-proef is geweest *of* zonder log; ik kies niet (VI13). Dat de drie ontwerpen nog niemand heeft
  gereviewd (ze hebben, anders dan de zeven sporen, geen jury, critici of bouwer gehad: het zijn ontwerpen,
  geen takken). Dat de uren in 4b.1–4b.3 schattingen zijn op de omvang van vergelijkbare bestanden.

*Bronnen: `scratchpad/uitwerking/<spoor>/8-spoorrapport.md` en `9-verdieping*.md` voor uitzenden,
companion, beeld-een-machine, crossover, standen, draagbaar en produceren-uit; `docs/VISIE.md`; de
PR-teksten van #19–#26; voor §4b `scratchpad/uitwerking/extra-1/ontwerp.md`, `extra-2/ontwerp.md`, `extra-3/ontwerp.md`. Een kopie van dit bestand: `scratchpad/uitwerking/SYNTHESE.md`.*
