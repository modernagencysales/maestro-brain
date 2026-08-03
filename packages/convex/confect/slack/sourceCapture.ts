import * as Schema from "effect/Schema";

import {
  ChannelAccessLost,
  ObservationInvalid,
  SourceLedgerCaptureInput,
  assertValidSourceLedgerCapture,
  buildSourceLedgerRows,
  type VerifiedSlackEnvelope,
} from "../sources/sourceSchemas";

type SlackMessage = {
  readonly channel: unknown;
  readonly ts?: unknown;
  readonly thread_ts?: unknown;
  readonly user?: unknown;
  readonly username?: unknown;
  readonly text?: unknown;
  readonly blocks?: unknown;
  readonly permalink?: unknown;
};

type SlackCaptureEnvelope = (typeof SourceLedgerCaptureInput.Type)["envelope"];
type CaptureRouting = (typeof SourceLedgerCaptureInput.Type)["routing"];
type CaptureOptions = {
  readonly envelope: SlackCaptureEnvelope;
  readonly routing: CaptureRouting;
  readonly seenTransportDeliveries?: Set<string>;
  readonly existingObservationKey?: string;
  readonly existingArtifact?: NonNullable<
    Parameters<typeof assertValidSourceLedgerCapture>[1]
  >["existingArtifact"];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
};

const stringField = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0)
    throw new ObservationInvalid("ObservationInvalid");
  return value;
};

const timestampFor = (value: unknown): string => {
  const timestamp = stringField(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(timestamp))
    throw new ObservationInvalid("ObservationInvalid");
  const millis = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(Math.round(millis)))
    throw new ObservationInvalid("ObservationInvalid");
  return new Date(millis).toISOString();
};

const messageFrom = (payload: unknown) => {
  if (!isRecord(payload) || !isRecord(payload.event))
    throw new ObservationInvalid("ObservationInvalid");
  const event = payload.event;
  if (event.type !== "message")
    throw new ObservationInvalid("ObservationInvalid");
  const subtype = event.subtype;
  const deleted = subtype === "message_deleted";
  const changed = subtype === "message_changed";
  const message = changed && isRecord(event.message) ? event.message : event;
  const previous =
    deleted && isRecord(event.previous_message) ? event.previous_message : {};
  const source = (
    deleted
      ? { ...previous, channel: event.channel, ts: event.deleted_ts }
      : message
  ) as SlackMessage;
  const eventId = stringField(payload.event_id);
  const channel = stringField(source.channel);
  const ts = stringField(source.ts);
  return {
    eventId,
    channel,
    ts,
    source,
    tombstone: deleted,
    teamId: payload.team_id,
    appId: payload.api_app_id,
  };
};

export const normalizeAdmittedSlackEvent = (
  envelope: SlackCaptureEnvelope,
  payload: unknown,
  routing: CaptureRouting,
): typeof SourceLedgerCaptureInput.Type => {
  const { eventId, channel, ts, source, tombstone, teamId, appId } =
    messageFrom(payload);
  if (channel !== envelope.externalChannelId)
    throw new ChannelAccessLost("ChannelAccessLost");
  if (
    (teamId !== undefined && teamId !== envelope.teamId) ||
    (appId !== undefined && appId !== envelope.appId)
  )
    throw new ChannelAccessLost("ChannelAccessLost");
  const threadTs = typeof source.thread_ts === "string" ? source.thread_ts : ts;
  const providerUserId =
    typeof source.user === "string" ? source.user : "unknown";
  const displayName =
    typeof source.username === "string" ? source.username : providerUserId;
  const input = {
    envelope,
    observation: {
      providerObjectId: `${channel}:${ts}`,
      threadKey: `${channel}:${threadTs}`,
      sourceTimestamp: timestampFor(ts),
      providerOrder: ts,
      providerRevisionId: eventId,
      author: { providerUserId, displayName },
      text: tombstone ? "" : typeof source.text === "string" ? source.text : "",
      blocksJson: tombstone ? "[]" : stableJson(source.blocks ?? []),
      permalink: typeof source.permalink === "string" ? source.permalink : "",
      tombstone,
      revisionNonce: eventId,
    },
    routing,
  };
  try {
    return Schema.decodeUnknownSync(SourceLedgerCaptureInput)(input);
  } catch {
    throw new ObservationInvalid("ObservationInvalid");
  }
};

export const captureAdmittedSlackEvent = (
  binding: VerifiedSlackEnvelope,
  payload: unknown,
  options: CaptureOptions,
) => {
  const validationOptions = {
    verifiedBinding: binding,
    ...(options.seenTransportDeliveries
      ? { seenTransportDeliveries: options.seenTransportDeliveries }
      : {}),
    ...(options.existingObservationKey
      ? { existingObservationKey: options.existingObservationKey }
      : {}),
    ...(options.existingArtifact
      ? { existingArtifact: options.existingArtifact }
      : {}),
  };
  return buildSourceLedgerRows(
    normalizeAdmittedSlackEvent(options.envelope, payload, options.routing),
    validationOptions,
  );
};
