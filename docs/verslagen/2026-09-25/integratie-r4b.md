# Integratie ronde 4b: 25 september 2026

Branch **`integratie-r4b`**, afgetakt van `integratie-r4a` (35ddad1, niet verzet).
Eindcommit **4aa00d7**. Worktree `agent-a448b1f986c154fec`, aan het eind
`git switch --detach`. Niet gepusht, niet naar main. Geen worktrees of branches
weggehaald. Geen `fatal: stash failed` gezien. Niets met " 2" in de naam
gecommit (`git ls-files | grep " 2"` leeg), `git add` alleen per pad.

## Commits (first-parent)

| commit | wat |
|---|---|
| 346d326 | merge `spoor3/beamer-inloop-2`: conflict in video-mixer.js en beamer.mjs |
| 31c1cb3 | merge `spoor3/apc-indeling`: conflict in feedback.js (lampje play.quant) |
| ac70732 | merge `spoor3/docs`, geen conflict |
| 9b34826 | docs: TODO's voor APC-indeling en beamer-inloop ingevuld |
| 4aa00d7 | naden: kijk.mjs (Lock = quantize, niets dubbel, foto) en mapping.test (shift + Bank in mapje vorm) |

Elke merge met `git merge --no-edit`, daarna een Nederlandse boodschap met de
twee regels (`commit -F` bij een conflict, `commit --amend -F` bij docs).

## Conflicten

1. **beamer-inloop-2, `src/video/video-mixer.js`, `_volg`.**
   - De inloop geeft `doel` terug (voor `inDePas` in `_bijwerken`) en rekende het
     nog als `position - vertraging * rate`, met `speelt: deck.playing`.
   - r4a (hoorbaar.js/transport/rem): `naVertraging(position, vertraging,
     snelheid ?? rate)`, `rate: snelheid`, `speelt: playing && !wacht`.
   - Beide: `const snelheid = deck.snelheid ?? deck.rate; const doel =
     Math.max(0, naVertraging(...))`, dat doel naar synchroniseer én terug voor
     inDePas. Zo meet de inloop tegen precies het doel dat volg gebruikt, ook
     tijdens een rem en tijdens het wachten op de maat (video staat stil op doel).
   - De seekDuur-meting (`seekStart` tot `seeking` false) van de inloop gehouden.
2. **beamer-inloop-2, `tools/headless/beamer.mjs`.** De inloop-branch zette het
   hele eerste deel in `if (!ALLEEN_INLOOP)` (inspringing). Hun versie genomen,
   de twee stukken van r4a (maatbron 'tel' aanzetten; de vormknop beweegt mee met
   alleen het losse venster) ingesprongen teruggezet. `git diff spoor3/beamer-inloop-2`
   toont daarna precies die twee stukken; `git diff -w integratie-r4a` verliest
   niets van r4a.
3. **apc-indeling, `src/control/feedback.js`, KLEURSCHEMA `play.quant`.**
   - apc-indeling (op r3: read wacht 1, stil 0, speelt null): fel groen = wacht,
     donkergroen = stil, uit = speelt.
   - r4a (transport-rest): read wacht 1, speelt 0,5, stil 0 (drukken op een
     spelende = pauze), schema aan groen / half groendonker / uit donkergrijs.
   - Gekozen: r4a (de brief: vol = wacht, gedimd = speelt, grijs = stil). Het
     lampje volgt dus de read, ook in de modus klank op rij 5. Aangepast:
     feedback.test (stil = donkergrijs, speelt = donkergroen, wacht = groen,
     leeg = uit), apc-klank.mjs (speelt = 22 terwijl track 1 speelt, stil = 1
     na de rem) en docs/APC40.md. Als vraag J31 in VRAGEN.

## Naden

- **Q bij Lock.** Met de standaardmapping van apc-indeling is Lock (`note:0:63`)
  `transport.quantize`; `herbereken()` in spiegel.js verbergt de Q dan. kijk.mjs
  (mapping-onafhankelijk van r4a) groen: "Q bij Lock: weg (Lock:
  transport.quantize)", Lock zelf quantize → weg, grid-modus → Q terug
  (Lock = `track.1.grid.lock`), regel terug → zelfde stand. Nieuw in kijk.mjs:
  standaardmapping = Lock quantize en Q weg; quantize staat één keer zichtbaar in
  `#focusdeel` en het lampje van Lock gaat uit → aan (eerste run faalde op een
  vaste wachttijd van 300 ms: headless rendert traag, nu pollen tot 3 s).
  Schermafdruk `scratchpad/r4b/uit/focusdeel-lock-quantize.png` bekeken: rij
  device-knoppen "◀ rack · rack ▶ · ◀ spring · spring ▶" en "fx aan/uit ·
  quantize (licht op) · strip/rack", geen Q; loop in/out/reloop op
  Pan/Sends/User, rem op Stop All. Niets dubbel.
