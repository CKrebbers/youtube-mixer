/**
 * Het tabblad "Track": wat bij de track met FOCUS hoort en niet in de kolom past. Het paneel
 * bouwt zich opnieuw op bij een focuswissel of als er iets anders op de track komt (een
 * instrument, een rack); tussendoor leest het elke frame de bus (zoals alle knoppen).
 *
 * Secties registreren zich: `paneel.sectie({ naam, maak(n, el) -> { teken() } | null })`.
 * Zo komen effecten, instrument en patronen elk met hun eigen bestand, en blijft dit het
 * raamwerk.
 */
export function opzetTrackPaneel({ engine, paneel }) {
  const secties = [];
  let actief = [];
  let sleutel = '';

  function bouw() {
    const n = engine.focus, t = engine.track(n);
    paneel.replaceChildren();
    actief = [];
    for (const s of secties) {
      const el = document.createElement('section');
      el.className = `tp-sectie tp-${s.naam}`;
      const ding = s.maak(n, el, t);
      if (!ding) continue;
      paneel.append(el);
      actief.push(ding);
    }
    if (!actief.length) paneel.innerHTML = `<p class="leeg-paneel">Track ${n} heeft niets dat hier bediend wordt (laad een nummer of zet er een instrument op).</p>`;
  }

  /** Wat het paneel bepaalt: als dit verandert, opnieuw bouwen. */
  const nuSleutel = () => {
    const t = engine.track(engine.focus);
    return `${engine.focus}|${t.instrument?.soort ?? ''}|${t.nummer?.id ?? ''}|${secties.map((s) => s.sleutel?.(t) ?? '').join('|')}`;
  };

  return {
    sectie(s) { secties.push(s); sleutel = ''; },
    teken() {
      const k = nuSleutel();
      if (k !== sleutel) { sleutel = k; bouw(); }
      if (!paneel.hidden) for (const a of actief) a.teken?.();
    },
  };
}

/** De sectie Instrument: kiezen (geen of een soort), de acht knoppen met hun naam en eenheid, paniek. */
export function instrumentSectie({ engine, bus, maakKnop }) {
  return {
    naam: 'instrument',
    maak(n, el, t) {
      const kop = document.createElement('div');
      kop.className = 'tp-kop';
      kop.innerHTML = '<strong>INSTRUMENT</strong>';
      const kies = (soort) => engine.zetInstrument(n, soort);
      for (const d of [{ soort: null, naam: 'geen' }, ...engine.instrumenten]) {
        const b = document.createElement('button');
        b.textContent = d.naam;
        b.classList.toggle('aan', (t.instrument?.soort ?? null) === d.soort);
        b.onclick = () => {
          if (d.soort && t.speelt && engine.hoorbaar(n) && !b._tweede) { b._tweede = true; engine.meld(`track ${n} speelt: klik nog eens om het nummer te vervangen`, 'info', `inst:${n}`); setTimeout(() => { b._tweede = false; }, 3000); return; }
          kies(d.soort);
        };
        kop.append(b);
      }
      el.append(kop);
      const inst = t.instrument?.inst;
      if (!inst) return { teken() {} };
      const knoppen = document.createElement('div');
      knoppen.className = 'knoppen tp-knoppen';
      const lijst = [];
      (inst.params ?? []).slice(0, 8).forEach((p, i) => {
        const k = document.createElement('div');
        k.className = 'knop';
        k.dataset.waarde = `track.${n}.inst.knop.${i + 1}`;
        k.dataset.label = p.label ?? p.id ?? `knop ${i + 1}`;
        knoppen.append(k);
        lijst.push(maakKnop(k, bus, { tekst: p.eenheid ? (v) => p.eenheid(v) : null }));
      });
      const stil = document.createElement('button');
      stil.textContent = 'STIL'; stil.title = 'alle noten meteen uit (paniek)';
      stil.dataset.actie = `track.${n}.inst.stil`;
      el.append(knoppen, stil);
      return { teken() { for (const k of lijst) k.teken(); } };
    },
  };
}

/**
 * De sectie Effect: het rack van de focus-track (naam, ‹ aan ›) met zijn acht knoppen; de naam
 * van elke knop komt uit het rack (een plek die het rack niet heeft leest null en staat grijs).
 * MIX, ECHO en GALM staan in de kolom zelf.
 */
export function effectSectie({ engine, bus, maakKnop }) {
  return {
    naam: 'effect',
    sleutel: (t) => t.strip?.fx?.rackNaam ?? '',
    maak(n, el, t) {
      const fx = t.strip?.fx;
      if (!fx) return null;
      const kop = document.createElement('div');
      kop.className = 'tp-kop';
      kop.innerHTML = `<strong>EFFECT</strong><button data-actie="track.${n}.fx.vorig" title="vorig rack">‹</button><button class="b-fx" data-actie="track.${n}.fx.aan" data-lamp title="effect aan/uit">${engine.fx.rackNaam(n) ?? '—'}</button><button data-actie="track.${n}.fx.volgend" title="volgend rack">›</button>`;
      const knoppen = document.createElement('div');
      knoppen.className = 'knoppen tp-knoppen';
      const lijst = [];
      for (let k = 1; k <= 8; k++) {
        const d = document.createElement('div');
        d.className = 'knop';
        d.dataset.waarde = `track.${n}.fx.knop.${k}`;
        d.dataset.label = fx.plekNaam?.(k) ?? `${k}`;
        knoppen.append(d);
        lijst.push(maakKnop(d, bus));
      }
      el.append(kop, knoppen);
      const b = kop.querySelector('.b-fx');
      return {
        teken() {
          for (const k of lijst) k.teken();
          const s = bus.lees(`track.${n}.fx.aan`);
          b.classList.toggle('aan', s === 1);
        },
      };
    },
  };
}
