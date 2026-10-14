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
 *           knop zelf, ook in de KLEUR van die action. Metronome doet in de
 *           grid-modus nog steeds de crossfadercurve, maar zijn lampje zegt dan
 *           "grid-modus aan"; scene 5 blijft in de modus klank "loop weg", maar
 *           brandt magenta: klank staat open.
 *   tel     knipperen op de tel, zelf gerekend (zie TEL_VENSTER):
 *           'aan'  zolang de stand `aan` is: fel op de tel, gedimd ertussen
 *           'maat' alleen als deze track de maat geeft: op de tel omgekeerd
 */
const KLEURSCHEMA = [
  // Grid-modus (stap D): de scene-knoppen WIT, zodat je de grid-modus niet
  // voor een grid-mapje aanziet (die zijn geel/cyaan/violet/blauw). Cyaan
  // zolang je drukt: je ziet dat hij het deed.
  // "Tel 1 hier" zegt in rust ook of het stuk dat je hoort klopt (14 okt,
  // BEATGRID.md §12): wit = zeker of op slot, ORANJE = twijfel (controleer,
  // geen puls, of het grid wijkt live af). Read 0 / 0,5 (actions.js, twijfelHier).
  [/\.grid\.here$/, { aan: 'cyaan', half: 'oranje', uit: 'wit' }],
  [/\.grid\.(double|halve|halfbeat|split|align)$/, { aan: 'cyaan', half: 'wit', uit: 'wit' }],
  [/\.hotcue\.\d+$/, { aan: 'geel', half: 'geeldonker', uit: 'donkergrijs' }],
  [/\.loop\.exit$/,  { aan: 'rood', uit: 'uit' }],
  [/\.loop\./,       { aan: 'cyaan', half: 'cyaandonker', uit: 'donkergrijs', tel: 'aan' }],
  [/\.play$/,        { aan: 'groen', uit: 'donkergrijs' }],
  // Op de maat starten (ook rij 5 in de modus klank), volgens de read van
  // play.quant: fel = wacht op de maat, donker = speelt (drukken = pauze, zoals
  // play), donkergrijs = stil (kan starten), uit = lege track (read null).
  [/\.play\.quant$/, { aan: 'groen', half: 'groendonker', uit: 'donkergrijs' }],
  [/\.beatjump\.(back|fwd)$/, { aan: 'cyaan', uit: 'donkergrijs' }],
  // De lengte is een keuze (index), geen niveau: altijd gedimd, zoals sampler.length.
  [/\.beatjump\.(halve|double)$/, { aan: 'cyaandonker', half: 'cyaandonker', uit: 'cyaandonker' }],
  [/\.cue$/,         { aan: 'wit', uit: 'donkergrijs' }],
  [/\.focus$/,       { aan: 'oranje', half: 'oranjedonker', uit: 'donkergrijs', tel: 'maat' }],
  // Crossfaderkant: read A = 0, thru = 0,5, B = 1 (actions.js). Op de
  // tweekleurige A|B-knop: A geel, B oranje, thru uit — zoals Ableton het ook
  // toont. Hier staat `uit` dus voor kant A, niet voor "niets".
  [/\.xfade\.side$/, { uit: 'geel', half: 'uit', aan: 'oranje' }],
  [/\.fx\.bypass$/,  { aan: 'groen', uit: 'donkergrijs', invert: true }],
  // Kill (B4 zoals de modus klank hem toont, Clay 25 sep): fel rood = de band
  // is weg, donkerrood = open (er valt te killen), uit = lege track. Rem:
  // fel oranje = remt, donker = speelt (er valt te remmen), uit = staat stil.
  [/\.kill\.(low|mid|high)(\.hold)?$/, { aan: 'rood', uit: 'rooddonker' }],
  // Stem weg (modus stems, VRAGEN N1): zoals de EQ-kill in klank, fel rood =
  // weg, donkerrood = er valt iets weg te drukken, uit = geen stems (read null).
  // De cue van een stem rood zoals ● (track.N.pfl): aan = in de koptelefoon.
  [/\.stem\.\w+\.(kill|hold)$/, { aan: 'rood', uit: 'rooddonker' }],
  [/\.stem\.\w+\.pfl$/, { aan: 'rood', uit: 'donkergrijs' }],
  [/\.brake$/,       { aan: 'oranje', uit: 'oranjedonker' }],
  [/^mixer\./,       { aan: 'blauw', uit: 'donkergrijs' }],
  [/\.beatloop\./,   { aan: 'cyaan', half: 'cyaandonker', uit: 'donkergrijs', tel: 'aan' }],
  [/^sampler\.\d+$/,  { aan: 'violet', half: 'violetdonker', uit: 'donkergrijs' }],
  // Een sectie in een pad (rij 3 van de modus sampler): in de kleur van de
  // secties, donker = kan (een lege pad, de focus-track heeft secties), fel =
  // ingedrukt, uit = kan niet.
  [/^sampler\.\d+\.section$/, { aan: 'hemelsblauw', half: 'hemelsblauwdonker', uit: 'uit' }],
  // Een stuk uit de sampler als drumpad (crossover): in de kleur van de
  // sampler, fel = drumpad gevuld, donker = kan, uit = kan niet.
  [/^sampler\.\d+\.drums$/, { aan: 'violet', half: 'violetdonker', uit: 'uit' }],
  [/\.clear$|\.delete$/, { aan: 'rood', half: 'rooddonker', uit: 'uit' }],
  // Doorbladerknoppen (tellen, mengvorm, pulsdoel): hun read is een KEUZE
  // (index), geen niveau. Stand 0 als "uit" tonen zou liegen; ze branden
  // altijd gedimd: bruikbaar, niets actief.
  [/^sampler\.length$/, { aan: 'violetdonker', half: 'violetdonker', uit: 'violetdonker' }],
  [/^video\.(mode|pulse\.target)$/, { aan: 'blauwdonker', half: 'blauwdonker', uit: 'blauwdonker' }],
  // Beeld-noodknoppen (2 okt, ONTBREEKT A4): zwart in rood, zodat je in het
  // donker ziet dat de zaal niets ziet; bevriezen en flits wit.
  [/^video\.black(\.hold)?$/, { aan: 'rood', uit: 'rooddonker' }],
  [/^video\.(freeze|flash)$/, { aan: 'wit', uit: 'donkergrijs' }],
  [/^video\./,        { aan: 'blauw', half: 'blauwdonker', uit: 'donkergrijs' }],
  // Grid-modi op de scene-knoppen: elke modus zijn eigen kleur, gedimd als hij
  // dicht is — zo zie je altijd welke er zijn én welke open is.
  [/^layer\.grid\.hotcues$/, { aan: 'geel', uit: 'geeldonker' }],
  [/^layer\.grid\.loops$/,   { aan: 'cyaan', uit: 'cyaandonker' }],
  [/^layer\.grid\.sampler$/, { aan: 'violet', uit: 'violetdonker' }],
  [/^layer\.grid\.video$/,   { aan: 'blauw', uit: 'blauwdonker' }],
  // Klank: magenta. Niet rood: dat is "loop weg" op dezelfde scene-knop, en
  // wissen. Niet violet of blauw: dat zijn sampler en video, er vlak boven.
  [/^layer\.grid\.klank$/,   { aan: 'magenta', uit: 'magentadonker' }],
  // Auto-DJ (2 okt, VRAGEN AU1): limoen, de enige vrije kleur met een donkere
  // tint (18) die niet al een modus is. Op de bovenste rij van de modus auto
  // elke knop zijn eigen kleur, uit de read in bindAuto:
  //   ok       null = geen voorstel (uit), 0,5 = voorstel klaar (donkergroen),
  //            1 = bevestigd (fel groen)
  //   overslaan · langer · nu   0 = er staat een overgang klaar (donker), null = uit
  //   aan      1 = aan (fel limoen), 0 = uit (donker limoen)
  [/^layer\.grid\.auto$/,    { aan: 'limoen', uit: 'limoendonker' }],
  // Stems (5 okt, VRAGEN N1): zeegroen, met zijn donkere tint (34); geen andere
  // modus heeft hem. De pads zelf rood (weg), zoals de kill in klank.
  [/^layer\.grid\.stems$/,   { aan: 'zeegroen', uit: 'zeegroendonker' }],
  [/^auto\.aan$/,     { aan: 'limoen', uit: 'limoendonker' }],
  [/^auto\.ok$/,      { aan: 'groen', half: 'groendonker', uit: 'groendonker' }],
  [/^auto\.skip$/,    { aan: 'oranje', uit: 'oranjedonker' }],
  [/^auto\.langer$/,  { aan: 'cyaan', uit: 'cyaandonker' }],
  [/^auto\.nu$/,      { aan: 'geel', uit: 'geeldonker' }],
  // Patronen (5 okt, docs/PATRONEN.md): oranje (stems hadden zeegroen al), een vrije kleur met
  // een donkere tint (34) die geen modus is. Een plek (en een rij op de
  // scene-knoppen): donkergrijs = leeg, donker = gevuld, fel = speelt, uit =
  // geen instrument. Wacht hij op de maat (starten of stoppen), dan knippert
  // de READ zelf tussen 1 en 0,5 op de tel van de patroonklok (de klok van
  // een instrumenttrack is niet `track.N.phase`, dus `tel` kan het niet).
  [/\.pattern\.[1-5](\.now)?$|^patterns\.row\.[1-5]$/, { aan: 'oranje', half: 'oranjedonker', uit: 'donkergrijs' }],
  [/\.pattern\.stop(\.now)?$|^patterns\.stop(\.now)?$/, { aan: 'rood', half: 'rooddonker', uit: 'uit' }],
  [/^patterns\.record$/, { aan: 'rood', uit: 'rooddonker' }],
  [/^layer\.grid\.patronen$/, { aan: 'oranje', uit: 'oranjedonker' }],
  // Secties (6 okt, docs/SECTIES.md): hemelsblauw (41, donker 42), een vrije
  // kleur met een donkere tint. Mint (29) lag te dicht bij het groen van play.
  // Een pad: donker hemelsblauw = er is een sectie, WIT = die hoor je nu, en
  // die knippert op de tel (de maat loopt door: je ziet waar je bent), uit =
  // geen sectie. Als loop (shift): cyaan zoals de andere loops = deze loop staat aan.
  [/\.section\.\d+$/, { aan: 'wit', half: 'hemelsblauwdonker', uit: 'uit', tel: 'aan' }],
  [/\.section\.\d+\.loop$/, { aan: 'cyaan', half: 'hemelsblauwdonker', uit: 'uit' }],
  [/^layer\.grid\.secties$/, { aan: 'hemelsblauw', uit: 'hemelsblauwdonker' }],
  // Beeld (6 okt, spoor beeld, docs/BEELD.md): de regie van de Stroommachine op
  // de scene-knoppen, in het mapje device.beeld. Roze (57, donker 58), de laatste
  // kleur met een donkere tint die nog geen modus had. Donker = verbonden en
  // bruikbaar, fel = zolang je drukt, uit = geen verbinding met de relay (read
  // null). Flits wit zoals video.flash; paniek rood (Stop All Clips heeft geen
  // lampje, dus dat zie je alleen op het scherm en op apc.html).
  [/^beeld\.regie\.flits$/,  { aan: 'wit', uit: 'donkergrijs' }],
  [/^beeld\.regie\.paniek$/, { aan: 'rood', uit: 'rooddonker' }],
  [/^beeld\.regie\./,        { aan: 'roze', uit: 'rozedonker' }],
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

/**
 * Op de "1" van de maat twee keer zo lang: een halve tel. Zo zie je op de
 * APC waar de maat begint, zonder extra berichten (nog steeds aan en uit, één
 * keer per tel). De "1" komt van het maat-anker van het stuk
 * (`track.N.barbeat`); zonder die read knippert elke tel even kort, als vroeger.
 */
export const TEL_VENSTER_EEN = 0.5;

/** Drie standen uit een read: 'uit', 'half', 'aan'. */
const standVan = (v) => (v >= 0.99 ? 'aan' : v > 0.01 ? 'half' : 'uit');

const STANDAARD_KLEUR = { aan: 'wit', uit: 'donkergrijs' };
const kleurOnthouden = new Map();
/**
 * De kleur van een action: de eerste regel van KLEURSCHEMA die past. Onthouden
 * per action-id: anders liepen elke tik ~70 regexen over elke regel van de
 * mapping (de helft van wat een tik kostte, docs/verslagen/2026-10-14/controller-uitvoer.md).
 * Het schema is vast, dus de uitkomst ook.
 */
export const kleurVoor = (actie) => {
  let k = kleurOnthouden.get(actie);
  if (k === undefined) {
    k = (KLEURSCHEMA.find(([re]) => re.test(actie)) || [null, STANDAARD_KLEUR])[1];
    if (kleurOnthouden.size < 4096) kleurOnthouden.set(actie, k);
  }
  return k;
};

/** Wildcard-kanaal bestaat alleen inkomend; naar buiten moet het een getal zijn. */
const uitSig = (sig) => sig.replace(':*:', ':0:');

const ontleed = (sig) => {
  const m = /^(\w+):(\d+):(\d+)$/.exec(sig);
  return m ? { type: m[1], channel: +m[2], number: +m[3] } : null;
};

/** Drie bytes als één getal (geen array en geen string per lampje per tik), en terug. */
const pak = (b0, b1, b2) => (b0 << 16) | (b1 << 8) | b2;
const uitpak = (v) => [v >> 16, (v >> 8) & 0xff, v & 0xff];

/**
 * Hooguit zoveel berichten per tik. Ruim boven een volledige verversing (~140:
 * 110 lampjes, 16 ringen en hun types): de wachtrij van de MidiHub (16 per 4 ms)
 * spreidt ze al. Vroeger 24 per tik: een mapje wisselen (~40 lampjes) duurde
 * daardoor twee tikken (gemeten 51 ms tot het laatste lampje), een hele
 * verversing zes (200 ms).
 */
export const MAX_PER_TIK = 160;

/** Een wektik (Feedback.wek) hooguit zo vaak: dezelfde maat als de wachtrij van de MidiHub. */
export const WEK_MS = 4;

export class Feedback {
  /**
   * @param device  device-profiel (controls, palette, ring, init-sysex)
   * @param mapping de Mapping — hier staat wat waar zit
   * @param read    (actionId) -> 0..1 of null
   * @param meta    (actionId) -> { bipolar, ... } of null
   * @param send    (bytes) -> bool, en sendSysex voor de init
   * @param nu      klok in ms (de test geeft een nep-klok)
   */
  constructor({ device, mapping, read, meta, send, sendSysex, nu = () => (globalThis.performance?.now() ?? Date.now()) }) {
    // send(bytes, opties) — opties gaan door naar de hub (bijv. { direct: true })
    this.device = device;
    this.mapping = mapping;
    this.read = read;
    this.meta = meta;
    this.send = send;
    this.sendSysex = sendSysex || send;
    this.nu = nu;
    this.vorige = new Map();     // sig -> laatst verstuurde bytes, gepakt (pak())
    this._wil = new Map();       // per tik hergebruikt: sig -> gewilde bytes (gepakt)
    this.gepauzeerd = false;     // staat aan tijdens de paletproef
    this.verstuurd = 0;
    this.klaar = false;
    // Het PLAN: per regel die nu geldt alles wat niet van de engine afhangt
    // (signature, soort lampje, doel-action, kleur). Opnieuw als de mapping,
    // shift, de open mapjes, de focus of het apparaat verandert (_planNu).
    this._plan = null;
    this._planSleutel = null;
    this._planDevice = null;
    this._versie = 0;            // +1 bij elke 'change' van de mapping
    this._telTik = 0;            // per tik één keer de tel van een track lezen (_telVan)
    this._telVan_ = [];
    this._wekker = null;         // een geplande wektik (null, een teken voor de microtaak, of een timer)
    this._laatsteTik = -Infinity;
    this.tikken = 0;             // voor de meting (tools/bench/feedback.mjs)
    this.wekTikken = 0;
    mapping?.on?.('change', () => { this._versie++; });
    // Shift ingedrukt of los: de lampjes tonen meteen de andere laag, niet pas
    // bij de volgende tik. Een shift-tik duurt soms maar 100 ms.
    mapping?.on?.('shift', () => { if (this.klaar && !this.gepauzeerd) this.tick(); });
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
    const wil = new Map();
    this._vul(wil);
    const uit = new Map();
    for (const [sig, v] of wil) uit.set(sig, uitpak(v));
    return uit;
  }

  /**
   * Het plan van NU: per regel die geldt wat er per tik niet verandert. Een
   * mapping met 700 regels kostte per tik ~0,5 ms aan actieveRegels(),
   * resolveTarget en de kleurregexen, ook als er niets veranderde; nu alleen
   * als de sleutel verandert. In de sleutel: de versie van de mapping (en het
   * aantal regels, voor een mapping zonder events), shift, de open mapjes en
   * de vars ({focus}). Het apparaat apart.
   */
  _planNu() {
    const m = this.mapping;
    const vars = m.vars ? m.vars() : {};
    const open = typeof m.lagen === 'function' ? m.lagen() : null;
    const sleutel = `${this._versie}|${m.rules?.size ?? 0}|${m.shift ? 1 : 0}|${open ? open.join(',') : ''}|${JSON.stringify(vars)}`;
    if (this._plan && sleutel === this._planSleutel && this._planDevice === this.device) return this._plan;
    const dev = this.device;
    const gedrag = dev.behaviour || {};
    const ring = dev.ring;
    const plan = [];
    for (const regel of this._regels()) {
      const sig = uitSig(regel.in);
      const control = dev.controls.get(sig);
      if (!control) continue;
      const p = ontleed(sig);
      if (!p) continue;
      const doel = resolveTarget(regel.action, vars);
      const bron = regel.led?.lees ? resolveTarget(regel.led.lees, vars) : doel;
      if (control.kind === 'knob') {
        // Geen lampje maar een ring: die toont de SOFTWARE-stand. Het ringtype
        // hoort bij wat de knop NU doet (bipolair of niet, per tik gelezen).
        const ringSig = ring && dev.ringFor?.(sig);
        const rp = ringSig && ontleed(ringSig);
        plan.push({ soort: 'knob', sig, bron, doel, b0: 0xb0 | p.channel, b1: p.number,
          typeSig: rp ? `type:${ringSig}` : null, t0: rp ? 0xb0 | rp.channel : 0, t1: rp ? rp.number : 0 });
        continue;
      }
      if (!control.led) continue;
      const kleur = { ...kleurVoor(regel.led?.lees ?? regel.action), ...(regel.led || {}) };
      const nr = kleur.tel ? /^track\.(\d+)\./.exec(bron)?.[1] : null;
      plan.push({ soort: control.led, sig, bron, kleur, nr: nr ? +nr : 0, kanaal: p.channel, b1: p.number,
        rgbKanaal: gedrag[kleur.mode] ?? gedrag.vast ?? 0 });
    }
    this._plan = plan;
    this._planSleutel = sleutel;
    this._planDevice = dev;
    return plan;
  }

  /**
   * Vult `wil` met sig -> gewilde bytes (gepakt). Leest alleen de stand van de
   * engine. `lampjes`: alleen lampjes, geen ringen (de wektik, zie wek()).
   */
  _vul(wil, lampjes = false) {
    const plan = this._planNu();
    const palet = this.device.palette || {};
    const ring = this.device.ring;
    const bi = this.device.bicolor || {};
    this._telTik++;
    for (const e of plan) {
      const waarde = this.read ? this.read(e.bron) : null;
      if (waarde === null) continue;
      if (e.soort === 'knob') {
        if (lampjes) continue;
        wil.set(e.sig, pak(e.b0, e.b1, Math.round(waarde * 127)));
        if (e.typeSig) {
          const m = this.meta ? this.meta(e.doel) : null;
          wil.set(e.typeSig, pak(e.t0, e.t1, m?.bipolar ? ring.pan : ring.volume));
        }
        continue;
      }
      const kleur = e.kleur;
      let stand = standVan(kleur.invert ? 1 - waarde : waarde);
      if (stand === 'half' && kleur.half === undefined) stand = 'aan';
      const tel = kleur.tel ? this._tel(kleur.tel, e.nr, stand) : null;   // null = knippert niet
      const naamVan = (s) => kleur[s] ?? (s === 'half' ? kleur.aan : undefined);

      if (e.soort === 'rgb') {
        // Op de tel: 'aan' is fel op de tel en gedimd ertussen, 'maat' keert
        // de stand op de tel even om.
        if (tel !== null && kleur.tel === 'aan') stand = tel ? 'aan' : 'half';
        else if (tel) stand = stand === 'aan' ? 'half' : 'aan';
        const naam = naamVan(stand);
        const vel = typeof naam === 'number' ? naam : (palet[naam] ?? 0);
        wil.set(e.sig, pak(0x90 | e.rgbKanaal, e.b1, vel));
      } else if (e.soort === 'bicolor') {
        // Tweekleurig (A|B-knop): 0 uit, 1 geel, 2-127 oranje. Een naam die
        // het apparaat niet kent valt terug op de stand: aan oranje, half geel.
        const naam = naamVan(stand);
        const vel = typeof naam === 'number' ? naam : (bi[naam] ?? { aan: 127, half: 1, uit: 0 }[stand]);
        wil.set(e.sig, pak(0x90 | e.kanaal, e.b1, vel));
      } else {
        // Eenkleurig: alleen aan of uit, kanaal doet er niet toe. Een halve
        // stand is aan; knipperen op de tel is even omkeren (een lopende loop
        // op Clip Stop: aan, met een tik uit op elke tel).
        let aan = stand !== 'uit';
        if (tel) aan = !aan;
        wil.set(e.sig, pak(0x90 | e.kanaal, e.b1, aan ? 127 : 0));
      }
    }
  }

  /**
   * Valt de tel NU, voor deze LED? null = deze LED knippert nu niet, anders
   * true (op de tel) of false (ertussen). De track (`nr`) komt uit de action
   * (`track.3.beatloop.4` -> 3, in het plan); de fase uit `track.N.phase`
   * (null = speelt niet of geen grid: dan knippert er niets). Alleen lezen,
   * geen teller: regel 3 geldt ook voor lampjes. Per tik één keer per track
   * gelezen (_telVan): veertig loop-pads lazen anders 120 keer dezelfde fase.
   */
  _tel(soort, nr, stand) {
    if (!nr || !this.read) return null;
    if (soort === 'aan' && stand !== 'aan') return null;
    const c = this._telVan(nr);
    if (soort === 'maat') {
      if (c.leads === undefined) c.leads = this.read(`track.${nr}.leads`);
      if (c.leads !== 1) return null;
    }
    if (c.fase === null || c.fase === undefined) return null;
    return c.fase < (c.een === 1 ? TEL_VENSTER_EEN : TEL_VENSTER);
  }

  /** Fase en "1" van track `nr` in deze tik (één keer gelezen). */
  _telVan(nr) {
    let c = this._telVan_[nr];
    if (!c) c = this._telVan_[nr] = { tik: -1, fase: null, een: null, leads: undefined };
    if (c.tik !== this._telTik) {
      c.tik = this._telTik;
      c.fase = this.read(`track.${nr}.phase`);
      c.een = c.fase === null || c.fase === undefined ? null : this.read(`track.${nr}.barbeat`);
      c.leads = undefined;
    }
    return c;
  }

  /**
   * Stuurt alleen de verschillen. `max` is een vangnet; het spreiden doet de
   * wachtrij van de MidiHub (16 per 4 ms), zie MAX_PER_TIK. `lampjes`: alleen
   * lampjes (noten), ringen en ringtypes blijven voor de gewone tik (wek()).
   */
  tick(max = MAX_PER_TIK, { lampjes = false } = {}) {
    if (this.gepauzeerd || !this.klaar) return 0;
    this.tikken++;
    this._laatsteTik = this.nu();
    const wil = this._wil;
    wil.clear();
    this._vul(wil, lampjes);
    let n = 0;
    // Wat niet meer gewild is (een ander mapje): uit. Anders blijft een pad
    // branden met de kleur van een mapje dat al dicht is. In een lampjestik
    // staan de ringen niet in `wil`: die laten we staan (status 0xBn).
    for (const [sig, v] of this.vorige) {
      if (wil.has(sig) || sig.startsWith('type:')) continue;
      if (lampjes && ((v >> 16) & 0xf0) === 0xb0) continue;
      this.send([v >> 16, (v >> 8) & 0xff, 0]);
      this.vorige.delete(sig);
      if (++n >= max) return n;
    }
    for (const [sig, v] of wil) {
      if (this.vorige.get(sig) === v) continue;
      this.send(uitpak(v));
      this.vorige.set(sig, v);
      this.verstuurd++;
      if (++n >= max) break;
    }
    return n;
  }

  /**
   * Zo snel mogelijk een tik, ná wat er nu gebeurt: een knop die je indrukt
   * licht op zonder op de volgende tik van 33 ms te wachten (cijfers vóór/na:
   * docs/verslagen/2026-10-14/controller-uitvoer.md, tools/bench/feedback.mjs).
   * ALLEEN LAMPJES (review 14 okt): een ring meteen terugsturen na elke
   * knopstap botst met een APC die de ring als knopwaarde overneemt (hub-proef
   * V1, nog niet op Clay's APC gedraaid) en vulde het echofilter met elke
   * waarde van een draai. Ringen blijven op de gewone tik van 33 ms, zoals
   * vóór 14 okt. midi-opzet.js roept dit aan
   * bij elke action op de bus (bijInvoke draait VÓÓR de action, daarom een
   * microtaak: de tik ziet de nieuwe stand) en bij een ander mapje.
   * Samengevoegd: wat er ook gebeurt in dezelfde taak, één tik; hooguit één
   * per WEK_MS (daarna een timer). De tik stuurt alleen verschillen, dus niets
   * dubbel: de gewone tik erna vindt niets meer.
   */
  wek() {
    if (this._wekker !== null || this.gepauzeerd || !this.klaar) return;
    let mijn = null;
    const doe = () => {
      if (this._wekker !== mijn) return;   // intussen gestopt
      this._wekker = null;
      if (!this.klaar || this.gepauzeerd) return;
      this.wekTikken++;
      this.tick(MAX_PER_TIK, { lampjes: true });
    };
    const wacht = WEK_MS - (this.nu() - this._laatsteTik);
    if (wacht <= 0) { mijn = {}; this._wekker = mijn; queueMicrotask(doe); }
    else { mijn = setTimeout(doe, wacht); this._wekker = mijn; }
  }

  /** Een geplande wektik weg (afsluiten). */
  stop() {
    if (this._wekker !== null) clearTimeout(this._wekker);
    this._wekker = null;
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
