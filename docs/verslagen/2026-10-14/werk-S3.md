# Werkruimte S3: de kern (14 okt 2026)

Tak `werk/S3` (vanaf `werkruimte/integratie` 72f15c3, met S0), worktree buiten iCloud, niet
gepusht. Ontwerp: `docs/WERKRUIMTE.md` A–C en D4 "S3". Voor wie eraan komt en voor Clay:
`docs/werkruimte/S3.md` (§2 = zelf een werkruimte maken, stap voor stap).

## Kort

Werkruimtes als DATA. Een bestand zegt per deel (MIX, STEMS, FX …) welke mapjes open gaan op welk
apparaat en welke rijen/panelen op het scherm; een deel kies je met één knop (tab, `werk.deel.*`,
of het volgt de APC), en het zet nooit een klank. Zonder werkruimte (`standaard`) is VARVE
regel voor regel wat hij was. Clay vult de indeling zelf in; S3 levert het mechaniek, één echt
stuk (THUIS) en drie VOORBEELDEN.

## Gebouwd

1. **Model** (`src/werk/model.js`, puur, geen imports): `normaliseerWerkruimte` met de regels van B3
   (fouten en waarschuwingen apart), `normaliseerStuk`, `samenstellen` (per apparaat de fragmenten,
   nieuwe mapjes en volgorde), bereikbaarheid, kleurcontrole, `telNieuwePlekken` (> 12 = waarschuwing),
   de kern (8 × 8 + 18 APC-controls; ⇧ A|B, ⇧ Lock, ⇧ master-knop vrij) en `BESCHERMD` (geen houd/druk/
   latch op play, cue, play.quant, hotcue.*, load.*, layer.*). Server en mixer gebruiken hetzelfde.
2. **Runtime** (`src/werk/werkruimte.js`, `apparaten.js`): deel, wie koos (`door`), onthoud, volgt
   (geen lus), THUIS, vereist/terugval (één melding; terug = melding met knop), vastleggen (tweede
   druk binnen 3 s, met versie; een conditie blijft een conditie), peilen elke 2,5 s met de ETag (meestal 304). APC-adapter = kiesknoppen
   via `layer.*` op de bus. Stukken als fragment `stuk:<naam>`, eigen regels als `werk:<naam>`.
3. **Actions** (`src/control/acties-werk.js`): `werk.deel.<naam>`, `.1–8`, `.next/.prev`, `werk.thuis`,
   `werk.vastleggen`, `werk.kies` (alleenScherm). Allemaal `log: 'overslaan'`, `beginstand: false`.
   Uitleg in `src/ui/beschrijf/werk.js`.
4. **Werk-balk** (`src/ui/werk-balk.js`, `src/ui/css/werk.css`): tabs in hun kleur, wie het koos,
   "⚠ N nieuw", THUIS, de kiezer (voorbeelden met "(voorbeeld)"), "leg vast in <deel>",
   `voegKnopToe(el)` voor andere sporen. `hidden` met `standaard`. Eén regel (30 px; tot 1000 px hoog 26 px, en dan
   haalt `werk.css` de hoogte van de mixer zelf af, zie Review ronde 1).
5. **Server** (`server/werkruimtes.js`, `server/routes/werkruimtes.js`): lijst, lezen (ETag), PUT met
   versie (409 met de huidige inhoud), atomisch, `.versies/<naam>/`, `…/versies`, 400 met reden en
   niets geschreven. **W1: PUT alleen vanaf deze Mac** (`ctx.vanDezeMac`); via Tailscale 403.
6. **Standen**: `werkruimte: { naam }` in een stand; activeren = die werkruimte bij de volgende start.
7. **Data**: `mappings/stukken/basis.json` (⇧ master-knop = THUIS), `tools/werkruimtes/voorbeelden/`
   (`standaard`, `apc-alleen`, `twee-handen`), `.gitignore` `/werkruimtes/`.
8. **Aanhaker** (`src/ui/aanhakers/werk.js`): start met `?werk=`, anders een net geactiveerde stand,
   anders `localStorage 'varve.werkruimte'`, anders `standaard`.

## Gemeten (in deze container)

