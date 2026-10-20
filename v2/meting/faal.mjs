/**
 * M7 + M8 — geheugen per track en herstel na verstoringen, in headless Chrome.
 *
 *   node v2/meting/faal.mjs
 *
 * M7  een nummer van 31 minuten laden (zoals het ADRIANA-album in v1): hoeveel geheugen?
 * M8a tabblad op de achtergrond: Chrome knijpt de timers (1×/s, na 5 min 1×/min). Blijft een
 *     gekoppelde track over een grens van zijn tempokaart heen op de klok? Headless verbergt
 *     een tabblad niet echt (Playwright), dus we zetten de planner zelf 65 s stil: het ergste
 *     geval van "1×/min". De motor speelt dan alleen wat al gepland was.
 * M8b een fout in de worklet van de afspeelmotor: komt er binnen 1 s een melding?
 * M8c de AudioContext gepauzeerd (zoals na slaap): zie je het, en komt hij terug?
 * Niet hier: de Scarlett eruit trekken (alleen op de Mac, zie MAC.md).
 */
import { opzet, LAAD_IN_PAGINA, procesGeheugenMB } from './gemeen.mjs';
import { mkdtempSync, mkdirSync, openSync, writeSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// M7 op de echte weg: een v1-library in een tijdelijke map met één nummer van 31 minuten
// (audio.wav, 16-bit stereo 48 kHz, 357 MB), dat de app STREAMT via /api/library/<id>/audio.
const MIN = 31, SRW = 48000, FRAMES = MIN * 60 * SRW;
const media = mkdtempSync(join(tmpdir(), 'varve-m7-'));
{
  mkdirSync(join(media, 'album'));
  const fd = openSync(join(media, 'album', 'audio.wav'), 'w');
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + FRAMES * 4, 4); kop.write('WAVE', 8);
  kop.write('fmt ', 12); kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(2, 22);
  kop.writeUInt32LE(SRW, 24); kop.writeUInt32LE(SRW * 4, 28); kop.writeUInt16LE(4, 32); kop.writeUInt16LE(16, 34);
  kop.write('data', 36); kop.writeUInt32LE(FRAMES * 4, 40);
  writeSync(fd, kop);
  const stuk = Buffer.alloc(SRW * 4 * 10);
  for (let van = 0; van < FRAMES; van += SRW * 10) {
    const n = Math.min(SRW * 10, FRAMES - van);
    for (let i = 0; i < n; i++) { const v = Math.round(0.4 * 32767 * Math.sin(2 * Math.PI * 220 * (van + i) / SRW)); stuk.writeInt16LE(v, 4 * i); stuk.writeInt16LE(v, 4 * i + 2); }
    writeSync(fd, stuk, 0, n * 4);
  }
  closeSync(fd);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(media, 'library.db'));
  db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, titel TEXT, uploader TEXT, duur REAL, audio TEXT, grid_json TEXT, toegevoegd INTEGER)');
  db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?)').run('album', 'album van 31 min', 'proef', MIN * 60, 'media/album/audio.wav', JSON.stringify({ stukken: [{ van: 0, bpm: 120, anker: 0 }], slot: true }), 1);
  db.close();
}

