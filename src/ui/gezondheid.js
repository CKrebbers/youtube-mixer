/**
 * De AudioContext bewaken (spoor A, 15 okt): staat het geluid stil, dan zeg je
 * het, en bij de eerstvolgende druk (controller, hub, toetsenbord) probeer je
 * hem weer aan te zetten.
 *
 * Twee manieren waarop het geluid stilvalt zonder dat iemand het zag:
 *   - de context gaat uit 'running' (suspended, interrupted): een
 *     'statechange'. Tot nu toe luisterde alleen het handelingenlog ernaar;
 *     een APC-druk gaf het geluid niet terug, alleen een klik op de pagina.
 *     Chrome staat `resume()` toe zonder nieuw gebaar zodra de pagina er al
 *     één had (sticky activation), dus een MIDI-druk mag het proberen;
 *   - de context zegt 'running' maar zijn klok loopt niet (de uitgang is
 *     weg of bezet): `currentTime` blijft achter op de wandklok. Elke ~1 s
 *     gemeten; twee keer achter elkaar meer dan 0,5 s achter = melding.
 *     Eén keer achter (de Mac sliep, een haperend tabblad) zegt niets.
 *
 * Eén melding met de sleutel `audio` (meldingen.js): "staat stil" blijft
 * staan (fout) en wordt "audio loopt weer" (info) zodra het weer loopt.
 * Vóór de audio ooit liep ("audio starten" is nog niet gedrukt) is er niets
 * te melden: dat is de gewone beginstand.
 *
 * Dit is de schermlaag: de engine weet hier niets van (regel 1). Het pure
 * deel (audioMelding, KlokWachter) is zonder browser te toetsen;
 * opzetGezondheid krijgt alles wat hij aanraakt mee.
 */

export const AUDIO_SLEUTEL = 'audio';
/** Zoveel seconden mag de audioklok per meting achterlopen op de wandklok. */
export const KLOK_ACHTER = 0.5;
/** Zoveel metingen achter elkaar achter = de uitgang staat stil. */
export const KLOK_KEER = 2;
/** Om de zoveel ms meten. */
export const KLOK_MS = 1000;
/** Hoe lang "audio loopt weer" blijft staan. */
export const WEER_MS = 4000;

/**
 * De melding bij deze stand, of null (niets te zeggen). Puur.
 * @param {{ state: string, klokStil?: boolean, gestart?: boolean }} stand
 *   gestart: de audio heeft al eens gelopen (anders is stil de beginstand)
 * @returns {{ tekst: string, soort: 'fout' } | null}
 */
export function audioMelding({ state, klokStil = false, gestart = true } = {}) {
  if (!gestart || state === 'closed') return null;
  if (state !== 'running') {
    return { tekst: `audio staat stil (${state || 'onbekend'}): druk een knop op de controller of het toetsenbord, of klik ergens, en hij gaat weer`, soort: 'fout' };
  }
  if (klokStil) {
    return { tekst: 'audio-uitgang staat stil: de klok van het geluid loopt niet (is de geluidskaart weg of bezet?); kies de uitgang opnieuw of herlaad de pagina', soort: 'fout' };
  }
  return null;
}

/** De melding als het weer loopt (zelfde sleutel, vervangt de fout). */
export const WEER_GOED = Object.freeze({ tekst: 'audio loopt weer', soort: 'info' });

/**
 * Loopt de audioklok mee met de wandklok? Puur: krijgt per meting de
 * contexttijd (s), de wandklok (ms) en of de context zegt dat hij loopt.
 */
export class KlokWachter {
  constructor({ achter = KLOK_ACHTER, keer = KLOK_KEER } = {}) {
    this.achter = achter;
    this.keer = keer;
    this.reset();
  }

  reset() { this.vorig = null; this.teller = 0; this.laatsteAchter = 0; }

  /** Eén meting. Geeft true zolang de klok stilstaat (na `keer` metingen achter elkaar achter). */
  meet(ctxT, wandMs, loopt) {
    if (!loopt || !Number.isFinite(ctxT) || !Number.isFinite(wandMs)) { this.reset(); return false; }
    const v = this.vorig;
    this.vorig = { ctxT, wandMs };
    if (v) {
      const achter = (wandMs - v.wandMs) / 1000 - (ctxT - v.ctxT);
      this.laatsteAchter = achter;
      this.teller = achter > this.achter ? this.teller + 1 : 0;
    }
    return this.teller >= this.keer;
  }
}

/**
 * Aan de mixer hangen. Alles wat hij aanraakt komt binnen, dus ook zonder
 * browser te toetsen.
 * @param {{
 *   ctx: AudioContext,                      // state, currentTime, resume(), addEventListener('statechange')
 *   meld: (tekst, soort, duur, { sleutel }) => void,
 *   midi?: { onInput(fn) },                 // de MidiHub: elk bericht van de controller (ook via de hub)
 *   venster?: EventTarget,                  // waar keydown op binnenkomt (window)
 *   nu?: () => number,                      // wandklok in ms (performance.now)
 *   elke?: (fn, ms) => any,                 // setInterval
 * }} opties
 */
export function opzetGezondheid({ ctx, meld, midi = null, venster = null, nu = () => performance.now(), elke = (fn, ms) => setInterval(fn, ms) }) {
  let gestart = ctx.state === 'running';
  let klokStil = false;
  let gemeld = false;                  // er staat een fout met de sleutel audio
  const wachter = new KlokWachter();

  function toon() {
    const m = audioMelding({ state: ctx.state, klokStil, gestart });
    if (m) {
      meld(m.tekst, m.soort, undefined, { sleutel: AUDIO_SLEUTEL });
      gemeld = true;
    } else if (gemeld) {
      meld(WEER_GOED.tekst, WEER_GOED.soort, WEER_MS, { sleutel: AUDIO_SLEUTEL });
      gemeld = false;
    }
  }

  ctx.addEventListener('statechange', () => {
    if (ctx.state === 'running') gestart = true;
    else { klokStil = false; wachter.reset(); }
    toon();
  });

  function tik() {
    const stil = wachter.meet(ctx.currentTime, nu(), gestart && ctx.state === 'running');
    if (stil !== klokStil) { klokStil = stil; toon(); }
  }
  elke(tik, KLOK_MS);

  /**
   * Een druk (controller, hub, toetsenbord): staat de audio stil terwijl hij
   * al eens liep, dan proberen hem aan te zetten. Gooit nooit; true als hij
   * het probeerde.
   */
  function hervat() {
    const s = ctx.state;
    if (!gestart || s === 'running' || s === 'closed') return false;
    try { Promise.resolve(ctx.resume()).catch(() => {}); } catch (_) {}
    return true;
  }
  midi?.onInput?.(hervat);
  venster?.addEventListener?.('keydown', hervat, { capture: true });

  return { hervat, tik, stand: () => ({ state: ctx.state, gestart, klokStil, gemeld, achter: wachter.laatsteAchter }) };
}
