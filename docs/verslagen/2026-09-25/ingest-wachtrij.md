# ROADMAP 21 — deel INGEST: wachtrij, voortgang, playlist, dubbel

Branch `spoor2/ingest-wachtrij` (worktree `agent-ad397397b8050f812`), twee commits op `cc527e3`:

| commit | onderwerp |
|---|---|
| `6db958a` | Ingest: wachtrij, annuleren, playlist weigeren, dubbel herkennen (server) |
| `84ebc32` | Ingest-strook in het library-paneel: wachtrij en voortgang per nummer |

**Na mergen: de server op :8777 herstarten** (index.js, ingest.js, links.js, analyze.js,
library.js en de nieuwe wachtrij.js). Geen schemawijziging, geen nieuwe dependency.

---

## Wat er gebouwd is

### 1. Voortgang zichtbaar (per nummer, ook uploads)
- **Ontdekt:** yt-dlp schrijft zijn voortgang naar **stdout**, niet stderr, en zonder terminal
  met `\r` ertussen. De oude code las alleen stderr → er kwam **nooit** een downloadpercentage.
  Gemeten met de echte yt-dlp 2026.08.19 op een lokale server.
- Nu: `--newline --progress-template 'download:[varve] <binnen> <totaal> <schatting>'`
  (`VOORTGANG_SJABLOON`), gelezen door `leesDownload()`; de gewone `[download] 45.3%`-regel
  werkt ook nog (terugval). Voor audio én video-download.
- ffmpeg meldt een percentage via `-progress pipe:1` bij **meten**, **normaliseren** en de
  **video-transcode** (`leesFfmpegTijd`, duur uit de metadata of ffprobe). Dat is vooral bij
  lange video's de langste stap.
- `run()` levert nu hele regels van stdout (`onUit`) en stderr (`onLijn`), ook als een regel
  over twee datastukken valt.
- Elke opdracht heeft `stappen` (in volgorde, `stappenVoor()` in ingest.js, één plek) en de
  huidige `stap`/`pct`/`titel`. Een melding zonder `pct` wist het percentage (anders bleef
  de 100% van de download staan tijdens het meten — oude bug).
- De strook (`src/ui/ingest-strook.js`) toont per nummer: label van de stap (GEGEVENS,
  DOWNLOAD, METEN, NORMALISEREN, GOLFVORM, RITME, GRID, VIDEO), titel, omschrijving,
  streepjes per stap (gedaan / nu (knippert) / straks), balk en percentage.
  Uploads: eigen rijen met uploadpercentage (XHR), ook wat nog op upload wacht; te stoppen.

### 2. Wachtrij
- `server/wachtrij.js` (`Wachtrij`): **één opdracht tegelijk, links en eigen bestanden in
  dezelfde rij**. Status `wacht → bezig → klaar | mislukt | geannuleerd`, `plek` voor wie wacht.
  Het werk is een functie `werk(onStap, signal)`; de wachtrij kent geen yt-dlp of library.
- `POST /api/ingest` neemt `{ url }` (zoals vroeger) of `{ urls: [...] }` (hooguit 100), plus
  `{ opnieuw: true }`. Lijst → 202 `{ resultaten: [{ code, ...opdracht|fout }] }` in volgorde.
- Plakken van meerdere regels: een `<input>` gooit regeleinden weg en plakte drie links aan
  elkaar tot één onzin-link. De strook vangt `paste`, haalt de links eruit (`splitsLinks`) en
  zet ze met spaties in het veld; enter stuurt ze allemaal. Geweigerde links blijven in het
  veld staan, met de reden in de statusregel.
- **Annuleren**: `DELETE /api/ingest/<id>`.
  - wachtend: meteen `geannuleerd`; een upload ruimt zijn werkmap (`.bezig-upload-*`) op.
  - lopend: AbortSignal → `run()` stuurt SIGTERM (yt-dlp en ffmpeg stoppen daar netjes op),
    na 3 s SIGKILL; de analyse-worker wordt `terminate()`d (zijn ffmpeg stopt op de gesloten
    pijp — gemeten: geen ffmpeg-kind over); `verwerk()` gooit bij de volgende stap een STOP
    die hij zelf vangt (de ingest gooit nog steeds nooit naar buiten) en ruimt de werkmap op.
    De opdracht blijft `bezig` (stap `stoppen`) tot het proces echt weg is; pas dan
    `geannuleerd` en begint de volgende.
  - afgelopen: DELETE = wegklikken uit de lijst.
  - In de strook: × op een wachtende = meteen; × op de lopende = **tweede klik binnen 3 s**
    (stoppen gooit werk weg, zelfde regel als andere destructieve knoppen).
