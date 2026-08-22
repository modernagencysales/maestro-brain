import { Ref } from "@confect/core";
import { TestConfect } from "@confect/test";
import { CanonicalTranscriptRevisionOrder } from "@maestro-template/integrations/transcripts/canonical";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import refs from "../confect/_generated/refs";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import {
  ConnectionRevoked,
  DuplicateKeyConflict,
  RevisionOrderConflict,
  TenantMismatch,
} from "../confect/capabilities/ingestSourceUnit.spec";
import {
  backfillTranscriptRevisionOrder,
  resumeTranscriptRevisionOrderBackfill,
} from "../confect/brain/rolloutOperations.spec";
import { buildCallSourceUnitRows } from "../confect/sources/sourceUnit";
import { TRANSCRIPT_ADAPTER_ORDER_VERSION } from "../confect/sources/transcriptRevisionOrder";
import { testConfectLayer } from "./support/confect";

const now = 1_000;
const call = {
  providerKey: "fireflies",
  connectionKey: "conn_fireflies_1",
  externalCallId: "call_1",
  externalRevisionId: "revision_1",
  revisionOrder: {
    kind: "provider_timestamp",
    timestamp: "2026-08-05T14:00:00.000Z",
    source: "updated_at",
  },
  title: "Acme weekly",
  startedAt: "2026-08-05T14:00:00.000Z",
  endedAt: "2026-08-05T14:30:00.000Z",
  durationMs: 1_800_000,
  organizer: null,
  participants: [],
  segments: [
    {
      externalSegmentId: "call_1:0",
      ordinal: 0,
      evidenceKind: "verbatim_transcript",
      speakerExternalId: "speaker_1",
      speakerLabel: "Alex",
      startMs: 0,
      endMs: 2_000,
      text: "We will launch on Friday.",
    },
  ],
  sourceUrl: "https://app.fireflies.ai/view/call_1",
  recordingUrl: null,
  providerSummary: null,
  providerMetadataJson: "{}",
  deleted: false,
} as const;
const caller = {
  kind: "system",
  name: "transcript-sync",
  surface: "internal",
} as const;
const authority = {
  kind: "provider",
  organizationKey: "agency_acme",
  connectionKey: call.connectionKey,
  connectionGeneration: 2,
} as const;

const ingestRef = refs.internal.capabilities.ingestSourceUnit.ingestSourceUnit;
const backfillTranscriptRevisionOrderRef = Ref.make(
  "brain/rolloutOperations",
  backfillTranscriptRevisionOrder,
);
const resumeTranscriptRevisionOrderBackfillRef = Ref.make(
  "brain/rolloutOperations",
  resumeTranscriptRevisionOrderBackfill,
);

const seedConnection = (overrides: Readonly<Record<string, unknown>> = {}) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    yield* writer
      .table("providerConnections")
      .insert({
        provider: "nango",
        providerConfigKey: "fireflies",
        organizationKey: "agency_acme",
        connectionKey: call.connectionKey,
        connectionGeneration: 2,
        status: "active",
        connectSessionId: "session_1",
        nangoConnectionId: "nango_1",
        nangoEndUserId: "end_user_1",
        nangoOrganizationId: "nango_org_1",
        correlationTag: "transcript:session_1",
        attemptId: "attempt_1",
        attemptExpiresAt: now + 10_000,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      })
      .pipe(Effect.orDie);
    return true;
  });

const Counts = Schema.Struct({
  units: Schema.Number,
  revisions: Schema.Number,
  segments: Schema.Number,
  jobs: Schema.Number,
});
const countRows = Effect.gen(function* () {
  const reader = yield* DatabaseReader;
  const [units, revisions, segments, jobs] = yield* Effect.all([
    reader
      .table("sourceUnits")
      .index("by_unit_key", (query) =>
        query.eq("organizationKey", "agency_acme"),
      )
      .collect()
      .pipe(Effect.orDie),
    reader
      .table("sourceUnitRevisions")
      .index("by_unit_revision_key", (query) =>
        query.eq("organizationKey", "agency_acme"),
      )
      .collect()
      .pipe(Effect.orDie),
    reader
      .table("sourceSegments")
      .index("by_segment_key", (query) =>
        query.eq("organizationKey", "agency_acme"),
      )
      .collect()
      .pipe(Effect.orDie),
    reader
      .table("sourceProcessingJobs")
      .index("by_org_effect_key", (query) =>
        query.eq("organizationKey", "agency_acme"),
      )
      .collect()
      .pipe(Effect.orDie),
  ]);
  return {
    units: units.length,
    revisions: revisions.length,
    segments: segments.length,
    jobs: jobs.length,
  };
});

