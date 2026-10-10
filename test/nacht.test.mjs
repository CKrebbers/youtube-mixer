// De nachtwachtrij (server/nacht.js, docs/KAART.md): de zes regels van het
// contract één voor één, met een nepklok, een nep "er speelt een deck", een
// nep-ingest en een pauze die niet wacht. Geen echte tijd, geen netwerk.
// Draai met: node test/nacht.test.mjs
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { Kaart } = await import('../server/kaart.js');
const { Nacht, STANDAARD, nachtDatum, komendeNacht, inVenster, pasToe, isBlokkade, MAX_OP_EEN_RIJ, datumVan } = await import('../server/nacht.js');
const { schrijfKaart, NUMMERS } = await import('./nep-kaart.mjs');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const map = mkdtempSync(join(tmpdir(), 'varve-nacht-'));
const pad = join(map, 'varve-kaart.json');
schrijfKaart(pad);
const library = { alleIds: () => ['binnen000001'], track: (id) => (id === 'binnen000001' ? { id, titel: 'Archangel' } : null) };

/** Een nacht met alles ingeprikt. `haal` geeft per youtube_id een uitkomst (standaard ok). */
function maak({ nu = new Date(2026, 9, 12, 3, 0), deck = () => false, uitkomst = () => ({ ok: true, track: { id: 'x', titel: 'nep' } }), zoek = null, pad: nachtPad = null, kaartDb = ':memory:' } = {}) {
  const kaart = new Kaart({ pad, db: kaartDb, library, log: () => {} });
  const logs = [], gehaald = [], pauzes = [];
  let klok = nu;
  const nacht = new Nacht({
    pad: nachtPad, kaart, speeltDeck: deck, klok: () => klok, log: (s) => logs.push(s),
    haal: async (w) => { gehaald.push(w.youtube_id); return uitkomst(w, gehaald.length); },
    zoek, wacht: async (ms) => { pauzes.push(ms); }, toeval: () => 0.5,
  });
  return { kaart, nacht, logs, gehaald, pauzes, zet: (d) => { klok = d; } };
}

