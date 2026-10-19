/**
 * M9 (render) — tikt een overgang?
 *
 *   node v2/meting/klik.mjs [--json]
 *
 * Voor elke overgang een korte render (1,6 s) met de ECHTE engine in een OfflineAudioContext
 * (zie golden.mjs: suspend → bus → tik → 10 ms wachten → resume), op drie bronnen: een sinus van
 * 80 Hz (de bas: daar valt een tik het meest op, en de grootste "gewone" stap is klein), een sinus
 * van 1 kHz, en het demonummer Klokwerk 124. Gemeten aan de MASTER-uitgang (L): de grootste
 * sample-stap |x[n] − x[n−1]| in een venster rond de overgang, gedeeld door de grootste stap in
 * gewone muziek:
 *   - "÷ ervoor" = een even lang venster direct ervoor in dezelfde render (zoals BUDGET M9 het
 *                  zegt). Op muziek wisselvallig: valt er net een hihat in het ene venster en
 *                  niet in het andere, dan is de verhouding 0,02 of 50 zonder dat er iets tikt;
 *   - "÷ ref"    = HETZELFDE venster in renders zonder de overgang, in de oude stand en in de
 *                  nieuwe stand (de hele render lang; voor een sprong: de nieuwe lijn vanaf het
 *                  begin, zodat hij op hetzelfde moment op dezelfde plek is). Zo is "gewone muziek"
 *                  precies wat daar zonder de overgang had geklonken.
 * Grens ≤ 1,25 (BUDGET M9), beoordeeld op "÷ ref"; "÷ ervoor" staat ernaast.
 *
 * Het venster: minstens 10 ms, gecentreerd op wat de overgang in het geluid doet (het moment
 * van de handeling + de vooruitblik van de engine/strip + de vertraging van de limiter), en
 * minstens 3 ms ruimer dan die overgang aan beide kanten.
 */
import { fileURLToPath } from 'node:url';
import { opzetOffline, uitB64, SR } from './golden.mjs';
import { OVERVLOEI, OVERVLOEI_SPRONG } from '../app/src/audio/speler-kern.js';

/** Draait IN de pagina: zet M.overgang (bovenop window.M uit golden.mjs). */
function installeer() {
  const M = window.M;
  const SR = 48000;
  /**
   * Eén render. `bron` { soort: 'sinus', f } | { soort: 'demo', id }; `overgang` een naam
   * (zie OVERGANGEN in klik.mjs); `ts` = het moment van de handeling (blokrooster).
   * Geeft L (b64), ts, de vertraging van de limiter (D) en de vooruitblik van de engine.
   */
  M.overgang = async ({ bron, overgang, sec = 1.6, ts = M.blok(0.8), extra = {}, voor = [] }) => {
    const { ctx, engine } = await M.nieuweEngine(sec);
    const nummer = (b) => (b.soort === 'sinus' ? M.sinus({ f: b.f, amp: b.amp ?? 0.5, duur: 40, bpm: b.bpm ?? 120 }) : M.demo(b.id));
    await engine.laad(1, nummer(bron));
    const info = { geweigerd: [] };
    const doe = (id, v) => (e) => { const r = e.bus.doe(id, v); if (r && r.geweigerd) info.geweigerd.push(`${id}: ${r.geweigerd}`); };
    const st = [];
    // De stand vóór het spelen (voor de referenties: de oude of de nieuwe stand, de hele render).
    st.push({ t: 0.05, doe: (e) => { for (const v of voor) { if (v.seek !== undefined) e.track(1).zoek(v.seek); else doe(v.bus[0], v.bus[1])(e); } } });
    if (overgang !== 'start') st.push({ t: 0.1, doe: (e) => { doe('track.1.play', true)(e); info.Aplay = e.klok.loopt ? e.klok.seg[0].T : null; } });
    if (extra.vrij) st.push({ t: 0.3, doe: doe('track.1.sync', true) });           // sync uit: vrij op zijn eigen lijn
    // Na de handeling: waar staat hij straks (voor de referentie "de nieuwe lijn, de hele render")?
    const en = (fn) => (e) => { fn(e); const A = e.straks() + 0.02; info.A = A; info.plekNa = e.track(1).plek(A); };
    const tsHier = (fn) => st.push({ t: ts, doe: en(fn) });
    const band = extra.band ?? 'laag';
    info.en = [];
    for (const x of extra.en ?? []) st.push({ t: x.t, doe: (e) => { doe(x.bus[0], x.bus[1])(e); const A = e.straks() + 0.02; info.en.push({ A, plek: e.track(1).plek(A) }); } });   // meer handelingen (abx-maak)
    switch (overgang) {
      case 'geen': tsHier(() => {}); break;
      case 'start': st.push({ t: 0.05, doe: (e) => e.track(1).zoek(extra.startPlek ?? 0) }); tsHier(doe('track.1.play', true)); break;
      case 'stop': tsHier(doe('track.1.play', true)); break;
      case 'sprong': tsHier((e) => { const t = e.track(1); t.zoek(extra.relatief !== undefined ? t.plek(e.straks()) + extra.relatief : (extra.naar ?? 20)); }); break;
      case 'kill aan': tsHier(doe(`track.1.kill.${band}`, true)); break;
      case 'kill uit': st.push({ t: 0.4, doe: doe(`track.1.kill.${band}`, true) }); tsHier(doe(`track.1.kill.${band}`, true)); break;
      case 'filter uit het midden': tsHier(doe('track.1.filter', extra.naar ?? 0.2)); break;
      case 'filter naar het midden': st.push({ t: 0.4, doe: doe('track.1.filter', extra.van ?? 0.2) }); tsHier(doe('track.1.filter', 0.5)); break;
      case 'filter door het midden': st.push({ t: 0.4, doe: doe('track.1.filter', 0.3) }); tsHier(doe('track.1.filter', 0.7)); break;
      case 'crossfader': tsHier(doe('mixer.xfader', extra.naar ?? 0)); break;   // track 1 = kant A: 0,707 → 1
      case 'crossfader dicht': tsHier(doe('mixer.xfader', 1)); break;          // A → 0
      case 'nudge aan': tsHier(doe('track.1.nudge.voor', true)); break;
      case 'nudge los': st.push({ t: ts - 0.3, doe: doe('track.1.nudge.voor', true) }); tsHier(doe('track.1.nudge.voor', false)); break;
      case 'jog': tsHier(doe('track.1.jog', 0.5 + (extra.tellen ?? 1 / 16) / 0.5)); break;
      case 'laad over spelend': st.push({ t: ts, doe: async (e) => { await e.laad(1, nummer(extra.ander ?? { soort: 'demo', id: 'demo-128' })); } }); break;
      case 'tempo klok': tsHier(doe('klok.tempo', ((extra.bpm ?? 126) - 40) / 260)); break;
      default: throw new Error(`onbekende overgang ${overgang}`);
    }
    const buf = await M.draai(ctx, engine, st);
    return {
      L: M.naarB64(buf.getChannelData(0)), R: M.naarB64(buf.getChannelData(1)), ts: M.blok(ts),
      D: engine.mixer.vertraging, ...info,
    };
  };
  return true;
}

