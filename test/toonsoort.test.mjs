// De toonsoort: de kaart (puur rekenwerk), wat je HOORT (TOONSOORT.md §6), de
// weergave (§5) en de actions om met de hand te corrigeren (§7). Geen DOM.
import { readFileSync } from 'node:fs';

const T = await import('../src/engine/toonsoort.js');
const W = await import('../src/ui/toon-weergave.js');
const { ToonKaart, hoorbaar } = T;

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const bij = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const k = (s) => T.leesToonsoort(s);

// ---- Camelot-tabel -----------------------------------------------------------
// De hele wijzer, uit de standaardtabel (Mixed In Key): majeur B, mineur A.
const WIJZER_TABEL = {
  '1B': 'B', '2B': 'F#', '3B': 'Db', '4B': 'Ab', '5B': 'Eb', '6B': 'Bb', '7B': 'F', '8B': 'C', '9B': 'G', '10B': 'D', '11B': 'A', '12B': 'E',
  '1A': 'Abm', '2A': 'Ebm', '3A': 'Bbm', '4A': 'Fm', '5A': 'Cm', '6A': 'Gm', '7A': 'Dm', '8A': 'Am', '9A': 'Em', '10A': 'Bm', '11A': 'F#m', '12A': 'Dbm',
};
ok('Camelot: alle 24 toonsoorten volgens de tabel',
  Object.entries(WIJZER_TABEL).every(([c, s]) => T.camelot(k(s)) === c));
ok('spelling in de kaart: C Db D Eb E F F# G Ab A Bb B, m voor mineur',
  [...Array(24).keys()].map(T.spelling).join(' ') === 'C Db D Eb E F F# G Ab A Bb B Cm Dbm Dm Ebm Em Fm F#m Gm Abm Am Bbm Bm');
ok('lezen is ruimer dan schrijven: C#m = Dbm, E♭ = Eb, "Bb minor", "g"', k('C#m') === k('Dbm') && k('E♭') === k('Eb')
  && k('Bb minor') === k('Bbm') && k('g') === k('G') && k('H') === null && k('') === null);
ok('korte naam (T2): G, B♭m, C♯m, A♭', T.kortNaam(k('G')) === 'G' && T.kortNaam(k('Bbm')) === 'B♭m'
  && T.kortNaam(k('Dbm')) === 'C♯m' && T.kortNaam(k('Ab')) === 'A♭');
ok('volle naam (focusdeel): As majeur, Bes mineur, Cis mineur',
  T.volleNaam(k('Ab')) === 'As majeur' && T.volleNaam(k('Bbm')) === 'Bes mineur' && T.volleNaam(k('C#m')) === 'Cis mineur');
ok('een halve toon omhoog = zeven uren verder op de wijzer (mod 12), letter blijft',
  [...Array(24).keys()].every((x) => {
    const a = T.camelotGetal(x), b = T.camelotGetal(T.transponeer(x, 1));
    return (a - 1 + 7) % 12 + 1 === b && T.isMineur(x) === T.isMineur(T.transponeer(x, 1));
  }));
ok('kwint = één stap op de wijzer: C → G (8B → 9B), Am → Dm terug (8A → 7A)',
  T.kwint(k('C'), 1) === k('G') && T.kwint(k('Am'), -1) === k('Dm') && T.kwint(k('B'), 1) === k('F#'));
ok('relatief: zelfde getal, andere letter (C ↔ Am, F#m ↔ A)',
  T.relatief(k('C')) === k('Am') && T.relatief(k('Am')) === k('C') && T.relatief(k('F#m')) === k('A'));
ok('wijzervolgorde: 1A 1B 2A 2B … 12B, alle 24 één keer',
  T.WIJZER.length === 24 && new Set(T.WIJZER).size === 24
  && T.WIJZER.map(T.camelot).join(' ') === [...Array(12).keys()].flatMap((i) => [`${i + 1}A`, `${i + 1}B`]).join(' '));

