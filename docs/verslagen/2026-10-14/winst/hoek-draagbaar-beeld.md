# Hoek draagbaar-beeld: waar de meeste winst zit (13 okt 2026)

Gelezen op `studio/afmaken` (7debab6): VISIE, AVONDPAKKET, STANDEN, COMPANION, UITZENDEN, BEELD §8,
BEAMER "Zaalbeeld", LIBRARY "Waar media/ staat", HANDOFF (11 okt), de open PR's (#27–#40) en de takken
`visie/backup-kopie` en `visie/uitwerking`, `tools/varve-app/VARVE.applescript`, `server/index.js`
(statisch), `src/controle/controle.js`, `avondpakket/profielen.json`, `tools/standen/voorbeelden/`.
Hub-repo alleen gelezen (README, cli.js). Niets in de repo veranderd; meten gebeurde op een kopie
(`git archive HEAD`) in deze kladmap.

## Eerst één feit dat boven alle kansen staat

**Niets van de draagbare stapel staat op `main`.** `server/avondpakket.js`, `server/standen.js`,
`server/media-plek.js` (media buiten iCloud), `server/uitzend.js`, `src/companion/`,
`server/mixer-melding.js` en `tools/beeld-lokaal.sh` bestaan op `origin/main` niet (gecontroleerd met
`git cat-file -e origin/main:<pad>`). Het zit in PR #32 (`studio/integratie -> main`, "[na avond 1]",
232 bestanden, +26.760 regels) plus vier fix-PR's (#33, #34, #39, #40) en drie losse visie-PR's
(#28 backup-kopie, #30 handen, #31 sleutels). Clay's Dock-app start de server uit de Bureaublad-checkout.
Zolang dat `main` is, heeft hij vandaag geen avondpakket, geen opstellingen, geen companion en geen
verhuistool voor `media/`. Elke kans hieronder die op die stapel bouwt, levert pas iets op na die merge.

Wel op `main` (13 okt, #35): VARVE.app start nu ook de AV-hub. Dat raakt kans 3.

Meting op de kopie (Linux-container, Node 22.22, niet Clay's Mac):
- `test/avondpakket.test.mjs` groen (0,24 s);
- `test/uitzend.test.mjs` "alles ok" (47 s, zonder videotoolbox en zonder echte tijd);
- `node test/alles.mjs`: 94 bestanden, 8796 checks, 9 overgeslagen, **3 rood**:
  - `instrumenten-fm-schaal` (afval): alleen onder last, los groen;
  - `renderblok` "keylock met wissels: 83,7–89,7 bytes per bericht": ook los rood;
  - `wachtrij` "yt-dlp en zijn kind zijn allebei weg": ook los rood, 2×.

  Waarschijnlijk is dat de omgeving (een andere V8, een ander procesbeheer), niet onderzocht en niet mijn
  hoek. Vóór #32 naar main moet `alles.mjs` op de Mac zelf groen zijn.

---

## Kans 1. De checkout uit iCloud, en een vangnet voor een bestand dat niet lokaal is

**Probleem.** De code staat in iCloud (`CLAUDE.md` Conventies/Git: "de repo staat op het Bureaublad
(iCloud)"; `VARVE.applescript` r.15 `map : "Desktop/1. Projects/Youtube mixer"`). VI2 haalt alleen
`media/` eruit (`docs/LIBRARY.md` "Waar media/ staat"); `opnames/`, `patronen/`, `proef/`, `standen/`,
`plannen/` en alle 164 bestanden onder `src/` blijven erin. De server serveert de code met
`createReadStream` uit de projectmap (`server/index.js` r.985-1015), op dezelfde libuv-draadpool
(standaard 4 draden; `UV_THREADPOOL_SIZE` staat nergens in de repo) die de Range-verzoeken van de
decks bedient. Het avondpakket telt uitgeplaatste code als **oranje** (`server/avondpakket.js` r.627:
"code in iCloud: haal ze thuis binnen"), en standaard staat `bekend: ["icloud"]`.

**Meting (deze kladmap, `meet/draadpool.mjs`).** Een VARVE-server uit een kopie, testserver-vlag,
eigen poort en mediamap. Een "pagina" van een deck = Range-verzoek van 268.800 B op `audio.wav`.
Als stand-in voor een uitgeplaatst bestand zonder netwerk: FIFO's zonder schrijver onder `src/`
(`open()` hangt in de draadpool, zoals STANDEN §3 het ook naboots met named pipes).

| draadpool | hangende modules | pagina vóór (ms) | pagina erna |
|---|---|---|---|
| 4 (standaard) | 0 | 16 / 11 / 10 | 6 / 5 / 7 |
| 4 | 2 | 56 / 13 / 6 | 5 / 4 / 7 |
| **4** | **4** | 25 / 24 / 9 | **hangt > 3 s, alle drie** |
| 16 | 4 | 19 / 8 / 5 | 8 / 7 / 3 |
| 16 | 16 | 15 / 10 / 5 | hangt > 3 s |

Vier code-bestanden die niet lokaal zijn, en geen enkel deck krijgt nog een pagina: stilte, op elke
track tegelijk. Wanneer vraagt de browser midden in een set code op? Bij het openen van het losse
venster (`video.html`), de APC-kaart, de Maschine-kaart, het planvenster, of na een herlaad van de
mixer. Een mixer-herlaad vraagt in één keer tientallen modules op.
*Aanname:* een uitgeplaatst bestand zonder netwerk gedraagt zich in de draadpool als zo'n FIFO
(blijft hangen). STANDEN §3 gaat van hetzelfde uit; op de Mac zelf is het niet gezien.

**Winst.** De grootste stiltekans die ik vond die niet van de hardware afhangt, en hij is klein te
dichten. Daarnaast verdwijnen de conflictkopieën met " 2" (CLAUDE.md: "die NOOIT committen").

**Toepassen** (2–4 uur, op een dag zonder set, ná #32):
1. Meteen, één regel, ook zonder verhuizing: in `VARVE.applescript` `startServer()` vóór `nohup node`:
   `export UV_THREADPOOL_SIZE=16`. Gemeten: 4 hangers hinderen de decks dan niet meer. Dit is een
   vangnet, geen oplossing (16 hangers blokkeren nog steeds).
2. Vangnet in de server: in `statisch()` (`server/index.js` r.986-988) na `stat`: is
   `info.size > 0 && info.blocks === 0`, antwoord dan meteen 503 "niet lokaal (iCloud)" en lees
   niet. Op APFS heeft een uitgeplaatst bestand `st_blocks` 0. *Aanname, eerst nakijken op Clay's
   Mac:* `stat -f '%z %b'` op een bestand dat `find -flags +dataless` noemt. Een test met een nep-`stat`.
3. Avondpakket: uitgeplaatste code onder `src/`, `server/` of de `.html`-pagina's **rood** bij vertrek
   (r.627: `'half'` -> `'fout'` voor die paden), met de meting hierboven als reden in de sub.
4. De echte stap: de checkout naar `~/Projects/varve` (buiten iCloud, waar de worktrees en de hub al
   staan). Daarbij verhuizen `opnames/`, `patronen/`, `proef/`, `standen/` en `plannen/` vanzelf mee.
   Aanpassen: `VARVE.applescript` `map`, `sets/paden.json` in de hub, het handwerkblok in
   AVONDPAKKET §7 (`R=`), de git-regel in CLAUDE.md. `tools/media-verhuis.mjs` laat zien hoe een
   droogloop plus `--doe` eruitziet. Hetzelfde patroon past hier (`tools/checkout-verhuis.mjs`).

**Risico.** Klein. Stap 1-3 raken het audiopad niet. Stap 4 is een rename, net als bij de media: de
paden in de database zijn relatief. Wel kan een vergeten absoluut pad (Dock-app, hub-set,
`kaart_pad`) de eerste start laten mislukken. Daarom eerst een droogloop.

---

## Kans 2. De zaaluitgang vastzetten: AirPods of een beamer mogen het geluid niet kapen

**Probleem.** De mixer kiest zijn uitgang niet zelf. `new AudioContext({ sampleRate: 48000,
latencyHint: 'interactive' })` (`src/engine/engine.js` r.119) zonder `sinkId`, en nergens in `src/`
staat `sinkId`, `devicechange` of `enumerateDevices`. Hij volgt dus de standaarduitvoer van macOS.
Het avondpakket controleert die één keer bij aankomst (punt Geluid, punt Bluetooth "zet Bluetooth
uit"). Verbinden de AirPods zich vanzelf midden in de set, of maakt macOS het HDMI-scherm van de
beamer de standaard, dan:
- gaat de zaal naar dat apparaat (*aanname:* Chrome verlegt een AudioContext op de standaardsink naar
  de nieuwe standaard; thuis in 2 minuten na te gaan);
- klopt `kanApart(ctx)` (vier kanalen, STUDIO §3) niet meer: de koptelefoon-cue is gebouwd op een
  uitgang met vier kanalen.

**Winst.** Weer een stiltekans live, en precies een die bij "overal heen" hoort: andere zalen, andere
schermen, AirPods in de tas. Bovendien vervalt aankomststap 2 ("Systeeminstellingen › Geluid › uitvoer
= het samengestelde apparaat").

**Toepassen** (~1 dag):
1. Eén keer kiezen in de KOPTELEFOON-rij: een lijst van `enumerateDevices()` (audiooutput). De namen
   zie je pas na één toestemming. Bewaren in localStorage (`varve.uitgang`): dat is per toestel, dus
   precies wat localStorage hoort te doen.
2. De engine krijgt het als optie (`new Engine({ uitgang })` -> `new AudioContext({ ..., sinkId })`,
   Chrome ≥ 110). Regel 1 blijft heel: de engine krijgt een id-string, geen DOM.
3. `ctx.onsinkchange` en `mediaDevices.ondevicechange`: valt het gekozen apparaat weg (de Scarlett
   eruit), dan een melding die blijft staan, en NIET stil terug naar de standaard. Komt het terug,
   dan `ctx.setSinkId(id)`.
4. Het avondpakket toetst bij aankomst dan "het gekozen apparaat is er", niet "de standaard is goed".
   Dat kan pas met companion stap 2 / avondpakket stap 8 (de mixer meldt zijn uitgang).

**Risico.** Gemiddeld. Het raakt het maken van de AudioContext. `setSinkId` op een lopende context kan
een hapering geven (niet gemeten). Bij `kanApart` en de koptelefoon moet het kanaalaantal van het
gekozen apparaat tellen. Eerst een headless check met een nep-`sinkId`, daarna de AirPods-proef thuis.

---

## Kans 3. Eén klik die de juiste weg kiest, met een noodroute zonder hub

**Probleem.** Drie stukken spreken elkaar sinds 13 okt tegen:
- VARVE.app start **altijd** de AV-hub (`VARVE.applescript` `zorgVoorHub()`, commit f016876, op
  main) en opent de Controlekamer met `?hub=`.
- De standaardopstelling "Avond 1 · APC direct" (`tools/standen/voorbeelden/apc.json`) noemt geen
  hub. Toch stuurt `mixerNu()` (`src/controle/controle.js` r.138-141) "mixer openen" via de hub zodra
  de Controlekamer `?hub=` heeft. Dat gebeurt ook bij `hub.mixerVia: false`, want `mixerAdres()` geeft
  dan `MIXER_GEWOON` en dat wordt overschreven.
- Het avondpakketprofiel `apc` (de kern en de standaard) heeft `avhub: "nee"`, en een open hub is daar
  oranje: "kan de APC vergrendelen" (AVONDPAKKET §5). Elke start met de Dock-app geeft dus "let op".

Daarbij is de hub-lease nooit op de hardware geproefd (VISIE §3; profielen.json `maschine.let`). Gaat
er live iets mis in de hub, dan is er geen weg terug met één klik: "Stoppen: kill het proces op 7700"
(VARVE.applescript r.10). De hub draait bovendien met `--blijf` en start na een crash zelf opnieuw. Een
mixer zonder `?hub=` naast een draaiende hub geeft twee schrijvers op de APC ("dan vechten de
lampjes", AV-app-hub README r.17).

**Winst.** Op de avond met alleen de APC, de kernset, gaat de APC niet langs een ongeproefde weg. Bij
een hubprobleem kost terugvallen één klik en geen terminal. De tegel blijft groen in plaats van
"let op 1".

**Toepassen** (2–3 uur):
1. VARVE.app start de hub alleen als de actieve opstelling `hub.set` heeft, of als hij er al draait.
   Lezen uit `standen/.actief.json` (`do shell script` met `node -e` of `plutil`), of via
   `GET /api/standen` zodra de server antwoordt. Zonder actieve opstelling: zoals nu (Clay wilde de
   Maschine vanzelf aan).
2. `mixerNu()`: een expliciete `mixerVia: false` gaat vóór de `?hub=` van de Controlekamer. Een test in
   `test/controle.test.mjs`.
3. Een noodknop in de Controlekamer, "zonder hub verder". De server stopt de hub NIET zelf (de hub
   ruimt zijn eigen apparaten op). Daarom de knop: (a) de mixer opnieuw openen zonder `?hub=`, en
   (b) de opdracht tonen, of een tweede Dock-app "VARVE (alleen APC)" (`maak.sh` met een argument;
   dezelfde code, `property metHub : false`). Een server-route die een ander proces doodt hoort hier
   niet (pkill-regel).
4. Profiel `apc` en de Dock-app gebruiken daarna dezelfde bron: de actieve opstelling.

**Risico.** Klein. Alleen de opstartlaag en één functie in de Controlekamer. Raakt workflow 1 (lag op
de controllers) alleen doordat de APC dan niet langs de hub gaat; noem het daar.

---

## Kans 4. Een kopie van de staat die niet in de tas zit

**Probleem.** `docs/BACKUP.md` (tak `visie/backup-kopie`, PR #28, open) §1: op 11 okt waren er
**nul** kopieën buiten de laptop. Geen Time Machine, geen schijf, geen launchd. De backups van de
server staan naast de library (`media/backups/`, straks `~/Varve-media/backups/`), en AVONDPAKKET
§6 paklijstregel 7 zegt het zelf: "de backups in `media/backups/` gaan mee in de tas". Gaat de laptop
onderweg verloren, dan gaat alles mee wat je met de hand hebt ingesteld: grids op slot, hotcues,
racks, pads, patronen, plannen, opstellingen, logs. Dat is het systeem uit pijler 4. Wat Clay zelf
instelde is volgens BACKUP.md §1 maar **16–20 MB** (set A). Alleen de 32 GB media vragen een SSD, en
die is er niet (HANDOFF 11 okt).

**Winst.** Wat niet te herbouwen is overleeft verlies of diefstal onderweg. Voor set A is geen
aankoop nodig.

**Toepassen** (een halve dag):
1. PR #28 mergen. `kopie.mjs` gebruikt `VACUUM INTO`, nooit `cp`: BACKUP.md §2 mat dat een `cp`
   hotcues en pads mist terwijl `quick_check` toch "ok" zegt.
2. Een doel voor set A dat er al is, zonder SSD: (a) de Omarchy-pc via Tailscale (`rsync` naar
   `clayk`; de pc staat thuis, dus dat is precies "blijft thuis"), of (b) een USB-stick van een paar
   euro die thuis blijft. De launchd-taak uit de tak (`tools/backup/launchd/`, elke ochtend 08:00,
   standaard niet geïnstalleerd) met dat doel.
3. Avondpakket: een punt "kopie buiten de laptop" (AVONDPAKKET §13 punt 10, "een sonde voor de
   reiskopie"). Groen als `controleer.mjs --doel` < 24 uur oud en heel is. Vervangt de handmatige
   paklijstregel 7.
4. Later, met een SSD: set B (media) vóór elke reis (`kopie.mjs --media`).

**Risico.** Klein. Alles is alleen-lezen op de bron. Herstel weigert als er al een library staat.

---

## Kans 5. Beeld zonder tweede machine: het zaalbeeld in één handeling, en de beslissende meting

**Probleem.** Onderweg zonder de Omarchy-pc is het zaalbeeld de standaard (BEELD §8): Varve's eigen
vormen in het losse venster, met de clips uit. Het recept kost **zeven handelingen** (BEAMER
"Zaalbeeld", r.307-313). `video.clips` heeft geen plek op de APC. Slepen naar de beamer en volledig
scherm zijn handwerk ("`getScreenDetails()`, niet gebouwd"). Opstellingen kunnen `vormen` en `beeld`
al valideren maar slaan ze over ("stap K", STANDEN §2), dus `onderweg-licht` bestaat niet. De
beslissende meting "Stroommachine naast VARVE op de Air" (`tools/headless/beeld-lokaal.mjs`, BE11) is
**nooit gedraaid** (BEELD §8, "Stand 10 okt"). Dat antwoord ("kan de pc thuisblijven") ontbreekt
daardoor nog steeds.

**Winst.** "Draagbaar met beeld" gaat van zeven handelingen naar twee (opstelling kiezen, één
APC-knop). Met de meting weet Clay of hij de pc ooit kan thuislaten.

**Toepassen** (1–2 dagen, in deze volgorde):
1. De meting (geen code, 14 min machinetijd, Mac vrij, niet op een speeldag): `node
   tools/headless/beeld-lokaal.mjs`. Daarna een tweede run met het zaalbeeld plus een video-opname,
   omdat dat de uitzendroute is (kans 6).
2. `video.clips` en het losse venster als één action, bijvoorbeeld `video.zaal` (clips uit, vormlaag
   aan, los venster open), op een vrije APC-plek in het mapje video. Eerst `define()`, dan de mapping,
   dan `node tools/mapping/eerder.mjs`.
3. Het losse venster op het tweede scherm: `getScreenDetails()` (Window Management, één toestemming)
   en `window.open(..., 'left=…,top=…')` op het scherm dat niet het ingebouwde is. Volledig scherm
   blijft één klik in dat venster (Chrome eist daar een gebaar).
4. Stap K van standen voor `vormen.aan` (en `video.clips`), zodat de opstelling `onderweg-licht`
   bestaat (`docs/verslagen/2026-10-10/UITWERKING.md` §3.1).

**Risico.** Laag tot gemiddeld. Stap 2-3 raken de videolaag en niet het audiopad. De meting vraagt
een rustige Mac. Het venster op de beamer zetten hangt af van de toestemming in Chrome.

---

## Kans 6. Uitzenden met beeld: beeld en geluid gelijk in de stream

**Probleem.** Route C (Varve -> OBS -> dienst, UITZENDEN §2) laat OBS het geluid uit Varve halen via
udp. Dat geluid komt uit de opname: de worklet geeft het **per seconde** door
(`opnemer-worklet.js` r.12 `PER_STUK = 48000`), de volger kijkt elke 250 ms
(`uitzend.js` r.333), en in pijp en encoder zit 0,12–0,54 s (UITZENDEN §4, E1). De camera
(Continuity), de HDMI-stick van de Stroommachine of een venstercapture van het zaalbeeld komen in OBS
**live** binnen. *Schatting, niet gemeten:* het geluid loopt in de stream 1–2 s achter op het beeld,
plus de buffer van OBS' mediabron. Vormen en Stroommachine die op de tel pulsen (BEELD §2), pulsen in
de uitzending dan naast de tel. UITZENDEN §10 noemt "OBS' mediabron op udp en zijn vertraging" niet
getest. Het verschil tussen beeld en geluid staat nergens als risico.

**Winst.** Beter beeld in de stream: "met visuals" klopt pas als de puls op de kick valt. De thuisproef
(stap 5) vindt dit sowieso, maar dan pas na routes en bediening (stap 3-4). Wie het nu weet, kiest
meteen de goede bron.

**Toepassen** (een halve dag meten, daarna een keuze):
1. Meten bij de thuisproef (UITZENDEN stap 5b), 20 min, Clay erbij: `video.flash` plus een klik
   (een korte `track.N.play` op de demo) en in de OBS-opname de afstand tussen flits en klik. Één
   getal per route.
2. Drie routes, op volgorde:
   (a) **het geluid live in OBS halen**. Heeft de Scarlett 2i2 loopback (4e generatie: ingang 3/4 =
   uitgang 1/2, *aanname: generatie onbekend*), dan is dat precies de zaal, na de limiter, zonder de
   cue (die gaat via de Mac-uitgang 3/4), met ~10 ms vertraging en zonder stuurprogramma.
   `server/uitzend.js` blijft dan voor bestand en in-app.
   (b) Het **beeld-profiel** (mengcanvas plus master in één mp4) als enige Varve-bron in OBS. Beeld
   en geluid zijn dan gelijk; de camera krijgt in OBS een vertraging op de bron.
   (c) Via udp blijven en alle live bronnen in OBS vertragen (Video Delay op asynchrone bronnen;
   venstercapture kan maar 500 ms Render Delay). Dat is broos.
3. Met (a): een avondpakketpunt "loopback aanwezig" alleen in een profiel `uitzenden` (data in
   `profielen.json`).

**Risico.** Laag: het is meten en kiezen. Bij (a) moet de cue echt niet in de loopback zitten (thuis
nagaan met de fader dicht en de cue aan). App-audio van OBS zelf (ScreenCaptureKit) kan de vier
kanalen mixen, en dus de cue meenemen: niet gebruiken voor je dat gezien hebt.

---

## Wat ik bewust niet als kans opnam

- **Companion zonder internet** (`VARVE_BIND` op de hotspot): `docs/verslagen/2026-10-10/UITWERKING.md` §3.1 heeft het al.
  "Streamen vanaf elke plek" betekent toch al data op de iPhone. De iPad als scherm valt onder de
  werkruimte-workflow.
- **De hub-lease op de hardware proeven**: dat is een proefavond en geen bouwwerk. Kans 3 zorgt dat
  de kernavond er niet van afhangt. De lag via de hub hoort bij workflow 1.
- **Uitzenden stap 3-8**: de volgorde in UITZENDEN §11 is goed. Kans 6 verandert alleen welke bron
  OBS krijgt.
- **De draadpool onder gewone last** (8 audio- en 8 videostromen plus de opname-writes op 4 draden).
  Op Linux in de paginacache niet representatief te meten. Op de Air: meenemen in de meting van
  kans 5 stap 1.

## Volgorde

1. Kans 3 stap 2 en kans 1 stap 1 (samen < 1 uur, raken het audiopad niet). Kunnen vóór #32 op main.
2. #32 en de fix-PR's naar main (zonder dat werkt niets van draagbaar bij Clay), dan kans 1 stap 2-4
   en kans 4.
3. Kans 5 stap 1 en kans 6 stap 1: twee metingen, een rustige middag.
4. Kans 2 en kans 5 stap 2-4: bouwen, na de metingen.
