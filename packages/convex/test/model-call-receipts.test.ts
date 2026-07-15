import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  appendModelCallReceipt,
  writeModelCallReceipt,
  ModelReceiptDuplicate,
  ModelReceiptTenantMismatch,
} from "../confect/modelReceipts/repository";
import databaseSchema from "../confect/_generated/schema";
import { testConfectLayer } from "./support/confect";
import modelCallReceipts, {
  ModelCallReceiptRow,
  ModelCallState,
} from "../confect/tables/modelCallReceipts";

describe("model call receipt table", () => {
  it("declares append-friendly attempt, tenant, state, hash, and provider indexes", () => {
    expect(modelCallReceipts.indexes).toMatchObject({
      by_workspace: ["workspaceId"],
      by_attempt: ["attemptKey"],
      by_workspace_attempt: ["workspaceId", "attemptKey"],
      by_workspace_state: ["workspaceId", "state"],
      by_request_hash: ["requestHash"],
      by_source_hash: ["sourceHash"],
      by_provider_model: ["provider", "model"],
    });
  });

  it("validates lifecycle states and stores only hashes/usage, not raw prompts", () => {
    expect(Schema.decodeUnknownSync(ModelCallState)("queued")).toBe("queued");
    expect(Schema.decodeUnknownSync(ModelCallState)("succeeded")).toBe(
      "succeeded",
    );
    expect(() => Schema.decodeUnknownSync(ModelCallState)("unknown")).toThrow();

    const row = Schema.decodeUnknownSync(ModelCallReceiptRow)({
      organizationId: "org_123",
      workspaceId: "workspaces_123",
      attemptKey: "attempt-001",
      provider: "openrouter",
      model: "openrouter/fake-structured",
      region: "us",
      state: "succeeded",
      trustedInstructionVersion: "classify-v1",
      toolSchemaVersion: "routing-v1",
      schemaGeneration: 1,
      policyGeneration: 3,
      lifecycleGeneration: 7,
      redactionState: "none",
      requestHash: "sha256:req",
      responseHash: "sha256:res",
      sourceHash: "sha256:source",
      inputTokens: 10,
      outputTokens: 5,
      costCents: 1,
      latencyMs: 12,
      createdAt: 1770000000000,
    });

    expect(row).toMatchObject({
      organizationId: "org_123",
      schemaGeneration: 1,
      policyGeneration: 3,
      lifecycleGeneration: 7,
      redactionState: "none",
      requestHash: "sha256:req",
      responseHash: "sha256:res",
    });
    expect(JSON.stringify(row)).not.toContain("prompt");
    expect(JSON.stringify(row)).not.toContain("completion");
  });
});

describe("model call receipt repository", () => {
  const receipt = {
    organizationId: "org_123",
    workspaceId: "workspaces_123",
    attemptKey: "attempt-001",
    provider: "openrouter",
    model: "openrouter/fake-structured",
    region: "us",
    state: "succeeded",
    trustedInstructionVersion: "classify-v1",
    toolSchemaVersion: "routing-v1",
    schemaGeneration: 1,
    policyGeneration: 3,
    lifecycleGeneration: 7,
    redactionState: "none",
    requestHash: "sha256:req",
    responseHash: "sha256:res",
    sourceHash: "sha256:source",
    inputTokens: 10,
    outputTokens: 5,
    costCents: 1,
    latencyMs: 12,
    createdAt: 1770000000000,
  } as const;

  it("derives tenant fences and rejects wrong-org/workspace/stale-generation writes", () => {
    const existing: (typeof receipt)[] = [];
    expect(() =>
      appendModelCallReceipt({
        receipt,
        tenant: {
          organizationId: "org_other",
          workspaceId: "workspaces_123",
          lifecycleGeneration: 7,
        },
        existing,
      }),
    ).toThrow(ModelReceiptTenantMismatch);
    expect(() =>
      appendModelCallReceipt({
        receipt,
        tenant: {
          organizationId: "org_123",
          workspaceId: "workspaces_other",
          lifecycleGeneration: 7,
        },
        existing,
      }),
    ).toThrow(ModelReceiptTenantMismatch);
    expect(() =>
      appendModelCallReceipt({
        receipt,
        tenant: {
          organizationId: "org_123",
          workspaceId: "workspaces_123",
          lifecycleGeneration: 8,
        },
        existing,
      }),
    ).toThrow(ModelReceiptTenantMismatch);
  });

  it("persists receipts through DatabaseWriter with tenant-scoped uniqueness", async () => {
    const DuplicateResult = Schema.Struct({ duplicate: Schema.Boolean });
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(
        writeModelCallReceipt({
          receipt,
          tenant: {
            organizationId: "org_123",
            workspaceId: "workspaces_123",
            lifecycleGeneration: 7,
          },
        }),
        ModelCallReceiptRow,
      );
      return yield* confect.run(
        Effect.gen(function* () {
          return yield* writeModelCallReceipt({
            receipt,
            tenant: {
              organizationId: "org_123",
              workspaceId: "workspaces_123",
              lifecycleGeneration: 7,
            },
          }).pipe(
            Effect.match({
              onFailure: (error) => ({
                duplicate: error instanceof ModelReceiptDuplicate,
              }),
              onSuccess: () => ({ duplicate: false }),
            }),
          );
        }),
        DuplicateResult,
      );
    });

    const duplicate = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(duplicate.duplicate).toBe(true);
  });

  it("rejects duplicate attempt writes for the same tenant", () => {
    const existing = [receipt];
    expect(() =>
      appendModelCallReceipt({
        receipt,
        tenant: {
          organizationId: "org_123",
          workspaceId: "workspaces_123",
          lifecycleGeneration: 7,
        },
        existing,
      }),
    ).toThrow(ModelReceiptDuplicate);
  });
});
