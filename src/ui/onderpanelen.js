import { isTypen } from '../control/keyboard.js';

/*
 * Eén paneel tegelijk onderin: library, rack-editor en MIDI lagen over
 * elkaar, en dan zag je niet welke bovenop lag. Openen sluit de andere;
 * Esc sluit wat er open is.
 *
 * Hier staat ook het openen en sluiten van de library (knop, B). Het
 * MIDI-paneel opent zichzelf in midi-opzet.js, de rack-editor in racks.js;
 * beide roepen `sluitOnderpanelen` aan.
 */
export function opzetOnderpanelen({ library, rackEditor }) {
  const libPaneel = document.getElementById('lib-panel');
  const midiPanel = document.getElementById('midi-panel');

  function sluitOnderpanelen(behalve = null) {
    if (behalve !== 'lib') libPaneel.classList.add('hidden');
    if (behalve !== 'midi') midiPanel.classList.add('hidden');
    if (behalve !== 'rack' && rackEditor.open) rackEditor.sluit();
  }

  const toggleLib = () => {
    if (libPaneel.classList.contains('hidden')) sluitOnderpanelen('lib');
    libPaneel.classList.toggle('hidden');
    if (!libPaneel.classList.contains('hidden')) library.ververs();
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !isTypen(e.target)) { libPaneel.classList.add('hidden'); midiPanel.classList.add('hidden'); }
  });
  document.getElementById('lib-btn').addEventListener('click', toggleLib);
  libPaneel.querySelector('.lib-close').addEventListener('click', toggleLib);
  window.addEventListener('keydown', (e) => {
    // B van bibliotheek. L was ook hotcue 3 rechts: dan deed één toets twee dingen.
    if (e.code === 'KeyB' && !isTypen(e.target)) toggleLib();
  });

  rackEditor.onOpen = () => sluitOnderpanelen('rack');

  return { sluitOnderpanelen, toggleLib };
}
