# Patronen — het contract (STUDIO S4)

*5 oktober 2026 · het contract voor de bouw van "stukken programmeren zodat je dat weer
kunt mixen". Bron van het tijdmodel: Elektronlearn (`src/core/transport.js`,
`src/devices/elektron.js`, 217 tests), Clay's eigen code.*

---

## 1. Wat het is

Een **patroon** is een stuk muziek van 1–64 stappen dat een **instrument op een track**
speelt (docs/INSTRUMENTEN.md). Een track met een instrument heeft vijf **plekken** voor
patronen — de vijf rijen van het APC-grid, zoals clips in Ableton: kolom = track,
rij = plek. Een patroon starten gaat op de maat; het loopt rond tot je het stopt of een
ander patroon op dezelfde track start. Het klinkt door de strip van de track: fader,
EQ, effect, sends en koptelefoon werken dus vanzelf. Dat is het "weer kunnen mixen".

## 2. Het patroon (data)

```js
{
  id: 'p-…',            // vast, nooit hergebruikt
  naam: 'baslijn',
  lengte: 16,           // stappen, 1–64
  deling: 4,            // stappen per tel (4 = zestienden)
  swing: 50,            // 50 = recht, 66,7 = triool-gevoel (zoals Elektronlearn)
  noten: [              // gesorteerd op stap, dan noot
    { stap: 0, noot: 36, snelheid: 0.8, duur: 1, micro: 0 },   // duur in stappen, micro in stappen (−0,5..0,5)
  ],
}
```

Puur JSON; `normaliseerPatroon()` klemt en sorteert (zoals `normaliseerPlan`). Waar het
bewaard wordt: op de server met een versie (409 bij een botsing), zoals de plannen.

## 3. De klok (regel 3)

- **Met een nummer dat klinkt:** de patronen volgen de **maatgever** van de engine
  (tempo en tel van wat je HOORT, `fxKlok()`, het maat-anker van zijn grid). Draai je
  aan de pitch van de maatgever, dan gaan de patronen mee.
- **Zonder:** een eigen tempo (`patterns.tempo`, standaard 120 bpm, tap mogelijk) met
  een vast anker op de audioklok.
- Een timer beslist alleen WANNEER er gekeken wordt (zoals de auto-DJ); WAT er klinkt
  wordt gepland met `t` op de audioklok, ~120 ms vooruit, via `instrument.noteOn(noot,
  snelheid, t)` en `noteOff(noot, t + duur)`.
- Starten valt op het volgende maatbegin (zoals `play.quant`); stoppen ook, of meteen
  met shift. Stoppen of wisselen: `alleUit(t)` op dat moment (geen hangende noten).

## 4. Opnemen

- **Live:** wat je op het keyboard (of de Maschine-pads) speelt terwijl een patroon
  loopt en opnemen aan staat, komt erin, gekwantiseerd op de stap (overdub).
- **Stap voor stap:** een stap aanklikken (scherm) of een pad indrukken (Maschine in
  stapmodus) zet de laatst gespeelde noot op die stap.

## 5. Bediening

- **Actions** (0..1 / boolean, zoals alles): `track.N.pattern.K` (K = 1..5: starten, of
  stoppen als hij al speelt), `track.N.pattern.stop`, `patterns.tempo`, `patterns.record`
  (aan/uit), en voor het scherm wat er verder nodig is. Ze gaan over de bus, dus in het
  handelingenlog en terug te spelen.
- **APC:** een grid-modus PATRONEN (eigen kleur): pad = plek (rij) op de track (kolom);
  lampje uit = geen instrument, donker = leeg, kleur = gevuld, fel = speelt, knipperen =
  wacht op de maat. Scene 1–5 in deze modus = die rij op alle tracks. Alleen regels ERBIJ
  in de standaardmapping (mapping.test).
- **Scherm:** een PATROON-rij voor de focus-track: plekken 1–5, de stappen (klik =
  noot aan/uit met de laatst gespeelde noot), lengte, swing, opnemen.

## 6. Wat (nog) niet

