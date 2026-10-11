/**
 * Het handelingenlog: alles wat er op de action-bus gebeurt, met het moment
 * op de AUDIOKLOK (regel 3), plus genoeg om de set terug te vinden: welk
 * nummer er op welke track kwam, de focus, rack-, grid- en padwissels. Zo is
 * een set opnieuw af te spelen (terugspelen.js): opnieuw renderen, een fout
 * naspelen. Niet hash-exact: de engine is niet deterministisch (streamen,
 * netwerk, timers), en dat hoeft ook niet (VRAGEN G3).
 *
 * De engine weet hier niets van (regel 1). Het log hangt aan de bus
 * (`bijInvoke` in actions.js) en aan de laadlaag; de schermlaag (ui/logboek.js)
 * knoopt dat aan elkaar.
 *
 * Formaat (docs/HANDELINGENLOG.md): JSON Lines, één regel per handeling.
 *   [t, "track.1.fader", 0.5039370078740157]      een action: tijd, naam, waarde
 *   {"t": 12.5, "e": "laad", "track": 2, ...}      een gebeurtenis
 * t = seconden op de audioklok sinds het begin van het log, op 1 µs.
 *
 * Wegschrijven zoals een opname (opnemer.js): elke seconde een stuk, met de
 * plek erbij (`van`, in bytes). De server zet het op die plek, dus herhalen na
 * een verloren antwoord geeft geen dubbele regels, en een crash kost hooguit
 * een seconde. Alles is ASCII (asciiJson): één teken = één byte, dus de
 * browser weet precies waar het volgende stuk begint.
 */

export const LOG_VERSIE = 1;

