#!/bin/sh
# De Varve-server in een herstartlus (docs/WINST.md punt 3, "de server mag even weg zijn").
#
#   sh tools/varve-app/server-lus.sh          start de lus (VARVE.app doet dit, met nohup en &)
#   sh tools/varve-app/server-lus.sh stop     stopt de lus én de server (via het pidbestand)
#   sh tools/varve-app/server-lus.sh status   draait hij? (exit 0 = ja)
#
# Valt de server om (een native fout, geheugen op, een SIGKILL), dan start de lus hem na 1 s opnieuw:
# de decks hebben 60 s vooruit staan (stream-kern.js) en de opname wacht (opnemer.js), dus een
# herstart van ~1 s hoort niemand. Hooguit 5 herstarts per minuut; vaker = een crash-lus, en die
# moet je zien: de lus stopt en schrijft waarom in het log (~/.varve-server.log via VARVE.app).
#
# Wat NIET opnieuw start (bewust gestopt, of een fout die opnieuw proberen niet oplost):
#   exitcode 0                         de server stopte zelf netjes
#   SIGTERM, SIGINT, SIGHUP (143/130/129)  iemand stopte hem: `pkill -f server/index.js` werkt dus nog
#   exitcode 3                         de poort is bezet (een andere server; server/index.js)
# Een server die HANGT (AR18: de poort open, geen antwoord; SIGSTOP, een event loop die vastzit) stopt niet
# vanzelf. Daarom peilt een wachter naast de server elke 5 s GET /api/leeft (antwoord uit het geheugen, 2 s
# wachten). Drie keer niets = hij hangt: de wachter schrijft het in het log, doet kill -9 op de server en op
# wat die zelf startte (ffmpeg, yt-dlp, Demucs: anders blijven ze als wezen draaien), en de lus start hem
# opnieuw zoals na elke crash (telt mee in de 5 per minuut). Van hangen tot weer een server: ~15–22 s; de decks
# hebben 60 s vooruit. Een nieuwe server telt pas mee na zijn eerste antwoord, of na 120 s zonder antwoord.
# Zonder curl geen wachter (de lus zegt het één keer). Een schijf die hangt ziet de wachter bewust niet: de
# route raakt de schijf niet, en een herstart lost dat niet op.
# Nooit twee servers op één poort: vóór elke start kijkt de lus of er al iets luistert. Luistert er
# iets (een server die je met de hand startte, of een oude LaunchAgent die node zelf start), dan start
# hij niets en stopt hij. De LaunchAgent uit docs/TAILSCALE.md start sinds AR8 deze lus (zonder KeepAlive):
# draait die al, dan zegt een tweede lus (VARVE.app) "draait al" en doet niets.
#
# POSIX sh (geen zsh), zodat de test hem ook op Linux kan draaien (test/server-lus.test.mjs).
# Wat de lus van zijn herstarts weet, krijgt elke nieuwe server mee in zijn omgeving (AR9): VARVE_LUS_SINDS (de start
# van de lus, s sinds 1970), VARVE_LUS_AANTAL (herstarts sindsdien) en VARVE_LUS_HERSTARTS (de laatste 20 als
# "<s>:<exitcode>:om|hang", spatie ertussen). De server geeft het door in GET /api/leeft; de tegel Server toont het.
# Een hang meldt de wachter met een merkbestand naast het pidbestand (<pidbestand>.hang): de lus ziet anders alleen 137.
#
# Instelbaar (voor de test): PORT, VARVE_LUS_PID, VARVE_LUS_MAX, VARVE_LUS_VENSTER (s), VARVE_LUS_WACHT (s),
# en voor de wachter VARVE_LUS_PEIL (s), VARVE_LUS_PEIL_MAX (s), VARVE_LUS_MIS, VARVE_LUS_OPSTART (s).

POORT=${PORT:-8777}
PIDBESTAND=${VARVE_LUS_PID:-$HOME/.varve/server-lus.pid}
MAX=${VARVE_LUS_MAX:-5}
VENSTER=${VARVE_LUS_VENSTER:-60}
WACHT=${VARVE_LUS_WACHT:-1}
PEIL=${VARVE_LUS_PEIL:-5}
PEIL_MAX=${VARVE_LUS_PEIL_MAX:-2}
MIS=${VARVE_LUS_MIS:-3}
OPSTART=${VARVE_LUS_OPSTART:-120}
MAP=$(cd "$(dirname "$0")/../.." && pwd)

