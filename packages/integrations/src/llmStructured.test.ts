import { createHash } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  createStructuredLlmGateway,
  ModelTimeout,
  ProviderRateLimited,
} from "./llmStructured";
import { canonicalOutputSchemaHash } from "./llmEgressPolicy";

const Decision = Schema.Struct({
  decision: Schema.Literal("capture", "direct", "abstain"),
  confidence: Schema.Number,
});

const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const sourceHashFor = (contentHashes: readonly string[]): string =>
  sha256(stableJson({ contentHashes }));

const artifactText = "Classify exact source text.";
const artifactHash = sha256(artifactText);

const baseRequest = {
  organizationId: "org_acme",
  workspaceSlug: "acme-demo",
  trustedInstructionVersion: "classify-v1",
  toolSchemaVersion: "routing-v1",
  immutableContentManifest: {
    sourceHash: sourceHashFor([artifactHash]),
    contentHashes: [artifactHash],
    contentArtifacts: [
      {
        hash: artifactHash,
        mediaType: "text/plain",
        bytes: artifactText,
        tokens: 4,
      },
    ],
    schemaHash: canonicalOutputSchemaHash(Decision),
    schemaGeneration: 1,
  },
  outputSchema: Decision,
  policyGeneration: 3,
  lifecycleGeneration: 7,
  redactionState: "none" as const,
  modelPolicy: {
    provider: "openrouter" as const,
    model: "openrouter/fake-structured",
    region: "us" as const,
    allowedProviders: ["openrouter" as const],
    allowedModels: ["openrouter/fake-structured"],
    allowedRegions: ["us" as const],
    maxInputTokens: 200,
    maxOutputTokens: 100,
    maxSpendCents: 10,
    currentSpendCents: 0,
    retention: "none" as const,
    training: "disabled" as const,
  },
  attemptKey: "attempt-001",
};

