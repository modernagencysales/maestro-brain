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

const legacyManagedAskAperoV2 = `---
name: ask-apero
description:
  Answer Apero company-context questions from canonical Maestro Brain evidence
  using exact source revisions, freshness, citations, and abstention. Use for
  Ask Apero research; do not use for provider actions or Brain writes.
metadata:
  contract-version: "2.0.0"
---

# Ask Apero

Use the configured \`maestro-brain\` HTTP MCP as the only company-context evidence
source.

1. Confirm \`template.brain.evidence.search\` and
   \`template.brain.evidence.sourceGet\` are available. If either is absent, stop
   and ask the user to run \`maestro-brain doctor\` and \`maestro-brain mcp tools\`
   from the same terminal used to launch the agent.
2. Search once with the user's complete question. Do not send a workspace,
   organization, user, client, or tenant selector; the bearer credential fixes
   scope.
3. If search returns no relevant evidence, abstain and name the missing source
   class. Do not answer from memory or fall back to repository files.
4. Reopen every material candidate with exact \`sourceKey\` and \`revisionKey\`
   using \`sourceGet\`. Reject a reopened source when the keys or content hash
   differ, or when it is a tombstone. A search excerpt alone is not sufficient
   evidence for a material claim.
5. Answer from the reopened Markdown. State material freshness limitations and
   label reasoning beyond the text as inference. Cite the title, provider,
   revision key, freshness, and stable locator when present.

Read [evidence reading](references/evidence-reading.md) when interpreting result
fields or deciding whether to abstain.

On a returned \`Unauthorized\` or \`Forbidden\`, stop and ask the user to rerun
setup with a current workspace credential. Distinguish that from a runtime tool
approval or MCP registration failure. Never call provider actions, page writes,
or other Brain mutation tools in this workflow.
`;

