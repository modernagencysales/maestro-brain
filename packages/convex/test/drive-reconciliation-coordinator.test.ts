import {
  driveConnectorScope,
  type DriveConnectorScopeInput,
} from "@maestro-template/integrations/googleDrive/canonical";
import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import type { GenericId, Value } from "convex/values";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import generatedConvexSchema from "../confect/_generated/convexSchema";
import refs from "../confect/_generated/refs";
import {
  captureDriveReconciliationStart,
  coordinateDriveReconciliationPage as coordinateDriveReconciliationPageWithLease,
  type DriveReconciliationLedger,
  type DriveReconciliationPort,
} from "../confect/integrations/driveReconciliationCoordinator";
import {
  driveLedgerDatabaseSchema,
  DriveLedgerDatabaseReader,
} from "../confect/integrations/driveLedgerDatabase";
import {
  commitDriveObservation,
  recordDriveSourceOutcome,
} from "../confect/integrations/driveLedgerRepository";
import {
  listDriveReconciliationRemovalCandidates,
  loadPersistedDriveReconciliationPage,
} from "../confect/integrations/driveReconciliationRepository";
import providerReconciliationImpl from "../confect/integrations/providerReconciliation.impl";
import providerReconciliationSpec from "../confect/integrations/providerReconciliation.spec";
import {
  ingestDriveChangePage,
  type DriveIngestionLedger,
} from "../confect/integrations/driveIngestionCoordinator";
import { seedTenancy } from "./support/seedTenancy";
import ingestionObligationsSource from "../confect/tables/ingestionObligations";
import providerTargetResolutionIntentsSource from "../confect/tables/providerTargetResolutionIntents";
import retrievalPublicationJobsSource from "../confect/tables/retrievalPublicationJobs";

const providerFunctions = RegisteredFunctions.buildForGroup<
  typeof providerReconciliationSpec
>(
  driveLedgerDatabaseSchema,
  providerReconciliationImpl,
  RegisteredConvexFunction.make,
);
const ingestionObligations = ingestionObligationsSource("ingestionObligations");
const providerTargetResolutionIntents = providerTargetResolutionIntentsSource(
  "providerTargetResolutionIntents",
);
const retrievalPublicationJobs = retrievalPublicationJobsSource(
  "retrievalPublicationJobs",
);
const testConvexSchema = defineSchema({
  ...generatedConvexSchema.tables,
  ingestionObligations: ingestionObligations.tableDefinition,
  providerTargetResolutionIntents:
    providerTargetResolutionIntents.tableDefinition,
  retrievalPublicationJobs: retrievalPublicationJobs.tableDefinition,
  documentSourceMembershipEdges:
    driveLedgerDatabaseSchema.tables.documentSourceMembershipEdges
      .tableDefinition,
  documentSourceObjects:
    driveLedgerDatabaseSchema.tables.documentSourceObjects.tableDefinition,
  documentSourceObservations:
    driveLedgerDatabaseSchema.tables.documentSourceObservations.tableDefinition,
  documentSourceOutcomes:
    driveLedgerDatabaseSchema.tables.documentSourceOutcomes.tableDefinition,
  documentSourcePassages:
    driveLedgerDatabaseSchema.tables.documentSourcePassages.tableDefinition,
  documentSourceRevisions:
    driveLedgerDatabaseSchema.tables.documentSourceRevisions.tableDefinition,
  documentSourceScopePointers:
    driveLedgerDatabaseSchema.tables.documentSourceScopePointers
      .tableDefinition,
});
const testLayer = TestConfect.layer(
  driveLedgerDatabaseSchema,
  testConvexSchema,
  {
    ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
    "../convex/integrations/providerReconciliation.ts": async () =>
      providerFunctions,
  },
);
const resultSchema = <Result>(): Schema.Schema<Result, Value> =>
  Schema.Any as unknown as Schema.Schema<Result, Value>;

type Harness = TestConfect.TestConfect<typeof driveLedgerDatabaseSchema>;

const withHarness = <Result>(run: (confect: Harness) => Promise<Result>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof driveLedgerDatabaseSchema>();
      return yield* Effect.promise(() => run(confect));
    }).pipe(Effect.provide(testLayer())),
  );

const reconciliationRefs = refs.internal.integrations.providerReconciliation;
const organizationKey = "ag_0123456789ABCDEFGHJKMNPQRS";
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";
const now = 1_787_270_400_000;
const scope = {
  connectionKey: "gdrive_connection",
  connectionGeneration: 3,
  driveId: "shared_drive_1",
  rootFolderIds: ["folder_a"],
  allowlistGeneration: 4,
  sharedDrive: true,
} as const satisfies DriveConnectorScopeInput;

const file = (
  id: string,
  input: {
    readonly version?: string | null;
    readonly parent?: string;
    readonly trashed?: boolean;
    readonly mimeType?: string;
  } = {},
) => ({
  id,
  name: `Document ${id}`,
  mimeType: input.mimeType ?? "application/vnd.google-apps.document",
  version: input.version === undefined ? "1" : input.version,
  modifiedTime: "2026-08-21T12:00:00.000Z",
  webViewLink: `https://drive.google.com/open?id=${id}`,
  trashed: input.trashed ?? false,
  parents: [input.parent ?? "folder_a"],
});

