# Spoor D: de server mag even weg zijn (15 okt 2026)

Tak `arch/server-weg` (vanaf `origin/studio/architectuur`), docs/WINST.md punt 3, met K2 uit
`docs/verslagen/2026-10-14/winst/hoek-live-betrouwbaarheid.md`. Geen PR.

## Wat er gebouwd is

### D1. De opname laat niets meer vallen
- `src/lib/herhaal.js` (nieuw, puur): één regel voor alles wat de browser stuk voor stuk op zijn PLEK
  schrijft. Geen antwoord (geen verbinding, time-out van 10 s, of een 5xx van een proxy zoals
  `tailscale serve`) = de server is weg: opnieuw, met een pauze die oploopt 0,25 → 0,5 → 1 → 2 s (en daar
  blijft), zolang de aanroeper `mag()` zegt. Een "nee" (4xx) hooguit drie keer, zoals vroeger. Een volle
  schijf (`vol`) meteen opgeven.
- `src/opname/opnemer.js`: audiostukken wachten op volgorde zolang de opname loopt. De rij is begrensd op
  `RIJ_SECONDEN` = 300 s (~57 MB); wordt hij langer, dan valt het OUDSTE stuk weg (gat = stilte op zijn plek,
  gemeld), zodat wat de server straks krijgt het meest recente is. Bij stoppen krijgt de rij nog
  `STOP_GRENS` = 10 s, daarna de oude regel; liep de laatste poging op een time-out (de server HANGT), dan
  worden de overige stukken na de grens niet meer geprobeerd (anders 300 × 10 s). De `klaar`-POST krijgt nog
  5 s na de grens. Videostukken: hetzelfde patroon, met `?van=<byte>`.
- `server/opname.js` + route in `server/index.js`: `voegVideoToe(…, van)` schrijft op die plek (`r+`, de
  eerste keer `wx`), zodat herhalen veilig is; zonder `van` erachter zoals vroeger (oude clients). Een
  ongeldige `van` wordt geweigerd, `ENOSPC` geeft nu ook bij video `vol: true`.
- `src/control/handelingen.js`: hetzelfde voor het handelingenlog (rij 16 MB tekst, `RIJ_BYTES`; stopgrens
  10 s). `noodstop()` (pagehide) is ongewijzigd: één keer, keepalive.
- Elke fetch leest nog steeds zijn antwoord (`leesWeg`), ook na een herhaling.

### D2. Eén melding die meegroeit
- `Opnemer.stand()` + `onStand`: `{ storing, wacht, verloren, fout }` zolang de server niet antwoordt,
  daarna `{ storing: false, goed, verloren }`. `meldingVan(stand)` (puur, in opnemer.js zodat de test hem kan
  lezen) maakt er de tekst van:
  "opname: server antwoordt niet, 14 s in de wacht" (fout) → "opname: weer goed, niets verloren" (info, gaat
  vanzelf weg), of "… weer goed, 3 s verloren (stilte op die plek)", of na de grens bij stop
  "opname: server antwoordde niet, 3 s verloren (stilte op die plek)".
- `src/ui/opname-knop.js`: alles van de opname onder de sleutel `opname` (ook de meldingen bij start en
  stop), dus er staat er altijd hooguit één. `onFout` tijdens een storing meldt niet apart (de storing zegt
  het al). `src/ui/logboek.js`: het log onder de sleutel `handelingenlog`.

### D3. Een herstartlus voor de server
- Hoe Clay nu stopt: `pkill -f server/index.js` (docs/TAILSCALE.md stap 4, HANDOFF), Ctrl-C als hij hem in
  een terminal start; de LaunchAgent (TAILSCALE.md) is optioneel en heeft `KeepAlive`.
