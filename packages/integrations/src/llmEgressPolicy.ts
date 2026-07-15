import { createHash } from "node:crypto";
import * as Schema from "effect/Schema";

export type ModelProvider = "openrouter";
export type ModelRegion = "us" | "eu" | "local";

const allowedArtifactMediaTypes = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
]);
const maxArtifactBytes = 64_000;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/i;

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(
        ([, nested]) => nested !== undefined && typeof nested !== "function",
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
};

export const canonicalContentRootHash = async (
  contentHashes: readonly string[],
): Promise<string> => sha256(stableJson({ contentHashes }));

export const canonicalOutputSchemaHash = (schema: {
  readonly ast: unknown;
}): string =>
  `sha256:${createHash("sha256").update(stableJson(schema.ast)).digest("hex")}`;

export class ModelPolicyDenied extends Schema.TaggedError<ModelPolicyDenied>()(
  "ModelPolicyDenied",
  {
    reason: Schema.String,
    provider: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    region: Schema.optional(Schema.String),
  },
) {}

export class ModelInputTooLarge extends Schema.TaggedError<ModelInputTooLarge>()(
  "ModelInputTooLarge",
  {
    maxInputTokens: Schema.Number,
    estimatedInputTokens: Schema.Number,
  },
) {}

export class ModelBudgetExceeded extends Schema.TaggedError<ModelBudgetExceeded>()(
  "ModelBudgetExceeded",
  {
    maxSpendCents: Schema.Number,
    estimatedSpendCents: Schema.Number,
    currentSpendCents: Schema.Number,
  },
) {}

export type StructuredModelPolicy = {
  readonly provider: ModelProvider;
  readonly model: string;
  readonly region: ModelRegion;
  readonly allowedProviders: readonly ModelProvider[];
  readonly allowedModels: readonly string[];
  readonly allowedRegions: readonly ModelRegion[];
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxSpendCents: number;
  readonly currentSpendCents?: number;
  readonly retention: "none" | "provider-default";
  readonly training: "disabled" | "provider-default";
};

export type ImmutableContentManifest = {
  readonly sourceHash: string;
  readonly contentHashes: readonly string[];
  readonly contentArtifacts: readonly {
    readonly hash: string;
    readonly mediaType?: string;
    readonly bytes?: string;
    readonly tokens?: number;
  }[];
  readonly schemaHash: string;
  readonly schemaGeneration: number;
  readonly canary?: string;
};

export type StructuredPolicyCheck = {
  readonly estimatedInputTokens: number;
  readonly estimatedSpendCents: number;
};

export type SerializedStructuredProviderRequest = {
  readonly canonicalJson: string;
};

export type StructuredPolicyError =
  ModelPolicyDenied | ModelInputTooLarge | ModelBudgetExceeded;

export const estimateStructuredInputTokens = (input: {
  readonly serializedProviderRequest: SerializedStructuredProviderRequest;
}): number =>
  Math.ceil(input.serializedProviderRequest.canonicalJson.length / 4);

export const estimateStructuredSpendCents = (
  inputTokens: number,
  outputTokens: number,
): number =>
  Math.max(1, Math.ceil((inputTokens * 20 + outputTokens * 40) / 1_000_000));

export const enforceStructuredModelPolicy = async (input: {
  readonly trustedInstructionVersion: string;
  readonly toolSchemaVersion: string;
  readonly immutableContentManifest: ImmutableContentManifest;
  readonly serializedProviderRequest: SerializedStructuredProviderRequest;
  readonly modelPolicy: StructuredModelPolicy;
}): Promise<StructuredPolicyCheck | StructuredPolicyError> => {
  const { modelPolicy } = input;

  if (!modelPolicy.allowedProviders.includes(modelPolicy.provider)) {
    return new ModelPolicyDenied({
      reason: "Provider is not allowed by model policy.",
      provider: modelPolicy.provider,
    });
  }

  if (!modelPolicy.allowedModels.includes(modelPolicy.model)) {
    return new ModelPolicyDenied({
      reason: "Model is not allowed by model policy.",
      model: modelPolicy.model,
    });
  }

  if (!modelPolicy.allowedRegions.includes(modelPolicy.region)) {
    return new ModelPolicyDenied({
      reason: "Region is not allowed by model policy.",
      region: modelPolicy.region,
    });
  }

  if (modelPolicy.retention !== "none" || modelPolicy.training !== "disabled") {
    return new ModelPolicyDenied({
      reason: "Model policy must disable provider retention and training.",
      provider: modelPolicy.provider,
      model: modelPolicy.model,
    });
  }

  for (const hash of input.immutableContentManifest.contentHashes) {
    if (!safeHashPattern.test(hash)) {
      return new ModelPolicyDenied({
        reason: "Content hashes must be canonical sha256 values.",
      });
    }
  }

  if (input.immutableContentManifest.contentArtifacts.length === 0) {
    return new ModelPolicyDenied({
      reason: "At least one immutable content artifact is required.",
    });
  }

  for (const artifact of input.immutableContentManifest.contentArtifacts) {
    if (artifact.bytes === undefined || artifact.bytes.length === 0) {
      return new ModelPolicyDenied({
        reason: "Immutable content artifacts must include exact bytes.",
      });
    }
    if (artifact.bytes.length > maxArtifactBytes) {
      return new ModelPolicyDenied({
        reason: "Immutable content artifact exceeds size cap.",
      });
    }
    if (
      artifact.mediaType === undefined ||
      !allowedArtifactMediaTypes.has(artifact.mediaType)
    ) {
      return new ModelPolicyDenied({
        reason: "Immutable content artifact media type is not allowed.",
      });
    }
    if ((await sha256(artifact.bytes)) !== artifact.hash) {
      return new ModelPolicyDenied({
        reason: "Immutable content artifact hash mismatch.",
      });
    }
  }

  const artifactHashes = input.immutableContentManifest.contentArtifacts.map(
    ({ hash }) => hash,
  );
  if (
    stableJson(artifactHashes) !==
    stableJson(input.immutableContentManifest.contentHashes)
  ) {
    return new ModelPolicyDenied({
      reason: "Content hash list must match artifact hashes.",
    });
  }

  if (
    (await canonicalContentRootHash(
      input.immutableContentManifest.contentHashes,
    )) !== input.immutableContentManifest.sourceHash
  ) {
    return new ModelPolicyDenied({ reason: "Source root hash is stale." });
  }

  const estimatedInputTokens = estimateStructuredInputTokens({
    serializedProviderRequest: input.serializedProviderRequest,
  });

  if (estimatedInputTokens > modelPolicy.maxInputTokens) {
    return new ModelInputTooLarge({
      maxInputTokens: modelPolicy.maxInputTokens,
      estimatedInputTokens,
    });
  }

  const estimatedSpendCents = estimateStructuredSpendCents(
    estimatedInputTokens,
    modelPolicy.maxOutputTokens,
  );
  const currentSpendCents = modelPolicy.currentSpendCents ?? 0;

  if (currentSpendCents + estimatedSpendCents > modelPolicy.maxSpendCents) {
    return new ModelBudgetExceeded({
      maxSpendCents: modelPolicy.maxSpendCents,
      estimatedSpendCents,
      currentSpendCents,
    });
  }

  return { estimatedInputTokens, estimatedSpendCents };
};