try {
  // ---- hulpfuncties ---------------------------------------------------------------
  console.log('tijd en venster');
  ok('nachtDatum: 03:00 op 11 okt is de nacht van 10 okt; 15:00 is 11 okt zelf', nachtDatum(new Date(2026, 9, 11, 3, 0)) === '2026-10-10' && nachtDatum(new Date(2026, 9, 11, 15, 0)) === '2026-10-11');
  ok('inVenster 01:00–07:00', inVenster(new Date(2026, 9, 11, 1, 0), STANDAARD.venster) && inVenster(new Date(2026, 9, 11, 6, 59), STANDAARD.venster)
    && !inVenster(new Date(2026, 9, 11, 7, 0), STANDAARD.venster) && !inVenster(new Date(2026, 9, 11, 0, 59), STANDAARD.venster) && !inVenster(new Date(2026, 9, 11, 15, 0), STANDAARD.venster));
  ok('een venster over middernacht (23:00–06:00)', inVenster(new Date(2026, 9, 11, 23, 30), { van: '23:00', tot: '06:00' }) && inVenster(new Date(2026, 9, 11, 2, 0), { van: '23:00', tot: '06:00' })
    && !inVenster(new Date(2026, 9, 11, 12, 0), { van: '23:00', tot: '06:00' }));
  ok('isBlokkade herkent 403 en 429, niet een gewone fout', isBlokkade('HTTP Error 403: Forbidden') && isBlokkade('HTTP Error 429: Too Many Requests') && isBlokkade('Sign in to confirm you’re not a bot')
    && !isBlokkade('download gaf geen bestand') && !isBlokkade('code 1'));
  ok('pasToe weigert onzin', ['aan', 'perNacht', 'venster', 'pauze', 'speeldagen', 'vandaagNiet', 'wat'].every((k) => { try { pasToe(STANDAARD, { [k]: 'onzin' }); return false; } catch { return true; } }));
  ok('pasToe neemt goede waarden', (() => { const n = pasToe(STANDAARD, { aan: true, perNacht: 10, venster: { van: '02:00', tot: '05:30' }, pauze: { min: 1, max: 2 }, speeldagen: ['2026-12-31', '2026-10-10', '2026-10-10'] });
    return n.aan && n.perNacht === 10 && n.venster.tot === '05:30' && n.pauze.max === 2 && n.speeldagen.join() === '2026-10-10,2026-12-31' && STANDAARD.aan === false; })());

  // ---- standaard ------------------------------------------------------------------
  console.log('\nstandaard');
  {
    const { nacht } = maak();
    const s = nacht.stand();
    ok('standaard UIT, 01:00–07:00, 80 per nacht, pauze 20–90, speeldag 2026-10-10, standaardvolgorde aan', s.aan === false && s.venster.van === '01:00' && s.venster.tot === '07:00'
      && s.perNacht === 80 && s.pauze.min === 20 && s.pauze.max === 90 && s.speeldagen.join() === '2026-10-10' && s.standaardVolgorde === true && s.vandaagNiet === false
      && s.laatsteRun === null && s.volgende === null && s.bezig === null);
    ok('uit: peilen doet niets', nacht.peil() === 'staat uit' && nacht.magNu() === 'staat uit');
  }

  // ---- regel 1 ---------------------------------------------------------------------
  console.log('\nregel 1: alleen in het venster, alleen aan, nooit op een speeldag of "vandaag niet"');
  {
    const { nacht, zet } = maak({ nu: new Date(2026, 9, 12, 3, 0) });   // nacht van 11 okt, 03:00
    nacht.zet({ aan: true });
    ok('aan, in het venster, geen speeldag: mag', nacht.magNu() === null);
    zet(new Date(2026, 9, 12, 7, 0));
    ok('07:00: buiten het venster', /buiten het venster/.test(nacht.magNu()));
    zet(new Date(2026, 9, 12, 0, 30));
    ok('00:30: nog buiten; volgende = 01:00 vandaag', /buiten het venster/.test(nacht.magNu()) && nacht.volgende() === new Date(2026, 9, 12, 1, 0).toISOString());
    zet(new Date(2026, 9, 11, 3, 0));   // 03:00 op 11 okt = de nacht van de proefavond
    ok('de nacht NA de speeldag (03:00 op 11 okt) is ook een speeldag', /speeldag \(2026-10-10\)/.test(nacht.magNu()));
    zet(new Date(2026, 9, 10, 15, 0));
    ok('op de speeldag zelf, buiten het venster: speeldag gaat voor', /speeldag/.test(nacht.magNu()));
    zet(new Date(2026, 9, 12, 3, 0));
    nacht.zet({ vandaagNiet: true });
    ok('vandaag niet (gezet om 03:00): geldt voor deze nacht', nacht.magNu() === 'vandaag niet' && nacht.stand().vandaagNiet === true);
    zet(new Date(2026, 9, 12, 22, 0));
    ok('en de avond erna is het een andere nacht: vandaagNiet is weer false', nacht.stand().vandaagNiet === false);
    nacht.zet({ vandaagNiet: true });
    zet(new Date(2026, 9, 13, 2, 0));
    ok('om 22:00 gezet geldt het voor de nacht die komt (02:00)', nacht.magNu() === 'vandaag niet');
    nacht.zet({ vandaagNiet: false });
    ok('en uitzetten', nacht.magNu() === null && nacht.stand().vandaagNiet === false);
    nacht.zet({ speeldagen: ['2026-10-12'] });
    ok('speeldagen instellen: 02:00 op 13 okt = nacht van 12 okt = speeldag', /speeldag/.test(nacht.magNu()));
    zet(new Date(2026, 9, 14, 2, 0));
    ok('een nacht later mag weer', nacht.magNu() === null);
    ok('volgende: nu (in het venster)', nacht.volgende() === new Date(2026, 9, 14, 2, 0).toISOString());
    nacht.zet({ aan: false });
    ok('uit: volgende null', nacht.volgende() === null && nacht.magNu() === 'staat uit');
    ok('zet: een verkeerde waarde gooit, de stand blijft', (() => { try { nacht.zet({ perNacht: 0 }); return false; } catch (e) { return /perNacht/.test(e.message) && nacht.stand().perNacht === 80; } })());
  }

  // "vandaag niet" geldt voor de KOMENDE nacht, ook 's ochtends gezet (review standen, 10 okt):
  // vóór 12:00 is nachtDatum de nacht die net voorbij is; komendeNacht de volgende.
  console.log('\n"vandaag niet" geldt voor de komende nacht, hoe laat je het ook zet');
  {
    const V = STANDAARD.venster;
    ok('komendeNacht 01:00–07:00: 10:00 en 14:00 en 23:00 op 17 okt = 17 okt', ['10', '14', '23'].every((u) => komendeNacht(new Date(2026, 9, 17, Number(u), 0), V) === '2026-10-17'));
    ok('… 03:00 op 18 okt (in het venster) = 17 okt; 00:30 op 18 okt = 17 okt; 07:30 op 18 okt = 18 okt',
      komendeNacht(new Date(2026, 9, 18, 3, 0), V) === '2026-10-17' && komendeNacht(new Date(2026, 9, 18, 0, 30), V) === '2026-10-17' && komendeNacht(new Date(2026, 9, 18, 7, 30), V) === '2026-10-18');
    ok('… venster over middernacht (23:00–06:00): 22:00 op 17 = 17, 05:00 op 18 = 17, 08:00 op 18 = 18',
      komendeNacht(new Date(2026, 9, 17, 22, 0), { van: '23:00', tot: '06:00' }) === '2026-10-17' && komendeNacht(new Date(2026, 9, 18, 5, 0), { van: '23:00', tot: '06:00' }) === '2026-10-17'
      && komendeNacht(new Date(2026, 9, 18, 8, 0), { van: '23:00', tot: '06:00' }) === '2026-10-18');
    for (const [uur, wanneer] of [[10, 17], [14, 17], [23, 17], [3, 18]]) {
      const { nacht, zet } = maak({ nu: new Date(2026, 9, wanneer, uur, 0) });
      nacht.zet({ aan: true });
      nacht.zet({ vandaagNiet: true });   // wat een stand met nacht.vannacht: false doet, en de knop "vandaag niet"
      const toen = nacht.stand().vandaagNiet;
      zet(new Date(2026, 9, 18, wanneer === 18 ? 4 : 2, 0));   // midden in de nacht van 17 op 18 okt
      ok(`gezet op ${wanneer} okt ${String(uur).padStart(2, '0')}:00: de stand zegt "vandaag niet" (${toen}) en de nacht van 17 op 18 okt remt (${nacht.magNu()})`,
        toen === true && nacht.magNu() === 'vandaag niet');
      zet(new Date(2026, 9, 19, 2, 0));
      ok(`… en de nacht daarna (18 op 19 okt) mag weer (${nacht.magNu()})`, nacht.magNu() === null);
    }
    const { nacht, zet } = maak({ nu: new Date(2026, 9, 17, 22, 0) });
    nacht.zet({ aan: true, vandaagNiet: true });
    zet(new Date(2026, 9, 18, 9, 0));
    ok('de ochtend erna (09:00): de rem van de afgelopen nacht telt niet meer, de knop staat weer uit', nacht.stand().vandaagNiet === false);
    nacht.zet({ vandaagNiet: true });
    ok('… en nu "vandaag niet" = de nacht van 18 op 19 okt', nacht.instellingen.vandaagNietDatum === '2026-10-18' && nacht.vandaagNiet === true);
  }

  // ---- regel 2 ---------------------------------------------------------------------
  console.log('\nregel 2: eerst de wensen (oudste eerst), dan de standaardvolgorde');
  {
    const { nacht, kaart, gehaald } = maak({ nu: new Date(2026, 9, 12, 3, 0) });
    kaart.voegWensen(['yt:eigenlike001']);
    kaart.voegWensen(['yt:telang000001']);   // te lang, maar een WENS mag
    ok('volgendeItem: de oudste wens', nacht.volgendeItem().sleutel === 'yt:eigenlike001' && nacht.volgendeItem().bron === 'wens');
    const r = await nacht.run({ aantal: 4, soort: 'nu' });
    ok(`run van 4: ${gehaald.join(' ')}`, gehaald.join() === 'eigenlike001,telang000001,fourtet0baby,vergeten0001' && r.gehaald === 4 && r.mislukt === 0 && /klaar: 4/.test(r.reden));
    ok('de wensen staan op klaar met hun track', kaart.wens('yt:eigenlike001').status === 'klaar' && kaart.wens('yt:telang000001').status === 'klaar' && kaart.wens('yt:eigenlike001').track_id === 'x');
    ok('wat de standaardvolgorde pakte heeft nu een wens-rij met bron nacht', kaart.wens('yt:fourtet0baby')?.bron === 'nacht' && kaart.wens('yt:fourtet0baby').status === 'klaar');
    ok('in /api/kaart/wensen te zien', kaart.wensen().length === 4);
    const r2 = await nacht.run({ aantal: 10, soort: 'nu' });
    ok(`de volgende run gaat verder waar hij was (${gehaald.slice(4).join(' ')}) en stopt als er niets meer is`, gehaald.slice(4).join() === 'vertrouwd002,eigenlike002' && r2.reden === 'niets meer te halen' && r2.gehaald === 2);
    ok('nooit twijfel, set, te lang (zonder wens), overzet, binnen, Spotify', !gehaald.some((id) => ['twijfel00001', 'eenset000001', 'overzet00001', 'binnen000001'].includes(id)) && gehaald.filter((x) => x === 'telang000001').length === 1);
    nacht.zet({ standaardVolgorde: false });
    kaart.verwijderWens('yt:eigenlike002');
    const r3 = await nacht.run({ aantal: 5, soort: 'nu' });
    ok('standaardVolgorde uit: alleen wensen (niets = meteen klaar)', r3.gehaald === 0 && r3.reden === 'niets meer te halen');
  }

  // ---- regel 3 ---------------------------------------------------------------------
  console.log('\nregel 3: één tegelijk, pauze min–max tussen twee nummers');
  {
    let tegelijk = 0, max = 0;
    const { nacht, pauzes } = maak({ uitkomst: async () => { tegelijk++; max = Math.max(max, tegelijk); await new Promise((z) => setTimeout(z, 5)); tegelijk--; return { ok: true, track: { id: 'x' } }; } });
    nacht.zet({ pauze: { min: 20, max: 90 } });
    const r = await nacht.run({ aantal: 3, soort: 'nu' });
    ok(`drie gehaald, nooit twee tegelijk (${max})`, r.gehaald === 3 && max === 1);
    ok(`twee pauzes (tussen, niet erna) van 55 s bij toeval 0,5 (${pauzes.join(',')})`, pauzes.length === 2 && pauzes.every((p) => p === 55000));
    const { nacht: n2, pauzes: p2 } = maak();
    n2.zet({ pauze: { min: 0, max: 0 } });
    await n2.run({ aantal: 2, soort: 'nu' });
    ok('pauze 0–0 = geen wachttijd', p2.join() === '0');
    ok('run geeft dezelfde promise terwijl hij loopt', (() => { const { nacht: n3 } = maak(); const a = n3.run({ aantal: 1, soort: 'nu' }); const b = n3.run({ aantal: 1, soort: 'nu' }); return a === b; })());
  }

  // ---- regel 4 ---------------------------------------------------------------------
  console.log('\nregel 4: stopt meteen als er een deck gaat spelen; verder de volgende nacht');
  {
    let speelt = false;
    const { nacht, gehaald, kaart } = maak({ deck: () => speelt, uitkomst: (w, n) => { if (n === 2) speelt = true; return { ok: true, track: { id: w.youtube_id } }; } });
    const r = await nacht.run({ aantal: 10, soort: 'nu' });
    ok(`na het tweede nummer gaat een deck spelen: stop na dat nummer (${gehaald.length} gehaald, "${r.reden}")`, gehaald.length === 2 && r.reden === 'er speelt een deck' && r.gehaald === 2);
    ok('het lopende nummer is netjes afgerond (klaar), niets half', kaart.wens('yt:vergeten0001').status === 'klaar' && !kaart.wensen().some((w) => w.status === 'bezig'));
    ok('gelogd in nacht_runs met de reden', kaart.laatsteRun().reden === 'er speelt een deck' && kaart.laatsteRun().gehaald === 2);
    ok('een deck speelt vooraf: nu() weigert met 409', (() => { try { nacht.nu({ aantal: 1 }); return false; } catch (e) { return e.code === 409 && e.message === 'er speelt een deck'; } })());
    speelt = true;
    nacht.zet({ aan: true, speeldagen: [] });
    ok('peilen terwijl een deck speelt: geen run', nacht.peil() === 'er speelt een deck' && nacht.stand().bezig === null);
    speelt = false;
    ok('en zonder deck begint hij (en deze nacht niet nog eens)', nacht.peil() === null && nacht.stand().bezig !== null && nacht.stand().bezig.soort === 'nacht');
    await nacht._run;
    ok('deze nacht al gedaan: peilen zegt dat', nacht.peil() === 'deze nacht al gedaan' && /deze nacht al gedaan/.test(nacht.magNu()));
  }

  // ---- regel 5 ---------------------------------------------------------------------
  console.log('\nregel 5: 403/429 of drie mislukkingen op rij = stop met reden');
  {
    const { nacht, gehaald, kaart } = maak({ uitkomst: (w, n) => (n === 2 ? { ok: false, fout: 'HTTP Error 403: Forbidden — yt-dlp is 2026.8.19' } : { ok: true, track: { id: w.youtube_id } }) });
    const r = await nacht.run({ aantal: 10, soort: 'nu' });
    ok(`403: stop meteen (${gehaald.length} geprobeerd, "${r.reden}")`, gehaald.length === 2 && /geblokkeerd/.test(r.reden) && /403/.test(r.reden) && r.mislukt === 1 && r.gehaald === 1);
    ok('de wens staat op mislukt met de fout', kaart.wens('yt:vergeten0001').status === 'mislukt' && /403/.test(kaart.wens('yt:vergeten0001').fout));
    const r429 = await maak({ uitkomst: () => ({ ok: false, fout: 'HTTP Error 429: Too Many Requests' }) }).nacht.run({ aantal: 10, soort: 'nu' });
    ok('429: idem', /geblokkeerd/.test(r429.reden) && r429.mislukt === 1);
    const { nacht: n3, gehaald: g3 } = maak({ uitkomst: () => ({ ok: false, fout: 'download gaf geen bestand dat ik terugvind' }) });
    const r3 = await n3.run({ aantal: 10, soort: 'nu' });
    ok(`drie gewone mislukkingen op rij: stop (${g3.length}, "${r3.reden}")`, g3.length === MAX_OP_EEN_RIJ && /3 mislukkingen op rij/.test(r3.reden) && r3.mislukt === 3);
    const { nacht: n4, gehaald: g4 } = maak({ uitkomst: (w, n) => (n % 2 === 0 ? { ok: false, fout: 'mis' } : { ok: true, track: { id: w.youtube_id } }) });
    const r4 = await n4.run({ aantal: 3, soort: 'nu' });
    ok(`afwisselend mis en goed: de teller begint opnieuw na een succes (${g4.length} geprobeerd, 3 gehaald)`, r4.gehaald === 3 && r4.mislukt === 2 && /klaar/.test(r4.reden));
    // Na een blokkade: deze nacht niet meer (als nachtrun), de volgende wel.
    const { nacht: n5, zet } = maak({ nu: new Date(2026, 9, 12, 3, 0), uitkomst: () => ({ ok: false, fout: 'HTTP Error 403' }) });
    n5.zet({ aan: true, speeldagen: [] });
    ok('nachtrun begint', n5.peil() === null);
    await n5._run;
    ok('na de 403 deze nacht niet opnieuw', n5.peil() === 'deze nacht al gedaan');
    zet(new Date(2026, 9, 13, 3, 0));
    ok('de volgende nacht wel weer', n5.peil() === null);
    await n5._run;
  }

  // ---- regel 6 ---------------------------------------------------------------------
  console.log('\nregel 6: elke run in nacht_runs en in het log');
  {
    const { nacht, kaart, logs } = maak({ nu: new Date(2026, 9, 12, 3, 0) });
    const r = await nacht.run({ aantal: 2, soort: 'nu' });
    const run = kaart.laatsteRun();
    ok('nacht_runs: begonnen, klaar, gehaald, mislukt, reden, soort', run.begonnen === new Date(2026, 9, 12, 3, 0).getTime() && run.klaar === run.begonnen && run.gehaald === 2 && run.mislukt === 0
      && /klaar: 2/.test(run.reden) && run.soort === 'nu' && r.id === kaart.runs()[0].id);
    ok('GET /api/nacht toont laatsteRun', nacht.stand().laatsteRun.gehaald === 2);
    ok(`log: begin, per nummer, einde (${logs.length} regels)`, logs.some((l) => /run \d+ \(nu\)/.test(l)) && logs.filter((l) => /: klaar/.test(l)).length === 2 && logs.some((l) => /run \d+ klaar: 2 gehaald/.test(l)));
    ok('een nachtrun uit nacht_runs telt na een herstart als "deze nacht gedaan"', (() => {
      const db = join(map, 'herstart.db');
      const k = new Kaart({ pad, db, library, log: () => {} });
      const id = k.beginRun('nacht', new Date(2026, 9, 12, 2, 0).getTime()); k.eindRun(id, { klaar: 1, gehaald: 1, mislukt: 0, reden: 'x' }); k.sluit();
      const k2 = new Kaart({ pad, db, library, log: () => {} });
      const n = new Nacht({ kaart: k2, haal: async () => ({ ok: true }), klok: () => new Date(2026, 9, 12, 4, 0), log: () => {} });
      n.zet({ aan: true, speeldagen: [] });
      const r2 = n.magNu(); k2.sluit(); return r2 === 'deze nacht al gedaan';
    })());
  }

  // ---- stop, nu, zoeken in de nacht ---------------------------------------------
  console.log('\nstop na het lopende nummer; nu() op een speeldag; zoeken voor een wens zonder video');
  {
    const { nacht, gehaald } = maak({ uitkomst: (w) => { nacht.stop(); return { ok: true, track: { id: w.youtube_id } }; } });
    const r = await nacht.run({ aantal: 5, soort: 'nu' });
    ok(`stop tijdens het eerste nummer: dat nummer af, dan stop (${gehaald.length}, "${r.reden}")`, gehaald.length === 1 && r.reden === 'gestopt' && r.gehaald === 1);
    ok('stop zonder run: false', nacht.stop() === false);
    const { nacht: n2 } = maak({ nu: new Date(2026, 9, 10, 15, 0) });
    ok('nu() op de speeldag (10 okt 15:00): 409', (() => { try { n2.nu({ aantal: 1 }); return false; } catch (e) { return e.code === 409 && /speeldag/.test(e.message); } })());
    const { nacht: n2b } = maak({ nu: new Date(2026, 9, 11, 3, 0) });
    ok('nu() in de nacht na de speeldag: ook 409', (() => { try { n2b.nu({ aantal: 1 }); return false; } catch (e) { return e.code === 409; } })());
    const { nacht: n3 } = maak({ nu: new Date(2026, 9, 12, 15, 0) });
    ok('nu() op een gewone dag, buiten het venster, ook met aan=false: mag (dat is waar hij voor is)', (() => { try { const p = n3.nu({ aantal: 1 }); return p instanceof Promise; } catch { return false; } })());
    await n3._run;
    ok('nu() met een onzinnig aantal: 400', (() => { try { n3.nu({ aantal: 0 }); return false; } catch (e) { return e.code === 400; } })());

    // Een wens zonder video: zoeken; zeker = kiezen en halen; onzeker = wacht op Clay.
    const vragen = [];
    const { nacht: n4, kaart: k4, gehaald: g4 } = maak({
      zoek: async (sleutel) => {
        vragen.push(sleutel);
        if (sleutel === 'sp:sp0000000001') return { kandidaten: [{ youtube_id: 'gevonden0001', score: 1, reden: 'alles' }] };
        return { kandidaten: [{ youtube_id: 'twijfelig001', score: 0.6, reden: 'titel klopt' }] };
      },
    });
    n4.zet({ standaardVolgorde: false });
    k4.voegWensen(['sp:sp0000000001', 'sp:sp0000000002']);
    // De Kaart doet normaal zelf 'zoekt' -> 'kies'; hier is zoek ingeprikt, dus spelen we dat na voor de tweede.
    const r4 = await n4.run({ aantal: 5, soort: 'nu' });
    ok(`beide gezocht (${vragen.join(' ')})`, vragen.join() === 'sp:sp0000000001,sp:sp0000000002');
    ok('zeker (1,0): gekozen en meteen gehaald', g4.join() === 'gevonden0001' && k4.wens('sp:sp0000000001').status === 'klaar' && k4.wens('sp:sp0000000001').youtube_id === 'gevonden0001');
    ok(`onzeker (0,6): niet gehaald, de wens wacht op een keuze (${k4.wens('sp:sp0000000002').status})`, !g4.includes('twijfelig001') && k4.wens('sp:sp0000000002').status === 'kies' && r4.gehaald === 1);
    const { nacht: n5, kaart: k5, gehaald: g5 } = maak({ zoek: async () => { throw Object.assign(new Error('zoeken mislukt: HTTP Error 403: Forbidden'), { code: 502 }); } });
    n5.zet({ standaardVolgorde: false });
    k5.voegWensen(['sp:sp0000000001']);
    const r5 = await n5.run({ aantal: 5, soort: 'nu' });
    ok('een 403 bij het zoeken is ook een blokkade: stop', /geblokkeerd bij zoeken/.test(r5.reden) && g5.length === 0);
    const { nacht: n6, kaart: k6 } = maak();   // zonder zoeker
    n6.zet({ standaardVolgorde: false });
    k6.voegWensen(['sp:sp0000000001']);
    const r6 = await n6.run({ aantal: 5, soort: 'nu' });
    ok('zonder zoeker: de wens gaat op kies met uitleg, de run loopt door', k6.wens('sp:sp0000000001').status === 'kies' && r6.reden === 'niets meer te halen');
  }

  // ---- opslag -----------------------------------------------------------------------
  console.log('\nopslag in nacht.json');
  {
    const nachtPad = join(map, 'nacht.json');
    const { nacht } = maak({ pad: nachtPad });
    ok('zonder bestand: standaard, niets geschreven', !existsSync(nachtPad) && nacht.stand().aan === false);
    nacht.zet({ aan: true, perNacht: 12, venster: { van: '02:00', tot: '06:00' }, speeldagen: ['2026-10-10', '2026-10-31'], vandaagNiet: true });
    const j = JSON.parse(readFileSync(nachtPad, 'utf8'));
    ok('geschreven (atomisch, versie 1) met alles erin', j.versie === 1 && j.instellingen.aan === true && j.instellingen.perNacht === 12 && j.instellingen.venster.van === '02:00'
      && j.instellingen.speeldagen.length === 2 && j.instellingen.vandaagNietDatum === nachtDatum(new Date(2026, 9, 12, 3, 0)) && !existsSync(`${nachtPad}.tmp`));
    const { nacht: n2 } = maak({ pad: nachtPad });
    const s = n2.stand();
    ok('teruggelezen na een herstart, ook vandaagNiet', s.aan === true && s.perNacht === 12 && s.venster.tot === '06:00' && s.speeldagen.join() === '2026-10-10,2026-10-31' && s.vandaagNiet === true);
    writeFileSync(join(map, 'kapot.json'), '{ kapot');
    const { nacht: n3 } = maak({ pad: join(map, 'kapot.json') });
    ok('een kapot bestand = standaard, geen crash', n3.stand().aan === false);
    ok('datumVan in lokale tijd', datumVan(new Date(2026, 9, 10, 23, 59)) === '2026-10-10');
  }
} finally {
  rmSync(map, { recursive: true, force: true });
}

console.log(`\n${fails.length ? `${fails.length} FAIL` : 'alles ok'}`);
process.exit(fails.length ? 1 : 0);
