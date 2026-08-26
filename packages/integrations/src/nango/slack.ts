import { NangoProviderUnavailable } from "./connect";

type Request = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type SlackSnapshot = {
  readonly channels: readonly {
    readonly id: string;
    readonly name: string;
    readonly messages: readonly {
      readonly timestamp: string;
      readonly authorId: string;
      readonly text: string;
    }[];
  }[];
  readonly messageCount: number;
};

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

export const fetchSlackSnapshot = async (input: {
  readonly secretKey: string;
  readonly providerConfigKey: string;
  readonly connectionId: string;
  readonly request?: Request;
}): Promise<SlackSnapshot> => {
  const request = input.request ?? fetch;
  const headers = nangoHeaders(input);
  const channelBody = await readRecord(
    await request(
      proxyUrl("conversations.list", {
        exclude_archived: "true",
        limit: "50",
        types: "public_channel,private_channel",
      }),
      { headers },
    ),
  );
  if (channelBody.ok !== true) throw new NangoProviderUnavailable();
  const channels = await Promise.all(
    recordArray(channelBody.channels)
      .slice(0, 50)
      .flatMap((channel) => {
        const id = channel.id;
        const name = channel.name;
        return typeof id === "string" && typeof name === "string"
          ? [{ id, name }]
          : [];
      })
      .map(async (channel) => {
        const history = await readRecord(
          await request(
            proxyUrl("conversations.history", {
              channel: channel.id,
              inclusive: "true",
              limit: "100",
            }),
            { headers },
          ),
        );
        if (history.ok !== true) throw new NangoProviderUnavailable();
        const messages = recordArray(history.messages)
          .slice(0, 100)
          .flatMap((message) => {
            const timestamp = message.ts;
            const text = message.text;
            const authorId = message.user ?? message.bot_id;
            return typeof timestamp === "string" &&
              typeof text === "string" &&
              text.trim().length > 0 &&
              typeof authorId === "string"
              ? [{ timestamp, authorId, text }]
              : [];
          });
        return { ...channel, messages };
      }),
  );
  return {
    channels,
    messageCount: channels.reduce(
      (total, channel) => total + channel.messages.length,
      0,
    ),
  };
};
