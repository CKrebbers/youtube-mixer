# Verbeterlijst (23 september 2026)

Uit vijf reviewagenten, elk op een eigen gebied: audio-engine, controllaag +
APC, scherm, server + library, video + opname + docs. "Bewezen" = met een test,
meting of proef aangetoond; "vermoeden" = uit de code afgeleid.
Al opgelost: de gewiste spiegel-CSS (9afd29c).

## Ronde 1 — live-veiligheid, klein werk, geen keuzes nodig
| # | Wat | Waar | Status |
|---|---|---|---|
| 1 | Hotcue/seek tijdens een loop landt ín de loop (bewezen) | engine/deck.js seek, hotcue | open |
| 2 | Gate loopt uit de maat: ~1/16 na 26 min (bewezen) | engine/fx.js maakBuffer | open |
| 3 | Sampler-pads lopen op dezelfde manier weg (bewezen) | engine/sampler.js | open |
| 4 | Tempo-encoder na sync buiten bereik: één tik = 11% tempoval (bewezen) | control/actions.js pitch | open |
| 5 | APC opnieuw aansluiten: geen nieuwe init, shift kan blijven hangen (bewezen in nagebouwde hub) | control/midi.js, mapping.js | open |
| 6 | Cmd+toets bedient decks; toets kan blijven hangen (bewezen) | control/keyboard.js | open |
| 7 | Server: pad-uitstapje leest library.db en .git (bewezen met curl) | server/index.js statisch | open |
| 8 | Server: CSRF-rem te omzeilen, geen Host-controle (bewezen) | server/index.js | open |
| 9 | Ingest/analyse blokkeert de server ~9 s per album → gaten in spelende decks (gemeten) | server/analyze.js, detect.js | open |
| 10 | Opname: stukken niet idempotent (dubbel of gat → WAV/MP4 scheef), sluit() niet uitgelijnd (bewezen uit code) | opname/opnemer.js, server/opname.js | open |
| 11 | Loop-LED liegt na halveren/verdubbelen; mislukte laad wist cues; loop vanaf 0 s dipt | engine/deck.js, stream-kern.js | open |
| 12 | Docs verouderd (HANDOFF, ROADMAP-fasetabel, APC40.md 0x41, VRAGEN B1/B3) | docs | open |

## Ronde 2 — scherm en bediening
- Op 1440×900 verdwijnen de banen achter de kolommen (gemeten).
- Resterende tijd en BPM per kolom, groot genoeg voor de zaal; labels ≥ 11 px (nu 7–9 px).
- Crossfaderkant dubbel en verwarrend op scherm én APC; voorstel: A|B-knop = kant met
  tweekleurige LED (geel A, oranje B, uit thru), cue achter shift.
- LED's: halve standen (gevuld vs spelend), shift-laag zichtbaar, On/Off omgekeerd, B4-kleuren
  (gedimd = index n+2), B2 knipperen op de tel zelf rekenen.
- Soft-takeover: modus "endless" voor de 16 ringknoppen (waarde + verschil) i.p.v. takeover.
- MAAT op een stilstaande track gedimd tonen; één kleursysteem voor hotcues; fouten-meldingen blijven staan.
- Twee mixer-tabbladen tegelijk bewaken (navigator.locks).
- Renderloop: focusoverzicht cachen, alleen verversen wat verandert.

## Ronde 3 — functies (eerst kiezen)
- Library: voorbij 200 nummers, sorteren op bpm/duur/laatst gespeeld, hotcues per nummer bewaren,
  later tags/crates. Tap-verfijning lokaal rond de tap (lange albums met tempowissels).
- Engine: beatjump, quantize voor hotcues, sync-lock, hysterese op "wie de maat geeft".
- Vrije APC-knoppen: Lock = dub-worp (echo vol), Detail View = galm vasthouden, Bank ◀▶ = loop ½/×2
  (shift: beatjump), Pan/Sends/User = lagen voor de track knobs (filter / echo / low), Bank = pitchbereik.
- Video: mengen naar het losse venster (anders bevriest de beamer als het hoofdtabblad wegvalt),
  beeldverhouding, requestVideoFrameCallback, foutmelding bij ontbrekende video.
- Audio-thread: renderBlok zonder allocaties per frame (voor 8 decks tegelijk).
- Ingest: voortgang zichtbaar, wachtrij, playlist-URL weigeren, dubbele download herkennen.
- Opname > 6,2 uur (RF64).
- Koppelen: eigen mapping als verschil t.o.v. de standaard bewaren.
