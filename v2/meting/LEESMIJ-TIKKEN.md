# Tellen tikken (meetpunt M12)

Jij tikt de tellen en de "1" van 20–30 eigen nummers. Daarmee meet ik of het grid van VarveDJ klopt,
en of sync weigert waar het grid twijfelt. Jouw tikken zijn de waarheid. De pagina laat het grid van
VarveDJ bewust niet zien: anders tik je het grid na in plaats van de muziek.

## Wat je doet

1. **Start de tikserver** (v1 mag blijven draaien, de library wordt alleen gelezen):
   ```
   cd ~/Desktop/youtube-mixer        # of waar de repo staat
   node v2/meting/tik-server.mjs
   ```
   Open **http://localhost:8782** in Chrome. De library komt uit `~/.varve/media-pad` (VARVE.app zet
   die), anders `VARVE_MEDIA=<map>`. Niet tijdens een set: hij speelt via dezelfde uitgang.

2. **Kalibreer één keer**: druk **C** en tik met de spatie op elke klik, 16 keer. Bovenin staat dan
   bijvoorbeeld "kalibratie 48 ms (± 9 ms)". Dat gaat van elke tik af. Opnieuw doen als je een andere
   uitgang (koptelefoon, Scarlett) of een ander toetsenbord neemt.

3. **Kies 20–30 nummers** links (zoeken met **/**). Neem een mengeling: house en techno, breaks,
   live gespeeld (zonder klik), langzaam en snel, en ook nummers waar VarveDJ "?" zegt. Tik per nummer
   minstens een minuut; liever het hele nummer.

4. **Tik**: **Enter** speelt af. **Spatie** op elke tel, **Shift + spatie** op de "1" van elke maat.
   - Een stuk overslaan mag: stop gewoon met tikken. Wat je niet tikt, telt niet mee.
   - Fout getikt: **←** (5 s terug) en tik dat stuk opnieuw; de oude tikken daar worden vervangen.
   - Lastig nummer: **2** of **3** speelt langzamer (0,85× of 0,7×), **1** weer gewoon.

5. **Kijk in de golfvorm** of de streepjes op de klappen staan. "Snap bij tikken" staat aan: een tik
   schuift naar de klap binnen 30 ms (een vierkantje onderaan = gesnapt). Waar geen duidelijke klap is
   blijft hij staan waar je tikte. Bijstellen: klik op een tik en sleep, of **,** **.** (1 ms, Shift
   10 ms), **E** = wel/geen "1", **Del** = weg, dubbelklik = tik erbij, **Z** = ongedaan.

6. **Bewaar**: **D** zet `tikken-<nummer>.json` in je Downloads. Zet ze samen in één map, bijvoorbeeld
   `~/varve-tikken/`. Met **Shift + D** komt alles in één bestand. De browser onthoudt ze ook, maar dat
   is alleen een reserve (ander Chrome-profiel = weg).

7. **Meet** (de tikserver of de v2-server moet draaien):
   ```
   node v2/meting/grid-eval.mjs --tikken ~/varve-tikken --server http://localhost:8782 --json ~/varve-tikken/uitslag.json
   ```
   Onderaan staat **M12: GEHAALD** of **NIET GEHAALD**. Geef mij de map (met `uitslag.json`), dan
   kijk ik per nummer wat er mis is.

## Wat de uitslag zegt

Per stuk van het grid: mag sync daar (`syncBij`), en klopt het grid daar (F ≥ 0,9 bij ±70 ms, en ≥ 90%
van je "1"-en op een maatbegin van het grid).

| | |
|---|---|
| zeker en goed | sync mag en klopt |
| zeker maar fout | sync mag, maar klopt niet: **het ergste**, M12 eist 0 |
| onzeker en fout | terecht geweigerd |
| onzeker maar goed | onnodig geweigerd |

Daarnaast per nummer de gebruikelijke maten (F, Cemgil, P-score, Goto, CMLc/CMLt/AMLc/AMLt, zoals
mir_eval ze rekent; tellen in de eerste 5 s tellen niet mee), en een hint als het grid op een ander
niveau zit: "tegentel", "dubbel tempo", "half tempo", of "de getikte "1" valt op tel 3".

## Voor wie eraan werkt

```
node --test v2/meting/beat-eval.test.mjs     # de maten tegen mir_eval 0.8.2 (vastgelegd in beat-eval-mireval.json)
node --test v2/meting/grid-eval.test.mjs     # de CLI op een nep-server en op de echte v2-server
node --test v2/meting/tikken.test.mjs        # de pagina in echte Chrome (~40 s, Playwright globaal)
```
Met mir_eval op de machine (`VARVE_MIR_PY=<python>`) rekent beat-eval.test ook live na.
