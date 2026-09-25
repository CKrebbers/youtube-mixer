# APC40 mkII en VARVE DJ

Uitkomst van twee onderzoeksagenten (23 september 2026). Bronnen: Akai
Communications Protocol v1.2 [P] en User Guide v1.0 [UG], plus de lokale
code. Getest op de hardware: alleen de modus (0x41 gemeten, daarna 0x42) en
de kanalen van de device knobs. De indeling hieronder is gebouwd maar nog niet
op het apparaat nagelopen. Beslissingen staan in `docs/VRAGEN.md` onder B.

## Wat het apparaat kan

**Modi** (byte 8 van de intro-sysex `F0 47 7F 29 60 00 04 <mode> vH vL bugfix F7`;
antwoord 0x61 met de stand van 9 regelaars, mogelijk bruikbaar als beginstand):
- **0x40 generic** — apparaat doet veel zelf: toggles, lampjes, banken. TRACK
  SELECT stuurt géén MIDI, kiest alleen de bank (kanaal 0–7, master 8) voor
  device knobs + de 8 device-knoppen. Ringen alleen SINGLE.
- **0x41 Ableton** — alles momentary, device-sectie NIET gebankt (alles kanaal 0).
  Ringen stuurt het apparaat zelf (host mag overschrijven); rest van LED's is van de host.
- **0x42 Alternate Ableton** — als 0x41, maar ÁLLE LED's inclusief ringen van de host.
  Resolume raadt deze aan. **Advies voor ons.**
- Na loskoppelen staat hij weer in generic: init opnieuw bij elke hotplug.

**~~Tegenstrijdigheid 0x41~~ — OPGELOST 23 sep (`08e9a86`, VRAGEN B1).**
`INIT_SYSEX` stuurde 0x41 terwijl de mapping met bank-kanalen rekende die alleen
in generic bestaan. Gemeten in 0x41: device knob 1 op `cc:0:16`, welke track je
ook selecteerde — hij draaide dus altijd aan track 1. Nu: init **0x42**, device
knobs `cc:0:16-23` → `track.{focus}.…`, Track Select → focus.

**LED's**
- Clipgrid 5×8 + scene launch (0x52–0x56): RGB, velocity = één van **128 paletkleuren**
  (ons `PALETTE_HEX` stopt bij 59 — aanvullen). MIDI-kanaal = gedrag: 0 vast,
  1–5 oneshot, 6–10 pulseren, 11–15 knipperen (1/24 … 1/2). Tempo daarvan
  vermoedelijk via MIDI clock (0xF8) van de host — onbevestigd.
- Enkelkleurig (0 uit / 1–127 aan): arm, solo, activator, track select, clip stop
  (+ velocity 2 = knipperen), device L/R, bank L/R, on/off, lock, views, master,
  pan, sends, user, metronome, play, record, session.
- Tweekleurig: crossfader A/B-knop (1 = geel, 2–127 = oranje).
- Geen LED: stop all clips, pijlen, shift, tap, nudge.
- Ringen (15 lampjes): type via CC 0x18–0x1F (device) / 0x38–0x3F (track):
  0 uit, 1 single, 2 volume, 3 pan. Waarde via dezelfde CC als de knop.

**Knoppen**
- Absoluut: faders (CC 7, kanaal 0–7), master 0x0E, crossfader 0x0F, device knobs
  0x10–0x17, track knobs 0x30–0x37 → soft-takeover blijft nodig.
- Relatief: tempo 0x0D en cue level 0x2F (1–63 omhoog, 64–127 omlaag; 64 = −64 —
  gerepareerd in mapping.js op 23 sep).
- Footswitch CC 0x40. **Shift (0x62) is gewoon een noot**: shift-lagen bouwen we zelf.
  Tap, nudge, metronome, pijlen 0x5E–0x61 en Bank 0x67 zijn vrije knoppen.

**Niet mogelijk:** geen editor, geen publieke firmware, geen verborgen instellingen
gevonden, geen scherm, geen motorfaders, geen aanslaggevoeligheid. USB-gevoed:
direct aansluiten, niet via een zwakke hub. Onze wachtrij (16 berichten / 4 ms) aanhouden.

