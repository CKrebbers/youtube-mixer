# ============================================================================
#  VARVE-koppeling voor TouchDesigner — bouwscript (docs/BUS.md, fase 1)
#  Gebruik: open TouchDesigner, open de Textport (Alt+T / Option+T), en typ:
#     exec(open('/pad/naar/varve/td/bouw_varve.py').read())
#  Het script bouwt in /project1 een component 'varve' met:
#   - Web Server DAT op poort 9981: de hub (node hub/index.js) verbindt daarmee.
#     De Waterschaal houdt 9980; beide kunnen tegelijk draaien.
#     Alleen wie de sleutel uit ~/.varve-sleutel kent (de hub) telt mee; die
#     sleutel maakt de hub of dit script, wie het eerst is.
#   - kanalen (CHOP): bpm, tel, fase, energie, toon, de twee vormlagen en de video-fx
#   - een tabel 'tekst' met maat, toonsoort en titels per deck
#   - een testbron (124 bpm, 8B): zonder VARVE zie je al beeld
#   - een beeld 'beeld' dat op de maat pulseert en kleurt naar de toonsoort
#   - terugsturen: op('varve/terug_sturen').module.actie('track.1.fader', 0.5)
#  Opnieuw draaien vervangt de vorige versie.
#  Gemaakt naar het voorbeeld van bouw_waterschaal.py; niet getest in TD zelf.
# ============================================================================

import os, secrets
PARENT = op('/project1')
NAME = 'varve'
PORT = 9981
W_RES, H_RES = 1280, 720

old = PARENT.op(NAME)
if old: old.destroy()
V = PARENT.create(baseCOMP, NAME)
V.nodeX, V.nodeY = 0, -600
log = []
def say(t):
    log.append(t); print('[varve] ' + t)

def zet(o, naam, waarde, expr=False):
    # alleen via een bestaande Par: een ontbrekende parameter meldt 'niet gezet' in plaats van het script te stoppen
    try:
        p = o.par[naam]
        if p is None:
            say('let op: parameter %s op %s niet gezet (bestaat niet in deze versie)' % (naam, o.name)); return False
        if expr: p.expr = waarde
        else: p.val = waarde
        return True
    except Exception as e:
        say('let op: parameter %s op %s niet gezet (%s)' % (naam, o.name, e)); return False

def setpar(o, **kw):
    for k, v in kw.items(): zet(o, k, v)

def blokken(o, seq, n):
    try:
        s = getattr(o.seq, seq)
        if s.numBlocks < n: s.numBlocks = n
    except Exception as e:
        say('let op: sequence %s op %s niet vergroot (%s)' % (seq, o.name, e))

def kanalen(o, namen):
    blokken(o, 'const', len(namen))
    for i, c in enumerate(namen):
        zet(o, 'const%dname' % i, c); zet(o, 'const%dvalue' % i, 0)

def place(o, x, y): o.nodeX, o.nodeY = x * 200, -y * 150; return o

# de sleutel die de hub ook leest (hub/td.js)
SLEUTELBESTAND = os.path.join(os.path.expanduser('~'), '.varve-sleutel')
SLEUTEL = ''
try:
    with open(SLEUTELBESTAND) as f: SLEUTEL = f.read().strip()
except Exception: pass
if len(SLEUTEL) < 16 or any(c not in '0123456789abcdef' for c in SLEUTEL):
    SLEUTEL = secrets.token_hex(12)
    try:
        with open(SLEUTELBESTAND, 'w') as f: f.write(SLEUTEL + '\n')
        os.chmod(SLEUTELBESTAND, 0o600)
        say('nieuwe sleutel in %s' % SLEUTELBESTAND)
    except Exception as e:
        say('let op: sleutel niet bewaard (%s); de hub kan dan niet binnen' % e)

# ---------------------------------------------------------------- kanalen ---
FX = ['pixel', 'spiegel', 'rgb', 'kleur', 'sporen', 'korrel']
CH = ['laatst', 'bpm', 'tel', 'fase', 'teller', 'tel1', 'rms', 'laag', 'midden', 'hoog', 'toon_n', 'toon_b']
for l in (1, 2):
    CH += ['l%d_aan' % l, 'l%d_dekking' % l] + ['l%d_k%d' % (l, k) for k in range(6)]
