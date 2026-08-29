import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader } from "../confect/_generated/services";
import { testConfectLayer } from "./support/confect";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";

const now = 1_788_019_200_000;

describe("Brain extraction admission contract", () => {
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
          return JSON.stringify({
            status: rows[0]?.semanticStatus ?? "unset",
            consumedSpend: rows[0]?.semanticDailyConsumedSpendCents ?? 0,
            reservedSpend: rows[0]?.semanticDailyReservedSpendCents ?? 0,
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
    });
  });
});
