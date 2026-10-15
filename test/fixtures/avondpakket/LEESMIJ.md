# Fixtures van het avondpakket

Uitvoer van de alleen-lezen commando's die het avondpakket (`server/avondpakket.js`,
`docs/AVONDPAKKET.md`) gebruikt, voor `test/avondpakket.test.mjs`. Geen test draait
een commando: alles komt uit deze bestanden.

## Echt (10 okt 2026, 12:26, MacBookAir10,1, macOS 27.0.1, niets aangesloten)

Vastgelegd met de commando's hieronder en daarna geanonimiseerd met een script in de
kladmap (niet in de repo): serienummers, UID's, locatie-id's, Bluetooth-adressen,
tailnet-naam, IP-adressen en de namen van niet-verbonden Bluetooth-apparaten zijn weg;
"Clay's" in apparaatnamen werd "(test)". De hostnaam `clayk` (de beeld-pc) is gebleven:
die staat al in `docs/BEELD.md` en in `avondpakket/profielen.json` (`peers`).

| bestand | commando | wat erin staat |
|---|---|---|
| `pmset-ac-65.txt` | `pmset -g batt` | AC Power, 65 %, charging (batterij-id vervangen door 1) |
| `pmset-ac-8w.txt` | `pmset -g ac` | **8 W** (5 V × 1,5 A): de lader die thuis aan de Air hangt |
| `ioreg-accu.txt` | `ioreg -rn AppleSmartBattery` | alleen de regels `MaxCapacity`, `CycleCount` (591) en `BatteryData` (Full 3413 / Design 4382 = 78 %) |
| `df-122vrij.txt` | `df -k /System/Volumes/Data` | 122 GiB vrij van 460 |
| `optimize-aan.txt` | `defaults read com.apple.bird optimize-storage` | `1` |
| `audio-luidsprekers.json` | `system_profiler SPAudioDataType -json` | standaard = MacBook Air luidsprekers (om 12:26; om 11:34 waren het de AirPods) |
| `usbhost-leeg.json` | `system_profiler SPUSBHostDataType -json` | twee keer "USB 3.1 Bus", niets eraan |
| `ioreg-usb-leeg.txt` | `ioreg -p IOUSB -w0 -r -c IOUSBHostDevice -l` | leeg |
| `bluetooth-aan-niets-verbonden.json` | `system_profiler SPBluetoothDataType -json` | aan, niets verbonden (de niet-verbonden lijst is vervangen door één placeholder) |
| `tailscale-running.json` | `tailscale status --json` | Running; `clayk` online en direct, `telefoon` via relay ams, `oud-apparaat` offline |
| `find-stat-leeg.txt`, `find-dataless-leeg.txt` | (leeg) | een lege mediamap, en "niets uitgeplaatst" |
| `audio-airpods-10okt.json` | `system_profiler SPAudioDataType -json` (13:47, herstelronde 1) | de AirPods als standaarduitvoer: twee items met dezelfde naam (invoer 1, uitvoer 2), meldingen op de luidsprekers. Bevestigt de vorm van `audio-airpods-HANDGEMAAKT.json` |
| `bluetooth-aan-airpods-10okt.json` | `system_profiler SPBluetoothDataType -json` (13:47) | aan, de AirPods verbonden (`Headphones`); adressen en niet-verbonden apparaten weg |

## `nep.json`: de sondes zonder commando's

`VARVE_AVONDPAKKET_NEP=test/fixtures/avondpakket` laat `server/avondpakket-meet.js`
(`maakNep`) per sonde een bestand hieruit lezen in plaats van een commando uit te voeren:
de echte uitvoer van 12:26 (accu 65 % aan 8 W, niets aangesloten) plus de handgemaakte
library van 26 nummers. Ook `avhub` (de poort 7700), `backups` (namen voor de CLI zonder
server), `server` en `paden` (waar de find-fixtures onder staan). De CLI vraagt in die
stand geen server, tenzij `--poort` gegeven is. `test/avondpakket-meet.test.mjs` maakt er
varianten van (groen, rood, leeg, geen map) in een tijdelijke map.

## HANDGEMAAKT (het woord staat in de bestandsnaam)

