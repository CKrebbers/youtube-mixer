# De proefpunten van de architectuurronde, diep (16 okt)

Opdracht: de ar-punten van de speellijst niet afleiden uit de samenvattingen (HANDOFF, VRAGEN), maar uit de diff
zelf. Elk punt krijgt een uitkomst die je kunt meten en die vooraf vastligt, en een weg terug. Achteraf rekent een
script uit Clay's eigen bestanden na wat het punt beweert. Elke procedure is eerst hier doorgelopen.

**Bereik.** De architectuurronde is PR #45: `git diff 509de15^1 509de15` (38 commits, 65 bestanden in `src/`,
`server/`, `tools/`). De opdracht noemde `367dbb3a..509de15`, maar dat bereik bevat ook PR #43 (backup en de
instrument-sleutels). Die hebben hun eigen proef (docs/BACKUP.md §7) en staan hier niet in.

Wat er nu is:
- de herschreven ar-blokken in `src/controle/speellijst.js`: 16 punten, waarvan 14 met hun oude id en 2 nieuwe
  (ar-hang, ar-ok); geen id veranderd of weg;
- `citeert` per punt, met een check in `test/controle.test.mjs`;
- `tools/proef/ar-na.mjs` en `test/ar-na.test.mjs`;
- in `tools/headless/server-weg.mjs` drie toevoegingen: `VARVE_WEG_SOORT=hang`, `VARVE_WEG_KOPIE`, en een teller
  van álle meldingen;
- VRAGEN AR17–AR20.

## 1. De herleiding: verandering → risico → toets → proefpunt

"Getoetst" zegt wat er al bestond: test (node), headless (Chromium in de container), of niets. Een proefpunt
bestaat alleen waar alleen Clay's Mac, de APC, de Scarlett of de pc het kan laten zien.

