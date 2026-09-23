import { clamp, expMap } from '../lib/emitter.js';
import { leesRack, schrijfRack, resolveMacros, rackVanEffect, LEEG_RACK } from './rack.js';

/**
 * De insert-slot: één effectketen per deck, klikvrij verwisselbaar.
 *
 * Dit is stap 1 van de effect-racks, en bewust nog zonder rack-data. Eerst het
 * mechanisme bewijzen met je oren; pas daarna komt er JSON omheen. Wat hier al
 * wél goed moet staan, want later is het duur:
 *
 *   - Verander NOOIT de bedrading van een keten waar signaal doorheen loopt.
 *     `disconnect()` is niet sample-accuraat; staat er op dat moment signaal op,
 *     dan hoor je een klik. Of je hem hoort hangt af van het niveau — daarom is
 *     dit een bug die je pas op het podium tegenkomt.
 *   - Wisselen gaat dus via een equal-power kruisfade tussen twee COMPLETE
 *     ketens. Lineair kruisfaden geeft een dip in het midden, want dry en wet
 *     van hetzelfde signaal zijn maximaal gecorreleerd.
 *   - Hergebruik geen nodes. "Zelfde delay, andere parameters" lijkt zuinig en
 *     is de bron van de helft van je toekomstige klikken.
 *   - Ruim de oude keten pas op na kruisfade PLUS staarttijd. Eerder afkappen
 *     hoor je harder dan de klik die je probeerde te vermijden.
 *
 * Alle parameters zijn genormaliseerd 0..1. De schaling zit hier, in code.
 */

export const FADE = 0.04;      // 40 ms kruisfade

/**
 * Muzikale delingen. Een rack slaat een DELING op, nooit seconden — anders
 * klopt hij niet meer zodra het tempo verandert.
 */
export const DELINGEN = [
  { id: '1/1', tellen: 4 }, { id: '1/2', tellen: 2 }, { id: '1/4', tellen: 1 },
  { id: '1/8', tellen: 0.5 }, { id: '3/16', tellen: 0.75 }, { id: '1/16', tellen: 0.25 },
];
export const delingVan = (t) => DELINGEN[Math.min(DELINGEN.length - 1,
  Math.max(0, Math.round(clamp(t) * (DELINGEN.length - 1))))];

/**
 * Wat een tempo-gesynchroniseerd effect van buiten nodig heeft.
 *
 * `beatLengte` is de HOORBARE tellengte (grid gedeeld door de rate), en
 * `ankerCtx` is het moment op de audioklok waarop de eerstvolgende tel valt.
 * Zonder dat tweede loopt je gate wel op tempo maar op de verkeerde tel, en
 * dat is net zo waardeloos als helemaal niet synchroon.
 */
export const GEEN_KLOK = () => null;
const CURVE_N = 33;

/** Equal-power curve van a naar b. */
function fadeCurve(van, naar) {
  const c = new Float32Array(CURVE_N);
  for (let i = 0; i < CURVE_N; i++) {
    const t = i / (CURVE_N - 1);
    c[i] = van * Math.cos(t * Math.PI / 2) + naar * Math.cos((1 - t) * Math.PI / 2);
  }
  return c;
}

/**
 * Een doelwaarde zetten op een parameter waar mogelijk nog een curve op loopt.
 *
 * Web Audio weigert `setTargetAtTime` als het overlapt met een lopende
 * `setValueCurveAtTime` — en gooit dan een NotSupportedError die je hele
 * aanroepketen meeneemt. Dat gebeurt precies wanneer je aan de mix draait vlak
 * nadat je van effect gewisseld bent, oftewel: tijdens het spelen.
 *
 * `cancelAndHoldAtTime` breekt de curve netjes af op zijn huidige waarde.
 * Kent de browser hem niet, dan vallen we terug; en faalt het alsnog, dan
 * zetten we de waarde hard in plaats van de aanroeper te laten struikelen.
 */
