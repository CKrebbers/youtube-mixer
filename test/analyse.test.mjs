// Beeld dat de mix hoort: kenmerken uit een spectrum, onsets, de router en de
// haak in de vormlaag. Geen browser: een nep-spectrum zoals een AnalyserNode
// het geeft, en een nep-analyser die net zo streng is als de echte.
// Draai met: node test/analyse.test.mjs
// @alleen: afvalmeting (v8 total_allocated_bytes per beeld; met andere tests ernaast meet hij hun afval mee)
import { readFileSync } from 'node:fs';

const F = await import('../src/analysis/features.js');
const { Luisteraar } = await import('../src/analysis/luisteraar.js');
const { Router, offsets, BRONNEN, MIX_BRONNEN, MAAT_BRONNEN, standaardRoute, leesKenmerken } = await import('../src/analysis/router.js');
const M = await import('../src/analysis/maat.js');
const { Beatgrid } = await import('../src/engine/beatgrid.js');
const { pulsVorm } = await import('../src/video/puls.js');
const { faderGain } = await import('../src/engine/audio-graph.js');
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
  // De strip staat in audio-graph.js, de master sinds 5 okt in master.js.
  const graaf = readFileSync(new URL('../src/engine/audio-graph.js', import.meta.url), 'utf8')
    + readFileSync(new URL('../src/engine/master.js', import.meta.url), 'utf8');
  ok('de analysers per strip en op de master staan op fftSize 2048', (graaf.match(/fftSize = 2048/g) || []).length === 2 && !/fftSize = 1024/.test(graaf));
}