// ---- wat je hoort (§6) ----------------------------------------------------------
{
  const h = hoorbaar({ toonsoort: 'D', stemming: 0 }, { rate: 1.06 });
  ok(`rate 1,06 = +1 halve toon: Ciel (D, 10B) klinkt als Es, +1 ct (5B) — ${h.camelot} ${h.naam} ${h.cent.toFixed(2)} ct`,
    h.toonsoort === 'Eb' && h.camelot === '5B' && h.verschuiving === 1 && bij(h.cent, 100 * (12 * Math.log2(1.06) - 1)) && Math.round(h.cent) === 1);
  const r = hoorbaar({ toonsoort: 'F', stemming: -34 }, { rate: 1.02 });
  ok(`No Surprises (F, −34 ct) op +2% klinkt als F op 0 cent — ${r.toonsoort} ${r.cent.toFixed(2)} ct`,
    r.toonsoort === 'F' && r.verschuiving === 0 && Math.abs(r.cent) < 1);
  const p = hoorbaar({ toonsoort: 'F', stemming: -34 }, { rate: 1 });
  ok('en zonder pitch: F op −34 cent', p.toonsoort === 'F' && bij(p.cent, -34));
  const s = hoorbaar({ toonsoort: 'C', stemming: 45 }, { rate: 1.01 });
  ok(`stemming telt mee: C op +45 ct op +1% (= +17 ct) klinkt als C♯ op −38 ct — ${s.kort} ${s.cent.toFixed(1)}`,
    s.kort === 'D♭' && s.verschuiving === 1 && bij(s.cent, 45 + 1200 * Math.log2(1.01) - 100));
  const m = hoorbaar({ toonsoort: 'Am', stemming: 0 }, { rate: 0.8909 });
  ok(`omlaag: Am op −11,5% (−2 halve tonen) = Gm, letter blijft (${m.camelot})`, m.toonsoort === 'Gm' && m.verschuiving === -2 && m.camelot === '6A');
  const kl = hoorbaar({ toonsoort: 'G', stemming: 10 }, { rate: 1.3, keylock: true, transpositie: 0 });
  ok('keylock: de pitch telt niet, alleen de stemming', kl.toonsoort === 'G' && kl.verschuiving === 0 && bij(kl.cent, 10));
  const tr = hoorbaar({ toonsoort: 'G', stemming: 0 }, { rate: 1, keylock: true, transpositie: -2.5 });
  ok('transpositie mag een breuk zijn: G − 2,5 halve toon = F op −50 ct (of E op +50)',
    Math.abs(tr.cent) <= 50 && (tr.toonsoort === 'F' || tr.toonsoort === 'E') && bij(Math.abs(tr.cent), 50));
  const nul = hoorbaar({ toonsoort: 'C', stemming: -0.2 }, { rate: 1 });
  ok('geen "−0": een kleine min-stemming geeft verschuiving 0, niet −0', Object.is(nul.verschuiving, 0));
  const half = hoorbaar({ toonsoort: 'C', stemming: 50 });
  ok('precies +50 ct: de volgende op −50 (blijft binnen −50..+50)', half.kort === 'D♭' && bij(half.cent, -50));
  const leeg = hoorbaar({ toonsoort: null, stemming: 0 }, { rate: 1.06 });
  ok('zonder toonsoort: geen naam, wel de verschuiving', leeg.k === null && leeg.camelot === null && leeg.verschuiving === 1);
}

