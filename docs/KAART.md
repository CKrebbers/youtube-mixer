# De muziekkaart in Varve: zoeklaag, wenslijst, nachtwachtrij (serverkant)

Gebouwd op 10 oktober 2026 op `studio/kaart-server`, naar het contract van die
dag (`CONTRACT-KAART.md` in de scratchpad van de sessie; de kern staat hier). De
UI (tab `kaart` in het library-paneel) is een ander spoor (`studio/kaart-ui`),
lokale bestanden ook (`studio/kaart-lokaal`). Dit document is de serverkant.

## 1. Wat het is

De muziekkaart (`~/Projects/muziekkaart`) weet alles wat Clay ooit draaide:
18 duizend nummers uit YouTube-geschiedenis en Spotify-exports, met beurten,
likes, playlists en een klasse (muziek of twijfel). Varve krijgt dat als ÉÉN
bestand, `varve-kaart.json`, en gebruikt het als **zoeklaag**: je zoekt en
bladert in de hele kaart, maar er staat 0 bytes op schijf per nummer tot je
"haal binnen" zegt. Binnenhalen gaat per nummer of per krat, **alleen audio**
(loudness, peaks, onset, grid, toon; geen video, geen stems), of 's nachts in
een trage wachtrij met rem.

Drie bestanden, allemaal NAAST de library, nooit erin:

| | |
|---|---|
| `varve-kaart.json` | geschreven door de muziekkaart; Varve leest alleen. Pad: instelling `kaart_pad` (tabel `instellingen` van de library), anders `VARVE_KAART`, anders `~/Desktop/3. Resources/Data/Muziekkaart/varve-kaart.json`. |
| `media/kaart.db` | eigen SQLite (node:sqlite, `KAART_SCHEMA` met `user_version`): tabellen `wensen` en `nacht_runs`. `VARVE_KAART_DB` voor tests. |
| `media/nacht.json` | de instellingen van de nachtwachtrij (atomisch geschreven, `.tmp` dan hernoemen). `VARVE_NACHT` voor tests. |

`library.db` en zijn `SCHEMA` zijn **niet** gewijzigd. Of een nummer binnen is,
weet de kaart door `tracks.id` te vergelijken met `youtube_id` (één
`SELECT id FROM tracks` per verzoek, een paar ms; alternatieven tellen NIET mee,
zoals het contract zegt).

## 2. Het bestand en de index

`server/kaart.js` leest het bestand bij het eerste verzoek en daarna opnieuw
zodra de mtime verandert (een `stat` per verzoek; het lezen van 10 MB JSON,
~50–100 ms, gebeurt alleen bij een verandering). Een kapot bestand = status
`fout` met de reden, de vorige kaart blijft bruikbaar; geen bestand = status
`ontbreekt` met lege slimme kratten.

Elk nummer gaat door `normaliseerNummer`: elk veld uit het contract bestaat
(onbekend = `null`, `[]`, `{}`), het `zoek`-veld wordt gemaakt als het ontbreekt
(kleine letters, zonder accenten), en er komen twee niet-zichtbare
sorteersleutels bij (titel en artiest zonder accenten).

De index staat in het geheugen: een array in de volgorde van het bestand, een
`Map` op sleutel, de kratten als `Set`s. Sorteren gebeurt één keer per
(sortering, richting) en wordt bewaard tot het bestand verandert; zoeken en
filteren lopen over de gesorteerde lijst en pakken dan de pagina. Gemeten in de
test op 18.763 verzonnen rijen (M-serie Mac, container druk): laden ~55 ms,
eerste sortering ~7 ms, een pagina van 100 ~1 ms, zoeken + filteren ~17 ms,
`GET /api/kaart` (telt per krat hoeveel binnen is) ~5 ms.

De zeven slimme kratten komen uit het bestand. Mist het bestand er een (een
oudere kaart), dan komt hij uit dezelfde regels in `SLIM`, zodat filters en de
nacht altijd werken. `test/kaart.test.mjs` controleert dat de regels in `SLIM`
gelijk zijn aan die van de fixture.

## 3. API (contract §2)

