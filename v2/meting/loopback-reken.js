/**
 * Het rekenwerk van de loopback (M2), puur en in Node te toetsen (loopback.test.mjs).
 *
 * Invoer: een opname van de ingang (Float32), de audiokloktijd van de eerste sample van die
 * opname, de audiokloktijden waarop de klikken gepland waren, en paren uit
 * getOutputTimestamp ({ contextTime, performanceTime }).
 * Uitvoer per klik: hoeveel ms na zijn geplande audiokloktijd hij in de opname staat (de
 * rondgang: uitgang + kabel + ingang). Dan:
 *  - rondgang: mediaan en spreiding (moet stabiel zijn: spreiding ≤ 1 ms)
 *  - wat de app zelf als uitgangsvertraging rekent (outputLatency + baseLatency), en wat
 *    getOutputTimestamp zegt: zit de echte uitgang daartussen, dan klopt "wat je hoort".
 * De ingang heeft ook een vertraging (die meet je niet los): de rondgang is dus een
 * BOVENGRENS voor de uitgang. Een lampje op het scherm dat op de klok knippert, loopt
 * hooguit (rondgang − ingangsvertraging − wat de app aftrekt) naast de klik.
 */

/** Aanzetten in een opname: eerste sample boven de drempel na minstens `stil` s onder de helft ervan. */
export function aanzetten(x, sr, { drempel = null, stil = 0.1 } = {}) {
  let piek = 0;
  for (let i = 0; i < x.length; i++) piek = Math.max(piek, Math.abs(x[i]));
  const d = drempel ?? piek * 0.3;
  const uit = [];
  // Gewapend na `stil` s onder de halve drempel (de aanloop van een klik telt niet als onrust).
  const rust = Math.round(stil * sr);
  let rustig = rust, gewapend = true;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a < d / 2) { if (++rustig >= rust) gewapend = true; } else rustig = 0;
    if (gewapend && a > d) {
      // Subsample: lineair tussen de vorige en deze sample op de drempel.
      const v = Math.abs(x[i - 1] ?? 0);
      const frac = a === v ? 0 : (d - v) / (a - v);
      uit.push((i - 1 + frac) / sr);
      gewapend = false;
    }
  }
  return uit;
}

const mediaan = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

export function analyseer({ opname, opnameStart, sr, tellen, stempels = [], outputLatency = 0, baseLatency = 0 }) {
  const gevonden = aanzetten(opname, sr).map((t) => t + opnameStart);
  // Elke geplande klik koppelen aan de eerste aanzet erna (binnen 200 ms).
  const rond = [];
  for (const t of tellen) {
    const a = gevonden.find((g) => g >= t && g - t < 0.2);
    if (a !== undefined) rond.push((a - t) * 1000);
  }
  if (rond.length < tellen.length * 0.8) {
    return { geslaagd: false, reden: `maar ${rond.length} van ${tellen.length} klikken teruggevonden: kabel, gain of ingang?`, klikken: tellen.length, gevonden: rond.length };
  }
  const m = mediaan(rond);
  const spreiding = mediaan(rond.map((x) => Math.abs(x - m))) * 1.4826;   // robuust (MAD)
  // getOutputTimestamp: hoe ver loopt contextTime achter op de wandklok (de uitgangsvertraging volgens Chrome).
  let tsVertraging = null;
  if (stempels.length >= 2) {
    const verschil = stempels.slice(1).map((s) => s.performanceTime / 1000 - s.contextTime);
    tsVertraging = { spreidingMs: (Math.max(...verschil) - Math.min(...verschil)) * 1000 };
  }
  const appRekent = (outputLatency + baseLatency) * 1000;
  const geslaagd = spreiding <= 1 && m - appRekent <= 16.7 && m - appRekent >= -2;
  return {
    geslaagd,
    reden: geslaagd ? null : spreiding > 1 ? `rondgang niet stabiel (spreiding ${spreiding.toFixed(2)} ms)` : `de app rekent ${appRekent.toFixed(1)} ms, de rondgang is ${m.toFixed(1)} ms`,
    klikken: tellen.length, gevonden: rond.length,
    rondgangMs: { mediaan: +m.toFixed(2), spreiding: +spreiding.toFixed(3), min: +Math.min(...rond).toFixed(2), max: +Math.max(...rond).toFixed(2) },
    appRekentMs: +appRekent.toFixed(2),
    restMs: +(m - appRekent).toFixed(2),
    uitleg: 'restMs = rondgang min wat de app als uitgangsvertraging aftrekt = de ingangsvertraging plus wat de app mist. Grens M2: 0 … 16,7 ms (één beeld), spreiding ≤ 1 ms.',
    outputTimestamp: tsVertraging,
  };
}
