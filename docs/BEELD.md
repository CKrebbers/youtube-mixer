# Beeld — VARVE stuurt de Stroommachine (spoor beeld, 6 oktober 2026)

Twee machines, één relay. **MacBook** = VARVE DJ, de APC40 en het geluid. **Omarchy-pc** =
de Stroommachine (generatieve visuals, WebGL2), de Varve-relay en de beamer. VARVE stuurt
klok, kenmerken, tracks en crossfader; de Stroommachine volgt en maakt per nummer een scène.

```
MacBook                                         Omarchy-pc
VARVE ── src/koppel/varve-beeld-zender.js ──▶ relay :7702 ──▶ Stroommachine (?hub=…&dj)
      ◀── pong, beeld-status ────────────────            ◀──
```

**Ontwerpregel:** MacBook + APC is genoeg, de pc is er soms. Uit, zonder adres of zonder
relay verandert er in VARVE niets: geen geluid, geen knop die anders doet, geen melding
die terugkomt. Valt de pc weg, dan speelt VARVE gewoon door en verbindt de zender
zelf opnieuw (1 → 10 s); de Stroommachine valt na 3 s terug op haar eigen klok.

**Bron van waarheid voor het protocol** is de Stroommachine-repo
(`~/Projects/stroommachine`, `github.com/CKrebbers/stroommachine`, privé):
`koppel/PROTOCOL-dj.md` (berichten, klok volgen, crossfader), `koppel/DJ-START.md`
(een avond spelen, de pc instellen). De zender staat hier ONGEWIJZIGD in
`src/koppel/varve-beeld-zender.js` (herkomstregel bovenaan); wijzig hem daar en neem
hem opnieuw over, niet hier.

## 1. Instellen

Knop **beeld** in de bovenbalk opent de BEELD-rij (onthouden, standaard dicht):

| veld | wat | bewaard in |
|---|---|---|
| aan / uit | de zender loopt alleen als hij aan staat ÉN er een geldig adres is | `varve.beeld.aan` |
| relay-adres | `ws://clayk:7702/app` (terugval `ws://100.110.172.126:7702/app`), met Tailscale aan op Mac en pc: ze zitten op twee subnetten, dus het LAN-adres 192.168.0.x dat de pc toont werkt vanaf de Mac niet. Naast het veld twee knopjes: **deze Mac** (`ws://127.0.0.1:7702/app`, de relay van `tools/beeld-lokaal.sh`, §8) en **pc** (`ws://clayk:7702/app`); één klik = dat adres, toegepast zoals Enter; het knopje van het adres dat geldt brandt (`BEELD_ADRESSEN` in beeld.js, sleutels `lokaal` en `pc`). Staat beeld aan en verbonden met een ánder adres (midden in een set), dan wisselt één klik niet: je krijgt een melding en wisselt met een tweede klik op hetzelfde knopje binnen 3 s (`wisselVraagtBevestiging`), anders verliest de Stroommachine op de beamer door één misklik de klok. Typen plus Enter wisselt wel meteen. Alleen `ws://` of `wss://`, getrimd, hooguit 200 tekens, geen gebruikersnaam/wachtwoord of `#`. Een ongeldig adres wordt geweigerd met een melding; de zender start dan niet (en een lopende stopt), het oude adres blijft bewaard | `varve.beeld.adres` |
| extra latentie | −200 … +500 ms, standaard 0. **+ = het beeld eerder**: voor een beamer die achterloopt | `varve.beeld.latentie` |

Bewaard zoals de andere rijen: in localStorage van deze browser.

**Status:** op de knop **beeld** een klein lampje, alleen als beeld aan staat (uit = de
knop ziet eruit als altijd); in de rij de hele regel: uit · geen adres · de reden van een
geweigerd adres · zoekt de relay · verbonden, wacht op de Stroommachine · verbonden ·
`<regime>` · `<scène>` · volgt de klok / eigen klok. De Controlekamer (`/controle`) heeft
een tegel **Beeld** met hetzelfde.

**Meldingen:** hooguit één "verbonden met de relay" en één "de relay antwoordt niet"
(na 8 s) per keer dat je hem aanzet of het adres verandert. Nooit bij herverbinden. Start
hij vanzelf uit de bewaarde instellingen (een avond zonder pc), dan is die tweede een
info-melding die na 5 s weggaat ("geen relay … staat de pc uit?"), geen rode die blijft
staan. Een poort die de browser nooit opent (6000, 6667, …) wordt meteen geweigerd.

