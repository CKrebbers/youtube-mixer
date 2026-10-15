#!/bin/zsh
# Wat launchd elke ochtend draait (nl.varve.backup, zie maak.sh en docs/BACKUP.md §6):
#   dagelijks.sh <doel> [extra opties voor kopie.mjs, bv. --zelfde-schijf]
# Is het doel er niet (SSD niet aangesloten), dan één regel in het log en klaar.
# Is <doel> een git-repo (de privé-repo varve-staat), dan daarna commit en push.
# Gooit nooit iets weg: kopie.mjs zet alleen bij, git voegt alleen toe.
set -u
DOEL=${1:?gebruik: dagelijks.sh <doel> [opties]}
shift
CHECKOUT=${0:A:h:h:h:h}
print -- "== $(date '+%Y-%m-%d %H:%M:%S') kopie naar $DOEL (checkout $CHECKOUT)"
cd "$CHECKOUT" || exit 1
node tools/backup/kopie.mjs --doel "$DOEL" --overslaan-zonder-doel "$@" || exit $?
if [[ -d "$DOEL/.git" ]]; then
  git -C "$DOEL" add -A -- varve/staat || exit 1
  if git -C "$DOEL" diff --cached --quiet; then
    print -- "git: niets nieuws"
  else
    git -C "$DOEL" commit -q -m "staat $(date '+%Y-%m-%d %H:%M')" && git -C "$DOEL" push -q && print -- "git: gecommit en gepusht"
  fi
fi
