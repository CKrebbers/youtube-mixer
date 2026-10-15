# Uitzenden: de eigen set als één signaal naar buiten

*10 oktober 2026, stap 1 van 9 (tak `visie/uitzenden`, PR #24, met reviewronde 1 verwerkt). Ontwerp, kritiek en
review: de beschrijving van PR #24. Toets: `docs/VISIE.md` §3-§5. Open keuzes: `docs/VRAGEN.md` blok U.*

**Zin één.** Wat uitgezonden wordt is het **mengcanvas van de Mac** (wat de video-opname ook ziet), niet per se
wat er op de beamer staat. Staat de Stroommachine (Omarchy-pc) op de beamer, dan komt die alleen in de stream
via OBS (capture-stick) of via het spoor beeld-een-machine.

**Stand.** `server/uitzend.js` bestaat en is getest, maar **niets roept hem aan**: `server/index.js` en `src/`
zijn onaangeroerd, er is geen route, knop of action. Varve zelf komt in deze versie niet verder dan deze Mac:
een bestand, een RTMP-ontvanger op 127.0.0.1, of udp naar 127.0.0.1 (OBS). Een dienst (YouTube, Twitch,
Mixcloud) kan niet, met welke instelling ook, tot Clay U1b beslist en er een eigen PR komt.

---

## 1. Wat het is: een uitgang, geen bron

```
master na de limiter -> opnemer (worklet) -> POST /api/opname/<id>/stuk?frame=N -> opnames/set-<id>.wav (groeit)
mengcanvas -> MediaRecorder -----------------> POST /api/opname/<id>/video.mp4 ---> opnames/set-<id>.mp4 (groeit)
                                                                                          |
                                                              server/uitzend.js LEEST     v
                                                              (volger, poll 250 ms) -> ffmpeg (één kind) -> doel
```

- De module **volgt een opname die al loopt**: de nieuwe bytes van de WAV (stil-profiel) of van de mp4 (beeld-profiel)
  gaan in de stdin van één ffmpeg, die ze naar één doel uit `uitzend/doelen.json` stuurt.
- **Geen eigen klok** (regel 3): de achterstand wordt gemeten tegen de WAV-bytes, die op de audioklok van de mixer
  zijn geteld (`?frame=N`). De poll van 250 ms bepaalt alleen wanneer er gekeken wordt.
- **Het opnamepad blijft precies zoals het was** (G4): `opnemer.js`, `opname.js` en de opnameroutes zijn niet
  veranderd. De test bewijst het: een WAV met en zonder uitzending is byte voor byte gelijk (S21), en als ffmpeg
  sterft loopt de opname door (S22).
- `CLAUDE.md` r.29-31 ("geen publieke streaming") ging over **de cache**: `media/` en `library.db` verlaten deze
  machine nooit. Deze module importeert alleen `node:*` en `kopVan`/`ID` uit `./opname.js`, neemt van buiten alleen
  een opname-id en een doelnaam aan (geen pad, geen url, geen ffmpeg), en leest alleen `opnames/set-<id>.wav|.mp4`
  (G1, getest). Of de regel daarvoor een zin bij krijgt is U1a.

## 2. Drie routes, en waarom C eerst

| | **A: in-app naar een dienst** | **B: alleen opnemen** | **C: Varve -> OBS (lokaal) -> dienst** |
|---|---|---|---|
| Wat Varve doet | master + mengcanvas -> RTMP(S) naar YouTube/Twitch/Mixcloud | niets nieuws: `opnames/set-<id>.mp4` bestaat al | master + (optioneel) mengcanvas -> `udp://127.0.0.1` als mpegts; OBS mengt en zendt |
| Extra spullen | geen | geen | geen: OBS 32.0.4 staat op de Mac (36× gebruikt), Twitch-doel en "USB Video" al ingesteld |
| Camera / Stroommachine in beeld | nee | nee | ja: Continuity Camera (de iPhone krijgt een eigen rol), de HDMI-stick voor de pc |
| Sleutel | sleutelhanger (stap 8) | geen | in OBS; nooit in Varve |
| Rechten afdwingen in code | deels (poort op het doel, stap 7-8) | n.v.t. | **niet**: OBS kent geen poort; het setboek is Clay's gereedschap |
| CPU op de Air | ffmpeg ~5-14 % van een kern (alleen het kind gemeten) | MediaRecorder (niet gemeten naast decks) | idem + OBS (niet gemeten; advies `apple_h264` 720p30) |
| Wanneer | pas als C te zwaar blijkt (U1b) | is er al | **eerste echte proef**, thuis, zonder dienst (stap 5b) |

Wat Varve beter kan dan OBS alleen: **de master na de limiter, bit voor bit, zonder de koptelefoon-cue**. Laat je
OBS het geluid van Chrome zelf vangen, dan kan de cue via de Aggregate Device meekomen (niet getest). Daarom levert
Varve het geluid en doet OBS de rest.

## 3. Harde grenzen

Een slot **tegen vergissing, niet tegen opzet**: wie zelf een relay op 127.0.0.1 zet, kan eromheen. Er staat er nu geen.

| # | Grens | Hoe | Test |
|---|---|---|---|
| G1 | De bron is alleen de eigen set: `opnames/set-<id>.wav` / `.mp4` | alleen `node:*` en `kopVan`/`ID` uit `opname.js`; id moet aan `opname.ID` voldoen; paden staan alleen in de **instellingen** van `start` (van de server), nooit in het **verzoek** (van buiten) | G1-checks, S25 (`../../etc`), R9 |
| G2 | Doelen alleen van schijf | wie start noemt een **naam**: `start(verzoek, instellingen)` leest uit het verzoek alleen `id`, `doel`, `beeldstand` en `door`. Een `url`, pad, `ffmpeg` of argv-haak in het verzoek wordt genegeerd, dus de route mag de body doorgeven; `laadDoelen()` geeft nooit een url | P10, S14, S15, R9 |
| G3 | Lokaal-slot | `bestand`; `rtmp://` naar letterlijk `127.0.0.1` of `[::1]`; `udp://` naar letterlijk `127.0.0.1`, poort ≥ 1024; geen gebruiker/wachtwoord; `new URL(url).href === url`. `localhost` telt niet (hangt van `/etc/hosts` af). Al het andere: *"naar buiten uitzenden staat uit tot Clay U1 beslist (CLAUDE.md r.29-31, docs/VRAGEN.md U1)"* | P9: 4 open, 12 dicht, 2 niet-genormaliseerd |
| G4 | Opnamepad onaangeroerd | de volger leest alleen; `kind.on('error')`, `kind.stdin.on('error')` en `close` vangen alles | S21, S22, S23 |
| G5 | Geen uitzending zonder opname | `start` eist `set-<id>.wav` | S25 |
| G6 | Eén uitzending tegelijk; netjes stoppen | stdin dicht -> 3 s -> SIGINT -> 3 s -> SIGKILL (`snel`: 1,5 / 1,5 s). Nooit SIGTERM | S24, S25 |
| G7 | Een sleutel komt nergens | een doel met `sleutel*` is ongeldig; elke stderr-regel en elke fout door `maskeer()` | P8, P10 |
| G8 | Inhoudsgrens: het mengcanvas bevat de YouTube-clips van de decks (14 van 15 nummers) | een niet-lokaal doel bestaat in v1 niet, dus ook geen niet-lokaal beeld-doel; elk beeld-doel krijgt de waarschuwing *"deck-clips van anderen: alleen thuis (stappenplan I78)"*. `inhoud: vormen` is Clay's verklaring, de server kan het niet zien | P9, P10, S18 |
| G9 | Uitgang buiten iCloud en buiten `opnames/` | bestandsdoelen naar `VARVE_UITZEND_UIT`, standaard `~/Movies/VARVE-uitzend/`; nooit overschrijven (`-n`, eerste vrije naam `set-<id>.uitzend[-N].flv`); na stop een `.mp4` ernaast, en anders een waarschuwing waarom niet; ook via een link niet in `opnames/` (echte paden, vóór `mkdir`); **elk pad eerst absoluut**, zodat Node en ffmpeg hetzelfde pad toetsen en schrijven (review 1: met een relatief `../opnames` kwam de flv anders ín `opnames/`); waarschuwing als `opnames/` of de uitgang zelf in iCloud staat | P7, P13, S14, R7, R8, R11 |

## 4. Twee profielen

```
stil  (bron audio = de WAV vanaf de data-offset uit kopVan):
  -hide_banner -loglevel error -n -progress pipe:3 -stats_period 1
  -f s16le -ar 48000 -ac 2 -i pipe:0
  -filter_complex <beeldfilter>  -map [v] -map [a]
  -c:v libx264 -preset veryfast -tune zerolatency -g <2*fps> -b:v <bitrate, standaard 300k>
  -c:a aac -b:a 192k
  <muxer+uit>

  gelijk = setpts=PTS-4/(FR*TB),trim=start=0             (showwaves stempelt 4 beelden te laat; zie hieronder)
  zwart: [0:a]asplit[a][b];[b]showwaves=s=1280x720:rate=<fps>:colors=black,<gelijk>,format=yuv420p[v]
  golf : [0:a]asplit[a][b];[b]showwaves=s=1280x720:rate=<fps>:mode=cline:colors=white,<gelijk>,format=yuv420p[v]
  png  : movie=beelden/<naam>.png,loop=loop=-1:size=1,fps=<fps>,scale=1280:720[p];
         [0:a]asplit[a][b];[b]showwaves=s=1280x720:rate=<fps>:mode=cline:colors=white@0.5:draw=full,<gelijk>[w];
         [p][w]overlay=shortest=1,format=yuv420p[v]          (cwd = de uitzendmap)

beeld (bron video = de mp4 van de video-opname, vanaf byte 0):
  hercodeer: -hwaccel videotoolbox -f mp4 -i pipe:0 -map 0:v:0 -map 0:a:0
             -c:v h264_videotoolbox -realtime 1 -b:v <br> -maxrate <br> -bufsize <2×br>
             -g 60 -force_key_frames expr:gte(t,n_forced*2) -pix_fmt yuv420p
             -c:a copy
  hercodeer, niet op de Mac (hercodeerEncoder, spoor C2, 15 okt): -f mp4 -i pipe:0 -map 0:v:0 -map 0:a:0
             -c:v libx264 -preset veryfast -tune zerolatency, verder hetzelfde (h264_videotoolbox
             bestaat alleen op macOS; de tests S18/S29/R12 draaien zo ook op Linux)
  kopie (intern, alleen lokaal): -f mp4 -i pipe:0 -map 0:v:0 -map 0:a:0 -c copy

muxer+uit:  bestand: -f flv <uitmap>/set-<id>.uitzend[-N].flv   (na stop: -c copy -movflags +faststart naar .mp4)
            rtmp:    -f flv -flvflags no_duration_filesize <url>
            udp:     -f mpegts <url>?pkt_size=1316
```

- **Eén invoer, één klok.** Geen `-re`, geen `-loop 1`, geen stilstaande tweede invoer: de jury mat dat dat live
  stokt of wegloopt (§7). Het beeld van het stil-profiel komt uit het geluid zelf.
- **De golf valt op het geluid.** showwaves stempelt elk beeld **4 beelden te laat**, bij elke fps en ook zonder
  encoder (review 1, gemeten met een stoot van 0,2 s in stilte op 3,0 s). Eerst stond hier "het beeld begint 1,52 s
  na het geluid; voor een zwart beeld doet lipsync er niet toe". Dat klopte voor zwart, maar de golf liep **2 s**
  achter de kick aan bij de standaard 2 fps (stoot zichtbaar op 5,02 s; bij 10 fps 3,42 s). Nu trekt
  `setpts=PTS-4/(FR*TB)` die 4 beelden eraf en laat `trim=start=0` weg wat dan vóór 0 valt: de stoot staat op
  **3,02 s** bij 2, 10 en 15 fps, ook na 300 s (10,02 / 150,02 / 290,02 s: geen drift), en het eerste beeld op
  0,02 s. Per fps gemeten (review 2, de argv van `bouwArgs`, offline): 1, 2, 5, 10, 15 en 20 fps 3,021 s; 25 fps
  2,981 s; 30 fps 2,954 s. Bij hoge fps landt de golf dus 40-67 ms vroeg, wat onschuldig is. Bijwerking: aan het
  eind valt het laatste halve tot hele beeld weg (bij 2 fps eindigt het beeld op 11,52 s bij 12 s geluid). S27 en
  S28 pinnen de "4" vast: geeft een andere ffmpeg iets anders, dan falen ze.
- **Keyframes in seconden.** `-g 60` telt beelden, en Chrome's fps varieert (de headless-opname van de review:
  gemiddeld 29,07). Daarmee lagen de keyframes 2,27 s uit elkaar (op 25 fps-materiaal 2,4 s), terwijl een dienst er
  één per ≤ 2 s wil. `-force_key_frames expr:gte(t,n_forced*2)` zet er ook één op elke 2 s: op dezelfde Chrome-mp4
  **2,00 s** (S18 op 30 en op 25 fps).
