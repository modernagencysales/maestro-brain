import { TemplateHealthBoard } from "@maestro-template/ui";
import { Page, Stack, Text } from "@saas-ui/react";

import {
  useTemplateQuery,
  type TemplateDataState,
} from "../../adapters/confect-state";
import {
  brainReadApiRefs,
  type BrainRolloutBlocker,
  type BrainRolloutStatusData,
} from "../brain/brain-read-contract";
import { useWorkspace } from "../../providers/workspace";

type HealthStatus = "ready" | "degraded" | "blocked";

export type HealthBoardCheck = {
  readonly label: string;
  readonly status: HealthStatus;
  readonly detail: string;
};

export type HealthBoardView = {
  readonly state: "ready" | "empty" | "loading" | "error";
  readonly checks: readonly HealthBoardCheck[];
  readonly summary: {
    readonly ready: number;
    readonly degraded: number;
    readonly blocked: number;
  };
  readonly checkedAt: string | null;
};

export const buildBrainRolloutHealthBoardView = (
  rollout: BrainRolloutStatusData,
): HealthBoardView => {
  const checks: readonly HealthBoardCheck[] = [
    promotionCheck(rollout),
    {
      label: "Retrieval freshness",
      status: freshnessStatus(rollout.freshness),
      detail: `Backend freshness is ${rollout.freshness}.`,
    },
    {
      label: "Required coverage",
      status: coverageStatus(rollout.coverageStatus),
      detail: `Backend coverage is ${rollout.coverageStatus}.`,
    },
    projectionCheck(rollout),
    ...rollout.scopes.map(scopeCheck),
    ...rollout.alerts.map((alert): HealthBoardCheck => ({
      label: `Alert · ${titleCaseId(alert.kind)}`,
      status: alert.severity === "critical" ? "blocked" : "degraded",
      detail: `${alert.count} event${alert.count === 1 ? "" : "s"} in ${alert.connectorScopeKey}; DRI: workspace owner.`,
    })),
  ];

  return {
    state: checks.length === 0 ? "empty" : "ready",
    checks,
    summary: summarizeChecks(checks),
    checkedAt: new Date(rollout.evaluatedAt).toISOString(),
  };
};

export const toBrainRolloutHealthBoardView = (
  state: TemplateDataState<BrainRolloutStatusData, unknown>,
): HealthBoardView => {
  if (state.status === "ready" || state.status === "empty")
    return buildBrainRolloutHealthBoardView(state.data);
  if (state.status === "loading" || state.status === "skipped")
    return emptyHealthBoardView("loading");
  return {
    ...emptyHealthBoardView("error"),
    checks: [rolloutFailureCheck(state)],
    summary: { ready: 0, degraded: 0, blocked: 1 },
  };
};

export function HealthSurface() {
  const workspace = useWorkspace();
  const brainKey =
    workspace.status === "ready"
      ? workspace.activeWorkspace.workspaceId
      : undefined;
  const rollout = useTemplateQuery(
    brainReadApiRefs.brainRolloutStatus,
    brainKey === undefined ? "skip" : { brainKey },
  );
  const view = toBrainRolloutHealthBoardView(rollout);
  const statusCopy =
    view.state === "ready"
      ? `${view.summary.ready} ready · ${view.summary.degraded} degraded · ${view.summary.blocked} blocked`
      : nonReadyStatusCopy[view.state];

  return (
    <Page.Root>
      <Page.Header
        title="Brain rollout health"
        description="Backend-authoritative retrieval readiness, coverage, and promotion gates."
      />
      <Page.Body px={{ base: "4", md: "6" }} pb="8">
        <Stack gap="4">
          <Text role="status">{statusCopy}</Text>
          <TemplateHealthBoard checks={view.checks} state={view.state} />
          {view.checkedAt === null ? null : (
            <Text fontSize="sm">Evaluated {view.checkedAt}.</Text>
          )}
        </Stack>
      </Page.Body>
    </Page.Root>
  );
}

const promotionCheck = (rollout: BrainRolloutStatusData): HealthBoardCheck => ({
  label: "Promotion readiness",
  status:
    rollout.readiness === "ready" && rollout.promotionReady
      ? "ready"
      : "blocked",
  detail: rollout.promotionReady
    ? "Backend reports this Brain is promotion-ready."
    : `Backend readiness is ${rollout.readiness}; promotion is blocked.`,
});

const projectionCheck = (rollout: BrainRolloutStatusData): HealthBoardCheck => {
  const ready = [
    rollout.projection.present,
    rollout.projection.subjectValidated,
    rollout.projection.fenceValidated,
    rollout.projection.conflictCount === 0,
    rollout.projection.capacityCount === 0,
  ].every(Boolean);
  return {
    label: "Projection population",
    status: ready ? "ready" : "blocked",
    detail: ready
      ? "Subject and eligibility-fence projections are validated."
      : `Projection has ${rollout.projection.conflictCount} integrity conflicts and ${rollout.projection.capacityCount} capacity failures.`,
  };
};

