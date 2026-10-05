# Open vragen voor Clay

Stand: 25 september 2026. Open: A2, A3 (keylock-luistertest staat klaar), F1, H3,
H5 (deels beantwoord), I1–I4 (keylock na het luisteren) en het nieuwe blok J (keuzes
uit de sporen van 25 sep). G1–G6, H1, H2, H4 en H6 zijn beslist; de toonsoort- en
keylockkeuzes staan in blok I. Per vraag: wat er speelt, de opties, mijn advies, en wat er
nodig is om hem te beantwoorden. Afvinken zodra beslist; het besluit komt
daarna in CLAUDE.md of ROADMAP.md.

Legenda — nodig: 🎧 luisteren · 🎛 de APC erbij · 👀 kijken · 💬 alleen een keuze

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
  **Klaar om te luisteren (24 sep):** niet de demo maar je eigen nummers, door
  de echte Signalsmith 1.3.2 gehaald: `tools/keylock/uit/` (sakamoto, zoned-out,
  adriana, no-surprises), leeswijzer en scorekaart in `tools/keylock/LUISTER.md`.
  Daarna de beslissingen K1–K8 in `docs/KEYLOCK.md` (ontwerp, metingen, advies).

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

- [x] **F1. Koptelefoon-cue (PFL).** — 5 okt: de Scarlett 2i2 voor de zaal en de
  koptelefoonuitgang van de Mac, samen één samengesteld apparaat (vier kanalen, één
  klok). Gebouwd als STUDIO S1, `docs/STUDIO.md` §3. (De vraag was: VARVE heeft één
  audio-uitgang; een cue vraagt een tweede, of kanaal 3/4 van een interface.)

---

## G. Clay's map `Input/` (23 sep, zie docs/INPUT.md)

- [x] **G1. Wat wil je met `Input/`?** — 24 sep: AV-kern en Varve samenbrengen; uitgewerkt in docs/plugins/01-plan.md. Naslag, ideeënbak, of iets waarin VARVE en AV-kern
  samenkomen? (fase1-zip = oude versie van dit project; av-kern = eigen project met eigen
  .git, Vite/TS; blueprint-varvedj.json = Bedienplan-export: twee decks, vier beeldlagen.)
- [x] **G2. Is de blauwdruk een nieuwe wens?** — 24 sep: nee, losse functies plukken (spoor C); Varve wordt geen blauwdruk op AV-kern. Hij botst met vastgelegde keuzes (acht
  tracks / één kolom = één track, beeld = video van de track, fader = volume). Heropenen
  of alleen losse functies plukken (hotcues 5–8, loop in/out, brake/slip/kill, tempo-master)?
- [x] **G3. Actielog met terugspelen** — 24 sep: ja, als spoor D (ROADMAP punt 20), niet hash-exact. (idee uit AV-kern, ~1 dag): set opnieuw renderen of
  een fout naspelen. Willen?
- [x] **G4. Bedienplan blijven gebruiken?** — 24 sep, middag: Clay vroeg of "alleen
  AV-kern" de beste aanpak is; advies ja, genoteerd als besluit tenzij hij het anders
  wil. Bedienplan blijft de bron voor AV-kern; Varve houdt zijn eigen mapping, koppelen
  en `apc.html`. Geen importeur (spoor D wordt alleen het handelingenlog). Mist Clay
  ooit het overzicht van Bedienplan voor Varve, dan een EXPORT Varve → blauwdruk
  (alleen lezen), niet andersom. Pas dan loont een import naar de VARVE-mapping.
- [x] **G5. Wat is een "Vormmachine"** — gevonden: Clay's artifact, nu `Input/vormmachines.html`, gebouwd als vormlagen. (26 in de blauwdruk, nergens gevonden)?
- [x] **G6. `Input/` in git of in .gitignore?** — Clay: .gitignore (e285371). Open: waar is `modules/` voor? Advies: .gitignore (zips + een complete
  .git van AV-kern); alleen de blauwdruk eventueel naar docs/. En waar is de lege map
  `modules/` voor?

