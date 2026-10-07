// Spoor beeld (docs/BEELD.md): de koppeling met de Stroommachine zonder browser
// en zonder netwerk. Een nep-engine (alleen wat src/koppel/beeld.js leest), een
// nep-zender die alles opschrijft, en voor de volgorde van de berichten de ECHTE
// zender (src/koppel/varve-beeld-zender.js) op een nep-WebSocket met nep-timers.
// Draai met: node test/beeld.test.mjs
import { Beatgrid } from '../src/engine/beatgrid.js';
import {
  BeeldKoppeling, controleerAdres, klemLatentie, stabieleId, kiesKant, kenmerkenVan,
  MACROS, REGIE, MACRO_STANDAARD, ADRES_MAX, TIK_MS, ONBEREIKBAAR_MS, BEELD_VERS_MS, OPNIEUW_MS, STIL_MS,
} from '../src/koppel/beeld.js';
import { OVERSLAAN } from '../src/control/terugspelen.js';
import { hoorbareTel, engineTel } from '../src/analysis/maat.js';
import { bindBeeld, invoke, read } from '../src/control/actions.js';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const dicht = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---- nep-klok en nep-timers (zoals de zendertest van de Stroommachine) -------
let T = 1000;
let taken = [];
const timers = {
  setInterval: (f, ms) => { const t = { f, ms, next: T + ms, rep: true }; taken.push(t); return t; },
  clearInterval: (t) => { if (t) t.dood = true; },
  setTimeout: (f, ms) => { const t = { f, ms, next: T + ms, rep: false }; taken.push(t); return t; },
  clearTimeout: (t) => { if (t) t.dood = true; },
};
function loop(ms) {
  const eind = T + ms;
  for (;;) {
    const t = taken.filter((x) => !x.dood && x.next <= eind).sort((a, b) => a.next - b.next)[0];
    if (!t) break;
    T = t.next; t.f();
    if (t.rep) t.next += t.ms; else t.dood = true;
  }
  T = eind;
}
const levend = () => taken.filter((x) => !x.dood).length;

// ---- nep-engine: alleen wat beeld.js en maat.js lezen -------------------------
const IDS = ['A', 'B', 'C', 'D'];
function maakEngine() {
  const decks = {};
  for (const id of IDS) {
    decks[id] = { id, title: null, buffer: null, playing: false, wacht: false, remt: false, snelheid: 1,
      position: 0, rate: 1, grid: null, toonsoort: null, ui: { fader: 1 } };
  }
  return {
    decks, deck: (id) => decks[id], xfader: 0.5,
    kant: { A: 'A', B: 'B', C: 'thru', D: 'thru' },
    xfadeGain(id) { const k = this.kant[id]; return k === 'A' ? 1 - this.xfader : k === 'B' ? this.xfader : 1; },
    ctx: { outputLatency: 0.02, baseLatency: 0.01, currentTime: 5, sampleRate: 48000 },
    master: { analyser: null },
  };
}
const laad = (e, id, { bpm = 120, titel = 'nummer', camelot = '8A' } = {}) => {
  const d = e.deck(id);
  Object.assign(d, { title: titel, buffer: { duration: 300, stream: true }, position: 0, rate: 1,
    grid: new Beatgrid({ bpm, firstBeat: 0 }), toonsoort: { camelot, kort: 'Am' } });
};

// ---- nep-zender: schrijft op wat de koppeling vraagt -------------------------
function nepZenderMaker() {
  const gemaakt = [];
  const maak = (opties) => {
    const z = {
      opties, gestart: false, gestopt: false, status: { verbonden: false, beeld: null, verstuurd: 0, ontvangen: 0 },
      tracks: [], mixen: [], poorten: [], luisteraars: [],
      start() { this.gestart = true; }, stop() { this.gestopt = true; this.status.verbonden = false; },
      track(deck, info) { if (!this.status.verbonden) return false; this.tracks.push([deck, { ...info }]); return true; },
      mix(m) { this.mixen.push(JSON.parse(JSON.stringify(m))); },
      poort(id, w) { if (!this.status.verbonden) return false; this.poorten.push(w === undefined ? [id] : [id, w]); return true; },
      on(e, f) { this.luisteraars.push(f); return () => { this.luisteraars = this.luisteraars.filter((x) => x !== f); }; },
      verbind(v = true) { this.status.verbonden = v; for (const f of this.luisteraars) f(this.status); },
      beeld(b) { this.status.beeld = b; for (const f of this.luisteraars) f(this.status); },
    };
    gemaakt.push(z);
    return z;
  };
  return { maak, gemaakt };
}

/**
 * De Stroommachine is er: elke seconde een beeld-status (een nieuw object per
 * bericht, zoals de zender het maakt) en, met een koppeling erbij, een ping met
 * haar oplopende teller (zoals 09o-dj.js; de koppeling luistert mee op de
 * socket). Alleen zolang de zender verbonden is. Geeft een functie terug die
 * haar weghaalt; `.herlaad()` = een nieuwe pagina (de teller begint bij 1).
 */
function stroomLeeft(z, k = null, scene = 'Ruimte') {
  let teller = 0;
  const zeg = () => {
    if (!z.status.verbonden) return;
    if (k) k.hoorBericht(JSON.stringify({ naar: 'varvedj', type: 'ping', id: ++teller, t0: 1, van: 'stroommachine' }));
    z.beeld({ regime: 'Diepte', scene, fps: 60, volgt: true, bpm: 124 });
  };
  zeg();
  const taak = timers.setInterval(zeg, 1000);
  const weg = () => timers.clearInterval(taak);
  weg.herlaad = () => { teller = 0; zeg(); };
  return weg;
}

const nepLuisteraar = { waarden: { laag: 0.5, midden: 0.2, hoog: 0.9, onset: 1, rms: 0.3 }, lees() { return this.waarden; } };
const ADRES = 'ws://192.168.1.20:7702/app';

