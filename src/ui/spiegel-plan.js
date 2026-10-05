import { resolveTarget } from '../control/mapping.js';
import apc from '../control/devices/apc40mk2.js';
import { beschrijf } from './apc-beschrijf.js';

/**
 * Het hoofdscherm als spiegel van de APC40 mkII: WELKE fysieke control waar
 * staat, en wat hij NU doet. Puur rekenwerk, geen DOM — de test draait dit in
 * Node tegen de echte standaardmapping.
 *
 * Wat een knop doet komt nergens anders vandaan dan uit de mapping, via
 * dezelfde `Mapping.kies()` die ook een MIDI-bericht afhandelt (shift en het
 * open mapje tellen dus mee). Pas je de mapping aan, dan verhuist het scherm mee.
 */

// ---- de linkerhelft: acht kolommen -----------------------------------------

/**
 * Eén kolom van de APC, van boven naar onder, zoals op de Features-tekening
 * (User Guide p4): track knob · vijf grid-pads · Clip Stop · Track Select ·
 * 2×2 [Activator | A/B] boven [Solo | Rec Arm] · fader. `kolom` is 1..8.
 */
export function kolomControls(kolom) {
  const ch = kolom - 1;
  return [
    { rol: 'knob', sig: `cc:0:${47 + kolom}`, soort: 'knob' },
    ...[1, 2, 3, 4, 5].map((rij) => ({ rol: `pad${rij}`, sig: `note:0:${apc.gridNote(kolom, rij)}`, soort: 'pad' })),
    { rol: 'stop', sig: `note:${ch}:52`, soort: 'knop' },
    { rol: 'select', sig: `note:${ch}:51`, soort: 'knop' },
    { rol: 'activator', sig: `note:${ch}:50`, soort: 'mini' },
    { rol: 'ab', sig: `note:${ch}:66`, soort: 'mini' },
    { rol: 'solo', sig: `note:${ch}:49`, soort: 'mini' },
    { rol: 'arm', sig: `note:${ch}:48`, soort: 'mini' },
    { rol: 'fader', sig: `cc:${ch}:7`, soort: 'fader' },
  ];
}

// ---- de rechterhelft: het focusdeel ----------------------------------------

/** De kolom tussen grid en rechterdeel: scene launch 1-5, Stop All, Master, Cue Level, masterfader. */
export const SCENES = [1, 2, 3, 4, 5].map((s) => ({ rol: `scene${s}`, sig: `note:0:${81 + s}`, soort: 'scene' }));
export const MASTERKOLOM = [
  { rol: 'stopall', sig: 'note:0:81', soort: 'knop' },
  { rol: 'master', sig: 'note:0:80', soort: 'knop' },
  { rol: 'cuelevel', sig: 'cc:0:47', soort: 'knob' },
  { rol: 'masterfader', sig: 'cc:0:14', soort: 'fader' },
];

/**
 * Het blok rechtsboven, drie rijen: [Pan Play Record Session] /
 * [Sends Metronome Tap] / [User Nudge− Nudge+], met de tempoknop rechts over
 * rij 2 en 3.
 */
export const TRANSPORT = [
  [87, 91, 93, 102], [88, 90, 99], [89, 100, 101],
].map((rij) => rij.map((n) => ({ rol: `n${n}`, sig: `note:0:${n}`, soort: 'knop' })));
export const TEMPO = { rol: 'tempo', sig: 'cc:0:13', soort: 'knob' };

/** Device knobs 2×4: rij 1 = knob 1-4, rij 2 = knob 5-8. */
export const DEVICE_KNOBS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ rol: `dev${i + 1}`, sig: `cc:0:${16 + i}`, soort: 'knob' }));

/** Onder de device knobs: [Device◀ Device▶ Bank◀ Bank▶] / [On/Off Lock Clip/Dev Detail]. */
export const DEVICE_KNOPPEN = [[58, 59, 60, 61], [62, 63, 64, 65]]
  .map((rij) => rij.map((n) => ({ rol: `n${n}`, sig: `note:0:${n}`, soort: 'knop' })));

/** Linksonder de pijlen (▲ ◀ ▶ ▼), rechts daarvan Shift en Bank. */
export const PIJLEN = [
  { rol: 'op', sig: 'note:0:94', soort: 'pijl', teken: '▲' },
  { rol: 'links', sig: 'note:0:97', soort: 'pijl', teken: '◀' },
  { rol: 'rechts', sig: 'note:0:96', soort: 'pijl', teken: '▶' },
  { rol: 'neer', sig: 'note:0:95', soort: 'pijl', teken: '▼' },
];
export const SHIFT = { rol: 'shift', sig: 'note:0:98', soort: 'knop' };
export const BANK = { rol: 'bank', sig: 'note:0:103', soort: 'knop' };
export const CROSSFADER = { rol: 'xfader', sig: 'cc:0:15', soort: 'xfader' };

/** Alles wat het focusdeel spiegelt, plat. */
export const FOCUSDEEL = [...SCENES, ...MASTERKOLOM, ...TRANSPORT.flat(), TEMPO,
  ...DEVICE_KNOBS, ...DEVICE_KNOPPEN.flat(), ...PIJLEN, SHIFT, BANK, CROSSFADER];

/** Alle gespiegelde controls: acht kolommen en het focusdeel. */
export const ALLE = [...[1, 2, 3, 4, 5, 6, 7, 8].flatMap(kolomControls), ...FOCUSDEEL];

// ---- wat een control nu doet -----------------------------------------------

/** Kleur per grid-mapje, zoals de LED's op de APC (docs/APC40.md). */
export const MODUS_KLEUR = { hotcues: 'geel', loops: 'cyaan', sampler: 'violet', video: 'blauw', klank: 'magenta', auto: 'limoen', stems: 'zeegroen' };

