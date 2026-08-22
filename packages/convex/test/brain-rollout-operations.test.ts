import { Ref } from "@confect/core";
import {
  DatabaseSchema,
  DatabaseReader,
  DatabaseWriter,
  RegisteredConvexFunction,
  RegisteredFunctions,
} from "@confect/server";
import { TestConfect } from "@confect/test";
import type { GenericId, Value } from "convex/values";
import { defineSchema } from "convex/server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import {
  inspectPublicationIntegrity,
  publicationCitationInvalidationReceipt,
  publicationManifestHash,
} from "../confect/brain/publicationIntegrity";
import readApiImpl from "../confect/brain/readApi.impl";
import readApi, {
  headlessAnswersAsk,
  headlessContextGet,
  headlessSourcesGet,
  headlessSourcesSearch,
  manifest as readManifest,
  sourcesSearch,
  validationContextGet,
  validationSourcesGet,
  validationSourcesSearch,
} from "../confect/brain/readApi.spec";
import {
  enqueueRetrievalPublicationJobEffect,
  publishPageRevisionEffect,
  runPublicationJobEffect,
} from "../confect/brain/retrievalPublication.impl";
import {
  connectionFenceIdentity,
  connectorAllowlistFenceIdentity,
  connectorScopeFenceIdentity,
  pageLifecycleFenceIdentity,
  transitionEligibilityFenceEffect,
} from "../confect/brain/retrievalEligibility";
import {
  retrievalEligibilityFenceKey,
  retrievalPublicationSubjectKey,
} from "../confect/brain/retrievalPublication";
import { retrievalTokenCatalogProjection } from "../confect/brain/retrievalTokenCatalog";
import { publicationPauseKey } from "../confect/brain/publicationWorkerControl";
import rolloutOperationsImpl, {
  advanceProjectionPopulationEffect,
  projectionValidationReceiptDigest,
} from "../confect/brain/rolloutOperations.impl";
import rolloutOperations, {
  backfillTranscriptRevisionOrder,
  decommissionRequiredScope,
  drainPublicationWorkerLeases,
  getPublicationWorkerLeaseStatus,
  migrateLegacyPublicationJobAuthority,
  pausePublicationWorkers,
  quarantineIngestionObligation,
  repairIngestionObligation,
  repairPublicationDeadLetter,
  rollbackBrainReadMode,
  resumePublicationWorkers,
  resumeLegacyPublicationJobAuthorityMigration,
  resumeProjectionBackfill,
  resumeTranscriptRevisionOrderBackfill,
  startProjectionBackfill,
  switchBrainReadMode,
  validateBrainProjectionReadiness,
} from "../confect/brain/rolloutOperations.spec";
import { buildCallSourceUnitRows } from "../confect/sources/sourceUnit";
import { TRANSCRIPT_ADAPTER_ORDER_VERSION } from "../confect/sources/transcriptRevisionOrder";
import transcriptRevisionOrderMigrationItemsSource from "../confect/tables/transcriptRevisionOrderMigrationItems";
import transcriptRevisionOrderMigrationsSource from "../confect/tables/transcriptRevisionOrderMigrations";
import brainProjectionPopulationSource, {
  BrainProjectionPopulationRow,
} from "../confect/tables/brainProjectionPopulation";
import brainProjectionValidationReceiptsSource, {
  BrainProjectionValidationReceiptRow,
} from "../confect/tables/brainProjectionValidationReceipts";
import brainOperationReceiptsSource from "../confect/tables/brainOperationReceipts";
import brainPublicationPausesSource from "../confect/tables/brainPublicationPauses";
import brainPublicationWorkerLeasesSource from "../confect/tables/brainPublicationWorkerLeases";
import ingestionObligationRepairEffectsSource from "../confect/tables/ingestionObligationRepairEffects";
import brainReadModesSource, {
  BrainReadModeRow,
} from "../confect/tables/brainReadModes";
import connectorAllowlistGenerationsSource, {
  ConnectorAllowlistGenerationRow,
} from "../confect/tables/connectorAllowlistGenerations";
import connectorScopesSource, {
  ConnectorScopeRow,
} from "../confect/tables/connectorScopes";
import { templateHttpRoutes } from "../confect/http";

const now = 1_787_286_400_000;
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";
const organizationKey = `ag_${brainKey.slice(3)}`;
const pageKey = "pag_rollout_context";
const revisionKey = "rev_rollout_context_1";
const secondRevisionKey = "rev_rollout_context_2";
const legacyPublicationSetKey = `rset_${"1".repeat(64)}`;
const legacyEntryKey = `rent_${"2".repeat(64)}`;
const legacyPassageKey = `rpass_${"3".repeat(64)}`;
const legacyPendingJobKey = `rjob_${"b".repeat(64)}`;
const legacySucceededJobKey = `rjob_${"c".repeat(64)}`;
const emptyDigest = `sha256:${"0".repeat(64)}`;
const configurationDigest = `sha256:${"4".repeat(64)}`;
const restoredConfigurationDigest = `sha256:${"9".repeat(64)}`;
const operatorScopeKey = "scope_operator_recovery";
const requiredScopeIntentKey = `brsi_${"d".repeat(64)}`;
const reconciliationRunKey = `crun_${"e".repeat(64)}`;
const operationKey = (digit: string) => `bop_${digit.repeat(64)}`;

const brainReadModes = brainReadModesSource("brainReadModes");
const brainProjectionPopulation = brainProjectionPopulationSource(
  "brainProjectionPopulation",
);
const brainProjectionValidationReceipts =
  brainProjectionValidationReceiptsSource("brainProjectionValidationReceipts");
const connectorScopes = connectorScopesSource("connectorScopes");
const connectorAllowlistGenerations = connectorAllowlistGenerationsSource(
  "connectorAllowlistGenerations",
);
const brainOperationReceipts = brainOperationReceiptsSource(
  "brainOperationReceipts",
);
const brainPublicationPauses = brainPublicationPausesSource(
  "brainPublicationPauses",
);
const brainPublicationWorkerLeases = brainPublicationWorkerLeasesSource(
  "brainPublicationWorkerLeases",
);
const ingestionObligationRepairEffects = ingestionObligationRepairEffectsSource(
  "ingestionObligationRepairEffects",
);
const transcriptRevisionOrderMigrationItems =
  transcriptRevisionOrderMigrationItemsSource(
    "transcriptRevisionOrderMigrationItems",
  );
const transcriptRevisionOrderMigrations =
  transcriptRevisionOrderMigrationsSource("transcriptRevisionOrderMigrations");
const rolloutDatabaseSchema = DatabaseSchema.make({
  ...databaseSchema.tables,
  brainReadModes,
  brainProjectionPopulation,
  brainProjectionValidationReceipts,
  connectorScopes,
  connectorAllowlistGenerations,
  brainOperationReceipts,
  brainPublicationPauses,
  brainPublicationWorkerLeases,
  ingestionObligationRepairEffects,
});
const rolloutConvexSchema = defineSchema({
  ...Object.fromEntries(
    Object.entries(databaseSchema.tables).map(([name, table]) => [
      name,
      table.tableDefinition,
    ]),
  ),
  brainReadModes: brainReadModes.tableDefinition,
  brainProjectionPopulation: brainProjectionPopulation.tableDefinition,
  brainProjectionValidationReceipts:
    brainProjectionValidationReceipts.tableDefinition,
  connectorScopes: connectorScopes.tableDefinition,
  connectorAllowlistGenerations: connectorAllowlistGenerations.tableDefinition,
  brainOperationReceipts: brainOperationReceipts.tableDefinition,
  brainPublicationPauses: brainPublicationPauses.tableDefinition,
  brainPublicationWorkerLeases: brainPublicationWorkerLeases.tableDefinition,
  ingestionObligationRepairEffects:
    ingestionObligationRepairEffects.tableDefinition,
});
const rolloutRegisteredFunctions = RegisteredFunctions.buildForGroup<
  typeof readApi
>(rolloutDatabaseSchema, readApiImpl, RegisteredConvexFunction.make);
const rolloutOperationsRegisteredFunctions = RegisteredFunctions.buildForGroup<
  typeof rolloutOperations
>(rolloutDatabaseSchema, rolloutOperationsImpl, RegisteredConvexFunction.make);
const rolloutTestLayer = TestConfect.layer(
  rolloutDatabaseSchema,
  rolloutConvexSchema,
  {
    ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
    "../convex/brain/readApi.ts": async () => rolloutRegisteredFunctions,
    "../convex/brain/rolloutOperations.ts": async () =>
      rolloutOperationsRegisteredFunctions,
  },
);

const RolloutDatabaseWriter =
  DatabaseWriter.DatabaseWriter<typeof rolloutDatabaseSchema>();
const RolloutDatabaseReader =
  DatabaseReader.DatabaseReader<typeof rolloutDatabaseSchema>();
const resultSchema = <Result>(): Schema.Schema<Result, Value> =>
  Schema.Any as unknown as Schema.Schema<Result, Value>;

const refs = {
  publicSourcesSearch: Ref.make("brain/readApi", sourcesSearch.spec),
  headlessSourcesSearch: Ref.make("brain/readApi", headlessSourcesSearch),
  headlessSourcesGet: Ref.make("brain/readApi", headlessSourcesGet),
  headlessContextGet: Ref.make("brain/readApi", headlessContextGet),
  headlessAnswersAsk: Ref.make("brain/readApi", headlessAnswersAsk),
  validationSourcesSearch: Ref.make("brain/readApi", validationSourcesSearch),
  validationSourcesGet: Ref.make("brain/readApi", validationSourcesGet),
  validationContextGet: Ref.make("brain/readApi", validationContextGet),
  startProjectionBackfill: Ref.make(
    "brain/rolloutOperations",
    startProjectionBackfill,
  ),
  resumeProjectionBackfill: Ref.make(
    "brain/rolloutOperations",
    resumeProjectionBackfill,
  ),
  migrateLegacyPublicationJobAuthority: Ref.make(
    "brain/rolloutOperations",
    migrateLegacyPublicationJobAuthority,
  ),
  resumeLegacyPublicationJobAuthorityMigration: Ref.make(
    "brain/rolloutOperations",
    resumeLegacyPublicationJobAuthorityMigration,
  ),
  backfillTranscriptRevisionOrder: Ref.make(
    "brain/rolloutOperations",
    backfillTranscriptRevisionOrder,
  ),
  resumeTranscriptRevisionOrderBackfill: Ref.make(
    "brain/rolloutOperations",
    resumeTranscriptRevisionOrderBackfill,
  ),
  pausePublicationWorkers: Ref.make(
    "brain/rolloutOperations",
    pausePublicationWorkers,
  ),
  resumePublicationWorkers: Ref.make(
    "brain/rolloutOperations",
    resumePublicationWorkers,
  ),
  drainPublicationWorkerLeases: Ref.make(
    "brain/rolloutOperations",
    drainPublicationWorkerLeases,
  ),
  getPublicationWorkerLeaseStatus: Ref.make(
    "brain/rolloutOperations",
    getPublicationWorkerLeaseStatus,
  ),
  repairIngestionObligation: Ref.make(
    "brain/rolloutOperations",
    repairIngestionObligation,
  ),
  repairPublicationDeadLetter: Ref.make(
    "brain/rolloutOperations",
    repairPublicationDeadLetter,
  ),
  quarantineIngestionObligation: Ref.make(
    "brain/rolloutOperations",
    quarantineIngestionObligation,
  ),
  decommissionRequiredScope: Ref.make(
    "brain/rolloutOperations",
    decommissionRequiredScope,
  ),
  validateBrainProjectionReadiness: Ref.make(
    "brain/rolloutOperations",
    validateBrainProjectionReadiness,
  ),
  switchBrainReadMode: Ref.make("brain/rolloutOperations", switchBrainReadMode),
  rollbackBrainReadMode: Ref.make(
    "brain/rolloutOperations",
    rollbackBrainReadMode,
  ),
} as const;

