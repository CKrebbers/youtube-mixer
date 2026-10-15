import { Emitter } from '../lib/emitter.js';
import { CC_MOD, CC_PEDAAL, CC_STIL, CC_ALLES_UIT, SIG_MASTER_VOLUME, leesMasterVolume } from './noten.js';

/**
 * MIDI-learn: kies een action, beweeg een control, gekoppeld.
 *
 * Kent geen DOM en geen Web MIDI — hij krijgt geparseerde berichten gevoerd en
 * schrijft in de mapping. Daarmee is hij in Node te testen.
 *
 * Een noot is meteen duidelijk: indrukken is een trigger, klaar. Bij een CC
 * weet je het pas na een paar berichten: een fader loopt van 0 naar 127, maar
 * een relatieve encoder blijft rond 1 of rond 64 hangen. Daarom koppelt hij
 * direct bij het eerste bericht (zodat het meteen werkt) en scherpt hij de
 * modus aan zolang je blijft draaien.
 */

const VENSTER = 600;        // ms dat we blijven meekijken bij een CC
const MIN_VOOR_RELATIEF = 4; // minder berichten is te weinig bewijs

/**
 * Welke modus hoort bij deze reeks berichten van dezelfde control?
 * Bij twijfel absoluut — dat is de veilige gok, want soft-takeover vangt een
 * verkeerde gok op. Andersom zou een fader als encoder wegrennen.
 */
export function raadModus(berichten) {
  const eerste = berichten[0];
  if (!eerste) return 'trigger';
  if (eerste.type === 'note') return 'trigger';
  if (eerste.type !== 'cc') return 'absolute';

  const w = berichten.map((b) => b.value);
  if (berichten.length < MIN_VOOR_RELATIEF) return 'absolute';

  // Tweecomplement: alleen kleine stapjes net boven 0 of net onder 128.
  if (w.every((v) => (v >= 1 && v <= 8) || (v >= 120 && v <= 127))) return 'relative-2c';
  // Binary offset: alles blijft dicht bij het midden.
  if (w.every((v) => Math.abs(v - 64) <= 8) && new Set(w).size <= 6) return 'relative-bin';
  return 'absolute';
}

export class MidiLearn extends Emitter {
  constructor({ mapping, device, now = () => performance.now() }) {
    super();
    this.mapping = mapping;
    this.device = device;
    this.now = now;
    this.action = null;
    this.sig = null;
    this.buf = [];
    this.begin = 0;
  }

  get busy() { return this.action !== null; }

  /** Wachten op een control voor deze action. */
  start(action) {
    this.action = action;
    this.sig = null;
    this.buf = [];
    this.emit('armed', { action });
  }

  stop() {
    const was = this.action;
    this.action = null;
    this.sig = null;
    this.buf = [];
    if (was) this.emit('done', { action: was });
  }

  /**
   * Voer hier elk binnenkomend bericht in terwijl er geleerd wordt. De app moet
   * die berichten dan NIET ook door de mapping halen — anders verzet je tijdens
   * het koppelen je filter.
   */
  feed(msg) {
    if (!this.busy) return null;
    if (msg.channel < 0) return null;             // clock, sysex: niet koppelen

    if (this.sig !== msg.sig) {                   // ander control: opnieuw beginnen
      this.sig = msg.sig;
      this.buf = [];
      this.begin = this.now();
    }
    this.buf.push(msg);

    const mode = raadModus(this.buf);
    const label = this.device?.label?.(msg.sig) ?? undefined;
    // Wat hier NU geldt (met shift en het open mapje), niet zomaar de kale regel.
    const vorige = this.mapping.kies?.(msg.sig) ?? this.mapping.rules.get(msg.sig);
    const overschrijft = vorige && vorige.action !== this.action ? vorige.action : null;

    this.mapping.set(msg.sig, this.action, { mode, label });
    const uitslag = { sig: msg.sig, action: this.action, mode, label, overschrijft };
    this.emit('bound', uitslag);

    // Een noot is meteen klaar. Bij een CC blijven we even meekijken zodat een
    // encoder zich alsnog kan verraden.
    if (msg.type === 'note' || this.now() - this.begin > VENSTER) this.stop();
    return uitslag;
  }

