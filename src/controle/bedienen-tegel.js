/**
 * De Controlekamer: "Bedienen vanaf iPad en iPhone" (werkruimte S8, Clay 14 okt W1 = ja;
 * docs/werkruimte/S8.md). Een eigen blok onder "Openen":
 *   - de schakelaar (aan/uit; aanzetten met twee klikken). Uit = de iPad en iPhone krijgen 404 en de mixer
 *     laat alles los wat ze vasthielden. Na een herstart van de server staat hij uit;
 *   - "koppelcode": zes cijfers, 60 s geldig, één keer. Typ hem op de iPad of iPhone (werk.html?s=…);
 *   - de gekoppelde apparaten (naam, scherm, laatst gezien) met "intrekken" (twee klikken);
 *   - of de mixer luistert, en hoe snel hij antwoordt (p50/p99 van server -> mixer -> server).
 * Alles via /api/paneel/schrijf*: alleen vanaf deze Mac (de server zegt anders 403, en dan zegt dit
 * blok dat). `blokHtml(stand)` is puur (de test toetst de tekst); `opzetBedienen()` doet de DOM.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sinds = (ms, nu = Date.now()) => {
  if (!ms) return 'nooit';
  const s = Math.max(0, Math.round((nu - ms) / 1000));
  return s < 90 ? `${s} s geleden` : s < 5400 ? `${Math.round(s / 60)} min geleden` : new Date(ms).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** De inhoud van het blok als HTML, uit het antwoord van GET /api/paneel/schrijf (of { fout }). Puur. */
export function blokHtml(s, { nu = Date.now() } = {}) {
  if (!s) return '<p class="uitleg">…</p>';
  if (s.fout) return `<p class="uitleg">${esc(s.fout)}</p>`;
  const regels = [];
  regels.push(`<p class="bd-stand ${s.aan ? 'aan' : 'uit'}"><b>${s.aan ? 'AAN' : 'UIT'}</b> · ${s.aan
    ? `de mixer ${s.mixer ? 'luistert' : 'luistert nog niet (kies een werkruimte in de mixer, niet "standaard")'}${s.vast ? ` · ${s.vast} vastgehouden` : ''}`
    : 'iPad en iPhone kijken alleen (hun knoppen sturen niets)'}</p>`);
  if (s.aan && s.code) regels.push(`<p class="bd-code">code <b>${esc(s.code.code)}</b> <span class="uitleg">nog ${Math.ceil(s.code.nog_ms / 1000)} s</span></p>`);
  const ap = s.apparaten ?? [];
  regels.push(ap.length
    ? `<ul class="bd-apparaten">${ap.map((a) => `<li><b>${esc(a.naam)}</b> · scherm ${esc(a.scherm)} · ${esc(sinds(a.laatst, nu))} <button class="knop klein bd-in" data-id="${esc(a.id)}">intrekken</button></li>`).join('')}</ul>`
    : '<p class="uitleg">nog geen apparaat gekoppeld</p>');
  const st = s.stats ?? {};
  if (st.doorgestuurd) regels.push(`<p class="uitleg">${st.doorgestuurd} uitgevoerd of gevraagd · ${st.geweigerd ?? 0} geweigerd · ${st.te_snel ?? 0} te snel · ${st.los ?? 0} keer losgelaten${st.mixer_p50 != null ? ` · de mixer antwoordt in ${st.mixer_p50} ms (p99 ${st.mixer_p99} ms)` : ''}</p>`);
  return regels.join('');
}

