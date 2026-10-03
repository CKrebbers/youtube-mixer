"""
Meetinstrument bij server/stems/splits.py (docs/verslagen/2026-10-03/server.md):
klopt een stems.wav met zijn audio.wav, en zijn de stukgrenzen te zien?

  python tools/stems/vergelijk.py --origineel <audio.wav> --stems <map> [--ref <map>] [--json <uit.json>]

- frames gelijk, kanalen, schaal;
- hoe ver som(stems)/schaal van het origineel ligt (dB, zoals meet.py), over
  het hele nummer en per venster van 100 ms in de kruisfades op de stukgrenzen
  tegenover de rest;
- sprongen: de grootste stap tussen twee samples rond elke grens tegenover de
  grootste stap in het hele nummer, per stem;
- met --ref (dezelfde split zonder stukken, `splits.py --stuk-s 0`): per stem
  hoe ver de stukken-versie van de hele afwijkt, in de kruisfades tegenover
  de rest, en het niveau (RMS) in elke kruisfade t.o.v. de referentie.

Alleen numpy (de venv met Demucs heeft het). Leest met memmap, in blokken:
een uur met acht kanalen past niet zomaar in het geheugen.
"""
import argparse
import json
import os
import sys

import numpy as np

sys.dont_write_bytecode = True   # geen __pycache__ in server/stems/
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'server', 'stems'))
import splits as S  # noqa: E402

VENSTER = 4800          # 100 ms op 48 kHz
STIL = 1e-7             # gemiddeld vermogen per sample waaronder een venster niet meetelt


def lees(pad):
    """(memmap int16 (frames, kanalen), kop) van een WAV."""
    with open(pad, 'rb') as f:
        kop = S.lees_kop(f)
    x = np.memmap(pad, dtype='<i2', mode='r', offset=kop.data, shape=(kop.frames, kop.kanalen))
    return x, kop


def db(a, b):
    return float(10 * np.log10(max(a, 1e-30) / max(b, 1e-30)))


