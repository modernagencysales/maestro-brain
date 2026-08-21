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
  RevisionOrderConflict,
  TenantMismatch,
} from "../confect/capabilities/ingestSourceUnit.spec";
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
            ...call.revisionOrder,
            timestamp: "2026-08-05T16:00:00.000Z",
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
          return {
            currentUnitRevisionKey: unit.currentUnitRevisionKey,
            lifecycleState: unit.lifecycle.state,
          };
        }),
        Schema.Struct({
          currentUnitRevisionKey: Schema.String,
          lifecycleState: Schema.String,
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
});
