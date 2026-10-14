# Hoek: live-betrouwbaarheid (13 okt 2026, tak studio/afmaken @ 339310b)

Vraag: wat kan er tijdens een set misgaan, hoe snel herstelt het, wat ziet Clay?
Niets in de repo gewijzigd. Alles wat ik draaide staat in deze map:

- `duur.mjs` — duurproef: eigen server op 8891 (VARVE_TESTSERVER=1, alle paden in een tmp-map),
  headless Chromium via CDP, vier nummers van 4 min door de ECHTE ingest (`/api/upload?video=0`),
  twee decks streamend, opname (audio) en handelingenlog aan, elke ~1,5 s een handeling
  (hotcue, beatloop, loop weg, beatjump, seek, fx.next, knop, filter, send, sync, crossfader, EQ, kill),
  elke 90 s een nieuw nummer; elke 20 s geheugen/DOM/listeners/server-RSS/fd's/serverlatentie;
  een stilte-meter op `engine.master.analyser` (elke 50 ms, RMS < 1e-4 terwijl een deck speelt).
  Op de helft: server SIGKILL, 45 s weg, herstart. Op 70%: `ctx.suspend()` 6 s.
- `duur-proef/` (3 min, eerste proef) en `duur-45/` (45 min) — `verloop.log`, `metingen.json`, `server.log`.
- `rss-zijspoor.txt` — RSS van renderer, GPU, audio-dienst, browser, server elke 30 s
  (kolommen: tijd, renderer, gpu, audio, browser, server MB; fd's server).
- `herlaad.mjs` — herladen tijdens het spelen: hoe snel is de app terug, wat is er nog.
- `nan-limiter.mjs` — LimiterKern met een NaN/Infinity-blok (geen kans: hij herstelt meteen).

Let op voor wie dit herhaalt: `VARVE_CHROME=.../headless_shell` is een WRAPPER; `kill` op dat
proces laat `headless_shell.real` als wees staan. Ruim op met `pkill -f user-data-dir=<map>`.
En poort 8892 is van een andere agent in deze workflow (`winst/srv`): mijn eerste twee
herlaad-pogingen landden per ongeluk op die server (één upload "h.wav", `lokaal-33da348ef6d6`,
plus /api/mixer-meldingen). Daarna 8897 gebruikt.

## Wat de metingen zeggen

### Duurproef (bedoeld 45 min; de renderer viel om na ~35 min spelen)
- **De renderer liep op tot hij omviel.** Renderer-RSS (`rss-zijspoor.txt`, vanaf minuut ~14):
  550 → 620 → 680 → 720 → 790 → 840 → 900 → 950 MB, ~23–25 MB per minuut, een zaagtand met een
  stijgende bodem. Na ~35 min spelen doodde de OOM-killer van de container hem (`dmesg`: "Killed
  process 17331 (headless_shell.) anon-rss:948280kB"; de grens is die van de container, gedeeld met
  andere agenten, maar de groei is van VARVE). De JS-heap van de pagina bleef 5,3 → 6,5 MB, DOM-knopen
  3823–3843, listeners 1228–1232: het zit niet in de JS die je ziet.
- **Lekproeven, elk 3–5 min op één knop** (`lek.mjs`, `lek-*.log`, met een GC-knop IN de
  AudioWorkletGlobalScope via een eigen module, plus `HeapProfiler.collectGarbage`):

  | proef | renderer | na GC (worklet + hoofd) | oordeel |
  |---|---|---|---|
  | één deck streamt 1× en 2× | 191 → 310, zakt vanzelf | 306 → 221 | afval, wordt opgeruimd |
  | twee decks streamen | 194 → 305, zakt vanzelf | 305 → 228 | idem |
  | 355× `fx.next` | 178 → 195 | 176 | geen lek |
  | 351× seek | 192 → 246, zakt vanzelf | 201 | geen lek |
  | 58× laden + spelen | 198 → 299, zakt vanzelf | 199 | geen lek |
  | **opname, deck stil** | **189 → 315 (+23 MB/min, lineair)** | **306** | **LEK** |
  | kale `fetch` POST 192 kB/s, antwoord NIET gelezen | 188 → 279 (+23 MB/min) | 266 | LEK (Chromium zelf) |
  | idem, antwoord WEL gelezen (`await res.arrayBuffer()`) | 188 → 192 | 171 | geen lek |

  De opname (`src/opname/opnemer.js:180-183`) post elke seconde 192 kB en leest bij succes het
  antwoord niet (`if (res.ok) { … return; }`). In deze Chromium (headless shell 1194) houdt een
  ongelezen antwoord het hele verzoek vast: 23 MB/min = **~1,4 GB per uur, ~4 GB in een set van drie
  uur**, met video (8 Mbit/s, `opnemer.js:137-139`, zelfde patroon) vijf keer zo snel (aanname, niet
  gemeten). Hetzelfde patroon, klein: `/api/mixer` elke 900 ms (`status-zender.js:109-113`) en de
  stukken van het handelingenlog (`handelingen.js:206-209`).
- Verder vlak over 30 min (~800 handelingen, 13 laadbeurten, opname en log aan): server-RSS 176–198 MB,
  fd's 32–35, serverlatentie gemiddeld 3–7 ms, hoogste 75 ms (302 ms tijdens de eerste ingest),
  **0 stille vensters van 50 ms in 23 084** vóór de server-kill (19,5 min).

### Server weg (SIGKILL midden in de set, beide runs)
- De decks spelen door op wat al binnen is: `plan()` haalt 20 s vooruit (`src/engine/stream-kern.js:250`,
  `vooruit = 20`). Gemeten: geladen pagina's 17 → 15 → 11 → 8 → 4 → 3 per 5 s, **stilte na ~21 s**.
- Herstart: server antwoordt na **1,0 s** (tweede run 0,77 s; stilte 23,3 s); de StreamBron probeert elke 100 ms opnieuw (`bron.js:600`) en het
  geluid is er **binnen ~1,5 s** vanzelf weer (stilte 25,6 s bij 45 s weg).
- Niemand herstart de server: VARVE.app start hem met `nohup node server/index.js &`
  (`tools/varve-app/VARVE.applescript:98`); de hub krijgt wél een bewaker (`--blijf`, regel 53;
  `av-app-hub/src/blijf.js`). De server slikt JS-fouten (`server/index.js:1831-1832`), dus wat hem
  omlegt is OOM, een native fout (node:sqlite), een kill of een HANG — en een hang ziet niemand.
- De opname verliest de HELE uitval (30 stukken van 1 s "stuk kwijt, wordt stilte"), ook de 21 s dat de
  zaal nog muziek hoorde: drie pogingen in 1,5 s en dan weg (`src/opname/opnemer.js:176-191`), terwijl de
  server per `?frame=N` schrijft en herhalen dus veilig is.
- Wat Clay ziet: per verloren seconde een NIEUWE rode melding (`opname-knop.js:18`; een fout blijft tot je
  klikt, `meldingen.js:23`, hooguit 4, `meldingen.js:19`), die "stream hapert" wegduwen. Na het herstel
  blijven de rode meldingen staan ("stream hapert" nog 13 s na het herstel, er komt geen "weer goed").
  Er is nergens te zien hoeveel seconden er nog in de buffer zitten.
- Laden tijdens de uitval: `TypeError: Failed to fetch` (verwacht).

### AudioContext die stopt
- `ctx.suspend()` (staat voor: uitgang die wegvalt, OS die de audio onderbreekt): de mixer luistert niet
  naar `statechange` (alleen `logboek.js:207`); geen melding, de knop verandert niet. Een APC-druk
  (`invoke('track.1.play')`) zet hem NIET terug: alleen een `pointerdown` op de pagina doet dat
  (`src/ui/app.js:221`). Met alleen de APC of Maschine in handen = stilte tot je de muis pakt.
  De Controlekamer toont "staat stil" (`src/controle/controle.js:309`), maar in een ander tabblad.
- Een klok die stilstaat terwijl `state === 'running'` (apparaat weg) wordt nergens gezien.
- Geen enkele `processorerror`-handler op de zes soorten AudioWorkletNode (`grep -rn processorerror src` = 0):
  een uitzondering in `stream-lezer.js` of een fx/instrument-worklet = die bron stil voor altijd, zonder melding.

### Herladen of crash van het tabblad
- `herlaad.mjs`: app weer klaar na **1,7 s**, maar ALLE decks leeg, niets speelt. De server weet het nog:
  `GET /api/mixer` gaf titel, positie, rate en "speelt" per track, ≤ 1 s oud (geen library-id erin,
  `src/ui/status-zender.js` maakStatus). Het handelingenlog op de server heeft de volledige stand.
- `beforeunload` waarschuwt alleen tijdens een opname (`src/ui/opname-knop.js:24`): Cmd+R / Cmd+W met
  spelende decks = meteen stilte. ONTBREEKT A5 (herstel na crash of herladen) staat nog open
  (`docs/ONTBREEKT.md:22`); Chrome crashte al vijf keer (HANDOFF "Chrome-crash van 20:27").

### Scherm en slaap
- Geen `navigator.wakeLock` en geen `caffeinate` in src/, server/ of VARVE.app (grep = 0); het
  avondpakket kijkt naar accu en lader, niet naar `displaysleep`.
- AANNAME (niet te meten in deze container): macOS telt MIDI niet als gebruikersinvoer. Met alleen
  APC/Maschine gaat het scherm uit na de energie-instelling (op de accu standaard een paar minuten), en
  de beamer is ook een scherm. Chrome houdt bij hoorbare audio de MAC wakker, niet het scherm; zijn
  video-wakelock hangt aan een zichtbare, spelende `<video>`, en de beamer toont een WebGL-canvas.
  Toetsen in 2 min: tijdens het spelen `pmset -g assertions` (staat er "PreventUserIdleDisplaySleep"
  van Chrome?) en 10 min niet aan muis/toetsenbord komen.

### Bekeken en GEEN kans
- LimiterKern na NaN/Infinity: volgende blok weer normaal (`nan-limiter.mjs`).
- Schijf vol: opname en log melden ENOSPC netjes (`server/opname.js:154`, `handelingen.js:116`) en het
  avondpakket waarschuwt vooraf onder 50/20 GiB (`server/avondpakket.js:31`); 3 uur video = ~11 GB.
- Hub weg: herverbinden 0,5→5 s, hartslag op de tijd, paniek los (CLAUDE.md, getest in hub.test).
- Achtergrondtabblad: hoorbare tabbladen worden niet geknepen; LED's/stream/automaat lopen op timers.
- MIDI-crash van Chrome: met `?hub=` (de standaard via VARVE.app) vraagt de mixer geen Web MIDI meer aan.

## Kansen

Op volgorde van winst per uur werk. Alle vijf raken de drie regels niet (alles buiten de engine,
of alleen lezen van de engine).

### K1. De opname lekt: lees het antwoord van elke POST (uren)
- **Probleem:** een opname laat de renderer ~23 MB per minuut groeien, ook met een stil deck; GC haalt
  het niet weg. Bewezen in de tabel hierboven: dezelfde kale POST lekt zonder en lekt niet met
  `await res.arrayBuffer()`. In de duurproef: renderer 550 → 950 MB en dood (OOM) na ~35 min.
- **Winst:** een set van drie uur met opname is nu ~4 GB extra in het tabblad van de mixer: op de Mac
  geheugendruk en swap (haperingen op de audiothread) of een "Aw, Snap" midden in de set, en dan is
  alles weg (zie K4). Met video sneller. Eén regel per plek.
- **Toepassen:** `src/opname/opnemer.js:183` → `if (res.ok) { await res.arrayBuffer().catch(() => {}); …`,
  idem regel 139 (videostukken) en de `klaar`-POST; `src/control/handelingen.js:209`;
  `src/ui/status-zender.js:113` (`r.body?.cancel()` of `r.arrayBuffer()`). Liever één hulp
  `leegAntwoord(res)` in `src/lib/` en `grep -rn "method: 'POST'" src` (30 plekken) langslopen: elke
  POST waarvan het antwoord bij succes niet gelezen wordt. Test: in `test/opnemer.test.mjs` een nep-fetch
  die telt of `arrayBuffer()`/`body.cancel()` werd aangeroepen; meting: `lek.mjs` met `PROEF=opname`
  moet vlak worden (bodem binnen 20 MB na 5 min).
- **Risico:** klein. Eerst op Clay's Chrome bevestigen dat het lek daar ook is (Taakbeheer van Chrome,
  kolom "Geheugen", 10 min opnemen): dit was Chromium 1194 headless op Linux. De oplossing schaadt niet
  als het lek daar niet is.