| # | gedrag (bestand) | risico op een avond | al getoetst | proefpunt, of waarom niet |
|---|---|---|---|---|
| A1 | een worklet krijgt `'stop'` en geeft `false` uit `process()` (fx, fx-meer, fx-s10, drums, fm, schaal, klankschaal, limiter, opnemer) | het geheugen groeit over een lange avond van wisselen, tot Chrome trager wordt of omvalt | effecten/master/klankschaal/instrumenten-tests (de mock telt `'stop'`), `lek.mjs PROEF=wissel` | **ar-wissel**: de Geheugenvoetafdruk in Chrome's Taakbeheer, ≤ +20 MB. Headless 16 okt: privé −5 MB na 20 wissels (RSS +41 MB: gedeelde code, geen lek) |
| A2 | `onprocessorerror` + `meldWorkletFout`: de StreamBron bouwt één keer opnieuw op, de limiter valt terug op de compressor, de klankschaal en schaal bouwen bij de volgende noot opnieuw | stilte zonder melding | engine.test, `gezondheid.mjs` §3 (een echte fout in de stream-lezer: opnieuw opgebouwd, op dezelfde plek, de tweede keer stil met melding) | **bewust geen**: op de hardware niet op te wekken zonder de code te veranderen; de headless proef gooit echt in `process()` |
| A3 | `src/ui/gezondheid.js`: niet `running` = melding "audio staat stil (…)", de eerste druk (controller, hub, toets) doet `resume()`; klok > 0,5 s achter, twee keer = "audio-uitgang staat stil" | het geluid valt weg (slaap, een andere uitgang) en niemand ziet waarom, of een druk op de APC helpt niet | gezondheid.test (puur), `gezondheid.mjs` §1 (`ctx.suspend()` + nep-APC: melding, resume, "audio loopt weer"; geen vals alarm in 3,5 s) | **ar-slaap**, **ar-scarlett**: de echte oorzaken (slaap van macOS, een USB-uitgang die wegvalt) bestaan alleen op de Mac; headless wordt de suspend met de hand gezet |
| A4 | golfvorm-sleutel op `gridVersie`, `StreamBron.buffer` één object per bestand | een gridbewerking die de lijnen niet meer tekent (de sleutel zou te weinig zien) | engine.test "gridVersie volgt elke gridwijziging", grid-bediening.test, `beeld-afval.mjs` | **in ar-snap**: springen de lijnen in de zoom meteen mee na tel 1 hier? (regressie van de sleutel, zichtbaar met de muis) |
| A5 | meldingen met een sleutel (`meld(…, { sleutel })`, `wisMelding`) | één melding die blijft hangen of verdwijnt terwijl het nog mis is | meldingen.test | in **ar-weg/ar-hang/ar-slaap** (de opname- en de audio-melding zijn sleutelmeldingen) |
| B1 | `snapNaarTel`: tel 1 hier, tellen hier, vast en de klik in de golfvorm snappen eerst naar de tel van Beat This! (30 ms), dan de klap; `klappenEnTellen` voor de pin | de "1" valt een paar ms naast de kick (de klappen hebben een vaste ijking): flanging in een lange blend | beatgrid.test, `synth/snap.mjs` (nep-tellen: −8,9 → −0,2 ms) | **ar-snap**, **ar-tellen**, nagemeten met **ar-ok** (ar-na: het bewaarde grid tegen de echte tellen, mediaan ≤ 5 ms) |
| B2 | `maatMening`: de lage band (`laagEnvelope`, laag.bin) geeft `twijfel: 'maat'` bij een verdachte "1"; alleen bij nieuwe tellen of ↻ (kaart-VERSIE niet verhoogd) | vals alarm (een goede "1" oranje) of een foute "1" zonder alarm | beatbench.test (0 van 168 onterecht), tellen-server.test | **ar-een** (een nieuw nummer: de tellen en de lage band komen na de ingest; de serverregel "[tellen] … lage band uitgerekend"), **ar-vloer** (de bekende grens, AR4) |
| B3 | `bench.mjs --beatthis`, `tel1-echt.mjs`, LEESMIJ | het echte model en Clay's fragmenten zijn nooit gemeten | niet (het checkpoint was in de cloud niet te halen) | **ar-meet** (AR2): alleen op de Mac |
| C1 | het avondpakket per platform (`metersVoor`, `ONBEKENDE_OPTIE`, Linux-sondes) | vals rood of vals groen op de pc | avondpakket(-meet/-server).test met fixtures, waarvan de Linux-USB- en accu-fixtures HANDGEMAAKT | **ar-pakket**: de echte uitvoer van de pc (ook ruw: `lsusb`, power_supply), zodat de fixtures echt worden. De droogloop vond twee dingen (B3 hieronder) |
| C2 | `.node-version` + de waarschuwing van alles.mjs (`VERSIEGEVOELIG`) | rood op de pc dat van de V8 komt en voor echt wordt gehouden (of andersom) | node-versie.test | **ar-node** (AR14) |
| C3 | uitzenden: videotoolbox alleen als hij echt codeert, anders libx264 | n.v.t. op een avond: uitzenden heeft nog geen route of knop | uitzend.test (Mac-run 3 op een VM: videotoolbox staat er, codeert niet → libx264) | **bewust geen**: er is niets om op de avond aan te raken; de echte M1 met videotoolbox wacht op de knop (docs/UITZENDEN.md) |
| C4 | beeld-lokaal (Mac-meters achter `isMac()`), wachtrij (zombie), backup-kopie (NODE_NO_WARNINGS) | alleen gereedschap en tests | hun eigen tests | geen |
| D1 | opname, video (`?van=`) en log herhalen een stuk zonder antwoord (0,25 → 2 s, time-out 10 s); rij begrensd; één opname-melding die meegroeit | een gat in de opname, of twintig rode meldingen midden in een set | opnemer.test, handelingenlog.test, opname.test (`?van=`), `server-weg.mjs` (SIGKILL; sinds 16 okt ook een hang) | **ar-weg**, **ar-val**, **ar-hang**, nagemeten met **ar-wav** (ar-na: nullen in de storing, het log). Video: ar-weg neemt op MET beeld, want alleen dan loopt `?van=` (de headless proef neemt alleen audio op) |
| D2 | 60 s vooruit voor wat je hoort (`VOORUIT_HOORBAAR`, `_volgVooruit`) | stilte als de server weg is | stream.test, `server-weg.mjs` (60,1 s binnen, 0 stille vensters) | in **ar-weg/ar-hang** (30 s < 60 s). Bewust NIET langer dan 60 s op de avond: dat is per ontwerp stil |
| D3 | `tools/varve-app/server-lus.sh`: herstart na omvallen (≤ 5/min), niet na 0, SIGTERM/INT/HUP of 3; `stop`/`status` | de server valt om en blijft weg; of twee starters op één poort | server-lus.test (nep-node, Linux `sh`), droogloop 16 okt met de echte server (zie §3) | **ar-app** (de lus moet er eerst zijn), **ar-val**; de lus onder macOS `/bin/sh` is nooit gedraaid |
| D4 | de server stopt met exit 3 als de poort bezet is | een tweede server die half doordraait | server-lus.test (de lus leest 3); de exit 3 van de echte server alleen in de droogloop | **bewust geen proefpunt**: een tweede server ruimt bij het opstarten eerst de werkmappen van de eerste op (AR20); niet uitlokken |
| D5 | VARVE.applescript start de lus in plaats van de server | VARVE.app van vóór de merge start nog zonder lus | niet (macOS) | **ar-app** |
| E1 | helpers op één plek (notatie, wie, WORKLET_FADE), effecttests op id, aanhaakpunten-test, PaneelRelais stringify | geen gedrag (zelfde uitvoer) | notatie.test, aanhaakpunten.test, de bestaande tests | geen |