log() { echo "[lus] $(date '+%d-%m %H:%M:%S') $*"; }

# Luistert er al iets op de poort? lsof (macOS, de meeste Linuxen), anders nc, anders curl.
poort_bezet() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -t -iTCP:"$POORT" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$POORT" >/dev/null 2>&1
    return $?
  fi
  curl -s -m 1 -o /dev/null "http://127.0.0.1:$POORT/" >/dev/null 2>&1
  [ $? -ne 7 ]                          # 7 = geen verbinding: niets luistert
}

# Leeft dit proces nog? Een zombie (al gestopt, nog niet opgeruimd door zijn ouder) telt niet.
leeft() {
  kill -0 "$1" 2>/dev/null || return 1
  case $(ps -p "$1" -o stat= 2>/dev/null) in Z*) return 1 ;; esac
  return 0
}

# Het pid van een lus die nog leeft (en echt deze lus is: een pid kan hergebruikt zijn), of niets.
lus_pid() {
  [ -s "$PIDBESTAND" ] || return 1
  p=$(head -n 1 "$PIDBESTAND")
  case $p in ''|*[!0-9]*) return 1 ;; esac
  leeft "$p" || return 1
  ps -p "$p" -o args= 2>/dev/null | grep -q 'server-lus' || return 1
  echo "$p"
}

# Alle processen die $1 startte, en wat die weer startten (pgrep -P; de kinderen vóór hun kleinkinderen).
nazaten() {
  for k in $(pgrep -P "$1" 2>/dev/null); do echo "$k"; nazaten "$k"; done
}

# De wachter (AR18): draait naast server $1 tot die weg is. Zie bovenaan.
wachter() {
  srv=$1
  begon=$(date +%s)
  geantwoord=
  mis=0
  laatst=$(date '+%H:%M:%S')            # het laatste antwoord (of de start): de hang begon daarna
  while :; do
    sleep "$PEIL" >/dev/null 2>&1
    leeft "$srv" || exit 0
    if curl -fs -m "$PEIL_MAX" -o /dev/null "http://127.0.0.1:$POORT/api/leeft" >/dev/null 2>&1; then
      geantwoord=1; mis=0; laatst=$(date '+%H:%M:%S')
      continue
    fi
    # Een server die nog opstart (de library openen, migraties) krijgt de tijd tot zijn eerste antwoord.
    [ -z "$geantwoord" ] && [ $(($(date +%s) - begon)) -lt "$OPSTART" ] && continue
    mis=$((mis + 1))
    [ $mis -lt "$MIS" ] && continue
    # Nog dezelfde server (een pid kan hergebruikt zijn)? Dan eerst zijn nazaten opzoeken (na de kill -9
    # zijn ze van init en vindt pgrep -P ze niet meer), dan de server, dan de nazaten.
    leeft "$srv" || exit 0
    ps -p "$srv" -o args= 2>/dev/null | grep -q 'server/index.js' || exit 0
    weg=$(nazaten "$srv")
    : > "$PIDBESTAND.hang"
    log "de server antwoordt niet (laatste antwoord $laatst, $mis keer niets op /api/leeft binnen $PEIL_MAX s, pid $srv): kill -9$([ -n "$weg" ] && echo " (en $(echo $weg | wc -w | tr -d ' ') die hij startte)"), de lus start hem opnieuw"
    kill -KILL "$srv" 2>/dev/null
    [ -n "$weg" ] && kill -KILL $weg 2>/dev/null
    exit 0
  done
}

# Alles hieronder in één functie: sh leest hem dan helemaal in voordat hij begint. Bash (macOS /bin/sh)
# leest een script anders stuk voor stuk terwijl het loopt, en een `git pull` die dit bestand verandert
# terwijl de lus draait, zou de lopende lus dan breken.
hoofd() {
case ${1:-start} in
  stop)
    if ! p=$(lus_pid); then echo "de lus draait niet (geen levend pid in $PIDBESTAND)"; exit 0; fi
    kill -TERM "$p" 2>/dev/null
    # De server krijgt SIGTERM van de lus en ruimt eerst op (een split: hooguit 5 s).
    n=0
    while leeft "$p" && [ $n -lt 100 ]; do sleep 0.1; n=$((n + 1)); done
    if leeft "$p"; then echo "de lus ($p) stopt niet na 10 s"; exit 1; fi
    echo "lus en server gestopt"
    exit 0
    ;;
  status)
    if p=$(lus_pid); then echo "de lus draait (pid $p)"; exit 0; fi
    echo "de lus draait niet"; exit 1
    ;;
  start) ;;
  *) echo "gebruik: sh $0 [start|stop|status]" >&2; exit 2 ;;
