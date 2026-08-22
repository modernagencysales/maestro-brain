import type { DriveConnectorScopeInput } from "@maestro-template/integrations/googleDrive/canonical";
import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import type { Value } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import generatedConvexSchema from "../confect/_generated/convexSchema";
import {
  ingestDriveChangePage,
  type DriveIngestionLedger,
} from "../confect/integrations/driveIngestionCoordinator";
import {
  driveLedgerDatabaseSchema,
  DriveLedgerDatabaseReader,
} from "../confect/integrations/driveLedgerDatabase";
import {
  commitDriveObservation,
  recordDriveSourceOutcome,
} from "../confect/integrations/driveLedgerRepository";

const driveLedgerConvexSchema = defineSchema({
  ...generatedConvexSchema.tables,
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
  driveLedgerConvexSchema,
  import.meta.glob("../convex/**/!(*.*.*)*.*s"),
);
const resultSchema = <Result>(): Schema.Schema<Result, Value> =>
  Schema.Any as unknown as Schema.Schema<Result, Value>;

type ConfectHarness = TestConfect.TestConfect<typeof driveLedgerDatabaseSchema>;

const withHarness = <Result>(
  run: (confect: ConfectHarness) => Promise<Result>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof driveLedgerDatabaseSchema>();
      return yield* Effect.promise(() => run(confect));
    }).pipe(Effect.provide(testLayer())),
  );

