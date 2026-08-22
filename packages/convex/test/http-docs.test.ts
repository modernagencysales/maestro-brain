import { describe, expect, it } from "vitest";
import templateHttp from "../confect/http";
import {
  type HeadlessHttpCtx,
  handleTemplateHttpRequest,
  securityHeaders,
  templateHttpRoutes,
} from "../src/index";

const readJson = async (response: Response): Promise<unknown> =>
  JSON.parse(await response.text());

const noopCtx: HeadlessHttpCtx = {
  runQuery: async () => {
    throw new Error("runQuery should not be called");
  },
  runMutation: async () => {
    throw new Error("runMutation should not be called");
  },
  runAction: async () => {
    throw new Error("runAction should not be called");
  },
};

describe("template HTTP docs routes", () => {
  it("default-exports a Convex router covering every declared route", () => {
    const byPathThenMethod = (
      a: { path: string; method: string },
      b: { path: string; method: string },
    ) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
    const routes = templateHttp
      .getRoutes()
      .map(([path, method]) => ({ path, method }))
      .sort(byPathThenMethod);

    expect(routes).toEqual(
      templateHttpRoutes
        .map(({ path, method }) => ({ path, method }))
        .sort(byPathThenMethod),
    );
  });

  it("declares docs routes and omits the deleted legacy page route", () => {
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
          path: "/mcp",
          method: "POST",
          description: "Serves the stateless MCP tool transport.",
        },
      ]),
    );
    expect(templateHttpRoutes).not.toContainEqual(
      expect.objectContaining({ path: "/api/brain.pages.createMarkdown" }),
    );
  });

  it("serves generated OpenAPI JSON without the deleted legacy page operation", async () => {
    const response = await handleTemplateHttpRequest(
      noopCtx,
      new Request("https://template.local/api/openapi.json"),
    );
    const body = await readJson(response);

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toMatchObject({ openapi: "3.1.0" });
    expect(
      (body as { paths: Record<string, unknown> }).paths,
    ).not.toHaveProperty("/api/brain.pages.createMarkdown");
  });

  it("applies security headers to every HTTP response", async () => {
    const responses = await Promise.all([
      handleTemplateHttpRequest(
        noopCtx,
        new Request("https://template.local/api/docs"),
      ),
      handleTemplateHttpRequest(
        noopCtx,
        new Request("https://template.local/api/openapi.json"),
      ),
      handleTemplateHttpRequest(
        noopCtx,
        new Request("https://template.local/missing"),
      ),
    ]);

    for (const response of responses) {
      expect(response.headers.get("strict-transport-security")).toBe(
        securityHeaders["strict-transport-security"],
      );
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
    }
  });

  it("serves a Scalar docs shell", async () => {
    const response = await handleTemplateHttpRequest(
      noopCtx,
      new Request("https://template.local/api/docs"),
    );
    const html = await response.text();

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("@scalar/api-reference");
    expect(html).toContain('data-url="/api/openapi.json"');
  });

  it("returns the typed external error contract for POST to the deleted legacy page route without runner calls", async () => {
    const calls: string[] = [];
    const ctx: HeadlessHttpCtx = {
      runQuery: async () => {
        calls.push("query");
        throw new Error("runQuery should not be called");
      },
      runMutation: async () => {
        calls.push("mutation");
        throw new Error("runMutation should not be called");
      },
      runAction: async () => {
        calls.push("action");
        throw new Error("runAction should not be called");
      },
    };
    const body = await readJson(
      await handleTemplateHttpRequest(
        ctx,
        new Request("https://template.local/api/brain.pages.createMarkdown", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: {}, idempotencyKey: "old-write" }),
        }),
      ),
    );

    expect(body).toEqual({
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "Headless operation is not available.",
      },
    });
    expect(calls).toEqual([]);
  });

  it("does not translate deleted createMarkdown requests through legacy caller-ID compatibility", async () => {
    const { executorRequestFor } = await import("../confect/httpRequest");

    expect(
      executorRequestFor("brain.pages.createMarkdown", {
        workspaceSlug: "acme-demo",
        input: { slug: "legacy", title: "Legacy", markdown: "# Legacy" },
        idempotencyKey: "legacy-write",
      }),
    ).toEqual({
      ok: true,
      request: {
        operationId: "brain.pages.createMarkdown",
        surface: "api",
        input: { slug: "legacy", title: "Legacy", markdown: "# Legacy" },
        idempotencyKey: "legacy-write",
      },
    });
  });

  it("returns typed route errors for invalid HTTP requests", async () => {
    const method = await readJson(
      await handleTemplateHttpRequest(
        noopCtx,
        new Request("https://template.local/api/docs", { method: "POST" }),
      ),
    );
    const missing = await readJson(
      await handleTemplateHttpRequest(
        noopCtx,
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

  it("serves the generated MCP tool list and initialize handshake", async () => {
    const initialize = await readJson(
      await handleTemplateHttpRequest(
        noopCtx,
        new Request("https://template.local/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
        }),
      ),
    );
    const listed = await readJson(
      await handleTemplateHttpRequest(
        noopCtx,
        new Request("https://template.local/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        }),
      ),
    );

    expect(initialize).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { capabilities: { prompts: {}, tools: {} } },
    });
    expect(listed).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "template.brain.sources.search" }),
          expect.objectContaining({ name: "template.brain.answers.ask" }),
          expect.objectContaining({ name: "template.brain.pages.history" }),
        ]),
      },
    });
    const tools = (listed as { result: { tools: readonly { name: string }[] } })
      .result.tools;
    expect(tools).toHaveLength(7);
    expect(tools.map((tool) => tool.name)).not.toContain(
      "template.brain.pilot.ask",
    );
  });

  it("serves the Ask Apero MCP prompt with grounded answer guidance", async () => {
    const listed = await readJson(
      await handleTemplateHttpRequest(
        noopCtx,
        new Request("https://template.local/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "prompts/list",
          }),
        }),
      ),
    );
    const question = "What is Apero's current launch plan?";
    const prompt = await readJson(
      await handleTemplateHttpRequest(
        noopCtx,
        new Request("https://template.local/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 4,
            method: "prompts/get",
            params: { name: "ask-apero", arguments: { question } },
          }),
        }),
      ),
    );

    expect(listed).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {
        prompts: [
          {
            name: "ask-apero",
            title: "Ask Apero",
            description: expect.any(String),
            arguments: [
              {
                name: "question",
                description: expect.any(String),
                required: true,
              },
            ],
          },
        ],
      },
    });
    expect(prompt).toMatchObject({
      jsonrpc: "2.0",
      id: 4,
      result: {
        description: expect.any(String),
        messages: [
          {
            role: "user",
            content: { type: "text", text: expect.any(String) },
          },
        ],
      },
    });
    const text = (
      prompt as {
        result: { messages: readonly [{ content: { text: string } }] };
      }
    ).result.messages[0].content.text;
    expect(text).toContain(question);
    expect(text).toContain("template.brain.answers.ask");
    expect(text).toContain("citations");
    expect(text).toContain("freshness or readiness");
    expect(text).toContain("insufficient evidence");
    expect(text).toContain("Do not invent");
  });

  it("rejects unknown and invalid Ask Apero MCP prompt requests", async () => {
    const requestPrompt = async (
      id: number,
      params: Record<string, unknown>,
    ): Promise<unknown> =>
      await readJson(
        await handleTemplateHttpRequest(
          noopCtx,
          new Request("https://template.local/mcp", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id,
              method: "prompts/get",
              params,
            }),
          }),
        ),
      );

    expect(
      await requestPrompt(5, {
        name: "not-a-prompt",
        arguments: { question: "What changed?" },
      }),
    ).toEqual({
      jsonrpc: "2.0",
      id: 5,
      error: { code: -32602, message: "Unknown or unavailable MCP prompt." },
    });
    for (const [id, question] of [
      [6, undefined],
      [7, "   "],
      [8, 42],
    ] as const) {
      expect(
        await requestPrompt(id, {
          name: "ask-apero",
          arguments: { question },
        }),
      ).toEqual({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: "MCP prompt question must be a non-empty string.",
        },
      });
    }
  });

  it("rejects MCP tool calls that are not in the reviewed operation policy", async () => {
    const body = await readJson(
      await handleTemplateHttpRequest(
        noopCtx,
        new Request("https://template.local/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "template.ops.brainOperations.listPolicies" },
          }),
        }),
      ),
    );

    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32602, message: "Unknown or unavailable MCP tool." },
    });
  });
});
