import { KNOPPEN, KNOP_LABEL, PAD_NOOT, knopSig, padSig, encoderSig, WIEL_SIG, padVanNoot } from '../control/devices/maschine-mk2.js';
import { parseMessage } from '../control/midi.js';
import { resolveTarget } from '../control/mapping.js';
import { UITLEG, STRIP, PAGINAS, PAGINA_NAAM, PLEKKEN, STAPPEN, nootNaam } from '../control/maschine.js';
import { soortVan } from './soorten.js';

/**
 * De Maschine-kaart (maschine.html) als rekenwerk, zonder DOM: waar elke
 * control zit en wat hij NU doet.
 *
 * Wat een control doet komt van de Maschine ZELF: `legUit()` van een
 * Maschine-exemplaar (src/control/maschine.js), dezelfde tekst als op het
 * scherm als je CONTROL vasthoudt. Deze pagina verzint dus niets; ze vraagt
 * alleen in welke soort (de kleur, ui/soorten.js) en met welk kort label het
 * op de plaat komt.
 *
 * Plaatsing: het ontwerp van de Maschine-kaart (6 okt, ~/Projects/maschine-lab/kaart,
 * artifact "Maschine-kaart Varve DJ"), in procenten van de plaat.
 */

// ---- plaatsing ---------------------------------------------------------------------

const XF = [28.44, 37.31, 46.19, 55.06, 66.44, 75.31, 84.19, 93.06];
/** [id, vorm, x, y]: id = knopnaam uit devices/maschine-mk2.js, 'k1'–'k8' (draaiknoppen), 'pad1'–'pad16', 'wiel'. */
export const PLAATS = [
  ['control', 'knop', 6, 7], ['step', 'knop', 14, 7], ['browse', 'knop', 6, 13], ['sampling', 'knop', 14, 13],
  ['browseL', 'knop', 6, 19], ['browseR', 'knop', 14, 19], ['all', 'knop', 6, 25], ['auto', 'knop', 14, 25],
  ...XF.map((x, i) => [`f${i + 1}`, 'f', x, 4.2]),
  ...XF.map((x, i) => [`k${i + 1}`, 'draai', x, 23]),
  ['volume', 'knop', 5, 35], ['swing', 'knop', 11.5, 35], ['tempo', 'knop', 18, 35],
  ['navL', 'knop', 4.5, 43.5], ['wiel', 'wiel', 11.5, 43.5], ['navR', 'knop', 18.5, 43.5],
  ['enter', 'knop', 7, 51.5], ['noteRepeat', 'knop', 16, 51.5],
  ...'ABCDEFGH'.split('').map((l, i) => [`groep${l}`, 'knop', [4.5, 10.5, 16.5, 22.5][i % 4], i < 4 ? 59 : 65]),
  ...['restart', 'stapL', 'stapR', 'grid', 'play', 'rec', 'erase', 'shift'].map((id, i) => [id, 'knop', [4.5, 10.5, 16.5, 22.5][i % 4], i < 4 ? 75 : 81]),
  ...['scene', 'pattern', 'padMode', 'navigate', 'duplicate', 'select', 'solo', 'mute'].map((id, i) => [id, 'kolom', 36, 46 + i * 6.4]),
  // pad 1 linksonder, 13–16 bovenaan (zoals op het apparaat); een procent lager dan het ontwerp, anders viel "PADS" over pad 13
  ...Array.from({ length: 16 }, (_, i) => [`pad${i + 1}`, 'pad', [50, 62, 74, 86][i % 4], [88.4, 75.6, 62.8, 50][Math.floor(i / 4)]]),
];

/** Wat er op de knop gedrukt staat. */
export const OPDRUK = {
  control: 'CONTROL', step: 'STEP', browse: 'BROWSE', sampling: 'SAMPLING', browseL: '◄', browseR: '►', all: 'ALL', auto: 'AUTO',
  volume: 'VOLUME', swing: 'SWING', tempo: 'TEMPO', navL: '◄', navR: '►', enter: 'ENTER', noteRepeat: 'NOTE REPEAT', wiel: 'wiel',
  restart: 'RESTART', stapL: '◄', stapR: '►', grid: 'GRID', play: 'PLAY', rec: 'REC', erase: 'ERASE', shift: 'SHIFT',
  scene: 'SCENE', pattern: 'PATTERN', padMode: 'PAD MODE', navigate: 'NAVIGATE', duplicate: 'DUPLICATE', select: 'SELECT', solo: 'SOLO', mute: 'MUTE',
};
for (let i = 1; i <= 8; i++) { OPDRUK[`f${i}`] = `F${i}`; OPDRUK[`k${i}`] = `knop ${i}`; }
for (const l of 'ABCDEFGH') OPDRUK[`groep${l}`] = `GROEP ${l}`;
for (let i = 1; i <= 16; i++) OPDRUK[`pad${i}`] = `pad ${i}`;