/** JSON met alles boven ASCII als \uXXXX. JSON.parse geeft precies hetzelfde terug. */
export function asciiJson(x) {
  return JSON.stringify(x).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Tijd op 1 µs: ruim onder één sample (21 µs), en een regel blijft kort. */
const opMicro = (t) => Math.round(t * 1e6) / 1e6;

export class Handelingenlog {
  /**
   * @param klok   () => seconden op de audioklok (ctx.currentTime)
   * @param haal   fetch; de tests geven er een die de echte server/handelingen.js aanroept
   * @param wacht  pauze tussen pogingen (ms -> Promise)
   * @param elke   (fn, ms) -> handvat, de wegschrijftimer; stopElke ruimt hem op
   * @param datum  () => Date, alleen voor de kop (wanneer was dit)
   */
  constructor({ klok, haal = (url, init) => fetch(url, init), wacht = (ms) => new Promise((r) => setTimeout(r, ms)),
    elke = (fn, ms) => setInterval(fn, ms), stopElke = (h) => clearInterval(h), datum = () => new Date() }) {
    this.klok = klok;
    this.haal = haal;
    this.wacht = wacht;
    this.elke = elke;
    this.stopElke = stopElke;
    this.datum = datum;
    this.sessie = null;
    this.buffer = [];
    this.regels = 0;
    this.t0 = 0;
    this.onFout = null;
  }

  get bezig() { return !!this.sessie; }
  /** Het id op de server; null tot de server geantwoord heeft. */
  get id() { return this.sessie?.id ?? null; }
  /** Bij welke opname dit log hoort, of null. */
  get opname() { return this.sessie?.opname ?? null; }
  get seconden() { return this.sessie ? this.klok() - this.t0 : 0; }
  /** Wat er al naar de server onderweg is plus wat nog wacht. */
  get bytes() { return this.sessie ? this.sessie.van + this.buffer.reduce((n, r) => n + r.length + 1, 0) : 0; }

  /**
   * Beginnen. Vastleggen begint METEEN (klok en buffer), de server doet
   * er even over: zo gaat er niets verloren tussen de klik (of het begin van
   * de opname) en het antwoord. Mislukt de start, dan wordt alles weggegooid.
   *
   * @param opname  het id van de lopende opname: het log krijgt hetzelfde id
   * @param stand   de beginstand (leesStand), zodat het log op zichzelf staat
   * @returns Promise<{ ok, id, bestand } | { ok: false, fout }>
   */
  start({ opname = null, stand = null, kop = {} } = {}) {
    if (this.sessie) return Promise.resolve({ ok: true, id: this.sessie.id, al: true });
    const s = { id: null, bestand: null, opname, van: 0, fout: null, rij: null };
    this.sessie = s;
    this.buffer = [];
    this.regels = 0;
    this._tijd = 0;
    this.t0 = this.klok();
    this.gebeurtenis('kop', { versie: LOG_VERSIE, begon: this.datum().toISOString(), klok: opMicro(this.t0), opname, ...kop });
    if (stand) this.gebeurtenis('stand', stand);
    s.rij = this._post('/api/handelingen/start', { id: opname }).then((j) => {
      if (!j?.ok) throw new Error(j?.fout || 'de server wil niet beginnen');
      s.id = j.id; s.bestand = j.bestand;
      return { ok: true, id: j.id, bestand: j.bestand };
    }).catch((err) => {
      s.fout = `log niet begonnen: ${err.message}`;
      if (this.sessie === s) this._sluit();
      this.onFout?.(s.fout);
      return { ok: false, fout: s.fout };
    });
    const begin = s.rij;
    this._timer = this.elke(() => this._spoel(), 1000);
    this._spoel();                        // kop en stand: zodra het id er is
    return begin;
  }

  /**
   * Eén action van de bus. Heet pad: een regel maken en klaar.
   * `laat` (terugspelen, invoke-opties): de regel kwam zoveel seconden na zijn
   * moment de bus op. Hij staat er dan op dat bedoelde moment, zodat een
   * opname van een terugspelen (opnieuw renderen) niet per generatie een tik
   * opschuift.
   */
  neem(actie, waarde, laat = 0) {
    if (!this.sessie) return;
    // Nooit vóór de regel ervóór: de volgorde in het bestand blijft die van de bus.
    const t = Math.max(this._tijd ?? 0, opMicro(this.klok() - this.t0 - (laat > 0 ? laat : 0)));
    const w = waarde === undefined ? null : waarde;
    this.buffer.push(asciiJson([t, actie, w]));
    this._laatste = { buf: this.buffer, i: this.buffer.length - 1, t, actie, w };
    this._tijd = t;
    this.regels++;
  }

  /**
   * Een vierde element aan de LAATSTE actieregel: wat de action zelf bepaalde.
   * Alleen als die regel met `voorvoegsel` begint, een druk is (true) en nog
   * niet weg is. Voor een sectiedruk: `{ van }`, de tracktijd waarvan de sprong
   * rekende (deck 'sectiedruk', logboek.js). Terugspelen neemt daarmee precies
   * dezelfde beslissing (welke "1"); een oudere terugspeler leest alleen de
   * eerste drie elementen. Geeft true als het gelukt is.
   */
  vulAan(voorvoegsel, extra) {
    const l = this._laatste;
    if (!this.sessie || !l || l.buf !== this.buffer || l.w !== true || !l.actie.startsWith(voorvoegsel)) return false;
    this.buffer[l.i] = asciiJson([l.t, l.actie, l.w, extra]);
    this._laatste = null;
    return true;
  }

  /** Iets wat niet (alleen) op de bus staat: laden, focus, een rack- of gridwissel. */
  gebeurtenis(e, data = {}) {
    if (!this.sessie) return;
    const t = opMicro(this.klok() - this.t0);
    this.buffer.push(asciiJson({ t, e, ...data }));
    this._tijd = Math.max(this._tijd ?? 0, t);
    this.regels++;
  }

  /** Stoppen: een eind-regel, alles weg, wachten tot de server het heeft. */
  async stop() {
    const s = this.sessie;
    if (!s) return { ok: false, fout: 'er loopt geen log' };
    const duur = this.klok() - this.t0;
    this.gebeurtenis('eind', { regels: this.regels + 1 });
    const regels = this.regels;
    this._spoel();
    this._sluit();
    await s.rij;
    if (!s.id) return { ok: false, fout: s.fout || 'log niet begonnen' };
    return { ok: true, id: s.id, bestand: s.bestand, bytes: s.van, regels, duur, waarschuwing: s.fout };
  }

  /**
   * De pagina gaat dicht (pagehide): het laatste stuk nog weg, zonder te
   * wachten of te herhalen (keepalive). Elk stuk draagt zijn eigen plek, dus
   * het maakt niet uit of een eerder stuk nog onderweg is.
   */
  noodstop() {
    const s = this.sessie;
    if (!s) return;
    this.gebeurtenis('eind', { regels: this.regels + 1, afgebroken: 'pagina dicht' });
    const tekst = this.buffer.join('\n') + '\n';
    const van = s.van;
    s.van += tekst.length;
    this._sluit();
    if (!s.id) return;
    try {
      Promise.resolve(this.haal(`/api/handelingen/${s.id}/stuk`, { method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ van, tekst }) })).catch(() => {});
    } catch (_) { /* de pagina is toch al weg */ }
  }

  _sluit() {
    if (this._timer !== undefined) this.stopElke(this._timer);
    this._timer = undefined;
    this.sessie = null;
    this.buffer = [];
  }

  /**
   * Wat er ligt als één stuk naar de server. Het stuk krijgt zijn plek NU
   * (`van`), niet pas als het verstuurd wordt: de volgorde op schijf is de
   * volgorde van de bus, ook als een stuk er drie pogingen over doet.
   */
  _spoel() {
    const s = this.sessie;
    if (!s || !this.buffer.length) return;
    const tekst = this.buffer.join('\n') + '\n';
    this.buffer = [];
    const van = s.van;
    s.van += tekst.length;                // ASCII: tekens = bytes
    s.rij = s.rij.then(() => this._verstuur(s, van, tekst));
  }

  async _verstuur(s, van, tekst) {
    if (!s.id) return;                    // start mislukt: niets om naar te schrijven
    let laatste = null;
    for (let poging = 0; poging < 3; poging++) {
      try {
        const res = await this.haal(`/api/handelingen/${s.id}/stuk`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ van, tekst }),
        });
        if (res.ok) return;
        const j = await res.json().catch(() => ({}));
        laatste = j.fout || `${res.status}`;
        if (j.vol) break;                 // een volle schijf wordt niet leger van opnieuw proberen
      } catch (err) { laatste = err.message; }
      await this.wacht(250 * (poging + 1));
    }
    // Kwijt: een gat van nullen op die plek, de rest blijft staan (de lezer slaat het over).
    s.fout = `stuk kwijt (${tekst.split('\n').length - 1} regels): ${laatste}`;
    this.onFout?.(s.fout);
  }

  async _post(url, body) {
    const res = await this.haal(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.json();
  }
}

