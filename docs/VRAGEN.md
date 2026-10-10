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

- [x] **A3. Luistertest: keylock (Signalsmith-demo).** 🎧 — 5 okt, Clay: "klinkt goed".
  Keylock is gebouwd (`docs/KEYLOCK.md` §9).
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
- [x] **I1 (= K1). Wordt het Signalsmith?** 🎧 — JA (A3 klinkt goed), gebouwd 5 okt. Na A3. Scoort ±5% op sakamoto en zoned-out
  een 0 of 1 op de scorekaart, dan ja.
- [x] **I2 (= K2). Welke instelling?** 🎧 — volgens advies: standaard, gespreid (5 okt). Standaard, goedkoper of kort. Luister naar
  13 en 14 tegen 08. **Advies:** standaard, gespreid; goedkoper als je 13 niet van 08
  onderscheidt.
- [x] **I3 (= K4). Keylock standaard aan of uit?** 🎧 — volgens advies: uit, en hij blijft staan bij een nieuw nummer (5 okt). Luister naar 01 tegen 04.
  **Advies:** uit, en keylock blijft staan bij een nieuw nummer.
- [ ] **I4 (= K6). Waar op de APC?** 🎛 GEBOUWD 5 okt, niet op het apparaat nagelopen:
  **Shift + Tap = keylock, Shift + Nudge −/+ = toon −1/+1** (focus-track); toon terug
  naar 0 op het scherm (en vanzelf bij een nieuw nummer). Niet Bank: met de hub is
  dat de hubtoets. **Advies:** zo proberen. Was: Clay 25 sep (voorstel A): keylock krijgt
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

