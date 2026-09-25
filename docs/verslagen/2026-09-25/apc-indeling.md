# APC-indeling "Voorstel A" — verslag (25 sep 2026)

Branch `spoor3/apc-indeling` (vanaf `integratie-r3` 711a866), worktree
`.claude/worktrees/agent-a574edf71687d6ed3`, na afloop `git switch --detach`.

## Commits

1. `499b47e` APC-indeling "Voorstel A": modus klank, beatjump/loop/quantize/rem rechts
2. `1022eb9` Eigen mapping: een oude volledige kopie tegen de standaard waar hij op rust

## Indeling zoals gebouwd

| waar | knop (noot) | doet | met shift |
|---|---|---|---|
| grid, modus klank (kolom N = track N) | rij 1 (0x20+) | `track.N.kill.high.hold` (weg zolang je drukt) | `track.N.kill.high` (schakelaar) |
| | rij 2 (0x18+) | `track.N.kill.mid.hold` | `track.N.kill.mid` |
| | rij 3 (0x10+) | `track.N.kill.low.hold` | `track.N.kill.low` |
| | rij 4 (0x08+) | `track.N.brake` | (valt terug op rem) |
| | rij 5 (0x00+) | `track.N.play.quant` | (valt terug) |
| scene 5 (0x56) | buiten klank | loop weg (ongewijzigd) | `layer.grid.klank` (NIEUW) |
| | in klank | loop weg, lampje = klank open (`led.lees`) | `layer.grid.klank` |
| ▲ ▼ | | hotcues → loops → sampler → video → klank → rond | |
| 2×2 nummer (activator, ch N-1, 0x32) | | play | `track.N.play.quant` (NIEUW) |
| Bank ◀ (0x3C) | | `track.{focus}.beatjump.back` | `…beatjump.halve` |
| Bank ▶ (0x3D) | | `track.{focus}.beatjump.fwd` | `…beatjump.double` (lampje `invert`) |
| Pan / Sends / User (0x57–0x59) | | `track.{focus}.loop.in` / `.loop.out` / `.loop.reloop` | |
| Lock (0x3F) | | `transport.quantize` | idem |
| | grid-modus (edit) | `track.{focus}.grid.lock` (ongewijzigd: open mapje wint) | idem |
| Stop All Clips (0x51) | | `track.{focus}.brake` (geen LED op het apparaat) | |
| Bank (0x67) | | vrij (keylock, VRAGEN I4) | vrij |

83 regels erbij: 291 → 374, mapping-versie blijft 3 (formaat niet veranderd).
Geen generator gevonden (git-log/tools/test); met een eenmalig script erin gezet,
op logische plekken in het bestand (shift+activator na elke activator, rechts na
On/Off, scene 5 na scene 5, klank-pads achteraan).

### Keuze: Shift + scene 5 voor klank
Scene 5 is "loop weg" en moet één druk blijven. Shift + scene 5 was vrij, zit
direct onder de vier andere modusknoppen, en met shift vast licht scene 5 in de
klank-kleur op (dicht = donker magenta): zichtbaar dat hij er is. Vasthouden =
gluren, net als de andere modusknoppen (getest). In klank brandt scene 5 fel
magenta via `led.lees: layer.grid.klank` (zoals Metronome in de grid-modus); de
knop blijft loop weg. Nadeel: in klank toont scene 5 niet of er een loop loopt
(Clip Stop per kolom wel).

### Kleuren (B4)
- Modus klank: magenta 53 / dicht magentadonker 54. Niet rood (= loop weg op
  dezelfde knop, en wissen), niet violet/blauw (sampler/video erboven).
- Kill: fel rood (5) = band weg, rooddonker (6) = open, uit = lege track.
- Rem: fel oranje (9) = remt, oranjedonker (10) = speelt, uit = stil.
- Op de maat: fel groen (21) = wacht op de maat (brandt, knippert niet), groendonker
  (22) = stil (kan starten), uit = speelt al/leeg. Rij 4 en 5 vullen elkaar aan.
- Enkelkleurig rechts: Lock = quantize aan; Bank ◀ ▶ aan zolang je drukt (uit
  zonder grid); met shift ◀ = halveren kan nog, ▶ = verdubbelen kan nog.
