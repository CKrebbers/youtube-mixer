# Rapport plak 1 — gemeten tegen het budget

Stand van 19 oktober 2026, tak `claude/optimistic-carson-66kozr`. De grenzen en hun herkomst staan
in `BUDGET.md` en zijn vóór het meten vastgelegd. Geen enkele grens is achteraf ruimer gezet. Waar
een grens zelf de vraag is, staat dat bij **Beslissen**.

Gemeten in de cloud: Linux, headless Chromium 141, een nep-geluidskaart die per 10 ms een
callback geeft, en 4 gedeelde kernen. Wat alleen op de Mac kan (de Scarlett, de APC, djay, je
oren, je eigen library) staat in `MAC.md`, met per stap de opdracht.

## Overzicht

| # | Wat | Grens | Gemeten | Uitslag |
|---|---|---|---|---|
| M1 | Sync in het geluid | ≤ 1 ms | 0,25 ms (de meetresolutie), ook na een tempowissel en een jog; kliksporen intern max 0,23 ms (vast tempo) en 0,52 ms (zwervend tempo, 96 stukken) | **gehaald** |
| M2 | Klok op het scherm tegen de Scarlett | ≤ 16,7 ms | pagina en rekenwerk getoetst; headless weigert hij terecht (nep-microfoon: 17 van 38 klikken) | **op de Mac** |
| M3 | Handeling → geluid | ≤ 10 ms, spreiding ≤ 3 ms | mediaan 5,4 ms, spreiding 1,2 ms, p95 10,7 ms | **hier niet te meten** (zie onder) |
| M4 | Fout in de tel over 2 uur | ≤ 1 ms | 1,8·10⁻⁹ ms, ook met één tik per minuut | **gehaald** |
| M5 | Gemiste blokken | 0 per uur | 918 per uur, maar een kale oscillator zonder VarveDJ mist er hier 1110 | **hier niet te meten** (zie onder) |
| M6 | Geheugengroei | ≤ 20 MB per uur | 1,0 MB per uur (10 min, JS-heap) | **gehaald in de cloud**; 2 uur op de Mac |
| M7 | Geheugen per track | ≤ 50 MB, ook 31 min | +36 MB voor het hele proces, 7 MB in de audiothread (zonder streamen 357 MB) | **gehaald** (na de fix) |
| M8 | Herstel na verstoring | melding < 1 s, geen stilte | planner 65 s stil: 0 ms afwijking; motorfout: melding na 3 ms; context gepauzeerd: melding, terug bij de eerste handeling | **gehaald** (na de fix); de Scarlett eruit en de klep dicht op de Mac |
| M9 | Klikvrij (render) | ≤ 1,25× een gewone stap | 61 overgangen, grootste 1,17 | **gehaald** (na de fix) |
| M9 | Klikvrij (gehoor, ABX) | < 12 van 16 goed | vier paren klaar | **jij** |
| M10 | Herhaalbaar | zelfde hash | bit voor bit, ook zonder wachten | **gehaald** |
| M10 | Null-test tegen Chrome | ≤ −50 dB | −37,5 dB; onder 4 kHz −64 dB | **niet gehaald**, zie **Beslissen** |
| M11 | Modeltest | 0 schendingen in 10.000 | 0 in 10.000 (en in 40.000) | **gehaald** (na de fix) |
| M12 | Sync op jouw muziek | F ≥ 0,9, nooit "zeker maar fout" | gereedschap klaar en getoetst (gelijk aan mir_eval tot 3·10⁻¹⁶) | **jij** (tikken) |
| M13 | Tegen djay | even strak of strakker | kliksporen en pagina klaar; de interne nulmeting is gehaald | **op de Mac** |
| M14 | Schone machine | CI groen | run 9 groen op de laatste commit | **gehaald** |
| M15 | Een echte set | 2 uur, niets raars | — | **jij** |

