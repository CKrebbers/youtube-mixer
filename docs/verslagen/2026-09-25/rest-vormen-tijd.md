# Vormtests: tijdchecks robuust onder load (spoor3/vormen-tijd)

Branch `spoor3/vormen-tijd` (van `spoor2/vormen`), één commit:
`d0d1f95` Vormtests meten rekentijd in threadtijd: geen rood meer door de planner.
Alleen `test/vormen.test.mjs`, `test/vormen-zwaar.test.mjs`, `test/vormen-meer.test.mjs`,
`test/vormen-isomorf.test.mjs`. Niets in src/, geen docs, niet gemerged, niet gepusht.

## Wat er mis was (gemeten, M1 MacBook Air, 8 kernen: 4 P + 4 E)

Harnas per stap (26 systemen, 3-4 runs van 180 stappen), drie klokken naast elkaar:

| conditie | wandklok max | procestijd max | threadtijd max |
|---|---|---|---|
| load ~7 | ≤ 6,5 ms | tot 16,9 | ≤ 6,2 |
| 32 draaiende lussen | 80–330 ms (gs gem 22, p95 78) | tot 27 | ≤ 8,6 |
| alleen E-kernen (`taskpolicy -b`) | tot 284 | tot 37 | gs 16,1, ln 15,3 |

- Wandklok: onder load telt de planner mee. Ook het minimum per stapnummer over drie
  runs bleef 30–51 ms. p95 in wandtijd was 58–79 ms. p95 en herhalen op de wandklok
  helpen dus niet.
- `process.cpuUsage` (proces): telt de GC- en compilerdraden mee, tot 27 ms. Daarom
  gebruikten zwaar/vormen `min(wand, proces)`.
- `process.threadCpuUsage` (alleen onze draad): planner en andere draden vallen weg.
  Resolutie 1 µs, 1,7 µs per aanroep. Volgt bij een drukke lus de wandklok op ±0,2 ms.
  Wat blijft: onder load draaien we op een E-kern met koude cache. Dezelfde stap kost
  dan 2 à 3× zoveel CPU-tijd (fl mediaan 1,6 ms bij load 10, 3,2–4,6 bij load 250),
  en de fanloze Air klokt onder aanhoudende last terug.

Oude code onder dezelfde last (20 reken- + 12 geheugenlussen, load 93–149):
meer ROOD (ch, jl, ls, dl, wv, if; max 45–98 ms), isomorf ROOD (sn, tv, ep, dw;
max 79–159 ms). zwaar en vormen bleven groen: die gebruikten al `min(wand, proces)`.

## Keuze

**Threadtijd (optie c, de draadvariant) als klok, in alle vier de bestanden.**
Statistiek en drempels blijven gelijk: max < 16 ms per stap, mediaan < 4 ms voor de
lichte, en de verhoudingschecks (16/9 tekenaanroepen, W/H-rekentijd, kwaliteit 0,25
goedkoper) ongewijzigd, nu op dezelfde klok. Voor het werk van de stap is de check
even streng: GC op de hoofddraad telt mee. Threadtijd ≤ min(wand, proces), dus
alleen tijd die niet van de stap is valt weg.

Daarbij één regel voor wat threadtijd niet wegneemt (E-kern, koude cache): boven
het budget nog eens meten, hooguit drie keer, de beste run telt. Dat was er al in
drie vormen (zwaar 3×, meer 6×, vormen 3×, isomorf geen). Nu is het overal hetzelfde,
en het kost niets zolang het groen is. Het is per HELE run, niet per stapnummer: een
GC-pauze die elke run op een andere stap valt blijft zo zichtbaar. Een stap die echt te
duur is, is dat in elke run.

Bewust niet gekozen:
- **p95/percentiel:** verstopt een stap die ALTIJD traag is. wv stap 7 kost 2,5 ms bij
  een p95 van 0,2 ms. In het bewijs had gs een max van 27,9 ms bij een p99 van 5,2.
- **Referentieblok dat de drempel laat meeschalen:** ander rekenwerk vertraagt anders.
  Op alleen E-kernen werd fl 2,2× zo duur en een vast Float32-blok niet. Bij load 250
  werd fl 2,2× en het blok 1,3× zo duur. De drempel zou met het blok meeschalen, niet
  met de vorm, dus te ruim (verstopt een regressie) of te krap.

## Bewijs

1. **Groen onder zware last, nieuw.** 20 reken- + 12 geheugenlussen, load 100–294:
   2 rondes, 8/8 groen. Slechtste max: ln 8,1 ms, cl 6,5, gs 7,5, dl 6,3. Lichte
   mediaan hooguit 2,6 ms (fl, sf). Eerdere rondes: bij 24+16 lussen (load 98–201)
   4/4 groen met slechtste max 10,9; bij ambient load 21–35 4/4 groen.
   `node test/alles.mjs`: 29 bestanden, 2079 checks, alles groen (load 25–71).
2. **Rood bij echte vertraging.** Via `node --import traag.mjs` (scratchpad, niet in de
   repo). Dat wrapt `sys.step` met vast rekenwerk dat geijkt is op de snelste kern.
   - één stap per run (stap 100) +20 ms: gs, ch, tv → rood. Max 23–33 ms; gs p99 4,4–5,2.
   - elke stap +14/15/16 ms: ln, jl, sn → rood. sf +3 ms → mediaan 4,7 (rust) en
     7,3 (last) → rood.
   - in rust (load 10–35) én onder last (load 17–122): precies die systemen rood,
     alle andere groen. Ook jl's verhoudingscheck gaat rood, logisch want het extra
     werk overheerst.
   - "2× trager": ln ×2 (en cl ×3) bij load ~40 → max 19,4 (en 23,4) → rood. Let op:
     het is een BUDGETcheck. ln ×2 in rust (max ~6 → ~12) blijft groen, net als met
     de oude checks. Rood alleen als 16 ms overschreden wordt.

## Niet getest / open

- Echte rust (load < 2) kwam niet voor: er draaiden de hele tijd andere agenten
  (ffmpeg, load 10–250). "Rust" = load 7–10.
- Load 250 met alleen de lichte check: fl haalde in 3 van 12 losse metingen > 4 ms
  (4,05/4,23/4,59). Met best-of-3 is de kans op rood klein maar niet nul, want slechte
  momenten zijn in de tijd gecorreleerd. In het gevraagde bereik (25–78) kwam fl niet
  boven 3,5.
- Alleen E-kernen (background-QoS, of vermoedelijk Low Power Mode) maakt gs 4–5×
  duurder (max 16,1): dan kan zwaar/gs rood worden. Dat is een machine die echt 4×
  trager rekent, geen planner.
- werker.test.mjs niet aangeraakt (nep-klokken, buiten de opdracht).
- De informatieregel "één aanslag met sink kost X ms" in isomorf meet nog wandtijd
  (alleen console, geen check).

## Hulpmiddelen (scratchpad/bouw, niet in de repo)
`meet.mjs` (harnas 3 klokken), `licht.mjs` (lichte medianen + referentieblok),
`last.mjs` (reken-/geheugenlussen, stoppen vanzelf), `traag.mjs` (vertragen via
--import), `draai.mjs` (vier bestanden draaien), `proef.sh` + `proef.log` (het
lastbewijs), `oud/` (oude testversies, src/mappings als symlink).