// ---- de kaart ---------------------------------------------------------------------
const FIXTURE = {
  // Het formaat van TOONSOORT.md §3, zoals /api/library het geeft.
  versie: 1, stemming: 2.3,
  stukken: [
    { van: 0, toonsoort: 'G', stemming: 8, zekerheid: 0.87 },
    { van: 215.2, toonsoort: 'Ab', stemming: 8, zekerheid: 0.83 },
  ],
  bron: 'auto', slot: false,
};
{
  const kaart = ToonKaart.van(FIXTURE);
  ok('kaart uit de fixture: twee stukken', kaart && kaart.aantalStukken === 2);
  const a = kaart.stukAt(100), b = kaart.stukAt(300), v = kaart.stukAt(-5);
  ok('stukAt: 100 s = G (0–215,2), 300 s = As', a.toonsoort === 'G' && a.van === 0 && bij(a.tot, 215.2) && b.toonsoort === 'Ab' && b.tot === Infinity);
  ok('stukAt vóór 0 = het eerste stuk', v.index === 0);
  ok('stukAt op de grens hoort bij het nieuwe stuk', kaart.stukAt(215.2).index === 1 && kaart.stukAt(215.19).index === 0);
  ok('toJSON geeft de fixture terug (heen en terug)', JSON.stringify(kaart.toJSON()) === JSON.stringify(FIXTURE));
  const raar = ToonKaart.van({ ...FIXTURE, analyse: { ms: 4 }, stukken: [{ ...FIXTURE.stukken[0], r: 0.91 }] });
  ok('onbekende velden (kaart en stuk) gaan ongeschonden mee terug',
    raar.toJSON().analyse?.ms === 4 && raar.toJSON().stukken[0].r === 0.91);
  ok('van(): null zonder stukken, met onleesbare stukken, of zonder data',
    ToonKaart.van(null) === null && ToonKaart.van({}) === null && ToonKaart.van({ stukken: [{ van: 0, toonsoort: 'X' }] }) === null);
  const volg = new ToonKaart({ stukken: [{ van: 60, toonsoort: 'D' }, { van: 0, toonsoort: 'C' }] });
  ok('stukken worden op `van` gesorteerd', volg.stukken.map((s) => s.toonsoort).join() === 'C,D');
  ok('stemming wordt op −50..+50 geklemd', new ToonKaart({ stukken: [{ van: 0, toonsoort: 'C', stemming: 80 }] }).stukken[0].stemming === 50);

  // hoorbaarBij: de plaat plus de pitch, per stuk.
  const h = kaart.hoorbaarBij(300, { rate: 1.06 });
  ok(`hoorbaarBij: As +8 ct op +6% = A (11B), +9 ct — ${h.camelot} ${h.kort} ${h.cent.toFixed(1)}`,
    h.toonsoort === 'A' && h.camelot === '11B' && Math.round(h.cent) === 9 && h.plaat.k === k('Ab') && h.index === 1 && h.aantal === 2);
}

