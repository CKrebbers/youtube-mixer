# Werkruimte S10: meer effecten, sjablonen en mogelijkheden bij het maken (14 okt 2026)

Tak `werk/S10` (vanaf `werkruimte/integratie` d2d60cb, met S6–S9 erin). Ontwerp en wat er gebouwd is:
`docs/EFFECTEN-MEER.md`. Clay, 14 okt: *"En maak meer template effecten en voeg ook meer
mogelijkheden toe bij het maken van nieuwe effecten."*

## Kort

- **25 nieuwe sjablonen** (33 in totaal), elk met een uitleg, knopnamen, een droge beginstand en
  `xy` (welke twee knoppen samen op een XY-pad passen).
- **Zeven nieuwe effecten**: kam, klinker, frequentieschuif, band, kanteling, aanslag, duiker.
- **In een rack**: modulators (LFO, stappen, volger, toeval), droog/nat per effect, een knop die een
  andere knop of de diepte van een modulator stuurt, een eigen kromme, A/B, muteren en willekeurig
  met zaad, eigen sjablonen bewaren/dupliceren/wissen, een effect kopiëren en plakken.
- **Op elk scherm**: de bouwsteen `sjablonen` (sjabloon ◀ ▶, XY-pad, acht plekken, mix, aan/uit),
  ook op de iPad via de schrijfweg van S8. Bewaren en wissen blijven op de Mac.
- Geen regel in `mappings/*.json` veranderd; geen bestaand rack klinkt anders.

## De nieuwe sjablonen

| sjabloon | keten | knoppen | xy | in één zin |
|---|---|---|---|---|
| Dub-echo | delay → filter → galm | Gooi, Tijd, Dof, Ruimte, Filter | 1 × 3 | Echo op 3/16 die je erin gooit en laat doorrollen (eerst de echo erin, dan pas de feedback). |
| Wegspoelen | filter → galm → delay | Wegspoelen, Lengte, Bevries | 1 × 2 | Het nummer lost op in galm en echo terwijl de bas wegzakt; knop 3 laat een wolk hangen. |
| Opbouw | filter → flanger → galm | Opbouw, Spanning, Ruimte | 1 × 2 | Riser: highpass omhoog, flanger en galm erbij, en een flanger die elke halve maat versnelt (modulator). |
| Band zakt weg | band → filter | Wegzakken, Zwalk | 1 × 2 | Een bandmachine die het opgeeft: wow, flutter, dof, vuil en een lowpass die dichtgaat. |
| Tel-gate 1/8 | gate → filter | Hakken, Open, Deling, Dun | 1 × 2 | De hakker op achtsten (Beat FX "trans"), met deling en een dunner. |
| Kleur: filter | filter | Filter, Reso | 1 × 2 | Color FX: links lowpass, rechts highpass, in het midden open. |
| Kleur: dub | filter → delay | Dub, Echo | 1 × 2 | Color FX "dub echo": filter met echo naar beide kanten (eigen V-kromme). |
| Kleur: ruimte | filter → galm | Ruimte, Lengte | 1 × 2 | Color FX "space": dof of dun, galm naar beide kanten. |
| Kleur: crush | crush → filter | Crush, Bits | 1 × 2 | Color FX "crush": minder bits naar beide kanten, met lowpass of highpass. |
| Klinker-zweep | klinker | Klinker, Scherp, Stem | 1 × 2 | Een vocaalfilter door a-e-i-o-u: het nummer gaat "praten". |
| Ruimte bevriezen | galm → filter | Ruimte, Groot, Bevries, Glans, Filter | 1 × 4 | Galm als instrument: erin, bevriezen, en het nummer eronder wisselen. |
| Zangband | filter → filter → kanteling → aanslag | Smal, Helder, Scherp | 1 × 2 | Voor de zang-stem: bas en hoog weg, warmer of helderder, scherpere medeklinkers. |
| Drum-punch | aanslag → kanteling → filter | Punch, Staart, Kleur, Filter | 1 × 2 | Voor de drum-stem of een break: harder klappen, kortere of langere staart. |
| Master-lijm | compressor → kanteling → breedte | Lijm, Make-up, Kleur, Breedte | 1 × 3 | Een rustige 2:1-compressor voor de master, met kanteling en wat breedte. |
| Break-kraker | aanslag → distortion → duiker → filter | Kraak, Punch, Filter, Pomp | 1 × 3 | Voor een amen: hard vervormen erbij, punch, filter en pompen op achtsten. |
| Reese | chorus → distortion → filter | Zweef, Vuil, Filter | 1 × 3 | De reese-bas: zwevende stemmen en vervorming, met een lowpass. |
| Pomp | duiker → filter | Pomp, Deling, Herstel, Filter | 1 × 4 | Sidechain-pompen op de klok: duiken op elke tel en terugkomen. |
| Kam-zweep | kam | Zingen, Toon, Dof, Zweef | 1 × 2 | Het nummer zingt op één toon en zijn boventonen; knop 4 laat de toon over vier maten zweven. |
| Schaduw | frequentieschuif → galm | Schaduw, Schuif, Ruimte | 2 × 1 | Alles schuift een paar tot honderden Hz op: van draaiende zweving tot metaal. |
| Stappenfilter | filter | Stappen, Reso, Filter | 1 × 2 | Een lowpass die op zestienden een patroon speelt (stappen-modulator). |
| Droedel | klinker | Droedel, Klinker, Scherp | 1 × 2 | Elke achtste een andere klinker, uit zaad 7 (elke keer hetzelfde patroon). |
| Ademende galm | galm | Galm, Adem, Lengte | 1 × 2 | Galm die wijkt als het nummer luid is en opbloeit in de stiltes (volger, omgekeerd). |
| XY: wah en vuil | auto-wah → distortion | Wah, Vuil | 1 × 2 | Voor de XY-pad: wah links-rechts, vervorming onder-boven. |
| XY: galm en lengte | galm | Galm, Lengte | 1 × 2 | Voor de XY-pad: hoeveel galm, en hoe lang en helder. |
| Kanteling | kanteling | Toon, Midden | 1 × 2 | Eén knop: de hele mix warmer of helderder (ook op de master). |

