# Verslag S8 — inrichten, iPad en iPhone bedienen, totaalmeting, proef en docs (14 okt 2026)

Tak `werk/S8` vanaf `werkruimte/integratie` (d097a3e). Ontwerp: `docs/WERKRUIMTE.md` (C4, C6, D3, D4 "S8");
wat er is en hoe het werkt: `docs/werkruimte/S8.md`. Clay's keuzes van 14 okt: W1 = ja (de iPad mag bedienen,
per onderdeel anders), een iPhone als xy-pad, Clay maakt zelf de indeling, W3: niets aan de engine.

## 1. Wat gebouwd is

1. **De schrijfweg voor iPad en iPhone** (`server/paneel.js` PaneelSchrijf, `server/routes/paneel.js`,
   `src/paneel/uitvoer.js`, `src/paneel/schrijver.js`, `src/ui/live-zender.js` startOntvanger,
   `src/ui/aanhakers/schermen.js` toegestaan): standaard uit = 404 (ook na een herstart van de server);
   Host via `vreemdVerzoek`/`VARVE_HOSTS` en een Origin die precies de eigen pagina is; koppelcode van 6
   cijfers (60 s, één keer, 5 pogingen) → token van 32 bytes in een `HttpOnly; Secure; SameSite=Strict`-cookie,
   alleen de SHA-256 op schijf, per apparaat een naam en een scherm; de mixer voert alleen uit wat in de
   panelen van DAT scherm in het actieve deel staat en door `waaromNietOpScherm` komt (VAST_NOOIT wint altijd);
   rem 120/s per apparaat en scherm (429, loslaten altijd door); `seq` tegen dubbel; antwoord `{ ok, reden, read }`;
   loslaten binnen 1,5 s bij wegvallen (geen ping met `?k=`, of de SSE van de pagina dicht; de mixer ook zelf als
   zijn kanaal stil is); de bron in het handelingenlog (`[t, id, v, { bron: 'ipad' }]`, `neem(…, bron)` in
   `src/control/handelingen.js`); werk.html koppelt en roept `zetSchrijver` aan. Tijdkritische actions (bend,
   play, cue, nudge, hotcues, loop in/out, tap) per scherm standaard uit (`"tijdkritisch": true` zet ze open).
2. **Mag-lijsten**: `twee-handen` geeft de iPad `track.*.fx.*`, `track.*.rack.*`, `track.*.send.*`,
   `track.*.filter`, `track.*.kill.*`, `master.fx.*`, `master.rack.*` en `track.*.bar.align` erbij (de bouwsteen
   fx en mijn-mix gebruikten ze, maar ze stonden er niet in), en een scherm `iphone` (xy-pad in FX).
3. **De xy-pad**: `y`, `druk`, `los` in het model (`normaliseerWerkruimte`, met fouten en waarschuwingen),
   `actionsVan` neemt `y` en `druk` mee; schermsoort `iphone`.
4. **✎ Inrichten zonder JSON** (`src/werk/inrichten.js`, `src/ui/aanhakers/inrichten.js`, `src/ui/learn-mode.js`
   zetAanwijzer, ✎ in werk.html op mac-2): aanwijzen (klik of control), zoeker met de top-40
   (`tools/werkruimtes/top40.json`, uit `origin/visie/handen`), weghalen met twee klikken, op een scherm zetten,
   toewijzen aan APC device knobs / Maschine-draaiknoppen / Maschine-pads / F1–F8 (eigen mapje `p-<paneel>`, het
   model beslist), terug naar de vorige inrichting (`werk.terug`, `POST /api/werkruimtes/<naam>/terug`, 409).
5. **Controlekamer**: het blok "Bedienen vanaf iPad en iPhone" (`src/controle/bedienen-tegel.js`); de
   speellijstblokken "Werkruimte · E0, poort M, A, B, C, D" (elk punt met een oordeel).
6. **Totaalmeting** `tools/headless/werk-alles.mjs`; **headless** `tools/headless/inrichten.mjs` en de uitbreiding
   van `tools/headless/werk-ipad.mjs` (nep-iPhone en nep-iPad bedienen).
7. **Docs**: `docs/werkruimte/S8.md`, `docs/WERKRUIMTE.md` "Gebouwd", `docs/VRAGEN.md` blok W, CLAUDE.md sectie
   "Werkruimte" en de structuurlijst, `docs/HANDOFF.md`.