P-locks (een parameter per stap) en een pianorol: pas als je ze mist. Het
instrument-contract heeft daarvoor later een `zetParam(k, v, t)` nodig.

---

## 7. Gebouwd (5 okt, spoor patronen)

*Op de tak `studio/patronen`. Alles hieronder is gemeten in Node en in een headless
Chrome; niemand heeft het nog gehoord of op de APC gedrukt.*

### 7.1 Bestanden

| Bestand | Wat |
|---|---|
| `src/engine/patronen/model.js` | het patroon en de set als data: `normaliseerPatroon`, `normaliseerSet`, bewerkingen (`metNoot`, `zonderNoot`, `wisselNoot`, `metDuur`, `metLengte`, `metSwing`, `leeg`), `LENGTES`. Puur; ook door de server gebruikt |
| `src/engine/patronen/venster.js` | uit Elektronlearn: `PPQN` 384, `stapTicks`, `swingTicks`, `notenInVenster(p, spel, van, tot)`, `stapOp`. Puur |
| `src/engine/patronen/klok.js` | de patroonklok: klok-tellen ↔ audioklok als gebroken lijn, `richt` op de maatgever, maten. Puur |
| `src/engine/patronen/speler.js` | `PatroonSpeler` (engine.patronen): plannen, starten/wisselen/stoppen, opnemen, reads; `maatVan(deck)` |
| `src/engine/engine.js` | maakt de speler (`engine.patronen`) en stopt een patroon als zijn instrument weggaat (acht regels) |
| `src/control/actions.js` | `bindPatronen` (vanuit `bindEngine`): de actions hieronder |
| `src/control/lagen.js`, `feedback.js`, `devices/apc40mk2.js` | grid-modus `patronen`, de LED-kleuren, `zeegroendonker` (34) in het palet |
| `mappings/apc40mk2.json` | 89 regels erbij (zie §7.5), voorgangers bijgewerkt |
| `src/control/handelingen.js`, `terugspelen.js` | beginstand met de spelende plekken; bewerken overslaan |
| `src/control/noten.js` | de snelheid gaat mee in `'noot'` (één regel) |
| `server/patronen.js`, `server/index.js` | `patronen/<naam>.json` met versie (409), `.versies/`, `/api/patronen` |
| `src/ui/patronen-paneel.js`, `patronen-opslag.js` | de PATROON-rij; ophalen/bewaren met versie, van buiten overnemen, botsing |
| `index.html`, `styles.css`, `app.js`, `renderloop.js`, `apc.html`, `apc-kaart.js`, `apc-beschrijf.js`, `spiegel-plan.js` | knop en rij, kleuren (`--m-patronen`), uitleg, modus op de kaart en het scherm |
| `test/patronen.test.mjs` | model, venster, klok, speler (nep-maatgever, nep-instrumenten), opslag, server en `patronen-opslag.js` tegen de echte server: 118 checks |
| `test/patronen-engine.test.mjs` | de echte engine (mock van Web Audio): actions en reads, een echt deck als maatgever, instrument weg/wisselen, log, terugspelen, de mapping, LED's, uitleg: 55 checks |
| `tools/headless/patronen.mjs` | Chrome: de rij in de app, en de meting op een OfflineAudioContext (§7.7): 22 checks |

### 7.2 De klok, en waar hij van het contract afwijkt

- **Klok-tellen.** Alle patronen delen één klok: een gebroken lijn `{ T, C, R }` (vanaf
  audiokloktijd T tel C, R tellen per seconde). Starten, wisselen en stoppen staan in
  klok-TICKS (384 per tel), niet in seconden: verschuift de klok terwijl een start wacht,
  dan valt hij nog steeds op hetzelfde maatbegin.
- **Volgen** (`Klok.richt`): elke kijkbeurt de volgende tel `a` en de tellengte `L` van de
  maatgever (`fxKlok()` van `syncMaster()`: dezelfde track als sync, bussen en sampler).
  Doellijn: klok-tel N (de dichtstbijzijnde hele) op `a`. Ligt de klok er niet op, dan
  glijdt hij er in één tot twee tellen naartoe (een rechte lijn tot een tel van de
  maatgever, daarna de doellijn). Hij verandert alleen NA wat al gepland is: zo komt elke
  noot precies één keer (geen sprong in de klok = geen dubbele of gemiste noot; het venster
  is halfopen in ticks).
