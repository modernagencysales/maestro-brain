import { describe, expect, it } from "vitest";
import {
  buildTransformDriftAlert,
  createTransformDefinition,
  projectTransformTrustReceipt,
  traceTransformBlock,
  TransformValidationError,
} from "./transforms";

const createdAt = "2026-07-01T20:00:00.000Z";

describe("transform domain", () => {
  it("validates transform definitions with schemas, policy kind, and evidence requirements", () => {
    const definition = createTransformDefinition({
      transformId: "transform_gtm_brief",
      workspaceId: "workspace_123",
      name: "GTM Brief",
      inputSchemaRef: "schema:context-pack:v1",
      outputSchemaRef: "schema:brief:v1",
      policyKind: "approval-required",
      requiredEvidence: ["sourceIds", "citationIds", "policySnapshotId"],
      createdAt,
    });

    expect(definition).toMatchObject({
      transformId: "transform_gtm_brief",
      inputSchemaRef: "schema:context-pack:v1",
      outputSchemaRef: "schema:brief:v1",
      policyKind: "approval-required",
      requiredEvidence: ["sourceIds", "citationIds", "policySnapshotId"],
    });

    expect(() =>
      createTransformDefinition({
        transformId: "transform_bad",
        workspaceId: "workspace_123",
        name: "Bad",
        inputSchemaRef: "",
        outputSchemaRef: "schema:brief:v1",
        policyKind: "none",
        requiredEvidence: [],
        createdAt,
      }),
    ).toThrow(TransformValidationError);
  });

  it("traces transform blocks with input/output hashes and provenance", () => {
    const block = traceTransformBlock({
      runId: "run_001",
      blockId: "block_001",
      workspaceId: "workspace_123",
      transformId: "transform_gtm_brief",
      kind: "model-output",
      inputHash: "sha256:input",
      outputHash: "sha256:output",
      sourceIds: ["source_founder_notes"],
      citationIds: ["citation_001"],
      policySnapshotId: "policy_snapshot_001",
      modelReceiptId: "model_receipt_001",
      createdAt,
    });

    expect(block).toMatchObject({
      runId: "run_001",
      kind: "model-output",
      inputHash: "sha256:input",
      outputHash: "sha256:output",
      sourceIds: ["source_founder_notes"],
      citationIds: ["citation_001"],
      policySnapshotId: "policy_snapshot_001",
      modelReceiptId: "model_receipt_001",
    });
  });

  it("builds redacted transform drift alert payloads", () => {
    const alert = buildTransformDriftAlert({
      workspaceId: "workspace_123",
      transformId: "transform_gtm_brief",
      runId: "run_001",
      expectedOutputHash: "sha256:expected-secret",
      actualOutputHash: "sha256:actual-secret",
      severity: "warning",
    });

    expect(alert).toEqual({
      severity: "warning",
      title: "Transform drift detected",
      body: "Transform transform_gtm_brief drifted for run run_001.",
      dedupeKey: "transform-drift:workspace_123:transform_gtm_brief:run_001",
      workspaceId: "workspace_123",
      metadata: {
        transformId: "transform_gtm_brief",
        runId: "run_001",
        expectedOutputHash: "[redacted]",
        actualOutputHash: "[redacted]",
      },
    });
  });

  it("projects deterministic Trust Receipt data from traced blocks", () => {
    const receipt = projectTransformTrustReceipt({
      runId: "run_001",
      workspaceId: "workspace_123",
      transformId: "transform_gtm_brief",
      blocks: [
        traceTransformBlock({
          runId: "run_001",
          blockId: "block_001",
          workspaceId: "workspace_123",
          transformId: "transform_gtm_brief",
          kind: "model-output",
          inputHash: "sha256:input",
          outputHash: "sha256:output",
          sourceIds: ["source_founder_notes"],
          citationIds: ["citation_001"],
          policySnapshotId: "policy_snapshot_001",
          modelReceiptId: "model_receipt_001",
          createdAt,
        }),
      ],
      createdAt,
    });

    expect(receipt).toEqual({
      receiptId: "trust_transform_run_001",
      runId: "run_001",
      workspaceId: "workspace_123",
      transformId: "transform_gtm_brief",
      sourceIds: ["source_founder_notes"],
      citationIds: ["citation_001"],
      inputHashes: ["sha256:input"],
      outputHashes: ["sha256:output"],
      policySnapshotIds: ["policy_snapshot_001"],
      modelReceiptIds: ["model_receipt_001"],
      trustClaim: "source-backed-transform",
      createdAt,
    });
  });
});
