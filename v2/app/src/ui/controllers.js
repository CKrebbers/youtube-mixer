/**
 * De controllers in het venster: de enige plek waar src/control/ het venster
 * raakt (navigator.requestMIDIAccess, navigator.locks, keydown, fetch).
 *
 *   const ctl = opzetControllers({ bus, vars: { focus: () => n }, tel: () => fase, meld });
 *   ctl.kiesVoorNummer(id)        // de indeling van dit nummer (of de standaard), APC en toetsen
 *   ctl.leer('track.{focus}.fx.mix', 'apc')   // de volgende control die je beweegt
 *   ctl.status()                  // { tabblad, midi, controller, indeling, toetsen }
 *
 * MIDI alleen in het tabblad met de Web Lock 'varve-v2-mixer': een tweede
 * tabblad vraagt GEEN MIDI-toegang (v1 23 sep: Chrome's MIDI-dienst crashte met
 * vier tabbladen die tegelijk init en lampjes stuurden). Het toetsenbord werkt
 * in elk tabblad (het stuurt alleen de mixer van dat tabblad).
 */
import { Emitter } from '../kern/emitter.js';
import { MidiHub } from '../control/midi.js';
import { apc40mk2 } from '../control/apparaten/apc40mk2.js';
import { toetsen as toetsenApparaat } from '../control/apparaten/toetsen.js';
import { Indeling } from '../control/indeling.js';
import { Lampjes } from '../control/lampjes.js';
import { Toetsen, isTypenVeld } from '../control/toetsen.js';
import { Leren } from '../control/leren.js';
import { bewaakTabblad, LOCK_NAAM } from '../control/tabblad.js';

/**
 * @param bus        de bus van de engine
 * @param vars       { focus: () => n } (en wat een indeling verder gebruikt)
 * @param tel        () -> fase 0..1 van de klok zoals je hem hoort (of { fase, een }, of null)
 * @param meld       (tekst, soort, sleutel) -> de meldingenstrook
 * @param indelingen { apc40mk2: doc | [docs], toetsen: doc | [docs] }; zonder: ophalen uit `basis`
 * @param basis      waar de standaardindelingen staan ('/indelingen/')
 * @param statusEl   een element waar de status als tekst in komt (optioneel)
 */