Alles onder `/api/kaart` en `/api/nacht`, dezelfde foutstijl als de rest:
400/404/409 met `{ fout, … }`, 415 zonder `application/json`, 403 bij een
vreemde Origin.

- `GET /api/kaart` → `{ status, pad, gebouwd, bron, aantal, fout, kratten: [{ id, naam, soort, regel, bijgewerkt, aantal, binnen }] }`.
- `GET /api/kaart/nummers?zoek=&krat=&filter=&sorteer=&richting=&van=&aantal=` →
  `{ nummers: [nummer + { binnen, wens }], totaal, van, status }`.
  - `sorteer`: `beurten` (standaard, af), `laatst` (af), `titel` (op), `artiest` (op),
    `duur` (op), `like_datum` (af), `gekeken` (af); onbekend = 400. Wat geen waarde
    heeft staat altijd achteraan. Gelijk = de volgorde van het bestand.
  - **Extra, niet in het contract:** `sorteer=krat` = de volgorde van de krat zelf
    (een playlist in volgorde van toevoegen, eigen likes op like_datum). Met een
    `krat` en zonder `sorteer` is dát de standaard; met `sorteer=beurten` krijg je
    beurten. Zonder krat is `sorteer=krat` een 400.
  - `filter`: `binnen`, `niet-binnen`, `geen-video`, en de slimme `vertrouwd`,
    `vergeten`, `evergreens`, `geliket-nooit-gespeeld`, `eigen-keuze`, `eigen-likes`
    (= lid van die krat); meerdere met komma = en. Onbekend = 400.
  - `krat=<id>`: alleen die sleutels; onbekend = 404.
  - `zoek`: substring in het `zoek`-veld, én in artiest en titel apart, zonder
    accenten; `%` en `_` zijn gewone tekens.
  - `van` (vanaf 0), `aantal` (1..500, standaard 100), zoals `/api/library`.
  - Zonder geladen kaart: 404 `{ fout: "kaart ontbreekt…", status, pad }`.
- `GET /api/kaart/nummer/<sleutel>` → `{ nummer }` met `binnen` en `wens`, of 404.
- `POST /api/kaart/wens { sleutels, meteen, bevestig }` → `{ ok, toegevoegd, geweigerd: [{ sleutel, reden }], gestart? }`.
  - > 20 sleutels zonder `bevestig: true` → 409 `{ fout: "meer dan 20", aantal }`.
  - Geweigerd met reden: `dubbel in de vraag`, `niet op de kaart`, `al binnen`,
    `staat al op de lijst (<status>)`. Een `mislukt`e of `geannuleerd`e wens mag opnieuw.
  - `meteen: true`: 409 `{ fout: "er speelt een deck" }` als er een deck speelt;
    anders gaan de toegevoegde sleutels MET youtube_id meteen de bestaande
    ingest-rij in (`video: false`, `stems: 0`), status `bezig` → `klaar`/`mislukt`.
    **Extra veld** `gestart: [sleutels]` zegt welke dat waren; `sp:`-sleutels zonder
    video komen gewoon op `wacht` (eerst zoeken, of de nacht doet het).
- `DELETE /api/kaart/wens/<sleutel>` → `{ ok }` (ook een `bezig`e: de ingest loopt dan gewoon af).
- `GET /api/kaart/wensen` → `{ wensen: [{ sleutel, status, gevraagd, youtube_id, fout, track, bron, bijgewerkt, kandidaten, nummer: { artiest, titel } }] }`,
  oudste eerst. `track` = de library-track als hij binnen is. **Extra:** `bron` is
  `wens` (Clay) of `nacht` (door de standaardvolgorde opgepakt; zie §4), `kandidaten`
  het laatste zoekresultaat, `nummer` artiest en titel voor de lijst.
  Status: `wacht` | `zoekt` | `kies` | `bezig` | `klaar` | `mislukt` | `geannuleerd`.
- `POST /api/kaart/nummer/<sleutel>/zoek` → `{ kandidaten: [{ youtube_id, titel, kanaal, duur, score, reden }], vraag }`,
  beste eerst. 409 als er een deck speelt, 404 onbekende sleutel, 502 `{ fout: "zoeken mislukt: …" }`
  met de regel van yt-dlp erin. Een wens die `wacht` gaat via `zoekt` naar `kies`
  (met de kandidaten erbij); zonder wens verandert er niets.
