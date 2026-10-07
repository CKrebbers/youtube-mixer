/**
 * Het spoor "beeld" (docs/BEELD.md) op het scherm, puur: geen DOM, dus
 * test/controle.test.mjs rekent het na. De BEELD-rij en het lampje op de knop
 * (beeld-paneel.js) en de tegel "Beeld" van de Controlekamer (controle.js)
 * lezen allebei hier hoe de stand heet.
 */

/**
 * De statusregel van de BEELD-rij en het lampje op de knop "beeld".
 * @param s          status() van de BeeldKoppeling (src/koppel/beeld.js)
 * @param geweigerd  de reden waarom het adres in het veld geweigerd werd, of null
 * @returns { tekst, soort, lamp }
 *   soort  uit | geen | fout | zoekt | half | ok (de kleur van de regel)
 *   lamp   null (beeld staat uit: de knop ziet eruit als altijd) | geen (ook: een ander tabblad stuurt) | fout | zoekt | verbonden | volgt
 */
export function beeldStand(s, geweigerd = null) {
  if (geweigerd) return { tekst: `adres geweigerd: ${geweigerd}`, soort: 'fout', lamp: s?.aan ? 'fout' : null };
  if (!s?.aan) return { tekst: 'uit', soort: 'uit', lamp: null };
  if (s.elders) return { tekst: 'aan, maar een ander VARVE-tabblad heeft de APC: dat stuurt het beeld', soort: 'geen', lamp: 'geen' };
  if (s.fout) return { tekst: `loopt niet: ${s.fout}`, soort: 'fout', lamp: 'fout' };
  if (!s.adres) return { tekst: 'geen adres', soort: 'geen', lamp: 'geen' };
  if (!s.verbonden) return { tekst: `zoekt de relay op ${s.adres}`, soort: 'zoekt', lamp: 'zoekt' };
  if (!s.beeld) return { tekst: 'verbonden, wacht op de Stroommachine', soort: 'half', lamp: 'verbonden' };
  const b = s.beeld;
  const tekst = ['verbonden', b.regime, b.scene, b.volgt ? 'volgt de klok' : 'eigen klok'].filter(Boolean).join(' · ');
  return { tekst, soort: 'ok', lamp: b.volgt ? 'volgt' : 'verbonden' };
}

/**
 * Wat de mixer over beeld aan de Controlekamer meldt (status-zender.js):
 * { aan, loopt, verbonden, regime, scene, volgt }, met regime, scène en volgt
 * null zolang er geen verse beeld-status van de Stroommachine is.
 * @param s  status() van de BeeldKoppeling, of null
 */
export function beeldBericht(s) {
  if (!s) return null;
  const b = s.beeld ?? null;
  return { aan: !!s.aan, loopt: !!s.loopt, verbonden: !!s.verbonden,
    regime: b ? String(b.regime ?? '') : null, scene: b ? String(b.scene ?? '') : null, volgt: b ? !!b.volgt : null };
}

/**
 * De tegel "Beeld" van de Controlekamer, uit beeldBericht(). Beeld mag
 * ontbreken (MacBook + APC is genoeg): uit is dus grijs, geen fout.
 * @returns { naam, licht: 'ok'|'half'|'uit', waarde, sub }
 */
export function beeldTegel(b) {
  const naam = 'Beeld';
  if (!b) return { naam, licht: 'uit', waarde: '—', sub: '' };
  if (!b.aan) return { naam, licht: 'uit', waarde: 'uit', sub: 'de Stroommachine op de pc (mag ontbreken)' };
  if (b.loopt === false) return { naam, licht: 'half', waarde: 'geen adres', sub: 'vul het relay-adres in de BEELD-rij in' };
  if (!b.verbonden) return { naam, licht: 'half', waarde: 'zoekt de relay', sub: 'draait de relay op de pc?' };
  if (typeof b.volgt !== 'boolean') return { naam, licht: 'half', waarde: 'relay verbonden', sub: 'wacht op de Stroommachine' };
  return { naam, licht: 'ok', waarde: b.volgt ? 'volgt de klok' : 'eigen klok',
    sub: [b.regime, b.scene].filter(Boolean).join(' · ') };
}
