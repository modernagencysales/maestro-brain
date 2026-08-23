import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type SourceMap = {
  readonly schemaVersion: number;
  readonly mapVersion: string;
  readonly scope: {
    readonly activeBrainKey: string;
    readonly multiBrainSelectionAllowed: boolean;
  };
  readonly corpora: ReadonlyArray<{
    readonly corpusKey: string;
    readonly provider: string;
    readonly owner: string;
    readonly pilotRequired: boolean;
    readonly authority: string;
    readonly readiness: string;
    readonly freshnessTarget: string;
    readonly disclosure: string;
  }>;
};

type TeamManifest = {
  readonly schemaVersion: number;
  readonly manifestVersion: string;
  readonly status: string;
  readonly canonicalSkill: {
    readonly name: string;
    readonly contractVersion: string;
    readonly path: string;
  };
  readonly endpoint: {
    readonly transport: string;
    readonly baseUrlEnv: string;
    readonly path: string;
    readonly authentication: {
      readonly secretEnv: string;
      readonly requiredScopes: readonly string[];
      readonly roleCeiling: string;
      readonly separateCredentialPerRuntime: boolean;
    };
  };
  readonly contextContract: {
    readonly schemaVersion: string;
    readonly candidateManifestVersion: string;
    readonly requiredTools: readonly string[];
    readonly writeToolsAllowed: boolean;
    readonly durableFeedback: {
      readonly status: string;
      readonly operationId: string;
      readonly path: string;
      readonly requiredScope: string;
      readonly sourceTextAllowed: boolean;
    };
  };
  readonly terminalCli: {
    readonly command: string;
    readonly installCommand: string;
    readonly defaultCommandPath: string;
    readonly setupCommands: Readonly<Record<string, string>>;
    readonly diagnosticCommand: string;
    readonly contributionCommands: readonly string[];
  };
  readonly runtimes: ReadonlyArray<{
    readonly name: string;
    readonly compatibleVersions: readonly string[];
    readonly compatibilityLevel: string;
    readonly liveParity: string;
    readonly skillDiscoveryPath: string;
    readonly mcpConfigPath: string;
  }>;
  readonly unresolvedDecisions: Readonly<Record<string, string>>;
  readonly update: {
    readonly preconditions: readonly string[];
    readonly procedure: readonly string[];
  };
  readonly rollback: {
    readonly procedure: readonly string[];
    readonly preserve: readonly string[];
  };
};

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const contextRoot = resolve(repoRoot, "company-context");
const skillRoot = resolve(contextRoot, "skills/ask-apero");

const readText = (path: string): string =>
  readFileSync(resolve(repoRoot, path), "utf8");
const readJson = <Value,>(path: string): Value =>
  JSON.parse(readText(path)) as Value;

