"""
De tellenzoeker van Varve (docs/BEATGRID.md §11): media/<id>/audio.wav erin,
tellen.json eruit — waar de tellen en de downbeats (de "1") vallen, volgens
Beat This! (CPJKU, MIT; een neuraal netwerk dat tellen hoort zoals een mens).
Het grid zelf maakt de server daarna uit deze tellen (src/engine/tellen.js).

  <python> server/tellen/tellen.py --in <audio.wav> --uit <tellen.json>
           [--apparaat auto|mps|cuda|cpu] [--model <final0.ckpt>] [--threads N]
  <python> server/tellen/tellen.py --controle     (staat alles klaar? JSON op stdout)

Stdout: regels `voortgang <0..1>` en als laatste `klaar`. Fouten naar stderr
(de laatste regel is de reden), exitcode ≠ 0. SIGINT (of SIGTERM) = netjes
stoppen: geen half bestand, exit 130. Regels op stderr die met `info:`
beginnen zijn meetwaarden, geen fout. Zelfde afspraken als stems/splits.py.

tellen.json: { versie, beats: [s], downbeats: [s], fps, verfijnd, model, apparaat, sec }

Waarom zo:

- IN STUKKEN van 4 minuten met 5 s context aan weerskanten: Beat This! houdt
  het spectrogram en de aandacht van het hele stuk op de GPU; een album van
  31 minuten in één keer liep op MPS vol (6 okt: 17,9 GB). Per stuk alleen
  de frames van het midden; aan elkaar geven ze de frames van het hele nummer.
- ZWAARTEPUNT: het netwerk rekent in frames van 20 ms. Een tel op een frame
  ligt daardoor tot 10 ms naast; het zwaartepunt van de kans over ±2 frames
  haalt de mediane afwijking op vaste muziek van ~7 naar ~5 ms (6 okt,
  vier nummers). De pieken zelf kiezen we zoals Beat This! ("minimal"):
  een lokaal maximum over 7 frames met kans > 0,5, buren samen.
- Downbeats naar de dichtstbijzijnde tel, zoals Beat This! zelf doet.
- Het model staat lokaal (VARVE_TELLEN_MODEL, standaard
  ~/.varve/modellen/beat_this-final0.ckpt): de server haalt niets van internet.
- De Mac moet bruikbaar blijven: torch hooguit 4 threads, en de server start
  dit met `nice`.
"""
import argparse
import json
import math
import os
import signal
import sys
import time
import traceback

FPS = 50
STUK_S = 240.0          # zoveel per keer door het netwerk (12.000 frames)
RAND_S = 5.0            # context aan weerskanten van een stuk
VERSIE = 1
STANDAARD_MODEL = os.path.join(os.path.expanduser('~'), '.varve', 'modellen', 'beat_this-final0.ckpt')
MODEL_HULP = ('curl -L -o ~/.varve/modellen/beat_this-final0.ckpt --create-dirs '
              'https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt')


class Fout(Exception):
    """Een fout met een reden voor mensen (komt zo in de wachtrij te staan)."""


def _als_ctrl_c(_sig, _frame):
    raise KeyboardInterrupt


class Melder:
    """`voortgang x` op stdout: niet vaker dan twee keer per seconde, behalve als het moet."""

    def __init__(self):
        self.laatst = 0.0
        self.waarde = 0.0

    def __call__(self, x, moet=False):
        x = max(self.waarde, min(1.0, x))
        nu = time.monotonic()
        if moet or nu - self.laatst >= 0.5:
            print(f'voortgang {x:.4f}', flush=True)
            self.laatst = nu
        self.waarde = x


def info(tekst):
    print(f'info: {tekst}', file=sys.stderr, flush=True)


def kies_apparaat(torch, keuze):
    cuda = torch.cuda.is_available()
    mps = getattr(torch.backends, 'mps', None) is not None and torch.backends.mps.is_available()
    if keuze == 'auto':
        return 'cuda' if cuda else 'mps' if mps else 'cpu'
    if keuze == 'cuda' and not cuda:
        raise Fout('apparaat cuda gevraagd, maar torch ziet geen CUDA')
    if keuze == 'mps' and not mps:
        raise Fout('apparaat mps gevraagd, maar torch ziet geen MPS')
    return keuze


