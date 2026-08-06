export type SlackLinkStatusView = Readonly<{
  heading: string;
  body: readonly string[];
  canLink: boolean;
}>;

type SlackLinkInput = Readonly<{
  workspace: Readonly<{ organizationId: string; workspaceId: string }> | null;
  viewerRole: string;
  binding?: Readonly<{
    status: string;
    teamId: string;
    slackUserId: string;
    connectionGeneration: number;
    bindingGeneration: number;
    verifiedAt: number;
  }> | null;
}>;

export const buildSlackLinkStatusView = (
  input: SlackLinkInput,
): SlackLinkStatusView => {
  if (input.workspace === null)
    return {
      heading: "Slack identity link unavailable",
      body: ["Slack linking requires a server-derived active workspace."],
      canLink: false,
    };

  const binding = input.binding;
  if (binding?.status === "active")
    return {
      heading: "Slack identity linked",
      body: [
        `Slack user: ${binding.slackUserId}`,
        `Slack team: ${binding.teamId}`,
        `Binding generation: ${binding.bindingGeneration}`,
        `Connection generation: ${binding.connectionGeneration}`,
        `Verified at: ${binding.verifiedAt}`,
      ],
      canLink: true,
    };

  return {
    heading: "Slack identity not linked",
    body: ["Link your verified Slack identity to use private answers."],
    canLink: true,
  };
};

export const redactSlackLinkToken = (token: string): string =>
  token.startsWith("slack-link:") ? "slack-link:[redacted]" : "[redacted]";