/**
 * Een log lezen. Nullen (een weggevallen stuk) eruit, kapotte regels (een
 * half geschreven staart na een crash) overgeslagen en geteld.
 */
export function leesLog(tekst) {
  const regels = [];
  let kapot = 0;
  for (const r of String(tekst).replace(/\0+/g, '').split('\n')) {
    if (!r.trim()) continue;
    try { regels.push(JSON.parse(r)); } catch { kapot++; }
  }
  const kop = regels.find((r) => r?.e === 'kop') ?? null;
  const stand = regels.find((r) => r?.e === 'stand') ?? null;
  const eind = regels.find((r) => r?.e === 'eind') ?? null;
  const tijd = (r) => (Array.isArray(r) ? r[0] : r?.t);
  let duur = 0;
  for (const r of regels) if (Number.isFinite(tijd(r)) && tijd(r) > duur) duur = tijd(r);
  return { kop, stand, eind, regels, kapot, duur };
}

/** Een sectiedruk op de bus (track.N.section.*). */
const SECTIEDRUK = /^track\.\d+\.section\./;

/**
 * De luisteraar op de bus (actions.bijInvoke) die het log vult, voor
 * logboek.js. `kijk` vergelijkt wat buiten de bus om verandert (rack, grid,
 * hotcues, sectiekaart, pads) en schrijft het als gebeurtenis.
 * - Een knop (boolean) kan zelf een rack, grid of pad veranderen: kijk() als
 *   microtask, dus direct ACHTER de action.
 * - Een sectiedruk: kijk() eerst, synchroon. Een sectiekaart die net binnenkwam
 *   (laden.js, haalSecties; kijk draait verder elke 100 ms) stond anders ná de
 *   druk in het log, en bij terugspelen zag de druk nog geen kaart.
 * - `o.laat` (terugspelen): de regel staat op zijn bedoelde moment (neem).
 */
