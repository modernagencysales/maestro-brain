import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ProviderMode } from "./index";
import {
  type ImmutableContentManifest,
  ModelBudgetExceeded,
  ModelInputTooLarge,
  ModelPolicyDenied,
  type ModelProvider,
  type ModelRegion,
  type StructuredModelPolicy,
  type StructuredPolicyError,
} from "./llmEgressPolicy";
import {
  type ModelCallReceipt,
  ModelReceiptMismatch,
  type ModelCallUsage,
} from "./llmReceipt";

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
  readonly workspaceSlug: string;
  readonly trustedInstructionVersion: string;
  readonly toolSchemaVersion: string;
  readonly modelPolicy: StructuredModelPolicy;
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
