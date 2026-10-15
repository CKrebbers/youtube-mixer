# VARVE overal openen via Tailscale (2 oktober 2026)

Clay: "online zetten zodat ik hem overal altijd kan openen". Gekozen: Tailscale,
met de server op de Mac. Niets wordt publiek: alleen apparaten die met Clay's
account in Tailscale zitten kunnen erbij. Waarom niet een openbare server:
gedownloade YouTube-media serveren is distributie, de server heeft geen login,
YouTube blokkeert yt-dlp vanaf datacenters, en streamen over internet maakt
sprongen en loops minder strak.

## Hoe het in elkaar zit

```
iPad / laptop / telefoon ──(Tailscale, HTTPS)──> Mac: tailscale serve :443
                                                  └──> http://127.0.0.1:8777 (node server/index.js)
```

- De server luistert nog steeds alleen op 127.0.0.1. `tailscale serve` zet er
  HTTPS voor, met een echt certificaat voor `<naam>.<tailnet>.ts.net`.
- De server laat die naam alleen binnen als hij in `VARVE_HOSTS` staat
  (`vreemdVerzoek` in `server/index.js`): Host zonder poort of met :443,
  Origin `https://<naam>`. Al het andere blijft 403 (DNS-rebinding en CSRF
  zoals voorheen). `server.test.mjs` controleert het.
- **Nooit `tailscale funnel`**: dat zet hem wél publiek op internet.

## Eenmalig instellen (Clay, ongeveer 10 minuten)

1. **Tailscale op de Mac**: download van tailscale.com/download en log in
   (bijvoorbeeld met je Google-account). Zet in het menu van Tailscale de
   opdrachtregel aan ("Install CLI…"), dan werkt `tailscale` in Terminal.
2. **In de beheerpagina** (login.tailscale.com/admin):
   - DNS: **MagicDNS** aan en **HTTPS Certificates** aan;
   - Machines: geef de Mac eventueel een korte naam, bijvoorbeeld `varve`.
3. **HTTPS ervoor zetten** (blijft staan na een herstart):
   ```
   tailscale serve --bg 8777
   ```
   Vraagt hij om HTTPS-certificaten aan te zetten: volg de link (stap 2).
   Daarna meldt hij `Available within your tailnet: https://varve.tail1234.ts.net/`.
   Die naam (zonder `https://` en zonder `/`) heet hieronder `<NAAM>`; later
   terugzien kan met `tailscale serve status`.
4. **De server starten met die naam** (de oude eerst stoppen; draait hij via VARVE.app in de
   herstartlus, dan `sh tools/varve-app/server-lus.sh stop`, of `pkill` zoals hieronder: een SIGTERM
   stopt de lus ook):
   ```
   pkill -f server/index.js
   cd <projectmap>
   VARVE_HOSTS=<NAAM> UV_THREADPOOL_SIZE=16 nohup node server/index.js >> ~/.varve-server.log 2>&1 &
   ```
   In het log staat dan `ook via · https://<NAAM>`.
5. **Op elk ander apparaat**: Tailscale installeren, met hetzelfde account
   inloggen, en openen: `https://<NAAM>/companion` (iPad en iPhone, `docs/COMPANION.md`)
   of `https://<NAAM>/controle` (de Controlekamer op een groot scherm).

Uitzetten: `tailscale serve reset`. Zet ook een ACL (alleen je eigen apparaten,
`autogroup:member`, naar de Mac op 443; geen `tag:*`), zie `docs/COMPANION.md`.
Start je de server via VARVE.app, dan moet `VARVE_HOSTS` in `~/.zprofile` staan;
zonder zegt de server bij het opstarten `VARVE_HOSTS is leeg: iPad en iPhone krijgen 403`.

## "Altijd": de Mac moet aan staan

- Systeeminstellingen → Batterij (of Energie) → Opties: **"Voorkom automatische
  sluimerstand op netstroom wanneer het scherm uit is"** aan. Met de klep dicht
  op batterij slaapt een MacBook toch: dan is VARVE onbereikbaar.
- **De server blijft draaien** (15 okt, docs/WINST.md punt 3): VARVE.app start hem in een herstartlus
  (`tools/varve-app/server-lus.sh`): valt hij om, dan staat hij na ~1 s weer op, hooguit 5 keer per
  minuut; hangt hij, dan zet een wachter hem neer en start de lus hem opnieuw (AR18). Stoppen:
  `sh tools/varve-app/server-lus.sh stop`, of `pkill -f server/index.js` (een SIGTERM start de lus niet
  opnieuw). De lus is de enige weg (VRAGEN AR8, 16 okt): ook de LaunchAgent hieronder start de LUS,
  niet `node` zelf. Dan botsen ze nooit: start VARVE.app een lus terwijl die van de LaunchAgent al draait,
  dan zegt de tweede "draait al" en doet niets (het pidbestand `~/.varve/server-lus.pid`).
