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
 */

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
 * @param losOpen    er hangt een levend los venster aan
 * @param paneelOpen het videopaneel in het hoofdvenster is open
 * @param opname     waar een lopende video-opname zijn beeld vandaan haalt: 'hoofd', 'los' of null
 * @returns { hoofd, los, voorbeeld } — voorbeeld: het paneel toont het beeld van het losse venster
 */
export function wieMengt({ losOpen, paneelOpen, opname = null }) {
  const los = !!losOpen;
  const hoofd = (!!paneelOpen && !los) || opname === 'hoofd';
  return { hoofd, los, voorbeeld: !!paneelOpen && los && !hoofd };
}

/**
 * De kant van het hoofdvenster: welk los venster er aangemeld is, en waar een
 * video-opname vandaan komt. `onWeg` gaat één keer af als het aangemelde
 * venster verdwijnt (afgemeld, of dicht gevonden na een crash).
 */
export class Beamer {
  constructor() {
    this.los = null;            // { venster, mixer }
    this.opnameWaar = null;     // 'hoofd' | 'los': gezet bij het starten van een video-opname
    this.onWeg = null;
  }

  /** Het losse venster meldt zich (bij openen, na herladen van een van beide). De laatste wint. */
  meldAan(venster, mixer) {
    this.los = { venster, mixer };
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

  wieMengt({ paneelOpen, opname }) {
    const los = this.levend();
    return wieMengt({ losOpen: !!los && !isVerborgen(los.venster), paneelOpen, opname });
  }

  /** Mengt DIT venster? Alleen het aangemelde: een tweede los venster wacht. */
  mengtLos(venster, stand) {
    return !!stand.los && this.los?.venster === venster;
  }

  /**
   * Het canvas voor een nieuwe video-opname: dat van het losse venster als dat
   * mengt (het loopt door als het hoofdtabblad verborgen is), anders het eigen.
   * Een verborgen los venster (geminimaliseerd, of achter het hoofdvenster op
   * hetzelfde scherm) mengt NIET: zijn lus staat stil, dus zijn canvas ook.
   */
  opnameCanvas(hoofdCanvas) {
    const los = this.levend();
    const mengt = !!los && !isVerborgen(los.venster);
    this.opnameWaar = mengt ? 'los' : 'hoofd';
    return mengt ? los.mixer.canvas : hoofdCanvas;
  }
}