### De latentie afstellen
Speel een nummer met een duidelijke kick en kijk naar een flits op de tel in de
Stroommachine. Komt het beeld te laat (beamers rekenen vaak 50–120 ms), dan ijk je op één
plek. Met Stroommachine v10: IJken op de pc (tab Live → Varve DJ, de pijltjes) tot de flits
op de kick valt, en de latentie in Varve op 0. Zonder v10: zet de extra latentie in Varve
hoger tot de flits op de kick valt. Klinkt het geluid later dan je denkt (een PA met
vertraging), dan negatief. Wat de Mac zelf aan uitgangsvertraging heeft
(`outputLatency + baseLatency` en de vooruitblik van de limiter) zit er al in: zie §2.

## 2. Wat er gaat, en waar het vandaan komt

| bericht | inhoud | bron in VARVE |
|---|---|---|
| `klok` | `beat`, `bpm`, `speelt`, `t` | De **maatgever** die je hoort (`engineTel` in `src/analysis/maat.js`: dezelfde track als de MAAT-badge, de video-puls en de vormlagen, met hysterese). `beat` = de doorlopende tel (niet modulo 4) op de positie die je HOORT: positie − (uitgangsvertraging − extra latentie) × rate (`hoorbaar.js`, regel 3). `bpm` = grid × rate. `speelt:false` (met de laatste tel en bpm) als er geen maatgever is die je hoort: gestopt, fader dicht, wacht op de maat, remt. `t` = `performance.now()` (de zender), want daarop rekent de Stroommachine het klokverschil uit met ping/pong. |
| `kenmerken` (30/s) | `mix.laag`, `mix.midden`, `mix.hoog`, `mix.klap`, `mix.luid`, `maat.tel`, `maat.klap` | `mix.*` = de master-analyser (na de limiter: wat de zaal hoort), dezelfde `Luisteraar` als de vormlagen (laag · midden · hoog · onset · rms). Sinds 13 okt gaan `mix.laag`, `mix.midden`, `mix.hoog` en `mix.luid` op de schaal van WAT ER NU KLINKT (`src/koppel/niveau.js`, §2a), niet op de vaste ijking van de vormlagen; `mix.klap` blijft de onset. `maat.tel` = de fase binnen de tel (0..1) van de maatgever, `maat.klap` = 1 in het eerste kwart van de tel (zoals de lampjes op de APC), anders 0. Niets als er niets KLINKT: geen track die speelt en de master al 1 s stil. Een staart van echo of galm, de sampler of de klankschaal tellen dus mee, en na een pauze zakken de waarden eerst naar ~0 (anders bleef de Stroommachine op de laatste luide waarde staan: de klok houdt haar "vers"). Zonder verbinding wordt de analyser niet gelezen. |
| `track` | `deck`, `id`, `titel`, `bpm`, `key` | Bij laden (laden.js `naLaad`), per crossfaderkant: zie §3. `id` blijft per nummer hetzelfde: `yt:<videoId>`, `tiktok:<id>`, `lokaal:<hash>` (eigen bestand in de library), `varve:demo-<zaad>`, `bestand:<naam>` (los gesleept). `bpm` = het grid op de plaat, `key` = Camelot. |
| `mix` | `xfader`, `a`, `b` = `{speelt, pos, rate}` | De crossfader (0 = volledig A, 1 = volledig B) en de track van elke kant; bij elke verandering van crossfader, play/pauze, tempo of een sprong (de zender begrenst tot 20/s). |
| poort | `macro.*`, `regie!*` | De APC-pagina "Beeld" (§4). |

`track` en `mix` zijn TOESTAND, geen stroom. De relay gooit een bericht weg als de
Stroommachine er (nog) niet is, en een herladen Stroommachine weet niets meer. Daarom:
- ze gaan pas als ze er aantoonbaar is: een verse `beeld-status` (elke seconde) of ping
  (elke 2 s), < 3 s oud;