console.log('de router: een offset bovenop de knop');
{
  const kenm = { laag: 0.8, midden: 0.2, hoog: 0, onset: 1, rms: 0.5 };
  ok('standaardroute: bas → knop 1, sterkte 0 (niets tot je hem opendraait)', (() => { const r = standaardRoute(); return r.bron === 'laag' && r.doel === 1 && r.sterkte === 0; })());
  ok('offset = kenmerk × sterkte op de doelplek', bij(offsets([{ bron: 'laag', doel: 2, sterkte: 0.5 }], kenm)[1], 0.4) && offsets([{ bron: 'laag', doel: 2, sterkte: 0.5 }], kenm)[0] === 0);
  ok('zonder kenmerken (geen audio): alles 0', offsets([{ bron: 'laag', doel: 1, sterkte: 1 }], null).every((x) => x === 0));
  ok('een doel buiten 1..6 doet niets', offsets([{ bron: 'laag', doel: 9, sterkte: 1 }], kenm).every((x) => x === 0));
  // Bewust bijgewerkt (6 okt, secties verweven): de maatgever geeft er twee
  // bronnen bij, achteraan, zodat de volgorde van de eerste zeven (en dus het
  // rondlopen van react.source tot "tel") niet verandert.
  ok('negen bronnen: vijf uit de master, dan klap, tel, sectie-energie en nieuwe sectie van de maatgever',
    BRONNEN.join() === 'laag,midden,hoog,onset,rms,maatklap,tel,sectie.energie,sectie.nieuw' && MIX_BRONNEN.length === 5
    && MAAT_BRONNEN.join() === 'maatklap,tel,sectie.energie,sectie.nieuw');

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
  ok('de uitleg van react.source noemt de bronnen van de maatgever (klappen, tel, sectie, nieuwe sectie)',
    /maatgever/.test(uitleg) && /klappen/.test(uitleg) && / tel · /.test(uitleg) && /energie van de sectie die je hoort/.test(uitleg) && /nieuwe sectie$/.test(uitleg));
  const label = actions.metaOf('video.layer.react.source').label;
  ok(`het label van react.source noemt de secties (${label})`, /sectie · nieuwe sectie \(de maatgever\)$/.test(label));
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

  // De grens van een overname geldt alleen voor die overname: B neemt de maat
  // over MIDDEN in zijn loop (0,75–1,75), dus de loop gaat daarna terug tot
  // vóór het moment van de wissel. Die klappen en tellen hoor je opnieuw, dus
  // die wil je zien. (Eerst bleef de grens staan tot de volgende wissel: de
  // hele loop bleef stil, net als alles na een hotcue terug.)
  {
    const aKlap = Float64Array.from({ length: 12 }, (_, k) => k * 0.5);
    const bKlap = Float64Array.from({ length: 12 }, (_, k) => 0.25 + k * 0.5);
    const A = deck({ onsets: aKlap }), B = deck({ onsets: bKlap, anker: 0.25 });
    const tr = [{ id: 'A', deck: A, zicht: 1 }, { id: 'B', deck: B, zicht: 0.5 }];
    const l = lezer(tr, 0);
    const fps = 120, r = [];
    for (let i = 0; i <= 3.2 * fps; i++) {
      klok.c = i / fps;
      if (i === Math.round(1.33 * fps)) tr[0].zicht = 0.2;        // B neemt de maat over, bij 1,33 in zijn loop
      if (klok.c > 1.33 && B.position >= 1.75) { B.P0 = 0.75 + (B.position - 1.75); B.c0 = klok.c; }
      r.push({ c: klok.c, pos: B.position, wie: l.maatgever, ...l.lees(klok.c) });
    }
    // De eerste beelden na elke klap van B in de loop (0,75 en 1,25), na de wissel.
    const na = (tk) => r.filter((x) => x.c > 1.34 && x.pos >= tk && x.pos < tk + 1 / fps + 1e-9);
    const klappen = [...na(0.75), ...na(1.25)];
    ok(`maatgever B in een loop die terug gaat tot vóór de wissel: zijn klappen en tellen komen door `
      + `(${klappen.length} beelden, klap ${Math.min(...klappen.map((x) => x.maatklap)).toFixed(2)}, tel ${Math.min(...klappen.map((x) => x.tel)).toFixed(2)})`,
    klappen.length >= 4 && klappen.every((x) => x.wie === 'B' && x.maatklap > 0.9 && x.tel > 0.9));
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
  ok('engineTracks: hoe hard hij klinkt = faderGain × crossfader (zoals syncMaster), een lege track 0',
    et[0].id === 'A' && bij(et[0].zicht, faderGain(0.5) * 0.8) && et[1].zicht === 0);

  // Wie de maat geeft: vorm, video-puls en de MAAT-badge (engine.syncMaster:
  // ook sync, sampler en sends) moeten dezelfde track kiezen zolang die
  // speelt en hoorbaar is. Eerst rangschikten vorm en video-puls op de
  // LINEAIRE fader, syncMaster op het echte volume (dB-curve): track 1 (A)
  // fader 1 en track 3 (thru) fader 0,8 met de crossfader in het midden gaf
  // MAAT op 1 en de puls op 3.
  {
    const { Engine, DECK_IDS } = await import('../src/engine/engine.js');
    const { xfaderGains } = await import('../src/engine/audio-graph.js');
    const { maatgever } = await import('../src/video/puls.js');
    const nep = (xfader, stand) => {
      const kant = { A: 'A', B: 'B' };
      const decks = Object.fromEntries(DECK_IDS.map((id) => [id, { id, buffer: stand[id] ? {} : null,
        grid: stand[id]?.grid === false ? null : stand[id] ? new Beatgrid({ bpm: 120, firstBeat: 0 }) : null,
        playing: !!stand[id]?.speelt, position: 1, rate: 1, onsets: null, ui: { fader: stand[id]?.fader ?? 1 } }]));
      const e = { decks, kant, deck: (id) => decks[id],
        xfadeGain: (id) => { const g = xfaderGains(xfader); return kant[id] === 'A' ? g.a : kant[id] === 'B' ? g.b : 1; } };
      // De echte syncMaster met zijn hysterese (Engine.maatgever, dj-klank):
      // wat hij van de engine nodig heeft, en een audioklok om mee te wachten.
      for (const k of ['syncMaster', 'maatgever', '_kanMaat', '_maatGain']) e[k] = Engine.prototype[k];
      Object.assign(e, { _maat: { id: null, sinds: null }, _maatTimer: null, ctx: { currentTime: 0 }, emit: () => {} });
      return e;
    };
    const badge = (e) => { const m = e.syncMaster(); return m?.playing ? m.id : null; };
    // Het vormpaneel maakt zijn lezer zo (engineMaatLezer): met de maatgever van de engine.
    const vorm = (e) => M.engineMaatLezer(e, DECK_IDS).kies().tr?.id ?? null;
    const e1 = nep(0.5, { A: { speelt: true, fader: 1 }, C: { speelt: true, fader: 0.8 } });
    ok(`track 1 fader 1 (A-kant), track 3 fader 0,8 (thru), crossfader midden: badge, vorm en video-puls kiezen dezelfde (${badge(e1)} · ${vorm(e1)} · ${maatgever(e1, DECK_IDS)})`,
      badge(e1) === 'A' && vorm(e1) === 'A' && maatgever(e1, DECK_IDS) === 'A');
    // Veel standen: fader, crossfader, wie speelt, wie een grid heeft.
    let zaad = 7;
    const r = () => { zaad = (zaad * 16807) % 2147483647; return (zaad - 1) / 2147483646; };
    let anders = 0, n = 0;
    for (let k = 0; k < 400; k++) {
      const stand = {};
      for (const id of DECK_IDS) if (r() < 0.6) stand[id] = { speelt: r() < 0.7, fader: r() < 0.15 ? 0 : r(), grid: r() < 0.9 };
      const e = nep(r(), stand);
      const b = badge(e);
      // Speelt de badge-track maar hoor je hem niet (fader dicht, crossfader weg),
      // dan geen puls: dat verschil is bewust (je hoort geen tel).
      const hoorbaar = b && faderGain(e.decks[b].ui.fader) * e.xfadeGain(b) > 0.001;
      const verwacht = hoorbaar ? b : null;
      n++;
      if (vorm(e) !== verwacht || maatgever(e, DECK_IDS) !== verwacht) anders++;
    }
    ok(`${n} willekeurige standen: vorm en video-puls volgen de MAAT-badge zolang je die track hoort (${anders} keer anders)`, anders === 0);

    // Hysterese (integratie ronde 3): badge, vorm en puls wisselen SAMEN, pas
    // als de ander 3 dB harder klinkt en dat MAAT_WACHT lang volhoudt. Eerst
    // kozen vorm en puls zelf de hardste (klokTrack) en sprongen ze bij twee
    // ongeveer even harde tracks los van de badge heen en weer.
    const { MAAT_WACHT } = await import('../src/engine/engine.js');
    const e = nep(0, { A: { speelt: true, fader: 1 }, C: { speelt: true, fader: 0.9 } });   // crossfader op A: A 0 dB
    const lezer = M.engineMaatLezer(e, DECK_IDS);
    const wie = () => [badge(e), lezer.kies().tr?.id ?? null, maatgever(e, DECK_IDS)].join(' ');
    const alle = (id) => wie() === [id, id, id].join(' ');
    const stap = [alle('A')];
    e.decks.C.ui.fader = 1; e.decks.A.ui.fader = 0.95;             // C 2,25 dB harder: te weinig
    e.ctx.currentTime += 1;
    stap.push(alle('A'));
    e.decks.A.ui.fader = 0.9;                                        // C 4,5 dB harder: wachten
    stap.push(alle('A'));
    e.ctx.currentTime += MAAT_WACHT - 0.05;
    stap.push(alle('A'));
    e.ctx.currentTime += 0.06;
    stap.push(alle('C'));
    ok(`hysterese: badge, vorm en puls blijven samen op A tot C 3 dB harder is en ${MAAT_WACHT * 1000} ms volhoudt, dan samen naar C (${stap.map((x) => (x ? 'ja' : 'nee')).join(' ')})`,
      stap.every(Boolean), wie());
    e.decks.C.ui.fader = 0;                                          // C hoor je niet meer
    ok(`maatgever die je niet hoort: badge blijft (hysterese), vorm en puls geven geen tel (${wie()})`,
      badge(e) === 'C' && lezer.kies().tr === null && maatgever(e, DECK_IDS) === null);
    e.decks.C.ui.fader = 1; e.decks.C.wacht = true;
    ok(`een wachtende track (start op de maat) geeft geen maat: meteen terug naar A (${wie()})`, alle('A'));
    e.decks.C.wacht = false; e.decks.C.remt = true;
    ok(`een remmende track ook niet (${wie()})`, alle('A'));
  }
}

console.log('de secties als bron: sectie.energie en sectie.nieuw van de maatgever (docs/SECTIES.md)');
{
  // Nep-decks zoals hierboven, met een sectiekaart. maat.js kent de engine niet:
  // deck.sectieKaart is duck-typed, alleen `.stukken` (tracktijd, eerste op 0).
  const klok = { c: 0 };
  const deck = ({ secties = null, bpm = 120, rate = 1, P0 = 0, c0 = 0, speelt = true } = {}) => ({
    playing: speelt, rate, onsets: null, P0, c0, sectieKaart: secties ? { stukken: secties } : null,
    grid: bpm ? new Beatgrid({ bpm, firstBeat: 0 }) : null,
    get position() { return this.playing ? this.P0 + (klok.c - this.c0) * this.rate : this.P0; },
  });
  const lezer = (tracks, V = 0) => new M.MaatLezer({ tracks: () => tracks, vertraging: () => V });
  const N = 'sectie.nieuw', E = 'sectie.energie';
  const ST = [{ van: 0, label: 'intro', groep: 'A', energie: 0.3 }, { van: 2, label: 'drop', groep: 'B', energie: 1 },
    { van: 3.5, label: 'break', groep: 'C', energie: 0.2 }];

  // De vorm van een nieuwe sectie: als een klap (de begins zijn vooraf bekend,
  // dus de opkomst ligt vóór het begin en de piek OP het begin), maar langer,
  // en alleen op een GRENS. Gemeten met een lezer op 1000 beelden per seconde.
  const fijn = (() => {
    const d = deck({ secties: ST });
    const l = lezer([{ id: 'A', deck: d, zicht: 1 }], 0);
    const uit = new Map();
    for (let i = 0; i <= 2600; i++) { klok.c = i / 1000; uit.set(i, l.lees(klok.c)[N]); }
    return uit;
  })();
  ok('nieuwe sectie: 1 precies op het begin, de opkomst (12 ms) ervoor, exp(-d/τ) erna',
    fijn.get(2000) === 1 && bij(fijn.get(1994), 0.5) && fijn.get(1987) === 0 && bij(fijn.get(2300), Math.exp(-0.3 / M.NIEUW_TAU)));
  ok(`een accent: twee keer een klap (τ ${M.NIEUW_TAU} s tegen ${M.KLAP_TAU} s)`, M.NIEUW_TAU === 0.2 && M.KLAP_TAU === 0.1);
  ok('het begin van het nummer (sectie 1 op 0) is geen nieuwe sectie', [...fijn].filter(([i]) => i < 1988).every(([, n]) => n === 0));
  ok('laatsteBegin: de sectie waarin pos valt (−1 ervóór), met of zonder gok (de vorige index), ook als de gok ver weg is',
    M.laatsteBegin?.(ST, -0.01) === -1 && M.laatsteBegin(ST, 0) === 0 && M.laatsteBegin(ST, 1.99) === 0 && M.laatsteBegin(ST, 2) === 1
    && M.laatsteBegin(ST, 9) === 2 && M.laatsteBegin(ST, 2.5, 0) === 1 && M.laatsteBegin(ST, 0.5, 2) === 0 && M.laatsteBegin(ST, 3.6, 1) === 2
    && M.laatsteBegin(ST, 1, 7) === 0 && M.laatsteBegin([], 1, 0) === -1);

  // Een reeks beelden op fps; sleutel = beeldnummer op 120 fps (zelfde moment).
  const V = 0.04;
  const reeks = (fps) => {
    const d = deck({ secties: ST });
    const l = lezer([{ id: 'A', deck: d, zicht: 1 }], V);
    const uit = [];
    for (let i = 0; i <= 4.2 * fps; i++) {
      klok.c = i / fps;
      const w = l.lees(klok.c - V);
      uit.push({ k: i * 120 / fps, hoor: d.position - V, n: w[N], e: w[E] });
    }
    return uit;
  };
  const r30 = reeks(30), r60 = reeks(60), r120 = reeks(120);
  const m120 = new Map(r120.map((x) => [x.k, x]));
  let dN = 0, dE = 0;
  for (const r of [r30, r60]) for (const x of r) { const y = m120.get(x.k); dN = Math.max(dN, Math.abs(x.n - y.n)); dE = Math.max(dE, Math.abs(x.e - y.e)); }
  ok(`30, 60 en 120 fps: de nieuwe sectie op hetzelfde moment even hoog (${dN.toExponential(1)}), de energie ook (${dE.toExponential(1)})`,
    dN < 1e-9 && dE < 2e-3);
  const eerstNa = (r, t) => r.find((x) => x.hoor >= t - 1e-12);
  const laatstVoor = (r, t) => r.filter((x) => x.hoor < t - 1e-12).at(-1);
  const gezien = (r, fps) => [2, 3.5].every((van) => eerstNa(r, van).n >= Math.exp(-(1 / fps) / M.NIEUW_TAU) - 1e-9);
  ok('elke nieuwe sectie te zien op 30, 60 en 120 fps, op het moment dat je hem HOORT (positie min vertraging): het beeld erna staat nog bijna vol',
    gezien(r30, 30) && gezien(r60, 60) && gezien(r120, 120));
  ok('ervóór (verder dan de opkomst) precies 0: ook niet bij het begin van het nummer', r120.filter((x) => x.hoor < 2 - M.KLAP_OP).every((x) => x.n === 0));
  const tussen = eerstNa(r120, 2.6);
  ok('na de grens dooft hij uit (exp(-d/τ))', bij(tussen.n, Math.exp(-(tussen.hoor - 2) / M.NIEUW_TAU), 1e-9));
  ok('energie = die van de sectie die je HOORT, en hij springt mee OP de grens (zelfde track: wat je hoort, zie je)',
    laatstVoor(r120, 2)?.e === 0.3 && eerstNa(r120, 2).e === 1 && laatstVoor(r120, 3.5).e === 1 && eerstNa(r120, 3.5).e === 0.2);
  ok(`bij het begin glijdt de energie op (τ ${M.ENERGIE_TAU} s), geen sprong van 0 naar 0,3`,
    r120[0].e === 0 && bij(r120[1].e, 0.3 * (1 - Math.exp(-(1 / 120) / M.ENERGIE_TAU)), 1e-9));
  {
    const d = deck({ secties: ST, rate: 1.25 });
    const l = lezer([{ id: 'A', deck: d, zicht: 1 }], V);
    // Hoorbaar = 1,25·c - 0,04·1,25: het begin op 2,0 hoor je op c = 2,05 / 1,25 = 1,64.
    const op = (c) => { klok.c = c; return { ...l.lees(c - V) }; };
    op(1.0);
    const piek = op(1.64), later = op(1.84);
    ok('rate 1,25: de piek valt op wat je hoort, uitdoven in kloktijd', bij(piek[N], 1, 1e-9) && bij(later[N], Math.exp(-0.2 / M.NIEUW_TAU), 1e-9));
  }

  // Alleen van de maatgever, en alleen als je hem hoort (precies zoals maatklap).
  {
    const alleen = (d, zicht = 1) => {
      const l = lezer([{ id: 'A', deck: d, zicht }]);
      const uit = [];
      for (let i = Math.round(1.9 * 120); i <= Math.round(2.3 * 120); i++) {
        klok.c = i / 120;
        const w = l.lees(klok.c);
        uit.push({ n: w[N], e: w[E], tel: w.tel, wie: l.maatgever });
      }
      return uit;
    };
    ok('fader dicht (zicht 0): geen maatgever, dus geen nieuwe sectie en geen energie', alleen(deck({ secties: ST }), 0).every((x) => x.wie === null && x.n === 0 && x.e === 0));
    ok('stilstaand op een sectiebegin: niets', alleen(deck({ secties: ST, speelt: false, P0: 2.0 })).every((x) => x.n === 0 && x.e === 0));
    ok('geen grid: geen maatgever, dus niets (zoals klap en tel)', alleen(deck({ secties: ST, bpm: 0 })).every((x) => x.n === 0 && x.e === 0));
    const zonder = alleen(deck({}));
    ok('maatgever zonder sectiekaart: 0 en 0, de tel werkt gewoon', zonder.every((x) => x.wie === 'A' && x.n === 0 && x.e === 0) && zonder.some((x) => x.tel > 0.9));
    const A = deck({ secties: ST }), B = deck({ secties: [{ van: 0, energie: 0.9 }, { van: 1.0, energie: 0.1 }] });
    const l = lezer([{ id: 'A', deck: A, zicht: 1 }, { id: 'B', deck: B, zicht: 0.5 }]);
    const uit = [];
    for (let i = 0; i <= 1.5 * 120; i++) { klok.c = i / 120; const w = l.lees(klok.c); uit.push({ n: w[N], e: w[E], wie: l.maatgever }); }
    ok('alleen de maatgever: de grens van de zachtere track B op 1,0 s geeft niets, de energie is die van A',
      uit.every((x) => x.wie === 'A' && x.n === 0) && uit.at(-1).e === 0.3);
  }

  // Een wissel van maatgever: geen sprong (zoals klap en tel).
  {
    // A: grens op 2,0. B: grenzen op 2,55 en 3,0. Op 2,6 s neemt B de maat over, 50 ms na zijn grens.
    const A = deck({ secties: ST }), B = deck({ secties: [{ van: 0, energie: 0.4 }, { van: 2.55, energie: 0.8 }, { van: 3.0, energie: 0.5 }] });
    const tr = [{ id: 'A', deck: A, zicht: 1 }, { id: 'B', deck: B, zicht: 0.5 }];
    const l = lezer(tr, 0);
    const fps = 120, r = [];
    const iw = Math.round(2.6 * fps);
    for (let i = 0; i <= 3.4 * fps; i++) {
      klok.c = i / fps;
      if (i === iw) tr[0].zicht = 0.2;
      const w = l.lees(klok.c);
      r.push({ c: klok.c, n: w[N], e: w[E], wie: l.maatgever });
    }
    const [a, b] = [r[iw - 1], r[iw]];
    const ruw = Math.exp(-(b.c - 2.55) / M.NIEUW_TAU);              // wat B zelf op dat moment gaf
    ok(`wissel naar B, 50 ms na zijn grens: geen sprong omhoog (${a.n?.toFixed(2)} -> ${b.n?.toFixed(2)}; zonder de regel ${ruw.toFixed(2)})`,
      a.wie === 'A' && b.wie === 'B' && b.n <= a.n + 1e-12 && ruw > 0.7);
    ok(`…en de energie glijdt van A (1) naar B (0,8), springt niet (${b.e?.toFixed(3)})`,
      a.e === 1 && bij(b.e, 0.8 + (1 - 0.8) * Math.exp(-(1 / fps) / M.ENERGIE_TAU), 1e-9));
    const g3 = r.find((x) => x.c >= 3.0 - 1e-9);
    ok(`de volgende grens van B (3,0 s) komt gewoon door (${g3.n?.toFixed(2)})`, g3.wie === 'B' && g3.n > 0.99);
  }

  // De kaart komt pas na het laden binnen (laden.js): geen sprong naar een grens van net.
  {
    const d = deck({});
    const l = lezer([{ id: 'A', deck: d, zicht: 1 }], 0);
    klok.c = 2.02; l.lees(2.02);
    klok.c = 2.05; d.sectieKaart = { stukken: ST };
    const w = { ...l.lees(2.05) };
    let w2 = null;
    for (let i = Math.round(2.05 * 120) + 1; i <= 3.5 * 120; i++) { klok.c = i / 120; w2 = { ...l.lees(klok.c) }; }   // gewoon verder, beeld voor beeld
    ok(`kaart die later binnenkomt: geen sprong naar de grens van 50 ms geleden (${w[N]}), de energie glijdt op (${w[E]?.toFixed(3)}), de volgende grens komt door`,
      w[N] === 0 && w[E] > 0 && w[E] < 0.5 && bij(w2[N], 1));
  }

  // Een sectie-loop (shift + pad) die rondgaat: zijn begin hoor je opnieuw, dus dat is weer een nieuwe sectie.
  // (Review sec-hub, 7 okt: een sectie is minstens een maat. Hier 240 bpm, een maat 1 s, de drop 2–3,5 = 1,5
  // maat; eerder ging de "loop" al na 0,9 s rond, korter dan een maat van 120 bpm: dat is nu een stutter.)
  {
    const d = deck({ secties: ST, bpm: 240 });
    const l = lezer([{ id: 'A', deck: d, zicht: 1 }], 0);
    for (let i = 0; i <= 3.45 * 120; i++) { klok.c = i / 120; l.lees(klok.c); }
    const voor = { ...l.lees(klok.c) };
    klok.c += 1 / 120; d.P0 = 2.0; d.c0 = klok.c - 0.004;          // terug naar het begin van de sectie, 4 ms geleden
    const na = l.lees(klok.c);
    ok(`sectie-loop rond: zijn begin is weer een nieuwe sectie (${voor[N]?.toFixed(2)} -> ${na[N]?.toFixed(2)}), de energie blijft staan`,
      voor[N] < 0.05 && bij(na[N], Math.exp(-0.004 / M.NIEUW_TAU), 1e-9) && voor[E] === 1 && na[E] === 1);
  }

  // De maatgever stopt vlak na een nieuwe sectie: alles dooft uit, niets valt naar 0.
  // (Review sec-hub, 7 okt: de energie blijft eerst HOUD staan, want korter dan dat zonder maatgever is
  // meestal een cut in de mix; daarna glijdt hij.)
  {
    const d = deck({ secties: ST });
    const l = lezer([{ id: 'A', deck: d, zicht: 1 }], 0);
    for (let i = 0; i <= 2.05 * 120; i++) { klok.c = i / 120; l.lees(klok.c); }
    const voor = { ...l.lees(klok.c) };
    d.P0 = d.position; d.playing = false;
    const stopT = klok.c;
    klok.c += 0.02; const na = { ...l.lees(klok.c) };
    klok.c = stopT + 0.02 + M.HOUD; l.lees(klok.c);                  // HOUD vanaf de lezing die hem zag wegvallen
    klok.c = stopT + 0.02 + M.HOUD + 0.02; const later = { ...l.lees(klok.c) };
    ok(`maatgever stopt: de staart dooft uit (${voor[N]?.toFixed(2)} -> ${na[N]?.toFixed(2)}), de energie blijft ${M.HOUD} s staan (${na[E]}) en glijdt dan omlaag (${later[E]?.toFixed(3)})`,
      l.maatgever === null && voor[N] > 0.7 && bij(na[N], voor[N] * Math.exp(-0.02 / M.NIEUW_TAU), 1e-9) && voor[E] === 1
      && na[E] === 1 && bij(later[E], Math.exp(-0.02 / M.ENERGIE_TAU), 1e-9));
    for (let k = 0; k < 30; k++) { klok.c += 0.1; l.lees(klok.c); }
    const laat = l.lees(klok.c);
    ok('…en staan na drie seconden op PRECIES 0 (geen eindeloze staart: geen parameterbericht per beeld)', laat[N] === 0 && laat[E] === 0);
  }

  // Afval: lees() draait elk beeld. Gemeten met v8 total_allocated_bytes, na
  // opwarmen. De SectieLezer maakt geen objecten, arrays of closures en houdt
  // zijn getallen in een Float64Array; wat overblijft zijn een paar doubles die
  // over een functiegrens gaan (de t, de positie: HeapNumbers van 16 B), ook
  // voor wie hem aanroept. Vóór de review: ~1,6 KB per beeld in het videopad.
  {
    const v8 = await import('node:v8');
    const bytes = (stap, n = 40000) => {
      if (v8.getHeapStatistics().total_allocated_bytes === undefined) return null;
      for (let i = 0; i < n; i++) stap(i);
      const a = v8.getHeapStatistics().total_allocated_bytes;
      for (let i = n; i < 2 * n; i++) stap(i);
      return (v8.getHeapStatistics().total_allocated_bytes - a) / n;
    };
    const veelST = Array.from({ length: 40 }, (_, k) => ({ van: k * 8, label: 'deel', groep: 'A', energie: (k % 5) / 4 }));
    const maak = (secties) => {
      const d = deck({ secties });
      d.onsets = Float64Array.from({ length: 4000 }, (_, k) => k * 0.25);
      const tr = [{ id: 'A', deck: d, zicht: 1 }];
      return new M.MaatLezer({ tracks: () => tr, vertraging: () => 0.03 });
    };
    const leeg = bytes((i) => { klok.c = i / 120; });
    const zonder = maak(null), met = maak(veelST);
    const bZonder = bytes((i) => { klok.c = i / 120; zonder.lees(klok.c - 0.03); });
    const bMet = bytes((i) => { klok.c = i / 120; met.lees(klok.c - 0.03); });
    const d = deck({ secties: veelST });
    const s = M.SectieLezer ? new M.SectieLezer({ deck: () => d, vertraging: () => 0.03 }) : null;
    let tellen = 0;
    const bSectie = s && bytes((i) => { klok.c = i / 120; s.lees(klok.c - 0.03); tellen += s.nieuw > 0.5 ? 1 : 0; });
    if (leeg === null) console.log('  -- afval: deze Node kent v8 total_allocated_bytes niet');
    else {
      ok(`de SectieLezer maakt geen objecten: ${(bSectie - leeg).toFixed(1)} B per beeld (lege lus ${leeg.toFixed(1)} B; hooguit een paar doubles), ${tellen} beelden met een nieuwe sectie`,
        s && tellen > 100 && bSectie - leeg < 64);
      // Het vormpaneel: lees() maakte elk beeld een nieuw waarden-object, en de
      // twee sectievelden kostten daar ~120 B per beeld bij (review). Nu hergebruikt
      // hij er één (de router leest het meteen uit, niemand bewaart het).
      const w1 = met.lees(1000), w2 = met.lees(1000 + 1 / 60);
      ok(`het vormpaneel: lees() hergebruikt zijn waarden-object (${bMet.toFixed(0)} B per beeld met een kaart, ${bZonder.toFixed(0)} zonder)`,
        w1 === w2 && bMet - bZonder < 16);
    }
    // De gok: met de index van het vorige beeld kijkt laatsteBegin naar drie
    // stukken in plaats van binair te zoeken; lees() bewaart die index.
    const veel = Array.from({ length: 40 }, (_, k) => ({ van: k * 8 }));
    let gelezen = 0;
    const tel = new Proxy(veel, { get(t, k) { if (typeof k === 'string' && /^\d+$/.test(k)) gelezen++; return t[k]; } });
    gelezen = 0; const metGok = M.laatsteBegin(tel, 100, 12), nMet = gelezen;          // 100 s valt in sectie 13 (96–104)
    gelezen = 0; const zonderGok = M.laatsteBegin(tel, 100), nZonder = gelezen;
    gelezen = 0; const volgende = M.laatsteBegin(tel, 105, 12), nVolgende = gelezen;   // net de grens over
    ok(`met de goede gok kijkt laatsteBegin naar ${nMet} stukken (ook net over de grens: ${nVolgende}), zonder gok zoekt hij binair (${nZonder})`,
      metGok === 12 && zonderGok === 12 && volgende === 13 && nMet <= 3 && nVolgende <= 4 && nZonder > nVolgende);
    const d2 = deck({ secties: ST });
    const l = lezer([{ id: 'A', deck: d2, zicht: 1 }], 0);
    for (let i = 0; i <= 3 * 120; i++) { klok.c = i / 120; l.lees(klok.c); }
    ok(`lees() bewaart de index als gok voor het volgende beeld (${l.secties?.sectie} op 3,0 s = sectie 2)`, l.secties?.sectie === 1);
  }
}

console.log('de secties na een sprong, een loop en een gat (review 6 okt, met uitgangsvertraging)');
{
  // Direct na een sprong ligt positie − vertraging vóór het doel: een plek die
  // je nooit hoort (hoorbaar.js, "Bekend"). Je hoort dan nog V lang het oude
  // stuk. Een nep-deck met een echte loop (zoals bron.js: de positie blijft in
  // [start, end)) en sprongen (hotcue).
  const klok = { c: 0 };
  const deck = ({ secties, P0 = 0, c0 = 0, rate = 1, loop = null } = {}) => ({
    playing: true, rate, onsets: null, P0, c0, loop, sectieKaart: secties ? { stukken: secties } : null,
    grid: new Beatgrid({ bpm: 120, firstBeat: 0 }),
    get position() {
      let p = this.P0 + (klok.c - this.c0) * this.rate;
      const l = this.loop;
      if (l && p >= l.end) p = l.start + ((p - l.start) % (l.end - l.start));
      return p;
    },
    sprong(T) { this.P0 = T; this.c0 = klok.c; },
  });
  const N = 'sectie.nieuw', E = 'sectie.energie';
  const ST = [{ van: 0, label: 'intro', groep: 'A', energie: 0.3 }, { van: 2, label: 'drop', groep: 'B', energie: 1 },
    { van: 4, label: 'break', groep: 'C', energie: 0.2 }, { van: 6, label: 'deel', groep: 'D', energie: 0.5 }];
  const V = 0.03;
  const lezer = (d, v = V) => new M.MaatLezer({ tracks: () => [{ id: 'A', deck: d, zicht: 1 }], vertraging: () => v });
  // De beelden: klok c, t = c − V; wat je ECHT hoort op c is de positie van c − V.
  const draai = (d, l, van, tot, fps, bij = () => {}) => {
    const uit = [];
    for (let i = Math.round(van * fps); i <= Math.round(tot * fps); i++) {
      klok.c = i / fps + 0.0003 * (i % 7);                    // niet precies op het raster
      bij(klok.c);
      const w = l.lees(klok.c - V);
      uit.push({ c: klok.c, n: w[N], e: w[E], grenzen: l.secties?.grenzen });
    }
    return uit;
  };

  // 1. Een sectie-loop over de drop [2, 4): de energie blijft 1, elke rondgang één nieuwe sectie.
  for (const fps of [60, 120]) {
    const d = deck({ secties: ST, P0: 1.5, loop: { start: 2, end: 4 } });
    const l = lezer(d);
    const r = draai(d, l, 0, 6.6, fps);
    const naDeDrop = r.filter((x) => x.c > 2.4);                     // na het opglijden bij de start
    const es = [...new Set(naDeDrop.map((x) => x.e))];
    ok(`${fps} fps, V 30 ms: sectie-loop [2, 4) over de drop, drie rondgangen: de energie blijft 1 (${es.join(', ')})`, es.length === 1 && es[0] === 1);
    // De loop begint op c 0,5 (positie 2) en gaat rond op c 2,5, 4,5 en 6,5: je hoort dat V later.
    const pieken = [0.5, 2.5, 4.5, 6.5].map((c) => r.find((x) => x.c >= c + V - 1e-9));
    ok(`…elke rondgang een nieuwe sectie, op het moment dat je het begin HOORT (${pieken.map((x) => x?.n.toFixed(2)).join(' ')})`,
      pieken.every((x) => x && x.n >= Math.exp(-(1 / fps + 0.002) / M.NIEUW_TAU)) && r.filter((x) => x.c < 0.5 + V - 0.013).every((x) => x.n === 0));
    ok(`…en de teller telt elke rondgang één keer (${r.at(-1).grenzen})`, r.at(-1).grenzen === 4);
  }
  // Dezelfde rondgang zonder loop-veld (een sprong terug, zoals de reviewer hem maakte).
  {
    const d = deck({ secties: ST, P0: 1.5 });
    const l = lezer(d);
    const r = draai(d, l, 0, 2.8, 60, (c) => { if (c >= 2.5 && d.position >= 4) d.sprong(2 + (d.position - 4)); });
    const es = [...new Set(r.filter((x) => x.c > 2.3).map((x) => x.e))];
    ok(`sprong terug van 4 naar 2 (zonder loop-veld): geen 0,3 of 0,2 ertussen (${es.join(', ')})`, es.length === 1 && es[0] === 1);
  }

  // 2. Een hotcue op het begin van een sectie (6, energie 0,5) vanuit de drop (energie 1); ervóór ligt de break (0,2).
  {
    // Start op 0: na het opglijden (1,4 s) intro 0,3, op 2 de drop (1), op c 3,0 de hotcue naar 6.
    const d = deck({ secties: ST });
    const l = lezer(d);
    const r = draai(d, l, 0, 3.4, 60, (c) => { if (c >= 3.0 && !d.gesprongen) { d.gesprongen = c; d.sprong(6); } }).filter((x) => x.c > 1.6);
    const es = r.map((x) => x.e).filter((e, i, a) => i === 0 || e !== a[i - 1]);
    const eerst = r.find((x) => x.e === 0.5), nPiek = r.find((x) => x.n > 0.5 && x.c > 3.0);
    ok(`hotcue op een sectiebegin: energie 1 → 0,5 zonder de 0,2 van de plek die je nooit hoort (${es.join(' → ')})`,
      es.join() === '0.3,1,0.5');
    ok(`…de wissel en de nieuwe sectie komen V na de druk, als je het HOORT (energie op ${((eerst.c - d.gesprongen) * 1000).toFixed(0)} ms, klap op ${((nPiek.c - d.gesprongen) * 1000).toFixed(0)} ms)`,
      eerst.c - d.gesprongen >= V - 1e-9 && eerst.c - d.gesprongen < V + 1 / 60 + 1e-3 && nPiek === r.find((x) => x.c >= d.gesprongen + V - 1e-9));
    ok(`…twee nieuwe secties: de drop en de hotcue (teller ${r.at(-1).grenzen})`, r.at(-1).grenzen === 2);
    // Een hotcue midden in een sectie (6,5) is geen nieuwe sectie.
    const d2 = deck({ secties: ST });
    const l2 = lezer(d2);
    const r2 = draai(d2, l2, 0, 3.6, 60, (c) => { if (c >= 3.0 && !d2.gesprongen) { d2.gesprongen = c; d2.sprong(6.5); } }).filter((x) => x.c > 3.0);
    ok(`een hotcue midden in een sectie: geen nieuwe sectie, alleen de staart van de drop dooft verder uit (max ${Math.max(...r2.map((x) => x.n)).toFixed(4)}, teller ${r2.at(-1).grenzen})`,
      r2.every((x, i) => x.n < 0.01 && (i === 0 || x.n <= r2[i - 1].n + 1e-12)) && r2.at(-1).grenzen === 1);
  }

  // 3. Een loop die precies OP een sectiegrens eindigt (de opbouw loopen tot de drop): de grens hoor je nooit.
  for (const v of [0, 0.005, 0.01, 0.02]) for (const fps of [60, 120]) {
    const ST2 = [{ van: 0, energie: 0.3 }, { van: 8, energie: 1 }];
    const d = deck({ secties: ST2, loop: { start: 6, end: 8 } });
    const l = lezer(d, v);
    let max = 0;
    for (let i = 0; i <= 40 * fps; i++) { klok.c = i / fps + 0.0007 * i; max = Math.max(max, l.lees(klok.c - v)[N]); }
    ok(`loop [6, 8) eindigt op de grens, V ${v * 1000} ms, ${fps} fps: geen vals accent (max ${max.toFixed(2)}, teller ${l.secties?.grenzen})`,
      max === 0 && l.secties?.grenzen === 0);
  }

  // 5. Een lezer die een tijd niet gelezen werd (puls dicht, route dicht): geen klap uit het gat.
  {
    const A = deck({ secties: ST }), B = deck({ secties: [{ van: 0, energie: 0.4 }, { van: 2.3, energie: 0.8 }] });
    const tr = [{ id: 'A', deck: A, zicht: 1 }, { id: 'B', deck: B, zicht: 0.5 }];
    const l = new M.MaatLezer({ tracks: () => tr, vertraging: () => V });
    for (let c = 1.5; c <= 2.0; c += 1 / 60) { klok.c = c; l.lees(c - V); }
    tr[0].zicht = 0.1;                                               // 0,45 s niet gelezen; B neemt de maat over
    klok.c = 2.45;
    const w = l.lees(2.45 - V)[N];
    ok(`0,45 s niet gelezen en intussen een andere maatgever: zijn grens van vóór de wissel telt niet (${w.toFixed(3)})`, w === 0);
    const d = deck({ secties: ST });
    const l2 = lezer(d);
    klok.c = 0.5; l2.lees(0.5 - V);
    klok.c = 2.1; const w2 = l2.lees(2.1 - V)[N];
    ok(`langer dan een seconde niet gelezen, open 70 ms na een grens: geen klap uit het gat (${w2.toFixed(3)})`, w2 === 0);
    // Een haper van een halve seconde over een grens (de lus draait wel door): één keer, uitgedoofd, geen tweede piek.
    const d3 = deck({ secties: ST });
    const l3 = lezer(d3);
    const r = [];
    for (let c = 1.5; c < 1.9; c += 1 / 60) { klok.c = c; l3.lees(c - V); }
    for (let c = 2.4; c < 2.6; c += 1 / 60) { klok.c = c; r.push(l3.lees(c - V)[N]); }
    ok(`een haper van 0,5 s over een grens: het beeld erna toont de klap uitgedoofd, daarna alleen omlaag (${r[0].toFixed(3)} …)`,
      bij(r[0], Math.exp(-(2.4 - V - 2) / M.NIEUW_TAU), 1e-9) && r.every((x, i) => i === 0 || x < r[i - 1]) && l3.secties?.grenzen === 1);
  }

  // Review sec-hub (7 okt). Een deck dat ook kan stilstaan (positie blijft dan staan).
  const deck2 = ({ secties, P0 = 0, loop = null, speelt = true } = {}) => ({
    playing: speelt, rate: 1, onsets: null, P0, c0: 0, loop, sectieKaart: secties ? { stukken: secties } : null,
    grid: new Beatgrid({ bpm: 120, firstBeat: 0 }),
    get position() {
      if (!this.playing) return this.P0;
      let p = this.P0 + (klok.c - this.c0) * this.rate;
      const l = this.loop;
      if (l && p >= l.end) p = l.start + ((p - l.start) % (l.end - l.start));
      return p;
    },
    sprong(T) { this.P0 = T; this.c0 = klok.c; },
    start(T) { this.P0 = T; this.c0 = klok.c; this.playing = true; },
    stop() { this.P0 = this.position; this.playing = false; },
  });

  // 6. De uitgangsvertraging wordt groter (een ander uitgangsapparaat, de limiter): t = klok − V loopt
  //    even TERUG. Dat is geen nieuwe klok: geen reset, geen valse grens, geen dip in de energie (vormbron).
  {
    const d = deck2({ secties: ST });
    let v = V;
    const s = new M.SectieLezer({ deck: () => d, vertraging: () => v });
    const l = new M.MaatLezer({ tracks: () => [{ id: 'A', deck: d, zicht: 1 }], vertraging: () => v });
    let minS = 1, minL = 1, maxN = 0;
    for (let i = 0; i <= 4.6 * 120; i++) {
      klok.c = i / 120 + 0.0003 * (i % 7);
      if (klok.c >= 2.6) v = V + 0.06;                                 // midden in de drop (2..4): 60 ms erbij
      s.lees(klok.c - v);
      const w = l.lees(klok.c - v);
      if (klok.c > 2.5 && klok.c < 3.9) { minS = Math.min(minS, s.energie); minL = Math.min(minL, w[E]); maxN = Math.max(maxN, s.nieuw); }
    }
    ok(`vertraging 60 ms groter midden in de drop: geen reset, geen valse grens (teller ${s.grenzen}, vormbron ${l.secties?.grenzen}), geen dip (energie ${minS}, vormbron ${minL}), geen klap (${maxN.toFixed(3)})`,
      s.grenzen === 2 && l.secties?.grenzen === 2 && minS === 1 && minL === 1 && maxN < 0.1);
    // Twee lezingen in één audioblok met 1 ms meer vertraging: dezelfde lezer terug, niets veranderd.
    const g = s.grenzen, e = s.energie;
    const zelfde = s.stap(klok.c - v - 0.001, d, v + 0.001);
    ok('een stap van 1 ms terug: niets veranderd (geen reset)', zelfde === s && s.grenzen === g && s.energie === e);
    s.stap(klok.c - v - 5, d, v);
    ok(`een echte sprong terug (5 s, een nieuwe klok): wel opnieuw beginnen (teller ${s.grenzen})`, s.grenzen === 0);
  }

  // 7. Een korte loop op het begin van een sectie (beatloop, stutter): het rondgaan is GEEN nieuwe sectie
  //    (anders een stroboscoop: 17 klappen per seconde bij 1/8 tel). Een loop van een maat of langer (een
  //    sectie-loop) wel, elke ronde. 120 bpm: een tel 0,5 s, een maat 2 s.
  for (const tellen of [0.125, 0.5, 1, 3, 4]) {
    const d = deck2({ secties: ST, P0: 1.5, loop: { start: 2, end: 2 + tellen * 0.5 } });
    const s = new M.SectieLezer({ deck: () => d, vertraging: () => V });
    let max = 0;
    for (let i = 0; i <= 6 * 120; i++) { klok.c = i / 120 + 0.0003 * (i % 7); s.lees(klok.c - V); if (klok.c > 1.5) max = Math.max(max, s.nieuw); }
    // De loop begint op c 0,5 (positie 2): je hoort hem op 0,53, en daarna elke ronde.
    const verwacht = tellen >= 4 ? 1 + Math.floor((6 - 0.5 - V) / (tellen * 0.5)) : 1;
    ok(`loop van ${tellen} tel op het begin van de drop: ${verwacht} nieuwe sectie(s) in 6 s (${s.grenzen})${tellen < 4 ? `, na de eerste geen klap meer (max ${max.toFixed(3)})` : ''}`,
      s.grenzen === verwacht && (tellen >= 4 || max < 0.05));
  }
  // Een hotcue-stutter (snel tikken op de hotcue op het begin van de drop): één nieuwe sectie, niet één per tik.
  {
    const d = deck2({ secties: ST });
    const s = new M.SectieLezer({ deck: () => d, vertraging: () => V });
    const tikken = [1.0, 1.15, 1.3, 1.45, 1.6, 1.75, 1.9, 4.5];          // zeven snel, dan na de break nog één
    let k = 0;
    for (let i = 0; i <= 5 * 120; i++) {
      klok.c = i / 120;
      if (k < tikken.length && klok.c >= tikken[k]) { d.sprong(2); k++; }
      s.lees(klok.c - V);
    }
    ok(`hotcue-stutter op het begin van de drop (7 tikken in 0,9 s), dan de break, dan na 2,6 s nog een tik: drie nieuwe secties (${s.grenzen})`, s.grenzen === 3);
  }

  // 8. Een nieuwe maatgever die net begint (A stopt, B start op zijn cue op de drop, in dezelfde lezing): dat
  //    is starten, geen overnemen. Ook als de eerste lezing pas na de vertraging komt.
  for (const eerste of [0.01, 0.05]) {
    const A = deck2({ secties: ST, P0: 4.5 }), B = deck2({ secties: ST, P0: 2, speelt: false });
    let mg = A;
    const s = new M.SectieLezer({ deck: () => mg, vertraging: () => V });
    for (let i = 0; i <= 120; i++) { klok.c = i / 120; s.lees(klok.c - V); }
    const g0 = s.grenzen, tS = klok.c;
    A.stop(); B.start(2); mg = B;
    const labels = [];
    for (let c = tS + eerste; c <= tS + 1; c += 1 / 60) { klok.c = c; s.lees(c - V); labels.push(s.label); }
    ok(`A stopt, B start op zijn cue (de drop), eerste lezing ${eerste * 1000} ms later: precies één nieuwe sectie (${s.grenzen - g0}), label drop`,
      s.grenzen - g0 === 1 && s.label === 'drop');
  }

  // 9. Korter dan HOUD geen maatgever (een cut in de mix, de hysterese van Engine.maatgever, ~250 ms): de
  //    energie blijft staan. Pas als hij langer weg is (pauze) glijdt hij naar 0.
  {
    const d = deck2({ secties: ST });
    let weg = false;
    const s = new M.SectieLezer({ deck: () => (weg ? null : d), vertraging: () => V });
    for (let i = 0; i <= 3 * 120; i++) { klok.c = i / 120; s.lees(klok.c - V); }
    let min = 1;
    weg = true;
    for (let c = 3 + 1 / 120; c <= 3.25; c += 1 / 120) { klok.c = c; s.lees(c - V); min = Math.min(min, s.energie); }
    weg = false;
    for (let c = 3.25 + 1 / 120; c <= 3.6; c += 1 / 120) { klok.c = c; s.lees(c - V); min = Math.min(min, s.energie); }
    ok(`250 ms geen maatgever en dan weer: de energie blijft 1 (laagste ${min})`, min === 1 && s.grenzen === 1);
    weg = true;
    const t0 = klok.c, r = [];
    for (let c = t0 + 1 / 120; c <= t0 + 3; c += 1 / 120) { klok.c = c; s.lees(c - V); r.push([c - t0, s.energie]); }
    const H = M.HOUD ?? 0;
    const daarna = r.find(([x]) => x > H + 0.1);
    ok(`langer weg (pauze): eerst ${H} s vasthouden, dan glijden naar 0 (${daarna?.[1].toFixed(3)} op ${(H + 0.1).toFixed(1)} s, na 3 s ${r.at(-1)[1]})`,
      H >= 0.4 && r.filter(([x]) => x < H - 0.01).every(([, e]) => e === 1) && daarna[1] < 1 && daarna[1] > 0.5 && r.at(-1)[1] === 0);
  }

  // 10. Het doel van de energie (de sectie zelf), ook tijdens het glijden: de hub stuurt dat bij een nieuwe sectie.
  {
    const d = deck2({ secties: ST, P0: 1.9, speelt: false });
    let aan = false;
    const s = new M.SectieLezer({ deck: () => (aan ? d : null), vertraging: () => V });
    for (let i = 0; i <= 60; i++) { klok.c = i / 120; s.lees(klok.c - V); }
    aan = true; d.start(1.9);
    let opDeGrens = null;
    const t0 = klok.c;
    for (let c = t0 + 1 / 120; c <= t0 + 0.5; c += 1 / 120) { klok.c = c; s.lees(c - V); if (!opDeGrens && s.grenzen === 1) opDeGrens = { e: s.energie, doel: s.energieDoel }; }
    ok(`energieDoel: de energie van de sectie zelf, ook als hij nog glijdt (${opDeGrens?.e.toFixed(3)} -> doel ${opDeGrens?.doel})`,
      opDeGrens && opDeGrens.e < 0.9 && opDeGrens.doel === 1);
  }

  // Voor de hub (AV-app-hub PROTOCOL §18) en elk ander gebruik: een SectieLezer
  // zonder DOM, met de tijd van buiten, die elke grens die je hoort precies één
  // keer telt (`grenzen`), met de energie, het label en de index van de sectie.
  {
    const SL = M.SectieLezer;
    const d = deck({ secties: ST });
    const s = SL ? new SL({ deck: () => d, vertraging: () => V }) : null;
    const gezien = [];
    let vorige = s?.grenzen ?? 0;
    for (let i = 0; i <= 6.5 * 60 && s; i++) {
      klok.c = i / 60; s.lees(klok.c - V);
      if (s.grenzen !== vorige) { vorige = s.grenzen; gezien.push(`${s.label}@${s.sectie}`); }
    }
    ok(`SectieLezer: elke grens die je hoort één keer (${gezien.join(' ')}), met label en index`,
      gezien.join() === 'drop@1,break@2,deel@3');
    ok('…energie en label van de sectie die je hoort', s && s.energie === 0.5 && s.label === 'deel' && s.sectie === 3);
    // Op 1000 beelden per seconde precies even vaak.
    const d2 = deck({ secties: ST });
    const s2 = SL ? new SL({ deck: () => d2, vertraging: () => V }) : null;
    for (let i = 0; i <= 6500 && s2; i++) { klok.c = i / 1000; s2.lees(klok.c - V); }
    ok(`…ook op 1000 beelden per seconde drie keer (${s2?.grenzen})`, s2?.grenzen === 3);
    // Starten op het begin van een sectie (stilstaand op de "1", dan play): die hoor je.
    for (const v of [0, V]) {
      const d3 = deck({ secties: ST, P0: 4 });
      d3.playing = false;
      const s3 = SL ? new SL({ deck: () => (d3.playing ? d3 : null), vertraging: () => v }) : null;
      for (let i = 0; i < 30 && s3; i++) { klok.c = 1 + i / 60; s3.lees(klok.c - v); }
      d3.playing = true; d3.c0 = klok.c + 0.004;
      let piek = 0;
      for (let i = 1; i < 30 && s3; i++) { klok.c = d3.c0 - 0.004 + i / 60; s3.lees(klok.c - v); piek = Math.max(piek, s3.nieuw); }
      ok(`starten op het begin van een sectie (V ${v * 1000} ms): die nieuwe sectie zie je (${piek.toFixed(2)}, teller ${s3?.grenzen})`,
        piek > 0.9 && s3?.grenzen === 1);
    }
  }
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
  ok(`rondlopen: ${langs.join(' → ')}`, langs.join() === 'midden,hoog,onset,rms,maatklap,tel,sectie.energie,sectie.nieuw,laag');
  const r4 = new Router(1);
  r4.zetBron(0, 'sectie.nieuw'); r4.zetSterkte(0, 1);
  let mixN = 0, maatN = 0;
  const k4 = leesKenmerken(6, r4.nodig(), { mix: { lees: () => { mixN++; return { laag: 1 }; } },
    maat: { lees: () => { maatN++; return { 'sectie.nieuw': 0.5 }; } } });
  ok('nieuwe sectie open: de maat gelezen, de analyser NIET, en de route geeft een offset',
    maatN === 1 && mixN === 0 && offsets([r4.route(0)], k4)[0] === 0.5);

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
  ok(`maat.js importeert alleen pure modules, niet de engine zelf (${imp.join(', ')})`,
    imp.every((x) => ['../lib/emitter.js', '../video/puls.js', '../video/volg.js', '../engine/hoorbaar.js'].includes(x)));
}

console.log('wat je HOORT: één formule (engine/hoorbaar.js)');
{
  const H = await import('../src/engine/hoorbaar.js');
  ok('uitgangsvertraging = outputLatency + baseLatency; ontbreekt iets, dan 0',
    bij(H.uitgangsVertraging({ outputLatency: 0.03, baseLatency: 0.005 }), 0.035) && H.uitgangsVertraging({}) === 0 && H.uitgangsVertraging(null) === 0);
  ok('spelend: positie min vertraging × rate (de positie loopt in tracktijd)',
    bij(H.hoorbaar({ playing: true, position: 10, rate: 1.25 }, 0.04), 10 - 0.05) && bij(H.hoorbaar({ playing: true, position: 10 }, 0.04), 9.96));
  ok('stilstaand: de positie zelf', H.hoorbaar({ playing: false, position: 10, rate: 1.25 }, 0.04) === 10);
  ok('naVertraging (de video, ook stilstaand): dezelfde formule', bij(H.naVertraging(10, 0.04, 1.25), 9.95));
  // Integratie ronde 3: wachten op de maat (dj-transport) en remmen (dj-klank).
  ok('wacht op de maat: de positie zelf (hij staat stil op zijn startpunt, je hoort nog niets)',
    H.hoorbaar({ playing: true, wacht: true, position: 8, rate: 1 }, 0.04) === 8);
  ok('remt: min vertraging × de snelheid van NU, niet de pitchfader',
    bij(H.hoorbaar({ playing: true, remt: true, snelheid: 0.5, position: 10, rate: 1.1 }, 0.04), 9.98));
  ok('rem helemaal stil (snelheid 0): de plek waar hij stilstaat, niet 1× de vertraging ervoor',
    H.hoorbaar({ playing: true, remt: true, snelheid: 0, position: 10, rate: 1 }, 0.04) === 10 && H.naVertraging(10, 0.04, 0) === 10);
  ok('zonder rate (een kaal object) blijft 1 gelden', bij(H.naVertraging(10, 0.04, undefined), 9.96) && bij(H.naVertraging(10, 0.04, NaN), 9.96));
  // Geen vijfde kopie: de vertraging van de geluidskaart wordt alleen hier opgeteld.
  const { readdirSync } = await import('node:fs');
  const alle = (map) => readdirSync(new URL(map, import.meta.url), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? alle(`${map}${e.name}/`) : e.name.endsWith('.js') ? [`${map}${e.name}`] : []));
  const kopie = alle('../src/').filter((f) => !f.endsWith('engine/hoorbaar.js')
    // Alleen de eigenschap (ctx.outputLatency): Signalsmith's `_outputLatency()` in
    // rek-kern.js (keylock) is de latentie van de stretcher, iets anders.
    && /(?<![\w$])outputLatency/.test(readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  ok(`outputLatency staat alleen in engine/hoorbaar.js${kopie.length ? ` (ook in ${kopie.join(', ')})` : ''}`, kopie.length === 0);
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
