# Spoor C: Linux eerlijk, de suite gelijk (15 okt 2026)

Tak `arch/linux` (vanaf `origin/studio/architectuur`), geen PR. Gedraaid in een container
(Ubuntu 24.04, Node 22.22.0, GNU findutils 4.9.0, coreutils 9.4, 4 kernen, geen accu, geen USB,
geen lsusb of tailscale). Clay's Mac draait Node 26.8.2.

## Wat er gebouwd is

### C1. Het avondpakket kent zijn platform

- `server/avondpakket-meet.js`: `meet({ platform })` (standaard `process.platform`) kiest de
  sondes met `metersVoor(platform)`. **darwin** = de sondes van vóór vandaag, ongewijzigd.
  **linux**: media via GNU `stat -c '%s %n'` (`datalessNvt`), accu uit
  `/sys/class/power_supply` en USB uit `lsusb` + `/sys/bus/usb/devices` (allebei in een
  kindproces met time-out, zoals elke sonde), instellingen en iCloud grijs "niet op dit
  platform", geluid en Bluetooth grijs "niet op dit platform (de live-mixer draait op de Mac)",
  schijf/servers/AV-hub/Tailscale zoals op de Mac, alles met `LC_ALL=C`. Elk ander platform:
  alleen de AV-hub.
- `voerUit`: **een optie die het commando niet kent is nooit geslaagd** (`ONBEKENDE_OPTIE`), ook
  niet als de exitcode in `codes` staat; die controle komt vóór `codes` en vóór "bestaat niet"
  (GNU `stat -f` meldt er ook "No such file" bij). Plus een optie `env`.
- `server/avondpakket.js` (puur): `parsePowerSupply`, `parseLsusb`, `parseSysUsb`; het groene
  media-punt zegt op Linux "iCloud-uitplaatsing n.v.t. op dit platform" (op de Mac verandert de
  tekst niet).
- `nep.json` draagt zijn platform (`"darwin"`; `linux/nep.json` `"linux"`); de CLI
  (`tools/avondpakket.mjs`) en `maakAvondpakket` nemen het over.
- Fixtures `test/fixtures/avondpakket/linux/`: **echt** uit de container (GNU find/stat op een
  kladmediamap, df, een lege power_supply, de stderr van de Mac-opdrachten, de ontbrekende
  /sys/bus/usb) en **HANDGEMAAKT** (laptop aan USB-PD 65 W met een muisaccu, laptop op de accu
  18 %, een pc met alleen een muisaccu, lsusb met APC/Scarlett/Maschine, sysfs met APC en
  Scarlett). LEESMIJ bijgewerkt.
- Tests: `test/avondpakket.test.mjs` groep 45–46 (parsers, het oordeel op Linux: geen vals rood
  of groen), `test/avondpakket-meet.test.mjs` groep 11–13 (voerUit met de echte stderr, de
  commando's per platform met een opnemende exec, de Linux-fixtures, de goedkope ronde, de
  route-bundel, de CLI). De bestaande checks meten nu expliciet met `platform: 'darwin'` (een
  wrapper in de test; de checks zelf zijn ongewijzigd).

### C2. De suite gelijk

- `.node-version` = 26.8.2. `test/alles.mjs` zegt bovenaan en vlak boven de slotregel dat de Node
  afwijkt, met de bekende versiegevoelige checks (`test/node-versie.mjs`); niets overgeslagen, de
  uitslag ongewijzigd. `test/node-versie.test.mjs`: gelijk aan de workflow, alleen melden.
- `test/backup-kopie.test.mjs`: `NODE_NO_WARNINGS=1` in `env()`. Was 113 ok + 2 FAIL, nu 116 ok
  (de 2 + één nieuwe check: zonder de vlag komt er alleen de waarschuwing van Node bij).
- `test/wachtrij.test.mjs`: **bewezen zombie** (`/proc/<pid>/stat` = `(sleep) Z 1 …`: het
  kleinkind is een wees van PID 1 = `process_api`, dat niet opruimt). `leeftNog` telt een zombie
  als weg (/proc op Linux, `ps -o stat=` op macOS); een nieuwe check maakt een echte zombie.
- `tools/headless/beeld-lokaal.mjs`: pmset/sysctl/plutil/swiftc alleen op de Mac (`isMac`); elders
  "niet gemeten op dit platform" (kernen en belasting uit `node:os`, geluid `null`, de warmtemeter
  als `--`, `--accu` stopt met een reden, `zoekChrome` vraagt `VARVE_CHROME`). Hij crashte niet,
  maar meldde "machine: null, null kernen", een FAIL voor de warmtemeter en "geen
  audio-out-assertie" alsof er gemeten was. Checks in `test/beeld-meting.test.mjs`.
- `server/uitzend.js`: `hercodeerEncoder(platform)`: darwin videotoolbox (ongewijzigd), elders
  libx264 veryfast/zerolatency met dezelfde bitrate, keyframes en `-c:a copy`. S18 (ook 25 fps),
  S29 en R12 draaien en zijn groen in de container. P4 kiest videotoolbox expliciet, P4b toetst
  libx264. `docs/UITZENDEN.md` §4 een regel erbij.

### C3. Docs

`docs/AVONDPAKKET.md` §9b "Op Linux" (plus de kop en §3/§11).

## De echte run in de container

**Vóór** (CLI zonder server, kladmediamap van 2 bestanden): `○ Media lokaal leeg`,
`● Instellingen lokaal lokaal` (vals groen).

