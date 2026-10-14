# De companion: iPad en iPhone naast de laptop (10 okt 2026)

*Spoor companion (VISIE §3: "laptop, iPad, iPhone … als draagbare set"). Ontwerp:
`uitwerking/companion/5-ontwerp-definitief.md`. Gebouwd: stap 1 (de pagina), met de herstelronde
na de review (10 okt middag), en op deze tak stap 2 (de mixer meldt zich bij de server, onderaan); het
live-pad met `index.html` is niet geproefd.*

Eén adres voor iPad en iPhone: **`https://<NAAM>/companion`** (via Tailscale, `docs/TAILSCALE.md`),
op de Mac zelf `http://localhost:8777/companion`. Geen tweede mixer, maar een eigen rol:

| Apparaat | Thuis (proefavond, staand scherm met de Controlekamer) | Tussen avonden | Op locatie (geen tweede scherm) |
|---|---|---|---|
| **iPad** (liggend: kaart links, nu en beeld rechts, die blijven staan als de kaart scrolt; staand: één kolom met onderbalk, zoals de iPhone) | Een verzoekje opzoeken en op de wenslijst zetten. | **De hoofdrol**: bladeren in de kaart en de kratten, wensen, kiezen uit wat de laptop vond, "haal de wenslijst nu op". | Als thuis. |
| **iPhone** (staand, onderbalk nu · kaart · beeld) | Een extraatje: de Controlekamer staat al op het staande scherm. | De wenslijst en de speeldag-knop in de hand. | De blik in je zak: per track wat speelt en hoe lang nog (stap 2; de mixer zelf nog niet geproefd). |
| **Laptop** | Blijft de enige die geluid maakt, MIDI opent, de Web Lock heeft en binnenhaalt. | idem | idem |

## Wat er op staat

- **Kaart**: zoeken (artiest, titel), kratkiezer met een groep **bovenaan** (eerst wat je op dít
  apparaat met de ★ vastpint, dan `kratten_bovenaan` uit de indeling), de filters niet binnen /
  binnen / geen video, 50 rijen per keer met **meer**. Per rij één knop:
  - `wens` (kandidaat of alleen Spotify): op de wenslijst. De melding zegt wat er gebeurt:
    *"1 op de wenslijst · vandaag speeldag: niet vóór morgen"*, *"… · de nacht haalt hem binnen
    (01:00–07:00)"* of *"… · nacht staat uit: haal nu, of op de laptop"*.
  - `kies` (de laptop zocht en vond kandidaten): de kandidaten als knoppen onder de rij; een tik
    kiest die video en de wens wacht weer. Zonder kandidaten: "kies op de laptop".
  - `wacht`, `bezig`, `klaar`, `mislukt`, `binnen`: alleen het label. **Geen intrekken** op touch.
  - De lijst volgt de wenslijst (elke 5 s, zolang de kaart in beeld is): zoekt de laptop intussen, dan
    krijgt de rij vanzelf `kies`; haalt de nacht of "haal nu" hem binnen, dan `klaar`.
- **Wenslijst** bovenaan de kaart: telling, stand van de nachtwachtrij en de speeldagen, en twee knoppen:
  - **haal de wenslijst nu op (n)** (n ≤ 20) via `POST /api/nacht/nu { aantal, alleenWensen: true }`:
    **alleen de wenslijst**. Zonder die vlag vulde de server een wens die op `kies` eindigde (Spotify
    zonder zekere versie) aan met een nummer uit de standaardvolgorde van de kaart, dat niemand wenste
    (review ronde 1). De melding: *"run gestart: hooguit n van de wenslijst"*; daarna zegt de knop
    *"haal nu: er loopt al een run"* tot hij klaar is. Uit op een speeldag, als er al een run loopt of als
    er niets wacht; de server weigert zelf ook (409, de melding toont zijn reden).
  - **vandaag speeldag**: zet vandaag erbij, en "vandaag" is wat de server zegt (`vandaag` in
    `GET /api/nacht`, in zíjn tijdzone), niet wat de iPhone uitrekent. Alleen toevoegen; weghalen kan
    alleen op de laptop.
