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
import { publishPageRevisionEffect } from "../confect/brain/retrievalPublication.impl";
import {
  pageLifecycleFenceIdentity,
  transitionEligibilityFenceEffect,
} from "../confect/brain/retrievalEligibility";
import {
  retrievalEligibilityFenceKey,
  retrievalPublicationSubjectKey,
} from "../confect/brain/retrievalPublication";
import rolloutOperationsImpl, {
  advanceProjectionPopulationEffect,
} from "../confect/brain/rolloutOperations.impl";
import rolloutOperations, {
  backfillTranscriptRevisionOrder,
  migrateLegacyPublicationJobAuthority,
  resumeLegacyPublicationJobAuthorityMigration,
  resumeProjectionBackfill,
  resumeTranscriptRevisionOrderBackfill,
  startProjectionBackfill,
} from "../confect/brain/rolloutOperations.spec";
import { buildCallSourceUnitRows } from "../confect/sources/sourceUnit";
import { TRANSCRIPT_ADAPTER_ORDER_VERSION } from "../confect/sources/transcriptRevisionOrder";
import transcriptRevisionOrderMigrationItemsSource from "../confect/tables/transcriptRevisionOrderMigrationItems";
import transcriptRevisionOrderMigrationsSource from "../confect/tables/transcriptRevisionOrderMigrations";
import brainProjectionPopulationSource, {
  BrainProjectionPopulationRow,
} from "../confect/tables/brainProjectionPopulation";
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

const brainReadModes = brainReadModesSource("brainReadModes");
const brainProjectionPopulation = brainProjectionPopulationSource(
  "brainProjectionPopulation",
);
const connectorScopes = connectorScopesSource("connectorScopes");
const connectorAllowlistGenerations = connectorAllowlistGenerationsSource(
  "connectorAllowlistGenerations",
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
  connectorScopes,
  connectorAllowlistGenerations,
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
  connectorScopes: connectorScopes.tableDefinition,
  connectorAllowlistGenerations: connectorAllowlistGenerations.tableDefinition,
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
  mode: "compatibility" | "disabled",
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

  it("declares an additive compatibility-or-disabled mode table", () => {
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
    expect(() =>
      Schema.decodeUnknownSync(BrainReadModeRow)({
        schemaVersion: 1,
        organizationKey,
        workspaceId: "workspaces_1",
        brainKey,
        mode: "projection",
        modeGeneration: 1,
        updatedAt: now,
      }),
    ).toThrow();
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

  it("rejects direct projection inserts and patches at the table schema", async () => {
    const testLayer = rolloutTestLayer();
    const setup = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof rolloutDatabaseSchema>(),
      );
      const { workspaceId } = yield* confect.run(
        seedProjectedPage,
        resultSchema(),
      );
      const modeId = yield* confect.run(
        insertReadMode(workspaceId, "compatibility"),
        resultSchema(),
      );
      return { confect, modeId, workspaceId };
    }).pipe(Effect.provide(testLayer));
    const { confect, modeId, workspaceId } = await Effect.runPromise(setup);

    await expect(
      Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const writer = yield* RolloutDatabaseWriter;
            yield* writer.table("brainReadModes").insert({
              schemaVersion: 1,
              organizationKey,
              workspaceId,
              brainKey: `${brainKey}_projection_insert`,
              mode: "projection",
              modeGeneration: 1,
              updatedAt: now,
            } as never);
          }),
        ),
      ),
    ).rejects.toThrow();
    await expect(
      Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const writer = yield* RolloutDatabaseWriter;
            yield* writer
              .table("brainReadModes")
              .patch(modeId, { mode: "projection" } as never);
          }),
        ),
      ),
    ).rejects.toThrow();
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
        return { started, restarted, progress, population };
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
});
