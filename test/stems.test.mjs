// Stems (docs/STEMS.md §2) zonder Python: de rij, de splitter met een
// nep-splitter (test/nep-stems.mjs), één opdracht van begin tot eind
// (werkmap, nalopen, verhuizen), annuleren midden in een opdracht (ook een
// splitter die SIGINT negeert), en de routes op een EIGEN server (eigen poort,
// tijdelijke database en media, nep-yt-dlp): witte lijst, de koppeling met de
// ingest, opnieuw binnenhalen wist de stems, een herstart.
// De ECHTE Demucs alleen met VARVE_STEMS_ECHT=1 (traag; ~/.varve/stems-venv
// of VARVE_STEMS_PY moet demucs hebben). alles.mjs slaat dat over.
// Draai met: node test/stems.test.mjs
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const { Library } = await import('../server/library.js');
const ing = await import('../server/ingest.js');
const st = await import('../server/stems.js');
const { maakNepStems, GEWICHTEN, NAMEN } = await import('./nep-stems.mjs');
const { maakNepYtdlp } = await import('./nep-ytdlp.mjs');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));
const leeft = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const ECHT = process.env.VARVE_STEMS_ECHT === '1';

const map = mkdtempSync(join(tmpdir(), 'varve-stems-'));
const log = join(map, 'nep-stems.log');
const regels = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const nepStems = maakNepStems(map);
process.env.NEP_STEMS_LOG = log;

/** Een 16-bit stereo WAV op 48 kHz, links en rechts verschillend (zo zie je een verwisseling). */
async function maakWav(pad, duur = 3, links = 440, rechts = 660) {
  await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', `aevalsrc='0.5*sin(2*PI*${links}*t)|0.4*sin(2*PI*${rechts}*t)+0.1*sin(2*PI*31*t)':s=48000:d=${duur}`,
    '-c:a', 'pcm_s16le', pad]);
}
/** De samples van een WAV met een kop van 44 bytes (wat ffmpeg zonder metadata en de splitters schrijven). */
async function samples(pad) {
  const kop = await st.leesWavKop(pad);
  const b = readFileSync(pad);
  return { kop, x: new Int16Array(b.buffer, b.byteOffset + kop.data, kop.frames * kop.kanalen) };
}
const rms = (x, kanalen, k) => { let s = 0, n = 0; for (let i = k; i < x.length; i += kanalen) { s += x[i] * x[i]; n++; } return Math.sqrt(s / n); };

/** Werk dat de test zelf afmaakt: { werk, klaar(r), gestart, signal, meld } (zoals in wachtrij.test). */
function handWerk() {
  const w = { gestart: false, signal: null, meld: null };
  w.werk = (onVoortgang, signal) => {
    w.gestart = true; w.signal = signal; w.meld = onVoortgang;
    return new Promise((k) => {
      w.klaar = k;
      signal.addEventListener('abort', () => setTimeout(() => k({ ok: false, fout: 'gestopt' }), 20));
    });
  };
  return w;
}