- [ ] **N1. Waar op de APC?** 🎛 — GEBOUWD (5 okt, het advies hieronder): grid-modus STEMS, Shift + scene 3 of ▲ ▼ (achteraan), zeegroen; per kolom rij 1 zang · 2 rest · 3 drums · 4 bas · 5 overig weg zolang je drukt, shift + pad = vastzetten (`docs/APC40.md` "Modus stems", `docs/STEMS.md` §5). **Open: alleen nog proberen op de echte APC** (niet op het apparaat nagelopen). Oorspronkelijke vraag: nu nergens (koppelen werkte: `track.N.stem.vocals.kill` enz.); advies was een grid-modus STEMS naast KLANK (eigen kleur, bereikbaar met ▲ ▼ zoals de andere grid-modi).
- [ ] **N2. De rest van het model naar "rest"?** 👂 — OPEN, wacht op luisteren. Nu: rest = mix − zang (bij vier: overig krijgt wat het model nergens onderbracht), zodat alles open precies klinkt als het nummer. Prijs: wat Demucs miste (ook een beetje zang) blijft hoorbaar als de zang weg is. Alternatief: rest = alleen drums + bas + overig; dan is zang weg schoner, maar alles open klinkt tot −25 dB (ambient) anders dan het origineel. **Advies:** zo laten; luister naar zang weg bij No Surprises en Bay Ledges.
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
- [x] **S7. Schaal: de cent van de plaat volgen?** 🎧 — GEBOUWD 5 okt (advies gevolgd): de Schaal staat nu op A440 + de cent van wat je hoort (met de pitch erbij, ±50) + FIJN, zoals de globale schaal. Nog te beluisteren: speel hem over een plaat die niet op A440 staat. Poly en FM staan nog op A440 + hun eigen stemknop; zeg het als die ook mee moeten.
- [ ] **S8. FM: zachter inzetten?** 🎧 Standaard aanslag 8 ms en release 1,2 s (MediSynth's Glass: 280 ms en 4,5 s). **Advies:** luisteren; het zijn knoppen 3 en 5.
- [ ] **S9. Effecten: oversampling voor de distortion?** 🎧 Zonder: aliasing (−14,8 dB bij hard, drive vol). Met: 128–192 samples vertraging en dus een kamfilter met de mix-knop. **Advies:** zonder laten.
- [ ] **S10. Compressor en pitch als insert schuiven de track op** (6 ms, pitch op meng 1 ~45 ms). 🎧 **Advies:** acceptabel voor een effect; niet voor de beatmatch-track zelf.
- [ ] **S11. Tremolo en autopan standaard op de maat?** 🎧 **Advies:** ja. Op de "1" van de maat beginnen vraagt dat `fxKlok` ook de maatfase meegeeft (later).
- [ ] **S12. Geheugen (90 s buffer uit de filter app)** niet als insert gebouwd (begint leeg bij elke wissel, 17 MB). 💬 **Advies:** later als instrument of op de master, als je het mist.
- [ ] **S13. Master: knop 8 = mix in het mapje master, release 80 ms.** 🎛🎧 Proberen op de APC; vervormt de limiter als je hem hard raakt, zeg het. De master klinkt ~0,8 dB zachter dan met de oude compressor (die tilde op).
- [x] **S15. Patronen: de instrumenten vanzelf terug bij het laden van de set?** — GEBOUWD 5 okt (advies gevolgd): de set onthoudt per track met patronen het instrument en zijn knoppen; na het laden (ook herladen) komt het terug op een lege track. Een track met een nummer houdt dat. Wrijven op de Schaal wordt niet onthouden (er klinkt niets vanzelf). PATRONEN.md §7.6.
- [ ] **S16. Patronen na een sprong (hotcue, beatjump) die geen hele maat is.** 🎧 Lopende patronen blijven in hun eigen fase en de klok glijdt in één à twee tellen terug (geen dubbele of gemiste noot). Alternatief: een korte stilte en dan op de nieuwe tel. **Advies:** glijden laten.
- [ ] **S17. Patronen op de APC: Shift + scene 2, en Stop All Clips = alles stoppen in die modus.** 🎛 (Shift + scene 3 werd stems, daarom 2.) **Advies:** zo proberen.
- [ ] **S18. Maschine: zijn de gedimde padkleuren zichtbaar?** 👀 Poly gedimd is #190064 (heel donker violet). **Advies:** kijken op het apparaat; te zwak, dan een lichtere basiskleur per instrument.
- [ ] **S19. Maschine-wiel: eerst kiezen, indrukken = zetten.** 🎛 Zo vervangt een tik tegen het wiel nooit per ongeluk je instrument. De eerste wielstap na het insteken telt niet (de hub kent dan nog geen beginstand). **Advies:** zo laten.
- [ ] **S21. Grid uit de tellen (Beat This!) en controleren: zo goed?** 🎧 (6 okt, docs/BEATGRID.md §11) Elk nummer krijgt zijn grid nu uit de tellen die Beat This! hoort; naast de bpm staat of het klopt (✓ / ? met de reden / 🔒 / ⚠ als het live wegloopt), de gevonden tellen staan groen in de zoom, en een klik op het oordeel start de controle: een tik op elke gridlijn in de koptelefoon, ✓ per stuk, alles goed = op slot. Je met de hand gezette grids (jungle-mix, album) zijn NIET overschreven, alleen gemeten — ↻ in de library zet ze om (op slot: tweede klik). **Advies:** eerst de controle op Loving arms en Ciel (band zonder klik), dan ↻ op de jungle-mix en luisteren of het beter is dan je eigen grid.
- [ ] **S23. Toon per stem: ook op de APC?** 🎛 (6 okt, docs/STEMS.md §7) Nu alleen in de STEMS-rij (draaiknop per stem, klik op het getal = 0). Voorstel: in grid-modus STEMS (Shift + scene 3) shift + de onderste twee pads van een kolom = toon − / + van die stem. **Advies:** eerst met de muis proberen; zeg het als je hem live wilt.
- [ ] **S24. Toon per stem: klinkt het goed genoeg?** 🎧 Zang een paar halve tonen omhoog/omlaag, en de rest (bas!) een kwint. **Advies:** luisteren bij Loving arms (vier stems); drums verschuiven klinkt altijd "anders".
- [ ] **S22. Tik in de zaal als er geen koptelefoon is?** 💬 Zonder samengesteld apparaat (Scarlett + Mac-uitgang) hoort de controletik door de zaal. **Advies:** zo laten (controleren doe je bij het voorbereiden); zeg het als hij dan beter stil kan blijven.
- [ ] **S20. Beatgrid: vastzetten (pin) en terug zo proberen?** 🎛 (5 okt, docs/BEATGRID.md §10) Een correctie bevestigt nu het stuk (sync en loops mogen meteen), ↶/Cmd+Z zet terug, en "vast" haalt drift weg: "1" op een kick aan het begin, een paar minuten later "vast" op een kick. In grid-modus: klik in de golfvorm = tel 1, shift + klik = vast; scrollen = zoomen. Op de APC: grid-modus Shift + scene 1 = vast (terug niet op de APC: Shift + scene 5 blijft klank, Lock het slot). **Advies:** zo proberen op een lang nummer met drift; zeg het als vier tikken nog steeds niet het hele grid op slot moeten zetten.
- [ ] **S14. Xboard49: knop 9–16 = de FX-knoppen van de speeltrack, de schuif = zijn fader.** 🎛 Voorstel; de CC-nummers van de knoppen komen uit de proef (`AV-app-hub`: proef speelapparaten).

---

## SE. Secties (6 okt, docs/SECTIES.md, tak `studio/secties`)

- [ ] **SE1. Een sectie valt in op de volgende "1" met een aanloop uit het nummer zelf.** 🎧 Druk je midden in een maat, dan springt hij naar vlak vóór de sectie, precies zo ver als jij van de volgende "1" af zit: de rest van de maat hoor je het einde van de maat vóór die sectie (vaak een fill), en op de maatstreep valt hij in. Geen wachten en de groove struikelt nooit. Alternatief: blijven spelen tot de maat om is en dan springen (zoals Ableton). Dat vraagt een geplande sprong in de streamkern; die bestaat nu alleen voor keylock. **Advies:** zo proberen; mis je "eerst de maat afmaken", zeg het.
- [ ] **SE2. Kloppen de grenzen en de namen op je eigen muziek?** 👂 Gemeten op synthetische nummers (EDM, pop met opmaat, ambient): elke grens op zijn maat, groepen en labels goed. Op echte muziek nog niet: de drempels zijn een eerste keuze. Labels: intro · opbouw · drop · break · outro, de rest alleen een letter. **Advies:** speel vijf verschillende nummers en noteer per nummer wat niet klopt (een gemiste grens, een grens te veel, een verkeerde naam). Dan stel ik bij en verhoog ik `SECTIE_VERSIE` (alles wordt vanzelf opnieuw berekend).
- [ ] **SE3. De 40 pads = de secties van de FOCUS-track.** 🎛 Zo past een heel nummer (tot 40 secties) op het grid en blijft de volgorde vast. Alternatief: per kolom een track met 5 secties (zoals stems en patronen), maar dan moet je bladeren. **Advies:** zo laten; wisselen met Track Select.
- [ ] **SE4. Kleur op de pads: wit = die hoor je (knippert op de tel), donker hemelsblauw = er is een sectie.** 👀 Op het scherm heeft elke groep (A, B, C …) een eigen kleur. Op de APC kan dat ook, maar de lampjes kennen nu alleen een vaste kleur per soort knop. **Advies:** eerst zo; mis je de groepen, dan bouw ik groepskleuren op de pads.
- [ ] **SE5. Secties met de hand verschuiven, splitsen of hernoemen?** 💬 Niet gebouwd. De kaart kent al `bron: 'hand'` en `slot` (dan rekent de server er nooit overheen). **Advies:** eerst een paar avonden zonder; als je steeds dezelfde grens mist, dan een bewerkmodus zoals bij het grid.
- [ ] **SE6. Labels uit een getraind model (all-in-one-infer, MIT, draait op Apple Silicon)?** 💬 Python in de venv van de stems, zoals Demucs. Beter op popstructuren (couplet/refrein), niet getest op jouw ambient en jungle. **Advies:** alleen als SE2 tegenvalt.


## SV. Secties verweven (6 okt, avond; docs/SECTIES.md §7)

De secties zitten nu ook in het toetsenbord, de sampler, het planvenster, het handelingenlog, de auto-DJ, de vormen en de video-puls, de Controlekamer, de Maschine en de globale laag van de hub.
Per onderdeel een blok in de speellijst; daar staan de codes hieronder bij.

**Toetsenbord** (speellijst "Secties op het toetsenbord")
- [ ] **SVT1. Shift+W/E (links) en shift+I/O (rechts) voor vorige/volgende sectie.** 🎧 Links naar rechts = terug naar vooruit (zoals R/T, Y/U, , / .). Zonder modifier is geen letter of cijfer vrij; Cmd/Ctrl/Alt blijven van het systeem. **Advies:** zo proberen.
- [ ] **SVT2. Shift+I wisselde eerst de focus (net als I), shift+W/O waren cue.** 💬 Nu springen ze naar een sectie; hou je shift nog vast na shift+Q/P (starten op de maat) en tik je dan W of O voor cue, dan spring je in plaats daarvan. **Advies:** zo laten; zonder shift doen ze wat ze deden.
- [ ] **SVT3. Vorige/volgende op de eerste of laatste sectie geeft een melding** ("track 1: al bij de laatste sectie (8 van 8)"), de speelkop blijft staan. 💬 Liever rondgaan (na de laatste weer de eerste)? **Advies:** de melding laten; rondgaan springt ongemerkt terug naar de intro.

**Sampler** (speellijst "Een sectie in de sampler")
- [ ] **SVS1. Een sectie in een pad loopt van haar "1" tot de "1" van de volgende, in hele maten.** 🎧 De opmaat vóór de eerste "1" komt in geen pad; de laatste sectie stopt op de laatste hele maat. Verspringt de "1" van het grid binnen de sectie (een maat van bv. 6 tellen), dan stopt de pad op de "1" ervóór en zegt een melding hoeveel tellen wegvallen. **Advies:** zo; mis je een staartje (een fill), zeg het.
- [ ] **SVS2. Een sectie-pad start op de volgende "1" van de maatgever, niet op de tel.** 🎧 Hij wacht dus tot bijna een maat. Gewone pads (1–8 tellen) starten zoals altijd op de volgende tel. Een pad is een sectie als hij meer dan 8 tellen heeft (ook een bewaarde pad weet het zo, zonder nieuw veld); een sectie van 2 maten of korter start daardoor op de tel (de APC-kaart zegt dat). **Advies:** zo; wil je soms meteen, dan een shift-variant.
- [ ] **SVS3. Een sectie-pad houdt bij herankeren ook de maat vast.** 🎧 Springt de maatgever een tel (beatjump 1), dan schuift de pad tot twee tellen mee zodat de "1"-en gelijk blijven; in een loop die geen hele maten is alleen de tel. Ook met keylock en een sprong terug blijft een wachtende pad op zijn "1". **Advies:** proberen met beatjump 1 en 4, ook met keylock aan.
- [ ] **SVS4. Grens 32 maten en 90 s per pad.** 💬 Een pad houdt de audio vast: ~23 MB per minuut, acht volle pads ~280 MB. 32 maten is de langste sectie van de analyse; tot 86 bpm past die in 90 s. Langer (een mix, ambient op 70 bpm): een melding en het lampje uit (als loop op de track kan het wel). **Advies:** zo; loop je er vaak tegenaan, naar 120 s.
- [ ] **SVS5. Bediening: rij 3 van de modus sampler, zonder shift.** 🎛 Shift + een lege pad betekent al "vergeten" (scherm). Rij 3 was leeg, onder "leegmaken". Lampje: donker hemelsblauw = kan, uit = kan niet (een druk zegt waarom). Op het scherm-als-APC, niet in de SAMPLER-rij. **Advies:** zo laten; wil je hem ook in de SAMPLER-rij, zeg het.
- [ ] **SVS6. Een sectie op een onzeker grid wordt geweigerd.** 🎧 Een pad die naast de tel loopt hoor je meteen; waar de analyse het grid onzeker vindt, komt een melding en blijft het lampje uit (zoals bij beat-loops). Op het synthetische nummer in Chrome 2 van de 7 secties. **Advies:** klinkt het grid goed, zet het op slot (Lock in grid-modus); daarna kan het.

**Handelingenlog** (speellijst "Secties terugspelen")
- [ ] **SVL1. Speelt een set met sectiesprongen precies zo terug?** 🎧 Het log bewaart de sectiekaart, en bij elke sectiedruk de plek waarvan de sprong rekende; dat geldt ook voor "volgende" aan het eind van het nummer. Terugspelen haalt de kaart niet van de server, dus na een herberekening (ander grid) landt `section.5` waar hij toen landde. Gemeten in Chrome: 0–8 ms naast, nooit een maat. **Advies:** speellijst "Secties terugspelen". Hoor je een sprong een maat te laat, op een andere plek, of een melding "al bij de laatste sectie" die er toen niet was, zeg welke.
- [ ] **SVL2. Logs van vóór deze tak met sectiedrukken spelen terug met de kaart van nu.** 💬 Een log zonder sectiekaart speelt terug zoals voorheen, met de kaart die de server nu geeft; is die opnieuw gerekend, dan springt `section.5` ergens anders. **Advies:** zo laten (hooguit de logs van vandaag).
- [ ] **SVL3. Ook hotcues met quantize, beatloops en starten op de maat zo exact terugspelen?** 💬 Een regel komt tot een tik (10 ms) te laat; voor secties is dat opgevangen, bij die andere sprongen kan een tik op de rand van hun marge nog een tel schelen (starten op de maat misschien een maat). Niet gemeten. **Advies:** pas bouwen als je het hoort.

**Planvenster** (speellijst "Planvenster met secties")
- [ ] **SVP1. Secties berekenen vanuit het planvenster?** 💬 Het venster vraagt alleen kaarten die er al zijn (zonder `maak=1`; anders gaan dertig nummers tegelijk rekenen); een nummer dat nooit geladen is krijgt geen in/uit-keuze. **Advies:** eerst zo; kom je vaak een nummer zonder kaart tegen, dan een knop "secties" per rij (één tegelijk).
- [ ] **SVP2. In kiezen met een keuzelijst of in de strook?** 👀 Nu een lijst onder "begin" ("3 drop C"). **Advies:** zo; klikken op een band als de lijst te klein of te traag voelt.
- [ ] **SVP3. Uit en duur samen: welke wint?** 🎧 Nu is de duur de grens: een uit telt alleen als de overgang vóór het einde van de duur past; anders kiest de auto-DJ zelf (outro, break, frasegrens). Het venster maakt zo'n uit niet oranje; je ziet het alleen doordat de overgang in de strook ergens anders begint. **Advies:** uit wint en de duur wordt alleen de terugval zonder kaart; dan moet het venster bij een gekozen uit de duur leeg laten of verlengen.
- [x] **SVP4. Strook altijd waar de auto-DJ de overgang echt begint?** 👀 — gedaan 6 okt (avond): de strook toont het moment van de planner (`momentArgs`, dezelfde regel als de automaat), ook zonder uit. Een blend begint daardoor tot 16 maten eerder dan de oude tekening.


**Auto-DJ** (speellijst "Auto-DJ met secties")
- [ ] **SVA1. Uitmixen op de outro.** 👂 Met een sectiekaart op een zeker grid begint de overgang waar de outro van de uitgaande begint (als hij daar nog vóór het eind past), niet meer op een veelvoud van 16 maten vanaf het anker (vaak midden in de laatste drop); de nieuwe begint op zijn intro. **Advies:** zo laten; zeg het als hij bij een lange outro te vroeg weggaat.
- [ ] **SVA2. Past de outro niet: de laatste break.** 👂 Volgorde: de laatste break binnen 32 maten van het eind → het oude moment als dat niet in een drop valt → het begin van iets anders dan een drop → het begin van een drop. **Advies:** proberen; is de break te vroeg, dan het venster naar 16 maten.
- [ ] **SVA3. Secties ook bij beatloos overvloeien op een onzeker grid?** 💬 Nu alleen op een zeker grid; in jouw library (overvloeien is de hoofdroute) doen ze bij het uitmixen dus bijna niets. **Advies:** ja, maar pas als SE2 laat zien dat de grenzen op onzekere grids kloppen.
- [ ] **SVA4. langer en nu naar de volgende sectiegrens?** 🎛 langer = volgende grens binnen 16 maten (anders 8), nu = volgende grens binnen 8 maten (anders de eerstvolgende 4); beatloos blijft nu meteen. **Advies:** zo laten.
- [ ] **SVA5. Een sectie drukken terwijl de volgende klaarstaat.** 🎛 Op wat nu klinkt: springt hij echt, dan plant hij opnieuw vanaf de nieuwe plek (geen overname); past de overgang daar niet meer vóór het einde, dan loopt hij vanaf waar je bent, zoals na een seek. Een druk die niets doet (geen sectie, loop om de sectie waar je al bent) verandert niets. Op de klaarstaande track: overname, zoals seek en hotcue. Alternatief: die sectie wordt het nieuwe beginpunt en de automaat mixt door. **Advies:** zo laten; het alternatief als je het mist.


**Controlekamer** (speellijst "Avond 1 · Secties")
- [ ] **SVC1. Secties meteen na het binnenhalen uitrekenen?** 💬 Nu krijgt een nieuw nummer pas secties als je het laadt (het laden wacht dan ~0,3–1 s op de server) of na een herstart van de server (de achtergrond). Tot dan staat het in de Controlekamer als "nog zonder". Na een split in stems of een ander grid staat de kaart als "verouderd" tot je het nummer laadt. Meteen rekenen, achter grid en toonsoort in de worker, kost de server ~1 s per nummer terwijl je mixt. **Advies:** ja, na het binnenhalen en na een split; dan hoeft het laden nooit te wachten.

**Maschine** (speellijst "Secties op de Maschine")
- [ ] **SVM1. De pads in de modus secties zijn de secties van de FOCUS-track?** 🎛 Groep A–H kiest de track, net als Track Select op de APC (SE3). De speeltrack kan niet: die heeft altijd een instrument en dus geen secties. **Advies:** zo laten.
- [ ] **SVM2. Kleuren zoals op de APC: wit = die hoor je, donker hemelsblauw = er is een sectie, uit = geen?** 👀 De Maschine kan niet knipperen op de tel. De sectie waar je heen springt licht pas op bij de "1"; tot dan zegt het scherm "op de 1: …". **Advies:** eerst zo. Groepskleuren volgen SE4, dan op beide controllers tegelijk.
- [ ] **SVM3. SHIFT + pad = die sectie als loop, zoals op de APC?** 💬 Niet gebouwd (niet gevraagd). De action `track.N.section.K.loop` bestaat al op de bus. **Advies:** ja, als je het op de APC gebruikt; het is een kleine stap.
- [ ] **SVM4. Meer dan 16 secties: bladeren met ◄ ► (transport)?** 🎛 Bij een andere focus-track begint hij op de bladzijde met de sectie die je hoort; daarna loopt de bladzijde niet mee, dus de pads verspringen nooit onder je vingers. De kop noemt altijd wat je hoort, ook boven de 40. **Advies:** zo laten.
- [ ] **SVM5. Het linkerscherm: de namen in een raster zoals de pads liggen, de sectie die je hoort omgekeerd, de kop groot?** 👀 Letters 5×7 in kolommen van 64 px; een naam is hooguit 8 tekens ("opbouw B"). **Advies:** op het echte toestel kijken; is het te klein, dan minder tekst en grotere letters.


**In beeld** (speellijst "Secties in beeld")
- [ ] **SVV1. De video-puls slaat op een nieuwe sectie vol, ook als je de puls zacht hebt staan: goed zo?** 👀 Het accent komt op de puls die er al is: het gekozen doel gaat op elke nieuwe sectie VOL, wat de diepte ook is; alleen met de puls aan (PULS op 0 = ook geen accent). Bij doel flits is dat een witte flits op de grens. Bij pixel, spiegel en korrel is het bij elke grens het volle effect, ook met PULS op 0,01, en de hub-macro `macro.beweging` (K4 = PULS) geeft op een lage stand al volle flitsen of effecten op elke grens. Geen nieuw puls-doel en geen nieuwe knop (de doelen lopen rond in het handelingenlog). Alternatieven: (a) zo laten; (b) vol alleen bij flits, bij de effecten met de diepte mee (bv. 3 × de diepte); (c) een schakelaar "puls op: tel · sectie · beide" (één knop, als stand in het log). **Advies:** (b). Probeer eerst doel flits met de puls laag, en zeg wat je bij pixel ziet.
- [ ] **SVV2. Hoe lang gloeit een nieuwe sectie na?** 👀 Als een klap, maar twee keer zo lang: vol op de grens, na 0,3 s nog 22 %, na ~1,8 s weg (`NIEUW_TAU` 0,2 s). Dezelfde vorm voor de vormlaag (bron "nieuwe sectie") en de video-puls. Niet op de beamer bekeken. **Advies:** zo laten, tenzij de flits te kort is om op de beamer te zien; dan 0,3–0,5 s (één getal).
- [ ] **SVV3. Sectie-energie als bron: springen op de grens, glijden bij een wissel?** 👀 De vorm krijgt de energie van de sectie die je hoort (0..1 binnen het nummer, van de server). Op een grens, een sectiesprong of een loop springt hij mee. Neemt een andere track de maat over of komt de kaart later binnen, dan glijdt hij in ~0,75 s naar de nieuwe waarde. Valt de maatgever weg, dan blijft de energie eerst 0,5 s staan (een cut in de mix) en glijdt dan in ~1,5 s naar 0. **Advies:** zo proberen. Kloppen de stappen niet met wat je hoort, dan ligt het waarschijnlijk aan de energie per sectie (SE2).
- [ ] **SVV4. Op een nieuwe sectie ook de mengvorm wisselen?** 💬 Niet gebouwd: het verandert een stand die in het log staat (`video.mode`), en elke grens zou de mengvorm één plek doorschuiven. **Advies:** eerst de flits; wil je het, dan als eigen schakelaar.
- [ ] **SVV5. Een korte loop of stutter op een sectiebegin: één accent?** 👀 Gekozen (7 okt): het rondgaan van een loop korter dan een maat, en hetzelfde sectiebegin binnen een maat (hotcue- of pad-stutter), is geen nieuwe sectie, in beeld én in de hub. Een sectie-loop (≥ 1 maat) klapt elke ronde. **Advies:** op de beamer kijken; mis je de flits per rondgang bij een korte loop, zeg het.
- [ ] **SVV6. Energie vasthouden bij een cut?** 👀 Gekozen (7 okt): korter dan 0,5 s geen maatgever (een cut met de fader of crossfader) houdt de energie vast, in beeld en in de hub; daarna glijdt hij naar 0. **Advies:** proberen; is een halve seconde te kort of te lang, één getal (`HOUD`).


**Hub** (speellijst "Secties naar de hub"; AV-app-hub PROTOCOL.md §18)
- [ ] **SVH1. Een nieuw nummer: een klap of niet?** 👀 Stopt A en start B op zijn cue op een sectiebegin, dan een klap (dat is starten). Neemt een nummer dat al speelde de maat over in een mix, dan geen klap; label en energie gaan wel mee, en de volgende grens in dat nummer klapt wel. Spelen vanaf het begin van een nummer en een hotcue midden in een sectie geven geen klap (zoals in beeld). **Advies:** zo laten: een overname valt op de hysterese, niet op een "1".
- [ ] **SVH2. Pauze: label laten staan?** 💬 Het label blijft staan met energie 0 ("drop, 0"). Energie 0 is ook een intro (de energie is relatief binnen het nummer): een beeld-app ziet geen verschil tussen pauze en intro. **Advies:** zo laten tot een beeld-app het verschil nodig heeft; anders een label `stil`.
- [ ] **SVH3. Hoe vaak mag de hub een nieuwe sectie krijgen?** 💬 Gekozen (7 okt): hooguit één per seconde (vangnet in hub.js), en alles samen hooguit 10 per seconde in een schuivend venster waarin de `nieuw` meetelt; de `nieuw` gaat altijd meteen, gewone berichten wachten. **Advies:** zo laten.
- [ ] **SVH4. Welke energie draagt een nieuwe sectie?** 💬 Gekozen (7 okt): die van de sectie zelf (het doel), niet die van het glijden; daarna glijdt de hub-energie niet van onderen op. **Advies:** zo laten.

## BE. Beeld: VARVE stuurt de Stroommachine (6 okt, docs/BEELD.md, tak `studio/beeld`)

- [ ] **BE1. De acht macro's op de device knobs, niet op de faders.** 🎛 De opdracht noemde "8 faders", maar de track-faders zijn de kern (volume) en die zit nooit in een mapje. Nu: Shift + Detail View opent het mapje beeld, device knob 1–8 = intensiteit · snelheid · helderheid · feedback · tint · dichtheid · glitch · balans (endless, de ring toont de stand). **Advies:** zo proberen; wil je toch faders, dan alleen via koppelen (op eigen risico: een fader is dan geen volume meer).
- [ ] **BE2. Thru-tracks geven geen scène.** 🎛 Het protocol kent deck A en B; VARVE maakt daarvan de crossfaderkant: deck A = de track op kant A die speelt (of het laatst geladen werd), deck B idem. Tracks op thru (standaard 3–8) sturen niets. Alternatief: een thru-track telt bij de kant waar de crossfader nu staat. **Advies:** zo laten (voorspelbaar: zet een track op A of B met de A|B-knop als hij een scène moet krijgen).
- [ ] **BE3. De ringen beginnen op de neutrale stand van de Stroommachine.** 🎛 Ze meldt haar macro-standen niet terug; je eerste draai zet de macro op de neutrale stand plus de draai (heb je op de pc intussen iets anders gezet, dan springt hij). **Advies:** vragen aan de Stroommachine-kant: de macro-standen in `beeld-status` meesturen; dan volgen de ringen haar.
- [ ] **BE4. Lampjes van de regie: nu alleen "verbonden" en "ingedrukt".** 👀 Vasthouden en paniek zijn schakelaars in de Stroommachine; VARVE weet hun stand niet, dus scene 3 en Stop All tonen niet of ze aan staan. **Advies:** later, samen met BE3 (`hold` en `paniek` in `beeld-status`).
- [ ] **BE5. Volgorde op de scene-knoppen: ontdek · volgende · vasthouden · flits · vrij, Stop All = paniek.** 🎛 De Stroommachine zelf heeft op scene 1–5 ontdek · mutatie · kweek · volgende · vasthouden, flits op Metronome en vrij op Lock; die twee knoppen zijn in VARVE bezet. **Advies:** zo proberen; zeg het als je spiergeheugen van de Stroommachine wint (dan mutatie en kweek erbij en flits/vrij ergens anders).
- [ ] **BE6. De extra latentie afstellen.** 🎧👀 Standaard 0 ms. **Advies:** op de eerste avond met de beamer: een nummer met een harde kick, kijk naar een flits op de tel, en ijk op één plek (een beamer loopt vaak 50–120 ms achter): met Stroommachine v10 IJken op de pc (tab Live → Varve DJ) en de latentie in Varve op 0; zonder v10 de latentie in Varve hoger tot de flits op de kick valt. Noteer de waarde, dan zet ik het als standaard.
- [ ] **BE7. Zonder pc: beeld uitzetten, of laten zoeken?** 💬 Staat beeld aan zonder relay, dan probeert VARVE het elke 10 s opnieuw: één melding na 8 s, verder stil, maar Chrome logt elke mislukte poging zelf rood in zijn console (niet te onderdrukken; ~3 regels per poging). Het spelen merkt er niets van. **Advies:** zo laten; zet beeld uit (BEELD-rij) als je weet dat de pc niet meekomt.
- [ ] **BE8. Een relay buiten het LAN mag.** 💬 De hub (`?hub=`) weigert een host buiten deze machine, het LAN en de tailnet zonder `&hub_extern=1`. Het relay-adres typ je zelf in (geen link die iemand je stuurt), en er gaat alleen klok, kenmerken, titels en de crossfader heen. **Advies:** zo laten.
- [ ] **BE9. Terugspelen stuurt de macro's opnieuw, de regieknoppen niet.** 💬 `beeld.*` staat in het log zoals elke action. Bij terugspelen gaan de macro's opnieuw naar de Stroommachine (als beeld aan staat); de regie (`beeld.regie.*`) wordt overgeslagen, want vasthouden en paniek zijn schakelaars waarvan VARVE de stand niet kent (terugspelen kon ze omgekeerd zetten). **Advies:** zo laten.
- [ ] **BE10. Scène wisselen op de stand van de crossfader, of op wat je hoort?** 🎧 De Stroommachine wisselt van scène voorbij 0,5. Met een scherpe crossfadercurve (Metronome) hoor je B al bijna helemaal bij 0,1, maar blijft het beeld op A tot 0,5. Alternatief: VARVE stuurt een "effectieve" stand (hoe hard B klinkt t.o.v. A). **Advies:** eerst zo; pas als het met de scherpe curve vreemd voelt.

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

---

## VI. Uitwerking van de visie (10 okt, docs/UITWERKING-2026-10-10.md §5, zeven sporen, PR #19–#26)

Stand 10 okt 17:00. De keuzes per spoor staan in de eigen blokken (U, AP, BE11–14, CX, K-A–K-F, standen,
companion in de PR-teksten); dit blok zijn de keuzes die over de sporen heen gaan. Niets gemerged tot ze er zijn.

- [ ] **VI1. Eén zin in `CLAUDE.md` over uitgangen.** 💬 Drie sporen vragen dezelfde verduidelijking van
  "geen deelfuncties, geen publieke streaming, geen upload" (r. 29–31): *geen distributie van de cache; een
  uitgang (een bestand, 127.0.0.1, een export naar eigen schijf) is geen distributie en mag; eigen opnames
  en renders naar de eigen library mogen.* Dit opent niets naar buiten (het lokaal-slot van uitzenden blijft
  dicht tot U1b) en legt vast wat al zo is (de upload-route bestaat). **Advies: ja, in één aparte kleine PR,
  niet in drie takken.** Daarmee kunnen uitzenden stap 3, produceren-uit K-D en crossover 3a verder.
- [ ] **VI2. `media/` en de opnames buiten iCloud, en een kopie buiten de laptop.** 💬👀 Gemeten: een
  uitgeplaatst bestand laat de server bij de eerste lezing hangen tot het hele bestand binnen is (3,9 GB
  voor `stems.wav`; zonder internet nooit); "Optimaliseer Mac-opslag" staat aan, de schijf is 72 % vol, en
  iCloud is geen backup (het synchroniseert ook wissen). **Advies: ja, na de proefavond en vóór de eerste
  reis-set**: `VARVE_MEDIA` naar bijv. `~/Varve-media` (in VARVE.app en in de hub-set), `media/` verhuizen
  met `rsync -a` terwijl de server uit staat (`library.db` bewaart relatieve paden), `VARVE_BACKUPS` naar een
  externe SSD, en vóór elke reis een `rsync` van `media/`. Dit vervangt uitzenden U3(b) en draagbaar keuze 3+4.
- [ ] **VI3. Merge-ritme: wat na avond 1, wat na avond 2?** 💬 Keuze 1 van het verbeterplan (9 okt) zei:
  tot na avond 2 alleen repareren wat op de proefavond fout gaat. **Advies: houd dat voor alles wat het
  live-pad raakt (#21 standen, #25 companion stap 2, #26 crossover, de uitzend-routes), maar laat de vier
  additieve takken (#22, #20, #23, #24 zonder route) na de verwerking van avond 1 in `studio/integratie`**:
  ze raken de mixer niet, hebben elk twee reviews, en elke dag open kost conflicten. Zeg "nee" en alles
  wacht op avond 2; zeg "ja" en crossover (CX4) schuift ook naar avond 2.
- [ ] **VI4. De commit-trailers.** 💬 Alle acht takken eindigen op `Co-Authored-By: Claude Opus 5.5` in
  plaats van `Claude Fable 5.1`; het is het model dat de commits schreef. **Advies: laten staan.** Herschrijven
  kost een amend op ~70 commits en een force-push op acht takken en levert niets op.
- [ ] **VI5. Wat doet avond 2?** 🎛🎧 Kandidaten: via de hub met opstelling `alles`; beeld-speelproef
  zaalbeeld (en Stroommachine op de Mac als de meting groen is); uitzenden stap 0 (één hele set opnemen met
  beeld, ≥ 45 min); het crossover-proefblok (5 punten, ~8 min). **Advies: hub + avondpakket + zaalbeeld +
  de lange opname; de crossover op avond 2 alleen als VI3 "ja" is, anders avond 3.** Vier nieuwe dingen op
  één avond is het maximum; de speellijst is al van 33 naar 172 punten gegroeid.
- [ ] **VI6. De eerste echte uitzending.** 💬 Na de thuisproef via OBS: (1) een eigen-werk-sessie op je
  eigen kanaal (geen rechtenzorg; precies de crossover), (2) Mixcloud Live unlisted (€ 11 voor één maand,
  audio-only mag, een fout kost alleen een draft-show), (3) Twitch DJ Program (opt-in, NL ok, maar nooit
  audio-only of automatisch; alleen catalogusnummers). **Advies: in deze volgorde, en U1b (Varve zelf naar
  een dienst) pas beslissen als OBS op de Air te zwaar blijkt.** Geen juridisch advies; cijfers nagekeken op
  10 okt bij de bronnen.
- [ ] **VI7. Beeld onderweg = zaalbeeld.** 👀 Vormen aan, clips uit, Stroommachine uit, als stand
  `onderweg-licht` in standen; de Stroommachine op de Mac (Licht, vast, 1152×648) als upgrade na een groene
  meting naast Varve én een speelproef. **Advies: ja.** Je speelt je eigen beeld (4.576 acties); de clips van
  anderen mogen de zaal niet in; de zwart-knop en de opname werken alleen op het zaalbeeld.
- [ ] **VI8. "Vanaf elke plek" = de iPhone heeft data.** 💬 De companion via Tailscale werkt op een hotspot
  mét data en loopt waarschijnlijk door als de data wegvalt, maar een koude start zonder internet werkt
  waarschijnlijk niet (en iOS zet de hotspot niet aan zonder data). Alternatief: de server op het
  hotspot-adres laten luisteren (`VARVE_BIND`, klein spoor). **Advies: accepteer "data" als voorwaarde en
  bouw het LAN-pad pas als een locatie het echt vraagt.**
- [ ] **VI9. Eén tegel "Vanavond" of twee (Opstelling, Avondpakket)?** 💬 Beide sporen gebruiken dezelfde
  profielnamen. **Advies: eerst twee tegels (elk spoor mergt los), na avond 2 samenvoegen als je ze altijd
  samen gebruikt.** En het label blijft "Opstelling", niet "Stand".
- [ ] **VI10. De kernset onderweg en de spullen.** 💬👀 APC + Scarlett + bedrade koptelefoon + PD-hub +
  Apple-lader ≥ 30 W is de kleinste set voor een volledige set; Maschine en AV-hub pas na avond 2. Te checken:
  heeft je USB-C-hub stroomdoorvoer (PD-opdruk)? Welke beamer (BE13: model, 1080p, 60 Hz, HDMI-pad)?
  **Advies: kijk morgen op je hub; zo niet, een PD-hub van ~30–50 euro; beamer-gegevens doorgeven vóór de
  beeld-speelproef.**
- [ ] **VI11. Wie doet 7a morgenochtend?** 👀 Twee alleen-lezen-commando's met de APC en Scarlett nog
  aangesloten (`system_profiler SPAudioDataType SPUSBHostDataType -json`, `ioreg -p IOUSB …`), daarna
  anonimiseren (serienummers). **Advies: een agent, vóór je de stekkers eruit trekt.** Zonder 7a blijft het
  avondpakket op `hardwareBevestigd: false` en de PR in draft.
- [ ] **VI12. De richtingen B: welke het eerst?** 💬 Stroommachine ín Varve's beamer; beeldhand op de iPad;
  live wisselen van opstelling; bevriezen naar een nieuw nummer met eigen stems; in-app uitzenden. **Advies:
  nu geen; laat de speelproeven van stap 6–8 kiezen.** Mijn verwachting: de beeldhand op de iPad komt het
  eerst (het is 9 % van je acties), daarna bevriezen (de crossover-belofte).
