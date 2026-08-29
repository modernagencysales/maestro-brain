# ReviewBrainKnowledgeCandidate Capability

Review a grounded Brain candidate into supported company knowledge

## Contract

- Canonical system: `knowledge-brain` (`extend`)
- Args: `reviewBrainKnowledgeCandidateArgs`
- Returns: `reviewBrainKnowledgeCandidateReturns`
- Typed errors: Unauthorized, ValidationFailed, Forbidden
- Exposure: headless across web and HTTP MCP

## Implemented Surface

- The canonical Brain review dialog lists and reviews bounded candidates.
- HTTP MCP exposes `brain.knowledge.candidates` and `brain.knowledge.review` for
  terminal agents.
- Exact reopening, optimistic review revision, idempotency, and atomic
  claim/citation creation remain owned by the generated capability.
