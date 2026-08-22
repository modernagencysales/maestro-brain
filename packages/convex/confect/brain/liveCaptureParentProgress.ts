import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";

import { DatabaseReader, DatabaseWriter } from "../_generated/services";

const unresolvedParentState = (
  status: "pending" | "retry_wait" | "capacity_blocked",
) => (status === "pending" ? ("target_resolution_pending" as const) : status);

export const progressLiveCaptureParentEffect = (input: {
  readonly targetResolutionIntentId: GenericId<"providerTargetResolutionIntents">;
  readonly now: number;
}): Effect.Effect<void, never, DatabaseReader | DatabaseWriter> =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const intent = yield* reader
      .table("providerTargetResolutionIntents")
      .get(input.targetResolutionIntentId)
      .pipe(Effect.orDie);
    if (intent === undefined || intent.authorityKind !== "live_capture") return;

    const parentRows = yield* reader
      .table("ingestionObligations")
      .index("by_ingestion_obligation_key", (query) =>
        query.eq("ingestionObligationKey", intent.ingestionObligationKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (parentRows.length > 1)
      return yield* Effect.dieMessage(
        "Live-capture parent obligation identity is ambiguous.",
      );
    let parent = parentRows[0];
    if (
      parent !== undefined &&
      (parent.authorityKind !== "live_capture" ||
        parent.parentIngestionObligationKey !== undefined ||
        parent.workspaceId !== undefined ||
        parent.brainKey !== undefined ||
        parent.allowlistGeneration !== undefined ||
        parent.requiredScopeIntentKey !== undefined ||
        parent.organizationKey !== intent.organizationKey ||
        parent.corpusKey !== intent.corpusKey ||
        parent.providerKind !== intent.providerKind ||
        parent.connectorScopeKey !== intent.connectorScopeKey ||
        parent.connectionKey !== intent.connectionKey ||
        parent.connectionGeneration !== intent.connectionGeneration ||
        parent.originKind !== intent.originKind ||
        parent.originKey !== intent.originKey ||
        parent.originRevisionKey !== intent.originRevisionKey ||
        parent.targetResolutionIntentId !== intent._id ||
        parent.targetResolutionIntentKey !== intent.targetResolutionIntentKey)
    )
      return yield* Effect.dieMessage(
        "Live-capture parent obligation authority conflicts.",
      );
    if (parent === undefined) {
      const parentId = yield* writer
        .table("ingestionObligations")
        .insert({
          schemaVersion: 1,
          authorityKind: "live_capture",
          organizationKey: intent.organizationKey,
          corpusKey: intent.corpusKey,
          providerKind: intent.providerKind,
          connectorScopeKey: intent.connectorScopeKey,
          connectionKey: intent.connectionKey,
          connectionGeneration: intent.connectionGeneration,
          ingestionObligationKey: intent.ingestionObligationKey,
          cause: "observation",
          membershipKey: intent.membershipKey,
          originKind: intent.originKind,
          originKey: intent.originKey,
          originRevisionKey: intent.originRevisionKey,
          ledgerSequence: intent.capturedAt ?? input.now,
          state:
            intent.status === "pending" ||
            intent.status === "retry_wait" ||
            intent.status === "capacity_blocked"
              ? unresolvedParentState(intent.status)
              : intent.status === "succeeded"
                ? "drain_pending"
                : intent.status === "integrity_failure"
                  ? "failed"
                  : "policy_excluded",
          targetResolutionIntentId: intent._id,
          targetResolutionIntentKey: intent.targetResolutionIntentKey,
          publicationJobKeys: [],
          errorTag: intent.lastErrorTag,
          terminalAt: null,
          createdAt: intent.createdAt,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
      parent = yield* reader
        .table("ingestionObligations")
        .get(parentId)
        .pipe(Effect.orDie);
    }
    if (parent === undefined)
      return yield* Effect.dieMessage(
        "Live-capture parent obligation could not be established.",
      );

    let state = parent.state;
    let errorTag: string | null = intent.lastErrorTag;
    if (
      intent.status === "pending" ||
      intent.status === "retry_wait" ||
      intent.status === "capacity_blocked"
    ) {
      state = unresolvedParentState(intent.status);
    } else if (
      intent.status === "policy_excluded" ||
      intent.status === "stale"
    ) {
      state = "policy_excluded";
      errorTag = null;
    } else if (intent.status === "integrity_failure") {
      state = "failed";
      errorTag ??= "LiveCaptureTargetResolutionIntegrityFailure";
    } else {
      const expectedChildKeys = intent.targets.flatMap((target) =>
        target.childIngestionObligationKey === undefined
          ? []
          : [target.childIngestionObligationKey],
      );
      const children = yield* reader
        .table("ingestionObligations")
        .index("by_parent_obligation_state", (query) =>
          query.eq(
            "parentIngestionObligationKey",
            intent.ingestionObligationKey,
          ),
        )
        .take(101)
        .pipe(Effect.orDie);
      const exactChildPopulation =
        children.length <= 100 &&
        intent.targetCount > 0 &&
        expectedChildKeys.length === intent.targetCount &&
        new Set(expectedChildKeys).size === intent.targetCount &&
        children.length === intent.targetCount &&
        children.every(
          (child) =>
            child.authorityKind === "live_capture" &&
            child.targetResolutionIntentId === intent._id &&
            expectedChildKeys.includes(child.ingestionObligationKey),
        );
      if (!exactChildPopulation) {
        state = children.length > 100 ? "failed" : "drain_pending";
        errorTag =
          children.length > 100
            ? "LiveCaptureChildPopulationCapacityExceeded"
            : null;
      } else if (
        children.some(
          (child) => child.state === "failed" || child.state === "quarantined",
        )
      ) {
        state = "failed";
        errorTag = "LiveCaptureChildFailed";
      } else if (
        children.every(
          (child) =>
            child.state === "complete" || child.state === "policy_excluded",
        )
      ) {
        state = "complete";
        errorTag = null;
      } else {
        state = "drain_pending";
        errorTag = null;
      }
    }

    const terminal =
      state === "complete" || state === "policy_excluded" || state === "failed";
    if (
      parent.state !== state ||
      parent.errorTag !== errorTag ||
      (terminal ? parent.terminalAt === null : parent.terminalAt !== null)
    )
      yield* writer
        .table("ingestionObligations")
        .patch(parent._id, {
          state,
          errorTag,
          terminalAt: terminal ? input.now : null,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
  });
