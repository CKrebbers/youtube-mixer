# djay (Algoriddim) als referentie voor Varve v2

Onderzocht 19 okt 2026 voor Varve DJ v2 (één maatklok, kaartje muziekkennis-082). Versies: djay Pro 5.x voor
Mac en iOS; de laatste in de release notes van iOS is 5.6.9 (22 sep 2026). Alleen web-bronnen, geen eigen proef
met de app.

Hoe zeker een bewering is:
- **[zeker]**: staat in de officiële handleiding (help.algoriddim.com), de release notes of een persbericht.
- **[forum]**: een gebruiker of moderator (Slak_Jaw, NathanielAlgo) op community.algoriddim.com. Dat is wat mensen
  zien gebeuren, geen specificatie.
- **[afgeleid]**: mijn conclusie uit de bronnen.

"Les" verwijst naar kaartjes in `v2/oogst/` (muziekkennis-, bediening-, dj-workflow-, richting-, audio-kern-).

---

## 1. Sync en de klok

### 1.1 Twee soorten sync, één knop
- **Wat djay doet.** Een instelling (Settings › General › Sync Mode › Sync Type) kiest tussen twee soorten sync:
  - *BPM Sync* zet alleen het tempo gelijk, en je mag zelf nudgen. De knop wordt dan blauw.
  - *BPM + Beat Sync* lijnt de downbeats uit en "locks the beatgrids". Je ziet dan een blauw kader om de knop.

  Een *Beat Sync interval* van 1 tel of 1 maat bepaalt waarop gekwantiseerd wordt. **[zeker]**
  [sync](https://help.algoriddim.com/user-manual/djay-pro-mac/dj-tools/beatgrids-bpm-sync/sync),
  [general](https://help.algoriddim.com/user-manual/djay-pro-mac/settings/general)
- Sinds djay 5.0 gedraagt "BPM Only" zich ook als een vergrendeling. Raak je de plaat op deck B aan, dan verandert
  deck A mee. In 4.x was het tempo alleen bij het laden gelijkgezet. Een gebruiker noemde dat "unreliable and
  therefore unusable". **[forum, dec 2023]**
  [BPM only locks](https://community.algoriddim.com/t/sync-mode-bpm-only-locks-synced-tracks-together/22765)
- Sync is in djay dus een DOORLOPENDE koppeling zolang de knop aan staat. Hij geldt tussen decks, met een master
  binnen djay. Er is geen klok los van de decks, behalve als Ableton Link aan staat (1.6). **[afgeleid]**
- **Les voor v2.** v1 synct eenmalig: tempo plus fase binnen een halve tel (muziekkennis-070). v2 krijgt met de
  maatklok vanzelf een doorlopende koppeling (muziekkennis-082). Maak dat één begrip, "vast aan de klok", en geen
  twee standen die in de praktijk toch hetzelfde doen, zoals djay's BPM Only na 5.0.

### 1.2 Wie is master, en wat als die stopt
- **Wat djay doet.** "Only an audible deck can be Master". Hoorbaar betekent: kanaalfader open en crossfader niet
  aan de andere kant. Druk je op SYNC terwijl er niets of alles speelt, dan wordt dat deck de volger. Speelt er één
  deck, dan is dat de master. djay "shows no visual indicator of which is Master". **[zeker]**
  [how does sync work](https://help.algoriddim.com/topic/using-djay/how-does-sync-work)
- Staff zei in juli 2026 nog steeds: "We currently do not have Sync Master Deck indicators in djay". Er bestaat een
  MIDI-actie "set sync master", om de master "manually and on demand instead of via djay's automatic, built-in
  logic" te kiezen. Een gebruiker merkte dat de master automatisch wisselt met de stand van de crossfader. Hij mixt
  met EQ, en wil daarom dat hij die automatiek kan uitzetten. **[forum]**
  [sync master](https://community.algoriddim.com/t/understanding-sync-sync-master-tempo-reset-win-dvs/22059)
- Met een externe mixer leest djay fader en crossfader via MIDI. Zonder die MIDI "kan sync inconsistent voelen".
  **[zeker]** (zelfde help-pagina)
- **Wat er gebeurt als de master stopt.** De handleiding zegt het niet. Volgens het forum blijft de master master
  "until you stop playback and load another track onto that Deck". Daarna wordt het andere spelende deck met een
  open fader de master. **[forum]** Wat er dan met het tempo van de volger gebeurt: **niet gevonden**.
- Turn je sync uit, dan springt het tempo terug naar het oorspronkelijke. Dat doet de optie "Reset tempo when
  turning sync off". Gebruikers schrikken ervan. **[zeker]** (general) **[forum]** (22059, 22765)
- **Les voor v2.** v1 kiest de maatgever op de hardst klinkende track. Een ander neemt pas over met 3 dB verschil
  dat 250 ms aanhoudt, en een remmende track neemt nooit over (muziekkennis-068, -069). Het scherm laat de maatgever
  zien op de MAAT-badge. Dat is beter dan djay's verborgen master. In v2 hoort "wie stuurt de klok" altijd zichtbaar
  te zijn en met één druk vast te zetten (muziekkennis-083, optie c).

### 1.3 Aanraken: jog, scratch, nudge, cue, terugspringen
- **Wat djay doet.** Een jogwheel heeft drie MIDI-commando's:
  - de bovenkant (touch) = Scratch;
  - zonder touch = Scratch (no touch detection);
  - de zijkant = Pitch bend: "lets you nudge the track for beatmatching".

  **[zeker]** [jog wheels](https://help.algoriddim.com/user-manual/djay-pro-mac/midi/jog-wheels)
- De instelling "Resume sync after pause, scratch, or cue jump" ("Keeps sync active even after playback is stopped
  or adjusted") heette eerder "Turn off / Exit sync on pause, scratch, or cue jump". **[zeker]** (general)
  **[forum]** (22765). In 5.0 bestond die schakelaar alleen in de modus BPM + Beats. **[forum]**
- **Pitch bend (de zijkant) haalt sync eraf.** Moderator Slak_Jaw op 4 jan 2024: "it is normal behaviour for sync
  to turn off during pitch bending". De oplossing van een gebruiker was de zijkant op "Scratch (no touch detection)"
  zetten. Dan blijft sync aan, "but pitch bending no longer works". **[forum]**
  [exit sync](https://community.algoriddim.com/t/exit-sync-on-pause-scratch-or-cue-jump-setting-not-respected/22833?page=2)
- In 5.0.x en 5.1 ging sync er volgens gebruikers af bij aanraken, bij terugspringen ("Sync still turns off for me
  whenever I navigate backwards") en in DVS-REL-modus, ook met de instelling uit. Een beatjump vooruit hield sync
  aan, een beatjump terug haalde hem eraf. **[forum, dec 2023 – jan 2024]**
  [22833](https://community.algoriddim.com/t/exit-sync-on-pause-scratch-or-cue-jump-setting-not-respected/22833)
- Met BPM Only en een nummer met wisselend tempo: zolang je niets aanraakt "syncs just perfectly". Na een pitch bend
  loopt hij uit de pas terwijl het scherm 140 bpm blijft tonen. Staff: "expected behavior when using Sync Type: BPM
  Only … a limitation with how the current Fluid Beatgrid system works". **[forum, mrt 2024]**
  [variable bpm](https://community.algoriddim.com/t/how-to-bpm-only-sync-with-variable-bpm-songs/25160)
- Release notes: 5.3 "Improved sync when scratching", 5.6.3 "Sync on motorized controllers slightly off at track
  start", 5.6.9 betere cue-sprongen tijdens het scratchen op gemotoriseerde platen. **[zeker]**
  [iOS release notes](https://www.algoriddim.com/djay-ios/releasenotes)
- Of sync na een nudge vanzelf terugkomt in fase: **niet gevonden**. Alles wijst op het omgekeerde. Een bend zet
  sync uit en je drukt opnieuw op SYNC. **[afgeleid]**
- **Les voor v2.** Clay: "de klok blijft lopen tot er iets is wat hem aanraakt, zoals de jogwheel". djay maakt van
  aanraken "sync uit", en de gebruiker moet het daarna zelf herstellen. v1 weet al dat bend, nudge en tempo drie
  verschillende dingen zijn (dj-workflow-039):
  - bend: alleen de bron draait sneller of trager, en bij loslaten is hij precies terug;
  - nudge: een sprong;
  - tempo: de encoder.

  Fase duwen telt op een cirkel, met een Duwer van 15 ms (bediening-089). In v2 is aanraken een tijdelijke afwijking
  ten opzichte van de klok: loslaten = terug in fase. Een blijvende correctie is een expliciete fase-offset die de
  klok onthoudt, en loskoppelen is een eigen, zichtbare handeling.

### 1.4 Tempo veranderen terwijl sync aan staat
- **Wat djay doet.** "While both synced tracks play, moving either tempo slider adjusts both tracks." **[zeker]**
  (how does sync work)
- De hardware-pitchfader beweegt niet mee met sync. Soft takeover plus een "ghost fader" op het scherm laten zien
  waar de hardwarefader staat. **[zeker]** (sync-pagina)
- De regel wisselde tussen versies:
  - 5.3.2 (21 mei 2025): "if sync is active, tempo changes on any deck will now synchronize";
  - 5.3.3 (30 jun 2025): "Reverted … changing the tempo of an inaudible deck no longer affects other synced decks".

  Daarnaast "Fixed sync sometimes not using closest halfed/doubled tempo". **[zeker]** (iOS release notes)
- **Les voor v2.** In v2 is dit één regel en geen versiekwestie. Het tempo zit op de KLOK. Een tempoknop op een deck
  dat vastzit aan de klok verzet de klok, of hij weigert met een melding. Een deck dat je niet hoort verzet de klok
  nooit. Dat komt overeen met de hysterese van muziekkennis-068. De tempo-encoder lineair over 0,5–2× houden
  (dj-workflow-039), en soft-takeover voor faders (bediening-011).

### 1.5 Loops, hotcues en sync
- **Wat djay doet.** Sinds 5.3 kunnen loops en beatjumps tot 128 tellen. In 5.3.1 kwam "Improved sync with
  polyrhythmic loop lengths", in 5.3.2 een fix voor een gekwantiseerde hotcue precies aan het eind van een loop.
  In 5.2.4 een fix voor "possible drift … when dynamically changing loop lengths of synced tracks". **[zeker]**
  ([iOS release notes](https://www.algoriddim.com/djay-ios/releasenotes),
  [5.2.4](https://www.digitaldjtips.com/?p=2788390))
- Er zijn bugmeldingen over drift binnen een loop:
  - Met een handmatige of bewaarde loop (niet met een auto-loop) loopt de track na 10–20 s weg van de Link-klok.
    Uit de loop gaan zet hem meteen terug. Gemeld in 5.2.6 en nog steeds in 5.2.8. **[forum, jan–feb 2025]**
    [33246](https://community.algoriddim.com/t/dynamic-beatgrid-drifts-from-global-clock-in-manual-or-saved-loops/33246)
  - "they fall out of sync" met een loop aan, in 5.2.9 en weer in 5.3. Volgens de melder werkt het in 5.3.1.
    **[forum, mrt–mei 2025]** [34228](https://community.algoriddim.com/t/tracks-lose-sync-when-looping/34228)
- **Les voor v2.** v1 houdt fasecorrectie binnen de loop (`seek binnenLoop`, dj-workflow-036). In een loop vouwt het
  terug wat je hoort, en wat er NA het rondgaan komt telt mee (muziekkennis-064). In v2 moet een loop in TELLEN van de
  klok gerekend worden, met de positie uit de audioklok (regel 3), zodat er niets is dat weg kan lopen. Toets dat zoals
  de gate-meting van 26 min (muziekkennis-072).

### 1.6 Ableton Link
- **Wat djay doet.** Link "syncs tempo, beatgrid, and phase" over het lokale netwerk. "The first app to start
  playback usually becomes the Master, but control can shift dynamically". djay doet alleen mee als:
  1. de modus Beat and Tempo Sync staat;
  2. SYNC aan staat;
  3. een deck hoorbaar speelt.

  "If a deck is silent or inactive, djay stays connected … but may stop sending tempo changes". Over het quantum
  (maat of tel): **niet gevonden**. **[zeker]**
  [Link met djay](https://help.algoriddim.com/topic/using-djay/using-ableton-link-with-djay)
- **Les voor v2.** djay heeft alleen een klok "buiten de decks" als je Link aanzet. In v2 is de maatklok de kern, en
  Link is daar hooguit een uitgang of ingang van. Houd de klok lopen zonder hoorbaar deck, zoals de PatroonSpeler in
  v1 het laatste tempo vasthoudt (muziekkennis-083).

### 1.7 Nummers zonder vaste beat
- **Wat djay doet.** Sinds 5.0 (6 dec 2023) is er de *Fluid Beatgrid*. Die "automatically detects and adjusts to
  varying tempo and rhythmic changes within a song", ook "interruption in the beat". Het motto: "the beatgrid follows
  the song—the song doesn't follow the beatgrid". djay kiest zelf tussen Dynamic en Straight. **[zeker]**
  ([persbericht](https://algoriddim.com/press_releases/447-algoriddim-unveils-djay-pro-5-with-next-generation-neural-mix-crossfader-fusion-and-fluid-beatgrid-),
  [beatgrids](https://help.algoriddim.com/user-manual/djay-pro-mac/dj-tools/beatgrids-bpm-sync/beatgrids))
- Sinds 5.2.4 (okt 2024) zijn er drie dingen bij gekomen: de instelling "tempo change detection: Automatic vs. Off
  (always use straight BPM)", tempowissels zichtbaar op de golfvorm, en "AI annotations" voor stukken met een ander
  tempo. **[zeker]** [5.2.4](https://www.digitaldjtips.com/?p=2788390)
- Er is geen aparte "no beat"- of "geen puls"-stand gevonden. **[niet gevonden]**
- Klachten:
  - Een vocale break zonder ritme in "No Diggity" (76,4 bpm) wordt gelezen als 109. "Sync then tries to hold …":
    hoorbaar versnellen en vertragen. De voorgestelde rem: negeer sync bij een sprong van meer dan 8%. Staff gaf het
    door aan de ontwikkelaars, maar er kwam geen fix in de thread. **[forum, dec 2024]**
    [32454](https://community.algoriddim.com/t/improved-handling-of-bpm-fluctuations-that-sound-terrible-because-of-the-fluid-beat-grid/32454)
  - Met sync aan versnelt en vertraagt een al uitgelijnde track zodra de fader open gaat ("snag"). De workaround
    Straight "made zero difference", en de melding staat open. **[forum, feb–mrt 2026]**
    [41608](https://community.algoriddim.com/t/sync-slippage-issue/41608)
- **Les voor v2.** djay's Fluid Grid volgt alles, ook wat geen tempo is, en sync volgt dan mee. v1 meet zekerheid en
  geeft altijd een reden (muziekkennis-013, -014). Op een onzeker stuk weigert v1 sync (muziekkennis-016). Clay's
  repertoire is vooral ambient, albums en lange mixen (richting-074). In v2 houdt de klok daarom zijn tempo vast door
  een onzeker of puls-loos stuk, en het nummer laat los in plaats van de klok mee te trekken.

---

## 2. Beatgrid en analyse
- **Analyse.** "When you load a track into a deck, djay automatically analyzes it". Het grid is een schatting uit BPM
  plus de eerste downbeat. De downbeat is een gele lijn. Over analyse vooraf of op de achtergrond zegt de Mac-handleiding
  niets. **[zeker]** (beatgrids) Na 5.2.4 kreeg elk nummer een nieuwe overall-BPM, maar "beat grids are unaffected".
  **[zeker]**
- **Bewerken.** De beatgrid-editor heeft vier delen. **[zeker]**
  [editor](https://help.algoriddim.com/user-manual/djay-pro-mac/dj-tools/beatgrids-bpm-sync/beatgrid-editor)
  - BPM: /2, ×2, intypen (dan "reanalyzes"), tappen met vinger, muis, toets of MIDI, Dynamic ↔ Straight, en Reset.
  - Downbeat: schuiven en dan *Set downbeat*. Dat geldt voor het hele nummer.
  - Anchor: punten bij tempodrift. Daartussen past djay het grid zelf aan.
  - Grid: het eerste maatbegin zetten, en het hele grid naar links of rechts.

  Verder: 5.4.2 kreeg MIDI-acties om het grid te verschuiven, 5.5 "Better beat-grid editing UI" en 5.3 cues die
  snappen naar de dichtstbijzijnde tel bij lang drukken. **[zeker]** (iOS release notes)
- **Zekerheid.** djay laat niet zien hoe zeker een grid is, en geeft geen reden voor twijfel. **[niet gevonden]**
- **Klachten.** Bewerkingen naar Straight springen soms vanzelf terug. Wisselen tussen Dynamic en Straight verschuift
  de uitlijning. **[forum]** (32454, [dynamic/straight](https://community.algoriddim.com/t/need-help-with-dynamic-straight-bpm-settings/26184))
  Een nummer van 128 bpm waarin kick en bekken van rol wisselen, wordt in het Dynamic-grid deels fout gelezen. Een anker
  op 128 gaf 117 en "would not accept 128". **[forum, mrt–apr 2026]**
  [41888](https://community.algoriddim.com/t/problem-with-dynamic-grid/41888)
- **Les voor v2.** De ankers van djay zijn wat v1 "vast (pin)" noemt. v1 doet meer: een geheel aantal tellen tussen de
  pins, een weigering met reden, en controle op de klappen (muziekkennis-033). Houd de maat-anker per stuk
  (muziekkennis-004) en maak de maatsoort ook per stuk (muziekkennis-046). djay zet de downbeat alleen voor het hele
  nummer.

---

## 3. Bediening en indeling
- **Schermindeling (Mac).** Bij View Modes kies je Two Decks (standaard), One Deck (voorbereiden), Automix, Four Decks
  (naast elkaar of 2×2) en Video. Per indeling stel je in: jog, vinyl of geen; golfvorm horizontaal of verticaal; en de
  positie. **[zeker]** [decks Mac](https://help.algoriddim.com/user-manual/djay-pro-mac/getting-started/decks)
- **iOS** heeft Starter ("the crossfader automatically tempo-blends"), Automix, Classic (draaitafels), Pro (jogwheels,
  scrollende golfvormen, performance tools), Looper, One Deck, 4 Decks en Video. **[zeker]**
  [decks iOS](https://help.algoriddim.com/user-manual/djay-ios/getting-started/decks)
  Sinds 5.4.3 zijn er MIDI-acties om een view mode te kiezen. **[zeker]**
- **Indeling per nummer of per situatie.** Alleen de view mode, met de hand of via MIDI. Een indeling of mapping die
  met het nummer meekomt: **niet gevonden**.
- **MIDI.** Ondersteunde controllers werken plug-and-play. Voor de rest is er een MIDI-configuratie met een tabel. Je
  beweegt een control en hij komt erin. Dan kies je Target (Deck 1–4, Mixer, Library, Sampler, Mic, General) en
  Action. De opties per control:
  - typen: Button, Fader/Knob, drie rotary-typen;
  - knopmodi: Default, Toggle, Hold;
  - Invert, Pickup mode, Speed en Reaction;
  - MIDI Out voor lampjes, met Value Min/Max als kleur.

  MIDI-mapping vraagt een PRO-abonnement. **[zeker]**
  [mapping](https://help.algoriddim.com/user-manual/djay-pro-mac/midi/mapping)
  Meer configuraties per controller kan: dupliceren en wisselen in een menu, "easy to switch setups on the fly". Eén
  control kan meer acties krijgen ("Duplicate Mapping for Control"). **[zeker]**
  ([multiple mappings](https://help.algoriddim.com/user-manual/djay-pro-mac/midi/multiple-mappings),
  [multiple actions](https://help.algoriddim.com/user-manual/djay-pro-mac/midi/multiple-actions))
  "djay Pro AI does not currently support modifiers in the MIDI mappings like in Traktor". Shift is de enige.
  **[forum, okt 2023]** (22059) Een bug in 5.2.4: er ontstond bij elke herverbinding een nieuwe configuratie.
  **[zeker]**
- **APC40 / grid-controllers.** Geen ingebouwde mapping voor de APC40. De APC40 mkII wordt gezien, maar je moet hem
  zelf leren. **[forum, ouder]**
  ([iPad APC40](https://community.algoriddim.com/t/connect-and-play-akai-apc-40-mk-2-with-djay-app-on-ipad/15867),
  [APC40 template](https://community.algoriddim.com/t/akia-apc40-template/8633))
  Neural Mix heeft een padmodus op ondersteunde controllers: de bovenste rij is de stand van de stem, de onderste rij is
  exclusief solo (5.3). **[zeker]**
- **Les voor v2.** djay heeft geen lagen of mapjes, alleen shift plus hele configuraties wisselen. v1 heeft mapjes met
  gluren, een verschil met de standaard per apparaat, learn dat de modus aanscherpt, en endless-ringen zonder overpakken
  (bediening-018, -021, -027, -012). Dat is rijker. Wat djay niet heeft en Clay wil: modules en een indeling per nummer
  (bediening-091, -092).

---

## 4. Produceren en live remixen
- **Neural Mix.** Stems in realtime, sinds 2020. Sinds 5.0 met de scheiding van AudioShake: "even run on mobile
  devices". **[zeker]** (persbericht) De handleiding noemt vocals, drums, bass en harmonics. In het overzicht staan als
  groepen Instrumental + Acapella of Percussive + Tonal, en los drums, harmonics en vocals. Per stem heb je een fader,
  solo en mute. *Mute FX* geeft een echostaart van 1, ¾ of ½ tel. In de Neural Mix-EQ is low = drums, mid = harmonics
  en high = vocals. **[zeker]**
  ([neural mix](https://help.algoriddim.com/user-manual/djay-pro-mac/neural-mix),
  [overview](https://help.algoriddim.com/user-manual/djay-pro-mac/neural-mix/overview))
  Neural Mix-crossfaders (5.3) laten je per stem mengen of wisselen tussen decks. **[zeker]**
  [crossfaders](https://help.algoriddim.com/user-manual/djay-pro-mac/neural-mix/crossfaders)
- **Sampler.** 8×2 pads met one-shots en een volume per sample. Je kunt kort opnemen van deck 1 of 2. De sequencer
  neemt een loop van 4 of 8 tellen op met de metronoom: "If a track is playing, the metronome syncs to its BPM", anders
  de eigen BPM. Er is een quantize-instelling, maar de waarden staan er niet bij. **[zeker]**
  ([sampler](https://help.algoriddim.com/user-manual/djay-pro-mac/dj-tools/performance-tools/sampler),
  [sequencer](https://help.algoriddim.com/user-manual/djay-pro-mac/dj-tools/performance-tools/sequencer))
- **Looper.** "eight synced channels" met korte loops uit genre-packs, een eigen BPM-instelling en een fader per kolom.
  Opnemen van de decks: **niet gevonden**. **[zeker]**
  [looper](https://help.algoriddim.com/user-manual/djay-pro-mac/dj-tools/performance-tools/looper)
  Een losse drumcomputer of stappensequencer voor instrumenten: **niet gevonden** (alleen de sampler-sequencer).
- **Crossfader FX / Crossfader Fusion.** Overgangen als presets met "smart behaviors and finely-tuned automation curves".
  Effecten: echo, filter, tremolo, sweep, riser en Neural Mix. Je kiest de lengte in maten. Met de Transition-knop doet
  djay de overgang zelf. *Tempo Blend* "will automatically sync them as you move the crossfader", maar hoe het tempo
  tijdens de fade loopt staat er niet bij. Crossfader FX "can override your selected Sync mode". Ze syncen altijd op de
  tel. In 5.3.3 was er een fix voor "always using 4 beat sync irrespective of beat sync interval". **[zeker]**
  ([crossfader fx](https://help.algoriddim.com/user-manual/djay-pro-mac/dj-tools/effects/crossfader-fx),
  release notes)
- **Automix.** "Powered by AI, Automix analyzes tracks and selects smooth transition points". Elk nummer heeft een
  entry- en exit-regio (witte lijnen) die je met de hand kunt verzetten. De instellingen:
  - stijl: Filter, Echo, Tremolo, Riser, Neural Mix …, en Automatic "picks transition types at random";
  - duur: maten, seconden of automatisch;
  - tempo: Automatic, Sync of Sync + Tempo Blend. Automatic houdt de BPM van het lopende nummer als de tempo's dicht
    bij elkaar liggen;
  - Mix Now: "the earliest suitable blend point";
  - een wachtrij uit een playlist, uit de hand of uit Matching Songs.

  Sinds 5.3 gebruikt Automix de Crossfader FX-overgangen, sinds 5.3.2 altijd op een sync-interval van 4 tellen.
  **[zeker]**
  ([automix](https://help.algoriddim.com/user-manual/djay-pro-mac/mixing-basics/automix),
  [using automix](https://help.algoriddim.com/user-manual/djay-pro-mac/mixing-basics/using-automix))
  In djay Pro 2 (2017) zocht hij intro en outro op energie en koos dan de stijl. Bij twee energieke stukken werd het een
  korte filter- of EQ-overgang. **[forum/pers, oud]** (zoekresultaten over
  [djay Pro 2](https://www.macrumors.com/2017/12/12/djay-pro-2-mac-launch/))
  Klacht: Automix begon soms 2 minuten te vroeg zonder end-cue. **[forum]**
  [15728](https://community.algoriddim.com/t/automix-starts-transition-too-soon/15728)
- **Video.** Video-decks met H.264/MPEG-4 tot 1080p30 (.mov, .m4v, .mp4). Overgangen: Blend, Luma, Cube, Swap, Grid,
  Mosaic, Push, Cut, Cut50 … Er zijn tekst- en beeldoverlays, een externe video-uitgang, en *Split Audio/Video* met twee
  crossfaders. **[zeker]** [videos](https://help.algoriddim.com/user-manual/djay-pro-mac/mixing-basics/videos)
- **Les voor v2.** v1 rekent stems vooraf met Demucs, en dat bewust (audio-kern-073, richting-011): realtime kan niet
  naast acht decks op de M1. djay's Mute FX op de tel is een kleine, goede vondst voor de stemknoppen. De auto-DJ van v1
  gaat verder dan Automix:
  - bewakers op grid, tempo en toon;
  - beatloos overvloeien als hoofdroute;
  - Clay neemt over wat hij aanraakt (dj-workflow-049).

  Dat houden. Het "random" van djay en de verborgen sync-override van Crossfader FX vermijden.

---

## 5. Bekende klachten en grenzen (samengevat)

| Onderwerp | Klacht | Bron |
|---|---|---|
| Master | Niet zichtbaar, wisselt automatisch met de crossfader, uitzetten kan niet | [22059](https://community.algoriddim.com/t/understanding-sync-sync-master-tempo-reset-win-dvs/22059) [forum] |
| Aanraken | Pitch bend zet sync uit (moderator: normaal); de instelling werkt per versie en modus anders | [22833](https://community.algoriddim.com/t/exit-sync-on-pause-scratch-or-cue-jump-setting-not-respected/22833?page=2) [forum] |
| Sync-soorten | "BPM Only" vergrendelt sinds 5.0 toch; sync uit = tempo springt terug | [22765](https://community.algoriddim.com/t/sync-mode-bpm-only-locks-synced-tracks-together/22765) [forum] |
| Tempo bij sync | Regel omgedraaid tussen 5.3.2 en 5.3.3 | [release notes](https://www.algoriddim.com/djay-ios/releasenotes) [zeker] |
| Loops | Drift in handmatige loops tegen de Link-klok; terug bij uit de loop | [33246](https://community.algoriddim.com/t/dynamic-beatgrid-drifts-from-global-clock-in-manual-or-saved-loops/33246), [34228](https://community.algoriddim.com/t/tracks-lose-sync-when-looping/34228) [forum] |
| Fluid Grid | Een break zonder ritme = een ander tempo, en sync trekt mee | [32454](https://community.algoriddim.com/t/improved-handling-of-bpm-fluctuations-that-sound-terrible-because-of-the-fluid-beat-grid/32454) [forum] |
| Grid bewerken | Straight springt terug; een anker neemt het juiste tempo niet aan | 32454, [41888](https://community.algoriddim.com/t/problem-with-dynamic-grid/41888) [forum] |
| Mapping | Geen modifiers behalve shift; bij elke herverbinding een nieuwe configuratie (fix 5.2.4) | 22059 [forum], [5.2.4](https://www.digitaldjtips.com/?p=2788390) [zeker] |
| Stabiliteit | Dagelijkse crashes met verloren playlists (5.2.9, M3); stopt na 2–3 uur spelen; crash bij "Related" (5.5.1) | [34122](https://community.algoriddim.com/t/playlists-disappearing-after-crash-on-mb-pro-m3/34122), [27753](https://community.algoriddim.com/t/djay-pro-crash-after-hours-of-playing/27753), [39804](https://community.algoriddim.com/t/crash-when-adding-songs-to-the-related-menu/39804) [forum] |

Patroon **[afgeleid]**: sync en het grid zijn in djay een stapel uitzonderingen. Er zijn instellingen per
handeling, per sync-soort, per controllertype (DVS, gemotoriseerd) en per Crossfader FX, en de regels veranderen
per versie. Staff antwoordt bijna altijd "passed to engineering" of "switch to Straight".

---

## Waar Varve het beter kan doen

| djay doet X | Nadeel Y | Varve v2 doet Z | Kaartje |
|---|---|---|---|
| De master kiest zichzelf, onzichtbaar, en wisselt met de crossfader | Je weet niet wie de maat geeft; EQ-mixers worden verrast | Eén maatklok. Wie hem stuurt staat altijd op het scherm en is met één druk vast te zetten; een overname alleen met hysterese (3 dB, 250 ms) | muziekkennis-068, -082, -083 |
| Een pitch bend op de jog zet sync uit; opnieuw syncen doe je zelf | Precies het moment van bijsturen breekt de koppeling | Aanraken = een tijdelijke afwijking van de klok: loslaten = terug in fase. Blijvend = een expliciete fase-offset die de klok onthoudt | dj-workflow-039, bediening-089 |
| Twee sync-soorten plus schakelaars per handeling ("resume after scratch/cue", "reset tempo") die per versie anders werken | Onvoorspelbaar; regressies in 5.0–5.1 en 5.3.2/5.3.3 | Eén begrip "vast aan de klok", met één regel per handeling, vastgelegd in de action-meta en getoetst | muziekkennis-070, -074 |
| Een tempoknop op een gesynct deck verzet alles, of niet (wisselde per versie) | Een stil deck kon het tempo van de zaal verzetten | Tempo zit op de klok; een deck dat je niet hoort verzet hem nooit | muziekkennis-068, dj-workflow-039 |
| Het Fluid Grid volgt elke fluctuatie, ook een break; sync trekt mee | Hoorbaar versnellen en vertragen in ritmeloze stukken | Zekerheid per stuk met een reden; in een onzeker of puls-loos stuk houdt de klok zijn tempo en laat het nummer los | muziekkennis-013, -014, -016, richting-074 |
| Een klok buiten de decks bestaat alleen via Ableton Link | Patronen, sampler en beeld hebben geen eigen tijd zonder een deck | De klok is de kern en loopt ook zonder hoorbaar deck door (het laatste tempo vasthouden); Link is een uitgang of ingang | muziekkennis-082, -083, -072 |
| Een loop kan uit de pas lopen tegen de klok (open bug) | Drift precies wanneer je een loop gebruikt | Loops in tellen van de klok, positie uit de audioklok; afnemers abonneren zich op de klok (geen heranker te missen) | muziekkennis-064, -072, dj-workflow-036 |
| Grid bewerken: downbeat voor het hele nummer, ankers zonder controle | Stil fout bij tempowissel of een verschoven "1" | Een maat-anker per stuk, pin met een geheel aantal tellen en een weigering met reden, controle met het oor | muziekkennis-004, -033, -036, -038 |
| Geen zekerheid of twijfelreden op het scherm | Je merkt een fout grid pas in de mix | ✓ / ? / – / ⚠ N ms naast de bpm, een zekerheidsstrook onder de golfvorm | muziekkennis-014 |
| MIDI: alleen shift, hele configuraties wisselen, geen indeling per nummer; geen APC-mapping | Weinig lagen; elk nummer onder dezelfde knoppen | Mapjes met gluren, een eigen verschil met de standaard, modules en een indeling per nummer | bediening-018, -021, -091, -092 |
| Crossfader FX en Tempo Blend overrulen de sync-keuze stilletjes | "Waarom verandert mijn tempo?" | Een overgang is een bron van actions op de bus, zichtbaar in het log; wat Clay aanraakt is van hem | dj-workflow-045, -049 |
| Automix kiest de overgangsstijl "at random" | Geen reden te zien, slecht voor ambient | Bewakers (grid, tempo, toon) kiezen de soort; beatloos overvloeien is een volwaardige route | dj-workflow-056, richting-013, -074 |
