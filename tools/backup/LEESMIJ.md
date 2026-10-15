# tools/backup

Een kopie van de staat van het instrument buiten de laptop, en weer terug. Het waarom, de
herstelprocedure en de WAL-les staan in `docs/BACKUP.md`; dit is de korte handleiding.

## Kopie maken

```
node tools/backup/kopie.mjs --doel /Volumes/SSD --droog        # eerst kijken: schrijft niets
node tools/backup/kopie.mjs --doel /Volumes/SSD --controleer   # set A (~20 MB) + meteen controleren
node tools/backup/kopie.mjs --doel /Volumes/SSD --media        # ook set B: media/ en opnames/ (32 GB+)
```

- Komt in `<doel>/varve/staat/` (set A) en `<doel>/varve/media/`, `opnames/` (set B).
- `library.db` en `kaart.db` via `VACUUM INTO` (de `Backups`-klasse van de server), nooit als
  bestand: recent werk staat in de `-wal`.
- Gooit nooit iets weg: geen `--delete`; wat anders is gaat eerst naar `.vorige/<stempel>/`; een
  andere library komt als versie in `versies/`.
- Weigert een doel op dezelfde schijf als de bron; `--zelfde-schijf` voor een versie op de laptop
  zelf (bv. `~/Backups/varve-staat`). Weigert een doel binnen de bron, ook via een symlink of
  alias-pad (op de echte paden).
- Zoekt de library waar de server hem zoekt (`VARVE_DB`, `VARVE_MEDIA`, `~/.varve/media-pad` zoals
  VARVE.app, `media-VERHUISD.txt`); ligt er nog een tweede, dan zegt hij LET OP (zet `VARVE_DB`).
- Set A: library.db (met de instrument-sleutels uit Chrome, de mappings en de tags), kaart.db,
  patronen/, plannen/, proef/, standen/, sets/, werkruimtes/, racks/, mappings/, Input/, de
  handelingenlogs, nacht.json, stems-rij.json, paneel-apparaten.json, uitzend/doelen.json, de
  hub-staat en varve-kaart.json.
- Eén run tegelijk per doel (slot in `staat/.werk/slot`): een tweede zegt "er loopt al een kopie".
- `--bron <checkout>` om vanuit een worktree de echte checkout te lezen (alleen lezen).
- `--overslaan-zonder-doel`: bestaat het doel niet (schijf niet aangesloten), één regel en exit 0
  (voor launchd).
- Schrijft na afloop `~/.varve/backup-laatste.json` (voor het avondpakket).

## Controleren

```
node tools/backup/controleer.mjs --doel /Volumes/SSD
```

Leest alleen. Elk bestand uit `MANIFEST.json` op grootte en SHA-256, `quick_check` en tellingen
van de databases, de tellingen naast de library van nu ("15/15 nummers …", LET OP bij nummers die
er na de kopie bij kwamen), en of set B elk nummer heeft. Laatste regel: `alles ok`, `kopie in
orde; LET OP: …` (exit 0) of `NIET OK` (exit 1).

## Terugzetten

```
node tools/backup/herstel.mjs --van /Volumes/SSD/varve --naar <checkout> --droog
node tools/backup/herstel.mjs --van /Volumes/SSD/varve --naar <checkout>
```

Weigert als er al een `library.db` (of een `-wal`, `-shm`, `-journal`) staat, of een losse
`kaart.db-wal` zonder `kaart.db`. Overschrijft nooit iets: wat er al staat blijft staan en wordt
gemeld als het anders is. Drukt daarna de handstappen af (set B, server,
Chrome — sinds PR #31 alleen gemak, het instrument zit in library.db —, beeld, controleren).

## Elke ochtend (launchd)

```
zsh tools/backup/launchd/maak.sh --doel /Volumes/SSD                # laat de plist zien
zsh tools/backup/launchd/maak.sh --doel /Volumes/SSD --installeer   # pas dan installeren
```

Standaard niet geïnstalleerd. Draai `maak.sh` vanuit de echte checkout: de plist wijst naar het
`dagelijks.sh` van de checkout waar je hem maakt. 08:00, login-shell, log `~/.varve-backup.log`;
een git-doel krijgt daarna een commit en push. Zie `docs/BACKUP.md` §6.

## Bestanden

| | |
|---|---|
| `kopie.mjs` | de kopie (set A, met `--media` set B), het manifest, de stempel |
| `controleer.mjs` | heel? bij? set B compleet? |
| `herstel.mjs` | set A terug in een checkout |
| `gedeeld.mjs` | paden (zoals de server), tellingen, hashes; geen CLI |
| `launchd/` | `nl.varve.backup.plist` (sjabloon), `maak.sh`, `dagelijks.sh` |

Test: `node test/backup-kopie.test.mjs` (ook in `node test/alles.mjs`).
