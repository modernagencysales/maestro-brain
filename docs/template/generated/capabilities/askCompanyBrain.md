# AskCompanyBrain Capability

Answer from reviewed company knowledge and exact current evidence

## Contract

- Canonical system: `knowledge-brain` (`extend`)
- Args: `askCompanyBrainArgs`
- Returns: `askCompanyBrainReturns`
- Typed errors: Unauthorized, ValidationFailed, Forbidden
- Exposure: headless

## Required Follow-Up

1. Review the flat files in `packages/convex/confect/capabilities/`.
2. Run `pnpm confect:codegen`.
3. Add generated refs to the web/API/CLI/MCP surfaces selected in
   `askCompanyBrain.headless.json`.
4. Specialize the starter implementation with domain logic behind capability
   checks.
5. Run `pnpm check:confect-contracts` and focused capability tests.
