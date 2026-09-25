// Beeld dat de mix hoort: kenmerken uit een spectrum, onsets, de router en de
// haak in de vormlaag. Geen browser: een nep-spectrum zoals een AnalyserNode
// het geeft, en een nep-analyser die net zo streng is als de echte.
// Draai met: node test/analyse.test.mjs
import { readFileSync } from 'node:fs';

const F = await import('../src/analysis/features.js');
const { Luisteraar } = await import('../src/analysis/luisteraar.js');
const { Router, offsets, BRONNEN, MIX_BRONNEN, MAAT_BRONNEN, standaardRoute, leesKenmerken } = await import('../src/analysis/router.js');
const M = await import('../src/analysis/maat.js');
const { Beatgrid } = await import('../src/engine/beatgrid.js');
const { pulsVorm } = await import('../src/video/puls.js');
const { VormLaag, VormLagen } = await import('../src/vormen/laag.js');
const actions = await import('../src/control/actions.js');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const bij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const SR = 48000, BINS = 1024;               // fftSize 2048
const hzPerBin = SR / (BINS * 2);

/**
 * Een spectrum in dB zoals getFloatFrequencyData: overal `vloer`, en per toon
 * de dichtstbijzijnde bin op `db` met lekkage (-6 en -20 dB) naar de buren,
 * zoals een Blackman-venster doet. vloer -Infinity = echte digitale stilte.
 */
function spectrum(tonen = [], vloer = -130) {
  const s = new Float32Array(BINS).fill(vloer);
  for (const { hz, db } of tonen) {
    const k = Math.round(hz / hzPerBin);
    const zet = (i, v) => { if (i >= 0 && i < BINS) s[i] = Math.max(s[i], v); };
    zet(k, db); zet(k - 1, db - 6); zet(k + 1, db - 6); zet(k - 2, db - 20); zet(k + 2, db - 20);
  }
  return s;
}
/** Breedband (een klap): elke bin tussen lo en hi op db. */
function breed(db, lo = 40, hi = 12000, vloer = -130) {
  const s = new Float32Array(BINS).fill(vloer);
  for (let i = 0; i < BINS; i++) if (i * hzPerBin >= lo && i * hzPerBin < hi) s[i] = db;
  return s;
}
/** Omzetten naar wat getByteFrequencyData zou geven (-100..-30 dB). */
const naarByte = (s) => Uint8Array.from(s, (db) => Math.max(0, Math.min(255, Math.floor(255 * (db - F.MIN_DB) / (F.MAX_DB - F.MIN_DB)))));

console.log('banden op synthetische tonen');
{
  const b100 = F.banden(spectrum([{ hz: 100, db: -30 }]), SR);
  const b1k = F.banden(spectrum([{ hz: 1000, db: -30 }]), SR);
  const b5k = F.banden(spectrum([{ hz: 5000, db: -30 }]), SR);
  ok('100 Hz: laag, niet midden of hoog', b100.laag > 0.6 && b100.midden === 0 && b100.hoog === 0);
  ok('1 kHz: midden, niet laag of hoog', b1k.midden > 0.3 && b1k.laag === 0 && b1k.hoog === 0);
  ok('5 kHz: hoog, niet laag of midden', b5k.hoog > 0.3 && b5k.laag === 0 && b5k.midden === 0);
  ok('alles 0..1', [b100, b1k, b5k].every((b) => Object.values(b).every((v) => v >= 0 && v <= 1)));
  const zacht = F.banden(spectrum([{ hz: 100, db: -60 }]), SR);
  ok('zachter = lager, maar nog boven 0', zacht.laag < b100.laag && zacht.laag > 0);
  const kill = F.banden(spectrum([{ hz: 100, db: -30 - 70 }, { hz: 1000, db: -30 }]), SR);
  ok('een bass-kill (-70 dB op de bas) haalt de laag naar 0, midden blijft', kill.laag === 0 && bij(kill.midden, b1k.midden, 1e-6));
  const stil = F.banden(spectrum([], -Infinity), SR);
  ok('digitale stilte (-Infinity): alles 0, geen NaN', Object.values(stil).every((v) => v === 0));
  ok('zwaartepunt: 100 Hz < 1 kHz < 5 kHz', b100.centroid < b1k.centroid && b1k.centroid < b5k.centroid);
  ok('zwaartepunt op een log-schaal: 1 kHz ligt rond het midden van 40 Hz–12 kHz',
    bij(b1k.centroid, Math.log(1000 / 40) / Math.log(12000 / 40), 0.03));
  const byte = F.banden(naarByte(spectrum([{ hz: 100, db: -40 }, { hz: 1000, db: -50 }])), SR);
  const flt = F.banden(spectrum([{ hz: 100, db: -40 }, { hz: 1000, db: -50 }]), SR);
  ok('Uint8 (getByteFrequencyData) geeft bijna hetzelfde als Float32', bij(byte.laag, flt.laag, 0.02) && bij(byte.midden, flt.midden, 0.02));
  const [v, t] = F.binBereik(40, 200, SR, BINS);
  ok(`fftSize 2048 op 48 kHz: ${t - v} bins in 40–200 Hz (met 1024 waren het er 4)`, t - v === 7 && F.binBereik(40, 200, SR, 512)[1] - F.binBereik(40, 200, SR, 512)[0] === 4);
}

