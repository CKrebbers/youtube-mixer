# tools/beatmeting

Metingen van het beatgrid (docs/BEATGRID.md). Niets hiervan draait in de app; alles leest alleen
(media/, de library via de server) en schrijft hooguit in de tijdelijke map van het systeem.
Het overzicht per script staat ook in `tools/README.md` (blok `beatmeting/`); dit bestand zegt
vooral **wat nog leeft** en wat eenmalig onderzoek was. Opgeruimd op 15 okt 2026 zonder iets weg
te halen (spoor B van de architectuurronde, `docs/verslagen/2026-10-15/arch-beatgrid.md`).

## Wat leeft (onderhouden, draait op de code van nu)

| map / script | wat | wie gebruikt het |
|---|---|---|
| `synth/` | **de benchmark** met bekende antwoorden (BEATGRID.md §12, §14): `nummers.mjs` (21 synthetische nummers), `nep-beatthis.mjs` (tellen zoals Beat This! ze geeft, met zijn fouten), `scoor.mjs` (dekking, tempo, DJ-tempo, de "1", vals zeker, en sinds 15 okt de "1" zonder twijfel), `bench.mjs` (beide analyses zoals de server), `groep.mjs` (per soort fout), `opstart.mjs` (wat een nieuwe kaartversie bij het opstarten kost), `snap.mjs` (15 okt: snappen naar de klap tegen snappen naar de tel) | `test/beatbench.test.mjs` importeert `nummers.mjs`, `nep-beatthis.mjs` en `scoor.mjs`; **verander je die, draai dan die test** |
| `rest/gridpast.mjs`, `rest/gridpast-synth.mjs` | "past het grid op elk stuk" (BEATGRID.md punt 4), vóór (12776ba) tegen nu, op 48 fragmenten van Clay's library / synthetisch | met de hand, na een wijziging aan `analyseerGrid` |
| `rest/tel1-echt.mjs` | "tel 1 hier" op Clay's fragmenten tegen een derde mening (de aanzet op 1 ms); sinds 15 okt met kolom **T** = snappen naar de tel van Beat This! (`snapNaarTel`, leest `media/<id>/tellen.json`) | met de hand, op de Mac (media staat niet in een container) |
| `rest/tel1-synth.mjs`, `rest/fragment.mjs` | restpunten 1 en 2 (25 sep), synthetisch en op fragmenten | draait nog; de uitkomst staat in `rest/*.txt` |
| `rest/lib.mjs` | gedeeld voor `rest/`: de media-map (VARVE_MEDIA, `media-VERHUISD.txt`, of die van de hoofdrepo vanuit een worktree), fragmenten van onset.bin en audio, oude detect.js uit git | ook door `lib.mjs` hieronder (de media-map) |

## Eenmalig onderzoek (sep 2026): laten staan, niet onderhouden

Deze scripts meten de stappen van september (stap A: tikken en verfijnen; stap C: het automatische
grid). Ze werken nog als de server draait (`http://localhost:8777/api/library`) en lezen dan
`onset.bin` uit de media-map, maar ze vergelijken met de code van TOEN; de getallen in de
`*.txt`-bestanden zijn de uitkomst van 23 september en worden niet bijgewerkt.

- **Bovenaan** (`lib.mjs`, `overzicht.mjs`, `gridfit.mjs`, `fasespoor.mjs`, `puls.mjs`, `regio.mjs`,
  `tap-sim.mjs`, `tijd.mjs`, `offset-synth.mjs`, `offset-check.mjs`): de eerste meting op Clay's
  library (BEATGRID.md "Gemeten op Clay's library"). `lib.mjs` las tot 15 okt `ROOT/media/…`, wat
  niets meer vond sinds media/ buiten iCloud staat (VI2): nu dezelfde media-map als `rest/lib.mjs`.
- **`stapA/`**: vóór/na stap A (tap 53% → 91% goed). `ag-lib.mjs` en `drietwee-lib.mjs` importeren
  `./detect-oud.js`; dat bestand ontbrak (nooit gecommit). Teruggezet op 15 okt uit de geschiedenis:
  `git show a22c5ae^:server/detect.js`, de detect.js van vlak vóór commit a22c5ae ("Beatgrid stap A"),
  met een kop over de herkomst. Waarom die versie: `drietwee-lib.mjs` vergelijkt `tempoUitEnvelope`
  oud tegen nieuw, en de drie-twee-keuze (`drieTwee`) kwam er in a22c5ae bij; `ag-lib.mjs` gebruikt
  `oud.segmenteer` en `oud.tempoCurve`, die die versie ook heeft. `stab.mjs` importeerde
  `../varve-beat/gridfit.mjs` (de oude naam van deze map): nu `../gridfit.mjs`.

## Wat nodig is

- `node` (22+), `ffmpeg`, en voor `rest/` en `stapA/` Clay's media-map.
- `git` met de VOLLE geschiedenis voor alles dat een oude versie uit git haalt (`rest/lib.mjs`:
  cc527e3, 12776ba; `bench.mjs --code`): in een ondiepe clone eerst `git fetch --deepen=2000`.
- Het echte Beat This! op de benchmark: `bench.mjs --beatthis ~/.varve/stems-venv/bin/python`
  (BEATGRID.md §14), of de oude route `--wav <map>` + `server/tellen/tellen.py` + `--echt <map>`.
