/**
 * Wat de herstartlus (tools/varve-app/server-lus.sh) deze server meegaf over zijn herstarts (AR9, 16 okt), voor
 * GET /api/leeft en daarmee de tegel Server in de Controlekamer. Puur: alleen de omgeving lezen, geen schijf.
 *
 *   VARVE_LUS_SINDS      de start van de lus, in s sinds 1970 (ontbreekt = niet onder de lus gestart)
 *   VARVE_LUS_AANTAL     hoe vaak de lus sindsdien herstartte
 *   VARVE_LUS_HERSTARTS  de laatste 20: "<s>:<exitcode>:om|hang", gescheiden door spaties (oudste eerst)
 *
 * @returns {{ onder: boolean, sinds: number|null, aantal: number, herstarts: Array<{ t: number, code: number, hang: boolean }> }}
 *   tijden in ms sinds 1970; wat niet te lezen is, valt weg (nooit een NaN in de tegel).
 */
export function leesLus(env = process.env) {
  const sinds = Number(env.VARVE_LUS_SINDS);
  if (!env.VARVE_LUS_SINDS || !Number.isInteger(sinds) || sinds <= 0) return { onder: false, sinds: null, aantal: 0, herstarts: [] };
  const herstarts = [];
  for (const deel of String(env.VARVE_LUS_HERSTARTS || '').trim().split(/\s+/)) {
    const m = /^(\d+):(\d+):(om|hang)$/.exec(deel);
    if (m) herstarts.push({ t: Number(m[1]) * 1000, code: Number(m[2]), hang: m[3] === 'hang' });
  }
  const aantal = Number(env.VARVE_LUS_AANTAL);
  return { onder: true, sinds: sinds * 1000, aantal: Number.isInteger(aantal) && aantal >= herstarts.length ? aantal : herstarts.length, herstarts };
}
