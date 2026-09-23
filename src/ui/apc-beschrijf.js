import { GROEPEN, LAAGNAAM } from '../control/lagen.js';

/**
 * Wat een action betekent, in gewone taal — voor de APC-kaarten (apc.html).
 * Los van de pagina zodat de test kan nagaan dat elke action in de
 * standaardmapping een uitleg heeft, en er nooit een kale naam op de kaart staat.
 */

const SEND_A = ['tijd', 'herhaling', 'toon', 'op de maat'];
const SEND_B = ['grootte', 'toon', 'vasthouden'];
const VIDEO = { pixel: 'pixel', mirror: 'spiegel', rgb: 'RGB', color: 'kleur', trails: 'sporen', grain: 'korrel' };
const EQ = { trim: 'trim', high: 'high', mid: 'mid', low: 'low', filter: 'filter', fader: 'volume', pitch: 'pitch' };

/** { kort, lang }: kort past op de tekening, lang staat in de tabel. */
export function beschrijf(action) {
  let m;
  const wie = (t) => (t === '{focus}' ? 'focus-track' : `track ${t}`);
  const kortWie = (t) => (t === '{focus}' ? 'F' : t);
  if ((m = /^track\.([^.]+)\.(.+)$/.exec(action))) {
    const [, t, rest] = m;
    const w = wie(t), k = kortWie(t);
    const r = (kort, lang) => ({ kort, lang: `${lang} — ${w}` });
    if (EQ[rest]) return r(EQ[rest], EQ[rest] === 'volume' ? 'volume' : EQ[rest]);
    if (rest === 'play') return r('play', 'play / pauze');
    if (rest === 'cue') return r('cue', 'cue');
    if (rest === 'sync') return r('sync', 'sync naar de track die de maat geeft');
    if (rest === 'tap') return r('tap', 'tap tempo');
    if (rest === 'focus') return { kort: `focus ${k}`, lang: `focus op ${w} (device knobs en focus-knoppen volgen)` };
    if (rest === 'xfade.side') return r('A/B/thru', 'crossfaderkant A → B → thru');
    if (rest === 'loop.toggle') return r('loop', 'loop aan/uit (8 tellen met grid, anders 4 s)');
    if (rest === 'loop.exit') return r('loop weg', 'loop weg');
    if (rest === 'loop.halve') return r('loop ½', 'loop halveren');
    if (rest === 'loop.double') return r('loop ×2', 'loop verdubbelen');
    if (rest === 'send.a') return r('echo', 'echo-send (naar de gedeelde echo)');
    if (rest === 'send.b') return r('galm', 'galm-send (naar de gedeelde galm)');
    if (rest === 'fx.mix') return r('fx mix', 'effect dry/wet');
    if (rest === 'fx.bypass') return r('fx uit', 'effect aan/uit');
    if (rest === 'rack.next') return r('rack ▶', 'volgend rack');
    if (rest === 'rack.prev') return r('◀ rack', 'vorig rack');
    if (rest === 'nudge.back') return r('nudge −', 'even terugduwen');
    if (rest === 'nudge.fwd') return r('nudge +', 'even vooruitduwen');
    if ((m = /^fx\.knob\.(\d)$/.exec(rest))) return r(`rack ${m[1]}`, `rack-knop ${m[1]} (wat die doet hangt van het rack af)`);
    if ((m = /^hotcue\.(\d)$/.exec(rest))) return { kort: `${k}·cue ${m[1]}`, lang: `hotcue ${m[1]} — ${w}` };
    if ((m = /^hotcue\.(\d)\.delete$/.exec(rest))) return { kort: `wis ${m[1]}`, lang: `hotcue ${m[1]} wissen — ${w}` };
    if ((m = /^beatloop\.([\d.]+)$/.exec(rest))) return { kort: `${k}·${m[1]}t`, lang: `loop van ${m[1]} ${m[1] === '1' ? 'tel' : 'tellen'} — ${w}` };
    return r(rest, rest);
  }
  if ((m = /^window\.([LR])\.show\.(\d)$/.exec(action))) return { kort: `→ ${m[1]}`, lang: `track ${m[2]} in het ${m[1] === 'L' ? 'linker' : 'rechter'}venster` };
  if ((m = /^sampler\.(\d)$/.exec(action))) return { kort: `pad ${m[1]}`, lang: `sampler-pad ${m[1]}: leeg = pak de laatste tellen van de focus-track, gevuld = start/stop op de tel` };
  if ((m = /^sampler\.(\d)\.clear$/.exec(action))) return { kort: `leeg ${m[1]}`, lang: `sampler-pad ${m[1]} leegmaken (bewaard blijft bewaard)` };
  if ((m = /^send\.a\.knob\.(\d)$/.exec(action))) return { kort: `echo ${SEND_A[m[1] - 1] ?? m[1]}`, lang: `echo-bus: ${SEND_A[m[1] - 1] ?? `knop ${m[1]}`}` };
  if ((m = /^send\.b\.knob\.(\d)$/.exec(action))) return { kort: `galm ${SEND_B[m[1] - 1] ?? m[1]}`, lang: `galm-bus: ${SEND_B[m[1] - 1] ?? `knop ${m[1]}`}` };
  if ((m = /^video\.fx\.(\w+)\.hold$/.exec(action))) return { kort: `${VIDEO[m[1]] ?? m[1]}!`, lang: `video ${VIDEO[m[1]] ?? m[1]} vol aan zolang je drukt` };
  if ((m = /^video\.fx\.(\w+)$/.exec(action))) return { kort: VIDEO[m[1]] ?? m[1], lang: `video-effect ${VIDEO[m[1]] ?? m[1]}` };
  if ((m = /^layer\.(\w+)\.(\w+)$/.exec(action))) {
    const [, g, knop] = m;
    if (knop === 'next') return { kort: 'mapje ▼', lang: `${GROEPEN[g]?.naam}: volgend mapje` };
    if (knop === 'prev') return { kort: 'mapje ▲', lang: `${GROEPEN[g]?.naam}: vorig mapje` };
    const lagen = GROEPEN[g]?.knoppen[knop] ?? [];
    return { kort: `▣ ${lagen.map((l) => l).join('/')}`, lang: `open mapje ${GROEPEN[g]?.naam}: ${lagen.map((l) => LAAGNAAM[`${g}.${l}`] ?? l).join(', dan ')} (vasthouden = even gluren)` };
  }
  const vast = {
    'mixer.master': ['master', 'mastervolume'], 'mixer.xfader': ['crossfader', 'crossfader'],
    'mixer.xfader.curve': ['curve', 'crossfadercurve wisselen'],
    'record.start': ['rec', 'opname starten'], 'record.stop': ['rec stop', 'opname stoppen'],
    'record.mode': ['rec soort', 'opname: audio of audio + video'],
    'sampler.length': ['tellen', 'sampler: hoeveel tellen een lege pad pakt (1/2/4/8)'],
    'sampler.volume': ['smp vol', 'sampler-volume'],
    'focus.next': ['focus ▶', 'focus naar de volgende track'], 'focus.prev': ['◀ focus', 'focus naar de vorige track'],
    'video.mode': ['mengvorm', 'video: volgende mengvorm'], 'video.pulse': ['puls', 'video: puls op de tel'],
    'video.pulse.target': ['puls-doel', 'video: wat er op de tel pulst'],
  };
  if (vast[action]) return { kort: vast[action][0], lang: vast[action][1] };
  return { kort: action, lang: action };
}

