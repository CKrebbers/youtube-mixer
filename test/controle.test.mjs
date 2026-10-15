// De Controlekamer zonder browser: de opslag van de speellijst
// (server/proef.js), de speellijst zelf (src/controle/speellijst.js), het
// bericht dat de mixer stuurt (src/ui/status-zender.js), de tegel Stems
// (src/ui/stems-weergave.js) en beeld: de tegel, de statusregel van de
// BEELD-rij en het lampje op de knop (src/ui/beeld-weergave.js). Op een
// tijdelijke map.
// Draai met: node test/controle.test.mjs
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const { Proef, ID, STATUSSEN } = await import('../server/proef.js');
const { SPEELLIJST, allePunten } = await import('../src/controle/speellijst.js');
const { maakStatus } = await import('../src/ui/status-zender.js');
const { mixerAdres } = await import('../src/ui/vlag.js');

console.log('mixer openen vanuit de Controlekamer');
{
  const C = 'http://localhost:8777/controle';
  ok('zonder ?hub= gewoon /', mixerAdres(C) === '/');
  const m = mixerAdres(`${C}?hub=ws://localhost:7700/app`);
  ok(`met ?hub= gaat de hub mee (${m})`, new URL(m, C).searchParams.get('hub') === 'ws://localhost:7700/app' && new URL(m, C).pathname === '/');
  ok('een vreemde hub gaat niet mee', mixerAdres(`${C}?hub=ws://voorbeeld.com:7700/app`) === '/');
  const ext = new URL(mixerAdres(`${C}?hub=ws://voorbeeld.com:7700/app&hub_extern=1`), C).searchParams;
  ok('met hub_extern=1 gaan beide mee', ext.get('hub') === 'ws://voorbeeld.com:7700/app' && ext.get('hub_extern') === '1');
  ok('geen ws-adres: gewoon /', mixerAdres(`${C}?hub=http://localhost:7700`) === '/');
}

