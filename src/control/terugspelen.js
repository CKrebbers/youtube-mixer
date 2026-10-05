/**
 * Een handelingenlog terugspelen: dezelfde nummers op dezelfde tracks, en de
 * actions op dezelfde momenten opnieuw de bus op.
 *
 * "Hetzelfde moment" is gemeten op de AUDIOKLOK (regel 3): bij de start
 * wordt T0 = ctx.currentTime, en een regel met tijd t gaat de bus op zodra
 * de klok T0 + t passeert. De timer bepaalt alleen HOE VAAK we kijken (elke
 * 10 ms), niet WAAR we zijn. Een regel komt dus hooguit een tik te laat.
 *
 * Laden duurt. Een laad staat in het log op het moment dat hij KLAAR was,
 * met de duur erbij; terugspelen begint hem zoveel eerder, zodat hij rond
 * hetzelfde moment klaar is. Is hij dan nog niet klaar, dan wachten de
 * handelingen voor DIE track tot hij er is (ze komen dan wat later, en dat
 * wordt geteld); de andere tracks lopen gewoon door.
 *
 * De Terugspeler kent geen engine, DOM of server: wat een gebeurtenis
 * betekent (laden, een rack zetten) staat in `doe`. maakUitvoerder()
 * hieronder maakt die voor een engine; het laden zelf komt van de laadlaag
 * (ui/laden.js). Zo is alles in Node te testen met een nep-klok.
 *
 * MIDI en toetsenbord doen tijdens het terugspelen gewoon mee: je kunt er
 * live beeld overheen spelen (een set opnieuw renderen met andere visuals),
 * en een fader dichtdraaien moet altijd kunnen. Wil je een fout exact
 * naspelen: niets aanraken.
 */
import { PITCH_BEREIKEN, SPRONG_TELLEN, EQ_BANDEN } from '../engine/deck.js';

/**
 * Wat NIET opnieuw de bus op gaat:
 * - record.* en log.*: terugspelen start geen opname en geen log; dat doe je zelf.
 * - track.N.rack.next/prev: welk rack dat wordt hangt af van wat er NU bij
 *   het nummer in de library staat. De rack-gebeurtenis erna zegt precies
 *   welk rack het werd, en die wordt wel teruggezet.
 * - layer.*: welk mapje er op de APC open staat. Dat gaat over je handen,
 *   niet over wat er klinkt, en het zou de APC onder je vingers omzetten.
 * - track.N.key en track.N.key.*: de toonsoort CORRIGEREN. De kaart hoort
 *   bij de plaat in de library (TOONSOORT.md §7), en de correctie van toen
 *   is toen al bewaard: terugspelen laadt de kaart van nu, en er nog eens
 *   een kwint bij doen zou hem twee keer toepassen. Ze staan wel in het log.
 * - headphone.*, track.N.pfl en track.N.stem.<s>.pfl: de koptelefoon. De
 *   zaal hoort hem niet, dus voor wat er klinkt doet hij niets, en terugspelen
 *   zou de koptelefoon van nu omzetten. Ze staan wel in het log (docs/STUDIO.md
 *   §3, docs/STEMS.md §5).
 */
export const OVERSLAAN = /^(record\.|log\.|layer\.|headphone\.|track\.\d+\.rack\.(next|prev)$|track\.\d+\.key(\.|$)|track\.\d+\.pfl$|track\.\d+\.stem\.\w+\.pfl$)/;

/**
 * Actions die over het NUMMER gaan (transport, cues, loops, grid). Staat het
 * nummer van toen niet op de track (niet meer in de library, een los bestand,
 * laden mislukt), dan worden die overgeslagen: anders speelt `play` wat er
 * toevallig nog staat. Faders, EQ, focus en crossfaderkant gaan wel door:
 * die horen bij de track, niet bij het nummer, en gelden ook voor wat er
 * later in het log op geladen wordt.
 */
export const NUMMER_NODIG = /^track\.\d+\.(play|cue|sync|tap|hotcue\.|beatloop\.|loop\.|nudge\.|grid\.|stem\.|seek$|beatjump\.(back|fwd)$|brake$)/;

/** Het tracknummer van een action (`track.3.fader` -> 3), of null. */
export function trackVanActie(a) {
  const m = /^track\.(\d+)\./.exec(a);
  return m ? Number(m[1]) : null;
}

/**
 * Soorten gebeurtenissen die terugspelen kent; de rest wordt overgeslagen en
 * geteld. Een `stand` midden in het log (na de beginstand) komt van een
 * terugspelen dat toen liep terwijl dit log opnam: zie Terugspeler._stand.
 */
