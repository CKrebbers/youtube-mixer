/**
 * De speeltuin: wat een lege knop allemaal KAN doen, in families. Alleen de motor (bus-acties), geen
 * indeling, geen ruimtes, geen opstelling: Clay kiest per knop zelf (30 okt: "het hele idee voelt
 * verkeerd", opnieuw beginnen met lege toestellen).
 *
 * Een voorstel: { id, naam, fam, max?, terug? }
 *   id     bus-actie; {n} = de track (kolom van de knop, anders de track met focus), {k} = een nummer
 *          van de knop zelf (pad 5 -> 5), rondlopend tot `max`
 *   naam   kort, voor het Maschine-scherm (10 tekens per kolom, liefst minder)
 *   terug  alleen voor een draaiknop als trigger: de actie voor neer (tempo +/−)
 *   pad    alleen op een pad of knop (een drum of noot op een fader zegt niets)
 */

export const FAMILIES = Object.freeze({
  mix: { naam: 'mix', kleur: 'wit' },
  spelen: { naam: 'spelen', kleur: 'groen' },
  gebaar: { naam: 'gebaar', kleur: 'oranje' },
  klank: { naam: 'klank', kleur: 'blauw' },
  ritme: { naam: 'ritme', kleur: 'geel' },
  noten: { naam: 'noten', kleur: 'cyaan' },
  beeld: { naam: 'beeld', kleur: 'magenta' },
});

