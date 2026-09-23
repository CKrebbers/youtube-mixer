import { resolveTarget } from './mapping.js';

/**
 * LED-feedback: engine-stand -> lampjes op de controller.
 *
 * De truc is dat deze laag de MAPPING leest, niet de engine. Voor elke regel
 * kijkt hij welke action eraan hangt, leest die action zijn stand terug, en
 * zet het bijbehorende lampje. Koppel je een pad aan iets anders, dan verhuist
 * zijn LED vanzelf mee. Geen tweede tabel die uit de pas kan lopen.
 *
 * Er wordt gediffed: alleen wat veranderd is gaat de bus op. Het hele grid elke
 * frame versturen is 40 berichten per frame, en dat zie je als lag terug.
 */

/** Standaardkleur per soort action. Een regel kan dit overschrijven met "led". */
const KLEURSCHEMA = [
  [/\.hotcue\.\d+$/, { aan: 'geel', uit: 'donkergrijs' }],
  [/\.loop\.exit$/,  { aan: 'rood', uit: 'donkergrijs' }],
  [/\.loop\./,       { aan: 'cyaan', uit: 'donkergrijs' }],
  [/\.play$/,        { aan: 'groen', uit: 'donkergrijs' }],
  [/\.cue$/,         { aan: 'wit', uit: 'donkergrijs' }],
  [/\.focus$/,       { aan: 'oranje', uit: 'donkergrijs' }],
  [/^mixer\./,       { aan: 'blauw', uit: 'donkergrijs' }],
];

const kleurVoor = (actie) =>
  (KLEURSCHEMA.find(([re]) => re.test(actie)) || [null, { aan: 'wit', uit: 'donkergrijs' }])[1];

/** Wildcard-kanaal bestaat alleen inkomend; naar buiten moet het een getal zijn. */
const uitSig = (sig) => sig.replace(':*:', ':0:');

const ontleed = (sig) => {
  const m = /^(\w+):(\d+):(\d+)$/.exec(sig);
  return m ? { type: m[1], channel: +m[2], number: +m[3] } : null;
};

export class Feedback {
  /**
   * @param device  device-profiel (controls, palette, ring, init-sysex)
   * @param mapping de Mapping — hier staat wat waar zit
   * @param read    (actionId) -> 0..1 of null
   * @param meta    (actionId) -> { bipolar, ... } of null
   * @param send    (bytes) -> bool, en sendSysex voor de init
   */
  constructor({ device, mapping, read, meta, send, sendSysex }) {
    // send(bytes, opties) — opties gaan door naar de hub (bijv. { direct: true })
    this.device = device;
    this.mapping = mapping;
    this.read = read;
    this.meta = meta;
    this.send = send;
    this.sendSysex = sendSysex || send;
    this.vorige = new Map();     // sig -> laatst verstuurde bytes, als string
    this.gepauzeerd = false;     // staat aan tijdens de paletproef
    this.verstuurd = 0;
    this.klaar = false;
  }

  /**
   * Wakker maken: init-sysex, ringtypes, en alles opnieuw versturen.
   * Zonder die sysex blijven de meeste LED's dood, hoe vaak je ze ook aanstuurt.
   */
  init() {
    if (this.device.init) this.sendSysex(this.device.init);
    // Eerst het hele oppervlak schoonvegen. Wat wij niet aansturen blijft
    // anders branden met wat de vorige gebruiker erop achterliet — en dat lijkt
    // op een bug in onze eigen feedback terwijl het een spook is.
    this.blackout();
    this.ringTypes();
    this.invalidate();
    this.klaar = true;
  }

  /** Ringstand per knop: bipolaire parameters pan-stijl, de rest volume-stijl. */
  ringTypes() {
    const ring = this.device.ring;
    if (!ring || !this.device.ringFor) return;
    for (const regel of this.mapping.rules.values()) {
      const ringSig = this.device.ringFor(uitSig(regel.in));
      if (!ringSig) continue;
      const doel = resolveTarget(regel.action, this.mapping.vars());
      const m = this.meta ? this.meta(doel) : null;
      const p = ontleed(ringSig);
      if (p) this.send([0xb0 | p.channel, p.number, m?.bipolar ? ring.pan : ring.volume]);
    }
  }

