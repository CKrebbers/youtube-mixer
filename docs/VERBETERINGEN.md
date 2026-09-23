# Verbeterlijst (23 september 2026)

Uit vijf reviewagenten, elk op een eigen gebied: audio-engine, controllaag +
APC, scherm, server + library, video + opname + docs. "Bewezen" = met een test,
meting of proef aangetoond; "vermoeden" = uit de code afgeleid.
Al opgelost: de gewiste spiegel-CSS (9afd29c). Ronde 1 en 2 zijn gedaan
(23 sep, 20:15–20:33); ronde 3 wacht op Clay's keuzes.

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

## Ronde 3 — functies (eerst kiezen)
- Library: voorbij 200 nummers, sorteren op bpm/duur/laatst gespeeld, hotcues per nummer bewaren,
  later tags/crates. ~~Tap-verfijning lokaal rond de tap~~ — gedaan (d2f6844, ±45 s rond de positie).
- Engine: beatjump, quantize voor hotcues, sync-lock, hysterese op "wie de maat geeft".
- Vrije APC-knoppen: Lock = dub-worp (echo vol), Detail View = galm vasthouden, Bank ◀▶ = loop ½/×2
  (shift: beatjump), Pan/Sends/User = lagen voor de track knobs (filter / echo / low), Bank = pitchbereik.
- Video: mengen naar het losse venster (anders bevriest de beamer als het hoofdtabblad wegvalt),
  beeldverhouding, requestVideoFrameCallback, foutmelding bij ontbrekende video.
- Audio-thread: renderBlok zonder allocaties per frame (voor 8 decks tegelijk).
- Ingest: voortgang zichtbaar, wachtrij, playlist-URL weigeren, dubbele download herkennen.
- ~~Opname > 6,2 uur (RF64).~~ — gedaan (0b28833); afspelen van zo'n bestand in de browser is niet getest.
- Koppelen: eigen mapping als verschil t.o.v. de standaard bewaren.
- APC-echofilter uitzetten als `hub.status().echoes` na een sessie in 0x42 nog 0 is (meten, geen keuze).
- `PALETTE_HEX` aanvullen van 60 naar 128 kleuren.
