import { describe, hex, NOISY } from '../control/midi.js';

const MAX_ROWS = 400;      // ringbuffer: ouder dan dit interesseert niemand live
const VISIBLE = 160;       // meer regels tekenen dan dit kost alleen maar tijd

/**
 * Wat raakte dit bericht? Een gekoppelde action, een knop die het profiel wel
 * kent maar die nergens aan hangt, of niets. Bij soft-takeover staat erbij
 * hoe ver de fysieke knop van de softwarewaarde af zit.
 */
function annotation(m) {
  if (m.echo) return { cls: 'echo', tekst: 'echo van onze eigen uitvoer — genegeerd' };
  if (m.hit) {
    const h = m.hit;
    if (!h.taken && h.software != null) {
      return { cls: 'los', tekst: `${h.target} — los (knop ${h.value.toFixed(2)} / software ${h.software.toFixed(2)})` };
    }
    if (!h.taken) return { cls: 'los', tekst: `${h.target} — geen stap` };
    return { cls: 'raak', tekst: `${h.target}` };
  }
  if (m.control) return { cls: 'ctl', tekst: m.control };
  return { cls: '', tekst: '' };
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * Live zicht op de MIDI-bus: wat komt binnen, wat gaat eruit, hoe snel.
 *
 * Tekent op rAF en alleen als er iets veranderd is. Een APC40 die met faders
 * zwaait stuurt makkelijk 300 berichten per seconde; per bericht de DOM
 * aanraken is dan meteen merkbaar.
 */
export class MidiMonitor {
  constructor(hub, root) {
    this.hub = hub;
    this.root = root;
    this.rows = [];            // nieuwste eerst
    this.groups = new Map();   // sig -> { msg, count }
    this.paused = false;
    this.grouped = false;
    this.hideNoise = true;
    this.dirty = true;
    this._rate = 0;
    this._rateCount = 0;
    this._rateAt = performance.now();
    this.extra = null;          // extra tekst voor de statusregel (app.js vult dit)

    this.el = {
      inSel: root.querySelector('.mon-in'),
      outSel: root.querySelector('.mon-out'),
      status: root.querySelector('.mon-status'),
      list: root.querySelector('.mon-rows'),
      connect: root.querySelector('.mon-connect'),
      pause: root.querySelector('.mon-pause'),
      clear: root.querySelector('.mon-clear'),
      noise: root.querySelector('.mon-noise'),
      group: root.querySelector('.mon-group'),
    };

    this.el.inSel.addEventListener('change', () => hub.selectInput(this.el.inSel.value));
    this.el.outSel.addEventListener('change', () => hub.selectOutput(this.el.outSel.value));
    this.el.connect.addEventListener('click', () => hub.init());
    this.el.clear.addEventListener('click', () => { this.rows = []; this.groups.clear(); this.dirty = true; });
    this.el.pause.addEventListener('click', () => {
      this.paused = !this.paused;
      this.el.pause.classList.toggle('on', this.paused);
      this.el.pause.textContent = this.paused ? 'hervat' : 'pauze';
    });
    this.el.noise.addEventListener('click', () => {
      this.hideNoise = !this.hideNoise;
      this.el.noise.classList.toggle('on', !this.hideNoise);
      this.el.noise.textContent = this.hideNoise ? 'clock: uit' : 'clock: aan';
    });
    this.el.group.addEventListener('click', () => {
      this.grouped = !this.grouped;
      this.el.group.classList.toggle('on', this.grouped);
      this.dirty = true;
    });

    hub.on('message', (m) => this.push(m));
    hub.on('tx', (m) => this.push(m));
    hub.on('ports', () => this.renderPorts());
    hub.on('state', () => { this.renderPorts(); this.dirty = true; });
    hub.on('error', (e) => this.note(String(e?.message || e)));

    this.renderPorts();
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  push(m) {
    this._rateCount++;
    if (this.paused) return;
    if (this.hideNoise && NOISY.has(m.type)) return;

    const g = this.groups.get(m.sig);
    if (g) { g.msg = m; g.count++; } else this.groups.set(m.sig, { msg: m, count: 1 });

    this.rows.unshift(m);
    if (this.rows.length > MAX_ROWS) this.rows.length = MAX_ROWS;
    this.dirty = true;
  }

  /** Eigen regel in de log voor dingen die geen MIDI-bericht zijn. */
  note(text) {
    this.rows.unshift({ note: text, time: performance.now() });
    this.dirty = true;
  }

  renderPorts() {
    const p = this.hub.ports();
    const fill = (sel, list, current) => {
      const sig = list.map((x) => x.id + x.state).join('|') + '#' + current;
      if (sel.dataset.sig === sig) return;
      sel.dataset.sig = sig;
      sel.innerHTML = list.length
        ? list.map((x) => `<option value="${esc(x.id)}"${x.id === current ? ' selected' : ''}>${esc(x.name)}</option>`).join('')
        : '<option value="">— geen poorten —</option>';
      sel.value = current || '';
    };
    fill(this.el.inSel, p.inputs, this.hub.inputId);
    fill(this.el.outSel, p.outputs, this.hub.outputId);
  }

  statusLine() {
    const s = this.hub.status();
    if (!s.supported) return `<b class="bad">geen Web MIDI</b> — Chrome nodig`;
    if (s.asking) return `<b class="bad">wacht op toestemming</b> — Chrome vraagt om MIDI-toegang; sta 'm toe (het slotje links in de adresbalk als je 'm weggeklikt hebt)`;
    if (!s.enabled) return `<b class="bad">niet verbonden</b>${s.error ? ' — ' + esc(s.error) : ''} — klik op <b>verbind</b>`;
    const bits = [
      `<b class="good">verbonden</b>`,
      s.sysex ? `sysex <b class="good">ja</b>` : `sysex <b class="bad">nee</b> — LED's blijven beperkt`,
      s.input ? `in: ${esc(s.input.name)}` : `<b class="bad">in: geen</b>`,
      s.output ? `uit: ${esc(s.output.name)}` : `<b class="bad">uit: geen</b>`,
      `rx ${s.rx}`, `tx ${s.tx}`, `${this._rate}/s`,
      ...(s.echoes ? [`<b class="bad">${s.echoes} echo's genegeerd</b>`] : []),
      ...(s.wachtrij ? [`wachtrij ${s.wachtrij}`] : []),
    ];
    if (s.verkeerdePoort) {
      bits.push(`<b class="bad">alle ${s.rxOther} berichten komen van een ándere poort — kies hierboven de juiste invoer</b>`);
    }
    if (this.extra) bits.push(this.extra());
    return bits.join(' &nbsp;·&nbsp; ');
  }

  tick() {
    const now = performance.now();
    if (now - this._rateAt >= 1000) {
      this._rate = Math.round(this._rateCount * 1000 / (now - this._rateAt));
      this._rateCount = 0;
      this._rateAt = now;
      this.dirty = true;
    }
    if (this.dirty && !this.root.classList.contains('hidden')) {
      this.el.status.innerHTML = this.statusLine();
      this.el.list.innerHTML = this.grouped ? this.renderGrouped() : this.renderRows();
      this.dirty = false;
    }
    requestAnimationFrame(this.tick);
  }

  renderRows() {
    return this.rows.slice(0, VISIBLE).map((m) => {
      if (m.note) return `<div class="mon-row note"><span class="dir">·</span><span class="sig"></span><span class="desc">${esc(m.note)}</span></div>`;
      const a = annotation(m);
      return `<div class="mon-row${m.out ? ' out' : ''}${m.selected === false && !m.out ? ' other' : ''}">
        <span class="dir">${m.out ? 'UIT' : 'IN'}</span>
        <span class="sig">${esc(m.sig)}</span>
        <span class="desc">${esc(describe(m))}</span>
        <span class="act ${a.cls}">${esc(a.tekst)}</span>
        <span class="hex">${esc(hex(m.raw.slice(0, 12)))}${m.raw.length > 12 ? ' …' : ''}</span>
        <span class="lag">${m.lag != null ? m.lag.toFixed(1) + ' ms' : ''}</span>
      </div>`;
    }).join('');
  }

  renderGrouped() {
    return [...this.groups.values()]
      .sort((a, b) => b.msg.time - a.msg.time)
      .slice(0, VISIBLE)
      .map(({ msg: m, count }) => {
        const a = annotation(m);
        return `<div class="mon-row${m.out ? ' out' : ''}">
        <span class="dir">${m.out ? 'UIT' : 'IN'}</span>
        <span class="sig">${esc(m.sig)}</span>
        <span class="desc">${esc(describe(m))}</span>
        <span class="act ${a.cls}">${esc(a.tekst)}</span>
        <span class="hex">${esc(hex(m.raw.slice(0, 12)))}</span>
        <span class="lag">${count}&times;</span>
      </div>`; }).join('');
  }
}
