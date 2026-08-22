import {
  type DriveChange,
  DriveApiClientError,
} from "@maestro-template/integrations/googleDrive/client";
import {
  type CanonicalDriveRevision,
  type DriveConnectorScope,
  type DriveConnectorScopeInput,
  type DriveFileRecord,
  DriveSourceDecodeError,
  driveConnectorScope,
  normalizeDriveFile,
} from "@maestro-template/integrations/googleDrive/canonical";
import { buildDrivePassages } from "@maestro-template/integrations/googleDrive/passages";

import type {
  CommitDriveObservationArgs,
  CommitDriveObservationResult,
  DrivePreparedWrite,
  DriveLedgerClassification,
  DriveSourceOutcomeReason,
  RecordDriveSourceOutcomeArgs,
  RecordDriveSourceOutcomeResult,
} from "./driveLedgerSchemas";

export type DriveIngestionClient = Readonly<{
  listChanges: (args: {
    readonly driveId: string;
    readonly pageToken: string;
    readonly pageSize: number;
  }) => Promise<{
    readonly changes: readonly DriveChange[];
    readonly nextPageToken: string | null;
    readonly newStartPageToken: string | null;
  }>;
  exportText: (args: {
    readonly fileId: string;
    readonly exportMimeType: string;
  }) => Promise<string>;
}>;

export type DriveIngestionLedger = Readonly<{
  getExpectedIncarnation: (
    organizationKey: string,
    providerObjectKey: string,
  ) => Promise<number | null>;
  commitObservation: (
    args: CommitDriveObservationArgs,
  ) => Promise<CommitDriveObservationResult>;
  recordSourceOutcome: (
    args: RecordDriveSourceOutcomeArgs,
  ) => Promise<RecordDriveSourceOutcomeResult>;
}>;

export type DriveIngestionReceipt = Readonly<{
  status: "committed" | "unsupported" | "quarantined" | "skipped_out_of_scope";
  providerObjectKey: string;
  classification: DriveLedgerClassification | null;
  observationKey: string | null;
  documentRevisionKey: string | null;
  passageCount: number;
  outcomeKey: string | null;
  reason: DriveSourceOutcomeReason | null;
  duplicate: boolean;
}>;

export type DriveIngestionPageResult = Readonly<{
  connectorScopeKey: string;
  cursorBefore: string;
  cursorAfter: string;
  terminal: boolean;
  committed: number;
  duplicates: number;
  tombstones: number;
  unsupported: number;
  quarantined: number;
  skippedOutOfScope: number;
  receipts: readonly DriveIngestionReceipt[];
}>;

export type DrivePreparedPageResult = Readonly<{
  connectorScopeKey: string;
  cursorBefore: string;
  cursorAfter: string;
  terminal: boolean;
  writes: readonly DrivePreparedWrite[];
  skippedProviderObjectKeys: readonly string[];
}>;

export class DriveIngestionCoordinatorError extends Error {
  readonly _tag = "DriveIngestionCoordinatorError";

  constructor(
    readonly reason:
      | "invalid_page_request"
      | "scope_invalid"
      | "provider_page_failed"
      | "provider_page_invalid"
      | "scope_membership_failed"
      | "export_failed"
      | "permission_snapshot_failed"
      | "ledger_read_failed"
      | "ledger_write_failed"
      | "passage_integrity_failed"
      | "after_commit_failed"
      | "next_cursor_missing",
    readonly retryable: boolean,
    readonly causeTag: string | null,
  ) {
    super(`Drive ingestion coordination failed: ${reason}`);
  }
}

type DriveIngestionInput = Readonly<{
  organizationKey: string;
  scope: DriveConnectorScopeInput;
  client: DriveIngestionClient;
  ledger: DriveIngestionLedger;
  pageToken: string;
  pageSize: number;
  observedAt: number;
  retentionClass: string;
  permissionSnapshotHash: (file: DriveFileRecord) => string | Promise<string>;
  closedReconciliationEpoch?: number;
  isInScope?: (
    file: DriveFileRecord,
    scope: DriveConnectorScope,
  ) => boolean | Promise<boolean>;
  afterDurableWrite?: (
    receipt: DriveIngestionReceipt,
    index: number,
  ) => void | Promise<void>;
}>;