- De achtergrond-heranalyse wacht nu op `wachtrij.open` (ook wachtende, niet alleen bezig).
- De server onthoudt hooguit 200 afgelopen opdrachten (vroeger: onbeperkt).

### 3. Playlist weigeren
- `bekijkLink()` (links.js, puur): `/playlist?list=…`, `watch?list=…` zonder `v=`, kanalen
  (`/@naam`, `/channel/`, `/c/`, `/user/`), zoekresultaten en TikTok-profielen → 400 met
  `playlist: true` en een reden, vóór er iets start.
- **`v=` én `list=` wordt die ene video**: elke YouTube-video-link wordt canoniek
  `https://www.youtube.com/watch?v=<id>` (youtu.be, /shorts/, m., music., si=, index=, t=
  gaan eraf). Het antwoord zegt `lijstEraf: true`; de melding "alleen dit nummer, niet de playlist".
- Vangnet voor andere sites: de metadata-vraag heeft nu `--flat-playlist` (kort, loopt de lijst
  niet af) en weigert `_type` `playlist`/`multi_video`: de opdracht wordt `mislukt` met
  "dit is een playlist (3 nummers) "…" — plak de link van één nummer".

### 4. Dubbele download herkennen
- **In de wachtrij** (wacht of bezig) op dezelfde sleutel (YouTube-id, `tiktok-<id>`, anders
  de link; upload: `lokaal-<hash>`): dezelfde opdracht terug, `dubbel: true`.
- **In de library** (op id als die zonder netwerk vaststaat, anders op de exacte url;
  `Library.trackMetUrl()` nieuw) **én de audio staat nog op schijf**: geen yt-dlp, een
  afgeronde opdracht met `bestond: true` en het nummer (200).
- **Na de metadata** nog eens op de echte id (`ingest(..., { bestaat })`): een andere link naar
  hetzelfde nummer op een willekeurige site downloadt niet.
- "Waar logisch direct laden": de strook toont bij "al binnen" (en bij elk nummer dat net
  klaar is) laadknoppen per track; over een spelende track eerst een tweede klik, net als in
  de lijst. Een op een track gesleept bestand dat al binnen was, laadt zoals voorheen meteen.
- Toch opnieuw binnenhalen: binnen 3 s nog eens op "haal binnen" met dezelfde link →
  `{ opnieuw: true }` (zo bleef het oude "nog eens plakken = opnieuw" mogelijk).
- Staat een nummer in de library maar is de audio weg: gewoon opnieuw in de rij.

### Kleiner
- `VARVE_YTDLP`: een andere yt-dlp (voor de tests), bij elke aanroep gelezen.
- `bewaarInLibrary()` geeft het nummer terug zoals de library het NU kent. Vroeger kreeg de
  browser het track-object van de ingest, met het grid-VOORSTEL — ook als het bewaarde grid
  op slot stond en dus bleef. Laden na een upload op een track kreeg dan het verkeerde grid.
- De download-stap noemt de titel niet meer in de tekst; `titel` is een eigen veld.

---

## Bestanden

