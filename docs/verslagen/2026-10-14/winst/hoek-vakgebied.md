# Hoek vakgebied: wat doen Traktor, Rekordbox, Serato, Mixxx, Ableton/Bitwig en de CDJ beter? (13 okt 2026)

Gelezen op `studio/afmaken` (7debab6). In de repo is niets gewijzigd. Metingen en downloads staan in
`winst/meet/` (scripts) en `winst/dl/` (Mixxx-bronnen, alleen gelezen).

Uitgangspunt: `docs/ONTBREEKT.md` (2 okt) had al een vergelijking met rekordbox 7, Traktor 4, Serato 4,
Mixxx 2.5 en VirtualDJ. Veel daarvan is inmiddels gebouwd: koptelefoon, keylock, stems, backup,
bladeren, harmonisch "past bij", het setboek (tracklist uit het handelingenlog), secties (de
"phrase analysis" van Rekordbox). Die laat ik weg. Over blijven vijf ideeën die (a) in het vak al lang
gewoon zijn, (b) in VARVE aantoonbaar ontbreken, en (c) passen bij de drie regels en VISIE §5.

Wat hier NIET in staat, omdat een andere workflow het al doet: lag op de controllers, de
beatgrid-analyse, de knoppenverdeling, de uitlijnweergave en de effectcombinaties (superknop, morph,
Pad FX als `.hold`-regels: `docs/WERKRUIMTE.md` A8). Waar mijn kans ermee samenhangt staat dat erbij.

## Volgorde (winst tegen moeite)

| # | Kans | Bron in het vak | Winst | Moeite |
|---|---|---|---|---|
| 1 | Sync die blijft volgen (sync-lock) | Mixxx Sync Lock, Traktor/Rekordbox/Serato sync | 9 | ~3-4 dagen |
| 2 | Noodvoorraad: server bewaken, langer vooruit, noodlus | Pioneer CDJ Emergency Loop, CDJ-3000 fw 1.08 | 8 | ~1-2 dagen |
| 3 | Schaduwpositie: slip, slip-hotcue, loop roll | Traktor Flux, Serato Slip/Censor/Roll, Rekordbox Slicer, Bitwig "Return" | 7 | ~2-3 dagen |
| 4 | Golfvorm in kleur, en met stems: wat je hoort | Mixxx RGB, Rekordbox 3Band, Serato dynamische waveforms | 6 | ~2-3 dagen |
| 5 | Vervolgacties op secties en patronen | Ableton Follow Actions, Bitwig Next Action | 6 | ~3-5 dagen |

---

## 1. Sync die blijft volgen

**Probleem.** Sync is eenmalig: `Engine.sync()` (`src/engine/engine.js:698-746`) zet één keer de rate
en schuift de fase, en daarna volgt niets. Wisselt de maatgever van tempo, dan loopt elke gesyncte
track weg. Dat gebeurt (1) als je aan de tempo-encoder van de maatgever draait, (2) op elke stukgrens
in zijn tempokaart, en (3) als de auto-DJ het tempo terug wil zetten na een blend (AUTO-DJ.md §7,
nog niet gebouwd). Al genoemd in ONTBREEKT A3 en WERKRUIMTE P5, nog niet gebouwd.

**Bewijs.**
- Clay's library drijft: in `docs/LIBRARY.md` (bpm-kolom) stond vroeger "wisselend" bij een afwijking
  > 0,5% tussen de stukken: **61 van de 69 nummers**. `tools/beatmeting/overzicht.txt`: Bay Ledges
  loopt in stukken van 102,1 tot 108,7 bpm.
- Meting (`winst/meet/voorraad.mjs`, gewoon rekenwerk): na een tempowissel van de maatgever met
  eenmalige sync ligt de volger
  - bij 0,5%: 10 ms naast na 2,0 s, 50 ms (een hoorbare flam) na 10 s;
  - bij 1%: 10 ms na 1,0 s, 50 ms na 5 s;
  - bij 3%: 10 ms na 0,3 s, 50 ms na 1,7 s.
  Een lange blend over een stukgrens gaat dus binnen seconden mis, ook als beide grids kloppen.

