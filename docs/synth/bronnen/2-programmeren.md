# Een ambient-instrument programmeren: onderzoeksrapport

**Methode.** Alle bronnen zijn via WebSearch gevonden. WebFetch werd door de egress-proxy geblokkeerd voor alle domeinen die ik probeerde (wikipedia, soundonsound, mutable-instruments, intermorphic, inmotionmagazine). De citaten komen dus uit zoekfragmenten en niet uit volledig gelezen pagina's. Waar een detail alleen in een samenvatting stond, heb ik de bewijsgraad een stap lager gezet.

---

## 1. Wat "programmeren" kan betekenen, per paradigma

### 1a. Regels en tuinieren (Eno, Koan)
- Eno beschrijft de verschuiving van "architect" (iemand die het hele werk al ziet voordat het er is) naar "gardener" (iemand die zaden plant en afwacht wat er opkomt). [praktijk] https://www.edge.org/node/21443
- Eno over zichzelf, in de hoestekst van *Discreet Music* (1975): *"I tend towards the roles of the planner and programmer, and then become an audience to the results."* Dat is relevant voor Clays risico: voor Eno was ontwerpen-in-plaats-van-spelen juist de methode. Het werkt daar omdat er na het ontwerpen geluisterd wordt en niet verder geknutseld. [sterk, primair citaat] https://en.wikipedia.org/wiki/Discreet_Music
- **Koan** (SSEYO) werkte met stemtypes in plaats van sporen:
  - *Rhythmic*: kansen op frasenlengte en pauzes.
  - *Ambient*: gemiddelde nootduur en pauzeduur, dus drones.
  - *Follows*: imiteert een andere stem, gelijk of met vertraging.
  - *Repeat Bar*: herhaalt maten.
  - *Fixed Pattern*: een frase met een percentage voor hoe exact die gespeeld wordt.

  Daarboven staan vier globale regels: **Scale Rule** (toegestane toonladdertonen), **Harmony Rule** (toegestane samenklanken), **Next Note Rule** (interval tussen opeenvolgende tonen) en **Rhythm Rule** (toegestane nootlengtes). Op stuksniveau stellen toonladder, modus en tempo de rest in. [matig] http://www.medienkunstnetz.de/works/koan/
- Koan Pro 2.1 had ongeveer 200 parameters. Eno gebruikte er rond de 150 per stuk. *Generative Music 1* bevatte 12 stukken in samen 126 KB. [matig] https://www.soundonsound.com/techniques/sseyo-koan-pro-generative-music-1-ark-website · https://www.moredarkthanshark.org/eno_int_independent-jul96.html
- De les: 150 parameters per stuk is precies waar Clays valkuil zit. Eno werkte als professional met een maand tijd per stuk. Voor "kalm" moeten de regels wel van Koan komen, maar het aantal knoppen veel lager.

### 1b. Stochastische sequencers
- **Elektron trig conditions** gelden per trig:
  - `X%`: kans.
  - `A:B`: de trig speelt in ronde A van elke B rondes, dus een periode die langer is dan het patroon.
  - `1ST`: alleen in de eerste ronde.
  - `PRE`/`NEI`: waar als de vorige conditie op hetzelfde spoor of op het buurspoor waar was.
  - `FILL`: alleen terwijl je FILL vasthoudt.

  Track-probability werkt per spoor; conditions gaan per trig daaroverheen. `PRE`/`NEI` zijn in feite Scape-achtige afhankelijkheden in één veld. [matig] https://www.elektronauts.com/t/trig-condition-vs-probability/133488 · https://www.elektronauts.com/t/nei-and-pre-trig-conditions/51959
- **Turing Machine** (Music Thing Modular): één grote knop. Op twaalf uur is alles toevallig, helemaal rechts zit de lus vast, en helemaal links zit hij vast op dubbele lengte. Halverwege "slipt" hij: de lus blijft maar verandert af en toe een noot. De lengte loopt van 2 tot 32 stappen. [matig] https://www.soundonsound.com/reviews/music-thing-modular-turing-machine-mkii
- **Marbles** (Mutable Instruments):
  - De **t-sectie** maakt toevallige klokken (rate, bias, jitter).
  - De **X-sectie** maakt toevallige spanningen: *spread* is de breedte van de verdeling, *bias* het zwaartepunt, *steps* gaat van glijdend naar getrapt en gekwantiseerd.
  - **Déjà vu** is de kans dat oud materiaal terugkomt in plaats van nieuw toeval, met een lengte van 1 tot 16 stappen. Helemaal open komt er niets nieuws meer bij en loopt hij rond in dezelfde reeks of een permutatie ervan.

  [matig] https://mutable-instruments.net/modules/marbles/downloads/marbles_quickstart.pdf · https://es-mx.ra.co/reviews/22997