- **Geluid in het beeld-profiel wordt gekopieerd.** Beeld én geluid hercoderen loopt live weg (jury 0,45× echte
  tijd; vandaag opnieuw: 11,4 s achter na 12 s, E5). De oorzaak is niet gevonden.
- **Opus.** Chrome kan `avc1,opus` in een `.mp4` zetten (`kiesVideoType`, opnemer.js r.23-24). ffmpeg 9 zet Opus
  wél in flv (enhanced FLV), maar een klassieke RTMP-ingang verwacht AAC. Daarom leest `start` de eerste 64 KiB van de
  mp4 (`audioCodecVanMp4`): Opus + `rtmp` wordt geweigerd ("kies een doel met bron audio"), Opus + `bestand`/`udp`
  mag met een waarschuwing (S20). De zin "Opus kan niet in flv" uit het eerste ontwerp was fout.
- **fps** (alleen bron audio): 1..30, standaard 2; `-g` = 2 × fps. Of een dienst 2 fps aanneemt is niet bekend
  (daarom 15 als het ooit naar een dienst gaat; CPU bij 15: E6).
- **Tekst op het beeld.** `drawtext` zit niet in deze ffmpeg (geen freetype). Clay's idee (zwart met donkergrijze
  tekst) komt daarom als **png-plaat** in `uitzend/beelden/<naam>.png`: data, geen code. De voorbeeldplaat
  `plaat-donker.png` komt in stap 2; de test maakt zijn eigen plaat en stuurt het png-profiel echt door ffmpeg (S28:
  h264 1280x720 + aac, de plaat in beeld, de stoot op 3,02 s). Eerst werd de plaat bij 10 fps tijdens een luide stoot
  donkerder (helderheid 31 -> 27,5) in plaats van lichter, en was de stoot niet te zien; bij 15 fps zwak (31 -> 44).
  De oorzaak is showwaves in `draw=scale` (de standaard): met alfa (`white@0.5`) gaat de overlay mis zodra er weinig
  samples per kolom vallen. Sinds review 2 (L1) tekent de png-tak met `draw=full`: de stoot op 3,02 s bij 2 en 10 fps,
  helderheid 31 -> 75 (2 fps) en 31 -> 140 (10 fps). S28 draait beide. De golf op zwart (`golf`) houdt `draw=scale`:
  een andere look is een keuze.