const ledgerPort = (
  confect: Harness,
): DriveReconciliationLedger & DriveIngestionLedger => ({
  getExpectedIncarnation: (organization, providerObjectKey) =>
    Effect.runPromise(
      confect.run(
        Effect.gen(function* () {
          const reader = yield* DriveLedgerDatabaseReader;
          const rows = yield* reader
            .table("documentSourceObjects")
            .index("by_organization_provider_object", (query) =>
              query
                .eq("organizationKey", organization)
                .eq("providerKey", "google_drive")
                .eq("providerObjectKey", providerObjectKey),
            )
            .take(2)
            .pipe(Effect.orDie);
          if (rows.length > 1)
            throw new Error("duplicate Drive object identity");
          return rows[0]?.incarnation ?? null;
        }),
        resultSchema(),
      ),
    ),
  commitObservation: (args) =>
    Effect.runPromise(
      confect.run(commitDriveObservation(args), resultSchema()),
    ),
  recordSourceOutcome: (args) =>
    Effect.runPromise(
      confect.run(recordDriveSourceOutcome(args), resultSchema()),
    ),
});

const runPortEffect = async <Result, Error>(
  effect: Effect.Effect<Result, Error>,
): Promise<Result> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;
  throw Cause.squash(exit.cause);
};

const reconciliationPort = (confect: Harness): DriveReconciliationPort => ({
  loadPage: (args) =>
    Effect.runPromise(
      confect.run(loadPersistedDriveReconciliationPage(args), resultSchema()),
    ),
  beginPage: (args) =>
    runPortEffect(
      confect.mutation(reconciliationRefs.beginReconciliationPage, {
        ...args,
        ledgerHighWater: Number.MAX_SAFE_INTEGER,
      }),
    ),
  commitChunk: (args) =>
    runPortEffect(
      confect.mutation(reconciliationRefs.commitReconciliationPageChunk, args),
    ),
  finalizePage: (args) =>
    runPortEffect(
      confect.mutation(reconciliationRefs.finalizeReconciliationPage, args),
    ),
});

const openRun = async (
  confect: Harness,
  workspaceId: GenericId<"workspaces">,
  callerLedgerHighWater = now,
) => {
  const captured = await captureDriveReconciliationStart({
    client: {
      getStartPageToken: vi.fn(async () => "cursor_high_water"),
    },
    scope,
  });
  const authority = {
    organizationKey,
    workspaceId,
    brainKey,
    corpusKey: "documents" as const,
    providerKind: "google_drive" as const,
    connectorScopeKey: driveConnectorScope(scope).connectorScopeKey,
    connectionKey: scope.connectionKey,
    connectionGeneration: scope.connectionGeneration,
    allowlistGeneration: scope.allowlistGeneration,
  };
  const required = await Effect.runPromise(
    confect.mutation(reconciliationRefs.upsertRequiredScopeIntent, {
      ...authority,
      expectedIntentGeneration: 0,
      controllingConfigurationDigest: `sha256:${"1".repeat(64)}`,
      now,
    }),
  );
  const run = await Effect.runPromise(
    confect.mutation(reconciliationRefs.openReconciliationRun, {
      ...authority,
      expectedPreviousRunGeneration: 0,
      initialCursor: captured.initialCursor,
      providerHighWater: captured.providerHighWater,
      ledgerHighWater: callerLedgerHighWater,
      leaseId: "drive_reconciliation_lease",
      leaseGeneration: 1,
      leaseExpiresAt: now + 60_000,
      now,
    }),
  );
  return { authority, captured, required, run };
};

const driveLeaseRef = {
  expectedLeaseGeneration: 1,
  leaseId: "drive_reconciliation_lease",
} as const;

const coordinateDriveReconciliationPage = (
  input: Omit<
    Parameters<typeof coordinateDriveReconciliationPageWithLease>[0],
    "expectedLeaseGeneration" | "leaseId"
  >,
) => coordinateDriveReconciliationPageWithLease({ ...input, ...driveLeaseRef });

