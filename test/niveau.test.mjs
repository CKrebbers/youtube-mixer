// Het niveau van de beeldzender (src/koppel/niveau.js): bas, midden, hoog en luid
// op de schaal van wat er nu klinkt. Aanleiding 13 okt: op een luide master stonden
// laag en luid continu op 1,00 en deed het beeld weinig op de maat.
// Puur: nep-mix met dB per beeld, geen browser. Draai met: node test/niveau.test.mjs
const N = await import('../src/koppel/niveau.js');
const F = await import('../src/analysis/features.js');
const { kenmerkenVan } = await import('../src/koppel/beeld.js');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const FPS = 30, BPM = 146, TEL = 60 / BPM;
/** Een luide plaat: op de kick `piek` dB, ertussen `dal` dB; de vaste schaal staat al vol (1). */
const mixOp = (t, { piek = -20, dal = -30, vast = 1 } = {}) => {
  const fase = (t / TEL) % 1;
  const db = fase < 0.15 ? piek : dal;
  return { laag: vast, midden: vast, hoog: vast, rms: vast, db: { laag: db, midden: db - 5, hoog: db - 10, rms: db + 10 } };
};
/** `sec` seconden draaien vanaf t0; geeft per beeld { t, fase, uit } terug. */
const draai = (v, t0, sec, opties) => {
  const r = [];
  for (let i = 0; i < sec * FPS; i++) { const t = t0 + i / FPS; r.push({ t, fase: (t / TEL) % 1, uit: v.stap(t, mixOp(t, opties)) }); }
  return r;
};
const op = (r, k, f) => r.filter((x) => f(x.fase)).map((x) => x.uit[k]);
const max = (xs) => Math.max(...xs), min = (xs) => Math.min(...xs);

console.log('vaste schaal stond vol, het niveau pompt');
{
  const v = new N.NiveauVolger();
  const begin = v.stap(0, mixOp(0));
  ok('eerste beeld (te weinig monsters): de vaste schaal', begin.laag === 1 && begin.luid === 1);
  const r = draai(v, 1 / FPS, 6).slice(3 * FPS);
  for (const k of ['laag', 'midden', 'hoog', 'luid']) {
    const kick = max(op(r, k, (f) => f >= 0.05 && f < 0.15));
    const tussen = min(op(r, k, (f) => f > 0.6 && f < 0.95));
    ok(`${k}: hoog op de kick (${kick.toFixed(2)}), laag ertussen (${tussen.toFixed(2)})`, kick > 0.8 && tussen < 0.3);
  }
  ok('alles 0..1', r.every((x) => Object.values(x.uit).every((w) => w >= 0 && w <= 1)));
}

console.log('hetzelfde nummer 10 dB luider geeft hetzelfde beeld');
{
  const a = draai(new N.NiveauVolger(), 0, 6).slice(4 * FPS);
  const b = draai(new N.NiveauVolger(), 0, 6, { piek: -10, dal: -20 }).slice(4 * FPS);
  ok('laag per beeld gelijk (< 0,01)', a.every((x, i) => Math.abs(x.uit.laag - b[i].uit.laag) < 0.01));
}

console.log('een vlak signaal blaast niet op');
{
  const v = new N.NiveauVolger();
  const r = draai(v, 0, 4, { piek: -25, dal: -25 }).slice(2 * FPS);
  ok(`constant niveau: geen uitslag (max ${max(r.map((x) => x.uit.laag)).toFixed(2)})`, max(r.map((x) => x.uit.laag)) < 0.05);
  const w = new N.NiveauVolger();
  const s = draai(w, 0, 4, { piek: -24, dal: -26 }).slice(2 * FPS);
  ok(`2 dB verschil (< MIN_BEREIK_DB ${N.MIN_BEREIK_DB}): hooguit een derde uitslag`, max(s.map((x) => x.uit.laag)) <= 2 / N.MIN_BEREIK_DB + 0.01);
}

