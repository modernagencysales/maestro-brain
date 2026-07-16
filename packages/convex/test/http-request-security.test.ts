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
import { handleTemplateHttpRequest } from "../confect/http";
import { executeAuthorizedHeadlessOperation } from "../confect/manifest/executor";
import { readJsonBody } from "../confect/httpRequest";

const reviewedReadPolicy = {
  operationId: "brain.pages.createMarkdown",
  headless: true,
  requiredScope: "brain:read",
} as const satisfies HeadlessOperationPolicy;

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
  it("keeps the current generated write operation closed to headless keys", async () => {
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
        _tag: "Forbidden",
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
        operationId: "synthetic.read",
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
          operationId: "synthetic.read",
          principal,
          operationInput: { [field]: "attacker" },
          policy: reviewedReadPolicy,
        }),
      ).toMatchObject({ error: { _tag: "ValidationFailed" } });
    }
  });

  it("prevents JSON body parsing when bearer syntax is missing", async () => {
    const { request, json } = requestWithJsonSpy(undefined);

    await expect(readJsonBody(request)).resolves.toEqual({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "Request body must be valid JSON.",
      },
    });
    expect(json).toHaveBeenCalledTimes(1);
  });

  it("authenticates by internal key-hash query before JSON decode and dispatch", async () => {
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
      error: { _tag: "Unauthorized", message: "Unauthorized." },
    });
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      keyHash: await hashPresentedApiKey("mbk_live_missing"),
      requiredScope: "brain:read",
    });
    expect(json).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("orders authenticate, authorize, decode, dispatch, reauthenticate, and mark", async () => {
    const calls: string[] = [];
    const displayKey = "mbk_live_order";
    const keyHash = await hashPresentedApiKey(displayKey);
    const request = new Request(
      "https://example.test/api/brain.pages.createMarkdown",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${displayKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: { title: "A note" },
          idempotencyKey: "idem_123",
        }),
      },
    );
    const json = vi.spyOn(request, "json").mockImplementation(async () => {
      calls.push("decode");
      return { input: { title: "A note" }, idempotencyKey: "idem_123" };
    });
    const runQuery = vi.fn(async (_ref, input) => {
      calls.push("authenticate");
      expect(input).toEqual({ keyHash, requiredScope: "brain:read" });
      return authResult(keyHash);
    });
    const runMutation = vi.fn(async (_ref, input) => {
      if (input.keyId === "api_key_123" && input.keyHash === keyHash) {
        calls.push("mark");
        return null;
      }
      calls.push("dispatch");
      return { id: "brainPage_123" };
    });

    const response = await handleTemplateHttpRequest(
      { runQuery, runMutation, runAction: async () => undefined },
      request,
    );

    expect(await response.json()).toEqual({
      ok: false,
      error: { _tag: "Forbidden", message: "Forbidden." },
    });
    expect(json).not.toHaveBeenCalled();
    expect(calls).toEqual(["authenticate"]);
  });

  it("fails closed when reauthorization fails after dispatch", async () => {
    const displayKey = "mbk_live_reauth";
    const keyHash = await hashPresentedApiKey(displayKey);
    let authCalls = 0;
    const runQuery = vi.fn(async () => {
      authCalls += 1;
      if (authCalls === 1) return authResult(keyHash);
      throw new Error("revoked");
    });
    const runMutation = vi.fn(async () => ({ id: "brainPage_123" }));

    const response = await handleTemplateHttpRequest(
      { runQuery, runMutation, runAction: async () => undefined },
      new Request("https://example.test/api/brain.pages.createMarkdown", {
        method: "POST",
        headers: {
          authorization: `Bearer ${displayKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: { title: "A note" },
          idempotencyKey: "idem_123",
        }),
      }),
    );

    expect(await response.json()).toEqual({
      ok: false,
      error: { _tag: "Forbidden", message: "Forbidden." },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("redacts dispatch exceptions without logging bearer values", async () => {
    const displayKey = "mbk_live_dispatch_secret";
    const keyHash = await hashPresentedApiKey(displayKey);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const response = await handleTemplateHttpRequest(
      {
        runQuery: async () => authResult(keyHash),
        runMutation: async () => {
          throw new Error(`internal reason ${displayKey}`);
        },
        runAction: async () => undefined,
      },
      new Request("https://example.test/api/brain.pages.createMarkdown", {
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
