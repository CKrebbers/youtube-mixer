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

/**
 * Standaardkleur per soort action. Een regel kan dit overschrijven met "led".
 *
 * Drie standen uit read(): 0 = `uit`, ertussen = `half`, 1 = `aan` (zonder
 * `half` telt ertussen als aan). Kleurbetekenis (VRAGEN B4): read null = uit
 * (niets te doen: hotcue op een lege track, loop zonder grid) · donkergrijs =
 * leeg maar bruikbaar · <kleur>donker = gevuld/dicht · volle kleur = actief ·
 * rood = wissen, en dat staat achter shift, dus alleen zichtbaar met shift.
 *
 *   invert  LED brandt als read 0 is (On/Off: read = bypass, lampje = effect aan)
 *   lees    action waarvan de LED de stand toont, in plaats van die van de
 *           knop zelf. Metronome doet in de grid-modus nog steeds de
 *           crossfadercurve, maar zijn lampje zegt dan "grid-modus aan".
 *   tel     knipperen op de tel, zelf gerekend (zie TEL_VENSTER):
 *           'aan'  zolang de stand `aan` is: fel op de tel, gedimd ertussen
 *           'maat' alleen als deze track de maat geeft: op de tel omgekeerd
 */
const KLEURSCHEMA = [
  // Grid-modus (stap D): de scene-knoppen WIT, zodat je de grid-modus niet
  // voor een grid-mapje aanziet (die zijn geel/cyaan/violet/blauw). Cyaan
  // zolang je drukt: je ziet dat hij het deed.
  [/\.grid\.(here|double|halve|halfbeat|split)$/, { aan: 'cyaan', half: 'wit', uit: 'wit' }],
  [/\.hotcue\.\d+$/, { aan: 'geel', half: 'geeldonker', uit: 'donkergrijs' }],
  [/\.loop\.exit$/,  { aan: 'rood', uit: 'uit' }],
  [/\.loop\./,       { aan: 'cyaan', half: 'cyaandonker', uit: 'donkergrijs', tel: 'aan' }],
  [/\.play$/,        { aan: 'groen', uit: 'donkergrijs' }],
  [/\.cue$/,         { aan: 'wit', uit: 'donkergrijs' }],
  [/\.focus$/,       { aan: 'oranje', half: 'oranjedonker', uit: 'donkergrijs', tel: 'maat' }],
  // Crossfaderkant: read A = 0, thru = 0,5, B = 1 (actions.js). Op de
  // tweekleurige A|B-knop: A geel, B oranje, thru uit — zoals Ableton het ook
  // toont. Hier staat `uit` dus voor kant A, niet voor "niets".
  [/\.xfade\.side$/, { uit: 'geel', half: 'uit', aan: 'oranje' }],
  [/\.fx\.bypass$/,  { aan: 'groen', uit: 'donkergrijs', invert: true }],
  [/^mixer\./,       { aan: 'blauw', uit: 'donkergrijs' }],
  [/\.beatloop\./,   { aan: 'cyaan', half: 'cyaandonker', uit: 'donkergrijs', tel: 'aan' }],
  [/^sampler\.\d+$/,  { aan: 'violet', half: 'violetdonker', uit: 'donkergrijs' }],
  [/\.clear$|\.delete$/, { aan: 'rood', half: 'rooddonker', uit: 'uit' }],
  // Doorbladerknoppen (tellen, mengvorm, pulsdoel): hun read is een KEUZE
  // (index), geen niveau. Stand 0 als "uit" tonen zou liegen; ze branden
  // altijd gedimd: bruikbaar, niets actief.
  [/^sampler\.length$/, { aan: 'violetdonker', half: 'violetdonker', uit: 'violetdonker' }],
  [/^video\.(mode|pulse\.target)$/, { aan: 'blauwdonker', half: 'blauwdonker', uit: 'blauwdonker' }],
  [/^video\./,        { aan: 'blauw', half: 'blauwdonker', uit: 'donkergrijs' }],
  // Grid-modi op de scene-knoppen: elke modus zijn eigen kleur, gedimd als hij
  // dicht is — zo zie je altijd welke er zijn én welke open is.
  [/^layer\.grid\.hotcues$/, { aan: 'geel', uit: 'geeldonker' }],
  [/^layer\.grid\.loops$/,   { aan: 'cyaan', uit: 'cyaandonker' }],
  [/^layer\.grid\.sampler$/, { aan: 'violet', uit: 'violetdonker' }],
  [/^layer\.grid\.video$/,   { aan: 'blauw', uit: 'blauwdonker' }],
  [/^layer\./,        { aan: 'wit', uit: 'donkergrijs' }],
];

