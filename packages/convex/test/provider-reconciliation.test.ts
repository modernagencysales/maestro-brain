import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import { describe, expect, it } from "vitest";

import {
  beginProviderPagePlan,
  closeReconciliationTraversalPlan,
  commitProviderPageChunkPlan,
  completeReconciliationRunPlan,
  finalizeProviderPagePlan,
  isSuccessfulObligationState,
  openReconciliationRunPlan,
  planReconciliationRemovals,
  providerPageChunkDigest,
  transitionIngestionObligationPlan,
  type ConnectorCursorState,
  type IngestionObligationState,
  type ReconciliationScopeAuthority,
} from "../confect/integrations/providerReconciliation";
import { slackReconciliationObservation } from "../confect/integrations/slackReconciliationAdapter";
import { transcriptReconciliationObservation } from "../confect/integrations/transcriptReconciliationAdapter";

const now = 1_782_924_800_000;
const scope: ReconciliationScopeAuthority = {
  organizationKey: "ag_provider_reconciliation",
  workspaceId: "workspace_provider_reconciliation",
  brainKey: "br_provider_reconciliation",
  corpusKey: "slack",
  providerKind: "slack",
  connectorScopeKey: "scope_provider_reconciliation",
  connectionKey: "connection_provider_reconciliation",
  connectionGeneration: 2,
  allowlistGeneration: 3,
};

const cursor: ConnectorCursorState = {
  ...scope,
  cursorKey: "cursor_provider_reconciliation",
  providerCursor: "cursor-1",
  cursorGeneration: 4,
  activeEnvelopeKey: null,
  lastProviderHighWater: "provider-9",
  ledgerHighWater: 90.25,
  updatedAt: now,
};

const unwrap = async <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(effect);

