# Opstellingen en de Tocht

Clay, 29 okt 2026: "een setup die ervoor zorgt dat je eindeloos veel templates kan bouwen waar je dan op
heel veel verschillende manieren mee kan spelen, waardoor het altijd weer anders wordt", en: "tegelijk een
soort spel om kennis te maken met alle mogelijkheden; onderweg worden alle onderdelen data, en daaruit
blijkt wat je mooi vindt. Als je alles hebt gehad: verder spelen met je ideeën, of verder bouwen aan het
spel. Je bent altijd vrij."

Gebouwd op tak `claude/opstelling` (op de pc, 29 okt). Alles staat in `app/`.

## De logica: drie lagen

| Laag | Wat | Waar |
|---|---|---|
| **Bouwstenen** | Wat v2 al kan: nummers en stems uit de v1-library, instrumenten (drums, poly, fm, schaal), racks (`racks/sjablonen.json`), patronen, vormlagen (26 systemen), video | bestaande code |
| **Recept** (template) | Data: welke bouwstenen op welke track, met **bereiken** in plaats van vaste waarden, acht **macro's** (het alfabet), scenes en hoeveel hij uit zichzelf beweegt | `opstellingen/*.json`, model `src/kern/opstelling/model.js` |
| **Opstelling** | Recept + **zaad** = concrete keuzes (dit nummer, dit rack, dit patroon in deze toonsoort). Hetzelfde zaad geeft dezelfde opstelling, een ander zaad iets nieuws | `src/kern/opstelling/realiseer.js` |

**Het alfabet** (uit `werkplek/bediening/SYSTEEM.md`): macro k betekent in elk recept hetzelfde soort ding.
De volgorde is 1 schaal · 2 dichtheid · 3 beweging · 4 vervorming · 5 kleur · 6 helderheid · 7 variatie · 8 ruimte.
Een macro beweegt één of meer acties op de bus (`links`: van, tot, kromme), zoals de rack-macro's. Je leert
één keer waar "ruimte" zit, en dat geldt daarna overal.

**Variëren** (`src/kern/opstelling/varieer.js`):
- *herrol*: nieuw zaad;
- *muteer*: een stap opzij, en soms één keuze opnieuw;
- *kruis*: half deze, half de vorige;
- *terug*: tot 32 stappen;
- *drift*: macro 7 laat de opstelling op de maatklok uit zichzelf bewegen, elke 4 maten een nieuw doel, glad ertussen;
- *genereer*: een **nieuw recept** uit de bouwdoos.

Bewaren maakt van een opstelling een nieuw recept. Zo groeit de verzameling.

Toeval komt alleen uit een zaad (`kern/opstelling/zaad.js`, per domein een eigen stroom), nooit uit
`Math.random`. Daardoor blijft alles herhaalbaar.

## De Tocht (het spel)

`src/kern/tocht/model.js` heeft 12 hoofdstukken:

1. eerste klank
2. acht knoppen
3. scenes
4. het zaad
5. muteren en terug
6. kruisen
7. laat hem los (variatie)
8. stems
9. focus
10. de bouwdoos
11. wat je mooi vindt
12. je eigen avond

Elk hoofdstuk heeft doelen die tellen wat **jij** op de bus doet (`BRONNEN_SPELER`: apc, maschine, toetsen,
scherm, hub). Wat de opstelling of de drift zelf doet, telt niet. Niets zit op slot: wie vooruit speelt, krijgt
dat later cadeau, en overslaan en terug kunnen altijd.

Onderweg worden alle ontdekkingen bewaard. Elke nieuwe handeling is een kaartje.

**Smaak** (`src/kern/tocht/smaak.js`) is een gewicht per kenmerk van een opstelling (recept, rack, instrument,
patroon, ladder, vorm):

| Wat je doet | Gewicht |
|---|---|
| bewaren | +3 |
| terughalen | +1 |
| elke 8 maten spelen | +0,25 |
| binnen 4 maten wegrollen | −0,4 |

Herrollen en genereren kiezen daarna **gewogen**: wat je mooi vindt komt vaker terug. In 25% van de keuzes
wordt zuiver verkend, en afkeer wordt nooit een verbod.

**Het einde** biedt twee wegen:
- **Spelen**: je verzameling (bewaarde en gemaakte recepten).
- **Bouwen**: de bouwwensen (`WENSEN` in `model.js`). Je stemt erop. **Claude leest
  `~/.varve/v2/instellingen/tocht.json` (`wensen`) als bouwopdracht.**