## Wat er mis was, en wat ik heb hersteld

| Gevonden door | Wat | Hersteld | Bewijs |
|---|---|---|---|
| modeltest M11 | K1–K9: sync uit liet een geplande koppeling staan; nudge loslaten na sync uit deed niets; klok stoppen gooide; soft-takeover te ruim of te vroeg; starten op de maat legde de tel en niet de "1" op de klok (en schoof niet mee met een tempowissel); rate uit een numerieke afgeleide (10⁻⁹ tel weg); laden rekende met het grid van het vorige nummer; "klok naar dit nummer" gaf segmenten achteruit | `track.js`, `koppeling.js` (exacte rate), `grid.js`, `engine.js` | K1–K9 zijn gewone tests (`test/model.test.mjs`) |
| modeltest M11 (strikt, referentie = ontwerp) | K10–K18: randgevallen rond glijden, tempowissels in het grid en sprongen naar een onzeker stuk | `track.js` | 10.000 reeksen, 0 schendingen; K10–K18 zijn gewone tests |
| M4 | de horizon van het plan was te kort voor één tik per minuut (verborgen tabblad) | horizon 90 s, hooguit 60 segmenten | `test/model.test.mjs` (M4), `faal.mjs` (M8a) |
| M9 render | equal-power gaf op een sprong over hele tellen +3 dB (1,41×); een sprong op 80 Hz in tegenfase 1,78× | equal-gain; een sprong vloeit in 10 ms over, start en stop blijven 4 ms | `uitslag/klik.txt`: 61 van 61, grootste 1,17 |
| M9 render | laden over een spelende track liet ~5 ms van het NIEUWE nummer horen | volgde uit K8 (laden wist alles van het vorige) | `klik.mjs`, "laad over een spelende track": 1,07 |
| M7 | een nummer stond helemaal in het geheugen (357 MB voor 31 min) | streamen zoals v1: `audio/stroom.js`, Range-verzoeken, 30 s vooruit, het cuepunt vast; het overzicht uit v1's `peaks.bin` | `uitslag/faal.txt`; `test/stroom.test.mjs` (gestreamd = in het geheugen, bit voor bit) |
| M8 | een gepauzeerde context gaf geen melding, alleen de eerste klik zette hem aan; ongeldige segmenten verdwenen zonder melding | de engine bewaakt de context (melding met sleutel `audio`, de eerste handeling zet hem aan, hooguit 1×/s); de worklet meldt wat hij overslaat | `test/gezondheid.test.mjs`, `uitslag/faal.txt` |
| M3 | play wachtte 13 ms op een drempel die alleen voor hellingen nodig is | twee audioblokken vooruit (5,3 ms) | `uitslag/latentie.txt` |

## Hier niet te meten, en waarom

- **M5 (gemiste blokken).** De meting vergelijkt de audioklok met de wandklok
  (`getOutputTimestamp`). In de cloud mist een kale AudioContext met één oscillator er 1110 per uur
  (`uitslag/soak-cloud-10min-nul.json`), VarveDJ met vier tracks en een handeling per 2–5 s 918
  per uur (`soak-cloud-10min.json`). De audiothread zat nooit boven 34% van zijn tijd
  (renderCapacity, `teTraagMetingen: 0`). De gemiste blokken komen dus van de nep-geluidskaart die
  zijn CPU moet delen, niet van ons. Op de Mac is dit de echte meting: `soak.mjs 30` en `--nul`
  ernaast.
- **M3 (latentie).** De mediaan is 5,4 ms: de twee blokken die de engine vooruit plant. In ruim 1 op
  20 gevallen is het 10,7 ms. De nep-geluidskaart rendert per 480 frames (`baseLatency` 10,0 ms),
  dus een handeling valt soms net na een stuk dat al klaar was. Het segment gaat dan op zijn lijn in:
  de plek klopt, alleen het geluid begint een callback later. Op de Mac met 128 frames per callback
  hoort dit weg te zijn: `latentie.mjs 60`.

