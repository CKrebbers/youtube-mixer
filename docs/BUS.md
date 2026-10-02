# Koppelbus — het contract

**Stand (2 okt 2026):** dit is het contract. Er is nog niets van gebouwd.

In één zin: VARVE blijft de bron van tempo, toonsoort en beeld. Een klein apart proces, de hub, geeft dat door aan de andere apps. Elke app praat alleen met de hub, nooit rechtstreeks met de engine.

## Regels

1. **De drie regels van VARVE blijven heel** (CLAUDE.md):
   - De hub raakt de engine niet.
   - Wat een andere app wil aansturen, komt binnen als `invoke(id, waarde)` op de action-bus, met waarden 0..1 of een boolean.
   - Tijd komt uit `ctx.currentTime`, nooit uit een eigen teller.
2. **Eén zender per baan.** De banen muziek, beeld en klok komen alleen uit het mixer-tabblad met de Web Lock `varve-mixer`, net als `varve-status`.
3. **De hub onthoudt bijna niets:** alleen wie de APC heeft, en per baan het laatste bericht. Zo krijgt een app die later aansluit meteen de stand.
4. **Alleen Node-ingebouwd** (`node:http`, `node:crypto`). De hub luistert alleen op `127.0.0.1` en checkt de Origin, net als de server (`server/index.js` L546).
5. **Valt de hub weg, dan speelt VARVE gewoon door.** De zender probeert elke 3 s opnieuw te verbinden, zoals de Waterschaal.

## Hoe het vastzit

```
VARVE-mixer (Chrome, tabblad met de Web Lock)
  ├─ ws://127.0.0.1:8778 ──► hub (node hub/index.js)
  │                            ├─ ws ──► TouchDesigner (WebSocket DAT, als client)   fase 1
  │                            ├─ ws ──► OBS (obs-websocket :4455)                    fase 3
  │                            └─ ws ──► AV-kern, MediSynth, Uurwerk                  fase 4
  └─ Web MIDI ──► IAC-bus "VARVE klok" ──► Logic, Maschine, VCV (clock-slaaf)        fase 2
```

De klok gaat niet via de hub. Node kent geen MIDI zonder extra pakket, en de browser kan zelf met tijdstempels naar een IAC-bus sturen.

## Poorten

| Poort | Van wie | Protocol | Stand |
| --- | --- | --- | --- |
| 8777 | VARVE-server | HTTP | bestaat |
| 8778 | hub | WebSocket, JSON-tekst | nieuw, fase 1 |
| 9980 | Waterschaal ↔ TD (TD is server) | WebSocket, JSON-tekst | bestaat, blijft los |
| 4455 | OBS | obs-websocket v5 | fase 3 |
| IAC "VARVE klok" | VARVE → klank-apps | MIDI clock | fase 2 |

## Envelop en kennismaking

Elk bericht is één JSON-tekstbericht met minstens deze velden:

```json
{ "baan": "muziek", "type": "stand", "van": "varve", "t": 1790970000123 }
```

`t` is `Date.now()` bij versturen: dezelfde klok voor alle processen. VARVE zet er waar nodig `ctx` bij, de audiotijd in seconden.

Bij het verbinden stuurt elke app een `hallo`. De hub antwoordt met `welkom`:

```json
{ "baan": "hub", "type": "hallo", "app": "td", "versie": 1, "luistert": ["muziek", "beeld"], "stuurt": [] }
{ "baan": "hub", "type": "welkom", "apps": ["varve", "td"] }
```

De hub stuurt een bericht alleen naar apps die naar die baan luisteren, en nooit terug naar de afzender. Een onbekende baan gooit hij weg; hij logt dat één keer.

## Banen

### klok — tempo, maat, tel 1

- **Wat:** MIDI clock (0xF8, 24 per tel), Start (0xFA) op tel 1, Stop (0xFC).
- **Zender:** `src/control/klok-uit.js`, naast `midi.js`. De engine blijft MIDI-vrij.
- **Bron:**
  - De maatgever is `engine.maatgever()` / `snapshot().maat`.
  - De tikmomenten komen uit diens beatgrid (`deck.ctxTimeOf`, `telInMaat`).
  - Die momenten worden omgerekend naar `performance.now` met `ctx.getOutputTimestamp()`, en verstuurd met `output.send(bytes, tijdstempel)`, zo'n 100 ms vooruit.
  - Een timer mag de zender alleen wekken. Waar de tikken vallen komt uit `ctx.currentTime` (regel 3).