export function zetDoel(param, waarde, ctx, tau = 0.01) {
  const nu = ctx.currentTime;
  try {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(nu);
    else param.cancelScheduledValues?.(nu);
  } catch (_) {}
  try {
    param.setTargetAtTime(waarde, nu, tau);
  } catch (_) {
    try { param.value = waarde; } catch (__) {}
  }
}

function zetCurve(param, van, naar, ctx, duur = FADE) {
  const nu = ctx.currentTime;
  try {
    param.cancelScheduledValues?.(nu);
    param.setValueCurveAtTime(fadeCurve(van, naar), nu, duur);
  } catch (_) {
    param.setTargetAtTime(naar, nu, duur / 3);   // vangnet
  }
}

// ---- effecten --------------------------------------------------------------
// Elk effect levert in/uit, een setter per parameter, en zijn staarttijd. Die
// staarttijd is geen sier: hij bepaalt wanneer de oude keten weg mag.

export const EFFECTEN = [
  {
    id: 'delay',
    naam: 'Delay',
    params: ['tijd', 'feedback', 'toon'],
    standaard: { tijd: 0.35, feedback: 0.45, toon: 0.6 },
    bouw(ctx) {
      const ingang = ctx.createGain();
      const uitgang = ctx.createGain();
      const delay = ctx.createDelay(2.0);
      const fb = ctx.createGain();
      const toon = ctx.createBiquadFilter();
      toon.type = 'lowpass';

      // Let op: een lus MOET een DelayNode bevatten, anders mute de browser het
      // hele lusgedeelte. En delayTime in een lus wordt geklemd op minimaal één
      // render quantum (128 samples, ~2,7 ms bij 48 kHz).
      ingang.connect(delay);
      delay.connect(toon).connect(fb).connect(delay);
      delay.connect(uitgang);

      const staat = { tijd: 0.35, feedback: 0.45 };
      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (naam === 'tijd') {
            staat.tijd = expMap(t, 0.02, 1.2);
            delay.delayTime.setTargetAtTime(staat.tijd, now, 0.05);
          } else if (naam === 'feedback') {
            // Geklemd onder 1: zelfoscillatie blaast je set op.
            staat.feedback = t * 0.92;
            fb.gain.setTargetAtTime(staat.feedback, now, 0.02);
          } else if (naam === 'toon') {
            toon.frequency.setTargetAtTime(expMap(t, 300, 16000), now, 0.02);
          }
        },
        // Hoe lang blijft er nog iets klinken als de invoer stopt?
        staart: () => Math.min(8, staat.tijd * (staat.feedback > 0.05
          ? Math.log(0.001) / Math.log(staat.feedback) : 1)),
      };
    },
  },
  {
    id: 'filter',
    naam: 'Filter',
    params: ['freq', 'reso'],
    standaard: { freq: 0.5, reso: 0.2 },
    bouw(ctx) {
      const ingang = ctx.createGain();
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 20;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 22050;
      const uitgang = ctx.createGain();
      ingang.connect(hp).connect(lp).connect(uitgang);
      let reso = 0.2;
      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (naam === 'reso') { reso = t; }
          if (naam === 'freq' || naam === 'reso') {
            const d = (naam === 'freq' ? t : 0.5) * 2 - 1;
            const q = 0.7 + reso * 12;
            if (d < 0) {
              lp.frequency.setTargetAtTime(expMap(1 + d, 200, 22050), now, 0.01);
              lp.Q.setTargetAtTime(q, now, 0.01);
              hp.frequency.setTargetAtTime(20, now, 0.01);
            } else {
              hp.frequency.setTargetAtTime(expMap(d, 20, 9000), now, 0.01);
              hp.Q.setTargetAtTime(q, now, 0.01);
              lp.frequency.setTargetAtTime(22050, now, 0.01);
            }
          }
        },
        staart: () => 0,
      };
    },
  },
  {
    id: 'crush',
    naam: 'Bitcrush',
    params: ['bits', 'toon'],
    standaard: { bits: 0.6, toon: 1 },
    bouw(ctx) {
      const ingang = ctx.createGain();
      const vorm = ctx.createWaveShaper();
      const toon = ctx.createBiquadFilter(); toon.type = 'lowpass'; toon.frequency.value = 22050;
      const uitgang = ctx.createGain();
      ingang.connect(vorm).connect(toon).connect(uitgang);
      // Aliasing is hier een feature, dus geen oversampling.
      vorm.oversample = 'none';
      const trap = (stappen) => {
        const n = 1024, c = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * 2 - 1;
          c[i] = Math.round(x * stappen) / stappen;
        }
        return c;
      };
      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (naam === 'bits') vorm.curve = trap(Math.max(1, Math.round(Math.pow(2, 1 + (1 - t) * 6))));
          else if (naam === 'toon') toon.frequency.setTargetAtTime(expMap(t, 600, 20000), now, 0.02);
        },
        staart: () => 0,
      };
    },
  },
  {
    id: 'gate',
    naam: 'Gate',
    params: ['deling', 'vorm', 'diepte'],
    standaard: { deling: 0.6, vorm: 0.5, diepte: 1 },
    /**
     * Ritmische gate op het beatgrid.
     *
     * Een blokgolf als AudioBuffer, loopend, rechtstreeks op de gain van het
     * signaal. Dat is sample-accuraat: je start hem op een tijd van de
     * audioklok en daarna loopt hij precies mee. Een gate die op tempo loopt
     * maar op de verkeerde tel begint is waardeloos — vandaar het anker.
     */
    bouw(ctx, { klok = GEEN_KLOK } = {}) {
      const ingang = ctx.createGain();
      const poort = ctx.createGain();
      const uitgang = ctx.createGain();
      ingang.connect(poort).connect(uitgang);
      poort.gain.value = 1;

      let bron = null;
      const staat = { deling: 0.6, vorm: 0.5, diepte: 1 };

      /** Eén cyclus: open, dan dicht. `vorm` verschuift de verhouding. */
      const maakBuffer = (periode) => {
        const sr = ctx.sampleRate;
        const n = Math.max(64, Math.round(periode * sr));
        const buf = ctx.createBuffer(1, n, sr);
        const d = buf.getChannelData(0);
        const open = Math.max(1, Math.round(n * (0.1 + staat.vorm * 0.8)));
        const helling = Math.max(2, Math.round(n * 0.02));   // zachte randen, anders klikt het
        for (let i = 0; i < n; i++) {
          let v;
          if (i < open) v = 1;
          else v = 1 - staat.diepte;
          if (i < helling) v = (1 - staat.diepte) + (v - (1 - staat.diepte)) * (i / helling);
          if (i >= open && i < open + helling) {
            const t = (i - open) / helling;
            v = 1 * (1 - t) + (1 - staat.diepte) * t;
          }
          d[i] = v;
        }
        return buf;
      };

      const herstart = () => {
        const k = klok();
        if (bron) { try { bron.stop(); } catch (_) {} bron.disconnect(); bron = null; }
        if (!k || !k.beatLengte) { poort.gain.value = 1; return; }
        const periode = k.beatLengte * delingVan(staat.deling).tellen;
        if (!(periode > 0.005)) return;
        const src = ctx.createBufferSource();
        src.buffer = maakBuffer(periode);
        src.loop = true;
        // De gain van de poort wordt volledig door de buffer bepaald.
        poort.gain.value = 0;
        src.connect(poort.gain);
        const start = k.ankerCtx ?? ctx.currentTime;
        try { src.start(Math.max(start, ctx.currentTime)); } catch (_) { src.start(); }
        bron = src;
      };

      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (!(naam in staat)) return;
          const oud = staat[naam];
          staat[naam] = t;
          // Deling, vorm en diepte zitten allemaal in de buffer, dus opnieuw
          // opbouwen. Gebeurt alleen als je eraan draait, niet per frame.
          if (Math.abs(oud - t) > 1e-6) herstart();
        },
        heranker: herstart,
        staart: () => 0,
      };
    },
  },
  {
    id: 'phaser',
    naam: 'Phaser',
    params: ['snelheid', 'diepte', 'feedback'],
    standaard: { snelheid: 0.35, diepte: 0.6, feedback: 0.3 },
    bouw(ctx) {
      const ingang = ctx.createGain();
      const uitgang = ctx.createGain();
      const nat = ctx.createGain();
      const fb = ctx.createGain();
      const traps = [];
      for (let i = 0; i < 6; i++) {
        const ap = ctx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.value = 400 * Math.pow(1.8, i);
        ap.Q.value = 0.7;
        traps.push(ap);
      }
      const lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 0.4;
      const diepte = ctx.createGain(); diepte.gain.value = 800;
      lfo.connect(diepte);
      for (const ap of traps) diepte.connect(ap.frequency);
      try { lfo.start(); } catch (_) {}

      let vorige = ingang;
      for (const ap of traps) { vorige.connect(ap); vorige = ap; }
      vorige.connect(nat).connect(uitgang);
      ingang.connect(uitgang);          // het droge deel hoort erbij: dat maakt de notch
      // Feedback moet een vertraging bevatten, anders mute de browser de lus.
      const vert = ctx.createDelay(0.05);
      vert.delayTime.value = 0.004;
      nat.connect(vert).connect(fb).connect(traps[0]);
      fb.gain.value = 0.3;

      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (naam === 'snelheid') lfo.frequency.setTargetAtTime(expMap(t, 0.03, 6), now, 0.05);
          else if (naam === 'diepte') diepte.gain.setTargetAtTime(t * 1800, now, 0.05);
          else if (naam === 'feedback') fb.gain.setTargetAtTime(t * 0.75, now, 0.02);
        },
        staart: () => 0.05,
      };
    },
  },
  {
    id: 'ringmod',
    naam: 'Ringmod',
    params: ['toon', 'meng'],
    standaard: { toon: 0.3, meng: 0.5 },
    bouw(ctx) {
      const ingang = ctx.createGain();
      const uitgang = ctx.createGain();
      const nat = ctx.createGain();
      const droog = ctx.createGain();
      // Een gain met waarde 0 waar een oscillator op staat, IS vermenigvuldigen:
      // verbindingen naar een AudioParam worden bij zijn eigen waarde opgeteld.
      const ring = ctx.createGain();
      ring.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = 200;
      osc.connect(ring.gain);
      try { osc.start(); } catch (_) {}

      ingang.connect(ring).connect(nat).connect(uitgang);
      ingang.connect(droog).connect(uitgang);
      nat.gain.value = 0.5; droog.gain.value = 0.5;

      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (naam === 'toon') osc.frequency.setTargetAtTime(expMap(t, 20, 3000), now, 0.02);
          else if (naam === 'meng') {
            nat.gain.setTargetAtTime(Math.cos((1 - t) * Math.PI / 2), now, 0.01);
            droog.gain.setTargetAtTime(Math.cos(t * Math.PI / 2), now, 0.01);
          }
        },
        staart: () => 0,
      };
    },
  },
];

