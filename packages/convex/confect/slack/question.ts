import { sha256Hex } from "../shared/sha256";

export type SlackQuestionInput = Readonly<{
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly currentConnectionGeneration: number;
  readonly teamId: string;
  readonly eventKind: "app_mention" | "dm";
  readonly channelKind: "private_channel" | "im" | "public_channel";
  readonly isSlackConnect: boolean;
  readonly channelKey: string;
  readonly externalChannelId: string;
  readonly providerEventId: string;
  readonly requester: Readonly<{
    readonly slackUserId: string;
    readonly userId: string;
    readonly bindingKey: string;
    readonly bindingGeneration: number;
    readonly status: "active" | "revoked" | "pending_verification";
  }>;
  readonly text: string;
  readonly receivedAt: number;
}>;

export type AuthorizedBrainScope = Readonly<{
  readonly organizationKey: string;
  readonly brainKey: string;
  readonly workspaceId: string;
  readonly status: "active" | "revoked";
}>;

type Requester = SlackQuestionInput["requester"];

export type SlackQuestionReceipt = Readonly<{
  readonly state: "received" | "denied";
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly teamId: string;
  readonly eventKind: SlackQuestionInput["eventKind"];
  readonly channelKind: SlackQuestionInput["channelKind"];
  readonly channelKey: string;
  readonly externalChannelId: string;
  readonly providerEventId: string;
  readonly requester: Requester;
  readonly questionHash: string;
  readonly scope: null;
  readonly receivedAt: number;
  readonly reason?:
    | "public_channel"
    | "slack_connect"
    | "identity_not_current"
    | "connection_generation";
}>;

export type SlackScopedQuestion = Readonly<{
  readonly state:
    "received" | "scoped" | "scope_required" | "needs_clarification" | "denied";
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly teamId: string;
  readonly eventKind: SlackQuestionInput["eventKind"];
  readonly channelKind: SlackQuestionInput["channelKind"];
  readonly channelKey: string;
  readonly externalChannelId: string;
  readonly providerEventId: string;
  readonly requester: Requester;
  readonly questionHash: string;
  readonly scope: AuthorizedBrainScope | null;
  readonly receivedAt: number;
  readonly receiptKey?: string;
  readonly availableBrainKeys?: readonly string[];
  readonly reason?:
    | "exact_scope_required"
    | "brain_not_authorized"
    | "public_channel"
    | "slack_connect"
    | "identity_not_current"
    | "connection_generation";
}>;

const frozen = <T extends object>(value: T): Readonly<T> =>
  Object.freeze(value);

const requesterCopy = (requester: Requester): Requester =>
  frozen({ ...requester });

const baseReceipt = (input: SlackQuestionInput) => ({
  organizationKey: input.organizationKey,
  connectionKey: input.connectionKey,
  connectionGeneration: input.connectionGeneration,
  teamId: input.teamId,
  eventKind: input.eventKind,
  channelKind: input.channelKind,
  channelKey: input.channelKey,
  externalChannelId: input.externalChannelId,
  providerEventId: input.providerEventId,
  requester: requesterCopy(input.requester),
  questionHash: `sha256:${sha256Hex(input.text.trim())}`,
  scope: null as null,
  receivedAt: input.receivedAt,
});

export const receiveSlackQuestion = (
  input: SlackQuestionInput,
): SlackQuestionReceipt => {
  const base = baseReceipt(input);
  const reason = input.isSlackConnect
    ? "slack_connect"
    : input.channelKind === "public_channel"
      ? "public_channel"
      : input.requester.status !== "active"
        ? "identity_not_current"
        : input.connectionGeneration !== input.currentConnectionGeneration
          ? "connection_generation"
          : undefined;
  return frozen(
    reason === undefined
      ? { ...base, state: "received" as const }
      : { ...base, state: "denied" as const, reason },
  );
};

export const selectAuthorizedBrainScope = (
  question: SlackQuestionReceipt,
  input: {
    readonly scopes: readonly AuthorizedBrainScope[];
    readonly scopeKey?: string;
    readonly scopeReference?: string;
  },
): SlackScopedQuestion => {
  if (question.state !== "received") return question;
  const active = input.scopes.filter(
    (scope) =>
      scope.organizationKey === question.organizationKey &&
      scope.status === "active",
  );
  const common = {
    ...question,
    requester: requesterCopy(question.requester),
  };
  if (input.scopeKey === undefined) {
    return frozen({
      ...common,
      state:
        input.scopeReference === undefined
          ? ("scope_required" as const)
          : ("needs_clarification" as const),
      ...(input.scopeReference === undefined
        ? { availableBrainKeys: active.map((scope) => scope.brainKey) }
        : { reason: "exact_scope_required" as const }),
    });
  }
  const selected = active.find((scope) => scope.brainKey === input.scopeKey);
  if (selected === undefined)
    return frozen({
      ...common,
      state: "denied" as const,
      reason: "brain_not_authorized" as const,
    });
  const scope = frozen({ ...selected });
  return frozen({
    ...common,
    state: "scoped" as const,
    scope,
    receiptKey: `sha256:${sha256Hex(
      JSON.stringify([
        question.providerEventId,
        scope.brainKey,
        question.requester.userId,
      ]),
    )}`,
  });
};
