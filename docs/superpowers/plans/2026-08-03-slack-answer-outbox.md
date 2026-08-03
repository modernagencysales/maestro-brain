# Private Slack Answer Outbox V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure V1 domain contract for requester-only, lifecycle-fenced
private Slack answer delivery with restart-safe outbox state.

**Architecture:** Reuse the existing `SlackIdentityBindingRowValue`,
`ChannelDeliveryPolicyRowValue`, and `OperationPolicy` types. Put deterministic
keying, authorization, fencing, row construction, and immutable transition
helpers in one `confect/slack/answerOutbox.ts` module; prove behavior in one
focused Vitest file. No persistence or generated registration is added.

**Tech Stack:** TypeScript, Effect Schema, Vitest.

## Global Constraints

- Full answer payload is immutable; raw question is omitted.
- Delivery is tenant/requester scoped and requires `requester_private` plus
  enabled `slackDelivery` policy.
- `answerKey` is deterministic and duplicate enqueue attempts are idempotent.
- Lifecycle and worker lease generations fence stale workers and worker
  restarts.
- Retryable and terminal outcomes are explicit.
- Do not touch source capture, workpool, maintenance, classification, Ask, UI,
  or generated files.

---

### Task 1: Add the failing contract tests

**Files:**

- Create: `packages/convex/confect/slack/answerOutbox.test.ts`
- Create: `packages/convex/confect/slack/answerOutbox.ts`

**Interfaces:**

- Tests will define the required public surface: `answerKeyFor`,
  `authorizeAnswerDelivery`, `answerOutboxRow`, `claimAnswerOutboxRow`,
  `recordAnswerDeliveryFailure`, `completeAnswerDelivery`, and
  `recoverExpiredAnswerDelivery`.

- [ ] **Step 1: Write tests for deterministic keying, authorization,
      idempotency, fencing, retry classification, terminal states, restart
      recovery, and immutable payloads.**
- [ ] **Step 2:** Run
      `pnpm --dir packages/convex exec vitest run confect/slack/answerOutbox.test.ts`
      and confirm failure because the module is missing.

### Task 2: Implement the minimum pure domain contract

**Files:**

- Modify: `packages/convex/confect/slack/answerOutbox.ts`

**Interfaces:**

- `answerKeyFor(input): string` deterministically scopes an answer reference to
  organization, requester, and request identity.
- `authorizeAnswerDelivery(input): Either<AnswerDeliveryAuthorization, AnswerDeliveryAuthorizationError>`
  checks tenant/requester binding, channel policy, operation policy, and
  captured generations.
- `answerOutboxRow(input): SlackAnswerOutboxRow` creates `pending` append-only
  data with an answer reference, immutable payload, and requester-only metadata.
- Transition helpers return replacement rows and reject stale lifecycle or lease
  generations.

- [ ] **Step 1: Implement schemas/types and pure functions using existing
      row/policy types.**
- [ ] **Step 2: Run the focused test and make the smallest corrections until
      green.**

### Task 3: Verify the focused scope

**Files:**

- No additional files.

- [ ] **Step 1:** Run
      `pnpm --dir packages/convex exec vitest run confect/slack/answerOutbox.test.ts`.
- [ ] **Step 2:** Run `pnpm --dir packages/convex typecheck`.
- [ ] **Step 3: Confirm `git diff --name-only` contains only the spec/plan plus
      the two contract files, and no generated files are changed by this work.