const seedProjectedPage = Effect.gen(function* () {
  const writer = yield* RolloutDatabaseWriter;
  const userId = yield* writer
    .table("users")
    .insert({
      subject: "rollout-reader",
      email: "rollout-reader@example.com",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const organizationId = yield* writer
    .table("organizations")
    .insert({
      ownerUserId: userId,
      workosOrganizationId: "org_rollout",
      agencyKey: organizationKey,
      slug: "rollout",
      name: "Rollout",
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
      name: "Rollout Brain",
      slug: "rollout-brain",
      kind: "agency",
      status: "active",
      dataClassification: "internal",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("organizationMembers")
    .insert({
      organizationId,
      userId,
      role: "editor",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("workspaceMembers")
    .insert({
      workspaceId,
      userId,
      role: "editor",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
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
      slug: "rollout-context",
      title: "Rollout Context",
      markdown:
        "# Launch\n\nThe compatibility-default launch phrase is cobalt.",
      sourceKind: "markdown",
      updatedAt: now,
      pageKey,
      parentPageKey: null,
      siblingSlug: "rollout-context",
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
      markdown:
        "# Launch\n\nThe compatibility-default launch phrase is cobalt.",
      contentHash: "rollout-page-hash-1",
      causation: "import",
      actor: { kind: "migration", id: "rollout-test" },
      modelReceiptKey: null,
      effectKey: "rollout-test:1",
      state: "published",
      lifecycle,
      createdAt: now,
      schemaVersion: 1,
    })
    .pipe(Effect.orDie);
  return { organizationId, workspaceId };
});

const publishProjection = (workspaceId: GenericId<"workspaces">) =>
  publishPageRevisionEffect({
    organizationKey,
    workspaceId,
    brainKey,
    pageKey,
    revisionKey,
    authority: "derived",
    authorityPolicyKey: "rollout-pages",
    policyGeneration: 1,
    caller: {
      kind: "system",
      name: "brain-rollout-operations-test",
      surface: "internal",
    },
    now,
  });

const publishSecondProjection = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* RolloutDatabaseReader;
    const writer = yield* RolloutDatabaseWriter;
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
      return yield* Effect.dieMessage("Expected one page for revision two.");
    const revisionLifecycle = { ...lifecycle, state: "active" as const };
    const markdown =
      "# Launch\n\nThe compatibility-default launch phrase is cobalt blue.";
    yield* writer
      .table("pageRevisions")
      .insert({
        workspaceId,
        organizationId,
        pageKey,
        revisionKey: secondRevisionKey,
        priorRevisionKey: revisionKey,
        blockNoteJson: "",
        markdown,
        contentHash: "rollout-page-hash-2",
        causation: "human-edit",
        actor: { kind: "migration", id: "rollout-test" },
        modelReceiptKey: null,
        effectKey: "rollout-test:2",
        state: "published",
        lifecycle: revisionLifecycle,
        createdAt: now + 2,
        schemaVersion: 1,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("brainPages")
      .patch(page._id, {
        currentRevisionKey: secondRevisionKey,
        markdown,
        updatedAt: now + 2,
      })
      .pipe(Effect.orDie);
    return yield* publishPageRevisionEffect({
      organizationKey,
      workspaceId,
      brainKey,
      pageKey,
      revisionKey: secondRevisionKey,
      authority: "derived",
      authorityPolicyKey: "rollout-pages",
      policyGeneration: 1,
      caller: {
        kind: "system",
        name: "brain-rollout-operations-test",
        surface: "internal",
      },
      now: now + 2,
    });
  });

const selector = (
  organizationId: GenericId<"organizations">,
  workspaceId: GenericId<"workspaces">,
) => ({ organizationId, workspaceId, brainKey });

const insertReadMode = (
  workspaceId: GenericId<"workspaces">,
  mode: "compatibility" | "projection" | "disabled",
) =>
  Effect.gen(function* () {
    const writer = yield* RolloutDatabaseWriter;
    return yield* writer
      .table("brainReadModes")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        mode,
        modeGeneration: 1,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
  });

const seedLegacyPublication = (
  workspaceId: GenericId<"workspaces">,
  state: "current" | "retired" = "current",
) =>
  Effect.gen(function* () {
    const writer = yield* RolloutDatabaseWriter;
    const manifestHash = publicationManifestHash({
      entryKeys: [legacyEntryKey],
      tokens: [{ token: "cobalt", entryKey: legacyEntryKey }],
    });
    yield* writer
      .table("retrievalPublicationSets")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        corpusKey: "brain-pages",
        publicationSetKey: legacyPublicationSetKey,
        publicationGeneration: 1,
        originKind: "page",
        originTable: "pageRevisions",
        sourceKey: pageKey,
        sourceRevisionKey: revisionKey,
        routeGeneration: 1,
        lifecycleGeneration: 1,
        policyGeneration: 1,
        expectedEntryCount: 1,
        expectedTokenCount: 1,
        manifestHash,
        state,
        createdAt: now,
        activatedAt: now,
        ...(state === "retired" ? { retiredAt: now + 1 } : {}),
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("retrievalEntries")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        entryKey: legacyEntryKey,
        publicationSetKey: legacyPublicationSetKey,
        publicationGeneration: 1,
        kind: "page",
        corpusKey: "brain-pages",
        origin: { kind: "page", pageKey, revisionKey },
        originTable: "pageRevisions",
        sourceKey: pageKey,
        sourceRevisionKey: revisionKey,
        passageKey: legacyPassageKey,
        startOffset: 0,
        endOffset: 6,
        title: "Rollout Context",
        headingPath: "Launch",
        text: "cobalt",
        contentHash: `sha256:${"5".repeat(64)}`,
        observedAt: now,
        indexedAt: now,
        authority: "derived",
        authorityPolicyKey: "rollout-pages",
        policyGeneration: 1,
        lifecycleGeneration: 1,
        routeGeneration: 1,
        state: "published",
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("retrievalTokens")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        publicationSetKey: legacyPublicationSetKey,
        tokenizerVersion: 1,
        token: "cobalt",
        entryKey: legacyEntryKey,
        authorityRank: 2,
        termFrequency: 1,
        inTitle: false,
        inHeading: false,
      })
      .pipe(Effect.orDie);
  });

const seedLegacyPublicationJobs = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const writer = yield* RolloutDatabaseWriter;
    const base = {
      schemaVersion: 1 as const,
      organizationKey,
      workspaceId,
      brainKey,
      originKind: "page" as const,
      sourceKey: pageKey,
      sourceRevisionKey: revisionKey,
      page: {
        authority: "derived" as const,
        authorityPolicyKey: "rollout-pages",
        policyGeneration: 1,
      },
      attemptCount: 0,
      maxAttempts: 5,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    };
    yield* writer
      .table("retrievalPublicationJobs")
      .insert({
        ...base,
        jobKey: legacyPendingJobKey,
        requestGeneration: 1,
        status: "pending",
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("retrievalPublicationJobs")
      .insert({
        ...base,
        jobKey: legacySucceededJobKey,
        requestGeneration: 2,
        status: "succeeded",
        completedAt: now,
      })
      .pipe(Effect.orDie);
  });

const seedAttributedDeadLetters = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* RolloutDatabaseReader;
    const writer = yield* RolloutDatabaseWriter;
    const enqueue = (requestGeneration: number) =>
      enqueueRetrievalPublicationJobEffect(
        {
          organizationKey,
          workspaceId,
          brainKey,
          originKind: "page",
          sourceKey: pageKey,
          sourceRevisionKey: revisionKey,
          requestGeneration,
          page: {
            authority: "derived",
            authorityPolicyKey: "rollout-pages",
            policyGeneration: 1,
          },
        },
        now,
      );
    const targetJobKey = yield* enqueue(1);
    const unrelatedJobKey = yield* enqueue(2);
    const recurringJobKey = yield* enqueue(3);
    for (const jobKey of [targetJobKey, unrelatedJobKey, recurringJobKey]) {
      const jobs = yield* reader
        .table("retrievalPublicationJobs")
        .index("by_job_key", (query) => query.eq("jobKey", jobKey))
        .take(2)
        .pipe(Effect.orDie);
      const job = jobs[0];
      if (jobs.length !== 1 || job === undefined)
        return yield* Effect.dieMessage(
          "Expected an enqueued publication job.",
        );
      yield* writer
        .table("retrievalPublicationJobs")
        .patch(job._id, {
          status: "dead_letter",
          attemptCount: 5,
          lastErrorTag: "ProviderUnavailable",
          healthFailureActive: true,
          completedAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    }
    yield* writer
      .table("brainCorpusHealth")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        corpusKey: "brain-pages",
        policyGeneration: 1,
        coverageStatus: "partial",
        freshnessThresholdMs: 7 * 24 * 60 * 60 * 1_000,
        discoveredCount: 1,
        publishedCount: 0,
        failedCount: 3,
        degradedReason: "Three publication dead letters.",
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    return { targetJobKey, unrelatedJobKey, recurringJobKey };
  });

const loadProjectionPopulation = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* RolloutDatabaseReader;
    const rows = yield* reader
      .table("brainProjectionPopulation")
      .index("by_workspace_brain", (query) =>
        query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const row = rows[0];
    if (rows.length !== 1 || row === undefined)
      throw new Error("expected one population row");
    return row;
  });

const completeProjectionPrerequisites = (
  workspaceId: GenericId<"workspaces">,
) =>
  Effect.gen(function* () {
    const confect = yield* Effect.serviceOptional(
      TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
    );
    let subjectProgress = yield* confect.mutation(
      refs.startProjectionBackfill,
      {
        organizationKey,
        workspaceId,
        brainKey,
        phase: "publication_subjects",
        corpusKey: null,
        connectorScopeKey: null,
        expectedConfigurationDigest: configurationDigest,
        expectedProjectionPopulationGeneration: 0,
        batchSize: 1,
      },
    );
    for (
      let attempt = 0;
      attempt < 40 && !subjectProgress.terminal;
      attempt += 1
    )
      subjectProgress = yield* confect.mutation(refs.resumeProjectionBackfill, {
        runKey: subjectProgress.runKey,
        expectedRunGeneration: subjectProgress.runGeneration,
        batchSize: 1,
      });
    if (subjectProgress.stage !== "complete")
      return yield* Effect.dieMessage(
        `Subject backfill prerequisite ended at ${subjectProgress.stage}.`,
      );
    const population = yield* confect.run(
      loadProjectionPopulation(workspaceId),
      resultSchema(),
    );
    let jobProgress = yield* confect.mutation(
      refs.migrateLegacyPublicationJobAuthority,
      {
        organizationKey,
        workspaceId,
        brainKey,
        expectedConfigurationDigest: configurationDigest,
        expectedProjectionPopulationGeneration:
          population.projectionPopulationGeneration,
        batchSize: 1,
      },
    );
    for (let attempt = 0; attempt < 20 && !jobProgress.terminal; attempt += 1)
      jobProgress = yield* confect.mutation(
        refs.resumeLegacyPublicationJobAuthorityMigration,
        {
          runKey: jobProgress.runKey,
          expectedRunGeneration: jobProgress.runGeneration,
          batchSize: 1,
        },
      );
    if (jobProgress.stage !== "complete")
      return yield* Effect.dieMessage(
        `Job-authority prerequisite ended at ${jobProgress.stage}.`,
      );
    return yield* confect.run(
      loadProjectionPopulation(workspaceId),
      resultSchema(),
    );
  });

const seedRequiredIntent = (
  workspaceId: GenericId<"workspaces">,
  obligationStates: readonly (
    "captured" | "failed" | "quarantined" | "capacity_blocked"
  )[],
) =>
  Effect.gen(function* () {
    const writer = yield* RolloutDatabaseWriter;
    yield* writer
      .table("brainRequiredScopeIntents")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        corpusKey: "slack",
        providerKind: "slack",
        connectorScopeKey: operatorScopeKey,
        connectionKey: "conn_operator_recovery",
        connectionGeneration: 1,
        allowlistGeneration: 1,
        requiredScopeIntentKey,
        intentGeneration: 1,
        controllingConfigurationDigest: configurationDigest,
        state: "required",
        decommissionGeneration: null,
        activatedAt: now,
        decommissionedAt: null,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    for (const [index, state] of obligationStates.entries())
      yield* writer
        .table("ingestionObligations")
        .insert({
          schemaVersion: 1,
          organizationKey,
          workspaceId,
          brainKey,
          corpusKey: "slack",
          providerKind: "slack",
          connectorScopeKey: operatorScopeKey,
          connectionKey: "conn_operator_recovery",
          connectionGeneration: 1,
          allowlistGeneration: 1,
          ingestionObligationKey: `iobl_${String(index + 1).repeat(64)}`,
          requiredScopeIntentKey,
          reconciliationRunKey,
          runGeneration: 1,
          cause: "observation",
          membershipKey: `member_${index + 1}`,
          originKind: "slack",
          originKey: `message_${index + 1}`,
          originRevisionKey: `message_revision_${index + 1}`,
          ledgerSequence: index + 1,
          state,
          targetResolutionIntentKey: null,
          publicationJobKeys: [],
          errorTag:
            state === "failed"
              ? "provider_failed"
              : state === "capacity_blocked"
                ? "capacity_exceeded"
                : null,
          terminalAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
  });

const seedValidatedProjectionPopulation = (
  workspaceId: GenericId<"workspaces">,
) =>
  Effect.gen(function* () {
    const reader = yield* RolloutDatabaseReader;
    const writer = yield* RolloutDatabaseWriter;
    const population = yield* reader
      .table("brainProjectionPopulation")
      .index("by_workspace_brain", (query) =>
        query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
    const populationDigest = `sha256:${"6".repeat(64)}`;
    const subjectBase = {
      runKey: `pbrun_${"7".repeat(64)}`,
      runGeneration: 1,
      subjectBackfillGeneration: 1,
      scanHighWater: now - 2,
      catchUpHighWater: now - 1,
      populationGeneration: population.projectionPopulationGeneration,
      populationDigest,
      setCount: 1,
      subjectCount: 1,
      entryCount: 1,
      tokenCount: 9,
      completedAt: now,
    };
    const fenceBase = {
      runKey: `pbrun_${"8".repeat(64)}`,
      runGeneration: 1,
      fenceBackfillGeneration: 1,
      scanHighWater: now - 2,
      catchUpHighWater: now - 1,
      populationGeneration: population.projectionPopulationGeneration,
      configurationDigest,
      populationDigest,
      currentSetCount: 1,
      retiredSetCount: 0,
      backfilledSetCount: 1,
      invalidatedSetCount: 0,
      conflictCount: 0,
      completedAt: now,
    };
    yield* writer
      .table("brainProjectionPopulation")
      .patch(population._id, {
        subjectBackfillGeneration: 1,
        fenceBackfillGeneration: 1,
        conflictCount: 0,
        capacityCount: 0,
        fenceConflictCount: 0,
        legacySubjectBackfillCompletion: {
          ...subjectBase,
          completionDigest: `sha256:${"a".repeat(64)}`,
        },
        currentFenceSetCount: 1,
        retiredFenceSetCount: 0,
        fenceBackfilledSetCount: 1,
        invalidatedFenceSetCount: 0,
        legacyEligibilityFenceBackfillCompletion: {
          ...fenceBase,
          completionDigest: `sha256:${"b".repeat(64)}`,
        },
        updatedAt: now,
      })
      .pipe(Effect.orDie);
  });

const seedReadyPromotionScope = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const writer = yield* RolloutDatabaseWriter;
    const connectorScopeKey = "scope_projection_promotion";
    const connectionKey = "connection_projection_promotion";
    const intentKey = `brsi_${"1".repeat(64)}`;
    const runKey = `crun_${"2".repeat(64)}`;
    yield* writer.table("connectorScopes").insert({
      schemaVersion: 1,
      organizationKey,
      connectorScopeKey,
      providerKind: "slack",
      providerContainerKey: "channel_projection_promotion",
      connectionKey,
      currentConnectionGeneration: 1,
      currentAllowlistGeneration: 1,
      scopeGeneration: 1,
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    yield* writer.table("connectorAllowlistGenerations").insert({
      schemaVersion: 1,
      organizationKey,
      connectorScopeKey,
      allowlistGenerationKey: `calg_${"3".repeat(64)}`,
      connectionKey,
      connectionGeneration: 1,
      allowlistGeneration: 1,
      configurationDigest,
      memberCount: 1,
      state: "current",
      createdAt: now,
      supersededAt: null,
    });
    yield* writer.table("brainRequiredScopeIntents").insert({
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      corpusKey: "slack",
      providerKind: "slack",
      connectorScopeKey,
      connectionKey,
      connectionGeneration: 1,
      allowlistGeneration: 1,
      requiredScopeIntentKey: intentKey,
      intentGeneration: 1,
      controllingConfigurationDigest: configurationDigest,
      state: "required",
      decommissionGeneration: null,
      activatedAt: now,
      decommissionedAt: null,
      updatedAt: now,
    });
    for (const identity of [
      connectionFenceIdentity({ organizationKey, connectionKey }),
      connectorScopeFenceIdentity({ organizationKey, connectorScopeKey }),
      connectorAllowlistFenceIdentity({
        organizationKey,
        connectorScopeKey,
      }),
    ])
      yield* writer.table("retrievalEligibilityFences").insert({
        schemaVersion: 1,
        organizationKey,
        fenceKey: retrievalEligibilityFenceKey(identity),
        kind: identity.kind,
        controllerKey: identity.controllerKey,
        eligibilityGeneration: 1,
        eligible: true,
        updatedAt: now,
      });
    yield* writer.table("connectorIncrementalCursors").insert({
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      corpusKey: "slack",
      providerKind: "slack",
      connectorScopeKey,
      connectionKey,
      connectionGeneration: 1,
      allowlistGeneration: 1,
      cursorKey: `ccur_${"4".repeat(64)}`,
      providerCursor: "cursor-projection-promotion",
      traversalComplete: true,
      cursorGeneration: 1,
      activeEnvelopeKey: null,
      lastProviderHighWater: "provider-projection-promotion",
      ledgerHighWater: 1,
      createdAt: now,
      updatedAt: now,
    });
    yield* writer.table("connectorReconciliationRuns").insert({
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      corpusKey: "slack",
      providerKind: "slack",
      connectorScopeKey,
      connectionKey,
      connectionGeneration: 1,
      allowlistGeneration: 1,
      reconciliationRunKey: runKey,
      runGeneration: 1,
      scopeTupleDigest: configurationDigest,
      status: "complete",
      providerHighWater: "provider-projection-promotion",
      ledgerHighWater: 1,
      leaseId: "lease_projection_promotion",
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
        providerHighWater: "provider-projection-promotion",
        ledgerHighWater: 1,
        successfulObligationCount: 1,
        blockingObligationCount: 0,
        completedAt: now,
        receiptDigest: `sha256:${"5".repeat(64)}`,
      },
      openedAt: now,
      completedAt: now,
      updatedAt: now,
    });
    yield* writer.table("ingestionObligations").insert({
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      corpusKey: "slack",
      providerKind: "slack",
      connectorScopeKey,
      connectionKey,
      connectionGeneration: 1,
      allowlistGeneration: 1,
      ingestionObligationKey: `iobl_${"6".repeat(64)}`,
      requiredScopeIntentKey: intentKey,
      reconciliationRunKey: runKey,
      runGeneration: 1,
      cause: "observation",
      membershipKey: "membership_projection_promotion",
      originKind: "slack",
      originKey: "message_projection_promotion",
      originRevisionKey: "revision_projection_promotion",
      ledgerSequence: 1,
      state: "complete",
      targetResolutionIntentKey: null,
      publicationJobKeys: [],
      errorTag: null,
      terminalAt: now,
      createdAt: now,
      updatedAt: now,
    });
    yield* writer.table("brainCorpusHealth").insert({
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      corpusKey: "slack",
      connectorScopeKey,
      connectionGeneration: 1,
      policyGeneration: 1,
      reconciliationGeneration: 1,
      coverageStatus: "complete",
      lastObservedAt: now,
      lastPublishedAt: now,
      lastReconciledAt: now,
      freshnessThresholdMs: 7 * 24 * 60 * 60 * 1_000,
      discoveredCount: 1,
      publishedCount: 1,
      failedCount: 0,
      updatedAt: now,
    });
    return { connectorScopeKey, intentKey, runKey };
  });

const seedProjectionPromotionReady = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const published = yield* publishProjection(workspaceId);
    yield* seedValidatedProjectionPopulation(workspaceId);
    const scope = yield* seedReadyPromotionScope(workspaceId);
    return { published, scope };
  });

const seedSlackTargetResolutionIntent = (
  channelKey: string,
  status: "pending" | "retry_wait",
  index: number,
) =>
  Effect.gen(function* () {
    const writer = yield* RolloutDatabaseWriter;
    const suffix = index.toString(16).padStart(64, "0");
    const receiptId = yield* writer.table("providerEventReceipts").insert({
      schemaVersion: 1,
      organizationKey,
      connectionKey: "connection_projection_promotion",
      connectionGeneration: 1,
      channelKey,
      externalChannelId: "external_projection_promotion",
      transport: "live",
      transportDeliveryId: `delivery_projection_promotion_${index}`,
      providerEventId: `event_projection_promotion_${index}`,
      providerObjectId: `message_projection_promotion_${index}`,
      providerRevisionId: `revision_projection_promotion_${index}`,
      providerOrder: `${index + 1}`,
      canonicalContentHash: `sha256:${"c".repeat(64)}`,
      tombstone: false,
      signatureVerification: {
        status: "verified",
        receiptHash: `sha256:${"d".repeat(64)}`,
      },
      replayVerification: {
        status: "accepted",
        receiptHash: `sha256:${"e".repeat(64)}`,
      },
      observationKey: `observation_projection_promotion_${index}`,
      sourceKey: `src_projection_promotion_${index}`,
      sourceRevisionKey: `srev_${suffix}`,
      outcome: "inserted",
      receivedAt: now + index + 1,
      createdAt: now + index + 1,
    });
    yield* writer.table("slackPublicationTargetIntents").insert({
      schemaVersion: 1,
      receiptId,
      organizationKey,
      channelKey,
      sourceRevisionKey: `srev_${suffix}`,
      status,
      attemptCount: status === "retry_wait" ? 1 : 0,
      nextAttemptAt: now + index + 1,
      lastErrorTag: status === "retry_wait" ? "InjectedRetry" : null,
      resolutionGeneration: 1,
      targetCount: 0,
      completedAt: null,
      createdAt: now + index + 1,
      updatedAt: now + index + 1,
    });
  });

const boundedKey = (prefix: "iobl" | "irep" | "rjob", index: number) =>
  `${prefix}_${index.toString(16).padStart(64, "0")}`;

const seedTerminalReadinessHistory = (
  workspaceId: GenericId<"workspaces">,
  scope: {
    readonly connectorScopeKey: string;
    readonly intentKey: string;
  },
) =>
  Effect.gen(function* () {
    const writer = yield* RolloutDatabaseWriter;
    for (let index = 0; index < 201; index += 1)
      yield* writer.table("retrievalPublicationJobs").insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        jobKey: boundedKey("rjob", 10_000 + index),
        originKind: "slack",
        sourceKey: `source_terminal_history_${index}`,
        sourceRevisionKey: `revision_terminal_history_${index}`,
        requestGeneration: 1,
        status: "succeeded",
        attemptCount: 1,
        maxAttempts: 5,
        nextAttemptAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    for (let index = 0; index < 51; index += 1)
      yield* writer.table("ingestionObligations").insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        corpusKey: "slack",
        providerKind: "slack",
        connectorScopeKey: scope.connectorScopeKey,
        connectionKey: "connection_projection_promotion",
        connectionGeneration: 1,
        allowlistGeneration: 1,
        ingestionObligationKey: boundedKey("iobl", 20_000 + index),
        requiredScopeIntentKey: scope.intentKey,
        reconciliationRunKey: `crun_${"f".repeat(64)}`,
        runGeneration: 1,
        cause: "observation",
        membershipKey: `membership_terminal_history_${index}`,
        originKind: "slack",
        originKey: `message_terminal_history_${index}`,
        originRevisionKey: `revision_terminal_history_${index}`,
        ledgerSequence: index + 1,
        state: "complete",
        targetResolutionIntentKey: null,
        publicationJobKeys: [],
        errorTag: null,
        terminalAt: now,
        createdAt: now,
        updatedAt: now,
      });
  });

const seedRepairEffectHistory = (
  workspaceId: GenericId<"workspaces">,
  repairBrainKey: string,
  count: number,
) =>
  Effect.gen(function* () {
    const writer = yield* RolloutDatabaseWriter;
    for (let index = 0; index < count; index += 1)
      yield* writer.table("ingestionObligationRepairEffects").insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey: repairBrainKey,
        scopeKey: "scope_terminal_repair_history",
        repairEffectKey: boundedKey("irep", 30_000 + index),
        ingestionObligationKey: boundedKey("iobl", 30_000 + index),
        failureVersion: 1,
        mode: "attributed_repair",
        state: "succeeded",
        reason: "terminal repair history",
        createdAt: now,
        updatedAt: now,
      });
  });

