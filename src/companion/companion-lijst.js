import { esc } from '../ui/dom.js';
import { standVan, badgesHtml, duurTekst, WENS_TEKST, kratOptiesHtml, kieslijstHtml, wensUitkomst } from '../ui/kaart-lijst.js';

/*
 * De companion (companion.html, docs/COMPANION.md): iPad en iPhone naast de
 * laptop. Dit bestand is het rekenwerk en de HTML-stukken, puur: geen DOM,
 * geen fetch, geen klok van zichzelf. companion.js hangt het aan het scherm;
 * test/companion-lijst.test.mjs toetst het in Node.
 *
 * Grenzen (docs/COMPANION.md §grenzen, en test/regels-companion.test.mjs):
 * geen geluid, geen MIDI, geen tabblad-slot. De companion leest de server en
 * zet alleen wensen, een keuze uit kandidaten, "haal nu" (de server weigert
 * zelf op een speeldag of als er een deck speelt) en een speeldag erbij.
 * Nooit "meteen", nooit "bevestig", nooit "zoek" (dat gaat naar YouTube),
 * nooit iets weghalen.
 */

/** Hoe vaak "nu" de server vraagt (alleen zolang de pagina zichtbaar is). */
export const PEIL_MS = 1000;
/** Rijen per pagina van de kaart; "meer" haalt de volgende. */
export const PAGINA = 50;
/** Een melding van de mixer jonger dan dit is vers; ouder = "meldt zich niet". */
export const VERS_MS = 5000;
/** Ouder dan dit: de resttijd is een schatting (≈). */
export const SCHATTING_MS = 1500;
/** Ouder dan dit: geen resttijden meer (die zouden verzonnen zijn), wel hoe lang geleden de laatste melding was. */
export const WEG_MS = 60_000;
/** "Haal nu" vraagt hooguit zoveel tegelijk (meer is werk voor de nacht of de laptop). */
export const HAAL_MAX = 20;

export const TABS = ['nu', 'kaart', 'beeld'];
export const TAB_SLEUTEL = 'varve.companion.tab';
export const PIN_SLEUTEL = 'varve.companion.pins';

/** "Nu" zolang de server /api/mixer nog niet kent (404): wat er komt, voor Clay, geen ontwikkelaarszin. */
export const NU_ONTBREEKT = 'Wat er speelt komt hier zodra de mixer zich bij de server meldt (nog niet gebouwd).';

/** De zin die altijd onder de beeldstand staat: wat dit beeld wel en niet is. */
export const BEELD_ZIN = 'Varve-beeld op deze Mac · de beamer van de pc volgt dit niet · noodknop: APC mapje beeld';

export const STANDAARD_CONFIG = Object.freeze({ versie: 1, tabs: [...TABS], kaart: { kratten_bovenaan: [] } });

/**
 * mappings/companion.json lezen. Onbekende tabs vallen weg, een krat-id moet een
 * tekst zijn; wat niet klopt komt in `fouten` (en de rest werkt gewoon).
 */
export function leesConfig(json) {
  const fouten = [];
  const config = { versie: 1, tabs: [...TABS], kaart: { kratten_bovenaan: [] } };
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    if (json != null) fouten.push('companion.json is geen object');
    return { config, fouten };
  }
  if (json.tabs !== undefined) {
    if (!Array.isArray(json.tabs)) fouten.push('tabs is geen lijst');
    else {
      const bekend = [...new Set(json.tabs.filter((t) => TABS.includes(t)))];
      for (const t of json.tabs) if (!TABS.includes(t)) fouten.push(`onbekende tab: ${String(t)}`);
      if (bekend.length) config.tabs = bekend;
      else fouten.push('geen bekende tab: alle drie getoond');
    }
  }
  const boven = json.kaart?.kratten_bovenaan;
  if (boven !== undefined) {
    if (!Array.isArray(boven)) fouten.push('kaart.kratten_bovenaan is geen lijst');
    else {
      for (const k of boven) {
        if (typeof k === 'string' && k) { if (!config.kaart.kratten_bovenaan.includes(k)) config.kaart.kratten_bovenaan.push(k); }
        else fouten.push(`kaart.kratten_bovenaan: ${JSON.stringify(k)} is geen krat-id`);
      }
    }
  }
  return { config, fouten };
}

