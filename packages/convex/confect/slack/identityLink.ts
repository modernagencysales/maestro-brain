export type SlackIdentityLinkLifecycle =
  "unlinked" | "pending_verification" | "active" | "revoked";

export const slackIdentityLinkLifecycle = [
  "unlinked",
  "pending_verification",
  "active",
  "revoked",
] as const satisfies readonly SlackIdentityLinkLifecycle[];

export const isCurrentSlackIdentityBinding = (input: {
  readonly status: SlackIdentityLinkLifecycle;
  readonly connectionGeneration: number;
  readonly currentConnectionGeneration: number;
}) =>
  input.status === "active" &&
  input.connectionGeneration === input.currentConnectionGeneration;
