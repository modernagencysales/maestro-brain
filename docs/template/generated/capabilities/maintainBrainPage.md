# MaintainBrainPage Capability

Returns cited Brain revision proposals from an immutable context pack.

## Contract

- Args: `maintainBrainPageArgs`
- Returns: `maintainBrainPageReturns`
- Typed errors: Unauthorized, ValidationFailed, Forbidden
- Exposure: workflow

## Required Follow-Up

1. Review the flat files in `packages/convex/confect/capabilities/`.
2. Run `pnpm confect:codegen`.
3. Add generated refs to the web/API/CLI/MCP surfaces selected in
   `maintainBrainPage.headless.json`.
4. Specialize the starter implementation with domain logic behind capability
   checks.
5. Run `pnpm check:confect-contracts` and focused capability tests.
