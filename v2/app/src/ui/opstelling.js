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
import { leegScherm, tekst, balk, lijn, pasIn, KOLOM, BREED } from '../control/maschine-scherm.js';
import { kenmerken, toonNaam } from '../auto/planner.js';
import { SYSTEMEN } from '../beeld/vormen/systemen.js';

const REGEL = Math.floor((BREED - 4) / 6);
const KNOPPEN = [
  ['opstelling.vorige', '‹', 'vorig recept'], ['opstelling.volgende', '›', 'volgend recept'], ['opstelling.laad', 'laad', 'het gekozen recept klaarzetten (nieuw zaad)'],
  ['opstelling.herrol', 'nieuw zaad', 'hetzelfde recept, alles opnieuw'], ['opstelling.muteer', 'muteer', 'een stap opzij'], ['opstelling.kruis', 'kruis', 'half deze, half de vorige'],
  ['opstelling.terug', 'terug', 'de vorige opstelling'], ['opstelling.genereer', 'genereer', 'een nieuw recept uit de bouwdoos'],
  ['opstelling.start', 'start', 'alles op de volgende 1'], ['opstelling.stop', 'stop', 'patronen stil'], ['opstelling.bewaar', 'bewaar', 'als nieuw recept bewaren'],
];

/** Het linker- of rechterscherm van de Maschine uit de stand van de opstelling. */
export function tekenOpstelling(st, nr) {
  const buf = leegScherm();
  const macros = st.macros ?? [];
  if (nr === 0) {
    tekst(buf, 2, 1, pasIn(st.naam ?? 'geen opstelling', Math.floor((BREED - 4) / 12)), 2);
  } else {
    tekst(buf, 2, 1, pasIn(st.kandidaat && st.kandidaat !== st.naam ? `wiel: ${st.kandidaat}` : (st.melding || ''), REGEL));
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
    }),
    laadNummer: (n, id) => library.laadOp(n, id, { bron: 'opstelling' }),
    zetVorm: beeld?.vormen ? (id, dekking) => {
      const v = beeld.vormen;
      v.zetSysteem(id);
      if (!v.laag.aan) v.wisselAan();
      if (Number.isFinite(dekking)) v.zetDekking(dekking);
    } : null,
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

  // De drift: elke 50 ms kijken; WAT er gebeurt zegt de maatklok (acties-opstelling.js tik).
  setInterval(() => o.tik(), 50);

  // ---- het paneel -------------------------------------------------------------------------
  paneel.innerHTML = `
    <div class="opst">
      <div class="opst-kop"><strong class="opst-naam">—</strong> <span class="opst-zaad"></span> <span class="opst-melding"></span></div>
      <div class="opst-knoppen">${KNOPPEN.map(([a, t, uitleg]) => `<button data-opst="${a}" title="${uitleg}">${t}</button>`).join('')}</div>
      <div class="opst-macros"></div>
      <div class="opst-scenes"></div>
      <div class="opst-sporen"></div>
      <p class="opst-uitleg">Een recept + een zaad = een opstelling. Maschine: draaiknop 1–8 = de macro's, pads midden = scenes, pads boven = nieuw zaad · muteer · kruis · terug, wiel = recept kiezen, indrukken = laden, PLAY = start, AUTO = nieuw recept, DUPLICATE = bewaren. Macro 7 (variatie) laat de opstelling uit zichzelf bewegen.</p>
    </div>`;
  const $ = (s) => paneel.querySelector(s);
  for (const b of paneel.querySelectorAll('[data-opst]')) b.addEventListener('click', () => { bus.doe(b.dataset.opst, true, { bron: 'scherm' }); bus.doe(b.dataset.opst, false, { bron: 'scherm' }); });
  const macroEl = $('.opst-macros'), sceneEl = $('.opst-scenes'), spoorEl = $('.opst-sporen');
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
    const scherm = ctl?.maschineScherm;
    if (scherm) for (const nr of [0, 1]) {
      const buf = tekenOpstelling(st, nr);
      // Alleen een beeld dat anders is dan het vorige gaat naar de hub.
      if (vorigBeeld[nr] && vorigBeeld[nr].every((x, i) => x === buf[i])) continue;
      vorigBeeld[nr] = buf;
      scherm(nr, buf);
    }
  }
  o.on('verander', teken);
  // Draaien en drift veranderen de waarden zonder 'verander': elke 100 ms tekenen is genoeg.
  setInterval(teken, 100);
  ctl?.on?.('maschine', (aan) => { if (aan) { vorm = ''; vorigBeeld[0] = vorigBeeld[1] = null; teken(); } });
  teken();
  return { teken, laadRecepten };
}
