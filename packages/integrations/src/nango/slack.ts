import { NangoProviderUnavailable } from "./connect";

type Request = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type SlackSnapshot = {
  readonly channels: readonly {
    readonly id: string;
    readonly name: string;
    readonly messages: readonly {
      readonly timestamp: string;
      readonly revisionTimestamp?: string;
      readonly authorId: string;
      readonly text: string;
    }[];
  }[];
  readonly messageCount: number;
};

export type SlackSnapshotLimits = Readonly<{
  maxChannels?: number;
  maxMessagesPerChannel?: number;
  maxMessagesTotal?: number;
  maxPagesPerCollection?: number;
}>;

export class SlackSnapshotCapacityExceeded extends Error {
  readonly resource: "channels" | "messages" | "pages";
  readonly capacity: number;

  constructor(
    resource: SlackSnapshotCapacityExceeded["resource"],
    capacity: number,
  ) {
    super(`Slack snapshot ${resource} capacity of ${capacity} was exceeded.`);
    this.name = "SlackSnapshotCapacityExceeded";
    this.resource = resource;
    this.capacity = capacity;
  }
}

export class SlackChannelAllowlistInvalid extends Error {
  readonly resource = "channels" as const;

  constructor(readonly missingChannelIds: readonly string[]) {
    super(
      missingChannelIds.length === 0
        ? "Slack snapshot requires at least one approved channel."
        : `Slack snapshot could not resolve approved channels: ${missingChannelIds.join(", ")}.`,
    );
    this.name = "SlackChannelAllowlistInvalid";
  }
}

const DEFAULT_MAX_CHANNELS = 500;
const DEFAULT_MAX_MESSAGES_PER_CHANNEL = 10_000;
const DEFAULT_MAX_MESSAGES_TOTAL = 20_000;
const DEFAULT_MAX_PAGES_PER_COLLECTION = 100;

const positiveLimit = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isSafeInteger(value) || value < 1
    ? fallback
    : value;

const nangoHeaders = (input: {
  readonly secretKey: string;
  readonly providerConfigKey: string;
  readonly connectionId: string;
}) => ({
  Authorization: `Bearer ${input.secretKey}`,
  "Connection-Id": input.connectionId,
  "Provider-Config-Key": input.providerConfigKey,
});

const readRecord = async (
  response: Response,
): Promise<Record<string, unknown>> => {
  if (!response.ok) throw new NangoProviderUnavailable();
  try {
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null)
      throw new NangoProviderUnavailable();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof NangoProviderUnavailable) throw error;
    throw new NangoProviderUnavailable();
  }
};

const recordArray = (value: unknown): readonly Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];

const proxyUrl = (method: string, query: Record<string, string>) => {
  const url = new URL(`https://api.nango.dev/proxy/${method}`);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, value);
  return url;
};

const nextCursor = (body: Record<string, unknown>): string | undefined => {
  const metadata = body.response_metadata;
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const cursor = (metadata as Record<string, unknown>).next_cursor;
  return typeof cursor === "string" && cursor.trim().length > 0
    ? cursor.trim()
    : undefined;
};