| wat | commando | uitkomst |
|---|---|---|
| model | `node test/werkruimte-model.test.mjs` | groen (o.a. standaard = de mapping van vandaag deepEqual incl. Clay's 4 regels; apc-alleen = standaard + 74 regels van de stukken, 0 botsingen) |
| runtime | `node test/werkruimte.test.mjs` | groen; deelwissel JS mediaan 0,078 ms (max 0,114), LED-tik erna 0,688 ms (met de hand 0,701), diff in één tik, 0 invokes buiten layer.*/werk.* |
| server | `node test/werkruimte-server.test.mjs` | groen (409, .versies, 400 niets geschreven, W1 403, standen) |
| S0-toets | `node test/aanhaakpunten.test.mjs` | groen (zie "buiten de grens") |
| headless | `VARVE_CHROME=<no-sandbox wrapper> node tools/headless/werkruimte.mjs <uit>` | 28/28 ok; Claude-bestand in de mixer na 432 ms |
| kijk | `VARVE_KIJK_POORT=8934 VARVE_KIJK_DEBUG=8935 node tools/headless/kijk.mjs <uit>` | Alles groen |
| rijen | `VARVE_KIJK_POORT=8932 VARVE_KIJK_DEBUG=8933 node tools/headless/rijen.mjs <uit>` | 88/88 ok, dan blijft hij hangen bij de wissel naar de focus op het instrument (1440 × 790); op de basis `werkruimte/integratie` (8936/8937) precies zo: de 105 regels uitvoer zijn identiek (`diff`). Omgeving (swiftshader, drukke container), niet S3; S0 haalde hier 565/565 op een rustiger moment |
| alles | `node test/alles.mjs` | 106 bestanden, 9402 checks; rood alleen de bekende van de container: renderblok "keylock met wissels … bytes per bericht", wachtrij "yt-dlp en zijn kind" (2×), instrumenten-fm-schaal "geen afval per blok". De eerste ronde was ook sampler-drums en beeld-meting rood ("VARVE_WERKRUIMTES niet gedekt"): opgelost, beide los groen |

## Buiten de grens

- `test/aanhaakpunten.test.mjs` (van S0): de check "de drie routebestanden zijn leeg" kon niet blijven
  zodra S3 zijn routebestand vult. Vervangen door wat blijft gelden (elke route hoort bij een spoor en
  zit onder `/api/`). In review ronde 1 kwam de andere helft terug: `mag` moet leeg blijven (S3 heeft
  `mag: []`). Geen andere test aangepast.
- `tools/headless/sampler-drums.mjs`, `sampler-drums-stems.mjs` en `beeld-lokaal.mjs` (`PROEF_PADEN`,
  `proefEnv`): `VARVE_WERKRUIMTES` in de tijdelijke map erbij. Hun toetsen (sampler-drums.test,
  beeld-meting.test) eisen dat elke VARVE_-variabele van de server een proefpad heeft; de server leest
  nu ook `VARVE_WERKRUIMTES`. Zeven andere headless tools zetten hem (nog) niet: hun proefserver LEEST
  dan `werkruimtes/` van de map waar hij draait, en schrijft alleen bij "leg vast" in een werkruimte
  (ze draaien met `standaard`, dus niet). Netjes maken bij de volgende ronde.
- `CLAUDE.md`: alleen de structuurregels van de nieuwe bestanden en één korte alinea onder S0.
- `docs/WERKRUIMTE.md`: alleen "Gebouwd" onder S3.

## Niet gedaan

- De Maschine-adapter (S6). Vereist/terugval is getoetst met een nep-adapter.
- Superknoppen, bussen, panelen en `schermen` worden gevalideerd maar niet toegepast (S4, S7, S8).
- De stukken `uitlijn`, `fx-matrix`, `mix-extra` (S1/S4/S8): in de voorbeelden geven ze nu een
  waarschuwing en ontbreken die mapjes in de `volgt`-lijst (overgeslagen).
- W3: geen effecten die de engine raken.

## Alleen op het apparaat te bevestigen

- Dat ⇧ master-knop op de echte APC (in 0x42) als shift-variant aankomt (gelezen uit de mapping; de
  nep-APC stuurt dezelfde bytes).
- Of `vanDezeMac` ook met `tailscale serve` de iPad tegenhoudt (de koppen zijn een AANNAME, zoals bij
  `/api/mixer`).
- De LED-wissel op het apparaat: hier is alleen de tik gemeten, niet de lampjes zelf.

## Vragen voor Clay

1. Moeten de voorbeelden `apc-alleen` en `twee-handen` blijven, of liever alleen één klein voorbeeld?
   (Nu drie, omdat de acceptatie ze noemt; ze staan als "(voorbeeld)" in de kiezer.)
2. W1: zodra de iPad mag schrijven, alleen werkruimtes of ook delen kiezen (`werk.deel.*`)?
3. Mag "leg vast" ook op de APC (nu alleen op de balk en als action)?

## Volgende versie

- Een bewerker op het scherm (zoals de stand-bewerker): delen, kleuren, mapjes kiezen uit lijsten.
- "Terug naar de vorige versie" in de kiezer (de route `…/versies` is er al; S8).
- De vrije plekken zichtbaar maken in apc.html (welke knop een werkruimte nog mag gebruiken).

## Review ronde 1 (14 okt)

Hersteller op dezelfde tak. Per punt van de review: opgelost, of weerlegd met bewijs.

**Blokkerend: op 1440×790 scrolde de mixer met een werkruimte en een open rij.** Klopte (zelf nagemeten met
de proef van de reviewer, `herstel-S3/maat.mjs`: apc-alleen + stems = scrollHeight 804, #rijen 35 px). Oorzaak:
`main` wordt nooit lager dan zijn min-content, en die is het FOCUSDEEL (677 px inhoud); met `standaard` en
twee rijen open is er al 0 px over, dus 30 px balk ging van de pagina af. Opgelost zonder styles.css of
index.html: `werk-balk.js` zet `body.werk-balk-aan` alleen als de balk verschijnt of verdwijnt (een gewone
klas, geen `:has()`, niet per deelwissel), en `werk.css` haalt tot 1000 px hoog 30 px van de mixer af:
topbar 8 → 3 px boven en onder (−10), de balk 30 → 26 (−4), main 8 → 4 px boven en onder (−8), de kolom
rechts in het focusdeel gap → 4 px (−10). Tot 1000 px en niet tot 900: op 901 px valt de compacte stand van
styles.css weg en scrolde apc-alleen met instrument + patronen 938 > 901 (gemeten). Met `standaard` geldt
niets hiervan.

| hoogte | geval | standaard (scroll / #rijen / fader) | apc-alleen vóór | apc-alleen na |
|---|---|---|---|---|
| 790 | geen rij | 790 / 0 / 110 | 790 / 0 / 84 | 790 / 0 / 106 |
| 790 | stems | 790 / 40 / 110 | **804** / 35 / 93 | 790 / 40 / 110 |
| 790 | instrument + patronen | 790 / 51 / 110 | **804** / 35 / 93 | 790 / 53 / 102 |
| 790 | stems + master | 790 / 51 / 110 | **804** / 35 / 93 | 790 / 53 / 102 |
| 901 | instrument + patronen | 901 / 47 / 56 | **938** / 35 / 56 | 901 / 39 / 56 |
| 930 | instrument + patronen | 930 / 76 / 56 | — | 930 / 68 / 56 |
| 1001 | instrument + patronen | 1001 / 109 / 94 | — | 1001 / 109 / 64 (balk 30 px) |

Commando: `H=<hoogte> node herstel-S3/maat.mjs` (de proef van de reviewer met poort 8935/8936 en de hoogte als
variabele; in de scratchpad, niet in de repo). In de repo: `tools/headless/werkruimte.mjs` toetst nu op
1440×790 per deel (MIX, STEMS, FX, SPELEN, BEELD, via `werk.deel.*`): de pagina scrolt niet, faders ≥ 56 px,
#rijen ≥ 40 px als er een rij open staat, en `body.werk-balk-aan` aan/uit met de balk. Op de oude werk.css
faalt die toets 4× (804 > 790); na de fix 33/33 ok.

**Klein, opgelost:**
- `test/aanhaakpunten.test.mjs`: de check "mag is leeg" staat er weer naast de routecheck.
- `tools/headless/werkruimte.mjs` zet ook `VARVE_KAART`, `VARVE_KAART_DB`, `VARVE_HUB_SETS` en `VARVE_UITZEND_UIT`
  in de tijdelijke map (zoals `proefEnv` van beeld-lokaal.mjs).
- "binnen 3 s": peilen elke 2,5 s (`PEIL_MS`), zodat een bestand van Claude met de rondgang erbij binnen 3 s
  staat. Headless: 480, 2011 en 2327 ms in drie runs; de toets eist nu ≤ 3000 ms (was ≤ 3500).
- vastleggen: een conditie (`{ als, dan, anders }`) blijft staan als ze NU precies het open mapje geeft;
  opende je zelf iets anders, dan wordt dat het deel (werkruimte.test, SPELEN: device blijft de conditie;
  na Clip/Device View → rack wordt het `rack`). Op de oude code faalt die check.
- localStorage `varve.werkruimte` wordt alleen geschreven als de NAAM verandert, niet bij elke deelwissel
  (die kan uit een MIDI-bericht komen).
- `controleerAanwezig` tijdens kies/peil: niet weggooien, onthouden en daarna nog eens kijken (`_nogEens`,
  `_klaar`). Toets: de Maschine valt weg terwijl twee-handen zijn stukken laadt → daarna alsnog apc-alleen,
  één melding. Faalt op de oude code.
- Herladen na peilen: alleen de apparaten waarvoor het deel echt veranderde krijgen hun mapjes opnieuw; loops
  die je in MIX met de hand opende blijft open als Claude iets anders in het bestand veranderde, en volgt
  het nieuwe deel als juist MIX voor de APC veranderde. Faalt op de oude code.

**Klein, niet veranderd (met reden):**
- De zeven andere headless tools zonder `VARVE_WERKRUIMTES`: buiten de grens van S3. Ze starten met
  `standaard` en lezen dan hooguit `werkruimtes/` (GET /api/werkruimtes voor de kiezer); schrijven gebeurt
  alleen bij "leg vast" in een werkruimte. Netjes maken als die tools zelf aan de beurt zijn.
- Maschine aanwezig = de nep-poort van de hub: klopt, die volgt de hubverbinding. De hub meldt
  `apparaten["maschine-mk2"].verbonden` alleen aan de cockpit (PROTOCOL §17), niet aan een lease-app;
  dat aan VARVE doorgeven raakt hub.js en de hub zelf. Hoort bij de Maschine-adapter van S6
  (`registreerApparaat('maschine-mk2', { aanwezig })` gaat dan vóór de terugval in `aanwezigVan`).
- "⚠ 74 nieuw" bij het eerste gebruik: dat is eerlijk (A11 telt wat anders doet dan de vorige keer; de
  eerste keer is dat tegen de standaard). Vraag 4 hieronder.
- apc-alleen met een NAMAAK van de stukken: de test neemt het echte bestand zodra het bestaat
  (`existsSync`). Nagelopen met het echte `uitlijn.json` van S1 (tijdelijk gekopieerd uit
  `wt/werk-S1`, niet gecommit): werkruimte-model.test meldt "uitlijn (echt)", 0 botsingen, 0 fouten,
  werkruimte.test groen. fx-matrix en mix-extra bestaan nog in geen enkele worktree.

**Toetsen na het herstel:** `node test/werkruimte.test.mjs`, `werkruimte-model`, `werkruimte-server`,
`aanhaakpunten`, `standen`, `standen-model`, `regels`: groen. `tools/headless/werkruimte.mjs`: 33/33.
`kijk.mjs` (8934/8939): Alles groen. `rijen.mjs` (8932/8933): dezelfde 105 regels als de vorige run en de basis
(`diff`: identiek; 88 ok en dan het bekende hangen bij 1440 × 790 in deze container).
`node test/alles.mjs`: 106 bestanden, 9408 checks, rood alleen de drie bekende van de container
(renderblok "keylock met wissels … bytes per bericht", wachtrij "yt-dlp en zijn kind" 2×, instrumenten-fm-schaal
"geen afval per blok"); werkruimte.test 103 ok.

**Vraag erbij voor Clay:**
4. De eerste keer dat je een werkruimte gebruikt staat er "⚠ 74 nieuw" (tegen de standaard, rood boven 12).
   Wil je dat zo (het advies: niet alles op één avond), of moet de eerste keer stil beginnen?