console.log('het adres en de latentie');
{
  ok('leeg = geen fout maar uit', controleerAdres('').ok === false && controleerAdres('').leeg === true && controleerAdres('   ').leeg === true);
  ok('geen tekst (null, getal) = uit', controleerAdres(null).leeg === true && controleerAdres(42).leeg === true);
  const c = controleerAdres(`  ${ADRES}  `);
  ok('getrimd en geaccepteerd', c.ok && c.adres === ADRES);
  ok('wss:// mag', controleerAdres('wss://pc.local:7702/app').ok);
  ok('schema en host in kleine letters', controleerAdres('WS://Omarchy.Local:7702/app').adres === 'ws://omarchy.local:7702/app');
  for (const [invoer, waarom] of [['http://192.168.1.20:7702/app', 'http'], ['https://x/app', 'https'], ['192.168.1.20:7702', 'zonder schema'],
    ['javascript:alert(1)', 'javascript:'], ['ws://', 'zonder host'], ['ws://ge bruiker:7702/app', 'spatie'],
    ['ws://a:b@pc:7702/app', 'met wachtwoord'], ['ws://pc:7702/app#x', 'met #'], ['ws://pc:99999/app', 'poort te groot']]) {
    const r = controleerAdres(invoer);
    ok(`geweigerd: ${waarom} (${r.reden})`, r.ok === false && !r.leeg && typeof r.reden === 'string');
  }
  const slecht = controleerAdres('ws://pc:6000/app');
  ok(`een poort die de browser nooit opent (6000): geweigerd met een eigen reden (${slecht.reden})`, slecht.ok === false && /6000/.test(slecht.reden));
  ok('poort 7702 en zonder poort mogen', controleerAdres('ws://pc:7702/app').ok && controleerAdres('ws://pc/app').ok);
  const lang = 'ws://pc/' + 'a'.repeat(ADRES_MAX);
  ok(`langer dan ${ADRES_MAX} tekens geweigerd`, controleerAdres(lang).ok === false);
  ok(`precies ${ADRES_MAX} tekens mag`, controleerAdres('ws://pc/' + 'a'.repeat(ADRES_MAX - 8)).ok);
  ok('latentie geklemd op −200 … +500', klemLatentie(900) === 500 && klemLatentie(-900) === -200 && klemLatentie(80) === 80);
  ok('latentie: onzin = 0, komma mag, hele ms', klemLatentie('abc') === 0 && klemLatentie(NaN) === 0 && klemLatentie(undefined) === 0
    && klemLatentie('12,6') === 13 && klemLatentie(' -40 ') === -40);
}

console.log('\nstabiele id per nummer');
{
  ok('YouTube: yt:<videoId>', stabieleId({ bron: 'library', nummer: 'dQw4w9WgXcQ' }) === 'yt:dQw4w9WgXcQ');
  ok('YouTube-id met - en _', stabieleId({ nummer: 'a-b_cdEFghI' }) === 'yt:a-b_cdEFghI');
  ok('TikTok: tiktok:<id>', stabieleId({ nummer: 'tiktok-7300000000000000001' }) === 'tiktok:7300000000000000001');
  ok('eigen bestand in de library: lokaal:<hash>', stabieleId({ nummer: 'lokaal-0123456789ab' }) === 'lokaal:0123456789ab');
  ok('demo: varve:demo-<zaad> (op track 1 altijd dezelfde)', stabieleId({ bron: 'demo', titel: 'demo 1', demo: { seed: 0, bars: 16 } }) === 'varve:demo-0'
    && stabieleId({ bron: 'demo', demo: { seed: 1 } }) === 'varve:demo-1' && stabieleId({ bron: 'demo' }) === 'varve:demo-0');
  ok('los bestand: bestand:<naam>', stabieleId({ bron: 'los', nummer: null, titel: 'set.wav' }) === 'bestand:set.wav');
  ok('hetzelfde nummer = dezelfde id', stabieleId({ nummer: 'dQw4w9WgXcQ', titel: 'a' }) === stabieleId({ nummer: 'dQw4w9WgXcQ', titel: 'b' }));
}

console.log('\nwelke track een kant vertegenwoordigt');
{
  const t = (id, kant, geladen, speelt, laatst) => ({ id, kant, geladen, speelt, laatst });
  ok('de enige geladen track op kant A', kiesKant([t('A', 'A', true, false, 1), t('B', 'B', true, false, 2)], 'A') === 'A');
  ok('thru hoort bij geen kant', kiesKant([t('C', 'thru', true, true, 9)], 'A') === null);
  ok('zonder nummer telt niet', kiesKant([t('A', 'A', false, false, 9)], 'A') === null);
  ok('wie speelt gaat voor wie later geladen werd (klaarzetten wisselt de scène niet)',
    kiesKant([t('A', 'A', true, true, 1), t('C', 'A', true, false, 5)], 'A') === 'A');
  ok('van twee spelende: wie het laatst begon', kiesKant([t('A', 'A', true, true, 1), t('C', 'A', true, true, 5)], 'A') === 'C');
  ok('niemand speelt: wie het laatst geladen of gestart werd', kiesKant([t('A', 'A', true, false, 7), t('C', 'A', true, false, 5)], 'A') === 'A');
  const o = (id, open, laatst) => ({ id, kant: 'A', geladen: true, speelt: true, open, laatst });
  ok('van twee spelende: wie met de fader open speelt gaat voor (voorbeluisteren met de fader dicht wisselt niets)',
    kiesKant([o('A', true, 1), o('C', false, 5)], 'A') === 'A');
  ok('speelt alleen een track met de fader dicht: die (spelen gaat voor stilstaan)',
    kiesKant([o('C', false, 5), t('A', 'A', true, false, 9)], 'A') === 'C');
}

