"""
De stem-splitter van Varve (docs/STEMS.md §2): media/<id>/audio.wav erin,
stems.wav + stems.json eruit. Demucs htdemucs, vooraf rekenen bij de ingest,
live bedienen in de app.

  <python> server/stems/splits.py --in <audio.wav> --uit <map> --aantal 2|4
           [--apparaat auto|mps|cuda|cpu] [--model htdemucs] [--threads N]
  <python> server/stems/splits.py --controle      (staat alles klaar? JSON op stdout)

Stdout: regels `voortgang <0..1>` en als laatste `klaar`. Fouten naar stderr
(de laatste regel is de reden), exitcode ≠ 0. SIGINT (of SIGTERM) = netjes
stoppen: tijdelijke bestanden weg, exit 130. Regels op stderr die met `info:`
beginnen zijn meetwaarden, geen fout.

Waarom zo:

- IN STUKKEN. Demucs' apply_model houdt de hele invoer én alle vier bronnen
  van het hele nummer als float32 in het geheugen: een uur is dan ~6,5 GB plus
  tussenresultaten, op een M1 met 16 GB naast een server en Chrome. Hier gaat
  er telkens ~47 s door het model (8 strides van het model, zodat apply_model
  geen half segment verspilt), met 4 s overlap: 1 s context aan weerskanten
  plus een lineaire kruisfade van 2 s precies op de grens. Lineair en niet
  equal-power: de twee stukken schatten hetzelfde signaal, ze zijn sterk
  gecorreleerd, en dan telt lineair op tot 1 (equal-power zou 3 dB bobbelen).
- 48 -> 44,1 kHz voor het model en terug, met torchaudio.functional (NIET
  torchaudio.load/save: die vragen in 2.9 torchcodec). Elk stuk begint op een
  veelvoud van 160 frames (48000/300) = 147 bij 44,1 kHz (44100/300): dan valt
  het hersample-rooster van elk stuk precies op dat van het hele nummer, en
  zijn de stukken frame voor frame uitgelijnd.
- Normaliseren (zoals demucs.separate: gemiddelde eraf, delen door de
  spreiding van de mono-mix) met de cijfers van het HELE nummer, niet per
  stuk: anders krijgt elk stuk een andere versterking het model in.
- De som van de stems is audio.wav (op 16-bit afronding na): wat het model
  nergens onderbracht gaat naar inst/other. Demucs zelf telt maar op tot
  -25..-38 dB onder het origineel (gemeten op Clay's nummers, 3 okt).
- `schaal` exact uit de grootste piek: eerst alles als float32 naar een
  tijdelijk bestand (en de piek bijhouden), dan pas naar 16 bit. Een uur met
  vier stems is ~5,5 GB tijdelijk; daarom vooraf de vrije schijfruimte.
- De Mac moet bruikbaar blijven: torch krijgt hooguit 4 threads (de server
  start dit bovendien met `nice`).
"""
import argparse
import json
import math
import os
import shutil
import signal
import struct
import sys
import time
import traceback
from datetime import datetime, timezone

SR = 48000
NAMEN = {2: ['vocals', 'inst'], 4: ['drums', 'bass', 'other', 'vocals']}
REST_NAAR = {2: 'inst', 4: 'other'}   # waar de rest van het model heen gaat (zie splits())
FADE_S = 2.0            # kruisfade op een stukgrens
MARGE_S = 1.0           # context aan weerskanten van de kruisfade
STUK_STRIDES = 8        # stuklengte in strides van het model: htdemucs 8 × 5,85 s ≈ 46,8 s
MIN_REST_S = 10.0       # een korter laatste stuk gaat bij het vorige
DEEL_PASS1 = 0.97       # pass 1 (het model) is bijna alles; pass 2 (naar 16 bit) de rest
TMP_FLOAT = '.stems-tmp.f32'
TMP_WAV = '.stems-tmp.wav'
TMP_JSON = '.stems-tmp.json'


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
        x = max(self.waarde, min(1.0, x))   # nooit terug
        nu = time.monotonic()
        if moet or nu - self.laatst >= 0.5:
            print(f'voortgang {x:.4f}', flush=True)
            self.laatst = nu
        self.waarde = x


def info(tekst):
    print(f'info: {tekst}', file=sys.stderr, flush=True)


# ---- WAV --------------------------------------------------------------------

class Kop:
    __slots__ = ('kanalen', 'sr', 'bits', 'data', 'frames')


