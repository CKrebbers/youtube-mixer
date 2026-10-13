import { DECK_IDS } from '../engine/engine.js';
import { read as readAction, invoke as invokeAction, metaOf, trackVanDeck } from '../control/actions.js';
import { Mapping } from '../control/mapping.js';
import { knobVan } from './controls.js';
import { BaanView } from './waveform.js';
import { esc, zetTekst } from './dom.js';
import { bpmTekst } from './grid-strook.js';
import { kolomToon } from './toon-weergave.js';
import {
  kolomControls, SCENES, MASTERKOLOM, TRANSPORT, TEMPO, DEVICE_KNOBS, DEVICE_KNOPPEN,
  PIJLEN, SHIFT, BANK, CROSSFADER, leesControl, kortInKolom, lichtVan, naamVan,
  kolomInfo, kantVan, isKantKnop,
} from './spiegel-plan.js';

/**
 * De Lock-knop van de APC (device-sectie, rij 2, tweede knop, note 63): daar
 * staat de Q van quantize. De plek in styles.css (.fd-quantize) rekent met
 * dezelfde cel: kolom 2, rij 2 van .fd-devknoppen.
 */
const LOCK_SIG = DEVICE_KNOPPEN[1][1].sig;
/** Zo lang licht een element op als je de control op de APC aanraakt. */
const GERAAKT_MS = 300;
const QUANTIZE_TITEL = {
  aan: 'quantize AAN, voor alle tracks: cue, hotcues en loop in/out op de tel, hotcues springen in de maat — klik of toets 6',
  uit: 'quantize uit — klik of toets 6 om cue, hotcues en loop in/out op de tel te zetten (alle tracks)',
};

/**
 * Het hoofdscherm als spiegel van de APC40 mkII. Onder links de acht kolommen
 * (track knob · vijf pads · Clip Stop · Track Select · 2×2 · fader), rechts
 * het focusdeel (scene launch, transport, device knobs, crossfader), boven
 * acht dunne banen met de golfvorm van elke track.
 *
 * Wat elke knop doet staat NIET in deze module: die vraagt het aan de
 * mapping (`leesControl` in spiegel-plan.js), met shift en het open mapje.
 * Is de geladen mapping niet voor een APC (of nog leeg), dan leest hij een
 * eigen exemplaar van de standaardmapping — zo toont het scherm altijd de
 * standaardindeling.
 *
 * De engine wordt alleen uitgelezen (in `teken`); alles wat je aanklikt
 * gaat als action over de bus, via `bindButtons` en de Knob/fader-binding
 * in vensters.js. Die lezen hun action bij het indrukken, dus herschrijven
 * van `data-action` is genoeg.
 */
