# tools/

Hulpmiddelen voor ontwikkelen en meten. Niets hiervan draait in de app.

## beatmeting/
Metingen van het beatgrid op Clay's ECHTE library (docs/BEATGRID.md). Lezen alleen
`media/<id>/onset.bin` en `audio.wav` en de library via de draaiende server
(`http://localhost:8777/api/library`); schrijven niets in media/ of de database.
Draai met `node tools/beatmeting/<script>.mjs` vanuit de projectmap.

| script | wat |
|---|---|
| lib.mjs | gedeeld: library ophalen, onset laden, pasmaten; importeert server/detect.js |
| overzicht.mjs | tempo over de hele track, curve, segmenten, verfijning op 5 plekken |
| gridfit.mjs, fasespoor.mjs `<id> <bpm> <firstBeat>` | klopt een grid, per venster, tegen een nul |
| puls.mjs | is er een puls, en voorspelt de zekerheid dat |
| regio.mjs | verfijnen en fase-spoor in één gebied |
| tap-sim.mjs | tikken simuleren (40 proeven per plek) — de cijfers in BEATGRID.md |
| tijd.mjs | rekentijd en bit-vergelijking met onset.bin |
| offset-synth.mjs, offset-check.mjs | fase-afwijking van de onset-ijking |
| stapA/sim.mjs e.a. | de metingen vóór/na stap A (tap 53% → 91% goed, 0% offbeat) |
| rest/fragment.mjs `id:van:duur[:nul]` | restpunt 1: analyseerGrid oud (cc527e3) tegen nieuw (tweedeKans) op fragmenten van onset.bin |
| rest/tel1-synth.mjs `[tempofout]`, rest/tel1-echt.mjs `id:van:duur:bpm` | restpunt 2: "tel 1 hier" met en zonder verfijnen, synthetisch en op echte muziek |
| rest/gridpast.mjs `[id:van:duur[:nul] ...]` | restpunt 4: past het grid op elk stuk, vóór (12776ba) tegen nu, op 48 fragmenten |
| rest/gridpast-synth.mjs `[naam ...]` | hetzelfde synthetisch, de echte kicks bekend (`LANGE_MIX=1`: ook een mix van 20 min) |
De *.txt-bestanden zijn de uitkomsten van 23 september 2026, ter vergelijking; die in
`rest/` van 25 september. `rest/` leest geen server maar de bestanden zelf (ook vanuit een
worktree: de media-map komt via git) en knipt audio naar de tijdelijke map van het systeem.

## git/
- `test-index.sh` — test precies wat er in de git-index staat (niet de werkmap): pakt de
  index uit in een tijdelijke map en draait daar alle tests. Handig bij het splitsen van
  werk in meerdere commits.
- `hunks.py` — `list <bestand>` toont de hunks van een bestand; `stage <bestand> '[0,2]'`
  zet alleen die hunks klaar; `strip <bestand> 'a-b,c-d'` zet de werkversie min die regels klaar.

## mapping/
- `eerder.mjs [git-revisie] [apparaat]` — na een wijziging aan `mappings/apc40mk2.json`: zet
  de vorige versie (standaard uit git HEAD) als voorganger in `eerder`, met de voorgangers
  die die al had. Nodig zodat een oude VOLLEDIGE eigen mapping bij het omzetten tegen de
  juiste standaard wordt afgezet (docs/MAPPING-VERSCHIL.md, "Eerdere standaarden").
  `test/mapping.test.mjs` controleert dat elke voorganger terug te rekenen is.

