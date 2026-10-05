# Snelheid van de splitter meten (docs/STEMS.md §6): htdemucs op MPS, één minuut uit een nummer,
# fp32 met overlap 0,25 (wat splits.py doet) tegen andere instellingen, met de SDR per bron
# t.o.v. fp32 (hoe hoger, hoe meer hetzelfde; boven ~40 dB hoor je geen verschil).
#
# Gebruik:  ~/.varve/stems-venv/bin/python tools/stems/snelheid.py <audio.wav>
# Meet op een RUSTIGE machine: de GPU wordt gedeeld met Chrome (video, WebGL) en dat halveert alles.
import time, sys, wave, numpy as np, torch, torchaudio.functional as AF
from demucs.pretrained import get_model
from demucs.apply import apply_model
pad = sys.argv[1]
with wave.open(pad, 'rb') as w:
    sr = w.getframerate(); ch = w.getnchannels(); n = min(w.getnframes(), sr * 60)
    w.setpos(min(w.getnframes() - n, sr * 30))
    x = np.frombuffer(w.readframes(n), dtype='<i2').astype(np.float32).reshape(-1, ch).T / 32768.0
x = torch.from_numpy(x[:2].copy())
bag = get_model('htdemucs'); model = bag.models[0] if len(bag.models) == 1 else bag
xm = AF.resample(x, sr, bag.samplerate)
ref = xm.mean(0); xm = (xm - ref.mean()) / ref.std()
dev = 'mps'
model.to(dev).eval()
def run(label, half=False, autocast=False, overlap=0.25):
    m = model
    inp = xm[None].to(dev)
    if half: m = model.half(); inp = inp.half()
    with torch.no_grad():
        if autocast:
            with torch.autocast(device_type='mps', dtype=torch.float16):
                apply_model(m, inp[:, :, :bag.samplerate*8], device=dev, shifts=0, split=True, overlap=overlap, progress=False)
                torch.mps.synchronize(); t0 = time.time()
                out = apply_model(m, inp, device=dev, shifts=0, split=True, overlap=overlap, progress=False)
        else:
            apply_model(m, inp[:, :, :bag.samplerate*8], device=dev, shifts=0, split=True, overlap=overlap, progress=False)
            torch.mps.synchronize(); t0 = time.time()
            out = apply_model(m, inp, device=dev, shifts=0, split=True, overlap=overlap, progress=False)
        torch.mps.synchronize(); dt = time.time() - t0
    if half: model.float()
    out = out[0].float().cpu()
    print(f'{label:28s} {dt:6.2f} s  = {60/dt:5.2f}× realtime', flush=True)
    return out, dt
basis, t_basis = run('fp32 overlap 0.25 (nu)')
def sdr(a, b):
    return 10 * np.log10((b ** 2).sum().item() / max(((a - b) ** 2).sum().item(), 1e-20))
for label, kw in [('fp16 autocast', dict(autocast=True)), ('fp32 overlap 0.10', dict(overlap=0.10))]:
    try:
        out, dt = run(label, **kw)
        print('   ', f'sneller ×{t_basis/dt:.2f}', ' SDR t.o.v. fp32 per bron (dB):', ' '.join(f'{s}={sdr(out[i], basis[i]):.1f}' for i, s in enumerate(bag.sources)), flush=True)
    except Exception as e:
        print(f'{label:28s} FOUT: {type(e).__name__}: {str(e)[:160]}', flush=True)
