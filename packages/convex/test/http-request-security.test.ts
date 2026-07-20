import { describe, expect, it, vi } from "vitest";
import {
  createBrainApiKey,
  hashPresentedApiKey,
} from "../confect/headless/auth";
import {
  authorizeHeadlessOperation,
  containsTenantInputField,
  type HeadlessOperationPolicy,
} from "../confect/headless/authorizeOperation";
import { createHeadlessPrincipal } from "../confect/headless/principal";
import templateHttp, { handleTemplateHttpRequest } from "../confect/http";
import { executeAuthorizedHeadlessOperation } from "../confect/manifest/executor";

const syntheticReadOperation = {
  namespace: "test.sample",
  name: "read",
  operationId: "test.sample.read",
  kind: "mutation",
  surfaces: ["api"],
  typedErrors: ["ValidationFailed"],
  idempotent: true,
  argsSchemaName: "test.sample.read.args",
  returnsSchemaName: "test.sample.read.returns",
} as const;

const syntheticAskOperation = {
  namespace: "test.sample",
  name: "ask",
  operationId: "test.sample.ask",
  kind: "action",
  surfaces: ["api"],
  typedErrors: ["ValidationFailed"],
  idempotent: true,
  argsSchemaName: "test.sample.ask.args",
  returnsSchemaName: "test.sample.ask.returns",
} as const;

const reviewedReadPolicy = {
  operationId: "test.sample.read",
  headless: true,
  requiredScope: "brain:read",
} as const satisfies HeadlessOperationPolicy;

const reviewedAskPolicy = {
  operationId: "test.sample.ask",
  headless: true,
  requiredScope: "brain:ask",
} as const satisfies HeadlessOperationPolicy;

type SyntheticHttpOperation =
  typeof syntheticReadOperation | typeof syntheticAskOperation;

const mockHttpManifest = (
  operation: SyntheticHttpOperation = syntheticReadOperation,
) => {
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

const principal = createHeadlessPrincipal({
  organizationId: "org_123",
  workspaceId: "workspace_123",
  brainKey: "brain_acme",
  roleCeiling: "viewer",
  keyId: "api_key_123",
  principalId: "service_principal_123",
  scopes: ["brain:read"],
});

const authResult = (keyHash: string) => ({
  principal,
  keyHash,
  keyId: "api_key_123",
});

const makeKey = async () =>
  await createBrainApiKey({
    organizationId: "org_123",
    workspaceId: "workspace_123",
    brainKey: "brain_acme",
    name: "Reviewer CLI",
    scopes: ["brain:read"],
    actor: { userId: "user_admin", role: "admin" },
    nowMs: 1_000,
    expiresAt: 20_000,
    randomBytes: () => new Uint8Array(32).fill(13),
  });

const requestWithJsonSpy = (authorization: string | undefined) => {
  const request = new Request(
    "https://example.test/api/brain.pages.createMarkdown?apiKey=secret",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization === undefined ? {} : { authorization }),
      },
      body: "{not-json",
    },
  );
  const json = vi.spyOn(request, "json");
  return { request, json };
};

