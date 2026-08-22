import { afterEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import {
  executeHeadlessOperation,
  findHeadlessOperation,
  type HeadlessExecutionAdapter,
} from "../confect/manifest/executor";

const sampleOperation = {
  namespace: "test.sample",
  name: "write",
  operationId: "test.sample.write",
  kind: "mutation",
  surfaces: ["api", "cli", "mcp"],
  typedErrors: ["ValidationFailed"],
  idempotent: false,
  argsSchemaName: "test.sample.write.args",
  returnsSchemaName: "test.sample.write.returns",
} as const;

const mockManifest = (operation = sampleOperation) => {
  vi.resetModules();
  vi.doMock(
    "@maestro-template/template-core/generated/confectManifest",
    () => ({
      confectManifest: {
        version: 1,
        generatedAt: "1970-01-01T00:00:00.000Z",
        functions: [operation],
      },
    }),
  );
};

const createAdapter = (
  overrides: Partial<HeadlessExecutionAdapter> = {},
): HeadlessExecutionAdapter => ({
  refs: {
    "test.sample.write": "test.sample.write.ref",
  },
  runQuery: async () => {
    throw new Error("runQuery should not be called");
  },
  runMutation: async () => ({ id: "sample_123" }),
  runAction: async () => {
    throw new Error("runAction should not be called");
  },
  ...overrides,
});

describe("headless executor", () => {
  it("exposes reviewed Brain reads and rejects the deleted legacy page write", () => {
    expect(findHeadlessOperation("brain.pages.list", "api")).toBeDefined();
    expect(findHeadlessOperation("brain.rollout.status", "api")).toBeDefined();
    expect(findHeadlessOperation("brain.rollout.status", "cli")).toBeDefined();
    expect(
      findHeadlessOperation("brain.pages.createMarkdown", "api"),
    ).toBeUndefined();
  });

  it("returns ValidationFailed for the deleted legacy page write without dispatch", async () => {
    const adapter = createAdapter({
      runMutation: async () => {
        throw new Error("runMutation should not be called");
      },
    });

    await expect(
      executeHeadlessOperation(adapter, {
        operationId: "brain.pages.createMarkdown",
        surface: "api",
        input: {},
        idempotencyKey: "idem_123",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "Headless operation is not available.",
      },
    });
  });

  it("requires idempotency keys for synthetic non-idempotent headless writes", async () => {
    mockManifest();
    const { executeHeadlessOperation: executeWithMockedManifest } =
      await import("../confect/manifest/executor");

    const result = await executeWithMockedManifest(createAdapter(), {
      operationId: "test.sample.write",
      surface: "api",
      input: { title: "A note" },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message:
          "Operation test.sample.write requires a nonblank idempotencyKey.",
      },
    });
  });

  it("rejects padded and non-URL-safe idempotency keys before dispatch", async () => {
    mockManifest();
    const { executeHeadlessOperation: executeWithMockedManifest } =
      await import("../confect/manifest/executor");
    const adapter = createAdapter({
      runMutation: async () => {
        throw new Error("runMutation should not be called");
      },
    });

    await expect(
      executeWithMockedManifest(adapter, {
        operationId: "test.sample.write",
        surface: "api",
        input: { title: "A note" },
        idempotencyKey: " idem_123 ",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message:
          "Operation test.sample.write received invalid idempotencyKey: idempotencyKey must not have leading or trailing whitespace.",
      },
    });
    await expect(
      executeWithMockedManifest(adapter, {
        operationId: "test.sample.write",
        surface: "api",
        input: { title: "A note" },
        idempotencyKey: "idem/123",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message:
          "Operation test.sample.write received invalid idempotencyKey: idempotencyKey must contain only URL-safe letters, numbers, '.', '_', '~', or '-'.",
      },
    });
  });

  it("dispatches synthetic exposed writes through the adapter ref", async () => {
    mockManifest();
    const { executeHeadlessOperation: executeWithMockedManifest } =
      await import("../confect/manifest/executor");
    const calls: unknown[] = [];
    const adapter = createAdapter({
      runMutation: async (ref, input) => {
        calls.push([ref, input]);
        return { id: "sample_123" };
      },
    });

    const result = await executeWithMockedManifest(adapter, {
      operationId: "test.sample.write",
      surface: "api",
      input: { title: "A note" },
      idempotencyKey: "idem_123",
    });

    expect(calls).toEqual([
      [
        "test.sample.write.ref",
        { title: "A note", idempotencyKey: "idem_123" },
      ],
    ]);
    expect(result).toEqual({
      ok: true,
      operationId: "test.sample.write",
      result: { id: "sample_123" },
    });
  });

  it("exposes admission and rollout failures in the external failure union", () => {
    type FailureTag = Extract<
      Awaited<ReturnType<typeof executeHeadlessOperation>>,
      { readonly ok: false }
    >["error"]["_tag"];

    const rateLimited: FailureTag = "RateLimited";
    const subsystemDisabled: FailureTag = "SubsystemDisabled";
    const retrievalCapacity: FailureTag = "RetrievalCapacityExceeded";

    expect(rateLimited).toBe("RateLimited");
    expect(subsystemDisabled).toBe("SubsystemDisabled");
    expect(retrievalCapacity).toBe("RetrievalCapacityExceeded");
  });

  it("sanitizes encoded RetrievalCapacityExceeded dispatch failures", async () => {
    mockManifest();
    const { executeHeadlessOperation: executeWithMockedManifest } =
      await import("../confect/manifest/executor");
    const adapter = createAdapter({
      runMutation: async () => {
        throw new ConvexError({
          _tag: "RetrievalCapacityExceeded",
          resource: "current_postings",
          limit: 5_000,
          observedAtLeast: 5_001,
        });
      },
    });

    await expect(
      executeWithMockedManifest(adapter, {
        operationId: "test.sample.write",
        surface: "api",
        input: {},
        idempotencyKey: "idem_123",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        _tag: "RetrievalCapacityExceeded",
        message: "Brain retrieval capacity was exceeded.",
      },
    });
  });

  it("sanitizes encoded SubsystemDisabled dispatch failures", async () => {
    mockManifest();
    const { executeHeadlessOperation: executeWithMockedManifest } =
      await import("../confect/manifest/executor");
    const adapter = createAdapter({
      runMutation: async () => {
        throw new ConvexError({
          _tag: "SubsystemDisabled",
          subsystem: "brain.read",
        });
      },
    });

    await expect(
      executeWithMockedManifest(adapter, {
        operationId: "test.sample.write",
        surface: "api",
        input: {},
        idempotencyKey: "idem_123",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        _tag: "SubsystemDisabled",
        message: "Brain reads are unavailable.",
      },
    });
  });

  it.each([
    new Error("internal failure"),
    new ConvexError({
      _tag: "ValidationFailed",
      field: "query",
      message: "internal validation detail",
    }),
  ])("rethrows non-rollout dispatch failures", async (failure) => {
    mockManifest();
    const { executeHeadlessOperation: executeWithMockedManifest } =
      await import("../confect/manifest/executor");
    const adapter = createAdapter({
      runMutation: async () => {
        throw failure;
      },
    });

    await expect(
      executeWithMockedManifest(adapter, {
        operationId: "test.sample.write",
        surface: "api",
        input: {},
        idempotencyKey: "idem_123",
      }),
    ).rejects.toBe(failure);
  });

  it("keeps generic ref/input/result/kind validation behavior", async () => {
    mockManifest();
    const { executeHeadlessOperation: executeWithMockedManifest } =
      await import("../confect/manifest/executor");

    await expect(
      executeWithMockedManifest(createAdapter({ refs: {} }), {
        operationId: "test.sample.write",
        surface: "api",
        input: {},
        idempotencyKey: "idem_123",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "Headless operation is not available.",
      },
    });
    await expect(
      executeWithMockedManifest(
        createAdapter({ runMutation: async () => undefined }),
        {
          operationId: "test.sample.write",
          surface: "api",
          input: {},
          idempotencyKey: "idem_123",
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "Operation test.sample.write returned a non-JSON-safe result.",
      },
    });
    await expect(
      executeWithMockedManifest(createAdapter(), {
        operationId: "test.sample.write",
        surface: "api",
        input: { createdAt: new Date("2026-07-03T00:00:00.000Z") } as never,
        idempotencyKey: "idem_123",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "Operation test.sample.write received non-JSON-safe input.",
      },
    });
  });

  it("rejects unsupported manifest operation kinds", async () => {
    mockManifest({ ...sampleOperation, kind: "future" as never });
    const { executeHeadlessOperation: executeWithMockedManifest } =
      await import("../confect/manifest/executor");

    await expect(
      executeWithMockedManifest(createAdapter(), {
        operationId: "test.sample.write",
        surface: "api",
        input: {},
        idempotencyKey: "idem_123",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "Operation test.sample.write has unsupported kind future.",
      },
    });
  });
});

afterEach(() => {
  vi.doUnmock("@maestro-template/template-core/generated/confectManifest");
});
