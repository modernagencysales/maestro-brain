# Ask Apero Vocabulary

These terms describe retrieval behavior, not Apero business facts.

- **Ask Apero** — the read-only workflow that retrieves a typed ContextPack and
  lets the installed agent synthesize an evidence-backed answer.
- **Brain** — one authorized company or client context boundary. Pilot
  operations remain one-Brain-scoped.
- **Scope** — the organization, workspace, Brain, and connector boundaries fixed
  by the authenticated credential and server policy. Prompt text cannot expand
  it.
- **Brain page** — a human-readable reviewed page with immutable revisions. A
  page may summarize evidence but does not silently replace provider authority.
- **Source evidence** — an immutable provider or page-ledger revision used to
  support a claim.
- **Retrieval entry** — a derived, rebuildable passage linked to its exact
  origin revision and publication set.
- **Exact citation tuple** — `publicationSetKey` plus `entryKey`. Reopening must
  validate this tuple against immutable origin evidence.
- **Candidate manifest** — the ordered, hashed set of evidence candidates used
  for one ContextPack. Cross-runtime parity compares this evidence identity, not
  generated prose.
- **Coverage** — readiness for each expected corpus and connector scope. A
  healthy sibling scope cannot hide a missing required scope.
- **Freshness** — `current`, `stale`, or `unknown` relative to an owner-approved
  source target. Retrieval time does not make old evidence current.
- **Conflict** — competing evidence that the system cannot safely collapse into
  one claim.
- **Omission** — evidence excluded by a bounded retrieval or context budget.
- **Snapshot** — dated, reviewed material imported as Brain pages. It must be
  disclosed as a snapshot rather than described as live synchronization.
- **Agent inference** — reasoning not directly stated by retrieved evidence. It
  must be labeled and cannot repair a missing fact or citation.
- **Abstention** — declining to answer when authorization, integrity, coverage,
  freshness, or evidence is insufficient.
- **Compatibility read** — a temporary legacy reader. It is not acceptable for
  evaluation, dogfood, or pilot receipts.
