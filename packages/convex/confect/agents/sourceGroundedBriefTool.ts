import * as Schema from "effect/Schema";
import { runFakeSourceGroundedBrief } from "../capabilities/sourceGroundedBrief.fake";
import { normalizeSourceGroundedBriefInput } from "../capabilities/sourceGroundedBrief.domain";
import {
  SourceGroundedBriefArgs,
  type SourceGroundedBriefReturn,
} from "../capabilities/sourceGroundedBrief.spec";
import type {
  ModelTool,
  ModelToolExecution,
  ModelToolDefinition,
  PreparedModelToolInvocation,
  ToolPresentation,
} from "./modelTool";

type SourceGroundedBriefInput = Schema.Schema.Type<
  typeof SourceGroundedBriefArgs
>;
type SourceGroundedBriefResult = Schema.Schema.Type<
  typeof SourceGroundedBriefReturn
>;

type SourceGroundedBriefTool = ModelTool<SourceGroundedBriefResult> & {
  readonly name: "sourceGroundedBrief";
  readonly refId: "capabilities.sourceGroundedBrief.run";
  readonly grantId: "capability.run";
  readonly operationType: "mutation";
  readonly inputSchema: typeof SourceGroundedBriefArgs;
  readonly present: (result: SourceGroundedBriefResult) => ToolPresentation;
};

const buildSourceGroundedBriefPresentation = (
  result: SourceGroundedBriefResult,
): ToolPresentation => ({
  title: "Source-grounded brief",
  summary: `Grounded draft backed by ${result.sourceTitles.length} approved source${result.sourceTitles.length === 1 ? "" : "s"}.`,
  trustClaim: result.trustClaim,
  sourceTitles: result.sourceTitles,
});

const runFakeSourceGroundedBriefTool = (
  input: SourceGroundedBriefInput,
): SourceGroundedBriefResult =>
  runFakeSourceGroundedBrief({
    input: normalizeSourceGroundedBriefInput(input),
    sources: input.sourceIds.map((sourceId) => ({
      id: sourceId,
      title: `Source ${sourceId}`,
      markdown: "Synthetic source content for fake-mode agent tool run.",
    })),
    policySnapshotId: `policy_snapshot_${input.idempotencyKey}`,
    modelReceiptId: `model_receipt_${input.idempotencyKey}`,
  });

const buildSourceGroundedBriefExecution = (
  input: SourceGroundedBriefInput,
): ModelToolExecution => {
  const result = runFakeSourceGroundedBriefTool(input);

  return {
    assistantMessage: `I created a source-grounded brief using ${sourceGroundedBriefTool.name}.`,
    presentation: sourceGroundedBriefTool.present(result),
  };
};

const prepareSourceGroundedBriefInvocation = (
  input: SourceGroundedBriefInput,
): PreparedModelToolInvocation => ({
  idempotencyKey: input.idempotencyKey,
  execute: () => buildSourceGroundedBriefExecution(input),
});

export const sourceGroundedBriefTool: SourceGroundedBriefTool = {
  name: "sourceGroundedBrief",
  refId: "capabilities.sourceGroundedBrief.run",
  grantId: "capability.run",
  operationType: "mutation",
  description:
    "Create a source-grounded implementation brief from approved sources.",
  inputSchema: SourceGroundedBriefArgs,
  prepare: (value) => {
    const decoded = decodeSourceGroundedBriefToolInput(value);

    if (!decoded.ok) {
      return decoded;
    }

    return {
      ok: true,
      invocation: prepareSourceGroundedBriefInvocation(decoded.input),
    };
  },
  present: buildSourceGroundedBriefPresentation,
};

const decodeSourceGroundedBriefToolInput = (
  value: unknown,
):
  | {
      readonly ok: true;
      readonly input: Schema.Schema.Type<typeof SourceGroundedBriefArgs>;
    }
  | {
      readonly ok: false;
      readonly message: string;
    } => {
  try {
    return {
      ok: true,
      input: Schema.decodeUnknownSync(SourceGroundedBriefArgs)(value),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Invalid tool input.",
    };
  }
};

export const sourceGroundedBriefToolDefinition = {
  tool: sourceGroundedBriefTool,
  candidate: {
    id: sourceGroundedBriefTool.refId,
    visibility: "public",
    operationType: "mutation",
    grantId: sourceGroundedBriefTool.grantId,
    schema: SourceGroundedBriefArgs,
    description: sourceGroundedBriefTool.description,
  },
} as const satisfies ModelToolDefinition;
