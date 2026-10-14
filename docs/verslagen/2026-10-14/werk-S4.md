# Werkruimte S4: combinaties en effecten (14 okt 2026)

Tak `werk/S4` (vanaf `werkruimte/integratie` e8dcd98, met S0 en de kies-cache van de andere
workflow erin). Ontwerp: `docs/WERKRUIMTE.md` A8, B4, B5, D4 "S4"; bouwopdracht
`docs/werkruimte/sporen.json` (S4). Wat er gebouwd is, voor wie eraan komt: `docs/werkruimte/S4.md`.

## Kort

Clay (14 okt): **jij bepaalt welke effecten, worpen, superknoppen en racks er zijn.** S4 bouwde
het mechaniek als data, met per soort hooguit één voorbeeld. De engine verandert niet;
`mappings/apc40mk2.json` en `maschine-mk2.json` zijn niet aangeraakt. Zonder werkruimte (of
`?stukken=` voor één pagina) doet geen knop iets anders dan gisteren.

## Gebouwd

1. **Nieuwe regelvelden in de mapping** (`src/control/mapping.js`): `druk` en `latch` met `naar`,
   `lang` (kort = vast, lang = zolang je drukt), `stappen` (relatieve encoder → `.fwd`/`.back`,
   hooguit 8 per bericht), `als` (witte lijst), `{tweede}` en `{maatgever}`, houd-mapjes vóór de
   andere mapjes. Weigering van houd/druk/latch op de kern (play, cue, play.quant, hotcue, load,
   layer) met een reden. De kies-cache rekent met de versie van het houd-register (alleen omhoog
   bij een echte wijziging) en, als er `als`-regels zijn, met de stand van de condities.
2. **Houd-mapjes** (`src/control/houd.js`, groep `houd` in `lagen.js`): één register voor alle
   apparaten, per mapje van welk apparaat en hoeveel knoppen; `losgekoppeld(apparaat)`;
   `voegMapjeToe('houd', naam)` maakt `layer.houd.<naam>` op de bus.
3. **Superknoppen** (`src/control/superknop.js` puur, `super.1–16` in `acties-combi.js`): links met
   de velden van een rack-knop, opgelost met `resolveLink`; `super.K.hold`; morph `vastA`/`vastB`
   (alleen scherm); glijden via `.glide` waar die bestaat; een onbekende link grijs met één melding.
4. **Worpen en solo**: `track.N.send.a.hold`, `.send.b.hold`, `.fx.mix.hold`, `track.N.stem.<s>.solo`.
5. **Bus-racks**: `send.a/b.rack.next/prev`, `zetBusRack(bus, naam)` voor S3, onthouden op naam.
6. **Stukken**: `mappings/stukken/fx-matrix.json` (85 regels: mapje `grid.fx`, violet, ⇧ On/Off)
   en `mix-extra.json` (8 regels: ⇧ A|B = thru). `zetStuk()` zet een stuk op een mapping.
7. **Opzet en uitleg**: `src/ui/aanhakers/combi.js` (bus-racks terug uit localStorage, `als`
   op de APC-mapping, `{maatgever}`, `?stukken=`, `window.varveCombi`),
   `src/ui/beschrijf/combi.js` (ook de uitleg van `fx.knob.K.hold` en `xfade.a/b/thru`, die de
   stukken gebruiken en die tot nu toe kaal op de kaart stonden).

## Acceptatie

