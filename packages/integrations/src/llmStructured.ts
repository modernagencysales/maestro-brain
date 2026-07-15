import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ProviderMode } from "./index";
import {
  canonicalOutputSchemaHash,
  enforceStructuredModelPolicy,
  type ImmutableContentManifest,
  ModelBudgetExceeded,
  ModelInputTooLarge,
  ModelPolicyDenied,
  type ModelProvider,
  type ModelRegion,
  type SerializedStructuredProviderRequest,
  type StructuredModelPolicy,
  type StructuredPolicyError,
} from "./llmEgressPolicy";
import {
  hashModelPayload,
  makeModelCallReceipt,
  type ModelCallReceipt,
  ModelReceiptMismatch,
  type ModelCallUsage,
} from "./llmReceipt";

export {
  ModelBudgetExceeded,
  ModelInputTooLarge,
  ModelPolicyDenied,
} from "./llmEgressPolicy";
export { ModelReceiptMismatch } from "./llmReceipt";

export class ModelTimeout extends Schema.TaggedError<ModelTimeout>()(
  "ModelTimeout",
  {
    provider: Schema.String,
    timeoutMs: Schema.Number,
  },
) {}

export class ProviderRateLimited extends Schema.TaggedError<ProviderRateLimited>()(
  "ProviderRateLimited",
  {
    provider: Schema.String,
    retryAfterMs: Schema.optional(Schema.Number),
  },
) {}

export class MalformedModelOutput extends Schema.TaggedError<MalformedModelOutput>()(
  "MalformedModelOutput",
  {
    reason: Schema.String,
    provider: Schema.String,
    model: Schema.String,
  },
) {}

export type StructuredLlmTransportInput = {
  readonly provider: ModelProvider;
  readonly model: string;
  readonly region: ModelRegion;
  readonly requestHash: string;
  readonly sourceHash: string;
  readonly outputSchemaName: string;
  readonly outputSchemaHash: string;
  readonly serializedProviderRequest: SerializedStructuredProviderRequest;
};

export type StructuredLlmTransportResult = {
  readonly provider: ModelProvider;
  readonly model: string;
  readonly region: ModelRegion;
  readonly requestHash: string;
  readonly sourceHash: string;
  readonly text: string;
  readonly usage: ModelCallUsage;
};

export type StructuredLlmRequest<A> = {
  readonly organizationId: string;
  readonly workspaceSlug: string;
  readonly trustedInstructionVersion: string;
  readonly toolSchemaVersion: string;
  readonly modelPolicy: StructuredModelPolicy;
  readonly policyGeneration: number;
  readonly lifecycleGeneration: number;
  readonly redactionState: "none" | "redacted";
  readonly immutableContentManifest: ImmutableContentManifest;
  readonly outputSchema: Schema.Schema<A>;
  readonly attemptKey: string;
};

export type StructuredLlmResult<A> = {
  readonly provider: ModelProvider;
  readonly mode: ProviderMode;
  readonly model: string;
  readonly region: ModelRegion;
  readonly output: A;
  readonly receipt: ModelCallReceipt;
};

export type StructuredLlmError =
  | StructuredPolicyError
  | ModelTimeout
  | ProviderRateLimited
  | MalformedModelOutput
  | ModelReceiptMismatch;

export type StructuredLlmGatewayConfig = {
  readonly mode: ProviderMode;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now?: () => string;
  readonly transport?: (
    input: StructuredLlmTransportInput,
  ) => Effect.Effect<StructuredLlmTransportResult, unknown>;
  readonly fakeStructuredOutput?: unknown;
  readonly seenAttemptKeys?: Set<string>;
};

export type StructuredLlmGateway = {
  readonly generate: <A>(
    request: StructuredLlmRequest<A>,
  ) => Effect.Effect<StructuredLlmResult<A>, StructuredLlmError>;
};

const isKnownStructuredError = (error: unknown): error is StructuredLlmError =>
  error instanceof ModelTimeout ||
  error instanceof ProviderRateLimited ||
  error instanceof MalformedModelOutput ||
  error instanceof ModelReceiptMismatch ||
  error instanceof ModelPolicyDenied ||
  error instanceof ModelInputTooLarge ||
  error instanceof ModelBudgetExceeded;

