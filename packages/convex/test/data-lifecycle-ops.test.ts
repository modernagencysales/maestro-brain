import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { MemberNotInWorkspace, Unauthorized } from "../confect/errors";
import dataLifecycleImpl from "../confect/ops/dataLifecycle.impl";
import dataLifecycle, {
  BrainExportDownloadArgs,
  BrainExportRequestArgs,
  BrainExportStatusArgs,
  CreateDsarRequestArgs,
  DsarRequestReturn,
  ListDsarRequestsArgs,
  ListDsarRequestsReturn,
  manifest as dataLifecycleManifest,
  schemaRegistry as dataLifecycleSchemaRegistry,
} from "../confect/ops/dataLifecycle.spec";
import brainExportJobs from "../confect/tables/brainExportJobs";
import dsarRequests, { DsarRequestRow } from "../confect/tables/dsarRequests";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { purgePageOriginEffect } from "../confect/ops/dataLifecycle.impl";
import {
  enqueueRetrievalPublicationJobEffect,
  runPublicationJobEffect,
} from "../confect/brain/retrievalPublication.impl";
import {
  pageLifecycleFenceIdentity,
  transitionEligibilityFenceEffect,
} from "../confect/brain/retrievalEligibility";
import { testConfectLayer } from "./support/confect";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";

const lifecycleNow = 1_782_924_800_000;
const lifecycleBrainKey = "br_0123456789ABCDEFGHJKMNPQRS";
const lifecycleOrganizationKey = "ag_0123456789ABCDEFGHJKMNPQRS";
const lifecyclePageKey = "pag_lifecycle_purge";
const lifecycleRevisionKey = "rev_lifecycle_purge_1";

const seedLifecyclePage = Effect.gen(function* () {
  const seeded = yield* seedTenancy(lifecycleNow);
  const writer = yield* DatabaseWriter;
  yield* writer
    .table("organizations")
    .patch(seeded.organizationId, { agencyKey: lifecycleOrganizationKey })
    .pipe(Effect.orDie);
  yield* writer
    .table("workspaces")
    .patch(seeded.workspaceId, {
      brainKey: lifecycleBrainKey,
      kind: "agency",
      lifecycleGeneration: 1,
    })
    .pipe(Effect.orDie);
  const lifecycle = {
    state: "active" as const,
    generation: 1,
    updatedAt: lifecycleNow,
    purgeAfter: null,
  };
  yield* writer
    .table("brainPages")
    .insert({
      workspaceId: seeded.workspaceId,
      organizationId: seeded.organizationId,
      slug: "lifecycle-purge",
      title: "Lifecycle purge",
      markdown: "# Lifecycle\n\nCopied projection text must be deleted.",
      sourceKind: "markdown",
      updatedAt: lifecycleNow,
      pageKey: lifecyclePageKey,
      parentPageKey: null,
      siblingSlug: "lifecycle-purge",
      sortKey: "0000000001",
      favorite: false,
      status: "active",
      currentRevisionKey: lifecycleRevisionKey,
      lifecycle,
      createdAt: lifecycleNow,
      schemaVersion: 1,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("pageRevisions")
    .insert({
      workspaceId: seeded.workspaceId,
      organizationId: seeded.organizationId,
      pageKey: lifecyclePageKey,
      revisionKey: lifecycleRevisionKey,
      priorRevisionKey: null,
      blockNoteJson: "",
      markdown: "# Lifecycle\n\nCopied projection text must be deleted.",
      contentHash: "lifecycle-purge-hash",
      causation: "import",
      actor: { kind: "migration", id: "lifecycle-test" },
      modelReceiptKey: null,
      effectKey: "lifecycle-purge:1",
      state: "published",
      lifecycle,
      createdAt: lifecycleNow,
      schemaVersion: 1,
    })
    .pipe(Effect.orDie);
  return seeded;
});

const lifecyclePageJobInput = (workspaceId: SeededTenancy["workspaceId"]) => ({
  organizationKey: lifecycleOrganizationKey,
  workspaceId,
  brainKey: lifecycleBrainKey,
  originKind: "page" as const,
  sourceKey: lifecyclePageKey,
  sourceRevisionKey: lifecycleRevisionKey,
  requestGeneration: 1,
  page: {
    authority: "derived" as const,
    authorityPolicyKey: "company-pages",
    policyGeneration: 1,
  },
});

const lifecycleSystemCaller = {
  kind: "system" as const,
  name: "data-lifecycle-purge-test",
  surface: "internal" as const,
};

const markLifecyclePagePurged = (workspaceId: SeededTenancy["workspaceId"]) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const page = yield* reader
      .table("brainPages")
      .index("by_workspace_page_key", (query) =>
        query.eq("workspaceId", workspaceId).eq("pageKey", lifecyclePageKey),
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
          updatedAt: lifecycleNow + 1,
          purgeAfter: lifecycleNow + 1,
        },
        updatedAt: lifecycleNow + 1,
      })
      .pipe(Effect.orDie);
    return yield* transitionEligibilityFenceEffect({
      identity: pageLifecycleFenceIdentity({
        organizationKey: lifecycleOrganizationKey,
        workspaceId: String(workspaceId),
        pageKey: lifecyclePageKey,
      }),
      eligible: false,
      now: lifecycleNow + 1,
    });
  });