- **Webm.** Kiest de browser webm (geen mp4), dan weigert een beeld-doel meteen, ook als het eerste videostuk pas ná
  de start komt: "de video is webm: kies een doel met bron audio" (S25; eerst wachtte het de hele `wachtMp4` van 10 s
  en zei dan "geen videobestand").
- **Achterstand** (`stand().achterstandS`): WAV: `(eind − positie) / 192000 + max(0, gevoerd − uitS)`, dus wat
  nog in het bestand wacht plus wat in pijp en encoder zit; mp4: `max(0, bronS − uitS)`. `uitS` komt uit
  `-progress` (`out_time_us`), en dat volgt de verste stroom. Eerst stond hier een **beperking**: in het
  stil-profiel liep het beeld 1-1,5 s vóór het geluid uit (de te late stempels van showwaves), dus de tweede term was
  altijd 0 (E1: 0,00 op 4, 6 en 8 s; `uitS` 9,0 na 8 s geluid). **Die beperking vervalt** met de golfreparatie
  hierboven: het beeld volgt het geluid, en de stand meet wat er echt in pijp en encoder zit (E1 nu 0,12 / 0,54 /
  0,43 s, `uitS` 7,87 na 8 s; E2 na SIGCONT 1,12 s in plaats van 0,00). De eerste term, die bij een echte achterstand
  groeit en de sprong stuurt, klopte al (E2/E3). Bij beeld schommelt de achterstand met Chrome's fragmenten (één per
  ~3,4 s) tussen ~1 en ~5 s. Dat is geen fout; de strook moet "≈ 4 s achter (beeld komt per 3,4 s)" zeggen, niet "1 s".
