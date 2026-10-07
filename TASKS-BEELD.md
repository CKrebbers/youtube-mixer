# TASKS — spoor beeld (studio/beeld, 6 okt 2026)

VARVE stuurt de Stroommachine (beeldmachine op de Omarchy-pc) via de Varve-relay
(poort 7702). Bron van waarheid: `~/Projects/stroommachine/koppel/` (PROTOCOL-dj.md,
varve-beeld-zender.js), sinds vandaag ook `github.com/CKrebbers/stroommachine` (privé).

**Basis** (`studio/integratie` 71e4450, gemeten vóór het werk): 58 bestanden,
6032 checks, 1 overgeslagen — 1 ROOD: `renderblok.test.mjs` (2 FAIL, de GC-metingen
"bytes per bericht"; omgeving, staat los van dit spoor).

## Stopcriterium
- [x] 1. Varve DJ stuurt via de relay klok, kenmerken, tracks en crossfader volgens
      PROTOCOL-dj.md; de echte Stroommachine (lokaal) toont "varvedj · volgt de klok · 124.0 BPM"
      (beeld-e2e.mjs)
- [x] 2. Een track laden geeft een eigen scène; de crossfader mengt en wisselt voorbij het midden
      (dom A → B bij 0 → 0,8; knoppen mengen mee; elk nummer zijn eigen label)
- [x] 3. APC-pagina "Beeld" bedient de Stroommachine-poorten (mapje device.beeld; macro.tint
      aangekomen in de e2e; niet op het apparaat nagelopen)
- [x] 4. Zonder relay-adres: niets (0 WebSockets, 0 fouten). Zonder relay: 0 fouten van onze
      code, één melding (info bij opstarten), geen regen. Chrome logt wel zelf elke mislukte
      poging (Log-domein, niet te onderdrukken; ~3 regels per poging, hooguit één poging per 10 s)
- [x] 5. alles.mjs 60 bestanden / 6286 checks / alles groen (basis 58 / 6032 / 1 rood);
      beeld.test 156, zendertest 21, headless 56/56, eind-tot-eind 29/29
- [x] 6. Review verwerkt (13 punten; zie hieronder); docs bij; commits op `studio/beeld`;
      niet samengevoegd

## Stappen
- [x] Stap 0: `koppel/PROMPT-varvedj-beeld.md` gecommit (0f4124e); `gh repo create
      CKrebbers/stroommachine --private --source . --push` gelukt
- [x] Stap 1: worktree `~/Projects/varve-stems/beeld`, tak `studio/beeld` van `studio/integratie` (71e4450); basis gemeten
- [x] Stap 2: gelezen (CLAUDE.md, APC40.md, actions, maat.js, router/luisteraar, engine, laden.js, hub.js)
- [x] 3a: zender ongewijzigd in `src/koppel/varve-beeld-zender.js` (+ herkomstregel), zijn test in `test/`, `alles.mjs` telt hem
- [x] 3b: `src/koppel/beeld.js` (BeeldKoppeling) + `hoorbareTel`/`engineTel` in maat.js + `bindBeeld` in actions.js
- [x] 3c: instelling en status (BEELD-rij, knop in de balk, Controlekamer-tegel)
- [x] 3d: APC-mapje beeld (Shift + Detail View)
- [x] 4.1 unit: `test/beeld.test.mjs`
- [x] 4.2 regressie
- [x] 4.3 headless: `tools/headless/beeld.mjs`
- [x] 4.4 eind-tot-eind: `tools/headless/beeld-e2e.mjs`
- [x] 5 review, docs, commits
- [x] push `studio/beeld` naar origin (gelukt, 7 okt)
- [x] samengevoegd (7 okt, op Clay's vraag): eerst `studio/integratie` (19e3a1f) in `studio/beeld`, drie
      doc-conflicten (CLAUDE.md, ROADMAP, HANDOFF) met beide kanten opgelost; daarna alles.mjs 62 / 6556
      groen, headless beeld 56, beeld-e2e 29, rijen 377, controle 26, sec-controle 23, sec-toets 43; dan
      `studio/beeld` in `studio/integratie` (sintegratie)

## Review (tweede agent, 6 okt)
- [x] 1 ernstig: een tweede tabblad zond ook (pong met een eigen klok, mix overschreven) → `magZenden`
- [x] 2 kenmerken stopten bij een pauze, de Stroommachine bevroor → door tot 1 s stil
- [x] 3 track verloren na een snelle herlaad → herladen zien aan de ping-teller, uitgesteld niet verloren
- [x] 4 voorbeluisteren met de fader dicht wisselde de scène → `kiesKant` met de fader
- [x] 5 rode melding bij elke sessie zonder pc → info als hij vanzelf startte
- [x] 6 terugspelen zette regie-schakelaars om → `beeld.regie.` in OVERSLAAN
- [ ] 7 herverbinden laadt de scène opnieuw → alleen aan haar kant op te lossen (vraag voor de Stroommachine)
- [x] 8 geblokkeerde poorten → geweigerd met een eigen reden
- [x] 9 getalveld hield de focus; macro zonder verbinding onthouden; macro's na herladen → opgelost
- [x] 10 toestand liep over een herstart; pageshow → opgelost
- [ ] 11 precisie (getOutputTimestamp, pos zonder latentie, crossfadercurve) → BEELD.md §7, VRAGEN BE10
- [ ] 12 zender: `stop()` zet `mixT` niet op 0 → vraag voor de Stroommachine (wij maken steeds een nieuwe)
- [x] 13 docs gecommit; BEELD.md §4 shift-modi verbeterd
