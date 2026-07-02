#!/usr/bin/env bash
set -euo pipefail

# Fetch read-only reference copies of Effect and Confect at the pinned commits
# the template's agent-patterns/ docs were written against. The clones land in
# repos/ (gitignored) so agents can read upstream source and tests locally
# without the template shipping 35MB of vendored code.
#
# Usage: scripts/fetch-reference-repos.sh [target-dir]

TARGET_DIR="${1:-repos}"

EFFECT_REPO="https://github.com/Effect-TS/effect"
EFFECT_COMMIT="3e59443be"

CONFECT_REPO="https://github.com/rjdellecese/confect"
CONFECT_COMMIT="d3bf8e735"

fetch() {
  local name="$1" repo="$2" commit="$3"
  local dest="${TARGET_DIR}/${name}"

  if [ -d "${dest}/.git" ]; then
    echo "${name}: already present at ${dest}, fetching pinned commit"
    git -C "${dest}" fetch --depth 1 origin "${commit}"
  else
    mkdir -p "${dest}"
    git -C "${dest}" init -q
    git -C "${dest}" remote add origin "${repo}"
    git -C "${dest}" fetch --depth 1 origin "${commit}"
  fi

  git -C "${dest}" checkout -q "${commit}"
  echo "${name}: checked out ${commit}"
}

fetch effect "${EFFECT_REPO}" "${EFFECT_COMMIT}"
fetch confect "${CONFECT_REPO}" "${CONFECT_COMMIT}"

echo "Reference repos ready under ${TARGET_DIR}/ (read-only; never import from them)."
