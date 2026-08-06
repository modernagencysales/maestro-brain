import type { CallMatch } from "../routing/callMatching";

export const routeOutcomeFromMatch = (
  match: CallMatch,
  allowedBrainKeys: readonly string[],
) => {
  if (match.kind === "exact")
    return {
      outcome: "routed" as const,
      brainKey: match.brainKey,
      candidateBrainKeys: [match.brainKey],
      reason: match.reason,
    };
  if (match.kind === "mixed_client")
    return {
      outcome: "mixed_client" as const,
      brainKey: null,
      candidateBrainKeys: match.brainKeys,
      reason: "mixed_client",
    };
  return {
    outcome: "no_match" as const,
    brainKey: null,
    candidateBrainKeys: [...allowedBrainKeys].sort(),
    reason: match.kind,
  };
};