export const effectVan = (id) => EFFECTEN.find((e) => e.id === id) || null;

// ---- ketens ----------------------------------------------------------------

/**
 * Een effectketen uit een rack-beschrijving.
 *
 * Effecten in serie; een slot dat uit staat of dat we niet kennen wordt
 * overgeslagen in de bedrading maar blijft wél in de beschrijving bestaan.
 * Zo sloopt een rack met een onbekend effect niets en klinkt hij alleen anders.
 */
export function bouwKeten(ctx, chain, klok = GEEN_KLOK) {
  const ingang = ctx.createGain();
  const uitgang = ctx.createGain();
  const slots = new Map();
  let vorige = ingang;

  for (const spec of chain || []) {
    const effect = effectVan(spec.type);
    if (!effect || spec.bypass) continue;
    const inst = effect.bouw(ctx, { klok });
    vorige.connect(inst.in);
    vorige = inst.out;
    slots.set(spec.slot, { inst, effect, spec });
    const now = ctx.currentTime;
    for (const naam of effect.params) {
      inst.zet(naam, spec.params?.[naam] ?? effect.standaard?.[naam] ?? 0.5, now);
    }
  }
  vorige.connect(uitgang);

  return {
    in: ingang, out: uitgang, slots,
    zet(target, v, now) {
      const punt = target.indexOf('.');
      if (punt < 0) return false;
      const s = slots.get(target.slice(0, punt));
      if (!s) return false;
      s.inst.zet(target.slice(punt + 1), v, now);
      return true;
    },
    // De langste staart telt: daarop wacht de opruiming.
    staart() {
      let t = 0;
      for (const s of slots.values()) t = Math.max(t, s.inst.staart());
      return t;
    },
    /** Opnieuw op de tel zetten: na seek, hotcue, loop, tempo- of gridwijziging. */
    heranker() {
      for (const s of slots.values()) s.inst.heranker?.();
    },
  };
}

