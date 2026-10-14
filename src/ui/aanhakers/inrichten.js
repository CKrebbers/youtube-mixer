// Aanhaker 'inrichten' (spoor S8, docs/WERKRUIMTE.md A9 en D4 "S8", docs/werkruimte/S8.md).
// Alleen dit spoor raakt dit bestand; wat ctx bevat staat in src/ui/aanhakers.js.
//
// ✎ INRICHTEN ZONDER JSON (VISIE §5.3). Clay maakt zelf de indeling; dit is het mechaniek:
//   - ✎ op de werk-balk opent een klein paneel (.ir-paneel), alleen met een werkruimte (niet `standaard`);
//   - aanwijzen: klik een knop op het scherm (die gaat dan NIET af: learn-mode.js zetAanwijzer) of beweeg
//     een control op de APC: wat hij NU doet wordt een item op het gekozen paneel (focus-track = {focus});
//   - de zoeker: de top-40 van de handelingen bovenaan (tools/werkruimtes/top40.json), daarna alles;
//   - een item weghalen: klik, en binnen 3 s nog eens;
//   - het paneel op een scherm van het deel (hoofd = het werkvak, mac-2, ipad, iphone);
//   - "wijs toe aan": APC device knobs, Maschine-draaiknoppen, Maschine-pads, F1–F8: regels in een
//     EIGEN mapje dat dit deel openzet; het model weigert een kernsleutel of een bezette plek met reden;
//   - ↶ terug naar de vorige inrichting (werk.terug, alleenScherm);
//   - "leg vast in dit deel" staat al op de balk (S3).
// Elke bewerking = één opslag met versie (409: niets overschreven) en de mixer laadt opnieuw met
// hetzelfde deel. Een deelwissel of inrichten zet nooit een klank (W3).
import { voegKnopToe } from '../werk-balk.js';
import { zetAanwijzer } from '../learn-mode.js';
import { list } from '../../control/actions.js';
import { resolveTarget } from '../../control/mapping.js';
import { leesWeg } from '../../lib/antwoord.js';

export default async function opzet(ctx) {
  if (!ctx?.werk || typeof document === 'undefined') return;
  const { werk, define, meld } = ctx;
  // Lui: met `standaard` (of zolang niemand ✎ indrukt) laadt hier niets: geen module, geen fetch, geen paneel.
  // Alleen de knop (de werk-balk is dan hidden) en de action werk.terug (die pas bij gebruik laadt).
  let klaar = null;
  const laad = () => (klaar ??= bouw(ctx));
  define('werk.terug', 'trigger', (on) => { if (on) laad().then((x) => x.inrichter.terug()); },
    { label: 'Werkruimte: terug naar de vorige inrichting', alleenScherm: true, log: 'overslaan', beginstand: false });
  const knop = document.createElement('button');
  knop.className = 'ghost werk-inrichten';
  knop.textContent = '✎';
  knop.title = 'inrichten zonder JSON: knoppen aanwijzen, panelen maken en op een scherm of een groep knoppen zetten';
  knop.addEventListener('click', () => laad().then((x) => x.open(x.el.hidden)));
  voegKnopToe(knop);
  window.varveInrichten = { laad };
  void meld; void werk;
}