def model_pad(a):
    return a.model or os.environ.get('VARVE_TELLEN_MODEL') or STANDAARD_MODEL


def controle(a):
    """Staat alles klaar? Imports en het modelbestand; het model wordt niet geladen."""
    import numpy
    import soundfile
    import soxr  # noqa: F401
    import torch
    import beat_this
    from beat_this.inference import Audio2Frames  # noqa: F401
    pad = model_pad(a)
    if not os.path.isfile(pad):
        raise Fout(f'het model staat niet op {pad} — {MODEL_HULP}')
    from importlib.metadata import version
    print(json.dumps({
        'ok': True, 'python': sys.version.split()[0], 'torch': torch.__version__,
        'beat_this': version('beat-this'), 'numpy': numpy.__version__, 'soundfile': soundfile.__version__,
        'apparaat': kies_apparaat(torch, a.apparaat), 'model': pad,
    }), flush=True)
    return 0


# ---- pieken -------------------------------------------------------------------

def pieken(logits, np):
    """
    Frames met een tel, zoals Beat This! "minimal": een lokaal maximum over 7
    frames met logit > 0 (kans > 0,5); buren (1 frame) samen als hun
    gemiddelde. Daarna het zwaartepunt van de kans over ±2 frames.
    """
    n = len(logits)
    if n == 0:
        return []
    vol = np.pad(logits, 3, constant_values=-1e9)
    ramen = np.lib.stride_tricks.sliding_window_view(vol, 7)
    piek = (logits > 0) & (logits >= ramen.max(axis=1))
    frames = np.nonzero(piek)[0]
    # Buren samen (zoals deduplicate_peaks): opeenvolgende frames worden hun gemiddelde.
    groepen = []
    for f in frames:
        if groepen and f - groepen[-1][-1] <= 1:
            groepen[-1].append(f)
        else:
            groepen.append([f])
    kans = 1 / (1 + np.exp(-logits.astype(np.float64)))
    uit = []
    for g in groepen:
        m = int(round(sum(g) / len(g)))
        lo, hi = max(0, m - 2), min(n, m + 3)
        w = kans[lo:hi]
        k = np.arange(lo, hi)
        uit.append(float((w * k).sum() / w.sum()) / FPS if w.sum() > 0 else m / FPS)
    return uit


def naar_tellen(downs, beats, np):
    """Elke downbeat naar de dichtstbijzijnde tel (binnen 0,1 s), dubbele weg."""
    if not beats:
        return []
    b = np.asarray(beats)
    uit = []
    for d in downs:
        i = int(np.argmin(np.abs(b - d)))
        if abs(b[i] - d) <= 0.1 and (not uit or uit[-1] != b[i]):
            uit.append(float(b[i]))
    return uit


# ---- het werk -----------------------------------------------------------------