| bestand | wat |
|---|---|
| `server/wachtrij.js` (nieuw) | de rij: voegToe, voegKlaarToe, annuleer, vergeet, zoek, lijst, stil |
| `server/ingest.js` | run() met signal/onUit, leesDownload, leesFfmpegTijd, stappenVoor, metadata --flat-playlist + playlistweigering, pct bij meten/normaliseren/video, STOP-annuleren, bestaat() |
| `server/analyze.js` | inWerker(…, signal): worker terminate; maakPeaks/maakOnset/maakGrid nemen `{ signal }` |
| `server/links.js` | bekijkLink, PLAYLIST_FOUT |
| `server/library.js` | trackMetUrl(url) (na verwijderTrack) |
| `server/index.js` | wachtrij i.p.v. startOpdracht; nieuweLink(); POST {url|urls, opnieuw}; DELETE /api/ingest/<id>; upload via de rij |
| `src/ui/ingest-strook.js` (nieuw) | de strook: plakken, versturen, uploads, pollen, tekenen, ×, laadknoppen |
| `src/ui/library-panel.js` | alleen aanhaken: haalBinnen/uploadBestand(en) delegeren, pollJobs/pollen/tekenJobs weg, `_laadTrack`, `_laadNaIngest(track, deck)` |
| `styles.css` | blok "Ingest-strook" direct na `.lib-job-balk i` (niet bij `.lib-rij`) |
| `test/wachtrij.test.mjs`, `test/wachtrij-server.test.mjs` (nieuw) | zie hieronder |
| `test/nep-ytdlp.mjs` (nieuw, geen test) | nep-yt-dlp + `maakNepYtdlp(map)` |
| `test/ingest.test.mjs`, `test/upload.test.mjs` | echte yt-dlp meldt %; wachtOp kent 'wacht' |
| `tools/headless/kijk-ingest.mjs` (nieuw), `tools/README.md` | het paneel headless |

## Tests

Zonder netwerk. `nice -n 10`.
- **wachtrij.test.mjs** (nieuw, 62 checks): volgorde en één tegelijk; pct wissen/klemmen; alleen
  stap/tekst/pct/titel mogen van het werk komen; annuleren wachtend (bijAnnuleren, nooit gestart)
  en lopend (blijft `stoppen` tot het werk stopt, dan `geannuleerd`, dan de volgende); werk dat
  gooit → mislukt; wegklikken; geheugengrens. `bekijkLink`: list eraf, alle YouTube-vormen één
  sleutel, playlist/kanaal/profiel geweigerd. `leesDownload`/`leesFfmpegTijd`. `run()` stopt een
  `sleep 30` op het signal; hele regels over datastukken; een analyse-worker stopt in ~150 ms en
  laat **geen ffmpeg-kind** achter (pgrep -P). Pijplijn met de nep-yt-dlp: voortgang, titel,
  werkmap tijdens download, annuleren → SIGTERM, proces weg, werkmap weg, media/ leeg;
  `--flat-playlist`; % uit ffmpeg; bestaat() → geen download; playlist uit metadata; kapotte link.
  Strook (puur): splitsLinks, zichtbaar (volgorde, hoe lang), stappenStand.
- **wachtrij-server.test.mjs** (nieuw, 35 checks): eigen server op eigen poort, tijdelijke
  VARVE_DB/MEDIA/OPNAMES, `VARVE_YTDLP` = nep. Playlist 400; "al in de library" via youtu.be-vorm
  zonder yt-dlp-aanroep; `{ urls }` met 6 links (bezig + 3 wacht op plek, 2× 400); dubbel in de
  rij; voortgang in GET; wachtende annuleren; lopende annuleren (403 van een vreemde Origin, 200 van
  de eigen pagina), proces weg, werkmap weg; volgorde van de downloads in het nep-log (de
  geannuleerde wachtende nooit); library-inhoud; na afloop dubbel (url), andere link zelfde id
  (alleen metadata), `opnieuw`, audio weg = opnieuw; playlist uit de metadata; wegklikken; 404;
  lege/te lange lijst 400; **upload wacht achter een lopende link** (status wacht, stappen zonder
  metadata/download), annuleren ruimt `.bezig-upload-*` op; geen werkmap over, server leeft.
- **ingest.test.mjs**: de ECHTE yt-dlp op de lokale server meldt nu een oplopend percentage tot
  100 (15 keer). Dit faalt op de oude code (zie tegenproef hieronder).
- **upload.test / server.test / bronnen.test**: ongewijzigd groen (upload.test: wachtOp kent 'wacht').
- **Headless** (`VARVE_KIJK_POORT=8868 VARVE_KIJK_DEBUG=9468 node tools/headless/kijk-ingest.mjs`):
  25 checks groen, geen fouten in de pagina. Vier regels plakken (4 links in het veld, niet aan
  elkaar), 1 bezig + 2 wachtend + kop, playlist geweigerd en blijft in het veld, `watch?v=` zonder
  list=, DOWNLOAD met % en oplichtend streepje, × wachtend meteen, × lopend vraagt tweede klik en
  stopt, volgende loopt, klaar met 8 laadknoppen, dubbel → "al binnen" + laadknoppen, laadknop 1 →
  nummer op track 1, playlist uit metadata → MISLUKT blijft staan, × klikt weg.
  Foto's: `scratchpad/ingest/foto/ingest-{voortgang,annuleren,klaar,dubbel,mislukt}.png`.
