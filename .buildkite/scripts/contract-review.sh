#!/usr/bin/env bash
set -euo pipefail

if [[ "$*" == *"--mode fake"* ]]; then
  pnpm contract-review -- --mode fake | pnpm exec tsx tooling/quality/extract-ai-verdict.mts
  exit 0
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "contract-review gate requires OPENAI_API_KEY in CI" >&2
  exit 1
fi

pnpm contract-review | pnpm exec tsx tooling/quality/extract-ai-verdict.mts
