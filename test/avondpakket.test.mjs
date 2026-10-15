// Het avondpakket zonder hardware: de parsers op echte (geanonimiseerde) en
// handgemaakte uitvoer van pmset, ioreg, df, defaults, system_profiler,
// tailscale en find (test/fixtures/avondpakket, LEESMIJ.md), de profielen
// als data, de keuze van de fase, het oordeel en de tegel. Puur: geen
// kindprocessen, geen server, geen klok (nu wordt meegegeven).
// Draai met: node test/avondpakket.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const A = await import('../server/avondpakket.js');
const { avondpakketTegel } = await import('../src/controle/avondpakket-tegel.js');
const {
  parsePmset, parsePmsetAc, parseIoregAccu, parseDf, parseOptimize, parseAudio, parseBluetooth, parseUsbHost,
  parseIoregUsb, voegUsbSamen, herkenUsb, parseTailscale, parseBestanden, parseInstellingen, verwachteBestanden,
  vergelijkCompleet, leesProfielen, kiesFase, beoordeel, hexId, FASEN, schoon, paklijstVan, verwachtePaden, heeftProfiel,
  parsePowerSupply, parseLsusb, parseSysUsb,
} = A;

const MAP = fileURLToPath(new URL('./fixtures/avondpakket/', import.meta.url));
const fx = (naam) => readFileSync(MAP + naam, 'utf8');
const ECHTE_DATA = readFileSync(fileURLToPath(new URL('../avondpakket/profielen.json', import.meta.url)), 'utf8');
const data = (wijzig = {}) => ({ ...leesProfielen(ECHTE_DATA), ...wijzig });
const M = '/Users/test/varve/media';
const W = '/Users/test/varve';
const NU = new Date(2026, 9, 10, 18, 30);          // 10 okt 2026 18:30, de proefavond
const punt = (r, id) => r.punten.find((p) => p.id === id);
const hhmm = (ms) => new Date(ms).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

/**
 * "Goed ingepakt vertrek" (W1): de echte uitvoer van vandaag (AirPods als standaard: echt
 * sinds herstelronde 1, zie LEESMIJ), een library van 26 nummers lokaal, accu 85 % aan de 8 W-lader,
 * backup zonder wijziging, nacht uit, wachtrijen leeg, één server op library.db.
 */
function goedVertrek(wijzig = {}) {
  return {
    bestanden: parseBestanden(fx('find-stat-131-HANDGEMAAKT.txt'), fx('find-dataless-leeg.txt'), M),
    instellingen: parseInstellingen(fx('find-dataless-leeg.txt'), W),
    icloud: parseOptimize(fx('optimize-aan.txt')),
    schijf: parseDf(fx('df-122vrij.txt')),
    accu: { ...parsePmset(fx('pmset-ac-65.txt')), ...parsePmsetAc(fx('pmset-ac-8w.txt')), ...parseIoregAccu(fx('ioreg-accu.txt')), procent: 85 },
    audio: parseAudio(fx('audio-airpods-10okt.json')),   // echt, 10 okt 13:47 (de HANDGEMAAKT-versie toetst groep 5)
    bluetooth: parseBluetooth(fx('bluetooth-aan-niets-verbonden.json')),
    usb: voegUsbSamen(parseUsbHost(fx('usbhost-leeg.json')), parseIoregUsb(fx('ioreg-usb-leeg.txt'))),
    avhub: { draait: false },
    servers: { opDb: 1, varve: 1 },
    tailscale: parseTailscale(fx('tailscale-running.json')),
    backup: { laatste: { naam: 'library-2026-10-10_12-00-00.db', tijd: new Date(2026, 9, 10, 12, 0).getTime(), bytes: 5e6 }, aantal: 12,
      gekeken: new Date(2026, 9, 10, 18, 0).getTime(), fout: null, bezig: false, gewijzigdSinds: false },
    achtergrond: { ingestBezig: false, ingestWacht: 0, stemsBezig: false, stemsWacht: 0, nachtAan: false, vandaagSpeeldag: true, speelt: false },
    compleet: { nummers: 26, verwacht: 130, ontbreekt: [], leeg: [] },
    ...wijzig,
  };
}
/** Hetzelfde, maar aangekomen met alles erin: samengesteld apparaat, APC + Scarlett, 30 W, Bluetooth uit. */
function goedAankomst(wijzig = {}) {
  return goedVertrek({
    audio: parseAudio(fx('audio-samengesteld-HANDGEMAAKT.json')),
    usb: voegUsbSamen(parseUsbHost(fx('usbhost-apc-scarlett-maschine-HANDGEMAAKT.json')), parseIoregUsb(fx('ioreg-usb-apc-HANDGEMAAKT.txt'))),
    bluetooth: parseBluetooth(fx('bluetooth-uit-HANDGEMAAKT.json')),
    accu: { ...parsePmset(fx('pmset-ac-65.txt')), ...parsePmsetAc(fx('pmset-ac-30w-HANDGEMAAKT.txt')) },
    ...wijzig,
  });
}

console.log('1. pmset');
{
  const ac = parsePmset(fx('pmset-ac-65.txt'));
  ok('echte AC-uitvoer: bron AC, 65 %, charging', ac.bron === 'AC' && ac.procent === 65 && ac.toestand === 'charging' && ac.resterend === '11:09');
  const accu = parsePmset(fx('pmset-accu-18-HANDGEMAAKT.txt'));
  ok('accu 18 %: bron accu, discharging, 0:41', accu.bron === 'accu' && accu.procent === 18 && accu.toestand === 'discharging' && accu.resterend === '0:41');
  const nc = parsePmset(fx('pmset-ac-notcharging-80-HANDGEMAAKT.txt'));
  ok('"AC attached; not charging" bij 80 %: bron AC (uit de eerste regel), toestand "not charging"', nc.bron === 'AC' && nc.procent === 80 && nc.toestand === 'not charging');
  ok('"charged" en "finishing charge": bron AC', parsePmset(fx('pmset-ac-charged-HANDGEMAAKT.txt')).bron === 'AC'
    && parsePmset(fx('pmset-ac-finishing-HANDGEMAAKT.txt')).toestand === 'finishing charge');
  ok('"(no estimate)": geen resterende tijd, wel procent', parsePmset(fx('pmset-accu-63-geenschatting-HANDGEMAAKT.txt')).resterend === null
    && parsePmset(fx('pmset-accu-63-geenschatting-HANDGEMAAKT.txt')).procent === 63);
  ok('lege of vreemde tekst → null', parsePmset('') === null && parsePmset('hallo') === null && parsePmset(undefined) === null);
  ok('pmset -g ac: echte 8 W, 30 W, geen lader → null-vermogen, onzin → null',
    parsePmsetAc(fx('pmset-ac-8w.txt')).laderW === 8 && parsePmsetAc(fx('pmset-ac-30w-HANDGEMAAKT.txt')).laderW === 30
    && parsePmsetAc(fx('pmset-ac-geen-HANDGEMAAKT.txt')).laderW === null && parsePmsetAc('') === null);
}

console.log('2. ioreg (accu)');
{
  const a = parseIoregAccu(fx('ioreg-accu.txt'));
  ok(`echte uitvoer: 591 cycli, gezondheid 3413/4382 = 78 % (${a?.gezondheid})`, a.cycli === 591 && a.gezondheid === 78);
  ok('MaxCapacity (100) wordt genegeerd; FedDesignCapacity telt niet als DesignCapacity',
    parseIoregAccu('"MaxCapacity" = 100\n"FedDesignCapacity"=0\n"CycleCount" = 3').gezondheid === null);
  ok('niets bruikbaars → null', parseIoregAccu('') === null);
}

console.log('3-4. df en optimize');
{
  const d = parseDf(fx('df-122vrij.txt'));
  ok(`df: echte regel → ~122 GiB vrij van ~460 (${d?.vrijGiB}/${d?.totaalGiB})`, Math.abs(d.vrijGiB - 122) <= 1 && Math.abs(d.totaalGiB - 460) <= 2);
  ok('df: onzin → null', parseDf('Filesystem 1024-blocks') === null);
  ok('optimize: echt "1" → true, "0" → false, fout → null', parseOptimize(fx('optimize-aan.txt')) === true && parseOptimize('0\n') === false
    && parseOptimize('The domain/default pair of (com.apple.bird, optimize-storage) does not exist') === null);
}

console.log('5. audio');
{
  const echt = parseAudio(fx('audio-luidsprekers.json'));
  const std = echt.find((i) => i.standaardUit);
  ok('echt (12:26): standaard = MacBook Air luidsprekers, builtin, 2 uit, ook systeemgeluid',
    std.naam === 'MacBook Air luidsprekers' && std.transport === 'builtin' && std.uit === 2 && std.standaardSysteem);
  ok('echt: BlackHole = virtual met 16 uit; de iPhone-microfoon heeft geen uitgang',
    echt.some((i) => /BlackHole/.test(i.naam) && i.transport === 'virtual' && i.uit === 16) && echt.find((i) => /iPhone/.test(i.naam)).uit === 0);
  const air = parseAudio(fx('audio-airpods-HANDGEMAAKT.json'));
  const airStd = air.filter((i) => i.standaardUit);
  ok('AirPods: per item, het UITVOER-item is de standaard (niet het invoer-item met dezelfde naam)',
    air.filter((i) => /AirPods/.test(i.naam)).length === 2 && airStd.length === 1 && airStd[0].transport === 'bluetooth' && airStd[0].uit === 2);
  ok('AirPods: standaardSysteem ≠ standaardUit (meldingen blijven op de luidsprekers)',
    air.find((i) => i.standaardSysteem).naam === 'MacBook Air luidsprekers');
  const echt2 = parseAudio(fx('audio-airpods-10okt.json'));
  ok('ECHT (13:47): de AirPods twee keer (invoer 1, uitvoer 2), het uitvoer-item is de standaard; de handgemaakte vorm klopte',
    echt2.filter((i) => /AirPods/.test(i.naam)).length === 2 && echt2.find((i) => i.standaardUit).uit === 2
    && echt2.find((i) => i.standaardUit).transport === 'bluetooth' && echt2.find((i) => i.standaardSysteem).transport === 'builtin');
  ok('samengesteld: standaard met 4 uit', parseAudio(fx('audio-samengesteld-HANDGEMAAKT.json')).find((i) => i.standaardUit).uit === 4);
  ok('BlackHole als standaard: naam past op "virtueel" uit de data',
    new RegExp(data().virtueel, 'i').test(parseAudio(fx('audio-blackhole-HANDGEMAAKT.json')).find((i) => i.standaardUit).naam));
  ok('ongeldige JSON → null', parseAudio('{kapot') === null && parseAudio('{}') === null);
}

console.log('6. bluetooth');
{
  ok('echt: aan, niets verbonden', JSON.stringify(parseBluetooth(fx('bluetooth-aan-niets-verbonden.json'))) === JSON.stringify({ aan: true, verbonden: [], audio: [] }));
  const air = parseBluetooth(fx('bluetooth-aan-airpods-HANDGEMAAKT.json'));
  ok('AirPods verbonden: in verbonden én in audio; de muis alleen in verbonden',
    air.verbonden.includes('AirPods 4') && air.audio.join() === 'AirPods 4' && air.verbonden.length === 2);
  ok('uit → aan: false', parseBluetooth(fx('bluetooth-uit-HANDGEMAAKT.json')).aan === false);
  const echtBt = parseBluetooth(fx('bluetooth-aan-airpods-10okt.json'));
  ok('ECHT (13:47): AirPods verbonden als Headphones → in audio', echtBt.aan && echtBt.audio.length === 1 && /AirPods/.test(echtBt.audio[0]));
  ok('onzin → null', parseBluetooth('[]') === null);
}