Data (niet in git, `VARVE_V2_DATA` = `~/.varve/v2`):

| Bestand in `instellingen/` | Inhoud |
|---|---|
| `tocht.json` | voortgang, ontdekt, einde, wensen |
| `smaak.json` | de smaak |
| `opstellingen-eigen.json` | je bewaarde recepten |

## De twee controllers

**APC40 mkII** houdt zijn DJ-indeling (`indelingen/apc40mk2.json`, ongewijzigd): de mixer, het overzicht.

**Maschine MK2** (nieuw in v2, via de AV-app-hub) speelt de opstelling (`indelingen/maschine-mk2.json`):

| Wat | Doet |
|---|---|
| draaiknop 1–8 | de acht macro's; één omwenteling = het hele bereik, SHIFT = fijn |
| pads 1–4 (onder) | stem zang · drums · bas · overig van de track met focus weg zolang je drukt; SHIFT = vast |
| pads 5–12 (midden) | scene 1–8 |
| pads 13–16 (boven) | nieuw zaad · muteer · kruis · terug |
| masterwiel | recept kiezen; indrukken of ENTER = laden (nieuw zaad) |
| ◄ ► bij het wiel | vorig / volgend recept |
| PLAY | alles starten op de volgende "1" |
| ERASE | patronen stil |
| AUTO | nieuw recept uit de bouwdoos |
| DUPLICATE | bewaren als recept |
| RESTART | nieuw zaad |
| ◄ ► transport | terug / muteer |
| groep A–H | focus op track 1–8 |
| CONTROL vasthouden | de opdracht van de tocht op de schermen |
| SHIFT + CONTROL | hoofdstuk overslaan |

De schermen tonen:
- **links**: het recept, macro 1–4 (naam, %, balk, een tweede streep = waar de drift hem nu heeft), het zaad en de toonsoort;
- **rechts**: wat het wiel kiest, macro 5–8 en de scenes.

Na een nieuw hoofdstuk tonen ze vier seconden de opdracht.

Code:
- `src/control/apparaten/maschine-mk2.js`
- `src/control/hub.js`: `speelt`, `speelPoort`, lampjes en schermen, hooguit één beeld per scherm per 40 ms
- `src/control/maschine-scherm.js`: uit v1, ongewijzigd
- `src/ui/opstelling.js`
- `src/ui/controllers.js`

## Starten (op de pc)

```bash
cd ~/Projecten/AV-app-hub-apparaten && node src/cli.js start                       # de hub: APC40 + Maschine
cd ~/Projecten/youtube-mixer/v2/app && VARVE_MEDIA=$HOME/.varve/pc-media node server.mjs   # v2 op :8780
```

Dan in Chrome: `http://localhost:8780/?hub=ws://127.0.0.1:7700/app`, en het tabblad **Opstelling**.

`~/.varve/pc-media` bevat:
- `library.db`: een kopie van de backup van 2 okt (10 nummers);
- links naar de mappen op de 2TB (`/mnt/hdd2tb-archief/01_PROJECTS/varve-dj/media`).

Die nummers hebben **geen stems**. De echte library staat op de Mac in `~/Varve-media` en zit niet in de
mac-spiegel.

## Wat er al was (de inventaris van 29 okt) en wat de bouwwensen zijn

Drie lees-agents liepen alle AV-repo's door. De bouwwensen in de tocht komen hieruit. De meeste waarde per
moeite:

**Geluid**
- **av-kern**: drone, pad, korrelwolk, resonator. Contract `init/update(p[8])` is gelijk aan het alfabet.
- **Strata** (`varve-site/strata-ambient/engine.js`, `createLive(recipe, ac)`): de sterkste generatieve
  logica (seed → genoom, Tonnetz, euclid, CA, Markov, evolve). Nodig: de uitgang omleiden en `step()` aan de maatklok.
- **elektronlearn**: plain ESM, PPQN 384, hash-kans per stap.
- **Waterschaal**: de modale Engine-klasse.
- **Werkbank**: `toeval.js` met sloten.

