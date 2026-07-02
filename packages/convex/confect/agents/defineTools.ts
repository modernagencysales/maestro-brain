import type * as Schema from "effect/Schema";
import {
  SourceGroundedBriefArgs,
  type SourceGroundedBriefReturn,
} from "../capabilities/sourceGroundedBrief.spec";

export type ToolVisibility = "public" | "internal";
export type ToolOperationType = "query" | "mutation" | "action";

export type ToolCandidate = {
  readonly id: string;
  readonly visibility: ToolVisibility;
  readonly operationType: ToolOperationType;
  readonly grantId: string;
  readonly schema: Schema.Schema.Any;
  readonly description: string;
};

export type ToolPresentation = {
  readonly title: string;
  readonly summary: string;
  readonly trustClaim: string;
  readonly sourceTitles: readonly string[];
};

export type ModelTool = {
  readonly name: "sourceGroundedBrief";
  readonly refId: string;
  readonly grantId: "capability.run";
  readonly operationType: "mutation";
  readonly description: string;
  readonly inputSchema: typeof SourceGroundedBriefArgs;
  readonly present: (
    result: Schema.Schema.Type<typeof SourceGroundedBriefReturn>,
  ) => ToolPresentation;
};

export const sourceGroundedBriefTool: ModelTool = {
  name: "sourceGroundedBrief",
  refId: "capabilities.sourceGroundedBrief.run",
  grantId: "capability.run",
  operationType: "mutation",
  description:
    "Create a source-grounded implementation brief from approved sources.",
  inputSchema: SourceGroundedBriefArgs,
  present: (result) => ({
    title: "Source-grounded brief",
    summary: `Grounded draft backed by ${result.sourceTitles.length} approved source${result.sourceTitles.length === 1 ? "" : "s"}.`,
    trustClaim: result.trustClaim,
    sourceTitles: result.sourceTitles,
  }),
};

export const defineModelTools = (
  candidates: readonly ToolCandidate[],
): readonly ModelTool[] =>
  candidates.flatMap((candidate) => {
    if (
      candidate.id !== sourceGroundedBriefTool.refId ||
      candidate.visibility !== "public" ||
      candidate.operationType !== "mutation" ||
      candidate.grantId !== sourceGroundedBriefTool.grantId
    ) {
      return [];
    }

    return [sourceGroundedBriefTool];
  });

export const defaultToolCandidates = [
  {
    id: sourceGroundedBriefTool.refId,
    visibility: "public",
    operationType: "mutation",
    grantId: sourceGroundedBriefTool.grantId,
    schema: SourceGroundedBriefArgs,
    description: sourceGroundedBriefTool.description,
  },
] as const satisfies readonly ToolCandidate[];
