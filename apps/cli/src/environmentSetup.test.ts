import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  doctorBrainEnvironment,
  setupBrainEnvironment,
} from "./environmentSetup";
import { runCliAsync } from "./index";

const roots: string[] = [];

const makeRepo = (): string => {
  const root = mkdtempSync(join(tmpdir(), "maestro-brain-setup-"));
  roots.push(root);
  const skill = join(root, "company-context/skills/ask-apero");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: ask-apero\n---\n");
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
  vi.unstubAllGlobals();
});

describe("maestro-brain environment setup", () => {
  it("routes setup and doctor as strict no-argument terminal commands", async () => {
    await expect(runCliAsync(["setup", "extra"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "setup accepts codex, claude-code, or cowork.\n",
    });
    await expect(runCliAsync(["doctor", "extra"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "doctor takes no arguments.\n",
    });
  });

  it("installs only the selected runtime", () => {
    const repoRoot = makeRepo();
    const result = setupBrainEnvironment({
      repoRoot,
      siteUrl: "https://brain.example.test",
      runtime: "cowork",
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      next: [
        "Export MAESTRO_BRAIN_API_KEY in this terminal.",
        "Run pnpm brain doctor.",
      ],
    });
    expect(existsSync(join(repoRoot, ".cowork/maestro-brain.json"))).toBe(true);
    expect(existsSync(join(repoRoot, ".codex/config.toml"))).toBe(false);
    expect(existsSync(join(repoRoot, ".mcp.json"))).toBe(false);
  });

  it("generates secret-free Codex, Claude Code, and Cowork config plus shared skill links", () => {
    const repoRoot = makeRepo();
    const result = setupBrainEnvironment({
      repoRoot,
      siteUrl: "https://brain.example.test",
    });

    expect(result.exitCode).toBe(0);
    const codex = readFileSync(join(repoRoot, ".codex/config.toml"), "utf8");
    const claude = readFileSync(join(repoRoot, ".mcp.json"), "utf8");
    const cowork = readFileSync(
      join(repoRoot, ".cowork/maestro-brain.json"),
      "utf8",
    );
    expect(codex).toContain("[mcp_servers.maestro_brain]");
    expect(codex).toContain('bearer_token_env_var = "MAESTRO_BRAIN_API_KEY"');
    expect(JSON.parse(claude)).toMatchObject({
      mcpServers: {
        "maestro-brain": {
          type: "http",
          url: "https://brain.example.test/mcp",
          headers: {
            Authorization: "Bearer ${MAESTRO_BRAIN_API_KEY}",
          },
        },
      },
    });
    expect(JSON.parse(cowork)).toMatchObject({
      name: "maestro-brain",
      transport: {
        type: "streamable-http",
        url: "https://brain.example.test/mcp",
      },
      authentication: {
        scheme: "bearer",
        secretEnv: "MAESTRO_BRAIN_API_KEY",
      },
    });
    expect(`${codex}${claude}${cowork}`).not.toContain("brain_api_secret");

    for (const path of [
      ".agents/skills/ask-apero",
      ".claude/skills/ask-apero",
    ]) {
      const link = join(repoRoot, path);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(resolve(join(link, ".."), readlinkSync(link))).toBe(
        join(repoRoot, "company-context/skills/ask-apero"),
      );
    }
  });

  it("is idempotent and never overwrites conflicting files or skill destinations", () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, ".agents/skills/ask-apero"), { recursive: true });
    writeFileSync(join(repoRoot, ".mcp.json"), '{"ownedBy":"teammate"}\n');

    const first = setupBrainEnvironment({
      repoRoot,
      siteUrl: "https://brain.example.test",
    });
    const second = setupBrainEnvironment({
      repoRoot,
      siteUrl: "https://brain.example.test",
    });

    expect(first.exitCode).toBe(1);
    expect(second.exitCode).toBe(1);
    expect(
      JSON.parse(readFileSync(join(repoRoot, ".mcp.json"), "utf8")),
    ).toMatchObject({
      ownedBy: "teammate",
      mcpServers: { "maestro-brain": { type: "http" } },
    });
    expect(
      lstatSync(join(repoRoot, ".agents/skills/ask-apero")).isDirectory(),
    ).toBe(true);
    expect(first.stdout).toContain('"status": "conflict"');
    expect(first.stdout).not.toContain("brain_api_secret");
  });

  it("preserves unrelated Codex and Claude configuration", () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, ".codex"), { recursive: true });
    const existingCodex =
      'model = "gpt-5"\n\n[mcp_servers.existing]\nurl = "https://existing.example/mcp"\n';
    writeFileSync(join(repoRoot, ".codex/config.toml"), existingCodex);
    writeFileSync(
      join(repoRoot, ".mcp.json"),
      JSON.stringify({
        ownedBy: "teammate",
        mcpServers: {
          existing: { type: "http", url: "https://existing.example/mcp" },
        },
      }),
    );

    const first = setupBrainEnvironment({
      repoRoot,
      siteUrl: "https://brain.example.test",
    });
    const codexAfterFirst = readFileSync(
      join(repoRoot, ".codex/config.toml"),
      "utf8",
    );
    const claudeAfterFirst = readFileSync(join(repoRoot, ".mcp.json"), "utf8");
    const second = setupBrainEnvironment({
      repoRoot,
      siteUrl: "https://brain.example.test",
    });

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(codexAfterFirst.startsWith(existingCodex)).toBe(true);
    expect(codexAfterFirst).toContain("[mcp_servers.maestro_brain]");
    expect(readFileSync(join(repoRoot, ".codex/config.toml"), "utf8")).toBe(
      codexAfterFirst,
    );
    expect(JSON.parse(claudeAfterFirst)).toMatchObject({
      ownedBy: "teammate",
      mcpServers: {
        existing: { type: "http", url: "https://existing.example/mcp" },
        "maestro-brain": {
          type: "http",
          url: "https://brain.example.test/mcp",
        },
      },
    });
    expect(readFileSync(join(repoRoot, ".mcp.json"), "utf8")).toBe(
      claudeAfterFirst,
    );
  });

  it("refuses conflicting Maestro entries without overwriting them", () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, ".codex"), { recursive: true });
    const conflictingCodex =
      '[mcp_servers.maestro_brain]\nurl = "https://wrong.example/mcp"\nbearer_token_env_var = "OTHER_KEY"\n';
    const conflictingClaude = JSON.stringify({
      mcpServers: {
        "maestro-brain": {
          type: "http",
          url: "https://wrong.example/mcp",
        },
      },
    });
    writeFileSync(join(repoRoot, ".codex/config.toml"), conflictingCodex);
    writeFileSync(join(repoRoot, ".mcp.json"), conflictingClaude);

    const result = setupBrainEnvironment({
      repoRoot,
      siteUrl: "https://brain.example.test",
    });

    expect(result.exitCode).toBe(1);
    expect(readFileSync(join(repoRoot, ".codex/config.toml"), "utf8")).toBe(
      conflictingCodex,
    );
    expect(readFileSync(join(repoRoot, ".mcp.json"), "utf8")).toBe(
      conflictingClaude,
    );
    expect(JSON.parse(result.stdout).artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "codex.config", status: "conflict" }),
        expect.objectContaining({
          id: "claude-code.config",
          status: "conflict",
        }),
      ]),
    );
  });
});