describe("company-context Ask Apero artifacts", () => {
  const manifest = readJson<TeamManifest>(
    "company-context/team-manifest.v1.json",
  );
  const sourceMap = readJson<SourceMap>(
    "company-context/skills/ask-apero/references/source-map.v1.json",
  );
  const skill = readText("company-context/skills/ask-apero/SKILL.md");
  const install = readText("company-context/install.md");
  const terminalTesting = readText("company-context/terminal-testing.md");
  const backendContextV3 = readText(
    "packages/convex/confect/brain/contextPackV3.ts",
  );
  const backendContextV2 = readText(
    "packages/convex/confect/brain/contextPackV2.ts",
  );

  it("keeps one canonical, progressively disclosed skill contract", () => {
    const skillFiles = readdirSync(skillRoot, { recursive: true })
      .map(String)
      .filter((path) => path.endsWith("SKILL.md"));

    expect(skillFiles).toEqual(["SKILL.md"]);
    expect(skill).toMatch(/^---\nname: ask-apero\n/);
    expect(skill).toContain('contract-version: "0.3.0"');
    for (const reference of [
      "references/agent-guidance.md",
      "references/context-pack-v3.md",
      "references/glossary.md",
      "references/source-map.v1.json",
    ]) {
      expect(skill).toContain(reference);
      expect(() => readFileSync(resolve(skillRoot, reference))).not.toThrow();
    }
    expect(skill.split("\n").length).toBeLessThan(80);
  });

  it("pins a read-only endpoint and both runtime discovery contracts", () => {
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      manifestVersion: "0.6.0",
      status: "candidate",
      canonicalSkill: {
        name: "ask-apero",
        contractVersion: "0.3.0",
        path: "company-context/skills/ask-apero",
      },
      endpoint: {
        transport: "streamable-http",
        baseUrlEnv: "CONVEX_SITE_URL",
        path: "/mcp",
        authentication: {
          secretEnv: "MAESTRO_BRAIN_API_KEY",
          requiredScopes: ["brain:read", "brain:ask"],
          roleCeiling: "viewer",
          separateCredentialPerRuntime: true,
        },
      },
      contextContract: {
        schemaVersion: "3",
        candidateManifestVersion: "2",
        writeToolsAllowed: false,
        durableFeedback: {
          status: "implemented-api-only",
          operationId: "brain.feedback.reportWrongOrStale",
          path: "/api/brain.feedback.reportWrongOrStale",
          requiredScope: "brain:read",
          sourceTextAllowed: false,
        },
      },
    });
    expect(manifest.contextContract.requiredTools).toEqual([
      "template.brain.context.get",
      "template.brain.sources.search",
      "template.brain.sources.get",
    ]);
    expect(manifest.contextContract.terminalContribution).toMatchObject({
      operationId: "brain.notes.submit",
      retrySafe: true,
      publishedWithoutReview: false,
    });
    expect(manifest.terminalCli).toMatchObject({
      command: "maestro-brain",
      installCommand: "$BRAIN_CLI install",
      defaultCommandPath: "~/.local/bin/maestro-brain",
      setupCommands: {
        codex: "maestro-brain setup codex",
        "claude-code": "maestro-brain setup claude-code",
        "claude-cowork": "maestro-brain setup cowork",
      },
      diagnosticCommand: "maestro-brain doctor",
    });
    expect(manifest.terminalCli.contributionCommands).toHaveLength(4);
    expect(manifest.runtimes).toEqual([
      expect.objectContaining({
        name: "codex",
        compatibleVersions: ["0.148.0", "0.149.0"],
        compatibilityLevel: "skill-and-mcp-configuration",
        liveParity: "pending",
        skillDiscoveryPath: ".agents/skills/ask-apero",
        mcpConfigPath: ".codex/config.toml",
      }),
      expect.objectContaining({
        name: "claude-code",
        compatibleVersions: ["2.1.220"],
        compatibilityLevel: "skill-and-mcp-configuration",
        liveParity: "pending",
        skillDiscoveryPath: ".claude/skills/ask-apero",
      }),
      expect.objectContaining({
        name: "claude-cowork",
        compatibleVersions: ["host-managed"],
        compatibilityLevel: "remote-http-mcp-and-server-prompt",
        liveParity: "pending",
        skillDiscoveryPath: "mcp://maestro-brain/prompts/ask-apero",
      }),
    ]);
    expect(manifest.update.preconditions.length).toBeGreaterThan(3);
    expect(manifest.update.procedure.length).toBeGreaterThan(3);
    expect(manifest.rollback.procedure.length).toBeGreaterThan(3);
    expect(manifest.rollback.preserve.length).toBeGreaterThan(2);
  });

  it("pins the exact ContextPack contract served by the canonical backend", () => {
    expect(backendContextV3).toContain(
      `schemaVersion: Schema.Literal("${manifest.contextContract.schemaVersion}")`,
    );
    expect(backendContextV2).toContain(
      `version: Schema.Literal("${manifest.contextContract.candidateManifestVersion}")`,
    );
    expect(skill).toContain(
      `ContextPack schema version \`${manifest.contextContract.schemaVersion}\` with candidate-manifest version`,
    );
    expect(skill).toContain(
      `\`${manifest.contextContract.candidateManifestVersion}\`.`,
    );
  });

  it("preserves unresolved owner, Brain, freshness, and provider decisions", () => {
    expect(new Set(Object.values(manifest.unresolvedDecisions))).toEqual(
      new Set(["TBD"]),
    );
    expect(sourceMap.schemaVersion).toBe(1);
    expect(sourceMap.mapVersion).toBe("0.1.0");
    expect(sourceMap.scope).toEqual({
      mode: "single-trusted-agency-brain",
      activeBrainKey: "TBD",
      multiBrainSelectionAllowed: false,
    });
    expect(
      new Set(sourceMap.corpora.map(({ corpusKey }) => corpusKey)).size,
    ).toBe(sourceMap.corpora.length);
    for (const corpus of sourceMap.corpora) {
      expect(corpus.owner).toBe("TBD");
      expect(corpus.authority).not.toHaveLength(0);
      expect(corpus.readiness).not.toHaveLength(0);
      expect(corpus.freshnessTarget).toBe("TBD");
      expect(corpus.disclosure).not.toHaveLength(0);
    }
    expect(
      sourceMap.corpora.find(
        ({ corpusKey }) => corpusKey === "first-document-source",
      )?.provider,
    ).toBe("TBD");
  });

  it("documents secret names without committing credential values", () => {
    expect(install).toContain("CONVEX_SITE_URL");
    expect(install).toContain("MAESTRO_BRAIN_API_KEY");
    expect(install).toContain("bearer_token_env_var");
    expect(install).toContain("${MAESTRO_BRAIN_API_KEY}");
    expect(install).toContain("separate existing interactive service identity");
    expect(install).toContain("both `brain:read` and `brain:ask`");
    expect(install).toContain(".cowork/maestro-brain.json");
    expect(terminalTesting).toContain("`brain:read` and\n  `brain:ask` scopes");
    expect(terminalTesting).toContain(".cowork/maestro-brain.json");
    expect(terminalTesting).toContain(
      "feedback --idempotency-key feedback-<unique-id> --input",
    );
    expect(install).not.toMatch(
      /(sk_live|sk-[A-Za-z0-9]{20,}|ghp_|xox[baprs]-|eyJ[A-Za-z0-9_-]{20,})/,
    );
  });

  it("keeps company-context free of copied evidence and write capability", () => {
    const combined = [
      "company-context/README.md",
      "company-context/install.md",
      "company-context/pilot-config.example.v1.json",
      "company-context/team-manifest.v1.json",
      "company-context/skills/ask-apero/SKILL.md",
      "company-context/skills/ask-apero/references/glossary.md",
      "company-context/skills/ask-apero/references/agent-guidance.md",
      "company-context/skills/ask-apero/references/context-pack-v3.md",
      "company-context/skills/ask-apero/references/source-map.v1.json",
    ]
      .map(readText)
      .join("\n");

    expect(combined).not.toContain("template.brain.answers.ask");
    expect(combined).not.toMatch(
      /template\.brain\.(?:pages\.)?(?:create|update|delete)/,
    );
    expect(combined).toContain("brain.feedback.reportWrongOrStale");
    expect(combined).toMatch(/without source or\s+answer text/);
  });
});
