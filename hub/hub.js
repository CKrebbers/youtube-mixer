// De kern van de hub (docs/BUS.md): wie naar welke baan luistert, wie wat mag
// sturen, en wie de APC heeft. Weet niets van sockets: een kanaal is alles met
// een stuur(tekst, vervangbaar). Zo is dit zonder netwerk te testen.

export const BANEN = ['muziek', 'beeld', 'acties', 'apc', 'klok'];

/** Banen met één vaste zender (regel 2). */
export const ALLEEN = { muziek: 'varve', beeld: 'varve', klok: 'varve' };

/** Zo lang stil, en een andere verbinding van dezelfde app mag de baan overnemen. */
export const ZENDER_STIL_MS = 3000;

/** Van deze berichten onthoudt de hub het laatste, voor wie later aansluit (regel 3). */
const BEWAAR = { muziek: ['stand', 'toon', 'nummer'], beeld: ['lagen'] };

/** Deze berichten haalt de volgende in: ze mogen wegvallen als een app achterloopt. */
const VERVANGBAAR = new Set(['muziek:stand', 'beeld:lagen']);

/** Herkomst (index.js): 'varve' = een VARVE-pagina, 'lokaal' = geen browser, 'extra' = een andere toegelaten pagina. */
const MAG_VARVE_ZIJN = new Set(['varve', 'lokaal']);

const lijst = (x) => (Array.isArray(x) ? x.filter((b) => BANEN.includes(b)) : []);