/** De delen van het apparaat voor de lijst onder de plaat (pads zoals ze liggen: 13–16 bovenaan). */
export const DELEN = [
  ['Boven de schermen (F1–F8)', XF.map((_, i) => `f${i + 1}`)],
  ['Onder de schermen (draaiknop 1–8)', XF.map((_, i) => `k${i + 1}`)],
  ['Pads', [13, 14, 15, 16, 9, 10, 11, 12, 5, 6, 7, 8, 1, 2, 3, 4].map((n) => `pad${n}`)],
  ['Groepen A–H', 'ABCDEFGH'.split('').map((l) => `groep${l}`)],
  ['Links boven', ['control', 'step', 'browse', 'sampling', 'browseL', 'browseR', 'all', 'auto']],
  ['Master en wiel', ['volume', 'swing', 'tempo', 'navL', 'wiel', 'navR', 'enter', 'noteRepeat']],
  ['Transport', ['restart', 'stapL', 'stapR', 'grid', 'play', 'rec', 'erase', 'shift']],
  ['Naast de pads', ['scene', 'pattern', 'padMode', 'navigate', 'duplicate', 'select', 'solo', 'mute']],
];

/** De signature van een control op de plaat (zoals parseMessage hem maakt). */
export function sigVan(id) {
  if (id === 'wiel') return WIEL_SIG;                           // draaien; indrukken staat in dezelfde uitleg
  const pad = /^pad(\d+)$/.exec(id);
  if (pad) return padSig(Number(pad[1]));
  const k = /^k(\d)$/.exec(id);
  if (k) return encoderSig(Number(k[1]));
  return KNOPPEN.includes(id) ? knopSig(id) : null;
}

/** Het control op de plaat bij een signature (het wiel indrukken telt als het wiel), of null. */
export function idVanSig(sig) {
  if (sig === WIEL_SIG || sig === knopSig('wiel')) return 'wiel';
  return PLAATS.find(([id]) => sigVan(id) === sig)?.[0] ?? null;
}

/** Een bericht zoals de Maschine het krijgt: indrukken, of één tik aan een draaiknop. */
export function berichtVan(id) {
  const sig = sigVan(id);
  if (!sig) return null;
  const [type, ch, nr] = sig.split(':').map((x, i) => (i ? Number(x) : x));
  return parseMessage(type === 'cc' ? [0xb0 | ch, nr, 1] : [0x90 | ch, nr, 100]);
}

// ---- de standen van de kaart -----------------------------------------------------------

/** De padmodi van de Maschine (STEP, SCENE, PATTERN vasthouden). */
export const PADMODI = [
  { id: 'spelen', naam: 'spelen' },
  { id: 'stappen', naam: 'stappen (STEP)' },
  { id: 'secties', naam: 'secties (SCENE)' },
  { id: 'plek', naam: 'plek kiezen (PATTERN vast)' },
];
export const padmodusVan = (m) => (m.patroonVast ? 'plek' : m.modus);
export function zetPadmodus(m, id) {
  m.patroonVast = id === 'plek';
  m.zetModus(id === 'plek' ? 'spelen' : id);
}
export { PAGINAS, PAGINA_NAAM };

/**
 * De stand van een Maschine die de kaart overneemt of terugzet. Met `_sectieFocus`:
 * daaraan ziet zetModus of de focus wisselde (dan het blad dat je hoort, zoals het apparaat).
 */
const STAND = ['pagina', 'modus', 'patroonVast', 'bladzijde', 'sectieBlad', '_sectieFocus'];
export const neemStand = (m) => Object.fromEntries(STAND.map((k) => [k, m[k]]));
export function zetStand(m, s) { for (const k of STAND) if (k in s) m[k] = s[k]; }

// ---- wat een control doet ------------------------------------------------------------------

const vrijeVars = (m) => Object.fromEntries(Object.entries(m.mapping.vars?.() ?? {}).filter(([, v]) => v !== null && v !== undefined));
const kortVanActie = (m, action) => {
  try { return m.beschrijf?.(resolveTarget(action, vrijeVars(m)))?.kort ?? action; } catch (_) { return action; }
};

/**
 * Wat control `id` nu doet: { id, sig, titel, tekst, kort, soort, vrij, shiftRegel }.
 * `tekst` is precies de uitleg van de Maschine (legUit); `kort` is het label op
 * de plaat, `soort` de kleur. `shift`: het label zoals het met SHIFT vast is.
 * `stand` (optioneel): m.stand(), als je hem al hebt (de labels van de draaiknoppen).
 */
