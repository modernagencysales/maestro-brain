import { Ref } from "@confect/core";
import {
  DatabaseReader,
  DatabaseSchema,
  DatabaseWriter,
  RegisteredConvexFunction,
  RegisteredFunctions,
} from "@confect/server";
import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import type { GenericId, Value } from "convex/values";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import {
  connectorAllowlistFenceIdentity,
  connectorScopeFenceIdentity,
  connectionFenceIdentity,
} from "../confect/brain/retrievalEligibility";
import { retrievalEligibilityFenceKey } from "../confect/brain/retrievalPublication";
import { retrievalPublicationJobRow } from "../confect/brain/retrievalPublicationJob";
import { publicationPauseKey } from "../confect/brain/publicationWorkerControl";
import rolloutStatusImpl from "../confect/brain/rolloutStatus.impl";
import rolloutStatus, {
  getBrainRolloutStatus,
  RolloutStatusCapacityExceeded,
} from "../confect/brain/rolloutStatus.spec";
import brainPublicationPausesSource from "../confect/tables/brainPublicationPauses";

const now = 1_787_372_800_000;
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";
const organizationKey = `ag_${brainKey.slice(3)}`;
const configurationDigest = `sha256:${"1".repeat(64)}`;
const populationDigest = `sha256:${"2".repeat(64)}`;
const completionDigest = `sha256:${"3".repeat(64)}`;

const brainPublicationPauses = brainPublicationPausesSource(
  "brainPublicationPauses",
);
const statusDatabaseSchema = DatabaseSchema.make({
  ...databaseSchema.tables,
  brainPublicationPauses,
});
const statusConvexSchema = defineSchema({
  ...Object.fromEntries(
    Object.entries(databaseSchema.tables).map(([name, table]) => [
      name,
      table.tableDefinition,
    ]),
  ),
  brainPublicationPauses: brainPublicationPauses.tableDefinition,
});
const registeredFunctions = RegisteredFunctions.buildForGroup<
  typeof rolloutStatus
>(statusDatabaseSchema, rolloutStatusImpl, RegisteredConvexFunction.make);
const statusTestLayer = TestConfect.layer(
  statusDatabaseSchema,
  statusConvexSchema,
  {
    ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
    "../convex/brain/rolloutStatus.ts": async () => registeredFunctions,
  },
);
const StatusDatabaseReader =
  DatabaseReader.DatabaseReader<typeof statusDatabaseSchema>();
const StatusDatabaseWriter =
  DatabaseWriter.DatabaseWriter<typeof statusDatabaseSchema>();
const statusRef = Ref.make("brain/rolloutStatus", getBrainRolloutStatus);
const resultSchema = <Result>(): Schema.Schema<Result, Value> =>
  Schema.Any as unknown as Schema.Schema<Result, Value>;

const seedWorkspace = Effect.gen(function* () {
  const writer = yield* StatusDatabaseWriter;
  const userId = yield* writer
    .table("users")
    .insert({
      subject: "rollout-status-owner",
      email: "rollout-status-owner@example.com",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const organizationId = yield* writer
    .table("organizations")
    .insert({
      ownerUserId: userId,
      workosOrganizationId: "org_rollout_status",
      agencyKey: organizationKey,
      slug: "rollout-status",
      name: "Rollout Status",
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
      name: "Rollout Status Brain",
      slug: "rollout-status-brain",
      kind: "agency",
      status: "active",
      dataClassification: "internal",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  return { workspaceId };
});

const seedValidatedPopulation = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const writer = yield* StatusDatabaseWriter;
    yield* writer
      .table("brainProjectionPopulation")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        populationKey: `bpop_${"4".repeat(64)}`,
        projectionPopulationGeneration: 3,
        subjectBackfillGeneration: 1,
        fenceBackfillGeneration: 1,
        activeRunKey: null,
        activeRunGeneration: 0,
        activePhase: null,
        activeStage: null,
        activeCursor: null,
        activeCorpusKey: null,
        activeConnectorScopeKey: null,
        activeConfigurationDigest: null,
        scanHighWater: null,
        catchUpHighWater: null,
        validationPopulationGeneration: null,
        validationPredecessorDigest: null,
        validationRestartCount: 0,
        scannedSetCount: 2,
        backfilledSetCount: 2,
        validatedSetCount: 2,
        validatedSubjectCount: 2,
        validatedEntryCount: 2,
        validatedTokenCount: 2,
        conflictCount: 0,
        capacityCount: 0,
        legacySubjectBackfillCompletion: {
          runKey: `pbrun_${"5".repeat(64)}`,
          runGeneration: 1,
          subjectBackfillGeneration: 1,
          scanHighWater: now - 2_000,
          catchUpHighWater: now - 1_000,
          populationGeneration: 3,
          populationDigest,
          setCount: 2,
          subjectCount: 2,
          entryCount: 2,
          tokenCount: 2,
          completedAt: now - 500,
          completionDigest,
        },
        currentFenceSetCount: 2,
        retiredFenceSetCount: 0,
        fenceBackfilledSetCount: 2,
        invalidatedFenceSetCount: 0,
        fenceConflictCount: 0,
        legacyEligibilityFenceBackfillCompletion: {
          runKey: `pbrun_${"6".repeat(64)}`,
          runGeneration: 1,
          fenceBackfillGeneration: 1,
          scanHighWater: now - 2_000,
          catchUpHighWater: now - 1_000,
          populationGeneration: 3,
          configurationDigest,
          populationDigest,
          currentSetCount: 2,
          retiredSetCount: 0,
          backfilledSetCount: 2,
          invalidatedSetCount: 0,
          conflictCount: 0,
          completedAt: now - 500,
          completionDigest,
        },
        jobAuthorityMigrationRunKey: null,
        jobAuthorityMigrationRunGeneration: 0,
        jobAuthorityMigrationStage: null,
        jobAuthorityMigrationCursor: null,
        jobAuthorityMigrationConfigurationDigest: null,
        jobAuthorityMigrationScanHighWater: null,
        jobAuthorityMigrationPredecessorDigest: null,
        jobAuthorityMigrationProcessedCount: 0,
        jobAuthorityMigrationReplacementCount: 0,
        jobAuthorityMigrationCompleteAuthorityCount: 0,
        jobAuthorityMigrationTerminalHistoryCount: 0,
        jobAuthorityMigrationConflictCount: 0,
        legacyJobAuthorityMigrationCompletion: null,
        createdAt: now - 3_000,
        updatedAt: now - 500,
      })
      .pipe(Effect.orDie);
  });