- **Sprong** (alleen WAV): boven 8 s achterstand springt de volger naar het eind (op een frame), maar alleen als er
  ook echt ≥ 1 s in het **bestand** wacht: zit de achterstand in pijp of encoder, dan helpt springen niet en zou elke
  poll vers geluid weggooien (review 10 okt). `sprongen` en `kwijtS` tellen mee. Een mp4 wordt nooit geknipt: boven
  20 s (`achterstandMaxBeeld`) stopt de uitzending met `fout: 'achterstand'` (S29, met een hangende ffmpeg en 2 s).
- **Stoppen tijdens het starten** (wachten op de mp4 kan 10 s duren): `stop()` breekt de start af en wacht erop;
  er komt dan geen ffmpeg (R1). **`opnameKlaar` tijdens het starten** wacht eerst de start af en leest dan tot het
  eind (R12). Eerst gaf hij meteen ok zonder iets te doen; de start slaagde daarna alsnog en volgde een opname die al
  dicht was, tot "bron stil" na 10 s en een stop na 30 s (review 2, M1).
- **Bron stil**: groeit de WAV 10 s niet, dan `fout: 'bron stil'`; na 30 s stopt de uitzending (tabblad dicht).

## 5. Rechten in gewone taal

*Overgenomen uit het onderzoek van 9 okt (`~/Downloads/Muziekbibliotheek stappenplan 9 okt/`, records I57, I72,
I77, I78, I79 en "Rechten en privacy"); niet nagekeken bij Twitch, Sena of Mixcloud; geen juridisch advies.*

- **Nooit sets met muziek van anderen op je eigen YouTube-kanalen** (of eigen Twitch zonder DJ Program). Content ID
  claimt mixen, en na drie strikes ben je het kanaal kwijt. Je eigen kanalen zijn artistiek kapitaal (I77).
- **Mixcloud** (opname of Mixcloud Live): hooguit 4 nummers per artiest, niet meer dan 3 achter elkaar van dezelfde
  artiest, hooguit 3 van dezelfde release, met een tracklist. Mixcloud noemt dit zelf een aanbeveling (I77).
- **Live met muziek van anderen: het Twitch DJ Program.** Het programma regelt de rechten; geen VOD's, en clips
  zonder muziek sinds 1 sep 2026 (I77).
- **Een eigen gestreamd evenement met inkomsten** vraagt een Sena-livestreamlicentie: 3 % van de inkomsten,
  minimaal € 60,25, vooraf (I77).
- **Always-on stream: alleen eigen of CC-muziek** (I77). Het stil-profiel (2 fps, 300 kbit/s) is er technisch de kern
  van, maar "geen uitzending zonder opname" (G5) zou 16,6 GB WAV per dag kosten. Dat wordt een later spoor met een eigen bron.
- **Beeld: clips van anderen alleen thuis.** Buma/Sena dekken het geluid, niet het beeld van een clip (I78). Het
  mengcanvas bevat de YouTube-clips van de decks; daarom gaat er in v1 met beeld niets naar buiten (G8), en straks
  alleen met je eigen vormen (zaalmodus-schakelaar, spoor beeld-een-machine).
- **Bij een boeking** schriftelijk vragen of de organisator Buma en Sena regelt; organiseer je zelf een Varve-avond,
  dan ben jij de organisator. Streamen is een aparte licentie (I79).
