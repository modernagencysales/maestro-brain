import { confectManifest } from "@maestro-template/template-core/generated/confectManifest";
import { describe, expect, it } from "vitest";
import type {
  HeadlessOperation,
  McpToolCallResult,
  OpenApiDocument,
  TemplateApiResult,
} from "@maestro-template/workflow-tooling";
import type { ProviderConfigReport } from "@maestro-template/integrations";
import { decodeCliRuntimeConfig, runCli } from "./index";
import type { CliResult } from "./types";

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

  it("omits Brain page operations from headless metadata", () => {
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
