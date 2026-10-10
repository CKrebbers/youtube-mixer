// Een NEP-server voor de kaart-API (scratchpad CONTRACT-KAART.md deel 2), voor
// ontwikkeling en tests van de tab kaart (src/ui/kaart-panel.js) zolang
// server/kaart.js en server/nacht.js (de serveragent, tak studio/kaart-server)
// nog niet in deze worktree staan. Geen test zelf (heet niet *.test.mjs).
//
// Leest een varve-kaart.json (deel 1; test/fixtures/varve-kaart.klein.json) en
// beantwoordt /api/kaart* en /api/nacht* in het geheugen. Alles wat niet van de
// kaart is gaat door naar een ECHTE Varve-server op `doel` (Host en Origin
// herschreven, want die server weigert een vreemde Host), of krijgt 404.
//
// Geen yt-dlp, geen netwerk, niets van YouTube: "zoek" geeft verzonnen
// kandidaten (zie `zoek`), "haal binnen" zet de wens op `bezig` en laat hem
// daar staan (rondAf() maakt hem met de hand klaar).
//
// Gebruik:
//   import { maakKaartNep } from './kaart-nep.mjs';
//   const nep = maakKaartNep({ kaart: 'test/fixtures/varve-kaart.klein.json', doel: 8814 });
//   const poort = await nep.start(0);   // 0 = een vrije poort
//   nep.verzoeken                       // elke aanroep van de kaart-API: { method, pad, body }
//   nep.speelt = () => true;            // "er speelt een deck" (409 op haal binnen en zoek)
import { createServer, request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';

/** Waarop gesorteerd kan worden en de richting zonder `richting` (gelijk aan SORTERINGEN in kaart-lijst.js). */
export const SORTERING = {
  beurten: { eerst: 'af', waarde: (n) => n.beurten ?? 0 },
  laatst: { eerst: 'af', waarde: (n) => n.laatst },
  titel: { eerst: 'op', waarde: (n) => schoon(n.titel) },
  artiest: { eerst: 'op', waarde: (n) => schoon(n.artiest) },
  duur: { eerst: 'op', waarde: (n) => n.duur },
  like_datum: { eerst: 'af', waarde: (n) => n.like_datum },
  gekeken: { eerst: 'af', waarde: (n) => n.gekeken ?? 0 },
};

export const FILTERS = ['binnen', 'niet-binnen', 'geen-video', 'vertrouwd', 'vergeten', 'evergreens', 'geliket-nooit-gespeeld', 'eigen-keuze', 'eigen-likes'];

const schoon = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** De slimme kratten uit het contract (deel 1), als regel op één nummer. */
export const SLIM = {
  vertrouwd: (n) => (n.beurten ?? 0) >= 25 && !!n.youtube_id && n.klasse === 'muziek' && (n.vorm === 'nummer' || n.vorm == null),
  vergeten: (n) => (n.beurten ?? 0) >= 25 && !!n.laatst && n.laatst < '2024-01-01' && Object.entries(n.per_jaar || {}).filter(([j]) => Number(j) < 2023).reduce((a, [, k]) => a + k, 0) >= 25,
  evergreens: (n) => Object.keys(n.per_jaar || {}).length >= 5 && (n.beurten ?? 0) >= 50,
  'geliket-nooit-gespeeld': (n) => n.like === 'eigen' && !(n.beurten > 0),
  'eigen-keuze': (n) => (n.gekozen ?? 0) >= 10 && (n.gekozen ?? 0) / Math.max(1, n.beurten ?? 0) >= 0.5,
  'eigen-likes': (n) => n.like === 'eigen',
};

/**
 * @param opties.kaart   pad naar een varve-kaart.json, of het object zelf
 * @param opties.binnen  (nummer) => track-id in de library, of null (standaard: niets binnen)
 * @param opties.speelt  () => speelt er een deck (standaard: nee)
 * @param opties.doel    poort van een echte Varve-server voor alles buiten /api/kaart en /api/nacht
 * @param opties.zoek    (nummer) => kandidaten voor "zoek" (standaard: zie nepKandidaten)
 */
export function maakKaartNep({ kaart, binnen = () => null, speelt = () => false, doel = null, zoek = nepKandidaten, pad = '~/Desktop/3. Resources/Data/Muziekkaart/varve-kaart.json' } = {}) {
  const data = typeof kaart === 'string' ? JSON.parse(readFileSync(kaart, 'utf8')) : kaart;
  const nummers = data.nummers.map((n, i) => ({ ...n, _i: i }));
  const perSleutel = new Map(nummers.map((n) => [n.sleutel, n]));
  const kratten = data.kratten || [];
  const wensen = new Map();          // sleutel -> { sleutel, status, gevraagd, youtube_id, fout, track }
  const nacht = {
    aan: false, venster: { van: '01:00', tot: '07:00' }, perNacht: 80, pauze: { min: 20, max: 90 },
    vandaagNiet: false, speeldagen: ['2026-10-10'], laatsteRun: null, volgende: null, bezig: false, standaardVolgorde: true,
  };
  const nep = { verzoeken: [], wensen, nacht, binnen, speelt, zoek, server: null, poort: null };

  const binnenVan = (n) => nep.binnen(n) ?? null;
  const wensVan = (n) => { const w = wensen.get(n.sleutel); return w ? { status: w.status, fout: w.fout, youtube_id: w.youtube_id } : null; };
  const metStand = (n) => { const { _i, ...rest } = n; return { ...rest, binnen: binnenVan(n), wens: wensVan(n) }; };
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const lees = (req) => new Promise((ok) => { const d = []; req.on('data', (c) => d.push(c)); req.on('end', () => { try { ok(JSON.parse(Buffer.concat(d).toString('utf8') || '{}')); } catch { ok(null); } }); });

  function lijst(q) {
    const zoekTerm = schoon(q.get('zoek') || '').trim();
    const kratId = q.get('krat') || '';
    const filters = (q.get('filter') || '').split(',').map((f) => f.trim()).filter(Boolean);
    const sorteer = q.get('sorteer') || 'beurten';
    if (!Object.hasOwn(SORTERING, sorteer)) return { fout: `onbekende sortering: ${sorteer}`, code: 400 };
    for (const f of filters) if (!FILTERS.includes(f)) return { fout: `onbekend filter: ${f}`, code: 400 };
    const richting = q.get('richting') || SORTERING[sorteer].eerst;
    if (richting !== 'op' && richting !== 'af') return { fout: 'richting: op of af', code: 400 };
    const van = Math.max(0, Number(q.get('van')) || 0);
    const aantal = q.has('aantal') ? Math.min(500, Math.max(1, Number(q.get('aantal')) || 100)) : 100;
    let rijen = nummers;
    if (kratId) {
      const krat = kratten.find((k) => k.id === kratId);
      if (!krat) return { fout: `onbekende krat: ${kratId}`, code: 404 };
      const volg = new Map(krat.sleutels.map((s, i) => [s, i]));
      rijen = rijen.filter((n) => volg.has(n.sleutel));
    }
    if (zoekTerm) rijen = rijen.filter((n) => (n.zoek || '').includes(zoekTerm) || schoon(n.artiest).includes(zoekTerm) || schoon(n.titel).includes(zoekTerm));
    for (const f of filters) {
      if (f === 'binnen') rijen = rijen.filter((n) => binnenVan(n));
      else if (f === 'niet-binnen') rijen = rijen.filter((n) => !binnenVan(n));
      else if (f === 'geen-video') rijen = rijen.filter((n) => !n.youtube_id);
      else rijen = rijen.filter(SLIM[f]);
    }
    const w = SORTERING[sorteer].waarde;
    const teken = richting === 'op' ? 1 : -1;
    rijen = [...rijen].sort((a, b) => {
      const x = w(a), y = w(b);
      if (x == null && y == null) return a._i - b._i;
      if (x == null) return 1;                 // onbekend altijd achteraan
      if (y == null) return -1;
      if (x < y) return -teken;
      if (x > y) return teken;
      return a._i - b._i;
    });
    return { nummers: rijen.slice(van, van + aantal).map(metStand), totaal: rijen.length, van };
  }

  async function kaartApi(req, res, url) {
    const p = url.pathname;
    const body = req.method === 'POST' ? await lees(req) : null;
    nep.verzoeken.push({ method: req.method, pad: p + url.search, body });
    if (req.method === 'POST' && body === null) return json(res, 400, { fout: 'geen geldige JSON' });

    if (p === '/api/kaart' && req.method === 'GET') {
      return json(res, 200, {
        status: 'geladen', pad, gebouwd: data.gebouwd, aantal: nummers.length, fout: null,
        kratten: kratten.map((k) => ({ id: k.id, naam: k.naam, soort: k.soort, aantal: k.sleutels.length,
          binnen: k.sleutels.filter((s) => perSleutel.has(s) && binnenVan(perSleutel.get(s))).length })),
      });
    }
    if (p === '/api/kaart/nummers' && req.method === 'GET') {
      const r = lijst(url.searchParams);
      return r.fout ? json(res, r.code, { fout: r.fout }) : json(res, 200, r);
    }
    if (p === '/api/kaart/wensen' && req.method === 'GET') return json(res, 200, { wensen: [...wensen.values()] });
    if (p === '/api/kaart/wens' && req.method === 'POST') {
      const sleutels = Array.isArray(body.sleutels) ? body.sleutels : [];
      if (sleutels.length > 20 && body.bevestig !== true) return json(res, 409, { fout: 'meer dan 20', aantal: sleutels.length });
      if (body.meteen === true && nep.speelt()) return json(res, 409, { fout: 'er speelt een deck' });
      const toegevoegd = [], geweigerd = [], gezien = new Set();
      for (const s of sleutels) {
        const n = perSleutel.get(s);
        if (gezien.has(s)) { geweigerd.push({ sleutel: s, reden: 'dubbel' }); continue; }
        gezien.add(s);
        if (!n) { geweigerd.push({ sleutel: s, reden: 'onbekende sleutel' }); continue; }
        if (binnenVan(n)) { geweigerd.push({ sleutel: s, reden: 'staat al in de library' }); continue; }
        const w = wensen.get(s);
        if (w && !['klaar', 'mislukt', 'geannuleerd'].includes(w.status)) { geweigerd.push({ sleutel: s, reden: 'staat al op de wenslijst' }); continue; }
        if (body.meteen === true && !n.youtube_id) { geweigerd.push({ sleutel: s, reden: 'geen video: eerst zoeken' }); continue; }
        wensen.set(s, { sleutel: s, status: body.meteen === true ? 'bezig' : 'wacht', gevraagd: new Date().toISOString(), youtube_id: n.youtube_id, fout: null, track: null });
        toegevoegd.push(s);
      }
      return json(res, 200, { ok: true, toegevoegd, geweigerd });
    }
    let m = /^\/api\/kaart\/wens\/(.+)$/.exec(p);
    if (m && req.method === 'DELETE') {
      const s = decodeURIComponent(m[1]);
      if (!wensen.has(s)) return json(res, 404, { fout: 'geen wens voor deze sleutel' });
      wensen.delete(s);
      return json(res, 200, { ok: true });
    }
    m = /^\/api\/kaart\/nummer\/([^/]+)(?:\/(zoek|kies))?$/.exec(p);
    if (m) {
      const s = decodeURIComponent(m[1]);
      const n = perSleutel.get(s);
      if (!n) return json(res, 404, { fout: 'onbekende sleutel' });
      if (!m[2] && req.method === 'GET') return json(res, 200, metStand(n));
      if (m[2] === 'zoek' && req.method === 'POST') {
        if (nep.speelt()) return json(res, 409, { fout: 'er speelt een deck' });
        const w = wensen.get(s);
        if (w && w.status === 'wacht') w.status = 'kies';
        return json(res, 200, { kandidaten: nep.zoek(n) });
      }
      if (m[2] === 'kies' && req.method === 'POST') {
        if (typeof body.youtube_id !== 'string' || !body.youtube_id) return json(res, 400, { fout: 'youtube_id ontbreekt' });
        const w = wensen.get(s) || { sleutel: s, gevraagd: new Date().toISOString(), fout: null, track: null };
        w.youtube_id = body.youtube_id;
        w.status = 'wacht';
        wensen.set(s, w);
        return json(res, 200, { ok: true, wens: w });
      }
    }
    if (p === '/api/nacht' && req.method === 'GET') return json(res, 200, nacht);
    if (p === '/api/nacht' && req.method === 'POST') {
      if (typeof body.aan === 'boolean') nacht.aan = body.aan;
      if (typeof body.vandaagNiet === 'boolean') nacht.vandaagNiet = body.vandaagNiet;
      if (Number.isInteger(body.perNacht) && body.perNacht >= 1 && body.perNacht <= 500) nacht.perNacht = body.perNacht;
      if (body.venster && typeof body.venster === 'object') {
        for (const k of ['van', 'tot']) if (/^([01]\d|2[0-3]):[0-5]\d$/.test(body.venster[k] || '')) nacht.venster[k] = body.venster[k];
      }
      if (body.pauze && typeof body.pauze === 'object') {
        if (Number.isFinite(body.pauze.min)) nacht.pauze.min = body.pauze.min;
        if (Number.isFinite(body.pauze.max)) nacht.pauze.max = body.pauze.max;
      }
      if (Array.isArray(body.speeldagen)) nacht.speeldagen = body.speeldagen.filter((d) => /^\d{4}-\d\d-\d\d$/.test(d));
      nacht.volgende = nacht.aan && !nacht.vandaagNiet ? new Date(new Date().setHours(25, 0, 0, 0)).toISOString() : null;
      return json(res, 200, nacht);
    }
    if (p === '/api/nacht/nu' && req.method === 'POST') {
      if (nep.speelt()) return json(res, 409, { fout: 'er speelt een deck' });
      if (nacht.speeldagen.includes(new Date().toISOString().slice(0, 10))) return json(res, 409, { fout: 'vandaag is een speeldag' });
      nacht.bezig = true;
      return json(res, 200, { ok: true, aantal: body.aantal ?? nacht.perNacht });
    }
    if (p === '/api/nacht/stop' && req.method === 'POST') { nacht.bezig = false; return json(res, 200, { ok: true }); }
    return json(res, 404, { fout: 'onbekend eindpunt (nep)' });
  }

  /** Alles wat niet van de kaart is: naar de echte server, met Host en Origin alsof het rechtstreeks kwam. */
  function doorgeven(req, res) {
    if (!doel) return json(res, 404, { fout: 'onbekend eindpunt (nep zonder doel)' });
    const headers = { ...req.headers, host: `localhost:${doel}` };
    if (headers.origin) headers.origin = `http://localhost:${doel}`;
    const up = httpRequest({ host: '127.0.0.1', port: doel, method: req.method, path: req.url, headers }, (ur) => {
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
    });
    up.on('error', (err) => { try { json(res, 502, { fout: `doel niet bereikbaar: ${err.message}` }); } catch {} });
    req.pipe(up);
  }

  nep.server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/kaart' || url.pathname.startsWith('/api/kaart/') || url.pathname === '/api/nacht' || url.pathname.startsWith('/api/nacht/')) {
      kaartApi(req, res, url).catch((err) => { try { json(res, 500, { fout: String(err?.message || err) }); } catch {} });
    } else doorgeven(req, res);
  });
  nep.start = (poort = 0) => new Promise((ok, fout) => {
    nep.server.once('error', fout);
    nep.server.listen(poort, '127.0.0.1', () => { nep.poort = nep.server.address().port; ok(nep.poort); });
  });
  nep.stop = () => new Promise((ok) => { nep.server.closeAllConnections?.(); nep.server.close(() => ok()); });
  /** Een wens die "bezig" is met de hand klaar maken (de echte server doet dat na de ingest). */
  nep.rondAf = (sleutel, trackId = perSleutel.get(sleutel)?.youtube_id ?? sleutel) => {
    const w = wensen.get(sleutel);
    if (!w) return null;
    w.status = 'klaar';
    w.track = trackId;
    return w;
  };
  return nep;
}

