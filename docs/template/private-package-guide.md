# Private Package Guide

Private packages let client-specific capabilities, workflows, agents,
transformations, source types, blocks, prompts, and fixtures live outside the
template core.

## Import Rules

- Run dry-run first.
- Inspect generated diffs.
- Require docs, tests, data-map metadata, and migration notes.
- Do not bypass Confect contract checks.
- Do not import secrets or customer data.

## Upgrade Rules

Private packages should target a template release. When the template upgrades,
rerun dry-run import and fix contract diffs deliberately.
