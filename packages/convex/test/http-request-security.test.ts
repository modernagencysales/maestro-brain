import { describe, expect, it, vi } from "vitest";
import { createBrainApiKey } from "../confect/headless/auth";
import {
  authorizeHeadlessOperation,
  containsTenantInputField,
  type HeadlessOperationPolicy,
} from "../confect/headless/authorizeOperation";
import { createHeadlessPrincipal } from "../confect/headless/principal";
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

  it("prevents JSON body parsing when bearer syntax is missing", async () => {
    const request = new Request(
      "https://example.test/api/brain.pages.createMarkdown?apiKey=secret",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      },
    );

    await expect(
      readJsonBody(request, { authorization: undefined }),
    ).resolves.toEqual({
      ok: false,
      error: { _tag: "Unauthorized", message: "Unauthorized." },
    });
  });

  it("never logs raw Authorization values through public errors", async () => {
    const created = await createBrainApiKey({
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

    const parsed = await readJsonBody(
      new Request("https://example.test/api/brain.pages.createMarkdown", {
        method: "POST",
      }),
      { authorization: `Basic ${created.displayKey}` },
    );

    expect(JSON.stringify(parsed)).not.toContain(created.displayKey);
  });
});
