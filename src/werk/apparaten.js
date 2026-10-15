import { GROEPEN, OP_AANVRAAG } from '../control/lagen.js';

/**
 * De apparaten van een werkruimte (werkruimte S3, docs/WERKRUIMTE.md C2): per apparaat een
 * ADAPTER die weet hoe je zijn mapjes openzet. De werkruimte zegt "deel FX: APC grid fx, device
 * rack; Maschine pads worpen …"; de adapter van dat apparaat doet het.
 *
 *   registreerApparaat(id, {
 *     zetMapjes(def)   { groep: laag } openzetten (alleen wat er staat); geeft { gezet, niet }
 *     mapjes()         { groep: laag } wat er nu open staat (voor onthoud en vastleggen)
 *     aanwezig()       is hij er nu (poort aangesloten, hub verbonden)?
 *     standaard?()     alles terug naar de standaardmapjes, gluren en vasthouden los (THUIS)
 *     bij?(fn)         fn('groep.laag', { groep, vorige }) als de gebruiker op DIT apparaat een mapje VAST openzet (volgt)
 *     stil?(fn)        fn() uitvoeren zonder dat wat er intussen wisselt als keuze van de gebruiker telt
 *                      (geen bij-melding): de werkruimte haalt bij een herlaad mapjes weg en zet ze terug
 *     mapping?         de Mapping van dit apparaat (de fragmenten van de werkruimte komen erin)
 *     naam?            hoe het heet op de werk-balk ("APC", "Maschine")
 *   })
 *
 * De APC-adapter staat hier (maakApcAdapter); die van de Maschine levert spoor S6. Zolang die er
 * niet is, doet een deel op de Maschine niets, en "is de Maschine er?" kijkt naar de nep-poort van
 * de hub (aanwezigVan).
 */
const REGISTER = new Map();
const luisteraars = new Set();

export function registreerApparaat(id, adapter) {
  if (typeof id !== 'string' || !id) throw new Error('apparaat: een id is verplicht');
  for (const f of ['zetMapjes', 'mapjes', 'aanwezig']) {
    if (typeof adapter?.[f] !== 'function') throw new Error(`apparaat ${id}: ${f}() ontbreekt`);
  }
  REGISTER.set(id, adapter);
  for (const fn of luisteraars) { try { fn(id); } catch (_) {} }
  return () => {
    if (REGISTER.get(id) !== adapter) return;
    REGISTER.delete(id);
    for (const fn of luisteraars) { try { fn(id); } catch (_) {} }
  };
}

/** De adapter van dit apparaat, of null. */
export const apparaat = (id) => REGISTER.get(id) ?? null;
/** Alle geregistreerde apparaten als [id, adapter]. */
export const apparaten = () => [...REGISTER.entries()];
/** Laat weten als er een apparaat bijkomt of weggaat. */
export function bijApparaten(fn) { luisteraars.add(fn); return () => luisteraars.delete(fn); }

/**
 * Is een apparaat er? Zijn eigen adapter beslist; zonder adapter kijken we naar de MIDI-laag:
 * apc40mk2 = de gekozen invoerpoort is een APC, maschine-mk2/xboard49 = de nep-poort van de hub
 * is verbonden (of, voor de Xboard, een gewone poort met die naam), hub = de hub is verbonden,
 * lpd8 = de hub is verbonden (de hub bezit hem; VARVE ziet hem niet apart: een aanname).
 */
export function aanwezigVan(id, midi) {
  const a = REGISTER.get(id);
  if (a) { try { return !!a.aanwezig(); } catch (_) { return false; } }
  const hub = () => !!midi?.status?.()?.hub?.verbonden;
  const speel = (dev) => midi?.speelPoort?.(dev)?.in?.state === 'connected';
  switch (id) {
    case 'apc40mk2': return /apc40/i.test(midi?.input?.()?.name ?? '');
    case 'maschine-mk2': return speel('maschine-mk2');
    case 'xboard49': return speel('xboard49') || [...(midi?.access?.inputs?.values?.() ?? [])].some((p) => /xboard/i.test(p.name) && p.state === 'connected');
    case 'hub': case 'lpd8': return hub();
    default: return false;
  }
}

/**
 * De APC40 mkII: mapjes openzetten via de layer.*-actions over de bus (dus in het log en met
 * hetzelfde gedrag als een druk op de kiesknop), en meeluisteren of de gebruiker zelf een mapje
 * VAST openzet (volgt). Een mapje zonder kiesknop (alleen via een deel) gaat met lagen.zet.
 *
 * Gluren tegen vast: lagen.druk zet het mapje al bij het INDRUKKEN; pas bij het loslaten weet je
 * of het gluren was (≥ GLUREN vanuit een ander mapje: terug). Daarom wacht `bij` tot het loslaten
 * (via bijInvoke: de loslaat-trigger van de kiesknop), en meldt alleen wat dan nog open staat.
 * ▲ ▼ en een gewone lagen.zet zijn meteen vast. Wat de adapter zelf zet, meldt hij niet (geen lus).
 *
 * @param lagen      de Lagen van de mixer
 * @param invoke     de bus (actions.js)
 * @param bijInvoke  meeluisteren op de bus (actions.js), voor het loslaten van een kiesknop
 * @param aanwezig   () => boolean
 * @param wacht      (fn) => void: "na deze taak" (standaard queueMicrotask), voor de test
 */
