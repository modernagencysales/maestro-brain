#!/usr/bin/env bash
set -euo pipefail
# Bootstrap step configured in the Buildkite UI runs this script. For PR
# builds the pipeline structure is taken from the default branch, not the PR
# head, so a PR cannot rewrite CI to skip gates or exfiltrate secrets — the
# same trust boundary ci-self-protection enforces on the config files.

DEFAULT_BRANCH="${BUILDKITE_PIPELINE_DEFAULT_BRANCH:-main}"

case "${BUILDKITE_PULL_REQUEST:-false}" in
  false | "")
    buildkite-agent pipeline upload .buildkite/pipeline.yml
    ;;
  *)
    echo "Uploading trusted ${DEFAULT_BRANCH} pipeline for PR ${BUILDKITE_PULL_REQUEST}"
    TRUSTED_PIPELINE="$(mktemp)"
    trap 'rm -f "$TRUSTED_PIPELINE"' EXIT
    git fetch --no-tags --depth=1 origin "$DEFAULT_BRANCH"
    git show "FETCH_HEAD:.buildkite/pipeline.yml" > "$TRUSTED_PIPELINE"
    buildkite-agent pipeline upload "$TRUSTED_PIPELINE"
    ;;
esac