def per_venster(n, fn):
    """fn(van, tot) -> (k vensters, …): over het hele bestand in blokken van 600 vensters."""
    uit = []
    blok = 600 * VENSTER
    for van in range(0, n - n % VENSTER, blok):
        uit.append(fn(van, min(n - n % VENSTER, van + blok)))
    return np.concatenate(uit)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--origineel', required=True)
    ap.add_argument('--stems', required=True, help='map met stems.wav en stems.json')
    ap.add_argument('--ref', help='map met dezelfde split zonder stukken (--stuk-s 0)')
    ap.add_argument('--json')
    a = ap.parse_args()

    orig, ko = lees(a.origineel)
    st, ks = lees(os.path.join(a.stems, 'stems.wav'))
    meta = json.load(open(os.path.join(a.stems, 'stems.json')))
    n = ko.frames
    aantal = meta['aantal']
    schaal = meta['schaal']
    uit = {'stems': a.stems, 'frames_origineel': n, 'frames_stems': ks.frames, 'frames_gelijk': ks.frames == n,
           'kanalen': ks.kanalen, 'aantal': aantal, 'namen': meta['namen'], 'schaal': schaal,
           'rekentijd_s': meta.get('rekentijd_s'), 'x_realtime': round(n / 48000 / meta['rekentijd_s'], 2) if meta.get('rekentijd_s') else None}

    stuk48, context, hop, fade, _ = S.stuk_maten(44100, 7.8)
    grenzen = S.plan_stukken(n, stuk48, hop)[1:-1]
    uit['grenzen_s'] = [round(g / 48000, 2) for g in grenzen]
    # Vensters die een kruisfade raken.
    k = (n - n % VENSTER) // VENSTER
    in_fade = np.zeros(k, dtype=bool)
    for g in grenzen:
        in_fade[max(0, (g - fade // 2) // VENSTER):min(k, (g + fade // 2) // VENSTER + 1)] = True

    # ---- som / schaal tegen het origineel ---------------------------------
    def som_fout(van, tot):
        o = orig[van:tot].astype(np.float64) / 32768
        s = st[van:tot].astype(np.float64).reshape(tot - van, aantal, 2).sum(1) / 32768 / schaal
        e = ((s - o) ** 2).reshape(-1, VENSTER, 2).sum((1, 2))
        p = (o ** 2).reshape(-1, VENSTER, 2).sum((1, 2))
        return np.stack([e, p], 1)
    ep = per_venster(n, som_fout)
    luid = ep[:, 1] / (VENSTER * 2) > STIL
    per_db = 10 * np.log10(np.maximum(ep[:, 0], 1e-30) / np.maximum(ep[:, 1], 1e-30))
    uit['som_min_origineel_db'] = round(db(ep[:, 0].sum(), ep[:, 1].sum()), 1)
    rest = per_db[luid & ~in_fade]
    fadev = per_db[luid & in_fade]
    uit['som_per_venster_db'] = {
        'buiten_fades_mediaan': round(float(np.median(rest)), 1) if len(rest) else None,
        'buiten_fades_p95': round(float(np.percentile(rest, 95)), 1) if len(rest) else None,
        'in_fades_mediaan': round(float(np.median(fadev)), 1) if len(fadev) else None,
        'in_fades_max': round(float(fadev.max()), 1) if len(fadev) else None,
    }

    # ---- aandeel per stem en sprongen ------------------------------------
    aandeel = {}
    sprong = {}
    for i, naam in enumerate(meta['namen']):
        kan = st[:, 2 * i:2 * i + 2]
        e = 0.0
        groot = 0
        for van in range(0, n, 1 << 22):
            x = kan[van:min(n, van + (1 << 22) + 1)].astype(np.int32)
            e += float((x[: min(1 << 22, n - van)].astype(np.float64) ** 2).sum())
            groot = max(groot, int(np.abs(np.diff(x, axis=0)).max()) if len(x) > 1 else 0)
        aandeel[naam] = e
        rond = 0
        for g in grenzen:
            x = kan[max(0, g - fade // 2 - 480):min(n, g + fade // 2 + 480)].astype(np.int32)
            rond = max(rond, int(np.abs(np.diff(x, axis=0)).max()))
        sprong[naam] = {'grootste_stap_rond_grenzen': rond, 'grootste_stap_heel': groot,
                        'verhouding': round(rond / groot, 3) if groot else None}
    tot = sum(aandeel.values()) or 1
    uit['aandeel_energie_pct'] = {k2: round(100 * v / tot, 1) for k2, v in aandeel.items()}
    uit['sprongen'] = sprong

    # ---- tegen de split zonder stukken -----------------------------------
    if a.ref:
        ref, kr = lees(os.path.join(a.ref, 'stems.wav'))
        mref = json.load(open(os.path.join(a.ref, 'stems.json')))
        uit['ref'] = {'stems': a.ref, 'schaal': mref['schaal'], 'rekentijd_s': mref.get('rekentijd_s')}
        per_stem = {}
        for i, naam in enumerate(meta['namen']):
            def verschil(van, tot, i=i):
                x = st[van:tot, 2 * i:2 * i + 2].astype(np.float64) / 32768 / schaal
                r = ref[van:tot, 2 * i:2 * i + 2].astype(np.float64) / 32768 / mref['schaal']
                d = ((x - r) ** 2).reshape(-1, VENSTER, 2).sum((1, 2))
                p = (r ** 2).reshape(-1, VENSTER, 2).sum((1, 2))
                px = (x ** 2).reshape(-1, VENSTER, 2).sum((1, 2))
                return np.stack([d, p, px], 1)
            dp = per_venster(n, verschil)
            hoorbaar = dp[:, 1] / (VENSTER * 2) > STIL
            vdb = 10 * np.log10(np.maximum(dp[:, 0], 1e-30) / np.maximum(dp[:, 1], 1e-30))
            buiten, binnen = vdb[hoorbaar & ~in_fade], vdb[hoorbaar & in_fade]
            # Niveau in elke kruisfade: RMS stukken / RMS hele split, in dB.
            niveau = []
            for g in grenzen:
                v0, v1 = (g - fade // 2) // VENSTER, (g + fade // 2) // VENSTER + 1
                if dp[v0:v1, 1].sum() / ((v1 - v0) * VENSTER * 2) > STIL:
                    niveau.append(db(dp[v0:v1, 2].sum(), dp[v0:v1, 1].sum()))
            per_stem[naam] = {
                'heel_db': round(db(dp[:, 0].sum(), dp[:, 1].sum()), 1),
                'buiten_fades_mediaan_db': round(float(np.median(buiten)), 1) if len(buiten) else None,
                'buiten_fades_p95_db': round(float(np.percentile(buiten, 95)), 1) if len(buiten) else None,
                'in_fades_mediaan_db': round(float(np.median(binnen)), 1) if len(binnen) else None,
                'in_fades_max_db': round(float(binnen.max()), 1) if len(binnen) else None,
                'niveau_in_fades_db': [round(x, 2) for x in niveau],
            }
        uit['stukken_tegen_heel'] = per_stem

    tekst = json.dumps(uit, ensure_ascii=False, indent=1)
    print(tekst)
    if a.json:
        with open(a.json, 'w') as f:
            f.write(tekst)


if __name__ == '__main__':
    main()
