# Hybride: de grondwet op de APC40 en de Maschine

**Waarom.** Clay wil een eigen modulair AV-systeem dat in symbiose werkt met twee controllers. Er zijn zoveel
knoppen dat je directe controle hebt, op manieren waarop deze controllers nooit eerder zijn gebruikt. Er ligt
een vast basissysteem onder, zodat je nooit de weg kwijtraakt.

**Voor wie.** Alleen Clay. Als hij het kent, bespeelt hij het zonder naar een scherm te kijken.

**Gekozen richting.** Hybride, uit Symbiose-lab (https://claude.ai/artifact/4pDR5Wfk8VSCbY2ot5r6yx). Het
APC-grid is de kaart, ankers veranderen nooit, de Maschine-schermen zijn etiketten, en geluid bevestigt.

Gebouwd op 30 okt 2026, op tak `claude/hybride` (vanaf `claude/opstelling`), als een eigen APC-indeling
**naast** de DJ-indeling. Kiezen kan in het indelingspaneel, of met `?indeling=hybride` in de URL.

## De grondwet, zoals gebouwd

Wordt bewaakt door `app/test/hybride.test.mjs`.

| Regel | In de indeling (`app/indelingen/apc40mk2-hybride.json`) |
|---|---|
| Ankers | Fader 1–8 is mix van track 1–8, master is master, Track Select is vastpakken (focus), USER is THUIS. Ze staan in de basis en in **geen** laag of achter SHIFT. |
| Crossfader = tijd | `tijd.scrub`, in elke ruimte (F5, 30 okt): midden = nu, links = terug tot 10 minuten (kwadratisch: dicht bij nu fijn). Terug naar het midden = de stand van vóór het scrubben. Raak je terwijl je terug bent iets anders aan, dan speel je verder vanaf het verleden. |
| Eén laag diep | Ruimtes zijn lagen `ruimte.patch` en `ruimte.beeld`. Thuis is geen laag. Er zijn geen lagen in lagen. |
| Kleurtaal | Blauw = klank (bronnen, beweging), oranje = beeld, wit = tijd (momenten), paars = navigatie en patch. |
| Geen verborgen toestand | Scene 1–3 tonen de ruimte (de huidige brandt vol). USER brandt in Thuis. Een cel brandt als zijn bron klinkt. Patch-cellen tonen hun sterkte. De device-ringen tonen hun waarde. |
| Geluid bevestigt | Elke ruimtewissel speelt een zacht klankje, gestemd op de toonsoort: Thuis = grondtoon, Patch = kwint, Beeld = terts (`audio/klankje.js`, `engine/acties-hybride.js` `klankje`). |
| Ogen dicht | W1, W2 en W5 zijn als tests uitgeschreven met de echte indeling. Op de hardware moet Clay ze nog proberen. |

### Zones

| Zone | Rol |
|---|---|
| Scene 1–3 (rechterpaneel) en Bank-kruis ◀ ▶ | Navigatie: Thuis · Patch · Beeld. ◀ ▶ lopen door de ruimtes. |
| USER | THUIS |
| Grid 8×5 | De kaart van de ruimte (zie onder) |
| Faders 1–8 en master | Mix, altijd |
| Device-knoppen | Thuis: instrumentknop 1–8 van de track die je vastpakt. Patch: knop 1 = sterkte, knop 2 = snelheid van de bron. |
| Trackknoppen (boven) | Thuis: filter 1–8. Beeld: vorm 1–6, dekking, beeld. |
| Maschine | Pads = de hand (padstanden A–G), encoders = de acht macro's, schermen = etiket (naam en waarde) |

### De ruimtes (rij 1 = boven)

| Ruimte | Grid |
|---|---|
| **Thuis/Klank** | Rij 1: bron 1–8 (blauw). Tikken laat track k klinken: met een nummer spelen/pauze, zonder nummer een drone in de toonsoort op het instrument van die kolom (korrel · schaal · poly · fm · korrel · poly · schaal · fm). Rij 2: beweging 1–8, een patroon uit het zaad, aan/uit op de maat. Rij 3–4: beeld (effecten, vormlaag, flits, zwart, clips). Rij 5: momenten (wit): tik bewaart, nog eens tikken haalt terug, SHIFT maakt leeg. |
| **Patch** | Rij = bron: 1 LFO (1 maat), 2 LFO (4 maten), 3 stap, 4 dwaal, 5 Lorenz. Kolom = doel, de acht rollen van het alfabet: schaal · dichtheid · beweging · vervorming · kleur · **helderheid** · variatie · ruimte (met een opstelling de macro's, anders vaste plekken). Helderheid van een cel = sterkte. Tik = kiezen (een lege cel begint op 50%), de gekozen cel nog eens = uit. SHIFT+STOP ALL = alles uit. |
| **Beeld** (helemaal oranje) | Rij 1: effecten vol zolang je drukt (pixel, spiegel, rgb, kleur, sporen, korrel) + vormlaag aan + bevries. Rij 2: vormlaag 1/2, vorige/volgende vorm, mengvorm, videomodus, passend/vullen, clips. Rij 3: flits, zwart, wat er pulst, reageert op (bron), reageert met (knop). Trackknoppen: vorm 1–6, dekking, beeld. Device-knoppen: hoeveel van elk effect, reageer-sterkte, puls op de tel. |

**De Maschine-schermen zijn etiketten.**
- Links: de naam van de ruimte, groot (met "TIJD −m:ss" als je terug bent), en wat de device-knoppen daar doen, met hun stand.
- Rechts: vier seconden lang wat je net vastpakte, op de APC of de Maschine. Je ziet de naam uit de indeling, de waarde in echte eenheden waar die bekend zijn (instrumentknoppen, filter, patch-sterkte met bron × doel, tijd), een balk, het bereik, en waar je het pakte.
- Daarna toont rechts weer de padstand of de opstelling.
- Alles werkt ook met de schermen uit.

## De vijf workflows

| # | Op de APC | Stand |
|---|---|---|
| W1 | Cel linksboven (blauw, bron 1) → fader 1 omhoog | gebouwd, test in software groen, ook in Chrome |
| W2 | ▶ (Patch, kwint) → cel rij 1 × kolom 6 (lfo × helderheid) → device-knop 1 = sterkte → USER | gebouwd, test in software groen, ook in Chrome |
| W3 | ▶▶ (Beeld, terts, helemaal oranje) → trackknop 1–2 → USER, alles staat er nog | gebouwd, test in software groen |
| W4 | Crossfader naar links = terug tot −10 min; midden = nu | gebouwd, test in software groen |
| W5 | USER: het grid is de kaart, met de grondtoon | gebouwd, test in software groen, ook in Chrome |

Op de hardware is nog niets getest. Dat doet Clay, met de ogen dicht.

## Hergebruik

| Wat | Waar | Bruikbaar | Wat ik ermee deed |
|---|---|---|---|
| VarveDJ v2 | `youtube-mixer/v2/app` | ja: de basis | Hybride als indeling. Engine, bus, indelingen, lampjes, Maschine via de hub, opstellingen, korrelwolk, gebaren, tocht, takes. |
| AV-app-hub | `~/Projecten/AV-app-hub-apparaten` | ja | APC40 (MIDI) en Maschine MK2 (USB-HID, **met schermen**) op Linux, met lease en focus. Op 29 okt live geproefd. |
| av-kern | GitHub `CKrebbers/av-kern` | deels | De opdracht noemde dit de basisrepo. Clay koos op 29 okt v2 als basis. De vier audiomodules en Veld staan in de inventaris als bouwwens. |
| Totaalplan AV-kern | `second-brain/artifacts/totaalplan-av-kern__4wQJ…` | deels | De fasering spiegelt zich in F0–F6 hieronder. |
| Ademmachine-onderzoek en -mockup | `artifacts/ademmachine__P4LL87G9D1XxZknFHQUptS.html` | deels | De APC-nummers komen in v2 uit Akai's protocoldocument v1.2 (`control/apparaten/apc40mk2.js`, modus 0x42), al nagelegd tegen de hub. |
| Bedienplan | `artifacts/bedienplan__JjvkkccKR8h88UgDzKgvV1.html` | deels | Het formaat van v2 is een indeling-JSON, ook data en niet hard gecodeerd. Een importer voor Bedienplan-blauwdrukken bestaat **nog niet** (TASKS). |
| Signaalpad | `artifacts/av-kern-signaalpad__FJ3V…` | nee | Zelfde lagenidee als de v2-engine. |
| av-synth-harnas (14 bronnen, 8 krommen, 15 bestemmingen) | **niet gevonden** op de pc of in de mac-spiegel; alleen beschreven in `second-brain/geheugen/areas/av-synth.md` | deels | De patch heeft er 5 bronnen van (lfo, stap, dwaal, Lorenz). De rest (euclid, logistic, RMS, krommen) staat in TASKS. |
| av-synth-prototype v0.3 (actielog + replay) | **niet gevonden** | deels | v2 heeft een eigen handelingenlog (`engine/log.js`) en takes. F5 bouwt de crossfader-tijd daarop. |
| Vormmachines | v2 `src/beeld/vormen` (26 systemen) | ja | De beeldlagen. |
| Waterschaal | v2 klankschaal (`audio/instrumenten/schaal*.js`) | ja | Bron "schaal". |
| Strata / NEXUS | `varve-site/strata-ambient` (geminificeerd) | deels | Algoritmen als bouwwens (zie de inventaris van 30 okt in OPSTELLING.md). |
| Studio-opstelling | `~/Projecten/werkplek/studio/opstelling.json` | niet gebruikt | Is voor het bureaublad. |
| Symbiose-lab | artifact `4pDR5Wfk8VSCbY2ot5r6yx` | ja | Deze richting. |

## Waar de opdracht afwijkt van wat er is

Gemeld, niet omgedraaid:

1. **Basisrepo.** De opdracht noemt av-kern. Clay koos op 29 okt v2 ("v2"), en daar zit alles al in. Hybride staat daarom in v2.
2. **De Maschine stuurt geen MIDI en heeft een eigen driver nodig?** Op Linux leest de AV-app-hub hem al via USB-HID (node-hid), met lampjes en **schermen**: 29 okt live, 182 schermbeelden aangenomen. De schermen zijn dus geen latere fase meer. WebHID in Chrome is daarom niet nodig. NI Controller Editor op de Mac is niet getest; de hub werkt daar in principe ook via HID, maar dat is ongetest.
3. **APC-modus "1".** v2 en de hub gebruiken modus 0x42 (Alternate Ableton Live) uit het protocoldocument v1.2: alle lampjes en ringen zijn van ons. De hub meldt dat er geen antwoord op de modus-instructie komt. Dat bleek op 27 okt een vals alarm.
4. **Eén mapping.json in Bedienplan-formaat.** v2 heeft per apparaat een indeling-JSON. Die is ook data (lagen, shift, lampjes), maar heeft een ander formaat. Een importer staat in TASKS.
5. **USER.** In de DJ-indeling zette ik op 29 okt de partituur op USER. In Hybride is USER THUIS, zoals de grondwet zegt. In de DJ-indeling blijft USER de partituur, tot Clay kiest.

## Antwoorden aan chat-Claude (30 okt)

**1. Welke beeldlagen en parameters biedt v2 nu voor F4?**

- **Video per track:** acht deck-video's, gemengd zoals het geluid (faders, crossfader).
- **Twee vormlagen** (26 systemen). Per laag:
  - 6 knoppen;
  - dekking;
  - mengvorm (screen / add / multiply);
  - "reageren op de mix": bron laag/midden/hoog/klap/luid/tel/de 1, naar knop 1–6, met een sterkte.
- **Zes effecten**, elk een waarde van 0 tot 1 met een vasthoud-versie: pixel, mirror, rgb, color (bipolair: 0,5 = normaal), trails en grain.
- **Losse knoppen:** master, puls op de tel (met "wat pulst"), flits, zwart (vasthouden), bevriezen, videomodus (mengvorm), passend/vullen, clips.
- **De Stroommachine** (als de relay verbonden is): 8 macro's (intensiteit, snelheid, helderheid, feedback, tint, dichtheid, glitch, balans) en 6 regie-triggers.
- **De indeling** van de beeldruimte staat hierboven.

**2. Bewaart het handelingenlog genoeg om 10 minuten terug te scrubben?**

Nee. Het log gaat elke seconde als tekst naar de server (`opnames/<set>.acties.jsonl`) en houdt niets in het geheugen. Daarom heeft F5 zijn eigen ring:
- elke seconde een momentopname van alle waarde-acties, met dezelfde selectie als de beginstand van het log;
- 600 opnames, dus 10 minuten;
- een opname kost een paar ms per seconde.

Wat níet terugkomt: alles wat geen waarde is, dus welk patroon loopt, welk nummer geladen is en wat aan of uit staat via triggers. Dat zou per deel de structuur moeten bewaren: een uitbreiding, als het nodig blijkt.

**3. Wat kunnen de Maschine-schermen via de hub laten zien?**

Pixels. Per scherm stuur je 2048 bytes: 256 × 64 pixels, 1 bit, rij voor rij. Alle tekst tekenen we zelf, met een 5×7-font. Een oscilloscoop is dus goedkoop. Wel geldt:
- de hub laat hooguit één beeld per scherm per 40 ms door (25 fps);
- v2 stuurt alleen een beeld dat veranderd is.

## Starten

```bash
cd ~/Projecten/AV-app-hub-apparaten && node src/cli.js start
cd ~/Projecten/youtube-mixer/v2/app && VARVE_MEDIA=$HOME/.varve/pc-media node server.mjs
```

Chrome: `http://localhost:8780/?hub=ws://127.0.0.1:7700/app&indeling=hybride`. Doet de APC niets, dan heeft
een andere app zijn focus. Druk dan op Bank + Track Select 2, of klik VarveDJ aan in de cockpit (:7700).
