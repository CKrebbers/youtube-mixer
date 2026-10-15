# Waar de meeste winst zit, en hoe je het toepast (13 okt 2026)

Voor Clay. Gelezen op tak `studio/afmaken` (7debab6). In de repo is niets veranderd: metingen en
scripts staan in deze map (`winst/`). Zeven onderzoekers keken elk vanuit een eigen hoek: live
betrouwbaarheid, prestaties, geluid, draagbaar en beeld, het vak (Traktor, Rekordbox, Mixxx), de
DJ-workflow en de codebasis. Daarna probeerden drie sceptici elke kans onderuit te halen. Hieronder
staat wat overbleef, gerangschikt op **winst gedeeld door moeite**. Wat de kans op stilte of een crash
tijdens een set verkleint, weegt het zwaarst.

**Hoe je de cijfers leest.** Winst en moeite lopen van 1 tot 10. Bij moeite is 1 een paar uur, 3 een
dag en 6 een halve week. "Live" betekent dat het de kans op stilte, een crash of zwart beeld tijdens
een set verkleint. **Wanneer** is één van drie: *nu*, *na de proef* (eerst op de hardware of met je
oor), of *volgende versie*.

**Eén eerlijke kanttekening.** De lijst met het oordeel van de sceptici kwam bij mij afgekapt binnen,
na de live-kansen K1–K5. Van de andere hoeken (video, geluid, draagbaar, codebasis) heb ik het oordeel
zelf opgemaakt. Daarvoor gebruikte ik hun notities en de natoetsen die de sceptici hier achterlieten:
`goedkoop/` (de goedkope videofix), `skep-eq/` (de EQ-krommes), `ln-skep/` (loudnorm) en `skep-draad/`
(de draadpool). Waar een punt op een aanname rust, staat dat erbij.

---

## De top 10