- **Luisteraars:** Logic (met Sediment), Maschine, VCV via MIDI-CV.
- **Stand:** niet gebouwd. Inkomend 0xF8 is nu ruis in de monitor (`midi.js`).
- **Let op:** een tabblad op de achtergrond knijpt zijn timers als er niets klinkt (`status-zender.js`). Tijdens een set klinkt er altijd iets. Blijkt het toch een probleem, dan wekt een Worker de zender.

### muziek — tempo, tel, toonsoort, energie

`stand` wordt 30 keer per seconde verstuurd, net als de Waterschaal naar TD:

```json
{ "baan": "muziek", "type": "stand", "van": "varve", "t": 1790970000123, "ctx": 812.402,
  "maat": "A", "bpm": 124.0, "tel": 3, "fase": 0.41,
  "energie": { "rms": 0.62, "laag": 0.71, "midden": 0.48, "hoog": 0.33 } }
```

Losse berichten, alleen bij een verandering:

```json
{ "baan": "muziek", "type": "tel", "tel": 1 }
{ "baan": "muziek", "type": "nummer", "deck": "A", "id": "…", "titel": "…" }
{ "baan": "muziek", "type": "toon", "deck": "A", "camelot": "8B", "naam": "G", "zekerheid": 0.8 }
```

**Bronnen:**

| Veld | Komt uit |
| --- | --- |
| `maat` | `snapshot().maat` |
| `bpm` | `deck.bpm` (= `grid.bpmAt(pos) × rate`) |
| `tel` | read-action `track.N.barbeat` (1..4) |
| `fase` | read-action `track.N.phase` (0..1) |
| `toon` | `deck.toonsoort` (`camelot`, `kort`, `zekerheid`) |
| `energie` | `features.js` (`rms`, `laag`, `midden`, `hoog`) |

Hoe het werkt:

- `tel` gaat de deur uit op het moment dat de tel hoorbaar is, dus met `uitgangsVertraging()` uit `hoorbaar.js`. Op localhost duurt het dan nog ongeveer 1 ms.
- `energie` is `null` als er geen features draaien. Nu draait `features.js` alleen als er een vormroute open staat (`router.nodig()`). Met de bus moet dat ook gelden zolang de hub verbonden is.

**Luisteraars:** TD, AV-kern, de klank-apps via hun adapter.

**Stand:** de data bestaat. Alleen `bpm` en `toon` gaan nu de deur uit, als tekst, via `varve-status`.

### acties — de action-bus over de draad

Deze baan werkt in twee richtingen, in de vorm van de action-bus:

```json
{ "baan": "acties", "id": "track.1.fader", "waarde": 0.5 }
{ "baan": "acties", "id": "record.start", "waarde": true }
```

- **VARVE → bus:** elke `invoke` via `bijInvoke`. Een value-action gaat per id hooguit 60 keer per seconde.
- **Bus → VARVE:** de zender roept `invoke(id, waarde)` aan. Een onbekende id doet niets, want `invoke` geeft dan `false`.
- **Gebruik:** bediening vanaf de iPad of een andere controller, en de hub die OBS laat opnemen bij `record.start`.
- Dit is dezelfde vorm als een actieregel in de handelingenlog (`[t, id, waarde]`), dus log en bus blijven uitwisselbaar.
- **Stand:** de action-bus bestaat (`src/control/actions.js`). De draad niet.

### beeld — vormlagen en video-fx naar TD

Bij elke verandering, hooguit 30 keer per seconde:

```json
{ "baan": "beeld", "type": "lagen",
  "lagen": [ { "nr": 1, "aan": true, "systeem": "…", "dekking": 0.8, "mengvorm": "screen",
               "knoppen": [0.2, 0.5, 0.0, 1.0, 0.3, 0.7] } ],
  "video": { "mode": "mix", "fx": { "pixel": 0, "spiegel": 0, "rgb": 0.2, "kleur": 0.5, "sporen": 0, "korrel": 0.1 } } }
```

