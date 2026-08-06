import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader } from "../_generated/services";
import { buildStandardClientBriefPages } from "../brain/clientBrief";
import { NotFound, Unauthorized } from "../errors";
import gatherMaintenanceContextGroup, {
  MaintenanceContextUnavailable,
} from "./gatherMaintenanceContext.spec";

const unavailable = (
  reason: ConstructorParameters<
    typeof MaintenanceContextUnavailable
  >[0]["reason"],
) => new MaintenanceContextUnavailable({ reason });

const gatherMaintenanceContextImpl = FunctionImpl.make(
  databaseSchema,
  gatherMaintenanceContextGroup,
  "gatherMaintenanceContext",
  ({ workspaceId, unitRevisionKey, caller }) =>
    Effect.gen(function* () {
      if (
        caller.kind !== "system" ||
        (caller.surface !== "workflow" && caller.surface !== "internal")
      )
        return yield* new Unauthorized();

      const reader = yield* DatabaseReader;
      const workspace = yield* reader
        .table("workspaces")
        .get(workspaceId as GenericId<"workspaces">)
        .pipe(Effect.orDie);
      if (!workspace)
        return yield* new NotFound({ resource: "workspaces", id: workspaceId });
      if (
        workspace.status !== "active" ||
        workspace.kind !== "client" ||
        !workspace.brainKey
      )
        return yield* unavailable("foreign_workspace");
      const organization = yield* reader
        .table("organizations")
        .get(workspace.organizationId as GenericId<"organizations">)
        .pipe(Effect.orDie);
      if (!organization?.agencyKey || organization.status !== "active")
        return yield* unavailable("foreign_workspace");

      const organizationKey = organization.agencyKey;
      const revision = yield* reader
        .table("sourceUnitRevisions")
        .index("by_unit_revision_key", (query) =>
          query
            .eq("organizationKey", organizationKey)
            .eq("unitRevisionKey", unitRevisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (!revision)
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
        !unit ||
        unit.currentUnitRevisionKey !== unitRevisionKey ||
        revision.tombstone
      )
        return yield* unavailable("stale_route");
      if (unit.lifecycle.state !== "active")
        return yield* unavailable("revoked_source");

      const route = yield* reader
        .table("callRoutingProposals")
        .index("by_org_revision", (query) =>
          query
            .eq("organizationKey", organizationKey)
            .eq("unitRevisionKey", unitRevisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        !route ||
        (route.status !== "current" && route.status !== "accepted") ||
        route.outcome !== "routed" ||
        route.sourceLifecycleGeneration !== unit.lifecycle.generation
      )
        return yield* unavailable("stale_route");
      if (route.brainKey !== workspace.brainKey)
        return yield* unavailable("foreign_workspace");

      const jobs = yield* reader
        .table("sourceProcessingJobs")
        .index("by_org_unit_stage", (query) =>
          query
            .eq("organizationKey", organizationKey)
            .eq("unitKey", unit.unitKey),
        )
        .collect()
        .pipe(Effect.orDie);
      const job = jobs.find(
        (candidate) =>
          candidate.lifecycleGeneration === unit.lifecycle.generation &&
          candidate.routeGeneration === route.routeGeneration &&
          candidate.stage === "routed",
      );
      if (!job) return yield* unavailable("stale_route");

      const segments = yield* reader
        .table("sourceSegments")
        .index("by_unit_revision_ordinal", (query) =>
          query
            .eq("organizationKey", organizationKey)
            .eq("unitRevisionKey", unitRevisionKey),
        )
        .collect()
        .pipe(Effect.orDie);
      const citations = segments
        .filter(({ text }) => text.trim().length > 0)
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((segment) => ({
          citationKey: `cite_${segment.segmentKey}`,
          sourceUnitKey: unit.unitKey,
          revisionKey: unitRevisionKey,
          segmentKey: segment.segmentKey,
          evidenceKind: segment.evidenceKind,
          speakerLabel: segment.speakerLabel,
          startMs: segment.startMs,
          endMs: segment.endMs,
          quote: segment.text,
        }));
      if (citations.length === 0)
        return yield* unavailable("no_readable_citations");

      const expectedPages = buildStandardClientBriefPages(workspace.brainKey);
      const pages = yield* reader
        .table("brainPages")
        .index("by_workspace_status", (query) =>
          query.eq("workspaceId", workspaceId).eq("status", "active"),
        )
        .collect()
        .pipe(Effect.orDie);
      const pagesByKey = new Map(pages.map((page) => [page.pageKey, page]));
      const gatheredPages = [];
      for (const expected of expectedPages) {
        const page = pagesByKey.get(expected.pageKey);
        if (!page?.currentRevisionKey || page.lifecycle?.state !== "active")
          return yield* unavailable("missing_current_page");
        const current = yield* reader
          .table("pageRevisions")
          .index("by_workspace_revision_key", (query) =>
            query
              .eq("workspaceId", workspaceId)
              .eq("revisionKey", page.currentRevisionKey!),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie);
        if (
          !current ||
          current.pageKey !== page.pageKey ||
          current.state !== "published" ||
          current.lifecycle.state !== "active"
        )
          return yield* unavailable("missing_current_page");
        gatheredPages.push({
          pageKey: page.pageKey,
          title: page.title,
          currentRevisionKey: current.revisionKey,
          lifecycleGeneration: page.lifecycle.generation,
          markdown: current.markdown,
        });
      }

      return {
        workspaceId,
        organizationId: workspace.organizationId,
        organizationKey,
        brainKey: workspace.brainKey,
        unitKey: unit.unitKey,
        unitRevisionKey,
        sourceLifecycleGeneration: unit.lifecycle.generation,
        routeGeneration: route.routeGeneration,
        policyGeneration: job.policyGeneration,
        workspaceLifecycleGeneration: workspace.lifecycleGeneration ?? 1,
        source: {
          title: revision.title,
          startedAt: revision.startedAt,
          sourceUrl: revision.sourceUrl,
        },
        pages: gatheredPages,
        citations,
      };
    }),
);

export default GroupImpl.make(
  databaseSchema,
  gatherMaintenanceContextGroup,
).pipe(Layer.provide(gatherMaintenanceContextImpl), GroupImpl.finalize);
