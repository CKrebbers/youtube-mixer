import { esc } from './dom.js';

/**
 * De ingest-strook in het library-paneel: wat er binnengehaald wordt, wat er
 * wacht, hoe ver het is, en wat al af is. Met annuleren (×), wegklikken, en
 * voor een nummer dat binnen is (of al binnen was) meteen de laadknoppen.
 *
 * Praat alleen met de server (/api/ingest, /api/upload). Laden op een track
 * is een callback van het paneel, net als in de lijst eronder. De pure
 * stukken (splitsLinks, zichtbaar, stappenStand) staan los, voor de test.
 */

/** Hoe de stappen van de server op het scherm heten. */
export const STAP_NAMEN = {
  upload: 'upload', wachten: 'wacht', metadata: 'gegevens', audio: 'download', meten: 'meten',
  normaliseren: 'normaliseren', peaks: 'golfvorm', onset: 'ritme', grid: 'grid', video: 'video',
  stoppen: 'stoppen', klaar: 'klaar', mislukt: 'mislukt', geannuleerd: 'geannuleerd',
};

/** Hoe lang een afgelopen opdracht blijft staan (ms). Mislukt: tot je hem wegklikt. */
export const BLIJFT = { klaar: 20000, bestond: 30000, geannuleerd: 8000 };

/**
 * De links uit geplakte tekst: alles wat met http(s):// begint, gescheiden
 * door witruimte (regels, spaties, tabs). Haakjes en aanhalingstekens eromheen
 * en een komma of puntkomma erachter gaan eraf. Dubbele eruit, volgorde blijft.
 */
