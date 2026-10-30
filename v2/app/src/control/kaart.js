/**
 * De kaart van een apparaat: per control wat hij NU doet en hoe hij er nu uitziet, voor het meekijkvenster
 * (kaart.html, Clay 30 okt: "4 vensters tegelijk om het te leren en te bouwen"). Puur: leest alleen de
 * indeling en de bus, zoals Lampjes, en rekent de kleur op dezelfde manier (kleurVan, standVan). Zo is wat
 * je op het scherm ziet hetzelfde als wat er op het apparaat brandt, ook zonder apparaat.
 *
 *   kaartVan(indeling) -> Map(control-id -> { id, soort, led, label, actie, v, kleur, aan, laag })
 *     label   de naam uit de indeling (wat er op het knopje staat), anders de actie, anders null
 *     actie   de actie met ingevulde variabelen (null: niets gekoppeld, of nu niets door de focus)
 *     v       de stand 0..1 (of null) die het lampje leest
 *     kleur   paletnaam voor een rgb-lampje ('uit' als het donker is), anders null
 *     aan     brandt een eenkleurig lampje
 *     laag    het is een laagknop (opent een ruimte of padstand)
 *   welkeControl(indeling, actie) -> de control-id waarop deze actie nu ligt, of null
 */
import { isLaagActie } from './indeling.js';
import { kleurVan, standVan } from './lampjes.js';

const getal = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' && Number.isFinite(v) ? v : null);

export function kaartVan(ind) {
  const dev = ind.apparaat;
  const regels = ind.actieveRegels();
  const uit = new Map();
  for (const c of dev.controls.values()) {
    const regel = regels.get(c.id) ?? null;
    const actie = regel ? ind.vul(regel.actie) : null;
    const bron = regel ? (regel.led?.lees ? ind.vul(regel.led.lees) : actie) : null;
    const v = bron ? getal(ind.lees(bron)) : null;
    let kleur = null, aan = false;
    if (c.led === 'rgb' || c.led === 'ab') kleur = v === null ? 'uit' : kleurVan(regel, c, dev)[standVan(v)];
    else aan = v !== null && v > 0.01;
    uit.set(c.id, {
      id: c.id, soort: c.soort, led: c.led, naam: c.label,
      label: regel?.label ?? (actie ? actie.replace(/^laag:/, '') : null),
      actie, v, kleur, aan, laag: !!regel && isLaagActie(regel.actie),
    });
  }
  return uit;
}

export function welkeControl(ind, actie) {
  for (const [control, r] of ind.actieveRegels()) if (ind.vul(r.actie) === actie) return control;
  return null;
}
