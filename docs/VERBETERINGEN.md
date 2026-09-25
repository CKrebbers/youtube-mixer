# Verbeterlijst (23 september 2026)

Uit vijf reviewagenten, elk op een eigen gebied: audio-engine, controllaag +
APC, scherm, server + library, video + opname + docs. "Bewezen" = met een test,
meting of proef aangetoond; "vermoeden" = uit de code afgeleid.
Al opgelost: de gewiste spiegel-CSS (9afd29c). Ronde 1 en 2 zijn gedaan
(23 sep, 20:15–20:33); ronde 3 is op 25 sep grotendeels gebouwd (Clay 24 sep
avond: "zoveel mogelijk met agenten"). Ronde 4 = wat de controleurs van 25 sep
vonden en bewust niet herstelden.

## Ronde 1 — live-veiligheid, klein werk, geen keuzes nodig
| # | Wat | Waar | Status |
|---|---|---|---|
| 1 | Hotcue/seek tijdens een loop landt ín de loop (bewezen) | engine/deck.js seek, hotcue | gedaan (d509ed3) |
| 2 | Gate loopt uit de maat: ~1/16 na 26 min (bewezen) | engine/fx.js maakBuffer | gedaan (d509ed3) |
| 3 | Sampler-pads lopen op dezelfde manier weg (bewezen) | engine/sampler.js | gedaan (d509ed3) |
| 4 | Tempo-encoder na sync buiten bereik: één tik = 11% tempoval (bewezen) | control/actions.js pitch | gedaan (7555b8a) |
| 5 | APC opnieuw aansluiten: geen nieuwe init, shift kan blijven hangen (bewezen in nagebouwde hub) | control/midi.js, mapping.js | gedaan (7555b8a) |
| 6 | Cmd+toets bedient decks; toets kan blijven hangen (bewezen) | control/keyboard.js | gedaan (7555b8a) |
| 7 | Server: pad-uitstapje leest library.db en .git (bewezen met curl) | server/index.js statisch | gedaan (d2f6844) |
| 8 | Server: CSRF-rem te omzeilen, geen Host-controle (bewezen) | server/index.js | gedaan (d2f6844) |
| 9 | Ingest/analyse blokkeert de server ~9 s per album → gaten in spelende decks (gemeten) | server/analyze.js, detect.js | gedaan (d2f6844) |
| 10 | Opname: stukken niet idempotent (dubbel of gat → WAV/MP4 scheef), sluit() niet uitgelijnd (bewezen uit code) | opname/opnemer.js, server/opname.js | gedaan (0b28833 + d2f6844) |
| 11 | Loop-LED liegt na halveren/verdubbelen; mislukte laad wist cues; loop vanaf 0 s dipt | engine/deck.js, stream-kern.js | gedaan (d509ed3) |
| 12 | Docs verouderd (HANDOFF, ROADMAP-fasetabel, APC40.md 0x41, VRAGEN B1/B3) | docs | gedaan (docs bijgewerkt na ronde 2, nog niet gecommit) |

## Ronde 2 — scherm en bediening (gedaan)
- [x] Op 1440×900 verdwijnen de banen achter de kolommen (gemeten). — c2d580f
- [x] Resterende tijd en BPM per kolom, groot genoeg voor de zaal; labels ≥ 11 px (was 7–9 px). — c2d580f
- [x] Crossfaderkant dubbel en verwarrend op scherm én APC → A|B-knop = kant met
  tweekleurige LED (geel A, oranje B, uit thru), cue achter shift. — 5e297f4, c2d580f