// ---- de slot ---------------------------------------------------------------

export class InsertSlot {
  constructor(ctx) {
    this.ctx = ctx;
    this.in = ctx.createGain();
    this.out = ctx.createGain();
    this.dry = ctx.createGain();
    this.in.connect(this.dry).connect(this.out);

    this.rack = LEEG_RACK();
    this.standen = {};        // plek -> 0..1. SESSIETOESTAND, gaat nergens heen.
    this.keten = null;        // { node, gain }
    this.oud = [];
    this.mix = 0;
    this.bypass = false;
    this.opgeruimd = 0;
    this.fouten = [];
    this.klok = GEEN_KLOK;
  }

  /**
   * De klokvoorziening aanhangen. Het deck weet waar de tel ligt; het effect
   * niet. Zo hoeft geen enkel effect iets van een deck of een grid te weten.
   */
  setKlok(fn) { this.klok = fn || GEEN_KLOK; }

  /** Alle gesynchroniseerde effecten opnieuw op de tel zetten. */
  heranker() { this.keten?.node.heranker(); }

  get effectId() { return this.rack.chain?.[0]?.type ?? null; }
  get rackNaam() { return this.rack.name; }
  get nodeAantal() { return this.oud.length + (this.keten ? 1 : 0); }
  get plekken() { return (this.rack.macros || []).map((m) => m.place).sort((a, b) => a - b); }