// ---- onthouden op dit apparaat (localStorage; mag ontbreken of gooien) ----------

/** De tab die op dit apparaat bewaard is (en in de indeling staat), of null. */
export function bewaardeTab(opslag, tabs = TABS) {
  try { const t = opslag?.getItem(TAB_SLEUTEL); if (tabs.includes(t)) return t; } catch {}
  return null;
}

export function leesTab(opslag, tabs = TABS) {
  return bewaardeTab(opslag, tabs) ?? (tabs.includes('nu') ? 'nu' : tabs[0]);
}

/**
 * De eerste keer (niets bewaard): welke tab, na het eerste antwoord van
 * GET /api/mixer? "Nu" als de mixer zich meldt; anders de kaart (die werkt
 * altijd), want een vrijwel leeg "nu" is geen eerste scherm (review ronde 1,
 * fix 4). Een fout of geen server: "nu" blijft (daar staat dan wat er mis is).
 * Een bewaarde tab wint altijd; deze keuze wordt zelf niet bewaard.
 */
export function eersteTab(bewaard, antwoord, tabs = TABS) {
  if (bewaard && tabs.includes(bewaard)) return bewaard;
  const nu = tabs.includes('nu') ? 'nu' : tabs[0];
  if (!tabs.includes('kaart') || !antwoord || antwoord.fout) return nu;
  return antwoord.ontbreekt || !antwoord.melding ? 'kaart' : nu;
}

export function bewaarTab(opslag, tab) {
  try { if (TABS.includes(tab)) opslag?.setItem(TAB_SLEUTEL, tab); } catch {}
}

/** De vastgepinde kratten van dit apparaat (de ster), nieuwste eerst. */
export function leesPins(opslag) {
  try {
    const j = JSON.parse(opslag?.getItem(PIN_SLEUTEL) ?? '[]');
    if (Array.isArray(j)) return [...new Set(j.filter((k) => typeof k === 'string' && k))];
  } catch {}
  return [];
}

/** Ster aan of uit voor één krat; geeft de nieuwe lijst (en bewaart hem als het kan). */
export function wisselPin(opslag, pins, id) {
  if (!id) return pins;
  const nieuw = pins.includes(id) ? pins.filter((k) => k !== id) : [id, ...pins];
  try { opslag?.setItem(PIN_SLEUTEL, JSON.stringify(nieuw)); } catch {}
  return nieuw;
}

// ---- de kratkiezer -----------------------------------------------------------------

/**
 * De kratkiezer met een groep "bovenaan": eerst wat op dit apparaat vastgepind
 * is (★), dan `kratten_bovenaan` uit de JSON; alleen kratten die op de kaart
 * staan, elk één keer. Daarna de gewone kiezer (kratOptiesHtml) met de rest.
 */
export function kratOptiesCompanionHtml(kratten = [], gekozen = '', totaal = null, { pins = [], config = [] } = {}) {
  const bestaat = new Map(kratten.map((k) => [k.id, k]));
  const ids = [...new Set([...pins, ...config])].filter((id) => bestaat.has(id));
  const boven = ids.map((id) => bestaat.get(id));
  const rest = kratten.filter((k) => !ids.includes(k.id));
  const optie = (k) => `<option value="${esc(k.id)}"${k.id === gekozen ? ' selected' : ''}>${pins.includes(k.id) ? '★ ' : ''}${esc(k.naam)} (${k.aantal ?? 0}${k.binnen ? ` · ${k.binnen} binnen` : ''})</option>`;
  const groep = boven.length ? `<optgroup label="bovenaan">${boven.map(optie).join('')}</optgroup>` : '';
  const html = kratOptiesHtml(rest, gekozen, totaal);
  const i = html.indexOf('</option>') + '</option>'.length;   // na "hele kaart"
  return html.slice(0, i) + groep + html.slice(i);
}

// ---- "nu": wat speelt er, hoe lang nog -----------------------------------------------