- **Maten**: de klok neemt het maat-anker van de maatgever over (de "1" van zijn stuk, via
  `volgendeVeelvoud`), bij het starten, bij een andere maatgever en na een echte sprong
  (> 0,05 tel). Een pitchwissel en een korte loop laten de maten staan.
  *Afwijking/grens:* springt de maatgever met een aantal tellen dat geen hele maat is (een
  hotcue op tel 3), dan blijven patronen die al spelen in hun eigen fase (anders zou er een
  noot dubbel of weg zijn); een patroon dat daarna start valt wel op de nieuwe "1". Om ze
  weer gelijk te zetten: opnieuw starten.
- **Zonder maatgever**: het eigen tempo (`set.tempo`, standaard 120). Speelt er niets, dan
  begint een patroon **meteen** (zoals play.quant zonder maatgever). Komt er een maatgever
  bij, dan gaat de klok in een tel naar zijn tellen. Valt de maatgever weg terwijl er iets
  speelt, dan **houdt de klok het laatste tempo** (niet terug naar 120: dat verspringt
  midden in een set); als er niets meer speelt geldt het eigen tempo weer.
- **Starten op de maat** valt op het eerste maatbegin NA wat al gepland is (tot 120 ms
  vooruit), niet na de drempel van ~8 ms zoals play.quant. *Afwijking, bewust:* een noot die
  al op de audioklok staat haal je niet terug, dus een wissel of stop die vóór het geplande
  zou vallen kan niet; om alles in een rij op hetzelfde maatbegin te laten vallen geldt dat
  voor elke start. Druk je minder dan ~0,1 s vóór een maatbegin, dan wordt het de maat erna.
- **Meteen** (shift): starten op de volgende TEL; stoppen zodra het geplande op is (≤ 120 ms).
- **Overgangen**: bij stoppen en wisselen `alleUit(t)` op het maatbegin, vóór de eerste noot
  van het nieuwe patroon (anders liet alleUit die meteen weer los). Gaat het instrument weg,
  dan stopt het patroon (de engine liet al los); komt er een ander instrument, dan speelt het
  patroon daarop verder. Een noot die door swing of micro op de stop zou vallen, valt weg.
- **De timer** kijkt elke 25 ms (`TIK_MS`) en plant 120 ms vooruit (`VOORUIT`), zoals
  Elektronlearn; alleen zolang er iets speelt of wacht. Een noot die meer dan 100 ms te laat
  zou komen (de timer haperde) valt weg in plaats van in een salvo na te komen (`stats`).
- **Lengte of deling veranderen terwijl hij speelt**: hij loopt door vanaf dezelfde plek in
  de omloop (korter: vanaf die plek in de nieuwe omloop).

### 7.3 Opnemen

- **Live** (`patterns.record`): wat noten.js speelt (MIDI-keyboard, het schermtoetsenbord,
  straks de Maschine via de hub) op de speeltrack, gaat in het patroon dat DAAR speelt, op de
  dichtstbijzijnde stap van wat je **hoorde** (de klok op nu min de uitgangsvertraging, zoals
  hoorbaar.js), erbij (overdub; dezelfde stap en noot = vervangen). Loslaten zet de duur
  (afgerond op stappen, minstens 1). Klinkt die stap in deze omloop nog, dan slaat de speler
  hem één keer over: je hoorde hem al van je vinger.
- Een **lege plek** zonder opnemen wordt alleen gekozen (om te bewerken; wat speelt blijft
  spelen). Met opnemen aan begint hij (leeg) op de maat en neem je erin op.
- **Stap voor stap**: een klik op een stap (scherm) of `track.N.pattern.step.S` zet de laatst
  gespeelde noot op de gekozen plek, of haalt hem eraf. Zonder gespeelde noot: de kick (36)
  bij drums, anders C4 (60). Meerdere noten op één stap kan (kick + hat).