| # | Wat | Live | Winst | Moeite | Wanneer | Eerste stap |
|---|---|---|---|---|---|---|
| 1 | **De opname lekt geheugen**: lees het antwoord van elke POST | ja | 8 | 1 (2–4 u) | nu | `res.json().catch(()=>{})` in opnemer.js op het succespad |
| 2 | **Video's verdringen de audio**: knip de videoantwoorden op 2 MB | ja | 7 | 1 (2–3 u) | nu | één regel in `statisch()`, dan `acht.mjs` |
| 3 | **De server mag even weg zijn**: opname wacht, één melding, herstartlus, 60 s vooruit | ja | 6 | 2 (½ dag) | nu (hang-detectie later) | rij in `opnemer.js`, lus in `VARVE.applescript` |
| 4 | **Code in iCloud kan alle decks stilleggen**: vangnet nu, verhuizen later | ja | 5 | 1 (vangnet ½ u) | vangnet nu, verhuizen na de merge | `UV_THREADPOOL_SIZE=16` in de Dock-app |
| 5 | **Scherm en Mac wakker houden** | ja | 3,5 | 1 (2–3 u) | na 2 min meten op de Mac | `pmset -g assertions` tijdens het spelen |
| 6 | **Waarschuwen bij Cmd+R/Cmd+W, en herstel na herladen of crash** | ja | 6 | 3 (½ u + ~1 dag) | waarschuwing nu, herstel nu ná #1 | `beforeunload` in app.js |
| 7 | **Een kopie van je instellingen die niet in de tas zit** | nee (verlies) | 6 | 2 (½ dag) | nu | `tools/backup` (in main sinds 15 okt, PR #28 + #31), doel: USB-stick of de pc |
| 8 | **De werkplaats**: tests parallel, CI op elke PR, één integratielijn | nee (sneller) | 5 | 2 (~1 dag) | parallel en CI nu, opruimen na de proef | pool in `test/alles.mjs` |
| 9 | **Loudnorm drukt stil de dynamiek plat** (albums, ambient): lineair normaliseren | nee (geluid) | 6 | 3 (1 dag + nachtwerk) | telling nu, bouwen nu als het veel nummers raakt | `loudnorm-telling.mjs` op je library |
| 10 | **De kill snijdt veel breder dan "bas weg"**: een isolator-EQ | nee (geluid) | 6 | 3 (1 dag) | na de proef (jouw oor beslist) | prototype naast de oude, A/B luisteren |

Net buiten de top 10 (goed onderbouwd, maar minder winst per uur, of eerst een meting nodig): de
zaaluitgang vastzetten (`sinkId`), de hub alleen starten als de opstelling hem vraagt, een
luidheidsmeter op de master, video kopiëren in plaats van opnieuw coderen bij de ingest, secties bij
het binnenhalen, één oordeel voor "past bij" en de auto-DJ, het cuepunt op het begin van de muziek, en
sync-lock. Ze staan onderaan bij "Wat afviel of later komt".

---

## Per punt

### 1. De opname lekt geheugen: lees het antwoord van elke POST

**Wat er mis is.** Zolang je opneemt, groeit het mixertabblad met ~23 MB per minuut, ook als er niets
speelt. Een garbage collection haalt dat niet terug. Over een set van drie uur is dat ~4 GB. In de
duurproef viel de renderer om na ~35 minuten (950 MB, gestopt door de geheugengrens van de container).
Op je Mac wordt dat eerder swap en haperend geluid dan een crash, maar het blijft het grootste risico
dat ik gemeten heb.

**Bewijs.** `lek.mjs`. Een opname met een stil deck: 189 → 315 MB, na GC nog 306. Een kale POST van
192 kB/s zonder het antwoord te lezen: 188 → 279, na GC 266. Dezelfde POST met het antwoord gelezen:
188 → 192, na GC 171. Een scepticus mat het opnieuw tegen de echte server
(`skep-k1/proef.mjs`): ~410 kB blijft per POST hangen als je het antwoord niet leest, ~13 kB als je het
wel leest. De plek is `src/opname/opnemer.js:183`: `if (res.ok) { this.bytes += …; return; }`, zonder
dat het antwoord gelezen wordt. Hetzelfde patroon staat bij de videostukken (r.137–140), de
klaar-POST, `src/control/handelingen.js:206–209` en `src/ui/status-zender.js:109–113` (elke 900 ms).
Streamen, seek, laden en `fx.next` lekken niet: die zakken na GC terug.

**Toepassen.**
1. Op de vijf plekken op het succespad `await res.json().catch(() => {})` vóór de `return`. In
   status-zender zonder `await`. Gebruik `json()`, niet `body.cancel()`: de nep-fetches in
   `test/opnemer.test.mjs:49` en `test/handelingenlog.test.mjs:720` kennen alleen `json()`, dus zo
   breekt er geen test.
2. Eén check in `test/opnemer.test.mjs`: na N stukken is `json()` N keer aangeroepen.
3. Nameten: `PROEF=opname node winst/lek.mjs`. Na GC hoort de renderer terug te zijn op ~190 MB.
4. Op je Mac bevestigen: 10 minuten opnemen met Taakbeheer van Chrome open, eerst zonder en dan met de
   fix. De fix kan geen kwaad, dus bouwen mag vóór die meting.
5. Eén zin bij het opname-blok in CLAUDE.md: elke fetch leest of annuleert zijn antwoord.

**Risico.** Vrijwel nul. Het is laag ui/opname; de drie regels worden niet geraakt. Het is gemeten in
Chromium 1194 op Linux, dus de bevestiging op de Mac is nog nodig.

### 2. Video's verdringen de audio: knip de videoantwoorden op 2 MB

**Wat er mis is.** De server praat HTTP/1.1, en Chrome opent per host hooguit 6 verbindingen. Elke
zichtbare `<video>` houdt er een vast terwijl hij een minuut of meer vooruit buffert. De decks halen hun
geluid over dezelfde host. Bij zes of meer zichtbare video's moet de audio wachten op een vrije
verbinding.

**Bewijs.** `acht.mjs`, met 8 decks die spelen en 30 sprongen. Zonder video wacht een audioverzoek
p90 30 ms. Met 6 zichtbare video's wacht het **p90 17 s, max 24 s**, met gaten van 4,8–17,5 s per deck:
dat is stilte. De knik ligt precies tussen 5 en 6 video's, dus op de limiet. Hotcues, secties en de
auto-DJ springen, en die sprongen vangt de buffer van 20 s niet op.

De onderzoeker stelde voor de video naar een andere hostnaam te verhuizen (CORS, ½–1 dag). Een
scepticus vond iets veel goedkopers (`goedkoop/`): laat de server een open Range-verzoek op
`video.mp4` met hooguit 2 MB beantwoorden. De video vraagt dan zelf het volgende stuk, en houdt een
verbinding nooit lang vast. Met 8 decks en de videopaneel open, zelfde machine:

| | audio wacht p90 / max | gat per deck |
|---|---|---|
| zoals nu (`goedkoop/nocap.txt`) | 4592 / 16 166 ms | tot 770 ms, sprongen ≥ 5 s |
| 2 MB-plafond (`goedkoop/cap2mb.txt`, `-b`) | 119–130 / 547–892 ms | 160–530 ms |

**Toepassen.**
1. In `server/index.js` `statisch()` (rond r.1003), in de tak met een open einde: alleen voor
   `/^\/media\/[\w-]+\/video\.mp4$/` `eind = Math.min(eind, start + 2 * 1024 * 1024 - 1)`. Dat is
   letterlijk wat de proef deed, daar nog achter een vlag.
2. Goedkoop erbij: `priority: 'high'` in de standaard-`haal` van de StreamBron (`src/engine/bron.js:436`).
   Gemeten halveert dat de ergste wachttijd.
3. Test in `test/server.test.mjs`: een open Range op video.mp4 geeft 206 met hooguit 2 MB, en audio.wav
   blijft zoals hij was. Nameten met `acht.mjs` (8 zichtbaar). Wat je wilt zien: p90 onder 300 ms en geen
   gat boven 1 s. Ook `tools/headless/beamer.mjs` en `kijk.mjs` opnieuw draaien, zodat het beeld niet
   zwart is en de video in de pas blijft.
4. Pas als dat tekortschiet: de tweede hostnaam (prestaties, kans 1).

**Risico.** Klein. De video doet meer en kleinere verzoeken. Gemeten bleven ze allemaal spelen
(readyState 4). Via Tailscale (https, HTTP/2) speelt het probleem niet; de knip kan daar niets breken.

### 3. De server mag even weg zijn

**Wat er mis is.** Valt de server weg (OOM, een native fout, een kill, per ongeluk `pkill node`), dan
zijn alle decks na ~21 s stil, en niemand start hem opnieuw: de Dock-app doet één keer
`nohup node server/index.js &` (`VARVE.applescript:98`). De hub heeft wél een bewaker (`--blijf`).
Ondertussen gooit de opname elk stuk na 3 pogingen in 1,5 s weg (`opnemer.js:176–191`), ook de 21 s die
de zaal nog hoorde. Elke verloren seconde geeft een nieuwe rode melding die blijft staan
(`opname-knop.js:18`). Omdat de tekst per seconde verschilt, voegt `meldingen.js` ze niet samen.

**Bewijs.** In de duurproef, beide runs (`duur-45.out`): SIGKILL, stilte na 21 s, 30 stukken weg. Na
de herstart antwoordde de server binnen 0,8–1,0 s en klonk het binnen ~1,5 s vanzelf weer. De
sceptici zijn het eens dat het mechanisme klopt. Maar een échte servercrash tijdens het spelen is
nooit gezien: de server vangt JS-fouten op (`server/index.js:1831`). Daarom is de winst lager dan de
onderzoeker dacht, en doen we alleen de goedkope delen.

**Toepassen.** Op volgorde, eerst wat zeker schade doet:
1. **De opname laat niets meer vallen (~2 u).** In `opnemer.js` `_verstuur` en in `handelingen.js`:
   blijf opnieuw proberen met backoff (0,25 → 2 s) zolang de opname loopt, de rij korter is dan
   ~5 min (~57 MB) en de schijf niet vol is. `?frame=N` maakt herhalen al veilig. Pas bij stop of een
   volle rij geldt de oude regel "gat = stilte".
2. **Eén melding (~1 u).** In `opname-knop.js` één vaste tekst ("opname: server antwoordt niet, N s in
   de wacht"), die meegroeit, en een "weer goed" die hem weghaalt.
3. **Herstartlus (~30 min).** In `startServer` van `VARVE.applescript` een lus die de server opnieuw
   start als hij met een fout stopt, hooguit 5 keer per minuut (naar het voorbeeld van
   `av-app-hub/src/blijf.js`). Haal in `docs/TAILSCALE.md:62–86` de LaunchAgent weg, of noem hem alleen
   nog als alternatief: twee mechanismen die allebei starten, botsen op poort 8777.
4. **Langer vooruit voor wat je hoort (~1–2 u, uit de hoek van het vak).** `vooruit = 60` in plaats van
   20 (`stream-kern.js:250`) voor een track die speelt met fader × crossfader > 0. Dat kost +8 MB per
   hoorbare stereotrack. De zaal hoort dan pas na een minuut iets, en de herstart duurt 2 s.
5. Toets: `duur.mjs` (doet de kill al). Wat je wilt zien: 0 stille vensters, een WAV zonder gat en
   hooguit één opnamemelding.
6. *Volgende versie:* hang-detectie (hartslag plus kill) pas als er ooit een hang in `server.log`
   opduikt, en dan ruim: ~10 s, met een gratieperiode bij het opstarten. **Gebouwd 16 okt op verzoek (AR18)**:
   drie keer geen antwoord in 5 s-stappen (~15 s), 120 s bij het opstarten (`tools/varve-app/server-lus.sh`). Ook de noodlus op de maat, zoals
   de "emergency loop" van de CDJ (vakgebied, kans 2).

**Risico.** Klein. Een lus die eindeloos herstart wordt begrensd en gelogd.

### 4. Code in iCloud kan alle decks tegelijk stilleggen

**Wat er mis is.** De checkout staat in iCloud. De server serveert de code met `createReadStream` op
dezelfde libuv-draadpool (standaard 4 draden) die ook de Range-verzoeken van de decks bedient. Hangen
er vier bestanden die macOS uit iCloud moet halen terwijl er geen netwerk is, dan krijgt geen enkel
deck nog een pagina.

**Bewijs.** `meet/draadpool.mjs` bootste vier hangende bestanden na (FIFO's, net als STANDEN §3). Met de
standaardpool hingen daarna alle drie de pagina's langer dan 3 s. Met `UV_THREADPOOL_SIZE=16` liepen ze
door (8/7/3 ms). Wanneer gebeurt dit midden in een set? Bij het openen van het losse venster
(`video.html`, 15 modules), de Maschine-kaart (55), het planvenster, of bij een herlaad van de mixer
(117 modules; telling van `skep-draad/graaf.mjs`). Door `no-store` haalt de browser ze elke keer
opnieuw op. **Aanname:** dat macOS een uitgeplaatst codebestand op een speelavond ook echt van iCloud
moet halen. Code die je vaak gebruikt blijft meestal lokaal staan.

**Toepassen.**
1. *Nu, één regel:* `export UV_THREADPOOL_SIZE=16` vóór `nohup node` in `VARVE.applescript`
   `startServer()`. Kost niets en neemt de gemeten ramp weg.
2. *Nu, op de Mac nakijken:* `find "<projectmap>" -flags +dataless | head` (staat er code die niet
   lokaal is?). Is dat zo, dan in `statisch()` na `stat`: `info.size > 0 && info.blocks === 0` geeft
   meteen 503 "niet lokaal (iCloud)" in plaats van te gaan wachten.
3. *Na de merge van #32:* de checkout naar `~/Projects/varve`, buiten iCloud, waar de hub en de
   worktrees al staan. Dan verdwijnen ook de conflictkopieën met " 2". Aanpassen: `map` in de Dock-app,
   `sets/paden.json` in de hub, AVONDPAKKET §7 en de git-regel in CLAUDE.md. Eerst een droogloop, zoals
   `tools/media-verhuis.mjs` dat doet.

**Risico.** Stap 1–2: geen. Stap 3: een vergeten absoluut pad laat de eerste start mislukken; de
droogloop vangt dat op.

### 5. Scherm en Mac wakker houden

**Wat er mis is.** Er is niets dat het scherm aan houdt (`grep wakeLock\|caffeinate` vindt niets), en
het avondpakket kijkt niet naar `displaysleep`. **Aanname:** macOS telt MIDI en HID van de APC en de
Maschine niet als gebruikersinvoer. Werk je alleen met de controllers, dan gaat het scherm uit na de
energie-instelling, en de beamer gaat mee. Chrome houdt bij hoorbaar geluid de Mac wakker, maar niet het
scherm. Zijn eigen video-wakelock werkt alleen voor een zichtbare `<video>`, en de beamer toont een
WebGL-canvas.

**Toepassen.**
1. Eerst 2 minuten op de Mac: tijdens het spelen `pmset -g assertions`. Staat er een
   `PreventUserIdleDisplaySleep` van Chrome? Raak daarna 10 minuten alleen de APC aan.
2. Als het scherm uitging: `navigator.wakeLock.request('screen')` in `src/ui/app.js` en
   `src/video/beamer-venster.js` zolang de audio loopt of het losse venster open is, en opnieuw na
   `visibilitychange`. Gebruik **één helper**: de werkruimte-workflow plant dezelfde Wake Lock voor de
   iPad (ONTWERP C4/S7).
3. Op de server `caffeinate -di -w <pid>` zolang `speeltDeck()` waar is (macOS, geen dependency). In het
   avondpakket `pmset -g` → displaysleep en sleep als oranje punt.

**Risico.** Geen. Klopt de aanname niet, dan zijn het een paar regels die niets doen.

### 6. Waarschuwen bij Cmd+R/Cmd+W, en herstel na herladen of crash (ONTBREEKT A5)

**Wat er mis is.** Na herladen of een crash zijn alle decks leeg. `herlaad.mjs`: de app is in 0,6–1,7 s
terug, maar er staat niets geladen. `beforeunload` waarschuwt alleen tijdens een opname
(`opname-knop.js:24`). Het toetsenbord negeert Cmd, dus Cmd+R gaat gewoon naar Chrome.

**Waarom niet hoger.** De vijf Chrome-crashes van september zijn met de Web Lock en de wachtrij
opgelost, en met `?hub=` vraagt de mixer geen MIDI meer aan. De crash die nu het meest waarschijnlijk is,
is punt 1, en die is in een paar uur weg.

**Toepassen.** De sceptici vonden een veel kortere weg dan het oorspronkelijke plan. Alles wat nodig is,
bestaat al:
1. *Nu, ½ uur:* `beforeunload` in `src/ui/app.js` zolang er een deck speelt, wacht of laadt, of de
   automaat aan staat.
2. *Nu, ná punt 1, ~1 dag:* een nieuwe `src/ui/herstel.js` die elke ~5 s en na elke laad
   `leesStand()` (`src/control/handelingen.js:335`) naar localStorage `varve.herstel` schrijft. Die geeft
   per track het library-nummer, positie, rate, loop, cue, hotcues, rack met standen, kills,
   crossfaderkant en alle value-actions. Alleen het tabblad met de Web Lock schrijft, en alles in
   try/catch. localStorage overleeft een crash van het tabblad en een herstart van de laptop.
3. Bij het opstarten: is de stand jonger dan ~30 min, stond er een library-nummer en zijn de decks nu
   leeg? Dan één melding met een knop "herstel de set van 21:43", plus een action `app.restore` (eerst
   `define()`, een uitleg in `apc-beschrijf.js`, overslaan bij terugspelen).
4. Herstellen gebeurt met `maakUitvoerder().stand(kopie)` (`src/control/terugspelen.js:429`), met
   `speelt`/`wacht` op false. Er start niets vanzelf; een tweede druk speelt verder. Hotcues, pads,
   racks, grid en toonsoort komen al vanzelf terug bij het laden.
5. Toets: een unit-test met een nep-localStorage, plus een headless-proef naar het model van
   `herlaad.mjs` (herladen midden in een loop met rack en kill aan → dezelfde `leesStand`).

**Risico.** Klein. Instrumenten en de koptelefoon staan niet in de stand; een instrumenttrack komt dus
niet terug. Dat is aanvaardbaar. Dit staat los van de opstellingen (STANDEN), die bewust alleen
beginwaarden zetten.

### 7. Een kopie van je instellingen die niet in de tas zit

**Wat er mis is.** Op 11 okt waren er nul kopieën buiten de laptop (`docs/BACKUP.md` §1). Het
gereedschap staat sinds 15 okt in main (PR #28 samengevoegd met #31: de
Chrome-sleutels zitten nu in library.db en dus in de kopie). De backups van de server staan naast de library, en volgens de paklijst
gaan ze mee in de tas. Raakt de laptop kwijt, dan is alles weg wat je met de hand instelde: grids op
slot, hotcues, racks, pads, patronen, plannen en opstellingen. Dat deel is maar 16–20 MB.

**Toepassen.**
1. Gedaan op 15 okt: het gereedschap staat in main (PR #28 en #31). `tools/backup/kopie.mjs`
   gebruikt `VACUUM INTO` en nooit `cp`; een `cp` mist hotcues terwijl `quick_check` toch "ok" zegt
   (BACKUP.md §2).
2. Een doel dat je al hebt: een USB-stick die thuis blijft, of de Omarchy-pc via Tailscale (`rsync`).
   Zet de launchd-taak uit de tak (`tools/backup/launchd/`, elke ochtend) op dat doel.
3. Avondpakket: een punt "kopie buiten de laptop", groen als die minder dan 24 uur oud en heel is.
4. Later, met een SSD: ook de media vóór elke reis (`kopie.mjs --media`).

**Risico.** Klein: de bron wordt alleen gelezen, en herstel weigert als er al een library staat.

### 8. De werkplaats: tests parallel, CI op elke PR, één integratielijn

**Wat er mis is.** `node test/alles.mjs` draait 94 bestanden na elkaar: 8,5 min op je Mac, 12 min hier.
Elke agent draait hem vóór elke commit, vaak een paar keer per spoor. Er is geen CI, dus breuk komt pas
bij het samenvoegen aan het licht (339310b, b61d8e3, 03275d3 zijn allemaal reparaties achteraf). Er zijn
drie lijnen naast elkaar: `main` (wat je speelt), `studio/integratie` en `studio/afmaken`. Van de negen
open PR's zitten er vijf al in afmaken. **Niets van de draagbare stapel staat op main:** geen
avondpakket, geen opstellingen, geen companion. Je Dock-app start de code van main.

**Bewijs.** `alles-serieel.txt`: 737 s. Met 4 tegelijk (`scripts/parallel.mjs`, langste eerst): 368 s,
op een machine die al overbelast was. 61 bestanden duren minder dan 3 s, samen 43 s.

**Toepassen.**
1. `test/alles.mjs`: een pool van `os.availableParallelism()` processen, langste eerst (de duur uit
   `test/.duur.json`, buiten git). Tests met een tijdsgrens of afvalmeting (renderblok, fm-schaal,
   gridauto, kaart, vormen-*) krijgen `// @alleen` en draaien ná de pool. Plus `--snel` met de 61 snelle
   bestanden. Verwacht op de M1 ~1,5–2 min; dat is een aanname tot het op de Mac gemeten is.
2. `.node-version` (26.8.2), en een waarschuwing bij een andere Node in plaats van drie rode tests.
3. `.github/workflows/test.yml` op `macos-14` met Node 26.8.2 en ffmpeg via brew. Alleen code, geen
   media, dus het past bij "persoonlijk instrument".
4. *Na de proef:* één PR afmaken → main. Sluit #32–#34, #39 en #40 met "zit in #N". Eén regel in
   CLAUDE.md: elk spoor gaat terug in de integratietak, naar main alleen die tak.
5. *Daarna:* CLAUDE.md (1880 regels, ~45k tokens per agent) terug naar een kern van ~250 regels, met de
   rest in geneste `CLAUDE.md` per laag (`src/engine/`, `src/control/`, `server/` …). Pas als de open
   PR's samengevoegd zijn: CLAUDE.md is het grootste conflictbestand.

**Winst voor jou.** Agentrondes die minuten sneller zijn, een rode PR die je ziet vóór hij samengaat,
en minder kans dat een fix in de verkeerde lijn blijft liggen en op de avond ontbreekt.

### 9. Loudnorm drukt stil de dynamiek plat

**Wat er mis is.** `server/ingest.js:357–372` vraagt `loudnorm … linear=true` en het commentaar zegt
"één vaste correctie". Maar ffmpeg doet dat alleen als de piek past na de versterking én LRA ≤ 11.
Anders valt hij zonder melding terug op dynamisch: een AGC van 3 s. Dat raakt precies jouw repertoire:
albums, mixen met stille intro's, ambient.

**Bewijs.** `ln/meet.sh`, ffmpeg 6.1.1, bevestigd in `ln-skep/`. Een bestand van vier stukken die elk
6 dB uit elkaar liggen (LRA 18) komt eruit als −32,3 / −18,0 / −12,9 / −12,9 LUFS. De opbouw is weg: de
laatste twee zijn even luid. Een zacht bestand met losse pieken mist het doel (−15,9 in plaats van −14).
De library-kolom toont toch "→ −14 LUFS".

**Toepassen.**
1. *Nu, minuten:* `node winst/loudnorm-telling.mjs ~/Desktop/…/media/library.db` (alleen lezen). Dat zegt
   hoeveel van je nummers het raakt. En `loudnorm-proef.sh D.wav` op de Mac, om te zien of Homebrew-ffmpeg
   dezelfde regel heeft.
2. Pass 2 zonder loudnorm: `toegepast = min(−14 − I, −1,5 − TP)` en `-af volume=…dB`, altijd lineair.
   Wat ontbreekt (`rest`, geklemd op +6 dB) gaat in een nieuwe kolom `loudness_rest` (migratie;
   `library.test` rekent met `SCHEMA.length`).
3. Deck: één helper `trimVersterking()` = `trim × 2 × dbToGain(rest)` op de drie plekken met
   `_ui.trim * 2` (`deck.js` r.1438, 1749, 1772). Losgesleepte bestanden: BS.1770 op de AudioBuffer in
   `laadGeheugen`, bij het laden en niet op de audiothread.
4. Wat al dynamisch binnenkwam opnieuw binnenhalen via de nachtwachtrij (die stopt al als er een deck
   speelt), en de stems opnieuw splitsen. Grid, toon en secties blijven gewoon staan.
5. Test: `test/ingest.test.mjs` met bestand D. Eis: na de ingest liggen de stukken nog 6 dB uit elkaar.

**Risico.** Laag tot middel. Een vergeten plek die `trim` leest, klinkt zachter; daarom één helper.

### 10. De kill snijdt veel breder dan "bas weg": een isolator-EQ

**Wat er mis is.** De EQ is een lowshelf 200 Hz, peaking 1 kHz en highshelf 4 kHz, en de kill zet die op
−70 dB (`audio-graph.js:39–46`, `EQ_KILL_DB` r.97). Bij zo'n diepe stand is een shelf heel breed.

**Bewijs.** Chrome `getFrequencyResponse`. Nagerekend door de scepticus (`skep-eq/rbj.mjs`) en door mij
(`node winst/rbj-check.mjs`): een **bass-kill haalt ook 600 Hz met 16 dB en 1 kHz met 8 dB weg**. Een
mid-kill haalt 16 dB uit 100 Hz en 12 dB uit 12 kHz. Een high-kill haalt 11 dB uit 1 kHz. Dat raakt de
basiswissel met de hand, de kill-knoppen in grid-modus klank, én elke blend van de auto-DJ: die zet
`low: 0` (= kill) op één van de twee (`planner.js:519–523`), dus één nummer klinkt steeds hol tot 1 kHz.
Een Linkwitz-Riley-isolator (prototype `iso-chrome.html`) laat bij een bass-kill 400 Hz op −0,5 dB en
1 kHz op 0,0. De knop zelf voelt bijna gelijk.

**Toepassen.**
1. In `createDeckChain` (`audio-graph.js:28–67`) een drieweg-isolator met LR4 (twee Butterworth-biquads
   per kant, Q −3,0103 dB; een allpass op 4 kHz in de lage tak voor de fase). Op 1/1/1 is hij vlak tot op
   0,0 dB.
2. Banden als versterking: `setEqBand` → `zetDoel(gain, dbToGain(eqDb(norm)))`, kill →
   `killVersterking` (die bestaat al). De knop en `eqDb` blijven gelijk (regel 2).
3. Tests in `engine.test.mjs` en `instrumenten.test.mjs` die dB van een biquad lezen, omzetten naar
   amplitude. Een headless-proef van de frequentierespons.
4. CPU gemeten (`iso-cpu.html`): ~0,4% van een kern per track. Op de M1 opnieuw meten met
   `tools/bench/`.
5. **Jij beslist op het oor** (VISIE §5.4). Oud tegen nieuw, op een bass-swap met de hand en op een blend
   van de auto-DJ. Bouw hem achter een schakelaar tot je gekozen hebt.

**Risico.** Middel. Een paar ms fase in de lage band, voor alle tracks gelijk; beatmatch en cue
verschuiven niet ten opzichte van elkaar. "Bit voor bit het oude pad" geldt niet meer voor de EQ zelf.

---

## Wat afviel of later komt, en waarom

**Afgevallen door de sceptici**
- **Een lampjesbord in de mixer (audio, server, buffer, worklets).** Een lopende AudioContext gaat in
  Chrome niet vanzelf op suspended; de gemeten stilte kwam van een `ctx.suspend()` die de proef zelf
  deed. De Controlekamer toont "staat stil" al (`controle.js:309`). Rode meldingen blijven bewust staan.
  Een worklet opnieuw bouwen na `processorerror` raakt het audiopad. **Wat overblijft is klein:** de
  ene meegroeiende melding plus "weer goed" (zit in punt 3), en een `statechange`-luisteraar die bij
  `interrupted` een melding geeft (minuten werk, doe hem mee met punt 3).
- **Speelstand voor de server** (zwaar werk wachten tot er niet gespeeld wordt). De stems zijn bewust zo
  gelaten (VRAGEN N3, STEMS.md: "zo laten tot het hapert"), de heranalyse wacht al op de ingest, en de
  schade op de Air is niet gemeten. Komt terug zodra de warmtemeting (BE11) iets laat zien.
- **Hang-detectie met SIGKILL** (deel van punt 3). Valse kills kunnen een ingest, Demucs of backup
  breken, en er is nooit een hang gezien. Pas als er een in `server.log` opduikt.

**Al gedaan of van een andere workflow**
- **De renderloop in rust trager** (prestaties, kans 5). Spoor `controller-invoer` haalde de grootste
  oorzaak al weg (brede `:has()` in styles.css: hoofdthread in rust 713 → 457 ms/s, stijl 166 → 31 ms/s),
  en "de renderloop op een budget" staat in hun volgende stappen. Niet dubbel bouwen.
- **Sync-lock** (vakgebied, winst groot, 3–4 dagen). De werkruimte zet hem in E2 "volgende versie", en hij
  werkt alleen op zekere stukken. Die zijn in jouw library schaars (AUTO-DJ.md: "bijna alle grids zijn
  onzeker"). Eerst laten zien wat de beatgrid-analyse oplevert (spoor `beatgrid-analyse`, de benchmark van
  14 okt), daarna bouwen, met één vraag aan jou: lang drukken op Solo = lock?
- **Golfvorm in kleur per band** (vakgebied, kans 4). Hoort bij de uitlijnweergave van de werkruimte (S2).
  Daar meenemen; het rekenwerk is goedkoop (6 min muziek in 278 ms, 198 kB).
- **Het eerlijkere sync-lampje** (0,05 → 0,005 bpm) staat al in werkruimte S1.

**Goed, maar minder winst per uur (volgende ronde)**
- **De zaaluitgang vastzetten** (`sinkId`, `ondevicechange`, ~1 dag). Echte stiltekans als de AirPods of
  een HDMI-beamer de standaard worden, maar eerst 2 minuten thuis nagaan of Chrome dan echt verhuist.
  *Na die meting.*
- **De hub alleen als de opstelling hem vraagt, plus een noodknop "zonder hub"** (2–3 u). `mixerNu()`
  negeert `mixerVia: false` (`controle.js:138–141`). Raakt de controller-workflow: daar afstemmen.
- **Een luidheidsmeter (LUFS) bij de master** (½–1 dag). Je ziet waar de master moet staan zodat de
  limiter alleen pieken vangt (`gs/sim.mjs`: 2× thru op master 1,0 geeft tot −6,9 dB gain reduction).
  Erbij: de vormlagen compenseren voor de masterfader (2–3 u, `luisteraar.js`). Doe dit vóór het
  uitzenden.
- **Video kopiëren in plaats van x264** bij de ingest (½ dag): 80 s → ~1 s per nummer met beeld.
- **Secties bij het binnenhalen, laden parallel** (½ dag): nu 15 s wachten bij de eerste laad van een
  album van 30 min.
- **DJ-workflow:** één oordeel voor "past bij" en de auto-DJ, ook zonder zeker grid (1–2 dagen; nu is
  "past bij" meestal leeg en kiest de automaat in 67–90% iets anders). Het cuepunt op het begin van de
  muziek, bewaard per nummer (½–1 dag). "Zet de set klaar" in het planvenster (1–2 dagen). Een
  achtervang als je met de hand draait (1 dag, AU4: nooit verrassen).
- **Draagbaar met beeld:** de meting "Stroommachine naast VARVE op de Air" (`beeld-lokaal.mjs`, nooit
  gedraaid, 14 min). Daarna het zaalbeeld in één action. Bij het uitzenden eerst meten hoeveel het geluid
  achterloopt op het beeld (een schatting van 1–2 s, niet gemeten).
- **Volgende versie:** slip, slip-hotcue en loop roll; vervolgacties op secties en patronen; de noodlus op
  de maat.

**Bekeken en niet de moeite:** grote bestanden splitsen (botsen bijna nooit), zes ongebruikte exports,
dubbele tests (niet gevonden), de limiter na NaN (herstelt meteen), schijf vol (wordt al netjes gemeld),
de hub die wegvalt (al afgedekt).

---

## Hoe dit samenhangt met de andere twee workflows

- **Lag op de controllers.** Hun takken (`afmaken/controller-invoer`, `-uitvoer`) dekken het
  invoer/uitvoerpad en de renderloop. Daarom valt "renderloop in rust" hier af. Punt 1 en 2 zijn een
  voorwaarde voor hun metingen: een renderer die volloopt en een audiopad dat op verbindingen wacht,
  maken elke lagmeting onbetrouwbaar. Punt 4 (draadpool) en de hub-route raken hun hub-pad alleen bij
  het opstarten.
- **Beatgrid.** Sync-lock en "past bij" worden pas echt waard als de analyse meer zekere stukken
  oplevert. Punt 9 (een vaste versterking) verschuift geen enkele tel. `detect.test` is de traagste test
  (81 s) en hoort bij het beatgrid: punt 8 maakt hun rondes korter.
- **Werkruimte.** Twee ontwerpen moeten op elkaar aansluiten. De Wake Lock (punt 5) wordt één helper voor
  mixer, beamer en de iPad (C4). De isolator (punt 10) verandert wat een kill-pad doet, niet waar hij
  zit. Herstel (punt 6) zet ook de stand van het open deel terug zodra werkruimtes bestaan: `leesStand`
  moet dan de werkruimte meenemen. En vóór hun bouwfase scheelt een kortere CLAUDE.md per laag (punt 8,
  stap 5) conflicten in elke controller-tak.

**Volgorde in één zin:** punt 1, 2 en de één-regel-vangnetten van 4 vandaag (samen < 1 dag). Dan 3, 6
en 7. De metingen op je Mac (5, de uitgang, de Taakbeheer-check van 1) op een rustige middag. Na de
proefavond: de merge naar main, CI en 10 op het oor. Punt 9 zodra de telling zegt dat het veel nummers
raakt.
