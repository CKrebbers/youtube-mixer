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
4. **De server starten met die naam** (de oude eerst stoppen):
   ```
   pkill -f server/index.js
   cd <projectmap>
   VARVE_HOSTS=<NAAM> nohup node server/index.js >> ~/.varve-server.log 2>&1 &
   ```
   In het log staat dan `ook via · https://<NAAM>`.
5. **Op elk ander apparaat**: Tailscale installeren, met hetzelfde account
   inloggen, en openen: `https://<NAAM>/controle`.

## "Altijd": de Mac moet aan staan

- Systeeminstellingen → Batterij (of Energie) → Opties: **"Voorkom automatische
  sluimerstand op netstroom wanneer het scherm uit is"** aan. Met de klep dicht
  op batterij slaapt een MacBook toch: dan is VARVE onbereikbaar.
- De server vanzelf laten starten na een herstart (optioneel): een LaunchAgent.
  Zet dit in `~/Library/LaunchAgents/nl.varve.server.plist` (vul de drie
  paden in; `which node` geeft het eerste), en dan
  `launchctl load ~/Library/LaunchAgents/nl.varve.server.plist`:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>Label</key><string>nl.varve.server</string>
    <key>ProgramArguments</key><array>
      <string>/opt/homebrew/bin/node</string><string>server/index.js</string>
    </array>
    <key>WorkingDirectory</key><string>/Users/<jij>/src/varve</string>
    <key>EnvironmentVariables</key><dict>
      <key>VARVE_HOSTS</key><string><NAAM></string>
      <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/Users/<jij>/.varve-server.log</string>
    <key>StandardErrorPath</key><string>/Users/<jij>/.varve-server.log</string>
  </dict></plist>
  ```
  PATH moet erin: de ingest roept `yt-dlp` en `ffmpeg` aan, en launchd kent
  Homebrew niet. Een LaunchAgent in een iCloud-map werkt slecht: eerst VARVE
  uit iCloud halen.

## Wat er waar werkt

- **De app draait in de browser van het apparaat waarop je hem opent.** Het
  geluid komt uit DAT apparaat; de Mac levert alleen library, audio (in
  pagina's van ~1,4 s), video en opslag. Op afstand is een sprong naar een
  plek die nog niet binnen is iets langer stil dan thuis; video's kosten veel
  data (720p).
- **De APC werkt alleen op het apparaat waar hij in zit**, en alleen in Chrome.
  Op iPhone en iPad bestaat Web MIDI niet (elke browser daar is Safari van
  binnen), en de mixer is daar nooit getest. Daar zijn vooral handig: de
  Controlekamer, de speellijst, het planvenster, en links plakken in de
  ingest (de Mac haalt ze binnen).
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

## Niet getest

Met een echte Tailscale. Getest is alleen de server: de checks in
`server.test.mjs` sturen de Host en Origin die `tailscale serve` aflevert (en
de variant waarin de proxy de Host op localhost zet).