- opnieuw na elke (her)verbinding van VARVE;
- opnieuw als ze HERLADEN is. Dat is exact te zien: haar ping-teller begint per pagina bij 1
  (`09o-dj.js` daar), dus een ping met een id die niet hoger is dan de vorige = een nieuwe
  pagina. VARVE luistert daarvoor mee op de socket van de zender (een eigen WebSocket-klasse
  eromheen; de zender zelf blijft ongewijzigd en antwoordt zelf). Ook een snelle F5 en een
  nummer dat je laadde terwijl ze herlaadde komen zo aan. Hooguit eens per 10 s; een tweede
  keer binnen die tijd wacht tot hij om is (niet verloren). Twee Stroommachines tegelijk
  (twee tellers door elkaar) gaven anders elke ping een scènewissel.
- Nooit in het statusbericht van de zender zelf (die meldt "verbonden" vóór zijn manifest,
  en de relay wil het manifest als eerste bericht), maar bij de volgende tik (100 ms).

De macro's die je via VARVE zette gaan op dezelfde momenten opnieuw: VARVE is de bron van
waarheid voor wat de APC deed (een herladen Stroommachine begint neutraal). Een macro die
je draait terwijl ze er even niet is, gaat zodra ze er is; zonder verbinding met de relay
doet een draai niets (de ring liegt niet).

**Eén tabblad.** Alleen het tabblad met de APC zendt (de Web Lock, of met `?hub=` het
tabblad bij de hub; `magZenden` vanuit app.js). Een tweede tabblad deelt localStorage en
staat dus ook "aan", maar verbindt niet: de rij zegt "een ander VARVE-tabblad heeft de APC".
Sluit je het eerste, dan neemt het tweede het over. Twee tabbladen die allebei op elke ping
antwoorden zouden het klokverschil van de Stroommachine onzin maken, en elkaars mix
overschrijven.

Gevonden in de eind-tot-eindproef en de review (6 okt): zonder dit kwam een track die je
laadde vóór de Stroommachine er was nooit aan, en gaf een tweede tabblad een willekeurige tel.

## 2a. Het niveau: op de schaal van wat er klinkt (13 okt)

**Gemeten:** op de eerste avond met de pc (13 okt, Clay speelde, 146 BPM) stonden op de relay
`mix.laag` en `mix.luid` continu op 1,00 en `mix.midden`/`mix.hoog` op 0,85–0,99: de banden
in `features.js` liggen op vaste dB-grenzen (`BAND_DB`, `RMS_DB`, geijkt met de masterfader op
0,8), en een luidere master kapt daar af. De Stroommachine moduleert met die waarden (haar
bronnen "Mic" en "Mic bas"); met een vlakke lijn gebeurde er weinig op de maat. De master
zachter zetten hielp meteen (Clay). `maat.klap` tikte wel goed.

**Nu:** `NiveauVolger` (`src/koppel/niveau.js`) leest de ruwe dB uit `Kenmerken.waarden.db`
(`bandenDb`, `rmsDb` in features.js, niet afgekapt) en legt per kenmerk de laatste 8 s op
0..1: het 10e percentiel = 0, het 95e = 1, minstens 6 dB ertussen (een vlak stuk blaast niet
op). Daarna gladmaken zoals features.js. Stilte (< 0,05 op de vaste schaal) telt niet mee en
geeft 0; met minder dan 20 monsters (eerste ~0,7 s, of na een pauze van > 8 s) de vaste schaal.
Zo pompt het beeld op elk volume en elk nummer gelijk. Alleen voor de zender: de vormlagen
van VARVE houden hun vaste ijking (daar is een bass-kill naar 0 juist de bedoeling).

**Bewust niet:** `mix.klap` (de onset) blijft zoals hij is. In dezelfde meting piekte hij
vaak tussen de kicks (hats, snare); de Stroommachine neemt het maximum van `mix.klap` en
`maat.klap`. Of de klap alleen de bas moet volgen, is een keuze voor na een avond met dit
niveau (VRAGEN BE15).

`test/niveau.test.mjs`: een luide plaat (vaste schaal vol) pompt (kick > 0,8, ertussen < 0,3),
10 dB luider geeft per beeld hetzelfde, vlak en stilte blazen niet op, tijd van buiten, de
ruwe dB naast de afgekapte waarden.

## 3. Acht tracks, twee decks

