#!/bin/sh
# Runs the logic test suite through JavaScriptCore (via osascript) — no Node needed.
# Usage: sh test/run.sh
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -t nutrilog-tests).js
cat "$DIR/test/preamble.js" \
    "$DIR/js/nutrients.js" "$DIR/js/units.js" "$DIR/js/foods.js" \
    "$DIR/js/store.js" "$DIR/js/goals.js" "$DIR/js/off.js" "$DIR/js/scanner.js" \
    "$DIR/test/tests.js" > "$TMP"
osascript -l JavaScript "$TMP"
rm -f "$TMP"