| eis | gehaald | bewijs |
|---|---|---|
| druk op `track.1.send.a` naar 1: twee regels in het log, terugspelen dezelfde stand | ja | `node test/handelingenlog.test.mjs` "combinaties (werkruimte S4)": regels 1 en 0,3; eindstand ± 1e-9 |
| latch: druk → naar, druk → oud | ja | `node test/combinaties.test.mjs` "mapping: druk, latch, lang, stappen" |
| lang: < 400 ms latch, ≥ 400 ms momentary (nep-klok) | ja | idem: 399 ms vast, 400 ms terug, `lang: true` = 400 |
| stappen: +3 = 3 × .fwd, hooguit 8 | ja | idem: +3, 127 (−1), +40 → 8, codering bin |
| houd over twee nep-apparaten (B doet X zolang A; A eerst los → B laat los naar X; losgekoppeld; twee tegelijk) | ja | combinaties "houd-mapjes over twee nep-apparaten" |
| houd/druk/latch op play/cue/hotcue geweigerd met reden | ja | combinaties "geen houd, druk of latch op de kern" (ook via `set()`) |
| kies-cache: na loslaten meteen de gewone regel; LED-tik niet duurder (± 10 %) | ja | combinaties; bench hieronder |
| superknop: gouden tabel 11 × 4 = resolveLink | ja | `node test/superknop.test.mjs` (ook tegen een tabel met de hand, ± 1e-12) |
| opname met superknop speelt terug, reads ± 1e-9, geen dubbele invokes | ja | handelingenlog: grootste afwijking 0, super.1 nooit, elk kind precies zo vaak als in het log |
| onbekende link grijs, één melding | ja | superknop.test |
| send.a.hold: 1, terug naar vóór (ook als hij bewoog) | ja | combinaties, echte engine op de Web Audio-mock |
| stem.drums.solo: zang/bas/overig weg en terug | ja | combinaties (vier stems, via hun `.hold`) |
| bus-rack via kruisfade (CURVE_BREUK 0, geen disconnect met signaal); 10 × snel = niet meer ketens dan op een track | ja | combinaties "bus-racks": 11 = 11, 0 breuken, 0 gains los met signaal, opgeruimd pas na de fade |
| stukken: 0 botsingen, elke action bestaat en heeft uitleg | ja | combinaties "de stukken" (op een echte bus, ook spelen en weer weg) |
| bestaande mappingtests groen zonder de nieuwe velden | ja | `node test/mapping.test.mjs` (+ nieuwe gevallen "S4": dezelfde lijst, hetzelfde vars-object) |
| `node test/alles.mjs` groen | ja, op de bekende omgevingsfouten na | zie Tests |

### Metingen

LED-laag, `node tools/bench/feedback.mjs --bron <worktree van origin/werkruimte/integratie>` en
zonder `--bron`, elk twee keer, beste van twee (µs, CPU van deze container):

| stand | p50 vóór → na | p99 vóór → na |
|---|---|---|
| rust (8 tracks, stil) | 43,4 → 42,2 | 289 → 273 |
| spelen (knipperen op de tel) | 56,6 → 57,4 | 342 → 341 |
| spelen + mapje loops | 56,7 → 56,2 | 316 → 172 |
| spelen + shift | 29,6 → 29,3 | 138 → 142 |

Druk → lampje (direct): p50 0,9 → 0,8 ms; via de hub p50 2,0 → 2,0 ms. Berichten per seconde
gelijk. Binnen de ± 10 %. De bench meet zonder open houd-mapje en zonder `als`-regels (de stand
zonder werkruimte); met een open houd-mapje komt er per bericht één samengevoegde, bevroren lijst bij.

Headless rookproef (een scratch-script, niet in de repo: eigen server met `VARVE_TESTSERVER=1` en
alle `VARVE_*` in een tijdelijke map, `headless_shell --no-sandbox`, geen MIDI): de mixer met
`?stukken=fx-matrix,mix-extra` start alle acht aanhakers zonder consolefout; de APC-mapping krijgt
85 + 8 regels; ⇧ On/Off opent `grid.fx`; pad 1/1 zet plek 1 van track 1 van 0,35 op 1 en terug;
`mapping.handle` van die druk 0,4 ms (inclusief de keten).

## Review (twee rondes)

Ronde 1, twee agenten (correctheid/regels en acceptatie). Blokkerend en opgelost: de getter van
`mapping.lagen` brak het terugzetten in `apc-kaart.js`; de aanhaker gooide op de kale ctx van
`test/aanhaakpunten.test.mjs`. Ook opgelost: twee drukknoppen op één doel, druk op een trigger,
droge insert-racks op een natte bus, solo zonder telling, superknop-variabelen, `{maatgever}`
(nu `engine.maatgever()`), `fx.mix.hold` na een rackwissel, de eigenaar van een houd-knop.
Ronde 2: blokkerend en opgelost: `load()` terwijl een drukknop vastzat liet de telling voorgoed
staan. Niet opgelost, gedocumenteerd: druk gemengd met latch/lang op één doel; twee solo's tegelijk
geven stilte (ontwerpvraag); de `als`-stand niet in de sleutel van het LED-plan (feedback.js).