CH += ['fx_' + f for f in FX]

raw = place(V.create(constantCHOP, 'binnen'), 0, 0)
kanalen(raw, CH)

# testbron: 124 bpm, tel 1 t/m 4, energie die ademt, toon 8B en dan verder over het wiel
test = place(V.create(scriptCHOP, 'testbron'), 0, 1)
test_cb = place(V.create(textDAT, 'testbron_code'), 0, 2)
test_cb.text = '''import math
CH = __CH__
def onCook(scriptOp):
    scriptOp.clear()
    t = absTime.seconds
    tellen = t * 124.0 / 60.0
    vals = dict((n, 0.0) for n in CH)
    vals.update({'bpm': 124.0, 'fase': tellen % 1.0, 'tel': int(tellen) % 4 + 1, 'teller': int(tellen),
                 'tel1': 1.0 if int(tellen) % 4 == 0 and tellen % 1.0 < 0.08 else 0.0,
                 'rms': 0.5 + 0.3 * math.sin(t * 0.5), 'laag': 0.6, 'midden': 0.4, 'hoog': 0.3,
                 'toon_n': 8 + int(t / 8.0) % 5, 'toon_b': 1, 'l1_aan': 1, 'l1_dekking': 0.8,
                 'laatst': t})
    scriptOp.numSamples = 1
    for k in CH:
        c = scriptOp.appendChan(k); c[0] = vals[k]
    return
'''.replace('__CH__', repr(CH))
setpar(test, callbacks=test_cb)

# schakelaar: komt er 3 seconden geen stand van VARVE, dan de testbron
# (een verborgen, stil tabblad stuurt soms maar één keer per seconde)
sw = place(V.create(switchCHOP, 'bron'), 1, 0)
sw.inputConnectors[0].connect(test)
sw.inputConnectors[1].connect(raw)
zet(sw, 'index', "1 if absTime.seconds - float(op('binnen')['laatst']) < 3.0 else 0", expr=True)
kan = place(V.create(nullCHOP, 'kanalen'), 2, 0)
kan.inputConnectors[0].connect(sw)
say('kanalen klaar: gebruik op("%s/kanalen")["fase"] enz.' % V.path)

# tekst: maat, toonsoort per deck, titels, systemen van de vormlagen
tekst = place(V.create(tableDAT, 'tekst'), 0, 4)
tekst.clear(); tekst.appendRow(['sleutel', 'waarde'])

