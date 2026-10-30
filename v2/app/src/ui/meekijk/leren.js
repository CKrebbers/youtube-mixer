/**
 * Leren (leren.html): wat je net aanraakte en wat het doet (het etiket van de Maschine, groter, met het
 * bereik), wat er nu vanzelf loopt (processen, de avond, takes, de zaal), de opdracht van de tocht, en een
 * logboek van wat je deed en wat het systeem meldde. Een staand venster naast het hoofdvenster.
 */
import { PROCESSEN, procesVan } from '../../kern/opstelling/proces.js';
import { verbind, esc } from './verbind.js';

const LOG_MAX = 60;
const SAMEN_MS = 1200;    // dezelfde knop binnen deze tijd = één regel (een fader die je beweegt)
const TEKEN_MS = 150;
const HANDEN = new Set(['apc', 'maschine', 'toetsen', 'scherm']);

const $ = (s) => document.querySelector(s);
const nuEl = $('#nu'), loopEl = $('#loopt'), tochtEl = $('#tocht'), logEl = $('#log');

const pct = (v) => `${Math.round(v * 100)}%`;
const klok = () => new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Uitleg bij een actie: een proces vertelt wat het doet, anders het label van de bus. */
function uitlegVan(bus, id) {
  const m = /^opstelling\.proces\.(\w+)/.exec(id);
  const p = m ? (/^\d+$/.test(m[1]) ? PROCESSEN[Number(m[1]) - 1] : procesVan(m[1])) : null;
  if (p) return p.uitleg;
  const def = bus.zoek(id)?.def;
  return def?.meta?.uitleg ?? def?.label ?? '';
}

function tekenNu(g, bus, vorig) {
  const sleutel = g ? `${g.id}|${g.t}|${g.etiket.tekst}` : '';
  if (sleutel === vorig.nu) return;
  vorig.nu = sleutel;
  if (!g) { nuEl.innerHTML = '<p class="dim">Raak een knop aan op de APC of de Maschine: hier staat dan wat hij doet.</p>'; return; }
  const e = g.etiket;
  nuEl.innerHTML = `<div class="waar">${esc(e.waar)}</div>
    <div class="naam">${esc(e.naam)}</div>
    <div class="waarde">${esc(e.tekst)}</div>
    ${e.v !== null ? `<div class="balk"><i style="width:${pct(e.v)}"></i></div>` : ''}
    ${e.bereik ? `<div class="bereik">${esc(e.bereik)}</div>` : ''}
    <p class="uitleg">${esc(uitlegVan(bus, g.id))}</p>
    <code>${esc(g.id)}</code>`;
}

function tekenLoopt(st, zaal, vorig) {
  const regels = [];
  for (const p of st.processen ?? []) regels.push(`<li><b>${esc(p.naam)}</b> ${p.eindeloos ? 'loopt door' : `<span class="balk klein"><i style="width:${pct(p.p ?? 0)}"></i></span> ${p.maten} maten`}</li>`);
  if (st.avond) regels.push(`<li><b>de avond</b> station ${st.avond.station}/${st.avond.van}, ronde ${st.avond.ronde}${st.avond.vrij ? ', vrij' : ''}</li>`);
  if (st.loop) regels.push(`<li><b>laten lopen</b> ${esc(st.loop.deel)} maat ${st.loop.m}/${st.loop.maten} (${st.loop.gedaan}/${st.loop.totaal})</li>`);
  if (st.take?.neemt) regels.push(`<li><b>REC</b> take, maat ${st.take.maten}</li>`);
  if (st.take?.speelt) regels.push(`<li><b>take</b> ${esc(st.take.speelt)}</li>`);
  if (st.glij) regels.push(`<li><b>glijdt</b> naar ${esc(st.glij)}</li>`);
  if (st.zaalMee) {
    const z = zaal?.stand?.() ?? {};
    regels.push(`<li><b>de zaal</b> beweging ${z.beweging === null || z.beweging === undefined ? '—' : pct(z.beweging)}, geluid ${z.geluid === null || z.geluid === undefined ? '—' : pct(z.geluid)}</li>`);
  }
  const kop = `<div class="opst">${esc(st.naam ?? 'geen opstelling')}${st.zaad !== null && st.zaad !== undefined ? ` <span class="dim">zaad ${esc(st.zaad)}</span>` : ''}</div>`;
  const html = kop + (regels.length ? `<ul>${regels.join('')}</ul>` : '<p class="dim">Niets loopt vanzelf. Groep H op de Maschine start een proces; SESSION op de APC laat de avond lopen.</p>');
  if (html === vorig.loopt) return;
  vorig.loopt = html;
  loopEl.innerHTML = html;
}