---

## H. Nieuw (24 sep, nacht): vormlagen en stems

- [x] **H1. Klinken de stems goed genoeg?** — Clay (24 sep, middag): ja, ze klinken
  goed, ook al hadden de nummers weinig lagen. Door naar H2. 🎧 Luister naar `tools/stems/uit/no-surprises/`
  (4-vocals, 3-other) en `bay-ledges/`. Is zang ↔ instrumentaal schoon genoeg om live
  mee te spelen? Nee = stems parkeren. Ja = H2.
- [x] **H2. Twee stems of vier?** — Clay (24 sep, middag): **kiesbaar per nummer**.
  Standaard twee (zang, rest); vier als je dat bij het binnenhalen vraagt. Bouwen na
  25 okt (ROADMAP 17). 💬 Bij Clay's repertoire zijn drums en bas vrijwel leeg.
  **Advies:** twee (zang, rest): half de opslag, één knop per track.
- [ ] **H3. Splitsen op de Omarchy-machine?** 💬 (GTX 1660; geschat 3–6× sneller, en het
  concurreert niet met de set.) Eerst meten met meet.py daar. Daarna: batch via een
  gedeelde map, geen open dienst.
- [x] **H4. Vormlagen op de APC en de beamer: bevalt het?** — Clay (24 sep, middag):
  "goed voor nu". Budgetten en waasdrempel blijven zoals ze zijn tot er iets opvalt. 🎛 Zie ROADMAP punt 1. Specifiek:
  is de waasdrempel (3–8%) te streng voor zachte sporen, en werken de budgetten
  van 4 en 12 ms op de M1 met 8 video's?
- [ ] **H5. Na 25 okt: eerst de AI-laag van AV-kern of eerst Varve (ROADMAP 13–26)?** 💬
  — Deels beantwoord door 25 sep: op Clay's vraag ("zoveel mogelijk met sub agents")
  zijn 13, 14, 16, 18, 20, 21, 22, 23 (deel) en 24 al gebouwd. Van Varve blijven
  vooral 15 keylock, 17 stems, 23 (rest), 25 en 26 over (volgorde in ROADMAP). Open
  blijft: gaat AV-kern (publicatie 25 okt, daarna de AI-laag) vóór keylock en stems?
- [x] **H6. Isomorfe vormen met geluid?** — Clay (24 sep, middag): **eerst AV-kern, dan
  Varve**. Het geluid wordt één audiomodule (AudioWorklet: aanslagen komen als berichten
  uit de Worker, de modale synthese rekent in de worklet in plaats van 12–32 ms op de
  hoofdthread), eerst voor AV-kern 06a–c (Resonator, Korrelwolk). Na 25 okt in Varve via
  een eigen vormbus vóór de limiter, standaard dicht; grondtoon = toonsoort van de
  maatgever (zodra toonsoort-detectie er is), zelf spelen op de tel, korrelwolk op een
  sampler-pad. 💬 Snaar, trommelvlies, epicykels en korrelwolk
  kunnen ook klinken (sink vóór de limiter, eigen gain, standaard dicht). Willen, en zo
  ja: welke bus?

---

## I. Toonsoort en keylock (24 sep, middag)

Onderzocht met twee agenten: `docs/TOONSOORT.md` en `docs/KEYLOCK.md`. Clay koos
**bouwen na 25 okt, vooraan**: direct na "mapping als verschil bewaren", eerst
toonsoort en dan keylock.

Beslist:
- **T3, door Clay:** kolomkop en focusdeel tonen de toonsoort die je HOORT, met pitch
  en transpositie; de library toont de plaat.