- De server vanzelf laten starten na een herstart van de Mac (optioneel): een LaunchAgent die de lus start.
  Zet dit in `~/Library/LaunchAgents/nl.varve.server.plist` (vul de paden in), en dan
  `launchctl load ~/Library/LaunchAgents/nl.varve.server.plist`:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>Label</key><string>nl.varve.server</string>
    <key>ProgramArguments</key><array>
      <string>/bin/sh</string><string>tools/varve-app/server-lus.sh</string>
    </array>
    <key>WorkingDirectory</key><string>/Users/<jij>/src/varve</string>
    <key>EnvironmentVariables</key><dict>
      <key>VARVE_HOSTS</key><string><NAAM></string>
      <key>UV_THREADPOOL_SIZE</key><string>16</string>
      <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>/Users/<jij>/.varve-server.log</string>
    <key>StandardErrorPath</key><string>/Users/<jij>/.varve-server.log</string>
  </dict></plist>
  ```
  Bewust GEEN `KeepAlive`: de lus herstart de server zelf, en stopt alleen met een reden (bewust gestopt,
  de poort bezet, of meer dan 5 herstarts in een minuut: een crash-lus die je moet zien). Met `KeepAlive`
  zou launchd die crash-lus eindeloos opnieuw starten. PATH moet erin: de lus roept `node` aan (en de ingest
  `yt-dlp` en `ffmpeg`), en launchd kent Homebrew niet. `UV_THREADPOOL_SIZE` ook (zoals VARVE.app): een paar
  codebestanden die macOS uit iCloud moet halen leggen anders alle decks stil (docs/WINST.md punt 4). Een
  LaunchAgent in een iCloud-map werkt slecht: eerst VARVE uit iCloud halen.
  Had je de OUDE LaunchAgent (die `node server/index.js` direct startte, met `KeepAlive`): eerst
  `launchctl unload ~/Library/LaunchAgents/nl.varve.server.plist`, het bestand vervangen door het blok
  hierboven, en dan weer `launchctl load …`.

## Wat er waar werkt

- **De app draait in de browser van het apparaat waarop je hem opent.** Het
  geluid komt uit DAT apparaat; de Mac levert alleen library, audio (in
  pagina's van ~1,4 s), video en opslag. Op afstand is een sprong naar een
  plek die nog niet binnen is iets langer stil dan thuis; video's kosten veel
  data (720p).
- **De APC werkt alleen op het apparaat waar hij in zit**, en alleen in Chrome.
  Op iPhone en iPad bestaat Web MIDI niet (elke browser daar is Safari van
  binnen), en de mixer is daar nooit getest. **Hét adres voor iPad en iPhone is
  `/companion`** (sinds 10 okt, `docs/COMPANION.md`): de kaart met wensen, kiezen
  en "haal nu", straks wat er speelt. Geen geluid, geen MIDI, geen Web Lock: hij
  stoort de mixer niet. Verder handig op een groot scherm: de Controlekamer, de
  speellijst, het planvenster.
- **Op de Mac zelf: blijf `localhost:8777` gebruiken.** `localhost` en
  `https://<NAAM>` zijn voor Chrome twee verschillende oorsprongen, met elk
  hun eigen Web Lock, BroadcastChannel en localStorage. De bescherming "maar
  één mixer praat met de APC" (`tabblad.js`) werkt dus NIET tussen die twee:
  een mixer via localhost en een via `<NAAM>` op dezelfde Mac pakken allebei
  de APC (Chrome-MIDI kan daar van crashen). Ook ziet de Controlekamer op de
  ene naam de mixer op de andere niet, en instellingen in localStorage
  (log altijd aan, `?vormen=1`, reservemapping) gelden per naam. De mapping
  op de server is wel gedeeld.
- Wie in je Tailscale-netwerk zit, kan erbij. Deel de Mac niet met anderen
  in Tailscale, of zet een ACL.
- **Onderweg** toont de tegel Avondpakket (docs/AVONDPAKKET.md) of Tailscale draait en
  of `clayk` online is, direct of via een relay. Alleen bij profiel `beeld` is dat
  verplicht: Varve zelf speelt zonder netwerk.

## Op locatie (te meten)

Drie situaties, nog niet geprobeerd (proefblok in `docs/COMPANION.md`): (a) thuis-wifi,
(b) Mac en iPad op de hotspot van de iPhone met mobiele data aan, (c) idem met mobiele
data uit. Aanname: Tailscale verbindt Mac en iPad dan direct over het hotspot-netwerk.

## Niet getest

Met een echte Tailscale. Getest is alleen de server: de checks in
`server.test.mjs` sturen de Host en Origin die `tailscale serve` aflevert (en
de variant waarin de proxy de Host op localhost zet).
