/**
 * De schermlaag van de opstellingen (engine/acties-opstelling.js): recepten ophalen (de repo +
 * je eigen bewaarde), de library en het beeld aansluiten, de drift laten lopen, het paneel
 * "Opstelling" en de twee schermen van de Maschine.
 *
 * Wat de Maschine laat zien (256 × 64, 1 bit, control/maschine-scherm.js):
 *   links   het recept groot, daaronder macro 1–4 (naam, procent, balk), onderaan zaad en toon
 *   rechts  wat het wiel kiest of de laatste melding, macro 5–8, onderaan de scenes
 * Een macro die door de drift beweegt toont een tweede, dunne streep: waar hij nu is.
 */
import { leegScherm, tekst, balk, lijn, pasIn, regels, KOLOM, BREED } from '../control/maschine-scherm.js';
import { kenmerken, toonNaam } from '../auto/planner.js';
import { SYSTEMEN } from '../beeld/vormen/systemen.js';

const REGEL = Math.floor((BREED - 4) / 6);
const KNOPPEN = [
  ['opstelling.vorige', '‹', 'vorig recept'], ['opstelling.volgende', '›', 'volgend recept'], ['opstelling.laad', 'laad', 'het gekozen recept klaarzetten (nieuw zaad)'],
  ['opstelling.herrol', 'nieuw zaad', 'hetzelfde recept, alles opnieuw'], ['opstelling.muteer', 'muteer', 'een stap opzij'], ['opstelling.kruis', 'kruis', 'half deze, half de vorige'],
  ['opstelling.terug', 'terug', 'de vorige opstelling'], ['opstelling.genereer', 'genereer', 'een nieuw recept uit de bouwdoos'],
  ['opstelling.start', 'start', 'alles op de volgende 1'], ['opstelling.stop', 'stop', 'patronen stil'], ['opstelling.bewaar', 'bewaar', 'als nieuw recept bewaren'],
  ['opstelling.loop', 'laat lopen', 'een heel nummer: intro, opbouw, vol, breuk, vol, uitloop (Maschine SHIFT+PLAY, APC SESSION)'],
  ['opstelling.neem', '● vastleggen', 'wat je speelt als take bewaren (Maschine REC); nog eens = klaar'],
  ['opstelling.take.speel', '▶ take', 'de gekozen take afspelen (SHIFT+REC)'], ['opstelling.take.weg', '✕ take', 'naar de prullenbak (SHIFT+ERASE)'],
  ['opstelling.take.terug', '↶ take', 'de laatste uit de prullenbak terug (SHIFT+DUPLICATE)'],
];

/** De tocht op de schermen (CONTROL vast, of even na een nieuw hoofdstuk): links het hoofdstuk, rechts de doelen. */
export function tekenTocht(t, nr) {
  const buf = leegScherm();
  if (t.hoofdstuk >= t.aantal) {
    if (nr === 0) { tekst(buf, 2, 1, 'TOCHT UIT', 2); tekst(buf, 2, 22, pasIn(`${t.klaar}/${t.aantal} hoofdstukken, ${t.ontdekt} ontdekt`, REGEL)); }
    else { tekst(buf, 2, 1, pasIn('kies in het paneel:', REGEL)); tekst(buf, 2, 12, 'SPELEN of BOUWEN', 1); tekst(buf, 2, 24, pasIn(t.einde ? `gekozen: ${t.einde}` : 'je bent vrij', REGEL)); }
    return buf;
  }
  if (nr === 0) {
    tekst(buf, 2, 1, pasIn(`HOOFDSTUK ${t.hoofdstuk + 1}/${t.aantal}`, REGEL));
    tekst(buf, 2, 11, pasIn(t.titel, Math.floor((BREED - 4) / 12)), 2);
    lijn(buf, 0, BREED - 1, 27);
    regels(t.uitleg, REGEL).slice(0, 3).forEach((r, i) => tekst(buf, 2, 30 + i * 8, r));
    tekst(buf, 2, 56, pasIn(`${t.ontdekt} ontdekt   SHIFT+CONTROL = overslaan`, REGEL));
  } else {
    tekst(buf, 2, 1, pasIn('OPDRACHT', REGEL));
    t.doelen.slice(0, 4).forEach((d, i) => {
      const y = 12 + i * 11;
      tekst(buf, 2, y, pasIn(`${d.gedaan >= d.nodig ? 'v' : '-'} ${d.wat}`, REGEL - 6));
      tekst(buf, BREED - 32, y, `${d.gedaan}/${d.nodig}`);
    });
    if (t.laatsteNieuw) tekst(buf, 2, 56, pasIn(t.laatsteNieuw.tekst, REGEL));
  }
  return buf;
}

