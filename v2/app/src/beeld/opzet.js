/**
 * Beeld in de kern (BOUWPLAN plak 4): het paneel, de mixer, de vormlagen, de acties en het losse
 * venster in één opzet. Geen URL-vlag meer (v1 ?vormen=1, oogst beeld-054): de twee vormlagen zijn er
 * altijd (elk in een eigen Worker als de browser dat kan), maar rekenen pas als een laag aan staat:
 * de mixer vraagt alleen een beeld van een actieve laag.
 *
 *   const { beeld, venster, wissel } = opzetBeeld({ engine, bus, paneel, analyser });
 *
 * - `paneel` is een DOM-element: het tabblad "Beeld" onderin (`#paneel-beeld`, class `paneel`: doek
 *   links, bediening rechts) of een zijkolom naast de tracks; NOOIT een laag over de bediening (v1).
 *   Open = `!paneel.hidden` (de tabbladen zetten hidden); `wissel()` klapt het in en uit als er geen
 *   tabbladen zijn. Dicht en geen los venster = er wordt niets gemengd of gedecodeerd.
 * - `analyser` is de AnalyserNode van de master (na de limiter); zonder: engine.mixer.analyser.
 * - De engine wordt alleen GELEZEN (tracks, klok, nu, vertraging, zaalVersterking, 'laad').
 * - `venster()` opent het losse venster (beeld.html) of haalt het naar voren. Chrome blokkeert
 *   window.open zonder klik: roep het aan vanuit een klik of toets, niet vanaf een controller.
 *
 * Wie mengt (beamer.js): zolang het losse venster open en zichtbaar is mengt DAT, met zijn eigen
 * <video>'s en zijn eigen rAF (het blijft lopen als dit tabblad verborgen is); dit paneel toont dan
 * zijn beeld (captureStream, alleen als voorbeeld). Bij openen loopt het eerst in: dit venster mengt
 * door en zet elk beeld ook op het losse canvas, tot de eigen video's daar in de pas lopen.
 */
import { Beeld } from './stand.js';
import { VideoMixer } from './mixer.js';
import { Beamer } from './beamer.js';
import { definieerBeeld, VORM_KNOPPEN } from './acties.js';
import { VIDEO_FX, VIDEO_FX_ACTIE } from './instellingen.js';
import { VormLagen } from './vormen/laag.js';
import { SYSTEMEN, SYSTEEM } from './vormen/systemen.js';
import { Luisteraar } from './analyse/luisteraar.js';
import { KlokLezer } from './analyse/maat.js';
import { Router, MIX_BRONNEN, MAAT_BRONNEN, BRON_NAAM, DOEL_PLEKKEN, leesKenmerken } from './analyse/router.js';

/** Een 2D-canvas buiten het document: OffscreenCanvas waar het kan. */
const maakCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined'
  ? new OffscreenCanvas(w, h)
  : Object.assign(document.createElement('canvas'), { width: w, height: h }));

/** De url van de video van een nummer, of null (demo, los bestand, uitdrukkelijk zonder video). */
export function videoUrl(nummer) {
  if (!nummer || nummer.video === false || nummer.demo) return null;
  if (typeof nummer.video === 'string') return nummer.video;
  const id = String(nummer.id ?? '');
  if (!id || id.startsWith('demo')) return null;
  return `/api/library/${encodeURIComponent(id)}/video`;
}

const html = String.raw;

