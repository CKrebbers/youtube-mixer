import { DECK_IDS } from '../engine/engine.js';
import { read as readAction, metaOf, trackVanDeck } from '../control/actions.js';
import { Mapping } from '../control/mapping.js';
import { knobVan } from './controls.js';
import { BaanView } from './waveform.js';
import { esc } from './dom.js';
import { bpmTekst } from './grid-strook.js';
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
export function opzetSpiegel({ engine, staat, loadFile }) {
  const items = [];          // { el, sig, soort, kolom?, r (leesControl) }
  const perSig = new Map();  // sig -> [el]

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
      <div class="kol-kop"><b class="kol-nr">${nr}</b><span class="kol-maat hidden" title="deze track geeft de maat (sync, sampler, video-puls)">MAAT</span></div>
      <div class="kol-titel">— leeg —</div>
      <div class="kol-info"><span class="kol-rest" title="resterende tijd">—</span><span class="kol-bpm" title="bpm die je hoort (grid × pitch)">—</span><i class="kol-speelt">▶</i></div>
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
      d.seek(((e.clientX - r.left) / r.width) * d.duration);
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
    const meta = r ? metaOf(r.action) : null;
    const isKnob = el.classList.contains('knob');
    const isFader = el.tagName === 'INPUT';
    // Een draaiknop of fader kan alleen een waarde sturen, een drukknop alleen
    // aan/uit. Past het niet, dan toont hij wat hij doet maar stuurt hij niets.
    const past = r && meta && ((isKnob || isFader) ? meta.type === 'value' : meta.type === 'trigger');
    if (r) el.dataset.action = r.action; else delete el.dataset.action;
    if (r?.actionShift) el.dataset.actionShift = r.actionShift; else delete el.dataset.actionShift;
    if (r?.modus) el.dataset.modus = r.modus; else delete el.dataset.modus;
    el.classList.toggle('leeg', !r);
    el.classList.toggle('stuurt-niet', !!r && !past);
    el.title = r ? r.titel : `APC: ${naamVan(item.sig)} — (niets gekoppeld)`;
    item.fxPlek = r ? Number(/^track\.\d+\.fx\.knob\.(\d)$/.exec(r.action)?.[1]) || null : null;
    if (!item.fxPlek) el.classList.remove('dof');
    // De A|B-knop toont de KANT (A / thru / B), geen aan/uit-licht; zie teken().
    item.kant = !!r && isKantKnop(r.action);
    if (!item.kant) delete el.dataset.kant;
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
      if (lab && !item.fxPlek && lab.textContent !== tekst) lab.textContent = tekst;
    } else if (!isFader && !item.kant) {
      const t = el.querySelector('.spg-t');
      if (t && t.textContent !== tekst) t.textContent = tekst;
    }
  }

  /**
   * Alle controls opnieuw laten afleiden. Bij: een andere mapping, een ander
   * mapje, een focuswissel en shift op de APC.
   */
  function herbereken() {
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
    mapping.on('change', herbereken);
    mapping.on('shift', herbereken);
    standaard.on('change', herbereken);
    lagen.on('change', herbereken);
    herbereken();
  }

  // ---- oplichten als je de APC aanraakt ------------------------------------
  const timers = new WeakMap();
  /**
   * Een control op de APC is aangeraakt: het element op het scherm licht
   * even op. `sig` is wat het apparaat stuurde, `regelSig` de regel die het
   * raakte (die kan een wildcard zijn, `cc:*:16`).
   */
  function markeer(sig, regelSig = null) {
    const [type, , nr] = String(sig).split(':');
    const els = perSig.get(sig) || perSig.get(regelSig) || perSig.get(`${type}:0:${nr}`) || [];
    for (const el of els) {
      el.classList.add('geraakt');
      clearTimeout(timers.get(el));
      timers.set(el, setTimeout(() => el.classList.remove('geraakt'), 300));
    }
    return els.length;
  }

  // ---- elk frame -----------------------------------------------------------
  const kolEls = Object.fromEntries(DECK_IDS.map((id) => {
    const root = kolommenEl.querySelector(`.kol[data-deck="${id}"]`);
    return [id, { root, titel: root.querySelector('.kol-titel'), meter: root.querySelector('.kol-meter i'),
      maat: root.querySelector('.kol-maat'), rest: root.querySelector('.kol-rest'), bpm: root.querySelector('.kol-bpm'),
      hoogte: '' }];
  }));
  const fdTrack = document.querySelector('.fd-track');
  const fdTitel = document.querySelector('.fd-titel');
  const fdLaag = document.querySelector('.fd-laag');
  const fdLaagUitleg = document.querySelector('.fd-laag-uitleg');
  const focusdeel = document.getElementById('focusdeel');
  const tekst = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  // classList.toggle met dezelfde stand is goedkoop, maar niet gratis: 16
  // elementen × 6 klassen × 60 frames. Alleen aanraken wat verandert.
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  let laatsteFocus = engine.focus;

  function teken(s) {
    if (s.focus !== laatsteFocus) { laatsteFocus = s.focus; herbereken(); }
    const { venster, analysis } = staat;
    for (const id of DECK_IDS) {
      const d = s.decks[id], k = kolEls[id], b = banen[id];
      const titel = d.title || '— leeg —';
      tekst(k.titel, titel);
      tekst(b.titel, titel);
      const hoogte = (d.level * 100).toFixed(1) + '%';
      if (k.hoogte !== hoogte) { k.hoogte = hoogte; k.meter.style.height = hoogte; }
      // MAAT op een track die stilstaat: gedimd en "(stil)". De maat komt dan
      // van de eerste geladen track met grid, niet van wat je hoort.
      const maat = s.maat === id, stil = maat && !d.playing;
      for (const root of [k.root, b.root]) {
        klasse(root, 'speelt', d.playing);
        klasse(root, 'leeg', !d.loaded);
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
      // de read van fx.bypass 1 = uit is.
      const ruw = r ? readAction(r.action) : null;
      const licht = r ? lichtVan(/\.fx\.bypass$/.test(r.action) && ruw != null ? 1 - ruw : ruw) : null;
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
      const p = fd?.fx.plekken.find((x) => x.plek === item.fxPlek);
      item.lab ??= item.el.querySelector('.knob-label');
      if (item.lab) tekst(item.lab, p?.naam || `fx ${item.fxPlek}`);
      klasse(item.el, 'dof', !p);
    }

    const nr = trackVanDeck(s.focus);
    tekst(fdTrack, `track ${nr}`);
    tekst(fdTitel, fd?.title || '— leeg —');
    const laag = lagen?.stand.device ?? 'strip';
    tekst(fdLaag, laag.toUpperCase());
    tekst(fdLaagUitleg, laag === 'rack' ? 'de acht knoppen van het rack' : 'trim · high · mid · low / echo · galm · fx');
    if (focusdeel.dataset.laag !== laag) focusdeel.dataset.laag = laag;
  }

  return { herbereken, koppel, markeer, teken, bron, items };
}
