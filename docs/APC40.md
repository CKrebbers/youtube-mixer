# APC40 mkII en VARVE DJ

Uitkomst van twee onderzoeksagenten (23 september 2026). Bronnen: Akai
Communications Protocol v1.2 [P] en User Guide v1.0 [UG], plus de lokale
code. **Niets hiervan is al op de hardware getest.** Beslissingen staan in
`docs/VRAGEN.md` onder B.

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

**Tegenstrijdigheid in onze code (eerst testen!):** `INIT_SYSEX` stuurt 0x41,
maar `mappings/apc40mk2.json` rekent met bank-kanalen (`cc:1:16…`, `cc:2/3:16-23`)
die alleen in generic bestaan; `note:1:51` (track select) werkt juist alleen in
0x41/0x42. Oplossing die in elke modus werkt: device knobs → `track.{focus}.…`,
track select → focus. Controleren met de MIDI-monitor welke kanalen binnenkomen.

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

## Voorgestelde indeling (kolom = track 1–8)

| Sectie | Normaal | Met shift |
|---|---|---|
| Fader / master / crossfader | `track.N.fader` / `mixer.master` / `mixer.xfader` | – |
| Activator | `track.N.play` | `track.N.cue` |
| Solo | `track.N.sync` (LED: aan = in sync, knippert = geeft de maat) | `track.N.tap` |
| Record arm | `venster.R.toon.N` | `venster.L.toon.N` |
| Track select | `track.N.focus` | – |
| Clip stop | `track.N.loop.wissel` | `track.N.loop.exit` |
| A/B | `track.N.xfade.kant` (uit=A, geel=B, oranje=thru — feedback.js moet 3 standen leren) | – |
| Device knobs | `track.{focus}.fx.knop.1–8`; Clip/Device view wisselt naar strip (high/mid/low/trim/fx.mix/send.a/send.b/pitch); Master-knop → video.fx.* | shift+Master: `send.a/b.knop.1–8` |
| Track knobs | laag via Pan/Sends/User: **Pan = `track.N.filter`**, Sends = `track.N.send.a` (shift: `.send.b`), User = `track.{R}.fx.knop.1–8` (rack van het rechtervenster) | |
| Grid rij 1–4 | `track.N.hotcue.1–4` | `.hotcue.K.delete` |
| Grid rij 5 | `sampler.1–8` | `sampler.K.wis` |
| Scene 1–5 | beatloop 4 · 8 · 16 · loop ½ · loop ×2 (focus-track) | loop 2/4/8 s · beatloop 1/2 |
| Device-knoppen | on/off = `fx.bypass`, device L/R = `grid.halve/double`, bank L/R = `grid.back/fwd`, detail = `grid.here` | shift+device lock = `rack.volgend`, shift+Pan = `fx.next`, shift+bank lock = `grid.clear` |
| Transport | Play = `track.{focus}.play`, Record = `opname.start`, Session = `sampler.lengte`, Tap, Nudge ± | Record = `opname.stop`, Session = `opname.soort` |
| Encoders | tempo = `track.{focus}.pitch`, cue = `sampler.volume` | cue = `video.puls` |
| Pijlen | links/rechts = `focus.vorige/volgende`, op/neer = `video.modus` / `video.puls.doel` | |
| Metronome | `mixer.xfader.curve` | |
| Stop all clips | bewust leeg | |

**Kleuren op het grid:** uit = niets te doen · donkergrijs = leeg · zachte tint =
gevuld · volle tint = actief · knipperen = loopt in de tijd · rood = opname/wissen.
Hotcues geel, loops cyaan, sampler violet→magenta, video blauw, sync groen.

**Al gebouwd (23 sep, zonder hardware):** `venster.L/R.toon.N`, `opname.start/stop/soort`,
`track.N.loop.wissel`, `track.N.maat`, `track.N.tel` (alleen lezen, voor LED's),
`focus.vorige/volgende`, `track.N.rack.volgend/vorig`.

**Nog te bouwen voor deze indeling:**
- `"shift": true` op een mappingregel (mapping.js houdt bij of noot 0x62 ingedrukt is)
- lagen voor track knobs (Pan/Sends/User) en device knobs (rack/strip/video/bussen)
  als toestand in de controllaag, met variabelen zoals `{focus}` en `{R}`
- feedback.js: halve kleur/drie standen (`led: {aan, half, uit}`) en RGB-kleurbetekenis
- `PALETTE_HEX` aanvullen tot 128
- nieuwe standaardmapping volgens de tabel, na de keuzes in VRAGEN.md B
