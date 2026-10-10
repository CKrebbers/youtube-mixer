/**
 * Sampler-pad → drumpad (crossover, docs/INSTRUMENTEN.md "Uit de sampler"), zonder
 * afhankelijkheden: actions.js her-exporteert het, en apc-beschrijf.js (ook op de
 * losse APC-kaartpagina) leest het zonder de hele engine mee te laden.
 *
 * Sampler-pad N (index N − 1) → drumpad op de Drums: dezelfde fysieke pad als in de
 * padmodus sampler van de Maschine (maschine.js samplerPad: bovenste rij 13–16 =
 * sampler-pad 1–4, tweede rij 9–12 = 5–8). Zo knip je en sla je aan met dezelfde vinger.
 */
export const DRUMPAD_VAN_SAMPLER = Object.freeze([13, 14, 15, 16, 9, 10, 11, 12]);

/** De noot van drumpad p (1..16): pad 1 = 36, zoals de Drums (drums.js EERSTE_NOOT). */
export const drumpadNoot = (p) => 35 + p;

const NOOTNAMEN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** MIDI-noot als naam (48 = C3), zoals de Maschine en het schermklavier. Eigen kopie: maschine.js importeert uit actions.js. */
export const nootNaamDrum = (k) => `${NOOTNAMEN[((k % 12) + 12) % 12]}${Math.floor(k / 12) - 1}`;