console.log('stilte');
{
  const v = new N.NiveauVolger();
  draai(v, 0, 6);
  const n = v.monsters.laag.length;
  const stil = [];
  for (let i = 0; i < FPS; i++) { const t = 6 + i / FPS; stil.push(v.stap(t, { laag: 0, midden: 0, hoog: 0, rms: 0, db: { laag: -90, midden: -90, hoog: -90, rms: -Infinity } })); }
  ok('stilte zakt naar 0', stil.at(-1).laag < 0.01 && stil.at(-1).luid < 0.01);
  ok('stilte gaat niet in het venster', v.monsters.laag.length <= n);
  // na 20 s stilte is het venster leeg: eerst weer de vaste schaal, dan opnieuw geleerd
  const na = v.stap(30, mixOp(30, { vast: 0.7 }));
  ok('na een lange pauze: eerst de vaste schaal (te weinig monsters)', v.monsters.laag.length === 1 && na.laag > 0);
}

console.log('tijd van buiten');
{
  const v = new N.NiveauVolger();
  draai(v, 0, 2);
  const a = v.stap(5, mixOp(5)), b = v.stap(5, mixOp(5.2));
  ok('twee keer dezelfde t: dezelfde uitkomst, niets veranderd', JSON.stringify(a) === JSON.stringify(b));
  v.stap(1, mixOp(1));
  ok('terug in de tijd: opnieuw beginnen', v.monsters.laag.length === 1);
  ok('zonder db (oude luisteraar of test): null, dus de vaste schaal', v.stap(6, { laag: 0.5, rms: 0.5 }) === null && v.stap(6, null) === null);
}

console.log('de zender');
{
  const mix = { laag: 1, midden: 1, hoog: 1, rms: 1, onset: 0.3 };
  const w = kenmerkenVan(mix, { beat: 3.1 }, { laag: 0.2, midden: 0.4, hoog: 0.6, luid: 0.8 });
  ok('kenmerkenVan met niveau: de vier uit het niveau, de klap uit de mix', w['mix.laag'] === 0.2 && w['mix.midden'] === 0.4
    && w['mix.hoog'] === 0.6 && w['mix.luid'] === 0.8 && w['mix.klap'] === 0.3 && w['maat.klap'] === 1);
  const z = kenmerkenVan(mix, null);
  ok('zonder niveau: zoals voorheen', z['mix.laag'] === 1 && z['mix.luid'] === 1);
}

console.log('features.js: de ruwe dB naast de afgekapte waarden');
{
  const SR = 48000, BINS = 1024;
  const sp = new Float32Array(BINS).fill(-130);
  const bin = Math.round(100 / (SR / (BINS * 2)));
  sp[bin] = -10;   // heel luid: de vaste schaal kapt af
  const db = F.bandenDb(sp, SR);
  const b = F.banden(sp, SR);
  ok(`bandenDb niet afgekapt (laag ${db.laag.toFixed(1)} dB), banden wel (${b.laag})`, b.laag === 1 && db.laag > F.BAND_DB.laag[1]);
  ok('banden met en zonder meegegeven db gelijk', JSON.stringify(F.banden(sp, SR, {}, db)) === JSON.stringify(b));
  const td = new Float32Array(2048).fill(0.5);
  ok('rmsDb: 0,5 = -6 dBFS; rms() blijft 0..1', Math.abs(F.rmsDb(td) - 20 * Math.log10(0.5)) < 1e-9 && F.rms(td) === 1);
  ok('rmsDb bij stilte -Infinity, rms() 0', F.rmsDb(new Float32Array(16)) === -Infinity && F.rms(new Float32Array(16)) === 0);
  const k = new F.Kenmerken();
  const w = k.stap(0, sp, SR, td);
  ok('Kenmerken.waarden.db: laag, midden, hoog, rms', w.db && Number.isFinite(w.db.laag) && w.db.rms === F.rmsDb(td));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
