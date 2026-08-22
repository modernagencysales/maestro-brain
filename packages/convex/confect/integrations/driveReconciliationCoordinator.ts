import {
  driveConnectorScope,
  type DriveConnectorScope,
  type DriveConnectorScopeInput,
  type DriveFileRecord,
} from "@maestro-template/integrations/googleDrive/canonical";

import {
  driveIngestionResultFromPrepared,
  driveSkippedReceipt,
  prepareDriveChangePage,
  type DriveIngestionPageResult,
  type DriveIngestionReceipt,
  type DrivePreparationInput,
} from "./driveIngestionCoordinator";
import type { PreparedDriveReconciliationPage } from "./driveLedgerSchemas";
import {
  preparedDriveChunkDigest,
  type PageChunkDescriptor,
} from "./providerReconciliation";

const MAX_PREPARED_PAGE_BYTES = 750_000;
const DRIVE_RECONCILIATION_CURSOR_PREFIX = "drive-reconciliation:v1:";

type DriveReconciliationCursorState =
  | Readonly<{
      phase: "inventory";
      providerHighWater: string;
      pageToken: string | null;
    }>
  | Readonly<{
      phase: "catch_up";
      providerHighWater: string;
      pageToken: string;
    }>
  | Readonly<{
      phase: "complete";
      providerHighWater: string;
      caughtUpThrough: string;
    }>;

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const encodeCursor = (state: DriveReconciliationCursorState): string =>
  `${DRIVE_RECONCILIATION_CURSOR_PREFIX}${encodeURIComponent(
    JSON.stringify(state),
  )}`;

const decodeCursor = (cursor: string): DriveReconciliationCursorState => {
  if (!cursor.startsWith(DRIVE_RECONCILIATION_CURSOR_PREFIX))
    throw coordinationError("invalid_request");
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      decodeURIComponent(
        cursor.slice(DRIVE_RECONCILIATION_CURSOR_PREFIX.length),
      ),
    );
  } catch {
    throw coordinationError("invalid_request");
  }
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded))
    throw coordinationError("invalid_request");
  const row = decoded as Record<string, unknown>;
  if (!nonEmpty(row.providerHighWater))
    throw coordinationError("invalid_request");
  if (row.phase === "inventory") {
    if (row.pageToken !== null && !nonEmpty(row.pageToken))
      throw coordinationError("invalid_request");
    return {
      phase: "inventory",
      providerHighWater: row.providerHighWater,
      pageToken: row.pageToken as string | null,
    };
  }
  if (row.phase === "catch_up" && nonEmpty(row.pageToken))
    return {
      phase: "catch_up",
      providerHighWater: row.providerHighWater,
      pageToken: row.pageToken,
    };
  if (row.phase === "complete" && nonEmpty(row.caughtUpThrough))
    return {
      phase: "complete",
      providerHighWater: row.providerHighWater,
      caughtUpThrough: row.caughtUpThrough,
    };
  throw coordinationError("invalid_request");
};

export type DriveReconciliationClient = DrivePreparationInput["client"] &
  Readonly<{
    getStartPageToken: (driveId: string) => Promise<string>;
    listInventoryPage: (args: {
      readonly driveId: string;
      readonly rootFolderIds: readonly string[];
      readonly pageToken: string | null;
      readonly pageSize: number;
    }) => Promise<{
      readonly files: readonly DriveFileRecord[];
      readonly nextPageToken: string | null;
    }>;
  }>;

export const captureDriveReconciliationStart = async (input: {
  readonly client: Pick<DriveReconciliationClient, "getStartPageToken">;
  readonly scope: DriveConnectorScopeInput;
}): Promise<{
  readonly connectorScopeKey: string;
  readonly providerHighWater: string;
  readonly initialCursor: string;
}> => {
  let scope: DriveConnectorScope;
  try {
    scope = driveConnectorScope(input.scope);
  } catch (error) {
    throw coordinationError("invalid_request", error);
  }
  let providerHighWater: string;
  try {
    providerHighWater = await input.client.getStartPageToken(scope.driveId);
  } catch (error) {
    throw coordinationError("high_water_capture_failed", error);
  }
  if (!nonEmpty(providerHighWater))
    throw coordinationError("high_water_capture_failed");
  return {
    connectorScopeKey: scope.connectorScopeKey,
    providerHighWater,
    initialCursor: encodeCursor({
      phase: "inventory",
      providerHighWater,
      pageToken: null,
    }),
  };
};