const legacyManagedEvidenceReadingV2 = `# Canonical Evidence Reading

Search results are candidate citations, not complete sources. Each result
contains the exact \`sourceKey\` and \`revisionKey\` needed for \`sourceGet\`, plus an
excerpt, provider, source timestamps, content hash, freshness, and an optional
stable locator.

Use the fields as follows:

- \`sourceModifiedAt\`: when the authoritative source changed;
- \`observedAt\`: when Maestro observed that revision;
- \`freshness\`: the server's current/review-due/stale classification;
- \`contentHash\`: integrity check between the candidate and exact revision;
- \`locator\`: provider or source link when disclosure is allowed;
- \`tombstone\`: the revision records removal and must not support a current
  factual claim.

Prefer a qualified partial answer only when missing or stale evidence cannot
change the supported portion. Otherwise abstain. When sources conflict, present
both with their exact revisions unless an explicit returned authority rule
resolves the conflict. Never infer freshness from the question time or index
time.
`;

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
  runProcess: vi.fn(() => ({ status: 0, signal: null })),
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
    expect(result.stdout).toContain("evidence search");
    expect(result.stdout).toContain("evidence source-get");
    expect(result.stdout).toContain("page create");
    expect(result.stdout).toContain("import <folder>");
    expect(result.stdout).toContain("bug-bundle");
  });

  it("shows subcommand help without executing the command", async () => {
    const root = temp();
    const deps = dependencies(root);
    const setup = await runCli(["setup", "--help"], deps);
    const nested = await runCli(["evidence", "search", "--help"], deps);

    expect(setup.exitCode).toBe(0);
    expect(setup.stdout).toContain("Usage: maestro-brain setup");
    expect(nested.stdout).toContain("evidence source-get");
    expect(deps.linkAccount).not.toHaveBeenCalled();
    expect(existsSync(join(deps.configDirectory, "config.json"))).toBe(false);
  });

  it("does not store credentials or partially write when setup finds a conflict", async () => {
    const root = temp();
    const deps = dependencies(root);
    mkdirSync(deps.assetDirectory, { recursive: true });
    writeFileSync(join(deps.assetDirectory, "SKILL.md"), "# Ask Apero\n");
    writeFileSync(join(root, ".mcp.json"), "not json\n");

    const result = await runCli(
      ["setup", "--workspace", "apero", "--api-key", "secret-key"],
      deps,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("No credential was stored");
    expect(existsSync(join(deps.configDirectory, "config.json"))).toBe(false);
    expect(existsSync(join(root, ".codex/config.toml"))).toBe(false);
    expect(readFileSync(join(root, ".mcp.json"), "utf8")).toBe("not json\n");
  });

  it("sets up all three agent runtimes and the Ask Apero skill", async () => {
    const root = temp();
    const deps = dependencies(root);
    mkdirSync(deps.assetDirectory, { recursive: true });
    writeFileSync(join(deps.assetDirectory, "SKILL.md"), "# Ask Apero\n");
    mkdirSync(join(deps.assetDirectory, "references"), { recursive: true });
    writeFileSync(
      join(deps.assetDirectory, "references", "evidence-reading.md"),
      "# Canonical Evidence Reading\n",
    );
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
    expect(
      readFileSync(
        join(root, ".agents/skills/ask-apero/references/evidence-reading.md"),
        "utf8",
      ),
    ).toContain("Canonical Evidence Reading");
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

  it("reruns setup around an existing managed Codex MCP block", async () => {
    const root = temp();
    const deps = dependencies(root);
    mkdirSync(deps.assetDirectory, { recursive: true });
    writeFileSync(join(deps.assetDirectory, "SKILL.md"), "# Ask Apero\n");
    expect(
      (
        await runCli(
          ["setup", "--workspace", "apero", "--api-key", "secret-key"],
          deps,
        )
      ).exitCode,
    ).toBe(0);
    const codexPath = join(root, ".codex/config.toml");
    writeFileSync(
      codexPath,
      `${readFileSync(codexPath, "utf8").trimEnd()}\n\n  [projects."/workspace"]\ntrust_level = "trusted"\n`,
    );

    const rerun = await runCli(
      ["setup", "--workspace", "apero", "--api-key", "secret-key"],
      deps,
    );

    expect(rerun.exitCode).toBe(0);
    const codex = readFileSync(codexPath, "utf8");
    expect(codex.match(/\[mcp_servers\.maestro_brain\]/gu)).toHaveLength(1);
    expect(codex).toContain('[projects."/workspace"]');
    expect(codex).toContain('trust_level = "trusted"');
  });

  it("does not treat a commented Codex MCP header as managed config", async () => {
    const root = temp();
    const deps = dependencies(root);
    mkdirSync(deps.assetDirectory, { recursive: true });
    writeFileSync(join(deps.assetDirectory, "SKILL.md"), "# Ask Apero\n");
    const codexDirectory = join(root, ".codex");
    mkdirSync(codexDirectory, { recursive: true });
    writeFileSync(
      join(codexDirectory, "config.toml"),
      '# [mcp_servers.maestro_brain]\nmodel = "gpt-5"\n',
    );

    const result = await runCli(
      ["setup", "--workspace", "apero", "--api-key", "secret-key"],
      deps,
    );

    expect(result.exitCode).toBe(0);
    const codex = readFileSync(join(codexDirectory, "config.toml"), "utf8");
    expect(codex).toContain("# [mcp_servers.maestro_brain]");
    expect(codex).toContain('model = "gpt-5"');
    expect(
      codex
        .split("\n")
        .filter((line) => line.trim() === "[mcp_servers.maestro_brain]"),
    ).toHaveLength(1);
  });

  it("upgrades an older managed Ask Apero skill without blocking setup", async () => {
    const root = temp();
    const deps = dependencies(root);
    mkdirSync(deps.assetDirectory, { recursive: true });
    writeFileSync(
      join(deps.assetDirectory, "SKILL.md"),
      '---\nname: ask-apero\nmetadata:\n  contract-version: "3.0.0"\n---\n\n# Current Ask Apero\n',
    );
    for (const skillRoot of [".agents/skills", ".claude/skills"]) {
      const installed = join(root, skillRoot, "ask-apero");
      mkdirSync(join(installed, "references"), { recursive: true });
      writeFileSync(join(installed, "SKILL.md"), legacyManagedAskAperoV2);
      writeFileSync(
        join(installed, "references/evidence-reading.md"),
        legacyManagedEvidenceReadingV2,
      );
    }

    const result = await runCli(
      ["setup", "--workspace", "apero", "--api-key", "secret-key"],
      deps,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"status": "updated"');
    expect(
      readFileSync(join(root, ".agents/skills/ask-apero/SKILL.md"), "utf8"),
    ).toContain('contract-version: "3.0.0"');
    expect(
      readFileSync(join(root, ".claude/skills/ask-apero/SKILL.md"), "utf8"),
    ).toContain('contract-version: "3.0.0"');
  });

  it("does not overwrite an unversioned user-authored Ask Apero skill", async () => {
    const root = temp();
    const deps = dependencies(root);
    mkdirSync(deps.assetDirectory, { recursive: true });
    writeFileSync(
      join(deps.assetDirectory, "SKILL.md"),
      '---\nname: ask-apero\nmetadata:\n  contract-version: "3.0.0"\n---\n',
    );
    const installed = join(root, ".agents/skills/ask-apero");
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, "SKILL.md"), "# My custom company skill\n");

    const result = await runCli(
      ["setup", "--workspace", "apero", "--api-key", "secret-key"],
      deps,
    );

    expect(result.exitCode).toBe(1);
    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe(
      "# My custom company skill\n",
    );
    expect(existsSync(join(deps.configDirectory, "config.json"))).toBe(false);
  });

  it("does not downgrade or overwrite an unknown versioned Ask Apero skill", async () => {
    const root = temp();
    const deps = dependencies(root);
    mkdirSync(deps.assetDirectory, { recursive: true });
    writeFileSync(
      join(deps.assetDirectory, "SKILL.md"),
      '---\nname: ask-apero\nmetadata:\n  contract-version: "3.0.0"\n---\n',
    );
    const installed = join(root, ".agents/skills/ask-apero");
    mkdirSync(installed, { recursive: true });
    const newer =
      '---\nname: ask-apero\nmetadata:\n  contract-version: "4.0.0"\n---\n\n# Newer custom skill\n';
    writeFileSync(join(installed, "SKILL.md"), newer);

    const result = await runCli(
      ["setup", "--workspace", "apero", "--api-key", "secret-key"],
      deps,
    );

    expect(result.exitCode).toBe(1);
    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe(newer);
    expect(existsSync(join(deps.configDirectory, "config.json"))).toBe(false);
  });

  it("does not overwrite a customized legacy skill reference", async () => {
    const root = temp();
    const deps = dependencies(root);
    mkdirSync(deps.assetDirectory, { recursive: true });
    writeFileSync(
      join(deps.assetDirectory, "SKILL.md"),
      '---\nname: ask-apero\nmetadata:\n  contract-version: "3.0.0"\n---\n',
    );
    const installed = join(root, ".agents/skills/ask-apero");
    mkdirSync(join(installed, "references"), { recursive: true });
    writeFileSync(join(installed, "SKILL.md"), legacyManagedAskAperoV2);
    const customized = `${legacyManagedEvidenceReadingV2}\n# My local rule\n`;
    writeFileSync(
      join(installed, "references/evidence-reading.md"),
      customized,
    );

    const result = await runCli(
      ["setup", "--workspace", "apero", "--api-key", "secret-key"],
      deps,
    );

    expect(result.exitCode).toBe(1);
    expect(
      readFileSync(join(installed, "references/evidence-reading.md"), "utf8"),
    ).toBe(customized);
    expect(existsSync(join(deps.configDirectory, "config.json"))).toBe(false);
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

  it("launches terminal agents with the stored MCP credential", async () => {
    const root = temp();
    const runProcess = vi.fn(() => ({ status: 0, signal: null }));
    const result = await runCli(["run", "--", "codex", "--full-auto"], {
      ...configured(root),
      runProcess,
    });
    expect(result.exitCode).toBe(0);
    expect(runProcess).toHaveBeenCalledWith(
      "codex",
      ["--full-auto"],
      expect.objectContaining({
        cwd: root,
        environment: expect.objectContaining({
          MAESTRO_BRAIN_API_KEY: "secret-key",
        }),
      }),
    );
    expect(result.stdout).not.toContain("secret-key");
  });

  it("asks through the current assistant API contract", async () => {
    const root = temp();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            status: "answered",
            answerMarkdown: "Agency ICP",
            contextPack: {
              evidenceMode: "mixed",
              freshness: "review-due",
              packHash: "sha256:pack",
              citations: [],
              conflicts: [{ reason: "possible-contradiction" }],
              omissions: [{ reason: "stale-high-risk", count: 2 }],
            },
          },
        }),
      ),
    );
    const result = await runCli(["ask", "What is our ICP?"], {
      ...configured(root),
      fetch,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Mode: mixed");
    expect(result.stdout).toContain("Freshness: review-due");
    expect(result.stdout).toContain("Conflicts: 1");
    expect(result.stdout).toContain("Omissions: stale-high-risk (2)");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/brain.ask",
      expect.objectContaining({
        body: JSON.stringify({
          workspaceSlug: "apero",
          input: { question: "What is our ICP?" },
        }),
      }),
    );
  });

  it("keeps --json out of the question and preserves the full API response", async () => {
    const root = temp();
    const response = {
      ok: true,
      result: {
        status: "answered",
        answerMarkdown: "Agency ICP [1]",
        contextPack: {
          schemaVersion: "4",
          packHash: "sha256:pack",
          citations: [
            {
              citationKey: "citation:1",
              sourceKey: "slack:channel:thread",
              revisionKey: "revision:1",
            },
          ],
        },
      },
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify(response)));
    const result = await runCli(["ask", "What is our ICP?", "--json"], {
      ...configured(root),
      fetch,
    });
    expect(result.exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/brain.ask",
      expect.objectContaining({
        body: JSON.stringify({
          workspaceSlug: "apero",
          input: { question: "What is our ICP?" },
        }),
      }),
    );
    expect(JSON.parse(result.stdout)).toEqual(response);
  });

  it("queues bounded knowledge extraction through the headless API", async () => {
    const root = temp();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, result: { scheduledCount: 3 } }),
        ),
      );
    const result = await runCli(["knowledge", "extract", "--limit", "3"], {
      ...configured(root),
      fetch,
    });
    expect(result.exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/brain.knowledge.extract",
      expect.objectContaining({
        body: JSON.stringify({
          workspaceSlug: "apero",
          input: { limit: 3 },
        }),
      }),
    );
  });

  it("explicitly saves a cited answer as a shared evaluation example", async () => {
    const root = temp();
    const packHash = `sha256:${"a".repeat(64)}`;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              status: "answered",
              answerMarkdown: "Friday [1]",
              contextPack: {
                packHash,
                evidenceMode: "recent_evidence",
                citations: [
                  {
                    sourceKey: "slack:C1:thread:1:segment:0",
                    revisionKey: "revision-1",
                    contentHash: "content-hash",
                  },
                ],
              },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: "example_1" })),
      );
    const result = await runCli(
      ["ask", "When", "does", "it", "launch?", "--save-example"],
      { ...configured(root), fetch },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Friday [1]");
    expect(result.stdout).toContain("Evaluation example saved.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://api.example.test/api/agents.assistant.saveEvaluationExample",
    );
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      workspaceSlug: "apero",
      idempotencyKey: `cli:${packHash}`,
      input: {
        exampleKey: `cli:${packHash}`,
        question: "When does it launch?",
        purpose: "company-question",
        evidenceMode: "recent_evidence",
        surface: "cli",
        answerStatus: "answered",
        packHash,
        evidenceReferences: [
          {
            sourceKey: "slack:C1:thread:1:segment:0",
            revisionKey: "revision-1",
            contentHash: "content-hash",
          },
        ],
        captureKind: "test",
        usefulness: "unrated",
      },
    });
  });

  it("searches canonical evidence and reopens an exact source revision over HTTP MCP", async () => {
    const root = temp();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          params: { name: string };
        };
        const result =
          request.params.name === "template.brain.evidence.search"
            ? [{ sourceKey: "drive:file-1", revisionKey: "revision-2" }]
            : {
                sourceKey: "drive:file-1",
                revisionKey: "revision-2",
                markdown: "# Exact evidence",
              };
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: true,
                    operationId: request.params.name.slice("template.".length),
                    result,
                  }),
                },
              ],
            },
          }),
        );
      });
    const deps = { ...configured(root), fetch };

    const searched = await runCli(
      ["evidence", "search", "approved", "positioning", "--limit", "5"],
      deps,
    );
    const opened = await runCli(
      ["evidence", "source-get", "drive:file-1", "revision-2"],
      deps,
    );
    const health = await runCli(["evidence", "health"], deps);

    expect(searched.exitCode).toBe(0);
    expect(searched.stdout).toContain("drive:file-1");
    expect(opened.exitCode).toBe(0);
    expect(opened.stdout).toContain("# Exact evidence");
    expect(health.exitCode).toBe(0);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.example.test/mcp",
      "https://api.example.test/mcp",
      "https://api.example.test/mcp",
    ]);
    const bodies = fetch.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(bodies).toEqual([
      expect.objectContaining({
        method: "tools/call",
        params: {
          name: "template.brain.evidence.search",
          arguments: { query: "approved positioning", limit: 5 },
        },
      }),
      expect.objectContaining({
        method: "tools/call",
        params: {
          name: "template.brain.evidence.sourceGet",
          arguments: {
            sourceKey: "drive:file-1",
            revisionKey: "revision-2",
          },
        },
      }),
      expect.objectContaining({
        method: "tools/call",
        params: {
          name: "template.brain.evidence.health",
          arguments: {},
        },
      }),
    ]);
  });

  it("supports the canonical evidence open spelling", async () => {
    const root = temp();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  operationId: "brain.evidence.sourceGet",
                  result: { markdown: "# Exact evidence" },
                }),
              },
            ],
          },
        }),
      ),
    );
    const result = await runCli(
      ["evidence", "open", "drive:file-1", "--revision", "revision-2"],
      { ...configured(root), fetch },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Exact evidence");
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(request.params).toEqual({
      name: "template.brain.evidence.sourceGet",
      arguments: {
        sourceKey: "drive:file-1",
        revisionKey: "revision-2",
      },
    });
  });

  it("lists and reviews grounded knowledge candidates from the terminal", async () => {
    const root = temp();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          params: { name: string };
        };
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: true,
                    operationId: request.params.name.slice("template.".length),
                    result: request.params.name.endsWith("candidates")
                      ? [{ candidateReceiptKey: "candidate-1" }]
                      : { status: "accepted", claimId: "claim-1" },
                  }),
                },
              ],
            },
          }),
        );
      });
    const deps = { ...configured(root), fetch };

    const listed = await runCli(
      ["knowledge", "candidates", "--state", "unreviewed", "--limit", "5"],
      deps,
    );
    const reviewed = await runCli(
      [
        "knowledge",
        "review",
        "candidate-1",
        "--accept",
        "--expected-revision",
        "0",
        "--body",
        "Approved company truth",
        "--review-horizon-days",
        "180",
      ],
      deps,
    );

    expect(listed.exitCode).toBe(0);
    expect(reviewed.exitCode).toBe(0);
    const requests = fetch.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(requests[0]?.params).toEqual({
      name: "template.brain.knowledge.candidates",
      arguments: { state: "unreviewed", limit: 5 },
    });
    expect(requests[1]?.params).toEqual({
      name: "template.brain.knowledge.review",
      arguments: expect.objectContaining({
        candidateReceiptKey: "candidate-1",
        expectedReviewRevision: 0,
        action: "edit_and_accept",
        body: "Approved company truth",
        reviewHorizonDays: 180,
        idempotencyKey: expect.stringMatching(
          /^brain-review-cli:[a-f0-9]{64}$/u,
        ),
      }),
    });
  });

  it("explains the five-item active review bound before making a request", async () => {
    const root = temp();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const result = await runCli(
      ["knowledge", "candidates", "--state", "unreviewed", "--limit", "10"],
      { ...configured(root), fetch },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("bounded to 5 candidates");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects ambiguous knowledge reviews before making a request", async () => {
    const root = temp();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const deps = { ...configured(root), fetch };
    const missingAction = await runCli(
      ["knowledge", "review", "candidate-1", "--expected-revision", "0"],
      deps,
    );
    const missingRevision = await runCli(
      ["knowledge", "review", "candidate-1", "--accept"],
      deps,
    );

    expect(missingAction.exitCode).toBe(1);
    expect(missingRevision.exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid evidence CLI input before making a request", async () => {
    const root = temp();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const deps = { ...configured(root), fetch };
    expect(
      (await runCli(["evidence", "search", "question", "--limit", "11"], deps))
        .exitCode,
    ).toBe(1);
    expect(
      (await runCli(["evidence", "source-get", "only-source"], deps)).exitCode,
    ).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts the common --json flag on evidence commands", async () => {
    const root = temp();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: true, result: { providers: [] } }),
              },
            ],
          },
        }),
      ),
    );

    const result = await runCli(["evidence", "health", "--json"], {
      ...configured(root),
      fetch,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"providers": []');
  });

  it("maps page list, get, history, create, and update to current API operations", async () => {
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
      (await runCli(["page", "history", "page_1", "--limit", "10"], deps))
        .exitCode,
    ).toBe(0);
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
      "https://api.example.test/api/brain.pages.history",
      "https://api.example.test/api/brain.pages.createMarkdown",
      "https://api.example.test/api/brain.pages.updateMarkdown",
    ]);
  });

  it("keeps page history compact unless full bodies are requested", async () => {
    const root = temp();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                _id: "revision_1",
                pageId: "page_1",
                markdown: "# ICP\n\nHistorical agency context.",
                updatedAt: 123,
              },
            ],
          }),
        ),
    );
    const deps = { ...configured(root), fetch };

    const compact = await runCli(["page", "history", "page_1"], deps);
    const full = await runCli(["page", "history", "page_1", "--full"], deps);

    expect(compact.stdout).not.toContain("Historical agency context");
    expect(JSON.parse(compact.stdout).result[0]).toMatchObject({
      _id: "revision_1",
      pageId: "page_1",
      markdownBytes: 33,
    });
    expect(full.stdout).toContain("Historical agency context");
  });

  it("rejects invalid page history limits locally", async () => {
    const root = temp();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const result = await runCli(
      ["page", "history", "page_1", "--limit", "101"],
      { ...configured(root), fetch },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("between 1 and 100");
    const missing = await runCli(["page", "history", "page_1", "--limit"], {
      ...configured(root),
      fetch,
    });
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("requires a value");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders a missing Brain page as a concise teammate error", async () => {
    const root = temp();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: { _tag: "NotFound", resource: "brainPages" },
          requestId: "request-secret-noise",
        }),
        { status: 500 },
      ),
    );
    const result = await runCli(["page", "get", "missing-page"], {
      ...configured(root),
      fetch,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("Brain page not found: missing-page\n");
    expect(result.stdout).toBe("");
  });

  it("keeps page discovery compact unless full bodies are requested", async () => {
    const root = temp();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                _id: "page_1",
                slug: "icp",
                title: "ICP",
                markdown: "# ICP\n\nAgency context.",
                updatedAt: 123,
              },
            ],
          }),
        ),
    );
    const deps = { ...configured(root), fetch };

    const compact = await runCli(["page", "list"], deps);
    const full = await runCli(["page", "list", "--full"], deps);

    expect(compact.stdout).not.toContain("Agency context");
    expect(JSON.parse(compact.stdout).result[0]).toMatchObject({
      _id: "page_1",
      slug: "icp",
      markdownBytes: 22,
    });
    expect(full.stdout).toContain("Agency context");
  });

  it("imports Markdown recursively in stable relative-path order", async () => {
    const root = temp();
    const folder = join(root, "brain");
    mkdirSync(join(folder, "team"), { recursive: true });
    writeFileSync(join(folder, "z.md"), "# Zed\n");
    writeFileSync(join(folder, "team", "a.md"), "# Alpha\n");
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify({
            ok: true,
            result: String(url).endsWith("brain.pages.list") ? [] : "page",
          }),
        ),
    );
    const result = await runCli(["import", folder], {
      ...configured(root),
      fetch,
    });
    expect(result.exitCode).toBe(0);
    const bodies = fetch.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(bodies.slice(1).map((body) => body.input.title)).toEqual([
      "Alpha",
      "Zed",
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      processed: 2,
      created: 2,
      updated: 0,
      unchanged: 0,
    });
  });

  it("makes repeat imports source-aware without touching unrelated pages", async () => {
    const root = temp();
    const folder = join(root, "brain");
    mkdirSync(folder);
    writeFileSync(join(folder, "icp.md"), "# ICP\n\nNew context.\n");
    writeFileSync(join(folder, "stable.md"), "# Stable\n\nSame context.\n");
    const pages = [
      {
        _id: "page_icp",
        slug: "icp",
        title: "ICP",
        markdown: "# ICP\n\nOld context.",
        updatedAt: 100,
        importSourceKey: "cli-import:icp",
      },
      {
        _id: "page_stable",
        slug: "stable",
        title: "Stable",
        markdown: "# Stable\n\nSame context.",
        updatedAt: 200,
        importSourceKey: "cli-import:stable",
      },
      {
        _id: "page_unrelated",
        slug: "unrelated",
        title: "Unrelated",
        markdown: "# Unrelated",
        updatedAt: 300,
      },
    ];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url, init) => {
        if (String(url).endsWith("brain.pages.list"))
          return new Response(JSON.stringify({ ok: true, result: pages }));
        const body = JSON.parse(String(init?.body));
        const firstPage = pages[0];
        if (firstPage === undefined) throw new Error("missing import fixture");
        pages[0] = {
          ...firstPage,
          title: body.input.title,
          markdown: body.input.markdown,
          updatedAt: 101,
        };
        return new Response(JSON.stringify({ ok: true, result: pages[0] }));
      });
    const result = await runCli(["import", folder], {
      ...configured(root),
      fetch,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      processed: 2,
      created: 0,
      updated: 1,
      unchanged: 1,
    });
    const repeated = await runCli(["import", folder], {
      ...configured(root),
      fetch,
    });
    expect(repeated.exitCode).toBe(0);
    expect(JSON.parse(repeated.stdout)).toMatchObject({
      processed: 2,
      created: 0,
      updated: 0,
      unchanged: 2,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    const update = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(update.input).toEqual({
      pageId: "page_icp",
      title: "ICP",
      markdown: "# ICP\n\nNew context.",
      expectedImportSourceKey: "cli-import:icp",
      expectedUpdatedAt: 100,
    });
  });

  it("fails closed on unowned, archived, or duplicate workspace pages", async () => {
    const root = temp();
    const folder = join(root, "brain");
    mkdirSync(folder);
    writeFileSync(join(folder, "icp.md"), "# ICP\n");
    const page = {
      _id: "page_icp",
      slug: "icp",
      title: "ICP",
      markdown: "# Existing",
      updatedAt: 100,
    };
    const runWith = async (pages: unknown[]) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true, result: pages })),
        );
      const result = await runCli(["import", folder], {
        ...configured(root),
        fetch,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      return result;
    };

    expect((await runWith([page])).stderr).toContain("does not own");
    const adoptionFetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify({
            ok: true,
            result: String(url).endsWith("brain.pages.list") ? [page] : page,
          }),
        ),
    );
    const adopted = await runCli(["import", folder, "--adopt-existing"], {
      ...configured(root),
      fetch: adoptionFetch,
    });
    expect(adopted.exitCode).toBe(0);
    expect(adoptionFetch).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(adoptionFetch.mock.calls[1]?.[1]?.body)).input,
    ).toMatchObject({
      pageId: "page_icp",
      adoptImportSourceKey: "cli-import:icp",
    });
    expect(
      (
        await runWith([
          {
            ...page,
            status: "archived",
            importSourceKey: "cli-import:icp",
          },
        ])
      ).stderr,
    ).toContain("archived");
    expect(
      (await runWith([page, { ...page, _id: "page_icp_2" }])).stderr,
    ).toContain("multiple pages");
  });

  it("aborts imports before writes when page discovery fails", async () => {
    const root = temp();
    const folder = join(root, "brain");
    mkdirSync(folder);
    writeFileSync(join(folder, "icp.md"), "# ICP\n");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "unavailable" }), {
        status: 503,
      }),
    );
    const result = await runCli(["import", folder], {
      ...configured(root),
      fetch,
    });
    expect(result.exitCode).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports resumable progress when an import update is stale", async () => {
    const root = temp();
    const folder = join(root, "brain");
    mkdirSync(folder);
    writeFileSync(join(folder, "icp.md"), "# ICP\n\nNew.\n");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                _id: "page_icp",
                slug: "icp",
                title: "ICP",
                markdown: "# ICP\n\nOld.",
                updatedAt: 100,
                importSourceKey: "cli-import:icp",
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: false, error: { _tag: "StaleRevision" } }),
          { status: 409 },
        ),
      );
    const result = await runCli(["import", folder], {
      ...configured(root),
      fetch,
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("StaleRevision");
    expect(result.stderr).toContain("Processed 0/1 files");
    expect(result.stderr).toContain("Rerun the same command");
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
    const status = (await runCli(["status"], deps)).stdout;
    expect(status).not.toContain("secret-key");
    expect(status).toContain('"cliVersion": "0.1.7"');
    expect((await runCli(["version"], deps)).stdout).toBe("0.1.7\n");
    expect((await runCli(["update"], deps)).stdout).toContain(
      "/releases/download/brain-cli-v0.1.7/maestro-brain.tgz",
    );
    const logout = await runCli(["logout"], deps);
    expect(logout.stdout).toContain('"revoked": false');
    expect(existsSync(join(deps.configDirectory, "config.json"))).toBe(false);
  });

  it("checks both API and HTTP MCP in doctor and exposes MCP troubleshooting", async () => {
    const root = temp();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url, init) => {
        if (!String(url).endsWith("/mcp"))
          return new Response(JSON.stringify({ ok: true, result: [] }));
        const body = JSON.parse(String(init?.body)) as { method: string };
        return body.method === "tools/call"
          ? new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({ ok: true, result: {} }),
                    },
                  ],
                },
              }),
            )
          : new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result:
                  body.method === "tools/list"
                    ? {
                        tools: [
                          {
                            name: "template.brain.evidence.search",
                            description: "Search Brain evidence",
                            inputSchema: {
                              type: "object",
                              properties: { query: { type: "string" } },
                            },
                          },
                        ],
                      }
                    : { protocolVersion: "2025-03-26" },
              }),
            );
      });
    const deps = { ...configured(root), fetch };
    expect((await runCli(["doctor"], deps)).exitCode).toBe(0);
    const compactTools = await runCli(["mcp", "tools"], deps);
    const fullTools = await runCli(["mcp", "tools", "--full"], deps);
    expect(compactTools.exitCode).toBe(0);
    expect(compactTools.stdout).toContain("template.brain.evidence.search");
    expect(compactTools.stdout).not.toContain("inputSchema");
    expect(fullTools.stdout).toContain("inputSchema");
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

  it("does not mistake empty evidence coverage for runtime readiness", async () => {
    const root = temp();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url, init) => {
        if (!String(url).endsWith("/mcp"))
          return new Response(JSON.stringify({ ok: true, result: [] }));
        const request = JSON.parse(String(init?.body)) as {
          method: string;
        };
        if (request.method === "tools/call")
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      ok: true,
                      result: {
                        providers: [
                          {
                            provider: "slack",
                            activeSourceCount: 0,
                            coverageState: "no-active-sources",
                          },
                        ],
                      },
                    }),
                  },
                ],
              },
            }),
          );
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result:
              request.method === "initialize"
                ? { protocolVersion: "2025-03-26" }
                : { tools: [] },
          }),
        );
      });

    const result = await runCli(["doctor"], {
      ...configured(root),
      fetch,
    });
    const body = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(body.warnings).toContain(
      "No provider currently has active evidence. Connectivity passed, but company context is empty.",
    );
    expect(body.notChecked).toContain("Claude Cowork connector import");
  });
});
