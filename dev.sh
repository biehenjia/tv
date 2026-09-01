#!/usr/bin/env bash
# Run npm scripts inside the OrbStack/Docker container instead of natively.
# Usage: ./dev.sh install | ./dev.sh dev | ./dev.sh build | ./dev.sh <any npm script>
set -euo pipefail
cmd="${1:-build}"
shift || true

if [ "$cmd" = "install" ]; then
  docker compose run --rm node npm install "$@"
else
  docker compose run --rm node npm run "$cmd" "$@"
fi