- **apc-indeling tegenover transport-rest, fx-hellingen, ingest-rest-2.**
  mapping 249, feedback 131, spiegel 61, learn 39, engine 613 groen;
  apc-klank.mjs 46 ok (was 45; +1 speelt = donkergroen). De mapje-balk zegt voor
  rij 5 nu "starten op de volgende maat van de maatgever (speelt hij: pauze)" (label
  van r4a). Beatjump in apc-klank (10 → 11,935 s, 8 tellen terug) blijft ruim binnen
  het nummer, dus de nieuwe weigering voorbij het einde raakt hem niet. Kill via de
  pad gaat via `killEqBand(..., startDrempel)`: kill-pad in/uit groen.
- **`eerder`.** `node tools/mapping/eerder.mjs` op de merge: "standaard
  e2bef131-374, 1 voorganger: 35823dda-291 (+0 / −83) — alle terug te rekenen";
  `git diff` op mappings/apc40mk2.json leeg (ook t.o.v. spoor3/apc-indeling).
  r4a veranderde de mapping niet. mapping.test groen.
- **`?vormen=1`.** mapping.test had al "mapje vorm: Bank ◀ ▶ kiest de vormlaag".
  Erbij: shift + Bank ◀ ▶ in het mapje vorm = `beatjump.halve/double` (de
  shift-regel gaat voor het mapje; bewust, gemeld in CLAUDE.md en VRAGEN J33) en
  Detail View blijft `layer.device.detail` (de standaard heeft geen regel op
  note:0:65). kijk.mjs: "Detail View opent het mapje vorm" groen.
- **beamer-inloop tegenover r2/r3/r4a.** Zie conflict 1 (snelheid, wachten op
  de maat). beamer.js en volg.js hadden in r4a geen wijzigingen. Vormlagen
  640×360: tijdens de inloop zet het hoofdvenster zijn volledige beeld (met
  lagen) op het losse canvas; alleen de mengende mixer roept `laag.frame` aan,
  dus de maatbron-haak van r4a krijgt één aanroeper. beamer.mjs: zie Headless.

## Clay's mapping na herladen

Eén GET `http://localhost:8777/api/mapping` (200, 30 784 bytes, identiek aan de
kopie van apc-indeling), niets gepost. Nagerekend met de eindcode
(`scratchpad/r4b/clay-na-herladen.mjs`, laadEigen met een nep-fetch die alleen
leest; uitvoer `clay-na-herladen.txt`):

- zijn kopie: 291 regels, geen `kind` (volledige kopie), rust op 35823dda-291;
  eigen t.o.v. die standaard: cc:0:20–23@device.rack = video.fx.pixel / rgb /
  trails / grain, 0 weggehaald;
- laadEigen: bron server, omgezet, standaardNieuw, 4 eigen, 0 weg, **374 regels**,
  0 fouten;
- eigen verschil daarna tegen e2bef131-374: precies die 4 regels, 0 removed;
- alle 83 nieuwe standaardregels geladen, geen op een van zijn 4 sleutels;
  alles uit zijn kopie nog geladen; t.o.v. zijn kopie +83, 0 weg;
- steekproef: Lock = transport.quantize, Bank ▶ = beatjump.fwd, Shift + scene 5 =
  layer.grid.klank.
- Bij opstarten bewaart de app dat verschil (4 regels) op de server en meldt:
  "je eigen mapping staat nu als verschil met de standaard (4 eigen regels):
  nieuwe standaardregels komen voortaan vanzelf binnen — en de bijgewerkte
  standaard staat er al op".

## Docs

Ingevuld (uit apc-indeling.md en rest-beamer-inloop.md):
- CLAUDE.md: TRANSPORT (APC-plekken; play.quant als play: speelt pauze, wacht
  annuleren, remt los, en zijn lampje; Lock = quantize, de Q alleen als Lock iets
  anders doet), MAPJES (374 regels, grid-modus klank), de `eerder`-regel met
  "Na elke wijziging aan mappings/apc40mk2.json: node tools/mapping/eerder.mjs",
  seekduur tot `seeking` false, INLOOP (toonBeeld, loopIn, 0,3 s / 50 ms / 20 s,
  hoofdtabblad verborgen), shift + Bank in het mapje vorm, Lock in de grid-modus,
  structuur (apc-klank.mjs, tools/mapping/, beamer.js inloop). De .hold-regel
  zei al "Lock werd quantize" (docs-branch). Vervangen tekst geschrapt.
