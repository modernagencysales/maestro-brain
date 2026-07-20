# ClassifySourceUnit Capability

Returns a typed zero-or-one route proposal from an immutable source unit.

## Contract

- Args: `classifySourceUnitArgs`
- Returns: `classifySourceUnitReturns`
- Typed errors: Unauthorized, MalformedModelOutput, TargetNotAllowed,
  EvidenceMismatch, ReviewForbidden, StaleGeneration, DuplicateEffect
- Exposure: workflow

## Required Follow-Up

1. Keep the capability internal to reviewed workflow callers; it has no public,
   API, CLI, or MCP surface.
2. Run `pnpm confect:codegen` and `pnpm confect:manifest` at integration.
3. Run `pnpm check:confect-contracts` and focused classification tests.
