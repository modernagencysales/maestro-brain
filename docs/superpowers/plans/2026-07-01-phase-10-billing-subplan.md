# Phase 10 Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden billing primitives for credit ledger, entitlements, webhook
deduplication, usage events, and seat enforcement.

**Architecture:** Keep fake billing first. Dodo live integration remains behind
`packages/integrations`; Convex stores ledger and entitlement state with
idempotent webhook handling.

**Tech Stack:** Confect, Effect Schema, Convex, Dodo adapter, integrations
package.

---

## Scope

General billing primitives for client apps that need plans, credits, usage,
seats, and payment provider events.

## Files

- Modify: `packages/integrations/src/dodo.ts`
- Modify: `packages/integrations/src/billing.ts`
- Create: `packages/convex/confect/ops/billing.spec.ts`
- Create: `packages/convex/confect/ops/billing.impl.ts`
- Create: `packages/convex/confect/tables/entitlements.ts`
- Create: `packages/convex/confect/tables/webhookEvents.ts`
- Modify: `packages/convex/confect/tables/creditLedger.ts`
- Modify: `packages/convex/confect/tables/usageEvents.ts`
- Modify: `docs/template/data-lifecycle.md`
- Modify: `docs/template/integrations.md`

## Tests

- `pnpm --dir packages/integrations test dodo.test.ts billing.test.ts`
- `pnpm --dir packages/convex test billing`
- `pnpm check:schema-migration-notes`

## Acceptance Criteria

- Webhooks deduplicate by provider, event ID, and signature timestamp.
- Credit ledger is append-only.
- Usage events map to entitlement checks.
- Seat enforcement returns typed failures and never silently over-provisions.

## Migration And Provisioning Impact

Add entitlement and webhook event tables. Dodo secrets remain existing
env-manifest entries.

## Maturity Level

Advances L4 monetizable client app readiness.

### Task 1: Integration Contracts

- [x] Add tests for Dodo webhook normalization, duplicate detection, and fake
      billing receipts.
- [x] Implement missing adapter helpers in `packages/integrations/src/dodo.ts`
      and `billing.ts`.
- [x] Run focused integrations tests.

### Task 2: Billing Confect Group

- [x] Add entitlement and webhook table schemas.
- [x] Create `billing.spec.ts` with `recordUsage`, `applyWebhook`,
      `grantEntitlement`, and `checkSeat`.
- [x] Write `packages/convex/test/billing.test.ts` for idempotency, append-only
      ledger, and seat failures.
- [x] Implement deterministic fake/local `billing.impl.ts`.
- [x] Run focused Convex billing tests.

### Task 3: Docs And Gates

- [x] Update lifecycle and integrations docs.
- [x] Run `pnpm check:schema-migration-notes`,
      `pnpm --dir packages/integrations test`,
      `pnpm --dir packages/convex test billing`, and `pnpm check:format`.
- [x] Commit:

```bash
git add packages/integrations packages/convex docs/template
git commit -m "feat: harden billing primitives"
```