type RunRef = Readonly<{
  reconciliationRunKey: string;
  expectedRunGeneration: number;
  expectedConnectionGeneration: number;
  expectedAllowlistGeneration: number;
  expectedLeaseGeneration: number;
  leaseId: string;
}>;

export type PersistedDriveReconciliationPage = Readonly<{
  pageEnvelopeKey: string;
  pageDigest: string;
  ledgerHighWater: number;
  chunks: readonly PageChunkDescriptor[];
  preparedDrivePage: PreparedDriveReconciliationPage;
}>;

export type DriveReconciliationLedger = Pick<
  DrivePreparationInput["ledger"],
  "getExpectedIncarnation"
>;

export type DriveReconciliationPort = Readonly<{
  loadPage: (
    args: RunRef & {
      readonly cursorKey: string;
      readonly expectedCursor: string | null;
      readonly expectedCursorGeneration: number;
    },
  ) => Promise<PersistedDriveReconciliationPage | null>;
  beginPage: (
    args: RunRef & {
      readonly cursorKey: string;
      readonly expectedCursor: string | null;
      readonly expectedCursorGeneration: number;
      readonly nextCursor: string | null;
      readonly traversalComplete: boolean;
      readonly providerHighWater: string | null;
      readonly ledgerHighWater: number;
      readonly chunks: readonly PageChunkDescriptor[];
      readonly preparedDrivePage: PreparedDriveReconciliationPage;
      readonly now: number;
    },
  ) => Promise<{
    readonly pageEnvelopeKey: string;
    readonly pageDigest: string;
    readonly totalChunkCount: number;
  }>;
  commitChunk: (
    args: RunRef & {
      readonly pageEnvelopeKey: string;
      readonly chunkIndex: number;
      readonly chunkDigest: string;
      readonly requiredScopeIntentKey: string;
      readonly observations: readonly [];
      readonly driveChunk: true;
      readonly now: number;
    },
  ) => Promise<{
    readonly pageChunkKey: string;
    readonly observationCount: number;
    readonly seenCount: number;
    readonly obligationCount: number;
    readonly duplicate: boolean;
    readonly driveReceipts?: readonly DriveIngestionReceipt[] | undefined;
  }>;
  finalizePage: (
    args: RunRef & {
      readonly pageEnvelopeKey: string;
      readonly cursorKey: string;
      readonly now: number;
    },
  ) => Promise<{
    readonly providerCursor: string | null;
    readonly traversalComplete: boolean;
    readonly cursorGeneration: number;
    readonly ledgerHighWater: number;
  }>;
}>;

export type DriveReconciliationChunkReceipt = Awaited<
  ReturnType<DriveReconciliationPort["commitChunk"]>
>;

export type DriveReconciliationPageResult = Readonly<{
  ingestion: DriveIngestionPageResult;
  pageEnvelopeKey: string;
  pageDigest: string;
  observationCount: number;
  chunkReceipts: readonly DriveReconciliationChunkReceipt[];
  cursor: Readonly<{
    providerCursor: string | null;
    traversalComplete: boolean;
    cursorGeneration: number;
    ledgerHighWater: number;
  }>;
}>;

export class DriveReconciliationCoordinatorError extends Error {
  readonly _tag = "DriveReconciliationCoordinatorError";

  constructor(
    readonly reason:
      | "invalid_request"
      | "high_water_capture_failed"
      | "provider_fetch_failed"
      | "page_load_failed"
      | "page_begin_failed"
      | "before_chunk_commit_failed"
      | "chunk_commit_failed"
      | "after_chunk_commit_failed"
      | "page_finalize_failed",
    readonly retryable: boolean,
    readonly causeTag: string | null,
  ) {
    super(`Drive reconciliation coordination failed: ${reason}`);
  }
}

const taggedCause = (error: unknown): string | null => {
  if (error === null || typeof error !== "object") return null;
  const tag = (error as { readonly _tag?: unknown })._tag;
  return typeof tag === "string" ? tag : null;
};

const coordinationError = (
  reason: DriveReconciliationCoordinatorError["reason"],
  error?: unknown,
) =>
  new DriveReconciliationCoordinatorError(
    reason,
    reason !== "invalid_request",
    taggedCause(error),
  );

