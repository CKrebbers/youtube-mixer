# Opdracht: Symbiose — APC40 mkII + Maschine MK2 als één instrument

Plak dit hele bestand in Claude Code (of zet het in de repo en zeg: "voer OPDRACHT-symbiose.md uit").

---

## 0. Stand en besluiten (30 okt 2026, gaat vóór de rest van dit bestand)

Correcties van Claude Code, alle vijf geaccepteerd:
1. **De basis is v2**, niet av-kern. Hybride staat op tak `claude/hybride` als `indelingen/apc40mk2-hybride.json`, naast de DJ-indeling.
2. **De Maschine loopt via de hub**, ook op Linux en inclusief de schermen. Geen eigen driver en geen WebHID nodig. De Mac-route is niet getest.
3. **De APC draait in modus 0x42** (uit het protocoldocument). "Modus 1" in §5 is verouderd.
4. **Indelingen gebruiken het eigen JSON-formaat van v2.** Een importer voor Bedienplan is niet nodig, tenzij Clay erom vraagt.
5. **De crossfader-tijd is gebouwd** (F5, 30 okt): een ring van momentopnames, zie de stand hieronder.

Besluiten van Clay:
- **USER = THUIS alleen in Hybride.** De DJ-indeling blijft ongewijzigd.
- **Volgorde na F3:** (a) fixen wat Clay's test op de echte APC oplevert, (b) F5 crossfader = tijd, (c) F4 beeldruimte, (d) Maschine-schermen als etiket. Alles, in die volgorde.
- **Samenwerking:** vragen aan Clay gaan altijd via het keuzemenu. Overdracht tussen chat-Claude en Claude Code loopt via Clay, in het vaste blok STAND / BESLUITEN / AFWIJKINGEN / VRAAG AAN ANDERE CLAUDE.

Stand (30 okt, 01:52):
- F0–F5 en de Maschine-etiketten zijn gebouwd.
- W1–W5 slagen in software (590 tests groen). W1, W2, W3 (beeldruimte) en W5 zijn ook nagelopen in Chrome. W4 is alleen in de tests gedaan.
- De crossfader-tijd is een ring van momentopnames: elke seconde, 10 minuten terug. Alleen waarden; welk patroon of nummer liep, zit er niet in.
- Hybride blijft gekozen bij een focuswissel (bug gefixt).
- **Op de hardware is nog niets getest.** Dat is nu de enige poort.

---

## 1. Wat we bouwen (in één alinea)

Een volledig eigen modulair AV-systeem (software-synth + video-synth) dat in symbiose werkt met twee controllers: **Akai APC40 mkII** en **Native Instruments Maschine MK2**. Het idee: zoveel fysieke knoppen dat je directe controle hebt, op manieren waarop deze controllers nooit eerder zijn gebruikt. Er zit een **vast basissysteem** onder zodat je nooit de weg kwijtraakt. Als Clay het kent, moet hij het **zonder scherm** kunnen bespelen; alleen de twee mini-schermen van de Maschine mogen meekijken, als etiket.

Het moet **samengevoegd worden met wat er al bestaat** (zie §6). Niet opnieuw beginnen.

---

## 2. Gekozen richting: Hybride