- **Hele suite** (`nice -n 10 node test/alles.mjs`): 31 bestanden, 2021 checks, 30 groen.
  ROOD: `vormen-meer.test.mjs` op één TIJDmeting ("if: max < 16 ms per stap bij kwaliteit 1"),
  los opnieuw gedraaid: weer rood op dezelfde meting. De machine had een load average van 19–24
  (andere sporen); `src/vormen/` en die test zijn op deze branch niet aangeraakt
  (`git diff cc527e3 --stat -- src/vormen test/vormen-meer.test.mjs` is leeg). Timing onder
  belasting, niet door dit werk — graag op een rustige machine nog eens.
  wachtrij.test 62 ok, wachtrij-server.test 35 ok, ingest.test 31 ok.
- **Tegenproef:** de nieuwe ingest.test-check tegen de OUDE server-code (cc527e3) gedraaid:
  `FAIL de echte yt-dlp meldt een downloadpercentage (0 keer)`. Dus echt nooit een % gezien.

## Wat NIET getest is

- **Echte YouTube/TikTok** (netwerk mocht niet): het voortgangssjabloon is gemeten op de echte
  yt-dlp tegen een lokale server (generic, http). Op YouTube (DASH, soms fragmenten) en TikTok
  niet gezien. Bij fragmenten kan `total_bytes` NA zijn; dan gebruikt hij de schatting, en is die
  er ook niet, dan geen percentage (de stap staat er wel).
- **Kleinkinderen bij annuleren**: alleen het directe proces (yt-dlp of ffmpeg) krijgt SIGTERM.
  yt-dlp start soms zelf ffmpeg (FixupM4a na een YouTube-m4a, een paar seconden). Annuleer je
  precies dan, dan wacht `run()` tot dat ffmpeg klaar is (hij houdt de pijp open) — de werkmap
  gaat daarna alsnog weg. Niet gemeten. Een procesgroep (`detached` + `kill(-pid)`) lost dat op,
  maar vraagt dan ook eigen SIGINT/SIGTERM-afhandeling van de server; bewust niet gedaan.
- De strook in **Clay's Chrome** met zijn library; alleen headless (swiftshader).
- Een lopende **upload stoppen** (xhr.abort) in de browser: niet headless geklikt; de server kant
  ("afgebroken" → werkmap weg) is bestaand en getest in upload.test.
- **Lange stukken** (album van 3 uur, 4K-video): percentages van ffmpeg op lange duur niet gezien.
- Server herstarten terwijl er iets in de rij staat: de rij is in het geheugen en is dan weg
  (zoals vroeger de opdrachten); `.bezig-*` wordt bij het opstarten opgeruimd (bestaand).

## Aannames (kunnen verkeerd zijn)

1. **Eén tegelijk, uploads ook achteraan.** Een video die je op een track sleept wacht dus achter
   een lange download. Alternatief: uploads (of alleen "op een track gesleept") vooraan in de rij.
2. **Kanalen, zoekresultaten en TikTok-profielen tellen als playlist** en worden geweigerd.
3. **"Al in de library" = zelfde id, en de audio staat op schijf.** Zelfde nummer op een andere
   site (YouTube vs TikTok) herkent hij niet (andere id). Geen vergelijking op titel.
4. **Opnieuw binnenhalen = tweede klik binnen 3 s** op "haal binnen" met dezelfde link.
5. **De canonieke YouTube-link laat `t=` vallen** (tijdstip in de video; voor de ingest zinloos).
6. Een mislukte opdracht blijft staan tot je hem wegklikt (zoals foutmeldingen); klaar 20 s,
   "al binnen" 30 s, geannuleerd 8 s. De server onthoudt 200 afgelopen opdrachten.

## Vragen voor Clay