let server = null;
const opruimen = [];
try {
  // ======================================================================
  console.log('de rij: één tegelijk, volgorde, annuleren');
  {
    const q = new st.StemsRij();
    const [a, b, c] = [handWerk(), handWerk(), handWerk()];
    const oa = q.voegToe({ track: 'A', titel: 'a', aantal: 2, werk: a.werk }).opdracht;
    const ob = q.voegToe({ track: 'B', titel: 'b', aantal: 4, werk: b.werk }).opdracht;
    const oc = q.voegToe({ track: 'C', titel: 'c', aantal: 2, werk: c.werk }).opdracht;
    ok('de vorm uit het contract: id, track, titel, aantal, status, voortgang, fout, begon, klaar',
      ['id', 'track', 'titel', 'aantal', 'status', 'voortgang', 'fout', 'begon', 'klaar'].every((k) => k in oa) && oa.track === 'A' && ob.aantal === 4);
    ok('de eerste is meteen bezig (voortgang 0), de rest wacht met een plek', oa.status === 'bezig' && oa.voortgang === 0 && typeof oa.begon === 'number'
      && ob.status === 'wacht' && ob.plek === 1 && oc.plek === 2 && ob.begon === null);
    await wacht(0);
    ok('alleen het werk van de eerste loopt', a.gestart && !b.gestart && !c.gestart);
    const dub = q.voegToe({ track: 'B', aantal: 2, werk: handWerk().werk });
    ok('hetzelfde nummer nog eens: dezelfde opdracht, dubbel (ook met een ander aantal)', dub.dubbel && dub.opdracht === ob && ob.aantal === 4);
    a.meld(0.4); a.meld(0.2); a.meld(7);
    ok('voortgang alleen omhoog en hooguit 1', oa.voortgang === 1);
    a.klaar({ ok: true, stems: { aantal: 2 } });
    await wacht(5);
    ok('klaar: voortgang 1, klaar-tijd, de stems erbij; de volgende begint', oa.status === 'klaar' && oa.voortgang === 1 && oa.klaar >= oa.begon
      && oa.stems?.aantal === 2 && ob.status === 'bezig' && b.gestart && oc.plek === 1);
    const rc = q.annuleer(oc.id);
    ok('een wachtende annuleren: meteen geannuleerd, nooit begonnen', rc.ok && oc.status === 'geannuleerd' && !c.gestart);
    const rb = q.annuleer(ob.id);
    ok('de lopende annuleren: signal af, nog bezig met stoppen: true', rb.ok && b.signal.aborted && ob.status === 'bezig' && ob.stoppen === true);
    b.meld(0.9);
    ok('een late voortgang na annuleren telt niet', ob.voortgang < 0.9);
    const opnieuw = q.voegToe({ track: 'B', aantal: 2, werk: handWerk().werk });
    ok('een opdracht die stopt telt niet als dubbel: er kan een nieuwe achter (na opnieuw binnenhalen)', !opnieuw.dubbel && opnieuw.opdracht.status === 'wacht');
    await wacht(60);
    ok('daarna geannuleerd (geen fout), zonder stoppen', ob.status === 'geannuleerd' && ob.fout === null && !('stoppen' in ob));
    if (opnieuw.opdracht.status === 'bezig') q.annuleer(opnieuw.opdracht.id);
    await q.stil();
    const og = q.voegToe({ track: 'G', aantal: 2, werk: () => { throw new Error('boem'); } }).opdracht;
    const on = q.voegToe({ track: 'N', aantal: 2, werk: async () => ({ ok: false, fout: 'kapot' }) }).opdracht;
    await q.stil();
    ok('werk dat gooit of faalt: status fout met de reden, de rij leeft', og.status === 'fout' && og.fout === 'boem' && on.status === 'fout' && on.fout === 'kapot');
    const f = q.voegFoutToe({ track: 'F', aantal: 2, fout: 'geen Python' });
    ok('voegFoutToe: meteen fout met reden, niet in de rij', f.status === 'fout' && f.fout === 'geen Python' && !q.open);
    ok('lijst: nieuwste eerst', q.lijst()[0] === f);
    ok('vergeten: alleen wat af is', q.vergeet(f.id) && !q.lijst().includes(f) && !q.vergeet('bestaatniet'));
    const qs = new st.StemsRij();
    const [x, y] = [handWerk(), handWerk()];
    const ox = qs.voegToe({ track: 'X', aantal: 2, werk: x.werk }).opdracht;
    const oy = qs.voegToe({ track: 'Y', aantal: 2, werk: y.werk }).opdracht;
    await wacht(0);
    await qs.stop();
    ok('stop() (de server gaat uit): wat wacht vervalt, wat loopt stopt, en dan is hij stil', ox.status === 'geannuleerd' && oy.status === 'geannuleerd' && !y.gestart && !qs.open);
  }

  // ======================================================================
  // Volgorde (5 okt, docs/STEMS.md §6): vooraan wat je vanuit de STEMS-rij vraagt, dan de
  // kortste eerst. Een mix van een uur hield vijf korte nummers drie kwartier vast.
  console.log('\nde rij: vooraan, dan kortste eerst');
  {
    const q = new st.StemsRij();
    const w = {};
    const voeg = (track, duur, extra = {}) => { w[track] = handWerk(); return q.voegToe({ track, aantal: 4, werk: w[track].werk, duur, ...extra }); };
    const oA = voeg('A', 3184).opdracht;                       // de lange mix: begint meteen
    const oB = voeg('B', 300).opdracht, oC = voeg('C', 60).opdracht, oD = voeg('D', null).opdracht, oE = voeg('E', 120).opdracht;
    const volgorde = () => [...q.rij].map((id) => q.opdrachten.get(id).track).join('');
    ok(`kortste eerst, onbekende duur achteraan (${volgorde()}); de duur staat op de opdracht`, volgorde() === 'CEBD'
      && oC.plek === 1 && oE.plek === 2 && oB.plek === 3 && oD.plek === 4 && oC.duur === 60 && oD.duur === null);
    ok('wat al loopt, loopt door (geen gemiste rekentijd)', oA.status === 'bezig');
    const oF = voeg('F', 500, { vooraan: true }).opdracht;
    ok(`vooraan (vanuit de STEMS-rij) gaat voor, ook voor kortere (${volgorde()})`, volgorde() === 'FCEBD' && oF.plek === 1);
    const dub = voeg('B', 300, { vooraan: true });
    ok(`een wachtend nummer nog eens vooraan gevraagd: dezelfde opdracht, nu na F (${volgorde()})`, dub.dubbel && dub.opdracht === oB && volgorde() === 'FBCED');
    ok('naarVoren op iets dat al loopt of niet bestaat: niets', !q.naarVoren(oA.id) && !q.naarVoren('bestaatniet') && volgorde() === 'FBCED');
    await wacht(0);                                            // het werk van A is pas dan echt begonnen
    w.A.klaar({ ok: true, stems: { aantal: 4 } });
    await wacht(5);
    ok('na de lange mix: eerst F, dan de rest op volgorde', oF.status === 'bezig' && oB.plek === 1 && oC.plek === 2 && oE.plek === 3 && oD.plek === 4);
    await q.stop();
  }

  // ======================================================================
  // De rij overleeft een herstart (5 okt): na elke verandering geeft hij door wat er open staat.
  console.log('\nde rij doorgeven (voor na een herstart)');
  {
    const gemeld = [];
    const q = new st.StemsRij({ bijWijziging: (l) => gemeld.push(l.map((x) => `${x.track}${x.aantal}${x.opnieuw ? '!' : ''}${x.vooraan ? '^' : ''}`).join(' ')) });
    const w = {};
    const voeg = (track, duur, extra = {}) => { w[track] = handWerk(); return q.voegToe({ track, aantal: 4, werk: w[track].werk, duur, ...extra }); };
    const oA = voeg('A', 3000).opdracht;
    voeg('B', 300);
    voeg('C', 60, { opnieuw: true });
    ok(`na elke opdracht erbij: wat loopt eerst, dan de rij op volgorde (${gemeld.at(-1)})`, gemeld.at(-1) === 'A4 C4! B4');
    q.voegToe({ track: 'B', aantal: 4, werk: w.B.werk, duur: 300, vooraan: true });
    ok(`vooraan gevraagd: doorgegeven, met vooraan (${gemeld.at(-1)})`, gemeld.at(-1) === 'A4 B4^ C4!');
    const oC = q.zoek('C');
    q.annuleer(oC.id);
    ok(`een wachtende geannuleerd: weg uit wat er open staat (${gemeld.at(-1)})`, gemeld.at(-1) === 'A4 B4^');
    await wacht(0);
    q.annuleer(oA.id);
    ok(`wat loopt wordt gestopt: meteen niet meer open (geen keuze om terug te zetten) (${gemeld.at(-1)})`, gemeld.at(-1) === 'B4^');
    w.A.klaar({ ok: false, fout: 'gestopt' });
    await wacht(5);
    ok(`daarna begint B: nog steeds alleen B (${gemeld.at(-1)})`, gemeld.at(-1) === 'B4^' && q.zoek('B')?.status === 'bezig');
    w.B.klaar({ ok: true, stems: { aantal: 4 } });
    await wacht(5);
    ok('alles af: een lege lijst', gemeld.at(-1) === '' && !q.open);
    const n = gemeld.length;
    const qq = new st.StemsRij({ bijWijziging: () => { throw new Error('schijf vol'); } });
    const hx = handWerk();
    const fouten = [];
    const echt = console.error;
    console.error = (...a) => fouten.push(a.join(' '));
    let gooit = false;
    try { qq.voegToe({ track: 'X', aantal: 2, werk: hx.werk }); } catch (_) { gooit = true; }
    await wacht(0);
    const stil = qq.stop();
    hx.klaar({ ok: false, fout: 'gestopt' });
    await stil;
    console.error = echt;
    ok('een bijWijziging die gooit breekt de rij niet (wel een fout in het log)', !gooit && fouten.some((f) => /schijf vol/.test(f))
      && !qq.open && gemeld.length === n);
  }

  // ======================================================================
  console.log('\nwelk commando, en staat het klaar');
  {
    const c1 = st.stemsCommando({ VARVE_STEMS_CMD: '/x/nep', VARVE_STEMS_PY: '/y/python', VARVE_TESTSERVER: '1' });
    const c2 = st.stemsCommando({ VARVE_STEMS_PY: '/y/python', VARVE_TESTSERVER: '1' });
    const c3 = st.stemsCommando({ VARVE_TESTSERVER: '1', VARVE_MEDIA: '/m' });
    const c4 = st.stemsCommando({});
    const c5 = st.stemsCommando({ VARVE_MEDIA: '/Users/clay/Varve-media' });
    ok('VARVE_STEMS_CMD vervangt het hele commando (geen splits.py erbij)', c1.cmd === '/x/nep' && c1.args.length === 0);
    ok('VARVE_STEMS_PY: die Python met server/stems/splits.py', c2.cmd === '/y/python' && c2.args[0].endsWith('server/stems/splits.py'));
    ok(`een testserver (VARVE_TESTSERVER=1) zonder een van beide: uit, met de reden ("${c3.uit?.slice(0, 50)}…")`, !!c3.uit && /VARVE_STEMS_CMD/.test(c3.uit));
    ok('anders de venv in ~/.varve/stems-venv', c4.cmd === st.STANDAARD_PY && /\.varve\/stems-venv\/bin\/python$/.test(c4.cmd));
    ok('alleen VARVE_MEDIA (media buiten iCloud, VI2) is GEEN testserver: de stems blijven aan', !c5.uit && c5.cmd === st.STANDAARD_PY);
    ok('redenUit: de laatste regel die geen info: is, zonder "fout: "', st.redenUit('Traceback\nfout: ZeroDivisionError: x\ninfo: 1 s\n', 1) === 'ZeroDivisionError: x'
      && st.redenUit('', 3) === 'de splitter gaf code 3');
    ok('tijdslimiet: minstens 30 min, een uur album ruim (4× + 10 min)', st.tijdslimiet(60) === 30 * 60000 && st.tijdslimiet(3600) === (600 + 14400) * 1000);

    const sp = new st.Splitter({ env: { VARVE_STEMS_CMD: nepStems } });
    ok('vóór de controle: nog niets bekend', sp.bekend === null);
    const c = await sp.controleer();
    ok(`de nep staat klaar (${JSON.stringify(c)})`, c.ok === true && c.apparaat === 'nep' && c.commando === nepStems && sp.bekend === c);
    ok('daarna dezelfde uitkomst zonder opnieuw te starten', (await sp.controleer()) === c && regels().filter((r) => r.wat === 'controle').length === 1);
    process.env.NEP_STEMS_ONTBREEKT = 'No module named demucs';
    const sp2 = new st.Splitter({ env: { VARVE_STEMS_CMD: nepStems } });
    const c2b = await sp2.controleer();
    ok(`ontbreekt Demucs: niet klaar, met de reden ("${c2b.reden}")`, c2b.ok === false && /No module named demucs/.test(c2b.reden));
    delete process.env.NEP_STEMS_ONTBREEKT;
    ok('hercontrole pas na 30 s (geen Python per verzoek)', (await sp2.controleer({ hercontrole: true })) === c2b);
    sp2._wanneer -= 31000;
    ok('daarna wel: nu is hij er', (await sp2.controleer({ hercontrole: true })).ok === true);
    const geen = await new st.Splitter({ env: { VARVE_STEMS_PY: join(map, 'bestaat-niet', 'python') } }).controleer();
    ok(`geen Python op dat pad: de reden zegt hoe je de venv maakt ("${geen.reden.slice(0, 60)}…")`, !geen.ok && /venv/.test(geen.reden) && /bestaat-niet/.test(geen.python));
    const test = await new st.Splitter({ env: { VARVE_TESTSERVER: '1', VARVE_MEDIA: map } }).controleer();
    ok('testserver: uit, zonder iets te starten', !test.ok && /testserver/.test(test.reden));
  }

  // ======================================================================
  console.log('\néén opdracht van begin tot eind (nep-splitter, geen server)');
  const media1 = join(map, 'media1');
  mkdirSync(media1, { recursive: true });
  const lib1 = new Library(join(map, 'een.db'));
  const nummer = (lib, media, id) => {
    lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: `titel ${id}`, uploader: 't', duur: 3,
      audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
    return join(media, id, 'audio.wav');
  };
  const bronWav = join(map, 'bron.wav');
  await maakWav(bronWav, 3);
  for (const id of ['een', 'een-traag', 'een-doof-traag', 'een-kapot', 'een-scheef', 'een-vervangen-traag']) {
    mkdirSync(join(media1, id), { recursive: true });
    copyFileSync(bronWav, nummer(lib1, media1, id));
  }
  {
    const sp = new st.Splitter({ env: { VARVE_STEMS_CMD: nepStems } });
    const werkmappen = () => readdirSync(media1).filter((n) => n.startsWith('.bezig-'));
    const doe = (id, aantal, extra = {}) => st.maakStems({ lib: lib1, media: media1, splitter: sp, trackId: id, aantal,
      audio: join(media1, id, 'audio.wav'), ...extra });

    const kopA = await st.leesWavKop(join(media1, 'een', 'audio.wav'));
    ok(`leesWavKop: ${kopA?.kanalen} kanalen, ${kopA?.sr} Hz, ${kopA?.bits} bit, ${kopA?.frames} frames`,
      kopA?.kanalen === 2 && kopA.sr === 48000 && kopA.bits === 16 && kopA.frames === 3 * 48000);
    ok('leesWavKop: null voor iets dat geen WAV is', (await st.leesWavKop(join(map, 'nep-stems'))) === null && (await st.leesWavKop(join(map, 'weg.wav'))) === null);

    const stappen = [];
    const r2 = await doe('een', 2, { onVoortgang: (x) => stappen.push(x) });
    ok(`2 stems: gelukt (${r2.fout ?? JSON.stringify(r2.stems)})`, r2.ok && r2.stems?.aantal === 2 && r2.stems.namen.join() === 'vocals,inst'
      && r2.stems.schaal === 1 && r2.stems.bestand === 'media/een/stems.wav');
    ok(`voortgang uit de splitter (${stappen.map((x) => x.toFixed(2)).join(' ')})`, stappen.length >= 5 && stappen.at(-1) === 1
      && stappen.every((x, i) => i === 0 || x >= stappen[i - 1]));
    const start = regels().find((x) => x.wat === 'start' && x.in.endsWith('/een/audio.wav'));
    ok(`dezelfde argumenten als splits.py: --in --uit (een werkmap .bezig-stems-een-*) --aantal 2`, !!start && start.aantal === 2
      && /\/\.bezig-stems-een-[0-9a-f]{8}$/.test(start.uit));
    ok(`met lage prioriteit (nice ${start?.nice})`, start?.nice >= st.NICE);
    ok('stems.wav en stems.json staan naast audio.wav, de werkmap is weg', existsSync(join(media1, 'een', 'stems.wav'))
      && existsSync(join(media1, 'een', 'stems.json')) && werkmappen().length === 0);
    const json2 = JSON.parse(readFileSync(join(media1, 'een', 'stems.json'), 'utf8'));
    ok('stems.json zoals het contract: versie, model, aantal, namen, schaal, frames, sr, apparaat, rekentijd_s, gemaakt',
      json2.versie === 1 && json2.model === 'nep' && json2.apparaat === 'nep' && json2.sr === 48000 && json2.frames === kopA.frames
      && typeof json2.rekentijd_s === 'number' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(json2.gemaakt));
    const a = await samples(join(media1, 'een', 'audio.wav'));
    const s2 = await samples(join(media1, 'een', 'stems.wav'));
    let gewicht = true, som = true;
    for (let i = 0; i < a.kop.frames; i++) {
      for (let k = 0; k < 2; k++) {
        const o = a.x[2 * i + k], v = s2.x[4 * i + k], r = s2.x[4 * i + 2 + k];
        if (v !== Math.round(o * GEWICHTEN[2].vocals) || Math.abs(r - o * GEWICHTEN[2].inst) > 1) gewicht = false;
        if (v + r !== o) som = false;
      }
    }
    ok('stems.wav: 4 kanalen interleaved, 16-bit, 48 kHz, precies evenveel frames', s2.kop.kanalen === 4 && s2.kop.bits === 16 && s2.kop.sr === 48000
      && s2.kop.frames === a.kop.frames);
    ok('kanaalpaar 0 = vocals (0,75), paar 1 = inst (0,25), links blijft links', gewicht);
    ok('de som van de stems is bit voor bit audio.wav', som);
    ok('de library-rij heeft de stems', JSON.stringify(lib1.track('een').stems) === JSON.stringify(r2.stems));

    const r4 = await doe('een', 4);
    const s4 = await samples(join(media1, 'een', 'stems.wav'));
    const niveaus = NAMEN[4].map((_, k) => rms(s4.x, 8, 2 * k) / rms(a.x, 2, 0));
    ok(`4 stems: de set wordt vervangen (2 -> 4), 8 kanalen, niveaus ${niveaus.map((x) => x.toFixed(3)).join(' ')}`, r4.ok
      && s4.kop.kanalen === 8 && lib1.track('een').stems.aantal === 4
      && NAMEN[4].every((n, k) => Math.abs(niveaus[k] - GEWICHTEN[4][n]) < 0.002));

    const rk = await doe('een-kapot', 2);
    ok(`een splitter die faalt: fout met de laatste regel van stderr ("${rk.fout}")`, !rk.ok && rk.fout === 'nep: deze split gaat expres mis'
      && werkmappen().length === 0 && !existsSync(join(media1, 'een-kapot', 'stems.wav')));
    const rs = await doe('een-scheef', 2);
    ok(`een frame te weinig: geweigerd ("${rs.fout}"), niets verhuisd`, !rs.ok && /niet in de pas/.test(rs.fout)
      && !existsSync(join(media1, 'een-scheef', 'stems.wav')) && lib1.track('een-scheef').stems === null && werkmappen().length === 0);
    const rw = await doe('bestaat-niet', 2);
    ok(`een onbekend nummer: fout ("${rw.fout}")`, !rw.ok && /library/.test(rw.fout));

    // Annuleren midden in een opdracht: SIGINT, de nep ruimt op en stopt.
    const ac = new AbortController();
    const zag = [];
    const p = doe('een-traag', 2, { signal: ac.signal, onVoortgang: (x) => zag.push(x) });
    for (let i = 0; i < 200 && !zag.length; i++) await wacht(20);
    const pid = regels().find((x) => x.wat === 'start' && x.in.includes('een-traag'))?.pid;
    ok('tijdens de split staat er een werkmap', werkmappen().length === 1);
    const t0 = Date.now();
    ac.abort();
    const ra = await p;
    ok(`annuleren midden in: geannuleerd na ${Date.now() - t0} ms`, !ra.ok && ra.afgebroken === true && ra.fout === 'geannuleerd' && Date.now() - t0 < 2500);
    ok('de splitter kreeg SIGINT, ruimde op en is weg; geen werkmap, geen stems', !!pid && !leeft(pid)
      && regels().some((x) => x.wat === 'gestopt' && x.pid === pid) && werkmappen().length === 0 && lib1.track('een-traag').stems === null);

    // Een splitter die SIGINT negeert: na 3 s SIGKILL (zoals de ingest).
    const ac2 = new AbortController();
    const zag2 = [];
    const p2 = doe('een-doof-traag', 2, { signal: ac2.signal, onVoortgang: (x) => zag2.push(x) });
    for (let i = 0; i < 200 && !zag2.length; i++) await wacht(20);
    const pid2 = regels().find((x) => x.wat === 'start' && x.in.includes('een-doof-traag'))?.pid;
    const t2 = Date.now();
    ac2.abort();
    const rd = await p2;
    ok(`negeert hij SIGINT: na ${Date.now() - t2} ms SIGKILL, geannuleerd`, rd.afgebroken === true && Date.now() - t2 >= 2900 && Date.now() - t2 < 6000);
    await wacht(50);
    ok('  en hij is echt weg, geen werkmap', !!pid2 && !leeft(pid2) && regels().some((x) => x.wat === 'doof' && x.pid === pid2) && werkmappen().length === 0);
    if (pid2) opruimen.push(pid2);

    // audio.wav intussen vervangen (opnieuw binnengehaald): deze stems horen bij de oude.
    const zag3 = [];
    const p3 = doe('een-vervangen-traag', 2, { onVoortgang: (x) => zag3.push(x) });
    for (let i = 0; i < 200 && !zag3.length; i++) await wacht(20);
    const nieuw = join(media1, 'een-vervangen-traag', 'nieuw.wav');
    await maakWav(nieuw, 3, 220, 330);
    renameSync(nieuw, join(media1, 'een-vervangen-traag', 'audio.wav'));
    const rv = await p3;
    ok(`audio.wav vervangen tijdens de split: weggegooid ("${rv.fout}")`, !rv.ok && /intussen vervangen/.test(rv.fout)
      && !existsSync(join(media1, 'een-vervangen-traag', 'stems.wav')) && werkmappen().length === 0);
  }

  // ======================================================================
  console.log('\nde routes op een eigen server (nep-splitter, nep-yt-dlp)');
  const media = join(map, 'media');
  const db = join(map, 'server.db');
  mkdirSync(media, { recursive: true });
  const ytLog = join(map, 'nep-ytdlp.log');
  const ytBron = join(map, 'yt-bron.wav');
  await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', "aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*mod(t,0.5))':s=44100:d=6", '-ac', '2', ytBron]);
  const eigen = join(map, 'eigen.wav');
  await maakWav(eigen, 4, 330, 495);
  {
    const lib = new Library(db);
    for (const id of ['nummerA', 'nummer-traag', 'nummerB', 'nummer-kapot', 'nummerW', 'nummer-weg-traag', 'nummer-herstart-traag']) {
      mkdirSync(join(media, id), { recursive: true });
      copyFileSync(bronWav, nummer(lib, media, id));
    }
    lib.bewaarTrack({ id: 'zonderAudio', url: 'https://example.com/zonderAudio', titel: 'z', uploader: 't', duur: 3,
      audio: 'media/zonderAudio/audio.wav', video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
    lib.sluit();
  }
  const poort = 20000 + Math.floor(Math.random() * 20000);
  const B = `http://localhost:${poort}`;
  const startServer = () => spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(poort), VARVE_DB: db, VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_OPNAMES: join(map, 'opnames'),
      VARVE_PLANNEN: join(map, 'plannen'), VARVE_PROEF: join(map, 'proef'), VARVE_HERANALYSE: 'uit',
      VARVE_STEMS_CMD: nepStems, NEP_STEMS_LOG: log, NEP_STEMS_TRAAG_MS: '600',
      VARVE_YTDLP: maakNepYtdlp(map), NEP_LOG: ytLog, NEP_BRON: ytBron, NEP_TRAAG_MS: '40' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const klaarVoorGebruik = async () => {
    for (let i = 0; i < 200; i++) {
      if (await fetch(`${B}/api/stems`).then((r) => r.ok).catch(() => false)) return true;
      await wacht(100);
    }
    return false;
  };
  server = startServer();
  const json = async (pad, init) => { const r = await fetch(B + pad, init); return { status: r.status, j: await r.json().catch(() => null) }; };
  const post = (pad, body, headers = {}) => json(pad, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const weg = (id, headers = {}) => json(`/api/stems/${id}`, { method: 'DELETE', headers });
  const lijst = async () => (await json('/api/stems')).j;
  const opdracht = async (id) => (await lijst()).opdrachten.find((o) => o.id === id);
  const afgelopen = (o) => o && o.status !== 'wacht' && o.status !== 'bezig';
  const wachtOp = async (vind, cond = afgelopen, maxMs = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const o = typeof vind === 'function' ? (await lijst()).opdrachten.find(vind) : await opdracht(vind);
      if (o && cond(o)) return o;
      await wacht(60);
    }
    return null;
  };
  const ingestOpdracht = async (id) => (await json('/api/ingest')).j.opdrachten.find((o) => o.id === id);
  const wachtOpIngest = async (id, maxMs = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const o = await ingestOpdracht(id);
      if (o && o.status !== 'wacht' && o.status !== 'bezig') return o;
      await wacht(80);
    }
    return null;
  };
  const werkmappen = () => readdirSync(media).filter((n) => n.startsWith('.bezig-'));
  const rauw = (pad, { method = 'GET', headers = {}, body = null } = {}) => new Promise((klaar) => {
    const rq = request({ host: '127.0.0.1', port: poort, path: pad, method, headers: { Host: `localhost:${poort}`, ...headers } }, (res) => {
      const d = [];
      res.on('data', (x) => d.push(x));
      res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(d)); } catch {} klaar({ status: res.statusCode, j }); });
    });
    rq.on('error', (e) => klaar({ status: 0, fout: String(e) }));
    rq.end(body);
  });
  const upload = (naam, buf, query = '') => rauw(`/api/upload?naam=${encodeURIComponent(naam)}${query}`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length }, body: buf });

  ok('de server start', await klaarVoorGebruik());
  const g0 = await lijst();
  ok(`GET /api/stems: { opdrachten, server, beschikbaar } (${g0.beschikbaar}, ${g0.server})`, Array.isArray(g0.opdrachten) && g0.opdrachten.length === 0
    && typeof g0.server === 'string' && g0.server.length >= 8 && g0.beschikbaar === true && !('reden' in g0));
  ok('dezelfde run als GET /api/ingest', (await json('/api/ingest')).j.server === g0.server);
  const tooling = (await json('/api/tooling')).j;
  ok(`/api/tooling meldt de splitter (${JSON.stringify(tooling?.stems)})`, tooling?.stems?.ok === true && tooling.stems.commando === nepStems);

  console.log('weigeren');
  ok('aantal 3, "2" of geen: 400', (await post('/api/stems', { track: 'nummerA', aantal: 3 })).status === 400
    && (await post('/api/stems', { track: 'nummerA', aantal: '2' })).status === 400 && (await post('/api/stems', { track: 'nummerA' })).status === 400);
  ok('onbekend nummer, rare id of geen audio op schijf: 404', (await post('/api/stems', { track: 'bestaatniet', aantal: 2 })).status === 404
    && (await post('/api/stems', { track: '../x', aantal: 2 })).status === 404 && (await post('/api/stems', { track: 'zonderAudio', aantal: 2 })).status === 404);
  ok('geen JSON: 415', (await rauw('/api/stems', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"track":"nummerA","aantal":2}' })).status === 415);
  ok('van een andere site: 403 (POST en DELETE)', (await rauw('/api/stems', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: '{"track":"nummerA","aantal":2}' })).status === 403
    && (await rauw('/api/stems/abc', { method: 'DELETE', headers: { Origin: 'http://evil.example' } })).status === 403);
  ok('en er staat niets in de rij', (await lijst()).opdrachten.length === 0);

  console.log('\nsplitsen');
  const pa = await post('/api/stems', { track: 'nummerA', aantal: 2 });
  ok(`POST: 202 met de opdracht (${pa.status}, ${pa.j?.opdracht?.status})`, pa.status === 202 && pa.j.opdracht?.track === 'nummerA'
    && pa.j.opdracht.aantal === 2 && pa.j.opdracht.titel === 'titel nummerA' && ['bezig', 'wacht'].includes(pa.j.opdracht.status));
  const oa = await wachtOp(pa.j.opdracht.id);
  ok(`klaar, voortgang 1, de stems erbij (${oa?.status} ${oa?.fout ?? ''})`, oa?.status === 'klaar' && oa.voortgang === 1 && oa.stems?.aantal === 2
    && typeof oa.begon === 'number' && oa.klaar >= oa.begon);
  const rij = (await json('/api/library/nummerA')).j.track;
  ok(`de library-rij: stems ${JSON.stringify(rij?.stems)}`, JSON.stringify(rij?.stems) === JSON.stringify({ aantal: 2, namen: ['vocals', 'inst'], schaal: 1, bestand: 'media/nummerA/stems.wav' }));
  const inLijst = (await json('/api/library?aantal=50')).j.tracks;
  ok('ook in de lijst; een nummer zonder stems: null', inLijst.find((t) => t.id === 'nummerA')?.stems?.aantal === 2
    && inLijst.find((t) => t.id === 'nummerB')?.stems === null);
  const kop = await fetch(`${B}/${rij.stems.bestand}`, { headers: { Range: 'bytes=0-43' } });
  const kopBuf = Buffer.from(await kop.arrayBuffer());
  ok(`witte lijst: /media/<id>/stems.wav met Range (206, ${kopBuf.readUInt16LE(22)} kanalen)`, kop.status === 206 && kopBuf.readUInt16LE(22) === 4
    && kop.headers.get('content-range') === `bytes 0-43/${44 + 3 * 48000 * 8}`);
  ok('stems.json en de werkmappen niet via de witte lijst', (await fetch(`${B}/media/nummerA/stems.json`)).status === 404
    && (await fetch(`${B}/media/.bezig-stems-x-1/stems.wav`)).status === 404);
  const al = await post('/api/stems', { track: 'nummerA', aantal: 2 });
  ok('nog eens met hetzelfde aantal: 200 al, met de stems', al.status === 200 && al.j.al === true && al.j.stems?.aantal === 2);
  const p4 = await post('/api/stems', { track: 'nummerA', aantal: 4 });
  const o4 = await wachtOp(p4.j?.opdracht?.id);
  const kop4 = Buffer.from(await (await fetch(`${B}/media/nummerA/stems.wav`, { headers: { Range: 'bytes=0-43' } })).arrayBuffer());
  ok('4 stems: 202, klaar, de rij en het bestand vervangen (8 kanalen)', p4.status === 202 && o4?.status === 'klaar'
    && (await json('/api/library/nummerA')).j.track.stems?.aantal === 4 && kop4.readUInt16LE(22) === 8);
  const pn = await post('/api/stems', { track: 'nummerA', aantal: 4, opnieuw: true });
  ok('met opnieuw: toch weer in de rij', pn.status === 202 && pn.j.opdracht.opnieuw === true && (await wachtOp(pn.j.opdracht.id))?.status === 'klaar');

  console.log('\nvolgorde, dubbel, annuleren');
  const pt = await post('/api/stems', { track: 'nummer-traag', aantal: 2 });
  const pb = await post('/api/stems', { track: 'nummerB', aantal: 2 });
  ok('de eerste loopt, de tweede wacht op plek 1', pt.j?.opdracht?.status === 'bezig' && pb.j?.opdracht?.status === 'wacht' && pb.j.opdracht.plek === 1);
  const dub = await post('/api/stems', { track: 'nummerB', aantal: 4 });
  ok('hetzelfde nummer terwijl het wacht: 200 met die opdracht', dub.status === 200 && dub.j.dubbel === true && dub.j.opdracht.id === pb.j.opdracht.id);
  const lopend = await wachtOp(pt.j.opdracht.id, (o) => o.voortgang > 0);
  ok(`voortgang zichtbaar in GET /api/stems (${lopend?.voortgang})`, lopend?.status === 'bezig' && lopend.voortgang > 0 && lopend.voortgang < 1);
  ok('tijdens het splitsen: een werkmap .bezig-stems-nummer-traag-*', werkmappen().some((n) => n.startsWith('.bezig-stems-nummer-traag-')));
  const pidT = regels().find((x) => x.wat === 'start' && x.in.includes('/nummer-traag/'))?.pid;
  const wt = await weg(pt.j.opdracht.id, { Origin: `http://localhost:${poort}` });
  ok(`DELETE op de lopende (vanaf de eigen pagina): ok, hij stopt (${wt.j?.opdracht?.status}, stoppen ${wt.j?.opdracht?.stoppen})`,
    wt.status === 200 && wt.j.ok === true && (wt.j.opdracht.stoppen === true || wt.j.opdracht.status === 'geannuleerd'));
  const ot = await wachtOp(pt.j.opdracht.id, afgelopen, 8000);
  ok(`daarna geannuleerd (${ot?.status}), de splitter weg, geen werkmap, geen stems`, ot?.status === 'geannuleerd' && !!pidT && !leeft(pidT)
    && !werkmappen().some((n) => n.startsWith('.bezig-stems-nummer-traag-')) && (await json('/api/library/nummer-traag')).j.track.stems === null);
  const ob = await wachtOp(pb.j.opdracht.id);
  ok(`en de volgende loopt gewoon (${ob?.status})`, ob?.status === 'klaar' && ob.aantal === 2);
  ok('DELETE op een afgelopen opdracht: uit de lijst', (await weg(ob.id)).j?.weg === true && !(await opdracht(ob.id)));
  ok('DELETE op een onbekende: 404', (await weg('bestaatniet')).status === 404);
  const pk = await post('/api/stems', { track: 'nummer-kapot', aantal: 2 });
  const ok2 = await wachtOp(pk.j?.opdracht?.id);
  ok(`een split die mislukt: status fout met de reden ("${ok2?.fout}")`, ok2?.status === 'fout' && /expres mis/.test(ok2.fout));
  const pw = await post('/api/stems', { track: 'nummer-weg-traag', aantal: 2 });
  await wachtOp(pw.j?.opdracht?.id, (o) => o.voortgang > 0);
  await json('/api/library/nummer-weg-traag', { method: 'DELETE' });
  ok('een nummer weghalen annuleert zijn split', (await wachtOp(pw.j.opdracht.id, afgelopen, 8000))?.status === 'geannuleerd');

  console.log('\nde koppeling met de ingest');
  ok('stems: 3 of "2" bij POST /api/ingest: 400', (await post('/api/ingest', { url: 'http://127.0.0.1:9/x', stems: 3 })).status === 400
    && (await post('/api/ingest', { url: 'http://127.0.0.1:9/x', stems: '2' })).status === 400);
  const i4 = await post('/api/ingest', { url: 'http://127.0.0.1:9/ingest-a', stems: 4 });
  const oi4 = await wachtOpIngest(i4.j?.id);
  ok(`ingest met stems: 4 — klaar (${oi4?.status})`, oi4?.status === 'klaar' && oi4.track?.id === 'generic-ingest-a');
  const si4 = await wachtOp((o) => o.track === 'generic-ingest-a');
  ok(`daarna in de stems-rij met 4, en klaar (${si4?.status}, ${si4?.aantal})`, si4?.status === 'klaar' && si4.aantal === 4
    && (await json('/api/library/generic-ingest-a')).j.track.stems?.aantal === 4);
  const i2 = await post('/api/ingest', { url: 'http://127.0.0.1:9/ingest-b' });
  await wachtOpIngest(i2.j?.id);
  const si2 = await wachtOp((o) => o.track === 'generic-ingest-b');
  ok(`zonder stems: de standaard, 2 (${si2?.aantal})`, si2?.status === 'klaar' && si2.aantal === 2);
  const i0 = await post('/api/ingest', { urls: ['http://127.0.0.1:9/ingest-c'], stems: 0 });
  const oi0 = await wachtOpIngest(i0.j?.resultaten?.[0]?.id);
  await wacht(300);
  ok('stems: 0 (ook in een lijst): niet in de stems-rij', oi0?.status === 'klaar' && !(await lijst()).opdrachten.some((o) => o.track === 'generic-ingest-c'));
  const al2 = await post('/api/ingest', { url: 'http://127.0.0.1:9/ingest-c', stems: 4 });
  await wacht(300);
  ok('al in de library (niets binnengehaald): niet gesplitst', al2.j?.bestond === true && !(await lijst()).opdrachten.some((o) => o.track === 'generic-ingest-c'));

  // De ingest-rij wacht niet op de stems: een trage split loopt nog terwijl de volgende ingest al klaar is.
  const it = await post('/api/ingest', { urls: ['http://127.0.0.1:9/ingest-traag', 'http://127.0.0.1:9/ingest-d'], stems: 2 });
  const [rt, rd] = it.j?.resultaten ?? [];
  await wachtOpIngest(rt?.id);
  const od = await wachtOpIngest(rd?.id);
  const stTraag = (await lijst()).opdrachten.find((o) => o.track === 'generic-ingest-traag');
  ok(`de volgende ingest is klaar terwijl de trage split nog loopt (${od?.status}; stems ${stTraag?.status})`, od?.status === 'klaar' && stTraag?.status === 'bezig');
  await weg(stTraag?.id);
  await wachtOp(stTraag?.id, afgelopen, 8000);

  // Opnieuw binnenhalen terwijl een split van de OUDE audio loopt: die stopt,
  // er komt een nieuwe. `nep-traag` naast audio.wav maakt die oude split lang
  // (50 s), zodat dit niet van de snelheid van de machine afhangt; weg zodra
  // de nieuwe ingest loopt, zodat de nieuwe split gewoon snel is.
  const merk = join(media, 'generic-ingest-b', 'nep-traag');
  writeFileSync(merk, '');
  const oudP = await post('/api/stems', { track: 'generic-ingest-b', aantal: 2, opnieuw: true });
  const oudLoopt = await wachtOp(oudP.j?.opdracht?.id, (o) => o.voortgang > 0);
  const ir = await post('/api/ingest', { url: 'http://127.0.0.1:9/ingest-b', opnieuw: true, stems: 4 });
  rmSync(merk);
  const oir = await wachtOpIngest(ir.j?.id);
  const oud = await wachtOp(oudP.j?.opdracht?.id, afgelopen, 8000);
  ok(`opnieuw binnengehaald tijdens de split: de oude split geannuleerd (${oudLoopt?.status} -> ingest ${oir?.status}, split ${oud?.status})`,
    oudLoopt?.status === 'bezig' && oir?.status === 'klaar' && oud?.status === 'geannuleerd');
  const nieuweSplit = await wachtOp((o) => o.track === 'generic-ingest-b' && o.id !== oudP.j?.opdracht?.id && o.aantal === 4, afgelopen, 30000);
  ok(`  en een nieuwe split van de nieuwe audio, met het gevraagde aantal (${nieuweSplit?.status}, ${nieuweSplit?.aantal})`, nieuweSplit?.status === 'klaar'
    && (await json('/api/library/generic-ingest-b')).j.track.stems?.aantal === 4);

  // Opnieuw binnenhalen wist de stems (rij én bestanden).
  ok('vooraf: generic-ingest-a heeft stems op schijf', existsSync(join(media, 'generic-ingest-a', 'stems.wav')));
  const iw = await post('/api/ingest', { url: 'http://127.0.0.1:9/ingest-a', opnieuw: true, stems: 0 });
  const oiw = await wachtOpIngest(iw.j?.id);
  ok(`opnieuw binnengehaald met stems: 0 — de rij zegt geen stems meer (${JSON.stringify(oiw?.track?.stems)})`, oiw?.status === 'klaar'
    && oiw.track?.stems === null && (await json('/api/library/generic-ingest-a')).j.track.stems === null);
  ok('  en stems.wav en stems.json zijn weg', !existsSync(join(media, 'generic-ingest-a', 'stems.wav')) && !existsSync(join(media, 'generic-ingest-a', 'stems.json')));

  // Een eigen bestand: ?stems=0|2|4.
  ok('upload met ?stems=5 of ?stems=x: 400 zonder te lezen', (await upload('eigen.wav', readFileSync(eigen), '&stems=5')).status === 400
    && (await upload('eigen.wav', readFileSync(eigen), '&stems=x')).status === 400 && werkmappen().filter((n) => n.startsWith('.bezig-upload')).length === 0);
  const up = await upload('eigen.wav', readFileSync(eigen), '&stems=4');
  const oup = await wachtOpIngest(up.j?.id);
  const sup = await wachtOp((o) => o.track === oup?.track?.id);
  ok(`upload met ?stems=4: na de ingest gesplitst in 4 (${sup?.status}, ${sup?.aantal})`, up.status === 202 && sup?.status === 'klaar' && sup.aantal === 4);
  ok('geen werkmap over', werkmappen().length === 0);

  // Herstart: een lopende split wordt eerst gestopt (geen wees), en komt daarna terug in de rij
  // (5 okt: eerst was de rij na een herstart leeg, en ging een uur Demucs-werk verloren).
  console.log('\nserver herstart');
  const ph = await post('/api/stems', { track: 'nummer-herstart-traag', aantal: 2 });
  await wachtOp(ph.j?.opdracht?.id, (o) => o.voortgang > 0);
  const pidH = regels().find((x) => x.wat === 'start' && x.in.includes('/nummer-herstart-traag/'))?.pid;
  mkdirSync(join(media, '.bezig-stems-achtergebleven-12345678'), { recursive: true });
  writeFileSync(join(media, '.bezig-stems-achtergebleven-12345678', '.stems-tmp.f32'), 'x');
  const t0 = Date.now();
  const uit = new Promise((z) => server.once('exit', z));
  server.kill('SIGTERM');
  await uit;
  ok(`SIGTERM met een lopende split: de server stopte hem eerst (${Date.now() - t0} ms), geen wees`, !!pidH && !leeft(pidH)
    && regels().some((x) => x.wat === 'gestopt' && x.pid === pidH));
  if (pidH) opruimen.push(pidH);
  const achtergebleven = werkmappen();
  const bewaard = JSON.parse(readFileSync(join(dirname(db), 'stems-rij.json'), 'utf8'));
  ok('wat open stond staat in stems-rij.json naast de library (het afsluiten wiste het niet)',
    bewaard.opdrachten.map((x) => `${x.track}:${x.aantal}`).join() === 'nummer-herstart-traag:2');
  // Rommel en een nummer dat er niet meer is: overgeslagen.
  writeFileSync(join(dirname(db), 'stems-rij.json'), JSON.stringify({ versie: 1, opdrachten: [...bewaard.opdrachten,
    { track: 'bestaat-niet', aantal: 2 }, { track: '../x', aantal: 2 }, { track: 'nummerB', aantal: 3 }, 'rommel', { track: 'nummerA', aantal: 4 }] }));
  server = startServer();
  ok('de server start opnieuw', await klaarVoorGebruik());
  const na = await lijst();
  const terug = na.opdrachten.find((o) => o.track === 'nummer-herstart-traag');
  ok(`een andere run (${na.server}), en de split is terug in de rij (opnieuw, een nieuwe id)`, na.server !== g0.server && na.beschikbaar === true
    && !!terug && ['wacht', 'bezig'].includes(terug.status) && terug.id !== ph.j?.opdracht?.id);
  ok('… en alleen die: een onbekend nummer, een raar pad, een raar aantal en een nummer dat de stems al heeft niet',
    na.opdrachten.length === 1);
  ok(`achtergebleven werkmappen (.bezig-stems-*) zijn opgeruimd (${achtergebleven.length}); alleen die van de teruggezette split`,
    achtergebleven.length >= 1 && !werkmappen().some((n) => achtergebleven.includes(n))
    && werkmappen().every((n) => n.startsWith('.bezig-stems-nummer-herstart-traag-')));
  ok('de stems in de library zijn er nog', (await json('/api/library/nummerA')).j.track.stems?.aantal === 4);
  await weg(terug?.id);
  await wachtOp(terug?.id, afgelopen, 8000);
  ok('geannuleerd: niet meer in stems-rij.json', JSON.parse(readFileSync(join(dirname(db), 'stems-rij.json'), 'utf8')).opdrachten.length === 0);
  const opnieuw = await post('/api/stems', { track: 'nummer-herstart-traag', aantal: 2 });
  ok('en het nummer kan gewoon opnieuw de rij in', opnieuw.status === 202);
  await weg(opnieuw.j?.opdracht?.id);
  await wachtOp(opnieuw.j?.opdracht?.id, afgelopen, 8000);
  server.kill();
  server = null;
} finally {
  server?.kill('SIGKILL');
  for (const pid of opruimen) { try { process.kill(pid, 'SIGKILL'); } catch {} }
}

