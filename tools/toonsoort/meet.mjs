// Toonsoort meten op Clay's ECHTE library. Alleen lezen: media/<id>/audio.wav
// (via ffmpeg) en media/library.db (readOnly). Schrijft meting.txt hiernaast en
// per nummer een JSON in uit/ (niet in git).
//
//   node tools/toonsoort/meet.mjs            alle nummers
//   node tools/toonsoort/meet.mjs <id> ...   alleen deze
//   --sr 11025 --N 32768 --hop 8192          andere keten (vergelijking); --wissel 1.2 --venster 24: kaart
//                                            (afwijkend = uit/meting-<sr>-<N>-<hop>-w<wissel>-v<venster>.txt)
//
// Bekende toonsoorten (met bron) staan in bekend.json.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import * as T from './toon.mjs';
import { leesPcm, tracks, ROOT, SR, mmss, fmt } from './lees.mjs';
import { VARIANTEN, PROFIELNAMEN, bereid, kortP } from './varianten.mjs';

const args = process.argv.slice(2);
const optie = (naam, std) => { const i = args.indexOf(`--${naam}`); return i >= 0 ? Number(args[i + 1]) : std; };
const sr = optie('sr', SR), N = optie('N', T.STANDAARD.N), hop = optie('hop', T.STANDAARD.hop);
const kaartOpties = { wissel: optie('wissel', 1.2), venster: optie('venster', 24) };
const ids = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const standaardKeten = sr === SR && N === T.STANDAARD.N && hop === T.STANDAARD.hop && kaartOpties.wissel === 1.2 && kaartOpties.venster === 24;
const achtervoegsel = `-${sr}-${N}-${hop}-w${kaartOpties.wissel}-v${kaartOpties.venster}`;

const HIER = new URL('./', import.meta.url);
mkdirSync(new URL('./uit/', HIER), { recursive: true });
const bekend = JSON.parse(readFileSync(new URL('./bekend.json', HIER), 'utf8'));

const hoofd = VARIANTEN.find((v) => v.hoofd);
const KAART_PROFIELEN = ['temperley', 'temperley05', 'edma', 'temperley05+edma'];

const regels = [];
const zeg = (s = '') => { regels.push(s); console.log(s); };
const ms = (t0) => performance.now() - t0;
const naamKort = (k) => (k == null ? 'geen' : `${T.kort(k)} ${T.camelot(k)}`);

zeg(`Toonsoort — meting op Clay's library (tools/toonsoort/meet.mjs), ${new Date().toISOString().slice(0, 10)}`);
zeg(`Machine: ${cpus()[0]?.model ?? '?'}, Node ${process.version}. Library: ${ROOT}/media (alleen lezen).`);
zeg(`Keten: audio.wav -> ffmpeg mono ${sr} Hz -> FFT ${N} (${fmt(N / sr, 2)} s, ${fmt(sr / N, 3)} Hz/bin), hop ${hop} (${fmt(hop / sr, 2)} s)`);
zeg('       -> stemming uit spectrale pieken -> halve tonen (cos²) -> chroma -> profiel (Pearson) -> nul (toonklassen gehusseld).');
zeg(`Hoofdvariant: ${hoofd.naam} (bereik ${hoofd.bereikOpties.fmin}-${hoofd.bereikOpties.fmax} Hz). Zekerheid = toon × beslist (zie toon.mjs).`);
zeg('');

const alle = tracks().filter((t) => !ids.length || ids.includes(t.id));
const samenvatting = {};   // `${variant}/${profiel}` -> { n, goed, camelot, punten, stukken: [...] }
const kaartScore = {};     // profiel[/lopend] -> seconden goed (exact en Camelot-getal) over de bekende stukken
const grensScore = {};     // profiel[/lopend] -> kaartgrenzen raak / echte grenzen gedekt
const alleStukken = [];    // kaartstukken van de ontwerpkandidaat, voor de zekerheidsdrempels
const PER_STUK = ['temperley05', 'temperley', 'edma'];
const HOOFDKAART = 'temperley05/per-stuk';
const tijden = [];

