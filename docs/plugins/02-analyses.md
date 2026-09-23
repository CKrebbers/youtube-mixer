# Negen analyses (24 september 2026)

Onderbouwing bij `01-plan.md`. Elk stuk is door een aparte agent geschreven, alleen lezend.


# plan-vs-werkelijkheid
**Kern:** Het projectplan van 23 september beschrijft een Varve DJ die niet meer bestaat. Driver, mapping, register, deck, sidecar, mixer, video en opname zijn in Varve al gebouwd, en op de punten die ertoe doen beter dan in AV-kern: 0x42, een MIDI-wachtrij, één tabblad per APC via de Web Lock, streaming en acht tracks. Echt nieuw en waardevol zijn alleen de Vormmachines als beeldlagen, realtime analyse (banden, centroid, live onset), handelingen-replay en een handvol DJ-functies uit de blauwdruk. De richting wordt dus "AV-kern-ideeën landen in Varve", met een klein gedeeld randje (Vormmachines en analyse als pure modules), niet "Varve als blauwdruk op AV-kern".

## Tabel "Wat er nu ligt" (plan r15–25) tegen Varve

| Onderdeel | Oordeel | Onderbouwing |
|---|---|---|
| MIDI-driver | **Bestaat, Varve beter. Botst.** | AV-kern stuurt 0x41 (`apc40.ts:6`) en vraagt zelf `requestMIDIAccess` aan (`midi.ts:121`). `computeLeds()` stuurt alle verschillen synchroon, zonder wachtrij. Dat is precies het burstpatroon achter de vijf Chrome-crashes. Varve heeft `midi.js` (421 r) met 16 berichten per 4 ms, een echofilter, de Web Lock, hotplug op `connected`, endless-ringen en 0x42 (`devices/apc40mk2.js:22`). |
| Blauwdruk-loader | **Bestaat anders.** | Varve: `mappings/apc40mk2.json` met 291 regels, shift, mapjes, learn en migratie v1→v3. Het Bedienplan-formaat blijft bruikbaar als importformaat. |
| Register | **Bestaat: `actions.js`.** | 69 `define`-plekken, per track vermenigvuldigd, plus `apc-beschrijf.js`. AV-kern: `KERN_BLUEPRINT = 'ademmachine'` hard (`functions.ts:161`). |
| Bus met slew | **Deels nieuw. Botst met regel 3.** | `Bus.step()` telt zijn eigen `tick` (`bus.ts:109–115`) en draait op rAF (`main.ts:206`). rAF staat stil in een achtergrondtab. Daarom lopen Varve's LED's op `setInterval` (`midi-opzet.js:83`). τ geklemd op 0,02 (`bus.ts:111`). Varve heeft glijden per macro (`macro.glide`), maar geen generieke modulatiebus. |
| Modules/slots | **Varve heeft racks** (`fx.js`, 1098 r). | AV-kern: 8 vaste meditatieslots (`slots.ts`), waarvan 2 live. |
| Opname | **Varve beter.** | WAV/RF64 + mp4, `?frame=N`, herstel na een crash. |
| Replay (MIDI-log + FNV-hash) | **Nieuw voor Varve**, maar de hash-check kan niet. | Varve's engine is niet deterministisch: streaming, audioklok, netwerk. Een actie-log met ctx-tijd kan wel. |
| Analyse "nieuw, groot" | **Half achterhaald.** | Offline bestaat al: `detect.js` (1100 r), tempokaart, onsets (`/api/library/<id>/onsets`), `track.N.phase`. Realtime banden, centroid en live onset zijn nieuw. Er is al een analyser per strip (`audio-graph.js:37`, fftSize 1024), maar die tapt NA xfade. Toonsoort staat gepland (ROADMAP r153) en is niet gebouwd. |
| Vormmachines | **Echt nieuw.** | 26 systemen (`vormmachines.html:240`), Canvas 2D (`Grid()`, r190). Overal `Math.random` (r194–198, dus niet replaybaar) en `performance.now()` in de acties (r256, dus niet op de audioklok). |
| "Varve DJ: alleen plan" | **Onjuist.** | 23 testbestanden, 1480 checks groen, fasen 0–5 uit ROADMAP gebouwd. |

## Doelarchitectuur en sidecar

- **Eén repo `av-kern` met Vite/TS (r31, r53–59): botst** met "geen build, nul frontend-deps" in CLAUDE.md. Het totaalplan (r46) legt Vite + Vitest vast en bevriest de kern na sessie 2 (r233). Een kern die ook Varve moet dienen kan niet bevroren blijven.
- **Sidecar = `server/` (poort 8777).** `/cache` = `POST /api/ingest` (pollen, geen SSE). `/stream` = statische media met Range. `/analyse` = `/api/library/<id>/analyseer` + `verfijn`. `/meta` = library. `/samples` = tabel `samples` (schema v4), wel per nummer en niet per tag.
- **Wat nog ontbreekt:** `/zoek` (nieuw, klein), `/cues` (hotcues per nummer staan in ronde 3), `/ai/gen` (buiten scope).
- **Python-worker met aubio/librosa: botst** met nul deps. `detect.js` doet het zonder.

## Interfaces (r63–97)

- **`AnalyseFeatures`:** `bpm` en `beatPhase` bestaan. `barPhase` is zwak: er is geen maat-anker per stuk (HANDOFF). Van `key` is alleen het plan er. `rms`, `bass`, `mid`, `high`, `centroid` en live `onset` zijn nieuw.
- **`AnalyseSource`:** `id: 'deckA'|'deckB'` botst met 8 tracks. `frame()` 1× per rAF botst met de achtergrondtab-grens. De tap "na EQ, vóór fader" wijkt af van Varve (na xfade).
- **`DeckModule` bestaat** als `deck.js` + `bron.js`, verder uitgewerkt (streaming, bend, pitchbereik, tempokaart).
  - `mode: 'media'` met de `<video>` als klok **botst** met "video is SLAAF" en met regel 3.
  - `keylock` via SoundTouch (r99) **botst** met Signalsmith (ROADMAP r101–117: warbelen, licentie).
  - `pfl` is nieuw en hangt aan open vraag F1 (tweede uitgang).
- **`VormModule` is nieuw en waardevol.** `tick(t, budgetMs)` moet `t` wel uit `ctx.currentTime` halen.

## Deck-keten (r101)

- EQ bestaat: highshelf op 4 kHz is gelijk, kill zit onder 3% van de knop (`audio-graph.js:48`).
- Het bipolaire filter bestaat.
- Fader: Varve gebruikt een dB-lijn (`faderGain`, r108), het plan fader².
- Crossfader: Varve heeft `smooth`/`sharp`, `linear` ontbreekt.
- Het "slew botst met cuts"-risico (r207) bestaat in Varve niet: er is geen slewbus, alleen `setTargetAtTime` van 8 ms (`deck.js:458`).

## Blauwdruk en fasen

- **Blauwdruk (r105–180): botst** met "één kolom = één track" (APC40-onderzoek, VRAGEN G2): twee gespiegelde decks, pitch buitenaan, EQ op de track knobs.
- **Losse functies die nieuw zijn:** hotcues 5–8, loop in/out, beatjump, slip, brake, censor, kill als toggle, quantize, tempo-master, PFL. `grep` op slip, brake en beatjump in `src/` geeft 0 treffers.

**Fasen:**
- **Fase 0:** alleen voor AV-kern.
- **Fase 1:** nieuw.
- **Fase 2:** half gedaan.
- **Fasen 3–4:** gedaan (behalve `/zoek` en cues).
- **Fase 5:** sync gedaan. PFL (F1) en keylock (A3) staan open.
- **Fase 6:** vervangen door de eigen mapping. Top-actie 1 ("blauwdruk in AV-kern plakken") is achterhaald.
- **Fase 7:** de video-helft is gedaan, de 6 Vorm-presets zijn nieuw.
- **Fase 8:** opname gedaan, replay niet.

Van de geraamde 16–17 sessies blijft grofweg 5–7 over (aanname).

## Advies
## Richting: "AV-kern-ideeën landen in Varve", met een klein gedeeld randje

**1. Varve niet herbouwen als blauwdruk op AV-kern.** Dat kost streaming, acht tracks, de MIDI-wachtrij en de Web Lock, en brengt het crashpatroon terug (synchrone LED-bursts, 0x41). Het omgekeerde is zinniger: AV-kern zou Varve's `midi.js`-aanpak (wachtrij, lock, echofilter) mogen overnemen.

**2. Delen alleen waar geen host-aannames in zitten.**
- **Vormmachines** als pure module: `init`/`step(dt, params)` levert een canvas, en de tijd komt van de host.
- **Realtime analyse** als pure functie (spectrum → features).
- Beide in plain ES-module plus JSDoc, zodat Varve (geen build) en AV-kern (Vite) ze allebei importeren.
- **Trade-off:** geen strikte TypeScript in het gedeelde deel, of Clay accepteert optie A uit de inventaris (`.ts` gestript door de server).

**3. `@varve/kern` flink kleiner maken.**
- Niet overnemen: driver, loader en register. Die dupliceren Varve en botsen erop.
- Wel waardevol:
  - een **modulatiebus** (slew, ademklok, router bron→doel à la Vormmachines), gestapt vanuit de LED-`setInterval` of de audioklok, nooit als hoofdpad voor faders;
  - een **blauwdruk-importer** (Bedienplan-JSON → Varve-mappingregels);
  - **actie-replay** op action-niveau met ctx-tijd, zonder hash-belofte.

**4. Volgorde:**
1. Vorm-poort: een laaghaak in `video-mixer.js` (pass na het mengen) plus 3 systemen, achter `?plugins=vormen`. Levert het meest op per uur, en hangt alleen af van Clay's ja op vraag 5 uit de inventaris.
2. Realtime analyse per track, als bron voor de beeldlagen en `video.pulse`.
3. Een modulatierouter die analyse- en vorm-uitgangen op action-waarden zet.
4. Losse DJ-functies uit de blauwdruk, elk via `define()` in `actions.js`: beatjump, loop in/out, hotcues 5–8, kill-toggle. Slip en brake pas na bespreking.
5. Keylock (A3) en PFL (F1) blijven Varve-eigen beslissingen.

**Trade-offs:**
- **Twee codebases met een gedeelde rand:** een duplicaat van de MIDI-laag blijft bestaan, maar geen van beide apps hoeft te wachten op de ander.
- **Volledig samenvoegen:** rekent het totaalplan (publicatie op 25 okt, kern bevroren) tegen Varve's tempo af. Dat haalt de meditatie-mijlpaal onderuit.

## Vragen
- Mag het projectplan officieel als achterhaald gelden voor de DJ-kant (Varve blijft de DJ-app), zodat AV-kern alleen nog de meditatie-app is?
- Mag de videomixer generatieve lagen krijgen naast 'video van de track' (heropent 'video is SLAAF')?
- Moeten Vormmachines en analyse echt gedeeld worden met AV-kern (dan plain JS plus JSDoc), of alleen in Varve landen (dan vrij)?
- Welke blauwdrukfuncties wil je echt op de APC: beatjump, loop in/out, hotcues 5–8, kill-toggle, slip, brake, censor, quantize, tempo-master?
- Is handelingen-replay (een set opnieuw afspelen vanuit de knoplog) voor jou een wens, of was het een AV-kern-eigenschap?
- Botst dit met de Bouwkaart en prioriteitenregel uit het totaalplan (geen nieuwe infra tot 1 nov, AV-kern-sessies 10 u/wk)?

## Aannames
- De AV-kern-TS-bron in de scratchpad (`avk/av-kern`) is dezelfde versie als Input/av-kern-lokaal.html (volgens de inventaris gecontroleerd op de sysex en 56+k/24+k, door mij niet opnieuw nagelopen).
- 'Nog 5–7 sessies' voor het resterende nieuwe werk is een schatting, niet gemeten.
- Ik ga ervan uit dat de strip-analyser in audio-graph.js:37 nu niet voor features gebruikt wordt: grep vond alleen de master-analyser in opnemer.js.
- Dat de Vormmachines op de M1 samen met acht decks en de WebGL-mixer passen, is niet gemeten. Canvas 2D-simulaties plus een texture-upload per laag kunnen zwaar zijn.
- Over de claimde crashoorzaak (LED-bursts) weet ik alleen wat CLAUDE.md en HANDOFF zeggen: vermoedelijk, niet bewezen.

