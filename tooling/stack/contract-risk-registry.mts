/**
 * contract-risk-registry — the minimal subset of maestro's
 * tooling/workflow/contract-risk-registry.mts that plan validation needs.
 * Vendored here because maestro-template's tooling/workflow is a different
 * package (@maestro-template/workflow-tooling) without these exports. Only the
 * id → appliesToLayers mapping and the lookup helpers used by plan.mts are
 * ported; prompt rules, briefs, and plan-contract builders stay upstream.
 */

export type ContractRiskId =
  | "ambient-time-inline"
  | "bare-error-not-typed"
  | "capability-helper-or-logic"
  | "schema-runtime-validator-export"
  | "policy-data-hardcoded"
  | "duplicated-closed-union"
  | "workspace-guard"
  | "invalid-test-fixture-or-cast"
  | "branching-logic-needs-boundary-tests"
  | "unjustified-cap-or-threshold"
  | "prompt-model-policy-boundary"
  | "auth-cross-workspace-coverage"
  | "type-escape-or-cast"
  | "inactive-client-subscription"
  | "existing-module-repair-checklist";

type ContractRisk = {
  readonly id: ContractRiskId;
  readonly appliesToLayers: readonly string[];
};

const CONTRACT_RISKS: readonly ContractRisk[] = [
  {
    id: "ambient-time-inline",
    appliesToLayers: ["checks", "domain", "capabilities", "workflows"],
  },
  {
    id: "bare-error-not-typed",
    appliesToLayers: ["domain", "capabilities", "workflows"],
  },
  {
    id: "capability-helper-or-logic",
    appliesToLayers: ["capabilities"],
  },
  {
    id: "schema-runtime-validator-export",
    appliesToLayers: ["schema", "checks", "domain", "capabilities"],
  },
  {
    id: "policy-data-hardcoded",
    appliesToLayers: [
      "schema",
      "checks",
      "domain",
      "capabilities",
      "workflows",
    ],
  },
  {
    id: "duplicated-closed-union",
    appliesToLayers: ["schema", "checks", "domain"],
  },
  {
    id: "workspace-guard",
    appliesToLayers: ["capabilities", "workflows"],
  },
  {
    id: "invalid-test-fixture-or-cast",
    appliesToLayers: ["checks", "domain", "capabilities", "apps", "agents"],
  },
  {
    id: "branching-logic-needs-boundary-tests",
    appliesToLayers: ["checks", "domain"],
  },
  {
    id: "unjustified-cap-or-threshold",
    appliesToLayers: ["schema", "checks", "domain", "capabilities"],
  },
  {
    id: "prompt-model-policy-boundary",
    appliesToLayers: ["agents", "workflows", "capabilities"],
  },
  {
    id: "auth-cross-workspace-coverage",
    appliesToLayers: ["capabilities", "apps", "agents"],
  },
  {
    id: "type-escape-or-cast",
    appliesToLayers: [
      "checks",
      "domain",
      "capabilities",
      "workflows",
      "apps",
      "agents",
    ],
  },
  {
    id: "inactive-client-subscription",
    appliesToLayers: ["apps"],
  },
  {
    id: "existing-module-repair-checklist",
    appliesToLayers: [],
  },
];

const CONTRACT_RISK_IDS = new Set<ContractRiskId>(
  CONTRACT_RISKS.map((risk) => risk.id),
);

export function contractRisksForLayers(
  layers: readonly string[],
): readonly ContractRiskId[] {
  const selected = CONTRACT_RISKS.filter((risk) =>
    risk.appliesToLayers.some((layer) => layers.includes(layer)),
  ).map((risk) => risk.id);
  return [...new Set(selected)];
}

export function missingContractRiskIdsForLayers(args: {
  readonly layers: readonly string[];
  readonly contractRiskIds: readonly ContractRiskId[] | undefined;
}): readonly ContractRiskId[] {
  const actual = new Set(args.contractRiskIds ?? []);
  return contractRisksForLayers(args.layers).filter(
    (riskId) => !actual.has(riskId),
  );
}

export function unknownContractRiskIds(
  ids: readonly string[] | undefined,
): readonly string[] {
  return (ids ?? []).filter(
    (id) => !CONTRACT_RISK_IDS.has(id as ContractRiskId),
  );
}
