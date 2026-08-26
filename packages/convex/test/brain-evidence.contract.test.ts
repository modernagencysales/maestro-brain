import { TestConfect } from "@confect/test";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
} from "../confect/_generated/services";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

const evidence = (
  workspaceId: GenericId<"workspaces">,
  runKey: string,
  sourceKey: string,
  revisionKey: string,
  markdown: string,
) => ({
  workspaceId,
  provider: "slack" as const,
  scopeKey: "slack:apero",
  runKey,
  sourceKey,
  revisionKey,
  title: `Slack evidence ${sourceKey}`,
  markdown,
  locator: `slack://apero/${sourceKey}`,
  sourceModifiedAt: now,
  observedAt: now,
});

const seedSlackConnection = (
  workspaceId: GenericId<"workspaces">,
  createdAt: number,
) =>
  Effect.gen(function* () {
    yield* (yield* DatabaseWriter)
      .table("providerConnections")
      .insert({
        workspaceId,
        provider: "slack",
        status: "active",
        generation: 1,
        connectionRef: "apero-slack",
        createdAt,
        updatedAt: createdAt,
      })
      .pipe(Effect.orDie);
  });

describe("Company Brain evidence publication", () => {
  it("keeps immutable revisions and rejects changed content under one revision key", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(seedSlackConnection(seeded.workspaceId, now));
      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero",
        runKey: "run-immutable",
        startedAt: now,
      });
      const first = yield* confect.mutation(
        refs.internal.brain.evidence.publishRunItem,
        evidence(
          seeded.workspaceId,
          "run-immutable",
          "message-1",
          "revision-1",
          "Original immutable content",
        ),
      );
      const duplicate = yield* confect.mutation(
        refs.internal.brain.evidence.publishRunItem,
        evidence(
          seeded.workspaceId,
          "run-immutable",
          "message-1",
          "revision-1",
          "Original immutable content",
        ),
      );
      const conflict = yield* confect
        .mutation(
          refs.internal.brain.evidence.publishRunItem,
          evidence(
            seeded.workspaceId,
            "run-immutable",
            "message-1",
            "revision-1",
            "Mutated content under the same revision",
          ),
        )
        .pipe(Effect.flip);
      return { first, duplicate, conflict };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.first.changed).toBe(true);
    expect(result.duplicate.changed).toBe(false);
    expect(result.conflict._tag).toBe("ValidationFailed");
  });

  it("reconciles removals only after a successful full traversal and reopens exact revisions", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(seedSlackConnection(seeded.workspaceId, now));
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });

      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero",
        runKey: "run-complete-1",
        startedAt: now,
      });
      for (const [sourceKey, markdown] of [
        ["message-a", "Apero pricing evidence alpha"],
        ["message-b", "Apero pricing evidence beta"],
      ] as const)
        yield* confect.mutation(
          refs.internal.brain.evidence.publishRunItem,
          evidence(
            seeded.workspaceId,
            "run-complete-1",
            sourceKey,
            "revision-1",
            markdown,
          ),
        );
      yield* confect.mutation(refs.internal.brain.evidence.completeRun, {
        workspaceId: seeded.workspaceId,
        runKey: "run-complete-1",
        discoveredCount: 2,
        completedAt: now + 1,
      });

      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero",
        runKey: "run-failed",
        startedAt: now + 2,
      });
      yield* confect.mutation(refs.internal.brain.evidence.publishRunItem, {
        ...evidence(
          seeded.workspaceId,
          "run-failed",
          "message-a",
          "revision-2",
          "Apero pricing evidence alpha updated",
        ),
        observedAt: now + 2,
      });
      yield* confect.mutation(refs.internal.brain.evidence.failRun, {
        workspaceId: seeded.workspaceId,
        runKey: "run-failed",
        failureCode: "provider_timeout",
        failedAt: now + 3,
      });
      const afterFailure = yield* actor.query(
        refs.public.brain.evidence.search,
        {
          workspaceId: seeded.workspaceId,
          query: "beta",
          asOf: now + 3,
          limit: 10,
        },
      );

      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero",
        runKey: "run-complete-2",
        startedAt: now + 4,
      });
      yield* confect.mutation(refs.internal.brain.evidence.publishRunItem, {
        ...evidence(
          seeded.workspaceId,
          "run-complete-2",
          "message-a",
          "revision-2",
          "Apero pricing evidence alpha updated",
        ),
        observedAt: now + 4,
      });
      const completion = yield* confect.mutation(
        refs.internal.brain.evidence.completeRun,
        {
          workspaceId: seeded.workspaceId,
          runKey: "run-complete-2",
          discoveredCount: 1,
          completedAt: now + 5,
        },
      );
      const afterSuccess = yield* actor.query(
        refs.public.brain.evidence.search,
        {
          workspaceId: seeded.workspaceId,
          query: "beta",
          asOf: now + 5,
          limit: 10,
        },
      );
      const reopened = yield* actor.query(
        refs.public.brain.evidence.sourceGet,
        {
          workspaceId: seeded.workspaceId,
          sourceKey: "message-b",
          revisionKey: "revision-1",
        },
      );
      const health = yield* actor.query(refs.public.brain.evidence.health, {
        workspaceId: seeded.workspaceId,
      });
      yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const writer = yield* DatabaseWriter;
          const connection = yield* reader
            .table("providerConnections")
            .index("by_workspace_and_provider", (q) =>
              q.eq("workspaceId", seeded.workspaceId).eq("provider", "slack"),
            )
            .first()
            .pipe(Effect.map(Option.getOrNull), Effect.orDie);
          if (connection !== null)
            yield* writer
              .table("providerConnections")
              .patch(connection._id, {
                status: "revoked",
                updatedAt: now + 6,
              })
              .pipe(Effect.orDie);
        }),
      );
      const afterRevoke = yield* actor.query(
        refs.public.brain.evidence.search,
        {
          workspaceId: seeded.workspaceId,
          query: "alpha",
          asOf: now + 6,
          limit: 10,
        },
      );
      return {
        afterFailure,
        completion,
        afterSuccess,
        reopened,
        health,
        afterRevoke,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.afterFailure).toEqual([
      expect.objectContaining({ sourceKey: "message-b" }),
    ]);
    expect(result.completion.retiredCount).toBe(1);
    expect(result.afterSuccess).toEqual([]);
    expect(result.reopened).toMatchObject({
      sourceKey: "message-b",
      revisionKey: "revision-1",
      markdown: "Apero pricing evidence beta",
      tombstone: false,
    });
    expect(result.afterRevoke).toEqual([]);
    expect(result.health.countLimit).toBe(1_000);
    expect(result.health.providers).toContainEqual(
      expect.objectContaining({
        provider: "slack",
        activeSourceCount: 1,
        removedSourceCount: 1,
        currentEntryCount: 1,
        capacityState: "within-bounds",
        coverageState: "current-index-covers-active-sources",
        lastConnectorRun: expect.objectContaining({
          runKey: "run-complete-2",
          status: "complete",
          completedAt: now + 5,
        }),
      }),
    );
  });
});