export function maakApcAdapter({ lagen, invoke, bijInvoke = null, aanwezig = () => true, mapping = null, naam = 'APC', wacht = queueMicrotask } = {}) {
  const DEEL = ['grid', 'device'];
  let zetten = 0;
  const volgers = new Set();
  const hangend = {};    // groep -> { laag, vorige }: geopend met een kiesknop die nog vastzit
  const terug = {};      // groep -> laag: het terugzetten na gluren (geen vaste keuze)

  const knopVan = (groep, laag) => {
    for (const [k, lijst] of Object.entries(GROEPEN[groep]?.knoppen ?? {})) if (lijst.includes(laag)) return k;
    return null;
  };
  const bestaat = (groep, laag) => {
    const g = GROEPEN[groep];
    return !!g && (g.standaard === laag || knopVan(groep, laag) !== null || !!g.volgorde?.includes(laag));
  };
  const meld = (id, info) => { for (const fn of volgers) { try { fn(id, info); } catch (err) { console.warn('[werk] volgt', err); } } };

  /** Eén groep op één mapje. Geeft true als het staat. */
  function zetEen(groep, laag) {
    const g = GROEPEN[groep];
    if (!g || typeof laag !== 'string') return false;
    if (lagen.stand[groep] === laag) return true;
    if (!bestaat(groep, laag)) return false;
    // Een mapje op aanvraag (inst zonder instrument) zetten we niet open: daar is niets te doen.
    if (OP_AANVRAAG.has(`${groep}.${laag}`) && !lagen.beschikbaar?.(groep, laag)) return false;
    const knop = knopVan(groep, laag);
    if (knop) {
      const id = `layer.${groep}.${knop}`;
      // Een kiesknop met meer mapjes (Clip/Device View: strip, rack, inst) loopt erdoorheen.
      for (let i = 0; i <= g.knoppen[knop].length && lagen.stand[groep] !== laag; i++) { invoke(id, true); invoke(id, false); }
      if (lagen.stand[groep] === laag) return true;
    }
    lagen.zet(groep, laag);
    return lagen.stand[groep] === laag;
  }

  function zetMapjes(def = {}) {
    const gezet = [], niet = [];
    zetten++;
    try {
      for (const [groep, laag] of Object.entries(def)) {
        if (!GROEPEN[groep] || groep === 'scherm') continue;
        (zetEen(groep, laag) ? gezet : niet).push(`${groep}.${laag}`);
      }
    } finally { zetten--; }
    return { gezet, niet };
  }

  /** THUIS: elke groep naar zijn standaard (ook de grid-modus uit), gluren los. */
  function standaard() {
    for (const g of Object.keys(lagen.ingedrukt ?? {})) delete lagen.ingedrukt[g];
    for (const g of Object.keys(hangend)) delete hangend[g];
    const def = {};
    for (const [g, d] of Object.entries(GROEPEN)) def[g] = d.standaard;
    return zetMapjes(def);
  }

  // De stand zoals wij hem het laatst zagen: zo weet een melding wat er VÓÓR stond (voor onthoud).
  const spiegel = { ...lagen.stand };
  lagen.on('change', ({ groep, laag }) => {
    const vorige = spiegel[groep];
    spiegel[groep] = laag;
    if (zetten || !DEEL.includes(groep)) return;
    wacht(() => {
      if (terug[groep] === laag) { delete terug[groep]; return; }
      const d = lagen.ingedrukt?.[groep];
      if (d && lagen.stand[groep] === laag) { hangend[groep] = { laag, vorige: d.vorige }; return; }   // nog vast: wachten op loslaten
      delete hangend[groep];
      if (lagen.stand[groep] === laag) meld(`${groep}.${laag}`, { groep, vorige });
    });
  });
  bijInvoke?.((id, v) => {
    if (v !== false || zetten || id.charCodeAt(0) !== 108 || !id.startsWith('layer.')) return;   // 108 = 'l': goedkoop, dit gaat bij elke action
    const groep = id.split('.')[1];
    if (!hangend[groep]) return;
    // bijInvoke hoort het vóór de action; na de taak weten we wat het loslaten deed.
    wacht(() => {
      const h = hangend[groep];
      if (!h || lagen.ingedrukt?.[groep]) return;
      delete hangend[groep];
      if (lagen.stand[groep] === h.laag) meld(`${groep}.${h.laag}`, { groep, vorige: h.vorige });   // kort gedrukt: vast
      else terug[groep] = lagen.stand[groep];                                                       // gluren: terug, dat is geen keuze
    });
  });

  /**
   * fn() zonder volgt-meldingen: wat er intussen wisselt (lagen.haalMapjeWeg zet een open mapje
   * terug naar de standaard, en de werkruimte zet het daarna weer open) is geen keuze van jou.
   * De luisteraar hierboven kijkt `zetten` synchroon na, vóór hij iets in een microtaak zet,
   * dus er komt ook later niets achteraan (review ronde 2).
   */
  function stil(fn) {
    zetten++;
    try { return fn(); } finally { zetten--; }
  }

  return {
    naam, mapping,
    zetMapjes, standaard, stil,
    mapjes: () => ({ grid: lagen.stand.grid, device: lagen.stand.device }),
    aanwezig,
    bij(fn) { volgers.add(fn); return () => volgers.delete(fn); },
  };
}
