# Design (v2, Hybride)

## Kleurtaal: op de controllers en op het scherm hetzelfde

| Kleur | Betekenis | APC-palet (`control/apparaten/apc40mk2.js` KLEUR) |
|---|---|---|
| Blauw | klank: bronnen, beweging, instrumenten | `blauw`, half `hemelsblauw`, leeg `blauwdonker` |
| Oranje | beeld | `oranje`, half `geel`, leeg `oranjedonker` |
| Wit | tijd: momenten, takes, de tel | `wit`, leeg `donkergrijs` |
| Paars | navigatie en patch | `violet`, half `violetdonker` |

- **Helderheid is stand:** vol = actief, de donkere tint = gevuld of half, donkergrijs = leeg maar bruikbaar, uit = er is niets.
- **Knipperen alleen op de tel** (lampjes.js `tel: 'aan'`), nooit als versiering.

## Esthetiek

- **Wel:** glitch en pixel; harde randen; monospace voor getallen; donker vlak met één warm wit voor de klok. De schermen van de Maschine zijn 1-bit (256 × 64) en dat is de maat voor alles: als het daar niet past, is het te veel.
- **Niet:** gradiënten, glassmorphism, Inter, ronde kaartjes, schaduwen.