- **Na elke set een setboek**: tracklist, verslag, setlijst voor Buma/Stemra, zodat de makers betaald worden (I57;
  spoor produceren-uit bouwt `tools/setboek/`, stap 7 voegt de Mixcloud-check toe).
- **Wat vandaag zonder rechtenzorg kan**: eigen werk (6 van je 15 items, je klankschaal, instrumenten, sampler en
  patronen) met je eigen vormen als beeld, op je eigen kanaal. Dat is precies de crossover uit VISIE §2 (U2).
- Via route C regelt Varve niets: OBS kent geen poort. Wat OBS naar buiten stuurt is jouw verantwoordelijkheid;
  de waarschuwing staat op het doel `obs-geluid`.

## 6. Hoe te testen

**Automatisch** (geen netwerk, geen dienst, alleen ffmpeg op deze Mac en `mkdtemp`-mappen):

```sh
node test/uitzend.test.mjs                          # 88 checks, ~40 s (P puur, S met ffmpeg sneller dan echte tijd, R review)
VARVE_TEST_ECHTETIJD=1 node test/uitzend.test.mjs   # + E1-E6 in echte tijd, ~72 s extra; niet tijdens een speelavond
node test/alles.mjs                                 # draait de snelle variant mee
```

- P1-P13: argv per profiel, uitgangsnaam, maskeren, het slot (18 url's), doelen laden (ook het voorbeeld), mp4-boxen,
  Opus herkennen, iCloud-waarschuwing, en G1 (welke imports).
- S14-S29: stil -> bestand (+ mp4), stil -> RTMP-ontvanger (`ffmpeg -listen 1` op 127.0.0.1), stil -> udp,
  midden in de set aan, beeld hercoderen met Chrome's cadans (keyframe per 101 beelden op 30 fps, en per 85 op 25 fps),
  beeld kopiëren naar RTMP, Opus, opname onaangetast, ffmpeg gedood, ffmpeg bestaat niet, stoppen (ook een hangend
  kind), weigeringen (ook webm na de start), bron stil, de golf gelijk met het geluid (S27, stoot op 3,0 s bij 2 en 10 fps),
  het png-profiel door ffmpeg (S28, ook op 10 fps) en de noodrem van beeld bij een hangende ffmpeg (S29).
- R1, R3, R7 (uit de code-review van 10 okt): stop() tijdens het starten gaat niet verloren; een fout tussen openen
  en spawn laat geen open bestand achter (`/dev/fd` geteld); een link naar `opnames/` omzeilt G9 niet.
- R8-R11 (uit reviewronde 1): een relatieve uitMap (`uit-rel`, en `../opnames` vanuit een andere map dan de
  uitzendmap) komt op het absolute pad dat Node toetste; alles behalve `id`/`doel`/`beeldstand`/`door` in het verzoek
  wordt genegeerd; `opnameKlaar` en `stop()` tegelijk geven beide ok en draaien geen rondjes zonder pauze (Node-CPU
  ≤ de helft van de wandtijd; vroeger ~100 %); een flv die er niet is geeft een waarschuwing in plaats van stilte.
- R12 (uit review 2): `opnameKlaar` terwijl de start nog op de mp4 wacht, leest alsnog tot het eind en stopt netjes
  (niet bezig, geen fout, de mp4 met 12 s beeld).
- Elke nieuwe check is ook tegen de oude code gedraaid (de reparaties tijdelijk teruggezet in een kopie): alle vijftien
  werden rood, op R9 na (die kon niet tegen de oude API, die nog paden uit het verzoek las). Na review 2: R12, S29, P3
  (`draw=full`) en S28 op 10 fps zijn ook tegen de code van vóór die ronde gedraaid en waren rood.
- E1-E6: echte tijd, SIGSTOP-proef met en zonder sprong, beeld met Chrome's cadans, regressiewacht (aac), CPU bij 15 fps.

**Met de hand** kan pas vanaf stap 3 (de routes). Dan zo, op een proefserver met een kopie van de library:

```sh
ffmpeg -listen 1 -i rtmp://127.0.0.1:1935/live/test -c copy ~/Movies/VARVE-uitzend/ontvangen.flv   # doel lokaal-rtmp
```

OBS (doel `obs-geluid`, **niet getest tot stap 5b**): bron *Mediabron*, *Lokaal bestand* uit, invoer
`udp://127.0.0.1:25595`, invoerformaat `mpegts`. OBS-uitgang uit, of naar een lokale opname.

**Doelen instellen** (pijler 4, zonder code): kopieer `uitzend/doelen.voorbeeld.json` naar `uitzend/doelen.json`
(niet in git) en pas aan. Velden: `naam` (`a-z0-9-`, ≤ 32), `soort` (`bestand`|`rtmp`|`udp`), `bron`
(`audio`|`video`), `beeld` (`zwart`|`golf`|`<naam>.png`, alleen audio), `fps` (1..30, alleen audio), `video`
(`hercodeer`), `inhoud` (`alles`|`vormen`, alleen video), `bitrate` (`2500k`), `url` (rtmp/udp), `omschrijving`,
`waarschuwing`. Een onbekend veld, een sleutel of een url buiten het slot maakt het doel ongeldig; de fout zegt
waarom (`laadDoelen().fouten`, straks op de Controlekamer-tegel). Zonder `doelen.json` zijn er twee ingebouwde
doelen: `proef` en `proef-alles-thuis`.

## 7. Metingen

**Jury, 10 okt (O §2), ffmpeg-materiaal, 1 s-fragmenten, 127.0.0.1 of bestand.**

| Stil-profiel | uitgang tijdens voeren (2 -> 6 s) | eind | oordeel |
|---|---|---|---|
| `-re` lavfi color + PCM, `-shortest` | 0,90 -> 1,92 -> 1,92 -> 1,92 (stokt) | exit na 11,5 s | live hortend |
| PCM + `-loop 1` png, `-shortest` | 3,0 -> 3,0 -> 6,0 -> 6,0 | beeld 0,02-10,52 s bij geluid 6 s | beeld loopt weg |
| **beeld uit het geluid (showwaves)** | **2,0 -> 3,0 -> 4,0 -> 5,0 -> 6,0** | geluid 0-6,016 s | **loopt live gelijk** |
| idem naar `ffmpeg -listen 1` | 6,0 bij wand 6 | h264 1280x720 + aac 48 kHz | **goed over RTMP** |

| Beeld-profiel (12 s) | na 6 s | na 12 s | oordeel |
|---|---|---|---|
| `-c copy` | 5,0 | 11,0 | goed |
| videotoolbox + geluid **aac** | 2,3 | **4,8** | achterstand groeit (~0,45×) |
| **videotoolbox + geluid copy** | **5,0** | **11,0** | **goed** |

CPU beeld-profiel (12 s, 720p30, 8 -> 2,5 Mbit/s): software-decoderen 2,40 s user (~20 % van een kern),
`-hwaccel videotoolbox` **0,41 s (~3,4 %)**. Stil-profiel 2 fps: ~10 % van een kern.

**Chrome's echte mp4 (kritiek, Clay's opnames van 23 sep, alleen gelezen).**

