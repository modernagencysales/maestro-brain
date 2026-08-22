import {
  normalizeDriveFile,
  type CanonicalDriveRevision,
  type DriveConnectorScopeInput,
} from "@maestro-template/integrations/googleDrive/canonical";
import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import type { Value } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import generatedConvexSchema from "../confect/_generated/convexSchema";
import {
  driveLedgerDatabaseSchema,
  DriveLedgerDatabaseReader,
} from "../confect/integrations/driveLedgerDatabase";
import {
  commitDriveObservation,
  recordDriveSourceOutcome,
  verifyDrivePassageProvenance,
} from "../confect/integrations/driveLedgerRepository";
import driveSource from "../confect/integrations/driveSource.spec";
import documentSourceMembershipEdges from "../confect/tables/documentSourceMembershipEdges";
import documentSourceObjects from "../confect/tables/documentSourceObjects";
import documentSourceObservations from "../confect/tables/documentSourceObservations";
import documentSourceOutcomes from "../confect/tables/documentSourceOutcomes";
import documentSourcePassages from "../confect/tables/documentSourcePassages";
import documentSourceRevisions from "../confect/tables/documentSourceRevisions";

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
const driveLedgerTestLayer = TestConfect.layer(
  driveLedgerDatabaseSchema,
  driveLedgerConvexSchema,
  import.meta.glob("../convex/**/!(*.*.*)*.*s"),
);
const resultSchema = <Result>(): Schema.Schema<Result, Value> =>
  Schema.Any as unknown as Schema.Schema<Result, Value>;

const now = 1_787_270_400_000;
const organizationKey = "ag_0123456789ABCDEFGHJKMNPQRS";
const baseScope = {
  connectionKey: "gdrive_connection",
  connectionGeneration: 3,
  driveId: "shared_drive_1",
  rootFolderIds: ["folder_a"],
  allowlistGeneration: 4,
  sharedDrive: true,
} as const satisfies DriveConnectorScopeInput;
const secondScope = {
  ...baseScope,
  rootFolderIds: ["folder_b"],
  allowlistGeneration: 5,
} as const satisfies DriveConnectorScopeInput;

const canonical = (
  input: {
    readonly scope?: DriveConnectorScopeInput;
    readonly version?: string | null;
    readonly text?: string | null;
    readonly trashed?: boolean;
    readonly observedAt?: number;
    readonly permissionSnapshotHash?: string;
    readonly closedReconciliationEpoch?: number;
    readonly mimeType?: string;
  } = {},
): CanonicalDriveRevision =>
  normalizeDriveFile({
    scope: input.scope ?? baseScope,
    file: {
      id: "file_1",
      name: "Operating plan",
      mimeType: input.mimeType ?? "application/vnd.google-apps.document",
      version: input.version === undefined ? "1" : input.version,
      modifiedTime: "2026-08-21T12:00:00.000Z",
      webViewLink: "https://drive.google.com/open?id=file_1",
      trashed: input.trashed ?? false,
      parents: ["folder_a"],
    },
    exportMimeType: input.trashed ? null : "text/plain",
    exportedText: input.trashed
      ? null
      : (input.text ?? "# Plan\n\nCurrent body."),
    ...(input.closedReconciliationEpoch === undefined
      ? {}
      : { closedReconciliationEpoch: input.closedReconciliationEpoch }),
    observedAt: input.observedAt ?? now,
    permissionSnapshotHash: input.permissionSnapshotHash ?? "a".repeat(64),
    retentionClass: "internal_company",
  });

const captureFailure = <Success, Requirements>(
  effect: Effect.Effect<
    Success,
    { readonly _tag: string; readonly field: string },
    Requirements
  >,
) =>
  effect.pipe(
    Effect.match({
      onFailure: (error) => ({
        ok: false as const,
        errorTag: error._tag,
        field: error.field,
      }),
      onSuccess: () => ({ ok: true as const, errorTag: "", field: "" }),
    }),
  );

