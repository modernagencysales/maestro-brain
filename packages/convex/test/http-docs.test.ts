import { describe, expect, it } from "vitest";
import { handleTemplateHttpRequest, templateHttpRoutes } from "../src/index";

const readJson = async (response: Response): Promise<unknown> =>
  JSON.parse(await response.text());

describe("template HTTP docs routes", () => {
  it("declares OpenAPI and Scalar docs routes", () => {
    expect(templateHttpRoutes).toEqual([
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
    ]);
  });

  it("serves generated OpenAPI JSON", async () => {
    const response = handleTemplateHttpRequest(
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
    const response = handleTemplateHttpRequest(
      new Request("https://template.local/api/docs"),
    );
    const html = await response.text();

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("@scalar/api-reference");
    expect(html).toContain('data-url="/api/openapi.json"');
  });

  it("returns typed route errors for invalid HTTP docs requests", async () => {
    const method = await readJson(
      handleTemplateHttpRequest(
        new Request("https://template.local/api/docs", { method: "POST" }),
      ),
    );
    const missing = await readJson(
      handleTemplateHttpRequest(new Request("https://template.local/nope")),
    );

    expect(method).toEqual({
      ok: false,
      error: {
        _tag: "MethodNotAllowed",
        message: "Only GET is supported for template API docs routes.",
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
