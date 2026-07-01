#!/usr/bin/env bash
set -euo pipefail

if [[ "$*" == *"--mode fake"* ]]; then
  echo "mutation: ok (fake mode)"
  exit 0
fi

if [[ "${BUILDKITE:-}" != "true" && "${RUN_MUTATION:-}" != "true" ]]; then
  echo "mutation: skipped outside scheduled/manual mutation runs"
  exit 0
fi

pnpm test
