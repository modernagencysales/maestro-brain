import type { SlackSnapshot } from "@maestro-template/integrations/nango/slack";

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
