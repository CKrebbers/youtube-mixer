// De uitleg van de actions van spoor S9 ('set', docs/PLAN-SET.md §7): { kort, lang } zoals beschrijf()
// in apc-beschrijf.js, of null. Puur: geen DOM, geen bus (apc.html en maschine.html laden dit statisch).
const UITLEG = {
  'plan.go': ['GO', 'set: de klaarstaande overgang nu (de eerstvolgende 4 maten); een stap die op GO wacht begint alleen zo (of op het laatste moment, nooit stilte)'],
  'plan.buiten': ['buiten plan', 'set: buiten het plan — de automaat maakt een lopende overgang af, laat dan alles los en kijkt mee; nog eens = terug naar het plan'],
  'plan.terug': ['terug', 'set: terug naar het plan — wat nu het hardst klinkt wordt de hoofdtrack (jij geeft hem terug), het plan gaat verder na de laatste stap die speelde'],
  'plan.laag.nu': ['laag nu', 'set: de volgende laag van deze stap nu starten (een acapella, sample of patroon op een track van jou)'],
  'plan.laag.skip': ['laag weg', 'set: de volgende laag van deze stap overslaan'],
  'set.bewaar': ['set bewaar', 'set: de gekozen set bewaren (plan, patronen, werkruimte; met de mixer als "met mixer" aan staat), met versie: nooit stil over een ander heen'],
  'set.next': ['set ▶', 'set: de volgende set in de lijst kiezen'],
  'set.prev': ['◀ set', 'set: de vorige set in de lijst kiezen'],
  'set.terugladen': ['set laad', 'set: de gekozen set terugladen (plan, patronen, werkruimte; met de mixer als "met mixer" aan staat). Er start niets; over een spelende track pas bij de tweede druk binnen 3 s'],
  'set.moment': ['met mixer', 'set: bewaren en terugladen met of zonder de momentopname van de mixer (welk nummer waar, standen, racks, pads)'],
};

export default function set(action) {
  const u = UITLEG[action];
  return u ? { kort: u[0], lang: u[1] } : null;
}