/**
 * Rechts, in een padstand (gebaren, drums, noten, stems, sampler): de 16 pads zoals ze liggen
 * (pad 13–16 bovenaan, 1–4 onderaan), met hun naam uit de indeling.
 */
export function tekenPads(stand, namen) {
  const buf = leegScherm();
  tekst(buf, 2, 1, pasIn(`PADS: ${stand.toUpperCase()}`, REGEL));
  lijn(buf, 0, BREED - 1, 10);
  for (let rij = 0; rij < 4; rij++) for (let k = 0; k < 4; k++) {
    const pad = (3 - rij) * 4 + k + 1;
    tekst(buf, k * KOLOM + 2, 13 + rij * 13, pasIn(namen[pad - 1] ?? '-'));
  }
  return buf;
}

/** Het linker- of rechterscherm van de Maschine uit de stand van de opstelling. */
export function tekenOpstelling(st, nr) {
  const buf = leegScherm();
  const macros = st.macros ?? [];
  if (nr === 0) {
    tekst(buf, 2, 1, pasIn(st.naam ?? 'geen opstelling', Math.floor((BREED - 4) / 12)), 2);
  } else {
    const status = st.take?.neemt ? `● NEEMT ${st.take.maten}` : st.take?.speelt ? `▶ ${st.take.speelt}` : st.loop ? `LOOPT ${st.loop.deel} ${st.loop.m}/${st.loop.maten}` : null;
    tekst(buf, 2, 1, pasIn(status ?? (st.kandidaat && st.kandidaat !== st.naam ? `wiel: ${st.kandidaat}` : (st.melding || '')), REGEL));
    tekst(buf, 2, 9, pasIn((st.sporen ?? []).map((s) => `${s.n}${s.soort === 'nummer' ? 'N' : s.wat?.[0]?.toUpperCase() ?? '-'}`).join(' '), REGEL));
  }
  lijn(buf, 0, BREED - 1, 17);
  for (let i = 0; i < 4; i++) {
    const m = macros[nr * 4 + i], x = i * KOLOM;
    if (!m) { tekst(buf, x + 2, 21, '-'); continue; }
    tekst(buf, x + 2, 21, pasIn(m.naam));
    tekst(buf, x + 2, 31, `${Math.round(m.waarde * 100)}%`);
    balk(buf, x + 2, 41, KOLOM - 6, 6, m.waarde);
    if (Math.abs((m.nu ?? m.waarde) - m.waarde) > 0.01) lijn(buf, x + 2, x + 2 + Math.round((m.nu ?? 0) * (KOLOM - 7)), 49);
  }
  lijn(buf, 0, BREED - 1, 53, true);
  if (nr === 0) {
    const toon = st.toon ? `${toonNaam(st.toon.sleutel) ?? ''} ${st.toon.ladder}` : '';
    tekst(buf, 2, 56, pasIn(st.zaad !== null && st.zaad !== undefined ? `#${st.zaad}  ${toon}${st.terug ? `  terug ${st.terug}` : ''}` : 'wiel = kiezen, indrukken = laden', REGEL));
  } else {
    tekst(buf, 2, 56, pasIn((st.scenes ?? []).map((s, i) => `${i + 1}${s.slice(0, 4)}`).join(' ') || 'AUTO = nieuw recept', REGEL));
  }
  return buf;
}