**Beeld**
- Een **generieke bronlaag** in `beeld/lagen.js`: `frame(t)` = elk canvas, met een vlag tegen `schoon()` en meer dan 2 plekken.
- Daarna Formula Lab (core + Renderer, mutatie gratis), AV-kern Veld en de Stroommachine als bronlaag.

**Niet porteerbaar** (alleen ideeën): Sediment-AU (C++), maschine-lab (Python), neural-loop en video-sonification.

## Bewust nog niet

- Druk (aftertouch) op de pads: de indeling geeft velocity en aftertouch nog niet door.
- Een opstellingslaag op de APC.
- Stems maken op de pc.
- Meer dan één vormlaag per recept.

Dit zijn allemaal bouwwensen in de tocht: Clay stemt, en de volgorde volgt de stemmen.

## Live (29 okt, later): gebaren, padstanden, partituur, glijden, morph

**Maschine.** Groep A–F kiest wat de pads doen: tik = wisselen, vasthouden = even kijken. SHIFT + groep A–H = focus.
In een padstand toont het rechterscherm de 16 pads met hun naam.

| Groep | Pads |
|---|---|
| A gebaren | vasthouden = effect, hoe harder hoe dieper (aanslag + aftertouch), loslaten = precies terug. Onder (1–4): echo · galm · dof · dun. Rij 2: stotter · zonder bas · weg · effect (de track met focus). Rij 3: alles dof · alles galm · alles echo · breuk (alles behalve de focus weg). Boven: alles dun · flits · zwart · stilte |
| B drums | zelf drummen op het drumspoor, met aanslag |
| C noten | 16 trappen van de toonladder van de opstelling, op het melodiespoor |
| D stems | 1–4 weg zolang je drukt, 5–8 weg/terug |
| E sampler | 1–8 sampler, SHIFT = leeg, 13/14 = korter/langer knippen |
| F basis | stems · scenes · zaad; SHIFT + scene-pad = in vier maten glijden |

**APC. USER = de partituur** (nog eens USER = je DJ-indeling terug).

| Knop | Doet |
|---|---|
| raster | kolom = spoor, rij 1 (onder) rustig tot 5 (boven) vol. Wit = speelt (pulseert op de tel), geel = wacht op de maat |
| scene-knoppen | een hele rij |
| SHIFT + scene | glijden naar recept-scene 1–5 |
| A\|B k | scene k is het eindpunt van de crossfader. De crossfader mengt van waar je was naar die scene |
| Clip Stop | spoor uit of aan op de maat |
| device-knoppen | de acht macro's (met ring) |
| PLAY | start |

Faders en filters blijven zoals altijd.

Code: `engine/acties-gebaren.js`, de partituur in `engine/acties-opstelling.js`, de varianten in
`kern/opstelling/realiseer.js`, en de gedragen `aanslag`/`druk` in `control/indeling.js`.

**Wat het waard is, beslist Clay na het spelen.** Wat niet werkt gaat eruit, wat werkt krijgt meer.

## Gebaren, ronde 2 (30 okt)

Clay vond de gebaren het interessantste deel. Daarom zijn ze uitgebouwd (`kern/opstelling/gebaren.js`,
`engine/acties-gebaren.js`):

- **Pad 1–8 zijn altijd gelijk:** echo · galm · dof · dun · stotter · zonder bas · weg · effect, voor het
  spiergeheugen. **Pad 9–16 zijn per recept** (`gebaren` in het recept). De generator kiest ze, gewogen op
  welke gebaren je vaak speelt (smaak `gebaar:<naam>`).
- **Nieuwe worpen:**
  - **opbouw**: rack Opbouw op alles, een riser;
  - **band** / **alles band**: Band zakt weg;
  - **wegspoelen**;
  - **oplossen**: dit doet de korrelwolk tot de granular sampler er is;
  - **bevries**: dieper drukken bevriest de wolk;
  - **echo vast** en **galm vast**: de worp gaat er meteen in, het droge geluid valt op de volgende tel weg;
  - **stilte**, **alles bas**, **flits** en **zwart**.
- **Combineren:** per parameter een stapel. Twee pads tegelijk geeft één gecombineerd gebaar, en de
  parameter gaat precies terug als de laatste los is.
- **Loslaten op de tel** staat standaard aan. GRID op de Maschine zet het aan of uit.

Nog niet mogelijk: een echte tape-stop en achteruit spelen. Daarvoor moet de afspeelmotor de snelheid tot 0
of negatief kunnen sturen.
