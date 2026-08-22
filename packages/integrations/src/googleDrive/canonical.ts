import { sha256Hex } from "@maestro-template/template-core/sha256";
import * as Schema from "effect/Schema";

const PositiveInteger = Schema.Number.pipe(Schema.int(), Schema.greaterThan(0));
const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const IsoTimestamp = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
);

export const DriveConnectorScopeInput = Schema.Struct({
  connectionKey: NonEmptyString,
  connectionGeneration: PositiveInteger,
  driveId: NonEmptyString,
  rootFolderIds: Schema.Array(NonEmptyString).pipe(Schema.minItems(1)),
  allowlistGeneration: PositiveInteger,
  sharedDrive: Schema.Boolean,
});
export type DriveConnectorScopeInput = typeof DriveConnectorScopeInput.Type;

export const DriveFileRecord = Schema.Struct({
  id: NonEmptyString,
  name: NonEmptyString,
  mimeType: NonEmptyString,
  version: Schema.NullOr(NonEmptyString),
  modifiedTime: IsoTimestamp,
  webViewLink: NonEmptyString,
  trashed: Schema.Boolean,
  parents: Schema.Array(NonEmptyString),
});
export type DriveFileRecord = typeof DriveFileRecord.Type;

export const DriveObservationOrder = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("file_version"),
    version: NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("reconciliation_epoch"),
    epoch: PositiveInteger,
  }),
);
export type DriveObservationOrder = typeof DriveObservationOrder.Type;

export class DriveSourceDecodeError extends Schema.TaggedError<DriveSourceDecodeError>()(
  "DriveSourceDecodeError",
  {
    reason: Schema.Literal(
      "invalid_scope",
      "personal_drive_not_allowed",
      "invalid_file",
      "unsupported_mime_type",
      "shortcut_not_supported",
      "missing_export",
      "observation_order_missing",
    ),
    detail: Schema.String,
  },
) {}

export type DriveConnectorScope = Readonly<{
  connectionKey: string;
  connectionGeneration: number;
  driveId: string;
  rootFolderIds: readonly string[];
  allowlistGeneration: number;
  connectorScopeKey: string;
}>;

export type CanonicalDriveRevision = Readonly<{
  providerKey: "google_drive";
  connectionKey: string;
  connectionGeneration: number;
  connectorScopeKey: string;
  allowlistGeneration: number;
  providerObjectKey: string;
  providerRevisionKey: string;
  observationOrder: DriveObservationOrder;
  title: string;
  sourceMimeType: string;
  exportMimeType: string | null;
  normalizedText: string;
  normalizationVersion: 1;
  contentHash: string;
  sourceModifiedAt: number;
  observedAt: number;
  sourceLocator: string;
  parentFolderIds: readonly string[];
  permissionSnapshotHash: string;
  retentionClass: string;
  tombstone: boolean;
  removalEvidence: "trashed" | "closed_reconciliation" | null;
}>;

export type DriveObservationClassification =
  | "duplicate"
  | "stale"
  | "newer"
  | "equal_order_conflict"
  | "order_conflict"
  | "tombstone"
  | "recreated";

const supportedMimeTypes = new Set([
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.google-apps.document",
]);

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const decode = <A, I>(
  schema: Schema.Schema<A, I>,
  value: unknown,
  reason: "invalid_scope" | "invalid_file",
): A => {
  try {
    return Schema.decodeUnknownSync(schema)(value);
  } catch {
    throw new DriveSourceDecodeError({
      reason,
      detail:
        reason === "invalid_scope"
          ? "The Drive scope is malformed."
          : "The Drive file record is malformed.",
    });
  }
};

const numericOrder = (value: string): bigint | null =>
  /^\d+$/.test(value) ? BigInt(value) : null;

export const normalizeDriveText = (value: string): string =>
  value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const driveConnectorScope = (
  input: DriveConnectorScopeInput,
): DriveConnectorScope => {
  const decoded = decode(DriveConnectorScopeInput, input, "invalid_scope");
  if (!decoded.sharedDrive) {
    throw new DriveSourceDecodeError({
      reason: "personal_drive_not_allowed",
      detail:
        "The Company Brain pilot accepts only explicit Shared Drive scopes.",
    });
  }
  const rootFolderIds = [...new Set(decoded.rootFolderIds)].sort();
  const identity = {
    connectionKey: decoded.connectionKey,
    connectionGeneration: decoded.connectionGeneration,
    driveId: decoded.driveId,
    rootFolderIds,
    allowlistGeneration: decoded.allowlistGeneration,
  };
  return {
    ...identity,
    connectorScopeKey: `gds_${sha256Hex(stableJson(identity))}`,
  };
};

