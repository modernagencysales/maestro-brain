import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import refs from "../_generated/refs";
import databaseSchema from "../_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
  Scheduler,
} from "../_generated/services";
import { requireWorkspaceAccess } from "../capabilities/_kit/workspaceAccess";
import { NotFound, ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import callReviewGroup from "./callReview.spec";
import { requireBrainAccess } from "./pages.impl";
import { LifecycleRevoked, PageNotFound, StaleRevision } from "./pageTree";

const unsafeClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;
const invalid = (field: string, message: string) =>
  new ValidationFailed({ field, message });

const loadWorkspaceOrganization = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const workspace = yield* reader
      .table("workspaces")
      .get(workspaceId)
      .pipe(Effect.orDie);
    if (!workspace)
      return yield* new NotFound({ resource: "workspaces", id: workspaceId });
    const organization = yield* reader
      .table("organizations")
      .get(workspace.organizationId as GenericId<"organizations">)
      .pipe(Effect.orDie);
    if (!organization?.agencyKey || organization.status !== "active")
      return yield* new NotFound({
        resource: "organizations",
        id: workspace.organizationId,
      });
    return { workspace, organization, organizationKey: organization.agencyKey };
  });

const listCallRoutingQueue = FunctionImpl.make(
  databaseSchema,
  callReviewGroup,
  "listCallRoutingQueue",
  ({ workspaceId }) =>
    Effect.gen(function* () {
      yield* unsafeClock(requireWorkspaceAccess(workspaceId, "admin"));
      const { organizationKey } = yield* loadWorkspaceOrganization(workspaceId);
      const reader = yield* DatabaseReader;
      const routes = yield* Effect.all(
        (["awaiting_review", "mixed_client", "no_match"] as const).map(
          (outcome) =>
            reader
              .table("callRoutingProposals")
              .index("by_org_outcome_status", (query) =>
                query
                  .eq("organizationKey", organizationKey)
                  .eq("outcome", outcome)
                  .eq("status", "current"),
              )
              .collect()
              .pipe(Effect.orDie),
        ),
      );
      const items = [];
      for (const route of routes.flat()) {
        if (route.outcome === "routed") continue;
        const revision = yield* reader
          .table("sourceUnitRevisions")
          .index("by_unit_revision_key", (query) =>
            query
              .eq("organizationKey", organizationKey)
              .eq("unitRevisionKey", route.unitRevisionKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie);
        if (revision)
          items.push({
            proposalKey: route.proposalKey,
            unitKey: route.unitKey,
            unitRevisionKey: route.unitRevisionKey,
            title: revision.title,
            sourceUrl: revision.sourceUrl,
            outcome: route.outcome,
            brainKey: route.brainKey,
            candidateBrainKeys: route.candidateBrainKeys,
            reason: route.reason,
            routeGeneration: route.routeGeneration,
            sourceLifecycleGeneration: route.sourceLifecycleGeneration,
            createdAt: route.createdAt,
          });
      }
      return {
        workspaceId,
        items: items.sort((left, right) => left.createdAt - right.createdAt),
      };
    }),
);

const reviewCallRoute = FunctionImpl.make(
  databaseSchema,
  callReviewGroup,
  "reviewCallRoute",
  (args) =>
    Effect.gen(function* () {
      const access = yield* unsafeClock(
        requireWorkspaceAccess(args.workspaceId, "admin"),
      );
      const { workspace, organization, organizationKey } =
        yield* loadWorkspaceOrganization(args.workspaceId);
      const reader = yield* DatabaseReader;
      const route = yield* reader
        .table("callRoutingProposals")
        .index("by_proposal_key", (query) =>
          query
            .eq("organizationKey", organizationKey)
            .eq("proposalKey", args.proposalKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (!route)
        return yield* new NotFound({
          resource: "callRoutingProposals",
          id: args.proposalKey,
        });
      if (route.reviewAttemptKey === args.attemptKey)
        return {
          proposalKey: route.proposalKey,
          status:
            route.status === "rejected"
              ? ("rejected" as const)
              : ("accepted" as const),
          outcome:
            route.outcome === "routed"
              ? ("routed" as const)
              : ("no_match" as const),
          brainKey: route.brainKey,
          routeGeneration: route.routeGeneration,
          maintenanceQueued: route.outcome === "routed",
        };
      if (
        route.status !== "current" ||
        route.unitRevisionKey !== args.expectedUnitRevisionKey ||
        route.routeGeneration !== args.expectedRouteGeneration ||
        route.sourceLifecycleGeneration !==
          args.expectedSourceLifecycleGeneration
      )
        return yield* new StaleRevision({
          pageKey: args.proposalKey,
          expectedCurrentRevisionKey: String(args.expectedRouteGeneration),
          actualCurrentRevisionKey: String(route.routeGeneration),
        });
      const unit = yield* reader
        .table("sourceUnits")
        .index("by_unit_key", (query) =>
          query
            .eq("organizationKey", organizationKey)
            .eq("unitKey", route.unitKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        !unit ||
        unit.currentUnitRevisionKey !== route.unitRevisionKey ||
        unit.lifecycle.state !== "active" ||
        unit.lifecycle.generation !== route.sourceLifecycleGeneration
      )
        return yield* new LifecycleRevoked({
          resource: "call",
          key: route.unitRevisionKey,
        });

      const targetBrainKey =
        args.action === "confirm"
          ? (args.targetBrainKey ?? route.brainKey)
          : args.action === "change_brain"
            ? args.targetBrainKey
            : undefined;
      if (
        (args.action === "confirm" || args.action === "change_brain") &&
        !targetBrainKey
      )
        return yield* invalid("targetBrainKey", "Target Brain is required.");
      let targetWorkspaceId: GenericId<"workspaces"> | undefined;
      if (targetBrainKey) {
        const targets = yield* reader
          .table("workspaces")
          .index("by_organization_brain_key", (query) =>
            query
              .eq("organizationId", organization._id)
              .eq("brainKey", targetBrainKey),
          )
          .collect()
          .pipe(Effect.orDie);
        const target = targets.find(
          (candidate) =>
            candidate.status === "active" && candidate.kind === "client",
        );
        if (!target)
          return yield* invalid(
            "targetBrainKey",
            "Target Brain is not active in this organization.",
          );
        targetWorkspaceId = target._id;
      }
      if ((args.learnScope === undefined) !== (args.learnValue === undefined))
        return yield* invalid(
          "learnScope",
          "Learning scope and value must be provided together.",
        );
      if (args.learnScope && !targetBrainKey)
        return yield* invalid(
          "learnScope",
          "A learned mapping requires a routed Brain.",
        );

      const reviewedAt = yield* unsafeClock(Clock.currentTimeMillis);
      const writer = yield* DatabaseWriter;
      let learnedMappingKey: string | undefined;
      if (args.learnScope && args.learnValue && targetBrainKey) {
        const value = args.learnValue.trim().toLowerCase();
        if (!value)
          return yield* invalid("learnValue", "Learning value is required.");
        learnedMappingKey = `route_map_${sha256Hex(
          JSON.stringify({
            organizationKey,
            kind: args.learnScope,
            value,
            brainKey: targetBrainKey,
          }),
        )}`;
        const existing = yield* reader
          .table("callRouteMappings")
          .index("by_org_kind_value", (query) =>
            query
              .eq("organizationKey", organizationKey)
              .eq("kind", args.learnScope!)
              .eq("value", value),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie);
        if (existing)
          yield* writer
            .table("callRouteMappings")
            .patch(existing._id, {
              brainKey: targetBrainKey,
              status: "active",
              learnedFromProposalKey: route.proposalKey,
              updatedAt: reviewedAt,
            })
            .pipe(Effect.orDie);
        else
          yield* writer
            .table("callRouteMappings")
            .insert({
              schemaVersion: 1,
              organizationKey,
              mappingKey: learnedMappingKey,
              kind: args.learnScope,
              value,
              brainKey: targetBrainKey,
              status: "active",
              learnedFromProposalKey: route.proposalKey,
              createdAt: reviewedAt,
              updatedAt: reviewedAt,
            })
            .pipe(Effect.orDie);
      }

      const routed = Boolean(targetBrainKey) && args.action !== "reject";
      const status =
        args.action === "reject"
          ? ("rejected" as const)
          : ("accepted" as const);
      yield* writer
        .table("callRoutingProposals")
        .patch(route._id, {
          outcome: routed ? "routed" : "no_match",
          brainKey: routed ? targetBrainKey! : null,
          candidateBrainKeys: routed
            ? [targetBrainKey!]
            : route.candidateBrainKeys,
          reason: `review_${args.action}`,
          status,
          reviewedBy: String(access.userId),
          reviewAttemptKey: args.attemptKey,
          ...(learnedMappingKey ? { learnedMappingKey } : {}),
          updatedAt: reviewedAt,
        })
        .pipe(Effect.orDie);
      const jobs = yield* reader
        .table("sourceProcessingJobs")
        .index("by_org_unit_stage", (query) =>
          query
            .eq("organizationKey", organizationKey)
            .eq("unitKey", route.unitKey),
        )
        .collect()
        .pipe(Effect.orDie);
      for (const job of jobs.filter(
        (candidate) =>
          candidate.lifecycleGeneration === route.sourceLifecycleGeneration &&
          candidate.routeGeneration === route.routeGeneration,
      ))
        yield* writer
          .table("sourceProcessingJobs")
          .patch(job._id, {
            stage: routed ? "routed" : "classified_no_route",
            updatedAt: reviewedAt,
          })
          .pipe(Effect.orDie);

      if (routed && targetWorkspaceId) {
        const scheduler = yield* Scheduler;
        yield* scheduler.runAfter(
          Duration.zero,
          refs.internal.workflowContracts.sourceToBrainMaintenance.start,
          {
            workspaceId: targetWorkspaceId,
            idempotencyKey: `maintenance.${sha256Hex(
              JSON.stringify({
                proposalKey: route.proposalKey,
                attemptKey: args.attemptKey,
              }),
            )}`,
            unitRevisionKey: route.unitRevisionKey,
            caller: {
              kind: "system",
              name: "callReview",
              surface: "internal",
            },
          },
        );
      }
      return {
        proposalKey: route.proposalKey,
        status,
        outcome: routed ? ("routed" as const) : ("no_match" as const),
        brainKey: routed ? targetBrainKey! : null,
        routeGeneration: route.routeGeneration,
        maintenanceQueued: routed,
      };
    }),
);

const loadSegmentCitation = (
  organizationKey: string,
  unitRevisionKey: string,
  citationKey: string,
) =>
  Effect.gen(function* () {
    const segmentKey = citationKey.startsWith("cite_")
      ? citationKey.slice(5)
      : "";
    const reader = yield* DatabaseReader;
    const segment = yield* reader
      .table("sourceSegments")
      .index("by_segment_key", (query) =>
        query
          .eq("organizationKey", organizationKey)
          .eq("segmentKey", segmentKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (!segment || segment.unitRevisionKey !== unitRevisionKey)
      return yield* invalid("citationKey", "Transcript citation is stale.");
    return { citationKey, segment };
  });

const listCallMaintenanceQueue = FunctionImpl.make(
  databaseSchema,
  callReviewGroup,
  "listCallMaintenanceQueue",
  ({ brainKey }) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(brainKey, "editor");
      const reader = yield* DatabaseReader;
      const proposals = (yield* reader
        .table("brainMaintenanceProposals")
        .index("by_workspace", (query) =>
          query.eq("workspaceId", brain.workspaceId),
        )
        .collect()
        .pipe(Effect.orDie)).filter(
        ({ status }) => status === "awaiting_review",
      );
      const queue = [];
      for (const proposal of proposals) {
        if (!proposal.unitRevisionKey) continue;
        const revision = yield* reader
          .table("sourceUnitRevisions")
          .index("by_unit_revision_key", (query) =>
            query
              .eq("organizationKey", brain.organizationKey)
              .eq("unitRevisionKey", proposal.unitRevisionKey!),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie);
        if (!revision) continue;
        const rows = yield* reader
          .table("brainMaintenanceProposalItems")
          .index("by_workspace_proposal", (query) =>
            query
              .eq("workspaceId", brain.workspaceId)
              .eq("proposalKey", proposal.proposalKey),
          )
          .collect()
          .pipe(Effect.orDie);
        const items = [];
        for (const item of rows.filter(
          ({ status }) => status === "awaiting_review",
        )) {
          const citations = [];
          for (const citationKey of item.citationKeys) {
            const { segment } = yield* loadSegmentCitation(
              brain.organizationKey,
              proposal.unitRevisionKey,
              citationKey,
            );
            citations.push({
              citationKey,
              quote: segment.text,
              speakerLabel: segment.speakerLabel,
              startMs: segment.startMs,
              endMs: segment.endMs,
            });
          }
          items.push({
            itemKey: item.itemKey,
            pageKey: item.pageKey,
            title: item.title,
            expectedRevisionKey: item.expectedRevisionKey,
            markdown: item.markdown,
            citations,
          });
        }
        queue.push({
          proposalKey: proposal.proposalKey,
          unitRevisionKey: proposal.unitRevisionKey,
          sourceTitle: revision.title,
          sourceUrl: revision.sourceUrl,
          summary: proposal.summary ?? "",
          routeGeneration: proposal.routeGeneration,
          sourceLifecycleGeneration: proposal.lifecycleGeneration,
          workspaceLifecycleGeneration:
            proposal.workspaceLifecycleGeneration ?? 1,
          createdAt: proposal.createdAt,
          items,
        });
      }
      return {
        workspaceId: brain.workspaceId,
        brainKey: brain.brainKey,
        items: queue.sort((left, right) => left.createdAt - right.createdAt),
      };
    }),
);

const reviewCallMaintenance = FunctionImpl.make(
  databaseSchema,
  callReviewGroup,
  "reviewCallMaintenance",
  (args) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(args.brainKey, "editor");
      const reader = yield* DatabaseReader;
      const proposal = yield* reader
        .table("brainMaintenanceProposals")
        .index("by_workspace_proposal", (query) =>
          query
            .eq("workspaceId", brain.workspaceId)
            .eq("proposalKey", args.proposalKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (!proposal)
        return yield* new NotFound({
          resource: "brainMaintenanceProposals",
          id: args.proposalKey,
        });
      const items = yield* reader
        .table("brainMaintenanceProposalItems")
        .index("by_workspace_proposal", (query) =>
          query
            .eq("workspaceId", brain.workspaceId)
            .eq("proposalKey", proposal.proposalKey),
        )
        .collect()
        .pipe(Effect.orDie);
      if (proposal.reviewAttemptKey === args.attemptKey)
        return {
          proposalKey: proposal.proposalKey,
          status:
            proposal.status === "rejected"
              ? ("rejected" as const)
              : proposal.status === "edited_and_published"
                ? ("edited_and_published" as const)
                : ("published" as const),
          publishedItemCount: items.filter(
            ({ status }) =>
              status === "published" || status === "edited_and_published",
          ).length,
        };
      if (
        proposal.status !== "awaiting_review" ||
        proposal.routeGeneration !== args.expectedRouteGeneration ||
        proposal.lifecycleGeneration !==
          args.expectedSourceLifecycleGeneration ||
        (proposal.workspaceLifecycleGeneration ?? 1) !==
          args.expectedWorkspaceLifecycleGeneration ||
        !proposal.unitKey ||
        !proposal.unitRevisionKey
      )
        return yield* new StaleRevision({
          pageKey: proposal.pageKey ?? proposal.proposalKey,
          expectedCurrentRevisionKey: String(args.expectedRouteGeneration),
          actualCurrentRevisionKey: String(proposal.routeGeneration),
        });
      const workspace = yield* reader
        .table("workspaces")
        .get(brain.workspaceId)
        .pipe(Effect.orDie);
      if (
        !workspace ||
        workspace.status !== "active" ||
        (workspace.lifecycleGeneration ?? 1) !==
          args.expectedWorkspaceLifecycleGeneration
      )
        return yield* new LifecycleRevoked({
          resource: "brain",
          key: args.brainKey,
        });
      const unit = yield* reader
        .table("sourceUnits")
        .index("by_unit_key", (query) =>
          query
            .eq("organizationKey", brain.organizationKey)
            .eq("unitKey", proposal.unitKey!),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const route = yield* reader
        .table("callRoutingProposals")
        .index("by_org_revision", (query) =>
          query
            .eq("organizationKey", brain.organizationKey)
            .eq("unitRevisionKey", proposal.unitRevisionKey!),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        !unit ||
        unit.currentUnitRevisionKey !== proposal.unitRevisionKey ||
        unit.lifecycle.state !== "active" ||
        unit.lifecycle.generation !== proposal.lifecycleGeneration
      )
        return yield* new LifecycleRevoked({
          resource: "call",
          key: proposal.unitRevisionKey,
        });
      if (
        !route ||
        route.outcome !== "routed" ||
        (route.status !== "current" && route.status !== "accepted") ||
        route.brainKey !== brain.brainKey ||
        route.routeGeneration !== proposal.routeGeneration
      )
        return yield* new StaleRevision({
          pageKey: proposal.proposalKey,
          expectedCurrentRevisionKey: String(proposal.routeGeneration),
          actualCurrentRevisionKey: String(route?.routeGeneration ?? 0),
        });
      const reviewedAt = yield* unsafeClock(Clock.currentTimeMillis);
      const writer = yield* DatabaseWriter;
      if (args.action === "reject") {
        for (const item of items)
          yield* writer
            .table("brainMaintenanceProposalItems")
            .patch(item._id, { status: "rejected", updatedAt: reviewedAt })
            .pipe(Effect.orDie);
        yield* writer
          .table("brainMaintenanceProposals")
          .patch(proposal._id, {
            status: "rejected",
            reviewerId: brain.actorId,
            reviewAttemptKey: args.attemptKey,
            updatedAt: reviewedAt,
          })
          .pipe(Effect.orDie);
        return {
          proposalKey: proposal.proposalKey,
          status: "rejected" as const,
          publishedItemCount: 0,
        };
      }
      const edits = new Map(
        args.edits.map((edit) => [edit.itemKey, edit.markdown]),
      );
      if (args.action === "edit" && edits.size === 0)
        return yield* invalid("edits", "Edited acceptance requires an edit.");
      if (
        [...edits.keys()].some(
          (key) => !items.some((item) => item.itemKey === key),
        )
      )
        return yield* invalid(
          "edits",
          "Edit targets an unknown proposal item.",
        );

      const prepared = [];
      for (const item of items) {
        const page = yield* reader
          .table("brainPages")
          .index("by_workspace_page_key", (query) =>
            query
              .eq("workspaceId", brain.workspaceId)
              .eq("pageKey", item.pageKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie);
        if (
          !page ||
          page.currentRevisionKey !== item.expectedRevisionKey ||
          page.lifecycle?.state !== "active" ||
          page.lifecycle.generation !== item.pageLifecycleGeneration
        )
          return yield* new PageNotFound({ pageKey: item.pageKey });
        const markdown = edits.get(item.itemKey) ?? item.markdown;
        if (!markdown.trim())
          return yield* invalid("markdown", "Published markdown is required.");
        const citations = [];
        for (const citationKey of item.citationKeys)
          citations.push(
            yield* loadSegmentCitation(
              brain.organizationKey,
              proposal.unitRevisionKey,
              citationKey,
            ),
          );
        const revisionKey = `rev_${sha256Hex(
          JSON.stringify({
            proposalKey: proposal.proposalKey,
            itemKey: item.itemKey,
            attemptKey: args.attemptKey,
            markdown,
          }),
        ).slice(0, 32)}`;
        prepared.push({ item, page, markdown, citations, revisionKey });
      }

      for (const entry of prepared) {
        const lifecycle = {
          state: "active" as const,
          generation: entry.page.lifecycle!.generation + 1,
          updatedAt: reviewedAt,
          purgeAfter: null,
        };
        yield* writer
          .table("pageRevisions")
          .insert({
            workspaceId: brain.workspaceId,
            organizationId: brain.organizationId,
            pageKey: entry.item.pageKey,
            revisionKey: entry.revisionKey,
            priorRevisionKey: entry.item.expectedRevisionKey,
            blockNoteJson: "",
            markdown: entry.markdown,
            contentHash: sha256Hex(entry.markdown),
            causation: "agent-edit",
            actor: { kind: "user", id: brain.actorId },
            modelReceiptKey: proposal.modelReceiptKey ?? null,
            effectKey: `brain.callReview:${proposal.proposalKey}:${entry.item.itemKey}:${args.attemptKey}`,
            state: "published",
            lifecycle,
            createdAt: reviewedAt,
            schemaVersion: 1,
          })
          .pipe(Effect.orDie);
        yield* writer
          .table("brainPages")
          .patch(entry.page._id, {
            markdown: entry.markdown,
            currentRevisionKey: entry.revisionKey,
            updatedAt: reviewedAt,
            lifecycle,
          })
          .pipe(Effect.orDie);
        for (const { citationKey, segment } of entry.citations)
          yield* writer
            .table("citations")
            .insert({
              workspaceId: String(brain.workspaceId),
              citationId: `citation:${proposal.proposalKey}:${entry.item.itemKey}:${citationKey}`,
              claimId: `page:${entry.item.pageKey}:${entry.revisionKey}`,
              sourceId: proposal.unitKey,
              sourceKind: "call_transcript",
              sourceTitle: entry.item.title,
              quotedText: segment.text,
              startOffset: 0,
              endOffset: segment.text.length,
              pageKey: entry.item.pageKey,
              revisionKey: entry.revisionKey,
              sourceUnitRevisionKey: proposal.unitRevisionKey,
              segmentKey: segment.segmentKey,
              ...(segment.startMs === null ? {} : { startMs: segment.startMs }),
              ...(segment.endMs === null ? {} : { endMs: segment.endMs }),
              createdAt: reviewedAt,
            })
            .pipe(Effect.orDie);
        yield* writer
          .table("brainMaintenanceProposalItems")
          .patch(entry.item._id, {
            status:
              args.action === "edit" ? "edited_and_published" : "published",
            markdown: entry.markdown,
            updatedAt: reviewedAt,
          })
          .pipe(Effect.orDie);
      }
      const status =
        args.action === "edit"
          ? ("edited_and_published" as const)
          : ("published" as const);
      yield* writer
        .table("brainMaintenanceProposals")
        .patch(proposal._id, {
          status,
          reviewerId: brain.actorId,
          reviewAttemptKey: args.attemptKey,
          updatedAt: reviewedAt,
        })
        .pipe(Effect.orDie);
      return {
        proposalKey: proposal.proposalKey,
        status,
        publishedItemCount: prepared.length,
      };
    }),
);

export default GroupImpl.make(databaseSchema, callReviewGroup).pipe(
  Layer.provide(listCallRoutingQueue),
  Layer.provide(reviewCallRoute),
  Layer.provide(listCallMaintenanceQueue),
  Layer.provide(reviewCallMaintenance),
  GroupImpl.finalize,
);