export function busNaarLog(log, kijk) {
  return (id, v, o) => {
    if (!log.bezig) return;
    if (v === true && SECTIEDRUK.test(id)) kijk();
    log.neem(id, v, o?.laat);
    if (typeof v === 'boolean') queueMicrotask(kijk);
  };
}

/**
 * De plek waarvan een sectiesprong rekende bij de druk in het log (een vierde
 * element, Handelingenlog.vulAan). De deck meldt hem tijdens de action zelf
 * ('sectiedruk'), dus direct na de regel die busNaarLog net schreef. Geeft een
 * functie die weer ophoudt.
 */
export function koppelSectiedruk(engine, tracks, log) {
  const af = tracks.map(([nr, id]) => engine.deck(id).on('sectiedruk', ({ van }) => {
    try { if (log.bezig && Number.isFinite(van)) log.vulAan(`track.${nr}.section.`, { van }); } catch (_) {}
  }));
  return () => { for (const f of af) f(); };
}

/**
 * Trigger-actions waarvan de read een STAND is die je terugzet door te
 * drukken tot hij klopt: een knop die rondloopt (curve, tellen, mengvorm), of
 * een schakelaar voor de hele engine (quantize, dj-transport: anders snapt
 * een teruggespeelde hotcue anders dan toen). Ook zwart en bevriezen van de
 * beamer (eindbeeld.js): een set die zwart begon, begint teruggespeeld ook
 * zwart. En de clips (video.clips): een set in het zaalbeeld (alleen eigen
 * beeld) begint teruggespeeld ook zonder deck-video's. Niet de drukvariant
 * (video.black.hold) en niet de flits: die zijn een gebaar, geen stand. De
 * video-master is een value en gaat vanzelf mee.
 */
export const RONDLOPERS = ['mixer.xfader.curve', 'sampler.length', 'video.mode', 'video.fit', 'video.pulse.target', 'transport.quantize',
  'video.black', 'video.freeze', 'video.clips'];

/**
 * Value-actions die NIET in de beginstand staan: positie, tempo en grid
 * worden apart en precies teruggezet (een seek via de bus rekent in een
 * fractie van de duur, pitch is geklemd, grid.bpm zou het grid bewerken).
 * `track.N.key` (de toonsoort van de plaat hier) zou de toonsoortkaart
 * bewerken en een automatische kaart "met de hand" maken: die kaart hoort
 * bij het nummer in de library, niet bij de set (zie OVERSLAAN in
 * terugspelen.js). `headphone.*` (de koptelefoon) hoort niet bij wat er
 * klinkt en wordt bij terugspelen overgeslagen; `track.N.inst.knob.K` (een
 * instrument) ook (docs/INSTRUMENTEN.md §6). `track.N.pattern.length/swing`
 * bewerken een patroon, en dat is al bewaard bij de set (docs/PATRONEN.md):
 * de beginstand zou het nog eens bewerken. Het eigen tempo (`patterns.tempo`)
 * hoort wel bij wat je hoort en staat er wel in.
 */
export const NIET_IN_WAARDEN = /^(track\.\d+\.(seek|pitch|tempo|grid\.bpm|key|inst\..+|pattern\..+)|headphone\..+)$/;

/** Het rack van een track zoals het log het bewaart: inhoud én live standen. */
export function rackStand(fx) {
  return { data: fx.naarJSON(), standen: { ...fx.standen }, herkomst: fx.herkomst ?? null, mix: fx.mix, bypass: !!fx.bypass };
}

/** De bewaarde pads van de sampler, met tracknummers in plaats van decks. */
export function herinneringenVan(sampler, trackVan) {
  return (sampler?.herinneringen || []).map((h) => (h
    ? { track: trackVan(h.deckId), van: h.van, tot: h.tot, bpm: h.bpm ?? null, tellen: h.tellen ?? null }
    : null));
}

