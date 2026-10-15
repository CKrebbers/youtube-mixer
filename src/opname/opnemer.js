/**
 * Je set opnemen: precies wat uit de master komt, na de limiter.
 *
 * Een eigen laag, net als de video: de engine weet er niets van (regel 1).
 * De worklet geeft per seconde een stuk door; dat gaat op volgorde naar de
 * server, met de frame-positie erbij (`?frame=N`), en de server zet het op
 * precies die plek. Daardoor is een stuk idempotent: opnieuw proberen na een
 * verloren antwoord schrijft dezelfde bytes op dezelfde plek, en een stuk dat
 * helemaal wegvalt wordt stilte in plaats van dat alles erna naar voren
 * schuift (en uit de pas raakt met de video). Crasht de browser, dan ben je
 * hooguit de laatste seconde kwijt.
 *
 * Niets gaat naar buiten: de server schrijft naar opnames/ op deze schijf.
 *
 * Met video erbij komt er naast de WAV een videobestand: het gemixte beeld
 * (1280×720, 30 fps — de resolutie van de mixer en van de bronvideo's) plus
 * het geluid, zodat het op zichzelf af te spelen is. De WAV blijft de
 * lossless versie van het geluid.
 */

import { leesWeg } from '../lib/antwoord.js';

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
  /**
   * @param wacht      pauze tussen pogingen (ms -> Promise); de tests geven er een zonder pauze
   * @param hervatTijd hoe lang we wachten tot een stilstaande AudioContext aangaat
   */
  constructor({ engine, haal = (url, init) => fetch(url, init), wacht = (ms) => new Promise((r) => setTimeout(r, ms)), hervatTijd = 1500 }) {
    this.engine = engine;
    this.haal = haal;
    this.wacht = wacht;
    this.hervatTijd = hervatTijd;
    this.node = null;
    this.id = null;
    this.bestand = null;
    this.frames = 0;           // wat de worklet aan ons gaf: de lengte komt van de audioklok
    this.bytes = 0;
    this.fout = null;
    this._rij = Promise.resolve();
    this._klaar = null;
    this.onBegin = null;       // (id) => void: de opname loopt (het handelingenlog begint dan mee)
    this.onEind = null;        // (id) => void: de opname stopt
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
    // Via de bus (record.start op de APC) is er geen klik geweest die de
    // AudioContext aanzette. Staat hij stil, dan draait de worklet niet en
    // neem je niets op. Chrome laat hem zonder eerdere klik op de pagina niet
    // aan (de belofte blijft dan hangen): niet eeuwig wachten, wel zeggen.
    if (ctx.state !== 'running') {
      await Promise.race([Promise.resolve(this.engine.resume?.()).catch(() => {}), this.wacht(this.hervatTijd)]);
      if (ctx.state !== 'running') return this._mislukt('de audio staat nog stil — klik eerst één keer ergens op de pagina');
    }
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
    // Een fout in de worklet: vanaf daar komen er geen stukken meer. Zeggen, niet stil verder "opnemen".
    node.onprocessorerror = (e) => {
      if (node !== this.node) return;
      this.fout = `de opname-worklet liep vast${e?.message ? ` (${e.message})` : ''}: vanaf hier wordt niets meer opgenomen, stop en begin opnieuw`;
      this.onFout?.(this.fout);
    };
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
    // Het handelingenlog hoort bij de opname, met hetzelfde id (logboek.js).
    try { this.onBegin?.(this.id); } catch (err) { console.warn('[opname] onBegin:', err); }
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
          await leesWeg(res);               // ook gelukt: een ongelezen antwoord blijft in Chrome hangen (WINST.md punt 1)
          this.videoBytes += data.size;
        } catch (err) {
          this.fout = `videostuk kwijt: ${err.message}`;
          this.onFout?.(this.fout);
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

  /**
   * Stukken strikt op volgorde: de volgende pas als de vorige binnen is. Elk
   * stuk draagt zijn eigen plek (frames vanaf het begin, van de audioklok):
   * de server schrijft daar, dus herhalen is veilig en een gat blijft een gat.
   */
  _verstuur(data, frames) {
    const frame = this.frames;
    this.frames += frames;
    const id = this.id;
    this._rij = this._rij.then(async () => {
      // Drie pogingen: een stuk dat stil wegvalt verschuift de hele WAV ten
      // opzichte van de video. Lukt het echt niet, dan melden.
      let laatste = null;
      for (let poging = 0; poging < 3; poging++) {
        try {
          const res = await this.haal(`/api/opname/${id}/stuk?frame=${frame}`, {
            method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data,
          });
          // Ook het antwoord van een gelukt stuk lezen: Chrome houdt een ongelezen
          // antwoord vast, ~400 kB per stuk, dus ~23 MB per minuut opnemen (WINST.md punt 1).
          if (res.ok) { await leesWeg(res); this.bytes += data.byteLength; return; }
          const j = await res.json().catch(() => ({}));
          laatste = j.fout || `${res.status}`;
          if (j.vol) break;                 // opnieuw proberen helpt niet bij een volle schijf
        } catch (err) { laatste = err.message; }
        await this.wacht(250 * (poging + 1));
      }
      this.fout = `stuk kwijt (${(frame / 48000).toFixed(0)} s, wordt stilte): ${laatste}`;
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
    try { this.onEind?.(id); } catch (err) { console.warn('[opname] onEind:', err); }
    await this._stopVideo();
    await this._rij;                       // alles wat onderweg was, eerst binnen
    try {
      // Het aantal frames erbij: viel het laatste stuk weg, dan vult de server
      // de staart met stilte en is de WAV even lang als de opname.
      const res = await this.haal(`/api/opname/${id}/klaar?frames=${this.frames}`, { method: 'POST' });
      const j = await res.json();
      if (!j.ok) return this._mislukt(j.fout);
      const waarschuwing = [this.fout, j.waarschuwing].filter(Boolean).join(' — ') || null;
      return { ok: true, bestand: j.bestand, duur: j.duur, bytes: j.bytes, video: j.video ?? null, videoBytes: j.videoBytes ?? 0, waarschuwing };
    } catch (err) {
      return this._mislukt(`afsluiten mislukt: ${err.message} — het bestand staat er wel, de kop wordt bij de volgende start hersteld`);
    }
  }

  _mislukt(fout) { this.fout = fout; return { ok: false, fout }; }
}
