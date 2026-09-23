/**
 * Je set opnemen: precies wat uit de master komt, na de limiter.
 *
 * Een eigen laag, net als de video: de engine weet er niets van (regel 1).
 * De worklet geeft per seconde een stuk door; dat gaat op volgorde naar de
 * server, die het meteen achter het bestand plakt. Crasht de browser, dan
 * ben je hooguit de laatste seconde kwijt.
 *
 * Niets gaat naar buiten: de server schrijft naar opnames/ op deze schijf.
 *
 * Met video erbij komt er naast de WAV een videobestand: het gemixte beeld
 * (1280×720, 30 fps — de resolutie van de mixer en van de bronvideo's) plus
 * het geluid, zodat het op zichzelf af te spelen is. De WAV blijft de
 * lossless versie van het geluid.
 */

/** Wat Chrome kan opnemen, beste eerst. mp4 speelt overal; webm is het vangnet. */
const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
export const VIDEO_BITRATE = 8_000_000;   // korrel en pixel zijn lastig klein te krijgen
export function kiesVideoType(kan = (t) => globalThis.MediaRecorder?.isTypeSupported?.(t)) {
  const type = VIDEO_TYPES.find((t) => kan(t));
  return type ? { type, ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' } : null;
}
export class Opnemer {
  constructor({ engine, haal = (url, init) => fetch(url, init) }) {
    this.engine = engine;
    this.haal = haal;
    this.node = null;
    this.id = null;
    this.bestand = null;
    this.frames = 0;           // wat de worklet aan ons gaf: de lengte komt van de audioklok
    this.bytes = 0;
    this.fout = null;
    this._rij = Promise.resolve();
    this._klaar = null;
  }

  get bezig() { return !!this.node; }
  get metVideo() { return !!this.recorder; }
  get seconden() { return this.frames / (this.engine.ctx.sampleRate || 48000); }

  /**
   * @param video  een canvas om mee op te nemen, of niets voor alleen audio
   */
  /**
   * Start en stop lopen achter elkaar, nooit door elkaar: twee keer snel op
   * start gaf twee opnames met stukken door elkaar in één bestand, en starten
   * tijdens een lopende stop sloot de NIEUWE opname af.
   */
  start(opties) { return this._naElkaar(() => this._start(opties)); }
  stop() { return this._naElkaar(() => this._stop()); }
  _naElkaar(fn) {
    const r = (this._slot || Promise.resolve()).then(fn, fn);
    this._slot = r.catch(() => {});
    return r;
  }

  async _start({ video = null } = {}) {
    if (this.node) return { ok: true };
    const soort = video ? kiesVideoType() : null;
    if (video && !soort) return this._mislukt('deze browser kan geen video opnemen');
    const ctx = this.engine.ctx;
    // De server schrijft 48 kHz in de kop. Draait de context anders, dan zou
    // de opname op de verkeerde snelheid afspelen: liever weigeren.
    if (ctx.sampleRate !== 48000) return this._mislukt(`de audio draait op ${ctx.sampleRate} Hz, opnemen kan alleen op 48000`);
    try {
      await ctx.audioWorklet.addModule(new URL('./opnemer-worklet.js', import.meta.url));
      const res = await this.haal('/api/opname/start', { method: 'POST' });
      const j = await res.json();
      if (!j.ok) return this._mislukt(j.fout || 'server wil niet beginnen');
      this.id = j.id; this.bestand = j.bestand;
    } catch (err) {
      return this._mislukt(`kan niet beginnen: ${err.message}`);
    }
    this.frames = 0; this.bytes = 0; this.fout = null;
    const node = new AudioWorkletNode(ctx, 'opnemer', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    node.port.onmessage = ({ data: m }) => {
      if (m.type === 'stuk') this._verstuur(m.data, m.frames);
      else if (m.type === 'klaar') this._klaar?.();
    };
    this.engine.master.analyser.connect(node);
    // Een node die nergens op uitkomt wordt niet altijd verwerkt. Via een
    // stille gain naar de uitgang: hij draait, en je hoort hem niet.
    this._stil = ctx.createGain();
    this._stil.gain.value = 0;
    node.connect(this._stil).connect(ctx.destination);
    this.node = node;
    if (video) this._startVideo(video, soort);
    return { ok: true, bestand: this.bestand, video: soort?.ext ?? null };
  }

  _startVideo(canvas, { type, ext }) {
    const ctx = this.engine.ctx;
    // Het geluid voor de video: een eigen tap op de master, net als de WAV.
    this._geluid = ctx.createMediaStreamDestination();
    this.engine.master.analyser.connect(this._geluid);
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...this._geluid.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: 256_000 });
    this.videoExt = ext;
    this.videoBytes = 0;
    this._videoRij = Promise.resolve();
    const id = this.id;
    rec.ondataavailable = ({ data }) => {
      if (!data?.size) return;
      // Ook hier strikt op volgorde: een videobestand met stukken door elkaar is kapot.
      this._videoRij = this._videoRij.then(async () => {
        try {
          const res = await this.haal(`/api/opname/${id}/video.${ext}`, {
            method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await data.arrayBuffer(),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).fout || `${res.status}`);
          this.videoBytes += data.size;
        } catch (err) {
          this.fout = `videostuk kwijt: ${err.message}`;
          console.warn('[opname]', this.fout);
        }
      });
    };
    rec.start(1000);                        // elke seconde een stuk, zoals de WAV
    this.recorder = rec;
  }

  async _stopVideo() {
    const rec = this.recorder;
    if (!rec) return;
    this.recorder = null;
    if (rec.state !== 'inactive') {
      await new Promise((klaar) => { rec.onstop = klaar; rec.stop(); setTimeout(klaar, 3000); });
    }
    await this._videoRij;
    try { this.engine.master.analyser.disconnect(this._geluid); } catch (_) {}
    this._geluid = null;
  }

  /** Stukken strikt op volgorde: de volgende pas als de vorige binnen is. */
  _verstuur(data, frames) {
    this.frames += frames;
    const id = this.id;
    this._rij = this._rij.then(async () => {
      // Drie pogingen: een stuk dat stil wegvalt verschuift de hele WAV ten
      // opzichte van de video. Lukt het echt niet, dan melden.
      let laatste = null;
      for (let poging = 0; poging < 3; poging++) {
        try {
          const res = await this.haal(`/api/opname/${id}/stuk`, {
            method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data,
          });
          if (res.ok) { this.bytes += data.byteLength; return; }
          const j = await res.json().catch(() => ({}));
          laatste = j.fout || `${res.status}`;
          if (j.vol) break;                 // opnieuw proberen helpt niet bij een volle schijf
        } catch (err) { laatste = err.message; }
        await new Promise((r) => setTimeout(r, 250 * (poging + 1)));
      }
      this.fout = `stuk kwijt: ${laatste}`;
      this.onFout?.(this.fout);
      console.warn('[opname]', this.fout);
    });
  }

  async _stop() {
    if (!this.node) return { ok: false, fout: 'er loopt geen opname' };
    const node = this.node;
    const id = this.id;                    // vastpakken: straks kan er al een nieuwe lopen
    await new Promise((klaar) => {
      this._klaar = klaar;
      node.port.postMessage({ type: 'stop' });
      setTimeout(klaar, 1500);            // vangnet: niet eeuwig wachten op de audiothread
    });
    try { this.engine.master.analyser.disconnect(node); } catch (_) {}
    node.disconnect();
    this._stil?.disconnect();
    this.node = null;
    await this._stopVideo();
    await this._rij;                       // alles wat onderweg was, eerst binnen
    try {
      const res = await this.haal(`/api/opname/${id}/klaar`, { method: 'POST' });
      const j = await res.json();
      if (!j.ok) return this._mislukt(j.fout);
      return { ok: true, bestand: j.bestand, duur: j.duur, bytes: j.bytes, video: j.video ?? null, videoBytes: j.videoBytes ?? 0, waarschuwing: this.fout };
    } catch (err) {
      return this._mislukt(`afsluiten mislukt: ${err.message} — het bestand staat er wel, de kop wordt bij de volgende start hersteld`);
    }
  }

  _mislukt(fout) { this.fout = fout; return { ok: false, fout }; }
}
