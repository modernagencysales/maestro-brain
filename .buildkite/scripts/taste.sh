#!/usr/bin/env bash
set -euo pipefail

if [[ "$*" == *"--mode fake"* ]]; then
  pnpm taste -- --mode fake | pnpm exec tsx tooling/quality/extract-ai-verdict.mts
  exit 0
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "taste gate requires OPENAI_API_KEY in CI" >&2
  exit 1
fi

pnpm taste | pnpm exec tsx tooling/quality/extract-ai-verdict.mts
