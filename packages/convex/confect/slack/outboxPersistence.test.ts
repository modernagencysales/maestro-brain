import * as Either from "effect/Either";
import { describe, expect, it } from "vitest";

import {
  enqueueAnswer,
  recoverExpiredAnswers,
  runAnswerDelivery,
  type AnswerOutboxStore,
  type PrivateAnswerProvider,
} from "./outboxPersistence";
import {
  answerOutboxRow,
  authorizeAnswerDelivery,
  type AnswerDeliveryInput,
  type SlackAnswerOutboxRow,
} from "./answerOutbox";

const input = (): AnswerDeliveryInput => ({
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
});

const authorization = () =>
  Either.getOrThrow(
    authorizeAnswerDelivery({
      input: input(),
      binding: {
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
        status: "active",
      },
      policy: {
        organizationKey: "org_1",
        channelKey: "channel_1",
        deliveryGeneration: 5,
        active: true,
        mode: "requester_private",
      },
      operation: {
        subsystem: "slackDelivery",
        state: "enabled",
        generation: 6,
      },
    }),
  );

const fakeStore = (): AnswerOutboxStore & {
  rows: Map<string, SlackAnswerOutboxRow>;
} => {
  const rows = new Map<string, SlackAnswerOutboxRow>();
  return {
    rows,
    insertIfAbsent: async (row) => {
      const existing = rows.get(row.answerKey);
      if (existing) return { inserted: false, row: existing };
      rows.set(row.answerKey, row);
      return { inserted: true, row };
    },
    claim: async (answerKey, transition) => {
      const row = rows.get(answerKey);
      if (!row) return null;
      const next = transition(row);
      if (Either.isLeft(next)) return next;
      rows.set(answerKey, next.right);
      return next;
    },
    update: async (answerKey, transition) => {
      const row = rows.get(answerKey);
      if (!row) return null;
      const next = transition(row);
      if (Either.isLeft(next)) return next;
      rows.set(answerKey, next.right);
      return next;
    },
    listExpiredInFlight: async (now) =>
      [...rows.values()].filter(
        (row) =>
          row.status === "in_flight" &&
          (row.leaseExpiresAt ?? Number.POSITIVE_INFINITY) <= now,
      ),
  };
};

describe("durable private Slack answer outbox", () => {
  it("enqueues idempotently and stores the complete immutable answer payload", async () => {
    const store = fakeStore();
    const first = await enqueueAnswer(store, {
      input: input(),
      authorized: authorization(),
    });
    const duplicate = await enqueueAnswer(store, {
      input: input(),
      authorized: authorization(),
    });
    expect(first).toEqual(duplicate);
    expect(store.rows.size).toBe(1);
    expect(first.row.answer).toEqual(input().answerPayload);
  });

  it("final-authorizes before sending and marks a revoked answer terminal without provider I/O", async () => {
    const store = fakeStore();
    const queued = await enqueueAnswer(store, {
      input: input(),
      authorized: authorization(),
    });
    let sends = 0;
    const provider: PrivateAnswerProvider = {
      send: async () => {
        sends += 1;
        return { outcome: "delivered" };
      },
    };
    const result = await runAnswerDelivery(store, {
      answerKey: queued.row.answerKey,
      expectedLifecycle: queued.row.lifecycle,
      leaseToken: "lease_1",
      leaseExpiresAt: 200,
      now: 101,
      reauthorize: () => false,
      provider,
    });
    expect(result).toMatchObject({ outcome: "denied" });
    expect(sends).toBe(0);
    expect(store.rows.get(queued.row.answerKey)?.status).toBe("failed");
  });

  it("delivers through the provider seam and never retries an ambiguous ephemeral send", async () => {
    const store = fakeStore();
    const queued = await enqueueAnswer(store, {
      input: input(),
      authorized: authorization(),
    });
    let sends = 0;
    const provider: PrivateAnswerProvider = {
      send: async () => {
        sends += 1;
        return { outcome: "ambiguous" };
      },
    };
    const result = await runAnswerDelivery(store, {
      answerKey: queued.row.answerKey,
      expectedLifecycle: queued.row.lifecycle,
      leaseToken: "lease_1",
      leaseExpiresAt: 200,
      now: 101,
      reauthorize: () => true,
      provider,
    });
    expect(result).toMatchObject({ outcome: "ambiguous_no_retry" });
    expect(store.rows.get(queued.row.answerKey)).toMatchObject({
      status: "failed",
      lastError: { kind: "terminal", code: "ambiguous_provider_outcome" },
    });
    expect(sends).toBe(1);
  });

  it("recovers expired leases so a restarted worker can claim them", async () => {
    const store = fakeStore();
    const queued = await enqueueAnswer(store, {
      input: input(),
      authorized: authorization(),
    });
    await runAnswerDelivery(store, {
      answerKey: queued.row.answerKey,
      expectedLifecycle: queued.row.lifecycle,
      leaseToken: "lease_1",
      leaseExpiresAt: 200,
      now: 101,
      reauthorize: () => true,
      provider: { send: async () => new Promise(() => undefined) },
    });
    const recovered = await recoverExpiredAnswers(store, {
      now: 201,
      expectedLifecycle: queued.row.lifecycle,
    });
    expect(recovered).toHaveLength(1);
    expect(store.rows.get(queued.row.answerKey)?.status).toBe("retryable");
  });
});
