// De meldingen onderaan (src/ui/meldingen.js) met een nagebouwd document:
// een melding met een SLEUTEL is er één die meegroeit of verandert (dezelfde
// plek, nieuwe tekst en soort), zonder sleutel blijft alles zoals het was
// (dezelfde tekst stapelt niet, een fout krijgt een kruisje, info verdwijnt).
// Draai met: node test/meldingen.test.mjs
const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

/** Net genoeg DOM voor meldingen.js: kinderen, klassen, dataset, tekstknopen, één klik-luisteraar. */
class Klassen {
  constructor(el) { this.el = el; }
  get _l() { return this.el.className.split(/\s+/).filter(Boolean); }
  contains(k) { return this._l.includes(k); }
  add(...ks) { const l = this._l; for (const k of ks) if (!l.includes(k)) l.push(k); this.el.className = l.join(' '); }
  remove(...ks) { this.el.className = this._l.filter((k) => !ks.includes(k)).join(' '); }
}
class Knoop {
  constructor(tag) { this.tag = tag; this.className = ''; this.dataset = {}; this.kinderen = []; this.ouder = null; this.luister = {}; this.classList = new Klassen(this); }
  get children() { return this.kinderen.filter((k) => k instanceof Knoop); }
  get firstChild() { return this.kinderen[0] ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get textContent() { return this.kinderen.map((k) => k.textContent).join(''); }
  set textContent(t) { this.kinderen = [new Tekst(t)]; }
  append(...ks) { for (const k of ks) { k.ouder = this; this.kinderen.push(k); } }
  remove() { if (this.ouder) this.ouder.kinderen = this.ouder.kinderen.filter((k) => k !== this); this.ouder = null; }
  querySelector(sel) {
    const k = sel.replace(/^\./, '');
    for (const c of this.children) { if (c.classList.contains(k)) return c; const d = c.querySelector(sel); if (d) return d; }
    return null;
  }
  addEventListener(soort, f) { this.luister[soort] = f; }
}
class Tekst { constructor(t) { this.textContent = t; } }
const strook = new Knoop('div');
globalThis.document = {
  getElementById: () => strook,
  createElement: (tag) => new Knoop(tag),
  createTextNode: (t) => new Tekst(t),
};
const stil = console.warn;
console.warn = () => {};

const { meld, wisMelding } = await import('../src/ui/meldingen.js');
const zichtbaar = () => strook.children.filter((m) => !m.classList.contains('weg'));
const tekst = (m) => m.firstChild.textContent;

console.log('\nzonder sleutel: zoals het was');
{
  meld('stream hapert', 'fout');
  meld('stream hapert', 'fout');
  ok('dezelfde fout stapelt niet', zichtbaar().length === 1);
  ok('een fout heeft een kruisje', !!zichtbaar()[0].querySelector('.melding-x'));
  zichtbaar()[0].querySelector('.melding-x').luister.click();
  ok('het kruisje haalt hem weg', zichtbaar().length === 0);
}

console.log('\nmet een sleutel: één melding die verandert');
{
  const a = meld('opname: server antwoordt niet, 2 s in de wacht', 'fout', 5000, { sleutel: 'opname-wacht' });
  const b = meld('opname: server antwoordt niet, 3 s in de wacht', 'fout', 5000, { sleutel: 'opname-wacht' });
  ok('dezelfde sleutel = hetzelfde element', a === b && zichtbaar().length === 1);
  ok('de tekst is de nieuwe', tekst(b) === 'opname: server antwoordt niet, 3 s in de wacht');
  ok('nog steeds één kruisje', b.children.filter((k) => k.classList.contains('melding-x')).length === 1);
  const c = meld('opname: weer goed', 'info', 4000, { sleutel: 'opname-wacht' });
  ok('van fout naar info: zelfde plek, soort info', c === a && c.classList.contains('info') && !c.classList.contains('fout'));
  ok('info heeft geen kruisje meer', !c.querySelector('.melding-x'));
  ok('info verdwijnt vanzelf (timer gezet)', c._weg !== undefined);
  meld('iets anders', 'info');
  ok('een andere melding staat ernaast', zichtbaar().length === 2);
  wisMelding('opname-wacht');
  ok('wisMelding haalt alleen die weg', zichtbaar().length === 1 && tekst(zichtbaar()[0]) === 'iets anders');
  wisMelding('bestaat-niet');
  ok('wisMelding van een sleutel die er niet is: niets', zichtbaar().length === 1);
}

console.warn = stil;
console.log(fails.length ? `\n${fails.length} FAIL` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
