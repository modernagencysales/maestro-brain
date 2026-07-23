import type { ClassificationRequest } from "../classification/gather";
import {
  validateClassificationProposal,
  type ClassificationModelOutput,
} from "../classification/request";

export type ClassifySourceUnitInput = ClassificationRequest;
export const classifySourceUnitLocally = (
  input: ClassifySourceUnitInput,
): ClassificationModelOutput => {
  const matchedTargets = input.allowedTargets.filter((target) =>
    input.messages.some((message) =>
      message.canonicalText.includes(target.displayName),
    ),
  );
  const contentScope =
    matchedTargets.length === 1
      ? "single_target"
      : matchedTargets.length > 1
        ? "mixed_client"
        : "no_target";
  const target = matchedTargets.length === 1 ? matchedTargets[0] : undefined;
  const evidence = target
    ? input.messages.find((message) =>
        message.canonicalText.includes(target.displayName),
      )
    : undefined;
  const output: ClassificationModelOutput = {
    sourceUnitRevisionKey: input.sourceUnitRevisionKey,
    sourceUnitHash: input.sourceUnitHash,
    contentScope,
    targetBrainKey: target?.brainKey ?? null,
    confidence: target ? 1 : 0,
    rationale: "Fake/local descriptor match; confidence is diagnostic only.",
    evidenceQuotes:
      target && evidence
        ? [
            {
              sourceRevisionKey: evidence.sourceRevisionKey,
              quote: target.displayName,
            },
          ]
        : [],
  };

  validateClassificationProposal(input, output);
  return output;
};