Buiten de bestandenlijst van de opdracht (sporen.json "grens") aangeraakt, nodig voor Clay's extra eisen van 14 okt:
`src/werk/model.js` (xy-velden, schermsoort iphone, TIJDKRITISCH, waaromNietOpScherm, VAST_NOOIT uitgebreid, een
cache in patroon), `src/paneel/protocol.js` (invokeBericht met k, isInvoke strenger, actionsVan met y/druk),
`src/ui/aanhakers/schermen.js` (de stub van S7: toegestaan per scherm en de ontvanger opzetten), de nieuwe
`src/paneel/uitvoer.js` en `src/paneel/schrijver.js`, `werk.html` (het koppelformulier en de css-link),
`test/nep-mixer.mjs` (een hulpproces voor de test). Verder: `src/control/handelingen.js` (de bron in het log, drie regels;
`busNaarLog` geeft `o.bron` door), `server/werkruimtes.js` + `server/routes/werkruimtes.js` (terug, en de top-40
op de witte lijst), `src/ui/beschrijf/index.js` (de uitleg van `werk.terug`), de verwachtingen van drie tests
die de S7-regel "de iPad schrijft niets" vastlegden (`regels-werk`, `paneel-server`: nu de strengere S8-regel)
en `aanhaakpunten` (de witte lijst: ijkproef plus top-40), `controle.test` (de prefix "Werkruimte · ").

## 2. Metingen (exacte commando's)

Omgeving: Linux-container, 4 kernen, headless Chromium 1194 (`headless_shell --no-sandbox`, software-GL),
Node 22.22. `VARVE_CHROME=<wrapper>`.

**De schrijfweg op loopback** — `node test/paneel-schrijf.test.mjs`:
- nep-iPad (node) → server → nep-mixer (eigen proces, echte Uitvoerder) → server → nep-iPad, 1000 rondjes in het
  tempo van de rem: p50 3,1–3,3 ms, p99 7,6–8,6 ms. Een gewone GET in hetzelfde tempo kost hier al p50 1,6 ms,
  p99 3,6 ms (elke hop tussen processen ~0,5 ms wektijd in deze VM; de SSE-levering alleen al p50 0,48 ms). De eis
  "p99 < 5 ms" is op deze machine niet te beoordelen: de test meldt hem als overgeslagen (`  -- `) en toetst wat
  WEL kan: de keten kost hooguit drie gewone rondjes plus 2 ms (✓). Op de Mac opnieuw (proef D).
- 200 invokes in 1 s: 120 × 200, 80 × 429 ✓ · dezelfde seq twee keer = één invoke ✓ · SSE dicht met een `.hold`
  vast: los na 5 ms ✓ · stil weggevallen (geen ping, geen FIN): los na 1,66 s (de klok kijkt elke 250 ms) ✓.

**In echte Chrome** — `VARVE_CHROME=… node tools/headless/werk-ipad.mjs --duur 60`:
- alle S8-checks groen (koppelen, verkeerde code, HttpOnly, de ontvanger opent, de xy-pad over de volle breedte,
  60/60 bewegingen aan, de laatste stand komt aan, loslaten = terug, het log met bron "iphone", een knop in mag
  uitgevoerd, het filter buiten mag geweigerd met melding, HOOG WEG vast en de iPad dicht → los na 946 ms,
  record.start en een vrije play geweigerd, uit = weer kijken).
- METING iPhone → mixer (CDP-muis tot de action in de mixer, loopback): POST → action p50 13 ms, p99 38 ms; met het
  tekenen van de pagina erbij p50 ~30 ms, staart tot ~700 ms (headless tekent vijf pagina's met software-GL; de
  staart zit aan de kant van de pagina: muis → POST p99 584–723 ms). Wifi en touch zitten er niet in.
- De twee checks van S7 over de positie (≤ 5 ms) faalden in deze run (max 8,5 ms; mediaan 1,2, p99 4,5); S7.md §7
  zegt al dat die hier alleen op een rustige machine haalt. Ze lopen vóór het S8-deel en S8 raakt dat pad niet.

**✎ inrichten** — `VARVE_CHROME=… node tools/headless/inrichten.mjs`: 14/14 (aanwijzen van de sync-knop = knop
`track.{focus}.sync`, de knop ging niet af, het werkvak toont het item; een control bewegen (nep-APC track knob 2)
= draai `track.2.filter`; de zoeker met de top-40 bovenaan; weghalen met twee klikken; op scherm iphone; ↶ terug).

