#!/bin/bash
set -euo pipefail

SERVER=${SERVER:-app@40.233.114.132}
SSH_PORT=${SSH_PORT:-22}
REMOTE_DIST_DIR=${REMOTE_DIST_DIR:-/var/www/www.campsoon.com/dist}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_DIST_DIR="$APP_DIR/dist"

cd "$APP_DIR"

echo "Building app-web..."
npm run build

if [ ! -d "$LOCAL_DIST_DIR" ]; then
  echo "Missing build output directory: $LOCAL_DIST_DIR" >&2
  exit 1
fi

echo "Preparing remote directory: $SERVER:$REMOTE_DIST_DIR"
ssh -p "$SSH_PORT" "$SERVER" "mkdir -p '$REMOTE_DIST_DIR'"

echo "Uploading dist to $SERVER:$REMOTE_DIST_DIR"
rsync -az --delete \
  -e "ssh -p $SSH_PORT" \
  "$LOCAL_DIST_DIR/" \
  "$SERVER:$REMOTE_DIST_DIR/"

echo "Done. Deployed app-web dist to $SERVER:$REMOTE_DIST_DIR"
