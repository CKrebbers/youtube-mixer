import { normaliseerSet, nummersVan, overSpelend } from '../sets/model.js';
import { KENT } from '../plan/plan-model.js';

/**
 * Sets in de mixer (spoor S9, docs/PLAN-SET.md §6): een set bewaren (plan + patronen + werkruimte,
 * optioneel een momentopname) en terugladen. Geen DOM: het planvenster, het vak `sets` op werk.html
 * en de actions (src/ui/aanhakers/set.js) roepen dit aan.
 *
 * Terugladen:
 *   - het plan wordt plan `<setnaam>` (met versie, nooit stil over een ander heen: bij een 409 een
 *     melding) en meteen actief (window.varvePlan.gebruik);
 *   - de patronen gaan naar de set die de mixer gebruikt, met versie; de mixer neemt een nieuwe
 *     versie van buiten vanzelf over (patronen-opslag.js);
 *   - de werkruimte kiest hij op naam (werk.kies), als hij er is;
 *   - de momentopname ALLEEN als `moment` gevraagd is, en over een spelende track pas bij de tweede
 *     druk binnen 3 s (CLAUDE.md, destructief). Nummers laden gewoon uit de library (hun grid, hun
 *     hotcues van NU, niet die van toen: een set is je voorbereiding, geen terugspelen), daarna zet de
 *     beginstand van het handelingenlog de rest (maakUitvoerder().stand()). Er start NIETS: de set
 *     normaliseert speelt/wacht op false.
 *   - een nummer dat er niet meer is: één melding per nummer, de rest laadt.
 */
export const ZEKER_MS = 3000;