- **K3, door Clay:** een sprong met keylock aan duurt ~95 ms en komt exact uit.
- **K8, door Clay:** toon verschuiven mag ook als keylock uit staat.
- **Volgens advies, tenzij Clay bezwaar maakt:**
  - T1: Temperley 2005;
  - T2: `9B G`, met de volle naam in het focusdeel;
  - T4: onzeker = gedimd met "?", onder 0,15 een "~";
  - T5: cent tonen vanaf 20 cent afwijking;
  - T6: corrigeren op de APC komt later;
  - T7: harmonisch mixen komt later en staat standaard uit;
  - K5: ±12 halve tonen, terug naar 0 bij een nieuw nummer;
  - K7: de sampler blijft zoals hij is.

Open:
- [ ] **I1 (= K1). Wordt het Signalsmith?** 🎧 Na A3. Scoort ±5% op sakamoto en zoned-out
  een 0 of 1 op de scorekaart, dan ja.
- [ ] **I2 (= K2). Welke instelling?** 🎧 Standaard, goedkoper of kort. Luister naar
  13 en 14 tegen 08. **Advies:** standaard, gespreid; goedkoper als je 13 niet van 08
  onderscheidt.
- [ ] **I3 (= K4). Keylock standaard aan of uit?** 🎧 Luister naar 01 tegen 04.
  **Advies:** uit, en keylock blijft staan bij een nieuw nummer.
- [ ] **I4 (= K6). Waar op de APC?** 🎛 Clay 25 sep (voorstel A): keylock krijgt
  later Bank. De rest van het voorstel hieronder staat nog open. **Voorstel:**
  - Bank = keylock;
  - Shift + Bank = pitchbereik;
  - Shift + Nudge ± = toon;
  - Shift + Tap = toon terug naar 0.

  Eerst op `apc.html` bekijken of het in de hand ligt.
  **Let op (3 okt):** met de AV-app-hub (`?hub=`) is Bank de hubtoets en komt
  hij nooit bij VARVE aan. Zie N2.

---

## J. Keuzes uit de sporen van 25 september

Elk spoor bouwde met een keuze die Clay kan omdraaien. Wat er nu staat is het
advies van de bouwer of controleur, tenzij anders vermeld. Alleen wat echt een
keuze is; de rest staat in `docs/HANDOFF.md` (wat niet getest is).

**Clay 26 sep: alle adviezen overgenomen** (afgevinkt). Daarvoor gebouwd: J4
(beatjump vóór het begin geweigerd), J12 (op een track gesleept = vooraan in de
rij), J18 (vinkje "log altijd aan" achter ↺), J24 (rack-knoppen 5–8 endless in
zijn verschil), J26 (½ houdt de "1"). Nog open, op gevoel of met de APC: J7, J16,
J19, J20, J27, J28, J30.

Transport (beatjump, loop in/out, quantize, op de maat):
- [x] **J1. Starten op de maat: volgende MAAT of volgende tel?** 🎧 Nu: maat. **Advies:** maat (blauwdruk, plan en Ableton doen het zo); een tel-knop erbij is één regel.
- [x] **J2. Quantize voor alle tracks of per track?** 💬 Nu: één schakelaar voor alle tracks. **Advies:** zo laten (één knop, zoals rekordbox, Traktor en Serato).
- [x] **J3. Hotcue met quantize: meteen of op de volgende tel?** 🎧 Nu: meteen, fasebehoudend. **Advies:** meteen (klinkt hetzelfde, reageert tot een tel sneller).
- [x] **J4. Beatjump terug voorbij het begin: klemmen of weigeren?** 💬 Nu: klemmen op 0 (voorbij het einde wordt al geweigerd). **Advies:** weigeren, net als het einde: klemmen breekt de beatmatch van een track die je net inmixt. Eén regel.

