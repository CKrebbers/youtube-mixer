import { parentPort, workerData } from 'node:worker_threads';
import { hier } from './analyze.js';

/**
 * Draait één analyse-opdracht buiten de hoofdthread en meldt het resultaat.
 * Zie `inWerker` in analyze.js voor het waarom. Gooit nooit: een fout is een
 * resultaat, net als in de rest van de ingest.
 */
const { taak, args } = workerData;
let r;
try {
  r = hier[taak] ? await hier[taak](...args) : { ok: false, fout: `onbekende analyse: ${taak}` };
} catch (err) {
  r = { ok: false, fout: String(err?.message || err) };
}
parentPort.postMessage(r);