/** Het blok in de Controlekamer, na `na` (een element). Peilt elke 2 s zolang de pagina zichtbaar is. */
export function opzetBedienen({ na, meld = () => {} } = {}) {
  const blok = document.createElement('section');
  blok.className = 'blok bd-blok';
  blok.setAttribute('aria-labelledby', 'h-bedienen');
  blok.innerHTML = `<h2 id="h-bedienen">Bedienen vanaf iPad en iPhone</h2>
    <div class="bd-knoppen"><button class="knop" id="bd-aan">aan</button> <button class="knop" id="bd-code" disabled>koppelcode</button></div>
    <div id="bd-inhoud"></div>
    <p class="uitleg">Alleen via Tailscale (docs/TAILSCALE.md), nooit publiek. Op de iPad of iPhone: <code>https://&lt;naam&gt;/werk.html?s=ipad</code> (of <code>?s=iphone</code>),
      dan de code typen. Wat een scherm mag, staat in de werkruimte (<code>schermen.&lt;s&gt;.mag</code>) en in de panelen van dat scherm in het deel van nu;
      opnemen, het log, mappings, werkruimtes, de library en laden nooit. Valt een apparaat weg, dan laat de mixer binnen 1,5 s los wat het vasthield.</p>`;
  (na?.after ? na.after(blok) : document.body.append(blok));
  const $ = (id) => blok.querySelector(`#${id}`);
  let stand = null, aanVraag = null, bezig = false;

  async function lees() {
    if (bezig) return;
    bezig = true;
    try {
      const r = await fetch('/api/paneel/schrijf', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const d = await r.json().catch(() => null);
      stand = r.status === 403 ? { fout: 'alleen op deze Mac: open de Controlekamer op localhost om bedienen aan te zetten' }
        : r.status === 404 ? { fout: 'deze server kent bedienen nog niet (herstart de server)' } : (d ?? { fout: `fout ${r.status}` });
    } catch (_) { stand = { fout: 'de server antwoordt niet' }; } finally { bezig = false; }
    teken();
  }
  function teken() {
    $('bd-inhoud').innerHTML = blokHtml(stand);
    const aan = !!stand?.aan;
    $('bd-aan').textContent = aanVraag ? 'zeker? klik nog eens' : aan ? 'uit' : 'aan';
    $('bd-aan').classList.toggle('let-op', !!aanVraag);
    $('bd-aan').disabled = !!stand?.fout;
    $('bd-code').disabled = !aan;
  }
  async function post(pad, body = {}) {
    const r = await fetch(pad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.fout || `${r.status}`);
    return d;
  }
  $('bd-aan').addEventListener('click', async () => {
    const aan = !!stand?.aan;
    // Aanzetten opent de eerste schrijfweg van buiten de Mac: twee klikken. Uitzetten meteen.
    if (!aan && !aanVraag) { aanVraag = setTimeout(() => { aanVraag = null; teken(); }, 4000); teken(); return; }
    clearTimeout(aanVraag); aanVraag = null;
    try { stand = await post('/api/paneel/schrijf', { aan: !aan }); meld(aan ? 'bedienen uit: iPad en iPhone kijken weer' : 'bedienen aan: koppel een apparaat met een code'); } catch (err) { meld(`bedienen: ${err.message}`, 'fout'); }
    teken();
  });
  $('bd-code').addEventListener('click', async () => {
    try { await post('/api/paneel/schrijf/code'); } catch (err) { meld(`koppelcode: ${err.message}`, 'fout'); }
    lees();
  });
  let intrek = null;
  blok.addEventListener('click', async (e) => {
    const b = e.target.closest?.('.bd-in');
    if (!b) return;
    if (intrek !== b.dataset.id) { intrek = b.dataset.id; b.textContent = 'zeker?'; b.classList.add('let-op'); setTimeout(() => { if (intrek === b.dataset.id) intrek = null; }, 4000); return; }
    intrek = null;
    const r = await fetch(`/api/paneel/schrijf/apparaat/${encodeURIComponent(b.dataset.id)}`, { method: 'DELETE' });
    await r.json().catch(() => null);
    meld(r.ok ? 'ingetrokken: dat apparaat kan niets meer sturen' : `intrekken mislukt (${r.status})`, r.ok ? '' : 'fout');
    lees();
  });
  lees();
  setInterval(() => { if (document.visibilityState === 'visible') lees(); }, 2000);
  return { lees, get stand() { return stand; } };
}