### 7.4 De API (voor de Maschine-koppeling)

`engine.patronen` (`PatroonSpeler`), alles met deck-id ('A'..'H') en plek 1..5:

| Wat | Hoe |
|---|---|
| stap zetten / wissen / wisselen | `zetStap(id, plek, stap, { noot, snelheid, duur, micro })`, `wisStap(id, plek, stap, noot?)` (zonder noot: de hele stap), `wisselStap(id, plek, stap, noot?)` (zonder noot: de laatst gespeelde). `stap` 0-gebaseerd |
| plek kiezen | `kies(id, plek)`, `gekozen(id)`; starten en stoppen: `druk(id, plek, { meteen })` (zoals een pad), `start(id, plek, { meteen })`, `stop(id, { meteen })`, `rij(plek)`, `stopAlles()` |
| opnemen | `neemOp(aan)`, `opnemen`; noten komen vanzelf binnen via noten.js (`koppel(poort)` voor de hub), of rechtstreeks `noot(id, noot, snelheid)` (0 = los) |
| lezen | `patroon(id, plek)`, `stand(id)` = `{ gekozen, speelt, wacht, stopt, stap, laatsteNoot, plekken }`, `stapNu(id)` (de stap die je hoort, voor de schermen), `lamp(id, plek)`, `stapLamp(id, stap)`, `klokStand()` |
| set | `laadSet(doc)`, `set`, `zetTempo(bpm)`, event `'bewerkt'` (bewaren) en `'stand'` |

Op de bus (dezelfde dingen, voor de hub en MIDI-learn): `track.N.pattern.step.1–64` (de
gekozen plek, de laatst gespeelde noot), `track.N.pattern.1–5` (+ `.now`), `.stop` (+ `.now`),
`.length`, `.length.up/.down`, `.swing`, `.clear`, `patterns.row.1–5`, `patterns.stop(.now)`,
`patterns.tempo`, `patterns.tap`, `patterns.record`. Een Maschine met 16 pads en pagina's
rekent zelf pad + pagina × 16 om naar `step.S`.

### 7.5 APC: de modus patronen

Zevende grid-modus `grid.patronen`, **zeegroen** (33, donker 34): **Shift + scene 3**
(vasthouden = gluren), of ▲ ▼ (na auto; van patronen ▼ terug naar hotcues).

| knop | in de modus patronen |
|---|---|
| pad (kolom k, rij r) | plek r van track k: starten op de maat / stoppen op de maat / wisselen; lege plek = kiezen |
| shift + pad | hetzelfde meteen (starten op de volgende tel, stoppen meteen) |
| scene 1–5 | die rij op alle tracks met een instrument (leeg in die rij = die track stopt) |
| Stop All Clips | alle patronen stoppen op de maat (shift: meteen) |

Lampje: uit = geen instrument op de track, donkergrijs = leeg, donker zeegroen = gevuld,
fel = speelt, knippert (fel/donker op de tel van de klok) = wacht op de maat (starten of
stoppen). De read knippert zelf: `tel` in feedback.js leest `track.N.phase`, en die bestaat
niet op een track zonder nummer. Scene-knoppen: fel = er speelt iets in die rij.
In de grid-modus (Shift + Metronome) blijft Shift + scene 3 "bpm ½" (eigen regel, zoals
auto voor scene 4). De kern blijft: fader, play, filter, Clip Stop, master-knop.
89 regels erbij, geen enkele bestaande veranderd (voorganger `914391f9-421`).

### 7.6 Opslag, log, terugspelen

- `GET /api/patronen/<naam>` → `{ set, versie, fouten }`, `PUT` met `{ set, versie }`: 409 bij
  een botsing (met wat er staat), de vorige in `patronen/.versies/<naam>/`. De mixer
  (`patronen-opslag.js`) haalt bij het opstarten de set "set" op (`varve.patronen.set` in
  localStorage voor een andere), bewaart 0,6 s na een bewerking, kijkt elke 3 s of het
  bestand van buiten veranderde (Claude mag het gewoon schrijven) en neemt dat zonder eigen
  wijzigingen over; met eigen wijzigingen: een botsing in de rij, **hun versie** of **mijn
  versie**. Het bestand staat in de werkmap (`patronen/set.json`), niet in de library.
