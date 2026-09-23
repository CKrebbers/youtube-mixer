#!/bin/zsh
# Test precies wat er in de index staat.
S=${TMPDIR:-/tmp}
cd "$(dirname "$0")/../.."
rm -rf $S/tree; git checkout-index -a -f --prefix=$S/tree/
cd $S/tree; rood=0
for f in test/*.test.mjs; do
  if node $f > $S/uit.txt 2>&1; then echo "groen $f $(grep -c '^  ok ' $S/uit.txt)"; else echo "ROOD  $f"; grep -E '^FAIL|Error' $S/uit.txt | head -8; rood=1; fi
done
exit $rood
