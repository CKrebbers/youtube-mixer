// Beeld dat de mix hoort: kenmerken uit een spectrum, onsets, de router en de
// haak in de vormlaag. Geen browser: een nep-spectrum zoals een AnalyserNode
// het geeft, en een nep-analyser die net zo streng is als de echte.
// Draai met: node test/analyse.test.mjs
import { readFileSync } from 'node:fs';

const F = await import('../src/analysis/features.js');
const { Luisteraar } = await import('../src/analysis/luisteraar.js');
const { Router, offsets, BRONNEN, standaardRoute } = await import('../src/analysis/router.js');
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
  ok('vijf bronnen', BRONNEN.join() === 'laag,midden,hoog,onset,rms');

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
}

console.log('regel 1 en de vormen-regels');
{
  const vies = ['features.js', 'router.js', 'luisteraar.js'].filter((f) => /\bdocument\b|\bwindow\b|performance\.now|Math\.random|setInterval|requestAnimationFrame/.test(
    readFileSync(new URL(`../src/analysis/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  ok('features, router en luisteraar: geen DOM, geen eigen klok, geen timer', vies.length === 0);
  if (vies.length) console.log('      vies:', vies.join(', '));
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
