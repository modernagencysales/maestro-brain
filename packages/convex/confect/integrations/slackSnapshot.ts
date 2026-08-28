import type { SlackSnapshot } from "@maestro-template/integrations/nango/slack";
import type { GenericId } from "convex/values";
import { sha256Hex } from "../shared/sha256";

export const SLACK_THREAD_SEGMENT_MAX_MESSAGES = 32;
export const SLACK_THREAD_SEGMENT_MAX_CHARACTERS = 24_000;

export class SlackThreadSegmentCapacityExceeded extends Error {
  constructor(readonly timestamp: string) {
    super(
      `Slack message ${timestamp} exceeds the ${SLACK_THREAD_SEGMENT_MAX_CHARACTERS}-character evidence segment capacity.`,
    );
    this.name = "SlackThreadSegmentCapacityExceeded";
  }
}

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
) => {
  const items: Array<{
    readonly workspaceId: GenericId<"workspaces">;
    readonly provider: "slack";
    readonly scopeKey: string;
    readonly runKey: string;
    readonly sourceKey: string;
    readonly revisionKey: string;
    readonly title: string;
    readonly markdown: string;
    readonly locator: string;
    readonly providerMetadataJson: string;
    readonly providerMetadataHash: string;
    readonly sourceModifiedAt: number;
    readonly observedAt: number;
  }> = [];

  for (const channel of snapshot.channels) {
    const messages = [...channel.messages].sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp),
    );
    const threads = new Map<string, typeof messages>();
    for (const message of messages) {
      const threadRootTimestamp =
        message.threadRootTimestamp ?? message.timestamp;
      const thread = threads.get(threadRootTimestamp) ?? [];
      thread.push(message);
      threads.set(threadRootTimestamp, thread);
    }

    for (const [threadRootTimestamp, threadMessages] of [...threads].sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const segments: (typeof threadMessages)[] = [];
      let current: typeof threadMessages = [];
      let currentLength = 0;
      for (const message of threadMessages) {
        const rendered = `### ${message.authorId} · ${message.timestamp}\n\n${message.text.trim()}`;
        if (rendered.length > SLACK_THREAD_SEGMENT_MAX_CHARACTERS)
          throw new SlackThreadSegmentCapacityExceeded(message.timestamp);
        const separatorLength = current.length === 0 ? 0 : 2;
        const exceedsBounds =
          current.length >= SLACK_THREAD_SEGMENT_MAX_MESSAGES ||
          currentLength + separatorLength + rendered.length >
            SLACK_THREAD_SEGMENT_MAX_CHARACTERS;
        if (exceedsBounds) {
          segments.push(current);
          current = [];
          currentLength = 0;
        }
        currentLength += (current.length === 0 ? 0 : 2) + rendered.length;
        current.push(message);
      }
      if (current.length > 0) segments.push(current);

      segments.forEach((segment, segmentIndex) => {
        let markdown = "";
        const messageRefs = segment.map((message) => {
          if (markdown.length > 0) markdown += "\n\n";
          const header = `### ${message.authorId} · ${message.timestamp}\n\n`;
          markdown += header;
          const renderedStartOffset = markdown.length;
          markdown += message.text.trim();
          return {
            timestamp: message.timestamp,
            revisionTimestamp: message.revisionTimestamp ?? message.timestamp,
            authorId: message.authorId,
            locator: `slack://channel/${channel.id}/message/${message.timestamp}`,
            renderedStartOffset,
            renderedEndOffset: markdown.length,
          };
        });
        const revisionInput = {
          schemaVersion: 1,
          channelId: channel.id,
          threadRootTimestamp,
          segmentIndex,
          segmentCount: segments.length,
          messages: segment.map((message) => ({
            timestamp: message.timestamp,
            revisionTimestamp: message.revisionTimestamp ?? message.timestamp,
            threadRootTimestamp:
              message.threadRootTimestamp ?? message.timestamp,
            parentTimestamp: message.parentTimestamp ?? null,
            authorId: message.authorId,
            textHash: sha256Hex(message.text.trim()),
          })),
        };
        const providerMetadataJson = JSON.stringify({
          schemaVersion: 1,
          channelId: channel.id,
          channelName: channel.name,
          threadRootTimestamp,
          segmentIndex,
          segmentCount: segments.length,
          messageRefs,
        });
        const providerMetadataHash = sha256Hex(providerMetadataJson);
        const title = `Slack · #${channel.name} · Thread ${threadRootTimestamp}`;
        items.push({
          workspaceId: input.workspaceId,
          provider: "slack",
          scopeKey: `slack:${input.connectionRef}`,
          runKey: input.runKey,
          sourceKey: `slack:${channel.id}:thread:${threadRootTimestamp}:segment:${segmentIndex}`,
          revisionKey: `thread-v1:${sha256Hex(
            JSON.stringify({
              revisionInput,
              providerMetadataHash,
              title,
              markdownHash: sha256Hex(markdown),
            }),
          )}`,
          title,
          markdown,
          locator: `slack://channel/${channel.id}/message/${threadRootTimestamp}`,
          providerMetadataJson,
          providerMetadataHash,
          sourceModifiedAt: segment.reduce(
            (latest, message) =>
              Math.max(
                latest,
                slackTimestampMillis(
                  message.revisionTimestamp ?? message.timestamp,
                  input.observedAt,
                ),
              ),
            0,
          ),
          observedAt: input.observedAt,
        });
      });
    }
  }

  return items;
};

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