## bench/
- `vm-bench.cjs [id] [N]` — rekentijd per stap van de Vormmachines in Node (nep-canvas,
  tekenen telt niet mee: een ondergrens). Een kopie van de systemen uit Clay's
  `vormmachines.html`. De cijfers staan in `docs/plugins/02-analyses.md` (risico's).
- `renderblok.mjs [--sec 60] [--rondes 3] [--ref <commit>] [--profiel]` — het audiopad van
  acht streamende decks: de echte worklet (`stream-lezer.js` + `renderBlok`) in een
  nagebouwde AudioWorkletGlobalScope, met loops, seeks, hotcues, tempowissels, pauze, een
  gat en het trackeinde. Meet uitvoer (hash over de bits), CPU per seconde audio, blokken/s,
  tijd per stap en AFVAL (bytes per blok, GC's tijdens de run, heap na GC); `--profiel`
  zegt per functie waar er gealloceerd wordt. `--ref` meet een oudere commit ernaast (uit
  git, alleen lezen). Draai met `nice -n 10 node --expose-gc tools/bench/renderblok.mjs`.
  Cijfers: `docs/AUDIOPAD.md` (25 sep: 194 → 57,5 ms/s, 12,7 kB → 0 afval per blok). De
  bewaking dat het afvalvrij blijft zit niet hier maar in `test/renderblok.test.mjs`.
  Met stems (3 okt): `--stems 2,4` (standaard aan) meet ook 8 decks × 2 en × 4 stems,
  `--ref-stems` de oude kern ernaast; cijfers in `docs/AUDIOPAD.md` ("Stems").

## headless/
- `stems.mjs [--nep] [uitmap]` — de stems van binnenhalen tot horen (eigen server op 8793, nep-yt-dlp,
  nep-splitter via `maakNepStems`): binnenhalen met stems=2, de kolom, laden, de STEMS-rij, kill
  per stem met de muis GEMETEN aan de master (zang weg 0,25 · alles weg 0 · terug 1; vier stems:
  drums weg 0,9 · rest weg 0,4), opnieuw splitsen geweigerd terwijl het speelt, herladen-teken,
  layout op 1440×790 en 1920×1080, de tegel in de Controlekamer. `--nep` = alleen de ui
  (/api/stems en de stem-actions nagebootst in de pagina).
- `koptelefoon.mjs` — de koptelefoon (docs/STUDIO.md §3), eigen server op 8798, geen MIDI: de
  KOPTELEFOON-rij (zonder vier kanalen: "geen koptelefoonuitgang", cue-knoppen uit), en de echte
  engine op een OfflineAudioContext van VIER kanalen: track 1 op 440 Hz met de fader dicht, track 2
  op 1000 Hz, per kanaal gemeten (Goertzel). Zaal 1/2 alleen track 2; koptelefoon 3/4 met de cue op
  track 1 alleen track 1 (−9 dB tegen −156 dB); mix, volume (13,5 dB) en omgewisseld. Raakt de
  geluidsinstellingen van de Mac niet.
- `plan.mjs` — het planvenster in headless Chromium (server op 8795, eigen VARVE_PLANNEN): de knop
  "plan" opent plan.html, voorspelling, bewerken, ongedaan maken, opslaan (vorige versie bewaard),
  nummer erbij, auto aan over de bus van de mixer, live "speelt nu", een wijziging van buitenaf
  (het bestand) komt binnen, een botsing wordt gemeld, en de lijst past op 1280 en 900 px.
- `auto.mjs` — de auto-DJ in headless Chromium (eigen server op 8794): drie demotracks als library
  (in het geheugen), een set via de AUTO-rij en de knoppen (blend, dan filter-uit naar een onzeker
  grid), meet de master: nooit dode lucht. Duurt ~2 minuten, de set speelt echt.
- `klankschaal.mjs` — de klankschaal in headless Chromium, zoals `kijk.mjs` (geen MIDI, eigen
  server op 8793, tijdelijke database). Laadt de worklet, zet een demotrack in A mineur +43 ct
  op track 1, meet de toonhoogte van een veld achter de schaal (AnalyserNode), transponeert met
  de hand, wrijft, en kijkt of de rij op laptopmaat past. Werkt ook op Linux (`chromium` op het pad).
- `controle.mjs` — de Controlekamer (docs/CONTROLEKAMER.md) naast een echte mixer in een tweede tabblad van
  dezelfde headless Chromium (Web Lock en BroadcastChannel zoals bij Clay): mixer open/dicht, een tweede mixer
  rood, de knop "mixer openen", wat er in de mixer staat, afvinken en notities na herladen. Eigen server
  (8796), tijdelijke database en speellijst, MIDI eruit vóór elke pagina. Schermafdruk `controle.png`.
- `noodknoppen.mjs` — zwart, bevriezen, master en flits (A4) pixel voor pixel, in het hoofdvenster én
  in het losse venster (video.html, dat zelf mengt). Geen ingest: een canvas met vier gekleurde kwarten
  als nep-video op track 1 (demotrack eronder, stil). De fade en de flits worden op EXACTE tijden gemeten
  (performance.now even zelf gezet: met swiftshader duurt één beeld lezen tot seconden). Eigen server
  (8797), MIDI eruit vóór elke pagina. Headless shell uit de Playwright-cache (ook
  PLAYWRIGHT_BROWSERS_PATH en ~/.cache) of VARVE_CHROME.
- `kijk.mjs` — de app in een headless Chromium (uit de Playwright-cache, geen npm-pakket;
  het DevTools-protocol over Node's eigen WebSocket). Eigen server op poort 8791 met een
  tijdelijke database. **Veilig met de APC aangesloten:** `navigator.requestMIDIAccess`
  wordt weggehaald vóór de pagina laadt, dus er komt geen tweede MIDI-client. Test de app
  met en zonder `?vormen=1`, stuurt APC-bytes door de mapping (`parseMessage` →
  `mapping.handle`), tekent 60 beelden en zet schermafdrukken in `tools/headless/uit/`
  (niet in git). Let op: in headless rekent WebGL in software (swiftshader); snelheid
  zegt hier niets. Het handelingenlog loopt er helemaal doorheen: knop, bus, server,
  lijst, terugspelen (demo én een klikspoor dat door de ingest gaat), mee met een
  opname, en de tegenproef dat een teruggespeelde track niets in de library bewaart.
  De Q van quantize bij Lock staat er precies als Lock (in het open mapje) geen
  quantize is, los van wat de standaardmapping met Lock doet.
  Poorten: `VARVE_KIJK_POORT` en `VARVE_KIJK_DEBUG` (naast een andere sessie).
- `toon.mjs` — de toonsoort op het scherm nalopen met een NEP-library (verzoeken
  onderschept): kolomkop, focus, correctiemenu, library-kolom en kiezer.
- `toon-keten.mjs` — de toonsoort door de HELE keten met de echte server, niets
  onderschept: upload → ingest (stap "toon") → /api/library → deck → kolomkop/focus →
  corrigeren → POST → slot → pagina herladen → ↻. Vertraagt alleen peaks.bin van een
  tweede nummer, om te zien dat laden over een track het vorige nummer niet wist. Een
  derde nummer (kwinten op C en G) laat de analyse twijfelen: de tweede kandidaat van
  de server moet in de tooltips van library, kolomkop en focus staan.
  Beide met `VARVE_KIJK_POORT`/`VARVE_KIJK_DEBUG` zoals kijk.mjs.
- `library.mjs [uitmap]` — het library-paneel met een GROTE library: maakt een tijdelijke
  database met 5000 nummers (`VARVE_KIJK_AANTAL`) plus twee met echte audio, en bekijkt
  openen, scrollen tot onderaan (rijen in de DOM, ms per beeld, aantal pagina-verzoeken),
  sorteren op elke kolomkop (vergeleken met de API), zoeken, de sortering na herladen, en
  hotcues die bij het nummer bewaard worden en terugkomen (ook op een andere track).
  Zelfde veiligheid als `kijk.mjs` (geen MIDI, eigen server). Poorten: `VARVE_KIJK_POORT`
  (standaard 8814) en `VARVE_KIJK_DEBUG` (9414).
- `apc-klank.mjs [uitmap]` — de APC-indeling "Voorstel A" (25 sep) met een nep-APC (bytes →
  `parseMessage` → `mapping.handle`, geen MIDI, eigen server): Shift + scene 5 = modus klank,
  mapje-balk, kill-pad vasthouden en met shift vastzetten, Bank ◀ ▶ (beatjump en lengte),
  Pan/Sends/User (loop in/out/reloop), Lock (quantize; in de grid-modus het slot), Stop All
  (rem), de LED-bytes uit `feedback.desired()` op het APC-profiel (er gaat niets naar buiten),
  de spiegel, en `apc.html` met de nieuwe knoppen. Poorten: `VARVE_KIJK_POORT` (standaard 8793)
  en `VARVE_KIJK_DEBUG` (9339).
- `vorm-maat.mjs` — dezelfde opzet (eigen server, geen MIDI), alleen `?vormen=1`: de maat
  als bron voor de vormlagen (`src/analysis/maat.js`). Twee demotracks met grid en klappen,
  meet op de audioklok klappen en tel van de maatgever, wisselt de maatgever met de
  crossfader midden in een klap (geen sprong omhoog), roept de haak in `laag.frame` zelf aan
  (de animatielus haalt headless maar een beeld per paar seconden) en leest de statustekst
  van het paneel. Poorten via `VARVE_KIJK_POORT` / `VARVE_KIJK_DEBUG` (standaard 8792/9338).
- `beamer.mjs` — het losse venster (de beamer, docs/BEAMER.md): mengt het zelf, en
  loopt het beeld door als het hoofdtabblad VERBORGEN is. Gebruikt de volledige Chrome
  for Testing met `--headless=new` (alleen daar wordt een tabblad echt verborgen) en
  WebGL op Metal (`VARVE_KIJK_GL=swiftshader` voor de CPU). Maakt met ffmpeg een
  testvideo (vier gekleurde kwarten + een schuivend wit blok), haalt die door de echte
  upload en ingest van een eigen server, en meet uit de plek van het blok hoe ver het
  beeld op het canvas van het geluid af zit. MIDI eruit vóór ELKE pagina (ook het
  losse venster). `VARVE_WORTEL=<map>` draait de beeldcontrole op andere (oude) code.
  Op een drukke machine: `VARVE_KIJK_POORT` en `VARVE_KIJK_DEBUG` zetten.
- `kijk-ingest.mjs [uitmap]` — de ingest-strook in het library-paneel, met de nep-yt-dlp
  uit `test/nep-ytdlp.mjs` (geen netwerk): vier regels plakken (één playlist), voortgang
  per stap, een wachtende en de lopende annuleren, "al in de library" met laadknoppen,
  een playlist die alleen yt-dlp herkent, en een herstart van de server midden in de rij
  (melding onderaan met het paneel dicht, "opnieuw" zet ze terug). Zelfde veiligheid als kijk.mjs (eigen server,
  geen MIDI); poorten via `VARVE_KIJK_POORT`/`VARVE_KIJK_DEBUG`. Foto's `ingest-*.png`.
- `vormen-plaat.mjs <uitmap> [--stappen 180] [--zaad 7] [--kwaliteit 1] [--alleen gs,ln]` — alle
  Vormmachines op één plaat (ROADMAP 7): elk systeem met vast zaad na een vast aantal stappen van
  1/60 s als `<id>.png` (640 × 360), plus `plaat.png` (contactblad) en `plaat.json`. Per systeem
  "16:9" of "vierkant" (tekent het rechts van het oude vierkant, x ≥ 1,05 H?), het zwaartepunt en
  het x-bereik van wat er te zien is (een vorm heel in het midden ≲ 0,56 breed, wie de breedte vult ~0,9+).
  Zelfde veiligheid als kijk.mjs (geen MIDI, eigen server, tijdelijke db; poorten uit
  `VARVE_KIJK_POORT`/`VARVE_KIJK_DEBUG`, standaard 8792/9338). De app start niet: een kaal document
  van de eigen server importeert `/src/vormen/`. Exit 1 als een systeem gooit.

## keylock/
Proef met Signalsmith Stretch 1.3.2 (keylock en toonsoort verschuiven) op Clay's eigen
nummers. Ontwerp en uitkomst: `docs/KEYLOCK.md`. Leest alleen `media/<id>/audio.wav` en
`media/library.db` (ook vanuit een worktree: de hoofdmap wordt via git gevonden;
`VARVE_MEDIA` wijst een andere map aan). Geen browser nodig.

```
node tools/keylock/proef.mjs haal       # één keer: npm pack naar tools/keylock/pakket/ (niet in git), sha512 gecontroleerd
node tools/keylock/proef.mjs alles      # info + controle + meet + luister (~3 min)
```
Los: `info` (bestanden, licentie, latentie per preset), `controle` (toonhoogte, hoorbare
positie, klankkleur op 1,00, springen, tempowissel), `meet` (CPU per deck, acht decks,
opwarmen), `acht` (alleen de acht decks, gevoelig voor belasting), `luister [nummer] [--van s] [--duur s]` (WAV's naar `tools/keylock/uit/`,
niet in git; met `LUISTER.md` als leeswijzer).

| bestand | wat |
|---|---|
| kern.mjs | de WASM-fabriek los van de schil van Signalsmith (wat in stream-lezer.js zou komen), `Kern` op de ruwe exports, `StretchSpeler` (een deck zoals optie A: segment {T,P,R}, latentie gecompenseerd, geplande sprong, opwarmen, loop uitgerold), en hun eigen AudioWorkletProcessor nagebootst (optie C) |
| proef.mjs | de opdrachten hierboven |
| LUISTER.md | wat er in de luisterbestanden zit en waar je op let (VRAGEN A3) |
| metingen-2026-09-24.txt | de uitkomst van `alles` op 24 september (M1, met wisselende belasting) |

## stems/
- `meet.py` — proef met Demucs (stems splitsen) op Clay's eigen nummers: rekentijd op de M1
  (GPU via MPS of CPU) en het energie-aandeel per stem. Leest `media/<id>/audio.wav`, schrijft
  fragment + vier stems naar `tools/stems/uit/` (niet in git). Draait in een eigen venv met
  `demucs` (geen dependency van de app). Uitkomst 24 sep: zie docs/plugins of HANDOFF.
  De splitter van de app zelf staat in `server/stems/splits.py` (docs/STEMS.md).
- `vergelijk.py` — een split nameten: som van de stems tegen audio.wav (dB), de stukgrenzen
  tegen een split zonder stukken, de grootste samplestap rond een grens, het energie-aandeel per
  stem. Draait met de Python van `~/.varve/stems-venv`.

## toonsoort/
Toonsoort (key) meten op Clay's library (docs/TOONSOORT.md). Leest alleen: `media/<id>/audio.wav`
via ffmpeg en `media/library.db` (readOnly); schrijft niets in media/ of de database. Werkt ook
vanuit een git-worktree (zoekt media/ in de hoofdmap), of zet `VARVE_ROOT`.

| bestand | wat |
|---|---|
| toon.mjs | het rekenwerk, puur: stemming, halve tonen, chroma, zes profielen, nul, kaart, stemming per stuk |
| lees.mjs | audio via ffmpeg (mono 4410 Hz), library alleen-lezen |
| varianten.mjs | welke chroma-varianten en profielen vergeleken worden |
| synth.mjs → synth.txt | synthetisch materiaal met een bekend antwoord: 24 toonsoorten, relatief mineur, 432 Hz, nul-proeven, modulatie, stemming per stuk |
| meet.mjs → meting.txt | alle nummers: per profiel, kaart, grenzen, zekerheid, rekentijd; `--wissel`, `--venster`, `--sr/--N/--hop` voor vergelijkingen (naar uit/) |
| bekend.json | bekende toonsoorten met bron (H bladmuziek, M Spotify-algoritme, X tegenspraak, C eigen chroma) en nummergrenzen |
| fragmenten.mjs → fragmenten.txt | de SERVER (`server/toon.js`, zoals de worker hem draait) op fragmenten van hooguit 2 minuten per nummer (`ffmpeg -ss/-t`), naast de kaart in meting.txt. 25 sep: 11/11 gelijk |

Draai met `node tools/toonsoort/meet.mjs [id ...]` en `node tools/toonsoort/synth.mjs`. Uitkomst
24 sep: zie docs/TOONSOORT.md. `uit/` staat niet in git. `server/toon.js` is een kopie van de
gekozen keten uit toon.mjs; `test/toon.test.mjs` controleert dat ze getal voor getal gelijk rekenen
(pas je toon.mjs aan voor een proef, laat dan `kaartPerStuk`, `spectrum` en `nietStil` staan of pas de test aan).