  /** Volgende tick alles opnieuw sturen — na init, mapping-wissel of herverbinden. */
  invalidate() { this.vorige.clear(); }

  /** Wat zou er nu moeten branden? Geeft sig -> bytes. */
  desired() {
    const uit = new Map();
    const vars = this.mapping.vars();
    const palet = this.device.palette || {};
    const gedrag = this.device.behaviour || {};

    for (const regel of this.mapping.rules.values()) {
      const sig = uitSig(regel.in);
      const control = this.device.controls.get(sig);
      if (!control) continue;

      const doel = resolveTarget(regel.action, vars);
      const waarde = this.read ? this.read(doel) : null;
      if (waarde === null) continue;
      const p = ontleed(sig);
      if (!p) continue;

      if (control.kind === 'knob') {
        // Geen lampje maar een ring: die toont de SOFTWARE-stand. Precies wat
        // je wilt zien als een knop nog niet overgepakt heeft.
        uit.set(sig, [0xb0 | p.channel, p.number, Math.round(waarde * 127)]);
        continue;
      }
      if (!control.led) continue;

      const kleur = { ...kleurVoor(regel.action), ...(regel.led || {}) };
      const naam = waarde > 0 ? kleur.aan : kleur.uit;
      const vel = typeof naam === 'number' ? naam : (palet[naam] ?? 0);

      if (control.led === 'rgb') {
        const kanaal = gedrag[kleur.mode] ?? gedrag.vast ?? 0;
        uit.set(sig, [0x90 | kanaal, p.number, vel]);
      } else {
        // Eenkleurig: alleen aan of uit, kanaal doet er niet toe.
        uit.set(sig, [0x90 | p.channel, p.number, waarde > 0 ? 127 : 0]);
      }
    }
    return uit;
  }

  /**
   * Stuurt alleen de verschillen. `max` houdt een volledige verversing binnen
   * een paar frames in plaats van in één klap 60 berichten op de bus te gooien.
   */
  tick(max = 24) {
    if (this.gepauzeerd || !this.klaar) return 0;
    const wil = this.desired();
    let n = 0;
    for (const [sig, bytes] of wil) {
      const sleutel = bytes.join(',');
      if (this.vorige.get(sig) === sleutel) continue;
      this.send(bytes);
      this.vorige.set(sig, sleutel);
      this.verstuurd++;
      if (++n >= max) break;
    }
    return n;
  }

  /**
   * Alle LED's uit — bij wakker maken, afsluiten en na de paletproef.
   * Loopt over ALLES wat het apparaat aan lampjes heeft, niet alleen over wat
   * wij toevallig aansturen.
   */
  blackout({ alles = true, direct = false } = {}) {
    const lijst = alles && this.device.allLeds ? this.device.allLeds() : [...this.vorige.keys()];
    for (const sig of lijst) {
      const p = ontleed(sig);
      if (p) this.send([(p.type === 'cc' ? 0xb0 : 0x90) | p.channel, p.number, 0], { direct });
    }
    this.vorige.clear();
    return lijst.length;
  }

  /**
   * Paletproef: legt 40 velocity-waarden op het grid zodat je de kleuren uit
   * het protocoldocument met eigen ogen kunt controleren in plaats van ze te
   * geloven. Pagina 0 = velocity 0-39, pagina 1 = 40-79, enzovoort.
   */
  paletteProef(pagina = 0) {
    const g = this.device.grid;
    if (!g) return [];
    this.gepauzeerd = true;
    const uit = [];
    for (let rij = 1; rij <= g.rows; rij++) {
      for (let kol = 1; kol <= g.cols; kol++) {
        const i = (rij - 1) * g.cols + (kol - 1);
        const vel = pagina * (g.cols * g.rows) + i;
        const noot = this.device.gridNote(kol, rij);
        if (vel <= 127) this.send([0x90, noot, vel]);
        else this.send([0x90, noot, 0]);
        uit.push({ kol, rij, vel: vel <= 127 ? vel : null, noot });
      }
    }
    return uit;
  }

  stopProef() {
    this.gepauzeerd = false;
    this.blackout();     // de proef kleurt ook pads die nergens aan hangen
    this.invalidate();
  }
}
