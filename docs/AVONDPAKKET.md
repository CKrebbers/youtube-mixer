# Avondpakket: één controle vóór vertrek en bij aankomst

*10 okt 2026, spoor "draagbaar" (VISIE §3: de draagbare set). Ontwerp:
`uitwerking/draagbaar/5-ontwerp-definitief.md` (kladmap van de sessie van 10 okt).
Stand: **stap 1 van 10 gebouwd** (de pure kern). De tegel, de route en de CLI bestaan nog
niet; zie "Wat er nog niet is".*

## 1. Wat het is

Eén **alleen-lezen** controle die op twee momenten dezelfde vraag beantwoordt:
**kan ik met deze tas vertrekken** en **kan ik hier beginnen**. Bij vertrek kijkt hij naar
wat onderweg niet meer te herstellen is (audio en instellingen echt lokaal, library
compleet, schijf, accu en lader, backup, geen achtergrondwerk); bij aankomst naar wat er
aanhangt (geluidsuitgang, APC, Scarlett, Maschine, de AV-hub, Bluetooth, Tailscale, één
server op `library.db`). Hij repareert niets, schrijft niets en meet niet terwijl er een
deck speelt.

Straks bedient Clay hem vanuit **VARVE in het Dock → Controlekamer → tegel Avondpakket**;
`node tools/avondpakket.mjs` is voor Claude, agents en als terugval.

## 2. Wat er nu is (stap 1)

| bestand | wat |
|---|---|
| `server/avondpakket.js` | parsers (`pmset -g batt`/`ac`, `ioreg` accu en USB, `df -k`, `defaults read com.apple.bird optimize-storage`, `system_profiler` audio/Bluetooth/USB-host, `tailscale status --json`, `find -exec stat` en `find -flags +dataless`), `leesProfielen`, `herkenUsb`, `kiesFase`, `verwachteBestanden`/`vergelijkCompleet`, `beoordeel`. **Puur**: geen I/O, geen kindprocessen, `nu` van buiten |
| `avondpakket/profielen.json` | de data: apparaten (hoe te herkennen), vijf profielen, grenzen, `bekend`, `hardwareBevestigd` |
| `src/controle/avondpakket-tegel.js` | de tegel als pure functie (nog niet in `controle.js`) |
| `test/avondpakket.test.mjs` + `test/fixtures/avondpakket/` | 161 checks op echte (geanonimiseerde) en handgemaakte uitvoer; zie de `LEESMIJ.md` daar |

Niets in `src/engine/`, geen actions, geen route, geen wijziging in bestaande bestanden.

## 3. De profielen (data, zelf in te stellen)

`avondpakket/profielen.json`. Per onderdeel `verwacht`, `optioneel` of `nee`. Een nieuwe
controller of geluidskaart is een regel onder `apparaten` (naam als regex, USB `vid:pid`
in hex), geen code.

