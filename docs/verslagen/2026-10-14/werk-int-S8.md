# Integratie S8 in werkruimte/integratie (14 okt 2026)

## Wat samengevoegd is

`origin/werk/S8` (tip d82e3b1) in `werkruimte/integratie` (was d097a3e). S8 begon op d097a3e, dus de merge
was een **fast-forward**, zonder conflicten: 42 bestanden, +3908 −70. Er zit dus geen eigen mergecommit tussen.
Wat S8 bouwde staat in `docs/verslagen/2026-10-14/werk-S8.md` en `docs/werkruimte/S8.md`:
- de schrijfweg voor iPad en iPhone (koppelcode, schakelaar, rem, loslaten bij wegvallen, VAST_NOOIT);
- de xy-pad op de iPhone;
- ✎ inrichten zonder JSON;
- de totaalmeting (`tools/headless/werk-alles.mjs`);
- de docs.

**Hersteld: niets.** Geen enkele test werd door S8 rood (zie hieronder).

Omgeving: Linux-container met 4 kernen, Node 22, headless Chromium 1194 (`headless_shell --no-sandbox`,
software-GL). yt-dlp en ffmpeg staan er hier wel (bij S8 ontbrak yt-dlp, daarom was ingest daar rood).

## De suite

`node test/alles.mjs`: 118 bestanden, 10.399 checks, 10 overgeslagen, **3 rood**. Alle drie zijn ook rood
op d097a3e. Dat is getoetst in een tijdelijke checkout (`git worktree add --detach … d097a3e`; daarna weer
weggehaald), met elke test los gedraaid:

| test | S8 (d82e3b1) | basis d097a3e | oorzaak |
|---|---|---|---|
| `wachtrij.test.mjs`: "yt-dlp en zijn kind zijn allebei weg, geen werkmap" (2×) | rood | rood (precies dezelfde 2) | omgeving: het kleinkind van de nep-yt-dlp leeft hier nog volgens `kill(pid, 0)` (aanname: de procesboom van deze container) |
| `renderblok.test.mjs`: "keylock met wissels" | rood (89,7 bytes per bericht) | rood (83,7 bytes per bericht) | omgeving: de afvalmeting van de WASM in deze Node/V8 |
| `instrumenten-fm-schaal.test.mjs`: "geen afval per blok" | in de suite rood, los 2 van 3 rood | los 1 van 1 groen, daarna 2 van 3 rood | omgeving: het wisselt per run op beide kanten (26–30 kB of 224 bytes, steeds 0 GC) |

Overgeslagen en gemeld: geen h264_videotoolbox (uitzend), geen `total_allocated_bytes` (analyse, video), geen
Stroommachine (beeld), geen av-app-hub (hub), beeld-lokaal alleen op macOS, en de p99 < 5 ms van de schrijfweg
op loopback (paneel-schrijf: p50 2,20, p99 7,20 ms; een gewone GET hier p50 0,99, p99 3,64 ms).

## Headless (`VARVE_CHROME=<wrapper met --no-sandbox>`, `VARVE_TMP` in de scratchpad)

Elke proefserver draait via `harnas()` uit werk-scherm.mjs, dus met `VARVE_TESTSERVER=1` en alle `VARVE_*`
in een tijdelijke map.

- `werk-scherm.mjs`: **36/36 groen**.
- `inrichten.mjs`: **15/15 groen**.
- `werk-ipad.mjs --duur 60`, twee runs:
  - Run 1 kwam uit op 40/42. De twee rode checks zijn de klokchecks van S7 ("gemiddeld over een reeks" en
    "met de eigen klok van de iPad"). Het maximum was 103 ms, met een mediaan van 1,4 ms.
  - Run 2 was **42/42 groen** (max 8,6 ms).
  - Op d097a3e faalden dezelfde twee checks ook (max 5,2 en 31,5 ms). Dat is dus de omgeving onder load,
    zoals S7.md §7 al zegt. S8 raakt dat pad niet.
  - METING iPhone → mixer (loopback, CDP-muis tot de action): p50 22,7–24,2 ms, p99 193–197 ms. De staart
    zit aan de kant van de pagina: muis → POST had een p99 van 183 ms, POST → action een p99 van 27 ms.
- `werk-alles.mjs --sec 8 --rondes 2`: **11/13**.
  - Groen: Δtaak / 60 = 1,12 ms per beeld; 0 lange taken; 0,00 Mpx/s in rust; de iPhone werd uitgevoerd
    (1036 × 200, 22 × 503 bij het wisselen, zoals S8 meldde).
  - Rood: "≤ 2 ms per beeld zonder mac-2, gemeten per beeld" (3,24 ms) en "LED-tik p99 ≤ nul + 10%"
    (3,02 tegen 2,51 ms).
  - Beelden per seconde: nul 59, alles zonder mac-2 48, alles 44 (bij S8: 33 / 23 / 20).
  - Dit is hetzelfde beeld als S8 in §2 rapporteerde: **het C6-budget is in deze omgeving niet aangetoond.**
    Het is geen regressie door het samenvoegen. Op de M1 met GPU meten (proef A).
- `werk-maschine.mjs`: **niet gedraaid**. Hij vraagt de AV-app-hub, en die staat niet in deze container.

## Latentie (`latentie.mjs`, één ronde per kant, standaard)

S8 is gemeten tegen d097a3e, met dezelfde Chrome en hetzelfde zaad, na elkaar. Waarden zijn p50 / p99:

| scenario | maat | d097a3e | S8 |
|---|---|---|---|
| fader | tot geluid gepland | 0,51 / 9,31 ms | **0,40** / 8,13 ms |
| fader | werk per bericht | 0,20 / 1,13 ms | 0,19 / 0,91 ms |
| fader | tot scherm | 11,4 / 18,7 ms | 11,2 / 18,7 ms |
| rust | stijl ms/s · taak ms/s | 29,1 · 413 | **30,8** · 435 |
| sweep | tot geluid | 0,88 / 12,3 ms | 0,71 / 10,1 ms |
| shift | stijl ms/s | 97,6 | 82,1 |
| mapje | stijl ms/s | 94,1 | 87,6 |
| alle | lange taken | 1 (mapje, 59 ms) | 0 |

**De winst van vandaag is heel.** Fader → geluid p50 0,40 ms, binnen de ~0,8 ms van vandaag. De stijl in rust
was 30,8 ms/s, dus binnen ~33 ms/s en binnen de 33–41 die S7 mat (S7: rust 38,0 → 38,5). Werk per bericht is
gelijk. Het verschil in de taak in rust (+5%) ligt binnen de ruis van één ronde in deze container.
