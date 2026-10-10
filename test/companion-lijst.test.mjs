// De companion (companion.html, docs/COMPANION.md) als rekenwerk: config,
// kratkiezer, resttijd, "nu", beeld, rijen van de kaart en de teksten bij
// wens, haal nu en speeldag. Geen DOM, geen server.
// Draai met: node test/companion-lijst.test.mjs
import { readFileSync } from 'node:fs';

const c = await import('../src/companion/companion-lijst.js');
const nacht = await import('../server/nacht.js');
const { schrijfKaart, NUMMERS, kratten: nepKratten } = await import('./nep-kaart.mjs');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

/** Een nep-opslag zoals localStorage; `gooit` = elke aanroep gooit (privévenster). */
function opslag({ gooit = false } = {}) {
  const m = new Map();
  return {
    getItem: (k) => { if (gooit) throw new Error('geen opslag'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (gooit) throw new Error('geen opslag'); m.set(k, String(v)); },
    m,
  };
}

console.log('leesConfig (mappings/companion.json)');
{
  const echt = c.leesConfig(JSON.parse(readFileSync(new URL('../mappings/companion.json', import.meta.url), 'utf8')));
  ok('het bestand in mappings/ leest zonder fouten: drie tabs, proefkrat bovenaan',
    echt.fouten.length === 0 && echt.config.tabs.join() === 'nu,kaart,beeld' && echt.config.kaart.kratten_bovenaan[0] === 'slim:proefkrat');
  const leeg = c.leesConfig(null);
  ok('null: de standaard, zonder fout', leeg.fouten.length === 0 && leeg.config.tabs.length === 3 && leeg.config.kaart.kratten_bovenaan.length === 0);
  ok('een lijst of een getal: standaard, met een fout', c.leesConfig([1]).fouten.length === 1 && c.leesConfig(7).fouten.length === 1);
  const raar = c.leesConfig({ tabs: ['kaart', 'meters', 'kaart'], kaart: { kratten_bovenaan: ['slim:vertrouwd', 3, '', 'slim:vertrouwd'] } });
  ok('onbekende tab valt weg (met fout), dubbel één keer', raar.config.tabs.join() === 'kaart' && raar.fouten.some((f) => /meters/.test(f)));
  ok('kratten_bovenaan: alleen teksten, elk één keer; een getal en een lege tekst zijn een fout',
    raar.config.kaart.kratten_bovenaan.join() === 'slim:vertrouwd' && raar.fouten.filter((f) => /geen krat-id/.test(f)).length === 2);
  ok('geen enkele bekende tab: alle drie (en een fout)', c.leesConfig({ tabs: ['x'] }).config.tabs.length === 3);
  ok('tabs en kratten_bovenaan als verkeerd type: fout, rest blijft', c.leesConfig({ tabs: 'nu', kaart: { kratten_bovenaan: 'slim:x' } }).fouten.length === 2);
}

console.log('\nonthouden op dit apparaat');
{
  const o = opslag();
  ok('zonder iets bewaard: tab nu', c.leesTab(o) === 'nu');
  c.bewaarTab(o, 'kaart');
  ok('tab bewaard en terug', c.leesTab(o) === 'kaart');
  c.bewaarTab(o, 'meters');
  ok('een onbekende tab wordt niet bewaard', c.leesTab(o) === 'kaart');
  ok('bewaarde tab die niet in de config staat: de eerste van de config', c.leesTab(o, ['beeld']) === 'beeld');
  const stuk = opslag({ gooit: true });
  ok('opslag die gooit: lezen en schrijven gooien niet', c.leesTab(stuk) === 'nu' && (c.bewaarTab(stuk, 'kaart'), true)
    && c.leesPins(stuk).length === 0 && c.wisselPin(stuk, [], 'slim:x').join() === 'slim:x');
  let pins = c.wisselPin(o, c.leesPins(o), 'pl:PLnachtwerk');
  pins = c.wisselPin(o, pins, 'slim:vergeten');
  ok('ster: nieuwste eerst, bewaard', c.leesPins(o).join() === 'slim:vergeten,pl:PLnachtwerk');
  pins = c.wisselPin(o, pins, 'pl:PLnachtwerk');
  ok('nog eens: weer weg', c.leesPins(o).join() === 'slim:vergeten');
  o.setItem(c.PIN_SLEUTEL, '{kapot');
  ok('kapotte opslag: geen pins', c.leesPins(o).length === 0);
}

console.log('\nde kratkiezer');
{
  const kr = nepKratten(NUMMERS).map((k) => ({ id: k.id, naam: k.naam, soort: k.soort, aantal: k.sleutels.length, binnen: 0 }));
  const html = c.kratOptiesCompanionHtml(kr, '', 12, { config: ['slim:proefkrat', 'slim:eigen-keuze', 'slim:vertrouwd', 'slim:bestaat-niet'] });
  const groepen = [...html.matchAll(/<optgroup label="([^"]+)">/g)].map((m) => m[1]);
  ok(`groepen: ${groepen.join(' · ')}`, groepen.join() === 'bovenaan,slimme kratten,playlists');
  const waarden = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  ok('eerst "hele kaart", dan proefkrat, eigen keuze, vertrouwd', waarden.slice(0, 4).join() === ',slim:proefkrat,slim:eigen-keuze,slim:vertrouwd');
  ok('een onbekende krat wordt overgeslagen', !html.includes('bestaat-niet'));
  ok('elke krat precies één keer', waarden.length === new Set(waarden).size && waarden.length === kr.length + 1);
  const metPin = c.kratOptiesCompanionHtml(kr, 'pl:PLnachtwerk', 12, { pins: ['pl:PLnachtwerk'], config: ['slim:proefkrat'] });
  const w2 = [...metPin.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  ok('vastgepind gaat vóór de config, met een ster, en blijft gekozen', w2[1] === 'pl:PLnachtwerk' && w2[2] === 'slim:proefkrat'
    && /<option value="pl:PLnachtwerk" selected>★ Nachtwerk/.test(metPin));
  ok('niets bovenaan: precies de gewone kiezer', c.kratOptiesCompanionHtml(kr, '', 12) === (await import('../src/ui/kaart-lijst.js')).kratOptiesHtml(kr, '', 12));
  ok('een krat met een rare naam wordt ontsnapt', c.kratOptiesCompanionHtml([{ id: 'slim:x', naam: '<i>x</i>', soort: 'slim', aantal: 1 }], '', 1, { config: ['slim:x'] }).includes('&lt;i&gt;x'));
}

console.log('\nresttijd en versheid');
{
  const t = { speelt: true, positie: 600, duur: 3600, rate: 1 };
  ok('versheid 0 / 4999 / 5000 / null', c.versheid(0) === 'vers' && c.versheid(4999) === 'vers' && c.versheid(5000) === 'oud' && c.versheid(null) === 'geen');
  ok(`600 van 3600, melding 2000 ms oud: "${c.restTekst(t, 2000)}"`, c.restTekst(t, 2000) === '≈ nog 49:58');
  ok(`... 500 ms oud: "${c.restTekst(t, 500)}" (2999,5 naar beneden)`, c.restTekst(t, 500) === 'nog 49:59');
  ok('precies 1500 ms: nog geen ≈', c.restTekst(t, 1500) === 'nog 49:58');
  ok(`rate 1,05 rekent mee: "${c.restTekst({ ...t, rate: 1.05 }, 0)}"`, c.restTekst({ ...t, rate: 1.05 }, 0) === `nog ${Math.floor(3000 / 1.05 / 60)}:${String(Math.floor((3000 / 1.05) % 60)).padStart(2, '0')}`);
  ok('niet spelend: null', c.restTekst({ ...t, speelt: false }, 0) === null);
  ok('zonder positie (mixer van vóór stap 2): null', c.restTekst({ speelt: true, duur: 3600, rate: 1 }, 0) === null);
  ok('rate 0 of duur 0: null', c.restTekst({ ...t, rate: 0 }, 0) === null && c.restTekst({ ...t, duur: 0 }, 0) === null);
  ok('voorbij het eind: nog 0:00, nooit negatief', c.restTekst({ ...t, positie: 3599 }, 9000) === '≈ nog 0:00');
  ok('leeftijd null telt als 0', c.restTekst(t, null) === 'nog 50:00');
}

console.log('\n"nu" (GET /api/mixer)');
{
  const ACHT = 'ABCDEFGH'.split('').map((id, i) => ({ id, titel: i === 1 ? '<b>vet</b>' : `Nummer ${id}`, speelt: i === 0, bpm: 124.5, toon: '8A Am',
    positie: 600, duur: 3600, rate: 1 }));
  const melding = { t: 1, audio: 'running', midi: { invoer: 'APC40 mkII' }, tracks: ACHT, focus: 'A', opname: true, auto: false };
  const vers = c.nuHtml({ leeftijd_ms: 300, twee: false, melding, speelt: true });
  ok('acht tracks A–H: acht rijen', (vers.match(/<li class="nu-track/g) || []).length === 8 && /data-track="H"/.test(vers));
  ok('een titel met <b> wordt ontsnapt', vers.includes('&lt;b&gt;vet&lt;/b&gt;') && !vers.includes('<b>vet</b>'));
  ok('A speelt met resttijd, focus gemarkeerd; B staat stil zonder resttijd',
    /class="nu-track speelt focus" data-track="A"[\s\S]*?nog 49:59/.test(vers) && /data-track="B"[^]*?❚❚<\/span><span class="nu-rest"><\/span>/.test(vers));
  ok('bpm met komma en toon', vers.includes('124,5 bpm · 8A Am'));
  ok('onderregel: audio, APC, opname, auto-DJ', /audio aan.*APC: APC40 mkII.*opname loopt.*auto-DJ uit/.test(vers));
  ok('zonder APC: "geen APC"', c.nuHtml({ leeftijd_ms: 10, melding: { ...melding, midi: null } }).includes('geen APC'));
  ok('twee mixers: de rode regel', c.nuHtml({ leeftijd_ms: 10, twee: true, melding }).includes('twee mixers open (localhost en 127.0.0.1?)'));
  const oud = c.nuHtml({ leeftijd_ms: 7000, twee: false, melding });
  ok('oud: "meldt zich niet", de laatste stand grijs en de resttijd als schatting',
    oud.includes('mixer meldt zich niet (op de achtergrond?)') && oud.includes('nu-tracks grijs') && oud.includes('≈ nog'));
  ok('geen melding: "nog niet gemeld"', c.nuHtml({ leeftijd_ms: null, twee: false, melding: null }).includes('de mixer heeft zich nog niet gemeld'));
  ok('404: "kent /api/mixer nog niet"', c.nuHtml({ ontbreekt: true }).includes('deze server kent /api/mixer nog niet'));
  ok('server weg: "niet bereikbaar"', c.nuHtml(null).includes('server niet bereikbaar'));
  ok('500: "de server gaf een fout (500)"', c.nuHtml({ fout: 500 }).includes('de server gaf een fout (500)'));
  ok('geen track geladen', c.nuHtml({ leeftijd_ms: 10, melding: { ...melding, tracks: [] } }).includes('geen track geladen'));
}

console.log('\nbeeld (alleen tonen)');
{
  const zonder = c.beeldHtml(null);
  ok('zonder stand: "nog geen beeldstand" en de pc-beamer-zin', zonder.includes('nog geen beeldstand') && zonder.includes(c.BEELD_ZIN));
  const met = c.beeldHtml({ zwart: false, bevroren: true, master: 0.8 });
  ok('met stand: BEVRIES aan, ZWART uit, MASTER 80 %, en de zin', /BEVRIES<\/b><span>aan/.test(met) && /ZWART<\/b><span>uit/.test(met) && met.includes('80 %') && met.includes(c.BEELD_ZIN));
  ok('master buiten 0..1 wordt geklemd, geen getal = —', c.beeldHtml({ master: 7 }).includes('100 %') && c.beeldHtml({ master: 'x' }).includes('—'));
  ok('de zin noemt de pc-beamer en de APC', /beamer van de pc volgt dit niet/.test(c.BEELD_ZIN) && /APC mapje beeld/.test(c.BEELD_ZIN));
}

console.log('\nrijen van de kaart');
{
  const rij = (over) => ({ sleutel: 'yt:abc', youtube_id: 'abc', artiest: 'Artiest', titel: 'Titel', duur: 240, binnen: null, wens: null, playlists: [], ...over });
  const kand = [{ youtube_id: 'k1', titel: 'Kandidaat 1', kanaal: 'X', duur: 200, score: 0.95 }, { youtube_id: 'k2', titel: 'Twee', score: 0.4 }];
  const html = {
    binnen: c.rijHtml(rij({ binnen: 'abc' })),
    kandidaat: c.rijHtml(rij({})),
    geenVideo: c.rijHtml(rij({ sleutel: 'sp:x', youtube_id: null })),
    wacht: c.rijHtml(rij({ wens: { status: 'wacht' } })),
    mislukt: c.rijHtml(rij({ wens: { status: 'mislukt', fout: 'HTTP 403' } })),
    kies: c.rijHtml(rij({ wens: { status: 'kies' } }), { kandidaten: kand }),
    kiesOpen: c.rijHtml(rij({ wens: { status: 'kies' } }), { kandidaten: kand, open: true }),
    kiesZonder: c.rijHtml(rij({ wens: { status: 'kies' } }), { kandidaten: null }),
  };
  const knoppen = (h) => (h.match(/<button/g) || []).length;
  ok('binnen: geen knop, label "binnen"', knoppen(html.binnen) === 0 && html.binnen.includes('>binnen<'));
  ok('kandidaat: knop wens', /data-wens="yt:abc"[^>]*>wens</.test(html.kandidaat) && knoppen(html.kandidaat) === 1);
  ok('geen video (Spotify): ook wens', /data-wens="sp:x"/.test(html.geenVideo));
  ok('wacht: geen knop (geen intrekken)', knoppen(html.wacht) === 0 && html.wacht.includes('>wacht<') && !html.wacht.includes('data-weg'));
  ok('mislukt: label met de fout als uitleg, geen knop', knoppen(html.mislukt) === 0 && html.mislukt.includes('title="HTTP 403"'));
  ok('kies met kandidaten: knop kies (dicht)', /data-kies-open="yt:abc" aria-expanded="false"/.test(html.kies) && !html.kies.includes('data-kies="k1"'));
  ok('kies open: de kandidaten als knoppen', html.kiesOpen.includes('data-kies="k1"') && html.kiesOpen.includes('data-kies="k2"') && html.kiesOpen.includes('aria-expanded="true"'));
  ok('kies zonder kandidaten: "kies op de laptop", geen knop', knoppen(html.kiesZonder) === 0 && html.kiesZonder.includes('kies op de laptop'));
  ok('bezig: de knop staat uit', /disabled>…</.test(c.rijHtml(rij({}), { bezig: true })));
  const alles = Object.values(html).join('');
  ok('geen enkele rij kent meteen, bevestig, zoek, haal binnen of weghalen',
    !/meteen|bevestig|data-zoek|data-haal|data-weg|haal binnen/.test(alles));
  ok('titel en artiest worden ontsnapt', c.rijHtml(rij({ titel: '<script>', artiest: '"a"' })).includes('&lt;script&gt;') && c.rijHtml(rij({ artiest: '"a"' })).includes('&quot;a&quot;'));
  ok('alle rijen van de nep-kaart tekenen zonder te gooien', NUMMERS.every((n) => c.rijHtml({ ...n, binnen: null, wens: null }).startsWith('<li')));
}

console.log('\nwens, haal nu en speeldag');
{
  const nu10 = new Date(2026, 9, 10, 15, 0);      // za 10 okt 15:00 (lokaal)
  const nu11ochtend = new Date(2026, 9, 11, 9, 0);
  const nu11middag = new Date(2026, 9, 11, 13, 0);
  const n = (over) => ({ aan: false, venster: { van: '01:00', tot: '07:00' }, speeldagen: ['2026-10-10'], bezig: null, nu: nu10.toISOString(), ...over });
  ok('datumVan en nachtDatum zijn die van de server (vier momenten)',
    [nu10, nu11ochtend, nu11middag, new Date(2026, 11, 31, 23, 59)].every((d) => c.datumVan(d) === nacht.datumVan(d) && c.nachtDatum(d) === nacht.nachtDatum(d)));
  ok('speeldag op de dag zelf', c.isSpeeldag(n({})) === true);
  ok('de ochtend erna nog speeldag (de nacht hoort bij gisteren), de middag niet',
    c.isSpeeldag(n({ nu: nu11ochtend.toISOString() })) && !c.isSpeeldag(n({ nu: nu11middag.toISOString() })));
  ok('zonder nu van de server: de klok van hier', c.isSpeeldag({ speeldagen: [c.datumVan(new Date())] }) === true);
  const uit = { ok: true, toegevoegd: ['yt:a'], geweigerd: [] };
  ok(`wens op een speeldag: "${c.wensGevolgTekst(uit, n({})).tekst}"`, c.wensGevolgTekst(uit, n({})).tekst === '1 op de wenslijst · vandaag speeldag: niet vóór morgen');
  ok('nacht aan, geen speeldag: de nacht haalt hem binnen (venster)',
    c.wensGevolgTekst(uit, n({ aan: true, speeldagen: [] })).tekst === '1 op de wenslijst · de nacht haalt hem binnen (01:00–07:00)');
  ok('nacht uit: "haal nu, of op de laptop"', c.wensGevolgTekst(uit, n({ speeldagen: [] })).tekst === '1 op de wenslijst · nacht staat uit: haal nu, of op de laptop');
  const geweigerd = c.wensGevolgTekst({ ok: true, toegevoegd: [], geweigerd: [{ sleutel: 'yt:a', reden: 'al binnen' }] }, n({}));
  ok('geweigerd: alleen de reden, niet goed', geweigerd.tekst === '1 geweigerd: al binnen' && geweigerd.goed === false);
  ok('haal nu op een speeldag: kan niet, met de reden', c.haalNuKnop(3, n({})).kan === false && /speeldag/.test(c.haalNuKnop(3, n({})).tekst));
  ok('er loopt al een run', c.haalNuKnop(3, n({ speeldagen: [], bezig: { id: 1 } })).tekst === 'haal nu: er loopt al een run');
  ok('niets te halen', c.haalNuKnop(0, n({ speeldagen: [] })).tekst === 'haal nu: niets te halen');
  ok('drie wachten: "haal de wenslijst nu op (3)"', c.haalNuKnop(3, n({ speeldagen: [] })).tekst === 'haal de wenslijst nu op (3)' && c.haalNuKnop(3, n({ speeldagen: [] })).aantal === 3);
  ok(`klemt op ${c.HAAL_MAX}`, c.haalNuKnop(57, n({ speeldagen: [] })).aantal === 20 && c.haalNuKnop(57, n({ speeldagen: [] })).tekst.endsWith('(20)'));
  ok('wachtAantal telt alleen wacht', c.wachtAantal([{ status: 'wacht' }, { status: 'kies' }, { status: 'wacht' }, { status: 'klaar' }]) === 2);
  ok('speeldag-knop: weg als vandaag er al in staat', c.speeldagKnopTekst(n({})) === null);
  ok('... en "vandaag speeldag" als niet', c.speeldagKnopTekst(n({ speeldagen: ['2026-10-03'] })) === 'vandaag speeldag');
  ok('zonder nacht-stand: geen knop', c.speeldagKnopTekst(null) === null);
  const body = c.speeldagErbij(n({ speeldagen: ['2026-10-17', '2026-10-03'], nu: nu11middag.toISOString() }));
  ok(`alleen toevoegen, gesorteerd: ${body.speeldagen.join(', ')}`, body.speeldagen.join() === '2026-10-03,2026-10-11,2026-10-17');
  ok('vandaag die er al in staat: niet dubbel', c.speeldagErbij(n({})).speeldagen.join() === '2026-10-10');
  const km = c.kandidatenPerSleutel([{ sleutel: 'a', status: 'kies', kandidaten: [{ youtube_id: 'x' }] }, { sleutel: 'b', status: 'wacht', kandidaten: [{ youtube_id: 'y' }] }, { sleutel: 'c', status: 'kies', kandidaten: [] }]);
  ok('kandidaten alleen van wensen die op kies staan', km.size === 1 && km.get('a')[0].youtube_id === 'x');
}

console.log('\nde lijst volgt de wenslijst (de laptop zocht, de nacht haalde)');
{
  const r = (sleutel, wens = null, over = {}) => ({ sleutel, titel: sleutel, artiest: 'x', youtube_id: null, binnen: null, wens, ...over });
  const rijen = [r('sp:a', { status: 'wacht', fout: null, youtube_id: null }), r('yt:b'), r('yt:c', { status: 'wacht', fout: null, youtube_id: 'c' }), r('yt:d')];
  const wensen = [
    { sleutel: 'sp:a', status: 'kies', fout: null, youtube_id: null, kandidaten: [{ youtube_id: 'k1' }] },   // de laptop zocht
    { sleutel: 'yt:c', status: 'wacht', fout: null, youtube_id: 'c' },                                        // onveranderd
    { sleutel: 'yt:x', status: 'wacht', fout: null, youtube_id: 'x' },                                        // staat niet in de lijst
  ];
  const { rijen: nieuw, veranderd } = c.pasWensenToe(rijen, wensen);
  ok(`alleen wat echt anders is: ${veranderd.join(', ')}`, veranderd.join() === 'sp:a');
  ok('sp:a staat nu op kies (en de rij toont kies met de kandidaten)', nieuw[0].wens.status === 'kies'
    && /data-kies-open="sp:a"/.test(c.rijHtml(nieuw[0], { kandidaten: c.kandidatenPerSleutel(wensen).get('sp:a') })));
  ok('onveranderde rijen blijven hetzelfde object (geen hertekening)', nieuw[1] === rijen[1] && nieuw[2] === rijen[2] && nieuw[3] === rijen[3]);
  ok('de oude rij is niet aangeraakt', rijen[0].wens.status === 'wacht');
  const weg = c.pasWensenToe(rijen, []);
  ok('een wens die weg is (op de laptop ingetrokken): null, rij weer kandidaat/geen video', weg.veranderd.join() === 'sp:a,yt:c'
    && weg.rijen[0].wens === null && weg.rijen[2].wens === null);
  const fout = c.pasWensenToe([rijen[2]], [{ sleutel: 'yt:c', status: 'mislukt', fout: 'HTTP 403', youtube_id: 'c' }]);
  ok('mislukt met een fout: veranderd, de fout staat in de rij', fout.veranderd.length === 1 && /HTTP 403/.test(c.rijHtml(fout.rijen[0])));
  ok('leeg en rommel: gooit niet', c.pasWensenToe().rijen.length === 0 && c.pasWensenToe([r('a')], [null, {}]).veranderd.length === 0);
}

console.log('\nconstanten');
{
  ok('peilen 1 s, pagina 50, vers 5 s, schatting 1,5 s, haal hooguit 20',
    c.PEIL_MS === 1000 && c.PAGINA === 50 && c.VERS_MS === 5000 && c.SCHATTING_MS === 1500 && c.HAAL_MAX === 20);
  ok('?pagina=5 voor de proef; onzin en buiten 1..50 = 50', c.paginaUitUrl('?pagina=5') === 5 && c.paginaUitUrl('?pagina=0') === 50
    && c.paginaUitUrl('?pagina=999') === 50 && c.paginaUitUrl('') === 50 && c.paginaUitUrl('?pagina=x') === 50);
  ok('de nep-kaart heeft maar twaalf nummers: "meer" vraagt ?pagina in de proef', NUMMERS.length < c.PAGINA && typeof schrijfKaart === 'function');
}

if (fails.length) { console.log(`\n${fails.length} FOUT(EN)`); process.exit(1); }
console.log('\nalles groen');