Alle 25 gemeten in Chrome (`tools/headless/effecten-meer.mjs`): beginstand +0,0 dB t.o.v. droog
(Band zakt weg −0,0, Master-lijm +0,0 na de correctie hieronder), alle knoppen open eindig en
begrensd (piek ≤ 1,23).

## De nieuwe mogelijkheden

| mogelijkheid | waar | hoe |
|---|---|---|
| modulators (LFO, stappen, volger, toeval) | editor, onder de keten | "+ modulator…", klok (op de maat + deling, of vrij in Hz ≤ 8), doelen met eigen diepte; een meter |
| droog/nat per effect | editor, ∥ op de kaart | een knop "nat" erbij, te koppelen zoals elke parameter |
| knop → knop, knop → modulatordiepte | editor, "stuurt" | `plek.K` en `mod.N.diepte` in de lijst |
| eigen kromme | editor, verloop → eigen kromme | vijf punten met de muis |
| A/B | editor, bovenaan | eerste klik: A = wat er is, B = een kopie; daarna wisselen |
| muteer / willekeurig met zaad | editor, bovenaan | hetzelfde zaad = hetzelfde resultaat |
| als sjabloon / wis sjabloon | editor, bovenaan | `/api/sjablonen` (alleen deze Mac); een andere naam = een kopie |
| kopie / plak van een effect | editor, kaart en "+ effect…" | ook naar een ander rack of een andere track |
| zeven effecten | kiezer en editor | kam, klinker, frequentieschuif, band, kanteling, aanslag, duiker |
| XY-pad per rack | bus | `track.N.fx.xy.x/.y`, `master.fx.xy.*` volgen `xy` van het rack |
| bouwsteen `sjablonen` | werk.html, iPad, werkvak | `sjablonen` of `sjablonen:<n>` in een werkruimte |

## CPU per effect

Acht tegelijk (acht tracks), 10 s audio, OfflineAudioContext in headless Chrome in deze container
(Linux, swiftshader; niet op de M1), beste van drie, minus hetzelfde zonder effect:

