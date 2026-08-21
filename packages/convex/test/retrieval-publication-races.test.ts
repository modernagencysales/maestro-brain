import { TestConfect } from "@confect/test";
import type { Value } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import {
  connectionFenceIdentity,
  transcriptRouteFenceIdentity,
  transcriptUnitLifecycleFenceIdentity,
  transitionEligibilityFenceEffect,
} from "../confect/brain/retrievalEligibility";
import { commitPreparedPublicationEffect } from "../confect/brain/retrievalPublication.impl";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";
const organizationKey = `ag_${brainKey.slice(3)}`;
const unitKey = "unit_race_1";
const connectionKey = "conn_race_1";

const resultSchema = <Result>(): Schema.Schema<Result, Value> =>
  Schema.Any as unknown as Schema.Schema<Result, Value>;

const seedWorkspace = Effect.gen(function* () {
  const writer = yield* DatabaseWriter;
  const userId = yield* writer
    .table("users")
    .insert({
      subject: "race-test",
      email: "race-test@example.com",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const organizationId = yield* writer
    .table("organizations")
    .insert({
      ownerUserId: userId,
      workosOrganizationId: "org_race_test",
      agencyKey: organizationKey,
      slug: "race-test",
      name: "Race Test",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  return yield* writer
    .table("workspaces")
    .insert({
      organizationId,
      ownerUserId: userId,
      brainKey,
      name: "Race Test Brain",
      slug: "race-test-brain",
      kind: "agency",
      status: "active",
      dataClassification: "internal",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
});

describe("retrieval publication authority races", () => {
  it("rejects a delayed G1 publication after lifecycle revoke and restore", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const workspaceId = yield* confect.run(seedWorkspace, resultSchema());
        const identities = [
          transcriptUnitLifecycleFenceIdentity({
            organizationKey,
            unitKey,
          }),
          transcriptRouteFenceIdentity({
            organizationKey,
            unitKey,
            brainKey,
          }),
          connectionFenceIdentity({ organizationKey, connectionKey }),
        ] as const;
        const generationOne = yield* confect.run(
          Effect.all(
            identities.map((identity) =>
              transitionEligibilityFenceEffect({
                identity,
                eligible: true,
                now,
              }),
            ),
          ),
          resultSchema(),
        );
        yield* confect.run(
          transitionEligibilityFenceEffect({
            identity: identities[0],
            eligible: false,
            now: now + 1,
          }),
          resultSchema(),
        );
        const restored = yield* confect.run(
          transitionEligibilityFenceEffect({
            identity: identities[0],
            eligible: true,
            now: now + 2,
          }),
          resultSchema(),
        );
        const delayed = yield* confect.run(
          commitPreparedPublicationEffect({
            organizationKey,
            workspaceId,
            brainKey,
            corpusKey: "transcripts",
            kind: "transcript",
            originTable: "sourceUnitRevisions",
            sourceKey: unitKey,
            sourceRevisionKey: "unit_revision_g1",
            connectionKey,
            authority: "advisory",
            authorityPolicyKey: "transcript-evidence",
            policyGeneration: 1,
            lifecycleGeneration: 1,
            routeGeneration: 1,
            eligibilityFences: generationOne.map(({ ref }) => ref),
            revoked: false,
            passages: [
              {
                origin: {
                  kind: "transcript",
                  unitKey,
                  unitRevisionKey: "unit_revision_g1",
                  segmentKey: "segment_1",
                },
                passageKey: `rpass_${"a".repeat(64)}`,
                startOffset: 0,
                endOffset: 21,
                title: "Delayed transcript",
                headingPath: null,
                text: "Delayed G1 evidence.",
                contentHash: `sha256:${"b".repeat(64)}`,
                observedAt: now,
              },
            ],
            now: now + 3,
          }).pipe(
            Effect.match({
              onFailure: (error) => ({
                outcome: "failed" as const,
                errorTag: error._tag,
              }),
              onSuccess: (value) => ({ outcome: "succeeded" as const, value }),
            }),
          ),
          resultSchema(),
        );
        const currentSets = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            return yield* reader
              .table("retrievalPublicationSets")
              .index("by_workspace_brain_state_publication_set", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("state", "current"),
              )
              .take(2)
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        return { delayed, restored, currentSets };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.restored).toMatchObject({
      eligible: true,
      ref: { kind: "lifecycle", eligibilityGeneration: 3 },
    });
    expect(result.delayed).toEqual({
      outcome: "failed",
      errorTag: "RetrievalPublicationConflict",
    });
    expect(result.currentSets).toEqual([]);
  });
});
