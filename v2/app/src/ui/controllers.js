/**
 * De controllers in het venster: de enige plek waar src/control/ het venster
 * raakt (navigator.requestMIDIAccess, navigator.locks, keydown, fetch).
 *
 *   const ctl = opzetControllers({ bus, vars: { focus: () => n }, tel: () => fase, meld });
 *   ctl.kiesVoorNummer(id)        // de indeling van dit nummer (of de standaard), APC en toetsen
 *   ctl.leer('track.{focus}.fx.mix', 'apc')   // de volgende control die je beweegt
 *   ctl.status()                  // { tabblad, midi, controller, hub, indeling, toetsen }
 *
 * MIDI alleen in het tabblad met de Web Lock 'varve-v2-mixer': een tweede
 * tabblad vraagt GEEN MIDI-toegang (v1 23 sep: Chrome's MIDI-dienst crashte met
 * vier tabbladen die tegelijk init en lampjes stuurden). Het toetsenbord werkt
 * in elk tabblad (het stuurt alleen de mixer van dat tabblad).
 *
 * MET DE HUB (`?hub=ws://…`, control/hub-vlag.js; de querystring komt uit
 * `venster.location.search` of de optie `zoek`): de APC komt van de AV-app-hub
 * (control/hub.js, pas dan dynamisch geladen) in plaats van Web MIDI. Dan wordt
 * requestMIDIAccess NOOIT gevraagd, en de Web Lock beslist niets over MIDI: het
 * hub-tabblad verbindt meteen, ook als een ander tabblad de lock heeft (twee
 * hub-tabbladen regelt de hub: de nieuwste wint, de oude krijgt 4001 en meldt het).
 * De lock wordt nog wel gevraagd: heeft dit tabblad hem, dan opent een gewoon
 * tabblad (zonder vlag) geen Web MIDI naast de hub. Keyboards (noten.js) gaan
 * met de hub niet: die komen via Web MIDI, en de speelapparaten van de hub
 * (PROTOCOL §17) kent v2 nog niet.
 */
import { Emitter } from '../kern/emitter.js';
import { MidiHub, parseBericht } from '../control/midi.js';
import { apc40mk2 } from '../control/apparaten/apc40mk2.js';
import { toetsen as toetsenApparaat } from '../control/apparaten/toetsen.js';
import { maschineMk2 } from '../control/apparaten/maschine-mk2.js';
import { Indeling } from '../control/indeling.js';
import { Lampjes } from '../control/lampjes.js';
import { Toetsen, isTypenVeld } from '../control/toetsen.js';
import { Leren } from '../control/leren.js';
import { bewaakTabblad, LOCK_NAAM } from '../control/tabblad.js';
import { Noten } from '../control/noten.js';
import { hubAdres, hubGeweigerd } from '../control/hub-vlag.js';
import { Speeltuin } from '../control/speeltuin.js';

/**
 * @param bus        de bus van de engine
 * @param vars       { focus: () => n } (en wat een indeling verder gebruikt)
 * @param tel        () -> fase 0..1 van de klok zoals je hem hoort (of { fase, een }, of null)
 * @param meld       (tekst, soort, sleutel) -> de meldingenstrook
 * @param indelingen { apc40mk2: doc | [docs], toetsen: doc | [docs] }; zonder: ophalen uit `basis`
 * @param basis      waar de standaardindelingen staan ('/indelingen/')
 * @param statusEl   een element waar de status als tekst in komt (optioneel)
 * @param zoek       de querystring (standaard venster.location.search): ?hub=ws://… = de APC via de hub
 * @param WS         de WebSocket-klasse voor de hub (standaard die van het venster)
 * @param laadHub    () -> import van control/hub.js (alleen met de vlag aangeroepen)
 */
/** De indelingen die het hele systeem zijn (de rest is per nummer of eigen): kiezen = de standaard worden. */
export const SYSTEEM_INDELINGEN = Object.freeze(['standaard', 'hybride', 'speeltuin']);

