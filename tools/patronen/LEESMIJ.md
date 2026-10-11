# Patronen naar Logic (MIDI)

`midi.mjs`: een set patronen (of één track, of één patroon) als Standard MIDI File, type 1,
384 ticks per tel, voor Logic Pro (docs/PATRONEN.md §8). Spoor produceren-uit, 10 okt.
Bestand in, bestand uit: geen server, geen database, niets op de bus. De route
`GET /api/patronen/<naam>/midi` en de knop in de PATROON-rij komen na de proefavond.

**Altijd op een KOPIE** van de set, nooit tijdens een set:

```
K=<kladmap>/midi; mkdir -p "$K"
cp "<checkout>/patronen/<naam>.json" "$K"/
node tools/patronen/midi.mjs --set "$K/<naam>.json" --track 1 --plek 1 --omlopen 4 --uit "$K/<naam>-T1P1.mid"
```

Daarna het `.mid`-bestand in een Logic-project slepen. Niet op een speeldag: Logic pakt de
controllers en kan de sample rate van het audioapparaat zetten (§8.4).

| Vlag | Wat |
|---|---|
| `--set <pad>` | de set (`patronen/<naam>.json`); wordt gelezen zoals de speler hem leest (`normaliseerSet`), fouten als "let op" op stderr |
| `--uit <pad>` | het MIDI-bestand; bestaat het al: exit 2, niets overschreven |
| `--track N` | alleen track N (1..8) |
| `--plek K` | met `--track`: alleen dat patroon (plek 1..5) |
| `--omlopen M` | zoveel keer het patroon (1..16, standaard 1) |
| `--bpm B` | tempo in het bestand (40..240); standaard het tempo van de set |
| `--zonder-meta` | alleen noten, zonder de `varve:patroon`-tekst (die het patroon verliesvrij terug laat komen) |

Exit 0 geschreven, 1 verkeerd aangeroepen / set onleesbaar / niets gevuld, 2 bestaat al.
Drums gaan naar kanaal 10 zonder GM-vertaling (36 blijft 36); de rest naar kanaal 1.

Test: `node test/patronen-midi.test.mjs` (sectie "de CLI"): dezelfde bytes als `setNaarSmf`,
een tweede keer exit 2, een lege set exit 1. Nooit `pkill`/`killall`: er draait geen server voor nodig.
