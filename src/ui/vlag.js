/**
 * De vlag voor de vormlagen (?vormen=1), los van vorm-paneel.js: app.js leest
 * hem bij het opstarten en haalt het paneel (en daarmee alle vormen) alleen
 * op als hij aan staat. Zonder vlag komt er geen byte van de vormen binnen.
 */

const SLEUTEL = 'varve.vormen';

export function vormenAan(url = location.href) {
  const v = new URL(url).searchParams.get('vormen');
  try {
    if (v === '1') localStorage.setItem(SLEUTEL, '1');
    if (v === '0') localStorage.removeItem(SLEUTEL);
    return localStorage.getItem(SLEUTEL) === '1';
  } catch (_) {
    return v === '1';
  }
}

/**
 * De vlag voor de AV-app-hub (?hub=ws://localhost:7700/app): de APC komt dan
 * van de hub (src/control/hub.js), niet van Web MIDI. Niet onthouden: zonder
 * de vlag in de adresbalk is het gewoon VARVE, en wordt hub.js niet geladen.
 */
export function hubAdres(url = location.href) {
  const v = new URL(url).searchParams.get('hub');
  return v && /^wss?:\/\//.test(v) ? v : null;
}
