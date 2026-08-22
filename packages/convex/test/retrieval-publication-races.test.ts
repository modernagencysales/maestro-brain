import { TestConfect } from "@confect/test";
import type { GenericId, Value } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import {
  connectionFenceIdentity,
  pageLifecycleFenceIdentity,
  transcriptRouteFenceIdentity,
  transcriptUnitLifecycleFenceIdentity,
  transitionEligibilityFenceEffect,
} from "../confect/brain/retrievalEligibility";
import {
  commitPreparedPublicationEffect,
  enqueueRetrievalPublicationJobEffect,
  runPublicationJobEffect,
} from "../confect/brain/retrievalPublication.impl";
import { retrievalPublicationSubjectKey } from "../confect/brain/retrievalPublication";
import { retrievalPublicationSubjectIncarnationKey } from "../confect/brain/retrievalPublicationJob";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";
const organizationKey = `ag_${brainKey.slice(3)}`;
const unitKey = "unit_race_1";
const connectionKey = "conn_race_1";
const pageKey = "pag_authority_race_1";
const revisionKey = "rev_authority_race_1";

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
  const workspaceId = yield* writer
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
  return { organizationId, workspaceId };
});

const seedPage = Effect.gen(function* () {
  const writer = yield* DatabaseWriter;
  const { organizationId, workspaceId } = yield* seedWorkspace;
  const lifecycle = {
    state: "active" as const,
    generation: 1,
    updatedAt: now,
    purgeAfter: null,
  };
  yield* writer
    .table("brainPages")
    .insert({
      workspaceId,
      organizationId,
      slug: "authority-race",
      title: "Authority Race",
      markdown: "# Authority\n\nOnly current authority may publish.",
      sourceKind: "markdown",
      updatedAt: now,
      pageKey,
      parentPageKey: null,
      siblingSlug: "authority-race",
      sortKey: "0000000001",
      favorite: false,
      status: "active",
      currentRevisionKey: revisionKey,
      lifecycle,
      createdAt: now,
      schemaVersion: 1,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("pageRevisions")
    .insert({
      workspaceId,
      organizationId,
      pageKey,
      revisionKey,
      priorRevisionKey: null,
      blockNoteJson: "",
      markdown: "# Authority\n\nOnly current authority may publish.",
      contentHash: "authority-race-hash",
      causation: "import",
      actor: { kind: "migration", id: "authority-race-test" },
      modelReceiptKey: null,
      effectKey: "authority-race:1",
      state: "published",
      lifecycle,
      createdAt: now,
      schemaVersion: 1,
    })
    .pipe(Effect.orDie);
  return { organizationId, workspaceId };
});

const pageJobInput = (workspaceId: GenericId<"workspaces">) => ({
  organizationKey,
  workspaceId,
  brainKey,
  originKind: "page" as const,
  sourceKey: pageKey,
  sourceRevisionKey: revisionKey,
  requestGeneration: 1,
  page: {
    authority: "derived" as const,
    authorityPolicyKey: "company-pages",
    policyGeneration: 1,
  },
});

const systemCaller = {
  kind: "system" as const,
  name: "publication-authority-race-test",
  surface: "internal" as const,
};

const currentPageSets = (workspaceId: GenericId<"workspaces">) =>
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
  });

