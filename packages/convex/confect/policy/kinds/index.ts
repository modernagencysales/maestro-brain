import { agentPolicyKind } from "./agent";
import { promptOverridePolicyKind } from "./prompt";
import { spendLimitsPolicyKind } from "./spendLimits";
import type { PolicyCandidate, PolicyKind } from "./types";

export { agentPolicyKind } from "./agent";
export { promptOverridePolicyKind } from "./prompt";
export { spendLimitsPolicyKind } from "./spendLimits";
export type {
  PolicyCandidate,
  PolicyKind,
  PolicyKindDefinition,
  PolicyScope,
  PolicyStatus,
} from "./types";

export const policyKinds = {
  "spend.limits": spendLimitsPolicyKind,
  "agent.config": agentPolicyKind,
  "prompt.override": promptOverridePolicyKind,
} as const;

const scopeRank = (
  candidate: PolicyCandidate<Readonly<Record<string, unknown>>>,
) => (candidate.scope === "workspace" ? 2 : 1);

export const selectNearestPolicy = <
  TData extends Readonly<Record<string, unknown>>,
>(input: {
  readonly kind: PolicyKind;
  readonly workspaceId: string;
  readonly nowMs: number;
  readonly policies: readonly PolicyCandidate<TData>[];
}): PolicyCandidate<TData> | undefined =>
  input.policies
    .filter(
      (policy) =>
        policy.kind === input.kind &&
        policy.status === "active" &&
        policy.activatedAt !== null &&
        policy.activatedAt <= input.nowMs &&
        (policy.scope === "system" || policy.workspaceId === input.workspaceId),
    )
    .sort((left, right) => {
      const scopeDiff = scopeRank(right) - scopeRank(left);

      return scopeDiff !== 0 ? scopeDiff : right.version - left.version;
    })[0];
