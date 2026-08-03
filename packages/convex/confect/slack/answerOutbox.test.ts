import * as Either from "effect/Either";
import { describe, expect, it } from "vitest";

import {
  answerKeyFor,
  answerOutboxRow,
  authorizeAnswerDelivery,
  claimAnswerOutboxRow,
  completeAnswerDelivery,
  recoverExpiredAnswerDelivery,
  recordAnswerDeliveryFailure,
  type AnswerDeliveryInput,
  type SlackAnswerOutboxRow,
} from "./answerOutbox";

const input = (
  overrides: Partial<AnswerDeliveryInput> = {},
): AnswerDeliveryInput => ({
  organizationKey: "org_1",
  workspaceId: "workspace_1",
  brainKey: "brain_1",
  requestId: "ask_1",
  answerReference: "answer_1",
  answerPayload: {
    format: "mrkdwn",
    text: "The immutable answer.",
    citations: [{ sourceKey: "source_1", label: "Source one" }],
  },
  requesterUserId: "user_1",
  requesterSlackUserId: "U1",
  bindingKey: "binding_1",
  bindingGeneration: 3,
  connectionKey: "connection_1",
  connectionGeneration: 4,
  teamId: "T1",
  channelKey: "channel_1",
  externalChannelId: "C1",
  deliveryGeneration: 5,
  operationGeneration: 6,
  now: 100,
  ...overrides,
});

const binding = {
  organizationKey: "org_1",
  connectionKey: "connection_1",
  connectionGeneration: 4,
  teamId: "T1",
  workspaceId: "workspace_1",
  brainKey: "brain_1",
  slackUserId: "U1",
  userId: "user_1",
  bindingKey: "binding_1",
  bindingGeneration: 3,
  status: "active" as const,
};

const policy = {
  organizationKey: "org_1",
  channelKey: "channel_1",
  deliveryGeneration: 5,
  active: true,
  mode: "requester_private" as const,
};

const operation = {
  subsystem: "slackDelivery" as const,
  state: "enabled" as const,
  generation: 6,
};

const authorized = () =>
  Either.getOrThrow(
    authorizeAnswerDelivery({ input: input(), binding, policy, operation }),
  );

