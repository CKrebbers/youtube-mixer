# Varve v2: het plan

v1 blijft het speelinstrument. Deze map is het plan voor v2: eerst alles weten en besluiten, dan
bouwen in plakken die elk speelbaar zijn en op de hardware geproefd worden.

| Wat | Waar |
|---|---|
| Clay's eigen woorden (gaan voor alles) | `WENSEN.md` |
| De oogst uit v1: 664 kaartjes in 8 onderwerpen | `oogst/<onderwerp>.json`, formaat in `oogst/SCHEMA.md` |
| Wat de handen echt doen (27 logs, 62.282 handelingen) | `telling/nu.md`; opnieuw tellen op de Mac: `telling/LEESMIJ.md` |
| De beslispagina | https://claude.ai/artifact/8fQGLqLxNVqRyXGqhKVEBu (bron `pagina/index.html`) |

Na een wijziging in `oogst/`, `telling/` of `WENSEN.md`: `node v2/bouw-kaartjes.mjs` en de pagina
opnieuw publiceren. Clay's keuzes staan in de database van de pagina (collectie `keuzes`, één
document per kaartje-id: `keuze`, `notitie`, `t`); Claude leest ze daar terug.

## Stappen
1. Oogsten en tellen — klaar (19 okt).
2. Clay kiest per kaartje, te beginnen bij `kern` en `open` (filter op de pagina).
3. Architectuur v2: contracten (maatklok, bus, staat, track, module, controller, scherm), datamodellen,
   wat ongewijzigd mee kan (`onderdelen` per onderwerp).
4. Bouwvolgorde in plakken; per plak de v1-tests van dat onderwerp als acceptatie.
