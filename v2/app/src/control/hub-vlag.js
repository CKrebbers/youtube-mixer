/**
 * De vlag voor de AV-app-hub: `?hub=ws://localhost:7700/app` in de adresbalk. Puur
 * rekenwerk op de querystring (de ui geeft `location.search` mee; hier geen location).
 * Bewust een eigen bestand: wie alleen wil weten OF er een hub is, laadt hub.js niet
 * (zonder vlag komt er geen byte van hub.js binnen).
 *
 * De adresregel komt uit v1 (src/ui/vlag.js): zonder extra vlag alleen deze machine,
 * het privé-LAN (10/8, 172.16/12, 192.168/16) en de eigen tailnet (100.64/10, *.ts.net,
 * *.local). Een hub mag de master, de crossfader en het beeld zetten en met focus
 * APC-invoer geven: een link naar een vreemde host doet dat niet stilletjes. Een andere
 * host alleen met `&hub_extern=1`; anders meldt de ui het (hubGeweigerd) en blijft het
 * gewoon Web MIDI. De vlag wordt niet onthouden: zonder ?hub= is het gewoon VarveDJ.
 */

/** Deze machine, het privé-LAN of de tailnet? (hostname zonder poort; IPv6 mag tussen haken) */
export function isLokaleHost(host) {
  const h = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h.endsWith('.local') || h.endsWith('.ts.net')) return true;
  const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

const params = (zoek) => (zoek instanceof URLSearchParams ? zoek : new URLSearchParams(String(zoek ?? '')));

/**
 * Het adres van de hub uit de querystring, of null: zonder ?hub=, met iets anders dan
 * ws:// of wss://, of een host buiten deze machine/het LAN/de tailnet zonder &hub_extern=1.
 * @param zoek  `location.search` ('?hub=…'), of URLSearchParams
 */
export function hubAdres(zoek) {
  const q = params(zoek);
  const v = q.get('hub');
  if (!v || !/^wss?:\/\//i.test(v)) return null;
  let host;
  try { host = new URL(v).hostname; } catch (_) { return null; }
  return isLokaleHost(host) || q.get('hub_extern') === '1' ? v : null;
}

/** Het ?hub=-adres als het er wel staat maar hubAdres() het weigert, anders null (voor de melding). */
export function hubGeweigerd(zoek) {
  const v = params(zoek).get('hub');
  return v && !hubAdres(zoek) ? v : null;
}