console.log('de speellijst');
{
  const punten = allePunten();
  const ids = punten.map((p) => p.id);
  ok(`elk punt-id is uniek (${ids.length} punten)`, new Set(ids).size === ids.length);
  ok('elk punt-id past op de server (letters, cijfers, - en _)', ids.every((id) => ID.test(id)));
  ok('elk punt heeft een doe en een let', punten.every((p) => p.doe && p.let));
  ok('elk blok heeft een titel, minuten en punten', SPEELLIJST.every((b) => b.titel && b.minuten > 0 && b.punten.length));
  ok('blok-ids zijn uniek', new Set(SPEELLIJST.map((b) => b.id)).size === SPEELLIJST.length);
  // De volgorde (9 okt, verbeteronderzoek): Clay loopt de lijst van boven af, dus alle "Avond 1" vóór "Avond 2"
  // vóór "Avond 3" vóór "Eerder werk", en avond 1 begint met de kern van ~45 min.
  // S8: de proefavonden van de werkruimte (docs/WERKRUIMTE.md D3) staan tussen avond 3 en "Eerder werk".
  // 16 okt: "Vooraf" (overdag, vóór avond 1: backup, media, VARVE.app, de herberekening, de opstelling) staat bovenaan.
  const AVONDEN = ['Vooraf', 'Avond 1', 'Avond 2', 'Avond 3', 'Werkruimte', 'Eerder werk'];
  const rang = SPEELLIJST.map((b) => AVONDEN.indexOf(b.titel.split(' · ')[0]));
  ok('het blok Werkruimte: E0, poort M, A, B, C en D, elk punt met een oordeel', ['werk-e0', 'werk-m', 'werk-a', 'werk-b', 'werk-c', 'werk-d'].every((id) => SPEELLIJST.find((b) => b.id === id)?.punten.every((p) => /Oordeel/.test(p.let))));
  ok(`elke bloktitel begint met ${AVONDEN.map((a) => `"${a} · "`).join(', ')}`, rang.every((r) => r >= 0));
  ok('de blokken staan op avondvolgorde', rang.every((r, i) => i === 0 || r >= rang[i - 1]));
  const KERN = ['start', 'luisteren', 'draaien', 'koptelefoon', 'keylock'];
  const eersteAvond = SPEELLIJST.findIndex((b) => b.titel.startsWith('Avond 1 · '));
  const kern = SPEELLIJST.slice(eersteAvond, eersteAvond + KERN.length);
  ok(`de kern van avond 1 staat vooraan (${KERN.join(', ')}: ~${kern.reduce((s, b) => s + b.minuten, 0)} min)`,
    kern.map((b) => b.id).join() === KERN.join() && kern.every((b) => b.titel.startsWith('Avond 1 · ')));
  // De volgorde van "Vooraf" (16 okt): eerst een kopie buiten de laptop, dan media buiten iCloud (server uit), dan
  // VARVE.app opnieuw (ar-app), en pas daarna de herberekening van de grids; die vóór alles van het beatgrid.
  const plek = (id) => ids.indexOf(id);
  ok('vooraf: kopie → media verhuizen → VARVE.app → herberekening, en dat vóór avond 1',
    plek('bk-eerste') < plek('mv-doe') && plek('mv-doe') < plek('ar-app') && plek('ar-app') < plek('ar-herreken')
    && plek('ar-herreken') < plek('start-apc') && plek('ar-herreken') < plek('bg-oordeel'));
  ok('avond 2: VARVE.app start de hub (app-hub) vóór de terugval met de hand (hb-start)', plek('app-hub') < plek('hb-start') && plek('hb-start') < plek('app-erbij'));
  // De nacht na avond 1 (nacht-eerste) mag niet geblokkeerd zijn: de speeldag op de companion komt pas na avond 2.
  ok('vandaag speeldag (co-speeldag) pas na nacht-eerste, en het setboek na de avond', plek('nacht-eerste') < plek('co-speeldag')
    && plek('ar-wav') < plek('sb-draai') && plek('sb-log') < plek('sb-draai'));
  // Avond 1 is zonder hub, maar VARVE.app start hem (sinds 13 okt): start-apc en de herstart in ar-weg zeggen hoe niet.
  const tekstVan = (id) => { const p = punten.find((q) => q.id === id); return `${p.doe} ${p.let}`; };
  ok('avond 1 zonder hub: start-apc stopt de hub van VARVE.app, ar-weg start de server zonder VARVE.app',
    /kill \$\(lsof -nP -t -iTCP:7700/.test(tekstVan('start-apc')) && /zonder hub/.test(tekstVan('start-apc'))
    && /server-lus\.sh >> ~\/\.varve-server\.log/.test(tekstVan('ar-weg')) && !/open ~\/Applications\/VARVE\.app/.test(tekstVan('ar-weg')));
  // De stand op de server hangt aan het id: een punt dat al bestond, blijft bestaan
  // (anders raakt zijn notitie kwijt). De punten van vóór 6 okt:
  const EERDER = ['start-apc', 'start-audio', 'start-scherm', 'dr-laden', 'dr-opdemaat', 'dr-beatjump', 'dr-loop',
    'dr-quantize', 'dr-rem', 'dr-mix', 'kl-modus', 'kl-kill', 'kl-kleuren', 'kl-knipper', 'to-pitch', 'to-klopt',
    'to-sorteer', 'to-hotcue', 'in-drie', 'in-dubbel', 'in-playlist', 'au-aan', 'au-overgang', 'au-knoppen', 'au-apc',
    'au-glad', 'pl-open', 'pl-live', 'pl-mist', 'ks-toon', 'ks-vol', 'ks-wissel', 'be-los', 'be-achter', 'be-vormen',
    'be-zwart', 'be-nood', 'kp-apparaat', 'kp-cue', 'kp-mix', 'kp-opname', 'ra-hotcue', 'ra-gate', 'ra-backup'];
  const weg = EERDER.filter((id) => !ids.includes(id));
  ok(`de ${EERDER.length} punten van vóór 6 okt bestaan nog${weg.length ? ` (weg: ${weg.join(', ')})` : ''}`, !weg.length);
  // Een vraagcode tussen haakjes in een let-tekst ("(S21)", "(I4, O2)", "(VRAGEN AU2)", "(SVT1)") bestaat in docs/VRAGEN.md.
  const vragen = readFileSync(new URL('../docs/VRAGEN.md', import.meta.url), 'utf8');
  // Ook codes met een volgnummer erachter (de sporen van de werkruimte: S9-1, S10-3, S11-8).
  const vraagcodes = (tekst) => [...tekst.matchAll(/\((?:VRAGEN )?([A-Z]{1,3}\d{1,2}(?:-\d{1,2})?(?:, [A-Z]{1,3}\d{1,2}(?:-\d{1,2})?)*)\)/g)]
    .flatMap((m) => m[1].split(', '));
  // Ook codes van drie letters (de sporen van de secties: SVC1, …): anders liep een onbekende code er stil doorheen.
  ok('vraagcodes: ook drie letters, en een lijst', JSON.stringify(vraagcodes('Klopt het? (SVC1) En (S21, SVC2)')) === '["SVC1","S21","SVC2"]');
  ok('vraagcodes: ook met een volgnummer (S9-1, S10-3)', JSON.stringify(vraagcodes('Goed? (S9-1) En (S10-3, GA7, S11-12)')) === '["S9-1","S10-3","GA7","S11-12"]');
  const codes = [...new Set(punten.flatMap((p) => vraagcodes(p.let)))];
  const onbekend = codes.filter((c) => !new RegExp(`\\*\\*${c}[. ]`).test(vragen));
  ok(`elke vraagcode in de speellijst staat in docs/VRAGEN.md (${codes.length} codes${onbekend.length ? `; onbekend: ${onbekend.join(', ')}` : ''})`,
    codes.length > 0 && !onbekend.length);
  // `citeert` (16 okt, docs/verslagen/2026-10-15/ar-proef.md): de letterlijke teksten van de app die een punt
  // aanhaalt ("audio staat stil (", "opname: weer goed, niets verloren"). Elk stuk staat in de doe of de let (anders
  // citeert het punt niets), en ergens in de code: verandert een melding, dan moet de speellijst mee.
  const codeTekst = (() => {
    const delen = [];
    const loop = (map) => {
      for (const n of readdirSync(new URL(`../${map}/`, import.meta.url), { withFileTypes: true })) {
        const pad = `${map}/${n.name}`;
        if (n.isDirectory()) { if (n.name !== 'vendor' && n.name !== 'node_modules') loop(pad); }
        else if (/\.(m?js|sh|applescript)$/.test(n.name)) delen.push(readFileSync(new URL(`../${pad}`, import.meta.url), 'utf8'));
      }
    };
    for (const map of ['src', 'server', 'tools']) loop(map);
    delen.push(readFileSync(new URL('./node-versie.mjs', import.meta.url), 'utf8'));
    for (const n of readdirSync(new URL('../', import.meta.url))) if (n.endsWith('.html')) delen.push(readFileSync(new URL(`../${n}`, import.meta.url), 'utf8'));
    return delen.join('\n');
  })();
  const citaten = punten.filter((p) => p.citeert);
  const buitenTekst = citaten.flatMap((p) => p.citeert.filter((c) => !`${p.doe}\n${p.let}`.includes(c)).map((c) => `${p.id}: "${c}"`));
  const buitenCode = citaten.flatMap((p) => p.citeert.filter((c) => !codeTekst.includes(c)).map((c) => `${p.id}: "${c}"`));
  ok(`citeert: elk stuk staat in de doe of de let van zijn punt (${citaten.length} punten${buitenTekst.length ? `; niet: ${buitenTekst.join(', ')}` : ''})`,
    citaten.length > 0 && citaten.every((p) => Array.isArray(p.citeert) && p.citeert.length && p.citeert.every((c) => typeof c === 'string' && c.length >= 6)) && !buitenTekst.length);
  ok(`citeert: elk stuk staat letterlijk in de code (src/, server/, tools/, test/node-versie.mjs, de .html-pagina's)${buitenCode.length ? `; niet: ${buitenCode.join(', ')}` : ''}`, !buitenCode.length);
  ok('citeert: de check vangt een tekst die niet in de code staat', !codeTekst.includes('audio staat héél stil (dit staat nergens)'));
}

console.log('\nde opslag (proef/sessie.json)');
{
  const map = mkdtempSync(join(tmpdir(), 'varve-proef-'));
  try {
    const p = new Proef(map);
    const leeg = await p.lees();
    ok('zonder bestand: leeg, niet begonnen', leeg.begonnen === null && Object.keys(leeg.items).length === 0);

    let r = await p.zet('dr-rem', { status: 'fout', notitie: '  klikt aan het eind  ' });
    ok('fout met notitie: 200, notitie zonder witruimte eromheen', r.code === 200 && r.antwoord.item.notitie === 'klikt aan het eind');
    const d = JSON.parse(readFileSync(join(map, 'sessie.json'), 'utf8'));
    ok('op schijf: begonnen gezet, het punt met status, notitie en tijd', d.begonnen && d.items['dr-rem'].status === 'fout'
      && typeof d.items['dr-rem'].tijd === 'string');

    r = await p.zet('dr-rem', { status: 'open', notitie: '' });
    ok('open zonder notitie haalt het punt weg', r.code === 200 && r.antwoord.item === null && !(await p.lees()).items['dr-rem']);
    r = await p.zet('dr-loop', { status: 'open', notitie: 'nog niet geprobeerd, wel een vraag' });
    ok('open MET notitie blijft staan', (await p.lees()).items['dr-loop']?.notitie.startsWith('nog niet'));

    ok('verkeerde status: 400', (await p.zet('x', { status: 'misschien' })).code === 400);
    ok('verkeerd id: 400', (await p.zet('../x', { status: 'ok' })).code === 400 && (await p.zet('', { status: 'ok' })).code === 400);
    ok('notitie geen tekst: 400', (await p.zet('x', { status: 'ok', notitie: 5 })).code === 400);
    ok('notitie te lang: 413', (await p.zet('x', { status: 'ok', notitie: 'a'.repeat(2001) })).code === 413);
    ok(`statussen: ${STATUSSEN.join(', ')}`, STATUSSEN.join() === 'open,ok,fout,overslaan');

    // twintig punten tegelijk (twee tabbladen, snel klikken): niets gaat verloren
    await Promise.all(Array.from({ length: 20 }, (_, i) => p.zet(`p${i}`, { status: 'ok' })));
    const veel = await p.lees();
    ok('twintig tegelijk gezet: alle twintig staan erin', Array.from({ length: 20 }, (_, i) => veel.items[`p${i}`]?.status === 'ok').every(Boolean));
    ok('geen tijdelijke bestanden achtergebleven', !readdirSync(map).some((f) => f.endsWith('.tmp')));

    writeFileSync(join(map, 'sessie.json'), '{ kapot');
    ok('kapot bestand: leeg in plaats van een fout', Object.keys((await p.lees()).items).length === 0);
    await p.zet('a', { status: 'ok' });

    const n = await p.nieuw();
    ok('nieuwe ronde: de oude sessie in archief/', n.gearchiveerd?.startsWith('archief/') && readdirSync(join(map, 'archief')).length === 1);
    const na = await p.lees();
    ok('... en daarna leeg', na.begonnen === null && Object.keys(na.items).length === 0);
    ok('nieuwe ronde op een lege sessie bewaart niets', (await p.nieuw()).gearchiveerd === null && readdirSync(join(map, 'archief')).length === 1);
  } finally { rmSync(map, { recursive: true, force: true }); }
}

console.log('\nhet bericht van de mixer (status-zender.js)');
{
  const snap = {
    focus: 'A', maat: 'B',
    decks: {
      A: { id: 'A', loaded: true, playing: true, title: 'let it all go', bpm: 169.62, toon: { camelot: '2B', kort: 'F#' } },
      B: { id: 'B', loaded: true, playing: false, title: 'zoned out', bpm: null, toon: null },
      C: { id: 'C', loaded: false, playing: false, title: null, bpm: null, toon: null },
    },
  };
  const midi = { supported: true, enabled: true, error: null, input: { name: 'APC40 mkII' }, output: { name: 'APC40 mkII' },
    rx: 12, echoes: 0, verkeerdePoort: false };
  const s = maakStatus({ snap, midi, audio: 'running', auto: true, opname: false, nu: 1000 });
  ok('alleen geladen tracks', s.tracks.map((t) => t.id).join() === 'A,B');
  ok('bpm op één decimaal, toonsoort als "2B F#"', s.tracks[0].bpm === 169.6 && s.tracks[0].toon === '2B F#');
  ok('geen bpm of toon: null', s.tracks[1].bpm === null && s.tracks[1].toon === null);
  ok('APC: invoer, echo-teller en geen verkeerde poort', s.midi.invoer === 'APC40 mkII' && s.midi.echoes === 0 && s.midi.verkeerdePoort === false);
  ok('focus, maat, audio, auto, tijd', s.focus === 'A' && s.maat === 'B' && s.audio === 'running' && s.auto === true && s.t === 1000);
  ok('het bericht is te klonen (BroadcastChannel)', JSON.stringify(structuredClone(s)) === JSON.stringify(s));
  const zonder = maakStatus({ snap: null, midi: null });
  ok('zonder engine en MIDI: lege lijst, midi null', zonder.tracks.length === 0 && zonder.midi === null);
  const fout = maakStatus({ snap, midi: { ...midi, enabled: false, error: new Error('geweigerd'), input: null } });
  ok('een MIDI-fout wordt tekst', fout.midi.fout === 'Error: geweigerd' && fout.midi.invoer === null);

  // beeld (docs/BEELD.md): status() van de BeeldKoppeling, mag ontbreken.
  ok('zonder beeld: beeld null', s.beeld === null && zonder.beeld === null);
  const beeldStatus = { aan: true, adres: 'ws://192.168.1.20:7702/app', latentie: 80, loopt: true, verbonden: true, fout: null,
    beeld: { regime: 'drift', scene: 'golven', fps: 59.7, volgt: true, bpm: 124 }, verstuurd: 120, ontvangen: 9 };
  const mb = maakStatus({ snap, midi, beeld: beeldStatus, nu: 1000 });
  ok('met beeld: { aan, loopt, verbonden, regime, scene, volgt }, zonder adres of tellers',
    JSON.stringify(mb.beeld) === JSON.stringify({ aan: true, loopt: true, verbonden: true, regime: 'drift', scene: 'golven', volgt: true }));
  ok('met beeld: het bericht is nog steeds te klonen', JSON.stringify(structuredClone(mb)) === JSON.stringify(mb));
  const wacht = maakStatus({ snap, midi, beeld: { ...beeldStatus, beeld: null } });
  ok('verbonden zonder beeld-status: regime, scene en volgt null', wacht.beeld.verbonden === true
    && wacht.beeld.regime === null && wacht.beeld.scene === null && wacht.beeld.volgt === null);
  const uit = maakStatus({ snap, midi, beeld: { aan: false, adres: '', latentie: 0, loopt: false, verbonden: false, fout: null, beeld: null } });
  ok('beeld uit: aan, loopt en verbonden false', uit.beeld.aan === false && uit.beeld.loopt === false && uit.beeld.verbonden === false);

  // Voor de companion (docs/COMPANION.md stap 2): positie/duur/rate, eind en tab.
  ok('zonder eind en tab: eind null, tab null', s.eind === null && s.tab === null);
  ok('zonder positie/duur/rate in de snapshot: null', s.tracks[0].positie === null && s.tracks[0].duur === null && s.tracks[0].rate === null);
  const met = maakStatus({ snap: { ...snap, decks: { A: { ...snap.decks.A, position: 600.04, duration: 3600.123, rate: 1.00049 } } }, midi,
    eind: { zwart: false, bevroren: true, master: 7 }, tab: 'tab-x', nu: 1000 });
  ok('positie en duur op 0,1 s, rate op 0,001', met.tracks[0].positie === 600 && met.tracks[0].duur === 3600.1 && met.tracks[0].rate === 1);
  ok('eind: master 7 wordt 1, het bericht blijft te klonen', met.eind.master === 1 && met.eind.bevroren === true && met.tab === 'tab-x'
    && JSON.stringify(structuredClone(met)) === JSON.stringify(met));
  // De grootste melding die de mixer kan sturen: acht tracks met lange titels, een MIDI-fout, beeld en eind.
  const acht = Object.fromEntries('ABCDEFGH'.split('').map((id) => [id, { id, loaded: true, playing: true, title: `${'Een heel lange titel van een album '.repeat(3)}${id}`,
    bpm: 123.456, toon: { camelot: '12B', kort: 'E' }, position: 3599.99, duration: 7200, rate: 1.234 }]));
  const groot = maakStatus({ snap: { focus: 'A', maat: 'A', decks: acht }, midi: { ...midi, enabled: false, error: new Error('x'.repeat(200)) },
    audio: 'running', auto: true, opname: true, beeld: beeldStatus, eind: { zwart: true, bevroren: true, master: 0.5 }, tab: crypto.randomUUID(), nu: Date.now() });
  const bytes = Buffer.byteLength(JSON.stringify(groot));
  ok(`een melding met acht tracks, lange titels, een MIDI-fout en beeld: ${bytes} bytes (grens server 16384)`, bytes < 16 * 1024);
}

console.log('\nbeeld: tegel, statusregel en lampje (beeld-weergave.js)');
{
  const { beeldTegel, beeldStand, beeldBericht } = await import('../src/ui/beeld-weergave.js');
  const basis = { aan: true, adres: 'ws://192.168.1.20:7702/app', latentie: 0, loopt: true, verbonden: false, fout: null, beeld: null };
  const tegel = (s) => beeldTegel(beeldBericht(s));

  ok('tegel: een mixer zonder beeld (oud bericht): uit, "—"', beeldTegel(null).licht === 'uit' && beeldTegel(null).waarde === '—'
    && beeldTegel(undefined).naam === 'Beeld');
  const tUit = tegel({ ...basis, aan: false, loopt: false });
  ok('tegel: uit = grijs (mag ontbreken), geen fout', tUit.licht === 'uit' && tUit.waarde === 'uit'
    && tUit.sub === 'de Stroommachine op de pc (mag ontbreken)');
  const tZoekt = tegel(basis);
  ok('tegel: aan, niet verbonden = half, "zoekt de relay"', tZoekt.licht === 'half' && tZoekt.waarde === 'zoekt de relay');
  const tGeen = tegel({ ...basis, adres: '', loopt: false });
  ok('tegel: aan zonder (geldig) adres = half, "geen adres"', tGeen.licht === 'half' && tGeen.waarde === 'geen adres');
  const tWacht = tegel({ ...basis, verbonden: true });
  ok('tegel: verbonden zonder beeld-status = half, "relay verbonden", wacht op de Stroommachine', tWacht.licht === 'half'
    && tWacht.waarde === 'relay verbonden' && tWacht.sub === 'wacht op de Stroommachine');
  const tVolgt = tegel({ ...basis, verbonden: true, beeld: { regime: 'drift', scene: 'golven', fps: 60, volgt: true, bpm: 124 } });
  ok(`tegel: verbonden met beeld = groen, "volgt de klok", "${tVolgt.sub}"`, tVolgt.licht === 'ok'
    && tVolgt.waarde === 'volgt de klok' && tVolgt.sub === 'drift · golven');
  const tEigen = tegel({ ...basis, verbonden: true, beeld: { regime: '', scene: 'golven', fps: 60, volgt: false, bpm: 0 } });
  ok('tegel: eigen klok = groen, "eigen klok"; een leeg regime valt weg', tEigen.licht === 'ok' && tEigen.waarde === 'eigen klok' && tEigen.sub === 'golven');
  ok('tegel: een bericht van vóór "loopt" (zonder dat veld) zoekt gewoon', beeldTegel({ aan: true, verbonden: false }).waarde === 'zoekt de relay');

  const st = (s, g) => beeldStand(s, g);
  const sUit = st({ ...basis, aan: false });
  ok('regel: uit = "uit", geen lampje (de knop ziet eruit als altijd)', sUit.tekst === 'uit' && sUit.lamp === null);
  ok('regel: aan zonder adres = "geen adres", grijze ring', st({ ...basis, adres: '', loopt: false }).tekst === 'geen adres'
    && st({ ...basis, adres: '', loopt: false }).lamp === 'geen');
  const sWeg = st({ ...basis, adres: '', loopt: false }, 'alleen ws:// of wss://');
  ok('regel: geweigerd adres = de reden, rood lampje als beeld aan staat', sWeg.tekst === 'adres geweigerd: alleen ws:// of wss://'
    && sWeg.soort === 'fout' && sWeg.lamp === 'fout');
  ok('regel: geweigerd adres met beeld uit = de reden, maar geen lampje', st({ ...basis, aan: false }, 'geen geldig adres').lamp === null);
  const sElders = st({ ...basis, loopt: false, elders: true });
  ok('regel: aan in een tweede tabblad = "een ander VARVE-tabblad … stuurt", grijze ring (dit tabblad zendt niet)',
    /ander VARVE-tabblad/.test(sElders.tekst) && sElders.lamp === 'geen');
  const sZoekt = st(basis);
  ok(`regel: "${sZoekt.tekst}", oranje lampje`, sZoekt.tekst === 'zoekt de relay op ws://192.168.1.20:7702/app' && sZoekt.lamp === 'zoekt');
  const sWacht = st({ ...basis, verbonden: true });
  ok('regel: "verbonden, wacht op de Stroommachine", cyaan ring', sWacht.tekst === 'verbonden, wacht op de Stroommachine' && sWacht.lamp === 'verbonden');
  const sVolgt = st({ ...basis, verbonden: true, beeld: { regime: 'drift', scene: 'golven', fps: 60, volgt: true, bpm: 124 } });
  ok(`regel: "${sVolgt.tekst}", cyaan lampje`, sVolgt.tekst === 'verbonden · drift · golven · volgt de klok' && sVolgt.lamp === 'volgt');
  const sEigen = st({ ...basis, verbonden: true, beeld: { regime: 'drift', scene: 'golven', fps: 60, volgt: false, bpm: 0 } });
  ok('regel: eigen klok = "… · eigen klok", cyaan ring (verbonden)', sEigen.tekst === 'verbonden · drift · golven · eigen klok' && sEigen.lamp === 'verbonden');
  ok('regel: een zender die niet startte (fout) = rood', st({ ...basis, fout: 'kapot' }).lamp === 'fout' && /kapot/.test(st({ ...basis, fout: 'kapot' }).tekst));

  // De echte koppeling (src/koppel/beeld.js) met een nep-zender: past status() op deze functies?
  const { BeeldKoppeling } = await import('../src/koppel/beeld.js');
  let opStatus = null;
  const nepZender = { status: { verbonden: false, beeld: null, verstuurd: 0, ontvangen: 0 },
    on: (e, f) => { if (e === 'status') opStatus = f; return () => { opStatus = null; }; }, start() {}, stop() {} };
  const k = new BeeldKoppeling({ engine: {}, ids: [], maakZender: () => nepZender });
  ok('echte koppeling, net gemaakt: uit, geen lampje, tegel uit', beeldStand(k.status()).lamp === null
    && beeldTegel(beeldBericht(k.status())).waarde === 'uit');
  const r = k.zet({ aan: true, adres: 'http://192.168.1.20:7702' });
  ok('echte koppeling, http-adres: geweigerd met een reden, loopt niet', !r.ok && r.reden && !k.loopt
    && beeldStand(k.status(), r.reden).lamp === 'fout');
  k.zet({ adres: 'ws://192.168.1.20:7702/app' });
  ok('echte koppeling, ws-adres: loopt en zoekt', k.loopt && beeldStand(k.status()).lamp === 'zoekt'
    && beeldTegel(beeldBericht(k.status())).waarde === 'zoekt de relay');
  nepZender.status.verbonden = true; opStatus?.();
  ok('echte koppeling, verbonden: wacht op de Stroommachine', beeldStand(k.status()).lamp === 'verbonden'
    && beeldTegel(beeldBericht(k.status())).sub === 'wacht op de Stroommachine');
  nepZender.status.beeld = { regime: 'drift', scene: 'golven', fps: 60, volgt: true, bpm: 124 }; opStatus?.();
  const kStatus = maakStatus({ snap: null, midi: null, beeld: k.status() });
  ok('echte koppeling, beeld-status: volgt de klok, in het bericht en op de tegel', beeldStand(k.status()).lamp === 'volgt'
    && kStatus.beeld.volgt === true && beeldTegel(kStatus.beeld).waarde === 'volgt de klok');
  k.stop();
  ok('echte koppeling, gestopt: loopt niet meer', !k.loopt);
}

console.log('\nde tegel Stems (stems-weergave.js)');
{
  const { stemsTegel } = await import('../src/ui/stems-weergave.js');
  const t = (a) => stemsTegel(a);
  ok('nog niets: uit, "…"', t(null).licht === 'uit' && t(null).waarde === '…' && t(null).naam === 'Stems');
  ok('een server zonder stems (404): onbekend, met uitleg', t({ ontbreekt: true }).waarde === 'onbekend' && /\/api\/stems/.test(t({ ontbreekt: true }).sub));
  const weg = t({ opdrachten: [], beschikbaar: false, reden: 'demucs ontbreekt in ~/.varve/stems-venv' });
  ok('splitter weg: rood, met de reden', weg.licht === 'fout' && weg.waarde === 'splitter ontbreekt' && /demucs ontbreekt/.test(weg.sub));
  ok('splitter weg zonder reden: toch een uitleg', t({ opdrachten: [], beschikbaar: false }).sub.length > 0);
  const druk = t({ beschikbaar: true, opdrachten: [
    { id: 'a', track: 'x', titel: 'een album', aantal: 4, status: 'bezig', voortgang: 0.31 },
    { id: 'b', track: 'y', aantal: 2, status: 'wacht' }, { id: 'c', track: 'z', aantal: 2, status: 'wacht' },
    { id: 'd', track: 'q', aantal: 2, status: 'klaar' }] });
  ok(`wat loopt en wat wacht ("${druk.waarde}", "${druk.sub}")`, druk.licht === 'half' && druk.waarde === '1 bezig, 2 wacht'
    && druk.sub === 'een album · in 4 · 31%');
  ok('alleen wachtend: half, "wacht op de splitter"', /wacht op de splitter/.test(t({ opdrachten: [{ id: 'b', status: 'wacht', aantal: 2 }] }).sub));
  const leeg = t({ opdrachten: [{ id: 'd', status: 'klaar', aantal: 2 }], beschikbaar: true });
  ok('niets open: groen, "splitter klaar"', leeg.licht === 'ok' && leeg.waarde === 'leeg' && leeg.sub === 'splitter klaar');
  const mis = t({ opdrachten: [{ id: 'e', track: 't', titel: 'oud', status: 'fout', fout: 'kapot', klaar: 1 },
    { id: 'f', track: 't2', titel: 'nieuw', status: 'fout', fout: 'geheugen op', klaar: 2 }] });
  ok('de laatste mislukte staat erbij (half)', mis.licht === 'half' && /nieuw \(geheugen op\)/.test(mis.sub));
  ok('de tegel is te klonen zoals de andere (gewone data)', JSON.stringify(structuredClone(druk)) === JSON.stringify(druk));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
