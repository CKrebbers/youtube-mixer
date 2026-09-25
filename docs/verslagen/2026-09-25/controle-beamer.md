# Controle spoor 2: beamer (ROADMAP 18)

Branch `spoor2/beamer-c` (van `spoor2/beamer`, bouwer `af11eec`), in worktree
`agent-a3710778e9bedbf3d`. Na de laatste commit gedetacht. Niet gemerged, niet gepusht.

## Commits van de controleur

| commit | onderwerp |
|---|---|
| `096a19d` | Beamer: een video-opname neemt het canvas van een verborgen los venster niet |
| `dbfa9a8` | Beamer: neemOver gooit niet in een los venster zonder WebGL2 |
| `3ca827a` | Video: "na 10 s nog geen beeld" telt geen tijd waarin de mixer niet tekende |

Elk herstel heeft een check in `test/video.test.mjs` die op de code van de bouwer faalt
(eerst gedraaid, FAIL gezien, dan hersteld).

## Oordeel in één zin

Het ontwerp klopt en doet wat gevraagd is: het losse venster mengt zelf, loopt door met
het hoofdtabblad verborgen (zelf nagemeten), regel 1 en 3 blijven heel, zonder los
venster is het gedrag gelijk aan main (kijk.mjs groen). Drie kleine fouten hersteld,
één ontwerpgevolg gemeten dat Clay moet kennen (inloop met veel video's).

## Bevindingen

### 1. Video-opname nam het stilstaande canvas van een verborgen los venster (middel, HERSTELD)
`Beamer.opnameCanvas()` keek alleen of er een los venster aangemeld was, niet of het
mengt. Een geminimaliseerd los venster, of een dat op hetzelfde scherm helemaal achter
het hoofdvenster staat (macOS meldt dat als verborgen), heeft een stilstaande rAF. Een
opname die dan startte nam dat stilstaande canvas op, terwijl het paneel zelf mengde
(`wieMengt` rekende het losse venster wél als verborgen). Nu: alleen als het niet
verborgen is, zoals het commentaar al beloofde. `docs/BEAMER.md` aangevuld.
NIET te herstellen zonder ontwerpwijziging: wordt het losse venster pas TIJDENS zijn
eigen opname verborgen, dan staat het beeld in de opname stil tot het terugkomt
(MediaRecorder wisselt niet van bron). Op een beamer op een tweede scherm gebeurt dat
niet; staat nu in BEAMER.md. Eventueel later: een melding in de strook als dat gebeurt.

### 2. neemOver gooide elk beeld in een los venster zonder WebGL2 (laag, HERSTELD)
Zonder WebGL2 meldt het losse venster zich terecht niet aan, maar zijn lus riep
`neemOver` toch elk beeld aan, en die schreef in `this.fx` (bestaat dan niet):
TypeError per beeld, elke seconde een console.error. Nu `if (!this.gl) return`.
Blijft zo: de beamer toont dan zwart met "verbinden met de app…" (de fout staat wel in
de strook van het hoofdvenster). Vroeger toonde hij in dat geval het hoofdcanvas.
Zeldzaam (WebGL2 in het hoofdvenster maar niet in de popup).

### 3. Vals alarm "na 10 s nog geen beeld" (laag, HERSTELD)
`zichtSinds` werd alleen teruggezet als een laag onzichtbaar werd TIJDENS het tekenen.
Stopte het tekenen zelf (tabblad verborgen: rAF stil en Chrome laadt geen media; het
andere venster nam het mengen over; los venster geminimaliseerd), dan bleef het oude
tijdstip staan en gaf een video die intussen niet laden kon bij het eerste beeld daarna
meteen een fout in de strook. Precies het geval dat de bouwer wilde vermijden. Nu:
meer dan 1 s tussen twee `teken()` = teller opnieuw. Eén `performance.now()` per beeld
in plaats van per laag.

### 4. Inloop met acht video's: seconden uit de pas na het openen (middel, NIET hersteld: ontwerp)
Ad-hoc headless (scratchpad `controle-beamer/randgevallen.mjs`, niet in git), acht
tracks met video, alle faders open, load 40–60 op de machine:
- zonder los venster mengt het paneel: binnen 2 s alle acht op ±2 ms;
- los venster open: het maakt acht NIEUWE `<video>`'s die tegelijk laden en springen.
  De eerste ~6–8 s liepen 3–5 van de 8 tracks tot 1–5,7 s uit de pas (sprongen die
  1–1,6 s duurden, `seekDuur` 0,84–1,62), daarna exact (0 ms, 0 sprongen in 8 s, ook
  met het hoofdtabblad weer zichtbaar en het voorbeeld in het paneel).
Oorzaak: inherent aan "eigen video's" (vroeger toonde het losse venster het al lopende
hoofdcanvas, zonder inloop). Hoe erg het op Clay's M1 zonder andere agenten is, is niet
gemeten; de belasting hier maakt sprongen trager. Geldt ook na herladen van een van de
twee vensters, en waarschijnlijk na het terughalen van een geminimaliseerd los venster.
Mogelijke aanpak (niet gebouwd): het losse venster neemt pas over als zijn zichtbare
video's klaar zijn en binnen ~150 ms zitten, en toont tot dan het hoofdcanvas via
captureStream (de oude weg). Voorstel: Clay eerst in zijn eigen Chrome laten kijken
(beamer openen met 4–8 geladen tracks) voordat daar iets aan gebouwd wordt.

### 5. Dubbel geheugen voor video (observatie)
Met het losse venster open blijven de `<video>`'s van het hoofdvenster geladen (gepauzeerd),
naast die van het losse venster: bij acht tracks 16 media-elementen. Geen lek (begrensd,
en de texturen blijven gelijk: na vier nummerwissels 0 texturen erbij, 8 video's), wel
dubbel buffergeheugen. Loslaten zou bij terugvallen op het paneel opnieuw laden betekenen.
Laten zoals het is tenzij het geheugen op Clay's machine een probleem blijkt.

### Wat nagelopen is en klopt
- Regel 1: niets in `src/engine/` gewijzigd; `beamer.js`/`fouten.js` puur; het losse venster
  leest alleen, de bus blijft bij de mixer van het hoofdvenster (regels.test groen).
- Regel 3: posities uit `deck.position` (audioklok van het hoofdvenster) min
  uitgangsvertraging; `performance.now()` alleen voor seekduur en laadgeduld (zoals al).
- Per beeld overnemen (`neemOver`): kopieert zes velden en roept `zetBron` per deck aan
  (Map-lookup, vroege return bij dezelfde url). Geen allocaties van betekenis; `teken()`
  zelf alloceert per beeld nog een paar kleine arrays, maar dat deed het al op main.
- Twee keer "los venster": één venster, niet herladen na aanmelden (headless). Een dubbelklik
  binnen de eerste ~300 ms (vóór aanmelden) herlaadt het venster één keer: onschuldig.
- Venster dicht met het hoofdtabblad verborgen: bij terugkomst mengt het paneel weer (headless).
- Nummerwissel met het venster open en het hoofdtabblad verborgen: volgt, oude video losgelaten,
  texture weggegooid.
- Vormlagen aan/uit en zes systeemwissels via de bus terwijl het losse venster mengt en het
  hoofdtabblad verborgen is: Worker levert (106–125 beelden in 2 s), geen fouten. Geen Workers
  in het losse venster (zelfde laag-objecten), dus niets op te ruimen daar.
- ImageBitmap-close in werker-modus: het vorige bitmap wordt pas gesloten als er een nieuw is;
  beide mixers uploaden synchroon het laatste, dus geen gesloten bitmap in texImage2D.
- Herladen van beide kanten, crash/dicht, geminimaliseerd: beamer.mjs groen.
- Zonder los venster: `wie()` geeft exact het oude `videoAan()`; kijk.mjs groen (ook de
  oriëntatie met/zonder vormlaag).

## Tests
- `nice -n 10 node test/alles.mjs`: 29 bestanden, 1963 checks; alles groen behalve
  timingchecks "max < 16 ms per stap" in `vormen-isomorf` en `vormen-meer` (load 25–64 op
  8 kernen). Los opnieuw: vormen-isomorf groen, vormen-meer nog `if` rood. Deze bestanden
  en `src/vormen/` zijn op deze branch NIET gewijzigd; `vormen-isomorf` faalde onder
  dezelfde belasting ook op een export van `main` (tv).
- `video.test.mjs`: 92 checks groen (bouwer 88, +4 van de controleur).
- `tools/headless/beamer.mjs` (8894/9494), op de code van de bouwer én op de eindstand:
  alles groen. Sync zichtbaar −1,3…+5,3 ms gem, |8,6–8,9| ms; verborgen −0,5…+5,3 ms.
  Schermafdrukken bekeken: kwarten rechtop, blok verschoven tussen de twee afdrukken met
  het hoofdtabblad verborgen, Lorenz-vormlaag erover, paneel toont het beamerbeeld,
  foutmelding "video van track 1 (kwarten): het bestand ontbreekt…" in de strook.
- `tools/headless/kijk.mjs` (8894/9494), op beide: alles groen.

## NIET getest
- Clay's echte Chrome, een echte beamer op een tweede scherm, volledig scherm.
- Inloop (bevinding 4) op een onbelaste machine; terughalen van een geminimaliseerd los
  venster met acht video's.
- Langer dan een paar seconden verborgen; intensive throttling na 5 min; een hoofdtabblad
  zonder geluid dat Chrome zou kunnen bevriezen (dan leveren vorm-Workers niet meer: hun
  berichten gaan naar het hoofdtabblad).
- `beforeunload` in het losse venster (vraagt een klik in dat venster).
- Een tweede los venster naast het eerste (kan alleen handmatig).
- Canvas-naar-scherm-vertraging op een echte beamer (aanname bouwer: 16–33 ms).

## Voorstel CLAUDE.md (ter vervanging van de regels over het losse venster)

In "Video is SLAAF van de audio", de laatste zin vervangen door:
> Het losse venster (`video.html`, `beamer-venster.js`) MENGT ZELF (ROADMAP 18, 25 sep,
> `docs/BEAMER.md`): eigen `<video>`'s en WebGL op zijn eigen rAF, dus de beamer loopt
> door als het hoofdtabblad verborgen is. Het leest `window.opener.varveBeamer` (same-origin,
> zelfde thread, geen berichten) en neemt elk beeld via `neemOver()` knoppen, mengvorm, puls,
> fit, video per track en DEZELFDE beeldlaag-objecten over; de bus blijft bij de mixer van het
> hoofdvenster. Open en zichtbaar = het hoofdvenster mengt NIET, het paneel toont het beamerbeeld
> via captureStream (andersom dan vroeger). Verborgen los venster = het paneel mengt weer.
> Nieuwe video's in het losse venster lopen eerst in (gemeten: acht tracks onder zware
> belasting ~6 s uit de pas, daarna exact). rVFC gemeten en niet gebruikt (mediaTime loopt
> ~10–13 ms achter op wat texImage2D uploadt).

In "Met video erbij", "Maar NIET in een achtergrondtab … Hoofdtabblad dus zichtbaar houden
(ronde 3: mengen naar het losse venster)." vervangen door:
> Een nieuwe video-opname neemt het canvas van wie er mengt (`Beamer.opnameCanvas`): met het
> losse venster open en zichtbaar mag het hoofdtabblad verborgen zijn. Zonder los venster
> bevriest een opname nog steeds in een achtergrondtab. Een opname die in het hoofdvenster
> begon blijft daar (MediaRecorder wisselt niet van bron; dan mengen ze tijdelijk allebei).
> Los venster dicht of verborgen tijdens zijn eigen opname = stilstaand beeld in die opname
> (dicht: eerst `beforeunload`, dan een fout in de strook).

Plus: "video van een nummer ontbreekt of laadt niet = fout in de strook (`fouten.js`), één
keer per bron; 'na 10 s nog geen beeld' telt alleen tijd waarin de mixer tekent." En in de
structuur `beamer.js`, `beamer-venster.js`, `fouten.js` en `tools/headless/beamer.mjs`
(Chrome for Testing `--headless=new`; alleen daar wordt een tabblad echt verborgen).

Nog open uit het verslag van de bouwer: het commentaar bovenaan `src/video/lagen.js`
("zelfde canvas") is niet meer precies; niet aangeraakt (ander spoor).