Het protocol kent deck A en B; VARVE heeft acht tracks met een crossfaderkant A, B of
thru (standaard 1 op A, 2 op B, de rest thru). **Deck A = kant A van de crossfader.** Van
de tracks op een kant met een nummer telt wie SPEELT, en daarvan wie het laatst begon;
speelt er geen, dan wie het laatst geladen of gestart werd (`kiesKant`). Zo wisselt een
track die je klaarzet terwijl een andere op dezelfde kant speelt de scène niet, en neemt
een track die je start hem over. Thru-tracks horen bij geen kant en sturen geen `track`
(VRAGEN BE2).

In de Stroommachine krijgt elk nummer een eigen scène (onthouden per `id`); de
crossfader mengt de knoppen en kleuren, en voorbij het midden wisselt de scène. Zolang
VARVE de scène bepaalt, houdt haar regisseur vast.

## 4. De APC-pagina "Beeld"

Het mapje **beeld** van de device-groep (`device.beeld`), naast strip, rack, inst en
master. **Shift + Detail View** opent het (vasthouden = gluren); Clip/Device View gaat terug
naar de strip. Volledig, met het waarom: `docs/APC40.md` "Mapje beeld".

| knop | in het mapje beeld | action → poort |
|---|---|---|
| device knob 1–8 | intensiteit · snelheid · helderheid · feedback · tint · dichtheid · glitch · balans (endless; feedback, tint, dichtheid en balans met een ring vanuit het midden) | `beeld.macro.<naam>` → `macro.<naam>` (value 0..1) |
| scene 1–5 | ontdek · volgende · vasthouden · flits · vrij | `beeld.regie.<naam>` → `regie!<naam>` (trigger, alleen bij indrukken) |
| Stop All Clips | paniek (zoals in de eigen APC-indeling van de Stroommachine) | `beeld.regie.paniek` → `regie!paniek` |
| Shift + scene 1–5 | blijven de vijf shift-modi kiezen (secties · patronen · stems · auto · klank); hotcues · loops · sampler · video in beeld met ▲ ▼ of na Clip/Device View | — |

- **Waarom een device-mapje en geen grid-modus:** de opdracht noemde "8 faders", maar de
  track-faders zijn de kern (volume) en die zit nooit in een mapje. De acht device knobs
  zijn de enige acht doorlopende regelaars die per mapje wisselen, en alleen de device-groep
  kan ze wisselen. Een regel in een device-mapje wint daarbij ook op de scene-knoppen.
- **Lampjes:** de regie in roze (donker = verbonden, fel zolang je drukt), flits wit,
  paniek rood (Stop All heeft geen LED: alleen op het scherm en `apc.html`). Zonder
  verbinding zijn ringen en lampjes uit en stuurt een draai niets.
- **Op het scherm** (het scherm als APC) staat Detail View als "⇧ beeld": shift + klik
  opent het mapje.
- Koppelen werkt zoals altijd: elke `beeld.*`-action kan op elke knop (de mapping blijft
  van jou; een eigen regel wint).

## 5. Problemen oplossen

| wat je ziet | kijk naar |
|---|---|
| lampje op **beeld** blijft "zoekt" | draait de relay op de pc (`node tools/varve-relay.js 7702 --host 0.0.0.0`)? klopt het adres (`ws://clayk:7702/app`, Tailscale aan op beide)? laat de firewall 7702/tcp toe? (`koppel/DJ-START.md`) |
| "verbonden, wacht op de Stroommachine" | de relay draait, maar de Stroommachine is niet open of mist `&dj` in haar adres |
| "eigen klok" | er is geen maatgever die je hoort: speelt er een track met een grid, staat zijn fader open en de crossfader niet weg van zijn kant? |
| beeld te laat / te vroeg | ijken (§1): met Stroommachine v10 IJken op de pc, anders de extra latentie in Varve |
| een track geeft geen scène | staat hij op kant A of B (de A\|B-knop in het 2×2-blok)? thru telt niet (§3) |
| macro-knoppen doen niets, ringen uit | geen verbinding (de ringen tonen alleen iets als VARVE verbonden is) |
| in de console van Chrome "WebSocket connection to … failed" | dat logt Chrome zelf bij elke mislukte poging (relay weg); JavaScript kan het niet onderdrukken. Hooguit één per 10 s. Zet beeld uit als je zonder pc speelt |