function tekenTocht(t, vorig) {
  let html;
  if (!t) html = '<p class="dim">Geen tocht.</p>';
  else if (t.hoofdstuk < t.aantal) {
    html = `<div class="opst">Hoofdstuk ${t.hoofdstuk + 1}/${t.aantal} · ${esc(t.titel)}</div><p>${esc(t.uitleg)}</p>
      <ul>${t.doelen.map((d) => `<li class="${d.gedaan >= d.nodig ? 'af' : ''}">${esc(d.wat)} <span class="dim">${d.gedaan}/${d.nodig}</span></li>`).join('')}</ul>`;
  } else html = `<div class="opst">De tocht is uit</div><p class="dim">${t.klaar}/${t.aantal} hoofdstukken, ${t.ontdekt} ontdekt. Je bent vrij.</p>`;
  if (html === vorig.tocht) return;
  vorig.tocht = html;
  tochtEl.innerHTML = html;
}

verbind(({ engine, bus, opstelling }) => {
  const log = [];
  let logVeranderd = true;
  const zaal = window.opener?.varveZaal;
  function schrijf(soort, tekst, sleutel = null) {
    const nu = performance.now();
    const laatste = log[0];
    if (sleutel && laatste?.sleutel === sleutel && nu - laatste.t < SAMEN_MS) Object.assign(laatste, { tekst, t: nu, tijd: klok() });
    else log.unshift({ soort, tekst, sleutel, t: nu, tijd: klok() });
    if (log.length > LOG_MAX) log.length = LOG_MAX;
    logVeranderd = true;
  }
  const weg = [
    bus.on('actie', (a) => {
      // Alleen wat JIJ doet; wat processen en drift zelf zetten zou het logboek 20 keer per seconde vullen.
      if (!HANDEN.has(a.bron) || a.meta?.log === 'overslaan' || /^laag:/.test(a.id)) return;
      const z = bus.zoek(a.id);
      if (z?.def.soort === 'trigger' && a.v === false) return;
      const waarde = typeof a.v === 'number' ? ` ${pct(a.v)}` : '';
      const wie = a.bron === 'apc' ? 'APC' : a.bron === 'maschine' ? 'Maschine' : a.bron;
      schrijf('actie', `${wie}: ${z?.def.label ?? a.id}${waarde}`, `${a.bron}:${a.id}`);
    }),
    engine.on('melding', ({ tekst, soort }) => schrijf(soort === 'fout' ? 'fout' : 'melding', tekst)),
  ];
  const vorig = { nu: null, loopt: null, tocht: null };
  const timer = setInterval(() => {
    tekenNu(opstelling.gepakt(), bus, vorig);
    tekenLoopt(engine.opstelling.stand(), zaal, vorig);
    tekenTocht(engine.tocht?.stand() ?? null, vorig);
    if (logVeranderd) {
      logVeranderd = false;
      logEl.innerHTML = log.map((r) => `<li class="${r.soort}"><time>${r.tijd}</time> ${esc(r.tekst)}</li>`).join('');
    }
  }, TEKEN_MS);
  return () => { for (const w of weg) w(); clearInterval(timer); };
}, $('#hint'));