const readRunState = (
  confect: Harness,
  input: { readonly runKey: string; readonly cursorKey: string },
) =>
  Effect.runPromise(
    confect.run(
      Effect.gen(function* () {
        const reader = yield* DriveLedgerDatabaseReader;
        const [
          runs,
          cursors,
          envelopes,
          chunks,
          seen,
          obligations,
          objects,
          observations,
          revisions,
          outcomes,
        ] = yield* Effect.all([
          reader
            .table("connectorReconciliationRuns")
            .index("by_reconciliation_run_key", (query) =>
              query.eq("reconciliationRunKey", input.runKey),
            )
            .take(2)
            .pipe(Effect.orDie),
          reader
            .table("connectorIncrementalCursors")
            .index("by_cursor_key", (query) =>
              query.eq("cursorKey", input.cursorKey),
            )
            .take(2)
            .pipe(Effect.orDie),
          reader
            .table("connectorPageEnvelopes")
            .index("by_run_page_envelope", (query) =>
              query.eq("reconciliationRunKey", input.runKey),
            )
            .take(100)
            .pipe(Effect.orDie),
          reader
            .table("connectorPageChunks")
            .index("by_run_page_chunk", (query) =>
              query.eq("reconciliationRunKey", input.runKey),
            )
            .take(100)
            .pipe(Effect.orDie),
          reader
            .table("connectorReconciliationSeen")
            .index("by_run_ledger_sequence", (query) =>
              query.eq("reconciliationRunKey", input.runKey),
            )
            .take(100)
            .pipe(Effect.orDie),
          reader
            .table("ingestionObligations")
            .index("by_run_ledger_sequence", (query) =>
              query.eq("reconciliationRunKey", input.runKey),
            )
            .take(100)
            .pipe(Effect.orDie),
          reader
            .table("documentSourceObjects")
            .index("by_organization", (query) =>
              query.eq("organizationKey", organizationKey),
            )
            .take(100)
            .pipe(Effect.orDie),
          reader
            .table("documentSourceObservations")
            .index("by_organization", (query) =>
              query.eq("organizationKey", organizationKey),
            )
            .take(100)
            .pipe(Effect.orDie),
          reader
            .table("documentSourceRevisions")
            .index("by_organization", (query) =>
              query.eq("organizationKey", organizationKey),
            )
            .take(100)
            .pipe(Effect.orDie),
          reader
            .table("documentSourceOutcomes")
            .index("by_organization", (query) =>
              query.eq("organizationKey", organizationKey),
            )
            .take(100)
            .pipe(Effect.orDie),
        ]);
        return {
          run: runs[0],
          cursor: cursors[0],
          envelopes,
          chunks,
          seen,
          obligations,
          objects,
          observations,
          revisions,
          outcomes,
        };
      }),
      resultSchema(),
    ),
  );

type TestDriveChange = Readonly<{
  fileId: string;
  removed: boolean;
  time: null;
  file: ReturnType<typeof file>;
}>;

const changeClientFor = (
  changes: readonly TestDriveChange[],
  cursorAfter: string,
) => ({
  listChanges: vi.fn(async () => ({
    changes,
    nextPageToken: null,
    newStartPageToken: cursorAfter,
  })),
  exportText: vi.fn(
    async ({ fileId }: { readonly fileId: string }) =>
      `# ${fileId}\n\nDurable body for ${fileId}.`,
  ),
});

const reconciliationClientFor = (
  input: Readonly<{
    providerHighWater?: string;
    inventoryPages: readonly Readonly<{
      pageToken: string | null;
      files: readonly ReturnType<typeof file>[];
      nextPageToken: string | null;
    }>[];
    catchUpPages?: readonly Readonly<{
      pageToken: string;
      changes: readonly TestDriveChange[];
      nextPageToken: string | null;
      newStartPageToken: string | null;
    }>[];
  }>,
) => {
  const providerHighWater = input.providerHighWater ?? "cursor_high_water";
  const catchUpPages = input.catchUpPages ?? [
    {
      pageToken: providerHighWater,
      changes: [],
      nextPageToken: null,
      newStartPageToken: `${providerHighWater}_caught_up`,
    },
  ];
  return {
    getStartPageToken: vi.fn(async () => providerHighWater),
    listInventoryPage: vi.fn(
      async ({ pageToken }: { readonly pageToken: string | null }) => {
        const page = input.inventoryPages.find(
          (candidate) => candidate.pageToken === pageToken,
        );
        if (page === undefined)
          throw new Error(`Unexpected inventory page token: ${pageToken}`);
        return { files: page.files, nextPageToken: page.nextPageToken };
      },
    ),
    listChanges: vi.fn(
      async ({ pageToken }: { readonly pageToken: string }) => {
        const page = catchUpPages.find(
          (candidate) => candidate.pageToken === pageToken,
        );
        if (page === undefined)
          throw new Error(`Unexpected catch-up page token: ${pageToken}`);
        return {
          changes: page.changes,
          nextPageToken: page.nextPageToken,
          newStartPageToken: page.newStartPageToken,
        };
      },
    ),
    exportText: vi.fn(
      async ({ fileId }: { readonly fileId: string }) =>
        `# ${fileId}\n\nDurable body for ${fileId}.`,
    ),
  };
};