- **Nu**: met stap 2 per track wat er speelt en hoe lang nog (zie onderaan); zolang de mixer zich niet
  meldt *"de mixer heeft zich nog niet gemeld"*, na 5 s stilte *"mixer meldt zich niet (op de
  achtergrond?)"* (de stand grijs, de resttijd als schatting "≈ nog"), en na 60 s *"mixer meldt zich niet ·
  laatste melding 3 min geleden"* zonder resttijden: de server houdt de laatste melding vast, ook als de
  mixer allang dicht is. Een oudere server zonder `/api/mixer` (stap 1): *"Wat er speelt komt hier zodra de mixer
  zich bij de server meldt (nog niet gebouwd). De kaart werkt wel."*; na een 404 hooguit eens per minuut opnieuw.
- **Eerste scherm**: wie de companion voor het eerst opent (geen tab bewaard), krijgt de **kaart** als de
  mixer zich niet meldt, en "nu" als hij dat wel doet. Die keuze wordt niet bewaard; een tik op een tab wel.
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

## Wat de companion de server vraagt, en hoe vaak

| Wat | Wanneer | Grootte |
|---|---|---|
| `GET /api/mixer` | elke seconde zolang de pagina zichtbaar is; na een 404 hooguit eens per minuut | klein |
| `GET /api/kaart/wensen?licht=1` + `GET /api/nacht` | elke 5 s, **alleen als de kaart in beeld is** (iPhone en iPad staand: tab kaart; iPad liggend: altijd), en meteen bij het openen van de kaart | licht: ~143 B per klare wens (gewoon: ~1,4 kB met het track-object; gemeten op de nep-kaart); met `If-None-Match`: **304 zonder body** zolang de wenslijst niet verandert |
| `GET /api/kaart/nummers` | bij zoeken, krat, filter, "meer" | 50 rijen |

De lichte wenslijst heeft een `ETag` (sha1 van de JSON, 16 tekens). De companion stuurt de laatste mee
(`If-None-Match`); zolang er niets verandert antwoordt de server `304` zonder body en blijft de lijst op
het scherm staan. Zo telt de lijst die met elke nacht groeit (80 klare wensen per nacht ≈ +11 kB) niet
elke 5 s op over een hotspot; alleen na een verandering komt hij één keer heel. De laptop (het
kaartpaneel, zonder `?licht=1`) krijgt geen ETag en verandert niet.

Niets als de pagina op de achtergrond staat (`visibilitychange`). Niet gemeten op Clay's echte wenslijst
(op de proefavond geen `media/` aanraken): na de proefavond op een kopie
`curl -s localhost:<proefpoort>/api/kaart/wensen?licht=1 | wc -c`.

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
  nooit `DELETE`, en in v1 niets naar de mixer (ook geen `POST /api/mixer`: dat doet alleen de mixer).
- De server is de bewaker van "nooit binnenhalen op een speeldag of als er een deck speelt"
  (`server/nacht.js` `nu()`); de knop op de telefoon is alleen gemak.

## Testen

```sh
node test/alles.mjs                       # o.a. companion-lijst, companion-server, regels-companion, nacht, server
node tools/headless/companion.mjs <map>   # eigen server :8805, Chromium :9405; 390×844, 1024×768 en 768×1024
```

Het script kijkt aan het eind **zelf** na dat beide poorten weer dicht zijn en dat er geen proces met
zijn eigen profiel meer draait (laatste regel: `ok  poorten 8805/9405 weer vrij, geen eigen Chromium
meer`). Met de hand, als je het wilt zien (allebei leeg = goed):

```sh
lsof -nP -iTCP:8805 -iTCP:9405 -sTCP:LISTEN
pgrep -fl 'user-data-dir=[^ ]*varve-companion-'
```

**Niet** `pgrep -fl 'varve-companion|:8805|9405'` (het oude advies): `9405`/`9415` staan toevallig in de
argumenten van de GPU-helper van Clay's eigen Chrome. Wie op dat vals alarm "de eigen pids" stopt, stopt
een stuk van Clay's Chrome (review ronde 1, fix 3).

