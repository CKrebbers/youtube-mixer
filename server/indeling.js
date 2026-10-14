import {
  KLEUREN, SNEL, MAX_TAGS, MAX_CATEGORIEEN, MAX_IDS, MAX_CATEGORIE_NAAM, GRID_ZEKER,
  geldigeNaam, sleutelVan, normaliseerFilter, normaliseerRegel, normaliseerSnel, normaliseerIndeling,
  combineer, plekkenTussen,
} from '../src/library/indeling.js';

/**
 * De indeling van de library op de server (spoor S11, docs/LIBRARY-TAGS.md): tags, categorieën
 * (gewoon en slim), de snel-tags, en het filter als SQL. Werkt op de database van de Library
 * (schema v10); de Library maakt hem (`lib.indeling`). Elke schrijfactie is één transactie.
 *
 * Fouten met een code (de route geeft ze zo door): IndelingFout(400|404|409|413, tekst, extra).
 */
export class IndelingFout extends Error {
  constructor(code, bericht, extra = {}) { super(bericht); this.code = code; this.extra = extra; }
}

const isId = (x) => Number.isSafeInteger(x) && x > 0;
const isTrackId = (x) => typeof x === 'string' && /^[\w-]{1,80}$/.test(x);

export class Indeling {
  constructor(lib) {
    this.lib = lib;
    this.db = lib.db;
  }

  _q(sql) { return this.lib._q(sql); }

  /** fn in één transactie (BEGIN IMMEDIATE). Gooit fn, dan ROLLBACK. */
  _tx(fn) {
    if (this.db.isTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw err;
    }
  }

  // ---- tags ---------------------------------------------------------------------------------

  tag(naam) { return this._q('SELECT * FROM tags WHERE sleutel = ?').get(sleutelVan(naam)) ?? null; }

  /** Alle tags met hun aantal nummers, op naam. */
  tags() {
    return this._q(`SELECT g.naam, g.sleutel, g.kleur, COUNT(nt.track_id) AS aantal FROM tags g
      LEFT JOIN nummer_tags nt ON nt.tag_id = g.id GROUP BY g.id ORDER BY g.sleutel`).all()
      .map((r) => ({ naam: r.naam, sleutel: r.sleutel, kleur: r.kleur ?? null, aantal: r.aantal }));
  }

  /** Een tag op naam, of nieuw. Gooit bij een naam die niet mag of als er te veel zijn. */
  _maakTag(naam, kleur = null) {
    const n = geldigeNaam(naam);
    if (!n) throw new IndelingFout(400, `"${String(naam).slice(0, 40)}" mag geen tag zijn (1–40 tekens, geen , | # @ " en niet met - beginnen)`);
    const al = this.tag(n);
    if (al) return al;
    if (this._q('SELECT COUNT(*) AS n FROM tags').get().n >= MAX_TAGS) throw new IndelingFout(413, `hooguit ${MAX_TAGS} tags`);
    const id = this._q('INSERT INTO tags (naam, sleutel, kleur, gemaakt) VALUES (?,?,?,?)')
      .run(n, sleutelVan(n), KLEUREN.includes(kleur) ? kleur : null, Date.now()).lastInsertRowid;
    return this._q('SELECT * FROM tags WHERE id = ?').get(Number(id));
  }