export const VOORSTELLEN = Object.freeze([
  // mix
  { id: 'track.{n}.fader', naam: 'volume', fam: 'mix' },
  { id: 'track.{n}.filter', naam: 'filter', fam: 'mix' },
  { id: 'track.{n}.laag', naam: 'laag', fam: 'mix' },
  { id: 'track.{n}.mid', naam: 'mid', fam: 'mix' },
  { id: 'track.{n}.hoog', naam: 'hoog', fam: 'mix' },
  { id: 'mixer.xfader', naam: 'crossfade', fam: 'mix' },
  { id: 'mixer.master', naam: 'master', fam: 'mix' },
  { id: 'track.{n}.kill.laag', naam: 'bas weg', fam: 'mix' },
  { id: 'track.{n}.kill.hoog', naam: 'hoog weg', fam: 'mix' },
  // spelen
  { id: 'track.{n}.play', naam: 'play', fam: 'spelen' },
  { id: 'track.{n}.play.quant', naam: 'start op 1', fam: 'spelen' },
  { id: 'track.{n}.hotcue.{k}', naam: 'hotcue {k}', fam: 'spelen', max: 8 },
  { id: 'track.{n}.loop', naam: 'lus', fam: 'spelen' },
  { id: 'track.{n}.loop.halveer', naam: 'lus /2', fam: 'spelen' },
  { id: 'track.{n}.loop.verdubbel', naam: 'lus x2', fam: 'spelen' },
  { id: 'track.{n}.beatjump.voor', naam: 'sprong', fam: 'spelen', terug: 'track.{n}.beatjump.terug' },
  { id: 'track.{n}.cue', naam: 'cue', fam: 'spelen' },
  { id: 'track.{n}.sync', naam: 'sync', fam: 'spelen' },
  { id: 'track.{n}.pitch', naam: 'pitch', fam: 'spelen' },
  { id: 'track.{n}.seek', naam: 'plek', fam: 'spelen' },
  // gebaren: vasthouden = effect, druk (Maschine) = diepte
  { id: 'gebaar.stotter', naam: 'stotter', fam: 'gebaar' },
  { id: 'gebaar.echo', naam: 'echo-worp', fam: 'gebaar' },
  { id: 'gebaar.galm', naam: 'galm-worp', fam: 'gebaar' },
  { id: 'gebaar.korrel', naam: 'korrels', fam: 'gebaar' },
  { id: 'gebaar.dof', naam: 'dof', fam: 'gebaar' },
  { id: 'gebaar.dun', naam: 'dun', fam: 'gebaar' },
  { id: 'gebaar.achteruit', naam: 'achteruit', fam: 'gebaar' },
  { id: 'gebaar.bevries', naam: 'bevriezen', fam: 'gebaar' },
  { id: 'gebaar.breuk', naam: 'breuk', fam: 'gebaar' },
  { id: 'gebaar.stilte', naam: 'stilte', fam: 'gebaar' },
  { id: 'gebaar.opbouw', naam: 'opbouw', fam: 'gebaar' },
  { id: 'gebaar.wegspoelen', naam: 'wegspoelen', fam: 'gebaar' },
  { id: 'gebaar.oplossen', naam: 'oplossen', fam: 'gebaar' },
  { id: 'gebaar.band', naam: 'band', fam: 'gebaar' },
  { id: 'gebaar.echovast', naam: 'echo vast', fam: 'gebaar' },
  { id: 'gebaar.galmvast', naam: 'galm vast', fam: 'gebaar' },
  { id: 'gebaar.bas', naam: 'bas eruit', fam: 'gebaar' },
  { id: 'gebaar.weg', naam: 'wegzakken', fam: 'gebaar' },
  { id: 'gebaar.alles.korrel', naam: 'alles korrel', fam: 'gebaar' },
  { id: 'gebaar.alles.galm', naam: 'alles galm', fam: 'gebaar' },
  // klank
  { id: 'track.{n}.send.a', naam: 'echo', fam: 'klank' },
  { id: 'track.{n}.send.b', naam: 'galm', fam: 'klank' },
  { id: 'track.{n}.fx.aan', naam: 'effect aan', fam: 'klank' },
  { id: 'track.{n}.fx.mix', naam: 'effect nat', fam: 'klank' },
  { id: 'track.{n}.fx.knop.{k}', naam: 'fx-knop {k}', fam: 'klank', max: 8 },
  { id: 'track.{n}.fx.volgend', naam: 'ander fx', fam: 'klank', terug: 'track.{n}.fx.vorig' },
  { id: 'track.{n}.stem.drums.kill.hold', naam: 'drums weg', fam: 'klank' },
  { id: 'track.{n}.stem.vocals.kill.hold', naam: 'zang weg', fam: 'klank' },
  { id: 'track.{n}.stem.bass.kill.hold', naam: 'stem bas weg', fam: 'klank' },
  { id: 'track.{n}.stem.drums', naam: 'drums', fam: 'klank' },
  { id: 'track.{n}.stem.vocals', naam: 'zang', fam: 'klank' },
  // ritme
  { id: 'speel.drum.{k}', naam: 'drum {k}', fam: 'ritme', max: 16, pad: true },
  { id: 'sampler.{k}', naam: 'sample {k}', fam: 'ritme', max: 8 },
  { id: 'korrel.vang', naam: 'vang', fam: 'ritme' },
  { id: 'korrel.veld.{k}', naam: 'korrel {k}', fam: 'ritme', max: 16, pad: true },
  { id: 'klok.tap', naam: 'tap', fam: 'ritme' },
  { id: 'klok.tempo', naam: 'tempo', fam: 'ritme' },
  { id: 'klok.tempo.op', naam: 'tempo ±', fam: 'ritme', terug: 'klok.tempo.neer' },
  { id: 'track.{n}.nudge.voor', naam: 'duw', fam: 'ritme', terug: 'track.{n}.nudge.terug' },
  { id: 'track.{n}.patroon.{k}', naam: 'patroon {k}', fam: 'ritme', max: 5 },
  // noten
  { id: 'speel.noot.{k}', naam: 'noot {k}', fam: 'noten', max: 16, pad: true },
  { id: 'track.{n}.inst.knop.{k}', naam: 'synth {k}', fam: 'noten', max: 8 },
  { id: 'track.{n}.inst', naam: 'instrument', fam: 'noten' },
  // beeld (staan alleen op de bus als het beeld er is)
  { id: 'gebaar.flits', naam: 'flits', fam: 'beeld' },
  { id: 'gebaar.zwart', naam: 'zwart', fam: 'beeld' },
  { id: 'video.fx.pixel', naam: 'pixels', fam: 'beeld' },
  { id: 'video.fx.mirror', naam: 'spiegel', fam: 'beeld' },
  { id: 'video.fx.rgb', naam: 'rgb', fam: 'beeld' },
  { id: 'video.fx.color', naam: 'kleur', fam: 'beeld' },
  { id: 'video.fx.trails', naam: 'sporen', fam: 'beeld' },
  { id: 'video.fx.grain', naam: 'korrel', fam: 'beeld' },
]);

/** Welke families eerst, per soort knop: wat je hand bij zo'n knop het eerst verwacht. */
export const VOLGORDE = Object.freeze({
  fader: ['mix', 'klank', 'gebaar', 'noten', 'beeld', 'ritme', 'spelen'],
  draai: ['klank', 'mix', 'noten', 'gebaar', 'spelen', 'ritme', 'beeld'],
  rel: ['klank', 'ritme', 'spelen', 'mix', 'noten', 'gebaar', 'beeld'],
  knop: ['spelen', 'gebaar', 'ritme', 'klank', 'mix', 'noten', 'beeld'],
  pad: ['gebaar', 'ritme', 'noten', 'spelen', 'klank', 'beeld', 'mix'],
});

/** Knoppen met een vanzelfsprekende eerste keuze (de crossfader is eerst de crossfader). */
export const EERST = Object.freeze({ xf: 'mixer.xfader', master: 'mixer.master', tempo: 'klok.tempo', tap: 'klok.tap' });