| effect | ms per s audio (acht) | van een kern |
|---|---|---|
| kam | 24,2 | 2,4% |
| klinker | 33,2 | 3,3% |
| frequentieschuif | 42,6 | 4,3% |
| band | 67,4 | 6,7% |
| kanteling | 16,6 | 1,7% |
| aanslag | 33,9 | 3,4% |
| duiker | 9,9 | 1,0% |
| *filter (fx.js)* | 26,8 | 2,7% |
| *delay (fx.js)* | 33,3 | 3,3% |
| *galm (fx.js)* | 190,3 | 19,0% |

De drie kernen zelf in Node: kam 1,7 µs, frequentieschuif 7,7 µs, aanslag 5,6 µs per blok van 128;
0 GC's over 12 000 blokken, 256 bytes heapgroei. Modulators rekenen op de hoofdthread (33 ms) en
alleen met een rack dat ze heeft. Renderblok: dezelfde gouden hash (a6c215d9) en dezelfde CPU als de
basis (werkmap 3,0 / 3,05%). Latentie fader → geluid p50: 0,55 en 0,86 ms (basis 0,72 ms; dezelfde
spreiding).

## Zelf een nieuw effect maken en als sjabloon bewaren (stap voor stap)

1. Kies de track (focus) en klik in de RACK-rij op **bewerk**.
2. Wil je leeg beginnen: klik op × bij de effecten die er staan (knoppen die alleen dat effect
   stuurden gaan mee weg). Of begin vanaf een sjabloon uit de kiezer.
3. **+ effect…**: kies een effect (bijv. Kam), en nog een (bijv. Reverb). De volgorde verander je met ← →.
4. Klik op een vrije knop bovenaan (bijv. 1) en op **knop 1 gebruiken**: hij staat meteen op **OPEN**.
5. Draai aan de effecten tot het klinkt zoals het moet als de knop open staat (bijv. kam-meng en
   galm-meng omhoog). Klik **DICHT** en draai wat er moet gebeuren bij een dichte knop. Klik nog eens om
   te stoppen. (Gemeten met de muis: 15 handelingen voor één knop op twee effecten, open én dicht
   ingesteld, tot en met bewaren; een keuzelijst telt als twee klikken. Plus één per effect dat je
   eerst weghaalt.)
6. Geef de knop een naam rechts ("Zingen"), en eventueel bij "meer" (▸) een eigen kromme of een
   venster.
7. Optioneel: **+ modulator…** onder de keten (bijv. LFO, op de maat, 1/1, doel "Kam toon",
   diepte 20%), of ∥ op een effect voor een eigen nat-knop.
8. Twijfel je: **B**, dan **muteer** tot het beter klinkt; **A** om terug te luisteren.
9. Typ de naam bovenaan ("Zingende ruimte") en klik **als sjabloon**. Hij staat nu in de kiezer onder
   "eigen sjablonen", en is met rack ◀ ▶ (APC, iPad) te kiezen op elke track. Een andere naam = een
   kopie; dezelfde naam = bijwerken. **bewaar** blijft: het rack van dit nummer.

## Gemeten en gevonden tijdens het bouwen

- Frequentieschuif: Niemitalo's tabel geeft a, de trap rekent met a²; met a was de fasefout tot 13°
  (spiegelbeeld −30 dB). Nu ±0,6°, −49 dB op 1 kHz, −44 dB op 60 Hz.
