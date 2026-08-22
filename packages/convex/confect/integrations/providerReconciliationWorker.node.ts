"use node";

import type { NangoClient } from "@maestro-template/integrations/nango/client";
import { makeDriveApiClient } from "@maestro-template/integrations/googleDrive/client";

import { sha256Hex } from "../shared/sha256";
import { prepareSlackReconciliationWrite } from "./slackReconciliationAdapter";

type SlackMessage = Record<string, unknown>;

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const slackPage = (value: unknown) => {
  const payload = object(value);
  if (payload?.ok !== true || !Array.isArray(payload.messages))
    throw new Error("Slack reconciliation page is invalid");
  const metadata = object(payload.response_metadata);
  return {
    messages: payload.messages.flatMap((message) =>
      object(message) === null ? [] : [message as SlackMessage],
    ),
    nextCursor: string(metadata?.next_cursor),
  };
};

const slackProxyPage = async (
  client: NangoClient,
  input: {
    readonly connectionId: string;
    readonly endpoint: string;
  },
) => {
  const response = await client.proxy({
    connectionId: input.connectionId,
    endpoint: input.endpoint,
    method: "GET",
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error("Slack reconciliation provider read failed");
  return slackPage(response.data);
};

const allThreadMessages = async (
  client: NangoClient,
  input: {
    readonly connectionId: string;
    readonly channelId: string;
    readonly threadTs: string;
  },
): Promise<readonly SlackMessage[]> => {
  const messages: SlackMessage[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({
      channel: input.channelId,
      ts: input.threadTs,
      limit: "100",
      ...(cursor === null ? {} : { cursor }),
    });
    const page = await slackProxyPage(client, {
      connectionId: input.connectionId,
      endpoint: `/conversations.replies?${query.toString()}`,
    });
    messages.push(...page.messages);
    if (messages.length > 6_400)
      throw new Error("Slack reconciliation thread exceeds page capacity");
    cursor = page.nextCursor;
  } while (cursor !== null);
  return messages;
};

const preparedSlackWrite = (input: {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly connectorScopeKey: string;
  readonly channelId: string;
  readonly teamId: string;
  readonly appId: string;
  readonly botUserId: string;
  readonly routingPolicyEpoch: number;
  readonly receivedAt: number;
  readonly message: SlackMessage;
}) => {
  const subtype = string(input.message.subtype);
  const deleted = subtype === "message_deleted";
  const previous = object(input.message.previous_message);
  const message = deleted && previous !== null ? previous : input.message;
  const ts = string(message.ts) ?? string(input.message.deleted_ts);
  if (ts === null) throw new Error("Slack message timestamp is missing");
  const editedTs = string(object(message.edited)?.ts);
  const revisionId = editedTs ?? ts;
  const threadTs = string(message.thread_ts) ?? ts;
  const authorId = string(message.user) ?? string(message.bot_id) ?? "unknown";
  const text = deleted ? "" : (string(message.text) ?? "");
  const identity = sha256Hex(
    JSON.stringify({
      organizationKey: input.organizationKey,
      connectionKey: input.connectionKey,
      connectionGeneration: input.connectionGeneration,
      channelId: input.channelId,
      ts,
      revisionId,
      deleted,
      text,
    }),
  );
  const receiptHash = `sha256:${sha256Hex(
    JSON.stringify({ kind: "provider_read", identity }),
  )}`;
  const receivedAt = input.receivedAt;
  const sourceTimestamp = new Date(Number(ts) * 1_000).toISOString();
  return prepareSlackReconciliationWrite({
    binding: {
      providerEventId: `reconciliation:${identity}`,
      signatureVerification: { status: "verified", receiptHash },
      replayVerification: { status: "accepted", receiptHash },
      organizationKey: input.organizationKey,
      connectionKey: input.connectionKey,
      connectionGeneration: input.connectionGeneration,
      teamId: input.teamId,
      appId: input.appId,
      botUserId: input.botUserId,
      channelKey: input.connectorScopeKey,
      externalChannelId: input.channelId,
    },
    input: {
      envelope: {
        organizationKey: input.organizationKey,
        connectionKey: input.connectionKey,
        connectionGeneration: input.connectionGeneration,
        teamId: input.teamId,
        appId: input.appId,
        botUserId: input.botUserId,
        channelKey: input.connectorScopeKey,
        externalChannelId: input.channelId,
        transport: "reconciliation",
        transportDeliveryId: `reconciliation:${identity}`,
        receivedAt,
      },
      observation: {
        providerObjectId: ts,
        threadKey: threadTs,
        sourceTimestamp,
        providerOrder: revisionId,
        providerRevisionId: revisionId,
        author: { providerUserId: authorId, displayName: authorId },
        text,
        blocksJson: JSON.stringify(message.blocks ?? []),
        permalink: `https://app.slack.com/client/${encodeURIComponent(input.teamId)}/${encodeURIComponent(input.channelId)}/${encodeURIComponent(ts)}`,
        tombstone: deleted,
        revisionNonce: `reconciliation:${identity}`,
      },
      routing: {
        policyEpoch: input.routingPolicyEpoch,
        assemblyStage: "assembly_pending",
        effectKey: `reconciliation:${identity}`,
      },
    },
  });
};

export const fetchSlackReconciliationPage = async (input: {
  readonly client: NangoClient;
  readonly connectionId: string;
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly connectorScopeKey: string;
  readonly channelId: string;
  readonly teamId: string;
  readonly appId: string;
  readonly botUserId: string;
  readonly routingPolicyEpoch: number;
  readonly cursor: string | null;
  readonly receivedAt: number;
}) => {
  const query = new URLSearchParams({
    channel: input.channelId,
    limit: "20",
    inclusive: "true",
    ...(input.cursor === null ? {} : { cursor: input.cursor }),
  });
  const history = await slackProxyPage(input.client, {
    connectionId: input.connectionId,
    endpoint: `/conversations.history?${query.toString()}`,
  });
  const messages: SlackMessage[] = [];
  for (const message of history.messages) {
    const threadTs = string(message.thread_ts) ?? string(message.ts);
    if (
      threadTs !== null &&
      typeof message.reply_count === "number" &&
      message.reply_count > 0
    ) {
      const thread = await allThreadMessages(input.client, {
        connectionId: input.connectionId,
        channelId: input.channelId,
        threadTs,
      });
      messages.push(...thread);
    } else messages.push(message);
  }
  const uniqueMessages = [
    ...new Map(
      messages.map((message) => [
        `${string(message.ts) ?? string(message.deleted_ts) ?? ""}:${string(object(message.edited)?.ts) ?? ""}:${string(message.subtype) ?? ""}`,
        message,
      ]),
    ).values(),
  ];
  if (uniqueMessages.length > 6_400)
    throw new Error("Slack reconciliation page exceeds transaction capacity");
  return {
    writes: uniqueMessages.map((message) =>
      preparedSlackWrite({ ...input, message }),
    ),
    cursorAfter: history.nextCursor,
    terminal: history.nextCursor === null,
  } as const;
};

export const makeNangoDriveReconciliationClient = (input: {
  readonly client: NangoClient;
  readonly connectionId: string;
}) =>
  makeDriveApiClient({
    accessToken: "nango-proxy",
    fetch: async (url, init) => {
      const parsed = new URL(url);
      const response = await input.client.proxy({
        connectionId: input.connectionId,
        endpoint: `${parsed.pathname}${parsed.search}`,
        method: init?.method === "POST" ? "POST" : "GET",
        ...(init?.body === undefined ? {} : { data: init.body }),
      });
      const body =
        typeof response.data === "string"
          ? response.data
          : JSON.stringify(response.data ?? {});
      return new Response(body, {
        status: response.status,
        ...(response.headers === undefined
          ? {}
          : { headers: response.headers as Record<string, string> }),
      });
    },
  });
