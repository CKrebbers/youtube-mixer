import { schaalVoor } from './passen.js';

/**
 * Beeldlagen bovenop de gemengde video's: generatief beeld (de Vormmachines,
 * src/vormen/) dat de mixer NA het mengen en VÓÓR de effecten erover legt.
 * Pixel, spiegel, sporen en de puls werken er dus ook op, en opname en het
 * losse venster krijgen hem vanzelf mee (zelfde canvas).
 *
 * De mixer weet niet wat een vorm is. Een beeldlaag is voor hem alleen:
 *   { aan, dekking (0..1), mengvorm, frame(t) -> canvas }
 * met t in seconden van de audioklok, op wat je HOORT. Een laag volgt de maat,
 * niet de positie van een track: "video is slaaf van de positie, beeldlagen
 * zijn slaaf van de maat" (Clay, 24 september 2026).
 *
 * Dit bestand is het rekenwerk, zonder WebGL: welke lagen tellen mee en met
 * welke uniforms. Getest in video.test.mjs.
 */

export const MENGVORMEN = ['screen', 'add', 'multiply'];
export const MAX_BEELDLAGEN = 2;
export const ZICHTBAAR = 0.002;
/**
 * Een beeldlaag VULT het doek (Clay, 24 sep). Sinds ROADMAP 7 is een vormlaag
 * zelf 16:9 (640 × 360, src/vormen/laag.js): op het 16:9-doek is de schaal
 * dan [1, 1], er valt niets weg en er wordt niets extra opgeschaald (alleen
 * de vaste 2× van 640 naar 1280). 'vullen' blijft staan voor een laag met
 * een andere verhouding: die verliest liever een rand dan dat er lege banden
 * komen (een vierkant: boven en onder 22% weg). Los van `video.fit`, want
 * dat is voor de video's.
 */
export const LAAG_FIT = 'vullen';

/** Welke lagen tekenen we: aan, niet doorzichtig, hooguit MAX_BEELDLAGEN. */
export function actieveLagen(lagen) {
  return lagen.filter((l) => l && l.aan && l.dekking >= ZICHTBAAR).slice(0, MAX_BEELDLAGEN);
}

/**
 * De uniforms voor de lagenshader. Een laag VULT het doek (LAAG_FIT: een
 * 16:9-vormlaag past precies, een vierkant zou boven en onder verliezen);
 * buiten zijn beeld telt hij niet mee. Lege plekken krijgen dekking 0.
 *
 * @param maten  per laag [breedte, hoogte] van zijn canvas
 */
export function lagenUniforms(lagen, maten, breedte, hoogte) {
  const a = new Float32Array(MAX_BEELDLAGEN);
  const m = new Int32Array(MAX_BEELDLAGEN);
  const s = new Float32Array(MAX_BEELDLAGEN * 2).fill(1);
  lagen.slice(0, MAX_BEELDLAGEN).forEach((l, i) => {
    a[i] = Math.max(0, Math.min(1, l.dekking));
    m[i] = Math.max(0, MENGVORMEN.indexOf(l.mengvorm));
    const [sx, sy] = schaalVoor(maten[i][0], maten[i][1], LAAG_FIT, breedte, hoogte);
    s[i * 2] = sx; s[i * 2 + 1] = sy;
  });
  return { a, m, s };
}
