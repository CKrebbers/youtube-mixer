// Herkomst: v1 youtube-mixer/src/video/video-mixer.js @ 039b372. De shaders (MENG, EFFECT, LAGEN, TOON),
// _volg en de seekmeting zijn overgenomen; de klasse is herschreven voor v2 (oogst beeld-025, -077):
// de mixer leest elk beeld de STAND (stand.js) en de engine, kopieert niets (geen neemOver), en maakt
// per beeld geen nieuwe arrays of objecten. De puls komt van de maatklok.
import { synchroniseer, inDePas, doelVan } from './volg.js';
import { videoFoutTekst, laadtTeLang, LAAD_GEDULD } from './fouten.js';
import { MODI } from './instellingen.js';
import { klokPuls, metPuls } from './puls.js';
import { schaalVoor } from './passen.js';
import { actieveLagen, lagenUniforms, maakLagenBuffers, MAX_BEELDLAGEN } from './lagen.js';
import { eindUniforms, wandklok } from './eindbeeld.js';

/**
 * De videomixer: per track een gedempte <video>, samen gemengd op een canvas met WebGL2.
 *
 * Hij LEEST de engine alleen (duck-typed): engine.nu(), engine.vertraging(), engine.klok,
 * engine.tracks[i] (plek(t), snelheid(t), speeltOp(t), geladen) en engine.zaalVersterking(n). De audio
 * is de baas; elke video volgt (volg.js). Wat hij mengt komt uit de stand van het beeld (stand.js):
 * effecten, mengvorm, puls, passend/vullen, clips, de noodknoppen en welke video op welke track.
 *
 * Mengen: hoe zichtbaar een track is = zijn zaalversterking (fader × crossfader, 0 als hij niet
 * speelt): wat je hoort, zie je. Onder ZICHTBAAR wordt de video gepauzeerd en niet geüpload.
 *
 * Vier stappen per beeld, elk in een eigen shader (oogst beeld-010):
 *   mengen    acht video's -> één beeld, volgens de mengvorm
 *   lagen     ALLEEN als er een beeldlaag aan staat (lagen.js, de Vormmachines): generatief beeld
 *             over het gemengde beeld. Staat er niets aan, dan slaat hij over en is het beeld bit
 *             voor bit wat het zonder lagen was.
 *   effecten  pixel, spiegel, RGB, kleur, sporen, korrel. Sporen heeft het VORIGE eindbeeld nodig,
 *             dus dit schrijft naar een van twee buffers die om de beurt wisselen (ping-pong).
 *   tonen     het eindbeeld op het canvas, met de noodknoppen erop (eindbeeld.js): flits, master,
 *             zwart. Hier en nergens eerder: zaal, los venster en opname zien hetzelfde, en de sporen
 *             onthouden er niets van. Bevroren slaat de eerste drie over en toont het laatste eindbeeld.
 *
 * ORIËNTATIE (oogst beeld-013): een beeld dat in een framebuffer getekend is staat ondersteboven t.o.v.
 * een video- of canvas-texture. De regel van deze mixer: een video, canvas of ImageBitmap wordt met uv
 * gelezen; een BUFFER (gemengd, gelaagd, het vorige eindbeeld) wordt gelezen door een stap die hem met uv
 * leest, en twee van die stappen vallen tegen elkaar weg. De lagenstap en de sporen lezen een buffer
 * daarom met 1 − uv.y. NOOIT UNPACK_FLIP_Y aanzetten: een ImageBitmap (vormen in de Worker) negeert hem.
 * tools/proef-beeld.mjs meet het met vier verschillend gekleurde kwarten, met en zonder vormlaag.
 */

export const MAX = 8;
export const ZICHTBAAR = 0.002;
// Vaste renderresolutie, die van de video's zelf. NIET de maat van het paneel: dan werd het canvas
// 1×1 zodra je het paneel sloot, en kreeg het losse venster één uitvergrote pixel te zien.
export const BREEDTE = 1280, HOOGTE = 720;