| Opname | duur | fragmenten | keyframes gem. / grootst | audio |
|---|---|---|---|---|
| `set-…-212203.mp4` | 104,5 s | 31 `moof` | 3,37 / 3,40 s | AAC-LC 48 kHz |
| `set-…-140637.mp4` | 116,1 s | 35 | 3,38 / 3,46 s | |
| `set-…-232817.mp4` | 336,1 s | 97 | 3,46 / **7,05** s | |

Eén fragment per keyframe. Met die cadans (fragment per 101 beelden, gevoerd op eind + 1 s) schommelt de
achterstand 1,3-5,3 s zonder groei over 90 s (kritiek). Daarom is `kopie` intern: de keyframes liggen 3,4-7 s uit
elkaar, een dienst wil er één per 2 s.

**Stap 1 (10 okt 13:04) en na reviewronde 1 (14:20-14:40). ffmpeg 9.0.1, Node 26.8.2, MacBook Air, load 2,6-6
door andere sporen.**

| Check | gemeten | drempel |
|---|---|---|
| S14 stil -> bestand, 6 s geluid | mp4 h264 1280x720 + aac 48 kHz, geluid 6,04 s | 6 ± 0,3 |
| S15 stil -> `ffmpeg -listen 1` | geluid 6,04 s | 6 ± 0,3 |
| S16 stil -> udp mpegts | geluid 6,04 s | 6 ± 0,5 |
| S17 aan na 3 van 6 s | 3,03 s | 3 ± 0,6 |
| S18 beeld hercoderen, Chrome-cadans | beeld 12,00 s, keyframes ≤ 2,00 s; na review 1 ook op 25 fps-materiaal 2,00 s (met alleen `-g 60`: 2,40 s) | 12 ± 0,6, ≤ 2,05 |
| S19 beeld kopie -> RTMP | 11,97 s | 12 ± 0,6 |
| S24 stoppen / snel op een hangend kind | 0,01 s / 3,01 s | ≤ 3,5 |
| S27 golf: stoot op 3,0 s, in beeld op (review 1) | 3,02 s bij 2 en bij 10 fps (zonder `setpts`: 5,02 en 3,42 s) | 3,0 ± 0,15 |
| S28 png-plaat door ffmpeg (review 1, 10 fps sinds review 2) | h264 1280x720 + aac, geluid 6,04 s; plaat in beeld (helderheid 31), stoot op 3,02 s bij 2 en 10 fps (max 75 en 140; zonder `draw=full` bij 10 fps 27,5: donkerder) | 6 ± 0,3; > 23; 3,0 ± 0,15 |
| R8 relatieve uitMap (review 1) | `uit-rel` en `../opnames`: flv en mp4 op het absolute pad dat Node toetste, niets in `opnames/` (zonder `resolve`: FAIL) | |
| R10 opnameKlaar en stop() tegelijk, 10 keer | 0 keer ok:false; Node-CPU ~1 ms per stop (oude code: 35 ms CPU in 34 ms wandtijd) | ≤ de helft van de wandtijd |
| E1 stil, echte tijd | eerst 0,00 op 4, 6, 8 s en `uitS` 9,0 na 8 s (zie §4 "Achterstand"); na review 1 **0,12 / 0,54 / 0,43 s**, `uitS` **7,87** | ≤ 2,5; ≥ 6,5 |
| E2 SIGSTOP 10 s, sprong bij 8 s | 7,00 na 6 s pauze; 1 sprong, 9,0 s kwijt; 0,00 na SIGCONT (na review 1: 1,12) | ≥ 4; ≥ 1, ≥ 7; ≤ 2,5 |
| E3 idem zonder sprong | 11,00 na 10 s pauze | ≥ 9 |
| E4 beeld hercoderen, Chrome-cadans, echte tijd (gevoerd zoals de browser: WAV-stuk op het eind van zijn seconde, fragment op eind + 1 s) | per s 0 1 2 3 4 1,6 2,6 3,6 1,3 2,3 3,3; **max 5,00 / 5,00 / 5,26 s** in drie runs; tweede helft 4,63 / 4,63 / 5,26 (eerste 5,00); beeld 12,00 s. Na review 1 (met `-force_key_frames`): max 5,00, tweede helft 4,63 | ≤ 5,5; tweede helft ≤ eerste + 0,5 |
| E4, eerste versie van de test (WAV-stuk aan het begin van zijn seconde, fragment op de eerste hele seconde na eind + 1 s: tot 0,63 s later) | max **5,26** s en **5,63** s in twee runs (één keer FAIL) | zelfde drempel; niet verruimd |
| E5 regressiewacht: beeld + geluid aac | 11,04-11,42 s achter na 12 s (vijf runs; na review 1: 11,06) | notitie (> 2,5 verwacht: niet verbeterd) |
| E6 CPU stil/golf 15 fps | 0,98-1,12 s user per 8 s (~12-14 % van een kern), alleen het ffmpeg-kind; na review 1 (met `setpts`/`trim`): 1,03 | notitie |