console.log('rms uit het tijdsignaal');
{
  const sinus = (amp) => Float32Array.from({ length: 2048 }, (_, i) => amp * Math.sin(2 * Math.PI * 440 * i / SR));
  ok('stilte = 0', F.rms(new Float32Array(2048)) === 0 && F.rms(new Uint8Array(2048).fill(128)) === 0);
  ok('harder = hoger', F.rms(sinus(0.05)) < F.rms(sinus(0.3)));
  ok('op RMS_DB[1] dBFS = 1 (geklemd)', F.rms(sinus(1)) === 1);
  const byte = Uint8Array.from(sinus(0.1), (x) => Math.round(128 + x * 128));
  ok('Uint8 (128 = nul) ongeveer gelijk aan Float32', bij(F.rms(byte), F.rms(sinus(0.1)), 0.02));
}

console.log('gladmaken in seconden (regel 3)');
{
  // Vaste invoer vanaf t = 0, op 30 en op 120 beelden per seconde: op t = 0,5
  // staat de waarde even hoog.
  const loop = (fps) => { let w = 0; for (let i = 1; i <= fps / 2; i++) w = F.glad(w, 1, 1 / fps, 0.12); return w; };
  ok('30 en 120 fps: dezelfde waarde op hetzelfde moment', bij(loop(30), loop(120), 1e-12));
  ok('en dat is 1 - exp(-t/τ)', bij(loop(60), 1 - Math.exp(-0.5 / 0.12), 1e-12));
  ok('dt = 0: niets veranderd', F.glad(0.3, 1, 0, 0.1) === 0.3);
  ok('snel omhoog, rustig omlaag', F.gladOpNeer(0, 1, 0.02) > 1 - F.gladOpNeer(1, 0, 0.02));

  const kenmerken = (fps) => {
    const k = new F.Kenmerken();
    const s = spectrum([{ hz: 100, db: -40 }]);
    const stil = spectrum([]);
    let w;
    for (let i = 0; i <= fps; i++) w = k.stap(10 + i / fps, i === 0 ? stil : s, SR);
    return w;
  };
  // Stap van stil naar toon op het tweede beeld: op 30 fps later dan op 120,
  // dus hier alleen: allebei op weg naar de toon, na een seconde er vrijwel.
  const a = kenmerken(30), b = kenmerken(120);
  ok('Kenmerken: na een seconde toon staat de bas er op 30 en 120 fps', bij(a.laag, b.laag, 1e-3) && a.laag > 0.5);
  const k = new F.Kenmerken();
  const s = spectrum([{ hz: 100, db: -40 }]);
  const w1 = k.stap(5, s, SR); const w2 = k.stap(5, spectrum([]), SR);
  ok('twee keer dezelfde t (twee lagen in één beeld): hetzelfde antwoord', w1 === w2);
  k.stap(5.5, spectrum([]), SR);
  const na = k.stap(2, s, SR);
  ok('terug in de tijd (nieuwe AudioContext): opnieuw beginnen, geen sprong in de gladmaker', na.laag === F.banden(s, SR).laag);
}

console.log('onsets op een klapreeks');
{
  // 60 beelden per seconde; een klap is één beeld breedband op -45 dB,
  // daarna uitsterven. Daartussen zacht ruisend spectrum.
  const klapTijden = [1.0, 1.5, 2.0, 2.25, 2.75, 3.5];
  const reeks = (fps, klappen = klapTijden, extra = []) => {
    const k = new F.Kenmerken();
    const gevonden = [];
    const alle = [...klappen, ...extra].sort((x, y) => x - y);
    let rng = 7;
    const ruis = () => { rng = (rng * 16807) % 2147483647; return rng / 2147483647; };
    for (let i = 0; i < fps * 4.2; i++) {
      const t = i / fps;
      const laatste = alle.filter((x) => x <= t + 1e-9).pop();
      const sinds = laatste === undefined ? Infinity : t - laatste;
      const niveau = -95 + 50 * Math.exp(-sinds / 0.05);
      const s = breed(niveau);
      for (let j = 0; j < BINS; j++) s[j] += (ruis() - 0.5) * 2;       // ±1 dB ruis
      const w = k.stap(t, s, SR);
      if (w.klap) gevonden.push(t);
    }
    return gevonden;
  };
  const g60 = reeks(60);
  const raak = (gev, tijden, fps) => tijden.every((kt) => gev.some((g) => g >= kt - 1e-9 && g < kt + 1.5 / fps));
  ok(`60 fps: elke klap gevonden (${g60.length} van ${klapTijden.length})`, raak(g60, klapTijden, 60));
  ok('60 fps: geen klap in de ruis ertussen', g60.length === klapTijden.length);
  const g30 = reeks(30), g120 = reeks(120);
  ok('30 fps: dezelfde klappen', raak(g30, klapTijden, 30) && g30.length === klapTijden.length);
  ok('120 fps: dezelfde klappen', raak(g120, klapTijden, 120) && g120.length === klapTijden.length);
  const dubbel = reeks(120, [1.0, 2.0], [1.04, 2.05]);
  ok('refractair: een tweede klap 40–50 ms erna telt niet', dubbel.length === 2);
  const los = reeks(120, [1.0, 2.0], [1.1, 2.2]);
  ok('een tweede klap 100 ms erna wel', los.length === 4);

  const d = new F.OnsetDetector();
  d.stap(0, 0); d.stap(0.1, 0.5);
  ok('omhullende: 1 op de klap', bij(d.omhullende(0.1), 1));
  ok('en exp(-dt/τ) daarna, uitgerekend vanaf de klap (niet per beeld)', bij(d.omhullende(0.1 + F.ONSET_TAU), Math.exp(-1), 1e-12));
  ok('stilte (mediaan 0): de vloer houdt ruis tegen', !new F.OnsetDetector().stap(1, F.ONSET_VLOER * 0.5));
}

