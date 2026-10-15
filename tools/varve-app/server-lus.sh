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
# Nooit twee servers op één poort: vóór elke start kijkt de lus of er al iets luistert. Luistert er
# iets (een server die je met de hand startte, of de LaunchAgent uit docs/TAILSCALE.md), dan start
# hij niets en stopt hij. Gebruik de lus en de LaunchAgent dus nooit samen.
#
# POSIX sh (geen zsh), zodat de test hem ook op Linux kan draaien (test/server-lus.test.mjs).
# Instelbaar (voor de test): PORT, VARVE_LUS_PID, VARVE_LUS_MAX, VARVE_LUS_VENSTER (s), VARVE_LUS_WACHT (s).

POORT=${PORT:-8777}
PIDBESTAND=${VARVE_LUS_PID:-$HOME/.varve/server-lus.pid}
MAX=${VARVE_LUS_MAX:-5}
VENSTER=${VARVE_LUS_VENSTER:-60}
WACHT=${VARVE_LUS_WACHT:-1}
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

kind=
stoppen=
op_te_ruimen() { [ "$(head -n 1 "$PIDBESTAND" 2>/dev/null)" = "$$" ] && rm -f "$PIDBESTAND"; }
stop_kind() { stoppen=1; [ -n "$kind" ] && kill -TERM "$kind" 2>/dev/null; }
trap stop_kind TERM INT HUP
trap op_te_ruimen EXIT

cd "$MAP" || { log "de map $MAP bestaat niet"; exit 1; }
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
  node server/index.js < /dev/null &
  kind=$!
  log "server gestart (pid $kind)$([ $herstarts -gt 0 ] && echo " — herstart $herstarts")"
  # wait wordt onderbroken door een signaal (de trap); dan opnieuw wachten op het echte einde.
  while :; do
    wait "$kind"
    code=$?
    kill -0 "$kind" 2>/dev/null || break
  done
  kind=
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
  log "de server viel om (exitcode $code): over $WACHT s opnieuw ($((aantal + 1))/$MAX in $VENSTER s)"
  sleep "$WACHT"
done
}

hoofd "$@"
exit $?