export function opzetControllers({ bus, vars = {}, tel = () => null, meld = () => {}, indelingen = null, basis = '/indelingen/', noten = null,
  statusEl = null, nav = globalThis.navigator, venster = globalThis.window, doc = globalThis.document, haal = globalThis.fetch?.bind(globalThis),
  zoek = venster?.location?.search ?? '', WS = globalThis.WebSocket, laadHub = () => import('../control/hub.js') } = {}) {
  const uit = new Emitter();
  const apc = new Indeling({ bus, apparaat: apc40mk2, vars, bron: 'apc' });
  const toetsInd = new Indeling({ bus, apparaat: toetsenApparaat, vars, bron: 'toetsen' });
  // De Maschine MK2 speelt alleen via de hub (PROTOCOL §17): de hub leest hem via USB-HID.
  const msc = new Indeling({ bus, apparaat: maschineMk2, vars, bron: 'maschine' });
  let mscLampjes = null;
  let mscPoort = null;
  const leren = { apc: new Leren({ indeling: apc }), toetsen: new Leren({ indeling: toetsInd }) };
  // De speeltuin (?indeling=speeltuin): lege toestellen die je spelend vult (src/control/speeltuin.js).
  const speeltuin = new Speeltuin({ bus, indelingen: { apc, maschine: msc } });
  speeltuin.on('melding', ({ tekst, soort }) => meld(tekst, soort, 'ctl:speeltuin'));
  const naarApc = (g) => { if (!speeltuin.voer('apc', g)) apc.verwerk(g); };
  const hubUrl = hubAdres(zoek);
  const stand = { tabblad: 'wacht', midi: 'uit', controller: null, hub: null };
  let hub = null;
  let notenLaag = null;
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
      const h = s.hub;
      statusEl.textContent = s.controller
        ? `${s.controller}${h && !h.focus ? ' (geen focus)' : ''} · ${s.indeling ?? '—'}${s.lagen.length ? ` · ${s.lagen.join(', ')}` : ''}`
        : h ? (h.vervangen ? 'APC (hub): ander tabblad' : `APC (hub): ${s.midi}`)
          : s.tabblad === 'tweede' ? 'APC: ander tabblad' : `APC: ${s.midi}`;
      statusEl.title = `toetsen: ${s.toetsen ?? '—'}`;
    }
    uit.emit('status', s);
  };

  // ---- meldingen van de indelingen -------------------------------------------------
  for (const [naam, ind] of [['APC', apc], ['toetsen', toetsInd], ['Maschine', msc]]) {
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
    for (const [ind, naam] of [[apc, 'apc40mk2'], [toetsInd, 'toetsen'], [msc, 'maschine-mk2']]) {
      try { laadIn(ind, indelingen?.[naam] ?? await haalDoc(naam)); } catch (fout) { meld(`indeling ${naam} niet geladen: ${fout.message ?? fout}`, 'fout', `ctl:indeling:${naam}`); }
    }
    // De Hybride-indeling (v2/HYBRIDE.md) naast de standaard; kiezen in het indelingspaneel of met ?indeling=hybride.
    if (!indelingen) {
      try { laadIn(apc, await haalDoc('apc40mk2-hybride')); } catch (fout) { meld(`indeling hybride niet geladen: ${fout.message ?? fout}`, 'fout', 'ctl:indeling:hybride'); }
      // Een systeemindeling (standaard of hybride) wordt de STANDAARD: de indeling per nummer valt daarop terug
      // (anders zou elke focuswissel, in Hybride Track Select = vastpakken, de APC terugzetten naar de DJ-indeling).
      let gevraagd = new URLSearchParams(zoek).get('indeling');
      if (!gevraagd) { try { gevraagd = venster?.localStorage?.getItem('varve.v2.indeling'); } catch { gevraagd = null; } }
      if (gevraagd === 'speeltuin') speeltuin.start();
      else if (gevraagd && SYSTEEM_INDELINGEN.includes(gevraagd) && apc.namen().includes(gevraagd)) { apc.zetStandaard(gevraagd); apc.kies(gevraagd); }
    }
    meldStatus();
  })();

  // ---- toetsenbord (elk tabblad) ------------------------------------------------------
  const toetsen = new Toetsen({ indeling: toetsInd, isTypen: isTypenVeld, leren: leren.toetsen });
  const losToetsen = venster ? toetsen.koppel(venster, doc) : () => {};

  // ---- de bron van de APC: Web MIDI (MidiHub) of de hub (HubMidi), daarna precies hetzelfde ----
  const koppel = (bron) => {
    hub = bron;
    lampjes = new Lampjes({ indeling: apc, stuur: (b, o) => hub.stuur(b, o), stuurSysex: (b) => hub.stuurSysex(b), tel });
    hub.on('verbonden', (p) => { stand.controller = p?.name ?? apc40mk2.naam; lampjes.init(); meld(`${stand.controller} verbonden`, 'info', 'ctl:midi'); meldStatus(); });
    hub.on('invoer', (p) => { stand.controller = p?.name ?? apc40mk2.naam; meldStatus(); });
    hub.on('weg', () => {
      apc.losgekoppeld();   // shift en alles wat vastzat los (bediening-041)
      lampjes.klaar = false;
      stand.controller = null;
      meld(hubUrl ? 'hub weg: alles losgelaten, opnieuw verbinden' : 'APC losgekoppeld: alles losgelaten', 'info', 'ctl:midi');
      meldStatus();
    });
    hub.on('fout', (fout) => meld(`MIDI: ${fout?.message ?? fout}`, 'fout', 'ctl:midi'));
    hub.on('bericht', (m) => {
      const g = apc40mk2.ontleed(m);
      if (!g) return;
      if (leren.apc.bezig) leren.apc.voer(g); else naarApc(g);
    });
  };

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
    koppel(new MidiHub({ toegang, voorkeur: apc40mk2.zoek }));
    // Keyboards (elke ingang behalve de controller): noten naar de ontvanger (de engine).
    if (noten) {
      const isApc = (p) => (apc40mk2.zoek instanceof RegExp ? apc40mk2.zoek.test(p?.name ?? '') : !!apc40mk2.zoek?.(p?.name ?? ''));
      notenLaag = new Noten({ toegang, ontvanger: noten, isController: isApc });
      notenLaag.start();
    }
    stand.midi = 'aan';
    lampjes.start();
    hub.start();
    meldStatus();
  };

  // ---- de hub (?hub=): geen Web MIDI, geen wachten op de lock ----------------------------------
  const startHub = async () => {
    stand.midi = 'hub laden';
    meldStatus();
    let mod;
    try { mod = await laadHub(); } catch (fout) {
      stand.midi = 'hub niet geladen';
      meld(`hub: ${fout?.message ?? fout}`, 'fout', 'ctl:hub');
      meldStatus();
      return;
    }
    await geladen;
    if (gestopt) return;
    const bron = new mod.HubMidi({ url: hubUrl, bus, WS });
    koppel(bron);
    let vervangen = false;
    bron.on('hub', (h) => {
      stand.hub = h;
      stand.midi = h.verbonden ? 'verbonden' : h.vervangen ? 'vervangen' : 'verbinden';
      if (h.vervangen !== vervangen) {
        vervangen = h.vervangen;
        // Zelfde sleutel: de rode melding wordt "weer verbonden" (info, gaat vanzelf weg).
        if (vervangen) meld('een nieuwer VarveDJ-tabblad heeft de hub; dit tabblad probeert het over 30 s opnieuw', 'fout', 'ctl:hub');
        else meld('hub: weer verbonden', 'info', 'ctl:hub');
      }
      meldStatus();
    });
    stand.hub = bron.status().hub;
    stand.midi = 'verbinden';
    koppelMaschine(bron.speelPoort?.('maschine-mk2'));
    lampjes.start();
    bron.start();
    meldStatus();
  };
  // ---- de Maschine: zijn eigen nep-poort van de hub, met indeling en lampjes zoals de APC ----
  const koppelMaschine = (poort) => {
    if (!poort) return;
    mscPoort = poort;
    mscLampjes = new Lampjes({ indeling: msc, stuur: (b) => poort.uit.send(b), tel });
    poort.in.onmidimessage = (e) => {
      const g = maschineMk2.ontleed(parseBericht(e.data));
      if (g && !speeltuin.voer('maschine', g)) msc.verwerk(g);
    };
    poort.in.onstatechange = (e) => {
      if (e.port.state === 'connected') { mscLampjes.init(); uit.emit('maschine', true); }
      else { msc.losgekoppeld(); mscLampjes.klaar = false; uit.emit('maschine', false); }
    };
    mscLampjes.start();
  };

  let gestopt = false;
  const geweigerd = hubGeweigerd(zoek);
  if (geweigerd) meld(`hub ${geweigerd} niet gebruikt: niet op deze machine, het LAN of de tailnet (met &hub_extern=1 wel); de APC via Web MIDI`, 'fout', 'ctl:hub');

  const tabblad = bewaakTabblad(nav?.locks, LOCK_NAAM);
  // Met de hub beslist de lock niets over MIDI: meteen verbinden, en de lock alleen als bescherming tegen een gewoon tabblad.
  tabblad.on('eerste', () => { stand.tabblad = 'eerste'; if (hubUrl) meldStatus(); else startMidi(); });
  tabblad.on('tweede', () => {
    stand.tabblad = 'tweede';
    if (!hubUrl) meld('een ander VarveDJ-tabblad praat met de APC; dit tabblad neemt het over als dat sluit', 'info', 'ctl:tabblad');
    meldStatus();
  });
  if (hubUrl) startHub();

  // Bij het sluiten de lampjes uit, direct (er komt geen volgende tik).
  const opPagehide = () => { if (lampjes?.klaar) lampjes.zwart({ direct: true }); };
  venster?.addEventListener?.('pagehide', opPagehide);

  // defineProperties, niet Object.assign: die leest een getter één keer uit (hub en lampjes bleven dan null).
  return Object.defineProperties(uit, Object.getOwnPropertyDescriptors({
    apc, toetsen: toetsInd, maschine: msc, leren, geladen, speeltuin,
    /** De schermen van de Maschine (0 links, 1 rechts; 2048 bytes), of null zonder hub. */
    get maschineScherm() { return mscPoort?.in.state === 'connected' ? mscPoort.scherm : null; },
    get hub() { return hub; },
    get lampjes() { return lampjes; },
    status,
    /** Een nummer krijgt focus of wordt geladen: zijn indeling, of de standaard (APC en toetsen). */
    kiesVoorNummer(id) { const n = apc.kiesVoorNummer(id); toetsInd.kiesVoorNummer(id); meldStatus(); return n; },
    /** Leren: de volgende control van dit apparaat ('apc' of 'toetsen') krijgt deze actie. */
    leer(actie, apparaat = 'apc', opties) { leren[apparaat].start(actie, opties); meldStatus(); },
    stopLeren() { leren.apc.stop(); leren.toetsen.stop(); meldStatus(); },
    stop() {
      gestopt = true;
      losToetsen();
      venster?.removeEventListener?.('pagehide', opPagehide);
      lampjes?.stop();
      mscLampjes?.stop();
      notenLaag?.stop();
      hub?.stop();
    },
  }));
}