type ScopeSeed = {
  readonly digit: string;
  readonly corpusKey: "slack" | "transcripts";
  readonly providerKind: "slack" | "transcript";
};

const scopeValues = ({ digit, corpusKey, providerKind }: ScopeSeed) => ({
  digit,
  corpusKey,
  providerKind,
  connectorScopeKey: `scope_${digit}`,
  connectionKey: `connection_${digit}`,
  requiredScopeIntentKey: `brsi_${digit.repeat(64)}`,
  allowlistGenerationKey: `calg_${digit.repeat(64)}`,
  cursorKey: `ccur_${digit.repeat(64)}`,
  reconciliationRunKey: `crun_${digit.repeat(64)}`,
  ingestionObligationKey: `iobl_${digit.repeat(64)}`,
});

const seedReadyScope = (
  workspaceId: GenericId<"workspaces">,
  seed: ScopeSeed,
  health = true,
) =>
  Effect.gen(function* () {
    const writer = yield* StatusDatabaseWriter;
    const values = scopeValues(seed);
    yield* writer
      .table("connectorScopes")
      .insert({
        schemaVersion: 1,
        organizationKey,
        connectorScopeKey: values.connectorScopeKey,
        providerKind: values.providerKind,
        providerContainerKey: `container_${seed.digit}`,
        connectionKey: values.connectionKey,
        currentConnectionGeneration: 1,
        currentAllowlistGeneration: 1,
        scopeGeneration: 1,
        state: "active",
        createdAt: now - 20_000,
        updatedAt: now - 1_000,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("connectorAllowlistGenerations")
      .insert({
        schemaVersion: 1,
        organizationKey,
        connectorScopeKey: values.connectorScopeKey,
        allowlistGenerationKey: values.allowlistGenerationKey,
        connectionKey: values.connectionKey,
        connectionGeneration: 1,
        allowlistGeneration: 1,
        configurationDigest,
        memberCount: 1,
        state: "current",
        createdAt: now - 20_000,
        supersededAt: null,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("brainRequiredScopeIntents")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        corpusKey: values.corpusKey,
        providerKind: values.providerKind,
        connectorScopeKey: values.connectorScopeKey,
        connectionKey: values.connectionKey,
        connectionGeneration: 1,
        allowlistGeneration: 1,
        requiredScopeIntentKey: values.requiredScopeIntentKey,
        intentGeneration: 1,
        controllingConfigurationDigest: configurationDigest,
        state: "required",
        decommissionGeneration: null,
        activatedAt: now - 20_000,
        decommissionedAt: null,
        updatedAt: now - 1_000,
      })
      .pipe(Effect.orDie);
    const identities = [
      connectionFenceIdentity({
        organizationKey,
        connectionKey: values.connectionKey,
      }),
      connectorScopeFenceIdentity({
        organizationKey,
        connectorScopeKey: values.connectorScopeKey,
      }),
      connectorAllowlistFenceIdentity({
        organizationKey,
        connectorScopeKey: values.connectorScopeKey,
      }),
    ];
    for (const identity of identities)
      yield* writer
        .table("retrievalEligibilityFences")
        .insert({
          schemaVersion: 1,
          organizationKey,
          fenceKey: retrievalEligibilityFenceKey(identity),
          kind: identity.kind,
          controllerKey: identity.controllerKey,
          eligibilityGeneration: 1,
          eligible: true,
          updatedAt: now - 1_000,
        })
        .pipe(Effect.orDie);
    yield* writer
      .table("connectorIncrementalCursors")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        corpusKey: values.corpusKey,
        providerKind: values.providerKind,
        connectorScopeKey: values.connectorScopeKey,
        connectionKey: values.connectionKey,
        connectionGeneration: 1,
        allowlistGeneration: 1,
        cursorKey: values.cursorKey,
        providerCursor: "cursor-current",
        traversalComplete: true,
        cursorGeneration: 1,
        activeEnvelopeKey: null,
        lastProviderHighWater: "provider-current",
        ledgerHighWater: 10,
        createdAt: now - 20_000,
        updatedAt: now - 1_000,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("connectorReconciliationRuns")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        corpusKey: values.corpusKey,
        providerKind: values.providerKind,
        connectorScopeKey: values.connectorScopeKey,
        connectionKey: values.connectionKey,
        connectionGeneration: 1,
        allowlistGeneration: 1,
        reconciliationRunKey: values.reconciliationRunKey,
        runGeneration: 1,
        scopeTupleDigest: configurationDigest,
        status: "complete",
        providerHighWater: "provider-current",
        ledgerHighWater: 10,
        leaseId: `lease_${seed.digit}`,
        leaseGeneration: 1,
        leaseExpiresAt: now + 60_000,
        scanCursor: null,
        removalCursor: null,
        drainCursor: null,
        observedCount: 1,
        obligationCount: 1,
        removalCandidateCount: 0,
        removalRequiredCount: 0,
        removalBacklogCount: 0,
        drainedCount: 0,
        drainBacklogCount: 0,
        blockingObligationCount: 0,
        completionReceipt: {
          providerHighWater: "provider-current",
          ledgerHighWater: 10,
          successfulObligationCount: 1,
          blockingObligationCount: 0,
          completedAt: now - 1_000,
          receiptDigest: completionDigest,
        },
        openedAt: now - 20_000,
        completedAt: now - 1_000,
        updatedAt: now - 1_000,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("ingestionObligations")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        corpusKey: values.corpusKey,
        providerKind: values.providerKind,
        connectorScopeKey: values.connectorScopeKey,
        connectionKey: values.connectionKey,
        connectionGeneration: 1,
        allowlistGeneration: 1,
        ingestionObligationKey: values.ingestionObligationKey,
        requiredScopeIntentKey: values.requiredScopeIntentKey,
        reconciliationRunKey: values.reconciliationRunKey,
        runGeneration: 1,
        cause: "observation",
        membershipKey: `membership_${seed.digit}`,
        originKind: values.corpusKey === "slack" ? "slack" : "transcript",
        originKey: `origin_${seed.digit}`,
        originRevisionKey: `revision_${seed.digit}`,
        ledgerSequence: 1,
        state: "complete",
        targetResolutionIntentKey: null,
        publicationJobKeys: [],
        errorTag: null,
        terminalAt: now - 1_000,
        createdAt: now - 20_000,
        updatedAt: now - 1_000,
      })
      .pipe(Effect.orDie);
    if (health)
      yield* writer
        .table("brainCorpusHealth")
        .insert({
          schemaVersion: 1,
          organizationKey,
          workspaceId,
          brainKey,
          corpusKey: values.corpusKey,
          connectorScopeKey: values.connectorScopeKey,
          connectionGeneration: 1,
          policyGeneration: 1,
          reconciliationGeneration: 1,
          coverageStatus: "complete",
          lastObservedAt: now - 1_000,
          lastPublishedAt: now - 1_000,
          lastReconciledAt: now - 1_000,
          freshnessThresholdMs: 10_000,
          discoveredCount: 1,
          publishedCount: 1,
          failedCount: 0,
          updatedAt: now - 1_000,
        })
        .pipe(Effect.orDie);
    return values;
  });