/** 'vers' | 'oud' | 'geen' (nog nooit een melding). */
export function versheid(leeftijd_ms) {
  if (leeftijd_ms == null || !Number.isFinite(leeftijd_ms)) return 'geen';
  return leeftijd_ms < VERS_MS ? 'vers' : 'oud';
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * "nog 49:58", of "≈ nog 49:58" als de melding ouder is dan SCHATTING_MS.
 * (duur − positie) / rate is de resttijd op het moment van de melding; de
 * leeftijd van de melding gaat eraf. Null als het deck niet speelt, een
 * veld ontbreekt (de mixer van vóór stap 2 stuurt geen positie) of de
 * melding ouder is dan WEG_MS (de mixer is dicht: niets meer te schatten).
 */
export function restTekst(track, leeftijd_ms = 0) {
  if (!track?.speelt) return null;
  if (Number.isFinite(leeftijd_ms) && leeftijd_ms > WEG_MS) return null;
  const { positie, duur, rate } = track;
  if (![positie, duur, rate].every((x) => typeof x === 'number' && Number.isFinite(x)) || rate <= 0 || duur <= 0) return null;
  const leeftijd = Number.isFinite(leeftijd_ms) && leeftijd_ms > 0 ? leeftijd_ms : 0;
  const rest = Math.max(0, Math.floor((duur - positie) / rate - leeftijd / 1000));
  return `${leeftijd > SCHATTING_MS ? '≈ ' : ''}nog ${mmss(rest)}`;
}

/** "1 min geleden", "59 min geleden", "2 u 5 min geleden" (naar beneden afgerond). */
export function geledenTekst(ms) {
  const min = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 60_000));
  return min < 60 ? `${min} min geleden` : `${Math.floor(min / 60)} u ${min % 60} min geleden`;
}

const bpmTekst = (b) => (typeof b === 'number' && Number.isFinite(b) ? `${String(b).replace('.', ',')} bpm` : '');

/**
 * Het blok "nu" uit het antwoord van GET /api/mixer.
 * `antwoord`: { leeftijd_ms, twee, melding, speelt } (stap 2), { ontbreekt: true }
 * (de server kent /api/mixer nog niet: 404), { fout: status } (5xx), of null
 * (server niet bereikbaar).
 */
export function nuHtml(antwoord) {
  if (antwoord === null || antwoord === undefined) return '<p class="nu-regel let-op">server niet bereikbaar</p>';
  if (antwoord.ontbreekt) return `<p class="nu-regel">${esc(NU_ONTBREEKT)}</p>`
    + '<p class="nu-uitleg">De kaart werkt wel.</p>';
  if (antwoord.fout) return `<p class="nu-regel let-op">de server gaf een fout (${esc(antwoord.fout)}); over een minuut opnieuw</p>`;
  const m = antwoord.melding;
  const vers = m ? versheid(antwoord.leeftijd_ms) : 'geen';
  const delen = [];
  if (antwoord.twee) delen.push('<p class="nu-regel rood">twee mixers open (localhost en 127.0.0.1?)</p>');
  if (vers === 'geen') {
    delen.push('<p class="nu-regel">de mixer heeft zich nog niet gemeld</p>');
    return delen.join('');
  }
  // Ouder dan WEG_MS (de mixer is dicht of slaapt): zeggen hoe oud, en geen resttijden meer (review ronde 2, fix 5).
  const weg = vers === 'oud' && antwoord.leeftijd_ms > WEG_MS;
  if (weg) delen.push(`<p class="nu-regel let-op">mixer meldt zich niet · laatste melding ${esc(geledenTekst(antwoord.leeftijd_ms))}</p>`);
  else if (vers === 'oud') delen.push('<p class="nu-regel let-op">mixer meldt zich niet (op de achtergrond?)</p>');
  const tracks = Array.isArray(m.tracks) ? m.tracks : [];
  const rijen = tracks.map((t) => {
    const rest = restTekst(t, antwoord.leeftijd_ms);
    const klasse = ['nu-track', t.speelt ? 'speelt' : '', t.id === m.focus ? 'focus' : ''].filter(Boolean).join(' ');
    return `<li class="${klasse}" data-track="${esc(t.id)}"><b class="nu-letter">${esc(t.id)}</b>`
      + `<span class="nu-titel">${esc(t.titel || '(zonder titel)')}</span>`
      + `<span class="nu-speelt" aria-label="${t.speelt ? 'speelt' : 'staat stil'}">${t.speelt ? '▶' : '❚❚'}</span>`
      + `<span class="nu-rest">${esc(rest ?? '')}</span>`
      + `<small class="nu-klein">${esc([bpmTekst(t.bpm), t.toon || ''].filter(Boolean).join(' · '))}</small></li>`;
  });
  delen.push(rijen.length ? `<ul class="nu-tracks${vers === 'oud' ? ' grijs' : ''}">${rijen.join('')}</ul>` : '<p class="nu-regel">geen track geladen</p>');
  const onder = [
    m.audio === 'running' ? 'audio aan' : m.audio ? `audio ${m.audio === 'suspended' ? 'staat stil' : m.audio}` : null,
    m.midi?.invoer ? `APC: ${m.midi.invoer}` : 'geen APC',
    m.opname ? 'opname loopt' : 'geen opname',
    m.auto ? 'auto-DJ aan' : 'auto-DJ uit',
  ].filter(Boolean);
  delen.push(`<p class="nu-onder${vers === 'oud' ? ' grijs' : ''}">${onder.map((x) => `<span>${esc(x)}</span>`).join('')}</p>`);
  return delen.join('');
}

