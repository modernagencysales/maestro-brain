---
name: ask-apero
description:
  Answer Apero company-context questions from the configured read-only Maestro
  Brain using ContextPack evidence, exact citations, freshness, and abstention.
  Use for Ask Apero research and decisions; do not use for provider writes or
  unsupported client scope.
metadata:
  contract-version: "0.3.0"
---

# Ask Apero

Use the configured `maestro-brain` MCP connection as the only company-context
evidence source for this workflow.

## Retrieve

1. Before reading references or investigating the repository, confirm that
   `template.brain.context.get` exists in the current tool registry. If it is
   absent, stop immediately. Do not inspect config files, search local context,
   call the endpoint with curl, or spawn another agent/runtime. Reply only that
   the `maestro-brain` MCP is unavailable and ask the user to run the Brain
   CLI's `doctor` command using the same invocation used for setup, then verify
   runtime registration. Do not assume `maestro-brain` is on PATH.
2. Resolve the intended company or client scope in natural language. If it is
   ambiguous, ask before retrieval. Never send a Brain key, organization,
   workspace, or other tenant selector; the read-only credential fixes scope.
3. Call `template.brain.context.get` immediately with the user's complete
   question. If the call fails, apply the stop conditions below without loading
   reference files.
4. Accept only ContextPack schema version `3` with candidate-manifest version
   `2`. After a successful response, read
   [agent guidance](references/agent-guidance.md). On a schema change or
   ambiguous coverage, read [ContextPack v3](references/context-pack-v3.md).
5. Use `template.brain.sources.search` only to refine a retrieval miss. Open
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
disabled, the response is not ContextPack v3, the candidate manifest is absent,
an exact citation cannot reopen, or relevant required coverage is unavailable.
Distinguish runtime tool-approval/configuration failures from a returned Brain
`Unauthorized` error. For the former, say the read-only MCP call was blocked and
ask the user to enable the registered `maestro-brain` tool; do not tell them to
request a credential. Only a returned `Unauthorized` error indicates that the
bearer key is missing, invalid, or lacks access. Never invoke provider or Brain
evidence-write tools. If the user reports an answer as wrong or stale, preserve
the ContextPack request ID, candidate-manifest hash, exact cited tuples,
readiness snapshot, and selected failure category for the approved API-only
feedback surface. Do not copy source or answer text into the report.

## Conditional references

- Read the [glossary](references/glossary.md) when a term or citation identity
  is unclear.
- Read the [source map](references/source-map.v1.json) when deciding authority,
  required coverage, snapshot disclosure, or whether a provider decision is
  still `TBD`.
