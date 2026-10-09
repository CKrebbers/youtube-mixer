#!/bin/zsh
# Bouwt ~/Applications/VARVE.app uit VARVE.applescript: de knop in het Dock die de Varve-server
# start (als hij nog niet draait) en de Controlekamer in Chrome naar voren haalt. Na een wijziging
# aan het script opnieuw draaien; het Dock wijst naar hetzelfde pad en blijft goed.
# Eerste keer in het Dock: sleep ~/Applications/VARVE.app erheen. De eerste klik vraagt of VARVE
# Chrome mag besturen (Automatisering); na een nieuwe bouw kan macOS dat opnieuw vragen.
# Draaien: zsh tools/varve-app/maak.sh  (of als argument een ander doel, voor een proef).
set -e
DOEL=${1:-$HOME/Applications/VARVE.app}
mkdir -p "${DOEL:h}"
osacompile -o "$DOEL" "${0:A:h}/VARVE.applescript"
echo "klaar: $DOEL"