Nagemaakt, niet gezien. Vooral de vorm van **aangesloten** hardware is een gok tot stap
7a (de uitvoer van de proefavond vastleggen, met de apparaten nog aangesloten). Daarom
staat `hardwareBevestigd` in `avondpakket/profielen.json` op `false`: niet-geziene
hardware wordt dan hooguit oranje, nooit vals rood.

| bestand | wat | aanname |
|---|---|---|
| `audio-airpods-HANDGEMAAKT.json` | de echte vorm + AirPods als invoer- én uitvoer-item met dezelfde naam, uitvoer = standaard | zoals de jury het om 11:34 zag (3-ontwerp-gekozen.md "Extra metingen") |
| `audio-samengesteld-HANDGEMAAKT.json` | + "Scarlett 2i2 USB" (usb, 2 uit) en "Samengesteld apparaat" (4 uit, standaard) | transport `coreaudio_device_type_aggregate` is geraden |
| `audio-scarlett-2kan-HANDGEMAAKT.json` | de Scarlett als standaard (2 kanalen), het samengestelde apparaat bestaat maar is niet de standaard | |
| `audio-blackhole-HANDGEMAAKT.json` | BlackHole 16ch (echt aanwezig) als standaard | |
| `usbhost-apc-scarlett-maschine-HANDGEMAAKT.json` | onder de bussen: APC40 mkII, en onder een hub Scarlett en Maschine | sleutelnamen voor vendor/product **geraden** en bewust verschillend (`USBDeviceKeyVendorID`, `vendor_id`, `Vendor ID` als getal) |
| `ioreg-usb-apc-HANDGEMAAKT.txt` | één IOUSBHostDevice "APC40 mkII", idVendor 2536 (0x09e8), idProduct 41 (0x0029) | de USB-id van de APC komt uit eigen kennis, niet geverifieerd |
| `pmset-accu-18-HANDGEMAAKT.txt`, `pmset-accu-63-geenschatting-HANDGEMAAKT.txt` | op de accu, 18 % (0:41) en 63 % "(no estimate)" | |
| `pmset-ac-notcharging-80-HANDGEMAAKT.txt`, `pmset-ac-charged-HANDGEMAAKT.txt`, `pmset-ac-finishing-HANDGEMAAKT.txt` | de toestanden rond 80-100 % aan de lader | |
| `pmset-ac-30w-HANDGEMAAKT.txt`, `pmset-ac-geen-HANDGEMAAKT.txt` | een 30 W-lader; geen lader ("No adapter attached.") | |
| `find-stat-131-HANDGEMAAKT.txt` | 26 nummers × 5 bestanden + `library.db` onder `/Users/test/varve/media`; `nr03_test/audio.wav` is 0 bytes | |
| `find-dataless-3-HANDGEMAAKT.txt` | twee `stems.wav` in een nummermap en één backup uitgeplaatst | |
| `find-dataless-backups-HANDGEMAAKT.txt` | alleen een backup uitgeplaatst | |
| `find-instellingen-1-HANDGEMAAKT.txt` | `mappings/apc40mk2.json` uitgeplaatst | |
| `tailscale-gestopt-HANDGEMAAKT.json` | `BackendState: "Stopped"` | |
| `bluetooth-aan-airpods-HANDGEMAAKT.json`, `bluetooth-uit-HANDGEMAAKT.json` | AirPods (Headphones) + een muis verbonden; Bluetooth uit | |

Na 7a vervallen de audio- en usb-HANDGEMAAKT-bestanden (vervangen door echte uitvoer met
de datum in de naam). Controle: `grep -l HANDGEMAAKT` hoort dan alleen nog `pmset-*`,
`find-*`, `tailscale-gestopt` en `bluetooth-*` te tonen.

## Library compleet: welke velden tellen

`verwachteBestanden(track)` telt per nummer, zoals `Library._verrijk` (server/library.js)
een rij teruggeeft: `audio`, `video` (als niet null), `peaks.bestand`, `onset.bestand` en
`stems.bestand`, **alleen als ze in de rij staan**. De paden staan in de library relatief
aan de projectmap (`media/<id>/audio.wav`); het pakket vergelijkt `<id>/<bestand>` met de
lijst van `find … -exec stat` (geen `fs.stat` per bestand). Een thumbnail is een URL en
telt niet mee.

## `linux/`: de sondes van Linux (spoor C, 15 okt 2026)