function bouwPaneel(paneel) {
  paneel.classList.add('beeld-paneel');
  const fx = VIDEO_FX.map((f) => html`<label class="beeld-schuif" title="video ${f.naam.toLowerCase()} (video.fx.${VIDEO_FX_ACTIE[f.id]})">
      <span>${f.naam}</span><input type="range" min="0" max="1" step="0.001" data-beeld-waarde="video.fx.${VIDEO_FX_ACTIE[f.id]}"></label>`).join('');
  const knoppen = Array.from({ length: VORM_KNOPPEN }, (_, k) => html`<label class="beeld-schuif vorm-knop" title="vormlaag: knop ${k + 1} (video.layer.knob.${k + 1})">
      <span>${k + 1}</span><input type="range" min="0" max="1" step="0.001" data-beeld-waarde="video.layer.knob.${k + 1}"></label>`).join('');
  paneel.innerHTML = html`
    <div class="beeld-kop">
      <strong>BEELD</strong>
      <span class="beeld-status" title=""></span>
      <button data-beeld-knop="los" title="Het losse venster (de beamer): sleep het naar het tweede scherm, dubbelklik = volledig scherm">los venster</button>
    </div>
    <div class="beeld-doek">
      <canvas class="beeld-canvas" aria-label="Het beeld zoals de zaal het ziet"></canvas>
      <video class="beeld-voorbeeld verstopt" muted playsinline aria-label="Het beeld van het losse venster"></video>
    </div>
    <div class="beeld-bediening">
    <div class="beeld-rij beeld-nood" aria-label="Noodknoppen">
      <button data-beeld="video.black" title="Zwart (aan/uit, 250 ms)">ZWART</button>
      <button data-beeld="video.black.hold" title="Zwart zolang je drukt">ZWART ▮</button>
      <button data-beeld="video.freeze" title="Beeld bevriezen (aan/uit); de video's lopen door">BEVRIES</button>
      <button data-beeld="video.flash" title="Witte flits (300 ms)">FLITS</button>
      <button data-beeld="video.clips" class="beeld-clips" title="Deck-video's aan/uit: uit = alleen eigen beeld (vormen), voor een zaal">CLIPS</button>
      <label class="beeld-schuif breed" title="Helderheid van het eindbeeld (video.master)"><span>MASTER</span><input type="range" min="0" max="1" step="0.001" data-beeld-waarde="video.master"></label>
    </div>
    <div class="beeld-rij beeld-meng">
      <button data-beeld="video.mode" title="Hoe de tracks over elkaar vallen">MENG <b class="beeld-modus"></b></button>
      <button data-beeld="video.fit" title="Passend (randen) of vullen (bijsnijden)">PAS <b class="beeld-fit"></b></button>
      <label class="beeld-schuif breed" title="Puls op de tel van de klok, zoals je hem hoort (video.pulse)"><span>PULS</span><input type="range" min="0" max="1" step="0.001" data-beeld-waarde="video.pulse"></label>
      <button data-beeld="video.pulse.target" title="Wat er pulst">OP <b class="beeld-pulsdoel"></b></button>
    </div>
    <div class="beeld-rij beeld-fx">${fx}</div>
    <div class="beeld-rij beeld-vorm" aria-label="Vormlagen">
      <span class="beeld-label">VORM</span>
      <button data-beeld="video.layer.select.1" title="Vormlaag 1 kiezen">1</button>
      <button data-beeld="video.layer.select.2" title="Vormlaag 2 kiezen">2</button>
      <button data-beeld="video.layer.on" class="vorm-aan" title="Laag aan/uit">AAN</button>
      <button data-beeld="video.layer.prev" title="Vorige vorm">◀</button>
      <select class="vorm-systeem" title="Welke vorm">${SYSTEMEN.map((s) => html`<option value="${s.id}">${s.naam}</option>`).join('')}</select>
      <button data-beeld="video.layer.next" title="Volgende vorm">▶</button>
      <button data-beeld="video.layer.blend" title="Hoe de vorm over de video valt">MENG <b class="vorm-meng"></b></button>
      <label class="beeld-schuif" title="Dekking (video.layer.opacity)"><span>DEK</span><input type="range" min="0" max="1" step="0.001" data-beeld-waarde="video.layer.opacity"></label>
    </div>
    <div class="beeld-rij beeld-vormknoppen">${knoppen}</div>
    <div class="beeld-rij beeld-reageer">
      <label class="beeld-schuif" title="Hoe sterk de vorm op de mix of de klok reageert (video.layer.react)"><span>REAGEER</span><input type="range" min="0" max="1" step="0.001" data-beeld-waarde="video.layer.react"></label>
      <select class="vorm-bron" title="Waarop: wat de zaal hoort (de master) of de klok">
        <optgroup label="de zaal (master)">${MIX_BRONNEN.map((b) => html`<option value="${b}">${BRON_NAAM[b]}</option>`).join('')}</optgroup>
        <optgroup label="de klok">${MAAT_BRONNEN.map((b) => html`<option value="${b}">${BRON_NAAM[b]}</option>`).join('')}</optgroup>
      </select>
      <span>→</span>
      <select class="vorm-doel" title="Welke knop reageert">${Array.from({ length: DOEL_PLEKKEN }, (_, k) => html`<option value="${k + 1}">${k + 1}</option>`).join('')}</select>
      <span class="vorm-metingen"><span class="vorm-meting">1 uit</span><span class="vorm-meting">2 uit</span></span>
    </div>
    </div>`;
  const $ = (s) => paneel.querySelector(s);
  return {
    canvas: $('.beeld-canvas'), voorbeeld: $('.beeld-voorbeeld'), status: $('.beeld-status'), los: $('[data-beeld-knop="los"]'),
    modus: $('.beeld-modus'), fit: $('.beeld-fit'), pulsDoel: $('.beeld-pulsdoel'),
    systeem: $('.vorm-systeem'), vormMeng: $('.vorm-meng'), bron: $('.vorm-bron'), doel: $('.vorm-doel'),
    knopLabels: [...paneel.querySelectorAll('.vorm-knop span')], metingen: [...paneel.querySelectorAll('.vorm-meting')],
    knoppen: [...paneel.querySelectorAll('button[data-beeld]')], schuiven: [...paneel.querySelectorAll('input[data-beeld-waarde]')],
  };
}

