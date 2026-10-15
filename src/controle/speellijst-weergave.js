/**
 * De speellijst per deel (16 okt; Clay: "waarom zijn er twee controlekamers? laten we die zo goed mogelijk
 * samenvoegen"). Het losse artifact "Varve Controlekamer" had één avond tegelijk, één punt tegelijk met grote
 * knoppen, "alleen de kern" en een verslag om te kopiëren; dat staat nu hier, op dezelfde stand
 * (proef/sessie.json via /api/proef), zodat er één Controlekamer is. Puur: geen DOM, dus
 * test/speellijst-weergave.test.mjs rekent het na. controle.js tekent.
 *
 * Een deel is het stuk van de bloktitel vóór " · " ("Avond 1 · Opstarten" hoort bij "Avond 1").
 */

/** De delen in hun volgorde (test/controle.test.mjs eist dat elke bloktitel met een ervan begint). */
export const DELEN = [
  { naam: 'Vooraf', wat: 'overdag, zonder muziek', kleur: 'vooraf' },
  { naam: 'Avond 1', wat: 'mixen, APC direct', kleur: 'a1', opstelling: 'apc', profiel: 'apc' },
  { naam: 'Avond 2', wat: 'spelen, met de hub', kleur: 'a2', opstelling: 'alles', profiel: 'alles' },
  { naam: 'Avond 3', wat: 'beeld, met de pc', kleur: 'a3', profiel: 'beeld' },
  { naam: 'Werkruimte', wat: 'de werkruimte', kleur: 'a4' },
  { naam: 'Eerder werk', wat: 'als er tijd over is', kleur: 'eerder' },
];

/** De kern van avond 1 (~50 min): wie weinig tijd heeft, doet alleen deze blokken. */
export const KERN = ['start', 'luisteren', 'draaien', 'koptelefoon', 'keylock'];

export const deelVan = (blok) => String(blok?.titel ?? '').split(' · ')[0];

/** De blokken van een deel; `kern` alleen bij een deel dat kernblokken heeft. 'alles' = alle blokken. */
export function blokkenVan(lijst, deel, { kern = false } = {}) {
  const b = deel === 'alles' ? lijst : lijst.filter((x) => deelVan(x) === deel);
  const k = b.filter((x) => KERN.includes(x.id));
  return kern && k.length ? k : b;
}

export const heeftKern = (lijst, deel) => blokkenVan(lijst, deel).some((b) => KERN.includes(b.id));

export const idsVan = (blokken) => blokken.flatMap((b) => b.punten.map((p) => p.id));

const statusVan = (items, id) => items?.[id]?.status ?? 'open';

/** { ok, fout, overslaan, open, gedaan, totaal } over deze ids. */
export function telling(ids, items) {
  const t = { ok: 0, fout: 0, overslaan: 0, open: 0 };
  for (const id of ids) { const s = statusVan(items, id); t[s in t ? s : 'open']++; }
  return { ...t, gedaan: ids.length - t.open, totaal: ids.length };
}

/** Het eerste open punt NA `vanaf` (rondgaand), of null als alles gedaan is. Zonder `vanaf`: van voren af. */
export function eersteOpen(ids, items, vanaf = null) {
  const i0 = vanaf === null ? -1 : ids.indexOf(vanaf);
  for (let i = 1; i <= ids.length; i++) {
    const id = ids[(i0 + i + ids.length) % ids.length];
    if (statusVan(items, id) === 'open') return id;
  }
  return null;
}

/** Welk deel opent er: het eerste met een open punt (Vooraf vóór Avond 1 …), anders het eerste. */
export function beginDeel(lijst, items) {
  for (const d of DELEN) {
    const ids = idsVan(blokkenVan(lijst, d.naam));
    if (ids.length && eersteOpen(ids, items) !== null) return d.naam;
  }
  return DELEN[0].naam;
}

/** Waar een punt staat: { blok, nr (vanaf 1), van } of null. */
export function plekVan(lijst, id) {
  for (const blok of lijst) {
    const i = blok.punten.findIndex((p) => p.id === id);
    if (i >= 0) return { blok, punt: blok.punten[i], nr: i + 1, van: blok.punten.length };
  }
  return null;
}

/**
 * De vraagcodes aan het eind van een "let", tussen haakjes: "(GA11)", "(I4, O2)", "(W2/W33/W40)", "(AR21)".
 * Alleen codes in de vorm van VRAGEN.md (hoofdletters, dan cijfers): "(bv. 150)" telt niet.
 */
export function vraagCodes(tekst) {
  const m = /\(([^()]*)\)\s*$/.exec(String(tekst ?? ''));
  if (!m) return [];
  const codes = m[1].split(/[\s,/]+/).filter(Boolean);
  return codes.length && codes.every((c) => /^[A-Z]{1,4}\d{1,3}[a-z]?$/.test(c)) ? codes : [];
}

const STATUS_TEKST = { ok: 'ok', fout: 'fout', overslaan: 'overgeslagen', open: 'open' };

/**
 * Het verslag van een deel als platte tekst, om in de chat te plakken (zoals het artifact): de telling, dan
 * FOUT (met de notitie), dan de notities en antwoorden bij de rest. Claude leest ook proef/sessie.json zelf.
 */
export function verslagTekst(lijst, deel, items) {
  const blokken = blokkenVan(lijst, deel);
  const ids = idsVan(blokken);
  const t = telling(ids, items);
  const titel = deel === 'alles' ? 'alle delen' : deel;
  const regels = [`Varve proefsessie · ${titel}`,
    `${t.gedaan} van ${t.totaal} gedaan: ${t.ok} ok, ${t.fout} fout, ${t.overslaan} overgeslagen, ${t.open} open.`, ''];
  const deelLijst = (kop, wie) => {
    const xs = ids.filter(wie);
    if (!xs.length) return;
    regels.push(kop);
    for (const id of xs) {
      const { blok, punt } = plekVan(blokken, id);
      const codes = vraagCodes(punt.let);
      regels.push(`- [${STATUS_TEKST[statusVan(items, id)] ?? 'open'}] ${blok.titel} (${id}): ${punt.doe}${codes.length ? ` (${codes.join(', ')})` : ''}`);
      const n = String(items?.[id]?.notitie ?? '').trim();
      if (n) regels.push(`  ${n.replace(/\n/g, '\n  ')}`);
    }
    regels.push('');
  };
  deelLijst('FOUT', (id) => statusVan(items, id) === 'fout');
  deelLijst('NOTITIES EN ANTWOORDEN', (id) => statusVan(items, id) !== 'fout' && String(items?.[id]?.notitie ?? '').trim());
  return regels.join('\n').trim();
}
