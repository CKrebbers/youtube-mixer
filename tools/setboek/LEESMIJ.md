# Setboek

Wat er op een avond KLONK, uit de handelingenlogs (`opnames/set-<id>.acties.jsonl`,
docs/HANDELINGENLOG.md): een tracklist "hoorbaar (benaderd)", wat geladen maar niet gehoord
werd, het gebruik, een leeg verslagblok (Wat werkte / Wat niet / Volgende keer) en een
Buma/Stemra-lijst. Spoor produceren-uit, stap 2 (10 okt). Leest alleen; schrijft niets in
`opnames/`, `media/` of de library.

**Altijd op een KOPIE van de logs**, nooit in de echte `opnames/` en nooit tijdens een set:

```
K=<kladmap>/avond1; mkdir -p "$K"
cp "<checkout>/opnames/set-20261010-"*.acties.jsonl "$K"/
cp "<checkout>/opnames/set-20261011-0"*.acties.jsonl "$K"/ 2>/dev/null   # de nacht; aparte regel: in zsh breekt een glob zonder treffer de hele cp af
cp "$(ls -t "<checkout>/media/backups/"library-*.db | head -1)" "$K/library.db"   # optioneel: lengtes (de nieuwste backup: één consistent bestand)
cp "<checkout>/proef/sessie.json" "$K"/ 2>/dev/null                                                             # optioneel: proefpunten
taskpolicy -b node tools/setboek/setboek.mjs --dag 20261010 --map "$K" --db "$K/library.db" --proef "$K/sessie.json"
```

Lees eerst `## Logs` bovenaan: liep er 's middags (de opbouw) al een log, dan staat dat in de
tracklist van de avond. Draai dan opnieuw met `--vanaf 17:00` (of wanneer de avond begon); die
logs staan dan onder "overgeslagen".

`cp`, nooit `mv`. Zonder `--db` en `--proef` werkt het ook (zonder lengtes en proefpunten).
Voor `--db` de nieuwste backup (`media/backups/`, gemaakt met VACUUM INTO) en niet `library.db` zelf:
dat bestand kopiëren terwijl de server schrijft kan half zijn (recent werk staat in `-wal`, CLAUDE.md "Backup").
Lengtes veranderen zelden; een backup van het laatste uur is genoeg.

**Proefsessie: archiveer vóór een avond** (Controlekamer: "nieuwe ronde"). `proef/sessie.json`
wordt alleen dan leeggemaakt, en `begonnen` is het moment van het EERSTE VINKJE, geen
startknop (`server/proef.js`: `d.begonnen ??= nu`). Het setboek toont alleen punten binnen
twee uur van de logs; oudere staan als één regel ("1 punt van eerder (6 okt), niet getoond").

## De CLI (`setboek.mjs`)

| Vlag | Wat |
|---|---|
| `--dag JJJJMMDD --map <map>` | alle `set-JJJJMMDD-*.acties.jsonl` in de map, plus die van de volgende ochtend vóór 06:00 (een avond over middernacht) |
| `--vanaf UU:MM` | alleen met `--dag`: logs die die dag eerder begonnen (`kop.begon`, Amsterdam) weglaten; ze staan onder "overgeslagen" |
| `--log <pad>` | één log; herhaalbaar (niet samen met `--dag`) |
| `--db <library.db>` | lengte per nummer (`tracks.duur`), alleen-lezen via `node:sqlite`; ontbreekt of kapot = een melding, verder zonder |
| `--proef <sessie.json>` | punten met "fout" of een notitie op de tijdlijn (binnen 2 uur van de logs), met wat er toen klonk; gesplitst op het eerste vinkje (`begonnen`) als dat op deze avond viel |
| `--json` | JSON in plaats van Markdown |
| `--uit <pad>` / `--naast-log` | naar een bestand (`--naast-log`: `set-<id>.setboek.md` naast het eerste log); bestaat het al: exit 2, niets overschreven |

Standaard naar stdout. Exit 0 goed, 1 verkeerd aangeroepen, 2 bestaat al. Ligt een log in de
`opnames/` van een checkout (een map met `server/index.js` ernaast), dan waarschuwt hij: lees
een kopie. Nooit `pkill`/`killall` in de buurt van deze map: er draait geen server voor nodig.

## Bestanden

| Bestand | Wat |
|---|---|
| `lees.mjs` | puur (geen fs): `rijgLogs`, `laadmomenten`, `toestand`, `hoort`, `hoorbaar`, `positieInBron`, `proefpunten`, `setboek`, `naarMarkdown`, `naarJson`, `amsterdamMs` |
| `gebruik.mjs` | `tellingen(regels)`: top 10 actions, laads, actieve minuten. Eén teller, ook voor een latere `tools/gebruik.mjs` |
| `setboek.mjs` | de CLI: bestanden lezen, `--dag`, `--vanaf`, `--db`, `--proef`, uitvoer |
| `../../test/setboek.test.mjs` | 117 checks op synthetische logs in het echte formaat, en de CLI in een tijdelijke map |

## De regel "hoorbaar"

Een track telt als hoorbaar als hij speelt, er een nummer op staat, niet alle drie de
EQ-banden weg zijn (kill, vastgehouden kill, of de knop onderaan: < 3% = kill, `eqDb`), niet
alle stems dicht zijn (een stem onder 10^(−30/20) ≈ 0,03 is dicht), de master boven de drempel
staat en

    20 · log10( klinkt(fader, crossfaderkant) × trim × 2 )  >  −30 dB

