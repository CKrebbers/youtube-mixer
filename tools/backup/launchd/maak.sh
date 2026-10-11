#!/bin/zsh
# Maakt de LaunchAgent nl.varve.backup: elke ochtend 08:00 dagelijks.sh → kopie.mjs (docs/BACKUP.md §6).
# Standaard installeert hij NIETS: hij laat alleen zien wat er in ~/Library/LaunchAgents zou komen.
#
#   zsh tools/backup/launchd/maak.sh --doel /Volumes/SSD [--zelfde-schijf] [--installeer]
#
# --installeer   zet de plist in ~/Library/LaunchAgents en laadt hem (launchctl bootstrap).
#                Weigert als daar al een nl.varve.backup.plist staat: nooit overschrijven.
# Stoppen (met de hand): launchctl bootout gui/$UID/nl.varve.backup, en de plist zelf opzij zetten.
# Log: ~/.varve-backup.log.
set -eu
HIER=${0:A:h}
DOEL=""; INSTALLEER=0; EXTRA=()
while (( $# )); do
  case $1 in
    --doel) DOEL=${2:?--doel mist een map}; shift 2 ;;
    --doel=*) DOEL=${1#--doel=}; shift ;;
    --zelfde-schijf) EXTRA+=(--zelfde-schijf); shift ;;
    --installeer) INSTALLEER=1; shift ;;
    *) print -u2 "maak.sh: onbekend: $1"; exit 2 ;;
  esac
done
[[ -n $DOEL ]] || { print -u2 "gebruik: maak.sh --doel <map> [--zelfde-schijf] [--installeer]"; exit 2; }
DOEL=${DOEL:a}
xml() { local s=$1; s=${s//&/&amp;}; s=${s//</&lt;}; s=${s//>/&gt;}; print -rn -- "$s"; }
extra=""
for e in $EXTRA; do extra+="    <string>$(xml $e)</string>"$'\n'; done
plist=$(<$HIER/nl.varve.backup.plist)
plist=${plist//__SCRIPT__/$(xml $HIER/dagelijks.sh)}
plist=${plist//__DOEL__/$(xml $DOEL)}
plist=${plist//__LOG__/$(xml $HOME/.varve-backup.log)}
plist=${plist//__EXTRA__/$extra}
DOELPAD=$HOME/Library/LaunchAgents/nl.varve.backup.plist
if (( ! INSTALLEER )); then
  print -r -- "$plist"
  print -- "\n(niet geïnstalleerd; met --installeer komt dit in $DOELPAD)"
  exit 0
fi
[[ -e $DOELPAD ]] && { print -u2 "maak.sh: $DOELPAD bestaat al; niet overschreven. Eerst zelf opzij zetten (launchctl bootout gui/$UID/nl.varve.backup)."; exit 2; }
mkdir -p ${DOELPAD:h}
print -r -- "$plist" > $DOELPAD
plutil -lint $DOELPAD
launchctl bootstrap gui/$UID $DOELPAD
print -- "geïnstalleerd: $DOELPAD (elke dag 08:00; log ~/.varve-backup.log)"