const readPurgeState = (workspaceId: SeededTenancy["workspaceId"]) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const lifecycleIdentity = pageLifecycleFenceIdentity({
      organizationKey: lifecycleOrganizationKey,
      workspaceId: String(workspaceId),
      pageKey: lifecyclePageKey,
    });
    const [pages, revisions, subjects, entries, fences] = yield* Effect.all([
      reader
        .table("brainPages")
        .index("by_workspace", (query) => query.eq("workspaceId", workspaceId))
        .take(10)
        .pipe(Effect.orDie),
      reader
        .table("pageRevisions")
        .index("by_page_created", (query) =>
          query.eq("workspaceId", workspaceId).eq("pageKey", lifecyclePageKey),
        )
        .take(10)
        .pipe(Effect.orDie),
      reader
        .table("retrievalPublicationSubjects")
        .index("by_workspace_brain_subject", (query) =>
          query
            .eq("workspaceId", workspaceId)
            .eq("brainKey", lifecycleBrainKey),
        )
        .take(10)
        .pipe(Effect.orDie),
      reader
        .table("retrievalEntries")
        .index("by_workspace_brain_revision_entry", (query) =>
          query
            .eq("workspaceId", workspaceId)
            .eq("brainKey", lifecycleBrainKey)
            .eq("sourceRevisionKey", lifecycleRevisionKey),
        )
        .take(100)
        .pipe(Effect.orDie),
      reader
        .table("retrievalEligibilityFences")
        .index("by_organization_kind_controller", (query) =>
          query
            .eq("organizationKey", lifecycleOrganizationKey)
            .eq("kind", "lifecycle")
            .eq("controllerKey", lifecycleIdentity.controllerKey),
        )
        .take(10)
        .pipe(Effect.orDie),
    ]);
    const subject = subjects[0];
    const sets =
      subject === undefined
        ? []
        : yield* reader
            .table("retrievalPublicationSets")
            .index("by_workspace_subject_generation", (query) =>
              query
                .eq("workspaceId", workspaceId)
                .eq("publicationSubjectKey", subject.publicationSubjectKey),
            )
            .take(100)
            .pipe(Effect.orDie);
    const tokenGroups = yield* Effect.all(
      sets.map((set) =>
        reader
          .table("retrievalTokens")
          .index("by_workspace_brain_publication_set_entry", (query) =>
            query
              .eq("workspaceId", workspaceId)
              .eq("brainKey", lifecycleBrainKey)
              .eq("publicationSetKey", set.publicationSetKey),
          )
          .take(1_000)
          .pipe(Effect.orDie),
      ),
    );
    return {
      pages: pages.length,
      revisions: revisions.length,
      subjects: subjects.length,
      sets: sets.length,
      entries: entries.length,
      tokens: tokenGroups.flat().length,
      fences: fences.length,
      subjectCurrentPublicationSetKey:
        subject?.currentPublicationSetKey ?? null,
      subjectLastPublicationGeneration:
        subject?.lastPublicationGeneration ?? null,
      fenceEligible: fences[0]?.eligible ?? null,
      fenceGeneration: fences[0]?.eligibilityGeneration ?? null,
      tombstoneJson: JSON.stringify({ subjects, fences }),
    };
  });

