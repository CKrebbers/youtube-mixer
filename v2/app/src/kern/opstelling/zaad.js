/**
 * Toeval uit een zaad: herhaalbaar, en per domein een eigen stroom (elektronlearn `roll`, Strata
 * `P(seed, 'harmony')`, Uurwerk `rngAt(tag)`). Hetzelfde zaad + dezelfde tags = dezelfde getallen,
 * dus een opstelling (recept + zaad) is altijd terug te halen; een ander zaad = iets nieuws.
 * Geen Math.random (regels.test): wie een nieuw zaad wil, geeft er een (ui/ telt ze op).
 */

/** FNV-1a over een tekst -> 32 bit zonder teken. */
export function hash(tekst) {
  let h = 0x811c9dc5;
  const s = String(tekst);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32: klein, snel en goed genoeg voor muziek (Stroommachine 09b-regie, Uurwerk). */
export function mulberry32(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Een stroom voor (zaad, tag, …): `r()` 0..1, `tussen(a, b)`, `geheel(a, b)` (beide ingesloten),
 * `kies(lijst)`, `kans(p)`, `schud(lijst)` (een kopie), `rond(v, breedte)` (v ± breedte, geklemd 0..1).
 */
export function stroom(zaad, ...tags) {
  const r = mulberry32(hash([zaad >>> 0, ...tags].join('|')));
  const tussen = (a, b) => a + (b - a) * r();
  return {
    r,
    tussen,
    geheel: (a, b) => Math.floor(tussen(a, b + 1 - 1e-9)),
    kies: (lijst) => (lijst?.length ? lijst[Math.floor(r() * lijst.length)] : null),
    kans: (p) => r() < p,
    schud: (lijst) => { const l = [...lijst]; for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; },
    rond: (v, breedte) => Math.min(1, Math.max(0, v + (r() * 2 - 1) * breedte)),
  };
}

/** Een volgend zaad uit het vorige (herrollen zonder klok of toeval van buiten). */
export const volgendZaad = (zaad, stap = 1) => hash(`volgend|${zaad >>> 0}|${stap}`) % 1000000;