# ------------------------------------------------------------- webserver ---
cb = place(V.create(textDAT, 'server_callbacks'), 2, 3)
cb.text = '''import json
CH = __CH__
SLEUTEL = '__SLEUTEL__'
IDX = dict((n, i) for i, n in enumerate(CH))   # het bouwscript maakt de kanalen in deze volgorde
def _set(name, val):
    i = IDX.get(name)
    if i is None or val is None: return
    p = op('binnen').par['const%dvalue' % i]
    if p is not None:
        try: p.val = float(val)
        except (TypeError, ValueError): pass
def _get(name):
    p = op('binnen').par['const%dvalue' % IDX[name]]
    return p.eval() if p is not None else 0
def _tekst(k, v):
    t = op('tekst')
    v = '' if v is None else str(v)
    if t.row(k) is None: t.appendRow([k, v])
    else: t[k, 1] = v
def _lees(k):
    t = op('tekst')
    return t[k, 1].val if t.row(k) is not None else ''
def _camelot(c):
    # '8B' -> (8, 1); '11A' -> (11, 0); onbekend -> (0, 0)
    try:
        c = str(c).strip().upper()
        return int(c[:-1]), (1 if c.endswith('B') else 0)
    except Exception:
        return 0, 0
def onHTTPRequest(webServerDAT, request, response):
    response['statusCode'] = 200; response['statusReason'] = 'OK'
    response['data'] = 'VARVE-koppeling draait. De hub verbindt via ws://127.0.0.1:__PORT__'
    return response
def onWebSocketOpen(webServerDAT, client, uri):
    # alleen de hub kent de sleutel (ws://127.0.0.1:__PORT__/<sleutel>); de rest tellen we niet mee
    if uri and SLEUTEL not in str(uri):
        print('[varve] verbinding zonder sleutel genegeerd:', client); return
    if not uri: print('[varve] let op: TD gaf geen pad door, sleutelcheck kan niet; verbinding toegelaten')
    cl = list(webServerDAT.fetch('clients', [])); cl.append(client); webServerDAT.store('clients', cl)
    print('[varve] hub verbonden:', client)
def onWebSocketClose(webServerDAT, client):
    cl = [c for c in webServerDAT.fetch('clients', []) if c != client]; webServerDAT.store('clients', cl)
    print('[varve] hub weg')
def onWebSocketReceiveText(webServerDAT, client, data):
    if client not in webServerDAT.fetch('clients', []): return
    try: m = json.loads(data)
    except Exception: return
    baan = m.get('baan'); t = m.get('type')
    if baan == 'muziek' and t == 'stand':
        _set('laatst', absTime.seconds)
        for k in ('bpm', 'tel', 'fase'): _set(k, m.get(k))
        e = m.get('energie') or {}
        for k in ('rms', 'laag', 'midden', 'hoog'): _set(k, e.get(k, 0))
        maat = m.get('maat')
        _tekst('maat', maat)
        n, b = _camelot(_lees('toon_%s' % maat))
        _set('toon_n', n); _set('toon_b', b)
    elif baan == 'muziek' and t == 'tel':
        _set('teller', _get('teller') + 1)
        if m.get('tel') == 1: _set('tel1', 1)
    elif baan == 'muziek' and t == 'toon':
        _tekst('toon_%s' % m.get('deck'), m.get('camelot'))
        _tekst('toonnaam_%s' % m.get('deck'), m.get('naam'))
    elif baan == 'muziek' and t == 'nummer':
        _tekst('titel_%s' % m.get('deck'), m.get('titel'))
    elif baan == 'beeld' and t == 'lagen':
        for l in (m.get('lagen') or [])[:2]:
            nr = l.get('nr', 1)
            _set('l%d_aan' % nr, 1 if l.get('aan') else 0)
            _set('l%d_dekking' % nr, l.get('dekking', 0))
            for k, v in enumerate((l.get('knoppen') or [])[:6]): _set('l%d_k%d' % (nr, k), v)
            _tekst('systeem_%d' % nr, l.get('systeem'))
            _tekst('mengvorm_%d' % nr, l.get('mengvorm'))
        fx = (m.get('video') or {}).get('fx') or {}
        for k, v in fx.items(): _set('fx_' + k, v)
    elif baan == 'hub' and t == 'welkom':
        print('[varve] welkom van de hub; apps:', m.get('apps'))
    elif baan == 'apc' and t == 'eigenaar':
        _tekst('apc', m.get('app'))
    return
def onWebSocketReceiveBinary(webServerDAT, client, data): return
def onServerStart(webServerDAT): print('[varve] server op poort __PORT__')
def onServerStop(webServerDAT): print('[varve] server gestopt')
'''.replace('__CH__', repr(CH)).replace('__PORT__', str(PORT)).replace('__SLEUTEL__', SLEUTEL)
srv = place(V.create(webserverDAT, 'server'), 3, 3)
setpar(srv, port=PORT, callbacks=cb)
setpar(srv, active=True)

# terugsturen en de tel-puls maar één frame laten duren
send = place(V.create(executeDAT, 'terug_sturen'), 4, 3)
send.text = '''import json
TEL1 = __TEL1__
def _clients(s):
    return list(s.fetch('clients', []))   # alleen wie de sleutel had (server_callbacks)
def actie(id, waarde):
    # een actie naar VARVE, zoals de action-bus hem kent: waarde 0..1 of True/False
    s = op('server')
    m = json.dumps({'baan': 'acties', 'id': id, 'waarde': waarde})
    for c in _clients(s):
        try: s.webSocketSendText(c, m)
        except Exception: pass
def onFrameEnd(frame):
    p = op('binnen').par['const%dvalue' % TEL1]
    if p is not None: p.val = 0
    return
'''.replace('__TEL1__', str(CH.index('tel1')))
setpar(send, active=True, frameend=True)