describe("retrieval publication authority races", () => {
  it("rejects a delayed G1 publication after lifecycle revoke and restore", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedWorkspace,
          resultSchema(),
        );
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

  it("supersedes a delayed page publish after lifecycle revoke and restore", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
        const jobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(pageJobInput(workspaceId), now),
          resultSchema(),
        );
        const lifecycleIdentity = pageLifecycleFenceIdentity({
          organizationKey,
          workspaceId: String(workspaceId),
          pageKey,
        });
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const page = yield* reader
              .table("brainPages")
              .index("by_workspace_page_key", (query) =>
                query.eq("workspaceId", workspaceId).eq("pageKey", pageKey),
              )
              .first()
              .pipe(Effect.orDie);
            if (page._tag === "None") throw new Error("missing page");
            yield* writer
              .table("brainPages")
              .patch(page.value._id, {
                status: "archived",
                lifecycle: {
                  state: "archived",
                  generation: 2,
                  updatedAt: now + 1,
                  purgeAfter: null,
                },
                updatedAt: now + 1,
              })
              .pipe(Effect.orDie);
            yield* transitionEligibilityFenceEffect({
              identity: lifecycleIdentity,
              eligible: false,
              now: now + 1,
            });
          }),
          resultSchema(),
        );
        const restored = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const page = yield* reader
              .table("brainPages")
              .index("by_workspace_page_key", (query) =>
                query.eq("workspaceId", workspaceId).eq("pageKey", pageKey),
              )
              .first()
              .pipe(Effect.orDie);
            if (page._tag === "None") throw new Error("missing page");
            yield* writer
              .table("brainPages")
              .patch(page.value._id, {
                status: "active",
                lifecycle: {
                  state: "active",
                  generation: 3,
                  updatedAt: now + 2,
                  purgeAfter: null,
                },
                updatedAt: now + 2,
              })
              .pipe(Effect.orDie);
            return yield* transitionEligibilityFenceEffect({
              identity: lifecycleIdentity,
              eligible: true,
              now: now + 2,
            });
          }),
          resultSchema(),
        );
        const delayed = yield* confect.run(
          runPublicationJobEffect({
            jobKey,
            caller: systemCaller,
            now: now + 3,
          }),
          resultSchema(),
        );
        const currentSets = yield* confect.run(
          currentPageSets(workspaceId),
          resultSchema(),
        );
        return { restored, delayed, currentSets };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.restored).toMatchObject({
      eligible: true,
      ref: { kind: "lifecycle", eligibilityGeneration: 3 },
    });
    expect(result.delayed).toMatchObject({
      status: "superseded",
      attemptCount: 0,
      lastErrorTag: "PublicationAuthoritySuperseded",
    });
    expect(result.currentSets).toEqual([]);
  });

  it("does not execute a legacy job whose authority envelope is missing", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
        const jobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(pageJobInput(workspaceId), now),
          resultSchema(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const job = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_job_key", (query) => query.eq("jobKey", jobKey))
              .first()
              .pipe(Effect.orDie);
            if (job._tag === "None") throw new Error("missing job");
            yield* writer
              .table("retrievalPublicationJobs")
              .patch(job.value._id, { authorityEnvelope: undefined })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const attempted = yield* confect.run(
          runPublicationJobEffect({ jobKey, caller: systemCaller, now }),
          resultSchema(),
        );
        const currentSets = yield* confect.run(
          currentPageSets(workspaceId),
          resultSchema(),
        );
        return { attempted, currentSets };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.attempted).toMatchObject({
      status: "retry_wait",
      attemptCount: 0,
      lastErrorTag: "PublicationAuthorityEnvelopeMissing",
    });
    expect(result.currentSets).toEqual([]);
  });

  it("rejects a persisted authority envelope whose digest no longer matches", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
        const jobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(pageJobInput(workspaceId), now),
          resultSchema(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const job = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_job_key", (query) => query.eq("jobKey", jobKey))
              .first()
              .pipe(Effect.orDie);
            const envelope =
              job._tag === "None" ? undefined : job.value.authorityEnvelope;
            if (job._tag === "None" || envelope === undefined)
              throw new Error("missing authority envelope");
            yield* writer
              .table("retrievalPublicationJobs")
              .patch(job.value._id, {
                authorityEnvelope: {
                  ...envelope,
                  configuration: {
                    ...envelope.configuration,
                    policyGeneration: 99,
                  },
                },
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const attempted = yield* confect.run(
          runPublicationJobEffect({ jobKey, caller: systemCaller, now }),
          resultSchema(),
        );
        const currentSets = yield* confect.run(
          currentPageSets(workspaceId),
          resultSchema(),
        );
        return { attempted, currentSets };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.attempted).toMatchObject({
      status: "superseded",
      attemptCount: 0,
      lastErrorTag: "PublicationAuthorityEnvelopeInvalid",
    });
    expect(result.currentSets).toEqual([]);
  });

  it("rejects a self-consistent direct page envelope with forbidden target linkage", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
        const baseInput = pageJobInput(workspaceId);
        const lifecycleIdentity = pageLifecycleFenceIdentity({
          organizationKey,
          workspaceId: String(workspaceId),
          pageKey,
        });
        const lifecycleFence = yield* confect.run(
          transitionEligibilityFenceEffect({
            identity: lifecycleIdentity,
            eligible: true,
            now,
          }),
          resultSchema(),
        );
        const publicationSubjectKey = retrievalPublicationSubjectKey({
          workspaceId: String(workspaceId),
          brainKey,
          corpusKey: "brain-pages",
          originTable: "pageRevisions",
          kind: "page",
          sourceKey: pageKey,
        });
        const authorityContext = {
          version: 1 as const,
          publicationSubjectKey,
          subjectIncarnationKey: retrievalPublicationSubjectIncarnationKey({
            publicationSubjectKey,
            lifecycleFenceKey: lifecycleFence.ref.fenceKey,
            lifecycleGeneration: lifecycleFence.ref.eligibilityGeneration,
          }),
          configuration: {
            requestGeneration: 1,
            policyGeneration: 1,
            lifecycleGeneration: 1,
          },
          eligibilityFences: [
            {
              ...lifecycleFence.ref,
              eligible: lifecycleFence.eligible,
              controllerKey: lifecycleIdentity.controllerKey,
            },
          ],
          observationFence: {
            kind: "revision" as const,
            key: revisionKey,
            generation: 1,
          },
          targetResolutionIntentKey: "forged_page_target_intent",
        };
        const linkedJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            { ...baseInput, authorityContext },
            now + 1,
          ),
          resultSchema(),
        );
        const attempted = yield* confect.run(
          runPublicationJobEffect({
            jobKey: linkedJobKey,
            caller: systemCaller,
            now: now + 1,
          }),
          resultSchema(),
        );
        const currentSets = yield* confect.run(
          currentPageSets(workspaceId),
          resultSchema(),
        );
        return { attempted, currentSets };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.attempted).toMatchObject({
      status: "superseded",
      attemptCount: 0,
      lastErrorTag: "PublicationAuthorityLinkageInvalid",
    });
    expect(result.currentSets).toEqual([]);
  });
});