export function opzetOpstelling({ engine, bus, library, beeld, ctl, paneel, instelling, bewaarInstelling, haal = globalThis.fetch?.bind(globalThis) }) {
  const o = engine.opstelling;

  // ---- wat buiten de engine ligt ----------------------------------------------------------
  o.zetBronnen({
    catalogus: () => ({
      nummers: [...library.nummers.values()].filter((x) => !x.demo || library.nummers.size <= 5).map((x) => {
        let bpm = null, k = null;
        try { const km = kenmerken(x, 0); bpm = km.bpm ? Math.round(km.bpm) : null; k = km.k; } catch { /* geen grid */ }
        return { id: x.id, titel: x.titel, bpm, k, stems: x.stems ? (x.stems.namen?.length ?? 2) : 0 };
      }),
      instrumenten: engine.instrumenten.map((d) => d.soort),
      racks: (engine.fx?.sjablonen() ?? []).map((r) => r.name),
      vormen: beeld?.vormen ? SYSTEMEN.map((s) => s.id) : [],
      smaak: engine.tocht?.smaak() ?? null,
    }),
    laadNummer: (n, id) => library.laadOp(n, id, { bron: 'opstelling' }),
    zetVorm: beeld?.vormen ? (id, dekking) => {
      const v = beeld.vormen;
      v.zetSysteem(id);
      if (!v.laag.aan) v.wisselAan();
      if (Number.isFinite(dekking)) v.zetDekking(dekking);
    } : null,
    bewaarTakes: (x) => bewaarInstelling('takes', x),
    bewaar: async (recept) => {
      const eigen = (await instelling('opstellingen-eigen')) ?? [];
      await bewaarInstelling('opstellingen-eigen', [...eigen.filter((r) => r.id !== recept.id), recept]);
    },
  });

  const laadRecepten = async () => {
    const lijst = [];
    try {
      const r = await haal('/api/opstellingen', { cache: 'no-store' });
      const { namen = [] } = await r.json();
      for (const naam of namen) {
        const b = await haal(`/opstellingen/${naam}.json`, { cache: 'no-store' });
        const tekst = await b.text();   // altijd lezen (leesWeg)
        if (b.ok) lijst.push(JSON.parse(tekst));
      }
    } catch (e) { engine.meld(`opstellingen: ${e.message}`, 'fout', 'opstelling'); }
    const eigen = (await instelling('opstellingen-eigen')) ?? [];
    const fouten = o.zetRecepten([...lijst, ...(Array.isArray(eigen) ? eigen : [])]);
    for (const [id, f] of Object.entries(fouten)) engine.meld(`recept ${id}: ${f.length} fout(en), eerste: ${f[0]}`, 'fout', `opstelling:${id}`);
  };
  laadRecepten();
  instelling('takes').then((x) => { if (x) o.laadTakes(x); });

  // De drift: elke 50 ms kijken; WAT er gebeurt zegt de maatklok (acties-opstelling.js tik).
  setInterval(() => { o.tik(); engine.tocht?.tik(); engine.gebaren?.tik(); }, 50);

  // De tocht en je smaak: laden, en bewaren (een halve seconde na de laatste verandering).
  const tocht = engine.tocht;
  Promise.all([instelling('tocht'), instelling('smaak')]).then(([t, sm]) => tocht?.laad({ tocht: t, smaak: sm }));
  let bewaarTimer = null;
  tocht?.on('bewaar', ({ tocht: t, smaak: sm }) => {
    clearTimeout(bewaarTimer);
    bewaarTimer = setTimeout(() => { bewaarInstelling('tocht', t); bewaarInstelling('smaak', sm); }, 500);
  });

  // ---- het paneel -------------------------------------------------------------------------
  paneel.innerHTML = `
    <div class="opst">
      <div class="tocht"></div>
      <div class="opst-kop"><strong class="opst-naam">—</strong> <span class="opst-zaad"></span> <span class="opst-melding"></span></div>
      <div class="opst-knoppen">${KNOPPEN.map(([a, t, uitleg]) => `<button data-opst="${a}" title="${uitleg}">${t}</button>`).join('')}</div>
      <div class="opst-macros"></div>
      <div class="opst-scenes"></div>
      <div class="opst-partituur" title="De partituur (APC: USER): kolom = spoor, onder rustig, boven vol. Wit = speelt, geel = wacht op de maat."></div>
      <div class="opst-sporen"></div>
      <div class="opst-takes"></div>
      <p class="opst-uitleg">Een recept + een zaad = een opstelling. Maschine: draaiknop 1–8 = de macro's, pads midden = scenes, pads boven = nieuw zaad · muteer · kruis · terug, wiel = recept kiezen, indrukken = laden, PLAY = start, AUTO = nieuw recept, DUPLICATE = bewaren. Macro 7 (variatie) laat de opstelling uit zichzelf bewegen.</p>
    </div>`;
  const $ = (s) => paneel.querySelector(s);
  for (const b of paneel.querySelectorAll('[data-opst]')) b.addEventListener('click', () => { bus.doe(b.dataset.opst, true, { bron: 'scherm' }); bus.doe(b.dataset.opst, false, { bron: 'scherm' }); });
  const macroEl = $('.opst-macros'), sceneEl = $('.opst-scenes'), spoorEl = $('.opst-sporen'), tochtEl = $('.tocht');
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const druk = (actie) => { bus.doe(actie, true, { bron: 'scherm' }); bus.doe(actie, false, { bron: 'scherm' }); };
  tochtEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tocht) druk(b.dataset.tocht);
    if (b.dataset.recept) o.zet(b.dataset.recept);
  });
  let tochtSleutel = '';
  let tochtTot = 0;          // tot wanneer de schermen de tocht tonen na een nieuw hoofdstuk
  let vorigHoofdstuk = null;
  function tekenTochtPaneel(t) {
    const sleutel = JSON.stringify([t.hoofdstuk, t.doelen, t.einde, t.wensen.map((w) => w.stemmen), t.smaak, t.ontdekt, o.recepten().length]);
    if (sleutel === tochtSleutel) return;
    tochtSleutel = sleutel;
    const balkjes = t.hoofdstukken.map((h) => `<i class="${h.klaar ? 'klaar' : ''}${h.nu ? ' nu' : ''}" title="${esc(h.titel)}"></i>`).join('');
    const smaak = t.smaak.length ? `<div class="tocht-smaak">je smaak: ${t.smaak.map(([k, v]) => `<span>${esc(k)} <b>${v.toFixed(1)}</b></span>`).join(' ')}</div>` : '';
    let midden;
    if (t.hoofdstuk < t.aantal) {
      midden = `<div class="tocht-kop"><b>Hoofdstuk ${t.hoofdstuk + 1}/${t.aantal} · ${esc(t.titel)}</b> <span>${t.ontdekt} ontdekt</span>
          <button data-tocht="tocht.vorige" title="een hoofdstuk terug">‹</button><button data-tocht="tocht.overslaan" title="overslaan (je bent vrij)">overslaan ›</button></div>
        <p>${esc(t.uitleg)}</p>
        <ul>${t.doelen.map((d) => `<li class="${d.gedaan >= d.nodig ? 'af' : ''}">${esc(d.wat)} <span>${d.gedaan}/${d.nodig}</span></li>`).join('')}</ul>`;
    } else {
      const eigen = o.recepten().filter((r) => /-b\d+$|^gen-/.test(r.id));
      midden = `<div class="tocht-kop"><b>De tocht is uit</b> <span>${t.klaar}/${t.aantal} hoofdstukken · ${t.ontdekt} ontdekt</span></div>
        <div class="tocht-einde"><button data-tocht="tocht.spelen" class="${t.einde === 'spelen' ? 'aan' : ''}">Spelen: verder met wat je verzamelde</button>
          <button data-tocht="tocht.bouwen" class="${t.einde === 'bouwen' ? 'aan' : ''}">Bouwen: verder aan het spel</button>
          <button data-tocht="tocht.vorige">‹ terug in de tocht</button></div>
        ${t.einde === 'bouwen' ? `<p>Stem op wat er als volgende bij moet komen; Claude leest dit als bouwopdracht.</p><ol class="tocht-wensen">${t.wensen.map((w) => `<li><button data-tocht="tocht.stem.${w.nr}">+</button> <b>${esc(w.titel)}</b> <span>${w.stemmen}</span> — ${esc(w.uitleg)}</li>`).join('')}</ol>` : ''}
        ${t.einde === 'spelen' ? `<p>Je verzameling (${eigen.length}): bewaarde en gemaakte recepten.</p><div class="tocht-verzameling">${eigen.map((r) => `<button data-recept="${esc(r.id)}">${esc(r.naam)}</button>`).join('') || 'nog niets bewaard: DUPLICATE bewaart'}</div>` : ''}`;
    }
    tochtEl.innerHTML = `<div class="tocht-balk">${balkjes}</div>${midden}${smaak}`;
  }
  const takeEl = $('.opst-takes');
  let takeSleutel = '';
  function tekenTakes(st) {
    const k = st.take, l = st.loop;
    const sleutel = JSON.stringify([k, l]);
    if (sleutel === takeSleutel) return;
    takeSleutel = sleutel;
    const status = [
      l ? `<b>loopt</b> ${esc(l.deel)} ${l.m}/${l.maten} · ${l.gedaan}/${l.totaal} maten` : '',
      k.neemt ? `<b class="neemt">● neemt op</b> ${k.maten} maten` : '',
      k.speelt ? `<b>▶ ${esc(k.speelt)}</b>` : '',
    ].filter(Boolean).join(' · ');
    takeEl.innerHTML = `${status ? `<div>${status}</div>` : ''}${k.lijst.length ? `<div class="opst-takelijst">takes: ${k.lijst.map((x, i) => `<button data-take="${i}" class="${x.gekozen ? 'aan' : ''}" title="${x.maten} maten${x.loop ? ', met het verloop' : ''}">${esc(x.naam)}</button>`).join('')}${k.prullenbak ? ` <span>(${k.prullenbak} in de prullenbak)</span>` : ''}</div>` : ''}`;
  }
  takeEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-take]');
    if (!b) return;
    // Kiezen: met volgende/vorige tot de gekozen (de engine kent alleen een volgorde).
    const st = o.stand().take, doel = Number(b.dataset.take), nu = st.lijst.findIndex((x) => x.gekozen);
    for (let i = 0; i < (doel - nu + st.lijst.length) % st.lijst.length; i++) druk('opstelling.take.volgende');
  });
  const partEl = $('.opst-partituur');
  let partSleutel = '';
  function tekenPartituur(st) {
    const p = st.partituur ?? {};
    const sleutel = JSON.stringify([p, st.glij, st.morph]);
    if (sleutel === partSleutel) return;
    partSleutel = sleutel;
    const sporen = Object.keys(p).map(Number).sort((a, b) => a - b);
    if (!sporen.length) { partEl.innerHTML = ''; return; }
    const cel = (n, r) => {
      const x = p[n];
      const klas = x.wacht === r ? 'wacht' : x.actief === r && !x.uit ? 'speelt' : '';
      return `<button class="${klas}" data-variant="${n}.${r}" title="spoor ${n}, rij ${r}: ${esc(x.namen[r - 1])}">${esc(x.namen[r - 1]).slice(0, 14)}</button>`;
    };
    partEl.innerHTML = `<div class="opst-part-kop">partituur${st.glij ? ` · glijdt naar ${esc(st.glij)}` : ''}${st.morph ? ` · crossfader naar ${esc(st.morph.naar)} ${Math.round(st.morph.m * 100)}%` : ''}</div>`
      + [5, 4, 3, 2, 1].map((r) => `<div class="rij"><b>${r}</b>${sporen.map((n) => cel(n, r)).join('')}</div>`).join('')
      + `<div class="rij"><b></b>${sporen.map((n) => `<span>${p[n].uit ? `${n} uit` : n}</span>`).join('')}</div>`;
  }
  partEl.addEventListener('click', (e) => { const b = e.target.closest('[data-variant]'); if (b) druk(`opstelling.variant.${b.dataset.variant}`); });
  let vorm = '';
  const vorigBeeld = [null, null];
  function teken() {
    const st = o.stand();
    $('.opst-naam').textContent = st.naam ?? (st.aantal ? `kies een recept (${st.kandidaat})` : 'geen recepten');
    $('.opst-zaad').textContent = st.zaad !== null ? `#${st.zaad}${st.toon ? ` · ${toonNaam(st.toon.sleutel) ?? ''} ${st.toon.ladder}` : ''}` : '';
    $('.opst-melding').textContent = st.melding ?? '';
    const sleutel = `${st.recept}|${st.macros.map((m) => m?.naam ?? '-').join(',')}|${st.scenes.join(',')}|${st.sporen.map((s) => s.wat + s.rack + s.patroon).join(',')}`;
    if (sleutel !== vorm) {
      vorm = sleutel;
      macroEl.innerHTML = st.macros.map((m, i) => (m ? `<label title="${m.rol}">${i + 1} ${m.naam}<input type="range" min="0" max="1" step="0.001" data-macro="${i + 1}"><i></i></label>` : `<label class="leeg">${i + 1} —</label>`)).join('');
      for (const inp of macroEl.querySelectorAll('input')) inp.addEventListener('input', () => bus.doe(`opstelling.macro.${inp.dataset.macro}`, Number(inp.value), { bron: 'scherm' }));
      sceneEl.innerHTML = st.scenes.map((s, i) => `<button data-scene="${i + 1}">${i + 1} ${s}</button>`).join('');
      for (const b of sceneEl.querySelectorAll('button')) b.addEventListener('click', () => { bus.doe(`opstelling.scene.${b.dataset.scene}`, true, { bron: 'scherm' }); bus.doe(`opstelling.scene.${b.dataset.scene}`, false, { bron: 'scherm' }); });
      spoorEl.innerHTML = st.sporen.map((s) => `<div><b>${s.n}</b> ${s.wat}${s.rack ? ` · ${s.rack}` : ''}${s.patroon ? ` · ${s.patroon}` : ''}</div>`).join('');
    }
    st.macros.forEach((m, i) => {
      if (!m) return;
      const inp = macroEl.querySelector(`[data-macro="${i + 1}"]`);
      if (inp && document.activeElement !== inp) inp.value = String(m.waarde);
      const nu = inp?.nextElementSibling;
      if (nu) nu.style.width = `${Math.round((m.nu ?? m.waarde) * 100)}%`;
    });
    // De Maschine-schermen (alleen met de hub; de hub laat hooguit één beeld per 40 ms door).
    const t = tocht?.stand();
    if (t) {
      tekenTochtPaneel(t);
      if (vorigHoofdstuk !== null && t.hoofdstuk !== vorigHoofdstuk) tochtTot = performance.now() + 4000;
      vorigHoofdstuk = t.hoofdstuk;
    }
    const toonTocht = t && (t.toont || performance.now() < tochtTot);
    const padstand = (ctl?.maschine?.open ?? []).find((l) => l.startsWith('pads.'))?.slice(5) ?? null;
    const padNamen = padstand === 'gebaren' && engine.gebaren ? engine.gebaren.padLabels()
      : padstand ? Array.from({ length: 16 }, (_, i) => { const r = ctl.maschine.regelVoor(`pad${i + 1}`, { shift: false }); return r?.label ?? null; }) : null;
    tekenPartituur(st);
    tekenTakes(st);
    const scherm = ctl?.maschineScherm;
    if (scherm) for (const nr of [0, 1]) {
      const buf = toonTocht ? tekenTocht(t, nr) : (nr === 1 && padstand ? tekenPads(padstand, padNamen) : tekenOpstelling(st, nr));
      // Alleen een beeld dat anders is dan het vorige gaat naar de hub.
      if (vorigBeeld[nr] && vorigBeeld[nr].every((x, i) => x === buf[i])) continue;
      vorigBeeld[nr] = buf;
      scherm(nr, buf);
    }
  }
  o.on('verander', teken);
  tocht?.on('verander', teken);
  // Draaien en drift veranderen de waarden zonder 'verander': elke 100 ms tekenen is genoeg.
  setInterval(teken, 100);
  ctl?.on?.('maschine', (aan) => { if (aan) { vorm = ''; vorigBeeld[0] = vorigBeeld[1] = null; teken(); } });
  teken();
  return { teken, laadRecepten };
}