// ---- beeld: alleen tonen ----------------------------------------------------------------

/** De beeldstand uit de melding (`eind`, stap 2), of "nog geen beeldstand". Altijd met BEELD_ZIN. */
export function beeldHtml(eind) {
  const zin = `<p class="beeld-zin">${esc(BEELD_ZIN)}</p>`;
  if (!eind || typeof eind !== 'object') return `<p class="nu-regel">nog geen beeldstand</p>${zin}`;
  const aan = (x) => (x ? 'aan' : 'uit');
  const master = typeof eind.master === 'number' && Number.isFinite(eind.master) ? Math.round(Math.min(1, Math.max(0, eind.master)) * 100) : null;
  return `<ul class="beeld-stand">`
    + `<li class="${eind.zwart ? 'aan' : ''}"><b>ZWART</b><span>${aan(eind.zwart)}</span></li>`
    + `<li class="${eind.bevroren ? 'aan' : ''}"><b>BEVRIES</b><span>${aan(eind.bevroren)}</span></li>`
    + `<li><b>MASTER</b><span>${master == null ? '—' : `${master} %`}</span></li></ul>${zin}`;
}

// ---- de kaart: één rij ---------------------------------------------------------------------

/**
 * Eén nummer van de kaart als rij voor touch. Knoppen per stand:
 * - `kandidaat` / `geen-video` → **wens** (op de wenslijst; de nacht of de laptop haalt hem);
 * - `kies` → **kies** als de kandidaten er zijn (GET /api/kaart/wensen), anders "kies op de laptop";
 * - `wacht`, `zoekt`, `bezig`, `klaar`, `mislukt`, `binnen` → alleen het label (geen intrekken).
 * `opties`: { kandidaten (lijst of null), open (kieslijst open), bezig (verzoek loopt) }.
 */
export function rijHtml(n, { kandidaten = null, open = false, bezig = false } = {}) {
  const stand = standVan(n);
  const s = esc(n.sleutel);
  let knop;
  if (stand === 'kandidaat' || stand === 'geen-video') {
    const titel = stand === 'kandidaat' ? 'op de wenslijst: de nacht of de laptop haalt hem binnen' : 'op de wenslijst: eerst een YouTube-versie zoeken (nacht of laptop)';
    knop = `<button class="knop wens" data-wens="${s}" title="${esc(titel)}"${bezig ? ' disabled' : ''}>${bezig ? '…' : 'wens'}</button>`;
  } else if (stand === 'kies') {
    knop = kandidaten?.length
      ? `<button class="knop kies" data-kies-open="${s}" aria-expanded="${open}" title="er zijn kandidaten gevonden: kies er een"${bezig ? ' disabled' : ''}>${bezig ? '…' : 'kies'}</button>`
      : '<span class="stand kies">kies op de laptop</span>';
  } else {
    const hint = stand === 'binnen' ? 'staat in de library' : stand === 'wacht' ? 'op de wenslijst' : stand === 'mislukt' ? (n.wens?.fout || 'mislukt') : (WENS_TEKST[stand] || stand);
    knop = `<span class="stand ${esc(stand)}" title="${esc(hint)}">${esc(stand === 'binnen' ? 'binnen' : WENS_TEKST[stand] || stand)}</span>`;
  }
  const lijst = stand === 'kies' && open && kandidaten?.length ? kieslijstHtml(n.sleutel, kandidaten, 0) : '';
  return `<li class="rij" data-sleutel="${s}" data-stand="${esc(stand)}">`
    + `<span class="rij-tekst"><b class="rij-titel">${esc(n.titel)}${n.versie ? ` <small>${esc(n.versie)}</small>` : ''}</b>`
    + `<span class="rij-artiest">${esc(n.artiest || '')}</span></span>`
    + `<span class="rij-meta">${badgesHtml(n)}<span class="rij-duur">${esc(duurTekst(n))}</span></span>`
    + `<span class="rij-stand">${knop}</span>${lijst}</li>`;
}