console.log('7. usb');
{
  const apparaten = data().apparaten;
  const leeg = voegUsbSamen(parseUsbHost(fx('usbhost-leeg.json')), parseIoregUsb(fx('ioreg-usb-leeg.txt')));
  ok('echt leeg (twee keer "USB 3.1 Bus", niets eraan) → [] en alles false',
    leeg.length === 0 && Object.values(herkenUsb(leeg, apparaten)).every((x) => x === false));
  const boom = parseUsbHost(fx('usbhost-apc-scarlett-maschine-HANDGEMAAKT.json'));
  const h = herkenUsb(boom, apparaten);
  ok('HANDGEMAAKT-boom (genest onder een hub, andere sleutelnamen): apc40, scarlett, maschine true; lpd8, xboard false',
    h.apc40 && h.scarlett && h.maschine && !h.lpd8 && !h.xboard);
  ok('vendor/product uit "Vendor ID": 6092 (getal) en "0x1235  (Focusrite-Novation)" (tekst)',
    boom.find((x) => /Maschine/.test(x.naam)).vid === '0x17cc' && boom.find((x) => /Scarlett/.test(x.naam)).vid === '0x1235');
  const io = parseIoregUsb(fx('ioreg-usb-apc-HANDGEMAAKT.txt'));
  ok('ioreg: APC40 met idVendor 2536 → 0x09e8, idProduct 41 → 0x0029', io.length === 1 && io[0].naam === 'APC40 mkII' && io[0].vid === '0x09e8' && io[0].pid === '0x0029');
  ok('herkennen op vid:pid alleen (naam onbekend): 17cc:1140 = maschine; "0029" uit de data is hex',
    herkenUsb([{ naam: 'iets', vid: '0x17cc', pid: '0x1140' }], apparaten).maschine && herkenUsb([{ naam: '?', vid: '0x09e8', pid: '0x0029' }], apparaten).apc40);
  ok('een apparaat in beide bronnen telt één keer', voegUsbSamen(boom, io).filter((x) => /APC40/.test(x.naam)).length === 1);
  ok('een apparaat dat alleen in de data staat wordt herkend zonder codewijziging (W10)',
    herkenUsb([{ naam: 'Testding 3000' }], { test: { naam: 'testding' } }).test === true);
  ok('een ongeldige regex in de data gooit niet', herkenUsb([{ naam: 'x' }], { kapot: { naam: '([' } }).kapot === false);
  ok('hexId: getal decimaal, tekst hex', hexId(2536) === '0x09e8' && hexId('0029') === '0x0029' && hexId('0x09E8') === '0x09e8' && hexId('Apple') === null);
}

console.log('8. tailscale');
{
  const t = parseTailscale(fx('tailscale-running.json'));
  ok('echt (geanonimiseerd): Running, 3 peers, clayk online en direct', t.backend === 'Running' && t.peers.length === 3
    && t.peers.find((p) => p.naam === 'clayk').online && t.peers.find((p) => p.naam === 'clayk').direct);
  ok('telefoon online via relay ams, oud-apparaat offline', t.peers.find((p) => p.naam === 'telefoon').relay === 'ams'
    && !t.peers.find((p) => p.naam === 'telefoon').direct && !t.peers.find((p) => p.naam === 'oud-apparaat').online);
  ok('gestopt → Stopped, geen peers', parseTailscale(fx('tailscale-gestopt-HANDGEMAAKT.json')).backend === 'Stopped');
  ok('ongeldige JSON → null', parseTailscale('nee') === null && parseTailscale('{}') === null);
  ok('geen IP-adres in de uitkomst, ook als ze in de invoer staan',
    !JSON.stringify(parseTailscale({ BackendState: 'Running', TailscaleIPs: ['100.64.0.1'], Self: { HostName: 'x', TailscaleIPs: ['100.64.0.2'] },
      Peer: { a: { HostName: 'clayk', Online: true, CurAddr: '100.64.0.3:41641', TailscaleIPs: ['100.64.0.3'] } } })).includes('100.'));
}

console.log('9. bestanden en instellingen');
{
  const leeg = parseBestanden(fx('find-stat-leeg.txt'), fx('find-dataless-leeg.txt'), M);
  ok('leeg + leeg → totaal 0', leeg.totaal === 0 && leeg.dataless.length === 0);
  const b = parseBestanden(fx('find-stat-131-HANDGEMAAKT.txt'), fx('find-dataless-3-HANDGEMAAKT.txt'), M);
  ok(`131 regels → totaal 131 (${b.totaal}), paden relatief (nr00_test/audio.wav)`, b.totaal === 131 && b.paden.has('nr00_test/audio.wav') && b.paden.has('library.db'));
  ok('geen pad bevat /Users/', ![...b.paden, ...b.dataless.map((d) => d.pad)].some((p) => p.includes('/Users/')));
  ok('dataless-3: twee in <id>/ (met grootte uit stat), één in backups/',
    b.dataless.filter((d) => /^nr0\d_test\/stems\.wav$/.test(d.pad) && d.bytes > 3e9).length === 2 && b.dataless.some((d) => d.pad.startsWith('backups/')));
  ok('de 0-byte audio.wav staat erin met 0', b.bytes.get('nr03_test/audio.wav') === 0);
  const inst = parseInstellingen(fx('find-instellingen-1-HANDGEMAAKT.txt'), W);
  ok('instellingen: mappings/apc40mk2.json → groep instellingen, relatief pad', inst.length === 1 && inst[0].groep === 'instellingen' && inst[0].pad === 'mappings/apc40mk2.json');
  const meer = parseInstellingen(`${W}/src/ui/app.js\n${W}/media/x/audio.wav\n/Users/test/elders/plannen/auto-plan.json\n`, W, [{ map: '/Users/test/elders/plannen', groep: 'instellingen' }]);
  ok('code → code, media → media, een VARVE_*-map buiten de wortel → zijn groep, zonder /Users/',
    meer.map((x) => x.groep).join() === 'code,media,instellingen' && meer[2].pad === 'plannen/auto-plan.json');
  const st = parseInstellingen(`${W}/standen/apc.json\n${W}/tools/standen/voorbeelden/apc.json\n`, W);
  ok('standen/ (Clay\'s opstellingen) → instellingen; tools/standen/voorbeelden (in git) → code', st.map((x) => x.groep).join() === 'instellingen,code');
}

console.log('10. profielen');
{
  const d = leesProfielen(ECHTE_DATA);
  ok(`echte data: 5 profielen (${Object.keys(d.profielen)}), standaard apc, fase auto, 5 apparaten, niet bevestigd`,
    Object.keys(d.profielen).length === 5 && d.standaard === 'apc' && d.fase === 'auto' && Object.keys(d.apparaten).length === 5
    && d.hardwareBevestigd === false && !d.fout);
  ok('echte data: bekend = icloud, grenzen 20/50/20/80/30', d.bekend.join() === 'icloud'
    && JSON.stringify(Object.values(d.grenzen)) === '[20,50,20,80,30]');
  ok('elk profiel heeft een titel en gebruikt alleen verwacht/optioneel/nee voor de onderdelen',
    Object.values(d.profielen).every((p) => p.titel && ['geluid', 'apc40', 'scarlett', 'maschine', 'lpd8', 'xboard', 'avhub', 'usbhub', 'voeding', 'tailscale', 'beeld']
      .every((k) => ['verwacht', 'optioneel', 'nee'].includes(p[k]))));
  const kapot = leesProfielen('{ "profielen": ');
  ok('kapot → terugval laptop, geen apparaten, met fout (nooit een throw)', kapot.standaard === 'laptop' && Object.keys(kapot.profielen).join() === 'laptop'
    && Object.keys(kapot.apparaten).length === 0 && kapot.fout);
  const vooruit = leesProfielen(JSON.stringify({ ...JSON.parse(ECHTE_DATA), nieuwVeld: 1, standaard: 'bestaatniet', fase: 'gisteren' }));
  ok('onbekend veld is geen fout; onbekende standaard → eerste profiel; onbekende fase → auto', !vooruit.fout && vooruit.standaard === 'laptop' && vooruit.fase === 'auto');
  ok('FASEN = auto, vertrek, aankomst', FASEN.join() === 'auto,vertrek,aankomst');
}

console.log('11. kiesFase');
{
  const d = data();
  ok('niets gezien + AirPods als standaard → vertrek', kiesFase(goedVertrek(), d.profielen.apc, d) === 'vertrek');
  ok('APC gezien → aankomst', kiesFase(goedVertrek({ usb: parseIoregUsb(fx('ioreg-usb-apc-HANDGEMAAKT.txt')) }), d.profielen.apc, d) === 'aankomst');
  ok('alleen een 4-kanaals standaard (geen USB-apparaat) → aankomst',
    kiesFase(goedVertrek({ audio: [{ naam: 'Samengesteld apparaat', transport: 'aggregate', uit: 4, in: 0, standaardUit: true, standaardSysteem: false }] }), d.profielen.apc, d) === 'aankomst');
  ok('BlackHole als standaard telt niet als aangesloten → vertrek', kiesFase(goedVertrek({ audio: parseAudio(fx('audio-blackhole-HANDGEMAAKT.json')) }), d.profielen.apc, d) === 'vertrek');
  ok('profiel laptop → altijd aankomst (niets in te pakken)', kiesFase(goedVertrek(), d.profielen.laptop, d) === 'aankomst');
  ok('niets gemeten → vertrek (mild)', kiesFase({ usb: { onbekend: 'x' }, audio: { onbekend: 'x' } }, d.profielen.apc, d) === 'vertrek');
}

console.log('12. goed ingepakt vertrek (W1)');
{
  const r = beoordeel(goedVertrek(), { profiel: 'apc', data: data(), nu: NU });
  ok(`fase auto → vertrek, niet gekozen (${r.fase})`, r.fase === 'vertrek' && r.faseGekozen === false);
  ok(`0 rood, 0 oranje (${JSON.stringify(r.telling)}; ${r.punten.filter((p) => p.licht === 'fout' || p.licht === 'half').map((p) => p.id)})`,
    r.telling.fout === 0 && r.telling.half === 0);
  ok('oordeel klaar, licht groen', r.oordeel === 'klaar' && r.licht === 'ok');
  ok(`inpakken bevat APC40 mkII en Scarlett 2i2 met hun kabel (${r.inpakken})`, r.inpakken.includes('APC40 mkII + USB-B → USB-C (eigen kabel)')
    && r.inpakken.includes('Scarlett 2i2 + USB-C → USB-C'));
  ok('inpakken bevat de PD-hub en de bedrade koptelefoon', r.inpakken.some((x) => /PD-ingang/.test(x)) && r.inpakken.some((x) => /bedrade koptelefoon/.test(x)));
  ok('bij vertrek geen Bluetooth-punt en geen avhub-punt (profiel apc: nee, dicht)', !punt(r, 'bluetooth') && !punt(r, 'avhub'));
  ok('iCloud aan met 122 GiB vrij → groen "pas een risico bij weinig ruimte"', punt(r, 'icloud').licht === 'ok' && /weinig ruimte/.test(punt(r, 'icloud').sub));
}