console.log('\nkenmerken');
{
  const w = kenmerkenVan(nepLuisteraar.waarden, { beat: 41.125 });
  ok('mix.* uit de master-analyse (laag, midden, hoog, onset = klap, rms = luid)',
    w['mix.laag'] === 0.5 && w['mix.midden'] === 0.2 && w['mix.hoog'] === 0.9 && w['mix.klap'] === 1 && w['mix.luid'] === 0.3);
  ok('maat.tel = fase binnen de tel, maat.klap = 1 in het eerste kwart', dicht(w['maat.tel'], 0.125) && w['maat.klap'] === 1);
  const w2 = kenmerkenVan(null, { beat: 41.5 });
  ok('halverwege de tel: maat.klap 0; zonder analyse geen mix.*', w2['maat.klap'] === 0 && !('mix.laag' in w2));
  ok('zonder tel geen maat.*', !('maat.tel' in kenmerkenVan(nepLuisteraar.waarden, null)));
}

console.log('\nde tel uit maat.js, zoals je hem hoort');
{
  const e = maakEngine();
  laad(e, 'A', { bpm: 120 });
  Object.assign(e.deck('A'), { playing: true, position: 10 });
  const t = hoorbareTel(e.deck('A'), 0.03);
  ok('hoorbareTel: positie min vertraging (10 − 0,03 s op 120 bpm = tel 19,94)', dicht(t.beat, 19.94, 1e-9) && t.bpm === 120);
  e.deck('A').rate = 1.05;
  const t2 = hoorbareTel(e.deck('A'), 0.03);
  ok('met rate 1,05: bpm 126 en de vertraging × rate', dicht(t2.bpm, 126) && dicht(t2.beat, (10 - 0.03 * 1.05) * 2));
  e.deck('A').rate = 1;
  ok('engineTel: de maatgever die je hoort', engineTel(e, IDS, 0.03)?.id === 'A');
  e.deck('A').ui.fader = 0;
  ok('engineTel: fader dicht = je hoort hem niet = geen tel', engineTel(e, IDS, 0.03) === null);
  e.deck('A').ui.fader = 1;
  e.xfader = 1;
  ok('engineTel: crossfader helemaal naar B = kant A hoor je niet', engineTel(e, IDS, 0.03) === null);
}

console.log('\nde klok voor de zender');
{
  const e = maakEngine();
  const k = new BeeldKoppeling({ engine: e, ids: IDS, luisteraar: nepLuisteraar, maakZender: nepZenderMaker().maak, timers, nu: () => T });
  ok('nog nooit een tel gehoord: geen klok (de zender stuurt dan niets)', k.klok() === null);
  laad(e, 'A', { bpm: 120 });
  Object.assign(e.deck('A'), { playing: true, position: 10 });
  let c = k.klok();
  ok('tel = positie min (outputLatency + baseLatency): 10 − 0,03 s = tel 19,94', c.speelt === true && c.bpm === 120 && dicht(c.beat, 19.94));
  e.ctx.graafVertraging = 0.0015;
  ok('de vooruitblik van de master-limiter telt mee (hoorbaar.js)', dicht(k.klok().beat, (10 - 0.0315) * 2));
  e.ctx.graafVertraging = 0;
  k.zet({ latentie: 80 });
  c = k.klok();
  ok('extra latentie +80 ms: de tel 80 ms vóór (beamer loopt achter)', dicht(c.beat, (10 - 0.03 + 0.08) * 2));
  k.zet({ latentie: -100 });
  ok('extra latentie −100 ms: de tel later', dicht(k.klok().beat, (10 - 0.03 - 0.1) * 2));
  k.zet({ latentie: 9000 });
  ok('extra latentie geklemd op 500 ms', k.instellingen.latentie === 500 && dicht(k.klok().beat, (10 - 0.03 + 0.5) * 2));
  k.zet({ latentie: 0 });
  e.deck('A').rate = 1.1;
  ok('bpm = het tempo dat je hoort (grid × rate)', dicht(k.klok().bpm, 132));
  e.deck('A').rate = 1;
  ok('de tel loopt door, niet modulo de maat', k.klok().beat > 4);
  e.deck('A').playing = false;
  c = k.klok();
  ok('gestopt: speelt:false met de laatste tel en bpm (de Stroommachine valt terug op haar eigen klok)',
    c.speelt === false && c.bpm === 120 && dicht(c.beat, 19.94));
  Object.assign(e.deck('A'), { playing: true, wacht: true });
  ok('wacht op de maat: je hoort hem nog niet = speelt:false', k.klok().speelt === false);
  Object.assign(e.deck('A'), { wacht: false, remt: true });
  ok('remt: geen maatgever = speelt:false', k.klok().speelt === false);
  e.deck('A').remt = false;
  ok('weer spelen: speelt:true', k.klok().speelt === true);
}

console.log('\nkenmerken voor de zender');
{
  const e = maakEngine();
  const stil = { waarden: { laag: 0, midden: 0.002, hoog: 0, onset: 0, rms: 0.001 }, lees() { return this.waarden; } };
  const k = new BeeldKoppeling({ engine: e, ids: IDS, luisteraar: stil, maakZender: nepZenderMaker().maak, timers, nu: () => T });
  laad(e, 'A');
  ok('er speelt niets en de master is stil: null', k.kenmerken() === null);
  k.luisteraar = nepLuisteraar;
  ok('er speelt geen track, maar de master klinkt (sampler, klankschaal, een staart): kenmerken', k.kenmerken()?.['mix.laag'] === 0.5);
  k.luisteraar = stil;
  ok('de master net stil: nog even door (de waarden zakken naar ~0, niet blijven hangen)', k.kenmerken()?.['mix.laag'] === 0);
  T += STIL_MS + 1;
  ok(`${STIL_MS / 1000} s stil: null`, k.kenmerken() === null);
  k.luisteraar = nepLuisteraar;
  Object.assign(e.deck('A'), { playing: true, position: 0.5 + 0.03 });   // hoorbaar op 0,5 s = tel 1,0
  const w = k.kenmerken();
  ok('speelt: zeven kenmerken uit analyse en tel', Object.keys(w).length === 7 && w['mix.hoog'] === 0.9 && w['maat.klap'] === 1 && dicht(w['maat.tel'], 0, 1e-6));
  e.deck('A').grid = null;
  const w2 = k.kenmerken();
  ok('zonder grid: alleen de vijf uit de analyse', Object.keys(w2).length === 5);
  e.deck('A').wacht = true;
  k.luisteraar = stil;
  T += STIL_MS + 1;
  ok('alleen een track die op de maat wacht (en de master stil): null', k.kenmerken() === null);
  e.deck('A').wacht = false;
  e.deck('A').grid = new Beatgrid({ bpm: 120, firstBeat: 0 });
  let gelezen = 0;
  k.luisteraar = { lees: () => { gelezen++; return nepLuisteraar.waarden; } };
  const nz = nepZenderMaker();
  k.maakZender = nz.maak;
  taken = [];
  k.zet({ aan: true, adres: ADRES });
  ok('zender aan maar (nog) niet verbonden: null, en de analyser wordt niet gelezen', k.kenmerken() === null && gelezen === 0);
  nz.gemaakt[0].verbind(true);
  ok('verbonden: weer kenmerken', Object.keys(k.kenmerken() ?? {}).length === 7 && gelezen === 1);
  k.zet({ aan: false });
}

