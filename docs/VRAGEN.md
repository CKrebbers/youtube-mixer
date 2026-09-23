# Open vragen voor Clay

Stand: 23 september 2026 (avond), na verbeterronde 1 en 2 uit
`docs/VERBETERINGEN.md`. Open: A2, A3, F1; de rest is beslist en gebouwd. Per vraag: wat er speelt, de opties, mijn advies, en wat er
nodig is om hem te beantwoorden. Afvinken zodra beslist; het besluit komt
daarna in CLAUDE.md of ROADMAP.md.

Legenda — nodig: 🎧 luisteren · 🎛 de APC erbij · 💬 alleen een keuze

---

## A. Eerst: wat er nu klaarstaat

- [x] **A1. Committen.** 💬 — gedaan 23 sep, tien commits, elk apart getest.
  Er staat veel ongecommit: sends, sampler, en de hele verbeterronde (engine,
  klikvrij transport, races, server, live-veiligheid, APC-actions, tests).
  **Advies:** nu committen, in een paar logische stukken (sends · sampler ·
  engine-correctheid · klikvrij · server · interface · tests). Hoe langer het
  wacht, hoe moeilijker netjes te splitsen.

- [ ] **A2. Luistertest: streamen, loops, seek.** 🎧
  Alles is gemeten, niets is beluisterd. Tien minuten: een album spelen,
  springen in de golfvorm, hotcues, loops van 4 tellen, pitch schuiven.
  Hoor je ergens nog een tik of gat?

- [ ] **A3. Luistertest: keylock (Signalsmith-demo).** 🎧
  Staat al sinds fase 3 open. Een kwartier met de demo op je eigen ambient,
  ±5% en ±8%. Beslist of keylock Signalsmith wordt. Daarmee is fase 3 af.

---

## B. De APC40 mkII — eerst testen, dan kiezen 🎛

- [x] **B1. In welke modus zetten we het apparaat?** — OPGELOST: Clay koos
  0x42 (23 sep, `08e9a86`). Gemeten in 0x41: device knob 1 op `cc:0:16`, welke
  track je ook selecteerde. Init stuurt nu 0x42; device knobs
  `cc:0:16-23` → `track.{focus}.…`, Track Select → focus. De tegenstrijdigheid
  (init 0x41, mapping met generic-banken) bestaat niet meer.
  Oorspronkelijke vraag: we stuurden de init voor 0x41, maar de mapping rekende
  met banken op aparte MIDI-kanalen die alleen in generic mode bestaan.
  - **0x42 (Alternate Ableton):** alles momentary, álle LED's en ringen van
    ons, track select stuurt MIDI. Banken doen we zelf met `{focus}`.
  - 0x40 (generic): het apparaat doet banken zelf, maar track select stuurt
    niets en ringen zijn alleen "single".
  **Advies:** 0x42, en de device knobs via `{focus}` (werkt in elke modus).
  **Eerst:** met de MIDI-monitor kijken welke kanalen er nu echt binnenkomen.

- [x] **B2. Knipperen op de tel: door de APC of door ons?** — gebouwd
  (`5e297f4`): zelf gerekend uit `track.N.phase` (positie min
  uitgangsvertraging); loop-pads en de Track Select van de maatgever. MIDI
  clock niet geprobeerd.
  Het grid kan zelf pulseren/knipperen, maar alleen synchroon als wij MIDI
  clock sturen (onbevestigd). Zelf knipperen via `track.N.tel` kan altijd.
  **Advies:** zelf (klokvast volgens regel 3); MIDI clock proberen als extra.