- `KLEURSCHEMA` voor kill/brake/play.quant is veranderd (was donkergrijs als "uit");
  die actions hingen nog nergens op de APC, dus alleen de nieuwe regels merken het.
- `feedback.js`: `led.lees` bepaalt nu ook de KLEUR (kleurVoor van de lees-action)
  en de tel. Voor Metronome maakt dat niets uit (enkelkleurige LED).

### Scherm
- Spiegel: `MODUS_KLEUR.klank = 'magenta'` (`--m-klank`), klank-pads in de kleur van
  hun LED (kill rood, rem oranje, op de maat groen; CSS op data-action). `leesControl`
  geeft `lamp`/`lampOm` (led.lees/led.invert), dus het scherm licht op zoals de LED
  (scene 5 in klank, shift+Bank ▶, en ook Metronome in de grid-modus).
- Mapje-balk: bij een wissel naar een grid-modus waar elke kolom per rij hetzelfde
  doet (`gridRijen`): "1 kill hoog zolang je drukt · shift: kill hoog aan/uit …".
  Geldt vanzelf ook voor hotcues en loops (zelfde code); sampler/video niet.
- apc.html: knop klank (magenta), soort "kill & rem" (oranje) vóór mixer
  (`track.1.kill.high` eindigde op `.high` en viel anders onder mixer), beatjump,
  play.quant en transport.* onder transport. Detail-tabel: eerste kolom mag
  afbreken (de lange modusnaam duwde de tabel buiten het paneel).
- `LAAGNAAM['grid.klank'] = 'klank (kill · rem · op de maat)'`.

## Clay's eigen mapping (GET http://localhost:8777/api/mapping, één keer, niets gepost)

Op de server stond nog zijn VOLLEDIGE kopie (291 regels, 30 784 bytes, geen `kind`):
de standaard `35823dda-291` + 4 rack-knoppen. Met de code van vóór deze branch
zou omzetten tegen de nieuwe standaard geven: 4 regels + **83 weggehaald** — de
modus klank en alle nieuwe knoppen zouden nooit op zijn APC komen (precies de val
die MAPPING-VERSCHIL.md beschreef).

Opgelost in commit 2: het standaardbestand draagt `eerder` (de voorganger
`35823dda-291` als verschil met de huidige regels, gecontroleerd op vingerafdruk);
`laadEigen` zet een oude kopie af tegen de standaard waar hij het dichtst bij ligt
(`verschilVanKopie`). Uitkomst met zijn echte kopie en deze code (`laadEigen` met
een nep-fetch):

- laadEigen: omgezet, standaardNieuw, 4 eigen, 0 weggehaald, 374 regels, 0 fouten
- eigen verschil daarna tegen `e2bef131-374`: precies cc:0:20–23@device.rack =
  video.fx.pixel / rgb / trails / grain, 0 removed
- alle 83 nieuwe regels geladen; geen nieuwe regel op een van zijn 4 sleutels
- geladen mapping t.o.v. zijn kopie: +83 regels, 0 weg
- Bij opstarten bewaart de app dat verschil (4 regels) meteen op de server; de melding
  zegt "… en de bijgewerkte standaard staat er al op".

Onderhoud: na elke wijziging aan `mappings/apc40mk2.json` `node tools/mapping/eerder.mjs`
draaien (HEAD wordt een voorganger; idempotent, ook twee keer draaien verliest niets);
`mapping.test` faalt anders.

## Tests (nice -n 10)

- Gericht: mapping 247, feedback 130, spiegel 60, learn 39 — groen.
- Nieuw: modus klank per (rij, kolom) × 8 × 5 met en zonder shift; kill-drukknop
  indrukken/loslaten ook met shift ertussen; shift+pad = schakelaar; Shift + scene 5
  kort = vast, lang = gluren; ▲ ▼ rond; rechts naar {focus}; Lock in edit = slot;
  Bank vrij; vorm-fragment wint op Bank ◀ ▶; LED-kleuren (klank, kill, rem, op de maat,
  Lock, Bank met/zonder shift, Pan/Sends/User, Stop All zonder LED); spiegel lamp/lampOm;
  mapje-balk rijen; leren in klank; eerdere standaarden + Clay's omzetting end-to-end.