/**
 * De beginstand: alles wat nodig is om het log op zichzelf af te spelen,
 * ook als het midden in een set begint.
 *
 * @param engine    de engine (alleen gelezen)
 * @param tracks    [[nr, deckId], ...] (TRACKS uit actions.js)
 * @param herkomst  deckId -> { bron: 'library', nummer } | { bron: 'demo', demo } | { bron: 'los' } | null
 * @param acties    list() uit actions.js
 * @param lees      read() uit actions.js
 */
export function leesStand({ engine, tracks, herkomst, acties, lees }) {
  const trackVan = (deckId) => tracks.find(([, d]) => d === deckId)?.[0] ?? null;
  const uit = { focus: trackVan(engine.focus), tracks: [], waarden: {}, rond: {}, pads: [], herinneringen: [] };
  for (const [nr, id] of tracks) {
    const d = engine.deck(id);
    const h = d.buffer ? (herkomst(id) || { bron: 'los' }) : { bron: 'leeg' };
    uit.tracks.push({
      track: nr, ...h, titel: d.buffer ? (d.title ?? null) : null,
      // Een track die op zijn start op de maat WACHT (dj-transport) speelt nog
      // niet: `wacht`, en terugspelen start hem opnieuw op de maat.
      positie: d.position, speelt: !!d.playing && !d.wacht, wacht: !!d.wacht, rate: d.rate, bereik: d.pitchBereik,
      // Keylock en toon (docs/KEYLOCK.md): track.N.keylock is een toggle, dus
      // zonder beginstand speelde een log dat met keylock begon omgekeerd terug.
      keylock: !!d.keylock, toon: d.transpositie ?? 0,
      cue: d.cuePoint ?? 0, hotcues: [...(d.hotcues || [])],
      loop: d.loop ? { start: d.loop.start, end: d.loop.end, tellen: d.loopBeats ?? null } : null,
      grid: d.grid ? d.grid.toJSON() : null,
      // De sectiekaart (docs/SECTIES.md): `section.5` betekent wat deze kaart
      // zegt. Terugspelen zet hem terug en haalt hem niet van de server, die
      // kan intussen opnieuw gerekend hebben (een ander grid). Een sectie-loop
      // staat hierboven als gewone `loop`.
      secties: d.buffer && d.sectieKaart ? d.sectieKaart.toJSON() : null,
      kant: engine.kant?.[id] ?? null,
      rack: rackStand(d.fx),
      // De kill-SCHAKELAARS (dj-klank): track.N.kill.* zijn toggles, dus een
      // log dat met een kill aan begint speelde anders omgekeerd terug. De
      // drukvariant (killVast) is loslaten = weg, die hoort niet in een stand.
      kill: { ...(d.kill || {}) },
      // Stem-kills (docs/STEMS.md): ook schakelaars, dus om dezelfde reden in
      // de stand. Ze horen bij het NUMMER (een laad zet ze open), dus alleen
      // als er stems zijn; de niveaus staan als value-action in `waarden`.
      stemKill: d.stems ? { ...d.stemKill } : null,
      // Beatjump-lengte (dj-transport): halve/double zijn geen rondlopers.
      sprong: d.sprongTellen ?? null,
    });
  }
  for (const a of acties) {
    if (a.type === 'value' && !NIET_IN_WAARDEN.test(a.id)) {
      const v = lees(a.id);
      if (v !== null) uit.waarden[a.id] = v;
    } else if (RONDLOPERS.includes(a.id)) {
      const v = lees(a.id);
      if (v !== null) uit.rond[a.id] = v;
    }
  }
  const sampler = engine.sampler;
  uit.pads = (sampler?.pads || []).map((p) => (p
    ? { track: trackVan(p.deckId), van: p.van, tot: p.tot, bpm: p.bpm ?? null, tellen: p.tellen ?? null, speelt: !!p.speelt }
    : null));
  uit.herinneringen = herinneringenVan(sampler, trackVan);
  // Patronen (docs/PATRONEN.md): welke plek er op welke track speelt (of op de
  // maat wacht). Terugspelen start ze opnieuw op de maat; de noten zelf staan
  // in de set op de server, niet in het log.
  uit.patronen = engine.patronen ? { speelt: engine.patronen.spelend().map(({ id, plek }) => ({ track: trackVan(id), plek })) } : null;
  return uit;
}
