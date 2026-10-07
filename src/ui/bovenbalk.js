/**
 * De bovenbalk past op een laptop (1440 px) in rust, maar niet tijdens het
 * spelen: "audio starten" wordt "audio · 48 kHz · 6 ms" en het log loopt
 * ("◉ log 0:02 · 12 kB"). Dan SCROLLT het rechterdeel opzij in plaats van dat
 * rechts knoppen wegvallen (Clay, 7 okt; de CSS bij `.topbar-right` in
 * styles.css). Hier: een vervaging aan de kant waar nog meer staat (`meer`,
 * `minder`), en het scrollwiel van een muis schuift opzij (een trackpad kan
 * dat al).
 */

/** Zoveel px speling voor afronding. */
export const SPELING = 1;

/** Staat er links of rechts nog iets buiten beeld? Puur. */
export function randen({ scrollLeft, clientWidth, scrollWidth }) {
  return { minder: scrollLeft > SPELING, meer: scrollLeft + clientWidth < scrollWidth - SPELING };
}

export function opzetBovenbalk(balk = document.querySelector('.topbar-right')) {
  if (!balk) return null;
  const kijk = () => {
    const r = randen(balk);
    balk.classList.toggle('meer', r.meer);
    balk.classList.toggle('minder', r.minder);
  };
  balk.addEventListener('scroll', kijk, { passive: true });
  balk.addEventListener('wheel', (e) => {
    if (balk.scrollWidth <= balk.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    balk.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('resize', kijk);
  // De labels veranderen terwijl je speelt (audio, de teller van het log): elke seconde opnieuw kijken.
  setInterval(kijk, 1000);
  kijk();
  return { kijk };
}
