/**
 * De zaal als meespeler (Clay, 30 okt: "een samenwerking tussen mij, mn instrumenten, de mensen, de plek").
 * Camera en microfoon van de laptop meten twee getallen, 0..1:
 *   zaal.beweging   hoeveel er in beeld beweegt (een klein beeld van 32 × 24, verschil met het vorige)
 *   zaal.geluid     hoeveel geluid de microfoon hoort (rms)
 * Allebei ijken ze zich langzaam op de ruimte (een lopend maximum dat in een minuut wegzakt): een drukke zaal
 * is pas "veel" als hij drukker is dan net. Beeld en geluid zelf worden NERGENS bewaard of verstuurd: alleen de
 * twee getallen gaan op de bus. Pas aan als je de zaal laat meespelen (zaal.mee); Chrome vraagt dan toestemming.
 * De engine (acties-opstelling.js) laat ze dichtheid en beweging een stukje meeduwen.
 */

const KLEIN_B = 32, KLEIN_H = 24;
const META = { log: 'overslaan', beginstand: false };

export function opzetZaal({ engine, bus, nav = globalThis.navigator, doc = globalThis.document }) {
  const stand = { beweging: null, geluid: null, aan: false, fout: null };
  let maxB = 0.02, maxG = 0.01, vorige = null, analyser = null, buf = null, timer = null;
  const def = (id, sleutel, label) => bus.defineer({ id, soort: 'waarde', label, meta: META, doe: () => undefined, lees: () => stand[sleutel] });
  def('zaal.beweging', 'beweging', 'de zaal: beweging (camera)');
  def('zaal.geluid', 'geluid', 'de zaal: geluid (microfoon)');

  async function start() {
    if (stand.aan || !nav?.mediaDevices?.getUserMedia) return;
    stand.aan = true;
    let media;
    try { media = await nav.mediaDevices.getUserMedia({ video: { width: 160, height: 120 }, audio: { echoCancellation: false, noiseSuppression: false } }); } catch (e) {
      // Zonder camera of zonder toestemming: dan alleen wat wel lukt (of niets), en het systeem speelt gewoon door.
      try { media = await nav.mediaDevices.getUserMedia({ audio: true }); } catch { media = null; }
      stand.fout = e?.name ?? 'geen toegang';
    }
    if (!media) { stand.aan = false; engine.meld?.(`de zaal: geen camera of microfoon (${stand.fout})`, 'fout', 'zaal'); return; }
    const vid = media.getVideoTracks().length ? Object.assign(doc.createElement('video'), { muted: true, playsInline: true, srcObject: media }) : null;
    if (vid) await vid.play().catch(() => {});
    const cv = Object.assign(doc.createElement('canvas'), { width: KLEIN_B, height: KLEIN_H });
    const g = cv.getContext('2d', { willReadFrequently: true });
    if (media.getAudioTracks().length && engine.ctx?.createMediaStreamSource) {
      const bron = engine.ctx.createMediaStreamSource(media);
      analyser = engine.ctx.createAnalyser();
      analyser.fftSize = 1024;
      buf = new Float32Array(analyser.fftSize);
      bron.connect(analyser);   // niet naar de uitgang: alleen meten
    }
    timer = setInterval(() => {
      if (vid && vid.readyState >= 2) {
        g.drawImage(vid, 0, 0, KLEIN_B, KLEIN_H);
        const px = g.getImageData(0, 0, KLEIN_B, KLEIN_H).data;
        if (vorige) {
          let s = 0;
          for (let i = 0; i < px.length; i += 4) s += Math.abs(px[i] + px[i + 1] + px[i + 2] - vorige[i] - vorige[i + 1] - vorige[i + 2]);
          const ruw = s / (KLEIN_B * KLEIN_H * 765);
          maxB = Math.max(ruw, maxB * 0.9985);
          stand.beweging = 0.8 * (stand.beweging ?? 0) + 0.2 * Math.min(1, ruw / Math.max(0.01, maxB));
        }
        vorige = px.slice();
      }
      if (analyser) {
        analyser.getFloatTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        const rms = Math.sqrt(s / buf.length);
        maxG = Math.max(rms, maxG * 0.9985);
        stand.geluid = 0.85 * (stand.geluid ?? 0) + 0.15 * Math.min(1, rms / Math.max(0.005, maxG));
      }
    }, 100);
    engine.meld?.('de zaal: camera en microfoon meten mee (alleen twee getallen, niets wordt bewaard)', 'info', 'zaal');
  }

  // Zodra je de zaal laat meespelen, gaat hij luisteren en kijken.
  bus.on('actie', (a) => { if (a.id === 'zaal.mee' && a.v === true && !stand.aan) start(); });
  return { start, stand: () => ({ ...stand }), stop() { if (timer) clearInterval(timer); } };
}