### K2. Een bewaker voor de server, en de opname die een uitval overleeft (½–1 dag)
- **Probleem:** server weg = na **21–22 s stilte** op alle decks (20 s vooruit, `stream-kern.js:250`), en
  niemand start hem opnieuw (`VARVE.applescript:98`, `nohup`); de hub heeft wél een bewaker
  (`--blijf`, `av-app-hub/src/blijf.js`). Een HANG (event loop vast) wordt nergens gezien. De opname
  verliest de hele uitval, ook de seconden die de zaal nog hoorde (`opnemer.js:176-191`: 3 pogingen in
  1,5 s), en meldt dat met één nieuwe rode melding per seconde.
- **Winst:** herstart kost gemeten 0,8–1,0 s en de decks hervatten zelf binnen ~1,5 s: met een bewaker
  wordt een servercrash ONHOORBAAR (ruim binnen de 20 s buffer) en heel in de opname. Minder kans op
  stilte live, zonder dat Clay iets merkt of doet.
- **Toepassen:** (1) `server/bewaker.js` naar het model van `blijf.js` (kindproces, hooguit 5 herstarts
  per minuut, vaste fouten zoals poort bezet niet herstarten) plus een hartslag: elke 2 s
  `GET /api/proef` met 2 s time-out, drie keer niets = SIGKILL en opnieuw. Let op Demucs: een kill laat
  de splitter staan; de bewaker ruimt de procesgroep op (zoals `run()` met SIGINT→SIGKILL).
  `VARVE.applescript` start `node server/bewaker.js` in plaats van `server/index.js`. (2) In de opnemer
  een wachtrij voor stukken die niet aankwamen (begrensd: ~5 min = 57 MB), die op volgorde herhaalt
  zodra de server terug is: `?frame=N` maakt dat veilig. Zelfde voor het handelingenlog. (3) Eén
  melding die meegroeit ("opname: server weg, 34 s wacht") en verdwijnt als de rij leeg is, in plaats
  van één per seconde (`opname-knop.js:18`). Toets: `duur.mjs` doet de kill al; eis 0 stille vensters
  en een WAV zonder gat.