export async function installeerKlik(page) { await page.evaluate(installeer); }

// ---- het meten (Node) -------------------------------------------------------------------------

const MS = SR / 1000;
const VOORUIT = 256;              // engine.straks(): twee blokken
const DREMPEL = 128 + 144;        // strip: startDrempel = 128/sr + 3 ms
const IN = OVERVLOEI * 1000, SPR = OVERVLOEI_SPRONG * 1000;   // ms: start/stop, sprong (speler-kern.js)
/**
 * Waar de overgang in het geluid zit, t.o.v. het moment van de handeling (frames, vóór de
 * limiter): [begin, eind]. `nazwaai` = hoe lang de nieuwe toestand nodig heeft om stil te staan
 * (setTargetAtTime: 5τ) voordat "erna" begint.
 */
export const OVERGANGEN = {
  start: { span: [VOORUIT, VOORUIT + IN * MS], nazwaai: 5 * MS },
  stop: { span: [VOORUIT, VOORUIT + IN * MS], nazwaai: 5 * MS },
  sprong: { span: [VOORUIT, VOORUIT + SPR * MS], nazwaai: 5 * MS },
  'kill aan': { span: [DREMPEL, DREMPEL + 5 * MS], nazwaai: 5 * MS },
  'kill uit': { span: [DREMPEL, DREMPEL + 5 * MS], nazwaai: 5 * MS },
  // De filterfrequenties glijden meteen (setTargetAtTime vanaf nu, τ 10 ms); droog/nat in 5 ms na de drempel.
  'filter uit het midden': { span: [0, DREMPEL + 5 * MS], nazwaai: 60 * MS },
  'filter naar het midden': { span: [0, DREMPEL + 50 * MS + 5 * MS], nazwaai: 10 * MS },
  'filter door het midden': { span: [0, 50 * MS], nazwaai: 60 * MS },
  crossfader: { span: [0, 40 * MS], nazwaai: 20 * MS },
  'crossfader dicht': { span: [0, 40 * MS], nazwaai: 20 * MS },
  'nudge aan': { span: [VOORUIT, VOORUIT + 4 * MS], nazwaai: 5 * MS },
  'nudge los': { span: [VOORUIT, VOORUIT + 4 * MS], nazwaai: 5 * MS },
  jog: { span: [VOORUIT, VOORUIT + SPR * MS], nazwaai: 5 * MS },
  // De speler vloeit uit zodra het laadbericht aankomt (bij de resume), dan nog een stil segment op straks.
  'laad over spelend': { span: [0, VOORUIT + IN * MS], nazwaai: 5 * MS },
  'tempo klok': { span: [VOORUIT, VOORUIT + 4 * MS], nazwaai: 5 * MS },
};

