# Ingest-rest (vervolg van de onderbroken agent) — zombie, livestream, herstart

25 sep 2026. Branch **`spoor3/ingest-rest-2`** (vanaf `spoor3/ingest-rest`, `2942bdb`),
worktree `agent-a127eeb056c4dc554`. Niet gemerged, niet gepusht. Laatste stap: `git switch --detach`.

## Commits

| commit | wat |
|---|---|
| `4d4efd1` (voorganger) | Geannuleerde analyse liet een zombie-ffmpeg achter: de worker ruimt eerst zelf op |
| `1dd5c9e` (voorganger) | Zombie-test telt alleen wat blijft; 'error' met een pid is geen "weg" |
| `2942bdb` (voorganger) | Ingest: een lopende of aangekondigde livestream meteen weigeren |
| `2dded93` (dit spoor) | Na een serverherstart: de strook meldt wat uit de wachtrij viel en zet het met één klik terug |

**Na mergen: server op :8777 herstarten** (index.js: `server` in GET /api/ingest, `opnieuw` op de
opdracht). Geen schema, geen dependency. Clay's pagina daarna verversen (nieuwe strook).

---

## Overname

De oude worktree (`agent-a2944640571c1039d`) stond op `spoor3/ingest-rest` (= `2942bdb`) met vier
ongecommitte bestanden: `server/index.js`, `src/ui/ingest-strook.js`, `styles.css`,
`test/wachtrij.test.mjs`; geen untracked bestanden. `git -C <andere worktree>` weigert de
isolatie hier, dus de patch is gemaakt met `diff -u` tussen de twee worktrees (zelfde commit),
`scratchpad/voorganger.patch`, en hier met `git apply` toegepast. Aan de oude worktree is niets veranderd.

Bijvangst: in deze worktree stonden na het wisselen van branch vijf ongevraagde kopieën
(`server/index 2.js`, `server/wachtrij 2.js`, `src/ui/ingest-strook 2.js`, `src/ui/laden 2.js`,
`styles 2.css`), allemaal byte-gelijk aan een git-versie (HEAD, resp. cc527e3 voor styles) —
vermoedelijk iCloud-conflictkopieën (de repo staat op het Bureaublad). Weggehaald, niet gecommit.
Let erop in andere worktrees: `git status` toont ze als untracked.

## Punt 1 — zombie-ffmpeg (was al gecommit, nagekeken)

`4d4efd1` + `1dd5c9e`: elke analyse-ffmpeg gaat via `startFfmpeg()`; bij annuleren krijgt de worker
`'stop'`, killt zijn eigen ffmpeg's, wacht op hun `exit` (waitpid in de goede thread) en stopt dan
zelf; `terminate()` blijft als noodrem na 2 s. Zonder signal (tap-verfijning, achtergrond-heranalyse,
onsets) verandert er niets: de worker haalt na zijn antwoord zijn luisteraar weg en stopt vanzelf.
Tests in wachtrij.test groen: 5× annuleren in golfvorm/ritme → 0 zombies (oude code: 6), grid
annuleren, annuleren tijdens rekenen (noodrem 2 s), zonder signal grid/verfijning/onsets, worker
stopt vanzelf.

Voor het mergen in integratie-r2: de toonsoort daar leest via `leesPcm()` (analyze.js), dus na
het samenvoegen gaat ook zijn ffmpeg via `startFfmpeg()`; `maakToon(…, { signal })` loopt via
`inWerker` en krijgt dus hetzelfde stop-pad. Controleer na de merge dat er in analyze.js geen
losse `spawn('ffmpeg'` meer staat (nu: alleen in startFfmpeg).

## Punt 2 — livestreams weigeren (was al gecommit, nagekeken)

`2942bdb`: `metadata()` weigert `live_status` `is_live`/`is_upcoming` (en `is_live: true` zonder
live_status) met reden en titel, vóór er iets gedownload wordt; `was_live`/`post_live` mag.
wachtrij.test en wachtrij-server.test groen (de drie soorten geweigerd zonder download, de link
erachter loopt meteen).

## Punt 3 — na een serverherstart niet stil verdwijnen (dit spoor)

Wat de voorganger had (en behouden is): de server geeft een `server`-id per run
(`randomUUID()`) mee in GET /api/ingest; de strook ziet een ANDERE id, zet een rij "herstart"
bovenaan met "opnieuw" en ×, en meldt het in de statusregel. Links weet de browser nog (url van de
opdracht); een upload alleen als deze pagina hem uploadde (de strook houdt de `File` vast tot hij af
is), anders "opnieuw slepen: <naam>". "opnieuw" zet de links in één POST terug (per 100) en uploadt
de bewaarde bestanden opnieuw, naar dezelfde track als ze op een track gesleept waren. Mislukt de
POST (server nog weg), dan blijft de rij staan.

Wat ik veranderde / afmaakte:
1. **Volgorde omgedraaid** (gevonden door de headless): de lijst van de server staat op nieuwste
   eerst, dus terugzetten draaide de rij om (b liep, a wachtte). Nu gesorteerd op de rij: wat liep
   eerst, dan op plek. De unit-test gaf de lijst in rij-volgorde en zag het niet; nu nieuwste eerst,
   zoals `lijst()`.
2. **De test van de voorganger faalde (4 checks)**: de nep-server gaf direct na de upload een lege
   lijst, waarop de strook het bestand terecht vergat. Test realistisch gemaakt (de upload staat in
   de lijst).
