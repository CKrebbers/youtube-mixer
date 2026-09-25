import { faderGain } from '../engine/audio-graph.js';

/**
 * Video-effecten op de tel. Puur rekenwerk: geen DOM, geen WebGL.
 *
 * De maat komt van wat je HOORT: de track die het hardst klinkt, speelt en een
 * beatgrid heeft. Zelfde gedachte als sync — er is geen "het andere deck".
 * De puls komt bovenop de stand van de knop: RGB op 30% springt op de tel
 * omhoog en zakt terug naar 30%.
 */

/** Wat er kan pulsen. "flits" is geen effectknop maar een lichtflits op de tel. */
export const PULS_DOELEN = ['rgb', 'pixel', 'spiegel', 'korrel', 'flits'];

/**
 * De vorm van één tel: vol op de tel, dan snel uitdoven. Op een halve tel
 * is er nog 8% over; zo blijft het een klap en geen golf.
 * @param fase 0..1 binnen de tel
 */
export const pulsVorm = (fase) => Math.exp(-5 * Math.max(0, Math.min(1, fase)));

/**
 * Hoe hard een track KLINKT, om de maatgever te kiezen: de fader met zijn
 * dB-curve maal de crossfader. Dezelfde rangorde als engine.syncMaster (sync,
 * sampler, sends, de MAAT-badge), zodat puls en vormen op de tel slaan van de
 * track waar MAAT op staat. Niet de lineaire zichtbaarheid (volg.js): die is
 * voor het mengen van beeld, en zette een track op fader 0,8 (thru) boven een
 * op vol met de crossfader in het midden, terwijl die eerste 6 dB zachter klinkt.
 */
export const klinkt = (fader, xfadeGain) => faderGain(fader) * Math.max(0, Math.min(1, xfadeGain));

/**
 * Welke track geeft de maat aan?
 * @param tracks [{ id, speelt, heeftGrid, zicht }] — zicht = hoe hard hij klinkt (klinkt())
 * @returns id of null. Een track die je niet hoort (fader dicht, crossfader
 *   weg) geeft geen maat, ook al zet syncMaster er MAAT op: geen tel te zien.
 */
export function klokTrack(tracks) {
  let beste = null, hoogste = 0.001;
  for (const t of tracks) {
    if (!t.speelt || !t.heeftGrid || t.zicht <= hoogste) continue;
    beste = t.id; hoogste = t.zicht;
  }
  return beste;
}

/** De maatgever uit de engine (alleen uitlezen, duck-typed): klokTrack op klinkt(). */
export function maatgever(engine, ids) {
  return klokTrack(ids.map((id) => {
    const d = engine.deck(id);
    // Een track die op zijn start op de maat WACHT, klinkt nog niet: geen tel.
    return { id, speelt: !!d.playing && !d.wacht, heeftGrid: !!d.grid, zicht: d.buffer ? klinkt(d.ui.fader, engine.xfadeGain(id)) : 0 };
  }));
}

/**
 * De effectstanden met de puls erbovenop.
 * @returns { fx, flits } — fx is een nieuw object, het origineel blijft staan
 */
export function metPuls(fx, doel, diepte, vorm) {
  const extra = Math.max(0, Math.min(1, diepte)) * vorm;
  if (doel === 'flits') return { fx: { ...fx }, flits: extra };
  if (!(doel in fx)) return { fx: { ...fx }, flits: 0 };
  return { fx: { ...fx, [doel]: Math.min(1, fx[doel] + extra) }, flits: 0 };
}