console.log('13-14. apparaten per fase');
{
  const vertrek = beoordeel(goedVertrek(), { profiel: 'apc', fase: 'vertrek', data: data(), nu: NU });
  ok('vertrek: APC en Scarlett grijs "inpakken" met de kabel, nooit oranje/rood',
    punt(vertrek, 'apc40').licht === 'uit' && /inpakken: APC40 mkII \+ USB-B/.test(punt(vertrek, 'apc40').sub) && punt(vertrek, 'scarlett').licht === 'uit');
  ok('vertrek: Maschine (nee in apc) niet getoond', !punt(vertrek, 'maschine'));
  const aankomst = beoordeel(goedVertrek(), { profiel: 'apc', fase: 'aankomst', data: data(), nu: NU });
  ok('aankomst zonder APC, hardwareBevestigd false → oranje (nooit vals rood, H5)', punt(aankomst, 'apc40').licht === 'half' && /direct in de Mac/.test(punt(aankomst, 'apc40').sub));
  ok('aankomst zonder Scarlett → "Scarlett 2i2 aansluiten (aan de PD-hub)"', punt(aankomst, 'scarlett').sub === 'Scarlett 2i2 aansluiten (aan de PD-hub)');
  const anders = data(); anders.apparaten = { ...anders.apparaten, apc40: { ...anders.apparaten.apc40, via: 'dock' } };
  ok('een onbekende "via" uit de data staat er letterlijk ("via dock")', /\(via dock\)$/.test(punt(beoordeel(goedVertrek(), { profiel: 'apc', fase: 'aankomst', data: anders, nu: NU }), 'apc40').sub));
  const streng = beoordeel(goedVertrek(), { profiel: 'apc', fase: 'aankomst', data: data({ hardwareBevestigd: true }), nu: NU });
  ok('aankomst zonder APC, hardwareBevestigd true → rood, oordeel "nog niet beginnen"', punt(streng, 'apc40').licht === 'fout' && streng.oordeel === 'nog niet beginnen');
  const alles = beoordeel(goedAankomst(), { profiel: 'apc', data: data({ hardwareBevestigd: true }), nu: NU });
  ok(`aankomst met alles erin (auto → aankomst): APC en Scarlett groen, klaar (${alles.oordeel}; ${JSON.stringify(alles.telling)})`,
    alles.fase === 'aankomst' && punt(alles, 'apc40').licht === 'ok' && punt(alles, 'scarlett').licht === 'ok' && alles.oordeel === 'klaar');
  ok('aangesloten: de sub zegt waar hij hoort (APC direct in de Mac, Scarlett aan de PD-hub)', punt(alles, 'apc40').sub === 'direct in de Mac' && punt(alles, 'scarlett').sub === 'aan de PD-hub');
  ok('aankomst: een aangesloten apparaat dat niet in het profiel zit → grijs ter info', punt(alles, 'maschine').licht === 'uit' && /niet in dit profiel/.test(punt(alles, 'maschine').sub));
  const lpd = beoordeel(goedAankomst({ avhub: { draait: true } }), { profiel: 'maschine', data: data(), nu: NU });
  ok('optioneel en niet aangesloten (LPD8 bij maschine) → grijs', punt(lpd, 'lpd8').licht === 'uit');
}

console.log('15. geluid');
{
  const r = (audio, d = data(), profiel = 'apc') => punt(beoordeel(goedAankomst({ audio: parseAudio(fx(audio)) }), { profiel, fase: 'aankomst', data: d, nu: NU }), 'geluid');
  ok('aankomst + AirPods → oranje met "Bluetooth" (niet bevestigd)', r('audio-airpods-HANDGEMAAKT.json').licht === 'half' && /Bluetooth/.test(r('audio-airpods-HANDGEMAAKT.json').sub));
  ok('aankomst + AirPods → rood (bevestigd)', r('audio-airpods-HANDGEMAAKT.json', data({ hardwareBevestigd: true })).licht === 'fout');
  ok('samengesteld met 4 uit → groen', r('audio-samengesteld-HANDGEMAAKT.json').licht === 'ok');
  const sc = r('audio-scarlett-2kan-HANDGEMAAKT.json');
  ok('Scarlett met 2 → "geen aparte cue" en de tip om het samengestelde apparaat te kiezen', sc.licht === 'half' && /geen aparte cue/.test(sc.sub) && /kies Samengesteld apparaat/.test(sc.sub));
  ok('BlackHole → "virtueel"', /virtueel/.test(r('audio-blackhole-HANDGEMAAKT.json').sub));
  const bt = data(); bt.profielen = { ...bt.profielen, apc: { ...bt.profielen.apc, zaal: 'bluetooth' } };
  const btZaal = r('audio-airpods-HANDGEMAAKT.json', { ...bt, hardwareBevestigd: true });
  ok('zaal: bluetooth → geen rood, latency in de sub', btZaal.licht === 'ok' && /150-250 ms/.test(btZaal.sub));
  ok('laptop (optioneel) met de luidsprekers → groen', r('audio-luidsprekers.json', data(), 'laptop').licht === 'ok');
}

console.log('16. Bluetooth-punt');
{
  const r = (bt, fase = 'aankomst') => punt(beoordeel(goedAankomst({ bluetooth: parseBluetooth(fx(bt)) }), { profiel: 'apc', fase, data: data(), nu: NU }), 'bluetooth');
  ok('aankomst: aan + AirPods verbonden → oranje "zet Bluetooth uit"', r('bluetooth-aan-airpods-HANDGEMAAKT.json').licht === 'half' && /zet Bluetooth uit/.test(r('bluetooth-aan-airpods-HANDGEMAAKT.json').sub));
  ok('aankomst: aan zonder verbonden audio → groen', r('bluetooth-aan-niets-verbonden.json').licht === 'ok');
  ok('aankomst: uit → groen', r('bluetooth-uit-HANDGEMAAKT.json').licht === 'ok');
  ok('vertrek → niet getoond', r('bluetooth-aan-airpods-HANDGEMAAKT.json', 'vertrek') === undefined);
}

console.log('17. accu en lader');
{
  const r = (accu, fase) => punt(beoordeel(goedVertrek({ accu }), { profiel: 'apc', fase, data: data(), nu: NU }), 'accu');
  const ac63 = { ...parsePmset(fx('pmset-ac-65.txt')), procent: 63, ...parsePmsetAc(fx('pmset-ac-8w.txt')) };
  ok('vertrek 63 % → oranje "laad vóór vertrek"', r(ac63, 'vertrek').licht === 'half' && /laad vóór vertrek/.test(r(ac63, 'vertrek').sub));
  ok('vertrek 90 % → groen', r({ ...ac63, procent: 90 }, 'vertrek').licht === 'ok');
  ok('aankomst aan de 8 W-lader → oranje "zwakke lader (8 W)"', r(ac63, 'aankomst').licht === 'half' && /zwakke lader \(8 W\)/.test(r(ac63, 'aankomst').sub));
  ok('aankomst aan 30 W → groen', r({ ...ac63, ...parsePmsetAc(fx('pmset-ac-30w-HANDGEMAAKT.txt')) }, 'aankomst').licht === 'ok');
  const a18 = { ...parsePmset(fx('pmset-accu-18-HANDGEMAAKT.txt')), ...parsePmsetAc(fx('pmset-ac-geen-HANDGEMAAKT.txt')) };
  ok('op de accu 18 % → rood (beide fasen)', r(a18, 'aankomst').licht === 'fout' && r(a18, 'vertrek').licht === 'fout');
  ok('aankomst op de accu 63 % (voeding verwacht) → oranje "lader erin"', r({ ...a18, procent: 63 }, 'aankomst').licht === 'half' && /lader erin/.test(r({ ...a18, procent: 63 }, 'aankomst').sub));
  const oud = r({ ...ac63, procent: 90, gezondheid: 50, cycli: 1200 }, 'vertrek');
  ok('gezondheid en cycli alleen in de sub, nooit als kleur', oud.licht === 'ok' && /gezondheid 50 %/.test(oud.sub) && /1200 cycli/.test(oud.sub));
}

console.log('18-19. iCloud en schijf');
{
  const zonder = data({ bekend: [] });
  const ic = (schijf, d = zonder) => punt(beoordeel(goedVertrek({ schijf }), { profiel: 'apc', data: d, nu: NU }), 'icloud');
  ok('aan + 122 GiB → groen', ic(parseDf(fx('df-122vrij.txt'))).licht === 'ok');
  ok('aan + 30 GiB → oranje', ic({ vrijGiB: 30, totaalGiB: 460 }).licht === 'half');
  const bekend = beoordeel(goedVertrek({ schijf: { vrijGiB: 30, totaalGiB: 460 } }), { profiel: 'apc', data: data(), nu: NU });
  ok('bekend: ["icloud"] → grijs "bekend: …", telt niet als oranje', punt(bekend, 'icloud').licht === 'uit' && /^bekend: /.test(punt(bekend, 'icloud').sub)
    && punt(bekend, 'icloud').bekend === true && !bekend.letOp.includes('icloud'));
  ok('optimize uit → groen', punt(beoordeel(goedVertrek({ icloud: false }), { profiel: 'apc', data: zonder, nu: NU }), 'icloud').licht === 'ok');
  const sch = (vrijGiB, d = data()) => punt(beoordeel(goedVertrek({ schijf: { vrijGiB, totaalGiB: 460 } }), { profiel: 'apc', data: d, nu: NU }), 'schijf').licht;
  ok('schijf: 122 groen, 30 oranje, 10 rood', sch(122) === 'ok' && sch(30) === 'half' && sch(10) === 'fout');
  ok('grenzen komen uit de data (schijfRoodGiB 40 → 30 is rood)', sch(30, data({ grenzen: { ...data().grenzen, schijfRoodGiB: 40 } })) === 'fout');
}

console.log('20. media en instellingen lokaal');
{
  const r = (bestanden, extra = {}) => punt(beoordeel(goedVertrek({ bestanden, ...extra }), { profiel: 'apc', data: data(), nu: NU }), 'media');
  const vol = parseBestanden(fx('find-stat-131-HANDGEMAAKT.txt'), '', M);
  ok('131 bestanden, niets uitgeplaatst → groen', r(vol).licht === 'ok' && /131/.test(r(vol).waarde));
  ok('totaal 0 → grijs, nooit groen (H11)', r(parseBestanden('', '', M)).licht === 'uit');
  ok('map ontbreekt → grijs', r({ bestaat: false }).licht === 'uit');
  const drie = r(parseBestanden(fx('find-stat-131-HANDGEMAAKT.txt'), fx('find-dataless-3-HANDGEMAAKT.txt'), M));
  ok('stems.wav uitgeplaatst in <id>/ → rood met naam, grootte en "klik het wolkje"',
    drie.licht === 'fout' && /nr01_test\/stems\.wav \(3,9 GB\)/.test(drie.sub) && /wolkje/.test(drie.sub) && drie.waarde === '2 in iCloud');
  const bk = r(parseBestanden(fx('find-stat-131-HANDGEMAAKT.txt'), fx('find-dataless-backups-HANDGEMAAKT.txt'), M));
  ok('alleen backups/ uitgeplaatst → oranje', bk.licht === 'half');
  ok('library.db uitgeplaatst → rood', r(parseBestanden(fx('find-stat-131-HANDGEMAAKT.txt'), `${M}/library.db\n`, M)).licht === 'fout');
  ok('met de server: minder bestanden dan verwacht → oranje', r(vol, { compleet: { nummers: 30, verwacht: 150, ontbreekt: [], leeg: [] } }).licht === 'half');
  const inst = punt(beoordeel(goedVertrek({ instellingen: parseInstellingen(fx('find-instellingen-1-HANDGEMAAKT.txt'), W) }), { profiel: 'apc', data: data(), nu: NU }), 'instellingen');
  ok('instellingen: mappings/apc40mk2.json uitgeplaatst → rood "zonder internet een dode APC"', inst.licht === 'fout' && /dode APC/.test(inst.sub));
  ok('instellingen: alleen code uitgeplaatst → oranje', punt(beoordeel(goedVertrek({ instellingen: [{ pad: 'src/ui/app.js', groep: 'code' }] }),
    { profiel: 'apc', data: data(), nu: NU }), 'instellingen').licht === 'half');
}

