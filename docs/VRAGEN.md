# Open vragen voor Clay

Stand: 23 september 2026, na de verbeterronde met vier auditagenten en het
APC40-onderzoek. Per vraag: wat er speelt, de opties, mijn advies, en wat er
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

- [ ] **B1. In welke modus zetten we het apparaat?**
  Het onderzoek vond een tegenstrijdigheid: we sturen de init voor modus 0x41
  (Ableton), maar de mapping rekent met banken op aparte MIDI-kanalen — en die
  bestaan alleen in generic mode. Een van de twee klopt nu niet.
  - **0x42 (Alternate Ableton):** alles momentary, álle LED's en ringen van
    ons, track select stuurt MIDI. Banken doen we zelf met `{focus}`.
  - 0x40 (generic): het apparaat doet banken zelf, maar track select stuurt
    niets en ringen zijn alleen "single".
  **Advies:** 0x42, en de device knobs via `{focus}` (werkt in elke modus).
  **Eerst:** met de MIDI-monitor kijken welke kanalen er nu echt binnenkomen.

- [ ] **B2. Knipperen op de tel: door de APC of door ons?**
  Het grid kan zelf pulseren/knipperen, maar alleen synchroon als wij MIDI
  clock sturen (onbevestigd). Zelf knipperen via `track.N.tel` kan altijd.
  **Advies:** zelf (klokvast volgens regel 3); MIDI clock proberen als extra.

- [ ] **B3. De indeling.** Voorstel uit het onderzoek (volledig: `docs/APC40.md`; samengevat):
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
  Deelkeuzes:
  - [ ] **B3a. Volgt het linkervenster de focus?** Advies: ja; Arm zet een track rechts.
  - [ ] **B3b. Standaardlaag van de track knobs: filter of sends?** Advies: filter.
  - [ ] **B3c. Een tweede gridpagina** (loops per track, video-toggles)? Advies: nog niet.
  - [ ] **B3d. Opname stoppen op de APC:** shift+Record of dubbel drukken? Advies: shift.
  - [ ] **B3e. Cue alleen onder shift?** Advies: ja; bij lange stukken wil je zelden live terug.
  - [ ] **B3f. Stop All Clips** bewust leeg laten? Advies: ja.

- [ ] **B4. Kleurbetekenis op het grid** — voorstel: uit = niets te doen,
  donkergrijs = leeg, zachte tint = gevuld, volle tint = actief, knipperen =
  loopt in de tijd, rood = opname/wissen. Akkoord of eigen kleuren?

---

## C. Spelen en mixen 💬

- [ ] **C1. Pitchbereik.** De fader doet ±8%, sync mag tot 0,5–2×. Na een
  grote sync staat de fader tegen de aanslag en springt terug als je hem
  aanraakt. Opties: ±8 / ±16 / ±50%, of het bereik schuift mee met sync.
  **Advies:** kiesbaar ±8/±16/±50, standaard ±16.

- [ ] **C2. Pitch terug op 0 bij een nieuw nummer?** Nu houdt een track de
  pitch van het vorige nummer. **Advies:** ja, terug naar 0.

- [ ] **C3. Crossfaderkant: één knop die rondloopt (A→B→thru) of drie aparte?**
  Rondlopen kan een hoorbare track per ongeluk stil zetten. **Advies:** drie
  kleine segmenten op het scherm; op de APC blijft het één knop.

- [ ] **C4. Klik op het tracknummer in de trackrij = play?** Je verwacht
  eerder "selecteren". **Advies:** nummer = focus, play op een eigen knopje.

- [ ] **C5. Sends: vóór of na de crossfader?** Nu na de fader, vóór de
  crossfader: een track die je met de crossfader wegdraait, blijft insturen.
  **Advies:** zo laten (echo-out met de crossfader werkt dan ook).

- [ ] **C6. De echo op de bus op de maat?** Nu een vaste tijd (~250 ms).
  **Advies:** ja, een tijd in tellen (1/8, 3/16, 1/4) op de klok van de maat.

---

## D. Nieuwe onderdelen — ja of nee? 💬

- [ ] **D1. Samples bewaren bij een nummer** (nu alleen deze sessie).
- [ ] **D2. Pads die meelopen met tempowijzigingen** van de maat-track.
- [ ] **D3. Dub-worp en Vasthouden als drukknop** (werkt zolang je vasthoudt) — hoort bij B3.
- [ ] **D4. Losse bestanden ook via de streamkern** (geen tik bij loops, één afspeelmotor).
- [ ] **D5. Eén paneel tegelijk onderin** (library, rack-editor, MIDI overlappen nu),
  en video als inklapbare kolom in plaats van over het rechtervenster.

---

## E. Techniek — mag ik dit gewoon doen? 💬

- [ ] **E1. app.js opsplitsen** (± 1000 regels) in modules: vensters, racks,
  sessie/laden, MIDI-opzet, opname-knop, video-paneel, renderloop.
  Verandert niets aan wat je ziet. **Advies:** ja, na de commit.

- [ ] **E2. Action-namen gelijktrekken** (nu Engels en Nederlands door elkaar:
  `hotcue.1.delete` naast `sampler.1.wis`). Kan zonder dat je mappings breken
  (de omzetting bestaat al). **Advies:** ja, vóór de APC-indeling definitief wordt.

- [ ] **E3. Mappings ook op de server bewaren** in plaats van alleen in de
  browser (localStorage). Dan overleven ze een andere browser of gewiste data.