**Hoe het vak het doet.** Mixxx (`mixxx/src/engine/controls/bpmcontrol.cpp`, `calcSyncAdjustment`,
gelezen in `winst/dl/bpmcontrol.cpp:524-590`): de volger krijgt elke callback een rate-correctie op de
fasefout: proportioneel (×0,7), per stap hooguit 2% bijsturen, nooit meer dan ±5%, niets onder 1% van
een tel, en bij een fout > 0,2 tel "assume poor reflexes": versnellen. Een duw van de gebruiker tijdens
sync wordt de nieuwe gewenste afwijking (`m_dUserOffset`), geen fout. Mixxx' handleiding: "Changing the
rate of any deck that has Sync lit will change the rates of all other decks", een soft leader die
vanzelf verhuist als de leider stopt, en "a leader plays always the original recorded tempo changes;
a follower changes its tempo matching the leader". Traktor, Rekordbox en Serato houden sync ook aan
tot je hem uitzet.

**Waarom VARVE het beter kan dan Mixxx.** Mixxx stuurt bij omdat het de toekomst niet kent. VARVE kent
hem: de tempokaart van de maatgever staat in tracktijd, dus het moment van de volgende stukgrens op de
audioklok is uit te rekenen (`ctxTijdVan`). De maatgever (met hysterese) bestaat al (`syncMaster`).

**Toepassen (v1, klein, geen worklet-werk).**
1. `deck.volgt` (boolean): aan na een geslaagde `sync()` als de knop vastgehouden wordt of met shift
   (zoals Mixxx: lang drukken = lock), uit bij tempo-encoder/pitchfader op die track, laden, een
   instrument erop. Bend zet hem NIET uit: bend raakt `deck.rate` niet (al zo gebouwd).
2. `Engine._volgSync()` op dezelfde plek als `_volgWachtenden` (op elke 'change' van een deck en op de
   bestaande maatgever-timer): voor elke track met `volgt`: doel-rate = `master.bpm / grid.bpmAt(pos)`;
   wijkt die > 0,01% af, `setRate`. Op 40 ms timer is de fout bij een stukgrens van 1,6% hooguit
   0,6 ms: de timer zegt alleen WANNEER, de positie wat (regel 3).
3. Fasefout bijhouden met `faseVerschil` (bestaat, `engine.js:752`): boven 3 ms een kleine
   rate-correctie (Mixxx-stijl, maar begrensd op ±0,3%, dat is ~5 cent zonder keylock) tot hij onder
   1 ms is; nooit springen.
4. v2, als v1 hoorbaar tekortschiet: de rate-wissel op de stukgrens GEPLAND (een segment met T in de
   toekomst, zoals de geplande sprong van keylock, `rekPlanT`): sample-exact, geen correctie nodig.
5. Mee in: `OVERNEEM` (automaat.js:37: de auto-DJ zet zelf rate/glijden; een lock die hij niet zette is
   van Clay), de beginstand van het handelingenlog (`volgt` is toestand), het lampje van Solo (vol =
   lock, half = eenmalig gelijk), `apc-beschrijf.js`, `test/engine.test.mjs` (stukgrens op de
   maatgever, tempo-encoder, maatgever-wissel, rem).

**Risico.** Twee bronnen die het tempo zetten (auto-DJ glijdt, lock volgt): de regel "wat Clay
aanraakt is van hem" moet ook hier. Zonder keylock hoor je elke tempowissel van de leider als toon
(Mixxx zegt hetzelfde: "engaging keylock helps"). Een fout grid op de leider sleept alle volgers mee
(Mixxx: "follows the detected leader tempo unconditionally"); alleen volgen op een ZEKER stuk.

**Samenhang.** WERKRUIMTE P5/E2 ("Sync-lock pas na een vraag aan Clay") en de beatgrid-workflow (een
grid dat beter past maakt sync-lock pas echt waard). Eén vraag aan Clay volstaat: lang drukken op Solo
= lock?

---

## 2. Noodvoorraad: de server mag even weg zijn

