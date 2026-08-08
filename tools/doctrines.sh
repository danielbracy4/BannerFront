#!/bin/sh
# Doctrine balance test. usage: ./tools/doctrines.sh [matches] [lords]
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
[ -x "$JSC" ] || { echo "jsc not found at $JSC"; exit 1; }
exec "$JSC" tools/doctrines.js -- "$@"
