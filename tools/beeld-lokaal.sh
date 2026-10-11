#!/bin/zsh
# Beeld op één machine (docs/BEELD.md §8, spoor beeld-een-machine): de relay en de
# Stroommachine op DEZE Mac, naast VARVE. Dit is de upgrade-route; de standaard voor
# "ergens heen met alleen de laptop" is het zaalbeeld (docs/BEAMER.md "Zaalbeeld"),
# en dat heeft dit script niet nodig.
#
#   zsh tools/beeld-lokaal.sh [--stand licht|normaal|auto] [--stroom <map>] [--poort 7702]
#                             [--geen-fps] [--droog] [--stop] [--installeer]
#
# Wat het doet:
#   1. Kijkt of de VARVE-server antwoordt (/api/proef, zoals VARVE.app). Zo niet:
#      "klik eerst VARVE.app". Dit script start de server NOOIT.
#   2. De relay uit de Stroommachine-repo op --poort (127.0.0.1), ZONDER --stil, de
#      uitvoer naar ~/.varve-relay.log, het pid in ~/.varve-beeld-lokaal.pid. Draait er
#      al een varve-relay op die poort, dan die. Iets anders op de poort: stop.
#   3. De Stroommachine in een EIGEN Chrome-bundel (~/Applications/Stroommachine-Chrome.app,
#      een kopie van Chrome for Testing, zie --installeer): een tweede "Google Chrome"
#      zou VARVE.app de verkeerde Chrome laten aanspreken. Eigen profiel
#      (~/.varve-stroom-chrome), app-venster, debugpoort 9393 op 127.0.0.1 voor
#      `node tools/headless/beeld-lokaal.mjs --kijk`. Standaard Licht, met de fps-meter
#      (&fps: een klein vak boven het canvas, niet in een opname); --geen-fps zonder.
#   4. Drukt af wat jij daarna doet (vijf regels).
#
#   --droog       alleen de controles (elk "ok" of "zou stoppen") en wat het zou starten,
#                 met de volledige URL. Start niets, schrijft niets. Exit 0.
#   --stop        stopt ALLEEN wat dit script startte: de relay uit het pid-bestand (als
#                 dat proces nog varve-relay.js is) en de Chrome met het eigen profiel
#                 (het browserproces, niet de helpers). Nooit pkill.
#   --installeer  kopieert Chrome for Testing uit de Playwright-cache naar de eigen
#                 bundel (ditto). WEIGERT als de bundle-id com.google.Chrome is: dan is
#                 het dezelfde bundel als Clay's Chrome. Overschrijft nooit een bestaande.
#
# Omgeving (vooral voor test/beeld-lokaal.test.mjs): VARVE_BL_SERVER (8777),
#   VARVE_STROOM_REPO (~/Projects/stroommachine), VARVE_BL_BUNDEL, VARVE_BL_PROFIEL,
#   VARVE_BL_PID, VARVE_BL_LOG, VARVE_BL_KIJK_DEBUG (9393), VARVE_BL_CFT (de bron voor
#   --installeer), VARVE_BL_OPEN (in plaats van /usr/bin/open), VARVE_NODE.
#
# Exit: 0 klaar (of droog), 1 een controle hield het tegen, 2 verkeerd gebruik.
emulate -L zsh
setopt pipe_fail

stand=licht
poort=7702
fps=1
modus=start
stroom=${VARVE_STROOM_REPO:-$HOME/Projects/stroommachine}
server=${VARVE_BL_SERVER:-8777}
bundel=${VARVE_BL_BUNDEL:-$HOME/Applications/Stroommachine-Chrome.app}
profiel=${VARVE_BL_PROFIEL:-$HOME/.varve-stroom-chrome}
pidbestand=${VARVE_BL_PID:-$HOME/.varve-beeld-lokaal.pid}
log=${VARVE_BL_LOG:-$HOME/.varve-relay.log}
kijk=${VARVE_BL_KIJK_DEBUG:-9393}
opener=${VARVE_BL_OPEN:-/usr/bin/open}
node=${VARVE_NODE:-${commands[node]:-}}

gebruik() {
  print -u2 "gebruik: zsh tools/beeld-lokaal.sh [--stand licht|normaal|auto] [--stroom <map>] [--poort 7702] [--geen-fps] [--droog] [--stop] [--installeer]"
  exit 2
}

while (( $# )); do
  case $1 in
    --stand) (( $# >= 2 )) || gebruik; stand=$2; shift 2 ;;
    --stroom) (( $# >= 2 )) || gebruik; stroom=$2; shift 2 ;;
    --poort) (( $# >= 2 )) || gebruik; poort=$2; shift 2 ;;
    --geen-fps) fps=0; shift ;;
    --droog) modus=droog; shift ;;
    --stop) modus=stop; shift ;;
    --installeer) modus=installeer; shift ;;
    -h|--help) sed -n '2,38p' -- "$0"; exit 0 ;;
    *) print -u2 "onbekend: $1"; gebruik ;;
  esac