De piek bij E4 hangt ook af van wanneer ffmpeg zijn voortgang meldt (`-stats_period 1`): `uitS` kan tot 1 s oud zijn,
en dan lijkt de achterstand groter dan hij is. Met de cadans van de kritiek blijft hij onder 5,5 s (5,00 of 5,26,
afhankelijk van dat moment; marge 0,24 s); met de eerste, strengere voeding kwam hij één keer op 5,63 s.

**Chrome's eigen mp4 door de module** (review 1 en herstel 1: `tools/headless/beamer.mjs` op een eigen server, Chrome for
Testing headless zonder MIDI, tijdelijke db/media/opnames; de opname daarvan in Chrome's cadans gevoerd: init op 1 s, elk
fragment op eind + 1 s, elk WAV-stuk op het eind van zijn seconde).

| | bron | start | achterstand per s (max) | uitgang |
|---|---|---|---|---|
| review 1 (vóór de reparaties) | 14,7 s, 29,07 fps gemiddeld, keyframes 0 / 3,63 / 7,20 / 10,57 / 13,93 s, `mp4a` | 1,02 s | max 5,00, dalende pieken | bestand en 127.0.0.1-RTMP: beeld 0-14,7 s, keyframes tot **2,27 s** uit elkaar |
| herstel 1 | 14,6 s (nieuwe headless-opname, 5 fragmenten) | 1,02-1,03 s | 0 1 2 3 4 1,61 2,61 3,61 1,24 2,24 3,24 0,87 1,87 2,87; max **5,00** | bestand: h264 + aac 14,63 s; 127.0.0.1-RTMP: beeld 0-14,6 s, geluid 0-14,61 s; keyframes **2,00 s** |

Eén opname van 14,6 s, geen 10 minuten: dat blijft stap 2.

Bij de bouw zijn beeldjes uit de echte uitgang bekeken (frame op 5,2 s): zwart bij `proef`, een witte golfvorm op
zwart bij `golf`, het testbeeld uit videotoolbox bij `proef-alles-thuis`. Ze stonden alleen in de kladmap van die sessie.

## 8. Standaardkeuzes zonder vraag

Zeg het als je het anders wilt:

- Het standaardbeeld bij een audio-uitzending is **zwart**; `golf` en een eigen png zijn varianten.
- `fps` 2 lokaal; 15 als het ooit naar een dienst gaat.
- `kopie` is intern (alleen lokaal); voor een dienst altijd `hercodeer` (keyframe per 2 s, in seconden: `-force_key_frames`).
- Proefbestanden staan in `~/Movies/VARVE-uitzend/` (buiten iCloud, aanname: `~/Movies` synct niet), nooit in `opnames/`.
  De flv blijft staan; de mp4 ernaast is om te bekijken (dubbelklik).
- Een uitzending start in v1 met beeld alleen **samen met de opname** (binnen 10 s); midden in de set kan alleen het
  stil-profiel. Stap 4 heft dat op.
- `cut` (later, stap 9) dempt alleen de stream; de WAV hoort alles.
- Een sleutel komt, als het ooit in-app gaat, uit de sleutelhanger via de app Wachtwoorden; nooit in een bestand.
- Geen iPhone-monitor via HLS: de app van de dienst en de companion doen dat (ONTBREEKT/IDEEEN).

