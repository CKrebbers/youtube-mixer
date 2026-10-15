/**
 * ✎ Inrichten zonder JSON (werkruimte S8, docs/WERKRUIMTE.md A9, VISIE §5.3; docs/werkruimte/S8.md).
 * Clay maakt zelf de indeling: dit is het MECHANIEK. Elke bewerking neemt de RUWE werkruimte (zoals
 * hij op schijf staat, met `_uitleg` en volgorde) en geeft een nieuwe terug; de Inrichter slaat die
 * op met versie (409 = niets overschreven) en laat de mixer hem opnieuw laden. Wat mag, beslist
 * ALLEEN het model (normaliseerWerkruimte): een toewijzing op een kernsleutel of een bezette plek
 * wordt geweigerd met zijn reden, en er wordt niets opgeslagen.
 *
 *   itemVoor(action, meta)            wat een aangewezen action op een paneel wordt (draai/schuif/knop)
 *   voegItemToe(ruw, paneel, item)    een item achteraan (het paneel komt er zo nodig bij)
 *   haalItemWeg(ruw, paneel, i)       item i weg
 *   zetOpScherm(ruw, paneel, deel, s) het paneel op scherm s van een deel (hoofd = het werkvak)
 *   wijsToe(ruw, paneel, doel, deel)  het paneel op een groep knoppen: regels in een EIGEN mapje
 *                                     (`p-<paneel>`) dat het deel openzet; nooit op een plek van de standaard
 *   wijsRegelsToe(ruw, apparaat, regels)  regels met de hand (de toets dat de kern geweigerd wordt)
 *   zoek(tekst, { alle, top40, focus }) de action-zoeker: de top-40 van de handelingen bovenaan
 *
 * Puur: geen DOM, geen netwerk, alleen het model. De Inrichter krijgt zijn opslag van buiten.
 */
import { normaliseerWerkruimte, MAX_DELEN } from './model.js';

/** De groepen knoppen waar een paneel op kan (`wijsToe`). In volgorde van het paneel; xy = twee waarden. */
export const DOELEN = Object.freeze({
  'apc-device': { naam: 'APC device knobs', apparaat: 'apc40mk2', groep: 'device', soort: 'value',
    ins: [16, 17, 18, 19, 20, 21, 22, 23].map((n) => `cc:0:${n}`), regel: { mode: 'endless' } },
  'maschine-draai': { naam: 'Maschine-draaiknoppen', apparaat: 'maschine-mk2', groep: 'pagina', soort: 'value',
    ins: [16, 17, 18, 19, 20, 21, 22, 23].map((n) => `cc:0:${n}`), regel: { mode: 'relative-2c', step: 0.001 } },
  'maschine-pads': { naam: 'Maschine-pads', apparaat: 'maschine-mk2', groep: 'pads', soort: 'trigger',
    ins: Array.from({ length: 16 }, (_, i) => `note:0:${36 + i}`), regel: { mode: 'trigger' } },
  // F1–F8 van de Maschine (note:1:0–7). In een werkruimte met het stuk maschine-delen kiezen die het deel:
  // dan weigert wijsToe (een deel moet altijd te kiezen blijven, A12).
  'maschine-f': { naam: 'F1–F8 (Maschine)', apparaat: 'maschine-mk2', groep: null, soort: 'trigger',
    ins: Array.from({ length: 8 }, (_, i) => `note:1:${i}`), regel: { mode: 'trigger' } },
});

const kopie = (x) => JSON.parse(JSON.stringify(x ?? null));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const PANEEL = /^[a-z0-9-]{1,32}$/;