`server/avondpakket-meet.js` kiest de sondes per platform (`metersVoor`, docs/AVONDPAKKET.md
"Op Linux"). `linux/nep.json` heeft `"platform": "linux"` (de map hierboven `"darwin"`): zo
meten de tests met de juiste sondes, op welk platform ze ook draaien.

**Echt** (de container van 15 okt: Ubuntu 24.04, GNU findutils 4.9.0, coreutils 9.4,
`LC_ALL=C`), op een kladmediamap `/tmp/varve-linux/media` van negen bestanden:

| bestand | commando | wat erin staat |
|---|---|---|
| `find-stat-9.txt` | `find -H <media> -type f -exec stat -c '%s %n' {} +` | negen bestanden; `nr01_test/audio.wav` is 0 bytes |
| `df-k.txt` | `df -k <media>` | 22 GiB vrij van 252 |
| `power-supply-leeg.txt` | `find -L /sys/class/power_supply -mindepth 2 -maxdepth 2 -name uevent -type f -exec grep -H '' {} +` | leeg: geen accu (zoals een vaste pc) |
| `find-flags-stderr.txt` | `find -H <media> -type f -flags +dataless` (de Mac-opdracht) | `find: unknown predicate '-flags'`, exit 1: de oude sonde nam dat als geslaagd |
| `stat-f-stderr.txt`, `stat-f-stdout.txt` | `find … -exec stat -f '%z %N' {} +` (de Mac-opdracht) | GNU stat leest `-f` als "bestandssysteem": geen enkele regel `<bytes> <pad>`, exit 1 |
| `sys-usb-ontbreekt-stderr.txt` | `find -L /sys/bus/usb/devices …` | de map bestaat niet in de container |

`lsusb` en `tailscale` zijn er niet (ENOENT): in `nep.json` als `{ "fout": "… niet gevonden" }`. Ook
`/sys/class/drm` bestaat niet (`"drm": { "fout": "bestaat niet" }`), de relay op 7702 is dicht
(`"relay": false`) en de Node is v22.22.0 tegen `.node-version` 26.8.2 (`"node"`, AR13/AR14).

**HANDGEMAAKT** (niet gezien; de vorm uit de kernel-documentatie en usbutils, de waarden verzonnen):

| bestand | wat | aanname |
|---|---|---|
| `power-supply-laptop-ac-HANDGEMAAKT.txt` | BAT0 72 % laden, AC online, een USB-PD-bron van 20 V × 3,25 A (65 W), een muisaccu met `SCOPE=Device` (9 %) | het vermogen uit `VOLTAGE_MAX × CURRENT_MAX` van `ucsi-source-psy-*` |
| `power-supply-laptop-accu-HANDGEMAAKT.txt` | op de accu, 18 %, `CHARGE_*` in plaats van `ENERGY_*`, `CYCLE_COUNT=0` | 0 cycli = "niet ondersteund" |
| `power-supply-pc-muis-HANDGEMAAKT.txt` | alleen een muisaccu (`SCOPE=Device`) | een vaste pc: geen accu |
| `lsusb-apc-scarlett-maschine-HANDGEMAAKT.txt` | Maschine (17cc:1140), Scarlett (1235:8210), een hub, de APC zonder naam (09e8:0029), root hubs | usb.ids kent de APC misschien niet: dan herkent de id hem |
| `lsusb-leeg-HANDGEMAAKT.txt` | alleen root hubs en een muisontvanger | |
| `sys-usb-apc-scarlett-HANDGEMAAKT.txt` | `grep -H ''` op idVendor/idProduct/product/manufacturer: APC, Scarlett, een hub, de root hub | |
| `drm-hdmi-HANDGEMAAKT.txt` | `grep -H ''` op `/sys/class/drm/card1-*/status` (AR13): eDP-1 intern verbonden, HDMI-A-1 verbonden (de beamer), DP-1 los | poortnamen zoals de kernel ze geeft (`card<n>-<type>-<nr>`) |
| `drm-geen-beamer-HANDGEMAAKT.txt` | hetzelfde, maar HDMI-A-1 los | |

De echte uitvoer van de pc komt met `node tools/avondpakket.mjs --vastleggen <map>` (AR12): per sonde
`<sleutel>.txt` plus een `nep.json`, de thuismap als `/home/test` en Tailscale kaal (naam, OS, online,
"direct", relay). Nakijken vóór het hierheen gaat.