def lees_kop(f):
    """
    De kop van een WAV: zoekt fmt en data zelf (er mag een LIST-chunk tussen
    staan, zoals ffmpeg die schrijft). Alleen 16-bit PCM (formaat 1 of 0xFFFE).
    """
    grootte = os.fstat(f.fileno()).st_size
    f.seek(0)
    riff = f.read(12)
    if len(riff) < 12 or riff[:4] not in (b'RIFF', b'RF64') or riff[8:12] != b'WAVE':
        raise Fout('dit is geen WAV-bestand')
    kop = Kop()
    fmt = None
    pos = 12
    while pos + 8 <= grootte:
        f.seek(pos)
        naam, n = struct.unpack('<4sI', f.read(8))
        if naam == b'fmt ':
            ruw = f.read(min(n, 40))
            formaat, kop.kanalen, kop.sr, _, _, kop.bits = struct.unpack('<HHIIHH', ruw[:16])
            if formaat == 0xFFFE and len(ruw) >= 26:
                formaat = struct.unpack('<H', ruw[24:26])[0]   # het subformaat (GUID begint met de code)
            fmt = formaat
        elif naam == b'data':
            if fmt is None:
                raise Fout('WAV zonder fmt-chunk vóór de data')
            begin = pos + 8
            lengte = grootte - begin if n in (0, 0xFFFFFFFF) else min(n, grootte - begin)
            if fmt != 1 or kop.bits != 16:
                raise Fout(f'alleen 16-bit PCM (dit is formaat {fmt}, {kop.bits} bit)')
            kop.data = begin
            kop.frames = lengte // (kop.kanalen * 2)
            return kop
        pos += 8 + n + (n & 1)
    raise Fout('WAV zonder data-chunk')


def wav_kop(frames, kanalen):
    """Een kop van 44 bytes: PCM 16-bit, 48 kHz, `kanalen` interleaved."""
    data = frames * kanalen * 2
    return (b'RIFF' + struct.pack('<I', 36 + data) + b'WAVE'
            + b'fmt ' + struct.pack('<IHHIIHH', 16, 1, kanalen, SR, SR * kanalen * 2, kanalen * 2, 16)
            + b'data' + struct.pack('<I', data))


def lees_frames(f, kop, np, van, tot):
    """Frames [van, tot) als float32 (kanalen, n), zoals de engine leest: / 32768."""
    f.seek(kop.data + van * kop.kanalen * 2)
    ruw = f.read((tot - van) * kop.kanalen * 2)
    x = np.frombuffer(ruw, dtype='<i2').reshape(-1, kop.kanalen).T
    return x.astype(np.float32) * np.float32(1 / 32768)


def statistiek(f, kop, np):
    """Gemiddelde en spreiding van de mono-mix over het HELE nummer, in blokken."""
    som = som2 = 0.0
    blok = 1 << 20
    for van in range(0, kop.frames, blok):
        x = lees_frames(f, kop, np, van, min(kop.frames, van + blok)).astype(np.float64).mean(0)
        som += float(x.sum())
        som2 += float((x * x).sum())
    n = max(1, kop.frames)
    gem = som / n
    return gem, math.sqrt(max(0.0, som2 / n - gem * gem))


# ---- het model --------------------------------------------------------------

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


def laad_model(naam, apparaat):
    """
    Het model, klaar op het apparaat. htdemucs is een "bag" van één model met
    gewicht 1: dan direct dat model, anders zet apply_model het per aanroep
    heen en terug naar de CPU (84 MB per stuk, voor niets).
    """
    from demucs.pretrained import get_model
    from demucs.apply import BagOfModels
    bag = get_model(naam)
    bag.eval()
    model = bag
    if isinstance(bag, BagOfModels) and len(bag.models) == 1 and all(w == 1 for w in bag.weights[0]):
        model = bag.models[0]
        model.to(apparaat)
    segment = float(getattr(model, 'segment', None) or bag.models[0].segment)
    return model, list(bag.sources), bag.samplerate, segment


def combineer(uit, bronnen, aantal, torch):
    """(4, 2, n) in de volgorde van het model -> (aantal, 2, n) in de volgorde van NAMEN."""
    i = {b: bronnen.index(b) for b in bronnen}
    if aantal == 4:
        return torch.stack([uit[i[b]] for b in NAMEN[4]])
    rest = [uit[i[b]] for b in bronnen if b != 'vocals']
    return torch.stack([uit[i['vocals']], sum(rest[1:], rest[0])])


# ---- splitsen ---------------------------------------------------------------