- HANDOFF: bouwlijst 12 (APC-indeling) en 13 (beamer-inloop), de melding bij
  herladen (374 regels, 4 eigen, nagerekend), transport zonder "Q op Lock", de
  APC-proef in proeflijst 6, de inloop in proeflijst 4, "niet getest" voor beide.
- ROADMAP 16 (voorstel A afgevinkt) en 18 (inloop).
- VRAGEN J27–J28 (inloop) en J29–J33 (APC-indeling), elk met advies.
- VERBETERINGEN: voorstel A gebouwd (31c1cb3), beamer-inloop afgevinkt, twee
  kleine open punten.

**Nog open voor de hoofdsessie (bewust laten staan):**
- grid-past: CLAUDE.md (Beatgrid, TWEEDE KANS), ROADMAP 24, HANDOFF 14, VRAGEN
  (onder J33), VERBETERINGEN (ronde 4, Beatgrid);
- eindstand: ROADMAP (regel 17) en HANDOFF BEGIN HIER (eindbranch, eindcommit,
  testuitkomst).

## Tests

- `nice -n 10 node test/alles.mjs` op de eindcommit: **36 bestanden, 3370 checks,
  alles groen** (r4a: 3242). Load ~5–9. Uitvoer `scratchpad/r4b/alles-eind.txt`
  (ook een eerdere run na de docs-merge: 3370 groen, `alles-1.txt`).
- Per bestand o.a.: engine 613, mapping 249 (+2 van mij), feedback 131, spiegel 61,
  learn 39, video 143.

## Headless

Na elkaar, poorten 8951/9551, uitvoer en foto's in `scratchpad/r4b/` en `r4b/uit/`
(`headless.log`, load 3–9):

| script | uitkomst | tijd |
|---|---|---|
| kijk.mjs | 77 ok (eerste run 1 FAIL: vaste 300 ms voor het lampje, nu gepold) | – |
| apc-klank.mjs | 46 ok (374 regels, klank, speelt = donkergroen, stil = donkergrijs, apc.html) | – |
| toon-keten.mjs | 33/33 | 47 s |
| library.mjs | 56 ok | 15 s |
| kijk-ingest.mjs | 35 ok, ook "server herstart" | 22 s |
| vorm-maat.mjs | 24 ok | 20 s |
| vormen-plaat.mjs | 26 × 16:9, 0 vierkant, 0 leeg, 0 fout | 30 s |
| beamer.mjs | 47 ok | 176 s |

beamer.mjs: sync zichtbaar −16,9 ms gem. (|16,9|, drempel 17: krap), verborgen
−10,2 ms; inloop acht tracks: 0 van 1325 beelden missen een track, grootste fout
86 ms, overname na 5,8 s, daarna alleen het losse venster (eigen video's 2 ms).

Bekeken met Read: `focusdeel-lock-quantize.png` (Lock = quantize, brandt, geen Q),
`apc-kaart-klank.png` (apc.html: klank, quantize op Lock, loop in/out/reloop op
Pan/Sends/User, spring op Bank, rem op Stop All), `klank-modus.png` (spiegel in klank,
mapje-balk rij 5 "starten op de volgende maat van de maatgever (speelt hij: pauze)").

## Niet getest

- Niets in Clay's Chrome, niets op de APC, niets beluisterd. :8777 alleen de
  ene GET.
- **Na het mergen de server op :8777 herstarten** (r4a veranderde de server; r4b
  niet). Clay herlaadt daarna zijn tabblad: dan pas wordt zijn kopie echt omgezet.
- De nieuwe lampkleuren (magenta 53/54, rooddonker 6, oranjedonker 10, groendonker
  22 tegen donkergrijs 1) op het apparaat; shift + nummer (eenkleurig) brandt nu ook
  als de track speelt (half = aan op een enkelkleurige LED).
- De inloop op de M1 zonder andere belasting, met echte YouTube-video's; inloop
  na herladen of terughalen met acht tracks (alleen met één video).
- play.quant/rem/inloop samen: een remmende of wachtende track tijdens de inloop
  alleen via de gedeelde `doel`-formule, niet apart gemeten.
