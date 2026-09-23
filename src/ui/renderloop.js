import { DECK_IDS } from '../engine/engine.js';
import { read as readAction, trackVanDeck } from '../control/actions.js';
import { fmtTime } from '../lib/emitter.js';
import { VENSTERS } from './vensters.js';

/**
 * De renderloop: één rAF voor de hele UI. De engine wordt alleen uitgelezen,
 * nooit aangestuurd.
 *
 * Wat een eigen module is (video, opnameknop, koppelpaneel, rackkiezer) geeft
 * zijn eigen tekenstap mee; de rest staat hier. Elke stap heeft zijn eigen
 * vangnet (`veilig`).
 */
export function startRenderloop({ engine, staat, views, knobs, faders, tracksEl, stappen }) {
  const { venster, analysis } = staat;
  const perDeck = (maak) => Object.fromEntries(DECK_IDS.map((id) => [id, maak(id)]));

  const els = {};
  for (const v of VENSTERS) {
    const r = views[v].root;
    els[v] = {
      title: r.querySelector('.deck-title'),
      pos: r.querySelector('.t-pos'),
      rem: r.querySelector('.t-rem'),
      play: r.querySelector('.play'),
      pitch: r.querySelector('.pitch-val'),
      pitchBereik: r.querySelector('.pitch-bereik'),
      meter: document.querySelector(`.strip[data-venster="${v}"] .ch-meter i`),
      hotcues: [...r.querySelectorAll('.hc')],
      loopBtns: [...r.querySelectorAll('.loops .btn:not(.bl)')],
      beatBtns: [...r.querySelectorAll('.loops .btn.bl')],
      bpm: r.querySelector('.bpm-val'),
      tap: r.querySelector('.tap'),
      sync: r.querySelector('.sync'),
      fxNaam: r.querySelector('.fx-naam'),
      fxBypass: r.querySelector('.fx-bypass'),
      fxPlekken: [...r.querySelectorAll('.fx-row .knob.fx-plek')],
      fxRack: r.querySelector('.fx-rack'),
      fxBewaar: r.querySelector('.fx-bewaar'),
      fase: r.querySelector('.fase'),
      faseWijzer: r.querySelector('.fase i'),
    };
  }
  const trkEls = perDeck((id) => {
    const r = tracksEl.querySelector(`.trk[data-deck="${id}"]`);
    return { root: r, titel: r.querySelector('.trk-titel'), meter: r.querySelector('.trk-meter i'),
      kanten: [...r.querySelectorAll('.trk-kant')], toon: [...r.querySelectorAll('.trk-toon')] };
  });
  const padEls = [...document.querySelectorAll('.pad')];
  const masterMeter = document.querySelector('.master-meter i');
  const curveBtn = document.querySelector('.curve');

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
    veilig('trackrij', () => {
      for (const id of DECK_IDS) {
        const d = s.decks[id], t = trkEls[id];
        if (t.titel.textContent !== (d.title || '— leeg —')) t.titel.textContent = d.title || '— leeg —';
        t.meter.style.width = (d.level * 100).toFixed(1) + '%';
        t.root.classList.toggle('speelt', d.playing);
        t.root.classList.toggle('leeg', !d.loaded);
        t.root.classList.toggle('focused', s.focus === id);
        t.root.classList.toggle('maat', s.maat === id);
        t.kanten.forEach((b) => b.classList.toggle('on', b.dataset.kant === d.kant));
        t.toon.forEach((b) => b.classList.toggle('on', venster[b.dataset.toon] === id));
      }
    });
    veilig('vensters', () => {
      for (const v of VENSTERS) {
        const id = venster[v];
        const d = s.decks[id], e = els[v];
        views[v].zoom.draw(d, analysis[id]);
        views[v].overview.draw(d, analysis[id]);

        e.title.textContent = d.title;
        e.pos.textContent = fmtTime(d.position);
        e.rem.textContent = '-' + fmtTime(Math.max(0, d.duration - d.position));
        e.play.classList.toggle('on', d.playing);
        e.pitch.textContent = ((d.rate - 1) * 100).toFixed(1) + '%';
        const bereik = `±${Math.round(engine.deck(id).pitchBereik * 100)}`;
        if (e.pitchBereik.textContent !== bereik) e.pitchBereik.textContent = bereik;
        e.meter.style.width = (d.level * 100).toFixed(1) + '%';
        // bpm: wat je HOORT, dus inclusief pitch.
        e.bpm.textContent = d.bpm ? d.bpm.toFixed(1) : '—';
        e.bpm.classList.toggle('leeg', !d.bpm);
        e.tap.classList.toggle('actief', !!d.grid);

        // Fasemeter: hoe ver dit deck voor of achter loopt, over een halve tel.
        // Handig bij handmatig beatmatchen én als controle op de sync.
        const f = s.fase?.[id];
        e.fase.classList.toggle('leeg', f === null || f === undefined);
        if (f !== null && f !== undefined && d.grid) {
          const halveTel = (60 / d.grid.bpm) / d.rate / 2;   // hoorbare tel: sneller = korter
          const uit = Math.max(-1, Math.min(1, f / halveTel));
          e.faseWijzer.style.left = `${50 + uit * 46}%`;
          e.faseWijzer.classList.toggle('strak', Math.abs(f) < 0.006);
          e.fase.title = `${f >= 0 ? '+' : ''}${(f * 1000).toFixed(0)} ms`;
        }
        // De knoppen wijzen naar een PLEK; wissel je van effect, dan verandert
        // alleen wat er onder die plek zit. Daarom lopen de labels mee.
        e.fxNaam.textContent = d.fx.naam || '—';
        e.fxBypass.classList.toggle('on', d.fx.bypass);
        // Een plek zonder macro staat er wel, maar dof en dood: zo zie je in één
        // oogopslag hoeveel knoppen dit rack gebruikt.
        e.fxPlekken.forEach((el, i) => {
          const p = d.fx.plekken.find((x) => x.plek === i + 1);
          const label = el.querySelector('.knob-label');
          const tekst = p?.naam || String(i + 1);
          if (label && label.textContent !== tekst) label.textContent = tekst;
          el.classList.toggle('leeg', !p);
        });

        e.sync.classList.toggle('gelijk', readAction(`track.${trackVanDeck(id)}.sync`) === 1);
        e.beatBtns.forEach((b) => {
          b.classList.toggle('dood', !d.grid);
          const n = parseFloat(b.dataset.action.split('.').pop());
          b.classList.toggle('on', d.loopBeats === n);
        });

        d.hotcues.forEach((t, i) => e.hotcues[i].classList.toggle('set', t !== null));
        e.loopBtns.forEach((b) => b.classList.toggle('on', !!d.loop && !b.classList.contains('warn')));
        views[v].root.classList.toggle('focused', s.focus === id);
        stappen.volgRackKiezer(id);
      }
    });
    veilig('koppelpaneel', () => {
      stappen.koppelpaneel();
    });
    veilig('sampler', () => {
      // Sampler-pads: leeg, gevuld (met van welke track en hoeveel tellen), speelt.
      const lengteKnop = document.querySelector('.sampler-lengte');
      const lengteTekst = `${engine.sampler.tellen} tel${engine.sampler.tellen === 1 ? '' : 'len'}`;
      if (lengteKnop.textContent !== lengteTekst) lengteKnop.textContent = lengteTekst;
      for (const p of engine.sampler.stand()) {
        const el = padEls[p.pad - 1];
        el.classList.toggle('gevuld', p.gevuld);
        el.classList.toggle('speelt', p.speelt);
        el.classList.toggle('bezig', p.bezig);
        el.classList.toggle('bewaard', p.bewaard);
        const t = p.gevuld ? `track ${p.bron} · ${p.tellen}` : p.bewaard ? `↺ track ${p.bewaardBron} · ${p.bewaardTellen ?? '?'}` : '';
        if (el.lastElementChild.textContent !== t) el.lastElementChild.textContent = t;
      }
    });
    veilig('opnemen', () => {
      stappen.opnemen();
    });
    veilig('video', () => {
      stappen.video();
    });
    veilig('master', () => {
      masterMeter.style.width = (s.masterPeak * 100).toFixed(1) + '%';
      masterMeter.classList.toggle('clip', s.masterPeak > 0.98);
      curveBtn.textContent = 'curve: ' + s.xfaderCurve;
    });
  }
  requestAnimationFrame(frame);
}
