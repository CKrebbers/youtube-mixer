# TASKS — secties (studio/secties, 6 okt 2026)

Stopcriterium van deze run: secties per nummer berekend op het grid, zichtbaar boven de
golfvorm, als grid-modus SECTIES op de APC, tests groen. Daarna: Clay probeert.

## Gedaan
- [x] Worktree `~/Projects/varve-stems/secties`, tak `studio/secties` van `studio/integratie` (1770922)
- [x] Rekenwerk `server/secties.js` (maten, kenmerken, nieuwheid, grenzen, groepen, labels) + synthetische metingen
- [x] Worker `maakSecties`, schema v9 `secties_json`, `GET /api/library/<id>/secties?maak=1`, achtergrond
- [x] Engine: `SectieKaart`, `sectieDoel` (aanloop, valt in op de "1"), `deck.naarSectie`, `sectieOpDeMaat`
- [x] Bus: `track.N.section.1–40`, `.loop`, `.next/.prev`, meldingen zonder kaart
- [x] APC: grid-modus SECTIES (Shift + scene 1), 82 regels, `eerder` bijgewerkt, kleuren
- [x] Scherm: strook boven het overzicht, sectienamen op de pads van het scherm-als-APC
- [x] Tests: `test/secties.test.mjs` (59+ checks), bestaande tests bijgewerkt waar ze modi/regels tellen
- [x] Headless in echte Chrome: `tools/headless/secties.mjs` groen
- [x] Review door een tweede agent: 7 bevindingen, 1–7 verwerkt (opmaat-sprong, lus bij onleesbare
      stems en korte nummers, aanloop over een stukgrens, lege maten, race bij opnieuw binnenhalen,
      >26 groepen, achtergrondlus robuust)
- [x] Docs: `docs/SECTIES.md`, CLAUDE.md, ROADMAP 28, HANDOFF, VRAGEN blok SE, speellijst blok Secties

## Open (Clay)
- [ ] `git push -u origin studio/secties` op de Mac (de sessie kon niet bij GitHub)
- [ ] Speellijst blok "Avond 1 · Secties" op de APC, dan VRAGEN SE1–SE6
- [ ] Na het oordeel: samenvoegen in `studio/integratie`

## Gevonden, niet gedaan
- [ ] De ingest legde de "1" van het synthetische nummer een tel te vroeg: de secties volgen het grid (SECTIES.md §2)
- [ ] Groepskleuren op de APC-pads (SE4); met de hand bewerken (SE5); all-in-one-infer als labelbron (SE6)
- [ ] In deze VM rood, ook zonder deze tak (omgeving): ingest (geen yt-dlp), master/renderblok/instrumenten-fm-schaal (GC-metingen)

---

# Verweven (6 okt, avond): de secties in de rest van VARVE

Opdracht van Clay (6 okt): elk onderdeel dat iets met de vorm van een nummer doet,
gebruikt de secties. Stopcriterium: de MOET-punten gebouwd, elk met een test die eerst
faalde, `node test/alles.mjs` niet roder dan de basis, een headless-check per onderdeel
groen, docs bij. KAN alleen met tijd over; wat blijft liggen gaat naar VRAGEN.

**Basis** (`studio/integratie` 5ef02f6, gemeten vóór het werk): 55 bestanden, 5759 checks,
0 rood. Let op: `renderblok` (GC-meting) kan onder zware belasting wisselen; los draaien.
Reservetak: `backup/integratie-voor-sec-geheel`.

## Inventaris (per plek: nu · erbij · risico)

**Waar de kaart is.** `engine.snapshot()` geeft per deck `secties` (de stukken) en `sectie`
(de index die je hoort). De automaat leest `engine.deck(id)` direct (`deck.sectieKaart`).
De planner (`src/auto/planner.js`) werkt puur op library-tracks uit `/api/library`, en
daar zitten de secties bewust niet in. De kaart komt alleen via
`GET /api/library/<id>/secties?maak=1`; `laden.js` haalt hem NA het laden op, zonder te
wachten → RACE in de automaat en bij terugspelen.

1. **Auto-DJ, `planner.js`.**
   - **Nu:** `planMoment` legt de frasegrens op 16 maten vanaf het maat-anker; is dat te laat, dan op 4 maten. `fragment` bepaalt het beginpunt uit toon- en gridstukken, met toeval.
   - **Erbij:**
     - `planMoment({…, grenzen})` met de sectiebegins van de uitgaande (outro, break);
     - `fragment(track, { secties })` met als in-punt de intro of een sectiegrens;
     - zonder kaart precies het oude gedrag;
     - de bewakers (`kiesOvergang`) blijven boven alles gaan.
   - **Risico:** `auto.test` pint het oude gedrag (`start===160`, 4/16 maten, `tel%64`).
2. **Auto-DJ, `automaat.js`.**
   - **Nu:** `OVERNEEM` kent `section.*` niet. `_bereidVoor` laadt het nummer en zoekt met een seek-fractie.
   - **Erbij:**
     - `section.*` in `OVERNEEM`;
     - een sectiesprong in fase `klaar` laat de overgang opnieuw plannen;
     - de kaart van de inkomende ophalen en erop wachten (race).
   - **Risico:** de overname-proeven in `auto.test` (477-502).