- Aanslag: de grens als module-constante in de lus liet V8 per sample een getal-object maken (23 GC's);
  en een keyed store in de processor ook (3 GC's). Nu 0.
- Kam: feedback en demping per blok verzetten gaf een tik (×781 op de tweede afgeleide); nu per sample
  glijden (×1,9). Staart tot 10 s (30 Hz op 97% = 7,6 s), frequentieschuif 0,25 s.
- Klinker: was 10–18 dB zachter dan droog; nu −3 dB op de standaard (Q 20: −12 dB, begrensd).
- Master-lijm: de make-up-knop stond in de beginstand op +3 dB (knop 0,5 op een bereik 0,5 → 0,75).

## Review (twee agenten, één ronde) en wat er veranderde

(a) correctheid en geluid, (b) bruikbaarheid en bewijs; elk met scratch-scripts en eigen runs.
Opgelost (met een test erbij):
- **(b1, blokkerend)** een eigen sjabloon wissen verschoof de herkomst `s:<nr>` van andere tracks, en
  een tweede "wis" wiste dan het verkeerde. Nu heet een eigen sjabloon `eigen:<naam>`.
- **(a1, b2)** een modulator of doel weghalen liet de parameter op zijn laatste gemoduleerde stand
  (het scherm zei iets anders). Nu `_herstelLos` (ook bij het weghalen van een koppeling, wat al vóór
  S10 zo was).
- **(a2, b3)** elke schuifbeweging in de editor zette een vrije LFO terug naar zijn begin. Nu houdt een
  modulator die dezelfde soort blijft zijn stand.
- **(b5, b6, a10)** droog/nat per effect was equal-power: halverwege tot +4 dB bij crush/filter, en
  bij de delay haalde het het droge weg en kapte de staart af (Dub-echo was geen worp). Nu lineair,
  en bij de delay een stuur vóór de echo.
- **(a3)** snelle modulators op de maat (1/16, 1/32) vouwden op 30 Hz en stappen vielen tot 33 ms te
  laat: tik 8 ms voor die modulators.
- **(a4)** de (onzichtbare) "link erbij" kon het droog/nat kiezen; gefilterd.
- **(a5)** een hapering van meer dan een halve maat liet de tellenteller teruglopen.
- **(a7)** een onbekende modulator verloor zijn doelen; nu helemaal ongeschonden, en afkappen meldt het.
- **(a9)** de duiker duikt op 1/2 en 1/1 nu op de "1".
- **(b4, b7)** de uitleg van Wegspoelen klopte niet; Band zakt weg was in de beginstand niet droog
  (nu meng 0, knop 1 zet hem erin); Master-lijm zegt nu dat hij voor de master is (6 ms vooruitblik).
- **(b8)** de telling van de handelingen trok vast 3 af en sloeg DICHT over; nu eerlijk (15), en het
  bewaarde sjabloon moet droog zijn in de beginstand.
- **(b9–b14)** hoofdletters bij een kant-en-klare naam, overschrijven van een ander eigen sjabloon
  (tweede klik), de uitleg die meeging, "verandert niets" bij de kromme, de ontbrekende testuitslag,
  tijdelijke mappen van de proef.
Niet opgelost, gedocumenteerd: de kam kan +18 dB geven op zijn grondtoon (a8); `.versies/` van eigen
sjablonen (b10, optie); modulators staan stil in een verborgen tabblad (de timer).

## Wat alleen met de oren te beoordelen is

- Elk sjabloon: of de knoppen musicaal liggen (bereik, kromme, welke twee op de XY-pad).
- De kam die glijdt bij een nieuwe toon; de klinker (klinkt "a-e-i-o-u" als een stem?); de band (wow
  en flutter op ambient); de duiker naast een echte sidechain; de aanslag op een amen.
- Modulators op 33 ms: of een stappenfilter op 1/16 strak genoeg klinkt op 170 bpm (een stap is dan
  88 ms; het effect glijdt 20 ms).
- Droog/nat per effect op de compressor en de band (een kam bij half nat, zie de grenzen).

## Vragen voor Clay

In `docs/VRAGEN.md` blok S10: de sjablonen (S10-1), modulators als besturing (S10-2), de kam die
glijdt (S10-3), de luidheid van de klinker (S10-4), bewaren vanaf de iPad (S10-5, advies: nee), de
XY-actions in de bouwsteen (S10-6), master-lijm standaard (S10-7), band (S10-8), de volgende stap (S10-9).

## Volgende versie (opties)

- Echte parallelle ketens (twee ketens naast elkaar, elk met een mix) in `bouwKeten` en de editor.
- Een stutter/korrel-effect binnen het rack (de klok in de worklet).
- Vertragingscompensatie voor droog/nat per effect (compressor, pitch, band).
- De stand van een modulator in het handelingenlog, zodat een vrije LFO bij terugspelen dezelfde fase heeft.
- Een paneel-item voor de rack-editor op mac-2 (nu: de editor in de mixer, de bouwsteen `sjablonen` overal).
- Sjablonen per tag kiezen (dub, master, stems) in de kiezer en op de iPad.

## Tests

Zie "Testuitslag" hieronder.