1. Moet een bestand dat je op een **track** sleept voorrang krijgen in de wachtrij (nu: achteraan)?
2. Playlist is nu geweigerd, zoals gevraagd. Wil je later "**hele playlist in de wachtrij**"
   (met `--flat-playlist` zijn de losse links er al; dat is een klein stapje), of blijft weigeren goed?
3. Is de **tweede klik op "haal binnen"** de goede manier om iets opnieuw binnen te halen, of liever
   een ↻-knop in de strook bij "al binnen"?
4. Stoppen van een **lopende** download vraagt een tweede klik op ×. Te voorzichtig?

## Voor de hoofdsessie (mergen)

- `src/ui/library-panel.js`: de andere sporen (sorteren/virtuele lijst, kolom toon) raken
  `tekenRijen`/`ververs`; ik heb alleen de constructor (strook aanhaken, twee listeners weg,
  `this.opdrachten/uploads/naLaden` weg, `this.pollen()` weg) en het blok haalBinnen…_laadNaIngest
  plus pollJobs/pollen/tekenJobs aangeraakt. `_laadNaIngest` heeft een nieuwe vorm `(track, deck)`.
- `styles.css`: mijn blok staat direct na `.lib-job-balk i{…}`, vóór `.lib-rijen`.
- `docs/VERBETERINGEN.md` ronde 3, regel "Ingest: voortgang zichtbaar, wachtrij, playlist-URL
  weigeren, dubbele download herkennen." mag doorgestreept (niet gedaan om botsingen met de
  buurregels van andere sporen te vermijden).
- ROADMAP 21 deel "voortgang/wachtrij ingest" is hiermee af.

## Voorstel CLAUDE.md-tekst

In **Structuur** onder `server/`:
```
  wachtrij.js       de ingest-wachtrij: één tegelijk (links en uploads), annuleren met een AbortSignal
```
onder `src/ui/`: `ingest-strook.js de wachtrij en voortgang in het library-paneel (plakken, ×, laadknoppen)`;
onder `test/`:
```
  wachtrij.test.mjs  wachtrij, annuleren (ook midden in een nep-download), playlist, dubbel, voortgang
  wachtrij-server.test.mjs  eigen server + nep-yt-dlp: urls, volgorde, DELETE, dubbel, upload in de rij
  nep-ytdlp.mjs     nep-yt-dlp voor de tests (VARVE_YTDLP), geen netwerk — geen test zelf
```

In **Bekende grenzen**:
```
- INGEST-WACHTRIJ (25 sep 2026, server/wachtrij.js): één opdracht tegelijk, links én
  eigen bestanden in dezelfde rij (status wacht → bezig → klaar/mislukt/geannuleerd). POST
  /api/ingest neemt { url } of { urls } (≤ 100) en { opnieuw }; DELETE /api/ingest/<id>
  annuleert (wachtend: meteen, upload ruimt zijn werkmap op; lopend: SIGTERM, na 3 s
  SIGKILL, analyse-worker terminate, werkmap weg — pas daarna de volgende) of klikt een
  afgelopen opdracht weg. Alleen het DIRECTE proces krijgt het signaal; een ffmpeg die
  yt-dlp zelf start (FixupM4a) loopt nog even door.
  yt-dlp schrijft zijn voortgang naar STDOUT (met \r zonder terminal): daarom --newline en
  een eigen --progress-template ([varve] binnen totaal schatting). De oude code las stderr
  en zag nooit een percentage. ffmpeg-stappen melden % via -progress pipe:1.
  Playlists: bekijkLink() weigert playlist/kanaal/profiel vóór de rij; v= én list= wordt
  https://www.youtube.com/watch?v=<id> (alle YouTube-vormen worden die link). Vangnet:
  metadata met --flat-playlist weigert _type playlist/multi_video.
  Dubbel: zelfde sleutel in de rij = die opdracht; in de library (id, of exacte url) met
  audio op schijf = afgeronde opdracht met bestond, zonder yt-dlp; na de metadata nog eens
  op id. Opnieuw = { opnieuw: true } (strook: tweede klik op haal binnen binnen 3 s).
  VARVE_YTDLP = andere yt-dlp (tests: test/nep-ytdlp.mjs). Een <input> gooit regeleinden
  weg: de strook vangt plakken zelf en zet de links met spaties in het veld.
```
