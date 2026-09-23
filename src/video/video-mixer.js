import { synchroniseer, zichtbaarheid } from './volg.js';
import { VIDEO_FX, MODI } from './instellingen.js';
import { PULS_DOELEN, pulsVorm, klokTrack, metPuls } from './puls.js';
import { FITS, schaalVoor, maatVan } from './passen.js';
import { actieveLagen, lagenUniforms, MAX_BEELDLAGEN } from './lagen.js';

/**
 * De video-mixer: per track een gedempte <video>, samen gemengd op een canvas
 * met WebGL2.
 *
 * De engine weet hier niets van (regel 1). Deze laag LEEST de engine alleen
 * uit, net als de golfvorm: positie, snelheid, fader en crossfader per track.
 * De audio is de baas; elke video volgt (zie volg.js).
 *
 * Mengen: hoe zichtbaar een track is, volgt fader × crossfader — wat je
 * hoort, zie je. Het resultaat is een gewogen gemiddelde, zodat twee tracks
 * op vol niet overbelicht raken, en zwart als er niets te zien is.
 *
 * Zuinig: acht 720p-video's tegelijk decoderen is zwaar. Een track die niet
 * te zien is, wordt gepauzeerd en niet geüpload.
 *
 * Drie stappen per beeld, elk in een eigen shader:
 *   mengen    acht video's -> één beeld, volgens de mengvorm
 *   lagen     ALLEEN als er een beeldlaag aan staat (lagen.js, de
 *             Vormmachines): generatief beeld over het gemengde beeld.
 *             Staat er niets aan, dan slaat hij over en is het beeld
 *             bit voor bit wat het zonder lagen was.
 *   effecten  pixel, spiegel, RGB, kleur, sporen, korrel. Sporen heeft het
 *             VORIGE eindbeeld nodig, dus dit schrijft naar een van twee
 *             buffers die om de beurt wisselen (ping-pong).
 *   tonen     het eindbeeld op het canvas
 */

const MAX = 8;
const ZICHTBAAR = 0.002;
// Vaste renderresolutie, die van de video's zelf. NIET de maat van het
// paneel: dan werd het canvas 1×1 zodra je het paneel sloot, en kreeg het
// losse venster één uitvergrote pixel te zien (een blauw scherm).
export const BREEDTE = 1280, HOOGTE = 720;

