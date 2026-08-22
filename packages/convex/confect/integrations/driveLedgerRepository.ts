import {
  classifyDriveObservation,
  type CanonicalDriveRevision as IntegrationDriveRevision,
} from "@maestro-template/integrations/googleDrive/canonical";
import {
  buildDrivePassages,
  type DrivePassage,
} from "@maestro-template/integrations/googleDrive/passages";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import {
  DriveLedgerDatabaseReader,
  DriveLedgerDatabaseWriter,
} from "./driveLedgerDatabase";
import type {
  CommitDriveObservationArgs,
  CommitDriveObservationResult,
  DriveCanonicalRevision,
  DriveLedgerClassification,
  RecordDriveSourceOutcomeArgs,
  RecordDriveSourceOutcomeResult,
} from "./driveLedgerSchemas";

const MAX_NORMALIZED_DOCUMENT_BYTES = 512 * 1_024;

const invalid = (field: string, message: string) =>
  new ValidationFailed({ field, message });

const digestKey = (prefix: string, value: unknown): string =>
  `${prefix}_${sha256Hex(JSON.stringify(value))}`;

export const driveDocumentObjectKey = (input: {
  readonly organizationKey: string;
  readonly providerObjectKey: string;
}): string =>
  digestKey("gdobj", {
    organizationKey: input.organizationKey,
    providerKey: "google_drive",
    providerObjectKey: input.providerObjectKey,
  });

const driveObservationKey = (input: {
  readonly organizationKey: string;
  readonly documentObjectKey: string;
  readonly revision: DriveCanonicalRevision;
}): string =>
  digestKey("gdobs", {
    organizationKey: input.organizationKey,
    connectorScopeKey: input.revision.connectorScopeKey,
    connectionGeneration: input.revision.connectionGeneration,
    allowlistGeneration: input.revision.allowlistGeneration,
    documentObjectKey: input.documentObjectKey,
    providerRevisionKey: input.revision.providerRevisionKey,
    observationOrder: input.revision.observationOrder,
    contentHash: input.revision.contentHash,
    permissionSnapshotHash: input.revision.permissionSnapshotHash,
    tombstone: input.revision.tombstone,
  });

const driveRevisionKey = (input: {
  readonly organizationKey: string;
  readonly documentObjectKey: string;
  readonly revision: DriveCanonicalRevision;
  readonly incarnation: number;
}): string =>
  digestKey("gdrev", {
    organizationKey: input.organizationKey,
    documentObjectKey: input.documentObjectKey,
    providerRevisionKey: input.revision.providerRevisionKey,
    normalizationVersion: input.revision.normalizationVersion,
    contentHash: input.revision.contentHash,
    tombstone: input.revision.tombstone,
    incarnation: input.incarnation,
  });

const driveMembershipEdgeKey = (input: {
  readonly organizationKey: string;
  readonly documentObjectKey: string;
  readonly documentRevisionKey: string;
  readonly observationKey: string;
  readonly revision: DriveCanonicalRevision;
  readonly incarnation: number;
}): string =>
  digestKey("gdmem", {
    organizationKey: input.organizationKey,
    connectorScopeKey: input.revision.connectorScopeKey,
    connectionGeneration: input.revision.connectionGeneration,
    allowlistGeneration: input.revision.allowlistGeneration,
    documentObjectKey: input.documentObjectKey,
    documentRevisionKey: input.documentRevisionKey,
    observationKey: input.observationKey,
    parentFolderIds: input.revision.parentFolderIds,
    membershipState: input.revision.tombstone ? "tombstoned" : "active",
    incarnation: input.incarnation,
  });

const byteSlice = (
  text: string,
  startOffset: number,
  endOffset: number,
): string | null => {
  const bytes = new TextEncoder().encode(text);
  if (
    !Number.isSafeInteger(startOffset) ||
    !Number.isSafeInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset ||
    endOffset > bytes.byteLength
  )
    return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.slice(startOffset, endOffset),
    );
  } catch {
    return null;
  }
};

export const verifyDrivePassageProvenance = (
  revision: Pick<
    IntegrationDriveRevision,
    "providerRevisionKey" | "normalizedText" | "contentHash" | "tombstone"
  >,
  passage: Pick<
    DrivePassage,
    | "passageKey"
    | "ordinal"
    | "startOffset"
    | "endOffset"
    | "headingPath"
    | "text"
    | "contentHash"
  >,
): boolean => {
  if (
    revision.tombstone ||
    sha256Hex(revision.normalizedText) !== revision.contentHash ||
    byteSlice(
      revision.normalizedText,
      passage.startOffset,
      passage.endOffset,
    ) !== passage.text ||
    sha256Hex(passage.text) !== passage.contentHash
  )
    return false;
  const expected = buildDrivePassages({
    providerRevisionKey: revision.providerRevisionKey,
    normalizedText: revision.normalizedText,
  })[passage.ordinal];
  return (
    expected !== undefined &&
    expected.passageKey === passage.passageKey &&
    expected.startOffset === passage.startOffset &&
    expected.endOffset === passage.endOffset &&
    expected.contentHash === passage.contentHash &&
    JSON.stringify(expected.headingPath) === JSON.stringify(passage.headingPath)
  );
};