  /**
   * Taggen in één keer (de selectie): `namen` op alle `ids` zetten (aan) of eraf halen. Nummers
   * die niet bestaan worden genoemd, niet getagd. Geeft { gezet, weg, onbekend, tags }.
   */
  zetTags(ids, namen, aan = true) {
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || !ids.every(isTrackId)) throw new IndelingFout(400, `ids: 1..${MAX_IDS} nummers`);
    if (!Array.isArray(namen) || !namen.length || namen.length > 20) throw new IndelingFout(400, 'tags: 1..20 namen');
    return this._tx(() => {
      const bestaat = new Set(this._ids(ids));
      const onbekend = ids.filter((id) => !bestaat.has(id));
      let gezet = 0, weg = 0;
      const tags = [];
      for (const naam of namen) {
        if (aan) {
          const t = this._maakTag(naam);
          tags.push(t.naam);
          const st = this._q('INSERT OR IGNORE INTO nummer_tags (track_id, tag_id, gezet) VALUES (?,?,?)');
          const nu = Date.now();
          for (const id of bestaat) gezet += Number(st.run(id, t.id, nu).changes);
        } else {
          const t = this.tag(naam);
          if (!t) continue;
          tags.push(t.naam);
          const st = this._q('DELETE FROM nummer_tags WHERE track_id = ? AND tag_id = ?');
          for (const id of bestaat) weg += Number(st.run(id, t.id).changes);
        }
      }
      return { gezet, weg, onbekend, tags };
    });
  }

  /** Welke van deze ids bestaan (in stukken: SQLite kent een grens aan het aantal ?). */
  _ids(ids) {
    const uit = [];
    for (let i = 0; i < ids.length; i += 500) {
      const deel = ids.slice(i, i + 500);
      uit.push(...this.db.prepare(`SELECT id FROM tracks WHERE id IN (${deel.map(() => '?').join(',')})`).all(...deel).map((r) => r.id));
    }
    return uit;
  }

  /** De tags van één nummer (namen, op sleutel). */
  tagsVan(trackId) {
    return this._q(`SELECT g.naam FROM nummer_tags nt JOIN tags g ON g.id = nt.tag_id WHERE nt.track_id = ? ORDER BY g.sleutel`).all(trackId).map((r) => r.naam);
  }

  /** Heeft dit nummer deze tag? */
  heeftTag(trackId, naam) {
    return !!this._q('SELECT 1 AS x FROM nummer_tags nt JOIN tags g ON g.id = nt.tag_id WHERE nt.track_id = ? AND g.sleutel = ?').get(trackId, sleutelVan(naam));
  }

  /**
   * Een tag hernoemen (`nieuw`) en/of zijn kleur zetten. Hernoemen naar een tag die al bestaat =
   * samenvoegen, alleen met `samenvoegen: true` (anders 409 met { bestaat }). De regels van de
   * slimme categorieën en de snel-tags gaan mee. Geeft de tag zoals hij nu is.
   */
  bewerkTag({ naam, nieuw = null, kleur, samenvoegen = false }) {
    return this._tx(() => {
      const t = this.tag(naam);
      if (!t) throw new IndelingFout(404, `geen tag "${naam}"`);
      if (kleur !== undefined) {
        if (kleur !== null && !KLEUREN.includes(kleur)) throw new IndelingFout(400, `kleur is ${KLEUREN.join(', ')} of null`);
        this._q('UPDATE tags SET kleur = ? WHERE id = ?').run(kleur, t.id);
      }
      if (nieuw == null) return this.tag(t.sleutel);
      const n = geldigeNaam(nieuw);
      if (!n) throw new IndelingFout(400, `"${String(nieuw).slice(0, 40)}" mag geen tag zijn`);
      const s = sleutelVan(n);
      const ander = s !== t.sleutel ? this.tag(s) : null;
      if (ander && !samenvoegen) throw new IndelingFout(409, `de tag "${ander.naam}" bestaat al: samenvoegen?`, { bestaat: ander.naam });
      if (ander) {
        this._q('INSERT OR IGNORE INTO nummer_tags (track_id, tag_id, gezet) SELECT track_id, ?, gezet FROM nummer_tags WHERE tag_id = ?').run(ander.id, t.id);
        this._q('DELETE FROM tags WHERE id = ?').run(t.id);
        if (kleur === undefined && !ander.kleur && t.kleur) this._q('UPDATE tags SET kleur = ? WHERE id = ?').run(t.kleur, ander.id);
      } else {
        this._q('UPDATE tags SET naam = ?, sleutel = ? WHERE id = ?').run(n, s, t.id);
      }
      this._herschrijfTag(t.sleutel, s);
      return this.tag(s);
    });
  }

  /**
   * Een tag wissen (van alle nummers). Gebruikt een slimme categorie hem, dan 409 met { gebruikt }
   * tenzij `forceer`: dan valt hij uit die regels (dat maakt ze ruimer, daarom eerst vragen).
   */
  wisTag(naam, { forceer = false } = {}) {
    return this._tx(() => {
      const t = this.tag(naam);
      if (!t) throw new IndelingFout(404, `geen tag "${naam}"`);
      const gebruikt = this._slimmeMetTag(t.sleutel);
      if (gebruikt.length && !forceer) throw new IndelingFout(409, `"${t.naam}" staat in de regel van ${gebruikt.map((c) => `"${c.naam}"`).join(', ')}`, { gebruikt: gebruikt.map((c) => c.naam) });
      const nummers = this._q('SELECT COUNT(*) AS n FROM nummer_tags WHERE tag_id = ?').get(t.id).n;
      this._q('DELETE FROM tags WHERE id = ?').run(t.id);
      this._herschrijfTag(t.sleutel, null);
      return { weg: t.naam, nummers, regels: gebruikt.map((c) => c.naam) };
    });
  }

  _slimmeMetTag(sleutel) {
    return this._slimme().filter((c) => ['en', 'of', 'niet'].some((k) => c.regel.tags?.[k]?.includes(sleutel)));
  }

  /** Een tag in alle regels en snel-tags vervangen (`naar` null = eruit). */
  _herschrijfTag(van, naar) {
    for (const c of this._slimme()) {
      const t = c.regel.tags;
      if (!t || !['en', 'of', 'niet'].some((k) => t[k].includes(van))) continue;
      const nieuw = {};
      for (const k of ['en', 'of', 'niet']) nieuw[k] = [...new Set(t[k].map((x) => (x === van ? naar : x)).filter(Boolean))];
      const regel = { ...c.regel, tags: nieuw };
      if (!nieuw.en.length && !nieuw.of.length && !nieuw.niet.length) delete regel.tags;
      this._q('UPDATE categorieen SET regel = ?, gewijzigd = ? WHERE id = ?').run(JSON.stringify(regel), Date.now(), c.id);
    }
    const snel = this.snel();
    if (snel.some((x) => x && sleutelVan(x) === van)) {
      const naam = naar ? this.tag(naar)?.naam ?? null : null;
      this._zetSnel(snel.map((x) => (x && sleutelVan(x) === van ? naam : x)));
    }
  }

  // ---- snel-tags ------------------------------------------------------------------------------

  /** De acht snel-tags (namen of null). */
  snel() {
    const s = normaliseerSnel(this.lib.haal('snel_tags', null) ?? []);
    return s ?? Array(SNEL).fill(null);
  }

  /** De snel-tags zetten; een naam die nog geen tag is wordt er een. */
  zetSnel(lijst) {
    const s = normaliseerSnel(lijst);
    if (!s) throw new IndelingFout(400, `snel: ${SNEL} tagnamen of null`);
    return this._tx(() => this._zetSnel(s.map((n) => (n ? this._maakTag(n).naam : null))));
  }

  _zetSnel(s) { this.lib.zet('snel_tags', s); return s; }

  // ---- categorieën ------------------------------------------------------------------------------

  _rij(r) {
    return { id: r.id, naam: r.naam, soort: r.soort, kleur: r.kleur ?? null, volgorde: r.volgorde,
      regel: r.soort === 'slim' ? veilig(r.regel) ?? {} : null };
  }

  categorie(id) { const r = this._q('SELECT * FROM categorieen WHERE id = ?').get(id); return r ? this._rij(r) : null; }
  _categorieOpNaam(naam) { const r = this._q('SELECT * FROM categorieen WHERE sleutel = ?').get(sleutelVan(naam)); return r ? this._rij(r) : null; }
  _slimme() { return this._q("SELECT * FROM categorieen WHERE soort = 'slim'").all().map((r) => this._rij(r)); }

  /** Alle categorieën op volgorde, met hun aantal (een slimme: wat zijn regel nu vindt). */
  categorieen() {
    const tel = new Map(this._q('SELECT categorie_id AS c, COUNT(*) AS n FROM categorie_nummers GROUP BY categorie_id').all().map((r) => [r.c, r.n]));
    return this._q('SELECT * FROM categorieen ORDER BY volgorde, id').all().map((r) => {
      const c = this._rij(r);
      if (c.soort === 'gewoon') return { ...c, aantal: tel.get(c.id) ?? 0 };
      let aantal = null;
      try { aantal = this.lib.aantalTracks({ filter: { categorie: c.id } }); } catch { aantal = null; }
      return { ...c, aantal };
    });
  }

  /** Alles wat het paneel nodig heeft in één keer. */
  stand() { return { tags: this.tags(), categorieen: this.categorieen(), snel: this.snel() }; }

  /**
   * Een regel controleren voor in de database: `categorie` (naam of id) moet een GEWONE categorie
   * zijn (geen slim in slim). Geeft de regel met het id.
   */
  _regelVoorDb(regel, eigenId = null) {
    const n = normaliseerRegel(regel ?? {});
    if (n.fouten.length) throw new IndelingFout(400, `regel: ${n.fouten.join('; ')}`);
    const r = n.regel;
    if (r.categorie != null) {
      const c = typeof r.categorie === 'string' ? this._categorieOpNaam(r.categorie) : this.categorie(r.categorie);
      if (!c) throw new IndelingFout(400, `regel: geen categorie "${r.categorie}"`);
      if (c.soort !== 'gewoon' || c.id === eigenId) throw new IndelingFout(400, 'regel: een slimme categorie kan alleen binnen een gewone categorie zoeken');
      r.categorie = c.id;
    }
    return r;
  }

  /** Maken (zonder id) of bijwerken. Een naam die al bestaat = 409. Geeft de categorie. */
  bewaarCategorie({ id = null, naam, soort, regel, kleur }) {
    return this._tx(() => {
      const oud = id != null ? this.categorie(id) : null;
      if (id != null && !oud) throw new IndelingFout(404, 'geen categorie met dat id');
      const n = naam !== undefined ? geldigeNaam(naam, MAX_CATEGORIE_NAAM) : oud?.naam;
      if (!n) throw new IndelingFout(400, `een naam van 1–${MAX_CATEGORIE_NAAM} tekens, zonder , | # @ "`);
      const ander = this._categorieOpNaam(n);
      if (ander && ander.id !== id) throw new IndelingFout(409, `er is al een categorie "${ander.naam}"`, { bestaat: ander.id });
      const s = oud ? oud.soort : soort;
      if (oud && soort != null && soort !== oud.soort) throw new IndelingFout(400, 'de soort van een categorie verandert niet');
      if (!['gewoon', 'slim'].includes(s)) throw new IndelingFout(400, 'soort is gewoon of slim');
      if (kleur !== undefined && kleur !== null && !KLEUREN.includes(kleur)) throw new IndelingFout(400, `kleur is ${KLEUREN.join(', ')} of null`);
      const r = s === 'slim' ? (regel !== undefined ? this._regelVoorDb(regel, id) : oud?.regel ?? this._regelVoorDb({})) : null;
      const nu = Date.now();
      if (!oud) {
        if (this._q('SELECT COUNT(*) AS n FROM categorieen').get().n >= MAX_CATEGORIEEN) throw new IndelingFout(413, `hooguit ${MAX_CATEGORIEEN} categorieën`);
        const volgorde = (this._q('SELECT MAX(volgorde) AS m FROM categorieen').get().m ?? 0) + 1;
        id = Number(this._q('INSERT INTO categorieen (naam, sleutel, soort, regel, kleur, volgorde, gemaakt, gewijzigd) VALUES (?,?,?,?,?,?,?,?)')
          .run(n, sleutelVan(n), s, r ? JSON.stringify(r) : null, kleur ?? null, volgorde, nu, nu).lastInsertRowid);
      } else {
        this._q('UPDATE categorieen SET naam = ?, sleutel = ?, regel = ?, kleur = ?, gewijzigd = ? WHERE id = ?')
          .run(n, sleutelVan(n), r ? JSON.stringify(r) : null, kleur !== undefined ? kleur : oud.kleur, nu, id);
      }
      return this.categorie(id);
    });
  }

  /**
   * Een categorie wissen (de nummers blijven in de library). Zoekt een slimme categorie erin, dan
   * 409 met { gebruikt } tenzij `forceer` (dan zoekt die weer in de hele library).
   */
  wisCategorie(id, { forceer = false } = {}) {
    return this._tx(() => {
      const c = this.categorie(id);
      if (!c) throw new IndelingFout(404, 'geen categorie met dat id');
      const gebruikt = this._slimme().filter((x) => x.regel.categorie === id);
      if (gebruikt.length && !forceer) throw new IndelingFout(409, `${gebruikt.map((x) => `"${x.naam}"`).join(', ')} zoekt in "${c.naam}"`, { gebruikt: gebruikt.map((x) => x.naam) });
      for (const x of gebruikt) {
        const { categorie: _, ...regel } = x.regel;
        this._q('UPDATE categorieen SET regel = ?, gewijzigd = ? WHERE id = ?').run(JSON.stringify(regel), Date.now(), x.id);
      }
      const nummers = this._q('SELECT COUNT(*) AS n FROM categorie_nummers WHERE categorie_id = ?').get(id).n;
      this._q('DELETE FROM categorieen WHERE id = ?').run(id);
      return { weg: c.naam, nummers, regels: gebruikt.map((x) => x.naam) };
    });
  }

  /** De nummers van een gewone categorie, op plek. */
  nummersVan(id) {
    return this._q('SELECT track_id FROM categorie_nummers WHERE categorie_id = ? ORDER BY plek, track_id').all(id).map((r) => r.track_id);
  }

  /**
   * Nummers in een gewone categorie zetten of eruit halen.
   * - aan, zonder `voor`: wat er nog niet in staat komt ACHTERAAN (in de volgorde van `ids`); wat er
   *   al in staat houdt zijn plek.
   * - aan, met `voor` (een nummer in de categorie): alle `ids` komen vlak vóór dat nummer, ook als ze
   *   er al in stonden (zo sleep je de volgorde om). `voor: null` met `naarEind` = achteraan.
   * - uit: eruit.
   * Geeft { erin, eruit, verplaatst, onbekend, aantal }.
   */
  zetNummers(id, ids, { aan = true, voor = null, naarEind = false } = {}) {
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || !ids.every(isTrackId)) throw new IndelingFout(400, `ids: 1..${MAX_IDS} nummers`);
    return this._tx(() => {
      const c = this.categorie(id);
      if (!c) throw new IndelingFout(404, 'geen categorie met dat id');
      if (c.soort !== 'gewoon') throw new IndelingFout(400, 'een slimme categorie vult zichzelf: zet tags of verander zijn regel');
      const uniek = [...new Set(ids)];
      const bestaat = new Set(this._ids(uniek));
      const onbekend = uniek.filter((x) => !bestaat.has(x));
      const lijst = uniek.filter((x) => bestaat.has(x));
      let erin = 0, eruit = 0, verplaatst = 0;
      if (!aan) {
        const st = this._q('DELETE FROM categorie_nummers WHERE categorie_id = ? AND track_id = ?');
        for (const x of lijst) eruit += Number(st.run(id, x).changes);
        return { erin, eruit, verplaatst, onbekend, aantal: this._aantalIn(id) };
      }
      const al = new Set(this.nummersVan(id));
      const nu = Date.now();
      if (voor == null && !naarEind) {
        const nieuw = lijst.filter((x) => !al.has(x));
        const max = this._q('SELECT MAX(plek) AS m FROM categorie_nummers WHERE categorie_id = ?').get(id).m ?? 0;
        const st = this._q('INSERT INTO categorie_nummers (categorie_id, track_id, plek, gezet) VALUES (?,?,?,?)');
        nieuw.forEach((x, i) => st.run(id, x, max + i + 1, nu));
        return { erin: nieuw.length, eruit, verplaatst, onbekend, aantal: this._aantalIn(id) };
      }
      if (voor != null && (!isTrackId(voor) || !al.has(voor))) throw new IndelingFout(400, '"voor" staat niet in deze categorie');
      if (voor != null && lijst.includes(voor)) throw new IndelingFout(400, 'een nummer kan niet vóór zichzelf');
      // De plekken naast het gat, zonder de nummers die verhuizen.
      const plekken = () => this._q('SELECT track_id, plek FROM categorie_nummers WHERE categorie_id = ? ORDER BY plek, track_id').all(id)
        .filter((r) => !lijst.includes(r.track_id));
      let rest = plekken();
      const gat = () => {
        const i = voor == null ? rest.length : rest.findIndex((r) => r.track_id === voor);
        return plekkenTussen(i > 0 ? rest[i - 1].plek : null, i < rest.length ? rest[i].plek : null, lijst.length);
      };
      let p = gat();
      if (!p) {
        // Te vaak tussengevoegd: opnieuw nummeren (1, 2, 3 …), dan past het altijd.
        const st = this._q('UPDATE categorie_nummers SET plek = ? WHERE categorie_id = ? AND track_id = ?');
        rest.forEach((r, i) => st.run(i + 1, id, r.track_id));
        rest = plekken();
        p = gat();
      }
      const zet = this._q(`INSERT INTO categorie_nummers (categorie_id, track_id, plek, gezet) VALUES (?,?,?,?)
        ON CONFLICT (categorie_id, track_id) DO UPDATE SET plek = excluded.plek`);
      lijst.forEach((x, i) => { zet.run(id, x, p[i], nu); if (al.has(x)) verplaatst++; else erin++; });
      return { erin, eruit, verplaatst, onbekend, aantal: this._aantalIn(id) };
    });
  }

  _aantalIn(id) { return this._q('SELECT COUNT(*) AS n FROM categorie_nummers WHERE categorie_id = ?').get(id).n; }

  /** De volgorde van de categorieën zelf (de lijst links): ids in de nieuwe volgorde. */
  zetVolgorde(ids) {
    if (!Array.isArray(ids) || !ids.every(isId)) throw new IndelingFout(400, 'ids: categorie-ids');
    return this._tx(() => {
      const st = this._q('UPDATE categorieen SET volgorde = ? WHERE id = ?');
      ids.forEach((id, i) => st.run(i + 1, id));
      // Wat niet genoemd werd, komt erachter in zijn oude volgorde.
      const rest = this._q('SELECT id FROM categorieen ORDER BY volgorde, id').all().map((r) => r.id).filter((id) => !ids.includes(id));
      rest.forEach((id, i) => st.run(ids.length + i + 1, id));
      return this.categorieen().map((c) => c.id);
    });
  }

  // ---- het filter als SQL ------------------------------------------------------------------------

  /**
   * Het filter (normaliseerFilter) als WHERE-delen op `tracks t`, met eventueel een JOIN op de
   * categorie (voor sorteren op plek). Een slimme categorie wordt zijn regel en het filter samen.
   * Een tag die niet bestaat in `en` of `of` = niets gevonden (`leeg`), in `niet` telt hij niet.
   * Gooit IndelingFout(404) bij een categorie die niet bestaat.
   */
  sql(filter) {
    const delen = [], args = [];
    let f = filter ?? {};
    let gewoon = null;
    if (f.categorie != null) {
      const c = this.categorie(f.categorie);
      if (!c) throw new IndelingFout(404, 'geen categorie met dat id', { categorie: f.categorie });
      if (c.soort === 'slim') {
        const { categorie: _, ...rest } = f;
        const regel = { ...c.regel };
        f = combineer(regel, rest);
        if (regel.categorie != null) {
          const g = this.categorie(regel.categorie);
          if (g?.soort === 'gewoon') gewoon = g.id;
          else delete f.categorie;
        }
      } else gewoon = c.id;
    }
    if (gewoon != null) { delen.push('t.id IN (SELECT track_id FROM categorie_nummers WHERE categorie_id = ?)'); args.push(gewoon); }
    if (f.zoek) {
      const z = `%${String(f.zoek).replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      delen.push(`(t.titel LIKE ? ESCAPE '\\' OR t.uploader LIKE ? ESCAPE '\\' OR t.url LIKE ? ESCAPE '\\'
        OR t.id IN (SELECT nt.track_id FROM nummer_tags nt JOIN tags g ON g.id = nt.tag_id WHERE g.sleutel LIKE ? ESCAPE '\\'))`);
      args.push(z, z, z, `%${sleutelVan(f.zoek).replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    }
    let leeg = false;
    const tagId = (s) => this._q('SELECT id FROM tags WHERE sleutel = ?').get(s)?.id ?? null;
    if (f.tags) {
      for (const s of f.tags.en) {
        const id = tagId(s);
        if (id == null) { leeg = true; continue; }
        delen.push('t.id IN (SELECT track_id FROM nummer_tags WHERE tag_id = ?)'); args.push(id);
      }
      if (f.tags.of.length) {
        const ids = f.tags.of.map(tagId).filter((x) => x != null);
        if (!ids.length) leeg = true;
        else { delen.push(`t.id IN (SELECT track_id FROM nummer_tags WHERE tag_id IN (${ids.map(() => '?').join(',')}))`); args.push(...ids); }
      }
      const niet = f.tags.niet.map(tagId).filter((x) => x != null);
      if (niet.length) { delen.push(`t.id NOT IN (SELECT track_id FROM nummer_tags WHERE tag_id IN (${niet.map(() => '?').join(',')}))`); args.push(...niet); }
    }
    if (f.bpm) { delen.push('t.grid_bpm BETWEEN ? AND ?'); args.push(f.bpm[0], f.bpm[1]); }
    if (f.energie) { delen.push('t.k_energie BETWEEN ? AND ?'); args.push(f.energie[0], f.energie[1]); }
    if (f.toon?.length) { delen.push(`t.k_toon IN (${f.toon.map(() => '?').join(',')})`); args.push(...f.toon); }
    if (f.grid === 'zeker') delen.push(`t.k_grid IN (${GRID_ZEKER.map((x) => `'${x}'`).join(',')})`);
    else if (f.grid === 'onzeker') delen.push("t.k_grid IN ('onzeker','geenpuls')");
    else if (f.grid === 'geen') delen.push('t.k_grid IS NULL');
    if (f.stems === 'ja') delen.push('t.stems_json IS NOT NULL');
    else if (f.stems === 'nee') delen.push('t.stems_json IS NULL');
    else if (f.stems === '2' || f.stems === '4') { delen.push("json_extract(t.stems_json, '$.aantal') = ?"); args.push(Number(f.stems)); }
    if (leeg) { delen.length = 0; args.length = 0; delen.push('0'); }
    return { waar: delen.length ? `WHERE ${delen.join(' AND ')}` : '', args, gewoon };
  }

  // ---- de kaart -----------------------------------------------------------------------------------

  /**
   * Een krat van de muziekkaart overnemen als gewone categorie (een KOPIE: docs/LIBRARY-TAGS.md §1):
   * de nummers die binnen zijn, in de volgorde van de krat. Bestaat de categorie al (dezelfde naam),
   * dan komen alleen de nieuwe erbij, achteraan. `kaart` = de Kaart van server/kaart.js.
   */
  vanKaart(kaart, kratId, naam = null) {
    const stand = kaart?.laad?.();
    if (stand && stand.status !== 'geladen') throw new IndelingFout(404, `kaart ${stand.status}`);
    const k = kaart?.krat?.(kratId);
    if (!k) throw new IndelingFout(404, 'onbekende krat', { krat: kratId });
    const ids = [];
    for (let van = 0; van < 100000; van += 500) {
      const r = kaart.nummers({ krat: kratId, filter: 'binnen', sorteer: 'krat', van, aantal: 500 });
      ids.push(...(r.nummers ?? []).map((n) => n.binnen).filter(isTrackId));
      if ((r.nummers ?? []).length < 500) break;
    }
    const n = geldigeNaam(naam ?? k.naam ?? kratId, MAX_CATEGORIE_NAAM) ?? geldigeNaam(String(k.naam ?? 'krat').replace(/[,|#@"]/g, ' '), MAX_CATEGORIE_NAAM) ?? 'krat';
    return this._tx(() => {
      let c = this._categorieOpNaam(n);
      if (c && c.soort !== 'gewoon') throw new IndelingFout(409, `"${c.naam}" is een slimme categorie`);
      if (!c) c = this.bewaarCategorie({ naam: n, soort: 'gewoon' });
      const r = ids.length ? this.zetNummers(c.id, ids, { aan: true }) : { erin: 0, aantal: this._aantalIn(c.id) };
      return { categorie: this.categorie(c.id), erin: r.erin, binnen: ids.length, aantal: r.aantal };
    });
  }

  // ---- export / import -------------------------------------------------------------------------

  /** De hele indeling als JSON (namen, geen ids: ook voor Claude om te lezen en te schrijven). */
  exporteer() {
    const tags = this.tags().map(({ naam, kleur }) => ({ naam, kleur }));
    const naamVan = new Map(this._q('SELECT id, naam FROM categorieen').all().map((r) => [r.id, r.naam]));
    const categorieen = this._q('SELECT * FROM categorieen ORDER BY volgorde, id').all().map((r) => {
      const c = this._rij(r);
      const x = { naam: c.naam, soort: c.soort, kleur: c.kleur };
      if (c.soort === 'slim') {
        x.regel = { ...c.regel };
        if (x.regel.categorie != null) x.regel.categorie = naamVan.get(x.regel.categorie) ?? null;
        if (x.regel.categorie == null) delete x.regel.categorie;
      } else x.nummers = this.nummersVan(c.id);
      return x;
    });
    return { soort: 'varve-indeling', schema: 1, tags, categorieen, snel: this.snel() };
  }

  /**
   * Een indeling inlezen: SAMENVOEGEN, nooit wissen. Nieuwe tags en categorieën erbij; een gewone
   * categorie met dezelfde naam krijgt de nummers die ontbreken achteraan; een slimme met dezelfde
   * naam krijgt de nieuwe regel; `snel` vervangt de snel-tags. Nummers die er niet zijn: overgeslagen
   * en genoemd. `droog`: alles uitrekenen en terugdraaien. Geeft het verslag.
   */
  importeer(d, { droog = false } = {}) {
    const { indeling, fouten } = normaliseerIndeling(d);
    const verslag = { droog, tags: { nieuw: 0 }, categorieen: { nieuw: 0, bijgewerkt: 0 }, nummers: { erin: 0, onbekend: 0 }, fouten: [...fouten] };
    const werk = () => {
      for (const t of indeling.tags) {
        const al = this.tag(t.naam);
        if (!al) { this._maakTag(t.naam, t.kleur); verslag.tags.nieuw++; }
        else if (t.kleur && t.kleur !== al.kleur) this._q('UPDATE tags SET kleur = ? WHERE id = ?').run(t.kleur, al.id);
      }
      // Eerst de gewone (een slimme regel kan ernaar wijzen), dan de slimme.
      for (const soort of ['gewoon', 'slim']) {
        for (const c of indeling.categorieen.filter((x) => x.soort === soort)) {
          const al = this._categorieOpNaam(c.naam);
          try {
            if (al && al.soort !== c.soort) { verslag.fouten.push(`"${c.naam}" bestaat al als ${al.soort === 'slim' ? 'slimme' : 'gewone'} categorie`); continue; }
            const regel = soort === 'slim' ? this._regelVoorDb(c.regel) : undefined;
            const cat = this.bewaarCategorie({ id: al?.id ?? null, naam: c.naam, soort: c.soort, regel, ...(c.kleur ? { kleur: c.kleur } : {}) });
            if (al) verslag.categorieen.bijgewerkt++; else verslag.categorieen.nieuw++;
            if (soort === 'gewoon' && c.nummers.length) {
              const r = this.zetNummers(cat.id, c.nummers, { aan: true });
              verslag.nummers.erin += r.erin;
              verslag.nummers.onbekend += r.onbekend.length;
            }
          } catch (err) {
            if (!(err instanceof IndelingFout)) throw err;
            verslag.fouten.push(`"${c.naam}": ${err.message}`);
          }
        }
      }
      if (indeling.snel) this._zetSnel(indeling.snel.map((n) => (n ? this._maakTag(n).naam : null)));
    };
    if (this.db.isTransaction) throw new Error('importeer: al in een transactie');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      werk();
      this.db.exec(droog ? 'ROLLBACK' : 'COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw err;
    }
    return verslag;
  }
}

const veilig = (s) => { try { return JSON.parse(s); } catch { return null; } };

export { normaliseerFilter };
