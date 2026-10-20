/**
 * De acties van beeld op de bus (BOUWPLAN plak 4). Het beeld is geen engine (het schrijft er nooit
 * in), maar wat je eraan draait hoort wél op de bus: dan kan een controllerknop het net zo goed als de
 * muis, staat het in het log, en volgen de knoppen op het scherm vanzelf (bus.lees).
 *
 * De namen zijn die van v1 (src/control/actions.js, bindVideo en bindVormen), zodat de telling en
 * oude logs blijven kloppen:
 *   video.fx.pixel | .mirror | .rgb | .color | .trails | .grain     waarde 0..1 (color: 0,5 = normaal)
 *   video.fx.<naam>.hold                                           trigger: vol zolang je drukt
 *   video.mode, video.fit, video.pulse.target                      trigger: rondlopen
 *   video.pulse                                                    waarde: puls op de tel van de KLOK
 *   video.clips                                                    trigger, schakelaar: deck-video's aan/uit
 *   video.black (schakelaar, fade 250 ms), video.black.hold (direct), video.freeze, video.flash   trigger
 *   video.master                                                   waarde: helderheid van het eindbeeld
 *   video.layer.select.1 / .2, video.layer.select.next / .prev     trigger: welke vormlaag de knoppen bedienen
 *   video.layer.on, video.layer.next / .prev (vorm), video.layer.blend   trigger, op de gekozen laag
 *   video.layer.knob.1 … .6, video.layer.opacity                   waarde, op de gekozen laag (een PLEK)
 *   video.layer.react                                              waarde: sterkte van "reageren op de mix"
 *   video.layer.react.source / .target                             trigger: rondlopen (bron, welke knop)
 * In de opdracht voor v2 heetten twee daarvan anders (video.layer.vorm.volgend/.vorig, video.layer.dekking):
 * de v1-naam gaat voor ("gebruik de namen van v1 waar die bestonden").
 *
 * De bus kent alleen {n} (1..8 tracks): de tweede index (K, de laag) is hier in een lus uitgeschreven.
 * Elke actie heeft een lees() (lampjes, ringen): 1/0 voor een schakelaar, index/(n−1) voor een
 * rondloper, null als er niets te doen is (geen vormlagen).
 *
 * Meta: wat een gebaar is (vasthouden, flits, rondlopen) hoort niet in de beginstand van het log;
 * zwart, bevriezen en clips zijn een stand (`schakelaar: true`, v1 RONDLOPERS).
 */
import { VIDEO_FX, VIDEO_FX_ACTIE, MODI } from './instellingen.js';
import { PULS_DOELEN } from './puls.js';
import { FITS } from './passen.js';
import { MENGVORMEN } from './lagen.js';
import { BRONNEN, DOEL_PLEKKEN } from './analyse/router.js';

export const VORM_KNOPPEN = 6;
const plek = (lijst, v) => (lijst.length > 1 ? Math.max(0, lijst.indexOf(v)) / (lijst.length - 1) : 0);
const GEBAAR = { beginstand: false };

/**
 * @param bus    de bus (kern/bus.js)
 * @param beeld  het beeldmodel (stand.js): stand, eind, vormen, router
 * @returns de lijst met gedefinieerde id's (voor de tests en het scherm)
 */