const VERTEX = `#version 300 es
in vec2 p;
out vec2 uv;
void main() {
  uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// Acht texturen uitgeschreven: in GLSL ES 3.00 mag je een sampler-array
// alleen met een constante index aanspreken, ook niet met een lusteller.
//
// Elke laag heeft zijn eigen beeldverhouding (passen.js): s[i] schaalt de
// doekcoördinaat naar de beeldcoördinaat, en buiten het beeld is de laag
// doorzichtig (m = 0) — niet zwart, zodat een staande video naast een
// liggende de liggende in zijn randen laat zien.
const MENG = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 kleur;
uniform sampler2D t0, t1, t2, t3, t4, t5, t6, t7;
uniform float w[8];
uniform vec2 s[8];
uniform int modus;
float binnen(vec2 q) { return step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0); }
void main() {
  vec3 l[8];
  float g[8];
  vec2 q;
  q = (uv - 0.5) * s[0] + 0.5; l[0] = texture(t0, q).rgb; g[0] = w[0] * binnen(q);
  q = (uv - 0.5) * s[1] + 0.5; l[1] = texture(t1, q).rgb; g[1] = w[1] * binnen(q);
  q = (uv - 0.5) * s[2] + 0.5; l[2] = texture(t2, q).rgb; g[2] = w[2] * binnen(q);
  q = (uv - 0.5) * s[3] + 0.5; l[3] = texture(t3, q).rgb; g[3] = w[3] * binnen(q);
  q = (uv - 0.5) * s[4] + 0.5; l[4] = texture(t4, q).rgb; g[4] = w[4] * binnen(q);
  q = (uv - 0.5) * s[5] + 0.5; l[5] = texture(t5, q).rgb; g[5] = w[5] * binnen(q);
  q = (uv - 0.5) * s[6] + 0.5; l[6] = texture(t6, q).rgb; g[6] = w[6] * binnen(q);
  q = (uv - 0.5) * s[7] + 0.5; l[7] = texture(t7, q).rgb; g[7] = w[7] * binnen(q);
  vec3 c = vec3(0.0);
  float totaal = 0.0;
  if (modus == 1) {                        // licht (screen)
    vec3 donker = vec3(1.0);
    for (int i = 0; i < 8; i++) donker *= vec3(1.0) - l[i] * g[i];
    c = vec3(1.0) - donker;
  } else if (modus == 3) {                 // verschil
    for (int i = 0; i < 8; i++) if (g[i] > 0.0) c = abs(c - l[i] * g[i]);
  } else {                                 // mix en optellen
    for (int i = 0; i < 8; i++) { c += l[i] * g[i]; totaal += g[i]; }
    // mix: gemiddelde, maar een enkele track op halve fader wordt wél
    // donkerder — delen door minstens 1, niet door het totaal zelf.
    if (modus == 0) c /= max(totaal, 1.0);
  }
  kleur = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const EFFECT = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 kleur;
uniform sampler2D beeld, vorig;
uniform float pixel, spiegel, rgb, verz, sporen, korrel, tijd, flits;
float ruis(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 lees(vec2 p) {
  // spiegel: eerst links-rechts, voorbij de helft ook boven-onder
  vec2 m = vec2(p.x > 0.5 ? 1.0 - p.x : p.x, p.y);
  vec2 mm = vec2(m.x, p.y > 0.5 ? 1.0 - p.y : p.y);
  float a = clamp(spiegel * 2.0, 0.0, 1.0), b = clamp(spiegel * 2.0 - 1.0, 0.0, 1.0);
  vec3 c = mix(texture(beeld, p).rgb, texture(beeld, m).rgb, a);
  return mix(c, texture(beeld, mm).rgb, b);
}
void main() {
  vec2 p = uv;
  if (pixel > 0.001) {                     // blokken: van fijn naar grof
    float rijen = mix(360.0, 9.0, pow(pixel, 0.6));
    vec2 n = vec2(rijen * 16.0 / 9.0, rijen);
    p = (floor(p * n) + 0.5) / n;
  }
  vec3 c;
  if (rgb > 0.001) {                       // kleurkanalen uit elkaar
    vec2 d = vec2(rgb * 0.03, 0.0);
    c = vec3(lees(p + d).r, lees(p).g, lees(p - d).b);
  } else {
    c = lees(p);
  }
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, verz * 2.0);       // 0 = zwart-wit, 0,5 = normaal, 1 = dubbel verzadigd
  c = clamp(c, 0.0, 1.0);
  // Het vorige beeld gloeit na. Let op de y: een beeld dat in een buffer
  // getekend is staat ondersteboven ten opzichte van een video-texture. Bij
  // de gewone weg vallen twee keer omkeren tegen elkaar weg; het vorige
  // EINDbeeld lezen we één keer extra, dus hier moet hij terug.
  c = mix(c, texture(vorig, vec2(uv.x, 1.0 - uv.y)).rgb, sporen * 0.92);
  c += (ruis(uv * 1280.0 + tijd) - 0.5) * korrel * 0.35;
  c += flits * 0.6;                        // lichtflits op de tel
  kleur = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// Twee beeldlagen over het gemengde beeld. Een laag is een canvas dat als
// texture binnenkomt zoals een video (zelfde oriëntatie), passend op het
// doek; buiten zijn beeld telt hij niet mee. De achtergrond van een vorm is
// bijna-zwart (#07090c): die trekken we eraf, anders licht screen/add het hele
// vierkant een tikje op.
const LAGEN = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 kleur;
uniform sampler2D basis, l0, l1;
uniform float a[2];
uniform int m[2];
uniform vec2 s[2];
float binnen(vec2 q) { return step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0); }
vec3 schoon(vec3 l) { return clamp((l - vec3(0.028)) / 0.972, 0.0, 1.0); }
vec3 leg(vec3 c, vec3 l, float d, int vorm) {
  if (vorm == 1) return c + l * d;                  // add
  if (vorm == 2) return mix(c, c * l, d);           // multiply
  return vec3(1.0) - (vec3(1.0) - c) * (vec3(1.0) - l * d);   // screen
}
void main() {
  vec3 c = texture(basis, uv).rgb;
  vec2 q = (uv - 0.5) * s[0] + 0.5;
  if (a[0] > 0.0) c = leg(c, schoon(texture(l0, q).rgb), a[0] * binnen(q), m[0]);
  q = (uv - 0.5) * s[1] + 0.5;
  if (a[1] > 0.0) c = leg(c, schoon(texture(l1, q).rgb), a[1] * binnen(q), m[1]);
  kleur = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const TOON = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 kleur;
uniform sampler2D beeld;
void main() { kleur = vec4(texture(beeld, uv).rgb, 1.0); }`;