console.log('de luisteraar leest een analyser alleen uit');
{
  let lezen = 0;
  const analyser = {
    fftSize: 2048, frequencyBinCount: 1024, minDecibels: -100, maxDecibels: -30,
    getFloatFrequencyData(b) { if (b.length !== this.frequencyBinCount) throw new TypeError('verkeerde lengte'); lezen++; b.set(spectrum([{ hz: 100, db: -35 }])); },
    getFloatTimeDomainData(b) { if (b.length !== this.fftSize) throw new TypeError('verkeerde lengte'); b.fill(0.1); },
  };
  const l = new Luisteraar({ analyser: () => analyser, sampleRate: () => SR });
  const w = l.lees(3);
  ok('kenmerken uit de analyser', w.laag > 0.5 && w.rms > 0);
  l.lees(3);
  ok('twee lagen in één beeld: één keer uitlezen', lezen === 1);
  ok('geen audio (nog geen analyser): null', new Luisteraar({ analyser: () => null, sampleRate: () => SR }).lees(1) === null);
  const bron = readFileSync(new URL('../src/analysis/luisteraar.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok('de luisteraar hangt niets aan de audiograaf (geen connect, geen create)', !/\.connect\(|create[A-Z]/.test(bron));
  const graaf = readFileSync(new URL('../src/engine/audio-graph.js', import.meta.url), 'utf8');
  ok('de analysers per strip en op de master staan op fftSize 2048', (graaf.match(/fftSize = 2048/g) || []).length === 2 && !/fftSize = 1024/.test(graaf));
}

console.log('de router: een offset bovenop de knop');
{
  const kenm = { laag: 0.8, midden: 0.2, hoog: 0, onset: 1, rms: 0.5 };
  ok('standaardroute: bas → knop 1, sterkte 0 (niets tot je hem opendraait)', (() => { const r = standaardRoute(); return r.bron === 'laag' && r.doel === 1 && r.sterkte === 0; })());
  ok('offset = kenmerk × sterkte op de doelplek', bij(offsets([{ bron: 'laag', doel: 2, sterkte: 0.5 }], kenm)[1], 0.4) && offsets([{ bron: 'laag', doel: 2, sterkte: 0.5 }], kenm)[0] === 0);
  ok('zonder kenmerken (geen audio): alles 0', offsets([{ bron: 'laag', doel: 1, sterkte: 1 }], null).every((x) => x === 0));
  ok('een doel buiten 1..6 doet niets', offsets([{ bron: 'laag', doel: 9, sterkte: 1 }], kenm).every((x) => x === 0));
  ok('zeven bronnen: vijf uit de master, dan klap en tel van de maatgever',
    BRONNEN.join() === 'laag,midden,hoog,onset,rms,maatklap,tel' && MIX_BRONNEN.length === 5 && MAAT_BRONNEN.join() === 'maatklap,tel');

  const laag = new VormLaag({ maakCanvas: nepCanvas, systeem: 'bd' });
  laag.zetKnop(0, 0.3);
  const k = laag.knoppen[0];
  const p0 = laag.p[k.k];
  const router = new Router(1);
  router.zetSterkte(0, 0.5);
  router.pasToe(kenm, [laag]);
  ok('de basisstand blijft staan (leesKnop = wat scherm, ring en soft-takeover zien)', bij(laag.leesKnop(0), 0.3));
  ok('het systeem rekent met stand + offset', laag.p[k.k] > p0 && bij(laag.mod[0], 0.4));
  laag.zetKnop(0, 0.1);
  ok('knop draaien tijdens modulatie: de offset blijft erbovenop', bij(laag.leesKnop(0), 0.1) && laag.p[k.k] > vanaf(k, 0.1) - 1e-9 && laag.p[k.k] !== vanaf(k, 0.1));
  router.pasToe(null, [laag]);
  ok('kenmerken weg: terug naar precies de knopstand', laag.p[k.k] === vanaf(k, 0.1) && laag.mod[0] === 0);
  laag.zetKnop(0, 0.9); router.zetSterkte(0, 1); router.pasToe({ laag: 1 }, [laag]);
  ok('stand + offset boven 1: geklemd op het maximum', laag.p[k.k] === k.max);
  router.zetBron(0, 'onzin'); router.zetDoel(0, 7);
  ok('een onbekende bron of doel wordt genegeerd', router.route(0).bron === 'laag' && router.route(0).doel === 1);
  let wissels = 0; router.on('change', () => wissels++);
  router.volgendeBron(0); router.volgendDoel(0);
  ok('bron en doel rondlopen, en melden zich voor het scherm', router.route(0).bron === 'midden' && router.route(0).doel === 2 && wissels === 2);
  ok('actief() zolang er een sterkte open staat', router.actief() && (router.zetSterkte(0, 0), !router.actief()));
}

console.log('op de action-bus: sterkte, bron en doel op de gekozen laag');
{
  const v = new VormLagen({ maakCanvas: nepCanvas });
  const router = new Router(v.lagen.length);
  actions.bindVormen(v, router);
  actions.invoke('video.layer.react', 0.7);
  ok('device knob 8: sterkte van laag 1', bij(router.route(0).sterkte, 0.7) && bij(actions.read('video.layer.react'), 0.7));
  const basis = v.lagen[0].leesKnop(0);
  router.pasToe({ laag: 0.5 }, v.lagen);
  ok('read() van de vormknop geeft de BASIS, niet de gemoduleerde stand', actions.read('video.layer.knob.1') === basis && v.lagen[0].mod[0] > 0);
  actions.invoke('video.layer.select.next', true);
  ok('andere laag gekozen: zijn eigen sterkte (0)', actions.read('video.layer.react') === 0);
  actions.invoke('video.layer.react.source', true); actions.invoke('video.layer.react.source', false);
  actions.invoke('video.layer.react.target', true);
  ok('bron en doel wisselen op de gekozen laag', router.route(1).bron === 'midden' && router.route(1).doel === 2 && router.route(0).bron === 'laag');
  for (let i = 0; i < 5; i++) { actions.invoke('video.layer.react.source', true); actions.invoke('video.layer.react.source', false); }
  ok('react.source loopt door naar de maatgever: midden → hoog → klap → luid → klap (maat) → tel', router.route(1).bron === 'tel');
  ok('react is een value, bron en doel zijn triggers',
    actions.metaOf('video.layer.react').type === 'value' && actions.metaOf('video.layer.react.source').type === 'trigger');
  v.zetSysteem('hg', v.lagen[0]);
  ok('een andere vorm: offset weg tot de volgende stap, stand is de standaard', v.lagen[0].mod.every((x) => x === 0));

  const frag = JSON.parse(readFileSync(new URL('../mappings/apc40mk2-vormen.json', import.meta.url), 'utf8'));
  ok('device knob 8 (cc:0:23) in het mapje vorm = reageren, endless',
    frag.rules.some((r) => r.in === 'cc:0:23' && r.action === 'video.layer.react' && r.mode === 'endless' && r.laag === 'device.vorm'));
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  ok('uitleg voor react, react.source en react.target',
    ['video.layer.react', 'video.layer.react.source', 'video.layer.react.target'].every((a) => beschrijf(a).kort !== a && !beschrijf(a).lang.startsWith('?')));
  const uitleg = beschrijf('video.layer.react.source').lang;
  ok('de uitleg van react.source noemt de nieuwe bronnen (maatgever, klappen, tel)', /maatgever/.test(uitleg) && /klappen/.test(uitleg) && / tel$/.test(uitleg));
}

console.log('de maat: klappen uit de onset-analyse en de tel van de maatgever');
{
  // Een nep-audioklok en nep-decks: positie = P0 + (klok - c0) × rate zolang
  // hij speelt, zoals bron.positie (regel 3). t = klok - vertraging, zoals de
  // mixer hem aan laag.frame geeft; de lezer rekent de hoorbare positie zelf.
  const klok = { c: 0 };
  const deck = ({ onsets = null, bpm = 120, anker = 0, grid = null, rate = 1, P0 = 0, c0 = 0, speelt = true } = {}) => ({
    playing: speelt, rate, onsets, P0, c0,
    grid: grid ?? (bpm ? new Beatgrid({ bpm, firstBeat: anker }) : null),
    get position() { return this.playing ? this.P0 + (klok.c - this.c0) * this.rate : this.P0; },
  });
  const lezer = (tracks, V = 0) => new M.MaatLezer({ tracks: () => tracks, vertraging: () => V });
  const V = 0.04;                                 // uitgangsvertraging

  ok('klapVorm: 0 vóór de opkomst, half op de helft, 1 op de klap, exp(-d/τ) erna',
    M.klapVorm(-M.KLAP_OP - 1e-6) === 0 && bij(M.klapVorm(-M.KLAP_OP / 2), 0.5) && M.klapVorm(0) === 1 && bij(M.klapVorm(M.KLAP_TAU), Math.exp(-1)));
  const kl = Float64Array.from([1, 1.5, 2]);
  ok('laatsteKlap: binair zoeken, op de klap telt hij mee', M.laatsteKlap(kl, 0.5) === -1 && M.laatsteKlap(kl, 1.5) === 1 && M.laatsteKlap(kl, 9) === 2);
  ok('omhullende: de piek valt OP de klap, de opkomst ligt ervoor (de klappen zijn vooraf bekend)',
    M.klapOmhullende(kl, 1.5) === 1 && bij(M.klapOmhullende(kl, 1.5 - M.KLAP_OP / 2), 0.5) && M.klapOmhullende(kl, 0.9) === 0);
  ok('omhullende op rate 2: afstand in kloktijd (0,1 s tracktijd = 0,05 s echt)', bij(M.klapOmhullende(kl, 2.1, 2), Math.exp(-0.05 / M.KLAP_TAU)));
  ok('omhullende zonder klappen of zonder positie: 0', M.klapOmhullende(null, 1) === 0 && M.klapOmhullende(new Float64Array(0), 1) === 0 && M.klapOmhullende(kl, NaN) === 0);

  // Een reeks beelden op fps, met klappen en een grid; sleutel = beeldnummer op 120 fps.
  const klapTijden = Float64Array.from([1.0, 1.5, 2.0, 2.25, 2.75, 3.5]);
  const reeks = (fps, { rate = 1, grid = null } = {}) => {
    const d = deck({ onsets: klapTijden, rate, grid });
    const l = lezer([{ id: 'A', deck: d, zicht: 1 }], V);
    const uit = new Map();
    for (let i = 0; i <= 4.2 * fps; i++) {
      klok.c = i / fps;
      uit.set(i * 120 / fps, { c: klok.c, t: klok.c - V, hoor: d.position - V * rate, ...l.lees(klok.c - V) });
    }
    return uit;
  };
  const verschil = (a, b) => {
    let m = 0;
    for (const [k, w] of a) { const x = b.get(k); m = Math.max(m, Math.abs(x.maatklap - w.maatklap), Math.abs(x.tel - w.tel)); }
    return m;
  };
  const r30 = reeks(30), r60 = reeks(60), r120 = reeks(120);
  const v1 = Math.max(verschil(r30, r60), verschil(r30, r120));
  ok(`30, 60 en 120 fps: klap en tel op hetzelfde moment even hoog (max verschil ${v1.toExponential(1)})`, v1 < 1e-9);
  const gezien = (r, fps) => [...klapTijden].every((kt) => {
    const eerst = [...r.values()].find((w) => w.hoor >= kt - 1e-12);   // het eerste beeld op of na de klap
    return eerst && eerst.maatklap >= Math.exp(-(1 / fps) / M.KLAP_TAU) - 1e-9;
  });
  ok('elke klap te zien op 30, 60 en 120 fps (het beeld erna staat nog bijna vol)', gezien(r30, 30) && gezien(r60, 60) && gezien(r120, 120));
  const tussen = [...r120.values()].find((w) => w.hoor >= 3.0 - 1e-12);
  ok('tussen de klappen dooft hij uit (exp(-d/τ) na de klap op 2,75)', bij(tussen.maatklap, Math.exp(-(tussen.hoor - 2.75) / M.KLAP_TAU), 1e-9));
  ok('vóór de eerste klap: 0', r120.get(0).maatklap === 0);
  const g120 = new Beatgrid({ bpm: 120, firstBeat: 0 });
  let telAf = 0;
  for (const w of r120.values()) telAf = Math.max(telAf, Math.abs(w.tel - pulsVorm(g120.phase(w.hoor))));
  ok(`tel = pulsVorm(fase van wat je hoort), precies de video-puls (max verschil ${telAf.toExponential(1)})`, telAf < 1e-9);

  const q30 = reeks(30, { rate: 1.1 }), q120 = reeks(120, { rate: 1.1 });
  let telQ = 0;
  for (const w of q120.values()) telQ = Math.max(telQ, Math.abs(w.tel - pulsVorm(g120.phase(w.hoor))));
  ok('rate 1,1: 30 en 120 fps gelijk, tel nog steeds de video-puls', verschil(q30, q120) < 1e-9 && telQ < 1e-9);
  // Een tempokaart: 120 bpm, vanaf 2,1 s 150 bpm (met een overgangstel). Het
  // uitdoven volgt de lengte van DEZE tel, anders hield de staart de puls op.
  const kaart = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 2.1, bpm: 150, anker: 2.13 }] });
  const k30 = reeks(30, { grid: kaart }), k120 = reeks(120, { grid: kaart });
  let telK = 0;
  for (const w of k120.values()) telK = Math.max(telK, Math.abs(w.tel - pulsVorm(kaart.phase(w.hoor))));
  ok(`tempokaart (120 -> 150 bpm): nog steeds de video-puls, 30 = 120 fps (${telK.toExponential(1)})`, telK < 1e-9 && verschil(k30, k120) < 1e-9);
  {
    const d = deck({ onsets: Float64Array.from([2.0]), rate: 1.25 });
    const l = lezer([{ id: 'A', deck: d, zicht: 1 }], V);
    // Hoorbaar = 1,25·c - 0,04·1,25: de klap op 2,0 hoor je op c = 2,05 / 1,25 = 1,64.
    const op = (c) => { klok.c = c; return { ...l.lees(c - V) }; };
    op(1.0);
    const rijst = op(1.64 - M.KLAP_OP / 2);
    const piek = op(1.64);
    const later = op(1.74);
    ok('rate 1,25: de piek valt op het moment dat je hem HOORT (positie min vertraging × rate)', bij(piek.maatklap, 1, 1e-9) && bij(rijst.maatklap, 0.5, 1e-9));
    ok('rate 1,25: uitdoven in kloktijd (0,1 s later exp(-1), niet exp(-1,25))', bij(later.maatklap, Math.exp(-1), 1e-9));
  }

  // Zonder maatgever of zonder klappen: 0, geen fout.
  {
    klok.c = 1;
    const leeg = lezer([], V);
    const w = leeg.lees(1 - V);
    ok('geen tracks: 0 en 0, geen maatgever', w.maatklap === 0 && w.tel === 0 && leeg.maatgever === null);
    const zonder = new M.MaatLezer();
    ok('zonder tracks-functie: ook 0, geen fout', zonder.lees(1).maatklap === 0 && zonder.lees(1.1).tel === 0);
    const alleen = (d, zicht = 1) => { const l = lezer([{ id: 'A', deck: d, zicht }]); klok.c = 1.0; const r = l.lees(1.0); return { ...r, wie: l.maatgever }; };
    const stil = alleen(deck({ onsets: klapTijden, speelt: false, P0: 1.0 }));
    ok('de enige track staat stil: geen maatgever, 0', stil.wie === null && stil.maatklap === 0 && stil.tel === 0);
    const dicht = alleen(deck({ onsets: klapTijden }), 0);
    ok('fader dicht (zicht 0): je hoort hem niet, dus geen maatgever', dicht.wie === null && dicht.maatklap === 0);
    const geenGrid = alleen(deck({ onsets: klapTijden, bpm: 0 }));
    ok('geen grid: geen maatgever (net als sync en de video-puls)', geenGrid.wie === null && geenGrid.maatklap === 0);
    klok.c = 1.01;
    const l = lezer([{ id: 'A', deck: deck({ onsets: null }), zicht: 1 }]);
    const w2 = l.lees(1.01);
    ok('maatgever zonder klappen (los bestand, demo): klap 0, de tel werkt', w2.maatklap === 0 && w2.tel > 0.9 && l.maatgever === 'A');
    ok('dezelfde t twee keer (twee lagen in één beeld): hetzelfde object, niets veranderd', l.lees(1.01) === w2);
  }

  // De maatgever valt weg midden in een klap: de staart dooft uit, geen val naar 0.
  {
    const d = deck({ onsets: klapTijden });
    const l = lezer([{ id: 'A', deck: d, zicht: 1 }]);
    klok.c = 1.0; l.lees(1.0);
    klok.c = 1.02; const voor = { ...l.lees(1.02) };
    d.P0 = d.position; d.playing = false;                          // stop
    klok.c = 1.04; const na = l.lees(1.04);
    ok(`maatgever stopt midden in een klap: de staart dooft uit (${voor.maatklap.toFixed(2)} -> ${na.maatklap.toFixed(2)})`,
      l.maatgever === null && bij(na.maatklap, voor.maatklap * Math.exp(-0.02 / M.KLAP_TAU), 1e-9) && na.tel > 0.5);
    klok.c = 2.2; const laat = l.lees(2.2);
    ok('…en staat na ruim een seconde op PRECIES 0 (geen eindeloze staart, dus geen parameterbericht per beeld)', laat.maatklap === 0 && laat.tel === 0);
  }

  // Wisselende maatgever. A klapt op de tel (0; 0,5; …), B ertussen (0,25; 0,75; …).
  // Beide spelen; wie de maat geeft volgt de crossfader.
  {
    const aKlap = Float64Array.from({ length: 12 }, (_, k) => k * 0.5);
    const bKlap = Float64Array.from({ length: 12 }, (_, k) => 0.25 + k * 0.5);
    const A = deck({ onsets: aKlap, anker: 0 }), B = deck({ onsets: bKlap, anker: 0.25 });
    const tr = [{ id: 'A', deck: A, zicht: 1 }, { id: 'B', deck: B, zicht: 0.5 }];
    const l = lezer(tr, 0);
    const fps = 120, r = [];
    const [i1, i2, i3] = [1.33, 2.02, 2.52].map((t) => Math.round(t * fps));   // de beelden waarop de crossfader beweegt
    const wissels = { [i1]: 0.2, [i2]: 1, [i3]: 0.2 };
    for (let i = 0; i <= 3 * fps; i++) {
      klok.c = i / fps;
      if (i in wissels) tr[0].zicht = wissels[i];
      r.push({ t: klok.c, ...l.lees(klok.c), wie: l.maatgever });
    }
    const beeld = (t) => r.findIndex((x) => x.t >= t - 1e-9);
    const ruw = (wie, t) => ({ maatklap: M.klapOmhullende(wie === 'A' ? aKlap : bKlap, t), tel: pulsVorm((wie === 'A' ? A : B).grid.phase(t)) });

    ok('de maat wisselt A -> B -> A -> B', r[i1 - 1].wie === 'A' && r[i1].wie === 'B' && r[i2 - 1].wie === 'B' && r[i2].wie === 'A'
      && r[i3 - 1].wie === 'A' && r[i3].wie === 'B');
    for (const [i, naar] of [[i1, 'B'], [i2, 'A']]) {
      const n = ruw(naar, r[i].t);
      ok(`wissel naar ${naar} op ${r[i].t.toFixed(2)} s, midden in een klap van ${naar}: geen sprong omhoog `
        + `(klap ${r[i - 1].maatklap.toFixed(2)} -> ${r[i].maatklap.toFixed(2)}, tel ${r[i - 1].tel.toFixed(2)} -> ${r[i].tel.toFixed(2)}; `
        + `zonder de regel ${n.maatklap.toFixed(2)} en ${n.tel.toFixed(2)})`,
      r[i].maatklap <= r[i - 1].maatklap + 1e-12 && r[i].tel <= r[i - 1].tel + 1e-12 && n.maatklap > 0.3 && n.tel > 0.3);
    }
    {
      const i = i3, dt = 1 / fps, n = ruw('B', r[i].t);
      ok(`wissel weg van A vlak na zijn klap (${r[i - 1].maatklap.toFixed(2)}): geen val naar B (${n.maatklap.toFixed(2)}), de staart dooft uit`,
        bij(r[i].maatklap, r[i - 1].maatklap * Math.exp(-dt / M.KLAP_TAU), 1e-9) && r[i].tel >= r[i - 1].tel * Math.exp(-dt / 0.1) - 1e-9 && n.maatklap < 0.1);
    }
    const na = r[beeld(2.75)];
    ok('daarna komen klap en tel van de nieuwe maatgever gewoon door', na.maatklap > 0.99 && na.tel > 0.99 && r[beeld(1.75)].maatklap > 0.99);
    // Over de hele reeks: omhoog alleen als de maatgever van dat beeld net een klap of tel had.
    let vreemd = 0;
    for (let i = 1; i < r.length; i++) {
      const [a, b] = [r[i - 1], r[i]];
      const kl = b.wie === 'A' ? aKlap : bKlap, g = (b.wie === 'A' ? A : B).grid;
      const klap = [...kl].some((k) => k > a.t - 1e-9 && k < b.t + M.KLAP_OP);
      const tel = Math.floor(g.beatAt(b.t)) > Math.floor(g.beatAt(a.t));
      if ((b.maatklap > a.maatklap + 1e-9 && !klap) || (b.tel > a.tel + 1e-9 && !tel)) vreemd++;
    }
    ok(`nergens een sprong omhoog zonder klap of tel van de maatgever (${vreemd} keer)`, vreemd === 0);
  }

  // Start vanaf stilstand, op de tel: die eerste tel wil je zien (geen "overname").
  {
    const d = deck({ onsets: Float64Array.from([1.0, 1.5]), speelt: false, P0: 1.0 });
    const l = lezer([{ id: 'A', deck: d, zicht: 1 }], 0);       // vertraging 0 (zoals in Node): het beeld valt al NA de tel
    klok.c = 5; l.lees(5);
    d.c0 = 5 + 1 / 120; d.playing = true;                         // play, halverwege het beeld
    klok.c = 5 + 1 / 60;
    const w = l.lees(klok.c);
    ok(`play op de tel: de eerste tel en klap zijn te zien (tel ${w.tel.toFixed(2)}, klap ${w.maatklap.toFixed(2)})`, w.tel > 0.9 && w.maatklap > 0.9);
  }

  // De klappen komen pas na het laden binnen (laden.js haalt ze op): geen sprong naar een klap van net.
  {
    const d = deck({ onsets: null });
    const l = lezer([{ id: 'A', deck: d, zicht: 1 }], 0);
    klok.c = 1.0; l.lees(1.0);
    klok.c = 1.05; d.onsets = Float64Array.from([0.98, 1.5]);
    const w = { ...l.lees(1.05) };
    klok.c = 1.5; const w2 = l.lees(1.5);
    ok('klappen die later binnenkomen: geen sprong naar de klap van 70 ms geleden, de volgende komt door', w.maatklap === 0 && bij(w2.maatklap, 1));
  }

  // Een loop die rondgaat is GEEN wissel (zelfde track): de klap op het
  // loopbegin hoor je, dus die zie je ook.
  {
    const d = deck({ onsets: Float64Array.from([1.0, 1.5]) });
    const l = lezer([{ id: 'A', deck: d, zicht: 1 }], 0);
    klok.c = 1.43; const voor = { ...l.lees(1.43) };
    klok.c = 1.45; d.P0 = 1.0; d.c0 = 1.45;                        // loop 1,0–1,45: terug naar het begin
    klok.c = 1.46; const na = l.lees(1.46);
    ok(`loop rond: de klap op het loopbegin komt door (${voor.maatklap.toFixed(2)} -> ${na.maatklap.toFixed(2)}), de tel ook`,
      bij(na.maatklap, Math.exp(-0.01 / M.KLAP_TAU), 1e-9) && na.tel > 0.9 && voor.maatklap < 0.05);
  }

  // Terug in de tijd (nieuwe AudioContext) of lang niets: opnieuw beginnen.
  {
    const l = lezer([{ id: 'A', deck: deck({ onsets: klapTijden }), zicht: 1 }]);
    klok.c = 1.0; l.lees(1.0);
    klok.c = 0.3; const w = l.lees(0.3);
    ok('terug in de tijd: opnieuw beginnen, geen staart uit de toekomst', w.maatklap === 0);
  }

  const nepEngine = {
    deck: (id) => ({ A: { buffer: {}, ui: { fader: 0.5 } }, B: { buffer: null, ui: { fader: 1 } } })[id],
    xfadeGain: (id) => (id === 'A' ? 0.8 : 1),
  };
  const et = M.engineTracks(nepEngine, ['A', 'B']);
  ok('engineTracks: zicht = fader × crossfader, een lege track 0 (zoals de video-puls)', et[0].id === 'A' && bij(et[0].zicht, 0.4) && et[1].zicht === 0);
}

