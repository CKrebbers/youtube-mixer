# Controle ROADMAP 21b — ingest: wachtrij, voortgang, annuleren, playlist, dubbel

Controleur, 25 sep 2026. Branch **`spoor2/ingest-wachtrij-c`** (vanaf `spoor2/ingest-wachtrij`,
`84ebc32`), worktree `agent-a6f9fe336190aac21`. Niet gemerged, niet gepusht.

## Commits (bovenop de twee van de bouwer)

| commit | herstel |
|---|---|
| `7eb439d` | Annuleren hing als yt-dlp ffmpeg als downloader gebruikt: SIGINT en de hele familie |
| `4c9accb` | Strook: een klik op × of een laadknop ging verloren als hij net hertekende |
| `5413c9d` | Strook: na een serverherstart niet eeuwig blijven pollen voor een gesleept bestand |
| `904b5a9` | bekijkLink: embed/videoseries en embed/live_stream zijn geen video-id |

Na mergen: **server op :8777 herstarten** (ingest.js, links.js veranderd; geen schema, geen dependency).

---

## Bevindingen

### 1. HOOG — annuleren (en de time-out) hing als yt-dlp ffmpeg als downloader gebruikt — HERSTELD

`run()` stuurde bij annuleren SIGTERM naar het directe proces. yt-dlp is Python en heeft
**geen** SIGTERM-afhandeling (in de geïnstalleerde 2026.08.19 nagekeken: geen `signal.signal`
behalve in websocket.py): hij valt meteen om en laat zijn kinderen staan. Bij een livestream
of een HLS-bron (en bij `is_live` op YouTube/TikTok) is dat kind een **ffmpeg als downloader**
(`FFmpegFD`), gestart met `Popen(args, stdin=PIPE)` — zonder stdout/stderr om te leiden, dus
het **erft onze pijpen**. Node's `'close'` wacht op die pijpen.

Gemeten met de echte yt-dlp tegen een lokale server (eigen config `--downloader ffmpeg`,
`-re`, 60 s bestand): na annuleren **hing run() > 15 s**, ffmpeg liep door en schreef
`rauw.wav.part` in de werkmap. Bij een livestream: nooit klaar → de opdracht blijft op
"stoppen", en omdat de rij één-voor-één is, **staat de hele wachtrij stil** tot een
serverherstart. Hetzelfde gold voor de time-out van 30 min (SIGKILL op de ouder, kind blijft).
Vóór de wachtrij kostte dat één opdracht; nu blokkeert het alles erachter.

Herstel (`server/ingest.js`, `run()` + nieuwe `nakomelingen(pid)`):
- Eerste signaal **SIGINT** (Ctrl-C): yt-dlp krijgt KeyboardInterrupt, stuurt zijn ffmpeg
  een `q` (`FFmpegFD._call_downloader`) of killt een nabewerking (`communicate_or_kill`),
  wacht en stopt. Gemeten: 0,6–0,9 s, niets over. ffmpeg zelf stopt op SIGINT net zo
  netjes als op SIGTERM (zelfde `sigterm_handler`).
- De familie (`ps -A -o pid=,ppid=`) wordt meteen opgeschreven; na 3 s SIGKILL voor hem
  en alles eronder, en onze pijpen los (`destroy`), zodat `'close'` altijd komt.
- De time-out loopt nu via dezelfde `stop()`; `afgebroken` blijft alleen voor annuleren
  (een time-out wordt geen "geannuleerd").
- Bewust GEEN `detached` + procesgroep: dan krijgen yt-dlp/ffmpeg Ctrl-C op de server niet
  meer mee en blijven ze na een serverstop draaien.

Tests die op de oude code FALEN (tegenproef gedraaid):
- `ingest.test.mjs`: de ECHTE yt-dlp met ffmpeg als downloader (eigen `XDG_CONFIG_HOME`
  alleen voor die check), annuleren → oud: "hing > 15 s, 1 proces over"; nu 940 ms, 0 over.
- `wachtrij.test.mjs`: de nep-yt-dlp gedraagt zich nu als de echte (SIGINT ruimt op,
  SIGTERM valt om) en kent `kind` (erft onze pijpen, zoals FFmpegFD) en `doof` (negeert
  SIGINT). Oud: 10 s hangen, ouder/kind blijven; nu 10 ms resp. 3,1 s, alles weg.

### 2. MIDDEL — klikken in de strook gingen verloren — HERSTELD