for (const t of alle) {
  const pad = `${ROOT}/${t.audio}`;
  zeg('='.repeat(100));
  zeg(`${t.titel}  —  ${t.uploader || '(eigen bestand)'}  [${t.id}]  ${mmss(t.duur)}`);

  let t0 = performance.now();
  const pcm = await leesPcm(pad, sr);
  const tLees = ms(t0);
  const minuten = pcm.length / sr / 60;

  t0 = performance.now();
  const b = bereid(pcm, sr, { N, hop });
  const tSpectrum = ms(t0);

  // Per variant de chroma, per profiel één toonsoort voor het hele nummer.
  t0 = performance.now();
  const heel = {};
  const chromas = {};
  for (const v of VARIANTEN) {
    const { C } = T.chroma(b.hs[v.hs], v.chroma);
    chromas[v.naam] = C;
    for (const p of PROFIELNAMEN) heel[`${v.naam}/${p}`] = T.toonsoortVan(C, 0, b.frames, b.ok, p);
  }
  const tHeel = ms(t0) / VARIANTEN.length;   // per variant (alle profielen)

  // Kaart voor elk profiel, met de hoofdvariant en met de lopende stemming.
  t0 = performance.now();
  const kaarten = {};
  for (const p of PROFIELNAMEN) kaarten[p] = T.kaart(chromas[hoofd.naam], b.ok, b.frameRate, p, kaartOpties);
  const tKaart = ms(t0) / PROFIELNAMEN.length;
  const lopendeVar = VARIANTEN.find((v) => v.lopend);
  for (const p of PROFIELNAMEN) kaarten[`${p}/lopend`] = T.kaart(chromas[lopendeVar.naam], b.ok, b.frameRate, p, kaartOpties);
  // De kandidaat voor het ontwerp: kaart, daarna per stuk een eigen stemming (tweede doorgang).
  t0 = performance.now();
  for (const p of PER_STUK) kaarten[`${p}/per-stuk`] = T.kaartPerStuk(b.sp, hoofd.bereikOpties, hoofd.chroma, b.ok, p, kaartOpties);
  const tPerStuk = ms(t0) / PER_STUK.length;
  const stemStuk = (s) => (s.stemming != null ? { cent: s.stemming, R: s.stemmingR }
    : T.stemmingVan(b.sp, Math.round(s.van * b.frameRate), Math.round(s.tot * b.frameRate)));

  const perMin = (x) => fmt(x / 1000 / minuten, 3);
  tijden.push({ titel: t.titel, minuten, tLees, tSpectrum, tHeel, tKaart, tPerStuk });
  // Alle kaartstukken van de ontwerpkandidaat, met (waar bekend) of ze kloppen: voor de drempels.
  for (const s of kaarten[HOOFDKAART]) {
    if (s.stil) continue;
    const midden = (s.van + s.tot) / 2;
    const bk = (bekend[t.id]?.stukken || []).find((x) => x.toonsoort && x.van <= midden && midden < x.tot);
    const goedeK = bk ? [bk.toonsoort, ...(bk.ook || [])].map(T.leesSleutel) : [];
    const klopt = bk && (bk.zeker === 'H' || bk.zeker === 'M')
      ? goedeK.some((g) => g != null && T.camelotGetal(g) === T.camelotGetal(s.k)) : null;
    alleStukken.push({ titel: t.titel, id: t.id, ...s, stemming: stemStuk(s), klopt, bekend: bk?.titel });
  }
  zeg(`Stemming: ${fmt(b.sp.stemming, 1)} cent t.o.v. A=440 (A = ${fmt(440 * 2 ** (b.sp.stemming / 1200), 1)} Hz; helderheid R ${fmt(b.sp.stemmingR)})`
    + `  ·  ${b.frames} frames, ${Math.round(100 * b.ok.reduce((a, x) => a + x, 0) / Math.max(1, b.frames))}% niet stil`);
  zeg(`Rekentijd per minuut audio: lezen (ffmpeg) ${perMin(tLees)} s · FFT+stemming ${perMin(tSpectrum)} s · chroma+profielen ${perMin(tHeel)} s`
    + ` · kaart ${perMin(tKaart)} s · kaart per stuk ${perMin(tPerStuk)} s  (totaal ${fmt((tLees + tSpectrum + tPerStuk) / 1000, 1)} s voor ${fmt(minuten, 1)} min)`);
  const hk = T.hoofdToonsoort(kaarten[HOOFDKAART]);
  zeg(`Hoofdtoonsoort (${kortP(HOOFDKAART)}, meeste tijd met zekerheid ≥ 0,10): ${T.naam(hk.k)} (${naamKort(hk.k)}), ${fmt(100 * hk.aandeel, 0)}% van de tijd, zekerheid ${fmt(hk.zekerheid)}`);
  zeg('');
  zeg(`Heel het nummer, variant ${hoofd.naam}:   profiel      toonsoort          zekerheid = toon × beslist   r     marge(ander getal)  2e keus`);
  for (const p of PROFIELNAMEN) {
    const r = heel[`${hoofd.naam}/${p}`];
    zeg(`${''.padEnd(40)}${kortP(p).padEnd(12)} ${`${T.naam(r.k)} (${naamKort(r.k)})`.padEnd(22)} ${fmt(r.zekerheid).padStart(5)} = ${fmt(r.toon)} × ${fmt(r.beslist)}       ${fmt(r.r)}  ${fmt(r.margeAnder).padStart(5)}             ${naamKort(r.k2)}`);
  }
  const andereVar = VARIANTEN.filter((v) => !v.hoofd).map((v) => `${v.naam}: ${PROFIELNAMEN.map((p) => T.kort(heel[`${v.naam}/${p}`].k)).join('/')}`);
  zeg(`Andere varianten (${PROFIELNAMEN.join('/')}): ${andereVar.join('  ·  ')}`);
  zeg('');
  zeg('Kaart: van-tot toonsoort Camelot zekerheid [stemming van dat stuk in cent]');
  for (const p of [...KAART_PROFIELEN, 'temperley05/lopend', ...PER_STUK.map((x) => `${x}/per-stuk`)]) {
    const k = kaarten[p];
    zeg(`Kaart ${kortP(p)} (${k.length} stuk${k.length === 1 ? '' : 'ken'}):`);
    const regel = k.map((s) => `${mmss(s.van)}-${mmss(s.tot)} ${s.stil ? 'stil' : `${naamKort(s.k)} ${fmt(s.zekerheid)} [${fmt(stemStuk(s).cent, 0)}]`}`);
    for (let i = 0; i < regel.length; i += 5) zeg(`   ${regel.slice(i, i + 5).join('  |  ')}`);
  }

  // Bekende toonsoorten: per stuk met bekend antwoord (toonsoort, of een van `ook`).
  const lijst = (bekend[t.id]?.stukken || []).filter((s) => s.toonsoort);
  const evaluatie = [];
  const telt = (s) => s.zeker === 'H' || s.zeker === 'M';
  if (lijst.length) {
    zeg('');
    zeg(`Bekende toonsoorten (${lijst.length}; X = bronnen oneens, telt niet mee); gevonden over PRECIES dat stuk, variant ${hoofd.naam}, per profiel`);
    zeg('(goed / relatief = zelfde Camelot-getal / kwint = buur op de wijzer / parallel / fout), zekerheid; en hoeveel van de tijd de kaart (edma) het goede getal geeft:');
    for (const s of lijst) {
      const goedeK = [s.toonsoort, ...(s.ook || [])].map(T.leesSleutel).filter((k) => k != null);
      const kb = goedeK[0];
      const beste = (k) => goedeK.map((g) => T.oordeel(k, g)).sort((a, c) => c.punten - a.punten)[0];
      const zelfdeGetal = (k) => k != null && goedeK.some((g) => T.camelotGetal(g) === T.camelotGetal(k));
      const van = Math.max(0, Math.floor(s.van * b.frameRate)), tot = Math.min(b.frames, Math.ceil((s.tot ?? t.duur) * b.frameRate));
      const per = {};
      for (const v of VARIANTEN) {
        for (const p of PROFIELNAMEN) {
          const r = T.toonsoortVan(chromas[v.naam], van, tot, b.ok, p);
          const o = beste(r.k);
          per[`${v.naam}/${p}`] = { k: r.k, z: r.zekerheid, o };
          if (telt(s)) {
            const sv = (samenvatting[`${v.naam}/${p}`] = samenvatting[`${v.naam}/${p}`] || { n: 0, goed: 0, camelot: 0, punten: 0, zGoed: [], zFout: [] });
            sv.n++; sv.punten += o.punten;
            if (o.soort === 'goed') sv.goed++;
            if (zelfdeGetal(r.k)) sv.camelot++;
            (zelfdeGetal(r.k) ? sv.zGoed : sv.zFout).push(r.zekerheid);
          }
        }
      }
      // Kaart: aandeel van de tijd dat de kaart de goede toonsoort / het goede Camelot-getal geeft.
      const eind = s.tot ?? t.duur;
      const kaartAandeel = (k) => {
        let exact = 0, getal = 0;
        for (const sk of k) {
          const a = Math.max(sk.van, s.van), e = Math.min(sk.tot, eind);
          if (!(e > a) || sk.k == null) continue;
          if (goedeK.includes(sk.k)) exact += e - a;
          if (zelfdeGetal(sk.k)) getal += e - a;
        }
        return { exact, getal, duur: Math.max(1, eind - s.van) };
      };
      if (telt(s)) {
        for (const [naam, k] of Object.entries(kaarten)) {
          const x = kaartAandeel(k);
          const ks = (kaartScore[naam] = kaartScore[naam] || { exact: 0, getal: 0, duur: 0 });
          ks.exact += x.exact; ks.getal += x.getal; ks.duur += x.duur;
        }
      }
      const aandeel = kaartAandeel(kaarten.edma).getal / Math.max(1, eind - s.van);
      const cel = (p) => { const x = per[`${hoofd.naam}/${p}`]; return `${T.kort(x.k).padEnd(3)} ${x.o.soort.padEnd(8)} ${fmt(x.z)}`; };
      const bk = [s.toonsoort, ...(s.ook || [])].join('/');
      zeg(`  ${mmss(s.van)}-${mmss(s.tot ?? t.duur)} ${s.titel.slice(0, 26).padEnd(26)} ${bk.padEnd(7)} (${s.zeker}) | `
        + `${PROFIELNAMEN.map((p) => `${kortP(p)} ${cel(p)}`).join(' | ')} | kaart ${Math.round(100 * aandeel)}%`);
      evaluatie.push({ ...s, per, kaartAandeel: aandeel });
    }
  }
  // Grenzen: liggen de grenzen van de kaart op de grenzen tussen nummers?
  const grenzen = bekend[t.id]?.grenzen
    || (bekend[t.id]?.stukken?.length > 1 ? bekend[t.id].stukken.slice(1).map((s) => s.van) : null);
  if (grenzen) {
    zeg('');
    zeg(`Grenzen tussen nummers (${grenzen.length}): hoeveel kaartgrenzen liggen binnen 15 s van een echte grens (precisie), en hoeveel echte grenzen krijgen een kaartgrens (dekking; een grens tussen twee nummers in dezelfde toonsoort hoeft geen kaartgrens te zijn)`);
    for (const p of [...KAART_PROFIELEN, 'temperley05/lopend', ...PER_STUK.map((x) => `${x}/per-stuk`)]) {
      const kg = kaarten[p].slice(1).map((s) => s.van);
      const raak = kg.filter((g) => grenzen.some((x) => Math.abs(x - g) <= 15)).length;
      const gedekt = grenzen.filter((x) => kg.some((g) => Math.abs(x - g) <= 15)).length;
      const afw = kg.map((g) => Math.min(...grenzen.map((x) => Math.abs(x - g)))).filter((d) => d <= 15).sort((a, c) => a - c);
      zeg(`   ${kortP(p).padEnd(20)} ${raak}/${kg.length} kaartgrenzen raak · ${gedekt}/${grenzen.length} echte grenzen gedekt · afwijking mediaan ${fmt(afw[afw.length >> 1], 1)} s`);
      const gs = (grensScore[p] = grensScore[p] || { raak: 0, kaart: 0, gedekt: 0, echt: 0 });
      gs.raak += raak; gs.kaart += kg.length; gs.gedekt += gedekt; gs.echt += grenzen.length;
    }
  }
  zeg('');

  writeFileSync(new URL(`./uit/${t.id}${standaardKeten ? '' : achtervoegsel}.json`, HIER), JSON.stringify({
    id: t.id, titel: t.titel, duur: t.duur, sr, N, hop, stemming: b.sp.stemming, stemmingR: b.sp.stemmingR,
    tijden: { tLees, tSpectrum, tHeel, tKaart, minuten },
    heel: Object.fromEntries(Object.entries(heel).map(([s, r]) => [s, { k: r.k, naam: T.naam(r.k), camelot: T.camelot(r.k),
      zekerheid: r.zekerheid, toon: r.toon, beslist: r.beslist, r: r.r, margeAnder: r.margeAnder, chroma: Array.from(r.chroma || []) }])),
    kaarten: Object.fromEntries(Object.entries(kaarten).map(([p, k]) => [p, k.map((s) => ({ ...s, naam: T.naam(s.k), camelot: T.camelot(s.k) }))])),
    evaluatie,
  }, null, 1));
}