- `tools/varve-app/server-lus.sh` (POSIX sh, 140 regels): start `node server/index.js` en opnieuw na een
  niet-nul exitcode, 1 s pauze, hooguit 5 herstarts per 60 s (daarna stoppen met de reden in het log).
  Niet opnieuw bij exitcode 0, bij 129/130/143 (SIGHUP/INT/TERM: `pkill` werkt dus zoals altijd en stopt de
  lus mee) en bij 3. Vóór elke start: luistert er al iets op de poort (lsof, anders nc, anders curl), dan
  start hij niets en stopt hij (exit 3): nooit twee servers, ook niet met de LaunchAgent ernaast.
  Pidbestand `~/.varve/server-lus.pid`; `stop` stopt lus en server en wacht tot ze weg zijn; `status`.
  Een tweede lus doet niets ("draait al"); een oud pidbestand van een dood proces houdt niets tegen. Het
  hele programma staat in één functie, zodat bash (macOS `/bin/sh`) het helemaal inleest: een `git pull`
  die het script verandert breekt de lopende lus niet.
- `server/index.js`: `server.on('error')` met `EADDRINUSE` = melden en `process.exit(3)`. Vroeger ving
  `uncaughtException` dat op en liep een tweede server zonder poort door, met nacht, heranalyse en backups
  op dezelfde library.
- `tools/varve-app/VARVE.applescript` start `nohup sh tools/varve-app/server-lus.sh &` (UV_THREADPOOL_SIZE en
  VARVE_MEDIA gaan via de omgeving mee). Uitleg over stoppen bovenaan het script, in `tools/README.md` en in
  `docs/TAILSCALE.md` (LaunchAgent NIET weggehaald; erbij: niet samen met de lus, en hoe je hem uitzet).
- **VARVE.app moet opnieuw gebouwd worden** (`zsh tools/varve-app/maak.sh`) om de lus te gebruiken.

### D4. Langer vooruit voor wat je hoort
- `src/engine/stream-kern.js`: `VOORUIT` = 20, `VOORUIT_HOORBAAR` = 60; `plan()` gebruikt `VOORUIT` als
  standaard.
- `src/engine/engine.js`: `_volgVooruit()` bij elke 'change' van een deck of de mixer (in `volgMaat`):
  geladen, `playing` (ook wachtend op de maat) en fader × crossfader boven −60 dB (`HOORBAAR_MIN`; een dichte
  fader is −70 dB, een crossfader aan de overkant ~1e-17, dus "> 0" telde alles als hoorbaar) = 60 s.
- `src/engine/deck.js`: `zetVooruit(s)` en `get vooruit`; geeft het getal aan de bron, ook aan een volgende
  bron (`_zetBron`). `src/engine/bron.js`: alleen `bijvullen()` leest `this.vooruit`. Niets aan
  `vernietig()` of het maken van de node.

### D5. De proef
- `tools/headless/server-weg.mjs` (poorten 8961/8962): eigen server met `VARVE_TESTSERVER=1` en alle
  `VARVE_*`-mappen in tmp, twee nummers van 3 min via de upload-route, beide decks streamend en hoorbaar,
  opname en handelingenlog aan, SIGKILL, 30 s weg, opnieuw starten met dezelfde mappen, 14 s door, stop.

## Metingen

**server-weg.mjs, deze tak** (headless Chromium 1194, Linux-container):

| | |
|---|---|
| vooruit vóór de kill | A en B 60 s, 60,1 s binnen; 12,8 MB per deck |
| tijdens 30 s weg | de buffer liep af tot 30 s vooruit, stil 0 |
| server antwoordt na herstart | 1,8 s (start van node tot `/api/proef`) |
| stille vensters van 50 ms | **0 van 1040** |
| WAV | 49,12 s, de opnemer telde 49 s; langste reeks nullen 0 ms |
| handelingenlog | 12 599 bytes, geen NUL, eind-regel |
| opname-meldingen | **1** (16 tussenstanden "N s in de wacht" in hetzelfde element), eindigde op "weer goed, niets verloren" |

**Dezelfde proef op `origin/studio/architectuur`** (`VARVE_CODE=<kopie>`): 200 stille vensters (langste
10 000 ms, de buffer van 20 s was na ~21 s op), 2 reeksen nullen in de WAV (langste 20 000 ms), 20
opname-meldingen (hooguit 4 tegelijk). Na de herstart weer 19–20 s vooruit.