**Niet getest** (HANDOFF) naast de punten:
- de echte Mac van Clay: alles hierboven;
- de echte APC: ar-slaap (de lampjes na het wakker worden), ar-snap;
- een echte opname van een uur met de server weg: ar-server is ~5 min, niet een uur (zie §5);
- de lus onder macOS `/bin/sh`: ar-app en ar-val;
- de Linux-fixtures: ar-pakket.

**Uit VRAGEN AR.** Op een punt horen:
- AR1–AR4 (ar-meet, ar-een, ar-vloer);
- AR6 (ar-slaap);
- AR8 (ar-app);
- AR9 (ar-val);
- AR12–AR14 (ar-pakket, ar-node);
- nieuw: AR17 (ar-weg), AR18 (ar-hang) en AR19 (ar-pakket).

Bewust niet, want het zijn keuzes zonder iets om te proberen:
- AR5, AR7, AR10, AR11, AR15, AR16;
- AR20 (niet uitlokken).

## 2. Het storingsmodel

Wat er op een echte avond misgaat, hoe je het opwekt, wat de code belooft (letterlijk, uit de bron), wat de
droogloop zag, en de weg terug.

| storing | opwekken | belofte (code) | droogloop 16 okt | weg terug |
|---|---|---|---|---|
| server gestopt (bewust, of de Mac sluit hem) | `sh tools/varve-app/server-lus.sh stop` | geluid loopt door (60 s vooruit); één melding "opname: server antwoordt niet, N s in de wacht", na de start "opname: weer goed, niets verloren"; het log zonder gat | SIGKILL + nieuwe start na 30 s (`server-weg.mjs`): 0 stille vensters van 50 ms in 1040, WAV zonder nullen, de opname-melding telde 1 → 30 s en werd "weer goed". **Erbij: "track 1: stream hapert: Failed to fetch" en "track 2: …"** (rood, blijven staan; de oude proef telde alleen opname-meldingen) | `open ~/Applications/VARVE.app`; die haalt de Controlekamer naar voren: klik terug naar de mixer |
| server valt om (native fout, geheugen, kill -9) | `pkill -9 -f server/index.js` | de lus start hem na 1 s opnieuw (≤ 5 per minuut); in het log "de server viel om (exitcode 137): over 1 s opnieuw" en "server gestart (pid …) — herstart 1" | echte server op poort 8971 onder de lus (Linux `sh`): weer bereikbaar na **1,3 s**, precies die twee regels | na 5 s niets: VARVE.app; na 5 herstarts in een minuut stopt de lus (crash-lus: kijk in het log) |
| server hangt (poort open, geen antwoord) | `kill -STOP <pid>`, na 30 s `kill -CONT <pid>` | herhalen met time-out 10 s; de lus ziet niets (hang-detectie niet gebouwd) | `server-weg.mjs` met `VARVE_WEG_SOORT=hang`: 0 stille vensters in 1024, WAV zonder gat. De melding komt pas na **~10 s** en springt in stappen van ~10 s (10 → 21 s); **geen** "stream hapert" (de verzoeken hangen, ze mislukken niet); na SIGCONT antwoordt hij binnen 31 ms. Onder de lus: `status` blijft "de lus draait" | `kill -CONT <pid>`; anders `kill -9 <pid>` (dan start de lus hem opnieuw). Langer dan 60 s = stil (AR18) |
| een tweede server op de poort | `node server/index.js` naast de lus | "[server] poort … is bezet …", exit 3; de lus start niet opnieuw | precies die regel, exit 3. Maar hij ruimt **eerst** de `.bezig-*`-werkmappen op en zet de stems-rij terug (AR20) | niet doen; VARVE.app start er nooit een tweede |
| SIGTERM op de server (`pkill -f`) | `kill -TERM <pid>` | de lus stopt ook ("de server is gestopt (signaal 15): niet opnieuw gestart") | precies zo | VARVE.app |
| de Mac slaapt | Apple-menu → Sluimer | gaat de context uit `running`: "audio staat stil (…)", de eerste druk zet hem aan, dan "audio loopt weer" | alleen headless met `ctx.suspend()`: melding, resume op een nep-APC-druk, "audio loopt weer". **Of macOS-slaap de context echt stillegt, is niet gemeten** | klik in de mixer; anders herladen (Cmd+R vraagt eerst) |
| de audio-uitgang valt weg | de USB van de Scarlett eruit | "audio-uitgang staat stil: …" als de klok stilstaat terwijl de context `running` zegt; of "audio staat stil (…)" | niet te doen in de container | de Scarlett terug; de uitgang opnieuw kiezen of herladen (de melding zegt het) |
| geheugen over een lange avond | twintig keer instrument ↔ nummer | ≤ +20 MB privé na GC (de eis van lek.mjs) | −5 MB privé, +41 MB RSS (gedeeld, geen lek) | herladen geeft het terug |