const SOORTEN = new Set(['laad', 'focus', 'rack', 'grid', 'hotcues', 'pads', 'stand']);

/**
 * Gebeurtenissen die over het NUMMER gaan, net als NUMMER_NODIG: staat het
 * nummer van toen niet op de track, dan niet toepassen. Anders kreeg een
 * gewoon geladen nummer (een laad die bij terugspelen mislukte) het grid
 * van een ander nummer, en de bewaarlus zette dat in de library.
 */
const NUMMER_GEBEURTENIS = new Set(['grid', 'hotcues']);

/** Sleutel in `laadt` voor een stand midden in het log: dan wacht ALLES. */
const ALLES = '*';

/**
 * Het draaiboek: alle regels met het moment waarop ze de bus op gaan,
 * gesorteerd op tijd en daarbinnen in de volgorde van het log.
 *
 * @param beginstand  de stand die al vóór T0 gezet wordt (die gaat er niet
 *                    nog eens in). Niet opgegeven: de eerste stand van het log.
 */
export function maakPlan(regels, { beginstand } = {}) {
  const plan = [];
  let volg = 0, onbekend = 0;
  let eersteStand = beginstand === undefined;
  for (const r of regels) {
    if (Array.isArray(r)) {
      const [t, a, v] = r;
      if (!Number.isFinite(t) || typeof a !== 'string') { onbekend++; continue; }
      if (OVERSLAAN.test(a)) continue;
      plan.push({ tijd: t, volg: volg++, soort: 'actie', a, v, track: trackVanActie(a) });
    } else if (r && typeof r === 'object' && typeof r.e === 'string') {
      if (r.e === 'kop' || r.e === 'eind') continue;
      if (r.e === 'stand' && (r === beginstand || eersteStand)) { eersteStand = false; continue; }
      if (!SOORTEN.has(r.e) || !Number.isFinite(r.t)) { onbekend++; continue; }
      // Laden begint zo lang vóór het moment dat hij klaar was als hij toen duurde.
      const duur = r.e === 'laad' && Number.isFinite(r.duur) && r.duur > 0 ? r.duur : 0;
      plan.push({ tijd: Math.max(0, r.t - duur), volg: volg++, soort: r.e, e: r, track: Number.isInteger(r.track) ? r.track : null });
    } else onbekend++;
  }
  plan.sort((x, y) => x.tijd - y.tijd || x.volg - y.volg);
  return { plan, onbekend };
}

export class Terugspeler {
  /**
   * @param klok    () => seconden op de audioklok
   * @param invoke  (action, waarde) => void — de bus
   * @param doe     { stand(stand, { nogBezig }), laad(track, e), rack(track, rack), grid(track, grid),
   *                  hotcues(track, tijden), focus(track), pads(herinneringen) }
   *                stand en laad mogen een Promise geven. laad: false = mislukt;
   *                stand: { zonder: [tracks zonder hun nummer van toen] }; nogBezig()
   *                wordt false als er intussen gestopt is (dan niets meer zetten)
   * @param elke    (fn, ms) -> handvat; stopElke ruimt hem op
   */
  constructor({ klok, invoke, doe, elke = (fn, ms) => setInterval(fn, ms), stopElke = (h) => clearInterval(h), tikMs = 10 }) {
    this.klok = klok;
    this.invoke = invoke;
    this.doe = doe;
    this.elke = elke;
    this.stopElke = stopElke;
    this.tikMs = tikMs;
    this.plan = null;
    this.onKlaar = null;
    this.onFout = null;
    // Na elke stand die buiten de bus om gezet is (de beginstand, of een stand
    // midden in het log). Loopt er intussen een log (een opname van dit
    // terugspelen), dan moet die stand daarin: logboek.js schrijft hem erin.
    this.onStand = null;
    this._nr = 0;
  }

  get bezig() { return !!this.plan; }
  /** Waar we zijn in het log, in seconden (0 tijdens het laden van de beginstand). */
  get seconden() { return this.plan && this.T0 !== null ? Math.min(this.duur, this.klok() - this.T0) : 0; }