**Probleem.** Alles wat klinkt komt in pagina's van de server. Valt `node server/index.js` weg
(geheugen, een crash buiten de vangnetten, een update, per ongeluk `pkill node`), dan:
- haalt elke StreamBron vanaf dat moment niets meer (`src/engine/bron.js:626-664`: fout, melding
  "stream hapert", opnieuw proberen elke 100 ms) en speelt hij uit wat er is;
- staat er **20 s vooruit** in het geheugen (`plan(... vooruit = 20 ...)`, `src/engine/stream-kern.js:249-250`);
- start niemand de server opnieuw: VARVE.app doet één keer `nohup node server/index.js &`
  (`tools/varve-app/VARVE.applescript:98`), geen bewaking.
- Herladen van het tabblad kan dan ook niet (alles komt van de server, `no-store`).

**Meting** (`winst/meet/voorraad.mjs`, met de echte `plan()`): na het wegvallen van de server klinkt
een spelende track nog **20,1 s** (rate 1) of 20,3 s (rate 1,06), daarna stilte. Met `vooruit = 60`:
61 s. Geheugen per track: 8,1 MB stereo nu, 16 MB met 60 s; met vier stems 32,5 → 64 MB.

**Hoe het vak het doet.** Pioneer CDJ's hebben een "Emergency Loop": valt de USB of de link weg, dan
speelt de speler een korte lus van wat in zijn geheugen zit tot je iets nieuws laadt; sinds firmware
1.08 van de CDJ-3000 houdt hij de HELE geladen track in het geheugen ("full track caching"), zodat de
lus niet meer nodig is. Traktor, Rekordbox en Serato decoderen de hele track in RAM. VARVE koos bewust
voor streamen (CLAUDE.md, ~30 MB voor acht albums in plaats van 5,7 GB): goed, maar dan hoort er een
vangnet bij.

**Toepassen (drie lagen, elk los).**
1. **Server bewaken (uren).** In VARVE.app de start in een kleine lus (`while :; do node server/index.js;
   sleep 1; done`) of een LaunchAgent met `KeepAlive`. De StreamBron vangt een herstart al zelf op
   (`haal` faalt, volgende tik opnieuw; zelfde bestand = zelfde Content-Range). Toets: in een
   headless-proef de server killen terwijl een deck speelt, binnen 20 s weer starten: geen gat.
2. **Langer vooruit voor wat je HOORT (uren).** `bijvullen()` geeft `vooruit = 60` aan een track die
   speelt met fader × crossfader > 0 (zoals `hoeHard` in engine.js), 20 voor de rest. Kost +8 MB per
   hoorbare stereo-track (2–3 tracks = 16–24 MB).
3. **Noodlus op de maat (een dag).** Haalt de bron al ≥ 3 s niets en valt het einde van wat er is
   binnen 8 maten, dan zet het deck zelf een loop van hele maten (`Beatgrid`, `isMaatbegin`) die
   helemaal binnen de pagina's ligt, met een vaste melding "server weg — noodlus, loslaten met reloop".
   Geen grid: geen lus, dan de melding "stilte over N s". Muzikaal beter dan de CDJ (die lust
   ongequantized). Via een gewone `setLoop`, dus de streamkern verandert niet en de naad-overvloeiing
   (`LOOP_NAAD`) werkt meteen.

**Winst.** Precies de grootste angst live: stilte. Een serverstoring wordt een herstart van een
seconde in plaats van een stille zaal na 20 s.

**Risico.** Laag. Een eeuwig herstartende server die meteen weer valt (de lus moet loggen en na N keer
stoppen). Laag 3 is een automatische ingreep op een deck: alleen als het anders stil wordt, en altijd
met melding.

---

## 3. Schaduwpositie: slip, slip-hotcue en loop roll

**Probleem.** Een loop, een hotcue of een sectie-sprong verplaatst het nummer echt. Wil je even een
tel herhalen of een hotcue "stotteren" en dan door alsof er niets gebeurde, dan moet je zelf terug
zien te komen op de juiste plek en fase. In ONTBREEKT als B4 ("slip-modus, daarna roll, censor,
reverse"), WERKRUIMTE W3 vraagt Clay om een concreet voorbeeld. Er is geen code voor (`grep slip`
geeft alleen het wrijfmodel van de klankschaal).