**Volgorde op avond 1**, zodat geen storing de volgende proef vervuilt:
1. ar-app als eerste punt van het opstarten. ar-server rekent op de lus, en een VARVE.app zonder lus zou de proef
   ongemerkt anders maken.
2. ar-grid midden op de avond: het stoort niets.
3. ar-wissel aan het eind: het stoort niets.
4. ar-server: één opname over drie storingen, een minuut uit elkaar. Eerst stoppen (de grootste, met VARVE.app
   erna), dan omvallen, dan hangen. ar-na rekent het zo in één keer na (§4).
5. ar-uitgang als allerlaatste: na de slaap of de Scarlett moet je misschien herladen, en dan klopt de stand van
   de eerdere blokken niet meer.

Avond 3: ar-pc gaat op de pc, los van de mixer.

**Veiligheid:**
- Bij ar-scarlett eerst de masterfader en Cue Level laag en de koptelefoon af: als de Scarlett wegvalt kiest
  macOS een andere uitgang (aanname), mogelijk de luidsprekers van de MacBook.
- ar-hang nooit langer dan 30 s: na 60 s is het per ontwerp stil.
- Nooit een tweede server met de hand starten (AR20).

## 3. De droogloop (16 okt, deze container: Ubuntu, Node 22, Chromium 1194 headless)