// ---- de wenslijst en de nacht ------------------------------------------------------------------

const twee = (n) => String(n).padStart(2, '0');
/** De datum van `d` (lokale tijd), JJJJ-MM-DD. Gelijk aan datumVan in server/nacht.js (de test legt ze naast elkaar). */
export const datumVan = (d) => `${d.getFullYear()}-${twee(d.getMonth() + 1)}-${twee(d.getDate())}`;
/** De nacht waar `d` bij hoort: vóór 12:00 de dag ervóór. Gelijk aan nachtDatum in server/nacht.js. */
export function nachtDatum(d) {
  const x = new Date(d.getTime());
  if (x.getHours() < 12) x.setDate(x.getDate() - 1);
  return datumVan(x);
}

/** De klok van de server uit GET /api/nacht (`nu`, ISO), anders die van hier. */
const klokVan = (nacht, nu) => {
  const ms = Date.parse(nacht?.nu ?? '');
  return new Date(Number.isFinite(ms) ? ms : (typeof nu === 'number' ? nu : Date.now()));
};
const isDatum = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * "Vandaag" als datum: wat de server zegt (`vandaag`, in ZIJN tijdzone), anders
 * uitgerekend uit zijn klok in de tijdzone van dit toestel (een oudere server).
 * Zo voegt de speeldag-knop op locatie in een andere tijdzone, of met een
 * verkeerd gezette iPhone, de dag toe die de server bedoelt (review ronde 1, fix 9).
 */
export const vandaagVan = (nacht, nu) => (isDatum(nacht?.vandaag) ? nacht.vandaag : datumVan(klokVan(nacht, nu)));

/** De nacht waar het nu bij hoort, volgens de server (`nachtDatum`), anders zelf uitgerekend. */
const nachtVan = (nacht, nu) => (isDatum(nacht?.nachtDatum) ? nacht.nachtDatum : nachtDatum(klokVan(nacht, nu)));

/** Is het nu een speeldag (dezelfde regel als nacht.nu() op de server: vandaag of de nacht van gisteren)? */
export function isSpeeldag(nacht, nu) {
  const dagen = Array.isArray(nacht?.speeldagen) ? nacht.speeldagen : [];
  return dagen.includes(vandaagVan(nacht, nu)) || dagen.includes(nachtVan(nacht, nu));
}

/** Wat er na een wens gebeurt, in één zin: de uitkomst plus wat de nacht ermee doet. */
export function wensGevolgTekst(uitkomst, nacht, nu) {
  const basis = wensUitkomst(uitkomst);
  if (!(uitkomst?.toegevoegd?.length)) return basis;
  const gevolg = !nacht ? null
    : isSpeeldag(nacht, nu) ? 'vandaag speeldag: niet vóór morgen'
      : nacht.aan ? `de nacht haalt hem binnen (${nacht.venster?.van ?? '01:00'}–${nacht.venster?.tot ?? '07:00'})`
        : 'nacht staat uit: haal nu, of op de laptop';
  return { tekst: gevolg ? `${basis.tekst} · ${gevolg}` : basis.tekst, goed: basis.goed };
}

/** Hoeveel er wacht (wacht, plus een wens met een gekozen video: ook `wacht`). */
export const wachtAantal = (wensen = []) => wensen.filter((w) => w.status === 'wacht').length;

/**
 * De knop "haal de wenslijst nu op (n)": { tekst, kan, aantal }. Kan niet op
 * een speeldag, als er al een run loopt, of als er niets wacht. De server
 * weigert zelf ook (409); dit is alleen om niet voor niets te tikken. De knop
 * stuurt `alleenWensen: true` (haalNuBody): alleen de wenslijst, nooit nummers
 * uit de standaardvolgorde van de kaart (server/nacht.js).
 */
