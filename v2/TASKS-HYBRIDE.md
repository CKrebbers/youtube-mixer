# Taken: Hybride

Zie HYBRIDE.md. Afvinken bij klaar, vondsten erbij.

## F0 · Inventaris
- [x] Hergebruiktabel (HYBRIDE.md), design.md, deze lijst, tak `claude/hybride`
- [ ] av-synth-harnas.html en av-synth-prototype.html vinden (staan niet op de pc of in de mac-spiegel; Mac offline; mogelijk alleen in claude.ai)

## F1 · Controllerlaag
- [x] APC40 in/uit met lampjes (v2 indeling + lampjes, modus 0x42 via de hub)
- [x] Maschine via de hub (HID), met lampjes en schermen (29 okt live)
- [ ] Clay: met de echte APC elke knop van de Hybride-indeling één keer proberen

## F2 · Grondwet (W1, W5)
- [x] Ankers, THUIS, ruimtes als lagen (één diep), kleurtaal, klankjes
- [x] W1 en W5 als test (`app/test/hybride.test.mjs`)
- [ ] Clay: W1 en W5 op de APC, ogen dicht

## F3 · Patch (W2)
- [x] Matrix van 5 bronnen × 8 doelen, sterkte op device-knop 1, snelheid op knop 2
- [x] W2 als test
- [ ] Clay: W2 op de APC, ogen dicht
- [ ] Meer bronnen uit het harnas: euclid, logistic, RMS van het geluid, de vinger (Maschine-druk)
- [ ] Krommen per cel (lin/inv/exp/log/quant/drempel/fold/slew)
- [ ] De gekozen cel zichtbaar maken zonder te kijken (nu alleen de ring en het etiket)

## F4 · Beeld (W3)
- [x] Basis: beeldknoppen op het grid, trackknoppen = beeldparameters
- [x] Hele kaart oranje, met de echte acties uit beeld/acties.js (test vergelijkt ze met de bron)
- [x] W3 als test
- [ ] Beeldbronnen als patch-doel

## F5 · Tijd (W4)
- [x] Crossfader = tijd (ring van momentopnames, 10 min; midden = nu) en W4 als test
- [ ] Ook de structuur terug (patronen, geladen nummers), als dat nodig blijkt
- [ ] SHIFT in Thuis: 40 cellen = 10 minuten tijdlijn

## F6 · Later
- [ ] Bedienplan-blauwdruk importeren als indeling
- [x] Maschine-schermen als etiket: de ruimte links, wat je vastpakt rechts (naam, waarde, bereik)
- [x] Hybride is de standaard als je hem kiest (een focuswissel zette de APC eerst terug naar de DJ-indeling)
- [ ] Schermen als oscilloscoop (de hub doet pixels: goedkoop)
- [ ] Ideeën die Clay op "erin" zet (levend grid, morph-faders, encoders met fysica, …)

## Check 2 nov (functiestop: alleen kijken, niets gebouwd)
Vraag: werken Waterschaal, Vormmachines en opname al vanaf de knoppen in Hybride?
- [x] Tests: 594 groen, 1 overgeslagen (`hub.test`: geen AV-app-hub in de sessie), 0 rood. Gedraaid op Node 22.23, niet op 26.8.2 (de Mac)
- [x] **Waterschaal**: ja. `schaal` is bron 2 en 7 van de klankrij (`BRON_INSTRUMENT` in `acties-hybride.js`); gedekt door `hybride.test`
- [x] **Vormmachines**: ja. Grid rij 2–3 (Thuis) en rij 3–5 (ruimte Beeld): vormlaag aan, kies laag 1/2, vorige/volgende vorm, meng; trackknoppen 1–6 = vormknoppen, dekking, reageert op/met
- [ ] **Opname (audio)**: alleen met de muis (● REC bovenin). In Hybride zit `opname` op geen enkele knop; de APC-RECORD-knop is vrij (in de DJ-indeling doet die knop `opname`). Maschine REC = take, geen audio. Besluit Clay nodig (functiestop): RECORD in Hybride op `opname`, zoals in DJ?
