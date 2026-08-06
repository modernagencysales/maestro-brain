import { describe, expect, it } from "vitest";

import {
  receiveSlackQuestion,
  selectAuthorizedBrainScope,
  type SlackQuestionInput,
} from "./question";

const input = (
  overrides: Partial<SlackQuestionInput> = {},
): SlackQuestionInput => ({
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
  ...overrides,
});

const scopes = [
  {
    organizationKey: "org_1",
    brainKey: "brain_acme",
    workspaceId: "workspace_acme",
    status: "active" as const,
  },
  {
    organizationKey: "org_1",
    brainKey: "brain_beta",
    workspaceId: "workspace_beta",
    status: "active" as const,
  },
];

describe("Slack question intake and Brain scope selection", () => {
  it("accepts mentions and DMs as received receipts with requester identity", () => {
    const mention = receiveSlackQuestion(input());
    const dm = receiveSlackQuestion(
      input({ eventKind: "dm", channelKind: "im" }),
    );

    expect(mention).toMatchObject({
      state: "received",
      requester: { slackUserId: "U1", userId: "user_1" },
      scope: null,
      questionHash: expect.stringMatching(/^sha256:/),
    });
    expect(dm.state).toBe("received");
    expect("text" in mention).toBe(false);
  });

  it("denies public and Slack Connect questions before scope selection", () => {
    expect(
      receiveSlackQuestion(input({ channelKind: "public_channel" })),
    ).toMatchObject({ state: "denied", reason: "public_channel" });
    expect(receiveSlackQuestion(input({ isSlackConnect: true }))).toMatchObject(
      { state: "denied", reason: "slack_connect" },
    );
  });

  it("denies an unlinked or stale requester identity", () => {
    expect(
      receiveSlackQuestion(
        input({ requester: { ...input().requester, status: "revoked" } }),
      ),
    ).toMatchObject({ state: "denied", reason: "identity_not_current" });
    expect(
      receiveSlackQuestion(input({ connectionGeneration: 5 })),
    ).toMatchObject({ state: "denied", reason: "connection_generation" });
  });

  it("requires an exact scope and never guesses among authorized Brains", () => {
    const received = receiveSlackQuestion(input());
    expect(selectAuthorizedBrainScope(received, { scopes })).toMatchObject({
      state: "scope_required",
      availableBrainKeys: ["brain_acme", "brain_beta"],
    });
    expect(
      selectAuthorizedBrainScope(received, {
        scopes,
        scopeReference: "Acme",
      }),
    ).toMatchObject({
      state: "needs_clarification",
      reason: "exact_scope_required",
    });
  });

  it("scopes only an exact authorized active Brain and returns an immutable receipt", () => {
    const received = receiveSlackQuestion(input());
    const scoped = selectAuthorizedBrainScope(received, {
      scopes,
      scopeKey: "brain_acme",
    });

    expect(scoped).toMatchObject({
      state: "scoped",
      requester: { slackUserId: "U1", userId: "user_1" },
      scope: {
        brainKey: "brain_acme",
        workspaceId: "workspace_acme",
      },
      receiptKey: expect.stringMatching(/^sha256:/),
    });
    expect(Object.isFrozen(scoped)).toBe(true);
    expect(Object.isFrozen(scoped.requester)).toBe(true);
    expect(Object.isFrozen(scoped.scope)).toBe(true);
    expect(
      selectAuthorizedBrainScope(received, { scopes, scopeKey: "brain_other" }),
    ).toMatchObject({ state: "denied", reason: "brain_not_authorized" });
  });
});