// ---- zekerheid: onzeker en geen --------------------------------------------------
{
  ok('drempels: zeker vanaf 0,40, geen onder 0,15', T.ZEKER_VANAF === 0.40 && T.GEEN_TOON === 0.15);
  ok('soortZekerheid: 0,87 zeker, 0,31 onzeker, 0,10 geen, zonder = hand = zeker',
    T.soortZekerheid(0.87) === 'zeker' && T.soortZekerheid(0.31) === 'onzeker' && T.soortZekerheid(0.1) === 'geen' && T.soortZekerheid(undefined) === 'zeker');
  ok('op de grens: 0,40 zeker, 0,15 onzeker', T.soortZekerheid(0.40) === 'zeker' && T.soortZekerheid(0.15) === 'onzeker');
  ok('op slot is alles zeker, behalve "geen toonsoort"', T.soortZekerheid(0.05, true) === 'zeker' && T.soortZekerheid(0.9, true, null) === 'geen');
  const kaart = new ToonKaart({ stukken: [
    { van: 0, toonsoort: 'Bbm', stemming: 0, zekerheid: 0.31, tweede: 'Db' },
    { van: 60, toonsoort: 'E', stemming: -32, zekerheid: 0.04, tweede: 'A' },
    { van: 120, toonsoort: null, stemming: 0 },
  ], bron: 'auto' });
  const o = kaart.hoorbaarBij(10), g = kaart.hoorbaarBij(70), n = kaart.hoorbaarBij(130);
  ok('onzeker stuk: soort onzeker, tweede kandidaat mee', o.soort === 'onzeker' && o.tweede === k('Db'));
  ok('onder 0,15: soort geen, maar wel een beste gok', g.soort === 'geen' && g.k === k('E'));
  ok('met de hand "geen toonsoort": geen', n.soort === 'geen' && n.k === null);
  ok('de tweede kandidaat schuift mee met de pitch', kaart.hoorbaarBij(70, { rate: 1.06 }).tweede === k('Bb'));

  // ---- weergave (§5) ----
  const ko = W.kolomToon(o), kg = W.kolomToon(g), kn = W.kolomToon(n);
  ok(`kolomkop onzeker: "${ko.tekst}", gedimd`, ko.tekst === '3A B♭m?' && ko.soort === 'onzeker');
  ok(`kolomkop onder 0,15: "~", tooltip met beste en tweede ("${kg.titel.split('\n')[0]}")`,
    kg.tekst === '~' && kg.soort === 'geen' && kg.titel.includes('geen duidelijke toonsoort (best passend: E, of A)'));
  ok('kolomkop "geen toonsoort" met de hand: "~", en dat zegt de tooltip', kn.tekst === '~' && kn.titel.includes('met de hand'));
  ok('kolomkop zonder kaart: —', W.kolomToon(null).tekst === '—' && W.kolomToon(null).soort === 'leeg');
  const z = new ToonKaart({ stukken: [{ van: 0, toonsoort: 'G', stemming: 3, zekerheid: 0.87 }] });
  ok('kolomkop zeker: "9B G" (T2)', W.kolomToon(z.hoorbaarBij(0)).tekst === '9B G');

  // Focus: groot, met verschuiving en stemming.
  const as = new ToonKaart({ stukken: [{ van: 0, toonsoort: 'G', stemming: 18, zekerheid: 0.8 }] });
  const f = W.focusToon(as.hoorbaarBij(0, { rate: 1.06 }));   // +1 halve toon, 18 + 0,9 = +19 ct: niet tonen
  ok(`focus: "${f.hoofd}" ${f.verschuiving} "${f.cent}" — As majeur, +1, geen cent onder 20`,
    f.hoofd === '4B · As majeur' && f.verschuiving === '+1' && f.cent === '');
  const f2 = W.focusToon(as.hoorbaarBij(0, { rate: 1.07 }));  // 18 + 117,1 = 135 → +1, +35 ct
  ok(`focus: stemming vanaf 20 cent ("${f2.cent}")`, f2.cent === '+35 ct' && f2.verschuiving === '+1');
  const laag = W.focusToon(new ToonKaart({ stukken: [{ van: 0, toonsoort: 'Ab', stemming: -32 }] }).hoorbaarBij(0));
  ok(`focus: echt minteken ("${laag.cent}"), verschuiving leeg bij 0`, laag.cent === '−32 ct' && laag.verschuiving === '');
  const tussen = W.kolomToon(new ToonKaart({ stukken: [{ van: 0, toonsoort: 'C', stemming: 45 }] }).hoorbaarBij(0));
  ok('tooltip tussen twee toonsoorten (±40–50 ct): "tussen C en D♭"', tussen.titel.includes('tussen C en D♭'));
  const plaat = W.focusToon(as.hoorbaarBij(0, { rate: 1.06 }));
  ok('de plaat staat in de tooltip (T3), met hoeveel de pitch verschuift',
    plaat.titel.includes('op de plaat: 9B G majeur') && plaat.titel.includes('1 halve toon hoger'));
  ok('focus onzeker: "?" erachter', W.focusToon(o).hoofd === '3A · Bes mineur?');
  ok('focus onder 0,15: "~" zonder cent', W.focusToon(g).hoofd === '~' && W.focusToon(g).cent === '');

  // Library: de plaat, hoofdtoonsoort + aantal andere.
  ok('library één stuk: "9B G"', W.libraryToon(z.toJSON(), 200).tekst === '9B G');
  const album = { stukken: [
    { van: 0, toonsoort: 'Bbm', stemming: 0, zekerheid: 0.6 },
    { van: 100, toonsoort: 'F', stemming: 0, zekerheid: 0.5 },
    { van: 200, toonsoort: 'Bbm', stemming: 0, zekerheid: 0.7 },
    { van: 400, toonsoort: 'C', stemming: 0, zekerheid: 0.9 },
    { van: 450, toonsoort: 'Eb', stemming: 0, zekerheid: 0.1 },
    { van: 500, toonsoort: 'Dm', stemming: 0, zekerheid: 0.5 },
  ], bron: 'auto' };
  const lib = W.libraryToon(album, 560);
  ok(`library album: hoofdtoonsoort (meeste tijd) + aantal andere: "${lib.tekst}"`, lib.tekst === '3A B♭m +4' && lib.soort === 'zeker');
  ok('library album: tooltip met het aandeel en de stukken', lib.titel.includes('Bes mineur') && lib.titel.includes('6 stukken') && lib.titel.includes('1:40'));
  ok('library toont de PLAAT: stemming en pitch veranderen de naam niet',
    W.libraryToon({ stukken: [{ van: 0, toonsoort: 'F', stemming: -34 }] }).tekst === '7B F');
  ok('library zonder kaart: —', W.libraryToon(null).tekst === '—');
  ok('library alles onder 0,15: "~" met de beste gok in de tooltip',
    W.libraryToon({ stukken: [{ van: 0, toonsoort: 'E', stemming: 0, zekerheid: 0.05 }] }).tekst === '~'
    && W.libraryToon({ stukken: [{ van: 0, toonsoort: 'E', stemming: 0, zekerheid: 0.05 }] }).titel.includes('best passend: E'));
  ok('library op slot: zeker en slot', W.libraryToon({ ...album, slot: true }, 560).slot === true && W.libraryToon({ ...album, slot: true }, 560).soort === 'zeker');
  ok('library "geen toonsoort" met de hand: "~"', W.libraryToon({ stukken: [{ van: 0, toonsoort: null, stemming: 0 }], bron: 'hand' }).tekst === '~');
  ok('de kiezer: 24 knoppen in wijzervolgorde, 1A eerst', W.KIEZER.length === 24 && W.KIEZER[0].camelot === '1A' && W.KIEZER[1].camelot === '1B' && W.KIEZER[1].kort === 'B');
}

