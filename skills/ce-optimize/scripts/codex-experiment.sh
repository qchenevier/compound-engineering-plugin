#!/usr/bin/env bash
# Run one experiment in its worktree. Exit 3 when the standalone guard calls
# for subagent dispatch. Managed startup and job failures use exits 2 and 1.
set -euo pipefail

if [ "$#" -ne 2 ] || [ ! -d "$1" ] || [ ! -f "$2" ]; then
  printf 'usage: codex-experiment.sh <experiment-worktree> <brief-file>\n' >&2
  exit 2
fi
WORKSPACE="$1"
BRIEF="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${CE_PEER_PYTHON:-python3}"
LAUNCHER="$("$PY" "$SCRIPT_DIR/managed-codex.py" resolve)"
if [ -n "$LAUNCHER" ]; then
  exec "$PY" "$SCRIPT_DIR/managed-codex.py" run "$LAUNCHER" --cwd "$WORKSPACE" --brief-file "$BRIEF"
fi
if [ -n "${CODEX_SANDBOX:-}" ] || [ -n "${CODEX_SESSION_ID:-}" ] || [ ! -w "$WORKSPACE/.git" ]; then
  printf 'standalone Codex is unavailable from this experiment worktree\n' >&2
  exit 3
fi
exec codex exec --sandbox workspace-write --skip-git-repo-check -C "$WORKSPACE" - < "$BRIEF"