- `POST /api/kaart/nummer/<sleutel>/kies { youtube_id }` → `{ ok, wens }`: de wens
  krijgt die id en staat (weer) op `wacht`; zonder wens komt er een. 400 bij een
  onzinnige id, 404 onbekende sleutel.
- `GET /api/nacht` → `{ aan, venster: { van, tot }, perNacht, pauze: { min, max }, vandaagNiet, speeldagen, laatsteRun: { begonnen, klaar, gehaald, mislukt, reden, soort } | null, volgende, bezig, standaardVolgorde, nu }`.
  **Extra:** `nu` (de klok van de server, ISO) en `laatsteRun.soort` (`nacht` | `nu`); `bezig` is
  `{ id, begonnen, soort, aantal, gehaald, mislukt, huidig }` of null.
- `POST /api/nacht` (gedeeltelijk: `aan`, `perNacht` 1..1000, `venster`, `pauze` in s,
  `speeldagen` (lijst `JJJJ-MM-DD`), `vandaagNiet` (boolean), `standaardVolgorde`) → de
  nieuwe stand; onzin = 400 `{ fout }`. Opslag `media/nacht.json`.
- `POST /api/nacht/nu { aantal }` → 202 met de stand (`bezig` gevuld); de run loopt
  door op de achtergrond. 409 `{ fout }` als er al een run loopt, een deck speelt
  of vandaag een speeldag is (ook de nacht ná een speeldag, zie §4). `aan` hoeft
  niet voor `nu`: dat is waar hij voor is (proberen).
- `POST /api/nacht/stop` → `{ ok, …stand }`: stopt na het lopende nummer.
- **Extra:** `GET /api/nacht/runs` → `{ runs }`, de laatste 30 uit `nacht_runs`.

### De score van een zoekresultaat

`yt-dlp "ytsearch5:<artiest> <titel>" --flat-playlist -J --no-warnings`, zonder
enige cookie-optie, hooguit 60 s. Per kandidaat: Topic-kanaal of kanaal == artiest
(ook `<artiest>VEVO`) 0,35 · lengte binnen 2 s van `duur` 0,4 (binnen 5 s 0,2) ·
titel bevat de titel 0,25. Alles raak = 1,0; twee van de drie komt nooit boven
`ZEKER` (0,9), en zonder bekende `duur` is "zeker" onbereikbaar: dan kiest Clay.
`reden` zegt wat er raak was ("Topic-kanaal, zelfde lengte, titel klopt").

## 4. De nachtwachtrij (`server/nacht.js`)

Standaard **uit**. De zes regels van het contract en hoe ze hier zitten:

1. **Alleen in het venster (01:00–07:00), alleen als `aan`, nooit op een speeldag
   of als `vandaagNiet`.** `magNu()`. Een "nacht" hoort bij een DATUM:
   `nachtDatum` = vóór 12:00 de dag ervóór. Zo is 03:00 op 11 oktober de nacht
   van 10 oktober (de proefavond), en geldt `speeldagen: ["2026-10-10"]` ook voor
   die nacht. `vandaagNiet` wordt bewaard als die nachtdatum en loopt vanzelf af;
   om 22:00 aangezet geldt het voor de nacht die komt. Per nacht één run: ook
   als die stopte (deck, 403) gaat hij pas de volgende nacht verder. Een
   serverherstart onthoudt dat via `nacht_runs`.
2. **Eerst de wensen (`wacht`, oudste eerst), dan de standaardvolgorde**:
   `slim:vertrouwd` op beurten, dan `slim:eigen-likes` op beurten. Nooit wat al
   binnen is of al een wens-rij heeft (ook `mislukt`: niet elke nacht opnieuw),
   nooit `twijfel`, nooit vorm `set`/`stream`/`lang`/`album`, nooit > 15 min,
   alleen met youtube_id. "Nooit overzet-only" volgt vanzelf (de likes-tak neemt
   alleen `eigen`; een vertrouwd nummer met een overzet-like is vertrouwd om zijn
   beurten). Een WENS mag wél een set of 40 minuten zijn: Clay vroeg het. Wat de
   standaardvolgorde oppakt krijgt een wens-rij met `bron: 'nacht'`.
   `standaardVolgorde: false` = alleen wensen.
   Een wens zonder video (Spotify): de nacht zoekt eerst (§3). Score ≥ 0,9 =
   kiezen en halen; anders status `kies` met de kandidaten, en Clay kiest later.
   Nooit gokken.