export function maakSets({ haal = (...a) => fetch(...a), meld = () => {}, nu = () => performance.now(),
  plan = () => globalThis.window?.varvePlan ?? null, werk = () => null, patronenNaam = () => 'set',
  speelt = () => false, moment = () => null, zetMoment = async () => ({ zonder: [] }), library = async () => [],
  anders = () => [], autoAan = () => false, stopAuto = () => {}, naStand = () => {}, patronenOpslag = () => null, wacht = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const st = { lijst: [], gekozen: null, versies: {}, metMoment: false, zekerTot: 0, bezig: false, laatst: null };

  const json = async (r) => { const d = await r.json().catch(() => null); return d; };
  async function vraag(pad, opties) {
    const r = await haal(pad, opties);
    const d = await json(r);
    return { status: r.status, ok: r.ok, d };
  }
  const put = (pad, body) => vraag(pad, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  async function ververs() {
    const r = await vraag('/api/sets');
    if (r.ok) {
      st.lijst = r.d?.sets ?? [];
      if (!st.lijst.some((s) => s.naam === st.gekozen)) st.gekozen = st.lijst[0]?.naam ?? null;
    }
    return st.lijst;
  }

  function kies(stap) {
    if (!st.lijst.length) return null;
    const i = Math.max(0, st.lijst.findIndex((s) => s.naam === st.gekozen));
    st.gekozen = st.lijst[(i + stap + st.lijst.length) % st.lijst.length].naam;
    st.zekerTot = 0;
    return st.gekozen;
  }

  /** De set zoals hij NU in de mixer staat: het actieve plan, de patronen, de werkruimte, en (als gevraagd) de mixer. */
  async function verzamel({ naam, metMoment = st.metMoment, uitleg = '' } = {}) {
    const k = plan();
    const planNaam = k?.naam?.() ?? 'auto-plan';
    const p = await vraag(`/api/plannen/${encodeURIComponent(planNaam)}`);
    const pt = patronenNaam();
    const s = await vraag(`/api/patronen/${encodeURIComponent(pt)}`);
    const w = werk();
    return {
      naam, uitleg, door: 'clay',
      plan: p.ok ? p.d?.plan ?? null : null,
      patronen: s.ok && s.d?.set ? { naam: pt, set: s.d.set } : null,
      werkruimte: w?.naam && w.naam !== 'standaard' ? w.naam : null,
      momentopname: metMoment ? moment() : null,
    };
  }

  /** Bewaren onder `naam` (standaard de gekozen). Met versie: nooit stil over een ander heen. */
  async function bewaar(naam = st.gekozen, opties = {}) {
    if (!naam || !/^[a-z0-9_-]{1,60}$/.test(naam)) { meld('een setnaam is kleine letters, cijfers, - en _', 'fout'); return { ok: false }; }
    const set = await verzamel({ naam, ...opties });
    let versie = st.versies[naam];
    if (versie === undefined) {
      const g = await vraag(`/api/sets/${naam}`);
      versie = g.ok ? g.d?.versie ?? null : null;
    }
    const r = await put(`/api/sets/${naam}`, { set, versie: opties.nieuw ? null : versie });
    if (r.status === 409) {
      meld(opties.nieuw ? `er is al een set "${naam}": kies een andere naam` : `set "${naam}" is intussen gewijzigd (door Claude of een ander venster): laad hem eerst opnieuw`, 'fout');
      return { ok: false, botsing: r.d };
    }
    if (!r.ok) { meld(`set bewaren mislukt: ${r.d?.fout ?? r.status}`, 'fout'); return { ok: false }; }
    st.versies[naam] = r.d.versie;
    st.gekozen = naam;
    meld(`set "${naam}" bewaard (${set.plan?.stappen?.length ?? 0} nummers${set.momentopname ? ', met de mixer' : ''})`, 'info');
    await ververs();
    return { ok: true, set: r.d.set, versie: r.d.versie };
  }

  /**
   * Terugladen. Geeft { ok, vraag?, ontbreekt, zonder }. `vraag`: de momentopname zou over een spelende
   * track gaan: nog eens binnen ZEKER_MS (de tweede druk). Niets start vanzelf.
   */
  async function terugladen(naam = st.gekozen, { metMoment = st.metMoment } = {}) {
    if (!naam) { meld('kies eerst een set', 'info'); return { ok: false }; }
    if (st.bezig) { meld('er wordt al een set teruggeladen', 'info'); return { ok: false }; }
    const r = await vraag(`/api/sets/${naam}`);
    if (!r.ok || !r.d?.set) { meld(`set "${naam}" niet gelezen: ${r.d?.fout ?? r.status}`, 'fout'); return { ok: false }; }
    const set = normaliseerSet(r.d.set).set;
    st.versies[naam] = r.d.versie;
    const mo = metMoment ? set.momentopname : null;
    if (metMoment && !mo) meld(`set "${naam}" heeft geen momentopname van de mixer: alleen plan, patronen en werkruimte`, 'info');
    // De tweede druk (review S9 a-I5): de momentopname raakt een spelende track, spelende patronen
    // of pads, of de auto-DJ; zonder momentopname vervangt hij een plan dat de auto-DJ nu speelt.
    const geraakt = mo ? [...overSpelend(mo, speelt).map((n) => `track ${n}`), ...anders(), ...(autoAan() ? ['de auto-DJ'] : [])]
      : autoAan() ? ['de auto-DJ (zijn plan wordt vervangen)'] : [];
    if (geraakt.length && !(nu() < st.zekerTot && st.laatst === naam)) {
      st.zekerTot = nu() + ZEKER_MS;
      st.laatst = naam;
      meld(`${geraakt.join(', ')} ${geraakt.length === 1 ? 'speelt' : 'spelen'}: druk nog eens (binnen 3 s) om set "${naam}"${mo ? ' met de mixer' : ''} terug te laden`, 'info');
      return { ok: false, vraag: true };
    }
    st.zekerTot = 0;
    st.bezig = true;
    try {
      // Wat is er niet meer: één melding per nummer, de rest laadt.
      const tracks = await library().catch(() => []);
      const ids = new Set(tracks.map((t) => t.id));
      const ontbreekt = tracks.length ? nummersVan(set).filter((id) => !ids.has(id)) : [];
      for (const id of ontbreekt) meld(`set "${naam}": nummer ${id} staat niet (meer) in de library`, 'fout');
      // Het plan: plan <setnaam>, met versie.
      if (set.plan) {
        const pn = naam;
        const g = await vraag(`/api/plannen/${pn}`);
        const p = await put(`/api/plannen/${pn}`, { plan: { ...set.plan, naam: pn }, versie: g.ok ? g.d?.versie ?? null : null, kent: KENT });
        if (p.ok) { await plan()?.gebruik?.(pn); plan()?.bewaard?.(p.d.plan, p.d.versie, pn); }
        else meld(`set "${naam}": het plan niet gezet (${p.d?.fout ?? p.status})`, 'fout');
      }
      // Met de mixer: eerst de auto-DJ uit, anders start hij in de stilte die de momentopname maakt.
      if (mo && autoAan()) { await stopAuto(); meld(`set "${naam}": de auto-DJ staat uit (zet hem aan als je wilt beginnen)`, 'info'); }
      // De patronen: naar de set die de mixer gebruikt, met versie (één keer opnieuw als de mixer net zelf bewaarde).
      if (set.patronen) {
        const pt = patronenNaam();
        let p = null;
        for (let poging = 0; poging < 2 && !p?.ok; poging++) {
          const g = await vraag(`/api/patronen/${encodeURIComponent(pt)}`);
          p = await put(`/api/patronen/${encodeURIComponent(pt)}`, { set: set.patronen.set, versie: g.ok ? g.d?.versie ?? null : null });
        }
        if (!p.ok) meld(`set "${naam}": de patronen niet gezet (${p.d?.fout ?? p.status})`, 'fout');
        else await neemPatronenOver();
      }
      // De werkruimte op naam.
      if (set.werkruimte) {
        const w = werk();
        if (!w?.kies) meld(`set "${naam}": werkruimte "${set.werkruimte}" kan hier niet gekozen worden`, 'info');
        else if (w.naam !== set.werkruimte) await Promise.resolve(w.kies(set.werkruimte)).catch((err) => meld(`set "${naam}": werkruimte "${set.werkruimte}": ${err.message}`, 'fout'));
      }
      let zonder = [];
      if (mo) {
        const m = { ...mo, tracks: mo.tracks.map((t) => (t.bron === 'library' && ontbreekt.includes(t.nummer) ? { track: t.track, bron: 'leeg' } : t)) };
        const u = await zetMoment(m, tracks);
        zonder = u?.zonder ?? [];
        // De stand ging buiten de bus om: in het handelingenlog als `stand` (review S9 a-I6).
        try { naStand(); } catch (_) {}
        // Wat de momentopname aan de patronen deed (stoppen, instrumenten) mag de set niet laten botsen.
        await neemPatronenOver();
        wacht(4000).then(neemPatronenOver).catch(() => {});
      }
      meld(`set "${naam}" teruggeladen${mo ? ' (met de mixer, er speelt niets)' : ''}${ontbreekt.length ? `; ${ontbreekt.length} nummer${ontbreekt.length === 1 ? '' : 's'} ontbreken` : ''}`, 'info');
      return { ok: true, ontbreekt, zonder };
    } finally {
      st.bezig = false;
    }
  }

  /**
   * De mixer de patronen van de server laten overnemen (patronen-opslag.js): meteen kijken, en
   * staat er een botsing (de mixer bewaarde net zelf iets, review S9 b6), dan hun versie = de set.
   */
  async function neemPatronenOver() {
    const o = patronenOpslag();
    if (!o) return;
    try {
      await o.kijk?.();
      if (o.stand?.().botsing) o.hunVersie?.();
    } catch (_) { /* niet erg: de mixer kijkt zelf elke 3 s */ }
  }

  async function kopie(naam, naar) {
    const r = await vraag(`/api/sets/${naam}/kopie`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naar }) });
    if (!r.ok) meld(`kopiëren mislukt: ${r.d?.fout ?? r.status}`, 'fout');
    await ververs();
    return r;
  }
  async function hernoem(naam, naar) {
    const g = await vraag(`/api/sets/${naam}`);
    const r = await vraag(`/api/sets/${naam}/hernoem`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ naar, versie: g.d?.versie ?? null }) });
    if (!r.ok) meld(`hernoemen mislukt: ${r.d?.fout ?? r.status}`, 'fout');
    else { delete st.versies[naam]; st.gekozen = naar; }
    await ververs();
    return r;
  }

  return { st, ververs, kies, verzamel, bewaar, terugladen, kopie, hernoem,
    zetMetMoment: (aan) => { st.metMoment = !!aan; st.zekerTot = 0; },
    stand: () => ({ lijst: st.lijst, gekozen: st.gekozen, metMoment: st.metMoment, bezig: st.bezig, vraag: nu() < st.zekerTot }) };
}

