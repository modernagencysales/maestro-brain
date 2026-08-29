import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { testConfectLayer } from "./support/confect";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";

const now = 1_788_019_200_000;

describe("Brain extraction admission contract", () => {
  it("does not admit or queue evidence from a pending connector scope", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          yield* writer
            .table("providerConnections")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              status: "active",
              generation: 1,
              connectionRef: "apero-slack",
              evidenceScopeKey: "slack:apero-slack:channel:C1:lookback:30",
              pendingEvidenceScopeKey:
                "slack:apero-slack:channel:C2:lookback:30",
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("brainEvidenceSources")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              scopeKey: "slack:apero-slack:channel:C2:lookback:30",
              sourceKey: "pending-source",
              title: "Pending source",
              status: "active",
              generation: 1,
              currentRevisionKey: "revision-1",
              sourceModifiedAt: now,
              observedAt: now,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("brainRetrievalEntries")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              entryKey: "pending-source:revision:revision-1",
              sourceKey: "pending-source",
              revisionKey: "revision-1",
              title: "Pending source",
              markdown: "Pending replacement corpus should stay hidden.",
              contentHash: "pending-content-hash",
              projectionVersion: 2,
              sourceModifiedAt: now,
              observedAt: now,
              status: "current",
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
        }),
      );
      const admitted = yield* Effect.result(
        confect.mutation(
          refs.internal.capabilities.extractBrainKnowledgeCandidates
            .beginExtraction,
          {
            workspaceId: seeded.workspaceId,
            sourceKey: "pending-source",
            revisionKey: "revision-1",
            extractionWindowKey: "full:0:46",
            extractionPolicyVersion: "brain-extractor-v1",
            idempotencyKey: "pending-scope-admission",
            requireLiveGeneration: false,
            killSwitchEnabled: false,
            dailySpendLimitCents: 100,
            estimatedCostPerMillionTokensCents: 500,
          },
        ),
      );
      const queued = yield* actor.mutation(
        refs.public.capabilities.extractBrainKnowledgeCandidates
          .queueBrainKnowledgeExtraction,
        { workspaceId: seeded.workspaceId, limit: 10 },
      );
      return { admitted, queued };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.admitted._tag).toBe("Failure");
    expect(result.queued).toMatchObject({
      scheduledCount: 0,
      skippedCount: 1,
    });
  });

  it("admits a source from a connector scope containing 101 current items", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          for (let index = 0; index < 101; index += 1)
            yield* writer
              .table("brainEvidenceSources")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "brain_page",
                scopeKey: "brain-pages",
                sourceKey: `source-${index}`,
                title: `Source ${index}`,
                status: "active",
                generation: 1,
                currentRevisionKey: "revision-1",
                sourceModifiedAt: now,
                observedAt: now,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          yield* writer
            .table("brainRetrievalEntries")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "brain_page",
              entryKey: "source-0:revision:revision-1",
              sourceKey: "source-0",
              revisionKey: "revision-1",
              title: "Source 0",
              markdown: "The pilot costs $5,000 per month.",
              contentHash: "test-content-hash",
              projectionVersion: 2,
              sourceModifiedAt: now,
              observedAt: now,
              status: "current",
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
        }),
      );
      return yield* confect.mutation(
        refs.internal.capabilities.extractBrainKnowledgeCandidates
          .beginExtraction,
        {
          workspaceId: seeded.workspaceId,
          sourceKey: "source-0",
          revisionKey: "revision-1",
          extractionWindowKey: "full:0:34",
          extractionPolicyVersion: "brain-extractor-v1",
          idempotencyKey: "large-scope-admission",
          requireLiveGeneration: false,
          killSwitchEnabled: false,
          dailySpendLimitCents: 100,
          estimatedCostPerMillionTokensCents: 500,
        },
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.alreadyCompleted).toBe(false);
  });

  it("executes scheduled extraction with 1,000 active and 1,000 pending entries", async () => {
    const activeScope = "slack:apero-slack:channel:C1:lookback:30";
    const pendingScope = "slack:apero-slack:channel:C2:lookback:30";
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          yield* writer
            .table("providerConnections")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              status: "active",
              generation: 1,
              connectionRef: "apero-slack",
              evidenceScopeKey: activeScope,
              pendingEvidenceScopeKey: pendingScope,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("brainEvidenceSources")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              scopeKey: activeScope,
              sourceKey: "active-source-0",
              title: "Active source 0",
              status: "active",
              generation: 1,
              currentRevisionKey: "revision-1",
              sourceModifiedAt: now,
              observedAt: now,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          for (let index = 0; index < 1_000; index += 1) {
            for (const [scopeKey, prefix] of [
              [activeScope, "active"],
              [pendingScope, "pending"],
            ] as const)
              yield* writer
                .table("brainRetrievalEntries")
                .insert({
                  workspaceId: seeded.workspaceId,
                  provider: "slack",
                  scopeKey,
                  entryKey: `${prefix}-entry-${index}`,
                  sourceKey: `${prefix}-source-${index}`,
                  revisionKey: "revision-1",
                  title: `${prefix} source ${index}`,
                  markdown:
                    index === 0 && prefix === "active"
                      ? "The approved pilot costs $5,000 per month."
                      : `${prefix} corpus entry ${index}`,
                  contentHash: `${prefix}-hash-${index}`,
                  projectionVersion: 2,
                  sourceModifiedAt: now,
                  observedAt: now,
                  status: "current",
                  createdAt: now,
                  updatedAt: now,
                })
                .pipe(Effect.orDie);
          }
        }),
      );
      return yield* confect.action(
        refs.internal.capabilities.extractBrainKnowledgeCandidates
          .extractBrainKnowledgeCandidatesScheduled,
        {
          workspaceId: seeded.workspaceId,
          sourceKey: "active-source-0",
          revisionKey: "revision-1",
          extractionWindowKey: "full:0:47",
          extractionPolicyVersion: "brain-extractor-v1",
          idempotencyKey: "scheduled-capacity-execution",
        },
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result).toMatchObject({
      status: "completed",
      extractionPolicyVersion: "brain-extractor-v1",
    });
  }, 60_000);

  it("fails closed on the kill switch and spend cap without mutating projection state", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* actor.mutation(refs.public.brain.pages.createMarkdown, {
        workspaceId: seeded.workspaceId,
        slug: "admission",
        title: "Extraction admission",
        markdown: "The pilot costs $5,000 per month.",
      });
      const entry = yield* confect.run(
        Effect.gen(function* () {
          const entries = yield* (yield* DatabaseReader)
            .table("brainRetrievalEntries")
            .index("by_workspace_and_provider_and_status", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("provider", "brain_page")
                .eq("status", "current"),
            )
            .take(2)
            .pipe(Effect.orDie);
          const [value] = entries;
          if (value === undefined) return yield* Effect.die("missing entry");
          return {
            sourceKey: value.sourceKey,
            revisionKey: value.revisionKey,
            markdownLength: value.markdown.length,
          };
        }),
        Schema.Struct({
          sourceKey: Schema.String,
          revisionKey: Schema.String,
          markdownLength: Schema.Number,
        }),
      );
      const base = {
        workspaceId: seeded.workspaceId,
        sourceKey: entry.sourceKey,
        revisionKey: entry.revisionKey,
        extractionWindowKey: `full:0:${entry.markdownLength}`,
        extractionPolicyVersion: "brain-extractor-v1",
        requireLiveGeneration: false,
        estimatedCostPerMillionTokensCents: 500,
      };
      const killed = yield* Effect.result(
        confect.mutation(
          refs.internal.capabilities.extractBrainKnowledgeCandidates
            .beginExtraction,
          {
            ...base,
            idempotencyKey: "admission:kill-switch",
            killSwitchEnabled: true,
            dailySpendLimitCents: 100,
          },
        ),
      );
      const capped = yield* Effect.result(
        confect.mutation(
          refs.internal.capabilities.extractBrainKnowledgeCandidates
            .beginExtraction,
          {
            ...base,
            idempotencyKey: "admission:spend-cap",
            killSwitchEnabled: false,
            dailySpendLimitCents: 0,
          },
        ),
      );
      const admitted = yield* confect.mutation(
        refs.internal.capabilities.extractBrainKnowledgeCandidates
          .beginExtraction,
        {
          ...base,
          idempotencyKey: "admission:first-paid-attempt",
          killSwitchEnabled: false,
          dailySpendLimitCents: 1,
        },
      );
      yield* confect.mutation(
        refs.internal.capabilities.extractBrainKnowledgeCandidates
          .failExtraction,
        {
          workspaceId: seeded.workspaceId,
          sourceKey: entry.sourceKey,
          revisionKey: entry.revisionKey,
          extractionPolicyVersion: "brain-extractor-v1",
          idempotencyKey: "admission:first-paid-attempt",
          failureCode: "provider_failed",
          failedAt: now,
        },
      );
      const cumulativeCap = yield* Effect.result(
        confect.mutation(
          refs.internal.capabilities.extractBrainKnowledgeCandidates
            .beginExtraction,
          {
            ...base,
            idempotencyKey: "admission:second-paid-attempt",
            killSwitchEnabled: false,
            dailySpendLimitCents: 1,
          },
        ),
      );
      const state = yield* confect.run(
        Effect.gen(function* () {
          const rows = yield* (yield* DatabaseReader)
            .table("brainRetrievalEntries")
            .index("by_workspace_and_source_key_and_status", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("sourceKey", entry.sourceKey)
                .eq("status", "current"),
            )
            .take(2)
            .pipe(Effect.orDie);
          const usage = yield* (yield* DatabaseReader)
            .table("brainExtractionUsage")
            .index("by_workspace_and_usage_day", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("usageDay", Date.UTC(2026, 7, 29)),
            )
            .take(2)
            .pipe(Effect.orDie);
          return JSON.stringify({
            status: rows[0]?.semanticStatus ?? "unset",
            consumedSpend: rows[0]?.semanticDailyConsumedSpendCents ?? 0,
            reservedSpend: rows[0]?.semanticDailyReservedSpendCents ?? 0,
            ledgerConsumedSpend: usage[0]?.consumedSpendCents ?? 0,
            ledgerReservedSpend: usage[0]?.reservedSpendCents ?? 0,
          });
        }),
        Schema.String,
      );
      return { killed, capped, admitted, cumulativeCap, state };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.killed._tag).toBe("Failure");
    expect(result.capped._tag).toBe("Failure");
    expect(result.admitted.alreadyCompleted).toBe(false);
    expect(result.cumulativeCap._tag).toBe("Failure");
    expect(JSON.parse(result.state)).toEqual({
      status: "failed",
      consumedSpend: 1,
      reservedSpend: 0,
      ledgerConsumedSpend: 1,
      ledgerReservedSpend: 0,
    });
  });

  it("opens the exact scope circuit when grounding failures occur beyond the former sample", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          for (let index = 0; index < 60; index += 1) {
            yield* writer
              .table("brainEvidenceSources")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "brain_page",
                scopeKey: "brain-pages",
                sourceKey: `circuit-source-${index}`,
                title: `Circuit source ${index}`,
                status: "active",
                generation: 1,
                currentRevisionKey: "revision-1",
                sourceModifiedAt: now,
                observedAt: now,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }
          yield* writer
            .table("brainRetrievalEntries")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "brain_page",
              scopeKey: "brain-pages",
              entryKey: "circuit-source-0:revision-1",
              sourceKey: "circuit-source-0",
              revisionKey: "revision-1",
              title: "Circuit source 0",
              markdown: "The approved pilot costs $5,000 per month.",
              contentHash: "circuit-content-hash",
              projectionVersion: 2,
              sourceModifiedAt: now,
              observedAt: now,
              status: "current",
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("brainExtractionScopeStats")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "brain_page",
              scopeKey: "brain-pages",
              extractionPolicyVersion: "brain-extractor-v1",
              proposedCount: 10,
              groundingFailureCount: 4,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
        }),
      );
      return yield* Effect.result(
        confect.mutation(
          refs.internal.capabilities.extractBrainKnowledgeCandidates
            .beginExtraction,
          {
            workspaceId: seeded.workspaceId,
            sourceKey: "circuit-source-0",
            revisionKey: "revision-1",
            extractionWindowKey: "full:0:47",
            extractionPolicyVersion: "brain-extractor-v1",
            idempotencyKey: "exact-scope-circuit",
            requireLiveGeneration: false,
            killSwitchEnabled: false,
            dailySpendLimitCents: 100,
            estimatedCostPerMillionTokensCents: 500,
          },
        ),
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result._tag).toBe("Failure");
  });

  it("queues completed entries from missing, older, and newer extraction policies", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const policies: Array<string | undefined> = [
            ...Array.from({ length: 25 }, () => "brain-extractor-v1"),
            undefined,
            "brain-extractor-v0",
            "brain-extractor-v2",
          ];
          for (const [index, policy] of policies.entries()) {
            const sourceKey = `policy-source-${index}`;
            yield* writer
              .table("brainEvidenceSources")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "brain_page",
                scopeKey: "brain-pages",
                sourceKey,
                title: `Policy source ${index}`,
                status: "active",
                generation: 1,
                currentRevisionKey: "revision-1",
                sourceModifiedAt: now + index,
                observedAt: now,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("brainRetrievalEntries")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "brain_page",
                scopeKey: "brain-pages",
                entryKey: `${sourceKey}:revision-1`,
                sourceKey,
                revisionKey: "revision-1",
                title: `Policy source ${index}`,
                markdown: `Approved policy source ${index}.`,
                contentHash: `policy-content-hash-${index}`,
                projectionVersion: 2,
                sourceModifiedAt: now + index,
                observedAt: now,
                status: "current",
                semanticStatus: "completed",
                ...(policy === undefined
                  ? {}
                  : { semanticPolicyVersion: policy }),
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }
        }),
      );
      return yield* actor.mutation(
        refs.public.capabilities.extractBrainKnowledgeCandidates
          .queueBrainKnowledgeExtraction,
        { workspaceId: seeded.workspaceId, limit: 3 },
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result).toMatchObject({
      scheduledCount: 3,
      extractionPolicyVersion: "brain-extractor-v2",
    });
  });

  it("requeues expired running leases while leaving active leases alone", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          for (const [sourceKey, startedAt] of [
            ["active-lease", Number.MAX_SAFE_INTEGER],
            ["expired-lease", 0],
          ] as const) {
            yield* writer
              .table("brainEvidenceSources")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "brain_page",
                scopeKey: "brain-pages",
                sourceKey,
                title: sourceKey,
                status: "active",
                generation: 1,
                currentRevisionKey: "revision-1",
                sourceModifiedAt: now,
                observedAt: now,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("brainRetrievalEntries")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "brain_page",
                scopeKey: "brain-pages",
                entryKey: `${sourceKey}:revision-1`,
                sourceKey,
                revisionKey: "revision-1",
                title: sourceKey,
                markdown: `${sourceKey} knowledge.`,
                contentHash: `${sourceKey}-hash`,
                projectionVersion: 2,
                sourceModifiedAt: now,
                observedAt: now,
                status: "current",
                semanticStatus: "running",
                semanticPolicyVersion: "brain-extractor-v1",
                semanticStartedAt: startedAt,
                semanticRunKey: `${sourceKey}-run`,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }
        }),
      );
      return yield* actor.mutation(
        refs.public.capabilities.extractBrainKnowledgeCandidates
          .queueBrainKnowledgeExtraction,
        { workspaceId: seeded.workspaceId, limit: 2 },
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.scheduledCount).toBe(1);
  });
});