// ---- samenvatting ----------------------------------------------------------------
zeg('='.repeat(100));
zeg('SAMENVATTING — stukken met een bekende toonsoort (bron H of M), toonsoort over precies dat stuk');
zeg('variant/profiel               n   goed  goed getal (Camelot)  MIREX-score  zekerheid mediaan goed/relatief | fout');
const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
for (const [s, v] of Object.entries(samenvatting)) {
  const vp = s.slice(0, s.lastIndexOf('/') + 1) + kortP(s.slice(s.lastIndexOf('/') + 1));
  zeg(`${vp.padEnd(36)} ${String(v.n).padStart(3)}  ${String(v.goed).padStart(4)}  ${String(v.camelot).padStart(10)}            ${fmt(v.punten / v.n, 3)}        ${fmt(med(v.zGoed))} | ${fmt(med(v.zFout))}`);
}
zeg('');
zeg('KAART — aandeel van de tijd in de bekende stukken (H/M) waar de kaart klopt (zonder de grenzen te kennen)');
zeg('profiel[/lopende stemming]     exact   goed Camelot-getal');
for (const [s, v] of Object.entries(kaartScore)) {
  zeg(`${kortP(s).padEnd(30)} ${fmt(100 * v.exact / v.duur, 0).padStart(4)}%   ${fmt(100 * v.getal / v.duur, 0).padStart(4)}%`);
}
zeg('');
zeg('GRENZEN — kaartgrenzen binnen 15 s van een echte grens tussen nummers (Sakamoto + ADRIANA)');
for (const [s, v] of Object.entries(grensScore)) {
  zeg(`${kortP(s).padEnd(30)} ${v.raak}/${v.kaart} raak (${fmt(100 * v.raak / Math.max(1, v.kaart), 0)}%) · ${v.gedekt}/${v.echt} echte grenzen gedekt`);
}
zeg('');
zeg('');
zeg(`ZEKERHEID — alle kaartstukken van ${kortP(HOOFDKAART)} (${hoofd.naam}), gesorteerd; klopt = goed Camelot-getal waar de toonsoort bekend is (H/M)`);
zeg('zekerheid  toon  beslist  toonsoort     stemming      duur   klopt  nummer');
for (const s of alleStukken.slice().sort((a, c) => c.zekerheid - a.zekerheid)) {
  zeg(`  ${fmt(s.zekerheid)}     ${fmt(s.toon)}  ${fmt(s.beslist)}    ${naamKort(s.k).padEnd(10)} ${fmt(s.stemming.cent, 0).padStart(4)} ct R ${fmt(s.stemming.R)}  ${mmss(s.tot - s.van).padStart(5)}   ${s.klopt == null ? '  ?  ' : s.klopt ? ' ja  ' : ' NEE '}  ${s.titel.slice(0, 30)} ${mmss(s.van)}${s.bekend ? ` (${s.bekend})` : ''}`);
}
const groep = (a, b) => alleStukken.filter((s) => s.zekerheid >= a && s.zekerheid < b);
zeg('Verdeling (aantal stukken · aandeel van de tijd · waarvan bekend: ja/nee):');
for (const [a, b] of [[0, 0.15], [0.15, 0.4], [0.4, 0.65], [0.65, 1.01]]) {
  const g = groep(a, b);
  const tijd = g.reduce((x, s) => x + s.tot - s.van, 0), totaal = alleStukken.reduce((x, s) => x + s.tot - s.van, 0);
  zeg(`  ${fmt(a)}–${fmt(Math.min(1, b))}: ${String(g.length).padStart(3)} stukken · ${fmt(100 * tijd / totaal, 0).padStart(3)}% van de tijd · bekend ${g.filter((s) => s.klopt === true).length} ja / ${g.filter((s) => s.klopt === false).length} nee`);
}
zeg('');
zeg('Rekentijd per minuut audio (s):   lezen    FFT     chroma+profielen   kaart    kaart per stuk');
for (const x of tijden) {
  const p = (y) => fmt(y / 1000 / x.minuten, 3).padStart(6);
  zeg(`${x.titel.slice(0, 32).padEnd(32)} ${p(x.tLees)}  ${p(x.tSpectrum)}  ${p(x.tHeel)}             ${p(x.tKaart)}   ${p(x.tPerStuk)}   (${fmt(x.minuten, 1)} min)`);
}
writeFileSync(new URL(standaardKeten ? './meting.txt' : `./uit/meting${achtervoegsel}.txt`, HIER), regels.join('\n') + '\n');