console.log('\nuit = geen verbinding');
{
  taken = [];
  const e = maakEngine();
  const nz = nepZenderMaker();
  let wsGemaakt = 0;
  const k = new BeeldKoppeling({ engine: e, ids: IDS, luisteraar: nepLuisteraar, maakZender: nz.maak, timers, nu: () => T,
    WebSocketImpl: class { constructor() { wsGemaakt++; } } });
  ok('nieuw: uit, geen zender, geen timer', !k.loopt && nz.gemaakt.length === 0 && levend() === 0);
  k.zet({ aan: false, adres: ADRES });
  ok('adres maar uit: geen zender', nz.gemaakt.length === 0 && !k.loopt);
  k.zet({ aan: true, adres: '' });
  ok('aan maar geen adres: geen zender', nz.gemaakt.length === 0 && !k.loopt);
  loop(30000);
  ok('na 30 s: nog steeds niets gemaakt, geen WebSocket, geen timer', nz.gemaakt.length === 0 && wsGemaakt === 0 && levend() === 0);
  k.zet({ adres: ADRES });
  ok('aan + geldig adres: de zender start met dat adres', nz.gemaakt.length === 1 && nz.gemaakt[0].gestart && nz.gemaakt[0].opties.url === ADRES);
  ok('de zender krijgt dezelfde klok en timers', nz.gemaakt[0].opties.timers === timers && nz.gemaakt[0].opties.nu() === T);
  k.zet({ latentie: 40 });
  ok('latentie wijzigen start hem niet opnieuw', nz.gemaakt.length === 1 && !nz.gemaakt[0].gestopt);
  k.zet({ adres: ADRES + ' ' });
  ok('hetzelfde adres (met spatie) start hem niet opnieuw', nz.gemaakt.length === 1);
  k.zet({ adres: 'ws://10.0.0.5:7702/app' });
  ok('ander adres: oude zender gestopt, nieuwe gestart', nz.gemaakt.length === 2 && nz.gemaakt[0].gestopt && nz.gemaakt[1].gestart);
  k.zet({ aan: false });
  ok('uit: zender gestopt, eigen tik en wachttijd weg (0 timers)', nz.gemaakt[1].gestopt && !k.loopt && levend() === 0);
  ok('status: uit, niet verbonden', k.status().aan === false && k.status().verbonden === false && k.status().loopt === false);
}

