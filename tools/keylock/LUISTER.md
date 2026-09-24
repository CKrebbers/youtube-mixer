# Luisteren: keylock op je eigen muziek (VRAGEN A3)

Een kwartier, met koptelefoon. Dit is de luistertest die sinds fase 3 openstaat,
maar dan op je eigen nummers in plaats van de demo van Signalsmith. Wat eruit
komt beslist K1, K2 en K4 in `docs/KEYLOCK.md`.

De bestanden staan in `tools/keylock/uit/<nummer>/` (niet in git; opnieuw maken
met `node tools/keylock/proef.mjs luister`). Per map staat in `BRON.txt` welk
stuk het is. Alles staat **3 dB zachter** dan in de app, het origineel ook, zodat
ze onderling gelijk zijn en niets clipt (keylock maakt de pieken tot 3,6 dB
hoger, bij zang het meest).

| map | wat | waarom dit stuk |
|---|---|---|
| `sakamoto/` | piano, vanaf 300 s in de Sakamoto-playlist | aangehouden polyfone klanken: daar warbelt een slechte stretcher |
| `zoned-out/` | ambient, vanaf 100 s | pads en drones: fasen en "zwemmen" hoor je hier het eerst |
| `adriana/` | het album, vanaf 340 s, plus een loop op 1160 s | aanslagen en ritme; het album waar LOOP_NAAD op gemeten is |
| `no-surprises/` | zang, vanaf 20 s | stemmen worden hol of robotachtig, zeker bij transponeren |

De stukken zijn gekozen op een scan van volume en aanslagen, niet op het gehoor.
Is er een saai: `node tools/keylock/proef.mjs luister sakamoto --van 900`.

## De bestanden

| nr | bestand | wat je hoort |
|---|---|---|
| 01 | `origineel` | het stuk zoals het is |
| 02–03 | `zoals-nu-0.92` / `1.08` | wat VARVE nu doet: tempo −8% / +8%, de toon schuift mee (±1,3 halve toon) |
| 04 | `keylock-1.00` | keylock aan, tempo niet veranderd: kleurt de stretcher zelf al? |
| 05–08 | `keylock-0.92` / `0.95` / `1.05` / `1.08` | tempo −8 / −5 / +5 / +8%, toon blijft staan |
| 09–12 | `toon-2` / `toon-1` / `toon+1` / `toon+2` | zelfde tempo, andere toonsoort (halve tonen) |
| 13 | `keylock-1.08-goedkoper` | als 08, maar de goedkopere instelling (100 ms blok, ~35% minder rekenwerk) |
| 14 | `keylock-1.08-kort` | als 08, met een kort blok (60 ms): minder vertraging bij springen, minder basdetail |
| 15–16 | `loop-4-tellen-zoals-nu-1.05` / `-keylock-1.05` | alleen adriana: een loop van 4 tellen op +5%, 20 s |
| 15–16 | `toon+2-formantbehoud` / `toon-2-formantbehoud` | alleen no-surprises: transponeren met behoud van de klankkleur van de stem |

Bestanden met hetzelfde tempo zijn even lang en beginnen op dezelfde plek, dus je
kunt ze in een speler naast elkaar zetten en heen en weer springen.

## Volgorde (15 minuten)

1. **01 tegen 04.** Hoor je verschil? Zo niet: keylock kan standaard aan zonder
   dat je iets verliest. Gemeten: de klankbalans per octaaf is exact gelijk
   (0,0 dB), maar de golf wordt opnieuw opgebouwd, dus bit-gelijk is hij niet.
2. **02/03 tegen 05/08.** De vraag van een DJ: wat is erger bij ±8%, de toon die
   schuift of wat de stretcher ermee doet? Doe dit op sakamoto en zoned-out.
3. **06 en 07 (±5%).** Het bereik dat je in een set echt gebruikt.
4. **09 t/m 12.** Transponeren. Eén halve toon is genoeg om twee nummers in
   dezelfde toonsoort te krijgen; twee is al veel.
5. **13 en 14 tegen 08.** Hoor je 13 (goedkoper) niet van 08 te onderscheiden,
   dan is dat de instelling (K2). 14 is er om te horen wat een kort blok kost.
6. **adriana 15 tegen 16.** Loopt de loop strak op de maat, en is de naad even
   onhoorbaar als nu?
7. **no-surprises 12 tegen 15** (en 09 tegen 16). Klinkt de stem minder als een
   kabouter (+2) of een reus (−2) met formantbehoud?

## Waar je op let

- **Warbelen / fasen.** Een waterig, zwemmend, chorusachtig randje op
  aangehouden akkoorden en pads. Het typische foutje van een phase vocoder, en
  de reden dat SoundTouch afviel. Sakamoto en zoned-out.
- **Aanslagen.** Pianohamers en drums: zachter, dubbel, of een klein
  voor-echo'tje. Adriana en de piano.
- **Zang.** Hol, metalig of robotachtig, vooral bij 09–12.
- **Bas.** Wordt het laag wolliger of vager? Bij 14 (kort blok) het eerst.
- **Stereobeeld.** Wordt het smaller, of gaat het zweven?
- **Loop.** Tikt de naad, of smeert de eerste tel uit?

## Scorekaart

Per nummer een cijfer: **0** niet te horen · **1** hoorbaar als je het zoekt ·
**2** stoort in een mix · **3** onbruikbaar.

| | 04 (1,00) | 06/07 (±5%) | 05/08 (±8%) | 10/11 (toon ±1) | 09/12 (toon ±2) | 13 goedkoper | 14 kort | loop / formant |
|---|---|---|---|---|---|---|---|---|
| sakamoto | | | | | | | | – |
| zoned-out | | | | | | | | – |
| adriana | | | | | | | | loop: |
| no-surprises | | | | | | | | formant: |

Vuistregel voor de beslissing: overal 0–1 bij ±5% = Signalsmith is het (K1).
Een 2 op sakamoto of zoned-out bij ±5% = eerst verder zoeken voordat er iets
gebouwd wordt.