**Totaalmeting (C6)** — `VARVE_CHROME=… node tools/headless/werk-alles.mjs --sec 8 --rondes 3`. Acht tracks
spelend; nul = standaard; alles = werkvak met de uitlijnstrook, mac-2 met de uitlijnweergave groot, een
iPad-kijker (SSE), de zender, de schrijfweg aan met een gekoppelde iPhone die 20 invokes/s stuurt, ✎ opgezet; in
de nulmeting draait dezelfde knop 20×/s via de nep-APC. iPad en iPhone zijn node-clients (in het echt tekenen ze
op hun eigen apparaat). Derde run (gemiddeld over 3 rondes):

| | taak ms/s | beelden/s | ms/beeld | stijl ms/s | LED-tik p99 | lange taken > 50 ms |
|---|---|---|---|---|---|---|
| nul | 477 | 33 | 14,5 | 35,2 | 5,0 ms | 2 (≤ 59 ms) |
| alles zonder mac-2 | 514 | 23 | 22,8 | 24,9 | 5,3 ms | 2 (≤ 54 ms) |
| alles | 521 | 20 | 25,6 | 22,8 | 6,0 ms | 1 (51 ms) |
| in rust (gestopt): nul / alles | 261 / 441 | 60 / 60 | | | | 0 / 0 |

En met `--deel kaal` (alles aan, maar geen werkvak; 2 rondes): nul 473 ms/s, 35 beelden/s · alles 468 ms/s, 32
beelden/s · alles zonder mac-2 455 ms/s, 34 beelden/s: **niets meetbaar** (let op: in KAAL staat de xy-pad niet op de
iPhone, dus zijn 20 invokes/s komen wel binnen, worden getoetst en geweigerd, maar bewegen niets; mac-2 toont er niets).

**Kort: het C6-budget is in deze omgeving NIET aangetoond.** Wat wel: de hoofdthreadtijd stijgt nauwelijks en in rust
wordt er niets getekend. Wat niet: de beeldsnelheid zakt, en twee budgetten zijn hier te ruisig om te beslissen.

Oordeel per budget:
- **≤ +2 ms per beeld in hoofdthreadtijd** (Δtaak / 60): +0,72 ms (eerdere runs +1,20 en −0,17; review: +0,87). Dit is
  één lezing van "per beeld"; gemeten als taak / beelden kost alles samen in run 3 **+11,1 ms** (zonder mac-2 +8,3 ms):
  ✗.
- **Beelden per seconde**: in deel MIX zakt headless van ~33 naar ~23 (zonder mac-2) en ~20 (met mac-2) beelden/s
  bij nagenoeg gelijke hoofdthreadtijd; in deel KAAL niet. Dat wijst op het tekenen van de uitlijnstrook in het
  werkvak en de uitlijnweergave op mac-2 (S2/S7), met software-GL. Maar KAAL bewijst het maar half: daar worden de
  invokes van de iPhone geweigerd (de xy-pad staat niet op zijn scherm) en toont mac-2 niets; de 5 FAILs van die run
  zijn daar het gevolg van (de check "de ontvanger voert de iPhone uit"). Dat de schrijfweg zelf de beelden niet
  drukt, is dus niet bewezen; alleen dat hij weinig hoofdthreadtijd kost. **Op de M1 met GPU opnieuw meten** (proef A); tot dan: zet de
  uitlijnstrook alleen in een deel waar je hem gebruikt (zoals twee-handen en apc-alleen doen).
- **Geen lange taak > 50 ms**: ✗ in de letterlijke zin, maar de nulmeting heeft ze evengoed (1–2 per 8 s, 50–80 ms,
  de omgeving: GC en de nep-audioklok); met alles aan niet meer dan zonder.
- **LED-tik p99 ≤ +10%**: niet te beslissen: de p99 van de nulmeting zelf loopt van 4,0 tot 7,0 ms tussen rondes
  (een paar uitschieters van de tik in een drukke container; p50 0,42–0,47 ms aan beide kanten). Twee van drie
  runs ✓, de derde ✗ (6,0 tegen 5,5).
- **≤ 3 Mpx/s in rust**: ✓ 0,00 Mpx/s (nul ook 0,00).
- In rust kost alles 441 tegen 261 ms/s: dat is de iPhone die doorgaat met 20 invokes/s (de echo-send beweegt,
  het scherm volgt) en mac-2; zonder de stroom (run 1): 200 tegen 158 ms/s.
