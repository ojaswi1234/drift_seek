#!/usr/bin/env bash
set -euo pipefail

echo "Starting Redis server..."
if ! redis-server --daemonize yes; then
  echo "Failed to start Redis server"
  exit 1
fi

: "${CRON_SECRET:?CRON_SECRET environment variable must be set}"

curl -sS -X GET "http://localhost:3000/api/cron/watchtower" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  --fail
