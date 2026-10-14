import { hexVan, tekstOp, kleurVanDeel } from '../werk/kleuren.js';

/**
 * De werk-balk (werkruimte S3, docs/WERKRUIMTE.md A5, docs/werkruimte/S3.md) in #werk-balk,
 * direct onder de bovenbalk: de delen als tabs in hun kleur, wie het koos ("F3 · Maschine"),
 * "⚠ N nieuw", THUIS, de werkruimte kiezen (alleen hier: nooit van een controller, A9),
 * "leg vast in <deel>", en een plek voor knoppen van andere sporen (voegKnopToe).
 *
 * Alleen zichtbaar met een werkruimte die delen heeft; met `standaard` blijft hij `hidden` en
 * kost hij niets (geen ruimte, geen opmaak). Kiezen zonder werk-balk: `?werk=<naam>` in het
 * adres (onthouden), of een stand in de Controlekamer.
 *
 * Opbouwen alleen als de WERKRUIMTE verandert (zelden); een deelwissel zet alleen klassen en
 * een tekst, in het volgende beeld (`plan`), nooit in het MIDI-bericht. Geen opmaak lezen.
 */
const wachtend = [];        // knoppen van andere sporen die er vóór de opzet al waren
let slotEl = null;

/** Een knop (of ander element) van een ander spoor op de werk-balk, rechts. */
export function voegKnopToe(el) {
  if (!el) return;
  if (slotEl) slotEl.append(el); else wachtend.push(el);
}

/**
 * @param el       #werk-balk
 * @param werk     de Werkruimte
 * @param invoke   de bus (werk.deel.*, werk.thuis, werk.vastleggen, werk.kies)
 * @param lijst    async () => [{ naam, titel, bron }] (GET /api/werkruimtes)
 * @param namen    (lijst) => void: de volgorde van werk.kies bijwerken
 * @param plan     (fn) => void: in het volgende beeld
 */