describe("Drive reconciliation coordinator", () => {
  it("persists the page before any Drive write and resumes its atomic chunks without refetching", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      const opened = await openRun(confect, tenancy.workspaceId);
      const client = reconciliationClientFor({
        inventoryPages: [
          {
            pageToken: null,
            files: [file("file_1"), file("file_2")],
            nextPageToken: null,
          },
        ],
      });
      let crashBeforeChunk = true;

      await expect(
        coordinateDriveReconciliationPage({
          organizationKey,
          scope,
          client,
          ledger: ledgerPort(confect),
          pageToken: opened.captured.initialCursor,
          pageSize: 50,
          observedAt: now,
          retentionClass: "internal_company",
          permissionSnapshotHash: async () => "a".repeat(64),
          reconciliation: reconciliationPort(confect),
          reconciliationRunKey: opened.run.reconciliationRunKey,
          expectedRunGeneration: opened.run.runGeneration,
          expectedConnectionGeneration: scope.connectionGeneration,
          expectedAllowlistGeneration: scope.allowlistGeneration,
          cursorKey: opened.run.cursorKey,
          expectedCursorGeneration: 1,
          requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
          providerHighWater: "cursor_high_water",
          chunkSize: 1,
          beforeReconciliationChunk: async () => {
            if (crashBeforeChunk) {
              crashBeforeChunk = false;
              throw new Error("simulated crash before atomic chunk");
            }
          },
        }),
      ).rejects.toMatchObject({
        _tag: "DriveReconciliationCoordinatorError",
        reason: "before_chunk_commit_failed",
        causeTag: null,
      });

      const beforeChunk = await readRunState(confect, {
        runKey: opened.run.reconciliationRunKey,
        cursorKey: opened.run.cursorKey,
      });
      expect(beforeChunk.cursor).toMatchObject({
        providerCursor: opened.captured.initialCursor,
        cursorGeneration: 1,
      });
      expect(beforeChunk.cursor?.activeEnvelopeKey).not.toBeNull();
      expect(beforeChunk.envelopes).toHaveLength(1);
      expect(beforeChunk.observations).toHaveLength(0);
      expect(beforeChunk.outcomes).toHaveLength(0);
      expect(beforeChunk.chunks).toHaveLength(0);
      expect(beforeChunk.seen).toHaveLength(0);
      expect(beforeChunk.obligations).toHaveLength(0);

      const replay = await coordinateDriveReconciliationPage({
        organizationKey,
        scope,
        client,
        ledger: ledgerPort(confect),
        pageToken: opened.captured.initialCursor,
        pageSize: 50,
        observedAt: now,
        retentionClass: "internal_company",
        permissionSnapshotHash: async () => "a".repeat(64),
        reconciliation: reconciliationPort(confect),
        reconciliationRunKey: opened.run.reconciliationRunKey,
        expectedRunGeneration: opened.run.runGeneration,
        expectedConnectionGeneration: scope.connectionGeneration,
        expectedAllowlistGeneration: scope.allowlistGeneration,
        cursorKey: opened.run.cursorKey,
        expectedCursorGeneration: 1,
        requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
        providerHighWater: "cursor_high_water",
        chunkSize: 1,
        afterReconciliationChunk: async (_receipt, chunkIndex) => {
          if (chunkIndex === 0)
            throw new Error("simulated response loss after atomic chunk");
        },
      }).catch((error: unknown) => {
        expect(error).toMatchObject({
          _tag: "DriveReconciliationCoordinatorError",
          reason: "after_chunk_commit_failed",
        });
        return null;
      });
      const afterResponseLoss = await readRunState(confect, {
        runKey: opened.run.reconciliationRunKey,
        cursorKey: opened.run.cursorKey,
      });

      expect(replay).toBeNull();
      expect(afterResponseLoss.observations).toHaveLength(1);
      expect(afterResponseLoss.chunks).toHaveLength(1);
      expect(afterResponseLoss.seen).toHaveLength(1);
      expect(afterResponseLoss.obligations).toHaveLength(1);

      const resumed = await coordinateDriveReconciliationPage({
        organizationKey,
        scope,
        client,
        ledger: ledgerPort(confect),
        pageToken: opened.captured.initialCursor,
        pageSize: 50,
        observedAt: now,
        retentionClass: "internal_company",
        permissionSnapshotHash: async () => "a".repeat(64),
        reconciliation: reconciliationPort(confect),
        reconciliationRunKey: opened.run.reconciliationRunKey,
        expectedRunGeneration: opened.run.runGeneration,
        expectedConnectionGeneration: scope.connectionGeneration,
        expectedAllowlistGeneration: scope.allowlistGeneration,
        cursorKey: opened.run.cursorKey,
        expectedCursorGeneration: 1,
        requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
        providerHighWater: "cursor_high_water",
        chunkSize: 1,
      });
      const inventoryComplete = await readRunState(confect, {
        runKey: opened.run.reconciliationRunKey,
        cursorKey: opened.run.cursorKey,
      });

      expect(client.listInventoryPage).toHaveBeenCalledTimes(1);
      expect(client.listChanges).not.toHaveBeenCalled();
      expect(resumed.chunkReceipts.map(({ duplicate }) => duplicate)).toEqual([
        true,
        false,
      ]);
      expect(inventoryComplete.cursor).toMatchObject({
        providerCursor: expect.stringContaining("drive-reconciliation:v1:"),
        traversalComplete: false,
        cursorGeneration: 2,
        activeEnvelopeKey: null,
      });
      expect(inventoryComplete.chunks).toHaveLength(2);
      expect(inventoryComplete.seen).toHaveLength(2);
      expect(inventoryComplete.obligations).toHaveLength(2);
      expect(inventoryComplete.observations).toHaveLength(2);

      const finalizedReplay = await coordinateDriveReconciliationPage({
        organizationKey,
        scope,
        client,
        ledger: ledgerPort(confect),
        pageToken: opened.captured.initialCursor,
        pageSize: 50,
        observedAt: now,
        retentionClass: "internal_company",
        permissionSnapshotHash: async () => "a".repeat(64),
        reconciliation: reconciliationPort(confect),
        reconciliationRunKey: opened.run.reconciliationRunKey,
        expectedRunGeneration: opened.run.runGeneration,
        expectedConnectionGeneration: scope.connectionGeneration,
        expectedAllowlistGeneration: scope.allowlistGeneration,
        cursorKey: opened.run.cursorKey,
        expectedCursorGeneration: 1,
        requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
        providerHighWater: "cursor_high_water",
        chunkSize: 1,
      });
      expect(
        finalizedReplay.chunkReceipts.map(({ duplicate }) => duplicate),
      ).toEqual([true, true]);
      expect(finalizedReplay.cursor).toEqual(resumed.cursor);
      expect(client.listInventoryPage).toHaveBeenCalledTimes(1);

      const catchUpCursor = resumed.cursor.providerCursor;
      if (catchUpCursor === null) throw new Error("catch-up cursor missing");
      const caughtUp = await coordinateDriveReconciliationPage({
        organizationKey,
        scope,
        client,
        ledger: ledgerPort(confect),
        pageToken: catchUpCursor,
        pageSize: 50,
        observedAt: now,
        retentionClass: "internal_company",
        permissionSnapshotHash: async () => "a".repeat(64),
        reconciliation: reconciliationPort(confect),
        reconciliationRunKey: opened.run.reconciliationRunKey,
        expectedRunGeneration: opened.run.runGeneration,
        expectedConnectionGeneration: scope.connectionGeneration,
        expectedAllowlistGeneration: scope.allowlistGeneration,
        cursorKey: opened.run.cursorKey,
        expectedCursorGeneration: 2,
        requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
        providerHighWater: opened.captured.providerHighWater,
        chunkSize: 1,
      });
      expect(caughtUp.cursor).toMatchObject({
        providerCursor: expect.stringContaining("drive-reconciliation:v1:"),
        traversalComplete: true,
        cursorGeneration: 3,
      });
      expect(client.listChanges).toHaveBeenCalledTimes(1);
    }));

  it("owns strictly monotonic Drive ledger sequences and page fences across chunks and pages", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      const opened = await openRun(
        confect,
        tenancy.workspaceId,
        Number.MAX_SAFE_INTEGER,
      );
      const client = reconciliationClientFor({
        inventoryPages: [
          {
            pageToken: null,
            files: [file("file_sequence_1"), file("file_sequence_2")],
            nextPageToken: "inventory_cursor_2",
          },
          {
            pageToken: "inventory_cursor_2",
            files: [file("file_sequence_3")],
            nextPageToken: null,
          },
        ],
      });
      const coordinate = (
        pageToken: string,
        expectedCursorGeneration: number,
      ) =>
        coordinateDriveReconciliationPage({
          organizationKey,
          scope,
          client,
          ledger: ledgerPort(confect),
          pageToken,
          pageSize: 50,
          observedAt: now,
          retentionClass: "internal_company",
          permissionSnapshotHash: async () => "a".repeat(64),
          reconciliation: reconciliationPort(confect),
          reconciliationRunKey: opened.run.reconciliationRunKey,
          expectedRunGeneration: opened.run.runGeneration,
          expectedConnectionGeneration: scope.connectionGeneration,
          expectedAllowlistGeneration: scope.allowlistGeneration,
          cursorKey: opened.run.cursorKey,
          expectedCursorGeneration,
          requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
          providerHighWater: "cursor_high_water",
          chunkSize: 1,
        });

      const first = await coordinate(opened.captured.initialCursor, 1);
      if (first.cursor.providerCursor === null)
        throw new Error("second inventory cursor missing");
      const second = await coordinate(first.cursor.providerCursor, 2);
      if (second.cursor.providerCursor === null)
        throw new Error("catch-up cursor missing");
      const third = await coordinate(second.cursor.providerCursor, 3);
      const state = await readRunState(confect, {
        runKey: opened.run.reconciliationRunKey,
        cursorKey: opened.run.cursorKey,
      });
      const ledgerSequences = state.observations
        .map(({ ledgerSequence }) => ledgerSequence)
        .sort((left, right) => (left ?? 0) - (right ?? 0));

      expect(ledgerSequences).toEqual([1, 2, 3]);
      expect(
        state.observations.every(
          ({ ledgerSequence, recordedAt, observedAt }) =>
            ledgerSequence === recordedAt && observedAt === now,
        ),
      ).toBe(true);
      expect(state.seen.map(({ ledgerSequence }) => ledgerSequence)).toEqual([
        1, 2, 3,
      ]);
      expect(
        state.envelopes
          .map(({ ledgerHighWater }) => ledgerHighWater)
          .sort((left, right) => (left ?? 0) - (right ?? 0)),
      ).toEqual([2, 3, 3]);
      expect(first.cursor.ledgerHighWater).toBe(2);
      expect(second.cursor.ledgerHighWater).toBe(3);
      expect(third.cursor).toMatchObject({
        traversalComplete: true,
        ledgerHighWater: 3,
      });
      expect(state.cursor?.ledgerHighWater).toBe(3);
      expect(state.run?.ledgerHighWater).toBe(3);
      expect(state.run?.ledgerHighWater).not.toBe(Number.MAX_SAFE_INTEGER);
      expect(client.listInventoryPage).toHaveBeenCalledTimes(2);
      expect(client.listChanges).toHaveBeenCalledTimes(1);
    }));

  it("sees unchanged inventory files and only infers removal after catch-up completes", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      const ledger = ledgerPort(confect);
      await ingestDriveChangePage({
        organizationKey,
        scope,
        client: changeClientFor(
          ["file_keep", "file_delete", "file_unshare"].map((fileId) => ({
            fileId,
            removed: false,
            time: null,
            file: file(fileId),
          })),
          "baseline_cursor",
        ),
        ledger,
        pageToken: "baseline_start",
        pageSize: 50,
        observedAt: now - 100,
        retentionClass: "internal_company",
        permissionSnapshotHash: async () => "a".repeat(64),
      });
      const opened = await openRun(confect, tenancy.workspaceId);
      const client = reconciliationClientFor({
        inventoryPages: [
          {
            pageToken: null,
            files: [file("file_keep")],
            nextPageToken: null,
          },
        ],
        catchUpPages: [
          {
            pageToken: "cursor_high_water",
            changes: [
              {
                fileId: "file_delete",
                removed: true,
                time: null,
                file: file("file_delete", { version: "2", trashed: true }),
              },
            ],
            nextPageToken: null,
            newStartPageToken: "cursor_caught_up",
          },
        ],
      });
      const inventory = await coordinateDriveReconciliationPage({
        organizationKey,
        scope,
        client,
        ledger,
        pageToken: opened.captured.initialCursor,
        pageSize: 50,
        observedAt: now,
        retentionClass: "internal_company",
        permissionSnapshotHash: async () => "a".repeat(64),
        reconciliation: reconciliationPort(confect),
        reconciliationRunKey: opened.run.reconciliationRunKey,
        expectedRunGeneration: opened.run.runGeneration,
        expectedConnectionGeneration: scope.connectionGeneration,
        expectedAllowlistGeneration: scope.allowlistGeneration,
        cursorKey: opened.run.cursorKey,
        expectedCursorGeneration: 1,
        requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
        providerHighWater: "cursor_high_water",
      });
      expect(inventory.cursor.traversalComplete).toBe(false);
      await expect(
        runPortEffect(
          confect.mutation(reconciliationRefs.closeReconciliationTraversal, {
            ...driveLeaseRef,
            reconciliationRunKey: opened.run.reconciliationRunKey,
            expectedRunGeneration: opened.run.runGeneration,
            expectedConnectionGeneration: scope.connectionGeneration,
            expectedAllowlistGeneration: scope.allowlistGeneration,
            now: now + 1,
          }),
        ),
      ).rejects.toMatchObject({
        _tag: "ProviderReconciliationConflict",
        reason: "traversal_incomplete",
      });
      const catchUpCursor = inventory.cursor.providerCursor;
      if (catchUpCursor === null) throw new Error("catch-up cursor missing");
      const traversed = await coordinateDriveReconciliationPage({
        organizationKey,
        scope,
        client,
        ledger,
        pageToken: catchUpCursor,
        pageSize: 50,
        observedAt: now,
        retentionClass: "internal_company",
        permissionSnapshotHash: async () => "a".repeat(64),
        reconciliation: reconciliationPort(confect),
        reconciliationRunKey: opened.run.reconciliationRunKey,
        expectedRunGeneration: opened.run.runGeneration,
        expectedConnectionGeneration: scope.connectionGeneration,
        expectedAllowlistGeneration: scope.allowlistGeneration,
        cursorKey: opened.run.cursorKey,
        expectedCursorGeneration: 2,
        requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
        providerHighWater: "cursor_high_water",
      });
      expect(traversed.cursor).toMatchObject({
        providerCursor: expect.stringContaining("drive-reconciliation:v1:"),
        traversalComplete: true,
      });
      expect(client.listInventoryPage).toHaveBeenCalledTimes(1);
      expect(client.listChanges).toHaveBeenCalledTimes(1);

      const closed = await Effect.runPromise(
        confect.mutation(reconciliationRefs.closeReconciliationTraversal, {
          ...driveLeaseRef,
          reconciliationRunKey: opened.run.reconciliationRunKey,
          expectedRunGeneration: opened.run.runGeneration,
          expectedConnectionGeneration: scope.connectionGeneration,
          expectedAllowlistGeneration: scope.allowlistGeneration,
          now: now + 1,
        }),
      );
      const closedReplay = await Effect.runPromise(
        confect.mutation(reconciliationRefs.closeReconciliationTraversal, {
          ...driveLeaseRef,
          reconciliationRunKey: opened.run.reconciliationRunKey,
          expectedRunGeneration: opened.run.runGeneration,
          expectedConnectionGeneration: scope.connectionGeneration,
          expectedAllowlistGeneration: scope.allowlistGeneration,
          now: now + 1,
        }),
      );
      expect(closedReplay).toEqual(closed);
      const removalPage = await Effect.runPromise(
        confect.run(
          listDriveReconciliationRemovalCandidates({
            organizationKey,
            connectorScopeKey: opened.authority.connectorScopeKey,
            connectionGeneration: scope.connectionGeneration,
            allowlistGeneration: scope.allowlistGeneration,
            afterDocumentObjectKey: null,
            limit: 100,
          }),
          resultSchema(),
        ),
      );
      const removals = await Effect.runPromise(
        confect.mutation(reconciliationRefs.applyReconciliationRemovalBatch, {
          ...driveLeaseRef,
          reconciliationRunKey: opened.run.reconciliationRunKey,
          expectedRunGeneration: opened.run.runGeneration,
          expectedConnectionGeneration: scope.connectionGeneration,
          expectedAllowlistGeneration: scope.allowlistGeneration,
          requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
          expectedRemovalCursor: null,
          nextRemovalCursor: removalPage.nextCursor,
          finalBatch: removalPage.nextCursor === null,
          candidates: removalPage.candidates,
          now: now + 2,
        }),
      );
      expect(removals).toMatchObject({
        status: "drain_derived",
        candidateCount: 2,
        removalCount: 1,
      });

      const state = await readRunState(confect, {
        runKey: opened.run.reconciliationRunKey,
        cursorKey: opened.run.cursorKey,
      });
      expect(
        state.seen.map(({ providerObjectKey }) => providerObjectKey).sort(),
      ).toEqual(["file_delete", "file_keep"]);
      const removalProviderObjectKeys = state.obligations
        .filter(({ cause }) => cause === "removal")
        .map(
          ({ originKey }) =>
            state.objects.find(
              ({ documentObjectKey }) => documentObjectKey === originKey,
            )?.providerObjectKey,
        )
        .sort();
      expect(removalProviderObjectKeys).toEqual([
        "file_delete",
        "file_unshare",
      ]);
      expect(
        state.objects.find(
          ({ providerObjectKey }) => providerObjectKey === "file_keep",
        ),
      ).toMatchObject({ lifecycleState: "live" });
      expect(
        state.objects.find(
          ({ providerObjectKey }) => providerObjectKey === "file_delete",
        ),
      ).toMatchObject({ lifecycleState: "tombstoned" });
    }));

  it("rejects replay of an open request after a successor run exists", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      const first = await openRun(confect, tenancy.workspaceId);
      const second = await Effect.runPromise(
        confect.mutation(reconciliationRefs.openReconciliationRun, {
          ...first.authority,
          expectedPreviousRunGeneration: first.run.runGeneration,
          initialCursor: first.captured.initialCursor,
          providerHighWater: "cursor_high_water_2",
          ledgerHighWater: now + 1,
          leaseId: "drive_reconciliation_lease_2",
          leaseGeneration: 2,
          leaseExpiresAt: now + 120_000,
          now: now + 1,
        }),
      );
      expect(second.runGeneration).toBe(first.run.runGeneration + 1);
      await expect(
        runPortEffect(
          confect.mutation(reconciliationRefs.openReconciliationRun, {
            ...first.authority,
            expectedPreviousRunGeneration: 0,
            initialCursor: first.captured.initialCursor,
            providerHighWater: "cursor_high_water",
            ledgerHighWater: now,
            leaseId: "drive_reconciliation_lease",
            leaseGeneration: 1,
            leaseExpiresAt: now + 60_000,
            now,
          }),
        ),
      ).rejects.toMatchObject({
        _tag: "ProviderReconciliationConflict",
        reason: "run_superseded",
      });
    }));

  it("atomically covers unsupported and quarantined Drive outcomes with blocking obligations", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      const opened = await openRun(confect, tenancy.workspaceId);
      const client = reconciliationClientFor({
        inventoryPages: [
          {
            pageToken: null,
            files: [
              file("file_zip", { mimeType: "application/zip" }),
              file("file_without_order", { version: null }),
            ],
            nextPageToken: null,
          },
        ],
      });
      let crash = true;
      await expect(
        coordinateDriveReconciliationPage({
          organizationKey,
          scope,
          client,
          ledger: ledgerPort(confect),
          pageToken: opened.captured.initialCursor,
          pageSize: 50,
          observedAt: now,
          retentionClass: "internal_company",
          permissionSnapshotHash: async () => "a".repeat(64),
          reconciliation: reconciliationPort(confect),
          reconciliationRunKey: opened.run.reconciliationRunKey,
          expectedRunGeneration: opened.run.runGeneration,
          expectedConnectionGeneration: scope.connectionGeneration,
          expectedAllowlistGeneration: scope.allowlistGeneration,
          cursorKey: opened.run.cursorKey,
          expectedCursorGeneration: 1,
          requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
          providerHighWater: "cursor_high_water",
          beforeReconciliationChunk: async () => {
            if (crash) {
              crash = false;
              throw new Error("simulated crash before atomic outcome chunk");
            }
          },
        }),
      ).rejects.toMatchObject({
        _tag: "DriveReconciliationCoordinatorError",
        reason: "before_chunk_commit_failed",
      });
      const beforeEnvelope = await readRunState(confect, {
        runKey: opened.run.reconciliationRunKey,
        cursorKey: opened.run.cursorKey,
      });
      expect(beforeEnvelope.cursor).toMatchObject({
        providerCursor: opened.captured.initialCursor,
        activeEnvelopeKey: expect.any(String),
      });
      expect(beforeEnvelope.envelopes).toHaveLength(1);
      expect(beforeEnvelope.outcomes).toHaveLength(0);
      expect(beforeEnvelope.observations).toHaveLength(0);
      expect(beforeEnvelope.chunks).toHaveLength(0);
      expect(beforeEnvelope.seen).toHaveLength(0);
      expect(beforeEnvelope.obligations).toHaveLength(0);
      await expect(
        runPortEffect(
          confect.mutation(reconciliationRefs.closeReconciliationTraversal, {
            ...driveLeaseRef,
            reconciliationRunKey: opened.run.reconciliationRunKey,
            expectedRunGeneration: opened.run.runGeneration,
            expectedConnectionGeneration: scope.connectionGeneration,
            expectedAllowlistGeneration: scope.allowlistGeneration,
            now: now + 1,
          }),
        ),
      ).rejects.toMatchObject({
        _tag: "ProviderReconciliationConflict",
        reason: "traversal_incomplete",
      });

      const inventory = await coordinateDriveReconciliationPage({
        organizationKey,
        scope,
        client,
        ledger: ledgerPort(confect),
        pageToken: opened.captured.initialCursor,
        pageSize: 50,
        observedAt: now,
        retentionClass: "internal_company",
        permissionSnapshotHash: async () => "a".repeat(64),
        reconciliation: reconciliationPort(confect),
        reconciliationRunKey: opened.run.reconciliationRunKey,
        expectedRunGeneration: opened.run.runGeneration,
        expectedConnectionGeneration: scope.connectionGeneration,
        expectedAllowlistGeneration: scope.allowlistGeneration,
        cursorKey: opened.run.cursorKey,
        expectedCursorGeneration: 1,
        requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
        providerHighWater: "cursor_high_water",
      });
      expect(client.listInventoryPage).toHaveBeenCalledTimes(1);
      expect(client.listChanges).not.toHaveBeenCalled();
      const catchUpCursor = inventory.cursor.providerCursor;
      if (catchUpCursor === null) throw new Error("catch-up cursor missing");
      await coordinateDriveReconciliationPage({
        organizationKey,
        scope,
        client,
        ledger: ledgerPort(confect),
        pageToken: catchUpCursor,
        pageSize: 50,
        observedAt: now,
        retentionClass: "internal_company",
        permissionSnapshotHash: async () => "a".repeat(64),
        reconciliation: reconciliationPort(confect),
        reconciliationRunKey: opened.run.reconciliationRunKey,
        expectedRunGeneration: opened.run.runGeneration,
        expectedConnectionGeneration: scope.connectionGeneration,
        expectedAllowlistGeneration: scope.allowlistGeneration,
        cursorKey: opened.run.cursorKey,
        expectedCursorGeneration: 2,
        requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
        providerHighWater: "cursor_high_water",
      });
      expect(client.listChanges).toHaveBeenCalledTimes(1);
      await runPortEffect(
        confect.mutation(reconciliationRefs.closeReconciliationTraversal, {
          ...driveLeaseRef,
          reconciliationRunKey: opened.run.reconciliationRunKey,
          expectedRunGeneration: opened.run.runGeneration,
          expectedConnectionGeneration: scope.connectionGeneration,
          expectedAllowlistGeneration: scope.allowlistGeneration,
          now: now + 2,
        }),
      );
      await runPortEffect(
        confect.mutation(reconciliationRefs.applyReconciliationRemovalBatch, {
          ...driveLeaseRef,
          reconciliationRunKey: opened.run.reconciliationRunKey,
          expectedRunGeneration: opened.run.runGeneration,
          expectedConnectionGeneration: scope.connectionGeneration,
          expectedAllowlistGeneration: scope.allowlistGeneration,
          requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
          expectedRemovalCursor: null,
          nextRemovalCursor: null,
          finalBatch: true,
          candidates: [],
          now: now + 3,
        }),
      );
      const blocked = await readRunState(confect, {
        runKey: opened.run.reconciliationRunKey,
        cursorKey: opened.run.cursorKey,
      });
      expect(blocked.outcomes).toHaveLength(2);
      expect(blocked.chunks).toHaveLength(2);
      expect(blocked.seen).toHaveLength(2);
      expect(blocked.obligations).toHaveLength(2);
      expect(
        blocked.obligations.every(({ state }) => state === "quarantined"),
      ).toBe(true);
      await expect(
        runPortEffect(
          confect.mutation(reconciliationRefs.completeReconciliationRun, {
            ...driveLeaseRef,
            reconciliationRunKey: opened.run.reconciliationRunKey,
            expectedRunGeneration: opened.run.runGeneration,
            expectedConnectionGeneration: scope.connectionGeneration,
            expectedAllowlistGeneration: scope.allowlistGeneration,
            now: now + 4,
          }),
        ),
      ).rejects.toMatchObject({
        _tag: "ProviderReconciliationConflict",
        reason: "obligation_blocked",
      });
    }));
});
