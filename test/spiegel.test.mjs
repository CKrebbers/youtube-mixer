// Het scherm als spiegel van de APC: welke control waar staat en wat hij doet.
// Puur rekenwerk tegen de echte standaardmapping, geen DOM.
import { readFileSync } from 'node:fs';

const { Mapping } = await import('../src/control/mapping.js');
const { Lagen } = await import('../src/control/lagen.js');
const apc = (await import('../src/control/devices/apc40mk2.js')).default;
const P = await import('../src/ui/spiegel-plan.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const doc = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));
const lagen = new Lagen();
const m = new Mapping({ read: () => null, invoke: () => {}, lagen: () => lagen.actief() });
m.load(doc);
const lees = (sig, focus = 1, shift = false) => P.leesControl(m, sig, { shift, vars: { focus } });

// ---- de indeling -----------------------------------------------------------

ok('elke gespiegelde control bestaat op het apparaat', P.ALLE.every((c) => apc.label(c.sig)));
ok('geen control staat twee keer op het scherm', new Set(P.ALLE.map((c) => c.sig)).size === P.ALLE.length);
ok('een kolom heeft 13 controls, van knob tot fader',
  P.kolomControls(1).length === 13 && P.kolomControls(1)[0].rol === 'knob' && P.kolomControls(1).at(-1).rol === 'fader');
ok('pad 1 van kolom 1 is de BOVENSTE rij (noot 0x20), niet 0x00', P.kolomControls(1)[1].sig === 'note:0:32');
ok('pad 5 van kolom 8 is rechtsonder (noot 0x07)', P.kolomControls(8)[5].sig === 'note:0:7');
ok('track select 3 zit op kanaal 2', P.kolomControls(3).find((c) => c.rol === 'select').sig === 'note:2:51');
ok('device knobs 1-8 zijn cc 16-23', P.DEVICE_KNOBS.map((c) => c.sig).join() === [16, 17, 18, 19, 20, 21, 22, 23].map((n) => `cc:0:${n}`).join());
// De Q van quantize staat in de hoek van Lock; spiegel.js en styles.css
// (.fd-quantize) rekenen met rij 2, knop 2 van de device-knoppen.
ok('Lock is rij 2, knop 2 van de device-knoppen (daar staat de Q van quantize)',
  P.DEVICE_KNOPPEN[1][1].sig === 'note:0:63' && apc.label('note:0:63') === 'device lock');

// ---- wat de knoppen doen ---------------------------------------------------

ok('kolom 3 activator = play van track 3', lees('note:2:50')?.action === 'track.3.play');
ok('kolom 5 fader = volume track 5', lees('cc:4:7')?.action === 'track.5.fader');
ok('track knob 2 = filter track 2', lees('cc:0:49')?.action === 'track.2.filter');
ok('clip stop met shift op het scherm = loop weg', lees('note:0:52')?.actionShift === 'track.1.loop.exit');
ok('track select shift = tweede (window.R.show)', lees('note:3:51')?.actionShift === 'window.R.show.4');
ok('tooltip noemt de fysieke knop en wat hij doet', /^APC: activator 3 — play/.test(lees('note:2:50').titel));

ok('device knob 1 in de strip = trim van de focus', lees('cc:0:16', 2)?.action === 'track.2.trim');
ok('focuswissel verandert de device knob', lees('cc:0:16', 6)?.action === 'track.6.trim');
lagen.druk('device', 'view', true); lagen.druk('device', 'view', false);
ok('in het rack = fx-plek 1', lees('cc:0:16', 2)?.action === 'track.2.fx.knob.1');
ok('knob 8 in het rack = fx-plek 8', lees('cc:0:23', 2)?.action === 'track.2.fx.knob.8');
lagen.zet('device', 'strip');

ok('pad bovenaan kolom 1 = hotcue 1 (geel)', lees('note:0:32')?.action === 'track.1.hotcue.1' && lees('note:0:32').modus === 'hotcues');
ok('shift+klik op een hotcue-pad wist hem', lees('note:0:32')?.actionShift === 'track.1.hotcue.1.delete');
lagen.zet('grid', 'loops');
ok('mapje loops: dezelfde pad wordt een beatloop', lees('note:0:32')?.action === 'track.1.beatloop.1' && lees('note:0:32').modus === 'loops');
ok('loops-pad heeft geen shift-variant (valt terug op zichzelf)', lees('note:0:32')?.actionShift === null);
lagen.zet('grid', 'sampler');
ok('mapje sampler: bovenste rij = pad', lees('note:0:35')?.action === 'sampler.4' && lees('note:0:35').modus === 'sampler');
lagen.zet('grid', 'hotcues');
ok('scene 2 kiest het mapje loops, in cyaan', lees('note:0:83')?.action === 'layer.grid.loops' && lees('note:0:83').modus === 'loops');
ok('shift zelf doet niets op de bus', lees('note:0:98') === null);
ok('APC-shift ingedrukt: de gewone action wordt de shift-variant', lees('note:0:52', 1, true)?.action === 'track.1.loop.exit');
ok('lege plek geeft null (Bank: vrij voor keylock)', lees('note:0:103') === null);

// ---- de indeling "Voorstel A" (Clay 25 sep): klank en rechts ---------------

ok('Pan / Sends / User = loop in / out / reloop van de focus',
  lees('note:0:87', 3)?.action === 'track.3.loop.in' && lees('note:0:88', 3)?.action === 'track.3.loop.out'
  && lees('note:0:89', 3)?.action === 'track.3.loop.reloop' && lees('note:0:87', 3).kort === 'loop in');
ok('Bank ◀ ▶ = beatjump van de focus, met shift de lengte',
  lees('note:0:60', 5)?.action === 'track.5.beatjump.back' && lees('note:0:61', 5)?.actionShift === 'track.5.beatjump.double');
ok('shift + Bank ▶: het lampje is omgekeerd (brandt zolang verdubbelen kan), zoals de LED',
  lees('note:0:61', 5, true)?.lampOm === true && lees('note:0:61', 5)?.lampOm === false);
ok('Lock = quantize, Stop All = rem van de focus',
  lees('note:0:63', 2)?.action === 'transport.quantize' && lees('note:0:81', 2)?.action === 'track.2.brake' && lees('note:0:81', 2).kort === 'rem');
ok('2×2: shift + nummer = op de maat starten', lees('note:4:50')?.actionShift === 'track.5.play.quant');
ok('scene 5 met shift = modus klank, in de kleur van klank',
  lees('note:0:86', 1, true)?.action === 'layer.grid.klank' && lees('note:0:86', 1, true).modus === 'klank' && P.MODUS_KLEUR.klank === 'magenta');
lagen.zet('grid', 'klank');
ok('modus klank: pad linksboven = kill hoog track 1 (vasthouden), shift+klik = aan/uit',
  lees('note:0:32')?.action === 'track.1.kill.high.hold' && lees('note:0:32').actionShift === 'track.1.kill.high' && lees('note:0:32').modus === 'klank');
ok('modus klank: kolom 5 rij 4 = rem track 5, rij 5 = op de maat',
  lees(`note:0:${apc.gridNote(5, 4)}`)?.action === 'track.5.brake' && lees(`note:0:${apc.gridNote(5, 5)}`)?.action === 'track.5.play.quant');
ok('modus klank: scene 5 blijft loop weg, maar zijn lampje leest "klank open" (zoals de LED)',
  lees('note:0:86', 4)?.action === 'track.4.loop.exit' && lees('note:0:86', 4).lamp === 'layer.grid.klank' && lees('note:0:86', 4).modus === 'klank');
ok('een gewone knop leest zijn eigen action als lampje', lees('note:0:32').lamp === 'track.1.kill.high.hold');
lagen.zet('grid', 'hotcues');

// De mapje-balk: bij een wissel naar een grid-modus wat elke rij doet.
{
  const { gridRijen } = await import('../src/ui/mapje-balk.js');
  const r = gridRijen([...m.rules.values()], 'grid.klank');
  ok('mapje-balk klank: vijf rijen, rij 1 kill hoog vasthouden (shift: aan/uit), rij 4 rem, rij 5 op de maat',
    r.length === 5 && r[0].gewoon === 'track.1.kill.high.hold' && r[0].shift === 'track.1.kill.high'
    && r[3].gewoon === 'track.1.brake' && !r[3].shift && r[4].gewoon === 'track.1.play.quant');
  ok('mapje-balk hotcues: ook per rij (hotcue 1–4 met wissen, loop)',
    gridRijen([...m.rules.values()], 'grid.hotcues').map((x) => x.gewoon).join() === 'track.1.hotcue.1,track.1.hotcue.2,track.1.hotcue.3,track.1.hotcue.4,track.1.loop.toggle');
  ok('mapje-balk sampler/video: per kolom anders, dus geen rij-uitleg', gridRijen([...m.rules.values()], 'grid.sampler').length === 0
    && gridRijen([...m.rules.values()], 'grid.video').length === 0);
}

// ---- modus auto: de auto-DJ (2 okt, VRAGEN AU1) ------------------------------
ok('scene 4 met shift = modus auto, in limoen; zonder shift video',
  lees('note:0:85', 1, true)?.action === 'layer.grid.auto' && lees('note:0:85', 1, true).modus === 'auto' && P.MODUS_KLEUR.auto === 'limoen'
  && lees('note:0:85')?.action === 'layer.grid.video' && lees('note:0:85').actionShift === 'layer.grid.auto');
lagen.zet('grid', 'auto');
ok('modus auto: bovenste rij ok · overslaan · langer · nu, kolom 8 aan/uit, in de kleur van auto',
  ['auto.ok', 'auto.skip', 'auto.langer', 'auto.nu'].every((a, i) => lees(`note:0:${32 + i}`)?.action === a && lees(`note:0:${32 + i}`).modus === 'auto')
  && lees('note:0:39')?.action === 'auto.aan' && lees('note:0:32').kort === 'ok' && lees('note:0:33').kort === 'overslaan');
ok('modus auto: geen shift-variant op de pads, het lampje is de action zelf',
  lees('note:0:32').actionShift === null && lees('note:0:32').lamp === 'auto.ok');
ok('modus auto: kolom 5–7 en de rijen eronder zijn leeg (vrij)',
  lees('note:0:36') === null && lees('note:0:38') === null && lees(`note:0:${apc.gridNote(1, 2)}`) === null && lees(`note:0:${apc.gridNote(8, 5)}`) === null);
ok('modus auto: scene 4 blijft video kiezen, maar zijn lampje leest "auto open" (zoals de LED)',
  lees('note:0:85')?.action === 'layer.grid.video' && lees('note:0:85').lamp === 'layer.grid.auto' && lees('note:0:85').modus === 'auto');
ok('modus auto: de kern blijft (fader, play, filter van de kolom)',
  lees('cc:2:7')?.action === 'track.3.fader' && lees('note:2:50')?.action === 'track.3.play' && lees('cc:0:50')?.action === 'track.3.filter');
lagen.zet('grid', 'hotcues');
{
  const { gridPads, gridRijen } = await import('../src/ui/mapje-balk.js');
  const regels = [...m.rules.values()];
  ok('mapje-balk auto: één rij, per pad (1 ok · 2 overslaan · 3 langer · 4 nu · 8 aan/uit)',
    gridPads(regels, 'grid.auto').map((x) => `${x.kolom}:${x.action}`).join() === '1:auto.ok,2:auto.skip,3:auto.langer,4:auto.nu,8:auto.aan'
    && gridRijen(regels, 'grid.auto').length === 0);
  ok('mapje-balk: de andere modi krijgen geen per-pad-uitleg (hotcues/klank per rij, sampler/video niets, zoals eerst)',
    ['grid.hotcues', 'grid.loops', 'grid.sampler', 'grid.video', 'grid.klank'].every((id) => gridPads(regels, id).length === 0));
}
// ---- modus stems (5 okt, VRAGEN N1, docs/STEMS.md §5) ---------------------------
ok('scene 3 met shift = modus stems, in zeegroen; zonder shift sampler',
  lees('note:0:84', 1, true)?.action === 'layer.grid.stems' && lees('note:0:84', 1, true).modus === 'stems' && P.MODUS_KLEUR.stems === 'zeegroen'
  && lees('note:0:84')?.action === 'layer.grid.sampler' && lees('note:0:84').actionShift === 'layer.grid.stems');
lagen.zet('grid', 'stems');
ok('modus stems: pad linksboven = zang van track 1 weg zolang je drukt, shift+klik = aan/uit; kolom 4 rij 5 = overig van track 4',
  lees('note:0:32')?.action === 'track.1.stem.vocals.hold' && lees('note:0:32').actionShift === 'track.1.stem.vocals.kill'
  && lees('note:0:32').modus === 'stems' && lees(`note:0:${apc.gridNote(4, 5)}`)?.action === 'track.4.stem.other.hold'
  && lees('note:0:32').kort === 'zang weg!');
ok('modus stems: scene 3 blijft sampler, maar zijn lampje leest "stems open" (zoals de LED)',
  lees('note:0:84')?.action === 'layer.grid.sampler' && lees('note:0:84').lamp === 'layer.grid.stems' && lees('note:0:84').modus === 'stems');
lagen.zet('grid', 'hotcues');
{
  const { gridRijen } = await import('../src/ui/mapje-balk.js');
  const r = gridRijen([...m.rules.values()], 'grid.stems');
  ok('mapje-balk stems: vijf rijen, zang · rest · drums · bas · overig weg zolang je drukt (shift: aan/uit)',
    r.map((x) => `${x.gewoon}|${x.shift}`).join() === ['vocals', 'inst', 'drums', 'bass', 'other']
      .map((st) => `track.1.stem.${st}.hold|track.1.stem.${st}.kill`).join());
}
// Scherm en apc.html kennen elke grid-modus: een kleur op het scherm, een knop op de kaart.
{
  const { GROEPEN } = await import('../src/control/lagen.js');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const kaart = readFileSync(new URL('../apc.html', import.meta.url), 'utf8');
  const modi = GROEPEN.grid.volgorde;
  const mis = modi.filter((g) => !P.MODUS_KLEUR[g] || !css.includes(`--m-${g}:`) || !css.includes(`.spg[data-modus="${g}"]{--kleur:var(--m-${g})}`)
    || !kaart.includes(`data-modus="grid.${g}"`));
  ok(`elke grid-modus (${modi.join(' ')}) heeft een kleur op het scherm en een knop op apc.html${mis.length ? ' — mis: ' + mis.join() : ''}`,
    modi.includes('auto') && mis.length === 0);
}

ok('korte tekst zonder het kolomnummer', P.kortInKolom('3·cue 1') === 'cue 1' && P.kortInKolom('play') === 'play');
ok('licht: vol, half, uit, onbekend',
  P.lichtVan(1) === 'aan' && P.lichtVan(0.5) === 'half' && P.lichtVan(0) === 'uit' && P.lichtVan(null) === null);

// ---- vensters als model ----------------------------------------------------

let v = { L: 'A', R: 'B' };
v = P.volgFocus(v, 'C');
ok('focus op C: L = C, R = de vorige (A)', v.L === 'C' && v.R === 'A');
ok('zelfde focus verandert niets (zelfde object)', P.volgFocus(v, 'C') === v);
v = P.volgFocus(v, 'A');
ok('terug naar A: wisselen', v.L === 'A' && v.R === 'C');
ok('tweede zetten', P.zetTweede(v, 'E').R === 'E' && P.zetTweede(v, 'E').L === 'A');
ok('de focus kan niet ook de tweede zijn', P.zetTweede(v, 'A') === v);

// ---- Clip/Device View licht alleen op in het rack -------------------------

const { bindLagen, read } = await import('../src/control/actions.js');
const l2 = new Lagen();
bindLagen(l2);
ok('in de strip (standaard) is de kiesknop uit', read('layer.device.view') === 0);
l2.zet('device', 'rack');
ok('in het rack licht hij op', read('layer.device.view') === 1);
ok('een grid-kiesknop licht op als zijn mapje open staat', read('layer.grid.hotcues') === 1 && read('layer.grid.loops') === 0);

// ---- de kolomkop: resterende tijd, bpm, crossfaderkant ---------------------

const deck = (x) => ({ loaded: true, duration: 300, position: 0, playing: false, bpm: null, ...x });
ok('resterend in hele seconden, naar boven afgerond', P.kolomInfo(deck({ position: 87.6 })).rest === '-3:33');
ok('op het einde: -0:00', P.kolomInfo(deck({ position: 300 })).rest === '-0:00');
ok('lange track: minuten lopen door', P.kolomInfo(deck({ duration: 3725, position: 0 })).rest === '-62:05');
ok('bpm is de hoorbare (d.bpm), één decimaal', P.kolomInfo(deck({ bpm: 153.04 })).bpm === '153.0');
ok('geen grid: streepje', P.kolomInfo(deck({})).bpm === '—');
ok('lege track: streepjes, nooit bijna', P.kolomInfo({ loaded: false }).rest === '—' && !P.kolomInfo({ loaded: false }).bijna);
ok('onder 30 s en spelend = bijna', P.kolomInfo(deck({ position: 275, playing: true })).bijna);
ok('onder 30 s maar stil = niet bijna (niets aan de hand)', !P.kolomInfo(deck({ position: 275 })).bijna);
ok('31 s voor het eind = nog niet bijna', !P.kolomInfo(deck({ position: 269, playing: true })).bijna);
ok('kant uit read(): 0 = A, 0,5 = thru, 1 = B, null = onbekend',
  P.kantVan(0) === 'A' && P.kantVan(0.5) === 'thru' && P.kantVan(1) === 'B' && P.kantVan(null) === null);
ok('alleen xfade.side toont de kant (niet de losse A/B/thru-actions)',
  P.isKantKnop('track.3.xfade.side') && !P.isKantKnop('track.3.xfade.a') && !P.isKantKnop(null));

// ---- stems: de STEMS-rij en het teken in de kolomkop (docs/STEMS.md §4) ------

const S = await import('../src/ui/stems-weergave.js');
{
  const lees = (stand) => (id) => {
    const m = /^track\.(\d)\.stem\.(\w+)$/.exec(id);
    if (!m) return null;
    const namen = stand[m[1]];
    if (!namen) return null;
    return m[2] === 'inst' || namen.includes(m[2]) ? 1 : null;
  };
  ok('zonder stem-actions (vóór de integratie) leest alles null: 0 stems, niets crasht', S.aantalOpBus(read, 1) === 0 && S.aantalOpBus(() => null, 8) === 0);
  const bus = lees({ 1: ['vocals', 'inst'], 2: ['drums', 'bass', 'other', 'vocals'] });
  ok('twee stems: zang en rest lezen iets, drums null', S.aantalOpBus(bus, 1) === 2);
  ok('vier stems: drums leest iets', S.aantalOpBus(bus, 2) === 4 && S.aantalOpBus(bus, 3) === 0);
  ok('volgorde twee: zang, rest', S.VOLGORDE[2].join() === 'vocals,inst');
  ok('volgorde vier: drums, bas, overig, zang, en rest als groep erachter', S.VOLGORDE[4].join() === 'drums,bass,other,vocals,inst');
  ok('namen op het scherm in het Nederlands', ['zang', 'rest', 'drums', 'bas', 'overig'].join() === S.STEMMEN.map((s) => S.STEM_NAAM[s]).join());
  ok('rest bij vier zegt dat hij een groep is', /groep/.test(S.stemUitleg('inst', 4)) && !/groep/.test(S.stemUitleg('inst', 2)));

  // De rij staat vast in index.html (vensters.js bindt hem bij het opstarten):
  // per stem een schuif, kill (klik) en hold (shift + vasthouden), op track 1.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const rij = /<section id="stems"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
  ok('de STEMS-rij staat in index.html, standaard dicht', /<section id="stems" class="stems-rij hidden">/.test(rij));
  ok('elke stem een strip: schuif, kill en hold op track 1', S.STEMMEN.every((s) =>
    new RegExp(`data-stem="${s}"[\\s\\S]*?type="range"[^>]*data-action="track\\.1\\.stem\\.${s}"[\\s\\S]*?data-action="track\\.1\\.stem\\.${s}\\.kill" data-action-shift="track\\.1\\.stem\\.${s}\\.hold"`).test(rij)));
  ok('splitsen in 2 en 4, en × voor annuleren', /data-aantal="2"/.test(rij) && /data-aantal="4"/.test(rij) && /class="btn sm st-x/.test(rij));

  const r = (o) => S.rijStand({ geladen: true, nummer: 'n1', ...o });
  ok('met stems: de strips', r({ aantal: 4 }).soort === 'stems' && r({ aantal: 2 }).tekst === '2 stems');
  ok('lege track: niets te splitsen', S.rijStand({}).soort === 'leeg' && !S.rijStand({}).splits);
  ok('los bestand of demo: geen splitsknoppen', r({ nummer: null }).soort === 'los' && !r({ nummer: null }).splits);
  const mis = r({ mislukt: 'audio niet gevonden (404)', opdracht: { status: 'klaar', aantal: 2 } });
  ok('stems.wav laden mislukte: dat gaat voor, met de reden, je hoort audio.wav', mis.soort === 'mislukt' && /404/.test(mis.tekst) && /audio\.wav/.test(mis.tekst));
  const wacht = r({ opdracht: { id: 'o1', status: 'wacht', aantal: 4 } });
  ok('in de rij: "wacht op splitsen in 4", × zonder balk', wacht.soort === 'open' && wacht.annuleer === 'o1' && !wacht.bezig && /wacht op splitsen in 4/.test(wacht.tekst));
  const bezig = r({ opdracht: { id: 'o2', status: 'bezig', aantal: 2, voortgang: 1.7 } });
  ok('bezig: balk en percentage, voortgang geklemd op 0..1, nooit 100%', bezig.bezig && bezig.voortgang === 1 && /99%/.test(bezig.tekst));
  ok('klaar maar de track speelt zonder: herladen geeft ze (niet vanzelf wisselen)', r({ opdracht: { status: 'klaar', aantal: 2 } }).soort === 'herladen'
    && /laad het nummer opnieuw/.test(r({ opdracht: { status: 'klaar', aantal: 2 } }).tekst));
  const fout = r({ opdracht: { status: 'fout', fout: 'geheugen op', aantal: 2 } });
  ok('mislukt: de reden, en opnieuw splitsen', fout.soort === 'fout' && /geheugen op/.test(fout.tekst) && fout.splits);
  ok('niets: "geen stems" met splitsknoppen', r({}).soort === 'geen' && r({}).splits && r({}).uit === null);
  ok('splitter weg: de knoppen uit, met de reden', /de splitter ontbreekt: geen python/.test(r({ beschikbaar: false, reden: 'geen python' }).uit));

  const k = (o) => S.kolomTeken({ nummer: 'n1', ...o });
  ok('kolomkop met stems: S2 / S4', k({ aantal: 2 }).tekst === 'S2' && k({ aantal: 4 }).tekst === 'S4' && k({ aantal: 4 }).soort === 'stems');
  ok('kolomkop: ook een los bestand met stems op de bus krijgt het teken', S.kolomTeken({ aantal: 2 }).tekst === 'S2');
  ok('kolomkop: klaar maar niet geladen = gestippeld, met uitleg', k({ opdracht: { status: 'klaar', aantal: 4 } }).soort === 'herladen'
    && /laad het nummer opnieuw/.test(k({ opdracht: { status: 'klaar', aantal: 4 } }).titel));
  ok('kolomkop: laden mislukte = S!', k({ mislukt: 'x' }).tekst === 'S!');
  ok('kolomkop: geen stems, bezig of geen nummer = geen teken', k({}) === null && k({ opdracht: { status: 'bezig', aantal: 2 } }) === null && S.kolomTeken({}) === null);
}

// ---- mapje beeld (6 okt, spoor beeld): de Stroommachine op het scherm --------------
// Detail View doet ALLEEN met shift iets (het mapje beeld): een gewone klik niets,
// shift + klik opent het, het label zegt "⇧ …", geen lampje (zoals de LED zonder shift).
{
  lagen.zet('device', 'strip'); lagen.zet('grid', 'hotcues'); lagen.zet('edit', 'uit');
  const dv = lees('note:0:65');
  ok('Detail View op het scherm: geen gewone action, shift + klik = mapje beeld, label "⇧ …", geen lampje',
    dv && dv.action === null && dv.actionShift === 'layer.device.beeld' && dv.kort.startsWith('⇧') && dv.lamp === null
    && /met shift/.test(dv.titel));
  ok('… met de APC-shift vast is het gewoon de kiesknop van beeld', lees('note:0:65', 1, true)?.action === 'layer.device.beeld');
  ok('een knop zonder enige regel blijft null (ook zonder shift-regel)', lees('note:0:103') === null);
  lagen.zet('device', 'beeld');
  const MACROS = ['intensiteit', 'snelheid', 'helderheid', 'feedback', 'tint', 'dichtheid', 'glitch', 'balans'];
  ok('in beeld tonen de device knobs de acht macro\'s, met hun naam als label',
    P.DEVICE_KNOBS.every((c, i) => lees(c.sig, 3)?.action === `beeld.macro.${MACROS[i]}` && lees(c.sig, 3).kort === MACROS[i]));
  const sc = (n) => lees(`note:0:${n}`, 3);
  ok('in beeld: scene 1–5 = ontdek · volgende · vasthouden · flits · vrij (geen grid-modus-kleur), Stop All = paniek',
    ['ontdek', 'volgende', 'vasthouden', 'flits', 'vrij'].every((naam, i) => sc(82 + i)?.action === `beeld.regie.${naam}` && sc(82 + i).kort === naam && sc(82 + i).modus === null)
    && sc(81)?.action === 'beeld.regie.paniek' && sc(81).kort === 'paniek');
  ok('in beeld: shift + klik op scene 1 = modus secties, op scene 5 = klank (zoals op de APC)',
    sc(82)?.actionShift === 'layer.grid.secties' && sc(86)?.actionShift === 'layer.grid.klank');
  ok('in beeld blijven Device ◀ ▶, On/Off, Bank en Lock wat ze waren (focus-track 3)',
    lees('note:0:58', 3)?.action === 'track.3.rack.prev' && lees('note:0:62', 3)?.action === 'track.3.fx.bypass'
    && lees('note:0:60', 3)?.action === 'track.3.beatjump.back' && lees('note:0:63', 3)?.action === 'transport.quantize');
  lagen.zet('device', 'strip');
  ok('mapje dicht: device knob 1 weer trim, scene 1 weer hotcues', lees('cc:0:16', 3)?.action === 'track.3.trim' && sc(82)?.action === 'layer.grid.hotcues');
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nspiegel: alles groen');
