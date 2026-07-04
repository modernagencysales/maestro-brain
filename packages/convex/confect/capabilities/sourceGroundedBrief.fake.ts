import type {
  BriefSource,
  SourceGroundedBriefInput,
  SourceGroundedBriefResult,
} from "./sourceGroundedBrief.domain";

export const runFakeSourceGroundedBrief = (params: {
  readonly input: SourceGroundedBriefInput;
  readonly sources: readonly BriefSource[];
  readonly policySnapshotId: string;
  readonly modelReceiptId: string;
}): SourceGroundedBriefResult => {
  const sourceTitles = params.sources.map((source) => source.title);

  return {
    briefMarkdown: `## Source-Grounded Brief\n\nGoal: ${params.input.briefGoal}\n\n### Sources\n\n${sourceTitles.map((title) => `- ${title}`).join("\n")}\n\n### Draft\n\nThis deterministic fake brief is grounded in ${params.sources.length} approved source${params.sources.length === 1 ? "" : "s"}. Replace the fake LLM service before live use.`,
    sourceTitles,
    policySnapshotId: params.policySnapshotId,
    modelReceiptId: params.modelReceiptId,
    trustClaim: "source-backed-no-default-rag",
  };
};