// ========================================================================
// De ECHTE Demucs: alleen met VARVE_STEMS_ECHT=1.
if (!ECHT) {
  console.log('\n(echte Demucs overgeslagen: zet VARVE_STEMS_ECHT=1)');
} else {
  console.log('\nde echte Demucs (server/stems/splits.py)');
  const media2 = join(map, 'media-echt');
  mkdirSync(join(media2, 'echt'), { recursive: true });
  mkdirSync(join(media2, 'echt-lang'), { recursive: true });
  const lib2 = new Library(join(map, 'echt.db'));
  const pad = join(media2, 'echt', 'audio.wav');
  // Iets met een melodie, een bas en klappen: 12 s, 48 kHz, 16-bit stereo.
  await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    "aevalsrc='0.25*sin(2*PI*(220+110*floor(mod(t,4)))*t)+0.3*sin(2*PI*55*t)+0.4*exp(-30*mod(t,0.5))*sin(2*PI*1800*t)|0.25*sin(2*PI*(330+110*floor(mod(t,4)))*t)+0.3*sin(2*PI*55*t)+0.4*exp(-30*mod(t,0.5))*sin(2*PI*1800*t)':s=48000:d=12",
    '-c:a', 'pcm_s16le', pad]);
  lib2.bewaarTrack({ id: 'echt', url: 'https://example.com/echt', titel: 'echt', uploader: '', duur: 12, audio: 'media/echt/audio.wav', video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: null });
  const env = process.env.VARVE_STEMS_PY ? { VARVE_STEMS_PY: process.env.VARVE_STEMS_PY } : {};
  const sp = new st.Splitter({ env });
  const c = await sp.controleer();
  ok(`--controle: ${JSON.stringify(c)}`, c.ok === true);
  const t0 = Date.now();
  const stappen = [];
  const r = await st.maakStems({ lib: lib2, media: media2, splitter: sp, trackId: 'echt', aantal: 2, audio: pad, onVoortgang: (x) => stappen.push(x) });
  ok(`2 stems in ${((Date.now() - t0) / 1000).toFixed(1)} s (${r.fout ?? 'gelukt'}), ${stappen.length} voortgangsregels`, r.ok && stappen.at(-1) === 1);
  if (r.ok) {
    const a = await samples(pad);
    const s = await samples(join(media2, 'echt', 'stems.wav'));
    const info = JSON.parse(readFileSync(join(media2, 'echt', 'stems.json'), 'utf8'));
    let e = 0, p = 0;
    for (let i = 0; i < a.kop.frames * 2; i++) {
      const f = Math.floor(i / 2), k = i % 2;
      const som = (s.x[4 * f + k] + s.x[4 * f + 2 + k]) / info.schaal;
      e += (som - a.x[i]) ** 2; p += a.x[i] ** 2;
    }
    const dB = 10 * Math.log10(e / p);
    ok(`frames gelijk (${s.kop.frames}), 4 kanalen, schaal ${info.schaal.toFixed(4)}, model ${info.model} op ${info.apparaat}`,
      s.kop.frames === a.kop.frames && s.kop.kanalen === 4 && info.schaal > 0 && info.schaal <= 1 && info.model === 'htdemucs');
    // De rest van het model gaat naar inst: de som is audio.wav op 16-bit afronding na.
    ok(`som(stems)/schaal tegen het origineel: ${dB.toFixed(1)} dB (< -60: de rest zit in inst)`, dB < -60);
  }
  // Annuleren midden in een echte split: Python stopt op SIGINT binnen de 3 s.
  const lang = join(media2, 'echt-lang', 'audio.wav');
  await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '9', '-i', pad, '-c:a', 'pcm_s16le', lang]);
  lib2.bewaarTrack({ id: 'echt-lang', url: 'https://example.com/echt-lang', titel: 'lang', uploader: '', duur: 120, audio: 'media/echt-lang/audio.wav', video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: null });
  const ac = new AbortController();
  const zag = [];
  const p = st.maakStems({ lib: lib2, media: media2, splitter: sp, trackId: 'echt-lang', aantal: 4, audio: lang, signal: ac.signal, onVoortgang: (x) => zag.push(x) });
  for (let i = 0; i < 600 && !(zag.at(-1) > 0.1); i++) await wacht(50);
  const t1 = Date.now();
  ac.abort();
  const ra = await p;
  ok(`annuleren midden in een echte split (bij ${(zag.at(-1) ?? 0).toFixed(2)}): geannuleerd na ${Date.now() - t1} ms`, ra.afgebroken === true && Date.now() - t1 < 3000);
  ok('  geen werkmap, geen stems', readdirSync(media2).filter((n) => n.startsWith('.bezig-')).length === 0 && !existsSync(join(media2, 'echt-lang', 'stems.wav')));
  lib2.sluit();
}

rmSync(map, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