export function opzetControllers({ bus, vars = {}, tel = () => null, meld = () => {}, indelingen = null, basis = '/indelingen/',
  statusEl = null, nav = globalThis.navigator, venster = globalThis.window, doc = globalThis.document, haal = globalThis.fetch?.bind(globalThis) } = {}) {
  const uit = new Emitter();
  const apc = new Indeling({ bus, apparaat: apc40mk2, vars, bron: 'apc' });
  const toetsInd = new Indeling({ bus, apparaat: toetsenApparaat, vars, bron: 'toetsen' });
  const leren = { apc: new Leren({ indeling: apc }), toetsen: new Leren({ indeling: toetsInd }) };
  const stand = { tabblad: 'wacht', midi: 'uit', controller: null };
  let hub = null;
  let lampjes = null;

  const status = () => ({
    ...stand,
    indeling: apc.actief?.naam ?? null,
    toetsen: toetsInd.actief?.naam ?? null,
    lagen: [...apc.open],
    leren: leren.apc.bezig || leren.toetsen.bezig,
  });
  const meldStatus = () => {
    const s = status();
    if (statusEl) {
      statusEl.textContent = s.controller
        ? `${s.controller} · ${s.indeling ?? '—'}${s.lagen.length ? ` · ${s.lagen.join(', ')}` : ''}`
        : s.tabblad === 'tweede' ? 'APC: ander tabblad' : `APC: ${s.midi}`;
      statusEl.title = `toetsen: ${s.toetsen ?? '—'}`;
    }
    uit.emit('status', s);
  };

  // ---- meldingen van de indelingen -------------------------------------------------
  for (const [naam, ind] of [['APC', apc], ['toetsen', toetsInd]]) {
    ind.on('onbekend', ({ doel }) => meld(`${naam}: "${doel}" bestaat (nog) niet`, 'info', `ctl:onbekend:${doel}`));
    ind.on('melding', ({ tekst, soort }) => meld(tekst, soort, `ctl:${naam}`));
    ind.on('fout', ({ doel, fout }) => meld(`${naam}: ${doel}: ${fout?.message ?? fout}`, 'fout', `ctl:fout:${doel}`));
    ind.on('verander', meldStatus);
    ind.on('laag', meldStatus);
  }
  for (const [naam, l] of Object.entries(leren)) {
    l.on('gekoppeld', ({ regel, was, label }) => {
      meld(`${label}: ${regel.actie}${regel.shift ? ' (shift)' : ''}${regel.laag ? ` in ${regel.laag}` : ''}${was ? ` (was ${was})` : ''}`, 'info', `ctl:leren:${naam}`);
      uit.emit('geleerd', { apparaat: naam, indeling: (naam === 'apc' ? apc : toetsInd).naarJSON() });
      meldStatus();
    });
    l.on('niet', ({ control, reden }) => meld(`${control}: ${reden}`, 'fout', `ctl:leren:${naam}`));
  }

  // ---- indelingen laden -------------------------------------------------------------
  const laadIn = (ind, docs) => {
    for (const d of Array.isArray(docs) ? docs : [docs]) {
      try {
        const { naam, fouten } = ind.voegToe(d);
        if (fouten.length) meld(`indeling "${naam}" (${ind.apparaat.naam}): ${fouten.length} regel(s) overgeslagen: ${fouten[0]}`, 'fout', `ctl:indeling:${ind.apparaat.id}`);
      } catch (fout) { meld(String(fout.message ?? fout), 'fout', `ctl:indeling:${ind.apparaat.id}`); }
    }
  };
  const haalDoc = async (naam) => {
    const r = await haal(`${basis}${naam}.json`, { cache: 'no-store' });
    const tekst = await r.text();   // ook bij een fout lezen (v1 leesWeg: anders houdt Chrome hem vast)
    if (!r.ok) throw new Error(`${basis}${naam}.json: ${r.status}`);
    return JSON.parse(tekst);
  };
  const geladen = (async () => {
    for (const [ind, naam] of [[apc, 'apc40mk2'], [toetsInd, 'toetsen']]) {
      try { laadIn(ind, indelingen?.[naam] ?? await haalDoc(naam)); } catch (fout) { meld(`indeling ${naam} niet geladen: ${fout.message ?? fout}`, 'fout', `ctl:indeling:${naam}`); }
    }
    meldStatus();
  })();

  // ---- toetsenbord (elk tabblad) ------------------------------------------------------
  const toetsen = new Toetsen({ indeling: toetsInd, isTypen: isTypenVeld, leren: leren.toetsen });
  const losToetsen = venster ? toetsen.koppel(venster, doc) : () => {};

  // ---- MIDI (alleen het eerste tabblad) --------------------------------------------------
  const startMidi = async () => {
    if (!nav?.requestMIDIAccess) { stand.midi = 'geen Web MIDI (Chrome nodig)'; meld('Web MIDI ontbreekt: gebruik Chrome', 'fout', 'ctl:midi'); meldStatus(); return; }
    stand.midi = 'toestemming vragen';
    meldStatus();
    let toegang;
    try { toegang = await nav.requestMIDIAccess({ sysex: true }); } catch (_) {
      try {
        toegang = await nav.requestMIDIAccess({ sysex: false });
        meld('MIDI zonder sysex: de APC blijft in zijn eigen modus en de lampjes grotendeels dood', 'fout', 'ctl:midi');
      } catch (fout) { stand.midi = 'geen toestemming'; meld(`MIDI: ${fout?.message ?? fout}`, 'fout', 'ctl:midi'); meldStatus(); return; }
    }
    await geladen;
    hub = new MidiHub({ toegang, voorkeur: apc40mk2.zoek });
    lampjes = new Lampjes({ indeling: apc, stuur: (b, o) => hub.stuur(b, o), stuurSysex: (b) => hub.stuurSysex(b), tel });
    hub.on('verbonden', (p) => { stand.controller = p?.name ?? apc40mk2.naam; lampjes.init(); meld(`${stand.controller} verbonden`, 'info', 'ctl:midi'); meldStatus(); });
    hub.on('invoer', (p) => { stand.controller = p?.name ?? apc40mk2.naam; meldStatus(); });
    hub.on('weg', () => {
      apc.losgekoppeld();   // shift en alles wat vastzat los (bediening-041)
      lampjes.klaar = false;
      stand.controller = null;
      meld('APC losgekoppeld: alles losgelaten', 'info', 'ctl:midi');
      meldStatus();
    });
    hub.on('fout', (fout) => meld(`MIDI: ${fout?.message ?? fout}`, 'fout', 'ctl:midi'));
    hub.on('bericht', (m) => {
      const g = apc40mk2.ontleed(m);
      if (!g) return;
      if (leren.apc.bezig) leren.apc.voer(g); else apc.verwerk(g);
    });
    stand.midi = 'aan';
    lampjes.start();
    hub.start();
    meldStatus();
  };

  const tabblad = bewaakTabblad(nav?.locks, LOCK_NAAM);
  tabblad.on('eerste', () => { stand.tabblad = 'eerste'; startMidi(); });
  tabblad.on('tweede', () => {
    stand.tabblad = 'tweede';
    meld('een ander VarveDJ-tabblad praat met de APC; dit tabblad neemt het over als dat sluit', 'info', 'ctl:tabblad');
    meldStatus();
  });

  // Bij het sluiten de lampjes uit, direct (er komt geen volgende tik).
  const opPagehide = () => { if (lampjes?.klaar) lampjes.zwart({ direct: true }); };
  venster?.addEventListener?.('pagehide', opPagehide);

  return Object.assign(uit, {
    apc, toetsen: toetsInd, leren, geladen,
    get hub() { return hub; },
    get lampjes() { return lampjes; },
    status,
    /** Een nummer krijgt focus of wordt geladen: zijn indeling, of de standaard (APC en toetsen). */
    kiesVoorNummer(id) { const n = apc.kiesVoorNummer(id); toetsInd.kiesVoorNummer(id); meldStatus(); return n; },
    /** Leren: de volgende control van dit apparaat ('apc' of 'toetsen') krijgt deze actie. */
    leer(actie, apparaat = 'apc', opties) { leren[apparaat].start(actie, opties); meldStatus(); },
    stopLeren() { leren.apc.stop(); leren.toetsen.stop(); meldStatus(); },
    stop() {
      losToetsen();
      venster?.removeEventListener?.('pagehide', opPagehide);
      lampjes?.stop();
      hub?.stop();
    },
  });
}