describe("source-unit ingestion persistence", () => {
  it("inserts once, deduplicates, and appends changed immutable revisions", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedConnection(), Schema.Boolean);
      const first = yield* confect.mutation(ingestRef, {
        input: call,
        authority,
        caller,
        receivedAt: now,
      });
      const duplicate = yield* confect.mutation(ingestRef, {
        input: call,
        authority,
        caller,
        receivedAt: now + 1,
      });
      const afterDuplicate = yield* confect.run(countRows, Counts);
      const changed = yield* confect.mutation(ingestRef, {
        input: {
          ...call,
          externalRevisionId: "revision_2",
          revisionOrder: {
            ...call.revisionOrder,
            timestamp: "2026-08-05T15:00:00.000Z",
          },
          segments: [{ ...call.segments[0], text: "We launched on Friday." }],
        },
        authority,
        caller,
        receivedAt: now + 2,
      });
      const afterChanged = yield* confect.run(countRows, Counts);
      return { first, duplicate, afterDuplicate, changed, afterChanged };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.first).toMatchObject({
      outcome: "inserted",
      segmentCount: 1,
    });
    expect(result.duplicate).toMatchObject({ outcome: "duplicate" });
    expect(result.afterDuplicate).toEqual({
      units: 1,
      revisions: 1,
      segments: 1,
      jobs: 1,
    });
    expect(result.changed).toMatchObject({ outcome: "inserted" });
    expect(result.afterChanged).toEqual({
      units: 1,
      revisions: 2,
      segments: 2,
      jobs: 2,
    });
  });

  it("repairs missing order metadata on an exact same-revision re-observation", async () => {
    const repairProgram = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedConnection(), Schema.Boolean);
      const rows = buildCallSourceUnitRows(call, {
        organizationKey: "agency_acme",
        connectionGeneration: 2,
        receivedAt: now,
      });
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const {
            currentRevisionOrder: _currentRevisionOrder,
            currentRevisionOrderVersion: _currentRevisionOrderVersion,
            ...legacyUnit
          } = rows.unit;
          const {
            revisionOrder: _revisionOrder,
            revisionOrderVersion: _revisionOrderVersion,
            ...legacyRevision
          } = rows.revision;
          void _currentRevisionOrder;
          void _currentRevisionOrderVersion;
          void _revisionOrder;
          void _revisionOrderVersion;
          yield* writer
            .table("sourceUnits")
            .insert(legacyUnit)
            .pipe(Effect.orDie);
          yield* writer
            .table("sourceUnitRevisions")
            .insert(legacyRevision)
            .pipe(Effect.orDie);
          for (const segment of rows.segments)
            yield* writer
              .table("sourceSegments")
              .insert(segment)
              .pipe(Effect.orDie);
        }),
        Schema.Any,
      );
      const repaired = yield* confect.mutation(ingestRef, {
        input: call,
        authority,
        caller,
        receivedAt: now + 1,
      });
      const state = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const unit = yield* reader
            .table("sourceUnits")
            .index("by_unit_key", (query) =>
              query
                .eq("organizationKey", "agency_acme")
                .eq("unitKey", rows.unit.unitKey),
            )
            .first()
            .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          const revision = yield* reader
            .table("sourceUnitRevisions")
            .index("by_unit_revision_key", (query) =>
              query
                .eq("organizationKey", "agency_acme")
                .eq("unitRevisionKey", rows.revision.unitRevisionKey),
            )
            .first()
            .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          const counts = yield* countRows;
          return { unit, revision, counts };
        }),
        Schema.Any,
      );
      return { repaired, state };
    });

    const repaired = await Effect.runPromise(
      repairProgram.pipe(Effect.provide(testConfectLayer())),
    );
    expect(repaired.repaired).toMatchObject({ outcome: "duplicate" });
    expect(repaired.state.unit).toMatchObject({
      currentRevisionOrder: call.revisionOrder,
      currentRevisionOrderVersion: TRANSCRIPT_ADAPTER_ORDER_VERSION,
    });
    expect(repaired.state.revision).toMatchObject({
      revisionOrder: call.revisionOrder,
      revisionOrderVersion: TRANSCRIPT_ADAPTER_ORDER_VERSION,
    });
    expect(repaired.state.counts).toEqual({
      units: 1,
      revisions: 1,
      segments: 1,
      jobs: 0,
    });

    const conflictProgram = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedConnection(), Schema.Boolean);
      const rows = buildCallSourceUnitRows(call, {
        organizationKey: "agency_acme",
        connectionGeneration: 2,
        receivedAt: now,
      });
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          yield* writer
            .table("sourceUnits")
            .insert(rows.unit)
            .pipe(Effect.orDie);
          yield* writer
            .table("sourceUnitRevisions")
            .insert({
              ...rows.revision,
              contentHash: `sha256:${"f".repeat(64)}`,
            })
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );
      return yield* confect
        .mutation(ingestRef, {
          input: call,
          authority,
          caller,
          receivedAt: now + 1,
        })
        .pipe(Effect.flip);
    });
    expect(
      await Effect.runPromise(
        conflictProgram.pipe(Effect.provide(testConfectLayer())),
      ),
    ).toBeInstanceOf(DuplicateKeyConflict);
  });

  it("writes tombstones and rejects revoked or cross-tenant authority", async () => {
    const tombstoneProgram = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedConnection(), Schema.Boolean);
      return yield* confect.mutation(ingestRef, {
        input: {
          ...call,
          externalRevisionId: "revision_deleted",
          revisionOrder: {
            kind: "provider_timestamp",
            timestamp: "2026-08-05T15:00:00.000Z",
            source: "_nango_metadata.deleted_at",
          },
          segments: [],
          deleted: true,
        },
        authority,
        caller,
        receivedAt: now,
      });
    });
    expect(
      await Effect.runPromise(
        tombstoneProgram.pipe(Effect.provide(testConfectLayer())),
      ),
    ).toMatchObject({ outcome: "tombstone", segmentCount: 0 });

    const denied = async (overrides: Readonly<Record<string, unknown>>) => {
      const program = Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        yield* confect.run(seedConnection(overrides), Schema.Boolean);
        return yield* confect
          .mutation(ingestRef, {
            input: call,
            authority,
            caller,
            receivedAt: now,
          })
          .pipe(Effect.flip);
      });
      return Effect.runPromise(
        program.pipe(Effect.provide(testConfectLayer())),
      );
    };

    expect(await denied({ status: "revoked" })).toBeInstanceOf(
      ConnectionRevoked,
    );
    expect(await denied({ organizationKey: "agency_other" })).toBeInstanceOf(
      TenantMismatch,
    );
  });

  it("keeps delayed revisions immutable without regressing current state", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedConnection(), Schema.Boolean);
      const first = yield* confect.mutation(ingestRef, {
        input: call,
        authority,
        caller,
        receivedAt: now,
      });
      const newest = yield* confect.mutation(ingestRef, {
        input: {
          ...call,
          externalRevisionId: "revision_3",
          revisionOrder: {
            ...call.revisionOrder,
            timestamp: "2026-08-05T16:00:00.000Z",
          },
          segments: [{ ...call.segments[0], text: "Newest transcript." }],
        },
        authority,
        caller,
        receivedAt: now + 1,
      });
      const delayed = yield* confect.mutation(ingestRef, {
        input: {
          ...call,
          externalRevisionId: "revision_2",
          revisionOrder: {
            ...call.revisionOrder,
            timestamp: "2026-08-05T15:00:00.000Z",
          },
          segments: [{ ...call.segments[0], text: "Delayed transcript." }],
        },
        authority,
        caller,
        receivedAt: now + 2,
      });
      const state = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const unit = yield* reader
            .table("sourceUnits")
            .index("by_unit_key", (query) =>
              query.eq("organizationKey", "agency_acme"),
            )
            .first()
            .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          const counts = yield* countRows;
          return {
            currentUnitRevisionKey: unit.currentUnitRevisionKey,
            currentRevisionOrder: unit.currentRevisionOrder ?? null,
            lifecycleState: unit.lifecycle.state,
            counts,
          };
        }),
        Schema.Struct({
          currentUnitRevisionKey: Schema.String,
          currentRevisionOrder: Schema.NullOr(CanonicalTranscriptRevisionOrder),
          lifecycleState: Schema.Literal(
            "active",
            "deleted_tombstone",
            "redacted",
            "purged",
          ),
          counts: Counts,
        }),
      );
      return { first, newest, delayed, state };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.first.outcome).toBe("inserted");
    expect(result.newest.outcome).toBe("inserted");
    expect(result.delayed.outcome).toBe("stale");
    expect(result.state).toMatchObject({
      currentUnitRevisionKey: result.newest.unitRevisionKey,
      currentRevisionOrder: {
        timestamp: "2026-08-05T16:00:00.000Z",
      },
      lifecycleState: "active",
      counts: { units: 1, revisions: 3, segments: 3, jobs: 2 },
    });
  });

  it("surfaces equal-order content changes as an explicit conflict", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedConnection(), Schema.Boolean);
      yield* confect.mutation(ingestRef, {
        input: call,
        authority,
        caller,
        receivedAt: now,
      });
      return yield* confect
        .mutation(ingestRef, {
          input: {
            ...call,
            externalRevisionId: "revision_same_order_changed_content",
            segments: [
              { ...call.segments[0], text: "Conflicting transcript." },
            ],
          },
          authority,
          caller,
          receivedAt: now + 1,
        })
        .pipe(Effect.flip);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result).toBeInstanceOf(RevisionOrderConflict);
    expect(result).toMatchObject({ reason: "equal_order" });
  });

  it("fences delayed live events after tombstones and permits newer recreation", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedConnection(), Schema.Boolean);
      yield* confect.mutation(ingestRef, {
        input: call,
        authority,
        caller,
        receivedAt: now,
      });
      const tombstone = yield* confect.mutation(ingestRef, {
        input: {
          ...call,
          externalRevisionId: "revision_deleted",
          revisionOrder: {
            kind: "provider_timestamp",
            timestamp: "2026-08-05T16:00:00.000Z",
            source: "_nango_metadata.deleted_at",
          },
          segments: [],
          deleted: true,
        },
        authority,
        caller,
        receivedAt: now + 1,
      });
      const delayed = yield* confect.mutation(ingestRef, {
        input: {
          ...call,
          externalRevisionId: "revision_2",
          revisionOrder: {
            ...call.revisionOrder,
            timestamp: "2026-08-05T15:00:00.000Z",
          },
        },
        authority,
        caller,
        receivedAt: now + 2,
      });
      const recreated = yield* confect.mutation(ingestRef, {
        input: {
          ...call,
          externalRevisionId: "revision_4",
          revisionOrder: {
            ...call.revisionOrder,
            timestamp: "2026-08-05T17:00:00.000Z",
          },
          segments: [{ ...call.segments[0], text: "Recreated transcript." }],
        },
        authority,
        caller,
        receivedAt: now + 3,
      });
      const state = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const unit = yield* reader
            .table("sourceUnits")
            .index("by_unit_key", (query) =>
              query.eq("organizationKey", "agency_acme"),
            )
            .first()
            .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          const fence = yield* reader
            .table("retrievalEligibilityFences")
            .index("by_organization_kind_controller", (query) =>
              query
                .eq("organizationKey", "agency_acme")
                .eq("kind", "lifecycle")
                .eq(
                  "controllerKey",
                  `transcript-unit:agency_acme:${unit.unitKey}`,
                ),
            )
            .first()
            .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          return {
            currentUnitRevisionKey: unit.currentUnitRevisionKey,
            lifecycleState: unit.lifecycle.state,
            eligibilityGeneration: fence.eligibilityGeneration,
            eligible: fence.eligible,
          };
        }),
        Schema.Struct({
          currentUnitRevisionKey: Schema.String,
          lifecycleState: Schema.String,
          eligibilityGeneration: Schema.Number,
          eligible: Schema.Boolean,
        }),
      );
      return { tombstone, delayed, recreated, state };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.tombstone.outcome).toBe("tombstone");
    expect(result.delayed.outcome).toBe("stale");
    expect(result.recreated.outcome).toBe("inserted");
    expect(result.state).toEqual({
      currentUnitRevisionKey: result.recreated.unitRevisionKey,
      lifecycleState: "active",
      eligibilityGeneration: 3,
      eligible: true,
    });
  });

  it("accepts pre-authorized manual imports only under the manual provider", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const accepted = yield* confect.mutation(ingestRef, {
        input: {
          ...call,
          providerKey: "manual-transcript",
          connectionKey: "manual_agency_acme",
          revisionOrder: { kind: "reconciliation_epoch", epoch: 1 },
        },
        authority: {
          kind: "manual_import",
          organizationKey: "agency_acme",
          actorId: "user_editor",
        },
        caller,
        receivedAt: now,
      });
      const wrongProvider = yield* confect
        .mutation(ingestRef, {
          input: call,
          authority: {
            kind: "manual_import",
            organizationKey: "agency_acme",
            actorId: "user_editor",
          },
          caller,
          receivedAt: now,
        })
        .pipe(Effect.flip);
      return { accepted, wrongProvider };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.accepted).toMatchObject({
      outcome: "inserted",
      segmentCount: 1,
    });
    expect(result.wrongProvider).toBeInstanceOf(TenantMismatch);
  });

  it("resumes and idempotently completes a frozen legacy order backfill", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const rows = buildCallSourceUnitRows(
        {
          ...call,
          providerKey: "manual-transcript",
          connectionKey: "manual_agency_acme",
          externalCallId: "manual-call-legacy",
          revisionOrder: { kind: "reconciliation_epoch", epoch: 1 },
        },
        {
          organizationKey: "agency_acme",
          connectionGeneration: 1,
          receivedAt: now,
        },
      );
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const {
            currentRevisionOrder: _currentRevisionOrder,
            currentRevisionOrderVersion: _currentRevisionOrderVersion,
            ...legacyUnit
          } = rows.unit;
          const {
            revisionOrder: _revisionOrder,
            revisionOrderVersion: _revisionOrderVersion,
            ...legacyRevision
          } = rows.revision;
          void _currentRevisionOrder;
          void _currentRevisionOrderVersion;
          void _revisionOrder;
          void _revisionOrderVersion;
          yield* writer
            .table("sourceUnits")
            .insert(legacyUnit)
            .pipe(Effect.orDie);
          yield* writer
            .table("sourceUnitRevisions")
            .insert(legacyRevision)
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );
      const args = {
        organizationKey: "agency_acme",
        adapterOrderVersion: TRANSCRIPT_ADAPTER_ORDER_VERSION,
        batchSize: 1,
      } as const;
      const started = yield* confect.mutation(
        backfillTranscriptRevisionOrderRef,
        args,
      );
      const restarted = yield* confect.mutation(
        backfillTranscriptRevisionOrderRef,
        args,
      );
      let progress = restarted;
      for (let attempt = 0; attempt < 10 && !progress.terminal; attempt += 1)
        progress = yield* confect.mutation(
          resumeTranscriptRevisionOrderBackfillRef,
          {
            runKey: progress.runKey,
            expectedRunGeneration: progress.runGeneration,
            batchSize: 1,
          },
        );
      const repeatedCompletion = yield* confect.mutation(
        backfillTranscriptRevisionOrderRef,
        args,
      );
      const state = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const unit = yield* reader
            .table("sourceUnits")
            .index("by_unit_key", (query) =>
              query
                .eq("organizationKey", "agency_acme")
                .eq("unitKey", rows.unit.unitKey),
            )
            .first()
            .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          const revision = yield* reader
            .table("sourceUnitRevisions")
            .index("by_unit_revision_key", (query) =>
              query
                .eq("organizationKey", "agency_acme")
                .eq("unitRevisionKey", rows.revision.unitRevisionKey),
            )
            .first()
            .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          const migration = yield* reader
            .table("transcriptRevisionOrderMigrations")
            .index("by_organization", (query) =>
              query.eq("organizationKey", "agency_acme"),
            )
            .first()
            .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          return { unit, revision, migration };
        }),
        Schema.Any,
      );
      return {
        started,
        restarted,
        progress,
        repeatedCompletion,
        state,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.restarted).toMatchObject({
      runKey: result.started.runKey,
      runGeneration: result.started.runGeneration,
    });
    expect(result.progress).toMatchObject({
      stage: "complete",
      processed: 1,
      backfilled: 1,
      excluded: 0,
      conflictCount: 0,
      terminal: true,
      readyForPromotion: true,
    });
    expect(result.repeatedCompletion).toMatchObject({
      runKey: result.progress.runKey,
      completionDigest: result.progress.completionDigest,
    });
    expect(result.state.unit).toMatchObject({
      currentRevisionOrder: { kind: "reconciliation_epoch", epoch: 1 },
      currentRevisionOrderVersion: TRANSCRIPT_ADAPTER_ORDER_VERSION,
    });
    expect(result.state.revision).toMatchObject({
      revisionOrder: { kind: "reconciliation_epoch", epoch: 1 },
      revisionOrderVersion: TRANSCRIPT_ADAPTER_ORDER_VERSION,
    });
    expect(result.state.migration.completion).toMatchObject({
      completionDigest: result.progress.completionDigest,
      conflictCount: 0,
    });
  });

  it("types equal-order, missing-version, and tombstone-recreation migration conflicts", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const equalFirst = buildCallSourceUnitRows(
            { ...call, externalCallId: "call_equal_order" },
            {
              organizationKey: "agency_acme",
              connectionGeneration: 2,
              receivedAt: now,
            },
          );
          const equalSecond = buildCallSourceUnitRows(
            {
              ...call,
              externalCallId: "call_equal_order",
              externalRevisionId: "revision_equal_changed",
              segments: [
                { ...call.segments[0], text: "Changed at equal order." },
              ],
            },
            {
              organizationKey: "agency_acme",
              connectionGeneration: 2,
              receivedAt: now + 1,
            },
          );
          const {
            currentRevisionOrderVersion: _equalUnitVersion,
            ...equalUnit
          } = equalFirst.unit;
          const {
            revisionOrderVersion: _equalFirstVersion,
            ...equalRevisionOne
          } = equalFirst.revision;
          const {
            revisionOrderVersion: _equalSecondVersion,
            ...equalRevisionTwo
          } = equalSecond.revision;
          void _equalUnitVersion;
          void _equalFirstVersion;
          void _equalSecondVersion;
          yield* writer
            .table("sourceUnits")
            .insert(equalUnit)
            .pipe(Effect.orDie);
          yield* writer
            .table("sourceUnitRevisions")
            .insert(equalRevisionOne)
            .pipe(Effect.orDie);
          yield* writer
            .table("sourceUnitRevisions")
            .insert(equalRevisionTwo)
            .pipe(Effect.orDie);

          const missing = buildCallSourceUnitRows(
            { ...call, externalCallId: "call_missing_version" },
            {
              organizationKey: "agency_acme",
              connectionGeneration: 2,
              receivedAt: now + 2,
            },
          );
          const {
            currentRevisionOrder: _missingUnitOrder,
            currentRevisionOrderVersion: _missingUnitVersion,
            ...missingUnit
          } = missing.unit;
          const {
            revisionOrder: _missingRevisionOrder,
            revisionOrderVersion: _missingRevisionVersion,
            ...missingRevision
          } = missing.revision;
          void _missingUnitOrder;
          void _missingUnitVersion;
          void _missingRevisionOrder;
          void _missingRevisionVersion;
          yield* writer
            .table("sourceUnits")
            .insert(missingUnit)
            .pipe(Effect.orDie);
          yield* writer
            .table("sourceUnitRevisions")
            .insert(missingRevision)
            .pipe(Effect.orDie);

          const live = buildCallSourceUnitRows(
            { ...call, externalCallId: "call_ambiguous_history" },
            {
              organizationKey: "agency_acme",
              connectionGeneration: 2,
              receivedAt: now + 3,
            },
          );
          const tombstone = buildCallSourceUnitRows(
            {
              ...call,
              externalCallId: "call_ambiguous_history",
              externalRevisionId: "revision_deleted_ambiguous",
              revisionOrder: {
                kind: "provider_timestamp",
                timestamp: "2026-08-05T15:00:00.000Z",
                source: "_nango_metadata.deleted_at",
              },
              segments: [],
              deleted: true,
            },
            {
              organizationKey: "agency_acme",
              connectionGeneration: 2,
              receivedAt: now + 4,
            },
          );
          const {
            currentRevisionOrder: _ambiguousUnitOrder,
            currentRevisionOrderVersion: _ambiguousUnitVersion,
            ...ambiguousUnit
          } = tombstone.unit;
          const {
            revisionOrder: _liveOrder,
            revisionOrderVersion: _liveVersion,
            ...ambiguousLiveRevision
          } = live.revision;
          const {
            revisionOrder: _tombstoneOrder,
            revisionOrderVersion: _tombstoneVersion,
            ...ambiguousTombstoneRevision
          } = tombstone.revision;
          void _ambiguousUnitOrder;
          void _ambiguousUnitVersion;
          void _liveOrder;
          void _liveVersion;
          void _tombstoneOrder;
          void _tombstoneVersion;
          yield* writer
            .table("sourceUnits")
            .insert(ambiguousUnit)
            .pipe(Effect.orDie);
          yield* writer
            .table("sourceUnitRevisions")
            .insert(ambiguousLiveRevision)
            .pipe(Effect.orDie);
          yield* writer
            .table("sourceUnitRevisions")
            .insert(ambiguousTombstoneRevision)
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );
      let progress = yield* confect.mutation(
        backfillTranscriptRevisionOrderRef,
        {
          organizationKey: "agency_acme",
          adapterOrderVersion: TRANSCRIPT_ADAPTER_ORDER_VERSION,
          batchSize: 1,
        },
      );
      for (let attempt = 0; attempt < 10 && !progress.terminal; attempt += 1)
        progress = yield* confect.mutation(
          resumeTranscriptRevisionOrderBackfillRef,
          {
            runKey: progress.runKey,
            expectedRunGeneration: progress.runGeneration,
            batchSize: 1,
          },
        );
      const state = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const items = yield* reader
            .table("transcriptRevisionOrderMigrationItems")
            .index("by_organization_run", (query) =>
              query
                .eq("organizationKey", "agency_acme")
                .eq("runKey", progress.runKey),
            )
            .take(10)
            .pipe(Effect.orDie);
          const migration = yield* reader
            .table("transcriptRevisionOrderMigrations")
            .index("by_organization", (query) =>
              query.eq("organizationKey", "agency_acme"),
            )
            .first()
            .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          return { items, migration };
        }),
        Schema.Any,
      );
      return { progress, state };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.progress).toMatchObject({
      stage: "blocked",
      processed: 3,
      conflictCount: 3,
      terminal: true,
      readyForPromotion: false,
      completionDigest: null,
    });
    expect(
      result.state.items.map(
        ({ conflictKind }: { conflictKind: string | null }) => conflictKind,
      ),
    ).toEqual(
      expect.arrayContaining([
        "equal_order_content",
        "missing_provider_version",
        "ambiguous_tombstone_recreation",
      ]),
    );
    expect(result.state.migration.completion).toBeNull();
  });

  it("blocks pointer-only equal-order history with different content", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const older = buildCallSourceUnitRows(
        { ...call, externalCallId: "call_pointer_only_equal_order" },
        {
          organizationKey: "agency_acme",
          connectionGeneration: 2,
          receivedAt: now,
        },
      );
      const current = buildCallSourceUnitRows(
        {
          ...call,
          externalCallId: "call_pointer_only_equal_order",
          externalRevisionId: "revision_pointer_only_current",
          segments: [
            { ...call.segments[0], text: "Changed at the pointer-only order." },
          ],
        },
        {
          organizationKey: "agency_acme",
          connectionGeneration: 2,
          receivedAt: now + 1,
        },
      );
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const {
            revisionOrder: _revisionOrder,
            revisionOrderVersion: _revisionOrderVersion,
            ...pointerOnlyCurrentRevision
          } = current.revision;
          void _revisionOrder;
          void _revisionOrderVersion;
          yield* writer
            .table("sourceUnits")
            .insert(current.unit)
            .pipe(Effect.orDie);
          yield* writer
            .table("sourceUnitRevisions")
            .insert(older.revision)
            .pipe(Effect.orDie);
          yield* writer
            .table("sourceUnitRevisions")
            .insert(pointerOnlyCurrentRevision)
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );
      let progress = yield* confect.mutation(
        backfillTranscriptRevisionOrderRef,
        {
          organizationKey: "agency_acme",
          adapterOrderVersion: TRANSCRIPT_ADAPTER_ORDER_VERSION,
          batchSize: 1,
        },
      );
      for (let attempt = 0; attempt < 10 && !progress.terminal; attempt += 1)
        progress = yield* confect.mutation(
          resumeTranscriptRevisionOrderBackfillRef,
          {
            runKey: progress.runKey,
            expectedRunGeneration: progress.runGeneration,
            batchSize: 1,
          },
        );
      return progress;
    });

    const progress = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(progress).toMatchObject({
      stage: "blocked",
      processed: 1,
      backfilled: 0,
      conflictCount: 1,
      blockingConflict: "equal_order_content",
      terminal: true,
      readyForPromotion: false,
      completionDigest: null,
    });
  });

  it("blocks promotion when a revision changes between scan and validation", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedConnection(), Schema.Boolean);
      yield* confect.mutation(ingestRef, {
        input: call,
        authority,
        caller,
        receivedAt: now,
      });
      let progress = yield* confect.mutation(
        backfillTranscriptRevisionOrderRef,
        {
          organizationKey: "agency_acme",
          adapterOrderVersion: TRANSCRIPT_ADAPTER_ORDER_VERSION,
          batchSize: 1,
        },
      );
      for (
        let attempt = 0;
        attempt < 5 && progress.stage === "scanning";
        attempt += 1
      )
        progress = yield* confect.mutation(
          resumeTranscriptRevisionOrderBackfillRef,
          {
            runKey: progress.runKey,
            expectedRunGeneration: progress.runGeneration,
            batchSize: 1,
          },
        );
      const changed = yield* confect.mutation(ingestRef, {
        input: {
          ...call,
          externalRevisionId: "revision_concurrent",
          revisionOrder: {
            ...call.revisionOrder,
            timestamp: "2026-08-05T17:00:00.000Z",
          },
          segments: [{ ...call.segments[0], text: "Concurrent observation." }],
        },
        authority,
        caller,
        receivedAt: now + 1,
      });
      const blocked = yield* confect.mutation(
        resumeTranscriptRevisionOrderBackfillRef,
        {
          runKey: progress.runKey,
          expectedRunGeneration: progress.runGeneration,
          batchSize: 1,
        },
      );
      return { progress, changed, blocked };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.progress.stage).toBe("validating");
    expect(result.changed.outcome).toBe("inserted");
    expect(result.blocked).toMatchObject({
      stage: "blocked",
      conflictCount: 1,
      blockingConflict: "concurrent_revision_change",
      readyForPromotion: false,
      completionDigest: null,
    });
  });
});