## 9. API (`server/uitzend.js`, geeft `{ ok, … }`, gooit nooit)

```js
laadDoelen(uitzendMap)              -> { ok, doelen: [...zonder url], fouten: [] }
toegestaan(doel)                    -> { ok } | { ok: false, fout }            // puur: G3 + G8
bouwArgs(doel, { uit, fps })        -> string[]                                // puur: §4
uitgangsPad(uitMap, id, bestaat)    -> pad                                     // puur: G9
maskeer(tekst, { pad }) · boxen(buf, vanaf) · audioCodecVanMp4(buf) · iCloudWaarschuwing(opnames, home, bestaat)   // puur
start(verzoek, instellingen)        -> { ok, doel, bron, soort, uit?, waarschuwingen } | { ok: false, fout }
      verzoek      = { id, doel, beeldstand?, door? }                         // van buiten; de rest wordt NIET gelezen
      instellingen = { opnames, uitzendMap?, uitMap?, ffmpeg?, pollMs?, stilNa?, stopNa?, achterstandMax?,
                       achterstandMaxBeeld?, wachtMp4? }
                                                                              // van de server zelf; paden worden absoluut gemaakt
stop({ snel })                      -> Promise<{ ok, duurS, bytes, stopS, uit? }>
opnameKlaar(id)                     -> Promise<{ ok }>      // lees tot het eind, laat ffmpeg spoelen, stop
stand()                             -> { bezig, start, doel, id, bron, soort, sinds, door, beeldstand, bronS, gevolgdS, uitS, achterstandS,
                                         achterstandTekst, bitrateKbit, kwijtS, sprongen, fout, ffmpeg, uit, waarschuwingen }
                                    // start: er loopt een start (wachten op de mp4); gevolgdS: null bij beeld
```

Stap 3 hangt dit aan de server (`GET /api/uitzend`, `POST /api/uitzend/start|stop`, `opnameKlaar` ná het antwoord
van "klaar", `stop({ snel: true })` bij het afsluiten). **De route geeft alleen `id`, `doel` en `beeldstand` uit de
body door, plus `door` uit de Host; `opnames`/`uitzendMap`/`uitMap`/`ffmpeg` komen uit de server zelf** (als
`instellingen`). Geeft de route toch de hele body als verzoek door, dan leest `start` er niet meer uit dan dat (R9).
Stap 3 krijgt een eigen servercheck: `POST /api/uitzend/start` met `ffmpeg`, `uitMap` en `opnames` in de body ->
genegeerd. Dat raakt het live-pad en wacht op stap 0 (één hele set opnemen met beeld) en op de uitkomst van
proefavond 1.

## 10. Wat niet getest is, en aannames

- **Niet getest**: Chrome's MediaRecorder-mp4 als live invoer over 10 minuten (stap 2; wel één headless-opname van
  14,6 s in Chrome's cadans, §7); of Chrome het init-segment bij de eerste timeslice levert; OBS' mediabron op udp en zijn vertraging (stap 5b); of OBS' Chrome-geluid de cue meeneemt;
  CPU en warmte van ffmpeg + MediaRecorder + OBS naast acht decks op de Air na 30 minuten; een echte verbinding,
  rtmps, een dienst, Content ID, 2 fps of Opus bij een ingest; iCloud-upload bij groeiende bestanden en op een
  hotspot; de oorzaak van de groeiende achterstand bij volledig hercoderen; een set langer dan 14,6 s door de module
  (de golf zelf wel over 300 s, offline door dezelfde argv: geen drift; de bron is in het echt nooit langer dan 336 s
  gedraaid: stap 0).
- **Aannames**: `~/Movies` wordt niet door iCloud gesynchroniseerd; de "USB Video"-bron in OBS is een MS2109-stick;
  de Twitch-, Sena- en Mixcloud-regels zijn zoals het record van 9 okt ze noemt; Clay's Chrome kiest
  `avc1 + mp4a.40.2` (zo op 23 sep). De CPU-cijfers gelden alleen voor het ffmpeg-kind.

## 11. Het plan

| Stap | Wat | Wanneer |
|---|---|---|
| 0 | één hele set opnemen met beeld (≥ 45 min), meten | avond 2 of de eerste vrije speelavond; geen code |
| **1** | **`server/uitzend.js`, lokaal te proeven** | **10 okt, deze PR** |
| 2 | Chrome-proef headless (`tools/headless/uitzend.mjs`), `plaat-donker.png` | niet tussen 18:00 en het einde van een proefavond |
| 3 | routes in `server/index.js`, netjes stoppen met de server | na stap 0 |
| 4 | mp4-lezer: beeld midden in de set, herstarten | |
| 5 | proefstand (`proef-rtmp`) en de thuisproef Varve -> OBS -> (nog) niets | thuis, Clay erbij |
| 6 | bediening als stand (`broadcast.toggle`), geen bovenbalk | na stap 0 en proefavond 1 |
| 7 | setboek-module en eigen-werk-lijst | vóór alles wat naar buiten gaat |
| 8 | in-app naar buiten | pas na U1b = ja en U2, alleen als OBS te zwaar blijkt |
