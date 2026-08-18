#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

uvicorn server.main:app --host 0.0.0.0 --port "${VLA_SERVER_PORT:-8000}"
