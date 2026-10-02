# Laptop als instrument: muis, toetsenbord en touchpad voor een ambient-/meditatiesynth

**Hoe dit onderzocht is.** WebFetch was voor elk domein geblokkeerd door de egress-proxy: Wikipedia, MDN, archive.org, soundonsound, eventide en retiary.org. Ik heb dus geen enkele primaire pagina volledig gelezen. Alles hieronder komt uit de samenvattingen van WebSearch. Na ongeveer 40 zoekopdrachten was het zoekbudget van de sessie op (200/200). "Bevestigd" betekent hier: de zoeksamenvatting citeert de documentatie of spec. "Afgeleid" betekent: mijn eigen redenering of vakkennis, niet in een bron nagekeken.

Bewijsgraden: [sterk] gerepliceerd/gemeten · [matig] één studie of gangbare techniek · [praktijk] vakkennis/ontwerp · [zwak] omstreden.

---

## 1. Music Mouse en andere "intelligent instruments"

**Music Mouse (Spiegel, 1985–86)**

- **Stemmen.** Er spelen vier stemmen. De x-as en de y-as van de muis sturen elk een eigen, onafhankelijke melodielijn. De software voegt zelf twee lijnen toe, die meebewegen met de twee muislijnen. *Hoe* ze meebewegen hangt af van toetsenbordopties: parallel of tegenbeweging. Je kiest tussen 1 verticale + 3 horizontale lijnen, of 2 + 2. [matig] — [Wikipedia](https://en.wikipedia.org/wiki/Music_Mouse), [handleiding 1986](https://ia802904.us.archive.org/29/items/Macintosh_Garden_Manuals_2021_0-9-A/_Music_Mouse.pdf)
- **Stil verplaatsen.** Met de muisknop ingedrukt bewegen klinkt er niets. Je gaat naar een andere toonhoogte zonder alle tussentonen te spelen. Dat is een expliciete "stil verplaatsen"-modus. [matig] — Wikipedia, via de zoeksamenvatting
- **Toonsoorten.** Zes harmonische modi: Chromatic, Octatonic, Middle Eastern, Diatonic, Pentatonic, Quartal. Alle toonhoogtes op het raster worden naar de gekozen toonladder gekwantiseerd. [sterk] — [Eventide quick start](https://www.eventideaudio.com/blog/music-mouse-quick-start-guide-the-keys-to-expression/), [teropa-emulatie](https://teropa.info/musicmouse/)
- **Toetsen in de Eventide-heruitgave.** q t/m y kiezen de modus, z/x transponeren, spatie zet het instrument aan of uit. Of dat in 1986 dezelfde toetsen waren, heb ik niet kunnen nagaan.
- **Wat er verder op het toetsenbord zat.** Voicing (Chord/Arpeggio/Line/Improv) en articulatie (staccato = zestienden, half legato = kwarten, legato = vasthouden tot de volgende noot). Daarnaast 10 melodisch-harmonische patronen die zich in realtime aanpassen aan modus, trap, transpositie en inversie. Het scherm: links de parameters die je met toetsen verandert, rechts het notenraster met aan vier kanten een mini-klavier. [matig]
- **Waarom het werkte, in Spiegels woorden.** "I automate whatever can be automated to be freer to focus on those aspects of music that can't be automated. The challenge is to figure out which is which." En: het programma "turns the computer itself into a musical instrument which you can play." [sterk, citaat] — [Wikipedia Spiegel](https://en.wikipedia.org/wiki/Laurie_Spiegel)
- **Afgeleid.** De rolverdeling is: de muis doet het continue gebaar (contour, dichtheid), het toetsenbord zet de *regels* (modus, voicing, articulatie). Spelen en programmeren gebeuren tegelijk, met twee handen, zonder modus te wisselen.

**Andere historische instrumenten**

- **M en Jam Factory (Zicarelli/Chadabe, Intelligent Music, 1986).** Je stuurt een lopend algoritmisch proces bij in plaats van noten te spelen. M heeft een "conducting grid": één XY-gebaar met de muis verandert een vrij te kiezen combinatie van parameters tegelijk. Dat is een vroege one-to-many-mapping (zie §4). [matig] — [Zicarelli, CMJ](https://www.modelisationsavoirs.fr/atiam/biblio/Zicarelli_MandJamFactory.pdf), [M-handleiding](https://cycling74.s3.amazonaws.com/download/M27.pdf)
- **UPIC (Xenakis, realtime vanaf 1987).** Je tekent op een tablet: x = tijd, y = toonhoogte. Ook golfvormen worden getekend. Getekende boogjes kun je samendrukken, uitrekken en draaien. [matig] — [iannis-xenakis.org](https://www.iannis-xenakis.org/en/dictionary-upic/), [120years](https://120years.net/upic-system-iannis-xenakis-france-1977/)
- **IanniX.** Werkt met drie bouwstenen: triggers, curves en cursors. In tegenstelling tot UPIC kunnen er meerdere tijdlijnen tegelijk lopen. Voor ambient is dat relevant: lussen van verschillende lengte die langzaam ten opzichte van elkaar verschuiven. [matig] — [eContact, Scordato](https://econtact.ca/19_3/scordato_iannix.html)

## 2. Het computertoetsenbord als instrument

**Indelingen**

- **Ableton.** De rij A–L zijn de witte toetsen, W/E/T/Y/U de zwarte. Z/X verschuiven een octaaf, C/V veranderen de velocity. [matig] — [electrikjam](https://www.electrikjam.com/use-your-keyboard-as-a-midi-controller-in-ableton-a-complete-guide)
- **Logic Musical Typing.** Tab = sustain aan/uit, 1/2 = pitchbend zolang je drukt, 3 = modulatie uit, 4–8 = modulatiestanden, Z/X octaaf, C/V velocity. [sterk, Apple-documentatie] — [Apple help](https://help.apple.com/logicpro/mac/10.4/en.lproj/lgcpb19cbd34.html)
- **Isomorfe indelingen** behouden de vorm van een akkoord bij transponeren:
  - Wicki-Hayden: grote secunde horizontaal, kwart schuin.
  - Harmonic table: kwint verticaal, halve toon horizontaal; drieklanken liggen als kluitjes bij elkaar.
  - [matig] — [Wicki-Hayden](https://en.wikipedia.org/wiki/Wicki%E2%80%93Hayden_note_layout), [Harmonic table](https://en.wikipedia.org/wiki/Harmonic_table_note_layout)
- **Isomorf op QWERTY.** Relayer en het patent "Musical Button-Field Layout for Alphanumeric Keyboards" leggen zulke indelingen op QWERTY ([patent](https://patents.google.com/patent/US20090114078A1/en)). Een web-voorbeeld is [gridinstruments](https://github.com/zitongcharliedeng/gridinstruments). [matig]
- **Afgeleid [praktijk].** De verspringende QWERTY-rijen gedragen zich als een scheef hexraster. Daarom passen harmonic table en Tonnetz er natuurlijk op: één hand pakt een drieklank. Voor drones en akkoorden is dat sterker dan een pianoklavier op de A-rij, dat met maar 13 toetsen melodiegericht is.

**Fysieke en browsergrenzen**

- **Cmd houdt keyup tegen [sterk].** Op macOS komt er geen keyup voor andere toetsen zolang Cmd ingedrukt is. Dat geldt in Chrome, Firefox, Safari en Electron. Gevolg: noten blijven hangen. — [Mozilla 1299553](https://bugzilla.mozilla.org/show_bug.cgi?id=1299553), [electron #5188](https://github.com/electron/electron/issues/5188)
- **Rollover op Apple-toetsenborden [zwak].** Apple-toetsenborden (niet voor gamen) hebben geen n-key rollover; ghosting hangt af van de matrix. Het genoemde "6KRO" komt uit de algemene USB-HID-norm en is niet gemeten op een MacBook. — [Key rollover](https://en.wikipedia.org/wiki/Key_rollover), [xahlee](http://xahlee.info/kbd/keyboard_n-key_rollover_key_ghosting.html). Welke combinaties op een M1 Air ghosten weet ik niet.
- **Toetsenbordindeling.** `event.code` is de fysieke toets en dus onafhankelijk van de indeling. Een dode toets geeft `key === 'Dead'` en compositie-events (`isComposing`). [sterk, spec] — [MDN keydown](https://developer.mozilla.org/en-US/docs/Web/API/Document/onkeydown)
- **`getLayoutMap()`** werkt alleen in Chrome/Edge. Firefox en Safari weigeren hem om fingerprinting, dus hij wordt waarschijnlijk nooit Baseline. Hij is alleen bruikbaar om de juiste letter op een toetslabel te zetten. [sterk] — [web-features](https://web-platform-dx.github.io/web-features-explorer/features/keyboard-map/)
- **Keyboard Lock** werkt alleen in fullscreen die door JavaScript is gestart. Op macOS vangt Chrome Cmd+Tab, Cmd+Space en dergelijke niet. Esc 3 s vasthouden is de nooduitgang. [matig] — [Chrome docs](https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock), [pikvm #1377](https://github.com/pikvm/pikvm/issues/1377)
- **Afgeleid [praktijk].** Cmd+W/Q/T/N kun je zonder fullscreen niet overnemen.
- **Toetsherhaling en accentmenu.** Toetsherhaling stel je in bij Systeeminstellingen. Het accentmenu bij vasthouden heet `ApplePressAndHoldEnabled`. [matig] — [raw.org](https://raw.org/software/administration/enable-key-repeat-on-macos/)
- **Afgeleid.** Het accentmenu verschijnt alleen in tekstvelden, dus niet op een canvas met focus. Filter `event.repeat`.

**Laptoporkest**

- Fiebrink, Wang en Cook (NIME 2007, PLOrk) pleiten voor wat de laptop zelf al heeft: toetsenbord, trackpad, kantelsensor, microfoon en camera. Ze haalden afgeleide kenmerken uit het trackpad, zoals *hoeksnelheid*, en niet alleen x/y. Daaruit kwam de toolkit SMELT. [matig] — [paper](https://soundlab.cs.princeton.edu/publications/laptop_nime2007.pdf), [SMELT](https://smelt.cs.princeton.edu/)
- Specifieke stukken voor toetsenbord en trackpad (Wang, Trueman) kon ik niet meer opzoeken.

## 3. Touchpad in de browser (stand oktober 2026)

**Scrollen met twee vingers (`wheel`)**

- Chromium-bug 40704952 bevestigt het probleem: na het loslaten blijven events binnenkomen met exponentieel afnemende delta's, meer dan een seconde lang. Tot voor kort was dat niet te onderscheiden van echt scrollen.
- **Nieuw:** `WheelEvent.momentum` (boolean, in de Pointer Events-spec) is aan sinds **Chrome 151 (28 juli 2026)**. Firefox staat er positief tegenover, Safari heeft het niet. [sterk] — [crbug](https://issues.chromium.org/issues/40704952), [Chrome 151](https://developer.chrome.com/release-notes/151), [spec](https://w3c.github.io/pointerevents/#dom-wheelevent-momentum), [WebKit-positie](https://github.com/WebKit/standards-positions/issues/688)
- Voor Safari heb je een heuristiek nodig, zoals de bibliotheken lethargy en [wheel-gestures](https://npmjs.org/package/wheel-gestures): snelle opeenvolging, dezelfde richting, afnemende delta. [matig]

**Knijpen (pinch)**

- Chrome en Firefox sturen een `wheel` met `ctrlKey: true`; `deltaY` is dan de voorgestelde schaalstap. Een trackpad-pinch geeft deltaY ≈ 0,5–3; Ctrl + muiswiel geeft ≥ 100. Zo zijn ze uit elkaar te halen. [sterk] — [Burzo](https://danburzo.ro/dom-gestures/)
- Safari heeft eigen `gesturestart/change/end`-events met kant-en-klare `scale` en **`rotation`**. Alleen daar is draaien met twee vingers beschikbaar. [sterk]

**Druk (Force Touch)**

- Drukgevoeligheid is alleen in Safari beschikbaar, via `webkitmouseforcechanged` en `webkitForce`. Dat event vuurt tussen mousedown en mouseup. [sterk] — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Force_Touch_events)
- Chrome geeft volgens de zoeksamenvatting een vlakke `pressure` van 0,5 bij een klik. Dat volgt de spec-standaard voor "geen druk": 0,5 met ingedrukte knop, anders 0. [matig — niet zelf gemeten] — [Pressure.js](https://pressurejs.com/), [w3 lijst](https://lists.w3.org/Archives/Public/public-pointer-events/2016JulSep/0388.html)

**Meerdere vingers**

- Niet beschikbaar in de browser [afgeleid, sterk vermoeden]. Elke oplossing die ik vond is native en gebruikt het private MultitouchSupport.framework; dat levert per vinger positie, snelheid, druk, hoek en ellips. Voorbeelden: [Subsurface](https://github.com/mrkai77/Subsurface), [trackpad_synth](https://github.com/jeffkaufman/trackpad_synth), [AudioSwift](https://audioswiftapp.com/) (trackpad → MIDI/MPE).
- Afgeleid: AudioSwift + Web MIDI in Chrome kan een *optionele* brug zijn zonder extra hardware.

**Pointer Lock**

- Chrome ondersteunt `unadjustedMovement` sinds versie 88 op macOS 10.15.1+. Safari accepteert de optie sinds 18.4, maar valt terug op de door het OS aangepaste delta. Je krijgt dus wél eindeloze relatieve beweging, maar niet altijd zonder versnelling. [matig] — [web.dev](https://web.dev/disable-mouse-acceleration/), [caniuse](https://caniuse.com/mdn-api_element_requestpointerlock_options_unadjustedmovement_parameter)

**Hoge frequentie en vloeiende lijnen**

- Sinds Chrome 60 wordt `pointermove` net vóór rAF afgeleverd; tussenposities haal je op met `getCoalescedEvents()`.
- `pointerrawupdate` werkt alleen in een secure context en niet in Safari.
- Safari ondersteunt `getCoalescedEvents()` en `getPredictedEvents()` sinds 18.2.
- [sterk] — [Chrome blog](https://developer.chrome.com/blog/aligning-input-events), [MDN](https://developer.mozilla.org/docs/Web/API/Element/pointerrawupdate_event), [WebKit 18.2](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/)

**Zweven (hover)**

- `pointermove` met `buttons === 0` vuurt continu, ook op een trackpad. Daarmee is "zweven boven" een eigen kanaal naast "ingedrukt". [praktijk, spec-gedrag; niet apart nagezocht]

## 4. Veel expressie uit weinig invoer

**Mapping-onderzoek**

- Hunt & Wanderley (2002) onderscheiden one-to-one, one-to-many en many-to-one. [matig] — [Organised Sound 7(2)](https://web.media.mit.edu/~rebklein/downloads/papers/Organised%20Sounds%20V7-n2/02-%20Mapping%20performer%20parameters%20to%20synthesis%20engines.pdf)
- Hunt & Kirk (2000) vergeleken experimenteel drie mappings. Continue, multiparametrische mapping bleek gunstig; gebruikers werden er na verloop van tijd beter mee en vonden het boeiender dan one-to-one. Dat is één onderzoeksgroep. [matig] — [HunKir.pdf](https://www-media.idmil.org/media/Trends_Ircam/DOS/HunKir.pdf)
- Fels, Gadd & Mulder (2002): **transparantie** voor speler én publiek (de afstand tussen gebaar en klank). Een metafoor maakt een mapping transparant. [matig] — [Organised Sound 7(2)](https://www.cambridge.org/core/journals/organised-sound/issue/C33E93CE1AC6D60CF94AFDA018DF3247)
- Wessel & Wright: "low entry fee with no ceiling on virtuosity". [praktijk] — [CNMAT](https://cnmat.berkeley.edu/node/8286)

**Afgeleide kenmerken uit één punter**

- NIME-werk gebruikt naast positie ook snelheid en versnelling (tweede en derde orde), zoals bij strijkbewegingen. Fiebrink gebruikte hoeksnelheid. [matig] — [Caramiaux NIME 2013](https://nime.org/proceedings/2013/nime2013_84.pdf)
- Afgeleid [praktijk], zonder bron:
  - **Cirkelen** = hoeksnelheid rond een lopend middelpunt → energie die je erin wrijft, zoals bij een klankschaal (een leaky integrator).
  - **Dwell** (stil zweven) → laten uitgroeien of bevriezen.
  - **Snelheid** → helderheid.
  - **Momentum na het loslaten** → laten uitklinken.

**Programmeren met het toetsenbord**

- **Orca:** een 2D-raster waarin elke letter een operator is (kleine letters bij een bang, hoofdletters elk frame); alleen toetsenbord. [matig] — [itch.io](https://hundredrabbits.itch.io/orca)
- **Strudel:** Ctrl+Enter voert de code uit; de wijziging gaat in op de volgende cyclus. Dat is kwantiseren van bewerkingen. [sterk, documentatie] — [Strudel REPL](https://strudel.cc/technical-manual/repl/)
- **Renoise:** een modale bewerkmodus met cursor en stapgrootte. Vim-bediening is vaak gevraagd maar niet gebouwd. [matig] — [forum](https://forum.renoise.com/t/vim-like-command-mode-for-easy-navigation/39701)

## 5. Moderne voorbeelden

- **Typatone** (Lullatone/Brandel): de meest gebruikte letters (E, A, O) liggen op de meest melodieuze toonladdertonen. Typen wordt zo vanzelf muzikaal. Les: ontwerp naar *hoe vaak* een toets gebruikt wordt. [matig] — [Brandel](https://jonofyi.medium.com/typatone-statistical-analysis-6140f9a73032)
- **Tactile** (Sampleson, 2025): X en Y over twee geluidsbronnen, met spectrale freeze en granulaire synthese, voor drones. Dat bewijst dat één XY-punter genoeg is voor ambient. [matig] — [Synthtopia](https://www.synthtopia.com/content/2025/06/27/new-software-synth-tactile-turns-your-trackpad-or-mouse-into-an-instrument/)
- **AudioSwift:** trackpad als MPE-raster, maar native. [matig]
- Morphwiz, Plink en web-theremins kon ik niet meer onderzoeken (zoekbudget op).

---

## Ontwerpconsequenties

1. **Splits de handen zoals Music Mouse.** De punter speelt continu (contour, dichtheid, energie); het toetsenbord zet regels (toonladder, voicing, articulatie). Zo programmeer je tijdens het spelen zonder van modus te wisselen. Reden: Spiegel automatiseert wat geautomatiseerd kan worden.
2. **Kwantiseer alle toonhoogte naar een gekozen modus en laat de software stemmen afleiden** (parallel of tegenbeweging, of een drone op de grondtoon). Reden: weinig dimensies plus een harmonisch model geeft rijkdom zonder valse noten.
3. **Gebruik `event.code`, filter `event.repeat`, en gebruik `getLayoutMap()` alleen voor labels.** Reden: zo werkt het op QWERTY, AZERTY en US-International met dode toetsen; Safari en Firefox hebben geen layout map.
4. **Laat geen Cmd-combinatie een noot vasthouden, en laat alle noten los bij `blur`, `visibilitychange` en bij keyup van Meta.** Reden: macOS stuurt geen keyup zolang Cmd ingedrukt is.
5. **Ontwerp voor hooguit 3–4 gelijktijdige toetsen en houd akkoorden bij voorkeur vast als schakelaar (toets = aan/uit).** Reden: geen n-key rollover, ghosting onbekend. Een drone hoeft niet ingedrukt te blijven.
6. **Leg akkoorden en drones op een harmonic-table- of Tonnetz-indeling over de verspringende rijen, en melodie op een pianorij.** Reden: drieklanken worden één handvorm. Neem daarnaast Logic's conventies (Z/X octaaf, Tab sustain), omdat spiergeheugen meetelt.
7. **Gebruik `wheel.momentum` in Chrome ≥ 151 als "uitklinken na loslaten", met een heuristiek als reserve voor Safari.** Reden: de inertie van macOS is een gratis, natuurlijk afnemende curve.
8. **Behandel pinch in Chrome (`ctrlKey` + kleine deltaY) als derde continue as, en rotatie alleen als extra in Safari.** Reden: Chrome kent geen rotatie.
9. **Bouw niets dat afhangt van trackpaddruk of meerdere vingers.** Reden: druk bestaat alleen in Safari en meerdere vingers helemaal niet in de browser. Bied hooguit een optionele brug via Web MIDI (AudioSwift).
10. **Maak "wrijven" een afgeleid kenmerk** (hoeksnelheid → energie in een lekkende integrator), en zweven/dwell een tweede kanaal naast klikken. Reden: one-to-many uit één punter (Hunt & Kirk, Fiebrink), met een transparante metafoor (Fels).
11. **Lees bewegingen met `getCoalescedEvents()` en verwerk ze op de audioklok, niet per rAF.** Reden: pointermove wordt in Chrome rAF-gebundeld, en `pointerrawupdate` werkt niet in Safari.
12. **Gebruik Pointer Lock alleen voor een expliciete "eindeloze knop"-modus.** Reden: Safari levert nog OS-versnelde delta's, en de lock vraagt een gebruikersgebaar en is met Esc te verlaten.
13. **Laat bewerkingen ingaan op de volgende cyclus of frase (zoals Strudel), en bied een command palette / modale bewerklaag in plaats van een knoppenmuur.**

## Onzekerheden

- Of Chrome op macOS in 2026 echt overal `pressure` 0,5 geeft (één bron, niet gemeten), en of `webkitForce` daar bestaat.
- De werkelijke rollover en ghosting van het interne toetsenbord van de MacBook Air M1; die moet je meten met een toetstester.
- `deltaMode` en de grootte van wheel-delta's per apparaat in Chrome en Safari.
- Of `pointerrawupdate` op `localhost` werkt (afgeleid: localhost geldt als secure context).
- De precieze toetsen van Music Mouse uit 1986, tegenover die van de Eventide-heruitgave.
- Of het accentmenu nooit verschijnt in een canvas met focus.
- Morphwiz, Plink en web-theremins, en specifieke stukken van PLOrk/SLOrk voor toetsenbord: niet onderzocht.
- Of Safari `WheelEvent.momentum` gaat implementeren.
