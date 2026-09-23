import { read as readAction, trackVanDeck } from '../control/actions.js';
import { fmtTime } from '../lib/emitter.js';
import { BIJNA_EINDE } from './spiegel-plan.js';
import { bpmTekst } from './grid-strook.js';

/**
 * De renderloop: één rAF voor de hele UI. De engine wordt alleen uitgelezen,
 * nooit aangestuurd.
 *
 * Wat een eigen module is (de APC-spiegel, video, opnameknop, koppelpaneel,
 * rackkiezer) geeft zijn eigen tekenstap mee; de rest staat hier. Elke stap
 * heeft zijn eigen vangnet (`veilig`).
 */
const ONZEKER_TITEL = 'grid hier onzeker — tik het tempo of zet het grid op slot';

export function startRenderloop({ engine, staat, views, knobs, faders, stappen }) {
  const { venster, analysis } = staat;

  const r = views.root;
  const e = {
    title: r.querySelector('.deck-title'),
    pos: r.querySelector('.t-pos'),
    rem: r.querySelector('.t-rem'),
    play: r.querySelector('.play'),
    pitch: r.querySelector('.pitch-val'),
    pitchBereik: r.querySelector('.pitch-bereik'),
    hotcues: [...r.querySelectorAll('.hc')],
    loopBtns: [...r.querySelectorAll('.loops .btn:not(.bl)')],
    beatBtns: [...r.querySelectorAll('.loops .btn.bl')],
    bpm: r.querySelector('.bpm-val'),
    tap: r.querySelector('.tap'),
    sync: r.querySelector('.sync'),
    maat: r.querySelector('.maat-badge'),
    fase: r.querySelector('.fase'),
    faseWijzer: r.querySelector('.fase i'),
  };
  // Het aantal tellen staat vast per knop; de track in de action wisselt met de focus.
  for (const b of e.beatBtns) b._tellen = parseFloat(b.dataset.action.split('.').pop());
  const fxRij = document.querySelector('#focusdeel .fx-row');
  const fxNaam = fxRij.querySelector('.fx-naam');
  const padEls = [...document.querySelectorAll('.pad')];
  const lengteKnop = document.querySelector('.sampler-lengte');
  const masterMeter = document.querySelector('.master-meter i');
  const curveBtn = document.querySelector('.curve');

  // Alleen schrijven wat verandert: een textContent of classList die elke
  // frame opnieuw gezet wordt, laat Chrome elke frame stijl en opmaak
  // narekenen, ook als er niets verschilt.
  const tekst = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const stijl = (el, prop, v) => { if (el.style[prop] !== v) el.style[prop] = v; };

  /**
   * Schermknoppen bijwerken vanuit de engine.
   *
   * De UI stuurt de engine aan via actions, maar hij moet hem ook VOLGEN: sinds
   * er MIDI bij is gekomen is de muis niet meer de enige bron. Een knop die je
   * vasthoudt laten we met rust, anders vecht de renderloop met je vinger.
   */
  function volgEngine() {
    for (const k of knobs) {
      if (k.dragging || !k.action) continue;
      const v = readAction(k.action);
      if (v !== null && Math.abs(v - k.value) > 0.0005) k.set(v, true);
    }
    for (const el of faders) {
      if (el === document.activeElement) continue;
      const v = readAction(el.dataset.action);
      if (v !== null && Math.abs(parseFloat(el.value) - v) > 0.0005) el.value = v;
    }
  }

  /**
   * Elk onderdeel van het frame zijn eigen vangnet. Eerst stond er één try om
   * alles: gooide het videopaneel, dan werden sampler, opnameteller en meters
   * nooit meer bijgewerkt, zonder dat je zag waarom. Nu valt alleen dat ene
   * stuk stil, met hooguit één melding per seconde per onderdeel.
   */
  const laatsteFout = {};
  function veilig(naam, fn) {
    try { fn(); } catch (err) {
      const nu = performance.now();
      if (!laatsteFout[naam] || nu - laatsteFout[naam] > 1000) {
        laatsteFout[naam] = nu;
        console.error(`[ui] ${naam} overgeslagen:`, err);
      }
    }
  }

  /*
   * Eén exceptie in deze lus stopte vroeger het plannen van het volgende frame,
   * en daarmee bevroor de hele UI: tijd, meters, golfvorm. Voor een instrument
   * dat live draait is dat het verkeerde gedrag — beter één scheve frame dan een
   * dood scherm. De fout wordt wel gemeld, maar hooguit één keer per seconde,
   * anders vult hij je console sneller dan je hem kunt lezen.
   */
  let laatsteKlacht = 0;
  function frame() {
    try { tekenFrame(); } catch (err) {
      if (performance.now() - laatsteKlacht > 1000) {
        laatsteKlacht = performance.now();
        console.error('[ui] frame overgeslagen:', err);
      }
    }
    requestAnimationFrame(frame);
  }

  function tekenFrame() {
    const s = engine.snapshot();
    veilig('volgen', () => {
      volgEngine();
    });
    veilig('spiegel', () => {
      stappen.spiegel(s);
    });
    veilig('focus', () => {
      const id = venster.L;
      const d = s.decks[id];
      views.zoom.draw(d, analysis[id], engine.deck(id).onsets);
      views.overview.draw(d, analysis[id]);

      tekst(e.title, d.title || '— leeg —');
      tekst(e.pos, fmtTime(d.position));
      const rest = Math.max(0, d.duration - d.position);
      tekst(e.rem, '-' + fmtTime(rest));
      klasse(e.rem, 'bijna', d.playing && d.loaded && rest < BIJNA_EINDE);
      klasse(e.play, 'on', d.playing);
      tekst(e.pitch, ((d.rate - 1) * 100).toFixed(1) + '%');
      tekst(e.pitchBereik, `±${Math.round(engine.deck(id).pitchBereik * 100)}`);
      // bpm: wat je HOORT, dus inclusief pitch.
      tekst(e.bpm, bpmTekst(d.bpm, d.gridZeker));
      klasse(e.bpm, 'leeg', !d.bpm);
      // Onzeker stuk: gedimd met "?", sync en beat-loops weigeren hier.
      klasse(e.bpm, 'onzeker', !!d.bpm && d.gridZeker === false);
      if (d.bpm && d.gridZeker === false) { if (e.bpm.title !== ONZEKER_TITEL) e.bpm.title = ONZEKER_TITEL; }
      else if (e.bpm.title) e.bpm.title = '';
      // TAP met een grid: "grid bekend", een rustige stijl — niet "actief",
      // want er gebeurt niets zolang je niet tikt.
      klasse(e.tap, 'grid-bekend', !!d.grid);
      // MAAT gedimd als de maatgever stilstaat (dan is het de eerste track met grid).
      const maat = s.maat === id, stil = maat && !d.playing;
      klasse(e.maat, 'hidden', !maat);
      klasse(e.maat, 'stil', stil);
      tekst(e.maat, stil ? 'MAAT (stil)' : 'MAAT');
      klasse(views.root, 'leeg', !d.loaded);

      // Fasemeter: hoe ver deze track voor of achter loopt, over een halve tel.
      // Handig bij handmatig beatmatchen én als controle op de sync.
      const f = s.fase?.[id];
      klasse(e.fase, 'leeg', f === null || f === undefined);
      if (f !== null && f !== undefined && d.grid && d.bpm) {
        const halveTel = 60 / d.bpm / 2;   // hoorbare tel HIER (d.bpm = grid op deze plek × rate)
        const uit = Math.max(-1, Math.min(1, f / halveTel));
        stijl(e.faseWijzer, 'left', `${(50 + uit * 46).toFixed(1)}%`);
        klasse(e.faseWijzer, 'strak', Math.abs(f) < 0.006);
        const ms = `${f >= 0 ? '+' : ''}${(f * 1000).toFixed(0)} ms`;
        if (e.fase.title !== ms) e.fase.title = ms;
      }
      // Wat er klinkt: het rack wijst naar PLEKKEN; de namen staan op de device knobs.
      tekst(fxNaam, d.fx.naam || '—');

      klasse(e.sync, 'gelijk', readAction(`track.${trackVanDeck(id)}.sync`) === 1);
      for (const b of e.beatBtns) {
        klasse(b, 'dood', !d.grid || d.gridZeker === false);
        klasse(b, 'on', d.loopBeats === b._tellen);
      }

      d.hotcues.forEach((t, i) => klasse(e.hotcues[i], 'set', t !== null));
      // Een seconde-loopknop brandt alleen als DEZE lengte loopt (de action weet dat).
      for (const b of e.loopBtns) klasse(b, 'on', !b.classList.contains('warn') && readAction(b.dataset.action) === 1);
      stappen.volgRackKiezer(id);
    });
    veilig('koppelpaneel', () => {
      stappen.koppelpaneel();
    });
    veilig('sampler', () => {
      // Sampler-pads: leeg, gevuld (met van welke track en hoeveel tellen), speelt.
      tekst(lengteKnop, `${engine.sampler.tellen} tel${engine.sampler.tellen === 1 ? '' : 'len'}`);
      for (const p of engine.sampler.stand()) {
        const el = padEls[p.pad - 1];
        klasse(el, 'gevuld', p.gevuld);
        klasse(el, 'speelt', p.speelt);
        klasse(el, 'bezig', p.bezig);
        klasse(el, 'bewaard', p.bewaard);
        tekst(el.lastElementChild, p.gevuld ? `track ${p.bron} · ${p.tellen}` : p.bewaard ? `↺ track ${p.bewaardBron} · ${p.bewaardTellen ?? '?'}` : '');
      }
    });
    veilig('opnemen', () => {
      stappen.opnemen();
    });
    veilig('video', () => {
      stappen.video();
    });
    veilig('master', () => {
      stijl(masterMeter, 'height', (s.masterPeak * 100).toFixed(1) + '%');
      klasse(masterMeter, 'clip', s.masterPeak > 0.98);
      tekst(curveBtn, 'curve: ' + s.xfaderCurve);
    });
  }
  requestAnimationFrame(frame);
}