  /** Koppeling(en) van een action weghalen. */
  vergeet(action) {
    const weg = this.mapping.forAction(action);
    weg.forEach((sig) => this.mapping.remove(sig));
    if (weg.length) this.emit('forgotten', { action, sigs: weg });
    return weg;
  }
}

/**
 * Koppelen op een apparaat dat zijn berichten ZELF afhandelt (14 okt, werkruimte
 * S5): de Maschine (maschine.js) en de MIDI-keyboards (noten.js) hebben hun eigen
 * Mapping en hun eigen ontvang(). Dit zet `learn` ervóór: zolang er geleerd wordt
 * en `magLeren(msg)` ja zegt, gaat het bericht naar learn.feed en NIET naar het
 * apparaat (anders verzet je wat je aan het koppelen bent). Het loslaten van een
 * knop die zo gekoppeld werd, gaat ook nergens heen: anders kreeg de nieuwe
 * action een los zonder druk.
 *
 * magLeren(msg) geeft true (koppelen), false (gewoon door naar het apparaat), een
 * BERICHT (koppelen, maar dát bericht leren: zo leert een keyboard zijn schuif, die
 * als SysEx binnenkomt, onder de signature die zijn mapping kent), of een tekst:
 * deze control kan hier niet gekoppeld worden (de reden). Dan gaat het
 * bericht gewoon door en meldt learn 'niet' met { sig, reden }: per indrukken,
 * en voor een draaiknop of wiel één keer per leerbeurt.
 *
 * Elke regel die zo ontstaat komt in `learn.mapping`, de Mapping van DAT apparaat:
 * een Maschine-knop kan nooit in de APC-mapping belanden.
 *
 * @returns een functie die de onderschepping weer weghaalt.
 */
export function vangLeren(doel, methode, learn, { magLeren = () => true } = {}) {
  const echt = doel[methode];
  const geslikt = new Set();
  let gemeld = null;   // de control die al 'niet' meldde in deze leerbeurt (een CC stuurt er veel)
  // Een nieuwe leerbeurt meldt opnieuw. `geslikt` blijft staan: de knop die je net koppelde kan
  // nog vastzitten, en zijn loslaten hoort nergens heen (een oude stand ruimt `vang` zelf op).
  learn.on('armed', () => { gemeld = null; });
  const vang = function (msg, ...rest) {
    if (msg && msg.type === 'note' && !msg.on && geslikt.delete(msg.sig)) return true;
    // Gaat dezelfde knop intussen gewoon door (het loslaten van het koppelen kwam nooit,
    // bv. de hub viel weg), dan hoort zijn volgende loslaten weer bij het apparaat.
    if (msg && msg.type === 'note' && msg.on && !learn.busy) geslikt.delete(msg.sig);
    if (msg && learn.busy) {
      const mag = magLeren(msg);
      if (mag === true || (mag && typeof mag === 'object')) {
        learn.feed(mag === true ? msg : mag);
        if (msg.type === 'note' && msg.on) geslikt.add(msg.sig);
        return true;
      }
      // Eén melding per control per leerbeurt (een noot opnieuw indrukken meldt opnieuw):
      // geen schermwerk per MIDI-bericht van een draaiend wiel.
      const druk = msg.type === 'note' && msg.on;
      if (typeof mag === 'string' && (druk || (msg.type === 'cc' && msg.value)) && (druk || gemeld !== msg.sig)) {
        gemeld = msg.sig;
        learn.emit('niet', { sig: msg.sig, reden: mag });
      }
    }
    return echt.call(doel, msg, ...rest);
  };
  doel[methode] = vang;
  return () => { if (doel[methode] === vang) doel[methode] = echt; };
}

