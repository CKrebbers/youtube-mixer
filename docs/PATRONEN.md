# Patronen — het contract (STUDIO S4)

*5 oktober 2026 · het contract voor de bouw van "stukken programmeren zodat je dat weer
kunt mixen". Bron van het tijdmodel: Elektronlearn (`src/core/transport.js`,
`src/devices/elektron.js`, 217 tests), Clay's eigen code.*

---

## 1. Wat het is

Een **patroon** is een stuk muziek van 1–64 stappen dat een **instrument op een track**
speelt (docs/INSTRUMENTEN.md). Een track met een instrument heeft vijf **plekken** voor
patronen — de vijf rijen van het APC-grid, zoals clips in Ableton: kolom = track,
rij = plek. Een patroon starten gaat op de maat; het loopt rond tot je het stopt of een
ander patroon op dezelfde track start. Het klinkt door de strip van de track: fader,
EQ, effect, sends en koptelefoon werken dus vanzelf. Dat is het "weer kunnen mixen".

## 2. Het patroon (data)

```js
{
  id: 'p-…',            // vast, nooit hergebruikt
  naam: 'baslijn',
  lengte: 16,           // stappen, 1–64
  deling: 4,            // stappen per tel (4 = zestienden)
  swing: 50,            // 50 = recht, 66,7 = triool-gevoel (zoals Elektronlearn)
  noten: [              // gesorteerd op stap, dan noot
    { stap: 0, noot: 36, snelheid: 0.8, duur: 1, micro: 0 },   // duur in stappen, micro in stappen (−0,5..0,5)
  ],
}
```

Puur JSON; `normaliseerPatroon()` klemt en sorteert (zoals `normaliseerPlan`). Waar het
bewaard wordt: op de server met een versie (409 bij een botsing), zoals de plannen.

## 3. De klok (regel 3)

- **Met een nummer dat klinkt:** de patronen volgen de **maatgever** van de engine
  (tempo en tel van wat je HOORT, `fxKlok()`, het maat-anker van zijn grid). Draai je
  aan de pitch van de maatgever, dan gaan de patronen mee.
- **Zonder:** een eigen tempo (`patterns.tempo`, standaard 120 bpm, tap mogelijk) met
  een vast anker op de audioklok.
- Een timer beslist alleen WANNEER er gekeken wordt (zoals de auto-DJ); WAT er klinkt
  wordt gepland met `t` op de audioklok, ~120 ms vooruit, via `instrument.noteOn(noot,
  snelheid, t)` en `noteOff(noot, t + duur)`.
- Starten valt op het volgende maatbegin (zoals `play.quant`); stoppen ook, of meteen
  met shift. Stoppen of wisselen: `alleUit(t)` op dat moment (geen hangende noten).

## 4. Opnemen

- **Live:** wat je op het keyboard (of de Maschine-pads) speelt terwijl een patroon
  loopt en opnemen aan staat, komt erin, gekwantiseerd op de stap (overdub).
- **Stap voor stap:** een stap aanklikken (scherm) of een pad indrukken (Maschine in
  stapmodus) zet de laatst gespeelde noot op die stap.

## 5. Bediening

- **Actions** (0..1 / boolean, zoals alles): `track.N.pattern.K` (K = 1..5: starten, of
  stoppen als hij al speelt), `track.N.pattern.stop`, `patterns.tempo`, `patterns.record`
  (aan/uit), en voor het scherm wat er verder nodig is. Ze gaan over de bus, dus in het
  handelingenlog en terug te spelen.
- **APC:** een grid-modus PATRONEN (eigen kleur): pad = plek (rij) op de track (kolom);
  lampje uit = geen instrument, donker = leeg, kleur = gevuld, fel = speelt, knipperen =
  wacht op de maat. Scene 1–5 in deze modus = die rij op alle tracks. Alleen regels ERBIJ
  in de standaardmapping (mapping.test).
- **Scherm:** een PATROON-rij voor de focus-track: plekken 1–5, de stappen (klik =
  noot aan/uit met de laatst gespeelde noot), lengte, swing, opnemen.

## 6. Wat (nog) niet

P-locks (een parameter per stap) en een pianorol: pas als je ze mist. Het
instrument-contract heeft daarvoor later een `zetParam(k, v, t)` nodig.
