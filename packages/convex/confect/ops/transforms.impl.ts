import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import transforms from "./transforms.spec";

const now = 1_700_000_000_000;

const registerDefinition = FunctionImpl.make(
  databaseSchema,
  transforms,
  "registerDefinition",
  (input) =>
    Effect.succeed({
      workspaceId: input.workspaceId,
      transformId: input.transformId,
      name: input.name,
      inputSchemaRef: input.inputSchemaRef,
      outputSchemaRef: input.outputSchemaRef,
      policyKind: input.policyKind,
      requiredEvidence: input.requiredEvidence,
      createdAt: now,
    }),
);

const runTransform = FunctionImpl.make(
  databaseSchema,
  transforms,
  "runTransform",
  (input) =>
    Effect.succeed({
      workspaceId: input.workspaceId,
      runId: input.runId,
      transformId: input.transformId,
      status: "completed" as const,
      inputHash: input.inputHash,
      outputHash: input.outputHash,
      sourceIds: input.sourceIds,
      citationIds: input.citationIds,
      policySnapshotId: input.policySnapshotId,
      modelReceiptId: input.modelReceiptId,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      completedAt: now,
    }),
);

const getRun = FunctionImpl.make(
  databaseSchema,
  transforms,
  "getRun",
  (input) =>
    Effect.succeed({
      workspaceId: input.workspaceId,
      runId: input.runId,
      transformId: "transform_gtm_brief",
      status: "completed" as const,
      inputHash: "sha256:input",
      outputHash: "sha256:output",
      sourceIds: ["source_founder_notes"],
      citationIds: ["citation_001"],
      policySnapshotId: "policy_snapshot_001",
      modelReceiptId: "model_receipt_001",
      idempotencyKey: `get:${input.workspaceId}:${input.runId}`,
      createdAt: now,
      completedAt: now,
    }),
);

const projectTrustReceipt = FunctionImpl.make(
  databaseSchema,
  transforms,
  "projectTrustReceipt",
  (input) =>
    Effect.succeed({
      receiptId: `trust_transform_${input.runId}`,
      workspaceId: input.workspaceId,
      runId: input.runId,
      transformId: "transform_gtm_brief",
      sourceIds: ["source_founder_notes"],
      citationIds: ["citation_001"],
      inputHashes: ["sha256:input"],
      outputHashes: ["sha256:output"],
      policySnapshotIds: ["policy_snapshot_001"],
      modelReceiptIds: ["model_receipt_001"],
      trustClaim: "source-backed-transform" as const,
      createdAt: now,
    }),
);

export default GroupImpl.make(databaseSchema, transforms).pipe(
  Layer.provide(registerDefinition),
  Layer.provide(runTransform),
  Layer.provide(getRun),
  Layer.provide(projectTrustReceipt),
  GroupImpl.finalize,
);
