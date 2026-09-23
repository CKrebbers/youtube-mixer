import { mmss, mb } from './dom.js';
import { Opnemer } from '../opname/opnemer.js';
import { meld } from './meldingen.js';

/**
 * De opnameknop en de keuze audio/video ernaast.
 *
 * Wat uit de master komt, naar opnames/ op deze schijf. De lengte komt van
 * de audioklok (de worklet telt frames), niet van een timer. Dezelfde
 * start/stop staat ook op de bus (bindApp), voor de APC.
 */
export function opzetOpname({ engine, videoMixer }) {
  const opnemer = new Opnemer({ engine });
  opnemer.onFout = (f) => meld(`opname: ${f}`, 'fout', 8000);
  // app.js zet window.opnemer; het videopaneel leest die om te weten of het
  // tijdens een video-opname moet doorrenderen.

  // De tab sluiten of herladen tijdens een opname: eerst vragen. De audio staat
  // grotendeels veilig op schijf, maar de laatste seconde en de video niet.
  window.addEventListener('beforeunload', (e) => { if (opnemer.bezig) { e.preventDefault(); e.returnValue = ''; } });
  const opnameKnop = document.getElementById('opname-btn');
  const opnameSoort = document.getElementById('opname-soort');
  // Je laatste keuze onthouden: gemak per browser, geen gegevens die ertoe doen.
  try { opnameSoort.value = localStorage.getItem('varve.opnameSoort') || 'audio'; } catch (_) {}
  opnameSoort.addEventListener('change', () => { try { localStorage.setItem('varve.opnameSoort', opnameSoort.value); } catch (_) {} });
  opnameKnop.addEventListener('click', async () => {
    opnameKnop.classList.remove('gelukt', 'mislukt');
    if (!opnemer.bezig) {
      await engine.resume().catch(() => {});
      const r = await opnemer.start({ video: opnameSoort.value === 'video' ? videoMixer.canvas : null });
      if (!r.ok) { opnameKnop.textContent = 'opnemen mislukt'; opnameKnop.classList.add('mislukt'); opnameKnop.title = r.fout; }
      return;
    }
    // Stoppen vraagt een tweede klik binnen 3 s: één misklik mag een set niet afbreken.
    if (!opnameKnop.dataset.zeker) {
      opnameKnop.dataset.zeker = '1';
      opnameKnop.textContent = 'nog eens = stoppen';
      setTimeout(() => { delete opnameKnop.dataset.zeker; }, 3000);
      return;
    }
    delete opnameKnop.dataset.zeker;
    opnameKnop.textContent = 'afronden…';
    const r = await opnemer.stop();
    // Iets kwijt (stilte), of te lang voor een gewone WAV: niet alleen in een tooltip.
    if (r.ok && r.waarschuwing) meld(`opname bewaard, let op: ${r.waarschuwing}`, 'fout', 12000);
    opnameKnop.classList.add(r.ok ? 'gelukt' : 'mislukt');
    opnameKnop.textContent = r.ok ? `✓ ${mmss(r.duur)} bewaard` : 'afronden mislukt';
    opnameKnop.title = r.ok
      ? `opnames/${r.bestand}${r.video ? ` en opnames/${r.video} (${mb(r.videoBytes)})` : ''}${r.waarschuwing ? ' — let op: ' + r.waarschuwing : ''}`
      : r.fout;
    setTimeout(() => { if (!opnemer.bezig) { opnameKnop.textContent = '● opnemen'; opnameKnop.classList.remove('gelukt'); } }, 6000);
  });

  /** Eén frame: teller op de knop zolang er opgenomen wordt. */
  const teken = () => {
    if (opnemer.bezig && !opnameKnop.dataset.zeker) {
      const t = `■ ${mmss(opnemer.seconden)} · ${mb(opnemer.bytes)}${opnemer.metVideo ? ` + ${mb(opnemer.videoBytes)} video` : ''}`;
      if (opnameKnop.textContent !== t) opnameKnop.textContent = t;
      opnameKnop.classList.add('bezig');
      opnameSoort.disabled = true;
      opnameKnop.title = opnemer.fout || `opnemen naar opnames/${opnemer.bestand} — klik om te stoppen`;
    } else { opnameKnop.classList.remove('bezig'); opnameSoort.disabled = false; }
  };

  // Wat de bus (bindApp) aanroept: zonder tweede klik, met een melding.
  const opnameStart = async () => {
    const r = await opnemer.start({ video: opnameSoort.value === 'video' ? videoMixer.canvas : null });
    if (!r.ok) meld(`opnemen: ${r.fout}`, 'fout');
  };
  const opnameStop = async () => {
    const r = await opnemer.stop();
    if (!r.ok) return meld(`afronden mislukt: ${r.fout}`, 'fout');
    if (r.waarschuwing) meld(`opname bewaard: opnames/${r.bestand} — let op: ${r.waarschuwing}`, 'fout', 12000);
    else meld(`opname bewaard: opnames/${r.bestand}`, 'info');
  };
  const wisselSoort = () => { opnameSoort.value = opnameSoort.value === 'video' ? 'audio' : 'video'; opnameSoort.dispatchEvent(new Event('change')); };

  return { opnemer, teken, opnameStart, opnameStop, wisselSoort };
}
