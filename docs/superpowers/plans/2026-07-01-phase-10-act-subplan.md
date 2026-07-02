# Phase 10 Act Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add publish jobs, approval review gates, tokenized review links,
refresh scheduler, trigger config, work queue, and digests.

**Architecture:** Actions are audited workflow outputs. Work queues and
schedulers live behind Confect/Convex contracts; notification digests use
`packages/notifications`; approval tokens are scoped, expiring, and redacted.

**Tech Stack:** Confect, Effect Schema, Convex components, notifications
package.

---

## Scope

Reusable “act” primitives for safely moving from AI outputs to external actions.

## Files

- Create: `packages/template-core/src/actions.ts`
- Create: `packages/template-core/src/actions.test.ts`
- Create: `packages/convex/confect/ops/actions.spec.ts`
- Create: `packages/convex/confect/ops/actions.impl.ts`
- Create: `packages/convex/confect/tables/actionJobs.ts`
- Create: `packages/convex/confect/tables/actionApprovals.ts`
- Create: `packages/convex/confect/tables/actionTriggers.ts`
- Create: `packages/convex/confect/tables/actionDigests.ts`
- Modify: `packages/notifications/src/index.ts`
- Modify: `docs/template/data-lifecycle.md`

## Tests

- `pnpm --dir packages/template-core test actions.test.ts`
- `pnpm --dir packages/convex test actions`
- `pnpm --dir packages/notifications test`

## Acceptance Criteria

- Publish jobs require approval policy or explicit safe-mode exemption.
- Review links are tokenized, scoped, expiring, and never log raw token values.
- Refresh scheduler stores trigger config and idempotency keys.
- Digests use notification seam and redact customer/provider metadata.

## Migration And Provisioning Impact

Add four action tables. Optional live email provider uses existing MailerSend
env posture.

## Maturity Level

Advances L4 operational app factory behavior.

### Task 1: Action Domain

- [x] Write `actions.test.ts` covering job creation, approval requirement, token
      hash generation, trigger idempotency, and digest payload redaction.
- [x] Run focused template-core test and confirm missing module failure.
- [x] Implement `actions.ts` with pure constructors and validators.
- [x] Export from `packages/template-core/src/index.ts`.
- [x] Rerun focused test.

### Task 2: Confect Actions Group

- [x] Add action table schema files.
- [x] Create `actions.spec.ts` with mutations `enqueueAction`, `approveAction`,
      `configureTrigger`, and `sendDigest`.
- [x] Write `packages/convex/test/actions.test.ts` for typed errors
      `ApprovalRequired`, `TokenExpired`, `Unauthorized`, and
      `ValidationFailed`.
- [x] Implement deterministic fake/local `actions.impl.ts`.
- [x] Run focused Convex test.

### Task 3: Notification Integration And Docs

- [x] Extend notifications tests for digest send.
- [x] Update `data-lifecycle.md` for action tables.
- [x] Run package tests, schema notes, and format.
- [x] Commit:

```bash
git add packages/template-core packages/convex packages/notifications docs/template
git commit -m "feat: add audited action primitives"
```