  _niveaus() {
    const m = this.bypass ? 0 : clamp(this.mix);
    return { dry: Math.cos(m * Math.PI / 2), wet: Math.cos((1 - m) * Math.PI / 2) };
  }

  _pasNiveausToe() {
    const { dry, wet } = this._niveaus();
    zetDoel(this.dry.gain, dry, this.ctx);
    if (this.keten) zetDoel(this.keten.gain.gain, wet, this.ctx);
  }

  setMix(v) { this.mix = clamp(v); this._pasNiveausToe(); }
  setBypass(aan) { this.bypass = !!aan; this._pasNiveausToe(); }

  /**
   * Een heel rack laden, zonder klik.
   *
   * Nieuwe keten volledig opbouwen terwijl de oude speelt, equal-power
   * kruisfaden, en de oude pas opruimen na fade plus staarttijd.
   */
  zetRack(data, { behoudStanden = false } = {}) {
    const { rack, fouten } = leesRack(data, { bekendType: (t) => !!effectVan(t) });
    this.rack = rack;
    this.fouten = fouten;

    // Standen terug naar de defaults van dit rack. De live stand is
    // sessietoestand en reist niet mee met het rack. In de editor wil je dat
    // juist wél: daar pas je de keten aan terwijl je aan een knop zit.
    const vorigeStanden = this.standen;
    this.standen = {};
    for (const m of rack.macros) {
      this.standen[m.place] = behoudStanden && m.place in vorigeStanden
        ? vorigeStanden[m.place] : (m.default ?? 0);
    }

    const nieuw = bouwKeten(this.ctx, rack.chain, () => this.klok());
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    this.in.connect(nieuw.in);
    nieuw.out.connect(gain).connect(this.out);

    const vorige = this.keten;
    this.keten = { node: nieuw, gain };
    this._pasMacrosToe();

    const { wet } = this._niveaus();
    zetCurve(gain.gain, 0, wet, this.ctx);
    if (vorige) {
      zetCurve(vorige.gain.gain, vorige.gain.gain.value, 0, this.ctx);
      this.oud.push(vorige);
      setTimeout(() => this._ruimOp(vorige), (FADE + vorige.node.staart()) * 1000 + 50);
    }
    return { fouten };
  }