export function leesControl(m, id, { shift = false, stand = null } = {}) {
  const sig = sigVan(id);
  const msg = berichtVan(id);
  if (!msg) return null;
  const { titel, tekst } = m.legUit(msg);
  const uit = { id, sig, titel, tekst, kort: '', soort: 'vrij', vrij: false, shiftRegel: false };

  const pad = msg.type === 'note' && msg.channel === 0 ? padVanNoot(msg.number) : null;
  if (pad) {
    const modus = padmodusVan(m);
    if (modus === 'plek') Object.assign(uit, pad <= PLEKKEN ? { kort: `plek ${pad}`, soort: 'patroon' } : { vrij: true });
    else if (modus === 'stappen') Object.assign(uit, { kort: `stap ${m.bladzijde * STAPPEN + pad}`, soort: 'patroon' });
    else if (modus === 'secties') {
      const naam = (stand ?? m.stand()).secties?.namen?.[pad - 1] ?? null;
      Object.assign(uit, { kort: naam ?? `sectie ${m.sectieBlad * STAPPEN + pad}`, soort: 'sectie' });
    } else Object.assign(uit, { kort: nootNaam(PAD_NOOT + pad - 1), soort: 'instrument' });
    return uit;
  }
  if (id === 'wiel') return Object.assign(uit, { kort: 'instrument', soort: 'instrument' });
  const k = /^k(\d)$/.exec(id);
  if (k) {
    const i = Number(k[1]) - 1;
    const label = (stand ?? m.stand()).knoppen?.[i]?.label ?? null;
    const regel = m.mapping.kies(sig, { shift: false });
    const kort = label ?? (m.pagina === 'strip' ? STRIP[i].label : m.pagina === 'rack' ? `plek ${i + 1}` : `instr ${i + 1}`);
    return Object.assign(uit, regel ? { kort, soort: soortVan(regel.action) } : { vrij: true });
  }
  const naam = id;
  const gewoon = m.mapping.kies(sig, { shift: false });
  const metShift = m.mapping.kies(sig, { shift: true });
  uit.shiftRegel = !!metShift && metShift !== gewoon;
  if (UITLEG[naam]) {
    // Een knop van maschine.js zelf, maar met SHIFT kan de mapping het overnemen (◄ ► transport: korter/langer).
    if (shift && uit.shiftRegel) return Object.assign(uit, { kort: kortVanActie(m, metShift.action), soort: soortVan(metShift.action) });
    return Object.assign(uit, { kort: UITLEG[naam].kort, soort: UITLEG[naam].soort });
  }
  if (!gewoon && !metShift) return Object.assign(uit, { vrij: true });
  const regel = shift && uit.shiftRegel ? metShift : gewoon ?? metShift;
  return Object.assign(uit, { kort: kortVanActie(m, regel.action), soort: soortVan(regel.action) });
}

/** Alle controls op de plaat in één keer (de stand maar één keer uitgerekend). */
export function leesAlles(m, { shift = false } = {}) {
  const stand = m.stand();
  return new Map(PLAATS.map(([id]) => [id, leesControl(m, id, { shift, stand })]));
}

/**
 * Wat control `id` doet in elke stand die voor hem uitmaakt: de padmodi voor
 * een pad, de knoppagina's voor een draaiknop. [{ naam, tekst, nu }]; leeg als
 * de stand niets uitmaakt. Zet de Maschine daarna terug zoals hij was.
 */
export function perStand(m, id) {
  const msg = berichtVan(id);
  if (!msg) return [];
  const voor = neemStand(m);
  const rijen = [];
  try {
    if (/^pad\d+$/.test(id)) {
      // Per padmodus wat de Maschine zegt NA een druk op STEP/SCENE/PATTERN: zetModus rekent
      // het blad uit zoals het apparaat (na een focuswissel het blad dat je hoort, geklemd).
      for (const p of PADMODI) {
        zetStand(m, voor);
        zetPadmodus(m, p.id);
        rijen.push({ naam: p.naam, tekst: m.legUit(msg).tekst, nu: p.id === (voor.patroonVast ? 'plek' : voor.modus) });
      }
    } else if (/^k\d$/.test(id)) {
      for (const p of PAGINAS) {
        m.pagina = p;
        rijen.push({ naam: PAGINA_NAAM[p], tekst: m.legUit(msg).tekst, nu: p === voor.pagina });
      }
    }
  } finally {
    zetStand(m, voor);
  }
  return rijen;
}

/** De naam van een control zoals het apparaatprofiel hem noemt (voor titels en de lijst). */
export const naamVan = (id) => (/^k\d$/.test(id) ? `draaiknop ${id.slice(1)}` : id === 'wiel' ? 'masterwiel' : /^pad\d+$/.test(id) ? `pad ${id.slice(3)}` : KNOP_LABEL[id] ?? id);