  /**
   * Beginnen: eerst de beginstand (nummers laden, standen zetten — de klok
   * loopt dan nog niet), dan T0 = nu en de regels op hun moment.
   * @returns Promise die klaar is als het terugspelen LOOPT (niet als het af is)
   */
  async start({ stand = null, regels = [], duur = null } = {}) {
    if (this.plan) this.stop();
    const nr = ++this._nr;
    const { plan, onbekend } = maakPlan(regels, { beginstand: stand });
    this.plan = plan;
    this.i = 0;
    this.T0 = null;
    this.duur = duur ?? (plan.length ? plan[plan.length - 1].tijd : 0);
    this.laadt = new Map();             // track (of ALLES) -> handelingen die wachten tot hij geladen is
    this._bezig = new Set();            // laden die nog lopen (een stand wacht erop)
    this.ingedrukt = new Set();         // triggers die nog niet losgelaten zijn
    this.zonder = new Set();            // tracks waar het nummer van toen niet op staat (NUMMER_NODIG)
    this.stats = { regels: plan.length, gedaan: 0, onbekend, laat: 0, maxLaat: 0, mislukt: 0, overgeslagen: 0 };
    if (stand) {
      try {
        // Stop je tijdens het laden, dan mag de beginstand daarna niets meer
        // zetten of starten: `nogBezig` zegt of dit terugspelen nog loopt.
        const r = await this.doe.stand(stand, { nogBezig: () => nr === this._nr });
        for (const t of r?.zonder || []) this.zonder.add(t);
      } catch (err) { this.onFout?.(`beginstand: ${err.message}`); }
      if (nr !== this._nr) return;      // intussen gestopt
      try { this.onStand?.(); } catch (_) {}
    }
    this.T0 = this.klok();
    this._timer = this.elke(() => this._tik(), this.tikMs);
    this._tik();
  }

  stop() { this._eind('gestopt'); }

  _tik() {
    // Tijdens een stand midden in het log staat de klok van het log stil.
    if (!this.plan || this.laadt.has(ALLES)) return;
    const nu = this.klok() - this.T0;
    while (this.plan && !this.laadt.has(ALLES) && this.i < this.plan.length && this.plan[this.i].tijd <= nu) this._doe(this.plan[this.i++], nu);
    // Klaar als alles gedaan is EN de tijd van het log om is: een set opnieuw
    // renderen duurt net zo lang als het origineel, ook na de laatste handeling.
    if (this.plan && this.i >= this.plan.length && !this.laadt.size && nu >= this.duur) this._eind('klaar');
  }

  _doe(x, nu) {
    // Er wordt een stand gezet: alles wacht. Deze track laadt nog: achteraan
    // in zijn rij, de rest loopt door.
    const rij = this.laadt.get(ALLES) ?? (x.track !== null ? this.laadt.get(x.track) : undefined);
    if (rij) { rij.push(x); return; }
    if (this.zonder.has(x.track) && (x.soort === 'actie' ? NUMMER_NODIG.test(x.a) : NUMMER_GEBEURTENIS.has(x.soort))) {
      this.stats.overgeslagen++;
      return;
    }
    const laat = nu - x.tijd;
    if (laat > 0.05) { this.stats.laat++; this.stats.maxLaat = Math.max(this.stats.maxLaat, laat); }
    this.stats.gedaan++;
    try {
      if (x.soort === 'actie') {
        if (x.v === true) this.ingedrukt.add(x.a);
        else if (x.v === false) this.ingedrukt.delete(x.a);
        this.invoke(x.a, x.v);
      } else if (x.soort === 'laad') this._laad(x);
      else if (x.soort === 'stand') this._stand(x);
      else if (x.soort === 'rack') this.doe.rack(x.track, x.e.rack);
      else if (x.soort === 'grid') this.doe.grid(x.track, x.e.grid ?? null);
      else if (x.soort === 'hotcues') this.doe.hotcues(x.track, x.e.hotcues);
      else if (x.soort === 'focus') this.doe.focus(x.track);
      else if (x.soort === 'pads') this.doe.pads(x.e.herinneringen || []);
    } catch (err) {
      this.stats.mislukt++;
      this.onFout?.(`${x.a ?? x.soort}: ${err.message}`);
    }
  }

  _laad(x) {
    const rij = [];
    this.laadt.set(x.track, rij);
    const nr = this._nr;
    let gelukt = false;
    const bezig = Promise.resolve().then(() => this.doe.laad(x.track, x.e)).then((r) => {
      gelukt = r !== false;
      if (!gelukt) this.stats.mislukt++;
    }, (err) => {
      this.stats.mislukt++;
      this.onFout?.(`track ${x.track} laden: ${err.message}`);
    });
    this._bezig.add(bezig);
    bezig.then(() => {
      this._bezig.delete(bezig);
      if (nr !== this._nr || !this.plan) return;
      if (gelukt) this.zonder.delete(x.track);
      else this.zonder.add(x.track);
      this.laadt.delete(x.track);
      // Wat er intussen voor deze track kwam, nu en in volgorde. Staat er
      // weer een laad tussen, dan wacht de rest daarop (_doe regelt dat).
      const nu = this.klok() - this.T0;
      for (const y of rij) this._doe(y, nu);
      this._tik();
    });
  }

