#!/bin/sh
# Inline shared/core.js back into the page, producing a single standalone file
# you can double-click with no server:  dist/bannerfront.html
#
# shared/core.js stays the one source of truth — this only ever copies from it,
# so the standalone build cannot drift from what the server runs.
cd "$(dirname "$0")/.." || exit 1
mkdir -p dist
python3 - <<'PY'
import io, os, sys
html = io.open('index.html', encoding='utf-8').read()
core = io.open('shared/core.js', encoding='utf-8').read()
tag = '<script src="shared/core.js"></script>'
if tag not in html:
    sys.exit('index.html does not link shared/core.js — nothing to inline')
out = html.replace(tag, '<script>\n' + core + '\n</script>', 1)
io.open('dist/bannerfront.html', 'w', encoding='utf-8').write(out)
print('dist/bannerfront.html  %d KB' % (len(out.encode('utf-8')) // 1024))
PY