- De stijl bleef 18–50 ms/s (S7: 18–41), nergens richting 180.
- De nep-iPhone krijgt bij elke wissel nul → alles ~20 keer 503 ("de mixer luistert niet"): de ontvanger opent zijn
  kanaal pas na de volgende melding van de zender (≤ 1 s). De check telt alleen 200 en 429; dit staat hier eerlijk bij.

**latentie.mjs vóór en na** — `VARVE_CHROME=… VARVE_WORTEL=<basis> node tools/headless/latentie.mjs --label voor
--uit voor.json`, dan zonder VARVE_WORTEL `--label na --uit na.json`, en `--vergelijk voor.json na.json`
(standaard, zonder werkruimte): zie §2b.

## 2b. latentie vóór/na

Met `standaard` (geen werkruimte) moet S8 niets kosten. Eén ronde elk (vóór = `git archive origin/werkruimte/integratie`
uitgepakt, `VARVE_WORTEL`), p50 / p99:

| scenario | maat | vóór | na |
|---|---|---|---|
| rust | hoofdthread taak · stijl ms/s | 569 · 39,7 | 561 · 37,8 |
| rust | frame-interval | 16,67 / 39,75 | 16,71 / 21,15 |
| fader | wacht · tot geluid · tot scherm (p50) | 2,47 · 2,92 · 12,2 | 3,05 · 3,63 · 12,0 |
| fader | werk per bericht | 0,24 / 0,91 | 0,25 / 0,94 |
| sweep | tot geluid (p50 / p99) | 6,62 / 21,7 | 8,72 / 33,2 (één lange taak van 50 ms) |
| ringen · device | taak ms/s | 973 · 939 | 876 · 848 |
| xfader · pads | werk per bericht p50 | 0,23 · 0,31 | 0,22 · 0,32 |

Werk per bericht is gelijk (0,06–0,32 ms); de rest schommelt in beide richtingen met de container (de sweep en de
fader slechter: fader taak 695 → 747 ms/s, +7,5%; ringen en device beter). Geen aanwijzing dat S8 iets kost zonder werkruimte; dat klopt met het ontwerp (de mixer laadt
zonder werkruimte niets van `src/paneel/`, en de patroon-cache en de extra kolom in het log raken het hete pad niet).
Voor een hard oordeel: meerdere rondes (`--vergelijk a1,a2 b1,b2`) op een rustige machine.

## 2c. De hele suite

`VARVE_CHROME=… node test/alles.mjs`: 118 bestanden, 10.241 checks, 10 overgeslagen, **4 rood, alle vier de
omgeving**: renderblok ("keylock met wissels"), wachtrij ("yt-dlp en zijn kind", 2×) en instrumenten-fm-schaal ("geen
afval per blok"), zoals op main in deze container; en ingest (10 fouten: yt-dlp ontbreekt hier, de installatie werd
geweigerd; `node test/ingest.test.mjs` op de uitgepakte basis faalt precies even vaak). Overgeslagen en gemeld: o.a.
de hub (geen av-app-hub), de Stroommachine, en de p99 < 5 ms van de schrijfweg (§2).

## 2d. Reviews

Twee reviewers (veiligheid/correctheid, acceptatie/bewijs). Ronde 1 vond geen gat in de toegang zelf (CSRF, token,
Origin, VAST_NOOIT via de naam: niet weerlegd), wel echte fouten in loslaten, de rem en het kanaal: gerepareerd in
b76373e (zie docs/werkruimte/S8.md §6b, met tests). Review (b): geen onware beweringen, wel te gunstig samengevat (het
C6-budget, de KAAL-meting) en een onvolledige bestandenlijst: hierboven bijgesteld; en ✎ laadt sindsdien lui (met
`standaard` geen module, geen fetch, geen paneel). Wat bewust blijft: S8.md §6b.

## 3. Wat niet gedaan is

- **De Maschine in de totaalmeting**: alleen via de AV-app-hub; die kon hier niet geïnstalleerd worden (de
  installatie van yt-dlp en de hub werd door de omgeving geweigerd). `werk-maschine.mjs` en de headless tools
  met de hub zijn daarom niet gedraaid.