## 6. Testen

- `node test/beeld.test.mjs` (169 checks): de koppeling zonder browser en netwerk
  (nep-engine, nep-zender, en de echte zender op een nep-WebSocket met nep-timers); de
  poort-id's tegen `src/09d-poorten.js` van de Stroommachine als die repo er is.
- `node test/varve-beeld-zender.test.mjs`: de zendertest van de Stroommachine (21 checks),
  overgenomen; `test/alles.mjs` telt zijn eigen formaat mee.
- `node tools/headless/beeld.mjs` (66 checks, 10 okt; de knopjes deze Mac · pc met een echte
  muisklik: met beeld UIT, en verbonden met de nep-relay, waar één klik niet wisselt en een
  tweede klik binnen 3 s wel. De adressen van Clay leidt de pagina om naar een lege poort,
  dus er gaat nooit iets naar 7702 of de pc): echte Chrome (headless, zonder MIDI), met een
  nep-relay: opstarten zonder adres (0 fouten, geen WebSocket), de bovenbalk en de rij,
  de velden, de stand, de tegel in de Controlekamer, relay weg, uit en herladen,
  opstarten met een onbereikbaar adres (40 s: één info-melding die weggaat, 0 fouten van
  onze code, 7 pogingen), en een tweede VARVE-tabblad (0 WebSockets zolang het eerste open
  is; sluit het eerste, dan neemt het tweede het over).
- `node tools/headless/beeld-e2e.mjs` (29 checks): eind-tot-eind op deze Mac zonder pc: de
  relay uit de Stroommachine-repo op 7702, de echte Stroommachine headless (swiftshader),
  VARVE met de demo op track 1 en 2. Gemeten op 6 okt: "varvedj · volgt de klok · 124.0 BPM",
  rondetijd mediaan 3,7 ms (min 3,7, max 6,1 over 10 s), de tel 0,007 tel naast die van
  VARVE, crossfader 0 → 0,8 = deck A → B met elk een eigen scène, `macro.tint` komt aan,
  de Stroommachine herladen = de tracks terug zodra ze er is (16–23 s, haar eigen opstarttijd
  headless), pauze = haar bronnen zakken naar stil (< −0,9), relay
  weg = 0 fouten en 0 meldingen in VARVE en 4–5 pogingen in 25 s, relay terug = vanzelf weer
  verbonden en volgt weer de klok.

## 7. Grenzen (bewust, of nog niet gemeten)

- **Niet gemeten op LAN/wifi**: de klokvergelijking is alleen op één machine gemeten
  (rondetijd < 50 ms in de e2e). DJ-START.md: liever een kabel.
- De Stroommachine meldt haar macro-standen niet terug. De ringen van de device knobs
  beginnen op de neutrale stand van de Stroommachine (`MACRO_STANDAARD`); je eerste
  draai zet de macro op die stand plus de draai (VRAGEN BE3).
- De regieknoppen hebben nog geen terugmelding (vasthouden en paniek zijn schakelaars in
  de Stroommachine; VARVE weet hun stand niet): het lampje zegt alleen "verbonden" en
  "ingedrukt" (VRAGEN BE4).
- De features `mix.*` komen van de master-analyser, die vóór de uitgangsvertraging
  meet; de extra latentie schuift alleen de tel (klok en `maat.*`), niet de analyse.
  `mix.a/b.pos` is de hoorbare positie zonder de extra latentie (de Stroommachine gebruikt
  hem nog niet).
- `xfader` is de ruwe crossfaderstand, niet wat de curve ervan maakt: met een scherpe curve
  hoort de zaal B al bij 0,05, maar wisselt de scène pas bij 0,5 (VRAGEN BE10).
- `beat` komt uit `ctx.currentTime`, dat per audioblok verspringt, en `t` uit
  `performance.now()`: een wiebel van een paar ms die de Stroommachine uitdempt (gemeten:
  0,002–0,007 tel naast). `ctx.getOutputTimestamp()` zou een paar geven dat precies bij
  elkaar hoort; niet gebouwd.
- Een track die opnieuw komt (herverbinden, herladen) laat de Stroommachine dezelfde scène
  opnieuw laden: een zichtbare montage. Netter kan alleen aan haar kant (een `track` met
  hetzelfde `id` negeren; zie het verslag, "Vragen voor de Stroommachine").
