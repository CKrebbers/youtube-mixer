// Herkomst: v1 youtube-mixer/src/video/lagen.js @ 039b372. Anders in v2: `lagenUniforms` schrijft
// in vaste buffers (oogst beeld-077: geen nieuwe typed arrays per beeld) en `actieveLagen` in een lijst.
import { schaalVoor } from './passen.js';

/**
 * Beeldlagen bovenop de gemengde video's: generatief beeld (de Vormmachines,
 * src/beeld/vormen/) dat de mixer NA het mengen en VÓÓR de effecten erover legt
 * (oogst beeld-041). Pixel, spiegel, sporen en de puls werken er dus ook op, en
 * opname en het losse venster krijgen hem vanzelf mee (zelfde canvas).
 *
 * De mixer weet niet wat een vorm is. Een beeldlaag is voor hem alleen:
 *   { aan, dekking (0..1), mengvorm, frame(t) -> canvas of ImageBitmap }
 * met t in seconden van de audioklok, op wat je HOORT. Een laag volgt de maat,
 * niet de plek van een track: "video is slaaf van de positie, beeldlagen zijn
 * slaaf van de maat" (Clay, 24 september 2026).
 *
 * Dit bestand is het rekenwerk, zonder WebGL: welke lagen tellen mee en met
 * welke uniforms.
 */

export const MENGVORMEN = ['screen', 'add', 'multiply'];
export const MAX_BEELDLAGEN = 2;
export const ZICHTBAAR = 0.002;
/**
 * Een beeldlaag VULT het doek (Clay, 24 sep). Een vormlaag is zelf 16:9
 * (640 × 360): op het 16:9-doek is de schaal dan [1, 1]. 'vullen' blijft staan
 * voor een laag met een andere verhouding. Los van `video.fit` (de video's).
 */
export const LAAG_FIT = 'vullen';

/** Welke lagen tekenen we: aan, niet doorzichtig, hooguit MAX_BEELDLAGEN. Schrijft in `uit`. */
export function actieveLagen(lagen, uit = []) {
  uit.length = 0;
  for (const l of lagen) {
    if (uit.length >= MAX_BEELDLAGEN) break;
    if (l && l.aan && l.dekking >= ZICHTBAAR) uit.push(l);
  }
  return uit;
}

/** Vaste buffers voor lagenUniforms (één set per mixer). */
export const maakLagenBuffers = () => ({
  a: new Float32Array(MAX_BEELDLAGEN),
  m: new Int32Array(MAX_BEELDLAGEN),
  s: new Float32Array(MAX_BEELDLAGEN * 2),
});

/**
 * De uniforms voor de lagenshader. Een laag VULT het doek; buiten zijn beeld
 * telt hij niet mee. Lege plekken krijgen dekking 0.
 *
 * @param maten  per laag [breedte, hoogte] van zijn beeld
 * @param uit    buffers van maakLagenBuffers() (zonder: nieuwe)
 */
export function lagenUniforms(lagen, maten, breedte, hoogte, uit = maakLagenBuffers()) {
  const { a, m, s } = uit;
  a.fill(0); m.fill(0); s.fill(1);
  const n = Math.min(lagen.length, MAX_BEELDLAGEN);
  for (let i = 0; i < n; i++) {
    const l = lagen[i];
    a[i] = Math.max(0, Math.min(1, l.dekking));
    m[i] = Math.max(0, MENGVORMEN.indexOf(l.mengvorm));
    const [sx, sy] = schaalVoor(maten[i][0], maten[i][1], LAAG_FIT, breedte, hoogte);
    s[i * 2] = sx; s[i * 2 + 1] = sy;
  }
  return uit;
}
