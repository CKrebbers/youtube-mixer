// Een kleine WebSocket-server (RFC 6455), alleen Node-ingebouwd (docs/BUS.md).
// Alleen wat de hub nodig heeft: tekstberichten (ook in stukken), ping/pong en
// netjes sluiten. Binair sluit met 1003, te groot met 1009, kapot met 1002,
// geen geldige UTF-8 met 1007.
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const MAX_BERICHT = 1 << 20;   // 1 MB is ruim: een stand is ~250 bytes
export const VOL = 256 * 1024;        // zoveel in de wachtrij: vervangbare berichten vallen weg
export const DOOD = 1 << 20;          // zoveel in de wachtrij: de andere kant leest niet meer
const PING_MS = 5000, STIL_MS = 15000;
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** De Sec-WebSocket-Accept bij een Sec-WebSocket-Key. */
export function acceptSleutel(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

/** Eén frame. Van server naar client is nooit gemaskeerd; `masker` is voor de tests. */
export function maakFrame(opcode, data = Buffer.alloc(0), { fin = true, masker = null } = {}) {
  const len = data.length;
  let kop;
  if (len < 126) { kop = Buffer.alloc(2); kop[1] = len; }
  else if (len < 65536) { kop = Buffer.alloc(4); kop[1] = 126; kop.writeUInt16BE(len, 2); }
  else { kop = Buffer.alloc(10); kop[1] = 127; kop.writeBigUInt64BE(BigInt(len), 2); }
  kop[0] = (fin ? 0x80 : 0) | opcode;
  if (!masker) return Buffer.concat([kop, data]);
  kop[1] |= 0x80;
  const d = Buffer.from(data);
  for (let i = 0; i < d.length; i++) d[i] ^= masker[i & 3];
  return Buffer.concat([kop, Buffer.from(masker), d]);
}

/**
 * Frames uit een bytestroom. Geeft een functie die een stuk bytes eet en de
 * frames teruggeeft die nu compleet zijn ({ fin, opcode, data }), of als
 * laatste { fout: code } als de verbinding dicht moet.
 */
export function maakLezer({ max = MAX_BERICHT, eisMasker = true } = {}) {
  let buf = Buffer.alloc(0);
  return function eet(stuk) {
    buf = buf.length ? Buffer.concat([buf, stuk]) : stuk;
    const frames = [];
    while (buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1];
      const opcode = b0 & 0x0f, fin = (b0 & 0x80) !== 0, gemaskeerd = (b1 & 0x80) !== 0;
      if (b0 & 0x70) { frames.push({ fout: 1002 }); break; }            // geen extensies afgesproken
      if (eisMasker && !gemaskeerd) { frames.push({ fout: 1002 }); break; }
      let len = b1 & 0x7f, pos = 2;
      if (opcode >= 0x8 && (!fin || len > 125)) { frames.push({ fout: 1002 }); break; }   // stuurframes: heel en klein
      if (len === 126) {
        if (buf.length < 4) break;
        len = buf.readUInt16BE(2); pos = 4;
      } else if (len === 127) {
        if (buf.length < 10) break;
        const l = buf.readBigUInt64BE(2);
        if (l > BigInt(max)) { frames.push({ fout: 1009 }); break; }
        len = Number(l); pos = 10;
      }
      if (len > max) { frames.push({ fout: 1009 }); break; }
      const begin = pos + (gemaskeerd ? 4 : 0);
      if (buf.length < begin + len) break;
      const data = Buffer.from(buf.subarray(begin, begin + len));
      if (gemaskeerd) for (let i = 0; i < data.length; i++) data[i] ^= buf[pos + (i & 3)];
      frames.push({ fin, opcode, data });
      buf = buf.subarray(begin + len);
    }
    return frames;
  };
}

/**
 * Hangt WebSocket-verbindingen aan een http-server.
 * @param {import('node:http').Server} server
 * @param {object} o
 * @param {(req: import('node:http').IncomingMessage) => any} o.magBinnen  Host- en Origin-check; iets dat niet waar is = 403
 * @param {(v: Verbinding, req: import('node:http').IncomingMessage, toegang: any) => void} o.bijVerbinding
 */