3. **Planvenster, `src/plan/` en `server/plannen.js`.**
   - **Nu:** een stap heeft `{id, track, van, speelduur, overgang, lengte, waarom, notitie, door}`; onbekende velden vallen weg. De 409 vergelijkt de hash van het bestand.
   - **Erbij:**
     - optioneel `in`/`uit: { sectie, label, groep }` (`van` blijft de waarheid en de terugval);
     - `normaliseerPlan`, `pak`, `verschil` en `vervangPlan`;
     - de strook met sectiebanden;
     - het venster haalt de secties per stap ZONDER `maak=1`.
   - **Risico:**
     - een oud open venster dat opslaat, gooit de nieuwe velden weg (de 409 dekt alleen gelijktijdig werk);
     - `plan.test` pint de veldlijsten;
     - `plan-model.js` is de enige import van de server uit `src/`.
4. **Handelingenlog en terugspelen.**
   - **Nu:**
     - `OVERSLAAN` laat `section.*` door;
     - `NUMMER_NODIG` kent `section.` niet: zonder het nummer van toen springt hij in iets anders;
     - de beginstand en de gebeurtenissen kennen geen sectiekaart;
     - terugspelen haalt de kaart van NU.
   - **Erbij:**
     - `section.` in `NUMMER_NODIG`;
     - een gebeurtenis `secties` (zoals `grid`);
     - de kaart in de beginstand;
     - bij terugspelen de kaart uit het log, en niet die van de server.
   - **Risico:** `tikMs` (~10 ms): een druk net vóór de "1" kan een maat later landen.
5. **Toetsenbord, `keyboard.js`.**
   - **Nu:** alle letters en cijfers zijn bezet. `SHIFT_VARIANT` werkt per action, niet per toets.
   - **Vrij met shift:** links W/E/C/1-5/`, rechts O/I/N/7-0/-/=.
   - **Erbij:** Shift+W/E = vorige/volgende sectie (links), Shift+I/O = vorige/volgende (rechts), via een shift-tabel per TOETS; de helpkaart (`index.html` #help).
   - **Risico:** `engine.test` pint dat elke toets een bestaande action is.
6. **Sampler, `src/engine/sampler.js`.**
   - **Nu:** `knipBereik(grid, positie, tellen)` knipt op de TEL (tot = de laatste hele tel), met `deck.position`. Afspelen start op de volgende tel (`startOpDeTel`).
   - **Erbij:**
     - een pure `knipSectie` (van = de "1" van de sectie, tot = het volgende begin);
     - een eigen action;
     - de bestaande opslag per nummer.
   - **Risico:**
     - geheugen: ~23 MB per minuut per pad;
     - starten op de tel in plaats van op de "1" (`fxKlok` kent geen maatfase);
     - geen nieuwe waarde in `TELLEN` (de read en de rondloper in het log).
7. **Vormen, `router.js` en `maat.js`** (KAN).
   - **Erbij:** `sectie.energie` en `sectie.nieuw` zoals `maatklap`.
   - **Risico:** `analyse.test` pint de bronnenlijst; `lees` draait elk beeld en mag geen afval maken.
8. **Video-puls** (KAN).
   - **Risico:** geen nieuw `PULS_DOEL`: dat is een rondloper in het log, en `video.test` pint de lijst.
9. **Maschine** (KAN).
   - **Erbij:** SCENE als padmodus (zoals STEP).
   - **Risico:** de vertakking op `inst`; `maschine.test` pint de schermbytes.
10. **Controlekamer** (KAN).
    - **Erbij:** een route `GET /api/secties` (tellen in SQL of gecachet, niet elke 2 s alles) en een pure tegel.
    - **Risico:** `controle.test`.
11. **AV-app-hub** (KAN).
    - **Nu:** het protocol kent geen globale waarde van app naar hub.
    - **Erbij:** eerst `PROTOCOL.md` en de conformiteitstoets; een PR in de andere repo.

## Keuzes (vooraf, voor alle sporen)

- **Docs die iedereen raakt** (SECTIES.md §7, CLAUDE.md "Secties", HANDOFF, ROADMAP 28, VRAGEN, speellijst): de sporen leveren tekst aan, de coördinator voegt hem in. Eigen docs (AUTO-DJ.md, de helpkaart, …) doet het spoor zelf.
- **`section.K.loop` in de beginstand?** Nee, niet apart. Een sectie-loop is een gewone loop van het deck, en `loop: {start, end, tellen}` staat al in de beginstand per track. Wat er wel bij moet: de sectiekaart zelf, anders betekent `section.5` na een herberekening iets anders.
- **OVERNEEM** (punt 2) gaat in het spoor auto, niet in het spoor log: beide raken `automaat.js`.

## Sporen (elk een worktree in ~/Projects/varve-stems/, van studio/integratie)

| spoor | tak | wat | poorten headless |
|---|---|---|---|
| auto | `studio/sec-auto` | 1, 2 (planner, automaat, OVERNEEM, AUTO-DJ.md) | 8901/9501 |
| plan | `studio/sec-plan` | 3 (planvenster, plan-model, server/plannen.js) | 8903/9503 |
| log | `studio/sec-log` | 4 (handelingen, terugspelen, logboek, laden bij terugspelen) | 8905/9505 |
| toets | `studio/sec-toets` | 5 (keyboard, helpkaart) | 8907/9507 |
| sampler | `studio/sec-sampler` | 6 (sampler, action, opslag) | 8909/9509 |

Daarna, als er tijd is: vormen/router (7), Controlekamer (10), video (8), Maschine (9), AV-app-hub (11).