/** De naam van de fysieke control, uit het device-profiel. */
export const naamVan = (sig) => apc.label(sig) ?? sig;

/**
 * Wat deze control nu doet, volgens de mapping.
 *
 * @param mapping  een Mapping (kies(), vars())
 * @param sig      de signature van de control, zoals het apparaat hem stuurt
 * @param shift    staat shift nu ingedrukt (de APC-shift, niet het toetsenbord)
 * @param vars     { focus: <tracknummer> } voor `{focus}` in een action
 * @returns null als hij niets doet, anders
 *   { action, actionShift, regel, modus, kort, lang, titel, lamp, lampOm }
 *   `actionShift` is wat shift+klik op het scherm doet (null als dat hetzelfde is).
 *   `modus` is het grid-mapje waar deze regel bij hoort (hotcues/loops/…), of null.
 *   `lamp` is de action waarvan het lampje de stand toont (`led.lees` in de
 *   regel, anders de action zelf), `lampOm` = omgekeerd (`led.invert`): zoals
 *   de LED op de APC. Scene 5 blijft in de modus klank "loop weg", maar zijn
 *   lampje zegt "klank open".
 */
export function leesControl(mapping, sig, { shift = false, vars = {} } = {}) {
  const regel = mapping.kies(sig, { shift });
  if (!regel || regel.action === 'shift') return null;
  const action = resolveTarget(regel.action, vars);
  const metShift = mapping.kies(sig, { shift: true });
  const actionShift = metShift && metShift !== regel ? resolveTarget(metShift.action, vars) : null;
  const b = beschrijf(action);
  const modus = modusVan(regel, action);
  const titel = `APC: ${naamVan(sig)} — ${b.lang}`
    + (actionShift && actionShift !== action ? ` · met shift: ${beschrijf(actionShift).lang}` : '');
  const lamp = regel.led?.lees ? resolveTarget(regel.led.lees, vars) : action;
  return { action, actionShift: actionShift !== action ? actionShift : null, regel, modus, kort: b.kort, lang: b.lang, titel,
    lamp, lampOm: !!regel.led?.invert };
}

/**
 * Bij welk grid-mapje hoort deze regel? De pad-regels dragen het in hun
 * `laag`; een kiesknop (`layer.grid.loops`) krijgt de kleur van zijn mapje.
 */
export function modusVan(regel, action) {
  const m = /^grid\.(\w+)$/.exec(regel?.laag ?? '') || /^layer\.grid\.(\w+)$/.exec(action ?? '');
  return m && MODUS_KLEUR[m[1]] ? m[1] : null;
}

/**
 * Korte tekst voor op een pad of kolomknop: het tracknummer staat al boven
 * de kolom, dus "3·cue 1" wordt "cue 1".
 */
export const kortInKolom = (kort) => String(kort).replace(/^(\d|F)·/, '');

/**
 * Hoe een knop oplicht, uit `read(action)`: 'aan' (vol), 'half' (gevuld,
 * bijvoorbeeld een sampler-pad die klaarstaat), 'uit', of null als de action
 * niets terug te lezen heeft.
 */
export function lichtVan(v) {
  if (v === null || v === undefined) return null;
  if (v >= 0.99) return 'aan';
  if (v > 0.01) return 'half';
  return 'uit';
}

// ---- vensters als model ----------------------------------------------------

/**
 * Er zijn geen twee vensters meer op het scherm, maar het toetsenbord
 * ({L}/{R}), `window.L/R.show.N`, video en racks rekenen er nog mee. Nieuwe
 * betekenis: L = de track met focus, R = de track waar je daarvoor op zat.
 *
 * Geeft een NIEUW object terug (of hetzelfde als er niets verandert).
 */
export function volgFocus(venster, focus) {
  if (!focus || venster.L === focus) return venster;
  return { L: focus, R: venster.L };
}

/**
 * `window.R.show.N`: zet N als "tweede" (de rechterhand op het toetsenbord).
 * De track met focus kan niet ook de tweede zijn; dan verandert er niets.
 */
export function zetTweede(venster, deckId) {
  if (!deckId || venster.L === deckId || venster.R === deckId) return venster;
  return { L: venster.L, R: deckId };
}

// ---- de kolomkop: tijd, bpm, crossfaderkant ---------------------------------

/** Onder dit aantal seconden resterend knippert de tijd rood (als de track speelt). */
export const BIJNA_EINDE = 30;

/**
 * Wat er in de kop van een kolom staat, uit de deckstand van `snapshot()`:
 * resterende tijd als "-3:32" (geen honderdsten: in een donkere zaal lees je
 * die toch niet), de HOORBARE bpm (grid × rate, dat is `d.bpm`) en of het
 * einde nadert. Een lege track geeft streepjes.
 */
export function kolomInfo(d) {
  if (!d?.loaded || !d.duration) return { rest: '—', bpm: '—', bijna: false };
  const s = Math.max(0, d.duration - d.position);
  const hele = Math.ceil(s - 1e-6);
  const rest = `-${Math.floor(hele / 60)}:${String(hele % 60).padStart(2, '0')}`;
  return { rest, bpm: d.bpm ? d.bpm.toFixed(1) : '—', bijna: !!d.playing && s < BIJNA_EINDE };
}

/** De crossfaderkant uit `read('track.N.xfade.side')`: 0 = A, 0,5 = thru, 1 = B. */
export function kantVan(v) {
  if (v === null || v === undefined) return null;
  return v <= 0.25 ? 'A' : v >= 0.75 ? 'B' : 'thru';
}

/** Is dit de knop die de crossfaderkant rondzet? Dan toont hij de kant, geen licht. */
export const isKantKnop = (action) => /^track\.\d+\.xfade\.side$/.test(action ?? '');
