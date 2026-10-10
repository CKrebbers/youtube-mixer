# De companion: iPad en iPhone naast de laptop (10 okt 2026)

*Spoor companion (VISIE §3: "laptop, iPad, iPhone … als draagbare set"). Ontwerp:
`uitwerking/companion/5-ontwerp-definitief.md`. Gebouwd: stap 1 (de pagina). Stap 2 (de mixer
meldt zich bij de server) is ontworpen, niet gebouwd.*

Eén adres voor iPad en iPhone: **`https://<NAAM>/companion`** (via Tailscale, `docs/TAILSCALE.md`),
op de Mac zelf `http://localhost:8777/companion`. Geen tweede mixer, maar een eigen rol:

| Apparaat | Thuis (proefavond, staand scherm met de Controlekamer) | Tussen avonden | Op locatie (geen tweede scherm) |
|---|---|---|---|
| **iPad** (liggend: kaart links, nu en beeld rechts) | Een verzoekje opzoeken en op de wenslijst zetten. | **De hoofdrol**: bladeren in de kaart en de kratten, wensen, kiezen uit wat de laptop vond, "haal de wenslijst nu op". | Als thuis. |
| **iPhone** (staand, onderbalk nu · kaart · beeld) | Een extraatje: de Controlekamer staat al op het staande scherm. | De wenslijst en de speeldag-knop in de hand. | Straks (stap 2) de blik in je zak: per track wat speelt en hoe lang nog. |
| **Laptop** | Blijft de enige die geluid maakt, MIDI opent, de Web Lock heeft en binnenhaalt. | idem | idem |

## Wat er nu (stap 1) op staat

- **Kaart**: zoeken (artiest, titel), kratkiezer met een groep **bovenaan** (eerst wat je op dít
  apparaat met de ★ vastpint, dan `kratten_bovenaan` uit de indeling), de filters niet binnen /
  binnen / geen video, 50 rijen per keer met **meer**. Per rij één knop:
  - `wens` (kandidaat of alleen Spotify): op de wenslijst. De melding zegt wat er gebeurt:
    *"1 op de wenslijst · vandaag speeldag: niet vóór morgen"*, *"… · de nacht haalt hem binnen
    (01:00–07:00)"* of *"… · nacht staat uit: haal nu, of op de laptop"*.
  - `kies` (de laptop zocht en vond kandidaten): de kandidaten als knoppen onder de rij; een tik
    kiest die video en de wens wacht weer. Zonder kandidaten: "kies op de laptop".
  - `wacht`, `bezig`, `klaar`, `mislukt`, `binnen`: alleen het label. **Geen intrekken** op touch.
  - De lijst volgt de wenslijst (elke 5 s): zoekt de laptop intussen, dan krijgt de rij vanzelf `kies`.
- **Wenslijst** bovenaan de kaart: telling, stand van de nachtwachtrij en de speeldagen, en twee knoppen:
  - **haal de wenslijst nu op (n)** (n ≤ 20) via `POST /api/nacht/nu`. Uit op een speeldag, als er al
    een run loopt of als er niets wacht; de server weigert zelf ook (409, de melding toont zijn reden).
  - **vandaag speeldag**: zet vandaag (klok van de server) erbij. Alleen toevoegen; weghalen kan
    alleen op de laptop.
- **Nu**: in stap 1 *"deze server kent /api/mixer nog niet"*. De pagina vraagt `/api/mixer` na een 404
  hooguit eens per minuut opnieuw.
- **Beeld**: alleen tonen, met altijd de zin *"Varve-beeld op deze Mac · de beamer van de pc volgt dit
  niet · noodknop: APC mapje beeld"*. Geen knoppen.

## Instellen zonder code

`mappings/companion.json`:

```json
{ "versie": 1, "tabs": ["nu", "kaart", "beeld"],
  "kaart": { "kratten_bovenaan": ["slim:proefkrat", "slim:eigen-keuze", "slim:vertrouwd"] } }
```

`tabs`: welke tabs er zijn (onbekende vallen weg, met een melding). `kratten_bovenaan`: krat-id's
zoals in `varve-kaart.json`; een krat die niet op de kaart staat wordt overgeslagen. De ★ in de
kratkiezer pint per apparaat (localStorage `varve.companion.pins`), vóór de lijst uit de JSON.

## Grenzen (in code en tests vastgelegd)

- Geen `AudioContext`, geen `requestMIDIAccess`, geen Web Lock, geen BroadcastChannel, geen
  `window.opener`. Alleen `fetch` naar `/api/…` en `/mappings/companion.json`.
  `test/regels-companion.test.mjs` volgt de **hele importboom** vanaf `companion.html` en past dat op
  elk bestand toe (commentaar eruit). De boom op 10 okt: `src/companion/companion.js`,
  `companion-lijst.js`, `src/ui/kaart-lijst.js`, `library-lijst.js`, `dom.js`, `grid-strook.js`,
  `toon-weergave.js`, `stems-weergave.js`, `src/lib/emitter.js`, `src/engine/beatgrid.js`,
  `src/engine/toonsoort.js` (de laatste twee puur rekenwerk, samen ~115 kB). Niets uit `control/` of
  `koppel/`.
- Stuurt nooit `meteen`, `bevestig` of `zoek` (zoeken gaat naar YouTube: dat blijft op de laptop),
  nooit `DELETE`, en in v1 niets naar de mixer.
- De server is de bewaker van "nooit binnenhalen op een speeldag of als er een deck speelt"
  (`server/nacht.js` `nu()`); de knop op de telefoon is alleen gemak.