3. **Eén nummer tegelijk door de bestaande ingest-Wachtrij** (`haalKaartNummer` in
   index.js: `nieuweLink` met `video: false`, `stems: 0`; hij peilt de opdracht tot
   die af is). **Tussen twee nummers een willekeurige pauze** van `pauze.min`–`pauze.max`
   s (standaard 20–90); na het laatste niet.
4. **Stopt zodra er een deck speelt**: gecontroleerd vóór elk nummer; het lopende
   nummer wordt afgemaakt (een halve ingest ruimt zichzelf op, maar dan is de
   download voor niets geweest). `reden: "er speelt een deck"`.
5. **HTTP 403/429 of drie mislukkingen op rij: stop** met `reden`, deze nacht niet
   meer. `isBlokkade` herkent 403, 429, "forbidden", "too many requests", "rate limit",
   "sign in to confirm". Een 403 bij het ZOEKEN telt ook. Geen enkele cookie-optie:
   `test/kaart.test.mjs` grept alle `server/*.js` op een cookie-optie als argument
   (de hint in links.js die zegt dat het er bewust niet in zit, is geen argument),
   en de servertest kijkt in het log van de nep-yt-dlp.
6. **Elke run in `nacht_runs`** (soort, begonnen, klaar, gehaald, mislukt, reden) en
   in het serverlog (`[nacht] …`).

De klok wordt elke minuut gepeild (`PEIL_MS`); `POST /api/nacht/nu` is dezelfde
run met `soort: 'nu'` (negeert venster en `aan`, niet de speeldag of een deck).

## 5. "Er speelt een deck": de keuze

De server weet niet wat de engine doet; hij ziet alleen zijn eigen verzoeken.
Een deck STREAMT zijn geluid (`StreamBron`, CLAUDE.md "Bekende grenzen"): Range-
verzoeken op `/media/<id>/audio.wav` of `stems.wav`, pagina's van ~1,4 s, zolang
hij speelt of vooruit buffert. Daarom zet `statisch()` in index.js bij elk
Range-verzoek op zo'n bestand `laatstGestreamd = Date.now()`, en
`speeltDeck()` = minder dan 30 s geleden (`SPEELT_MS`).

Wat dat betekent:
- een deck dat net gepauzeerd of net geladen is telt nog een halve minuut als
  spelend (liever te voorzichtig: een download naast een set is erger dan een
  download die een halve minuut wacht);
- een los bestand of de demotrack (uit het geheugen van de browser,
  `geheugenHaal`) ziet de server NIET; en een deck van een andere server (de
  proefserver op 8778) ook niet;
- het eerste verzoek zonder Range (de kop van het bestand) telt niet mee.

Alternatieven die het niet werden: de UI laten melden dat er gespeeld wordt
(een extra verzoek per toestandswissel, en een tabblad dat dichtgaat meldt niets
meer), of `laatst_geladen` uit de library (zegt niets over spelen).

## 6. Wat erbij veranderde in bestaande code

- `server/index.js`: `nieuweLink(tekst, { opnieuw, stems, video })` heeft `video`
  erbij (standaard `true`, zoals het was; `stappenVoor` volgt mee). Nieuw:
  `haalKaartNummer`, `speeltDeck`, `kaartRoute`, de regel in `statisch()`, en de
  kaart en de nacht bij het opstarten (één logregel). Niets anders.
- `test/nep-ytdlp.mjs`: kent `ytsearch5:` (vijf kandidaten, de eerste past;
  "kapot" = fout, "geblokkeerd" = 403).

## 7. Tests