export function opzetSpiegel({ engine, staat, loadFile, stemsVan = () => null }) {
  const items = [];          // { el, sig, soort, kolom?, r (leesControl) }
  const perSig = new Map();  // sig -> [el]
  // classList.toggle en dataset met dezelfde stand zijn goedkoop, maar niet
  // gratis: alleen aanraken wat verandert.
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const data = (el, k, v) => {
    if (v === undefined || v === null || v === false) { if (k in el.dataset) delete el.dataset[k]; }
    else if (el.dataset[k] !== v) el.dataset[k] = v;
  };

  const knopHtml = (c, extra = '') => `<button class="spg spg-${c.soort} ${extra}" data-kind="button" data-sig="${c.sig}">`
    + `<span class="spg-t"></span>${c.teken ? `<i class="spg-teken">${c.teken}</i>` : ''}`
    + (c.soort === 'knop' ? `<small class="spg-naam">${esc(naamVan(c.sig))}</small>` : '') + '</button>';
  const knobHtml = (c) => `<div class="knob sm spg spg-knob" data-sig="${c.sig}" data-label="" data-value="0.5"></div>`;
  const faderHtml = (c, cls) => `<input type="range" class="${cls} spg spg-fader" min="0" max="1" step="0.001" value="0.8" data-sig="${c.sig}">`;
  const html = (c) => (c.soort === 'knob' ? knobHtml(c)
    : c.soort === 'fader' ? faderHtml(c, 'vfader')
      : c.soort === 'xfader' ? faderHtml(c, 'xfader')
        : knopHtml(c));

  // ---- acht kolommen -------------------------------------------------------
  const kolommenEl = document.getElementById('kolommen');
  kolommenEl.innerHTML = DECK_IDS.map((id) => {
    const nr = trackVanDeck(id);
    const c = Object.fromEntries(kolomControls(nr).map((x) => [x.rol, x]));
    return `<div class="kol" data-deck="${id}" data-kolom="${nr}">
      <div class="kol-kop"><span class="kol-kop-l"><b class="kol-nr">${nr}</b><i class="kol-stems hidden"></i></span><span class="kol-maat hidden" title="deze track geeft de maat (sync, sampler, video-puls)">MAAT</span></div>
      <div class="kol-titel">— leeg —</div>
      <div class="kol-info"><span class="kol-rest" title="resterende tijd">—</span><span class="kol-tempo"><span class="kol-bpm" title="bpm die je hoort (grid × pitch)">—</span><span class="kol-toon leeg" title="toonsoort die je hoort">—</span></span><i class="kol-speelt">▶</i></div>
      ${html(c.knob)}
      <div class="kol-pads">${[1, 2, 3, 4, 5].map((r) => knopHtml(c[`pad${r}`])).join('')}</div>
      ${knopHtml(c.stop)}
      ${knopHtml(c.select, 'spg-select')}
      <div class="kol-2x2">${knopHtml(c.activator)}${knopHtml(c.ab)}${knopHtml(c.solo)}${knopHtml(c.arm)}</div>
      <div class="kol-onder">${faderHtml(c.fader, 'vfader')}<div class="meter vmeter kol-meter"><i></i></div></div>
      <div class="kol-voet"><b>${nr}</b></div>
    </div>`;
  }).join('');

  // ---- het focusdeel -------------------------------------------------------
  const scenesEl = document.getElementById('fd-scenes');
  const [stopAll, master, cueLevel, masterFader] = MASTERKOLOM;
  scenesEl.innerHTML = `<div class="fd-scene-knoppen">${SCENES.map((c) => knopHtml(c)).join('')}</div>
    ${knopHtml(stopAll)}${knopHtml(master)}${knobHtml(cueLevel)}
    <div class="kol-onder">${faderHtml(masterFader, 'vfader')}<div class="meter vmeter master-meter"><i></i></div></div>
    <div class="kol-voet"><b>MASTER</b></div>`;

  document.getElementById('fd-transport').innerHTML = TRANSPORT[0].map((c) => knopHtml(c)).join('')
    + TRANSPORT[1].map((c) => knopHtml(c)).join('') + `<div class="fd-tempo">${knobHtml(TEMPO)}</div>`
    + TRANSPORT[2].map((c) => knopHtml(c)).join('');
  document.getElementById('fd-knobs').innerHTML = DEVICE_KNOBS.map(knobHtml).join('');
  // Quantize (transport.quantize, voor alle tracks) heeft nog geen knop op de
  // APC, en zonder stand zie je niet waarom hotcues en cue ineens op de tel
  // vallen. Een kleine Q in de hoek van LOCK: daar komt hij op de APC. Klik =
  // aan/uit, net als toets 6. Geen gespiegelde control (geen data-sig): wordt
  // Lock in de mapping zelf quantize, dan toont die knop het en gaat de Q weg.
  const devKnoppen = document.getElementById('fd-devknoppen');
  devKnoppen.innerHTML = DEVICE_KNOPPEN.flat().map((c) => knopHtml(c)).join('')
    + `<button class="fd-quantize" data-kind="button" data-action="transport.quantize" data-licht="uit"
        aria-pressed="false" title="${QUANTIZE_TITEL.uit}">Q</button>`;
  const quantizeEl = devKnoppen.querySelector('.fd-quantize');
  document.getElementById('fd-pijlen').innerHTML = `<div class="fd-kruis">${PIJLEN.map((c) => knopHtml(c, `pijl-${c.rol}`)).join('')}</div>`
    + knopHtml(SHIFT, 'spg-shift') + knopHtml(BANK);
  const xfRij = document.getElementById('fd-xfader');
  xfRij.children[0].insertAdjacentHTML('afterend', faderHtml(CROSSFADER, 'xfader'));

  // Alles met een data-sig is een gespiegelde control.
  for (const el of document.querySelectorAll('[data-sig]')) {
    const kolom = el.closest('.kol')?.dataset.kolom;
    // Onderdelen die teken() elke frame nodig heeft, één keer opgezocht.
    items.push({ el, sig: el.dataset.sig, kolom: kolom ? Number(kolom) : null, r: null,
      t: el.querySelector('.spg-t'), lab: null });
    if (!perSig.has(el.dataset.sig)) perSig.set(el.dataset.sig, []);
    perSig.get(el.dataset.sig).push(el);
  }
  const shiftEl = document.querySelector('.spg-shift');

  // ---- acht banen ----------------------------------------------------------
  const banenEl = document.getElementById('banen');
  banenEl.innerHTML = DECK_IDS.map((id) => `<div class="baan" data-deck="${id}">
    <b class="baan-nr">${trackVanDeck(id)}</b><span class="baan-titel">— leeg —</span><canvas></canvas></div>`).join('');
  const banen = Object.fromEntries(DECK_IDS.map((id) => {
    const root = banenEl.querySelector(`.baan[data-deck="${id}"]`);
    return [id, { root, titel: root.querySelector('.baan-titel'),
      view: new BaanView(root.querySelector('canvas'), { color: '#2f8e81' }) }];
  }));
  for (const id of DECK_IDS) {
    const { root } = banen[id];
    root.addEventListener('pointerdown', (e) => {
      engine.setFocus(id);
      const cv = e.target.closest('canvas');
      const d = engine.deck(id);
      if (!cv || !d.buffer) return;
      const r = cv.getBoundingClientRect();
      // Via de bus, zodat het handelingenlog de sprong ziet.
      invokeAction(`track.${trackVanDeck(id)}.seek`, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
    });
  }

  // Een bestand op een baan of een kolom laadt op DIE track.
  const dropDoel = (root, id) => {
    root.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('drag'); });
    root.addEventListener('dragleave', () => root.classList.remove('drag'));
    root.addEventListener('drop', async (e) => {
      e.preventDefault(); root.classList.remove('drag');
      const file = e.dataTransfer.files[0];
      if (file) await loadFile(id, file);
    });
  };
  for (const id of DECK_IDS) {
    dropDoel(banen[id].root, id);
    dropDoel(kolommenEl.querySelector(`.kol[data-deck="${id}"]`), id);
  }

  // ---- de mapping volgen ---------------------------------------------------
  let appMapping = null;
  let lagen = null;
  // Eigen exemplaar van de standaard, voor als de app (nog) geen APC-mapping heeft.
  const standaard = new Mapping({ read: () => null, invoke: () => {}, lagen: () => lagen?.actief() ?? [] });
  fetch('mappings/apc40mk2.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
    .then((doc) => { standaard.load(doc); herbereken(); })
    .catch((err) => console.warn('[spiegel] standaardmapping niet geladen:', err.message));

  const bron = () => (appMapping?.rules.size && appMapping.device === 'apc40mk2' ? appMapping : standaard);

  /** Eén control op zijn nieuwe functie zetten. Alleen wat verandert wordt aangeraakt. */
  function zet(item, r) {
    const { el } = item;
    item.r = r;
    // Een knop die alleen met shift iets doet (Shift + Detail View) heeft geen
    // action, wel een actionShift: die telt dan voor "past".
    const meta = r ? metaOf(r.action ?? r.actionShift) : null;
    const isKnob = el.classList.contains('knob');
    const isFader = el.tagName === 'INPUT';
    // Een draaiknop of fader kan alleen een waarde sturen, een drukknop alleen
    // aan/uit. Past het niet, dan toont hij wat hij doet maar stuurt hij niets.
    const past = r && meta && ((isKnob || isFader) ? meta.type === 'value' : meta.type === 'trigger');
    // Alleen schrijven wat anders is: een herberekening raakt ~200 elementen,
    // en elk geschreven attribuut laat Chrome de stijl van dat element opnieuw
    // uitrekenen, ook als de waarde dezelfde was.
    data(el, 'action', r?.action);
    data(el, 'actionShift', r?.actionShift);
    data(el, 'modus', r?.modus);
    klasse(el, 'leeg', !r);
    klasse(el, 'stuurt-niet', !!r && !past);
    const titel = r ? r.titel : `APC: ${naamVan(item.sig)} — (niets gekoppeld)`;
    if (el.title !== titel) el.title = titel;
    // Een rack-knop van de track (of, in het mapje master, van de master), of een instrumentknop.
    const plek = r ? /^(track\.\d+|master)\.fx\.knob\.(\d)$/.exec(r.action) : null;
    item.fxPlek = plek ? Number(plek[2]) : null;
    item.fxMaster = plek?.[1] === 'master';
    item.instPlek = r ? Number(/^track\.\d+\.inst\.knob\.(\d)$/.exec(r.action)?.[1]) || null : null;
    if (!item.fxPlek && !item.instPlek) klasse(el, 'dof', false);
    // De A|B-knop toont de KANT (A / thru / B), geen aan/uit-licht; zie teken().
    item.kant = !!r && isKantKnop(r.action);
    if (!item.kant) data(el, 'kant', undefined);
    // Wat teken() elke frame van deze regel wil weten, hier één keer: een sectie-pad
    // (track, index) en of het lampje omgekeerd is (On/Off). Was per frame per knop een regex.
    const sec = r ? /^track\.(\d+)\.section\.(\d+)$/.exec(r.action) : null;
    item.sectie = sec ? { deck: DECK_IDS[Number(sec[1]) - 1], i: Number(sec[2]) - 1 } : null;
    item.lampOm = !!r && !!(r.lampOm || /\.fx\.bypass$/.test(r.action));
    let tekst = r ? r.kort : '';
    // In een kolom staat het tracknummer al bovenaan: "focus 3" wordt "focus".
    if (item.kolom) tekst = kortInKolom(tekst).replace(new RegExp(`^focus ${item.kolom}$`), 'focus');
    if (isKnob) {
      const k = knobVan.get(el);
      if (k) {
        k.action = past ? r.action : null;
        k.bipolar = !!meta?.bipolar;
      }
      const lab = el.querySelector('.knob-label');
      if (lab && !item.fxPlek && !item.instPlek && lab.textContent !== tekst) lab.textContent = tekst;
    } else if (!isFader && !item.kant) {
      const t = el.querySelector('.spg-t');
      if (t && t.textContent !== tekst) t.textContent = tekst;
    }
  }

  /**
   * Alle controls opnieuw laten afleiden. Bij: een andere mapping, een ander
   * mapje, een focuswissel en shift op de APC.
   *
   * Van een gebeurtenis (shift, een mapje, de mapping) komt dit NIET meteen,
   * maar bij het volgende beeld (`straks`): het liep anders midden in het
   * MIDI-bericht van shift of een modusknop, 2–8 ms (gemeten, controller-invoer
   * 14 okt), en elk bericht dat erachter in de rij stond (een fader) wachtte
   * zolang. Tien keer shift in één beeld = één herberekening.
   */
  let gepland = false;
  function straks() {
    if (gepland) return;
    gepland = true;
    requestAnimationFrame(() => { if (gepland) herbereken(); });
  }
  function herbereken() {
    gepland = false;
    const vars = { focus: trackVanDeck(engine.focus) };
    const shift = !!appMapping?.shift;
    const m = bron();
    for (const item of items) {
      zet(item, item.sig === SHIFT.sig ? null : leesControl(m, item.sig, { shift, vars }));
    }
    // Is Lock (in dit mapje, met deze shift) zelf quantize, dan is de Q dubbel.
    const lock = items.find((it) => it.sig === LOCK_SIG);
    quantizeEl.classList.toggle('hidden', lock?.r?.action === 'transport.quantize');
    if (shiftEl) {
      shiftEl.querySelector('.spg-t').textContent = 'SHIFT';
      shiftEl.classList.remove('leeg');
      shiftEl.title = 'APC: shift — houd vast voor de tweede functie (op het scherm: shift + klik)';
    }
  }

  function koppel({ mapping, lagen: l }) {
    appMapping = mapping;
    lagen = l;
    mapping.on('change', straks);
    mapping.on('shift', straks);
    standaard.on('change', straks);
    lagen.on('change', straks);
    herbereken();
  }

  // ---- oplichten als je de APC aanraakt ------------------------------------
  /** Element -> tot wanneer (performance.now) het oplicht. teken() zet en haalt de klasse. */
  const geraakt = new Map();
  const perSigVan = new Map();   // sig zoals hij binnenkomt -> elementen (cache, ook voor de wildcards)
  /**
   * Een control op de APC is aangeraakt: het element op het scherm licht
   * even op. `sig` is wat het apparaat stuurde, `regelSig` de regel die het
   * raakte (die kan een wildcard zijn, `cc:*:16`).
   *
   * Per bericht alleen ONTHOUDEN; de klasse zet teken() bij het volgende
   * beeld. Een fader-sweep van acht faders is ~1000 berichten per seconde: per
   * bericht een klasse, een clearTimeout en een setTimeout was een
   * stijlberekening en twee timers per bericht voor wat je één keer per beeld ziet.
   */
  function markeer(sig, regelSig = null) {
    const sleutel = regelSig ? `${sig}|${regelSig}` : sig;
    let els = perSigVan.get(sleutel);
    if (!els) {
      const [type, , nr] = String(sig).split(':');
      els = perSig.get(sig) || perSig.get(regelSig) || perSig.get(`${type}:0:${nr}`) || [];
      perSigVan.set(sleutel, els);
    }
    if (els.length) {
      const tot = performance.now() + GERAAKT_MS;
      for (const el of els) geraakt.set(el, tot);
    }
    return els.length;
  }
  function tekenGeraakt() {
    if (!geraakt.size) return;
    const nu = performance.now();
    for (const [el, tot] of geraakt) {
      const aan = nu < tot;
      klasse(el, 'geraakt', aan);
      if (!aan) geraakt.delete(el);
    }
  }

  // ---- elk frame -----------------------------------------------------------
  const kolEls = Object.fromEntries(DECK_IDS.map((id) => {
    const root = kolommenEl.querySelector(`.kol[data-deck="${id}"]`);
    return [id, { root, titel: root.querySelector('.kol-titel'), meter: root.querySelector('.kol-meter i'),
      maat: root.querySelector('.kol-maat'), rest: root.querySelector('.kol-rest'), bpm: root.querySelector('.kol-bpm'),
      toon: root.querySelector('.kol-toon'), stems: root.querySelector('.kol-stems'), stemsSoort: '', hoogte: '' }];
  }));
  const fdTrack = document.querySelector('.fd-track');
  const fdTitel = document.querySelector('.fd-titel');
  const fdLaag = document.querySelector('.fd-laag');
  const fdLaagUitleg = document.querySelector('.fd-laag-uitleg');
  const focusdeel = document.getElementById('focusdeel');
  const tekst = zetTekst;   // de bestaande tekstknoop, geen nieuwe (dom.js)
  let laatsteFocus = engine.focus;

  function teken(s) {
    if (s.focus !== laatsteFocus) { laatsteFocus = s.focus; herbereken(); }
    if (gepland) herbereken();     // shift of een mapje sinds het vorige beeld: vóór de lampjes
    tekenGeraakt();
    const { venster, analysis } = staat;
    for (const id of DECK_IDS) {
      const d = s.decks[id], k = kolEls[id], b = banen[id];
      // Een instrument op de track (docs/INSTRUMENTEN.md §6): zijn naam in plaats van een titel.
      const titel = d.instrument ? `♪ ${d.instrument.naam}` : (d.title || '— leeg —');
      tekst(k.titel, titel);
      tekst(b.titel, titel);
      // transform, geen height: geen opmaak per beeld (styles.css, .meter.vmeter i).
      const hoogte = `scaleY(${Math.min(1, Math.max(0, d.level)).toFixed(3)})`;
      if (k.hoogte !== hoogte) { k.hoogte = hoogte; k.meter.style.transform = hoogte; }
      // MAAT op een track die stilstaat: gedimd en "(stil)". De maat komt dan
      // van de eerste geladen track met grid, niet van wat je hoort.
      const maat = s.maat === id, stil = maat && !d.playing;
      for (const root of [k.root, b.root]) {
        klasse(root, 'speelt', d.playing);
        klasse(root, 'leeg', !d.loaded && !d.instrument);
        klasse(root, 'instrument', !!d.instrument);
        klasse(root, 'klinkt', !!d.instrument?.klinkt);
        klasse(root, 'focused', s.focus === id);
        klasse(root, 'tweede', venster.R === id && s.focus !== id);
        klasse(root, 'maat', maat);
        klasse(root, 'maat-stil', stil);
      }
      klasse(k.maat, 'hidden', !maat);
      tekst(k.maat, stil ? 'MAAT (stil)' : 'MAAT');
      const info = kolomInfo(d);
      tekst(k.rest, info.rest);
      // "?" en gedimd in een onzeker gridstuk: daar weigeren sync en beat-loops.
      tekst(k.bpm, d.loaded && d.bpm ? bpmTekst(d.bpm, d.gridZeker) : info.bpm);
      klasse(k.bpm, 'onzeker', !!d.bpm && d.gridZeker === false);
      klasse(k.rest, 'bijna', info.bijna);
      // Toonsoort die je HOORT (T3): `9B G`, onzeker gedimd met "?", "~" = geen
      // duidelijke. De plaat staat in de tooltip.
      const toon = kolomToon(d.loaded ? d.toon : null);
      tekst(k.toon, toon.tekst);
      for (const soort of ['zeker', 'onzeker', 'geen', 'leeg']) klasse(k.toon, soort, toon.soort === soort);
      if (k.toon.title !== toon.titel) k.toon.title = toon.titel;
      // Stems: een klein teken naast het nummer (S2/S4; gestippeld = klaar,
      // herladen geeft ze; S! = laden mislukte). stems-paneel.js weet hoe.
      const st = stemsVan(id);
      const soort = st ? st.soort : '';
      if (k.stemsSoort !== soort) { k.stemsSoort = soort; k.stems.dataset.soort = soort; klasse(k.stems, 'hidden', !st); }
      if (st) { tekst(k.stems, st.tekst); if (k.stems.title !== st.titel) k.stems.title = st.titel; }
      b.view.draw(d, analysis[id]);
    }

    // Lampjes: wat de action zelf zegt, net als de LED-laag.
    for (const item of items) {
      const { el, r } = item;
      if (!item.t || el === shiftEl) continue;   // draaiknop, fader, shift: eigen regels
      if (item.kant) {
        // A|B-knop: de letter van de kant in de kleur van de kant.
        const kant = kantVan(readAction(r.action)) ?? '';
        if (el.dataset.kant !== kant) { el.dataset.kant = kant; tekst(item.t, kant); }
        if (el.dataset.licht !== '') el.dataset.licht = '';
        continue;
      }
      // On/Off brandt als het effect AAN staat (zoals de LED op de APC), terwijl
      // de read van fx.bypass 1 = uit is. `lamp`/`lampOm`: led.lees en
      // led.invert uit de regel, net als de LED-laag.
      // Modus secties (docs/SECTIES.md): op de pad de NAAM van de sectie
      // ("drop D"), zoals de strook boven de golfvorm; zonder sectie leeg en gedimd.
      const sec = item.sectie;
      if (sec) {
        const k = engine.deck(sec.deck)?.sectieKaart;
        const naam = k && sec.i < k.aantal ? k.naam(sec.i) : null;
        tekst(item.t, naam ?? '');
        if (el.classList.contains('leeg') !== (naam === null)) el.classList.toggle('leeg', naam === null);
      }
      const ruw = r ? readAction(r.lamp) : null;
      const om = item.lampOm;
      const licht = r ? lichtVan(om && ruw != null ? 1 - ruw : ruw) : null;
      const want = licht ?? '';
      if (el.dataset.licht !== want) el.dataset.licht = want;
    }
    if (shiftEl) {
      const want = appMapping?.shift ? 'aan' : 'uit';
      if (shiftEl.dataset.licht !== want) shiftEl.dataset.licht = want;
    }
    // Quantize uit de snapshot; alleen schrijven als de stand verandert.
    const q = s.quantize ? 'aan' : 'uit';
    if (quantizeEl.dataset.licht !== q) {
      quantizeEl.dataset.licht = q;
      quantizeEl.setAttribute('aria-pressed', String(q === 'aan'));
      quantizeEl.title = QUANTIZE_TITEL[q];
    }

    // Device knobs in het rack: de naam van de plek, en dof als hij niets doet.
    const fd = s.decks[s.focus];
    for (const item of items) {
      if (!item.fxPlek) continue;
      const p = (item.fxMaster ? s.masterFx : fd?.fx)?.plekken.find((x) => x.plek === item.fxPlek);
      item.lab ??= item.el.querySelector('.knob-label');
      if (item.lab) tekst(item.lab, p?.naam || `fx ${item.fxPlek}`);
      klasse(item.el, 'dof', !p);
    }

    // In het mapje inst: de naam van de plek van het instrument, en dof als hij niets doet.
    const fdInst = engine.instrumentOp?.(s.focus) ?? null;
    for (const item of items) {
      if (!item.instPlek) continue;
      const p = fdInst?.params?.[item.instPlek - 1];
      item.lab ??= item.el.querySelector('.knob-label');
      if (item.lab) tekst(item.lab, p?.label || `instr ${item.instPlek}`);
      klasse(item.el, 'dof', !p);
    }

    const nr = trackVanDeck(s.focus);
    tekst(fdTrack, `track ${nr}`);
    tekst(fdTitel, fd?.instrument ? `♪ ${fd.instrument.naam}` : (fd?.title || '— leeg —'));
    const laag = lagen?.stand.device ?? 'strip';
    tekst(fdLaag, laag.toUpperCase());
    tekst(fdLaagUitleg, laag === 'rack' ? 'de acht knoppen van het rack'
      : laag === 'inst' ? `de acht knoppen van het instrument${fdInst ? ` (${fdInst.naam})` : ''}`
      : laag === 'master' ? 'het master-rack: 1–7, knop 8 = mix (shift: 8)'
      : laag === 'beeld' ? 'de Stroommachine: acht macro\'s · scene 1–5 = regie · Stop All = paniek' : 'trim · high · mid · low / echo · galm · fx');
    if (focusdeel.dataset.laag !== laag) focusdeel.dataset.laag = laag;
  }

  return { herbereken, straks, koppel, markeer, teken, bron, items };
}