Klank (rem, kill, maatgever):
- [x] **J5. Remtijd in seconden of in tellen?** 🎧 Nu: seconden, 0,1–5 s, standaard 1 s. **Advies:** seconden (een gebaar van de draaitafel, werkt ook zonder grid).
- [x] **J6. Tweede druk op rem tijdens het remmen: los of meteen stil?** 🎧 Nu: los, meteen weer op tempo (tape stop die op de drop invalt); pauze = meteen stil. **Advies:** zo laten.
- [ ] **J7. Klinkt het uitdoven als een vinylstop, en wil je een spin-up na loslaten?** 🎧 Nu: uitdoven in het laatste kwart van de snelheid, loslaten = meteen op tempo. **Advies:** eerst luisteren; eerder/later uitdoven is één getal, een spin-up ~een uur werk.
- [x] **J8. Maatgever-hysterese: 3 dB en 250 ms goed?** 🎛 Nu: een andere track neemt de maat pas over na 3 dB harder gedurende 250 ms. **Advies:** zo laten tot het in een set opvalt.

Toonsoort:
- [x] **J9. Toonsoort in de kolomkop onder de bpm (`9B G`), of alleen Camelot?** 👀 Nu: onder de bpm (naast het nummer drukte de MAAT-badge hem weg). **Advies:** zo laten (T2).
- [x] **J10. Sneltoetsen om de toonsoort te corrigeren?** 💬 Nu: alleen het menu in de focuskop en de kiezer in de library. **Advies:** geen toetsen: een per ongeluk verzette kwint wordt als "met de hand" bewaard.
- [x] **J11. Library "+N": aantal andere toonsoorten of aantal stukken?** 💬 Nu: andere toonsoorten (ADRIANA: 18 stukken in 6 toonsoorten = +5). **Advies:** zo laten.

Library en ingest:
- [x] **J12. Voorrang in de ingest-rij voor een bestand dat je op een TRACK sleept?** 💬 Nu: achteraan, dus een video voor track 3 wacht achter een lange download. Geen advies van de bouwer; **voorstel:** alleen wat je op een track sleept vooraan (dat wil je nu spelen).
- [x] **J13. Een hele playlist in de wachtrij zetten?** 💬 Nu: geweigerd, zoals gevraagd. **Advies:** blijven weigeren tot je erom vraagt (met `--flat-playlist` is het daarna een klein stapje).
- [x] **J14. Tweede klik voor "opnieuw binnenhalen" en voor × op een lopende download: goed, of te voorzichtig?** 💬 **Advies:** zo laten (dezelfde regel als elke destructieve knop); een ↻-knop bij "al binnen" kan ook.

