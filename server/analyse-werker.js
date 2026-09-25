import { parentPort, workerData } from 'node:worker_threads';
import { hier, stopAnalyse } from './analyze.js';

/**
 * Draait één analyse-opdracht buiten de hoofdthread en meldt het resultaat.
 * Zie `inWerker` in analyze.js voor het waarom. Gooit nooit: een fout is een
 * resultaat, net als in de rest van de ingest.
 *
 * 'stop' (een geannuleerde ingest): eerst de eigen ffmpeg's weg en
 * binnengehaald, dan pas de thread uit. Andersom bleven ze als zombie onder
 * de server staan — alleen de lus van DEZE thread roept waitpid voor ze aan.
 */
const { taak, args } = workerData;
const opStop = async (m) => {
  if (m !== 'stop') return;
  await stopAnalyse();
  process.exit(0);
};
parentPort.on('message', opStop);

let r;
try {
  r = hier[taak] ? await hier[taak](...args) : { ok: false, fout: `onbekende analyse: ${taak}` };
} catch (err) {
  r = { ok: false, fout: String(err?.message || err) };
}
parentPort.postMessage(r);
// Zonder luisteraar houdt de poort de thread niet meer open: hij stopt vanzelf.
parentPort.off('message', opStop);