console.log('21. AV-hub en servers');
{
  const r = (m, profiel, fase, id) => punt(beoordeel(goedAankomst(m), { profiel, fase, data: data(), nu: NU }), id);
  ok('maschine + aankomst + 7700 dicht → rood "npm start -- studio"', r({}, 'maschine', 'aankomst', 'avhub').licht === 'fout' && /npm start -- studio/.test(r({}, 'maschine', 'aankomst', 'avhub').sub));
  ok('maschine + vertrek + dicht → grijs "straks bij aankomst" (F3: thuis hoort de hub dicht)', r({}, 'maschine', 'vertrek', 'avhub').licht === 'uit'
    && /straks bij aankomst: npm start -- studio/.test(r({}, 'maschine', 'vertrek', 'avhub').sub));
  ok('maschine + draait → groen', r({ avhub: { draait: true } }, 'maschine', 'aankomst', 'avhub').licht === 'ok');
  ok('apc + 7700 open → oranje "vergrendelen"', r({ avhub: { draait: true } }, 'apc', 'aankomst', 'avhub').licht === 'half' && /vergrendelen/.test(r({ avhub: { draait: true } }, 'apc', 'aankomst', 'avhub').sub));
  ok('servers: opDb 1 → groen', r({}, 'apc', 'aankomst', 'servers').licht === 'ok');
  ok('servers: opDb 2 → rood "twee processen op library.db"', r({ servers: { opDb: 2, varve: 2 } }, 'apc', 'aankomst', 'servers').licht === 'fout');
  ok('servers: opDb onbekend + 2 Varve-servers → oranje', r({ servers: { opDb: null, varve: 2 } }, 'apc', 'aankomst', 'servers').licht === 'half');
  ok('USB-hub: altijd grijs (paklijst bij vertrek, niet meetbaar bij aankomst)', r({}, 'apc', 'vertrek', 'usbhub').licht === 'uit' && r({}, 'apc', 'aankomst', 'usbhub').licht === 'uit');
}

console.log('22. backup');
{
  const basis = goedVertrek().backup;
  const r = (b) => punt(beoordeel(goedVertrek({ backup: { ...basis, ...b } }), { profiel: 'apc', data: data(), nu: NU }), 'backup');
  ok('gewijzigdSinds false → groen, sub "gaat mee in de tas" (W7)', r({}).licht === 'ok' && /gaat mee in de tas/.test(r({}).sub) && r({}).waarde === '12:00');
  ok(`gewijzigdSinds true → oranje met gekeken + 1 u (${hhmm(basis.gekeken + 36e5)})`, r({ gewijzigdSinds: true }).licht === 'half' && r({ gewijzigdSinds: true }).sub.includes(hhmm(basis.gekeken + 36e5)));
  ok('fout → rood met de reden', r({ fout: 'schijf vol' }).licht === 'fout' && r({ fout: 'schijf vol' }).sub === 'schijf vol');
  ok('nog nooit een kopie → rood', r({ laatste: null }).licht === 'fout');
  ok('bezig → grijs', r({ bezig: true }).licht === 'uit');
  // AR19 (16 okt): een machine zonder library (de pc) is grijs, en de tekst zegt waar hij gemeten is.
  const pc = beoordeel({ ...goedVertrek(), backup: { geenLibrary: true }, platform: 'linux' }, { profiel: 'apc', data: data(), nu: NU });
  ok('geen library (de pc) → grijs "geen library", nooit rood, "deze machine"', punt(pc, 'backup').licht === 'uit' && punt(pc, 'backup').waarde === 'geen library'
    && /geen library\.db op deze machine/.test(punt(pc, 'backup').sub));
  ok('… en op Linux zegt geen enkel punt "deze Mac"', !pc.punten.some((p) => /deze Mac/.test(`${p.waarde} ${p.sub}`)));
  ok('zonder platform (oude metingen) of op de Mac: "deze Mac" zoals altijd', /deze Mac/.test(r({}).sub)
    && /deze Mac/.test(punt(beoordeel({ ...goedVertrek(), platform: 'darwin' }, { profiel: 'apc', data: data(), nu: NU }), 'backup').sub));
  ok('een kopie van gisteren / 8 okt → "gisteren 12:00" / "8 okt 12:00"', r({ laatste: { tijd: new Date(2026, 9, 9, 12, 0).getTime() } }).waarde === 'gisteren 12:00'
    && r({ laatste: { tijd: new Date(2026, 9, 8, 12, 0).getTime() } }).waarde === '8 okt 12:00');
  ok('CLI zonder server (tijd uit de map) → grijs', r({ bron: 'map', gewijzigdSinds: undefined }).licht === 'uit');
}

console.log('23. achtergrond');
{
  const r = (a, fase) => punt(beoordeel(goedVertrek({ achtergrond: { ...goedVertrek().achtergrond, ...a } }), { profiel: 'apc', fase, data: data(), nu: NU }), 'achtergrond');
  ok('aankomst + split bezig → rood', r({ stemsBezig: true }, 'aankomst').licht === 'fout');
  ok('vertrek + split bezig → oranje "wacht"', r({ stemsBezig: true }, 'vertrek').licht === 'half');
  ok('ingestWacht 1 → oranje', r({ ingestWacht: 1 }, 'aankomst').licht === 'half' && /1 in de wachtrij/.test(r({ ingestWacht: 1 }, 'aankomst').waarde));
  // review 2, fix 3: de bediening is de knop "vandaag niet" in de mixer (KAART › NACHTWACHTRIJ), er is geen tegel Nacht
  const nacht = r({ nachtAan: true, vandaagSpeeldag: false }, 'vertrek');
  ok(`vertrek + nacht aan zonder speeldag → oranje, wijst naar "vandaag niet" in de mixer (${nacht.sub})`, nacht.licht === 'half'
    && /'vandaag niet'/.test(nacht.sub) && /NACHTWACHTRIJ/.test(nacht.sub) && !/tegel Nacht/.test(nacht.sub));
  ok('nacht aan mét speeldag → groen', r({ nachtAan: true, vandaagSpeeldag: true }, 'vertrek').licht === 'ok');
  const uit = r({ nachtAan: true, vandaagSpeeldag: false, vannachtUit: true }, 'vertrek');
  ok(`nacht aan + "vandaag niet" → groen "nacht aan, vannacht niet" (${uit.sub})`, uit.licht === 'ok' && uit.sub === 'nacht aan, vannacht niet');
}

console.log('24. compleet');
{
  const r = (c) => punt(beoordeel(goedVertrek({ compleet: c }), { profiel: 'apc', data: data(), nu: NU }), 'compleet');
  ok('één ontbrekend → rood met id/bestand', r({ nummers: 2, verwacht: 8, ontbreekt: [{ id: 'nr01_test', bestand: 'stems.wav' }], leeg: [] }).licht === 'fout'
    && /nr01_test\/stems\.wav/.test(r({ nummers: 2, verwacht: 8, ontbreekt: [{ id: 'nr01_test', bestand: 'stems.wav' }], leeg: [] }).sub));
  ok('0 B → rood', r({ nummers: 2, verwacht: 8, ontbreekt: [], leeg: [{ id: 'nr03_test', bestand: 'audio.wav' }] }).licht === 'fout');
  ok('alles → groen', r({ nummers: 26, verwacht: 130, ontbreekt: [], leeg: [] }).licht === 'ok');
  ok('niet vernieuwd (deck speelt) → grijs met de oude stand', r({ nummers: 2, verwacht: 8, ontbreekt: [{ id: 'a', bestand: 'audio.wav' }], leeg: [], oud: true }).licht === 'uit');
  // de pure vergelijking: library-rijen (zoals _verrijk ze geeft) naast wat find zag
  const b = parseBestanden(fx('find-stat-131-HANDGEMAAKT.txt'), '', M);
  const rij = (id, extra = {}) => ({ id, audio: `media/${id}/audio.wav`, video: `media/${id}/video.mp4`, peaks: { bestand: `media/${id}/peaks.bin` },
    onset: { bestand: `media/${id}/onset.bin` }, stems: { bestand: `media/${id}/stems.wav` }, ...extra });
  ok('verwachteBestanden: audio, video, peaks, onset, stems als <id>/<bestand>', verwachteBestanden(rij('nr00_test')).join() === 'nr00_test/audio.wav,nr00_test/video.mp4,nr00_test/peaks.bin,nr00_test/onset.bin,nr00_test/stems.wav');
  ok('verwachteBestanden: video null en geen stems → niet verwacht', verwachteBestanden(rij('x', { video: null, stems: null })).length === 3);
  const v = vergelijkCompleet([rij('nr00_test'), rij('nr03_test'), rij('weg_test')], b);
  ok(`vergelijkCompleet: 0-byte audio van nr03 = leeg, weg_test mist 5 (${v.leeg.length}/${v.ontbreekt.length})`,
    v.nummers === 3 && v.verwacht === 15 && v.leeg.length === 1 && v.leeg[0].id === 'nr03_test' && v.ontbreekt.length === 5 && v.ontbreekt.every((x) => x.id === 'weg_test'));
}

console.log('25. onbekend is nooit rood');
{
  const ids = ['bestanden', 'instellingen', 'icloud', 'schijf', 'accu', 'audio', 'bluetooth', 'usb', 'avhub', 'servers', 'tailscale', 'backup', 'achtergrond', 'compleet', 'server'];
  const niets = Object.fromEntries(ids.map((id) => [id, { onbekend: 'time-out' }]));
  let rood = 0, nietGrijs = 0, meting = 0;
  for (const profiel of Object.keys(data().profielen)) {
    for (const fase of ['vertrek', 'aankomst']) {
      const r = beoordeel(niets, { profiel, fase, data: data({ hardwareBevestigd: true }), nu: NU });
      rood += r.telling.fout;
      nietGrijs += r.punten.filter((p) => p.id !== 'meting' && !['uit'].includes(p.licht)).length;
      meting += r.punten.filter((p) => p.id === 'meting' && p.licht === 'half').length;
    }
  }
  ok(`elke sonde { onbekend } → geen rood in 5 profielen × 2 fasen (${rood})`, rood === 0);
  ok(`… en alles grijs behalve het punt meting (${nietGrijs} niet grijs)`, nietGrijs === 0);
  ok(`… dat in elk geval oranje is: niet gemeten is nooit groen (review ronde 3; ${meting} van 10)`, meting === 10);
  const r = beoordeel(niets, { profiel: 'apc', fase: 'aankomst', data: data(), nu: NU });
  ok('de sub zegt "niet gemeten: time-out"', punt(r, 'schijf').sub === 'niet gemeten: time-out');
  ok('zonder server-meting geen server-punt (de route levert hem niet)', !punt(beoordeel(goedVertrek(), { profiel: 'apc', data: data(), nu: NU }), 'server'));
}

