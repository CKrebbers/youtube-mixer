// Nep-onderdelen voor de beeldtests (geen test zelf): WebGL2, <video>, een 2D-canvas en een engine.
// Zo streng als het moet om iets te zien: elke upload en elke uniform wordt opgeschreven.

/** Een nep-WebGL2-context: elke aanroep bestaat, uploads en uniforms worden bijgehouden. */
export function nepGL() {
  const log = { uploads: [], uniform: new Map(), draws: 0, programma: null, framebuffer: null, actief: 0 };
  let id = 0;
  const zet = (loc, v) => { log.uniform.set(loc.naam, v); log.uniform.set(`${loc.naam}@${loc.p.id}`, v); };
  const gl = {
    log,
    createShader: () => ({ id: ++id }), shaderSource() {}, compileShader() {},
    getShaderParameter: () => true, getShaderInfoLog: () => '',
    createProgram: () => ({ id: ++id }), attachShader() {}, linkProgram() {},
    getProgramParameter: () => true, getProgramInfoLog: () => '',
    useProgram(p) { log.programma = p; },
    getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {},
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {},
    getUniformLocation: (p, naam) => ({ p, naam }),
    // Per naam (de laatste die hem zette) en per programma (`naam@id`): TOON en EFFECT hebben allebei een 'flits'.
    uniform1i(loc, v) { zet(loc, v); },
    uniform1f(loc, v) { zet(loc, v); },
    uniform1fv(loc, v) { zet(loc, Array.from(v)); },
    uniform1iv(loc, v) { zet(loc, Array.from(v)); },
    uniform2fv(loc, v) { zet(loc, Array.from(v)); },
    createTexture: () => ({ id: ++id }), bindTexture() {}, texParameteri() {}, deleteTexture() {},
    texImage2D(...a) { log.uploads.push(a[a.length - 1]); },
    createFramebuffer: () => ({ id: ++id }), bindFramebuffer(_, fb) { log.framebuffer = fb; }, framebufferTexture2D() {},
    activeTexture(t) { log.actief = t; }, viewport() {},
    drawArrays() { log.draws++; },
    readPixels() {},
  };
  // Constanten: elk een eigen getal; TEXTURE0 + i moet kloppen.
  for (const k of ['ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'TEXTURE_2D', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'LINEAR', 'TEXTURE_WRAP_S',
    'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE', 'RGBA', 'UNSIGNED_BYTE', 'FRAMEBUFFER', 'COLOR_ATTACHMENT0', 'VERTEX_SHADER', 'FRAGMENT_SHADER',
    'COMPILE_STATUS', 'LINK_STATUS', 'TRIANGLE_STRIP']) gl[k] = k;
  gl.TEXTURE0 = 1000;
  gl.TEXTURE1 = 1001;
  return gl;
}

export function nepCanvas() {
  const gl = nepGL();
  return { width: 0, height: 0, gl, getContext: (soort) => (soort === 'webgl2' ? gl : null) };
}

/** Een nep-<video>: currentTime zetten = seeking tot de test `klaarMetZoeken()` zegt. */
export function nepVideo() {
  const luisteraars = new Map();
  const v = {
    muted: false, playsInline: false, preload: '', src: '', paused: true, playbackRate: 1, readyState: 4, seeking: false,
    videoWidth: 1280, videoHeight: 720, duration: 600, error: null, sprongen: [], _t: 0,
    get currentTime() { return this._t; },
    set currentTime(x) { this._t = x; this.seeking = true; this.sprongen.push(x); },
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    load() {}, removeAttribute(k) { if (k === 'src') this.src = ''; },
    addEventListener(type, fn) { if (!luisteraars.has(type)) luisteraars.set(type, []); luisteraars.get(type).push(fn); },
    vuur(type) { for (const fn of luisteraars.get(type) ?? []) fn(); },
    klaarMetZoeken() { this.seeking = false; },
    /** Speel `dt` seconden af (zoals de decoder): alleen als hij speelt en niet zoekt. */
    loop(dt) { if (!this.paused && !this.seeking) this._t += dt * this.playbackRate; },
  };
  return v;
}

/**
 * Een nep-track zoals de engine hem laat LEZEN: vrij op tempo `R` vanaf `T0` op plek `P0`, of stil.
 */
export function nepTrack({ P0 = 0, T0 = 0, R = 1, speelt = true, geladen = true, wachtTot = null } = {}) {
  return {
    geladen, P0, T0, R, speelt, wachtTot,
    _loopt(t) { return this.speelt && (this.wachtTot === null || t >= this.wachtTot); },
    plek(t) { return this._loopt(t) ? this.P0 + (t - Math.max(this.T0, this.wachtTot ?? -Infinity)) * this.R : this.P0; },
    snelheid(t) { return this._loopt(t) ? this.R : 0; },
    speeltOp(t) { return this._loopt(t); },
  };
}

/** Een nep-engine: tracks, een klok (kern/klok.js of nep), nu() en vertraging(), zaalversterking per track. */
export function nepEngine({ tracks = 8, klok = null, V = 0.05 } = {}) {
  const e = {
    tijd: 10, V, klok: klok ?? { loopt: false, tel: () => 0, perMaat: 4 },
    tracks: Array.from({ length: tracks }, () => nepTrack({ geladen: false, speelt: false })),
    versterking: new Array(tracks).fill(1),
    nu() { return this.tijd; },
    vertraging() { return this.V; },
    zaalVersterking(n) { const t = this.tracks[n - 1]; return t.speeltOp(this.tijd) ? this.versterking[n - 1] : 0; },
    track(n) { return this.tracks[n - 1]; },
    on() { return () => {}; },
  };
  return e;
}

/** Nep-2D-canvas voor de vormen: elke tekenaanroep telt, niets tekent (v1 test/vormen.test.mjs). */
export function nep2D(w, h) {
  const tel = { n: 0 };
  const BEGIN = { lineCap: 'butt', lineJoin: 'miter', lineWidth: 1, globalAlpha: 1, imageSmoothingEnabled: true };
  const doel = {
    ...BEGIN,
    createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }),
    reset: () => Object.assign(doel, BEGIN),
    tel,
  };
  const ctx = new Proxy(doel, {
    get(t, k) { if (k in t) return t[k]; return () => { tel.n++; }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => ctx, tel };
}