# ------------------------------------------------------------------ beeld ---
# Een ring die op elke tel opspringt (op tel 1 het hardst), gekleurd naar de
# toonsoort op het Camelot-wiel: 12 kleuren, majeur (B) lichter dan mineur (A).
PULS = '''uniform vec4 uMaat;   // x fase 0-1, y tel, z bpm, w rms
uniform vec4 uToon;   // x camelot 1-12 (0 = onbekend), y 1 = B, z laag, w hoog
out vec4 fragColor;
vec3 hsv(float h, float s, float v){
    vec3 k = clamp(abs(mod(h * 6. + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.);
    return v * mix(vec3(1.), k, s);
}
void main(){
    vec2 uv = vUV.st;
    vec2 p = (uv - 0.5) * vec2(uTDOutputInfo.res.z / uTDOutputInfo.res.w, 1.);
    float r = length(p);
    float puls = pow(1. - clamp(uMaat.x, 0., 1.), 4.);
    float accent = uMaat.y < 1.5 ? 1. : 0.55;
    float straal = 0.12 + 0.18 * puls * accent + 0.08 * uToon.z;
    float ring = 1. - smoothstep(0., 0.015, abs(r - straal));
    float bekend = step(0.5, uToon.x);
    vec3 kleur = hsv((uToon.x - 1.) / 12., 0.65 * bekend, 0.55 + 0.45 * uToon.y);
    vec3 col = kleur * (0.06 + 0.10 * uMaat.w);
    col += kleur * ring * (0.6 + 0.4 * puls);
    col += kleur * 0.25 * exp(-r * r * 30.) * uToon.w;
    fragColor = TDOutputSwizzle(vec4(col, 1.));
}
'''
seed = place(V.create(constantTOP, 'leeg'), 0, 6)
setpar(seed, outputresolution='custom', resolutionw=W_RES, resolutionh=H_RES)
code = place(V.create(textDAT, 'puls_glsl'), 1, 7); code.text = PULS
puls = place(V.create(glslTOP, 'puls'), 1, 6)
puls.inputConnectors[0].connect(seed)
setpar(puls, pixeldat=code, outputresolution='custom', resolutionw=W_RES, resolutionh=H_RES)
out = place(V.create(nullTOP, 'beeld'), 2, 6)
out.inputConnectors[0].connect(puls)

def uniform(glsl, idx, name, exprs):
    blokken(glsl, 'vec', idx + 1)
    zet(glsl, 'vec%dname' % idx, name)
    for comp, e in zip('xyzw', exprs):
        zet(glsl, 'vec%dvalue%s' % (idx, comp), e, expr=True)
K = "op('kanalen')"
# fase doorrekenen vanaf de laatste stand (bpm/60 tellen per seconde), zodat de puls niet in stapjes van 33 ms gaat
FASE = "(%s['fase'] + max(0.0, min(0.5, absTime.seconds - %s['laatst'])) * %s['bpm'] / 60.0) %% 1.0" % (K, K, K)
uniform(puls, 0, 'uMaat', [FASE, K + "['tel']", K + "['bpm']", K + "['rms']"])
uniform(puls, 1, 'uToon', [K + "['toon_n']", K + "['toon_b']", K + "['laag']", K + "['hoog']"])

try: say('TouchDesigner %s.%s' % (app.version, app.build))
except Exception: pass
say('%d waarschuwingen' % sum(1 for l in log if l.startswith('let op')))
say('klaar. Open %s/beeld. Zonder VARVE draait de testbron (124 bpm, 8B).' % V.path)
say('Start daarna de hub op de Mac: node hub/index.js  (hij zoekt TD op ws://127.0.0.1:%d)' % PORT)
if any(l.startswith('let op') for l in log):
    say('Er waren waarschuwingen hierboven. Stuur de Textport-uitvoer naar Claude, dan pas ik het script aan.')