- Terugspelen (handelingenlog) stuurt de macro's opnieuw, de regieknoppen niet
  (`OVERSLAAN` in terugspelen.js: vasthouden en paniek zijn schakelaars).

## 8. Eén machine: zonder pc (spoor beeld-een-machine, 10 okt)

Zonder de Omarchy-pc is er geen Stroommachine. De vraag: kan ze op de MacBook zelf
draaien, naast VARVE, met de relay lokaal, en wat kost dat (fps, CPU, gaten in het geluid)?

**Advies tot er gemeten is** (het ontwerp, 10 okt): de standaard voor "ergens heen met
alleen de laptop" is het **zaalbeeld**: Varve's eigen vormen in het losse venster, zonder
clips van anderen (`video.clips`, `docs/BEAMER.md` "Zaalbeeld"). Dat voegt geen proces toe,
de noodknoppen werken, en het gaat mee in de opname. De Stroommachine lokaal is een
**upgrade**: pas na een groene meting (VRAGEN BE11) en nadat je haar één keer zo echt
bespeeld hebt. Zwart (`video.black`) bereikt haar niet, en ze zit niet in VARVE's opname.

**De upgrade-route, als gereedschap** (gebouwd, alleen met `--droog` en in de test gedraaid):
`zsh tools/beeld-lokaal.sh` start op deze Mac de relay en de Stroommachine naast VARVE.
- Eerst één keer `zsh tools/beeld-lokaal.sh --installeer`: een kopie van Chrome for Testing
  in `~/Applications/Stroommachine-Chrome.app` (bundle-id `com.google.chrome.for.testing`).
  Een tweede "Google Chrome" zou VARVE.app de verkeerde Chrome laten aanspreken; het script
  weigert een bundel met `com.google.Chrome` en overschrijft nooit iets.
- Daarna `zsh tools/beeld-lokaal.sh` (VARVE.app moet al draaien: het script start de server
  nooit, het zegt "klik eerst VARVE.app"): de relay op 127.0.0.1:7702 (zonder `--stil`, log
  in `~/.varve-relay.log`, pid in `~/.varve-beeld-lokaal.pid`; draait er al een, dan die) en
  de Stroommachine in Licht met de fps-meter (`--stand normaal|auto`, `--geen-fps`), eigen
  profiel `~/.varve-stroom-chrome`, debugpoort 9393 voor `beeld-lokaal.mjs --kijk`.
- Dan wat jij doet (het script drukt het af): in VARVE de BEELD-rij, knopje **deze Mac**,
  beeld aan; het Stroommachine-venster naar de beamer, `F` volledig scherm, `H` panelen weg;
  **klik daarna terug in VARVE** (anders gaan spatie en cijfers naar de Stroommachine);
  videopaneel dicht; in de Stroommachine niet op `G` (eigen geluid), `I`/`C` (microfoon,
  camera) of MIDI in de Live-tab. **Zwart = APC mapje beeld, Stop All**: een wissel, kijk
  naar het doek.
- `--droog` = alleen de controles en wat het zou starten, met de volledige URL. `--stop` =
  alleen de relay uit het pid-bestand (als dat nog `varve-relay.js` is) en de Chrome met het
  eigen profiel; nooit `pkill`.
- `node test/beeld-lokaal.test.mjs` (29 checks) draait het script als kopie in een map met
  een spatie, met een nep-Stroommachine, een nep-`open` en eigen vrije poorten.

**De meting**: `node tools/headless/beeld-lokaal.mjs` (tools/README.md). De relay op 7712,
een eigen VARVE-server op 8801 met een tijdelijke library, twee Chromes for Testing op
Metal (`--mute-audio`), VARVE met een last zoals je speelt (vier tracks, stems uit een
fixture, keylock, sends, rack, elke 2 s een filter- en faderzwaai), per stand (nul, Licht
en Normaal op 1920 × 1080, het zaalbeeld, Licht op 1280 × 720) CPU en RSS per proces, de
top-5 van de rest van de Mac aan begin en eind, warmte (`thermalState`), lader en accu.
Drie meters:
- **fps**: een eigen rAF-meter in de Stroommachine-tab; ter controle `kwInfo().ms`, dat
  alleen iets zegt met `&fps` in de hash (zonder blijft het 16,7). Harde check.