const readLedger = Effect.gen(function* () {
  const reader = yield* DriveLedgerDatabaseReader;
  const [objects, revisions, observations, memberships, passages, outcomes] =
    yield* Effect.all([
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
  return { objects, revisions, observations, memberships, passages, outcomes };
});

const runLedger = <Result, Error>(
  program: Effect.Effect<
    Result,
    Error,
    TestConfect.TestConfect<typeof driveLedgerDatabaseSchema>
  >,
) => Effect.runPromise(program.pipe(Effect.provide(driveLedgerTestLayer())));

describe("Drive document ledger schemas", () => {
  it("declares exact identity and scope indexes without a global last-seen field", () => {
    expect(documentSourceObjects.indexes).toMatchObject({
      by_organization_provider_object: [
        "organizationKey",
        "providerKey",
        "providerObjectKey",
      ],
    });
    expect(documentSourceRevisions.indexes).toHaveProperty(
      "by_organization_revision_key",
    );
    expect(documentSourceObservations.indexes).toHaveProperty(
      "by_organization_observation_key",
    );
    expect(documentSourceMembershipEdges.indexes).toHaveProperty(
      "by_scope_tuple_object",
    );
    expect(documentSourcePassages.indexes).toHaveProperty(
      "by_revision_ordinal",
    );
    expect(documentSourceOutcomes.indexes).toHaveProperty(
      "by_scope_outcome_observed",
    );
    expect(driveSource.functions).toHaveProperty("commitObservation");
    expect(driveSource.functions).toHaveProperty("recordSourceOutcome");
  });
});

describe("Drive document ledger repository", () => {
  it("commits one immutable object/revision/observation/membership and deduplicates retries", async () => {
    const revision = canonical();
    const program = Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof driveLedgerDatabaseSchema>();
      const first = yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision,
          expectedIncarnation: null,
        }),
        resultSchema(),
      );
      const retry = yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision: { ...revision, observedAt: now + 1_000 },
          expectedIncarnation: 1,
        }),
        resultSchema(),
      );
      const ledger = yield* confect.run(readLedger, resultSchema());
      return { first, retry, ledger };
    });

    const { first, retry, ledger } = await runLedger(program);
    expect(first).toMatchObject({ classification: "created", incarnation: 1 });
    expect(first.documentObjectKey).toMatch(/^gdobj_[a-f0-9]{64}$/);
    expect(first.documentRevisionKey).toMatch(/^gdrev_[a-f0-9]{64}$/);
    expect(first.observationKey).toMatch(/^gdobs_[a-f0-9]{64}$/);
    expect(first.membershipEdgeKey).toMatch(/^gdmem_[a-f0-9]{64}$/);
    expect(retry).toMatchObject({
      classification: "duplicate",
      documentObjectKey: first.documentObjectKey,
      documentRevisionKey: first.documentRevisionKey,
      observationKey: first.observationKey,
      membershipEdgeKey: first.membershipEdgeKey,
    });
    expect(ledger.objects).toHaveLength(1);
    expect(ledger.revisions).toHaveLength(1);
    expect(ledger.observations).toHaveLength(1);
    expect(ledger.memberships).toHaveLength(1);
    expect(ledger.passages.length).toBeGreaterThan(0);
  });

  it("keeps object identity independent from per-scope membership", async () => {
    const program = Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof driveLedgerDatabaseSchema>();
      const first = yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision: canonical(),
          expectedIncarnation: null,
        }),
        resultSchema(),
      );
      const second = yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision: canonical({ scope: secondScope }),
          expectedIncarnation: 1,
        }),
        resultSchema(),
      );
      const ledger = yield* confect.run(readLedger, resultSchema());
      return { first, second, ledger };
    });

    const { first, second, ledger } = await runLedger(program);
    expect(second.documentObjectKey).toBe(first.documentObjectKey);
    expect(second.membershipEdgeKey).not.toBe(first.membershipEdgeKey);
    expect(ledger.objects).toHaveLength(1);
    expect(ledger.memberships).toHaveLength(2);
    expect(
      new Set(
        ledger.memberships.map(({ connectorScopeKey }) => connectorScopeKey),
      ).size,
    ).toBe(2);
  });

  it("retains stale/conflicting observations without replacing the current revision", async () => {
    const current = canonical({ version: "3", text: "Current body" });
    const stale = canonical({
      version: "2",
      text: "Older body",
      observedAt: now + 1_000,
    });
    const equalOrderConflict = canonical({
      version: "3",
      text: "Conflicting body",
      observedAt: now + 2_000,
    });
    const orderConflict = canonical({
      version: null,
      text: "Epoch ordered body",
      observedAt: now + 3_000,
      closedReconciliationEpoch: 7,
    });
    const program = Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof driveLedgerDatabaseSchema>();
      yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision: current,
          expectedIncarnation: null,
        }),
        resultSchema(),
      );
      const staleResult = yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision: stale,
          expectedIncarnation: 1,
        }),
        resultSchema(),
      );
      const conflictResult = yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision: equalOrderConflict,
          expectedIncarnation: 1,
        }),
        resultSchema(),
      );
      const orderConflictResult = yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision: orderConflict,
          expectedIncarnation: 1,
        }),
        resultSchema(),
      );
      const ledger = yield* confect.run(readLedger, resultSchema());
      return { staleResult, conflictResult, orderConflictResult, ledger };
    });

    const result = await runLedger(program);
    expect(result.staleResult.classification).toBe("stale");
    expect(result.conflictResult.classification).toBe("equal_order_conflict");
    expect(result.orderConflictResult.classification).toBe("order_conflict");
    expect(result.ledger.revisions).toHaveLength(1);
    expect(result.ledger.memberships).toHaveLength(1);
    expect(
      result.ledger.observations.map(({ classification }) => classification),
    ).toEqual(
      expect.arrayContaining([
        "created",
        "stale",
        "equal_order_conflict",
        "order_conflict",
      ]),
    );
  });

  it("increments recreation incarnation and supersedes delayed pre-tombstone work", async () => {
    const program = Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof driveLedgerDatabaseSchema>();
      yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision: canonical({ version: "1" }),
          expectedIncarnation: null,
        }),
        resultSchema(),
      );
      const tombstone = yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision: canonical({
            version: "2",
            trashed: true,
            observedAt: now + 1_000,
          }),
          expectedIncarnation: 1,
        }),
        resultSchema(),
      );
      const recreated = yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision: canonical({
            version: "3",
            text: "Recreated body",
            observedAt: now + 2_000,
          }),
          expectedIncarnation: 1,
        }),
        resultSchema(),
      );
      const delayed = yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision: canonical({
            version: "4",
            trashed: true,
            observedAt: now + 3_000,
          }),
          expectedIncarnation: 1,
        }),
        resultSchema(),
      );
      const ledger = yield* confect.run(readLedger, resultSchema());
      return { tombstone, recreated, delayed, ledger };
    });

    const result = await runLedger(program);
    expect(result.tombstone).toMatchObject({
      classification: "tombstone",
      incarnation: 1,
      passageCount: 0,
    });
    expect(result.recreated).toMatchObject({
      classification: "recreated",
      incarnation: 2,
    });
    expect(result.delayed).toMatchObject({
      classification: "superseded",
      incarnation: 2,
      documentRevisionKey: null,
      membershipEdgeKey: null,
    });
    expect(result.ledger.objects).toMatchObject([
      { lifecycleState: "live", incarnation: 2 },
    ]);
    expect(result.ledger.revisions).toHaveLength(3);
  });

  it("stores passages with verifiable normalized byte provenance", async () => {
    const revision = canonical({
      text: "# Café\n\nA composed é passage with stable offsets.",
    });
    const program = Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof driveLedgerDatabaseSchema>();
      yield* confect.run(
        commitDriveObservation({
          organizationKey,
          revision,
          expectedIncarnation: null,
        }),
        resultSchema(),
      );
      return yield* confect.run(readLedger, resultSchema());
    });

    const ledger = await runLedger(program);
    const passage = ledger.passages[0];
    expect(passage).toBeDefined();
    if (!passage) return;
    expect(verifyDrivePassageProvenance(revision, passage)).toBe(true);
    expect(
      verifyDrivePassageProvenance(revision, {
        ...passage,
        endOffset: passage.endOffset - 1,
      }),
    ).toBe(false);
    expect(
      verifyDrivePassageProvenance(revision, {
        ...passage,
        contentHash: "0".repeat(64),
      }),
    ).toBe(false);

    const invalid = await runLedger(
      Effect.gen(function* () {
        const confect =
          yield* TestConfect.TestConfect<typeof driveLedgerDatabaseSchema>();
        return yield* confect.run(
          captureFailure(
            commitDriveObservation({
              organizationKey,
              revision: { ...revision, contentHash: "0".repeat(64) },
              expectedIncarnation: null,
            }),
          ),
          resultSchema(),
        );
      }),
    );
    expect(invalid).toEqual({
      ok: false,
      errorTag: "ValidationFailed",
      field: "revision.contentHash",
    });
  });

  it("persists unsupported/quarantine outcomes visibly without raw provider payloads", async () => {
    const program = Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof driveLedgerDatabaseSchema>();
      const unsupported = yield* confect.run(
        recordDriveSourceOutcome({
          organizationKey,
          connectorScopeKey: `gds_${"1".repeat(64)}`,
          connectionKey: "gdrive_connection",
          connectionGeneration: 3,
          allowlistGeneration: 4,
          providerObjectKey: "file_zip",
          providerRevisionKey: "file_zip:version:1",
          sourceMimeType: "application/zip",
          outcome: "unsupported",
          reason: "unsupported_mime_type",
          observedAt: now,
        }),
        resultSchema(),
      );
      const retry = yield* confect.run(
        recordDriveSourceOutcome({
          organizationKey,
          connectorScopeKey: `gds_${"1".repeat(64)}`,
          connectionKey: "gdrive_connection",
          connectionGeneration: 3,
          allowlistGeneration: 4,
          providerObjectKey: "file_zip",
          providerRevisionKey: "file_zip:version:1",
          sourceMimeType: "application/zip",
          outcome: "unsupported",
          reason: "unsupported_mime_type",
          observedAt: now + 1_000,
        }),
        resultSchema(),
      );
      yield* confect.run(
        recordDriveSourceOutcome({
          organizationKey,
          connectorScopeKey: `gds_${"1".repeat(64)}`,
          connectionKey: "gdrive_connection",
          connectionGeneration: 3,
          allowlistGeneration: 4,
          providerObjectKey: "file_bad",
          providerRevisionKey: null,
          sourceMimeType: null,
          outcome: "quarantined",
          reason: "invalid_file",
          observedAt: now,
        }),
        resultSchema(),
      );
      const ledger = yield* confect.run(readLedger, resultSchema());
      return { unsupported, retry, ledger };
    });

    const result = await runLedger(program);
    expect(result.unsupported).toMatchObject({ duplicate: false });
    expect(result.retry).toMatchObject({
      duplicate: true,
      outcomeKey: result.unsupported.outcomeKey,
    });
    expect(result.ledger.outcomes).toHaveLength(2);
    expect(result.ledger.outcomes.map(({ outcome }) => outcome).sort()).toEqual(
      ["quarantined", "unsupported"],
    );
    const persisted = JSON.stringify(result.ledger.outcomes);
    for (const forbidden of [
      "rawPayload",
      "exportedText",
      "provider body",
      "credential",
      "detail",
    ]) {
      expect(persisted).not.toContain(forbidden);
    }
  });
});
