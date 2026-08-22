---
name: ask-apero
description:
  Answer Apero company-context questions from the configured read-only Maestro
  Brain using ContextPack evidence, exact citations, freshness, and abstention.
  Use for Ask Apero research and decisions; do not use for provider writes or
  unsupported client scope.
metadata:
  contract-version: "0.1.0"
---

# Ask Apero

Use the configured `maestro-brain` MCP connection as the only company-context
evidence source for this workflow.

## Retrieve

1. Resolve the intended company or client scope in natural language. If it is
   ambiguous, ask before retrieval. Never send a Brain key, organization,
   workspace, or other tenant selector; the read-only credential fixes scope.
2. Read [agent guidance](references/agent-guidance.md), then call
   `template.brain.context.get` with the user's complete question.
3. Accept only ContextPack schema version `1` with candidate-manifest version
   `1`. On first use, a schema change, or ambiguous coverage, read
   [ContextPack v1](references/context-pack-v1.md).
4. Use `template.brain.sources.search` only to refine a retrieval miss. Open
   material evidence with `template.brain.sources.get` using its exact
   `publicationSetKey` and `entryKey`; do not cite a search excerpt alone.

## Answer

- Base every material company claim on returned evidence and attach numbered
  citations with title, stable locator when present, revision identity, exact
  publication/entry tuple, and freshness.
- State the pack's `asOf` time, relevant coverage gaps, stale or unknown
  freshness, conflicts, omissions, and truncation. Display a snapshot date when
  the evidence identifies one; never describe a snapshot as live.
- Label reasoning that goes beyond retrieved text as agent inference.
- Give a qualified partial answer only when the supported portion is useful and
  the missing evidence cannot change it. Otherwise abstain and name the missing
  or inaccessible evidence.

## Stop conditions

Stop without answering from memory when authorization fails, the subsystem is
disabled, the response is not ContextPack v1, the candidate manifest is absent,
an exact citation cannot reopen, or relevant required coverage is unavailable.
Never invoke provider or Brain write tools. Durable wrong/stale feedback is not
available in this contract version.

## Conditional references

- Read the [glossary](references/glossary.md) when a term or citation identity
  is unclear.
- Read the [source map](references/source-map.v1.json) when deciding authority,
  required coverage, snapshot disclosure, or whether a provider decision is
  still `TBD`.