**De lus met de echte server** (testserver op 8963, `nohup sh server-lus.sh`): drie keer SIGKILL, de server
antwoordde weer na 3,3 / 3,6 / 2,7 s (1 s pauze + ~2 s opstarten in deze drukke container; WINST.md mat
0,8–1,0 s op de Mac). `stop` liet lus en server netjes gaan (exitcode 143, poort vrij).

**Geheugen** (stream.test): vooruit 60 kost 7,9 MB extra per hoorbare stereotrack, ×2 of ×4 met stems.

## Tests

- `test/opnemer.test.mjs`: nep-klok (`wacht` schuift hem op, `nu` leest hem). Nieuw: server 30 s weg (39 s
  wachten, daarna 41 s WAV, elk stuk op zijn plek, pogingen lopen op, één storing met 18 standen, eindigt op
  "weer goed"), 502 van een proxy, rij vol (de oudste 5 s weg, op hun plek), schijf vol (één poging, geen
  storing), stop met de server weg (grens 10 s + 5 s klaar), server hangt (na de grens niets meer
  geprobeerd), videostuk herhaald op `?van=` (niet dubbel), `van` op de server, de teksten van `meldingVan`,
  en dat elke `meld(` in opname-knop.js de sleutel draagt. De oude checks staan er nog; 1b en 2 (een stuk
  dat altijd faalt) gaan nu via de stopgrens, met hetzelfde resultaat.
- `test/handelingenlog.test.mjs`: nep-klok; "drie keer weg" heet nu "na de grens bij stoppen" en eist
  daarnaast dat het stuk tijdens het log bleef wachten. Nieuw: server 30 s weg (geen gat, geen dubbel), rij
  vol, schijf vol, stop met de server weg.
- `test/opname.test.mjs`: video met `van` (op zijn plek, herhaling, gat = nullen, ongeldig).
- `test/server-lus.test.mjs` (nieuw, `@alleen`: vaste poorten 8964/8965): nep-`node` op PATH die op
  bestelling omvalt. Herstart, grens 5/min (6 starts, exit 1), exit 0, SIGTERM (pkill), exit 3, poort bezet,
  tweede lus, oud pidbestand, stoppen via het pidbestand, `sh -n`. Ook met bash als `sh` gedraaid (macOS).
- `test/draadpool.test.mjs`: UV_THREADPOOL_SIZE staat nu vóór de lus, en de lus laat hem staan.
- `test/stream.test.mjs`: plan met vooruit 60 (tot ~160 s, achteruit blijft 5 s, 7,9 MB extra, op 1,5×) en
  een StreamBron met `vooruit = 60` en terug naar 20.
- `test/engine.test.mjs`: `_volgVooruit` (stil, spelen, fader dicht, crossfader weg, thru, pauze).
- `test/renderblok.test.mjs`: gouden hash en 0 GC ongewijzigd; rood alleen op "keylock met wissels" (83,7 bytes
  per bericht), de bekende omgevingsfout van deze container.