done
[[ $stand == (licht|normaal|auto) ]] || { print -u2 "--stand: licht, normaal of auto (niet \"$stand\")"; exit 2 }
[[ $poort == <1-65535> ]] || { print -u2 "--poort: een getal van 1 tot 65535 (niet \"$poort\")"; exit 2 }
stroom=${stroom:a}

# ---- hulpjes -------------------------------------------------------------------------

zou_stoppen=0
ok() { print -r -- "  ok    $1" }
# Een controle die het tegenhoudt: droog = melden en doorgaan, anders stoppen (exit 1).
stop() {
  if [[ $modus == droog ]]; then print -r -- "  zou stoppen: $1"; zou_stoppen=1
  else print -ru2 -- "STOP  $1"; exit 1; fi
}
bundle_id() { /usr/bin/plutil -extract CFBundleIdentifier raw -- "$1/Contents/Info.plist" 2>/dev/null }
luistert() { /usr/sbin/lsof -nP -t -iTCP:$1 -sTCP:LISTEN 2>/dev/null | head -1 }
# (Geen `| grep -q` en geen return midden in een pijp: met pipe_fail telt dan de SIGPIPE van de schrijver.)
is_relay() { local s; s=$(curl -sf -m 1 "http://127.0.0.1:$1/status.json" 2>/dev/null) && [[ $s == *'"relay":"varve-relay"'* ]] }
# Het browserproces van de Stroommachine: draagt ons profiel, en is geen helper (--type=).
stroom_pid() {
  local pid cmd gevonden=
  ps -axo pid=,command= | while read -r pid cmd; do
    if [[ $cmd == *"--user-data-dir=$profiel"(| *) && $cmd != *--type=* ]]; then gevonden=$pid; break; fi
  done
  [[ -n $gevonden ]] && print -r -- $gevonden
}

# ---- --installeer ----------------------------------------------------------------------

if [[ $modus == installeer ]]; then
  if [[ -e $bundel ]]; then
    oud=$(bundle_id "$bundel")
    if [[ $oud == com.google.Chrome ]]; then
      print -u2 "$bundel bestaat al, maar met bundle-id com.google.Chrome (Clay's Chrome): zet hem zelf opzij (ik verwijder niets) en draai --installeer opnieuw"
      exit 1
    fi
    print -r -- "bestaat al: $bundel (bundle-id ${oud:-?}): niets gedaan, niets overschreven"
    exit 0
  fi
  bron=${VARVE_BL_CFT:-}
  if [[ -z $bron ]]; then
    local -a kandidaten
    kandidaten=( $HOME/Library/Caches/ms-playwright/chromium-<->/chrome-mac-arm64/"Google Chrome for Testing.app"(Nn/) )
    bron=${kandidaten[-1]:-}
  fi
  [[ -n $bron && -d $bron ]] || { print -u2 "geen Chrome for Testing gevonden (npx playwright install chromium, of VARVE_BL_CFT=<pad naar de .app>)"; exit 1 }
  id=$(bundle_id "$bron")
  [[ -n $id ]] || { print -u2 "geen bundle-id in $bron/Contents/Info.plist: niets gekopieerd"; exit 1 }
  if [[ $id == com.google.Chrome ]]; then
    print -u2 "WEIGER: $bron heeft bundle-id com.google.Chrome, dezelfde bundel als Clay's Chrome (VARVE.app zou de verkeerde kunnen aanspreken): niets gekopieerd"
    exit 1
  fi
  mkdir -p -- "${bundel:h}" || exit 1
  /usr/bin/ditto -- "$bron" "$bundel" || { print -u2 "ditto mislukte"; exit 1 }
  print -r -- "geïnstalleerd: $bundel (bundle-id $id, gekopieerd uit $bron)"
  exit 0
fi

# ---- --stop ----------------------------------------------------------------------------

if [[ $modus == stop ]]; then
  if [[ -r $pidbestand ]]; then
    pid=$(<$pidbestand)
    cmd=$(ps -p "$pid" -o command= 2>/dev/null)
    if [[ $pid == <-> && $cmd == *varve-relay.js* ]]; then
      kill -- "$pid" && print -r -- "relay gestopt (pid $pid)"
    else
      print -r -- "relay: pid ${pid:-?} draait niet meer of is geen varve-relay.js: niets gestopt"
    fi
  else
    print -r -- "relay: geen pid-bestand ($pidbestand): niets gestopt"
  fi
  if spid=$(stroom_pid); then
    kill -- "$spid" && print -r -- "Stroommachine gestopt (pid $spid, profiel $profiel)"
  else
    print -r -- "Stroommachine: geen Chrome met profiel $profiel: niets gestopt"
  fi
  exit 0
fi

# ---- de controles ----------------------------------------------------------------------

