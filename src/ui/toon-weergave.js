import { ToonKaart, camelot, kortNaam, volleNaam, transponeer, isMineur, WIJZER } from '../engine/toonsoort.js';

/**
 * De toonsoort op het scherm (docs/TOONSOORT.md §5, besluiten T2–T5). Puur
 * rekenwerk, geen DOM, zodat de test het kan narekenen; de renderloop, de
 * spiegel en de library zetten het neer.
 *
 * Drie plekken:
 *   kolomkop   Camelot + korte naam van wat je HOORT, naast de BPM: `9B G`
 *   focus      groot: Camelot + volle naam, verschuiving, stemming: `4B · As majeur` `+1` `−32 ct`
 *   library    de PLAAT; bij een album de hoofdtoonsoort + hoeveel andere: `3A B♭m +4`
 *
 * Onzeker (0,15–0,40) = gedimd met "?", zoals de BPM. Onder 0,15 een "~" met
 * als tooltip "geen duidelijke toonsoort (best passend: E, of A)": bij ambient
 * een eerlijk antwoord, geen foutmelding. De plaat staat altijd in de tooltip (T3).
 */

/** Stemming tonen vanaf zoveel cent afwijking (T5): daaronder hoor je het niet. */
export const CENT_TONEN = 20;
/** Vanaf hier zit je tussen twee toonsoorten in, en zegt de tooltip dat. */
export const TUSSEN_VANAF = 40;

const MIN = '−';
/** `−32 ct`, `+25 ct`: hele cent, met een echt minteken. */
export const centTekst = (c) => `${Math.round(c) < 0 ? MIN : '+'}${Math.abs(Math.round(c))} ct`;
/** `+1`, `−2`, of leeg bij 0. */
export const verschuivingTekst = (n) => (n > 0 ? `+${n}` : n < 0 ? `${MIN}${-n}` : '');
const komma = (x) => x.toFixed(2).replace('.', ',');
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const halveTonen = (n) => `${Math.abs(n)} halve ${Math.abs(n) === 1 ? 'toon' : 'tonen'}`;

/** "E, of A": de beste en (als de analyse hem gaf) de tweede kandidaat. */
const kandidaten = (k, tweede) => kortNaam(k) + (tweede !== null && tweede !== undefined && tweede !== k ? `, of ${kortNaam(tweede)}` : '');

/**
 * Een stuk zonder toonsoort: in een AUTOMATISCHE kaart is dat stilte (de server
 * zet dan zekerheid 0, server/toon.js), met de hand gezet heeft het geen zekerheid.
 */
const STILTE = 'stilte: de analyse vond hier geen klank';
const GEEN_HAND = 'geen toonsoort (met de hand gezet)';
const geenTekst = (zekerheid) => (Number.isFinite(zekerheid) ? STILTE : GEEN_HAND);

/**
 * De tooltip bij wat je hoort (kolomkop en focus). `t` = deck.toonsoort
 * (hoorbaarBij in toonsoort.js). Regels, van belangrijk naar minder.
 */
export function toonTitel(t) {
  if (!t) return 'nog geen toonsoort voor deze track';
  const regels = [];
  if (t.k === null) {
    regels.push(geenTekst(t.zekerheid));
  } else if (t.soort === 'geen') {
    regels.push(`geen duidelijke toonsoort (best passend: ${kandidaten(t.k, t.tweede)})`);
  } else {
    regels.push(`je hoort ${t.camelot} ${t.naam}`
      + (t.soort === 'onzeker' ? ` — onzeker${Number.isFinite(t.zekerheid) ? ` (zekerheid ${komma(t.zekerheid)})` : ''}`
        + (t.tweede !== null && t.tweede !== t.k ? `, of ${kortNaam(t.tweede)}` : '') : ''));
  }
  if (t.k !== null) {
    const c = Math.round(t.cent);
    if (Math.abs(c) >= TUSSEN_VANAF) {
      regels.push(`tussen ${kortNaam(t.k)} en ${kortNaam(transponeer(t.k, Math.sign(c)))} (${centTekst(c)})`);
    } else if (Math.abs(c) >= CENT_TONEN) {
      regels.push(`stemming ${centTekst(c)}: naast een nummer op 440 Hz zweeft het`);
    }
    const p = t.plaat;
    const plaat = p.k === null ? 'geen toonsoort'
      : `${camelot(p.k)} ${volleNaam(p.k)}${Math.abs(p.stemming) >= CENT_TONEN ? `, ${centTekst(p.stemming)}` : ''}`;
    regels.push(`op de plaat: ${plaat}`
      + (t.verschuiving ? ` — met de pitch ${halveTonen(t.verschuiving)} ${t.verschuiving > 0 ? 'hoger' : 'lager'}` : ''));
  }
  if (t.aantal > 1) regels.push(`stuk ${t.index + 1} van ${t.aantal}`);
  if (t.slot) regels.push('met de hand bevestigd');
  return regels.join('\n');
}