/**
 * De momentopname terugzetten in de mixer: eerst de nummers gewoon uit de library laden (hun grid en
 * hotcues van NU), dan de beginstand van het log met het grid en de secties die er NU staan, zodat
 * stand() niets herlaadt en geen oud grid over het nieuwe zet. Niets start (speelt/wacht false).
 */
export function maakZetMoment({ engine, tracks: TRACKS, laadLibrary, uitvoerder, herkomst, meld = () => {} }) {
  return async (m, library) => {
    const perId = new Map((library || []).map((t) => [t.id, t]));
    const deckVan = (nr) => TRACKS.find(([n]) => n === nr)?.[1] ?? null;
    const zonder = [];
    await Promise.all(m.tracks.map(async (t) => {
      if (t.bron !== 'library') return;
      const id = deckVan(t.track);
      const d = id ? engine.deck(id) : null;
      if (!d) return;
      if (herkomst(id)?.bron === 'library' && herkomst(id)?.nummer === t.nummer && d.buffer) return;
      const lt = perId.get(t.nummer);
      if (!lt) { zonder.push(t.track); return; }
      if (d.playing) d.pause();
      const ok = await Promise.resolve(laadLibrary(id, lt)).catch((err) => { meld(`set: track ${t.track}: ${err.message}`, 'fout'); return false; });
      if (ok === false) zonder.push(t.track);
    }));
    const st = { ...m, tracks: m.tracks.map((t) => {
      if (t.bron !== 'library') return t;
      const d = engine.deck(deckVan(t.track));
      // Mislukt of niet te vinden: leeg, zodat stand() hem NIET via terugspelen laadt (review S9 a-K4).
      if (!d?.buffer || zonder.includes(t.track)) return { track: t.track, bron: 'leeg' };
      const uit = { ...t, speelt: false, wacht: false, grid: d.grid ? d.grid.toJSON() : null };
      if (d.sectieKaart) uit.secties = d.sectieKaart.toJSON(); else delete uit.secties;
      return uit;
    }) };
    const r = await uitvoerder.stand(st);
    return { zonder: [...zonder, ...(r?.zonder ?? []).filter((n) => !zonder.includes(n))] };
  };
}

