import { CanonicalTranscriptRevisionOrder } from "@maestro-template/integrations/transcripts/canonical";
import * as Schema from "effect/Schema";

export const TranscriptAdapterOrderVersion = Schema.Literal(
  "transcript-adapter-order-v1",
);
export type TranscriptAdapterOrderVersion =
  typeof TranscriptAdapterOrderVersion.Type;

export const TRANSCRIPT_ADAPTER_ORDER_VERSION =
  "transcript-adapter-order-v1" as const satisfies TranscriptAdapterOrderVersion;

export const TranscriptRevisionOrderConflictKind = Schema.Literal(
  "current_revision_missing",
  "current_revision_mismatch",
  "missing_provider_version",
  "missing_order_evidence",
  "adapter_contract_mismatch",
  "equal_order_content",
  "ambiguous_tombstone_recreation",
  "revision_history_capacity",
  "concurrent_revision_change",
);
export type TranscriptRevisionOrderConflictKind =
  typeof TranscriptRevisionOrderConflictKind.Type;

type RevisionOrder = typeof CanonicalTranscriptRevisionOrder.Type;

const providerTimestampSources = {
  fireflies: {
    active: ["updated_at", "date"],
    tombstone: ["_nango_metadata.deleted_at"],
  },
  gong: {
    active: ["call.updated_at", "transcript.updated_at", "started"],
    tombstone: [
      "call._nango_metadata.deleted_at",
      "transcript._nango_metadata.deleted_at",
    ],
  },
  fathom: {
    active: ["updated_at", "recording_end_time", "created_at"],
    tombstone: ["_nango_metadata.deleted_at"],
  },
  granola: {
    active: ["updated_at", "created_at"],
    tombstone: ["_nango_metadata.deleted_at"],
  },
} as const;

type TimestampProvider = keyof typeof providerTimestampSources;

const isTimestampProvider = (
  providerKey: string,
): providerKey is TimestampProvider =>
  Object.prototype.hasOwnProperty.call(providerTimestampSources, providerKey);

export const transcriptRevisionOrderMatchesFrozenContract = (input: {
  readonly providerKey: string;
  readonly tombstone: boolean;
  readonly revisionOrder: RevisionOrder;
}): boolean => {
  if (input.revisionOrder.kind === "reconciliation_epoch")
    return (
      input.revisionOrder.epoch > 0 &&
      (input.providerKey !== "manual-transcript" ||
        (!input.tombstone && input.revisionOrder.epoch === 1))
    );
  if (!isTimestampProvider(input.providerKey)) return false;
  const allowed = input.tombstone
    ? providerTimestampSources[input.providerKey].tombstone
    : providerTimestampSources[input.providerKey].active;
  return (allowed as readonly string[]).includes(input.revisionOrder.source);
};

const normalizedProviderTimestamp = (
  source: string,
  candidate: unknown,
): RevisionOrder | null => {
  if (typeof candidate !== "string" || candidate.trim().length === 0)
    return null;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp)
    ? {
        kind: "provider_timestamp",
        timestamp: new Date(timestamp).toISOString(),
        source,
      }
    : null;
};

export const deriveFrozenLegacyTranscriptRevisionOrder = (input: {
  readonly providerKey: string;
  readonly tombstone: boolean;
  readonly providerMetadataJson: string;
  readonly historyCount: number;
}): RevisionOrder | null => {
  if (input.providerKey === "manual-transcript")
    return !input.tombstone && input.historyCount === 1
      ? { kind: "reconciliation_epoch", epoch: 1 }
      : null;
  if (input.providerKey !== "granola" || input.tombstone) return null;
  try {
    const metadata = JSON.parse(input.providerMetadataJson) as unknown;
    if (metadata === null || typeof metadata !== "object") return null;
    return normalizedProviderTimestamp(
      "updated_at",
      (metadata as Record<string, unknown>).updatedAt,
    );
  } catch {
    return null;
  }
};

export const sameTranscriptRevisionOrder = (
  left: RevisionOrder,
  right: RevisionOrder,
): boolean => JSON.stringify(left) === JSON.stringify(right);

export const transcriptRevisionOrderDigestInput = (order: RevisionOrder) =>
  order.kind === "provider_timestamp"
    ? {
        kind: order.kind,
        timestamp: order.timestamp,
        source: order.source,
      }
    : { kind: order.kind, epoch: order.epoch };