## Indeling (herzien en GEBOUWD 23 september 2026) — controller eerst

Na het onderzoek in `docs/APC40-onderzoek.md`: de eerste versie met mapjes
voor alles (B3) voelde niet logisch. Nu: één kolom = één track, de kern nooit
in een mapje. Fysieke plaatsing volgens de User Guide. Volledig en actueel op
`apc.html` (leest de mapping zelf); de mapping zelf is `mappings/apc40mk2.json`
(374 regels, versie 3; tot 25 sep 291). Op 25 september kwamen de DJ-functies van
ronde 3 erbij, zoals Clay koos ("Voorstel A"): zie hieronder, en de tabel
"Voorstel A".

**Per kolom (track 1–8)** — knob: filter (endless) · grid: zie modi · Clip
Stop: loop aan/uit (shift: loop weg) · Track Select: focus (shift: als tweede
track, de "vorige focus") · 2×2: nummer = play (shift: op de maat starten), S = sync (shift: tap), A|B =
crossfaderkant A → B → thru (LED geel = A, oranje = B, uit = thru), ● = cue,
ALLEEN met shift (rondlopen of per ongeluk cue zette een hoorbare track stil) ·
fader: volume (soft-takeover). Masterfader, crossfader, Cue Level =
sampler-volume (shift: puls).

**Rechts (track met focus)** — device knobs in de STRIP: trim · high · mid ·
low / echo · galm · fx-mix · fx 1; Clip/Device View (licht op) wisselt naar het
RACK (fx 1–8). Device ◀ ▶ = rack, On/Off = effect aan/uit (brandt als het
effect aan staat). Tempo = `track.{focus}.tempo`, lineair over de hele rate,
0,1% per tik (shift: 0,01%). Nudge ± = bend zolang je drukt, Tap = tap tempo,
Play = play, Record = opname (shift: stop), Session = samplerlengte (shift:
opnamesoort), Metronome = crossfadercurve, pijlen ◀ ▶ = focus, ▲ ▼ = grid-modus.
Bank ◀ ▶ = beatjump terug/vooruit (shift: lengte ½ / ×2, 1–32 tellen) · Pan /
Sends / User = loop in / loop out / reloop · Lock = quantize aan/uit voor alle
tracks (brandt als aan; in de grid-modus blijft Lock het grid-slot, want het
open mapje wint) · Stop All Clips = rem (vinylstop; geen lampje op het apparaat).
Vrij: Bank (0x67, voor keylock, VRAGEN I4) en Detail View (met `?vormen=1` het
mapje vorm).

**Ringknoppen:** alle 16 (track knobs en device knobs) in modus `endless`: de
knop geeft het verschil, de software houdt de stand. Geen overpakken na een
focus- of mapjewissel.

**Grid-modi op scene 1–4, klank op Shift + scene 5** (kleur fel = open, donker
= dicht): hotcues (geel: rij 1–4 hotcue per track, shift = wissen (rood zolang
shift vastzit), rij 5 loop aan/uit) · loops (cyaan: 1 · 2 · 4 · 8 · 16 tellen) ·
sampler (violet: rij 1 pads, rij 2 leegmaken, linksonder samplerlengte) · video
(blauw: effect vasthouden, mengvorm, puls-doel) · klank (magenta, per kolom =
track: rij 1 kill hoog, 2 kill mid, 3 kill laag — vasthouden = weg zolang je
drukt, shift + pad = vastzetten/losmaken; rij 4 rem; rij 5 op de maat starten).
Scene 5 = loop weg. ▲ ▼ loopt rond door alle vijf (hotcues → loops → sampler →
video → klank → hotcues). Vasthouden van een modusknop (ook Shift + scene 5)
vanuit een andere modus = even gluren.

Waarom klank op **Shift + scene 5**: scene 5 is al "loop weg", en dat moet één
druk blijven (een loop moet je snel kwijt kunnen). Shift + scene 5 was vrij, zit
direct onder de vier andere modusknoppen, en met shift vast licht scene 5 op in
de kleur van klank (donker magenta = dicht): je ziet dat hij er is. In de modus
klank brandt scene 5 fel magenta (`led.lees: layer.grid.klank`, zoals Metronome
in de grid-modus); de knop blijft loop weg. Nadeel: in klank zie je op scene 5
niet of er een loop loopt (Clip Stop per kolom toont dat wel). Magenta en geen
rood: rood is loop weg op dezelfde knop, en wissen.