esac

if p=$(lus_pid); then log "draait al (pid $p): niets gestart"; exit 0; fi
mkdir -p "$(dirname "$PIDBESTAND")"
echo $$ > "$PIDBESTAND"
rm -f "$PIDBESTAND.hang"
sinds=$(date +%s)
geschiedenis=                           # de laatste 20 herstarts, "<s>:<exitcode>:om|hang"

kind=
wpid=
stoppen=
op_te_ruimen() { [ "$(head -n 1 "$PIDBESTAND" 2>/dev/null)" = "$$" ] && rm -f "$PIDBESTAND" "$PIDBESTAND.hang"; }
stop_wachter() { [ -n "$wpid" ] && kill -TERM "$wpid" 2>/dev/null; wpid=; }
stop_kind() { stoppen=1; stop_wachter; [ -n "$kind" ] && kill -TERM "$kind" 2>/dev/null; }
trap stop_kind TERM INT HUP
trap op_te_ruimen EXIT

cd "$MAP" || { log "de map $MAP bestaat niet"; exit 1; }
command -v curl >/dev/null 2>&1 || log "geen curl: geen wachter, een server die hangt wordt niet herstart (AR18)"
crashes=                                # momenten (date +%s) van herstarts binnen het venster
herstarts=0
while :; do
  # Nooit twee servers: luistert er al iets (een server die nog opstart, een LaunchAgent), dan niet.
  # Na een crash even wachten tot de poort vrij is.
  n=0
  while poort_bezet && [ $n -lt 50 ]; do
    [ $herstarts -eq 0 ] && break
    sleep 0.1; n=$((n + 1))
  done
  if poort_bezet; then
    log "op poort $POORT luistert al iets: geen tweede server, de lus stopt (draait de LaunchAgent?)"
    exit 3
  fi
  [ -n "$stoppen" ] && exit 0
  # Wat de lus weet, voor deze server (AR9, server/lus.js): de omgeving van de lus blijft verder zoals hij is.
  VARVE_LUS_SINDS=$sinds VARVE_LUS_AANTAL=$herstarts VARVE_LUS_HERSTARTS=$geschiedenis
  export VARVE_LUS_SINDS VARVE_LUS_AANTAL VARVE_LUS_HERSTARTS
  node server/index.js < /dev/null &
  kind=$!
  log "server gestart (pid $kind)$([ $herstarts -gt 0 ] && echo " — herstart $herstarts")"
  if command -v curl >/dev/null 2>&1; then wachter "$kind" & wpid=$!; fi
  # wait wordt onderbroken door een signaal (de trap); dan opnieuw wachten op het echte einde.
  while :; do
    wait "$kind"
    code=$?
    kill -0 "$kind" 2>/dev/null || break
  done
  stop_wachter
  kind=
  soort=om
  if [ -f "$PIDBESTAND.hang" ]; then soort=hang; rm -f "$PIDBESTAND.hang"; fi
  if [ -n "$stoppen" ]; then log "gestopt (server exitcode $code)"; exit 0; fi
  case $code in
    0) log "de server stopte netjes: de lus stopt ook"; exit 0 ;;
    129|130|143) log "de server is gestopt (signaal $((code - 128))): niet opnieuw gestart"; exit 0 ;;
    3) log "de poort is bezet (exitcode 3): niet opnieuw gestart"; exit 3 ;;
  esac
  nu=$(date +%s)
  binnen=
  aantal=0
  for t in $crashes; do
    if [ $((nu - t)) -lt "$VENSTER" ]; then binnen="$binnen $t"; aantal=$((aantal + 1)); fi
  done
  if [ $aantal -ge "$MAX" ]; then
    log "de server viel om (exitcode $code) en is al $aantal keer herstart in $VENSTER s: de lus stopt. Kijk hierboven waarom."
    exit 1
  fi
  crashes="$binnen $nu"
  herstarts=$((herstarts + 1))
  geschiedenis=$(echo $geschiedenis "$nu:$code:$soort" | tr ' ' '\n' | tail -n 20 | tr '\n' ' ' | sed 's/ $//')
  log "de server viel om (exitcode $code): over $WACHT s opnieuw ($((aantal + 1))/$MAX in $VENSTER s)"
  sleep "$WACHT"
done
}

hoofd "$@"
exit $?