const chunksOf = <Value>(
  values: readonly Value[],
  chunkSize: number,
): readonly (readonly Value[])[] => {
  if (values.length === 0) return [[]];
  const chunks: Value[][] = [];
  for (let index = 0; index < values.length; index += chunkSize)
    chunks.push(values.slice(index, index + chunkSize));
  return chunks;
};

const assertPreparedPage = (
  page: PreparedDriveReconciliationPage,
  input: {
    readonly connectorScopeKey: string;
    readonly pageToken: string;
    readonly chunks: readonly PageChunkDescriptor[];
  },
) => {
  const encodedBytes = new TextEncoder().encode(
    JSON.stringify(page),
  ).byteLength;
  if (
    page.connectorScopeKey !== input.connectorScopeKey ||
    page.cursorBefore !== input.pageToken ||
    page.chunks.length !== input.chunks.length ||
    encodedBytes > MAX_PREPARED_PAGE_BYTES ||
    page.chunks.some(
      (chunk, index) =>
        preparedDriveChunkDigest(chunk) !== input.chunks[index]?.chunkDigest ||
        chunk.length !== input.chunks[index]?.observationCount,
    )
  )
    throw coordinationError("invalid_request");
};

export const coordinateDriveReconciliationPage = async (
  input: Omit<DrivePreparationInput, "client" | "ledger"> &
    RunRef &
    Readonly<{
      client: DriveReconciliationClient;
      ledger: DriveReconciliationLedger;
      reconciliation: DriveReconciliationPort;
      cursorKey: string;
      expectedCursorGeneration: number;
      requiredScopeIntentKey: string;
      providerHighWater: string | null;
      chunkSize?: number;
      beforeReconciliationChunk?: (index: number) => void | Promise<void>;
      afterReconciliationChunk?: (
        receipt: DriveReconciliationChunkReceipt,
        index: number,
      ) => void | Promise<void>;
    }>,
): Promise<DriveReconciliationPageResult> => {
  const chunkSize = input.chunkSize ?? 100;
  if (
    !Number.isSafeInteger(chunkSize) ||
    chunkSize < 1 ||
    chunkSize > 100 ||
    input.expectedCursorGeneration < 1 ||
    input.cursorKey.trim().length === 0 ||
    input.requiredScopeIntentKey.trim().length === 0
  )
    throw coordinationError("invalid_request");

  const runRef = {
    reconciliationRunKey: input.reconciliationRunKey,
    expectedRunGeneration: input.expectedRunGeneration,
    expectedConnectionGeneration: input.expectedConnectionGeneration,
    expectedAllowlistGeneration: input.expectedAllowlistGeneration,
    expectedLeaseGeneration: input.expectedLeaseGeneration,
    leaseId: input.leaseId,
  };
  let canonicalScope: DriveConnectorScope;
  try {
    canonicalScope = driveConnectorScope(input.scope);
  } catch (error) {
    throw coordinationError("invalid_request", error);
  }
  const currentCursor = decodeCursor(input.pageToken);
  if (
    currentCursor.phase === "complete" ||
    currentCursor.providerHighWater !== input.providerHighWater
  )
    throw coordinationError("invalid_request");
  let persisted: PersistedDriveReconciliationPage | null;
  try {
    persisted = await input.reconciliation.loadPage({
      ...runRef,
      cursorKey: input.cursorKey,
      expectedCursor: input.pageToken,
      expectedCursorGeneration: input.expectedCursorGeneration,
    });
  } catch (error) {
    throw coordinationError("page_load_failed", error);
  }

  if (persisted === null) {
    let providerPage: Awaited<
      ReturnType<DrivePreparationInput["client"]["listChanges"]>
    >;
    try {
      if (currentCursor.phase === "inventory") {
        const inventory = await input.client.listInventoryPage({
          driveId: canonicalScope.driveId,
          rootFolderIds: canonicalScope.rootFolderIds,
          pageToken: currentCursor.pageToken,
          pageSize: input.pageSize,
        });
        if (
          inventory.files.length > input.pageSize ||
          (inventory.nextPageToken !== null &&
            (!nonEmpty(inventory.nextPageToken) ||
              inventory.nextPageToken === currentCursor.pageToken))
        )
          throw coordinationError("provider_fetch_failed");
        const nextCursor = encodeCursor(
          inventory.nextPageToken === null
            ? {
                phase: "catch_up",
                providerHighWater: currentCursor.providerHighWater,
                pageToken: currentCursor.providerHighWater,
              }
            : {
                phase: "inventory",
                providerHighWater: currentCursor.providerHighWater,
                pageToken: inventory.nextPageToken,
              },
        );
        providerPage = {
          changes: inventory.files.map((file) => ({
            fileId: file.id,
            removed: false,
            time: null,
            file,
          })),
          nextPageToken: nextCursor,
          newStartPageToken: null,
        };
      } else {
        const catchUp = await input.client.listChanges({
          driveId: canonicalScope.driveId,
          pageToken: currentCursor.pageToken,
          pageSize: input.pageSize,
        });
        if (
          catchUp.changes.length > input.pageSize ||
          (catchUp.nextPageToken !== null &&
            (!nonEmpty(catchUp.nextPageToken) ||
              catchUp.nextPageToken === currentCursor.pageToken)) ||
          (catchUp.nextPageToken === null &&
            !nonEmpty(catchUp.newStartPageToken)) ||
          (catchUp.nextPageToken !== null && catchUp.newStartPageToken !== null)
        )
          throw coordinationError("provider_fetch_failed");
        if (catchUp.nextPageToken === null) {
          const caughtUpThrough = catchUp.newStartPageToken;
          if (!nonEmpty(caughtUpThrough))
            throw coordinationError("provider_fetch_failed");
          providerPage = {
            changes: catchUp.changes,
            nextPageToken: null,
            newStartPageToken: encodeCursor({
              phase: "complete",
              providerHighWater: currentCursor.providerHighWater,
              caughtUpThrough,
            }),
          };
        } else {
          providerPage = {
            changes: catchUp.changes,
            nextPageToken: encodeCursor({
              phase: "catch_up",
              providerHighWater: currentCursor.providerHighWater,
              pageToken: catchUp.nextPageToken,
            }),
            newStartPageToken: null,
          };
        }
      }
    } catch (error) {
      if (error instanceof DriveReconciliationCoordinatorError) throw error;
      throw coordinationError("provider_fetch_failed", error);
    }
    const prepared = await prepareDriveChangePage({
      organizationKey: input.organizationKey,
      scope: input.scope,
      client: {
        listChanges: async () => providerPage,
        exportText: input.client.exportText,
      },
      ledger: input.ledger,
      pageToken: input.pageToken,
      pageSize: input.pageSize,
      observedAt: input.observedAt,
      retentionClass: input.retentionClass,
      permissionSnapshotHash: input.permissionSnapshotHash,
      ...(input.closedReconciliationEpoch === undefined
        ? {}
        : { closedReconciliationEpoch: input.closedReconciliationEpoch }),
      ...(input.isInScope === undefined ? {} : { isInScope: input.isInScope }),
    });
    const chunks = chunksOf(prepared.writes, chunkSize);
    if (chunks.length > 64) throw coordinationError("invalid_request");
    const descriptors = chunks.map(
      (chunk, chunkIndex): PageChunkDescriptor => ({
        chunkIndex,
        chunkDigest: preparedDriveChunkDigest(chunk),
        observationCount: chunk.length,
      }),
    );
    const preparedDrivePage: PreparedDriveReconciliationPage = {
      connectorScopeKey: prepared.connectorScopeKey,
      cursorBefore: prepared.cursorBefore,
      cursorAfter: prepared.cursorAfter,
      terminal: prepared.terminal,
      skippedProviderObjectKeys: prepared.skippedProviderObjectKeys,
      chunks,
    };
    assertPreparedPage(preparedDrivePage, {
      connectorScopeKey: prepared.connectorScopeKey,
      pageToken: input.pageToken,
      chunks: descriptors,
    });
    let envelope: Awaited<ReturnType<DriveReconciliationPort["beginPage"]>>;
    try {
      envelope = await input.reconciliation.beginPage({
        ...runRef,
        cursorKey: input.cursorKey,
        expectedCursor: input.pageToken,
        expectedCursorGeneration: input.expectedCursorGeneration,
        nextCursor: prepared.cursorAfter,
        traversalComplete: prepared.terminal,
        providerHighWater: input.providerHighWater,
        ledgerHighWater: 0,
        chunks: descriptors,
        preparedDrivePage,
        now: input.observedAt,
      });
    } catch (error) {
      throw coordinationError("page_begin_failed", error);
    }
    persisted = {
      pageEnvelopeKey: envelope.pageEnvelopeKey,
      pageDigest: envelope.pageDigest,
      ledgerHighWater: 0,
      chunks: descriptors,
      preparedDrivePage,
    };
  }

  assertPreparedPage(persisted.preparedDrivePage, {
    connectorScopeKey: persisted.preparedDrivePage.connectorScopeKey,
    pageToken: input.pageToken,
    chunks: persisted.chunks,
  });
  const chunkReceipts: DriveReconciliationChunkReceipt[] = [];
  const driveReceipts: DriveIngestionReceipt[] = [];
  for (const descriptor of persisted.chunks) {
    if (input.beforeReconciliationChunk !== undefined)
      try {
        await input.beforeReconciliationChunk(descriptor.chunkIndex);
      } catch (error) {
        throw coordinationError("before_chunk_commit_failed", error);
      }
    let receipt: DriveReconciliationChunkReceipt;
    try {
      receipt = await input.reconciliation.commitChunk({
        reconciliationRunKey: input.reconciliationRunKey,
        expectedRunGeneration: input.expectedRunGeneration,
        expectedConnectionGeneration: input.expectedConnectionGeneration,
        expectedAllowlistGeneration: input.expectedAllowlistGeneration,
        expectedLeaseGeneration: input.expectedLeaseGeneration,
        leaseId: input.leaseId,
        pageEnvelopeKey: persisted.pageEnvelopeKey,
        chunkIndex: descriptor.chunkIndex,
        chunkDigest: descriptor.chunkDigest,
        requiredScopeIntentKey: input.requiredScopeIntentKey,
        observations: [],
        driveChunk: true,
        now: input.observedAt,
      });
    } catch (error) {
      throw coordinationError("chunk_commit_failed", error);
    }
    if (receipt.driveReceipts === undefined)
      throw coordinationError("chunk_commit_failed");
    driveReceipts.push(...receipt.driveReceipts);
    chunkReceipts.push(receipt);
    if (input.afterReconciliationChunk !== undefined)
      try {
        await input.afterReconciliationChunk(receipt, descriptor.chunkIndex);
      } catch (error) {
        throw coordinationError("after_chunk_commit_failed", error);
      }
  }
  driveReceipts.push(
    ...persisted.preparedDrivePage.skippedProviderObjectKeys.map(
      driveSkippedReceipt,
    ),
  );
  let cursor: Awaited<ReturnType<DriveReconciliationPort["finalizePage"]>>;
  try {
    cursor = await input.reconciliation.finalizePage({
      reconciliationRunKey: input.reconciliationRunKey,
      expectedRunGeneration: input.expectedRunGeneration,
      expectedConnectionGeneration: input.expectedConnectionGeneration,
      expectedAllowlistGeneration: input.expectedAllowlistGeneration,
      expectedLeaseGeneration: input.expectedLeaseGeneration,
      leaseId: input.leaseId,
      pageEnvelopeKey: persisted.pageEnvelopeKey,
      cursorKey: input.cursorKey,
      now: input.observedAt,
    });
  } catch (error) {
    throw coordinationError("page_finalize_failed", error);
  }
  const prepared = persisted.preparedDrivePage;
  return {
    ingestion: driveIngestionResultFromPrepared(
      {
        connectorScopeKey: prepared.connectorScopeKey,
        cursorBefore: prepared.cursorBefore,
        cursorAfter: prepared.cursorAfter,
        terminal: prepared.terminal,
        writes: prepared.chunks.flat(),
        skippedProviderObjectKeys: prepared.skippedProviderObjectKeys,
      },
      driveReceipts,
    ),
    pageEnvelopeKey: persisted.pageEnvelopeKey,
    pageDigest: persisted.pageDigest,
    observationCount: driveReceipts.filter(
      ({ status }) => status !== "skipped_out_of_scope",
    ).length,
    chunkReceipts,
    cursor,
  };
};

export type DriveReconciliationScopeMembership = (
  file: Parameters<NonNullable<DrivePreparationInput["isInScope"]>>[0],
  scope: DriveConnectorScope,
) => boolean | Promise<boolean>;

export type DriveReconciliationAfterWrite = (
  receipt: DriveIngestionReceipt,
  index: number,
) => void | Promise<void>;
