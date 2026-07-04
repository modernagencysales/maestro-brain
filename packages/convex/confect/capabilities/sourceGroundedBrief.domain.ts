import type * as Schema from "effect/Schema";
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
