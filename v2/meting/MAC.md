# Meten op de Mac — wat alleen jij kunt doen

Alles wat in de cloud kon, is gedaan (`RAPPORT.md`). Dit is de rest: je Scarlett, je APC, je
library, djay en je oren. Doe het overdag, niet op een speeldag, met Chrome en zonder dat v1 met
de APC open staat. Elke stap schrijft een uitslag die ik daarna in `RAPPORT.md` verwerk.

Eén keer vooraf:
```
cd ~/Desktop/"1. Projects/Youtube mixer"      # of waar de repo staat
git fetch origin claude/optimistic-carson-66kozr && git checkout claude/optimistic-carson-66kozr
node v2/meting/kliksporen.mjs                  # de kliksporen voor stap 3 (3 × 35 MB, niet in git)
node v2/meting/abx-maak.mjs                    # de ABX-paren voor stap 5 (8 × 0,75 MB, niet in git)
node v2/meting/server.mjs                      # laat dit draaien: http://localhost:8790
```

## 1. Loopback — M2 (10 min)
1. Kabel van **uitgang 1** van de Scarlett naar **ingang 1**. Gain ingang 1 rond 10 uur, **direct monitor UIT**, speakers zacht.
2. Open http://localhost:8790/meting/loopback.html, kies de Scarlett als ingang en uitgang, druk **Meten**.
3. Kopieer de uitslag naar `v2/meting/uitslag/loopback.json`. Doe het drie keer (ook eens met Chrome op de achtergrond).

Wat het zegt: de rondgang (uit → kabel → in) moet stabiel zijn (spreiding ≤ 1 ms), en wat de app
als uitgangsvertraging aftrekt moet daar binnen één beeld onder liggen.

## 2. Latentie en underruns — M3, M5, M6 (35 min)
```
node v2/meting/latentie.mjs 60                                           # M3, ~1 min
node v2/meting/soak.mjs 30 --uit v2/meting/uitslag/soak-mac.json          # M5 + M6, 30 min; speelt geluid
node v2/meting/soak.mjs 10 --nul --uit v2/meting/uitslag/soak-mac-nul.json  # nulmeting: een kale oscillator, zonder VarveDJ
node v2/meting/faal.mjs > v2/meting/uitslag/faal-mac.txt                   # M7 + M8a–c (tijdelijke library van 357 MB in /tmp)
```
Laat de Mac met rust tijdens de soak (geen andere zware apps). Wil je de echte grens: `soak.mjs 120`.
Mist de nulmeting óók blokken, dan ligt het aan de Mac of de geluidskaart, niet aan VarveDJ (in de
cloud: 1110 per uur zonder VarveDJ, 918 met).

## 3. Tegen djay — M13 (20 min)
1. Loopback zoals bij 1. Open http://localhost:8790/meting/vergelijk.html.
2. **djay**: laad `v2/meting/djay/a-124.wav` op deck 1 en `b-128.wav` op deck 2. Kijk of djay 124 en 128 zegt en de eerste tel op het eerste klikje zet. Deck 1 play, deck 2 **Sync**, play, crossfader in het midden. Druk **Neem djay op** (120 s).
3. **v2**: kies dezelfde uitgang en druk **Speel en neem v2 op**.
4. Herhaal 2 en 3 met spoor **c-zwerft** (een tempo dat zwerft zoals een live opname).
5. Kopieer de vier uitslagen naar `v2/meting/uitslag/vergelijk.json`.

## 4. Je eigen muziek — M12 (een avond, in delen)
Volg `LEESMIJ-TIKKEN.md`: 20–30 nummers die jij kiest, met de moeilijke erbij (ambient, live,
albums met tempowissels, nummers waar de "1" twijfelachtig is). Jij tikt de tellen; de meting
vergelijkt ze met het grid.

## 5. Luisteren — M9 (15 min)
http://localhost:8790/meting/abx.html met koptelefoon. Vier paren, elk 16 keer: hoor je de
overgang? Kopieer de uitslag naar `v2/meting/uitslag/abx.json`.

## 6. Verstoringen die alleen hier kunnen — M8 (5 min)
Open http://localhost:8780 (`node v2/app/server.mjs`), laad twee demonummers, sync, speel. Dan:
1. Trek de USB van de Scarlett eruit. Zie je binnen een seconde een melding? Speelt het geluid via de Mac door?
2. Steek hem terug. Komt het geluid terug op de Scarlett, en hoe?
3. Klep dicht, 1 minuut, klep open. Wat zie je, wat hoor je, wat moest je doen?
Schrijf het in een zin per stap in `v2/meting/uitslag/verstoring.md`.

## 7. Een echte set — M15
Twee uur spelen met v2 en tegelijk `node v2/meting/soak.mjs 120 --uit v2/meting/uitslag/set.json`
is te veel tegelijk; neem in plaats daarvan de set op (komt in plak 2) of draai na de set de soak
van 2 uur. Je oordeel in een paar zinnen in `v2/meting/uitslag/set.md`.

