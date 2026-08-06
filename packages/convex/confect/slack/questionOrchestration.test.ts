import { describe, expect, it } from "vitest";

import { receiveSlackQuestion, selectAuthorizedBrainScope } from "./question";
import { orchestrateSlackQuestion } from "./questionOrchestration";

const received = () =>
  selectAuthorizedBrainScope(
    receiveSlackQuestion({
      organizationKey: "org_1",
      connectionKey: "connection_1",
      connectionGeneration: 4,
      currentConnectionGeneration: 4,
      teamId: "T1",
      eventKind: "app_mention",
      channelKind: "private_channel",
      isSlackConnect: false,
      channelKey: "channel_1",
      externalChannelId: "C1",
      providerEventId: "event_1",
      requester: {
        slackUserId: "U1",
        userId: "user_1",
        bindingKey: "binding_1",
        bindingGeneration: 3,
        status: "active",
      },
      text: "What is the renewal date?",
      receivedAt: 100,
    }),
    {
      scopeKey: "brain_acme",
      scopes: [
        {
          organizationKey: "org_1",
          brainKey: "brain_acme",
          workspaceId: "workspace_acme",
          status: "active" as const,
        },
      ],
    },
  );

const delivery = {
  organizationKey: "org_1",
  workspaceId: "workspace_acme",
  brainKey: "brain_acme",
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
  now: 101,
} as const;

const authorized = {
  lifecycle: {
    organizationKey: "org_1",
    workspaceId: "workspace_acme",
    brainKey: "brain_acme",
    bindingKey: "binding_1",
    bindingGeneration: 3,
    connectionKey: "connection_1",
    connectionGeneration: 4,
    teamId: "T1",
    channelKey: "channel_1",
    deliveryGeneration: 5,
    operationGeneration: 6,
  },
} as const;

describe("Slack question orchestration", () => {
  it("asks the scoped Brain and enqueues the requester-private answer", async () => {
    const question = received();
    const calls: string[] = [];
    let queuedInput: Record<string, unknown> | undefined;
    const result = await orchestrateSlackQuestion(
      {
        question,
        questionText: "What is the renewal date?",
        delivery,
        authorized,
      },
      {
        ask: async (input) => {
          calls.push(`ask:${input.brainKey}`);
          return {
            status: "answered",
            answer: "Renewal is in June.",
            evidence: [
              {
                citationKey: "citation_1",
                pageKey: "page_1",
                revisionKey: "revision_1",
                title: "Renewal",
                excerpt: "Renewal is in June.",
              },
            ],
          };
        },
        enqueue: async (input) => {
          calls.push(`enqueue:${input.answerReference}`);
          queuedInput = input as unknown as Record<string, unknown>;
          return { inserted: true, answerKey: "answer_key_1" };
        },
      },
    );

    expect(result).toEqual({ outcome: "enqueued", answerKey: "answer_key_1" });
    expect(calls[0]).toBe("ask:brain_acme");
    expect(calls[1]).toMatch(/^enqueue:slack-ask:sha256:/);
    expect(queuedInput).toMatchObject({
      requesterUserId: "user_1",
      requesterSlackUserId: "U1",
      answerPayload: {
        format: "mrkdwn",
        text: "Renewal is in June.",
        citations: [{ sourceKey: "citation_1", label: "Renewal" }],
      },
    });
  });

  it("does not ask or enqueue an unscoped receipt", async () => {
    const question = selectAuthorizedBrainScope(
      receiveSlackQuestion({
        organizationKey: "org_1",
        connectionKey: "connection_1",
        connectionGeneration: 4,
        currentConnectionGeneration: 4,
        teamId: "T1",
        eventKind: "dm",
        channelKind: "im",
        isSlackConnect: false,
        channelKey: "channel_1",
        externalChannelId: "C1",
        providerEventId: "event_2",
        requester: {
          slackUserId: "U1",
          userId: "user_1",
          bindingKey: "binding_1",
          bindingGeneration: 3,
          status: "active",
        },
        text: "Help",
        receivedAt: 100,
      }),
      { scopes: [] },
    );
    let calls = 0;
    const result = await orchestrateSlackQuestion(
      { question, questionText: "Help", delivery, authorized },
      {
        ask: async () => {
          calls += 1;
          throw new Error("must not ask");
        },
        enqueue: async () => {
          calls += 1;
          return { inserted: true, answerKey: "never" };
        },
      },
    );

    expect(result).toMatchObject({ outcome: "ignored" });
    expect(calls).toBe(0);
  });
});
