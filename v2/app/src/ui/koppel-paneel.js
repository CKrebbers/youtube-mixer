/**
 * De koppeling met de Stroommachine op het scherm: aan/uit, het relay-adres (met de knopjes "deze Mac"
 * en "pc"), een extra latentie voor beamer of scherm, en de stand. Herkomst: v1 src/ui/beeld-paneel.js.
 *
 *   const kp = opzetKoppelPaneel({ koppeling, bus, wortel: $('#paneel-beeld'), meld });
 *   kp.teken()   // mag elke frame; tekent alleen als er iets veranderde
 *
 * WAAR (keuze, 20 okt): één compacte rij BOVENAAN de bediening van het tabblad Beeld (`.beeld-bediening`
 * in #paneel-beeld, gevuld door src/beeld/opzet.js). Waarom daar en geen eigen rij of tabblad:
 *   - het is beeld: wie de Stroommachine op de beamer zet, kijkt in het tabblad Beeld;
 *   - het paneel is 196 px hoog, met het doek links en de bediening rechts die zelf scrolt; één rij
 *     van ~26 px past erin zonder dat het doek of de noodknoppen verschuiven of krimpen, en bovenaan
 *     zie je meteen of de koppeling loopt;
 *   - index.html, styles.css en src/beeld/ blijven onaangeroerd: de rij gebruikt de bestaande klassen
 *     (.beeld-rij, .beeld-label, de knoppen van het paneel) en een paar inline maten.
 * Is er geen `.beeld-bediening` (beeld niet opgezet, of een ander `wortel`), dan komt de rij als eigen
 * element onderaan in `wortel`.
 *
 * Ontwerpregel: uit of zonder adres maakt de koppeling geen verbinding en tekent dit paneel niets
 * opnieuw: geen timer. Alleen zolang de zender loopt, twee keer per seconde opnieuw lezen (een
 * beeld-status veroudert zonder event). Een relay die er niet is geeft hooguit één melding per start
 * (dat doet de koppeling zelf).
 *
 * Aan/uit gaat over de bus (beeld.aan), zodat een controller het net zo kan; adres en latentie zijn
 * tekst en gaan rechtstreeks naar de koppeling. Toepassen bij Enter of bij het verlaten van een veld,
 * nooit per toets: elk ander adres is een nieuwe verbinding. Een geweigerd adres wordt niet bewaard.
 * Dit bestand importeert niets uit src/koppel/: alles wat het nodig heeft vraagt het aan de koppeling
 * (grenzen, adressen, klemLatentie, vraagtBevestiging).
 */
import { koppelStand, koppelTitel, KLEUR } from './koppel-weergave.js';

export const SLEUTELS = Object.freeze({ aan: 'varve.v2.koppel.aan', adres: 'varve.v2.koppel.adres', latentie: 'varve.v2.koppel.latentie' });
/** Zo vaak de stand opnieuw lezen zolang de zender loopt (ms). */
export const HERLEES_MS = 500;

const standaardOpslag = () => {
  try { return globalThis.localStorage ?? null; } catch (_) { return null; }
};

/**
 * @param koppeling  BeeldKoppeling (src/koppel/beeld.js)
 * @param bus        de bus (beeld.aan)
 * @param wortel     #paneel-beeld (of een ander element)
 * @param meld       (tekst, soort, sleutel) -> de meldingenstrook; optioneel
 * @param opslag     localStorage-achtig (getItem/setItem); standaard localStorage
 * @param doc, timers, nu  voor de test
 */
