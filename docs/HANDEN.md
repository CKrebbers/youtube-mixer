# Handen: de controllers en de hub als drager

*11 okt 2026, tak `visie/handen`. Ontwerp: mini-spoor extra-2 van de uitwerking van de visie
(`scratchpad/uitwerking/extra-2/ontwerp.md`, synthese §4b.2). Vragen: `docs/VRAGEN.md` blok HA.*

`docs/VISIE.md` §2 noemt de controllers de tweede drager van Varve. Dit document zet ze naast
elkaar: wat elke knop van de APC40 mkII, de Maschine MK2, de LPD8 en de Xboard49 in Varve doet,
waar nog plek is, en welke nieuwe actie er als voorstel op een vrije plek staat. Daarnaast de
volgorde waarin de hub en avond 2 geproefd worden, en de keuze welke controllers onderweg mee gaan.

`apc.html` en `maschine.html` blijven de live kaarten; dit is de overzichts- en afdruklaag, zoals
de spiekbrief van de hub dat voor de manifest-apps is. Het deel tussen de markers onderaan
(§4) maakt `node tools/handen/handenkaart.mjs` uit de data; de rest is met de hand geschreven.

## 1. Uitgangspunten

- **Data, geen code** (VISIE §5.3). De kaart komt uit bestaande data: de standaardmappings, het
  action-register, de controltabel van de hub, de LPD8-rollen, `handen/voorstel.json`, de
  profielen en de handelingenlogs. Een nieuwe plek voor een actie komt eerst via **learn**
  (Clay's eigen mapping als verschil, `docs/MAPPING-VERSCHIL.md`), daarna pas in de standaard,
  en dat pas na een proef op het apparaat (§5.4). **Deze tak verandert geen enkele mapping.**
- **Pijlers** (§5.1). De kaart dient alle vier: hij laat zien waar dj'en, produceren,
  programmeren en instellen op de handen liggen. De proefvolgorde dient §5.4, de kernset §5.2.
- **Draagbaar** (§5.2). Niets nieuws in de tas: de kaart is een A4 (`--html`, ⌘P) of een scherm.
- **Twee repo's, twee eigenaren.** Varve (deze tak) en de AV-app-hub (hier alleen gelezen). Wat de
  hub raakt, staat in §5 als tekstvoorstel, niet als tak.
- **Bedoeling, niet werking.** Tot de hub-middag (§2) is niets hiervan op de hardware nagelopen,
  behalve modus 0x42 en de kanalen van de device knobs van de APC (23 sep).

## 2. Eén proefvolgorde voor de hub en avond 2

Avond 2 had twee proeflijsten die elkaar niet kennen: de F0-proef en de proef speelapparaten van de
hub (`AV-app-hub/docs/HARDWARE-AVOND.md`, zonder Varve, zonder draaiende hub) en de Varve-speellijst
van avond 2 (64 punten, 154 min, mét draaiende hub). De volgorde is dwingend: de F0-proef kan niet
naast een hub of een Varve-tab met de APC (de lampjes vechten), en avond 2 van Varve kan niet zonder
draaiende hub. Samen ±5 uur; dat past niet in één avond.

**Het principe:** de F0-proef is een **eigen dagdeel zonder muziek** ("hub-middag", ±80 min,
overdag, geen speaker nodig: het gaat om lampjes, knoppen en twee JSON-bestanden), **vóór** avond 2.
Avond 2 begint dan met `npm run check -- studio` in plaats van met hopen. Beide lijsten blijven in
hun eigen repo, maar de Controlekamer van Varve heeft de hub-middag als blok
(**"Avond 2 · Hub-middag: de F0-proef (zonder Varve)"**, ids `hf-…`, vóór "Avond 2 · Opstarten met
de hub"), zodat Clay op één plek afvinkt.

| Dagdeel | Wat | Min | Voorwaarde | Levert |
|---|---|---|---|---|
| **2a hub-middag** | `doctor` → F0-proef (26 stappen) → speelapparaten (21) → push → `check -- studio` | 80 | geen hub, geen Varve-tab, Logic/Ableton dicht; APC direct in de Mac, Maschine/LPD8/Xboard via de PD-hub | `proef/*.jsonl` (golden tests), `lpd8-profiel.json`, de echte Xboard-CC's, V1–V5 van de hub; dezelfde stekkers als 7a van het avondpakket (die twee alleen-lezen-commando's in dezelfde minuut) |
| verwerking | Claude, in de hub-repo: golden tests, `config.json` (`ringen_nemen_waarde_over`, `led_max`), Xboard-CC's naar `mappings/xboard49.json` zonder aanname, eventueel LED opnieuw sturen bij loslaten (V3) | 2–4 u agent | de gepushte bestanden | "klaar als" F0 van de hub afgevinkt; `sp-xknoppen` toetst dan de echte CC's |
| **2b avond 2 (kern)** | `hb-start` (na `check`), `hb-lpd8`, spelen (15 punten), patronen (8) | 57 | 2a groen | het eerste oordeel over Maschine, Xboard en LPD8 in Varve |
| 2b (als er tijd is) | de vijf sectieblokken (67 min), de Maschine als DJ-bediening (15), bladeren en sampler (15), crossover (8, alleen als CX4 "nee" is) | 105 | — | — |
| 3 | beeld met de pc (25) | 25 | Tailscale | — |

Uit `HARDWARE-AVOND.md` heeft Varve **niet** nodig: blok 3 (oefenruimte, voor manifest-apps),
blok 4 (set `meditatie`, MediSynth en Waterschaal) en blok 5 (opnemen met LPD8-pad 4; kan op 2b
nuttig zijn als tweede log). Wel: blok 1 (voorbereiden), 2 (F0-proef), 8 (speelapparaten) en 6
(pushen).

## 3. De kernset onderweg

| Optie | Tas (naast laptop, Scarlett, koptelefoon, speaker, lader) | Hub | Wat je kunt | Wat niet | Toets VISIE §5 |
|---|---|---|---|---|---|
| **K1 APC alleen** (= profiel en opstelling `apc`) | APC + USB-B-kabel | nee | 100 % van de top-15 handelingen; alle grid-modi; cue; opname; beeld-noodknoppen; mapje vorm | pads, stappen en bladeren vanaf een controller; instrumenten alleen via het schermklavier; geen LPD8 | §5.2 het lichtst; §5.4 deels geproefd (0x42, 23 sep) |
| **K2 APC + Maschine via de hub** (= `alles`) | + Maschine + kabel; PD-hub (3 stekkers) | **ja** | alles van K1 plus pads, stappen, secties en sampler op de pads, bladeren met het wiel, Strip/Rack-pagina's; LPD8 kan erbij; Bank = hubtoets | niets, als de hub het doet | §5.1 alle pijlers; §5.4 **nul** geproefd (hub, Maschine, lease) |
| **K3 Maschine alleen via de hub** (= `maschine`) | Maschine | ja | pads, patronen, Strip op de focus-track | "geen fader: overgangen met de muis" (het profiel zelf) | breekt pijler 1 voor een set; alleen voor produceren thuis |
| **K4 APC + LPD8 via de hub** | + LPD8 (klein) | ja | K1 + beeld, puls en zwart op drie knoppen + snapshots | in Varve maar 3 functies op 16 knoppen | de hub voor drie knoppen is te zwaar (§5.2); pas zinvol als av-kern in de set zit (dan acht + paniek) |
| Xboard49 | 49 toetsen | nee | noten met aftertouch | geen reisspul (draagbaar); de Maschine-pads geven dezelfde noten 36–51 | thuis |

**Advies:** K1 nu (avond 1 en de eerste reis-sets), K2 als doel zodra de hub-middag groen is en
avond 2b het bevestigt; de LPD8 alleen mee als av-kern meespeelt (na 25 okt); de Xboard thuis. De
standaardopstelling (standen) en het standaardprofiel van het avondpakket staan al op `apc`: dit
advies verandert daar niets. Gewichten en maten zijn niet nagemeten. Vragen HA3, HA6, HA7.

## 4. De kaart

<!-- handen:begin -->

*Gegenereerd door `node tools/handen/handenkaart.mjs`; niet met de hand bewerken tussen de markers.*
Bronnen: de standaardmappings (APC v3, 710 regels + 14 in het fragment vorm; Maschine 73 regels; Xboard 17 regels), de 148 APC-controls van de hub (`src/devices/apc40mk2.js`, gelijk aan de kopie `src/handen/apc-controls.js`), het action-register (3251 actions), `handen/voorstel.json`, de profielen uit `avondpakket/profielen.json`, de handelingenlogs (zie de top-40 onderaan).

### Rol per controller in de draagbare set

Profielen uit avondpakket/profielen.json: ✓ = verwacht, (✓) = optioneel, — = niet.

| Controller | Rol | `laptop` | `apc` | `maschine` | `alles` | `beeld` | Hub nodig | Op hardware geproefd |
|---|---|---|---|---|---|---|---|---|
| APC40 mkII | mixer, tracks, effecten, cue, grid-modi: de kern van pijler 1 | — | ✓ | — | ✓ | ✓ | nee (in `alles` via de hub: Bank = hubtoets) | modus 0x42 en de kanalen van de device knobs (23 sep); alles van na 5 okt niet |
| Maschine MK2 | pads, patronen, stapmodus, secties, sampler, Strip/Rack, bladeren (pijler 2–3) | — | — | ✓ | ✓ | — | altijd | nooit |
| LPD8 | globale laag: beeld (K2), puls (K4), zwart (P1), snapshots; met av-kern alle acht | — | — | (✓) | (✓) | — | altijd | nooit (V5 van de hub open) |
| Xboard49 | noten met velocity en aftertouch, 16 knoppen, schuif (pijler 2) | — | — | (✓) | (✓) | — | nee (ook direct) | nooit (de CC's zijn een aanname) |

### APC40 mkII

**Vrij in de standaardmapping** (met de hub-id; vrij betekent: geen regel, niet "getest").

- Zonder enige regel: **shift** (shift: de shift-toets zelf), **bank** (bank: zonder hub vrij; met de hub de hubtoets (komt nooit aan)), **footswitch** (voet: nergens gebruikt).
- Alleen met shift (zonder shift vrij): **detail view** (detail); met `?vormen=1` opent Detail View het mapje vorm.
- Shift + knop vrij in de basis (23; zolang geen open mapje hem claimt): A|B 1, A|B 2, A|B 3, A|B 4, A|B 5, A|B 6, A|B 7, A|B 8, ◄ device, device ►, device on/off, device lock, master, stop all clips, pan, sends, user, play, ▲, ▼, ►, ◄, footswitch.
- Bank is met de hub de hubtoets; de shift-toets zelf is `note:0:98`.

Pads zonder regel per grid-modus (rijen van boven, k = kolom):

| Modus | Vrije pads | Aantal | Voorstel |
|---|---|---|---|
| `grid.auto` | rij 1 (k5–7), rij 2 (heel), rij 3 (heel), rij 4 (heel), rij 5 (heel) | 35 | — |
| `grid.hotcues` | — | 0 | — |
| `grid.klank` | — | 0 | — |
| `grid.loops` | — | 0 | — |
| `grid.patronen` | — | 0 | — |
| `grid.sampler` | rij 4 (heel), rij 5 (k2–8) | 15 | **voorstel `sampler.N.drums`** op rij 4 (heel) |
| `grid.secties` | — | 0 | — |
| `grid.stems` | — | 0 | — |
| `grid.video` | rij 2 (k3–6), rij 3 (heel), rij 4 (heel), rij 5 (heel) | 28 | — |

**Alle controls behalve de pads** (basis = zonder mapje; mapjes = regels in een mapje of modus):

| Plek | Basis | Met shift | Mapjes | Vrij | Voorstel |
|---|---|---|---|---|---|
| scene 1 (scene1, `note:0:82`) | `layer.grid.hotcues` | `layer.grid.secties` | edit.aan: `track.{focus}.grid.here`<br>grid.patronen: `patterns.row.1`<br>grid.secties: `layer.grid.hotcues`<br>edit.aan+shift: `track.{focus}.grid.pin`<br>device.beeld: `beeld.regie.ontdek` | — | — |
| scene 2 (scene2, `note:0:83`) | `layer.grid.loops` | `layer.grid.patronen` | edit.aan: `track.{focus}.grid.double`<br>grid.patronen: `patterns.row.2`<br>edit.aan+shift: `track.{focus}.grid.double`<br>device.beeld: `beeld.regie.volgende` | — | — |
| scene 3 (scene3, `note:0:84`) | `layer.grid.sampler` | `layer.grid.stems` | edit.aan: `track.{focus}.grid.halve`<br>grid.stems: `layer.grid.sampler`<br>edit.aan+shift: `track.{focus}.grid.halve`<br>grid.patronen: `patterns.row.3`<br>device.beeld: `beeld.regie.vasthouden` | — | — |
| scene 4 (scene4, `note:0:85`) | `layer.grid.video` | `layer.grid.auto` | edit.aan: `track.{focus}.grid.halfbeat`<br>grid.auto: `layer.grid.video`<br>edit.aan+shift: `track.{focus}.grid.halfbeat`<br>grid.patronen: `patterns.row.4`<br>device.beeld: `beeld.regie.flits` | — | — |
| scene 5 (scene5, `note:0:86`) | `track.{focus}.loop.exit` | `layer.grid.klank` | edit.aan: `track.{focus}.grid.split`<br>grid.klank: `track.{focus}.loop.exit`<br>grid.patronen: `patterns.row.5`<br>device.beeld: `beeld.regie.vrij` | — | — |
| rec arm 1 (rec1, `note:0:48`) | `track.1.pfl` | `track.1.cue` | — | — | — |
| solo 1 (solo1, `note:0:49`) | `track.1.sync` | `track.1.tap` | — | — | — |
| activator 1 (act1, `note:0:50`) | `track.1.play` | `track.1.play.quant` | — | — | — |
| track select 1 (sel1, `note:0:51`) | `track.1.focus` | `window.R.show.1` | edit.aan: `track.1.focus` | — | — |
| clip stop 1 (stop1, `note:0:52`) | `track.1.loop.toggle` | `track.1.loop.exit` | — | — | — |
| A\|B 1 (ab1, `note:0:66`) | `track.1.xfade.side` | — | — | shift | — |
| fader 1 (fader1, `cc:0:7`) | `track.1.fader` | — | — | — | — |
| device knop 1 (dk1, `cc:0:16`) | — | — | device.strip: `track.{focus}.trim`<br>device.rack: `track.{focus}.fx.knob.1`<br>device.inst: `track.{focus}.inst.knob.1`<br>device.master: `master.fx.knob.1`<br>device.beeld: `beeld.macro.intensiteit`<br>device.vorm (?vormen=1): `video.layer.knob.1` | — | — |
| track knop 1 (tk1, `cc:0:48`) | `track.1.filter` | — | — | — | — |
| rec arm 2 (rec2, `note:1:48`) | `track.2.pfl` | `track.2.cue` | — | — | — |
| solo 2 (solo2, `note:1:49`) | `track.2.sync` | `track.2.tap` | — | — | — |
| activator 2 (act2, `note:1:50`) | `track.2.play` | `track.2.play.quant` | — | — | — |
| track select 2 (sel2, `note:1:51`) | `track.2.focus` | `window.R.show.2` | edit.aan: `track.2.focus` | — | — |
| clip stop 2 (stop2, `note:1:52`) | `track.2.loop.toggle` | `track.2.loop.exit` | — | — | — |
| A\|B 2 (ab2, `note:1:66`) | `track.2.xfade.side` | — | — | shift | — |
| fader 2 (fader2, `cc:1:7`) | `track.2.fader` | — | — | — | — |
| device knop 2 (dk2, `cc:0:17`) | — | — | device.strip: `track.{focus}.high`<br>device.rack: `track.{focus}.fx.knob.2`<br>device.inst: `track.{focus}.inst.knob.2`<br>device.master: `master.fx.knob.2`<br>device.beeld: `beeld.macro.snelheid`<br>device.vorm (?vormen=1): `video.layer.knob.2` | — | — |
| track knop 2 (tk2, `cc:0:49`) | `track.2.filter` | — | — | — | — |
| rec arm 3 (rec3, `note:2:48`) | `track.3.pfl` | `track.3.cue` | — | — | — |
| solo 3 (solo3, `note:2:49`) | `track.3.sync` | `track.3.tap` | — | — | — |
| activator 3 (act3, `note:2:50`) | `track.3.play` | `track.3.play.quant` | — | — | — |
| track select 3 (sel3, `note:2:51`) | `track.3.focus` | `window.R.show.3` | edit.aan: `track.3.focus` | — | — |
| clip stop 3 (stop3, `note:2:52`) | `track.3.loop.toggle` | `track.3.loop.exit` | — | — | — |
| A\|B 3 (ab3, `note:2:66`) | `track.3.xfade.side` | — | — | shift | — |
| fader 3 (fader3, `cc:2:7`) | `track.3.fader` | — | — | — | — |
| device knop 3 (dk3, `cc:0:18`) | — | — | device.strip: `track.{focus}.mid`<br>device.rack: `track.{focus}.fx.knob.3`<br>device.inst: `track.{focus}.inst.knob.3`<br>device.master: `master.fx.knob.3`<br>device.beeld: `beeld.macro.helderheid`<br>device.vorm (?vormen=1): `video.layer.knob.3` | — | — |
| track knop 3 (tk3, `cc:0:50`) | `track.3.filter` | — | — | — | — |
| rec arm 4 (rec4, `note:3:48`) | `track.4.pfl` | `track.4.cue` | — | — | — |
| solo 4 (solo4, `note:3:49`) | `track.4.sync` | `track.4.tap` | — | — | — |
| activator 4 (act4, `note:3:50`) | `track.4.play` | `track.4.play.quant` | — | — | — |
| track select 4 (sel4, `note:3:51`) | `track.4.focus` | `window.R.show.4` | edit.aan: `track.4.focus` | — | — |
| clip stop 4 (stop4, `note:3:52`) | `track.4.loop.toggle` | `track.4.loop.exit` | — | — | — |
| A\|B 4 (ab4, `note:3:66`) | `track.4.xfade.side` | — | — | shift | — |
| fader 4 (fader4, `cc:3:7`) | `track.4.fader` | — | — | — | — |
| device knop 4 (dk4, `cc:0:19`) | — | — | device.strip: `track.{focus}.low`<br>device.rack: `track.{focus}.fx.knob.4`<br>device.inst: `track.{focus}.inst.knob.4`<br>device.master: `master.fx.knob.4`<br>device.beeld: `beeld.macro.feedback`<br>device.vorm (?vormen=1): `video.layer.knob.4` | — | — |
| track knop 4 (tk4, `cc:0:51`) | `track.4.filter` | — | — | — | — |
| rec arm 5 (rec5, `note:4:48`) | `track.5.pfl` | `track.5.cue` | — | — | — |
| solo 5 (solo5, `note:4:49`) | `track.5.sync` | `track.5.tap` | — | — | — |
| activator 5 (act5, `note:4:50`) | `track.5.play` | `track.5.play.quant` | — | — | — |
| track select 5 (sel5, `note:4:51`) | `track.5.focus` | `window.R.show.5` | edit.aan: `track.5.focus` | — | — |
| clip stop 5 (stop5, `note:4:52`) | `track.5.loop.toggle` | `track.5.loop.exit` | — | — | — |
| A\|B 5 (ab5, `note:4:66`) | `track.5.xfade.side` | — | — | shift | — |
| fader 5 (fader5, `cc:4:7`) | `track.5.fader` | — | — | — | — |
| device knop 5 (dk5, `cc:0:20`) | — | — | device.strip: `track.{focus}.send.a`<br>device.rack: `track.{focus}.fx.knob.5`<br>device.inst: `track.{focus}.inst.knob.5`<br>device.master: `master.fx.knob.5`<br>device.beeld: `beeld.macro.tint`<br>device.vorm (?vormen=1): `video.layer.knob.5` | — | — |
| track knop 5 (tk5, `cc:0:52`) | `track.5.filter` | — | — | — | — |
| rec arm 6 (rec6, `note:5:48`) | `track.6.pfl` | `track.6.cue` | — | — | — |
| solo 6 (solo6, `note:5:49`) | `track.6.sync` | `track.6.tap` | — | — | — |
| activator 6 (act6, `note:5:50`) | `track.6.play` | `track.6.play.quant` | — | — | — |
| track select 6 (sel6, `note:5:51`) | `track.6.focus` | `window.R.show.6` | edit.aan: `track.6.focus` | — | — |
| clip stop 6 (stop6, `note:5:52`) | `track.6.loop.toggle` | `track.6.loop.exit` | — | — | — |
| A\|B 6 (ab6, `note:5:66`) | `track.6.xfade.side` | — | — | shift | — |
| fader 6 (fader6, `cc:5:7`) | `track.6.fader` | — | — | — | — |
| device knop 6 (dk6, `cc:0:21`) | — | — | device.strip: `track.{focus}.send.b`<br>device.rack: `track.{focus}.fx.knob.6`<br>device.inst: `track.{focus}.inst.knob.6`<br>device.master: `master.fx.knob.6`<br>device.beeld: `beeld.macro.dichtheid`<br>device.vorm (?vormen=1): `video.layer.knob.6` | — | — |
| track knop 6 (tk6, `cc:0:53`) | `track.6.filter` | — | — | — | — |
| rec arm 7 (rec7, `note:6:48`) | `track.7.pfl` | `track.7.cue` | — | — | — |
| solo 7 (solo7, `note:6:49`) | `track.7.sync` | `track.7.tap` | — | — | — |
| activator 7 (act7, `note:6:50`) | `track.7.play` | `track.7.play.quant` | — | — | — |
| track select 7 (sel7, `note:6:51`) | `track.7.focus` | `window.R.show.7` | edit.aan: `track.7.focus` | — | — |
| clip stop 7 (stop7, `note:6:52`) | `track.7.loop.toggle` | `track.7.loop.exit` | — | — | — |
| A\|B 7 (ab7, `note:6:66`) | `track.7.xfade.side` | — | — | shift | — |
| fader 7 (fader7, `cc:6:7`) | `track.7.fader` | — | — | — | — |
| device knop 7 (dk7, `cc:0:22`) | — | — | device.strip: `track.{focus}.fx.mix`<br>device.rack: `track.{focus}.fx.knob.7`<br>device.inst: `track.{focus}.inst.knob.7`<br>device.master: `master.fx.knob.7`<br>device.beeld: `beeld.macro.glitch`<br>device.vorm (?vormen=1): `video.layer.opacity` | — | — |
| track knop 7 (tk7, `cc:0:54`) | `track.7.filter` | — | — | — | — |
| rec arm 8 (rec8, `note:7:48`) | `track.8.pfl` | `track.8.cue` | — | — | — |
| solo 8 (solo8, `note:7:49`) | `track.8.sync` | `track.8.tap` | — | — | — |
| activator 8 (act8, `note:7:50`) | `track.8.play` | `track.8.play.quant` | — | — | — |
| track select 8 (sel8, `note:7:51`) | `track.8.focus` | `window.R.show.8` | edit.aan: `track.8.focus` | — | — |
| clip stop 8 (stop8, `note:7:52`) | `track.8.loop.toggle` | `track.8.loop.exit` | — | — | — |
| A\|B 8 (ab8, `note:7:66`) | `track.8.xfade.side` | — | — | shift | — |
| fader 8 (fader8, `cc:7:7`) | `track.8.fader` | — | — | — | — |
| device knop 8 (dk8, `cc:0:23`) | — | — | device.strip: `track.{focus}.fx.knob.1`<br>device.rack: `track.{focus}.fx.knob.8`<br>device.inst: `track.{focus}.inst.knob.8`<br>device.master: `master.fx.mix`<br>device.master+shift: `master.fx.knob.8`<br>device.beeld: `beeld.macro.balans`<br>device.vorm (?vormen=1): `video.layer.react` | — | — |
| track knop 8 (tk8, `cc:0:55`) | `track.8.filter` | — | — | — | — |
| ◄ device (devL, `note:0:58`) | `track.{focus}.rack.prev` | — | device.inst: `track.{focus}.inst.prev`<br>device.master: `master.rack.prev`<br>edit.aan: `track.{focus}.grid.bar.back`<br>edit.aan+shift: `track.{focus}.grid.check.prev`<br>device.vorm (?vormen=1): `video.layer.prev` | shift | — |
| device ► (devR, `note:0:59`) | `track.{focus}.rack.next` | — | device.inst: `track.{focus}.inst.next`<br>device.master: `master.rack.next`<br>edit.aan: `track.{focus}.grid.bar`<br>edit.aan+shift: `track.{focus}.grid.check.next`<br>device.vorm (?vormen=1): `video.layer.next` | shift | — |
| ◄ bank (bankL, `note:0:60`) | `track.{focus}.beatjump.back` | `track.{focus}.beatjump.halve` | device.vorm (?vormen=1): `video.layer.select.prev` | — | — |
| bank ► (bankR, `note:0:61`) | `track.{focus}.beatjump.fwd` | `track.{focus}.beatjump.double` | device.vorm (?vormen=1): `video.layer.select.next` | — | — |
| device on/off (devOn, `note:0:62`) | `track.{focus}.fx.bypass` | — | device.inst: `track.{focus}.inst.stil`<br>device.master: `master.fx.bypass`<br>edit.aan: `track.{focus}.grid.controle`<br>edit.aan+shift: `track.{focus}.grid.ok`<br>device.vorm (?vormen=1): `video.layer.on` | shift | — |
| device lock (lock, `note:0:63`) | `transport.quantize` | — | edit.aan: `track.{focus}.grid.lock` | shift | — |
| clip/device view (clipdev, `note:0:64`) | `layer.device.view` | `layer.device.master` | edit.aan: `track.{focus}.grid.align` | — | — |
| detail view (detail, `note:0:65`) | — | `layer.device.beeld` | edit.aan: `track.{focus}.grid.undo`<br>basis (?vormen=1): `layer.device.detail` | zonder shift | — |
| master (mastersel, `note:0:80`) | `video.black` | — | — | shift | **voorstel `video.clips`** |
| stop all clips (stopall, `note:0:81`) | `track.{focus}.brake` | — | grid.patronen: `patterns.stop`<br>grid.patronen+shift: `patterns.stop.now`<br>device.beeld: `beeld.regie.paniek` | shift | — |
| pan (pan, `note:0:87`) | `track.{focus}.loop.in` | — | — | shift | — |
| sends (sends, `note:0:88`) | `track.{focus}.loop.out` | — | — | shift | — |
| user (user, `note:0:89`) | `track.{focus}.loop.reloop` | — | — | shift | — |
| metronome (metro, `note:0:90`) | `mixer.xfader.curve` | `layer.edit.toggle` | edit.aan: `mixer.xfader.curve` | — | — |
| play (play, `note:0:91`) | `track.{focus}.play` | — | — | shift | — |
| record (record, `note:0:93`) | `record.start` | `record.stop` | — | — | — |
| ▲ (up, `note:0:94`) | `layer.grid.prev` | — | — | shift | — |
| ▼ (down, `note:0:95`) | `layer.grid.next` | — | — | shift | — |
| ► (right, `note:0:96`) | `focus.next` | — | — | shift | — |
| ◄ (left, `note:0:97`) | `focus.prev` | — | — | shift | — |
| shift (shift, `note:0:98`) | — | — | — | helemaal | — |
| tap tempo (tap, `note:0:99`) | `track.{focus}.tap` | `track.{focus}.keylock` | — | — | — |
| nudge − (nudgeM, `note:0:100`) | `track.{focus}.bend.back` | `track.{focus}.transpose.down` | edit.aan: `track.{focus}.grid.back`<br>edit.aan+shift: `track.{focus}.grid.back.fine` | — | — |
| nudge + (nudgeP, `note:0:101`) | `track.{focus}.bend.fwd` | `track.{focus}.transpose.up` | edit.aan: `track.{focus}.grid.fwd`<br>edit.aan+shift: `track.{focus}.grid.fwd.fine` | — | — |
| session record (session, `note:0:102`) | `sampler.length` | `record.mode` | — | — | — |
| bank (bank, `note:0:103`) | — | — | — | helemaal | — |
| master fader (master, `cc:0:14`) | `mixer.master` | — | — | — | — |
| crossfader (xf, `cc:0:15`) | `mixer.xfader` | — | — | — | — |
| tempo (tempo, `cc:0:13`) | `track.{focus}.tempo` | `track.{focus}.tempo` | — | — | — |
| cue level (cue, `cc:0:47`) | `headphone.level` | `headphone.mix` | edit.aan: `track.{focus}.grid.bpm`<br>edit.aan+shift: `track.{focus}.grid.bpm`<br>grid.sampler+shift: `sampler.volume`<br>grid.video+shift: `video.pulse` | — | — |
| footswitch (voet, `cc:0:64`) | — | — | — | helemaal, shift | — |

### Maschine MK2 (alleen via de hub)

**In gebruik 27, vrij 21** van 48 knoppen. "maschine.js" = de knop doet iets zonder mappingregel (UITLEG in maschine.js). Een ontwerp voor de vrije knoppen staat in `~/Projects/maschine-lab/kaart/data2.js` (status voorstel).

| Knop | Doet | Vrij | Voorstel |
|---|---|---|---|
| F1 (`note:1:0`) | — | **vrij** | — |
| F2 (`note:1:1`) | — | **vrij** | — |
| F3 (`note:1:2`) | — | **vrij** | — |
| F4 (`note:1:3`) | — | **vrij** | — |
| F5 (`note:1:4`) | — | **vrij** | — |
| F6 (`note:1:5`) | — | **vrij** | — |
| F7 (`note:1:6`) | — | **vrij** | — |
| F8 (`note:1:7`) | — | **vrij** | — |
| CONTROL (`note:1:8`) | maschine.js: uitleg | — | — |
| STEP (`note:1:9`) | maschine.js: stappen | — | — |
| BROWSE (`note:1:10`) | basis: `library.toggle` | — | — |
| SAMPLING (`note:1:11`) | maschine.js: sampler | — | — |
| ◄ (links boven) (`note:1:12`) | maschine.js: ◄ pagina | — | — |
| ► (links boven) (`note:1:13`) | maschine.js: pagina ► | — | — |
| ALL (`note:1:14`) | — | **vrij** | — |
| AUTO (`note:1:15`) | — | **vrij** | — |
| VOLUME (`note:1:16`) | — | **vrij** | — |
| SWING (`note:1:17`) | — | **vrij** | — |
| TEMPO (`note:1:18`) | — | **vrij** | — |
| ◄ (bij het wiel) (`note:1:19`) | bladeren: `library.page.prev` | — | — |
| ► (bij het wiel) (`note:1:20`) | bladeren: `library.page.next` | — | — |
| ENTER (`note:1:21`) | maschine.js: zetten<br>bladeren: `track.{focus}.load.selected` | — | — |
| NOTE REPEAT (`note:1:22`) | — | **vrij** | — |
| masterwiel indrukken (`note:1:23`) | maschine.js: zetten<br>bladeren: `track.{focus}.load.selected` | — | — |
| groep A (`note:1:24`) | basis: `track.1.focus` | — | — |
| groep B (`note:1:25`) | basis: `track.2.focus` | — | — |
| groep C (`note:1:26`) | basis: `track.3.focus` | — | — |
| groep D (`note:1:27`) | basis: `track.4.focus` | — | — |
| groep E (`note:1:28`) | basis: `track.5.focus` | — | — |
| groep F (`note:1:29`) | basis: `track.6.focus` | — | — |
| groep G (`note:1:30`) | basis: `track.7.focus` | — | — |
| groep H (`note:1:31`) | basis: `track.8.focus` | — | — |
| RESTART (`note:1:32`) | basis: `track.{speel}.pattern.stop`<br>shift: `track.{speel}.pattern.stop.now` | — | — |
| ◄ (transport) (`note:1:33`) | maschine.js: ◄ blad<br>shift: `track.{speel}.pattern.length.down`<br>sampler: `sampler.length.down` | — | — |
| ► (transport) (`note:1:34`) | maschine.js: blad ►<br>shift: `track.{speel}.pattern.length.up`<br>sampler: `sampler.length.up` | — | — |
| GRID (`note:1:35`) | — | **vrij** | — |
| PLAY (`note:1:36`) | basis: `track.{speel}.pattern.{plek}`<br>shift: `track.{speel}.pattern.{plek}.now` | — | — |
| REC (`note:1:37`) | basis: `patterns.record` | — | — |
| ERASE (`note:1:38`) | basis: `track.{speel}.pattern.clear` | — | — |
| SHIFT (`note:1:39`) | maschine.js: shift | — | — |
| SCENE (`note:1:40`) | maschine.js: secties | — | — |
| PATTERN (`note:1:41`) | maschine.js: plek kiezen | — | — |
| PAD MODE (`note:1:42`) | — | **vrij** | — |
| NAVIGATE (`note:1:43`) | — | **vrij** | — |
| DUPLICATE (`note:1:44`) | — | **vrij** | **voorstel `sampler.N.drums`** |
| SELECT (`note:1:45`) | — | **vrij** | — |
| SOLO (`note:1:46`) | — | **vrij** | — |
| MUTE (`note:1:47`) | — | **vrij** | — |

Draaiknoppen en wiel (per knoppagina een mapje):

| Knop | Doet |
|---|---|
| draaiknop 1 (`cc:0:16`) | Instrument: `track.{speel}.inst.knob.1`<br>pagina.strip: `track.{focus}.trim`<br>pagina.rack: `track.{focus}.fx.knob.1` |
| draaiknop 2 (`cc:0:17`) | Instrument: `track.{speel}.inst.knob.2`<br>pagina.strip: `track.{focus}.high`<br>pagina.rack: `track.{focus}.fx.knob.2` |
| draaiknop 3 (`cc:0:18`) | Instrument: `track.{speel}.inst.knob.3`<br>pagina.strip: `track.{focus}.mid`<br>pagina.rack: `track.{focus}.fx.knob.3` |
| draaiknop 4 (`cc:0:19`) | Instrument: `track.{speel}.inst.knob.4`<br>pagina.strip: `track.{focus}.low`<br>pagina.rack: `track.{focus}.fx.knob.4` |
| draaiknop 5 (`cc:0:20`) | Instrument: `track.{speel}.inst.knob.5`<br>pagina.strip: `track.{focus}.send.a`<br>pagina.rack: `track.{focus}.fx.knob.5`<br>sampler: `sampler.volume` |
| draaiknop 6 (`cc:0:21`) | Instrument: `track.{speel}.inst.knob.6`<br>pagina.strip: `track.{focus}.send.b`<br>pagina.rack: `track.{focus}.fx.knob.6` |
| draaiknop 7 (`cc:0:22`) | Instrument: `track.{speel}.inst.knob.7`<br>pagina.strip: `track.{focus}.fx.mix`<br>pagina.rack: `track.{focus}.fx.knob.7` |
| draaiknop 8 (`cc:0:23`) | Instrument: `track.{speel}.inst.knob.8`<br>pagina.strip: `track.{focus}.filter`<br>pagina.rack: `track.{focus}.fx.knob.8` |
| masterwiel (draaien) (`cc:0:24`) | maschine.js: instrument kiezen; met de library open bladeren |

Pads 1–16: spelen (noten 36–51 via noten.js), stappen (STEP), secties (SCENE), patroonplek (PATTERN + pad), sampler (SAMPLING); maschine.js, geen mappingregels.

### LPD8 (alleen via de hub)

Vrij in Varve: K1, K3, K5, K6, K7, K8. De knoppen zijn rollen van de hub (PROTOCOL §6): de pickup volgt de eerste app met die rol; de pads P2–P8 zijn van de hub.

| Plek | Rol / hub | In Varve | Vrij | Voorstel |
|---|---|---|---|---|
| K1 | `macro.intensiteit` | — | **vrij** | leeg laten (O1), of video.fx.intensity als Clay K1 wil (HA6) |
| K2 | `macro.helderheid` | Beeld: `video.master` | — | — |
| K3 | `macro.ruimte` | — | **vrij** | — |
| K4 | `macro.beweging` | Puls op de tel: `video.pulse` | — | — |
| K5 | `macro.kleur` | — | **vrij** | — |
| K6 | `macro.dichtheid` | — | **vrij** | — |
| K7 | `klok.adem_periode` | — | **vrij** | — |
| K8 | `macro.balans` | — | **vrij** | — |
| P1 | paniek (vasthouden): elke app | Paniek (beeld zwart): `video.black.hold` | — | — |
| P2 | tap tempo | — | — | — |
| P3 | adem | — | — | — |
| P4 | opname van de hub | — | — | — |
| P5 | snapshot 1 | — | — | — |
| P6 | snapshot 2 | — | — | — |
| P7 | snapshot 3 | — | — | — |
| P8 | snapshot 4 | — | — | — |

### Xboard49

**AANNAME:** de CC-nummers komen uit Ardour's map en zijn door geen proef bevestigd (de proef speelapparaten van de hub meet ze). Vrij: niets. Noten, pedaal, modwiel en pitchbend doet `noten.js`.

| Knop | In | Doet |
|---|---|---|
| knop 1 | `cc:*:21` | `track.{speel}.inst.knob.1` |
| knop 2 | `cc:*:22` | `track.{speel}.inst.knob.2` |
| knop 3 | `cc:*:23` | `track.{speel}.inst.knob.3` |
| knop 4 | `cc:*:24` | `track.{speel}.inst.knob.4` |
| knop 5 | `cc:*:25` | `track.{speel}.inst.knob.5` |
| knop 6 | `cc:*:26` | `track.{speel}.inst.knob.6` |
| knop 7 | `cc:*:27` | `track.{speel}.inst.knob.7` |
| knop 8 | `cc:*:28` | `track.{speel}.inst.knob.8` |
| knop 9 | `cc:*:31` | `track.{speel}.fx.knob.1` |
| knop 10 | `cc:*:32` | `track.{speel}.fx.knob.2` |
| knop 11 | `cc:*:33` | `track.{speel}.fx.knob.3` |
| knop 12 | `cc:*:34` | `track.{speel}.fx.knob.4` |
| knop 13 | `cc:*:35` | `track.{speel}.fx.knob.5` |
| knop 14 | `cc:*:36` | `track.{speel}.fx.knob.6` |
| knop 15 | `cc:*:37` | `track.{speel}.fx.knob.7` |
| knop 16 | `cc:*:38` | `track.{speel}.fx.knob.8` |
| schuif | `master-volume` | `track.{speel}.fader` |

### Acties zonder plek op een controller

**Het voorstel** (`handen/voorstel.json`; eerst via learn, standaard pas na de proef):

| Actie | Status | APC | Maschine | Waarom | Voorwaarde | Vraag | Op deze tak |
|---|---|---|---|---|---|---|---|
| `video.clips` | voorstel | Shift + mastersel | — | de twee beeld-noodknoppen bij elkaar: de master-knop zelf is video.black, met shift clips uit (= zaalbeeld); in elk mapje bereikbaar; 0 regels op note:0:80#shift | learn eerst (Clay's verschil); standaard pas na de beeld-speelproef (VI7) | HA4 | in het register |
| `sampler.N.drums` | voorstel | r4k1, r4k2, r4k3, r4k4, r4k5, r4k6, r4k7, r4k8 (grid.sampler) | duplicate: DUPLICATE vasthouden + pad in de padmodus sampler: dupliceer deze knip naar de Drums; nooit SHIFT + pad (K10: dat is leegmaken) | de knip en zijn bestemming in dezelfde modus en dezelfde kolom (kolom k = sampler-pad k, rij 4 van boven is vrij in de modus sampler); DUPLICATE zegt letterlijk wat het doet | learn eerst; standaard na het crossover-proefblok (CX4) | HA5 | in het register |
| `broadcast.toggle` | geen | — | — | uitzenden kiest bewust: als stand + de regel op de iPhone (companion). Een uitzending start je niet met een pad in het donker; Shift + Record is al record.stop | blijft Controlekamer en companion | HA8 | nog niet (PR #24 (uitzenden), nog niet gebouwd (stap 6 in docs/UITZENDEN.md §11)) |
| `opstelling activeren` | geen | — | — | een opstelling is een startpunt vóór de set (tegel, CLI, VARVE.app-argument), geen bus-action | — | — | geen bus-action |
| `log.*` | geen | — | — | bewust zonder knop: het log staat altijd aan (J18) en terugspelen slaat log.* over | — | — | in het register |

**Bewust zonder plek** (143 genormaliseerde actions; ze werken op het scherm, met toetsen of via koppelen):

| Patroon | Aantal | Waarom |
|---|---|---|
| `klankschaal.*` | 18 | geen plek op de standaard-APC (KS1): de KLANKSCHAAL-rij, en koppelen werkt |
| `library.next` | 1 | het masterwiel van de Maschine met de library open (maschine.js, geen mappingregel); ONTBREEKT B10: laden vanaf de APC |
| `library.prev` | 1 | het masterwiel van de Maschine met de library open (maschine.js, geen mappingregel) |
| `*.knob.K.hold` | 10 | drukvariant van een knopplek (indrukken = vol open): op het scherm alt + vasthouden; op de APC nog geen knop (CLAUDE.md, VERBETERINGEN ronde 3) |
| `*.fx.next` | 2 | los effect wisselen: de RACK-rij op het scherm; de APC kiest racks (Device ◀ ▶) |
| `patterns.*` | 2 | tempo en tap van de patronen: de PATROON-rij op het scherm |
| `send.*.knob.K` | 8 | de knoppen van het rack op de echo- en galmbus: rack-editor op het scherm |
| `track.N.barbeat` | 1 | alleen een read voor de lampjes (knipperen op de "1") |
| `track.N.beat` | 1 | alleen een read voor de lampjes |
| `track.N.beatloop.0.K` | 1 | korte beatloops (¼, ½ tel): scherm en toetsen; de modus loops heeft de hele tellen |
| `track.N.brake.time` | 1 | de remtijd is een instelling op het scherm |
| `*.glide` | 4 | glijden is voor de auto-DJ (AUTO-DJ.md §2b), geen handgebaar |
| `track.N.grid.*` | 4 | grid bewerken en nalopen: het scherm (controle) en de grid-modus op de APC (Shift + Metronome) |
| `track.N.inst` | 1 | instrument rondlopen: de INSTRUMENT-rij; op de Maschine het masterwiel (maschine.js, geen mappingregel) |
| `track.N.inst.choose` | 1 | het masterwiel en ENTER van de Maschine zetten het (maschine.js, geen mappingregel) |
| `track.N.key*` | 9 | geen APC-knoppen voor de toonsoort (T6): een per ongeluk verzette kwint wordt bewaard als 'hand' |
| `track.N.leads` | 1 | alleen een read (wie geeft de maat) |
| `track.N.loop.*` | 4 | loops in seconden, halveren en verdubbelen: scherm en toetsen; op de APC Pan/Sends/User en de modus loops |
| `track.N.nudge.*` | 2 | 50 ms springen: toetsenbord; de APC doet bend |
| `track.N.pattern.*` | 3 | patroonlengte, swing en stappen: de PATROON-rij; stappen op de Maschine via STEP (maschine.js) |
| `track.N.phase` | 1 | alleen een read voor de lampjes (knipperen op de tel) |
| `track.N.pitch` | 1 | de pitchfader op het scherm; de APC heeft de tempo-encoder (track.N.tempo) |
| `track.N.pitch.range` | 1 | het pitchbereik is een instelling op het scherm |
| `track.N.section.*` | 2 | volgende/vorige sectie: toetsenbord (shift + W/E); op de APC de modus secties, op de Maschine SCENE |
| `track.N.seek` | 1 | klikken in de golfvorm |
| `track.N.stem.*` | 45 | de STEMS-rij op het scherm; op de APC de modus stems (kill per stem) |
| `track.N.transpose*` | 2 | toon: Shift + Nudge ± op de APC (transpose.up/down als regel); het getal en reset op het scherm |
| `track.N.xfade.*` | 3 | de kant per stuk, om te koppelen; de APC loopt rond met A\|B (track.N.xfade.side) |
| `video.fit` | 1 | beeldverhouding: het videopaneel |
| `video.fx.*` | 6 | de knoppen van de video-effecten: het videopaneel; op de APC alleen de drukvariant (video.fx.*.hold) in de modus video |
| `video.layer.*` | 4 | de vormlagen: de VORM-rij en het mapje vorm (?vormen=1) |
| `window.L.show.K` | 1 | focus op track N = Track Select (track.N.focus); window.R.show.N staat op Shift + Track Select |

**Zonder plek en zonder besluit:** geen.

### Wat de handen doen (top-40 uit de handelingenlogs)

27 logs (set-20260930-001113.acties.jsonl … set-20261010-190959.acties.jsonl), 62.282 handelingen. Het log kent geen bron (MIDI, muis, toets): "hand" hieronder is waar de actie in een mapping staat, geen meting.

| # | Actie | Aantal | Hand |
|---|---|---|---|
| 1 | `track.N.fader` | 11.796 | APC: fader 1–8<br>Xboard: schuif |
| 2 | `track.N.filter` | 6.452 | APC: track knop 1–8<br>Maschine: draaiknop 8 (± shift, pagina.strip) |
| 3 | `video.layer.knob.K` | 5.799 | APC: device knop 1–6 (device.vorm, ?vormen=1) |
| 4 | `track.N.fx.knob.K` | 5.064 | APC: device knop 1–8 (device.rack)<br>APC: device knop 8 (device.strip)<br>Maschine: draaiknop 1–8 (± shift, pagina.rack)<br>Xboard: knop 9–16 |
| 5 | `track.N.send.a` | 4.765 | APC: device knop 5 (device.strip)<br>Maschine: draaiknop 5 (± shift, pagina.strip) |
| 6 | `track.N.fx.mix` | 3.717 | APC: device knop 7 (device.strip)<br>Maschine: draaiknop 7 (± shift, pagina.strip) |
| 7 | `track.N.send.b` | 2.280 | APC: device knop 6 (device.strip)<br>Maschine: draaiknop 6 (± shift, pagina.strip) |
| 8 | `track.N.filter.glide` | 1.602 | geen vaste plek (zie `*.glide` hierboven) |
| 9 | `track.N.low` | 1.560 | APC: device knop 4 (device.strip)<br>Maschine: draaiknop 4 (± shift, pagina.strip) |
| 10 | `mixer.xfader` | 1.518 | APC: crossfader |
| 11 | `track.N.xfade.thru` | 1.306 | geen vaste plek (zie `track.N.xfade.*` hierboven) |
| 12 | `track.N.fader.glide` | 1.208 | geen vaste plek (zie `*.glide` hierboven) |
| 13 | `mixer.master` | 1.162 | APC: master fader |
| 14 | `video.fx.pixel` | 1.117 | geen vaste plek (zie `video.fx.*` hierboven) |
| 15 | `track.N.trim` | 1.012 | APC: device knop 1 (device.strip)<br>Maschine: draaiknop 1 (± shift, pagina.strip) |
| 16 | `track.N.hotcue.K` | 876 | APC: 32 pads (grid.hotcues) |
| 17 | `sampler.volume` | 719 | APC: cue level (shift, grid.sampler)<br>Maschine: draaiknop 5 (± shift, sampler) |
| 18 | `track.N.pitch` | 658 | geen vaste plek (zie `track.N.pitch` hierboven) |
| 19 | `video.layer.opacity` | 655 | APC: device knop 7 (device.vorm, ?vormen=1) |
| 20 | `track.N.inst.knob.K` | 616 | APC: device knop 1–8 (device.inst)<br>Maschine: draaiknop 1–8 (± shift)<br>Xboard: knop 1–8 |
| 21 | `video.fx.trails` | 596 | geen vaste plek (zie `video.fx.*` hierboven) |
| 22 | `video.fx.grain` | 490 | geen vaste plek (zie `video.fx.*` hierboven) |
| 23 | `track.N.send.a.glide` | 427 | geen vaste plek (zie `*.glide` hierboven) |
| 24 | `klankschaal.veld.K` | 426 | geen vaste plek (zie `klankschaal.*` hierboven) |
| 25 | `video.layer.react` | 418 | APC: device knop 8 (device.vorm, ?vormen=1) |
| 26 | `video.fx.mirror` | 369 | geen vaste plek (zie `video.fx.*` hierboven) |
| 27 | `track.N.send.b.glide` | 347 | geen vaste plek (zie `*.glide` hierboven) |
| 28 | `klankschaal.toon` | 290 | geen vaste plek (zie `klankschaal.*` hierboven) |
| 29 | `track.N.focus` | 279 | APC: track select 1–8<br>APC: track select 1–8 (edit.aan)<br>Maschine: groep A, groep B, groep C, groep D, groep E, groep F, groep G, groep H |
| 30 | `video.fx.rgb` | 257 | geen vaste plek (zie `video.fx.*` hierboven) |
| 31 | `track.N.stem.drums` | 248 | geen vaste plek (zie `track.N.stem.*` hierboven) |
| 32 | `video.fx.color` | 239 | geen vaste plek (zie `video.fx.*` hierboven) |
| 33 | `track.N.stem.drums.send.b` | 220 | geen vaste plek (zie `track.N.stem.*` hierboven) |
| 34 | `video.pulse` | 219 | APC: cue level (shift, grid.video)<br>LPD8: K 4 (via de hub) |
| 35 | `track.N.stem.other` | 216 | geen vaste plek (zie `track.N.stem.*` hierboven) |
| 36 | `headphone.level` | 176 | APC: cue level |
| 37 | `track.N.play` | 166 | APC: activator 1–8, play |
| 38 | `track.N.seek` | 154 | geen vaste plek (zie `track.N.seek` hierboven) |
| 39 | `track.N.tempo` | 152 | APC: tempo (± shift) |
| 40 | `track.N.high` | 135 | APC: device knop 2 (device.strip)<br>Maschine: draaiknop 2 (± shift, pagina.strip) |

Per groep: track (transport/mixer) 28.089 · effecten/sends 17.359 · video/vormen 10.619 · overig 2.686 · klankschaal 860 · sampler 838 · instrument 629 · stems 597 · library 195 · koptelefoon 178 · mapjes 128 · patronen 72 · auto-dj 32.

<!-- handen:eind -->

## 5. Voorstel voor de hub-repo (alleen tekst, met Clay's OK; vraag HA10)

Voor `AV-app-hub/docs/HARDWARE-AVOND.md`, bovenaan na de tabel:

> **Met Varve DJ (set `studio`):** doe blok 1, 2, 8 en 6 overdag, zonder muziek, als "hub-middag"
> (±80 min); sla blok 3, 4 en 5 over (die zijn voor de meditatie-apps). Vink af in de Controlekamer
> van Varve (`http://localhost:8777/controle`, blok "Avond 2 · Hub-middag"), zodat alles op één plek
> staat. Daarna, op de avond zelf: `npm run check -- studio`, dan `npm start -- studio` en de blokken
> "Avond 2 · …" in de Controlekamer. Vóór je de stekkers eruit trekt: de twee alleen-lezen-commando's
> van Varve's avondpakket (`docs/AVONDPAKKET.md` 7a), met de APC, Scarlett, Maschine en LPD8 nog
> aangesloten.

En voor `AV-app-hub/sets/studio.json` (`_doc`): "zie `youtube-mixer/docs/HANDEN.md` voor wat elke
knop in Varve doet; de spiekbrief van de hub toont voor een lease-app alleen Bank en de LPD8".

## 6. Wat de kaart niet zegt

- **Werking.** De kaart leest de mappings: wat er staat is bedoeling. Tot de hub-middag kan elk
  "doet X" op het apparaat anders uitpakken (V3 van de hub raakt Varve's LED's bij vasthouden; het
  echofilter staat nog aan).
- **De bron van een handeling.** Het handelingenlog kent geen bron (MIDI, muis, toets); "hand" in
  de top-40 is waar de actie in een mapping staat, geen meting.
- **Rijen.** Varve telt de grid van boven (rij 1 = bovenste), de hub van onder (`pad1-x` =
  onderste). De kaart schrijft altijd "rij · kolom" van boven met de hub-id erachter; de test
  vergelijkt op hub-id's, niet op rijnummers.
- **Drie apps op één APC.** Zonder hub: één tegelijk, tabblad dicht (Varve, av-kern, de
  Stroommachine). Met de hub is de lease het enige mechanisme; av-kern's koppeling komt na 25 okt,
  de Stroommachine krijgt onder de hub de automatische indeling van PROTOCOL §7, niet de zijne.
- **De Xboard-CC's** zijn een aanname tot de proef speelapparaten.
- **De actions van de werkruimte (S1–S11, 14 okt).** Het register (`tools/handen/register.mjs`)
  bindt alleen wat `src/control/actions.js` zelf bindt. Wat de aanhakers binden (`werk.*`,
  `plan.*`, `set.*`, `library.category.*`/`quicktag`/`quickfilter`, `track.N.tag.*`, de precisie
  van S1, `track.N.fx.xy.*`, de combi-acties) staat daardoor niet in "bewust zonder plek". De vrije
  plekken kloppen wel: die komen uit de standaardmappings, en de stukken van de werkruimte gaan
  alleen op vrije sleutels. Erbij halen = die bind-functies in het register op dubbels zetten, plus
  een regel per patroon in `handen/voorstel.json`.

## 7. Hoe hernieuwen

```bash
node tools/handen/handenkaart.mjs                # §4 opnieuw maken uit de data (logs: VARVE_OPNAMES of opnames/)
node tools/handen/handenkaart.mjs --controleer   # klopt §4 nog? (exit 1 als niet; schrijft niets)
node tools/handen/handenkaart.mjs --html         # A4-afdruk in tools/handen/uit/handenkaart.html (⌘P)
node test/handen.test.mjs                        # de zes checks (vrije plekken, voorstel, register, telling, …)
```

De top-40 komt uit de handelingenlogs. In een worktree of bij de integrator zijn die er meestal
niet; dan laat de tool de top-40 die er staat ongemoeid, en zegt `--controleer` erbij "top-40 niet
vergeleken". Wil je hem vernieuwen, wijs dan de logs aan (alleen lezen):
`VARVE_OPNAMES=~/Desktop/1.\ Projects/Youtube\ mixer/opnames node tools/handen/handenkaart.mjs`.
Alleen `--zonder-logs` haalt de top-40 weg. Of de 148 APC-controls uit de hub (`VARVE_HUB_REPO`)
of uit de ingebakken kopie komen maakt voor het document niets uit: de test houdt die gelijk.

Verandert de standaardmapping, dan valt `test/handen.test.mjs` op de vrije-plekkenlijst: kijk of
de plek bewust bezet is, pas de verwachte lijst in de test aan, en draai de kaart opnieuw. Komt er
een action bij zonder plek op een controller, dan eist de test een regel in `handen/voorstel.json`
(een voorstel, of een uitzondering met reden). Gaat een voorstel na de proef de standaard in, dan
de status in `handen/voorstel.json` van `voorstel` naar `standaard`.
