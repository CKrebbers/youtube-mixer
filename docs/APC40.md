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

## Indeling (GEBOUWD 23 september 2026, VRAGEN B3) — mode 0x42, met mapjes

Gemeten in 0x42: Track Select `note:N:51` (kanaal = kolom), device knobs
`cc:0:16–23` (altijd kanaal 0), track knobs `cc:0:48–55`, Pan/Sends/User
`note:0:87/88/89`, Shift `note:0:98`, tempo `cc:0:13` relatief, Bank ◀ ▶
`note:0:60/61`. Niet gemeten (uit het protocol): Clip Stop `note:N:52`,
cue level `cc:0:47`.

**Vaste kern (nooit anders)**
| Knop | Normaal | Met shift |
|---|---|---|
| Fader 1–8 · master · crossfader | `track.N.fader` · `mixer.master` · `mixer.xfader` | – |
| Activator | `track.N.play` | `track.N.cue` |
| Solo | `track.N.sync` | `track.N.tap` |
| A/B | `track.N.xfade.side` | – |
| Track Select | `track.N.focus` | – |
| Record Arm | `window.R.show.N` | `window.L.show.N` |
| Clip Stop | `track.N.loop.toggle` | `track.N.loop.exit` |
| Tempo · Nudge ± · Play · Tap | pitch · nudge · play · tap van `{focus}` | – |
| Record | `record.start` | `record.stop` |
| Session | `sampler.length` | `record.mode` |
| Metronome | `mixer.xfader.curve` | – |
| Pijlen ← → / ↑ ↓ | `focus.prev/next` / `layer.grid.prev/next` | – |
| Cue level | `sampler.volume` | `video.pulse` |
| Scene launch 1–5 | beatloop 4 · 8 · 16 · ½ · ×2 (focus) | grid-mapje hotcues · loops · sampler · video · – |
| Device ◀ ▶ · On/Off | `rack.prev/next` · `fx.bypass` (focus) | – |
| Stop All Clips, Lock, Bank Lock, Master | bewust leeg | – |

**Mapjes**
| Kiesknop | Mapje | Knoppen doen |
|---|---|---|
| Pan | top.filter | track knob N = `track.N.filter` |
| Sends (nog eens: galm) | top.echo / top.reverb | `track.N.send.a` / `.send.b` |
| User | top.low | `track.N.low` (bass-swap) |
| Clip/Device View | device.rack | `track.{focus}.fx.knob.1–8` |
| Detail View | device.strip | trim · high · mid · low · filter · fx.mix · send.a · send.b |
| Bank ◀ | device.sends | echo 1–4 · galm 1–3 · sampler-volume |
| Bank ▶ | device.video | 6 effecten · puls |
| Shift+scene 1 / ↑↓ | grid.hotcues | rij 1–4 hotcue 1–4 per track (shift: wissen), rij 5 sampler (shift: leeg) |
| Shift+scene 2 | grid.loops | rij 1–5 = beatloop 1 · 2 · 4 · 8 · 16 per track |
| Shift+scene 3 | grid.sampler | rij 1 pads, rij 2 leegmaken, pad 1/5 lengte |
| Shift+scene 4 | grid.video | rij 1 effect vasthouden, rij 2 mengvorm · puls-doel |

Kort drukken = vast, vasthouden = gluren. Het balkje bovenin zegt wat de
knoppen nu doen. Nog open: welke APC-knoppen de drukknoppen (`.hold`, D3)
worden, en de kleurbetekenis (B4) en knipperen op de tel (B2).

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
