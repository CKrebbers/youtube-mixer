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

/**
 * De sectie Stems: alleen als het nummer op de focus-track met stems speelt (v1 STEMS-rij). Per stem
 * een niveauknop met KILL (klik = weg/terug; shift op een controller: zolang je drukt). Bij vier
 * stems ook REST (drums + bas + overig samen).
 */
export function stemsSectie({ bus, maakKnop }) {
  const LABEL = { vocals: 'ZANG', inst: 'REST', drums: 'DRUMS', bass: 'BAS', other: 'OVERIG' };
  return {
    naam: 'stems',
    sleutel: (t) => t.stems?.namen.join(',') ?? '',
    maak(n, el, t) {
      if (!t.stems) return null;
      const namen = t.stems.namen.length === 4 ? ['vocals', 'drums', 'bass', 'other', 'inst'] : ['vocals', 'inst'];
      el.innerHTML = '<div class="tp-kop"><strong>STEMS</strong></div>';
      const knoppen = document.createElement('div');
      knoppen.className = 'knoppen tp-knoppen';
      const lijst = namen.map((s) => {
        const k = document.createElement('div');
        k.className = 'knop';
        k.dataset.waarde = `track.${n}.stem.${s}`;
        k.dataset.label = LABEL[s];
        k.dataset.kill = `track.${n}.stem.${s}.kill`;
        knoppen.append(k);
        return maakKnop(k, bus, { tekst: (v) => `${Math.round(v * 100)}%` });
      });
      el.append(knoppen);
      return { teken() { for (const k of lijst) k.teken(); } };
    },
  };
}

/** Een MIDI-noot als naam (60 = C3, zoals Logic en de Maschine). */
const NOOT = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const nootNaam = (n) => `${NOOT[n % 12]}${Math.floor(n / 12) - 2}`;

/**
 * De sectie Patroon (plak 5): alleen met een instrument op de track. Vijf plekken (klik = kiezen;
 * met noten: starten/wisselen/stoppen op de "1"), zestien stappen van de gekozen plek (klik = aan/uit
 * met de laatst gespeelde noot: speel eerst een noot of pad, dan de stappen), lengte en pagina, en de
 * afspeelkop. Alles via de bus (track.{n}.patroon.*), dus ook vanaf een controller.
 */
export function patroonSectie({ engine, bus }) {
  return {
    naam: 'patroon',
    maak(n, el, t) {
      if (!t.instrument) return null;
      const P = engine.patronen;
      const knop = (actie, tekst, titel = '') => `<button data-actie="${actie}" title="${titel}">${tekst}</button>`;
      el.innerHTML = `<div class="tp-kop"><strong>PATROON</strong>
        ${[1, 2, 3, 4, 5].map((k) => knop(`track.${n}.patroon.${k}`, k, `plek ${k}: kiezen; met noten starten of wisselen op de 1`)).join('')}
        ${knop('patronen.stop', '■', 'alle patronen stoppen op de 1')}
        <span class="tp-pat-noot" title="de noot die een stap schrijft: de laatst gespeelde"></span>
        ${knop(`track.${n}.patroon.lengte.korter`, '−', 'korter')}<span class="tp-pat-lengte"></span>${knop(`track.${n}.patroon.lengte.langer`, '+', 'langer')}
        ${knop(`track.${n}.patroon.pagina.vorige`, '◀', 'vorige 16 stappen')}<span class="tp-pat-pagina"></span>${knop(`track.${n}.patroon.pagina.volgende`, '▶', 'volgende 16 stappen')}
        ${knop(`track.${n}.patroon.wis`, 'wis', 'deze plek leegmaken')}</div>
        <div class="tp-stappen">${Array.from({ length: 16 }, (_, s) => knop(`track.${n}.patroon.stap.${s + 1}`, '', `stap ${s + 1}`)).join('')}</div>`;
      const plekken = [...el.querySelectorAll('.tp-kop button')].filter((b) => /patroon\.\d$/.test(b.dataset.actie));
      const stappen = [...el.querySelectorAll('.tp-stappen button')];
      const nootEl = el.querySelector('.tp-pat-noot'), lengteEl = el.querySelector('.tp-pat-lengte'), paginaEl = el.querySelector('.tp-pat-pagina');
      const stand = (v) => (v === null || v === undefined ? 'uit' : v >= 1 ? 'aan' : v > 0 ? 'gevuld' : 'leeg');
      return {
        teken() {
          plekken.forEach((b, i) => {
            const s = stand(bus.lees(b.dataset.actie));
            if (b.dataset.stand !== s) b.dataset.stand = s;
            b.classList.toggle('gekozen', P.gekozen[n] === i + 1);
          });
          const kop = P.stapNu(n), pag = P.pagina[n];
          stappen.forEach((b, s) => {
            const st = stand(bus.lees(b.dataset.actie));
            if (b.dataset.stand !== st) { b.dataset.stand = st; b.disabled = st === 'uit'; }
            b.classList.toggle('kop', kop !== null && kop === pag * 16 + s && P.stand(n).speelt === P.gekozen[n]);
            b.classList.toggle('tel', s % 4 === 0);
          });
          const p = P.bewerkt(n);
          const nt = `noot ${nootNaam(P.stapNoot(n))}`, lt = `${p?.lengte ?? 16}`, pt = `${pag + 1}/${Math.max(1, Math.ceil((p?.lengte ?? 16) / 16))}`;
          if (nootEl.textContent !== nt) nootEl.textContent = nt;
          if (lengteEl.textContent !== lt) lengteEl.textContent = lt;
          if (paginaEl.textContent !== pt) paginaEl.textContent = pt;
        },
      };
    },
  };
}
