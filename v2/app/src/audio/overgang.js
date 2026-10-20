// Herkomst: v1 youtube-mixer/src/engine/overgang.js @ 6a640ac, ongewijzigd overgenomen. Wijzigingen hier, niet meer in v1.
/**
 * Overgangen op een AudioParam (kruisfades, kill), zo dat Chrome ze netjes
 * afbreekt en ze nooit halverwege beginnen. Gemeten in Chrome 153, offline
 * én realtime (25 september 2026):
 *
 *   1. GEEN setValueCurveAtTime voor iets dat onderbroken kan worden.
 *      cancelAndHoldAtTime MIDDEN in een lopende curve houdt niet vast, maar
 *      speelt het afgekapte stuk opnieuw af vanaf het begin van de curve: een
 *      sprong in één sample (0,15–0,55). Midden in een lineaire helling of
 *      een setTargetAtTime houdt Chrome wel netjes vast. Daarom een beginpunt
 *      plus lineaire hellingen: tussen de punten interpoleert dat lineair,
 *      precies zoals een curve, dus dezelfde vorm. En een helling kan nooit de
 *      NotSupportedError van een overlappende curve geven.
 *   2. Hellingen beginnen pas na `startDrempel`. De renderthread kan een paar
 *      ms voor `ctx.currentTime` uit lopen (headless gemeten tot 7,5 ms), en
 *      Chrome zet een nieuw punt dat voor hem al voorbij is op zijn eigen nu.
 *      Bij een curve schuift dan het geheel op (onhoorbaar); bij hellingen
 *      vallen alle punten die al voorbij zijn samen tot één sprong (3 van de
 *      150 overgangen, tot 0,29). Met de drempel ervoor: 0 van de 150.
 *
 * setTargetAtTime heeft geen van beide problemen: een doel dat te laat
 * binnenkomt begint gewoon vanaf waar de parameter dan is.
 */

/**
 * Hoe dicht bij `nu` iets op de audioklok nog op tijd komt. Wat binnen de
 * uitgangsbuffer valt (of binnen het blok dat de audiothread al rendert)
 * komt te laat. Plus 3 ms marge voor het bericht naar de audiothread.
 */
export const startDrempel = (ctx) => Math.max(ctx.baseLatency ?? 0, 128 / ctx.sampleRate) + 0.003;

/**
 * Een parameter vasthouden waar hij NU is, ook midden in een overgang, zodat
 * wat erna komt daar begint. Kent de browser cancelAndHoldAtTime niet, dan
 * haalt cancelScheduledValues ook een LOPENDE helling weg (zijn tijd is zijn
 * eindpunt) en springt de waarde terug naar het punt ervoor: dan zelf een
 * punt op de huidige waarde.
 */
export function houdVast(param, nu) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(nu);
  else { param.cancelScheduledValues?.(nu); param.setValueAtTime(param.value, nu); }
}

/**
 * Van waar de parameter nu is langs `punten(van)` (op gelijke afstanden,
 * [0] = van) in `duur` seconden, beginnend op `nu + wacht`. Een lopende
 * overgang wordt op `nu` vastgehouden; tot `nu + wacht` blijft hij daar staan.
 *
 * Het beginpunt wordt vastgelegd: een helling begint anders bij het vorige
 * ingeplande punt, en dat kan lang geleden zijn (dan springt hij).
 */
export function zetHellingen(param, punten, nu, duur, wacht = 0) {
  houdVast(param, nu);
  const van = param.value;
  const p = punten(van);
  const t0 = nu + wacht;
  param.setValueAtTime(van, nu);
  if (t0 > nu) param.setValueAtTime(van, t0);
  for (let i = 1; i < p.length; i++) param.linearRampToValueAtTime(p[i], t0 + duur * i / (p.length - 1));
}

/**
 * Een lopende overgang laten DOORLOPEN tot `t0` en vandaar langs `punten`
 * (zonder beginpunt; op gelijke afstanden, de laatste op `t1`). Voor een
 * helling die steeds opnieuw gericht wordt (Deck.glide): zetHellingen houdt
 * vast op `nu` en wacht dan tot `nu + wacht`, en dat is bij elke nieuwe
 * richting een plateau van een paar ms. Hier loopt de oude helling door tot
 * `t0` (dat ligt na startDrempel, dus nog niet gerenderd) en begint de
 * nieuwe precies waar die dan is: geen sprong, geen stilstand.
 *
 * Ook hier alleen lineaire hellingen (geen curve, zie boven). Zonder
 * cancelAndHoldAtTime haalt cancelScheduledValues een lopende helling weg:
 * dan een punt op `van` (de stand op t0 zoals de aanroeper hem uitrekent).
 */
export function zetVervolg(param, punten, t0, t1, van) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t0);
  else { param.cancelScheduledValues?.(t0); param.setValueAtTime(van, t0); }
  const n = punten.length;
  for (let i = 0; i < n; i++) param.linearRampToValueAtTime(punten[i], t0 + (t1 - t0) * (i + 1) / n);
}
