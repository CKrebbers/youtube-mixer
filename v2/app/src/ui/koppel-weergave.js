// Herkomst: v1 youtube-mixer/src/ui/beeld-weergave.js (beeldStand), voor v2 hernoemd (koppelStand): in v2
// heet het video-deel "beeld", de Stroommachine is de koppeling. Puur: geen DOM (test/koppel-paneel.test.mjs).

/**
 * De statusregel van de koppeling en de kleur ervan.
 * @param s          status() van de BeeldKoppeling (src/koppel/beeld.js)
 * @param geweigerd  waarom het adres in het veld geweigerd werd, of null
 * @returns { tekst, soort } — soort: uit | geen | fout | zoekt | half | ok
 */
export function koppelStand(s, geweigerd = null) {
  if (geweigerd) return { tekst: `adres geweigerd: ${geweigerd}`, soort: 'fout' };
  if (!s?.aan) return { tekst: 'uit', soort: 'uit' };
  if (s.elders) return { tekst: 'aan, maar een ander VarveDJ-tabblad heeft de APC: dat stuurt het beeld', soort: 'geen' };
  if (s.fout) return { tekst: `loopt niet: ${s.fout}`, soort: 'fout' };
  if (!s.adres) return { tekst: 'geen adres', soort: 'geen' };
  if (!s.verbonden) return { tekst: `zoekt de relay op ${s.adres}`, soort: 'zoekt' };
  if (!s.beeld) return { tekst: 'verbonden, wacht op de Stroommachine', soort: 'half' };
  const b = s.beeld;
  return { tekst: ['verbonden', b.regime, b.scene, b.volgt ? 'volgt de klok' : 'eigen klok'].filter(Boolean).join(' · '), soort: 'ok' };
}

/** De tooltip van de statusregel: fps, tempo en of ze de klok volgt. */
export function koppelTitel(s, stand) {
  const b = s?.beeld;
  if (!b) return stand.tekst;
  const bpm = b.bpm ? `${String(Math.round(b.bpm * 10) / 10).replace('.', ',')} bpm` : 'geen tempo';
  return `de Stroommachine: ${Math.round(b.fps)} fps, ${bpm}, ${b.volgt ? 'volgt de klok van VarveDJ' : 'op haar eigen klok (er speelt niets, of ze volgt niet)'}`;
}

/** De kleur van de statusregel per soort (tokens van styles.css). */
export const KLEUR = Object.freeze({ uit: 'var(--dim)', geen: 'var(--dim)', fout: 'var(--kill)', zoekt: 'var(--cue)', half: 'var(--cue)', ok: 'var(--tekst)' });