| procedure | hoe | uitkomst |
|---|---|---|
| ar-weg (stoppen ≈ SIGKILL, 30 s) | `node tools/headless/server-weg.mjs` | alle eisen gehaald. De opname-melding telde 1 → 30 s in de wacht en werd "opname: weer goed, niets verloren". **Daarnaast twee rode meldingen "track N: stream hapert: Failed to fetch"** (AR17) |
| ar-hang (30 s) | `VARVE_WEG_SOORT=hang node tools/headless/server-weg.mjs` | alle eisen gehaald. Eerste melding na ~10 s, stappen 10 → 21 s, geen "stream hapert", na SIGCONT binnen 31 ms "weer goed" |
| ar-val, de lus | `sh tools/varve-app/server-lus.sh` met de echte server (PORT=8971, alle VARVE_*-mappen in tmp): kill -9, tweede server, kill -STOP/-CONT, kill -TERM, opnieuw, `stop` | terug na 1,3 s · tweede server exit 3 met "[server] poort 8971 is bezet …" · tijdens de hang `status` "de lus draait" · na SIGTERM "niet opnieuw gestart" · `stop`: "lus en server gestopt". De regels van de lus staan als `LUSLOG` in `test/ar-na.test.mjs` (met een startregel van VARVE.app en een regel van de server ertussen, zoals in `~/.varve-server.log`) |
| ar-wav | `VARVE_WEG_SOORT=hang VARVE_WEG_S=20 VARVE_WEG_KOPIE=<map> node tools/headless/server-weg.mjs`, dan `ar-na.mjs` droog en `--meet --venster 11:27:32-11:27:52` | droog: noemt WAV en log, leest niets · `--meet`: "reeksen nullen ≥ 10 ms: 0, waarvan in een storing: 0", log 7 regels met eind-regel en 0 gaten, "NIETS MIS GEVONDEN", exit 0. Tegenproef: in een kopie 1 s nullen op 15 s (11:27:41) → "← IN DE STORING", "GEVONDEN: 1 reeks(en) nullen in een storing", exit 2 |
| ar-slaap | `node tools/headless/gezondheid.mjs` (met `VARVE_CHROME`) | alles groen: de melding "audio staat stil (suspended): druk een knop …", een druk op de nep-APC zet hem aan, dan "audio loopt weer"; geen vals alarm. Echte slaap: niet te doen |
| ar-wissel | `PROEF=wissel VARVE_LEK_N=20 node tools/headless/lek.mjs` | privé 130 → 125 MB na GC (eis ≤ +20 MB: GOED); RSS 296 → 337 MB. Daarom zegt het punt welk getal telt |
| ar-pakket | `node tools/avondpakket.mjs --json` hier (Linux, geen APC, geen accu) | **zonder `VARVE_MEDIA` en zonder server: exit 3, "avondpakket: geen server op 8777 en geen mediamap: niets te controleren (VARVE_MEDIA?)"**. Het punt van 15 okt zou daar meteen vastlopen. Met een lege mediamap: exit 2, "nog niet vertrekken", door **backup rood "nog nooit"** (op een machine zonder library vals rood, AR19). Verder grijs "niet op dit platform" voor instellingen en iCloud, "geen accu (vaste pc?)", fase "niet te bepalen" (geen USB in de container), en de regel servers zegt "op deze Mac" |
| ar-snap … ar-ok | niet headless: de grid-modus vraagt de APC, en de echte tellen staan op de Mac | ar-na `--nummer`/`--titel` is getoetst op een nagemaakte library.db en tellen.json (2 ms naast = op de tel, 12 ms = naast, de "1" een tel naast = "NAAST de downbeats") |
| ar-scarlett, ar-node, ar-meet | niet te doen in de container | aannames in §6 |

## 4. Het bewijs na de avond: `tools/proef/ar-na.mjs`

Alleen lezen, op kopieën, standaard droog. Met `--meet` kopieert hij (op APFS een clone) naar een eigen tijdelijke
map, meet daar en ruimt die map op; het rapport gaat naar stdout. `test/ar-na.test.mjs` controleert dat de bronnen
byte voor byte en op tijd gelijk blijven en dat de kladmap weg is.

- **server**: de regels van de lus in `~/.varve-server.log` op de dag van de opname, met de vensters waarin de
  server weg was (een laatste `stop` aan het eind van de avond telt niet als storing; omvallen zonder terugkomen wel).
- **opname**: reeksen waarin alle kanalen precies 0 zijn, ≥ 10 ms (de eis van server-weg.mjs), met hun kloktijd
  (uit het id van de opname), en welke in een storing vallen (marge 5 s). Een hang staat niet in het log van de lus,
  die geef je met `--venster UU:MM:SS-UU:MM:SS`.