/**
 * Kolomkop: `9B G`, onzeker `9B G?`, geen duidelijke `~`, zonder kaart `—`.
 * @returns { tekst, soort: 'zeker'|'onzeker'|'geen'|'leeg', titel }
 */
export function kolomToon(t) {
  if (!t) return { tekst: '—', soort: 'leeg', titel: toonTitel(null) };
  if (t.k === null || t.soort === 'geen') return { tekst: '~', soort: 'geen', titel: toonTitel(t) };
  return { tekst: `${t.camelot} ${t.kort}${t.soort === 'onzeker' ? '?' : ''}`, soort: t.soort, titel: toonTitel(t) };
}

/**
 * Focus (groot): `4B · As majeur`, de verschuiving t.o.v. de plaat (`+1`) en
 * de stemming vanaf 20 cent (`−32 ct`).
 * @returns { hoofd, verschuiving, cent, soort, titel }
 */
export function focusToon(t) {
  if (!t) return { hoofd: '—', verschuiving: '', cent: '', soort: 'leeg', titel: toonTitel(null) };
  if (t.k === null || t.soort === 'geen') return { hoofd: '~', verschuiving: '', cent: '', soort: 'geen', titel: toonTitel(t) };
  const c = Math.round(t.cent);
  return {
    hoofd: `${t.camelot} · ${t.naam}${t.soort === 'onzeker' ? '?' : ''}`,
    verschuiving: verschuivingTekst(t.verschuiving),
    cent: Math.abs(c) >= CENT_TONEN ? centTekst(c) : '',
    soort: t.soort,
    titel: toonTitel(t),
  };
}

/**
 * Library-kolom "toon": de PLAAT, geen pitch. Bij meerdere toonsoorten de
 * hoofdtoonsoort (meeste tijd) en `+N` = zoveel ANDERE toonsoorten.
 * @param json  de kaart zoals /api/library hem geeft (`track.toon`), of null
 * @param duur  lengte van het nummer (s), voor de tijd van het laatste stuk
 * @returns { tekst, soort: 'zeker'|'onzeker'|'geen'|'leeg', slot, titel, k }
 */
export function libraryToon(json, duur = null) {
  const kaart = ToonKaart.van(json);
  if (!kaart) return { tekst: '—', soort: 'leeg', slot: false, k: null, titel: 'nog geen toonsoort — klik om hem zelf te kiezen' };
  const h = kaart.hoofd(duur);
  const regels = [];
  let uit;
  if (!h) {
    uit = { tekst: '~', soort: 'geen', k: null };
    regels.push(kaart.stukken.every((s) => Number.isFinite(s.zekerheid)) ? 'stilte: de analyse vond geen klank' : GEEN_HAND);
  } else if (h.soort === 'geen') {
    uit = { tekst: `~${h.anderen ? ` +${h.anderen}` : ''}`, soort: 'geen', k: h.k };
    regels.push(`geen duidelijke toonsoort (best passend: ${kortNaam(h.k)})`);
  } else {
    uit = { tekst: `${camelot(h.k)} ${kortNaam(h.k)}${h.soort === 'onzeker' ? '?' : ''}${h.anderen ? ` +${h.anderen}` : ''}`, soort: h.soort, k: h.k };
    regels.push(`${camelot(h.k)} ${volleNaam(h.k)}`
      + (h.soort === 'onzeker' && Number.isFinite(h.zekerheid) ? ` — onzeker (zekerheid ${komma(h.zekerheid)})` : '')
      + (kaart.aantalStukken > 1 ? `, ${Math.round(h.aandeel * 100)}% van de tijd` : ''));
    if (Math.abs(h.stemming) >= CENT_TONEN) regels.push(`stemming ${centTekst(h.stemming)}`);
  }
  if (kaart.aantalStukken > 1) {
    const stukken = kaart.stukken;
    const lijst = stukken.slice(0, 24).map((s, i) => {
      const t = kaart.stukAt(s.van);
      const naam = t.k === null ? (Number.isFinite(t.zekerheid) ? 'stilte' : 'geen') : `${camelot(t.k)} ${kortNaam(t.k)}`;
      const z = Number.isFinite(t.zekerheid) ? ` (${komma(t.zekerheid)})` : '';
      return `${mmss(i === 0 ? 0 : s.van)}  ${t.soort === 'geen' && t.k !== null ? `~ ${naam}` : naam}${z}`;
    });
    if (stukken.length > 24) lijst.push(`… en nog ${stukken.length - 24}`);
    regels.push(`${stukken.length} stukken:`, ...lijst);
  }
  regels.push(kaart.slot ? 'met de hand bevestigd' : kaart.bron === 'hand' ? 'met de hand gezet' : 'van de analyse — klik om te kiezen of te bevestigen');
  return { ...uit, slot: kaart.slot, titel: regels.join('\n') };
}

/** De 24 knoppen van de kiezer, in wijzervolgorde: 1A 1B 2A … 12B. */
export const KIEZER = WIJZER.map((k) => ({ k, camelot: camelot(k), kort: kortNaam(k), mineur: isMineur(k) }));
