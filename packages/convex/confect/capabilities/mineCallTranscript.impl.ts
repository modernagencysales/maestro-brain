import {
  canonicalContentRootHash,
  canonicalOutputSchemaHash,
} from "@maestro-template/integrations/llmEgressPolicy";
import {
  createStructuredLlmGateway,
  type StructuredLlmGateway,
} from "@maestro-template/integrations/llmStructured";
import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { readProcessEnv } from "../shared/env";
import { Unauthorized } from "../errors";
import type { GatherMaintenanceContext } from "./gatherMaintenanceContext.spec";
import { decodeMinedCall, MinedCall } from "./mineCallTranscript.domain";
import { createOpenRouterStructuredTransport } from "./mineCallTranscript.node";
import mineCallTranscriptGroup, {
  TranscriptMiningFailed,
} from "./mineCallTranscript.spec";

const sha256Text = (text: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    return `sha256:${Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  });

const artifactsFor = (context: GatherMaintenanceContext) => [
  JSON.stringify({
    kind: "route",
    brainKey: context.brainKey,
    unitKey: context.unitKey,
    unitRevisionKey: context.unitRevisionKey,
    routeGeneration: context.routeGeneration,
    source: context.source,
  }),
  ...context.pages.map((page) => JSON.stringify({ kind: "page", ...page })),
  ...context.citations.map((citation) =>
    JSON.stringify({ kind: "call_evidence", ...citation }),
  ),
];

export const mineCallTranscriptWithGateway = (
  context: GatherMaintenanceContext,
  attemptKey: string,
  gateway: StructuredLlmGateway,
  model = "openrouter/auto",
) =>
  Effect.gen(function* () {
    const bytes = artifactsFor(context);
    const contentHashes = yield* Effect.all(bytes.map(sha256Text));
    const result = yield* gateway.generate({
      organizationId: context.organizationId,
      workspaceSlug: context.workspaceId,
      trustedInstructionVersion: "call-maintenance-v1",
      toolSchemaVersion: "mined-call-v1",
      modelPolicy: {
        provider: "openrouter",
        model,
        region: "us",
        allowedProviders: ["openrouter"],
        allowedModels: [model],
        allowedRegions: ["us"],
        maxInputTokens: 200_000,
        maxOutputTokens: 4_096,
        maxSpendCents: 100,
        retention: "none",
        training: "disabled",
      },
      policyGeneration: context.policyGeneration,
      lifecycleGeneration: context.sourceLifecycleGeneration,
      redactionState: "none",
      immutableContentManifest: {
        sourceHash: yield* Effect.promise(() =>
          canonicalContentRootHash(contentHashes),
        ),
        contentHashes,
        contentArtifacts: contentHashes.map((hash, index) => ({
          hash,
          mediaType: "application/json",
          bytes: bytes[index] ?? "",
        })),
        schemaHash: canonicalOutputSchemaHash(MinedCall),
        schemaGeneration: 1,
      },
      outputSchema: MinedCall,
      attemptKey,
    });
    const output = yield* Effect.try({
      try: () =>
        decodeMinedCall(result.output, {
          brainKey: context.brainKey,
          pageKeys: context.pages.map(({ pageKey }) => pageKey),
          citations: context.citations,
        }),
      catch: () => new TranscriptMiningFailed({ reason: "output" }),
    });
    return { output, receipt: result.receipt };
  });

const mineCallTranscriptImpl = FunctionImpl.make(
  databaseSchema,
  mineCallTranscriptGroup,
  "mineCallTranscript",
  ({ context, attemptKey, caller }) => {
    if (
      caller.kind !== "system" ||
      (caller.surface !== "workflow" && caller.surface !== "internal")
    )
      return Effect.fail(new Unauthorized());
    const env = readProcessEnv();
    const configuredMode = env.LLM_PROVIDER_MODE?.trim().toLowerCase();
    const mode =
      configuredMode === "live" || configuredMode === "test"
        ? configuredMode
        : "fake";
    const model =
      env.LLM_DEFAULT_MODEL?.trim() ||
      (mode === "live" ? "openai/gpt-4.1-mini" : "openrouter/auto");
    const gateway = createStructuredLlmGateway({
      mode,
      env,
      ...(mode === "live"
        ? { transport: createOpenRouterStructuredTransport(env) }
        : {
            fakeStructuredOutput: {
              summary: "",
              summaryCitationKeys: [],
              decisions: [],
              commitments: [],
              risks: [],
              stakeholderChanges: [],
              pageProposals: [],
            },
          }),
    });
    return mineCallTranscriptWithGateway(
      context,
      attemptKey,
      gateway,
      model,
    ).pipe(
      Effect.mapError((error) =>
        error instanceof TranscriptMiningFailed
          ? error
          : new TranscriptMiningFailed({
              reason:
                typeof error === "object" &&
                error !== null &&
                "_tag" in error &&
                String(error._tag).includes("Policy")
                  ? "policy"
                  : "provider",
            }),
      ),
    );
  },
);

export default GroupImpl.make(databaseSchema, mineCallTranscriptGroup).pipe(
  Layer.provide(mineCallTranscriptImpl),
  GroupImpl.finalize,
);