const outputSchemaName = (schema: {
  readonly ast: { readonly _tag: string };
}): string => schema.ast._tag;

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const serializeProviderRequest = <A>(
  request: StructuredLlmRequest<A>,
): SerializedStructuredProviderRequest => ({
  canonicalJson: stableJson({
    provider: request.modelPolicy.provider,
    model: request.modelPolicy.model,
    region: request.modelPolicy.region,
    instruction: { version: request.trustedInstructionVersion },
    tools: { version: request.toolSchemaVersion },
    content: {
      sourceHash: request.immutableContentManifest.sourceHash,
      contentHashes: request.immutableContentManifest.contentHashes,
      artifacts: request.immutableContentManifest.contentArtifacts.map(
        (artifact) => ({
          hash: artifact.hash,
          mediaType: artifact.mediaType,
          bytes: artifact.bytes,
          tokens: artifact.tokens,
        }),
      ),
    },
    outputSchema: {
      name: outputSchemaName(request.outputSchema),
      hash: canonicalOutputSchemaHash(request.outputSchema),
      generation: request.immutableContentManifest.schemaGeneration,
    },
    policy: {
      generation: request.policyGeneration,
      maxOutputTokens: request.modelPolicy.maxOutputTokens,
      retention: request.modelPolicy.retention,
      training: request.modelPolicy.training,
    },
    lifecycle: {
      generation: request.lifecycleGeneration,
      redactionState: request.redactionState,
    },
  }),
});

const parseStructuredOutput = <A>(input: {
  readonly text: string;
  readonly schema: Schema.Schema<A>;
  readonly provider: ModelProvider;
  readonly model: string;
}): A | MalformedModelOutput => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input.text) as unknown;
  } catch {
    return new MalformedModelOutput({
      reason: "Provider returned malformed JSON.",
      provider: input.provider,
      model: input.model,
    });
  }

  try {
    return Schema.decodeUnknownSync(input.schema)(parsed);
  } catch {
    return new MalformedModelOutput({
      reason: "Provider output did not match requested schema.",
      provider: input.provider,
      model: input.model,
    });
  }
};

const makeRequestHash = (
  serializedProviderRequest: SerializedStructuredProviderRequest,
): string => hashModelPayload(serializedProviderRequest);

const validateReceiptEcho = (input: {
  readonly expectedProvider: ModelProvider;
  readonly expectedModel: string;
  readonly expectedRegion: ModelRegion;
  readonly expectedRequestHash: string;
  readonly expectedSourceHash: string;
  readonly result: StructuredLlmTransportResult;
}): true | ModelReceiptMismatch => {
  if (input.result.provider !== input.expectedProvider) {
    return new ModelReceiptMismatch({
      field: "provider",
      expected: input.expectedProvider,
      actual: input.result.provider,
    });
  }

  if (input.result.model !== input.expectedModel) {
    return new ModelReceiptMismatch({
      field: "model",
      expected: input.expectedModel,
      actual: input.result.model,
    });
  }

  if (input.result.region !== input.expectedRegion) {
    return new ModelReceiptMismatch({
      field: "region",
      expected: input.expectedRegion,
      actual: input.result.region,
    });
  }

  if (input.result.requestHash !== input.expectedRequestHash) {
    return new ModelReceiptMismatch({
      field: "requestHash",
      expected: input.expectedRequestHash,
      actual: input.result.requestHash,
    });
  }

  if (input.result.sourceHash !== input.expectedSourceHash) {
    return new ModelReceiptMismatch({
      field: "sourceHash",
      expected: input.expectedSourceHash,
      actual: input.result.sourceHash,
    });
  }

  return true;
};