export function splitsLinks(tekst) {
  const uit = [];
  for (const stuk of String(tekst ?? '').split(/\s+/)) {
    const t = stuk.replace(/^[<("'[]+/, '').replace(/[>)"'\],;]+$/, '');
    if (/^https?:\/\/\S/i.test(t) && !uit.includes(t)) uit.push(t);
  }
  return uit;
}

/**
 * Wat de strook toont, in welke volgorde: wat loopt, dan wat wacht (op plek),
 * dan wat af is (nieuwste eerst). Afgelopen opdrachten blijven even staan
 * (BLIJFT); een mislukte tot je hem wegklikt.
 */
export function zichtbaar(opdrachten, nu = Date.now()) {
  const rang = { bezig: 0, wacht: 1 };
  return opdrachten.filter((o) => {
    if (o.status === 'bezig' || o.status === 'wacht' || o.status === 'mislukt') return true;
    const duur = o.bestond ? BLIJFT.bestond : (BLIJFT[o.status] ?? 0);
    return nu - (o.klaar || 0) < duur;
  }).sort((a, b) => ((rang[a.status] ?? 2) - (rang[b.status] ?? 2))
    || (a.status === 'wacht' ? (a.plek ?? 0) - (b.plek ?? 0) : (b.klaar || b.begonnen || 0) - (a.klaar || a.begonnen || 0)));
}

/** Per stap van een opdracht: 'gedaan', 'nu' of 'straks' (de streepjes in de strook). */
export function stappenStand(o) {
  const stappen = Array.isArray(o.stappen) ? o.stappen : [];
  const i = stappen.indexOf(o.stap);
  return stappen.map((stap, k) => ({
    stap, naam: STAP_NAMEN[stap] || stap,
    stand: o.status === 'klaar' || (i >= 0 && k < i) ? 'gedaan' : (k === i && o.status === 'bezig' ? 'nu' : 'straks'),
  }));
}

/** Een link kort genoeg voor één regel: zonder https://www. */
const kortUrl = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/i, '');

/** Wat er onder de titel staat, per toestand. */
function onderschrift(o) {
  if (o.status === 'wacht') return 'in de wachtrij';
  if (o.status === 'bezig') return o.tekst || '';
  if (o.status === 'klaar') {
    if (o.bestond) return 'staat al in de library';
    return o.track?.videoFout ? `klaar, zonder video: ${o.track.videoFout}` : 'klaar';
  }
  if (o.status === 'mislukt') return o.fout || 'mislukt';
  return 'geannuleerd';
}

export class IngestStrook {
  /**
   * @param opties.el        de container (.lib-jobs)
   * @param opties.url       het invoerveld; @param opties.haal de knop "haal binnen"
   * @param opties.decks     deck-id's; label(deck) = tracknummer; stand(deck) = 'leeg'|'geladen'|'speelt'
   * @param opties.open      () => staat het paneel open (dan pollen)
   * @param opties.meld      (tekst, goed) => de statusregel van het paneel
   * @param opties.bevestigd (soort, sleutel) => tweede klik binnen 3 s?
   * @param opties.laad      (track, deck) => laden, na een klik op een laadknop in de strook
   * @param opties.laadNaIngest (track, deck) => een op een track gesleept bestand is binnen
   * @param opties.onNieuw   () => er staat een nieuw nummer in de library (lijst verversen)
   */
  constructor({ el, url, haal, decks = [], label = (d) => d, stand = () => 'leeg', open = () => true,
    meld = () => {}, bevestigd = () => true, laad = () => {}, laadNaIngest = () => {}, onNieuw = () => {} }) {
    Object.assign(this, { el, url, haal, decks, label, stand, isOpen: open, meld, bevestigd, laad, laadNaIngest, onNieuw });
    this.opdrachten = [];        // zoals de server ze geeft
    this.uploads = [];           // { sleutel, naam, pct, status: 'wacht'|'bezig', xhr, file, naDeck, gestopt }
    this.naLaden = new Map();    // opdracht-id -> deck (een bestand op een track gesleept)
    this.gezienKlaar = new Set();
    this.opnieuw = null;         // { link, tot }: nog eens "haal binnen" = opnieuw binnenhalen
    this.weg = new Set();        // lokaal weggeklikt, tot de server het ook zegt

    if (this.url) {
      this.url.placeholder = 'plak één of meer links (YouTube, TikTok, …) en druk op enter…';
      this.url.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.haalBinnen(); });
      this.url.addEventListener('paste', (e) => this._plak(e));
    }
    this.haal?.addEventListener('click', () => this.haalBinnen());
    this.el.addEventListener('click', (e) => this._klik(e));
    /*
     * Niet hertekenen terwijl je in de strook drukt. Een knop die tussen
     * indrukken en loslaten vervangen wordt, krijgt geen klik (gemeten in
     * Chrome) — en de strook tekent bij elke poll (1,2 s) en bij elk stukje
     * uploadvoortgang opnieuw. Na het loslaten (en dus na de klik) alsnog.
     */
    this._vast = false;
    this._later = false;
    this.el.addEventListener('pointerdown', () => { this._vast = true; });
    const los = () => {
      if (!this._vast) return;
      this._vast = false;
      if (this._later) { this._later = false; setTimeout(() => this.teken(), 0); }
    };
    globalThis.addEventListener?.('pointerup', los, true);
    globalThis.addEventListener?.('pointercancel', los, true);
    globalThis.addEventListener?.('blur', los);
    this.teken();
    this.poll();
    setInterval(() => this._tik(), 1200);
  }

  /**
   * Plakken van meerdere regels. Een <input> gooit regeleinden weg, en dan
   * plakt Chrome drie links aan elkaar tot één onzin-link. Dus: zelf de links
   * eruit halen en met spaties in het veld zetten; enter stuurt ze allemaal.
   */
  _plak(e) {
    const tekst = e.clipboardData?.getData('text') ?? '';
    const links = splitsLinks(tekst);
    if (links.length < 2 && !/[\r\n]/.test(tekst.trim())) return;
    e.preventDefault();
    const al = splitsLinks(this.url.value);
    const alles = [...al, ...links.filter((l) => !al.includes(l))];
    this.url.value = alles.join(' ');
    this.meld(alles.length > 1 ? `${alles.length} links — enter zet ze allemaal in de wachtrij, één voor één` : 'één link gevonden in wat je plakte', true);
  }

  /** Wat in het veld staat naar de server: één link, of een lijst. */
  async haalBinnen() {
    const tekst = this.url.value.trim();
    if (!tekst) return;
    const links = splitsLinks(tekst);
    const een = links.length <= 1;
    const link = links[0] ?? tekst;
    // Stond hij net al in de library en klik je binnen 3 s nog eens: opnieuw binnenhalen.
    const opnieuw = een && this.opnieuw?.link === link && Date.now() < this.opnieuw.tot;
    this.opnieuw = null;
    if (this.haal) this.haal.disabled = true;
    try {
      const r = await fetch('/api/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(een ? { url: link, ...(opnieuw ? { opnieuw: true } : {}) } : { urls: links }),
      });
      const j = await r.json();
      if (!een && !r.ok) this.meld(j.fout || 'kon de links niet in de wachtrij zetten', false);
      else this._uitkomst(een ? [{ code: r.status, ...j, url: j.url ?? link }] : (j.resultaten || []), { een, link, opnieuw });
    } catch (err) {
      this.meld(`server niet bereikbaar: ${err.message}`, false);
    }
    if (this.haal) this.haal.disabled = false;
    this.poll();
  }

  /** Wat de server van de links vond, in één melding; geweigerde links blijven in het veld. */
  _uitkomst(uitkomsten, { een, link, opnieuw }) {
    const geweigerd = uitkomsten.filter((u) => u.code >= 400);
    const nieuw = uitkomsten.filter((u) => u.code === 202);
    const dubbel = uitkomsten.filter((u) => u.dubbel);
    const bestond = uitkomsten.filter((u) => u.bestond);
    this.url.value = geweigerd.map((u) => u.url).filter(Boolean).join(' ');
    if (een) {
      const u = uitkomsten[0] ?? {};
      if (u.code >= 400) return this.meld(u.fout || 'kon hem niet in de wachtrij zetten', false);
      if (u.dubbel) return this.meld('die staat al in de wachtrij', true);
      if (u.bestond) {
        this.opnieuw = { link, tot: Date.now() + 3000 };
        return this.meld(`"${u.track?.titel ?? link}" staat al in de library — laad hem in de strook hieronder, `
          + 'of klik binnen 3 s nog eens op haal binnen om hem opnieuw binnen te halen', true);
      }
      const waar = u.status === 'wacht' ? `in de wachtrij (plek ${u.plek})` : 'binnenhalen gestart';
      return this.meld(`${opnieuw ? 'opnieuw ' : ''}${waar}${u.lijstEraf ? ' — alleen dit nummer, niet de playlist' : ''}`, true);
    }
    const delen = [];
    if (nieuw.length) delen.push(`${nieuw.length} in de wachtrij`);
    if (dubbel.length) delen.push(`${dubbel.length} stond${dubbel.length === 1 ? '' : 'en'} er al in`);
    if (bestond.length) delen.push(`${bestond.length} al in de library`);
    if (geweigerd.length) delen.push(`${geweigerd.length} geweigerd, staan nog in het veld: ${geweigerd[0].fout}`);
    this.meld(delen.join(', ') || 'niets te doen', geweigerd.length === 0);
  }

  // ---- eigen bestanden ------------------------------------------------------

  /** Meerdere bestanden: allemaal in de strook, dan één voor één uploaden. */
  async uploadBestanden(files) {
    const nieuw = files.map((file) => this._nieuweUpload(file));
    this.teken();
    for (const up of nieuw) if (!up.gestopt) await this._upload(up);
  }

  /**
   * Eén eigen bestand naar de server: /api/upload, daarna dezelfde wachtrij
   * als een link. naDeck: na de ingest meteen op die track (het bestand werd
   * op een track gesleept). Geeft de opdracht van de server terug, of null.
   */
  uploadBestand(file, { naDeck = null } = {}) {
    const up = this._nieuweUpload(file, naDeck);
    this.teken();
    return this._upload(up);
  }

  _nieuweUpload(file, naDeck = null) {
    const up = { sleutel: `${file.name}:${file.size}:${Date.now()}:${Math.random()}`, naam: file.name, file, naDeck,
      pct: 0, status: 'wacht', xhr: null, gestopt: false };
    this.uploads.push(up);
    return up;
  }

  /**
   * Met XMLHttpRequest en niet fetch: alleen die meldt hoe ver de upload is,
   * en kan halverwege stoppen (× in de strook; de server ruimt dan op).
   */
  _upload(up) {
    up.status = 'bezig';
    this.teken();
    return new Promise((klaar) => {
      const xhr = new XMLHttpRequest();
      up.xhr = xhr;
      xhr.open('POST', `/api/upload?naam=${encodeURIComponent(up.naam)}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) { up.pct = (e.loaded / e.total) * 100; this.teken(); }
      };
      const klaarMet = (opdracht, fout) => {
        this.uploads = this.uploads.filter((u) => u !== up);
        if (up.gestopt) this.meld(`${up.naam}: upload gestopt`, true);
        else if (fout) this.meld(`${up.naam}: ${fout}`, false);
        else if (opdracht) {
          this.meld(opdracht.bestond ? `${up.naam} staat al in de library` : `${up.naam} geüpload — staat in de wachtrij`, true);
          if (up.naDeck) this.naLaden.set(opdracht.id, up.naDeck);
        }
        this.teken();
        this.poll();
        klaar(opdracht ?? null);
      };
      xhr.onload = () => {
        let j = null;
        try { j = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300 && j) klaarMet(j, null);
        else klaarMet(null, j?.fout || `upload mislukt (${xhr.status})`);
      };
      xhr.onabort = () => klaarMet(null, null);
      // Een verbroken verbinding: de server sluit bij een te groot bestand, of hij draait niet.
      xhr.onerror = () => klaarMet(null, 'upload afgebroken — te groot (grens 8 GB), of de server is weg');
      xhr.send(up.file);
    });
  }

  // ---- met de server bijblijven ---------------------------------------------

  async poll() {
    let lijst;
    try {
      const r = await fetch('/api/ingest');
      lijst = (await r.json()).opdrachten || [];
    } catch { return; }
    this.opdrachten = lijst;
    for (const id of this.weg) if (!lijst.some((o) => o.id === id)) this.weg.delete(id);
    // Nieuw in de library? Eén keer de lijst verversen.
    let nieuw = false;
    for (const o of lijst) {
      if (o.status === 'klaar' && !this.gezienKlaar.has(o.id)) {
        this.gezienKlaar.add(o.id);
        if (!o.bestond) nieuw = true;
      }
    }
    if (nieuw) this.onNieuw();
    for (const o of lijst) if (this.naLaden.has(o.id)) this._naIngest(o);
    this.teken();
  }

  /** Alleen vragen zolang er iets loopt, of het paneel open staat. */
  _tik() {
    const loopt = this.opdrachten.some((o) => o.status === 'bezig' || o.status === 'wacht')
      || this.naLaden.size > 0 || this.uploads.length > 0;
    if (loopt || this.isOpen()) this.poll();
  }

  /** Een op een track gesleept bestand is af: dan daar laden (het paneel beslist of dat mag). */
  _naIngest(o) {
    if (o.status === 'bezig' || o.status === 'wacht') return;
    const deck = this.naLaden.get(o.id);
    this.naLaden.delete(o.id);
    if (o.status === 'klaar' && o.track) this.laadNaIngest(o.track, deck);
  }

  // ---- klikken --------------------------------------------------------------

  async _klik(e) {
    const knop = e.target.closest('button');
    if (!knop || !this.el.contains(knop)) return;
    if (knop.dataset.upload) {
      const up = this.uploads.find((u) => u.sleutel === knop.dataset.upload);
      if (!up) return;
      up.gestopt = true;
      if (up.xhr) up.xhr.abort();
      else { this.uploads = this.uploads.filter((u) => u !== up); this.teken(); }
      return;
    }
    const o = this.opdrachten.find((x) => x.id === knop.dataset.id);
    if (!o) return;
    if (knop.dataset.laad) {
      const deck = knop.dataset.laad;
      // Over een track die SPEELT laden: eerst een tweede klik, zoals in de lijst.
      if (this.stand(deck) === 'speelt' && !this.bevestigd('laad', `${o.track?.id}:${deck}`)) {
        return this.meld(`track ${this.label(deck)} speelt — klik nog eens om er toch overheen te laden`, false);
      }
      return this.laad(o.track, deck);
    }
    if (knop.dataset.weg !== undefined) {
      // Een lopende download stoppen gooit werk weg: tweede klik. Een wachtende niet.
      if (o.status === 'bezig' && !this.bevestigd('annuleer', o.id)) {
        return this.meld(`"${o.titel || kortUrl(o.url)}" wordt binnengehaald — klik nog eens op × om te stoppen`, false);
      }
      const open = o.status === 'bezig' || o.status === 'wacht';
      if (!open) { this.weg.add(o.id); this.teken(); }
      try {
        const r = await fetch(`/api/ingest/${encodeURIComponent(o.id)}`, { method: 'DELETE' });
        const j = await r.json();
        if (open) this.meld(j.ok ? `"${o.titel || kortUrl(o.url)}" ${o.status === 'bezig' ? 'wordt gestopt' : 'uit de wachtrij'}` : `annuleren lukte niet: ${j.fout || 'al afgelopen'}`, !!j.ok);
      } catch (err) {
        this.meld(`server niet bereikbaar: ${err.message}`, false);
      }
      this.poll();
    }
  }

  // ---- tekenen --------------------------------------------------------------

  teken() {
    if (this._vast) { this._later = true; return; }
    const rijen = zichtbaar(this.opdrachten.filter((o) => !this.weg.has(o.id)));
    const open = this.opdrachten.filter((o) => o.status === 'bezig' || o.status === 'wacht');
    const nBezig = open.filter((o) => o.status === 'bezig').length + this.uploads.filter((u) => u.status === 'bezig').length;
    const nWacht = open.length - open.filter((o) => o.status === 'bezig').length + this.uploads.filter((u) => u.status === 'wacht').length;
    const kop = nBezig + nWacht > 1
      ? `<div class="ing-kop">wachtrij · ${nBezig} bezig · ${nWacht} wachtend · één tegelijk</div>` : '';
    const ups = this.uploads.map((u) => this._uploadRij(u));
    // Alleen als er iets veranderde: anders verspringt hover en begint het
    // knipperende streepje bij elke poll opnieuw.
    const html = kop + [...ups, ...rijen.map((o) => this._rij(o))].join('');
    if (html !== this._html) { this.el.innerHTML = html; this._html = html; }
    this.el.classList.toggle('hidden', ups.length + rijen.length === 0);
  }

  _uploadRij(u) {
    const bezig = u.status === 'bezig';
    return `<div class="lib-job ing-rij ${bezig ? 'bezig' : 'wacht'}">
      <span class="lib-job-stap">${bezig ? 'upload' : 'wacht'}</span>
      <span class="lib-job-tekst"><b>${esc(u.naam)}</b> <i class="ing-sub">${bezig ? 'uploaden naar de server' : 'wacht op upload'}</i></span>
      <span class="ing-stappen"></span>
      <span${bezig ? ` class="lib-job-balk"><i style="width:${u.pct.toFixed(1)}%"></i>` : '>'}</span>
      <span class="ing-pct">${bezig ? `${Math.floor(u.pct)}%` : ''}</span>
      <span class="ing-knoppen"><button class="btn sm ing-x" data-upload="${esc(u.sleutel)}" title="upload stoppen">×</button></span>
    </div>`;
  }

  _rij(o) {
    const klasse = o.status === 'klaar' ? (o.bestond ? 'klaar bestond' : 'klaar') : o.status;
    const label = o.status === 'wacht' ? `wacht ${o.plek ?? ''}`
      : o.status === 'bezig' ? (STAP_NAMEN[o.stap] || o.stap || 'bezig')
        : o.bestond ? 'al binnen' : (STAP_NAMEN[o.status] || o.status);
    const titel = o.titel || o.track?.titel || kortUrl(o.url);
    // Streepjes alleen waar ze iets zeggen: niet bij mislukt, geannuleerd of "al binnen".
    const metStappen = o.status === 'bezig' || o.status === 'wacht' || (o.status === 'klaar' && !o.bestond);
    const stappen = metStappen ? stappenStand(o).map((s) => `<i class="${s.stand}" title="${esc(s.naam)}"></i>`).join('') : '';
    const pct = o.status === 'bezig' && typeof o.pct === 'number' ? o.pct : null;
    const laadKnoppen = o.status === 'klaar' && o.track
      ? this.decks.map((d) => `<button class="btn sm lib-trk ${this.stand(d)}" data-laad="${esc(d)}" data-id="${esc(o.id)}" title="laad op track ${esc(this.label(d))} (${this.stand(d)})">${esc(this.label(d))}</button>`).join('')
      : '';
    const xTitel = o.status === 'bezig' ? 'stoppen (tweede klik): yt-dlp en ffmpeg stoppen, niets blijft achter'
      : o.status === 'wacht' ? 'uit de wachtrij halen' : 'wegklikken';
    return `<div class="lib-job ing-rij ${klasse}">
      <span class="lib-job-stap">${esc(label)}</span>
      <span class="lib-job-tekst" title="${esc(o.url || '')}"><b>${esc(titel)}</b> <i class="ing-sub">${esc(onderschrift(o))}</i></span>
      <span class="ing-stappen">${stappen}</span>
      <span${pct !== null ? ` class="lib-job-balk"><i style="width:${pct.toFixed(1)}%"></i>` : '>'}</span>
      <span class="ing-pct">${pct !== null ? `${Math.floor(pct)}%` : ''}</span>
      <span class="ing-knoppen">${laadKnoppen}<button class="btn sm ing-x" data-weg data-id="${esc(o.id)}" title="${esc(xTitel)}">×</button></span>
    </div>`;
  }
}