/**
 * Verzonnen zoekkandidaten (geen yt-dlp): drie per nummer, in de vorm van het
 * contract. Met een EIGEN like is de eerste "zeker" (score 0,95: Topic-kanaal,
 * lengte klopt, titel erin); anders twijfelt hij (0,72 / 0,55 / 0,30).
 */
export function nepKandidaten(n) {
  const zeker = n.like === 'eigen';
  const basis = `${n.sleutel.replace(/^\w+:/, '').slice(0, 7)}`;
  const duur = n.duur ?? 240;
  return [
    { youtube_id: `${basis}zk01`.padEnd(11, 'x').slice(0, 11), titel: `${n.titel}`, kanaal: `${n.artiest} - Topic`, duur: duur + (zeker ? 0.4 : 9), score: zeker ? 0.95 : 0.72, reden: zeker ? 'Topic-kanaal, lengte klopt, titel erin' : 'Topic-kanaal, lengte 9 s anders' },
    { youtube_id: `${basis}zk02`.padEnd(11, 'x').slice(0, 11), titel: `${n.artiest} - ${n.titel} (live)`, kanaal: 'Nachtwerk Archief', duur: duur + 48, score: 0.55, reden: 'titel erin, ander kanaal, langer' },
    { youtube_id: `${basis}zk03`.padEnd(11, 'x').slice(0, 11), titel: `${n.titel} remix`, kanaal: 'Onbekend', duur: duur * 1.5, score: 0.3, reden: 'alleen de titel' },
  ];
}
