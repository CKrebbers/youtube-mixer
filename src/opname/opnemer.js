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
 * DE SERVER MAG EVEN WEG ZIJN (docs/WINST.md punt 3): een stuk dat niet aankomt
 * omdat de server niet antwoordt (geen verbinding, of een 5xx van een proxy
 * zoals `tailscale serve`), blijft op volgorde in de rij en wordt opnieuw
 * geprobeerd met een oplopende pauze (0,25 → 2 s) zolang de opname loopt. Pas
 * als de rij langer is dan `rijSeconden` (5 min, ~57 MB) valt het OUDSTE stuk
 * weg (gat = stilte, op zijn plek), en een volle schijf geeft meteen op. Bij
 * stoppen krijgt de rij nog `stopGrens` (10 s) om leeg te lopen; daarna de
 * oude regel. `onStand` meldt het verloop (één melding die meegroeit,
 * opname-knop.js); `onFout` blijft per stuk dat echt kwijt is.
 *
 * Niets gaat naar buiten: de server schrijft naar opnames/ op deze schijf.
 *
 * Met video erbij komt er naast de WAV een videobestand: het gemixte beeld
 * (1280×720, 30 fps — de resolutie van de mixer en van de bronvideo's) plus
 * het geluid, zodat het op zichzelf af te spelen is. De WAV blijft de
 * lossless versie van het geluid.
 */

import { leesWeg } from '../lib/antwoord.js';
import { herhaal, nieuweToestand, tijdslot } from '../lib/herhaal.js';

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
/** Hoeveel seconden audio er hooguit in de rij wachten: 5 min ≈ 57 MB (48 kHz, 16-bit stereo). */
export const RIJ_SECONDEN = 300;
/** Na stop: zo lang (ms) mag de rij nog leeglopen, daarna geldt "gat = stilte". */
export const STOP_GRENS = 10_000;
const SR = 48000;

export function kiesVideoType(kan = (t) => globalThis.MediaRecorder?.isTypeSupported?.(t)) {
  const type = VIDEO_TYPES.find((t) => kan(t));
  return type ? { type, ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' } : null;
}
/**
 * De tekst van de ene opname-melding bij een stand (Opnemer.stand(), via onStand):
 * { tekst, soort } voor meld(…, { sleutel: 'opname' }). Puur, zodat de test hem kan lezen.
 *   storing           "opname: server antwoordt niet, 14 s in de wacht" (fout, blijft staan)
 *   weer goed         "opname: weer goed, niets verloren" (info, gaat vanzelf weg)
 *   weer goed met gat "opname: weer goed, 3 s verloren (stilte op die plek)" (fout)
 *   opgegeven         "opname: server antwoordde niet, 3 s verloren (stilte op die plek)" (fout)
 */
export function meldingVan(st) {
  const s = (x) => `${Math.round(x)} s`;
  if (st.storing) {
    return { soort: 'fout', tekst: `opname: server antwoordt niet, ${s(st.wacht)} in de wacht${st.verloren ? `, ${s(st.verloren)} verloren` : ''}` };
  }
  if (st.goed && !st.verloren) return { soort: 'info', tekst: 'opname: weer goed, niets verloren' };
  return { soort: 'fout', tekst: `opname: ${st.goed ? 'weer goed' : 'server antwoordde niet'}, ${s(st.verloren)} verloren (stilte op die plek)` };
}

export class Opnemer {
  /**
   * @param wacht       pauze tussen pogingen (ms -> Promise); de tests geven er een met een nep-klok
   * @param nu          () => ms, voor de grens bij stoppen (de tests: dezelfde nep-klok)
   * @param hervatTijd  hoe lang we wachten tot een stilstaande AudioContext aangaat
   * @param rijSeconden hoeveel audio er hooguit wacht als de server weg is
   * @param stopGrens   ms die de rij na stop nog krijgt
   */
  constructor({ engine, haal = (url, init) => fetch(url, init), wacht = (ms) => new Promise((r) => setTimeout(r, ms)),
    nu = () => performance.now(), hervatTijd = 1500, rijSeconden = RIJ_SECONDEN, stopGrens = STOP_GRENS }) {
    this.engine = engine;
    this.haal = haal;
    this.wacht = wacht;
    this.nu = nu;
    this.hervatTijd = hervatTijd;
    this.rijSeconden = rijSeconden;
    this.stopGrens = stopGrens;
    this.node = null;
    this.id = null;
    this.bestand = null;
    this.frames = 0;           // wat de worklet aan ons gaf: de lengte komt van de audioklok
    this.bytes = 0;
    this.fout = null;
    this._rij = Promise.resolve();
    this._klaar = null;
    this._inRij = 0;           // frames audio die nog niet bevestigd zijn (ook het stuk dat onderweg is)
    this._doorTot = null;      // null = de opname loopt; anders: tot dit moment (this.nu) mag de rij nog leeglopen
    this._t = nieuweToestand();
    this.storing = null;       // { fout, verloren } zolang de server niet antwoordt, anders null
    this.verloren = 0;         // seconden audio die deze opname echt kwijt is (stilte op hun plek)
    this.onBegin = null;       // (id) => void: de opname loopt (het handelingenlog begint dan mee)
    this.onEind = null;        // (id) => void: de opname stopt
    this.onStand = null;       // (stand) => void: de server antwoordt niet / weer wel (zie stand())
  }

  get bezig() { return !!this.node; }
  get metVideo() { return !!this.recorder; }
  get seconden() { return this.frames / (this.engine.ctx.sampleRate || 48000); }
  /** Seconden audio die op de server wachten (ook het stuk dat net onderweg is). */
  get wachtSeconden() { return this._inRij / SR; }

  /**
   * Hoe het wegschrijven ervoor staat, voor één melding die meegroeit:
   *   { storing: true, wacht, verloren, fout }   de server antwoordt niet, `wacht` s in de rij
   *   { storing: false, goed, verloren }          voorbij: `goed` = de rij liep leeg doordat het weer lukte
   * `verloren` = seconden die in DEZE storing kwijt zijn (stilte op hun plek).
   */
  stand() {
    const s = this.storing;
    return s ? { storing: true, wacht: this.wachtSeconden, verloren: s.verloren, fout: s.fout }
      : { storing: false, goed: this._laatsteGoed !== false, verloren: this._laatsteVerloren ?? 0 };
  }

  _meldStand() { try { this.onStand?.(this.stand()); } catch (err) { console.warn('[opname] onStand:', err); } }

  /** Mag een stuk nog opnieuw proberen? Zolang de opname loopt, of tot de grens na stop. */
  _magNog() { return this._doorTot === null || this.nu() < this._doorTot; }
  /** Voorbij de grens, en de laatste poging liep op een time-out: niet eens meer proberen. */
  _opgeven() { return !!this.storing && this._t.hangt && !this._magNog(); }

  /** Eén verzoek, herhaald zolang de server niet antwoordt en `mag()` ja zegt (src/lib/herhaal.js). */
  _herhaal(doe, mag, bijWeg) { return herhaal({ doe, mag, wacht: this.wacht, t: this._t, bijWeg }); }

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
    this._inRij = 0; this._doorTot = null; this._t = nieuweToestand();
    this.storing = null; this.verloren = 0; this._laatsteGoed = undefined; this._laatsteVerloren = 0;
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
    this._videoInRij = 0;                   // stukken (~1 s elk) die nog niet bevestigd zijn
    let van = 0;                            // de plek van het volgende stuk in het videobestand
    const id = this.id;
    rec.ondataavailable = ({ data }) => {
      if (!data?.size) return;
      // Elk stuk krijgt zijn plek NU (`?van=`, in bytes), zoals de WAV zijn frame:
      // herhalen na een verloren antwoord schrijft dan dezelfde bytes op dezelfde plek.
      const plek = van;
      van += data.size;
      this._videoInRij++;
      // Ook hier strikt op volgorde: een videobestand met stukken door elkaar is kapot.
      this._videoRij = this._videoRij.then(async () => {
        try {
          if (this._opgeven()) throw new Error(this.storing.fout);   // na de grens bij stoppen, de server hangt
          const body = await data.arrayBuffer();
          // Wacht zolang de server weg is, zoals de audio; is de rij vol, dan valt het oudste stuk weg.
          const r = await this._herhaal(() => this.haal(`/api/opname/${id}/video.${ext}?van=${plek}`, {
            method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body, signal: tijdslot(),
          }), () => this._magNog() && this._videoInRij <= this.rijSeconden);
          if (!r.ok) throw new Error(r.fout);
          await leesWeg(r.res);             // ook gelukt: een ongelezen antwoord blijft in Chrome hangen (WINST.md punt 1)
          this.videoBytes += data.size;
        } catch (err) {
          this.fout = `videostuk kwijt: ${err.message}`;
          this.onFout?.(this.fout);
          console.warn('[opname]', this.fout);
        } finally {
          this._videoInRij--;
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
   *
   * Antwoordt de server niet, dan wacht het stuk (en alles erachter) en wordt
   * het opnieuw geprobeerd zolang de opname loopt en de rij niet langer is
   * dan `rijSeconden`. Wordt hij te lang, dan valt het OUDSTE stuk weg (het
   * stuk dat nu wacht): de rij blijft begrensd, en wat de server straks wel
   * krijgt is het meest recente.
   */
  _verstuur(data, frames) {
    const frame = this.frames;
    this.frames += frames;
    this._inRij += frames;
    const id = this.id;
    this._rij = this._rij.then(async () => {
      try {
        await this._stuurStuk(id, frame, frames, data);
      } finally {
        this._inRij -= frames;
        // De rij is leeg: een storing is voorbij (weer goed, of alles na de grens opgegeven).
        if (this.storing && this._inRij <= 0) {
          this._laatsteVerloren = this.storing.verloren;
          this.storing = null;
          this._meldStand();
        }
      }
    });
  }

  async _stuurStuk(id, frame, frames, data) {
    // Na de grens bij stoppen, terwijl de server HANGT: niet meer proberen, anders kost
    // elk stuk een time-out (300 stukken × 10 s). Een server die weigert is snel: één poging.
    const r = this._opgeven() ? { ok: false, fout: this.storing.fout, weg: true } : await this._herhaal(
      () => this.haal(`/api/opname/${id}/stuk?frame=${frame}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data, signal: tijdslot(),
      }),
      () => this._magNog() && this._inRij <= this.rijSeconden * SR,
      (fout) => {
        // Eén melding die meegroeit: de eerste mislukte poging begint de storing, elke volgende werkt hem bij.
        if (!this.storing) this.storing = { fout, verloren: 0 };
        this.storing.fout = fout;
        this._meldStand();
      });
    if (r.ok) {
      // Ook het antwoord van een gelukt stuk lezen: Chrome houdt een ongelezen
      // antwoord vast, ~400 kB per stuk, dus ~23 MB per minuut opnemen (WINST.md punt 1).
      await leesWeg(r.res);
      this.bytes += data.byteLength;
      this._laatsteGoed = true;
      return;
    }
    const sec = frames / SR;
    this.verloren += sec;
    this._laatsteGoed = false;
    // Weg zonder één keer te wachten (de rij was al vol): ook dat hoort bij de storing.
    if (r.weg && !this.storing) this.storing = { fout: r.fout, verloren: 0 };
    if (this.storing) { this.storing.verloren += sec; this.storing.fout = r.fout; }
    const totaal = this.verloren > sec + 1e-9 ? ` — in totaal ${Math.round(this.verloren)} s stilte` : '';
    this.fout = `stuk kwijt (${(frame / SR).toFixed(0)} s, wordt stilte): ${r.fout}${totaal}`;
    this.onFout?.(this.fout);
    console.warn('[opname]', this.fout);
    if (this.storing) this._meldStand();
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
    // Vanaf nu een grens: wat nog in de rij staat (de server was weg) krijgt
    // stopGrens om binnen te komen, daarna geldt "gat = stilte".
    this._doorTot = this.nu() + this.stopGrens;
    try { this.onEind?.(id); } catch (err) { console.warn('[opname] onEind:', err); }
    await this._stopVideo();
    await this._rij;                       // alles wat onderweg was, eerst binnen
    try {
      // Het aantal frames erbij: viel het laatste stuk weg, dan vult de server
      // de staart met stilte en is de WAV even lang als de opname. Antwoordt de
      // server even niet, dan nog een paar seconden opnieuw (het bestand staat er
      // toch al; zonder "klaar" herstelt de server de kop bij de volgende start).
      const klaarTot = Math.max(this._doorTot, this.nu()) + 5000;
      const r = await this._herhaal(() => this.haal(`/api/opname/${id}/klaar?frames=${this.frames}`, { method: 'POST', signal: tijdslot() }),
        () => this.nu() < klaarTot);
      if (!r.ok && r.weg) throw new Error(r.fout);
      const j = r.ok ? await r.res.json() : { ok: false, fout: r.fout };
      if (!j.ok) return this._mislukt(j.fout);
      const waarschuwing = [this.fout, j.waarschuwing].filter(Boolean).join(' — ') || null;
      return { ok: true, bestand: j.bestand, duur: j.duur, bytes: j.bytes, video: j.video ?? null, videoBytes: j.videoBytes ?? 0, waarschuwing };
    } catch (err) {
      return this._mislukt(`afsluiten mislukt: ${err.message} — het bestand staat er wel, de kop wordt bij de volgende start hersteld`);
    }
  }

  _mislukt(fout) { this.fout = fout; return { ok: false, fout }; }
}
