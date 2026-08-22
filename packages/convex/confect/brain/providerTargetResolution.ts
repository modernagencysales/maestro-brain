import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { sha256Hex } from "../shared/sha256";

export type ProviderTargetResolutionStatus =
  | "pending"
  | "retry_wait"
  | "capacity_blocked"
  | "succeeded"
  | "policy_excluded"
  | "stale"
  | "integrity_failure";

type ProviderTargetResolutionAuthorityBase = {
  readonly targetResolutionIntentKey: string;
  readonly ingestionObligationKey: string;
  readonly organizationKey: string;
  readonly corpusKey: "slack" | "transcripts" | "documents";
  readonly providerKind: "slack" | "transcript" | "google_drive";
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly membershipKey: string;
  readonly originKind: "slack" | "transcript" | "document";
  readonly originKey: string;
  readonly originRevisionKey: string;
  readonly observationDigest: string;
  readonly resolutionGeneration: number;
};

export type ReconciliationPageTargetResolutionAuthority =
  ProviderTargetResolutionAuthorityBase & {
    readonly authorityKind: "reconciliation_page";
    readonly requiredScopeIntentKey: string;
    readonly pageChunkKey: string;
    readonly pageEnvelopeKey: string;
    readonly reconciliationRunKey: string;
    readonly runGeneration: number;
    readonly workspaceId: string;
    readonly brainKey: string;
    readonly allowlistGeneration: number;
    readonly ledgerSequence: number;
  };

export type LiveCaptureTargetResolutionAuthority =
  ProviderTargetResolutionAuthorityBase & {
    readonly authorityKind: "live_capture";
    readonly captureKey: string;
    readonly capturedAt: number;
  };

export type ProviderTargetResolutionAuthority =
  | ReconciliationPageTargetResolutionAuthority
  | LiveCaptureTargetResolutionAuthority;

export type ProviderTargetResolutionTarget = {
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly jobKey: string;
  readonly authorityDigest: string;
  readonly childIngestionObligationKey?: string | undefined;
};

export type ProviderTargetResolutionChild = ProviderTargetResolutionTarget & {
  readonly targetResolutionIntentKey: string;
  readonly parentIngestionObligationKey: string;
  readonly resolutionGeneration: number;
};

export type ProviderTargetResolutionState = {
  readonly status: ProviderTargetResolutionStatus;
  readonly targetCount: number;
  readonly targetDigest: string | null;
  readonly targets: readonly ProviderTargetResolutionTarget[];
  readonly completedAt: number | null;
};

export type ProviderTargetResolutionPopulationPlan = {
  readonly kind: "empty_population" | "create_all" | "already_complete";
  readonly targetCount: number;
  readonly targetDigest: string;
  readonly targets: readonly ProviderTargetResolutionTarget[];
};

export type ProviderTargetResolutionInvariantReason =
  | "authority_mismatch"
  | "invalid_state"
  | "invalid_transition"
  | "capacity_exceeded"
  | "population_mismatch";

export class ProviderTargetResolutionInvariant extends Data.TaggedError(
  "ProviderTargetResolutionInvariant",
)<{
  readonly reason: ProviderTargetResolutionInvariantReason;
  readonly detail: string;
}> {}

