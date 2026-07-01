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
    expect(JSON.parse(runCli(["mcp", "tools"]).stdout)).toContainEqual(
      expect.objectContaining({ name: "template.resolveSourceSet" }),
    );
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