const scopeCheck = (
  scope: BrainRolloutStatusData["scopes"][number],
): HealthBoardCheck => ({
  label: `${titleCaseId(scope.corpusKey)} · ${scope.connectorScopeKey}`,
  status: scope.readiness === "ready" ? "ready" : "blocked",
  detail:
    scope.blockers.length === 0
      ? `Backend scope readiness is ${scope.readiness}; workers are ${scope.workers.state}.`
      : scope.blockers.map(blockerDetail).join(" "),
});

const blockerCopy = {
  dead_letter: "Dead-letter publication jobs require repair.",
  workers_paused: "Ingestion workers are paused.",
  capacity_failure: "Retrieval or ingestion capacity was exceeded.",
  publication_integrity_failure: "Publication integrity validation failed.",
  eligibility_integrity_failure: "Eligibility integrity validation failed.",
  coverage_incomplete: "Required coverage is incomplete.",
  freshness_stale: "Required evidence is stale.",
  freshness_unknown: "Required evidence freshness is unknown.",
  reconciliation_incomplete: "Reconciliation is incomplete.",
  obligations_nonterminal: "Ingestion obligations remain nonterminal.",
  publication_jobs_unresolved: "Publication jobs remain unresolved.",
  quarantine: "Quarantined ingestion work requires review.",
  cursor_stalled: "A reconciliation cursor is stalled.",
  missing_health: "Required connector health is missing.",
  configuration_mismatch: "Connector configuration generations do not match.",
  scope_revoked: "The required connector scope is revoked.",
  eligibility_ineligible: "The required connector scope is ineligible.",
  projection_population_invalid: "Projection population is invalid.",
  bounded_scan_overflow: "A bounded rollout scan overflowed.",
  target_resolution_intents_unresolved:
    "Provider target-resolution intents remain unresolved.",
} as const satisfies Record<BrainRolloutBlocker, string>;

const blockerDetail = (blocker: BrainRolloutBlocker): string =>
  blockerCopy[blocker];

const nonReadyStatusCopy = {
  empty: "Brain rollout status is unavailable.",
  loading: "Loading Brain rollout status.",
  error: "Brain rollout status is unavailable.",
} as const;

const freshnessStatusByValue = {
  current: "ready",
  stale: "degraded",
  unknown: "blocked",
} as const satisfies Record<BrainRolloutStatusData["freshness"], HealthStatus>;

const freshnessStatus = (
  freshness: BrainRolloutStatusData["freshness"],
): HealthStatus => freshnessStatusByValue[freshness];

const coverageStatusByValue = {
  complete: "ready",
  partial: "degraded",
  unavailable: "blocked",
  unknown: "blocked",
} as const satisfies Record<
  BrainRolloutStatusData["coverageStatus"],
  HealthStatus
>;

const coverageStatus = (
  coverage: BrainRolloutStatusData["coverageStatus"],
): HealthStatus => coverageStatusByValue[coverage];

const summarizeChecks = (
  checks: readonly HealthBoardCheck[],
): HealthBoardView["summary"] => ({
  ready: checks.filter(({ status }) => status === "ready").length,
  degraded: checks.filter(({ status }) => status === "degraded").length,
  blocked: checks.filter(({ status }) => status === "blocked").length,
});

const emptyHealthBoardView = (state: "loading" | "error"): HealthBoardView => ({
  state,
  checks: [],
  summary: { ready: 0, degraded: 0, blocked: 0 },
  checkedAt: null,
});

const rolloutFailureCopy = {
  capacity: {
    label: "Rollout status capacity",
    detail: "Backend rollout evaluation exceeded its bounded capacity.",
  },
  integrity: {
    label: "Rollout status integrity",
    detail: "Backend rollout evaluation found an integrity conflict.",
  },
  query: {
    label: "Rollout status query",
    detail: "The backend rollout status query failed.",
  },
} as const;

const failureTagKinds = [
  ["Capacity", "capacity"],
  ["Integrity", "integrity"],
] as const;

const rolloutFailureCheck = (
  state: Exclude<
    TemplateDataState<BrainRolloutStatusData, unknown>,
    { readonly status: "ready" | "empty" | "loading" | "skipped" }
  >,
): HealthBoardCheck => {
  const tag = String(Reflect.get(Object(state.error), "_tag"));
  const kind =
    failureTagKinds.find(([fragment]) => tag.includes(fragment))?.[1] ??
    "query";
  return {
    label: rolloutFailureCopy[kind].label,
    status: "blocked",
    detail: rolloutFailureCopy[kind].detail,
  };
};

const titleCaseId = (id: string): string =>
  id
    .split(/[-_]/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