console.log('26. profielOnbekend en kapotte data');
{
  const r = beoordeel(goedVertrek(), { profiel: 'bestaatniet', data: data(), nu: NU });
  ok('onbekend profiel → het standaardprofiel, profielOnbekend gezet, oranje punt', r.profiel === 'apc' && r.profielOnbekend === 'bestaatniet'
    && punt(r, 'profiel').licht === 'half' && /bestaatniet bestaat niet \(meer\); nu: apc/.test(punt(r, 'profiel').sub));
  const k = beoordeel(goedVertrek(), { profiel: 'apc', data: leesProfielen('kapot'), nu: NU });
  ok('kapotte profielen.json → laptop, oranje punt "niet leesbaar", geen crash', k.profiel === 'laptop' && punt(k, 'profielen').licht === 'half');
}

console.log('27. samenvatting');
{
  const r = beoordeel(goedVertrek({ schijf: { vrijGiB: 10, totaalGiB: 460 }, accu: { bron: 'AC', procent: 60, laderW: 8 } }), { profiel: 'apc', fase: 'vertrek', data: data(), nu: NU });
  const tel = { ok: 0, half: 0, fout: 0, uit: 0 };
  for (const p of r.punten) tel[p.licht]++;
  ok('telling klopt met de punten', JSON.stringify(tel) === JSON.stringify(r.telling));
  ok('licht = de ergste (rood)', r.licht === 'fout' && r.oordeel === 'nog niet vertrekken');
  ok('letOp = de oranje ids', r.letOp.join() === r.punten.filter((p) => p.licht === 'half').map((p) => p.id).join() && r.letOp.includes('accu'));
  const half = beoordeel(goedVertrek({ accu: { bron: 'AC', procent: 60, laderW: 8 } }), { profiel: 'apc', fase: 'vertrek', data: data(), nu: NU });
  ok('alleen oranje → oordeel klaar, licht oranje', half.oordeel === 'klaar' && half.licht === 'half' && half.telling.half === 1);
  ok('kan begint met "fader", kanNiet en let uit het profiel, titel APC', r.kan[0].startsWith('fader') && r.kanNiet.length === 2 && r.let.length === 3 && r.titel === 'APC');
  ok('profielen voor de keuzelijst: id + titel', r.profielen.length === 5 && r.profielen.every((p) => p.id && p.titel));
  ok('t = nu', r.t === NU.getTime());
  ok('maschine: kan begint met "geen fader"', beoordeel(goedVertrek(), { profiel: 'maschine', data: data(), nu: NU }).kan[0].startsWith('geen fader'));
  ok('speellijst alleen als info, niet in het oordeel', beoordeel(goedVertrek({ speellijst: { gedaan: 3, totaal: 40 } }), { profiel: 'apc', data: data(), nu: NU }).info.speellijst.totaal === 40);
}

console.log('28. tegel');
{
  const tegel = (a) => avondpakketTegel(a, NU);
  ok('null → grijs "…"', tegel(null).licht === 'uit' && tegel(null).waarde === '…' && tegel(null).id === 'avondpakket');
  ok('{ ontbreekt } → "oudere server"', tegel({ ontbreekt: true }).sub === 'oudere server');
  ok('{ fout: 500 } → "onbekend (fout)"', tegel({ fout: 500 }).waarde === 'onbekend (fout)' && tegel({ fout: 500 }).licht === 'uit');
  ok('{ overgeslagen } → grijs "niet gemeten" met de reden', tegel({ overgeslagen: 'mixer open: klik om te meten' }).waarde === 'niet gemeten'
    && tegel({ overgeslagen: 'mixer open: klik om te meten' }).sub === 'mixer open: klik om te meten' && tegel({ overgeslagen: 'x' }).licht === 'uit');
  const groen = tegel(beoordeel(goedVertrek(), { profiel: 'apc', data: data(), nu: NU }));
  ok(`groen → "klaar", sub "apc · vertrek · 18:30" (${groen.sub})`, groen.waarde === 'klaar' && groen.licht === 'ok' && groen.sub === 'apc · vertrek · 18:30' && groen.regel === '');
  const half = tegel(beoordeel(goedVertrek({ accu: { bron: 'AC', procent: 60, laderW: 8 }, achtergrond: { ingestWacht: 2 } }), { profiel: 'apc', fase: 'vertrek', data: data(), nu: NU }));
  ok(`2 oranje → "klaar · let op 2" met regel (${half.waarde}; ${half.regel})`, half.waarde === 'klaar · let op 2' && half.licht === 'half' && /^Accu: /.test(half.regel));
  const rood = tegel(beoordeel(goedVertrek({ schijf: { vrijGiB: 10, totaalGiB: 460 }, backup: { fout: 'schijf vol' } }), { profiel: 'apc', fase: 'vertrek', data: data(), nu: NU }));
  ok(`rood → "2 rood" met de regel van het eerste rode punt (${rood.regel})`, rood.waarde === '2 rood' && rood.licht === 'fout' && /^Schijf: /.test(rood.regel));
  const rapport = beoordeel(goedVertrek(), { profiel: 'apc', data: data(), nu: NU });
  ok('bevroren → sub "bevroren: er speelt een deck · 18:30" (F12: met de tijd van de stand)',
    tegel({ ...rapport, bevroren: 'er speelt een deck' }).sub === 'bevroren: er speelt een deck · 18:30');
  ok('bevroren zonder tijd → alleen de reden', tegel({ ...rapport, t: undefined, bevroren: 'er speelt een deck' }).sub === 'bevroren: er speelt een deck');
  ok('titel: één regel per punt', tegel(rapport).titel.split('\n').length === rapport.punten.length);
  ok('rapport van gisteren / eergisteren: zoals de tegel Backup (F14)', avondpakketTegel(rapport, new Date(2026, 9, 11, 9, 0)).sub === 'apc · vertrek · gisteren 18:30'
    && avondpakketTegel(rapport, new Date(2026, 9, 12, 9, 0)).sub === 'apc · vertrek · 10 okt 18:30');
}

console.log('29. privacy');
{
  const m = goedVertrek({
    bestanden: parseBestanden(fx('find-stat-131-HANDGEMAAKT.txt'), fx('find-dataless-3-HANDGEMAAKT.txt'), M),
    instellingen: parseInstellingen(fx('find-instellingen-1-HANDGEMAAKT.txt'), W),
    bluetooth: parseBluetooth({ SPBluetoothDataType: [{ controller_properties: { controller_state: 'attrib_on', controller_address: 'AA:BB:CC:DD:EE:FF' },
      device_connected: [{ 'AirPods 4': { device_address: '11:22:33:44:55:66', device_minorType: 'Headphones' } }] }] }),
    tailscale: parseTailscale({ BackendState: 'Running', TailscaleIPs: ['100.64.0.1'], Self: { HostName: 'mac' },
      Peer: { a: { HostName: 'clayk', Online: true, CurAddr: '100.64.0.3:41641' } } }),
  });
  for (const fase of ['vertrek', 'aankomst']) {
    const s = JSON.stringify(beoordeel(m, { profiel: 'beeld', fase, data: data(), nu: NU }));
    ok(`${fase}: geen /Users/, geen 100.x-IP, geen backupnaam, geen MAC-adres`,
      !s.includes('/Users/') && !/100\.\d+\.\d+\.\d+/.test(s) && !s.includes('library-2026') && !/([0-9A-F]{2}:){5}[0-9A-F]{2}/i.test(s));
  }
  // "clayk" (de beeld-pc) staat al in docs/BEELD.md en in profielen.json (peers): die mag blijven.
  const fixtures = ['audio-luidsprekers.json', 'bluetooth-aan-niets-verbonden.json', 'tailscale-running.json', 'ioreg-accu.txt', 'pmset-ac-65.txt',
    'audio-airpods-10okt.json', 'bluetooth-aan-airpods-10okt.json', 'nep.json']
    .map(fx).join('\n').replaceAll('"clayk"', '"pc"');
  ok('de echte fixtures bevatten geen naam, adres, serienummer of IP (behalve de hostnaam clayk)',
    !/claykrebbers|Clay|@gmail|100\.\d+\.\d+\.\d+|tail[0-9a-f]{6}\b|([0-9A-F]{2}:){5}[0-9A-F]{2}|Serial/i.test(fixtures));
}

// ---- herstelronde 1 (review 7-review-1.md): F2-F9, F11-F13 ---------------------------

console.log('30. paklijst als data (F2)');
{
  const d = data();
  ok(`de data heeft 7 paklijstregels (${d.paklijst.length}), elk met wat en profielen`, d.paklijst.length === 7
    && d.paklijst.every((r) => r.wat && (r.profielen === '*' || Array.isArray(r.profielen))));
  const r = beoordeel(goedVertrek(), { profiel: 'apc', data: d, nu: NU });
  ok('apc vertrek: inpakken bevat "lader ≥ 30 W", de speaker, de stekkerdoos en regel 9 "blijft thuis"', r.inpakken.some((x) => /lader ≥ 30 W/.test(x))
    && r.inpakken.some((x) => /speaker/.test(x)) && r.inpakken.some((x) => /stekkerdoos/.test(x)) && r.inpakken.some((x) => /blijft thuis/.test(x)));
  ok('apc vertrek: inpakken = paklijst (zelfde regels, zelfde volgorde)', JSON.stringify(r.inpakken) === JSON.stringify(r.paklijst));
  ok('volgorde: eerst de PD-hub en de apparaten, dan de dataregels', /PD-ingang/.test(r.paklijst[0]) && /^APC40/.test(r.paklijst[1]) && /^lader/.test(r.paklijst[3]));
  ok('apc vertrek: geen HDMI (alleen beeld)', !r.paklijst.some((x) => /HDMI/.test(x)));
  const laptop = beoordeel(goedVertrek(), { profiel: 'laptop', data: d, nu: NU });
  ok(`laptop (altijd aankomst): paklijst niet leeg (${laptop.paklijst.length}), inpakken leeg, geen speaker`, laptop.fase === 'aankomst' && laptop.paklijst.length === 4
    && laptop.inpakken.length === 0 && !laptop.paklijst.some((x) => /^speaker/.test(x)) && laptop.paklijst.some((x) => /blijft thuis/.test(x)));
  ok('beeld: paklijst bevat "HDMI" en de pc', beoordeel(goedVertrek(), { profiel: 'beeld', data: d, nu: NU }).paklijst.some((x) => /HDMI/.test(x) && /pc/.test(x)));
  // review 2, fix 13: de LPD8 blijft `optioneel` (nooit gemist), maar gaat wel mee via een dataregel, zoals §6 en O5 §3.2 regel 7
  ok('maschine: Maschine MK2 met kabel, geen APC; de LPD8 via een dataregel "als hij meegaat", geen Xboard', (() => {
    const p = paklijstVan('maschine', d);
    return p.some((x) => /^Maschine MK2 \+ USB-B/.test(x)) && !p.some((x) => /APC40/.test(x)) && p.filter((x) => /LPD8/.test(x)).length === 1
      && p.some((x) => /^LPD8 .*als hij meegaat/.test(x)) && !p.some((x) => /Xboard/.test(x));
  })());
  ok('alles wel met LPD8, apc en beeld zonder (keuze 11)', paklijstVan('alles', d).some((x) => /LPD8/.test(x))
    && !paklijstVan('apc', d).some((x) => /LPD8/.test(x)) && !paklijstVan('beeld', d).some((x) => /LPD8/.test(x)));
  const aank = beoordeel(goedAankomst(), { profiel: 'apc', data: d, nu: NU });
  ok('aankomst: inpakken leeg, paklijst blijft (voor het kaartje)', aank.fase === 'aankomst' && aank.inpakken.length === 0 && aank.paklijst.length === r.paklijst.length);
  const kapot = (paklijst) => leesProfielen(JSON.stringify({ ...JSON.parse(ECHTE_DATA), paklijst })).paklijst;
  ok('kapotte paklijst → [] of alleen de bruikbare regels, nooit een throw', kapot('nee').length === 0 && kapot({}).length === 0
    && kapot([null, 3, { wat: '' }, { wat: 'x', profielen: 'apc' }, { wat: 'goed', profielen: ['apc'] }]).length === 1);
  ok('terugval (kapotte profielen.json): paklijst [] en geen throw', leesProfielen('kapot').paklijst.length === 0
    && Array.isArray(beoordeel(goedVertrek(), { data: leesProfielen('kapot'), nu: NU }).paklijst));
  ok('een onbekend profiel → paklijstVan geeft []', paklijstVan('bestaatniet', d).length === 0);
}

