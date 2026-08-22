import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import type { GenericId, Value } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import generatedConvexSchema from "../confect/_generated/convexSchema";
import {
  FeedbackCategory,
  FeedbackDisposition,
  FeedbackReportInput,
  FeedbackReportResult,
} from "../confect/brain/feedbackSchema";
import {
  feedbackDatabaseSchema,
  FeedbackDatabaseReader,
  FeedbackDatabaseWriter,
} from "../confect/brain/feedbackDatabase";
import {
  feedbackPayloadHash,
  writeFeedbackReport,
} from "../confect/brain/feedbackRepository";
import feedbackSpec, {
  manifest as feedbackManifest,
} from "../confect/brain/feedback.spec";
import { reviewedHeadlessPolicyFor } from "../confect/headless/authorizeOperation";
import { createBrainApiKey } from "../confect/headless/auth";
import { handleTemplateHttpRequest, templateHttpRoutes } from "../confect/http";
import brainFeedbackReports from "../confect/tables/brainFeedbackReports";

const feedbackConvexSchema = defineSchema({
  ...generatedConvexSchema.tables,
  brainFeedbackReports:
    feedbackDatabaseSchema.tables.brainFeedbackReports.tableDefinition,
});
const feedbackTestLayer = TestConfect.layer(
  feedbackDatabaseSchema,
  feedbackConvexSchema,
  import.meta.glob("../convex/**/!(*.*.*)*.*s"),
);
const resultSchema = <Result>(): Schema.Schema<Result, Value> =>
  Schema.Any as unknown as Schema.Schema<Result, Value>;

const now = 1_787_270_400_000;
const organizationKeyA = "ag_0123456789ABCDEFGHJKMNPQRS";
const organizationKeyB = "ag_1123456789ABCDEFGHJKMNPQRS";
const brainKeyA = "br_0123456789ABCDEFGHJKMNPQRS";
const brainKeyB = "br_1123456789ABCDEFGHJKMNPQRS";
const publicationSetKeyA = `rset_${"a".repeat(64)}`;
const publicationSetKeyB = `rset_${"b".repeat(64)}`;
const entryKeyA = `rent_${"c".repeat(64)}`;
const entryKeyB = `rent_${"d".repeat(64)}`;
const citationA = {
  publicationSetKey: publicationSetKeyA,
  entryKey: entryKeyA,
};

const inputA: FeedbackReportInput = {
  brainKey: brainKeyA,
  idempotencyKey: "dogfood-session.failure.0001",
  requestId: `ctx_${"e".repeat(64)}`,
  candidateManifestHash: `sha256:${"f".repeat(64)}`,
  citations: [citationA],
  readiness: {
    asOf: now - 500,
    coverage: [
      {
        corpusKey: "company-pages",
        sourceKind: "page",
        connectorScopeKey: "brain-pages",
        required: true,
        status: "complete",
        freshness: "current",
        generations: { policy: 3, reconciliation: 7 },
        lastObservedAt: now - 1_000,
        lastReconciledAt: now - 2_000,
        unresolvedFailureCount: 0,
      },
    ],
  },
  category: "stale_source",
  disposition: "untriaged",
  evaluationRerunKey: `evalrun_${"1".repeat(64)}`,
};

type Tenant = {
  readonly organizationId: GenericId<"organizations">;
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
};