# kern-vs-control
**Kern:** Neem de kern-driver en de slew-bus níet over in Varve. Varve's control-laag is op bijna elk punt verder: 0x42, endless-ringen, mapjes plus shift in LED's, een echofilter, een wachtrij van 16 berichten per 4 ms en de Web Lock. De kern zou juist de burst- en modusproblemen terugbrengen die Varve op 22 en 23 september heeft opgelost. Drie ideeën zijn wel de moeite waard, als tool of test en niet als tweede runtime: de blauwdruk als importformaat (een converter naar mappings/*.json), statusdekking als rapport of test, en een handelingenlog met replay op mappingniveau, met een hash over de action-reeks en niet over de engine-staat.

### 1. De kern kent Varve's functies niet
- Ik heb de 83 functie-id's in `Input/blueprint-varvedj.json` naast `FNMAP` gelegd (`avk/av-kern/src/kern/functions.ts` r132-145). Er overlappen er maar 5: `master`, `xf`, `rec`, `rec-act` en `shift`. Van de 244 bindingen (147 base, 97 shift) herkent de kern er dus **5**. Ook die 5 wijzen naar de meditatie-bus (`bus.set('master')`, `'xf'` = "balans geluid ↔ beeld", r68-69), niet naar Varve's `mixer.master` en `mixer.xfader`. De andere 239 komen op `ontbreekt` uit. Het projectplan (r7, r17) zegt "direct, geen wijziging", en dat klopt niet.
- **Waar de argumenten staan.** Het deck, het cuenummer en de band staan alleen in de vrije tekst `note`. `pad1-8` heeft `{fn:'hotcue', note:'B hot cue 4'}`, maar `argsOf()` (`apc40.ts` r64-70) haalt uit de positie `m=7` en `row=0`. Door de gespiegelde indeling (deck B = kolom 5-8, pitch op `fader8`) is uit de positie niet af te leiden welk deck het is. De kern zou `note` moeten gaan lezen, dus tekst gebruiken als API.
- **Het gedrag past niet op de APC.** Het gedrag (`beh`) is `trig 126, tog 60, abs 30, pick 14, mom 10, rel 4`, en `endless` bestaat er niet. De track knobs staan op `pick`. In Varve zijn ze `endless` (24 regels), met een ringtype per action: `RING.pan` voor bipolair (`devices/apc40mk2.js` r99). De kern zet elke ring op type 2 (volume) (`midi.ts` r114).

### 2. Wat de kern doet en Varve niet
| Kernstuk | Waar | Heeft Varve het? |
|---|---|---|
| Slew-bus `{cur,tgt,tau}`, 60 Hz, `exp(-dt/τ)`, τ ≥ 0,02 | `bus.ts` r108-115 | Deels, en beter: de engine gebruikt `setTargetAtTime(…, 0.01)` op de audioklok (`audio-graph.js` r55-67), en `macro.glide` (≤ 600 s) glijdt ook op de audioklok. De blauwdruk zelf wil τ=0 op de kanaalfaders en de crossfader (`fader4/5`, `xf`). |
| Statussen kern/alias/stub/ontbreekt, met een reden per blauwdruk (`NEED`) | `functions.ts` r150-168, `blueprint.ts` r26-47 | Nee. Er is alleen een onbekende action met `console.warn` (`actions.js` r58), plus de apc-beschrijf-test. |
| Handelingenlog: ruwe bytes per tick, bus-dump bij de start, FNV-1a-hash bij het einde | `log.ts` r7-72 | Nee. `midi-monitor` toont alleen wat er binnenkomt. |
| Signaalpad-sink (driver → loader → register → bus) met "wacht", "geblokkeerd" en een reden | `types.ts` r89-99, `midi.ts` r50-81 | Deels: er is een `takeover`-event (`mapping.js` r297), maar geen "waarom deed deze knop niets". |
| Blauwdrukformaat uit Bedienplan (`assign[el][laag]={fn,beh,note}`) | `types.ts` r37-46 | Varve heeft een eigen formaat: `{in:'cc:0:48', action, mode, shift?, laag?}`, versie 3, 291 regels. |

### 3. Wat Varve beter doet (en wat de kern zou kapotmaken)
- **Modus.** De kern stuurt `F0 47 7F 29 60 00 04 41 01 00 00 F7`, dus 0x41 (`apc40.ts` r6). Varve stuurt `…04 42 00 00 00 F7` (`devices/apc40mk2.js` r22). Na 0x41 kloppen de device knobs en Track Select van Varve's mapping niet meer (CLAUDE.md, 23 sep). Het projectplan noemt 0x41 "Ableton alt" (r211), maar dat is 0x42.
- **Bursts.** De kern stuurt synchroon: `computeLeds` loopt alle ~120 note-controls langs, `sendRingTypes` stuurt 16 CC's, en `send()` gaat direct naar `out.send` (`midi.ts` r33, r84-114). Varve heeft een wachtrij: `PER_TIK = 16` per 4 ms (`midi.js` r116-124, r351-372). Dat is precies de burst waarbij Comet's MIDI-dienst vier keer crashte.
- **Poorten.** De kern zoekt de poort met `/apc40/i` en kijkt niet naar `state` (`midi.ts` r127-128). Varve telt alleen `connected` (`midi.js` r92), anders krijg je dode LED's na opnieuw aansluiten.
- **LED's.** De kern berekent LED's alleen voor `'base'` (`midi.ts` r88), dus de shiftlaag is nooit zichtbaar. Varve volgt shift en de mapjes via `actieveRegels()`, met drie standen (uit, donker, vol) en knipperen op de tel.
- **Soft-takeover.** Beide doen het: de kern met de drempels 0,03 en 0,04 plus kruising, Varve met `TAKEOVER_EPS = 0.02` plus kruising. Varve heeft daarnaast `endless`: geen overpakken na een focuswissel.
- **Losse onderdelen die de kern mist:** het echofilter (60 ms, `midi.js` r105-148), `mapping.vast` (loslaten gaat naar de action van het indrukken, ook na een wissel van shift of mapje), `losgekoppeld()`, de Web Lock (`tabblad.js`), `{focus}` en de migratie van mappingversies.
- **Determinisme botst met regel 3.** De replay-hash van de kern werkt omdat alles op `bus.tick` loopt (vaste 60 Hz). Varve's positie komt van `ctx.currentTime`, en streaming en netwerk zijn niet deterministisch. Een eindhash over de engine-staat is daarom in Varve per definitie niet reproduceerbaar.

### 4. Kunnen ze naast elkaar bestaan?
Technisch wel. `Driver` kent geen poort (`input(bytes)` en `onSend(fn)`, `midi.ts` r32-39): alleen `connectApc40` (r118-138) raakt Web MIDI aan. Je zou `hub.on('message', m => driver.input(m.raw))` en `driver.onSend(b => hub.send(b))` kunnen koppelen, met het echofilter en de wachtrij er gratis bij. Maar dan mogen ze **nooit tegelijk** draaien: elke knop zou twee keer verwerkt worden, en twee LED-caches overschrijven elkaar. Er is dus een eigenaarsschakelaar nodig plus een volledige LED-reset bij elke wissel. `connectApc40` mag in Varve nooit aangeroepen worden: een eigen `requestMIDIAccess({sysex:true})` doet niet mee aan de Web Lock en zet de APC in 0x41.

### 5. Hoeveel van de blauwdruk Varve nu al kan (handmatige schatting)
Van de 83 functies bestaan er ongeveer **35** al als action onder een andere naam (play, cue, sync, pitch, tempo, bend, pitch.range, focus, fader, trim, low/mid/high, filter, hotcue(.delete), loop.halve/double/toggle, beatloop, fx.bypass/next/knob/mix, xfade.side, mixer.xfader/master/curve, tap, grid.*, record.*). Ongeveer **10** bestaan half (echo-sync, video.fx/mode). Ongeveer **38** ontbreken: keylock, de hele cue- en koptelefoonketen (`pfl`, `cue-level/mix/split`), slip, brake, censor, beatjump, loop-in/out, quantize, play-quant, load/browse, filter-res, eq-kill en ~14 `beeld-*`.

## Advies
### Wat overnemen en als wat
| Kernstuk | Advies | Vorm |
|---|---|---|
| **Blauwdrukformaat** | Overnemen, als **importformaat** | Een puur `.js`-hulpmiddel (bv. `src/control/blauwdruk.js` plus een test) dat Bedienplan-JSON omzet naar een Varve-mapping. Het element-id gaat naar `sig` via de tabel in `apc40.ts`, die zelf uit Akai's protocoldocument komt. Gedrag vertaalt zo: `abs`/`pick` → `absolute`, knoppen met een ring → `endless`, `rel` → `relative-2c`, `trig`/`mom`/`tog` → `trigger`. Laag `shift` → `"shift": true`. **Voorwaarde:** Bedienplan krijgt gestructureerde argumenten (`args:{deck:'B', n:4}`) naast `note`. Tekst lezen doe ik niet. |
| **Statusdekking** | Overnemen, als **idee en test** | Het rapport van de converter geeft per functie: action bestaat (kern) / via een aliastabel (alias) / `define` met `meta.stub` (stub) / ontbreekt, met reden. Dat wordt meteen de bouwlijst van de ~38 ontbrekende functies. |
| **Handelingenlog + replay** | Overnemen, **alleen op mappingniveau** | Leg `{t: ctx.currentTime − t0, sig, value}` vast vóór `mapping.handle`, en `trackIds` in de kop. In `test/` bewaakt dan een hash over de reeks *uitgevoerde actions* (Node, geen audio) de mapping, shift, mapjes en takeover. Het is geen hash over de engine-staat, want die breekt regel 3. |
| **Signaalpad "waarom niets"** | Klein idee | Een regel in `midi-monitor`: niet toegewezen / takeover wacht / action ontbreekt. |
| **Slew-bus** | **Niet** voor audio. Wel als idee voor `@varve/vormen` | Audio heeft `setTargetAtTime` en `glide` al op de audioklok. Een 60 Hz-tik op de hoofdthread staat stil in een achtergrondtab en geeft stapjes van 16,7 ms. Voor vorm- en videoparameters kun je in de renderloop exponentieel met `dt` glijden. |
| **Driver, pick-up, LED-cache, apc40.ts-tabel, `connectApc40`** | **Niet** | Varve is hier beter en getest. `apc40.ts` is alleen nuttig als opzoektabel voor de converter. |
| **`Bus`/`createRegistry`** (slots, adem, scènes, macro's) | **Niet** in Varve | Dit is specifiek voor de meditatie-app. |

### Trade-offs
- **Converter of runtime-kern.** Met een converter blijft er één driver, één LED-bron en één takeover, en de 1480 checks blijven gelden. Je verliest dan het live wisselen van blauwdruk met Shift + Bank. Maar Varve's mapjes (`lagen.js`) doen dat al. Met een runtime-kern krijg je een eigenaarsschakelaar, dubbele logica en het risico op 0x41 en bursts, en het levert geen functie op die er niet al is.
- **Eén bron van waarheid.** Als Bedienplan leidend wordt, is `mappings/apc40mk2.json` een gegenereerd bestand en gaan Clay's eigen regels (volledige kopie op de server) een tweede keer botsen. Mijn advies: Varve's JSON blijft leidend, en de blauwdruk is een import en schetsgereedschap.
- **TypeScript.** De converter en de log zijn klein genoeg voor plain `.js`, dus de TS-, Vite- en buildvraag (inventaris §4c) hoeft voor dit deel niet beslist te worden.

### Volgorde
1. Converter plus dekkingsrapport draaien op `blueprint-varvedj.json`. Dat geeft de werklijst en toetst de indeling met twee decks tegen "één kolom = één track".
2. Handelingenlog plus replay-test op mappingniveau.
3. Pas daarna, als Clay dat wil: ontbrekende actions bouwen (eerst de cue- en koptelefoonketen en keylock uit fase 3).

## Vragen
- Wil je de kern in Varve alleen als idee- en importbron gebruiken (converter naar mappings/*.json), of wil je echt een tweede runtime-driver die je live kunt wisselen? Mijn advies is het eerste.
- Blijft Varve's mapping-JSON leidend en wordt de Bedienplan-blauwdruk een import, of wordt Bedienplan de bron en Varve's JSON gegenereerd?
- Mag Bedienplan per binding gestructureerde argumenten krijgen (deck, nummer, band) naast de vrije `note`? Zonder dat is een blauwdruk niet betrouwbaar te laden.
- De varvedj-blauwdruk gaat uit van twee decks, gespiegeld over kolom 1-4 en 5-8. Varve is sinds 23 september 'één kolom = één track' met acht tracks. Is de blauwdruk verouderd, of wil je een tweede indeling 'twee decks' als mapje?
- Welke ontbrekende functies uit de blauwdruk wil je echt? De cue- en koptelefoonketen (pfl, cue-mix, split) is de grootste; slip, brake, censor en beatjump zijn kleiner.
- Is een handelingenlog (knopbewegingen opnemen en naspelen, zonder audio-hash) nuttig voor je sets, of alleen als test?

## Aannames
- De TypeScript-bron in scratchpad/avk/av-kern is dezelfde versie als Input/av-kern-lokaal.html. De inventaris controleerde dat op sysex en ringtypes; ik heb de minified html zelf niet vergeleken.
- Het aantal van ~35 bestaande / ~10 halve / ~38 ontbrekende functies is een handmatige schatting op basis van functienamen en de define-lijst in actions.js, geen gemeten koppeling.
- Ik ga ervan uit dat de APC in 0x42 dezelfde note- en CC-nummers geeft als de kern-tabel in apc40.ts; beide citeren Akai's protocoldocument v1.2. Varve's mapping gebruikt dezelfde nummers (cc:0:48, cc:0:7, note:0:52…).
- De kern-driver heb ik niet in combinatie met MidiHub gedraaid. De conclusie 'technisch koppelbaar maar alleen exclusief' komt uit het lezen van de code (midi.ts r32-39, r84-114).
- Ik heb aangenomen dat 'burst ≈ 120 berichten' bij resetLeds klopt: het aantal note-controls in apc40.ts (40 pads, 5 scene, 8×6 per strip, ~20 overige) plus 16 ring-CC's.

# vormen-port
**Kern:** Alle 26 vormmachines kunnen in een Worker met OffscreenCanvas draaien, maar niet "ongewijzigd": je moet een handvol globale verwijzingen eruit halen (Grid() via document, performance.now, AU/playBuf, de gedeelde IIFE-scope). De vier isomorfe systemen (sn, tv, ep, dw) splits je in een simulatie en een AudioSink. De lijst zware systemen uit het plan (ln, gs, ph, cc) klopt maar half. Gemeten op deze M1 zijn cl (7,3 ms), gs bij sp=24 (6,0), ln (4,0), jl (3,5) en if (3,2) het zwaarst. cc is juist licht (0,4 ms) en ph middelzwaar (1,4 ms). De grootste piek is geen beeld maar geluid: één aanslag van de snaar kost ~14 ms op de hoofdthread.

## Bron en opbouw (vormmachines.html, 1049 regels, één IIFE)
- Globalen: `S=320*min(2,dpr)` → 640 px vierkant, `D=S/320` (r.171). `Grid(n)` maakt een DOM-canvas via `document.createElement` (r.190). `blit` doet putImageData en schaalt dan met drawImage op naar S (r.191). `PERM` voor de ruis wordt eenmalig met Math.random geschud (r.198). `AON`/`modalBuffer`/`playBuf` gebruiken de globale `AU.ctx` (r.209–212).
- SYSTEMS r.240–695, OUTS r.706–755. Het samenvoegen gebeurt op r.756 (`acts=['reset',…]`, `actFn=O.act||sys.act`). `act()` r.926 heeft een rem van 150 ms, 1 s voor reset. Zonder actFn valt een actie terug op `pointer` op een willekeurige plek (gs/ln `zaai`, wv `verplaats`). `applyMods` r.945 telt de modulatie op als `base + m·(max−min)` en slaat sel/re-knoppen over. De lus staat op r.1024.
- Contract per systeem: `init(s,p,g)`, `step(s,p,g)`, `outFn(s,p,g)` en optioneel `pointer`/`pointerUp`/`act`/`gate`. `g={ctx,S,D,t,L(LUT),pal}`.
- In totaal 111 knoppen (max 8 per systeem, dus alle passen op de 8 device knobs), 84 uitgangen en 26×reset plus 16 eigen acties.

## Tabel (ms = alleen het rekenwerk, Node 22 op Apple M1, zonder Canvas2D-tekenkosten; de rest is een schatting)
| id | naam | cat | model | kosten/frame | afh. | knoppen (sel/re) | uit (e=event) | acts |
|---|---|---|---|---|---|---|---|---|
| sn | Trillende snaar | Isomorf | c2d-lijnen 24 modi×161 | licht; **aanslag 13,8 ms** (modalBuffer) | AU, perf.now, rnd, tekst | 8 | energie, toon, aanslag·e | aanslaan |
| tv | Trommelvlies | Isomorf | ImageData 110² (≈9500 px×16 modi) | 0,8 ms + modalBuffer per slag | AU, perf.now, rnd | 6 | energie, helderheid, slag·e | slaan |
| ep | Epicykels | Isomorf | c2d, ≤48 cirkels, 240 losse strokes (spoor) | licht rekenen, veel draw calls | AU (2 osc + PeriodicWave), tekst | 5 (f sel/re) | x, y, fase, complexiteit, rond·e | volgende |
| dw | Korrelwolk | Isomorf | 80 deeltjes, c2d | licht; korrels via AU | AU.gbuf, perf.now, rnd | 5 | hoogte, breedte, spreiding, korrel·e | uitbarsting, verstrooi |
| gs | Reactie-diffusie | Patronen | grid 128²×sp | **2,4 ms (sp 12) / 6,0 (sp 24)** | rnd | 3 | dekking, activiteit | zaai |
| cl | Vreemde attractor | Chaos | 70 000 iteraties + 3 passes over 320² | **7,3 ms** | – | 6 (mode sel) | x, y, vulling | – |
| lz | Lorenz | Chaos | 14 banen×5 stappen, c2d + fade | licht | – | 5 (n re) | x,y,z,snelheid,spreiding,lob·e | – |
| ch | Chladni | Golven | 9000 deeltjes (max 16k) + 256² | 1,2 ms (~2,2 bij 16k) | rnd | 4 (cnt re) | beweging, orde | schud |
| hg | Harmonograaf | Golven | 6000 punten, 6 paden | licht (tekenwerk) | outFn TEKENT | 5 | x,y,verhouding,rond·e | – |
| ln | Lenia | Automaten | 88²×260 kernel-taps (R=10) | **4,0 ms** (R=14: ~8) | perf.now, rnd | 4 (R re) | massa,beweging,x,y,leeg·e | zaai |
| ph | Physarum | Zwermen | 5000 agents + blur 160² | 1,4 ms | rnd | 4 | spoor, piek, midden | verstrooi |
| bd | Boids | Zwermen | 170² paren, 170 losse strokes | 0,1 ms rekenen; tekenen bepaalt | rnd | 4 | dichtheid,snelheid,spreiding,x,y | verstrooi |
| jl | Julia | Wiskunde | 180² × ≤70 (max 160) iteraties | 0,6–**3,5 ms**, varieert met c | perf.now in step+outFn | 4 | re, im, binnen | – |
| ls | L-systeem | Groei | tekenreeks 1,8k–11k tekens, 2 walks | licht-middel | – | 4 (f sel/re, it re) | zwaai, lengte, hoek | – |
| sf | Superformule | Wiskunde | 14×541 pow | licht | – | 6 | adem, puntig | – |
| ec | Elementaire CA | Automaten | 160/rij, copyWithin | licht | rnd | 3 (rule re, start sel) | dichtheid,verandering,midden·e,kwart·e | – |
| cc | Cyclische CA | Patronen | Uint8 128²×sp | **0,4 ms** (licht!) | rnd | 4 (n re, nb sel) | golf, midden | – |
| dl | DLA | Groei | ≤50 000 random-walkstappen | ~1 ms (schatting) | rnd | 3 (seed sel/re) | plak·e, straal, groei | – |
| km | Kuramoto | Zwermen | 90 (max 240)×3 | licht | – | 3 (n re) | sync, fase, tik·e | – |
| fl | Stromingsveld | Zwermen | 2200 deeltjes × 8 ruisaanroepen | ~1 ms (schatting) | PERM | 4 | richting, energie, wervel | – |
| lg | Logistiek | Chaos | init 179k it, daarna statisch | licht | – | 3 (r0,r1 re) | r, baan, stap·e | – |
| dp | Dubbele slinger | Chaos | 30×10 stappen | licht | – | 4 (n,e,a0 re) | hoek,snelheid,spreiding,omslag·e | – |
| fy | Fyllotaxis | Groei | 1400 (max 3000) losse arc-fills | tekenwerk | – | 4 | hoek, orde | – |
| wv | Golfinterferentie | Golven | 150²×n cos (n≤9) | ~0,5–1,5 ms (schatting) | – | 4 (n,rad re) | midden, golftop·e | verplaats |
| sp | Zandhoop | Automaten | lawines (variabel) + 129² | variabel | – | 2 (pl sel/re) | lawine, massa, groot·e | – |
| if | IFS-varen | Groei | 60 000 iteraties + 3 passes 320² | **3,2 ms** | rnd | 4 | wind, kromming | – |

Daarbovenop komen per grid-systeem een blit-upscale naar 640² en per spoorsysteem (lz, bd, km, fl, dp) een fade over het hele canvas.

## Wat de "ongewijzigd wrappen" van het plan (projectplan r.90–96) tegenhoudt
1. `Grid()` gebruikt het DOM (14 systemen). Vervang het door `new OffscreenCanvas(n,n)`: één regel, en die werkt zowel op de hoofdthread als in een Worker. Path2D, putImageData en drawImage bestaan in Chrome-workers.
2. `performance.now()` in sn/tv (act, pointer), dw, ln en jl (step én outFn). Maak daar `g.t` van. Varve-regel 3: de klok komt van de host.
3. De isomorfe systemen raken `AU.*`, `playBuf`, `modalBuffer`, `midiFrom(AU.root)` en `SYSTEMS_BY` aan. Een Worker heeft geen AudioContext.
4. Zelfbenoemde tekst op het canvas (sn, ep, dw, km, lg) met het font "IBM Plex Mono": op een beamer is dat ruis. Voeg een vlag `g.hud` toe.
5. hg's outFn tekent op het canvas (OUTS r.20–23), dus de volgorde step→outFn moet blijven.
6. De simulatie telt per frame (gs, ph, bd, cc, ec, ln, dl, lz, dp, km) en `auto()` vergeet met 0,997 per frame. Op 30 fps loopt zo'n systeem daardoor op halve snelheid, op 120 Hz op dubbele. De regel "zware systemen op 30 fps" uit het plan (r.206) is daarom ook een tempowijziging.
7. Kleur: `g.L`/`pcol` zitten per palet vast, met hardgecodeerde kleuren (`WELL #07090c`, `#eea13c`, fade rgba(7,9,12)). De achtergrond is dekkend donker, dus mengen via screen/add werkt, mengen via alpha niet.

## Varve-kant
`VideoMixer.teken()` (src/video/video-mixer.js r.294–354) heeft 8 vaste samplers `t0–t7` (r.55) voor 8 tracks en geen `addLayer`. Dat stond al in docs/plugins/00-inventaris.md §4d. Een vierkante vormlaag past op 1280×720 via passen.js (`schaalVoor`, doorzichtig buiten het beeld).

## Advies
**1. De adapter: klein, en werkend op een Worker-grens.**
```
VormModule {
  id, naam, cat
  params(): {key:'vorm.<id>.<k>', min,max,step, soort:'value'|'stap'|'keuze', reinit, fix}[]
  outputs(): {key, event}[]          // uit OUTS
  actions(): string[]                // ['reset', ...acts]
  set(k, v01) · act(a) · pointer(x,y,down)
  tick(tSec): ImageBitmap | null      // transferToImageBitmap, overdraagbaar
  lees(): {o, e}                      // één keer per frame met het beeld mee terug
}
```
- `v01` (regel 2) schaalt de adapter naar min..max plus step, zoals `applyMods`.
- `re`-knoppen (ec.rule, wv.n, dp.a0, …) worden `stap`-acties met een debounce van ~150 ms of reinit bij loslaten. Anders herstart een encoder de simulatie bij elke tik.
- Kies géén `budgetMs` in tick: een synchrone step kun je niet afbreken. Laat de scheduler zelf per module een EMA van de gemeten duur bijhouden en beslissen of een module deze frame draait, elke 2e/3e frame draait, of op een lagere kwaliteit.
- Maak daarvoor een verborgen kwaliteitsknop van de hardgecodeerde lussen: cl 70000 en if 60000 iteraties, gs.sp, ch.cnt, jl.it, ln.R, ph 5000 agents. Dat is een wijziging in de code, geen wrap.

**2. Worker ja, maar gefaseerd.** Stap 1 draait alles op de hoofdthread achter één module (`vormen/systemen.js`), met Grid naar OffscreenCanvas en g.t geïnjecteerd. Stap 2 zet dezelfde module in een Worker die ImageBitmaps terugstuurt. De reden voor stap 2 is een aanname die gemeten moet worden: de hoofdthread vraagt de StreamBron-pagina's op, en cl plus ln plus gs samen kosten al ~14–17 ms per frame. Dat kan pagina's te laat maken, en een te late pagina is stilte. De LED-setInterval en MIDI hebben er ook last van.
Trade-off: een Worker kost een frame vertraging en een berichtenprotocol. Pointer-slepen wordt dan asynchroon.

**3. Zware lijst corrigeren.** Zwaar zijn cl, gs (bij hoge sp), ln, jl en if. Middel zijn ph, ch, dl, fl, wv, tv. Licht zijn cc, bd (tekenwerk), ec, km, lz, sf, dp, lg. In de DJ-modus mogen er maximaal 3 tegelijk draaien, waarvan hooguit één uit de zware groep.

**4. Geschikt voor DJ-visuals** (reageren op de tel of de banden, geen eigen tempo nodig): fl, bd, ph, gs, wv, ch, km (tik→tel), ec (rij per achtste, als sequencerbeeld), cc, sf, hg, lz, cl.
- Minder geschikt: lg (statisch), dl en sp (trage groei en herstarts), ls, if, fy, dp.
- jl is mooi maar valt duur uit, afhankelijk van c.
- Zes presets uit het plan (r.195) zijn een goede start.

**5. Isomorf met AudioSink.** Splits pure data (Worker) van synthese (hoofdthread).
```
AudioSink { modaal(freqs,amps,taus,dur,noise,vol,pan) · xy(rx,ix,ry,iy,f,gain) · korrel(pos,rate,dur,amp,pan) · root, scale }
```
- `modalBuffer` rekent eigenlijk alleen in een Float32Array. Laat hem in de Worker rekenen en stuur de array over, of zet hem in een AudioWorklet. Dan verdwijnt de piek van 14 ms van de hoofdthread.
- Leid de sink in Varve via de plugin-host naar een eigen gain vóór de limiter, standaard dicht. Op een DJ-set concurreert eigen geluid met de mix.
- Varve kent geen toonsoort. root/scale zijn dus een instelling, geen analyse (aanname).
- dw kan straks de deck-audio granuleren, maar dat is een samplerfunctie: eerst melden.

**Volgorde:** (a) de module-extractie en de 7 aanpassingen hierboven, met een test in Node die elke step op een OffscreenCanvas-mock draait. (b) Een videomixer-pass voor 1–3 generatieve lagen (screen/add plus opaciteit): dat is een wijziging aan video-mixer.js, dus eerst voorleggen. (c) De scheduler met kwaliteitsknoppen. (d) De Worker. (e) De AudioSink voor sn/tv/ep/dw als laatste.

## Vragen
- Mogen de systemen hun code aanpassen (Grid → OffscreenCanvas, g.t i.p.v. performance.now, kwaliteitsknoppen), of moet vormmachines.html bytegelijk blijven en alleen gewrapt worden?
- Mag een generatieve laag in de videomixer bestaan naast 'video is slaaf van de audio'? Zo ja: als extra pass na het mengen (screen/add + opaciteit), en maximaal hoeveel lagen?
- Moeten de isomorfe systemen (snaar, trommel, epicykels, korrelwolk) in een DJ-set eigen geluid maken, of in Varve standaard alleen beeld?
- Is een frame vertraging acceptabel voor visuals uit een Worker (≈16 ms achter de audio, bovenop de uitgangsvertraging)?
- Moet replay/opname van de kern de visuals exact herhalen? Dan moet Math.random vervangen worden door een geseede PRNG per systeem.
- Moet een simulatie op 30 fps (budget) even snel blijven lopen (dubbele stappen, dus niet goedkoper), of mag hij vertragen?

## Aannames
- De tijden zijn gemeten in Node 22 op een Apple M1, met alleen het rekenwerk van de simulatielussen nagebouwd. De Canvas2D-kosten (blit-upscale naar 640², fade, honderden losse strokes/fills bij bd, fy, km en ep) zitten er NIET in en kunnen in Chrome de rekenkosten evenaren.
- Voor dl, fl, wv en sp zijn de kosten geschat, niet gemeten. jl varieert 5× met de waarde van c (0,11–0,53 M iteraties bij it=70).
- Dat hoofdthread-jank in Varve tot te late StreamBron-pagina's (en dus stilte) leidt, is afgeleid uit CLAUDE.md en niet gemeten met vormlagen erbij.
- Path2D, putImageData en drawImage op OffscreenCanvas in een Worker werken in Chrome. Het IBM Plex Mono-font moet in de Worker apart geladen worden, anders valt de tekst terug op een ander font.
- Dat Varve geen toonsoortdetectie heeft, is afgeleid uit CLAUDE.md en de repo-structuur. root/scale voor de AudioSink komen dus uit een instelling.
- Het projectplan (r.7, r.25) gaat ervan uit dat Varve DJ 'alleen plan' is. Dit advies gaat uit van de werkelijke Varve-app (vaste 8-sampler-mixer, regels 1–3) als host, niet van AV-kern.

# videomixer
**Kern:** Een generatieve beeldlaag past met één kleine, afgebakende wijziging in `src/video/video-mixer.js`: een vierde shader die na stap 1 (mengen) en vóór stap 2 (effecten) elke laag met de vaste blend-hardware van WebGL op `this.gemengd` tekent. Dan krijgen pixel, spiegel, sporen en de puls de vormen vanzelf mee, en ook opname en beamer, zonder daar iets te wijzigen (beide lezen hetzelfde canvas). Botsen met "video is slaaf" doet het niet, zolang we het zo vastleggen: een vormlaag heeft geen eigen positie, zijn tijd komt van de audioklok, zijn tel van `klokTrack`, en is hij aan een track gekoppeld dan volgt zijn zichtbaarheid die van de track (fader × crossfader).

**Hoe de mixer nu werkt** (`src/video/video-mixer.js`, 392 regels)
- Vast op 1280×720 (r.34). Drie programma's: `MENG` (r.51–87), `EFFECT` (r.89–129) en `TOON` (r.131–136). `teken()` (r.294–354) doet: video's uploaden naar de texture-units 0–7 → `gemengd.fb` → effect naar `eind[beurt]` met `eind[1-beurt]` als `vorig` voor de sporen (ping-pong) → canvas.
- De meng-shader heeft de acht samplers uitgeschreven (GLSL ES 3.00 staat geen dynamische index toe) en gebruikt 8 units. WebGL2 garandeert er minstens 16, maar in `MENG` zelf past geen extra laag zonder de shader en de broncontrole in `test/video.test.mjs` r.146–149 aan te passen. Een aparte pass is dus schoner.
- Er is geen haakje: `this.lagen` (r.148) is een Map van deckId naar `<video>`, en alles is aan decks gekoppeld (`this.decks.forEach`, r.302). Dat klopt met `docs/plugins/00-inventaris.md` §4d.
- Waar `teken()` draait: alleen als `videoAan()` waar is (`src/ui/video-paneel.js` r.19–20: paneel open, los venster open of een video-opname bezig). Dat gebeurt vanuit de rAF-renderloop (`renderloop.js` r.99–105), dus in een achtergrondtab staat het stil.
- **Opname**: `opnemer.js` r.122 doet `canvas.captureStream(30)` op hetzelfde canvas. **Beamer**: `video.html` r.34 doet `mixer.canvas.captureStream(30)`. Alles wat in `teken()` op het canvas komt, zit dus automatisch in de opname en op de beamer. Voor beide hoeft er niets te veranderen.
- **Y-oriëntatie**: `VERTEX` (r.40) keert v om voor video-textures. Een 2D-canvas, OffscreenCanvas of ImageBitmap wordt net als een video met de bovenste rij eerst geüpload, dus die staan meteen goed. Alleen een FBO-texture staat omgekeerd (zie de waarschuwing in CLAUDE.md en r.121–125). Een laag moet daarom een `TexImageSource` zijn. Een WebGL-texture uit een andere context kan sowieso niet: contexts delen geen textures.

**Vormmachines** (`input/vormmachines.html`)
- Ze tekenen met **Canvas 2D** (3× `getContext('2d')`) op een vierkant canvas van `S=320·min(2,dpr)`, dus 640×640 op een Retina-scherm (r.171). Achtergrond `WELL='#07090c'`, bijna zwart en dekkend (r.173, `clear()`).
- Paletten zijn ingebakken per systeem (`PALS` fosfor/gloed/mos/iris/duo, r.176–182, en `LUTS` als 256 stappen, r.186). `Grid()` gebruikt `document.createElement('canvas')`, dus ze draaien niet zonder aanpassing in een worker.
- Hun lus (r.1025–1031) loopt op `performance.now()` en `requestAnimationFrame` en rekent alleen `running`-kaarten. Dat is het begin van een budget.
- Het projectplan (r.91–96) noemt `VormModule.tick(t, budgetMs)` met "OffscreenCanvas → WebGL-texture", en r.206: hooguit 3 lagen bij DJ, zware systemen op 30 fps, een laag met opaciteit < 0,02 stopt.

**Blend met de vaste blend-hardware op `gemengd.fb`** (geen extra framebuffer nodig)
| blend | `blendFunc` | shader-uitvoer |
|---|---|---|
| add | `ONE, ONE` | `c·α` |
| screen | `ONE, ONE_MINUS_SRC_COLOR` | `c·α` |
| multiply | `DST_COLOR, ZERO` | `mix(1, c, α)` |
| normaal | `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` | `c`, a = α·binnen |

Het zwartpunt telt: `WELL` geeft bij add of screen een grijze waas van 7/255·α. De laagshader trekt het zwartpunt eraf: `c = max(c − zwart, 0)/(1 − zwart)`. Multiply maakt alles donker, omdat de achtergrond van een vorm bijna zwart is. Voor multiply is dus een omgekeerde vorm nodig; zonder die inversie hoort multiply niet in de standaardrij.

**Palet-LUT**: een texture van 256×1 per palet, met `c = texture(lut, vec2(luma(c), .5))`. De standaard is `eigen` (geen LUT). Aanname: luminantie omzetten via de LUT werkt goed op de fosfor/gloed-achtige paletten. `duo` loopt niet op van donker naar licht en geeft dan vreemde tinten.

## Advies
**1. Wat er in `video-mixer.js` verandert (±50 regels, één haakje)**
```js
// constructor
this.extra = [];                       // hooguit MAX_LAGEN = 3
this.laagProg = this._programma(VERTEX, LAAG); // tex, lut, alpha, blend, s, zwart
// API (Engelse namen: dit is het plugin-contract)
addLayer(src) -> handle   // src: { canvas: TexImageSource, draw?(t, fase, budgetMs), size?() }
handle = { set({opacity, blend, palette, fit, follow, on}), remove() }
// teken(), direct na stap 1 (r.329):
this._tekenExtra(vertraging);  // per laag: draw() -> texImage2D -> blend op gemengd.fb
```
De rekenregels komen in een puur bestand `src/video/lagen.js`: effectieve opaciteit = `opacity × (follow ? zichtbaarheid(track) : 1)`, `BLENDS`, keuze uit het budget en de keuze "overslaan onder 0,02". Dat is in Node te testen, net als `volg.js`, `puls.js` en `passen.js`.

**2. Waar: na het mengen, vóór de effecten.** Dan gelden alle zes FX, de puls en de sporen ook voor de vormen: één samenhangend beeld. Na de effecten tekenen (op `nu.fb`) lijkt handig voor een "schone" laag, maar die belandt via `vorig` in de sporen van het volgende beeld. Daarvoor is een derde buffer nodig. Dat laten we weg tot iemand erom vraagt.

**3. Tijd en maat (de slaafregel).** `draw(t, fase)` krijgt `t = ctx.currentTime − vertraging` en `fase` uit dezelfde bron als `_pulsNu` (r.216–226): wat je HOORT. Een laag heeft geen positie en hoeft dus niet te seeken. Leg dit in CLAUDE.md vast als "beeldlagen zijn slaaf van de maat, video van de positie". `follow: 'track.N'` koppelt de zichtbaarheid aan fader × crossfader. Standaard staat dat uit.

**4. Upload en budget.** Stap A: op de hoofdthread `texImage2D(gl.TEXTURE_2D,…, canvas2d)`. Dat kost ~1,6 MB per laag per beeld bij 640², te verwaarlozen. Upload alleen als `laag.versie` veranderd is, zodat een vorm op 30 fps ook op 30 fps uploadt. De budget-scheduler meet `draw()`: boven de ~4 ms per laag gaat hij naar om het andere beeld. Hij tekent niet als `videoAan()` onwaar is, en niet onder α 0,02. Stap B (later, alleen als hij gemeten hapert): een worker met OffscreenCanvas en `transferToImageBitmap()` → `texImage2D(bitmap)` → `bitmap.close()`. Dat vraagt dat `Grid()` in vormmachines `new OffscreenCanvas` gebruikt. Let op een plugin met een eigen WebGL-canvas (AV-kern `VisualModule.init(canvas)`): uploaden in dezelfde taak als het tekenen, of `preserveDrawingBuffer: true`, anders krijg je een leeg beeld.

**5. Beeldverhouding.** Vormen zijn vierkant, dus `schaalVoor(S, S, fit)` uit `passen.js` hergebruiken. Buiten het beeld is de laag doorzichtig, net als bij video. Aanname: voor vormen is `vullen` de betere standaard.

**6. Aantal lagen: 3.** Dat volgt het projectplan (r.206) en houdt 8 video's + 3 simulaties haalbaar op een M1 (niet gemeten).

**7. Bediening op de bus (eerst `define()`, volgens de conventie):**
- `video.layer.N.on` (trigger)
- `video.layer.N.opacity` (value)
- `video.layer.N.blend` (trigger, rondlopen)
- `video.layer.N.palette` (trigger)
- `video.layer.N.system.next/.prev` (trigger)
- `video.layer.N.follow` (trigger: uit → track 1…8)
- `video.layer.N.knob.K` (value, K = 1..8)

`knob.K` is een PLEK, net als `track.N.fx.knob.K`: welk systeem erop staat bepaalt wat plek K doet, de mapping blijft staan. De plugin roept deze `define`s aan via de host. Ze staan niet in de standaardmapping, dus de `apc-beschrijf`-test hoeft niet mee (aanname). Een label is wel nodig.

**Trade-offs en volgorde**
1. Eerst Clay laten beslissen: mag `video-mixer.js` dit haakje krijgen? Dat raakt "de huidige app mag niets merken". Zonder geregistreerde lagen is `_tekenExtra` een lege lus: nul verschil in beeld en een verwaarloosbaar verschil in kosten.
2. Het haakje met `lagen.js` en tests bouwen, met één testlaag (een verloop op de tel).
3. Pas daarna de adapter in `@varve/vormen`: `SYSTEMS[i].step(s, p, g)` op een eigen canvas 2D, zonder de systemen aan te passen.
4. Worker/OffscreenCanvas pas na een meting.

Alternatief zonder wijziging: een tweede canvas als CSS-laag bovenop. Dat is afgewezen, want opname en beamer zien die laag niet, en de FX en sporen werken er niet op.

## Vragen
- Mag src/video/video-mixer.js een addLayer-haakje krijgen (±50 regels, zonder lagen geen verschil)? Of moet de vormen-plugin het helemaal zonder wijziging in de app doen (dan kan hij niet in opname/beamer)?
- Vormlagen vóór de video-effecten (pixel/spiegel/sporen/puls werken er ook op, één samenhangend beeld), of wil je ook een 'schone' laag erbovenop (vraagt een derde buffer)?
- Moet een vormlaag standaard aan een track gekoppeld zijn (zichtbaar = fader × crossfader, 'wat je hoort zie je'), of los met een eigen opaciteit?
- Welke APC-knoppen voor de lagen: grid rij 4–5 (volgens ROADMAP 'vrij — video-scenes') en de device knobs in een nieuw mapje 'beeld'?
- Palet: de eigen kleuren van de vormmachines behouden, of één palet voor het hele beeld (LUT), eventueel per scène?

## Aannames
- Vormmachines-systemen tekenen alleen via g.ctx (Canvas 2D) en passen zonder aanpassing in een adapter die hen een eigen 640×640-canvas geeft; niet voor alle 26 gecontroleerd.
- Upload van een 2D-canvas van 640² per laag per frame is goedkoop genoeg; niet gemeten op Clay's M1 met 8 video's tegelijk.
- Luminantie-naar-LUT geeft een bruikbaar beeld op de gekleurde vormen; bij het 'duo'-palet (niet monotoon) waarschijnlijk niet.
- Plugin-actions die niet in mappings/apc40mk2.json staan, vallen buiten de apc-beschrijf-test.
- Drie lagen is een redelijke grens voor DJ-gebruik (overgenomen uit het projectplan r.206, niet gemeten).
- Ik heb de AV-kern-VisualModule (contract.ts) alleen op interface gelezen, niet de implementaties veld.ts/slots.ts.

# analyse
**Kern:** Varve heeft al ruim de helft van de AnalyseFeatures die het projectplan wil: 9 AnalyserNodes (8 tracks + master), een onset-envelope per nummer op schijf (onset.bin, 86 Hz, geijkt), tel- en maatfase via de tempokaart, rekening houdend met wat je HOORT, en een maatgever (klokTrack). Wat ontbreekt is klein: frequentiebanden en centroid in realtime, een lezer voor onset.bin in de browser, één gedeelde functie voor `hoorbaar()` en een pure router. De tabelregel in het plan ("Alleen rms() … Nieuw bouwen (groot)") klopt voor AV-kern, niet voor Varve. Schatting: ~2 sessies zonder toonsoort (key).

### Wat Varve al heeft (per feature)

| Feature | Stand in Varve | Waar |
|---|---|---|
| rms | Bijna: alleen de **piek** (`getByteTimeDomainData`) | `src/lib/emitter.js:22-29`, `deck.level()` `deck.js:464`, `engine.masterPeak()` `engine.js:235`, per frame in `snapshot()` `engine.js:255,262` |
| bass/mid/high/centroid | **Ontbreekt**. De analysers bestaan wel: per track `fftSize 1024`, smoothing 0,6, getapt NA de crossfader (`audio-graph.js:37-43`); master 1024/0,5 na de limiter (`audio-graph.js:91-95`) | – |
| onset, onsetStrength | **Offline aanwezig**: `onset.bin` = genormaliseerde spectrale-flux-envelope (11025 Hz / hop 128 = 86,1 Hz, float32), eigen ijking 68,5 ms (`server/analyze.js:186,360`). Staat al op de witte lijst (`server/index.js:364`). Pieken als `deck.onsets` via `/api/library/<id>/onsets`. Groottes gemeten: 36 KB – 864 KB per nummer (album van 42 min) | `server/detect.js:229` `onsetEnvelope`, `:296` `normaliseerEnvelope`, `analyze.js:330` `onsetPieken` |
| beatPhase | **Aanwezig**, op wat je hoort: `track.N.phase` = `grid.phase(positie − (outputLatency+baseLatency)×rate)` | `actions.js:134-136, 341-344`; `video-mixer.js:225,290` |
| barPhase | **Aanwezig**: `grid.barPhase(t)` | `beatgrid.js:237` |
| bpm | **Aanwezig**: `deck.bpm` (hoorbaar), `grid.bpmAt(pos)` (tempokaart) | CLAUDE.md "Beatgrid" |
| maatgever (master-klok) | **Aanwezig**: `klokTrack()` (hardst hoorbaar, speelt, heeft grid), `engine.syncMaster()`, `fxKlok()` | `puls.js:25`, `engine.js:82`, `deck.js:260` |
| key/keyConf | **Ontbreekt volledig** (geen chroma). `detect.js:14` heeft wel een FFT | – |

Er bestaat ook al een eerste modulatie: `metPuls()` (`puls.js:38`) telt een tel-envelope `exp(-5·fase)` op bij de knopstand van een video-effect. Dat is precies "bron → kromme × sterkte → bestemming", alleen vast bedraad.

### De router in vormmachines.html (r. 874-946)
- `CURVES` (r. 875): lin, inv, exp, log, trap, drempel, glad. Bronnen `au.*`, `klok.*` en uitgangen van systemen. Bestemmingen zijn knoppen van een systeem, audioparameters (`APM`) of triggers (`x!y`).
- `applyMods` (r. 946): `base + Σ(kromme×sterkte)×(max−min)`, geklemd. Dat is hetzelfde patroon als `metPuls`.
- **Drie botsingen met regel 3** (let op bij het overnemen):
  1. `glad`: `r.sl += (v−r.sl)*0.05` per frame (r. 939), dus afhankelijk van de framerate.
  2. Het verval van een event: `ENV*0.86` per frame (r. 937).
  3. `klokFrame` telt `KL.beats += dt*tempo/60` (r. 930), een eigen teller. In Varve moet `klok.*` uit het grid van de maatgever komen.
- `audioAnalyse` (r. 868-872): banden 30-250 / 250-2000 / 2000-12000 Hz op een fft van 2048. De onset is een rms-drempel (×1,5, 120 ms refractair). Dat is grover dan wat Varve offline al heeft.

### Timing: wat je HOORT
- Een AnalyserNode ziet het signaal op het renderpunt. Je hoort het `outputLatency+baseLatency` later. Het venster (1024 samples = 21,3 ms, zwaartepunt ~10,7 ms terug) compenseert daar een deel van. Realtime banden komen dus ~(latency − 10 ms) te vroeg. **Aanname:** op Clay's Mac is dat 0-30 ms, dus minder dan 2 beelden. Niet gemeten.
- onset.bin staat in TRACKTIJD. Opzoeken op `hoorbaar()` is daardoor exact en volgt loops, seek, rate en bend vanzelf. Je kunt zelfs **vooruitkijken** en de video-vertraging compenseren. Nadeel: EQ, filter, fader en FX ziet het niet.
- `hoorbaar()` staat nu op drie plekken gedupliceerd (`actions.js:134`, `video-mixer.js:225` + `:290`, grid-modus). Het houdt geen rekening met een loop die net rondging (positie − latency valt dan vóór het loopbegin).

### Waar de laag hoort (regel 1)
- AnalyserNodes zijn Web Audio, geen DOM: in `src/engine/` mogen ze, en ze staan er al. `regels.test.mjs` verbiedt alleen imports uit ui/control/server en DOM-gebruik.
- Het uitlezen per frame, `fetch('onset.bin')` en de router horen **buiten** de engine. Ze doen hetzelfde als `video-mixer.js`: de engine alleen uitlezen. `src/analysis/` bestaat al en is puur (`peaks.js`), dus dat is de logische plek.
- Belangrijk: een modulatie mag **niet** via `actions.set()` lopen. Dan beweegt de knop mee en gaan LED-ringen, soft-takeover en de read-back van de UI mee met de modulatie, zodat de basisstand verloren gaat. Modulatie is een **offset bovenop de knop**, zoals `metPuls` en zoals `fx.plekEffectief()` (`fx.js:953`) al los staat van `leesPlek()` (`fx.js:1027`).

## Advies
### Ontwerp (klein, vier bestanden)

1. **`src/analysis/hoorbaar.js` (puur).** `hoorbaar(deck, ctx)` = positie − (outputLatency+baseLatency)×rate, teruggevouwen in de loop. Vervangt de drie kopieën. Test: loop die rondgaat, rate 1,5, stilstand.
2. **`src/analysis/features.js` (puur, Node-testbaar zonder mock).** `banden(spectrumDb, sampleRate, fftSize)` → `{bass 40-200, mid 200-2000, high 2000-12000, centroid}` 0..1. `rms(td)`. `onsetUit(env, envRate, tijdOffset, t)` → strength 0..1 plus `onset` als flank met een drempel (hysterese 0,6/0,4 zoals in de router). Alle waarden 0..1 (regel 2).
3. **`src/analysis/luisteraar.js` (leest de engine alleen uit).** Per track en voor de master levert hij één `AnalyseFeatures`-object per tick:
   - banden/rms **realtime** uit de bestaande analysers. Ze zitten na de EQ, dus een bass-kill laat het beeld ook zakken. Zo werkt DJ'en met beeld.
   - onset **offline** uit onset.bin op `hoorbaar()`, maal fader × crossfader (de `zichtbaarheid` die video-mixer al gebruikt). Het bestand wordt bij het laden opgehaald (≤ 0,9 MB per track, ≤ 7 MB voor 8 tracks, ruim binnen het streamingbudget). Voor een los bestand of de demo zonder onset.bin: een eenvoudige spectrale flux in realtime als terugval.
   - beatPhase/barPhase/bpm uit het grid. Voor de master neemt hij de track van `klokTrack()`.
   - key/keyConf: `null` + 0. Eerlijk leeg.
4. **`src/analysis/router.js` (puur).** Een port van vormmachines r. 874-946, met drie wijzigingen: glad en eventverval met τ in seconden op `ctx.currentTime` (`exp(-dt/τ)`); `klok.tel/achtste/maat/lfo/ramp` afgeleid van het grid van de maatgever in plaats van een eigen teller; bestemmingen via een register `{key, min, max, zet(offset)}`. Routes zijn data (JSON), net als racks. De **sterkte per route** wordt een `value`-action (`mod.N.amount`), zodat hij op een APC-knop kan (het projectplan wil dk7/dk8 = reactiviteit-diepte/-bron).

Het engine-deel blijft minimaal. Eventueel kan `fftSize` naar 2048 voor betere basbanden (bins 23,4 Hz in plaats van 46,9 Hz; nu vallen er maar 4 bins in 40-200 Hz). Voor geluidsbestemmingen komt er later één hook bij: `fx.zetMod(plek, offset)` die `plekEffectief` optelt.

### Trade-offs
- **Realtime of offline onset.** Realtime ziet EQ en FX, maar hangt aan rAF (60 Hz, jitter, en staat stil in een achtergrondtab, CLAUDE.md), en komt iets te vroeg of te laat. Offline is exact, kan vooruitkijken, kost niets en test deterministisch, maar ziet de mix niet. **Keuze: hybride.** Banden realtime, onset en fase offline.
- **Tick op rAF of op een interval.** Beeldbestemmingen hebben rAF toch al nodig. Geluidsbestemmingen zouden in een achtergrondtab bevriezen. Daarom eerst **alleen beeld** (Vormen en `video.fx`) op rAF. Geluid volgt later op de 33 ms-timer van `_glijTimer`/`feedback.tick`, via `zetDoel()` (nooit `setTargetAtTime` over een curve).
- **Kern of plugin.** De DJ-app zelf gebruikt fase en onset al (video-puls, LED-knipperen). Daarom gaat de analyse naar de Varve-kern (`src/analysis/`) en niet naar `@varve/vormen`. `PluginHost` krijgt alleen `host.analyse.lees(bron)` (alleen lezen) en `host.mod.bestemming(...)`.
- **De sidecar uit het projectplan (Python, aubio/librosa, poort 7777) vervalt.** De Node-server op 8777 doet onset, tempo en segmentatie al zonder dependencies. Een Python-stap zou een tweede analysewaarheid naast `detect.js` maken. (Terzijde: plan r. 99 noemt SoundTouch voor keylock. CLAUDE.md heeft SoundTouch juist afgewezen voor Signalsmith.)

### Kosten en volgorde
1. hoorbaar + features + tests: 0,5 sessie.
2. luisteraar + onset.bin-lezer + terugval: 0,5-0,75 sessie.
3. router + `mod.*`-actions + apc-beschrijf + tests: 0,75 sessie.
4. `metPuls` omzetten naar een route (bewijst dat het ontwerp werkt, geen nieuw gedrag): 0,25 sessie.
5. Later: geluidsbestemmingen (0,5), toonsoort via chroma in `detect.js` op de server (1-1,5, pas als het een echte vraag is).

CPU (aanname, niet gemeten): 9× `getFloatFrequencyData` (512 bins) + banden ≈ < 0,2 ms per frame. Het is verstandig om alleen de analysers van hoorbare tracks uit te lezen.

## Vragen
- Moet een reactieve beeldlaag reageren op wat de zaal HOORT (na fader en EQ: een bass-kill laat het beeld ook zakken) of op het nummer zelf, ook als het dichtgedraaid is (bijvoorbeeld om een volgende track al beeld te laten sturen)?
- Moet modulatie eerst alleen BEELD sturen (Vormen, video-effecten), of wil je meteen ook geluid laten moduleren (bijvoorbeeld de bas van track 1 die het filter van track 2 duikt)?
- Heb je toonsoort (key) nodig als modulatiebron of voor harmonisch mixen? Zo niet, dan laten we key/keyConf leeg tot later.
- Waar horen routes bij: per nummer (zoals racks), per set, of één globale patch?
- Mogen de sterktes van routes op vrije APC-knoppen (Lock en Detail View staan als voorstel in VERBETERINGEN ronde 3), of eerst alleen op het scherm?

## Aannames
- outputLatency+baseLatency ligt op Clay's Mac in Chrome tussen 0 en 30 ms; niet gemeten. Dat bepaalt of realtime banden merkbaar te vroeg komen.
- CPU-kosten van 9 analysers per frame < 0,2 ms: schatting, niet gemeten.
- Sessieschattingen (~2 sessies zonder key) gaan uit van 2-3 uur per sessie, zoals in het projectplan.
- Ik heb de AV-kern-bron alleen oppervlakkig bekeken (drone.ts rms, bus.ts mods). De interface AnalyseFeatures heb ik uit projectplan r. 64-76 overgenomen, niet uit gebouwde code.
- Dat onset.bin 'goed genoeg' is als onsetStrength voor beeld volgt uit het gebruik voor snappen (±15 ms, CLAUDE.md). Visueel is het niet getoetst.
- fftSize 2048 op de trackanalysers verandert piek() niet functioneel, alleen de buffergrootte; niet getest.

# controller-ux
**Kern:** De blauwdruk (`Input/blueprint-varvedj.json`: 147 elementen, 244 toewijzingen, 43 voor beeld) past niet als complete indeling op Varve. Hij denkt in twee decks rond het midden, terwijl de gebouwde APC-indeling uitgaat van één kolom per track, over acht tracks, in mode 0x42. Voor beeld is een indeling-wissel ook niet nodig: de grid-modus "video" gebruikt nu 8 van de 40 pads, Detail View is vrij, en elke Vormmachine heeft genoeg aan de 8 device knobs (op de snaar na: 7 zonder volume). Advies: niet van indeling wisselen, maar beeld onderbrengen in de bestaande modi. Uit de blauwdruk neem je alleen losse functies over (beatjump, beeldscènes, beeld zwart, start op de maat, kill, loop in/out).

### 1. De blauwdruk per zone naast Varve

| Zone | Blauwdruk | Varve nu (`mappings/apc40mk2.json`, 291 regels) | Verdict |
|---|---|---|---|
| Faders 1–8 | pitch · FX-wet · beeldzijde · kanaal, gespiegeld (A=1–4, B=5–8) | fader N = volume van track N | **botst**: fader 3/6 = beeldopaciteit breekt "één kolom = één track" |
| Track knobs | EQ laag/mid/hoog + filter per deck; shift = beeldreactiviteit | filter per track (endless) | botst; EQ zit in Varve rechts (device.strip) |
| Clip Stop | EQ-kill / knop → midden | loop aan/uit (shift: loop weg) | botst; kill hoort wel als action |
| Track Select | deck kiezen, PFL, laden, slip | focus (shift: tweede track) | deck kiezen = focus, de rest bestaat niet |
| 2×2 (act/solo/rec/ab) | FX 1–4 aan, bend, brake, censor, quantize, pitchbereik | play · sync · A\|B · cue (alleen met shift) | **Rec Arm zonder shift is vrij**, net als **Activator met shift** |
| Grid rij 1–4 | hotcues 1–8, loops, cue/play/sync/keylock (per deck 4 kolommen) | modi op scene 1–4 (hotcues/loops/sampler/video) | anders opgezet. Varve heeft 4 hotcues per track in de kolom |
| Grid rij 5 | beeldscènes 1–8 (shift: opslaan) | in video-modus alleen noten 32–37 (fx vasthouden), 24–25 (mengvorm, pulsdoel) | **past**: 32 pads vrij in grid.video |
| Scene 1–5 | FX 1–4 aan, FX-sync | kiesknoppen voor de grid-modi | botst (dat zijn in Varve de modusknoppen) |
| Device knobs | FX-param, gain, reso; **shift = parameters van de beeldlaag** | device.strip / device.rack | het idee past, maar als mapje in plaats van shift |
| Device ◀▶ / Bank ◀▶ | Vormmachine ◀▶ / beeldlaag ◀▶ | rack ◀▶ / **vrij** (60, 61) | past |
| On/Off · Lock · Clip/Dev · Detail | laag aan · bevriezen · scènebank · flits | effect aan · (grid-modus: slot) · strip↔rack · **vrij** (65) | past |
| Stop All | beeld → zwart | **vrij** (81) | past 1-op-1 |
| Pan/Sends/User, Master, Bank | split-cue, FX-sync, beeld-xf volgt | vrij (87–89, 80, 103), voorstel ronde 3 = lagen voor de track knobs | laten voor audio |

**Valkuil bij omzetten:** in de blauwdruk is `pad1-x` de **onderste** rij. In Varve heet noot 32 "pad 1/1", dat is de **bovenste** rij. Wie letterlijk overzet, zet alles ondersteboven.

Dekking, grof geteld: ongeveer 35 van de 83 blauwdrukfuncties hebben al een Varve-action (play, cue, sync, pitch, tempo, pitch.range, bend, focus, trim, high/mid/low, filter, fx.knob/mix/bypass/next, hotcue 1–4 + delete, loop.halve/double, beatloop, loop.toggle, xfade.side, xfader.curve, tap, grid.back/fwd/double/halve, record, phase). Bij de 18 beeldfuncties is dat er maar één: `beeld-blend` ≈ `video.mode`. `loop.halve`/`loop.double` bestaan wel (`src/control/actions.js:253`), maar staan niet op de APC.

### 2. Vormmachines op knoppen (`vormmachines.html`, SYSTEMS op r. 240, OUTS op r. 706)
- Knoppen per systeem: 2 (zandhoop) tot 8 (snaar). Laat je de geluidsknop `vol` weg (bij sn, tv, ep, dw), dan heeft **alleen de snaar er meer dan 6** (7). Twee systemen hebben er 6 (vreemde attractor, superformule), de rest 5 of minder.
- Acties: altijd `reset`, plus 0–2 eigen acties (aanslaan, uitbarsting/verstrooi, zaai, schud, volgende, verplaats). Hooguit 3, dus passend voor een rij pads.
- `SEL`-knoppen (vorm/formule, 7 systemen) zijn lijsten. Op een endless ring: in stappen draaien.

### 3. Hoe Varve dit opvangt
- `lagen.js:38` GROEPEN: de device-groep heeft nu één kiesknop (`view: ['strip','rack']`). Een tweede kiesknop (`detail`) met eigen mapjes gaat met dezelfde code, gluren inbegrepen.
- `resolveTarget` (`mapping.js:64`) vult elke `{naam}` in, dus `{layer}` naast `{focus}` is alleen een extra variabele.
- Een regel met een onbekende action geeft alleen `console.warn` (`actions.js:63`). Zet je beeldregels in de standaardmapping terwijl de plugin uit staat, dan geeft dat dode knoppen en faalt de apc-beschrijf-test.

### 4. Plan tegenover werkelijkheid (controllerkant)
Het projectplan (r. 17, 211) laat de kern-driver de APC in 0x41 zetten, met de blauwdruk als "8e blauwdruk". Varve draait bewust en gemeten in **0x42**: in 0x41/0x40 klopte de standaardmapping niet (`docs/APC40.md:22`). Het plan wisselt blauwdrukken met Shift + Bank; Varve heeft daar niets op staan, maar Bank (103) is vrij.

## Advies
### Keuze: beeld in de bestaande modi, geen tweede indeling

| Optie | Voor | Tegen |
|---|---|---|
| **A. Grid-modus "video" uitbreiden + device-mapje "vorm" (advies)** | De kern blijft staan, de modi zie je aan de lampjes, er komt maar één groep bij | De APC doet dan beeld voor één gekozen laag tegelijk |
| B. Beeld achter shift (zoals de blauwdruk) | Geen nieuwe mapjes | Shift is in Varve voor wissen en zeldzame dingen. Een shift-laag laat niet zien in welke stand hij staat: klacht nummer één (`APC40-onderzoek.md` §2) |
| C. De blauwdruk als volledige wisselindeling (kern-plugin) | Eén formaat met AV-kern | Twee mentale modellen op één apparaat zonder scherm, 2 tegenover 8 tracks, gevaar voor 0x41, ongeveer 48 stubfuncties. Alleen zinvol als Bedienplan leidend wordt (VRAGEN G4) |

### Concrete indeling "beeld op de APC"

**Grid-modus video (scene 4, blauw)**, rijen van boven naar onder, noten tussen haakjes:
- Rij 1 (32–39): `video.scene.1…8`. Shift: `video.scene.N.save`. Lampjes: fel = actief, donker = bewaard, grijs = leeg.
- Rij 2 (24–31): de zes bestaande `video.fx.*.hold` (schuiven één rij omlaag), dan `video.mode` en `video.pulse.target`.
- Rij 3 (16–23): kolom 1–4 `video.layer.1…4.select` (wat de device knobs bedienen), kolom 5–8 `video.layer.1…4.on`.
- Rij 4 (8–15): `video.layer.{layer}.act.1…3` (reset + de eigen acties van het systeem), `.freeze`, `.random`, `video.flash` (vasthouden), `video.scene.quant`, `video.layer.{layer}.source` (rondlopen: maat · laag · midden · hoog · onset).
- Rij 5 (0–7): vrij laten. Niet vullen om het vullen.

**Device-groep:** Detail View (65) wordt de kiesknop `layer.device.detail` met de mapjes `vorm` → `beeld` (net als Clip/Device View tussen strip en rack loopt).
- `device.vorm`: knop 1–6 = `video.layer.{layer}.knob.1…6`. Dat zijn **plekken**, net als `fx.knob.K`: de Vormmachine bepaalt wat plek K betekent, dus bij een andere vorm hoeft niets opnieuw gekoppeld. Knop 7 = `.level` (opaciteit), knop 8 = `.react` (hoe hard de muziek meestuurt). Met shift = plek 7–8, alleen de snaar gebruikt dat.
  Binnen dit mapje: Device ◀▶ = `video.layer.{layer}.form.prev/next` (26 vormen), Bank ◀▶ = `video.layer.prev/next`, On/Off = `.on`, Lock = `.freeze`. Buiten dit mapje doet Bank ◀▶ wat ronde 3 voorstelt: `track.{focus}.loop.halve/double`.
- `device.beeld`: knop 1–6 = de bestaande waarde-actions `video.fx.*`, die nu op geen enkele knop staan. Knop 7 = `video.pulse`, knop 8 = `video.layers.level` (alle vormlagen samen).

**Losse knoppen:** Stop All (81) = `video.black`. Shift + Stop All wordt niet "alle decks stop": te gevaarlijk.

### Welke blauwdrukfuncties een action waard zijn (volgorde)
1. `track.N.beatjump.back/fwd` + `track.{focus}.beatjump.size`. Staat al in ronde 3, loopt via `seek(…, {binnenLoop})`. Op de APC: shift + Bank ◀▶.
2. Beeldscènes + `video.black` + `video.flash`: dit is waar het beeld live om draait.
3. `track.N.play.quant` (start op de volgende maat), op Activator met shift (nu vrij). Goedkoop: `startOpDeTel` bestaat al.
4. `track.N.low.kill` (en `.mid.kill`, `.high.kill`). Bass swap is nummer 3 in het onderzoek. Plek: Rec Arm zonder shift. Clay beslist, want die knop is bewust leeg gehouden.
5. `track.N.loop.in/out`: handig, middelmatig.
6. `track.N.brake`: leuk en goedkoop (een helling op de bron, zoals bend), geen vaste knop.
Niet nu: keylock (fase 3), slip, censor/reverse (de StreamBron leest vooruit), PFL/split-cue (F1: tweede uitgang), hotcues 5–8, bladeren en laden via de APC, tempo-master (Varve bepaalt de maatgever zelf; hysterese staat in ronde 3).

### Volgorde
1. Eerst de actions (`define()`, conventie) + `apc-beschrijf.js`. 2. `{layer}` in de mapping-variabelen. 3. De beeldregels als **fragment dat de vorm-plugin meebrengt** en bij het laden toevoegt, niet in `apc40mk2.json`. Dan geen dode knoppen als de plugin uit staat, en omdat het fragment in de browser wordt samengevoegd, omzeilt het het probleem "eigen mapping = volledige kopie". Botst een regel met Clay's eigen regel, dan wint de zijne. 4. `apc.html` volgt vanzelf (leest `kies()`). 5. Pas testen op de APC als Clay zijn tabblad vrijgeeft.

## Vragen
- Beeld op de APC als uitbreiding van de bestaande grid-modus video + een device-mapje 'vorm' achter Detail View (advies), of wil je de blauwdruk echt als complete wisselindeling (twee decks, gespiegeld)?
- Hoeveel vormlagen tegelijk: 4 (blauwdruk), 3 (projectplan fase 1) of eerst 2? Dat bepaalt of rij 3 van het grid 4+4 of 3+3 pads gebruikt.
- Rec Arm zonder shift is nu bewust leeg (per ongeluk cue). Mag daar een kill (laag) op, of blijft hij leeg?
- Bank ◀▶: loop ½/×2 zoals ronde 3 voorstelt, en alleen in het vorm-mapje beeldlaag ◀▶. Akkoord dat dezelfde knop per device-mapje iets anders doet?
- Wat hoort er in een beeldscène: alleen de vormlagen, of ook de video-effecten, mengvorm en puls van de trackvideo's?
- Moet het geluid van de Vormmachines (knop 'vol', de geluidsmotor) in Varve uit blijven?

## Aannames
- Rij 5 van de blauwdruk (pad5-x) is de bovenste rij, afgeleid uit 'pad1-x = onderste rij' in het projectplan r. 107 en de notes van de blauwdruk.
- De telling van ongeveer 35 van de 83 blauwdrukfuncties met een bestaande Varve-action is grof en met de hand gedaan.
- Knopaantallen per Vormmachine zijn geteld met een regex op de K(/SEL(-aanroepen in vormmachines.html. Een knop met fix:1 telt mee als bedienbaar; alleen 'vol' is als geluidsknop weggelaten.
- Varve krijgt geen analyse-bus per band (bass/mid/high) zonder nieuw werk. De 'bron' voor reactiviteit begint daarom bij de maat (track.N.phase, zoals video.pulse), de banden komen later.
- Een grid-modus of device-mapje met regels uit een plugin-fragment werkt met de huidige lagen.js/mapping.js. Dat heb ik uit de code afgeleid, niet getest.
- Zonder shift is Rec Arm vrij en met shift is Activator vrij: gelezen uit de regels in apc40mk2.json (geen play-regel met shift, geen Rec Arm-regel zonder shift).
- Niets gewijzigd, geen browser geopend.

# architectuur
**Kern:** Een plugin-systeem met drie los publiceerbare TypeScript-pakketten is voor Varve te zwaar. Varve heeft al een betere MIDI-laag, mapping, LED-feedback en action-bus dan de AV-kern. Wat echt nieuw is (de 26 Vormmachines als beeldlaag, een handelingenlog met replay, blauwdrukken importeren) past als gewone modules: `src/vormen/`, `src/control/handelingen.js` en `src/control/blauwdruk.js`. Gedeelde code tussen de twee repo's moet plain JS zijn (vendoren met een versiestempel), geen TS: Node 26 stript types wel, maar de browser niet, en de AV-kern-bron draait niet eens ongewijzigd in Node.

### 1. Plan en werkelijkheid lopen uit elkaar (klopt)
- Het projectplan (`projectplan-av-kern-x-varve.md` r.25) noemt Varve DJ "Alleen plan: yt-dlp-cache, 2 decks". Het plan vervalt daarmee in fase 2 (driver, mapping, LED's) en fase 3–5 (sidecar, deck, mixer). In werkelijkheid bestaat dat allemaal al in Varve: 8 decks (`engine.js:11` `DECK_IDS`), streaming, beatgrid, videomixer, opname en een APC-mapping in 0x42. De tests staan op 24 bestanden in `test/` en 1480 checks (volgens `docs/plugins/00-inventaris.md` r.26).
- De "winst van 6 sessies" uit het plan (r.9) draait in Varve om: de AV-kern-driver zou een slechtere versie vervangen door een tweede exemplaar. Varve's `MidiHub` (`src/control/midi.js:127`) heeft al een uitgaande wachtrij (16 berichten per 4 ms, tegen de Comet-crashes), een echofilter, de Web Lock en poortherstel. De AV-kern-driver doet zelf `requestMIDIAccess` en stuurt 0x41 (`av-kern/src/kern/midi.ts:118-122`). Dat botst direct met 0x42 en met de Chrome-regel.

### 2. De AV-kern-bus schendt Varve's regel 3
- `bus.ts:4` `TICK = 1/60`, `bus.ts:111` slew per tick met τ geklemd op 0,02. Aangedreven vanuit `main.ts:196-206` met `performance.now()` en `requestAnimationFrame`. Voor deterministische replay is dat goed ontworpen, maar:
  - `requestAnimationFrame` staat stil in een achtergrondtab. Varve laat zijn LED's daarom juist op `setInterval` lopen (CLAUDE.md).
  - Audioparameters 60 keer per seconde via `invoke()` bijstellen geeft trapjes. Varve glijdt op de audioklok (`macro.glide`, `plekEffectief`, `zetDoel()` in `fx.js`).
- Conclusie: de slew-bus is bruikbaar voor BEELD (vormlagen), niet als tussenlaag vóór Varve's audio-actions.

### 3. TypeScript zonder build: gemeten (Node v26.8.2, in scratchpad)
| Test | Uitkomst |
|---|---|
| `node t.ts` met interface, annotaties en `import './t.ts'` | werkt, geen vlag nodig |
| `import './t'` (zonder extensie) | `ERR_MODULE_NOT_FOUND` |
| `enum` | faalt |
| `constructor(public a)` | `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX … parameter property is not supported in strip-only mode` |
| `--experimental-transform-types` | `bad option`: bestaat niet meer in 26.8 |
| `module.stripTypeScriptTypes` | bestaat (`function`), geeft een ExperimentalWarning. `{mode:'transform'}` → `ERR_INVALID_ARG_VALUE`, dus alleen strippen |
| `import('av-kern/src/kern/bus.ts')` | faalt op de parameter property (`bus.ts:80`) |
| `tsc` | niet geïnstalleerd, geen `node_modules` |
- De AV-kern-bron heeft 4 parameter properties (`blueprint.ts:24`, `bus.ts:80`, `log.ts:47`, `midi.ts:28`). Van de 48 relatieve imports heeft er geen één een `.ts`-extensie (`tsconfig.json`: `moduleResolution: bundler`). Het is dus Vite-TS, geen "erasable" TS. Delen vraagt aanpassingen in de AV-kern-repo zelf (`allowImportingTsExtensions`, `erasableSyntaxOnly`), anders moet Varve het bestand herschrijven.
- De browser draait geen `.ts`. Varve zou `.ts` bij het serveren moeten strippen: een wijziging in `server/index.js`, de witte lijst `MAG` op r.363 kent `/packages/` niet, en MIME `.ts` hoort op r.40. Daarbij hangt het af van een experimentele API. Een strikte typecheck vraagt `npx typescript`: een dependency.

### 4. Vormmachines zijn al plain JS
- `vormmachines.html:240` `const SYSTEMS=[…]`, 26 objecten `{id, knobs:[K(...)], presets, init(s,p), step(s,p,g), act}`. Verder `OUTS` op r.706 en de afleiding van `outs/acts` op r.756. De systemen tekenen op een eigen 2D-canvas (`Grid()` r.190 gebruikt `document.createElement('canvas')`) en hebben een eigen AudioContext (`startAudio` r.844).
- Losmaken als ES-module vraagt geen TypeScript. Er moet alleen `Grid()` naar `OffscreenCanvas` (of een meegegeven fabriek), en de UI-code op r.894–1042 moet eraf.

### 5. Varve's echte haakjes voor een host
- Action-bus: module-level `define/invoke/read/has/metaOf/list` (`actions.js:31-114`). Er is geen `undefine` en geen luisteraar op `invoke`, alleen `bijFout` (r.78). De mapping krijgt `invoke` geïnjecteerd (`mapping.js:327,374,413`): dat is de natuurlijke tap voor een handelingenlog.
- Engine: `engine.ctx`, `engine.master.input` (`engine.js` r.67-71 in de constructor), `engine.deck(id).position/rate/playing` (gebruikt in `video-mixer.js:356-366`).
- `MidiHub.onInput(fn)` (`midi.js:325`) geeft alleen geselecteerde berichten zonder echo's.
- VideoMixer: `teken()` (`video-mixer.js:294-354`) heeft een vaste mengshader met 8 samplers `t0..t7` (r.64-71) en geen `addLayer`. Een vormlaag vraagt hoe dan ook een wijziging in de mixer.
- Bootstrap: `src/ui/app.js` (164 r.) zet alles in volgorde op. Eén dynamische `import()` onderaan kan, achter een vlag.

## Advies
### Is een plugin-systeem de juiste vorm? Nee, nu niet.
Een pluginsysteem betaalt zich terug als derden plugins schrijven, of als één host veel onafhankelijke plugins laadt. Hier is er één gebruiker, zijn er twee apps en draait het om één gedeeld onderdeel (vormen). De kosten zijn concreet: een contractpakket dat meeversiet met twee repo's, een tweede MIDI-pad naast `MidiHub`, TS stripping in de server en een tweede slew-bus naast de action-bus. Die dubbele mechanismen lopen gegarandeerd uit elkaar. Varve's eigen regels geven de uitbreidingsvorm al: "Nieuwe functie: eerst `define()` in `actions.js`, daarna UI en mapping."

### Voorgestelde vorm (volgorde)
1. **`src/vormen/`** (plain JS, geen deps):
   - `systemen.js`: de 26 SYSTEMS + OUTS, ongewijzigd behalve `Grid()` → OffscreenCanvas.
   - `laag.js`: de adapter. `step()` loopt op een budget (max 3 lagen, zware op 30 fps), het canvas gaat als texture naar de mixer.
   - `bindVormen()` in `actions.js`: `vorm.<id>.<knop>` (value 0..1, de engine schaalt) en `vorm.<id>!<actie>` (trigger).
   - Daarmee werken mapping, koppelen, LED's en de spiegel meteen. Eén test: elke systeemknop is gedefinieerd en heeft een uitleg in `apc-beschrijf.js`.
2. **VideoMixer-haakje** (een bewuste wijziging, geen adapter): `voegBronToe({ canvas, gewicht(), blend })` en een extra pass na het mengen, vóór de effecten. De tijd voor een vormlaag komt uit `engine.ctx.currentTime` en de beatfase van de maatgever (dezelfde bron als `puls.js`). Het ritme komt dus niet van `performance.now()`. Clay moet bevestigen dat "video = slaaf van de audio" een uitzondering krijgt voor generatief beeld.
3. **`src/control/handelingen.js`**: opname en replay van ACTIONS (`{t: ctx.currentTime, id, v}`), getapt op de `invoke` die `midi-opzet.js` aan de mapping geeft, plus toetsenbord en scherm. Dit is het enige echt nieuwe kernidee. Replay op action-niveau is sterker dan MIDI-bytes, want het overleeft een mappingwissel. De FNV-1a-eindhash uit `log.ts` kan mee.
4. **`src/control/blauwdruk.js`**: converteert Bedienplan-JSON naar mappingregels (element-id → `sig`, `beh` → mode/takeover, `fn` → action via een tabel). Geen tweede driver: de APC blijft in 0x42 en blijft van `MidiHub`. Onbekende `fn` worden een lijst "ontbreekt" in de koppelmodus.
5. Slew als eigenschap per action (`meta.glide`), alleen waar de engine het niet al op de audioklok doet. Geen aparte bus.

### Code delen tussen AV-kern en Varve
| Optie | Oordeel |
|---|---|
| npm-pakket | Varve heeft geen `package.json` of npm. Kost een publicatiestap en versiebeheer voor één gebruiker. Nee |
| git submodule | Wrijving bij elke commit. `Input/` had al last van een geneste `.git` (commit e285371). Nee |
| symlink of gedeelde map | De witte lijst van de server en `no-store` maken het broos. Een map buiten de repo wordt niet geserveerd. Nee |
| **vendoren (kopiëren) + stempel** | **Ja.** Eén eigenaar van `vormen/systemen.js` (plain JS + een `.d.ts` voor AV-kern). Vite importeert JS zonder moeite. Een scriptje `tools/vendor-vormen.sh` kopieert en schrijft bron-commit + SHA-256 in de kop, en een test controleert die hash. Zo plant Varve ook Signalsmith Stretch in |

De richting is JS als grootste gemene deler: TS kan JS importeren, andersom niet zonder build. De AV-kern-kern zelf (driver, bus) hoeft niet gedeeld te worden.

### Minimale PluginHost, als je hem toch wilt (achter een vlag)
Plek: `src/plugins/host.js`, schermlaag, nooit in `src/engine/` (regel 1, bewaakt door `regels.test.mjs`).
```js
export const maakHost = ({ engine, midi, videoMixer, meld }) => ({
  actions: { define, invoke, read, list },          // uit actions.js; ontbrekend: undefine voor dispose
  klok: () => engine.ctx.currentTime,               // regel 3
  transport: (nr) => { const d = engine.deck(TRACKS[nr - 1][1]);
    return { positie: d.position, rate: d.rate, speelt: d.playing, bpm: d.bpm }; },
  audio: { ctx: engine.ctx, master: engine.master.input },  // alleen erbij zetten
  midi: { opInvoer: (fn) => midi.onInput(fn) },     // alleen lezen, nooit send of sysex
  video: { voegBronToe: (b) => videoMixer.voegBronToe(b) },  // bestaat nog niet
  meld,
});
```
Laden gaat via `?plugins=vormen` of `localStorage`, met één `import()` onderaan `app.js`. Leeg betekent niets geïmporteerd. Trade-off: dit is ~40 regels en maakt uitschakelen mogelijk. Zonder host kan het ook: `bindVormen()` alleen aanroepen als de vlag aan staat. Mijn advies is dat laatste, en de host pas bouwen als er een tweede plugin komt.

### Trade-offs samengevat
- **Modules in plaats van plugins**: minder los publiceerbaar, maar geen dubbele MIDI-laag, geen build, 1480 checks blijven de vangrail. Risico: AV-kern en Varve divergeren in hun eigen kern. Dat is acceptabel, want ze hebben verschillende doelen (slew/meditatie tegenover cuts/DJ).
- **TS via stripping**: technisch mogelijk (gemeten), maar het leunt op een experimentele API, vereist dat de AV-kern-bron eerst herschreven wordt, en voegt een serverpad toe. JSDoc + `// @ts-check` levert typecontrole zonder runtimewijziging, als Clay die wil.

## Vragen
- Mag het doel 'twee los publiceerbare TS-plugins' vallen ten gunste van gewone Varve-modules (src/vormen/, handelingen.js, blauwdruk.js)? Publiceren voor één gebruiker kost meer dan het oplevert.
- Welke repo wordt eigenaar van de 26 Vormmachines (systemen.js): AV-kern, Varve, of een klein derde repo in plain JS waar beide uit vendoren?
- Mag video-mixer.js een extra bronpass krijgen voor generatief beeld? Dat maakt een uitzondering op 'video is slaaf van de audio'.
- Wil je de blauwdruk van Bedienplan als importformaat voor Varve's mapping (een converter), of moet de AV-kern-driver echt zelf de APC bedienen? Dat laatste betekent 0x41 tegenover 0x42 en een tweede MIDI-laag.
- Replay op action-niveau (overleeft een mappingwissel) of per se op MIDI-bytes zoals in AV-kern log.ts?
- Is typecontrole belangrijk genoeg voor een devtool (npx typescript) of JSDoc + @ts-check, of blijft Varve ongetypeerd JS?

## Aannames
- Het projectplan (23 sep) ging uit van een Varve zonder code. Dat heb ik afgeleid uit r.25 ('Alleen plan'); het kan ook een verouderde tabelrij zijn.
- De gemeten Node-uitkomsten gelden voor v26.8.2 op deze Mac. Een latere Node kan transform-mode terugbrengen of de ExperimentalWarning weghalen.
- Ik ga ervan uit dat de AV-kern-repo zelf Vite+TS blijft en niet naar plain ES-modules gaat. Anders wordt direct delen van meer dan de vormen realistischer.
- De 26 systemen draaien per stuk op een eigen 2D-canvas. Ik heb niet gemeten of drie tegelijk plus 8 video's op de M1 60 fps halen. Het budget van max 3 lagen komt uit het projectplan, niet uit een meting.
- Slew bij 60 Hz via invoke() geeft hoorbare trapjes op audioparameters. Dat volgt uit Varve's bestaande keuze voor glijden op de audioklok, niet uit een eigen meting in deze sessie.
- Ik heb geen browser geopend en niets gewijzigd. De Node-tests draaiden alleen in de scratchpad (tstest/).

# risico-prestatie
**Kern:** Wat de vormmachines op de hoofdthread kosten verschilt per systeem wel dertig keer, dus een regel van "max 3 lagen" beschermt niets. Clifford (`cl`) kost gemiddeld 10,6 ms per stap en Zandhoop (`sp`) piekt tot 82 ms. Twee zware lagen passen al niet in een frame van 16,7 ms naast Varve's eigen renderloop. Het echte risico is niet dat de audio uitvalt (de StreamBron buffert 20 s vooruit), maar dat MIDI-invoer, LED's en videosync te laat komen, en dat de APC40 in de war raakt als AV-kern zijn eigen MIDI-driver meeneemt. Die driver zet de APC in modus 0x41, stuurt zonder wachtrij en laat de tabbladlock links liggen.

### 1. Gemeten in Node, zonder Chrome, op deze MacBook Air M1 (MacBookAir10,1, 16 GB)
Ik heb `vormmachines.html` regels 170–695 (helpers + SYSTEMS) plus vier helperregels (703, 807, 809, 810) uitgeknipt. `document`, de 2D-context en `Path2D` zijn nep: tekenaanroepen doen niets. Daarna 600 stappen per systeem op DPR 2 (S=640). Het script staat in `/private/tmp/claude-501/-Users-claykrebbers-Desktop-1--Projects-Youtube-mixer/dd38f872-bcfc-421d-aa8d-2748af7e8626/scratchpad/bench/vm-bench.cjs` (`node vm-bench.cjs [id] [N]`). Dit is een **ondergrens**: rasteren, `putImageData`, `drawImage` en de texture-upload tellen niet mee.

| klasse | systeem (gem / p99 / max, ms per stap) |
|---|---|
| zwaar | cl 10,6 / 15,7 / 17,5 · ln 5,8 / 8,0 / 10,6 · gs 4,6 / 9,3 / 11,2 · wv 3,3 / 5,0 · if 3,0 / 5,6 · **sp 2,9 / 25 / 82** |
| middel | ph 2,3 · jl 2,2 · sf 2,1 (p99 5,0) · ch 1,6 · hg 1,2 · tv 1,0 (max 12,8) · fl 0,8 · ls 0,6 · dl 0,5 (p99 2,9) |
| licht (<0,5) | bd, cc, fy, ep, dp, dw, sn, km, lz, lg, ec |

- **sp (Zandhoop)**, regel 672–676: een lawine loopt per frame onbegrensd door (`while(st.length)`). Dat geeft long tasks van 25–82 ms.
- **GC**, gemeten met `--trace-gc` over 1800 frames: de meeste systemen 5–23 events, dus alleen de opstart. Uitschieters zijn **ls met 532** (≈0,7 MB per frame: strings plus 8× `new Path2D` per frame, regel ~521) en **sp met 73** (array-stapel per frame). Scavenges duren 0,06–0,12 ms, dus GC is een klein risico. Kleine allocaties in `step()`: sn (`cur`/`env` Float32Array(24), regel 259), tv (2× Float32Array(16), regel 286), sf (Float32Array(541), regel 529), ec (Uint8Array(W) per stap, regel 543). De router allocateert ook per frame: `routeFrame()` (regel 934) bouwt `V`/`E` met ~100 aaneengeplakte sleutels, `c.s.e={}`, `c.mod={}` en `r.dst.split('.')`. Varve doet zelf iets vergelijkbaars: `video-mixer.js:297-298` maakt per frame nieuwe Float32Arrays.
- **Tijdbasis**: `g.t` en de klok komen uit `performance.now()` (regels 911, 931, 1022), niet uit `ctx.currentTime`, en dat botst met regel 3. `ENV*.86` (regel 939), `glad` `.05` per frame (regel 940) en `gpf` "korrels per frame" hangen van de framerate af. Het voorstel in het projectplan (r. 206) om "zware systemen op 30 fps" te draaien halveert dus ook hun snelheid en verandert het gedrag.
- **Math.random**: 46 keer, waaronder de Perlin-`PERM`, die bij het laden wordt geschud (regel 198). Elke sessie klinkt en ziet er dus anders uit, en replay is onmogelijk. AV-kern `bus.ts:2,49` is wel deterministisch (TICK 1/60, xorshift); alleen `drone.ts:109` gebruikt Math.random.

### 2. De hoofdthread van Varve, gelezen in de code
- De StreamBron vult bij met `setInterval` (100 ms, `bron.js:234,311`) en haalt **20 s vooruit** op (`stream-kern.js:128`). Een haper van 80 ms laat een spelend deck dus niet stilvallen. Wél worden sprongen naar een plek die nog niet binnen is (niet vastgepind) langer stil: het bestaande gat plus de blokkade.
- Op dezelfde thread draaien: MIDI-invoer (`onmidimessage`), de LED-timer (33 ms, `midi-opzet.js:83`), de uitgaande wachtrij (16 berichten per 4 ms), de renderloop (`renderloop.js:98`: snapshot, spiegel, zoom- en overzichtsgolfvorm) en de videomixer. Die laatste stuurt per frame 8 video's bij en uploadt de zichtbare video's met `texImage2D` (`video-mixer.js:294-315`). Een long task van 25–80 ms betekent een hotcue of play die een frame of meer te laat komt, knipperen op de tel dat verspringt, een video die gaat springen (`volg.js`: boven 150 ms seek) en dat MediaRecorder beelden laat vallen.
- De mixer heeft een vaste `MAX = 8` (regel 29) en `uniform float w[8]` in de shader. Een vormlaag vraagt dus om een negende texture-unit of een apart slot. Dat is een shaderwijziging, niet "uitschakelbaar zonder dat de app het merkt".

### 3. Een tweede MIDI-driver (AV-kern `src/kern/midi.ts:117-146`)
- `requestMIDIAccess({sysex:true})` staat los van de Web Lock `varve-mixer` in `tabblad.js`.
- Zet **modus 0x41** (`apc40.ts:6`), terwijl Varve 0x42 draait. Daardoor komt de device-sectie weer in banken en werken `cc:0:16-23` niet meer.
- `out.send` gaat direct, zonder wachtrij. `pick()` draait bij elke `statechange` en stuurt dan sysex, zet de LED's opnieuw en stuurt 16 ringtypes. Dat is precies het burstpatroon van de crashes op 22 en 23 september (`MidiService_TaskService_Thread`).

### 4. localStorage (alles op origin localhost:8777)
De sleutels zijn `varve.mapping`, `varve.midi.ports`, `varve.opnameSoort`, `vm-patch` (zonder prefix, regel 1015) en `av-kern.v1` (`main.ts:25`, daar staan ook eigen blauwdrukken in). Op dit moment botsen ze niet, maar er is geen afspraak en de quota is gedeeld.

### 5. Testbaarheid in Node
Het uitknippen hierboven werkt, maar alleen met stubs. De systemen lezen globale waarden (`AU.root/scale`, `Grid()` via `document.createElement`, `Path2D`), en de hele file is één IIFE die bij het laden de DOM aanraakt.

## Advies
### Risico's (ernst × kans, schaal 1–3) met maatregel
| # | risico | E×K | maatregel |
|---|---|---|---|
| 1 | Tweede MIDI-driver: modus 0x41, geen wachtrij, geen lock, crash van de Chrome-MIDI-dienst | 3×3 | @varve/kern krijgt **geen** eigen `requestMIDIAccess`. Hij leest de bestaande hub en action-bus (via PluginHost), en LED's lopen via `feedback.js` en de wachtrij. Een test die `requestMIDIAccess` in plugins verbiedt, net als `regels.test.mjs`. |
| 2 | Long tasks door sp/cl/ln/gs op de hoofdthread geven een late cue, LED-jitter en videosprongen | 3×3 | Worker + OffscreenCanvas (zie hieronder). Tot die er is: sp begrenzen (topples per frame maximeren, de stapel meenemen naar het volgende frame) en de budget-scheduler op **gemeten ms** laten sturen, niet op het aantal lagen. |
| 3 | M1 Air heeft geen ventilator: langdurige load leidt tot thermal throttling tijdens een set. **Aanname**, niet gemeten. | 2×2 | De scheduler meet per frame en schaalt terug. Een test van 30 minuten met de bench in een lus als indicatie. |
| 4 | Framerate-afhankelijke dynamiek en `performance.now` (in strijd met regel 3) | 2×3 | De adapter geeft `dt` en `t` van de audioklok mee. `ENV`, `glad` en `gpf` worden per seconde in plaats van per frame. Geen "30 fps" zonder dt. |
| 5 | Math.random maakt replay onmogelijk | 2×3 (alleen als replay een eis is) | Een geseede rng per laag (de xorshift uit `bus.ts`) die via de adapter wordt ingespoten. Ook `PERM` seeden. |
| 6 | De videomixer moet voor een extra laag worden aangepast (MAX 8) | 2×3 | Een apart compositieslot na het mengen (stap 2 "effecten" krijgt een laag-texture), met een test in `video.test.mjs`. |
| 7 | GC (ls, sp, router) | 1×2 | Buffers hergebruiken, `routeFrame` met vooraf gebouwde sleutels. Pas doen na een meting. |
| 8 | Botsende localStorage-sleutels | 1×1 | Een verplichte prefix `varve.plugin.<id>.` via de host. |

### Wat een Worker met OffscreenCanvas oplost, en wat het kost
Het lost op: `step()` en het rasteren gaan van de hoofdthread af, dus pieken van 82 ms raken MIDI, LED's, bijvullen en video niet meer. Het M1 heeft 4 P-cores, dus er is ruimte. De pixelsystemen (gs, ln, cl, if, wv, sp, jl, ph, ch) schrijven al naar een `Uint32Array`, zodat ook alleen die buffer (≤320²×4 = 400 KB) of een `transferToImageBitmap` terug kan naar `texImage2D`.
Het kost: één frame vertraging, een klok die per frame als paar (ctxTime, perfNow) wordt meegestuurd, OUTS en routes die als bericht terugkomen, en `au.*`-analyse die heen moet. Het plan (r. 95: `tick(t, budgetMs)` met OffscreenCanvas) wijst al die kant op. Doe het meteen zo en bouw niet eerst op de hoofdthread.

### Volgorde (eerst meten, zonder Chrome)
1. **Bench uitbreiden in Node**: alle 26 systemen met p99 en max, en per systeem de allocatie (`--trace-gc`, of `v8.getHeapStatistics` voor en na). Een grenswaarde als test: geen stap boven 8 ms p99, geen long task boven 16 ms (sp faalt nu).
2. **Determinisme-test in Node**: met een geseede rng en vaste `dt` moet twee keer draaien een bit-identieke `s.o` en `px` geven. Daarmee is replay te toetsen zonder browser.
3. **MIDI-latentie simuleren in Node**: de hub en wachtrij van `midi.js` met een nep-output, een blokkade van 80 ms in de event loop, en meten hoe laat de wachtrij leegloopt. Zo zie je wat een long task met LED's en invoer doet.
4. Pas daarna, met Clay erbij en de APC los of in zijn tabblad: een Chrome-profiel van de echte renderloop plus 1 vormlaag. De kosten van de renderloop en de videomixer (hier aangenomen op 4–8 ms) zijn niet headless te meten.

Trade-off: een Worker kost een week extra architectuur, maar zonder Worker moet elke zware vormmachine op de hoofdthread in tijdschijven worden geknipt, en dan blijft elk nieuw systeem een risico voor de live-bediening.

## Vragen
- Is deterministische replay (dezelfde set exact opnieuw afspelen, ook de vormen) een harde eis, of volstaat een opname van het beeld? Dat bepaalt of alle 46 Math.random-aanroepen een geseede rng moeten krijgen.
- Mag de vormlaag één frame (16 ms) achterlopen op de muziek? Dat is de prijs van een Worker met OffscreenCanvas.
- Welke 1–3 systemen wil je echt live naast de decks? cl, ln, gs en sp zijn de zware; bd, fy, ep en km kosten bijna niets.
- Akkoord dat AV-kern nooit zelf MIDI opent en de APC alleen via Varve's hub en 0x42-mapping bedient? Dan vervalt de 0x41-modus van AV-kern.
- Mogen we een lange test (30 min) met de bench draaien op je Air om throttling te zien, zonder browser?

## Aannames
- De tijden in Node gelden voor Chrome's V8 op dezelfde M1 als orde van grootte. Echt tekenen, putImageData, drawImage en de texture-upload komen daar nog bovenop.
- Wat Varve's renderloop en videomixer per frame kosten is niet gemeten. Geschat op 4–8 ms zonder vormlagen.
- Thermal throttling van de ventilatorloze Air bij langdurige load is niet gemeten.
- Dat pagina's 20 s vooruit worden opgehaald, heb ik uit plan() gelezen (vooruit=20), niet gemeten tijdens een haper van de hoofdthread.
- Dat AV-kern's midi.ts als tweede driver zou worden meegenomen, volgt uit de plugin-opzet in het projectplan (@varve/kern met midi). Het is nog niet besloten.
- De meting van dl en sp hangt af van de toestand van de simulatie. Ik heb alleen standaardknoppen en een run van 10 s gemeten; presets als 'Vier punten' kunnen zwaarder uitvallen.

# avkern-perspectief
**Kern:** AV-kern en Varve DJ zijn twee verschillende instrumenten met botsende uitgangspunten: een vaste tick van 60 Hz met replay-hash tegenover de audioklok (regel 3), APC-modus 0x41 tegenover 0x42, Vite+TS tegenover geen build. Het projectplan van 23 sep ("Varve DJ = blauwdruk op AV-kern") is achterhaald. Deel alleen wat klokvrij en pure data is (de 26 vormen, de analysefunctie en eventueel de blauwdruk-omzetter) als één plain-JS-bibliotheek. Kies niet voor één app met twee modi en niet voor een @varve/kern-plugin. De kleinste stap die beide projecten helpt is geen code: beslis wie wanneer de APC heeft, en zet daarna de vormen apart als pure modules.

### 1. Wat Clay met AV-kern wil (Totaalplan)
- **Doel:** een meditatie-instrument. Maatstaf is een publicatie, niet werkende code (§1, r.20).
- **Mijlpalen:** M1 op 11 okt (twee blauwdrukken live wisselbaar, replay). **Publicatie 1 uiterlijk 25 okt** (10 minuten meditatie online). AI-laag pas daarna ("geen fase 3 zonder M2", r.227). Publicatie 2 op 8 nov, extra blauwdrukken vanaf 9 nov.
- **Harde regels:**
  - De kern (`midi.ts`, `bus.ts`) is bevroren.
  - "Geen nieuwe module/blauwdruk/AI-poort vóór de mijlpaal" (r.236).
  - Prioriteitenregel: "geen nieuwe infra tot 1 nov; baan-lane eerst" (r.242).
  - Stopcriterium: 14 dagen zonder APC-sessie → parkeren (r.241).
  - Grootste risico volgens Clay zelf: "systeemgeneratie zeven: ontwerpen in plaats van spelen".
- **Stand:** 1 commit, 17 tests. LOG.md r.5: "Nog niet getest: de echte APC40 en het geluid op de M1 Air". Fase 0.1 (APC aansluiten) is nog open.
- **Projectplan r.228:** "Staat AV-kern op de Bouwkaart als één project met Varve DJ als blauwdruk erin? … zonder dat besluit wordt er niet gebouwd."

### 2. Plan tegenover werkelijkheid
Het projectplan (r.25) noemt Varve DJ "Alleen plan". In werkelijkheid heeft Varve DJ:
- 8 tracks en streaming;
- een beatgrid als tempokaart;
- een eigen mapping van 291 regels in mode 0x42;
- een videomixer, sends, sampler en opname;
- 1480 groene checks.

De blauwdruk `blueprint-varvedj.json` (2 decks gespiegeld, pitchfaders buitenaan) botst op minstens 6 punten met de gebouwde indeling (`docs/INPUT.md` r.88–121). De plannen gaan dus uit van een andere Varve DJ dan er staat.

### 3. Waar ze technisch botsen
| Onderwerp | AV-kern | Varve |
|---|---|---|
| Tijd | `bus.ts` r.4 `TICK=1/60`, `nowMs()` uit ticks (r.106), τ geklemd op 0,02 (r.111) | Regel 3: `ctx.currentTime`; streaming is niet deterministisch |
| Replay | MIDI-bytes per tick + FNV-hash van de busstand (`log.ts`) | Kan niet hash-exact; hooguit een actielog op de audioklok (INPUT.md r.136) |
| APC | sysex modus 0x41, eigen `requestMIDIAccess` | 0x42 (gemeten), `MidiHub` met wachtrij 16/4 ms, echofilter, Web Lock `varve-mixer` (`tabblad.js` r.17) |
| Bus-keys | hard: `m{i}.on/level/p0-7`, `macro0-7`, `master`, `xf` (r.83–87), plus ademklok en scènes erin | action-bus, genormaliseerd 0..1, `track.N.*` |
| Build | Vite + TS + Vitest | geen build, nul dependencies |

De AV-kern-bus is **specifiek voor meditatie** (slots, adem, scènes, freeze). Een algemene `@varve/kern` betekent die bus herschrijven, en dat mag niet: hij is bevroren.

### 4. Vormmachines (`vormmachines.html`, 1049 regels, 116 KB)
- `SYSTEMS` staat op r.240, `OUTS` op r.706, de router (`routeFrame`) op r.934, de eigen lus op r.1024.
- Elk systeem is `init(s,p,g)` + `step(s,p,g)` op een **Canvas 2D** (`g.ctx`). Dat is geen WebGL: `getContext('2d')` komt 3 keer voor, `webgl` 0 keer.
- Koppelingen in het systeemblok (r.240–705):
  - 52× `Math.random`;
  - 9× `performance.now`;
  - 16× `AU.` (globale audiomotor), `playBuf`/`AON()`. Isomorfe systemen maken zelf geluid.
- Gevolg: niet deterministisch (breekt de replay van AV-kern als de uitgangen naar de bus gaan) en in strijd met regel 3 van Varve. Te verhelpen door `rng`, `t` en audio-hooks mee te geven: mechanisch werk, geen herontwerp.
- `audioAnalyse()` (r.868) doet in ~10 regels rms/laag/mid/hoog/centroid/onset. Het projectplan noemt analyse "groot" (r.23), maar de kern staat hier al.

### 5. Wat de een van de ander nodig heeft
**AV-kern van Varve:**
- **opname:** WAV + mp4 per seconde, crashbestendig. AV-kern downloadt WebM pas bij stoppen, dus een crash kost alles. Voor publicatie 1 geldt de eis "10 min zonder drop-out".
- **library/ingest/upload:** bronnen voor Korrelwolk en Veldopnames.
- **MIDI-lessen:** wachtrij, `connected`-hotplug en één tabblad per APC. Dit zijn de lessen van 5 Chrome-crashes.

Beatgrid en streaming zijn voor meditatie nauwelijks relevant.

**Varve van AV-kern:**
- **vormen als beeldlagen:** dit heropent "video is SLAAF" en vraagt een extra pass in `video-mixer.js`;
- **replay** (~1 dag, als actielog);
- **blauwdruk-import:** alleen als Clay in Bedienplan blijft ontwerpen.

Bus-slew heeft Varve al in eigen vorm: `macro.glide` en soft-takeover.

### 6. Verborgen risico: twee apps, één APC, één Chrome
Varve draait op `localhost:8777`, AV-kern op `:5173`. Dat zijn **verschillende origins**, dus Web Locks en BroadcastChannel delen niets. Beide apps tegelijk open betekent twee MIDI-clients en twee sysex-modi (0x41 tegenover 0x42) die om beurten LED's sturen. Dat is precies het crashpatroon van 22–23 sep.

De Origin-controle van de Varve-server (`server/index.js` r.429–437) weigert bovendien POST's van :5173. AV-kern kan de opname-API dus niet gebruiken zonder dezelfde origin.

## Advies
### Oordeel over de drie opties
1. **Eén app met twee modi: nee.** Die zou de replay-hash van AV-kern en regel 3 van Varve tegen elkaar laten vechten. Hij dwingt een build-keuze af en maakt dat 1480 Varve-checks en een bevroren kern elkaars risico worden. Het is ook precies "ontwerpen in plaats van spelen" vlak voor 25 okt.
2. **`@varve/kern` als plugin in Varve: nee.** Varve's controllerlaag (0x42, mapjes, endless, echofilter, Web Lock) is verder en beter getest dan de AV-kern-driver, die nog nooit aan een echte APC heeft gehangen. De plugin vervangt goed door onbewezen en kost ~2 sessies nieuwe infra. Dat breekt Clay's eigen regel "geen nieuwe infra tot 1 nov".
3. **Gedeelde bibliotheek, smal: ja, maar later en klein.** Alleen wat klokvrij en DOM-vrij is:
   - `vormen/`: de 26 systemen met `rng`, `t` en audio-hooks meegegeven, plus `OUTS` en de curves van de router;
   - `analyse.js`: `audioAnalyse` als pure functie (spectrum → features);
   - eventueel `blauwdruk-naar-mapping.js`.

   In **plain JS met JSDoc**: Vite importeert dat zonder moeite, en Varve kan geen TS laden zonder de server aan te passen. Elke app bouwt zijn eigen adapter: AV-kern maakt er een `VisualModule` van (`contract.ts`), Varve eventueel een laag in de videomixer.

### Volgorde (kleinste stap eerst)
1. **Nu, zonder code:** besluit over de Bouwkaart en de APC-regel "één app tegelijk aan de APC". Stekker om, of de andere app dicht. Daarna Totaalplan-actie 0.1: AV-kern 20 min op de APC, met Varve dicht. Dit helpt beide: het beschermt Chrome en haalt het enige bewijs binnen dat AV-kern mist.
2. **Vóór 25 okt, alleen als het publicatie 1 dichterbij brengt:** de vormen als pure modules (~1 sessie om los te maken). AV-kern kan ze inzetten in plaats van de sessies 06d–f (Strata/Deeltjes/Nasleep), zodat ze meetellen voor zijn mijlpaal en geen extra werk zijn. Varve raakt ze pas aan als Clay "generatief beeld" bevestigt.
3. **Optioneel:** AV-kern gebouwd (`av-kern-lokaal.html`) laten serveren door de Varve-server, op dezelfde origin. Dan delen ze Web Lock, opname-API en library, zonder dat een van beide kernen verandert. Kost: witte lijst plus COEP/Google Fonts uitzoeken (aanname: de font-stylesheet heeft `crossorigin` nodig).
4. **Na publicatie 1:** replay in Varve als actielog (~1 dag) en de blauwdruk-import, alleen als Bedienplan in gebruik blijft.

### Afwegingen
- **Smal delen** kost twee kleine adapters in plaats van één kern. Winst: geen van beide projecten kan de ander breken, en de deadline van AV-kern blijft haalbaar.
- **Geen `@varve/kern`** betekent dat de oorspronkelijke opdracht (twee plugins) grotendeels vervalt. Dat vraagt Clay's expliciete akkoord.
- **Wachten met Varve-vormlagen** laat de sterkste kruisbestuiving liggen tot na 25 okt. Wel voorkomt het dat Varve een derde, onbesliste beeldfilosofie krijgt.

## Vragen
- Bouwkaart: tel je Varve DJ en AV-kern als twee actieve projecten? En trek je het projectplan van 23 sep ('Varve DJ = blauwdruk op AV-kern') in, nu Varve DJ al een werkende app met 8 tracks is?
- Gaat publicatie 1 (25 okt, AV-kern) voor op verder Varve-werk? Zo ja: ligt Varve DJ stil tot dan, afgezien van speel- en testsessies?
- Vervalt de @varve/kern-plugin (driver, bus, register in TS in Varve)? Varve's eigen controllerlaag is verder, en het is nieuwe infra vóór 1 nov.
- Mag Varve generatief beeld krijgen (vormen als laag in de videomixer)? Dat heropent 'video is SLAAF van de audio'.
- APC-regel tussen de apps: altijd maar één app open met de APC (stekker/tab dicht)? Of AV-kern via de Varve-server op dezelfde origin, zodat ze één lock delen?
- Blijf je Bedienplan gebruiken om indelingen te ontwerpen? Alleen dan is een import van blauwdruk naar Varve-mapping zinvol.
- Wil je replay in Varve (set naspelen of opnieuw renderen), wetende dat het niet hash-exact kan maar een actielog op de audioklok wordt?
- Gedeelde vormen-bibliotheek in plain JS met JSDoc, zodat beide apps hem zonder build laden, of moet het TypeScript zijn?

## Aannames
- Het Totaalplan (23 sep) is nog Clay's geldende plan, inclusief publicatie 1 op 25 okt en de regel 'geen nieuwe infra tot 1 nov'.
- Clay zou beide apps in dezelfde Chrome gebruiken met één APC. Dan is het origin-verschil (:8777 tegenover :5173) een echt risico.
- Dat de font-stylesheet van av-kern-lokaal.html onder Varve's COEP require-corp een crossorigin-attribuut nodig heeft, is niet gemeten.
- Het schatten van ~1 sessie om de vormen los te maken rust op tellingen (52 Math.random, 9 performance.now, 16 AU-verwijzingen in r.240–705), niet op een proefport.
- De AV-kern-bron in de scratchpad (zip) is dezelfde versie als Input/av-kern-lokaal.html. Niet bit voor bit vergeleken.
- Varve's AnalyserNodes (audio-graph.js r.37 per strip, r.91 master) zouden de features van audioAnalyse kunnen leveren. Niet gecontroleerd dat elke strip er een heeft die bereikbaar is.