- **De p99 < 5 ms op loopback** is op deze VM niet aan te tonen (zie §2); overgeslagen gemeld, niet groen gemaakt.
- **iPad-UI voor "delen kiezen"**: `werk.deel.*` mag in `mag` staan, maar werk.html heeft er geen knoppen voor;
  wie het wil zet `werk.deel.fx` als knop in een paneel.
- **De standen via Tailscale alleen-lezen** (VRAGEN W9): voorgelegd, niet gebouwd (server/index.js).
- **Toewijzen "werkt na herladen"** is getoetst tot in de samengestelde mapping van de Maschine (de regels staan in
  pagina.p-dub), niet met een draaiknop die daarna echt iets doet (de Maschine gaat alleen via de hub).
- **Laden vanaf de iPad met een tweede druk**: bewust niet; laden staat in VAST_NOOIT (strenger dan de acceptatie).

## 4. Alleen op de echte iPad, iPhone of Mac te bevestigen

- Safari bewaart de `Secure`-cookie op de ts.net-naam, ook als beginschermapp; koppelen in één keer.
- Echte vingers op de xy-pad (touch-action, twee vingers op twee pads), en hoe de vertraging voelt over wifi.
- Wifi uit terwijl een worp vastzit: los binnen ~2 s (getest als "pagina dicht" en "geen ping meer").
- Een echte `tailscale serve`: Host en Origin zoals de proxy ze aflevert.
- De beeldsnelheid met de uitlijnstrook in het werkvak en mac-2 op de M1 met GPU.
- Twee tabbladen van de mixer met de APC: alleen het tabblad met de lock luistert (getest met de zender, niet met
  twee tabbladen en een echte APC).

## 5. Een iPad en een iPhone koppelen (voor Clay)

1. Tailscale aan (`docs/TAILSCALE.md`): `tailscale serve --bg 8777`, server met `VARVE_HOSTS=<naam>.ts.net`.
2. In de mixer een werkruimte kiezen (werk-balk), bv. `twee-handen`. Wil je hem aanpassen: ✎ maakt er vanzelf een
   eigen bestand van.
3. Controlekamer → "Bedienen vanaf iPad en iPhone" → **aan** (twee klikken).
4. iPad, Safari: `https://<naam>.ts.net/werk.html?s=ipad` → Deel → Zet op beginscherm, en open hem daarvandaan.
5. Controlekamer → **koppelcode** → typ de zes cijfers op de iPad, met een naam → **koppel**. Rechtsboven: "bedient".
6. iPhone: `https://<naam>.ts.net/werk.html?s=iphone`, een nieuwe code, koppelen.
7. Wat erop staat: met ✎ in de mixer ("zet op scherm" → ipad of iphone, in het deel van nu), of in het bestand
   (`delen.<deel>.schermen.ipad.vakken`). Wat ze mogen: `schermen.ipad.mag` / `schermen.iphone.mag` (zie
   docs/werkruimte/S8.md §2). Het voorbeeld: in FX op de iPhone een xy-pad (x = plek 1 van het rack van de
   focus-track, y = de echo, aanraken = plek 2 vol, loslaten = terug).
8. Klaar: **uit** in de Controlekamer (alles wat vastzit gaat los), of **intrekken** per apparaat.

## 6. Vragen

Allemaal in `docs/VRAGEN.md` blok W (W2–W40, ontdubbeld met advies; W1 beantwoord). Nieuw uit S8: W4 (het werkvak
op 1440×790 met een rij open: 9 px), W5–W15 (wat de iPad/iPhone mag, tijdkritisch, de schakelaar na een herstart,
standen alleen vanaf de Mac, de vertraging op de echte iPhone, toewijzen in een eigen mapje, F1–F8).

## 7. Opties voor een volgende versie

- Een WebSocket in plaats van POST + SSE voor bedienen (minder hops; de berichten blijven gelijk), als de iPhone
  op wifi traag voelt.
- Knoppen voor delen op de iPad (een vak "delen"), en een vak "inrichten" op mac-2 met de volle zoeker.
- ✎: een paneel hernoemen, items verslepen, een item een eigen label geven, een xy-pad samenstellen uit twee
  aangewezen knoppen.
- Toewijzen op een vrije plek van de STANDAARD (niet alleen een eigen mapje), met de controle van het model.
- De standen-routes alleen vanaf de Mac (W9).
- De uitlijnstrook goedkoper tekenen als de M1 dezelfde beeldval laat zien.