export function opzetWerkBalk({ el, werk, invoke, lijst = async () => [], namen = () => {}, plan = (fn) => requestAnimationFrame(fn) }) {
  if (!el) return null;
  el.classList.add('werk-balk');
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'werkruimte');

  const maak = (tag, klasse, tekst) => { const x = document.createElement(tag); if (klasse) x.className = klasse; if (tekst !== undefined) x.textContent = tekst; return x; };
  const kiezer = maak('select', 'werk-kies');
  kiezer.title = 'werkruimte kiezen (alleen hier, nooit van een controller)';
  const tabs = maak('div', 'werk-tabs');
  const door = maak('span', 'werk-door');
  const nieuw = maak('button', 'werk-nieuw ghost');
  nieuw.hidden = true;
  const letOp = maak('span', 'werk-letop', 'ⓘ');
  letOp.hidden = true;
  const thuis = maak('button', 'werk-thuis ghost', 'THUIS');
  thuis.title = 'THUIS (⇧ + master-knop): deel = start, de standaardmapjes, gluren los. Klank en faders blijven staan.';
  const vast = maak('button', 'werk-vast ghost', 'leg vast');
  const terug = maak('button', 'werk-terug ghost');
  terug.hidden = true;
  slotEl = maak('span', 'werk-slot');
  for (const x of wachtend.splice(0)) slotEl.append(x);
  el.replaceChildren(kiezer, tabs, door, nieuw, letOp, maak('span', 'werk-vul'), slotEl, terug, vast, thuis);

  let tabEls = new Map();      // deel -> knop
  let gebouwdVoor = null;      // sleutel van de werkruimte waarvoor de tabs er staan
  let namenLijst = [];

  const druk = (id) => { invoke(id, true); invoke(id, false); };
  thuis.addEventListener('click', () => druk('werk.thuis'));
  vast.addEventListener('click', () => {
    druk('werk.vastleggen');
    vast.classList.add('vraag');
    clearTimeout(vast._t);
    vast._t = setTimeout(() => vast.classList.remove('vraag'), 3000);
  });
  terug.addEventListener('click', () => werk.terugNaarKeuze());
  nieuw.addEventListener('click', () => werk.gezien());
  kiezer.addEventListener('change', () => {
    const i = namenLijst.indexOf(kiezer.value);
    if (i >= 0) invoke('werk.kies', namenLijst.length > 1 ? i / (namenLijst.length - 1) : 0);
  });
  kiezer.addEventListener('focus', () => { ververs(); });

  /** De lijst van werkruimtes opnieuw (bij openklikken van de kiezer en bij een wissel). */
  async function ververs() {
    let l = [];
    try { l = await lijst(); } catch (_) { l = []; }
    if (!l.some((x) => x.naam === werk.naam)) l = [...l, { naam: werk.naam, titel: werk.def.titel }];
    namenLijst = l.map((x) => x.naam);
    namen(namenLijst);
    // Een voorbeeld uit git (tools/werkruimtes/voorbeelden/) staat er als voorbeeld bij: Clay's eigen
    // indeling is wat hij zelf maakt; past hij een voorbeeld aan, dan wordt het een eigen bestand.
    const opties = l.map((x) => {
      const tekst = x.titel && x.titel !== x.naam ? `${x.naam} · ${x.titel}` : x.naam;
      const o = maak('option', '', x.bron === 'voorbeeld' && x.naam !== 'standaard' ? `${tekst} (voorbeeld)` : tekst);
      o.value = x.naam; return o;
    });
    kiezer.replaceChildren(...opties);
    kiezer.value = werk.naam;
  }

  function bouwTabs(s) {
    tabEls = new Map();
    const knoppen = s.delen.map((d) => {
      const b = maak('button', 'werk-tab', d.label);
      const kleur = kleurVanDeel(d.naam, d);
      b.style.setProperty('--k', hexVan(kleur));
      b.style.setProperty('--k-tekst', tekstOp(kleur));
      b.title = `${d.label} (F${d.nr}${d.nr === 1 ? ', ook THUIS' : ''}): zet de mapjes, panelen en rijen van dit deel open, nooit een klank`;
      b.addEventListener('click', () => druk(`werk.deel.${d.naam}`));
      tabEls.set(d.naam, b);
      return b;
    });
    tabs.replaceChildren(...knoppen);
  }

  function teken() {
    const s = werk.stand();
    el.hidden = !s.delen.length;
    if (el.hidden) return;
    const sleutel = `${s.naam}|${s.versie}|${s.delen.map((d) => `${d.naam}:${d.label}:${d.kleur}`).join(',')}`;
    if (sleutel !== gebouwdVoor) { gebouwdVoor = sleutel; bouwTabs(s); ververs(); }
    for (const [naam, b] of tabEls) {
      const aan = naam === s.deel;
      b.classList.toggle('aan', aan);
      b.setAttribute('aria-pressed', aan ? 'true' : 'false');
    }
    door.textContent = s.door && s.deel ? (s.door === 'start' ? 'start' : s.door) : '';
    nieuw.hidden = !s.nieuw;
    nieuw.textContent = `⚠ ${s.nieuw} nieuw`;
    nieuw.title = `${s.nieuw} plekken doen iets anders dan de vorige keer dat je op "gezien" klikte (hooguit 12 per proefavond is het advies). Klik = gezien.`
      + (werk.nieuw.sleutels.length ? `\n${werk.nieuw.sleutels.slice(0, 16).join('\n')}${werk.nieuw.sleutels.length > 16 ? '\n…' : ''}` : '');
    nieuw.classList.toggle('te-veel', s.nieuw > 12);
    letOp.hidden = !s.waarschuwingen;
    letOp.title = werk.waarschuwingen.slice(0, 12).join('\n') + (werk.waarschuwingen.length > 12 ? '\n…' : '');
    const label = s.deel ? werk.deelDef(s.deel)?.label : null;
    vast.textContent = label ? `leg vast in ${label}` : 'leg vast';
    vast.disabled = !label;
    terug.hidden = !s.terug?.mag;
    terug.textContent = s.terug ? `↺ ${s.terug.naam}` : '';
    terug.title = s.terug ? `alles is er weer voor ${s.terug.naam}: terug (VARVE doet het niet vanzelf)` : '';
    if (kiezer.value !== s.naam && namenLijst.includes(s.naam)) kiezer.value = s.naam;
  }

  let gepland = false;
  const later = () => { if (gepland) return; gepland = true; plan(() => { gepland = false; teken(); }); };
  werk.on('change', later);
  teken();
  return { teken, ververs, voegKnopToe };
}