const VERTEX = `#version 300 es
in vec2 p;
out vec2 uv;
void main() {
  uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// Acht texturen uitgeschreven: in GLSL ES 3.00 mag je een sampler-array alleen met een constante
// index aanspreken, ook niet met een lusteller (oogst beeld-014). Elke laag heeft zijn eigen
// beeldverhouding (passen.js): s[i] schaalt de doekcoördinaat naar de beeldcoördinaat, en buiten het
// beeld is de laag doorzichtig (g = 0), niet zwart.
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
    // mix: gemiddelde, maar een enkele track op halve fader wordt wél donkerder (oogst beeld-011).
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
  // Het vorige EINDbeeld gloeit na: een buffer, één keer extra gelezen, dus hier terug (1 − uv.y).
  c = mix(c, texture(vorig, vec2(uv.x, 1.0 - uv.y)).rgb, sporen * 0.92);
  c += (ruis(uv * 1280.0 + tijd) - 0.5) * korrel * 0.35;
  c += flits * 0.6;                        // lichtflits op de tel (pulsdoel 'flits'; de sporen onthouden hem)
  kleur = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// Twee beeldlagen over het gemengde beeld. Een laag is een canvas of ImageBitmap en komt binnen zoals
// een video (zelfde oriëntatie), vullend op het doek; buiten zijn beeld telt hij niet mee. De bijna-
// zwarte achtergrond van een vorm (#07090c) gaat er per kanaal af, met een zachte drempel (oogst beeld-047).
const LAGEN = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 kleur;
uniform sampler2D basis, l0, l1;
uniform float a[2];
uniform int m[2];
uniform vec2 s[2];
float binnen(vec2 q) { return step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0); }
vec3 schoon(vec3 l) {
  const vec3 bg = vec3(7.0, 9.0, 12.0) / 255.0;
  vec3 c = clamp((l - bg) / (vec3(1.0) - bg), 0.0, 1.0);
  return c * smoothstep(0.03, 0.08, max(c.r, max(c.g, c.b)));
}
vec3 leg(vec3 c, vec3 l, float d, int vorm) {
  if (vorm == 1) return c + l * d;                  // add
  if (vorm == 2) return mix(c, c * l, d);           // multiply
  return vec3(1.0) - (vec3(1.0) - c) * (vec3(1.0) - l * d);   // screen
}
void main() {
  // basis is een BUFFER (het gemengde beeld): een derde stap die hem met uv leest zou de video op zijn
  // kop zetten (Clay, 24 sep). Dus hier recht lezen, met 1 − uv.y.
  vec3 c = texture(basis, vec2(uv.x, 1.0 - uv.y)).rgb;
  vec2 q = (uv - 0.5) * s[0] + 0.5;
  if (a[0] > 0.0) c = leg(c, schoon(texture(l0, q).rgb), a[0] * binnen(q), m[0]);
  q = (uv - 0.5) * s[1] + 0.5;
  if (a[1] > 0.0) c = leg(c, schoon(texture(l1, q).rgb), a[1] * binnen(q), m[1]);
  kleur = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// helder = master × (1 − zwart): precies 0 is precies zwart. De flits gaat eerst naar wit en valt dus
// ook onder master en zwart: zwart wint van alles.
const TOON = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 kleur;
uniform sampler2D beeld;
uniform float helder, flits;
void main() {
  vec3 c = mix(texture(beeld, uv).rgb, vec3(1.0), flits);
  kleur = vec4(clamp(c * helder, 0.0, 1.0), 1.0);
}`;

