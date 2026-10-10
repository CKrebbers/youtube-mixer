import { LABEL } from '../standen/stand-model.js';

/**
 * De tegel "Opstelling" van de Controlekamer (docs/STANDEN.md), uit
 * GET /api/standen: welke stand (opstelling) er actief is, sinds wanneer, en
 * wat Clay zelf nog moet doen. Puur: geen DOM, dus test/stand-tegel.test.mjs
 * rekent hem na. Ook de tekst onder de kiezer (wat activeren verandert) en het
 * adres van "mixer openen" staan hier, zodat controle.js alleen tekent.
 *
 * Eerlijk over wat de mixer nog niet doet: het master-rack legt de server vast,
 * de mixer neemt het pas over in stap M ("mixer volgt nog niet"); de krat kiest
 * Clay zelf in de kaart (stap D); een hub-set start hij zelf.
 */

export { LABEL };

/**
 * De mixer via de hub: dezelfde vaste vlag als in src/ui/vlag.js (?hub=, de hub
 * op deze Mac, poort 7700 uit AV-app-hub). Nooit een adres uit de stand.
 */
export const MIXER_VIA_HUB = '/?hub=ws://localhost:7700/app';
export const MIXER_GEWOON = '/';

/** Hoe lang de sub hooguit is in de tegel (de title draagt de hele tekst). */
export const SUB_MAX = 90;

const kort = (s, max = SUB_MAX) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const uurMin = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '?' : d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
};
/** "slim:proefkrat" → "proefkrat", "pl:PL…" blijft zoals hij is. */
const kratNaam = (id) => String(id).replace(/^slim:/, '');

/**
 * Wat Clay zelf nog moet doen of weten, als één regel:
 * "krat proefkrat (kies hem in de kaart) · hub-set studio: start hem zelf (npm start -- studio) ·
 *  master Dub-worp: mixer volgt nog niet · profiel alles".
 * Gewone spaties: de delen zijn langer dan een smalle tegel, dus breken mag
 * tussen woorden (met harde spaties brak overflow-wrap ze midden in een woord).
 */
export function standRegel(a) {
  if (!a) return '';
  const delen = [];
  if (a.kaart?.krat) delen.push(`krat ${kratNaam(a.kaart.krat)} (kies hem in de kaart)`);
  if (a.hub?.set) delen.push(`hub-set ${a.hub.set}: start hem zelf (npm start -- ${a.hub.set})`);
  if (a.hub?.mixerVia) delen.push('mixer openen gaat via de hub');
  if (a.mixer?.master?.sjabloon) delen.push(`master ${a.mixer.master.sjabloon}: mixer volgt nog niet`);
  if (a.pakket?.profiel) delen.push(`profiel ${a.pakket.profiel}`);
  return delen.join(' · ');
}

/**
 * De tegel. `standen` is het antwoord van GET /api/standen ({ standen, actief,
 * label }), { ontbreekt: true } bij een oudere server (404), { fout: status }
 * bij een fout, of null als de server niet bereikbaar is. `status` (de mixer)
 * telt pas mee in stap M (mixer volgt / neemt hem over na herladen).
 * @returns {{ naam, licht: 'ok'|'half'|'fout'|'uit', waarde, sub, regel }}
 */
export function standTegel({ standen = null } = {}) {
  const naam = LABEL;
  if (!standen) return { naam, licht: 'uit', waarde: '—', sub: '', regel: '' };
  if (standen.ontbreekt) return { naam, licht: 'uit', waarde: 'onbekend', sub: 'oudere server', regel: '' };
  if (standen.fout) return { naam, licht: 'uit', waarde: 'onbekend', sub: `fout van de server (${standen.fout})`, regel: '' };
  const a = standen.actief;
  if (!a || !a.naam) {
    return { naam, licht: 'uit', waarde: 'geen',
      sub: a?.teruggezet ? `vorige teruggezet ${uurMin(a.teruggezet)}` : 'kies er een onder Openen', regel: '' };
  }
  const v = a.verslag ?? {};
  const titel = a.titel || a.naam;
  const sinds = `sinds ${uurMin(a.sinds)}`;
  const regel = standRegel(a);
  if (v.fouten?.length) {
    const f = v.fouten[0];
    return { naam, licht: 'fout', waarde: titel, sub: kort(`${f.deel ? `${f.deel}: ` : ''}${f.fout}`), regel };
  }
  const zorgen = [...(v.waarschuwingen ?? []), ...(v.overgeslagen ?? []).map((o) => `${o.deel} nog niet`)];
  if (zorgen.length) {
    return { naam, licht: 'half', waarde: titel, sub: kort(`${sinds} · ${zorgen[0]}${zorgen.length > 1 ? ` (+${zorgen.length - 1})` : ''}`), regel };
  }
  return { naam, licht: 'ok', waarde: titel, sub: sinds, regel };
}