export function opzetKoppelPaneel({ koppeling, bus, wortel, meld = null, opslag = standaardOpslag(), doc = wortel?.ownerDocument ?? globalThis.document,
  timers = { setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis) }, nu = () => Date.now() } = {}) {
  const lees = (k) => { try { return opslag?.getItem(k) ?? null; } catch (_) { return null; } };
  const schrijf = (k, v) => { try { opslag?.setItem(k, v); } catch (_) { /* geen opslag: niet erg */ } };
  const g = koppeling.grenzen;
  const zet = (el, k, v) => { if (el[k] !== v) el[k] = v; };
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };

  // ---- de rij -------------------------------------------------------------------------
  const rij = doc.createElement('div');
  rij.className = 'beeld-rij beeld-koppel';
  rij.setAttribute('aria-label', 'De Stroommachine (beeld op de pc)');
  const label = doc.createElement('span');
  label.className = 'beeld-label';
  label.textContent = 'STROOM';
  label.title = 'De Stroommachine: VarveDJ stuurt klok, kenmerken, tracks en crossfader via de relay (poort 7702)';
  const aanKnop = doc.createElement('button');
  aanKnop.className = 'kp-aan';
  // Bewust GEEN data-actie: bindKnoppen (bediening.js) luistert op document.body en zou de knop dan een
  // tweede keer omzetten. De klik hieronder gaat zelf over de bus.
  aanKnop.title = 'De koppeling met de Stroommachine aan/uit (beeld.aan)';
  aanKnop.textContent = 'uit';
  const veld = (soort, cls, titel, breed) => {
    const i = doc.createElement('input');
    i.type = soort; i.className = cls; i.title = titel;
    Object.assign(i.style, { width: breed, font: '11px var(--f-cijfer)', color: 'var(--tekst)', background: 'var(--vlak2)',
      border: '1px solid var(--lijn)', borderRadius: 'var(--r)', padding: '1px 4px', minWidth: '0' });
    return i;
  };
  const adresVeld = veld('text', 'kp-adres', 'Het adres van de relay (ws://…:7702/app); Enter = toepassen', '150px');
  adresVeld.placeholder = 'ws://pc:7702/app';
  adresVeld.maxLength = g.adresMax;
  adresVeld.spellcheck = false;
  adresVeld.autocomplete = 'off';
  const keuzeKnoppen = koppeling.adressen.map(({ sleutel, naam, adres }) => {
    const b = doc.createElement('button');
    b.className = 'kp-kies';
    b.dataset.sleutel = sleutel;
    b.textContent = naam;
    b.title = sleutel === 'lokaal' ? `de relay op deze Mac (${adres})` : `de relay op de pc (${adres}), met Tailscale aan op Mac en pc`;
    return { b, sleutel, naam, adres };
  });
  const latLabel = doc.createElement('label');
  latLabel.className = 'beeld-label';
  latLabel.title = `Extra latentie voor beamer of scherm (ms, ${g.latentieMin} … +${g.latentieMax}): + = het beeld eerder`;
  latLabel.textContent = 'ms ';
  const latentieVeld = veld('number', 'kp-latentie', latLabel.title, '52px');
  latentieVeld.min = String(g.latentieMin);
  latentieVeld.max = String(g.latentieMax);
  latentieVeld.step = '5';
  latLabel.append(latentieVeld);
  const standEl = doc.createElement('span');
  standEl.className = 'kp-stand';
  Object.assign(standEl.style, { flex: '1 1 120px', minWidth: '0', font: '11px var(--f-cijfer)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  rij.append(label, aanKnop, adresVeld, ...keuzeKnoppen.map((k) => k.b), latLabel, standEl);
  const bediening = wortel?.querySelector?.('.beeld-bediening') ?? null;
  if (bediening) bediening.prepend(rij); else wortel?.append?.(rij);

  // ---- toestand ------------------------------------------------------------------------
  let geweigerd = null;   // waarom het adres in het veld geweigerd werd, of null
  let vies = true;        // er veranderde iets: opnieuw tekenen
  let herlees = null;     // de timer van HERLEES_MS, alleen zolang de zender loopt
  let zeker = null;       // { sleutel, tot }: de eerste klik op een adresknopje (bevestigen)
  let vorigeAan = null;

  const volgTimer = () => {
    if (koppeling.loopt && !herlees) herlees = timers.setInterval(() => { vies = true; teken(); }, HERLEES_MS);
    else if (!koppeling.loopt && herlees) { timers.clearInterval(herlees); herlees = null; }
  };
  const zonderStatus = koppeling.on('status', (s) => {
    vies = true;
    // aan/uit kan ook van de bus komen (een controller): dat onthouden, zoals de knop.
    if (vorigeAan !== null && s.aan !== vorigeAan) schrijf(SLEUTELS.aan, s.aan ? '1' : '0');
    vorigeAan = s.aan;
    volgTimer();
    teken();
  });
  const zonderMelding = koppeling.on('melding', ({ tekst, soort }) => meld?.(tekst, soort === 'fout' ? 'fout' : 'info', 'beeld-koppel'));

  // De bewaarde instellingen terug. Een bewaard adres was altijd geldig; is het dat toch niet (met de
  // hand veranderd), dan staat het rood in het veld, zonder melding: dat was geen poging van Clay.
  const bewaardAdres = lees(SLEUTELS.adres) ?? '';
  const begin = koppeling.zet({ aan: lees(SLEUTELS.aan) === '1', adres: bewaardAdres, latentie: lees(SLEUTELS.latentie) ?? 0 }, { vanzelf: true });
  if (!begin.ok) geweigerd = begin.reden;
  vorigeAan = koppeling.instellingen.aan;
  adresVeld.value = begin.ok ? koppeling.instellingen.adres : bewaardAdres;
  latentieVeld.value = String(koppeling.instellingen.latentie);

  aanKnop.addEventListener('click', () => {
    bus.doe('beeld.aan', true, { bron: 'scherm' });
    bus.doe('beeld.aan', false, { bron: 'scherm' });
  });

  const opEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } };
  adresVeld.addEventListener('keydown', opEnter);
  latentieVeld.addEventListener('keydown', opEnter);

  const pasAdresToe = () => {
    const r = koppeling.zet({ adres: adresVeld.value });
    if (r.ok) {
      geweigerd = null;
      adresVeld.value = koppeling.instellingen.adres;   // zoals hij gebruikt wordt (genormaliseerd), of leeg
      schrijf(SLEUTELS.adres, koppeling.instellingen.adres);
    } else {
      geweigerd = r.reden;
      meld?.(`beeld: adres geweigerd — ${r.reden}`, 'fout', 'beeld-koppel');
    }
    vies = true;
    teken();
  };
  adresVeld.addEventListener('change', pasAdresToe);

  // De knopjes "deze Mac · pc": alsof je het adres typte en Enter gaf. Verbonden met een ander adres:
  // eerst een tweede klik op hetzelfde knopje binnen een paar seconden (één misklik midden in een set).
  for (const k of keuzeKnoppen) {
    k.b.addEventListener('click', () => {
      const t = nu();
      if (koppeling.vraagtBevestiging(k.adres) && !(zeker?.sleutel === k.sleutel && t < zeker.tot)) {
        zeker = { sleutel: k.sleutel, tot: t + g.wisselBevestigMs };
        meld?.(`beeld: klik binnen ${g.wisselBevestigMs / 1000} s nog eens op "${k.naam}" om te wisselen naar ${k.adres} — `
          + 'de Stroommachine die nu meekijkt, verliest dan de klok van VarveDJ', 'info', 'beeld-koppel');
        return;
      }
      zeker = null;
      adresVeld.value = k.adres;
      pasAdresToe();
    });
  }

  latentieVeld.addEventListener('change', () => {
    const v = koppeling.klemLatentie(latentieVeld.value);
    latentieVeld.value = String(v);
    koppeling.zet({ latentie: v });
    schrijf(SLEUTELS.latentie, String(v));
    vies = true;
    // De focus eruit, anders doen de sneltoetsen niets tot je ergens anders klikt.
    latentieVeld.blur();
    teken();
  });


  /** Tekenen, alleen als er iets veranderde (een event, een klik, of de herlees-tik). */
  function teken() {
    if (!vies) return;
    vies = false;
    const s = koppeling.status();
    const st = koppelStand(s, geweigerd);
    zet(aanKnop, 'textContent', s.aan ? 'aan' : 'uit');
    if (aanKnop.dataset.stand !== (s.aan ? 'aan' : 'uit')) aanKnop.dataset.stand = s.aan ? 'aan' : 'uit';
    adresVeld.style.borderColor = geweigerd ? 'var(--kill)' : 'var(--lijn)';
    for (const k of keuzeKnoppen) {
      const brandt = !geweigerd && s.adres === k.adres;
      if (k.b.dataset.stand !== (brandt ? 'aan' : 'uit')) k.b.dataset.stand = brandt ? 'aan' : 'uit';
    }
    zet(standEl, 'textContent', st.tekst);
    if (standEl.dataset.soort !== st.soort) standEl.dataset.soort = st.soort;
    standEl.style.color = KLEUR[st.soort] ?? 'var(--dim)';
    zet(standEl, 'title', koppelTitel(s, st));
    klasse(rij, 'verbonden', !!s.verbonden);
  }

  volgTimer();
  teken();

  return {
    rij, teken,
    /** Weg: timers en luisteraars los, de rij uit het paneel (de koppeling zelf blijft). */
    vernietig() { if (herlees) { timers.clearInterval(herlees); herlees = null; } zonderStatus(); zonderMelding(); rij.remove?.(); },
    get geweigerd() { return geweigerd; },
  };
}