console.log('de router: alleen uitlezen wat een open route nodig heeft');
{
  let mixGelezen = 0, maatGelezen = 0;
  const mix = { lees: () => { mixGelezen++; return { laag: 0.5, midden: 0, hoog: 0, onset: 0, rms: 0 }; } };
  const maat = { lees: () => { maatGelezen++; return { maatklap: 0.25, tel: 0.75 }; } };
  const router = new Router(2);
  ok('alles dicht: niets nodig', router.nodig().size === 0);
  router.zetSterkte(0, 0.5); router.zetBron(0, 'tel');
  let k = leesKenmerken(1, router.nodig(), { mix, maat });
  ok('alleen tel open: de maat gelezen, de analyser NIET', maatGelezen === 1 && mixGelezen === 0 && k.tel === 0.75);
  router.zetSterkte(1, 0.5);                                         // laag 2: de standaard, bas
  k = leesKenmerken(2, router.nodig(), { mix, maat });
  ok('tel op laag 1 en bas op laag 2: allebei, in één object', maatGelezen === 2 && mixGelezen === 1 && k.tel === 0.75 && k.laag === 0.5);
  router.zetSterkte(0, 0);
  leesKenmerken(3, router.nodig(), { mix, maat });
  ok('alleen bas open: de maat niet', maatGelezen === 2 && mixGelezen === 2);
  router.zetSterkte(0, 1);
  const half = leesKenmerken(4, router.nodig(), { mix: { lees: () => null }, maat });
  ok('geen analyser (nog geen audio): de maat werkt gewoon', half.tel === 0.75 && !('laag' in half) && offsets([router.route(1)], half)[0] === 0);
  ok('niets nodig: null', leesKenmerken(5, new Set(), { mix, maat }) === null);

  const r2 = new Router(1);
  const langs = [];
  for (let i = 0; i < BRONNEN.length; i++) { r2.volgendeBron(0); langs.push(r2.route(0).bron); }
  ok(`rondlopen: ${langs.join(' → ')}`, langs.join() === 'midden,hoog,onset,rms,maatklap,tel,laag');

  const laag = new VormLaag({ maakCanvas: nepCanvas, systeem: 'bd' });
  laag.zetKnop(0, 0.2);
  const r3 = new Router(1);
  r3.zetBron(0, 'tel'); r3.zetSterkte(0, 0.5);
  r3.pasToe({ tel: 0.8 }, [laag]);
  ok('tel als route: een OFFSET (0,8 × 0,5) bovenop de knop, de knop zelf blijft staan', bij(laag.mod[0], 0.4) && bij(laag.leesKnop(0), 0.2));
}