/** Knoppen en schuiven van het paneel aan de bus. Eigen attributen, zodat de rest van het scherm ze niet ook bindt. */
function bindPaneel(el, bus) {
  for (const b of el.knoppen) {
    const id = b.dataset.beeld;
    b.addEventListener('pointerdown', (e) => {
      if (b.disabled) return;
      e.preventDefault();
      bus.doe(id, true);
      const los = () => { bus.doe(id, false); removeEventListener('pointerup', los); removeEventListener('pointercancel', los); };
      addEventListener('pointerup', los);
      addEventListener('pointercancel', los);
    });
    b.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); bus.doe(id, true); bus.doe(id, false); }
    });
  }
  for (const s of el.schuiven) {
    s.addEventListener('input', () => bus.doe(s.dataset.beeldWaarde, Number(s.value)));
    s.addEventListener('dblclick', () => {
      const id = s.dataset.beeldWaarde;
      bus.doe(id, id === 'video.master' ? 1 : id === 'video.fx.color' || id.startsWith('video.layer.knob') ? 0.5 : id === 'video.layer.opacity' ? 0.8 : 0);
    });
  }
  // Elk beeld terug lezen (een controller kan ook draaien); alleen wat verandert wordt geschreven.
  const vorig = new Map();
  return () => {
    for (const b of el.knoppen) {
      const v = bus.lees(b.dataset.beeld);
      const s = v === null || v === undefined ? 'uit' : v >= 1 ? 'aan' : 'leeg';
      if (vorig.get(b) !== s) { vorig.set(b, s); b.dataset.stand = s; b.disabled = s === 'uit'; }
    }
    for (const s of el.schuiven) {
      const v = bus.lees(s.dataset.beeldWaarde);
      const leeg = v === null || v === undefined;
      if (s.disabled !== leeg) s.disabled = leeg;
      if (!leeg && document.activeElement !== s && Number(s.value) !== v) s.value = v;
    }
  };
}

const schrijf = (el, tekst) => { if (el && el.textContent !== tekst) el.textContent = tekst; };

/**
 * @param doek  { breedte, hoogte }; standaard 1280 × 720. Alleen voor de proef (software-WebGL); het losse
 *              venster neemt dezelfde maat over.
 */