## Beslissen (jij)

1. **M10, de null-test.** De grens van −50 dB tegen Chromes eigen afspeler is niet te halen, en dat
   ligt aan Chrome. Chrome interpoleert lineair en zit zelf op −29 dB van een ideale
   (float64-sinc) referentie. Wij zitten met Hermite op −31 dB over de hele band, en onder 4 kHz
   op −82 tot −88 dB, waar Chrome op −64 dB blijft. Op de pad zonder hihat zitten beide onder
   −80 dB.
   - Bij een tempowissel naast een blokgrens blijft onze speler sample-exact. Chrome loopt dan 3,2
     samples achter, want hij past `playbackRate` maar één keer per blok aan.
   - **Voorstel:** M10 toetsen tegen de sinc-referentie, met ≤ −50 dB onder 4 kHz (gehaald: −82 dB).
     Wil je ook de hoge band strak, dan is de kleinste stap een polyfase-sinc in de kern (~25 M
     vermenigvuldigingen per seconde voor 8 tracks). Dat is een bouwstap, geen herstelling.
2. **De sprong duurt nu 10 ms in plaats van 4.** Dat is gemeten nodig voor een bas in tegenfase. Bij
   een sprong hoor je dus 10 ms het oude en het nieuwe tegelijk, met gelijke versterking. De ABX
   (paar "Sprong") zegt of je dat hoort.
3. **Twee keuzes in het referentiemodel**, waar het ontwerp zwijgt. De engine doet het nu zo:
   - een sprong van een gekoppelde track naar een onzeker stuk zet sync uit EN de pitchfader op het
     tempo van dat moment (K17);
   - nudge loslaten tijdens "klok naar dit nummer" koppelt meteen, niet pas aan het eind van het
     glijden (K11b).

## Geheugen, nauwkeuriger

- **M7:** de +36 MB is het RSS van alle Chrome-processen samen, vóór en na het laden. De audiothread
  zelf houdt 7,1 MB aan pagina's vast. De rest zijn netwerkbuffers en wat Chrome eromheen aanmaakt.
  Binnen de grens, maar op de Mac opnieuw te meten met acht tracks.
- **M6:** de soak meet de JS-heap na een GC (`Runtime.getHeapUsage`). Headless werkt
  `measureUserAgentSpecificMemory` niet, ook met `crossOriginIsolated`. De pagina's van de
  demonummers staan in de audiothread en tellen daar niet mee. Op de Mac is twee uur `soak.mjs` met
  `ps` ernaast de echte meting.

## Opnieuw draaien

```
cd v2/app && npm test                                # 152 tests, ook M4 en M11
node tools/proef-sync.mjs                            # M1 in Chrome
cd .. && node meting/latentie.mjs 60                 # M3
node meting/soak.mjs 30 [--nul] --uit <bestand>      # M5, M6 (--nul = zonder VarveDJ)
node meting/faal.mjs                                 # M7, M8 (maakt een tijdelijke library van 357 MB)
node meting/golden.mjs [--bewaar]                    # M10
node meting/klik.mjs                                 # M9 render
node meting/abx-maak.mjs                             # M9 ABX-paren (dan abx.html)
node meting/kliksporen.mjs && node meting/vergelijk-intern.mjs 90   # M13 nulmeting
node --test meting/*.test.mjs                        # het meetgereedschap zelf
```
De uitslagen van deze ronde staan in `uitslag/`.

## Volgende stap

Geen nieuwe functies voordat de rest van het budget op de Mac gehaald is. Volgorde in `MAC.md`:
1. loopback (M2);
2. latentie en soak met nulmeting (M3, M5, M6);
3. djay (M13);
4. ABX (M9);
5. tikken op je eigen muziek (M12);
6. de verstoringen die alleen daar kunnen (M8);
7. een set (M15).
