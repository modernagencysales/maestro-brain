import type * as Schema from "effect/Schema";
import type {
  SourceGroundedBriefArgs,
  SourceGroundedBriefReturn,
} from "./sourceGroundedBrief.spec";
import { ValidationFailed } from "../errors";
import { validateCallerIdempotencyKey } from "../shared/idempotencyKey";

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
): SourceGroundedBriefInput | ValidationFailed => {
  const idempotencyKey = validateCallerIdempotencyKey(input.idempotencyKey);

  if (!idempotencyKey.ok) {
    return new ValidationFailed({
      field: "idempotencyKey",
      message: idempotencyKey.error.message,
    });
  }

  return {
    workspaceId: input.workspaceId.trim(),
    sourceIds: [...new Set(input.sourceIds.map((sourceId) => sourceId.trim()))],
    briefGoal: input.briefGoal.trim(),
    idempotencyKey: idempotencyKey.value,
  };
};

export const formatContextPackForBrief = (
  sources: readonly BriefSource[],
): string =>
  sources
    .map((source) => `## Source: ${source.title}\n\n${source.markdown}`)
    .join("\n\n");