const seedSlackTargetResolutionIntent = (
  channelKey: string,
  status: "pending" | "retry_wait",
  index: number,
) =>
  Effect.gen(function* () {
    const writer = yield* StatusDatabaseWriter;
    const suffix = index.toString(16).padStart(64, "0");
    const receiptId = yield* writer.table("providerEventReceipts").insert({
      schemaVersion: 1,
      organizationKey,
      connectionKey: "connection_target_resolution_status",
      connectionGeneration: 1,
      channelKey,
      externalChannelId: "external_target_resolution_status",
      transport: "live",
      transportDeliveryId: `delivery_target_resolution_status_${index}`,
      providerEventId: `event_target_resolution_status_${index}`,
      providerObjectId: `message_target_resolution_status_${index}`,
      providerRevisionId: `revision_target_resolution_status_${index}`,
      providerOrder: `${index + 1}`,
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
      observationKey: `observation_target_resolution_status_${index}`,
      sourceKey: `src_target_resolution_status_${index}`,
      sourceRevisionKey: `srev_${suffix}`,
      outcome: "inserted",
      receivedAt: now - index - 1,
      createdAt: now - index - 1,
    });
    yield* writer.table("slackPublicationTargetIntents").insert({
      schemaVersion: 1,
      receiptId,
      organizationKey,
      channelKey,
      sourceRevisionKey: `srev_${suffix}`,
      status,
      attemptCount: status === "retry_wait" ? 1 : 0,
      nextAttemptAt: now,
      lastErrorTag: status === "retry_wait" ? "InjectedRetry" : null,
      resolutionGeneration: 1,
      targetCount: 0,
      completedAt: null,
      createdAt: now - index - 1,
      updatedAt: now - index - 1,
    });
  });

const seedProviderTargetResolutionIntent = (input: {
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly providerKind: "slack" | "transcript";
  readonly corpusKey: "slack" | "transcripts";
  readonly status: "pending" | "retry_wait" | "capacity_blocked";
  readonly digit: string;
}) =>
  Effect.gen(function* () {
    const writer = yield* StatusDatabaseWriter;
    const suffix = input.digit.repeat(64);
    yield* writer.table("providerTargetResolutionIntents").insert({
      schemaVersion: 1,
      authorityKind: "live_capture",
      targetResolutionIntentKey: `trsi_${suffix}`,
      ingestionObligationKey: `iobl_${suffix}`,
      organizationKey,
      corpusKey: input.corpusKey,
      providerKind: input.providerKind,
      connectorScopeKey: input.connectorScopeKey,
      connectionKey: input.connectionKey,
      connectionGeneration: input.connectionGeneration,
      membershipKey: `membership_${input.digit}`,
      originKind: input.providerKind === "slack" ? "slack" : "transcript",
      originKey: `origin_${input.digit}`,
      originRevisionKey: `revision_${input.digit}`,
      captureKey: `capture_${input.digit}`,
      capturedAt: now - 2_000,
      observationDigest: `sha256:${"a".repeat(64)}`,
      resolutionGeneration: 1,
      authorityDigest: `sha256:${"b".repeat(64)}`,
      status: input.status,
      attemptCount: input.status === "pending" ? 0 : 1,
      nextAttemptAt: now,
      lastErrorTag:
        input.status === "capacity_blocked" ? "InjectedCapacity" : null,
      targetCount: 0,
      targetDigest: null,
      targets: [],
      completedAt: null,
      createdAt: now - 2_000,
      updatedAt: now - 1_000,
    });
  });

