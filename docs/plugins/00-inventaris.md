# Plugins — inventaris en voorstel (24 september 2026)

Stap 1 van de opdracht "Vormmachines en AV-kern als losse plugins". Alleen
gelezen en opgeschreven: nog geen code. Eerst Clays akkoord op de keuzes
onderaan.

## 1. Wat er is aangeleverd (en wat ontbreekt)

| Genoemd in de opdracht | Gevonden | Opmerking |
|---|---|---|
| `av-kern-lokaal.html` | `Input/av-kern-lokaal.html` (134 KB) | Bytegelijk aan `~/Downloads/av-kern-lokaal (1).html` |
| `blueprint-varvedj.json` | `Input/blueprint-varvedj.json` | `id: varvedj`, 83 functies (audio 32, transport 24, beeld 18, sys 6, mod 3), 147 elementen, lagen `base` + `shift` |
| `vormmachines.html` | **ontbreekt** | Niet in `Input/`, niet in `modules/` (leeg), niet op Bureaublad/Downloads/Documenten |
| Projectplan AV-kern × Varve DJ (md/pdf) | **ontbreekt** | Idem. Hierin staan volgens de opdracht `AnalyseFeatures`, `FnArgs`, `VideoLayer`, `LayerHandle`, `VormModule` en de fasering — en het plan is **leidend** |
| — | `Input/av-kern.zip` | **De leesbare TypeScript-bron van AV-kern** (`src/kern/*.ts`, 17 vitest-tests, 7 blauwdrukken). Niet genoemd in de opdracht, maar dit is de bron van `av-kern-lokaal.html` |

De map heet `Input/` (hoofdletter) en staat in `.gitignore`.

Gevolg: **plugin 2 (`@varve/vormen`) kan niet beginnen** zonder
`vormmachines.html`, en de interfaces van het gedeelde contract zijn maar half
bekend zonder het projectplan. Plugin 1 kan wel: de bron is er.

## 2. Varve DJ zoals hij nu is

Stand: werkboom schoon, laatste commit `2fe02a3` (eigen bestanden, TikTok,
staande video), `node test/alles.mjs` → 23 bestanden, 1480 checks, groen.

| Onderwerp | Stand in de repo | Botst met de opdracht? |
|---|---|---|
| Bouwtool | **Geen.** Plain ES-modules, `index.html` laadt `src/ui/app.js`. Geen `package.json`, geen npm, geen Vite. CLAUDE.md: "Introduceer geen bundler zonder te vragen", nul frontend-dependencies | **Ja**: `VITE_PLUGINS`, `npm test`, "TypeScript strict" en Playwright gaan uit van een Vite/npm-project |
| Testcommando | `node test/alles.mjs` (Node 26.8, eigen mini-runner, Web Audio-mock) | `npm test` bestaat niet; ik gebruik het bestaande |
| Server | `node server/index.js`, poort 8777, witte lijst voor statische paden | Een map `packages/` wordt nu **niet** geserveerd (witte lijst) |
| Audio-engine | `src/engine/` — `Engine` met **acht** decks `A`–`H` (`DECK_IDS`), master-keten, crossfader, sends, sampler. Regel 1: kent geen MIDI/DOM | Opdracht spreekt van **2 decks** (`'A' \| 'B'`) |
| Action-bus | `src/control/actions.js` — alles wat de engine aanstuurt, genormaliseerd 0..1, in TRACKS (`track.1.fader`) | Het register van de kern moet hierop uitkomen, niet op de engine zelf |
| MIDI | `src/control/midi.js` (`MidiHub`: poorten, parsen, sysex, uitgaande wachtrij 16 berichten/4 ms), `mapping.js`, `feedback.js` (LED-diffing), `lagen.js` (mapjes/shift), opgezet in `src/ui/midi-opzet.js`. APC in **mode 0x42**. Web Lock: één tabblad praat met de APC | **Ja**: de kern-driver zet de APC in **0x41** en opent zelf een MIDI-poort (zie §4) |
| Videomixer | `src/video/video-mixer.js` — één `<video>` per track, WebGL2, drie vaste shaderstappen (mengen → effecten → tonen), 1280×720, 8 texture-units voor de 8 tracks | **Ja**: er is geen haakje om een extra laag toe te voegen. `addLayer` vraagt een wijziging in `teken()` |
| Opname | `src/opname/` — WAV + mp4 van de master | Los van de handelingenlog van de kern |

## 3. AV-kern: wat de bron is

