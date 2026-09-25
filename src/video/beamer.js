/**
 * Het losse venster (de beamer) en wie er mengt. Puur: geen DOM, geen WebGL,
 * te testen in Node.
 *
 * Het probleem: Chrome zet requestAnimationFrame stil en decodeert geen
 * <video> in een tabblad dat niet zichtbaar is. Toonde het losse venster het
 * canvas van het hoofdvenster (captureStream), dan bevroor de beamer zodra je
 * in het hoofdvenster naar een ander tabblad ging.
 *
 * Nu mengt het losse venster ZELF zodra het open is: eigen <video>'s, eigen
 * WebGL, eigen animatielus (src/video/beamer-venster.js). Het is same-origin
 * (window.open), dus het leest de engine van het hoofdvenster rechtstreeks,
 * op dezelfde thread. De audio blijft de baas (regel 3): posities komen van
 * de audioklok van het hoofdvenster; instellingen, bronnen en beeldlagen neemt
 * het elk beeld over van de mixer daar (VideoMixer.neemOver).
 *
 * Eén keer mengen: staat het losse venster open, dan mengt het hoofdvenster
 * niet; het paneel toont dan het beeld van het losse venster (captureStream,
 * de weg die vroeger andersom liep). Eén uitzondering: een video-opname die
 * begon toen het hoofdvenster mengde. Een MediaRecorder kan niet van bron
 * wisselen, dus dan mengen ze allebei tot die opname stopt.
 *
 * INLOOP. Eigen <video>'s moeten eerst laden en naar de plek van de audio
 * springen. Met acht tracks tegelijk duurde dat seconden, en al die tijd
 * toonde de beamer tracks die ontbraken of naast het geluid zaten. Daarom:
 * mengde het hoofdvenster net nog (zijn video's lopen al in de pas), dan
 * blijft het mengen, en zet het elk beeld ook op het canvas van het losse
 * venster (VideoMixer.toonBeeld: een upload op dezelfde thread, geen stream).
 * Zo staat op het losse canvas altijd het goede beeld, ook voor een video-opname.
 * Ondertussen stuurt het losse venster zijn eigen video's bij zonder te mengen
 * (VideoMixer.loopIn). Lopen alle zichtbare in de pas (inDePas in volg.js) en
 * blijft dat INLOOP_HOUD zo, of duurt het langer dan INLOOP_MAX, dan mengt
 * het losse venster zelf en stopt het hoofdvenster. Het beeld wisselt dan van
 * bron, niet van inhoud. Twee keer mengen duurt dus alleen de inloop.
 *
 * Geen inloop (meteen zelf mengen) als:
 *   - het hoofdvenster net niet mengde (paneel dicht): zijn video's staan
 *     stil op een oude plek, zijn beeld is niet beter;
 *   - het hoofdtabblad VERBORGEN is: daar staat de animatielus stil en
 *     decodeert Chrome geen video, er is dus geen beeld om te lenen. Wordt
 *     het tijdens de inloop verborgen, dan neemt het losse venster meteen over.
 *
 * Wanneer: bij aanmelden (openen, herladen van een van beide) en als een
 * verborgen los venster weer zichtbaar wordt (zijn video's stonden stil).
 * Een nieuw nummer op een track tijdens het mengen is GEEN inloop: dan krijgt
 * het hoofdvenster net zo goed een nieuwe video, die daar ook nog moet laden.
 */

// Hoe lang de eigen video's achter elkaar in de pas moeten lopen voor de
// overname: één toevallig goed beeld tussen twee sprongen is niet genoeg.
export const INLOOP_HOUD = 0.3;        // s
// Daarna neemt het losse venster hoe dan ook over (een video die niet laadt).
// Onder zware belasting duurde laden en springen van acht video's tot 13 s.
export const INLOOP_MAX = 20;          // s

/** Is dit venster weg? Ook een venster waar we niet meer bij mogen telt als dicht. */
export function isDicht(venster) {
  try { return !venster || venster.closed; } catch (_) { return true; }
}

/**
 * Staat het venster verborgen (geminimaliseerd, achter een ander tabblad)?
 * Dan staat ook ZIJN animatielus stil en mengt het niet: dan neemt het
 * hoofdvenster het paneel weer over.
 */
export function isVerborgen(venster) {
  try { return !!venster.document?.hidden; } catch (_) { return false; }
}

/**
 * Wie mengt er dit beeld?
 * @param losOpen    er hangt een levend, zichtbaar los venster aan
 * @param paneelOpen het videopaneel in het hoofdvenster is open
 * @param opname     waar een lopende video-opname zijn beeld vandaan haalt: 'hoofd', 'los' of null
 * @param inloop     het losse venster loopt nog in: het hoofdvenster mengt, het losse toont dat beeld
 * @returns { hoofd, los, voorbeeld, inloop } — los: het losse venster mengt ZELF;
 *   voorbeeld: het paneel toont het beeld van het losse venster
 */
export function wieMengt({ losOpen, paneelOpen, opname = null, inloop = false }) {
  const loopt = !!losOpen && !!inloop;
  const los = !!losOpen && !loopt;
  const hoofd = (!!paneelOpen && !los) || opname === 'hoofd' || loopt;
  return { hoofd, los, voorbeeld: !!paneelOpen && los && !hoofd, inloop: loopt };
}