describe("provider reconciliation", () => {
  it("fences successor runs and obsolete scope tuples", async () => {
    const run = await unwrap(
      openReconciliationRunPlan({
        authority: scope,
        previousRunGeneration: 4,
        expectedPreviousRunGeneration: 4,
        providerHighWater: "provider-10",
        ledgerHighWater: 100.5,
        leaseId: "lease-5",
        leaseGeneration: 1,
        leaseExpiresAt: now + 60_000,
        now,
      }),
    );

    expect(run.runGeneration).toBe(5);
    expect(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(
            closeReconciliationTraversalPlan({
              run,
              currentAuthority: scope,
              latestRunGeneration: 6,
              providerCursor: null,
              activeEnvelopeKey: null,
              now: now + 1,
            }),
          ),
        ),
      ),
    ).toBe(true);

    const changedTuple = { ...scope, connectionGeneration: 3 };
    expect(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(
            closeReconciliationTraversalPlan({
              run,
              currentAuthority: changedTuple,
              latestRunGeneration: run.runGeneration,
              providerCursor: null,
              activeEnvelopeKey: null,
              now: now + 1,
            }),
          ),
        ),
      ),
    ).toBe(true);
  });

  it("advances a cursor only after the exact immutable page chunks commit", async () => {
    const run = await unwrap(
      openReconciliationRunPlan({
        authority: scope,
        previousRunGeneration: 0,
        expectedPreviousRunGeneration: 0,
        providerHighWater: "provider-10",
        ledgerHighWater: 100.5,
        leaseId: "lease-1",
        leaseGeneration: 1,
        leaseExpiresAt: now + 60_000,
        now,
      }),
    );
    const firstObservations = [
      slackReconciliationObservation({
        organizationKey: scope.organizationKey,
        connectionKey: scope.connectionKey,
        connectionGeneration: scope.connectionGeneration,
        channelKey: "channel-1",
        sourceKey: "source-1",
        sourceRevisionKey: "revision-1",
        providerObjectKey: "message-1",
        ledgerSequence: 91.125,
        observationDigest: `sha256:${"c".repeat(64)}`,
      }),
    ];
    const secondObservations = [
      slackReconciliationObservation({
        organizationKey: scope.organizationKey,
        connectionKey: scope.connectionKey,
        connectionGeneration: scope.connectionGeneration,
        channelKey: "channel-1",
        sourceKey: "source-2",
        sourceRevisionKey: "revision-2",
        providerObjectKey: "message-2",
        ledgerSequence: 92.25,
        observationDigest: `sha256:${"d".repeat(64)}`,
      }),
    ];
    const firstChunkDigest = providerPageChunkDigest(firstObservations);
    const secondChunkDigest = providerPageChunkDigest(secondObservations);
    const page = await unwrap(
      beginProviderPagePlan({
        run,
        currentAuthority: scope,
        latestRunGeneration: run.runGeneration,
        cursor,
        expectedCursor: "cursor-1",
        expectedCursorGeneration: 4,
        nextCursor: "cursor-2",
        providerHighWater: "provider-10",
        ledgerHighWater: 100.5,
        chunks: [
          {
            chunkIndex: 0,
            chunkDigest: firstChunkDigest,
            observationCount: 1,
          },
          {
            chunkIndex: 1,
            chunkDigest: secondChunkDigest,
            observationCount: 1,
          },
        ],
        now,
      }),
    );
    const first = await unwrap(
      commitProviderPageChunkPlan({
        envelope: page.envelope,
        chunkIndex: 0,
        chunkDigest: firstChunkDigest,
        observations: firstObservations,
        existingReceipt: null,
        now,
      }),
    );

    expect(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(
            finalizeProviderPagePlan({
              cursor: page.cursor,
              envelope: page.envelope,
              receipts: [first.receipt],
              now: now + 1,
            }),
          ),
        ),
      ),
    ).toBe(true);

    const second = await unwrap(
      commitProviderPageChunkPlan({
        envelope: page.envelope,
        chunkIndex: 1,
        chunkDigest: secondChunkDigest,
        observations: secondObservations,
        existingReceipt: null,
        now,
      }),
    );
    const advanced = await unwrap(
      finalizeProviderPagePlan({
        cursor: page.cursor,
        envelope: page.envelope,
        receipts: [first.receipt, second.receipt],
        now: now + 1,
      }),
    );

    expect(advanced).toMatchObject({
      providerCursor: "cursor-2",
      cursorGeneration: 5,
      activeEnvelopeKey: null,
      lastProviderHighWater: "provider-10",
      ledgerHighWater: 100.5,
    });

    const substituted = await Effect.runPromise(
      Effect.either(
        commitProviderPageChunkPlan({
          envelope: page.envelope,
          chunkIndex: 0,
          chunkDigest: `sha256:${"f".repeat(64)}`,
          observations: first.observations,
          existingReceipt: first.receipt,
          now,
        }),
      ),
    );
    expect(Either.isLeft(substituted)).toBe(true);
  });

  it("infers removals only after traversal close and below the ledger high-water", async () => {
    const run = await unwrap(
      openReconciliationRunPlan({
        authority: scope,
        previousRunGeneration: 0,
        expectedPreviousRunGeneration: 0,
        providerHighWater: "provider-10",
        ledgerHighWater: 100.5,
        leaseId: "lease-1",
        leaseGeneration: 1,
        leaseExpiresAt: now + 60_000,
        now,
      }),
    );
    const closed = await unwrap(
      closeReconciliationTraversalPlan({
        run,
        currentAuthority: scope,
        latestRunGeneration: run.runGeneration,
        providerCursor: null,
        activeEnvelopeKey: null,
        now: now + 1,
      }),
    );
    const removals = await unwrap(
      planReconciliationRemovals({
        run: closed,
        currentAuthority: scope,
        latestRunGeneration: closed.runGeneration,
        seenMembershipKeys: new Set(["membership-seen"]),
        candidates: [
          {
            membershipKey: "membership-seen",
            originKind: "slack",
            originKey: "source-seen",
            originRevisionKey: "revision-seen",
            ledgerSequence: 90,
          },
          {
            membershipKey: "membership-missing",
            originKind: "slack",
            originKey: "source-missing",
            originRevisionKey: "revision-missing",
            ledgerSequence: 91,
          },
          {
            membershipKey: "membership-live-after-fence",
            originKind: "slack",
            originKey: "source-live",
            originRevisionKey: "revision-live",
            ledgerSequence: 101,
          },
        ],
      }),
    );

    expect(removals.map(({ membershipKey }) => membershipKey)).toEqual([
      "membership-missing",
    ]);
  });

  it("treats every unresolved obligation class as nonterminal", async () => {
    const nonterminal: readonly IngestionObligationState[] = [
      "captured",
      "normalization_pending",
      "quarantined",
      "target_resolution_pending",
      "capacity_blocked",
      "publication_pending",
      "retry_wait",
      "removal_pending",
      "drain_pending",
      "failed",
    ];
    expect(
      nonterminal.every((state) => !isSuccessfulObligationState(state)),
    ).toBe(true);
    expect(isSuccessfulObligationState("complete")).toBe(true);
    expect(isSuccessfulObligationState("policy_excluded")).toBe(true);

    const transitioned = await unwrap(
      transitionIngestionObligationPlan({
        current: "captured",
        expected: "captured",
        next: "normalization_pending",
      }),
    );
    expect(transitioned).toBe("normalization_pending");
    expect(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(
            transitionIngestionObligationPlan({
              current: "complete",
              expected: "complete",
              next: "publication_pending",
            }),
          ),
        ),
      ),
    ).toBe(true);
  });

  it("closes only after removal, drain, and obligations are complete", async () => {
    const run = await unwrap(
      openReconciliationRunPlan({
        authority: scope,
        previousRunGeneration: 0,
        expectedPreviousRunGeneration: 0,
        providerHighWater: "provider-10",
        ledgerHighWater: 100.5,
        leaseId: "lease-1",
        leaseGeneration: 1,
        leaseExpiresAt: now + 60_000,
        now,
      }),
    );
    const drainRun = {
      ...run,
      status: "drain_derived" as const,
      removalCursor: null,
      drainCursor: null,
      removalBacklogCount: 0,
      drainBacklogCount: 0,
    };

    const blocked = await Effect.runPromise(
      Effect.either(
        completeReconciliationRunPlan({
          run: drainRun,
          currentAuthority: scope,
          latestRunGeneration: run.runGeneration,
          obligationStates: ["complete", "quarantined"],
          requiredIntentCurrent: true,
          now: now + 2,
        }),
      ),
    );
    expect(Either.isLeft(blocked)).toBe(true);

    const complete = await unwrap(
      completeReconciliationRunPlan({
        run: drainRun,
        currentAuthority: scope,
        latestRunGeneration: run.runGeneration,
        obligationStates: ["complete", "policy_excluded"],
        requiredIntentCurrent: true,
        now: now + 2,
      }),
    );
    expect(complete.status).toBe("complete");
    expect(complete.completionReceipt).toMatchObject({
      ledgerHighWater: 100.5,
      completedAt: now + 2,
      successfulObligationCount: 2,
      blockingObligationCount: 0,
    });
  });

  it("normalizes Slack and transcript observations without sharing identities", () => {
    const slack = slackReconciliationObservation({
      organizationKey: scope.organizationKey,
      connectionKey: scope.connectionKey,
      connectionGeneration: scope.connectionGeneration,
      channelKey: "channel-1",
      sourceKey: "source-1",
      sourceRevisionKey: "revision-1",
      providerObjectKey: "message-1",
      ledgerSequence: 91.125,
      observationDigest: `sha256:${"c".repeat(64)}`,
    });
    const transcript = transcriptReconciliationObservation({
      organizationKey: scope.organizationKey,
      connectionKey: scope.connectionKey,
      connectionGeneration: scope.connectionGeneration,
      providerKey: "gong",
      unitKey: "unit-1",
      unitRevisionKey: "unit-revision-1",
      externalCallId: "call-1",
      ledgerSequence: 92.25,
      observationDigest: `sha256:${"d".repeat(64)}`,
    });

    expect(slack).toMatchObject({
      originKind: "slack",
      originKey: "source-1",
      originRevisionKey: "revision-1",
    });
    expect(transcript).toMatchObject({
      originKind: "transcript",
      originKey: "unit-1",
      originRevisionKey: "unit-revision-1",
    });
    expect(slack.membershipKey).not.toBe(transcript.membershipKey);
  });
});
