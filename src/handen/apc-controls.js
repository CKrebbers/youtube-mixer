/**
 * De 148 controls van de APC40 mkII zoals de AV-app-hub ze noemt
 * (AV-app-hub/src/devices/apc40mk2.js, `CONTROLS`; dezelfde id's als av-kern).
 * Een ingebakken kopie, zodat de handenkaart ook zonder de hub-repo werkt;
 * test/handen.test.mjs vergelijkt hem met het origineel als dat er is
 * (VARVE_HUB_REPO, standaard ../av-app-hub of ~/Projects/AV-app-hub).
 * Puur data, in dezelfde volgorde en met dezelfde opbouw als in de hub.
 *
 * Let op de rijen: de hub telt de grid VAN ONDER (`pad1-x` = onderste rij,
 * noot 0–7), Varve VAN BOVEN (rij 1 = bovenste, noot 32–39). De kaart spreekt
 * altijd Varve-taal en zet de hub-id erachter: rij 1 · kolom 3 (pad5-3).
 *
 * `t`/`n`/`ch` zijn type, nummer en kanaal; Varve's signature is `t:ch:n`.
 */
export const APC_CONTROLS = [];
const K = (id, soort, t, n, ch, label) => { APC_CONTROLS.push(Object.freeze({ id, soort, t, n, ch, label })); };

for (let r = 1; r <= 5; r++) for (let c = 1; c <= 8; c++) K(`pad${r}-${c}`, 'pad', 'note', (r - 1) * 8 + (c - 1), 0, `pad ${r}·${c}`);
for (let r = 1; r <= 5; r++) K(`scene${r}`, 'scene', 'note', 81 + r, 0, `scene ${r}`);
for (let c = 1; c <= 8; c++) {
  K(`rec${c}`, 'knop', 'note', 48, c - 1, `rec arm ${c}`);
  K(`solo${c}`, 'knop', 'note', 49, c - 1, `solo ${c}`);
  K(`act${c}`, 'knop', 'note', 50, c - 1, `activator ${c}`);
  K(`sel${c}`, 'knop', 'note', 51, c - 1, `track select ${c}`);
  K(`stop${c}`, 'knop', 'note', 52, c - 1, `clip stop ${c}`);
  K(`ab${c}`, 'knop', 'note', 66, c - 1, `A|B ${c}`);
  K(`fader${c}`, 'fader', 'cc', 7, c - 1, `fader ${c}`);
  K(`dk${c}`, 'draai', 'cc', 15 + c, 0, `device knop ${c}`);
  K(`tk${c}`, 'draai', 'cc', 47 + c, 0, `track knop ${c}`);
}
const LOS = [
  ['devL', 'knop', 'note', 58, '◄ device'], ['devR', 'knop', 'note', 59, 'device ►'],
  ['bankL', 'knop', 'note', 60, '◄ bank'], ['bankR', 'knop', 'note', 61, 'bank ►'],
  ['devOn', 'knop', 'note', 62, 'device on/off'], ['lock', 'knop', 'note', 63, 'device lock'],
  ['clipdev', 'knop', 'note', 64, 'clip/device view'], ['detail', 'knop', 'note', 65, 'detail view'],
  ['mastersel', 'knop', 'note', 80, 'master'], ['stopall', 'knop', 'note', 81, 'stop all clips'],
  ['pan', 'knop', 'note', 87, 'pan'], ['sends', 'knop', 'note', 88, 'sends'], ['user', 'knop', 'note', 89, 'user'],
  ['metro', 'knop', 'note', 90, 'metronome'], ['play', 'knop', 'note', 91, 'play'],
  ['record', 'knop', 'note', 93, 'record'],
  ['up', 'knop', 'note', 94, '▲'], ['down', 'knop', 'note', 95, '▼'],
  ['right', 'knop', 'note', 96, '►'], ['left', 'knop', 'note', 97, '◄'],
  ['shift', 'knop', 'note', 98, 'shift'], ['tap', 'knop', 'note', 99, 'tap tempo'],
  ['nudgeM', 'knop', 'note', 100, 'nudge −'], ['nudgeP', 'knop', 'note', 101, 'nudge +'],
  ['session', 'knop', 'note', 102, 'session record'], ['bank', 'knop', 'note', 103, 'bank'],
  ['master', 'fader', 'cc', 14, 'master fader'], ['xf', 'fader', 'cc', 15, 'crossfader'],
  ['tempo', 'rel', 'cc', 13, 'tempo'], ['cue', 'rel', 'cc', 47, 'cue level'],
  ['voet', 'voet', 'cc', 64, 'footswitch'],
];
for (const [id, soort, t, n, label] of LOS) K(id, soort, t, n, 0, label);
Object.freeze(APC_CONTROLS);
