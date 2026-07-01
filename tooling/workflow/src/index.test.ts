import { describe, expect, it } from "vitest";
import {
  buildApiCatalog,
  buildHeadlessOperations,
  buildMcpTools,
  buildOpenApiDocument,
  describeWorkflowTemplate,
  getHeadlessOperation,
  runTemplateWorkflow,
} from "./index";

describe("workflow headless registry", () => {
  it("projects every capability to every headless surface", () => {
    const operations = buildHeadlessOperations();

    expect(operations).toHaveLength(9);
    expect(operations.map((operation) => operation.id)).toContain(
      "Scalar API:resolveSourceSet",
    );
    expect(
      operations.every((operation) => operation.typedErrors.length > 0),
    ).toBe(true);
  });

  it("describes the template workflow with validation status", () => {
    expect(describeWorkflowTemplate()).toEqual({
      valid: true,
      validationErrors: [],
      nodeCount: 5,
      edgeCount: 4,
      capabilityCount: 3,
      agentCount: 3,
      headlessOperationCount: 9,
    });
  });

  it("looks up a single operation by stable id", () => {
    expect(getHeadlessOperation("CLI:createTrustReceipt")).toMatchObject({
      surface: "CLI",
      capability: "createTrustReceipt",
      authScope: "audited write",
    });
  });

  it("projects API and MCP metadata from the same operation registry", () => {
    expect(buildApiCatalog()).toContainEqual({
      operationId: "createTrustReceipt",
      method: "POST",
      path: "/api/createTrustReceipt",
      authScope: "audited write",
      typedErrors: ["Unauthorized", "ConfigInvalid", "ValidationFailed"],
    });

    expect(buildMcpTools()).toContainEqual({
      name: "template.createTrustReceipt",
      description:
        "Invoke createTrustReceipt through the shared template registry.",
      typedErrors: ["Unauthorized", "ConfigInvalid", "ValidationFailed"],
    });
  });

  it("builds an OpenAPI document from the shared API catalog", () => {
    const document = buildOpenApiDocument();

    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths)).toEqual([
      "/api/resolveSourceSet",
      "/api/buildContextPack",
      "/api/createTrustReceipt",
    ]);
    const createTrustReceipt = document.paths["/api/createTrustReceipt"]?.post;

    expect(createTrustReceipt).toMatchObject({
      operationId: "createTrustReceipt",
      "x-maestro-auth-scope": "audited write",
      "x-maestro-typed-errors": [
        "Unauthorized",
        "ConfigInvalid",
        "ValidationFailed",
      ],
      security: [{ bearerAuth: ["audited write"] }],
    });

    if (!createTrustReceipt) {
      throw new Error("createTrustReceipt OpenAPI operation is missing");
    }

    const typedErrorResponse = createTrustReceipt.responses["400"];

    if (!typedErrorResponse) {
      throw new Error("createTrustReceipt typed error response is missing");
    }

    const typedErrorEnum =
      typedErrorResponse.content["application/json"].schema.properties?.error
        ?.properties?._tag?.enum;

    expect(typedErrorEnum).toEqual([
      "Unauthorized",
      "ConfigInvalid",
      "ValidationFailed",
    ]);
  });

  it("returns a deterministic run receipt for the template workflow", () => {
    expect(runTemplateWorkflow()).toMatchObject({
      runId: "run_template_001",
      workflowName: "Source-grounded planning workflow",
      status: "completed",
      trustReceipt: {
        receiptId: "receipt_template_001",
      },
    });
  });
});