const validateRevision = (revision: DriveCanonicalRevision) => {
  if (sha256Hex(revision.normalizedText) !== revision.contentHash)
    return invalid(
      "revision.contentHash",
      "The normalized document content hash does not match.",
    );
  if (
    new TextEncoder().encode(revision.normalizedText).byteLength >
    MAX_NORMALIZED_DOCUMENT_BYTES
  )
    return invalid(
      "revision.normalizedText",
      "The normalized document exceeds the ledger byte limit.",
    );
  if (
    revision.tombstone !== (revision.removalEvidence !== null) ||
    (revision.tombstone &&
      (revision.normalizedText !== "" || revision.exportMimeType !== null))
  )
    return invalid(
      "revision.tombstone",
      "Tombstone content and removal evidence are inconsistent.",
    );
  if (
    new Set(revision.parentFolderIds).size !==
      revision.parentFolderIds.length ||
    [...revision.parentFolderIds]
      .sort()
      .some((folderId, index) => folderId !== revision.parentFolderIds[index])
  )
    return invalid(
      "revision.parentFolderIds",
      "Parent folder identities must be sorted and unique.",
    );
  return null;
};

const canonicalFromStored = (stored: DriveCanonicalRevision) =>
  stored as IntegrationDriveRevision;

const acceptedClassification = (
  classification: DriveLedgerClassification,
): boolean =>
  classification === "created" ||
  classification === "newer" ||
  classification === "tombstone" ||
  classification === "recreated";

const commitDriveObservationWithSequence = (
  input: CommitDriveObservationArgs,
  ledgerSequence: number | null,
): Effect.Effect<
  CommitDriveObservationResult,
  ValidationFailed,
  DriveLedgerDatabaseReader | DriveLedgerDatabaseWriter