`teken()` zette bij elke poll (1,2 s, ook als er niets veranderde, zolang het paneel open is)
en bij elk `upload.onprogress` de hele `innerHTML` opnieuw. Een knop die tussen indrukken
en loslaten vervangen wordt, krijgt in Chrome **geen klik** (headless gemeten met CDP-muis:
1 klik zonder hertekenen, 0 met). Gevolg: × op een upload met voortgang (events om de
~50 ms) was met de muis vrijwel niet te raken; tijdens een download ging ~1 op 10 klikken
op × of een laadknop verloren (de tweede-klik-bevestiging maakt dat twee kansen). De oude
jobs-strook had geen knoppen, dus dit is nieuw.

Herstel (`src/ui/ingest-strook.js`): niet hertekenen zolang er in de strook gedrukt wordt
(`pointerdown` → vast; `pointerup`/`pointercancel`/`blur` → los, daarna — na de klik —
alsnog tekenen), en alleen tekenen als de HTML echt veranderde (ook: geen hover-sprongen,
het knipperende streepje begint niet elke poll opnieuw).
Test: `kijk-ingest.mjs` drukt × nu met de MUIS (CDP Input) en houdt 2,5 s vast terwijl de
voortgang loopt. Met de oude strook: FAIL (klik weg); nu groen.

### 3. LAAG — eeuwig pollen na een serverherstart — HERSTELD

`naLaden` (op een track gesleept bestand) bleef een opdracht-id vasthouden tot de server
"klaar" zei. Na een herstart kent de server hem niet meer → `_tik` pollde voor altijd elke
1,2 s, ook met het paneel dicht. Nu valt een onbekend id af — alleen als hij al wachtte toen
de poll vertrok (een upload die terugkomt terwijl een oudere poll onderweg is, anders gewist:
die race zat in mijn eerste versie en heeft nu een eigen check). Test in `wachtrij.test.mjs`
(IngestStrook met nep-fetch); faalt op de oude strook.

### 4. LAAG — `embed/videoseries` en `embed/live_stream` — HERSTELD

Beide woorden zijn 11 tekens en gingen door `YT_ID`. `/embed/videoseries?list=…` (de
insluitcode van een playlist) werd `watch?v=videoseries` met de melding "alleen dit nummer,
niet de playlist" en daarna een mislukte download. Nu: playlist geweigerd;
`/embed/live_stream?channel=…` als kanaal geweigerd. Check faalt op de oude links.js.

### 5. LAAG — zombie-ffmpeg per geannuleerde analysestap — NIET hersteld

`inWerker` doet `terminate()` op de worker; zijn ffmpeg stopt wel (gesloten pijp), maar
niemand roept `waitpid` meer aan (het proces hoorde bij de lus van de worker): het blijft
als `<defunct>` onder de server staan tot die stopt. Gemeten: 5× annuleren = 5 zombies.
Onschadelijk op deze schaal (een plek in de procestabel), maar het groeit per annulering
tijdens golfvorm/ritme/grid. Voorstel: in analyze.js de lopende ffmpeg's bijhouden; bij
annuleren de worker een `stop`-bericht sturen die ze killt en op hun `close` wacht, en pas
na ~2 s alsnog `terminate()`. Niet gedaan: raakt ook de heranalyse en tap-verfijning.

### Nagekeken en in orde

- **Werkmappen**: elk pad ruimt op (annuleren wachtend: `bijAnnuleren`; lopend: `mislukt(map)`
  na `STOP` of `afgebroken`; upload 413/415/leeg/afgebroken/bestond/loopt; opstarten
  `.bezig-*`). Met herstel 1 schrijft er na `run()` niemand meer in de werkmap.
- **Analyse-worker**: per opdracht een nieuwe `Worker`; de achtergrond-heranalyse gebruikt
  eigen workers en wacht op `wachtrij.open`. Toonsoort bestaat nog niet.
- **Server-herstart**: de rij staat in het geheugen en is weg; wachtende uploads verliezen
  hun werkmap bij het opstarten. De strook toont dan stil niets meer (zie voorstel).
- **Uploads in de rij**: werkmap en grens ongewijzigd, 413/415 uit upload.test groen;
  dubbel op `lokaal-<hash>` in rij en library.
- **Dubbel**: YouTube-vormen (youtu.be, shorts, m., music., si=, t=, list=) één sleutel;
  TikTok `tiktok-<id>` gelijk aan `trackIdVoor`; korte TikTok-links via `bestaat()` na de
  metadata. Library-vorm (`lib.track`) in de opdracht: dezelfde vorm als GET /api/library.
