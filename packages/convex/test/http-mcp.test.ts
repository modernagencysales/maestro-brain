import { describe, expect, it } from "vitest";
import templateHttp from "../confect/http";
import {
  type HeadlessHttpCtx,
  handleTemplateHttpRequest,
  templateHttpRoutes,
} from "../src/index";

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

const mcpRequest = (
  method: string,
  params?: Record<string, unknown>,
  authorization?: string,
): Request =>
  new Request("https://template.local/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

const readJson = async (response: Response) =>
  (await response.json()) as Record<string, unknown>;

describe("hosted Brain MCP", () => {
  it("registers the stable streamable HTTP route", () => {
    expect(templateHttpRoutes).toContainEqual({
      path: "/mcp",
      method: "POST",
      description: "Serves the hosted streamable HTTP MCP transport.",
    });
    expect(templateHttp.getRoutes()).toContainEqual([
      "/mcp",
      "POST",
      expect.any(Function),
    ]);
  });

  it("initializes and serves the cited Company Brain prompt", async () => {
    const initialized = await readJson(
      await handleTemplateHttpRequest(noopCtx, mcpRequest("initialize")),
    );
    expect(initialized).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { prompts: {}, tools: {} },
        serverInfo: { name: "maestro-brain", version: "1.0.0" },
      },
    });

    const negotiated = await readJson(
      await handleTemplateHttpRequest(
        noopCtx,
        mcpRequest("initialize", { protocolVersion: "2025-03-26" }),
      ),
    );
    expect(negotiated).toMatchObject({
      result: { protocolVersion: "2025-03-26" },
    });

    const notification = new Request("https://template.local/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    const acknowledged = await handleTemplateHttpRequest(noopCtx, notification);
    expect(acknowledged.status).toBe(202);
    expect(await acknowledged.text()).toBe("");

    const listed = await readJson(
      await handleTemplateHttpRequest(noopCtx, mcpRequest("prompts/list")),
    );
    expect(listed).toMatchObject({
      result: { prompts: [{ name: "ask-company-brain" }] },
    });

    const prompted = await readJson(
      await handleTemplateHttpRequest(
        noopCtx,
        mcpRequest("prompts/get", {
          name: "ask-company-brain",
          arguments: { question: "What is our ICP?" },
        }),
      ),
    );
    const text = (
      prompted.result as {
        messages: readonly [{ content: { text: string } }];
      }
    ).messages[0].content.text;
    expect(text).toContain("template.brain.ask");
    expect(text).toContain('"evidenceMode":"mixed"');
    expect(text).toContain("ContextPack V4");
    expect(text).toContain("pack hash");
    expect(text).toContain("abstain");
  });

  it("advertises only scope-safe Brain tools without principal selectors", async () => {
    const listed = await readJson(
      await handleTemplateHttpRequest(noopCtx, mcpRequest("tools/list")),
    );
    const tools = (
      listed.result as {
        tools: readonly {
          name: string;
          description: string;
          inputSchema: {
            properties: Record<string, unknown>;
            required?: readonly string[];
          };
          annotations: Record<string, boolean>;
        }[];
      }
    ).tools;
    expect(tools.map(({ name }) => name)).toEqual([
      "template.brain.knowledge.extract",
      "template.brain.knowledge.candidates",
      "template.brain.knowledge.review",
      "template.agents.assistant.answerQuestion",
      "template.brain.ask",
      "template.agents.assistant.saveEvaluationExample",
      "template.brain.evidence.search",
      "template.brain.evidence.sourceGet",
      "template.brain.evidence.health",
      "template.brain.pages.list",
      "template.brain.pages.get",
      "template.brain.pages.createMarkdown",
      "template.brain.pages.updateMarkdown",
      "template.brain.pages.history",
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(Object.keys(tool.inputSchema.properties)).not.toEqual(
        expect.arrayContaining([
          "organizationId",
          "tenantId",
          "userId",
          "workspaceId",
          "workspaceSlug",
        ]),
      );
      expect(tool.inputSchema.required ?? []).not.toEqual(
        expect.arrayContaining(["userId", "workspaceId", "workspaceSlug"]),
      );
      expect(tool.annotations).toMatchObject({
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });

  it("derives the evidence actor and reopens the caller-selected exact revision", async () => {
    const calls: { kind: string; input: Record<string, unknown> }[] = [];
    const ctx: HeadlessHttpCtx = {
      ...noopCtx,
      runQuery: async (_ref, input) => {
        calls.push({ kind: "query", input });
        if ("requiredScope" in input)
          return {
            ok: true,
            keyId: "key_1",
            workspaceId: "workspaces_derived",
            userId: "users_derived",
          };
        return {
          sourceKey: "drive:file-1",
          revisionKey: "revision-2",
          provider: "google_drive",
          scopeKey: "drive:approved",
          title: "Positioning",
          markdown: "# Positioning",
          contentHash: "hash-2",
          sourceModifiedAt: 2,
          observedAt: 3,
          tombstone: false,
        };
      },
    };
    const response = await readJson(
      await handleTemplateHttpRequest(
        ctx,
        mcpRequest(
          "tools/call",
          {
            name: "template.brain.evidence.sourceGet",
            arguments: {
              sourceKey: "drive:file-1",
              revisionKey: "revision-2",
            },
          },
          "Bearer mtk_live_test",
        ),
      ),
    );

    expect(calls[0]?.input).toMatchObject({
      requiredScope: "workspace:read",
    });
    expect(calls[1]?.input).toEqual({
      sourceKey: "drive:file-1",
      revisionKey: "revision-2",
      workspaceId: "workspaces_derived",
      userId: "users_derived",
    });
    expect(response).toMatchObject({
      result: { content: [{ type: "text" }] },
    });
  });

  it("derives the read workspace and user from the credential", async () => {
    const calls: { kind: string; input: Record<string, unknown> }[] = [];
    const ctx: HeadlessHttpCtx = {
      ...noopCtx,
      runQuery: async (_ref, input) => {
        calls.push({ kind: "query", input });
        if ("requiredScope" in input)
          return {
            ok: true,
            keyId: "key_1",
            workspaceId: "workspaces_derived",
            userId: "users_derived",
          };
        return {
          status: "insufficient-context",
          reason: "no-eligible-evidence",
          answerMarkdown: null,
          contextPack: { schemaVersion: "3" },
        };
      },
    };
    const response = await readJson(
      await handleTemplateHttpRequest(
        ctx,
        mcpRequest(
          "tools/call",
          {
            name: "template.agents.assistant.answerQuestion",
            arguments: { question: "What is our ICP?" },
          },
          "Bearer mtk_live_test",
        ),
      ),
    );

    expect(calls[0]?.input).toMatchObject({
      requiredScope: "workspace:read",
    });
    expect(calls[0]?.input).not.toHaveProperty("workspaceSlug");
    expect(calls[1]?.input).toEqual({
      question: "What is our ICP?",
      workspaceId: "workspaces_derived",
      userId: "users_derived",
    });
    expect(response).toMatchObject({
      result: { content: [{ type: "text" }] },
    });
  });

  it("requires write scope, injects the actor, and rejects caller selectors", async () => {
    const calls: { kind: string; input: Record<string, unknown> }[] = [];
    const ctx: HeadlessHttpCtx = {
      ...noopCtx,
      runQuery: async (_ref, input) => {
        calls.push({ kind: "query", input });
        return {
          ok: true,
          keyId: "key_1",
          workspaceId: "workspaces_derived",
          userId: "users_derived",
        };
      },
      runMutation: async (_ref, input) => {
        calls.push({ kind: "mutation", input });
        return "brainPages_created";
      },
    };
    await handleTemplateHttpRequest(
      ctx,
      mcpRequest(
        "tools/call",
        {
          name: "template.brain.pages.createMarkdown",
          arguments: {
            slug: "icp",
            title: "ICP",
            markdown: "# ICP",
          },
        },
        "Bearer mtk_live_test",
      ),
    );
    expect(calls[0]?.input).toMatchObject({ requiredScope: "workspace:write" });
    expect(calls[1]).toEqual({
      kind: "mutation",
      input: {
        slug: "icp",
        title: "ICP",
        markdown: "# ICP",
        workspaceId: "workspaces_derived",
        userId: "users_derived",
      },
    });

    calls.length = 0;
    const rejected = await readJson(
      await handleTemplateHttpRequest(
        ctx,
        mcpRequest(
          "tools/call",
          {
            name: "template.brain.pages.list",
            arguments: { workspaceId: "workspaces_attacker" },
          },
          "Bearer mtk_live_test",
        ),
      ),
    );
    expect(calls).toHaveLength(0);
    expect(rejected).toMatchObject({
      error: {
        code: -32602,
        message:
          "Workspace and principal selectors are derived from the bearer credential.",
      },
    });
  });
});