/** Een paneelnaam uit vrije tekst ("Mijn dub!" -> "mijn-dub"), of null. */
export function paneelNaam(tekst) {
  const n = String(tekst ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return PANEEL.test(n) ? n : null;
}

/** Wat een action op een paneel wordt: een fader als schuif, een waarde als draai, een trigger als knop. */
export function itemVoor(action, meta = null) {
  if (typeof action !== 'string' || !/^[\w.{}-]{1,120}$/.test(action)) return null;
  const type = meta?.type ?? null;
  if (type === 'trigger') return { soort: 'knop', action };
  if (/\.(fader|xfader)$|^mixer\.master$/.test(action)) return { soort: 'schuif', action };
  return { soort: type === 'value' || type === null ? 'draai' : 'knop', action };
}

/**
 * Een track in een aangewezen action wordt `{focus}` als het de focus-track is (een paneel volgt dan de
 * focus, zoals de bouwstenen); een andere track blijft vast. Zo betekent aanwijzen wat je ziet.
 */
export function alsFocus(action, focus) {
  if (!focus || typeof action !== 'string') return action;
  return action.replace(new RegExp(`^track\\.${focus}\\.`), 'track.{focus}.');
}

function paneelVan(w, paneel, maak = false) {
  if (!PANEEL.test(paneel)) throw new Fout(`"${paneel}" is geen paneelnaam (a-z, 0-9, -)`);
  w.panelen = isObj(w.panelen) ? w.panelen : {};
  if (!isObj(w.panelen[paneel])) {
    if (!maak) throw new Fout(`geen paneel "${paneel}"`);
    w.panelen[paneel] = { titel: paneel.toUpperCase().slice(0, 24), items: [] };
  }
  if (!Array.isArray(w.panelen[paneel].items)) w.panelen[paneel].items = [];
  return w.panelen[paneel];
}

export class Fout extends Error {}

export function voegItemToe(ruw, paneel, item) {
  if (!item?.soort) throw new Fout('geen item');
  const w = kopie(ruw);
  const p = paneelVan(w, paneel, true);
  if (p.items.length >= 64) throw new Fout(`paneel ${paneel} is vol (64 items)`);
  p.items.push(item);
  return w;
}

export function haalItemWeg(ruw, paneel, i) {
  const w = kopie(ruw);
  const p = paneelVan(w, paneel);
  if (!Number.isInteger(i) || i < 0 || i >= p.items.length) throw new Fout(`paneel ${paneel} heeft geen item ${i + 1}`);
  p.items.splice(i, 1);
  return w;
}

/** Het paneel op een scherm van een deel. `hoofd` = het werkvak van de mixer; anders achteraan bij de vakken. */
export function zetOpScherm(ruw, paneel, deel, scherm) {
  const w = kopie(ruw);
  paneelVan(w, paneel);
  const d = w.delen?.[deel];
  if (!isObj(d)) throw new Fout(`geen deel "${deel}" in deze werkruimte`);
  if (!/^[a-z0-9-]{1,16}$/.test(scherm)) throw new Fout(`"${scherm}" is geen schermnaam`);
  d.schermen = isObj(d.schermen) ? d.schermen : {};
  const s = (d.schermen[scherm] = isObj(d.schermen[scherm]) ? d.schermen[scherm] : {});
  const vak = `paneel:${paneel}`;
  if (scherm === 'hoofd') s.werkvak = vak;
  else {
    s.vakken = Array.isArray(s.vakken) ? s.vakken.filter((v) => v !== vak) : [];
    if (s.vakken.length >= 12) throw new Fout(`scherm ${scherm} heeft al 12 vakken in ${deel}`);
    s.vakken.push(vak);
    // Een scherm dat de werkruimte nog niet kent: erbij, met de soort uit de naam (de iPad en iPhone kijken tot
    // bedienen aan staat en `mag` zegt wat; een ander scherm wordt een venster op de Mac).
    w.schermen = isObj(w.schermen) ? w.schermen : {};
    if (!w.schermen[scherm]) w.schermen[scherm] = { soort: /^ip(ad|hone)/.test(scherm) ? (scherm.startsWith('iphone') ? 'iphone' : 'ipad') : 'venster' };
  }
  return w;
}

/** De actions van een paneel in volgorde (een rij uitgeschreven, een xy als x en y). */
function actionsInVolgorde(p) {
  const uit = [];
  for (const it of p.items ?? []) {
    const items = it?.soort === 'rij' ? (it.herhaal ?? []).map((k) => ({ ...it.item, action: it.item?.action?.replaceAll('{k}', k) })) : [it];
    for (const x of items) {
      if (!x || x.soort === 'tekst' || typeof x.action !== 'string') continue;
      if (x.soort === 'xy') {
        const a = typeof x.y === 'string' ? [x.action, x.y] : x.action.includes('{as}') ? [x.action.replaceAll('{as}', '1'), x.action.replaceAll('{as}', '2')] : [x.action];
        for (const y of a) uit.push({ action: y, soort: 'value' });
      } else uit.push({ action: x.action, soort: x.soort === 'knop' ? 'trigger' : x.soort === 'lamp' ? null : 'value' });
    }
  }
  return uit;
}

/**
 * Het paneel op een groep knoppen (DOELEN). De regels komen in een EIGEN mapje `p-<paneel>` (nieuw,
 * zonder kiesknop) dat dit deel openzet: zo raken ze nooit een plek van de standaard, en doen die
 * knoppen alleen in dit deel iets anders. Een tweede keer toewijzen vervangt de vorige regels van dat
 * mapje. Geeft { ruw, regels, overgeslagen } (overgeslagen: items die niet bij de groep passen).
 */
export function wijsToe(ruw, paneel, doel, deel) {
  const D = DOELEN[doel];
  if (!D) throw new Fout(`onbekende groep "${doel}" (wel: ${Object.keys(DOELEN).join(', ')})`);
  const w = kopie(ruw);
  const p = paneelVan(w, paneel);
  const d = w.delen?.[deel];
  if (!isObj(d)) throw new Fout(`geen deel "${deel}" in deze werkruimte`);
  if (doel === 'maschine-f' && (w.stukken ?? []).includes('maschine-delen')) {
    throw new Fout('F1–F8 kiezen in deze werkruimte het deel (stuk maschine-delen): kies een andere groep');
  }
  const laag = `p-${paneel}`.slice(0, 32);
  const lijst = actionsInVolgorde(p);
  const passend = lijst.filter((x) => x.soort === D.soort);
  const overgeslagen = lijst.filter((x) => x.soort !== D.soort).map((x) => x.action);
  if (passend.length > D.ins.length) overgeslagen.push(...passend.slice(D.ins.length).map((x) => x.action));
  const regels = passend.slice(0, D.ins.length).map((x, i) => ({ in: D.ins[i], ...(D.groep ? { laag: `${D.groep}.${laag}` } : {}), action: x.action, ...D.regel,
    label: `${D.naam} ${i + 1} (paneel ${paneel})` }));
  if (!regels.length) throw new Fout(`paneel ${paneel} heeft niets voor ${D.naam} (${D.soort === 'value' ? 'draaiknoppen en schuiven' : 'knoppen'})`);
  w.regels = isObj(w.regels) ? w.regels : {};
  const oud = Array.isArray(w.regels[D.apparaat]) ? w.regels[D.apparaat] : [];
  const ins = new Set(D.ins);
  // De vorige toewijzing van dit paneel weg (zelfde mapje, of zonder mapje op dezelfde knoppen).
  w.regels[D.apparaat] = [...oud.filter((r) => !(D.groep ? r?.laag === `${D.groep}.${laag}` : !r?.laag && ins.has(r?.in) && /\(paneel /.test(r?.label ?? ''))), ...regels];
  if (D.groep) {
    w.mapjes = isObj(w.mapjes) ? w.mapjes : {};
    w.mapjes.nieuw = isObj(w.mapjes.nieuw) ? w.mapjes.nieuw : {};
    const sleutel = D.apparaat === 'apc40mk2' ? `${D.groep}.${laag}` : `${D.apparaat}.${D.groep}.${laag}`;
    w.mapjes.nieuw[sleutel] = { naam: `paneel ${p.titel ?? paneel}`, kiesknop: null };
    d[D.apparaat] = isObj(d[D.apparaat]) ? d[D.apparaat] : {};
    d[D.apparaat][D.groep] = laag;
  }
  return { ruw: w, regels: regels.length, overgeslagen };
}

/** Regels met de hand op een apparaat (voor wie precies weet welke knop): het model beslist. */
export function wijsRegelsToe(ruw, apparaat, regels) {
  const w = kopie(ruw);
  w.regels = isObj(w.regels) ? w.regels : {};
  w.regels[apparaat] = [...(Array.isArray(w.regels[apparaat]) ? w.regels[apparaat] : []), ...regels];
  return w;
}

/**
 * Mag dit? normaliseerWerkruimte met de standaarden: een fout = { ok: false, reden } (de eerste fout,
 * of een fout die NIEUW is ten opzichte van wat er stond: een oude fout blokkeert geen nieuwe bewerking).
 */
export function toets(nieuw, oud, opties = {}) {
  const n = normaliseerWerkruimte(nieuw, opties);
  if (!n.werkruimte) return { ok: false, reden: n.fouten[0] ?? 'de werkruimte klopt niet' };
  const al = new Set(oud ? normaliseerWerkruimte(oud, opties).fouten : []);
  const erbij = n.fouten.filter((f) => !al.has(f));
  if (erbij.length) return { ok: false, reden: erbij[0], fouten: erbij };
  if (Object.keys(n.werkruimte.delen ?? {}).length > MAX_DELEN) return { ok: false, reden: `hooguit ${MAX_DELEN} delen` };
  return { ok: true, werkruimte: n.werkruimte, waarschuwingen: n.waarschuwingen };
}

/**
 * De action-zoeker. `alle` = [{ id, label }] (de bus), `top40` = de lijst uit tools/werkruimtes/top40.json
 * ({ action: 'track.N.fader', aantal }). De top-40 staat bovenaan (in volgorde van gebruik), met N = de
 * focus-track als `{focus}` en K = 1; daarna de rest die de tekst bevat (op id en label), hooguit `max`.
 */
export function zoek(tekst, { alle = [], top40 = [], max = 60 } = {}) {
  const t = String(tekst ?? '').trim().toLowerCase();
  const past = (id, label) => !t || id.toLowerCase().includes(t) || String(label ?? '').toLowerCase().includes(t);
  const bekend = new Map(alle.map((a) => [a.id, a]));
  const uit = [], gezien = new Set();
  for (const r of top40) {
    const id = String(r.action).replace(/^track\.N\./, 'track.{focus}.').replace(/\.K(?=\.|$)/g, '.1').replace(/\.N\./g, '.1.');
    const echt = id.replace('{focus}', '1');
    const a = bekend.get(echt);
    if (!a || gezien.has(id) || !past(id, a.label)) continue;
    gezien.add(id);
    uit.push({ id, label: a.label ?? id, top: r.nr ?? uit.length + 1, aantal: r.aantal ?? null });
  }
  for (const a of alle) {
    if (uit.length >= max) break;
    if (gezien.has(a.id) || !past(a.id, a.label)) continue;
    gezien.add(a.id);
    uit.push({ id: a.id, label: a.label ?? a.id, top: null });
  }
  return uit.slice(0, max);
}

/**
 * De Inrichter: één bewerking = één opslag met versie, daarna laadt de mixer de werkruimte opnieuw
 * (met hetzelfde deel). Geen stille overschrijving: een 409 zegt het en laadt opnieuw.
 *
 * @param werk     de Werkruimte (naam, ruw, versie, deel, standaarden, peil)
 * @param bewaar   async (naam, ruw, versie) => { ok, status, versie?, fout? }
 * @param terugApi async (naam, versie) => { ok, status, versie?, fout? }
 * @param meld     (tekst, soort)
 */
export class Inrichter {
  constructor({ werk, bewaar, terugApi = async () => ({ ok: false, fout: 'niet beschikbaar' }), meld = () => {} }) {
    Object.assign(this, { werk, bewaar, terugApi, meld });
    this.bezig = false;
  }

  get kan() { return !!this.werk && this.werk.naam !== 'standaard'; }

  /** Eén bewerking: fn(ruw) -> nieuw ruw (of { ruw, ... }). Geeft { ok, reden?, ... }. */
  async doe(fn, wat = 'inrichten') {
    if (!this.kan) { const reden = 'kies eerst een werkruimte (niet "standaard")'; this.meld(`${wat}: ${reden}`, 'info'); return { ok: false, reden }; }
    if (this.bezig) return { ok: false, reden: 'nog bezig met de vorige' };
    let r;
    try { r = fn(this.werk.ruw); } catch (err) {
      const reden = err instanceof Fout ? err.message : String(err?.message || err);
      this.meld(`${wat}: ${reden}`, 'fout');
      return { ok: false, reden };
    }
    const nieuw = r?.ruw ?? r;
    const t = toets(nieuw, this.werk.ruw, { standaarden: this.werk.standaarden ?? {} });
    if (!t.ok) { this.meld(`${wat} geweigerd: ${t.reden}`, 'fout'); return { ok: false, reden: t.reden }; }
    this.bezig = true;
    try {
      const b = await this.bewaar(this.werk.naam, nieuw, this.werk.versie);
      if (!b?.ok) {
        const reden = b?.status === 409 ? 'de werkruimte is intussen gewijzigd (Claude of een ander venster): niets overschreven, opnieuw geladen' : (b?.fout ?? `opslaan mislukt (${b?.status})`);
        this.meld(`${wat}: ${reden}`, 'fout');
        if (b?.status === 409) await this.werk.peil?.({ forceer: true });
        return { ok: false, reden, status: b?.status };
      }
      await this.werk.peil?.({ forceer: true });
      return { ok: true, ...(isObj(r) && 'ruw' in r ? { regels: r.regels, overgeslagen: r.overgeslagen } : {}) };
    } finally { this.bezig = false; }
  }

  voegToe(paneel, item) { return this.doe((w) => voegItemToe(w, paneel, item), 'op het paneel'); }
  haalWeg(paneel, i) { return this.doe((w) => haalItemWeg(w, paneel, i), 'weghalen'); }
  zetOpScherm(paneel, scherm, deel = this.werk.deel) { return this.doe((w) => zetOpScherm(w, paneel, deel, scherm), 'op het scherm'); }
  wijsToe(paneel, doel, deel = this.werk.deel) { return this.doe((w) => wijsToe(w, paneel, doel, deel), 'toewijzen'); }

  /** Terug naar de vorige inrichting (de server zet de vorige versie terug; 409 als iemand intussen opsloeg). */
  async terug() {
    if (!this.kan) return { ok: false, reden: 'geen eigen werkruimte' };
    const b = await this.terugApi(this.werk.naam, this.werk.versie);
    if (!b?.ok) {
      const reden = b?.status === 409 ? 'intussen gewijzigd: niets teruggezet, opnieuw geladen' : (b?.fout ?? `terug mislukt (${b?.status})`);
      this.meld(`terug: ${reden}`, b?.status === 404 ? 'info' : 'fout');
      if (b?.status === 409) await this.werk.peil?.({ forceer: true });
      return { ok: false, reden, status: b?.status };
    }
    await this.werk.peil?.({ forceer: true });
    this.meld('terug naar de vorige inrichting', 'info');
    return { ok: true };
  }
}
