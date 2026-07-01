import { describe, expect, it } from "vitest";
import { handleTemplateHttpRequest, templateHttpRoutes } from "../src/index";

const readJson = async (response: Response): Promise<unknown> =>
  JSON.parse(await response.text());

describe("template HTTP docs routes", () => {
  it("declares OpenAPI, Scalar docs, and executable API routes", () => {
    expect(templateHttpRoutes).toEqual(
      expect.arrayContaining([
        {
          path: "/api/openapi.json",
          method: "GET",
          description: "Serves the generated OpenAPI 3.1 document.",
        },
        {
          path: "/api/docs",
          method: "GET",
          description: "Serves the Scalar API documentation shell.",
        },
        {
          path: "/api/createTrustReceipt",
          method: "POST",
          description:
            "Executes createTrustReceipt through the shared template registry.",
        },
      ]),
    );
  });

  it("serves generated OpenAPI JSON", async () => {
    const response = await handleTemplateHttpRequest(
      new Request("https://template.local/api/openapi.json"),
    );
    const body = await readJson(response);

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/api/createTrustReceipt": {
          post: {
            operationId: "createTrustReceipt",
            "x-maestro-auth-scope": "audited write",
          },
        },
      },
    });
  });

  it("serves a Scalar docs shell", async () => {
    const response = await handleTemplateHttpRequest(
      new Request("https://template.local/api/docs"),
    );
    const html = await response.text();

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("@scalar/api-reference");
    expect(html).toContain('data-url="/api/openapi.json"');
  });

  it("executes a generated API operation through the shared registry", async () => {
    const response = await handleTemplateHttpRequest(
      new Request("https://template.local/api/createTrustReceipt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceSlug: "acme-demo",
          input: { sourceSetId: "source_set_template_001" },
          idempotencyKey: "receipt-example-001",
        }),
      }),
    );
    const body = await readJson(response);

    expect(body).toMatchObject({
      ok: true,
      operationId: "createTrustReceipt",
      result: {
        status: "accepted",
        workspaceSlug: "acme-demo",
        receiptId: "receipt_template_001",
        workflowRunId: "run_template_001",
      },
    });
  });

  it("returns typed validation errors for generated API operations", async () => {
    const body = await readJson(
      await handleTemplateHttpRequest(
        new Request("https://template.local/api/createTrustReceipt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceSlug: "acme-demo",
            input: {},
          }),
        }),
      ),
    );

    expect(body).toEqual({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "idempotencyKey is required for write operations.",
      },
    });
  });

  it("returns typed route errors for invalid HTTP requests", async () => {
    const method = await readJson(
      await handleTemplateHttpRequest(
        new Request("https://template.local/api/docs", { method: "POST" }),
      ),
    );
    const missing = await readJson(
      await handleTemplateHttpRequest(
        new Request("https://template.local/nope"),
      ),
    );

    expect(method).toEqual({
      ok: false,
      error: {
        _tag: "MethodNotAllowed",
        message: "Only GET is supported for Scalar docs.",
      },
    });
    expect(missing).toEqual({
      ok: false,
      error: {
        _tag: "NotFound",
        message: "Unknown template HTTP route: /nope",
      },
    });
  });
});