const o = await opzet({ poort: 8803, media });
const r = {};
try {
  await o.page.evaluate(LAAD_IN_PAGINA);
  const geheugen = async () => {
    await o.cdp.send('HeapProfiler.collectGarbage');
    // measureUserAgentSpecificMemory telt ook de ArrayBuffers (de pagina's van een nummer); valt
    // hij weg (headless zonder isolatie), dan de heap plus de backing stores via DevTools.
    const mb = await o.page.evaluate(async () => {
      try { return (await performance.measureUserAgentSpecificMemory()).bytes / 1e6; } catch { return null; }
    });
    if (mb !== null) return mb;
    const h = await o.cdp.send('Runtime.getHeapUsage');
    return (h.usedSize + (h.backingStorageSize ?? 0) + (h.embedderHeapUsedSize ?? 0)) / 1e6;
  };

  // ---- M7 ------------------------------------------------------------------------
  const voor = await geheugen(), voorProces = await procesGeheugenMB();
  const m7 = await o.page.evaluate(async () => {
    const e = window.varve, slaap = (ms) => new Promise((r) => setTimeout(r, ms));
    const { stroomVanWav } = await import('/src/ui/bronnen.js');
    const ok = await e.laad(1, { id: 'album', titel: 'album', duur: 31 * 60, grid: { stukken: [{ van: 0, bpm: 120, anker: 0 }], slot: true }, haal: () => stroomVanWav('/api/library/album/audio') });
    // Spelen, een sprong naar 25 min, nog even spelen: klinkt het (de master-analyser), en wat staat er?
    const an = e.mixer.analyser, buf = new Float32Array(an.fftSize);
    const piek = () => { an.getFloatTimeDomainData(buf); let m = 0; for (const x of buf) m = Math.max(m, Math.abs(x)); return m; };
    e.bus.doe('track.1.play', true);
    await slaap(3000);
    const klonk1 = piek();
    e.bus.doe('track.1.seek', 25 / 31);
    await slaap(3000);
    const klonk2 = piek();
    return { ok, klonk1, klonk2, plek: e.track(1).plek(e.nu()), gestreamdMB: e.track(1).speler.gestreamd / 1e6 };
  });
  await o.page.waitForTimeout(3000);           // LOS: wat niet meer nodig is gaat weg
  const na = await geheugen(), naProces = await procesGeheugenMB();
  const gestreamdMB = await o.page.evaluate(() => window.varve.track(1).speler.gestreamd / 1e6);
  // De JS-heap van de pagina ziet de pagina's niet (die gaan naar de audiothread): het proces wel.
  const extra = naProces - voorProces;
  r.M7 = {
    nummerMinuten: MIN, geladen: m7.ok, extraMB: +extra.toFixed(1), inDeAudiothreadMB: +gestreamdMB.toFixed(1), extraHeapPaginaMB: +(na - voor).toFixed(1),
    verwachtZonderStreamenMB: +(FRAMES * 4 / 1e6).toFixed(0), klinktNaStart: m7.klonk1 > 0.1, klinktNaSprong: m7.klonk2 > 0.1, plekNaSprong: +m7.plek.toFixed(1),
    grens: 50, geslaagd: m7.ok && extra <= 50 && m7.klonk1 > 0.1 && m7.klonk2 > 0.1,
  };
  await o.page.evaluate(() => { window.varve.bus.doe('track.1.play', true); });   // pauze

  // ---- M8a -------------------------------------------------------------------------
  await o.page.evaluate(async () => {
    const e = window.varve;
    await window.__laad(2, { demo: 'demo-124', duur: 600 });
    await window.__laad(3, { demo: 'demo-wissel', duur: 600 });   // 126 → 132 op 60 s
    e.bus.doe('track.2.play', true);
    await new Promise((r) => setTimeout(r, 300));
    e.bus.doe('track.3.seek', 40 / 600);
    e.bus.doe('track.3.play', true);
    e.bus.doe('track.3.sync', true);
    // Tel hoe vaak de engine vooruit plant.
    // De planner 65 s stil (zoals een verborgen tabblad na 5 min: 1×/min).
    window.__tikken = 0;
    window.__tik = e.tik.bind(e);
    e.tik = () => { window.__tikken++; };
  });
  const tweede = await o.browser.newPage();
  await tweede.goto('about:blank');
  await tweede.bringToFront();
  await o.page.waitForTimeout(1000);
  const zicht = await o.page.evaluate(() => document.visibilityState);
  const t0 = Date.now();
  await o.page.waitForTimeout(64000);
  // Gemeten terwijl hij nog verborgen is: wat de motor speelt (de laatst geplande segmenten)
  // tegen waar de track hoort te zijn.
  r.M8a = await o.page.evaluate(() => {
    const e = window.varve, t = e.track(3), nu = e.nu();
    let grootste = 0;
    for (let dt = 0; dt < 2; dt += 0.05) {
      const echt = t.plek(nu + dt), motor = t.speler.positie(nu + dt);
      grootste = Math.max(grootste, Math.abs(echt - motor));
    }
    return { plekNu: t.plek(nu), voorbijGrens: t.plek(nu) > 60, tikkenVerborgen: window.__tikken, grootsteAfwijkingMs: +(grootste * 1000).toFixed(3) };
  });
  r.M8a.zichtbaarheid = zicht;
  r.M8a.secondenZonderPlanner = Math.round((Date.now() - t0) / 1000) + 1;
  r.M8a.geslaagd = r.M8a.grootsteAfwijkingMs <= 1 && r.M8a.voorbijGrens;
  await o.page.evaluate(() => { window.varve.tik = window.__tik; });
  await o.page.bringToFront();
  await tweede.close();

  // ---- M8b -------------------------------------------------------------------------
  r.M8b = await o.page.evaluate(async () => {
    const e = window.varve;
    const t0 = performance.now();
    const melding = new Promise((res) => e.on('melding', (m) => { if (/afspeelmotor/.test(m.tekst)) res(performance.now() - t0); }));
    // Een plan dat de worklet niet kan lezen: zo'n bericht kan in de praktijk alleen door een fout komen.
    e.track(2).speler.node.port.postMessage({ type: 'plan', segmenten: [{ T: 'x' }] });
    const ms = await Promise.race([melding, new Promise((r) => setTimeout(() => r(null), 2000))]);
    return { meldingNaMs: ms === null ? null : Math.round(ms), geslaagd: ms !== null && ms <= 1000 };
  });

  // ---- M8c -------------------------------------------------------------------------
  r.M8c = await o.page.evaluate(async () => {
    const e = window.varve;
    const meldingen = [];
    e.on('melding', (m) => meldingen.push(m.tekst));
    await e.ctx.suspend();
    await new Promise((r) => setTimeout(r, 500));
    const knop = document.querySelector('#start');
    const zichtbaar = !knop.hidden;
    const engineMeldt = meldingen.some((m) => /audio|geluid|stil/i.test(m));
    // Een handeling (zoals een druk op de APC): komt het geluid vanzelf terug?
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const naHandeling = e.ctx.state;
    knop.click();
    await new Promise((r) => setTimeout(r, 500));
    return { knopGeluidAanZichtbaar: zichtbaar, meldingVanDeEngine: engineMeldt, naEenHandeling: naHandeling, naDeKnop: e.ctx.state,
      geslaagd: zichtbaar && engineMeldt && naHandeling === 'running' };
  });
} finally { await o.sluit(); rmSync(media, { recursive: true, force: true }); }
r.fouten = o.fouten.filter((f) => !/afspeelmotor|varve-speler|fout/i.test(f)).slice(0, 10);
console.log(JSON.stringify(r, null, 2));
