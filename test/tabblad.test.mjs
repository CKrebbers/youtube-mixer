// Twee VARVE-tabbladen: alleen het eerste luistert naar de APC. De Web Lock
// wordt hier nagebouwd, net zo streng als de echte: ifAvailable geeft null
// als hij bezet is, een gewone request wacht tot de houder weg is.
const { bewaakTabblad } = await import('../src/ui/tabblad.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const tik = () => new Promise((r) => setTimeout(r, 0));

/** Eén browser: gedeelde locks. `sluit(tabblad)` laat zijn locks los, zoals een gesloten tabblad. */
function browser() {
  const houder = new Map();   // naam -> tabblad-id
  const rij = new Map();      // naam -> [{ id, cb, klaar }]
  const geef = (naam, id, cb) => {
    houder.set(naam, id);
    return Promise.resolve(cb({ name: naam }));
  };
  return {
    voor(id) {
      return {
        request(naam, opts, cb) {
          if (typeof opts === 'function') { cb = opts; opts = {}; }
          if (!houder.has(naam)) return geef(naam, id, cb);
          if (opts.ifAvailable) return Promise.resolve(cb(null));
          return new Promise((klaar) => {
            if (!rij.has(naam)) rij.set(naam, []);
            rij.get(naam).push({ id, cb, klaar });
          });
        },
      };
    },
    sluit(id) {
      for (const [naam, h] of houder) {
        if (h !== id) continue;
        houder.delete(naam);
        const volgende = rij.get(naam)?.shift();
        if (volgende) geef(naam, volgende.id, volgende.cb).then(volgende.klaar);
      }
    },
  };
}

const b = browser();
const een = bewaakTabblad(b.voor(1));
const twee = bewaakTabblad(b.voor(2));
let tweedeMelding = 0, tweeWordtEerste = 0;
twee.on('tweede', () => tweedeMelding++);
twee.on('eerste', () => tweeWordtEerste++);
await tik();
ok('het eerste tabblad krijgt de lock', een.eerste && een.beslist);
ok('het tweede niet, en weet dat', !twee.eerste && twee.beslist && tweedeMelding === 1);
b.sluit(1);
await tik();
ok('eerste dicht: het tweede neemt het over', twee.eerste && tweeWordtEerste === 1);

const zonder = bewaakTabblad(undefined);
ok('vóór de beslissing telt niemand als eerste', !zonder.eerste);
await tik();
ok('zonder navigator.locks: elk tabblad is het eerste (zoals vroeger)', zonder.eerste);

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\ntabblad: alles groen');