Het headless-script draait op een **lege** database met de nep-kaart en de nep-yt-dlp (nooit 8777,
nooit `media/`), Chromium met `--mute-audio` en een eigen profiel, en `requestMIDIAccess`/`AudioContext`
als tellers die de echte nooit aanroepen (de APC kan aan deze Mac hangen). Waakhond 150 s; SIGINT en
SIGTERM ruimen op. Het tikt met echte aanraakgebeurtenissen. "Haal nu" loopt echt door de ingest
(de nep-yt-dlp "downloadt" een toon van 12 s die ffmpeg in de tmp-map maakt). Voor "nu" en "beeld" post
het script zelf meldingen naar `POST /api/mixer`, gebouwd met de echte `maakStatus`: zie "Stap 2" onderaan.

Gemeten op 10 okt (MacBook Air, met andere agenten ernaast):

| | |
|---|---|
| headless-controles | 70/70 (bouw, 13:13); na herstelronde 1 **89/89** (390, 1024, 768, haal nu echt, zelfcontrole aan het eind); na herstelronde 2 **92/92** (+ de ETag: 200, 304, 304). Op deze tak (stap 2): 94/94 na herstelronde 1, **99/99** na herstelronde 2 (+ de ETag, herladen zonder rode regel, de goot rechts) |
| laadtijd tot de kaart gevuld is, 200 ms per verzoek (Chromium-netwerkemulatie) | 1,9–2,1 s (vier runs: 2062, 2061, 1887, 2058 ms) |
| tikdoelen | alle ≥ 44 × 44 (CSS: 48), ook op 768 |
| Node-tests | zie de PR (vóór dit spoor: 71 bestanden / 7107 checks) |
| zijwaarts scrollen op 390, 768 en 1024 | geen |
| iPad liggend, kaart 683 px gescrold | "nu" staat op 59 px van boven, "beeld" eindigt op 271 px (blijft in beeld) |
| `/api/kaart/wensen` per klare wens (nep-kaart) | 1379 B gewoon, 143 B met `?licht=1` |
| dezelfde lichte lijst opnieuw, niets veranderd (herstelronde 2) | `304`, 0 B body (was 946 B voor 2 wensen); headless iPad liggend: 200, 304, 304 |

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

iOS Safari (`dvh`, safe-area, `position: sticky` in de rechterkolom, "zet op beginscherm", de voorproef
voor oude iOS), een echte Tailscale (alleen de Host/Origin die `tailscale serve` aflevert, nagebootst in de
tests), de hotspot-situaties, de `~/.zprofile`-route, de iOS-versie van de iPad, een toestel in een
andere tijdzone (de regel "vandaag van de server" is getoetst met een stand waarin de server een andere
dag zegt dan het toestel zou uitrekenen), de omvang van de wenslijst op Clay's echte `kaart.db`.
Getest: Node-tests en headless Chromium (chrome-headless-shell van Playwright) met mobiele emulatie en
aanraakgebeurtenissen.

Klein punt voor later (niet in deze PR, server-breed): zonder `VARVE_HOSTS` ziet de iPhone de kale 403
`{"fout":"onbekende host"}`; een hint in die 403 ("zet VARVE_HOSTS, docs/TAILSCALE.md") zou op de
telefoon helpen. De opstartregel dekt het op de Mac.

## Stap 2: de mixer meldt zich bij de server (tak `visie/companion-stap2`, eigen PR)

**Wat.** Het mixer-tabblad met de Web Lock (alleen dat, `statusVanMij` in `app.js`) stuurt hetzelfde
bericht dat de Controlekamer krijgt (`maakStatus`, `src/ui/status-zender.js`) ook naar
`POST /api/mixer`, met per track `positie`/`duur` (0,1 s) en `rate` (0,001), `eind`
(`{ zwart, bevroren, master }`, `eindUitActions(read)`: zwart = de schakelaar `video.black` óf de
drukvariant `video.black.hold`, ook de paniekknop van de hub, net als het eindbeeld zelf) en een `tab`-id
per laden van de pagina. iPad en iPhone lezen `GET /api/mixer` → `{ leeftijd_ms, twee, melding, speelt }`. "Nu" toont dan
per track titel, ▶/❚❚, **nog mm:ss**, bpm en toon, plus audio · APC · opname · auto-DJ; "beeld" de stand
van zwart, bevriezen en master.