- **Risico:** een crash-lus die stil blijft herstarten (daarom de grens en een regel in het log en de
  Controlekamer); twee servers op één `library.db` als de oude nog leeft (eerst wachten tot het kind
  echt weg is). Geheugen van de wachtrij: begrenzen.

### K3. De mixer zegt zelf of hij gezond is: audio, server, buffer (1 dag)
- **Probleem:** de mixer luistert niet naar `ctx.statechange` (alleen `logboek.js:207`); gemeten: na
  `suspend()` geen melding en een APC-druk zet hem niet terug, alleen een klik op de pagina
  (`app.js:221`). Een klok die stilstaat terwijl `state` "running" zegt (uitgang weg) ziet niemand. Geen
  `processorerror`-handler op de AudioWorkletNodes (grep = 0): een fout in een worklet = een stil deck
  zonder uitleg. Rode meldingen blijven na het herstel staan (gemeten: "stream hapert" van 1201 s stond
  er op 1918 s nog) en er staat nergens hoeveel seconden een deck nog heeft.
- **Winst:** Clay ziet in één oogopslag wat er mis is en hoe lang hij heeft ("server weg · 14 s"), en de
  audio komt na een onderbreking vanzelf terug, ook met alleen de APC of Maschine in de hand.
- **Toepassen:** `src/ui/gezondheid.js` (puur: stand → lampjes en tekst, getest zoals `beeld-weergave.js`)
  en een rij lampjes in de bovenbalk (`bovenbalk.js` scrollt al): AUDIO (state + `ctx.currentTime` loopt
  mee met `performance.now()`, > 0,5 s achter = rood; bij `statechange` naar niet-running meteen
  `ctx.resume()` proberen, sticky activation is er na de eerste klik), SERVER (laatste geslaagde pagina
  van de StreamBron of een ping, plus "vooruit": de laatste geladen pagina na de positie, uit `geladen`
  en `paginaVan`), OPNAME (wachtrij uit K2), HUB (`midi.status().hub`). `node.onprocessorerror` in
  `bron.js`, `master.js`, `fx-worklet`-gebruikers, instrumenten: melding plus voor de StreamBron de node
  opnieuw bouwen op dezelfde positie. `meld()` een sleutel geven zodat "stream hapert" vervangen wordt
  door "stream weer goed". Zelfde stand naar de Controlekamer en de companion (`status-zender.js`).
