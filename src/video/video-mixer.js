import { synchroniseer, zichtbaarheid } from './volg.js';

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
const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 kleur;
uniform sampler2D t0, t1, t2, t3, t4, t5, t6, t7;
uniform float w[8];
void main() {
  vec3 som = texture(t0, uv).rgb * w[0] + texture(t1, uv).rgb * w[1]
           + texture(t2, uv).rgb * w[2] + texture(t3, uv).rgb * w[3]
           + texture(t4, uv).rgb * w[4] + texture(t5, uv).rgb * w[5]
           + texture(t6, uv).rgb * w[6] + texture(t7, uv).rgb * w[7];
  float totaal = w[0] + w[1] + w[2] + w[3] + w[4] + w[5] + w[6] + w[7];
  // Gewogen gemiddelde, maar een enkele track op halve fader wordt wél
  // donkerder: delen door minstens 1, niet door het totaal zelf.
  kleur = vec4(som / max(totaal, 1.0), 1.0);
}`;

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
    this.prog = this._programma(VERTEX, FRAGMENT);
    if (!this.prog) return;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(this.prog);
    this.wLoc = gl.getUniformLocation(this.prog, 'w');
    // Eén zwart pixel voor lege plekken: een sampler zonder texture is ongeldig.
    this.zwart = this._texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    for (let i = 0; i < MAX; i++) gl.uniform1i(gl.getUniformLocation(this.prog, `t${i}`), i);
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
    const w = new Float32Array(MAX);
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
      }
    });

    gl.viewport(0, 0, BREEDTE, HOOGTE);
    gl.uniform1fv(this.wLoc, w);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