Volle suite (`node test/alles.mjs --banen 2`), slotregel:
`134 bestanden, 11509 checks, 10 overgeslagen — 3 ROOD · 2 tegelijk, 656 s (pool 475 s + alleen 181 s)`.
Rood, alle drie de bekende omgevingsfouten van deze container: `backup-kopie` ("één regel" en "controleer:
exit 0", allebei door de Node 22-waarschuwing; dezelfde twee op een kopie van `origin/studio/architectuur`),
`wachtrij` ("yt-dlp en zijn kind", 2×), `renderblok` ("keylock met wissels", 74,4 bytes per bericht).

## Wat niet, en waarom

- **Hang-detectie** (hartslag + kill, K2 (1) tweede helft): WINST.md zegt "pas als er ooit een hang in
  server.log opduikt". De lus ziet alleen een proces dat stopt. Wel: een verzoek dat 10 s niets zegt telt in
  de opnemer als "weg".
- **De noodlus op de maat** (vakgebied kans 2, emergency loop): volgende versie.
- **Hysterese op 60 → 20 s**: een track die even niet hoorbaar is (fader dicht) laat zijn extra 40 s meteen
  los en haalt ze terug als hij weer open gaat (~8 MB, drie verzoeken). Op localhost onschuldig; niet
  gebouwd (niet gevraagd).
- **Stems**: een hoorbare track met vier stems houdt 60 s × 8 kanalen = ~46 MB; niet apart begrensd.
- De lus is niet op de Mac zelf gedraaid (geen Mac hier), wel met bash in POSIX-modus als `sh`.
- De **Controlekamer** ziet de lus niet (een herstart staat alleen in `~/.varve-server.log`).

## Voor CLAUDE.md (niet door mij gewijzigd)

- DE SERVER MAG EVEN WEG ZIJN (15 okt, docs/WINST.md punt 3, `src/lib/herhaal.js`): opname, video en
  handelingenlog herhalen een stuk zonder antwoord (geen verbinding, time-out 10 s, 5xx) met 0,25 → 2 s
  zolang ze lopen; de rij is begrensd (opname 300 s ≈ 57 MB, log 16 MB) en daarboven valt het OUDSTE stuk
  weg (gat op zijn plek). Een 4xx hooguit drie keer, `vol` nooit opnieuw. Bij stop nog 10 s, dan de oude
  regel. Videostukken dragen `?van=<byte>` (de server schrijft op die plek). De opname geeft ÉÉN melding
  (sleutel `opname`, `meldingVan`); een nieuwe melding van de opname: ook met die sleutel (opnemer.test
  telt het). Tests met een nep-klok: `wacht` schuift `nu` op (anders draait een herhaallus als microtaken
  eeuwig door).
- VOORUIT (15 okt): een track die je HOORT (geladen, speelt, fader × crossfader > −60 dB) houdt 60 s
  pagina's vooruit (`VOORUIT_HOORBAAR`), de rest 20 s; de engine beslist (`_volgVooruit`), het deck geeft het
  getal door (`zetVooruit`), alleen `bijvullen` leest het. "~4-6 MB per track" (Bekende grenzen) wordt dan
  ~12,8 MB voor een hoorbare stereotrack.
- HERSTARTLUS (15 okt, `tools/varve-app/server-lus.sh`): VARVE.app start de server via de lus; hooguit 5
  herstarts per minuut, niet na 0, SIGTERM/INT/HUP of 3 (poort bezet; de server stopt daar nu zelf mee).
  Stoppen: `sh tools/varve-app/server-lus.sh stop` of `pkill -f server/index.js`. Nooit samen met de
  LaunchAgent. De lus is POSIX sh en staat in één functie (een `git pull` breekt hem niet).
- In de structuurlijst: `src/lib/herhaal.js`, `tools/varve-app/server-lus.sh`, `tools/headless/server-weg.mjs`,
  `test/server-lus.test.mjs`.

## Voor HANDOFF.md

- Na de merge: **VARVE.app opnieuw bouwen** (`zsh tools/varve-app/maak.sh`), anders start hij de server nog
  zonder lus. Had Clay de LaunchAgent geladen: eerst `launchctl unload ~/Library/LaunchAgents/nl.varve.server.plist`.
- Niet getest op de Mac: de lus onder macOS `/bin/sh` met `lsof` als gewone gebruiker, en de proef met de
  echte APC en een echte opname van een uur.

## Open vragen voor Clay (VRAGEN.md)

1. Moet de Controlekamer een herstart van de server laten zien ("server herstart om 22:14, 1 keer")? Nu staat
   het alleen in `~/.varve-server.log`.
2. Rij vol na 5 min: nu valt het OUDSTE stuk weg (je houdt de laatste 5 min van de uitval). Liever de eerste
   5 min houden?
3. De LaunchAgent uit TAILSCALE.md: weg (de lus doet het werk), of houden voor "Mac bereikbaar zonder mij"?
4. Hysterese voor het vooruit halen (pas na ~30 s niet-hoorbaar terug naar 20 s): de moeite waard?