## Tests

`node test/alles.mjs` (105 bestanden, 9318 checks, 237 s): alles groen behalve de drie die in deze container ook op de basis rood
zijn (reviewer b liep ze na op een `git archive` van integratie): renderblok "keylock met wissels
… bytes per bericht", wachtrij "yt-dlp en zijn kind" (2×), instrumenten-fm-schaal "geen afval
per blok". Nieuw: `test/combinaties.test.mjs`, `test/superknop.test.mjs`; nieuwe gevallen in
`test/mapping.test.mjs` en `test/handelingenlog.test.mjs`. Geen bestaande verwachting veranderd.

## Wat niet, en wat alleen op hardware te bevestigen is

- Niets op de APC of de Maschine. Te bevestigen: dat fx-matrix-pads als worp goed voelen (proef
  E0/B), de violette lampjes in `grid.fx`, en een houd-knop op de Maschine met een APC-knop
  (de volgorde over de hub meet S6, ontwerp C5).
- Geen engine-effecten (W3): loop roll, beat repeat, reverse, effect per stem, extra bus, vrije routing.
- Geen superknoppaneel op het scherm (dat is S7/S8); grijs staat in `varveCombi.superStatus(k)`.
- Bus-racks: geen sjabloon heeft `"bus": true`; welk rack er op een bus zat staat niet in het log.

## Zelf effecten en combinaties toevoegen

Stap voor stap, met voorbeelden: `docs/werkruimte/S4.md` "Zelf toevoegen". Kort:

1. Een knop als worp: in een stuk of je mapping `"mode": "druk", "naar": 1` (of `latch`, of `"lang": 400`).
2. Een stuk maken: `mappings/stukken/<naam>.json` met `mapjes.nieuw` en `regels.apc40mk2`, proberen
   met `?stukken=<naam>`, controleren met `node test/combinaties.test.mjs`.
3. Een houd-mapje: `{ "in": "<knop>", "action": "layer.houd.solo" }` op het ene apparaat, regels met
   `"laag": "houd.solo"` op het andere.
4. Een superknop:

```json
{ "naam": "opbouw", "links": [
  { "target": "track.{focus}.filter", "from": 0.5, "to": 0.85, "curve": "s" },
  { "target": "track.{focus}.send.b", "in": [0.5, 1], "from": 0, "to": 0.6 },
  { "target": "track.{focus}.fader", "from": 1, "to": 0.7, "glide": true } ] }
```

   in de werkruimte (`superknoppen`) of `varveCombi.zetSuperknop(2, …)`; dan een knop op `super.2`.
5. Een rack op de echo/galm: `"bus": true` bij dat rack in `racks/sjablonen.json`.

## Vragen voor Clay

- **S4-1** Twee solo's tegelijk geven nu stilte (elk zet de ander weg). Wil je dat "solo drums +
  solo bas" juist die twee laat horen?
- **S4-2** Welke racks wil je op de echo- en galmbus? (Ze moeten in hun beginstand nat klinken.)
- **S4-3** ⇧ On/Off opent met het stuk fx-matrix ook in de mapjes master en instrument de fx-matrix
  (daar deed hij eerst bypass/stil). Goed, of liever een andere knop?
- **S4-4** Moet een worp die je bij het begin van een opname vasthoudt, bij terugspelen ook
  terugkomen? (Dan logt de worp twee waarden in plaats van druk/los.)

## Volgende versie (opties)

- De `als`-stand in de sleutel van het LED-plan (feedback.js, één regel).
- `control/houd.js` als pure module in `regels.test.mjs`.
- Druk-telling ook over latch/lang heen; een superknoppaneel met grijze links; bus-racks in het log.
- `tools/headless/combi.mjs` van de rookproef hierboven (tools/ was niet van S4).
