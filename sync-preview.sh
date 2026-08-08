#!/bin/sh
# The preview server cannot read ~/Desktop (macOS TCC denies it, and it surfaces
# as a confusing 404), so the previewed copy lives in the session scratchpad.
# Run this after editing, then reload the preview.
DEST="${BANNERFRONT_PREVIEW:-/private/tmp/claude-501/-Users-danbracy-Desktop-CompassAudit-Mac--4-/2d53a7a0-0934-4bc1-9aac-d7b9da6e2655/scratchpad/bannerfront}"
mkdir -p "$DEST"
rsync -a --delete --exclude tools "$(dirname "$0")/" "$DEST/"
echo "synced -> $DEST"