const insertTenant = (
  organizationKey: string,
  brainKey: string,
  suffix: string,
  publicationSetKey: string,
  entryKey: string,
) =>
  Effect.gen(function* () {
    const writer = yield* FeedbackDatabaseWriter;
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: `owner-${suffix}`,
        workosOrganizationId: `workos-${suffix}`,
        agencyKey: organizationKey,
        slug: `organization-${suffix}`,
        name: `Organization ${suffix}`,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const workspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: `owner-${suffix}`,
        brainKey,
        slug: `workspace-${suffix}`,
        name: `Workspace ${suffix}`,
        kind: "agency",
        status: "active",
        dataClassification: "internal",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("retrievalEntries")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId,
        brainKey,
        entryKey,
        publicationSetKey,
        publicationGeneration: 1,
        kind: "page",
        corpusKey: "company-pages",
        origin: {
          kind: "page",
          pageKey: `page-${suffix}`,
          revisionKey: `revision-${suffix}`,
        },
        originTable: "brainPages",
        sourceKey: `source-${suffix}`,
        sourceRevisionKey: `revision-${suffix}`,
        passageKey: `rpass_${suffix.repeat(64)}`,
        startOffset: 0,
        endOffset: 12,
        title: "Seed evidence",
        headingPath: null,
        text: "raw evidence text that feedback must never copy",
        contentHash: `sha256:${suffix.repeat(64)}`,
        observedAt: now - 1_000,
        indexedAt: now - 900,
        authority: "authoritative",
        authorityPolicyKey: "company-pages",
        policyGeneration: 1,
        lifecycleGeneration: 1,
        routeGeneration: 1,
        state: "published",
      })
      .pipe(Effect.orDie);
    return {
      organizationId,
      organizationKey,
      workspaceId,
      brainKey,
    } satisfies Tenant;
  });

const setup = Effect.gen(function* () {
  const tenantA = yield* insertTenant(
    organizationKeyA,
    brainKeyA,
    "a",
    publicationSetKeyA,
    entryKeyA,
  );
  const tenantB = yield* insertTenant(
    organizationKeyB,
    brainKeyB,
    "b",
    publicationSetKeyB,
    entryKeyB,
  );
  return { tenantA, tenantB };
});

const write = (tenant: Tenant, input: FeedbackReportInput, createdAt = now) =>
  writeFeedbackReport({
    tenant,
    actor: { kind: "service_principal" as const, id: "headless" },
    input,
    createdAt,
  });

const captureValidation = <Success, Requirements>(
  effect: Effect.Effect<
    Success,
    { readonly _tag: string; readonly field: string },
    Requirements
  >,
) =>
  effect.pipe(
    Effect.match({
      onFailure: (error) => ({
        ok: false as const,
        errorTag: error._tag,
        field: error.field ?? "",
      }),
      onSuccess: () => ({ ok: true as const, errorTag: "", field: "" }),
    }),
  );

