# Wachtrij van de werkruimte (14 okt 2026)

Eén spoor tegelijk na golf 3 (Clay: "Plaats ze in de wachtrij"). Elk spoor begint pas als het
vorige in `werkruimte/integratie` is samengevoegd en de hele suite groen is.

| # | spoor | wat | waar | stand |
|---|---|---|---|---|
| 1 | S6 + S7 (golf 3) | Maschine-delen · schermen en iPad (panelen voor elk onderdeel, per deel, XY-pad) | cloudsessies | S6 samengevoegd (14 okt, zonder conflicten; suite: alleen de drie bekende omgevingsfouten; verslag docs/verslagen/2026-10-14/werk-S6.md) · S7 samengevoegd (14 okt, zonder git-conflicten; twee botsingen hersteld: het deel FX van de voorbeelden wees naar "paneel:super" dat niemand maakt (nu de bouwsteen "fx"), en het werkvak liet op 1440×790 met een rij open de pagina scrollen (krimpt nu als eerste); het werkvak volgt F1–F8 van de Maschine (werk-maschine.mjs); suite: alleen de drie bekende omgevingsfouten; verslag docs/verslagen/2026-10-14/werk-S7.md) |
| 2 | S8 (golf 4) | schrijfweg iPad en iPhone (W1 = ja), XY-pad op de iPhone, inrichten zonder JSON, totaalmeting, docs | cloudsessie | samengevoegd (14 okt, fast-forward naar d82e3b1, zonder conflicten; niets hersteld: geen rode test door S8; suite: alleen omgevingsfouten die ook op d097a3e rood zijn (wachtrij "yt-dlp en zijn kind", renderblok "keylock met wissels", en instrumenten-fm-schaal "geen afval per blok", dat in deze container op beide kanten wisselt); headless werk-scherm 36/36, inrichten 15/15, werk-ipad 42/42 (de twee klokchecks van S7 wisselen onder load, ook op de basis), werk-alles: twee budgetten van C6 hier niet aangetoond (zoals S8 meldde; op de M1 meten); latentie: fader → geluid p50 0,4 ms, stijl in rust 30,8 ms/s; verslag docs/verslagen/2026-10-14/werk-int-S8.md) |
| 3 | S9 | snel een set klaarzetten, klaar-voor-de-set, live bijmixen op eigen tracks, lagen, live-stand (docs/PLAN-SET.md); plus SETS OPSLAAN EN TERUGLADEN (docs/werkruimte/S9-aanvulling.md) | cloudsessie session_01WViYRZRgCf8PhwKJqpTEsn (stilgezet, gaat verder) | **de volgende**: kan beginnen vanaf `werkruimte/integratie` (eerst `origin/werkruimte/integratie` bij zich samenvoegen; wat S8 open liet: docs/werkruimte/S8.md en docs/verslagen/2026-10-14/werk-S8.md §3) |
| 4 | S10 | 20+ nieuwe effect-sjablonen, modulators, meer mogelijkheden in de rack-editor, nieuwe effecttypes (docs/EFFECTEN-MEER.md) | cloudsessie session_01FmDfBrYsoGQiNiCFauRU4v (stilgezet, gaat verder) | wacht op 3 |
| 5 | S11 | categorieën en tags in de library: eigen kratten, vrije tags, slimme categorieën, snel vinden, overal (Maschine, iPad, set uit een categorie) — opdracht in docs/werkruimte/S11.md | nog te starten in een cloudsessie | wacht op 4 |

Clay's afspraken voor elk spoor: hij maakt zelf de knoppenverdeling, de schermen en panelen, en de
effecten en combinaties; agenten bouwen het mechaniek als data, met hooguit één voorbeeld per soort.
De iPad en iPhone mogen bedienen (W1, 14 okt). Een spoor dat verdergaat, voegt eerst
`origin/werkruimte/integratie` bij zichzelf samen.