// ---- bewerken per stuk (§7) --------------------------------------------------------
{
  const kaart = ToonKaart.van(FIXTURE);
  kaart.kwint(300, 1);
  ok('kwint omhoog in het tweede stuk: As → Es; het eerste blijft G', kaart.stukken[1].toonsoort === 'Eb' && kaart.stukken[0].toonsoort === 'G');
  ok('met de hand = zeker: de zekerheid valt weg', kaart.stukken[1].zekerheid === undefined && kaart.stukAt(300).soort === 'zeker');
  ok('... de rest houdt zijn zekerheid', kaart.stukken[0].zekerheid === 0.87);
  kaart.kwint(300, -1);
  ok('kwint omlaag: terug naar As', kaart.stukken[1].toonsoort === 'Ab');
  kaart.wisselModus(10);
  ok('relatief: G → Em (9B → 9A)', kaart.stukken[0].toonsoort === 'Em' && T.camelot(kaart.stukAt(10).k) === '9A');
  kaart.halveToon(10, 1);
  ok('halve toon omhoog: Em → Fm', kaart.stukken[0].toonsoort === 'Fm');
  kaart.halveToon(10, -1);
  ok('halve toon omlaag: terug naar Em', kaart.stukken[0].toonsoort === 'Em');
  ok('splits: nieuw stuk op 100 s, zelfde toonsoort en stemming', kaart.splits(100) && kaart.aantalStukken === 3
    && kaart.stukken[1].van === 100 && kaart.stukken[1].toonsoort === 'Em' && kaart.stukken[1].stemming === 8);
  ok('splits op een bestaande grens: false', kaart.splits(100) === false && kaart.aantalStukken === 3);
  kaart.geen(150);
  ok('"geen toonsoort" alleen in het stuk rond de positie', kaart.stukken[1].toonsoort === null && kaart.stukken[0].toonsoort === 'Em');
  kaart.kwint(150, 1);
  ok('kwint op "geen toonsoort" doet niets', kaart.stukken[1].toonsoort === null);
  kaart.zetStuk(150, { toonsoort: 'D' });
  ok('zetStuk: toonsoort hier', kaart.stukken[1].toonsoort === 'D');
  kaart.zetStuk(150, { toonsoort: 'X' });
  ok('zetStuk met onzin laat het stuk staan', kaart.stukken[1].toonsoort === 'D');
  const z = ToonKaart.van({ stukken: [{ van: 0, toonsoort: 'C', stemming: 4, zekerheid: 0.2, tweede: 'G' }] });
  z.splits(30);
  ok('splits van een onzeker stuk: beide helften blijven onzeker (er verandert niets)',
    z.stukAt(10).soort === 'onzeker' && z.stukAt(40).soort === 'onzeker' && z.stukAt(40).tweede === k('G'));
  const album = ToonKaart.van({ stemming: -12, stukken: [{ van: 0, toonsoort: 'C', stemming: -10 }, { van: 60, toonsoort: 'D', stemming: 20 }] });
  album.vervangDoorEen('Bbm');
  ok('vervangDoorEen (library-kiezer): één stuk, stemming van het geheel blijft',
    album.aantalStukken === 1 && album.stukken[0].toonsoort === 'Bbm' && album.stukken[0].stemming === -12);
  ok('metHand: kaart van één stuk, bron hand', ToonKaart.metHand('A').bron === 'hand' && ToonKaart.metHand('A').stukken[0].toonsoort === 'A');
}