export type DrivePreparationInput = Omit<
  DriveIngestionInput,
  "ledger" | "afterDurableWrite"
> &
  Readonly<{
    ledger: Pick<DriveIngestionLedger, "getExpectedIncarnation">;
  }>;

const causeTag = (error: unknown): string | null => {
  if (error === null || typeof error !== "object") return null;
  const tag = (error as { readonly _tag?: unknown })._tag;
  return typeof tag === "string" ? tag : null;
};

const coordinatorError = (
  reason: DriveIngestionCoordinatorError["reason"],
  error?: unknown,
) => {
  const retryable =
    error instanceof DriveApiClientError
      ? error.retryable
      : reason !== "invalid_page_request" &&
        reason !== "scope_invalid" &&
        reason !== "provider_page_invalid" &&
        reason !== "passage_integrity_failed" &&
        reason !== "next_cursor_missing";
  return new DriveIngestionCoordinatorError(reason, retryable, causeTag(error));
};

const exportMimeType = (file: DriveFileRecord): string | null => {
  switch (file.mimeType) {
    case "application/vnd.google-apps.document":
    case "text/plain":
      return "text/plain";
    case "text/markdown":
      return "text/markdown";
    case "application/pdf":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "text/plain";
    default:
      return null;
  }
};

const providerRevisionKey = (file: DriveFileRecord): string | null =>
  file.version === null ? null : `${file.id}:version:${file.version}`;

const defaultInScope = (
  file: DriveFileRecord,
  scope: DriveConnectorScope,
): boolean =>
  file.parents.some((parent) => scope.rootFolderIds.includes(parent));

const outcomeFor = (
  error: DriveSourceDecodeError,
): {
  readonly outcome: "unsupported" | "quarantined";
  readonly reason: DriveSourceOutcomeReason;
} => {
  switch (error.reason) {
    case "unsupported_mime_type":
    case "shortcut_not_supported":
      return { outcome: "unsupported", reason: error.reason };
    case "invalid_scope":
    case "personal_drive_not_allowed":
    case "invalid_file":
    case "missing_export":
    case "observation_order_missing":
      return { outcome: "quarantined", reason: error.reason };
  }
};

const outcomeReceipt = (
  providerObjectKey: string,
  outcome: RecordDriveSourceOutcomeResult,
): DriveIngestionReceipt => ({
  status: outcome.outcome,
  providerObjectKey,
  classification: null,
  observationKey: null,
  documentRevisionKey: null,
  passageCount: 0,
  outcomeKey: outcome.outcomeKey,
  reason: outcome.reason,
  duplicate: outcome.duplicate,
});

const committedReceipt = (
  providerObjectKey: string,
  result: CommitDriveObservationResult,
): DriveIngestionReceipt => ({
  status: "committed",
  providerObjectKey,
  classification: result.classification,
  observationKey: result.observationKey,
  documentRevisionKey: result.documentRevisionKey,
  passageCount: result.passageCount,
  outcomeKey: null,
  reason: null,
  duplicate: result.classification === "duplicate",
});

const skippedReceipt = (providerObjectKey: string): DriveIngestionReceipt => ({
  status: "skipped_out_of_scope",
  providerObjectKey,
  classification: null,
  observationKey: null,
  documentRevisionKey: null,
  passageCount: 0,
  outcomeKey: null,
  reason: null,
  duplicate: false,
});

const prepareDecodeOutcome = (input: {
  readonly coordinator: DrivePreparationInput;
  readonly scope: DriveConnectorScope;
  readonly file: DriveFileRecord | null;
  readonly providerObjectKey: string;
  readonly error: DriveSourceDecodeError;
}): DrivePreparedWrite => {
  const mapped = outcomeFor(input.error);
  return {
    kind: "outcome",
    args: {
      organizationKey: input.coordinator.organizationKey,
      connectorScopeKey: input.scope.connectorScopeKey,
      connectionKey: input.scope.connectionKey,
      connectionGeneration: input.scope.connectionGeneration,
      allowlistGeneration: input.scope.allowlistGeneration,
      providerObjectKey: input.providerObjectKey,
      providerRevisionKey:
        input.file === null ? null : providerRevisionKey(input.file),
      sourceMimeType: input.file?.mimeType ?? null,
      outcome: mapped.outcome,
      reason: mapped.reason,
      observedAt: input.coordinator.observedAt,
    },
  };
};

