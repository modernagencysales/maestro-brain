import { describe, expect, it } from "vitest";
import {
  buildContextManifest,
  createEvidenceSnapshot,
  fingerprintEvidence,
} from "../confect/workflows/evidence";
import { projectTrustReceipt } from "../confect/workflows/trustReceipt";

const approvedSources = [
  {
    id: "source_2",
    title: "Product docs and policies",
    kind: "link",
    content: "Trusted product policy source.",
  },
  {
    id: "source_1",
    title: "Founder interview notes",
    kind: "markdown",
    content: "Trusted founder notes.",
  },
] as const;

describe("workflow evidence and trust receipts", () => {
  it("builds a stable evidence hash independent of source order", async () => {
    const first = await fingerprintEvidence(approvedSources);
    const second = await fingerprintEvidence([...approvedSources].reverse());

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("creates an evidence snapshot with materiality and source titles", async () => {
    await expect(
      createEvidenceSnapshot({
        workflowRunId: "run_123",
        sources: approvedSources,
        materiality: "required",
        createdAt: 1_000,
      }),
    ).resolves.toMatchObject({
      workflowRunId: "run_123",
      sourceIds: ["source_1", "source_2"],
      sourceTitles: ["Founder interview notes", "Product docs and policies"],
      materiality: "required",
      createdAt: 1_000,
    });
  });

  it("builds reproducible context manifests", async () => {
    const first = await buildContextManifest({
      workflowRunId: "run_123",
      evidenceSnapshotIds: ["snapshot_b", "snapshot_a"],
      policySnapshotId: "policy_snapshot_123",
      promptRef: "prompt:source-grounded-brief:v1",
      modelReceiptId: "model_receipt_123",
      createdAt: 2_000,
    });
    const second = await buildContextManifest({
      workflowRunId: "run_123",
      evidenceSnapshotIds: ["snapshot_a", "snapshot_b"],
      policySnapshotId: "policy_snapshot_123",
      promptRef: "prompt:source-grounded-brief:v1",
      modelReceiptId: "model_receipt_123",
      createdAt: 2_000,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      workflowRunId: "run_123",
      sourceSnapshotIds: ["snapshot_a", "snapshot_b"],
      policySnapshotId: "policy_snapshot_123",
      promptRef: "prompt:source-grounded-brief:v1",
      modelReceiptId: "model_receipt_123",
      createdAt: 2_000,
    });
  });

  it("projects a trust receipt from run, stage, evidence, and manifest data", async () => {
    const evidenceSnapshot = await createEvidenceSnapshot({
      workflowRunId: "run_123",
      sources: approvedSources,
      materiality: "required",
      createdAt: 1_000,
    });
    const manifest = await buildContextManifest({
      workflowRunId: "run_123",
      evidenceSnapshotIds: ["snapshot_required_sources"],
      policySnapshotId: "policy_snapshot_123",
      promptRef: "prompt:source-grounded-brief:v1",
      modelReceiptId: "model_receipt_123",
      createdAt: 2_000,
    });

    expect(
      projectTrustReceipt({
        workflowRunId: "run_123",
        workflowName: "Source grounded planning workflow",
        workspaceId: "workspace_123",
        status: "completed",
        startedAt: "2026-07-01T14:00:00.000Z",
        completedAt: "2026-07-01T14:03:12.000Z",
        stageRuns: [
          {
            nodeId: "brief",
            label: "Source Grounded Brief",
            kind: "capability",
            status: "completed",
            capability: "sourceGroundedBrief",
          },
        ],
        evidenceSnapshots: [evidenceSnapshot],
        contextManifest: manifest,
        claim:
          "The workflow produced a source-grounded brief from approved sources.",
      }),
    ).toMatchObject({
      receiptId: "trust_run_123",
      workflowRunId: "run_123",
      workspaceId: "workspace_123",
      status: "completed",
      claim:
        "The workflow produced a source-grounded brief from approved sources.",
      sourceTitles: ["Founder interview notes", "Product docs and policies"],
      policySnapshotId: "policy_snapshot_123",
      modelReceiptId: "model_receipt_123",
      trustClaim: "source-backed-no-default-rag",
      stages: [
        {
          nodeId: "brief",
          status: "completed",
          capability: "sourceGroundedBrief",
        },
      ],
    });
  });
});