const ledgerPort = (confect: ConfectHarness): DriveIngestionLedger => ({
  getExpectedIncarnation: (organizationKey, providerObjectKey) =>
    Effect.runPromise(
      confect.run(
        Effect.gen(function* () {
          const reader = yield* DriveLedgerDatabaseReader;
          const rows = yield* reader
            .table("documentSourceObjects")
            .index("by_organization_provider_object", (query) =>
              query
                .eq("organizationKey", organizationKey)
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

const readLedger = (confect: ConfectHarness) =>
  Effect.runPromise(
    confect.run(
      Effect.gen(function* () {
        const reader = yield* DriveLedgerDatabaseReader;
        const organizationKey = "ag_0123456789ABCDEFGHJKMNPQRS";
        const [
          objects,
          revisions,
          observations,
          memberships,
          passages,
          outcomes,
        ] = yield* Effect.all([
          reader
            .table("documentSourceObjects")
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
            .table("documentSourceObservations")
            .index("by_organization", (query) =>
              query.eq("organizationKey", organizationKey),
            )
            .take(100)
            .pipe(Effect.orDie),
          reader
            .table("documentSourceMembershipEdges")
            .index("by_organization", (query) =>
              query.eq("organizationKey", organizationKey),
            )
            .take(100)
            .pipe(Effect.orDie),
          reader
            .table("documentSourcePassages")
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
          objects,
          revisions,
          observations,
          memberships,
          passages,
          outcomes,
        };
      }),
      resultSchema(),
    ),
  );

const organizationKey = "ag_0123456789ABCDEFGHJKMNPQRS";
const now = 1_787_270_400_000;
const scope = {
  connectionKey: "gdrive_connection",
  connectionGeneration: 3,
  driveId: "shared_drive_1",
  rootFolderIds: ["folder_a", "folder_b"],
  allowlistGeneration: 4,
  sharedDrive: true,
} as const satisfies DriveConnectorScopeInput;

const file = (
  id: string,
  input: {
    readonly version?: string;
    readonly parent?: string;
    readonly mimeType?: string;
    readonly trashed?: boolean;
  } = {},
) => ({
  id,
  name: `Document ${id}`,
  mimeType: input.mimeType ?? "application/vnd.google-apps.document",
  version: input.version ?? "1",
  modifiedTime: "2026-08-21T12:00:00.000Z",
  webViewLink: `https://drive.google.com/open?id=${id}`,
  trashed: input.trashed ?? false,
  parents: [input.parent ?? "folder_a"],
});

const coordinatorInput = (input: {
  readonly client: Parameters<typeof ingestDriveChangePage>[0]["client"];
  readonly pageToken: string;
  readonly afterDurableWrite?: Parameters<
    typeof ingestDriveChangePage
  >[0]["afterDurableWrite"];
}): Omit<Parameters<typeof ingestDriveChangePage>[0], "ledger"> => ({
  organizationKey,
  scope,
  client: input.client,
  pageToken: input.pageToken,
  pageSize: 50,
  observedAt: now,
  retentionClass: "internal_company",
  permissionSnapshotHash: async () => "a".repeat(64),
  ...(input.afterDurableWrite === undefined
    ? {}
    : { afterDurableWrite: input.afterDurableWrite }),
});

describe("Drive ingestion coordinator", () => {
  it("replays a partially committed page after a crash without duplicating durable evidence", () =>
    withHarness(async (confect) => {
      const client = {
        listChanges: vi.fn(async () => ({
          changes: [
            {
              fileId: "file_1",
              removed: false,
              time: null,
              file: file("file_1"),
            },
            {
              fileId: "file_2",
              removed: false,
              time: null,
              file: file("file_2"),
            },
          ],
          nextPageToken: null,
          newStartPageToken: "cursor_2",
        })),
        exportText: vi.fn(async ({ fileId }: { readonly fileId: string }) =>
          fileId === "file_1"
            ? "# One\n\nFirst body."
            : "# Two\n\nSecond body.",
        ),
      };
      const ledger = ledgerPort(confect);
      let crash = true;
      await expect(
        ingestDriveChangePage({
          ...coordinatorInput({
            client,
            pageToken: "cursor_1",
            afterDurableWrite: async () => {
              if (crash) {
                crash = false;
                throw new Error("simulated process crash");
              }
            },
          }),
          ledger,
        }),
      ).rejects.toMatchObject({
        _tag: "DriveIngestionCoordinatorError",
        reason: "after_commit_failed",
      });
      const afterCrash = await readLedger(confect);
      expect(afterCrash.objects).toHaveLength(1);
      expect(afterCrash.revisions).toHaveLength(1);
      expect(afterCrash.passages.length).toBeGreaterThan(0);

      const replay = await ingestDriveChangePage({
        ...coordinatorInput({ client, pageToken: "cursor_1" }),
        ledger,
      });
      const afterReplay = await readLedger(confect);
      expect(replay).toMatchObject({
        cursorBefore: "cursor_1",
        cursorAfter: "cursor_2",
        terminal: true,
        committed: 2,
        duplicates: 1,
      });
      expect(
        replay.receipts.map(({ classification }) => classification),
      ).toEqual(["duplicate", "created"]);
      expect(afterReplay.objects).toHaveLength(2);
      expect(afterReplay.revisions).toHaveLength(2);
      expect(afterReplay.observations).toHaveLength(2);
    }));

  it("keeps identity stable across an allowlisted move and commits an explicit delete tombstone", () =>
    withHarness(async (confect) => {
      const pages = {
        cursor_1: {
          changes: [
            {
              fileId: "file_move",
              removed: false,
              time: null,
              file: file("file_move"),
            },
          ],
          nextPageToken: "cursor_2",
          newStartPageToken: null,
        },
        cursor_2: {
          changes: [
            {
              fileId: "file_move",
              removed: false,
              time: null,
              file: file("file_move", { version: "2", parent: "folder_b" }),
            },
          ],
          nextPageToken: "cursor_3",
          newStartPageToken: null,
        },
        cursor_3: {
          changes: [
            {
              fileId: "file_move",
              removed: true,
              time: null,
              file: file("file_move", {
                version: "3",
                parent: "folder_b",
                trashed: true,
              }),
            },
          ],
          nextPageToken: null,
          newStartPageToken: "cursor_4",
        },
      } as const;
      const client = {
        listChanges: vi.fn(
          async ({ pageToken }: { readonly pageToken: string }) =>
            pages[pageToken as keyof typeof pages],
        ),
        exportText: vi.fn(async () => "# Current\n\nMoved body."),
      };
      const ledger = ledgerPort(confect);
      const created = await ingestDriveChangePage({
        ...coordinatorInput({ client, pageToken: "cursor_1" }),
        ledger,
      });
      const moved = await ingestDriveChangePage({
        ...coordinatorInput({ client, pageToken: created.cursorAfter }),
        ledger,
      });
      const deleted = await ingestDriveChangePage({
        ...coordinatorInput({ client, pageToken: moved.cursorAfter }),
        ledger,
      });
      const rows = await readLedger(confect);

      expect(created.receipts[0]).toMatchObject({ classification: "created" });
      expect(moved.receipts[0]).toMatchObject({ classification: "newer" });
      expect(deleted.receipts[0]).toMatchObject({
        classification: "tombstone",
        passageCount: 0,
      });
      expect(rows.objects).toMatchObject([
        { lifecycleState: "tombstoned", incarnation: 1 },
      ]);
      expect(rows.revisions).toHaveLength(3);
      expect(
        rows.memberships.map(({ parentFolderIds }) => parentFolderIds),
      ).toEqual([["folder_a"], ["folder_b"], ["folder_b"]]);
    }));

  it("records unsupported MIME evidence durably without exporting or blocking cursor progress", () =>
    withHarness(async (confect) => {
      const client = {
        listChanges: vi.fn(async () => ({
          changes: [
            {
              fileId: "file_zip",
              removed: false,
              time: null,
              file: file("file_zip", { mimeType: "application/zip" }),
            },
          ],
          nextPageToken: null,
          newStartPageToken: "cursor_2",
        })),
        exportText: vi.fn(async () => "must not be called"),
      };
      const result = await ingestDriveChangePage({
        ...coordinatorInput({ client, pageToken: "cursor_1" }),
        ledger: ledgerPort(confect),
      });
      const rows = await readLedger(confect);

      expect(result).toMatchObject({
        cursorAfter: "cursor_2",
        unsupported: 1,
        quarantined: 0,
      });
      expect(result.receipts).toMatchObject([
        { status: "unsupported", reason: "unsupported_mime_type" },
      ]);
      expect(client.exportText).not.toHaveBeenCalled();
      expect(rows.objects).toHaveLength(0);
      expect(rows.outcomes).toMatchObject([
        { outcome: "unsupported", reason: "unsupported_mime_type" },
      ]);
    }));
});