/*
 * Wat maschine.js zelf afhandelt vóór de mapping (pads, het wiel, CONTROL, de
 * paginaknoppen, de padmodi, ◄ ► van het transport): een regel daarop zou nooit
 * iets doen, dus die zijn niet te koppelen. SHIFT is de shiftknop van de mapping.
 */
export const MASCHINE_ZELF = Object.freeze(['control', 'browseL', 'browseR', 'step', 'scene', 'sampling', 'pattern', 'wiel', 'enter', 'stapL', 'stapR', 'shift']);

/**
 * Koppelen op de Maschine (magLeren voor vangLeren): alleen met CONTROL
 * vastgehouden. Dan legt maschine.js uit in plaats van uit te voeren, dus de
 * Maschine doet niets terwijl je kiest. Een draaiknop die al gekozen is mag
 * doordraaien (zo herkent leren het type), ook als CONTROL al los is.
 *
 * `profiel` = src/control/devices/maschine-mk2.js (de module), van de aanroeper:
 * dit bestand laadt ook zonder ?hub=, en dan hoort er niets van de Maschine mee
 * te komen (test/hub.test.mjs: alleen de keten van speelapparaten.js).
 */
export function maschineMagLeren(maschine, learn, msg, profiel) {
  const P = profiel;
  if (msg.channel === P.KNOP_KANAAL && msg.type === 'note' && msg.sig === P.knopSig('control')) return false;
  if (learn.sig && msg.sig === learn.sig && msg.type === 'cc') return true;
  if (!maschine.uitleg) return false;
  if (msg.channel === P.PAD_KANAAL && (msg.type === 'note' || msg.type === 'poly') && P.padVanNoot(msg.number) !== null) {
    return msg.type === 'note' && msg.on ? 'de pads spelen noten (of stappen, secties, de sampler): niet te koppelen' : false;
  }
  if (msg.sig === P.WIEL_SIG || MASCHINE_ZELF.some((k) => msg.sig === P.knopSig(k))) {
    return (msg.type === 'note' && !msg.on) ? false : 'deze knop is van de Maschine zelf (wiel, pagina, padmodus, CONTROL, SHIFT): niet te koppelen';
  }
  if (msg.type === 'note' && !msg.on) return false;
  return msg.type === 'note' || msg.type === 'cc';
}

/** Namen voor het koppelpaneel: een knop van een MIDI-keyboard is een CC, de schuif van de Xboard is SysEx. */
export const KEYBOARD_APPARAAT = Object.freeze({
  id: 'xboard49', name: 'MIDI-keyboard (Xboard49)',
  label(sig) {
    if (sig === SIG_MASTER_VOLUME) return 'schuif (Master Volume)';
    const m = /^cc:(\d+|\*):(\d+)$/.exec(sig || '');
    return m ? `CC ${m[2]}${m[1] === '*' ? '' : ` (kanaal ${Number(m[1]) + 1})`}` : null;
  },
});

/**
 * Koppelen op een MIDI-keyboard (magLeren voor vangLeren op noten.js): wat
 * noten.js aan zijn mapping geeft, de knoppen (CC) en de schuif (SysEx Master
 * Volume). Noten, buiging, druk, modwiel, pedaal en paniek speelt noten.js zelf;
 * de APC hoort hier niet bij. De schuif wordt geleerd zoals noten.js hem aan de
 * mapping geeft (signature `master-volume`), met kanaal 0: leren slaat
 * kanaalloze berichten over.
 */
export function keyboardMagLeren(noten, msg) {
  if (noten.isApc(msg.portName)) return false;
  if (msg.type === 'sysex') {
    const v = leesMasterVolume(msg.raw);
    if (v === null) return false;
    return { sig: SIG_MASTER_VOLUME, type: SIG_MASTER_VOLUME, channel: 0, number: -1, value: Math.round(v * 127), norm: v, raw: msg.raw };
  }
  if (msg.type !== 'cc') return false;
  if ([CC_MOD, CC_PEDAAL, CC_STIL, CC_ALLES_UIT].includes(msg.number)) return 'modwiel, pedaal en paniek speelt het instrument zelf: niet te koppelen';
  return true;
}