- **Risico:** klein; alles leest alleen. Valse alarmen bij een stilstaande klok vóór "audio starten"
  (alleen kijken als `state === 'running'`). Plaats op het scherm: overleggen met de werkruimte-workflow.

### K4. Herstel na herladen of een crash van het tabblad (ONTBREEKT A5) (½ uur + 1½–2 dagen)
- **Probleem:** na herladen is de app in 1,7 s terug, maar ALLE decks zijn leeg (`herlaad.mjs`). Cmd+R of
  Cmd+W met spelende decks waarschuwt niet: `beforeunload` alleen tijdens een opname
  (`opname-knop.js:24`). Een renderer-crash (K1, of de MIDI-crashes van september) kost alles: welk nummer,
  waar, loops, faders, racks. A5 staat open (`docs/ONTBREEKT.md:22`). De gegevens liggen er al: de server
  heeft de laatste mixerstand ≤ 1 s oud (`GET /api/mixer`: titel, positie, rate, speelt) en het
  handelingenlog (altijd aan) heeft beginstand plus elke handeling.
- **Winst:** van minuten zoeken en opnieuw instellen naar ~5 s en één druk; de grootste ramp (alles weg
  midden in een set) wordt een hik. Draagbaar: geldt ook voor een herstart van de laptop.