async function bouw(ctx) {
  const { werk, meld, metaOf, midi } = ctx;
  const I = await import('../../werk/inrichten.js');

  const bewaar = async (naam, ruw, versie) => {
    const r = await fetch(`/api/werkruimtes/${encodeURIComponent(naam)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ werkruimte: ruw, versie }) });
    const d = await r.json().catch(() => null);
    if (!d) await leesWeg(r);
    return { ok: r.ok, status: r.status, versie: d?.versie, fout: d?.fout };
  };
  const terugApi = async (naam, versie) => {
    const r = await fetch(`/api/werkruimtes/${encodeURIComponent(naam)}/terug`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versie }) });
    const d = await r.json().catch(() => null);
    if (!d) await leesWeg(r);
    return { ok: r.ok, status: r.status, versie: d?.versie, fout: d?.fout };
  };
  const inrichter = new I.Inrichter({ werk, bewaar, terugApi, meld: (t, s) => meld?.(t, s) });

  let top40 = [];
  try { const r = await fetch('tools/werkruimtes/top40.json'); if (r.ok) top40 = (await r.json())?.top40 ?? []; else await leesWeg(r); } catch (_) {}

  // ---- het paneel ----------------------------------------------------------------------------
  const maak = (tag, klasse, tekst) => { const x = document.createElement(tag); if (klasse) x.className = klasse; if (tekst !== undefined) x.textContent = tekst; return x; };
  const el = maak('div', 'ir-paneel');
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'inrichten');
  const kop = maak('div', 'ir-kop');
  const titel = maak('span', 'ir-titel', '✎ inrichten');
  const dicht = maak('button', 'ghost ir-dicht', '×');
  kop.append(titel, dicht);
  const paneelKies = maak('select', 'ir-paneel-kies');
  const nieuwNaam = maak('input', 'ir-nieuw');
  nieuwNaam.placeholder = 'nieuw paneel (naam)';
  const rij = (label, ...kind) => { const r = maak('div', 'ir-rij'); r.append(maak('span', 'ir-label', label), ...kind); return r; };
  const aanwijs = maak('button', 'ir-aanwijs', 'wijs aan');
  aanwijs.title = 'klik daarna een knop op het scherm (hij gaat dan niet af) of beweeg een control op de APC: wat hij nu doet komt op het paneel';
  const zoekEl = maak('input', 'ir-zoek');
  zoekEl.type = 'search'; zoekEl.placeholder = 'zoek een functie (top-40 bovenaan)';
  const lijst = maak('div', 'ir-lijst');
  const items = maak('div', 'ir-items');
  const schermen = maak('span', 'ir-knoppen');
  const doelen = maak('span', 'ir-knoppen');
  const terug = maak('button', 'ir-terug', '↶ terug naar de vorige inrichting');
  const stand = maak('div', 'ir-stand');
  el.append(kop, rij('paneel', paneelKies, nieuwNaam), rij('erbij', aanwijs, zoekEl), lijst, rij('op het paneel', items),
    rij('zet op scherm', schermen), rij('wijs toe aan', doelen), rij('', terug), stand);
  document.body.appendChild(el);

  const knop = document.querySelector('#werk-balk .werk-inrichten') ?? maak('button');

  let gekozen = null;
  let markeer = null;   // { i, t } eerste klik op een item
  const panelen = () => werk.ruw?.panelen ?? {};
  const zegStand = (t, soort = 'info') => { stand.textContent = t; stand.dataset.soort = soort; };

  function bouwKiezer() {
    const namen = Object.keys(panelen());
    if (!gekozen || !namen.includes(gekozen)) gekozen = namen[0] ?? null;
    paneelKies.replaceChildren(...namen.map((n) => { const o = maak('option', '', `${n}${panelen()[n]?.titel ? ` · ${panelen()[n].titel}` : ''}`); o.value = n; return o; }),
      Object.assign(maak('option', '', '+ nieuw paneel…'), { value: '' }));
    paneelKies.value = gekozen ?? '';
    nieuwNaam.hidden = !!gekozen;
  }
  function doelPaneel() {
    if (gekozen) return gekozen;
    const n = I.paneelNaam(nieuwNaam.value);
    if (!n) { zegStand('geef het nieuwe paneel een naam (letters en cijfers)', 'fout'); return null; }
    return n;
  }
  function bouwItems() {
    items.replaceChildren();
    const p = gekozen ? panelen()[gekozen] : null;
    if (!p) { items.append(maak('span', 'ir-dim', gekozen ? '—' : 'nog geen paneel')); return; }
    p.items?.forEach((it, i) => {
      const b = maak('button', 'ir-item', `${it.label ?? it.action ?? it.tekst ?? it.soort}`);
      b.title = `${it.soort}: ${it.action ?? ''}\nklik, en binnen 3 s nog eens = weghalen`;
      if (markeer?.i === i && performance.now() - markeer.t < 3000) b.classList.add('vraag');
      b.addEventListener('click', async () => {
        if (markeer?.i === i && performance.now() - markeer.t < 3000) {
          markeer = null;
          const r = await inrichter.haalWeg(gekozen, i);
          zegStand(r.ok ? 'weggehaald' : r.reden, r.ok ? 'info' : 'fout');
        } else { markeer = { i, t: performance.now() }; zegStand('nog eens binnen 3 s = weghalen'); }
        bouwItems();
      });
      items.append(b);
    });
    if (!p.items?.length) items.append(maak('span', 'ir-dim', 'leeg: wijs aan of zoek'));
  }
  function bouwSchermen() {
    const namen = new Set(['hoofd', ...Object.keys(werk.ruw?.schermen ?? {}).filter((s) => s !== 'hoofd'), 'mac-2', 'ipad', 'iphone']);
    schermen.replaceChildren(...[...namen].map((s) => {
      const b = maak('button', 'ir-knop', s === 'hoofd' ? 'werkvak' : s);
      b.title = s === 'hoofd' ? 'het werkvak van de mixer in dit deel' : `scherm ${s} in dit deel (werk.html?s=${s})`;
      b.addEventListener('click', async () => {
        const p = gekozen;
        if (!p) { zegStand('kies of maak eerst een paneel', 'fout'); return; }
        const r = await inrichter.zetOpScherm(p, s);
        zegStand(r.ok ? `paneel ${p} staat op ${s === 'hoofd' ? 'het werkvak' : s} in ${werk.deelDef()?.label ?? werk.deel}` : r.reden, r.ok ? 'info' : 'fout');
      });
      return b;
    }));
    doelen.replaceChildren(...Object.entries(I.DOELEN).map(([id, d]) => {
      const b = maak('button', 'ir-knop', d.naam);
      b.addEventListener('click', async () => {
        const p = gekozen;
        if (!p) { zegStand('kies of maak eerst een paneel', 'fout'); return; }
        const r = await inrichter.wijsToe(p, id);
        zegStand(r.ok ? `${r.regels} knop(pen) van ${d.naam} doen in ${werk.deelDef()?.label ?? werk.deel} nu paneel ${p}${r.overgeslagen?.length ? ` (${r.overgeslagen.length} past niet: ${r.overgeslagen.slice(0, 3).join(', ')})` : ''}` : r.reden, r.ok ? 'info' : 'fout');
      });
      return b;
    }));
  }
  function ververs() {
    titel.textContent = `✎ inrichten · ${werk.naam}${werk.deel ? ` · ${werk.deelDef()?.label ?? werk.deel}` : ''}`;
    bouwKiezer(); bouwItems(); bouwSchermen(); toonZoek();
  }

  async function erbij(action) {
    const p = doelPaneel();
    if (!p) return;
    const focus = resolveTarget('{focus}', ctx.mapping?.vars?.() ?? {});
    const a = I.alsFocus(action, /^\d$/.test(focus) ? focus : null);
    const item = I.itemVoor(a, metaOf(action) ?? metaOf(a.replace('{focus}', focus)));
    if (!item) { zegStand(`${action}: kan niet op een paneel`, 'fout'); return; }
    const r = await inrichter.voegToe(p, item);
    if (r.ok) { gekozen = p; nieuwNaam.value = ''; }
    zegStand(r.ok ? `${item.soort} ${a} staat op paneel ${p}` : r.reden, r.ok ? 'info' : 'fout');
    ververs();
  }

  // Aanwijzen: een klik op het scherm (learn-mode), of de volgende control die iets deed op de APC.
  let wachtOpControl = false;
  aanwijs.addEventListener('click', () => {
    const aan = !aanwijs.classList.contains('aan');
    aanwijs.classList.toggle('aan', aan);
    wachtOpControl = aan;
    if (!aan) { zetAanwijzer(null); zegStand(''); return; }
    zegStand('klik een knop op het scherm of beweeg een control…');
    zetAanwijzer(({ action }) => { wachtOpControl = false; aanwijs.classList.remove('aan'); erbij(action); });
  });
  midi?.on?.('message', (m) => {
    if (!wachtOpControl || !m?.hit?.target || !metaOf(m.hit.target)) return;
    wachtOpControl = false;
    zetAanwijzer(null);
    aanwijs.classList.remove('aan');
    erbij(m.hit.target);
  });

  let alle = null;
  // De bus zonder wat nooit op een paneel hoort (mapjes, log, opnemen, mappings, werkruimtes, alleen-scherm).
  const alleNu = () => (alle ??= list().filter((a) => !a.meta?.alleenScherm && !/^(layer|log|record|mapping|werk)\./.test(a.id)).map((a) => ({ id: a.id, label: a.meta?.label ?? a.id })));
  function toonZoek() {
    const r = I.zoek(zoekEl.value, { alle: alleNu(), top40, max: 40 });
    lijst.replaceChildren(...r.map((x) => {
      const b = maak('button', `ir-vond${x.top ? ' top' : ''}`, `${x.top ? `${x.top}. ` : ''}${x.id}`);
      b.title = `${x.label}${x.aantal ? ` · ${x.aantal}× in de logs` : ''}`;
      b.addEventListener('click', () => erbij(x.id));
      return b;
    }));
  }
  let zoekTimer = null;
  zoekEl.addEventListener('input', () => { clearTimeout(zoekTimer); zoekTimer = setTimeout(toonZoek, 120); });
  paneelKies.addEventListener('change', () => { gekozen = paneelKies.value || null; markeer = null; nieuwNaam.hidden = !!gekozen; bouwItems(); });
  terug.addEventListener('click', async () => { const r = await inrichter.terug(); zegStand(r.ok ? 'terug naar de vorige inrichting' : r.reden, r.ok ? 'info' : 'fout'); ververs(); });
  const open = (aan) => {
    el.hidden = !aan;
    knop.classList.toggle('aan', aan);
    if (!aan) { zetAanwijzer(null); wachtOpControl = false; aanwijs.classList.remove('aan'); return; }
    if (!inrichter.kan) zegStand('kies eerst een werkruimte op de balk (niet "standaard"); een voorbeeld aanpassen maakt er een eigen bestand van', 'fout');
    else zegStand('');
    ververs();
  };
  dicht.addEventListener('click', () => open(false));
  werk.on?.('change', () => { if (!el.hidden) ververs(); });

  // Voor de headless proeven en de console.
  const api = { el, inrichter, open, erbij, zoek: (t) => I.zoek(t, { alle: alleNu(), top40 }), get gekozen() { return gekozen; }, set gekozen(n) { gekozen = n; }, top40: () => top40 };
  Object.assign(window.varveInrichten, api);
  return api;
}