export function koppelWebSocket(server, { magBinnen, bijVerbinding, max = MAX_BERICHT }) {
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    const key = req.headers['sec-websocket-key'];
    const goed = req.method === 'GET'
      && /\bwebsocket\b/i.test(req.headers.upgrade || '')
      && req.headers['sec-websocket-version'] === '13'
      && typeof key === 'string' && Buffer.from(key, 'base64').length === 16;
    if (!goed) return weiger(socket, 400, 'Bad Request');
    const toegang = magBinnen(req);
    if (!toegang) return weiger(socket, 403, 'Forbidden');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${acceptSleutel(key)}\r\n\r\n`);
    socket.setNoDelay(true);
    if (head?.length) socket.unshift(head);
    bijVerbinding(maakVerbinding(socket, { max }), req, toegang);
  });
}

function weiger(socket, code, tekst) {
  socket.end(`HTTP/1.1 ${code} ${tekst}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * @typedef {object} Verbinding
 * @property {(tekst: string, vervangbaar?: boolean) => void} stuur
 *   vervangbaar: een stand die door de volgende wordt ingehaald; valt weg als de andere kant achterloopt
 * @property {(code?: number) => void} sluit
 * @property {(naam: 'bericht'|'dicht', f: Function) => Verbinding} on
 */
export function maakVerbinding(socket, { max = MAX_BERICHT, pingMs = PING_MS, stilMs = STIL_MS, nu = Date.now } = {}) {
  const lezer = maakLezer({ max });
  const bij = { bericht: [], dicht: [] };
  let delen = null, grootte = 0, dicht = false, gemeld = false, leeft = nu();
  const meldDicht = (code) => {
    if (gemeld) return;
    gemeld = true; dicht = true;
    clearInterval(hartslag);
    for (const f of bij.dicht) f(code);
  };
  /** @type {Verbinding} */
  const v = {
    stuur(tekst, vervangbaar = false) {
      if (dicht || !socket.writable) return;
      const achter = socket.writableLength ?? 0;
      if (achter > DOOD) return v.sluit(1013);                         // leest niet meer: weg ermee
      if (vervangbaar && achter > VOL) return;                          // de volgende stand komt zo
      socket.write(maakFrame(0x1, Buffer.from(tekst, 'utf8')));
    },
    sluit(code = 1000) {
      if (dicht) return;
      dicht = true;
      meldDicht(code);                                                  // eerst melden: destroy() kan meteen 'close' geven
      const d = Buffer.alloc(2); d.writeUInt16BE(code);
      if (socket.writable && (socket.writableLength ?? 0) <= DOOD) socket.end(maakFrame(0x8, d)); else socket.destroy();
    },
    on(naam, f) { bij[naam].push(f); return v; },
  };
  // Hartslag: een ping elke 5 s; wie 15 s niets laat horen, is weg (de browser antwoordt zelf, ook in een verborgen tabblad).
  const hartslag = setInterval(() => {
    if (nu() - leeft > stilMs) { socket.destroy(); meldDicht(1006); return; }
    if (!dicht && socket.writable) socket.write(maakFrame(0x9));
  }, pingMs);
  hartslag.unref?.();
  socket.on('data', (stuk) => {
    if (dicht) return;
    leeft = nu();
    for (const f of lezer(stuk)) {
      if (f.fout) return v.sluit(f.fout);
      if (f.opcode === 0x1 || f.opcode === 0x0) {
        if (f.opcode === 0x1) { if (delen) return v.sluit(1002); delen = []; grootte = 0; }
        else if (!delen) return v.sluit(1002);                         // vervolg zonder begin
        delen.push(f.data); grootte += f.data.length;
        if (grootte > max) return v.sluit(1009);
        if (f.fin) {
          let tekst;
          try { tekst = utf8.decode(Buffer.concat(delen)); } catch (_) { return v.sluit(1007); }
          delen = null;
          for (const g of bij.bericht) g(tekst);
        }
      } else if (f.opcode === 0x2) return v.sluit(1003);               // binair: niet afgesproken
      else if (f.opcode === 0x8) return v.sluit(1000);
      else if (f.opcode === 0x9) { if (socket.writable) socket.write(maakFrame(0xA, f.data)); }
      else if (f.opcode !== 0xA) return v.sluit(1002);
    }
  });
  // De http-server staat half-open toe: zonder dit blijft een socket hangen
  // als de andere kant zonder sluitframe weggaat.
  socket.on('end', () => { socket.end(); meldDicht(1006); });
  socket.on('close', () => meldDicht(1006));
  return v;
}
