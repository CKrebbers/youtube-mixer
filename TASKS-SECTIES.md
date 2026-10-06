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
