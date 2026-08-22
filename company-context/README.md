# Company Context Contract

This directory is the reviewed, versioned policy package for the Ask Apero thin
slice. It contains shared vocabulary, source-routing metadata, agent behavior,
runtime installation guidance, and the candidate team manifest. It is not the
live knowledge store.

The canonical Ask Apero skill is
[`skills/ask-apero/SKILL.md`](skills/ask-apero/SKILL.md). Both Codex and Claude
Code install that same directory; runtime-specific copies are not maintained.

## Contents

- `skills/ask-apero/references/glossary.md` — shared retrieval vocabulary;
- `skills/ask-apero/references/source-map.v1.json` — source authority,
  readiness, and disclosure policy without source bodies;
- `skills/ask-apero/references/agent-guidance.md` — answer, citation, freshness,
  conflict, and abstention rules;
- `skills/ask-apero/references/context-pack-v3.md` — the bounded response checks
  used by the skill;
- `install.md` — runtime discovery and MCP configuration using secret names
  only;
- `team-manifest.v1.json` — candidate endpoint, runtime, update, and rollback
  contract.

## Boundaries

Keep synced messages, transcripts, documents, CRM exports, evaluation-question
text, credentials, and provider payloads out of this directory. Live evidence
belongs in its immutable provider or Brain-page ledger and is retrieved through
the canonical ContextPack operation.

The technical baseline comes from the reviewed product specification,
architecture, migration matrix, and decision packet under `docs/product/`. Owner
names, the active Brain key, provider selection, freshness targets, and pilot
users remain `TBD` until their named decision gates are completed. This
candidate package is not a dogfood or runtime-parity receipt.
