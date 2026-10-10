# Avondpakket: één controle vóór vertrek en bij aankomst

*10 okt 2026, spoor "draagbaar" (VISIE §3: de draagbare set). Ontwerp:
`uitwerking/draagbaar/5-ontwerp-definitief.md` (kladmap van de sessie van 10 okt), review
`7-review-1.md`. Stand: **stap 1-6 gebouwd** (kern, sondes, CLI, route, tegel, docs).
Open: **7a/7b** (de uitvoer van aangesloten hardware zien en de uittrekproef met Clay);
tot dan staat `hardwareBevestigd` op `false`.*

## 1. Wat het is

Eén **alleen-lezen** controle die op twee momenten dezelfde vraag beantwoordt:
**kan ik met deze tas vertrekken** en **kan ik hier beginnen**. Bij vertrek kijkt hij naar
wat onderweg niet meer te herstellen is (audio en instellingen echt lokaal, library
compleet, schijf, accu en lader, backup, geen achtergrondwerk); bij aankomst naar wat er
aanhangt (geluidsuitgang, APC, Scarlett, Maschine, de AV-hub, Bluetooth, Tailscale, één
server op `library.db`). Hij repareert niets, schrijft niets en meet niet terwijl er een
deck speelt.

## 2. Zo gebruik je het

- **Clay:** VARVE in het Dock → Controlekamer → tegel **Avondpakket** (na Backup).
  "klaar", "klaar · let op 2" of "2 rood"; de regel eronder noemt het eerste rode (anders
  oranje) punt. **Klik de tegel** om opnieuw te meten. In het uitklapblok onder de tegels:
  profiel en fase kiezen, alle punten, de **paklijst met vinkjes** (niet bewaard), wat Varve
  met dit profiel kan en niet kan.
- **Zonder server, en voor Claude/agents:** `node tools/avondpakket.mjs` (zie §10).
- **De route:** `GET /api/avondpakket?profiel=apc&fase=vertrek|aankomst&vers=1`.

Wanneer meet het? Bij het openen van de Controlekamer, bij een andere keuze, bij een klik,
en verder hooguit elke 5 minuten (niet elke 2 s zoals de andere tegels: de meting start
`system_profiler` en `find`). **Staat de mixer open**, dan meet de pagina niet vanzelf
("niet gemeten · mixer open: klik om te meten"). **Speelt er een deck** (de server ziet
Range-verzoeken op `audio.wav`/`stems.wav`, 30 s), dan geeft de server de laatste stand terug:
"bevroren: er speelt een deck · 18:30". Een klik vraagt dan alleen het goedkope opnieuw
(`pmset`, `df`, `defaults`, `pgrep`, poort 7700), nooit `system_profiler`, `ioreg`, `lsof` of `find`.

## 3. De bestanden

| bestand | wat |
|---|---|
| `server/avondpakket.js` | **puur**: parsers (`pmset -g batt`/`ac`, `ioreg` accu en USB, `df -k`, `defaults read com.apple.bird optimize-storage`, `system_profiler` audio/Bluetooth/USB-host, `tailscale status --json`, `find -exec stat` en `find -flags +dataless`), `leesProfielen`, `paklijstVan`, `herkenUsb`, `kiesFase`, `verwachteBestanden`/`vergelijkCompleet`, `schoon` (privacy), `beoordeel`. Geen I/O, `nu` van buiten |
| `server/avondpakket-meet.js` | de sondes in **kindprocessen** met een time-out per sonde (`voerUit`: `execFile`, 8 MB, SIGKILL), `poortOpen`, `meet`, `maakCache` (één lopende meting, 10 s, bevriezing), `maakNep` (fixtures), `maakAvondpakket` (de bundel voor de route), `backupMeting`, `achtergrondMeting`, `extraPaden` |
| `avondpakket/profielen.json` | de data: apparaten (hoe te herkennen), vijf profielen, grenzen, `bekend`, `paklijst`, `hardwareBevestigd`. Niet via HTTP te lezen (niet in `MAG`) |
| `server/index.js` | één import, `maakAvondpakket({ … speeltDeck … })`, de route na `/api/backups` |
| `server/backup.js` | `stand().gewijzigdSinds`: een wijziging die nog in geen kopie zit (false/true/null) |
| `src/controle/avondpakket-tegel.js` | de tegel als pure functie |
| `src/controle/controle.js`, `controle.html`, `controle.css` | de tegel, het uitklapblok, wanneer er gemeten wordt |
| `tools/avondpakket.mjs` | de CLI |
| `test/avondpakket.test.mjs`, `test/avondpakket-meet.test.mjs`, `test/avondpakket-server.test.mjs`, `test/fixtures/avondpakket/` | zie §11 |
| `tools/headless/avondpakket.mjs` | de tegel in Chromium (§11) |