- **log**: regels, eind-regel, gaten van NUL-bytes, onleesbare regels, en hoeveel regels er tijdens de storing
  binnenkwamen.
- **grid** (`--nummer <id>` of `--titel <tekst>`): het grid uit (een kopie van) library.db tegen media/<id>/tellen.json
  met `meetGrid` (dezelfde functie als de server): raak, mediane afwijking in ms, de "1" op de downbeats, twijfel per
  stuk. "op de tel" = |mediaan| ≤ 5 ms; "1" klopt = ≥ 90% van de downbeats op een "1".
- exit 0 = niets mis, 2 = iets gevonden, 1 = verkeerd aangeroepen of niets te lezen.

## 5. Bevindingen (uit de droogloop)

AR17, AR19 en AR20 zijn op 16 okt gebouwd (tak `studio/ar-vervolg`, zie §8), AR18 daarna (tak `studio/ar-hang`, §9).

1. **"stream hapert" tijdens een storing** (AR17): per hoorbare track één rode melding die blijft staan, naast de
   ene opname-melding. Gemeten: 30 s weg, twee tracks = drie meldingen. Het geluid loopt door.
2. **Een hang ziet niemand** (AR18): de lus herstart alleen wat stopt. Gemeten: 30 s hangen is goed, de melding
   pas na 10 s. Boven 60 s wordt het stil.
3. **Het avondpakket op de pc** (AR19): zonder mediamap exit 3; met een lege mediamap rood op backup ("nog nooit")
   en dus "nog niet vertrekken"; "op deze Mac" in de regel servers. Het oude punt ar-pakket zou meteen vastgelopen
   zijn; het nieuwe zet `VARVE_MEDIA` op een lege map en zegt het rood erbij.
4. **Een tweede server ruimt eerst op** (AR20): de werkmappen `.bezig-*` en de stems-rij, vóór hij bij het
   luisteren de bezette poort ziet. De lus en VARVE.app voorkomen het; met de hand niet. Of een split die hij dan
   start na `process.exit(3)` doorloopt, is niet nagegaan.
5. **De tegel Server kijkt elke 2 s**: een herstart van 1,3 s kan hij missen (AR9). Het serverlog (en ar-na) is
   dan het bewijs, niet de tegel.
6. **VARVE.app haalt de Controlekamer naar voren**: na ar-weg staat het mixer-tabblad achter. Een tabblad dat
   hoorbaar geluid maakt, knijpt Chrome niet (aanname), maar wat er op het scherm staat, zie je pas weer als je
   terugklikt.

## 6. Aannames die verkeerd kunnen zijn

- **Taakbeheer.** Het staat in Chrome onder "Venster → Taakbeheer", met een kolom "Geheugenvoetafdruk" die dicht
  bij het privé geheugen ligt (niet RSS). In Comet of een Engelse Chrome heet het anders. Het punt noemt de kolom
  en de eis; klopt de naam niet, dan zegt Clay welke kolom er is.
- **Slaap.** macOS-slaap zet de AudioContext op `suspended` of `interrupted`. Gebeurt dat niet, dan is "geen
  melding, het liep door" ook een uitkomst; het punt zegt dat.
- **De Scarlett.** Valt hij weg, dan kiest macOS een andere uitgang, mogelijk de MacBook zelf; dat het
  samengestelde apparaat (vier kanalen) daarna weer werkt, is ongetest. Daarom staat het punt als allerlaatste.
- **De lus onder macOS `/bin/sh`.** Doorgelopen onder Linux `sh` (dash); macOS `sh` is bash 3.2 in POSIX-stand.
  `wait` na een signaal, `kill -0` en `$((…))` zijn POSIX, maar zelf gezien is het daar niet.
- **De opdrachten in de punten.** `~/Applications/VARVE.app` is waar maak.sh hem zet (`DOEL`). `pgrep -f
  server/index.js` vindt op de Mac precies één server. `date +%T` werkt in zsh.
- **ar-een.** De tellen van een nieuw nummer komen binnen 5 min; ze wachten op de GPU-plek, die een lopende
  stems-split kan bezetten. Het punt zegt wat je doet als ze niet komen.
