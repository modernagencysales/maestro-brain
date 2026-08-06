import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { commitMaintenanceProposal } from "../maintenance/commit";
import {
  assertPromptInjectionFree,
  MaintenancePolicyError,
} from "../maintenance/policy";
import { requestMaintenanceProposal } from "../maintenance/request";
import { Unauthorized, ValidationFailed } from "../errors";
import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { sha256Hex } from "../shared/sha256";
import type { MaintainBrainPageInput } from "./maintainBrainPage.domain";
import { GatherMaintenanceContext } from "./gatherMaintenanceContext.spec";
import { decodeMinedCall } from "./mineCallTranscript.domain";
import { mineCallTranscriptReturns } from "./mineCallTranscript.spec";
import {
  AutopilotNotEligible,
  CitationNotInManifest,
  CitationRequired,
  LifecycleRevoked,
  RevisionBudgetExceeded,
  StaleRevision,
} from "./maintainBrainPage.spec";
import maintainBrainPageGroup from "./maintainBrainPage.spec";

export const mapMaintenancePolicyError = (error: unknown) => {
  if (!(error instanceof MaintenancePolicyError)) return null;

  switch (error.name) {
    case "CitationRequired":
      return new CitationRequired();
    case "CitationNotInManifest":
      return new CitationNotInManifest({ citationKey: error.message });
    case "RevisionBudgetExceeded":
      return new RevisionBudgetExceeded({ limit: 0 });
    case "AutopilotNotEligible":
      return new AutopilotNotEligible({ reason: error.message });
    case "StaleRevision":
      return new StaleRevision({ proposalKey: error.message });
    case "LifecycleRevoked":
      return new LifecycleRevoked({ lifecycleGeneration: 0 });
  }
};

export const maintainBrainPageFromContextPack = (
  input: MaintainBrainPageInput,
) => {
  const proposal = requestMaintenanceProposal({
    context: input.context,
    modelOutput: input.modelOutput,
  });
  const committed = commitMaintenanceProposal({
    context: input.context,
    proposal,
    ...(input.autopilot ? { autopilot: input.autopilot } : {}),
  });
  return {
    proposalKey: committed.proposalKey,
    status: committed.status,
    citationKeys: proposal.citationKeys,
    revisionEffect:
      committed.revisionEffect === null
        ? null
        : {
            pageKey: committed.revisionEffect.pageKey,
            expectedRevisionKey: committed.revisionEffect.expectedRevisionKey,
            markdown: committed.revisionEffect.markdown,
            citationKeys: [...committed.revisionEffect.citationKeys],
          },
  };
};

const groupedInput = (input: {
  readonly context: unknown;
  readonly modelOutput: unknown;
}) => {
  if (
    !input.modelOutput ||
    typeof input.modelOutput !== "object" ||
    !("output" in input.modelOutput) ||
    !("receipt" in input.modelOutput)
  )
    return null;
  return {
    context: Schema.decodeUnknownSync(GatherMaintenanceContext)(input.context),
    mined: Schema.decodeUnknownSync(mineCallTranscriptReturns)(
      input.modelOutput,
    ),
  };
};

export const requireGroupedMaintenanceCaller = (
  caller:
    | {
        readonly kind: string;
        readonly name?: string;
        readonly surface: string;
      }
    | undefined,
) =>
  caller?.kind === "system" &&
  (caller.surface === "workflow" || caller.surface === "internal");

const validationFailed = (message: string) =>
  new ValidationFailed({ field: "maintenance", message });