export const createStructuredLlmGateway = (
  config: StructuredLlmGatewayConfig,
): StructuredLlmGateway => ({
  generate: (request) =>
    Effect.gen(function* () {
      if (config.seenAttemptKeys?.has(request.attemptKey)) {
        return yield* Effect.fail(
          new ModelReceiptMismatch({
            field: "attemptKey",
            actual: request.attemptKey,
          }),
        );
      }

      if (
        request.immutableContentManifest.schemaHash !==
        canonicalOutputSchemaHash(request.outputSchema)
      ) {
        return yield* Effect.fail(
          new ModelPolicyDenied({
            reason:
              "Output schema hash must be derived from the actual schema.",
            provider: request.modelPolicy.provider,
            model: request.modelPolicy.model,
          }),
        );
      }

      const serializedProviderRequest = serializeProviderRequest(request);
      const policy = yield* Effect.promise(() =>
        enforceStructuredModelPolicy({
          ...request,
          serializedProviderRequest,
        }),
      );

      if (
        policy instanceof ModelPolicyDenied ||
        policy instanceof ModelInputTooLarge ||
        policy instanceof ModelBudgetExceeded
      ) {
        return yield* Effect.fail(policy);
      }

      const requestHash = makeRequestHash(serializedProviderRequest);
      const sourceHash = request.immutableContentManifest.sourceHash;
      const startedAt = Date.now();
      const transportInput: StructuredLlmTransportInput = {
        provider: request.modelPolicy.provider,
        model: request.modelPolicy.model,
        region: request.modelPolicy.region,
        requestHash,
        sourceHash,
        outputSchemaName: outputSchemaName(request.outputSchema),
        outputSchemaHash: request.immutableContentManifest.schemaHash,
        serializedProviderRequest,
      };
      const transport =
        config.transport ??
        (config.mode === "live"
          ? () =>
              Effect.fail(
                new ModelPolicyDenied({
                  reason: "Live structured LLM transport is not configured.",
                  provider: request.modelPolicy.provider,
                  model: request.modelPolicy.model,
                }),
              )
          : (input: StructuredLlmTransportInput) =>
              Effect.succeed({
                provider: input.provider,
                model: input.model,
                region: input.region,
                requestHash: input.requestHash,
                sourceHash: input.sourceHash,
                text: JSON.stringify(config.fakeStructuredOutput ?? {}),
                usage: {
                  inputTokens: policy.estimatedInputTokens,
                  outputTokens: request.modelPolicy.maxOutputTokens,
                  costCents: policy.estimatedSpendCents,
                },
              }));
      const providerResult = yield* transport(transportInput).pipe(
        Effect.mapError((error) =>
          isKnownStructuredError(error)
            ? error
            : new MalformedModelOutput({
                reason:
                  "Provider failed before returning schema-constrained output.",
                provider: request.modelPolicy.provider,
                model: request.modelPolicy.model,
              }),
        ),
      );
      const receiptEcho = validateReceiptEcho({
        expectedProvider: request.modelPolicy.provider,
        expectedModel: request.modelPolicy.model,
        expectedRegion: request.modelPolicy.region,
        expectedRequestHash: requestHash,
        expectedSourceHash: sourceHash,
        result: providerResult,
      });

      if (receiptEcho !== true) {
        return yield* Effect.fail(receiptEcho);
      }

      const output = parseStructuredOutput({
        text: providerResult.text,
        schema: request.outputSchema,
        provider: providerResult.provider,
        model: providerResult.model,
      });

      if (output instanceof MalformedModelOutput) {
        return yield* Effect.fail(output);
      }

      const receipt = makeModelCallReceipt({
        attemptKey: request.attemptKey,
        organizationId: request.organizationId,
        workspaceSlug: request.workspaceSlug,
        provider: providerResult.provider,
        mode: config.mode,
        model: providerResult.model,
        region: providerResult.region,
        trustedInstructionVersion: request.trustedInstructionVersion,
        toolSchemaVersion: request.toolSchemaVersion,
        schemaGeneration: request.immutableContentManifest.schemaGeneration,
        policyGeneration: request.policyGeneration,
        lifecycleGeneration: request.lifecycleGeneration,
        redactionState: request.redactionState,
        requestHash,
        responseHash: hashModelPayload(output),
        sourceHash,
        latencyMs: Math.max(0, Date.now() - startedAt),
        usage: providerResult.usage,
        generatedAt: config.now?.() ?? new Date().toISOString(),
      });

      config.seenAttemptKeys?.add(request.attemptKey);

      return {
        provider: providerResult.provider,
        mode: config.mode,
        model: providerResult.model,
        region: providerResult.region,
        output,
        receipt,
      };
    }),
});
