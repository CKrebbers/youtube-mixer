import { read as readAction, trackVanDeck } from '../control/actions.js';
import { fmtTime } from '../lib/emitter.js';
import { BIJNA_EINDE } from './spiegel-plan.js';
import { bpmTekst } from './grid-strook.js';
import { focusToon, verschuivingTekst } from './toon-weergave.js';
import { oordeelBij, afwijkingBij } from '../engine/tellen.js';
import { zetTekst } from './dom.js';

/**
 * De renderloop: één rAF voor de hele UI. De engine wordt alleen uitgelezen,
 * nooit aangestuurd.
 *
 * Wat een eigen module is (de APC-spiegel, video, opnameknop, koppelpaneel,
 * rackkiezer) geeft zijn eigen tekenstap mee; de rest staat hier. Elke stap
 * heeft zijn eigen vangnet (`veilig`).
 */
const ONZEKER_TITEL = 'grid hier onzeker — tik het tempo of zet het grid op slot';

/**
 * Wat er NA het opstarten bij komt (werkruimte S7, docs/werkruimte/S7.md): een paneel dat
 * verschijnt (het werkvak, een vrij paneel) meldt zijn Knobs en faders hier aan, en haalt ze
 * weer weg als het verdwijnt (`bind(root)`/`ontbind(root)` in vensters.js). De renderloop
 * volgt ze elk beeld zoals de vaste knoppen. Een Set van groepen: aanmelden en afmelden kosten
 * niets per beeld, en zonder paneel is de lus precies de oude.
 */
const extra = new Set();
export function meldAan({ knobs = [], faders = [] } = {}) {
  const groep = { knobs, faders };
  extra.add(groep);
  return () => extra.delete(groep);
}
/** Hoeveel Knobs en faders er bij de renderloop aangemeld zijn (de vaste plus de panelen; voor de test). */
export function aangemeld() {
  let knobs = vast.knobs.length, faders = vast.faders.length;
  for (const g of extra) { knobs += g.knobs.length; faders += g.faders.length; }
  return { knobs, faders, groepen: extra.size };
}
const vast = { knobs: [], faders: [] };