Niets in `src/engine/`, geen actions, geen speellijstblokken, geen nieuwe dependency.

## 4. De profielen (data, zelf in te stellen)

`avondpakket/profielen.json`. Per onderdeel `verwacht`, `optioneel` of `nee`. Een nieuwe
controller of geluidskaart is een regel onder `apparaten` (naam als regex, USB `vid:pid`
in hex), geen code. `optioneel` = niet op de paklijst, wel herkend als hij eraan hangt (zo
staat de Xboard49 erin: geen reisspul).

| profiel | mee | Varve kan | niet, en het alternatief |
|---|---|---|---|
| `laptop` | laptop, bedrade koptelefoon | fader: één tegelijk met de muis · filter/fx/echo op de focus-track · alles met toetsenbord | geen overgang met de hand; geen aparte cue (2 kanalen) |
| **`apc`** (standaard, de kern) | + APC40 mkII, Scarlett 2i2, PD-hub | **fader 8 tegelijk · filter · fx · echo** (Clay's vier meest gebruikte gebaren) en het volledige DJ-werk zonder hub (`docs/APC40.md`) | bladeren/laden vanaf de APC (ONTBREEKT B10): muis of toetsenbord |
| `maschine` | + Maschine MK2 (+ LPD8), Scarlett, AV-hub | **geen fader** (overgangen met de muis) · filter/fx/echo op de focus-track · pads, patronen, Strip/Rack, secties, sampler, wiel | play/pauze, crossfader, tempo per deck (`docs/MASCHINE.md` §5c) |
| `alles` | APC + Maschine + LPD8 + hub (avond 2) | alles van apc én maschine | Bank = hubtoets |
| `beeld` | APC + Scarlett + Tailscale naar `clayk` (avond 3) | alles van apc + de Stroommachine volgt klok en nummer | HDMI-adapter en de voeding van de pc apart |

**Minimale controllerset onderweg:** **APC + Scarlett + bedrade koptelefoon + PD-hub + lader
(≥ 30 W)** is de kleinste set voor een volledige DJ-set. Alleen de Maschine kan pads,
patronen en bladeren, maar geen faders of crossfader. Maschine en AV-hub pas na avond 2 (de
hub-lease is nog nooit op de hardware geproefd).

## 5. Fase en oordeel

- **Fase `auto`** (standaard): hangt er geen apparaat van het profiel aan, dan `vertrek`;
  anders `aankomst`. Een standaarduitvoer met **4 of meer kanalen** die niet ingebouwd,
  Bluetooth of virtueel is (het samengestelde apparaat) telt ook als "aangekomen"; een
  HDMI-scherm of een USB-C-dongle met 2 kanalen niet. Alleen USB-audio telt als apparaat:
  een samengesteld apparaat dat "Scarlett + koptelefoon" heet, is geen Scarlett. Profiel
  `laptop` is altijd `aankomst` (niets in te pakken). De fase wordt niet onthouden.
- **Vertrek** toetst alleen het thuiswerk. Apparaten, geluid, de USB-hub en een dichte
  AV-hub zijn dan grijze **paklijstregels** ("inpakken: APC40 mkII + USB-B → USB-C",
  "straks bij aankomst: npm start -- studio"), nooit oranje. Zo is een goed ingepakte tas
  in elk profiel "klaar" zonder "let op".
- **Aankomst** toetst alles. Een verwacht apparaat dat ontbreekt is rood, **behalve zolang
  `hardwareBevestigd: false`**: dan hooguit oranje, want de uitvoer van aangesloten
  hardware is nog niet gezien (stap 7a/7b).
- **Oordeel**: `klaar` = geen rood (met "let op n" als er oranje is); anders "nog niet
  vertrekken" of "nog niet beginnen".
- **`bekend`**: een punt-id in die lijst dat oranje zou zijn, wordt grijs "bekend: …" en
  telt niet mee. Rood wordt nooit onderdrukt. Standaard: `["icloud"]`.
- Een sonde die faalt of te traag is: grijs "niet gemeten: <reden>", nooit rood. De reden
  noemt nooit een pad of een opdrachtregel.

| punt | groen | oranje | rood |
|---|---|---|---|
| media lokaal | > 0 bestanden, niets uitgeplaatst (met server: niet minder dan de library verwacht) | alleen buiten de nummers (`backups/`) uitgeplaatst; minder bestanden dan verwacht | iets in `<id>/` of `library.db`/`kaart.db` uitgeplaatst: "open in de Finder, klik het wolkje, thuis" (leeg/ontbreekt = grijs) |
| instellingen lokaal | niets uitgeplaatst | code uitgeplaatst | `mappings/`, `racks/`, `patronen/`, `plannen/`, `Input/`, `proef/` of het kaartbestand uitgeplaatst |
| iCloud | optimaliseren uit, of aan met ≥ 50 GiB vrij | aan en < 50 GiB vrij | — |
| schijf | ≥ 50 GiB | 20-50 GiB | < 20 GiB |
| accu | vertrek ≥ 80 %; aankomst aan een lader ≥ 30 W | < 80 % bij vertrek; zwakke lader (nu **8 W**); op de accu bij aankomst | < 20 % op de accu, **of < 20 % aan een lader onder 30 W** |
| geluid (aankomst) | standaard ≥ 4 uitgangen, niet virtueel, geen Bluetooth | Bluetooth, 2 kanalen ("geen aparte cue"), virtueel; met de tip welk 4-kanaals apparaat te kiezen | dezelfde, als `hardwareBevestigd` |
| Bluetooth (aankomst) | uit, of aan zonder audio-apparaat | een koptelefoon/speaker verbonden: "zet Bluetooth uit" | — |
| AV-hub (7700) | past bij het profiel | `nee` en open ("kan de APC vergrendelen") | verwacht en dicht bij aankomst (bij vertrek grijs "straks bij aankomst") |
| servers | één proces op `library.db` | onbekend en ≥ 2 Varve-servers | ≥ 2 processen op `library.db` |
| Tailscale | Running | niet Running als `verwacht` (vertrek); peer offline (`beeld: verwacht`) | niet Running als `verwacht` (aankomst) |
| backup | kopie zonder latere wijziging; sub altijd "kopie staat op deze Mac (gaat mee in de tas)" | wijziging nog in geen kopie | mislukt, of nog nooit een kopie (grijs: bezig, onbekend of CLI zonder server) |
| achtergrond | wachtrijen leeg, nacht uit of vandaag speeldag | iets in de wachtrij; nacht aan zonder speeldag; bij vertrek een split bezig | een split of ingest bezig bij aankomst |
| library compleet | elk verwacht bestand er en > 0 B | — | een bestand mist of is 0 B (grijs met de oude stand als er een deck speelt) |

## 6. Paklijst en poorten

De Air (`MacBookAir10,1`) heeft **twee** USB-C-poorten; lader + Scarlett + APC zijn drie
stekkers. Daarom een **USB-C-hub met PD-ingang** (lader in de hub, hub in de Mac).

| profiel | poort 1 | poort 2 | aan de PD-hub |
|---|---|---|---|
| `laptop` | lader | — | — |
| `apc` | APC40 mkII direct | PD-hub | lader (≥ 30 W) · Scarlett 2i2 |
| `maschine` | PD-hub | — | lader · Scarlett · Maschine · LPD8 |
| `alles` | APC direct | PD-hub | lader · Scarlett · Maschine · LPD8 |
| `beeld` | APC direct | PD-hub | lader · Scarlett · USB-C→HDMI (als de hub hem heeft) |

**De paklijst is data.** Het rapport heeft altijd een veld `paklijst` (ook bij aankomst en
voor `laptop`); bij vertrek staat dezelfde lijst in `inpakken`. Eerst wat het pakket zelf
kent (de PD-hub en elk `verwacht` apparaat met zijn kabel), dan de regels uit
`profielen.json` → `paklijst` (`{ "wat": "…", "profielen": "*" | ["apc", …] }`):

1. lader ≥ 30 W USB-C PD (de Apple-lader, geen telefoonlader: thuis hangt er 8 W aan) — alle
2. bedrade koptelefoon + verloop 6,3 → 3,5 mm (AirPods = Bluetooth: latency, geen cue) — alle
3. speaker + netsnoer + 2× jack naar de ingang van de speaker — apc, maschine, alles, beeld
4. stekkerdoos (lader, speaker, hub) — alle
5. USB-C → HDMI, de Omarchy-pc + voeding, netwerk voor Tailscale — beeld
6. ☐ een kopie van `library.db` (liefst ook `media/`) **blijft thuis**: de backups in `media/backups/` gaan mee in de tas — alle

Een regel erbij of weg: `profielen.json` aanpassen, geen code.

## 7. Ritueel

**Vóór vertrek (thuis, ~5 min):**
1. VARVE in het Dock → Controlekamer → tegel Avondpakket (fase springt op `vertrek` zolang er niets aanhangt). Doel: "klaar"; elk "let op" bewust gezien.
2. Rood media/instellingen: map openen in de Finder, het wolkje klikken, wachten (een `stems.wav` van 3,9 GB duurt minuten); tegel opnieuw klikken.
3. Accu tot ≥ 80 %; achtergrond: vandaag als speeldag in de nacht-tegel, of de split laten aflopen.
4. Paklijst van het profiel afvinken in het uitklapblok, **inclusief de kopie die thuis blijft**.
5. Niets meer binnenhalen (huisregel). Geen server? `node tools/avondpakket.mjs`.

**Bij aankomst (5 stappen):**
1. Stekkers: lader in de PD-hub, hub in poort 2, APC in poort 1, Scarlett aan de hub, koptelefoon in de Mac, speaker aan de Scarlett (speaker nog uit). **Bluetooth uit.**
2. Systeeminstellingen › Geluid › uitvoer = het samengestelde apparaat (`docs/STUDIO.md` §3).
3. Tegel Avondpakket, profiel kiezen (fase springt op `aankomst`). Rood: eerst de regel die de tegel noemt. Profiel `maschine`/`alles`: pas nu `npm start -- studio` in `~/Projects/AV-app-hub`.
4. Mixer openen, audio starten, KOPTELEFOON-rij "zaal 1/2 · koptelefoon 3/4"; cue proberen met de fader dicht, dan pas de speaker aan.
5. Vanaf nu meet het pakket niet meer (de server ziet het deck).

**Het kaartje** (A6 of een foto op de telefoon): voorkant de paklijst van het profiel
(`node tools/avondpakket.mjs --profiel apc` drukt hem af onder "Paklijst"), achterkant de
vijf aankomststappen hierboven en de poortenrij van het profiel uit §6.

**Met de hand** (alles alleen lezen; niet tijdens het spelen), als zelfs de CLI niet kan:

```sh
R="$HOME/Desktop/1. Projects/Youtube mixer"   # de echte checkout
find -H "$R/media" -type f -flags +dataless | wc -l       # 0 = alles lokaal
defaults read com.apple.bird optimize-storage             # 1 = macOS mag media/ naar iCloud zetten
df -h /System/Volumes/Data | tail -1                      # vrije ruimte
pmset -g batt; pmset -g ac | grep Wattage                 # accu en het vermogen van de lader
system_profiler SPAudioDataType | grep -B2 -A6 "Default Output Device: Yes" | grep -E ":$|Channels|Transport"
ioreg -p IOUSB -w0 | grep -iE "apc|maschine|lpd8|scarlett|focusrite|xboard"
nc -z 127.0.0.1 7700 && echo "hub draait" || echo "geen hub"
lsof -t -- "$R/media/library.db" | wc -l                  # 1 = één proces op de library
tailscale status | head -3
```

## 8. Privacy

Het rapport bevat geen absolute paden (alleen `<id>/<bestand>`), geen backupnamen (alleen
tijden), geen IP-adressen en geen omgevingsvariabelen. Elk punt gaat door `schoon()`
(absolute paden → de laatste naam, `library-….db` → "de kopie", IPv4 → `<ip>`); de
foutteksten van kindprocessen noemen nooit de opdrachtregel. Tailscale-peers alleen bij
naam en alleen die het profiel noemt (`peers`).

## 9. Grenzen van wat het ziet

- **iCloud**: een uitgeplaatst bestand heeft de vlag `dataless`; `find -flags +dataless`
  leest geen byte en haalt niets binnen. `find -H`: ook een gelinkte mediamap (worktree).
- **Library compleet** vergelijkt de verwachte paden uit de library (`audio`, `video`,
  `peaks`, `onset`, `stems` als ze in de rij staan) met wat `find` zag; geen `fs.stat` per
  bestand in de server. De verwachte paden worden alleen opnieuw gelezen als de database
  veranderde.
- **De USB-hub** is niet te meten zonder aannames: altijd een grijze paklijstregel.
- **Het kaartbestand** (`varve-kaart.json`, in iCloud) telt bij de instellingen: uitgeplaatst
  = rood (zonder internet geen kaart).

## 10. Voor agents

```sh
node tools/avondpakket.mjs [--profiel <naam>] [--vertrek|--aankomst] [--streng] [--json] [--poort 8777]
```

- Draait de server, dan leest de CLI `/api/avondpakket` (met `vers=1`) en zegt hij hetzelfde
  als de tegel. Geen server (of een oudere zonder de route): hij meet zelf, met de backup
  uit de namen in de backupmap, achtergrond en library compleet grijs, en opent
  `library.db` nooit. Omgeving zoals de server: `VARVE_MEDIA`, `VARVE_DB`, `VARVE_BACKUPS`,
  `VARVE_PLANNEN`/`_PATRONEN`/`_PROEF`, `VARVE_KAART`.
- Exit: **0** geen rood · **1** oranje, alleen met `--streng` · **2** rood · **3** fout in de
  aanroep (onbekend profiel, ongeldige vlag, server noch mediamap bereikbaar).
- `--json` = het antwoord van de route: `{ profiel, profielOnbekend?, fase, faseGekozen, t,
  duurMs, bevroren?, hardwareBevestigd, licht, telling, oordeel, letOp, inpakken, paklijst,
  punten: [{ id, naam, licht, waarde, sub }], titel, kan, kanNiet, let, profielen, bron }`.
- **Nooit tijdens een set** draaien zonder dat de server het weet: de route bevriest op een
  spelend deck, de CLI zonder server niet.
- Tests en de headless-check: `VARVE_AVONDPAKKET_NEP=<map>` leest `<map>/nep.json`
  (`test/fixtures/avondpakket/LEESMIJ.md`); de CLI vraagt dan geen server, tenzij `--poort`.

## 11. Hoe te testen

```sh
node test/avondpakket.test.mjs          # puur, < 1 s: parsers, profielen, fase, oordeel, paklijst, tegel, privacy
node test/avondpakket-meet.test.mjs     # sondes met een nep-exec (50 ms), cache, bevriezing, de CLI (exit 0-3)
node test/avondpakket-server.test.mjs   # de route op een eigen server met NEP-fixtures (~3 s)
node test/backup.test.mjs               # o.a. gewijzigdSinds
node tools/headless/avondpakket.mjs [uitmap]   # de tegel in Chromium (~40 s; poorten 8914/9514)
node test/alles.mjs                     # alles
```

Niet tijdens een proefavond: `alles.mjs`, de servertest en de headless-check gebruiken CPU.

## 12. Wat niet getest is

- **De vorm van aangesloten hardware** (APC, Scarlett, Maschine, LPD8 in `SPUSBHostDataType`
  en `ioreg`; een samengesteld apparaat in `SPAudioDataType`) is **niet gezien**: die
  fixtures zijn HANDGEMAAKT en de parser matcht daarom ruim. Daarom `hardwareBevestigd: false`.
  Wel echt gezien (10 okt): de luidsprekers en de AirPods als standaarduitvoer, Bluetooth
  met en zonder AirPods, niets aangesloten op USB, de accu aan de 8 W-lader, Tailscale.
- Of de Scarlett als transport `usb` meldt (de herkenning via de audio rekent daarop) en of
  het samengestelde apparaat `aggregate` heet: pas na 7a.
- De USB-id van de APC (`09e8:0029`) is niet geverifieerd; de naam-regex `apc40` moet het
  dan doen.
- Eén echte run van de CLI (10 okt 13:45, kladmediamap via een link, geen server): 0,27 s,
  elke sonde gemeten. Nooit tegen Clay's server op 8777, de echte `media/` of de echte
  `library.db` gedraaid.
- Of `find -flags +dataless` een door Clay "van deze Mac verwijderd" bestand echt ziet: 7b.
- Hoe lang de accu het onder last houdt aan de 8 W-lader of zonder lader: niet gemeten.
- Clay's gebruikscijfers in de `kan`-regels (11.796× fader enz.) zijn overgenomen uit het
  stappenplan van 9 okt, niet nagerekend.

## 13. Wat er nog niet is

- **7a** (morgenochtend, mixer dicht, apparaten nog aan, alleen lezen): `system_profiler
  SPAudioDataType SPUSBHostDataType -json` en `ioreg -p IOUSB -w0 -r -c IOUSBHostDevice -l`
  vastleggen, anonimiseren, de HANDGEMAAKT-fixtures voor audio en usb vervangen.
- **7b** (met Clay): elk apparaat uittrekken maakt precies dat punt rood; één bestand "van
  deze Mac verwijderen" en kijken of het pakket het ziet; dan `hardwareBevestigd: true`.
- 8: de mixer meldt zijn uitgang (eigen PR). 9: het ritueel afvinkbaar op de iPhone. 10: een
  sonde voor de reiskopie. Alle drie na een keuze van Clay.

Open keuzes voor Clay (speaker en koptelefoon, PD-hub, kopie buiten de laptop, iCloud,
grenzen, fase `auto`) staan in het ontwerp, §7.
