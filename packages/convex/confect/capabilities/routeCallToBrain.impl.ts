import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import databaseSchema from "../_generated/schema";
import refs from "../_generated/refs";
import {
  DatabaseReader,
  DatabaseWriter,
  Scheduler,
} from "../_generated/services";
import { NotFound, Unauthorized, ValidationFailed } from "../errors";
import { matchCall } from "../routing/callMatching";
import { sha256Hex } from "../shared/sha256";
import { routeOutcomeFromMatch } from "./routeCallToBrain.domain";
import routeCallToBrainGroup, { StaleCallRoute } from "./routeCallToBrain.spec";
import { routeCallToBrainArgs } from "./routeCallToBrain.spec";

export const routeCallToBrainEffect = ({
  organizationKey,
  unitRevisionKey,
  explicitBrainKey,
  recurringMeetingId,
  agencyDomains,
  caller,
  routedAt,
}: Schema.Schema.Type<typeof routeCallToBrainArgs>) =>
  Effect.gen(function* () {
    if (
      caller.kind !== "system" ||
      (caller.surface !== "workflow" && caller.surface !== "internal")
    )
      return yield* new Unauthorized();

    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const revision = yield* reader
      .table("sourceUnitRevisions")
      .index("by_unit_revision_key", (query) =>
        query
          .eq("organizationKey", organizationKey)
          .eq("unitRevisionKey", unitRevisionKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (revision === null)
      return yield* new NotFound({
        resource: "sourceUnitRevisions",
        id: unitRevisionKey,
      });
    const unit = yield* reader
      .table("sourceUnits")
      .index("by_unit_key", (query) =>
        query
          .eq("organizationKey", organizationKey)
          .eq("unitKey", revision.unitKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (
      unit === null ||
      unit.currentUnitRevisionKey !== unitRevisionKey ||
      unit.lifecycle.state !== "active" ||
      revision.tombstone
    )
      return yield* new StaleCallRoute({ unitRevisionKey });

    const organization = yield* reader
      .table("organizations")
      .index("by_agency_key", (query) => query.eq("agencyKey", organizationKey))
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (organization === null || organization.status !== "active")
      return yield* new NotFound({
        resource: "organizations",
        id: organizationKey,
      });
    const workspaces = yield* reader
      .table("workspaces")
      .index("by_organization", (query) =>
        query.eq("organizationId", organization._id),
      )
      .collect()
      .pipe(Effect.orDie);
    const allowedBrainKeys = workspaces
      .flatMap((workspace) =>
        workspace.status === "active" &&
        (workspace.kind === "client" || workspace.kind === "agency") &&
        workspace.brainKey
          ? [workspace.brainKey]
          : [],
      )
      .sort();
    if (explicitBrainKey && !allowedBrainKeys.includes(explicitBrainKey))
      return yield* new ValidationFailed({
        field: "explicitBrainKey",
        message: "Explicit Brain is not active in this organization.",
      });
    const mappings = yield* reader
      .table("callRouteMappings")
      .index("by_org_status", (query) =>
        query.eq("organizationKey", organizationKey).eq("status", "active"),
      )
      .collect()
      .pipe(Effect.orDie);
    const match = matchCall({
      organizationKey,
      allowedBrainKeys,
      ...(explicitBrainKey ? { explicitBrainKey } : {}),
      ...(recurringMeetingId ? { recurringMeetingId } : {}),
      agencyDomains,
      participants: revision.participants,
      mappings,
    });
    const route = routeOutcomeFromMatch(match, allowedBrainKeys);
    const existingRows = yield* reader
      .table("callRoutingProposals")
      .index("by_org_revision", (query) =>
        query
          .eq("organizationKey", organizationKey)
          .eq("unitRevisionKey", unitRevisionKey),
      )
      .take(100)
      .pipe(Effect.orDie);
    const existing = existingRows
      .filter(({ status }) => status === "current" || status === "accepted")
      .sort((left, right) => right.routeGeneration - left.routeGeneration)[0];
    const supersedeExisting =
      existing !== undefined &&
      route.outcome === "routed" &&
      existing.outcome !== "routed";
    if (existing !== undefined && !supersedeExisting) {
      const target = workspaces.find(
        (workspace) =>
          workspace.brainKey === existing.brainKey &&
          workspace.status === "active",
      );
      if (existing.outcome === "routed" && target !== undefined)
        yield* (yield* Scheduler).runAfter(
          Duration.zero,
          refs.internal.brain.retrievalPublication.publishTranscriptRevision,
          {
            organizationKey,
            workspaceId: target._id,
            brainKey: existing.brainKey ?? "",
            sourceRevisionKey: unitRevisionKey,
            caller: {
              kind: "system",
              name: "call-router",
              surface: "internal",
            },
            now: routedAt,
          },
        );
      return {
        outcome: existing.outcome,
        proposalKey: existing.proposalKey,
        unitKey: existing.unitKey,
        unitRevisionKey: existing.unitRevisionKey,
        brainKey: existing.brainKey,
        candidateBrainKeys: existing.candidateBrainKeys,
        reason: existing.reason,
        routeGeneration: existing.routeGeneration,
      };
    }
    if (supersedeExisting)
      yield* writer
        .table("callRoutingProposals")
        .patch(existing._id, { status: "superseded", updatedAt: routedAt })
        .pipe(Effect.orDie);
    const prior = yield* reader
      .table("callRoutingProposals")
      .index("by_org_unit_generation", (query) =>
        query
          .eq("organizationKey", organizationKey)
          .eq("unitKey", unit.unitKey),
      )
      .collect()
      .pipe(Effect.orDie);
    const routeGeneration =
      Math.max(0, ...prior.map(({ routeGeneration }) => routeGeneration)) + 1;
    const proposalKey = `callroute_${sha256Hex(
      JSON.stringify({ organizationKey, unitRevisionKey, routeGeneration }),
    )}`;
    yield* writer
      .table("callRoutingProposals")
      .insert({
        schemaVersion: 1,
        organizationKey,
        proposalKey,
        unitKey: unit.unitKey,
        unitRevisionKey,
        sourceLifecycleGeneration: unit.lifecycle.generation,
        routeGeneration,
        ...route,
        status: "current",
        createdAt: routedAt,
        updatedAt: routedAt,
      })
      .pipe(Effect.orDie);

    const jobs = yield* reader
      .table("sourceProcessingJobs")
      .index("by_org_unit_stage", (query) =>
        query
          .eq("organizationKey", organizationKey)
          .eq("unitKey", unit.unitKey),
      )
      .collect()
      .pipe(Effect.orDie);
    for (const job of jobs.filter(
      (candidate) =>
        candidate.lifecycleGeneration === unit.lifecycle.generation &&
        candidate.routeGeneration === 0,
    ))
      yield* writer
        .table("sourceProcessingJobs")
        .patch(job._id, {
          routeGeneration,
          stage:
            route.outcome === "routed"
              ? "routed"
              : route.outcome === "mixed_client"
                ? "awaiting_classification_review"
                : "awaiting_classification",
          updatedAt: routedAt,
        })
        .pipe(Effect.orDie);

    const target = workspaces.find(
      (workspace) =>
        workspace.brainKey === route.brainKey && workspace.status === "active",
    );
    if (route.outcome === "routed" && target !== undefined)
      yield* (yield* Scheduler).runAfter(
        Duration.zero,
        refs.internal.brain.retrievalPublication.publishTranscriptRevision,
        {
          organizationKey,
          workspaceId: target._id,
          brainKey: route.brainKey ?? "",
          sourceRevisionKey: unitRevisionKey,
          caller: {
            kind: "system",
            name: "call-router",
            surface: "internal",
          },
          now: routedAt,
        },
      );

    return {
      ...route,
      proposalKey,
      unitKey: unit.unitKey,
      unitRevisionKey,
      routeGeneration,
    };
  });

const routeCallToBrainImpl = FunctionImpl.make(
  databaseSchema,
  routeCallToBrainGroup,
  "routeCallToBrain",
  routeCallToBrainEffect,
);

export default GroupImpl.make(databaseSchema, routeCallToBrainGroup).pipe(
  Layer.provide(routeCallToBrainImpl),
  GroupImpl.finalize,
);
