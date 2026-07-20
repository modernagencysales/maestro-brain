import type { SettingsViewer } from "./settings-surface";

export type SlackLinkWorkspace = {
  readonly organizationId: string;
  readonly workspaceId: string;
};

export type SlackLinkBinding = {
  readonly status: "pending_verification" | "active" | "revoked";
  readonly teamId: string;
  readonly slackUserId: string;
  readonly connectionGeneration: number;
  readonly bindingGeneration: number;
  readonly verifiedAt: number | null;
};

export type SlackLinkStatusView = {
  readonly heading: string;
  readonly body: readonly string[];
  readonly canLink: boolean;
};

export const redactSlackLinkToken = (token: string) => {
  void token;
  return "slack-link:[redacted]";
};

export const buildSlackLinkStatusView = ({
  workspace,
  binding,
  viewerRole,
}: {
  readonly workspace: SlackLinkWorkspace | null;
  readonly binding: SlackLinkBinding | null;
  readonly viewerRole: SettingsViewer["role"];
}): SlackLinkStatusView => {
  if (workspace === null) {
    return {
      heading: "Slack identity link unavailable",
      body: ["Slack linking requires a server-derived active workspace."],
      canLink: false,
    };
  }

  const canLink = viewerRole !== "viewer";
  if (binding === null || binding.status === "revoked") {
    return {
      heading: "Slack identity not linked",
      body: ["Linking requires an exact Slack team and user confirmation."],
      canLink,
    };
  }

  if (binding.status === "pending_verification") {
    return {
      heading: "Slack identity pending verification",
      body: [
        `Slack team: ${binding.teamId}`,
        `Connection generation: ${binding.connectionGeneration}`,
      ],
      canLink,
    };
  }

  return {
    heading: "Slack identity linked",
    body: [
      `Slack user: ${binding.slackUserId}`,
      `Slack team: ${binding.teamId}`,
      `Binding generation: ${binding.bindingGeneration}`,
      `Connection generation: ${binding.connectionGeneration}`,
      `Verified at: ${binding.verifiedAt ?? "pending"}`,
    ],
    canLink,
  };
};
