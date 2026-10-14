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
  // De labels veranderen terwijl je speelt (audio, de teller van het log). Eerst
  // keek een timer elke seconde: scrollWidth lezen buiten een beeld dwingt Chrome
  // de opmaak van de HELE pagina meteen uit te rekenen, en tijdens het spelen was
  // dat tot ~12 ms waarin geen MIDI-bericht aan de beurt kwam (controller-invoer,
  // 14 okt). Een ResizeObserver meldt het NA de opmaak van een beeld, dus lezen
  // kost dan niets extra, en alleen als een knop in de balk echt van maat verandert.
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => kijk());
    ro.observe(balk);
    for (const kind of balk.children) ro.observe(kind);
    // Een knop die er later bij komt, ook volgen.
    if (typeof MutationObserver === 'function') {
      new MutationObserver((lijst) => {
        for (const m of lijst) for (const k of m.addedNodes) if (k.nodeType === 1) ro.observe(k);
      }).observe(balk, { childList: true });
    }
  } else setInterval(kijk, 1000);
  kijk();
  return { kijk };
}