export function opzetBeeld({ engine, bus = engine.bus, paneel, analyser = null, meld = (t, s, k) => engine.meld?.(t, s, k), doek = null }) {
  const tracks = engine.tracks.length;

  // ---- model: vormen, routes, stand -----------------------------------------------------
  const vormen = new VormLagen({ maakCanvas });
  const router = new Router(vormen.lagen.length);
  const beeld = new Beeld({ tracks, vormen, router });
  const luisteraar = new Luisteraar({ analyser: () => analyser ?? engine.mixer?.analyser ?? null, sampleRate: () => engine.ctx.sampleRate });
  const maat = new KlokLezer(() => engine.klok);
  // Reageren op de mix: de analyse loopt MEE met het tekenen (vlak voor een laag zijn beeld maakt, met
  // dezelfde t), geen eigen timer; alleen wat een open route nodig heeft wordt gelezen (oogst beeld-058).
  let wasActief = false;
  for (const laag of vormen.lagen) {
    const teken = laag.frame.bind(laag);
    laag.frame = (t) => {
      const nodig = router.nodig();
      const actief = nodig.size > 0;
      if (actief || wasActief) router.pasToe(actief ? leesKenmerken(t, nodig, { mix: luisteraar, maat }) : null, vormen.lagen);
      wasActief = actief;
      return teken(t);
    };
  }
  vormen.on('noodrem', ({ laag, systeem, ms, kwaliteit }) => meld(
    `vormlaag ${laag + 1} (${SYSTEEM[systeem]?.naam ?? systeem}): ${Math.round(ms)} ms per beeld, te zwaar — kwaliteit naar ${Math.round(kwaliteit * 100)}%`, 'info', `vorm:${laag}`));
  vormen.on('modus', ({ laag, reden }) => meld(`vormlaag ${laag + 1} draait op de hoofdthread (${reden})`, 'info', `vorm:${laag}`));
  vormen.on('fout', ({ laag, systeem, bericht }) => meld(`vormlaag ${laag + 1} (${SYSTEEM[systeem]?.naam ?? systeem}): ${bericht}`, 'fout', `vorm:${laag}`));
  definieerBeeld(bus, beeld);

  // ---- scherm -------------------------------------------------------------------------
  const el = bouwPaneel(paneel);
  const volgKnoppen = bindPaneel(el, bus);
  const mixer = new VideoMixer({ canvas: el.canvas, tracks, ...(doek ? { breedte: doek.breedte, hoogte: doek.hoogte } : {}) });
  const titelVan = (n) => engine.track?.(n)?.nummer?.titel ?? engine.tracks[n - 1]?.nummer?.titel ?? '';
  const meldFout = (n, tekst) => {
    if (!n) { meld(`beeld: ${tekst}`, 'fout', 'beeld'); return; }
    const titel = titelVan(n);
    meld(`video van track ${n}${titel ? ` (${titel})` : ''}: ${tekst}`, 'fout', `video:${n}`);
  };
  mixer.onFout = meldFout;
  if (mixer.fout) meld(`beeld: ${mixer.fout}`, 'fout', 'beeld');

  el.systeem.addEventListener('change', () => vormen.zetSysteem(el.systeem.value));
  el.bron.addEventListener('change', () => router.zetBron(vormen.gekozen, el.bron.value));
  el.doel.addEventListener('change', () => router.zetDoel(vormen.gekozen, Number(el.doel.value)));
  const volgVorm = () => {
    const laag = vormen.laag;
    if (el.systeem.value !== laag.sys.id) el.systeem.value = laag.sys.id;
    schrijf(el.vormMeng, laag.mengvorm);
    el.knopLabels.forEach((s, k) => {
      const kn = laag.knoppen[k];
      schrijf(s, kn ? kn.l : '—');
      s.parentElement.title = kn ? `${kn.l} (${kn.min}–${kn.max}) — video.layer.knob.${k + 1}` : `knop ${k + 1}: deze vorm heeft hem niet`;
    });
    const r = router.route(vormen.gekozen);
    if (el.bron.value !== r.bron) el.bron.value = r.bron;
    [...el.doel.options].forEach((o, k) => { o.textContent = laag.knoppen[k] ? `${k + 1} ${laag.knoppen[k].l}` : `${k + 1} (—)`; });
    if (el.doel.value !== String(r.doel)) el.doel.value = String(r.doel);
  };
  vormen.on('change', volgVorm);
  router.on('change', volgVorm);
  volgVorm();

  // ---- welke video op welke track ---------------------------------------------------------
  // Bij het begin van een laad meteen weg (het oude beeld hoort niet bij het nieuwe nummer); als de
  // laad klaar is: de video van de library, maar pas als de server zegt dat hij er is (HEAD). Een
  // nummer zonder video is geen fout (oogst beeld-040).
  const laadNr = new Array(tracks + 1).fill(0);
  engine.on('laad', ({ n, stand, nummer }) => {
    const nr = ++laadNr[n];
    if (stand !== 'klaar') { if (stand === 'laadt') beeld.zetBron(n, null); return; }
    const url = videoUrl(nummer);
    if (!url) { beeld.zetBron(n, null); return; }
    fetch(url, { method: 'HEAD' })
      .then((r) => { if (nr === laadNr[n]) beeld.zetBron(n, r.ok ? url : null); })
      .catch(() => { if (nr === laadNr[n]) beeld.zetBron(n, null); });
  });

  // ---- het losse venster ----------------------------------------------------------------
  const beamer = new Beamer();
  const paneelOpen = () => !paneel.hidden;
  const wie = () => beamer.wieMengt({ paneelOpen: paneelOpen(), opname: null, hoofdVerborgen: document.hidden, nu: performance.now() });
  const api = {
    engine, beeld, tracks,
    maat: { breedte: mixer.B, hoogte: mixer.H },
    // performance.now() hier is die van DIT venster, ook als het losse venster de functie aanroept:
    // de inloop rekent met één klok.
    meldAan: (venster, losMixer) => beamer.meldAan(venster, losMixer, performance.now()),
    meldAf: (venster) => beamer.meldAf(venster),
    rolLos: (venster) => beamer.rolLos(venster, wie()),
    meldPas: (venster, pas) => beamer.meldPas(venster, pas, performance.now()),
    losOpen: () => !!beamer.levend(),
    opnameUitLos: () => false,          // v2 neemt (nog) geen beeld op
    meldFout,
    mixer,
    // Voor de proef (tools/proef-beeld.mjs): wordt aangeroepen meteen na elk beeld dat DIT venster
    // mengt, in dezelfde taak (daarna is een WebGL-canvas zonder preserveDrawingBuffer leeg).
    naBeeld: null,
  };
  globalThis.varveBeeld = api;

  function venster() {
    const los = beamer.levend();
    if (los) { los.venster.focus(); return los.venster; }
    // window.open met dezelfde naam zou een bestaand venster herladen: daarom eerst levend() (v1).
    return window.open('/beeld.html', 'varve-beeld', 'width=960,height=540');
  }
  el.los.addEventListener('click', () => venster());

  // Het beeld van het losse venster in het paneel (of niets): captureStream is goed genoeg voor een
  // voorbeeld, nooit voor de beamer zelf (oogst beeld-024). Verborgen kijkt er niemand.
  let voorbeeldVan = null;
  function zetVoorbeeld(bron) {
    if (document.hidden) bron = null;
    if (bron === voorbeeldVan) return;
    el.voorbeeld.srcObject?.getTracks().forEach((t) => t.stop());
    el.voorbeeld.srcObject = null;
    voorbeeldVan = bron;
    if (bron) {
      try { el.voorbeeld.srcObject = bron.captureStream(30); el.voorbeeld.play().catch(() => {}); } catch (e) { meld(`beeld: voorbeeld van het losse venster: ${e.message}`, 'info', 'beeld'); }
    }
    el.canvas.classList.toggle('verstopt', !!bron);
    el.voorbeeld.classList.toggle('verstopt', !bron);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) zetVoorbeeld(null); });

  // ---- de lus ---------------------------------------------------------------------------
  let laatsteStatus = 0;
  function status(w, los) {
    schrijf(el.modus, beeld.stand.modus);
    schrijf(el.fit, beeld.stand.fit);
    schrijf(el.pulsDoel, beeld.stand.pulsDoel);
    const nu = performance.now();
    if (nu - laatsteStatus < 250) return;
    laatsteStatus = nu;
    const bron = w.hoofd || !los ? mixer : los.mixer;
    const st = bron.stand(engine).filter((l) => l.video && l.speelt);
    const wat = !beeld.stand.clips ? 'clips uit'
      : st.length ? st.map((l) => `${l.n}: ${Math.round(l.verschil * 1000)} ms`).join(' · ') : 'geen zichtbare video';
    schrijf(el.status, mixer.fout || `${w.los ? 'beamer · ' : w.inloop ? 'beamer loopt in · ' : ''}${wat}`);
    el.status.title = w.los ? 'het losse venster mengt (het loopt door als dit tabblad verborgen is)'
      : w.inloop ? 'het losse venster toont dit beeld tot zijn eigen video\'s in de pas lopen; dan mengt het zelf' : '';
    vormen.lagen.forEach((laag, i) => {
      const ms = laag.ms;
      const tekst = !laag.aan ? `${i + 1} uit` : ms == null ? `${i + 1} …`
        : `${i + 1} · ${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms · ${Math.round(laag.kwaliteit * 100)}%`;
      schrijf(el.metingen[i], tekst);
      el.metingen[i].classList.toggle('krap', laag.aan && (laag.teZwaar || laag.kwaliteit < 1));
      el.metingen[i].title = `vormlaag ${i + 1}: ${laag.modus === 'werker' ? 'in een Worker' : 'op de hoofdthread'}, budget ${laag.budgetMs} ms per beeld`;
    });
  }

  let laatsteKlacht = 0;
  function frame() {
    try {
      const w = wie();
      const los = beamer.levend();
      if (w.hoofd) { mixer.teken(engine, beeld); api.naBeeld?.(mixer); }
      else mixer.pauzeerAlles();
      // Inloop: dit beeld ook op het losse venster, nu het nog in de buffer staat (dezelfde taak).
      if (w.inloop && los) los.mixer.toonBeeld(el.canvas);
      zetVoorbeeld(w.voorbeeld && los ? los.mixer.canvas : null);
      if (paneelOpen()) { volgKnoppen(); status(w, los); }
    } catch (e) {
      // Eén slecht beeld mag het beeld niet stilzetten; wel melden, hooguit één keer per seconde.
      if (performance.now() - laatsteKlacht > 1000) { laatsteKlacht = performance.now(); meld(`beeld: ${e.message}`, 'fout', 'beeld'); }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function wissel(aan = paneel.hidden) {
    paneel.hidden = !aan;
    if (!wie().hoofd) mixer.pauzeerAlles();
    return aan;
  }

  return { beeld, venster, wissel, mixer, vormen, router, beamer, api };
}