export function definieerBeeld(bus, beeld) {
  const ids = [];
  const def = (d) => { bus.defineer(d); ids.push(d.id); };
  const st = beeld.stand;

  // ---- de video-effecten -------------------------------------------------------------
  for (const fx of VIDEO_FX) {
    const naam = VIDEO_FX_ACTIE[fx.id] ?? fx.id;
    def({ id: `video.fx.${naam}`, soort: 'waarde', label: `video ${fx.naam.toLowerCase()}`, meta: fx.bipolair ? { bipolair: true } : {},
      doe: (v) => { beeld.zetFx(fx.id, v); }, lees: () => st.fx[fx.id] });
    def({ id: `video.fx.${naam}.hold`, soort: 'trigger', label: `video ${fx.naam.toLowerCase()} vasthouden`, meta: GEBAAR,
      doe: (v) => { beeld.houdFx(fx.id, v); }, lees: () => (fx.id in beeld.vasthouden ? 1 : 0) });
  }
  def({ id: 'video.mode', soort: 'trigger', label: 'video: volgende mengvorm', meta: GEBAAR,
    doe: (v) => { if (v) beeld.volgendeModus(); }, lees: () => plek(MODI, st.modus) });
  def({ id: 'video.fit', soort: 'trigger', label: 'video: passend of vullen', meta: GEBAAR,
    doe: (v) => { if (v) beeld.volgendeFit(); }, lees: () => plek(FITS, st.fit) });
  def({ id: 'video.pulse', soort: 'waarde', label: 'video: puls op de tel van de klok',
    doe: (v) => { beeld.zetPuls(v); }, lees: () => st.puls });
  def({ id: 'video.pulse.target', soort: 'trigger', label: 'video: wat er pulst', meta: GEBAAR,
    doe: (v) => { if (v) beeld.volgendPulsDoel(); }, lees: () => plek(PULS_DOELEN, st.pulsDoel) });

  // ---- het zaalbeeld en de noodknoppen (het EINDbeeld: zaal, los venster en opname zien hetzelfde) ----
  def({ id: 'video.clips', soort: 'trigger', label: 'video: deck-video\'s aan/uit (uit = alleen eigen beeld)', meta: { schakelaar: true },
    doe: (v) => { if (v) beeld.zetClips(!st.clips); }, lees: () => (st.clips ? 1 : 0) });
  // lees = de stand van de SCHAKELAAR, niet hoe ver de fade is: een lampje zegt meteen wat je deed.
  def({ id: 'video.black', soort: 'trigger', label: 'video: zwart (aan/uit)', meta: { schakelaar: true },
    doe: (v) => { if (v) beeld.zetZwart(!beeld.eind.zwartAan); }, lees: () => (beeld.eind.zwartAan ? 1 : 0) });
  def({ id: 'video.black.hold', soort: 'trigger', label: 'video: zwart zolang je drukt', meta: GEBAAR,
    doe: (v) => { beeld.zetZwartVast(!!v); }, lees: () => (beeld.eind.zwartVast ? 1 : 0) });
  def({ id: 'video.freeze', soort: 'trigger', label: 'video: beeld bevriezen (aan/uit)', meta: { schakelaar: true },
    doe: (v) => { if (v) beeld.zetBevroren(!beeld.eind.bevroren); }, lees: () => (beeld.eind.bevroren ? 1 : 0) });
  def({ id: 'video.master', soort: 'waarde', label: 'video: master (helderheid van het eindbeeld)',
    doe: (v) => { beeld.zetMaster(v); }, lees: () => beeld.eind.master });
  def({ id: 'video.flash', soort: 'trigger', label: 'video: witte flits', meta: GEBAAR,
    doe: (v) => { if (v) beeld.flits(); }, lees: () => (beeld.flitsNu() > 0 ? 1 : 0) });

  // ---- de vormlagen ------------------------------------------------------------------
  const vormen = () => beeld.vormen;
  const laag = () => beeld.vormen?.laag ?? null;
  const aantal = beeld.vormen?.lagen.length ?? 2;
  for (let i = 0; i < aantal; i++) {
    def({ id: `video.layer.select.${i + 1}`, soort: 'trigger', label: `vormlaag ${i + 1} kiezen`, meta: GEBAAR,
      doe: (v) => { if (v) vormen()?.kies(i); }, lees: () => (vormen() ? (vormen().gekozen === i ? 1 : 0) : null) });
  }
  def({ id: 'video.layer.select.next', soort: 'trigger', label: 'volgende vormlaag kiezen', meta: GEBAAR,
    doe: (v) => { if (v && vormen()) vormen().kies(vormen().gekozen + 1); }, lees: () => (vormen() ? 0 : null) });
  def({ id: 'video.layer.select.prev', soort: 'trigger', label: 'vorige vormlaag kiezen', meta: GEBAAR,
    doe: (v) => { if (v && vormen()) vormen().kies(vormen().gekozen - 1); }, lees: () => (vormen() ? 0 : null) });
  def({ id: 'video.layer.on', soort: 'trigger', label: 'vormlaag aan/uit', meta: { schakelaar: true },
    doe: (v) => { if (v) vormen()?.wisselAan(); }, lees: () => (laag() ? (laag().aan ? 1 : 0) : null) });
  def({ id: 'video.layer.next', soort: 'trigger', label: 'vormlaag: volgende vorm', meta: GEBAAR,
    doe: (v) => { if (v) vormen()?.stapSysteem(1); }, lees: () => (laag() ? 0 : null) });
  def({ id: 'video.layer.prev', soort: 'trigger', label: 'vormlaag: vorige vorm', meta: GEBAAR,
    doe: (v) => { if (v) vormen()?.stapSysteem(-1); }, lees: () => (laag() ? 0 : null) });
  def({ id: 'video.layer.blend', soort: 'trigger', label: 'vormlaag: mengvorm (screen · add · multiply)', meta: GEBAAR,
    doe: (v) => { if (v) vormen()?.volgendeMengvorm(); }, lees: () => (laag() ? plek(MENGVORMEN, laag().mengvorm) : null) });
  // Knoppen wijzen naar een PLEK op de GEKOZEN laag (oogst beeld-053): een andere vorm vraagt geen nieuwe koppeling.
  for (let k = 1; k <= VORM_KNOPPEN; k++) {
    def({ id: `video.layer.knob.${k}`, soort: 'waarde', label: `vormlaag: knop ${k}`,
      doe: (v) => { laag()?.zetKnop(k - 1, v); }, lees: () => laag()?.leesKnop(k - 1) ?? null });
  }
  def({ id: 'video.layer.opacity', soort: 'waarde', label: 'vormlaag: dekking',
    doe: (v) => { vormen()?.zetDekking(v); }, lees: () => laag()?.dekking ?? null });

  // Reageren op de mix: per laag één route, op de gekozen laag. De sterkte is een offset bovenop de knop.
  const router = () => beeld.router;
  const gekozen = () => vormen()?.gekozen ?? 0;
  def({ id: 'video.layer.react', soort: 'waarde', label: 'vormlaag: reageren op de mix (sterkte)',
    doe: (v) => { router()?.zetSterkte(gekozen(), v); }, lees: () => router()?.route(gekozen()).sterkte ?? null });
  def({ id: 'video.layer.react.source', soort: 'trigger', label: 'vormlaag: reageren op laag · midden · hoog · klap · luid (de zaal) · tel · de 1 (de klok)', meta: GEBAAR,
    doe: (v) => { if (v) router()?.volgendeBron(gekozen()); }, lees: () => (router() ? plek(BRONNEN, router().route(gekozen()).bron) : null) });
  def({ id: 'video.layer.react.target', soort: 'trigger', label: `vormlaag: reageren, welke knop (1–${DOEL_PLEKKEN})`, meta: GEBAAR,
    doe: (v) => { if (v) router()?.volgendDoel(gekozen()); }, lees: () => (router() ? (router().route(gekozen()).doel - 1) / (DOEL_PLEKKEN - 1) : null) });

  return ids;
}