3. **Een upload die terugkwam NA de laatste poll** (de server viel om vóór de volgende) stond niet in
   de vorige lijst en viel stil weg. Nu telt alles in `bestanden` dat de nieuwe server niet kent mee.
4. **Laat antwoord van de oude server**: een poll die vóór de herstart vertrok en ná het eerste
   antwoord van de nieuwe terugkomt, leek een tweede herstart (terug naar de oude). Oude runs worden
   onthouden en zo'n antwoord wordt overgeslagen.
5. **"toch opnieuw"-links**: een link die met `{ opnieuw: true }` in de rij stond (bewust opnieuw
   binnenhalen) kwam na "opnieuw" terug als "staat al in de library". De opdracht draagt nu
   `opnieuw: true` (server), en de strook stuurt die apart met `opnieuw: true`.
6. **Paneel dicht**: downloads lopen meestal met het library-paneel dicht, en dan zie je de strook
   niet. Dan ook onderaan een foutmelding (blijft staan tot je hem wegklikt): "de server is herstart:
   2 opdrachten uit de wachtrij zijn weg — open de library (B) en klik "opnieuw" …". Kies je in de
   strook ("opnieuw" of ×), dan gaat die melding vanzelf weg. Aangesloten in laden.js
   (`library.strook.meldBuiten = …`, één regel na de constructor, om niet te botsen met de
   LibraryPanel-constructor die in integratie-r2 veranderd is).

Bestanden: `server/index.js` (SERVER_RUN, `opdracht.opnieuw`), `server/wachtrij.js` (alleen de
doc-regel), `src/ui/ingest-strook.js`, `src/ui/laden.js` (1 regel), `styles.css` (1 regel),
`test/wachtrij.test.mjs`, `test/wachtrij-server.test.mjs`, `tools/headless/kijk-ingest.mjs`,
`tools/README.md`.

## Tests

- `wachtrij.test.mjs` (nice -n 10): 99 ok, groen. Nieuw in het strookdeel (23 checks): bestand
  onthouden, zelfde server = geen herstart, late upload, andere server gemeld (paneel + onderaan),
  rij met "opnieuw" en "opnieuw slepen", volgorde van de rij, laat antwoord van de oude server
  genegeerd, niet dubbel melden, POST mislukt = niets kwijt, links terug + "toch opnieuw" apart,
  melding onderaan weg, bestanden opnieuw geüpload naar dezelfde track, paneel open = niet onderaan,
  ×, verse pagina = niets.
  **Tegenproef**: zonder sortering, zonder oude-runs-rem en zonder de late upload: 9 van die checks FAIL.
- `wachtrij-server.test.mjs`: groen. Nieuw: `server` in GET (vast binnen één run); `opnieuw: true`
  op de opdracht (niet op een gewone); ECHTE herstart (zelfde poort, db, media): andere run, rij
  leeg, werkmap van de onderbroken download opgeruimd, dezelfde link opnieuw → 202 en klaar. De
  wees-yt-dlp van de oude server wordt in `finally` gekild.
- Headless `kijk-ingest.mjs` (8923/9523): nieuw deel "server herstart" (10 checks): twee trage
  links, paneel dicht, server kill + start, melding onderaan, paneel open → rij "herstart", klik
  "opnieuw" met de MUIS (CDP), beide terug in de goede volgorde, "2 in de wachtrij", melding onderaan
  weg, annuleren, geen fouten in de pagina. Foto's: `scratchpad/bouw/rest-ingest-foto/ingest-herstart*.png`.
  Eén volledige run helemaal groen (34/34, load 156). Twee andere runs (load 130–170) faalden op het
  BESTAANDE muis-annuleren-deel ("× op de lopende … vraagt eerst een tweede klik" + "tweede klik"):
  de trage nep-download (25 × 1,2 s) was al klaar voordat de check keek ("1 nummer in de library").
  Timing onder zware belasting, niet door dit werk; mijn deel was in alle drie de runs groen.
- Hele suite (`nice -n 10 node test/alles.mjs`, load 40–150 door andere sporen): **31 bestanden,
  2069 checks, alles groen** (ook de vormen-tijdchecks). regels.test los ook groen.

## Niet getest

- In Clay's eigen Chrome (alleen headless); een echte herstart van :8777 niet aangeraakt.
- Een upload die LOOPT (XHR onderweg) als de server wegvalt: die krijgt zoals voorheen "upload
  afgebroken — … of de server is weg" en staat niet in de herstartrij (het bestand is niet bewaard).
  Niet gebouwd: zou `bestanden` ook voor lopende uploads vragen.
- Het tabblad herladen tijdens de herstart: dan weet de browser niets meer (bewust: de rij staat
  alleen in het geheugen van server en pagina).
- Een `File` van een gesleept bestand opnieuw uploaden na lange tijd: Chrome houdt de handle geldig
  zolang het bestand niet verplaatst of gewijzigd is (niet gemeten).
- Echte YouTube/TikTok (geen netwerk).

## Voorstel CLAUDE.md-tekst (bij het INGEST-WACHTRIJ-blok)

```
  Na een HERSTART van de server is de rij weg (geheugen). GET /api/ingest geeft
  `server` (een id per run); ziet de strook een andere, dan zet hij bovenaan
  "de server is herstart: N opdrachten … weg" met "opnieuw" (links in de volgorde
  van de rij terug, "toch opnieuw" apart met opnieuw: true; uploads alleen als
  DEZE pagina ze uploadde — hij houdt de File vast tot de opdracht af is) en ×.
  Paneel dicht: ook onderaan (fout, blijft), weg zodra je in de strook kiest.
  Een laat antwoord van een oude run telt niet.
```
