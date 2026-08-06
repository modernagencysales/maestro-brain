import { confectManifest } from "@maestro-template/template-core/generated/confectManifest";
import { describe, expect, it } from "vitest";
import {
  buildApiCatalog,
  buildGeneratedMcpTools,
  generatedMcpOperationRefs,
  buildHeadlessOperations,
  buildMcpTools,
  buildOpenApiDocument,
  callMcpTool,
  describeWorkflowTemplate,
  getHeadlessOperation,
  runTemplateApiOperation,
  runTemplateWorkflow,
} from "./index";

describe("workflow headless registry", () => {
  it("omits the retired Brain page operation and exposes current page surfaces", () => {
    const operations = buildHeadlessOperations();
    const ids = operations.map((operation) => operation.id);

    expect(operations.length).toBeGreaterThan(0);
    expect(ids).not.toContain("api:brain.pages.createMarkdown");
    expect(ids).not.toContain("cli:brain.pages.createMarkdown");
    expect(ids).not.toContain("mcp:brain.pages.createMarkdown");
    expect(ids).toContain("web:brain.pages.list");
    expect(ids).toContain("api:brain.pages.list");
    expect(ids).toContain("mcp:brain.pages.list");
    expect(ids).toContain("web:brain.pages.get");
    expect(ids).toContain("web:ops.dataLifecycle.createDsarRequest");
    expect(ids).toContain("workflow:capabilities.sourceGroundedBrief.run");
    expect(
      getHeadlessOperation("api:brain.pages.createMarkdown"),
    ).toBeUndefined();
    expect(getHeadlessOperation("web:brain.pages.list")).toBeDefined();
  });

  it("describes the template workflow with manifest-derived contract counts", () => {
    const operations = buildHeadlessOperations();
    const description = describeWorkflowTemplate();

    expect(description).toEqual({
      valid: true,
      validationErrors: [],
      nodeCount: 5,
      edgeCount: 4,
      capabilityCount: confectManifest.functions.length,
      agentCount: 3,
      headlessOperationCount: operations.length,
    });
  });

  it("omits only the legacy Brain page operation from API and MCP metadata", () => {
    expect(buildApiCatalog()).not.toContainEqual(
      expect.objectContaining({ operationId: "brain.pages.createMarkdown" }),
    );
    expect(buildGeneratedMcpTools()).not.toContainEqual(
      expect.objectContaining({ name: "template.brain.pages.createMarkdown" }),
    );
    expect(generatedMcpOperationRefs).not.toHaveProperty(
      "brain.pages.createMarkdown",
    );
    expect(Object.keys(buildOpenApiDocument().paths)).not.toContain(
      "/api/brain.pages.createMarkdown",
    );
    expect(buildMcpTools()).toContainEqual({
      name: "template.workflow.run",
      description: "Run the template workflow compatibility adapter.",
      inputSchema: expect.objectContaining({
        type: "object",
        additionalProperties: false,
      }),
      typedErrors: [],
    });
  });

  it("exports generated MCP operation refs for current Brain page tools", () => {
    const generatedTools = buildGeneratedMcpTools();

    expect(Object.keys(generatedMcpOperationRefs).length).toBe(
      generatedTools.length,
    );
    for (const tool of generatedTools) {
      const operationId = tool.name.replace(/^template\./, "");

      expect(generatedMcpOperationRefs[operationId]).toBe(tool.name);
    }
    expect(generatedTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "template.brain.pages.list",
        "template.brain.pages.get",
        "template.brain.pages.history",
      ]),
    );
  });

  it("returns NotFound for removed Brain page headless operations", () => {
    expect(
      runTemplateApiOperation("brain.pages.createMarkdown", {
        workspaceSlug: "acme-demo",
        input: { title: "A note", markdown: "# A note" },
        idempotencyKey: "receipt-example-001",
      }),
    ).toEqual({
      ok: false,
      error: {
        _tag: "NotFound",
        message: "Unknown template API operation: brain.pages.createMarkdown",
      },
    });
    expect(callMcpTool("template.brain.pages.createMarkdown").isError).toBe(
      true,
    );
  });

  it("returns a deterministic run receipt for the template workflow", () => {
    expect(runTemplateWorkflow()).toMatchObject({
      runId: "run_template_001",
      workflowRunId: "run_template_001",
      workflowId: "workflow_source_grounded_plan",
      workflowName: "Source-grounded planning workflow",
      status: "completed",
      trustReceiptId: "trust_run_template_001",
      trustReceipt: {
        receiptId: "trust_run_template_001",
      },
    });
  });

  it("invokes every advertised generated MCP tool through the shared registry", () => {
    for (const { name } of buildGeneratedMcpTools())
      expect(callMcpTool(name).isError).toBe(false);
  });

  it("invokes the workflow MCP compatibility tool", () => {
    const workflowResult = callMcpTool("template.workflow.run");

    expect(workflowResult.isError).toBe(false);
    expect(JSON.parse(workflowResult.content[0]?.text ?? "{}")).toMatchObject({
      runId: "run_template_001",
      workflowRunId: "run_template_001",
      trustReceiptId: "trust_run_template_001",
    });
  });

  it("returns a structured MCP error for unknown tools", () => {
    const result = callMcpTool("template.nope");

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      ok: false,
      error: {
        _tag: "ToolNotFound",
        message: "Unknown MCP tool: template.nope",
      },
    });
  });
});
