/**
 * Lees het antwoord van een fetch weg, ook als je er niets mee doet.
 *
 * Chrome houdt een antwoord dat niemand leest vast (docs/WINST.md punt 1):
 * een opname die elke seconde een stuk POST groeide zo ~23 MB per minuut, en
 * een garbage collection haalde dat niet terug. Elke fetch op een hot pad leest
 * daarom zijn antwoord, ook op het succespad. `json()` en niet
 * `body.cancel()`: de nep-fetches van de tests kennen alleen `json()`.
 *
 * Gooit nooit en wacht hooguit op de body: een antwoord dat geen JSON is, of
 * een nep-antwoord zonder `json`, telt gewoon als gelezen.
 * @param {Response|object|null|undefined} res
 * @returns {Promise<void>}
 */
export function leesWeg(res) {
  try {
    return Promise.resolve(res?.json?.()).then(() => {}, () => {});
  } catch (_) {
    return Promise.resolve();
  }
}
