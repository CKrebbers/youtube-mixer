/**
 * De klok als modulatiebron voor de vormlagen (nieuw in v2; v1 src/analysis/maat.js las de maatgever-track).
 *
 *   tel   pulsVorm van de fase in de tel: 1 op elke tel, uitdovend (exp(−5·fase))
 *   een   hetzelfde, maar alleen op de "1" van de maat (tel 0, perMaat, 2·perMaat, …); de rest 0
 *
 * Van de klok ZOALS JE HEM HOORT (klok-B10): klok.tel(t), waarbij t al de tijd is die je hoort
 * (de mixer geeft een laag t = nu − uitgangsvertraging). Loopt de klok niet: null (geen kenmerken,
 * de offsets gaan naar 0). Puur, kent geen engine: `klok` duck-typed { loopt, tel(t), perMaat }.
 */
import { pulsVorm } from '../puls.js';

export class KlokLezer {
  constructor(klok) {
    this.klok = typeof klok === 'function' ? klok : () => klok;
    this.waarden = { tel: 0, een: 0 };
  }

  /** De kenmerken op t (de tijd die je hoort), of null als de klok stilstaat. */
  lees(t) {
    const k = this.klok();
    if (!k?.loopt) return null;
    const c = k.tel(t);
    if (!Number.isFinite(c)) return null;
    const fase = c - Math.floor(c);
    const p = k.perMaat > 0 ? k.perMaat : 4;
    const inMaat = ((Math.floor(c) % p) + p) % p;
    const v = pulsVorm(fase);
    this.waarden.tel = v;
    this.waarden.een = inMaat === 0 ? v : 0;
    return this.waarden;
  }
}