const fail = (
  reason: ProviderTargetResolutionInvariantReason,
  detail: string,
) => Effect.fail(new ProviderTargetResolutionInvariant({ reason, detail }));

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([field, nested]) => `${JSON.stringify(field)}:${stableJson(nested)}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};

const contentDigest = (value: unknown): string =>
  `sha256:${sha256Hex(stableJson(value))}`;

const targetIdentity = (target: ProviderTargetResolutionTarget): string =>
  `${target.workspaceId}\u0000${target.brainKey}`;

const compareTargets = (
  left: ProviderTargetResolutionTarget,
  right: ProviderTargetResolutionTarget,
): number =>
  left.workspaceId.localeCompare(right.workspaceId) ||
  left.brainKey.localeCompare(right.brainKey) ||
  left.jobKey.localeCompare(right.jobKey) ||
  left.authorityDigest.localeCompare(right.authorityDigest) ||
  (left.childIngestionObligationKey ?? "").localeCompare(
    right.childIngestionObligationKey ?? "",
  );

const canonicalTargets = (
  targets: readonly ProviderTargetResolutionTarget[],
): readonly ProviderTargetResolutionTarget[] =>
  [...targets].sort(compareTargets);

const validateTargetSet = (
  targets: readonly ProviderTargetResolutionTarget[],
  reason: ProviderTargetResolutionInvariantReason,
  authorityKind?: ProviderTargetResolutionAuthority["authorityKind"],
) =>
  Effect.gen(function* () {
    if (
      targets.some(
        (target) =>
          target.workspaceId.trim().length === 0 ||
          target.brainKey.trim().length === 0 ||
          !/^rjob_[a-f0-9]{64}$/.test(target.jobKey) ||
          !/^raud_[a-f0-9]{64}$/.test(target.authorityDigest) ||
          (authorityKind === "live_capture" &&
            !/^iobl_[a-f0-9]{64}$/.test(
              target.childIngestionObligationKey ?? "",
            )),
      )
    )
      return yield* fail(
        reason,
        "Every resolved target must have exact job authority.",
      );
    if (new Set(targets.map(targetIdentity)).size !== targets.length)
      return yield* fail(
        reason,
        "A target population contains a duplicate workspace and Brain.",
      );
    if (new Set(targets.map((target) => target.jobKey)).size !== targets.length)
      return yield* fail(
        reason,
        "A target population contains a duplicate publication job.",
      );
    return canonicalTargets(targets);
  });

const validateAuthority = (authority: ProviderTargetResolutionAuthority) =>
  authority.targetResolutionIntentKey !==
  providerTargetResolutionIntentKey({
    ingestionObligationKey: authority.ingestionObligationKey,
  })
    ? fail(
        "authority_mismatch",
        "The target-resolution intent key does not bind its ingestion obligation.",
      )
    : !/^iobl_[a-f0-9]{64}$/.test(authority.ingestionObligationKey) ||
        !/^sha256:[a-f0-9]{64}$/.test(authority.observationDigest)
      ? fail(
          "authority_mismatch",
          "Target-resolution authority contains a malformed durable identity.",
        )
      : !Number.isSafeInteger(authority.connectionGeneration) ||
          authority.connectionGeneration < 1 ||
          !Number.isSafeInteger(authority.resolutionGeneration) ||
          authority.resolutionGeneration < 1
        ? fail(
            "authority_mismatch",
            "Target-resolution generations and ledger sequence are invalid.",
          )
        : authority.authorityKind === "reconciliation_page" &&
            (!/^brsi_[a-f0-9]{64}$/.test(authority.requiredScopeIntentKey) ||
              !/^cchunk_[a-f0-9]{64}$/.test(authority.pageChunkKey) ||
              !/^cenv_[a-f0-9]{64}$/.test(authority.pageEnvelopeKey) ||
              !/^crun_[a-f0-9]{64}$/.test(authority.reconciliationRunKey) ||
              !Number.isSafeInteger(authority.runGeneration) ||
              authority.runGeneration < 1 ||
              !Number.isSafeInteger(authority.allowlistGeneration) ||
              authority.allowlistGeneration < 1 ||
              !Number.isFinite(authority.ledgerSequence) ||
              authority.ledgerSequence < 0)
          ? fail(
              "authority_mismatch",
              "Reconciliation-page authority contains an invalid page or run fence.",
            )
          : authority.authorityKind === "live_capture" &&
              (authority.captureKey.trim().length === 0 ||
                !Number.isSafeInteger(authority.capturedAt) ||
                authority.capturedAt < 0)
            ? fail(
                "authority_mismatch",
                "Live-capture authority requires one real capture key and timestamp.",
              )
            : (authority.providerKind === "slack" &&
                  (authority.corpusKey !== "slack" ||
                    authority.originKind !== "slack")) ||
                (authority.providerKind === "transcript" &&
                  (authority.corpusKey !== "transcripts" ||
                    authority.originKind !== "transcript")) ||
                (authority.providerKind === "google_drive" &&
                  (authority.corpusKey !== "documents" ||
                    authority.originKind !== "document"))
              ? fail(
                  "authority_mismatch",
                  "Provider, corpus, and immutable origin kinds do not agree.",
                )
              : Effect.void;

export const providerTargetResolutionIntentKey = (input: {
  readonly ingestionObligationKey: string;
}): string =>
  `trsi_${sha256Hex(
    stableJson({ ingestionObligationKey: input.ingestionObligationKey }),
  )}`;

export const providerTargetResolutionAuthorityDigest = (
  authority: ProviderTargetResolutionAuthority,
): string => contentDigest(authority);

export const providerTargetResolutionPopulationDigest = (
  targets: readonly ProviderTargetResolutionTarget[],
): string =>
  contentDigest(
    canonicalTargets(targets).map((target) => [
      target.workspaceId,
      target.brainKey,
      target.jobKey,
      target.authorityDigest,
      target.childIngestionObligationKey ?? null,
    ]),
  );

const unresolvedStatuses: ReadonlySet<ProviderTargetResolutionStatus> = new Set(
  ["pending", "retry_wait", "capacity_blocked", "integrity_failure"],
);

const zeroTargetStatuses: ReadonlySet<ProviderTargetResolutionStatus> = new Set(
  ["policy_excluded", "stale"],
);

export const validateProviderTargetResolutionState = (
  state: ProviderTargetResolutionState,
): Effect.Effect<
  ProviderTargetResolutionState,
  ProviderTargetResolutionInvariant
> =>
  Effect.gen(function* () {
    if (
      !Number.isSafeInteger(state.targetCount) ||
      state.targetCount < 0 ||
      (state.completedAt !== null &&
        (!Number.isSafeInteger(state.completedAt) || state.completedAt < 0))
    )
      return yield* fail(
        "invalid_state",
        "Target counts and completion times must be nonnegative integers.",
      );

    if (unresolvedStatuses.has(state.status)) {
      if (
        state.targetCount !== 0 ||
        state.targetDigest !== null ||
        state.targets.length !== 0 ||
        state.completedAt !== null
      )
        return yield* fail(
          "invalid_state",
          "An unresolved target intent cannot claim a target population or completion.",
        );
      return state;
    }

    const targets = yield* validateTargetSet(state.targets, "invalid_state");
    const targetDigest = providerTargetResolutionPopulationDigest(targets);
    if (
      state.targetCount !== targets.length ||
      state.targetDigest !== targetDigest ||
      state.completedAt === null
    )
      return yield* fail(
        "invalid_state",
        "A terminal target intent must contain its exact canonical population.",
      );

    if (zeroTargetStatuses.has(state.status) && targets.length !== 0)
      return yield* fail(
        "invalid_state",
        "Policy exclusion and stale authority require an explicit zero-target population.",
      );
    if (state.status === "succeeded" && targets.length === 0)
      return yield* fail(
        "invalid_state",
        "Successful target resolution must select at least one target.",
      );
    return { ...state, targets };
  });

const allowedTransitions: Readonly<
  Record<
    ProviderTargetResolutionStatus,
    readonly ProviderTargetResolutionStatus[]
  >
> = {
  pending: [
    "retry_wait",
    "capacity_blocked",
    "succeeded",
    "policy_excluded",
    "stale",
    "integrity_failure",
  ],
  retry_wait: [
    "retry_wait",
    "capacity_blocked",
    "succeeded",
    "policy_excluded",
    "stale",
    "integrity_failure",
  ],
  capacity_blocked: [
    "capacity_blocked",
    "retry_wait",
    "succeeded",
    "policy_excluded",
    "stale",
    "integrity_failure",
  ],
  integrity_failure: ["retry_wait"],
  succeeded: [],
  policy_excluded: [],
  stale: [],
};

export const transitionProviderTargetResolutionPlan = (input: {
  readonly current: ProviderTargetResolutionState;
  readonly next: ProviderTargetResolutionState;
}): Effect.Effect<
  ProviderTargetResolutionState,
  ProviderTargetResolutionInvariant
> =>
  Effect.gen(function* () {
    yield* validateProviderTargetResolutionState(input.current);
    const next = yield* validateProviderTargetResolutionState(input.next);
    if (!allowedTransitions[input.current.status].includes(next.status))
      return yield* fail(
        "invalid_transition",
        `Invalid target resolution transition ${input.current.status} -> ${next.status}.`,
      );
    return next;
  });

export const validateProviderTargetResolutionPopulation = (input: {
  readonly authority: ProviderTargetResolutionAuthority;
  readonly expectedTargets: readonly ProviderTargetResolutionTarget[];
  readonly existingChildren: readonly ProviderTargetResolutionChild[];
  readonly maxTargets: number;
}): Effect.Effect<
  ProviderTargetResolutionPopulationPlan,
  ProviderTargetResolutionInvariant
> =>
  Effect.gen(function* () {
    yield* validateAuthority(input.authority);
    if (!Number.isSafeInteger(input.maxTargets) || input.maxTargets < 1)
      return yield* fail(
        "capacity_exceeded",
        "Target resolution capacity must be a positive integer.",
      );
    if (input.expectedTargets.length > input.maxTargets)
      return yield* fail(
        "capacity_exceeded",
        `Target resolution exceeds the ${input.maxTargets} target limit.`,
      );

    const targets = yield* validateTargetSet(
      input.expectedTargets,
      "population_mismatch",
      input.authority.authorityKind,
    );
    const targetDigest = providerTargetResolutionPopulationDigest(targets);
    const plan = (kind: ProviderTargetResolutionPopulationPlan["kind"]) => ({
      kind,
      targetCount: targets.length,
      targetDigest,
      targets,
    });
    if (targets.length === 0) {
      if (input.existingChildren.length !== 0)
        return yield* fail(
          "population_mismatch",
          "A zero-target resolution cannot own publication children.",
        );
      return plan("empty_population");
    }
    if (input.existingChildren.length === 0) return plan("create_all");

    if (
      input.existingChildren.some(
        (child) =>
          child.targetResolutionIntentKey !==
            input.authority.targetResolutionIntentKey ||
          child.parentIngestionObligationKey !==
            input.authority.ingestionObligationKey ||
          child.resolutionGeneration !== input.authority.resolutionGeneration,
      )
    )
      return yield* fail(
        "population_mismatch",
        "A publication child has substituted target-resolution authority.",
      );

    const existingTargets = yield* validateTargetSet(
      input.existingChildren.map((child) => ({
        workspaceId: child.workspaceId,
        brainKey: child.brainKey,
        jobKey: child.jobKey,
        authorityDigest: child.authorityDigest,
        ...(child.childIngestionObligationKey === undefined
          ? {}
          : {
              childIngestionObligationKey: child.childIngestionObligationKey,
            }),
      })),
      "population_mismatch",
      input.authority.authorityKind,
    );
    if (
      stableJson(existingTargets) !== stableJson(targets) ||
      providerTargetResolutionPopulationDigest(existingTargets) !== targetDigest
    )
      return yield* fail(
        "population_mismatch",
        "An existing publication population is partial, extra, or substituted.",
      );
    return plan("already_complete");
  });