describe("structured provider-neutral LLM gateway", () => {
  it("uses a cryptographic schema digest and rejects schema substitution", async () => {
    const Alternate = Schema.Struct({
      decision: Schema.Literal("capture", "direct", "abstain"),
      confidence: Schema.Number,
      rationale: Schema.String,
    });
    const decisionHash = canonicalOutputSchemaHash(Decision);
    const alternateHash = canonicalOutputSchemaHash(Alternate);

    expect(decisionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(decisionHash).not.toMatch(/^sha256:0{56}[a-f0-9]{8}$/);
    expect(decisionHash).not.toBe(alternateHash);

    const gateway = createStructuredLlmGateway({
      mode: "test",
      env: {},
      transport: () => Effect.die("transport must not run"),
    });
    const result = await Effect.runPromiseExit(
      gateway.generate({
        ...baseRequest,
        immutableContentManifest: {
          ...baseRequest.immutableContentManifest,
          schemaHash: alternateHash,
        },
      }),
    );

    expect(JSON.stringify(result)).toContain("ModelPolicyDenied");
  });

  it("admits against exact serialized provider payload before transport", async () => {
    const gateway = createStructuredLlmGateway({
      mode: "test",
      env: {},
      transport: () =>
        Effect.die("transport must not run after payload admission fails"),
    });

    const result = await Effect.runPromiseExit(
      gateway.generate({
        ...baseRequest,
        modelPolicy: { ...baseRequest.modelPolicy, maxInputTokens: 25 },
        immutableContentManifest: {
          ...baseRequest.immutableContentManifest,
          sourceHash: sourceHashFor([
            sha256(
              "Private client source text that exceeds the exact request budget.",
            ),
          ]),
          contentHashes: [
            sha256(
              "Private client source text that exceeds the exact request budget.",
            ),
          ],
          contentArtifacts: [
            {
              hash: sha256(
                "Private client source text that exceeds the exact request budget.",
              ),
              mediaType: "text/plain",
              bytes:
                "Private client source text that exceeds the exact request budget.",
            },
          ],
        },
      }),
    );

    expect(JSON.stringify(result)).toContain("ModelInputTooLarge");
  });

  it("rejects missing bytes, hash mismatches, stale source roots, and unsupported media before transport", async () => {
    let calls = 0;
    const gateway = createStructuredLlmGateway({
      mode: "test",
      env: {},
      transport: () => {
        calls += 1;
        return Effect.die("transport must not run");
      },
    });

    const cases = [
      {
        contentArtifacts: [{ hash: artifactHash, mediaType: "text/plain" }],
      },
      {
        contentArtifacts: [
          {
            hash: sha256("other"),
            mediaType: "text/plain",
            bytes: artifactText,
          },
        ],
      },
      {
        sourceHash: sourceHashFor([sha256("other")]),
      },
      {
        contentArtifacts: [
          {
            hash: artifactHash,
            mediaType: "application/octet-stream",
            bytes: artifactText,
          },
        ],
      },
    ];

    for (const manifestPatch of cases) {
      const result = await Effect.runPromiseExit(
        gateway.generate({
          ...baseRequest,
          attemptKey: `attempt-reject-${calls}-${JSON.stringify(manifestPatch).length}`,
          immutableContentManifest: {
            ...baseRequest.immutableContentManifest,
            ...manifestPatch,
          },
        }),
      );
      expect(JSON.stringify(result)).toContain("ModelPolicyDenied");
    }

    expect(calls).toBe(0);
  });

  it("hashes exact immutable content and schema admission fields", async () => {
    const hashes: string[] = [];
    const gateway = createStructuredLlmGateway({
      mode: "test",
      env: {},
      transport: (input) => {
        hashes.push(input.requestHash);
        return Effect.succeed({
          provider: input.provider,
          model: input.model,
          region: input.region,
          requestHash: input.requestHash,
          sourceHash: input.sourceHash,
          text: JSON.stringify({ decision: "capture", confidence: 1 }),
          usage: { inputTokens: 5, outputTokens: 5, costCents: 1 },
        });
      },
    });

    await Effect.runPromise(gateway.generate(baseRequest));
    await Effect.runPromise(
      gateway.generate({
        ...baseRequest,
        attemptKey: "attempt-002",
        immutableContentManifest: {
          ...baseRequest.immutableContentManifest,
          schemaGeneration: 2,
        },
      }),
    );

    expect(hashes[0]).not.toBe(hashes[1]);
  });
  it("returns schema-decoded fake output with immutable hashes and no prompt text", async () => {
    const gateway = createStructuredLlmGateway({
      mode: "fake",
      env: {},
      now: () => "2026-07-01T00:00:00.000Z",
      fakeStructuredOutput: { decision: "capture", confidence: 0.91 },
    });

    const result = await Effect.runPromise(gateway.generate(baseRequest));

    expect(result).toMatchObject({
      provider: "openrouter",
      model: "openrouter/fake-structured",
      output: { decision: "capture", confidence: 0.91 },
      receipt: {
        attemptKey: "attempt-001",
        state: "succeeded",
        requestHash: expect.stringMatching(/^sha256:/) as string,
        responseHash: expect.stringMatching(/^sha256:/) as string,
        sourceHash: sourceHashFor([artifactHash]),
        generatedAt: "2026-07-01T00:00:00.000Z",
      },
    });
    expect(JSON.stringify(result)).not.toContain("Private client source text");
  });

  it("rejects malformed JSON and schema-invalid structured output", async () => {
    const malformed = createStructuredLlmGateway({
      mode: "test",
      env: {},
      transport: (input) =>
        Effect.succeed({
          provider: input.provider,
          model: input.model,
          region: input.region,
          requestHash: input.requestHash,
          sourceHash: input.sourceHash,
          text: "not json",
          usage: { inputTokens: 5, outputTokens: 5, costCents: 1 },
        }),
    });

    const malformedExit = await Effect.runPromiseExit(
      malformed.generate(baseRequest),
    );
    expect(malformedExit).toMatchObject({
      _tag: "Failure",
      cause: { _tag: "Fail", error: { _tag: "MalformedModelOutput" } },
    });

    const wrongShape = createStructuredLlmGateway({
      mode: "test",
      env: {},
      transport: (input) =>
        Effect.succeed({
          provider: input.provider,
          model: input.model,
          region: input.region,
          requestHash: input.requestHash,
          sourceHash: input.sourceHash,
          text: JSON.stringify({ decision: "unknown", confidence: 1 }),
          usage: { inputTokens: 5, outputTokens: 5, costCents: 1 },
        }),
    });

    const wrongShapeExit = await Effect.runPromiseExit(
      wrongShape.generate(baseRequest),
    );
    expect(wrongShapeExit).toMatchObject({
      _tag: "Failure",
      cause: { _tag: "Fail", error: { _tag: "MalformedModelOutput" } },
    });
  });

  it("rejects receipt mismatches, duplicate responses, timeout, and rate limit as typed errors", async () => {
    const mismatch = createStructuredLlmGateway({
      mode: "test",
      env: {},
      transport: (input) =>
        Effect.succeed({
          provider: input.provider,
          model: input.model,
          region: input.region,
          requestHash: "sha256:wrong",
          sourceHash: input.sourceHash,
          text: JSON.stringify({ decision: "capture", confidence: 1 }),
          usage: { inputTokens: 5, outputTokens: 5, costCents: 1 },
        }),
    });

    const mismatchExit = await Effect.runPromiseExit(
      mismatch.generate(baseRequest),
    );
    expect(mismatchExit).toMatchObject({
      _tag: "Failure",
      cause: { _tag: "Fail", error: { _tag: "ModelReceiptMismatch" } },
    });

    const providerMismatch = createStructuredLlmGateway({
      mode: "test",
      env: {},
      transport: (input) =>
        Effect.succeed({
          provider: input.provider,
          model: "other/model",
          region: input.region,
          requestHash: input.requestHash,
          sourceHash: input.sourceHash,
          text: JSON.stringify({ decision: "capture", confidence: 1 }),
          usage: { inputTokens: 5, outputTokens: 5, costCents: 1 },
        }),
    });

    const providerMismatchExit = await Effect.runPromiseExit(
      providerMismatch.generate(baseRequest),
    );
    expect(providerMismatchExit).toMatchObject({
      _tag: "Failure",
      cause: {
        _tag: "Fail",
        error: { _tag: "ModelReceiptMismatch", field: "model" },
      },
    });

    const seenAttemptKeys = new Set<string>();
    const duplicate = createStructuredLlmGateway({
      mode: "fake",
      env: {},
      seenAttemptKeys,
      fakeStructuredOutput: { decision: "capture", confidence: 1 },
    });

    await Effect.runPromise(duplicate.generate(baseRequest));
    const duplicateExit = await Effect.runPromiseExit(
      duplicate.generate(baseRequest),
    );
    expect(duplicateExit).toMatchObject({
      _tag: "Failure",
      cause: { _tag: "Fail", error: { _tag: "ModelReceiptMismatch" } },
    });

    const timeout = createStructuredLlmGateway({
      mode: "test",
      env: {},
      transport: () =>
        Effect.fail(
          new ModelTimeout({ provider: "openrouter", timeoutMs: 1000 }),
        ),
    });
    const timeoutExit = await Effect.runPromiseExit(
      timeout.generate(baseRequest),
    );
    expect(timeoutExit).toMatchObject({
      _tag: "Failure",
      cause: { _tag: "Fail", error: { _tag: "ModelTimeout" } },
    });

    const limited = createStructuredLlmGateway({
      mode: "test",
      env: {},
      transport: () =>
        Effect.fail(
          new ProviderRateLimited({
            provider: "openrouter",
            retryAfterMs: 1000,
          }),
        ),
    });
    const limitedExit = await Effect.runPromiseExit(
      limited.generate(baseRequest),
    );
    expect(limitedExit).toMatchObject({
      _tag: "Failure",
      cause: { _tag: "Fail", error: { _tag: "ProviderRateLimited" } },
    });
  });

  it("does not silently use fake output in live mode without a transport", async () => {
    const gateway = createStructuredLlmGateway({
      mode: "live",
      env: { OPENROUTER_API_KEY: "test-key" },
      fakeStructuredOutput: { decision: "capture", confidence: 1 },
    });

    const result = await Effect.runPromiseExit(gateway.generate(baseRequest));

    expect(result).toMatchObject({
      _tag: "Failure",
      cause: { _tag: "Fail", error: { _tag: "ModelPolicyDenied" } },
    });
  });

  it("enforces spend, token, provider, model, region, and no-retention policy before transport", async () => {
    let calls = 0;
    const gateway = createStructuredLlmGateway({
      mode: "test",
      env: {},
      transport: () => {
        calls += 1;
        return Effect.die("transport must not run");
      },
    });

    const inputTooLargeExit = await Effect.runPromiseExit(
      gateway.generate({
        ...baseRequest,
        modelPolicy: { ...baseRequest.modelPolicy, maxInputTokens: 1 },
      }),
    );
    expect(inputTooLargeExit).toMatchObject({
      _tag: "Failure",
      cause: { _tag: "Fail", error: { _tag: "ModelInputTooLarge" } },
    });

    const budgetExit = await Effect.runPromiseExit(
      gateway.generate({
        ...baseRequest,
        modelPolicy: { ...baseRequest.modelPolicy, currentSpendCents: 10 },
      }),
    );
    expect(budgetExit).toMatchObject({
      _tag: "Failure",
      cause: { _tag: "Fail", error: { _tag: "ModelBudgetExceeded" } },
    });

    const modelDeniedExit = await Effect.runPromiseExit(
      gateway.generate({
        ...baseRequest,
        modelPolicy: {
          ...baseRequest.modelPolicy,
          allowedModels: ["other/model"],
        },
      }),
    );
    expect(modelDeniedExit).toMatchObject({
      _tag: "Failure",
      cause: { _tag: "Fail", error: { _tag: "ModelPolicyDenied" } },
    });

    const retentionDeniedExit = await Effect.runPromiseExit(
      gateway.generate({
        ...baseRequest,
        modelPolicy: {
          ...baseRequest.modelPolicy,
          retention: "provider-default",
        },
      }),
    );
    expect(retentionDeniedExit).toMatchObject({
      _tag: "Failure",
      cause: { _tag: "Fail", error: { _tag: "ModelPolicyDenied" } },
    });

    expect(calls).toBe(0);
  });

  it("keeps logging canaries redacted from all typed failures", async () => {
    const gateway = createStructuredLlmGateway({
      mode: "test",
      env: {},
      transport: () =>
        Effect.fail(new Error("provider saw Private client source text")),
    });

    const result = await Effect.runPromiseExit(
      gateway.generate({
        ...baseRequest,
        immutableContentManifest: {
          ...baseRequest.immutableContentManifest,
          canary: "Private client source text",
        },
      }),
    );

    expect(JSON.stringify(result)).not.toContain("Private client source text");
  });
});
