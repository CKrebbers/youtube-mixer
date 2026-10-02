// De mixer op de koppelbus (src/bus/zender.js): wat er de deur uit gaat, wat
// er binnenkomt, en dat de drie regels heel blijven. Met een nep-WebSocket.
// Draai met: node test/bus-zender.test.mjs
const { maakStand, maakBeeld, startBusZender, HALLO } = await import('../src/bus/zender.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('berichten maken (puur)');
{
  const s = maakStand({ maat: 'A', bpm: 124.004, tel: 3, fase: 1.4, ctx: 12.34567, energie: { rms: 0.5, laag: 2, midden: -1 } }, 5);
  ok('stand: velden uit BUS.md', s.baan === 'muziek' && s.type === 'stand' && s.van === 'varve' && s.t === 5 && s.maat === 'A');
  ok('stand: bpm afgerond, fase begrensd, ctx in ms', s.bpm === 124 && s.fase === 1 && s.ctx === 12.346);
  ok('stand: energie 0..1, ontbrekend wordt 0', s.energie.laag === 1 && s.energie.midden === 0 && s.energie.hoog === 0 && s.energie.rms === 0.5);
  const leeg = maakStand({});
  ok('stand zonder muziek: null in plaats van onzin', leeg.maat === null && leeg.bpm === null && leeg.tel === null && leeg.fase === null && leeg.energie === null && !('ctx' in leeg));
  ok('tel buiten 1..16 telt niet', maakStand({ tel: 0 }).tel === null && maakStand({ tel: 2.5 }).tel === null);

  const b = maakBeeld({ lagen: [{ aan: 1, systeem: 7, dekking: 0.8, knoppen: [0.1, 2] }], video: { mode: 'licht', fx: { rgb: 0.3, onbekend: 1 } } });
  ok('beeld: laag met nummer, 6 knoppen 0..1', b.lagen[0].nr === 1 && b.lagen[0].aan === true && b.lagen[0].systeem === '7'
    && b.lagen[0].knoppen.length === 6 && b.lagen[0].knoppen[1] === 1 && b.lagen[0].knoppen[5] === 0);
  ok('beeld: alleen de bekende fx', b.video.mode === 'licht' && b.video.fx.rgb === 0.3 && !('onbekend' in b.video.fx) && b.video.fx.korrel === 0);
  ok('geen beeld: null', maakBeeld(null) === null);
}

/** Nep-WebSocket: onthoudt wat er gestuurd wordt; `binnen()` speelt de hub. */
function nepWs() {
  const alle = [];
  class Nep {
    constructor(url) { this.url = url; this.readyState = 0; this.uit = []; alle.push(this); }
    send(t) { if (this.readyState !== 1) throw new Error('dicht'); this.uit.push(JSON.parse(t)); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen?.(); }
    binnen(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
  }
  return { Nep, alle };
}

/** Nep-action-bus: bijInvoke vuurt vóór de actie, zoals actions.js. */
function nepActions() {
  const bij = [], gedaan = [];
  return {
    gedaan,
    bijInvoke: (f) => bij.push(f),
    invoke(id, w) { for (const f of bij) f(id, w); gedaan.push([id, w]); return true; },
  };
}

console.log('\nde zender');
{
  const { Nep, alle } = nepWs();
  const actions = nepActions();
  let stand = { maat: 'A', bpm: 124, tel: 1, fase: 0, decks: [{ id: 'A', nummer: { id: 'x1', titel: 'Een' }, toon: { camelot: '8B', naam: 'G', zekerheid: 0.91 } }],
                beeld: { lagen: [{ aan: true, systeem: 'golf', knoppen: [0.5] }], video: { mode: 'mix', fx: {} } } };
  let eerste = true, apcEigenaar = 'nog niets';
  const z = startBusZender({ lees: () => stand, isEerste: () => eerste, actions, bijApc: (a) => (apcEigenaar = a),
                             WebSocketImpl: Nep, interval: 1e6, opnieuw: 5, nu: () => 42 });
  const ws = alle[0];
  ok('verbindt met de hub op :8778', ws.url === 'ws://127.0.0.1:8778');
  z.tik();
  ok('niet open: niets gestuurd', ws.uit.length === 0);
  ws.open();
  ok('eerst hallo, met de banen uit BUS.md', ws.uit[0]?.type === 'hallo' && ws.uit[0].app === 'varve' && ws.uit[0].stuurt.join() === HALLO.stuurt.join());

  ws.uit.length = 0;
  z.tik();
  const types = ws.uit.map((m) => `${m.baan}.${m.type}`);
  ok('eerste tik: stand, tel, nummer, toon en beeld', ['muziek.stand', 'muziek.tel', 'muziek.nummer', 'muziek.toon', 'beeld.lagen'].every((t) => types.includes(t)));
  ok('toon met camelot en zekerheid', ws.uit.find((m) => m.type === 'toon')?.camelot === '8B' && ws.uit.find((m) => m.type === 'toon').zekerheid === 0.91);

  ws.uit.length = 0;
  stand = { ...stand, fase: 0.3 };
  z.tik();
  ok('niets veranderd behalve fase: alleen de stand', ws.uit.length === 1 && ws.uit[0].type === 'stand' && ws.uit[0].fase === 0.3);

  ws.uit.length = 0;
  stand = { ...stand, tel: 2, decks: [{ ...stand.decks[0], toon: { camelot: '9B', naam: 'D' } }] };
  z.tik();
  ok('nieuwe tel en nieuwe toon: elk één bericht', ws.uit.filter((m) => m.type === 'tel').length === 1 && ws.uit.find((m) => m.type === 'toon')?.camelot === '9B');

  ws.uit.length = 0;
  actions.invoke('track.1.fader', 0.2);
  actions.invoke('track.1.fader', 0.7);
  actions.invoke('track.1.play', true);
  ok('trigger meteen de bus op', ws.uit.length === 1 && ws.uit[0].id === 'track.1.play' && ws.uit[0].waarde === true);
  z.tik();
  const faders = ws.uit.filter((m) => m.id === 'track.1.fader');
  ok('value-actie één keer per tik, met de laatste waarde', faders.length === 1 && faders[0].waarde === 0.7);

  ws.uit.length = 0;
  actions.invoke('track.4.fader', 0.3);
  ws.binnen({ baan: 'acties', id: 'track.4.fader', waarde: 0.8, van: 'td' });
  z.tik();
  ok('een oudere eigen waarde overschrijft de bus niet', !ws.uit.some((m) => m.id === 'track.4.fader'));

  const echteLees = stand;
  stand = undefined;
  ws.uit.length = 0;
  actions.invoke('track.5.fader', 0.6);
  z.tik();
  ok('lees() leeg of kapot: wachtende acties gaan toch weg', ws.uit.some((m) => m.id === 'track.5.fader'));
  stand = echteLees;

  ws.uit.length = 0;
  ws.binnen({ baan: 'acties', id: 'track.2.fader', waarde: 0.4, van: 'td' });
  ok('actie van de bus: invoke op de action-bus', actions.gedaan.at(-1)?.[0] === 'track.2.fader' && actions.gedaan.at(-1)[1] === 0.4);
  z.tik();
  ok('en geen echo terug de bus op', !ws.uit.some((m) => m.id === 'track.2.fader'));
  const voor = actions.gedaan.length;
  ws.binnen({ baan: 'acties', id: 'track.2.fader', waarde: 3 });
  ws.binnen({ baan: 'acties', id: 'track.2.fader', waarde: 'hard' });
  ok('regel 2: waarde buiten 0..1 of geen boolean: niets', actions.gedaan.length === voor);

  ws.binnen({ baan: 'apc', type: 'eigenaar', app: 'av-kern' });
  ok('de hub meldt wie de APC heeft', apcEigenaar === 'av-kern');
  ws.uit.length = 0;
  z.vraagApc();
  ok('vraagApc stuurt een vraag', ws.uit[0]?.baan === 'apc' && ws.uit[0].type === 'vraag');

  eerste = false;
  ws.uit.length = 0;
  z.tik();
  actions.invoke('track.1.play', true);
  ws.binnen({ baan: 'acties', id: 'track.3.play', waarde: true });
  ok('tweede tabblad: stuurt niets en doet niets', ws.uit.length === 0 && actions.gedaan.at(-1)?.[0] !== 'track.3.play');
  eerste = true;

  ws.close();
  ok('verbinding weg: opnieuw proberen', await (async () => { for (let i = 0; i < 100 && alle.length < 2; i++) await wacht(5); return alle.length === 2; })());
  const ws2 = alle[1];
  ws2.open();
  ws2.uit.length = 0;
  z.tik();
  ok('na opnieuw verbinden komt alles één keer opnieuw', ws2.uit.some((m) => m.type === 'toon') && ws2.uit.some((m) => m.type === 'lagen'));

  stand = null;
  ws2.uit.length = 0;
  z.tik();
  ok('lees() geeft niets: alleen een lege stand', ws2.uit.length === 1 && ws2.uit[0].bpm === null);
  z.stop();
  ok('stop: geen nieuwe pogingen meer', (ws2.close(), await wacht(20), alle.length === 2));
  ok('zonder WebSocket: geen zender (oude browser, test zonder Node 22)', startBusZender({ lees: () => ({}), WebSocketImpl: null }) === null);
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nbus-zender: alles groen');
