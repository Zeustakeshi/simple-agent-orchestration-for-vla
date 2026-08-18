#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

export MUJOCO_GL="${MUJOCO_GL:-egl}"

python -m edge_vla.server
