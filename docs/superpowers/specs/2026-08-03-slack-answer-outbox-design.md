# Private Slack Answer Outbox V1

## Goal

Define a pure, bounded domain contract for delivering an immutable Brain answer
to the requester over private Slack, without adding persistence wiring or
generated files.

## Contract

The contract reuses the existing Slack identity binding, channel delivery
policy, and Brain operation policy vocabulary. A delivery request is accepted
only when the active identity binding belongs to the requester and matches the
tenant, Brain, connection, channel, and all captured generations. Delivery is
also gated by `requester_private` and the `slackDelivery` operation policy.

Each request carries a stable `answerKey`, a stable answer reference, the
immutable rendered answer payload, and only requester-scoped delivery metadata.
The raw question is not stored. The answer key is deterministic for the
tenant/requester/request identity and answer reference, so duplicate enqueue
attempts address one logical outbox item.

The row lifecycle is explicit: `pending`, `in_flight`, `retryable`, `sent`,
`failed`, or `expired`. Retryable failures may be retried after a persisted
lease expires; terminal states cannot be retried. Every worker transition checks
the captured lifecycle generations and lease token, preventing stale workers or
restarted workers from sending through a replaced or revoked authorization
context.

Outbox rows are append-only in identity, answer, and delivery metadata. State
transitions return a new row value and never alter the immutable answer payload.

## Scope

Add one domain module and one focused test module only. Do not change source
capture, workpool, maintenance, classification, Ask, UI, Convex table
registrations, or generated files.