describe("brain feedback contract", () => {
  it("uses closed categories/dispositions and exposes an idempotent API mutation only", () => {
    for (const category of [
      "missing_source",
      "stale_source",
      "retrieval_miss",
      "answer_failure",
      "usability_failure",
    ]) {
      expect(Schema.decodeUnknownSync(FeedbackCategory)(category)).toBe(
        category,
      );
    }
    expect(() => Schema.decodeUnknownSync(FeedbackCategory)("other")).toThrow();
    expect(Schema.decodeUnknownSync(FeedbackDisposition)("untriaged")).toBe(
      "untriaged",
    );
    expect(feedbackManifest).toEqual([
      expect.objectContaining({
        operationId: "brain.feedback.reportWrongOrStale",
        kind: "mutation",
        surfaces: ["api"],
        idempotent: true,
      }),
    ]);
    expect(feedbackSpec.functions).toHaveProperty("reportWrongOrStale");
    expect(feedbackSpec.functions).toHaveProperty("headlessReportWrongOrStale");
    expect(
      reviewedHeadlessPolicyFor("brain.feedback.reportWrongOrStale"),
    ).toMatchObject({ requiredScope: "brain:read" });
    expect(templateHttpRoutes).toContainEqual(
      expect.objectContaining({
        path: "/api/brain.feedback.reportWrongOrStale",
        method: "POST",
      }),
    );
  });

  it("declares tenant/idempotency/request indexes and rejects malformed tuples", () => {
    expect(brainFeedbackReports.indexes).toMatchObject({
      by_workspace_report: ["workspaceId", "reportKey"],
      by_workspace_idempotency: ["workspaceId", "idempotencyKey"],
      by_workspace_request: ["workspaceId", "requestId"],
      by_workspace_brain_created: ["workspaceId", "brainKey", "createdAt"],
    });
    expect(() =>
      Schema.decodeUnknownSync(FeedbackReportInput)({
        ...inputA,
        citations: [{ publicationSetKey: "wrong", entryKey: entryKeyA }],
      }),
    ).toThrow();
  });

  it("canonicalizes citation and readiness order for deterministic retries", () => {
    const citationB = {
      publicationSetKey: publicationSetKeyB,
      entryKey: entryKeyB,
    };
    const coverageB = {
      corpusKey: "slack",
      sourceKind: "slack",
      connectorScopeKey: "channel:company",
      required: true,
      status: "partial" as const,
      freshness: "stale" as const,
      generations: { connection: 2, policy: 4 },
      unresolvedFailureCount: 1,
    };
    expect(
      feedbackPayloadHash({
        ...inputA,
        citations: [citationA, citationB],
        readiness: {
          ...inputA.readiness,
          coverage: [...inputA.readiness.coverage, coverageB],
        },
      }),
    ).toBe(
      feedbackPayloadHash({
        ...inputA,
        citations: [citationB, citationA],
        readiness: {
          ...inputA.readiness,
          coverage: [coverageB, ...inputA.readiness.coverage],
        },
      }),
    );
  });

  it("dispatches the API-only route with tenant scope derived from the bearer key", async () => {
    const key = await createBrainApiKey({
      organizationId: "organization_123",
      workspaceId: "workspace_123",
      brainKey: brainKeyA,
      name: "Ask Apero",
      scopes: ["brain:read"],
      actor: { userId: "owner_123", role: "admin" },
      nowMs: now,
      expiresAt: now + 10_000,
      randomBytes: () => new Uint8Array(32).fill(17),
    });
    const principal = {
      organizationId: "organization_123",
      workspaceId: "workspace_123",
      brainKey: brainKeyA,
      roleCeiling: "viewer" as const,
      keyId: key.key.id,
      principalId: key.principal.id,
      scopes: ["brain:read" as const],
    };
    const mutationCalls: unknown[] = [];
    const response = await handleTemplateHttpRequest(
      {
        authenticateRef: "authenticate.ref",
        markLastUsedRef: "markLastUsed.ref",
        operationRefs: {
          "brain.feedback.reportWrongOrStale": "feedback.ref",
        },
        runQuery: async () => ({ principal, keyHash: key.key.keyHash }),
        runMutation: async (ref, args) => {
          mutationCalls.push([ref, args]);
          return ref === "feedback.ref"
            ? {
                reportKey: `fbr_${"2".repeat(64)}`,
                duplicate: false,
                requestId: inputA.requestId,
                createdAt: now,
              }
            : null;
        },
        runAction: async () => undefined,
      },
      new Request(
        "https://example.test/api/brain.feedback.reportWrongOrStale",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${key.displayKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            idempotencyKey: inputA.idempotencyKey,
            input: {
              requestId: inputA.requestId,
              candidateManifestHash: inputA.candidateManifestHash,
              citations: inputA.citations,
              readiness: inputA.readiness,
              category: inputA.category,
              disposition: inputA.disposition,
              evaluationRerunKey: inputA.evaluationRerunKey,
            },
          }),
        },
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      operationId: "brain.feedback.reportWrongOrStale",
    });
    expect(mutationCalls[0]).toEqual([
      "feedback.ref",
      expect.objectContaining({
        organizationId: principal.organizationId,
        workspaceId: principal.workspaceId,
        brainKey: principal.brainKey,
        idempotencyKey: inputA.idempotencyKey,
      }),
    ]);
  });
});

