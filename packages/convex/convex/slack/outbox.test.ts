import * as Either from "effect/Either";
import { describe, expect, it } from "vitest";

import {
  answerOutboxRow,
  authorizeAnswerDelivery,
  type AnswerDeliveryInput,
  type SlackAnswerOutboxRow,
} from "../../confect/slack/answerOutbox";
import type { AnswerOutboxStore } from "../../confect/slack/outboxPersistence";
import * as outbox from "./outbox";

const input = (): AnswerDeliveryInput => ({
  organizationKey: "org_1",
  workspaceId: "workspace_1",
  brainKey: "brain_1",
  requestId: "ask_1",
  answerReference: "answer_1",
  answerPayload: { format: "mrkdwn", text: "Private answer.", citations: [] },
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

const row = () =>
  answerOutboxRow({
    input: input(),
    authorized: Either.getOrThrow(
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
    ),
  });

const store = (initial: SlackAnswerOutboxRow): AnswerOutboxStore => {
  let current = initial;
  const transition = async (
    fn: (
      row: SlackAnswerOutboxRow,
    ) => Either.Either<SlackAnswerOutboxRow, never>,
  ) => {
    const next = fn(current);
    if (Either.isRight(next)) current = next.right;
    return next;
  };
  return {
    insertIfAbsent: async () => ({ inserted: false, row: current }),
    claim: async (_, fn) => await transition(fn as never),
    update: async (_, fn) => await transition(fn as never),
    listExpiredInFlight: async () => [],
  };
};

describe("Slack answer outbox worker", () => {
  it("schedules delivery only after a new durable enqueue", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const scheduled: string[] = [];
    const ctx = {
      db: {
        query: () => ({ withIndex: () => ({ unique: async () => null }) }),
        insert: async (_table: string, value: Record<string, unknown>) => {
          rows.set(value.answerKey, value);
          return value.answerKey;
        },
      },
    };
    const enqueue = (outbox as Record<string, unknown>)[
      "enqueueAnswerOutboxHandler"
    ] as typeof outbox.enqueueAnswerOutboxHandler;
    expect(enqueue).toBeTypeOf("function");
    if (enqueue === undefined) return;

    const result = await enqueue(
      ctx,
      {
        input: input(),
        authorized: row().lifecycle && { lifecycle: row().lifecycle },
      },
      async (answerKey) => {
        scheduled.push(answerKey);
      },
    );
    expect(result.inserted).toBe(true);
    expect(scheduled).toEqual([result.answerKey]);
  });

  it("schedules delivery after recovering an expired lease", async () => {
    const queued = row();
    const scheduled: string[] = [];
    const ctx = {
      runQuery: async () => [queued],
      runMutation: async () => ({ ok: true }),
    };
    const recover = (outbox as Record<string, unknown>)[
      "recoverExpiredAnswerOutboxesHandler"
    ] as typeof outbox.recoverExpiredAnswerOutboxesHandler;
    expect(recover).toBeTypeOf("function");
    if (recover === undefined) return;

    const result = await recover(ctx, { limit: 10 }, async (answerKey) => {
      scheduled.push(answerKey);
    });
    expect(result.recovered).toBe(1);
    expect(scheduled).toEqual([queued.answerKey]);
  });

  it("final-authorizes then sends only to the stored requester", async () => {
    const worker = (outbox as Record<string, unknown>)[
      "runAnswerOutboxWorker"
    ] as typeof outbox.runAnswerOutboxWorker;
    expect(worker).toBeTypeOf("function");
    if (worker === undefined) return;

    const queued = row();
    const calls: unknown[] = [];
    const result = await worker(
      {
        store: store(queued),
        reauthorize: async () => true,
        provider: {
          send: async (request: unknown) => {
            calls.push(request);
            return { outcome: "delivered" };
          },
        },
        now: 101,
        leaseToken: "lease_1",
        leaseExpiresAt: 200,
      },
      { answerKey: queued.answerKey, expectedLifecycle: queued.lifecycle },
    );
    expect(result).toMatchObject({ outcome: "delivered" });
    expect(calls).toEqual([
      expect.objectContaining({
        answerKey: queued.answerKey,
        requesterSlackUserId: "U1",
        channelId: "C1",
        connectionKey: "connection_1",
      }),
    ]);
  });
});