const clearScopeIncident = (
  workspaceId: GenericId<"workspaces">,
  values: ReturnType<typeof scopeValues>,
) =>
  Effect.gen(function* () {
    const reader = yield* StatusDatabaseReader;
    const writer = yield* StatusDatabaseWriter;
    const connector = yield* reader
      .table("connectorScopes")
      .index("by_connector_scope_key", (query) =>
        query.eq("connectorScopeKey", values.connectorScopeKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
    const allowlist = yield* reader
      .table("connectorAllowlistGenerations")
      .index("by_scope_generation", (query) =>
        query
          .eq("connectorScopeKey", values.connectorScopeKey)
          .eq("allowlistGeneration", 1),
      )
      .first()
      .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
    const health = yield* reader
      .table("brainCorpusHealth")
      .index("by_workspace_brain_corpus_scope", (query) =>
        query
          .eq("workspaceId", workspaceId)
          .eq("brainKey", brainKey)
          .eq("corpusKey", values.corpusKey)
          .eq("connectorScopeKey", values.connectorScopeKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
    const run = yield* reader
      .table("connectorReconciliationRuns")
      .index("by_reconciliation_run_key", (query) =>
        query.eq("reconciliationRunKey", values.reconciliationRunKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
    const cursor = yield* reader
      .table("connectorIncrementalCursors")
      .index("by_cursor_key", (query) =>
        query.eq("cursorKey", values.cursorKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
    const obligations = yield* reader
      .table("ingestionObligations")
      .index("by_required_intent_state", (query) =>
        query.eq("requiredScopeIntentKey", values.requiredScopeIntentKey),
      )
      .take(20)
      .pipe(Effect.orDie);
    const jobs = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_workspace_brain_job", (query) =>
        query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
      )
      .take(20)
      .pipe(Effect.orDie);
    const pause = yield* reader
      .table("brainPublicationPauses")
      .index("by_workspace_brain_scope", (query) =>
        query
          .eq("workspaceId", workspaceId)
          .eq("brainKey", brainKey)
          .eq("scopeKey", values.connectorScopeKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
    yield* writer
      .table("connectorScopes")
      .patch(connector._id, { state: "active", updatedAt: now })
      .pipe(Effect.orDie);
    yield* writer
      .table("connectorAllowlistGenerations")
      .patch(allowlist._id, { configurationDigest })
      .pipe(Effect.orDie);
    yield* writer
      .table("brainCorpusHealth")
      .patch(health._id, {
        coverageStatus: "complete",
        lastObservedAt: now,
        lastReconciledAt: now,
        failedCount: 0,
        degradedReason: undefined,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("connectorReconciliationRuns")
      .patch(run._id, {
        status: "complete",
        obligationCount: obligations.length,
        blockingObligationCount: 0,
        completionReceipt: {
          providerHighWater: "provider-current",
          ledgerHighWater: run.ledgerHighWater,
          successfulObligationCount: obligations.length,
          blockingObligationCount: 0,
          completedAt: now,
          receiptDigest: completionDigest,
        },
        completedAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("connectorIncrementalCursors")
      .patch(cursor._id, { traversalComplete: true, updatedAt: now })
      .pipe(Effect.orDie);
    for (const obligation of obligations)
      yield* writer
        .table("ingestionObligations")
        .patch(obligation._id, {
          state: "complete",
          errorTag: null,
          terminalAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    for (const job of jobs.filter(
      (job) =>
        job.authorityEnvelope?.connectorScopeKey === values.connectorScopeKey,
    ))
      yield* writer
        .table("retrievalPublicationJobs")
        .patch(job._id, {
          status: "succeeded",
          lastErrorTag: undefined,
          completedAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    yield* writer
      .table("brainPublicationPauses")
      .patch(pause._id, {
        state: "running",
        reason: null,
        resumedAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
  });

describe("Brain rollout status", () => {
  it("registers one internal typed status operation", () => {
    expect(rolloutStatus.functions.getBrainRolloutStatus).toMatchObject({
      functionVisibility: "internal",
    });
  });

  it("fails explicitly at the bounded required-scope capacity", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof statusDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedWorkspace,
          resultSchema(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* StatusDatabaseWriter;
            for (let index = 0; index < 11; index += 1) {
              const suffix = index.toString(16).padStart(64, "0");
              yield* writer
                .table("brainRequiredScopeIntents")
                .insert({
                  schemaVersion: 1,
                  organizationKey,
                  workspaceId,
                  brainKey,
                  corpusKey: "slack",
                  providerKind: "slack",
                  connectorScopeKey: `scope_capacity_${index}`,
                  connectionKey: `connection_capacity_${index}`,
                  connectionGeneration: 1,
                  allowlistGeneration: 1,
                  requiredScopeIntentKey: `brsi_${suffix}`,
                  intentGeneration: 1,
                  controllingConfigurationDigest: configurationDigest,
                  state: "required",
                  decommissionGeneration: null,
                  activatedAt: now,
                  decommissionedAt: null,
                  updatedAt: now,
                })
                .pipe(Effect.orDie);
            }
          }),
          resultSchema(),
        );
        return yield* confect
          .query(statusRef, {
            organizationKey,
            workspaceId,
            brainKey,
            now,
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(statusTestLayer())),
    );

    expect(error).toBeInstanceOf(RolloutStatusCapacityExceeded);
    expect(error).toMatchObject({
      resource: "required_scopes",
      limit: 10,
      observedAtLeast: 11,
    });
  });

  it("ignores unresolved job capacity from another tenant", async () => {
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof statusDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedWorkspace,
          resultSchema(),
        );
        yield* confect.run(
          seedValidatedPopulation(workspaceId),
          resultSchema(),
        );
        yield* confect.run(
          seedReadyScope(workspaceId, {
            digit: "d",
            corpusKey: "slack",
            providerKind: "slack",
          }),
          resultSchema(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* StatusDatabaseWriter;
            const unrelatedOrganizationKey = "ag_unrelated_rollout_status";
            const unrelatedBrainKey = "br_unrelated_rollout_status";
            const unrelatedUserId = yield* writer.table("users").insert({
              subject: "unrelated-rollout-status-owner",
              email: "unrelated-rollout-status-owner@example.com",
              status: "active",
              createdAt: now,
              updatedAt: now,
            });
            const unrelatedOrganizationId = yield* writer
              .table("organizations")
              .insert({
                ownerUserId: unrelatedUserId,
                workosOrganizationId: "org_unrelated_rollout_status",
                agencyKey: unrelatedOrganizationKey,
                slug: "unrelated-rollout-status",
                name: "Unrelated Rollout Status",
                status: "active",
                createdAt: now,
                updatedAt: now,
              });
            const unrelatedWorkspaceId = yield* writer
              .table("workspaces")
              .insert({
                organizationId: unrelatedOrganizationId,
                ownerUserId: unrelatedUserId,
                brainKey: unrelatedBrainKey,
                name: "Unrelated Rollout Status Brain",
                slug: "unrelated-rollout-status-brain",
                kind: "agency",
                status: "active",
                dataClassification: "internal",
                createdAt: now,
                updatedAt: now,
              });
            for (let index = 0; index < 201; index += 1) {
              const sourceRevisionKey = `unrelated_revision_${index}`;
              const job = retrievalPublicationJobRow(
                {
                  organizationKey: unrelatedOrganizationKey,
                  workspaceId: String(unrelatedWorkspaceId),
                  brainKey: unrelatedBrainKey,
                  originKind: "slack",
                  sourceKey: `unrelated_job_${index}`,
                  sourceRevisionKey,
                  requestGeneration: 1,
                  authorityContext: {
                    version: 1,
                    connectorScopeKey: "scope_unrelated",
                    configuration: { requestGeneration: 1 },
                    eligibilityFences: [],
                    observationFence: {
                      kind: "revision",
                      key: sourceRevisionKey,
                    },
                  },
                },
                now - 2_000,
              );
              yield* writer.table("retrievalPublicationJobs").insert({
                ...job,
                workspaceId: unrelatedWorkspaceId,
              });
            }
          }),
          resultSchema(),
        );
        return yield* confect.query(statusRef, {
          organizationKey,
          workspaceId,
          brainKey,
          now,
        });
      }).pipe(Effect.provide(statusTestLayer())),
    );

    expect(status).toMatchObject({
      readiness: "ready",
      promotionReady: true,
      alerts: [],
      scopes: [
        {
          readiness: "ready",
          publication: { unresolvedCount: 0, truncated: false },
          blockers: [],
        },
      ],
    });
  });

  it("blocks bounded pending and retrying Slack target resolution for the required channel", async () => {
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof statusDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedWorkspace,
          resultSchema(),
        );
        yield* confect.run(
          seedValidatedPopulation(workspaceId),
          resultSchema(),
        );
        const scope = yield* confect.run(
          seedReadyScope(workspaceId, {
            digit: "7",
            corpusKey: "slack",
            providerKind: "slack",
          }),
          resultSchema(),
        );
        for (let index = 0; index < 51; index += 1)
          yield* confect.run(
            seedSlackTargetResolutionIntent(
              scope.connectorScopeKey,
              "pending",
              1_000 + index,
            ),
            resultSchema(),
          );
        yield* confect.run(
          seedSlackTargetResolutionIntent(
            scope.connectorScopeKey,
            "retry_wait",
            2_000,
          ),
          resultSchema(),
        );
        yield* confect.run(
          seedSlackTargetResolutionIntent(
            "scope_unrelated_target_resolution",
            "pending",
            3_000,
          ),
          resultSchema(),
        );
        return yield* confect.query(statusRef, {
          organizationKey,
          workspaceId,
          brainKey,
          now,
        });
      }).pipe(Effect.provide(statusTestLayer())),
    );

    expect(status).toMatchObject({
      readiness: "blocked",
      promotionReady: false,
      scopes: [
        {
          targetResolution: {
            counts: [
              { state: "pending", count: 50, truncated: true },
              { state: "retry_wait", count: 1, truncated: false },
              { state: "capacity_blocked", count: 0, truncated: false },
              { state: "integrity_failure", count: 0, truncated: false },
            ],
            unresolvedCount: 51,
            truncated: true,
          },
          blockers: expect.arrayContaining([
            "target_resolution_intents_unresolved",
            "bounded_scan_overflow",
          ]),
        },
      ],
    });
  });

  it("blocks every matching Brain scope on a provider-neutral live parent", async () => {
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof statusDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedWorkspace,
          resultSchema(),
        );
        yield* confect.run(
          seedValidatedPopulation(workspaceId),
          resultSchema(),
        );
        const scope = yield* confect.run(
          seedReadyScope(workspaceId, {
            digit: "6",
            corpusKey: "transcripts",
            providerKind: "transcript",
          }),
          resultSchema(),
        );
        yield* confect.run(
          seedProviderTargetResolutionIntent({
            connectorScopeKey: scope.connectorScopeKey,
            connectionKey: scope.connectionKey,
            connectionGeneration: 1,
            providerKind: "transcript",
            corpusKey: "transcripts",
            status: "capacity_blocked",
            digit: "9",
          }),
          resultSchema(),
        );
        return yield* confect.query(statusRef, {
          organizationKey,
          workspaceId,
          brainKey,
          now,
        });
      }).pipe(Effect.provide(statusTestLayer())),
    );

    expect(status).toMatchObject({
      readiness: "blocked",
      promotionReady: false,
      scopes: [
        {
          targetResolution: {
            counts: expect.arrayContaining([
              {
                state: "capacity_blocked",
                count: 1,
                truncated: false,
              },
            ]),
            unresolvedCount: 1,
          },
          blockers: expect.arrayContaining([
            "target_resolution_intents_unresolved",
          ]),
        },
      ],
    });
  });

  it("ignores terminal history while evaluating unresolved and current-run rollout state", async () => {
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof statusDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedWorkspace,
          resultSchema(),
        );
        yield* confect.run(
          seedValidatedPopulation(workspaceId),
          resultSchema(),
        );
        const scope = yield* confect.run(
          seedReadyScope(workspaceId, {
            digit: "e",
            corpusKey: "slack",
            providerKind: "slack",
          }),
          resultSchema(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* StatusDatabaseReader;
            const writer = yield* StatusDatabaseWriter;
            const historicalRun = yield* reader
              .table("connectorReconciliationRuns")
              .index("by_reconciliation_run_key", (query) =>
                query.eq("reconciliationRunKey", scope.reconciliationRunKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            const historicalObligation = yield* reader
              .table("ingestionObligations")
              .index("by_ingestion_obligation_key", (query) =>
                query.eq(
                  "ingestionObligationKey",
                  scope.ingestionObligationKey,
                ),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            const health = yield* reader
              .table("brainCorpusHealth")
              .index("by_workspace_brain_corpus_scope", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("corpusKey", scope.corpusKey)
                  .eq("connectorScopeKey", scope.connectorScopeKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            for (let index = 0; index < 50; index += 1) {
              const suffix = (index + 2).toString(16).padStart(64, "0");
              const reconciliationRunKey = `crun_${suffix}`;
              yield* writer.table("connectorReconciliationRuns").insert({
                ...historicalRun,
                _id: undefined,
                _creationTime: undefined,
                reconciliationRunKey,
                runGeneration: index + 2,
                status: "superseded",
                completionReceipt: null,
                completedAt: now - 2_000,
                updatedAt: now - 2_000,
              } as never);
              yield* writer.table("ingestionObligations").insert({
                ...historicalObligation,
                _id: undefined,
                _creationTime: undefined,
                ingestionObligationKey: `iobl_${suffix}`,
                reconciliationRunKey,
                runGeneration: index + 2,
                membershipKey: `membership_history_${index}`,
                originKey: `origin_history_${index}`,
                originRevisionKey: `revision_history_${index}`,
                ledgerSequence: index + 2,
                createdAt: now - 2_000,
                terminalAt: now - 2_000,
                updatedAt: now - 2_000,
              } as never);
            }
            for (let index = 0; index < 201; index += 1) {
              const job = retrievalPublicationJobRow(
                {
                  organizationKey,
                  workspaceId: String(workspaceId),
                  brainKey,
                  originKind: "slack",
                  sourceKey: `terminal_job_${index}`,
                  sourceRevisionKey: `terminal_revision_${index}`,
                  requestGeneration: 1,
                  authorityContext: {
                    version: 1,
                    connectorScopeKey: scope.connectorScopeKey,
                    configuration: { requestGeneration: 1 },
                    eligibilityFences: [],
                    observationFence: {
                      kind: "revision",
                      key: `terminal_revision_${index}`,
                    },
                  },
                },
                now - 2_000,
              );
              yield* writer.table("retrievalPublicationJobs").insert({
                ...job,
                workspaceId,
                status: "succeeded",
                completedAt: now - 1_500,
                updatedAt: now - 1_500,
              });
            }
            for (let index = 0; index < 41; index += 1) {
              const suffix = (index + 500).toString(16).padStart(64, "0");
              yield* writer.table("retrievalRebuildRuns").insert({
                schemaVersion: 1,
                rebuildRunKey: `rrun_${suffix}`,
                rebuildScopeKey: `rscope_history_${index}`,
                organizationKey,
                workspaceId,
                brainKey,
                corpusKey: scope.corpusKey,
                originKind: "slack_rebuild",
                scopeKind: "connector_scope",
                scopeValue: scope.connectorScopeKey,
                connectorScopeKey: scope.connectorScopeKey,
                triggerSourceKey: `trigger_history_${index}`,
                triggerRevisionKey: `trigger_revision_history_${index}`,
                runGeneration: index + 1,
                configuration: { requestGeneration: 1 },
                configurationDigest,
                eligibilityFences: [],
                runAuthorityDigest: configurationDigest,
                ledgerHighWater: 0,
                pauseEpoch: 0,
                rootPredecessorDigest: populationDigest,
                openedAt: now - 3_000,
                status: "superseded",
                headDigest: completionDigest,
                emittedChildCount: 0,
                terminalChildCount: 0,
                blockingChildCount: 0,
                publishedChildCount: 0,
                revokedChildCount: 0,
                supersededChildCount: 0,
                updatedAt: now - 2_000,
              });
            }
            const currentRunKey = `crun_${"f".repeat(64)}`;
            yield* writer.table("connectorReconciliationRuns").insert({
              ...historicalRun,
              _id: undefined,
              _creationTime: undefined,
              reconciliationRunKey: currentRunKey,
              runGeneration: 100,
              openedAt: now - 500,
              completedAt: now,
              updatedAt: now,
            } as never);
            yield* writer.table("ingestionObligations").insert({
              ...historicalObligation,
              _id: undefined,
              _creationTime: undefined,
              ingestionObligationKey: `iobl_${"f".repeat(64)}`,
              reconciliationRunKey: currentRunKey,
              runGeneration: 100,
              createdAt: now - 500,
              terminalAt: now,
              updatedAt: now,
            } as never);
            yield* writer
              .table("brainCorpusHealth")
              .patch(health._id, {
                reconciliationGeneration: 100,
                lastReconciledAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        return yield* confect.query(statusRef, {
          organizationKey,
          workspaceId,
          brainKey,
          now,
        });
      }).pipe(Effect.provide(statusTestLayer())),
    );

    expect(status).toMatchObject({
      readiness: "ready",
      promotionReady: true,
      alerts: [],
      scopes: [
        {
          readiness: "ready",
          reconciliation: {
            runGeneration: 100,
            status: "complete",
            truncated: false,
          },
          rebuild: { runKey: null, truncated: false },
          obligations: {
            counts: expect.arrayContaining([
              { state: "complete", count: 1, truncated: false },
            ]),
            truncated: false,
          },
          publication: {
            counts: expect.arrayContaining([
              { state: "succeeded", count: 0, truncated: false },
            ]),
            unresolvedCount: 0,
            truncated: false,
          },
          blockers: [],
        },
      ],
    });
  });

  it("keeps freshness separate from scoped readiness and fires then clears redacted alerts", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof statusDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedWorkspace,
          resultSchema(),
        );
        yield* confect.run(
          seedValidatedPopulation(workspaceId),
          resultSchema(),
        );
        const firstScope = yield* confect.run(
          seedReadyScope(workspaceId, {
            digit: "a",
            corpusKey: "slack",
            providerKind: "slack",
          }),
          resultSchema(),
        );
        const secondScope = yield* confect.run(
          seedReadyScope(workspaceId, {
            digit: "b",
            corpusKey: "transcripts",
            providerKind: "transcript",
          }),
          resultSchema(),
        );
        const ready = yield* confect.query(statusRef, {
          organizationKey,
          workspaceId,
          brainKey,
          now,
        });
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* StatusDatabaseWriter;
            const reader = yield* StatusDatabaseReader;
            const health = yield* reader
              .table("brainCorpusHealth")
              .index("by_workspace_brain_corpus_scope", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("corpusKey", "transcripts")
                  .eq("connectorScopeKey", secondScope.connectorScopeKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            yield* writer
              .table("brainCorpusHealth")
              .patch(health._id, {
                coverageStatus: "partial",
                lastObservedAt: now - 1,
                degradedReason: "Publication integrity failure.",
                failedCount: 1,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const freshButPartial = yield* confect.query(statusRef, {
          organizationKey,
          workspaceId,
          brainKey,
          now,
        });
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* StatusDatabaseWriter;
            const reader = yield* StatusDatabaseReader;
            const connector = yield* reader
              .table("connectorScopes")
              .index("by_connector_scope_key", (query) =>
                query.eq("connectorScopeKey", secondScope.connectorScopeKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            const allowlist = yield* reader
              .table("connectorAllowlistGenerations")
              .index("by_scope_generation", (query) =>
                query
                  .eq("connectorScopeKey", secondScope.connectorScopeKey)
                  .eq("allowlistGeneration", 1),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            const health = yield* reader
              .table("brainCorpusHealth")
              .index("by_workspace_brain_corpus_scope", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("corpusKey", "transcripts")
                  .eq("connectorScopeKey", secondScope.connectorScopeKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            const run = yield* reader
              .table("connectorReconciliationRuns")
              .index("by_reconciliation_run_key", (query) =>
                query.eq(
                  "reconciliationRunKey",
                  secondScope.reconciliationRunKey,
                ),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            const cursor = yield* reader
              .table("connectorIncrementalCursors")
              .index("by_cursor_key", (query) =>
                query.eq("cursorKey", secondScope.cursorKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            const obligation = yield* reader
              .table("ingestionObligations")
              .index("by_ingestion_obligation_key", (query) =>
                query.eq(
                  "ingestionObligationKey",
                  secondScope.ingestionObligationKey,
                ),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            yield* writer
              .table("connectorScopes")
              .patch(connector._id, { state: "revoked", updatedAt: now })
              .pipe(Effect.orDie);
            yield* writer
              .table("connectorAllowlistGenerations")
              .patch(allowlist._id, {
                configurationDigest: `sha256:${"9".repeat(64)}`,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("brainCorpusHealth")
              .patch(health._id, { lastObservedAt: now - 20_000 })
              .pipe(Effect.orDie);
            yield* writer
              .table("connectorReconciliationRuns")
              .patch(run._id, {
                status: "blocked",
                completionReceipt: null,
                completedAt: null,
                blockingObligationCount: 2,
                updatedAt: now - 20_000,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("connectorIncrementalCursors")
              .patch(cursor._id, {
                traversalComplete: false,
                updatedAt: now - 20_000,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("ingestionObligations")
              .patch(obligation._id, {
                state: "quarantined",
                terminalAt: null,
                updatedAt: now - 20_000,
              })
              .pipe(Effect.orDie);
            yield* writer.table("ingestionObligations").insert({
              ...obligation,
              _id: undefined,
              _creationTime: undefined,
              ingestionObligationKey: `iobl_${"c".repeat(64)}`,
              membershipKey: "membership_capacity",
              originKey: "origin_capacity",
              originRevisionKey: "revision_capacity",
              ledgerSequence: 2,
              state: "capacity_blocked",
              createdAt: now - 20_000,
              updatedAt: now - 20_000,
            } as never);
            const deadLetterRow = retrievalPublicationJobRow(
              {
                organizationKey,
                workspaceId: String(workspaceId),
                brainKey,
                originKind: "transcript",
                sourceKey: "unit_dead_letter",
                sourceRevisionKey: "revision_dead_letter",
                requestGeneration: 1,
                authorityContext: {
                  version: 1,
                  connectorScopeKey: secondScope.connectorScopeKey,
                  configuration: {
                    requestGeneration: 1,
                    connectionGeneration: 1,
                  },
                  eligibilityFences: [],
                  observationFence: {
                    kind: "revision",
                    key: "revision_dead_letter",
                  },
                },
              },
              now - 20_000,
            );
            yield* writer.table("retrievalPublicationJobs").insert({
              ...deadLetterRow,
              workspaceId,
              status: "dead_letter",
              attemptCount: 5,
              lastErrorTag: "PublicationDeadLetter",
              completedAt: now - 10_000,
            });
            const integrityRow = retrievalPublicationJobRow(
              {
                organizationKey,
                workspaceId: String(workspaceId),
                brainKey,
                originKind: "transcript",
                sourceKey: "unit_integrity",
                sourceRevisionKey: "revision_integrity",
                requestGeneration: 1,
                authorityContext: {
                  version: 1,
                  connectorScopeKey: secondScope.connectorScopeKey,
                  configuration: {
                    requestGeneration: 1,
                    connectionGeneration: 1,
                  },
                  eligibilityFences: [],
                  observationFence: {
                    kind: "revision",
                    key: "revision_integrity",
                  },
                },
              },
              now - 20_000,
            );
            yield* writer.table("retrievalPublicationJobs").insert({
              ...integrityRow,
              workspaceId,
              status: "integrity_failure",
              lastErrorTag: "PublicationManifestHashMismatch",
              completedAt: now - 10_000,
            });
            yield* writer.table("brainPublicationPauses").insert({
              schemaVersion: 1,
              organizationKey,
              workspaceId,
              brainKey,
              scopeKey: secondScope.connectorScopeKey,
              pauseKey: publicationPauseKey({
                organizationKey,
                workspaceId,
                brainKey,
                scopeKey: secondScope.connectorScopeKey,
              }),
              pauseEpoch: 2,
              state: "paused",
              reason: "incident",
              pausedAt: now - 5_000,
              resumedAt: null,
              updatedAt: now - 5_000,
            });
          }),
          resultSchema(),
        );
        const incident = yield* confect.query(statusRef, {
          organizationKey,
          workspaceId,
          brainKey,
          now,
        });
        yield* confect.run(
          clearScopeIncident(workspaceId, secondScope),
          resultSchema(),
        );
        const cleared = yield* confect.query(statusRef, {
          organizationKey,
          workspaceId,
          brainKey,
          now,
        });
        return {
          ready,
          freshButPartial,
          incident,
          cleared,
          firstScope,
          secondScope,
        };
      }).pipe(Effect.provide(statusTestLayer())),
    );

    expect(result.ready).toMatchObject({
      freshness: "current",
      coverageStatus: "complete",
      readiness: "ready",
      promotionReady: true,
      alerts: [],
    });
    const freshButPartial = result.freshButPartial.scopes.find(
      ({ connectorScopeKey }) =>
        connectorScopeKey === result.secondScope.connectorScopeKey,
    );
    expect(freshButPartial).toMatchObject({
      freshness: "current",
      coverageStatus: "partial",
      readiness: "blocked",
    });
    const unaffected = result.incident.scopes.find(
      ({ connectorScopeKey }) =>
        connectorScopeKey === result.firstScope.connectorScopeKey,
    );
    const affected = result.incident.scopes.find(
      ({ connectorScopeKey }) =>
        connectorScopeKey === result.secondScope.connectorScopeKey,
    );
    expect(unaffected).toMatchObject({ readiness: "ready" });
    expect(affected).toMatchObject({
      freshness: "stale",
      coverageStatus: "partial",
      readiness: "blocked",
      configuration: { connectorState: "revoked", tupleMatches: false },
      obligations: { nonterminalCount: 2 },
      publication: {
        unresolvedCount: 2,
        deadLetters: [
          expect.objectContaining({ lastErrorTag: "PublicationDeadLetter" }),
        ],
      },
      workers: { state: "paused", pauseEpoch: 2 },
    });
    expect(affected?.blockers).toEqual(
      expect.arrayContaining([
        "freshness_stale",
        "coverage_incomplete",
        "configuration_mismatch",
        "scope_revoked",
        "eligibility_integrity_failure",
        "reconciliation_incomplete",
        "obligations_nonterminal",
        "publication_jobs_unresolved",
        "dead_letter",
        "quarantine",
        "cursor_stalled",
        "workers_paused",
        "capacity_failure",
        "publication_integrity_failure",
      ]),
    );
    expect(result.incident.alerts.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "freshness_breach",
        "reconciliation_breach",
        "oldest_obligation_breach",
        "dead_letter",
        "quarantine",
        "stalled_cursor",
        "integrity_failure",
        "retrieval_capacity_overflow",
      ]),
    );
    expect(JSON.stringify(result.incident.alerts)).not.toContain(
      "revision_dead_letter",
    );
    expect(result.cleared).toMatchObject({
      freshness: "current",
      coverageStatus: "complete",
      readiness: "ready",
      promotionReady: true,
      alerts: [],
    });
  });

  it("outer-joins a required scope with no health row as unavailable", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof statusDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedWorkspace,
          resultSchema(),
        );
        yield* confect.run(
          seedValidatedPopulation(workspaceId),
          resultSchema(),
        );
        const scope = yield* confect.run(
          seedReadyScope(
            workspaceId,
            {
              digit: "d",
              corpusKey: "slack",
              providerKind: "slack",
            },
            false,
          ),
          resultSchema(),
        );
        const status = yield* confect.query(statusRef, {
          organizationKey,
          workspaceId,
          brainKey,
          now,
        });
        return { scope, status };
      }).pipe(Effect.provide(statusTestLayer())),
    );

    expect(result.status.scopes).toEqual([
      expect.objectContaining({
        connectorScopeKey: result.scope.connectorScopeKey,
        freshness: "unknown",
        coverageStatus: "unavailable",
        readiness: "blocked",
        blockers: expect.arrayContaining([
          "missing_health",
          "freshness_unknown",
        ]),
      }),
    ]);
  });
});
