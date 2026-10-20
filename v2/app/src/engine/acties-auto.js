/**
 * De knoppen van de auto-DJ op de bus (v1: auto.aan, auto.ok, auto.skip, auto.langer, auto.nu;
 * in v2 Nederlandse namen zoals de rest van de bus). De automaat zelf komt van buiten
 * (src/auto/automaat.js, de app maakt hem): de engine importeert hem niet.
 *
 * Lampjes (lees): null = niets te doen (uit, of niets klaar), 0 = kan, 1 = aan/gedaan.
 *   auto.aan        1 = de automaat staat aan
 *   auto.ok         1 = de volgende is bevestigd, 0 = er staat er een klaar
 *   auto.overslaan  0 = er staat er een klaar (tijdens de overgang niet meer)
 *   auto.langer     0 = kan, 1 = al eens langer gemaakt
 *   auto.nu         0 = kan, 1 = al op "nu" gezet
 * Het zijn Clay's knoppen, dus ze staan in het log (met de bron van wie drukte); wat de automaat
 * daarna doet staat er met bron 'auto' achter.
 */
export function definieerAuto(bus, automaat) {
  const klaar = () => (automaat.actief && automaat.volgende && automaat.fase === 'klaar' ? automaat.volgende : null);
  const meta = { beginstand: false };
  bus.defineer({
    id: 'auto.aan', soort: 'trigger', label: 'auto-DJ aan/uit', meta,
    doe: (v) => { if (v) { if (automaat.actief) automaat.uit(); else automaat.aan(); } },
    lees: () => (automaat.actief ? 1 : 0),
  });
  bus.defineer({
    id: 'auto.ok', soort: 'trigger', label: 'auto-DJ: ok, deze', meta,
    doe: (v) => { if (!v) return; if (!automaat.volgende) return { geweigerd: 'er staat niets klaar' }; automaat.ok(); },
    lees: () => (automaat.actief && automaat.volgende ? (automaat.volgende.bevestigd ? 1 : 0) : null),
  });
  bus.defineer({
    id: 'auto.overslaan', soort: 'trigger', label: 'auto-DJ: deze niet', meta,
    doe: (v) => { if (!v) return; if (!klaar()) return { geweigerd: automaat.fase === 'bezig' ? 'de overgang loopt al' : 'er staat niets klaar' }; automaat.overslaan(); },
    lees: () => (klaar() ? 0 : null),
  });
  bus.defineer({
    id: 'auto.langer', soort: 'trigger', label: 'auto-DJ: langer op deze', meta,
    doe: (v) => { if (!v) return; if (!klaar()) return { geweigerd: 'er staat niets klaar' }; automaat.langer(); },
    lees: () => { const x = klaar(); return x ? (x.langer ? 1 : 0) : null; },
  });
  bus.defineer({
    id: 'auto.nu', soort: 'trigger', label: 'auto-DJ: nu (de eerstvolgende 4 maten)', meta,
    doe: (v) => { if (!v) return; if (!klaar()) return { geweigerd: 'er staat niets klaar' }; automaat.nu(); },
    lees: () => { const x = klaar(); return x ? (x.nu ? 1 : 0) : null; },
  });
}