> =>
  Effect.gen(function* () {
    const revision = input.revision;
    const invalidRevision = validateRevision(revision);
    if (invalidRevision !== null) return yield* invalidRevision;

    const passages = revision.tombstone
      ? []
      : buildDrivePassages({
          providerRevisionKey: revision.providerRevisionKey,
          normalizedText: revision.normalizedText,
        });
    if (
      passages.some(
        (passage) => !verifyDrivePassageProvenance(revision, passage),
      )
    )
      return yield* invalid(
        "revision.normalizedText",
        "Normalized passage provenance failed verification.",
      );

    const documentObjectKey = driveDocumentObjectKey({
      organizationKey: input.organizationKey,
      providerObjectKey: revision.providerObjectKey,
    });
    const observationKey = driveObservationKey({
      organizationKey: input.organizationKey,
      documentObjectKey,
      revision,
    });
    const reader = yield* DriveLedgerDatabaseReader;
    const existingObservations = yield* reader
      .table("documentSourceObservations")
      .index("by_organization_observation_key", (query) =>
        query
          .eq("organizationKey", input.organizationKey)
          .eq("observationKey", observationKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (existingObservations.length > 1)
      return yield* invalid(
        "revision",
        "The logical Drive observation identity is inconsistent.",
      );
    const existingObservation = Option.fromNullable(
      existingObservations[0],
    ).pipe(Option.getOrNull);
    if (existingObservation !== null)
      return {
        classification:
          existingObservation.documentRevisionKey === null
            ? existingObservation.classification
            : "duplicate",
        documentObjectKey,
        documentRevisionKey: existingObservation.documentRevisionKey,
        observationKey,
        membershipEdgeKey: existingObservation.membershipEdgeKey,
        incarnation: existingObservation.incarnation,
        passageCount:
          existingObservation.documentRevisionKey === null
            ? 0
            : passages.length,
      };

    const objects = yield* reader
      .table("documentSourceObjects")
      .index("by_organization_object_key", (query) =>
        query
          .eq("organizationKey", input.organizationKey)
          .eq("documentObjectKey", documentObjectKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (objects.length > 1)
      return yield* invalid(
        "revision.providerObjectKey",
        "The Drive object identity is inconsistent.",
      );
    const object = Option.fromNullable(objects[0]).pipe(Option.getOrNull);
    const scopePointers = yield* reader
      .table("documentSourceScopePointers")
      .index("by_scope_tuple_object", (query) =>
        query
          .eq("connectorScopeKey", revision.connectorScopeKey)
          .eq("connectionGeneration", revision.connectionGeneration)
          .eq("allowlistGeneration", revision.allowlistGeneration)
          .eq("documentObjectKey", documentObjectKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (scopePointers.length > 1)
      return yield* invalid(
        "revision.connectorScopeKey",
        "The Drive scope pointer is inconsistent.",
      );
    const scopePointer = Option.fromNullable(scopePointers[0]).pipe(
      Option.getOrNull,
    );
    const currentRevisions =
      scopePointer === null
        ? []
        : yield* reader
            .table("documentSourceRevisions")
            .index("by_organization_revision_key", (query) =>
              query
                .eq("organizationKey", input.organizationKey)
                .eq("documentRevisionKey", scopePointer.currentRevisionKey),
            )
            .take(2)
            .pipe(Effect.orDie);
    if (currentRevisions.length > 1)
      return yield* invalid(
        "revision",
        "The current Drive revision pointer is inconsistent.",
      );
    const currentRevision = Option.fromNullable(currentRevisions[0]).pipe(
      Option.getOrNull,
    );

    const incarnation = object?.incarnation ?? 1;
    const expectedMatches =
      object === null
        ? input.expectedIncarnation === null
        : input.expectedIncarnation === object.incarnation;
    let classification: DriveLedgerClassification;
    if (!expectedMatches) {
      classification = "superseded";
    } else if (currentRevision === null) {
      classification =
        object?.lifecycleState === "tombstoned" && !revision.tombstone
          ? "recreated"
          : revision.tombstone
            ? "tombstone"
            : "created";
    } else {
      classification = classifyDriveObservation(
        canonicalFromStored(currentRevision),
        revision as IntegrationDriveRevision,
      );
    }

    const nextIncarnation =
      classification === "recreated" && object?.lifecycleState === "tombstoned"
        ? incarnation + 1
        : incarnation;
    if (!acceptedClassification(classification)) {
      const writer = yield* DriveLedgerDatabaseWriter;
      yield* writer
        .table("documentSourceObservations")
        .insert({
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          providerKey: "google_drive",
          observationKey,
          documentObjectKey,
          providerObjectKey: revision.providerObjectKey,
          providerRevisionKey: revision.providerRevisionKey,
          connectorScopeKey: revision.connectorScopeKey,
          connectionKey: revision.connectionKey,
          connectionGeneration: revision.connectionGeneration,
          allowlistGeneration: revision.allowlistGeneration,
          observationOrder: revision.observationOrder,
          contentHash: revision.contentHash,
          permissionSnapshotHash: revision.permissionSnapshotHash,
          tombstone: revision.tombstone,
          classification,
          documentRevisionKey: null,
          membershipEdgeKey: null,
          incarnation: nextIncarnation,
          observedAt: revision.observedAt,
          recordedAt: ledgerSequence ?? revision.observedAt,
          ...(ledgerSequence === null ? {} : { ledgerSequence }),
        })
        .pipe(Effect.orDie);
      return {
        classification,
        documentObjectKey,
        documentRevisionKey: null,
        observationKey,
        membershipEdgeKey: null,
        incarnation: nextIncarnation,
        passageCount: 0,
      };
    }

    const documentRevisionKey = driveRevisionKey({
      organizationKey: input.organizationKey,
      documentObjectKey,
      revision,
      incarnation: nextIncarnation,
    });
    const membershipEdgeKey = driveMembershipEdgeKey({
      organizationKey: input.organizationKey,
      documentObjectKey,
      documentRevisionKey,
      observationKey,
      revision,
      incarnation: nextIncarnation,
    });
    const existingRevisions = yield* reader
      .table("documentSourceRevisions")
      .index("by_organization_revision_key", (query) =>
        query
          .eq("organizationKey", input.organizationKey)
          .eq("documentRevisionKey", documentRevisionKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (existingRevisions.length > 1)
      return yield* invalid(
        "revision",
        "The immutable Drive revision identity is inconsistent.",
      );

    const writer = yield* DriveLedgerDatabaseWriter;
    if (object === null) {
      yield* writer
        .table("documentSourceObjects")
        .insert({
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          providerKey: "google_drive",
          documentObjectKey,
          providerObjectKey: revision.providerObjectKey,
          lifecycleState: revision.tombstone ? "tombstoned" : "live",
          incarnation: nextIncarnation,
          createdAt: revision.observedAt,
          updatedAt: revision.observedAt,
        })
        .pipe(Effect.orDie);
    } else {
      yield* writer
        .table("documentSourceObjects")
        .patch(object._id, {
          lifecycleState: revision.tombstone ? "tombstoned" : "live",
          incarnation: nextIncarnation,
          updatedAt: revision.observedAt,
        })
        .pipe(Effect.orDie);
    }
    if (existingRevisions.length === 0) {
      yield* writer
        .table("documentSourceRevisions")
        .insert({
          ...revision,
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          documentObjectKey,
          documentRevisionKey,
          incarnation: nextIncarnation,
          recordedAt: ledgerSequence ?? revision.observedAt,
          ...(ledgerSequence === null ? {} : { ledgerSequence }),
        })
        .pipe(Effect.orDie);
      for (const passage of passages) {
        yield* writer
          .table("documentSourcePassages")
          .insert({
            ...passage,
            schemaVersion: 1,
            organizationKey: input.organizationKey,
            connectorScopeKey: revision.connectorScopeKey,
            documentObjectKey,
            documentRevisionKey,
            providerObjectKey: revision.providerObjectKey,
            providerRevisionKey: revision.providerRevisionKey,
            sourceLocator: revision.sourceLocator,
            normalizationVersion: revision.normalizationVersion,
            incarnation: nextIncarnation,
            recordedAt: ledgerSequence ?? revision.observedAt,
            ...(ledgerSequence === null ? {} : { ledgerSequence }),
          })
          .pipe(Effect.orDie);
      }
    }
    yield* writer
      .table("documentSourceMembershipEdges")
      .insert({
        schemaVersion: 1,
        organizationKey: input.organizationKey,
        providerKey: "google_drive",
        membershipEdgeKey,
        connectorScopeKey: revision.connectorScopeKey,
        connectionKey: revision.connectionKey,
        connectionGeneration: revision.connectionGeneration,
        allowlistGeneration: revision.allowlistGeneration,
        documentObjectKey,
        documentRevisionKey,
        observationKey,
        providerObjectKey: revision.providerObjectKey,
        providerRevisionKey: revision.providerRevisionKey,
        observationOrder: revision.observationOrder,
        membershipState: revision.tombstone ? "tombstoned" : "active",
        parentFolderIds: revision.parentFolderIds,
        incarnation: nextIncarnation,
        observedAt: revision.observedAt,
        recordedAt: ledgerSequence ?? revision.observedAt,
        ...(ledgerSequence === null ? {} : { ledgerSequence }),
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("documentSourceObservations")
      .insert({
        schemaVersion: 1,
        organizationKey: input.organizationKey,
        providerKey: "google_drive",
        observationKey,
        documentObjectKey,
        providerObjectKey: revision.providerObjectKey,
        providerRevisionKey: revision.providerRevisionKey,
        connectorScopeKey: revision.connectorScopeKey,
        connectionKey: revision.connectionKey,
        connectionGeneration: revision.connectionGeneration,
        allowlistGeneration: revision.allowlistGeneration,
        observationOrder: revision.observationOrder,
        contentHash: revision.contentHash,
        permissionSnapshotHash: revision.permissionSnapshotHash,
        tombstone: revision.tombstone,
        classification,
        documentRevisionKey,
        membershipEdgeKey,
        incarnation: nextIncarnation,
        observedAt: revision.observedAt,
        recordedAt: ledgerSequence ?? revision.observedAt,
        ...(ledgerSequence === null ? {} : { ledgerSequence }),
      })
      .pipe(Effect.orDie);
    const pointerValue = {
      schemaVersion: 1 as const,
      organizationKey: input.organizationKey,
      connectorScopeKey: revision.connectorScopeKey,
      connectionKey: revision.connectionKey,
      connectionGeneration: revision.connectionGeneration,
      allowlistGeneration: revision.allowlistGeneration,
      documentObjectKey,
      currentRevisionKey: documentRevisionKey,
      currentObservationKey: observationKey,
      currentMembershipEdgeKey: membershipEdgeKey,
      currentObservationOrder: revision.observationOrder,
      lifecycleState: revision.tombstone
        ? ("tombstoned" as const)
        : ("live" as const),
      incarnation: nextIncarnation,
      updatedAt: revision.observedAt,
    };
    if (scopePointer === null) {
      yield* writer
        .table("documentSourceScopePointers")
        .insert(pointerValue)
        .pipe(Effect.orDie);
    } else {
      yield* writer
        .table("documentSourceScopePointers")
        .replace(scopePointer._id, pointerValue)
        .pipe(Effect.orDie);
    }
    return {
      classification,
      documentObjectKey,
      documentRevisionKey,
      observationKey,
      membershipEdgeKey,
      incarnation: nextIncarnation,
      passageCount: passages.length,
    };
  });

export const commitDriveObservation = (
  input: CommitDriveObservationArgs,
): Effect.Effect<
  CommitDriveObservationResult,
  ValidationFailed,
  DriveLedgerDatabaseReader | DriveLedgerDatabaseWriter
> => commitDriveObservationWithSequence(input, null);

export const commitDriveObservationAtSequence = (
  input: CommitDriveObservationArgs,
  ledgerSequence: number,
): Effect.Effect<
  CommitDriveObservationResult,
  ValidationFailed,
  DriveLedgerDatabaseReader | DriveLedgerDatabaseWriter
> =>
  !Number.isSafeInteger(ledgerSequence) || ledgerSequence < 1
    ? Effect.fail(
        invalid(
          "ledgerSequence",
          "The Drive ledger sequence must be a positive safe integer.",
        ),
      )
    : commitDriveObservationWithSequence(input, ledgerSequence);

const outcomeMatchesReason = (input: RecordDriveSourceOutcomeArgs): boolean =>
  input.outcome === "unsupported"
    ? input.reason === "unsupported_mime_type" ||
      input.reason === "shortcut_not_supported"
    : input.reason !== "unsupported_mime_type" &&
      input.reason !== "shortcut_not_supported";

const recordDriveSourceOutcomeWithSequence = (
  input: RecordDriveSourceOutcomeArgs,
  ledgerSequence: number | null,
): Effect.Effect<
  RecordDriveSourceOutcomeResult,
  ValidationFailed,
  DriveLedgerDatabaseReader | DriveLedgerDatabaseWriter
> =>
  Effect.gen(function* () {
    if (!outcomeMatchesReason(input))
      return yield* invalid(
        "outcome",
        "The Drive source outcome and reason are inconsistent.",
      );
    const outcomeKey = digestKey("gdout", {
      organizationKey: input.organizationKey,
      connectorScopeKey: input.connectorScopeKey,
      connectionGeneration: input.connectionGeneration,
      allowlistGeneration: input.allowlistGeneration,
      providerObjectKey: input.providerObjectKey,
      providerRevisionKey: input.providerRevisionKey,
      sourceMimeType: input.sourceMimeType,
      outcome: input.outcome,
      reason: input.reason,
    });
    const reader = yield* DriveLedgerDatabaseReader;
    const existing = yield* reader
      .table("documentSourceOutcomes")
      .index("by_organization_outcome_key", (query) =>
        query
          .eq("organizationKey", input.organizationKey)
          .eq("outcomeKey", outcomeKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (existing.length > 1)
      return yield* invalid(
        "outcome",
        "The Drive source outcome identity is inconsistent.",
      );
    const row = existing[0];
    if (row !== undefined)
      return {
        outcomeKey,
        duplicate: true,
        outcome: row.outcome,
        reason: row.reason,
        recordedAt: row.recordedAt,
      };
    const writer = yield* DriveLedgerDatabaseWriter;
    yield* writer
      .table("documentSourceOutcomes")
      .insert({
        schemaVersion: 1,
        providerKey: "google_drive",
        ...input,
        outcomeKey,
        recordedAt: ledgerSequence ?? input.observedAt,
        ...(ledgerSequence === null ? {} : { ledgerSequence }),
      })
      .pipe(Effect.orDie);
    return {
      outcomeKey,
      duplicate: false,
      outcome: input.outcome,
      reason: input.reason,
      recordedAt: ledgerSequence ?? input.observedAt,
    };
  });

export const recordDriveSourceOutcome = (
  input: RecordDriveSourceOutcomeArgs,
): Effect.Effect<
  RecordDriveSourceOutcomeResult,
  ValidationFailed,
  DriveLedgerDatabaseReader | DriveLedgerDatabaseWriter
> => recordDriveSourceOutcomeWithSequence(input, null);

export const recordDriveSourceOutcomeAtSequence = (
  input: RecordDriveSourceOutcomeArgs,
  ledgerSequence: number,
): Effect.Effect<
  RecordDriveSourceOutcomeResult,
  ValidationFailed,
  DriveLedgerDatabaseReader | DriveLedgerDatabaseWriter
> =>
  !Number.isSafeInteger(ledgerSequence) || ledgerSequence < 1
    ? Effect.fail(
        invalid(
          "ledgerSequence",
          "The Drive ledger sequence must be a positive safe integer.",
        ),
      )
    : recordDriveSourceOutcomeWithSequence(input, ledgerSequence);
