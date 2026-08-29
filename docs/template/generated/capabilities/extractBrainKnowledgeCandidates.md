# ExtractBrainKnowledgeCandidates Capability

Extract bounded, exactly cited company-knowledge candidates from current Brain
evidence

## Contract

- Canonical system: `knowledge-brain` (`extend`)
- Args: `extractBrainKnowledgeCandidatesArgs`
- Returns: `extractBrainKnowledgeCandidatesReturns`
- Typed errors: Unauthorized, ValidationFailed, Forbidden
- Exposure: headless across API, CLI, HTTP MCP, web review, and scheduled work

## Implemented Surface

- `maestro-brain knowledge extract` and `brain.knowledge.extract` queue bounded
  current evidence with spaced internal actions.
- The canonical Brain review dialog exposes the same queue trigger.
- Grounding, leases, limits, replay, and the live-generation kill switch remain
  owned by the generated capability implementation.
