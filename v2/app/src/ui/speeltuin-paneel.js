/**
 * Het speeltuinpaneel (alleen met ?indeling=speeltuin): hetzelfde als de Maschine-schermen, maar dan
 * om op te klikken. Welke knop je net aanraakte, de vier voorstellen, ANDER / LEEG / TERUG / GOED, en
 * een knop om twee nummers te laden en de eerste te starten (anders hoor je niets bij het proberen).
 */
import { FAMILIES } from '../control/speeltuin-kaart.js';

const CSS = `
#speeltuin { position: fixed; right: 12px; bottom: 12px; z-index: 50; width: 380px; max-width: calc(100vw - 24px);
  background: var(--vlak); border: 1px solid var(--lijn); border-radius: 10px; padding: 12px; color: var(--tekst);
  font: 13px var(--f-tekst); box-shadow: 0 8px 30px #0008; }
#speeltuin h3 { margin: 0 0 6px; font-size: 13px; letter-spacing: .08em; color: var(--dim); font-weight: 600; }
#speeltuin .waar { font-size: 16px; margin-bottom: 8px; min-height: 20px; }
#speeltuin .rijtje { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 6px; }
#speeltuin .rijtje button { padding: 8px 4px; border-radius: 6px; border: 1px solid var(--lijn); background: var(--vlak2);
  color: var(--tekst); cursor: pointer; border-top: 3px solid var(--fam, var(--lijn)); line-height: 1.2; }
#speeltuin .rijtje button.aan { background: var(--tekst); color: var(--bg); }
#speeltuin .rijtje small { display: block; color: var(--dim); font-size: 10px; }
#speeltuin .rijtje button.aan small { color: var(--bg); }
#speeltuin .knoppen { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
#speeltuin .knoppen button, #speeltuin .muziek { padding: 6px 4px; border-radius: 6px; border: 1px solid var(--lijn);
  background: transparent; color: var(--dim); cursor: pointer; }
#speeltuin .voet { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; color: var(--dim); }
`;
const KLEUR = { wit: '#e8eaed', groen: '#31c46f', oranje: '#f08a24', blauw: '#4c9bff', geel: '#f5d33d', cyaan: '#3fd0d6', magenta: '#d64fd0' };

export function opzetSpeeltuinPaneel({ ctl, engine, bus, library, wortel }) {
  const tuin = ctl.speeltuin;
  if (!tuin?.aan) return null;
  const stijl = document.createElement('style');
  stijl.textContent = CSS;
  document.head.append(stijl);
  const el = document.createElement('div');
  el.id = 'speeltuin';
  el.innerHTML = `<h3>SPEELTUIN</h3><div class="waar"></div><div class="rijtje"></div>
    <div class="knoppen"><button data-k="ander">ANDER</button><button data-k="leeg">LEEG</button>
    <button data-k="terug">TERUG</button><button data-k="goed">GOED</button></div>
    <div class="voet"><span class="tel"></span><button class="muziek">muziek erin</button></div>`;
  wortel.append(el);
  const waar = el.querySelector('.waar'), rijtje = el.querySelector('.rijtje'), tel = el.querySelector('.tel');
  for (const b of el.querySelectorAll('[data-k]')) b.addEventListener('click', () => tuin.keuzeKnop(b.dataset.k));

  function teken() {
    const s = tuin.stand();
    const h = s.hand;
    tel.textContent = `${(s.tellen.apc ?? 0) + (s.tellen.maschine ?? 0)} knoppen gevuld · Maschine F1–F8 kiezen`;
    if (!h) { waar.textContent = 'raak een knop aan op de APC of de Maschine'; rijtje.replaceChildren(); return; }
    waar.textContent = `${h.app === 'apc' ? 'APC' : 'Maschine'} · ${h.label}${h.shift ? ' + shift' : ''} = ${h.eigen ?? 'leeg'}${h.goed ? ' ✓' : ''}  (rij ${h.rij + 1}/${h.rijen})`;
    rijtje.replaceChildren(...h.rijtje.map((k, j) => {
      const b = document.createElement('button');
      b.className = k.gekozen ? 'aan' : '';
      b.style.setProperty('--fam', KLEUR[FAMILIES[k.fam].kleur]);
      b.innerHTML = `${k.naam}<small>F${j + 1} · ${FAMILIES[k.fam].naam}${k.bezet ? ' · al ergens' : ''}</small>`;
      b.addEventListener('click', () => tuin.keuzeKnop(j));
      return b;
    }));
  }
  tuin.on('verander', teken);
  // Wat bewaard was komt pas na het paneel binnen (app.js laadt de eigen indelingen ná geladen).
  ctl.apc.on('verander', teken);
  ctl.maschine.on('verander', teken);
  teken();

  // Twee nummers op track 1 en 2; de eerste start zodra hij klaar is.
  el.querySelector('.muziek').addEventListener('click', () => {
    const lijst = [...library.nummers.values()].filter((x) => !x.demo);
    const keus = (lijst.length ? lijst : [...library.nummers.values()]).sort(() => Math.random() - 0.5).slice(0, 2);
    if (!keus.length) { engine.meld('de library is leeg', 'fout', 'speeltuin'); return; }
    const los = engine.on('laad', ({ n, stand }) => {
      if (n !== 1 || stand !== 'klaar') return;
      los();
      if (!engine.track(1).speelt) { bus.doe('track.1.play', true, { bron: 'scherm' }); bus.doe('track.1.play', false, { bron: 'scherm' }); }
    });
    keus.forEach((x, i) => library.laadOp(i + 1, x.id));
  });
  return { teken };
}