## Testen

```sh
node test/alles.mjs                       # o.a. companion-lijst, companion-server, regels-companion, server
node tools/headless/companion.mjs <map>   # eigen server :8805, Chromium :9405, 390×844 en 1024×768
pgrep -fl 'varve-companion|:8805|9405'    # daarna: leeg
```

Het headless-script draait op een **lege** database met de nep-kaart en de nep-yt-dlp (nooit 8777,
nooit `media/`), Chromium met `--mute-audio` en een eigen profiel, en `requestMIDIAccess`/`AudioContext`
als tellers die de echte nooit aanroepen (de APC kan aan deze Mac hangen). Waakhond 150 s; SIGINT en
SIGTERM ruimen op. Het tikt met echte aanraakgebeurtenissen. Eén blok bootst met de Fetch-laag een
melding van de mixer na (acht tracks, beeld bevroren) om te laten zien hoe "nu" straks wordt: dat is
geen proef van stap 2.

Gemeten op 10 okt (MacBook Air, met andere agenten ernaast):

| | |
|---|---|
| headless-controles | 70/70 (drie runs; de eerste 69/70 door een fout in de controle zelf) |
| laadtijd tot de kaart gevuld is, 200 ms per verzoek (Chromium-netwerkemulatie) | 1,9–2,1 s (drie runs: 2062, 2061, 1887 ms) |
| tikdoelen | alle ≥ 44 × 44 (CSS: 48) |
| Node-tests | 74 bestanden, 7255 checks, alles groen (vóór dit spoor: 71 / 7107) |
| zijwaarts scrollen op 390 en 1024 | geen |

## Eenmalig instellen (Clay, ná de proefavond, nooit op een speeldag)

1. Tailscale-app op de iPad, zelfde account. Noteer hier de iOS-versie van de iPad: ____
   (nodig: iOS 15.4 of nieuwer; een ouder apparaat krijgt dat als tekst te zien).
2. **ACL** (login.tailscale.com/admin → Access controls): alleen je eigen apparaten
   (`autogroup:member`) naar de Mac op 443; geen `tag:*`.
3. `tailscale serve --bg 8777`. Uitzetten: `tailscale serve reset`.
4. `echo 'export VARVE_HOSTS=<NAAM>' >> ~/.zprofile`, VARVE.app afsluiten en opnieuw starten via het
   Dock. VARVE.app start de server met `/bin/zsh -lc` (`tools/varve-app/VARVE.applescript` r.63), en
   een login-shell leest `~/.zprofile`. **Aanname, niet getest.** De controle: in
   `~/.varve-server.log` staat `ook via · https://<NAAM>`. Staat er
   `VARVE_HOSTS is leeg: iPad en iPhone krijgen 403`, dan klopt de aanname niet; terugval:
   `VARVE_HOSTS=<NAAM>` vóór `nohup` in de AppleScript (r.61) en de app opnieuw bouwen
   (`tools/varve-app/maak.sh`).
5. Op de iPhone `https://<NAAM>/companion` openen, "Zet op beginscherm".

Zonder `VARVE_HOSTS` zegt de server bij het opstarten nu uitdrukkelijk dat iPad en iPhone een 403
krijgen (`alleen op deze Mac · VARVE_HOSTS is leeg …`), zodat je het in het log ziet en niet pas op de
telefoon.

## Proefblok (≤ 15 min, in de wachtrij na de punten van proefavond 1)

Thuis: openen (laadtijd noteren), zoeken, wens en de melding lezen, kies na een zoek op de laptop,
de APC blijft reageren terwijl de companion open is, de speeldag-knop ontbreekt op een speeldag.
Op locatie, los van een speelavond: (a) thuis-wifi, (b) Mac en iPad op de hotspot van de iPhone met
mobiele data aan, (c) idem met mobiele data uit. Per situatie: laadtijd en of het werkt. Uitkomst hier.

## Niet (bewust, in v1)

Meters, instrumenten in "nu", intrekken van een wens, beeld-noodknoppen op touch (volgens de critici van het ontwerp, W2:
weinig gebruikt, en ze raken de beamer van de pc niet), zoeken op YouTube, een hand voor
beeld of patronen. De richting staat in het ontwerp (§7): eerst de mixer laten melden (stap 2), dan
pas opdrachten met id's.

## Niet getest

iOS Safari (`dvh`, safe-area, "zet op beginscherm", de voorproef voor oude iOS), een echte Tailscale
(alleen de Host/Origin die `tailscale serve` aflevert, nagebootst in de tests), de hotspot-situaties,
de `~/.zprofile`-route, de iOS-versie van de iPad. Getest: Node-tests en headless Chromium
(chrome-headless-shell van Playwright) met mobiele emulatie en aanraakgebeurtenissen.

## Stap 2 (ontworpen, niet gebouwd)

De mixer (alleen het tabblad met de Web Lock, alleen vanaf deze Mac) POST hooguit eens per 900 ms
`maakStatus(…)` met positie/duur/rate, `eind` (zwart/bevroren/master) en een `tab`-id naar
`POST /api/mixer`; iedereen leest `GET /api/mixer`. Dan krijgt "nu" per track titel, ▶/❚❚, "nog mm:ss",
bpm en toon, en "beeld" de stand. `nuHtml` en `beeldHtml` zijn er al (en getest); de server-kant en
`status-zender.js` niet. Raakt het mixer-tabblad: pas na de proefavond, met eigen tests.
