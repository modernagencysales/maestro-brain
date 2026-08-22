import { DriveObservationOrder } from "@maestro-template/integrations/googleDrive/canonical";
import * as Schema from "effect/Schema";

const PositiveInteger = Schema.Number.pipe(Schema.int(), Schema.greaterThan(0));
const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
);
const NonEmptyString = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(2_048),
);
export const DriveHexDigest = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{64}$/),
);
export const DriveConnectorScopeKey = Schema.String.pipe(
  Schema.pattern(/^gds_[a-f0-9]{64}$/),
);
export const DocumentObjectKey = Schema.String.pipe(
  Schema.pattern(/^gdobj_[a-f0-9]{64}$/),
);
export const DocumentRevisionKey = Schema.String.pipe(
  Schema.pattern(/^gdrev_[a-f0-9]{64}$/),
);
export const DocumentObservationKey = Schema.String.pipe(
  Schema.pattern(/^gdobs_[a-f0-9]{64}$/),
);
export const DocumentMembershipEdgeKey = Schema.String.pipe(
  Schema.pattern(/^gdmem_[a-f0-9]{64}$/),
);
export const DocumentOutcomeKey = Schema.String.pipe(
  Schema.pattern(/^gdout_[a-f0-9]{64}$/),
);
export const DrivePassageKey = Schema.String.pipe(
  Schema.pattern(/^gdp_[a-f0-9]{64}$/),
);

export const DriveLedgerClassification = Schema.Literal(
  "created",
  "newer",
  "duplicate",
  "stale",
  "equal_order_conflict",
  "order_conflict",
  "tombstone",
  "recreated",
  "superseded",
);
export type DriveLedgerClassification = typeof DriveLedgerClassification.Type;

export const DriveCanonicalRevisionSchema = Schema.Struct({
  providerKey: Schema.Literal("google_drive"),
  connectionKey: NonEmptyString,
  connectionGeneration: PositiveInteger,
  connectorScopeKey: DriveConnectorScopeKey,
  allowlistGeneration: PositiveInteger,
  providerObjectKey: NonEmptyString,
  providerRevisionKey: NonEmptyString,
  observationOrder: DriveObservationOrder,
  title: NonEmptyString,
  sourceMimeType: NonEmptyString,
  exportMimeType: Schema.NullOr(NonEmptyString),
  normalizedText: Schema.String.pipe(Schema.maxLength(524_288)),
  normalizationVersion: Schema.Literal(1),
  contentHash: DriveHexDigest,
  sourceModifiedAt: NonNegativeInteger,
  observedAt: NonNegativeInteger,
  sourceLocator: NonEmptyString,
  parentFolderIds: Schema.Array(NonEmptyString).pipe(Schema.maxItems(100)),
  permissionSnapshotHash: DriveHexDigest,
  retentionClass: NonEmptyString,
  tombstone: Schema.Boolean,
  removalEvidence: Schema.NullOr(
    Schema.Literal("trashed", "closed_reconciliation"),
  ),
});
export type DriveCanonicalRevision = typeof DriveCanonicalRevisionSchema.Type;

export const CommitDriveObservationArgs = Schema.Struct({
  organizationKey: NonEmptyString,
  revision: DriveCanonicalRevisionSchema,
  expectedIncarnation: Schema.NullOr(PositiveInteger),
});
export type CommitDriveObservationArgs = typeof CommitDriveObservationArgs.Type;

export const CommitDriveObservationResult = Schema.Struct({
  classification: DriveLedgerClassification,
  documentObjectKey: DocumentObjectKey,
  documentRevisionKey: Schema.NullOr(DocumentRevisionKey),
  observationKey: DocumentObservationKey,
  membershipEdgeKey: Schema.NullOr(DocumentMembershipEdgeKey),
  incarnation: PositiveInteger,
  passageCount: NonNegativeInteger,
});
export type CommitDriveObservationResult =
  typeof CommitDriveObservationResult.Type;