describe("private Slack answer outbox contract", () => {
  it("derives an idempotent tenant/requester-scoped answer key", () => {
    const first = answerKeyFor(input());
    expect(first).toBe(answerKeyFor(input()));
    expect(first).not.toBe(answerKeyFor(input({ requesterUserId: "user_2" })));
    expect(first).not.toBe(
      answerKeyFor(input({ answerReference: "answer_2" })),
    );
  });

  it("authorizes only the requester through the current private policy and operation generation", () => {
    expect(authorized()).toMatchObject({
      lifecycle: {
        organizationKey: "org_1",
        bindingGeneration: 3,
        operationGeneration: 6,
      },
    });
    expect(
      authorizeAnswerDelivery({
        input: input({ requesterSlackUserId: "U2" }),
        binding,
        policy,
        operation,
      }),
    ).toMatchObject({ _tag: "Left", left: { reason: "requester_mismatch" } });
    expect(
      authorizeAnswerDelivery({
        input: input({ deliveryGeneration: 4 }),
        binding,
        policy,
        operation,
      }),
    ).toMatchObject({
      _tag: "Left",
      left: { reason: "policy_generation_mismatch" },
    });
  });

  it("rejects revoked or stale lifecycle bindings and disabled delivery", () => {
    expect(
      authorizeAnswerDelivery({
        input: input(),
        binding: { ...binding, status: "revoked" },
        policy,
        operation,
      }),
    ).toMatchObject({ _tag: "Left", left: { reason: "binding_not_active" } });
    expect(
      authorizeAnswerDelivery({
        input: input(),
        binding,
        policy,
        operation: { ...operation, state: "paused" },
      }),
    ).toMatchObject({
      _tag: "Left",
      left: { reason: "operation_not_enabled" },
    });
  });

  it("creates an immutable pending row with no raw question", () => {
    const row = answerOutboxRow({ input: input(), authorized: authorized() });
    expect(row).toMatchObject({
      answerKey: answerKeyFor(input()),
      status: "pending",
      attempt: 0,
      requester: { userId: "user_1", slackUserId: "U1" },
      answer: input().answerPayload,
    });
    expect(row).not.toHaveProperty("question");
    expect(row).not.toHaveProperty("rawQuestion");
  });

  it("fences claims and preserves the immutable payload across retry and completion", () => {
    const row = answerOutboxRow({ input: input(), authorized: authorized() });
    const claimed = Either.getOrThrow(
      claimAnswerOutboxRow(row, {
        expectedLifecycle: row.lifecycle,
        leaseToken: "lease_1",
        leaseExpiresAt: 200,
        now: 101,
      }),
    );
    expect(claimed).toMatchObject({
      status: "in_flight",
      attempt: 1,
      leaseToken: "lease_1",
    });
    expect(
      recordAnswerDeliveryFailure(claimed, {
        expectedLifecycle: row.lifecycle,
        leaseToken: "wrong",
        kind: "retryable",
        code: "timeout",
        now: 102,
      }),
    ).toMatchObject({
      _tag: "Left",
      left: { reason: "lease_mismatch" },
    });
    const retried = recordAnswerDeliveryFailure(claimed, {
      expectedLifecycle: row.lifecycle,
      leaseToken: "lease_1",
      kind: "retryable",
      code: "timeout",
      now: 102,
    });
    expect(retried).toMatchObject({
      _tag: "Right",
      right: { status: "retryable" },
    });
    const reclaimed = Either.getOrThrow(
      claimAnswerOutboxRow(Either.getOrThrow(retried), {
        expectedLifecycle: row.lifecycle,
        leaseToken: "lease_2",
        leaseExpiresAt: 300,
        now: 103,
      }),
    );
    const sent = completeAnswerDelivery(reclaimed, {
      expectedLifecycle: row.lifecycle,
      leaseToken: "lease_2",
      now: 104,
    });
    expect(sent).toMatchObject({
      _tag: "Right",
      right: { status: "sent", answer: row.answer },
    });
  });

  it("separates terminal failures and lets a restarted worker recover an expired lease", () => {
    const row = answerOutboxRow({ input: input(), authorized: authorized() });
    const claimed = Either.getOrThrow(
      claimAnswerOutboxRow(row, {
        expectedLifecycle: row.lifecycle,
        leaseToken: "lease_1",
        leaseExpiresAt: 200,
        now: 101,
      }),
    );
    const terminal = recordAnswerDeliveryFailure(claimed, {
      expectedLifecycle: row.lifecycle,
      leaseToken: "lease_1",
      kind: "terminal",
      code: "channel_archived",
      now: 102,
    });
    expect(terminal).toMatchObject({
      _tag: "Right",
      right: { status: "failed" },
    });
    expect(
      completeAnswerDelivery(Either.getOrThrow(terminal), {
        expectedLifecycle: row.lifecycle,
        leaseToken: "lease_1",
        now: 103,
      }),
    ).toMatchObject({
      _tag: "Left",
      left: { reason: "terminal_state" },
    });
    const recovered = Either.getOrThrow(
      recoverExpiredAnswerDelivery(claimed, {
        expectedLifecycle: row.lifecycle,
        now: 201,
      }),
    );
    expect(recovered).toMatchObject({ status: "retryable" });
    expect("leaseToken" in recovered).toBe(false);
    expect(
      recoverExpiredAnswerDelivery(claimed, {
        expectedLifecycle: row.lifecycle,
        now: 199,
      }),
    ).toMatchObject({
      _tag: "Left",
      left: { reason: "lease_not_expired" },
    });
  });

  it("rejects stale worker transitions after a lifecycle generation changes", () => {
    const row = answerOutboxRow({ input: input(), authorized: authorized() });
    const stale = {
      ...row,
      lifecycle: { ...row.lifecycle, operationGeneration: 7 },
    } as SlackAnswerOutboxRow;
    expect(
      claimAnswerOutboxRow(stale, {
        expectedLifecycle: row.lifecycle,
        leaseToken: "lease_1",
        leaseExpiresAt: 200,
        now: 101,
      }),
    ).toMatchObject({
      _tag: "Left",
      left: { reason: "lifecycle_fence" },
    });
  });
});