  /**
   * Een stand midden in het log. Die komt van een terugspelen dat liep
   * terwijl dit log opnam (opnieuw renderen): de beginstand daarvan zette
   * posities, tempo, cues, loops en wat speelt BUITEN de bus om, dus hier
   * weer. Alles wacht, eerst op wat nog laadt (anders laadt de stand
   * hetzelfde nummer er nog eens overheen), dan de stand; de klok van het log
   * staat zolang stil, net als bij de beginstand, zodat wat erna komt op
   * dezelfde plek in de muziek valt.
   */
  _stand(x) {
    const rij = [];
    this.laadt.set(ALLES, rij);
    const nr = this._nr;
    const nogBezig = () => nr === this._nr;
    const begon = this.klok();
    Promise.all([...this._bezig]).then(() => (nogBezig() ? this.doe.stand(x.e, { nogBezig }) : null)).then((r) => {
      if (nogBezig() && r) this.zonder = new Set(r.zonder || []);
    }, (err) => {
      this.stats.mislukt++;
      this.onFout?.(`stand: ${err.message}`);
    }).then(() => {
      if (!nogBezig() || !this.plan) return;
      this.T0 += this.klok() - begon;
      this.laadt.delete(ALLES);
      try { this.onStand?.(); } catch (_) {}
      const nu = this.klok() - this.T0;
      for (const y of rij) this._doe(y, nu);
      this._tik();
    });
  }

  _eind(reden) {
    if (!this.plan) return;
    if (this._timer !== undefined) this.stopElke(this._timer);
    this._timer = undefined;
    // Niets blijft ingedrukt hangen (een bend, een vastgehouden effect).
    const los = [...this.ingedrukt];
    this.ingedrukt.clear();
    this.plan = null;
    this._nr++;
    for (const a of los) { try { this.invoke(a, false); } catch (_) {} }
    this.onKlaar?.({ reden, ...this.stats });
  }
}

/**
 * Wat een gebeurtenis uit het log BETEKENT voor een engine: de `doe` van een
 * Terugspeler. Raakt de engine rechtstreeks (zoals actions.js), want een rack
 * of een beginstand staat niet op de bus. Het laden komt van de laadlaag.
 *
 * @param engine  de engine
 * @param tracks  [[nr, deckId], ...] (TRACKS uit actions.js)
 * @param laad    (deckId, e) => Promise<boolean>: e = { bron, nummer, titel, grid, demo }
 * @param meld    (tekst, soort) => void
 * @param invoke, read, has  de bus
 * @param huidig  deckId => waar wat er NU op staat vandaan komt ({ bron, nummer | demo }),
 *                of null als dat niet telt. Staat er al precies dat nummer, dan laadt
 *                de stand het niet opnieuw: een stand midden in het log komt vlak na de
 *                laad-gebeurtenissen van diezelfde nummers.
 */