console.log('31. maschine en alles: goed ingepakt vertrek is klaar zonder let op (F3, F11)');
{
  for (const profiel of ['apc', 'beeld', 'maschine', 'alles']) {
    for (const [naam, audio] of [['AirPods (echt, 13:47)', 'audio-airpods-10okt.json'], ['AirPods (HANDGEMAAKT)', 'audio-airpods-HANDGEMAAKT.json'],
      ['luidsprekers (echt, 12:26)', 'audio-luidsprekers.json']]) {
      const r = beoordeel(goedVertrek({ audio: parseAudio(fx(audio)) }), { profiel, data: data(), nu: NU });
      ok(`${profiel} + ${naam}: fase vertrek, 0 rood, 0 oranje, klaar (${r.fase}; ${r.letOp})`,
        r.fase === 'vertrek' && r.telling.fout === 0 && r.telling.half === 0 && r.oordeel === 'klaar');
    }
  }
  ok('maschine aankomst + hub dicht blijft rood', beoordeel(goedAankomst(), { profiel: 'maschine', data: data(), nu: NU }).punten.find((p) => p.id === 'avhub').licht === 'fout');
}

console.log('32. fase auto: alleen een 4-kanaals standaard telt (F4)');
{
  const d = data();
  const std = (naam, transport, uit) => [{ naam: 'MacBook Air luidsprekers', transport: 'builtin', uit: 2, in: 0, standaardUit: false, standaardSysteem: true },
    { naam, transport, uit, in: 0, standaardUit: true, standaardSysteem: false }];
  ok('HDMI-scherm met 2 kanalen als standaard → vertrek', kiesFase(goedVertrek({ audio: std('iiyama PL2792Q', 'hdmi', 2) }), d.profielen.apc, d) === 'vertrek');
  ok('USB-C-naar-jack-dongle met 2 kanalen → vertrek', kiesFase(goedVertrek({ audio: std('USB-C to 3.5mm Headphone Jack Adapter', 'usb', 2) }), d.profielen.apc, d) === 'vertrek');
  ok('DisplayPort met 8 kanalen → aankomst (niet ingebouwd, ≥ 4)', kiesFase(goedVertrek({ audio: std('Scherm', 'displayport', 8) }), d.profielen.apc, d) === 'aankomst');
  const r = beoordeel(goedVertrek({ audio: std('iiyama PL2792Q', 'hdmi', 2) }), { profiel: 'apc', data: d, nu: NU });
  ok('apc met HDMI thuis: "klaar" zonder let op', r.oordeel === 'klaar' && r.telling.half === 0);
}

console.log('33. privacy: foutteksten door schoon() (F5)');
{
  const fout = "ENOSPC: no space left on device, copyfile '/Users/x/varve/media/library.db' -> '/Users/x/varve/media/backups/library-2026-10-10_12-00-00.db'";
  const m = goedVertrek({ backup: { ...goedVertrek().backup, fout }, bestanden: { onbekend: 'Command failed: find /Users/x/media -type f -exec stat -f %z %N {} +' } });
  for (const fase of ['vertrek', 'aankomst']) {
    const s = JSON.stringify(beoordeel(m, { profiel: 'apc', fase, data: data(), nu: NU }));
    ok(`${fase}: backup-fout en sondefout zonder /Users/ en zonder backupnaam`, !s.includes('/Users/') && !s.includes('library-2026'));
  }
  const b = punt(beoordeel(m, { profiel: 'apc', data: data(), nu: NU }), 'backup');
  ok(`de reden blijft leesbaar (${b.sub})`, b.licht === 'fout' && /ENOSPC/.test(b.sub) && /'backups\/de kopie'/.test(b.sub) && /'library\.db'/.test(b.sub));
  ok('een pad met spaties tussen quotes: alleen wat onder media/ staat', schoon("open '/Users/x/Desktop/1. Projects/Youtube mixer/media/nr01/stems.wav'") === "open 'nr01/stems.wav'");
  ok('buiten media/: alleen de laatste naam', schoon('lezen van /private/var/folders/ab/T/varve-x/profielen.json mislukt') === 'lezen van profielen.json mislukt');
  ok('IP-adres → <ip>', schoon('verbinding met 100.64.0.3:41641 weigert') === 'verbinding met <ip>:41641 weigert');
  ok('gewone zinnen blijven heel (~/Projects, 1/2, filter/fx, nr01/stems.wav)',
    schoon('npm start -- studio in ~/Projects/AV-app-hub · zaal 1/2 · filter/fx · nr01_test/stems.wav (3,9 GB)')
      === 'npm start -- studio in ~/Projects/AV-app-hub · zaal 1/2 · filter/fx · nr01_test/stems.wav (3,9 GB)');
  ok('schoon(null/undefined) → ""', schoon(null) === '' && schoon(undefined) === '');
}

console.log('34. samengesteld apparaat met "Scarlett" in de naam (F7)');
{
  const d = data();
  const audio = [{ naam: 'MacBook Air luidsprekers', transport: 'builtin', uit: 2, in: 0, standaardUit: true, standaardSysteem: true },
    { naam: 'Scarlett + koptelefoon', transport: 'aggregate', uit: 4, in: 2, standaardUit: false, standaardSysteem: false }];
  const m = goedVertrek({ audio });
  ok('geen USB-Scarlett → fase vertrek', kiesFase(m, d.profielen.apc, d) === 'vertrek');
  ok('aankomst: Scarlett niet "aangesloten"', punt(beoordeel(m, { profiel: 'apc', fase: 'aankomst', data: d, nu: NU }), 'scarlett').waarde === 'niet gezien');
  const usb = goedVertrek({ audio: [...audio, { naam: 'Scarlett 2i2 USB', transport: 'usb', uit: 2, in: 2, standaardUit: false, standaardSysteem: false }] });
  ok('de Scarlett zelf als USB-audio → gezien, aankomst', kiesFase(usb, d.profielen.apc, d) === 'aankomst'
    && punt(beoordeel(usb, { profiel: 'apc', data: d, nu: NU }), 'scarlett').licht === 'ok');
}

console.log('35. accu bijna leeg aan een zwakke lader (F8)');
{
  const r = (accu, fase) => punt(beoordeel(goedVertrek({ accu }), { profiel: 'apc', fase, data: data(), nu: NU }), 'accu');
  ok('aankomst, 12 %, 8 W → rood "zwakke lader"', r({ bron: 'AC', procent: 12, laderW: 8 }, 'aankomst').licht === 'fout' && /zwakke lader \(8 W\)/.test(r({ bron: 'AC', procent: 12, laderW: 8 }, 'aankomst').sub));
  ok('vertrek, 12 %, 8 W → ook rood', r({ bron: 'AC', procent: 12, laderW: 8 }, 'vertrek').licht === 'fout');
  ok('aankomst, 12 %, 30 W → niet rood (hij laadt)', r({ bron: 'AC', procent: 12, laderW: 30 }, 'aankomst').licht !== 'fout');
  ok('aankomst, 12 %, lader zonder vermogen → niet rood (onbekend is nooit rood)', r({ bron: 'AC', procent: 12, laderW: null }, 'aankomst').licht !== 'fout');
}

console.log('36. backup: gewijzigdSinds null (F9)');
{
  const b = punt(beoordeel(goedVertrek({ backup: { ...goedVertrek().backup, gewijzigdSinds: null } }), { profiel: 'apc', data: data(), nu: NU }), 'backup');
  ok(`null → grijs, waarde = de tijd, "niet te zien" (${b.sub})`, b.licht === 'uit' && b.waarde === '12:00' && /niet te zien/.test(b.sub) && /gaat mee in de tas/.test(b.sub));
}

console.log('37. optioneel apparaat, USB niet gemeten (F13)');
{
  const lpd = punt(beoordeel(goedAankomst({ usb: { onbekend: 'time-out' }, avhub: { draait: true } }), { profiel: 'maschine', fase: 'aankomst', data: data(), nu: NU }), 'lpd8');
  ok(`LPD8 (optioneel) bij aankomst, usb onbekend → "?" "niet gemeten: time-out" (${lpd.waarde}; ${lpd.sub})`, lpd.licht === 'uit' && lpd.waarde === '?' && lpd.sub === 'niet gemeten: time-out');
}

// ---- herstelronde 2 (review 7-review-2.md) ----------------------------------------------

console.log('38. vals groen: USB en geluid niet gemeten bij fase auto (review 2, fix 1)');
{
  const vg = goedVertrek();
  const alleenBinnen = { usb: { onbekend: 'time-out' }, audio: { onbekend: 'time-out' }, backup: vg.backup, achtergrond: vg.achtergrond };
  const r = beoordeel(alleenBinnen, { profiel: 'apc', data: data(), nu: NU });
  ok(`apc, auto, usb en audio onbekend, backup en achtergrond groen → niet groen (${r.licht}), punt fase oranje`,
    r.licht !== 'ok' && r.licht === 'half' && punt(r, 'fase')?.licht === 'half' && punt(r, 'fase').waarde === 'niet te bepalen');
  ok(`… de sub zegt waarom en wat te doen (${punt(r, 'fase').sub})`, punt(r, 'fase').sub === 'USB en geluid niet gemeten (time-out): kies vertrek of aankomst');
  ok('… en de tegel is oranje, met de fase als regel', avondpakketTegel(r, NU).licht === 'half' && /^Fase: USB en geluid niet gemeten/.test(avondpakketTegel(r, NU).regel));
  const b = beoordeel(goedAankomst({ usb: { onbekend: 'time-out' }, audio: { onbekend: 'time-out' }, accu: { bron: 'AC', procent: 90, laderW: 30 } }), { profiel: 'apc', data: data(), nu: NU });
  ok(`aangekomen maar usb en audio time-out (proef geval 2) → niet "klaar" in het groen (${b.licht}, ${b.telling.half} oranje)`, b.licht !== 'ok' && !!punt(b, 'fase'));
  ok('fase vertrek gekozen → geen fase-punt', !punt(beoordeel(alleenBinnen, { profiel: 'apc', fase: 'vertrek', data: data(), nu: NU }), 'fase'));
  ok('fase aankomst gekozen → geen fase-punt', !punt(beoordeel(alleenBinnen, { profiel: 'apc', fase: 'aankomst', data: data(), nu: NU }), 'fase'));
  ok('laptop (niets in te pakken) → geen fase-punt', !punt(beoordeel(alleenBinnen, { profiel: 'laptop', data: data(), nu: NU }), 'fase'));
  ok('alleen usb onbekend (audio gemeten) → geen fase-punt', !punt(beoordeel({ ...alleenBinnen, audio: vg.audio }, { profiel: 'apc', data: data(), nu: NU }), 'fase'));
  const leeg = beoordeel({ backup: vg.backup, achtergrond: vg.achtergrond }, { profiel: 'maschine', data: data(), nu: NU });
  ok(`nog nooit gemeten (metingen leeg, bevroren) → fase-punt zonder reden (${punt(leeg, 'fase')?.sub})`, leeg.licht === 'half' && punt(leeg, 'fase')?.sub === 'USB en geluid niet gemeten: kies vertrek of aankomst');
  ok('"fase" in bekend → grijs (Clay accepteert het bewust), rood nooit', punt(beoordeel(alleenBinnen, { profiel: 'apc', data: data({ bekend: ['fase'] }), nu: NU }), 'fase').licht === 'uit');
}

