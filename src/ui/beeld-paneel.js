import { DECK_IDS } from '../engine/engine.js';
import { BeeldKoppeling, klemLatentie, ADRES_MAX, LATENTIE_MIN, LATENTIE_MAX, BEELD_ADRESSEN } from '../koppel/beeld.js';
import { beeldStand } from './beeld-weergave.js';
import { meld } from './meldingen.js';

/*
 * De BEELD-rij (docs/BEELD.md): VARVE stuurt de Stroommachine, de
 * beeldmachine op de Omarchy-pc, via de Varve-relay. Aan/uit, het
 * relay-adres, een extra latentie voor beamer of scherm, en de stand.
 * Openen en sluiten met de knop "beeld" in de balk (onthouden, standaard
 * dicht), zoals KOPTELEFOON en MASTER. Op die knop een klein lampje, alleen
 * als beeld aan staat: uit ziet de knop eruit als altijd.
 *
 * Ontwerpregel: MacBook + APC is genoeg. Uit of zonder adres maakt de
 * koppeling geen verbinding en tekent deze module niets opnieuw; een relay
 * die er niet is geeft hooguit één melding per start (dat doet beeld.js).
 *
 * Naast het adresveld twee knopjes, "deze Mac" en "pc" (BEELD_ADRESSEN): één
 * klik zet dat adres in het veld en past het toe zoals Enter (dezelfde controle,
 * opslag en melding). Het knopje van het adres dat nu geldt, brandt.
 *
 * Toepassen bij Enter of bij het verlaten van een veld (change), nooit per
 * toets: elk ander adres is een nieuwe verbinding. Een geweigerd adres wordt
 * niet bewaard: het laatst geldige blijft in localStorage en is er na
 * herladen weer.
 */
const OPEN = 'varve.beeld.open';
const AAN = 'varve.beeld.aan';
const ADRES = 'varve.beeld.adres';
const LATENTIE = 'varve.beeld.latentie';
const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const schrijf = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

/**
 * Zo vaak de stand opnieuw lezen zolang de zender loopt (ms): een beeld-status
 * veroudert vanzelf (BEELD_VERS_MS in beeld.js), zonder dat er een event komt.
 */
const HERLEES_MS = 500;

