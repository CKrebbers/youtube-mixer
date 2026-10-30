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
- [ ] W3 als test, beeldbronnen als patch-doel

## F5 · Tijd (W4)
- [ ] Crossfader = scrubben door het handelingenlog (`engine/log.js`) tot −10 min, met de takes als bron
- [ ] SHIFT in Thuis: 40 cellen = 10 minuten tijdlijn

## F6 · Later
- [ ] Bedienplan-blauwdruk importeren als indeling
- [ ] Maschine-schermen als etiket per ruimte (nu toont hij de opstelling)
- [ ] Ideeën die Clay op "erin" zet (levend grid, morph-faders, encoders met fysica, …)