De opdracht zegt: extraheer uit de geminificeerde html. Maar `av-kern.zip`
bevat dezelfde kern **als leesbare TypeScript** (`src/kern/`: `apc40.ts` 74 r,
`midi.ts` 138, `blueprint.ts` 93, `functions.ts` 168, `bus.ts` 195, `log.ts`
72, `types.ts` 99). Daarin staan precies de gevraagde dingen: `input(bytes,
src, force)`, pick-up met de drempels 0,03 / 0,04 / kruising, ring-CC's
`56+k` en `24+k` (type 2), `TAU = { slew: 1.5, abs: 0.08, pick: 0.15 }`,
standaard τ 0,1, statussen `kern/alias/stub/ontbreekt`, `Session`
`{version, createdAt, blueprint, start, entries[{tick,bytes}], endTick,
endHash}` met FNV-1a-hash, sysex `F0 47 7F 29 60 00 04 41 01 00 00 F7`.

**Voorstel:** de zip als bron nemen en de html alleen gebruiken om te
controleren dat het dezelfde versie is (de sysex en `56+e`/`24+e` staan er
ook zo in). Dat is betrouwbaarder dan de-minificeren en de commentaren met
"vervangt `ge`, `Le`…" worden dan een verwijzing naar het `.ts`-bestand plus
de minified naam waar ik die kan aanwijzen.

Wat in de kern **specifiek voor AV-meditatie** is en eruit moet om hem
herbruikbaar te maken: `Bus` kent slots, scènes, macro's, ademklok, solo,
freeze (de opdracht wil bus-keys "configureerbaar via een def-lijst per
plugin" — klopt), `createRegistry` registreert drone/veld-functies, `Hooks`
zijn play/rec. Die gaan naar een AV-kern-voorbeeld, niet naar `@varve/kern`.

## 4. De vier botsingen die eerst beslist moeten

### 4a. Twee MIDI-drivers op één APC

Varve's `MidiHub` heeft de APC al (0x42, eigen mapping van 291 regels, LED's,
Web Lock). Als `@varve/kern` in hetzelfde tabblad zelf `requestMIDIAccess`
doet en 0x41 stuurt:
- zet hij de APC in een andere modus, waardoor Varve's device knobs en Track
  Select anders gaan melden (gemeten 23 sep: in 0x41/0x40 klopt de
  standaardmapping niet);
- verwerken twee lagen elke knopdruk (dubbele actions);
- sturen twee lagen LED's, elk met een eigen cache: flikkeren, en precies het
  soort stortvloed waarbij Comet's MIDI-dienst vier keer crashte.

**Advies:** in Varve krijgt de kern-driver **geen eigen poort**. De host geeft
hem de bytes die `MidiHub` al ontvangt (en zijn LED-bytes gaan door de
wachtrij van de hub), en hij draait alleen als de gebruiker de blauwdruk als
indeling kiest — dan zwijgt Varve's eigen mapping. De modus blijft 0x42; de
0x41-init blijft in de code voor losstaand gebruik (`connectApc40`), zoals in
het origineel. "Gedrag identiek" geldt dan voor parsen, pick-up, shift, LED-
cache en ringen, niet voor de poortkeuze in Varve.

### 4b. Blauwdruk vs. huidige indeling

De blauwdruk is de twee-deckgedachte (deck A kolom 1–4, B 5–8, pitchfaders
buitenaan, EQ op de track knobs). Varve is sinds 23 sep "één kolom = één
track" met acht tracks. Beide tegelijk op de APC kan niet. Met de flag aan en
de blauwdruk geladen: **welke bedient de APC?** (zie vraag 3)

### 4c. Build en TypeScript

Opdracht: TypeScript strict, Vite-flag, `npm test`, Playwright. Repo: geen
build, geen npm. Opties:

| | Hoe | Kost |
|---|---|---|
| **A (advies)** | Echte `.ts`-bestanden in `packages/`. Node 26 draait ze direct (type-stripping, geen vlag nodig) → tests met `node test/alles.mjs`. De server stript types bij het serveren met Node's eigen `module.stripTypeScriptTypes` (geen dependency). Strict typecheck met `npx -p typescript tsc --noEmit` als los devcommando | Een wijziging in `server/index.js` (witte lijst + `.ts` als JS serveren). Types alleen "erasable" (geen `enum`, geen parameter-properties — het origineel gebruikt `constructor(public …)`, dat wordt herschreven) |
| B | Plain `.js` met JSDoc-types en `// @ts-check`, strict gecontroleerd door `tsc --checkJs` | Geen serverwijziging; maar het is geen "TypeScript" zoals gevraagd |
| C | Vite + npm invoeren | Breekt "geen build-stap", raakt `index.html`, `no-store`-aanpak, hele werkwijze |

Flag: zonder Vite bestaat `VITE_PLUGINS` niet. **Advies:** `?plugins=kern,vormen`
in de url, met `localStorage['varve.plugins']` als onthouden stand. Leeg =
geen enkele import van `packages/`, dus de huidige app bytegelijk in gedrag.

