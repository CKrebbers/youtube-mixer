import { esc } from './dom.js';
import { leesWeg } from '../lib/antwoord.js';
import {
  KLEUREN, SNEL, sleutelVan, geldigeNaam, leesZoekregel, zoekregelVan, chipsVan, filterKort,
} from '../library/indeling.js';

/*
 * De indeling in het library-paneel (spoor S11, docs/LIBRARY-TAGS.md §3): links de kolom INDELING
 * (alles · categorieën · slimme · tags), boven de lijst de TAGBALK (de chips van het filter, wat
 * gekozen is, het tagveld en de snel-tags), en alles wat daarbij naar de server gaat
 * (/api/indeling/…, alleen vanaf deze Mac).
 *
 * Het filter heeft ÉÉN bron: de tekst in het zoekveld (de zoekregel, leesZoekregel). Een klik op
 * een categorie of tag schrijft die tekst om; een × op een chip ook. Zo staat wat je ziet altijd in
 * het veld, en is het hetzelfde als wat de Maschine, de iPad en een slimme categorie bewaren.
 *
 * Het paneel (library-panel.js) geeft mee:
 *   zoekTekst() / zetZoekTekst(t)   het zoekveld
 *   doelIds()                       wat gekozen is (de selectie, anders het gekozen nummer)
 *   track(id)                       een rij uit de pagina's (voor zijn tags)
 *   ververs()                       de lijst opnieuw (blijft waar hij was)
 *   meld(tekst, goed)               de statusregel
 *   bevestigd(soort, sleutel)       tweede klik binnen 3 s
 */

export const INDELING_SLEUTEL = 'varve.library.indeling';   // de kolom open of dicht (localStorage)
export const NUMMERS_MIME = 'application/x-varve-nummers';

/** Of een nummer (met `tags`: namen) een tag heeft, op sleutel. */
export const heeftTag = (t, naam) => (t?.tags ?? []).some((x) => sleutelVan(x) === sleutelVan(naam));

/**
 * Wat een tagveld zegt: "dub, deep house" = erbij, "-vocal" = eraf. Geeft { erbij, eraf, fout }.
 * Puur (de test rekent het na).
 */
