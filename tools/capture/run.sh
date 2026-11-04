#!/bin/zsh
# One command from footage to a georeferenced GLB:  tools/capture/run.sh <zone> [stage ...]
set -euo pipefail
cd "${0:A:h}"
uv sync --quiet
exec uv run --quiet python -I cli.py "$@"
