/**
 * De AUTO-rij (v1 src/ui/auto-paneel.js, kleiner): aan/uit met de fase, wat er klinkt en hoe
 * lang nog, wat er komt (track, toon, soort overgang, over hoeveel maten) met het waarom als
 * tooltip, en ok · overslaan · langer · nu. Alles via de bus (auto.*), dus ook in het log.
 * Het scherm leest de stand van de automaat en schrijft alleen wat veranderde.
 *
 * Ook hier: `maakLaad`, de laadfunctie die de automaat nodig heeft, gebouwd op de library van de
 * app (laadOp) en de 'laad'-gebeurtenis van de engine.
 */

const tijd = (s) => { if (!Number.isFinite(s)) return '—'; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const FASE = { uit: 'uit', wacht: 'kiest', laden: 'laadt', klaar: 'klaar', bezig: 'mixt', overgenomen: 'jij mixt' };

/**
 * (n, id) => Promise<boolean> voor de automaat: laadt via de library (zoals een klik op een
 * laadknop) en wacht op 'klaar' of 'mislukt' van de engine voor DIT nummer op DEZE track.
 * Weigert de library (onbekend nummer, tweede druk nodig) of laadt er intussen iets anders op
 * die track, dan false.
 */
export function maakLaad({ engine, library }) {
  return (n, id) => new Promise((klaar) => {
    let begon = false, af = false;
    const einde = (r) => { if (af) return; af = true; los(); klaar(r); };
    const los = engine.on('laad', ({ n: m, stand, nummer }) => {
      if (m !== n) return;
      if (stand === 'laadt') { if (nummer?.id === id) begon = true; else if (begon) einde(false); return; }
      if (nummer?.id === id) einde(stand === 'klaar');
    });
    try { library.laadOp(n, id, { bron: 'auto' }); } catch { einde(false); return; }
    if (!begon) einde(false);
  });
}

/**
 * @param automaat de Automaat
 * @param bus      de bus (auto.* is gedefinieerd met definieerAuto)
 * @param paneel   het element waar de rij in komt
 */
export function opzetAutoPaneel({ automaat, bus, paneel }) {
  paneel.classList.add('auto-rij');
  paneel.innerHTML = `
    <button class="auto-aan" data-auto="auto.aan" title="Auto-DJ aan/uit: kiest, laadt en mixt zelf; raak je een track in de overgang aan, dan is hij van jou">AUTO</button>
    <span class="auto-fase"></span>
    <span class="auto-nu" title="Wat nu klinkt en hoe lang nog"></span>
    <span class="auto-pijl">→</span>
    <span class="auto-volgende"></span>
    <span class="auto-knoppen">
      <button data-auto="auto.ok" title="Ok: deze, zo">ok</button>
      <button data-auto="auto.overslaan" title="Deze niet: een andere">overslaan</button>
      <button data-auto="auto.langer" title="Nog 8 maten (beatloos 30 s) langer op wat nu klinkt">langer</button>
      <button data-auto="auto.nu" title="Nu: de eerstvolgende 4 maten (beatloos meteen)">nu</button>
    </span>`;
  const $ = (s) => paneel.querySelector(s);
  const el = { fase: $('.auto-fase'), nu: $('.auto-nu'), volgende: $('.auto-volgende'), pijl: $('.auto-pijl') };
  const knoppen = [...paneel.querySelectorAll('[data-auto]')];
  for (const k of knoppen) k.addEventListener('click', () => bus.doe(k.dataset.auto, true));

  const schrijf = (e, tekst, titel = null) => {
    if (e.textContent !== tekst) e.textContent = tekst;
    if (titel !== null && e.title !== titel) e.title = titel;
  };
  let vorige = '';
  function teken() {
    const s = automaat.stand();
    const sleutel = JSON.stringify(s);
    if (sleutel === vorige) return;
    vorige = sleutel;
    paneel.classList.toggle('aan', s.aan);
    schrijf(el.fase, s.aan ? FASE[s.fase] ?? s.fase : '');
    schrijf(el.nu, s.nu ? `${s.nu.n} · ${s.nu.titel}${s.nu.rest !== null ? ` · nog ${tijd(s.nu.rest)}` : ''}` : (s.aan ? 'niets klinkt' : ''));
    const v = s.volgende;
    el.pijl.hidden = !v;
    if (v) {
      const wanneer = v.voortgang !== null ? `${Math.round(v.voortgang * 100)}%`
        : v.maten !== null ? `over ${v.maten} ${v.maten === 1 ? 'maat' : 'maten'}` : v.over !== null ? `over ${tijd(v.over)}` : '';
      const tekst = [`${v.n} · ${v.titel}`, v.toon, v.soort, wanneer, v.bevestigd ? 'ok' : null].filter(Boolean).join(' · ');
      schrijf(el.volgende, tekst, [...v.redenen, v.waarom].filter(Boolean).join('\n'));
    } else schrijf(el.volgende, '', '');
    for (const k of knoppen) {
      const l = bus.lees(k.dataset.auto);
      k.disabled = l === null;
      k.classList.toggle('aan', l === 1);
    }
  }
  automaat.on('verander', teken);
  const klok = setInterval(teken, 250);   // het aftellen; schrijft alleen wat veranderde
  teken();
  return { teken, vernietig() { clearInterval(klok); automaat.off('verander', teken); } };
}