- **Toepassen:** (1) meteen: `beforeunload` ook als een deck speelt of laadt (`opname-knop.js` of een
  eigen regel in `app.js`). (2) `maakStatus` (`status-zender.js`) krijgt per track het library-id; de
  server bewaart de laatste stand ook op schijf (`media/mixer-laatst.json`, overleeft een
  serverherstart). (3) Bij het opstarten: is de laatste stand van een ANDER tabblad-id < 15 min oud en
  stonden er nummers, dan één melding "herstel de set van 21:43?" (knop, en een action `app.restore` voor
  de APC). Herstellen = per track `laden.laadLibrary` op de oude positie, dan de laatste waarden uit het
  log (beginstand + regels tot het eind, zonder wachten: `Terugspeler` met T0 in het verleden, te
  controleren) voor faders, EQ, racks, sends, loops; decks NIET vanzelf starten, behalve met een tweede
  druk ("speel verder"), zodat het nooit ongevraagd knalt. Toets: headless herladen midden in een loop,
  zelfde stand na herstel.
- **Risico:** een half herstelde stand die anders klinkt dan Clay denkt (daarom niet vanzelf starten);
  het log van een crash mist de laatste seconde; terugspelen slaat bewust dingen over (inst, key):
  die moeten er voor herstel wel bij.

### K5. Scherm en Mac wakker houden tijdens de set (uren)
- **Probleem:** geen `navigator.wakeLock`, geen `caffeinate` (grep = 0); het avondpakket kijkt niet naar
  `displaysleep`. AANNAME: macOS telt MIDI (APC, Maschine, via de hub) niet als invoer, dus met alleen de
  controllers in handen gaat na de energie-instelling het scherm uit, en daarmee ook de beamer; in een
  pauze met alles stil kan de Mac zelfs slapen (hub, Tailscale, iPad weg).
- **Winst:** beamer en mixerscherm blijven aan zonder dat Clay aan de muis hoeft; geen zwart beeld in de
  zaal. Draagbaar: geldt op elke plek, ook op de accu.
- **Toepassen:** in de mixer en `video.html`: `navigator.wakeLock.request('screen')` zolang de audio loopt
  of het losse venster open is, opnieuw na `visibilitychange` (een lock vervalt bij verbergen). Op de
  server: `caffeinate -di -w <server-pid>` zolang `speeltDeck()` waar is of de mixer meldt (macOS, geen
  dependency). Avondpakket: `pmset -g` → `displaysleep`/`sleep` als oranje punt. Toets eerst 2 min op de
  Mac: tijdens het spelen `pmset -g assertions` (is er een display-assertie van Chrome?) en 10 min niets
  aanraken behalve de APC.
- **Risico:** vrijwel nul; als de aanname niet klopt, is het een paar regels die niets doen.

## Wat ik niet kon doen of niet deed
- Niets op een Mac, met echte Chrome, echte APC/hub of een echte geluidskaart: de AudioContext-faalwegen
  (uitgang weg, samengesteld apparaat) zijn met `suspend()` nagebootst, niet echt.
- Het lek is gemeten in Chromium 1194 headless op Linux; op Clay's Chrome eerst bevestigen (K1).
- Geen video in de duurproef (swiftshader op 4 kernen); de videostukken van de opname lekken
  vermoedelijk net zo (zelfde patroon), niet gemeten.
- De duurproef haalde zijn eind niet (renderer weg na ~35 min spelen); de server-kill en `suspend()`
  liepen wel. Vervolg: na K1 `DUUR_MIN=180 node duur.mjs` voor een echte drie uur.
- Raakvlakken: K3 (lampjes) met het werkruimte-ontwerp (waar op het scherm); de lag op controllers
  (workflow 1) raakt K2/K3 niet.