export function startRenderloop({ engine, staat, views, knobs, faders, stappen }) {
  const { venster, analysis } = staat;
  vast.knobs = knobs; vast.faders = faders;

  const r = views.root;
  const e = {
    title: r.querySelector('.deck-title'),
    pos: r.querySelector('.t-pos'),
    rem: r.querySelector('.t-rem'),
    play: r.querySelector('.play'),
    pitch: r.querySelector('.pitch-val'),
    pitchBereik: r.querySelector('.pitch-bereik'),
    keylock: r.querySelector('.rek .keylock'),
    gridModus: r.querySelector('.grid-tools .grid-modus'),
    gridTerug: r.querySelector('.grid-tools .grid-terug'),
    gridOordeel: r.querySelector('.grid-oordeel'),
    gridControle: r.querySelector('.grid-tools .grid-controle'),
    rekToon: r.querySelector('.rek-toon'),
    hotcues: [...r.querySelectorAll('.hc')],
    loopBtns: [...r.querySelectorAll('.loops .btn:not(.bl)')],
    beatBtns: [...r.querySelectorAll('.loops .btn.bl')],
    bpm: r.querySelector('.bpm-val'),
    tap: r.querySelector('.tap'),
    sync: r.querySelector('.sync'),
    maat: r.querySelector('.maat-badge'),
    fase: r.querySelector('.fase'),
    faseWijzer: r.querySelector('.fase i'),
    toon: r.querySelector('.toon-val'),
    toonKnop: r.querySelector('.toon-knop'),
    toonHoofd: r.querySelector('.toon-hoofd'),
    toonVersch: r.querySelector('.toon-versch'),
    toonCent: r.querySelector('.toon-cent'),
    toonMenu: r.querySelector('.toon-menu'),
    toonMenuKnoppen: [...r.querySelectorAll('.toon-menu [data-action]')],
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
  const tekst = zetTekst;   // de bestaande tekstknoop, geen nieuwe (dom.js)
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const stijl = (el, prop, v) => { if (el.style[prop] !== v) el.style[prop] = v; };

  /**
   * Schermknoppen bijwerken vanuit de engine.
   *
   * De UI stuurt de engine aan via actions, maar hij moet hem ook VOLGEN: sinds
   * er MIDI bij is gekomen is de muis niet meer de enige bron. Een knop die je
   * vasthoudt laten we met rust, anders vecht de renderloop met je vinger.
   */
  function volgKnobs(lijst) {
    for (const k of lijst) {
      if (k.dragging || !k.action) continue;
      const v = readAction(k.action);
      if (v !== null && Math.abs(v - k.value) > 0.0005) k.set(v, true);
    }
  }
  function volgFaders(lijst) {
    for (const el of lijst) {
      if (el === document.activeElement) continue;
      const v = readAction(el.dataset.action);
      if (v !== null && Math.abs(parseFloat(el.value) - v) > 0.0005) el.value = v;
    }
  }
  function volgEngine() {
    volgKnobs(knobs);
    volgFaders(faders);
    // De panelen die er later bij kwamen (bind(root) in vensters.js).
    for (const g of extra) { volgKnobs(g.knobs); volgFaders(g.faders); }
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

  // De live bewaking (BEATGRID.md §11): hoe ver de laatste gevonden tellen
  // vóór de speelkop van het grid liggen. Vier keer per seconde is genoeg.
  const bewaking = {};
  function liveVan(dk, id, positie) {
    if (!dk.grid || !dk.tellen || !dk.playing) { bewaking[id] = null; return null; }
    const nu = performance.now(), b = bewaking[id];
    if (b && nu - b.t < 250 && b.versie === dk.gridVersie) return b.live;
    const live = afwijkingBij(dk.grid, dk.tellen.beats, positie);
    bewaking[id] = { t: nu, versie: dk.gridVersie, live };
    return live;
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
      views.zoom.draw(d, analysis[id], engine.deck(id).onsets, engine.deck(id).tellen);
      views.overview.draw(d, analysis[id]);

      // Een instrument op de track (docs/INSTRUMENTEN.md §6): zijn naam, geen golfvorm.
      tekst(e.title, d.instrument ? `♪ ${d.instrument.naam}` : (d.title || '— leeg —'));
      tekst(e.pos, fmtTime(d.position));
      const rest = Math.max(0, d.duration - d.position);
      tekst(e.rem, '-' + fmtTime(rest));
      klasse(e.rem, 'bijna', d.playing && d.loaded && rest < BIJNA_EINDE);
      klasse(e.play, 'on', d.playing);
      tekst(e.pitch, ((d.rate - 1) * 100).toFixed(1) + '%');
      tekst(e.pitchBereik, `±${Math.round(engine.deck(id).pitchBereik * 100)}`);
      // Keylock en toon (docs/KEYLOCK.md): wat er op het deck staat.
      const dk = engine.deck(id);
      if (e.keylock) klasse(e.keylock, 'on', dk.keylock);
      if (e.rekToon) { tekst(e.rekToon, verschuivingTekst(dk.transpositie) || '0'); klasse(e.rekToon, 'on', dk.transpositie !== 0); }
      // bpm: wat je HOORT, dus inclusief pitch.
      // Twee decimalen: een encodertik of een pin verandert de bpm met honderdsten.
      tekst(e.bpm, bpmTekst(d.bpm, d.gridZeker, 2));
      if (e.gridModus) klasse(e.gridModus, 'on', readAction('layer.edit.toggle') === 1);
      if (e.gridTerug) klasse(e.gridTerug, 'dood', !engine.deck(id).kanGridTerug);
      klasse(e.bpm, 'leeg', !d.bpm);
      // Onzeker stuk: gedimd met "?", sync en beat-loops weigeren hier.
      klasse(e.bpm, 'onzeker', !!d.bpm && d.gridZeker === false);
      if (d.bpm && d.gridZeker === false) { if (e.bpm.title !== ONZEKER_TITEL) e.bpm.title = ONZEKER_TITEL; }
      else if (e.bpm.title) e.bpm.title = '';
      // Klopt het grid HIER: gemeten aan de tellen, met de reden; ⚠ als het live wegloopt.
      if (e.gridOordeel) {
        const o = dk.grid ? oordeelBij(dk.grid, d.position, dk.gridMetingBij(performance.now()), liveVan(dk, id, d.position)) : null;
        const controle = s.gridControle === id;
        tekst(e.gridOordeel, o ? (controle ? `${o.kort} controle` : o.kort) : '—');
        for (const soort of ['vast', 'zeker', 'controleer', 'geenpuls', 'wijkt']) klasse(e.gridOordeel, soort, o?.soort === soort);
        klasse(e.gridOordeel, 'leeg', !o);
        klasse(e.gridOordeel, 'on', controle);
        const titel = o ? `${o.uitleg}${dk.tellen ? '' : ' (nog geen gevonden tellen om mee te meten)'}\nklik: ${controle ? 'controle stoppen' : 'controleren — een tik op elke gridlijn, stuk voor stuk'}` : 'geen grid';
        if (e.gridOordeel.title !== titel) e.gridOordeel.title = titel;
      }
      if (e.gridControle) klasse(e.gridControle, 'hidden', s.gridControle !== id);
      // Toonsoort die je HOORT (T3), groot: "4B · As majeur", +1, −32 ct.
      const toon = focusToon(d.loaded ? d.toon : null);
      tekst(e.toonHoofd, toon.hoofd);
      tekst(e.toonVersch, toon.verschuiving);
      tekst(e.toonCent, toon.cent);
      for (const soort of ['zeker', 'onzeker', 'geen', 'leeg']) klasse(e.toon, soort, toon.soort === soort);
      if (e.toonKnop.title !== toon.titel) e.toonKnop.title = toon.titel;
      // Het correctiemenu: wat niets te doen heeft (geen kaart) gedimd, slot brandt.
      if (!e.toonMenu.classList.contains('hidden')) {
        for (const b of e.toonMenuKnoppen) {
          const v = readAction(b.dataset.action);
          klasse(b, 'dood', v === null);
          klasse(b, 'on', v === 1);
        }
      }
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
    veilig('auto', () => {
      stappen.auto?.();
    });
    veilig('klankschaal', () => {
      stappen.klankschaal?.();
    });
    veilig('stems', () => {
      stappen.stems?.();
    });
    veilig('koptelefoon', () => {
      stappen.koptelefoon?.();
    });
    veilig('instrument', () => {
      stappen.instrument?.();
    });
    veilig('patronen', () => {
      stappen.patronen?.();
    });
    veilig('master-rij', () => {
      stappen.master?.();
    });
    veilig('beeld', () => {
      stappen.beeld?.();
    });
    veilig('opnemen', () => {
      stappen.opnemen();
    });
    veilig('logboek', () => {
      stappen.logboek?.();
    });
    veilig('video', () => {
      stappen.video();
    });
    veilig('master', () => {
      // transform, geen height: geen opmaak per beeld (styles.css, .meter.vmeter i).
      stijl(masterMeter, 'transform', `scaleY(${Math.min(1, Math.max(0, s.masterPeak)).toFixed(3)})`);
      klasse(masterMeter, 'clip', s.masterPeak > 0.98);
      tekst(curveBtn, 'curve: ' + s.xfaderCurve);
    });
  }
  requestAnimationFrame(frame);
}
