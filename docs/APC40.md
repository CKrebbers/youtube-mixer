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

## Indeling (herzien en GEBOUWD 23 september 2026) — controller eerst

Na het onderzoek in `docs/APC40-onderzoek.md`: de eerste versie met mapjes
voor alles (B3) voelde niet logisch. Nu: één kolom = één track, de kern nooit
in een mapje. Fysieke plaatsing volgens de User Guide. Volledig en actueel op
`apc.html` (leest de mapping zelf).

**Per kolom (track 1–8)** — knob: filter · grid: zie modi · Clip Stop: loop
aan/uit (shift: loop weg) · Track Select: focus (shift: in rechtervenster) ·
2×2: nummer = play, A|B = cue, S = sync (shift: tap), ● = crossfaderkant ·
fader: volume. Masterfader, crossfader, Cue Level = sampler-volume (shift: puls).

**Rechts (track met focus)** — device knobs in de STRIP: trim · high · mid ·
low / echo · galm · fx-mix · fx 1; Clip/Device View (licht op) wisselt naar het
RACK (fx 1–8). Device ◀ ▶ = rack, On/Off = effect uit. Tempo = pitch (shift:
fijn), Nudge ± = bend zolang je drukt, Tap = tap tempo, Play = play, Record =
opname (shift: stop), Session = samplerlengte (shift: opnamesoort), Metronome
= crossfadercurve, pijlen ◀ ▶ = focus, ▲ ▼ = grid-modus. Pan/Sends/User, Bank
◀ ▶, Lock, Detail View, Bank, Master, Stop All: vrij.

**Grid-modi op scene 1–4** (kleur fel = open, gedimd = dicht): hotcues (geel:
rij 1–4 hotcue per track, shift = wissen, rij 5 loop aan/uit) · loops (cyaan:
1 · 2 · 4 · 8 · 16 tellen) · sampler (violet: rij 1 pads, rij 2 leegmaken) ·
video (blauw: effect vasthouden, mengvorm, puls-doel). Scene 5 = loop weg.

Nog open: koptelefoon-cue (PFL) bestaat niet in VARVE (vraagt een tweede
audio-uitgang); welke vrije knoppen de drukknoppen (`.hold`, D3) worden.

**Kleuren op het grid:** uit = niets te doen · donkergrijs = leeg · zachte tint =
gevuld · volle tint = actief · knipperen = loopt in de tijd · rood = opname/wissen.
Hotcues geel, loops cyaan, sampler violet→magenta, video blauw, sync groen.

**Al gebouwd (23 sep, zonder hardware):** `window.L/R.show.N`, `record.start/stop/mode`,
`track.N.loop.toggle`, `track.N.leads`, `track.N.beat` (alleen lezen, voor LED's),
`focus.prev/next`, `track.N.rack.next/prev`.

**Nog te bouwen voor deze indeling:**
- `"shift": true` op een mappingregel (mapping.js houdt bij of noot 0x62 ingedrukt is)
- lagen voor track knobs (Pan/Sends/User) en device knobs (rack/strip/video/bussen)
  als toestand in de controllaag, met variabelen zoals `{focus}` en `{R}`
- feedback.js: halve kleur/drie standen (`led: {aan, half, uit}`) en RGB-kleurbetekenis
- `PALETTE_HEX` aanvullen tot 128
- nieuwe standaardmapping volgens de tabel, na de keuzes in VRAGEN.md B