export function leesTagInvoer(tekst) {
  const erbij = [], eraf = [], fout = [];
  for (const deel of String(tekst ?? '').split(',')) {
    const t = deel.trim().replace(/^#/, '');
    if (!t) continue;
    const weg = /^-\s*#?/.test(t);
    const naam = geldigeNaam(weg ? t.replace(/^-\s*#?/, '') : t);
    if (!naam) { fout.push(t); continue; }
    (weg ? eraf : erbij).push(naam);
  }
  return { erbij, eraf, fout };
}

/** Aan of uit voor een groep: hebben ze hem allemaal, dan eraf; anders erbij. Puur. */
export const tagWissel = (tracks, naam) => (tracks.length && tracks.every((t) => heeftTag(t, naam)) ? 'uit' : 'aan');

/** De tagchips in een rij (de titelcel): hooguit `max`, dan "+n". Puur. */
export function rijChipsHtml(t, kleuren, max = 3) {
  const tags = t?.tags ?? [];
  if (!tags.length) return '';
  const chip = (n) => `<button class="ik-chip ik-${esc(kleuren?.get(sleutelVan(n)) ?? 'grijs')}" data-tagchip="${esc(n)}" tabindex="-1" title="#${esc(n)}: filter hierop (alt: niet); shift: van dit nummer af">${esc(n)}</button>`;
  return `<i class="ik-rijtags">${tags.slice(0, max).map(chip).join('')}${tags.length > max ? `<i title="${esc(tags.slice(max).join(', '))}">+${tags.length - max}</i>` : ''}</i>`;
}

const json = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(j?.fout || `${r.status}`); e.code = r.status; e.extra = j; throw e; }
  return j;
};

export class IndelingPaneel {
  constructor({ root, panel, opslag = null }) {
    this.root = root;
    this.p = panel;
    this.opslag = opslag;
    this.stand = { tags: [], categorieen: [], snel: Array(SNEL).fill(null) };
    this.kleuren = new Map();      // tag-sleutel -> kleur
    this.menu = null;              // { soort: 'tag'|'cat', sleutel } waarvan het ⋯-menu open staat
    this.nieuw = null;             // 'gewoon' | 'slim' terwijl je een naam typt
    this._gen = 0;
    this.el = {
      kolom: root.querySelector('.lib-indeling'),
      balk: root.querySelector('.lib-tagbalk'),
    };
    if (!this.el.kolom || !this.el.balk) return;   // een oude index.html: geen indeling, de rest werkt
    this.aan = true;
    let dicht = false;
    try { dicht = opslag?.getItem(INDELING_SLEUTEL) === 'dicht'; } catch (_) {}
    this.zetOpen(!dicht);
    this._bouwBalk();
    this.el.kolom.addEventListener('click', (e) => this._klikKolom(e));
    this.el.kolom.addEventListener('keydown', (e) => this._toetsKolom(e));
    // Slepen naar een categorie (rijen uit de lijst: NUMMERS_MIME).
    this.el.kolom.addEventListener('dragover', (e) => {
      const doel = e.target.closest('[data-cat][data-soort="gewoon"]');
      if (!doel || !e.dataTransfer?.types?.includes(NUMMERS_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this._markeerDrop(doel);
    });
    this.el.kolom.addEventListener('dragleave', (e) => { if (!this.el.kolom.contains(e.relatedTarget)) this._markeerDrop(null); });
    this.el.kolom.addEventListener('drop', (e) => {
      const doel = e.target.closest('[data-cat][data-soort="gewoon"]');
      this._markeerDrop(null);
      if (!doel) return;
      const ids = leesSleep(e);
      if (!ids) return;
      e.preventDefault();
      this.inCategorie(Number(doel.dataset.cat), ids);
    });
    this.ververs();
  }

  get categorieen() { return this.stand.categorieen; }

  zetOpen(open) {
    this.open = !!open;
    this.root.classList.toggle('indeling-dicht', !this.open);
    try { this.opslag?.setItem(INDELING_SLEUTEL, this.open ? 'open' : 'dicht'); } catch (_) {}
    if (this.el.knopKolom) this.el.knopKolom.classList.toggle('on', this.open);
    this.p.naKolom?.(this.open);
  }

  // ---- het filter (de zoekregel) ----------------------------------------------------------------

  /** Het filter van de tekst in het zoekveld: { filter, onbekend, fouten }. */
  lees(tekst = this.p.zoekTekst()) { return leesZoekregel(tekst, { categorieen: this.stand.categorieen }); }

  /** Kan de lijst op plek (de volgorde van een gewone categorie) sorteren met dit filter? */
  plekMogelijk(filter) {
    const c = this.stand.categorieen.find((x) => x.id === filter?.categorie);
    return !!c && (c.soort === 'gewoon' || c.regel?.categorie != null);
  }

  /** Het filter in het zoekveld zetten (als zoekregel) en de lijst verversen. */
  zetFilter(filter) { this.p.zetZoekTekst(zoekregelVan(filter, { categorieen: this.stand.categorieen })); }

  /** Kort voor een klein scherm (de Maschine): "@warm #dub 70-90 bpm". */
  kort(filter) { return filterKort(filter, { tags: this._tagMap(), categorieen: this.stand.categorieen }); }

  _tagMap() { return new Map(this.stand.tags.map((t) => [t.sleutel, t])); }

  /** Een categorie als filter (null = alles), met wat er verder in het veld staat (zonder @…). */
  kiesCategorie(id) {
    const { filter } = this.lees();
    if (id == null) delete filter.categorie; else filter.categorie = id;
    this.zetFilter(filter);
  }

  /** De volgende/vorige categorie (de bus: library.category.next/prev): alles → gewone → slimme → alles. */
  stapCategorie(stap) {
    const ids = [null, ...this.stand.categorieen.map((c) => c.id)];
    const nu = ids.indexOf(this.lees().filter.categorie ?? null);
    const i = ((nu < 0 ? 0 : nu) + stap + ids.length) % ids.length;
    this.kiesCategorie(ids[i]);
    const c = this.stand.categorieen.find((x) => x.id === ids[i]);
    return c ? c.naam : 'alles';
  }

  /** Een tag in het filter aan/uit (en of niet). */
  wisselTagFilter(naam, niet = false) {
    const { filter } = this.lees();
    const s = sleutelVan(naam);
    const t = filter.tags ?? { en: [], of: [], niet: [] };
    const lijst = niet ? 'niet' : 'en', ander = niet ? 'en' : 'niet';
    t[ander] = t[ander].filter((x) => x !== s);
    t[lijst] = t[lijst].includes(s) ? t[lijst].filter((x) => x !== s) : [...t[lijst], s];
    filter.tags = t;
    if (!t.en.length && !t.of.length && !t.niet.length) delete filter.tags;
    this.zetFilter(filter);
  }

  // ---- naar de server ------------------------------------------------------------------------

  async ververs() {
    const gen = ++this._gen;
    try {
      const r = await fetch('/api/indeling/stand', { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error(j?.fout || `${r.status}`);
      if (gen !== this._gen) return;
      this.stand = j;
      this.kleuren = new Map(j.tags.map((t) => [t.sleutel, t.kleur]));
    } catch (err) {
      if (gen === this._gen) this.p.meld(`indeling niet geladen: ${err.message}`, false);
    }
    this.naVerversen?.();
    this.teken();
    this.p.naIndeling?.();
  }

  /**
   * Tags erbij of eraf op `ids` (de selectie). Werkt de rijen in de pagina's meteen bij (je ziet
   * het zonder te wachten), daarna de stand (aantallen) en de lijst (wat er nu nog in het filter past).
   */
  async zetTags(ids, namen, aan) {
    if (!ids.length) { this.p.meld('kies eerst een nummer (klik; cmd-klik voor meer, shift-klik voor een reeks)', false); return null; }
    try {
      const r = await json('/api/indeling/tags/zet', { ids, tags: namen, aan });
      for (const id of ids) {
        const t = this.p.track(id);
        if (!t) continue;
        const rest = (t.tags ?? []).filter((x) => !r.tags.some((n) => sleutelVan(n) === sleutelVan(x)));
        t.tags = aan ? [...rest, ...r.tags].sort((a, b) => sleutelVan(a).localeCompare(sleutelVan(b))) : rest;
      }
      const wie = ids.length === 1 ? `"${this.p.track(ids[0])?.titel ?? ids[0]}"` : `${ids.length} nummers`;
      this.p.meld(`${r.tags.map((n) => `#${n}`).join(' ')} ${aan ? 'op' : 'van'} ${wie}${aan ? '' : ' af'}`, true);
      await this.ververs();
      this.p.ververs();
      return r;
    } catch (err) {
      this.p.meld(`taggen mislukt: ${err.message}`, false);
      return null;
    }
  }

  /** Snel-tag K (1..8) aan/uit op wat gekozen is. */
  async snel(k) {
    const naam = this.stand.snel[k - 1];
    if (!naam) { this.p.meld(`snel-tag ${k} is leeg: zet hem met ⋯ bij een tag`, false); return null; }
    const ids = this.p.doelIds();
    const tracks = ids.map((id) => this.p.track(id)).filter(Boolean);
    return this.zetTags(ids, [naam], tagWissel(tracks, naam) === 'aan');
  }

  async inCategorie(id, ids, { voor = null } = {}) {
    const c = this.stand.categorieen.find((x) => x.id === id);
    try {
      const r = await json('/api/indeling/categorie/nummers', { id, ids, aan: true, ...(voor ? { voor } : {}) });
      this.p.meld(voor ? `${ids.length} verplaatst in "${c?.naam}"` : `${r.erin} erin, ${ids.length - r.erin - r.onbekend.length} stonden er al in "${c?.naam}" (${r.aantal})`, true);
      await this.ververs();
      this.p.ververs();
    } catch (err) { this.p.meld(`categorie: ${err.message}`, false); }
  }

  async uitCategorie(id, ids) {
    try {
      const r = await json('/api/indeling/categorie/nummers', { id, ids, aan: false });
      this.p.meld(`${r.eruit} uit de categorie`, true);
      await this.ververs();
      this.p.ververs();
    } catch (err) { this.p.meld(`categorie: ${err.message}`, false); }
  }

  async maakCategorie(naam, soort) {
    try {
      const body = { naam, soort };
      if (soort === 'slim') {
        const { filter } = this.lees();
        if (!Object.keys(filter).length) { this.p.meld('een slimme categorie bewaart het filter: typ eerst iets in het zoekveld (bv. #dub bpm:70-90 grid:zeker)', false); return null; }
        const { categorie, ...rest } = filter;
        body.regel = rest;
        if (categorie != null) {
          const c = this.stand.categorieen.find((x) => x.id === categorie);
          if (c?.soort === 'gewoon') body.regel.categorie = categorie;
          else if (c) Object.assign(body.regel, c.regel);   // vanuit een slimme: zijn regel erbij
        }
      }
      const r = await json('/api/indeling/categorie', body);
      await this.ververs();
      this.p.meld(`categorie "${r.categorie.naam}" ${soort === 'slim' ? '(slim) ' : ''}gemaakt${soort === 'gewoon' ? ': sleep nummers erheen, of kies nummers en "→ categorie"' : ''}`, true);
      // Het filter zit nu in de regel: in het veld staat alleen nog de slimme categorie.
      if (soort === 'slim') this.zetFilter({ categorie: r.categorie.id });
      return r.categorie;
    } catch (err) { this.p.meld(`categorie niet gemaakt: ${err.message}`, false); return null; }
  }

  async bewerkCategorie(id, velden) {
    try { await json('/api/indeling/categorie', { id, ...velden }); await this.ververs(); this.p.ververs(); return true; } catch (err) { this.p.meld(`categorie: ${err.message}`, false); return false; }
  }

  async wisCategorie(id) {
    const c = this.stand.categorieen.find((x) => x.id === id);
    if (!c) return;
    if (!this.p.bevestigd('wis-cat', id)) { this.p.meld(`categorie "${c.naam}" wissen? De nummers blijven in de library. Klik nog eens`, false); return; }
    try {
      let r;
      try { r = await json('/api/indeling/categorie/wis', { id }); } catch (err) {
        if (err.code !== 409) throw err;
        if (!this.p.bevestigd('wis-cat-regel', id)) { this.p.meld(`${err.message}: nog eens om toch te wissen (die zoekt dan in de hele library)`, false); return; }
        r = await json('/api/indeling/categorie/wis', { id, forceer: true });
      }
      if (this.lees().filter.categorie === id) this.kiesCategorie(null);
      this.menu = null;
      this.p.meld(`categorie "${r.weg}" weg (${r.nummers} nummers, die blijven in de library)`, true);
      await this.ververs();
    } catch (err) { this.p.meld(`wissen mislukt: ${err.message}`, false); }
  }

  async bewerkTag(naam, velden) {
    try {
      let r;
      try { r = await json('/api/indeling/tags/tag', { naam, ...velden }); } catch (err) {
        if (err.code !== 409 || !err.extra?.bestaat) throw err;
        if (!this.p.bevestigd('samen', `${naam}>${velden.nieuw}`)) { this.p.meld(`"${err.extra.bestaat}" bestaat al: nog eens om #${naam} erin samen te voegen`, false); return false; }
        r = await json('/api/indeling/tags/tag', { naam, ...velden, samenvoegen: true });
      }
      if (velden.nieuw) {
        // Staat de oude naam in het zoekveld, dan de nieuwe erin.
        const { filter } = this.lees();
        const oud = sleutelVan(naam), nieuw = sleutelVan(r.tag.naam);
        if (filter.tags) for (const k of ['en', 'of', 'niet']) filter.tags[k] = [...new Set(filter.tags[k].map((x) => (x === oud ? nieuw : x)))];
        await this.ververs();
        this.zetFilter(filter);
      } else await this.ververs();
      this.p.ververs();
      return true;
    } catch (err) { this.p.meld(`tag: ${err.message}`, false); return false; }
  }

  async wisTag(naam) {
    const t = this.stand.tags.find((x) => x.sleutel === sleutelVan(naam));
    if (!this.p.bevestigd('wis-tag', naam)) { this.p.meld(`#${t?.naam ?? naam} van ${t?.aantal ?? 0} nummers afhalen en wissen? Klik nog eens`, false); return; }
    try {
      let r;
      try { r = await json('/api/indeling/tags/wis', { naam }); } catch (err) {
        if (err.code !== 409) throw err;
        if (!this.p.bevestigd('wis-tag-regel', naam)) { this.p.meld(`${err.message}: nog eens om toch te wissen (die regels worden ruimer)`, false); return; }
        r = await json('/api/indeling/tags/wis', { naam, forceer: true });
      }
      this.menu = null;
      this.p.meld(`#${r.weg} weg (van ${r.nummers} nummers)`, true);
      const { filter } = this.lees();
      if (filter.tags) { for (const k of ['en', 'of', 'niet']) filter.tags[k] = filter.tags[k].filter((x) => x !== sleutelVan(naam)); this.zetFilter(filter); }
      await this.ververs();
      this.p.ververs();
    } catch (err) { this.p.meld(`wissen mislukt: ${err.message}`, false); }
  }

  async zetSnel(k, naam) {
    const s = [...this.stand.snel];
    for (let i = 0; i < s.length; i++) if (s[i] && naam && sleutelVan(s[i]) === sleutelVan(naam)) s[i] = null;
    s[k - 1] = naam;
    try { await json('/api/indeling/tags/snel', { snel: s }); await this.ververs(); } catch (err) { this.p.meld(`snel-tag: ${err.message}`, false); }
  }

  /** Een krat van de kaart overnemen als categorie (kaart-panel.js). */
  async vanKaart(krat) {
    try {
      const r = await json('/api/indeling/categorie/van-kaart', { krat });
      this.p.meld(`krat → categorie "${r.categorie.naam}": ${r.erin} erbij (${r.binnen} van de krat zijn binnen, ${r.aantal} in de categorie)`, true);
      await this.ververs();
      return r;
    } catch (err) { this.p.meld(`overnemen mislukt: ${err.message}`, false); return null; }
  }

  // ---- tekenen -------------------------------------------------------------------------------

  _bouwBalk() {
    const b = this.el.balk;
    b.innerHTML = `<button class="ik-kolomknop" title="de kolom indeling links open/dicht (dicht: alle kolommen, ook LUFS en racks)">☰ indeling</button>
      <span class="ik-chips"></span>
      <span class="ik-ruimte"></span>
      <span class="ik-sel"></span>
      <input class="ik-tagveld" type="text" list="ik-taglijst" placeholder="tag… (alt+T)" spellcheck="false"
        title="tags op wat gekozen is: typ en Enter (meer met een komma, -naam = eraf). Alt+T hierheen, alt+1…8 = snel-tag">
      <datalist id="ik-taglijst"></datalist>
      <select class="ik-incat" title="wat gekozen is in een categorie zetten"><option value="">→ categorie</option></select>
      <span class="ik-snel"></span>`;
    this.el.chips = b.querySelector('.ik-chips');
    this.el.sel = b.querySelector('.ik-sel');
    this.el.tagveld = b.querySelector('.ik-tagveld');
    this.el.taglijst = b.querySelector('#ik-taglijst');
    this.el.incat = b.querySelector('.ik-incat');
    this.el.snel = b.querySelector('.ik-snel');
    this.el.knopKolom = b.querySelector('.ik-kolomknop');
    this.el.knopKolom.classList.toggle('on', this.open);
    this.el.knopKolom.addEventListener('click', () => this.zetOpen(!this.open));
    this.el.tagveld.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.el.tagveld.blur(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const { erbij, eraf, fout } = leesTagInvoer(this.el.tagveld.value);
      if (fout.length) { this.p.meld(`geen tag: ${fout.join(', ')} (geen , | # @ ")`, false); return; }
      const ids = this.p.doelIds();
      (async () => {
        if (erbij.length) await this.zetTags(ids, erbij, true);
        if (eraf.length) await this.zetTags(ids, eraf, false);
        if (erbij.length || eraf.length) this.el.tagveld.value = '';
      })();
    });
    this.el.incat.addEventListener('change', () => {
      const id = Number(this.el.incat.value);
      this.el.incat.value = '';
      if (!id) return;
      const ids = this.p.doelIds();
      if (!ids.length) { this.p.meld('kies eerst een nummer', false); return; }
      this.inCategorie(id, ids);
    });
    b.addEventListener('click', (e) => {
      const chip = e.target.closest('button[data-chip]');
      if (chip) { const c = this._chips?.[Number(chip.dataset.chip)]; if (c) this.zetFilter(c.zonder); return; }
      const sn = e.target.closest('button[data-snel]');
      if (sn) this.snel(Number(sn.dataset.snel));
      if (e.target.closest('button[data-plek]')) return this.p.zetPlek?.(!this.p.plekAan?.());
      const uit = e.target.closest('button[data-uitcat]');
      if (uit) this.uitCategorie(Number(uit.dataset.uitcat), this.p.doelIds());
    });
  }

  /** Alles tekenen (na een nieuwe stand of een ander filter). Alleen wat verandert. */
  teken() {
    if (!this.aan) return;
    this._tekenKolom();
    this.tekenBalk();
  }

  _zet(el, html, sleutel = '_html') {
    if (el[sleutel] === html) return;
    el[sleutel] = html;
    el.innerHTML = html;
  }

  _tekenKolom() {
    const { filter } = this.lees();
    const cats = this.stand.categorieen;
    const m = this.menu;
    const kleurKiezer = (soort, sleutel, huidig) => `<span class="ik-kleuren">${KLEUREN.map((k) => `<button class="ik-kleur ik-${k}${huidig === k ? ' on' : ''}" data-kleur="${k}" data-${soort}-kleur="${esc(sleutel)}" title="${k}"></button>`).join('')}</span>`;
    const menuCat = (c) => (m?.soort === 'cat' && m.sleutel === c.id ? `<div class="ik-menu">
        <input class="ik-hernoem" data-hernoem-cat="${c.id}" value="${esc(c.naam)}" spellcheck="false" title="nieuwe naam, Enter">
        ${kleurKiezer('cat', c.id, c.kleur)}
        ${c.soort === 'slim' ? `<button class="btn sm" data-regel="${c.id}" title="de regel van deze slimme categorie in het zoekveld (bewerken en dan ✓)">regel</button>
          <button class="btn sm" data-regel-nu="${c.id}" title="het filter van nu als regel van deze slimme categorie">✓ filter</button>` : ''}
        <button class="btn sm ik-wis" data-wis-cat="${c.id}" title="wissen (tweede klik); de nummers blijven in de library">wis</button>
      </div>` : '');
    const catRij = (c) => `<div class="ik-item ik-cat${filter.categorie === c.id ? ' on' : ''}" data-cat="${c.id}" data-soort="${c.soort}" tabindex="0"
        title="${esc(c.soort === 'slim' ? `slim: ${zoekregelVan(c.regel ?? {}, { categorieen: cats })}` : `${c.naam}: klik = alleen deze; sleep nummers hierheen`)}">
        <i class="ik-stip ik-${esc(c.kleur ?? 'grijs')}"></i><span class="ik-naam">${c.soort === 'slim' ? '✦ ' : ''}${esc(c.naam)}</span><b>${c.aantal ?? '?'}</b>
        <button class="ik-meer" data-menu-cat="${c.id}" title="hernoemen, kleur, wissen">⋯</button></div>${menuCat(c)}`;
    const tags = this.stand.tags;
    const inFilter = (s) => (filter.tags?.en.includes(s) || filter.tags?.of.includes(s) ? 'on' : filter.tags?.niet.includes(s) ? 'niet' : '');
    const snelVan = (s) => this.stand.snel.findIndex((x) => x && sleutelVan(x) === s) + 1;
    const menuTag = (t) => (m?.soort === 'tag' && m.sleutel === t.sleutel ? `<div class="ik-menu">
        <input class="ik-hernoem" data-hernoem-tag="${esc(t.naam)}" value="${esc(t.naam)}" spellcheck="false" title="nieuwe naam, Enter (een bestaande naam = samenvoegen)">
        ${kleurKiezer('tag', t.naam, t.kleur)}
        <span class="ik-snelkies">snel ${Array.from({ length: SNEL }, (_, i) => `<button class="ik-snelnr${snelVan(t.sleutel) === i + 1 ? ' on' : ''}" data-snelzet="${i + 1}" data-snelnaam="${esc(t.naam)}" title="snel-tag ${i + 1} (alt+${i + 1})">${i + 1}</button>`).join('')}</span>
        <button class="btn sm ik-wis" data-wis-tag="${esc(t.naam)}" title="van alle nummers af en wissen (tweede klik)">wis</button>
      </div>` : '');
    const html = `<div class="ik-kop">CATEGORIEËN<span class="ik-ruimte"></span>
        <button class="btn sm" data-nieuw="gewoon" title="een nieuwe categorie (een eigen bak, met volgorde)">+</button>
        <button class="btn sm" data-nieuw="slim" title="het filter van nu bewaren als slimme categorie (werkt zichzelf bij)">+ ✦</button></div>
      ${this.nieuw ? `<div class="ik-menu"><input class="ik-nieuwnaam" placeholder="${this.nieuw === 'slim' ? 'naam van de slimme categorie' : 'naam van de categorie'}" spellcheck="false" title="Enter = maken, Esc = niet"></div>` : ''}
      <div class="ik-item ik-alles${filter.categorie == null ? ' on' : ''}" data-cat="" tabindex="0" title="de hele library"><span class="ik-naam">alles</span></div>
      ${cats.map(catRij).join('')}
      <div class="ik-kop ik-tagkop">TAGS<span class="ik-ruimte"></span><span class="ik-hint" title="klik = filter, alt-klik = niet">${tags.length || ''}</span></div>
      <div class="ik-tags">${tags.length ? tags.map((t) => `<span class="ik-tagrij"><button class="ik-chip ik-${esc(t.kleur ?? 'grijs')} ${inFilter(t.sleutel)}" data-tagfilter="${esc(t.naam)}"
        title="#${esc(t.naam)}: ${t.aantal} nummers — klik = filter, alt-klik = niet${snelVan(t.sleutel) ? `, snel-tag ${snelVan(t.sleutel)}` : ''}">${snelVan(t.sleutel) ? `<sup>${snelVan(t.sleutel)}</sup>` : ''}${esc(t.naam)} <b>${t.aantal}</b></button><button class="ik-meer" data-menu-tag="${esc(t.sleutel)}" title="hernoemen, kleur, snel-tag, wissen">⋯</button></span>${menuTag(t)}`).join('')
    : '<span class="ik-leeg">nog geen tags: kies nummers en typ er een in het tagveld</span>'}</div>`;
    this._zet(this.el.kolom, html);
    if (this.nieuw) this.el.kolom.querySelector('.ik-nieuwnaam')?.focus();
  }

  /** De tagbalk: chips van het filter, wat gekozen is, de keuzelijst en de snel-tags. */
  tekenBalk() {
    if (!this.aan) return;
    const { filter, onbekend } = this.lees();
    const chips = chipsVan(filter, { tags: this._tagMap(), categorieen: this.stand.categorieen });
    this._chips = chips;
    this._zet(this.el.chips, chips.map((c, i) => `<button class="ik-chip ik-filter ik-${esc(c.kleur ?? 'grijs')}${c.soort === 'niet' ? ' niet' : ''}${c.onbekend ? ' onbekend' : ''}" data-chip="${i}"
      title="${c.onbekend ? 'die tag bestaat (nog) niet: niets gevonden — ' : ''}× = uit het filter">${esc(c.tekst)} ×</button>`).join('')
      + onbekend.map((w) => `<span class="ik-onbekend" title="begrijp ik niet: ${esc(w)} (bpm:70-90, toon:8A, grid:zeker, stems, energie:hoog, #tag, -#tag, @categorie)">? ${esc(w)}</span>`).join(''));
    const ids = this.p.doelIds();
    const meer = this.p.selectieGrootte?.() ?? 0;
    const c = this.stand.categorieen.find((x) => x.id === filter.categorie);
    const plek = this.plekMogelijk(filter) ? `<button class="btn sm ik-plek${this.p.plekAan?.() ? ' on' : ''}" data-plek="1" title="de volgorde van de categorie (sleep rijen om hem te verzetten); uit = de kolom waarop je sorteert">↕ volgorde</button> ` : '';
    const een = ids.length === 1 ? this.p.track(ids[0]) : null;
    this._zet(this.el.sel, plek + (meer > 1 ? `<b>${meer} gekozen</b>` : een ? `<span class="ik-een" title="taggen en → categorie gaan naar dit nummer (cmd-klik of shift-klik = meer)">→ ${esc(een.titel)}</span>` : '')
      + (c?.soort === 'gewoon' && ids.length ? ` <button class="btn sm" data-uitcat="${c.id}" title="wat gekozen is uit "${esc(c.naam)}" halen (de nummers blijven in de library)">uit ${esc(c.naam)}</button>` : ''));
    this._zet(this.el.taglijst, this.stand.tags.map((t) => `<option value="${esc(t.naam)}"></option>`).join(''));
    this._zet(this.el.incat, `<option value="">→ categorie</option>${this.stand.categorieen.filter((x) => x.soort === 'gewoon').map((x) => `<option value="${x.id}">${esc(x.naam)}</option>`).join('')}`);
    const doel = ids.map((id) => this.p.track(id)).filter(Boolean);
    this._zet(this.el.snel, this.stand.snel.map((n, i) => (n ? `<button class="btn sm ik-snelknop ik-${esc(this.kleuren.get(sleutelVan(n)) ?? 'grijs')}${doel.length && tagWissel(doel, n) === 'uit' ? ' on' : ''}" data-snel="${i + 1}"
      title="snel-tag ${i + 1}: #${esc(n)} aan/uit op wat gekozen is (alt+${i + 1})">${i + 1} ${esc(n)}</button>` : '')).join(''));
  }

  _markeerDrop(el) {
    for (const x of this.el.kolom.querySelectorAll('.drop')) if (x !== el) x.classList.remove('drop');
    el?.classList.add('drop');
  }

  _klikKolom(e) {
    const t = e.target;
    const nieuw = t.closest('button[data-nieuw]');
    if (nieuw) { this.nieuw = this.nieuw === nieuw.dataset.nieuw ? null : nieuw.dataset.nieuw; return this._tekenKolom(); }
    const mc = t.closest('button[data-menu-cat]');
    if (mc) { const id = Number(mc.dataset.menuCat); this.menu = this.menu?.soort === 'cat' && this.menu.sleutel === id ? null : { soort: 'cat', sleutel: id }; return this._tekenKolom(); }
    const mt = t.closest('button[data-menu-tag]');
    if (mt) { const s = mt.dataset.menuTag; this.menu = this.menu?.soort === 'tag' && this.menu.sleutel === s ? null : { soort: 'tag', sleutel: s }; return this._tekenKolom(); }
    const kl = t.closest('button[data-kleur]');
    if (kl) {
      const k = kl.classList.contains('on') ? null : kl.dataset.kleur;
      if (kl.dataset.catKleur) return this.bewerkCategorie(Number(kl.dataset.catKleur), { kleur: k });
      if (kl.dataset.tagKleur) return this.bewerkTag(kl.dataset.tagKleur, { kleur: k });
    }
    const sz = t.closest('button[data-snelzet]');
    if (sz) return this.zetSnel(Number(sz.dataset.snelzet), sz.classList.contains('on') ? null : sz.dataset.snelnaam);
    const wc = t.closest('button[data-wis-cat]');
    if (wc) return this.wisCategorie(Number(wc.dataset.wisCat));
    const wt = t.closest('button[data-wis-tag]');
    if (wt) return this.wisTag(wt.dataset.wisTag);
    const rg = t.closest('button[data-regel]');
    if (rg) {
      const c = this.stand.categorieen.find((x) => x.id === Number(rg.dataset.regel));
      if (c) { this.p.zetZoekTekst(zoekregelVan(c.regel ?? {}, { categorieen: this.stand.categorieen })); this.p.meld(`de regel van "${c.naam}" staat in het zoekveld: pas aan en klik ✓ filter`, true); }
      return;
    }
    const rn = t.closest('button[data-regel-nu]');
    if (rn) {
      const id = Number(rn.dataset.regelNu);
      const { categorie, ...regel } = this.lees().filter;
      if (categorie != null && categorie !== id) {
        const c = this.stand.categorieen.find((x) => x.id === categorie);
        if (c?.soort === 'gewoon') regel.categorie = categorie;
      }
      return this.bewerkCategorie(id, { regel }).then((goed) => { if (goed) { this.p.meld('regel bewaard', true); this.kiesCategorie(id); } });
    }
    const tf = t.closest('button[data-tagfilter]');
    if (tf) return this.wisselTagFilter(tf.dataset.tagfilter, e.altKey);
    if (t.closest('.ik-menu') || t.closest('input')) return;
    const cat = t.closest('[data-cat]');
    if (cat) return this.kiesCategorie(cat.dataset.cat ? Number(cat.dataset.cat) : null);
  }

  _toetsKolom(e) {
    const t = e.target;
    if (t.classList.contains('ik-nieuwnaam')) {
      if (e.key === 'Escape') { this.nieuw = null; this._tekenKolom(); return; }
      if (e.key !== 'Enter') return;
      const naam = geldigeNaam(t.value, 60);
      if (!naam) { this.p.meld('een naam van 1–60 tekens, zonder , | # @ "', false); return; }
      const soort = this.nieuw;
      this.nieuw = null;
      this.maakCategorie(naam, soort);
      return;
    }
    if (t.dataset.hernoemCat && e.key === 'Enter') {
      const naam = geldigeNaam(t.value, 60);
      if (naam) this.bewerkCategorie(Number(t.dataset.hernoemCat), { naam }).then((goed) => { if (goed) { this.menu = null; this._tekenKolom(); } });
      return;
    }
    if (t.dataset.hernoemTag && e.key === 'Enter') {
      const naam = geldigeNaam(t.value);
      if (naam && naam !== t.dataset.hernoemTag) this.bewerkTag(t.dataset.hernoemTag, { nieuw: naam }).then((goed) => { if (goed) { this.menu = null; this._tekenKolom(); } });
      return;
    }
    if (e.key === 'Escape' && (t.dataset.hernoemCat || t.dataset.hernoemTag)) { this.menu = null; this._tekenKolom(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && t.matches('.ik-item[data-cat]')) { e.preventDefault(); this.kiesCategorie(t.dataset.cat ? Number(t.dataset.cat) : null); }
  }
}

/** De ids uit een sleep (NUMMERS_MIME), of null. */
export function leesSleep(e) {
  try {
    const ids = JSON.parse(e.dataTransfer.getData(NUMMERS_MIME) || 'null');
    return Array.isArray(ids) && ids.length && ids.every((x) => typeof x === 'string') ? ids : null;
  } catch (_) { return null; }
}
