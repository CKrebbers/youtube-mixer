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
 * Waar de hub mag staan zonder extra vlag: deze machine, het privé-LAN en de
 * eigen tailnet (Tailscale, docs/TAILSCALE.md). Een hub mag mixer.master,
 * crossfader en beeld zetten en met focus APC-invoer geven: een link naar een
 * vreemde host doet dat niet stilletjes.
 */
export function isLokaleHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h.endsWith('.local') || h.endsWith('.ts.net')) return true;
  const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * De vlag voor de AV-app-hub (?hub=ws://localhost:7700/app): de APC komt dan
 * van de hub (src/control/hub.js), niet van Web MIDI. Niet onthouden: zonder
 * de vlag in de adresbalk is het gewoon VARVE, en wordt hub.js niet geladen.
 * Een hub buiten deze machine/het LAN/de tailnet alleen met &hub_extern=1
 * (app.js meldt het als hij daarom geweigerd is: hubGeweigerd).
 */
export function hubAdres(url = location.href) {
  const q = new URL(url).searchParams;
  const v = q.get('hub');
  if (!v || !/^wss?:\/\//.test(v)) return null;
  let host;
  try { host = new URL(v).hostname; } catch (_) { return null; }
  return isLokaleHost(host) || q.get('hub_extern') === '1' ? v : null;
}

/** Het ?hub=-adres als het er wel staat maar hubAdres() het weigert (niet lokaal), anders null. */
export function hubGeweigerd(url = location.href) {
  const v = new URL(url).searchParams.get('hub');
  return v && !hubAdres(url) ? v : null;
}
