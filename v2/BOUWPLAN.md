# Bouwplan v2 — de hele app

Clay, 20 okt 2026: "bouw de hele app helemaal hoe jij denkt dat het beste is." Dit is de volgorde
en de verdeling. De volgorde komt uit de telling (`telling/nu.md`): wat zijn handen doen gaat eerst.
De regels uit `app/ARCHITECTUUR.md` gelden voor alles.

Elke plak eindigt met:
- groene tests;
- een headless proef in Chrome;
- een regel in `meting/BUDGET.md` als er een nieuwe grens nodig is;
- een commit.

Wat alleen op de Mac kan, komt in `meting/MAC.md`. De les uit v1 ("de bouw liep voor op de proef",
oogst richting-097) blijft staan: elke plak heeft zijn proef in de cloud, en `MAC.md` zegt wat Clay
moet proberen.

## Volgorde

| Plak | Wat | Waarom eerst (telling) |
|---|---|---|
| 1 ✓ | maatklok, sync, jog/nudge, pitch = klok, strip, limiter, streamen | ritme is de ruggengraat (WENSEN 19 okt) |
| 2 ✓ | **het DJ-instrument af**: insert-effect per track (8 knoppen + mix, racks als data), twee sends (echo en galm, op de klok), hotcues en loops op de klok, koptelefoon (cue vóór de fader), library-paneel, handelingenlog (altijd aan, met bron) en opnemen | strip + effecten + sends = 63% van wat de handen doen |
| 3 ✓ | **controllers**: Web MIDI, APC40 mkII (0x42, alle lampjes en ringen van ons), toetsenbord, de INDELING als module (wisselen tijdens het spelen, per nummer), MIDI-leren | "alle knoppen moeten beter en logischer, modulair" (WENSEN) |
| 4 ✓ | **beeld in de kern**: video per track als slaaf van wat je hoort, WebGL2-mixer, video-effecten op de klok, vormlagen, het losse venster | video/vormen = 17% van de handen, nu achter een vlag |
| 5 ✓ | **produceren op de klok**: sampler (8 pads), instrumenten (poly, drums), patronen, klankschaal | eén klok voor alles (WENSEN "b en a") |
| 6 ✓ | stems ✓, auto-DJ ✓ (zonder setplan), de Stroommachine ✓, de hub ✓; iPad en setplan bewust later (zie onder) | groot in de code, klein in de handen (telling punt 5, 6) |

## Contracten tussen de delen

### Effecten (`src/audio/fx/`, plak 2)

- **Insert per track**, in de strip ná het filter en vóór de fader. Dicht is dus ook stil, zoals v1.
- **Een rack is data:** `{ schema: 1, naam, keten: [{ type, params, bypass? }], macros: [8 × { naam, koppelingen: [{ slot, param, van, tot, curve? }] }], mix }`. De sjablonen uit v1 (`racks/sjablonen.json`) laden ongewijzigd, of met een migratie.
- **Knop K (0..1)** wijst naar een PLEK, niet naar een parameter. Een ander rack laden = andere betekenis, dezelfde koppeling (v1).
- **Wisselen zonder tik:** twee complete ketens, equal-power kruisfade, oud pas weg na fade + staart (v1).
- **Op de klok:** een effect dat op de maat loopt (echo, gate, LFO) krijgt `klok` mee: `{ tellengte(t), volgendeTel(t), loopt }` uit `engine.klok`, zoals je hem HOORT. Er is geen fxKlok per deck meer: de maatklok IS de klok.
- **Sends A (echo) en B (galm):** ná de fader, vóór de crossfader (v1, Clay 23 sep). Twee gedeelde bussen in de mixer, helemaal nat.
- **Acties** in `src/engine/acties-fx.js`:
  - `track.{n}.fx.knop.{k}` (k 1–8) en `track.{n}.fx.mix`;
  - `track.{n}.fx.aan`, `track.{n}.fx.volgend` / `.vorig`;
  - `track.{n}.send.a` / `.b`;
  - `send.a.knop.{k}` en `send.b.knop.{k}`.
- **Geen afval op het audiopad.** Elk effect heeft `vernietig()`. Filters in een lus krijgen een negatieve Q.

### Controllers (`src/control/`, plak 3)

- **Laag:** `control/` mag `kern/` lezen (de bus) en verder niets: geen audio, geen engine-binnenkant, geen DOM. Een kleine schermlaag in `ui/` koppelt hem aan het venster.
- **Een indeling is data:** `{ schema: 1, naam, apparaat, regels: [{ control, actie, gedrag, shift?, laag? }] }`. Het `gedrag` is een van:
  - `absoluut` (fader, met soft-takeover);
  - `eindeloos` (ringknop: alleen het verschil);
  - `trigger`;
  - `schakelaar`.
- **Wisselen:** de indeling is per nummer te kiezen; een nummer kan er een hebben (zoals een rack in v1 bij een link).
- **Lampjes** lezen de bus (`bus.lees`) volgens de indeling, met diffing en een wachtrij van 16 berichten per 4 ms. Eén tabblad praat met de APC (Web Lock).
- **De nummers** van de APC komen uit Akai's protocoldocument v1.2 (v1 `src/control/devices/apc40mk2.js`), nooit uit herinnering.

### Log en opname (plak 2)

- Elke actie op de bus komt als `[t, id, v, { bron }]` in het log, met t op de audioklok. Het log staat altijd aan zodra de klok loopt (v1 J18).
- Opnemen tapt de master ná de limiter. De server schrijft elk stuk op zijn frame (`?frame=N`), zoals v1: herhalen is veilig en een gat wordt stilte.
- Data staat in `VARVE_V2_DATA`, standaard `~/.varve/v2` (opnames, logs, eigen racks, indelingen). Nooit in git, nooit in iCloud.

## Bewust later (20 okt)

- **iPad en iPhone bedienen** (v1 S7/S8): een schrijfweg van buiten de Mac is een eigen
  beveiligingsontwerp (koppelcode, cookie, Origin, rem, loslaten bij wegvallen, VAST_NOOIT). Klein
  in de handen (telling punt 6), groot in risico. Eerst de set op de Mac speelbaar en geproefd.
- **Het setplan voor de auto-DJ** (v1 PLAN.md, secties, lagen, GO): de automaat rijdt nu op
  "past bij" uit de library. Het plan komt als Clay de automaat op een avond heeft gehoord.
- **Keylock** (Signalsmith): de bronwissel is voorbereid (één afspeelmotor met segmenten), maar het
  is een eigen spoor met een luistertest, zoals in v1.