**Na**, CLI zonder server (kladmediamap): `KLAAR · let op 3`, exit 0: media ● "7 lokaal ·
iCloud-uitplaatsing n.v.t. op dit platform", instellingen/iCloud ○ "niet gemeten: niet op dit
platform", accu ○ "geen accu (vaste pc?)", fase ◐ "niet te bepalen (geen lsusb en geen USB in
sysfs)", schijf ◐ 22 GiB, server ◐ niet bereikbaar.

**Na**, route op een proefserver (poort 8952, echte sondes, geen NEP, een library van drie
nummers waarvan nrC een 0-byte audio en een ontbrekende video heeft): 0,3 s; compleet ✕ "2 mist:
nrC/video.mp4 (ontbreekt), nrC/audio.wav (0 B)" (echt), media ● 7 lokaal, servers ● één op
library.db, backup ● (de server maakte zelf een kopie), instellingen/iCloud/accu ○. Met
`fase=aankomst`: Meting ◐ "USB en geluid niet gemeten … meet opnieuw vóór je begint". De CLI met
`--poort 8952` zegt hetzelfde als de route (exit 2 door de echte rode compleet).
Geen vals rood, geen vals groen.

## De volle suite

`node test/alles.mjs --banen 2` (container, Node 22.22.0, 15 okt):

```
134 bestanden, 11515 checks, 7 overgeslagen — 2 ROOD · 2 tegelijk, 582 s (pool 418 s + alleen 164 s)
rood: instrumenten-fm-schaal.test.mjs, renderblok.test.mjs
```

Alleen de twee bekende V8-afvalmetingen zijn rood: fm-schaal "geen afval per blok … 0 GC, 28056
bytes" (de grens is 16 kB) en renderblok "keylock met wissels: 83,7 bytes per bericht". De suite
meldt ze bovenaan en onderaan als versiegevoelig. **Groen geworden:** backup-kopie (2), wachtrij
("allebei weg", 2×), en uitzend draait nu S18/S29/R12 (eerder overgeslagen). Overgeslagen (7,
`--`): analyse/video `total_allocated_bytes` (Node 22), beeld-lokaal.sh (alleen macOS), beeld
(geen Stroommachine), hub (geen av-app-hub), uitzend E1–E6 (echte tijd), paneel-schrijf p99
(loopback te traag in de container).

Let op voor wie dit nadoet: de scratchpad-map van deze sessie wordt door meerdere agenten gedeeld.
Een eerste run schreef naar dezelfde `alles.txt` als een ander spoor en werd daardoor door elkaar
gegooid. Die run is gestopt en opnieuw gedraaid met een eigen bestand.

## Wat niet af is, en waarom

- De Linux-vorm van een echte laptop-accu, USB-PD en de APC/Scarlett/Maschine in lsusb en sysfs
  is **niet gezien** (HANDGEMAAKT). Het vermogen van de lader uit `VOLTAGE_MAX × CURRENT_MAX` is
  een aanname.
- Tekst "N Varve-servers op deze Mac" zegt op de pc nog "Mac" (puur `beoordeel`; klein, niet
  aangeraakt om de Mac-teksten bit voor bit gelijk te houden).
- De versiegevoelige checks (renderblok keylock-afval, fm-schaal afval) zijn niet groen gemaakt:
  dat kan alleen door de grens per V8 te ijken, en dat zou verzwakken. Ze worden nu gemeld.
- `beeld-lokaal.mjs` meet op Linux nog niets echt (geen Chrome-zoeker voor Linux): alleen niet
  meer liegen.

## Voor CLAUDE.md (Clay of de integrator; dit spoor raakt CLAUDE.md niet)

- Bij "Conventies → Tests": *De Node van de suite staat in `.node-version` (26.8.2, de Mac en de
  workflow). Een andere Node: `alles.mjs` zegt het bovenaan en onderaan, met de checks die op een
  andere V8 anders uitvallen (`test/node-versie.mjs`, VERSIEGEVOELIG); niets wordt overgeslagen.
  Een nieuwe afvalmeting met een grens op één V8: zet hem in VERSIEGEVOELIG.*
- Bij het avondpakket (onder "Waar media/ staat" of een eigen kopje): *Het avondpakket meet per
  platform (`metersVoor` in server/avondpakket-meet.js, docs/AVONDPAKKET.md §9b): de Mac zoals
  altijd; Linux GNU stat, sysfs en lsusb, en grijs "niet op dit platform" voor wat er niet bestaat
  (instellingen, iCloud, geluid, Bluetooth). Een sonde accepteert nooit een exitcode bij een
  optie die het commando niet kent (`ONBEKENDE_OPTIE`). Een nieuwe sonde: per platform, en een
  fixture met `"platform"` in nep.json.*
- Bij "Mocks"/tests: *Een test die "is dit proces weg" vraagt, telt een zombie als weg (een
  container-PID 1 ruimt wezen niet altijd op; test/wachtrij.test.mjs `leeftNog`).*
- Bij uitzenden: *beeld/hercodeer: videotoolbox op de Mac, libx264 elders (`hercodeerEncoder`).*
- Bij `tools/headless/beeld-lokaal.mjs`: *de Mac-meters (pmset, sysctl, plutil, swiftc) alleen
  achter `isMac()`.*

## Open vragen voor Clay

1. Wil je één keer op de Omarchy-pc `node tools/avondpakket.mjs --json` draaien met de APC eraan
   (en, als die een accu heeft, met en zonder lader)? Dan vervallen de HANDGEMAAKT-fixtures voor
   Linux.
2. Moet het avondpakket op de pc iets eigens meten (de Stroommachine, de HDMI-uitgang, de
   verbinding naar de Mac), of is "eerlijk grijs" genoeg? Nu: alleen eerlijk.
3. Node op de pc: 26.8.2 installeren (dan is de suite daar gelijk aan de Mac), of de afwijking
   accepteren en alleen de waarschuwing lezen?