Beamer:
- [x] **J15. Dubbele menging in het randgeval "opname begon zonder los venster, daarna open"?** 💬 Nu: dan mengen beide tijdelijk. **Advies:** laten (het alternatief bevriest de beamer weer met het hoofdtabblad naar achteren).
- [ ] **J16. De vertraging tussen canvas en beamer meten?** 🎛 Telefooncamera op 240 fps, beamer en luidspreker in beeld, een klik met een witte flits. **Advies:** eerst meten, pas daarna het beeld een vaste voorsprong geven (nu aangenomen: 16–33 ms).
- [x] **J17. Melding als een nummer zonder video op de beamer staat?** 💬 Nu: alleen een ontbrekend of kapot bestand is een fout. **Advies:** geen melding.
- [ ] **J27. Inloop: hoe snel neemt het losse venster over?** 👀 Nu: als alle zichtbare video's 0,3 s binnen 50 ms van het geluid lopen, uiterlijk na 20 s; tot dan toont het het beeld van het hoofdvenster ("beamer loopt in"). Gemeten onder belasting: acht tracks 8–9,4 s. **Advies:** zo laten; kijk op je M1 hoe lang "beamer loopt in" blijft staan.
- [ ] **J28. Tijdens de inloop mengen beide vensters (bij acht tracks zestien video's).** 🎛 Hapert het hoofdvenster in die seconden? **Advies:** eerst kijken; zo ja, dan is de bovengrens van 20 s korter zetten één getal.

Handelingenlog:
- [x] **J18. Log altijd aan, vanaf het openen?** 💬 Nu: met ○ log en vanzelf met elke opname. Altijd aan kost ~1–8 MB per uur in `opnames/`, en dan is ook een onverwachte fout na te spelen. **Advies:** ja, als keuze die onthouden wordt.
- [ ] **J19. Opnieuw renderen in één knop, een "alleen kijken"-stand (MIDI uit tijdens terugspelen), logs weghalen uit de lijst?** 💬 Geen van drie gebouwd; geen advies van de bouwer. Eerst gebruiken en dan kiezen.

Vormen 16:9:
- [ ] **J20. tv (Trommelvlies): de "lucht" naast het ronde vel.** 👀 Een golf die van het vel naar buiten loopt. Bevalt hij, rustiger (`LUCHT_FEL` lager), of alleen het vel op zwart? Geen advies (een beeldvondst).
- [x] **J21. dw (Korrelwolk): smaller stereobeeld?** 🎧 Beeld = geluid: een samengetrokken wolk bestrijkt nu ×0,56 van de korrelbuffer en het stereobeeld. Of het geluid over de oude breedte, minder letterlijk isomorf? **Advies:** zo laten; het geluid is in Varve nog nergens aangesloten (H6).
- [x] **J22. ls, if (en cl): heel in het midden, of breder?** 👀 Nu: heel in het midden (valt onder "Midden"). Anders: een rij planten/varens, groter en bijgesneden zoals op 24 sep, of cl tot 18% groter over de hele breedte. **Advies:** zo houden.
- [x] **J23. Roosters (gs, ln, cc, ec, …): vlekken ~25% kleiner dan op 24 sep.** 👀 Nu: evenveel cellen, dus zelfde rekentijd. Even groot als 24 sep is goedkoper maar grover. **Advies:** zo laten.

Mapping en beatgrid:
- [x] **J24. Rack-knoppen 5–8 (video-effecten) op "endless" zetten?** 🎛 Koppelen raadt een CC altijd als absoluut (soft-takeover); de andere ringknoppen staan op endless (meteen doordraaien vanaf de ring). **Advies:** ja, in je verschil.
- [x] **J25. Bij een nieuwe standaardmapping zien WELKE regels erbij kwamen?** 💬 Nu alleen de melding "de standaardmapping is bijgewerkt". **Advies:** nog niet (dan moet het verschil per regel onthouden wat de standaard had).
- [x] **J26. ½ op tel 2 of 4 schuift de "1" een tel op.** 🎛 Moet ½ de "1" houden? **Advies:** ja (`docs/BEATGRID.md`, open punt; eerst jouw ja).

APC-indeling (voorstel A):
- [x] **J29. Modus klank op Shift + scene 5?** 🎛 Scene 5 blijft één druk "loop weg"; in klank brandt hij magenta, dus daar zie je niet of er een loop loopt (Clip Stop per kolom wel). **Advies:** zo laten; ▲ ▼ werkt ook.
- [ ] **J30. Zijn de nieuwe kleuren op het apparaat uit elkaar te houden?** 🎛 Magenta 53/54 (klank), donkerrood 6 (kill: open), donkeroranje 10 (rem: speelt), donkergroen 22 (op de maat: speelt) tegen donkergrijs (stil); Pan/Sends/User knipperen op de tel. **Advies:** eerst kijken; een kleur wisselen is één regel in `feedback.js`.
- [x] **J31. Rij 5 (op de maat) als de track al speelt: donkergroen of uit?** 👀 De APC-indeling koos "uit" (rij 5 toont alleen wat je nog kunt inzetten). Sinds shift+Q op een spelende track pauzeert, volgt het lampje de read: fel = wacht, donkergroen = speelt (drukken = pauze), donkergrijs = stil. **Advies:** zo laten: drukken doet iets, dus het lampje brandt.
- [x] **J32. Stop All Clips = rem van de focus-track?** 💬 Die knop heeft geen lampje op de APC. **Advies:** zo laten.
- [x] **J33. Met `?vormen=1` in het mapje vorm: shift + Bank ◀ ▶ = beatjump-lengte, niet de vormlaag.** 💬 Een shift-regel gaat overal voor het open mapje; Bank ◀ ▶ zonder shift kiest daar de laag. **Advies:** zo laten.

## K. Klankschaal (29 sep, docs/KLANKSCHAAL.md)

- [ ] **KS1. Waar komt de klankschaal op de APC?** 🎛 Nu nergens (koppelen werkt wel). **Advies:** een eigen mapje "klankschaal" als fragment (zoals "vorm"): acht velden op grid-rij 1, kern en wrijf/demp op rij 2, FIJN en KRACHT op de device knobs. Eerst luisteren.
- [ ] **KS2. Een ringende schaal die van toonsoort wisselt: meteen mee, of pas bij de volgende aanslag?** 👂 Nu meteen mee (glijdt direct). **Advies:** eerst horen met een mix die van toonsoort wisselt.
- [ ] **KS3. Is VOL 0,8 de goede standaard naast je tracks?** 👂 Gemeten: velden pieken ~−12..−17 dBFS, tracks staan op −14 LUFS.
- [ ] **KS4. Aanslagen op de tel als quantize aan staat?** 💬 Niet gebouwd (niet gevraagd). **Advies:** alleen als je het mist bij het spelen.
- [ ] **KS5. Je eigen schaal meten (zoals in de Waterschaal) als vijfde soort?** 💬 Niet gebouwd.

## L. Auto-DJ (30 sep, docs/AUTO-DJ.md)

- [x] **AU1. Welke APC-knoppen voor ok/overslaan/langer/nu?** 🎛 Nu nergens (koppelen werkt). **Advies:** een eigen mapje "auto" als fragment (zoals "vorm"), één rij met de vier in kleur. **Gebouwd 2 okt, als zesde grid-modus "auto" (limoen) in de standaardmapping, niet als fragment:** de auto-DJ hangt niet aan een vlag, en zo staat hij vanzelf op apc.html, op het scherm en in je eigen mapping (verschil). Openen met Shift + scene 4 of ▲ ▼ (na klank). Bovenste rij: pad 1 ok (groen), 2 overslaan (oranje), 3 langer (cyaan), 4 nu (geel), pad 8 aan/uit (limoen). Donker = er staat een voorstel klaar, fel = bevestigd / aan, uit = niets te doen. In de grid-modus blijft Shift + scene 4 "halve tel". Zie docs/APC40.md, "Modus auto". Nog op het apparaat nalopen.
- [ ] **AU2. Is 24 s overvloeien goed bij jouw muziek, of langer (32–48 s)?** 👂
- [ ] **AU3. "Nu" bij beatloos: meteen, of een paar seconden later zodat je het ziet aankomen?** 👂 Nu: na ~0,5 s.
- [ ] **AU4. Mag de automaat een lege track gebruiken?** 💬 Nu: eerst zijn eigen twee tracks, dan een lege, nooit wat speelt. **Advies:** zo laten.

## M. Planvenster (30 sep, docs/PLAN.md)

- [ ] **PL1. Mag jij een bewaker bewust breken?** 💬 Bijvoorbeeld een blend afdwingen over een onzeker grid, met een "ik weet het"-vinkje per stap. Nu winnen de bewakers altijd. **Advies:** toestaan, maar alleen vanuit het venster (door jou), nooit door Claude.
- [ ] **PL2. Per stap: automatisch, of wachten op jouw GO?** 🎛 Voor fase 2 (live-stand). **Advies:** standaard automatisch, per stap om te zetten.
- [ ] **PL3. Past het venster op je tweede scherm, en mist er iets in de lijst?** 👀

## N. Stems (3 okt, docs/STEMS.md)

- [ ] **N1. Waar op de APC?** 🎛 Nu nergens (koppelen werkt: `track.N.stem.vocals.kill` enz.). **Advies:** een grid-modus STEMS naast KLANK (eigen kleur, bereikbaar met ▲ ▼ zoals de andere grid-modi): per kolom rij 1 zang weg zolang je drukt, rij 2 rest weg (shift + pad = schakelaar, zoals de kill in KLANK), rij 3–5 bij vier stems drums/bas/overig. Eerst zelf een avond met koppelen proberen.
- [ ] **N2. De rest van het model naar "rest"?** 👂 Nu: rest = mix − zang (bij vier: overig krijgt wat het model nergens onderbracht), zodat alles open precies klinkt als het nummer. Prijs: wat Demucs miste (ook een beetje zang) blijft hoorbaar als de zang weg is. Alternatief: rest = alleen drums + bas + overig; dan is zang weg schoner, maar alles open klinkt tot −25 dB (ambient) anders dan het origineel. **Advies:** zo laten; luister naar zang weg bij No Surprises en Bay Ledges.
- [ ] **N3. Splitsen tijdens een set?** 💬 Demucs deelt de GPU met de video (WebGL); `nice` helpt alleen de CPU. Nu splitst hij gewoon door (na elke ingest standaard 2). **Advies:** zo laten tot het hapert; dan een knop "stems pauzeren" in de Controlekamer, of splitsen op de Omarchy-machine (H3).
- [ ] **N4. Standaard 2 bij elke ingest, ook als je even snel iets binnenhaalt?** 💬 Een nummer van 5 minuten kost ~2 minuten rekenen en ~110 MB. De keuze `2 · 4 · geen` staat naast de invoer en wordt onthouden. **Advies:** zo laten (H2).

---

## S. Studio (5 okt, docs/STUDIO.md)

- [x] **S1. Koptelefoonvolume en mix op de APC?** — 5 okt: Cue Level = volume, shift + Cue Level = mix; sampler-volume en puls naar shift + Cue Level in hun grid-modus. 🎛 De cue zelf zit op ● (zonder shift). VOL en MIX staan nu alleen in de KOPTELEFOON-rij; koppelen werkt. Cue Level is het voor de hand liggende label, maar dat is nu het sampler-volume (shift: puls). **Advies:** eerst een avond met de rij spelen; mis je hem, dan Cue Level = koptelefoonvolume en shift + Cue Level = mix, en krijgen sampler-volume en puls een andere plek.
- [x] **S2. Een instrument of patroon: een van de acht tracks, of eigen kolommen?** — 5 okt: op een van de acht tracks. 💬 Beslissen vóór S3. Acht tracks = acht kolommen op de APC; een instrument erbij kost een kolom of een mapje. **Advies:** een track kan een nummer OF een instrument dragen (dezelfde strip, fader, sends en cue), zodat de APC-indeling niet verandert.
- [ ] **S3. Zonder enige cue hoort de koptelefoon de zaal.** 🎧 Gekozen zodat je altijd iets hoort. Alternatief: stil tot je een cue aanzet. **Advies:** zo laten.
- [ ] **S4. Drums: −14 LUFS of iets zachter?** 🎧 Een maat vier-op-de-vloer op −14 LUFS piekt op +3,5 dBFS (kick en snare samen); de limiter knijpt dan op 2 en 4. **Advies:** eerst luisteren; pompt het, dan `UIT_OPHOGING` in drums.js omlaag (−16 LUFS).
- [ ] **S5. Stems op de APC: filter, echo en cue per stem?** 🎛 Nu alleen op het scherm (en weg/terug in de grid-modus STEMS). **Advies:** een derde mapje onder Clip/Device View (strip → rack → stems): device knobs 1–4 = filter, 5–8 = echo, shift = galm.
- [ ] **S6. Een stem-echo door het trackfilter?** 🎧 De echo en galm van een stem gaan nu NIET door EQ, effect en filter van de track (wel door de fader). **Advies:** zo laten; zeg het als je het filter-dichtdraaien ook op de echo wilt horen.
- [ ] **S7. Schaal: de cent van de plaat volgen?** 🎧 De Schaal staat op A440 + FIJN; de globale klankschaal volgt de stemming van wat je hoort (bv. −12 ct). **Advies:** ja, net als de globale schaal, als je hem over nummers speelt.
- [ ] **S8. FM: zachter inzetten?** 🎧 Standaard aanslag 8 ms en release 1,2 s (MediSynth's Glass: 280 ms en 4,5 s). **Advies:** luisteren; het zijn knoppen 3 en 5.
- [ ] **S9. Effecten: oversampling voor de distortion?** 🎧 Zonder: aliasing (−14,8 dB bij hard, drive vol). Met: 128–192 samples vertraging en dus een kamfilter met de mix-knop. **Advies:** zonder laten.
- [ ] **S10. Compressor en pitch als insert schuiven de track op** (6 ms, pitch op meng 1 ~45 ms). 🎧 **Advies:** acceptabel voor een effect; niet voor de beatmatch-track zelf.
- [ ] **S11. Tremolo en autopan standaard op de maat?** 🎧 **Advies:** ja. Op de "1" van de maat beginnen vraagt dat `fxKlok` ook de maatfase meegeeft (later).
- [ ] **S12. Geheugen (90 s buffer uit de filter app)** niet als insert gebouwd (begint leeg bij elke wissel, 17 MB). 💬 **Advies:** later als instrument of op de master, als je het mist.
- [ ] **S13. Master: knop 8 = mix in het mapje master, release 80 ms.** 🎛🎧 Proberen op de APC; vervormt de limiter als je hem hard raakt, zeg het. De master klinkt ~0,8 dB zachter dan met de oude compressor (die tilde op).
- [ ] **S15. Patronen: de instrumenten vanzelf terug bij het laden van de set?** 💬 Nu staat er alleen een hint als een patroon op een track zonder instrument staat. **Advies:** ja: de set onthoudt welk instrument op welke track stond.
- [ ] **S16. Patronen na een sprong (hotcue, beatjump) die geen hele maat is.** 🎧 Lopende patronen blijven in hun eigen fase en de klok glijdt in één à twee tellen terug (geen dubbele of gemiste noot). Alternatief: een korte stilte en dan op de nieuwe tel. **Advies:** glijden laten.
- [ ] **S17. Patronen op de APC: Shift + scene 2, en Stop All Clips = alles stoppen in die modus.** 🎛 (Shift + scene 3 werd stems, daarom 2.) **Advies:** zo proberen.
- [ ] **S14. Xboard49: knop 9–16 = de FX-knoppen van de speeltrack, de schuif = zijn fader.** 🎛 Voorstel; de CC-nummers van de knoppen komen uit de proef (`AV-app-hub`: proef speelapparaten).

---

## O. AV-app-hub (3 okt, `?hub=`, CLAUDE.md AV-APP-HUB)

- [ ] **O1. LPD8 K1 (intensiteit) in VARVE?** 🎛 K1 hing eerst aan het
  audio-eindvolume (master). Weggehaald: de pickup van K1 volgt de EERSTE app met
  die rol, en andere apps gebruiken intensiteit als beeld (av-scene-kit 0,35);
  wie K1 dichtdraait om het beeld rustig te maken, zette ook de mix stil (gemeten
  0,80 → 0,43). Nu doet K1 niets in VARVE. Wil je hem wel: aan een BEELD-param
  (bv. de video-fx-intensiteit of de puls), of zo laten? **Advies:** zo laten;
  K2 (helderheid = video-master) en K4 (beweging = puls) doen al het beeld.
- [ ] **O2. Bank: keylock of hubtoets?** 🎛 Je koos 25 sep (I4) Bank voor keylock,
  met Shift + Bank = pitchbereik. De hub gebruikt Bank als hubtoets
  (`config.json` → `hubtoets`): met `?hub=` komt Bank nooit bij VARVE aan.
  Kiezen: keylock krijgt een andere toets (bv. Detail View, nu vrij zonder
  `?vormen=1`), óf de hubtoets van de hub wordt een andere (dat raakt alle
  apps, PROTOCOL §5/§7). **Advies:** keylock naar een andere toets; de hubtoets
  is voor elke app hetzelfde.