const fetchCollection = async (input: {
  readonly method: string;
  readonly itemKey: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly request: Request;
  readonly maxPages: number;
}): Promise<readonly Record<string, unknown>[]> => {
  const items: Record<string, unknown>[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;

  do {
    if (pageCount >= input.maxPages)
      throw new SlackSnapshotCapacityExceeded("pages", input.maxPages);
    const body = await readRecord(
      await input.request(
        proxyUrl(input.method, {
          ...input.query,
          ...(cursor === undefined ? {} : { cursor }),
        }),
        { headers: input.headers },
      ),
    );
    if (body.ok !== true) throw new NangoProviderUnavailable();
    items.push(...recordArray(body[input.itemKey]));
    pageCount += 1;
    cursor = nextCursor(body);
    if (cursor !== undefined) {
      if (seenCursors.has(cursor)) throw new NangoProviderUnavailable();
      seenCursors.add(cursor);
    }
  } while (cursor !== undefined);

  return items;
};

type SlackMessage = SlackSnapshot["channels"][number]["messages"][number];

const projectMessage = (
  message: Record<string, unknown>,
): SlackMessage | undefined => {
  const timestamp = message.ts;
  const text = message.text;
  const authorId = message.user ?? message.bot_id;
  const edited = message.edited;
  const editedTimestamp =
    typeof edited === "object" && edited !== null
      ? (edited as Record<string, unknown>).ts
      : undefined;
  return typeof timestamp === "string" &&
    typeof text === "string" &&
    text.trim().length > 0 &&
    typeof authorId === "string"
    ? {
        timestamp,
        revisionTimestamp:
          typeof editedTimestamp === "string" ? editedTimestamp : timestamp,
        authorId,
        text,
      }
    : undefined;
};

const hasReplies = (message: Record<string, unknown>): boolean =>
  typeof message.reply_count === "number" && message.reply_count > 0;

const loadChannelMessages = async (input: {
  readonly channelId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly request: Request;
  readonly maxMessages: number;
  readonly maxPages: number;
}): Promise<SlackMessage[]> => {
  const history = await fetchCollection({
    method: "conversations.history",
    itemKey: "messages",
    query: { channel: input.channelId, inclusive: "true", limit: "100" },
    headers: input.headers,
    request: input.request,
    maxPages: input.maxPages,
  });
  const messages: SlackMessage[] = [];
  const seenTimestamps = new Set<string>();
  const append = (message: Record<string, unknown>) => {
    const projected = projectMessage(message);
    if (projected === undefined || seenTimestamps.has(projected.timestamp))
      return;
    if (messages.length >= input.maxMessages)
      throw new SlackSnapshotCapacityExceeded("messages", input.maxMessages);
    seenTimestamps.add(projected.timestamp);
    messages.push(projected);
  };

  for (const message of history) {
    append(message);
    if (!hasReplies(message) || typeof message.ts !== "string") continue;
    const replies = await fetchCollection({
      method: "conversations.replies",
      itemKey: "messages",
      query: {
        channel: input.channelId,
        ts: message.ts,
        inclusive: "true",
        limit: "100",
      },
      headers: input.headers,
      request: input.request,
      maxPages: input.maxPages,
    });
    for (const reply of replies) append(reply);
  }

  return messages;
};

export const fetchSlackSnapshot = async (input: {
  readonly secretKey: string;
  readonly providerConfigKey: string;
  readonly connectionId: string;
  readonly channelIds: readonly string[];
  readonly request?: Request;
  readonly limits?: SlackSnapshotLimits;
}): Promise<SlackSnapshot> => {
  const request = input.request ?? fetch;
  const headers = nangoHeaders(input);
  const maxChannels = positiveLimit(
    input.limits?.maxChannels,
    DEFAULT_MAX_CHANNELS,
  );
  const maxMessages = positiveLimit(
    input.limits?.maxMessagesPerChannel,
    DEFAULT_MAX_MESSAGES_PER_CHANNEL,
  );
  const maxMessagesTotal = positiveLimit(
    input.limits?.maxMessagesTotal,
    DEFAULT_MAX_MESSAGES_TOTAL,
  );
  const maxPages = positiveLimit(
    input.limits?.maxPagesPerCollection,
    DEFAULT_MAX_PAGES_PER_COLLECTION,
  );
  const approvedChannelIds = [
    ...new Set(input.channelIds.map((channelId) => channelId.trim())),
  ].filter(Boolean);
  if (approvedChannelIds.length === 0)
    throw new SlackChannelAllowlistInvalid([]);
  if (approvedChannelIds.length > maxChannels)
    throw new SlackSnapshotCapacityExceeded("channels", maxChannels);
  const channelRecords = await fetchCollection({
    method: "conversations.list",
    itemKey: "channels",
    query: {
      exclude_archived: "true",
      limit: "100",
      types: "public_channel,private_channel",
    },
    headers,
    request,
    maxPages,
  });
  const channelIdentities = channelRecords.flatMap((channel) => {
    const id = channel.id;
    const name = channel.name;
    return typeof id === "string" && typeof name === "string"
      ? [{ id, name }]
      : [];
  });
  const channelById = new Map(
    channelIdentities.map((channel) => [channel.id, channel] as const),
  );
  const missingChannelIds = approvedChannelIds.filter(
    (channelId) => !channelById.has(channelId),
  );
  if (missingChannelIds.length > 0)
    throw new SlackChannelAllowlistInvalid(missingChannelIds);
  const approvedChannels = approvedChannelIds
    .map((channelId) => channelById.get(channelId))
    .filter(
      (channel): channel is { readonly id: string; readonly name: string } =>
        channel !== undefined,
    );

  const channels: SlackSnapshot["channels"][number][] = [];
  for (const channel of approvedChannels) {
    channels.push({
      ...channel,
      messages: await loadChannelMessages({
        channelId: channel.id,
        headers,
        request,
        maxMessages,
        maxPages,
      }),
    });
    if (
      channels.reduce((total, item) => total + item.messages.length, 0) >
      maxMessagesTotal
    )
      throw new SlackSnapshotCapacityExceeded("messages", maxMessagesTotal);
  }
  return {
    channels,
    messageCount: channels.reduce(
      (total, channel) => total + channel.messages.length,
      0,
    ),
  };
};