const canonicalizeChange = async (input: {
  readonly coordinator: DrivePreparationInput;
  readonly change: DriveChange;
}): Promise<CanonicalDriveRevision | DriveSourceDecodeError> => {
  const file = input.change.file;
  if (file === null)
    return new DriveSourceDecodeError({
      reason: "invalid_file",
      detail: "A removed Drive change did not include immutable file metadata.",
    });
  if (file.id !== input.change.fileId)
    return new DriveSourceDecodeError({
      reason: "invalid_file",
      detail: "The Drive change and file identities do not match.",
    });
  const observedFile =
    input.change.removed && !file.trashed ? { ...file, trashed: true } : file;
  let permissionSnapshotHash: string;
  try {
    permissionSnapshotHash =
      await input.coordinator.permissionSnapshotHash(observedFile);
  } catch (error) {
    throw coordinatorError("permission_snapshot_failed", error);
  }
  const selectedExportMimeType = observedFile.trashed
    ? null
    : exportMimeType(observedFile);
  let exportedText: string | null = null;
  if (selectedExportMimeType !== null) {
    try {
      exportedText = await input.coordinator.client.exportText({
        fileId: observedFile.id,
        exportMimeType: selectedExportMimeType,
      });
    } catch (error) {
      throw coordinatorError("export_failed", error);
    }
  }
  try {
    return normalizeDriveFile({
      scope: input.coordinator.scope,
      file: observedFile,
      exportMimeType: selectedExportMimeType,
      exportedText,
      ...(input.coordinator.closedReconciliationEpoch === undefined
        ? {}
        : {
            closedReconciliationEpoch:
              input.coordinator.closedReconciliationEpoch,
          }),
      observedAt: input.coordinator.observedAt,
      permissionSnapshotHash,
      retentionClass: input.coordinator.retentionClass,
    });
  } catch (error) {
    if (error instanceof DriveSourceDecodeError) return error;
    throw coordinatorError("passage_integrity_failed", error);
  }
};

const prepareRevision = async (input: {
  readonly coordinator: DrivePreparationInput;
  readonly revision: CanonicalDriveRevision;
}): Promise<DrivePreparedWrite> => {
  let expectedIncarnation: number | null;
  try {
    expectedIncarnation = await input.coordinator.ledger.getExpectedIncarnation(
      input.coordinator.organizationKey,
      input.revision.providerObjectKey,
    );
  } catch (error) {
    throw coordinatorError("ledger_read_failed", error);
  }
  let expectedPassageCount: number;
  try {
    expectedPassageCount = buildDrivePassages({
      providerRevisionKey: input.revision.providerRevisionKey,
      normalizedText: input.revision.normalizedText,
    }).length;
  } catch (error) {
    throw coordinatorError("passage_integrity_failed", error);
  }
  return {
    kind: "observation",
    args: {
      organizationKey: input.coordinator.organizationKey,
      revision: input.revision,
      expectedIncarnation,
    },
    expectedPassageCount,
  };
};

const commitPreparedWrite = async (
  input: DriveIngestionInput,
  write: DrivePreparedWrite,
): Promise<DriveIngestionReceipt> => {
  try {
    if (write.kind === "outcome") {
      const result = await input.ledger.recordSourceOutcome(write.args);
      return outcomeReceipt(write.args.providerObjectKey, result);
    }
    const result = await input.ledger.commitObservation(write.args);
    if (
      result.documentRevisionKey !== null &&
      result.passageCount !== write.expectedPassageCount
    )
      throw coordinatorError("passage_integrity_failed");
    return committedReceipt(write.args.revision.providerObjectKey, result);
  } catch (error) {
    if (error instanceof DriveIngestionCoordinatorError) throw error;
    throw coordinatorError("ledger_write_failed", error);
  }
};

const invokeAfterWrite = async (
  input: DriveIngestionInput,
  receipt: DriveIngestionReceipt,
  index: number,
) => {
  if (input.afterDurableWrite === undefined) return;
  try {
    await input.afterDurableWrite(receipt, index);
  } catch (error) {
    throw coordinatorError("after_commit_failed", error);
  }
};

