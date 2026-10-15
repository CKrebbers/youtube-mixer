// Superknoppen (werkruimte S4, docs/werkruimte/S4.md): het pure deel (superknop.js)
// en de actions super.* (acties-combi.js) met een nep-bus.
// Draai met: node test/superknop.test.mjs
import { resolveLink, CURVES } from '../src/engine/rack.js';

const S = await import('../src/control/superknop.js');
const { bindCombi, VOORBEELD_SUPERKNOP } = await import('../src/control/acties-combi.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

// ---- de rekenregel: een gouden tabel ------------------------------------------
console.log('superknop.js: dezelfde rekenregel als een rack-knop');
{
  // Vier links met elk iets anders: bereik, venster, curve, stappen.
  const links = [
    { target: 'track.1.send.a', from: 0, to: 0.7 },
    { target: 'track.1.send.b', in: [0.3, 1], from: 0, to: 0.5, curve: 'exp' },
    { target: 'track.1.filter', in: [0.5, 1], from: 0.5, to: 0.8, curve: 's' },
    { target: 'track.2.fader', from: 1, to: 0.2, steps: 5, curve: 'log' },
  ];
  // De verwachte waarden met de hand uitgerekend (pasCurve van rack.js: exp = t², log = 1 − (1 − t)², s = smoothstep).
  const smooth = (t) => t * t * (3 - 2 * t);
  const kl = (x) => Math.min(1, Math.max(0, x));
  const verwacht = (m) => [
    0.7 * m,
    0.5 * Math.pow(kl((m - 0.3) / 0.7), 2),
    0.5 + 0.3 * smooth(kl((m - 0.5) / 0.5)),
    Math.round((1 - 0.8 * (1 - (1 - m) ** 2)) * 4) / 4,
  ];
  const standen = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const { superknop, fouten } = S.normaliseerSuper({ naam: 'proef', links });
  ok('normaliseerSuper: vier links, geen fouten', superknop.links.length === 4 && fouten.length === 0);
  let gelijkAanRack = true, gelijkAanHand = true;
  const tabel = [];
  for (const m of standen) {
    const w = S.linkWaarden(m, superknop.links);
    tabel.push(w);
    links.forEach((l, i) => { if (w[i] !== resolveLink(m, l)) gelijkAanRack = false; });
    verwacht(m).forEach((v, i) => { if (Math.abs(w[i] - v) > 1e-12) gelijkAanHand = false; });
  }
  ok('gouden tabel 11 standen × 4 links: precies resolveLink per link', gelijkAanRack && tabel.length === 11 && tabel.every((r) => r.length === 4));
  ok('… en gelijk aan de met de hand uitgerekende tabel (± 1e-12)', gelijkAanHand);
  ok('pasCurve kent de curves van het rack', ['exp', 'log', 's'].every((c) => CURVES.includes(c)));
}

console.log('\nnormaliseren en morph');
{
  const { superknop, fouten } = S.normaliseerSuper({ links: [
    { target: 'super.2' }, { target: 'track.1.filter', from: 2, raar: 1 }, { from: 0 }, { target: 'track.1.fader', in: [0.2, 0.8], glide: true },
  ] });
  ok('een superknop stuurt geen superknop; zonder target overgeslagen', superknop.links.length === 2
    && fouten.some((f) => /superknop stuurt geen superknop/.test(f)) && fouten.some((f) => /target/.test(f)));
  ok('from buiten 0..1 en een onbekend veld: genegeerd met een fout', superknop.links[0].from === undefined
    && fouten.some((f) => /"from"/.test(f)) && fouten.some((f) => /onbekend veld raar/.test(f)));
  ok('glide en in blijven', superknop.links[1].glide === true && superknop.links[1].in.join() === '0.2,0.8');
  const te = S.normaliseerSuper({ links: Array.from({ length: 40 }, () => ({ target: 'track.1.fader' })) });
  ok(`hooguit ${S.MAX_LINKS} links`, te.superknop.links.length === S.MAX_LINKS && te.fouten.length === 1);
  ok('geen lijst: één fout, geen links', S.normaliseerSuper(null).superknop.links.length === 0 && S.normaliseerSuper({}).fouten.length === 1);

  const links = [{ target: 'a', from: 0, to: 1, curve: 'exp' }, { target: 'b', from: 0.2, to: 0.4 }];
  const A = S.legVast(links, 'A', (t) => (t === 'a' ? 0.3 : null));
  const B = S.legVast(A, 'B', (t) => (t === 'a' ? 0.9 : 0.6));
  ok('legVast A: from = de stand van nu; een link zonder read blijft', A[0].from === 0.3 && A[1].from === 0.2 && links[0].from === 0);
  ok('legVast B: to = de stand van nu; curve blijft', B[0].to === 0.9 && B[1].to === 0.6 && B[0].curve === 'exp');
  ok('morph: knop dicht = A, open = B', S.linkWaarden(0, B)[0] === 0.3 && Math.abs(S.linkWaarden(1, B)[0] - 0.9) < 1e-12);
  ok('linkNaarJSON: alleen de velden van een rack-link', JSON.stringify(S.linkNaarJSON({ target: 'x', in: [0, 1], to: 0.5, raar: 1 })) === '{"target":"x","in":[0,1],"to":0.5}');
}

// ---- de actions met een nep-bus ---------------------------------------------------
console.log('\nsuper.* op een nep-bus');
{
  const reg = new Map();
  const stand = { 'track.1.send.a': 0.1, 'track.1.send.b': 0.2, 'track.1.filter': 0.5, 'track.2.fader': 1 };
  const gedaan = [];
  const meldingen = [];
  const define = (id, type, fn, meta = {}) => reg.set(id, { id, type, fn, meta });
  const metaOf = (id) => { const a = reg.get(id) ?? (id in stand ? { id, type: 'value', meta: {} } : id === 'track.1.play' ? { id, type: 'trigger', meta: {} } : null);
    if (!a) return null; const { read: _r, ...rest } = a.meta; return { id: a.id, type: a.type, ...rest }; };
  const invoke = (id, v) => { gedaan.push([id, v]); if (reg.has(id)) reg.get(id).fn(v); else if (id in stand) stand[id] = v; };
  const read = (id) => (reg.has(id) ? reg.get(id).meta.read?.() ?? null : stand[id] ?? null);
  const deck = { ui: { sendA: 0, sendB: 0 }, set() {}, fx: { mix: 0, setMix() {} }, stemBestaat: () => false, stems: null };
  const engine = { focus: 'A', deck: () => deck, sends: {} };
  const c = bindCombi({ engine, define, invoke, read, metaOf, meld: (t, s) => meldingen.push([t, s]), vars: () => ({ focus: 1 }) });

  ok('super.1–16 bestaan, value, log overslaan, niet in de beginstand', [1, 16].every((k) => metaOf(`super.${k}`)?.type === 'value'
    && metaOf(`super.${k}`).log === 'overslaan' && metaOf(`super.${k}`).beginstand === false) && !reg.has('super.17'));
  ok('vastA/vastB: alleen op het scherm', metaOf('super.3.vastA').alleenScherm === true && metaOf('super.3.vastB').alleenScherm === true);
  ok('een lege superknop leest null (lampje uit) en doet niets', read('super.2') === null && (invoke('super.2', 0.5), gedaan.length === 1));

  c.zetSuperknop(1, { links: [
    { target: 'track.{focus}.send.a', from: 0, to: 0.7 },
    { target: 'track.{focus}.send.b', in: [0.3, 1], from: 0, to: 0.5, curve: 'exp' },
    { target: 'track.{focus}.filter', in: [0.5, 1], from: 0.5, to: 0.8 },
    { target: 'track.2.fader', from: 1, to: 0.2, steps: 5, curve: 'log' },
  ] });
  gedaan.length = 0;
  invoke('super.1', 0.6);
  const kinderen = gedaan.slice(1);
  ok('super.1 = 0,6: vier kinderen over de bus, {focus} ingevuld', kinderen.length === 4
    && kinderen.map(([a]) => a).join() === 'track.1.send.a,track.1.send.b,track.1.filter,track.2.fader');
  ok('… met de waarden van resolveLink', kinderen.every(([a, v], i) => v === resolveLink(0.6, c.supers[1].links[i])));
  ok('read super.1 = zijn eigen stand', read('super.1') === 0.6);

  gedaan.length = 0;
  invoke('super.1.hold', true);
  ok('super.1.hold indrukken: de superknop op 1', read('super.1') === 1 && read('super.1.hold') === 1 && gedaan.at(-1)[1] === resolveLink(1, c.supers[1].links[3]));
  invoke('super.1.hold', false);
  ok('… loslaten: terug naar 0,6', read('super.1') === 0.6 && read('super.1.hold') === 0);

  // Morph: A en B vastleggen.
  stand['track.1.send.a'] = 0.25; stand['track.1.send.b'] = 0.1; stand['track.1.filter'] = 0.4; stand['track.2.fader'] = 0.9;
  invoke('super.1.vastA', true);
  stand['track.1.send.a'] = 0.75; stand['track.1.send.b'] = 0.6; stand['track.1.filter'] = 0.7; stand['track.2.fader'] = 0.3;
  invoke('super.1.vastB', true);
  invoke('super.1', 0);
  ok('morph: knop dicht = de stand van A', stand['track.1.send.a'] === 0.25 && stand['track.1.filter'] === 0.4);
  invoke('super.1', 1);
  ok('morph: knop open = de stand van B', Math.abs(stand['track.1.send.a'] - 0.75) < 1e-12 && Math.abs(stand['track.1.filter'] - 0.7) < 1e-12);

  // Glijden: alleen via een bestaande .glide.
  define('track.1.send.b.glide', 'value', () => {});
  c.zetSuperknop(2, { links: [{ target: 'track.1.send.b', glide: true }, { target: 'track.2.fader', glide: true }] });
  gedaan.length = 0;
  invoke('super.2', 0.5);
  ok('glide: via track.1.send.b.glide, en direct waar geen .glide is', gedaan.slice(1).map(([a]) => a).join() === 'track.1.send.b.glide,track.2.fader');

  // Een link naar een onbekende action: grijs, één melding, geen crash.
  meldingen.length = 0;
  c.zetSuperknop(3, { links: [{ target: 'track.1.bestaatniet' }, { target: 'track.1.play' }, { target: 'track.1.filter' }] });
  gedaan.length = 0;
  let gegooid = null;
  try { invoke('super.3', 0.3); invoke('super.3', 0.8); } catch (e) { gegooid = e; }
  const st = c.superStatus(3);
  ok('onbekende link: grijs, en een trigger als link ook', st.links[0].grijs && st.links[1].grijs && !st.links[2].grijs);
  ok(`… één melding per doel, ook na twee keer draaien (${meldingen.length})`, meldingen.length === 2 && meldingen.every(([, s]) => s === 'fout') && !gegooid);
  ok('… en de goede link werkt gewoon', gedaan.filter(([a]) => a === 'track.1.filter').length === 2);

  ok('het voorbeeld is een geldige superknop met een naam waar "voorbeeld" in staat',
    /voorbeeld/.test(VOORBEELD_SUPERKNOP.naam) && S.normaliseerSuper(VOORBEELD_SUPERKNOP).fouten.length === 0);
  c.zetSuperknoppen([VOORBEELD_SUPERKNOP]);
  ok('zetSuperknoppen: de lijst op 1, de rest leeg', c.supers[1].links.length === 3 && c.supers[2].links.length === 0 && read('super.3') === null);

  console.log('\nsuperknoppen uit een werkruimte (S3-vorm: nr + action; samenvoegen golf 2)');
  const { superknoppenVanWerk } = await import('../src/control/acties-combi.js');
  const { normaliseerWerkruimte } = await import('../src/werk/model.js');
  // Het voorbeeld uit WERKRUIMTE.md B2, door het model van S3.
  const ruw = { schema: 1, naam: 'proef', delen: { mix: { label: 'MIX', kleur: 'wit', apc40mk2: { grid: 'hotcues' } } }, deel: { start: 'mix' },
    superknoppen: [{ nr: 2, naam: 'DUB', links: [
      { action: 'track.{focus}.send.a', in: [0, 0.3], from: 0, to: 1 },
      { action: 'track.{focus}.filter', in: [0, 1], from: 0.5, to: 0.72, curve: 's' }] }] };
  const n = normaliseerWerkruimte(ruw);
  ok('het model neemt het voorbeeld aan', n.fouten.length === 0 && n.werkruimte.superknoppen.length === 1);
  const lijst = superknoppenVanWerk(n.werkruimte.superknoppen);
  ok('superknoppenVanWerk: nr 2 op plek 2, action -> target', lijst.length === 2 && !lijst[0] && lijst[1].naam === 'DUB'
    && lijst[1].links.every((l) => l.target && !('action' in l)) && lijst[1].links[1].curve === 's');
  const fout = c.zetSuperknoppen(lijst);
  ok('… zetSuperknoppen neemt het aan: super.2 heeft twee links, super.1 leeg', fout.length === 0 && c.supers[2].links.length === 2 && c.supers[1].links.length === 0);
  const n2 = normaliseerWerkruimte({ ...ruw, superknoppen: [{ nr: 1, naam: 'opbouw', links: [{ target: 'track.{focus}.fader', from: 1, to: 0.7, glide: true }] }] });
  const l2 = superknoppenVanWerk(n2.werkruimte?.superknoppen);
  ok('de vorm van S4.md (target, glide) mag ook in een werkruimte', n2.fouten.length === 0 && l2[0]?.links[0]?.target === 'track.{focus}.fader' && l2[0].links[0].glide === true);
  ok('… en zetSuperknop neemt hem aan', c.zetSuperknop(3, l2[0]).length === 0 && c.supers[3].links[0].glide === true);
  ok('… en rekent zoals een rack-knop', (() => { const w = S.linkWaarden(0.5, c.supers[2].links); return Math.abs(w[0] - 1) < 1e-12 && Math.abs(w[1] - resolveLink(0.5, { from: 0.5, to: 0.72, curve: 's' })) < 1e-12; })());
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