export const DriveSourceOutcome = Schema.Literal("unsupported", "quarantined");
export type DriveSourceOutcome = typeof DriveSourceOutcome.Type;

export const DriveSourceOutcomeReason = Schema.Literal(
  "unsupported_mime_type",
  "shortcut_not_supported",
  "invalid_scope",
  "personal_drive_not_allowed",
  "invalid_file",
  "missing_export",
  "observation_order_missing",
  "oversized_document",
  "passage_integrity_failure",
);
export type DriveSourceOutcomeReason = typeof DriveSourceOutcomeReason.Type;

export const RecordDriveSourceOutcomeArgs = Schema.Struct({
  organizationKey: NonEmptyString,
  connectorScopeKey: DriveConnectorScopeKey,
  connectionKey: NonEmptyString,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  providerObjectKey: NonEmptyString,
  providerRevisionKey: Schema.NullOr(NonEmptyString),
  sourceMimeType: Schema.NullOr(NonEmptyString),
  outcome: DriveSourceOutcome,
  reason: DriveSourceOutcomeReason,
  observedAt: NonNegativeInteger,
});
export type RecordDriveSourceOutcomeArgs =
  typeof RecordDriveSourceOutcomeArgs.Type;

export const RecordDriveSourceOutcomeResult = Schema.Struct({
  outcomeKey: DocumentOutcomeKey,
  duplicate: Schema.Boolean,
  outcome: DriveSourceOutcome,
  reason: DriveSourceOutcomeReason,
  recordedAt: NonNegativeInteger,
});
export type RecordDriveSourceOutcomeResult =
  typeof RecordDriveSourceOutcomeResult.Type;

export const DrivePreparedWrite = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("observation"),
    args: CommitDriveObservationArgs,
    expectedPassageCount: NonNegativeInteger,
  }),
  Schema.Struct({
    kind: Schema.Literal("outcome"),
    args: RecordDriveSourceOutcomeArgs,
  }),
);
export type DrivePreparedWrite = typeof DrivePreparedWrite.Type;

export const DriveIngestionReceiptSchema = Schema.Struct({
  status: Schema.Literal(
    "committed",
    "unsupported",
    "quarantined",
    "skipped_out_of_scope",
  ),
  providerObjectKey: NonEmptyString,
  classification: Schema.NullOr(DriveLedgerClassification),
  observationKey: Schema.NullOr(DocumentObservationKey),
  documentRevisionKey: Schema.NullOr(DocumentRevisionKey),
  passageCount: NonNegativeInteger,
  outcomeKey: Schema.NullOr(DocumentOutcomeKey),
  reason: Schema.NullOr(DriveSourceOutcomeReason),
  duplicate: Schema.Boolean,
});

export const PreparedDriveReconciliationPage = Schema.Struct({
  connectorScopeKey: DriveConnectorScopeKey,
  cursorBefore: NonEmptyString,
  cursorAfter: NonEmptyString,
  terminal: Schema.Boolean,
  skippedProviderObjectKeys: Schema.Array(NonEmptyString).pipe(
    Schema.maxItems(1_000),
  ),
  chunks: Schema.Array(
    Schema.Array(DrivePreparedWrite).pipe(Schema.maxItems(100)),
  ).pipe(Schema.minItems(1), Schema.maxItems(64)),
});
export type PreparedDriveReconciliationPage =
  typeof PreparedDriveReconciliationPage.Type;

export const DrivePassageRowFields = Schema.Struct({
  passageKey: DrivePassageKey,
  ordinal: NonNegativeInteger,
  startOffset: NonNegativeInteger,
  endOffset: PositiveInteger,
  headingPath: Schema.Array(NonEmptyString).pipe(Schema.maxItems(16)),
  text: Schema.String.pipe(Schema.maxLength(8_192)),
  contentHash: DriveHexDigest,
});

export { NonEmptyString, NonNegativeInteger, PositiveInteger };