Playwright: er staat een Chromium-cache (`ms-playwright/chromium-1243`), maar
geen Playwright-pakket in dit project. Dat wordt een dev-dependency via
`npx`. **Let op:** een headless Chromium ziet ook de APC via CoreMIDI. De
Playwright-test mag geen MIDI-toegang vragen (virtuele invoer via
`driver.input(bytes, 'test', true)`, zoals de opdracht al zegt) en start een
eigen server op een eigen poort met tijdelijke db (zoals `server.test.mjs`).

### 4d. Een vormlaag in de videomixer

`VideoMixer.teken()` heeft vaste passen en 8 texture-units voor 8 tracks; er
is geen `addLayer`. Een generatieve laag erbij vraagt een wijziging in
`src/video/video-mixer.js` (een extra pass na het mengen, vóór de effecten, met
blend add/screen/multiply en opaciteit). Dat valt buiten "alleen adapter,
flag, één bootstrap-regel" → komt als voorstel in `docs/plugins/wijzigingen.md`.
Ook: CLAUDE.md zegt "video is SLAAF van de audio"; een generatieve laag is een
nieuw soort beeld. Dat is een ontwerpkeuze die Clay moet bevestigen.

## 5. Voorstel: waar PluginHost komt

```
packages/
  plugin-api/   index.ts        alleen types + één hulpfunctie, nul imports
  kern/         bus.ts, functions.ts, blueprint.ts, midi.ts, opname.ts, apc40.ts, README.md
  vormen/       (wacht op vormmachines.html)
src/plugins/
  host.js       DE adapter: PluginHost op Engine + actions + MidiHub + VideoMixer
  laden.js      leest ?plugins=…, importeert dynamisch, init/dispose, fouten naar meld()
test/
  plugins.test.mjs   kern-bus (slew, τ=0), pick-up-drempels, blueprint laden, host-adapter tegen de mock
```

- `src/plugins/host.js` zit in `src/ui/`-land (kent engine, actions, MIDI en
  video); **niet** in `src/engine/` (regel 1 blijft heel).
- `bus.set('deckA.fader', v, τ)` in de host → na de slew `action('track.1.fader', v)`;
  τ ≤ 0 = in dezelfde tick doorgeven, zonder tussenwaarden.
- `register(fnId, cmd)` → een blauwdruk-functie die de bestaande action-bus
  aanroept (`deck-play` → `track.N.play`). Engine-functies die niet bestaan
  blijven stub met reden, lijst in `docs/plugins/register-todo.md`.
- `transport('A')` → `engine.deck('A').position/rate/playing`, gelezen op
  `ctx.currentTime` (regel 3).
- `mixerIn('A' | 'B' | 'master')` → invoer van de kanaalstrip resp.
  `engine.master.input`. Plugins kunnen er alleen iets bíj zetten; de
  deck-audioketen verandert niet.
- Bootstrap: één regel onderaan `src/ui/app.js`:
  `import('../plugins/laden.js').then((m) => m.laadPlugins({ engine, … }))`,
  alleen als de flag gezet is.

## 6. Vragen aan Clay (in volgorde van belang)

1. **`vormmachines.html` en het projectplan ontbreken.** Kun je ze in `Input/`
   zetten? Tot dan kan ik alleen plugin-api + kern bouwen, en de interfaces
   uit het plan (`FnArgs`, `VideoLayer`, `LayerHandle`, `AnalyseFeatures`,
   `VormModule`) moet ik anders zelf invullen (aanname, niet leidend).
2. **TypeScript zonder build (optie A)?** Echte `.ts`, server stript types,
   typecheck via `npx tsc`; flag als `?plugins=kern,vormen`. Advies: ja.
3. **Wie bedient de APC als de kern-plugin aan staat?** Advies: de kern krijgt
   de bytes van Varve's hub en neemt de APC alleen over als je de blauwdruk
   actief kiest; dan zwijgt Varve's eigen mapping. Modus blijft 0x42.
4. **Twee decks in het contract (`'A' | 'B'`)**: = track 1 en 2? Of de kant
   van de crossfader? Advies: track 1 en 2, net als de standaard-toewijzing.
5. **Generatieve beeldlagen in de videomixer**: mag `video-mixer.js` een extra
   laagpass krijgen (via `wijzigingen.md`)? Dat heropent "beeld = de video van
   de track".
6. **Playwright als dev-dependency** (via `npx`, geen runtime) — akkoord? En
   de headless-test vraagt nooit MIDI-toegang.

Zodra 1–3 beslist zijn begin ik met `packages/plugin-api` + de host-adapter
achter de flag (eerste commit), daarna de kern: bus en register eerst.