/** Het adres voor "mixer openen": via de hub als de actieve stand dat zegt (hub.mixerVia), anders gewoon. */
export function mixerAdres(actief) {
  return actief?.naam && actief?.hub?.mixerVia === true ? MIXER_VIA_HUB : MIXER_GEWOON;
}

/**
 * De uitlegregel onder de kiezer, uit GET /api/standen/<naam>/verschil:
 * "nacht: aan → aan · vannacht niet · master: — → Dub-worp (mixer volgt nog niet) · hub: start studio zelf".
 * Leeg verschil: "verandert niets op de server".
 */
export function verschilTekst(v) {
  const d = v?.delen;
  if (!d || typeof d !== 'object') return '';
  const regels = [];
  for (const [deel, x] of Object.entries(d)) {
    if (!x || typeof x !== 'object') continue;
    const blijft = deel !== 'hub' && x.van === x.naar;
    const noten = [blijft && 'blijft', x.moment && x.moment !== 'nu' && x.moment].filter(Boolean);
    const wat = deel === 'hub' || blijft ? x.naar : `${x.van} → ${x.naar}`;
    regels.push(`${deel}: ${wat}${noten.length ? ` (${noten.join('; ')})` : ''}`);
  }
  return regels.length ? regels.join(' · ') : 'verandert niets op de server';
}

/**
 * Een melding na "vorige terugzetten" (POST /api/standen/terug): wat er terug
 * staat, of waarom niets. `raakte` = de delen die de laatste activering zette;
 * `overgeslagen` = wat je daarna met de hand veranderde en dus blijft (rood).
 */
export function terugMelding(antwoord) {
  const d = antwoord ?? {};
  const delen = Array.isArray(d.delen) ? d.delen : [];
  const overgeslagen = Array.isArray(d.overgeslagen) ? d.overgeslagen : [];
  let tekst;
  if (delen.length) tekst = `vorige teruggezet: ${delen.join(', ')}`;
  else if (overgeslagen.length) tekst = `vorige teruggezet: niets (${overgeslagen.map((o) => o.deel).join(', ')} met de hand veranderd na de activering)`;
  else if (Array.isArray(d.raakte) && !d.raakte.length) tekst = 'vorige teruggezet: niets (de laatste activering veranderde mapping en nacht niet)';
  else tekst = 'vorige teruggezet: niets';
  const rood = [...overgeslagen.map((o) => `${o.deel}: ${o.reden}`), ...(d.fouten ?? []).map((f) => `${f.deel}: ${f.fout}`)];
  return { tekst, rood };
}

/** Een melding na activeren: wat er gebeurde, in één zin. Waarschuwingen en fouten apart (rood). */
export function activeerMelding(antwoord) {
  const v = antwoord?.verslag ?? {};
  const gedaan = [...(v.toegepast ?? []), ...(v.gecontroleerd ?? []).map((d) => `${d} nagekeken`), ...(v.mixer ?? []).map((d) => `${d} klaar voor de mixer`)];
  const tekst = `${antwoord?.naam ?? 'opstelling'} actief${gedaan.length ? `: ${gedaan.join(', ')}` : ''}`;
  const rood = [...(v.fouten ?? []).map((f) => `${f.deel ?? 'stand'}: ${f.fout}`), ...(v.waarschuwingen ?? [])];
  return { tekst, rood };
}
