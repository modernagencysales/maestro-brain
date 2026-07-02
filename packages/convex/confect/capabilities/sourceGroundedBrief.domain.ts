import type { Schema } from "effect";
import type {
  SourceGroundedBriefArgs,
  SourceGroundedBriefReturn,
} from "./sourceGroundedBrief.spec";

export type SourceGroundedBriefInput = Schema.Schema.Type<
  typeof SourceGroundedBriefArgs
>;

export type SourceGroundedBriefResult = Schema.Schema.Type<
  typeof SourceGroundedBriefReturn
>;

export type BriefSource = {
  readonly id: string;
  readonly title: string;
  readonly markdown: string;
};

export const normalizeSourceGroundedBriefInput = (
  input: SourceGroundedBriefInput,
): SourceGroundedBriefInput => ({
  workspaceId: input.workspaceId.trim(),
  sourceIds: [...new Set(input.sourceIds.map((sourceId) => sourceId.trim()))],
  briefGoal: input.briefGoal.trim(),
  idempotencyKey: input.idempotencyKey.trim(),
});

export const formatContextPackForBrief = (
  sources: readonly BriefSource[],
): string =>
  sources
    .map((source) => `## Source: ${source.title}\n\n${source.markdown}`)
    .join("\n\n");

export const runFakeSourceGroundedBrief = (input: {
  readonly input: SourceGroundedBriefInput;
  readonly sources: readonly BriefSource[];
  readonly policySnapshotId: string;
  readonly modelReceiptId: string;
}): SourceGroundedBriefResult => {
  const sourceTitles = input.sources.map((source) => source.title);

  return {
    briefMarkdown: `## Source-Grounded Brief\n\nGoal: ${input.input.briefGoal}\n\n### Sources\n\n${sourceTitles.map((title) => `- ${title}`).join("\n")}\n\n### Draft\n\nThis deterministic fake brief is grounded in ${input.sources.length} approved source${input.sources.length === 1 ? "" : "s"}. Replace the fake LLM service before live use.`,
    sourceTitles,
    policySnapshotId: input.policySnapshotId,
    modelReceiptId: input.modelReceiptId,
    trustClaim: "source-backed-no-default-rag",
  };
};
