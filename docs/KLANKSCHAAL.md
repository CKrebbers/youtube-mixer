# Klankschaal in Varve (gebouwd 29 september 2026)

Clay (29 sep): "ik wil de klankschalen als een soort plugin verwerken in varvedj
… de klankschalen spelen op de juiste tuning gebaseerd op audio van andere
tracks, maar wel de mogelijkheid houden om te veranderen."

Gebouwd vanaf de Omarchy-machine (via ssh op de Mac), in één sessie. Nog niet
beluisterd door Clay en nog niet op de APC geprobeerd.

## 1. Wat het is

Het geluid van de **Waterschaal** (`~/Projects/waterschaal/td/waterschaal-lokaal.html`,
28 sep): een modaal model van een klankschaal. Een kern (de schaal zelf, zes
paren boventonen met zweving), acht toonvelden op een ring (zoals een handpan)
en een lichaam (een doffe klop). Aanslaan, wrijven (stick-slip: de schaal gaat
zingen) en dempen. Vier soorten: brons, kristal, glas, gong.

In Varve is het **geen pluginsysteem** (docs/plugins/01-plan.md, punt 4: "geen
pluginsysteem, gewone modules"), maar een instrument naast de sampler:
`engine.klankschaal`, met actions `klankschaal.*` en een rij op het scherm.

## 2. De stemming: waar de toon vandaan komt

De schaal volgt **wat je hoort**, dezelfde bron als de toonsoort in de kolomkop
(`deck.toonsoort`, docs/TOONSOORT.md): de toonsoort van het stuk waar de track
nu is, plus pitch (zonder keylock), plus de **stemming in cent** van dat stuk.
Een plaat die 43 cent hoog gestemd is, krijgt een schaal die 43 cent hoog staat.

| Volgen (`klankschaal.volg`) | Bron |
|---|---|
| **maat** (standaard) | de track die de maat geeft: dezelfde als de MAAT-badge, sync en de sampler (met hysterese) |
| **focus** | de track met focus |
| **met de hand** | een vaste toonsoort. Overschakelen houdt de toon die hij volgde: niets verspringt |

Heeft de gevolgde track (hier) geen toonsoort (niet geanalyseerd, "~", stilte),
dan blijft de schaal op de **laatste** toon die hij wel had, en kleurt de naam
op het scherm oranje. Nooit een sprong naar een standaard.

**Toonladder** van de acht velden (`klankschaal.toonladder`):

| Ladder | Stappen t.o.v. de tonica | Soort |
|---|---|---|
| auto | Kurd bij mineur, majeur bij majeur | |
| Kurd | −5 −4 −2 0 2 3 5 7 | mineur (D Kurd = A B♭ C D E F G A, de Waterschaal) |
| Celtic | −5 −2 0 2 3 5 7 10 | mineur |
| penta mineur | −5 −2 0 3 5 7 10 12 | mineur |
| Hijaz | −5 −4 −1 0 2 3 5 7 | mineur met verhoogde septiem: bewust niet diatonisch |
| majeur | −5 −3 −1 0 2 4 5 7 | majeur |
| penta majeur | −5 −3 0 2 4 7 9 12 | majeur |

Past de ladder niet bij de toonsoort (Kurd op een track in C majeur), dan komt
hij op de **relatieve** toonsoort (A Kurd): precies de tonen van de plaat. De
test controleert voor alle 24 toonsoorten en alle diatonische ladders dat elke
toon van de schaal in de toonladder van de plaat valt.

**Register:** de kern ligt altijd rond D3 (G♯2..G3), de ring een octaaf hoger,
waar de Waterschaal voor gemaakt is. Transponeren met 12 verandert dus de naam
niet het register.

**Zelf veranderen**, bovenop wat hij volgt: − en + (halve tonen, tot ±12), FIJN
(−50..+50 cent), 0 (beide terug), TOON (draaiknop, 24 standen in wijzervolgorde,
zet volgen op hand). De transpositie blijft staan als je van bron wisselt.

**Wanneer hij omstemt:** bij elke aanslag, bij elke wijziging aan een deck
(tempo, pitch, grid, play, andere maatgever) en per frame zolang de rij open
staat. Onder een halve cent verschil niet (de pitchfader bestookt de worklet
niet). Wat klinkt schuift mee: de resonatoren houden hun uitwijking, alleen de
frequentie verandert. Geen klik, maar een ringende schaal die van toonsoort
wisselt, glijdt direct naar de nieuwe toon (zie §6, vraag KS2).

## 3. De bouw

| Bestand | Wat |
|---|---|
| `src/engine/klankschaal-kern.js` | `SchaalKern` (het modale model, per sample) en `bouwModi()`. Puur, in Node testbaar |
| `src/engine/klankschaal-worklet.js` | de AudioWorklet (`varve-klankschaal`): berichten door, `render()` per blok |
| `src/engine/klankschaal.js` | `stemming()` (puur), `TOONLADDERS`, en `Klankschaal`: volgen, aanslaan, wrijven, dempen, volume, sends |
| `src/engine/engine.js` | `this.klankschaal` naast de sampler, op de master-ingang en send A/B; stemt mee in `volgMaat` |
| `src/control/actions.js` | alle `klankschaal.*` actions (eerst `define()`, zoals afgesproken) |
| `src/ui/klankschaal-paneel.js` | de rij openen en sluiten, instellingen bewaren (`localStorage` `varve.klankschaal`), per frame tekst en oplichten |
| `index.html`, `styles.css` | knop "klankschaal" in de balk, de rij onder de sampler (standaard dicht) |
| `test/klankschaal.test.mjs` | stemming, geluid (toonhoogte gemeten), slapen, dempen, wrijven, afval, de klasse, de engine en de bus |
| `tools/headless/klankschaal.mjs` | in echte (headless) Chromium: worklet laadt, toon op het scherm, toonhoogte gemeten, laptopmaat |

Verschillen met de Waterschaal, voor het audiopad (docs/AUDIOPAD.md):
- geen afval per blok (gemeten: 0 GC over 3000 blokken), toeval alleen uit de
  eigen LCG, niet `Math.random` op de audiothread;
- de kern **slaapt** als er niets klinkt: dan kost hij niets en is het stil;
- de "lucht" (zachte ruis) alleen tijdens het wrijven, geen ruisbed;
- geen weer, adem, vulling, ruimte en compressor: galm komt van send B;
- de worklet laadt pas als je de rij opent of voor het eerst aanslaat.

Rekentijd: 0,08 ms per blok van 128 frames (2,67 ms audio) met alles aan, op
de Ryzen 5800X, 0,13 ms op de M1 (29 sep).

**Luidheid** (gemeten in Node, `UIT_OPHOGING` en `VELD_OPHOGING` in klankschaal.js):
zonder ophoging piekte een veld op −28..−33 dBFS naast tracks van −14 LUFS.
Nu, bij VOL 0,8 en KRACHT 0,7: kern ~−9 dBFS piek, velden ~−12..−17 dBFS,
wrijven ~−18 dBFS rms. De limiter van de master vangt alles vol open op.

## 4. Bediening

Knop **klankschaal** in de balk opent de rij (blijft onthouden). In de rij:
volgt maat/focus/hand · de toon (bovenaan de naam, eronder waar hij vandaan
komt en de cent) · − + 0 · ladder · soort · de kern (●) en acht velden (met
hun nootnaam) · wrijf (vasthouden) · demp (vasthouden) · TOON FIJN KAR UIT
KRACHT GALM VOL.

**Op de APC: nog niets.** Er is geen plek in de standaardmapping (die raakt je
spiergeheugen; zie §6, KS1). Alles is een action, dus **koppelen** (MIDI-learn)
werkt meteen: bijvoorbeeld de acht velden op een rij grid-pads, wrijf op een
knop die je vasthoudt, FIJN op een encoder. Het handelingenlog neemt aanslagen
op en speelt ze terug.

| Action | Soort | Wat |
|---|---|---|
| `klankschaal.kern`, `klankschaal.veld.1..8` | trigger | aanslaan; read 1 zolang hij oplicht (0,25 s) |
| `klankschaal.wrijf`, `klankschaal.demp` | trigger | zolang ingedrukt |
| `klankschaal.volg` | trigger | maat → focus → hand; read 0 / 0,5 / 1 |
| `klankschaal.toon` | value | 24 standen (wijzer), zet hand |
| `klankschaal.transpose.up/.down/.reset` | trigger | ±1 halve toon, reset = 0 en fijn 0 |
| `klankschaal.fijn` | value | −50..+50 cent (0,5 = 0) |
| `klankschaal.toonladder`, `klankschaal.klank` | trigger | volgende ladder / soort |
| `klankschaal.karakter`, `.uitklank`, `.kracht`, `.volume`, `.send.a`, `.send.b` | value | |

## 5. Wat getest is en wat niet

Getest (29 sep, op de Omarchy-machine, kopie van de repo):
- `node test/klankschaal.test.mjs`: alle checks groen. Onder meer: D Kurd gelijk aan de
  Waterschaal (< 0,1 ct), toonhoogte van een aanslag gemeten op A3 +43 ct = +43,0 ct,
  omstemmen tijdens de klank, slapen na uitklinken, dempen, wrijven, geen afval.
- `node test/alles.mjs`: groen op één na, `vormen-isomorf` "tv: 0.000 ms op 360²",
  een tijdmeting die op Linux ook zonder deze wijziging faalt (timerresolutie).
- `node tools/headless/klankschaal.mjs` in headless Chromium 152 (Linux): worklet laadt,
  scherm "Am Kurd / track 1 · +43 ct", veld 4 gemeten 225,7 Hz (+44,5 ct, FFT-resolutie
  ~11 ct), na +2 met de hand B3 op 1,0 ct, wrijven zingt, rij op één regel,
  geen consolefouten. Foto's in `tools/headless/uit/klankschaal-*.png`.
- Daarna op de Mac zelf (M1, Node 26.8.2, Playwright-Chromium): `klankschaal.test` en
  `tools/headless/klankschaal.mjs` groen, zelfde metingen (B3 op −0,2 ct).
  `alles.mjs` op de Mac: alleen `ingest.test` rood, omdat **yt-dlp niet op de Mac staat**
  (niet op het pad, niet in Homebrew, niet in ~/.local/bin). Los van de klankschaal,
  maar YouTube-links binnenhalen werkt zo ook niet.

Niet getest:
- **Beluisterd**: niemand heeft het gehoord. Klinkt het mooi naast een track?
- In Clay's eigen Chrome met de APC aangesloten, naast acht streamende decks.
- Op laptopmaat (1440 × 790) kost de open rij ~50 px onderaan; de kolomfaders
  vielen daar al half weg. Dicht kost hij niets.

## 6. Open vragen voor Clay (ook in VRAGEN blok K)

- **KS1 🎛 APC-plek.** Advies: een eigen mapje "klankschaal" (de acht velden op
  grid-rij 1, kern op rij 2 kolom 1, wrijf/demp ernaast, FIJN en KRACHT op de
  device knobs), als fragment zoals "vorm", zodat je eigen mapping blijft
  staan. Eerst luisteren, dan beslissen.
- **KS2 👂 Omstemmen tijdens de klank.** Nu glijdt een ringende schaal direct mee
  naar een nieuwe toonsoort. Alternatief: pas bij de volgende aanslag omstemmen
  (een echte schaal kan niet van toon wisselen). Advies: eerst horen.
- **KS3 👂 Luidheid.** Is VOL 0,8 de goede standaard naast je tracks?
- **KS4 💬 Op de maat.** Aanslagen op de tel laten vallen (zoals de sampler) als
  quantize aan staat? Niet gebouwd: niet gevraagd.
- **KS5 💬 Eigen schaal.** De Waterschaal kan een opname van een echte schaal
  meten (grondtoon, boventonen, zweving). Die meting hierheen halen als vijfde
  soort? Niet gebouwd.