print -r -- "beeld lokaal: de relay en de Stroommachine op deze Mac, naast VARVE (docs/BEELD.md §8)${${(M)modus:#droog}:+ — droog, ik start niets}"

if curl -sf -m 1 -o /dev/null "http://localhost:$server/api/proef"; then ok "de VARVE-server antwoordt op $server"
else stop "de VARVE-server antwoordt niet op $server: klik eerst VARVE.app"; fi

[[ -n $node && -x $node ]] && ok "node: $node" || stop "geen node gevonden (zet VARVE_NODE)"

if [[ -f $stroom/index.html && -f $stroom/tools/varve-relay.js ]]; then ok "de Stroommachine: $stroom"
else stop "geen Stroommachine in $stroom (index.html en tools/varve-relay.js; --stroom <map>)"; fi

relay=start
lpid=$(luistert $poort)
if [[ -z $lpid ]]; then ok "poort $poort is vrij"
elif is_relay $poort; then ok "relay draait al op $poort (pid $lpid): die gebruik ik"; relay=draait
else stop "poort $poort bezet door $(ps -p $lpid -o comm= 2>/dev/null | head -1) (pid $lpid), geen varve-relay"; fi

if [[ ! -d $bundel ]]; then stop "geen eigen Chrome-bundel in $bundel: draai eerst --installeer"
else
  bid=$(bundle_id "$bundel")
  if [[ $bid == com.google.Chrome ]]; then stop "$bundel heeft bundle-id com.google.Chrome (Clay's Chrome): niet gebruiken, installeer opnieuw met --installeer"
  else ok "eigen Chrome-bundel: $bundel (${bid:-geen bundle-id})"; fi
fi

beeld=start
if spid=$(stroom_pid); then ok "de Stroommachine draait al (pid $spid, profiel $profiel): ik open geen tweede"; beeld=draait; fi

# De URL: het pad als file-URL (een spatie wordt %20, zoals pathToFileURL in beeld-lokaal.mjs).
if [[ -n $node && -x $node ]]; then
  basis=$("$node" -e 'process.stdout.write(require("url").pathToFileURL(process.argv[1]).href)' "$stroom/index.html")
else
  basis="file://$stroom/index.html"
fi
url="$basis?hub=ws%3A%2F%2F127.0.0.1%3A$poort%2Fapp&dj#$stand"
(( fps )) && url+="&fps"
open_args=( -na "$bundel" --args "--user-data-dir=$profiel" --no-first-run --no-default-browser-check "--remote-debugging-port=$kijk" "--app=$url" )

# ---- droog: alleen zeggen wat het zou doen --------------------------------------------

if [[ $modus == droog ]]; then
  print -r -- ""
  print -r -- "zou starten:"
  [[ $relay == start ]] && print -r -- "  relay   $node $stroom/tools/varve-relay.js $poort  >> $log  (pid naar $pidbestand)"
  [[ $beeld == start ]] && print -r -- "  beeld   $opener ${(j: :)${(@q-)open_args}}"
  print -r -- "  url     $url"
fi

# ---- starten -----------------------------------------------------------------------------

if [[ $modus == start ]]; then
  if [[ $relay == start ]]; then
    nohup "$node" "$stroom/tools/varve-relay.js" "$poort" < /dev/null >> "$log" 2>&1 &!
    rpid=$!
    print -r -- $rpid > "$pidbestand"
    for i in {1..50}; do [[ -n $(luistert $poort) ]] && break; sleep 0.1; done
    if [[ -n $(luistert $poort) ]]; then ok "relay gestart op $poort (pid $rpid, log $log)"
    else print -ru2 -- "STOP  de relay luistert na 5 s niet op $poort (zie $log)"; exit 1; fi
  fi
  if [[ $beeld == start ]]; then
    "$opener" "${open_args[@]}" || { print -ru2 -- "STOP  de Stroommachine-bundel opent niet ($bundel)"; exit 1 }
    ok "de Stroommachine geopend ($stand${${fps:#0}:+, met de fps-meter})"
  fi
fi

# ---- wat jij daarna doet --------------------------------------------------------------------

print -r -- ""
print -r -- "${${(M)modus:#droog}:+Als het echt start, daarna:}${${modus:#droog}:+Daarna:}"
print -r -- "  1. VARVE: BEELD-rij, knopje deze Mac, beeld aan"
print -r -- "  2. Sleep het Stroommachine-venster naar de beamer, F volledig scherm, H panelen weg"
print -r -- "  3. Klik daarna terug in VARVE (anders gaan spatie en cijfers naar de Stroommachine)"
print -r -- "  4. Videopaneel in VARVE dicht"
print -r -- "  5. In de Stroommachine niet op G (eigen geluid), I of C (microfoon, camera) of MIDI in de Live-tab drukken; zwart = APC mapje beeld, Stop All (een wissel: kijk naar het doek)"
(( zou_stoppen )) && print -r -- "" && print -r -- "droog: een of meer controles zouden het tegenhouden (zie boven)"
exit 0
