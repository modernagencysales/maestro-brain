#!/usr/bin/env bash
set -euo pipefail
# pre-push-rubric — inject AI gate rubrics into the agent's context so it
# self-reviews against the exact criteria taste-review and contract-review
# will use in CI. Zero API cost: the agent IS the model.
#
# Reads both rubrics from their source-of-truth files so they never drift.

ROOT="$(git rev-parse --show-toplevel)"
BASE="origin/main"

CHANGED=$(git diff --name-only --diff-filter=d "${BASE}...HEAD" 2>/dev/null \
  | grep -E '^(packages|apps)/.*\.(ts|tsx)$' \
  | grep -vE '\.(test|spec)\.|/__tests__/|/_generated/' || true)

if [ -z "$CHANGED" ]; then
  exit 0
fi

FILE_COUNT=$(echo "$CHANGED" | wc -l | tr -d ' ')

# Extract the RUBRIC template string from taste-review.mts (between the
# backticks of the const RUBRIC = `...`; assignment).
TASTE_RUBRIC=$(sed -n '/^const RUBRIC = `/,/^Do not run any commands/{ s/^const RUBRIC = `//; s/`;$//; p; }' \
  "$ROOT/tooling/quality/taste-review.mts" 2>/dev/null || true)
if [ -z "$TASTE_RUBRIC" ]; then
  TASTE_RUBRIC="
Judge these four criteria (the things linters cannot measure):
1. Single responsibility — does the file, and each function in it, do exactly one thing?
2. Naming — do names say precisely what they do?
3. Right abstraction — not over-engineered, not a god-blob; seams in sensible places.
4. Readability — a competent dev understands it in one sitting.
Severity block = a clear violation (function doing 3+ jobs; misleading name; logic in wrong layer)."
fi

cat <<'BANNER'

════════════════════════════════════════════════════════════════════════
  PRE-PUSH AI GATE SELF-REVIEW
  The following rubrics are the EXACT criteria that CI's taste-review
  and contract-review judges will use to evaluate this code. Review
  your changes against them NOW — fixing here saves a CI round-trip.
════════════════════════════════════════════════════════════════════════

BANNER

echo "── TASTE REVIEW RUBRIC ────────────────────────────────────────────────"
echo ""
echo "$TASTE_RUBRIC"
echo ""

echo "── CONTRACT REVIEW RUBRIC ─────────────────────────────────────────────"
echo ""
cat "$ROOT/tooling/quality/contract-review-rubric.md"
echo ""

echo "── CHANGED FILES ($FILE_COUNT) ──────────────────────────────────────────────────"
echo ""
echo "$CHANGED"
echo ""

cat <<'INSTRUCTION'
════════════════════════════════════════════════════════════════════════
  ACTION REQUIRED: Review every changed file above against BOTH
  rubrics. If ANY file would receive a "block" verdict from taste
  or a "red"/"yellow" finding from contract review, fix it BEFORE
  pushing. The CI judges will catch the same issues — fix them now.
════════════════════════════════════════════════════════════════════════

INSTRUCTION