**Grenzen** (`server/mixer-melding.js`, puur):
- Schrijven alleen vanaf deze Mac (`vanDezeMac`): Host `localhost`/`127.0.0.1`/`[::1]` op de eigen poort,
  Origin ontbreekt of is precies die oorsprong, en geen `x-forwarded-for` of `tailscale-user-login`
  (AANNAME: `tailscale serve` zet die; niet nagekeken op een echte tailnet). Anders 403.
- Hooguit 16 kB (`content-length` groter = 413 vóór het lezen; zonder `content-length` breekt `leesJson`
  af). Een melding met acht tracks, lange titels, een MIDI-fout en beeld: **2307 bytes** (gemeten,
  `controle.test`); met acht korte titels 1018 bytes.
- Alleen in het geheugen, niets op schijf, niets uitvoeren. `twee` = twee tab-id's die binnen 5 s **om
  beurten** melden (localhost én 127.0.0.1 open, elk met een eigen Web Lock): de companion zet dan een rode
  regel. Herladen (de oude id stopt, daarna begint een nieuwe) of de Web Lock in een tweede tabblad
  overnemen geeft geen alarm; de volgorde van binnenkomst telt, niet de klok.
- De mixer post hooguit één keer per 900 ms, nooit een tweede zolang de eerste onderweg is, met een
  eigen time-out van 900 ms (dan gewoon de volgende keer); na een 404 of een weigering 60 s rust, na een
  netwerkfout of 5xx 10 s. Er wordt nooit gewacht in de interval: niets wat de POST doet komt in de mixer
  (`test/status-zender.test.mjs`). `app.js`: 3 regels erbij en 3 gewijzigd (twee imports, `naarServer: true`, `tab`, `eind: eindUitActions(read)`).

**Getest**: `test/mixer-melding.test.mjs` (isMelding, vanDezeMac in elf gevallen, MixerStand met een
nepklok), `test/status-zender.test.mjs` (nagebouwd BroadcastChannel, fetch en klok; met een mutatie
gecontroleerd), `test/controle.test.mjs` (de nieuwe velden, de grootte), `test/companion-server.test.mjs`
(403 via de ts-naam, met een ts-Origin, een vreemde Origin, `x-forwarded-for` en `tailscale-user-login`;
415, 413, chunked 17 kB, 400, `twee` om beurten wel en na een herladen niet, GET via de ts-naam) en
headless: het **script** post meldingen (gebouwd met de echte `maakStatus`) en de companion toont acht rijen,
A "nog 49:59" (of "nog 50:00" als de melding in dezelfde milliseconde terugkomt: 600 van 3600 is precies
3000 s), H op 1,05× "nog 3:10", BEVRIES aan · MASTER 80 %, na ~4–5 s stilte "mixer meldt zich niet"
(grijs, "≈ nog"), bij een herladen 3 s lang géén rode regel, en de rode regel bij twee tab-id's om beurten
(`companion-390-nu.png`, `companion-1024-vol.png`). `eindUitActions` met de echte action-bus en een echt
`Eindbeeld`: de drukvariant ingedrukt = de zaal zwart = `eind.zwart` (`test/status-zender.test.mjs`).

**NIET getest, bewust (ontwerp H2)**: de mixer zelf (`index.html` met `app.js`) heeft nog nooit gepost.
Dat raakt het Lock-tabblad en wacht tot na de proefavond: één extra tabblad met `index.html` van een
EIGEN proefserver (MIDI omwikkeld, `--mute-audio`, geen demotrack), en dan `GET /api/mixer` met
`leeftijd_ms < 2000` en een `tab`. Ook niet gemeten: wat een POST per 900 ms kost in een echte set (een
`JSON.stringify` van ~1–2 kB per seconde op de hoofdthread; het audiopad wordt niet geraakt).

Op de iPad liggend is "nu" met acht tracks plus "beeld" hoger dan 768 px: de rechterkolom scrolt dan zelf
(hij blijft wel staan als de kaart scrolt), met een vaste goot voor de schuifbalk (`scrollbar-gutter:
stable`, 6 px ruimte): de resttijd loopt niet onder de balk (in Chromium gemeten; op iOS is de balk een
overlay).