- **Bron:**
  - de vormlagen (`MAX_BEELDLAGEN = 2`, 26 systemen, 6 knoppen 0..1)
  - de video-mixer, dezelfde stand die `video.html` nu via `window.opener.varveBeamer` overneemt
- **TD rendert en stuurt naar de beamer.** Er gaat geen videostream uit de browser. Pulsen haalt TD uit `muziek.tel`; een aparte pulsbaan is er niet.
- **Stand:** de data bestaat. De draad niet. De TD-kant kan het bouwscript van de Waterschaal (`td/bouw_waterschaal.py`) als voorbeeld nemen.

### apc — wie de controller heeft

Een Web Lock geldt per origin. `varve-mixer` en `av-kern-apc` zien elkaar dus niet; AV-kern schrijft dat zelf in `src/kern/tabblad.ts`. De hub wordt de ene plek die bijhoudt wie de APC heeft:

```json
{ "baan": "apc", "type": "vraag", "app": "av-kern" }
{ "baan": "apc", "type": "eigenaar", "app": "varve" }
{ "baan": "apc", "type": "los", "app": "varve" }
```

- Wie de APC heeft, houdt hem tot hij `los` stuurt.
- Vraagt een app erom terwijl hij bezet is, dan antwoordt de hub met de huidige `eigenaar`.
- De Controlekamer krijgt een knop "geef de APC aan …".
- Zonder hub valt elke app terug op zijn eigen Web Lock, zoals nu.

## Buiten de bus

- **Audio:** BlackHole 16ch verbindt de apps. Audio gaat niet over de bus.
- **Waterschaal ↔ TD op :9980:** blijft zoals hij is.
- **`varve-status`:** blijft het kanaal voor de Controlekamer (zelfde origin).
- **OSC:** komt er pas als een app het echt nodig heeft (AVBRNC, fase 4).

## Fasen

Eindbeeld (aangenomen, Clay bevestigt): een livestream plus opname. Daarom komt opname (fase 3) vóór klank (fase 2): na fase 3 is er iets om te laten zien.

| Fase | Wat | Klaar als |
| --- | --- | --- |
| 0 — opruimen | Gedaan: werk van 26–30 sep gecommit (`a59f548`), yt-dlp, tests groen op de Mac, GitHub-repo, dit contract. Open: de map uit iCloud | alle tests groen in een map buiten iCloud |
| 1 — VARVE ↔ TD | `hub/` (8778), `src/bus/zender.js` in het mixer-tabblad (muziek en beeld), WebSocket DAT en bouwscript aan de TD-kant, een tegel "bus" in de Controlekamer | een set van 20 minuten waarin TD beweegt op de maat en toonsoort van VARVE |
| 3 — opname | Opname (WAV, video 720p) en handelingenlog bestaan al. Nieuw: een OBS-scène met TD-beeld en de BlackHole-mix; `record.start`/`stop` via de hub naar obs-websocket | één knop start een set, en daarna heb je video met TD-beeld plus log |
| 2 — klank | `klok-uit.js` naar IAC; Logic en Sediment volgen; Maschine en VCV als clock-slaaf; de terugweg via BlackHole | Logic loopt een hele set strak mee zonder handwerk |
| 4 — zusters | AV-kern op de banen apc en beeld, MediSynth en Uurwerk als luisteraars, AVBRNC via OSC | AV-kern en VARVE gebruiken dezelfde vormcode |

Fase 1 begint pas na een proefsessie waarin auto-DJ, planvenster en klankschaal echt beluisterd zijn (speellijst in de Controlekamer).

## Open keuzes

1. **WebSocket-server:** zelf schrijven (ongeveer 120 regels, `node:crypto`, alleen tekstframes) of het pakket `ws`. CLAUDE.md zegt dat elke toevoeging eerst wordt voorgelegd. *Advies: zelf, want het is alleen localhost en alleen tekst.*
2. **Klok bij een wissel van maatgever:** het tempo glijdt mee, of de klok start opnieuw op tel 1. *Advies: meeglijden.*
3. **Energie:** de live master-features, of `loudness_i` per nummer uit de library. *Advies: live.*
4. **Waar de hub woont:** `hub/` in deze repo, of een eigen repo. *Advies: in deze repo, dan delen ze de tests.*