**Hoe het vak het doet.** Traktor Flux Mode (sinds 2.6): "keeps track of time while you juggle cue
points, loop and re-edit the track live", loslaten = waar hij zonder ingreep zou zijn. Serato: Slip
als schakelaar, Censor en Loop Roll zolang je drukt ("once released, playback resumes as though it was
never pressed"). Rekordbox: pad-modus Slicer ("while a pad is held, the track is sliced and plays the
sliced section in loop") en Active Censor. Bitwig: launcher-clips met "on Release: Return".

**Waarom het in VARVE goedkoop is.** De positie is al een formule op de audioklok: `{T, P, R}`
(stream-kern, regel 3). Een schaduw is diezelfde formule zonder de ingreep. Terugkeren is een
fasebehoudende sprong die al bestaat (`seek(p, { doorlopend: true })`, `src/engine/deck.js:546`;
met keylock gepland op het zoekrooster). De worklet hoeft niets te weten.

**Toepassen.**
1. `deck.schaduw` = `{ T, P, R }` (een object, zoals `rem: { a }`), gezet bij het begin van een
   slip-ingreep; bij elke tempowissel opnieuw verankerd (`P += R·(nu−T)`, `T = nu`). Alleen op de
   hoofdthread.
2. Actions (eerst `define()` in actions.js): `track.N.slip` (schakelaar: elke loop, hotcue en
   sectie-sprong is dan omkeerbaar), `track.N.hotcue.K.slip` (zolang je drukt, loslaten = terug),
   `track.N.roll.<1/16…1>` (zolang je drukt een beat-loop van die lengte vanaf de tel vóór wat je
   hoort, loslaten = terug), `track.N.section.K.slip` (de sectie zolang je drukt, Bitwig-"Return").
   Loslaten = `seek(schaduwNu, { doorlopend: true })`.
3. Plek: een grid-modus "roll" (per kolom vijf lengtes) of NOTE REPEAT op de Maschine; dat is de
   indeling van de werkruimte-workflow, dus daar laten kiezen. Ook op het toetsenbord.
4. Mee in: handelingenlog (loslaten draagt `{ van }` zoals een sectiedruk, zodat terugspelen exact
   is), `OVERNEEM`, de video (springt al mee met een seek), sync-lock (de schaduw loopt op de rate van
   de lock).
5. Tests: na N rondes roll ligt de positie op de tel waar hij zonder roll zou zijn (fout < 1 sample op
   de nep-klok); met keylock < 1 blok; tempo verandert tijdens de slip.

**Risico.** Laag tot middel: het raakt seek, loop en hotcue, de randgevallen van CLAUDE.md
(TRANSPORT) gelden allemaal. Reverse en censor (achteruit) blijven buiten: de streamkern kan niet
achteruit.

---

## 4. Golfvorm in kleur, en met stems: wat je hoort

**Probleem.** De golfvorm is één kleur (`tekenGolf` in `src/ui/waveform.js:9-29`, `g.fillStyle =
color`), uit min/max per 256 samples (`server/analyze.js:17`). Een drop, een break of een
bas-inzet zie je pas aan de vorm, niet aan de klank. ONTBREEKT B14; `verkenning-precisie.md:149` van
de werkruimte noemt het ook ("Geen kleur per band").

**Hoe het vak het doet.** Mixxx (open source, `src/analyzer/analyzerwaveform.cpp`, gelezen): drie
Bessel-filters van de 4e orde, laag < 600 Hz, midden 600–4000 Hz, hoog > 4000 Hz, per bucket een
waarde per band; de RGB-weergave mengt die tot één kleur. Rekordbox 6+: "Blue", "RGB" en "3Band"
(laag/midden/hoog als drie lagen). Serato 3: de golfvorm verandert van kleur als je stems uitzet
("dynamically change color to correspond with the change in audio").

**Meting** (`winst/meet/banden.mjs`, Node, gewone biquads 4e orde op 600 en 4000 Hz): 6 minuten mono
48 kHz in **278 ms** (~1300× realtime), uitkomst **198 kB** (3 bytes per bucket van 256). In de
analyse-worker bij de ingest is dat niets naast peaks/onset/grid/toon.

**Toepassen.**
1. Server: `maakBanden()` naast `maakPeaks()` in `server/analyze.js` en de worker, `banden.bin`
   (uint8 × 3 per bucket, dezelfde buckets als peaks.bin, dus dezelfde `effectieveSampleRate`);
   achtergrond-inhalen zoals grid en toon; `analyze.test.mjs` legt het formaat vast.
2. Met stems: dezelfde drie banden PER STEM uit `stems.wav` (of alleen de RMS per stem). Dan kan de
   golfvorm tekenen wat je hoort: een gekilde stem valt weg of wordt grijs, zoals Serato. Dat past
   precies bij "wat je HOORT staat op één plek".
3. `tekenGolf`: per kolom de kleur uit de banden (Mixxx-RGB) of drie lagen (Rekordbox 3Band), keuze
   in de instellingen. De stand van kills/stems moet in de sleutel van `zelfde()` (CLAUDE.md: wat in
   draw() tekent, hoort in de sleutel), anders tekent hij te vaak of te weinig.
4. Zonder `banden.bin` (oude nummers, losse bestanden) de oude golfvorm.

**Winst.** Sneller het moment vinden (drops, breaks), ook op de banen van alle acht tracks; helpt de
uitlijnweergave van de werkruimte. **Risico.** Klein; de GPU-last blijft gelijk zolang er alleen
getekend wordt als de sleutel verandert (5 okt: 29 Mpx/s in rust halveerde Demucs).

---

## 5. Vervolgacties op secties en patronen

**Probleem.** Een sectie lanceer je op de volgende "1" (`sectieDoel`, `src/engine/secties.js:109`),
een patroon start/wisselt op het maatbegin (`PatroonSpeler.kies/start`, `src/engine/patronen/
speler.js:178/306`). Maar alles daarna is handwerk: "speel de drop twee keer, dan de break, dan terug
naar de drop" of "patroon A vier maten, dan B" kun je niet vastleggen. Er is niets dat lijkt op een
vervolgactie (`grep` op follow/vervolg in PATRONEN.md en SECTIES.md: niets).

**Hoe het vak het doet.** Ableton Live: per clip (en sinds Live 11 per scene) een Follow Action na een
tijd in maten/tellen, met Linked (na N keer de clip) of Unlinked, en een kans tussen actie A en B
(volgende, vorige, eerste, laatste, willekeurig, ander, opnieuw, stop, naar clip K). Bitwig: "Next
Action" na een lengte, plus "on Release: Return". Push en de APC40 zelf zijn voor precies dit soort
clip-lancering ontworpen.

**Waarom het hier past.** Het is pijler 2 en 3 tegelijk (VISIE §2: "één nummer tegelijk gemixt,
geknipt, als patroon geprogrammeerd"): een nummer wordt een re-edit die je live bespeelt, als data
(pijler 4), zonder code.

**Toepassen.**
1. Data per nummer (zoals hotcues en racks bij de link): `route = [{ sectie: K, keer: 2, dan:
   { sectie: J } | 'volgende' | 'loop' | 'stop', kans?: 0..1 }]`; voor patronen per plek
   `{ maten: 4, dan: plek }`. Puur model + `normaliseer…` (zoals `patronen/model.js`).
2. Uitvoeren als een bron van actions, zoals de automaat: kijkt naar de POSITIE (regel 3), en een
   maat vóór de "1" stuurt hij `track.N.section.K` (die rekent zelf de fasebehoudende sprong uit).
   Alles over de bus, dus in het handelingenlog en terug te spelen.
3. Clay raakt aan = de route stopt voor die track (de `OVERNEEM`-regel), met een lampje.
4. Bewerken: in de SECTIES-strook (rechtsklik "daarna …") en op de Maschine in SCENE (shift + pad).
5. Toets: synthetisch nummer (`test/synth-nummer.mjs`), route van drie stappen, de sprongen vallen op
   de "1" (marges van SECTIES §7).

**Risico.** Middel: botst met de auto-DJ (die gebruikt secties ook, AUTO-DJ §3b) en met handmatige
sectiedrukken; de regel "wie het laatst aanraakt wint" moet één plek hebben. Labels zijn nog een gok
(SE2), dus een route kan op een verkeerd gelabelde sectie staan; de route verwijst daarom naar de
index en het begin (`vindSectie`-regel), niet naar het label.

---

## Gewogen en niet in de top

- **Ableton Link** (Logic, TouchDesigner, iPad-apps als Koala of Loopy): sterk voor de draagbare set
  en pijler 2, maar native en GPL; alleen via Carabiner of de hub (los programma). Al in ONTBREEKT
  C3/C6. Eerst de proef C3, dan pas bouwen.
- **Pad FX / Beat FX / superknop**: de werkruimte-workflow (A8, `.hold`-regels, superknop, morph).
- **Smart crates en harmonisch zoeken**: gebouwd (kaart-kratten, "past bij").
- **Tracklist/historie per set**: gebouwd als setboek (`tools/setboek/`); "al gespeeld vanavond" zit
  in de automaat (`automaat.js:114`), niet in "past bij" (klein, kan erbij).
- **Reverse/censor**: vraagt een streamkern die achteruit kan; pas na slip (kans 3).
- **Auto-gain**: er al (loudnorm −14 LUFS bij de ingest, `server/ingest.js:24`).

## Aannames

- De bronnen van Pioneer, Native Instruments, Serato en Ableton waren alleen via zoekresultaten te
  lezen (de sites zelf niet bereikbaar vanuit deze omgeving); de citaten komen uit release notes,
  handleidingen en communityposts in die resultaten. De Mixxx-code en -handleiding zijn wel echt
  gelezen (raw.githubusercontent.com, tak 2.5).
- De driftgetallen van kans 1 zijn rekenwerk (fasefout = tempoverschil × tijd), niet in Chrome gemeten.
- Kans 2: niet gemeten hoe vaak de server echt wegvalt; de winst is een verzekering.
- Moeite is geschat, niet gemeten.

## Bronnen

- Mixxx handleiding, Sync Lock: https://github.com/mixxxdj/manual/blob/2.5/source/chapters/djing_with_mixxx.rst
- Mixxx `bpmcontrol.cpp` (calcSyncAdjustment): https://github.com/mixxxdj/mixxx/blob/2.5/src/engine/controls/bpmcontrol.cpp
- Mixxx `analyzerwaveform.cpp` (600/4000 Hz, Bessel4): https://github.com/mixxxdj/mixxx/blob/2.5/src/analyzer/analyzerwaveform.cpp
- CDJ-3000 fw 1.08, full track caching / emergency loop: https://selector.news/2021/02/13/pioneer-cdj-3000-update-caching-kuvo/ en https://ra.co/news/83908
- CDJ-3000 handleiding: https://www.fullcompass.com/common/files/87303-CDJ3000UserManual.pdf
- rekordbox 7.2.8 pad editor (Slicer, Pad FX, Active Censor): https://cdn.rekordbox.com/files/20251202174704/rekordbox7.2.8_pad_editor_operation_guide_EN.pdf
- rekordbox golfvormmodi: https://wearecrossfader.co.uk/blog/change-the-colour-of-your-waveforms/
- Traktor Flux Mode: https://forum.djtechtools.com/t/how-to-slip-mode-from-pioneer-cdj-900-2000-in-traktor-pro/5943 en https://community.native-instruments.com/discussion/43890/enabling-flux-mode-in-loops
- Serato DJ Pro (Slip, Censor, Roll): https://support.serato.com/hc/en-us/articles/224859147-Software-Overview en https://serato.com:443/downloads/files/135365/Serato+DJ+Software+Manual.pdf
- Serato Stems (dynamische golfvorm): https://serato.com/dj/pro/stems en https://support.serato.com/hc/en-us/articles/7645256113551-Stems
- Ableton Follow Actions: https://loopmasters.com/articles/2195-Ableton-Live-How-To-Use-Clip-Follow-Actions en https://musictech.com/2017/05/the-lazy-guide-to-ableton-live-part-4/
- Bitwig launcher clips (Next Action, on Release: Return): https://bitwig.com/userguide/latest/acquiring_and_working_with_launcher_clips