export class VideoMixer {
  /**
   * @param canvas     waar het beeld komt
   * @param tracks     hoeveel tracks (hooguit acht)
   * @param maakVideo  een <video> maken; in het losse venster die van ZIJN document
   * @param klokMs     de klok om te METEN (seekduur, laadgeduld) in ms; de tests geven een nep
   * @param wand       de wandklok van de noodknoppen (eindbeeld.js); de tests geven een nep
   * @param breedte, hoogte  het doek; standaard 1280 × 720. Alleen de proef in de cloud kiest kleiner
   *                   (software-WebGL haalt daar ~6 beelden/s op 1280 × 720); de app nooit.
   */
  constructor({ canvas, tracks = MAX, maakVideo = () => document.createElement('video'), klokMs = () => performance.now(), wand = wandklok,
    breedte = BREEDTE, hoogte = HOOGTE }) {
    this.canvas = canvas;
    this.B = breedte;
    this.H = hoogte;
    this.klokMs = klokMs;
    this.wand = wand;
    this.tracks = Math.min(MAX, tracks);
    this.maakVideo = maakVideo;
    this.lagen = new Array(this.tracks).fill(null);   // index n−1 -> { video, url, tex, seekStart, seekDuur, klaar, zichtSinds, gemeld }
    this.fout = null;
    this.onFout = null;              // (n, tekst): de video van een nummer ontbreekt of laadt niet
    this.beelden = 0;                // getekende beelden, voor de status en de proef
    this.vorigBeeldMs = -Infinity;
    this.laatsteEindMs = -Infinity;  // wandklok van het laatst gemaakte eindbeeld (bevriezen)
    // Vaste buffers: de beeldlus maakt niets aan (oogst beeld-077).
    this._w = new Float32Array(MAX);
    this._schaal = new Float32Array(MAX * 2);
    this._pas = Array.from({ length: MAX }, () => ({ klaar: false, zoekt: false, verschil: 0, fout: false }));
    this._nPas = 0;
    this._doel = { doel: 0, rate: 1, speelt: false };
    this._fx = {};
    this._eind = { helder: 1, flits: 0 };
    this._actief = [];
    this._maten = Array.from({ length: MAX_BEELDLAGEN }, () => [0, 0]);
    this._lagenBuf = maakLagenBuffers();
    canvas.width = this.B;
    canvas.height = this.H;

    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) { this.fout = 'WebGL2 is niet beschikbaar in deze browser'; return; }
    this.gl = gl;
    this.meng = this._programma(VERTEX, MENG);
    this.effect = this._programma(VERTEX, EFFECT);
    this.toon = this._programma(VERTEX, TOON);
    this.lagenProg = null;           // pas bij de eerste beeldlaag: zonder vormen niets extra's
    this.prog = this.meng && this.effect && this.toon;
    if (!this.prog) return;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const prog of [this.meng, this.effect, this.toon]) this._attrib(prog);
    this.u = new Map();              // prog -> { naam -> locatie }, één keer opgezocht

    gl.useProgram(this.meng);
    for (let i = 0; i < MAX; i++) gl.uniform1i(this._loc(this.meng, `t${i}`), i);
    gl.useProgram(this.effect);
    gl.uniform1i(this._loc(this.effect, 'beeld'), 0);
    gl.uniform1i(this._loc(this.effect, 'vorig'), 1);
    gl.useProgram(this.toon);
    gl.uniform1i(this._loc(this.toon, 'beeld'), 0);
    gl.uniform1f(this._loc(this.toon, 'helder'), 1);
    gl.uniform1f(this._loc(this.toon, 'flits'), 0);

    // Eén zwart pixel voor lege plekken: een sampler zonder texture is ongeldig.
    this.zwart = this._texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.gemengd = this._doek();
    this.gelaagd = null;             // pas bij de eerste beeldlaag
    this.laagTex = [];
    this.eind = [this._doek(), this._doek()];
    this.beurt = 0;
  }

  _attrib(prog) {
    const gl = this.gl;
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  _loc(prog, naam) {
    let m = this.u.get(prog);
    if (!m) { m = new Map(); this.u.set(prog, m); }
    if (!m.has(naam)) m.set(naam, this.gl.getUniformLocation(prog, naam));
    return m.get(naam);
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

  /** Een texture van 1280×720 waar een shader naartoe kan schrijven. */
  _doek() {
    const gl = this.gl;
    const tex = this._texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.B, this.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb };
  }

  /**
   * Programma, doek en texturen voor de lagenstap, één keer, buiten het tekenen van een beeld: een
   * texture maken bindt hem op de unit die dan actief is, en midden in een beeld overschreef dat eens
   * de eerste laag (v1, controleur 24 sep).
   */
  _maakLagenStap() {
    const gl = this.gl;
    if (!gl || this.lagenProg || this.lagenMislukt) return;
    const prog = this._programma(VERTEX, LAGEN);
    if (!prog) { this.lagenFout = this.fout; this.fout = null; this.lagenMislukt = true; return; }
    this._attrib(prog);
    gl.useProgram(prog);
    gl.uniform1i(this._loc(prog, 'basis'), 0);
    for (let i = 0; i < MAX_BEELDLAGEN; i++) gl.uniform1i(this._loc(prog, `l${i}`), 1 + i);
    this.gelaagd = this._doek();
    this.laagTex = Array.from({ length: MAX_BEELDLAGEN }, () => this._texture());
    this.lagenProg = prog;
  }

  /** De video's volgen de bronnen van de stand (url per track); alleen wat anders is wordt aangeraakt. */
  _volgBronnen(bronnen) {
    for (let i = 0; i < this.tracks; i++) {
      const url = bronnen[i] ?? null;
      if ((this.lagen[i]?.url ?? null) !== url) this.zetBron(i + 1, url);
    }
  }

  /** Een video aan track n hangen, of weghalen met null. */
  zetBron(n, url) {
    const i = n - 1;
    const oud = this.lagen[i];
    if ((oud?.url ?? null) === (url || null)) return;
    if (oud) {
      oud.video.pause();
      oud.video.removeAttribute('src');
      oud.video.load();                      // geeft de decoder echt vrij
      if (this.gl) this.gl.deleteTexture(oud.tex);
      this.lagen[i] = null;
    }
    if (!url || !this.gl) return;
    const video = this.maakVideo();
    video.muted = true;                      // het geluid komt uit de engine, nooit hieruit
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    const laag = { video, url, tex: this._texture(), seekStart: 0, seekDuur: 0.15, klaar: false, zichtSinds: null, gemeld: false };
    video.addEventListener('loadeddata', () => { laag.klaar = true; });
    // Ontbreekt het bestand of is het kapot, dan zegt de strook het (één keer per bron, oogst beeld-040).
    video.addEventListener('error', () => {
      if (this.lagen[i] !== laag || laag.gemeld) return;
      laag.gemeld = true;
      this.onFout?.(n, videoFoutTekst(video.error));
    });
    this.lagen[i] = laag;
  }

  /**
   * Elke video bijsturen en de zichtbare uploaden, elk op zijn eigen texture-unit. Voor teken() en
   * loopIn(). Vult this._w (gewicht), this._schaal en this._pas (per zichtbare video: in de pas?).
   */
  _bijwerken(engine, stand, nu, V) {
    const gl = this.gl;
    const w = this._w, schaal = this._schaal;
    w.fill(0); schaal.fill(1);
    this._nPas = 0;
    this._volgBronnen(stand.bronnen);
    // Stond het tekenen stil (tabblad verborgen, het andere venster mengde, paneel dicht), dan telt
    // die tijd niet als "zichtbaar", en een sprong die toen liep meten we niet.
    const nuMs = this.klokMs();
    if (nuMs - this.vorigBeeldMs > 1000) for (const l of this.lagen) if (l) { l.zichtSinds = null; l.seekStart = 0; }
    this.vorigBeeldMs = nuMs;

    for (let i = 0; i < this.tracks; i++) {
      const laag = this.lagen[i];
      const t = engine.tracks[i];
      // Clips uit (video.clips): elke video telt als onzichtbaar, dus gepauzeerd en zwart.
      const zicht = stand.clips && laag && t?.geladen ? engine.zaalVersterking(i + 1) : 0;
      gl.activeTexture(gl.TEXTURE0 + i);
      if (!laag || !(zicht >= ZICHTBAAR)) {
        if (laag && !laag.video.paused) laag.video.pause();
        if (laag) { laag.zichtSinds = null; laag.seekStart = 0; }
        gl.bindTexture(gl.TEXTURE_2D, this.zwart);
        continue;
      }
      laag.zichtSinds ??= nuMs;
      if (laadtTeLang({ zichtbaar: true, klaar: laag.klaar, gemeld: laag.gemeld, sinds: laag.zichtSinds, nu: nuMs })) {
        laag.gemeld = true;
        this.onFout?.(i + 1, `na ${LAAD_GEDULD} s nog geen beeld`);
      }
      const doel = this._volg(laag, t, nu, V);
      const v = laag.video;
      const beeld = laag.klaar && v.readyState >= 2;
      gl.bindTexture(gl.TEXTURE_2D, laag.tex);
      if (beeld) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        w[i] = Math.min(1, zicht);
        const [sx, sy] = schaalVoor(v.videoWidth || v.width || 0, v.videoHeight || v.height || 0, stand.fit, this.B, this.H);
        schaal[i * 2] = sx; schaal[i * 2 + 1] = sy;
      }
      const p = this._pas[this._nPas++];
      p.klaar = beeld; p.zoekt = v.seeking; p.verschil = v.currentTime - doel; p.fout = laag.gemeld;
    }
  }

  /*
   * Bijsturen op video.currentTime, niet op requestVideoFrameCallback: gemeten in v1 (docs/BEAMER.md,
   * oogst beeld-005) loopt het mediaTime dat rVFC meldt ~13 ms ACHTER op het beeld dat texImage2D
   * werkelijk uploadt; currentTime zit er binnen ~4 ms op.
   */
  _volg(laag, track, nu, V) {
    const v = laag.video;
    // Hoe lang een sprong duurt: gemeten tot het eerste beeld waarin seeking weer false is. NIET met het
    // 'seeked'-event: dat komt onder belasting pas NA dat beeld, en dan duurde een sprong "0 s" en
    // sprongen de video's 20 s achter het geluid aan (v1, acht tracks; oogst beeld-003).
    if (laag.seekStart && !v.seeking) {
      const d = (this.klokMs() - laag.seekStart) / 1000;
      laag.seekDuur = laag.seekDuur * 0.7 + Math.min(2, d) * 0.3;
      laag.seekStart = 0;
    }
    const { doel, rate, speelt } = doelVan(track, nu, V, this._doel);
    const r = synchroniseer({ videoTijd: v.currentTime, doel, rate, speelt, zoekt: v.seeking, seekDuur: laag.seekDuur });
    if (r.spring !== null) {
      laag.seekStart = this.klokMs();
      v.currentTime = Math.min(r.spring, (v.duration || Infinity) - 0.05);
    }
    // Chrome accepteert 0,0625 tot 16; daarbuiten gooit hij.
    const pr = Math.max(0.0625, Math.min(16, r.rate));
    if (Math.abs(v.playbackRate - pr) > 0.001) v.playbackRate = pr;
    if (r.speel && v.paused) v.play().catch(() => {});
    else if (!r.speel && !v.paused) v.pause();
    return doel;
  }

  /**
   * Inlopen (het losse venster): elke video bijsturen en de zichtbare uploaden zoals teken(), maar niet
   * mengen. Een <video> die niemand uitleest krijgt in Chrome geen vers beeld (oogst beeld-027).
   * @returns lopen alle zichtbare video's in de pas (volg.js inDePas)
   */
  loopIn(engine, beeld) {
    if (!this.gl || !this.prog) return true;
    this._bijwerken(engine, beeld.stand, engine.nu(), engine.vertraging());
    return inDePas(this._pas, undefined, this._nPas);
  }

  /**
   * Eén beeld: elke video bijsturen, de zichtbare uploaden, mengen, lagen, effecten, tonen.
   * @param engine  alleen om te lezen
   * @param beeld   { stand, eind, lagen } (stand.js), van dit venster of van het hoofdvenster
   */
  teken(engine, beeld) {
    const gl = this.gl;
    if (!gl || !this.prog) return;
    this.beelden++;
    const nu = engine.nu(), V = engine.vertraging();
    // Op welke audiotijd dit beeld gemaakt is (de proef vergelijkt daarmee: ctx.currentTime loopt tijdens
    // een trage teken() door, video.currentTime staat binnen een taak stil).
    this.tekenNu = nu; this.tekenV = V;
    const stand = beeld.stand;
    // Ook bevroren: de video's blijven de audio volgen en worden geüpload, zodat het beeld bij
    // loslaten meteen klopt.
    this._bijwerken(engine, stand, nu, V);
    const klok = this.wand();
    gl.viewport(0, 0, this.B, this.H);

    // Bevroren: het laatste eindbeeld nog eens tonen, maar alleen een beeld van NA het indrukken
    // (oogst beeld-034). Zonder preserveDrawingBuffer is het canvas na elk getoond beeld leeg, dus elk
    // beeld opnieuw tonen; het eindbeeld zelf staat in een buffer die bevroren niet beschreven wordt.
    const eb = beeld.eind;
    if (eb.bevroren && this.laatsteEindMs >= eb.bevrorenSinds) {
      this._toon(this.eind[1 - this.beurt].tex, eindUniforms(eb, klok, this._eind));
      return;
    }

    // 1. mengen -> gemengd
    gl.useProgram(this.meng);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gemengd.fb);
    gl.uniform1fv(this._loc(this.meng, 'w'), this._w);
    gl.uniform2fv(this._loc(this.meng, 's'), this._schaal);
    gl.uniform1i(this._loc(this.meng, 'modus'), Math.max(0, MODI.indexOf(stand.modus)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 1b. beeldlagen -> gelaagd (alleen als er een aan staat); t = wat je hoort
    const bron = this._lagen(beeld.lagen ?? [], Math.max(0, nu - V)) ?? this.gemengd;

    // 2. effecten -> eind[nu], met eind[vorige] voor de sporen; de puls op de tel van de KLOK
    const nuBuf = this.eind[this.beurt], vorige = this.eind[1 - this.beurt];
    gl.useProgram(this.effect);
    gl.bindFramebuffer(gl.FRAMEBUFFER, nuBuf.fb);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bron.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, vorige.tex);
    const vorm = stand.puls > 0 ? klokPuls(engine.klok, nu, V) : 0;
    const f = metPuls(stand.fx, stand.pulsDoel, stand.puls, vorm, 0, this._fx);
    gl.uniform1f(this._loc(this.effect, 'flits'), f.flits);
    gl.uniform1f(this._loc(this.effect, 'pixel'), f.pixel);
    gl.uniform1f(this._loc(this.effect, 'spiegel'), f.spiegel);
    gl.uniform1f(this._loc(this.effect, 'rgb'), f.rgb);
    gl.uniform1f(this._loc(this.effect, 'verz'), f.kleur);
    gl.uniform1f(this._loc(this.effect, 'sporen'), f.sporen);
    gl.uniform1f(this._loc(this.effect, 'korrel'), f.korrel);
    gl.uniform1f(this._loc(this.effect, 'tijd'), (this.klokMs() / 1000) % 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.laatsteEindMs = klok;

    // 3. tonen
    this._toon(nuBuf.tex, eindUniforms(eb, klok, this._eind));
    this.beurt = 1 - this.beurt;
  }

  /** De laatste stap: een eindbeeld op het canvas, met flits, master en zwart. */
  _toon(tex, { helder, flits }) {
    const gl = this.gl;
    gl.useProgram(this.toon);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1f(this._loc(this.toon, 'helder'), helder);
    gl.uniform1f(this._loc(this.toon, 'flits'), flits);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * De beeldlagen over het gemengde beeld. Geeft het doek met het resultaat, of null als er geen laag
   * aan staat (dan blijft alles zoals het was). t = de audioklok op wat je HOORT.
   */
  _lagen(lagen, t) {
    const actief = actieveLagen(lagen, this._actief);
    if (!actief.length) return null;
    this._maakLagenStap();
    if (!this.lagenProg) return null;
    const gl = this.gl;
    for (let i = 0; i < actief.length; i++) {
      const b = actief[i].frame(t);
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.laagTex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, b);
      const m = this._maten[i];
      m[0] = b?.width || 0; m[1] = b?.height || 0;
    }
    for (let i = actief.length; i < MAX_BEELDLAGEN; i++) { gl.activeTexture(gl.TEXTURE1 + i); gl.bindTexture(gl.TEXTURE_2D, this.zwart); }
    const { a, m, s } = lagenUniforms(actief, this._maten, this.B, this.H, this._lagenBuf);
    gl.useProgram(this.lagenProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gelaagd.fb);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.gemengd.tex);
    gl.uniform1fv(this._loc(this.lagenProg, 'a'), a);
    gl.uniform1iv(this._loc(this.lagenProg, 'm'), m);
    gl.uniform2fv(this._loc(this.lagenProg, 's'), s);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.gelaagd;
  }

  /**
   * Een kant-en-klaar beeld tonen in plaats van zelf te mengen: tijdens de inloop zet het hoofdvenster
   * zijn canvas op dat van het losse venster. Roep dit aan METEEN na het tekenen van `bron`, in dezelfde
   * taak: een WebGL-canvas zonder preserveDrawingBuffer is leeg zodra hij getoond is (oogst beeld-015).
   * Zwart, master en flits zitten al in het geleende beeld: de toonstap neutraal.
   */
  toonBeeld(bron) {
    const gl = this.gl;
    if (!gl || !this.prog) return;
    gl.activeTexture(gl.TEXTURE0);
    this.leenTex ??= this._texture();
    gl.bindTexture(gl.TEXTURE_2D, this.leenTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bron);
    gl.viewport(0, 0, this.B, this.H);
    this._toon(this.leenTex, { helder: 1, flits: 0 });
  }

  /**
   * Pixels van het getoonde beeld (RGBA, rij 0 = ONDERAAN, zoals readPixels). Alleen geldig vlak na
   * teken() in dezelfde taak. Voor de proef en een controle op het scherm, niet voor de lus.
   */
  leesPixels(x, y, b = 1, h = 1) {
    const gl = this.gl;
    if (!gl) return null;
    const uit = new Uint8Array(b * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(x, y, b, h, gl.RGBA, gl.UNSIGNED_BYTE, uit);
    return uit;
  }

  /** Paneel en los venster dicht: niets meer decoderen. */
  pauzeerAlles() { for (const l of this.lagen) if (l && !l.video.paused) l.video.pause(); }

  /** Voor het scherm en de proef: wat doet elke video nu. */
  stand(engine) {
    const nu = engine.nu(), V = engine.vertraging();
    return this.lagen.map((l, i) => {
      if (!l) return { n: i + 1, video: false };
      const t = engine.tracks[i];
      const d = t?.geladen ? doelVan(t, nu, V, {}).doel : 0;
      return { n: i + 1, video: true, klaar: l.klaar, speelt: !l.video.paused, tijd: l.video.currentTime, verschil: l.video.currentTime - d, seekDuur: l.seekDuur };
    });
  }

  vernietig() {
    for (let n = 1; n <= this.tracks; n++) this.zetBron(n, null);
  }
}
