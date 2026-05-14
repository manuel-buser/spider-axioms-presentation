#!/usr/bin/env bash
# Launch the Spider-axioms presentation server.
#
# Used for ad-hoc local runs. On the production VPS, the systemd unit
# (../systemd/spider-axioms.service) is what runs server.py — not this script.

set -euo pipefail
cd "$(dirname "$0")"

# Defaults match the VPS layout; override for local dev.
: "${FD_SCRIPT:=/srv/fast-downward/fast-downward.py}"
: "${PROJECT_ROOT:=$(dirname "$(dirname "$(readlink -f "$0")")")/pddl}"
: "${PORT:=8000}"

# Early sanity warnings (server prints its own, but these go to stderr first)
if [[ ! -f "$FD_SCRIPT" ]]; then
  echo "WARNING: FD_SCRIPT not found: $FD_SCRIPT" >&2
fi
if [[ ! -d "$PROJECT_ROOT/Spider_Axioms" ]]; then
  echo "WARNING: PROJECT_ROOT/Spider_Axioms missing: $PROJECT_ROOT" >&2
fi

export FD_SCRIPT PROJECT_ROOT PORT
exec python3 server.py
