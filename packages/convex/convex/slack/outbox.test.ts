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
  it("final-authorizes then sends only to the stored requester", async () => {
    const worker = (outbox as Record<string, unknown>)[
      "runAnswerOutboxWorker"
    ] as
      undefined | ((runtime: any, args: any) => Promise<{ outcome: string }>);
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