- `set.instrumenten` onthoudt welk instrument er stond toen er een patroon bij kwam; het
  scherm zegt het als de track nu geen instrument heeft. Instrumenten worden bij het laden
  NIET vanzelf teruggezet (zie de vragen).
- **Handelingenlog**: starten, stoppen, rijen en het tempo gaan over de bus en staan in het
  log; de beginstand weet welke plek er speelt (`stand.patronen.speelt`). **Terugspelen**
  stopt eerst wat er nu speelt, start de plekken van toen op de maat (op een track met een
  instrument), en slaat bewerken over (stappen, lengte, swing, wissen, opnemen, tap): het
  patroon is al bewaard en een stap nog eens omzetten haalt hem eraf. Een tap zet zijn tempo
  via `patterns.tempo`, dus het tempo speelt wel terug. Instrumenten staan niet in het log
  (INSTRUMENTEN.md §6): terugspelen werkt alleen op een track waar nu een instrument staat,
  met de noten van de set van NU.

### 7.7 Metingen (5 okt, Apple M1, Node 26.8.2, Chromium headless shell)

| Wat | Uitkomst |
|---|---|
| venster voor venster (1000 willekeurige grenzen, swing 61, micro) | precies dezelfde noten als in één keer |
| 64 maten zestienden op 120 bpm | drift 0,000 µs |
| Node, nep-maatgever 124 bpm, kick op elke tel | elke kick op de tel (< 1 ns); na +3% pitch, een sprong van 0,37 tel, 32 tellen terug en een andere maatgever (128 bpm, andere fase) binnen twee tellen weer exact, elke tel precies één keer |
| Chrome, OfflineAudioContext 48 kHz, demotrack (StreamBron) als maatgever, drums op track 1, 16 s | 30 kicks, op de audioklok elke kick op een tel van de track (0,000 ms) vóór en na +3% en na een sprong van 0,37 tel; elke kick één keer |
| idem, tijdens de overgang | na +3%: 0,19 en 1,54 ms naast de tel (wat al gepland stond, op het oude tempo), daarna 0; na de sprong van 0,37 tel (174 ms): 161 en 80 ms, daarna 0 (de klok glijdt, in plaats van een kick over te slaan) |
| in de opname | elke kick begint 1,508 ms na zijn tel (1,5 ms vooruitblik van de limiter + de drempel), spreiding 0,012 ms; de kicks van de track zelf (zelfde meting) 1,528 ms, spreiding 0,18 ms: **de drums vallen 0,02 ms naast de kicks van de track** |
| zonder track | 120 bpm, elke 0,5 s precies; in de opname spreiding 0,000 ms |
| timer 400 ms weg (Node) | wat > 100 ms te laat is valt weg, wat net te laat is klinkt nu; daarna elke stap weer één keer |

### 7.8 Niet getest, of wat Clay's oren en de APC nodig hebben

- **Niemand heeft het gehoord of gespeeld.** Vooral: of starten op het maatbegin na de
  vooruitblik (een druk < 0,1 s vóór de maat = de maat erna) goed voelt; of een tel glijden
  na een sprong beter is dan een korte stilte; het knipperen op de APC (een halve tel fel).
- **De APC**: zeegroen naast groen (play, sync) en cyaan (loops) op de pads; Shift + scene 3.
- **Realtime**: alleen offline gemeten. In een realtime AudioContext naast acht streamende
  decks, met de video aan: haalt de timer van 25 ms het, ook in een achtergrondtabblad
  (Chrome knijpt timers; een tabblad dat geluid maakt wordt niet geknepen, aangenomen)?
- **Live opnemen met een echt keyboard** (de latentie toets → noot is niet meegerekend; de
  kwantisering op de dichtstbijzijnde stap vangt het meeste op).
- Lange sets: de klok-tellen lopen door (doubles, ruim genoeg voor dagen).
- De Maschine (hub, stapmodus): de API staat klaar, de koppeling niet.
