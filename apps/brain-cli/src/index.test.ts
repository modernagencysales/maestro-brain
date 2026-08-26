import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli, type CliDependencies } from "./index.js";

const temp = (): string => mkdtempSync(join(tmpdir(), "brain-cli-test-"));

const dependencies = (
  root: string,
  fetch: typeof globalThis.fetch = vi.fn(),
): CliDependencies => ({
  cwd: root,
  configDirectory: join(root, "config"),
  assetDirectory: join(root, "assets", "ask-apero"),
  environment: {},
  fetch,
  now: () => 1_777_777_777_777,
  platform: "linux",
  nodeVersion: "v22.18.0",
  linkAccount: vi.fn(),
});

const configured = (root: string): CliDependencies => {
  const deps = dependencies(root);
  mkdirSync(deps.configDirectory, { recursive: true });
  writeFileSync(
    join(deps.configDirectory, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      appUrl: "https://app.example.test",
      apiUrl: "https://api.example.test",
      workspaceSlug: "apero",
      apiKey: "secret-key",
    }),
  );
  return deps;
};

describe("standalone teammate CLI", () => {
  it("documents the complete teammate workflow", async () => {
    const result = await runCli(["--help"], dependencies(temp()));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("maestro-brain setup");
    expect(result.stdout).toContain("page create");
    expect(result.stdout).toContain("import <folder>");
    expect(result.stdout).toContain("bug-bundle");
  });

  it("sets up all three agent runtimes and the Ask Apero skill", async () => {
    const root = temp();
    const deps = dependencies(root);
    mkdirSync(deps.assetDirectory, { recursive: true });
    writeFileSync(join(deps.assetDirectory, "SKILL.md"), "# Ask Apero\n");
    const result = await runCli(
      ["setup", "--workspace", "apero", "--api-key", "secret-key"],
      deps,
    );
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(root, ".codex/config.toml"), "utf8")).toContain(
      "https://perfect-sparrow-808.convex.site/mcp",
    );
    expect(readFileSync(join(root, ".mcp.json"), "utf8")).toContain(
      "maestro-brain",
    );
    expect(
      readFileSync(join(root, ".cowork/maestro-brain.json"), "utf8"),
    ).toContain("streamable-http");
    expect(
      readFileSync(join(root, ".agents/skills/ask-apero/SKILL.md"), "utf8"),
    ).toContain("Ask Apero");
    expect(result.stdout).not.toContain("secret-key");
    expect(
      (
        await runCli(
          ["setup", "--workspace", "apero", "--api-key", "secret-key"],
          deps,
        )
      ).exitCode,
    ).toBe(0);
  });

  it("links through the browser callback flow and provides shell integration", async () => {
    const root = temp();
    const deps = dependencies(root);
    mkdirSync(deps.assetDirectory, { recursive: true });
    writeFileSync(join(deps.assetDirectory, "SKILL.md"), "# Ask Apero\n");
    const linkAccount = vi.fn().mockResolvedValue({
      key: "linked-key",
      workspace: "apero",
      origin: "https://perfect-sparrow-808.convex.site",
    });
    expect((await runCli(["setup"], { ...deps, linkAccount })).exitCode).toBe(
      0,
    );
    expect(linkAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        siteOrigin: "https://maestro-brain-staging.tim-bb0.workers.dev",
        apiOrigin: "https://perfect-sparrow-808.convex.site",
      }),
    );
    expect((await runCli(["env"], deps)).stdout).toBe(
      "export MAESTRO_BRAIN_API_KEY='linked-key'\n",
    );
  });

  it("asks through the current assistant API contract", async () => {
    const root = temp();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { answerMarkdown: "Agency ICP" },
        }),
      ),
    );
    const result = await runCli(["ask", "What is our ICP?"], {
      ...configured(root),
      fetch,
    });
    expect(result.exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/agents.assistant.answerQuestion",
      expect.objectContaining({
        body: JSON.stringify({
          workspaceSlug: "apero",
          input: { question: "What is our ICP?" },
        }),
      }),
    );
  });

  it("maps page list, get, create, and update to current API operations", async () => {
    const root = temp();
    const note = join(root, "positioning.md");
    writeFileSync(note, "# Positioning\n\nTrusted context.");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        async () => new Response(JSON.stringify({ ok: true, result: [] })),
      );
    const deps = { ...configured(root), fetch };
    expect((await runCli(["page", "list"], deps)).exitCode).toBe(0);
    expect((await runCli(["page", "get", "page_1"], deps)).exitCode).toBe(0);
    expect(
      (await runCli(["page", "create", note, "--slug", "positioning"], deps))
        .exitCode,
    ).toBe(0);
    expect(
      (
        await runCli(
          ["page", "update", "page_1", note, "--expected-updated-at", "123"],
          deps,
        )
      ).exitCode,
    ).toBe(0);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.example.test/api/brain.pages.list",
      "https://api.example.test/api/brain.pages.get",
      "https://api.example.test/api/brain.pages.createMarkdown",
      "https://api.example.test/api/brain.pages.updateMarkdown",
    ]);
  });

  it("imports Markdown recursively in stable relative-path order", async () => {
    const root = temp();
    const folder = join(root, "brain");
    mkdirSync(join(folder, "team"), { recursive: true });
    writeFileSync(join(folder, "z.md"), "# Zed\n");
    writeFileSync(join(folder, "team", "a.md"), "# Alpha\n");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        async () => new Response(JSON.stringify({ ok: true, result: "page" })),
      );
    const result = await runCli(["import", folder], {
      ...configured(root),
      fetch,
    });
    expect(result.exitCode).toBe(0);
    const bodies = fetch.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(bodies.map((body) => body.input.title)).toEqual(["Alpha", "Zed"]);
  });

  it("creates a redacted, allowlisted bug bundle", async () => {
    const root = temp();
    const deps = configured(root);
    const output = join(root, "bug.json");
    const result = await runCli(["bug-bundle", "--output", output], deps);
    expect(result.exitCode).toBe(0);
    const bundle = readFileSync(output, "utf8");
    expect(bundle).toContain('"apiKeyPresent": true');
    expect(bundle).not.toContain("secret-key");
  });

  it("reports status, logout limits, version, and update guidance", async () => {
    const root = temp();
    const deps = configured(root);
    expect((await runCli(["status"], deps)).stdout).not.toContain("secret-key");
    expect((await runCli(["version"], deps)).stdout).toBe("0.1.0\n");
    expect((await runCli(["update"], deps)).stdout).toContain(
      "@modernagencysales/maestro-brain@latest",
    );
    const logout = await runCli(["logout"], deps);
    expect(logout.stdout).toContain('"revoked": false');
    expect(existsSync(join(deps.configDirectory, "config.json"))).toBe(false);
  });

  it("checks both API and HTTP MCP in doctor and exposes MCP troubleshooting", async () => {
    const root = temp();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith("/mcp")
          ? new Response(
              '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}',
            )
          : new Response(JSON.stringify({ ok: true, result: [] })),
      );
    const deps = { ...configured(root), fetch };
    expect((await runCli(["doctor"], deps)).exitCode).toBe(0);
    expect((await runCli(["mcp", "tools"], deps)).exitCode).toBe(0);
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/mcp"))).toBe(
      true,
    );

    const rejected = await runCli(["doctor"], {
      ...configured(temp()),
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async (url) =>
          String(url).endsWith("/mcp")
            ? new Response(
                '{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}',
              )
            : new Response(JSON.stringify({ ok: true, result: [] })),
        ),
    });
    expect(rejected.exitCode).toBe(1);
  });
});