export function maakHub({ log = () => {}, nu = Date.now } = {}) {
  /** @type {Set<{app: string|null, herkomst: string, luistert: Set<string>, stuurt: Set<string>, stuur: Function}>} */
  const clients = new Set();
  const laatste = new Map();   // 'baan:type[:deck]' -> tekst
  const zender = new Map();    // baan uit ALLEEN -> { client, laatst }
  let apc = null;              // app-naam die de APC heeft
  const gemeld = new Set();
  const meldEens = (s) => {
    if (gemeld.has(s)) return;
    if (gemeld.size > 200) gemeld.clear();             // niet eindeloos groeien
    gemeld.add(s); log(s);
  };

  const apps = () => [...clients].filter((c) => c.app).map((c) => c.app);
  const naarLuisteraars = (baan, tekst, behalve, vervangbaar = false) => {
    for (const c of clients) if (c !== behalve && c.luistert.has(baan)) c.stuur(tekst, vervangbaar);
  };
  const eigenaarBericht = () => JSON.stringify({ baan: 'apc', type: 'eigenaar', van: 'hub', t: nu(), app: apc });
  /** Iedereen die luistert hoort het, en ook wie erom vroeg of het kreeg. */
  const meldEigenaar = (...ook) => {
    const tekst = eigenaarBericht();
    naarLuisteraars('apc', tekst, null);
    for (const c of new Set(ook)) if (c && !c.luistert.has('apc')) c.stuur(tekst);
  };

  function apcBericht(c, m) {
    if (m.type === 'vraag') {
      // per app, niet per verbinding: twee tabbladen van één app zijn samen één eigenaar
      if (apc === null || apc === c.app) { apc = c.app; meldEigenaar(c); }
      else c.stuur(eigenaarBericht());                    // bezet: je hoort wie hem heeft
    } else if (m.type === 'los') {
      if (apc === c.app) { apc = null; meldEigenaar(c); }
    } else if (m.type === 'geef' && typeof m.app === 'string') {
      if (c.app !== 'controle') return meldEens(`${c.app} mag de APC niet weggeven; dat doet de Controlekamer`);
      const naar = [...clients].filter((x) => x.app === m.app);
      if (!naar.length) return c.stuur(eigenaarBericht());
      apc = m.app;
      meldEigenaar(c, ...naar);
    }
  }

  function hallo(c, m) {
    if (c.app) return meldEens(`tweede hallo van ${c.app} genegeerd`);
    if (typeof m.app !== 'string' || !m.app.trim()) return meldEens('hallo zonder app');
    const app = m.app.trim().slice(0, 40);
    if (app === 'varve' && !MAG_VARVE_ZIJN.has(c.herkomst)) return meldEens('een pagina die niet van VARVE is, zei varve te zijn: genegeerd');
    c.app = app;
    c.luistert = new Set(lijst(m.luistert));
    c.stuurt = new Set(lijst(m.stuurt));
    log(`${c.app} erbij · luistert: ${[...c.luistert].join(', ') || '-'} · stuurt: ${[...c.stuurt].join(', ') || '-'}`);
    c.stuur(JSON.stringify({ baan: 'hub', type: 'welkom', van: 'hub', t: nu(), apps: apps() }));
    for (const [sleutel, tekst] of laatste) if (c.luistert.has(sleutel.split(':')[0])) c.stuur(tekst);
    if (c.luistert.has('apc')) c.stuur(eigenaarBericht());
  }

  function vergeetZender(baan) {
    zender.delete(baan);
    // de stand van een zender die weg is, is niet meer waar
    for (const k of [...laatste.keys()]) if (k.startsWith(baan + ':')) laatste.delete(k);
  }

  /**
   * Een nieuwe verbinding. `kanaal.stuur(tekst, vervangbaar)` brengt een bericht naar de app.
   * @param {{stuur: Function}} kanaal
   * @param {{herkomst?: string}} [o]  zie index.js: 'varve', 'extra' of 'lokaal'
   */
  function verbind(kanaal, { herkomst = 'lokaal' } = {}) {
    const c = {
      app: null, herkomst, luistert: new Set(), stuurt: new Set(),
      stuur: (t, vervangbaar) => { try { kanaal.stuur(t, vervangbaar); } catch (_) { /* één trage app mag de rest niet stoppen */ } },
    };
    clients.add(c);
    return {
      get app() { return c.app; },
      ontvang(tekst) {
        let m;
        try { m = JSON.parse(tekst); } catch (_) { return meldEens('geen JSON ontvangen'); }
        if (!m || typeof m !== 'object' || typeof m.baan !== 'string') return meldEens('bericht zonder baan');
        if (m.baan === 'hub') return m.type === 'hallo' ? hallo(c, m) : undefined;
        if (!c.app) return meldEens('bericht vóór hallo');
        if (!BANEN.includes(m.baan)) return meldEens(`onbekende baan: ${String(m.baan).slice(0, 40)}`);
        if (!c.stuurt.has(m.baan)) return meldEens(`${c.app} stuurt op ${m.baan} zonder dat in hallo te zeggen`);
        if (ALLEEN[m.baan]) {
          if (ALLEEN[m.baan] !== c.app) return meldEens(`${c.app} mag niet op ${m.baan}; dat doet alleen ${ALLEEN[m.baan]}`);
          const z = zender.get(m.baan);
          if (z && z.client !== c && nu() - z.laatst < ZENDER_STIL_MS) {
            return meldEens(`tweede ${c.app} op ${m.baan} genegeerd (bijvoorbeeld localhost én ts.net)`);
          }
          if (z && z.client !== c) vergeetZender(m.baan);   // de vorige zweeg te lang
          zender.set(m.baan, { client: c, laatst: nu() });
        }
        if (m.baan === 'apc') return apcBericht(c, m);
        m.van = c.app;                                     // niemand spreekt namens een ander
        if (typeof m.t !== 'number') m.t = nu();
        const uit = JSON.stringify(m);
        if (BEWAAR[m.baan]?.includes(m.type)) {
          laatste.set(`${m.baan}:${m.type}${typeof m.deck === 'string' ? ':' + m.deck : ''}`, uit);
        }
        naarLuisteraars(m.baan, uit, c, VERVANGBAAR.has(`${m.baan}:${m.type}`));
      },
      sluit() {
        if (!clients.delete(c)) return;
        for (const [baan, z] of [...zender]) if (z.client === c) vergeetZender(baan);
        if (apc !== null && apc === c.app && ![...clients].some((x) => x.app === c.app)) { apc = null; meldEigenaar(); }
        if (c.app) log(`${c.app} weg`);
      },
    };
  }

  return {
    verbind,
    status: () => ({
      apps: [...clients].filter((c) => c.app).map((c) => ({ app: c.app, luistert: [...c.luistert], stuurt: [...c.stuurt] })),
      apc,
      zenders: Object.fromEntries([...zender].map(([b, z]) => [b, z.client.app])),
      bewaard: [...laatste.keys()],
    }),
  };
}
