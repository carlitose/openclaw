#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"

IMAGE_NAME="$(docker_e2e_resolve_image "openclaw-personal-chrome-relay-e2e" OPENCLAW_PERSONAL_CHROME_RELAY_IMAGE)"
docker_e2e_build_or_reuse "$IMAGE_NAME" personal-chrome-relay
docker_e2e_run_with_harness \
  --network none \
  -e OPENCLAW_DISABLE_BONJOUR=1 \
  -e OPENCLAW_SKIP_CANVAS_HOST=1 \
  -e OPENCLAW_SKIP_CHANNELS=1 \
  -e OPENCLAW_SKIP_CRON=1 \
  -e OPENCLAW_SKIP_GMAIL_WATCHER=1 \
  -e OPENCLAW_SKIP_PROVIDERS=1 \
  "$IMAGE_NAME" \
  bash scripts/e2e/personal-chrome-relay-container.sh