const seedUnrelatedBlockingJobs = Effect.gen(function* () {
  const writer = yield* RolloutDatabaseWriter;
  const unrelatedOrganizationKey = "ag_unrelated_be3_capacity";
  const unrelatedBrainKey = "br_unrelated_be3_capacity";
  const userId = yield* writer.table("users").insert({
    subject: "unrelated-be3-capacity-owner",
    email: "unrelated-be3-capacity-owner@example.com",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  const organizationId = yield* writer.table("organizations").insert({
    ownerUserId: userId,
    workosOrganizationId: "org_unrelated_be3_capacity",
    agencyKey: unrelatedOrganizationKey,
    slug: "unrelated-be3-capacity",
    name: "Unrelated BE3 Capacity",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  const workspaceId = yield* writer.table("workspaces").insert({
    organizationId,
    ownerUserId: userId,
    brainKey: unrelatedBrainKey,
    name: "Unrelated BE3 Capacity Brain",
    slug: "unrelated-be3-capacity-brain",
    kind: "agency",
    status: "active",
    dataClassification: "internal",
    createdAt: now,
    updatedAt: now,
  });
  for (let index = 0; index < 201; index += 1)
    yield* writer.table("retrievalPublicationJobs").insert({
      schemaVersion: 1,
      organizationKey: unrelatedOrganizationKey,
      workspaceId,
      brainKey: unrelatedBrainKey,
      jobKey: boundedKey("rjob", 40_000 + index),
      originKind: "slack",
      sourceKey: `unrelated_blocking_source_${index}`,
      sourceRevisionKey: `unrelated_blocking_revision_${index}`,
      requestGeneration: 1,
      status: "pending",
      attemptCount: 0,
      maxAttempts: 5,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
});

const seedTerminalJobActiveLease = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const writer = yield* RolloutDatabaseWriter;
    const jobKey = boundedKey("rjob", 50_000);
    const scopeKey = "brain-pages";
    const pauseKey = publicationPauseKey({
      organizationKey,
      workspaceId,
      brainKey,
      scopeKey,
    });
    yield* writer.table("retrievalPublicationJobs").insert({
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      jobKey,
      originKind: "page",
      sourceKey: pageKey,
      sourceRevisionKey: revisionKey,
      requestGeneration: 1,
      status: "succeeded",
      attemptCount: 1,
      maxAttempts: 5,
      nextAttemptAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    yield* writer.table("brainPublicationWorkerLeases").insert({
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      scopeKey,
      pauseKey,
      leaseKey: `bpwl_${"f".repeat(64)}`,
      jobKey,
      pauseEpoch: 0,
      state: "active",
      claimedAt: now,
      expiresAt: now + 60_000,
      releasedAt: null,
      releaseReason: null,
      updatedAt: now,
    });
  });

const seedBlockingPublicationJob = (
  workspaceId: GenericId<"workspaces">,
  status: "retry_wait" | "integrity_failure" | "dead_letter",
  index: number,
) =>
  Effect.gen(function* () {
    const writer = yield* RolloutDatabaseWriter;
    yield* writer.table("retrievalPublicationJobs").insert({
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      jobKey: boundedKey("rjob", 60_000 + index),
      originKind: "page",
      sourceKey: pageKey,
      sourceRevisionKey: revisionKey,
      requestGeneration: index + 2,
      status,
      attemptCount: 1,
      maxAttempts: 5,
      nextAttemptAt: now + index + 1,
      lastErrorTag: `Injected${status}`,
      createdAt: now,
      updatedAt: now + index + 1,
    });
  });

const seedBlockingObligation = (
  workspaceId: GenericId<"workspaces">,
  scope: {
    readonly connectorScopeKey: string;
    readonly intentKey: string;
    readonly runKey: string;
  },
  state:
    | "captured"
    | "normalization_pending"
    | "quarantined"
    | "target_resolution_pending"
    | "capacity_blocked"
    | "publication_pending"
    | "retry_wait"
    | "removal_pending"
    | "drain_pending"
    | "failed",
  index: number,
) =>
  Effect.gen(function* () {
    const writer = yield* RolloutDatabaseWriter;
    yield* writer.table("ingestionObligations").insert({
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      corpusKey: "slack",
      providerKind: "slack",
      connectorScopeKey: scope.connectorScopeKey,
      connectionKey: "connection_projection_promotion",
      connectionGeneration: 1,
      allowlistGeneration: 1,
      ingestionObligationKey: boundedKey("iobl", 60_000 + index),
      requiredScopeIntentKey: scope.intentKey,
      reconciliationRunKey: scope.runKey,
      runGeneration: 1,
      cause:
        state === "removal_pending" || state === "drain_pending"
          ? "removal"
          : "observation",
      membershipKey: `membership_switch_race_${state}`,
      originKind: "slack",
      originKey: `message_switch_race_${state}`,
      originRevisionKey: `revision_switch_race_${state}`,
      ledgerSequence: index + 2,
      state,
      targetResolutionIntentKey: null,
      publicationJobKeys: [],
      errorTag:
        state === "capacity_blocked"
          ? "capacity_exceeded"
          : state === "failed"
            ? "provider_failed"
            : null,
      terminalAt: null,
      createdAt: now + index + 1,
      updatedAt: now + index + 1,
    });
  });

const seedBlockingRepairEffect = (
  workspaceId: GenericId<"workspaces">,
  state: "queued" | "running" | "failed",
  index: number,
) =>
  Effect.gen(function* () {
    const writer = yield* RolloutDatabaseWriter;
    yield* writer.table("ingestionObligationRepairEffects").insert({
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      scopeKey: "scope_projection_promotion",
      repairEffectKey: boundedKey("irep", 60_000 + index),
      ingestionObligationKey: boundedKey("iobl", 70_000 + index),
      failureVersion: 1,
      mode: "attributed_repair",
      state,
      reason: `Injected ${state} switch race`,
      createdAt: now + index + 1,
      updatedAt: now + index + 1,
    });
  });

const revokeProjectedPage = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* RolloutDatabaseReader;
    const writer = yield* RolloutDatabaseWriter;
    const page = yield* reader
      .table("brainPages")
      .index("by_workspace_page_key", (query) =>
        query.eq("workspaceId", workspaceId).eq("pageKey", pageKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
    yield* writer
      .table("brainPages")
      .patch(page._id, {
        status: "archived",
        lifecycle: {
          state: "archived",
          generation: 2,
          updatedAt: now + 2,
          purgeAfter: null,
        },
        updatedAt: now + 2,
      })
      .pipe(Effect.orDie);
    yield* transitionEligibilityFenceEffect({
      identity: pageLifecycleFenceIdentity({
        organizationKey,
        workspaceId: String(workspaceId),
        pageKey,
      }),
      eligible: false,
      now: now + 2,
    });
    return yield* publishPageRevisionEffect({
      organizationKey,
      workspaceId,
      brainKey,
      pageKey,
      revisionKey,
      authority: "derived",
      authorityPolicyKey: "rollout-pages",
      policyGeneration: 1,
      caller: {
        kind: "system",
        name: "brain-rollout-switch-race-test",
        surface: "internal",
      },
      now: now + 2,
    });
  });

type PromotionScope = {
  readonly connectorScopeKey: string;
  readonly intentKey: string;
  readonly runKey: string;
};

type RolloutTestConfect = Effect.Effect.Success<
  ReturnType<typeof TestConfect.TestConfect<typeof rolloutDatabaseSchema>>
>;

const runPostValidationSwitchRace = <Result>(
  mutate: (
    confect: RolloutTestConfect,
    workspaceId: GenericId<"workspaces">,
    scope: PromotionScope,
  ) => Effect.Effect<Result, unknown, never>,
) =>
  Effect.gen(function* () {
    const confect = yield* Effect.serviceOptional(
      TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
    );
    const { workspaceId } = yield* confect.run(
      seedProjectedPage,
      resultSchema(),
    );
    yield* confect.run(insertReadMode(workspaceId, "compatibility"));
    const { scope } = yield* confect.run(
      seedProjectionPromotionReady(workspaceId),
      resultSchema(),
    );
    const validation = yield* confect.mutation(
      refs.validateBrainProjectionReadiness,
      { organizationKey, workspaceId, brainKey },
    );
    const mutation = yield* mutate(
      confect as RolloutTestConfect,
      workspaceId,
      scope,
    );
    const switched = yield* confect
      .mutation(refs.switchBrainReadMode, {
        organizationKey,
        workspaceId,
        brainKey,
        receiptKey: validation.receiptKey,
      })
      .pipe(Effect.either);
    return { validation, mutation, switched };
  });

const expectPostValidationSwitchRejected = (attempt: unknown) =>
  expect(attempt).toMatchObject({
    _tag: "Left",
    left: {
      operation: "switch_brain_read_mode",
      reason: "state_changed",
    },
  });

describe("Brain read rollout operations", () => {
  it("declares provider-neutral connector scope and immutable allowlist generations", () => {
    expect(connectorScopes.indexes).toEqual({
      by_connector_scope_key: ["connectorScopeKey"],
      by_organization_provider_container: [
        "organizationKey",
        "providerKind",
        "providerContainerKey",
      ],
      by_connection_scope: ["connectionKey", "connectorScopeKey"],
    });
    expect(connectorAllowlistGenerations.indexes).toEqual({
      by_allowlist_generation_key: ["allowlistGenerationKey"],
      by_scope_generation: ["connectorScopeKey", "allowlistGeneration"],
      by_scope_state: ["connectorScopeKey", "state"],
    });
    expect(
      Schema.decodeUnknownSync(ConnectorScopeRow)({
        schemaVersion: 1,
        organizationKey,
        connectorScopeKey: "scope_provider_neutral",
        providerKind: "google_drive",
        providerContainerKey: "shared-drive-1",
        connectionKey: "connection-1",
        currentConnectionGeneration: 2,
        currentAllowlistGeneration: 3,
        scopeGeneration: 4,
        state: "active",
        createdAt: now,
        updatedAt: now,
      }),
    ).toMatchObject({ providerKind: "google_drive", scopeGeneration: 4 });
    expect(
      Schema.decodeUnknownSync(ConnectorAllowlistGenerationRow)({
        schemaVersion: 1,
        organizationKey,
        connectorScopeKey: "scope_provider_neutral",
        allowlistGenerationKey: `calg_${"d".repeat(64)}`,
        connectionKey: "connection-1",
        connectionGeneration: 2,
        allowlistGeneration: 3,
        configurationDigest,
        memberCount: 2,
        state: "current",
        createdAt: now,
        supersededAt: null,
      }),
    ).toMatchObject({ allowlistGeneration: 3, state: "current" });
  });

  it("declares projection as an additive read mode", () => {
    expect(brainReadModes.indexes).toEqual({
      by_workspace_brain: ["workspaceId", "brainKey"],
    });
    expect(
      Schema.decodeUnknownSync(BrainReadModeRow)({
        schemaVersion: 1,
        organizationKey,
        workspaceId: "workspaces_1",
        brainKey,
        mode: "compatibility",
        modeGeneration: 1,
        updatedAt: now,
      }),
    ).toMatchObject({ mode: "compatibility" });
    expect(
      Schema.decodeUnknownSync(BrainReadModeRow)({
        schemaVersion: 1,
        organizationKey,
        workspaceId: "workspaces_1",
        brainKey,
        mode: "projection",
        modeGeneration: 1,
        updatedAt: now,
      }),
    ).toMatchObject({ mode: "projection" });
    expect(brainProjectionValidationReceipts.indexes).toEqual({
      by_receipt_key: ["receiptKey"],
      by_workspace_brain_expiry: ["workspaceId", "brainKey", "expiresAt"],
    });
    expect(ingestionObligationRepairEffects.indexes).toEqual({
      by_repair_effect_key: ["repairEffectKey"],
      by_obligation_failure_version: [
        "ingestionObligationKey",
        "failureVersion",
      ],
      by_state_updated: ["state", "updatedAt"],
      by_organization_workspace_brain_state_updated: [
        "organizationKey",
        "workspaceId",
        "brainKey",
        "state",
        "updatedAt",
      ],
    });
    expect(
      rolloutOperations.functions.validateBrainProjectionReadiness,
    ).toMatchObject({ functionVisibility: "internal" });
    expect(rolloutOperations.functions.switchBrainReadMode).toMatchObject({
      functionVisibility: "internal",
    });
    expect(rolloutOperations.functions.rollbackBrainReadMode).toMatchObject({
      functionVisibility: "internal",
    });
  });

  it("keeps validation refs internal and out of public HTTP discovery", () => {
    expect(readApi.functions.validationSourcesSearch).toMatchObject({
      functionVisibility: "internal",
    });
    expect(readApi.functions.validationSourcesGet).toMatchObject({
      functionVisibility: "internal",
    });
    expect(readApi.functions.validationContextGet).toMatchObject({
      functionVisibility: "internal",
    });
    expect(readManifest.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining([
        "validationSourcesSearch",
        "validationSourcesGet",
        "validationContextGet",
      ]),
    );
    expect(templateHttpRoutes.map(({ path }) => path)).not.toEqual(
      expect.arrayContaining([
        "/api/validationSourcesSearch",
        "/api/validationSourcesGet",
        "/api/validationContextGet",
      ]),
    );
  });

  it("defaults missing and explicit modes to compatibility while validation sees projection", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { organizationId, workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        const published = yield* confect.run(
          publishProjection(workspaceId),
          resultSchema(),
        );
        if (published.outcome !== "published")
          throw new Error("expected page projection publication");
        const scoped = selector(organizationId, workspaceId);
        const missingModeSearch = yield* confect.query(
          refs.headlessSourcesSearch,
          { ...scoped, query: "cobalt" },
        );
        const publicReader = confect.withIdentity({
          subject: "rollout-reader",
          email: "rollout-reader@example.com",
          emailVerified: true,
          workosOrganizationId: "org_rollout",
        });
        const publicSearch = yield* publicReader.query(
          refs.publicSourcesSearch,
          { brainKey, query: "cobalt" },
        );
        const validationSearch = yield* confect.query(
          refs.validationSourcesSearch,
          { ...scoped, query: "cobalt" },
        );
        const validationEntry = validationSearch.results[0];
        if (validationEntry === undefined)
          throw new Error("missing validation projection");
        const validationSource = yield* confect.query(
          refs.validationSourcesGet,
          {
            ...scoped,
            publicationSetKey: validationEntry.publicationSetKey,
            entryKey: validationEntry.entryKey,
          },
        );
        const validationContext = yield* confect.query(
          refs.validationContextGet,
          { ...scoped, question: "What is the launch phrase?" },
        );
        const modeId = yield* confect.run(
          insertReadMode(workspaceId, "compatibility"),
          resultSchema(),
        );
        const explicitCompatibilitySearch = yield* confect.query(
          refs.headlessSourcesSearch,
          { ...scoped, query: "cobalt" },
        );
        const exactProjectionAttempt = yield* confect
          .query(refs.headlessSourcesGet, {
            ...scoped,
            publicationSetKey: validationEntry.publicationSetKey,
            entryKey: validationEntry.entryKey,
          })
          .pipe(Effect.either);
        const compatibilityContext = yield* confect.query(
          refs.headlessContextGet,
          { ...scoped, question: "What is the launch phrase?" },
        );
        return {
          published,
          missingModeSearch,
          publicSearch,
          validationSearch,
          validationSource,
          validationContext,
          modeId,
          explicitCompatibilitySearch,
          exactProjectionAttempt,
          compatibilityContext,
        };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.missingModeSearch.results).toEqual([]);
    expect(result.publicSearch.results).toEqual([]);
    expect(result.explicitCompatibilitySearch.results).toEqual([]);
    expect(result.validationSearch.results).toEqual([
      expect.objectContaining({
        publicationSetKey: result.published.publicationSetKey,
        excerpt: expect.stringContaining("cobalt"),
      }),
    ]);
    expect(result.validationSource).toMatchObject({
      publicationSetKey: result.published.publicationSetKey,
    });
    expect(result.validationContext.entries).toEqual([
      expect.objectContaining({
        publicationSetKey: result.published.publicationSetKey,
      }),
    ]);
    expect(result.exactProjectionAttempt).toMatchObject({
      _tag: "Left",
      left: { _tag: "ValidationFailed" },
    });
    expect(result.compatibilityContext.entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          publicationSetKey: result.published.publicationSetKey,
        }),
      ]),
    );
  });

  it("fails every headless read with SubsystemDisabled", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { organizationId, workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(insertReadMode(workspaceId, "disabled"));
        const scoped = selector(organizationId, workspaceId);
        return yield* Effect.all([
          confect
            .query(refs.headlessSourcesSearch, {
              ...scoped,
              query: "cobalt",
            })
            .pipe(Effect.either),
          confect
            .query(refs.headlessSourcesGet, {
              ...scoped,
              sourceRevisionKey: "missing",
            })
            .pipe(Effect.either),
          confect.query(refs.headlessContextGet, scoped).pipe(Effect.either),
          confect
            .query(refs.headlessAnswersAsk, {
              ...scoped,
              question: "What launched?",
            })
            .pipe(Effect.either),
        ]);
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    for (const attempt of result) {
      expect(attempt).toMatchObject({
        _tag: "Left",
        left: { _tag: "SubsystemDisabled", subsystem: "brain.read" },
      });
    }
  });

  it("rejects readiness validation when the current token catalog is missing", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(insertReadMode(workspaceId, "compatibility"));
        yield* confect.run(
          seedProjectionPromotionReady(workspaceId),
          resultSchema(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const writer = yield* RolloutDatabaseWriter;
            const catalog = yield* reader
              .table("retrievalTokenCatalog")
              .index("by_workspace_brain_token", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            yield* writer
              .table("retrievalTokenCatalog")
              .delete(catalog._id)
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        return yield* confect
          .mutation(refs.validateBrainProjectionReadiness, {
            organizationKey,
            workspaceId,
            brainKey,
          })
          .pipe(Effect.either);
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(attempt).toMatchObject({
      _tag: "Left",
      left: {
        _tag: "ProjectionReadinessRejected",
        operation: "validate_brain_projection_readiness",
        reason: "integrity_conflict",
      },
    });
  });

  it("rejects switching when the token catalog changes after validation", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(insertReadMode(workspaceId, "compatibility"));
        yield* confect.run(
          seedProjectionPromotionReady(workspaceId),
          resultSchema(),
        );
        const validation = yield* confect.mutation(
          refs.validateBrainProjectionReadiness,
          { organizationKey, workspaceId, brainKey },
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const writer = yield* RolloutDatabaseWriter;
            const catalog = yield* reader
              .table("retrievalTokenCatalog")
              .index("by_workspace_brain_token", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            yield* writer
              .table("retrievalTokenCatalog")
              .delete(catalog._id)
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        return yield* confect
          .mutation(refs.switchBrainReadMode, {
            organizationKey,
            workspaceId,
            brainKey,
            receiptKey: validation.receiptKey,
          })
          .pipe(Effect.either);
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(attempt).toMatchObject({
      _tag: "Left",
      left: {
        _tag: "ProjectionReadinessRejected",
        operation: "switch_brain_read_mode",
        reason: "state_changed",
      },
    });
  });

  it("promotes only with a server-owned receipt and routes every read through projection", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { organizationId, workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(insertReadMode(workspaceId, "compatibility"));
        const { published, scope } = yield* confect.run(
          seedProjectionPromotionReady(workspaceId),
          resultSchema(),
        );
        const validation = yield* confect.mutation(
          refs.validateBrainProjectionReadiness,
          { organizationKey, workspaceId, brainKey },
        );
        const receipt = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            return yield* reader
              .table("brainProjectionValidationReceipts")
              .index("by_receipt_key", (query) =>
                query.eq("receiptKey", validation.receiptKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          }),
          resultSchema(),
        );
        const switched = yield* confect.mutation(refs.switchBrainReadMode, {
          organizationKey,
          workspaceId,
          brainKey,
          receiptKey: validation.receiptKey,
        });
        const scoped = selector(organizationId, workspaceId);
        const search = yield* confect.query(refs.headlessSourcesSearch, {
          ...scoped,
          query: "cobalt",
        });
        const entry = search.results[0];
        if (entry === undefined)
          return yield* Effect.dieMessage("Expected a promoted projection.");
        const source = yield* confect.query(refs.headlessSourcesGet, {
          ...scoped,
          publicationSetKey: entry.publicationSetKey,
          entryKey: entry.entryKey,
        });
        const context = yield* confect.query(refs.headlessContextGet, {
          ...scoped,
          question: "What is the cobalt launch phrase?",
        });
        const tinyMultibyteContext = yield* confect
          .query(refs.headlessContextGet, {
            ...scoped,
            question: "What is the 🧠 cobalt launch phrase?",
            maxBytes: 1,
          })
          .pipe(Effect.either);
        const ask = yield* confect.query(refs.headlessAnswersAsk, {
          ...scoped,
          question: "What is the cobalt launch phrase?",
        });
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const writer = yield* RolloutDatabaseWriter;
            const health = yield* reader
              .table("brainCorpusHealth")
              .index("by_workspace_brain_corpus_scope", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("corpusKey", "slack")
                  .eq("connectorScopeKey", scope.connectorScopeKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            yield* writer
              .table("brainCorpusHealth")
              .patch(health._id, {
                coverageStatus: "partial",
                updatedAt: now + 1,
              })
              .pipe(Effect.orDie);
            return true;
          }),
          Schema.Boolean,
        );
        const blockedContext = yield* confect.query(refs.headlessContextGet, {
          ...scoped,
          question: "What is the cobalt launch phrase?",
        });
        const blockedAsk = yield* confect.query(refs.headlessAnswersAsk, {
          ...scoped,
          question: "What is the cobalt launch phrase?",
        });
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const writer = yield* RolloutDatabaseWriter;
            const health = yield* reader
              .table("brainCorpusHealth")
              .index("by_workspace_brain_corpus_scope", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("corpusKey", "slack")
                  .eq("connectorScopeKey", scope.connectorScopeKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            yield* writer
              .table("brainCorpusHealth")
              .patch(health._id, {
                coverageStatus: "complete",
                updatedAt: now + 2,
              })
              .pipe(Effect.orDie);
            return true;
          }),
          Schema.Boolean,
        );
        const replay = yield* confect
          .mutation(refs.switchBrainReadMode, {
            organizationKey,
            workspaceId,
            brainKey,
            receiptKey: validation.receiptKey,
          })
          .pipe(Effect.flip);
        const rollback = yield* confect.mutation(refs.rollbackBrainReadMode, {
          organizationKey,
          workspaceId,
          brainKey,
          expectedModeGeneration: switched.modeGeneration,
          reason: "rollback rehearsal",
        });
        const disabled = yield* confect
          .query(refs.headlessSourcesSearch, { ...scoped, query: "cobalt" })
          .pipe(Effect.flip);
        const revalidation = yield* confect.mutation(
          refs.validateBrainProjectionReadiness,
          { organizationKey, workspaceId, brainKey },
        );
        const reswitched = yield* confect.mutation(refs.switchBrainReadMode, {
          organizationKey,
          workspaceId,
          brainKey,
          receiptKey: revalidation.receiptKey,
        });
        const recovered = yield* confect.query(refs.headlessSourcesSearch, {
          ...scoped,
          query: "cobalt",
        });
        return {
          published,
          validation,
          receipt,
          switched,
          search,
          source,
          context,
          tinyMultibyteContext,
          ask,
          blockedContext,
          blockedAsk,
          replay,
          rollback,
          disabled,
          revalidation,
          reswitched,
          recovered,
        };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.validation).toMatchObject({
      receiptKey: expect.stringMatching(/^bpvr_[a-f0-9]{64}$/),
      deploymentSha: expect.any(String),
      projectionSchemaVersion: "3",
      projectionManifestVersion: "2",
      validatedMode: "compatibility",
      validatedModeGeneration: 1,
    });
    expect(result.validation.expiresAt - result.validation.issuedAt).toBe(
      30 * 60 * 1_000,
    );
    expect(
      Schema.decodeUnknownSync(BrainProjectionValidationReceiptRow)(
        result.receipt,
      ),
    ).toMatchObject({
      receiptKey: result.validation.receiptKey,
      consumedAt: null,
      projectionPopulationGeneration:
        result.validation.projectionPopulationGeneration,
    });
    expect(result.switched).toMatchObject({
      previousMode: "compatibility",
      mode: "projection",
      previousModeGeneration: 1,
      modeGeneration: 2,
      receiptKey: result.validation.receiptKey,
    });
    expect(result.search.results).toEqual([
      expect.objectContaining({
        publicationSetKey: result.published.publicationSetKey,
        excerpt: expect.stringContaining("cobalt"),
      }),
    ]);
    expect(result.source.publicationSetKey).toBe(
      result.published.publicationSetKey,
    );
    expect(result.context.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          publicationSetKey: result.published.publicationSetKey,
        }),
      ]),
    );
    expect(result.tinyMultibyteContext).toMatchObject({
      _tag: "Left",
      left: {
        _tag: "RetrievalCapacityExceeded",
        resource: "context_pack_bytes",
        limit: 1,
        observedAtLeast: expect.any(Number),
      },
    });
    expect(result.ask).toMatchObject({
      response: { status: "answered" },
    });
    expect(result.blockedContext).toMatchObject({
      readiness: "blocked",
      entries: [
        expect.objectContaining({
          publicationSetKey: result.published.publicationSetKey,
        }),
      ],
    });
    expect(result.blockedAsk).toMatchObject({
      response: {
        status: "abstained",
        reason: "insufficient_evidence",
        evidence: [],
      },
    });
    expect(result.replay).toMatchObject({ reason: "receipt_consumed" });
    expect(result.rollback).toMatchObject({
      previousMode: "projection",
      mode: "disabled",
      compatibilityEquivalent: false,
    });
    expect(result.disabled).toMatchObject({
      _tag: "SubsystemDisabled",
      subsystem: "brain.read",
    });
    expect(result.revalidation).toMatchObject({
      validatedMode: "disabled",
      validatedModeGeneration: result.rollback.modeGeneration,
    });
    expect(result.reswitched).toMatchObject({
      previousMode: "disabled",
      mode: "projection",
      previousModeGeneration: result.rollback.modeGeneration,
      modeGeneration: result.rollback.modeGeneration + 1,
    });
    expect(result.recovered.results).toEqual([
      expect.objectContaining({
        publicationSetKey: result.published.publicationSetKey,
      }),
    ]);
  });

  it("promotes with terminal history above atomic unresolved-work limits", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(insertReadMode(workspaceId, "compatibility"));
        const { scope } = yield* confect.run(
          seedProjectionPromotionReady(workspaceId),
          resultSchema(),
        );
        yield* confect.run(
          seedTerminalReadinessHistory(workspaceId, scope),
          resultSchema(),
        );
        yield* confect.run(
          seedRepairEffectHistory(workspaceId, `${brainKey}_other`, 201),
          resultSchema(),
        );
        const validation = yield* confect.mutation(
          refs.validateBrainProjectionReadiness,
          { organizationKey, workspaceId, brainKey },
        );
        const switched = yield* confect.mutation(refs.switchBrainReadMode, {
          organizationKey,
          workspaceId,
          brainKey,
          receiptKey: validation.receiptKey,
        });
        return { switched, validation };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.validation).toMatchObject({
      validatedMode: "compatibility",
    });
    expect(result.switched).toMatchObject({
      previousMode: "compatibility",
      mode: "projection",
    });
  });

  it("applies blocking-job capacity after tenant and Brain scoping", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(insertReadMode(workspaceId, "compatibility"));
        yield* confect.run(
          seedProjectionPromotionReady(workspaceId),
          resultSchema(),
        );
        yield* confect.run(seedUnrelatedBlockingJobs, resultSchema());
        const validation = yield* confect.mutation(
          refs.validateBrainProjectionReadiness,
          { organizationKey, workspaceId, brainKey },
        );
        const switched = yield* confect.mutation(refs.switchBrainReadMode, {
          organizationKey,
          workspaceId,
          brainKey,
          receiptKey: validation.receiptKey,
        });
        return { validation, switched };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.validation).toMatchObject({
      validatedMode: "compatibility",
    });
    expect(result.switched).toMatchObject({
      previousMode: "compatibility",
      mode: "projection",
    });
  });

  it("rejects unresolved Slack target resolution before validation and after receipt issuance", async () => {
    const runCase = (beforeValidation: boolean) =>
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(insertReadMode(workspaceId, "compatibility"));
        const { scope } = yield* confect.run(
          seedProjectionPromotionReady(workspaceId),
          resultSchema(),
        );
        if (beforeValidation)
          yield* confect.run(
            seedSlackTargetResolutionIntent(
              scope.connectorScopeKey,
              "pending",
              80_000,
            ),
            resultSchema(),
          );
        const validation = yield* confect
          .mutation(refs.validateBrainProjectionReadiness, {
            organizationKey,
            workspaceId,
            brainKey,
          })
          .pipe(Effect.either);
        if (beforeValidation || validation._tag === "Left")
          return { validation, receipt: null, promotion: null };
        const receipt = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            return yield* reader
              .table("brainProjectionValidationReceipts")
              .index("by_receipt_key", (query) =>
                query.eq("receiptKey", validation.right.receiptKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          }),
          resultSchema(),
        );
        yield* confect.run(
          seedSlackTargetResolutionIntent(
            scope.connectorScopeKey,
            "retry_wait",
            80_001,
          ),
          resultSchema(),
        );
        const promotion = yield* confect
          .mutation(refs.switchBrainReadMode, {
            organizationKey,
            workspaceId,
            brainKey,
            receiptKey: validation.right.receiptKey,
          })
          .pipe(Effect.either);
        return { validation, receipt, promotion };
      });
    const validationBlocked = await Effect.runPromise(
      runCase(true).pipe(Effect.provide(rolloutTestLayer())),
    );
    const promotionBlocked = await Effect.runPromise(
      runCase(false).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(validationBlocked.validation).toMatchObject({
      _tag: "Left",
      left: {
        operation: "validate_brain_projection_readiness",
        reason: "not_ready",
        detail: expect.stringContaining("target_resolution_intents_unresolved"),
      },
    });
    expect(promotionBlocked.receipt).toMatchObject({
      unresolvedSlackTargetResolutionIntentCount: 0,
      unresolvedSlackTargetResolutionIntentPopulationDigest:
        expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(promotionBlocked.promotion).toMatchObject({
      _tag: "Left",
      left: {
        operation: "switch_brain_read_mode",
        reason: "state_changed",
        detail: expect.stringContaining("target_resolution_intents_unresolved"),
      },
    });
  });

  it("rejects an active lease linked to a terminal publication job", async () => {
    const runCase = (leaseBeforeValidation: boolean) =>
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(insertReadMode(workspaceId, "compatibility"));
        yield* confect.run(
          seedProjectionPromotionReady(workspaceId),
          resultSchema(),
        );
        if (leaseBeforeValidation)
          yield* confect.run(
            seedTerminalJobActiveLease(workspaceId),
            resultSchema(),
          );
        const validation = yield* confect
          .mutation(refs.validateBrainProjectionReadiness, {
            organizationKey,
            workspaceId,
            brainKey,
          })
          .pipe(Effect.either);
        if (leaseBeforeValidation || validation._tag === "Left")
          return validation;
        yield* confect.run(
          seedTerminalJobActiveLease(workspaceId),
          resultSchema(),
        );
        return yield* confect
          .mutation(refs.switchBrainReadMode, {
            organizationKey,
            workspaceId,
            brainKey,
            receiptKey: validation.right.receiptKey,
          })
          .pipe(Effect.either);
      });
    const validation = await Effect.runPromise(
      runCase(true).pipe(Effect.provide(rolloutTestLayer())),
    );
    const promotion = await Effect.runPromise(
      runCase(false).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(validation).toMatchObject({
      _tag: "Left",
      left: {
        operation: "validate_brain_projection_readiness",
        reason: "not_ready",
        detail: expect.stringContaining("lease"),
      },
    });
    expect(promotion).toMatchObject({
      _tag: "Left",
      left: {
        operation: "switch_brain_read_mode",
        reason: "state_changed",
        detail: expect.stringContaining("lease"),
      },
    });
  });

  it("rejects a receipt when a successor publish retires the validated current set", async () => {
    const result = await Effect.runPromise(
      runPostValidationSwitchRace((confect, workspaceId) =>
        confect.run(publishSecondProjection(workspaceId), resultSchema()),
      ).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.mutation).toMatchObject({
      outcome: "published",
      publicationGeneration: 2,
    });
    expectPostValidationSwitchRejected(result.switched);
  });

  it("rejects a receipt when lifecycle revocation retires the validated current set", async () => {
    const result = await Effect.runPromise(
      runPostValidationSwitchRace((confect, workspaceId) =>
        confect.run(revokeProjectedPage(workspaceId), resultSchema()),
      ).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.mutation).toMatchObject({ outcome: "revoked" });
    expectPostValidationSwitchRejected(result.switched);
  });

  it.each([
    ["retry_wait", 0],
    ["integrity_failure", 1],
    ["dead_letter", 2],
  ] as const)(
    "rejects a receipt when a publication job becomes %s after validation",
    async (status, index) => {
      const result = await Effect.runPromise(
        runPostValidationSwitchRace((confect, workspaceId) =>
          confect.run(
            seedBlockingPublicationJob(workspaceId, status, index),
            resultSchema(),
          ),
        ).pipe(Effect.provide(rolloutTestLayer())),
      );

      expectPostValidationSwitchRejected(result.switched);
    },
  );

  it.each([
    ["captured", 0],
    ["normalization_pending", 1],
    ["quarantined", 2],
    ["target_resolution_pending", 3],
    ["capacity_blocked", 4],
    ["publication_pending", 5],
    ["retry_wait", 6],
    ["removal_pending", 7],
    ["drain_pending", 8],
    ["failed", 9],
  ] as const)(
    "rejects a receipt when an ingestion obligation becomes %s after validation",
    async (state, index) => {
      const result = await Effect.runPromise(
        runPostValidationSwitchRace((confect, workspaceId, scope) =>
          confect.run(
            seedBlockingObligation(workspaceId, scope, state, index),
            resultSchema(),
          ),
        ).pipe(Effect.provide(rolloutTestLayer())),
      );

      expectPostValidationSwitchRejected(result.switched);
    },
  );

  it.each([
    ["queued", 0],
    ["running", 1],
    ["failed", 2],
  ] as const)(
    "rejects a receipt when an ingestion repair effect becomes %s after validation",
    async (state, index) => {
      const result = await Effect.runPromise(
        runPostValidationSwitchRace((confect, workspaceId) =>
          confect.run(
            seedBlockingRepairEffect(workspaceId, state, index),
            resultSchema(),
          ),
        ).pipe(Effect.provide(rolloutTestLayer())),
      );

      expectPostValidationSwitchRejected(result.switched);
    },
  );

  it("applies repair-effect capacity after tenant and Brain scoping", async () => {
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(insertReadMode(workspaceId, "compatibility"));
        yield* confect.run(
          seedProjectionPromotionReady(workspaceId),
          resultSchema(),
        );
        yield* confect.run(
          seedRepairEffectHistory(workspaceId, brainKey, 201),
          resultSchema(),
        );
        return yield* confect
          .mutation(refs.validateBrainProjectionReadiness, {
            organizationKey,
            workspaceId,
            brainKey,
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(failure).toMatchObject({
      reason: "capacity_exceeded",
      detail: expect.stringContaining("repair-effect population"),
    });
  });

  it("rejects cross-Brain, tampered, expired, advanced, and newly busy receipts", async () => {
    const runCase = <Result>(
      mutate: (
        confect: Effect.Effect.Success<
          ReturnType<
            typeof TestConfect.TestConfect<typeof rolloutDatabaseSchema>
          >
        >,
        workspaceId: GenericId<"workspaces">,
        receiptKey: string,
      ) => Effect.Effect<Result, unknown, never>,
    ) =>
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(insertReadMode(workspaceId, "compatibility"));
        yield* confect.run(
          seedProjectionPromotionReady(workspaceId),
          resultSchema(),
        );
        const validation = yield* confect.mutation(
          refs.validateBrainProjectionReadiness,
          { organizationKey, workspaceId, brainKey },
        );
        return yield* mutate(
          confect as Effect.Effect.Success<
            ReturnType<
              typeof TestConfect.TestConfect<typeof rolloutDatabaseSchema>
            >
          >,
          workspaceId,
          validation.receiptKey,
        );
      });

    const crossBrain = await Effect.runPromise(
      runCase((confect, workspaceId, receiptKey) =>
        confect
          .mutation(refs.switchBrainReadMode, {
            organizationKey,
            workspaceId,
            brainKey: `${brainKey}_other`,
            receiptKey,
          })
          .pipe(Effect.flip),
      ).pipe(Effect.provide(rolloutTestLayer())),
    );
    expect(crossBrain).toMatchObject({ reason: "receipt_scope_mismatch" });

    const tampered = await Effect.runPromise(
      runCase((confect, workspaceId, receiptKey) =>
        Effect.gen(function* () {
          yield* confect.run(
            Effect.gen(function* () {
              const reader = yield* RolloutDatabaseReader;
              const writer = yield* RolloutDatabaseWriter;
              const receipt = yield* reader
                .table("brainProjectionValidationReceipts")
                .index("by_receipt_key", (query) =>
                  query.eq("receiptKey", receiptKey),
                )
                .first()
                .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
              yield* writer
                .table("brainProjectionValidationReceipts")
                .patch(receipt._id, {
                  publicationPopulationDigest: `sha256:${"f".repeat(64)}`,
                })
                .pipe(Effect.orDie);
            }),
            resultSchema(),
          );
          return yield* confect
            .mutation(refs.switchBrainReadMode, {
              organizationKey,
              workspaceId,
              brainKey,
              receiptKey,
            })
            .pipe(Effect.flip);
        }),
      ).pipe(Effect.provide(rolloutTestLayer())),
    );
    expect(tampered).toMatchObject({ reason: "receipt_tampered" });

    const expired = await Effect.runPromise(
      runCase((confect, workspaceId, receiptKey) =>
        Effect.gen(function* () {
          yield* confect.run(
            Effect.gen(function* () {
              const reader = yield* RolloutDatabaseReader;
              const writer = yield* RolloutDatabaseWriter;
              const receipt = yield* reader
                .table("brainProjectionValidationReceipts")
                .index("by_receipt_key", (query) =>
                  query.eq("receiptKey", receiptKey),
                )
                .first()
                .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
              const patch = {
                issuedAt: 0,
                expiresAt: 1,
              };
              yield* writer
                .table("brainProjectionValidationReceipts")
                .patch(receipt._id, {
                  ...patch,
                  receiptDigest: projectionValidationReceiptDigest({
                    ...receipt,
                    ...patch,
                  }),
                })
                .pipe(Effect.orDie);
            }),
            resultSchema(),
          );
          return yield* confect
            .mutation(refs.switchBrainReadMode, {
              organizationKey,
              workspaceId,
              brainKey,
              receiptKey,
            })
            .pipe(Effect.flip);
        }),
      ).pipe(Effect.provide(rolloutTestLayer())),
    );
    expect(expired).toMatchObject({ reason: "receipt_expired" });

    const advanced = await Effect.runPromise(
      runCase((confect, workspaceId, receiptKey) =>
        Effect.gen(function* () {
          const population = yield* confect.run(
            loadProjectionPopulation(workspaceId),
            resultSchema(),
          );
          yield* confect.run(
            advanceProjectionPopulationEffect({
              workspaceId,
              brainKey,
              expectedGeneration: population.projectionPopulationGeneration,
              now: now + 1,
            }),
            resultSchema(),
          );
          return yield* confect
            .mutation(refs.switchBrainReadMode, {
              organizationKey,
              workspaceId,
              brainKey,
              receiptKey,
            })
            .pipe(Effect.flip);
        }),
      ).pipe(Effect.provide(rolloutTestLayer())),
    );
    expect(advanced).toMatchObject({ reason: "state_changed" });

    const newlyBusy = await Effect.runPromise(
      runCase((confect, workspaceId, receiptKey) =>
        Effect.gen(function* () {
          yield* confect.run(
            enqueueRetrievalPublicationJobEffect(
              {
                organizationKey,
                workspaceId,
                brainKey,
                originKind: "page",
                sourceKey: pageKey,
                sourceRevisionKey: revisionKey,
                requestGeneration: 99,
                page: {
                  authority: "derived",
                  authorityPolicyKey: "rollout-pages",
                  policyGeneration: 1,
                },
              },
              now + 2,
            ),
            resultSchema(),
          );
          return yield* confect
            .mutation(refs.switchBrainReadMode, {
              organizationKey,
              workspaceId,
              brainKey,
              receiptKey,
            })
            .pipe(Effect.flip);
        }),
      ).pipe(Effect.provide(rolloutTestLayer())),
    );
    expect(newlyBusy).toMatchObject({ reason: "state_changed" });
  });

  it("separates immutable legacy completion from the live population generation", () => {
    expect(brainProjectionPopulation.indexes).toEqual({
      by_workspace_brain: ["workspaceId", "brainKey"],
      by_active_run_key: ["activeRunKey"],
      by_job_authority_migration_run_key: ["jobAuthorityMigrationRunKey"],
    });
    const decoded = Schema.decodeUnknownSync(BrainProjectionPopulationRow)({
      schemaVersion: 1,
      organizationKey,
      workspaceId: "workspaces_1",
      brainKey,
      populationKey: `bpop_${"6".repeat(64)}`,
      projectionPopulationGeneration: 3,
      subjectBackfillGeneration: 1,
      fenceBackfillGeneration: 0,
      activeRunKey: `pbrun_${"7".repeat(64)}`,
      activeRunGeneration: 1,
      activePhase: "publication_subjects",
      activeStage: "complete",
      activeCursor: null,
      activeCorpusKey: null,
      activeConnectorScopeKey: null,
      activeConfigurationDigest: configurationDigest,
      scanHighWater: now,
      catchUpHighWater: now + 1,
      validationPopulationGeneration: 3,
      validationPredecessorDigest: emptyDigest,
      validationRestartCount: 1,
      scannedSetCount: 1,
      backfilledSetCount: 1,
      validatedSetCount: 1,
      validatedSubjectCount: 1,
      validatedEntryCount: 1,
      validatedTokenCount: 1,
      conflictCount: 0,
      capacityCount: 0,
      legacySubjectBackfillCompletion: {
        runKey: `pbrun_${"7".repeat(64)}`,
        runGeneration: 1,
        subjectBackfillGeneration: 1,
        scanHighWater: now,
        catchUpHighWater: now + 1,
        populationGeneration: 3,
        populationDigest: emptyDigest,
        setCount: 1,
        subjectCount: 1,
        entryCount: 1,
        tokenCount: 1,
        completedAt: now + 2,
        completionDigest: `sha256:${"8".repeat(64)}`,
      },
      currentFenceSetCount: 0,
      retiredFenceSetCount: 0,
      fenceBackfilledSetCount: 0,
      invalidatedFenceSetCount: 0,
      fenceConflictCount: 0,
      legacyEligibilityFenceBackfillCompletion: null,
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
      createdAt: now,
      updatedAt: now + 2,
    });

    expect(decoded.projectionPopulationGeneration).toBe(3);
    expect(decoded.legacySubjectBackfillCompletion?.completionDigest).toBe(
      `sha256:${"8".repeat(64)}`,
    );
  });

  it("fails canonical publication integrity for collisions, duplicate current sets, and mismatched manifests", () => {
    const publicationSubjectKey = retrievalPublicationSubjectKey({
      workspaceId: "workspaces_1",
      brainKey,
      corpusKey: "pages",
      originTable: "pageRevisions",
      kind: "page",
      sourceKey: pageKey,
    });
    const manifestHash = publicationManifestHash({
      entryKeys: [legacyEntryKey],
      tokens: [{ token: "cobalt", entryKey: legacyEntryKey }],
    });
    const set = {
      workspaceId: "workspaces_1",
      brainKey,
      corpusKey: "pages",
      originKind: "page" as const,
      originTable: "pageRevisions",
      sourceKey: pageKey,
      sourceRevisionKey: revisionKey,
      publicationSubjectKey,
      publicationSetKey: legacyPublicationSetKey,
      publicationGeneration: 1,
      expectedEntryCount: 1,
      expectedTokenCount: 1,
      manifestHash,
      state: "current" as const,
    };
    const subject = {
      workspaceId: "workspaces_1",
      brainKey,
      corpusKey: "pages",
      originKind: "page" as const,
      originTable: "pageRevisions",
      sourceKey: pageKey,
      publicationSubjectKey,
      currentPublicationSetKey: legacyPublicationSetKey,
      lastPublicationGeneration: 1,
    };
    const entry = {
      workspaceId: "workspaces_1",
      brainKey,
      corpusKey: "pages",
      kind: "page" as const,
      originTable: "pageRevisions",
      sourceKey: pageKey,
      sourceRevisionKey: revisionKey,
      publicationSubjectKey,
      publicationSetKey: legacyPublicationSetKey,
      publicationGeneration: 1,
      entryKey: legacyEntryKey,
      state: "published" as const,
    };
    const token = {
      workspaceId: "workspaces_1",
      brainKey,
      publicationSetKey: legacyPublicationSetKey,
      publicationState: "current" as const,
      entryKey: legacyEntryKey,
      token: "cobalt",
    };
    const valid = inspectPublicationIntegrity({
      expectedPublicationSubjectKey: publicationSubjectKey,
      originPresent: true,
      set,
      subjects: [subject],
      subjectHistory: [set],
      entries: [entry],
      tokens: [token],
    });
    expect(valid.issues).toEqual([]);

    const corrupt = inspectPublicationIntegrity({
      expectedPublicationSubjectKey: publicationSubjectKey,
      originPresent: true,
      set: { ...set, manifestHash: `sha256:${"9".repeat(64)}` },
      subjects: [{ ...subject, sourceKey: "collision" }],
      subjectHistory: [
        set,
        { ...set, publicationSetKey: `rset_${"a".repeat(64)}` },
      ],
      entries: [entry],
      tokens: [token],
    });
    expect(corrupt.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "subject_collision",
        "duplicate_current_set",
        "manifest_hash_mismatch",
      ]),
    );
  });

  it("resumes subject backfill and restarts only validation when population advances", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(seedLegacyPublication(workspaceId));
        const args = {
          organizationKey,
          workspaceId,
          brainKey,
          phase: "publication_subjects" as const,
          corpusKey: null,
          connectorScopeKey: null,
          expectedConfigurationDigest: configurationDigest,
          expectedProjectionPopulationGeneration: 0,
          batchSize: 1,
        };
        const started = yield* confect.mutation(
          refs.startProjectionBackfill,
          args,
        );
        const restarted = yield* confect.mutation(
          refs.startProjectionBackfill,
          args,
        );
        let progress = restarted;
        let advancedDuringValidation = false;
        for (
          let attempt = 0;
          attempt < 30 && !progress.terminal;
          attempt += 1
        ) {
          if (
            progress.stage.startsWith("validate_") &&
            !advancedDuringValidation
          ) {
            yield* confect.run(
              advanceProjectionPopulationEffect({
                workspaceId,
                brainKey,
                expectedGeneration: progress.projectionPopulationGeneration,
                now: now + attempt + 1,
              }),
              resultSchema(),
            );
            advancedDuringValidation = true;
          }
          progress = yield* confect.mutation(refs.resumeProjectionBackfill, {
            runKey: progress.runKey,
            expectedRunGeneration: progress.runGeneration,
            batchSize: 1,
          });
        }
        if (progress.terminal)
          yield* confect.run(
            advanceProjectionPopulationEffect({
              workspaceId,
              brainKey,
              expectedGeneration: progress.projectionPopulationGeneration,
              now: now + 100,
            }),
            resultSchema(),
          );
        const population = yield* confect.run(
          loadProjectionPopulation(workspaceId),
          resultSchema(),
        );
        const legacyProjection = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const tokens = yield* reader
              .table("retrievalTokens")
              .index("by_workspace_brain_publication_set_entry", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("publicationSetKey", legacyPublicationSetKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const catalogs = yield* reader
              .table("retrievalTokenCatalog")
              .index("by_workspace_brain_token", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("token", "cobalt"),
              )
              .take(2)
              .pipe(Effect.orDie);
            return { tokens, catalogs };
          }),
          resultSchema(),
        );
        return { started, restarted, progress, population, legacyProjection };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.restarted).toMatchObject({
      runKey: result.started.runKey,
      runGeneration: result.started.runGeneration,
    });
    expect(result.progress).toMatchObject({
      stage: "complete",
      terminal: true,
      conflictCount: 0,
      capacityCount: 0,
    });
    expect(result.population).toMatchObject({
      subjectBackfillGeneration: 1,
      activeStage: "complete",
      validationRestartCount: 1,
      legacySubjectBackfillCompletion: {
        completionDigest: result.progress.legacyCompletionDigest,
      },
    });
    const completion = result.population.legacySubjectBackfillCompletion;
    if (completion === null) throw new Error("missing immutable completion");
    expect(result.population.projectionPopulationGeneration).toBeGreaterThan(
      completion.populationGeneration,
    );
    expect(result.legacyProjection.tokens).toEqual([
      expect.objectContaining({
        publicationSetKey: legacyPublicationSetKey,
        publicationState: "current",
        token: "cobalt",
      }),
    ]);
    expect(result.legacyProjection.catalogs).toEqual([
      expect.objectContaining({
        organizationKey,
        brainKey,
        token: "cobalt",
        ...retrievalTokenCatalogProjection(result.legacyProjection.tokens),
      }),
    ]);
  });

  it("resumes eligibility-fence backfill across a concurrent retire and retains pre-fence citations", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(seedLegacyPublication(workspaceId));

        let subjectProgress = yield* confect.mutation(
          refs.startProjectionBackfill,
          {
            organizationKey,
            workspaceId,
            brainKey,
            phase: "publication_subjects",
            corpusKey: null,
            connectorScopeKey: null,
            expectedConfigurationDigest: configurationDigest,
            expectedProjectionPopulationGeneration: 0,
            batchSize: 1,
          },
        );
        for (
          let attempt = 0;
          attempt < 40 && !subjectProgress.terminal;
          attempt += 1
        )
          subjectProgress = yield* confect.mutation(
            refs.resumeProjectionBackfill,
            {
              runKey: subjectProgress.runKey,
              expectedRunGeneration: subjectProgress.runGeneration,
              batchSize: 1,
            },
          );
        let population = yield* confect.run(
          loadProjectionPopulation(workspaceId),
          resultSchema(),
        );
        let jobProgress = yield* confect.mutation(
          refs.migrateLegacyPublicationJobAuthority,
          {
            organizationKey,
            workspaceId,
            brainKey,
            expectedConfigurationDigest: configurationDigest,
            expectedProjectionPopulationGeneration:
              population.projectionPopulationGeneration,
            batchSize: 1,
          },
        );
        for (
          let attempt = 0;
          attempt < 10 && !jobProgress.terminal;
          attempt += 1
        )
          jobProgress = yield* confect.mutation(
            refs.resumeLegacyPublicationJobAuthorityMigration,
            {
              runKey: jobProgress.runKey,
              expectedRunGeneration: jobProgress.runGeneration,
              batchSize: 1,
            },
          );
        yield* confect.run(
          publishSecondProjection(workspaceId),
          resultSchema(),
        );
        population = yield* confect.run(
          loadProjectionPopulation(workspaceId),
          resultSchema(),
        );
        const fenceArgs = {
          organizationKey,
          workspaceId,
          brainKey,
          phase: "eligibility_fences" as const,
          corpusKey: null,
          connectorScopeKey: null,
          expectedConfigurationDigest: configurationDigest,
          expectedProjectionPopulationGeneration:
            population.projectionPopulationGeneration,
          batchSize: 1,
        };
        const started = yield* confect.mutation(
          refs.startProjectionBackfill,
          fenceArgs,
        );
        const restarted = yield* confect.mutation(
          refs.startProjectionBackfill,
          fenceArgs,
        );
        let fenceProgress = yield* confect.mutation(
          refs.resumeProjectionBackfill,
          {
            runKey: restarted.runKey,
            expectedRunGeneration: restarted.runGeneration,
            batchSize: 1,
          },
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const writer = yield* RolloutDatabaseWriter;
            const currentSets = yield* reader
              .table("retrievalPublicationSets")
              .index("by_workspace_brain_state_publication_set", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("state", "current"),
              )
              .take(2)
              .pipe(Effect.orDie);
            const current = currentSets[0];
            if (currentSets.length !== 1 || current === undefined)
              return yield* Effect.dieMessage(
                `Expected one current set before the concurrent retire; found ${JSON.stringify(
                  currentSets.map((set) => ({
                    publicationSetKey: set.publicationSetKey,
                    sourceRevisionKey: set.sourceRevisionKey,
                  })),
                )}.`,
              );
            yield* writer
              .table("retrievalPublicationSets")
              .patch(current._id, { state: "retired", retiredAt: now + 10 })
              .pipe(Effect.orDie);
            yield* advanceProjectionPopulationEffect({
              workspaceId,
              brainKey,
              expectedGeneration: fenceProgress.projectionPopulationGeneration,
              now: now + 10,
            });
          }),
          resultSchema(),
        );
        for (
          let attempt = 0;
          attempt < 40 && !fenceProgress.terminal;
          attempt += 1
        )
          fenceProgress = yield* confect.mutation(
            refs.resumeProjectionBackfill,
            {
              runKey: fenceProgress.runKey,
              expectedRunGeneration: fenceProgress.runGeneration,
              batchSize: 1,
            },
          );
        const finalPopulation = yield* confect.run(
          loadProjectionPopulation(workspaceId),
          resultSchema(),
        );
        const sets = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            return yield* reader
              .table("retrievalPublicationSets")
              .index("by_workspace_brain_state_publication_set", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("state", "retired"),
              )
              .take(10)
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        return {
          started,
          restarted,
          subjectProgress,
          jobProgress,
          fenceProgress,
          finalPopulation,
          sets,
        };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.subjectProgress).toMatchObject({
      phase: "publication_subjects",
      stage: "complete",
    });
    expect(result.jobProgress).toMatchObject({
      stage: "complete",
      conflictCount: 0,
    });
    expect(result.restarted).toMatchObject({
      runKey: result.started.runKey,
      runGeneration: result.started.runGeneration,
    });
    expect(result.fenceProgress).toMatchObject({
      phase: "eligibility_fences",
      stage: "complete",
      terminal: true,
      current: 0,
      retired: 2,
      fenceBackfilled: 1,
      invalidated: 0,
      conflictCount: 0,
    });
    expect(result.sets).toHaveLength(2);
    expect(
      result.sets.every(
        ({ eligibilityFences }) => eligibilityFences?.length === 1,
      ),
    ).toBe(true);
    expect(result.finalPopulation).toMatchObject({
      fenceBackfillGeneration: 1,
      legacyEligibilityFenceBackfillCompletion: {
        currentSetCount: 0,
        retiredSetCount: 2,
        backfilledSetCount: 1,
        conflictCount: 0,
        completionDigest: result.fenceProgress.fenceCompletionDigest,
      },
    });
  });

  it("supersedes eligibility-fence validation when a scanned controller advances", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(seedLegacyPublication(workspaceId));
        const population = yield* completeProjectionPrerequisites(workspaceId);
        let progress = yield* confect.mutation(refs.startProjectionBackfill, {
          organizationKey,
          workspaceId,
          brainKey,
          phase: "eligibility_fences",
          corpusKey: null,
          connectorScopeKey: null,
          expectedConfigurationDigest: configurationDigest,
          expectedProjectionPopulationGeneration:
            population.projectionPopulationGeneration,
          batchSize: 1,
        });
        for (
          let attempt = 0;
          attempt < 20 && !progress.stage.startsWith("fence_validate_");
          attempt += 1
        )
          progress = yield* confect.mutation(refs.resumeProjectionBackfill, {
            runKey: progress.runKey,
            expectedRunGeneration: progress.runGeneration,
            batchSize: 1,
          });
        if (!progress.stage.startsWith("fence_validate_"))
          return yield* Effect.dieMessage(
            `Expected fence validation, found ${progress.stage}.`,
          );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const writer = yield* RolloutDatabaseWriter;
            const pages = yield* reader
              .table("brainPages")
              .index("by_workspace_page_key", (query) =>
                query.eq("workspaceId", workspaceId).eq("pageKey", pageKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const page = pages[0];
            if (pages.length !== 1 || page === undefined)
              return yield* Effect.dieMessage(
                "Expected one page controller to advance.",
              );
            yield* writer
              .table("brainPages")
              .patch(page._id, {
                status: "archived",
                lifecycle: {
                  state: "archived",
                  generation: 2,
                  updatedAt: now + 20,
                  purgeAfter: null,
                },
                updatedAt: now + 20,
              })
              .pipe(Effect.orDie);
            yield* transitionEligibilityFenceEffect({
              identity: pageLifecycleFenceIdentity({
                organizationKey,
                workspaceId: String(workspaceId),
                pageKey,
              }),
              eligible: false,
              now: now + 20,
            });
          }),
          resultSchema(),
        );
        progress = yield* confect.mutation(refs.resumeProjectionBackfill, {
          runKey: progress.runKey,
          expectedRunGeneration: progress.runGeneration,
          batchSize: 1,
        });
        const finalPopulation = yield* confect.run(
          loadProjectionPopulation(workspaceId),
          resultSchema(),
        );
        return { progress, finalPopulation };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.progress).toMatchObject({
      phase: "eligibility_fences",
      stage: "superseded",
      terminal: true,
    });
    expect(
      result.finalPopulation.legacyEligibilityFenceBackfillCompletion,
    ).toBeNull();
  });

  it("blocks eligibility-fence completion on a wrong-controller collision", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(seedLegacyPublication(workspaceId));
        const population = yield* completeProjectionPrerequisites(workspaceId);
        const identity = pageLifecycleFenceIdentity({
          organizationKey,
          workspaceId: String(workspaceId),
          pageKey,
        });
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* RolloutDatabaseWriter;
            yield* writer
              .table("retrievalEligibilityFences")
              .insert({
                schemaVersion: 1,
                organizationKey,
                fenceKey: retrievalEligibilityFenceKey(identity),
                kind: identity.kind,
                controllerKey: `${identity.controllerKey}:collision`,
                eligibilityGeneration: 1,
                eligible: true,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        let progress = yield* confect.mutation(refs.startProjectionBackfill, {
          organizationKey,
          workspaceId,
          brainKey,
          phase: "eligibility_fences",
          corpusKey: null,
          connectorScopeKey: null,
          expectedConfigurationDigest: configurationDigest,
          expectedProjectionPopulationGeneration:
            population.projectionPopulationGeneration,
          batchSize: 1,
        });
        for (let attempt = 0; attempt < 20 && !progress.terminal; attempt += 1)
          progress = yield* confect.mutation(refs.resumeProjectionBackfill, {
            runKey: progress.runKey,
            expectedRunGeneration: progress.runGeneration,
            batchSize: 1,
          });
        const finalPopulation = yield* confect.run(
          loadProjectionPopulation(workspaceId),
          resultSchema(),
        );
        return { progress, finalPopulation };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.progress).toMatchObject({
      stage: "blocked",
      terminal: true,
      conflictCount: 1,
    });
    expect(result.finalPopulation).toMatchObject({
      fenceConflictCount: 1,
      legacyEligibilityFenceBackfillCompletion: null,
    });
  });

  it("excludes a canonically invalidated retired citation from fence backfill", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(seedLegacyPublication(workspaceId));
        const prerequisitePopulation =
          yield* completeProjectionPrerequisites(workspaceId);
        const receipt = publicationCitationInvalidationReceipt({
          organizationKey,
          workspaceId: String(workspaceId),
          brainKey,
          publicationSetKey: legacyPublicationSetKey,
          reason: "operator_invalidated",
          invalidatedAt: now + 5,
        });
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const writer = yield* RolloutDatabaseWriter;
            const sets = yield* reader
              .table("retrievalPublicationSets")
              .index("by_workspace_publication_set", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("publicationSetKey", legacyPublicationSetKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const set = sets[0];
            if (sets.length !== 1 || set === undefined)
              return yield* Effect.dieMessage(
                "Expected one retired citation to invalidate.",
              );
            yield* writer
              .table("retrievalPublicationSets")
              .patch(set._id, {
                state: "retired",
                retiredAt: now + 5,
                citationInvalidationReceipt: receipt,
              })
              .pipe(Effect.orDie);
            yield* advanceProjectionPopulationEffect({
              workspaceId,
              brainKey,
              expectedGeneration:
                prerequisitePopulation.projectionPopulationGeneration,
              now: now + 5,
            });
          }),
          resultSchema(),
        );
        const population = yield* confect.run(
          loadProjectionPopulation(workspaceId),
          resultSchema(),
        );
        let progress = yield* confect.mutation(refs.startProjectionBackfill, {
          organizationKey,
          workspaceId,
          brainKey,
          phase: "eligibility_fences",
          corpusKey: null,
          connectorScopeKey: null,
          expectedConfigurationDigest: configurationDigest,
          expectedProjectionPopulationGeneration:
            population.projectionPopulationGeneration,
          batchSize: 1,
        });
        for (let attempt = 0; attempt < 30 && !progress.terminal; attempt += 1)
          progress = yield* confect.mutation(refs.resumeProjectionBackfill, {
            runKey: progress.runKey,
            expectedRunGeneration: progress.runGeneration,
            batchSize: 1,
          });
        const finalPopulation = yield* confect.run(
          loadProjectionPopulation(workspaceId),
          resultSchema(),
        );
        return { progress, finalPopulation };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.progress).toMatchObject({
      stage: "complete",
      terminal: true,
      current: 0,
      retired: 1,
      fenceBackfilled: 0,
      invalidated: 1,
      conflictCount: 0,
    });
    expect(result.finalPopulation).toMatchObject({
      legacyEligibilityFenceBackfillCompletion: {
        currentSetCount: 0,
        retiredSetCount: 1,
        backfilledSetCount: 0,
        invalidatedSetCount: 1,
        conflictCount: 0,
        completionDigest: result.progress.fenceCompletionDigest,
      },
    });
  });

  it("resumably replaces actionable legacy jobs and preserves terminal history", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(seedLegacyPublicationJobs(workspaceId));
        const startArgs = {
          organizationKey,
          workspaceId,
          brainKey,
          expectedConfigurationDigest: configurationDigest,
          expectedProjectionPopulationGeneration: 0,
          batchSize: 1,
        };
        const started = yield* confect.mutation(
          refs.migrateLegacyPublicationJobAuthority,
          startArgs,
        );
        const restarted = yield* confect.mutation(
          refs.migrateLegacyPublicationJobAuthority,
          startArgs,
        );
        let progress = restarted;
        for (let attempt = 0; attempt < 20 && !progress.terminal; attempt += 1)
          progress = yield* confect.mutation(
            refs.resumeLegacyPublicationJobAuthorityMigration,
            {
              runKey: progress.runKey,
              expectedRunGeneration: progress.runGeneration,
              batchSize: 1,
            },
          );
        const beforeAdvance = yield* confect.run(
          loadProjectionPopulation(workspaceId),
          resultSchema(),
        );
        yield* confect.run(
          advanceProjectionPopulationEffect({
            workspaceId,
            brainKey,
            expectedGeneration: beforeAdvance.projectionPopulationGeneration,
            now: now + 10,
          }),
          resultSchema(),
        );
        const state = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const jobs = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_workspace_brain_job", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(10)
              .pipe(Effect.orDie);
            const population = yield* loadProjectionPopulation(workspaceId);
            return { jobs, population };
          }),
          resultSchema(),
        );
        return { started, restarted, progress, state };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.restarted).toMatchObject({
      runKey: result.started.runKey,
      runGeneration: result.started.runGeneration,
    });
    expect(result.progress).toMatchObject({
      stage: "complete",
      terminal: true,
      processed: 2,
      replaced: 1,
      conflictCount: 0,
    });
    const legacyPending = result.state.jobs.find(
      ({ jobKey }) => jobKey === legacyPendingJobKey,
    );
    const legacySucceeded = result.state.jobs.find(
      ({ jobKey }) => jobKey === legacySucceededJobKey,
    );
    const replacements = result.state.jobs.filter(
      ({ effectClass }) => effectClass === "migration_replacement",
    );
    expect(legacyPending).toMatchObject({
      status: "superseded",
      supersededByJobKey: replacements[0]?.jobKey,
    });
    expect(legacySucceeded).toMatchObject({ status: "succeeded" });
    expect(legacySucceeded?.supersededByJobKey).toBeUndefined();
    expect(replacements).toEqual([
      expect.objectContaining({
        status: "pending",
        authorityEnvelope: expect.objectContaining({
          supersedesJobKey: legacyPendingJobKey,
        }),
      }),
    ]);
    expect(
      result.state.population.legacyJobAuthorityMigrationCompletion,
    ).toMatchObject({
      completionDigest: result.progress.completionDigest,
      replacementJobCount: 1,
      conflictCount: 0,
    });
    expect(
      result.state.population.projectionPopulationGeneration,
    ).toBeGreaterThan(
      result.state.population.legacyJobAuthorityMigrationCompletion
        ?.populationGeneration ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("registers transcript-order backfill and keeps typed conflicts promotion-blocking", async () => {
    expect(transcriptRevisionOrderMigrations.indexes).toEqual({
      by_organization: ["organizationKey"],
      by_active_run_key: ["activeRunKey"],
    });
    expect(transcriptRevisionOrderMigrationItems.indexes).toEqual({
      by_run_unit: ["runKey", "unitKey"],
      by_organization_run: ["organizationKey", "runKey"],
    });
    expect(
      rolloutOperations.functions.backfillTranscriptRevisionOrder,
    ).toMatchObject({ functionVisibility: "internal" });
    expect(
      rolloutOperations.functions.resumeTranscriptRevisionOrderBackfill,
    ).toMatchObject({ functionVisibility: "internal" });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const rows = buildCallSourceUnitRows(
          {
            providerKey: "fireflies",
            connectionKey: "conn_rollout_transcript",
            externalCallId: "call_rollout_legacy",
            externalRevisionId: "revision_rollout_legacy",
            revisionOrder: {
              kind: "provider_timestamp",
              timestamp: "2026-08-05T14:00:00.000Z",
              source: "updated_at",
            },
            title: "Legacy rollout call",
            startedAt: "2026-08-05T14:00:00.000Z",
            endedAt: null,
            durationMs: null,
            organizer: null,
            participants: [],
            segments: [
              {
                externalSegmentId: "call_rollout_legacy:0",
                ordinal: 0,
                evidenceKind: "verbatim_transcript",
                speakerExternalId: null,
                speakerLabel: "Speaker",
                startMs: 0,
                endMs: null,
                text: "Legacy transcript without adapter-order evidence.",
              },
            ],
            sourceUrl: "https://example.com/call_rollout_legacy",
            recordingUrl: null,
            providerSummary: null,
            providerMetadataJson: "{}",
            deleted: false,
          },
          {
            organizationKey,
            connectionGeneration: 1,
            receivedAt: now,
          },
        );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* RolloutDatabaseWriter;
            const {
              currentRevisionOrder: _unitOrder,
              currentRevisionOrderVersion: _unitVersion,
              ...legacyUnit
            } = rows.unit;
            const {
              revisionOrder: _revisionOrder,
              revisionOrderVersion: _revisionVersion,
              ...legacyRevision
            } = rows.revision;
            void _unitOrder;
            void _unitVersion;
            void _revisionOrder;
            void _revisionVersion;
            yield* writer
              .table("sourceUnits")
              .insert(legacyUnit)
              .pipe(Effect.orDie);
            yield* writer
              .table("sourceUnitRevisions")
              .insert(legacyRevision)
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        let progress = yield* confect.mutation(
          refs.backfillTranscriptRevisionOrder,
          {
            organizationKey,
            adapterOrderVersion: TRANSCRIPT_ADAPTER_ORDER_VERSION,
            batchSize: 1,
          },
        );
        for (let attempt = 0; attempt < 5 && !progress.terminal; attempt += 1)
          progress = yield* confect.mutation(
            refs.resumeTranscriptRevisionOrderBackfill,
            {
              runKey: progress.runKey,
              expectedRunGeneration: progress.runGeneration,
              batchSize: 1,
            },
          );
        const migration = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            return yield* reader
              .table("transcriptRevisionOrderMigrations")
              .index("by_organization", (query) =>
                query.eq("organizationKey", organizationKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          }),
          resultSchema(),
        );
        return { progress, migration };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.progress).toMatchObject({
      stage: "blocked",
      processed: 1,
      conflictCount: 1,
      blockingConflict: "missing_provider_version",
      readyForPromotion: false,
      completionDigest: null,
    });
    expect(result.migration.completion).toBeNull();
  });

  it("pauses with an active lease, drains before resume, and rejects a stale epoch", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        const pauseKey = publicationPauseKey({
          organizationKey,
          workspaceId,
          brainKey,
          scopeKey: operatorScopeKey,
        });
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* RolloutDatabaseWriter;
            yield* writer
              .table("brainPublicationWorkerLeases")
              .insert({
                schemaVersion: 1,
                organizationKey,
                workspaceId,
                brainKey,
                scopeKey: operatorScopeKey,
                pauseKey,
                leaseKey: `bpwl_${"a".repeat(64)}`,
                jobKey: `rjob_${"a".repeat(64)}`,
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
        const paused = yield* confect.mutation(refs.pausePublicationWorkers, {
          organizationKey,
          workspaceId,
          brainKey,
          scopeKey: operatorScopeKey,
          operationKey: operationKey("1"),
          reason: "operator recovery",
          dryRun: false,
          now,
        });
        const blockedResume = yield* confect
          .mutation(refs.resumePublicationWorkers, {
            organizationKey,
            workspaceId,
            brainKey,
            scopeKey: operatorScopeKey,
            operationKey: operationKey("2"),
            expectedPauseEpoch: paused.pauseEpoch,
            reason: "resume after drain",
            dryRun: false,
            now: now + 1,
          })
          .pipe(Effect.flip);
        const drained = yield* confect.mutation(
          refs.drainPublicationWorkerLeases,
          {
            organizationKey,
            workspaceId,
            brainKey,
            scopeKey: operatorScopeKey,
            expectedPauseEpoch: paused.pauseEpoch,
            batchSize: 1,
            dryRun: false,
            now: now + 2,
          },
        );
        const resumed = yield* confect.mutation(refs.resumePublicationWorkers, {
          organizationKey,
          workspaceId,
          brainKey,
          scopeKey: operatorScopeKey,
          operationKey: operationKey("3"),
          expectedPauseEpoch: paused.pauseEpoch,
          reason: "leases drained",
          dryRun: false,
          now: now + 3,
        });
        const repaused = yield* confect.mutation(refs.pausePublicationWorkers, {
          organizationKey,
          workspaceId,
          brainKey,
          scopeKey: operatorScopeKey,
          operationKey: operationKey("4"),
          reason: "second recovery",
          dryRun: false,
          now: now + 4,
        });
        const staleResume = yield* confect
          .mutation(refs.resumePublicationWorkers, {
            organizationKey,
            workspaceId,
            brainKey,
            scopeKey: operatorScopeKey,
            operationKey: operationKey("5"),
            expectedPauseEpoch: paused.pauseEpoch,
            reason: "stale resume",
            dryRun: false,
            now: now + 5,
          })
          .pipe(Effect.flip);
        const status = yield* confect.query(
          refs.getPublicationWorkerLeaseStatus,
          {
            organizationKey,
            workspaceId,
            brainKey,
            scopeKey: operatorScopeKey,
          },
        );
        return {
          paused,
          blockedResume,
          drained,
          resumed,
          repaused,
          staleResume,
          status,
        };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.paused).toMatchObject({
      pauseEpoch: 1,
      state: "paused",
      activeLeaseCount: 1,
    });
    expect(result.blockedResume).toMatchObject({ reason: "active_leases" });
    expect(result.drained).toMatchObject({
      drainedLeaseCount: 1,
      activeLeaseCount: 0,
      hasMore: false,
    });
    expect(result.resumed).toMatchObject({ state: "running", pauseEpoch: 1 });
    expect(result.repaused).toMatchObject({ state: "paused", pauseEpoch: 2 });
    expect(result.staleResume).toMatchObject({ reason: "generation_changed" });
    expect(result.status).toMatchObject({
      state: "paused",
      pauseEpoch: 2,
      activeLeaseCount: 0,
    });
  });

  it("repairs only the named obligation and persists quarantine disposition", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(
          seedRequiredIntent(workspaceId, [
            "failed",
            "captured",
            "capacity_blocked",
          ]),
          resultSchema(),
        );
        const repaired = yield* confect.mutation(
          refs.repairIngestionObligation,
          {
            organizationKey,
            workspaceId,
            brainKey,
            scopeKey: operatorScopeKey,
            operationKey: operationKey("6"),
            ingestionObligationKey: `iobl_${"1".repeat(64)}`,
            mode: "retry",
            reason: "retry exact provider failure",
            dryRun: false,
            now: now + 1,
          },
        );
        const quarantined = yield* confect.mutation(
          refs.quarantineIngestionObligation,
          {
            organizationKey,
            workspaceId,
            brainKey,
            scopeKey: operatorScopeKey,
            operationKey: operationKey("7"),
            ingestionObligationKey: `iobl_${"2".repeat(64)}`,
            reason: "durable manual quarantine",
            dryRun: false,
            now: now + 2,
          },
        );
        const attributed = yield* confect.mutation(
          refs.repairIngestionObligation,
          {
            organizationKey,
            workspaceId,
            brainKey,
            scopeKey: operatorScopeKey,
            operationKey: operationKey("b"),
            ingestionObligationKey: `iobl_${"3".repeat(64)}`,
            mode: "attributed_repair",
            reason: "reprocess the exact capacity failure",
            dryRun: false,
            now: now + 3,
          },
        );
        const rows = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const obligations = yield* reader
              .table("ingestionObligations")
              .index("by_required_intent_state", (query) =>
                query.eq("requiredScopeIntentKey", requiredScopeIntentKey),
              )
              .take(10)
              .pipe(Effect.orDie);
            const receipts = yield* reader
              .table("brainOperationReceipts")
              .index("by_workspace_brain_created", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(10)
              .pipe(Effect.orDie);
            const repairEffects = yield* reader
              .table("ingestionObligationRepairEffects")
              .index("by_state_updated", (query) => query.eq("state", "queued"))
              .take(10)
              .pipe(Effect.orDie);
            return { obligations, receipts, repairEffects };
          }),
          resultSchema(),
        );
        return { repaired, quarantined, attributed, rows };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.repaired).toMatchObject({
      targetKey: `iobl_${"1".repeat(64)}`,
      priorState: "failed",
      resultState: "retry_wait",
    });
    expect(result.quarantined).toMatchObject({
      ingestionObligationKey: `iobl_${"2".repeat(64)}`,
      resultState: "quarantined",
      reason: "durable manual quarantine",
    });
    expect(result.attributed).toMatchObject({
      targetKey: `iobl_${"3".repeat(64)}`,
      mode: "attributed_repair",
      priorState: "capacity_blocked",
      resultState: "retry_wait",
      repairEffectKey: expect.stringMatching(/^irep_[a-f0-9]{64}$/),
    });
    expect(result.rows.obligations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingestionObligationKey: `iobl_${"1".repeat(64)}`,
          state: "retry_wait",
        }),
        expect.objectContaining({
          ingestionObligationKey: `iobl_${"2".repeat(64)}`,
          state: "quarantined",
          errorTag: "durable manual quarantine",
        }),
        expect.objectContaining({
          ingestionObligationKey: `iobl_${"3".repeat(64)}`,
          state: "retry_wait",
          errorTag: "capacity_exceeded",
          terminalAt: null,
        }),
      ]),
    );
    expect(result.rows.repairEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingestionObligationKey: `iobl_${"1".repeat(64)}`,
          mode: "retry",
          state: "queued",
        }),
        expect.objectContaining({
          ingestionObligationKey: `iobl_${"3".repeat(64)}`,
          mode: "attributed_repair",
          state: "queued",
        }),
      ]),
    );
    expect(result.rows.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "quarantine_ingestion_obligation",
          reason: "durable manual quarantine",
        }),
      ]),
    );
  });

  it("attributes a dead-letter repair without clearing unrelated dead letters", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        const seeded = yield* confect.run(
          seedAttributedDeadLetters(workspaceId),
          resultSchema(),
        );
        const repaired = yield* confect.mutation(
          refs.repairPublicationDeadLetter,
          {
            organizationKey,
            workspaceId,
            brainKey,
            scopeKey: "brain-pages",
            operationKey: operationKey("a"),
            publicationJobKey: seeded.targetJobKey,
            mode: "attributed_repair",
            reason: "repair only the attributed failed effect",
            dryRun: false,
            now: now + 1,
          },
        );
        if (repaired.repairEffectKey === null)
          return yield* Effect.dieMessage("Expected an attributed repair job.");
        const executed = yield* confect.run(
          runPublicationJobEffect({
            jobKey: repaired.repairEffectKey,
            caller: {
              kind: "system",
              name: "attributed-repair-test",
              surface: "internal",
            },
            now: now + 2,
          }),
          resultSchema(),
        );
        const firstRecurringRepair = yield* confect.mutation(
          refs.repairPublicationDeadLetter,
          {
            organizationKey,
            workspaceId,
            brainKey,
            scopeKey: "brain-pages",
            operationKey: operationKey("c"),
            publicationJobKey: seeded.recurringJobKey,
            mode: "retry",
            reason: "retry recurring failure version one",
            dryRun: false,
            now: now + 3,
          },
        );
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const writer = yield* RolloutDatabaseWriter;
            const recurring = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_job_key", (query) =>
                query.eq("jobKey", seeded.recurringJobKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            yield* writer
              .table("retrievalPublicationJobs")
              .patch(recurring._id, {
                status: "dead_letter",
                attemptCount: 5,
                lastErrorTag: "ProviderUnavailableAgain",
                completedAt: now + 4,
                updatedAt: now + 4,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const secondRecurringRepair = yield* confect.mutation(
          refs.repairPublicationDeadLetter,
          {
            organizationKey,
            workspaceId,
            brainKey,
            scopeKey: "brain-pages",
            operationKey: operationKey("d"),
            publicationJobKey: seeded.recurringJobKey,
            mode: "retry",
            reason: "retry recurring failure version two",
            dryRun: false,
            now: now + 5,
          },
        );
        const rows = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const jobs = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_workspace_brain_job", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(10)
              .pipe(Effect.orDie);
            const receipts = yield* reader
              .table("brainOperationReceipts")
              .index("by_workspace_brain_created", (query) =>
                query.eq("workspaceId", workspaceId).eq("brainKey", brainKey),
              )
              .take(10)
              .pipe(Effect.orDie);
            const health = yield* reader
              .table("brainCorpusHealth")
              .index("by_workspace_brain_corpus_scope_connection", (query) =>
                query
                  .eq("workspaceId", workspaceId)
                  .eq("brainKey", brainKey)
                  .eq("corpusKey", "brain-pages")
                  .eq("connectorScopeKey", undefined)
                  .eq("connectionGeneration", undefined),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            return { jobs, receipts, health };
          }),
          resultSchema(),
        );
        return {
          repaired,
          executed,
          firstRecurringRepair,
          secondRecurringRepair,
          seeded,
          rows,
        };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.repaired).toMatchObject({
      targetKey: result.seeded.targetJobKey,
      mode: "attributed_repair",
      priorState: "dead_letter",
      resultState: "repair_pending",
    });
    expect(result.repaired.repairEffectKey).toMatch(/^rjob_[a-f0-9]{64}$/);
    expect(result.executed).toMatchObject({ status: "succeeded" });
    expect(result.firstRecurringRepair).toMatchObject({
      priorState: "dead_letter",
      resultState: "retry_wait",
    });
    expect(result.secondRecurringRepair).toMatchObject({
      priorState: "dead_letter",
      resultState: "retry_wait",
    });
    expect(result.secondRecurringRepair.receiptKey).not.toBe(
      result.firstRecurringRepair.receiptKey,
    );
    expect(result.rows.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobKey: result.seeded.targetJobKey,
          status: "superseded",
          supersededByJobKey: result.repaired.repairEffectKey,
          lastErrorTag: "AttributedRepairSucceeded",
        }),
        expect.objectContaining({
          jobKey: result.seeded.unrelatedJobKey,
          status: "dead_letter",
          lastErrorTag: "ProviderUnavailable",
        }),
        expect.objectContaining({
          jobKey: result.repaired.repairEffectKey,
          effectClass: "attributed_repair",
          status: "succeeded",
          authorityEnvelope: expect.objectContaining({
            repairOfJobKey: result.seeded.targetJobKey,
          }),
        }),
      ]),
    );
    expect(result.rows.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "repair_publication_dead_letter",
          targetKey: result.seeded.targetJobKey,
          linkedEffectKey: result.repaired.repairEffectKey,
        }),
      ]),
    );
    expect(result.rows.health).toMatchObject({
      coverageStatus: "partial",
      failedCount: 2,
    });
  });

  it("decommissions in batches and fences a stale generation after restore", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
        );
        const { workspaceId } = yield* confect.run(
          seedProjectedPage,
          resultSchema(),
        );
        yield* confect.run(
          seedRequiredIntent(workspaceId, ["failed", "captured"]),
          resultSchema(),
        );
        const args = {
          organizationKey,
          workspaceId,
          brainKey,
          scopeKey: operatorScopeKey,
          operationKey: operationKey("8"),
          requiredScopeIntentKey,
          expectedIntentGeneration: 1,
          expectedControllingConfigurationDigest: configurationDigest,
          approvedBy: "owner@example.com",
          reason: "scope intentionally removed",
          batchSize: 1,
          dryRun: false,
          now: now + 1,
        } as const;
        const first = yield* confect.mutation(
          refs.decommissionRequiredScope,
          args,
        );
        const second = yield* confect.mutation(refs.decommissionRequiredScope, {
          ...args,
          now: now + 2,
        });
        const replay = yield* confect.mutation(refs.decommissionRequiredScope, {
          ...args,
          now: now + 3,
        });
        yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const writer = yield* RolloutDatabaseWriter;
            const intent = yield* reader
              .table("brainRequiredScopeIntents")
              .index("by_required_scope_intent_key", (query) =>
                query.eq("requiredScopeIntentKey", requiredScopeIntentKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            yield* writer
              .table("brainRequiredScopeIntents")
              .patch(intent._id, {
                intentGeneration: 2,
                controllingConfigurationDigest: restoredConfigurationDigest,
                state: "required",
                decommissionGeneration: null,
                decommissionedAt: null,
                activatedAt: now + 4,
                updatedAt: now + 4,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        );
        const stale = yield* confect
          .mutation(refs.decommissionRequiredScope, {
            ...args,
            operationKey: operationKey("9"),
            now: now + 5,
          })
          .pipe(Effect.flip);
        const state = yield* confect.run(
          Effect.gen(function* () {
            const reader = yield* RolloutDatabaseReader;
            const intent = yield* reader
              .table("brainRequiredScopeIntents")
              .index("by_required_scope_intent_key", (query) =>
                query.eq("requiredScopeIntentKey", requiredScopeIntentKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            const obligations = yield* reader
              .table("ingestionObligations")
              .index("by_required_intent_state", (query) =>
                query.eq("requiredScopeIntentKey", requiredScopeIntentKey),
              )
              .take(10)
              .pipe(Effect.orDie);
            const receipt = yield* reader
              .table("brainOperationReceipts")
              .index("by_operation_key", (query) =>
                query
                  .eq("organizationKey", organizationKey)
                  .eq("operationKey", operationKey("8")),
              )
              .first()
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            return { intent, obligations, receipt };
          }),
          resultSchema(),
        );
        return { first, second, replay, stale, state };
      }).pipe(Effect.provide(rolloutTestLayer())),
    );

    expect(result.first).toMatchObject({
      resultState: "required",
      excludedObligationCount: 1,
      hasMore: true,
      receiptKey: expect.stringMatching(/^bopr_[a-f0-9]{64}$/),
    });
    expect(result.second).toMatchObject({
      receiptKey: result.first.receiptKey,
      resultState: "decommissioned",
      excludedObligationCount: 1,
      hasMore: false,
    });
    expect(result.replay).toMatchObject({
      receiptKey: result.second.receiptKey,
      resultState: "decommissioned",
      hasMore: false,
    });
    expect(result.stale).toMatchObject({ reason: "generation_changed" });
    expect(result.state.intent).toMatchObject({
      state: "required",
      intentGeneration: 2,
      controllingConfigurationDigest: restoredConfigurationDigest,
    });
    expect(result.state.obligations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "policy_excluded" }),
        expect.objectContaining({ state: "policy_excluded" }),
      ]),
    );
    expect(result.state.receipt).toMatchObject({
      operation: "decommission_required_scope",
      expectedGeneration: 1,
      resultGeneration: 1,
      controllingConfigurationDigest: configurationDigest,
      resultState: "decommission_authorized",
      approvedBy: "owner@example.com",
    });
  });
});