- **Playlist/kanaal/profiel**: `/playlist`, `watch?list=` zonder v, `/@naam`, `/channel/`,
  `/c/`, `/user/`, `/results`, `/feed/`, TikTok-profiel (ook met `?lang=` en `/`) vooraf;
  `music.youtube.com/browse/…`, `/hashtag/…`, TikTok-playlist/collectie via het vangnet
  (`--flat-playlist` + `_type`). `--flat-playlist` verandert niets voor één video.
- **Voortgang**: `leesDownload` (NA, 0, e-notatie, kleurcodes, `[download]`-terugval, frag-
  regels) en `leesFfmpegTijd` (N/A, negatief, `progress=end`) geven netjes null.
- **Veiligheid**: DELETE valt onder `vreemdVerzoek` (Host + Origin, 403 getest), id
  `[\w-]+`, geen pad; meldingen en rijen door `esc()` (titels van yt-dlp zijn vreemde tekst).
- **Polling**: 1,2 s zolang er iets loopt, een upload of naLaden open staat, of het paneel
  open is (zoals vroeger); nu zonder DOM-werk als er niets veranderde.
- **Bijvangst** (`bewaarInLibrary` geeft `lib.track()` terug): klopt; een grid op slot blijft
  wat de browser laadt, en de vorm is die van de library-lijst waar `laad()` al mee werkt.

## Voorstellen (niet gebouwd)

1. **Livestreams weigeren** in `metadata()` (`is_live` / `live_status` 'is_live'/'is_upcoming'):
   nu downloadt hij tot de time-out van 30 min en mislukt dan (annuleren werkt wel, sinds herstel 1).
   `youtube.com/watch?v=<live>` en `tiktok.com/@naam/live` komen er nu door.
2. Na een serverherstart zegt de strook niets over verdwenen opdrachten ("server herstart:
   3 links uit de wachtrij zijn weg").
3. Zombie-herstel uit bevinding 5.

## Tests

- Gericht (nice -n 10): wachtrij.test, wachtrij-server.test, ingest.test groen; tegenproeven op
  de oude code FAIL zoals hierboven.
- Headless `kijk-ingest.mjs` (poorten 8897/9497): voor en na groen, met de muis-check erbij;
  foto's bekeken (`scratchpad/ctrl/foto-na/`).
- Hele suite (`nice -n 10 node test/alles.mjs`, load ~37 door andere sporen): **31 bestanden,
  2031 checks, alles groen** (ook de vormen-tijdchecks deze keer). Geen restprocessen van de tests.

## Niet getest

- Echte YouTube/TikTok (geen netwerk): SIGINT-gedrag is gemeten op de echte yt-dlp met een
  lokale bron en een eigen config; op een echte livestream niet.
- curl_cffi (TikTok): mogelijk slikt een cffi-callback de KeyboardInterrupt; dan vangt de
  SIGKILL na 3 s het op (de `doof`-check), niet met TikTok zelf gezien.
- De strook in Clay's Chrome met een echte muis; alleen headless met CDP-muis.
- Upload-× tijdens een echte grote upload (alleen het mechanisme via de download-rij).
- Linux-`ps` (alleen macOS).

## Voorstel CLAUDE.md-tekst

Neem het voorstel van de bouwer over (Structuur: wachtrij.js, ingest-strook.js, de twee tests en
nep-ytdlp.mjs), maar vervang in zijn blok "INGEST-WACHTRIJ" de annuleerzin door:

```
  lopend: SIGINT (niet SIGTERM: yt-dlp is Python zonder SIGTERM-afhandeling en liet
  de ffmpeg staan die hij als downloader start bij live/HLS — die erft onze pijpen,
  dus run() hing tot ffmpeg klaar was, bij een livestream nooit, en de rij stond
  stil). Op SIGINT stuurt yt-dlp ffmpeg een 'q' en stopt (0,6–0,9 s). Na 3 s
  SIGKILL voor de hele familie (ps, opgeschreven vóór het signaal) en onze pijpen
  los. De time-out van run() gaat ook zo. Analyse-worker: terminate(); zijn ffmpeg
  stopt, maar blijft als zombie tot de server stopt (bekend, klein).
  De strook tekent niet terwijl er in gedrukt wordt en alleen bij verandering: een
  knop die tussen indrukken en loslaten vervangen wordt, krijgt in Chrome geen klik.
```