- Aangepast: "en rond" (5 modi), "lege plek" (Pan is niet meer leeg → Bank).
- `node test/alles.mjs`: 36 bestanden, 3248 checks, alles groen. Commit 1 apart op de
  index getest (`tools/git/test-index.sh`): alles groen. Geen tijdchecks die faalden.

## Headless (VARVE_KIJK_POORT=8931, VARVE_KIJK_DEBUG=9531, geen MIDI)

`tools/headless/apc-klank.mjs` — 45 checks groen: Shift + scene 5 opent klank,
mapje-balk, LED-bytes uit `feedback.desired()` op het APC-profiel (niets verstuurd),
kill-pad indrukken (hoog weg, LED 5) en loslaten (terug), Shift + kill laag vast/los,
Bank ▶ beatjump 4 tellen (10,000 → 11,935 s), Shift + Bank ▶ = 8 tellen, Bank ◀,
Pan loop in, Sends loop out (~1,3 s), User reloop, Lock quantize om + lampje, Lock in
grid-modus = slot, Stop All = rem → stil na 1 s, ▼ rond; apc.html: nieuwe knoppen met
uitleg en soort, knop klank, detail, shift. Foto's: `scratchpad/bouw/foto/`
(klank-modus.png, klank-kill.png, apc-kaart-klank.png, apc-kaart-klank-shift.png).
`kijk.mjs` als regressie: 67 checks groen.

## Niet getest

- Niets op het echte apparaat: of magenta 53/54, rooddonker 6, oranjedonker 10 en
  groendonker 22 op de APC goed van elkaar en van fel te onderscheiden zijn; het
  knipperen van Pan/Sends/User (enkelkleurig, `tel: 'aan'`); de drukknop-kill met
  echte aanslagen.
- Clay's omzetting in zijn eigen browser (alleen nagerekend met een nep-fetch op zijn
  echte kopie); de melding bij opstarten niet gezien.
- Met `?vormen=1` en het mapje vorm open: shift + Bank ◀ ▶ = beatjump-lengte (de
  shift-regel gaat voor het mapje, zoals overal), niet de vormlaag.
- De Q bij Lock op het scherm (spoor3/transport-rest) zit niet in deze branch; de
  spiegel toont op Lock nu "quantize" uit de mapping.

## Voorstel CLAUDE.md-tekst

Onder MAPJES (en "De standaardmapping (291 regels)" → 374):

> - Grid-modus KLANK (Clay 25 sep, "Voorstel A", docs/APC40.md): vijfde grid-modus,
>   Shift + scene 5 (scene 5 zelf blijft één druk "loop weg") of ▲ ▼. Per kolom:
>   rij 1–3 kill hoog/mid/laag als drukknop (`.hold`), shift + pad = schakelaar;
>   rij 4 rem; rij 5 op de maat starten. Magenta; in klank brandt scene 5 magenta
>   via `led.lees` (lees geeft ook de kleur). Rechts (focus): Bank ◀ ▶ beatjump
>   (shift ½/×2), Pan/Sends/User loop in/out/reloop, Lock = quantize (in de
>   grid-modus het slot: het open mapje wint), Stop All = rem; shift + nummer =
>   op de maat. Bank (0x67) blijft vrij voor keylock (VRAGEN I4).
> - Het standaardbestand draagt zijn voorgangers (`eerder`, verschil met de huidige
>   regels, gecontroleerd op vingerafdruk). Een oude VOLLEDIGE eigen kopie wordt
>   afgezet tegen de standaard waar hij het dichtst bij ligt (`verschilVanKopie`),
>   anders gelden nieuwe standaardregels als "weggehaald". Na elke wijziging aan
>   `mappings/apc40mk2.json`: `node tools/mapping/eerder.mjs` vóór de commit.

En in de bullet over de DRUKvariant: "voorstel voor vrije knoppen (Lock, Detail View)"
klopt niet meer — Lock is quantize.
