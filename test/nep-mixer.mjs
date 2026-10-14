// Een nep-mixer voor test/paneel-schrijf.test.mjs (geen test zelf): een echte Uitvoerder
// (src/paneel/uitvoer.js) op een nep-bus, in een EIGEN proces zoals de mixer in het echt een andere
// browser is dan de iPad. Luistert op GET /api/paneel/naar-mixer (SSE) en antwoordt met POST
// /api/paneel/antwoord. De test vraagt zijn bus via stdin ({ nr, wat: 'stand' }) en krijgt op
// stdout { nr, status, reads, log, vast }.
import { request, Agent } from 'node:http';
import { Uitvoerder } from '../src/paneel/uitvoer.js';

const poort = Number(process.argv[2]);
const agent = new Agent({ keepAlive: true, maxSockets: 4 });
const reads = { 'track.1.fx.knob.1': 0.2, 'track.1.fx.knob.2.hold': 0, 'record.start': 0, 'track.1.filter': 0.5 };
const types = { 'track.1.fx.knob.1': 'value', 'track.1.fx.knob.2.hold': 'trigger', 'record.start': 'trigger', 'track.1.filter': 'value' };
const log = [];
const w = { naam: 'proef', schermen: { ipad: { soort: 'ipad', mag: ['track.*', 'record.*'] } } };
const toe = new Set(['track.1.fx.knob.1', 'track.1.fx.knob.2.hold', 'record.start']);
const u = new Uitvoerder({
  invoke: (id, v, o) => { log.push([id, v, o?.bron]); reads[id] = types[id] === 'value' ? v : (v ? 1 : 0); },
  read: (id) => reads[id] ?? null,
  metaOf: (id) => (types[id] ? { id, type: types[id] } : null),
  werkruimte: () => w, toegestaan: (s) => (s === 'ipad' ? toe : new Set()),
});
const LOK = `localhost:${poort}`;
const antwoord = (b) => {
  const r = request({ method: 'POST', host: '127.0.0.1', port: poort, path: '/api/paneel/antwoord', agent, headers: { host: LOK, 'content-type': 'application/json' } }, (res) => res.resume());
  r.on('error', () => {});
  r.end(JSON.stringify(b));
};
let status = null;
const r = request({ host: '127.0.0.1', port: poort, path: '/api/paneel/naar-mixer?tab=nep', headers: { host: LOK, accept: 'text/event-stream' } }, (res) => {
  status = res.statusCode;
  res.socket.setNoDelay(true);
  let buf = '';
  res.setEncoding('utf8');
  res.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const blok = buf.slice(0, i); buf = buf.slice(i + 2);
      if (!blok.startsWith('data: ')) continue;
      const b = JSON.parse(blok.slice(6));
      if (b.t === 'invoke') { const x = u.voer(b); antwoord({ n: b.n, ok: x.ok, reden: x.reden, read: x.read }); }
      else if (b.t === 'los') u.laatLos(b.k);
      else if (b.t === 'uit') u.laatAllesLos();
    }
  });
});
r.on('error', () => {});
r.end();
let inBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  inBuf += d; let i;
  while ((i = inBuf.indexOf('\n')) >= 0) {
    const v = JSON.parse(inBuf.slice(0, i)); inBuf = inBuf.slice(i + 1);
    process.stdout.write(`${JSON.stringify({ nr: v.nr, status, reads, log, vast: u.aantalVast })}\n`);
  }
});
process.stdin.on('end', () => process.exit(0));
