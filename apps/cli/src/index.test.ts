import { confectManifest } from "@maestro-template/template-core/generated/confectManifest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  HeadlessOperation,
  McpToolCallResult,
  OpenApiDocument,
  TemplateApiResult,
} from "@maestro-template/workflow-tooling";
import type { providerConfigReport } from "@maestro-template/integrations";
import {
  decodeCliRuntimeConfig,
  remoteCliOperationRefs,
  runCli,
  runCliAsync,
} from "./index";
import type { CliResult } from "./types";

type ProviderConfigReport = ReturnType<typeof providerConfigReport>[number];

type WorkflowReceiptPayload = {
  readonly runId: string;
  readonly workflowRunId?: string;
  readonly workflowId?: string;
  readonly workspaceSlug?: string;
  readonly idempotencyKey?: string;
  readonly mode?: string;
  readonly input?: Record<string, unknown>;
  readonly trustReceiptId: string;
  readonly status?: string;
  readonly trustReceipt: {
    readonly receiptId: string;
    readonly workflowRunId?: string;
  };
};

const parseStdout = <T>(result: CliResult): T => JSON.parse(result.stdout) as T;

describe("maestro-template CLI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ships a runnable maestro-brain executable", () => {
    const executable = new URL("../bin/maestro-brain.mjs", import.meta.url);

    expect(existsSync(executable)).toBe(true);
    if (!existsSync(executable)) return;

    const result = spawnSync(
      process.execPath,
      [fileURLToPath(executable), "describe"],
      {
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ valid: true });
    expect(result.stderr).toBe("");
  }, 15_000);

  it("prints maestro-brain commands in help", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("maestro-brain api call");
    expect(result.stdout).toContain("maestro-brain ask <question>");
    expect(result.stdout).toContain("maestro-brain search <query>");
    expect(result.stdout).toContain(
      "maestro-brain source <citation-key|source-revision-key>",
    );
    expect(result.stdout).toContain("maestro-brain health");
    expect(result.stdout).toContain("maestro-brain feedback");
    expect(result.stdout).toContain("maestro-brain note --input");
    expect(result.stdout).toContain(
      "maestro-brain snapshot submit <directory>",
    );
    expect(result.stdout).not.toContain("maestro-template");
  });

  it.each([
    {
      argv: ["ask", "What", "is", "our", "ICP?"],
      operationId: "brain.answers.ask",
      input: { question: "What is our ICP?" },
    },
    {
      argv: ["search", "pricing", "economics"],
      operationId: "brain.sources.search",
      input: { query: "pricing economics" },
    },
    {
      argv: ["source", "surev_source_1"],
      operationId: "brain.sources.get",
      input: { sourceRevisionKey: "surev_source_1" },
    },
    {
      argv: ["source", "citation:pub_1:entry_1"],
      operationId: "brain.sources.get",
      input: { publicationSetKey: "pub_1", entryKey: "entry_1" },
    },
    {
      argv: ["health"],
      operationId: "brain.rollout.status",
      input: {},
    },
  ])("runs terminal command $argv through $operationId", async (example) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          operationId: example.operationId,
          result: { command: example.argv[0] },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const config = decodeCliRuntimeConfig({
      CONVEX_SITE_URL: "https://brain.example.test",
      MAESTRO_BRAIN_API_KEY: "brain_api_secret",
    });

    const result = await runCliAsync(example.argv, config);

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://brain.example.test/api/${example.operationId}`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ input: example.input }),
      }),
    );
  });

  it("submits terminal feedback with caller idempotency", async () => {
    const feedback = {
      requestId: `ctx_${"a".repeat(64)}`,
      candidateManifestHash: `sha256:${"b".repeat(64)}`,
      citations: [],
      readiness: { asOf: 1, coverage: [] },
      category: "answer_failure",
      disposition: "untriaged",
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          operationId: "brain.feedback.reportWrongOrStale",
          result: { reportKey: `fbr_${"c".repeat(64)}` },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runCliAsync(
      [
        "feedback",
        "--idempotency-key",
        "feedback-1",
        "--input",
        JSON.stringify(feedback),
      ],
      decodeCliRuntimeConfig({
        CONVEX_SITE_URL: "https://brain.example.test",
        MAESTRO_BRAIN_API_KEY: "brain_api_secret",
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(remoteCliOperationRefs).toHaveProperty(
      "brain.feedback.reportWrongOrStale",
      "brain.feedback.reportWrongOrStale",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://brain.example.test/api/brain.feedback.reportWrongOrStale",
      expect.objectContaining({
        body: JSON.stringify({
          input: feedback,
          idempotencyKey: "feedback-1",
        }),
      }),
    );
  });

  it("submits a terminal note to review", async () => {
    const input = { title: "Pricing", markdown: "Updated margin guidance." };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          operationId: "brain.notes.submit",
          result: {
            sourceKey: `src_${"a".repeat(64)}`,
            status: "pending_review",
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runCliAsync(
      ["note", "--input", JSON.stringify(input)],
      decodeCliRuntimeConfig({
        CONVEX_SITE_URL: "https://brain.example.test",
        MAESTRO_BRAIN_API_KEY: "brain_api_secret",
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://brain.example.test/api/brain.notes.submit",
      expect.objectContaining({ body: JSON.stringify({ input }) }),
    );
  });

  it("submits a Markdown snapshot directory to review in stable path order", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-brain-snapshot-"));
    mkdirSync(join(root, "team"));
    writeFileSync(join(root, "z-pricing.md"), "# Pricing\n\nMargin guidance.");
    writeFileSync(join(root, "team", "icp.md"), "# ICP\n\nAgency operators.");
    writeFileSync(join(root, "ignored.txt"), "not imported");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          input: { title: string };
        };
        return new Response(
          JSON.stringify({
            ok: true,
            operationId: "brain.notes.submit",
            result: {
              sourceKey: `src_${request.input.title.toLowerCase().padEnd(64, "a").slice(0, 64)}`,
              status: "pending_review",
            },
          }),
        );
      });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await runCliAsync(
        ["snapshot", "submit", root],
        decodeCliRuntimeConfig({
          CONVEX_SITE_URL: "https://brain.example.test",
          MAESTRO_BRAIN_API_KEY: "brain_api_secret",
        }),
      );

      expect(result.exitCode).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const requests = fetchMock.mock.calls.map((call) =>
        JSON.parse(String(call[1]?.body)),
      );
      expect(requests.map((request) => request.input.title)).toEqual([
        "ICP",
        "Pricing",
      ]);
      expect(
        parseStdout<{
          result: { submittedCount: number; status: string };
        }>(result).result,
      ).toMatchObject({ submittedCount: 2, status: "pending_review" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    { argv: ["ask"], message: "ask requires a question.\n" },
    { argv: ["search"], message: "search requires a query.\n" },
    {
      argv: ["source", "one", "two"],
      message: "source requires one source revision key.\n",
    },
    { argv: ["health", "extra"], message: "health takes no arguments.\n" },
    {
      argv: ["feedback", "--input", "{}"],
      message: "feedback requires --input and --idempotency-key.\n",
    },
    {
      argv: ["note", "--input", '{"title":"Missing markdown"}'],
      message: 'note requires --input with string "title" and "markdown".\n',
    },
  ])("validates terminal command $argv", async ({ argv, message }) => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    expect(await runCliAsync(argv)).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: message,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls an allowed Brain operation with bearer authentication", async () => {
    const transcriptEntry = {
      sourceKey: `sunit_${"a".repeat(64)}`,
      sourceRevisionKey: `surev_${"b".repeat(64)}`,
      citationKey: "citation:call_1:segment_1",
      title: "Acme weekly",
      excerpt: "We will launch on Friday.",
      locator: "timestamp:12000-15400",
      citationLabel: "Alex · 00:12",
      permalink: "https://app.fireflies.ai/view/call_1",
      freshness: "fresh",
      state: "resolved",
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          operationId: "brain.context.get",
          result: { entries: [transcriptEntry] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runCliAsync(
      [
        "api",
        "call",
        "brain.context.get",
        "--input",
        '{"pageKeys":["page_1"]}',
      ],
      decodeCliRuntimeConfig({
        CONVEX_SITE_URL: "https://brain.example.test",
        MAESTRO_BRAIN_API_KEY: "brain_api_secret",
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(parseStdout<Record<string, unknown>>(result)).toMatchObject({
      ok: true,
      operationId: "brain.context.get",
      result: { entries: [transcriptEntry] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://brain.example.test/api/brain.context.get",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer brain_api_secret",
          "content-type": "application/json",
        },
        redirect: "error",
      }),
    );
    expect(
      JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string),
    ).toEqual({ input: { pageKeys: ["page_1"] } });
  });

  it("prints the server-evaluated Brain rollout status", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          operationId: "brain.rollout.status",
          result: {
            statusVersion: 1,
            freshness: "current",
            coverageStatus: "complete",
            readiness: "ready",
            promotionReady: true,
            scopes: [],
            alerts: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runCliAsync(
      ["api", "call", "brain.rollout.status", "--input", "{}"],
      decodeCliRuntimeConfig({
        CONVEX_SITE_URL: "https://brain.example.test",
        MAESTRO_BRAIN_API_KEY: "brain_api_secret",
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(parseStdout<Record<string, unknown>>(result)).toMatchObject({
      ok: true,
      operationId: "brain.rollout.status",
      result: {
        freshness: "current",
        coverageStatus: "complete",
        readiness: "ready",
        promotionReady: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://brain.example.test/api/brain.rollout.status",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns typed Brain failures from successful HTTP responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: { _tag: "Forbidden", message: "Forbidden." },
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await runCliAsync(
      ["api", "call", "brain.context.get", "--input", "{}"],
      decodeCliRuntimeConfig({
        CONVEX_SITE_URL: "https://brain.example.test",
        MAESTRO_BRAIN_API_KEY: "brain_api_secret",
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(parseStdout<Record<string, unknown>>(result)).toMatchObject({
      ok: false,
      error: { _tag: "Forbidden" },
    });
  });

  it("redacts the Brain key from remote failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              _tag: "ValidationFailed",
              message: "brain_api_secret must not be exposed",
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await runCliAsync(
      ["api", "call", "brain.context.get", "--input", "{}"],
      decodeCliRuntimeConfig({
        CONVEX_SITE_URL: "https://brain.example.test",
        MAESTRO_BRAIN_API_KEY: "brain_api_secret",
      }),
    );

    expect(JSON.stringify(result)).not.toContain("brain_api_secret");
  });

  it("does not leak the Brain key on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("brain_api_secret")),
    );

    const result = await runCliAsync(
      ["api", "call", "brain.context.get", "--input", "{}"],
      decodeCliRuntimeConfig({
        CONVEX_SITE_URL: "https://brain.example.test",
        MAESTRO_BRAIN_API_KEY: "brain_api_secret",
      }),
    );

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Brain API request failed.\n",
    });
    expect(JSON.stringify(result)).not.toContain("brain_api_secret");
  });

  it.each([
    "http://brain.example.test",
    " https://brain.example.test",
    "https://user:password@brain.example.test",
    "https://brain.example.test/api",
    "https://brain.example.test?key=brain_api_secret",
    "https://brain.example.test#fragment",
  ])("rejects unsafe Brain site URL %s", async (siteUrl) => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runCliAsync(
      ["api", "call", "brain.context.get", "--input", "{}"],
      decodeCliRuntimeConfig({
        CONVEX_SITE_URL: siteUrl,
        MAESTRO_BRAIN_API_KEY: "brain_api_secret",
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("brain_api_secret");
  });

  it("rejects blank or whitespace-contaminated Brain keys", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    for (const brainApiKey of ["", " brain_api_secret "]) {
      const result = await runCliAsync(
        ["api", "call", "brain.context.get", "--input", "{}"],
        decodeCliRuntimeConfig({
          CONVEX_SITE_URL: "https://brain.example.test",
          MAESTRO_BRAIN_API_KEY: brainApiKey,
        }),
      );

      expect(result.exitCode).toBe(1);
      if (brainApiKey.trim()) {
        expect(JSON.stringify(result)).not.toContain(brainApiKey.trim());
      }
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows localhost Brain site URLs", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await runCliAsync(
      ["api", "call", "brain.context.get", "--input", "{}"],
      decodeCliRuntimeConfig({
        CONVEX_SITE_URL: "http://localhost:3210",
        MAESTRO_BRAIN_API_KEY: "brain_api_secret",
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3210/api/brain.context.get",
      expect.any(Object),
    );
  });

  it("rejects tenant selectors and Brain write operations locally", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const config = decodeCliRuntimeConfig({
      CONVEX_SITE_URL: "https://brain.example.test",
      MAESTRO_BRAIN_API_KEY: "brain_api_secret",
    });

    const selectorResult = await runCliAsync(
      ["api", "call", "brain.context.get", "--input", '{"brainKey":"other"}'],
      config,
    );
    const writeResult = await runCliAsync(
      ["api", "call", "brain.pages.createMarkdown", "--input", "{}"],
      config,
    );

    expect(selectorResult.exitCode).toBe(1);
    expect(writeResult.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("describes the shared workflow template", () => {
    const result = runCli(["describe"]);

    expect(result.exitCode).toBe(0);
    const operations = parseStdout<readonly HeadlessOperation[]>(
      runCli(["operations", "list"]),
    );

    expect(parseStdout<Record<string, unknown>>(result)).toMatchObject({
      valid: true,
      capabilityCount: confectManifest.functions.length,
      headlessOperationCount: operations.length,
    });
  });

  it("omits the retired Brain page operation and lists current surfaces", () => {
    const operations = parseStdout<readonly HeadlessOperation[]>(
      runCli(["operations", "list"]),
    );

    expect(operations.length).toBeGreaterThan(0);
    expect(operations).not.toContainEqual(
      expect.objectContaining({ id: "api:brain.pages.createMarkdown" }),
    );
    expect(operations).toContainEqual(
      expect.objectContaining({ id: "web:brain.pages.list" }),
    );
    expect(operations).toContainEqual(
      expect.objectContaining({ id: "web:brain.pages.get" }),
    );
    expect(operations).toContainEqual(
      expect.objectContaining({ id: "api:brain.pages.list" }),
    );
    expect(operations).toContainEqual(
      expect.objectContaining({ id: "mcp:brain.pages.list" }),
    );
    expect(
      runCli(["operations", "get", "api:brain.pages.createMarkdown"]),
    ).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Unknown operation: api:brain.pages.createMarkdown\n",
    });
    expect(
      parseStdout<readonly TemplateApiResult[]>(runCli(["api", "catalog"])),
    ).not.toContainEqual(
      expect.objectContaining({ operationId: "brain.pages.createMarkdown" }),
    );
    expect(
      parseStdout<OpenApiDocument>(runCli(["api", "openapi"])).paths,
    ).not.toHaveProperty("/api/brain.pages.createMarkdown");
    expect(
      parseStdout<readonly { readonly name: string }[]>(
        runCli(["mcp", "tools"]),
      ),
    ).not.toContainEqual(
      expect.objectContaining({ name: "template.brain.pages.createMarkdown" }),
    );
  });

  it("calls MCP tools through the shared workflow registry", () => {
    const result = runCli(["mcp", "call", "template.workflow.run"]);
    const call = parseStdout<McpToolCallResult>(result);

    expect(result.exitCode).toBe(0);
    expect(call.isError).toBe(false);
    expect(
      JSON.parse(call.content[0]?.text ?? "{}") as WorkflowReceiptPayload,
    ).toMatchObject({
      runId: "run_template_001",
      workflowRunId: "run_template_001",
      trustReceiptId: "trust_run_template_001",
      trustReceipt: {
        receiptId: "trust_run_template_001",
      },
    });
  });

  it("prints integration readiness without requiring live secrets", () => {
    const report = parseStdout<readonly ProviderConfigReport[]>(
      runCli(["integrations", "report", "fake"]),
    );

    expect(report).toContainEqual(
      expect.objectContaining({
        id: "workos",
        displayName: "WorkOS/AuthKit",
        mode: "fake",
        ready: true,
      }),
    );
  });

  it("reports live integration readiness from decoded provider env only", () => {
    const config = decodeCliRuntimeConfig({
      WORKOS_API_KEY: "workos_key",
      WORKOS_CLIENT_ID: "workos_client",
      IGNORED_SECRET: "do-not-forward",
    });
    const report = parseStdout<readonly ProviderConfigReport[]>(
      runCli(["integrations", "report", "live"], config),
    );

    expect(report).toContainEqual(
      expect.objectContaining({
        id: "workos",
        mode: "live",
        ready: true,
      }),
    );
    expect(config.providerEnv).not.toHaveProperty("IGNORED_SECRET");
  });

  it("reports whitespace-contaminated live provider env names without leaking values", () => {
    const config = decodeCliRuntimeConfig({
      WORKOS_API_KEY: " workos_secret ",
      WORKOS_CLIENT_ID: "workos_client",
    });
    const report = parseStdout<readonly ProviderConfigReport[]>(
      runCli(["integrations", "report", "live"], config),
    );

    expect(report).toContainEqual(
      expect.objectContaining({
        id: "workos",
        mode: "live",
        ready: false,
        missingEnv: [],
        invalidEnv: ["WORKOS_API_KEY"],
      }),
    );
    expect(JSON.stringify(report)).not.toContain("workos_secret");
  });

  it("runs the sample workflow and prints a trust receipt", () => {
    const receipt = parseStdout<WorkflowReceiptPayload>(
      runCli(["workflow", "run"]),
    );

    expect(receipt).toMatchObject({
      runId: "run_template_001",
      workflowRunId: "run_template_001",
      trustReceiptId: "trust_run_template_001",
      status: "completed",
      trustReceipt: {
        receiptId: "trust_run_template_001",
      },
    });
  });

  it("parses workflow args after the workflow run subcommand", () => {
    expect(
      parseStdout<WorkflowReceiptPayload>(
        runCli(["workflow", "run", "--idempotency-key", "workflow-slice"]),
      ),
    ).toMatchObject({
      runId: "run_workflow-slice",
      idempotencyKey: "workflow-slice",
    });
  });

  it("uses workflow run args when provided", () => {
    const receipt = parseStdout<WorkflowReceiptPayload>(
      runCli([
        "workflow",
        "run",
        "--workflow",
        "workflow_custom_plan",
        "--workspace",
        "reviewer-brain",
        "--idempotency-key",
        "run-42",
        "--mode",
        "fake",
      ]),
    );

    expect(receipt).toMatchObject({
      runId: "run_run-42",
      workflowRunId: "run_run-42",
      workflowId: "workflow_custom_plan",
      workspaceSlug: "reviewer-brain",
      mode: "fake",
      trustReceiptId: "trust_run_run-42",
      trustReceipt: {
        receiptId: "trust_run_run-42",
        workflowRunId: "run_run-42",
      },
    });
  });

  it("accepts inline workflow run args", () => {
    const receipt = parseStdout<WorkflowReceiptPayload>(
      runCli([
        "workflow",
        "run",
        "--workflow=workflow_inline_plan",
        "--workspace=inline-brain",
        "--idempotency-key=run=43",
        "--mode=",
        '--input={"topic":"inline"}',
      ]),
    );

    expect(receipt).toMatchObject({
      runId: "run_run=43",
      workflowId: "workflow_inline_plan",
      workspaceSlug: "inline-brain",
      idempotencyKey: "run=43",
      mode: "",
      input: { topic: "inline" },
    });
  });

  it("reports named arg parse errors", () => {
    expect(runCli(["workflow", "run", "--workflow"])).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "--workflow requires a value.\n",
    });
    expect(runCli(["workflow", "run", "--nope"])).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Unknown option: --nope\n",
    });
    expect(runCli(["workflow", "run", "--input", "[]"])).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "--input must be a JSON object.\n",
    });
  });

  it("rejects removed Brain page CLI capability", () => {
    expect(runCli(["capability", "run", "brain.pages.createMarkdown"])).toEqual(
      {
        exitCode: 1,
        stdout: "",
        stderr: "Unknown CLI capability: brain.pages.createMarkdown\n",
      },
    );
  });

  it("rejects unknown CLI capabilities before parsing request args", () => {
    expect(runCli(["capability", "run", "not.real"])).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Unknown CLI capability: not.real\n",
    });
  });

  it("returns a clear error for unknown operations", () => {
    const result = runCli(["operations", "get", "cli:nope"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Unknown operation: cli:nope\n",
    });
  });
});
