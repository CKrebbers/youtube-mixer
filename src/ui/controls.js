import { invoke } from '../control/actions.js';
import { clamp } from '../lib/emitter.js';

/**
 * Knoppen en faders sturen GEEN engine-methodes aan. Ze sturen actions, net als
 * de APC40 straks. Zo blijft er maar één weg naar binnen.
 */
export class Knob {
  constructor(el) {
    this.el = el;
    this.action = el.dataset.action;
    this.value = parseFloat(el.dataset.value ?? '0.5');
    this.bipolar = el.dataset.bipolar === 'true';
    el.classList.add('knob');
    el.innerHTML = `<div class="knob-dial"><div class="knob-ind"></div></div><span class="knob-label">${el.dataset.label ?? ''}</span>`;
    this.dial = el.querySelector('.knob-dial');
    this.ind = el.querySelector('.knob-ind');
    this.render();

    // dragging staat op de instantie: de renderloop leest hem uit, zodat hij
    // een knop die je vasthebt niet onder je vingers vandaan bijstelt.
    this.dragging = false;
    let startY = 0, startV = 0;
    const onMove = (e) => {
      if (!this.dragging) return;
      const dy = startY - e.clientY;
      const scale = e.shiftKey ? 600 : 160;   // shift = fijnafstelling
      this.set(startV + dy / scale);
    };
    const onUp = () => { this.dragging = false; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true; startY = e.clientY; startV = this.value;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      e.preventDefault();
    });
    el.addEventListener('dblclick', () => this.set(this.bipolar ? 0.5 : parseFloat(el.dataset.default ?? '0.5')));
    el.addEventListener('wheel', (e) => { this.set(this.value - Math.sign(e.deltaY) * 0.02); e.preventDefault(); }, { passive: false });
  }
  set(v, silent = false) {
    this.value = clamp(v);
    this.render();
    if (!silent && this.action) invoke(this.action, this.value);
  }
  render() {
    const deg = -140 + this.value * 280;
    this.ind.style.transform = `rotate(${deg}deg)`;
    this.dial.classList.toggle('centered', this.bipolar && Math.abs(this.value - 0.5) < 0.01);
  }
}

export class Fader {
  constructor(el) {
    this.el = el;
    this.action = el.dataset.action;
    this.input = el;
    el.addEventListener('input', () => invoke(this.action, parseFloat(el.value)));
  }
  set(v) { this.el.value = v; }
}

export function bindButtons(root) {
  root.querySelectorAll('[data-action][data-kind="button"]').forEach((btn) => {
    const id = btn.dataset.action;
    const alt = btn.dataset.actionShift;
    btn.addEventListener('pointerdown', (e) => { invoke(e.shiftKey && alt ? alt : id, true); });
    btn.addEventListener('pointerup', () => invoke(id, false));
    btn.addEventListener('pointerleave', () => invoke(id, false));
  });
}