**Kleuren (B4, gebouwd `5e297f4`):** uit = niets te doen · donkergrijs = leeg ·
DONKERE tint (paletindex n+1, de #59xxxx-kleuren, niet de pastels) = gevuld/dicht ·
volle tint = actief · rood = opname/wissen. Hotcues geel, loops cyaan, sampler
violet, video blauw, klank magenta, sync groen. In de modus klank: kill fel rood
= band weg, donkerrood = open, uit = lege track · rem fel oranje = remt, donker
oranje = speelt, uit = staat stil · op de maat fel groen = wacht op de maat,
donkergroen = speelt (drukken = pauze, zoals play), donkergrijs = stil (kan
starten), uit = lege track (de read van `play.quant`). Enkelkleurige
lampjes rechts: Lock = quantize aan, Bank ◀ ▶ = aan zolang je drukt (uit zonder
grid), met shift ◀ = halveren kan nog, ▶ = verdubbelen kan nog (`led.invert`),
Pan = loop in staat klaar, Sends = er loopt een loop, User = er is een loop.

**Knipperen op de tel (B2, zelf gerekend):** uit `track.N.phase` (gridfase op
positie min uitgangsvertraging, dus wat je hoort), niet met het knipperkanaal
van de APC. Een actieve loop-pad is fel op de tel en donker ertussen; de Track
Select van de track die de maat geeft knippert omgekeerd.

## Voorstel A (Clay 25 september 2026, GEBOUWD, niet op het apparaat nagelopen)

| waar | knop | doet | met shift |
|---|---|---|---|
| grid, modus klank (kolom = track) | rij 1 | kill hoog zolang je drukt (`track.N.kill.high.hold`) | kill hoog aan/uit (`track.N.kill.high`) |
| | rij 2 | kill mid zolang je drukt | kill mid aan/uit |
| | rij 3 | kill laag zolang je drukt | kill laag aan/uit |
| | rij 4 | rem (`track.N.brake`) | — |
| | rij 5 | op de maat starten (`track.N.play.quant`) | — |
| scene-knoppen | scene 5 | loop weg (in klank: lampje = klank open) | modus klank (`layer.grid.klank`) |
| pijlen | ▲ ▼ | modus rondlopen, nu met klank | — |
| 2×2-blok | nummer | play | op de maat starten |
| rechts (focus) | Bank ◀ ▶ | beatjump terug / vooruit | beatjump-lengte ½ / ×2 |
| | Pan · Sends · User | loop in · loop out · reloop | — |
| | Lock | quantize aan/uit (in de grid-modus: grid-slot) | idem |
| | Stop All Clips | rem | — |
| | Bank | vrij (keylock, VRAGEN I4) | vrij |

Eigen mapping: een nieuwe regel in de standaard komt vanzelf binnen (verschil,
`docs/MAPPING-VERSCHIL.md`). Clay's server had op 25 sep nog zijn VOLLEDIGE kopie
van 24 sep; die wordt afgezet tegen de standaard waar hij op rust (de voorganger
`35823dda-291` in `eerder` van het standaardbestand), zodat de 83 nieuwe regels
erbij komen en alleen zijn 4 rack-knoppen (video-effecten) van hem blijven.
Nagerekend met zijn echte kopie (GET, niets gepost): 374 regels, 4 eigen, 0
weggehaald, geen nieuwe regel op een van zijn sleutels.

Nog open: koptelefoon-cue (PFL) bestaat niet in VARVE (vraagt een tweede
audio-uitgang, VRAGEN F1); welke vrije knoppen de drukknoppen (`.hold`, D3)
worden; `PALETTE_HEX` heeft nog 60 van de 128 paletkleuren.

**Echofilter:** staat voor de APC nog aan (`echoFilter` in het profiel) tot
gemeten is dat hij in 0x42 niets terugkaatst.