- **De kloktijden.** Een opname-id en de regels van de lus zijn allebei lokale tijd van dezelfde Mac; het
  handelingenlog rekent vanaf zijn `begon`. De marge van 5 s vangt het verschil.

## 7. Nalopen

```sh
node test/controle.test.mjs          # o.a. citeert: elk citaat in doe/let én in de code
node test/ar-na.test.mjs             # het nameetscript op synthetisch materiaal
node tools/headless/server-weg.mjs   # SIGKILL, 30 s;   VARVE_WEG_SOORT=hang voor een hang
node tools/proef/ar-na.mjs           # droog; na de avond met --meet [--venster …] [--titel …]
```

## 8. Gebouwd na de droogloop (16 okt, tak `studio/ar-vervolg`)

- **AR17**: `StreamBron` meldt een hapering via `onHapert({ hapert, tekst | weerGoed })`. Het deck stuurt dat door
  als `'hapert'`, en `koppelMeldingen` maakt er één melding per track van (sleutel `stream:<deck>`): "track N:
  stream hapert: …", na de eerste reeks die weer binnenkomt "track N: stream weer goed" (info, gaat vanzelf weg).
  Een nieuwe laad, `leeg()` of `vernietig` haalt hem stil weg. Zonder `onHapert` blijft het zoals vroeger via
  `onFout`. Toets: stream.test (7 checks), meldingen.test (5 checks), `tools/headless/server-weg.mjs`.
  Gemeten in Chromium (server-weg.mjs, server 30 s weg): "track 1/2: stream hapert: Failed to fetch", na de herstart
  "track 2: stream weer goed" en "track 1: stream weer goed"; alle eisen van de proef gehaald (0 stille vensters, WAV zonder gat).
- **AR19**: de CLI geeft het platform aan het oordeel (`metingen.platform`, ook de route). Op een machine die geen
  Mac is en geen library.db heeft: backup grijs "geen library", geen exit 3 zonder mediamap (media grijs "geen
  map"), en "op deze machine" in plaats van "op deze Mac". Op de Mac verandert niets. Toets: avondpakket.test (3
  checks), avondpakket-meet.test (3 checks met de Linux-fixtures, `"library": false` in nep.json).
- **AR20**: `server/poort.js` (`poortBezet`) vlak na het lezen van de poort, vóór de library, de mappen en het
  opruimen: bezet = "[server] poort … is bezet … Deze stopt (er is niets aangeraakt)." en exit 3. De exit 3 bij
  `listen()` blijft voor de kleine kans dat twee tegelijk de proef halen. Toets: test/server-poort.test.mjs: met de
  fix blijft de `.bezig-*`-map staan en komt er geen library.db; zonder de fix (de oude index.js) faalden precies die
  twee checks.

## 9. AR18: de wachter (16 okt, tak `studio/ar-hang`)

- **Wat**: de herstartlus start naast elke server een wachter (een functie in de lus, op de achtergrond). Elke 5 s
  `curl -fs -m 2 http://127.0.0.1:<poort>/api/leeft`; drie keer niets achter elkaar = de server hangt. De wachter
  zoekt eerst wat de server startte (`pgrep -P`, ook de kleinkinderen: na de kill zijn die van init), schrijft
  "de server antwoordt niet (laatste antwoord UU:MM:SS, 3 keer niets op /api/leeft binnen 2 s, pid N): kill -9 …" in
  het log, en doet kill -9 op de server en die processen. De lus ziet exitcode 137 en start hem opnieuw zoals na elke
  crash (telt mee in de 5 per minuut). Een nieuwe server telt pas mee na zijn eerste antwoord, of na 120 s zonder.
- **`/api/leeft`** antwoordt uit het geheugen (`{ ok, server, pid }`, hetzelfde id als de ingest-rij), vóór alles
  wat schijf of database raakt. Bewust: een event loop die vastzit lost een herstart op, een schijf die hangt niet
  (de nieuwe server hangt dan ook, en de lus zou na vijf keer stoppen).
