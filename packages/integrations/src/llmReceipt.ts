import { createHash } from "node:crypto";
import * as Schema from "effect/Schema";
import type { ProviderMode } from "./index";
import type { ModelProvider, ModelRegion } from "./llmEgressPolicy";

export const ModelCallState = Schema.Literal(
  "queued",
  "running",
  "succeeded",
  "retryable_failure",
  "permanent_failure",
  "cancelled",
);

export type ModelCallState = Schema.Schema.Type<typeof ModelCallState>;

export class ModelReceiptMismatch extends Schema.TaggedError<ModelReceiptMismatch>()(
  "ModelReceiptMismatch",
  {
    field: Schema.String,
    expected: Schema.optional(Schema.String),
    actual: Schema.optional(Schema.String),
  },
) {}

export type ModelCallUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costCents: number;
};

export type ModelCallReceipt = {
  readonly attemptKey: string;
  readonly workspaceSlug: string;
  readonly provider: ModelProvider;
  readonly mode: ProviderMode;
  readonly model: string;
  readonly region: ModelRegion;
  readonly state: ModelCallState;
  readonly trustedInstructionVersion: string;
  readonly toolSchemaVersion: string;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly sourceHash: string;
  readonly latencyMs: number;
  readonly usage: ModelCallUsage;
  readonly generatedAt: string;
};
