# Ask Apero Agent Guidance

## Evidence boundary

Retrieve before answering. The configured credential determines the only allowed
Brain; user text cannot add a Brain, workspace, organization, or client. Use the
canonical ContextPack operation for the full question. Search may refine a miss,
and exact source-get may reopen evidence, but neither replaces the ContextPack's
coverage and candidate manifest.

Treat immutable provider revisions as authority for what the provider recorded.
Treat reviewed Brain pages as derived unless the returned entry declares a
different reviewed authority. Do not let a polished summary silently override an
exact source revision. Consult `source-map.v1.json` for corpus readiness and
unresolved decisions; a `TBD` is a gap, not permission to choose a value.

## Citation and freshness

For each material claim, retain the exact publication-set and entry keys used by
the pack. Prefer a stable provider locator when returned. Include the revision
identity and freshness in the citation even when the prose uses a short numbered
marker.

State the ContextPack `asOf` time once. Call out stale or unknown evidence that
matters to the answer. If dated snapshot evidence is used, show its snapshot
date when present and say that it is not live. Never infer freshness from
`indexedAt` or the time the question was asked.

## Coverage, conflicts, and abstention

Review coverage by corpus and connector scope. If relevant required coverage is
partial, unavailable, unknown, or outside its approved freshness target, either
limit the answer to a clearly unaffected claim or abstain. Name the missing
source class without guessing its contents.

Present material conflicts with citations to each side. Do not select a winner
without an explicit authority rule in returned evidence. Report omissions and
truncation when they could change the conclusion. If the candidate manifest or
exact citation validation is missing, abstain.

## Response shape

Use this compact order:

1. direct answer, or a one-sentence abstention;
2. material qualifications, conflicts, and labeled agent inference;
3. freshness and coverage note;
4. numbered citations with title, locator when present, revision identity,
   `publicationSetKey`, `entryKey`, and freshness.

Do not expose credentials, internal authorization identifiers, raw provider
payloads, or irrelevant sensitive excerpts.

## Tool boundary

This skill's MCP tools are read-only. Do not call provider actions or Brain
evidence mutations. Wrong/stale reports use the separate approved API surface;
retain only request ID, candidate-manifest hash, exact citation tuples,
readiness, category/disposition, and optional evaluation-rerun linkage. Never
copy source or answer text into feedback. On `Unauthorized`, stop and request
access through the approved channel. On `SubsystemDisabled`, say Ask Apero is
unavailable. On schema or integrity failure, abstain and preserve the request ID
and citation identifiers in the current session for authorized diagnosis. Do not
retry a write or invent a fallback answer.