- [x] LED's: halve standen (gevuld vs spelend), shift-laag zichtbaar, On/Off omgekeerd,
  B4-kleuren, B2 knipperen op de tel zelf rekenen. — 5e297f4. Afwijking: "gedimd" werd
  index n+1 (de donkere #59xxxx-tint, niet de pastels), niet n+2 zoals voorgesteld.
- [x] Soft-takeover: modus "endless" voor de 16 ringknoppen (waarde + verschil). — 5e297f4
- [x] MAAT op een stilstaande track "(stil)"; één kleursysteem voor hotcues (geel met
  nummer); fouten-meldingen blijven staan. — c2d580f
- [x] Twee mixer-tabbladen tegelijk bewaken (navigator.locks, `tabblad.js`). — c2d580f.
  Aanleiding werd ernstiger: Chrome crashte om 20:27 in de MIDI-dienst met vier tabbladen open.
- [x] Renderloop: focusoverzicht cachen, alleen verversen wat verandert. — c2d580f
- Niet in ronde 2, blijft staan: echofilter voor de APC staat nog aan (per apparaat uit te
  zetten sinds 5e297f4, eerst meten); zie ronde 3.

## Ronde 3 — functies (25 sep grotendeels gebouwd)
- Library: ~~voorbij 200 nummers, sorteren op bpm/duur/laatst gespeeld, hotcues per nummer
  bewaren~~ — gedaan 25 sep (`docs/LIBRARY.md`, ROADMAP 21); later tags/crates. ~~Tap-verfijning
  lokaal rond de tap~~ — gedaan (d2f6844, ±45 s rond de positie).
- Engine: ~~beatjump, quantize voor hotcues, hysterese op "wie de maat geeft"~~ — gedaan 25 sep
  (ROADMAP 16, CLAUDE.md TRANSPORT en Sync); sync-lock nog niet.
- Vrije APC-knoppen: ~~Lock = dub-worp (echo vol), Detail View = galm vasthouden, Bank ◀▶ = loop
  ½/×2 (shift: beatjump), Pan/Sends/User = lagen voor de track knobs (filter / echo / low), Bank =
  pitchbereik~~ — vervangen door voorstel A (Clay 25 sep): grid-modus 5 "klank" per kolom (rij 1–3
  kill hoog/mid/laag vasthouden, rij 4 rem, rij 5 op de maat starten); rechts voor de focus-track
  Bank ◀ ▶ = beatjump (shift = lengte ½/×2), Pan/Sends/User = loop in/out/reloop, Lock = quantize,
  Stop All Clips = rem; shift + nummer in het 2×2-blok = op de maat starten. Keylock krijgt later
  Bank. Dub-worp en galm vasthouden hebben nog geen plek.
  <!-- TODO hoofdsessie: voorstel A gebouwd? commit of branch erbij. -->
- Video: ~~mengen naar het losse venster~~ — gedaan 25 sep (`docs/BEAMER.md`); ~~beeldverhouding~~
  — gedaan 24 sep (`passen.js`); ~~requestVideoFrameCallback~~ — gemeten en NIET gebruikt (25 sep,
  `docs/BEAMER.md`); ~~foutmelding bij ontbrekende video~~ — gedaan 25 sep (`video/fouten.js`).
- ~~Audio-thread: renderBlok zonder allocaties per frame (voor 8 decks tegelijk).~~ — gedaan 25 sep
  (`docs/AUDIOPAD.md`, ROADMAP 22).
- ~~Ingest: voortgang zichtbaar, wachtrij, playlist-URL weigeren, dubbele download herkennen.~~ —
  gedaan 25 sep (ROADMAP 21), plus livestreams weigeren en "opnieuw" na een serverherstart.
- ~~Opname > 6,2 uur (RF64).~~ — gedaan (0b28833); afspelen van zo'n bestand in de browser is niet getest.
- ~~Koppelen: eigen mapping als verschil t.o.v. de standaard bewaren.~~ — gedaan 25 sep
  (`docs/MAPPING-VERSCHIL.md`, ROADMAP 13).
- APC-echofilter uitzetten als `hub.status().echoes` na een sessie in 0x42 nog 0 is (meten, geen keuze).
- `PALETTE_HEX` aanvullen van 60 naar 128 kleuren.

## Ronde 4 — open uit de controles van 25 sep (klein, bewust niet hersteld)
- Toonsoort: hetzelfde nummer op twee tracks; na een correctie op de ene houdt de andere de oude
  kaart en post die bij zijn volgende bewerking terug (het grid heeft hetzelfde patroon).
- Library: een lege hotcue indrukken in de tientallen ms tussen laden en terugzetten overschrijft
  de bewaarde; een mislukte tweede laad terwijl de eerste nog op de golfvorm wacht.
- Mapping: code van vóór 25 sep leest een verschil als volledige mapping (bescherming: eigen regels
  in een apart veld, `rules: []` houden); een oud exportbestand importeren markeert nieuwe
  standaardregels als weggehaald.
- Transport en klank: tussen stilstand en de pauze-timer telt een track nog als remmend; de
  terugval van `syncMaster` kan een remmende track zijn; gate zonder maat (5 ms) en de declick van
  de BufferBron (4 ms) staan nog op nu (zie de hellingen-regel in CLAUDE.md).
- Handelingenlog: korte stilte bij de start van terugspelen op streamende tracks (wacht niet op de
  pagina's); vormlagen staan niet in de beginstand.
- Vormen: na een pauze kort na een klap flitst die klap bij hervatten (maatbron `maatklap`).
- Ingest: een upload die LOOPT als de server wegvalt staat niet in de herstartrij.
- Audiopad: het stabiele venster van `renderblok.test.mjs` dekt niet elk pad (exact, gat,
  overgang alleen in het venster met berichten).
- Beatgrid: "zeker" zegt niet dat het grid past, ook buiten de tweede kans (docs/BEATGRID.md).
  <!-- TODO hoofdsessie: grid-past (eenGridPast op elk stuk) en beamer-inloop hier afvinken of aanvullen. -->