/**
 * Eén stap van de inloop. `pas`: lopen de eigen video's nu in de pas.
 * `nu` in ms (performance.now van het hoofdvenster). Geeft de nieuwe stand,
 * of null als de inloop voorbij is en het losse venster zelf mengt.
 */
export function inloopStap(inloop, pas, nu) {
  if (!inloop) return null;
  if (nu - inloop.sinds >= INLOOP_MAX * 1000) return null;
  const pasSinds = pas ? inloop.pasSinds ?? nu : null;
  if (pasSinds !== null && nu - pasSinds >= INLOOP_HOUD * 1000) return null;
  return { sinds: inloop.sinds, pasSinds };
}

/**
 * De kant van het hoofdvenster: welk los venster er aangemeld is, of het nog
 * inloopt, en waar een video-opname vandaan komt. `onWeg` gaat één keer af
 * als het aangemelde venster verdwijnt (afgemeld, of dicht gevonden na een crash).
 */
export class Beamer {
  constructor() {
    this.los = null;            // { venster, mixer, inloop: { sinds, pasSinds } | null, wasVerborgen }
    this.opnameWaar = null;     // 'hoofd' | 'los': gezet bij het starten van een video-opname
    this.onWeg = null;
    this.hoofdMengde = false;   // mengde het hoofdvenster bij de laatste wieMengt: is zijn beeld warm
  }

  /**
   * Het losse venster meldt zich (bij openen, na herladen van een van beide).
   * De laatste wint. Mengde het hoofdvenster net nog, dan loopt het eerst in.
   */
  meldAan(venster, mixer, nu = 0) {
    this.los = { venster, mixer, inloop: this.hoofdMengde ? { sinds: nu, pasSinds: null } : null, wasVerborgen: false };
  }

  /** Het losse venster gaat weg (pagehide). */
  meldAf(venster) {
    if (!this.los || this.los.venster !== venster) return false;
    this.los = null;
    this.onWeg?.();
    return true;
  }

  /** Het aangemelde venster, of null. Een venster dat zonder afmelden dicht ging wordt hier opgeruimd. */
  levend() {
    if (this.los && isDicht(this.los.venster)) {
      this.los = null;
      this.onWeg?.();
    }
    return this.los;
  }

  /**
   * Wie mengt er nu. Houdt ook de inloop bij: een verborgen los venster dat
   * weer zichtbaar wordt loopt opnieuw in (als het hoofdvenster intussen
   * mengde), en met het hoofdtabblad verborgen is er geen inloop.
   * @param hoofdVerborgen document.hidden van het hoofdvenster
   * @param nu             performance.now() van het hoofdvenster (ms)
   */
  wieMengt({ paneelOpen, opname, hoofdVerborgen = false, nu = 0 }) {
    const los = this.levend();
    const zichtbaar = !!los && !isVerborgen(los.venster);
    if (los && !zichtbaar) {
      los.wasVerborgen = true;
      los.inloop = null;
    } else if (los && los.wasVerborgen) {
      los.wasVerborgen = false;
      if (this.hoofdMengde) los.inloop = { sinds: nu, pasSinds: null };
    }
    if (los?.inloop && hoofdVerborgen) los.inloop = null;
    const stand = wieMengt({ losOpen: zichtbaar, paneelOpen, opname, inloop: !!los?.inloop });
    this.hoofdMengde = stand.hoofd;
    return stand;
  }

  /** Mengt DIT venster? Alleen het aangemelde: een tweede los venster wacht. */
  mengtLos(venster, stand) {
    return !!stand.los && this.los?.venster === venster;
  }

  /** Wat doet dit venster: 'mengt', 'inloop' of null (niets: een tweede los venster, of verborgen). */
  rolLos(venster, stand) {
    if (this.los?.venster !== venster) return null;
    return stand.los ? 'mengt' : stand.inloop ? 'inloop' : null;
  }

  /**
   * Het losse venster meldt tijdens de inloop elk beeld of zijn eigen video's
   * in de pas lopen. Geeft true zolang de inloop duurt, false als het losse
   * venster nu zelf mengt.
   */
  meldPas(venster, pas, nu) {
    const l = this.los;
    if (!l || l.venster !== venster) return false;
    l.inloop = inloopStap(l.inloop, pas, nu);
    return !!l.inloop;
  }

  /**
   * Het canvas voor een nieuwe video-opname: dat van het losse venster als dat
   * mengt (het loopt door als het hoofdtabblad verborgen is), anders het eigen.
   * Een verborgen los venster (geminimaliseerd, of achter het hoofdvenster op
   * hetzelfde scherm) mengt NIET: zijn lus staat stil, dus zijn canvas ook.
   * Tijdens de inloop staat op het losse canvas het beeld van het hoofdvenster,
   * dus ook dan het losse: daarna loopt de opname gewoon door.
   */
  opnameCanvas(hoofdCanvas) {
    const los = this.levend();
    const mengt = !!los && !isVerborgen(los.venster);
    this.opnameWaar = mengt ? 'los' : 'hoofd';
    return mengt ? los.mixer.canvas : hoofdCanvas;
  }
}