/**
 * Hoe lang "op de tel" duurt, als deel van een tel: een kwart (~120 ms op
 * 124 bpm). De feedback tikt elke 33 ms, dus dat zijn 3-4 tikken fel: goed te
 * zien, en per knipperende LED maar twee berichten per tel. Het begin valt
 * hooguit één tik (33 ms) te laat; de fase zelf is die van wat je HOORT
 * (`track.N.phase`: grid-fase op positie min uitgangsvertraging), net als de
 * video-puls. Geen MIDI clock nodig (VRAGEN B2).
 */
export const TEL_VENSTER = 0.25;

/** Drie standen uit een read: 'uit', 'half', 'aan'. */
const standVan = (v) => (v >= 0.99 ? 'aan' : v > 0.01 ? 'half' : 'uit');

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
    // Shift ingedrukt of los: de lampjes tonen meteen de andere laag, niet pas
    // bij de volgende tik. Een shift-tik duurt soms maar 100 ms.
    mapping?.on?.('shift', () => { if (this.klaar && !this.gepauzeerd) this.tick(48); });
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
    for (const regel of this._regels()) {
      const ringSig = this.device.ringFor(uitSig(regel.in));
      if (!ringSig) continue;
      const doel = resolveTarget(regel.action, this.mapping.vars());
      const m = this.meta ? this.meta(doel) : null;
      const p = ontleed(ringSig);
      if (p) this.send([0xb0 | p.channel, p.number, m?.bipolar ? ring.pan : ring.volume]);
    }
  }

  /**
   * De regels die NU gelden: per knop die van het open mapje, met de
   * shiftstand van nu. Een mapping zonder mapjes geeft gewoon alle regels.
   */
  _regels() {
    return this.mapping.actieveRegels ? this.mapping.actieveRegels().values() : this.mapping.rules.values();
  }

  /** Volgende tick alles opnieuw sturen — na init, mapping-wissel of herverbinden. */
  invalidate() { this.vorige.clear(); }

  /** Wat zou er nu moeten branden? Geeft sig -> bytes. */
  desired() {
    const uit = new Map();
    const vars = this.mapping.vars();
    const palet = this.device.palette || {};
    const gedrag = this.device.behaviour || {};

    const ring = this.device.ring;
    for (const regel of this._regels()) {
      const sig = uitSig(regel.in);
      const control = this.device.controls.get(sig);
      if (!control) continue;

      const doel = resolveTarget(regel.action, vars);
      const bron = regel.led?.lees ? resolveTarget(regel.led.lees, vars) : doel;
      const waarde = this.read ? this.read(bron) : null;
      if (waarde === null) continue;
      const p = ontleed(sig);
      if (!p) continue;

      if (control.kind === 'knob') {
        // Geen lampje maar een ring: die toont de SOFTWARE-stand. Precies wat
        // je wilt zien als een knop nog niet overgepakt heeft.
        uit.set(sig, [0xb0 | p.channel, p.number, Math.round(waarde * 127)]);
        // Het ringtype hoort bij wat de knop NU doet: wisselt het mapje van
        // filter (bipolair) naar send, dan wisselt de ring mee.
        const ringSig = ring && this.device.ringFor?.(sig);
        const rp = ringSig && ontleed(ringSig);
        if (rp) {
          const m = this.meta ? this.meta(doel) : null;
          uit.set(`type:${ringSig}`, [0xb0 | rp.channel, rp.number, m?.bipolar ? ring.pan : ring.volume]);
        }
        continue;
      }
      if (!control.led) continue;

      const kleur = { ...kleurVoor(regel.action), ...(regel.led || {}) };
      let stand = standVan(kleur.invert ? 1 - waarde : waarde);
      if (stand === 'half' && kleur.half === undefined) stand = 'aan';
      const tel = kleur.tel ? this._tel(kleur.tel, doel, stand) : null;   // null = knippert niet
      const naamVan = (s) => kleur[s] ?? (s === 'half' ? kleur.aan : undefined);

      if (control.led === 'rgb') {
        // Op de tel: 'aan' is fel op de tel en gedimd ertussen, 'maat' keert
        // de stand op de tel even om.
        if (tel !== null && kleur.tel === 'aan') stand = tel ? 'aan' : 'half';
        else if (tel) stand = stand === 'aan' ? 'half' : 'aan';
        const naam = naamVan(stand);
        const vel = typeof naam === 'number' ? naam : (palet[naam] ?? 0);
        const kanaal = gedrag[kleur.mode] ?? gedrag.vast ?? 0;
        uit.set(sig, [0x90 | kanaal, p.number, vel]);
      } else if (control.led === 'bicolor') {
        // Tweekleurig (A|B-knop): 0 uit, 1 geel, 2-127 oranje. Een naam die
        // het apparaat niet kent valt terug op de stand: aan oranje, half geel.
        const naam = naamVan(stand);
        const bi = this.device.bicolor || {};
        const vel = typeof naam === 'number' ? naam : (bi[naam] ?? { aan: 127, half: 1, uit: 0 }[stand]);
        uit.set(sig, [0x90 | p.channel, p.number, vel]);
      } else {
        // Eenkleurig: alleen aan of uit, kanaal doet er niet toe. Een halve
        // stand is aan; knipperen op de tel is even omkeren (een lopende loop
        // op Clip Stop: aan, met een tik uit op elke tel).
        let aan = stand !== 'uit';
        if (tel) aan = !aan;
        uit.set(sig, [0x90 | p.channel, p.number, aan ? 127 : 0]);
      }
    }
    return uit;
  }

  /**
   * Valt de tel NU, voor deze LED? null = deze LED knippert nu niet, anders
   * true (op de tel) of false (ertussen). De track komt uit de action
   * (`track.3.beatloop.4` -> 3); de fase uit `track.N.phase` (null = speelt
   * niet of geen grid: dan knippert er niets). Alleen lezen, geen teller:
   * regel 3 geldt ook voor lampjes.
   */
  _tel(soort, doel, stand) {
    const nr = /^track\.(\d+)\./.exec(doel)?.[1];
    if (!nr || !this.read) return null;
    if (soort === 'aan' && stand !== 'aan') return null;
    if (soort === 'maat' && this.read(`track.${nr}.leads`) !== 1) return null;
    const fase = this.read(`track.${nr}.phase`);
    if (fase === null || fase === undefined) return null;
    return fase < TEL_VENSTER;
  }

  /**
   * Stuurt alleen de verschillen. `max` houdt een volledige verversing binnen
   * een paar frames in plaats van in één klap 60 berichten op de bus te gooien.
   */
  tick(max = 24) {
    if (this.gepauzeerd || !this.klaar) return 0;
    const wil = this.desired();
    let n = 0;
    // Wat niet meer gewild is (een ander mapje): uit. Anders blijft een pad
    // branden met de kleur van een mapje dat al dicht is.
    for (const [sig, sleutel] of this.vorige) {
      if (wil.has(sig) || sig.startsWith('type:')) continue;
      const b = sleutel.split(',').map(Number);
      this.send([b[0], b[1], 0]);
      this.vorige.delete(sig);
      if (++n >= max) return n;
    }
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