def stuk_maten(sr_model, segment, stuk_s=None):
    """
    Stuklengte, context, hop en fade in frames op 48 kHz, op het gemeenschappelijke
    rooster van beide samplerates (zie bovenaan). Ook voor tools/stems/vergelijk.py.
    stuk_s: None = STUK_STRIDES strides van het model; 0 = niet in stukken.
    """
    g = math.gcd(SR, sr_model)
    blok48, blok_m = SR // g, sr_model // g
    seg_len = int(sr_model * segment)
    stride = int(0.75 * seg_len)          # zoals apply_model met overlap 0,25
    stuk_m = STUK_STRIDES * stride if stuk_s is None else int(stuk_s * sr_model)
    stuk48 = (stuk_m // blok_m) * blok48
    fade = int(round(FADE_S * SR / 2)) * 2
    context = int(math.ceil((FADE_S / 2 + MARGE_S) * SR / blok48)) * blok48
    return stuk48, context, stuk48 - 2 * context, fade, stride


def plan_stukken(n, stuk, hop, rest=int(MIN_REST_S * SR)):
    """Grenzen B_0 = 0 … B_K = n. Eén stuk als het in één keer past."""
    if stuk <= 0 or n <= stuk:
        return [0, n]
    grenzen = list(range(0, n, hop)) + [n]
    if len(grenzen) > 2 and grenzen[-1] - grenzen[-2] < rest:
        del grenzen[-2]
    return grenzen


def splits(a, tijdelijk):
    t0 = time.perf_counter()
    import numpy as np
    import torch
    import torchaudio.functional as AF
    from demucs.apply import apply_model

    try:
        torch.set_num_threads(a.threads)
        torch.set_num_interop_threads(1)
    except RuntimeError:
        pass   # al gezet (alleen bij hergebruik in hetzelfde proces)
    apparaat = kies_apparaat(torch, a.apparaat)
    aantal = a.aantal
    kanalen = 2 * aantal
    melder = Melder()

    with open(a.invoer, 'rb') as f:
        kop = lees_kop(f)
        if kop.sr != SR:
            raise Fout(f'audio.wav is {kop.sr} Hz, verwacht {SR}')
        if kop.kanalen != 2:
            raise Fout(f'audio.wav heeft {kop.kanalen} kanalen, verwacht 2')
        n = kop.frames
        if n <= 0:
            raise Fout('audio.wav is leeg')
        data_bytes = n * kanalen * 2
        if 36 + data_bytes > 0xFFFFFFFF:
            raise Fout(f'te lang voor één WAV-bestand: {aantal} stems van {n / SR / 3600:.1f} uur is '
                       f'{data_bytes / 1024 ** 3:.1f} GB (grens 4 GB) — kies 2 stems of knip het op')
        os.makedirs(a.uit, exist_ok=True)
        nodig = n * kanalen * 4 + data_bytes + 64 * 1024 ** 2
        vrij = shutil.disk_usage(a.uit).free
        if vrij < nodig:
            raise Fout(f'te weinig schijfruimte: nodig {nodig / 1024 ** 3:.1f} GB (tijdelijk float32 + stems.wav), '
                       f'vrij {vrij / 1024 ** 3:.1f} GB')

        gem, spreiding = statistiek(f, kop, np)
        spreiding += 1e-8
        model, bronnen, sr_model, segment = laad_model(a.model, apparaat)
        for b in NAMEN[4]:
            if b not in bronnen:
                raise Fout(f'model {a.model} kent geen bron "{b}" (wel: {", ".join(bronnen)})')
        t_model = time.perf_counter() - t0

        stuk48, context, hop, fade, stride = stuk_maten(sr_model, segment, a.stuk_s)
        if a.stuk_s != 0 and hop < 4 * fade:
            raise Fout('stuk te kort voor de overlap')
        grenzen = plan_stukken(n, stuk48 if a.stuk_s != 0 else 0, hop)
        stukken = len(grenzen) - 1
        omhoog = ((np.arange(fade, dtype=np.float64) + 0.5) / fade).astype(np.float32)[:, None]
        omlaag = (1 - omhoog).astype(np.float32)

        tmp = os.path.join(a.uit, TMP_FLOAT)
        tijdelijk.append(tmp)
        piek = 0.0
        geschreven = 0
        mps_piek = 0
        staart = None
        with open(tmp, 'wb') as uit_f:
            def schrijf(x):
                nonlocal piek, geschreven
                if len(x):
                    piek = max(piek, float(np.abs(x).max()))
                    uit_f.write(np.ascontiguousarray(x, dtype='<f4').tobytes())
                    geschreven += len(x)

            melder(0.0, moet=True)
            for k in range(stukken):
                b0, b1 = grenzen[k], grenzen[k + 1]
                eerste, laatste = k == 0, k == stukken - 1
                van = 0 if eerste else b0 - context
                tot = n if laatste else b1 + context
                x = torch.from_numpy(lees_frames(f, kop, np, van, tot))
                lengte = x.shape[1]
                xm = AF.resample(x, SR, sr_model) if sr_model != SR else x
                xm = (xm - gem) / spreiding
                segs = max(1, math.ceil(xm.shape[1] / stride))
                klaar_segs = [0]

                def bij_segment(d, b0=b0, b1=b1, segs=segs):
                    if d.get('state') == 'end':
                        klaar_segs[0] += 1
                        melder(DEEL_PASS1 * (b0 + (b1 - b0) * min(1.0, klaar_segs[0] / segs)) / n)

                with torch.no_grad():
                    bron = apply_model(model, xm[None], device=apparaat, shifts=0, split=True,
                                       overlap=0.25, progress=False, callback=bij_segment)[0]
                # Terug naar de schaal van het origineel; het gemiddelde over de
                # bronnen verdeeld, zodat de SOM het origineel blijft.
                bron = bron * spreiding + gem / len(bronnen)
                stems = combineer(bron, bronnen, aantal, torch)
                del bron, xm
                y = stems.reshape(kanalen, -1)
                if sr_model != SR:
                    y = AF.resample(y, sr_model, SR)
                if y.shape[1] < lengte:
                    y = torch.nn.functional.pad(y, (0, lengte - y.shape[1]))
                y = y[:, :lengte]
                # De REST: wat het model aan geen enkele bron toewees, plus het
                # verlies van het hersamplen (alles boven ~21,8 kHz). Gemeten
                # -25 tot -38 dB onder het origineel; die gaat naar inst (bij
                # twee: inst = mix - zang) of other (bij vier). Dan is "alle
                # stems vol" precies audio.wav, en klinkt een nummer met stems
                # dat je niet aanraakt als het nummer. De kruisfade is lineair,
                # dus dat geldt ook over de stukgrenzen.
                rest = x - y.reshape(aantal, 2, lengte).sum(0)
                k = NAMEN[aantal].index(REST_NAAR[aantal])
                y[2 * k:2 * k + 2] += rest
                del rest
                blok = y.T.contiguous().numpy()   # (frames, kanalen), interleaved
                del y, stems
                if apparaat == 'mps':
                    mps_piek = max(mps_piek, torch.mps.driver_allocated_memory())

                # Wat dit stuk levert: van B_k − fade/2 tot B_{k+1} + fade/2.
                o0 = 0 if eerste else (b0 - fade // 2) - van
                o1 = lengte if laatste else (b1 + fade // 2) - van
                deel = blok[o0:o1]
                if not eerste:
                    schrijf(deel[:fade] * omhoog + staart)
                    deel = deel[fade:]
                if not laatste:
                    schrijf(deel[:-fade])
                    staart = deel[-fade:] * omlaag
                else:
                    schrijf(deel)
                melder(DEEL_PASS1 * b1 / n, moet=True)
        if geschreven != n:
            raise Fout(f'interne fout: {geschreven} frames geschreven, {n} verwacht')
        t_pass1 = time.perf_counter() - t0

    # ---- pass 2: met één schaal naar 16 bit ---------------------------------
    schaal = 1.0 if piek <= 0 else min(1.0, 32767 / (32768 * piek))
    wav_tmp = os.path.join(a.uit, TMP_WAV)
    tijdelijk.append(wav_tmp)
    factor = np.float32(schaal * 32768)
    per = 1 << 18
    with open(tmp, 'rb') as src, open(wav_tmp, 'wb') as dst:
        dst.write(wav_kop(n, kanalen))
        for van in range(0, n, per):
            m = min(per, n - van)
            x = np.frombuffer(src.read(m * kanalen * 4), dtype='<f4')
            y = np.rint(x * factor)
            np.clip(y, -32768, 32767, out=y)
            dst.write(y.astype('<i2').tobytes())
            melder(DEEL_PASS1 + (1 - DEEL_PASS1) * (van + m) / n)
    os.remove(tmp)
    rekentijd = time.perf_counter() - t0
    meta = {
        'versie': 1, 'model': a.model, 'aantal': aantal, 'namen': NAMEN[aantal], 'schaal': schaal,
        'frames': n, 'sr': SR, 'apparaat': apparaat, 'rekentijd_s': round(rekentijd, 1),
        'gemaakt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    json_tmp = os.path.join(a.uit, TMP_JSON)
    tijdelijk.append(json_tmp)
    with open(json_tmp, 'w') as j:
        json.dump(meta, j, ensure_ascii=False, indent=1)
    # Pas nu onder de echte namen: wie stems.json ziet, ziet een complete set.
    os.replace(wav_tmp, os.path.join(a.uit, 'stems.wav'))
    os.replace(json_tmp, os.path.join(a.uit, 'stems.json'))
    duur = n / SR
    info(f'{duur:.1f} s audio in {rekentijd:.1f} s ({duur / rekentijd:.2f}x realtime; model laden {t_model:.1f} s, '
         f'naar 16 bit {rekentijd - t_pass1:.1f} s) · {stukken} stuk{"ken" if stukken != 1 else ""} · '
         f'apparaat {apparaat} · threads {a.threads} · piek {piek:.4f} -> schaal {schaal:.4f}'
         + (f' · mps {mps_piek / 1024 ** 2:.0f} MB' if apparaat == 'mps' else ''))
    melder(1.0, moet=True)
    print('klaar', flush=True)
    return 0


def controle(a):
    """Staat alles klaar? Laadt het model NIET (dat kan downloaden); alleen de imports."""
    import numpy
    import torch
    import torchaudio
    import demucs
    from demucs.apply import apply_model  # noqa: F401 (moet importeerbaar zijn)
    print(json.dumps({
        'ok': True, 'python': sys.version.split()[0], 'torch': torch.__version__,
        'torchaudio': torchaudio.__version__, 'demucs': getattr(demucs, '__version__', '?'),
        'numpy': numpy.__version__, 'apparaat': kies_apparaat(torch, a.apparaat),
    }), flush=True)
    return 0


def ruim_op(paden):
    for p in paden:
        try:
            os.remove(p)
        except OSError:
            pass


def main(argv=None):
    ap = argparse.ArgumentParser(description='Stems splitsen met Demucs (docs/STEMS.md).')
    ap.add_argument('--in', dest='invoer', help='audio.wav (16-bit PCM, 48 kHz, stereo)')
    ap.add_argument('--uit', help='map voor stems.wav en stems.json')
    ap.add_argument('--aantal', type=int, choices=(2, 4))
    ap.add_argument('--apparaat', default='auto', choices=('auto', 'mps', 'cuda', 'cpu'))
    ap.add_argument('--model', default='htdemucs')
    ap.add_argument('--threads', type=int, default=max(1, min(4, (os.cpu_count() or 2) // 2)),
                    help='CPU-threads voor torch (standaard de helft van de kernen, hooguit 4)')
    ap.add_argument('--stuk-s', type=float, default=None,
                    help='alleen voor metingen: stuklengte in s op modeltijd; 0 = alles in één keer')
    ap.add_argument('--controle', action='store_true', help='alleen kijken of torch en demucs er zijn')
    a = ap.parse_args(argv)

    # Expliciet: een proces dat met SIGINT op "negeren" gestart is (een
    # achtergrondtaak uit een shell) krijgt anders geen KeyboardInterrupt.
    signal.signal(signal.SIGINT, signal.default_int_handler)
    signal.signal(signal.SIGTERM, _als_ctrl_c)
    # Een op MPS ontbrekende bewerking valt terug op de CPU in plaats van te falen.
    os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')

    tijdelijk = []
    try:
        if a.controle:
            return controle(a)
        if not a.invoer or not a.uit or not a.aantal:
            ap.error('--in, --uit en --aantal zijn nodig')
        if not os.path.isfile(a.invoer):
            raise Fout(f'{a.invoer} bestaat niet')
        return splits(a, tijdelijk)
    except KeyboardInterrupt:
        ruim_op(tijdelijk)
        print('gestopt', file=sys.stderr, flush=True)
        return 130
    except Fout as e:
        ruim_op(tijdelijk)
        print(f'fout: {e}', file=sys.stderr, flush=True)
        return 1
    except ImportError as e:
        ruim_op(tijdelijk)
        print(f'fout: {e.name or e} ontbreekt in {sys.executable} — pip install demucs', file=sys.stderr, flush=True)
        return 1
    except Exception as e:  # noqa: BLE001 — alles wat er misgaat wordt een reden, geen hangende wachtrij
        ruim_op(tijdelijk)
        traceback.print_exc()
        print(f'fout: {type(e).__name__}: {e}', file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
