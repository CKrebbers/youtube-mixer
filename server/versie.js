import { execFile } from 'node:child_process';

/**
 * Welke versie draait er (16 okt, Clay: "hoe kan ik snel en makkelijk zien dat ik in de juiste laatste
 * versie zit?"). Drie dingen, voor de tegel Versie in de Controlekamer (src/controle/versie-tegel.js):
 *
 *   draait    de commit waarmee DEZE server startte (bij het opstarten gelezen)
 *   opSchijf  de commit die nu op schijf staat: anders dan draait = na git pull nog niet herstart
 *   github    de commit van main op GitHub (git ls-remote): verder = git pull
 *
 * Alles via git in een KINDPROCES (execFile, met een time-out): nooit fs in de server zelf, dus de
 * draadpool van de decks blijft vrij (de grens van 2 lezers in standen.js geldt hier niet), en de event
 * loop wacht nergens op. GitHub hooguit eens per 10 min (tenzij `vers`), nooit met een wachtwoordvraag
 * (GIT_TERMINAL_PROMPT=0, ssh BatchMode): zonder netwerk zegt hij "niet bereikt", meer niet.
 */

export const SCHIJF_MS = 15_000;
export const GITHUB_MS = 10 * 60_000;
export const GIT_TIJD_MS = 4000;
export const GITHUB_TIJD_MS = 10_000;
const SCHEIDING = '\x1f';

/** execFile als belofte: { code, uit, fout }; gooit nooit. */
function draai(git, args, { map, ms }) {
  return new Promise((klaar) => {
    execFile(git, args, {
      cwd: map, timeout: ms, maxBuffer: 1 << 20, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes', LC_ALL: 'C' },
    }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : err.killed ? 'tijd' : 'start') : 0;
      klaar({ code, uit: String(stdout ?? '').trim(), fout: String(stderr ?? '').trim() || (err && !stderr ? err.message : '') });
    });
  });
}

/** Uit `git log -1 --format=%H%x1f%h%x1f%cI%x1f%s`. Puur. */
export function leesKop(tekst) {
  const [commit, kort, datum, onderwerp] = String(tekst ?? '').split(SCHEIDING);
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) return null;
  return { commit, kort, datum, onderwerp: onderwerp ?? '' };
}

/** Uit `git ls-remote <remote> refs/heads/<tak>`: de commit, of null. Puur. */
export function leesRemote(tekst, tak = 'main') {
  for (const regel of String(tekst ?? '').split('\n')) {
    const [commit, ref] = regel.trim().split(/\s+/);
    if (ref === `refs/heads/${tak}` && /^[0-9a-f]{40}$/.test(commit)) return commit;
  }
  return null;
}

export class Versie {
  /**
   * @param {object} o
   * @param {string} o.map       de projectmap (de git-werkmap)
   * @param {string} [o.git]     het git-programma (een ander pad in de test)
   * @param {string} [o.remote]  origin
   * @param {string} [o.tak]     main: de tak die je hoort te draaien
   * @param {() => number} [o.klok]
   */
  constructor({ map, git = 'git', remote = 'origin', tak = 'main', klok = Date.now } = {}) {
    Object.assign(this, { map, git, remote, tak, klok });
    this.draait = null;        // { commit, kort, datum, onderwerp, tak } of null (geen git)
    this.startFout = null;
    this._schijf = null; this._schijfT = -Infinity; this._schijfBezig = null;
    this._github = null; this._githubT = -Infinity; this._githubBezig = null;
  }

  _git(args, ms = GIT_TIJD_MS) { return draai(this.git, args, { map: this.map, ms }); }

  /** De kop van de werkmap: commit, tak, en hoeveel gevolgde bestanden er gewijzigd zijn. */
  async _kop() {
    const [log, tak, status] = await Promise.all([
      this._git(['log', '-1', '--format=%H%x1f%h%x1f%cI%x1f%s']),
      this._git(['rev-parse', '--abbrev-ref', 'HEAD']),
      this._git(['status', '--porcelain', '--untracked-files=no']),
    ]);
    if (log.code !== 0) return { fout: log.code === 'start' ? 'git niet gevonden' : (log.fout.split('\n')[0] || `git gaf ${log.code}`) };
    const kop = leesKop(log.uit);
    if (!kop) return { fout: 'geen commit gelezen' };
    return { ...kop, tak: tak.code === 0 ? tak.uit : null, gewijzigd: status.code === 0 ? status.uit.split('\n').filter(Boolean).length : null };
  }

  /** Bij het opstarten: welke commit draait er. Gooit nooit. */
  async start() {
    const k = await this._kop();
    if (k.fout) this.startFout = k.fout; else this.draait = k;
    return this;
  }

  async _opSchijf(vers) {
    if (!vers && this.klok() - this._schijfT < SCHIJF_MS && this._schijf) return this._schijf;
    this._schijfBezig ??= this._kop().then((k) => { this._schijf = k; this._schijfT = this.klok(); return k; }).finally(() => { this._schijfBezig = null; });
    return this._schijfBezig;
  }

  async _vanGithub(vers) {
    if (!vers && this.klok() - this._githubT < GITHUB_MS && this._github) return this._github;
    this._githubBezig ??= (async () => {
      const r = await this._git(['ls-remote', '--heads', this.remote, `refs/heads/${this.tak}`], GITHUB_TIJD_MS);
      const t = this.klok();
      let uit;
      if (r.code !== 0) uit = { bereikt: false, reden: r.code === 'tijd' ? `geen antwoord binnen ${GITHUB_TIJD_MS / 1000} s` : (r.fout.split('\n')[0] || `git gaf ${r.code}`), t };
      else {
        const commit = leesRemote(r.uit, this.tak);
        uit = commit ? { bereikt: true, commit, kort: commit.slice(0, 7), t } : { bereikt: false, reden: `geen tak ${this.tak} op ${this.remote}`, t };
      }
      this._github = uit; this._githubT = t;
      return uit;
    })().finally(() => { this._githubBezig = null; });
    return this._githubBezig;
  }

  /** Staat wat op GitHub staat al in wat hier staat? Lokaal (merge-base), bij elke stand: HEAD kan intussen verschoven zijn. */
  async _verhouding(gh, kop) {
    if (!gh?.bereikt || !kop?.commit) return null;
    if (gh.commit === kop.commit) return 'gelijk';
    // Exit 0 = ja (hier verder: nog niet gepusht), 1 = nee, 128 = die commit is hier onbekend (dus nee).
    const a = await this._git(['merge-base', '--is-ancestor', gh.commit, kop.commit]);
    return a.code === 0 ? 'hier verder' : 'github verder';
  }

  /**
   * GET /api/versie: { draait, opSchijf, tak, github }. `github: false` = niet vragen (de laatste
   * bekende blijft erin), `vers` = niet uit het geheugen. Gooit nooit.
   */
  async stand({ github = true, vers = false } = {}) {
    const opSchijf = await this._opSchijf(vers);
    const gh = github ? await this._vanGithub(vers) : this._github;
    const verhouding = await this._verhouding(gh, opSchijf.fout ? null : opSchijf);
    return { draait: this.draait, startFout: this.startFout, opSchijf, hoortTak: this.tak, github: gh ? { ...gh, verhouding } : null };
  }
}
