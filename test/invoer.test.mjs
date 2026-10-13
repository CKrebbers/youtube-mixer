// Het invoerpad en de hoofdthread die het ophoudt (controller-invoer, 14 okt;
// docs/verslagen/2026-10-14/controller-invoer.md). Wat hier vastligt:
//   - geen :has() met een brede subject in styles.css (elke tekstwissel restylede ~256 elementen),
//     wel dezelfde regels via klassen die src/ui/rij-klassen.js bijhoudt;
//   - zetTekst schrijft in de bestaande tekstknoop;
//   - wat per MIDI-bericht gebeurde en bij het volgende beeld kan, gebeurt daar (spiegel, mapje-balk);
//   - de staande meters bewegen met transform, niet met height;
//   - de bovenbalk dwingt geen opmaak af met een timer.
// De metingen zelf: tools/headless/latentie.mjs en tools/bench/invoer.mjs.
import { readFileSync } from 'node:fs';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${!cond && extra ? ` (${extra})` : ''}`); };
const lees = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// ---- styles.css: geen brede :has() meer ----------------------------------------
const css = lees('../styles.css');
const regels = css.replace(/\/\*[\s\S]*?\*\//g, '');   // zonder commentaar
const hasRegels = [...regels.matchAll(/([^{}]*:has\([^{]*)\{/g)].map((m) => m[1].trim());
const toegestaan = (sel) => sel.split(',').every((d) => d.trim() === 'main' || d.trim() === 'main:has(> .video-panel:not(.hidden))');
ok('styles.css: alleen de :has() van main (het videopaneel, een direct kind) blijft', hasRegels.every(toegestaan), hasRegels.filter((s) => !toegestaan(s)).join(' | '));
ok('styles.css: geen body:has() en geen .stems-rij:has() meer', !/body:has\(/.test(regels) && !/\.stems-rij:has\(/.test(regels) && !/\.rijen:has\(/.test(regels));
for (const [klasse, waar] of [['html body.rij-open:not(#rij-x) .kol .spg-pad', 'de kolommen met een rij open'],
  ['body.rij-hoog:not(#rij-x) .wave-zoom', 'het focusdeck lager met auto/klankschaal/stems'],
  ['.stems-rij.vier-stems.vier-stems.vier-stems .st-legenda', 'vier stems op een laptop'],
  ['.stems-rij.zonder-stemmen.zonder-stemmen .st-legenda', 'geen stemmen'], ['div.rijen.open', 'de rijen']]) {
  ok(`styles.css: ${waar} via een klasse (${klasse})`, css.includes(klasse));
}

// Specificiteit: de nieuwe selector weegt even zwaar als de :has() die hij vervangt (er mag niets anders gaan winnen).
const spec = (sel) => {
  // Eenvoudige teller voor deze selectors: id's, klassen/attributen/pseudo-klassen, types. :not()/:has() tellen hun argument.
  let s = sel.replace(/:(not|has|is)\(/g, ' (');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const klassen = (s.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length;
  const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|[>(),:]/g, ' ').match(/\b[a-z][\w-]*\b/g) || []).length;
  return [ids, klassen, types].join(',');
};
for (const [oud, nieuw] of [
  ['body:has(#rijen > section:not(.hidden)) .kol .spg-pad', 'html body.rij-open:not(#rij-x) .kol .spg-pad'],
  ['body:has(#auto:not(.hidden)) .wave-zoom', 'body.rij-hoog:not(#rij-x) .wave-zoom'],
  ['.stems-rij:has(.st-stem[data-stem="drums"]:not(.hidden)) .st-stemmen', '.stems-rij.vier-stems.vier-stems.vier-stems .st-stemmen'],
  ['.stems-rij:has(.st-stemmen.hidden) .st-legenda', '.stems-rij.zonder-stemmen.zonder-stemmen .st-legenda'],
  ['.rijen:has(> section:not(.hidden))', 'div.rijen.open'],
]) ok(`specificiteit gelijk: ${nieuw} (${spec(nieuw)}) = ${oud} (${spec(oud)})`, spec(oud) === spec(nieuw));

// ---- rij-klassen: dezelfde voorwaarden als de :has() -----------------------------
const { rijKlassen, HOOG } = await import('../src/ui/rij-klassen.js');
const s = (open) => ['stems', 'koptelefoon', 'instrument', 'patronen', 'master', 'auto', 'klankschaal', 'beeld'].map((id) => ({ id, open: open.includes(id) }));
ok('rijKlassen: niets open -> geen klasse', JSON.stringify(rijKlassen({ secties: s([]) })) === JSON.stringify({ rijenOpen: false, rijOpen: false, rijHoog: false, zonderStemmen: false, vierStems: false }));
ok('rijKlassen: koptelefoon open -> rij-open, niet hoog', (() => { const k = rijKlassen({ secties: s(['koptelefoon']) }); return k.rijOpen && k.rijenOpen && !k.rijHoog; })());
ok('rijKlassen: auto, klankschaal of stems open -> ook rij-hoog', HOOG.every((id) => rijKlassen({ secties: s([id]) }).rijHoog));
ok('rijKlassen: de stems-voorwaarden gaan zoals ze binnenkomen', rijKlassen({ secties: s([]), stemmenVerborgen: true, vierStems: true }).zonderStemmen
  && rijKlassen({ secties: s([]), stemmenVerborgen: true, vierStems: true }).vierStems);
const app = lees('../src/ui/app.js');
ok('app.js zet de rij-klassen op', /import \{ opzetRijKlassen \} from '\.\/rij-klassen\.js'/.test(app) && /^opzetRijKlassen\(\);$/m.test(app));
const html = lees('../index.html');
ok('index.html: auto, klankschaal en stems zijn rijen in #rijen (anders kloppen de klassen niet met de oude :has())',
  (() => { const i = html.indexOf('<div id="rijen"'), e = html.indexOf('<!-- ================= LIBRARY'); return ['stems', 'auto', 'klankschaal'].every((id) => { const p = html.indexOf(`<section id="${id}"`); return p > i && p < e; }); })());

// ---- zetTekst: de bestaande tekstknoop --------------------------------------------
const { zetTekst } = await import('../src/ui/dom.js');
{
  const knoop = { nodeType: 3, data: 'oud', nextSibling: null };
  let vervangen = 0;
  const el = { firstChild: knoop, get textContent() { return knoop.data; }, set textContent(t) { vervangen++; } };
  zetTekst(el, 'nieuw');
  ok('zetTekst: schrijft in de bestaande tekstknoop (geen nieuwe knoop)', knoop.data === 'nieuw' && vervangen === 0);
  const leeg = { firstChild: null, _t: '', get textContent() { return this._t; }, set textContent(t) { this._t = t; vervangen++; } };
  zetTekst(leeg, 'a'); zetTekst(leeg, 'a');
  ok('zetTekst: zonder tekstknoop via textContent, en alleen als het anders is', leeg._t === 'a' && vervangen === 1);
}
const elfPanelen = ['renderloop', 'spiegel', 'auto-paneel', 'master-paneel', 'stems-paneel', 'klankschaal-paneel', 'beeld-paneel',
  'koptelefoon-paneel', 'instrument-paneel', 'patronen-paneel', 'logboek'];
ok('de panelen die elk beeld tekst zetten gebruiken zetTekst', elfPanelen.every((f) => /const tekst = zetTekst;/.test(lees(`../src/ui/${f}.js`))),
  elfPanelen.filter((f) => !/const tekst = zetTekst;/.test(lees(`../src/ui/${f}.js`))).join(', '));

// ---- per beeld, niet per bericht --------------------------------------------------
const spiegel = lees('../src/ui/spiegel.js');
ok('spiegel: shift, een mapje en de mapping herberekenen bij het volgende beeld (straks), niet in het MIDI-bericht',
  /mapping\.on\('shift', straks\)/.test(spiegel) && /lagen\.on\('change', straks\)/.test(spiegel) && /mapping\.on\('change', straks\)/.test(spiegel)
  && !/mapping\.on\('shift', herbereken\)/.test(spiegel));
ok('spiegel: markeer() zet geen timers en geen klassen per bericht (teken() doet het)',
  !/setTimeout/.test(spiegel.slice(spiegel.indexOf('function markeer'), spiegel.indexOf('function tekenGeraakt'))) && /tekenGeraakt\(\)/.test(spiegel));
ok('spiegel: geen regex per knop per beeld in teken() (sectie en lampOm staan op het item)',
  !/\.exec\(r\.action\)/.test(spiegel.slice(spiegel.indexOf('function teken('))));
const balk = lees('../src/ui/mapje-balk.js');
ok('mapje-balk: een mapje-wissel bouwt de uitleg bij het volgende beeld', /requestAnimationFrame\(toonStraks\)/.test(balk));

// ---- meters en bovenbalk -------------------------------------------------------------
ok('styles.css: staande meters met transform (scaleY), geen transition op height', /\.meter\.vmeter i\{[^}]*transform:scaleY\(0\)/.test(css) && !/\.meter\.vmeter i\{[^}]*transition:height/.test(css));
ok('spiegel/renderloop/master-paneel: meters via style.transform', /k\.meter\.style\.transform = hoogte/.test(spiegel)
  && /stijl\(masterMeter, 'transform'/.test(lees('../src/ui/renderloop.js')) && /grMeter\.style\.transform = schaal/.test(lees('../src/ui/master-paneel.js')));
const bovenbalk = lees('../src/ui/bovenbalk.js');
ok('bovenbalk: een ResizeObserver, geen timer die elke seconde opmaak afdwingt (alleen als terugval)',
  /new ResizeObserver/.test(bovenbalk) && /\} else setInterval\(kijk, 1000\);/.test(bovenbalk));

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
