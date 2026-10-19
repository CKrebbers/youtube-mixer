# Telling voor v2

Wat Clay ECHT gebruikt, uit de handelingenlogs (`opnames/set-<id>.acties.jsonl`,
docs/HANDELINGENLOG.md). `tel.mjs` leest alleen en schrijft één JSON. `nu.md`/`nu.json` zijn wat we
al weten zonder de Mac (uit docs/HANDEN.md §4); `nu.mjs` maakt `nu.json` opnieuw.

## Draaien (op de Mac)

**Altijd op een KOPIE van de logs**, nooit in de echte `opnames/` en **nooit tijdens een set**
(de server schrijft daar; een kopie lezen kost de set niets). `cp`, nooit `mv`.

```
K=~/varve-klad/telling; mkdir -p "$K/logs"
cp ~/Desktop/"1. Projects/Youtube mixer"/opnames/set-*.acties.jsonl "$K/logs"/
cd ~/Desktop/"1. Projects/Youtube mixer"
taskpolicy -b node v2/telling/tel.mjs "$K/logs" --uit "$K/telling.json"
```

- Zonder `--uit` gaat de JSON naar stdout; een samenvatting van één regel gaat altijd naar stderr.
- `--uit` schrijft nooit in de map met logs, en nooit over een bestand heen dat geen eerdere telling
  is (exit 2, niets geschreven). Een eerdere `telling.json` wordt wel vervangen.
- Wijs je de echte `opnames/` van een checkout aan, dan waarschuwt hij (en leest hij toch, alleen lezen).
- Exit 0 goed, 1 verkeerd aangeroepen (geen map, geen logs), 2 `--uit` mag niet.
- Gemeten: 27 synthetische logs met samen 62.100 handelingen in 0,35 s.

## Wat erin staat (`telling.json`)

| Veld | Wat |
|---|---|
| `bron` | aantal logs, avonden (een log vóór 06:00 telt bij de avond ervóór, zoals het setboek), regels, handelingen, kapotte regels, eerste/laatste begin, totale duur (s), het register (ruw en genormaliseerd), welke mappings |
| `acties[]` | per genormaliseerde action (`track.3.fader` → `track.N.fader`, `src/handen/telling.js`): `aantal`, `aandeel`, in hoeveel `logs` en `avonden`, `eerste`/`laatste` datum (Amsterdam, uit `kop.begon` + `t`), `groep`, `inRegister`, `inMapping` (welke standaardmappings hem op een knop hebben) |
| `groepen[]` | per groep van telling.js: `handelingen` en `aandeel`, en hoeveel actions er in die groep `gebruikt` zijn, in het `register` staan (en daarvan `registerNooit`), en op een knop staan (`inMapping`, `mappingNooit`) |
| `logs[]` | per log: `datum`, `avond`, `begon`, `duur` (s, de grootste `t`), `handelingen`, `regels`, `kapot`, `opname`, `top5` |
| `nooitGebruikt` | actions die de app kent (register, genormaliseerd) en die in geen log voorkomen: aantal, `perGroep`, de `lijst`; `ruw` = hoeveel van de 3.251 ruwe ids daaronder vallen |
| `mappingNooitGebruikt` | per standaardmapping (`apc40mk2.json`, het fragment `apc40mk2-vormen.json`, `maschine-mk2.json`, `xboard49.json`): actions op een knop die nooit voorkwamen, `regelsNooit` (regels = knop × mapje × shift die nooit vuurden), `perGroep`, de `lijst`; en `samen` |
| `nietInRegister` | actions in de logs die het register niet kent: wat de aanhakers van de werkruimte binden (`werk.*`, `plan.*`, `set.*`, tags, precisie), of oude namen |

## Hoe lezen

- **Een handeling is een regel op de bus, geen hand.** Het log kent geen bron: muis, MIDI, toets,
  de auto-DJ (`*.glide`, `track.N.xfade.*`) en terugspelen staan er hetzelfde in.
- **Aantal is geen belang.** Een knop indrukken = twee regels (aan, los); een fader draaien =
  tientallen. Vergelijk faders met faders en knoppen met knoppen; kijk voor "doet hij ertoe" naar
  `avonden`, niet naar `aantal`.
- **"Nooit gebruikt" geldt voor deze logs.** Een log dat niet in de kopie zat, of een avond zonder
  log (het vinkje "altijd" stond uit), telt niet.
- **Het register** is wat `src/control/actions.js` bindt (`tools/handen/register.mjs`, zoals
  `tools/handen/handenkaart.mjs`: alle bind-functies op dubbels, 3.251 ids). Sjablonen in de
  mappings (`{focus}`, `{speel}`, `{plek}`) worden met track 1 en plek 1 ingevuld en dan genormaliseerd.
- Een log met NUL-bytes (een gat na een storing) wordt gelezen zoals `leesLog` het leest: de NUL's
  eruit. `handenkaart.mjs` telt die regels niet; de aantallen kunnen daar een paar lager zijn.

## Bestanden

| Bestand | Wat |
|---|---|
| `tel.mjs` | de CLI; `tel(logs, { register, mappings })` is puur en apart te gebruiken |
| `nu.mjs` | `nu.json` uit docs/HANDEN.md §4 + register + mappings (`--json` = naar stdout) |
| `nu.json`, `nu.md` | wat we zonder de Mac weten, en 13 conclusies voor v2 met hun grens |

Hergebruikt, niet gekopieerd: `src/handen/telling.js` (normaliseren, groepen, tellen),
`src/control/handelingen.js` (`leesLog`), `tools/handen/register.mjs`, `resolveTarget` uit
`src/control/mapping.js`.
