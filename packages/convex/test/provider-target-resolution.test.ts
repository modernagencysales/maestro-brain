import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import { describe, expect, it } from "vitest";

import {
  providerTargetResolutionAuthorityDigest,
  providerTargetResolutionIntentKey,
  providerTargetResolutionPopulationDigest,
  transitionProviderTargetResolutionPlan,
  validateProviderTargetResolutionPopulation,
  validateProviderTargetResolutionState,
  type ProviderTargetResolutionAuthority,
  type ProviderTargetResolutionChild,
  type ProviderTargetResolutionState,
  type ProviderTargetResolutionTarget,
} from "../confect/brain/providerTargetResolution";

const ingestionObligationKey = `iobl_${"b".repeat(64)}`;
const authority: ProviderTargetResolutionAuthority = {
  authorityKind: "reconciliation_page",
  targetResolutionIntentKey: providerTargetResolutionIntentKey({
    ingestionObligationKey,
  }),
  ingestionObligationKey,
  requiredScopeIntentKey: `brsi_${"c".repeat(64)}`,
  pageChunkKey: `cchunk_${"d".repeat(64)}`,
  pageEnvelopeKey: `cenv_${"e".repeat(64)}`,
  reconciliationRunKey: `crun_${"f".repeat(64)}`,
  runGeneration: 3,
  organizationKey: "ag_target_resolution",
  workspaceId: "workspace_target_resolution",
  brainKey: "brain_target_resolution",
  corpusKey: "slack",
  providerKind: "slack",
  connectorScopeKey: "scope_target_resolution",
  connectionKey: "connection_target_resolution",
  connectionGeneration: 5,
  allowlistGeneration: 7,
  membershipKey: "membership_target_resolution",
  originKind: "slack",
  originKey: "source_target_resolution",
  originRevisionKey: "revision_target_resolution",
  ledgerSequence: 11,
  observationDigest: `sha256:${"1".repeat(64)}`,
  resolutionGeneration: 1,
};

const targetB: ProviderTargetResolutionTarget = {
  workspaceId: "workspace_b",
  brainKey: "brain_b",
  jobKey: `rjob_${"2".repeat(64)}`,
  authorityDigest: `raud_${"3".repeat(64)}`,
};
const targetA: ProviderTargetResolutionTarget = {
  workspaceId: "workspace_a",
  brainKey: "brain_a",
  jobKey: `rjob_${"4".repeat(64)}`,
  authorityDigest: `raud_${"5".repeat(64)}`,
};
const targets: readonly ProviderTargetResolutionTarget[] = [targetB, targetA];

const children = (
  population: readonly ProviderTargetResolutionTarget[] = targets,
): readonly ProviderTargetResolutionChild[] =>
  population.map((target) => ({
    ...target,
    targetResolutionIntentKey: authority.targetResolutionIntentKey,
    parentIngestionObligationKey: authority.ingestionObligationKey,
    resolutionGeneration: authority.resolutionGeneration,
  }));

const runEither = <A>(effect: Effect.Effect<A, unknown>) =>
  Effect.runSync(Effect.either(effect));

const pendingState: ProviderTargetResolutionState = {
  status: "pending",
  targetCount: 0,
  targetDigest: null,
  targets: [],
  completedAt: null,
};