- **gaten in het geluid**: een hartslag-worklet in `engine.ctx` (het grootste gat tussen
  twee `process()`-aanroepen, het aantal > 15 ms), via het DevTools-protocol, nooit in de
  app. Aan het eind een positieve controle: een aparte context blokkeert 40 ms; ziet de
  meter dat niet, dan is de run FAIL ("meter blind").
- de drift van `getOutputTimestamp` als derde kolom, geen criterium (hij zag in de proef
  van de critici 0 van 12 opgewekte gaten).

Hij weigert te starten als er geluid uit de Mac komt of een ANDER proces > 20 % van een kern
trekt (een andere testrun, een achtergebleven headless Chrome). Systeemdaemons
(`/System/`, `/usr/libexec/`: mediaanalysisd, fileproviderd) houden hem niet tegen; die
pieken op deze Mac geregeld en staan als "achtergrond" in de JSON.

**Stand 10 okt**: de volledige run is **nog niet gedraaid** (niet op de dag van proefavond 1).
Er staan dus nog geen cijfers voor "Stroommachine naast VARVE" in dit document. Wel gedraaid:
- `--zelftest` (geen GPU, geen Stroommachine, stil, 9,6 s): 18 controles groen; hartslag in
  rust max 6 ms, 0 gaten > 15 ms in 452 blokken; de positieve controle van 40 ms gezien.
- De Clay-last zelf, door de reviewer (13:47, headless op Metal, eigen server, zonder
  Stroommachine en relay, `--mute-audio`; een functionele proef, geen meting volgens BE11):
  vier tracks spelen (1, 2 en 4 de demo, 3 de stems-fixture met vier stems), keylock op alle
  vier, de loops houden, op elke track een effect in de slot; de hartslag in `engine.ctx`
  loopt (`running`), over 19,5 s max 6 ms en 0 gaten > 15 ms in 7126 blokken; 0 uitzonderingen.

**Twee dingen die we onderweg vonden** (nagelezen in de Stroommachine-repo, niets gewijzigd):
- `beeld-status.fps` (de tooltip in VARVE) is **vast 63**: `09o-dj.js` regel 138 rekent
  `1000 / (PF.ms || 16)`, en `PF` (`08b-kwaliteit.js`) heeft geen veld `ms`. Gebruik hem
  niet als meting. Voorstel voor haar repo: `KW.fpsNu` meesturen (hieronder, punt a).
- Een worklet uit een Blob-URL laadt niet op een `file://`-pagina (`blob:null`, AbortError,
  CfT 153). De meters werken op VARVE (`http://localhost`); de zelftest serveert zijn
  pagina daarom zelf over http.

**Voorstel aan de Stroommachine** (alleen tekst; gelezen op `0f4124e`, in haar repo is niets
gewijzigd; Clay beslist, en het hoort bij haar eigen stappen, niet bij deze PR):
- (a) **Een echte fps in `beeld-status`**: `09o-dj.js` r.138 stuurt `1000 / (PF.ms || 16)`,
  dus altijd 63. Stuur `KW.fpsNu` (`08b-kwaliteit.js` r.17 en r.100), of het
  3 s-gemiddelde uit `10-app.js` r.1136–1140.
- (b) **Met `&dj` de gevaarlijke toetsen vergrendelen** (of een bevestiging vragen): `G`
  (eigen geluid, `toggleSound`, `10-app.js` r.914), `I` en `C` (microfoon en camera,
  r.919 → `liveKey`, `09c-live.js` r.571) en de MIDI-knop in de Live-tab (`lvMidi`,
  `09c-live.js` r.619 → `liveMidiToggle`, r.339). Op één Mac staan VARVE en de
  Stroommachine naast elkaar; één toets in het verkeerde venster zet dan een tweede
  geluidsbron aan, of MIDI pakt de APC (huisregel 1). Tot die vergrendeling er is, drukt
  `tools/beeld-lokaal.sh` het af als regel 5 van wat jij doet.
