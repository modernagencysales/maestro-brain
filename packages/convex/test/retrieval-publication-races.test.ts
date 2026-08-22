import { TestConfect } from "@confect/test";
import {
  DatabaseReader as DatabaseReaderService,
  DatabaseSchema,
  DatabaseWriter as DatabaseWriterService,
} from "@confect/server";
import type { GenericId, Value } from "convex/values";
import { defineSchema } from "convex/server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import generatedDatabaseSchema from "../confect/_generated/schema";
import {
  connectionFenceIdentity,
  pageLifecycleFenceIdentity,
  slackSourceLifecycleFenceIdentity,
  transcriptRouteFenceIdentity,
  transcriptUnitLifecycleFenceIdentity,
  transitionEligibilityFenceEffect,
} from "../confect/brain/retrievalEligibility";
import {
  commitPreparedPublicationEffect,
  enqueueRetrievalPublicationJobEffect,
  publishSlackRevisionEffect,
  publishTranscriptRevisionEffect,
  rebuildSlackBatchEffect,
  rebuildTranscriptBatchEffect,
  runPublicationJobEffect,
} from "../confect/brain/retrievalPublication.impl";
import { retrievalPublicationSubjectKey } from "../confect/brain/retrievalPublication";
import {
  activatePublicationJobLeaseEffect,
  claimPublicationJobLeaseEffect,
  publicationPauseKey,
} from "../confect/brain/publicationWorkerControl";
import { retrievalPublicationSubjectIncarnationKey } from "../confect/brain/retrievalPublicationJob";
import { purgePageOriginEffect } from "../confect/ops/dataLifecycle.impl";
import brainPublicationPausesSource from "../confect/tables/brainPublicationPauses";
import brainPublicationWorkerLeasesSource from "../confect/tables/brainPublicationWorkerLeases";

const now = 1_782_924_800_000;
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";
const organizationKey = `ag_${brainKey.slice(3)}`;
const unitKey = "unit_race_1";
const connectionKey = "conn_race_1";
const pageKey = "pag_authority_race_1";
const revisionKey = "rev_authority_race_1";
const successorRevisionKey = "rev_authority_race_2";
const slackSourceKey = "src_slack.convergence";
const slackRevisionOneKey = `srev_${"1".repeat(64)}`;
const slackRevisionTwoKey = `srev_${"2".repeat(64)}`;
const transcriptUnitKey = `sunit_${"3".repeat(64)}`;
const transcriptRevisionOneKey = `surev_${"4".repeat(64)}`;
const transcriptRevisionTwoKey = `surev_${"5".repeat(64)}`;

const brainPublicationPauses = brainPublicationPausesSource(
  "brainPublicationPauses",
);
const brainPublicationWorkerLeases = brainPublicationWorkerLeasesSource(
  "brainPublicationWorkerLeases",
);
const raceDatabaseSchema = DatabaseSchema.make({
  ...generatedDatabaseSchema.tables,
  brainPublicationPauses,
  brainPublicationWorkerLeases,
});
const raceConvexSchema = defineSchema({
  ...Object.fromEntries(
    Object.entries(generatedDatabaseSchema.tables).map(([name, table]) => [
      name,
      table.tableDefinition,
    ]),
  ),
  brainPublicationPauses: brainPublicationPauses.tableDefinition,
  brainPublicationWorkerLeases: brainPublicationWorkerLeases.tableDefinition,
});
const databaseSchema = raceDatabaseSchema;
const raceTestConfectLayer = TestConfect.layer(
  databaseSchema,
  raceConvexSchema,
  import.meta.glob("../convex/**/!(*.*.*)*.*s"),
);
const DatabaseReader =
  DatabaseReaderService.DatabaseReader<typeof raceDatabaseSchema>();
const DatabaseWriter =
  DatabaseWriterService.DatabaseWriter<typeof raceDatabaseSchema>();
const testConfectLayer = raceTestConfectLayer;

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