describe("maestro-brain doctor", () => {
  it("validates the API, MCP initialize, prompts, and scoped tools", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        readonly id?: number;
        readonly method?: string;
      };
      if (String(url).endsWith("/api/brain.rollout.status")) {
        return new Response(JSON.stringify({ ok: true, result: {} }));
      }
      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: { prompts: {} },
              serverInfo: { name: "maestro-brain", version: "1" },
            },
          }),
        );
      }
      if (body.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                "answers.ask",
                "context.get",
                "sources.search",
                "sources.get",
              ].map((name) => ({
                name: `template.brain.${name}`,
                inputSchema: { type: "object", properties: {} },
              })),
            },
          }),
        );
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { prompts: [{ name: "ask-apero" }] },
        }),
      );
    });

    const result = await doctorBrainEnvironment(
      {
        brainSiteUrl: "https://brain.example.test",
        brainApiKey: "brain_api_secret",
        providerEnv: {},
      },
      fetchMock,
    );

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      readonly ok: boolean;
      readonly checks: readonly { readonly id: string; readonly ok: boolean }[];
    };
    expect(output.ok).toBe(true);
    expect(JSON.parse(result.stdout)).toMatchObject({
      next: ["pnpm brain health", 'pnpm brain ask "What is our ICP?"'],
    });
    expect(
      Object.fromEntries(output.checks.map(({ id, ok }) => [id, ok])),
    ).toMatchObject({
      api: true,
      "mcp.initialize": true,
      "mcp.prompts.list": true,
      "mcp.tools.list": true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toEqual(
        expect.objectContaining({ authorization: "Bearer brain_api_secret" }),
      );
    }
    expect(JSON.stringify(result)).not.toContain("brain_api_secret");
  });

  it("fails closed on invalid configuration without issuing a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await doctorBrainEnvironment(
      {
        brainSiteUrl: "https://brain.example.test/path",
        brainApiKey: " brain_api_secret ",
        providerEnv: {},
      },
      fetchMock,
    );

    expect(result.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      checks: [
        { id: "config.siteUrl", ok: false, status: "invalid" },
        { id: "config.apiKey", ok: false, status: "invalid" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("brain_api_secret");
  });

  it("fails when prompts/list does not advertise ask-apero", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("/api/"))
        return new Response(JSON.stringify({ ok: true }));
      const request = JSON.parse(String(init?.body)) as {
        readonly id: number;
        readonly method: string;
      };
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result:
            request.method === "initialize"
              ? {
                  protocolVersion: "2025-06-18",
                  serverInfo: { name: "maestro-brain" },
                }
              : request.method === "prompts/list"
                ? { prompts: [] }
                : { tools: [] },
        }),
      );
    });
    const result = await doctorBrainEnvironment(
      {
        brainSiteUrl: "https://brain.example.test",
        brainApiKey: "brain_api_secret",
        providerEnv: {},
      },
      fetchMock,
    );

    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout) as {
      readonly ok: boolean;
      readonly checks: readonly { readonly id: string; readonly ok: boolean }[];
    };
    expect(output.ok).toBe(false);
    expect(output.checks.find(({ id }) => id === "mcp.prompts.list")?.ok).toBe(
      false,
    );
    expect(JSON.stringify(result)).not.toContain("brain_api_secret");
  });

  it("rejects hosted tool schemas that expose tenant selectors", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("/api/"))
        return new Response(JSON.stringify({ ok: true }));
      const request = JSON.parse(String(init?.body)) as {
        readonly id: number;
        readonly method: string;
      };
      const result =
        request.method === "initialize"
          ? {
              protocolVersion: "2025-06-18",
              serverInfo: { name: "maestro-brain" },
            }
          : request.method === "prompts/list"
            ? { prompts: [{ name: "ask-apero" }] }
            : {
                tools: [
                  {
                    name: "template.brain.answers.ask",
                    inputSchema: {
                      type: "object",
                      properties: { brainKey: { type: "string" } },
                    },
                  },
                ],
              };
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
      );
    });

    const result = await doctorBrainEnvironment(
      {
        brainSiteUrl: "https://brain.example.test",
        brainApiKey: "brain_api_secret",
        providerEnv: {},
      },
      fetchMock,
    );

    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout) as {
      readonly ok: boolean;
      readonly checks: readonly { readonly id: string; readonly ok: boolean }[];
    };
    expect(output.ok).toBe(false);
    expect(output.checks.find(({ id }) => id === "mcp.tools.list")?.ok).toBe(
      false,
    );
  });
});