export class VideoMixer {
  /**
   * @param canvas   waar het beeld komt
   * @param engine   alleen om uit te lezen: deck(), xfadeGain(), ctx
   * @param decks    deck-id's in volgorde, hooguit acht
   */
  constructor({ canvas, engine, decks }) {
    this.canvas = canvas;
    this.engine = engine;
    this.decks = decks.slice(0, MAX);
    this.lagen = new Map();          // deckId -> { video, url, tex, seekStart, seekDuur, klaar }
    this.fout = null;
    canvas.width = BREEDTE;
    canvas.height = HOOGTE;

    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) { this.fout = 'WebGL2 is niet beschikbaar in deze browser'; return; }
    this.gl = gl;
    this.fx = Object.fromEntries(VIDEO_FX.map((f) => [f.id, f.standaard]));
    this.modus = MODI[0];
    this.puls = 0;                   // hoe hard er op de tel gepulst wordt
    this.pulsDoel = PULS_DOELEN[0];
    this.fit = FITS[0];              // passend: zwarte randen, niets valt weg

    this.beeldlagen = [];             // generatief beeld erover: voegBeeldlaagToe()
    this.meng = this._programma(VERTEX, MENG);
    this.effect = this._programma(VERTEX, EFFECT);
    this.toon = this._programma(VERTEX, TOON);
    this.lagenProg = this._programma(VERTEX, LAGEN);
    this.prog = this.meng && this.effect && this.toon && this.lagenProg;
    if (!this.prog) return;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const prog of [this.meng, this.effect, this.toon, this.lagenProg]) {
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    this.loc = (prog, naam) => gl.getUniformLocation(prog, naam);

    gl.useProgram(this.meng);
    for (let i = 0; i < MAX; i++) gl.uniform1i(this.loc(this.meng, `t${i}`), i);
    gl.useProgram(this.effect);
    gl.uniform1i(this.loc(this.effect, 'beeld'), 0);
    gl.uniform1i(this.loc(this.effect, 'vorig'), 1);
    gl.useProgram(this.toon);
    gl.uniform1i(this.loc(this.toon, 'beeld'), 0);
    gl.useProgram(this.lagenProg);
    gl.uniform1i(this.loc(this.lagenProg, 'basis'), 0);
    for (let i = 0; i < MAX_BEELDLAGEN; i++) gl.uniform1i(this.loc(this.lagenProg, `l${i}`), 1 + i);

    // Eén zwart pixel voor lege plekken: een sampler zonder texture is ongeldig.
    this.zwart = this._texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.gemengd = this._doek();
    this.gelaagd = null;             // pas bij de eerste beeldlaag: zonder lagen geen extra geheugen
    this.laagTex = [];
    this.eind = [this._doek(), this._doek()];
    this.beurt = 0;
  }

  /** Een texture van 1280×720 waar een shader naartoe kan schrijven. */
  _doek() {
    const gl = this.gl;
    const tex = this._texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, BREEDTE, HOOGTE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb };
  }

  /**
   * Een beeldlaag toevoegen: { aan, dekking, mengvorm, frame(t) -> canvas }.
   * Geeft een functie terug die hem weer weghaalt.
   */
  voegBeeldlaagToe(laag) {
    this.beeldlagen.push(laag);
    return () => { this.beeldlagen = this.beeldlagen.filter((l) => l !== laag); };
  }

  zetFx(id, v) { if (id in this.fx) this.fx[id] = Math.max(0, Math.min(1, v)); }
  volgendeModus() { this.modus = MODI[(MODI.indexOf(this.modus) + 1) % MODI.length]; }
  zetPuls(v) { this.puls = Math.max(0, Math.min(1, v)); }
  volgendeFit() { this.fit = FITS[(FITS.indexOf(this.fit) + 1) % FITS.length]; }
  volgendPulsDoel() { this.pulsDoel = PULS_DOELEN[(PULS_DOELEN.indexOf(this.pulsDoel) + 1) % PULS_DOELEN.length]; }

  /**
   * Waar in de tel we nu zijn, als vorm 0..1 — van de track die het hardst
   * klinkt, op het moment dat je hem HOORT. 0 als er geen maat is.
   */
  _pulsNu(vertraging) {
    if (this.puls <= 0) return 0;
    const id = klokTrack(this.decks.map((d) => {
      const deck = this.engine.deck(d);
      return { id: d, speelt: deck.playing, heeftGrid: !!deck.grid,
        zicht: deck.buffer ? zichtbaarheid(deck.ui.fader, this.engine.xfadeGain(d)) : 0 };
    }));
    if (!id) return 0;
    const deck = this.engine.deck(id);
    return pulsVorm(deck.grid.phase(deck.position - vertraging * deck.rate));
  }

  _programma(vs, fs) {
    const gl = this.gl;
    const maak = (type, bron) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, bron);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { this.fout = gl.getShaderInfoLog(s); return null; }
      return s;
    };
    const v = maak(gl.VERTEX_SHADER, vs), f = maak(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { this.fout = gl.getProgramInfoLog(p); return null; }
    return p;
  }

  _texture() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Een video aan een track hangen, of weghalen met null. */
  zetBron(deckId, url) {
    const oud = this.lagen.get(deckId);
    if (oud?.url === url) return;
    if (oud) {
      oud.video.pause();
      oud.video.removeAttribute('src');
      oud.video.load();                      // geeft de decoder echt vrij
      if (this.gl) this.gl.deleteTexture(oud.tex);
      this.lagen.delete(deckId);
    }
    if (!url || !this.gl) return;
    const video = document.createElement('video');
    video.muted = true;                      // het geluid komt uit de engine, nooit hieruit
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    const laag = { video, url, tex: this._texture(), seekStart: 0, seekDuur: 0.15, klaar: false };
    // Hoe lang een seek duurt, om er de volgende keer rekening mee te houden.
    video.addEventListener('seeked', () => {
      if (laag.seekStart) {
        const d = (performance.now() - laag.seekStart) / 1000;
        laag.seekDuur = laag.seekDuur * 0.7 + Math.min(2, d) * 0.3;
        laag.seekStart = 0;
      }
    });
    video.addEventListener('loadeddata', () => { laag.klaar = true; });
    this.lagen.set(deckId, laag);
  }

  /** Wat je hoort loopt de uitgangsvertraging achter op de deckpositie. */
  _vertraging() {
    const ctx = this.engine.ctx;
    return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  }

  /** Eén frame: elke video bijsturen, de zichtbare uploaden, mengen, tekenen. */
  teken() {
    const gl = this.gl;
    if (!gl || !this.prog) return;
    gl.useProgram(this.meng);
    const w = new Float32Array(MAX);
    const schaal = new Float32Array(MAX * 2).fill(1);
    const vertraging = this._vertraging();

    this.decks.forEach((id, i) => {
      const laag = this.lagen.get(id);
      const d = this.engine.deck(id);
      const zicht = laag && d.buffer ? zichtbaarheid(d.ui.fader, this.engine.xfadeGain(id)) : 0;
      gl.activeTexture(gl.TEXTURE0 + i);
      if (!laag || zicht < ZICHTBAAR) {
        if (laag && !laag.video.paused) laag.video.pause();
        gl.bindTexture(gl.TEXTURE_2D, this.zwart);
        return;
      }
      this._volg(laag, d, vertraging);
      gl.bindTexture(gl.TEXTURE_2D, laag.tex);
      if (laag.klaar && laag.video.readyState >= 2) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, laag.video);
        w[i] = zicht;
        const [sx, sy] = schaalVoor(...maatVan(laag.video), this.fit, BREEDTE, HOOGTE);
        schaal[i * 2] = sx; schaal[i * 2 + 1] = sy;
      }
    });

    gl.viewport(0, 0, BREEDTE, HOOGTE);

    // 1. mengen -> gemengd
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gemengd.fb);
    gl.uniform1fv(this.loc(this.meng, 'w'), w);
    gl.uniform2fv(this.loc(this.meng, 's'), schaal);
    gl.uniform1i(this.loc(this.meng, 'modus'), MODI.indexOf(this.modus));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 1b. beeldlagen -> gelaagd (alleen als er een aan staat)
    const bron = this._lagen(vertraging) ?? this.gemengd;

    // 2. effecten -> eind[nu], met eind[vorige] voor de sporen
    const nu = this.eind[this.beurt], vorige = this.eind[1 - this.beurt];
    gl.useProgram(this.effect);
    gl.bindFramebuffer(gl.FRAMEBUFFER, nu.fb);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bron.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, vorige.tex);
    const { fx: f, flits } = metPuls(this.fx, this.pulsDoel, this.puls, this._pulsNu(vertraging));
    gl.uniform1f(this.loc(this.effect, 'flits'), flits);
    gl.uniform1f(this.loc(this.effect, 'pixel'), f.pixel);
    gl.uniform1f(this.loc(this.effect, 'spiegel'), f.spiegel);
    gl.uniform1f(this.loc(this.effect, 'rgb'), f.rgb);
    gl.uniform1f(this.loc(this.effect, 'verz'), f.kleur);
    gl.uniform1f(this.loc(this.effect, 'sporen'), f.sporen);
    gl.uniform1f(this.loc(this.effect, 'korrel'), f.korrel);
    gl.uniform1f(this.loc(this.effect, 'tijd'), (performance.now() / 1000) % 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 3. tonen
    gl.useProgram(this.toon);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, nu.tex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.beurt = 1 - this.beurt;
  }

  /**
   * De beeldlagen over het gemengde beeld leggen. Geeft het doek met het
   * resultaat, of null als er geen laag aan staat (dan blijft alles zoals
   * het was). De tijd is die van de audioklok op wat je HOORT (regel 3).
   */
  _lagen(vertraging) {
    const actief = actieveLagen(this.beeldlagen);
    if (!actief.length) return null;
    const gl = this.gl;
    if (!this.gelaagd) this.gelaagd = this._doek();
    const t = Math.max(0, this.engine.ctx.currentTime - vertraging);
    const maten = [];
    actief.forEach((laag, i) => {
      const beeld = laag.frame(t);
      if (!this.laagTex[i]) this.laagTex[i] = this._texture();
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.laagTex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, beeld);
      maten.push(maatVan(beeld));
    });
    for (let i = actief.length; i < MAX_BEELDLAGEN; i++) {
      gl.activeTexture(gl.TEXTURE1 + i); gl.bindTexture(gl.TEXTURE_2D, this.zwart);
    }
    const { a, m, s } = lagenUniforms(actief, maten, BREEDTE, HOOGTE);
    gl.useProgram(this.lagenProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gelaagd.fb);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.gemengd.tex);
    gl.uniform1fv(this.loc(this.lagenProg, 'a'), a);
    gl.uniform1iv(this.loc(this.lagenProg, 'm'), m);
    gl.uniform2fv(this.loc(this.lagenProg, 's'), s);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.gelaagd;
  }

  _volg(laag, deck, vertraging) {
    const v = laag.video;
    const r = synchroniseer({
      videoTijd: v.currentTime,
      doel: Math.max(0, deck.position - vertraging * deck.rate),
      rate: deck.rate,
      speelt: deck.playing,
      zoekt: v.seeking,
      seekDuur: laag.seekDuur,
    });
    if (r.spring !== null) {
      laag.seekStart = performance.now();
      v.currentTime = Math.min(r.spring, (v.duration || Infinity) - 0.05);
    }
    // Chrome accepteert 0.0625 tot 16; daarbuiten gooit hij.
    const rate = Math.max(0.0625, Math.min(16, r.rate));
    if (Math.abs(v.playbackRate - rate) > 0.001) v.playbackRate = rate;
    if (r.speel && v.paused) v.play().catch(() => {});
    else if (!r.speel && !v.paused) v.pause();
  }

  /** Paneel en los venster dicht: niets meer decoderen. */
  pauzeerAlles() {
    for (const laag of this.lagen.values()) if (!laag.video.paused) laag.video.pause();
  }

  /** Voor het scherm en de tests: wat doet elke laag nu. */
  stand() {
    return this.decks.map((id) => {
      const laag = this.lagen.get(id);
      if (!laag) return { id, video: false };
      const d = this.engine.deck(id);
      return { id, video: true, klaar: laag.klaar, speelt: !laag.video.paused,
        tijd: laag.video.currentTime, verschil: laag.video.currentTime - d.position, seekDuur: laag.seekDuur };
    });
  }
}