export function haalNuKnop(wacht, nacht, nu) {
  const aantal = Math.min(Math.max(0, wacht | 0), HAAL_MAX);
  if (nacht && isSpeeldag(nacht, nu)) return { tekst: 'haal nu: vandaag speeldag', kan: false, aantal };
  if (nacht?.bezig) return { tekst: 'haal nu: er loopt al een run', kan: false, aantal };
  if (!aantal) return { tekst: 'haal nu: niets te halen', kan: false, aantal };
  return { tekst: `haal de wenslijst nu op (${aantal})`, kan: true, aantal };
}

/** De body voor POST /api/nacht/nu: hooguit `aantal`, alleen van de wenslijst. */
export const haalNuBody = (aantal) => ({ aantal: Math.min(Math.max(1, aantal | 0), HAAL_MAX), alleenWensen: true });

/** De melding na een 202 van POST /api/nacht/nu. */
export const haalNuGestartTekst = (aantal) => `run gestart: hooguit ${aantal} van de wenslijst`;

/** De knop "vandaag speeldag": de tekst, of null als vandaag er al in staat (weghalen kan alleen op de laptop). */
export function speeldagKnopTekst(nacht, nu) {
  if (!nacht) return null;
  const dagen = Array.isArray(nacht.speeldagen) ? nacht.speeldagen : [];
  return dagen.includes(vandaagVan(nacht, nu)) ? null : 'vandaag speeldag';
}

/** De body voor POST /api/nacht: de bestaande speeldagen plus vandaag (alleen toevoegen). */
export function speeldagErbij(nacht, nu) {
  const dagen = Array.isArray(nacht?.speeldagen) ? nacht.speeldagen : [];
  return { speeldagen: [...new Set([...dagen, vandaagVan(nacht, nu)])].sort() };
}

/**
 * De rijen van de lijst bijwerken met de wenslijst van de server (die leest de
 * companion elke 5 s). Intussen kan de laptop gezocht hebben (wacht → kies), een
 * video gekozen, of de nacht haalde hem binnen (klaar). Zonder dit bleef de rij
 * staan zoals hij bij het laden van de lijst was, en kon je op de iPad nooit
 * kiezen wat de laptop net vond. Geeft { rijen, veranderd }: alleen een rij
 * waarvan de wens echt anders is wordt een nieuw object; de rest blijft hetzelfde
 * (zodat het scherm alleen die rijen opnieuw tekent). Een wens die weg is wordt null.
 */
export function pasWensenToe(rijen = [], wensen = []) {
  const per = new Map(wensen.filter((w) => w?.sleutel).map((w) => [w.sleutel, w]));
  const veranderd = [];
  const nieuw = rijen.map((n) => {
    const w = per.get(n.sleutel);
    const oud = n.wens ?? null;
    const wens = w ? { status: w.status, fout: w.fout ?? null, youtube_id: w.youtube_id ?? null } : null;
    const zelfde = oud === null ? wens === null
      : wens !== null && oud.status === wens.status && (oud.fout ?? null) === wens.fout && (oud.youtube_id ?? null) === wens.youtube_id;
    if (zelfde) return n;
    veranderd.push(n.sleutel);
    return { ...n, wens };
  });
  return { rijen: nieuw, veranderd };
}

/** De kandidaten per sleutel uit GET /api/kaart/wensen (alleen die van een wens die op `kies` staat). */
export function kandidatenPerSleutel(wensen = []) {
  const m = new Map();
  for (const w of wensen) if (w?.status === 'kies' && Array.isArray(w.kandidaten) && w.kandidaten.length) m.set(w.sleutel, w.kandidaten);
  return m;
}

/** `?pagina=5` in de URL (alleen voor de headless-proef): 1..PAGINA, anders PAGINA. */
export function paginaUitUrl(zoekdeel) {
  try {
    const n = Number(new URLSearchParams(zoekdeel || '').get('pagina'));
    return Number.isInteger(n) && n >= 1 && n <= PAGINA ? n : PAGINA;
  } catch { return PAGINA; }
}