export function opzetBeeld({ engine }) {
  // Pas zenden als app.js zegt dat dit het tabblad met de APC is (magZenden):
  // een tweede tabblad deelt localStorage en zou anders ook verbinden.
  const beeld = new BeeldKoppeling({ engine, ids: DECK_IDS, mag: false });
  const rij = document.getElementById('beeld');
  const knop = document.getElementById('beeld-btn');
  const aanKnop = rij.querySelector('.bd-aan');
  const adresVeld = rij.querySelector('.bd-adres');
  const latentieVeld = rij.querySelector('.bd-latentie');
  const standEl = rij.querySelector('.bd-stand');
  const keuze = rij.querySelector('.bd-keuze');
  // De grenzen komen uit beeld.js: één plek.
  adresVeld.maxLength = ADRES_MAX;
  latentieVeld.min = String(LATENTIE_MIN);
  latentieVeld.max = String(LATENTIE_MAX);
  const KNOP_TITEL = knop.title;

  const tekst = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const titel = (el, t) => { if (el.title !== t) el.title = t; };
  const data = (el, k, v) => {
    if (v == null) { if (k in el.dataset) delete el.dataset[k]; } else if (el.dataset[k] !== v) el.dataset[k] = v;
  };
  const isDicht = () => rij.classList.contains('hidden');

  let geweigerd = null;   // waarom het adres in het veld geweigerd werd, of null
  let vies = true;        // er veranderde iets: de volgende frame opnieuw tekenen
  let herlees = 0;        // performance.now() waarop de stand opnieuw gelezen wordt (alleen als de zender loopt)

  beeld.on('status', () => { vies = true; });
  beeld.on('melding', ({ tekst: t, soort }) => meld(t, soort === 'fout' ? 'fout' : 'info'));

  const zetOpen = (open) => {
    rij.classList.toggle('hidden', !open);
    knop.style.color = open ? 'var(--text)' : '';
    schrijf(OPEN, open ? '1' : '0');
  };
  knop.addEventListener('click', () => zetOpen(isDicht()));
  if (lees(OPEN) === '1') zetOpen(true);

  // De bewaarde instellingen terug. Een adres in localStorage is altijd een
  // geldig adres geweest; is het dat toch niet (met de hand veranderd), dan
  // staat het rood in het veld, zonder melding: dat was geen poging van jou.
  const bewaardAdres = lees(ADRES) ?? '';
  // `vanzelf`: geen relay bij het opstarten (de pc staat uit) = een melding die weggaat, geen rode.
  const begin = beeld.zet({ aan: lees(AAN) === '1', adres: bewaardAdres, latentie: lees(LATENTIE) ?? 0 }, { vanzelf: true });
  if (!begin.ok) geweigerd = begin.reden;
  adresVeld.value = begin.ok ? beeld.instellingen.adres : bewaardAdres;
  latentieVeld.value = String(beeld.instellingen.latentie);

  aanKnop.addEventListener('click', () => {
    const aan = !beeld.instellingen.aan;
    beeld.zet({ aan });
    schrijf(AAN, aan ? '1' : '0');
    vies = true;
  });

  // Enter = toepassen: het veld verlaten, dan volgt 'change' (één keer).
  const opEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } };
  adresVeld.addEventListener('keydown', opEnter);
  latentieVeld.addEventListener('keydown', opEnter);

  adresVeld.addEventListener('change', () => {
    const r = beeld.zet({ adres: adresVeld.value });
    if (r.ok) {
      geweigerd = null;
      adresVeld.value = beeld.instellingen.adres;   // zoals hij gebruikt wordt (genormaliseerd), of leeg
      schrijf(ADRES, beeld.instellingen.adres);
    } else {
      geweigerd = r.reden;
      meld(`beeld: adres geweigerd — ${r.reden}`, 'fout');
    }
    vies = true;
  });

  // De knopjes "deze Mac · pc": alsof je het adres typte en Enter gaf.
  const keuzeKnoppen = BEELD_ADRESSEN.map(({ sleutel, naam, adres }) => {
    const b = document.createElement('button');
    b.className = 'btn sm bd-kies';
    b.dataset.sleutel = sleutel;
    b.textContent = naam;
    b.title = sleutel === 'lokaal'
      ? `de relay op deze Mac (${adres}): start hem met zsh tools/beeld-lokaal.sh (docs/BEELD.md §8)`
      : `de relay op de pc (${adres}), met Tailscale aan op Mac en pc`;
    b.addEventListener('click', () => {
      adresVeld.value = adres;
      adresVeld.dispatchEvent(new Event('change'));
    });
    keuze?.append(b);
    return { b, adres };
  });

  latentieVeld.addEventListener('change', () => {
    const v = klemLatentie(latentieVeld.value);
    latentieVeld.value = String(v);
    beeld.zet({ latentie: v });
    schrijf(LATENTIE, String(v));
    vies = true;
    // Ook na een klik op de pijltjes: de focus eruit, anders doen de sneltoetsen
    // (spatie = play, cijfers = loops) niets tot je ergens anders klikt.
    latentieVeld.blur();
  });

  /**
   * Eén frame (renderloop). Alleen als er iets veranderde (een event van de
   * koppeling, een klik), en zolang de zender loopt twee keer per seconde,
   * want een beeld-status veroudert zonder event. Uit kost dit één vergelijking.
   */
  function teken() {
    if (!vies && !(beeld.loopt && performance.now() >= herlees)) return;
    vies = false;
    herlees = performance.now() + HERLEES_MS;
    const s = beeld.status();
    const st = beeldStand(s, geweigerd);

    data(knop, 'lamp', st.lamp);
    titel(knop, st.lamp ? `${KNOP_TITEL} — nu: ${st.tekst}` : KNOP_TITEL);

    tekst(aanKnop, s.aan ? 'aan' : 'uit');
    klasse(aanKnop, 'on', s.aan);
    klasse(adresVeld, 'fout', !!geweigerd);
    for (const k of keuzeKnoppen) klasse(k.b, 'on', !geweigerd && s.adres === k.adres);
    tekst(standEl, st.tekst);
    data(standEl, 'soort', st.soort);
    titel(standEl, s.beeld
      ? `de Stroommachine: ${Math.round(s.beeld.fps)} fps, `
        + `${s.beeld.bpm ? `${String(Math.round(s.beeld.bpm * 10) / 10).replace('.', ',')} bpm` : 'geen tempo'}, `
        + `${s.beeld.volgt ? 'volgt de klok van VARVE' : 'op haar eigen klok (er speelt niets, of ze volgt niet)'}`
      : st.tekst);
  }

  return { beeld, teken };
}
