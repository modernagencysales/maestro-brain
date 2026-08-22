import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";

import {
  DatabaseReader,
  DatabaseWriter,
  Scheduler,
} from "../_generated/services";
import { sha256Hex } from "../shared/sha256";
import {
  providerTargetResolutionPopulationDigest,
  type ProviderTargetResolutionTarget,
} from "./providerTargetResolution";
import { progressLiveCaptureParentEffect } from "./liveCaptureParentProgress";
import { enqueueRetrievalPublicationJobEffect } from "./retrievalPublication.impl";

const stableKey = (prefix: string, value: unknown): string =>
  `${prefix}_${sha256Hex(JSON.stringify(value))}`;

export const resolveTranscriptLiveCaptureTargetEffect = (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly unitKey: string;
  readonly unitRevisionKey: string;
  readonly routeGeneration: number;
  readonly now: number;
}): Effect.Effect<
  string | null,
  never,
  DatabaseReader | DatabaseWriter | Scheduler
> =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const parents = yield* reader
      .table("providerTargetResolutionIntents")
      .index("by_origin_revision", (query) =>
        query
          .eq("organizationKey", input.organizationKey)
          .eq("originKind", "transcript")
          .eq("originRevisionKey", input.unitRevisionKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const parent = parents[0];
    if (parents.length === 0 || parent === undefined) return null;
    if (
      parents.length !== 1 ||
      parent.authorityKind !== "live_capture" ||
      parent.providerKind !== "transcript" ||
      parent.corpusKey !== "transcripts" ||
      parent.organizationKey !== input.organizationKey ||
      parent.connectorScopeKey !== input.connectionKey ||
      parent.connectionKey !== input.connectionKey ||
      parent.connectionGeneration !== input.connectionGeneration ||
      parent.originKey !== input.unitKey ||
      parent.originRevisionKey !== input.unitRevisionKey ||
      parent.captureKey === undefined ||
      parent.capturedAt === undefined
    )
      return yield* Effect.dieMessage(
        "Transcript live-capture parent authority is missing or ambiguous.",
      );
    const parentObligations = yield* reader
      .table("ingestionObligations")
      .index("by_ingestion_obligation_key", (query) =>
        query.eq("ingestionObligationKey", parent.ingestionObligationKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    let parentObligation = parentObligations[0];
    if (
      parentObligations.length > 1 ||
      (parentObligation !== undefined &&
        (parentObligation.authorityKind !== "live_capture" ||
          parentObligation.parentIngestionObligationKey !== undefined ||
          parentObligation.workspaceId !== undefined ||
          parentObligation.brainKey !== undefined ||
          parentObligation.allowlistGeneration !== undefined ||
          parentObligation.requiredScopeIntentKey !== undefined ||
          parentObligation.organizationKey !== parent.organizationKey ||
          parentObligation.providerKind !== "transcript" ||
          parentObligation.connectorScopeKey !== parent.connectorScopeKey ||
          parentObligation.connectionKey !== parent.connectionKey ||
          parentObligation.connectionGeneration !==
            parent.connectionGeneration ||
          parentObligation.originKey !== parent.originKey ||
          parentObligation.originRevisionKey !== parent.originRevisionKey ||
          parentObligation.targetResolutionIntentId !== parent._id ||
          parentObligation.targetResolutionIntentKey !==
            parent.targetResolutionIntentKey))
    )
      return yield* Effect.dieMessage(
        "Transcript live parent obligation authority conflicts.",
      );
    if (parentObligation === undefined) {
      const parentObligationId = yield* writer
        .table("ingestionObligations")
        .insert({
          schemaVersion: 1,
          authorityKind: "live_capture",
          organizationKey: parent.organizationKey,
          corpusKey: "transcripts",
          providerKind: "transcript",
          connectorScopeKey: parent.connectorScopeKey,
          connectionKey: parent.connectionKey,
          connectionGeneration: parent.connectionGeneration,
          ingestionObligationKey: parent.ingestionObligationKey,
          cause: "observation",
          membershipKey: parent.membershipKey,
          originKind: "transcript",
          originKey: parent.originKey,
          originRevisionKey: parent.originRevisionKey,
          ledgerSequence: parent.capturedAt,
          state:
            parent.status === "capacity_blocked"
              ? "capacity_blocked"
              : parent.status === "retry_wait"
                ? "retry_wait"
                : "target_resolution_pending",
          targetResolutionIntentId: parent._id,
          targetResolutionIntentKey: parent.targetResolutionIntentKey,
          publicationJobKeys: [],
          errorTag: parent.lastErrorTag,
          terminalAt: null,
          createdAt: parent.createdAt,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
      parentObligation = yield* reader
        .table("ingestionObligations")
        .get(parentObligationId)
        .pipe(Effect.orDie);
    }
    if (parentObligation === undefined)
      return yield* Effect.dieMessage(
        "Transcript live parent obligation could not be established.",
      );

    const connectorScopeKey = input.connectionKey;
    const allowlistGeneration = input.routeGeneration;
    const controllingConfigurationDigest = `sha256:${sha256Hex(
      JSON.stringify({
        authorityKind: "live_capture",
        providerKind: "transcript",
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        connectorScopeKey,
        connectionKey: input.connectionKey,
        connectionGeneration: input.connectionGeneration,
        routeGeneration: input.routeGeneration,
      }),
    )}`;
    const allowlistGenerationKey = stableKey("calg", {
      connectorScopeKey,
      connectionGeneration: input.connectionGeneration,
      allowlistGeneration,
      controllingConfigurationDigest,
    });
    const allowlists = yield* reader
      .table("connectorAllowlistGenerations")
      .index("by_scope_generation", (query) =>
        query
          .eq("connectorScopeKey", connectorScopeKey)
          .eq("allowlistGeneration", allowlistGeneration),
      )
      .take(2)
      .pipe(Effect.orDie);
    const allowlist = allowlists[0];
    if (
      allowlists.length > 1 ||
      (allowlist !== undefined &&
        (allowlist.organizationKey !== input.organizationKey ||
          allowlist.allowlistGenerationKey !== allowlistGenerationKey ||
          allowlist.connectionKey !== input.connectionKey ||
          allowlist.connectionGeneration !== input.connectionGeneration ||
          allowlist.configurationDigest !== controllingConfigurationDigest))
    )
      return yield* Effect.dieMessage(
        "Transcript live allowlist authority conflicts.",
      );
    if (allowlist === undefined)
      yield* writer
        .table("connectorAllowlistGenerations")
        .insert({
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          connectorScopeKey,
          allowlistGenerationKey,
          connectionKey: input.connectionKey,
          connectionGeneration: input.connectionGeneration,
          allowlistGeneration,
          configurationDigest: controllingConfigurationDigest,
          memberCount: 0,
          state: "current",
          createdAt: input.now,
          supersededAt: null,
        })
        .pipe(Effect.orDie);

    const scopes = yield* reader
      .table("connectorScopes")
      .index("by_connector_scope_key", (query) =>
        query.eq("connectorScopeKey", connectorScopeKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const scope = scopes[0];
    if (
      scopes.length > 1 ||
      (scope !== undefined &&
        (scope.organizationKey !== input.organizationKey ||
          scope.providerKind !== "transcript" ||
          scope.providerContainerKey !== input.connectionKey ||
          scope.connectionKey !== input.connectionKey))
    )
      return yield* Effect.dieMessage(
        "Transcript live connector-scope authority conflicts.",
      );
    if (scope === undefined)
      yield* writer
        .table("connectorScopes")
        .insert({
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          connectorScopeKey,
          providerKind: "transcript",
          providerContainerKey: input.connectionKey,
          connectionKey: input.connectionKey,
          currentConnectionGeneration: input.connectionGeneration,
          currentAllowlistGeneration: allowlistGeneration,
          scopeGeneration: 1,
          state: "active",
          createdAt: input.now,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
    else if (
      scope.state !== "active" ||
      scope.currentConnectionGeneration !== input.connectionGeneration ||
      scope.currentAllowlistGeneration !== allowlistGeneration
    )
      yield* writer
        .table("connectorScopes")
        .patch(scope._id, {
          currentConnectionGeneration: input.connectionGeneration,
          currentAllowlistGeneration: allowlistGeneration,
          scopeGeneration: scope.scopeGeneration + 1,
          state: "active",
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);

    const requiredScopeIntentKey = stableKey("brsi", {
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      corpusKey: "transcripts",
      providerKind: "transcript",
      connectorScopeKey,
    });
    const requiredRows = yield* reader
      .table("brainRequiredScopeIntents")
      .index("by_required_scope_intent_key", (query) =>
        query.eq("requiredScopeIntentKey", requiredScopeIntentKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const required = requiredRows[0];
    if (requiredRows.length > 1)
      return yield* Effect.dieMessage(
        "Transcript required-scope authority is ambiguous.",
      );
    const requiredExact =
      required !== undefined &&
      required.organizationKey === input.organizationKey &&
      required.workspaceId === input.workspaceId &&
      required.brainKey === input.brainKey &&
      required.corpusKey === "transcripts" &&
      required.providerKind === "transcript" &&
      required.connectorScopeKey === connectorScopeKey &&
      required.connectionKey === input.connectionKey &&
      required.connectionGeneration === input.connectionGeneration &&
      required.allowlistGeneration === allowlistGeneration &&
      required.controllingConfigurationDigest ===
        controllingConfigurationDigest &&
      required.state === "required";
    if (!requiredExact) {
      const row = {
        schemaVersion: 1 as const,
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        corpusKey: "transcripts" as const,
        providerKind: "transcript" as const,
        connectorScopeKey,
        connectionKey: input.connectionKey,
        connectionGeneration: input.connectionGeneration,
        allowlistGeneration,
        requiredScopeIntentKey,
        intentGeneration: (required?.intentGeneration ?? 0) + 1,
        controllingConfigurationDigest,
        state: "required" as const,
        decommissionGeneration: null,
        activatedAt: input.now,
        decommissionedAt: null,
        updatedAt: input.now,
      };
      if (required === undefined)
        yield* writer
          .table("brainRequiredScopeIntents")
          .insert(row)
          .pipe(Effect.orDie);
      else
        yield* writer
          .table("brainRequiredScopeIntents")
          .patch(required._id, row)
          .pipe(Effect.orDie);
    }

    const childIngestionObligationKey = stableKey("iobl", {
      authorityKind: "live_capture",
      parentIngestionObligationKey: parent.ingestionObligationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      resolutionGeneration: parent.resolutionGeneration,
    });
    const jobKey = yield* enqueueRetrievalPublicationJobEffect(
      {
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        originKind: "transcript",
        sourceKey: input.unitKey,
        sourceRevisionKey: input.unitRevisionKey,
        ingestionObligationKey: childIngestionObligationKey,
        providerTargetResolutionIntentId: parent._id,
        providerTargetResolutionGeneration: parent.resolutionGeneration,
        requestGeneration: input.routeGeneration,
      },
      input.now,
    );
    const jobs = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_job_key", (query) => query.eq("jobKey", jobKey))
      .take(2)
      .pipe(Effect.orDie);
    const job = jobs[0];
    if (
      jobs.length !== 1 ||
      job === undefined ||
      job.authorityDigest === undefined ||
      job.ingestionObligationKey !== childIngestionObligationKey ||
      job.providerTargetResolutionIntentId !== parent._id
    )
      return yield* Effect.dieMessage(
        "Transcript live publication child authority is missing.",
      );
    const obligations = yield* reader
      .table("ingestionObligations")
      .index("by_ingestion_obligation_key", (query) =>
        query.eq("ingestionObligationKey", childIngestionObligationKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const child = obligations[0];
    if (obligations.length > 1)
      return yield* Effect.dieMessage(
        "Transcript live ingestion child authority is ambiguous.",
      );
    if (child === undefined)
      yield* writer
        .table("ingestionObligations")
        .insert({
          schemaVersion: 1,
          authorityKind: "live_capture",
          parentIngestionObligationKey: parent.ingestionObligationKey,
          organizationKey: input.organizationKey,
          workspaceId: input.workspaceId,
          brainKey: input.brainKey,
          corpusKey: "transcripts",
          providerKind: "transcript",
          connectorScopeKey,
          connectionKey: input.connectionKey,
          connectionGeneration: input.connectionGeneration,
          allowlistGeneration,
          ingestionObligationKey: childIngestionObligationKey,
          requiredScopeIntentKey,
          cause: "observation",
          membershipKey: parent.membershipKey,
          originKind: "transcript",
          originKey: input.unitKey,
          originRevisionKey: input.unitRevisionKey,
          ledgerSequence: parent.capturedAt,
          state: "publication_pending",
          targetResolutionIntentId: parent._id,
          targetResolutionIntentKey: parent.targetResolutionIntentKey,
          publicationJobKeys: [jobKey],
          errorTag: null,
          terminalAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
    else if (
      child.authorityKind !== "live_capture" ||
      child.parentIngestionObligationKey !== parent.ingestionObligationKey ||
      child.workspaceId !== input.workspaceId ||
      child.brainKey !== input.brainKey ||
      child.requiredScopeIntentKey !== requiredScopeIntentKey ||
      child.publicationJobKeys.length !== 1 ||
      child.publicationJobKeys[0] !== jobKey
    )
      return yield* Effect.dieMessage(
        "Transcript live ingestion child authority conflicts.",
      );

    const target = {
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      jobKey,
      authorityDigest: job.authorityDigest,
      childIngestionObligationKey,
    } satisfies ProviderTargetResolutionTarget;
    const targetDigest = providerTargetResolutionPopulationDigest([target]);
    if (parent.status === "succeeded") {
      if (
        parent.targetCount !== 1 ||
        parent.targetDigest !== targetDigest ||
        parent.targets.length !== 1 ||
        JSON.stringify(parent.targets[0]) !== JSON.stringify(target)
      )
        return yield* Effect.dieMessage(
          "Transcript live target population conflicts.",
        );
    } else {
      if (parent.status === "policy_excluded" || parent.status === "stale")
        return yield* Effect.dieMessage(
          "A terminal transcript parent cannot gain a Brain child.",
        );
      yield* writer
        .table("providerTargetResolutionIntents")
        .patch(parent._id, {
          status: "succeeded",
          attemptCount: parent.attemptCount + 1,
          nextAttemptAt: input.now,
          lastErrorTag: null,
          targetCount: 1,
          targetDigest,
          targets: [target],
          completedAt: input.now,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
    }
    yield* progressLiveCaptureParentEffect({
      targetResolutionIntentId: parent._id,
      now: input.now,
    });
    return jobKey;
  });
