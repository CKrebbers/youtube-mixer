# De muziekkaart in Varve: zoeklaag, wenslijst, nachtwachtrij, lokale import

Gebouwd op 10 oktober 2026 in drie sporen naar het contract van die dag
(`CONTRACT-KAART.md` in de scratchpad van de sessie; de kern staat hier):
de serverkant (`studio/kaart-server`, dit document §1–6), de UI (`studio/kaart-ui`,
tab `kaart` in het library-paneel: `docs/LIBRARY.md` "De kaart-tab") en de lokale
bestanden (`studio/kaart-lokaal`, `tools/lokaal/LEESMIJ.md`). Samengevoegd op
`studio/kaart` (PR naar `studio/integratie`); de afspraken tussen UI en server
die bij het samenvoegen zijn rechtgetrokken staan in §3b, de cijfers van het echte
bestand in §9, wat Clay na de proefavond doet in §10.

Het echte bestand van 10 okt (09:47): **18.233 nummers** (9.753 met YouTube-video,
8.480 alleen Spotify), **29 kratten** (22 playlists + 7 slimme), 10,7 MB. Het
contract rekende met 18.763 rijen en 23 playlists; de kaart zelf heeft "Watch
later" en een paar lege playlists weggelaten. Slim: vertrouwd 835, eigen likes
771, geliket-nooit-gespeeld 507, vergeten 204, evergreens 103, eigen keuze 57,
proefkrat 15. Veel playlists zijn leeg (AI, Games, Podcast, …: geen muziek).

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

### 3b. De afspraken met de UI (samengevoegd 10 okt)

Zes punten waar de UI-agent en de server-agent elkaar niet hadden gezien, met de
keuze (de server is de waarheid, tenzij de UI-keuze beter was) en de test die het
bewaakt (`test/kaart-server.test.mjs` "wat de UI stuurt", `test/kaart-lijst.test.mjs`
voor de nep):

a. **`POST …/kies` zonder bestaande wens** maakt een wens aan op `wacht` (de UI
   verwachtte dat; `kaart.kies` deed het al). Vastgelegd met een HTTP-test, ook met
   een percent-gecodeerde sleutel.
b. **`GET /api/kaart/wensen[].track`** is de library-track als OBJECT (met `id`,
   `titel`, `video`, …) of `null`; nooit een string. De UI las beide; de nep gaf een
   string en geeft nu een object. De UI leest `track` nergens (de laadknoppen komen
   van `binnen` per rij), dus alleen de nep en de test zijn veranderd.
c. **`sorteer=krat`** (de volgorde van de krat zelf) bestaat nu ook in de UI: met
   een krat gekozen komt vooraan een kolom `krat` (sorteerbaar, toont het rangnummer
   zolang daarop gesorteerd is). Een krat kiezen met de STANDAARDsortering (beurten
   af) schakelt naar de kratvolgorde, zoals de server zonder `sorteer`; een eigen
   keuze (titel, laatst, …) blijft staan. Zonder krat valt een bewaarde `krat`-
   sortering terug op beurten (de server geeft anders 400). De nep kent hem ook.
d. **409-teksten** zijn letterlijk gelijk: `meer dan 20` (met `aantal`) en
   `er speelt een deck`. De UI test op `/meer dan 20/` en toont de andere als tekst.