// ---- het deck: getter, keylock-afspraak en de actions -------------------------------------
// Een echte Engine en een echt Deck op een Web Audio-mock (zelfde vorm als in
// engine.test: onended asynchroon, overlappende curves gooien), en de echte
// action-bus. Zo lopen setRate, bend en invoke door de code die de app draait.
{
  let NOW = 0;
  const overlap = () => Object.assign(new Error('NotSupportedError: overlapt met een lopende setValueCurveAtTime'), { name: 'NotSupportedError' });
  const param = (v = 0) => ({ value: v, _curves: [],
    _check(t) { const tt = t ?? NOW; for (const c of this._curves) if (tt >= c.a && tt < c.b) throw overlap(); },
    setTargetAtTime(x, t) { this._check(t); this.value = x; },
    setValueAtTime(x, t) { this._check(t); this.value = x; },
    linearRampToValueAtTime(x, t) { this._check(t); this.value = x; },
    setValueCurveAtTime(c, t = NOW, d = 0) {
      for (const q of this._curves) if (t < q.b && t + d > q.a) throw overlap();
      this._curves.push({ a: t, b: t + d }); this.value = c[c.length - 1];
    },
    cancelScheduledValues(t = NOW) { this._curves = this._curves.filter((c) => c.a < t); },
    cancelAndHoldAtTime(t = NOW) { this._curves = this._curves.filter((c) => c.a < t).map((c) => ({ a: c.a, b: Math.min(c.b, t) })); },
  });
  const node = (type) => ({ type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0),
    threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
    fftSize: 1024, smoothingTimeConstant: 0, connect(n) { return n; }, disconnect() {}, getByteTimeDomainData(b) { b.fill(128); } });
  const LIVE = new Set();
  globalThis.AudioContext = class {
    constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005; this.destination = node('dest'); }
    get currentTime() { return NOW; }
    createGain() { return node('gain'); }
    createBiquadFilter() { return node('biquad'); }
    createDynamicsCompressor() { return node('comp'); }
    createAnalyser() { return node('analyser'); }
    createDelay() { const n = node('delay'); n.delayTime = param(0); return n; }
    createWaveShaper() { const n = node('shaper'); n.curve = null; n.oversample = 'none'; return n; }
    createChannelMerger() { return node('merger'); }
    createOscillator() { const n = node('osc'); n.type = 'sine'; n.start = () => {}; n.stop = () => {}; return n; }
    createBufferSource() { const s = node('src'); s.playbackRate = param(1); s.loop = false; s.loopStart = 0; s.loopEnd = 0;
      s.start = () => { LIVE.add(s); };
      s.stop = () => { if (!LIVE.has(s)) return; LIVE.delete(s); queueMicrotask(() => s.onended?.()); };
      return s; }
    createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
    resume() { return Promise.resolve(); }
  };

  const { Engine } = await import('../src/engine/engine.js');
  const { bindEngine, invoke, read, list } = await import('../src/control/actions.js');
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const eng = new Engine();
  bindEngine(eng);
  const d = eng.deck('A');
  ok('het deck: keylock uit en transpositie 0 (namen uit CLAUDE.md, voor het keylock-spoor)', d.keylock === false && d.transpositie === 0);
  ok('zonder kaart: toonsoort null, en de actions hebben niets te doen (read null)',
    d.toonsoort === null && read('track.1.key.fifth.up') === null && read('track.1.key.lock') === null && read('track.1.key') === null);

  d.load(eng.ctx.createBuffer(2, 48000 * 400, 48000), 'album');
  const kaart = d.setToonKaart(FIXTURE);
  ok('setToonKaart leest het formaat van de server', kaart instanceof ToonKaart && d.toonKaart.aantalStukken === 2);
  ok('snapshot draagt de toonsoort die je hoort', eng.snapshot().decks.A.toon?.camelot === '9B');
  d.seek(300);
  ok('de getter volgt de positie: 300 s = As (4B)', d.toonsoort.camelot === '4B' && d.toonsoort.verschuiving === 0);
  d.setRate(1.06);
  ok(`met de pitch: +6% = A (11B) — "${W.kolomToon(d.toonsoort).tekst}"`, d.toonsoort.camelot === '11B' && W.kolomToon(d.toonsoort).tekst === '11B A');
  d.bend(1);
  ok('bend (nudge) telt NIET mee: de weergave flikkert niet zolang je duwt', d.toonsoort.camelot === '11B' && Math.abs(d.toonsoort.cent - (8 + 100 * (12 * Math.log2(1.06) - 1))) < 1e-6);
  d.bend(0);
  d.keylock = true;
  ok('keylock (straks): de pitch telt niet meer mee', d.toonsoort.camelot === '4B');
  d.transpositie = -1;
  ok('transpositie telt ook met keylock: As − 1 = G', d.toonsoort.toonsoort === 'G');
  d.keylock = false; d.transpositie = 0;
  d.setRate(1);

  // De actions, op wat je hoort (stilstaand = de positie).
  invoke('track.1.key.fifth.up', true);
  ok('track.1.key.fifth.up: As → Es in het stuk hier, bron wordt hand', d.toonKaart.stukken[1].toonsoort === 'Eb' && d.toonKaart.bron === 'hand');
  ok('... read 1 zolang ingedrukt', read('track.1.key.fifth.up') === 1);
  invoke('track.1.key.fifth.up', false);
  ok('... en 0 na loslaten', read('track.1.key.fifth.up') === 0);
  invoke('track.1.key.fifth.down', true); invoke('track.1.key.fifth.down', false);
  ok('track.1.key.fifth.down: terug naar As', d.toonKaart.stukken[1].toonsoort === 'Ab');
  invoke('track.1.key.mode', true); invoke('track.1.key.mode', false);
  ok('track.1.key.mode: As → Fm (relatief, 4B → 4A)', d.toonKaart.stukken[1].toonsoort === 'Fm');
  invoke('track.1.key.semitone.up', true); invoke('track.1.key.semitone.up', false);
  ok('track.1.key.semitone.up: Fm → F#m', d.toonKaart.stukken[1].toonsoort === 'F#m');
  invoke('track.1.key.semitone.down', true); invoke('track.1.key.semitone.down', false);
  ok('track.1.key.semitone.down: terug naar Fm', d.toonKaart.stukken[1].toonsoort === 'Fm');
  ok('... het eerste stuk bleef G met zijn zekerheid', d.toonKaart.stukken[0].toonsoort === 'G' && d.toonKaart.stukken[0].zekerheid === 0.87);
  const r = read('track.1.key');
  ok(`track.1.key read = plek op de wijzer / 23 (Fm = 4A → ${r?.toFixed(3)})`, Math.abs(r - T.WIJZER.indexOf(k('Fm')) / 23) < 1e-9);
  invoke('track.1.key', T.WIJZER.indexOf(k('D')) / 23);
  ok('track.1.key value zet de toonsoort hier (D = 10B)', d.toonKaart.stukken[1].toonsoort === 'D');
  d.seek(250);
  invoke('track.1.key.split', true); invoke('track.1.key.split', false);
  ok('track.1.key.split: nieuw stuk op 250 s', d.toonKaart.aantalStukken === 3 && d.toonKaart.stukken[2].van === 250);
  ok('... read 0,5 als er meer stukken zijn', read('track.1.key.split') === 0.5);
  invoke('track.1.key.none', true); invoke('track.1.key.none', false);
  ok('track.1.key.none: hier geen toonsoort, "~" op het scherm', d.toonKaart.stukken[2].toonsoort === null && W.kolomToon(d.toonsoort).tekst === '~');
  invoke('track.1.key.lock', true); invoke('track.1.key.lock', false);
  ok('track.1.key.lock: slot aan (read 1)', d.toonKaart.slot === true && read('track.1.key.lock') === 1);
  invoke('track.1.key.lock', true);
  ok('... nog eens: slot eraf', d.toonKaart.slot === false && read('track.1.key.lock') === 0);

  // Een nieuw nummer neemt de kaart van het vorige niet mee.
  d.load(eng.ctx.createBuffer(2, 48000, 48000), 'los');
  ok('laden wist de kaart (zoals het grid)', d.toonKaart === null && d.toonsoort === null);
  invoke('track.1.key', T.WIJZER.indexOf(k('Am')) / 23);
  ok('track.1.key zonder kaart maakt er een, met de hand gezet', d.toonKaart?.stukken[0].toonsoort === 'Am' && d.toonKaart.bron === 'hand');

  // Elke key-action bestaat per track, heeft een uitleg, en regel 2: key is een value.
  const keyActions = list().filter((a) => /^track\.\d+\.key(\.|$)/.test(a.id));
  ok(`${keyActions.length} key-actions: 9 per track × 8 tracks`, keyActions.length === 9 * 8);
  ok('track.N.key is een value (0..1), de rest trigger', keyActions.every((a) => (a.id.endsWith('.key') ? a.type === 'value' : a.type === 'trigger')));
  const kaal = keyActions.filter((a) => { const b = beschrijf(a.id); return b.lang.startsWith('?') || b.kort === a.id; });
  ok('elke key-action heeft een uitleg in apc-beschrijf', kaal.length === 0);
  // T6: geen standaardknoppen op de APC in versie 1.
  const std = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));
  ok('de standaardmapping heeft (nog) geen toonsoortknoppen (T6)', std.rules.every((r) => !/\.key(\.|$)/.test(r.action)));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