describe("brain feedback repository", () => {
  it("returns the immutable original for identical retries and rejects conflicts", async () => {
    const program = Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof feedbackDatabaseSchema>();
      const { tenantA } = yield* confect.run(setup, resultSchema());
      const first = yield* confect.run(
        write(tenantA, inputA),
        FeedbackReportResult,
      );
      const retry = yield* confect.run(
        write(tenantA, inputA, now + 10_000),
        FeedbackReportResult,
      );
      const conflict = yield* confect.run(
        captureValidation(
          write(tenantA, { ...inputA, category: "answer_failure" }),
        ),
        resultSchema(),
      );
      return { first, retry, conflict };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(feedbackTestLayer())),
    );
    expect(result.first.duplicate).toBe(false);
    expect(result.retry).toMatchObject({
      duplicate: true,
      reportKey: result.first.reportKey,
      createdAt: result.first.createdAt,
    });
    expect(result.conflict).toEqual({
      ok: false,
      errorTag: "ValidationFailed",
      field: "idempotencyKey",
    });
  });

  it("isolates retries and exact citation tuples by tenant", async () => {
    const program = Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof feedbackDatabaseSchema>();
      const { tenantA, tenantB } = yield* confect.run(setup, resultSchema());
      const first = yield* confect.run(
        write(tenantA, inputA),
        FeedbackReportResult,
      );
      const otherTenant = yield* confect.run(
        write(tenantB, {
          ...inputA,
          brainKey: brainKeyB,
          citations: [
            { publicationSetKey: publicationSetKeyB, entryKey: entryKeyB },
          ],
        }),
        FeedbackReportResult,
      );
      const foreignTuple = yield* confect.run(
        captureValidation(
          write(tenantA, {
            ...inputA,
            idempotencyKey: "dogfood-session.failure.0002",
            citations: [
              { publicationSetKey: publicationSetKeyB, entryKey: entryKeyB },
            ],
          }),
        ),
        resultSchema(),
      );
      return { first, otherTenant, foreignTuple };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(feedbackTestLayer())),
    );
    expect(result.otherTenant).toMatchObject({ duplicate: false });
    expect(result.otherTenant.reportKey).not.toBe(result.first.reportKey);
    expect(result.foreignTuple).toEqual({
      ok: false,
      errorTag: "ValidationFailed",
      field: "citations",
    });
  });

  it("rejects duplicate/nonexistent citation tuples and persists no text", async () => {
    const program = Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof feedbackDatabaseSchema>();
      const { tenantA } = yield* confect.run(setup, resultSchema());
      const duplicateTuple = yield* confect.run(
        captureValidation(
          write(tenantA, {
            ...inputA,
            idempotencyKey: "dogfood-session.failure.0002",
            citations: [citationA, citationA],
          }),
        ),
        resultSchema(),
      );
      const nonexistentTuple = yield* confect.run(
        captureValidation(
          write(tenantA, {
            ...inputA,
            idempotencyKey: "dogfood-session.failure.0003",
            citations: [
              {
                publicationSetKey: `rset_${"9".repeat(64)}`,
                entryKey: `rent_${"8".repeat(64)}`,
              },
            ],
          }),
        ),
        resultSchema(),
      );
      yield* confect.run(write(tenantA, inputA), FeedbackReportResult);
      const rows = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* FeedbackDatabaseReader;
          return yield* reader
            .table("brainFeedbackReports")
            .index("by_workspace_brain_created", (query) =>
              query
                .eq("workspaceId", tenantA.workspaceId)
                .eq("brainKey", tenantA.brainKey),
            )
            .collect()
            .pipe(Effect.orDie);
        }),
        resultSchema(),
      );
      return { duplicateTuple, nonexistentTuple, rows };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(feedbackTestLayer())),
    );
    expect(result.duplicateTuple).toEqual({
      ok: false,
      errorTag: "ValidationFailed",
      field: "citations",
    });
    expect(result.nonexistentTuple).toEqual({
      ok: false,
      errorTag: "ValidationFailed",
      field: "citations",
    });
    expect(result.rows).toHaveLength(1);
    const stored = JSON.stringify(result.rows[0]);
    for (const forbidden of [
      "question",
      "text",
      "excerpt",
      "quotedText",
      "raw evidence",
    ]) {
      expect(stored).not.toContain(forbidden);
    }
  });
});
