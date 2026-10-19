# VarveDJ v2

Plak 1: de maatklok speelt. Acht tracks, sync die blijft, jog en nudge op de klok, de pitchfader
als klok-tempo, starten op de maat, kanaalstrip met EQ, kill, filter en limiter. Ontwerp en
besluiten: `../ontwerp/` en de planner; architectuur: `ARCHITECTUUR.md`.

## Starten (op de Mac)

```
cd v2/app
node server.mjs            # http://localhost:8780
```

Open in Chrome. De library van v1 wordt ALLEEN GELEZEN: `VARVE_MEDIA`, anders `~/.varve/media-pad`
(dat zet VARVE.app al), anders `../../media`. Zonder library zijn er vijf demonummers.
v1 (poort 8777) en v2 (poort 8780) kunnen naast elkaar draaien; open ze niet tegelijk met de APC
(nog geen MIDI in v2).

## Bediening (plak 1)

| | |
|---|---|
| laden | knop 1–8 achter een nummer, of slepen naar een track; over een spelende track: twee keer |
| ▶ | play/pauze; de eerste die start, start de klok op zijn tempo en zijn "1" |
| SYNC | gekoppeld aan de klok tot je het uitzet; weigert op een onzeker grid |
| KLOK | de klok neemt het tempo en de tel van dit nummer over |
| ▶1 | starten op de volgende "1" van de klok |
| jog | slepen = het nummer schuift t.o.v. de klok (Shift = fijn) |
| ‹ › | nudge: zolang je drukt 4% trager/sneller |
| PITCH | gekoppeld en hoorbaar: het tempo van de klok; anders de eigen pitch |
| −1 −.1 +.1 +1 TAP | het tempo van de klok |
| knoppen | slepen, scrollwiel, pijltjes; Shift = fijn; dubbelklik = midden |

## Toetsen

```
npm test                          # 152 tests: kern, scenario's, modeltest (10.000 reeksen), afspeelmotor, streamen, strip, mixer, limiter
node tools/proef-sync.mjs         # echte Chrome (headless): klinkt een gesynct nummer op de tel?
```
De proef laadt twee demonummers via het scherm, synct, zet de klok op 126 en jogt 1/16 tel, en
meet in de opname van beide strips hoeveel ms ze uit elkaar liggen (gemeten: 0,25 ms = de
meetresolutie; de jog −29,5 ms waar −29,8 verwacht is).

## Nog niet in plak 1
MIDI en de APC, sends, koptelefoon, stems, effecten, sampler, instrumenten, patronen, beeld,
hotcues en loops. Wat plak 1 haalt en wat nog gemeten moet worden: `../meting/RAPPORT.md`.
