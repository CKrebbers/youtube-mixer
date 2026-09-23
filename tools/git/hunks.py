import subprocess, sys, re, json
import os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
def git(*a, inp=None):
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, input=inp, check=True).stdout
def hunks(path):
    d = git("diff", "-U0", "HEAD", "--", path).decode()
    hs = []
    for m in re.finditer(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*\n((?:[-+\\].*\n?)*)", d, re.M):
        os_, ol = int(m[1]), int(m[2]) if m[2] is not None else 1
        body = m[5].splitlines()
        hs.append(dict(os=os_, ol=ol, rem=[l[1:] for l in body if l.startswith('-')], add=[l[1:] for l in body if l.startswith('+')]))
    return hs
def build(path, sel):
    base = git("show", f"HEAD:{path}").decode().split('\n')
    hs = hunks(path)
    for i in sorted(sel, reverse=True):
        h = hs[i]
        start = h['os'] - 1 if h['ol'] > 0 else h['os']
        assert base[start:start+h['ol']] == h['rem'], (path, i)
        base[start:start+h['ol']] = h['add']
    return '\n'.join(base)
def stage(path, content):
    sha = git("hash-object", "-w", "--stdin", inp=content.encode()).decode().strip()
    git("update-index", "--add", "--cacheinfo", f"100644,{sha},{path}")
if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "list":
        for i, h in enumerate(hunks(sys.argv[2])):
            first = (h['add'] or h['rem'] or [''])
            print(i, f"-{h['os']},{h['ol']}", '|', ' ⏎ '.join(x.strip() for x in (h['add'][:3] if h['add'] else ['DEL: '+h['rem'][0]]))[:150])
    elif cmd == "stage":
        path, sel = sys.argv[2], json.loads(sys.argv[3])
        stage(path, build(path, sel))
    elif cmd == "stagefile":
        stage(sys.argv[2], open(sys.argv[3]).read())
    elif cmd == "strip":
        # eindversie min regelbereiken ("a-b,c-d"), 1-based inclusief
        path = sys.argv[2]
        lines = open(f"{ROOT}/{path}").read().split('\n')
        weg = set()
        for r in sys.argv[3].split(','):
            a, b = (r.split('-') + [r])[:2]
            weg.update(range(int(a), int(b) + 1))
        stage(path, '\n'.join(l for i, l in enumerate(lines, 1) if i not in weg))