console.log('39. fase uit profielen.json (review 2, fix 8)');
{
  const vg = goedVertrek();
  const a = beoordeel(vg, { profiel: 'apc', data: data({ fase: 'aankomst' }), nu: NU });
  ok(`data fase aankomst, niets aangesloten → aankomst, faseBron data, niet gekozen (${a.fase}, ${a.faseBron})`, a.fase === 'aankomst' && a.faseBron === 'data' && a.faseGekozen === false);
  const v = beoordeel(goedAankomst(), { profiel: 'apc', data: data({ fase: 'vertrek' }), nu: NU });
  ok('data fase vertrek, alles aangesloten → toch vertrek (de data wint van auto)', v.fase === 'vertrek' && v.faseBron === 'data');
  ok('een keuze in tegel/CLI wint van de data', beoordeel(vg, { profiel: 'apc', fase: 'vertrek', data: data({ fase: 'aankomst' }), nu: NU }).fase === 'vertrek');
  ok('data fase auto → auto (faseBron auto)', beoordeel(vg, { profiel: 'apc', data: data(), nu: NU }).faseBron === 'auto');
  ok('data fase vast + usb/audio onbekend → geen fase-punt (de fase raadt niet)', !punt(beoordeel({ usb: { onbekend: 'x' }, audio: { onbekend: 'x' } }, { profiel: 'apc', data: data({ fase: 'vertrek' }), nu: NU }), 'fase'));
  ok('leesProfielen: fase "onzin" → auto', leesProfielen(JSON.stringify({ ...JSON.parse(ECHTE_DATA), fase: 'onzin' })).fase === 'auto');
}

console.log('40. profielnamen die op elk object staan (review 2, fix 7)');
{
  for (const naam of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = beoordeel(goedVertrek(), { profiel: naam, data: data(), nu: NU });
    ok(`profiel ${naam} → profielOnbekend, het standaardprofiel (${r.profiel})`, r.profielOnbekend === naam && r.profiel === 'apc' && r.titel === 'APC');
  }
  ok('paklijstVan("constructor") → []', paklijstVan('constructor', data()).length === 0 && !heeftProfiel(data(), 'toString') && heeftProfiel(data(), 'apc'));
  ok('standaard "constructor" in de data → het eerste profiel', leesProfielen(JSON.stringify({ ...JSON.parse(ECHTE_DATA), standaard: 'constructor' })).standaard === 'laptop');
  const vies = leesProfielen('{"profielen": {"__proto__": {"titel": "x"}, "apc": {"titel": "APC"}}, "apparaten": {"__proto__": {"naam": "x"}}}');
  ok('"__proto__" als profiel of apparaat in de JSON → genegeerd, geen ander prototype', Object.keys(vies.profielen).join() === 'apc'
    && Object.getPrototypeOf(vies.profielen) === Object.prototype && Object.keys(vies.apparaten).length === 0);
}

console.log('41. profielen.json is een instelling (review 2, fix 5)');
{
  const x = parseInstellingen(`${W}/avondpakket/profielen.json\n`, W);
  ok('avondpakket/profielen.json → groep instellingen', x.length === 1 && x[0].groep === 'instellingen' && x[0].pad === 'avondpakket/profielen.json');
  const p = punt(beoordeel(goedVertrek({ instellingen: x }), { profiel: 'apc', data: data(), nu: NU }), 'instellingen');
  ok(`uitgeplaatst → rood "zonder internet geen profielen" (${p.sub})`, p.licht === 'fout' && /zonder internet geen profielen/.test(p.sub));
}

console.log('42. compleet zonder de hele rij (review 2, fix 16)');
{
  const b = parseBestanden(fx('find-stat-131-HANDGEMAAKT.txt'), '', M);
  const rij = (id, extra = {}) => ({ id, titel: 'lang', secties: { veel: 'x' }, audio: `media/${id}/audio.wav`, video: `media/${id}/video.mp4`,
    peaks: { bestand: `media/${id}/peaks.bin` }, onset: { bestand: `media/${id}/onset.bin` }, stems: { bestand: `media/${id}/stems.wav` }, ...extra });
  const rijen = [rij('nr00_test'), rij('nr03_test'), rij('weg_test')];
  const paden = verwachtePaden(rijen, M);
  ok('verwachtePaden: alleen { id, paden }', paden.length === 3 && Object.keys(paden[0]).join() === 'id,paden' && paden[0].paden.length === 5);
  ok('vergelijkCompleet op { id, paden } = op de hele rij', JSON.stringify(vergelijkCompleet(paden, b, M)) === JSON.stringify(vergelijkCompleet(rijen, b, M)));
  ok('verwachtePaden van geen lijst → []', verwachtePaden(null).length === 0);
}

console.log('43. tegel: automatisch, alleen het goedkope (review 2, fix 4)');
{
  const r = beoordeel(goedVertrek(), { profiel: 'apc', data: data(), nu: new Date(2026, 9, 10, 18, 35) });
  const t = avondpakketTegel({ ...r, deels: { volledig: NU.getTime() } }, new Date(2026, 9, 10, 18, 36));
  ok(`deels → sub "apc · vertrek · 18:30 · deels 18:35" (${t.sub})`, t.sub === 'apc · vertrek · 18:30 · deels 18:35');
  ok('… en de title begint met wat er wel en niet opnieuw gemeten is', /^Automatisch om 18:35 alleen accu, schijf, iCloud, AV-hub en servers opnieuw; apparaten, geluid en media van 18:30\. Klik om alles te meten\.$/m.test(t.titel.split('\n')[0])
    && t.titel.split('\n').length === r.punten.length + 1);
  const nooit = avondpakketTegel({ ...r, deels: { volledig: null } }, new Date(2026, 9, 10, 18, 36));
  ok(`deels zonder volledige meting → "apc · vertrek · deels 18:35", "nog niet gemeten" (${nooit.sub})`, nooit.sub === 'apc · vertrek · deels 18:35' && /media nog niet gemeten/.test(nooit.titel));
  ok('bevroren gaat voor deels', avondpakketTegel({ ...r, deels: { volledig: 1 }, bevroren: 'er speelt een deck' }, NU).sub === 'bevroren: er speelt een deck · 18:35');
}

// ---- review ronde 3 (spoorrapport §5, fix/draagbaar) ------------------------------------

console.log('44. gekozen fase, kern niet gemeten: nooit groen (review ronde 3)');
{
  const vg = goedVertrek();
  const alleenBinnen = { usb: { onbekend: 'er speelt een deck' }, audio: { onbekend: 'er speelt een deck' }, backup: vg.backup, achtergrond: vg.achtergrond };
  const a = beoordeel(alleenBinnen, { profiel: 'apc', fase: 'aankomst', data: data(), nu: NU });
  ok(`aankomst gekozen, er speelt een deck, nooit gemeten → niet groen (${a.licht}), punt meting oranje`,
    a.licht === 'half' && a.oordeel === 'klaar' && punt(a, 'meting')?.licht === 'half' && punt(a, 'meting').waarde === 'niet gemeten' && !punt(a, 'fase'));
  ok(`… de sub zegt wat en waarom (${punt(a, 'meting').sub})`, punt(a, 'meting').sub === 'USB en geluid niet gemeten (er speelt een deck): meet opnieuw vóór je begint');
  ok('… en de tegel is oranje met de meting als regel', avondpakketTegel(a, NU).licht === 'half' && /^Meting: USB en geluid niet gemeten/.test(avondpakketTegel(a, NU).regel));
  const v = beoordeel(alleenBinnen, { profiel: 'apc', fase: 'vertrek', data: data(), nu: NU });
  ok(`vertrek gekozen, media en instellingen niet gemeten → oranje (${punt(v, 'meting')?.sub})`, v.licht === 'half' && punt(v, 'meting')?.sub === 'media en instellingen niet gemeten: meet opnieuw vóór je vertrekt');
  ok('vaste fase uit profielen.json → hetzelfde punt', punt(beoordeel(alleenBinnen, { profiel: 'apc', data: data({ fase: 'aankomst' }), nu: NU }), 'meting')?.licht === 'half');
  const auto = beoordeel({ ...vg, bestanden: { onbekend: 'time-out' }, instellingen: { onbekend: 'time-out' } }, { profiel: 'apc', data: data(), nu: NU });
  ok(`auto koos vertrek (usb gemeten), find time-out → oranje meting, geen fase-punt (${auto.fase})`, auto.fase === 'vertrek' && punt(auto, 'meting')?.licht === 'half' && !punt(auto, 'fase'));
  const beide = beoordeel(alleenBinnen, { profiel: 'apc', data: data(), nu: NU });
  ok('auto met usb en audio onbekend → alleen het punt fase, niet ook meting', !!punt(beide, 'fase') && !punt(beide, 'meting'));
  ok('alleen usb onbekend bij aankomst (audio gemeten) → geen meting-punt', !punt(beoordeel(goedAankomst({ usb: { onbekend: 'x' } }), { profiel: 'apc', fase: 'aankomst', data: data(), nu: NU }), 'meting'));
  ok('alleen media onbekend bij vertrek (instellingen gemeten) → geen meting-punt', !punt(beoordeel(goedVertrek({ bestanden: { onbekend: 'x' } }), { profiel: 'apc', fase: 'vertrek', data: data(), nu: NU }), 'meting'));
  ok('goed vertrek en goede aankomst → geen meting-punt', !punt(beoordeel(vg, { profiel: 'apc', fase: 'vertrek', data: data(), nu: NU }), 'meting')
    && !punt(beoordeel(goedAankomst(), { profiel: 'apc', fase: 'aankomst', data: data(), nu: NU }), 'meting'));
  const laptop = beoordeel({ usb: { onbekend: 'x' }, audio: { onbekend: 'x' }, bestanden: vg.bestanden, instellingen: vg.instellingen }, { profiel: 'laptop', data: data(), nu: NU });
  ok('laptop (niets in te pakken): de kern is media en instellingen, niet USB en geluid', laptop.fase === 'aankomst' && !punt(laptop, 'meting')
    && punt(beoordeel(alleenBinnen, { profiel: 'laptop', data: data(), nu: NU }), 'meting')?.sub === 'media en instellingen niet gemeten: meet opnieuw vóór je begint');
  ok('"meting" in bekend → grijs, rood nooit', punt(beoordeel(alleenBinnen, { profiel: 'apc', fase: 'aankomst', data: data({ bekend: ['meting'] }), nu: NU }), 'meting').licht === 'uit');
}

