import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import sourceGroundedBrief, {
  SourceGroundedBriefArgs,
  SourceGroundedBriefError,
  SourceGroundedBriefReturn,
} from "../confect/capabilities/sourceGroundedBrief.spec";
import sourceGroundedBriefImpl from "../confect/capabilities/sourceGroundedBrief.impl";
import {
  formatContextPackForBrief,
  normalizeSourceGroundedBriefInput,
  runFakeSourceGroundedBrief,
} from "../confect/capabilities/sourceGroundedBrief.domain";

describe("sourceGroundedBrief capability contract", () => {
  it("declares args required by the first real capability", () => {
    expect(
      Schema.decodeUnknownSync(SourceGroundedBriefArgs)({
        workspaceId: "workspace_123",
        sourceIds: ["source_1", "source_2"],
        briefGoal: "Create a source-grounded implementation brief.",
        idempotencyKey: "brief-001",
      }),
    ).toEqual({
      workspaceId: "workspace_123",
      sourceIds: ["source_1", "source_2"],
      briefGoal: "Create a source-grounded implementation brief.",
      idempotencyKey: "brief-001",
    });
    expect(() =>
      Schema.decodeUnknownSync(SourceGroundedBriefArgs)({
        workspaceId: "workspace_123",
        sourceIds: [],
        briefGoal: "",
        idempotencyKey: "brief-001",
      }),
    ).toThrow();
  });

  it("declares return fields for provenance and trust", () => {
    expect(
      Schema.decodeUnknownSync(SourceGroundedBriefReturn)({
        briefMarkdown: "## Brief\n\n- Cited claim.",
        sourceTitles: ["Positioning Notes"],
        policySnapshotId: "policy_snapshot_123",
        modelReceiptId: "model_receipt_123",
        trustClaim: "source-backed-no-default-rag",
      }),
    ).toMatchObject({
      briefMarkdown: expect.stringContaining("Brief") as string,
      sourceTitles: ["Positioning Notes"],
      policySnapshotId: "policy_snapshot_123",
      modelReceiptId: "model_receipt_123",
      trustClaim: "source-backed-no-default-rag",
    });
  });

  it("declares every expected typed error", () => {
    const encoded = [
      new SourceGroundedBriefError.Unauthenticated(),
      new SourceGroundedBriefError.NoWorkspaceAccess({
        workspaceId: "workspace_123",
      }),
      new SourceGroundedBriefError.ValidationFailed({
        field: "sourceIds",
        message: "At least one source is required.",
      }),
      new SourceGroundedBriefError.PolicyNotFound({
        kind: "spend.limits",
        workspaceId: "workspace_123",
      }),
      new SourceGroundedBriefError.PromptNotFound({
        promptRef: "prompt:gtm.planner:v1",
      }),
      new SourceGroundedBriefError.LlmDisabled(),
      new SourceGroundedBriefError.RateLimited({
        retryAfterMs: 1_000,
      }),
      new SourceGroundedBriefError.SpendCapExceeded({
        dailySpendLimitCents: 2_500,
      }),
      new SourceGroundedBriefError.ProviderConfigInvalid({
        provider: "openrouter",
      }),
    ].map((error) => Schema.encodeSync(SourceGroundedBriefError.Schema)(error));

    expect(encoded.map((error) => error._tag)).toEqual([
      "Unauthenticated",
      "NoWorkspaceAccess",
      "ValidationFailed",
      "PolicyNotFound",
      "PromptNotFound",
      "LlmDisabled",
      "RateLimited",
      "SpendCapExceeded",
      "ProviderConfigInvalid",
    ]);
    expect(JSON.stringify(encoded)).not.toContain("secret");
  });

  it("registers a public Confect mutation named run", () => {
    expect(JSON.stringify(sourceGroundedBrief)).toContain("run");
    expect(JSON.stringify(sourceGroundedBrief)).toContain("public");
  });

  it("normalizes input and formats source context deterministically", () => {
    const normalized = normalizeSourceGroundedBriefInput({
      workspaceId: " workspace_123 ",
      sourceIds: [" source_2 ", "source_1", "source_2"],
      briefGoal: "  Build an implementation brief. ",
      idempotencyKey: " brief-001 ",
    });

    expect(normalized).toEqual({
      workspaceId: "workspace_123",
      sourceIds: ["source_2", "source_1"],
      briefGoal: "Build an implementation brief.",
      idempotencyKey: "brief-001",
    });
    expect(
      formatContextPackForBrief([
        {
          id: "source_1",
          title: "Positioning Notes",
          markdown: "Trusted notes.",
        },
        {
          id: "source_2",
          title: "Homepage",
          markdown: "Trusted homepage copy.",
        },
      ]),
    ).toBe(
      "## Source: Positioning Notes\n\nTrusted notes.\n\n## Source: Homepage\n\nTrusted homepage copy.",
    );
  });

  it("runs deterministic fake LLM path without persisting workflow state", () => {
    expect(
      runFakeSourceGroundedBrief({
        input: {
          workspaceId: "workspace_123",
          sourceIds: ["source_1"],
          briefGoal: "Build an implementation brief.",
          idempotencyKey: "brief-001",
        },
        sources: [
          {
            id: "source_1",
            title: "Positioning Notes",
            markdown: "Trusted notes.",
          },
        ],
        policySnapshotId: "policy_snapshot_123",
        modelReceiptId: "model_receipt_123",
      }),
    ).toEqual({
      briefMarkdown:
        "## Source-Grounded Brief\n\nGoal: Build an implementation brief.\n\n### Sources\n\n- Positioning Notes\n\n### Draft\n\nThis deterministic fake brief is grounded in 1 approved source. Replace the fake LLM service before live use.",
      sourceTitles: ["Positioning Notes"],
      policySnapshotId: "policy_snapshot_123",
      modelReceiptId: "model_receipt_123",
      trustClaim: "source-backed-no-default-rag",
    });
  });

  it("exports a finalized Confect implementation", () => {
    expect(sourceGroundedBriefImpl).toMatchObject({
      _op_layer: "Fold",
    });
  });
});
