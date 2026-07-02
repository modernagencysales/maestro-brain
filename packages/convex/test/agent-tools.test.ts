import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  defineModelTools,
  sourceGroundedBriefTool,
  type ToolCandidate,
} from "../confect/agents/defineTools";
import { SourceGroundedBriefArgs } from "../confect/capabilities/sourceGroundedBrief.spec";

const publicSourceGroundedBrief = {
  id: "capabilities.sourceGroundedBrief.run",
  visibility: "public",
  operationType: "mutation",
  grantId: "capability.run",
  schema: SourceGroundedBriefArgs,
  description:
    "Create a source-grounded implementation brief from approved sources.",
} satisfies ToolCandidate;

describe("agent tool definitions", () => {
  it("defines sourceGroundedBrief as the first typed model tool", () => {
    expect(sourceGroundedBriefTool).toMatchObject({
      name: "sourceGroundedBrief",
      refId: "capabilities.sourceGroundedBrief.run",
      grantId: "capability.run",
      operationType: "mutation",
      description:
        "Create a source-grounded implementation brief from approved sources.",
    });
    expect(
      Schema.decodeUnknownSync(sourceGroundedBriefTool.inputSchema)({
        workspaceId: "workspace_123",
        sourceIds: ["source_1"],
        briefGoal: "Draft the implementation brief.",
        idempotencyKey: "brief-001",
      }),
    ).toMatchObject({
      workspaceId: "workspace_123",
      sourceIds: ["source_1"],
    });
  });

  it("only converts public Confect operations into model tools", () => {
    const internalCandidate = {
      ...publicSourceGroundedBrief,
      id: "capabilities.sourceGroundedBrief.internalRun",
      visibility: "internal",
    } satisfies ToolCandidate;

    expect(
      defineModelTools([publicSourceGroundedBrief, internalCandidate]),
    ).toEqual([sourceGroundedBriefTool]);
  });

  it("rejects non-capability grants and unsupported operation types", () => {
    const candidates = [
      {
        ...publicSourceGroundedBrief,
        id: "access.members.list",
        grantId: "workspace.admin",
      },
      {
        ...publicSourceGroundedBrief,
        id: "capabilities.sourceGroundedBrief.inspect",
        operationType: "query",
      },
    ] satisfies readonly ToolCandidate[];

    expect(defineModelTools(candidates)).toEqual([]);
  });

  it("presents source-grounded brief output for model and UI review", () => {
    expect(
      sourceGroundedBriefTool.present({
        briefMarkdown: "## Brief\n\nGrounded draft.",
        sourceTitles: ["Founder interview notes"],
        policySnapshotId: "policy_snapshot_123",
        modelReceiptId: "model_receipt_123",
        trustClaim: "source-backed-no-default-rag",
      }),
    ).toEqual({
      title: "Source-grounded brief",
      summary: "Grounded draft backed by 1 approved source.",
      trustClaim: "source-backed-no-default-rag",
      sourceTitles: ["Founder interview notes"],
    });
  });
});
