import type { GenericId } from "convex/values";
import { FunctionImpl, GroupImpl } from "@confect/server";
import {
  canonicalContentRootHash,
  canonicalOutputSchemaHash,
  createStructuredLlmGateway,
  hashModelPayload,
} from "@maestro-template/integrations";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import databaseSchema from "../_generated/schema";
import {
  ModelReceiptDuplicate,
  ModelReceiptTenantMismatch,
  writeAuthenticatedModelCallReceipt,
} from "../modelReceipts/repository";
import { ValidationFailed } from "../errors";
import { requireWorkspaceAccess } from "./_kit/workspaceAccess";
import { normalizeSourceGroundedBriefInput } from "./sourceGroundedBrief.domain";
import type { SourceGroundedBriefInput } from "./sourceGroundedBrief.domain";
import sourceGroundedBrief from "./sourceGroundedBrief.spec";

const SourceGroundedBriefModelOutput = Schema.Struct({
  briefMarkdown: Schema.String,
  sourceTitles: Schema.Array(Schema.String),
  trustClaim: Schema.String,
});

const fakeGatewayNow = "2026-07-14T00:00:00.000Z";

const unsafeAssumeClockProvided = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Clock.Clock>> =>
  // Confect provides Clock at runtime, but its current handler type omits it.
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const runSourceGroundedBrief = (input: SourceGroundedBriefInput) =>
  Effect.gen(function* () {
    yield* unsafeAssumeClockProvided(
      requireWorkspaceAccess(
        input.workspaceId as GenericId<"workspaces">,
        "editor",
      ),
    );

    const normalized = normalizeSourceGroundedBriefInput(input);
    if (normalized instanceof Error) {
      return yield* normalized;
    }

    const sources = normalized.sourceIds.map((sourceId) => ({
      id: sourceId,
      title: `Source ${sourceId}`,
      markdown: "Synthetic source content for fake-mode capability run.",
    }));
    const contentArtifacts = sources.map((source) => {
      const bytes = `${source.id}\n${source.title}\n${source.markdown}`;
      return {
        hash: hashModelPayload(bytes),
        mediaType: "text/markdown" as const,
        bytes,
        tokens: Math.max(1, Math.ceil(bytes.length / 4)),
      };
    });
    const sourceHash = yield* Effect.promise(() =>
      canonicalContentRootHash(
        contentArtifacts.map((artifact) => artifact.hash),
      ),
    );
    const outputSchemaHash = canonicalOutputSchemaHash(
      SourceGroundedBriefModelOutput,
    );
    const sourceTitles = sources.map((source) => source.title);
    const briefMarkdown = `## Source-Grounded Brief\n\nGoal: ${normalized.briefGoal}\n\n### Sources\n\n${sourceTitles.map((title) => `- ${title}`).join("\n")}\n\n### Draft\n\nThis deterministic fake brief is grounded in ${sources.length} approved source${sources.length === 1 ? "" : "s"}. Replace the fake LLM service before live use.`;
    const gateway = createStructuredLlmGateway({
      mode: "fake",
      env: {},
      now: () => fakeGatewayNow,
      fakeStructuredOutput: {
        briefMarkdown,
        sourceTitles,
        trustClaim: "source-backed-no-default-rag",
      },
    });
    const modelResult = yield* gateway
      .generate({
        organizationId: "derived-by-repository",
        workspaceSlug: normalized.workspaceId,
        trustedInstructionVersion: "source-grounded-brief-v1",
        toolSchemaVersion: "source-grounded-brief-v1",
        modelPolicy: {
          provider: "openrouter",
          model: "fake/local-source-grounded-brief",
          region: "local",
          allowedProviders: ["openrouter"],
          allowedModels: ["fake/local-source-grounded-brief"],
          allowedRegions: ["local"],
          maxInputTokens: 8_000,
          maxOutputTokens: 1_000,
          maxSpendCents: 1,
          retention: "none",
          training: "disabled",
        },
        policyGeneration: 1,
        lifecycleGeneration: 1,
        redactionState: "none",
        immutableContentManifest: {
          sourceHash,
          contentHashes: contentArtifacts.map((artifact) => artifact.hash),
          contentArtifacts,
          schemaHash: outputSchemaHash,
          schemaGeneration: 1,
        },
        outputSchema: SourceGroundedBriefModelOutput,
        attemptKey: normalized.idempotencyKey,
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new ValidationFailed({
              field: "idempotencyKey",
              message: error.message,
            }),
        ),
      );

    const receipt = modelResult.receipt;
    yield* unsafeAssumeClockProvided(
      writeAuthenticatedModelCallReceipt({
        workspaceId: normalized.workspaceId,
        receipt: {
          attemptKey: receipt.attemptKey,
          provider: receipt.provider,
          model: receipt.model,
          region: receipt.region,
          state: receipt.state,
          trustedInstructionVersion: receipt.trustedInstructionVersion,
          toolSchemaVersion: receipt.toolSchemaVersion,
          schemaGeneration: receipt.schemaGeneration,
          policyGeneration: receipt.policyGeneration,
          lifecycleGeneration: receipt.lifecycleGeneration,
          redactionState: receipt.redactionState,
          requestHash: receipt.requestHash,
          responseHash: receipt.responseHash,
          sourceHash: receipt.sourceHash,
          inputTokens: receipt.usage.inputTokens,
          outputTokens: receipt.usage.outputTokens,
          costCents: receipt.usage.costCents,
          latencyMs: receipt.latencyMs,
          createdAt: Date.parse(receipt.generatedAt),
        },
      }).pipe(
        Effect.mapError((error) =>
          error instanceof ModelReceiptTenantMismatch ||
          error instanceof ModelReceiptDuplicate
            ? new ValidationFailed({
                field: "idempotencyKey",
                message: error.message,
              })
            : error,
        ),
      ),
    );

    return {
      ...modelResult.output,
      policySnapshotId: `policy_snapshot_${normalized.idempotencyKey}`,
      modelReceiptId: `model_receipt_${normalized.idempotencyKey}`,
    };
  });

const run = FunctionImpl.make(
  databaseSchema,
  sourceGroundedBrief,
  "run",
  runSourceGroundedBrief,
);

const runInternal = FunctionImpl.make(
  databaseSchema,
  sourceGroundedBrief,
  "runInternal",
  runSourceGroundedBrief,
);

export default GroupImpl.make(databaseSchema, sourceGroundedBrief).pipe(
  Layer.provide(run),
  Layer.provide(runInternal),
  GroupImpl.finalize,
);