Uitgewerkt en vergeleken in het artifact **Symbiose-lab** (https://claude.ai/artifact/4pDR5Wfk8VSCbY2ot5r6yx). Zes benaderingen zijn op vijf workflows gesimuleerd: schermen, grid, spiergeheugen, geluid, ruimtes en hybride. **Hybride** was de enige die alle vijf workflows zonder kijken haalt en toch onbeperkt functies houdt.

> Werkaanname: Hybride. Heeft Clay een samenvatting uit Symbiose-lab geplakt met een andere nummer 1, volg dan die. Ideeën die hij op "nee" zette, bouw je niet.

**Hybride betekent:**
- Het **APC-grid is de kaart**: kleur en positie vertellen waar je bent en wat waar zit.
- **Ankers** veranderen nooit, in geen enkele ruimte.
- De **Maschine-schermen zijn etiketten**: ze tonen naam en waarde van wat je vastpakt. Ze zijn nooit nodig om te navigeren.
- **Geluid is bevestiging**: elke wissel van ruimte en elke bevestiging heeft een zacht klankje.

---

## 3. De grondwet (harde regels, niet onderhandelbaar)

1. **Ankers**: de faders zijn altijd mix/morph, de crossfader is altijd tijd en USER is altijd THUIS. Dit geldt in elke ruimte.
2. **Maximaal één laag diep**, en THUIS brengt je altijd terug.
3. **Kleurtaal**, overal gelijk: blauw = klank · oranje = beeld · wit = tijd · paars = navigatie/patch.
4. **Geen verborgen toestand**: alles wat aan staat, is aan een LED te zien.
5. **Bevestiging via geluid**: elke ruimte heeft een eigen toon en THUIS heeft de grondtoon. Stem de klankjes op de huidige toonsoort en houd ze zacht.
6. **Ogen dicht** is de toets: elke kernworkflow moet zonder kijken kunnen.

### Zone-indeling

| Zone | Vaste rol |
|---|---|
| APC rechterpaneel + Bank-kruis (▲▼◀▶) | Navigatie tussen ruimtes |
| APC USER | THUIS |
| APC grid 8×5 | Kaart van de huidige ruimte |
| APC faders 1–8 + master | Mix en morph (altijd) |
| APC crossfader | Tijd/geheugen (altijd) |
| APC device-knoppen (8) | Detail van wat je vastpakt; de LED-ring toont live modulatie |
| APC trackknoppen (8, boven) | Parameters van de huidige ruimte |
| Maschine pads 4×4 | Spelen: de hand |
| Maschine encoders + schermen | Naam, waarde en bereik van wat je vastpakt (etiket) |

### Ruimtes (begin met maximaal 3)

| Ruimte | Grid betekent | Kleur |
|---|---|---|
| **Thuis/Klank** | Bronnen: rijen 1–2 klank, 3–4 beeld, 5 tijd | gemengd |
| **Patch** | Rij = bron, kolom = doel, celhelderheid = sterkte | paars/oranje |
| **Beeld** | Beeldlagen en hun parameters | oranje |
| (Tijd, onder SHIFT) | 40 cellen = 10 minuten tijdlijn | wit |

---

## 4. Acceptatietests (de vijf workflows)

Elke test moet slagen **met de echte APC40**, zonder naar een computerscherm te kijken.

| # | Workflow | Hybride-uitvoering | Moet zonder kijken |
|---|---|---|---|
| W1 | Drone uit stilte | Blauwe cel g00 tikken → fader 1 omhoog | ja |
| W2 | Koppeling leggen | BANK ▶ (patch, toon) → cel LFO1×Helderheid → device-knop 1 = sterkte → THUIS | ja |
| W3 | Naar beeld en terug | BANK ▶▶ (oranje) → trackknoppen 1–2 → THUIS, alles staat er nog | ja |
| W4 | Terug in de tijd | Crossfader naar links = scrubben door het actielog tot −10 min | ja |
| W5 | Verdwaald | THUIS → grid = kaart + grondtoon | ja |

---

## 5. Hardwarefeiten (eerst checken, niet aannemen)

- **APC40 mkII** is class-compliant MIDI en werkt dus overal. De LED's worden via sysex en note/velocity aangestuurd. De modus wordt via sysex gezet; volgens eerder onderzoek is dat modus 1. **Controleer noten, kanalen en het kleurpalet tegen de Akai-protocolspec.** Bedienplan en het Ademmachine-onderzoeksdoc hebben dit al eerder uitgezocht, dus hergebruik dat.
- **Maschine MK2** stuurt géén MIDI over USB, maar gebruikt een eigen USB-HID-protocol.
  - Mac: een MIDI-modus via NI Controller Editor. Nog niet geverifieerd op M1/huidige macOS. **Test dit als eerste.**
  - Linux/Omarchy: er is geen officiële driver. Zelf bouwen via HID. Bestaande open-source code: `hansfbaier/open-maschine` (MK2 proof-of-concept), `openAVproductions/openAV-Ctlra`, `wrl/maschine.rs`, `shaduzlabs/cabl`.
  - **Snelle route om te proberen:** WebHID in Chrome. Lukt het om pads te lezen en LED's te zetten, dan is er geen aparte daemon nodig. Ongetest.
  - Eigen inhoud op de schermen zetten vraagt de eigen HID-driver. Dat is **fase later**. Het systeem moet volledig werken zónder de schermen.
- Werkplekken: thuis de Omarchy-pc (Arch + Hyprland) met de controllers; mobiel de MacBook Air M1. Het moet op beide draaien.

---

## 6. Wat er al bestaat — eerst zoeken, dan hergebruiken

**Stap 0 is altijd inventariseren.** Zoek lokaal en in GitHub/artifacts naar onderstaande en naar trefwoorden `apc40`, `apc`, `maschine`, `webmidi`, `requestMIDIAccess`, `WebHID`, `koppeling`, `matrix`, `patchbaai`, `actielog`, `replay`. Maak een hergebruiktabel (wat · waar · bruikbaar ja/deels/nee · actie) **voordat je iets nieuws schrijft**.

| Bestaand | Wat erin zit dat we nodig hebben | Waar (laatst bekend) |
|---|---|---|
| **av-kern** (Vite + TypeScript) | Basisrepo voor dit systeem; is nog niet getest met de echte APC40 | repo `av-kern` (geleverd als zip; mogelijk nog niet op GitHub) |
| **Totaalplan AV-kern** | Fasen 0–4, architectuur web-kern + optionele sidecar | https://claude.ai/code/artifact/1fe3f1ca-e80f-43d7-9b66-2912dc3f0942 |
| **Ademmachine-onderzoek** | APC40-mapping uit de Akai-spec (modus via sysex), parameterbus, modulatiematrix | https://claude.ai/code/artifact/5981fc12-44b9-47df-be66-12e91e829065 |
| **Ademmachine-mockup** | Werkende Web MIDI-koppeling met LED-feedback, Web Audio, WebGL2, 5 scènes | https://claude.ai/artifact/P4LL87G9D1XxZknFHQUptS |
| **Bedienplan** | Blauwdruk-bouwer, APC40 én Maschine MK2, lagen; blauwdrukken in de artifact-db (collectie `blueprints`, doc `ademmachine-apc40`); export JSON | https://claude.ai/artifact/JjvkkccKR8h88UgDzKgvV1 |
| **Signaalpad-prototype** | AV-kern signaalpad | https://claude.ai/artifact/FJ3VyNPAPEhjdU3pSA9Ctw |
| **av-synth-harnas.html** | 14 bronnen, 8 krommen, 15 bestemmingen = basis voor de Patch-ruimte | lokaal zoeken |
| **av-synth-prototype.html (v0.3)** | Fixed timestep, **actielog + replay** (= crossfader-tijd), 9 beeldlagen, bindingen, Bank met 75 entries | lokaal zoeken |
| **Vormmachines** | 22 levende vormsystemen met in/uit-poorten = beeldmodules | artifact zoeken |
| **Waterschaal** | Klankschaal + handpan-ring = een klankbron | artifact zoeken |
| **Strata / NEXUS** | Modulestructuur / CLI-AV-systeem; check of er nog bruikbare onderdelen zijn | zoeken |
| **Studio-opstelling** | `~/Projecten/werkplek/studio/opstelling.json` + TASKS.md | lokaal |
| **Symbiose-lab** | Deze vergelijking, workflows als stappenlijsten | https://claude.ai/artifact/4pDR5Wfk8VSCbY2ot5r6yx |

Bestaande besluiten blijven staan, tenzij je tegenbewijs vindt. Meld dat dan, maar draai het niet stilletjes om.

---

## 7. Architectuur

```
[APC40 · Web MIDI]  [Maschine · MIDI-modus of WebHID/eigen driver]
          \              /
       Controllerlaag  (normaliseert naar events: id, type, waarde, druk/loslaat)
                |
       Grondwet-laag   (ankers, THUIS, ruimtes, kleurtaal, LED-uitvoer, klankjes)
                |
       Parameterbus + modulatiematrix  (uit av-synth-harnas / Ademmachine)
          /                 \
   Audio-motor          Beeld-motor
   (Web Audio)          (WebGL2, beeldlagen, Vormmachines)
                |
       Actielog (elke actie, met tijd) → replay/scrub via crossfader
```

- **Eén bron van waarheid voor de mapping**: een `mapping.json` in het formaat van de Bedienplan-export. Laad een Bedienplan-blauwdruk in plaats van mappings hard te coderen.
- **LED-uitvoer is een render van de toestand**, geen losse code per knop. De functie `leds = f(toestand, ruimte)` draait elke frame of bij elke verandering.
- **Ruimtes zijn data**: per ruimte een betekenis voor grid, trackknoppen en kleur.
- De Maschine-schermlaag is een aparte module die mag ontbreken.

---

## 8. Fasering

| Fase | Inhoud | Klaar als |
|---|---|---|
| F0 | Inventaris + hergebruiktabel + CLAUDE.md/design.md + TASKS.md + git-checkpoint | Tabel staat in de repo |
| F1 | Controllerlaag: APC40 in/uit inclusief LED-kleuren; Maschine-test (Mac MIDI-modus + WebHID-probe) | Elke knop logt, grid-LED's zijn aan te sturen |
| F2 | Grondwet: ankers, THUIS, kleurtaal, klankjes, ruimte-wissel via Bank | W1 en W5 slagen |
| F3 | Patch-ruimte op de bestaande koppelingsmatrix | W2 slaagt |
| F4 | Beeld-ruimte (beeldlagen/Vormmachines) | W3 slaagt |
| F5 | Crossfader = tijd op het bestaande actielog/replay | W4 slaagt |
| F6 (later) | Maschine-schermen als etiket (eigen HID-driver), daarna de ideeën die Clay op "erin" zette | — |

**Stopcriterium voor deze run:** F0–F3 werkend met de echte APC40, en W1, W2 en W5 slagen zonder naar een computerscherm te kijken. Daarna stoppen en rapporteren.

---

## 9. Ideeënbak (na F5, alleen wat Clay op "erin" zet)

Grid als patchbaai (zit al in F3) · levend grid (Game of Life → noten/pixels) · morph-faders · encoders met fysica · druktijd/tap-ritme als LFO · akkoordtaal · pads als XY-vlak · LED-ringen als meters · systeem nodigt uit (knipperende suggestie van regels/AI) · twee rollen (Maschine = regels, APC = uitvoering) · ogen-dicht-modus · klankjes per ruimte · schermen als oscilloscoop · ademtempo uit hartslag · weer als bron.

---

## 10. Werkwijze (Clay's vaste afspraken)

- **Bouw zelf en besluit zelf**. Stop alleen vóór iets onomkeerbaars (wissen, pushen naar een publieke plek, geld, server) of als je echt niet verder kunt zonder Clay.
- Zorg dat de repo een **CLAUDE.md** heeft (waarom, voor wie, doel) en een **design.md** (kleurtaal hierboven; níet: gradiënten, glassmorphism, Inter, ronde kaartjes; wel de glitch/pixel-esthetiek). Maak ze als ze ontbreken.
- Houd **TASKS.md** bij: vink af en zet nieuwe vondsten erbij.
- Maak een **git-commit/branch vóór elke grote wijziging**.
- Gebruik **subagents** waar het parallel kan, bijvoorbeeld voor de inventaris, de Maschine-HID-research en de APC-spec.
- **Markeer wat niet geverifieerd is** en waar je hebt gezocht.
- Sluit de run af met vier kopjes: **Wacht op mij · Veranderd · Gevonden · Staat alleen in Claude?**