describe("data lifecycle Confect contracts", () => {
  it("deletes retrieval content before the final page origin and retains tombstones", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(seedLifecyclePage, Schema.Any);
        const jobKey = yield* confect.run(
          enqueueRetrievalPublicationJobEffect(
            lifecyclePageJobInput(seeded.workspaceId),
            lifecycleNow,
          ),
          Schema.Any,
        );
        yield* confect.run(
          runPublicationJobEffect({
            jobKey,
            caller: lifecycleSystemCaller,
            now: lifecycleNow,
          }),
          Schema.Any,
        );
        const before = yield* confect.run(
          readPurgeState(seeded.workspaceId),
          Schema.Any,
        );
        yield* confect.run(
          markLifecyclePagePurged(seeded.workspaceId),
          Schema.Any,
        );
        const purged = yield* confect.run(
          purgePageOriginEffect({
            organizationKey: lifecycleOrganizationKey,
            workspaceId: seeded.workspaceId,
            brainKey: lifecycleBrainKey,
            pageKey: lifecyclePageKey,
            expectedLifecycleGeneration: 2,
            now: lifecycleNow + 1,
          }),
          Schema.Any,
        );
        const after = yield* confect.run(
          readPurgeState(seeded.workspaceId),
          Schema.Any,
        );
        return { before, purged, after };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.before).toMatchObject({
      pages: 1,
      revisions: 1,
      subjects: 1,
      sets: 1,
    });
    expect(result.before.entries).toBeGreaterThan(0);
    expect(result.before.tokens).toBeGreaterThan(0);
    expect(result.purged).toMatchObject({
      outcome: "purged",
      deletedOrigins: 2,
      deletedSets: 1,
    });
    expect(result.after).toMatchObject({
      pages: 0,
      revisions: 0,
      entries: 0,
      tokens: 0,
      sets: 0,
      subjects: 1,
      fences: 1,
      subjectCurrentPublicationSetKey: null,
      subjectLastPublicationGeneration: 1,
      fenceEligible: false,
      fenceGeneration: 2,
    });
    expect(result.after.tombstoneJson).not.toContain("Copied projection text");
  });

  it("purges an unpublished page with no subject or derived rows", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(seedLifecyclePage, Schema.Any);
        yield* confect.run(
          markLifecyclePagePurged(seeded.workspaceId),
          Schema.Any,
        );
        const purged = yield* confect.run(
          purgePageOriginEffect({
            organizationKey: lifecycleOrganizationKey,
            workspaceId: seeded.workspaceId,
            brainKey: lifecycleBrainKey,
            pageKey: lifecyclePageKey,
            expectedLifecycleGeneration: 2,
            now: lifecycleNow + 1,
          }),
          Schema.Any,
        );
        const after = yield* confect.run(
          readPurgeState(seeded.workspaceId),
          Schema.Any,
        );
        return { purged, after };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.purged).toMatchObject({
      outcome: "purged",
      deletedOrigins: 2,
      deletedSets: 0,
      deletedEntries: 0,
      deletedTokens: 0,
      lastPublicationGeneration: 0,
    });
    expect(result.after).toMatchObject({
      pages: 0,
      revisions: 0,
      subjects: 0,
      sets: 0,
      entries: 0,
      tokens: 0,
      fences: 1,
      fenceEligible: false,
      fenceGeneration: 1,
    });
  });

  it("declares web-only Brain export contracts and the export-job indexes", () => {
    expect(
      Schema.decodeUnknownSync(BrainExportRequestArgs)({
        brainKey: "br_export_123",
        idempotencyKey: "export_123",
      }),
    ).toMatchObject({ idempotencyKey: "export_123" });
    expect(
      Schema.decodeUnknownSync(BrainExportStatusArgs)({
        brainKey: "br_export_123",
        jobId: "bex_123",
      }),
    ).toMatchObject({ jobId: "bex_123" });
    expect(
      Schema.decodeUnknownSync(BrainExportDownloadArgs)({
        brainKey: "br_export_123",
        jobId: "bex_123",
      }),
    ).toMatchObject({ jobId: "bex_123" });
    expect(brainExportJobs.indexes).toMatchObject({
      by_job_id: ["jobId"],
      by_org_idempotency: ["organizationKey", "idempotencyKey"],
    });
    expect(dataLifecycleManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: "ops.dataLifecycle.requestBrainExport",
          kind: "mutation",
          surfaces: ["web"],
          idempotent: true,
        }),
        expect.objectContaining({
          operationId: "ops.dataLifecycle.getBrainExport",
          kind: "query",
          surfaces: ["web"],
          idempotent: true,
        }),
        expect.objectContaining({
          operationId: "ops.dataLifecycle.downloadBrainExport",
          kind: "query",
          surfaces: ["web"],
          idempotent: true,
        }),
      ]),
    );
  });

  it("declares DSAR request audit indexes", () => {
    expect(dsarRequests.indexes).toMatchObject({
      by_workspace: ["workspaceId"],
      by_workspace_request: ["workspaceId", "requestId"],
      by_workspace_status: ["workspaceId", "status"],
      by_requested_by: ["requestedByUserId"],
    });
  });

  it("validates DSAR request args, rows, and returns with Effect schemas", () => {
    expect(
      Schema.decodeUnknownSync(CreateDsarRequestArgs)({
        workspaceId: "workspaces_123",
        requestId: "dsar_export_123",
        kind: "export",
        subjectId: "users_123",
      }),
    ).toMatchObject({ requestId: "dsar_export_123", kind: "export" });

    expect(() =>
      Schema.decodeUnknownSync(CreateDsarRequestArgs)({
        workspaceId: "workspaces_123",
        requestId: "",
        kind: "export",
      }),
    ).toThrow();

    const row = {
      workspaceId: "workspaces_123",
      requestId: "dsar_delete_123",
      requestedByUserId: "users_123",
      subjectId: "users_456",
      kind: "delete",
      status: "needs-confirmation",
      dryRunOnly: true,
      plannedAt: 1_782_924_800_000,
      confirmationPhrase: "delete workspace_WRONG",
      exportManifest: [],
      deletePlan: [],
    };

    expect(Schema.decodeUnknownSync(DsarRequestRow)(row)).toMatchObject({
      dryRunOnly: true,
      status: "needs-confirmation",
    });
    expect(
      Schema.decodeUnknownSync(DsarRequestReturn)({
        ...row,
        confirmation: {
          required: true,
          phrase: "delete workspaces_123",
          reason: "workspace data deletion is destructive and audited",
        },
      }),
    ).toMatchObject({ requestId: "dsar_delete_123" });

    expect(
      Schema.decodeUnknownSync(ListDsarRequestsArgs)({
        workspaceId: "workspaces_123",
      }),
    ).toMatchObject({ workspaceId: "workspaces_123" });
    expect(
      Schema.decodeUnknownSync(ListDsarRequestsReturn)({
        requests: [
          {
            ...row,
            confirmation: {
              required: true,
              phrase: "delete workspaces_123",
              reason: "workspace data deletion is destructive and audited",
            },
          },
        ],
      }),
    ).toMatchObject({
      requests: [expect.objectContaining({ kind: "delete" })],
    });
  });

  it("registers data lifecycle functions and exports a finalized implementation", () => {
    expect(JSON.stringify(dataLifecycle)).toContain("createDsarRequest");
    expect(JSON.stringify(dataLifecycle)).toContain("listDsarRequests");
    expect(dataLifecycleImpl).toMatchObject({
      _op_layer: "Fold",
    });
  });

  it("exports web-only manifest metadata for DSAR operations", () => {
    expect(dataLifecycleManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: "ops.dataLifecycle.createDsarRequest",
          kind: "mutation",
          surfaces: ["web"],
          idempotent: true,
          argsSchemaName: "ops.dataLifecycle.createDsarRequest.args",
          returnsSchemaName: "ops.dataLifecycle.createDsarRequest.returns",
        }),
        expect.objectContaining({
          operationId: "ops.dataLifecycle.listDsarRequests",
          kind: "query",
          surfaces: ["web"],
          idempotent: true,
          argsSchemaName: "ops.dataLifecycle.listDsarRequests.args",
          returnsSchemaName: "ops.dataLifecycle.listDsarRequests.returns",
        }),
      ]),
    );
    expect(
      dataLifecycleManifest.some((entry) =>
        entry.surfaces.some((surface) =>
          ["api", "cli", "mcp"].includes(surface),
        ),
      ),
    ).toBe(false);
    expect(Object.keys(dataLifecycleSchemaRegistry).sort()).toEqual([
      "ops.dataLifecycle.createDsarRequest.args",
      "ops.dataLifecycle.createDsarRequest.returns",
      "ops.dataLifecycle.downloadBrainExport.args",
      "ops.dataLifecycle.downloadBrainExport.returns",
      "ops.dataLifecycle.getBrainExport.args",
      "ops.dataLifecycle.getBrainExport.returns",
      "ops.dataLifecycle.listDsarRequests.args",
      "ops.dataLifecycle.listDsarRequests.returns",
      "ops.dataLifecycle.requestBrainExport.args",
      "ops.dataLifecycle.requestBrainExport.returns",
    ]);
  });

  it("persists a tenant-guarded dry-run DSAR request plan", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedTenancy(1_782_924_800_000),
        SeededTenancy,
      );
      const created = yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
        })
        .mutation(refs.public.ops.dataLifecycle.createDsarRequest, {
          workspaceId: seeded.workspaceId,
          requestId: "dsar_delete_123",
          kind: "delete",
          subjectId: "users_subject_123",
          confirmationPhrase: "delete wrong_workspace",
        });
      const rows = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const found = yield* reader
            .table("dsarRequests")
            .index("by_workspace_request", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("requestId", "dsar_delete_123"),
            )
            .collect()
            .pipe(Effect.orDie);

          return {
            count: found.length,
            firstRequestId: found[0]?.requestId ?? "",
            firstRequestedByUserId: found[0]?.requestedByUserId ?? "",
            firstStatus: found[0]?.status ?? "ready-for-review",
            firstDryRunOnly: found[0]?.dryRunOnly ?? false,
          };
        }),
        Schema.Struct({
          count: Schema.Number,
          firstRequestId: Schema.String,
          firstRequestedByUserId: Schema.String,
          firstStatus: Schema.Literal(
            "ready-for-review",
            "needs-confirmation",
            "blocked-by-legal-hold",
          ),
          firstDryRunOnly: Schema.Boolean,
        }),
      );

      return { created, rows, seeded };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.created).toMatchObject({
      workspaceId: result.seeded.workspaceId,
      requestId: "dsar_delete_123",
      requestedByUserId: result.seeded.memberUserId,
      kind: "delete",
      status: "needs-confirmation",
      dryRunOnly: true,
    });
    expect(
      result.created.exportManifest.map((entry) => entry.resourceId),
    ).toContain("featureFlagPolicies");
    expect(
      result.created.deletePlan.every((entry) => entry.executable === false),
    ).toBe(true);
    expect(result.rows).toMatchObject({
      count: 1,
      firstRequestId: "dsar_delete_123",
      firstRequestedByUserId: result.seeded.memberUserId,
      firstStatus: "needs-confirmation",
      firstDryRunOnly: true,
    });
  });

  it("treats repeated DSAR request ids as idempotent audit records", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedTenancy(1_782_924_800_000),
        SeededTenancy,
      );
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const first = yield* actor.mutation(
        refs.public.ops.dataLifecycle.createDsarRequest,
        {
          workspaceId: seeded.workspaceId,
          requestId: "dsar_retry_123",
          kind: "delete",
          confirmationPhrase: "delete wrong_workspace",
        },
      );
      const retried = yield* actor.mutation(
        refs.public.ops.dataLifecycle.createDsarRequest,
        {
          workspaceId: seeded.workspaceId,
          requestId: "dsar_retry_123",
          kind: "delete",
          confirmationPhrase: `delete ${seeded.workspaceId}`,
        },
      );

      return { first, retried };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.first.status).toBe("needs-confirmation");
    expect(result.retried).toMatchObject({
      requestId: result.first.requestId,
      status: "needs-confirmation",
      plannedAt: result.first.plannedAt,
      confirmationPhrase: "delete wrong_workspace",
    });
  });

  it("rejects workspace outsiders with a typed error", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedTenancy(1_782_924_800_000),
        SeededTenancy,
      );

      return yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
        })
        .mutation(refs.public.ops.dataLifecycle.createDsarRequest, {
          workspaceId: seeded.workspaceId,
          requestId: "dsar_outsider_123",
          kind: "export",
        })
        .pipe(Effect.flip);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result).toBeInstanceOf(MemberNotInWorkspace);
    expect(result._tag).toBe("MemberNotInWorkspace");
  });

  it("rejects unauthenticated DSAR requests with a typed error", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedTenancy(1_782_924_800_000),
        SeededTenancy,
      );

      return yield* confect
        .mutation(refs.public.ops.dataLifecycle.createDsarRequest, {
          workspaceId: seeded.workspaceId,
          requestId: "dsar_unauthenticated_123",
          kind: "export",
        })
        .pipe(Effect.flip);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result).toBeInstanceOf(Unauthorized);
    expect(result._tag).toBe("Unauthorized");
  });

  it("lists DSAR request audit rows for workspace viewers", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedTenancy(1_782_924_800_000),
        SeededTenancy,
      );
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* actor.mutation(refs.public.ops.dataLifecycle.createDsarRequest, {
        workspaceId: seeded.workspaceId,
        requestId: "dsar_export_list_123",
        kind: "export",
      });
      yield* actor.mutation(refs.public.ops.dataLifecycle.createDsarRequest, {
        workspaceId: seeded.workspaceId,
        requestId: "dsar_delete_list_123",
        kind: "delete",
        confirmationPhrase: "delete wrong_workspace",
      });

      return yield* actor.query(
        refs.public.ops.dataLifecycle.listDsarRequests,
        {
          workspaceId: seeded.workspaceId,
        },
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.requests.map((request) => request.requestId)).toEqual([
      "dsar_delete_list_123",
      "dsar_export_list_123",
    ]);
    expect(result.requests.every((request) => request.dryRunOnly)).toBe(true);
    expect(
      result.requests.every((request) =>
        request.deletePlan.every((entry) => entry.executable === false),
      ),
    ).toBe(true);
  });

  it("rejects outsider DSAR request listing with a typed error", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedTenancy(1_782_924_800_000),
        SeededTenancy,
      );

      return yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
        })
        .query(refs.public.ops.dataLifecycle.listDsarRequests, {
          workspaceId: seeded.workspaceId,
        })
        .pipe(Effect.flip);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result).toBeInstanceOf(MemberNotInWorkspace);
    expect(result._tag).toBe("MemberNotInWorkspace");
  });
});