- (c) **De kwaliteitsstand als poort** (`kwaliteit.stand`: auto, licht, normaal of zwaar;
  nu alleen via de hash `#licht` of haar eigen paneel, `kwZet` in `08b-kwaliteit.js` r.43),
  zodat VARVE of de APC haar lichter kan zetten als de Mac het zwaar krijgt. En `ms`,
  `kwaliteit` en `scale` in `beeld-status`, zodat de tooltip in VARVE laat zien hoe zwaar
  ze het heeft. Nu kan dat alleen via `kwInfo()` en DevTools (`beeld-lokaal.mjs --kijk`,
  poort 9393).
- (d) **`hold` en `paniek` in `beeld-status`** (VRAGEN BE4): pas dan weet VARVE of zwart op
  de Stroommachine staat. Tot dan geldt "zwart = mapje beeld, Stop All, kijk naar het doek".

Daarnaast staat v10 (deck-video's synchroon) nog los (BE14 e). Pas na (d), of als de
Stroommachine in het losse venster van VARVE komt (BE12), is ze een kandidaat voor de
hoofdroute in een zaal.

**Voorstel aan de hub** (AV-app-hub, `main` = `6b101f8`; alleen gelezen, de hub-repo is hier
niet aangeraakt): nu **geen hub-set** voor beeld op één machine.

Wachten is niet het probleem. Een Stroommachine die zich nooit bij de hub (7700) meldt
(haar `?hub=` wijst naar de relay, en ze kan er maar één aan) hoeft niet na 60 s op `MIS`
te staan. Het setveld **`wacht: "kern" | "poort" | "geen"`** bestaat al sinds 3 okt:
- `src/sets/set.js` r.19 en r.28, gecontroleerd in r.113–116;
- `src/sets/starter.js` r.93 en r.276–277;
- `docs/SETS.md`, tabel "Een set schrijven", rij `wacht`;
- in gebruik in `sets/meditatie.json`: av-kern met `"wacht": "poort"`.

De echte belemmeringen zijn twee andere:
- (a) **Geen repo.** Een set mag alleen een app starten die `config.json → apps.<id>.repo`
  heeft (`set.js` r.104). `stroommachine` heeft daar geen `repo`. Haar `_doc` zegt nog
  "Nog geen eigen GitHub-repo", maar `github.com/CKrebbers/stroommachine` bestaat
  intussen. Voor de relay (`tools/varve-relay.js` in die repo) is er geen app.
- (b) **De verkeerde Chrome.** De starter opent elke `url` met `open -a "Google Chrome"`
  (`src/sets/systeem.js` r.72, `openInChrome`). Dat is Clay's Chrome met VARVE erin, en
  dat moet hier juist niet: de Stroommachine hoort in haar eigen bundel
  (`Stroommachine-Chrome.app`, BE14 a), anders spreekt VARVE.app de verkeerde Chrome aan.

Het voorstel aan de hub-eigenaar (alleen tekst, Clay beslist):
1. `repo` voor `stroommachine` in `config.json`, het pad in `sets/paden.json`, en de `_doc`
   bijwerken.
2. De relay als eigen app (bijvoorbeeld `varve-relay`: repo `stroommachine`, poort 7702,
   `start.commando` `node tools/varve-relay.js {poort}`, `url: null`, `"wacht": "poort"`),
   of als `start` van de app `stroommachine` met `"wacht": "poort"` op 7702.
3. Een manier om een URL in een andere bundel te openen (een veld per app in de set, naast
   `url`), of `url: null` met een `start.commando` dat zelf
   `open -na ~/Applications/Stroommachine-Chrome.app --args … --app=<url>` doet, met
   `"wacht": "geen"`. Dat is wat `tools/beeld-lokaal.sh` nu doet.

Punt 1 en 2 zijn alleen config; punt 3 is het echte werk. Het spoor *draagbaar* kan
intussen een controle `beeld.relay` toevoegen (poort 7702 open, `status.json` zegt
varve-relay): daar hoort "klaar voor beeld lokaal". Tot dan is `tools/beeld-lokaal.sh` de
weg, en na de speelproef een Dock-app "VARVE + beeld" (BE14 b).

**Nog niet gebouwd of gedaan**: de volledige meting (morgen, of na "de Mac is vrij tot X"),
de speelproef met de APC (30 min: eerst de VARVE.app-toets met de eigen bundel open), de
lange meting op de accu, de Dock-app "VARVE + beeld", en `--installeer` op deze Mac (het
script is alleen met `--droog` en in de test gedraaid).