export function grootsteStap(x, van, tot) {
  let m = 0, waar = van;
  for (let i = Math.max(1, van); i < tot; i++) { const d = Math.abs(x[i] - x[i - 1]); if (d > m) { m = d; waar = i; } }
  return { stap: m, waar };
}

/** Het venster rond de overgang (frames, aan de uitgang) en een even lang venster ervoor. */
export function vensters(r, naam) {
  const def = OVERGANGEN[naam];
  const t0 = Math.round(r.ts * SR + r.D * SR);
  const a = t0 + def.span[0], b = t0 + def.span[1];
  const lengte = Math.max(10 * MS, (b - a) + 6 * MS);
  const mid = (a + b) / 2;
  const W0 = Math.round(mid - lengte / 2), W1 = Math.round(mid + lengte / 2);
  return { W0, W1, lengte, voor: [W0 - 5 * MS - lengte, W0 - 5 * MS] };
}

/**
 * De referenties van een overgang: dezelfde render ZONDER de overgang, in de oude stand en in de
 * nieuwe stand (de hele render lang). Hun grootste stap in HETZELFDE venster is "gewone muziek"
 * op precies die plek. null = stilte (geen render nodig).
 * `r` = de render met de overgang (voor de sprong: waar hij landde).
 */
export function referenties(overgang, extra, r) {
  const geen = (voor = [], ext = {}) => ({ overgang: 'geen', extra: { vrij: extra.vrij, ...ext }, voor });
  const verschoven = () => {
    // De lijn na de overgang, de hele render: dezelfde plek op A, gestart vanaf Δ.
    const plekGeen = r.A - r.Aplay;          // zonder overgang: R = 1 vanaf 0
    return geen([{ seek: r.plekNa - plekGeen }]);
  };
  const b = extra.band ?? 'laag';
  switch (overgang) {
    case 'start': return [null, geen([{ seek: (extra.startPlek ?? 0) - (r.ts - Math.round(0.1 * SR / 128) * 128 / SR) }])];
    case 'stop': return [geen(), null];
    case 'sprong': case 'jog': case 'nudge los': return [geen(), verschoven()];
    case 'kill aan': return [geen(), geen([{ bus: [`track.1.kill.${b}`, true] }])];
    case 'kill uit': return [geen([{ bus: [`track.1.kill.${b}`, true] }]), geen()];
    case 'filter uit het midden': return [geen(), geen([{ bus: ['track.1.filter', extra.naar ?? 0.2] }])];
    case 'filter naar het midden': return [geen([{ bus: ['track.1.filter', extra.van ?? 0.2] }]), geen()];
    case 'filter door het midden': return [geen([{ bus: ['track.1.filter', 0.3] }]), geen([{ bus: ['track.1.filter', 0.7] }])];
    case 'crossfader': return [geen(), geen([{ bus: ['mixer.xfader', extra.naar ?? 0] }])];
    case 'crossfader dicht': return [geen(), null];
    default: return [geen()];                // nudge aan, laad (daarna stil), tempo: de oude stand
  }
}

/** De meting: stap in het venster, ÷ ervoor (zelfde render), ÷ de referenties (zelfde venster). */
export function meetStap(r, naam, refs = []) {
  const x = uitB64(r.L);
  const { W0, W1, lengte, voor } = vensters(r, naam);
  const v = grootsteStap(x, voor[0], voor[1]);
  const w = grootsteStap(x, W0, W1);
  const refStappen = refs.map((q) => (q ? grootsteStap(uitB64(q.L), W0, W1).stap : 0));
  const ref = Math.max(0, ...refStappen);
  return {
    venster: [W0 / SR, W1 / SR], lengteMs: lengte / MS,
    stap: w.stap, waarS: w.waar / SR, ervoor: v.stap, refStappen,
    tegenErvoor: v.stap > 0 ? w.stap / v.stap : Infinity,
    tegenRef: ref > 0 ? w.stap / ref : (w.stap > 0 ? Infinity : 0),
    geweigerd: r.geweigerd,
  };
}