def tellen(a):
    t0 = time.perf_counter()
    import numpy as np
    import soundfile as sf
    import torch
    from beat_this.inference import Audio2Frames

    try:
        torch.set_num_threads(a.threads)
        torch.set_num_interop_threads(1)
    except RuntimeError:
        pass
    apparaat = kies_apparaat(torch, a.apparaat)
    pad = model_pad(a)
    if not os.path.isfile(pad):
        raise Fout(f'het model staat niet op {pad} — {MODEL_HULP}')
    melder = Melder()
    melder(0, moet=True)

    try:
        info_ = sf.info(a.invoer)
    except RuntimeError as e:
        raise Fout(f'kan {a.invoer} niet lezen: {e}') from e
    sr, n = info_.samplerate, info_.frames
    if n <= 0:
        raise Fout('audio.wav is leeg')
    duur = n / sr
    a2f = Audio2Frames(checkpoint_path=pad, device=apparaat)
    info(f'model geladen op {apparaat} in {time.perf_counter() - t0:.1f} s')

    totaal = int(math.ceil(duur * FPS))
    beat = np.full(totaal, -1e9, dtype=np.float32)
    down = np.full(totaal, -1e9, dtype=np.float32)
    stukken = max(1, int(math.ceil(duur / STUK_S)))
    for s in range(stukken):
        begin = s * STUK_S
        lees_van = max(0.0, begin - RAND_S)
        lees_tot = min(duur, begin + STUK_S + RAND_S)
        sig, _ = sf.read(a.invoer, start=int(lees_van * sr), stop=int(lees_tot * sr), dtype='float32', always_2d=True)
        if len(sig) < sr // 10:
            continue
        b, d = a2f(sig.mean(axis=1), sr)
        b = b.float().cpu().numpy()
        d = d.float().cpu().numpy()
        # Alleen het midden: frame j van dit stuk ligt op lees_van + j/FPS.
        f0 = int(round(lees_van * FPS))
        lo = int(round(begin * FPS))
        hi = min(totaal, int(round((begin + STUK_S) * FPS)))
        j0, j1 = lo - f0, min(len(b), hi - f0)
        if j1 > j0:
            beat[lo:lo + (j1 - j0)] = b[j0:j1]
            down[lo:lo + (j1 - j0)] = d[j0:j1]
        if apparaat == 'mps':
            torch.mps.empty_cache()
        melder((s + 1) / stukken * 0.97)

    beats = pieken(beat, np)
    downbeats = naar_tellen(pieken(down, np), beats, np)
    sec = time.perf_counter() - t0
    info(f'{len(beats)} tellen, {len(downbeats)} downbeats in {sec:.1f} s ({duur / 60:.1f} min audio, {apparaat})')
    uit = {
        'versie': VERSIE, 'beats': [round(x, 5) for x in beats], 'downbeats': [round(x, 5) for x in downbeats],
        'fps': FPS, 'verfijnd': 'zwaartepunt', 'model': os.path.basename(pad), 'apparaat': apparaat,
        'sec': round(sec, 2), 'duur': round(duur, 3),
    }
    # Eerst naast het doel, dan in één keer erover: nooit een half bestand.
    tijdelijk = a.uit + '.tmp'
    with open(tijdelijk, 'w') as f:
        json.dump(uit, f, separators=(',', ':'))
    os.replace(tijdelijk, a.uit)
    melder(1, moet=True)
    print('klaar', flush=True)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description='Tellen en downbeats vinden met Beat This! (docs/BEATGRID.md §11).')
    ap.add_argument('--in', dest='invoer', help='audio.wav')
    ap.add_argument('--uit', help='tellen.json')
    ap.add_argument('--apparaat', default='auto', choices=('auto', 'mps', 'cuda', 'cpu'))
    ap.add_argument('--model', default=None, help=f'het checkpoint (standaard VARVE_TELLEN_MODEL of {STANDAARD_MODEL})')
    ap.add_argument('--threads', type=int, default=max(1, min(4, (os.cpu_count() or 2) // 2)),
                    help='CPU-threads voor torch (standaard de helft van de kernen, hooguit 4)')
    ap.add_argument('--controle', action='store_true', help='alleen kijken of alles klaarstaat')
    a = ap.parse_args(argv)

    signal.signal(signal.SIGINT, signal.default_int_handler)
    signal.signal(signal.SIGTERM, _als_ctrl_c)
    os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')

    try:
        if a.controle:
            return controle(a)
        if not a.invoer or not a.uit:
            ap.error('--in en --uit zijn nodig')
        if not os.path.isfile(a.invoer):
            raise Fout(f'{a.invoer} bestaat niet')
        return tellen(a)
    except KeyboardInterrupt:
        if a.uit:
            try:
                os.remove(a.uit + '.tmp')
            except OSError:
                pass
        print('gestopt', file=sys.stderr, flush=True)
        return 130
    except Fout as e:
        print(f'fout: {e}', file=sys.stderr, flush=True)
        return 1
    except ImportError as e:
        print(f'fout: {e.name or e} ontbreekt in {sys.executable} — pip install beat-this==1.1.0', file=sys.stderr, flush=True)
        return 1
    except Exception as e:  # noqa: BLE001 — alles wat er misgaat wordt een reden, geen hangende wachtrij
        traceback.print_exc()
        print(f'fout: {type(e).__name__}: {e}', file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
