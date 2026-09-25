# Verslagen van 25 september 2026

De eindverslagen van de agenten die op 24–25 sep parallel bouwden, controleerden
en samenvoegden. Bewaard omdat de scratchpad van de sessie verdwijnt. De
conclusies staan al in `CLAUDE.md`, `docs/HANDOFF.md`, `docs/VRAGEN.md` (blok J)
en `docs/VERBETERINGEN.md` (ronde 4); hier staan de details: metingen, afwegingen,
wat niet getest is, en waarom iets NIET hersteld is.

Werkwijze per spoor: een bouwer (`<spoor>.md`, of `.json` bij de eerste vier),
daarna een controleur die herstelde (`controle-<spoor>.md`), daarna
integratierondes (`integratie-r*.md`). De rest-punten (`rest-*.md`) kwamen uit
de controles.

| Spoor | ROADMAP | Bouwer | Controle |
|---|---|---|---|
| Toonsoort, server | 14 | `toon-server.json` | `controle-toonsoort.md` (samen) |
| Toonsoort, scherm | 14 | `toon-scherm.json` | `controle-toonsoort.md` |
| Toonsoort, tweede kandidaat | 14 | `rest-toon-tweede.md` | — |
| Mapping als verschil | 13 | `mapping-verschil.json` | `controle-mapping-verschil.md` |
| Library | 21 | (verslag verloren) | `controle-library.md` |
| Ingest-wachtrij | 21 | `ingest-wachtrij.md`, `rest-ingest.md` | `controle-ingest-wachtrij.md` |
| Beamer | 18 | `beamer.md`, `rest-beamer-inloop.md` | `controle-beamer.md` |
| Handelingenlog | 20 | `handelingenlog.md` | `controle-handelingenlog.md` |
| Audiopad (renderBlok) | 22 | `renderblok.md` | `controle-renderblok.md` |
| DJ-transport | 16 | `dj-transport.md`, `rest-transport.md` | `controle-dj-transport.md` |
| DJ-klank (kill, rem, hysterese) | 16 | `dj-klank.md` | `controle-dj-klank.md` |
| Overgangen als hellingen | 16 | `rest-fx-hellingen.md` | — |
| APC-indeling voorstel A | 16 | `apc-indeling.md` | (in `integratie-r4b.md`) |
| Beatgrid-restpunten | 24 | `beatgrid-rest.md` | `controle-beatgrid-rest.md` |
| Grid moet passen per stuk | 24 | `rest-grid-past.md` | `controle-grid-past.md` |
| Vormen 16:9 | 7 | `vormen-basis.json`, `vormen-licht/-zwaar/-meer/-isomorf.md` | `controle-vormen.md` |
| Vormen: tijdchecks | 7 | `rest-vormen-tijd.md` | — |
| Vormbronnen (klap, tel) | 23 | `vorm-bronnen.md` | `controle-vorm-bronnen.md` |

Integratie: `integratie-r1.md` (toonsoort, mapping, library) → `r2` (renderblok,
vormbronnen, beamer, handelingenlog, ingest) → `r3` (beatgrid-rest, vormen,
dj-transport, dj-klank) → `r4a` (vijf rest-punten) → `r4b` (beamer-inloop,
APC-indeling, docs) → `controle-grid-past.md` (r5). Alles staat op `main`.

Paden in deze verslagen naar `scratchpad/…` (proefscripts, schermafdrukken)
bestaan niet meer; de proeven die bleven staan in `tools/headless/` en
`tools/beatmeting/rest/`.
