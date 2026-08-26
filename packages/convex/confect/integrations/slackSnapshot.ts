import type { SlackSnapshot } from "@maestro-template/integrations/nango/slack";
import type { GenericId } from "convex/values";

const slackTimestampMillis = (timestamp: string, fallback: number) => {
  const seconds = Number.parseFloat(timestamp);
  return Number.isFinite(seconds) ? Math.floor(seconds * 1_000) : fallback;
};

export const buildSlackEvidenceItems = (
  snapshot: SlackSnapshot,
  input: {
    readonly workspaceId: GenericId<"workspaces">;
    readonly connectionRef: string;
    readonly runKey: string;
    readonly observedAt: number;
  },
) =>
  snapshot.channels.flatMap((channel) =>
    channel.messages.map((message) => ({
      workspaceId: input.workspaceId,
      provider: "slack" as const,
      scopeKey: `slack:${input.connectionRef}`,
      runKey: input.runKey,
      sourceKey: `slack:${channel.id}:message:${message.timestamp}`,
      revisionKey: message.revisionTimestamp ?? message.timestamp,
      title: `Slack · #${channel.name} · ${message.authorId}`,
      markdown: message.text.trim(),
      locator: `slack://channel/${channel.id}/message/${message.timestamp}`,
      sourceModifiedAt: slackTimestampMillis(
        message.revisionTimestamp ?? message.timestamp,
        input.observedAt,
      ),
      observedAt: input.observedAt,
    })),
  );

export const buildSlackPages = (snapshot: SlackSnapshot, syncedAt: number) =>
  snapshot.channels.map((channel) => {
    const title = `Slack · #${channel.name}`;
    const messages = channel.messages
      .map(
        (message) =>
          `### ${message.authorId} · ${message.timestamp}\n\n${message.text.trim()}\n`,
      )
      .join("\n");
    return {
      slug: `slack-${channel.id.toLowerCase()}`,
      title,
      markdown: `# ${title}\n\n> Synced from Slack channel \`${channel.id}\` at ${new Date(syncedAt).toISOString()}.\n\n${messages}`,
    };
  });
