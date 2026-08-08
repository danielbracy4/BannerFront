#!/bin/sh
# Run the headless balance sim.  usage: ./tools/sim.sh [matches] [bots] [preset]
# No Node on this Mac — we use the JavaScriptCore shell that ships with macOS.
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
[ -x "$JSC" ] || { echo "jsc not found at $JSC"; exit 1; }
exec "$JSC" tools/sim.js -- "$@"
