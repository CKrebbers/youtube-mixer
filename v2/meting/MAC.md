# Meten op de Mac — wat alleen jij kunt doen

Alles wat in de cloud kon, is gedaan (`RAPPORT.md`). Dit is de rest: je Scarlett, je APC, je
library, djay en je oren. Doe het overdag, niet op een speeldag, met Chrome en zonder dat v1 met
de APC open staat. Elke stap schrijft een uitslag die ik daarna in `RAPPORT.md` verwerk.

Eén keer vooraf:
```
cd ~/Desktop/"1. Projects/Youtube mixer"      # of waar de repo staat
git fetch origin claude/optimistic-carson-66kozr && git checkout claude/optimistic-carson-66kozr
node v2/meting/kliksporen.mjs                  # de kliksporen voor stap 3 (3 × 35 MB, niet in git)
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
```
Laat de Mac met rust tijdens de soak (geen andere zware apps). Wil je de echte grens: `soak.mjs 120`.

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