console.log('regel 1 en de vormen-regels');
{
  const vies = ['features.js', 'router.js', 'luisteraar.js', 'maat.js'].filter((f) => /\bdocument\b|\bwindow\b|performance\.now|Math\.random|setInterval|requestAnimationFrame/.test(
    readFileSync(new URL(`../src/analysis/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  ok('features, router, luisteraar en maat: geen DOM, geen eigen klok, geen timer', vies.length === 0);
  if (vies.length) console.log('      vies:', vies.join(', '));
  const imp = [...readFileSync(new URL('../src/analysis/maat.js', import.meta.url), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  ok(`maat.js importeert alleen pure modules, niet de engine (${imp.join(', ')})`,
    imp.every((x) => ['../lib/emitter.js', '../video/puls.js', '../video/volg.js'].includes(x)));
}

function nepCanvas(w, h) {
  const ctx = new Proxy({ createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }) },
    { get(t, k) { if (k in t) return t[k]; return () => {}; }, set(t, k, v) { t[k] = v; return true; } });
  return { width: w, height: h, getContext: () => ctx };
}
function vanaf(k, v) {
  const x = k.min + Math.max(0, Math.min(1, v)) * (k.max - k.min);
  const r = k.step ? Math.round((x - k.min) / k.step) * k.step + k.min : x;
  return Math.max(k.min, Math.min(k.max, +r.toFixed(6)));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