export function maakUitvoerder({ engine, tracks, laad, meld = () => {}, invoke, read, has, huidig = () => null }) {
  const deckVan = (nr) => tracks.find(([n]) => n === nr)?.[1] ?? null;
  const deck = (nr) => (deckVan(nr) ? engine.deck(deckVan(nr)) : null);
  const gridTekst = (d) => (d.grid ? JSON.stringify(d.grid.toJSON()) : 'null');
  const zelfdeNummer = (a, b) => !!a && !!b && a.bron === b.bron
    && (a.bron === 'library' ? !!a.nummer && a.nummer === b.nummer
      : a.bron === 'demo' && Number(a.demo?.seed) === Number(b.demo?.seed) && Number(a.demo?.bars) === Number(b.demo?.bars));

  /** Een rack uit het log: alleen wat verschilt, anders hoor je een kruisfade voor niets. */
  function rack(fx, r) {
    if (!r?.data) return;
    if (JSON.stringify(fx.naarJSON()) !== JSON.stringify(r.data)) {
      // Een library-id van toen niet overnemen: "bewaar" zou dan over een rack
      // heen schrijven dat inmiddels anders kan zijn. Een sjabloon ("s:2") mag wel.
      fx.zetRack(r.data, { herkomst: typeof r.herkomst === 'string' ? r.herkomst : null });
    }
    for (const [k, v] of Object.entries(r.standen || {})) {
      const n = Number(k), nu = fx.leesPlek(n);
      if (Number.isFinite(v) && nu !== null && Math.abs(nu - v) > 1e-9) fx.setPlek(n, v, { direct: true });
    }
    if (Number.isFinite(r.mix) && Math.abs(fx.mix - r.mix) > 1e-9) fx.setMix(r.mix);
    if (typeof r.bypass === 'boolean' && fx.bypass !== r.bypass) fx.setBypass(r.bypass);
  }

  function herinneringen(lijst = []) {
    const sampler = engine.sampler;
    if (!sampler) return;
    sampler.herinneringen.forEach((_, i) => {
      const h = lijst[i];
      const deckId = h ? deckVan(h.track) : null;
      sampler.herinneringen[i] = h && deckId ? { deckId, van: h.van, tot: h.tot, bpm: h.bpm, tellen: h.tellen, bron: h.track } : null;
    });
  }

  /** Gevulde pads van het begin opnieuw knippen (herstel knipt van schijf, zoals een bewaarde pad). */
  async function pads(lijst = []) {
    const sampler = engine.sampler;
    if (!sampler) return;
    const bewaard = [...sampler.herinneringen];
    await Promise.all(sampler.pads.map(async (_, i) => {
      const p = lijst[i];
      if (!p) { if (sampler.pads[i]) sampler.wis(i); return; }
      const d = deck(p.track);
      if (!d?.buffer) return;
      sampler.herinneringen[i] = { deckId: d.id, van: p.van, tot: p.tot, bpm: p.bpm, tellen: p.tellen };
      try { await sampler.herstel(i, d); } catch (err) { meld(`terugspelen: pad ${i + 1}: ${err.message}`, 'fout'); }
    }));
    bewaard.forEach((h, i) => { sampler.herinneringen[i] = h; });
  }

  /** Een knop die rondloopt (curve, tellen, mengvorm) drukken tot hij goed staat. */
  function rondTot(a, v) {
    if (!has(a)) return;
    for (let i = 0; i < 8; i++) {
      const nu = read(a);
      if (nu === null || Math.abs(nu - v) < 1e-6) return;
      invoke(a, true); invoke(a, false);
    }
  }

  /**
   * De beginstand: alle nummers tegelijk laden, dan per track de stand, dan
   * wat op de bus staat, en als laatste alles wat speelde in ÉÉN keer aan,
   * zodat de tracks onderling liggen zoals toen.
   */
  async function stand(st, { nogBezig = () => true } = {}) {
    const lijst = st.tracks || [];
    const geladen = new Set();
    const zonder = [];                  // tracks zonder hun nummer van toen (zie NUMMER_NODIG)
    await Promise.all(lijst.map(async (t) => {
      const d = deck(t.track);
      if (!d) return;
      d.pause();
      if (t.bron !== 'library' && t.bron !== 'demo') {
        // Leeg of een los bestand: wat er nu staat speelt in elk geval niet mee.
        if (t.bron === 'los') meld(`terugspelen: op track ${t.track} stond een los bestand${t.titel ? ` ("${t.titel}")` : ''} — niet terug te halen`, 'fout');
        zonder.push(t.track);
        return;
      }
      // Staat dat nummer er al (net geladen): niet nog eens. Wat een laad
      // terugzet (cue, hotcues, grid, loop, tempo) zet de stand hieronder zelf.
      if (zelfdeNummer(huidig(d.id), t)) { geladen.add(d.id); return; }
      const gelukt = await Promise.resolve().then(() => laad(d.id, t))
        .catch((err) => { meld(`terugspelen: track ${t.track}: ${err.message}`, 'fout'); return false; });
      if (gelukt) geladen.add(d.id);
      else zonder.push(t.track);
    }));
    // Intussen gestopt: wat geladen is blijft staan, maar er wordt niets meer
    // gezet en niets gestart.
    if (!nogBezig()) return { zonder, gestopt: true };
    for (const t of lijst) {
      const d = deck(t.track);
      if (!d) continue;
      if (PITCH_BEREIKEN.includes(t.bereik)) d.pitchBereik = t.bereik;
      if (t.kant) engine.setKant(d.id, t.kant);
      // Kill en beatjump-lengte horen bij de TRACK (mixer), niet bij het
      // nummer. Een log van vóór de kill: toen stond er geen kill aan.
      for (const band of EQ_BANDEN) {
        const aan = !!t.kill?.[band];
        if (d.kill && d.kill[band] !== aan) d.setKill(band, aan);
      }
      if (SPRONG_TELLEN.includes(t.sprong)) d.sprongTellen = t.sprong;
      rack(d.fx, t.rack);
      if (!geladen.has(d.id) || !d.buffer) continue;
      // Het grid van toen. Een library-nummer kreeg het al mee bij het laden,
      // maar de demo komt zonder grid uit zijn zaad (een getikt grid was weg).
      if (gridTekst(d) !== JSON.stringify(t.grid ?? null)) d.setGrid(t.grid ?? null);
      if (Number.isFinite(t.rate)) d.setRate(t.rate);
      d.cuePoint = Number.isFinite(t.cue) ? t.cue : 0;
      if (Array.isArray(t.hotcues)) d.hotcues = [0, 1, 2, 3].map((i) => (Number.isFinite(t.hotcues[i]) ? t.hotcues[i] : null));
      d.seek(Number.isFinite(t.positie) ? t.positie : 0);
      if (t.loop && d.setLoopRange(t.loop.start, t.loop.end)) d.loopBeats = t.loop.tellen ?? null;
      else d.clearLoop();
      // Stem-kills van toen (schakelaars, bij het nummer). Ook UIT zetten: een
      // nummer dat er al stond (zelfdeNummer) kan nog een kill aan hebben.
      for (const s of new Set(d.stems ? [...d.stems.namen, 'inst'] : [])) {
        const aan = !!t.stemKill?.[s];
        if (d.stemBestaat?.(s) && d.stemKill[s] !== aan) d.setStemKill(s, aan);
      }
    }
    for (const [a, v] of Object.entries(st.waarden || {})) if (has(a)) invoke(a, v);
    // Quantize bestond vóór ronde 3 niet: een ouder log begon zonder. Zwart
    // en bevriezen (A4) ook niet: toen was het beeld gewoon te zien.
    const rondVroeger = { 'transport.quantize': 0, 'video.black': 0, 'video.freeze': 0 };
    for (const [a, v] of Object.entries({ ...rondVroeger, ...(st.rond || {}) })) rondTot(a, v);
    if (deckVan(st.focus)) engine.setFocus(deckVan(st.focus));
    herinneringen(st.herinneringen);
    await pads(st.pads);
    if (!nogBezig()) return { zonder, gestopt: true };
    for (const t of lijst) {
      const d = deck(t.track);
      if (t.speelt && d && geladen.has(d.id)) d.play();
    }
    // Wie toen op zijn start op de maat wachtte: opnieuw op de maat, nu de
    // rest speelt (dezelfde maatgever als toen, dus dezelfde "1").
    for (const t of lijst) {
      const d = deck(t.track);
      if (t.wacht && !t.speelt && d && geladen.has(d.id) && !d.playing) engine.startOpDeMaat?.(d.id);
    }
    (st.pads || []).forEach((p, i) => { if (p?.speelt && engine.sampler?.pads[i] && !engine.sampler.pads[i].speelt) engine.sampler.wissel(i); });
    return { zonder };
  }

  return {
    stand,
    laad: (track, e) => (deckVan(track) ? laad(deckVan(track), e) : false),
    rack: (track, r) => { const d = deck(track); if (d) rack(d.fx, r); },
    grid: (track, g) => {
      const d = deck(track);
      if (d?.buffer && gridTekst(d) !== JSON.stringify(g ?? null)) d.setGrid(g ?? null);
    },
    // De hotcues van toen, precies (ook de lege plekken). Via restoreHotcues:
    // die pint ze meteen vast en meldt geen 'hotcue', dus de hotcue-opslag
    // stuurt niets naar de library.
    hotcues: (track, tijden) => {
      const d = deck(track);
      if (!d?.buffer || !Array.isArray(tijden)) return;
      const nieuw = d.hotcues.map((_, i) => (Number.isFinite(tijden[i]) ? tijden[i] : null));
      if (JSON.stringify(nieuw) === JSON.stringify(d.hotcues)) return;
      d.hotcues = d.hotcues.map(() => null);
      d.restoreHotcues(nieuw);
    },
    focus: (track) => { const id = deckVan(track); if (id && engine.focus !== id) engine.setFocus(id); },
    pads: (lijst) => herinneringen(lijst),
  };
}
