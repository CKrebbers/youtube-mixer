/**
 * Soorten: in welke groep een action valt, voor de kleur op de kaarten van de
 * APC (apc.html) en de Maschine (maschine.html). De kleuren zelf staan in
 * styles.css (`.s-<soort>`). Puur: geen DOM, zodat tests het kunnen lezen.
 *
 * De volgorde telt: de eerste die past wint.
 */
export const SOORTEN = [
  ['mapje', 'modus kiezen', /^layer\./],
  ['hotcue', 'hotcues', /\.hotcue\./],
  ['loop', 'loops', /\.(beatloop\.[\d.]+|loop\.\w+)$/],
  ['sampler', 'sampler', /^sampler\./],
  ['video', 'video', /^video\./],
  // De Stroommachine op de pc (docs/BEELD.md): het mapje beeld. Anders vielen
  // macro's en regie in de grootste groep (transport).
  ['beeld', 'beeld (Stroommachine)', /^beeld\./],
  ['opname', 'opname', /^record\./],
  // Bladeren en laden uit de library (docs/MASCHINE.md §5e). Vóór transport.
  ['library', 'library', /^library\.|\.load\.selected$/],
  ['auto', 'auto-DJ', /^auto\./],
  // Vóór klank, fx en mixer: track.1.stem.vocals.filter eindigt op .filter, .send.a op een send.
  ['stems', 'stems', /\.stem\./],
  // Patronen (docs/PATRONEN.md): de modus patronen. Vóór "transport": anders viel
  // een plek in de grootste groep.
  ['patroon', 'patronen', /\.pattern(\.|$)|^patterns\./],
  // Secties (docs/SECTIES.md): de modus secties (pad = sectie, shift = als loop).
  ['sectie', 'secties', /\.section\./],
  // Vóór "mixer": track.1.kill.high eindigt op .high, en dat is geen EQ-knop.
  ['klank', 'kill & rem', /\.(kill\.(low|mid|high)(\.hold)?|brake(\.time)?)$/],
  // Een instrument op de track (docs/INSTRUMENTEN.md §6): het mapje inst.
  // (Niet `track.N.stem.inst`: dat is de stem "rest".)
  ['instrument', 'instrument', /^track\.[^.]+\.inst(\.|$)/],
  ['fx', 'effecten & sends', /\.(fx\.\w+|fx\.knob\.\d|send\.[ab]|rack\.\w+)$|^send\.[ab]\./],
  ['mixer', 'mixer', /\.(fader|filter|trim|high|mid|low|xfade\.\w+)$|^mixer\./],
  ['transport', 'transport & focus', /\.(play|play\.quant|cue|sync|tap|focus|pitch|bend\.\w+|nudge\.\w+|pitch\.range|beatjump\.\w+)$|^focus\.|^window\.|^transport\./],
];

/** De soort van een action ('vrij' zonder action; wat nergens past is transport). */
export const soortVan = (action) => (action ? (SOORTEN.find(([, , re]) => re.test(action))?.[0] ?? 'transport') : 'vrij');

/** De naam van een soort voor de legenda. */
export const soortNaam = (id) => (id === 'vrij' ? 'vrij (doet niets)' : SOORTEN.find(([s]) => s === id)?.[1] ?? id);