console.log('\neen ongeldig adres wordt geweigerd');
{
  taken = [];
  const e = maakEngine();
  const nz = nepZenderMaker();
  const k = new BeeldKoppeling({ engine: e, ids: IDS, luisteraar: nepLuisteraar, maakZender: nz.maak, timers, nu: () => T });
  let r = k.zet({ aan: true, adres: 'http://192.168.1.20:7702/app' });
  ok('http:// geweigerd met een reden, geen zender', r.ok === false && /ws:\/\//.test(r.reden) && nz.gemaakt.length === 0 && !k.loopt);
  ok('status zegt waarom', k.status().fout === r.reden);
  r = k.zet({ adres: ADRES });
  ok('daarna een goed adres: start, fout weg', r.ok && k.loopt && k.status().fout === null);
  r = k.zet({ adres: 'ws://' + 'x'.repeat(300) });
  ok('een ongeldig adres stopt een lopende zender (het oude adres loopt niet stilletjes door)',
    r.ok === false && nz.gemaakt[0].gestopt && !k.loopt && k.instellingen.adres === '' && levend() === 0);
}

console.log('\nmeldingen: hooguit één per start, geen regen bij herverbinden');
{
  taken = [];
  const e = maakEngine();
  const nz = nepZenderMaker();
  const k = new BeeldKoppeling({ engine: e, ids: IDS, luisteraar: nepLuisteraar, maakZender: nz.maak, timers, nu: () => T });
  const meldingen = [];
  k.on('melding', (m) => meldingen.push(m));
  k.zet({ aan: true, adres: ADRES });
  loop(ONBEREIKBAAR_MS + 1);
  ok('relay onbereikbaar: na 8 s één melding (fout)', meldingen.length === 1 && meldingen[0].soort === 'fout');
  loop(10 * 60 * 1000);
  ok('tien minuten later: nog steeds één', meldingen.length === 1);
  const z = nz.gemaakt[0];
  z.verbind(true);
  ok('verbonden: één melding erbij', meldingen.length === 2 && /verbonden/.test(meldingen[1].tekst));
  for (let i = 0; i < 20; i++) { z.verbind(false); loop(1000); z.verbind(true); loop(1000); }
  ok('twintig keer weg en terug: geen nieuwe meldingen', meldingen.length === 2);
  k.zet({ adres: 'ws://10.0.0.5:7702/app' });
  nz.gemaakt[1].verbind(true);
  ok('een nieuw adres mag weer één keer "verbonden" melden', meldingen.length === 3);
  k.zet({ aan: false });
  // Uit de bewaarde instellingen (een avond zonder pc): de melding gaat vanzelf weg.
  k.zet({ aan: true }, { vanzelf: true });
  loop(ONBEREIKBAAR_MS + 1);
  ok('start uit de bewaarde instellingen zonder relay: één melding, maar info (geen rode die blijft staan)',
    meldingen.length === 4 && meldingen[3].soort === 'info' && /staat de pc uit/.test(meldingen[3].tekst));
  k.zet({ aan: false });
}

console.log('\néén tabblad zendt (de Web Lock)');
{
  taken = [];
  const e = maakEngine();
  const nz = nepZenderMaker();
  const k = new BeeldKoppeling({ engine: e, ids: IDS, luisteraar: nepLuisteraar, maakZender: nz.maak, timers, nu: () => T, mag: false });
  k.zet({ aan: true, adres: ADRES }, { vanzelf: true });
  ok('een tweede tabblad (mag niet): geen zender, geen timer, status zegt "elders"', nz.gemaakt.length === 0 && levend() === 0 && k.status().elders === true);
  k.magZenden(true);
  ok('het wordt het eerste (de lock komt vrij): de zender start met de bewaarde instellingen', nz.gemaakt.length === 1 && nz.gemaakt[0].gestart && !k.status().elders);
  k.magZenden(true);
  ok('nog eens ja: niet opnieuw starten', nz.gemaakt.length === 1);
  k.magZenden(false);
  ok('weer nee (de hub gaf de APC aan een ander tabblad): zender gestopt, 0 timers, instellingen blijven',
    nz.gemaakt[0].gestopt && levend() === 0 && k.instellingen.aan === true && k.instellingen.adres === ADRES);
  k.zet({ adres: 'ws://10.0.0.5:7702/app' });
  ok('een ander adres terwijl dit tabblad niet mag: bewaard, niet gestart', nz.gemaakt.length === 1 && k.instellingen.adres === 'ws://10.0.0.5:7702/app');
}

console.log('\ntrack bij laden, met een stabiele id');
{
  taken = [];
  const e = maakEngine();
  const nz = nepZenderMaker();
  const k = new BeeldKoppeling({ engine: e, ids: IDS, luisteraar: nepLuisteraar, maakZender: nz.maak, timers, nu: () => T });
  laad(e, 'A', { bpm: 124, titel: 'Eerste', camelot: '8A' });
  k.naLaad({ deckId: 'A', bron: 'library', nummer: 'dQw4w9WgXcQ', titel: 'Eerste' });
  k.zet({ aan: true, adres: ADRES });
  const z = nz.gemaakt[0];
  loop(TIK_MS * 3);
  ok('niet verbonden: geen track (de laad is wel onthouden)', z.tracks.length === 0);
  z.verbind(true);
  ok('verbonden: niet meteen in het statusbericht (de zender stuurt eerst zijn manifest)', z.tracks.length === 0);
  loop(TIK_MS * 5);
  ok('verbonden, maar de Stroommachine is er nog niet (geen beeld-status): geen track (de relay zou hem weggooien)', z.tracks.length === 0 && z.mixen.length === 0);
  const weg = stroomLeeft(z, k);
  loop(TIK_MS);
  ok('haar eerste beeld-status, de volgende tik: track A met yt:<id>, titel, bpm en toonsoort',
    z.tracks.length === 1 && z.tracks[0][0] === 'A' && z.tracks[0][1].id === 'yt:dQw4w9WgXcQ'
    && z.tracks[0][1].titel === 'Eerste' && z.tracks[0][1].bpm === 124 && z.tracks[0][1].key === '8A');
  loop(5000);
  ok('niet opnieuw zolang er niets verandert (vijf beeld-statussen later)', z.tracks.length === 1);
  laad(e, 'B', { bpm: 128, titel: 'Tweede', camelot: '9A' });
  k.naLaad({ deckId: 'B', bron: 'library', nummer: 'tiktok-7300000000000000001', titel: 'Tweede' });
  loop(TIK_MS);
  ok('laden op track 2 (kant B): track B', z.tracks.length === 2 && z.tracks[1][0] === 'B' && z.tracks[1][1].id === 'tiktok:7300000000000000001');
  laad(e, 'C', { titel: 'Derde' });
  k.naLaad({ deckId: 'C', bron: 'library', nummer: 'aaaaaaaaaaa', titel: 'Derde' });
  loop(TIK_MS);
  ok('laden op een thru-track: niets (hoort bij geen kant)', z.tracks.length === 2);
  laad(e, 'A', { titel: 'Nieuw' });
  T += 5;
  k.naLaad({ deckId: 'A', bron: 'library', nummer: 'bbbbbbbbbbb', titel: 'Nieuw' });
  loop(TIK_MS);
  ok('een nieuw nummer op track 1: track A opnieuw, met de nieuwe id', z.tracks.length === 3 && z.tracks[2][1].id === 'yt:bbbbbbbbbbb');
  // klaarzetten op dezelfde kant terwijl er een speelt: geen wissel; starten: wel
  e.deck('A').playing = true;
  loop(TIK_MS);
  e.kant.C = 'A';
  T += 5;
  k.naLaad({ deckId: 'C', bron: 'library', nummer: 'ccccccccccc', titel: 'Klaar' });
  loop(TIK_MS * 3);
  ok('klaarzetten op kant A terwijl track 1 speelt: geen nieuwe track A', z.tracks.length === 3);
  e.deck('C').playing = true;
  loop(TIK_MS);
  ok('die track starten: hij neemt kant A over', z.tracks.length === 4 && z.tracks[3][0] === 'A' && z.tracks[3][1].id === 'yt:ccccccccccc');
  // herverbinden: track en mix opnieuw (de Stroommachine kan herladen zijn)
  const voor = z.tracks.length, mixVoor = z.mixen.length;
  z.verbind(false);
  loop(TIK_MS * 5);
  ok('verbroken: niets', z.tracks.length === voor);
  z.verbind(true);
  loop(1000);
  ok('weer verbonden (en de Stroommachine is er): beide kanten en de mix opnieuw', z.tracks.length === voor + 2 && z.mixen.length === mixVoor + 1);
  // De Stroommachine herladen terwijl relay en VARVE verbonden blijven: haar
  // ping-teller begint weer bij 1. Ook een snelle F5 (geen gat in de status).
  loop(OPNIEUW_MS);
  const n2 = z.tracks.length;
  weg.herlaad();
  loop(TIK_MS);
  ok('snel herladen (de ping-teller begint opnieuw, geen gat): beide kanten opnieuw', z.tracks.length === n2 + 2);
  loop(5000);
  ok('daarna, zolang ze er is: geen herhaling', z.tracks.length === n2 + 2);
  weg.herlaad();
  loop(TIK_MS);
  ok(`nog eens herladen binnen ${OPNIEUW_MS / 1000} s: nog niet (twee Stroommachines door elkaar geven zo geen scène per ping)`, z.tracks.length === n2 + 2);
  loop(OPNIEUW_MS);
  ok('… maar niet verloren: na de wachttijd alsnog', z.tracks.length === n2 + 4);
  // Laden terwijl ze herlaadt: de track gaat de lucht in (aanwezig klopt nog even), daarna opnieuw.
  loop(OPNIEUW_MS);
  laad(e, 'A', { titel: 'Tijdens' });
  T += 5;
  k.naLaad({ deckId: 'A', bron: 'library', nummer: 'ddddddddddd', titel: 'Tijdens' });
  e.deck('C').playing = false;
  loop(TIK_MS);
  const nTijdens = z.tracks.length;
  ok('laden tijdens het herladen: gaat (de relay gooit hem weg, dat weet VARVE niet)', z.tracks.at(-1)?.[1].id === 'yt:ddddddddddd');
  weg.herlaad();
  loop(TIK_MS);
  ok('de nieuwe pagina pingt: het nummer gaat opnieuw, niet verloren', z.tracks.length === nTijdens + 2
    && z.tracks.slice(-2).some(([kant, n]) => kant === 'A' && n.id === 'yt:ddddddddddd'));
  weg();
  k.zet({ aan: false });
}

console.log('\nvoorbeluisteren met de fader dicht wisselt de scène niet');
{
  taken = [];
  const e = maakEngine();
  const nz = nepZenderMaker();
  const k = new BeeldKoppeling({ engine: e, ids: IDS, luisteraar: nepLuisteraar, maakZender: nz.maak, timers, nu: () => T });
  laad(e, 'A'); k.naLaad({ deckId: 'A', bron: 'library', nummer: 'aaaaaaaaaaa', titel: 'Een' });
  e.kant.C = 'A';
  laad(e, 'C'); k.naLaad({ deckId: 'C', bron: 'library', nummer: 'ccccccccccc', titel: 'Drie' });
  e.deck('A').playing = true;
  k.zet({ aan: true, adres: ADRES });
  const z = nz.gemaakt[0];
  z.verbind(true);
  const weg = stroomLeeft(z, k);
  loop(TIK_MS);
  ok('track 1 speelt op kant A: track A = Een', z.tracks.at(-1)?.[1].id === 'yt:aaaaaaaaaaa');
  Object.assign(e.deck('C'), { playing: true }); e.deck('C').ui.fader = 0;
  loop(TIK_MS * 3);
  ok('track 3 (ook kant A) starten met de fader dicht: geen nieuwe track A', z.tracks.length === 1);
  e.deck('C').ui.fader = 0.8;
  loop(TIK_MS);
  ok('zijn fader open: nu neemt hij kant A over', z.tracks.length === 2 && z.tracks[1][1].id === 'yt:ccccccccccc');
  weg();
  k.zet({ aan: false });
}

console.log('\nmix bij crossfader en transport');
{
  taken = [];
  const e = maakEngine();
  const nz = nepZenderMaker();
  const k = new BeeldKoppeling({ engine: e, ids: IDS, luisteraar: nepLuisteraar, maakZender: nz.maak, timers, nu: () => T });
  laad(e, 'A'); k.naLaad({ deckId: 'A', bron: 'library', nummer: 'aaaaaaaaaaa', titel: 'A' });
  laad(e, 'B'); k.naLaad({ deckId: 'B', bron: 'library', nummer: 'bbbbbbbbbbb', titel: 'B' });
  k.zet({ aan: true, adres: ADRES });
  const z = nz.gemaakt[0];
  z.verbind(true);
  const weg = stroomLeeft(z, k);
  loop(TIK_MS);
  ok('na verbinden één mix met crossfader en beide kanten',
    z.mixen.length === 1 && z.mixen[0].xfader === 0.5 && z.mixen[0].a.speelt === false && z.mixen[0].b.rate === 1);
  loop(TIK_MS * 5);
  ok('niets veranderd: geen mix', z.mixen.length === 1);
  e.xfader = 0.8;
  loop(TIK_MS);
  ok('crossfader 0,8: mix met xfader 0,8', z.mixen.length === 2 && z.mixen[1].xfader === 0.8);
  e.xfader = 0;
  loop(TIK_MS);
  ok('crossfader 0: volledig A', z.mixen.length === 3 && z.mixen[2].xfader === 0);
  Object.assign(e.deck('A'), { playing: true, position: 10 });
  loop(TIK_MS);
  ok('play op A: mix met a.speelt', z.mixen.length === 4 && z.mixen[3].a.speelt === true);
  // gewoon doorspelen: de positie loopt mee, geen mix
  for (let i = 0; i < 5; i++) { e.deck('A').position += TIK_MS / 1000; loop(TIK_MS); }
  ok('doorspelen: geen mix bij elke tik', z.mixen.length === 4);
  e.deck('A').position += 30;
  loop(TIK_MS);
  ok('een sprong (hotcue): mix', z.mixen.length === 5 && z.mixen[4].a.pos > 39);
  e.deck('A').rate = 1.04;
  loop(TIK_MS);
  ok('tempo verandert: mix met de rate', z.mixen.length === 6 && z.mixen[5].a.rate === 1.04);
  e.deck('A').playing = false;
  loop(TIK_MS);
  ok('pauze: mix', z.mixen.length === 7 && z.mixen[6].a.speelt === false);
  weg();
  k.zet({ aan: false });
}

console.log('\npoort bij een APC-actie (de bus)');
{
  taken = [];
  const e = maakEngine();
  const nz = nepZenderMaker();
  const k = new BeeldKoppeling({ engine: e, ids: IDS, luisteraar: nepLuisteraar, maakZender: nz.maak, timers, nu: () => T });
  bindBeeld(k);
  ok('zonder verbinding: read null (ring en lampje uit)', read('beeld.macro.tint') === null && read('beeld.regie.flits') === null);
  invoke('beeld.macro.tint', 0.6);
  ok('zonder zender: er gaat niets', nz.gemaakt.length === 0);
  k.zet({ aan: true, adres: ADRES });
  const z = nz.gemaakt[0];
  z.verbind(true);
  ok('zonder verbinding gezet = niet onthouden (de ring liegt niet)', read('beeld.macro.tint') === MACRO_STANDAARD['macro.tint']);
  const weg = stroomLeeft(z, k);
  ok('verbonden: read = de stand (de neutrale stand van de Stroommachine tot je draait)',
    read('beeld.macro.helderheid') === MACRO_STANDAARD['macro.helderheid'] && read('beeld.macro.glitch') === 0);
  invoke('beeld.macro.tint', 0.61234);
  ok('value-action: poort macro.tint met de waarde', z.poorten.length === 1 && z.poorten[0][0] === 'macro.tint' && z.poorten[0][1] === 0.61234);
  ok('read volgt de gezette stand', read('beeld.macro.tint') === 0.61234);
  invoke('beeld.macro.glitch', 7);
  ok('buiten 0..1 geklemd', z.poorten[1][1] === 1);
  invoke('beeld.regie.flits', true);
  ok('trigger indrukken: poort regie!flits, zonder waarde', z.poorten.length === 3 && z.poorten[2].length === 1 && z.poorten[2][0] === 'regie!flits');
  ok('lampje: 1 zolang ingedrukt', read('beeld.regie.flits') === 1);
  invoke('beeld.regie.flits', false);
  ok('trigger loslaten: niets verstuurd, lampje terug op 0', z.poorten.length === 3 && read('beeld.regie.flits') === 0);
  const ids = [...MACROS.map((p) => `beeld.${p}`), ...REGIE.map((p) => `beeld.regie.${p.split('!')[1]}`)];
  for (const id of ids) invoke(id, id.includes('regie') ? true : 0.5);
  const verstuurd = z.poorten.slice(3).map((p) => p[0]);
  ok('alle acht macro\'s en zes regieknoppen bereiken hun poort', verstuurd.length === 14
    && MACROS.every((p) => verstuurd.includes(p)) && REGIE.every((p) => verstuurd.includes(p)));
  // Elke id bestaat in de Stroommachine: 09d-poorten.js daar (macro.intensiteit,
  // snelheid, balans en de regie letterlijk; de andere vijf via LIVE_MACROS in 09c-live.js).
  const repo = process.env.VARVE_STROOM_REPO || join(homedir(), 'Projects/stroommachine');
  if (existsSync(join(repo, 'src/09d-poorten.js'))) {
    const poorten = readFileSync(join(repo, 'src/09d-poorten.js'), 'utf8');
    const live = /const LIVE_MACROS = \[([\s\S]*?)\];/.exec(readFileSync(join(repo, 'src/09c-live.js'), 'utf8'))?.[1] ?? '';
    const mist = [...MACROS, ...REGIE].filter((p) => !poorten.includes(`'${p}'`)
      && !(p.startsWith('macro.') && poorten.includes("knop('macro.' + m[0]") && live.includes(`['${p.slice(6)}',`)));
    ok(`elke poort-id bestaat in de Stroommachine (${repo}/src/09d-poorten.js${mist.length ? `; mist: ${mist.join(', ')}` : ''})`, !mist.length);
  } else console.log(`  -- poort-id's niet nagelopen: geen Stroommachine in ${repo} (zet VARVE_STROOM_REPO)`);
  // De Stroommachine herladen: ze begint neutraal, VARVE zet de macro's die je zette terug.
  const voorHerladen = z.poorten.length;
  loop(OPNIEUW_MS);
  weg.herlaad();
  loop(TIK_MS);
  const terug = z.poorten.slice(voorHerladen);
  ok('herladen: de macro\'s die je zette gaan opnieuw (met hun stand), de regie niet',
    terug.length === MACROS.length && terug.every(([p, w]) => MACROS.includes(p) && w === k.macros[p]));
  ok('terugspelen slaat de regie over (vasthouden en paniek zijn schakelaars), de macro\'s niet',
    OVERSLAAN.test('beeld.regie.paniek') && OVERSLAAN.test('beeld.regie.ontdek') && !OVERSLAAN.test('beeld.macro.tint'));
  weg();
  z.verbind(false);
  ok('verbinding weg: read weer null', read('beeld.macro.tint') === null && read('beeld.regie.paniek') === null);
  k.zet({ aan: false });
}

console.log('\nbeeld-status van de Stroommachine');
{
  taken = [];
  const e = maakEngine();
  const nz = nepZenderMaker();
  const k = new BeeldKoppeling({ engine: e, ids: IDS, luisteraar: nepLuisteraar, maakZender: nz.maak, timers, nu: () => T });
  let gemeld = 0;
  k.on('status', () => gemeld++);
  k.zet({ aan: true, adres: ADRES });
  const z = nz.gemaakt[0];
  z.verbind(true);
  ok('verbonden zonder beeld-status: beeld null', k.status().verbonden && k.status().beeld === null);
  z.beeld({ regime: 'Diepte', scene: 'Ruimte · Veld', fps: 58, volgt: true, bpm: 124 });
  const s = k.status();
  ok('beeld-status: regime, scène en of hij de klok volgt', s.beeld?.regime === 'Diepte' && s.beeld.scene === 'Ruimte · Veld' && s.beeld.volgt === true);
  loop(BEELD_VERS_MS + 10);
  ok('na 3 s zonder nieuwe beeld-status: niet meer tonen (de relay is er, de Stroommachine niet)', k.status().beeld === null);
  z.beeld({ regime: 'Kleur', scene: 'x', fps: 30, volgt: false, bpm: 120 });
  ok('een nieuwe: weer zichtbaar', k.status().beeld?.regime === 'Kleur');
  ok('elke verandering meldt status', gemeld >= 4);
  k.zet({ aan: false });
}

// ---- met de ECHTE zender: volgorde op de lijn en herverbinden --------------------
console.log('\nde echte zender op een nep-WebSocket');
{
  taken = [];
  const socks = [];
  // Zoals een echte WebSocket: onmessage én addEventListener (daarop luistert de koppeling mee).
  class NepWS {
    constructor(url) { this.url = url; this.readyState = 0; this.uit = []; this.luister = []; socks.push(this); }
    addEventListener(type, f) { if (type === 'message') this.luister.push(f); }
    send(s) { this.uit.push(JSON.parse(s)); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen && this.onopen(); }
    krijg(o) { const e = { data: JSON.stringify(o) }; for (const f of this.luister) f(e); this.onmessage && this.onmessage(e); }
    sluit() { this.readyState = 3; this.onclose && this.onclose(); }
  }
  const e = maakEngine();
  laad(e, 'A', { bpm: 124, titel: 'Een' });
  Object.assign(e.deck('A'), { playing: true, position: 20 });
  const k = new BeeldKoppeling({ engine: e, ids: IDS, luisteraar: nepLuisteraar, timers, nu: () => T, WebSocketImpl: NepWS });
  k.naLaad({ deckId: 'A', bron: 'library', nummer: 'dQw4w9WgXcQ', titel: 'Een' });
  k.zet({ aan: true, adres: ADRES });
  ok('één WebSocket naar het adres', socks.length === 1 && socks[0].url === ADRES);
  // De Stroommachine via de relay: elke seconde een beeld-status op de open socket.
  const status = () => ({ type: 'beeld-status', naar: 'varvedj', van: 'stroommachine', regime: 'Gloed', scene: 'Filament', bpm: 124, volgt: true, fps: 60 });
  let pingTeller = 0;
  const stroomTaak = timers.setInterval(() => {
    const s = socks[socks.length - 1];
    if (s.readyState !== 1) return;
    s.krijg({ naar: 'varvedj', type: 'ping', id: ++pingTeller, t0: 1, van: 'stroommachine' });
    s.krijg(status());
  }, 1000);
  socks[0].open();
  loop(TIK_MS + 5);
  ok('nog geen beeld-status: klok wel, track nog niet', socks[0].uit.some((m) => m.type === 'klok') && !socks[0].uit.some((m) => m.type === 'track'));
  socks[0].krijg(status());
  loop(TIK_MS + 5);
  const lijn = socks[0].uit;
  ok('eerste bericht = het manifest van varvedj (ook al luistert de koppeling op "verbonden")', lijn[0]?.app === 'varvedj' && Array.isArray(lijn[0].bronnen));
  const klok = lijn.find((m) => m.type === 'klok');
  ok('klok: naar stroommachine, bpm 124, tel = hoorbare positie, speelt', klok && klok.naar === 'stroommachine' && klok.bpm === 124
    && klok.speelt === true && Math.abs(klok.beat - (20 - 0.03) * 124 / 60) < 0.01);
  const tr = lijn.find((m) => m.type === 'track');
  ok('track A met yt:-id na het manifest', tr && tr.deck === 'A' && tr.id === 'yt:dQw4w9WgXcQ' && lijn.indexOf(tr) > 0);
  loop(100);
  const mix = socks[0].uit.find((m) => m.type === 'mix');
  ok('mix na de begrenzing van de zender', mix && mix.xfader === 0.5 && mix.a?.speelt === true);
  ok('kenmerken op ~30 Hz zonder naar (via de relay)', socks[0].uit.filter((m) => m.type === 'kenmerken').length >= 5
    && !('naar' in socks[0].uit.find((m) => m.type === 'kenmerken')));
  socks[0].krijg({ type: 'ping', id: 3, t0: 7, van: 'stroommachine' });
  ok('pong op ping (de zender doet het zelf)', socks[0].uit.some((m) => m.type === 'pong' && m.id === 3));
  socks[0].sluit();
  ok('relay weg: niet verbonden, geen fout', !k.verbonden);
  loop(1500);
  ok('herverbindt vanzelf', socks.length === 2);
  socks[1].open();
  loop(1000 + TIK_MS + 5);
  ok('de koppeling luistert mee op de socket van de zender (de pings)', socks[1].luister.length === 1 && k.pingId === pingTeller);
  ok('na herverbinden: weer eerst het manifest, dan opnieuw track A',
    socks[1].uit[0]?.app === 'varvedj' && socks[1].uit.some((m) => m.type === 'track' && m.id === 'yt:dQw4w9WgXcQ'));
  // De Stroommachine herladen (haar ping-teller begint opnieuw), over de echte zender.
  loop(OPNIEUW_MS);
  const voor = socks[1].uit.filter((m) => m.type === 'track').length;
  pingTeller = 0;
  loop(1000 + TIK_MS + 5);
  ok('de Stroommachine herladen (haar ping-teller begint weer bij 1): track A gaat opnieuw over de lijn',
    socks[1].uit.filter((m) => m.type === 'track').length === voor + 1);
  ok('de zender antwoordde ook op die pings (pong), de koppeling stuurt zelf geen pong',
    socks[1].uit.filter((m) => m.type === 'pong').length >= 2);
  k.zet({ aan: false });
  timers.clearInterval(stroomTaak);
  const n = socks[1].uit.length;
  loop(5000);
  ok('uit: geen berichten meer, geen timers, geen nieuwe WebSocket', socks[1].uit.length === n && levend() === 0 && socks.length === 2);
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles groen');