- `test/kaart.test.mjs` (puur, fixture `test/nep-kaart.mjs`): laden/herladen/kapot/
  ontbreekt, normaliseren, zoeken, alle filters, alle sorteringen, pagineren zonder
  overlap, de 400/404's, snelheid op 18.763 rijen, wensen (grens van 20, dubbel, al
  binnen, opnieuw na mislukt, herstart), score en zoeken met een ingeprikte zoeker
  (404/502, kies), de standaardvolgorde met elke uitsluiting, nacht_runs, en de
  cookie-bewaker over `server/*.js`.
- `test/nacht.test.mjs` (puur, nepklok): tijd en venster, standaard uit, regel 1 t/m 6
  één voor één (speeldag ook de nacht erna, vandaagNiet loopt af, één tegelijk,
  pauze 55 s bij toeval 0,5, stop na het lopende nummer bij een deck, 403/429/3× op
  rij, teller opnieuw na succes, deze nacht niet opnieuw / volgende nacht wel,
  nacht_runs en log, herstart), stop, nu op een speeldag, zoeken in de nacht (zeker
  / onzeker / 403 / zonder zoeker), opslag in nacht.json.
- `test/kaart-server.test.mjs` (echte server, nep-yt-dlp, geen netwerk): alle routes
  en foutcodes, kaart.db/nacht.json niet via HTTP, een nummer door de echte ingest-
  rij zonder video en zonder cookie-optie, een nachtrun van één nummer via
  `/api/nacht/nu`, "er speelt een deck" via een echt Range-verzoek (zoek, meteen en
  nu geven 409), herstart (wensen en instellingen blijven), zonder kaartbestand.

Rooktest 10 okt zonder netwerk en zonder de echte library: de server uit deze
worktree op poort 8781 met een KOPIE van `media/library.db` (+ -wal/-shm) en het
echte `varve-kaart.json` van die ochtend (18.233 nummers, 29 kratten): `GET
/api/kaart`, `/api/kaart/nummers?zoek=four&aantal=5` en `/api/nacht` antwoorden
zoals hierboven. Niets binnengehaald.

## 8. Niet getest / open

- Niet met een echte yt-dlp op het netwerk: het zoeken (`ytsearch5`) en een echte
  download zijn alleen met de nep gedaan. Of YouTube `ytsearch` zonder cookies
  laat lopen op Clay's IP, en wat hij bij een 403 precies zegt, is een aanname
  (`isBlokkade`). Eerste echte nacht: `perNacht` klein zetten en het log lezen.
- Niet op Clay's echte server (8777) en niet met een spelend deck in Chrome; de
  30 s-regel is op een Range-verzoek met curl getoetst.
- Een lopende ingest wordt bij "er speelt een deck" NIET geannuleerd (de run stopt
  ná dat nummer). Annuleren kan (de wachtrij kan het), maar een halve download
  weggooien terwijl Clay al speelt helpt de set niet meer; niet gebouwd.
- De kaart wordt per verzoek op mtime gecontroleerd; schrijft de muziekkaart het
  bestand niet atomisch (eerst `.tmp`, dan hernoemen, zoals het contract zegt), dan
  kan één verzoek een half bestand lezen → status `fout`, volgend verzoek goed.
- `binnen` kijkt alleen naar `youtube_id`, niet naar `alternatieven` (contract).
  Een nummer waarvan een alternatieve video binnen is, telt als niet binnen. Open
  voor de integrator als dat vaak voorkomt.
- `slim:proefkrat` komt uit het bestand (15 sleutels op 10 okt); de server doet er
  niets bijzonders mee.
- De UI-agent heeft nodig: `GET /api/kaart` voor de kratkiezer (met `aantal` en
  `binnen`), `/api/kaart/nummers` voor de lijst (zelfde paginatie als de library),
  `wens.status` per rij, `POST /api/kaart/wens` met `bevestig` na de 409 en `meteen`
  voor "haal binnen", `/zoek` + `/kies` voor het kieslijstje (score ≥ 0,9 = meteen
  gekozen door de UI zelf; de server kiest alleen in de nacht), `/api/nacht` en
  `/api/kaart/wensen` voor het blok Nachtwachtrij. "Haal binnen" uitgeschakeld terwijl
  een deck speelt weet de UI uit de engine; de server zegt het ook (409).