De master gaat door `faderGain` (zoals in `engine.setMaster`): onder 1/3 is hij onder −30 dB,
dus master 0,1 (−40,5 dB, het eind van een fade-out) is stil en 0,5 (−22,5 dB) hoorbaar. Hij
telt apart van de track, want de gewone stand 0,8 (−9 dB) zou anders alles verschuiven.
`klinkt` komt uit `src/video/puls.js` (dezelfde als de puls en de maatgever), de curves uit
`src/engine/audio-graph.js` (`faderGain`, `xfaderGains`). Fader 0,3 is −31,5 dB (stil),
0,4 is −27 dB (hoorbaar); crossfader 0,9 laat kant A nog op −16,1 dB horen.
Korter dan 20 s telt niet (een flits staat onder "geladen maar niet hoorbaar"); gaten
korter dan 5 s (een kill, een fader even dicht) worden gelijmd. Een filter op een uiterste
stand (≤ 0,1 of ≥ 0,9) is een aantekening "gefilterd", geen stilte. Alle drempels staan in
`STANDAARD` in `lees.mjs`.

Spelen volgt het deck:
- `play`/`play.quant` wisselen; staat de speelkop op het einde (met `--db` te weten), dan
  begint play opnieuw op 0 (`deck.play()`).
- `cue` zoals `deck.cue()` (speelt → terug naar het cuepunt en stil; stil op het cuepunt →
  spelen; stil elders → het cuepunt zetten).
- een `laad` stopt (`BufferBron.laad()` roept `stop()`).
- `brake` = stil; nog eens TIJDENS het remmen = los. De remtijd komt uit `track.N.brake.time`
  (stand of actie; 0,1 × 50^knop s, standaard 1 s). Na de rem staat hij stil, en een rem op
  een stil deck doet niets.
- een instrument kiezen haalt het nummer eraf (speelt het, dan pas bij een tweede druk binnen
  3 s, zoals `kiesInstrument`); `inst.choose` kiest `round(v × 4)`, dus onder 0,125 is het
  "geen" en blijft het nummer.
- `grid.controle` op een stil deck START hem (naar het eerste stuk om te controleren): dat
  stuk heet "(onzeker)" en de positie "?"; nog eens drukken zet alleen de controle uit.
- de glijdende fades van de auto-DJ (`fader.glide`, `filter.glide`) tellen als fader en filter.

Meerdere logs op één avond worden op `kop.begon` aan elkaar geregen. Een opname starten of
stoppen sluit het log en begint een nieuw: een nummer dat over die grens speelt, is **één**
stuk (zelfde track, zelfde nummer in de beginstand van het nieuwe log, gat < 5 s), en pas
daarna gaan de flitsen eruit (14,5 s vóór de grens + 15 s erna = 29,5 s, dus in de
tracklist). Een gat > 2 s tussen logs wordt gemeld ("log opnieuw begonnen 21:14,
herladen?"), een log zonder acties staat onder "overgeslagen".

**Buma/Stemra.** Een stuk uit een mix (lengte ≥ 20 min met `--db`, of een positie voorbij
20:00) staat er als "titel onbekend: deel van "<mix>" 0:00–8:00". Zonder `--db` ziet het
setboek een lange mix die je vóór 20:00 verliet niet; dat staat onder de lijst. Is de
positie ergens "?" en de lengte onbekend: "<titel> (lengte onbekend)".

## Wat het log niet ziet (en hoe het setboek daarmee omgaat)

- **Het einde van een nummer.** `laad.duur` is de laadtijd, niet de lengte. Met
  `lengte(nummer)` (uit een kopie van de library, `--db` in de CLI) stopt een track op
  start + (lengte − positie) / rate, zolang er geen loop gezien is. Zonder lengte: een
  play-druk die een track stopt die al 20 min speelde, kan een START na het einde zijn
  geweest; dat stuk en wat erna komt (tot een sprong of een laad) heet "(onzeker)".
- **Waar de speelkop is.** "In de bron" komt uit de stand (positie, rate), hotcues, secties
  (`section.N`, `section.next`/`prev`, `section.N.loop`, met de `van` uit de logregel als
  ijkpunt; zonder sectiekaart in het log wordt de positie "?"), cue, pitch, tempo en, met de
  lengte, seek. Beatjump, nudge en loops zetten de speelkop ook, maar dat staat niet als plek
  in het log: daarom "benaderd". Een sprong binnen een hoorbaar stuk splitst het in delen
  ("1:23–1:53, 0:31–1:01").
- **Sync** zet de speelkop (fase) én de **rate** (het tempo van de andere track). Geen van
  beide staat in het log: na een sync lopen de positie in de bron en het geschatte einde weg,
  hoe langer hoe meer. De tracklist zelf (wanneer hoorbaar) klopt wel.
- **Loops**: `loop.<s>`, `loop.out`, `loop.reloop`, `beatloop.<n>` en `section.N.loop` zetten
  de aantekening "loop" (en dan geen einde-schatting meer); `loop.in`, `loop.exit`, halveren
  en verdubbelen niet.
- **Stems op een nummer zonder stems.** Na een laad weet het log niet of er stems zijn; een
  stem-action zet ze in het setboek "aan", maar de engine negeert ze als de stem niet bestaat
  (`deck.stemBestaat`). Zang 0 + inst 0 op zo'n nummer heet dan ten onrechte "stil". (Voor
  nummers in de beginstand weet het setboek het wel: `stemKill` staat er alleen met stems.)
  Echt oplossen kan pas als `laad` in het log meldt of er stems zijn: een eigen PR.
- Niet in de regel: de sampler (pads uit een deck), instrumenten en patronen, effecten die
  het geluid dichtdraaien, de koptelefoon.
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