e. **De krat op de wenslijst**: de UI haalt `?krat=&filter=niet-binnen&aantal=500`
   zelf op (in pagina's) en stuurt de sleutels; de server geeft daarbij ook de
   `sp:`-sleutels zonder video, en `POST /api/kaart/wens` zet die gewoon op `wacht`
   (de nacht zoekt dan eerst een versie). Getest op `slim:eigen-likes`.
   De nep weigerde een `sp:`-sleutel bij `meteen: true` ("eerst zoeken"); de server
   zet hem op `wacht` en meldt in `gestart` wat wél meteen ging. De nep doet dat nu ook.
f. **De naam van een krat** komt uit het bestand (`naam`, met hoofdletter:
   "Proefkrat", "Vertrouwd"): `GET /api/kaart` geeft hem door en de UI toont hem zo in
   de kiezer en de status. De fixture van de UI had kleine letters; dat is alleen data.

Erbij gevonden bij het samenvoegen:
- **Percent-gecodeerde sleutels.** De UI stuurt `encodeURIComponent(sleutel)`
  (`yt%3Aabc`); `url.pathname` decodeert niet, dus de routes `/api/kaart/nummer/…`,
  `…/zoek`, `…/kies` en `DELETE /api/kaart/wens/…` gaven 404. `kaartRoute` decodeert
  het pad nu eerst (onleesbaar = 400). Zonder deze fix werkte "haal binnen" in de
  echte app niet (de rij werd daarna niet opnieuw opgehaald).
- **`GET /api/kaart/nummer/<sleutel>` geeft `{ nummer }`**; de nep gaf het nummer
  kaal en de UI las dat. De UI leest nu `j.nummer ?? j`, de nep geeft `{ nummer }`.
- De nep volgt verder de server in: de redenen van `geweigerd` (`dubbel in de
  vraag`, `niet op de kaart`, `al binnen`, `staat al op de lijst (<status>)`),
  `DELETE` zonder wens = 200 `{ ok: false }`, `POST /api/nacht/nu` = 202 met de stand,
  `GET /api/nacht` met `nu`, lege `sleutels` = 400.
- Het nachtblok toont nu ook de **speeldagen** ("speeldagen: 10 okt (vandaag)"),
  zodat je op een proefavond ziet dat de nacht erna overslaat.

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

- `test/kaart-lijst.test.mjs` (UI, puur + de nep): kolommen, badges, stand → knop,
  filters, kratkiezer, `sorteer=krat` (effectieveSortering, sorteringBijKrat,
  kolommenVoor), speeldagenTekst, bevestiging, kieslijst, nachtteksten, en de nep
  (`tools/headless/kaart-nep.mjs`) tegen dezelfde vormen als de server.
- `test/lokaal-importeer.test.mjs` en `test/upload.test.mjs`: de lokale import
  (`tools/lokaal/kies.mjs`) en `?video=0`, `?titel=`, `?artiest=` op `/api/upload`.
- Headless: `tools/headless/kaart.mjs` (de UI op de nep, zonder serverkant, voor
  ontwikkeling; 65 checks) en `tools/headless/kaart-echt.mjs` (de UI tegen de ECHTE
  routes van een server die al draait; 31 checks; zie §9).

Eerste rooktest 10 okt (serverkant alleen, poort 8781): `GET /api/kaart`,
`/api/kaart/nummers?zoek=four&aantal=5` en `/api/nacht` op het echte bestand. De
volledige rooktest na het samenvoegen staat in §9.

## 8. Niet getest / open

- **Clay's eigen Chrome** (alleen de headless shell), **de APC en de Maschine**
  (de kaart heeft bewust geen knoppen op de controllers), **niets beluisterd**.
- **Een echte yt-dlp op het netwerk**: het zoeken (`ytsearch5`) en elke download
  zijn alleen met `test/nep-ytdlp.mjs` gedaan, ook in de rooktest van §9. Of
  YouTube `ytsearch` zonder cookies laat lopen op Clay's IP, en wat hij bij een 403
  precies zegt, is een aanname (`isBlokkade`). Daarom §10: de eerste nacht klein.
- **De 30 s-regel met een echt deck**: "er speelt een deck" is getoetst met een
  Range-verzoek (curl, servertest) en in de UI met de engine-stand (nep-headless);
  niet met een deck dat in Clay's Chrome echt streamt tegen de echte routes.
- **De lokale import echt draaien**: alleen de droogloop (24 nieuw, 3 al binnen, 11
  Spotdownloader-mp3's onleesbaar) en de testserver; §10.
- Niet op Clay's echte server (8777): de rooktest draaide op 8782 met een kopie.
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
- De UI gebruikt: `GET /api/kaart` voor de kratkiezer (met `aantal` en `binnen`),
  `/api/kaart/nummers` voor de lijst (zelfde paginatie als de library), `wens.status`
  per rij, `POST /api/kaart/wens` met `bevestig` na de 409 en `meteen` voor "haal
  binnen", `/zoek` + `/kies` voor het kieslijstje (score ≥ 0,9 = meteen gekozen door
  de UI zelf; de server kiest alleen in de nacht), `/api/nacht` en `/api/kaart/wensen`
  voor het blok Nachtwachtrij. "Haal binnen" uitgeschakeld terwijl een deck speelt
  weet de UI uit de engine; de server zegt het ook (409). Zie §3b.

## 9. Gemeten (10 okt, na het samenvoegen, op het echte bestand)

De samengevoegde server uit de worktree `studio/kaart` op poort 8782, met een KOPIE
van Clay's `media/library.db` (+ `-wal`/`-shm`, 15 nummers) in een scratchmap, de
nep-yt-dlp (`VARVE_YTDLP`, `NEP_BRON` = een synthetische wav van 12 s, `NEP_LOG`) en
het echte `varve-kaart.json` (18.233 nummers, 29 kratten). Niets van YouTube, de
Bureaublad-map en 8777 niet aangeraakt. M-serie Mac, container rustig.

Server (curl, `time_total`, warm):

| | |
|---|---|
| kaart laden bij de start | 62–70 ms (10,7 MB JSON, log `[kaart] 18233 nummers, 29 kratten geladen`) |
| pagina van 100 (beurten af) | 2,2–2,5 ms (eerste 6,9 ms) |
| pagina van 100 op titel, `van=9000` | 1,5 ms (eerste keer 19,7 ms: de sortering wordt één keer gemaakt) |
| zoeken `four` (135 treffers) | 4,5–5,0 ms |
| krat proefkrat (kratvolgorde, 15) | 0,9–1,0 ms |
| krat Musicc (340) `niet-binnen`, 500 per pagina | 4,0 ms |
| `GET /api/kaart` (telt per krat wat binnen is) | 1,3 ms |
| `GET /api/kaart/wensen` | 0,9 ms |
| geheugen van de server (RSS) | 155 MB na het laden, 168 MB na de metingen, 116 MB na de rooktest (GC) |

UI (`tools/headless/kaart-echt.mjs`, headless Chromium, 1440×900):

| | |
|---|---|
| tab kaart → de rijen staan er (18.233 in de status) | 62–80 ms na de klik |
| typen `four` → "135 gevonden" | 158–162 ms (waarvan 120 ms wachten op het typen) |
| "haal binnen" → wens `klaar`, rij `binnen` | 2,0–2,1 s (nep-download, ffmpeg, peaks, grid, toon) |

Rooktest (`kaart-echt.mjs`, 31 checks, alles groen; foto's in de scratchmap
`kaart-integratie/kaart-echt-*.png`): de tab opent met 18.233 nummers, ≤ 30 rijen
in de DOM, scrollhoogte 18.233 × 28, de kratkiezer heeft alle 29 kratten met de
naam uit het bestand en het aantal, zoeken `four` → 135 (dezelfde eerste rijen als
de API), krat Proefkrat → 15 in kratvolgorde met de kratkolom (1, 2, 3 …), kolomkop
beurten en terug, "haal binnen" op één nummer (Ross from Friends – The Daisy, daarna
Overmono – Is U) gaat door `POST /api/kaart/wens { meteen }`, de echte ingest-rij
zonder videostap, nep-yt-dlp zonder cookie-optie (6 aanroepen, 0 × video), de wens
wordt `klaar` met `track` als object, de library heeft er één bij, de rij wordt
`binnen` met laadknoppen, de kiezer telt "1 binnen", het nachtblok zegt uit, 80 per
nacht, 01:00–07:00, "speeldagen: 10 okt (vandaag)", "nog geen run geweest";
`/api/nacht` blijft `aan: false` met `speeldagen: ["2026-10-10"]`; geen consolefouten.
De nep-headless (`kaart.mjs`, 65 checks) blijft ook groen.

Zo start je die proefserver zelf (de regels staan ook bovenin `kaart-echt.mjs`):

```
M=<scratchmap>; mkdir -p $M/media; cp media/library.db* $M/media/     # KOPIE
printf '#!/bin/sh\nexec node "%s/test/nep-ytdlp.mjs" "$@"\n' "$PWD" > $M/nep-yt-dlp; chmod +x $M/nep-yt-dlp
ffmpeg -f lavfi -i "aevalsrc='0.8*sin(2*PI*900*t)':s=44100:d=12" -ac 2 $M/bron.wav
PORT=8782 VARVE_TESTSERVER=1 VARVE_DB=$M/media/library.db VARVE_MEDIA=$M/media VARVE_OPNAMES=$M/opnames \
VARVE_PATRONEN=$M/patronen VARVE_PLANNEN=$M/plannen VARVE_PROEF=$M/proef VARVE_BACKUPS=$M/backups \
VARVE_HERANALYSE=uit VARVE_YTDLP=$M/nep-yt-dlp NEP_LOG=$M/nep.log NEP_BRON=$M/bron.wav NEP_DUUR=300 \
VARVE_KAART="$HOME/Desktop/3. Resources/Data/Muziekkaart/varve-kaart.json" node server/index.js
NEP_LOG=$M/nep.log node tools/headless/kaart-echt.mjs $M
```

## 10. Na de proefavond (voor Clay)

Vandaag (10 okt) staat als speeldag in `nacht.json` en de nacht staat UIT; er
gebeurt vannacht niets, ook niet als je de knop per ongeluk aanzet (regel 1: ook
de nacht ná een speeldag telt als die dag). Daarna, in deze volgorde:

1. **Server herstarten** vanuit de samengevoegde code (na de merge van de PR) en de
   tab `kaart` openen: 18.233 nummers, 29 kratten in de kiezer.
2. **De eerste nacht klein.** In het blok Nachtwachtrij: `per nacht` op **5**, dan
   `aan`. Of met curl: `curl -X POST localhost:8777/api/nacht -H 'Content-Type: application/json'
   -d '{"perNacht":5,"aan":true}'`. De volgende ochtend: `laatste run` in het blok,
   `GET /api/nacht/runs`, en het serverlog (`[nacht] …`). Mislukt iets met 403/429 of
   "sign in to confirm": de nacht stopt zelf; dan is het een vraag voor de muziekkaart,
   niet iets om met cookies te forceren (nooit). Gaat het goed: `perNacht` naar 20, dan 80.
3. **Speeldagen bijhouden.** Elke avond dat je draait vooraf in de lijst zetten:
   `curl -X POST localhost:8777/api/nacht -H 'Content-Type: application/json'
   -d '{"speeldagen":["2026-10-10","2026-10-17"]}'` (de hele lijst, `JJJJ-MM-DD`), of
   voor één keer de knop `vandaag niet` (loopt na die nacht vanzelf af). Op een
   speeldag en de nacht erna haalt de nacht niets, en "haal binnen" geeft 409
   zolang een deck speelt.
4. **Wensen zetten** waar je zin in hebt: per nummer `haal binnen` (nu, alleen als
   er geen deck speelt) of een hele krat op de wenslijst (boven 20 eerst "ja"). Een
   Spotify-nummer zonder video: eerst `zoek`, of laat de nacht het doen (score ≥ 0,9
   kiest hij zelf; anders staat hij op `kies video` tot jij kiest).
5. **De lokale import**, eerst droog:
   `node tools/lokaal/importeer.mjs --droog --map ~/Music/Music/Media.localized/Music
   --map ~/Music/Samples/Muziek --map "$HOME/Desktop/1. Projects/Youtube mixer/opnames"`.
   Klopt de tabel (24 nieuw, 3 al binnen, 11 onleesbaar op 10 okt), dan zonder
   `--droog` met de server op 8777 aan: één voor één door de upload-route, alleen
   audio, geen stems. `tools/lokaal/LEESMIJ.md`.
6. **Het bestand verversen** als de muziekkaart opnieuw gebouwd is: Varve ziet de
   nieuwe mtime bij het eerste verzoek erna; niets herstarten.
