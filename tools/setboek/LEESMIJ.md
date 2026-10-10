# Setboek

Wat er op een avond KLONK, uit de handelingenlogs (`opnames/set-<id>.acties.jsonl`,
docs/HANDELINGENLOG.md): een tracklist "hoorbaar (benaderd)", wat geladen maar niet gehoord
werd, het gebruik, een leeg verslagblok (Wat werkte / Wat niet / Volgende keer) en een
Buma/Stemra-lijst. Spoor produceren-uit, stap 2 (10 okt). Leest alleen; schrijft niets in
`opnames/`, `media/` of de library.

**Altijd op een KOPIE van de logs**, nooit in de echte `opnames/` en nooit tijdens een set:

```
K=<kladmap>/avond1; mkdir -p "$K"
cp "<checkout>/opnames/set-20261010-"*.acties.jsonl "<checkout>/opnames/set-20261011-0"*.acties.jsonl "$K"/ 2>/dev/null
cp "$(ls -t "<checkout>/media/backups/"library-*.db | head -1)" "$K/library.db"   # optioneel: lengtes (de nieuwste backup: één consistent bestand)
cp "<checkout>/proef/sessie.json" "$K"/ 2>/dev/null                                                             # optioneel: proefpunten
taskpolicy -b node tools/setboek/setboek.mjs --dag 20261010 --map "$K" --db "$K/library.db" --proef "$K/sessie.json"
```

`cp`, nooit `mv`. Zonder `--db` en `--proef` werkt het ook (zonder lengtes en proefpunten).
Voor `--db` de nieuwste backup (`media/backups/`, gemaakt met VACUUM INTO) en niet `library.db` zelf:
dat bestand kopiëren terwijl de server schrijft kan half zijn (recent werk staat in `-wal`, CLAUDE.md "Backup").
Lengtes veranderen zelden; een backup van het laatste uur is genoeg.

## De CLI (`setboek.mjs`)

| Vlag | Wat |
|---|---|
| `--dag JJJJMMDD --map <map>` | alle `set-JJJJMMDD-*.acties.jsonl` in de map, plus die van de volgende ochtend vóór 06:00 (een avond over middernacht) |
| `--log <pad>` | één log; herhaalbaar (niet samen met `--dag`) |
| `--db <library.db>` | lengte per nummer (`tracks.duur`), alleen-lezen via `node:sqlite`; ontbreekt of kapot = een melding, verder zonder |
| `--proef <sessie.json>` | punten met "fout" of een notitie op de tijdlijn, met wat er toen klonk; vrij spelen / speellijst gesplitst op `begonnen` |
| `--json` | JSON in plaats van Markdown |
| `--uit <pad>` / `--naast-log` | naar een bestand (`--naast-log`: `set-<id>.setboek.md` naast het eerste log); bestaat het al: exit 2, niets overschreven |

Standaard naar stdout. Exit 0 goed, 1 verkeerd aangeroepen, 2 bestaat al. Ligt een log in de
`opnames/` van een checkout (een map met `server/index.js` ernaast), dan waarschuwt hij: lees
een kopie. Nooit `pkill`/`killall` in de buurt van deze map: er draait geen server voor nodig.

## Bestanden

| Bestand | Wat |
|---|---|
| `lees.mjs` | puur (geen fs): `rijgLogs`, `laadmomenten`, `toestand`, `hoort`, `hoorbaar`, `positieInBron`, `proefpunten`, `setboek`, `naarMarkdown`, `naarJson` |
| `gebruik.mjs` | `tellingen(regels)`: top 10 actions, laads, actieve minuten. Eén teller, ook voor een latere `tools/gebruik.mjs` |
| `setboek.mjs` | de CLI: bestanden lezen, `--dag`, `--db`, `--proef`, uitvoer |
| `../../test/setboek.test.mjs` | 77 checks op synthetische logs in het echte formaat, en de CLI in een tijdelijke map |

## De regel "hoorbaar"

Een track telt als hoorbaar als hij speelt, er een nummer op staat, niet alle drie de
EQ-kills aan staan, niet alle stems dicht zijn, de master open is (> 0,01) en

    20 · log10( klinkt(fader, crossfaderkant) × trim × 2 )  >  −30 dB

`klinkt` komt uit `src/video/puls.js` (dezelfde als de puls en de maatgever), de curves uit
`src/engine/audio-graph.js` (`faderGain`, `xfaderGains`). Fader 0,3 is −31,5 dB (stil),
0,4 is −27 dB (hoorbaar); crossfader 0,9 laat kant A nog op −16,1 dB horen.
Korter dan 20 s telt niet (een flits staat onder "geladen maar niet hoorbaar"); gaten
korter dan 5 s (een kill, een fader even dicht) worden gelijmd. Een filter op een uiterste
stand (≤ 0,1 of ≥ 0,9) is een aantekening "gefilterd", geen stilte. Alle drempels staan in
`STANDAARD` in `lees.mjs`.

Spelen volgt het deck: `play`/`play.quant` wisselen, `cue` zoals `deck.cue()` (speelt →
terug naar het cuepunt en stil; stil op het cuepunt → spelen; stil elders → het cuepunt
zetten), een `laad` stopt (`BufferBron.laad()` roept `stop()`), `brake` = stil, nog eens
binnen 5 s = los, een instrument kiezen haalt het nummer eraf (speelt het, dan pas bij een tweede
druk binnen 3 s, zoals `kiesInstrument` in actions.js). De glijdende fades van de auto-DJ (`fader.glide`, `filter.glide`) tellen als fader
en filter. Meerdere logs op één avond worden op `kop.begon` aan elkaar geregen;
een gat > 2 s wordt gemeld ("log opnieuw begonnen 21:14, herladen?"), een log zonder
acties staat onder "overgeslagen".

## Wat het log niet ziet (en hoe het setboek daarmee omgaat)

- **Het einde van een nummer.** `laad.duur` is de laadtijd, niet de lengte. Met
  `lengte(nummer)` (uit een kopie van de library, `--db` in de CLI) stopt een track op
  start + (lengte − positie) / rate, zolang er geen loop gezien is. Zonder lengte: een
  play-druk die een track stopt die al 20 min speelde, kan een START na het einde zijn
  geweest; dat stuk en wat erna komt (tot een sprong of een laad) heet "(onzeker)".
- **Waar de speelkop is.** "In de bron" komt uit de stand (positie, rate), hotcues, secties
  (met de `van` uit de logregel als ijkpunt), cue, pitch, tempo en, met de lengte, seek.
  Sync, beatjump, nudge en loops zetten de speelkop ook, maar dat staat niet als plek in
  het log: daarom "benaderd". Een sprong binnen een hoorbaar stuk splitst het in delen
  ("1:23–1:53, 0:31–1:01").
- Niet in de regel: de sampler (pads uit een deck), instrumenten en patronen, effecten die
  het geluid dichtdraaien, de koptelefoon. Stems: na een laad pas zodra er een stem-action
  komt (dan weet het log dat het nummer stems heeft).
- Het is de partituur van de bus, geen meting van het geluid. De echte controle is Clay
  die de tracklist leest en zegt wat niet klopt; elke afwijking wordt een testgeval.

## Testen

```
node test/setboek.test.mjs
```

Gemeten (10 okt, bouwer): 60 000 synthetische acties (3,4 MB, 2,1 uur) in 0,8 s onder
`taskpolicy -b`. Niet getest: een ECHT log van een avond (er is er nog geen met deze
lezer gelezen; de bouwer las op 10 okt bewust niets uit de echte `opnames/`). Een actie telt
in "Gebruik" per logregel, dus een knop twee keer (indrukken en loslaten).
