# Kaartje (oogst uit v1)

Eén bestand per onderwerp: `v2/oogst/<onderwerp>.json` = `{ "onderwerp", "samenvatting", "kaartjes": [...], "onderdelen": [...] }`.

## kaartje
| veld | wat |
|---|---|
| `id` | `<onderwerp>-NNN`, vast, nooit hergebruiken |
| `titel` | ≤ 80 tekens, Nederlands |
| `soort` | `regel` (architectuurregel) · `besluit` (keuze met alternatief) · `meting` (gemeten feit, getal) · `valkuil` (ging al eens mis) · `contract` (formaat/interface) · `grens` (bewust niet / bekende beperking) · `pijn` (wat schuurt in v1, ontwerpschuld) · `open` (open vraag aan Clay) |
| `wat` | 1–3 zinnen: de kennis zelf, zelfstandig te lezen |
| `waarom` | de reden of het bewijs (meting, incident, datum) |
| `bron` | `[{ "pad": "docs/X.md", "waar": "§3 / regel 120-140" }]` |
| `code` | paden in v1 waar het woont (mag leeg) |
| `pijler` | `dj` · `produceren` · `programmeren` · `instellen` · `beeld` · `controllers` · `systeem` (VISIE §2) |
| `gewicht` | `kern` (v2 werkt niet zonder) · `belangrijk` · `detail` |
| `voorstel` | `houden` (zo mee naar v2) · `anders` (idee meenemen, vorm anders) · `weg` (niet in v2) · `open` (Clay moet kiezen) |
| `reden` | waarom dat voorstel, 1–2 zinnen |

## onderdeel (code die mogelijk ongewijzigd mee kan)
`{ "pad", "regels", "puur": bool, "imports": [...], "tests": [...], "voorstel": "overnemen|herschrijven|weg", "reden" }`
