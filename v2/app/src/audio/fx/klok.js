/**
 * De maatklok voor effecten (BOUWPLAN "Effecten": er is geen fxKlok per deck meer, de maatklok IS
 * de klok).
 *
 * Een effect op de tel (echo op de maat, gate, LFO, modulators, de duiker) krijgt de klok van de
 * engine (src/kern/klok.js) mee, zoals hij is: `loopt`, `tel(t)`, `tijd(c)`, `bpm(t)`, `perMaat`,
 * `volgendeMaat(c)` en het event 'verander'. Daaruit maakt `fxKlokVan` de MOMENTOPNAME die de
 * effecten uit v1 al kennen (v1 Deck.fxKlok, zodat hun bewezen rekenwerk ongewijzigd blijft):
 *
 *   { beatLengte, ankerCtx, tellenTotEen, perMaat }   of null als de klok niet loopt
 *
 *   ankerCtx      audiokloktijd waarop de eerstvolgende tel van het SIGNAAL valt
 *   beatLengte    hoe lang die tel duurt (tot de tel erna: bij een tempowissel die van het nieuwe stuk)
 *   tellenTotEen  hele tellen van het anker tot de volgende "1" (0 = het anker IS de "1")
 *   perMaat       tellen per maat
 *
 * `vertraging()` (seconden, standaard 0): zoveel loopt het signaal dat door het effect gaat achter
 * op de klok. In een strip en op de send-bussen is dat 0: een track speelt op audiokloktijd t de
 * plek van klok-tel tel(t) (kern/koppeling.js), en dat is precies het signaal dat het effect op t
 * bewerkt. De uitgangsvertraging (wat je HOORT) geldt voor muziek en effect samen, dus die telt
 * hier NIET mee; wie haar meegeeft zet de gate een uitgangsbuffer naast de tel.
 *
 * Herankeren: de klok meldt 'verander' bij elke nieuwe lijn (houd, richt, start, stop). Een lijn
 * kan ook in de toekomst knikken (richt: eerst een overgangsstuk, dan de doellijn) zonder nieuw
 * event; `volgKlok` kijkt daarom ook op het volgende knikpunt nog eens (de timer zegt alleen
 * WANNEER, de audioklok zegt of het zover is: regel 2).
 *
 * Geen DOM, geen eigen tijd.
 */

/** Een tel van het signaal die binnen deze marge na `nu` valt, telt als "nu" (geen anker in het verleden). */
const MARGE = 1e-9;

const looptVan = (klok) => (typeof klok?.loopt === 'function' ? !!klok.loopt() : !!klok?.loopt);

/** Is dit een maatklok (en geen v1-functie die zelf een momentopname geeft)? */
export const isMaatklok = (k) => !!k && typeof k === 'object' && typeof k.tel === 'function' && typeof k.tijd === 'function';

/**
 * Een functie () => momentopname | null op de audioklok van `ctx`.
 * @param klok        de maatklok (of een functie die al een momentopname geeft: die gaat ongewijzigd door)
 * @param vertraging  () => seconden dat het signaal achter de klok loopt (standaard 0)
 */
export function fxKlokVan(klok, ctx, { vertraging = () => 0 } = {}) {
  if (typeof klok === 'function') return klok;
  if (!isMaatklok(klok)) return () => null;
  return () => {
    if (!looptVan(klok)) return null;
    const V = Number(vertraging?.()) || 0;
    const nu = ctx.currentTime;
    // De tel van het signaal op `nu` is klok.tel(nu − V); de eerstvolgende hele tel daarvan.
    const n = Math.ceil(klok.tel(nu - V) - MARGE);
    const t0 = klok.tijd(n), t1 = klok.tijd(n + 1);
    const per = klok.perMaat > 0 ? klok.perMaat : 4;
    const een = typeof klok.volgendeMaat === 'function' ? klok.volgendeMaat(n) : Math.ceil(n / per - 1e-9) * per;
    const beatLengte = t1 - t0;
    if (!(beatLengte > 0) || !Number.isFinite(t0)) return null;
    return { beatLengte, ankerCtx: t0 + V, tellenTotEen: Math.round(een - n), perMaat: per };
  };
}

/** Het eerste knikpunt van de klok ná audiokloktijd t (een nieuw stuk lijn), of null. */
export function volgendKnikpunt(klok, t) {
  if (!isMaatklok(klok) || !Array.isArray(klok.seg)) return null;
  for (const s of klok.seg) if (s.T > t + MARGE) return s.T;
  return null;
}

/**
 * Luisteren naar de klok: `fn()` na elke 'verander', en nog eens als de audioklok het volgende
 * knikpunt voorbij is. Geeft een functie die het luisteren stopt. Zonder maatklok (of zonder
 * `on`): niets, en een lege stopfunctie.
 */
export function volgKlok(klok, ctx, fn, { vertraging = () => 0 } = {}) {
  if (!isMaatklok(klok) || typeof klok.on !== 'function') return () => {};
  let timer = null, weg = false;
  const wacht = () => {
    clearTimeout(timer);
    timer = null;
    if (weg) return;
    const knik = volgendKnikpunt(klok, ctx.currentTime);
    if (knik === null) return;
    // Op het knikpunt van het SIGNAAL (de lijn van de klok + de vertraging), net erna.
    const doel = knik + (Number(vertraging?.()) || 0) + 0.001;
    const kijk = () => {
      timer = null;
      if (weg) return;
      // Staat de audioklok stil, dan klinkt er niets: kijken als hij weer loopt (de volgende 'verander' of tik).
      if (ctx.currentTime >= doel) { fn(); wacht(); return; }
      timer = setTimeout(kijk, Math.min(250, Math.max(5, (doel - ctx.currentTime) * 1000)));
      timer?.unref?.();
    };
    kijk();
  };
  const af = klok.on('verander', () => { if (!weg) { fn(); wacht(); } });
  wacht();
  return () => { weg = true; clearTimeout(timer); timer = null; af?.(); };
}