- Déjà vu en de Turing-knop zijn het belangrijkste ontwerpidee uit dit hele onderzoek: **één knop tussen "herhaal" en "verander"**. Dat is een speelbare parameter, geen programmeerhandeling.
- **Euclidische ritmes** (Toussaint) verdelen k slagen zo gelijk mogelijk over n stappen. Dezelfde algoritme (Bjorklund) maakt veel traditionele timelines. Het zijn twee getallen en het klinkt altijd "goed". [sterk] https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf
- **Cellulaire automaten**: Miranda's CAMUS liet het Game of Life de noten kiezen. Volgens Miranda zelf (2007) klonk dat "niet erg muzikaal". [matig] https://arxiv.org/pdf/1402.0585
- Markov-ketens kom ik in dezelfde survey tegen als standaardtechniek. Ze zijn bruikbaar voor "welke noot volgt", maar de tabel is moeilijk te bewerken met toetsenbord en muis. [praktijk]

### 1c. Modulatie als compositie
- **Octatrack scenes**: elke p-lockbare parameter kan in een scene staan. Er zijn 16 scenes, twee ervan op de crossfader, en tussen A en B wordt geïnterpoleerd (tot zo'n 240 parameters). Componeren wordt hier: twee toestanden kiezen en er langzaam tussen schuiven. [matig] https://sonicstate.com/news/2010/11/01/-more-octatrack-features/
- **Bitwig** heeft modulator-devices. *Random* is een gesynct toevallig LFO, getrapt of glijdend, mono of polyfoon. [matig] https://bitwig.com/userguide/latest/modulator
- **Ableton Drift** heeft bewust maar drie vrije modulatieslots. Het ontwerpdoel was een "best friend synth": je kent hem goed, dus je hoeft geen presets door te bladeren. [matig] https://cdm.link/inside-ableton-drift/

### 1d. Patchen
- VCV Rack, Max/Pd en Morphagene bieden maximale vrijheid. De standaard generatieve ambient-patch is een sequencer of toevalsbron, dan een quantizer naar een toonladder, dan trage voices met vertraging. Dat is in drie of vier blokken samen te vatten. [praktijk] https://www.matrixsynth.com/2024/07/generative-ambient-from-scratch.html?m=0
- Morphagene: een reel van maximaal 174 s, tot 300 splices, *gene-size* en *slide*. Dat is granulair "tuinieren" met eigen opnames. [matig] https://modulargrid.net/p/make-noise-morphagene
- Waarom patchen niet bij "kalm" past: een patch is een netwerk dat je overziet als architect. Een verbinding leggen breekt het geluid vaak (stilte, knal) en de ruimte is onbegrensd. Dit is mijn ontwerpoordeel, geen meting. [praktijk]

### 1e. Live coding
- **Tanimoto's liveness-niveaus**: op niveau 4 bewerk je het programma terwijl het loopt en draait het meteen en zonder hoorbare onderbreking door met de nieuwe versie. [sterk, veel geciteerd] https://homes.cs.washington.edu/~tanimoto/site/wp-content/uploads/2024/10/LiveProgramming2013.pdf
- **Glicol** haalt niveau 4 in de browser:
  - Na een wijziging worden alleen de veranderde knopen vervangen (LCS-diff).
  - Oscillatoren houden hun fase en de rest wordt overgevloeid.
  - Bij een fout speelt de vorige muziek door.

  Dit gedrag moet elk programmeerbaar ambient-instrument hebben, ook als het geen tekst gebruikt. [matig] https://github.com/chaosprint/glicol/blob/main/README.md
- In Strudel en TidalCycles rek je een patroon met `slow(n)` uit over n cycli. De drempel is de syntaxis en het feit dat het idioom ritmisch en cyclisch denkt. [praktijk] https://strudel.cc/learn/getting-started

### 1f. Tekenen en partituur
- **UPIC** (Xenakis, 1977): je tekent golfvormen en envelopes en trekt daarna een grafische partituur van toonhoogte tegen tijd. Een pagina kan tot 4000 "arcs" bevatten. *Mycènes Alpha* (1978) is er helemaal mee gemaakt. [sterk] https://en.wikipedia.org/wiki/UPIC
- **IanniX** (de opvolger als open source) werkt met drie objecten: triggers (gebeurtenissen), curves (trajecten) en cursors (tijd die over een curve loopt), en stuurt OSC. [matig] https://econtact.ca/19_3/scordato_iannix.html
- Tekenen past goed bij muis en touchpad en bij trage bogen over minuten, maar slecht bij regels.

---

## 2. De valkuil van eindeloos tweaken

- **Keuzestress is zwakker dan de folklore zegt.** Een meta-analyse van 63 condities (N=5036) vond een gemiddeld effect van D≈0,02 met grote spreiding. Mensen die al een voorkeur hebben, hebben er minder last van. [sterk] https://abcwest.cogs.indiana.edu/pmwiki/pdf/scheibehenne.options.2010.pdf
  - Gevolg: "minder opties" alleen is niet de oplossing. Het helpt vooral een vaste gewoonte te hebben: een instrument dat je kent (Drifts "best friend").
- **Beperkingen**:
  - Stokes: beperkingen die je oude, betrouwbare oplossingen afsnijden, leiden tot nieuwe. [matig] https://scottbarrykaufman.com/does-creativity-require-constraints
  - Haught-Tromp (2016, n=64): met beperkingen werd het werk creatiever, en dat effect bleef hangen nadat de beperking was opgeheven. [matig] https://www.rider.edu/sites/default/files/docs/tromp_haught-tromp_PACA_2016.pdf
  - De review van Acar e.a. (2019) concludeert een **omgekeerde U**: enige beperking helpt, te veel verstikt. [sterk, review] https://openaccess.city.ac.uk/id/eprint/20459/
- **Synthgebruikers** (Kreković, n=122) passen vaker zelf aan of bouwen zelf dan dat ze presets gebruiken. Tweaken is dus de normale gewoonte en geen afwijking. Het ontwerp moet het tweaken kanaliseren, niet verbieden. [matig] https://www.smc2019.uma.es/articles/S4/S4_03_SMC2019_paper.pdf
- **Flow**: in een EEG-studie met 32 jazzgitaristen ging flow samen met ervaring en met "loslaten": minder frontale controle (hypofrontaliteit). Analytisch bijsturen staat flow dus letterlijk in de weg. [matig, één studie] https://www.psypost.org/scientists-team-up-with-jazz-musicians-to-reveal-the-neuroscience-of-creative-flow/
- **Parallel varianten maken** in plaats van één ding steeds bijvijlen gaf betere resultaten, meer diversiteit en meer zelfvertrouwen (Dow e.a. 2010). Dat pleit voor snapshots en "drie varianten naast elkaar" in plaats van één eindeloos bijgestelde toestand. [matig, gerepliceerd idee] https://cs303.stanford.edu/papers/ParallelPrototyping2010-final.pdf
- **Werkwijzen uit de praktijk**:
  - Elektron *temp save / reload* (Fn+Yes, Fn+No): je bewaart een toestand, jamt erop los en zet hem met één druk terug. Dat werkt als undo terwijl de muziek doorloopt. [praktijk] https://www.elektronauts.com/t/ptn-temp-save-question/223976
  - OP-1: geen menu's, geen presetlijst, vier gekleurde knoppen en een vierspoor-tape. [praktijk] https://www.musicradar.com/reviews/tech/teenage-engineering-op-1-504300
  - Oblique Strategies ontstonden omdat de paniek in de studio Eno deed vergeten dat er andere manieren van werken waren. De eerste kaart: "Honour thy error as a hidden intention". [matig] https://eyemagazine.com/feature/article/oblique-strategies
- **Programmeren meditatief maken in plaats van analytisch.** Wat volgt uit het bovenstaande, als ontwerpconclusie [praktijk]:
  - Het geluid stopt nooit tijdens het programmeren (liveness-niveau 4).
  - Elke wijziging vloeit over in seconden en springt nooit.
  - Je bewerkt één ding tegelijk.
  - Er is geen leeg canvas: je begint altijd vanaf iets dat al klinkt.
  - Je kunt niets fout doen dat niet met één handeling terug te zetten is.

---

## 3. Staat bewaren en delen

- Koan bewees het al in 1996: 12 stukken in 126 KB, omdat **de partituur uit regels bestaat en niet uit noten**. [matig, bron als hierboven]
- Pauline Oliveros' *Sonic Meditations* (1971) zijn 25 korte tekstinstructies zonder noten, bijvoorbeeld: *"Begin by simply observing your own breathing… Allow the intensity to increase very slowly."* Een "wereld" kan dus ook een korte tekst plus parameters zijn. [sterk, primaire tekst] https://blogthehum.com/2016/09/13/pauline-oliveros-sonic-meditations-1974-the-complete-text-and-scores/
- Strudel deelt code als base64 in een klikbare URL. Gangbaar is een JSON met een versieveld, gecomprimeerd in de URL-hash, zodat oude links te migreren blijven. [praktijk] https://strudel.cc/learn/getting-started
- Reproduceerbaar toeval: een **zaad per stem**, niet één globaal zaad. Dan kun je één stem "opnieuw dobbelen" zonder dat de rest verandert. [praktijk]

---

## 4. Makers over hun werkwijze (concreet)

| Maker | Structuur | Schaal |
|---|---|---|
| Eno, *Music for Airports 2/1* | Zeven gezongen noten op tapeloops van incommensurabele lengte (o.a. 23½ s, 25⅞ s, 29 15/16 s) | 7 stemmen, cycli van ~20–30 s [sterk] https://reverbmachine.com/blog/deconstructing-brian-eno-music-for-airports/ |
| Laurie Spiegel | *"I automate whatever can be automated to be freer to focus on those aspects of music that can't be automated. The challenge is to figure out which is which."* Music Mouse: muis op een XY-raster, het programma doet harmonie en stemvoering | 1 hand, het instrument vult aan [sterk, citaat] https://monoskop.org/Laurie_Spiegel · https://econtact.ca/10_2/SpiegelLa_KD.html |
| Suzanne Ciani | Buchla als "relatie… het heeft een brein". *Improvisation on Four/Five Sequences*: de reeksen lopen en zij improviseert met de ruimtelijke verdeling (quadrafonisch, voltage control) en de modulatie | 4–5 sequenties [matig] https://thevinylfactory.com/films/suzanne-ciani-film-masterclass-in-modular-synthesis/ |
| Caterina Barbieri | *Patterns of Consciousness*: alleen de ER-101 (vierspoor-sequencer) en één Harmonic Oscillator. Patronen afgeleid uit een paar harmonische archetypen door optellen, aftrekken en jitter | 4 sporen, 1 oscillator [matig] https://importantrecords.com/products/caterina-barbieri-patterns-of-consciousness |
| Kaitlyn Aurelia Smith | *Ears*: een liveset geoefend en die opgenomen. Make Noise Tempi als klok voor meerdere voices | Spelen = componeren [matig] https://www.ableton.com/en/blog/kaitlyn-aurelia-smith/ |
| Pauline Oliveros, EIS | Zo'n 40 vertragingslijnen met algoritmische sturing: hoeveel er klinken, hoe lang, hoe ze gemoduleerd worden. Het verleden komt terug in het heden; de speler stuurt het systeem bij met pedalen | 1 speler, 40 lijnen [matig] https://quod.lib.umich.edu/i/icmc/bbp2372.1991.098/1/--expanded-instrument-system-eis |
| Éliane Radigue | ARP 2500 met feedback, met de hand en extreem traag gemixt tot suites van een uur. *Trilogie de la Mort*: 3 uur, gemaakt van 1985 tot 1993 | Het tegendeel van generatief: traagheid als speeldiscipline [matig] https://econtact.ca/3_3/Trilogie.htm |
| Hiroshi Yoshimura | *Music for Nine Post Cards*: één keyboard plus een Fender Rhodes, eenvoudige melodieën met kleine variaties en een drone, "een zaad planten" | 2–3 lagen, bouwt nauwelijks op [zwak, platenwinkeltekst] https://driftrecords.com/products/hiroshi-yoshimura-music-for-nine-postcards |
| Loscil | Werkt vanuit een loop in realtime: toevoegen, filteren, wegsnijden. Voor ALTA/ADRIFT een Max-patch met "gestructureerde toevallige selectie", mixen en pannen | [matig] https://daily.redbullmusicacademy.com/2016/03/loscil-interview |

Over Hainbach (tapeloops en testapparatuur, https://en.wikipedia.org/wiki/Hainbach_(musician)) en Steve Roach (https://reverb.com/news/steve-roach-interview) vond ik geen concrete getallen over stemmen of cycli. [zwak]

**Patroon:** de makers werken bijna allemaal met **3 tot 7 stemmen**, cycli van **20 seconden tot minuten**, en **één primaire handeling** tijdens het spelen (mixen, filteren, ruimte, loslaten).

---

## Aanbeveling: welk paradigma

**Regels per stem (Koan en Elektron-condities, uitgekleed) als basis, met morphende scenes en trage modulatie als speellaag. Daarbij één knop "herhaal ↔ verander" per stem (déjà vu of Turing). Geen patchen, en live coding hooguit als optionele tekstweergave van dezelfde regels.**

De afweging:
- **Regels** zijn klein, deelbaar en reproduceerbaar, en passen bij toetsenbord en muis (formuliervelden, getallen, cijfertoetsen).
- **Scenes en morphen** maken van "programmeren" een speelbaar gebaar. Je zet twee toestanden neer en het programmeren ís daarna het schuiven ertussen.
- **Patchen** biedt maximale vrijheid en is daarmee precies Clays valkuil: geen bodem, geen U-top.
- **Live coding** heeft hoge expressie, maar de syntaxis maakt het analytisch. Dat staat haaks op de "loslaten"-bevinding.
- **Tekenen** is waardevol voor één ding: de boog van een sessie over 10 tot 40 minuten (UPIC-lite voor macro-curves), niet voor noten.

## Ontwerpconsequenties

1. **Maximaal 6 stemmen en 8 macro's, vast.** De omgekeerde U van Acar e.a. plus de praktijk van Barbieri (4), Ciani (4–5), Eno (7) en Drift (3 slots).
2. **Per stem een Koan-type** (drone/ambient, ritmisch, volger, vast patroon met een percentage exactheid) **in plaats van een vrije sequencer.** Het type beperkt wat je kunt instellen, en dat is het punt.
3. **Eén regel-veld per stem in Elektron-stijl:** `X%`, `A:B` (periode langer dan de lus), en `PRE`/`NEI` als "speel alleen als stem N speelde". Dat is één veld en geen node-graaf.
4. **Per stem een déjà-vu-knop**: 0 = steeds nieuw, 1 = vast, ertussen slipt hij. Zo wordt "het systeem bijstellen" weer spelen.
5. **Twee snapshots A/B met een morph-schuif, en terug in één toets** (Octatrack-scenes plus Elektron temp save/reload). Een vrij experiment is dan altijd omkeerbaar zonder dat de muziek stopt.
6. **Liveness-niveau 4: een wijziging vloeit over** (seconden, fase behouden) **en een fout of halve invoer laat het vorige doorspelen** (zoals Glicol). Een stop of compile breekt de meditatieve toestand.
7. **Zaad per stem, met "opnieuw dobbelen" per stem.** Zo kun je reproduceren en één ding loslaten zonder dat de wereld omvalt. Varve doet dit al voor de vormen met `g.r()`.
8. **Een wereld = JSON met een `versie`-veld, de regels en niet de noten, gecomprimeerd in de URL-hash plus één zin tekstinstructie** (Koan 126 KB, Oliveros' tekstpartituren). Delen en vergelijken blijven dan triviaal. Dit blijft een persoonlijk instrument: delen betekent een link naar jezelf of een bestand, geen platform.
9. **Een sessieboog tekenen**: één curve per macro over 10 tot 60 minuten, met een cursor die erover loopt (IanniX-model). Dat geeft muis en touchpad een rustige rol, met de vorm op een tijdschaal die je niet bijhoudt.
10. **Een speelmodus waarin de structuur op slot zit**: alleen macro's, mix en morph, en geen regelvelden zichtbaar. Dat bestrijdt het risico rechtstreeks, want flow vraagt minder frontale controle. Een zichtbare editor nodigt uit tot bijsturen.
11. **Een "variaties"-knop die drie mutaties van de huidige wereld naast elkaar zet om te beluisteren**, in plaats van één parameter tien keer bijstellen (Dow e.a.: parallel is beter dan serieel).
12. **Optioneel een "kaart"-knop met een willekeurige beperking** in Oblique-stijl ("haal één stem weg", "alleen de morph tien minuten"). Goedkoop, en Haught-Tromp suggereert dat het effect blijft hangen.

## Onzekerheden

- WebFetch was geblokkeerd. Koan-details, Marbles-bereiken en de Elektron-semantiek komen uit zoekfragmenten. Controleer de details voordat je bouwt, vooral de Koan-stemtypes en de exacte betekenis van `PRE`/`NEI`.
- De studies over beperkingen en flow komen uit schrijven, reclame en jazz, niet uit synthprogrammering. Een directe meting van "ontwerpen versus spelen" bij ambient-makers heb ik niet gevonden.
- Eno omarmt juist planner-programmeur-dan-publiek. Het kan zijn dat Clays risico geen ontwerpen is, maar **niet stoppen met ontwerpen**. Dan ligt de oplossing meer in punt 10 (de structuur op slot) dan in minder functies.
- Het getal "6 stemmen en 8 macro's" is een praktijkkeuze, geen gemeten optimum.
- Of tekenen (punt 9) kalm blijft of een nieuwe knutselbron wordt, valt alleen te testen met Clay zelf.
