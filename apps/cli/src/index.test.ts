import { describe, expect, it } from "vitest";
import { runCli } from "./index";

describe("maestro-template CLI", () => {
  it("describes the shared workflow template", () => {
    const result = runCli(["describe"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: true,
      capabilityCount: 3,
      headlessOperationCount: 9,
    });
  });

  it("lists and gets headless operations", () => {
    const list = runCli(["operations", "list"]);
    const get = runCli(["operations", "get", "CLI:createTrustReceipt"]);

    expect(JSON.parse(list.stdout)).toHaveLength(9);
    expect(JSON.parse(get.stdout)).toMatchObject({
      surface: "CLI",
      capability: "createTrustReceipt",
      authScope: "audited write",
    });
  });

  it("prints API and MCP metadata", () => {
    expect(JSON.parse(runCli(["api", "catalog"]).stdout)).toContainEqual(
      expect.objectContaining({
        operationId: "resolveSourceSet",
        path: "/api/resolveSourceSet",
      }),
    );
    expect(JSON.parse(runCli(["api", "openapi"]).stdout)).toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/api/resolveSourceSet": {
          post: {
            operationId: "resolveSourceSet",
            "x-maestro-auth-scope": "workspace member",
            "x-maestro-typed-errors": [
              "Unauthorized",
              "WorkspaceNotFound",
              "ValidationFailed",
            ],
          },
        },
      },
    });
    expect(JSON.parse(runCli(["mcp", "tools"]).stdout)).toContainEqual(
      expect.objectContaining({ name: "template.resolveSourceSet" }),
    );
  });

  it("prints integration readiness without requiring live secrets", () => {
    const report = JSON.parse(
      runCli(["integrations", "report", "fake"]).stdout,
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

  it("runs the sample workflow and prints a trust receipt", () => {
    const receipt = JSON.parse(runCli(["workflow", "run"]).stdout);

    expect(receipt).toMatchObject({
      runId: "run_template_001",
      status: "completed",
      trustReceipt: {
        receiptId: "receipt_template_001",
      },
    });
  });

  it("returns a clear error for unknown operations", () => {
    const result = runCli(["operations", "get", "CLI:nope"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Unknown operation: CLI:nope\n",
    });
  });
});