- [x] **B3. De indeling.** GEBOUWD 23 sep, daarna HERZIEN na onderzoek (`docs/APC40-onderzoek.md`): controller eerst, één kolom = één track, filter boven elke kolom (Clay), grid-modi op de scene-knoppen. Tabel in `docs/APC40.md`, alles op `apc.html`. Eerste versie: Richting gekozen door Clay: **mapjes (lagen)**.
  Vaste kern die nooit wisselt (faders, crossfader, master, play/cue/sync,
  tempo, Track Select); drie soorten mapjes met een oplichtende kiesknop —
  track knobs (Pan/Sends/User), device knobs (rack / EQ-strip / send-bussen /
  video), grid (Shift + scene launch: hotcues / loops / sampler / video);
  kort drukken = vast, vasthouden = even gluren; een balkje op het scherm zegt
  wat de knoppen nu doen; mapjes zijn data in de mapping en zelf te vullen.
  Eerst meten wat 0x42 stuurt, dan het volledige voorstel.
  Oorspronkelijk voorstel: Voorstel uit het onderzoek (volledig: `docs/APC40.md`; samengevat):
  - kolom = track 1–8, fader = volume, **Activator** = play (shift: cue),
    **Solo** = sync (shift: tap), **Track select** = focus,
    **Clip stop** = loop aan/uit, **A/B** = crossfaderkant
  - **device knobs** = het rack van de track met focus (`fx.knop.1–8`)
  - **track knobs** met de knoppen Pan/Sends/User als laagkeuze:
    Pan = filter per track, Sends = send echo (shift: galm), User = rack van
    het rechtervenster ("twee tracks tegelijk")
  - **grid rij 1–4** = hotcues per track, **rij 5** = sampler-pads;
    **scene launch** = beatloops van de focus-track
  - **Record** = opname start (shift: stop), tempo-encoder = pitch,
    cue-encoder = sampler-volume, pijlen = focus / video
  Deelkeuzes (VERVALLEN door de herziene indeling van `53e8551`; wat er nu
  staat: Track Select = focus, shift = tweede track; filter vast boven elke
  kolom, geen lagen voor de track knobs; grid-modi op de scene-knoppen;
  opname stoppen = shift + Record; cue alleen met shift + ●; Stop All vrij):
  - [-] **B3a. Volgt het linkervenster de focus?** Advies: ja; Arm zet een track rechts.
  - [-] **B3b. Standaardlaag van de track knobs: filter of sends?** Advies: filter.
  - [-] **B3c. Een tweede gridpagina** (loops per track, video-toggles)? Advies: nog niet.
  - [-] **B3d. Opname stoppen op de APC:** shift+Record of dubbel drukken? Advies: shift.
  - [-] **B3e. Cue alleen onder shift?** Advies: ja; bij lange stukken wil je zelden live terug.
  - [-] **B3f. Stop All Clips** bewust leeg laten? Advies: ja.