const seedSlackCorpus = Effect.gen(function* () {
  const writer = yield* DatabaseWriter;
  const { workspaceId } = yield* seedWorkspace;
  const lifecycle = {
    state: "active" as const,
    generation: 1,
    updatedAt: now,
    purgeAfter: null,
  };
  yield* writer
    .table("providerConnections")
    .insert({
      provider: "nango",
      providerConfigKey: "slack",
      organizationKey,
      connectionKey: "conn_slack_convergence",
      connectionGeneration: 1,
      status: "active",
      connectSessionId: "session_slack_convergence",
      nangoConnectionId: "nango_slack_convergence",
      nangoEndUserId: "user_slack_convergence",
      nangoOrganizationId: "org_slack_convergence",
      correlationTag: "slack:convergence",
      attemptId: "attempt_slack_convergence",
      attemptExpiresAt: now + 60_000,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("sourceArtifacts")
    .insert({
      schemaVersion: 1,
      organizationKey,
      connectionKey: "conn_slack_convergence",
      connectionGeneration: 1,
      channelKey: "channel_slack_convergence",
      externalChannelId: "C_SLACK_CONVERGENCE",
      providerObjectId: "C_SLACK_CONVERGENCE:1",
      sourceKey: slackSourceKey,
      threadKey: "thread_slack_convergence",
      latestSourceRevisionKey: slackRevisionOneKey,
      latestProviderOrder: "1",
      lifecycle,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("sourceRevisions")
    .insert({
      schemaVersion: 1,
      organizationKey,
      connectionKey: "conn_slack_convergence",
      connectionGeneration: 1,
      channelKey: "channel_slack_convergence",
      sourceKey: slackSourceKey,
      sourceRevisionKey: slackRevisionOneKey,
      observationKey: "observation_slack_convergence_1",
      providerOrder: "1",
      providerRevisionId: "1",
      sourceCreatedAt: now,
      sourceTimestamp: "2026-08-22T10:00:00.000Z",
      authorSnapshot: {
        providerUserId: "U_SLACK_CONVERGENCE",
        displayName: "Slack convergence",
      },
      normalizedText: "Slack convergence revision one.",
      blocksJson: "[]",
      permalink: "https://slack.example/C_SLACK_CONVERGENCE/p1",
      contentHash: `sha256:${"6".repeat(64)}`,
      tombstone: false,
      lifecycle,
      createdAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("channelRoutingPolicies")
    .insert({
      organizationKey,
      connectionKey: "conn_slack_convergence",
      connectionGeneration: 1,
      channelKey: "channel_slack_convergence",
      policyEpoch: 1,
      active: true,
      mode: "direct",
      targetBrainKeys: [brainKey],
      historicalBackfillStartAt: now - 1_000,
      statusAfterApply: "streaming",
      createdByRole: "owner",
      createdAt: now,
    })
    .pipe(Effect.orDie);
  return { workspaceId };
});

const advanceSlackCorpus = Effect.gen(function* () {
  const reader = yield* DatabaseReader;
  const writer = yield* DatabaseWriter;
  const artifact = yield* reader
    .table("sourceArtifacts")
    .index("by_org_source_key", (query) =>
      query
        .eq("organizationKey", organizationKey)
        .eq("sourceKey", slackSourceKey),
    )
    .first()
    .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
  yield* writer
    .table("sourceRevisions")
    .insert({
      schemaVersion: 1,
      organizationKey,
      connectionKey: artifact.connectionKey,
      connectionGeneration: artifact.connectionGeneration,
      channelKey: artifact.channelKey,
      sourceKey: slackSourceKey,
      sourceRevisionKey: slackRevisionTwoKey,
      observationKey: "observation_slack_convergence_2",
      providerOrder: "2",
      providerRevisionId: "2",
      sourceCreatedAt: now + 1,
      sourceTimestamp: "2026-08-22T10:01:00.000Z",
      authorSnapshot: {
        providerUserId: "U_SLACK_CONVERGENCE",
        displayName: "Slack convergence",
      },
      normalizedText: "Slack convergence revision two is authoritative.",
      blocksJson: "[]",
      permalink: "https://slack.example/C_SLACK_CONVERGENCE/p2",
      contentHash: `sha256:${"7".repeat(64)}`,
      tombstone: false,
      lifecycle: artifact.lifecycle,
      createdAt: now + 1,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("sourceArtifacts")
    .patch(artifact._id, {
      latestSourceRevisionKey: slackRevisionTwoKey,
      latestProviderOrder: "2",
      updatedAt: now + 1,
    })
    .pipe(Effect.orDie);
});

const transitionSlackLifecycle = (
  state: "active" | "deleted_tombstone",
  generation: number,
  at: number,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const artifact = yield* reader
      .table("sourceArtifacts")
      .index("by_org_source_key", (query) =>
        query
          .eq("organizationKey", organizationKey)
          .eq("sourceKey", slackSourceKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
    yield* writer
      .table("sourceArtifacts")
      .patch(artifact._id, {
        lifecycle: { state, generation, updatedAt: at, purgeAfter: null },
        updatedAt: at,
      })
      .pipe(Effect.orDie);
    return yield* transitionEligibilityFenceEffect({
      identity: slackSourceLifecycleFenceIdentity({
        organizationKey,
        sourceKey: slackSourceKey,
      }),
      eligible: state === "active",
      now: at,
    });
  });

const seedTranscriptCorpus = Effect.gen(function* () {
  const writer = yield* DatabaseWriter;
  const { workspaceId } = yield* seedWorkspace;
  const lifecycle = {
    state: "active" as const,
    generation: 1,
    updatedAt: now,
    purgeAfter: null,
  };
  yield* writer
    .table("providerConnections")
    .insert({
      provider: "nango",
      providerConfigKey: "fireflies",
      organizationKey,
      connectionKey: "conn_transcript_convergence",
      connectionGeneration: 1,
      status: "active",
      connectSessionId: "session_transcript_convergence",
      nangoConnectionId: "nango_transcript_convergence",
      nangoEndUserId: "user_transcript_convergence",
      nangoOrganizationId: "org_transcript_convergence",
      correlationTag: "transcript:convergence",
      attemptId: "attempt_transcript_convergence",
      attemptExpiresAt: now + 60_000,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("sourceUnits")
    .insert({
      schemaVersion: 1,
      organizationKey,
      connectionKey: "conn_transcript_convergence",
      connectionGeneration: 1,
      providerKey: "fireflies",
      externalCallId: "call_transcript_convergence",
      unitKey: transcriptUnitKey,
      currentUnitRevisionKey: transcriptRevisionOneKey,
      lifecycle,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("sourceUnitRevisions")
    .insert({
      schemaVersion: 1,
      organizationKey,
      unitKey: transcriptUnitKey,
      unitRevisionKey: transcriptRevisionOneKey,
      externalRevisionId: "call_transcript_convergence_1",
      title: "Transcript convergence one",
      startedAt: "2026-08-22T10:00:00.000Z",
      endedAt: "2026-08-22T10:30:00.000Z",
      durationMs: 1_800_000,
      organizer: null,
      participants: [],
      sourceUrl: "https://calls.example/transcript-convergence/1",
      recordingUrl: null,
      providerSummary: null,
      providerMetadataJson: "{}",
      contentHash: `sha256:${"8".repeat(64)}`,
      tombstone: false,
      createdAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("sourceSegments")
    .insert({
      schemaVersion: 1,
      organizationKey,
      unitKey: transcriptUnitKey,
      unitRevisionKey: transcriptRevisionOneKey,
      segmentKey: `seg_${"9".repeat(64)}`,
      externalSegmentId: "segment_transcript_convergence_1",
      ordinal: 0,
      evidenceKind: "verbatim_transcript",
      speakerExternalId: null,
      speakerLabel: "Founder",
      startMs: 0,
      endMs: 2_000,
      text: "Transcript convergence revision one.",
      contentHash: `sha256:${"a".repeat(64)}`,
      createdAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("callRoutingProposals")
    .insert({
      schemaVersion: 1,
      organizationKey,
      proposalKey: "callroute_transcript_convergence_1",
      unitKey: transcriptUnitKey,
      unitRevisionKey: transcriptRevisionOneKey,
      sourceLifecycleGeneration: 1,
      routeGeneration: 1,
      outcome: "routed",
      brainKey,
      candidateBrainKeys: [brainKey],
      reason: "explicit",
      status: "accepted",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  return { workspaceId };
});

const advanceTranscriptCorpus = Effect.gen(function* () {
  const reader = yield* DatabaseReader;
  const writer = yield* DatabaseWriter;
  const unit = yield* reader
    .table("sourceUnits")
    .index("by_unit_key", (query) =>
      query
        .eq("organizationKey", organizationKey)
        .eq("unitKey", transcriptUnitKey),
    )
    .first()
    .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
  yield* writer
    .table("sourceUnitRevisions")
    .insert({
      schemaVersion: 1,
      organizationKey,
      unitKey: transcriptUnitKey,
      unitRevisionKey: transcriptRevisionTwoKey,
      externalRevisionId: "call_transcript_convergence_2",
      title: "Transcript convergence two",
      startedAt: "2026-08-22T11:00:00.000Z",
      endedAt: "2026-08-22T11:30:00.000Z",
      durationMs: 1_800_000,
      organizer: null,
      participants: [],
      sourceUrl: "https://calls.example/transcript-convergence/2",
      recordingUrl: null,
      providerSummary: null,
      providerMetadataJson: "{}",
      contentHash: `sha256:${"b".repeat(64)}`,
      tombstone: false,
      createdAt: now + 1,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("sourceSegments")
    .insert({
      schemaVersion: 1,
      organizationKey,
      unitKey: transcriptUnitKey,
      unitRevisionKey: transcriptRevisionTwoKey,
      segmentKey: `seg_${"c".repeat(64)}`,
      externalSegmentId: "segment_transcript_convergence_2",
      ordinal: 0,
      evidenceKind: "verbatim_transcript",
      speakerExternalId: null,
      speakerLabel: "Founder",
      startMs: 0,
      endMs: 2_000,
      text: "Transcript convergence revision two is authoritative.",
      contentHash: `sha256:${"d".repeat(64)}`,
      createdAt: now + 1,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("callRoutingProposals")
    .insert({
      schemaVersion: 1,
      organizationKey,
      proposalKey: "callroute_transcript_convergence_2",
      unitKey: transcriptUnitKey,
      unitRevisionKey: transcriptRevisionTwoKey,
      sourceLifecycleGeneration: 1,
      routeGeneration: 2,
      outcome: "routed",
      brainKey,
      candidateBrainKeys: [brainKey],
      reason: "explicit",
      status: "accepted",
      createdAt: now + 1,
      updatedAt: now + 1,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("sourceUnits")
    .patch(unit._id, {
      currentUnitRevisionKey: transcriptRevisionTwoKey,
      updatedAt: now + 1,
    })
    .pipe(Effect.orDie);
});

const transitionTranscriptLifecycle = (
  state: "active" | "deleted_tombstone",
  generation: number,
  at: number,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const unit = yield* reader
      .table("sourceUnits")
      .index("by_unit_key", (query) =>
        query
          .eq("organizationKey", organizationKey)
          .eq("unitKey", transcriptUnitKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
    yield* writer
      .table("sourceUnits")
      .patch(unit._id, {
        lifecycle: { state, generation, updatedAt: at, purgeAfter: null },
        updatedAt: at,
      })
      .pipe(Effect.orDie);
    return yield* transitionEligibilityFenceEffect({
      identity: transcriptUnitLifecycleFenceIdentity({
        organizationKey,
        unitKey: transcriptUnitKey,
      }),
      eligible: state === "active",
      now: at,
    });
  });

const forcePublicationRetry = (jobKey: string, at: number) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const job = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_job_key", (query) => query.eq("jobKey", jobKey))
      .first()
      .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
    yield* writer
      .table("retrievalPublicationJobs")
      .patch(job._id, {
        status: "retry_wait",
        attemptCount: 1,
        nextAttemptAt: at,
        lastErrorTag: "InjectedDeliveryRetry",
        updatedAt: at,
      })
      .pipe(Effect.orDie);
  });

const corpusPublicationState = (
  workspaceId: GenericId<"workspaces">,
  corpusKey: "slack" | "transcripts",
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const [current, retired, subjects] = yield* Effect.all([
      reader
        .table("retrievalPublicationSets")
        .index("by_workspace_brain_state_publication_set", (query) =>
          query
            .eq("workspaceId", workspaceId)
            .eq("brainKey", brainKey)
            .eq("state", "current"),
        )
        .take(10)
        .pipe(Effect.orDie),
      reader
        .table("retrievalPublicationSets")
        .index("by_workspace_brain_state_publication_set", (query) =>
          query
            .eq("workspaceId", workspaceId)
            .eq("brainKey", brainKey)
            .eq("state", "retired"),
        )
        .take(10)
        .pipe(Effect.orDie),
      reader
        .table("retrievalPublicationSubjects")
        .index("by_workspace_brain_corpus_subject", (query) =>
          query
            .eq("workspaceId", workspaceId)
            .eq("brainKey", brainKey)
            .eq("corpusKey", corpusKey),
        )
        .take(10)
        .pipe(Effect.orDie),
    ]);
    return {
      current: current.filter((set) => set.corpusKey === corpusKey),
      retired: retired.filter((set) => set.corpusKey === corpusKey),
      subjects,
    };
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

const runPendingPageRebuildPhase = (
  workspaceId: GenericId<"workspaces">,
  phase: "scan" | "catch_up" | "set_difference" | "close",
  at: number,
  originKind:
    "page_rebuild" | "slack_rebuild" | "transcript_rebuild" = "page_rebuild",
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const pending = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_status_due_job", (query) => query.eq("status", "pending"))
      .take(100)
      .pipe(Effect.orDie);
    const matches = pending.filter(
      (job) =>
        job.workspaceId === workspaceId &&
        job.brainKey === brainKey &&
        job.originKind === originKind &&
        job.rebuild?.phase === phase,
    );
    if (matches.length !== 1)
      return yield* Effect.dieMessage(
        `Expected one pending ${phase} rebuild job, found ${matches.length}.`,
      );
    const [job] = matches;
    if (job === undefined)
      return yield* Effect.dieMessage(`Missing pending ${phase} rebuild job.`);
    return yield* runPublicationJobEffect({
      jobKey: job.jobKey,
      caller: systemCaller,
      now: at,
    });
  });

const assertDrainedManifestCorruptionBlocksClose = async (
  corruption: "extra_terminal" | "terminal_status",
) => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const { workspaceId } = yield* confect.run(seedPage, resultSchema());
      const rootJobKey = yield* confect.run(
        enqueueRetrievalPublicationJobEffect(
          {
            organizationKey,
            workspaceId,
            brainKey,
            originKind: "page_rebuild",
            sourceKey: "corpus:pages",
            sourceRevisionKey: `rebuild:manifest-${corruption}`,
            requestGeneration: 1,
            rebuild: { limit: 10 },
          },
          now,
        ),
        resultSchema(),
      );
      yield* confect.run(
        runPublicationJobEffect({
          jobKey: rootJobKey,
          caller: systemCaller,
          now,
        }),
        resultSchema(),
      );
      yield* confect.run(
        runPendingPageRebuildPhase(workspaceId, "catch_up", now + 1),
        resultSchema(),
      );
      yield* confect.run(
        runPendingPageRebuildPhase(workspaceId, "set_difference", now + 2),
        resultSchema(),
      );
      const child = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const pending = yield* reader
            .table("retrievalPublicationJobs")
            .index("by_status_due_job", (query) =>
              query.eq("status", "pending"),
            )
            .take(100)
            .pipe(Effect.orDie);
          const children = pending.filter(
            (job) =>
              job.workspaceId === workspaceId &&
              job.brainKey === brainKey &&
              job.originKind === "page" &&
              job.parentRebuildJobKey !== undefined,
          );
          const [pendingChild] = children;
          if (children.length !== 1 || pendingChild === undefined)
            return yield* Effect.dieMessage(
              `Expected one rebuild child, found ${children.length}.`,
            );
          return yield* runPublicationJobEffect({
            jobKey: pendingChild.jobKey,
            caller: systemCaller,
            now: now + 3,
          });
        }),
        resultSchema(),
      );
      yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const writer = yield* DatabaseWriter;
          const runs = yield* reader
            .table("retrievalRebuildRuns")
            .index("by_workspace_brain_status", (query) =>
              query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
            )
            .take(2)
            .pipe(Effect.orDie);
          const [run] = runs;
          if (run === undefined)
            return yield* Effect.dieMessage("Missing rebuild run.");
          const manifests = yield* reader
            .table("retrievalRebuildChildren")
            .index("by_run_child", (query) =>
              query.eq("rebuildRunKey", run.rebuildRunKey),
            )
            .take(10)
            .pipe(Effect.orDie);
          const [manifest] = manifests;
          if (manifests.length !== 1 || manifest === undefined)
            return yield* Effect.dieMessage(
              `Expected one rebuild child manifest, found ${manifests.length}.`,
            );
          if (corruption === "extra_terminal") {
            yield* writer
              .table("retrievalRebuildChildren")
              .insert({
                schemaVersion: 1,
                rebuildRunKey: run.rebuildRunKey,
                childJobKey: `rjob_${"e".repeat(64)}`,
                parentBatchJobKey: rootJobKey,
                originKind: "page",
                operation: "publish",
                sourceKey: "pag_forged_manifest_child",
                sourceRevisionKey: "rev_forged_manifest_child",
                status: "published",
                createdAt: now + 4,
                updatedAt: now + 4,
              })
              .pipe(Effect.orDie);
          } else {
            yield* writer
              .table("retrievalRebuildChildren")
              .patch(manifest._id, {
                status: "revoked",
                updatedAt: now + 4,
              })
              .pipe(Effect.orDie);
          }
        }),
        resultSchema(),
      );
      const close = yield* confect.run(
        runPendingPageRebuildPhase(workspaceId, "close", now + 5),
        resultSchema(),
      );
      const state = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const runs = yield* reader
            .table("retrievalRebuildRuns")
            .index("by_workspace_brain_status", (query) =>
              query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
            )
            .take(2)
            .pipe(Effect.orDie);
          const [run] = runs;
          if (run === undefined)
            return yield* Effect.dieMessage("Missing rebuild run.");
          const manifests = yield* reader
            .table("retrievalRebuildChildren")
            .index("by_run_child", (query) =>
              query.eq("rebuildRunKey", run.rebuildRunKey),
            )
            .take(10)
            .pipe(Effect.orDie);
          return {
            run: {
              status: run.status,
              emittedChildCount: run.emittedChildCount,
              terminalChildCount: run.terminalChildCount,
              publishedChildCount: run.publishedChildCount,
              revokedChildCount: run.revokedChildCount,
              blockingErrorTag: run.blockingErrorTag,
            },
            manifestStatuses: manifests.map(({ status }) => status).sort(),
          };
        }),
        resultSchema(),
      );
      return { child, close, state };
    }).pipe(Effect.provide(testConfectLayer())),
  );

  expect(result.child.status).toBe("succeeded");
  expect(result.close).toMatchObject({
    status: "integrity_failure",
    attemptCount: 0,
    lastErrorTag: "PublicationRebuildChildManifestCensusInvalid",
  });
  expect(result.state.run).toMatchObject({
    status: "blocked",
    emittedChildCount: 1,
    terminalChildCount: 1,
    publishedChildCount: 1,
    revokedChildCount: 0,
    blockingErrorTag: "PublicationRebuildChildManifestCensusInvalid",
  });
  expect(result.state.manifestStatuses).toEqual(
    corruption === "extra_terminal" ? ["published", "published"] : ["revoked"],
  );
};

describe("retrieval publication authority races", () => {
  it("defers rebuild close while an emitted child is still pending", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
        const rootJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "page_rebuild",
              sourceKey: "corpus:pages",
              sourceRevisionKey: "rebuild:close-child-race",
              requestGeneration: 1,
              rebuild: { limit: 10 },
            },
            now,
          ),
          resultSchema(),
        );
        const scan = yield* confect.run(
          runPublicationJobEffect({
            jobKey: rootJobKey,
            caller: systemCaller,
            now,
          }),
          resultSchema(),
        );
        const catchup = yield* confect.run(
          runPendingPageRebuildPhase(workspaceId, "catch_up", now + 1),
          resultSchema(),
        );
        const setDifference = yield* confect.run(
          runPendingPageRebuildPhase(workspaceId, "set_difference", now + 2),
          resultSchema(),
        );
        const close = yield* confect.run(
          runPendingPageRebuildPhase(workspaceId, "close", now + 3),
          resultSchema(),
        );
        const state = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const runs = yield* reader
              .table("retrievalRebuildRuns")
              .index("by_workspace_brain_status", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(10)
              .pipe(Effect.orDie);
            const [run] = runs;
            if (run === undefined)
              return yield* Effect.dieMessage("Missing rebuild run.");
            const pendingChildren = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_rebuild_run_status", (query) =>
                query
                  .eq("rebuildRunKey", run.rebuildRunKey)
                  .eq("status", "pending"),
              )
              .take(10)
              .pipe(Effect.orDie);
            const health = yield* reader
              .table("brainCorpusHealth")
              .index("by_workspace_brain_corpus_scope", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("corpusKey", "brain-pages")
                  .eq("connectorScopeKey", undefined),
              )
              .first()
              .pipe(Effect.orDie);
            return {
              run: {
                status: run.status,
                emittedChildCount: run.emittedChildCount,
                terminalChildCount: run.terminalChildCount,
                blockingChildCount: run.blockingChildCount,
              },
              pendingChildCount: pendingChildren.filter(
                ({ parentRebuildJobKey }) => parentRebuildJobKey !== undefined,
              ).length,
              healthPresent: health._tag === "Some",
            };
          }),
          resultSchema(),
        );
        const child = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const pending = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_status_due_job", (query) =>
                query.eq("status", "pending"),
              )
              .take(100)
              .pipe(Effect.orDie);
            const children = pending.filter(
              (job) =>
                job.workspaceId === workspaceId &&
                job.brainKey === brainKey &&
                job.parentRebuildJobKey !== undefined,
            );
            const [pendingChild] = children;
            if (children.length !== 1 || pendingChild === undefined)
              return yield* Effect.dieMessage(
                `Expected one pending rebuild child, found ${children.length}.`,
              );
            return yield* runPublicationJobEffect({
              jobKey: pendingChild.jobKey,
              caller: systemCaller,
              now: now + 4,
            });
          }),
          resultSchema(),
        );
        const retriedClose = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const retrying = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_status_due_job", (query) =>
                query
                  .eq("status", "retry_wait")
                  .lte("nextAttemptAt", now + 2_000),
              )
              .take(100)
              .pipe(Effect.orDie);
            const closes = retrying.filter(
              (job) =>
                job.workspaceId === workspaceId &&
                job.brainKey === brainKey &&
                job.rebuild?.phase === "close",
            );
            const [retryingClose] = closes;
            if (closes.length !== 1 || retryingClose === undefined)
              return yield* Effect.dieMessage(
                `Expected one retrying rebuild close, found ${closes.length}.`,
              );
            return yield* runPublicationJobEffect({
              jobKey: retryingClose.jobKey,
              caller: systemCaller,
              now: now + 2_000,
            });
          }),
          resultSchema(),
        );
        const finalState = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const complete = yield* reader
              .table("retrievalRebuildRuns")
              .index("by_workspace_brain_status", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("status", "complete"),
              )
              .take(2)
              .pipe(Effect.orDie);
            const [run] = complete;
            const health = yield* reader
              .table("brainCorpusHealth")
              .index("by_workspace_brain_corpus_scope", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("corpusKey", "brain-pages")
                  .eq("connectorScopeKey", undefined),
              )
              .first()
              .pipe(Effect.orDie);
            return {
              run:
                run === undefined
                  ? null
                  : {
                      status: run.status,
                      emittedChildCount: run.emittedChildCount,
                      terminalChildCount: run.terminalChildCount,
                      publishedChildCount: run.publishedChildCount,
                      hasCompletionReceipt: run.completionReceipt !== undefined,
                    },
              health:
                health._tag === "None"
                  ? null
                  : {
                      coverageStatus: health.value.coverageStatus,
                      discoveredCount: health.value.discoveredCount,
                      publishedCount: health.value.publishedCount,
                    },
            };
          }),
          resultSchema(),
        );
        return {
          scan,
          catchup,
          setDifference,
          close,
          child,
          retriedClose,
          waitingState: state,
          finalState,
        };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.scan.status).toBe("succeeded");
    expect(result.catchup.status).toBe("succeeded");
    expect(result.setDifference.status).toBe("succeeded");
    expect(result.close).toMatchObject({
      status: "retry_wait",
      attemptCount: 1,
    });
    expect(result.waitingState.run).toMatchObject({
      status: "closing",
      emittedChildCount: 1,
      terminalChildCount: 0,
      blockingChildCount: 0,
    });
    expect(result.waitingState.pendingChildCount).toBe(1);
    expect(result.waitingState.healthPresent).toBe(false);
    expect(result.child.status).toBe("succeeded");
    expect(result.retriedClose.status).toBe("succeeded");
    expect(result.finalState.run).toMatchObject({
      status: "complete",
      emittedChildCount: 1,
      terminalChildCount: 1,
      publishedChildCount: 1,
      hasCompletionReceipt: true,
    });
    expect(result.finalState.health).toMatchObject({
      coverageStatus: "complete",
      discoveredCount: 1,
      publishedCount: 1,
    });
  });

  it("supersedes a delayed predecessor batch when a successor run opens", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
        const predecessorJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "page_rebuild",
              sourceKey: "corpus:pages",
              sourceRevisionKey: "rebuild:predecessor",
              requestGeneration: 1,
              rebuild: { limit: 10 },
            },
            now,
          ),
          resultSchema(),
        );
        yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "page_rebuild",
              sourceKey: "corpus:pages",
              sourceRevisionKey: "rebuild:successor",
              requestGeneration: 2,
              rebuild: { limit: 10 },
            },
            now + 1,
          ),
          resultSchema(),
        );
        const delayed = yield* confect.run(
          runPublicationJobEffect({
            jobKey: predecessorJobKey,
            caller: systemCaller,
            now: now + 2,
          }),
          resultSchema(),
        );
        const state = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const runs = yield* reader
              .table("retrievalRebuildRuns")
              .index("by_workspace_brain_status", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(10)
              .pipe(Effect.orDie);
            const health = yield* reader
              .table("brainCorpusHealth")
              .index("by_workspace_brain_corpus_scope", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("corpusKey", "brain-pages")
                  .eq("connectorScopeKey", undefined),
              )
              .first()
              .pipe(Effect.orDie);
            return {
              runs: runs.map(({ runGeneration, status }) => ({
                runGeneration,
                status,
              })),
              healthPresent: health._tag === "Some",
            };
          }),
          resultSchema(),
        );
        const currentSets = yield* confect.run(
          currentPageSets(workspaceId),
          resultSchema(),
        );
        return { delayed, currentSets, ...state };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.delayed).toMatchObject({
      status: "superseded",
      attemptCount: 0,
      lastErrorTag: "PublicationRebuildRunSuperseded",
    });
    expect(
      result.runs.sort(
        (left, right) => left.runGeneration - right.runGeneration,
      ),
    ).toEqual([
      { runGeneration: 1, status: "superseded" },
      { runGeneration: 2, status: "running" },
    ]);
    expect(result.currentSets).toEqual([]);
    expect(result.healthPresent).toBe(false);
  });

  it("blocks a rebuild run when its persisted authority is corrupted", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
        const jobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "page_rebuild",
              sourceKey: "corpus:pages",
              sourceRevisionKey: "rebuild:corrupt-run",
              requestGeneration: 1,
              rebuild: { limit: 10 },
            },
            now,
          ),
          resultSchema(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const runs = yield* reader
              .table("retrievalRebuildRuns")
              .index("by_workspace_brain_status", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("status", "running"),
              )
              .take(2)
              .pipe(Effect.orDie);
            const [run] = runs;
            if (run === undefined)
              return yield* Effect.dieMessage("Missing rebuild run.");
            yield* writer
              .table("retrievalRebuildRuns")
              .patch(run._id, { ledgerHighWater: run.ledgerHighWater + 1 })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const attempted = yield* confect.run(
          runPublicationJobEffect({
            jobKey,
            caller: systemCaller,
            now: now + 1,
          }),
          resultSchema(),
        );
        const runStatus = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const rows = yield* reader
              .table("retrievalRebuildRuns")
              .index("by_workspace_brain_status", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const [row] = rows;
            if (row === undefined)
              return yield* Effect.dieMessage("Missing rebuild run.");
            return row.status;
          }),
          resultSchema(),
        );
        return { attempted, runStatus };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.attempted).toMatchObject({
      status: "integrity_failure",
      attemptCount: 0,
      lastErrorTag: "PublicationRebuildRunIntegrityFailure",
    });
    expect(result.runStatus).toBe("blocked");
  });

  it("blocks close when an emitted rebuild child loses its run attribution", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
        const rootJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "page_rebuild",
              sourceKey: "corpus:pages",
              sourceRevisionKey: "rebuild:missing-child",
              requestGeneration: 1,
              rebuild: { limit: 10 },
            },
            now,
          ),
          resultSchema(),
        );
        yield* confect.run(
          runPublicationJobEffect({
            jobKey: rootJobKey,
            caller: systemCaller,
            now,
          }),
          resultSchema(),
        );
        yield* confect.run(
          runPendingPageRebuildPhase(workspaceId, "catch_up", now + 1),
          resultSchema(),
        );
        yield* confect.run(
          runPendingPageRebuildPhase(workspaceId, "set_difference", now + 2),
          resultSchema(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const pending = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_status_due_job", (query) =>
                query.eq("status", "pending"),
              )
              .take(100)
              .pipe(Effect.orDie);
            const children = pending.filter(
              (job) =>
                job.workspaceId === workspaceId &&
                job.brainKey === brainKey &&
                job.parentRebuildJobKey !== undefined,
            );
            const [child] = children;
            if (children.length !== 1 || child === undefined)
              return yield* Effect.dieMessage(
                `Expected one rebuild child to corrupt, found ${children.length}.`,
              );
            yield* writer
              .table("retrievalPublicationJobs")
              .patch(child._id, {
                rebuildRunKey: `rrun_${"f".repeat(64)}`,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const close = yield* confect.run(
          runPendingPageRebuildPhase(workspaceId, "close", now + 3),
          resultSchema(),
        );
        const run = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const runs = yield* reader
              .table("retrievalRebuildRuns")
              .index("by_workspace_brain_status", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const [row] = runs;
            if (row === undefined)
              return yield* Effect.dieMessage("Missing rebuild run.");
            return {
              status: row.status,
              emittedChildCount: row.emittedChildCount,
              terminalChildCount: row.terminalChildCount,
              blockingChildCount: row.blockingChildCount,
            };
          }),
          resultSchema(),
        );
        return { close, run };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.close).toMatchObject({
      status: "integrity_failure",
      attemptCount: 0,
    });
    expect(result.run).toMatchObject({
      status: "blocked",
      emittedChildCount: 1,
      terminalChildCount: 1,
      blockingChildCount: 1,
    });
  });

  it("blocks close when an already-terminal extra child manifest is forged", () =>
    assertDrainedManifestCorruptionBlocksClose("extra_terminal"));

  it("blocks close when terminal child-manifest status counts are forged", () =>
    assertDrainedManifestCorruptionBlocksClose("terminal_status"));

  it("refuses to complete after an inactive page is restored behind the ledger high-water", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
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
            if (page._tag === "None")
              return yield* Effect.dieMessage("Missing page.");
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
          }),
          resultSchema(),
        );
        const rootJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "page_rebuild",
              sourceKey: "corpus:pages",
              sourceRevisionKey: "rebuild:lifecycle-behind-cursor",
              requestGeneration: 1,
              rebuild: { limit: 10 },
            },
            now + 2,
          ),
          resultSchema(),
        );
        yield* confect.run(
          runPublicationJobEffect({
            jobKey: rootJobKey,
            caller: systemCaller,
            now: now + 2,
          }),
          resultSchema(),
        );
        yield* confect.run(
          runPendingPageRebuildPhase(workspaceId, "catch_up", now + 3),
          resultSchema(),
        );
        yield* confect.run(
          runPendingPageRebuildPhase(workspaceId, "set_difference", now + 4),
          resultSchema(),
        );
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
            if (page._tag === "None")
              return yield* Effect.dieMessage("Missing page.");
            yield* writer
              .table("brainPages")
              .patch(page.value._id, {
                status: "active",
                lifecycle: {
                  state: "active",
                  generation: 3,
                  updatedAt: now + 5,
                  purgeAfter: null,
                },
                updatedAt: now + 5,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const close = yield* confect.run(
          runPendingPageRebuildPhase(workspaceId, "close", now + 6),
          resultSchema(),
        );
        const intermediateState = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const runs = yield* reader
              .table("retrievalRebuildRuns")
              .index("by_workspace_brain_status", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const [run] = runs;
            if (run === undefined)
              return yield* Effect.dieMessage("Missing rebuild run.");
            const currentSets = yield* reader
              .table("retrievalPublicationSets")
              .index("by_workspace_brain_state_publication_set", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("state", "current"),
              )
              .take(10)
              .pipe(Effect.orDie);
            return {
              runStatus: run.status,
              currentSourceKeys: currentSets.map(({ sourceKey }) => sourceKey),
            };
          }),
          resultSchema(),
        );
        const catchupAfterRestore = yield* confect.run(
          runPendingPageRebuildPhase(workspaceId, "catch_up", now + 7),
          resultSchema(),
        );
        const setDifferenceAfterRestore = yield* confect.run(
          runPendingPageRebuildPhase(workspaceId, "set_difference", now + 8),
          resultSchema(),
        );
        const childAfterRestore = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const pending = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_status_due_job", (query) =>
                query.eq("status", "pending"),
              )
              .take(100)
              .pipe(Effect.orDie);
            const children = pending.filter(
              (job) =>
                job.workspaceId === workspaceId &&
                job.brainKey === brainKey &&
                job.originKind === "page" &&
                job.parentRebuildJobKey !== undefined,
            );
            const [child] = children;
            if (children.length !== 1 || child === undefined)
              return yield* Effect.dieMessage(
                `Expected one restored-page child, found ${children.length}.`,
              );
            return yield* runPublicationJobEffect({
              jobKey: child.jobKey,
              caller: systemCaller,
              now: now + 9,
            });
          }),
          resultSchema(),
        );
        const finalClose = yield* confect.run(
          runPendingPageRebuildPhase(workspaceId, "close", now + 10),
          resultSchema(),
        );
        const finalState = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const runs = yield* reader
              .table("retrievalRebuildRuns")
              .index("by_workspace_brain_status", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const [run] = runs;
            if (run === undefined)
              return yield* Effect.dieMessage("Missing rebuild run.");
            const currentSets = yield* reader
              .table("retrievalPublicationSets")
              .index("by_workspace_brain_state_publication_set", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("state", "current"),
              )
              .take(10)
              .pipe(Effect.orDie);
            return {
              run: {
                status: run.status,
                emittedChildCount: run.emittedChildCount,
                terminalChildCount: run.terminalChildCount,
                blockingChildCount: run.blockingChildCount,
                publishedChildCount: run.publishedChildCount,
                hasCompletionReceipt: run.completionReceipt !== undefined,
              },
              currentSourceKeys: currentSets.map(({ sourceKey }) => sourceKey),
            };
          }),
          resultSchema(),
        );
        return {
          close,
          intermediateState,
          catchupAfterRestore,
          setDifferenceAfterRestore,
          childAfterRestore,
          finalClose,
          finalState,
        };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.intermediateState.currentSourceKeys).toEqual([]);
    expect(result.intermediateState.runStatus).not.toBe("complete");
    expect(result.catchupAfterRestore.status).toBe("succeeded");
    expect(result.setDifferenceAfterRestore.status).toBe("succeeded");
    expect(result.childAfterRestore.status).toBe("succeeded");
    expect(result.finalClose.status).toBe("succeeded");
    expect(result.finalState.run).toMatchObject({
      status: "complete",
      emittedChildCount: 1,
      terminalChildCount: 1,
      blockingChildCount: 0,
      publishedChildCount: 1,
      hasCompletionReceipt: true,
    });
    expect(result.finalState.currentSourceKeys).toEqual([pageKey]);
  });

  it("attributes connection cleanup from persisted publication ownership after the origin advances generation", async () => {
    const oldConnectionKey = "conn_rebuild_scope";
    const sourceKey = "src_rebuild.scope";
    const publicationSetKey = `rset_${"b".repeat(64)}`;
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedWorkspace,
          resultSchema(),
        );
        const publicationSubjectKey = retrievalPublicationSubjectKey({
          workspaceId: String(workspaceId),
          brainKey,
          corpusKey: "slack",
          originTable: "sourceRevisions",
          kind: "slack",
          sourceKey,
          connectorScopeKey: "channel_rebuild_scope",
        });
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            yield* writer
              .table("retrievalPublicationSubjects")
              .insert({
                schemaVersion: 1,
                organizationKey,
                workspaceId,
                brainKey,
                corpusKey: "slack",
                publicationSubjectKey,
                originKind: "slack",
                originTable: "sourceRevisions",
                sourceKey,
                connectorScopeKey: "channel_rebuild_scope",
                connectionKey: oldConnectionKey,
                connectionGeneration: 1,
                currentPublicationSetKey: publicationSetKey,
                lastPublicationGeneration: 1,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("retrievalPublicationSets")
              .insert({
                schemaVersion: 1,
                organizationKey,
                workspaceId,
                brainKey,
                corpusKey: "slack",
                publicationSubjectKey,
                publicationSetKey,
                publicationGeneration: 1,
                originKind: "slack",
                originTable: "sourceRevisions",
                connectorScopeKey: "channel_rebuild_scope",
                connectionKey: oldConnectionKey,
                connectionGeneration: 1,
                sourceKey,
                sourceRevisionKey: `srev_${"c".repeat(64)}`,
                routeGeneration: 1,
                lifecycleGeneration: 1,
                policyGeneration: 1,
                expectedEntryCount: 0,
                expectedTokenCount: 0,
                manifestHash: `sha256:${"d".repeat(64)}`,
                state: "current",
                createdAt: now,
                activatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("sourceArtifacts")
              .insert({
                schemaVersion: 1,
                organizationKey,
                connectionKey: oldConnectionKey,
                connectionGeneration: 2,
                channelKey: "channel_rebuild_scope",
                externalChannelId: "C_REBUILD_SCOPE",
                providerObjectId: "C_REBUILD_SCOPE:1",
                sourceKey,
                threadKey: "thread_rebuild_scope",
                latestSourceRevisionKey: `srev_${"e".repeat(64)}`,
                latestProviderOrder: "2",
                lifecycle: {
                  state: "active",
                  generation: 2,
                  updatedAt: now + 1,
                  purgeAfter: null,
                },
                createdAt: now,
                updatedAt: now + 1,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const rootJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "slack_rebuild",
              sourceKey: oldConnectionKey,
              sourceRevisionKey: `connection:${oldConnectionKey}:active:1`,
              requestGeneration: 1,
              rebuild: { limit: 10 },
            },
            now + 2,
          ),
          resultSchema(),
        );
        yield* confect.run(
          runPublicationJobEffect({
            jobKey: rootJobKey,
            caller: systemCaller,
            now: now + 2,
          }),
          resultSchema(),
        );
        yield* confect.run(
          runPendingPageRebuildPhase(
            workspaceId,
            "catch_up",
            now + 3,
            "slack_rebuild",
          ),
          resultSchema(),
        );
        yield* confect.run(
          runPendingPageRebuildPhase(
            workspaceId,
            "set_difference",
            now + 4,
            "slack_rebuild",
          ),
          resultSchema(),
        );
        return yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const runs = yield* reader
              .table("retrievalRebuildRuns")
              .index("by_workspace_brain_status", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const [run] = runs;
            if (run === undefined)
              return yield* Effect.dieMessage("Missing rebuild run.");
            const jobs = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_rebuild_run_status", (query) =>
                query.eq("rebuildRunKey", run.rebuildRunKey),
              )
              .take(100)
              .pipe(Effect.orDie);
            return {
              emittedChildCount: run.emittedChildCount,
              cleanupJobs: jobs.filter(
                (job) =>
                  job.parentRebuildJobKey !== undefined &&
                  job.operation === "cleanup" &&
                  job.authorityEnvelope?.publicationSubjectKey ===
                    publicationSubjectKey,
              ),
            };
          }),
          resultSchema(),
        );
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.emittedChildCount).toBe(1);
    expect(result.cleanupJobs).toHaveLength(1);
  });

  it("atomically retires the prior page set while retaining its citation rows", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
        const firstJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(pageJobInput(workspaceId), now),
          resultSchema(),
        );
        const first = yield* confect.run(
          runPublicationJobEffect({
            jobKey: firstJobKey,
            caller: systemCaller,
            now,
          }),
          resultSchema(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const pages = yield* reader
              .table("brainPages")
              .index("by_workspace_page_key", (query) =>
                query.eq("workspaceId", workspaceId).eq("pageKey", pageKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const page = pages[0];
            const organizationId = page?.organizationId;
            const lifecycle = page?.lifecycle;
            if (
              pages.length !== 1 ||
              page === undefined ||
              organizationId === undefined ||
              lifecycle?.state !== "active"
            )
              return yield* Effect.dieMessage(
                "Expected one page before successor publication.",
              );
            const revisionLifecycle = {
              ...lifecycle,
              state: "active" as const,
            };
            const markdown =
              "# Authority\n\nOnly the successor authority may publish.";
            yield* writer
              .table("pageRevisions")
              .insert({
                workspaceId,
                organizationId,
                pageKey,
                revisionKey: successorRevisionKey,
                priorRevisionKey: revisionKey,
                blockNoteJson: "",
                markdown,
                contentHash: "authority-race-hash-2",
                causation: "human-edit",
                actor: { kind: "migration", id: "authority-race-test" },
                modelReceiptKey: null,
                effectKey: "authority-race:2",
                state: "published",
                lifecycle: revisionLifecycle,
                createdAt: now + 1,
                schemaVersion: 1,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("brainPages")
              .patch(page._id, {
                currentRevisionKey: successorRevisionKey,
                markdown,
                updatedAt: now + 1,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const successorJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              ...pageJobInput(workspaceId),
              sourceRevisionKey: successorRevisionKey,
              requestGeneration: 2,
            },
            now + 1,
          ),
          resultSchema(),
        );
        const successor = yield* confect.run(
          runPublicationJobEffect({
            jobKey: successorJobKey,
            caller: systemCaller,
            now: now + 1,
          }),
          resultSchema(),
        );
        const state = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const [current, retired, subjects] = yield* Effect.all([
              reader
                .table("retrievalPublicationSets")
                .index("by_workspace_brain_state_publication_set", (query) =>
                  query
                    .eq("workspaceId", workspaceId)
                    .eq("brainKey", brainKey)
                    .eq("state", "current"),
                )
                .take(2)
                .pipe(Effect.orDie),
              reader
                .table("retrievalPublicationSets")
                .index("by_workspace_brain_state_publication_set", (query) =>
                  query
                    .eq("workspaceId", workspaceId)
                    .eq("brainKey", brainKey)
                    .eq("state", "retired"),
                )
                .take(2)
                .pipe(Effect.orDie),
              reader
                .table("retrievalPublicationSubjects")
                .index("by_workspace_brain_subject", (query) =>
                  query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
                )
                .take(2)
                .pipe(Effect.orDie),
            ]);
            const prior = retired[0];
            if (prior === undefined)
              return yield* Effect.dieMessage(
                "Expected one retired predecessor publication set.",
              );
            const citationRows = yield* reader
              .table("retrievalEntries")
              .index("by_workspace_brain_publication_set_entry", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("publicationSetKey", prior.publicationSetKey),
              )
              .take(10)
              .pipe(Effect.orDie);
            return { current, retired, subjects, citationRows };
          }),
          resultSchema(),
        );
        return { first, successor, state };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.first.status).toBe("succeeded");
    expect(result.successor.status).toBe("succeeded");
    expect(result.state.current).toHaveLength(1);
    expect(result.state.retired).toHaveLength(1);
    expect(result.state.current[0]).toMatchObject({
      sourceRevisionKey: successorRevisionKey,
      publicationGeneration: 2,
      state: "current",
    });
    expect(result.state.retired[0]).toMatchObject({
      sourceRevisionKey: revisionKey,
      publicationGeneration: 1,
      state: "retired",
    });
    expect(result.state.current[0]?.eligibilityFences).toEqual(
      result.state.retired[0]?.eligibilityFences,
    );
    expect(result.state.subjects).toHaveLength(1);
    expect(result.state.subjects[0]).toMatchObject({
      currentPublicationSetKey: result.state.current[0]?.publicationSetKey,
      lastPublicationGeneration: 2,
    });
    expect(result.state.citationRows.length).toBeGreaterThan(0);
  });

  it("converges Slack update, lifecycle revoke, retry, backfill, and rebuild races", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedSlackCorpus,
          resultSchema(),
        );
        const backfilled = yield* confect.run(
          rebuildSlackBatchEffect({
            organizationKey,
            workspaceId,
            brainKey,
            limit: 10,
            caller: systemCaller,
            now,
          }),
          resultSchema(),
        );
        const delayedJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "slack",
              sourceKey: slackSourceKey,
              sourceRevisionKey: slackRevisionOneKey,
              requestGeneration: 1,
            },
            now + 1,
          ),
          resultSchema(),
        );
        yield* confect.run(advanceSlackCorpus, resultSchema());
        const updated = yield* confect.run(
          publishSlackRevisionEffect({
            organizationKey,
            workspaceId,
            brainKey,
            sourceRevisionKey: slackRevisionTwoKey,
            caller: systemCaller,
            now: now + 2,
          }),
          resultSchema(),
        );
        const delayed = yield* confect.run(
          runPublicationJobEffect({
            jobKey: delayedJobKey,
            caller: systemCaller,
            now: now + 3,
          }),
          resultSchema(),
        );
        const revokedFence = yield* confect.run(
          transitionSlackLifecycle("deleted_tombstone", 2, now + 4),
          resultSchema(),
        );
        const revoked = yield* confect.run(
          publishSlackRevisionEffect({
            organizationKey,
            workspaceId,
            brainKey,
            sourceRevisionKey: slackRevisionTwoKey,
            caller: systemCaller,
            now: now + 4,
          }),
          resultSchema(),
        );
        const restoredFence = yield* confect.run(
          transitionSlackLifecycle("active", 3, now + 5),
          resultSchema(),
        );
        const retryJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "slack",
              sourceKey: slackSourceKey,
              sourceRevisionKey: slackRevisionTwoKey,
              requestGeneration: 3,
            },
            now + 6,
          ),
          resultSchema(),
        );
        yield* confect.run(
          forcePublicationRetry(retryJobKey, now + 7),
          resultSchema(),
        );
        const retried = yield* confect.run(
          runPublicationJobEffect({
            jobKey: retryJobKey,
            caller: systemCaller,
            now: now + 7,
          }),
          resultSchema(),
        );
        const rebuilt = yield* confect.run(
          rebuildSlackBatchEffect({
            organizationKey,
            workspaceId,
            brainKey,
            limit: 10,
            caller: systemCaller,
            now: now + 8,
          }),
          resultSchema(),
        );
        const state = yield* confect.run(
          corpusPublicationState(workspaceId, "slack"),
          resultSchema(),
        );
        return {
          backfilled,
          updated,
          delayed,
          revokedFence,
          revoked,
          restoredFence,
          retried,
          rebuilt,
          state,
        };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.backfilled).toMatchObject({
      processed: 1,
      published: 1,
      revoked: 0,
      hasMore: false,
    });
    expect(result.updated).toMatchObject({ outcome: "published" });
    expect(result.delayed).toMatchObject({
      status: "superseded",
      attemptCount: 1,
    });
    expect(result.revokedFence).toMatchObject({
      eligible: false,
      ref: { kind: "lifecycle", eligibilityGeneration: 2 },
    });
    expect(result.revoked).toMatchObject({ outcome: "revoked" });
    expect(result.restoredFence).toMatchObject({
      eligible: true,
      ref: { kind: "lifecycle", eligibilityGeneration: 3 },
    });
    expect(result.retried).toMatchObject({
      status: "succeeded",
      attemptCount: 2,
    });
    expect(result.rebuilt).toMatchObject({
      processed: 1,
      published: 1,
      revoked: 0,
      hasMore: false,
    });
    expect(result.state.current).toHaveLength(1);
    expect(result.state.current[0]).toMatchObject({
      originKind: "slack",
      sourceKey: slackSourceKey,
      sourceRevisionKey: slackRevisionTwoKey,
      lifecycleGeneration: 3,
      publicationGeneration: 3,
      state: "current",
    });
    expect(result.state.retired).toHaveLength(2);
    expect(
      result.state.retired.map(({ sourceRevisionKey }) => sourceRevisionKey),
    ).toEqual(
      expect.arrayContaining([slackRevisionOneKey, slackRevisionTwoKey]),
    );
    expect(result.state.subjects).toHaveLength(1);
    expect(result.state.subjects[0]).toMatchObject({
      currentPublicationSetKey: result.state.current[0]?.publicationSetKey,
      lastPublicationGeneration: 3,
    });
  });

  it("converges transcript update, lifecycle revoke, retry, backfill, and rebuild races", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedTranscriptCorpus,
          resultSchema(),
        );
        const backfilled = yield* confect.run(
          rebuildTranscriptBatchEffect({
            organizationKey,
            workspaceId,
            brainKey,
            limit: 10,
            caller: systemCaller,
            now,
          }),
          resultSchema(),
        );
        const delayedJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "transcript",
              sourceKey: transcriptUnitKey,
              sourceRevisionKey: transcriptRevisionOneKey,
              requestGeneration: 1,
            },
            now + 1,
          ),
          resultSchema(),
        );
        yield* confect.run(advanceTranscriptCorpus, resultSchema());
        const updated = yield* confect.run(
          publishTranscriptRevisionEffect({
            organizationKey,
            workspaceId,
            brainKey,
            sourceRevisionKey: transcriptRevisionTwoKey,
            caller: systemCaller,
            now: now + 2,
          }),
          resultSchema(),
        );
        const delayed = yield* confect.run(
          runPublicationJobEffect({
            jobKey: delayedJobKey,
            caller: systemCaller,
            now: now + 3,
          }),
          resultSchema(),
        );
        const revokedFence = yield* confect.run(
          transitionTranscriptLifecycle("deleted_tombstone", 2, now + 4),
          resultSchema(),
        );
        const revoked = yield* confect.run(
          publishTranscriptRevisionEffect({
            organizationKey,
            workspaceId,
            brainKey,
            sourceRevisionKey: transcriptRevisionTwoKey,
            caller: systemCaller,
            now: now + 4,
          }),
          resultSchema(),
        );
        const restoredFence = yield* confect.run(
          transitionTranscriptLifecycle("active", 3, now + 5),
          resultSchema(),
        );
        const retryJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              organizationKey,
              workspaceId,
              brainKey,
              originKind: "transcript",
              sourceKey: transcriptUnitKey,
              sourceRevisionKey: transcriptRevisionTwoKey,
              requestGeneration: 3,
            },
            now + 6,
          ),
          resultSchema(),
        );
        yield* confect.run(
          forcePublicationRetry(retryJobKey, now + 7),
          resultSchema(),
        );
        const retried = yield* confect.run(
          runPublicationJobEffect({
            jobKey: retryJobKey,
            caller: systemCaller,
            now: now + 7,
          }),
          resultSchema(),
        );
        const rebuilt = yield* confect.run(
          rebuildTranscriptBatchEffect({
            organizationKey,
            workspaceId,
            brainKey,
            limit: 10,
            caller: systemCaller,
            now: now + 8,
          }),
          resultSchema(),
        );
        const state = yield* confect.run(
          corpusPublicationState(workspaceId, "transcripts"),
          resultSchema(),
        );
        return {
          backfilled,
          updated,
          delayed,
          revokedFence,
          revoked,
          restoredFence,
          retried,
          rebuilt,
          state,
        };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.backfilled).toMatchObject({
      processed: 1,
      published: 1,
      revoked: 0,
      hasMore: false,
    });
    expect(result.updated).toMatchObject({ outcome: "published" });
    expect(result.delayed).toMatchObject({
      status: "superseded",
      attemptCount: 1,
    });
    expect(result.revokedFence).toMatchObject({
      eligible: false,
      ref: { kind: "lifecycle", eligibilityGeneration: 2 },
    });
    expect(result.revoked).toMatchObject({ outcome: "revoked" });
    expect(result.restoredFence).toMatchObject({
      eligible: true,
      ref: { kind: "lifecycle", eligibilityGeneration: 3 },
    });
    expect(result.retried).toMatchObject({
      status: "succeeded",
      attemptCount: 2,
    });
    expect(result.rebuilt).toMatchObject({
      processed: 1,
      published: 1,
      revoked: 0,
      hasMore: false,
    });
    expect(result.state.current).toHaveLength(1);
    expect(result.state.current[0]).toMatchObject({
      originKind: "transcript",
      sourceKey: transcriptUnitKey,
      sourceRevisionKey: transcriptRevisionTwoKey,
      lifecycleGeneration: 3,
      publicationGeneration: 3,
      state: "current",
    });
    expect(result.state.retired).toHaveLength(2);
    expect(
      result.state.retired.map(({ sourceRevisionKey }) => sourceRevisionKey),
    ).toEqual(
      expect.arrayContaining([
        transcriptRevisionOneKey,
        transcriptRevisionTwoKey,
      ]),
    );
    expect(result.state.subjects).toHaveLength(1);
    expect(result.state.subjects[0]).toMatchObject({
      currentPublicationSetKey: result.state.current[0]?.publicationSetKey,
      lastPublicationGeneration: 3,
    });
  });

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

  it("cannot let a pre-purge cleanup revoke a recreated subject incarnation", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { organizationId, workspaceId } = yield* confect.run(
          seedPage,
          resultSchema(),
        );
        const initialJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(pageJobInput(workspaceId), now),
          resultSchema(),
        );
        const initial = yield* confect.run(
          runPublicationJobEffect({
            jobKey: initialJobKey,
            caller: systemCaller,
            now,
          }),
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
            if (page._tag === "None") throw new Error("missing purge page");
            yield* writer
              .table("brainPages")
              .patch(page.value._id, {
                status: "purged",
                lifecycle: {
                  state: "purged",
                  generation: 2,
                  updatedAt: now + 1,
                  purgeAfter: now + 1,
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
        const cleanupJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              ...pageJobInput(workspaceId),
              operation: "cleanup",
              requestGeneration: 2,
            },
            now + 1,
          ),
          resultSchema(),
        );
        const beforePurge = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const subjects = yield* reader
              .table("retrievalPublicationSubjects")
              .index("by_workspace_brain_subject", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const cleanupJob = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_job_key", (query) => query.eq("jobKey", cleanupJobKey))
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie);
            return { subjects, cleanupJob };
          }),
          resultSchema(),
        );
        const purged = yield* confect.run(
          purgePageOriginEffect({
            organizationKey,
            workspaceId,
            brainKey,
            pageKey,
            expectedLifecycleGeneration: 2,
            now: now + 1,
          }),
          resultSchema(),
        );
        const afterPurge = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const subjects = yield* reader
              .table("retrievalPublicationSubjects")
              .index("by_workspace_brain_subject", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const sets = yield* reader
              .table("retrievalPublicationSets")
              .index("by_workspace_brain_source_state_generation", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("originTable", "pageRevisions")
                  .eq("sourceKey", pageKey),
              )
              .take(10)
              .pipe(Effect.orDie);
            return { subjects, sets };
          }),
          resultSchema(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            const lifecycle = {
              state: "active" as const,
              generation: 3,
              updatedAt: now + 2,
              purgeAfter: null,
            };
            yield* writer
              .table("brainPages")
              .insert({
                workspaceId,
                organizationId,
                slug: "authority-race-recreated",
                title: "Authority Race Recreated",
                markdown:
                  "# Recreated authority\n\nOnly the new incarnation may publish.",
                sourceKind: "markdown",
                updatedAt: now + 2,
                pageKey,
                parentPageKey: null,
                siblingSlug: "authority-race-recreated",
                sortKey: "0000000001",
                favorite: false,
                status: "active",
                currentRevisionKey: successorRevisionKey,
                lifecycle,
                createdAt: now + 2,
                schemaVersion: 1,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("pageRevisions")
              .insert({
                workspaceId,
                organizationId,
                pageKey,
                revisionKey: successorRevisionKey,
                priorRevisionKey: null,
                blockNoteJson: "",
                markdown:
                  "# Recreated authority\n\nOnly the new incarnation may publish.",
                contentHash: "authority-race-recreated-hash",
                causation: "import",
                actor: { kind: "migration", id: "authority-race-test" },
                modelReceiptKey: null,
                effectKey: "authority-race:recreated",
                state: "published",
                lifecycle,
                createdAt: now + 2,
                schemaVersion: 1,
              })
              .pipe(Effect.orDie);
            yield* transitionEligibilityFenceEffect({
              identity: lifecycleIdentity,
              eligible: true,
              now: now + 2,
            });
          }),
          resultSchema(),
        );
        const recreatedJobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            {
              ...pageJobInput(workspaceId),
              sourceRevisionKey: successorRevisionKey,
              requestGeneration: 3,
            },
            now + 2,
          ),
          resultSchema(),
        );
        const recreated = yield* confect.run(
          runPublicationJobEffect({
            jobKey: recreatedJobKey,
            caller: systemCaller,
            now: now + 2,
          }),
          resultSchema(),
        );
        const staleCleanup = yield* confect.run(
          runPublicationJobEffect({
            jobKey: cleanupJobKey,
            caller: systemCaller,
            now: now + 3,
          }),
          resultSchema(),
        );
        const finalState = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const subjects = yield* reader
              .table("retrievalPublicationSubjects")
              .index("by_workspace_brain_subject", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const currentSets = yield* currentPageSets(workspaceId);
            const entries = yield* reader
              .table("retrievalEntries")
              .index("by_workspace_brain_revision_entry", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("sourceRevisionKey", successorRevisionKey),
              )
              .take(10)
              .pipe(Effect.orDie);
            const recreatedJob = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_job_key", (query) =>
                query.eq("jobKey", recreatedJobKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie);
            return { subjects, currentSets, entries, recreatedJob };
          }),
          resultSchema(),
        );
        return {
          initial,
          beforePurge,
          purged,
          afterPurge,
          recreated,
          staleCleanup,
          finalState,
        };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.initial.status).toBe("succeeded");
    expect(result.purged.outcome).toBe("purged");
    expect(result.beforePurge.subjects).toHaveLength(1);
    expect(result.afterPurge.subjects).toHaveLength(1);
    expect(result.afterPurge.subjects[0]?._id).toBe(
      result.beforePurge.subjects[0]?._id,
    );
    expect(result.afterPurge.subjects[0]).toMatchObject({
      currentPublicationSetKey: null,
      lastPublicationGeneration: 1,
    });
    expect(result.afterPurge.sets).toEqual([]);
    expect(result.recreated.status).toBe("succeeded");
    expect(result.staleCleanup).toMatchObject({
      status: "superseded",
      attemptCount: 0,
      lastErrorTag: "PublicationAuthoritySuperseded",
    });
    expect(result.finalState.subjects).toHaveLength(1);
    expect(result.finalState.subjects[0]).toMatchObject({
      _id: result.beforePurge.subjects[0]?._id,
      currentPublicationSetKey:
        result.finalState.currentSets[0]?.publicationSetKey,
      lastPublicationGeneration: 2,
    });
    expect(result.finalState.currentSets).toHaveLength(1);
    expect(result.finalState.currentSets[0]).toMatchObject({
      publicationGeneration: 2,
      sourceRevisionKey: successorRevisionKey,
      state: "current",
    });
    expect(result.finalState.entries.length).toBeGreaterThan(0);
    expect(
      result.finalState.entries.map(({ text }) => text).join(" "),
    ).not.toContain("Only current authority may publish");
    expect(
      result.beforePurge.cleanupJob?.authorityEnvelope?.subjectIncarnationKey,
    ).not.toBe(
      result.finalState.recreatedJob?.authorityEnvelope?.subjectIncarnationKey,
    );
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
      status: "integrity_failure",
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
        const targetResolutionIntentKey = yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            const receiptId = yield* writer
              .table("providerEventReceipts")
              .insert({
                schemaVersion: 1,
                organizationKey,
                connectionKey: "conn_forged_page_link",
                connectionGeneration: 1,
                channelKey: "channel_forged_page_link",
                externalChannelId: "C_forged_page_link",
                transport: "live",
                transportDeliveryId: "delivery_forged_page_link",
                providerEventId: "event_forged_page_link",
                providerObjectId: "object_forged_page_link",
                providerRevisionId: "revision_forged_page_link",
                providerOrder: "1",
                canonicalContentHash: `sha256:${"a".repeat(64)}`,
                tombstone: false,
                signatureVerification: {
                  status: "verified",
                  receiptHash: `sha256:${"b".repeat(64)}`,
                },
                replayVerification: {
                  status: "accepted",
                  receiptHash: `sha256:${"c".repeat(64)}`,
                },
                receivedAt: now,
                createdAt: now,
                observationKey: null,
                sourceKey: null,
                sourceRevisionKey: null,
                outcome: "rejected",
                reason: "invalid_payload",
              })
              .pipe(Effect.orDie);
            return yield* writer
              .table("slackPublicationTargetIntents")
              .insert({
                schemaVersion: 1,
                receiptId,
                organizationKey,
                channelKey: "channel_forged_page_link",
                sourceRevisionKey: revisionKey,
                status: "pending",
                attemptCount: 0,
                nextAttemptAt: now,
                lastErrorTag: null,
                resolutionGeneration: 1,
                targetCount: 0,
                completedAt: null,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
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
          targetResolutionIntentKey,
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
      status: "integrity_failure",
      attemptCount: 0,
      lastErrorTag: "PublicationAuthorityLinkageInvalid",
    });
    expect(result.currentSets).toEqual([]);
  });

  it("rechecks the pause epoch after claim before activating a publication set", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
        const job = {
          organizationKey,
          workspaceId,
          brainKey,
          jobKey: `rjob_${"f".repeat(64)}`,
          originKind: "page" as const,
          attemptCount: 0,
        };
        const claim = yield* confect.run(
          claimPublicationJobLeaseEffect({
            job,
            now,
            leaseDurationMs: 60_000,
          }),
          resultSchema(),
        );
        if (claim.status !== "claimed")
          return yield* Effect.dieMessage(
            "Expected a publication lease claim.",
          );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            yield* writer
              .table("brainPublicationPauses")
              .insert({
                schemaVersion: 1,
                organizationKey,
                workspaceId,
                brainKey,
                scopeKey: "brain-pages",
                pauseKey: publicationPauseKey({
                  organizationKey,
                  workspaceId,
                  brainKey,
                  scopeKey: "brain-pages",
                }),
                pauseEpoch: claim.pauseEpoch + 1,
                state: "paused",
                reason: "race fence",
                pausedAt: now + 1,
                resumedAt: null,
                updatedAt: now + 1,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const activated = yield* confect.run(
          activatePublicationJobLeaseEffect({
            job,
            leaseKey: claim.leaseKey,
            expectedPauseEpoch: claim.pauseEpoch,
            now: now + 2,
          }),
          resultSchema(),
        );
        const state = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const lease = yield* reader
              .table("brainPublicationWorkerLeases")
              .index("by_lease_key", (query) =>
                query.eq("leaseKey", claim.leaseKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            const currentSets = yield* currentPageSets(workspaceId);
            return { lease, currentSets };
          }),
          resultSchema(),
        );
        return { claim, activated, state };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.claim).toMatchObject({ status: "claimed", pauseEpoch: 0 });
    expect(result.activated).toBe(false);
    expect(result.state.lease).toMatchObject({
      state: "abandoned",
      releaseReason: "paused",
    });
    expect(result.state.currentSets).toEqual([]);
  });

  it("fails closed when an active lease is misbound to another publication scope", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(seedPage, resultSchema());
        const job = {
          organizationKey,
          workspaceId,
          brainKey,
          jobKey: `rjob_${"e".repeat(64)}`,
          originKind: "page" as const,
          attemptCount: 0,
        };
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            const wrongPauseKey = publicationPauseKey({
              organizationKey,
              workspaceId,
              brainKey,
              scopeKey: "slack",
            });
            yield* writer
              .table("brainPublicationWorkerLeases")
              .insert({
                schemaVersion: 1,
                organizationKey,
                workspaceId,
                brainKey,
                scopeKey: "slack",
                pauseKey: wrongPauseKey,
                leaseKey: `bpwl_${"e".repeat(64)}`,
                jobKey: job.jobKey,
                pauseEpoch: 0,
                state: "active",
                claimedAt: now,
                expiresAt: now + 60_000,
                releasedAt: null,
                releaseReason: null,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        return yield* confect.run(
          claimPublicationJobLeaseEffect({
            job,
            now: now + 1,
            leaseDurationMs: 60_000,
          }),
          resultSchema(),
        );
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result).toMatchObject({
      status: "integrity_failure",
      scopeKey: "brain-pages",
      pauseEpoch: 0,
    });
  });
});