- **Gemeten**: de echte server onder de lus, vastgezet met SIGSTOP: kill -9 na 19 s, een nieuwe server na 21 s.
  Met de mixer erbij (`VARVE_WEG_SOORT=lus node tools/headless/server-weg.mjs`): 21,2 s, 0 stille vensters van 50 ms
  in 851, WAV van 39 s zonder gat, het log met eind-regel, één opname-melding die "weer goed" werd; bij de kill
  "stream hapert" per track, twee seconden later "stream weer goed". Onder dash én bash als `sh` (macOS).
- **ar-na** leest de regel als soort `hang`, met het laatste antwoord als begin van de storing (de hang begon daarna,
  hooguit één peiling later); de "viel om (exitcode 137)" erna hoort bij dezelfde storing. `--venster` is alleen nog
  voor een hang zonder de lus. Op de kopie van de meting: één storing "hing (de wachter van de lus zette hem neer)",
  "NIETS MIS GEVONDEN".
- **ar-hang** laat hem nu hangen zonder `kill -CONT` en kijkt of de wachter het doet; **ar-wav** heeft geen `--venster`
  meer nodig.
- **Toets**: server-lus.test (15 checks erbij: vastgezet = neergezet en opnieuw, het kind ook weg, een server die
  antwoordt of traag start blijft staan, een die nooit antwoordt na de opstarttijd niet, stop met een wachter erbij),
  server.test (de route, en dat zijn regel niets leest), ar-na.test (hang, één storing, middernacht).
- **Grens**: alles wat de event loop langer dan ~15 s vastzet wordt neergezet. Dat is ook wanneer de decks niets meer
  krijgen; analyse, backup, ingest en Demucs draaien buiten de event loop (worker of kindproces). Niet getest: macOS
  `pgrep -P` op een kleinkind van yt-dlp, en wat Demucs doet als hij midden in een stuk een kill -9 krijgt (de stems-rij
  zet hem bij de volgende start terug, zoals na een crash).

## 10. AR9: een herstart in de Controlekamer (16 okt, tak `studio/ar-herstart`)

- **Waarom niet de tegel zelf laten opletten**: de tegel kijkt elke 2 s en een herstart duurt ~1,3 s; na herladen
  weet de pagina niets meer. Daarom geeft de lus wat hij weet aan elke nieuwe server mee in de omgeving:
  `VARVE_LUS_SINDS` (de start van de lus), `VARVE_LUS_AANTAL` en de laatste 20 in `VARVE_LUS_HERSTARTS`
  (`<s>:<exitcode>:om|hang`). Een hang (AR18) laat de wachter weten met een merkbestand `<pidbestand>.hang`,
  want de lus ziet anders alleen exitcode 137. Geen bestand dat de server leest, geen schijf.
- **Server**: `server/lus.js` (`leesLus`, puur) leest het één keer bij het starten; `GET /api/leeft` geeft
  `{ ok, server, pid, gestart, lus }`.
- **Tegel** (`src/controle/server-tegel.js`, `herstartRegel`): "herstart om 22:14 (viel om, exitcode 137) · 1 keer
  sinds 21:30", of "(hing, de wachter zette hem neer)"; 10 minuten oranje (`HERSTART_RECENT_MS`), daarna groen met de
  regel erbij. Niet onder de lus: "zonder herstartlus (valt hij om, dan start niemand hem opnieuw)". Een oudere server
  (geen `lus`, of 404): geen regel. De herstartregel staat boven die van de secties (`\n`, `white-space: pre-line`).
- **Proefpunten**: ar-val en ar-hang zeggen nu wat de tegel moet tonen (citeert: "herstart om ", "viel om, exitcode ",
  "hing, de wachter zette hem neer").
- **Gemeten** in Chromium (`tools/headless/herstart.mjs`, 13 checks): na kill -9 binnen een paar seconden de regel
  en oranje, na herladen dezelfde regel, na SIGSTOP "· 2 keer", past op 1440 en 390 px, 0 fouten van de pagina.
- **Toets**: herstart.test (22 checks: lezen, regel, tegel, een echte server), server-lus.test (7 checks erbij:
  wat elke start meekrijgt, de hang, het merkbestand weg, de grens van 20).