## 8. De APC40 en de indeling (plak 3, 20 min)
Open de mixer (`node v2/app/server.mjs`, http://localhost:8780) met de APC aangesloten, v1 dicht.
1. Gaan alle lampjes en ringen aan na het openen? Trek de USB eruit en steek hem terug: komen ze terug (de APC valt na een replug in 0x40; wij sturen dan opnieuw 0x42)?
2. Speel een kwartier en typ dan in de console `varveCtl.hub.status().echos`. Is dat 0, dan kaatst de APC niets terug en mag het echofilter uit.
3. Wissel van focus en draai meteen aan een device knob: springt de waarde, of draait hij door vanaf de ring?
4. Brandt Clip Stop (lus) als de lus aan staat?
5. De tempo-encoder en Cue Level: hoeveel tikken geeft een draai, en is 1/64 per tik voor de koptelefoon prettig?
6. In het donker: hotcues 1–4 (geel) tegen 5–8 (oranje), de klank-laag (magenta). Zie je het knipperen op de tel?
7. Hapert of crasht Chrome bij het openen (~141 berichten bij de init)?
8. De indeling onder je handen: rij 1 als bas weg per kolom, laag-EQ op device knob 4, het toetsenbord naast het scherm. Wat zit in de weg?
Schrijf het per punt in één zin in `v2/meting/uitslag/apc.md`.

## 9. De koptelefoon (plak 2, 15 min)
Maak in Audio-MIDI-instellingen een samengesteld apparaat: de Scarlett 2i2 eerst (zaal = 1/2), de
koptelefoonuitgang van de Mac daarna (3/4), en zet het als uitvoer. Open de mixer.
1. Staan KOP en CUE↔ZAAL bovenin, en een CUE-knop onder elke track? (Zonder vier kanalen zijn ze weg; dat hoort zo.)
2. Track met de fader dicht, CUE aan: hoor je hem in de koptelefoon en niet in de zaal?
3. CUE↔ZAAL in het midden met dezelfde track ook in de zaal: hoor je één geluid, of een kamfilter (holle klank)? De cue is 72 samples vertraagd zodat hij gelijk loopt met de limiter.
4. Zaal en koptelefoon verkeerd om? ⇄ en herladen.
Schrijf het in `uitslag/koptelefoon.md`.

## 10. Stems (plak 6, 15 min)
Laad een nummer dat in v1 gesplitst is (STEMS-kolom in v1).
1. Tabblad Track: staat de sectie STEMS er (ZANG, DRUMS, BAS, OVERIG, REST)?
2. KILL op de zang en weer terug, midden in een zin: tik of plof?
3. APC scene 4, per kolom pad 5–1 vasthouden: verdwijnt precies die stem zolang je drukt? Shift = vast.
4. Knip een sampler-pad terwijl de zang weg is: klinkt de pad zonder zang?
5. Acht decks met stems tegelijk (als je er zoveel hebt): hapert iets? (In de kern ~6% van een kern gemeten.)

## 11. Instrumenten, sampler en patronen (plak 5, 20 min)
1. Zet Drums op track 3 en speel met het toetsenbord of een MIDI-keyboard: hoe lang van toets tot geluid (doel < 15 ms)?
2. Klankschaal op een track terwijl een nummer met een toonsoort speelt: klinkt hij in de toon (ook na een tempowissel, zonder keylock schuift de toon mee)?
3. Patroon: plek 1, een kick op 1 5 9 13, starten. Valt hij op de "1" van wat speelt? Zet de klok op een ander tempo: blijft hij erop?
4. APC scene 5: start en wissel plekken per kolom; Stop All Clips stopt alles op de "1".
5. Hoe klinken Poly, FM, Drums en de Klankschaal naast echte nummers (alles staat op −14 LUFS; de pieken van Drums en Klankschaal gaan boven 0 dBFS, de limiter vangt ze)?

## 12. Beeld (plak 4, 20 min)
1. Laad een nummer met video, tabblad Beeld: loopt het beeld gelijk met wat je hoort (kick op een flits)? Na een sprong (hotcue): hoe snel weer in de pas?
2. `los venster`, sleep het naar het tweede scherm, dubbelklik voor volledig scherm. Zet daarna een ander tabblad vooraan in het hoofdvenster: loopt de beamer door?
3. ZWART, ZWART ▮ (vasthouden), BEVRIEZEN, FLITS: doet het doek wat de knop zegt, ook in het losse venster?
4. Een vormlaag aan op een avond met muziek: hoeveel ms en welke kwaliteit staat er naast de laag (budget 4 ms hoofdthread, 12 ms Worker, op de M1 nog niet gemeten)?
5. Met `PROEF_MAAT=1280x720 node v2/app/tools/proef-beeld.mjs`: haalt de upload op Metal ook in de p95 binnen één beeld?

## 13. De auto-DJ (plak 6, een half uur)
1. AUTO aan met je echte library. Klinkt de baswissel in het midden van een beatloze overgang goed (nieuw in v2)?
2. Een blend tussen twee zekere nummers: valt de nieuwe op de "1"?
3. Na een beatloze overgang naar een ander tempo zet de automaat de klok op het nieuwe nummer (`sync.klok`). Goed, of liever niet aan de klok komen?
4. Pak midden in een overgang een fader of de crossfader: laat hij los, en gaat hij daarna verder?
5. Het tabblad een poos op de achtergrond: loopt de overgang door?
Schrijf het in `uitslag/auto.md`.