console.log('45. Linux: parsers (test/fixtures/avondpakket/linux, LEESMIJ.md)');
{
  const lx = (naam) => readFileSync(MAP + 'linux/' + naam, 'utf8');
  const LM = '/tmp/varve-linux/media';
  // De fout die dit spoor oplost: de Mac-opdracht (BSD stat -f '%z %N') op GNU stat, echt vastgelegd.
  const mis = parseBestanden(lx('stat-f-stdout.txt'), '', LM);
  ok(`echt: BSD stat -f op GNU stat geeft geen enkele regel "<bytes> <pad>" (totaal ${mis.totaal}): daarom per platform`, mis.totaal === 0);
  ok('echt: GNU find stopt op -flags (stderr "unknown predicate")', /unknown predicate `-flags'/.test(lx('find-flags-stderr.txt')));
  const b = parseBestanden(lx('find-stat-9.txt'), '', LM);
  ok(`echt: GNU stat -c '%s %n' → 9 bestanden, relatief, nr01 audio 0 B (${b.totaal}, ${b.bytesTotaal})`, b.totaal === 9 && b.paden.has('nr00_test/audio.wav')
    && b.bytes.get('nr01_test/audio.wav') === 0 && b.bytes.get('lokaal-0a1b2c3d4e5f/audio.wav') === 9600 && b.dataless.length === 0 && ![...b.paden].some((x) => x.startsWith('/')));
  const df = parseDf(lx('df-k.txt'));
  ok(`echt: GNU df -k → vrij en totaal (${df?.vrijGiB} van ${df?.totaalGiB} GiB)`, df && Math.round(df.vrijGiB) === 22 && Math.round(df.totaalGiB) === 252);

  ok('echt: lege /sys/class/power_supply (container, vaste pc) → null', parsePowerSupply(lx('power-supply-leeg.txt')) === null);
  ok('alleen een muisaccu (SCOPE=Device) → null, nooit "op de accu"', parsePowerSupply(lx('power-supply-pc-muis-HANDGEMAAKT.txt')) === null);
  const ac = parsePowerSupply(lx('power-supply-laptop-ac-HANDGEMAAKT.txt'));
  ok(`laptop aan USB-PD: AC, 72 %, charging, 20 V × 3,25 A = 65 W, gezondheid 90 %, 212 cycli; de muis (9 %) telt niet (${JSON.stringify(ac)})`,
    ac.bron === 'AC' && ac.procent === 72 && ac.toestand === 'charging' && ac.laderW === 65 && ac.gezondheid === 90 && ac.cycli === 212 && ac.resterend === null);
  const accu = parsePowerSupply(lx('power-supply-laptop-accu-HANDGEMAAKT.txt'));
  ok(`laptop op de accu: accu, 18 %, discharging, geen lader, gezondheid uit CHARGE_* (90), cycli 0 → null (${JSON.stringify(accu)})`,
    accu.bron === 'accu' && accu.procent === 18 && accu.toestand === 'discharging' && accu.laderW === null && accu.gezondheid === 90 && accu.cycli === null);
  const regel = (map, k, v) => `/sys/class/power_supply/${map}/uevent:POWER_SUPPLY_${k}=${v}`;
  const zonderVoeding = [regel('BAT0', 'TYPE', 'Battery'), regel('BAT0', 'STATUS', 'Full'), regel('BAT0', 'CAPACITY', '100')].join('\n');
  ok('zonder voedingsknoop: de STATUS beslist (Full → AC, "charged")', parsePowerSupply(zonderVoeding).bron === 'AC' && parsePowerSupply(zonderVoeding).toestand === 'charged');
  const mains = [regel('AC', 'TYPE', 'Mains'), regel('AC', 'ONLINE', '1'), regel('BAT0', 'TYPE', 'Battery'), regel('BAT0', 'STATUS', 'Not charging'), regel('BAT0', 'CAPACITY', '80')].join('\n');
  ok('Mains-adapter: AC, "not charging", geen vermogen (laderW null: geen vals "zwakke lader")', parsePowerSupply(mains).bron === 'AC' && parsePowerSupply(mains).laderW === null
    && parsePowerSupply(mains).toestand === 'not charging');
  const twee = [regel('BAT0', 'TYPE', 'Battery'), regel('BAT0', 'ENERGY_NOW', '10'), regel('BAT0', 'ENERGY_FULL', '20'), regel('BAT0', 'CAPACITY', '50'),
    regel('BAT1', 'TYPE', 'Battery'), regel('BAT1', 'ENERGY_NOW', '60'), regel('BAT1', 'ENERGY_FULL', '60'), regel('BAT1', 'CAPACITY', '100')].join('\n');
  ok(`twee accu's (ThinkPad): naar energie gewogen, 70/80 = 88 % (${parsePowerSupply(twee).procent})`, parsePowerSupply(twee).procent === 88);

  const ls = parseLsusb(lx('lsusb-apc-scarlett-maschine-HANDGEMAAKT.txt'));
  ok(`lsusb: vijf apparaten, root hubs (1d6b) niet (${ls.length})`, ls.length === 5 && !ls.some((x) => x.vid === '0x1d6b'));
  ok('lsusb: een regel zonder naam (usb.ids kent hem niet) houdt zijn id', ls.some((x) => x.vid === '0x09e8' && x.pid === '0x0029' && x.naam === ''));
  const h = herkenUsb(ls, data().apparaten);
  ok(`lsusb + profielen.json: APC op id, Scarlett op naam, Maschine op id; LPD8/Xboard niet (${JSON.stringify(h)})`, h.apc40 && h.scarlett && h.maschine && !h.lpd8 && !h.xboard);
  ok('lsusb zonder controllers → niets herkend', Object.values(herkenUsb(parseLsusb(lx('lsusb-leeg-HANDGEMAAKT.txt')), data().apparaten)).every((x) => !x));
  const sys = parseSysUsb(lx('sys-usb-apc-scarlett-HANDGEMAAKT.txt'));
  ok(`sysfs: APC, Scarlett en een hub, de root hub niet, geen pad (${JSON.stringify(sys)})`, sys.length === 3 && sys.some((x) => x.naam === 'APC40 mkII' && x.vid === '0x09e8')
    && !JSON.stringify(sys).includes('/sys/'));
  const hs = herkenUsb(sys, data().apparaten);
  ok('sysfs + profielen.json: APC en Scarlett', hs.apc40 && hs.scarlett && !hs.maschine);
  ok('lsusb en sysfs samen: de APC één keer', voegUsbSamen(ls, sys).filter((x) => x.vid === '0x09e8').length === 1);
}

console.log('46. Linux: het oordeel (geen vals rood, geen vals groen)');
{
  const lx = (naam) => readFileSync(MAP + 'linux/' + naam, 'utf8');
  const LM = '/tmp/varve-linux/media';
  const nh = { onbekend: 'niet op dit platform' };
  const nhm = { onbekend: 'niet op dit platform (de live-mixer draait op de Mac)' };
  const bestanden = { ...parseBestanden(lx('find-stat-9.txt'), '', LM), bestaat: true, datalessNvt: true };
  const rij = (id, velden) => ({ id, ...Object.fromEntries(velden.map((v) => [v, `media/${id}/${v === 'audio' ? 'audio.wav' : 'video.mp4'}`])) });
  const heel = vergelijkCompleet(verwachtePaden([rij('nr00_test', ['audio', 'video']), rij('lokaal-0a1b2c3d4e5f', ['audio'])], 'media'), bestanden, LM);
  const pc = (wijzig = {}) => goedVertrek({
    bestanden, instellingen: nh, icloud: nh, audio: nhm, bluetooth: nhm,
    schijf: parseDf(lx('df-k.txt')), accu: { onbekend: 'geen accu (vaste pc?)' },
    usb: parseLsusb(lx('lsusb-leeg-HANDGEMAAKT.txt')), compleet: heel, ...wijzig,
  });
  const r = beoordeel(pc(), { profiel: 'apc', data: data(), nu: NU });
  ok(`media groen met 9 bestanden, en het zegt dat iCloud hier niet geldt (${punt(r, 'media').sub})`, punt(r, 'media').licht === 'ok' && punt(r, 'media').waarde === '9 lokaal'
    && /n\.v\.t\. op dit platform/.test(punt(r, 'media').sub));
  ok(`instellingen grijs "niet gemeten: niet op dit platform", nooit "lokaal" (${punt(r, 'instellingen').licht})`, punt(r, 'instellingen').licht === 'uit'
    && punt(r, 'instellingen').sub === 'niet gemeten: niet op dit platform');
  ok('iCloud en accu grijs', punt(r, 'icloud').licht === 'uit' && punt(r, 'accu').licht === 'uit' && /vaste pc/.test(punt(r, 'accu').sub));
  ok(`compleet groen met een library die er echt is (${punt(r, 'compleet').waarde})`, punt(r, 'compleet').licht === 'ok' && heel.nummers === 2);
  ok('fase auto: USB gemeten (niets aangesloten) → vertrek, geen punt fase of meting', r.fase === 'vertrek' && !punt(r, 'fase') && !punt(r, 'meting'));
  const nul = vergelijkCompleet(verwachtePaden([rij('nr01_test', ['audio'])], 'media'), bestanden, LM);
  ok('compleet rood alleen voor wat echt mist: de audio van nr01 is 0 B', punt(beoordeel(pc({ compleet: nul }), { profiel: 'apc', data: data(), nu: NU }), 'compleet').licht === 'fout'
    && nul.leeg.length === 1 && nul.ontbreekt.length === 0);
  const aan = beoordeel(pc({ usb: parseLsusb(lx('lsusb-apc-scarlett-maschine-HANDGEMAAKT.txt')) }), { profiel: 'apc', data: data(), nu: NU });
  ok(`APC en Scarlett aan de pc → aankomst; APC en Scarlett groen; geluid grijs "niet op dit platform" (${aan.fase})`, aan.fase === 'aankomst' && punt(aan, 'apc40').licht === 'ok'
    && punt(aan, 'scarlett').licht === 'ok' && punt(aan, 'geluid').licht === 'uit' && /de live-mixer draait op de Mac/.test(punt(aan, 'geluid').sub));
  ok('aankomst op de pc: Bluetooth grijs, geen punt meting (USB is gemeten)', punt(aan, 'bluetooth').licht === 'uit' && !punt(aan, 'meting'));
  const laptop = beoordeel(pc({ accu: parsePowerSupply(lx('power-supply-laptop-accu-HANDGEMAAKT.txt')) }), { profiel: 'apc', fase: 'vertrek', data: data(), nu: NU });
  ok('Linux-laptop op de accu met 18 % → accu rood (echt, niet vals)', punt(laptop, 'accu').licht === 'fout');
  const geenUsb = beoordeel(pc({ usb: { onbekend: 'geen lsusb en geen USB in sysfs' } }), { profiel: 'apc', data: data(), nu: NU });
  ok('geen lsusb en geen sysfs (container) → fase niet te bepalen (oranje), nooit groen', geenUsb.licht !== 'ok' && punt(geenUsb, 'fase')?.licht === 'half');
  const zonder = goedVertrek({ bestanden: parseBestanden(lx('find-stat-9.txt'), '', LM) });
  ok('zonder datalessNvt (de Mac) staat er niets over het platform in de sub', !/platform/.test(punt(beoordeel(zonder, { profiel: 'apc', data: data(), nu: NU }), 'media').sub));
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles groen');