  /** Eén effect erin, als rack met één macro per parameter. */
  zetEffect(id, { params = null } = {}) {
    const effect = effectVan(id);
    if (!effect) return false;
    if (this.effectId === id) return true;
    const rack = rackVanEffect(effect);
    if (params) Object.assign(rack.chain[0].params, params);
    this.zetRack(rack);
    return true;
  }

  _ruimOp(keten) {
    const i = this.oud.indexOf(keten);
    if (i < 0) return;
    this.oud.splice(i, 1);
    try {
      this.in.disconnect(keten.node.in);
      keten.node.out.disconnect();
      keten.gain.disconnect();
    } catch (_) {}
    this.opgeruimd++;
  }

  /**
   * Alleen de macro's vervangen, de keten laten staan.
   *
   * Voor de editor: schuif je aan een bereik of een curve, dan hoeft er geen
   * enkele node opnieuw gebouwd te worden. Alleen de getallen veranderen, en
   * je hoort het meteen zonder kruisfade.
   */
  bewerkMacros(macros) {
    const { rack, fouten } = leesRack({ ...schrijfRack(this.rack), macros },
      { bekendType: (t) => !!effectVan(t) });
    this.rack.macros = rack.macros;
    this.fouten = fouten;
    for (const m of rack.macros) if (!(m.place in this.standen)) this.standen[m.place] = m.default ?? 0;
    for (const k of Object.keys(this.standen)) {
      if (!rack.macros.some((m) => m.place === Number(k))) delete this.standen[k];
    }
    this._pasMacrosToe();
    return { fouten };
  }

  /** Alle macro's opnieuw doorrekenen naar parameterwaarden. */
  _pasMacrosToe() {
    if (!this.keten) return;
    const waarden = resolveMacros(this.rack, this.standen);
    const now = this.ctx.currentTime;
    for (const [target, v] of waarden) this.keten.node.zet(target, v, now);
  }

  /** Knop op plek n. Dit is waar `deck.A.fx.knop.n` op uitkomt. */
  setPlek(n, v) {
    const macro = this.rack.macros?.find((m) => m.place === n);
    if (!macro) return false;
    this.standen[n] = clamp(v);
    this._pasMacrosToe();
    return true;
  }

  leesPlek(n) {
    const macro = this.rack.macros?.find((m) => m.place === n);
    if (!macro) return null;
    return this.standen[n] ?? macro.default ?? 0;
  }

  plekNaam(n) { return this.rack.macros?.find((m) => m.place === n)?.label ?? null; }
  plekBipolair(n) { return !!this.rack.macros?.find((m) => m.place === n)?.bipolar; }

  /** Het rack zoals het opgeslagen moet worden — zonder de live standen. */
  naarJSON() { return schrijfRack(this.rack); }

  /**
   * Alle doelen die een macro kan aansturen, voor de keuzelijst in de editor.
   * Onbekende of uitgeschakelde slots staan er ook in: je mag er alvast naar
   * wijzen, ze doen pas iets als het slot aan staat.
   */
  doelen() {
    const uit = [];
    for (const node of this.rack.chain || []) {
      const effect = effectVan(node.type);
      const params = effect ? effect.params : Object.keys(node.params || {});
      for (const p of params) {
        uit.push({ target: `${node.slot}.${p}`, slot: node.slot, param: p,
          effect: effect?.naam ?? node.type, uit: !!node.bypass });
      }
    }
    return uit;
  }
}