export const normalizeDriveFile = (
  input: Readonly<{
    scope: DriveConnectorScopeInput;
    file: DriveFileRecord;
    exportMimeType: string | null;
    exportedText: string | null;
    closedReconciliationEpoch?: number;
    observedAt: number;
    permissionSnapshotHash: string;
    retentionClass: string;
  }>,
): CanonicalDriveRevision => {
  const scope = driveConnectorScope(input.scope);
  const file = decode(DriveFileRecord, input.file, "invalid_file");
  if (file.mimeType === "application/vnd.google-apps.shortcut") {
    throw new DriveSourceDecodeError({
      reason: "shortcut_not_supported",
      detail:
        "Drive shortcuts require independent target and membership proof.",
    });
  }
  if (!supportedMimeTypes.has(file.mimeType)) {
    throw new DriveSourceDecodeError({
      reason: "unsupported_mime_type",
      detail: `Drive MIME type ${file.mimeType} is not enabled for this source.`,
    });
  }
  if (!/^[a-f0-9]{64}$/.test(input.permissionSnapshotHash)) {
    throw new DriveSourceDecodeError({
      reason: "invalid_file",
      detail: "The permission snapshot hash is malformed.",
    });
  }
  const tombstone = file.trashed;
  if (
    !tombstone &&
    (input.exportedText === null || input.exportMimeType === null)
  ) {
    throw new DriveSourceDecodeError({
      reason: "missing_export",
      detail:
        "An eligible Drive file must include its deterministic text export.",
    });
  }
  const version = file.version === null ? null : numericOrder(file.version);
  const reconciliationEpoch = input.closedReconciliationEpoch;
  const observationOrder: DriveObservationOrder =
    version !== null
      ? { kind: "file_version", version: version.toString() }
      : reconciliationEpoch !== undefined &&
          Number.isSafeInteger(reconciliationEpoch) &&
          reconciliationEpoch > 0
        ? { kind: "reconciliation_epoch", epoch: reconciliationEpoch }
        : (() => {
            throw new DriveSourceDecodeError({
              reason: "observation_order_missing",
              detail:
                "Drive evidence needs a provider version or a successfully closed reconciliation epoch.",
            });
          })();
  const normalizedText = tombstone
    ? ""
    : normalizeDriveText(input.exportedText ?? "");
  const contentHash = sha256Hex(normalizedText);
  const providerRevisionKey =
    observationOrder.kind === "file_version"
      ? `${file.id}:version:${observationOrder.version}`
      : `${file.id}:reconciliation:${observationOrder.epoch}`;
  const sourceModifiedAt = Date.parse(file.modifiedTime);
  return {
    providerKey: "google_drive",
    connectionKey: scope.connectionKey,
    connectionGeneration: scope.connectionGeneration,
    connectorScopeKey: scope.connectorScopeKey,
    allowlistGeneration: scope.allowlistGeneration,
    providerObjectKey: file.id,
    providerRevisionKey,
    observationOrder,
    title: file.name,
    sourceMimeType: file.mimeType,
    exportMimeType: tombstone ? null : input.exportMimeType,
    normalizedText,
    normalizationVersion: 1,
    contentHash,
    sourceModifiedAt,
    observedAt: input.observedAt,
    sourceLocator: file.webViewLink,
    parentFolderIds: [...new Set(file.parents)].sort(),
    permissionSnapshotHash: input.permissionSnapshotHash,
    retentionClass: input.retentionClass,
    tombstone,
    removalEvidence: tombstone
      ? observationOrder.kind === "reconciliation_epoch"
        ? "closed_reconciliation"
        : "trashed"
      : null,
  };
};

const compareOrder = (
  left: DriveObservationOrder,
  right: DriveObservationOrder,
): -1 | 0 | 1 | null => {
  if (left.kind !== right.kind) return null;
  const leftValue =
    left.kind === "file_version" ? BigInt(left.version) : BigInt(left.epoch);
  const rightValue =
    right.kind === "file_version" ? BigInt(right.version) : BigInt(right.epoch);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
};

export const classifyDriveObservation = (
  current: CanonicalDriveRevision,
  incoming: CanonicalDriveRevision,
): DriveObservationClassification => {
  if (
    current.connectorScopeKey !== incoming.connectorScopeKey ||
    current.providerObjectKey !== incoming.providerObjectKey
  ) {
    return "order_conflict";
  }
  if (current.tombstone && !incoming.tombstone) return "recreated";
  if (!current.tombstone && incoming.tombstone) return "tombstone";
  const order = compareOrder(
    current.observationOrder,
    incoming.observationOrder,
  );
  if (order === null) return "order_conflict";
  if (order < 0) return "newer";
  if (order > 0) return "stale";
  return current.contentHash === incoming.contentHash &&
    current.permissionSnapshotHash === incoming.permissionSnapshotHash &&
    current.tombstone === incoming.tombstone
    ? "duplicate"
    : "equal_order_conflict";
};