- [x] **B4. Kleurbetekenis op het grid** — gebouwd (`5e297f4`): "zachte tint"
  werd de DONKERE variant (paletindex n+1, #59xxxx), niet de pastels; drie
  standen uit `read()`, wis-regels rood zolang shift vastzit.
  Voorstel was: uit = niets te doen,
  donkergrijs = leeg, zachte tint = gevuld, volle tint = actief, knipperen =
  loopt in de tijd, rood = opname/wissen. Akkoord of eigen kleuren?

---

## C. Spelen en mixen 💬

- [x] **C1. Pitchbereik.** — Clay: kiesbaar, standaard ±16% (gebouwd 23 sep). De fader doet ±8%, sync mag tot 0,5–2×. Na een
  grote sync staat de fader tegen de aanslag en springt terug als je hem
  aanraakt. Opties: ±8 / ±16 / ±50%, of het bereik schuift mee met sync.
  **Advies:** kiesbaar ±8/±16/±50, standaard ±16.

- [x] **C2. Pitch terug op 0 bij een nieuw nummer?** — Clay: ja (gebouwd 23 sep). Nu houdt een track de
  pitch van het vorige nummer. **Advies:** ja, terug naar 0.

- [x] **C3. Crossfaderkant: één knop die rondloopt (A→B→thru) of drie aparte?**
  Rondlopen kan een hoorbare track per ongeluk stil zetten. **Advies:** drie
  kleine segmenten op het scherm; op de APC blijft het één knop.
  — Clay: drie segmenten (gebouwd 23 sep). Later vervangen (`5e297f4`,
  `c2d580f`): één A|B-knop op scherm én APC met de kant als kleur (geel A,
  oranje B, uit thru): je ziet waar je naartoe loopt. Cue kwam achter
  shift + ●, want een per ongeluk ingedrukte cue zette een hoorbare track stil.

- [x] **C4. Klik op het tracknummer in de trackrij = play?** Je verwacht
  eerder "selecteren". **Advies:** nummer = focus, play op een eigen knopje.
  — Clay: zo doen (gebouwd 23 sep: nummer = `track.N.focus`, ▶ = play).

- [x] **C5. Sends: vóór of na de crossfader?** Nu na de fader, vóór de
  crossfader: een track die je met de crossfader wegdraait, blijft insturen.
  **Advies:** zo laten (echo-out met de crossfader werkt dan ook).
  — Clay: zo laten (23 sep).

- [x] **C6. De echo op de bus op de maat?** Nu een vaste tijd (~250 ms).
  **Advies:** ja, een tijd in tellen (1/8, 3/16, 1/4) op de klok van de maat.
  — Clay: ja, met een schakelaar (gebouwd 23 sep: delay-parameter `sync`, echo-bus knop 4).

---

## D. Nieuwe onderdelen — ja of nee? 💬

- [x] **D1. Samples bewaren bij een nummer** (nu alleen deze sessie).
  — Clay: ja, bij het nummer (gebouwd 23 sep: plek bewaren, opnieuw knippen, ↺ op de pad).
- [x] **D2. Pads die meelopen met tempowijzigingen** van de maat-track.
  — Clay: ja, tempo én tel (gebouwd 23 sep: `Sampler.heranker`).
- [x] **D3. Dub-worp en Vasthouden als drukknop** (werkt zolang je vasthoudt) — hoort bij B3.
  — Clay: elke knopplek (gebouwd 23 sep: `.hold`-actions, alt+vasthouden op het scherm).
  Op de APC nog NIET toegewezen: voorstel (Lock = dub-worp, Detail View = galm
  vasthouden) staat in `docs/VERBETERINGEN.md` ronde 3.
- [x] **D4. Losse bestanden ook via de streamkern** (geen tik bij loops, één afspeelmotor).
  — Clay: ja (gebouwd 23 sep: `laadGeheugen`, `maakWav`, `geheugenHaal`).
- [x] **D5. Eén paneel tegelijk onderin** (library, rack-editor, MIDI overlappen nu),
  en video als inklapbare kolom in plaats van over het rechtervenster.
  — Clay: beide (gebouwd 23 sep).

---

## E. Techniek — mag ik dit gewoon doen? 💬

- [x] **E1. app.js opsplitsen** (± 1000 regels) in modules: vensters, racks,
  sessie/laden, MIDI-opzet, opname-knop, video-paneel, renderloop.
  Verandert niets aan wat je ziet. **Advies:** ja, na de commit.
  — Clay: ja (gedaan 23 sep: app.js 1183 → 128 regels, tien modules).

- [x] **E2. Action-namen gelijktrekken** (nu Engels en Nederlands door elkaar:
  `hotcue.1.delete` naast `sampler.1.wis`). Kan zonder dat je mappings breken
  (de omzetting bestaat al). **Advies:** ja, vóór de APC-indeling definitief wordt.
  — Clay: alles Engels (gedaan 23 sep: mapping versie 3, `NIEUWE_NAMEN` zet oude namen om).

- [x] **E3. Mappings ook op de server bewaren** in plaats van alleen in de
  browser (localStorage). Dan overleven ze een andere browser of gewiste data.
  — Clay: ja (gebouwd 23 sep: server eerst, localStorage reserve; herstellen wist beide).

---

## F. Nieuw uit het APC-onderzoek

- [ ] **F1. Koptelefoon-cue (PFL).** De op vier na meest gebruikte DJ-functie,
  maar VARVE heeft één audio-uitgang. Vraagt een tweede uitgang (tweede
  geluidskaart, of kanaal 3/4 van een interface). Eerst bespreken, niet bouwen.

---

## G. Clay's map `Input/` (23 sep, zie docs/INPUT.md)

- [ ] **G1. Wat wil je met `Input/`?** Naslag, ideeënbak, of iets waarin VARVE en AV-kern
  samenkomen? (fase1-zip = oude versie van dit project; av-kern = eigen project met eigen
  .git, Vite/TS; blueprint-varvedj.json = Bedienplan-export: twee decks, vier beeldlagen.)
- [ ] **G2. Is de blauwdruk een nieuwe wens?** Hij botst met vastgelegde keuzes (acht
  tracks / één kolom = één track, beeld = video van de track, fader = volume). Heropenen
  of alleen losse functies plukken (hotcues 5–8, loop in/out, brake/slip/kill, tempo-master)?
- [ ] **G3. Actielog met terugspelen** (idee uit AV-kern, ~1 dag): set opnieuw renderen of
  een fout naspelen. Willen?
- [ ] **G4. Bedienplan blijven gebruiken?** Pas dan loont een import naar de VARVE-mapping.
- [ ] **G5. Wat is een "Vormmachine"** (26 in de blauwdruk, nergens gevonden)?
- [ ] **G6. `Input/` in git of in .gitignore?** Advies: .gitignore (zips + een complete
  .git van AV-kern); alleen de blauwdruk eventueel naar docs/. En waar is de lege map
  `modules/` voor?