describe("provider target resolution", () => {
  it("keeps live-capture authority provider-neutral until exact Brain children resolve", () => {
    const parentIngestionObligationKey = `iobl_${"7".repeat(64)}`;
    const liveAuthority: ProviderTargetResolutionAuthority = {
      authorityKind: "live_capture",
      targetResolutionIntentKey: providerTargetResolutionIntentKey({
        ingestionObligationKey: parentIngestionObligationKey,
      }),
      ingestionObligationKey: parentIngestionObligationKey,
      organizationKey: "ag_live_capture",
      corpusKey: "transcripts",
      providerKind: "transcript",
      connectorScopeKey: "transcript-connection",
      connectionKey: "transcript-connection",
      connectionGeneration: 2,
      membershipKey: "provider-call-1",
      originKind: "transcript",
      originKey: "source-unit-1",
      originRevisionKey: "source-unit-revision-1",
      observationDigest: `sha256:${"8".repeat(64)}`,
      resolutionGeneration: 1,
      captureKey: "transcript-page:cursor-1:call-1",
      capturedAt: 100,
    };
    const childIngestionObligationKey = `iobl_${"9".repeat(64)}`;
    const liveTarget = {
      ...targetA,
      childIngestionObligationKey,
    };
    expect(
      Effect.runSync(
        validateProviderTargetResolutionPopulation({
          authority: liveAuthority,
          expectedTargets: [liveTarget],
          existingChildren: [],
          maxTargets: 100,
        }),
      ),
    ).toMatchObject({ kind: "create_all", targets: [liveTarget] });
    expect(
      Either.isLeft(
        runEither(
          validateProviderTargetResolutionPopulation({
            authority: liveAuthority,
            expectedTargets: [targetA],
            existingChildren: [],
            maxTargets: 100,
          }),
        ),
      ),
    ).toBe(true);
    expect(
      Effect.runSync(
        validateProviderTargetResolutionPopulation({
          authority: liveAuthority,
          expectedTargets: [liveTarget],
          existingChildren: [
            {
              ...liveTarget,
              targetResolutionIntentKey:
                liveAuthority.targetResolutionIntentKey,
              parentIngestionObligationKey,
              resolutionGeneration: 1,
            },
          ],
          maxTargets: 100,
        }),
      ),
    ).toMatchObject({ kind: "already_complete" });
  });

  it("builds stable intent, authority, and order-independent target digests", () => {
    expect(
      providerTargetResolutionIntentKey({
        ingestionObligationKey: authority.ingestionObligationKey,
      }),
    ).toMatch(/^trsi_[a-f0-9]{64}$/);
    expect(providerTargetResolutionAuthorityDigest(authority)).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(providerTargetResolutionPopulationDigest(targets)).toBe(
      providerTargetResolutionPopulationDigest([...targets].reverse()),
    );
    expect(
      providerTargetResolutionPopulationDigest([
        { ...targetB, brainKey: "changed" },
        targetA,
      ]),
    ).not.toBe(providerTargetResolutionPopulationDigest(targets));
  });

  it("enforces unresolved, successful, and explicit zero-target state shapes", () => {
    expect(
      Either.isRight(
        runEither(validateProviderTargetResolutionState(pendingState)),
      ),
    ).toBe(true);

    const succeeded: ProviderTargetResolutionState = {
      status: "succeeded",
      targetCount: targets.length,
      targetDigest: providerTargetResolutionPopulationDigest(targets),
      targets,
      completedAt: 100,
    };
    expect(
      Either.isRight(
        runEither(validateProviderTargetResolutionState(succeeded)),
      ),
    ).toBe(true);

    const policyExcluded: ProviderTargetResolutionState = {
      status: "policy_excluded",
      targetCount: 0,
      targetDigest: providerTargetResolutionPopulationDigest([]),
      targets: [],
      completedAt: 100,
    };
    expect(
      Either.isRight(
        runEither(validateProviderTargetResolutionState(policyExcluded)),
      ),
    ).toBe(true);

    expect(
      Either.isLeft(
        runEither(
          validateProviderTargetResolutionState({
            ...pendingState,
            targetCount: 1,
            targets: [targetB],
          }),
        ),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        runEither(
          validateProviderTargetResolutionState({
            ...succeeded,
            targetDigest: providerTargetResolutionPopulationDigest([]),
          }),
        ),
      ),
    ).toBe(true);
  });

  it("allows only resumable nonterminal transitions and immutable terminal states", () => {
    expect(
      Either.isRight(
        runEither(
          transitionProviderTargetResolutionPlan({
            current: pendingState,
            next: {
              ...pendingState,
              status: "capacity_blocked",
            },
          }),
        ),
      ),
    ).toBe(true);

    const terminal: ProviderTargetResolutionState = {
      status: "stale",
      targetCount: 0,
      targetDigest: providerTargetResolutionPopulationDigest([]),
      targets: [],
      completedAt: 100,
    };
    expect(
      Either.isLeft(
        runEither(
          transitionProviderTargetResolutionPlan({
            current: terminal,
            next: { ...pendingState, status: "retry_wait" },
          }),
        ),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        runEither(
          transitionProviderTargetResolutionPlan({
            current: { ...pendingState, status: "integrity_failure" },
            next: {
              status: "succeeded",
              targetCount: targets.length,
              targetDigest: providerTargetResolutionPopulationDigest(targets),
              targets,
              completedAt: 100,
            },
          }),
        ),
      ),
    ).toBe(true);
  });

  it("returns create-all for an empty child population and idempotency for an exact one", () => {
    const createAll = Effect.runSync(
      validateProviderTargetResolutionPopulation({
        authority,
        expectedTargets: targets,
        existingChildren: [],
        maxTargets: 100,
      }),
    );
    expect(createAll.kind).toBe("create_all");
    expect(createAll.targetCount).toBe(targets.length);
    expect(createAll.targets.map((target) => target.workspaceId)).toEqual([
      "workspace_a",
      "workspace_b",
    ]);

    const complete = Effect.runSync(
      validateProviderTargetResolutionPopulation({
        authority,
        expectedTargets: targets,
        existingChildren: children([...targets].reverse()),
        maxTargets: 100,
      }),
    );
    expect(complete.kind).toBe("already_complete");
    expect(complete.targetDigest).toBe(createAll.targetDigest);

    const empty = Effect.runSync(
      validateProviderTargetResolutionPopulation({
        authority,
        expectedTargets: [],
        existingChildren: [],
        maxTargets: 100,
      }),
    );
    expect(empty.kind).toBe("empty_population");
  });

  it("rejects capacity overflow, duplicates, partial, extra, and substituted children", () => {
    const cases = [
      validateProviderTargetResolutionPopulation({
        authority,
        expectedTargets: targets,
        existingChildren: [],
        maxTargets: 1,
      }),
      validateProviderTargetResolutionPopulation({
        authority,
        expectedTargets: [targetB, { ...targetB }],
        existingChildren: [],
        maxTargets: 100,
      }),
      validateProviderTargetResolutionPopulation({
        authority,
        expectedTargets: targets,
        existingChildren: children([targetB]),
        maxTargets: 100,
      }),
      validateProviderTargetResolutionPopulation({
        authority,
        expectedTargets: [targetB],
        existingChildren: children(targets),
        maxTargets: 100,
      }),
      validateProviderTargetResolutionPopulation({
        authority,
        expectedTargets: targets,
        existingChildren: children().map((child, index) =>
          index === 0
            ? {
                ...child,
                parentIngestionObligationKey: `iobl_${"9".repeat(64)}`,
              }
            : child,
        ),
        maxTargets: 100,
      }),
      validateProviderTargetResolutionPopulation({
        authority: {
          ...authority,
          targetResolutionIntentKey: `trsi_${"8".repeat(64)}`,
        },
        expectedTargets: targets,
        existingChildren: [],
        maxTargets: 100,
      }),
      validateProviderTargetResolutionPopulation({
        authority: {
          ...authority,
          corpusKey: "documents",
        },
        expectedTargets: targets,
        existingChildren: [],
        maxTargets: 100,
      }),
    ];

    for (const effect of cases)
      expect(Either.isLeft(runEither(effect))).toBe(true);
  });
});