export const BRONNEN = [
  { naam: 'sinus 80 Hz', bron: { soort: 'sinus', f: 80 } },
  { naam: 'sinus 1 kHz', bron: { soort: 'sinus', f: 1000 } },
  { naam: 'Klokwerk 124', bron: { soort: 'demo', id: 'demo-124' } },
];

/** Alle gevallen: [overgang, extra, label]. */
export function gevallen(bron) {
  const sinus = bron.soort === 'sinus';
  const g = [
    ['start', { startPlek: 1.0 }, 'start (midden in het nummer)'],
    ['stop', {}, 'stop (pauze)'],
    // Gekoppeld springt hele tellen (fasebehoudend): op de sinus (120 bpm: 40 of 500 perioden per
    // tel) is dat DEZELFDE fase. Dan overvloeien twee gelijke signalen: het slechtste geval van
    // equal-power (+3 dB midden in de 4 ms).
    ['sprong', { naar: 20 }, 'sprong gekoppeld (hele tellen)'],
    ['kill aan', { band: sinus && bron.f >= 1000 ? 'hoog' : 'laag' }, `kill ${sinus && bron.f >= 1000 ? 'hoog' : 'laag'} aan`],
    ['kill uit', { band: sinus && bron.f >= 1000 ? 'hoog' : 'laag' }, `kill ${sinus && bron.f >= 1000 ? 'hoog' : 'laag'} uit`],
    ['filter uit het midden', { naar: 0.2 }, 'filter 0,5 → 0,2'],
    ['filter naar het midden', { van: 0.2 }, 'filter 0,2 → 0,5'],
    ['filter door het midden', {}, 'filter 0,3 → 0,7'],
    ['crossfader', { naar: 0 }, 'crossfader 0,5 → 0 (A open)'],
    ['crossfader dicht', {}, 'crossfader 0,5 → 1 (A dicht)'],
    ['nudge aan', {}, 'nudge aan'],
    ['nudge los', {}, 'nudge los'],
    ['jog', { tellen: 1 / 16 }, 'jog 1/16 tel'],
    ['laad over spelend', { ander: sinus ? { soort: 'sinus', f: bron.f * 1.5 } : { soort: 'demo', id: 'demo-128' } }, 'laad over een spelende track'],
    ['tempo klok', { bpm: 126 }, 'klok-tempo 120/124 → 126'],
  ];
  if (sinus) {
    // Vrij springen, 19,6 s verder (een geheel aantal perioden) plus 0, ⅛ … ⅞ periode: alle fases, het slechtste telt.
    for (let k = 0; k < 8; k++) g.push(['sprong', { vrij: true, relatief: 19.6 + k / (8 * bron.f) }, `sprong vrij, fase +${k}/8`]);
  }
  return g;
}

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2).replace('.', ',') : '∞');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = await opzetOffline({ poort: 8812 });
  const alles = [];
  const render = (a) => o.page.evaluate((a) => window.M.overgang(a), a);
  try {
    await installeerKlik(o.page);
    for (const { naam: bnaam, bron } of BRONNEN) {
      for (const [overgang, extra, label] of gevallen(bron)) {
        const r = await render({ bron, overgang, extra });
        const refs = [];
        for (const q of referenties(overgang, extra, r)) refs.push(q ? await render({ bron, ...q }) : null);
        alles.push({ bron: bnaam, label, overgang, ...meetStap(r, overgang, refs) });
      }
    }
  } finally {
    await o.sluit();
  }
  if (process.argv.includes('--json')) { console.log(JSON.stringify(alles, null, 2)); process.exit(0); }
  console.log('M9 render: grootste sample-stap in het venster / grootste stap in gewone muziek (grens ≤ 1,25 op "÷ ref")\n');
  console.log('bron          | overgang                         | venster | stap     | ÷ ervoor | ÷ ref  | oordeel');
  let slecht = 0;
  for (const r of alles) {
    const ok = r.tegenRef <= 1.25;
    if (!ok) slecht++;
    console.log(`${r.bron.padEnd(13)} | ${r.label.padEnd(32)} | ${r.lengteMs.toFixed(1).padStart(4)} ms | ${r.stap.toExponential(2)} | ${f2(r.tegenErvoor).padStart(8)} | ${f2(r.tegenRef).padStart(6)} | ${ok ? 'ok' : 'TE GROOT'}${r.geweigerd.length ? '  geweigerd: ' + r.geweigerd.join('; ') : ''}`);
  }
  console.log(`\n${alles.length} overgangen, ${slecht} boven 1,25`);
  if (o.fouten.length) console.log('FOUTEN in de pagina:\n' + o.fouten.join('\n'));
  process.exitCode = slecht || o.fouten.length ? 1 : 0;
}