export const ingestDriveChangePage = async (
  input: DriveIngestionInput,
): Promise<DriveIngestionPageResult> => {
  const prepared = await prepareDriveChangePage(input);
  const receipts: DriveIngestionReceipt[] = [];
  for (const write of prepared.writes) {
    const receipt = await commitPreparedWrite(input, write);
    receipts.push(receipt);
    await invokeAfterWrite(input, receipt, receipts.length - 1);
  }
  receipts.push(
    ...prepared.skippedProviderObjectKeys.map((providerObjectKey) =>
      skippedReceipt(providerObjectKey),
    ),
  );
  return ingestionResult(prepared, receipts);
};

const ingestionResult = (
  prepared: DrivePreparedPageResult,
  receipts: readonly DriveIngestionReceipt[],
): DriveIngestionPageResult => ({
  connectorScopeKey: prepared.connectorScopeKey,
  cursorBefore: prepared.cursorBefore,
  cursorAfter: prepared.cursorAfter,
  terminal: prepared.terminal,
  committed: receipts.filter(({ status }) => status === "committed").length,
  duplicates: receipts.filter(({ duplicate }) => duplicate).length,
  tombstones: receipts.filter(
    ({ classification }) => classification === "tombstone",
  ).length,
  unsupported: receipts.filter(({ status }) => status === "unsupported").length,
  quarantined: receipts.filter(({ status }) => status === "quarantined").length,
  skippedOutOfScope: receipts.filter(
    ({ status }) => status === "skipped_out_of_scope",
  ).length,
  receipts,
});

export const driveIngestionResultFromPrepared = ingestionResult;

export const driveSkippedReceipt = skippedReceipt;

export const driveCommittedReceipt = committedReceipt;

export const driveOutcomeReceipt = outcomeReceipt;

export const prepareDriveChangePage = async (
  input: DrivePreparationInput,
): Promise<DrivePreparedPageResult> => {
  if (
    input.organizationKey.trim().length === 0 ||
    input.pageToken.trim().length === 0 ||
    !Number.isSafeInteger(input.pageSize) ||
    input.pageSize < 1 ||
    input.pageSize > 1_000 ||
    !Number.isSafeInteger(input.observedAt) ||
    input.observedAt < 0 ||
    input.retentionClass.trim().length === 0
  )
    throw coordinatorError("invalid_page_request");

  let scope: DriveConnectorScope;
  try {
    scope = driveConnectorScope(input.scope);
  } catch (error) {
    throw coordinatorError("scope_invalid", error);
  }
  let page: Awaited<ReturnType<DriveIngestionClient["listChanges"]>>;
  try {
    page = await input.client.listChanges({
      driveId: scope.driveId,
      pageToken: input.pageToken,
      pageSize: input.pageSize,
    });
  } catch (error) {
    throw coordinatorError("provider_page_failed", error);
  }
  const cursorAfter = page.nextPageToken ?? page.newStartPageToken;
  if (cursorAfter === null) throw coordinatorError("next_cursor_missing");
  if (
    page.changes.length > input.pageSize ||
    cursorAfter.trim().length === 0 ||
    cursorAfter === input.pageToken ||
    (page.nextPageToken !== null && page.newStartPageToken !== null)
  )
    throw coordinatorError("provider_page_invalid");
  const writes: DrivePreparedWrite[] = [];
  const skippedProviderObjectKeys: string[] = [];
  for (const change of page.changes) {
    const file = change.file;
    if (file !== null) {
      let inScope: boolean;
      try {
        inScope = await (input.isInScope ?? defaultInScope)(file, scope);
      } catch (error) {
        throw coordinatorError("scope_membership_failed", error);
      }
      if (!inScope) {
        skippedProviderObjectKeys.push(change.fileId);
        continue;
      }
    }
    const canonical = await canonicalizeChange({ coordinator: input, change });
    const write =
      canonical instanceof DriveSourceDecodeError
        ? prepareDecodeOutcome({
            coordinator: input,
            scope,
            file,
            providerObjectKey: change.fileId,
            error: canonical,
          })
        : await prepareRevision({ coordinator: input, revision: canonical });
    writes.push(write);
  }
  return {
    connectorScopeKey: scope.connectorScopeKey,
    cursorBefore: input.pageToken,
    cursorAfter,
    terminal: page.nextPageToken === null,
    writes,
    skippedProviderObjectKeys,
  };
};