describe("headless HTTP bearer security", () => {
  it("mounts a public API prefix fallback so Convex does not emit raw 404s for unknown API requests", () => {
    expect(templateHttp.lookup("/api/not.registered", "POST")?.[2]).toBe(
      "/api/*",
    );
  });
  it("keeps the deleted generated write operation closed to headless keys", async () => {
    const runMutation = vi.fn(async () => ({ id: "brainPage_123" }));

    const result = await executeAuthorizedHeadlessOperation(
      {
        refs: {
          "brain.pages.createMarkdown": "brain.pages.createMarkdown.ref",
        },
        runQuery: async () => undefined,
        runMutation,
        runAction: async () => undefined,
      },
      {
        operationId: "brain.pages.createMarkdown",
        surface: "api",
        input: { title: "A note" },
        idempotencyKey: "idem_123",
        principal,
        policy: {
          operationId: "brain.pages.list",
          headless: true,
          requiredScope: "brain:read",
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "Headless operation is not available.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("uses explicit reviewed policies for synthetic authorization without substring defaults", () => {
    expect(
      authorizeHeadlessOperation({
        operationId: "synthetic.answers.ask",
        principal,
        operationInput: { question: "hello" },
        policy: {
          operationId: "synthetic.answers.ask",
          headless: true,
          requiredScope: "brain:ask",
        },
      }),
    ).toEqual({
      ok: false,
      error: {
        _tag: "Forbidden",
        message: "Headless operation is not available.",
      },
    });

    expect(
      authorizeHeadlessOperation({
        operationId: "synthetic.answers.ask",
        principal: { ...principal, scopes: ["brain:ask"] },
        operationInput: { question: "hello" },
        policy: {
          operationId: "synthetic.answers.ask",
          headless: true,
          requiredScope: "brain:ask",
        },
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects caller-supplied tenant aliases recursively at the schema boundary", () => {
    expect(
      authorizeHeadlessOperation({
        operationId: "test.sample.read",
        principal,
        operationInput: {
          nested: [{ userId: "user_attacker" }],
          title: "A note",
        },
        policy: reviewedReadPolicy,
      }),
    ).toEqual({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message:
          "Headless requests must derive tenant and Brain scope from the bearer key.",
      },
    });
    expect(containsTenantInputField({ safe: [{ value: "ok" }] })).toBe(false);
  });

  it("rejects top-level tenant aliases before dispatch", async () => {
    for (const field of [
      "organizationKey",
      "agencyKey",
      "workspaceKey",
      "workspaceSlug",
      "memberId",
      "_id",
      "id",
      "keyId",
    ]) {
      expect(
        authorizeHeadlessOperation({
          operationId: "test.sample.read",
          principal,
          operationInput: { [field]: "attacker" },
          policy: reviewedReadPolicy,
        }),
      ).toMatchObject({ error: { _tag: "ValidationFailed" } });
    }
  });

  it("returns RateLimited before decoding or dispatch when admission denies the route", async () => {
    mockHttpManifest();
    const { handleTemplateHttpRequest: handleWithMockedManifest } =
      await import("../confect/http");
    const { request, json } = requestWithJsonSpy("Bearer mbk_live_limited");
    const routeRequest = new Request(
      "https://example.test/api/test.sample.read",
      {
        method: request.method,
        headers: request.headers,
        body: "{not-json",
      },
    );
    const runQuery = vi.fn(async () => authResult("unused"));

    const response = await handleWithMockedManifest(
      {
        runQuery,
        runMutation: async () => null,
        runAction: async () => undefined,
        rateLimit: async () => true,
        operationRefs: { "test.sample.read": "test.sample.read.ref" },
        operationPolicies: { "test.sample.read": reviewedReadPolicy },
      },
      routeRequest,
    );

    expect(await response.json()).toEqual({
      ok: false,
      error: { _tag: "RateLimited", message: "Rate limited." },
    });
    expect(json).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("passes only canonical non-secret admission metadata to rate-limit extensions", async () => {
    mockHttpManifest();
    const { handleTemplateHttpRequest: handleWithMockedManifest } =
      await import("../confect/http");
    const displayKey = "mbk_live_raw_rate_limit_secret";
    const canary = "CUSTOMER-CANARY-ua-xff-secret";
    const seen: unknown[] = [];

    const response = await handleWithMockedManifest(
      {
        runQuery: async () => authResult("unused"),
        runMutation: async () => null,
        runAction: async () => undefined,
        rateLimit: async (input) => {
          seen.push(input);
          expect("request" in input).toBe(false);
          const serialized = JSON.stringify(input);
          expect(serialized).not.toContain(displayKey);
          expect(serialized).not.toContain("authorization");
          expect(serialized).not.toContain(canary);
          expect(serialized).not.toContain("203.0.113.9");
          return true;
        },
        operationRefs: { "test.sample.read": "test.sample.read.ref" },
        operationPolicies: { "test.sample.read": reviewedReadPolicy },
      },
      new Request(
        `https://example.test/api/test.sample.read?token=${displayKey}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${displayKey}`,
            "content-type": "application/json; charset=utf-8",
            "user-agent": `${canary}/browser version`,
            "x-forwarded-for": `203.0.113.9, ${canary}`,
          },
          body: JSON.stringify({ input: { title: "A note" } }),
        },
      ),
    );

    expect(await response.json()).toEqual({
      ok: false,
      error: { _tag: "RateLimited", message: "Rate limited." },
    });
    expect(seen).toEqual([
      {
        operationId: "test.sample.read",
        pathname: "/api/test.sample.read",
        method: "POST",
        hasAuthorization: true,
        contentType: "application/json",
        userAgentFamily: "present",
        networkBucket: "untrusted-forwarded",
      },
    ]);
  });

  it("prevents route JSON body parsing when bearer syntax is malformed", async () => {
    mockHttpManifest();
    const { handleTemplateHttpRequest: handleWithMockedManifest } =
      await import("../confect/http");
    const { request, json } = requestWithJsonSpy("Bearer   ");
    const routeRequest = new Request(
      "https://example.test/api/test.sample.read",
      {
        method: request.method,
        headers: request.headers,
        body: "{not-json",
      },
    );
    const routeJson = vi.spyOn(routeRequest, "json");
    const runQuery = vi.fn(async () => authResult("unused"));
    const runMutation = vi.fn(async () => null);
    const runAction = vi.fn(async () => undefined);

    const response = await handleWithMockedManifest(
      {
        runQuery,
        runMutation,
        runAction,
        operationRefs: { "test.sample.read": "test.sample.read.ref" },
        operationPolicies: { "test.sample.read": reviewedReadPolicy },
      },
      routeRequest,
    );

    expect(await response.json()).toEqual({
      ok: false,
      error: { _tag: "Unauthorized", message: "Unauthorized." },
    });
    expect(json).not.toHaveBeenCalled();
    expect(routeJson).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAction).not.toHaveBeenCalled();
  });

  it("prevents route JSON body parsing when bearer syntax is missing", async () => {
    mockHttpManifest();
    const { handleTemplateHttpRequest: handleWithMockedManifest } =
      await import("../confect/http");
    const { request, json } = requestWithJsonSpy(undefined);
    const routeRequest = new Request(
      "https://example.test/api/test.sample.read",
      {
        method: request.method,
        headers: request.headers,
        body: "{not-json",
      },
    );
    const routeJson = vi.spyOn(routeRequest, "json");
    const runQuery = vi.fn(async () => authResult("unused"));

    const response = await handleWithMockedManifest(
      {
        runQuery,
        runMutation: async () => null,
        runAction: async () => undefined,
        operationRefs: { "test.sample.read": "test.sample.read.ref" },
        operationPolicies: { "test.sample.read": reviewedReadPolicy },
      },
      routeRequest,
    );

    expect(await response.json()).toEqual({
      ok: false,
      error: { _tag: "Unauthorized", message: "Unauthorized." },
    });
    expect(json).not.toHaveBeenCalled();
    expect(routeJson).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("does not decode or dispatch deleted HTTP operations and returns the uniform validation envelope", async () => {
    const { request, json } = requestWithJsonSpy("Bearer mbk_live_missing");
    const runMutation = vi.fn(async () => ({ id: "brainPage_123" }));
    const runQuery = vi.fn(async () => undefined);

    const response = await handleTemplateHttpRequest(
      {
        runQuery,
        runMutation,
        runAction: async () => undefined,
      },
      request,
    );

    expect(await response.json()).toEqual({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "Headless operation is not available.",
      },
    });
    expect(runQuery).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("returns the uniform validation envelope for unknown API routes without authentication", async () => {
    const request = new Request("https://example.test/api/not.registered", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{not-json",
    });
    const json = vi.spyOn(request, "json");
    const runQuery = vi.fn(async () => authResult("unused"));
    const runMutation = vi.fn(async () => ({ id: "brainPage_123" }));

    const response = await handleTemplateHttpRequest(
      {
        runQuery,
        runMutation,
        runAction: async () => undefined,
      },
      request,
    );

    expect(await response.json()).toEqual({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "Headless operation is not available.",
      },
    });
    expect(runQuery).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("orders authenticate, authorize, decode, dispatch, reauthenticate, and mark", async () => {
    mockHttpManifest();
    const { handleTemplateHttpRequest: handleWithMockedManifest } =
      await import("../confect/http");
    const calls: string[] = [];
    const displayKey = "mbk_live_order";
    const keyHash = await hashPresentedApiKey(displayKey);
    const request = new Request("https://example.test/api/test.sample.read", {
      method: "POST",
      headers: {
        authorization: `Bearer ${displayKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ input: { title: "A note" } }),
    });
    vi.spyOn(request, "json").mockImplementation(async () => {
      calls.push("decode");
      return { input: { title: "A note" } };
    });
    const runQuery = vi.fn(async (_ref, input) => {
      calls.push("authenticate");
      expect(input).toEqual({ keyHash, requiredScope: "brain:read" });
      return authResult(keyHash);
    });
    const runMutation = vi.fn(async (_ref, input) => {
      if (input.keyHash === keyHash) {
        expect(input).toMatchObject({ keyHash, keyId: "api_key_123" });
        calls.push("mark");
        return null;
      }
      calls.push("dispatch");
      return input;
    });
    const runAction = vi.fn(async () => {
      throw new Error("runAction should not be called");
    });

    const response = await handleWithMockedManifest(
      {
        runQuery,
        runMutation,
        runAction,
        operationRefs: { "test.sample.read": "test.sample.read.ref" },
        operationPolicies: { "test.sample.read": reviewedReadPolicy },
      },
      request,
    );

    expect(await response.json()).toEqual({
      ok: true,
      operationId: "test.sample.read",
      result: {
        title: "A note",
        organizationId: "org_123",
        workspaceId: "workspace_123",
        brainKey: "brain_acme",
      },
    });
    expect(calls).toEqual([
      "authenticate",
      "decode",
      "dispatch",
      "authenticate",
      "mark",
    ]);
  });

  it("authenticates HTTP routes with the operation-specific ask scope", async () => {
    mockHttpManifest(syntheticAskOperation);
    const { handleTemplateHttpRequest: handleWithMockedManifest } =
      await import("../confect/http");
    const displayKey = "mbk_live_ask";
    const keyHash = await hashPresentedApiKey(displayKey);
    const askPrincipal = { ...principal, scopes: ["brain:ask"] as const };
    const runQuery = vi.fn(async (_ref, input) => {
      expect(input).toEqual({ keyHash, requiredScope: "brain:ask" });
      return { ...authResult(keyHash), principal: askPrincipal };
    });
    const runAction = vi.fn(async (_ref, input) => ({
      answer: `asked ${input.question}`,
      organizationId: input.organizationId,
    }));

    const response = await handleWithMockedManifest(
      {
        runQuery,
        runMutation: async () => null,
        runAction,
        operationRefs: { "test.sample.ask": "test.sample.ask.ref" },
        operationPolicies: { "test.sample.ask": reviewedAskPolicy },
      },
      new Request("https://example.test/api/test.sample.ask", {
        method: "POST",
        headers: {
          authorization: `Bearer ${displayKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ input: { question: "hello" } }),
      }),
    );

    expect(await response.json()).toMatchObject({
      ok: true,
      operationId: "test.sample.ask",
      result: { answer: "asked hello", organizationId: "org_123" },
    });
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it("fails closed when reauthorization fails after dispatch", async () => {
    mockHttpManifest();
    const { handleTemplateHttpRequest: handleWithMockedManifest } =
      await import("../confect/http");
    const displayKey = "mbk_live_reauth";
    const keyHash = await hashPresentedApiKey(displayKey);
    let authCalls = 0;
    const runQuery = vi.fn(async () => {
      authCalls += 1;
      if (authCalls === 1) return authResult(keyHash);
      throw new Error("revoked");
    });
    const runMutation = vi.fn(async () => null);

    const response = await handleWithMockedManifest(
      {
        runQuery,
        runMutation,
        runAction: async () => undefined,
        operationRefs: { "test.sample.read": "test.sample.read.ref" },
        operationPolicies: { "test.sample.read": reviewedReadPolicy },
      },
      new Request("https://example.test/api/test.sample.read", {
        method: "POST",
        headers: {
          authorization: `Bearer ${displayKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ input: { title: "A note" } }),
      }),
    );

    expect(await response.json()).toEqual({
      ok: false,
      error: { _tag: "Unauthorized", message: "Unauthorized." },
    });
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("redacts dispatch exceptions without logging bearer values", async () => {
    mockHttpManifest();
    const { handleTemplateHttpRequest: handleWithMockedManifest } =
      await import("../confect/http");
    const displayKey = "mbk_live_dispatch_secret";
    const keyHash = await hashPresentedApiKey(displayKey);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const response = await handleWithMockedManifest(
      {
        runQuery: async () => authResult(keyHash),
        runMutation: async () => {
          throw new Error(`internal reason ${displayKey}`);
        },
        runAction: async () => undefined,
        operationRefs: { "test.sample.read": "test.sample.read.ref" },
        operationPolicies: { "test.sample.read": reviewedReadPolicy },
      },
      new Request("https://example.test/api/test.sample.read", {
        method: "POST",
        headers: {
          authorization: `Bearer ${displayKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ input: { title: "A note" } }),
      }),
    );

    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: { _tag: "Forbidden", message: "Forbidden." },
    });
    expect(JSON.stringify(body)).not.toContain(displayKey);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("never logs raw Authorization values through public errors", async () => {
    const created = await makeKey();

    const parsed = await handleTemplateHttpRequest(
      {
        runQuery: async () => undefined,
        runMutation: async () => undefined,
        runAction: async () => undefined,
      },
      new Request("https://example.test/api/brain.pages.createMarkdown", {
        method: "POST",
        headers: { authorization: `Basic ${created.displayKey}` },
      }),
    );

    expect(JSON.stringify(await parsed.json())).not.toContain(
      created.displayKey,
    );
  });
});