| profiel | mee | Varve kan | niet, en het alternatief |
|---|---|---|---|
| `laptop` | laptop, bedrade koptelefoon | fader: één tegelijk met de muis · filter/fx/echo op de focus-track · alles met toetsenbord | geen overgang met de hand; geen aparte cue (2 kanalen) |
| **`apc`** (standaard, de kern) | + APC40 mkII, Scarlett 2i2, PD-hub | **fader 8 tegelijk · filter · fx · echo** (Clay's vier meest gebruikte gebaren) en het volledige DJ-werk zonder hub (`docs/APC40.md`) | bladeren/laden vanaf de APC (ONTBREEKT B10): muis of toetsenbord |
| `maschine` | + Maschine MK2 (+ LPD8), Scarlett, AV-hub | **geen fader** (overgangen met de muis) · filter/fx/echo op de focus-track · pads, patronen, Strip/Rack, secties, sampler, wiel | play/pauze, crossfader, tempo per deck (`docs/MASCHINE.md` §5c) |
| `alles` | APC + Maschine + LPD8 + hub (avond 2) | alles van apc én maschine | Bank = hubtoets |
| `beeld` | APC + Scarlett + Tailscale naar `clayk` (avond 3) | alles van apc + de Stroommachine volgt klok en nummer | HDMI-adapter en de voeding van de pc apart |

Advies: **APC + Scarlett + bedrade koptelefoon + PD-hub + lader (≥ 30 W)** is de kleinste
set voor een volledige DJ-set. Maschine en AV-hub pas na avond 2 (de hub-lease is nog
nooit op de hardware geproefd).

## 4. Fase en oordeel

- **Fase `auto`** (standaard): hangt er geen apparaat van het profiel aan en is de
  standaarduitvoer ingebouwd, Bluetooth of virtueel, dan `vertrek`; anders `aankomst`.
  Profiel `laptop` is altijd `aankomst` (niets in te pakken).
- **Vertrek** toetst alleen het thuiswerk. Apparaten, geluid en de USB-hub zijn dan grijze
  **paklijstregels** ("inpakken: APC40 mkII + USB-B → USB-C"), nooit oranje.
- **Aankomst** toetst alles. Een verwacht apparaat dat ontbreekt is rood, **behalve zolang
  `hardwareBevestigd: false`**: dan hooguit oranje, want de uitvoer van aangesloten
  hardware is nog niet gezien (stap 7a/7b).
- **Oordeel**: `klaar` = geen rood (met "let op n" als er oranje is); anders "nog niet
  vertrekken" of "nog niet beginnen".
- **`bekend`**: een punt-id in die lijst dat oranje zou zijn, wordt grijs "bekend: …" en
  telt niet mee. Rood wordt nooit onderdrukt. Standaard: `["icloud"]`.
- Een sonde die faalt of te traag is: grijs "niet gemeten", nooit rood.

| punt | groen | oranje | rood |
|---|---|---|---|
| media lokaal | > 0 bestanden, niets uitgeplaatst | alleen buiten de nummers (`backups/`) uitgeplaatst | iets in `<id>/` of `library.db`/`kaart.db` uitgeplaatst: "open in de Finder, klik het wolkje, thuis" (leeg/ontbreekt = grijs) |
| instellingen lokaal | niets uitgeplaatst | code uitgeplaatst | `mappings/`, `racks/`, `patronen/`, `plannen/`, `Input/`, `proef/` uitgeplaatst |
| iCloud | optimaliseren uit, of aan met ≥ 50 GiB vrij | aan en < 50 GiB vrij | — |
| schijf | ≥ 50 GiB | 20-50 GiB | < 20 GiB |
| accu | vertrek ≥ 80 %; aankomst aan een lader ≥ 30 W | < 80 % bij vertrek; zwakke lader (nu **8 W**); op de accu bij aankomst | < 20 % op de accu |
| geluid (aankomst) | standaard ≥ 4 uitgangen, niet virtueel, geen Bluetooth | Bluetooth, 2 kanalen ("geen aparte cue"), virtueel; met de tip welk 4-kanaals apparaat te kiezen | dezelfde, als `hardwareBevestigd` |
| Bluetooth (aankomst) | uit, of aan zonder audio-apparaat | een koptelefoon/speaker verbonden: "zet Bluetooth uit" | — |
| AV-hub (7700) | past bij het profiel | verwacht en dicht bij vertrek; `nee` en open ("kan de APC vergrendelen") | verwacht en dicht bij aankomst |
| servers | één proces op `library.db` | onbekend en ≥ 2 Varve-servers | ≥ 2 processen op `library.db` |
| Tailscale | Running | niet Running als `verwacht` (vertrek); peer offline (`beeld: verwacht`) | niet Running als `verwacht` (aankomst) |
| backup | kopie zonder latere wijziging; sub altijd "kopie staat op deze Mac (gaat mee in de tas)" | wijziging nog in geen kopie | mislukt, of nog nooit een kopie |
| achtergrond | wachtrijen leeg, nacht uit of vandaag speeldag | iets in de wachtrij; nacht aan zonder speeldag; bij vertrek een split bezig | een split of ingest bezig bij aankomst |
| library compleet | elk verwacht bestand er en > 0 B | — | een bestand mist of is 0 B |

## 5. Paklijst en poorten

De Air (`MacBookAir10,1`) heeft **twee** USB-C-poorten; lader + Scarlett + APC zijn drie
stekkers. Daarom een **USB-C-hub met PD-ingang** (lader in de hub, hub in de Mac).

| profiel | poort 1 | poort 2 | aan de PD-hub |
|---|---|---|---|
| `laptop` | lader | — | — |
| `apc` | APC40 mkII direct | PD-hub | lader (≥ 30 W) · Scarlett 2i2 |
| `maschine` | PD-hub | — | lader · Scarlett · Maschine · LPD8 |
| `alles` | APC direct | PD-hub | lader · Scarlett · Maschine · LPD8 |
| `beeld` | APC direct | PD-hub | lader · Scarlett · USB-C→HDMI (als de hub hem heeft) |

1. MacBook Air + **lader ≥ 30 W USB-C PD** (nu hangt er een 8 W-lader aan; accu 78 % van ontwerp, 591 cycli)
2. USB-C-hub met PD-ingang (apc, maschine, alles, beeld)
3. **Bedrade** koptelefoon + verloop 6,3 → 3,5 mm (de Mac-uitgang is de cue; AirPods = Bluetooth, 2 kanalen, latency)
4. Scarlett 2i2 + USB-C → USB-C
5. Speaker + netsnoer + 2× jack naar de ingang van de speaker
6. APC40 mkII + USB-B → USB-C (apc, alles, beeld)
7. Maschine MK2 en LPD8, elk USB-B → USB-C (maschine, alles)
8. Stekkerdoos (lader, speaker, hub)
9. ☐ Een kopie van `library.db` (liefst ook `media/`) **blijft thuis**: de backups in `media/backups/` gaan mee in de tas
10. (beeld) USB-C → HDMI, de Omarchy-pc + voeding, netwerk voor Tailscale

## 6. Ritueel

**Vóór vertrek (thuis, ~5 min)** — zodra de tegel er is (stap 5):
1. VARVE in het Dock → Controlekamer → tegel Avondpakket (fase springt op `vertrek`). Doel: "klaar".
2. Rood media/instellingen: map openen in de Finder, het wolkje klikken, wachten; tegel opnieuw klikken.
3. Accu tot ≥ 80 %; achtergrond: vandaag als speeldag, of de split laten aflopen.
4. Paklijst van het profiel afvinken, inclusief regel 9.
5. Niets meer binnenhalen (huisregel).

**Bij aankomst (5 stappen)**:
1. Stekkers: lader in de PD-hub, hub in poort 2, APC in poort 1, Scarlett aan de hub, koptelefoon in de Mac, speaker aan de Scarlett (speaker nog uit). **Bluetooth uit.**
2. Systeeminstellingen › Geluid › uitvoer = het samengestelde apparaat (`docs/STUDIO.md` §3).
3. Tegel Avondpakket, profiel kiezen (fase springt op `aankomst`). Rood: eerst de regel die de tegel noemt.
4. Mixer openen, audio starten, KOPTELEFOON-rij "zaal 1/2 · koptelefoon 3/4"; cue proberen met de fader dicht, dan pas de speaker aan.
5. Vanaf nu meet het pakket niet meer (de server ziet het deck).

**Tot de tegel er is, met de hand** (alles alleen lezen; niet tijdens het spelen):

```sh
R="$HOME/Desktop/1. Projects/Youtube mixer"   # de echte checkout
find "$R/media" -type f -flags +dataless | wc -l          # 0 = alles lokaal
defaults read com.apple.bird optimize-storage             # 1 = macOS mag media/ naar iCloud zetten
df -h /System/Volumes/Data | tail -1                      # vrije ruimte
pmset -g batt; pmset -g ac | grep Wattage                 # accu en het vermogen van de lader
system_profiler SPAudioDataType | grep -B2 -A6 "Default Output Device: Yes" | grep -E ":$|Channels|Transport"
ioreg -p IOUSB -w0 | grep -iE "apc|maschine|lpd8|scarlett|focusrite|xboard"
nc -z 127.0.0.1 7700 && echo "hub draait" || echo "geen hub"
lsof -t -- "$R/media/library.db" | wc -l                  # 1 = één proces op de library
tailscale status | head -3
```

## 7. Hoe te testen

```sh
node test/avondpakket.test.mjs     # puur, < 1 s: parsers, profielen, fase, oordeel, tegel, privacy
node test/alles.mjs                # alles (neemt het nieuwe bestand vanzelf mee)
```

Geen headless-check in deze stap: er is nog geen route of DOM-koppeling.

## 8. Wat niet getest is

- **De vorm van aangesloten hardware** (APC, Scarlett, Maschine, LPD8 in `SPUSBHostDataType`
  en `ioreg`; een samengesteld apparaat in `SPAudioDataType`) is **niet gezien**: die
  fixtures zijn HANDGEMAAKT en de parser matcht daarom ruim. Daarom `hardwareBevestigd: false`.
- De USB-id van de APC (`09e8:0029`) is niet geverifieerd; de naam-regex `apc40` moet het
  dan doen.
- Niets is tegen een draaiende server, de echte `media/` of echte hardware gedraaid; er
  is nog geen sonde die commando's uitvoert.
- Clay's gebruikscijfers in de `kan`-regels (11.796× fader enz.) zijn overgenomen uit het
  stappenplan van 9 okt, niet nagerekend.

## 9. Wat er nog niet is (volgende stappen)

2. `meet()` (de commando's in kindprocessen met time-outs), `maakCache`, `tools/avondpakket.mjs` (exit 0/1/2/3).
3. `Backups.stand().gewijzigdSinds`.
4. `GET /api/avondpakket` met `compleet`, `achtergrond` en de bevriezing op `speeltDeck()`.
5. De tegel in `controle.js`/`controle.html` en `tools/headless/avondpakket.mjs`.
6. Verwijzingen in `CONTROLEKAMER.md`, `APC40.md` (r.50), `STUDIO.md` §3, `TAILSCALE.md`, `ONTBREEKT.md`, `CLAUDE.md`.
7. **7a**: de hardware-uitvoer van de proefavond vastleggen (mixer dicht, apparaten nog aan);
   **7b**: uittrekproef met Clay, daarna `hardwareBevestigd: true`.

Open keuzes voor Clay (speaker en koptelefoon, PD-hub, kopie buiten de laptop, iCloud,
"de speellijst", grenzen, fase `auto`) staan in het ontwerp, §7.