const persistGroupedCallMaintenance = (input: {
  readonly contextPackId: string;
  readonly context: GatherMaintenanceContext;
  readonly mined: typeof mineCallTranscriptReturns.Type;
}) =>
  Effect.gen(function* () {
    const { context, mined } = input;
    if (
      input.contextPackId !== mined.receipt.attemptKey ||
      mined.receipt.organizationId !== context.organizationId ||
      mined.receipt.workspaceSlug !== context.workspaceId ||
      mined.receipt.policyGeneration !== context.policyGeneration ||
      mined.receipt.lifecycleGeneration !== context.sourceLifecycleGeneration
    )
      return yield* validationFailed("Model receipt authority is stale.");
    const createdAt = Date.parse(mined.receipt.generatedAt);
    if (!Number.isFinite(createdAt))
      return yield* validationFailed("Model receipt timestamp is invalid.");

    const output = yield* Effect.try({
      try: () =>
        decodeMinedCall(mined.output, {
          brainKey: context.brainKey,
          pageKeys: context.pages.map(({ pageKey }) => pageKey),
          citations: context.citations,
        }),
      catch: (error) =>
        validationFailed(
          error instanceof Error ? error.message : "Mined output is invalid.",
        ),
    });
    if (output.pageProposals.length > context.pages.length)
      return yield* new RevisionBudgetExceeded({ limit: context.pages.length });
    yield* Effect.try({
      try: () => {
        for (const proposal of output.pageProposals) {
          assertPromptInjectionFree(proposal.title);
          assertPromptInjectionFree(proposal.markdown);
        }
      },
      catch: (error) =>
        mapMaintenancePolicyError(error) ??
        validationFailed("Mined page content is invalid."),
    });
    const citationByKey = new Map(
      context.citations.map((citation) => [citation.citationKey, citation]),
    );
    for (const commitment of output.commitments)
      if (
        (commitment.owner || commitment.dueDate) &&
        !commitment.citationKeys.some(
          (key) =>
            citationByKey.get(key)?.evidenceKind === "verbatim_transcript",
        )
      )
        return yield* validationFailed(
          "Owner and due-date claims require verbatim transcript evidence.",
        );

    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const workspace = yield* reader
      .table("workspaces")
      .get(context.workspaceId as GenericId<"workspaces">)
      .pipe(Effect.orDie);
    if (
      !workspace ||
      workspace.status !== "active" ||
      workspace.organizationId !== context.organizationId ||
      workspace.brainKey !== context.brainKey ||
      (workspace.lifecycleGeneration ?? 1) !==
        context.workspaceLifecycleGeneration
    )
      return yield* new LifecycleRevoked({
        lifecycleGeneration: context.workspaceLifecycleGeneration,
      });
    const unit = yield* reader
      .table("sourceUnits")
      .index("by_unit_key", (query) =>
        query
          .eq("organizationKey", context.organizationKey)
          .eq("unitKey", context.unitKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    const route = yield* reader
      .table("callRoutingProposals")
      .index("by_org_revision", (query) =>
        query
          .eq("organizationKey", context.organizationKey)
          .eq("unitRevisionKey", context.unitRevisionKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (
      !unit ||
      unit.currentUnitRevisionKey !== context.unitRevisionKey ||
      unit.lifecycle.state !== "active" ||
      unit.lifecycle.generation !== context.sourceLifecycleGeneration
    )
      return yield* new LifecycleRevoked({
        lifecycleGeneration: context.sourceLifecycleGeneration,
      });
    if (
      !route ||
      route.status !== "current" ||
      route.outcome !== "routed" ||
      route.brainKey !== context.brainKey ||
      route.routeGeneration !== context.routeGeneration
    )
      return yield* new StaleRevision({ proposalKey: context.unitRevisionKey });

    const pageByKey = new Map(
      context.pages.map((page) => [page.pageKey, page]),
    );
    for (const proposal of output.pageProposals) {
      const expected = pageByKey.get(proposal.pageKey);
      const page = yield* reader
        .table("brainPages")
        .index("by_workspace_page_key", (query) =>
          query
            .eq("workspaceId", context.workspaceId)
            .eq("pageKey", proposal.pageKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        !expected ||
        !page ||
        page.currentRevisionKey !== expected.currentRevisionKey ||
        page.lifecycle?.state !== "active" ||
        page.lifecycle.generation !== expected.lifecycleGeneration
      )
        return yield* new StaleRevision({ proposalKey: proposal.pageKey });
      for (const citationKey of proposal.citationKeys) {
        const citation = citationByKey.get(citationKey);
        if (!citation || citation.revisionKey !== context.unitRevisionKey)
          return yield* new CitationNotInManifest({ citationKey });
      }
    }

    const existingReceipt = yield* reader
      .table("modelCallReceipts")
      .index("by_workspace_attempt", (query) =>
        query
          .eq("workspaceId", context.workspaceId)
          .eq("attemptKey", mined.receipt.attemptKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    const proposalKey = `brainmaint_${sha256Hex(
      JSON.stringify({
        workspaceId: context.workspaceId,
        unitRevisionKey: context.unitRevisionKey,
        routeGeneration: context.routeGeneration,
        responseHash: mined.receipt.responseHash,
      }),
    )}`;
    if (existingReceipt) {
      const existing = yield* reader
        .table("brainMaintenanceProposals")
        .index("by_workspace_proposal", (query) =>
          query
            .eq("workspaceId", context.workspaceId)
            .eq("proposalKey", proposalKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (!existing)
        return yield* validationFailed("Model attempt is already consumed.");
      if (existing.status === "gathering")
        return yield* validationFailed("Maintenance proposal is incomplete.");
      return {
        proposalKey,
        status: existing.status,
        citationKeys: existing.citationKeys,
        revisionEffect: null,
      };
    }

    yield* writer
      .table("modelCallReceipts")
      .insert({
        organizationId: mined.receipt.organizationId,
        workspaceId: context.workspaceId,
        attemptKey: mined.receipt.attemptKey,
        provider: mined.receipt.provider,
        model: mined.receipt.model,
        region: mined.receipt.region,
        state: mined.receipt.state,
        trustedInstructionVersion: mined.receipt.trustedInstructionVersion,
        toolSchemaVersion: mined.receipt.toolSchemaVersion,
        schemaGeneration: mined.receipt.schemaGeneration,
        policyGeneration: mined.receipt.policyGeneration,
        lifecycleGeneration: mined.receipt.lifecycleGeneration,
        redactionState: mined.receipt.redactionState,
        requestHash: mined.receipt.requestHash,
        responseHash: mined.receipt.responseHash,
        sourceHash: mined.receipt.sourceHash,
        inputTokens: mined.receipt.usage.inputTokens,
        outputTokens: mined.receipt.usage.outputTokens,
        costCents: mined.receipt.usage.costCents,
        latencyMs: mined.receipt.latencyMs,
        createdAt,
      })
      .pipe(Effect.orDie);

    const citationKeys = [
      ...new Set([
        ...output.summaryCitationKeys,
        ...output.decisions.flatMap((fact) => fact.citationKeys),
        ...output.commitments.flatMap((fact) => fact.citationKeys),
        ...output.risks.flatMap((fact) => fact.citationKeys),
        ...output.stakeholderChanges.flatMap((fact) => fact.citationKeys),
        ...output.pageProposals.flatMap((proposal) => proposal.citationKeys),
      ]),
    ].sort();
    const first = output.pageProposals[0];
    const status =
      output.pageProposals.length === 0
        ? ("proposed_noop" as const)
        : ("awaiting_review" as const);
    yield* writer
      .table("brainMaintenanceProposals")
      .insert({
        workspaceId: context.workspaceId,
        brainKey: context.brainKey,
        proposalKey,
        status,
        routeGeneration: context.routeGeneration,
        lifecycleGeneration: context.sourceLifecycleGeneration,
        policyGeneration: context.policyGeneration,
        modelPromptPair: `${mined.receipt.model}@${mined.receipt.trustedInstructionVersion}`,
        citationKeys,
        unitKey: context.unitKey,
        unitRevisionKey: context.unitRevisionKey,
        workspaceLifecycleGeneration: context.workspaceLifecycleGeneration,
        modelReceiptKey: mined.receipt.attemptKey,
        summary: output.summary,
        itemCount: output.pageProposals.length,
        ...(first
          ? {
              pageKey: first.pageKey,
              expectedRevisionKey: pageByKey.get(first.pageKey)!
                .currentRevisionKey,
            }
          : {}),
        idempotencyKey: input.contextPackId,
        createdAt,
        updatedAt: createdAt,
      })
      .pipe(Effect.orDie);
    for (const proposal of output.pageProposals) {
      const page = pageByKey.get(proposal.pageKey)!;
      yield* writer
        .table("brainMaintenanceProposalItems")
        .insert({
          workspaceId: context.workspaceId,
          brainKey: context.brainKey,
          proposalKey,
          itemKey: `brainmaintitem_${sha256Hex(
            JSON.stringify({ proposalKey, pageKey: proposal.pageKey }),
          )}`,
          pageKey: proposal.pageKey,
          expectedRevisionKey: page.currentRevisionKey,
          pageLifecycleGeneration: page.lifecycleGeneration,
          title: proposal.title,
          markdown: proposal.markdown,
          citationKeys: proposal.citationKeys,
          status: "awaiting_review",
          createdAt,
          updatedAt: createdAt,
        })
        .pipe(Effect.orDie);
    }
    return {
      proposalKey,
      status,
      citationKeys,
      revisionEffect: null,
    };
  });

const maintainBrainPageImpl = FunctionImpl.make(
  databaseSchema,
  maintainBrainPageGroup,
  "maintainBrainPage",
  (input) => {
    let grouped;
    try {
      grouped = groupedInput(input);
    } catch (error) {
      return Effect.fail(
        validationFailed(
          error instanceof Error ? error.message : "Maintenance failed.",
        ),
      );
    }
    return grouped
      ? requireGroupedMaintenanceCaller(input.caller)
        ? persistGroupedCallMaintenance({
            contextPackId: input.contextPackId,
            ...grouped,
          }).pipe(
            Effect.catchAll((error) =>
              Effect.fail(mapMaintenancePolicyError(error) ?? error),
            ),
          )
        : Effect.fail(new Unauthorized())
      : Effect.try({
          try: () => maintainBrainPageFromContextPack(input),
          catch: (error) =>
            mapMaintenancePolicyError(error) ??
            validationFailed(
              error instanceof Error ? error.message : "Maintenance failed.",
            ),
        });
  },
);

export default GroupImpl.make(databaseSchema, maintainBrainPageGroup).pipe(
  Layer.provide(maintainBrainPageImpl),
  GroupImpl.finalize,
);
