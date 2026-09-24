"""
Proef: stems splitsen met Demucs op Clay's eigen nummers, en meten hoe lang
het duurt op de M1. Leest media/<id>/audio.wav (alleen lezen), schrijft
per nummer het fragment plus vier stems naar tools/stems/uit/ (niet in git).

Geen onderdeel van de app. Draai met de Python waarin demucs staat:
  <venv>/bin/python tools/stems/meet.py [--apparaat mps|cpu] [--model htdemucs]

Bewust zonder torchaudio.load/save (vraagt in 2.9 torchcodec): WAV lezen en
schrijven met de standaardbibliotheek, hersamplen met torchaudio.functional.
"""
import argparse, json, os, sys, time, wave
import numpy as np
import torch
import torchaudio.functional as AF
from demucs.pretrained import get_model
from demucs.apply import apply_model

WORTEL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UIT = os.path.join(WORTEL, 'tools', 'stems', 'uit')

# (id, naam, begin in s, lengte in s of None = heel)
PROEVEN = [
    ('HGv_ySHXtYI', 'bay-ledges', 0, None),
    ('tiktok-7031697544472251694', 'no-surprises', 0, None),
    ('mOzW9KQKfzA', 'sakamoto', 600, 60),
    ('f3a7DiCsm8k', 'album', 900, 60),
    ('1W1-nPXEVKk', 'zoned-out', 1200, 60),
]


def lees_wav(pad, begin, lengte):
    with wave.open(pad, 'rb') as w:
        sr, kanalen = w.getframerate(), w.getnchannels()
        assert w.getsampwidth() == 2, 'verwacht 16-bit'
        w.setpos(int(begin * sr))
        n = w.getnframes() - int(begin * sr) if lengte is None else int(lengte * sr)
        data = np.frombuffer(w.readframes(n), dtype='<i2').reshape(-1, kanalen).T
    return torch.from_numpy(data.astype(np.float32) / 32768.0), sr


def schrijf_wav(pad, x, sr):
    x = x.clamp(-1, 1).mul(32767).round().to(torch.int16).T.contiguous().numpy()
    with wave.open(pad, 'wb') as w:
        w.setnchannels(x.shape[1]); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(x.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apparaat', default='mps' if torch.backends.mps.is_available() else 'cpu')
    ap.add_argument('--model', default='htdemucs')
    ap.add_argument('--alleen', default=None, help='één naam uit PROEVEN')
    a = ap.parse_args()
    os.makedirs(UIT, exist_ok=True)

    t0 = time.perf_counter()
    model = get_model(a.model)
    model.eval()
    laden = time.perf_counter() - t0
    print(f'model {a.model} geladen in {laden:.1f} s · bronnen {model.sources} · {model.samplerate} Hz · apparaat {a.apparaat}')

    uitslag = []
    for tid, naam, begin, lengte in PROEVEN:
        if a.alleen and naam != a.alleen:
            continue
        pad = os.path.join(WORTEL, 'media', tid, 'audio.wav')
        if not os.path.exists(pad):
            print(f'{naam}: {pad} bestaat niet, overgeslagen'); continue
        mix, sr = lees_wav(pad, begin, lengte)
        duur = mix.shape[1] / sr
        x = AF.resample(mix, sr, model.samplerate)
        # Demucs normaliseert zelf niet: zoals in demucs.separate op gemiddelde en spreiding.
        ref = x.mean(0)
        x = (x - ref.mean()) / (ref.std() + 1e-8)
        t1 = time.perf_counter()
        with torch.no_grad():
            uit = apply_model(model, x[None], device=a.apparaat, shifts=0, split=True, overlap=0.25, progress=False)[0]
        if a.apparaat == 'mps':
            torch.mps.synchronize()
        reken = time.perf_counter() - t1
        uit = uit * (ref.std() + 1e-8) + ref.mean()
        map_ = os.path.join(UIT, naam)
        os.makedirs(map_, exist_ok=True)
        schrijf_wav(os.path.join(map_, '0-origineel.wav'), mix, sr)
        energie = {}
        for i, bron in enumerate(model.sources):
            s = AF.resample(uit[i].cpu(), model.samplerate, sr)
            schrijf_wav(os.path.join(map_, f'{i + 1}-{bron}.wav'), s, sr)
            energie[bron] = float(s.pow(2).mean())
        totaal = sum(energie.values()) or 1
        aandeel = {b: round(100 * e / totaal, 1) for b, e in energie.items()}
        # Hoe goed telt de som van de stems op tot het origineel (restfout in dB)?
        som = AF.resample(uit.sum(0).cpu(), model.samplerate, sr)[:, :mix.shape[1]]
        fout_db = 10 * np.log10(float((som - mix[:, :som.shape[1]]).pow(2).mean()) / float(mix.pow(2).mean()) + 1e-12)
        r = {'naam': naam, 'duur_s': round(duur, 1), 'reken_s': round(reken, 1), 'x_realtime': round(duur / reken, 2),
             'aandeel_energie_pct': aandeel, 'som_min_origineel_db': round(fout_db, 1)}
        uitslag.append(r)
        print(json.dumps(r, ensure_ascii=False))
    with open(os.path.join(UIT, f'meting-{a.model}-{a.apparaat}.json'), 'w') as f:
        json.dump({'laden_s': round(laden, 1), 'proeven': uitslag}, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    sys.exit(main())
