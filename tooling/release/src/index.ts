import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

export type WebStaticSmokeReport = {
  readonly ok: boolean;
  readonly distPath: string;
  readonly indexHtmlBytes: number;
  readonly assetCount: number;
  readonly checks: readonly {
    readonly id: string;
    readonly status: "pass" | "fail";
    readonly detail: string;
  }[];
};

export type ReviewerReadinessReport = {
  readonly ok: boolean;
  readonly repoRoot: string;
  readonly commit: string;
  readonly hostedUrl: string;
  readonly artifacts: readonly {
    readonly path: string;
    readonly status: "pass" | "fail";
    readonly detail: string;
  }[];
  readonly claims: readonly {
    readonly id: string;
    readonly status: "pass" | "fail";
    readonly evidence: readonly string[];
    readonly detail: string;
  }[];
  readonly commands: readonly string[];
};

export type CompletionAuditReport = {
  readonly ok: boolean;
  readonly repoRoot: string;
  readonly commit: string;
  readonly hostedUrl: string;
  readonly requirements: readonly {
    readonly id: string;
    readonly requirement: string;
    readonly status: "pass" | "fail";
    readonly evidence: readonly string[];
    readonly verification: readonly string[];
    readonly detail: string;
  }[];
};

const pass = (id: string, detail: string) => ({
  id,
  status: "pass" as const,
  detail,
});

const fail = (id: string, detail: string) => ({
  id,
  status: "fail" as const,
  detail,
});

const readinessArtifacts = [
  "README.md",
  "AGENTS.md",
  "docs/template/investor-reviewer-packet.md",
  "docs/template/reviewer-guide.md",
  "docs/template/repo-map.md",
  "docs/template/confect-effect-guide.md",
  "docs/template/app-factory-guide.md",
  "docs/template/private-package-guide.md",
  "docs/template/hosting.md",
  "docs/template/security.md",
  "docs/rule-coverage.md",
  "packages/convex/confect/http.ts",
  "packages/convex/confect/_generated/refs.ts",
  "packages/convex/confect/jobs/workpool.spec.ts",
  "packages/convex/test/confect-contracts.test.ts",
  "packages/workflow-ui/src/index.tsx",
  "packages/template-core/src/index.ts",
  "tooling/workflow/src/index.ts",
  "tooling/generators/src/index.ts",
  "tests/e2e/hosted-reference-app.spec.ts",
  "tests/e2e/hosted-reference-app.visual.spec.ts",
] as const;

const readinessClaims = [
  {
    id: "hosted-reference-app",
    evidence: [
      "apps/web/src/sample/App.tsx",
      "tests/e2e/hosted-reference-app.spec.ts",
      "tests/e2e/hosted-reference-app.visual.spec.ts",
    ],
    detail:
      "Hosted app has a concrete reference surface plus browser and visual smoke coverage.",
  },
  {
    id: "confect-effect-contracts",
    evidence: [
      "docs/template/confect-effect-guide.md",
      "packages/convex/confect/_generated/refs.ts",
      "packages/convex/test/confect-contracts.test.ts",
      "packages/convex/confect/jobs/workpool.spec.ts",
    ],
    detail:
      "Confect/Effect path has pinned versions, generated refs, contract tests, and plain Convex interop.",
  },
  {
    id: "workflow-react-flow-primitive",
    evidence: [
      "packages/workflow-ui/src/index.tsx",
      "tooling/quality/check-workflow-graph-boundary.mts",
      "docs/template/workflow-authoring-guide.md",
    ],
    detail:
      "React Flow is kept as a reusable UI primitive while durable workflow logic remains schema-backed.",
  },
  {
    id: "headless-api-cli-mcp",
    evidence: [
      "packages/template-core/src/index.ts",
      "tooling/workflow/src/index.ts",
      "apps/cli/src/index.ts",
      "packages/convex/confect/http.ts",
    ],
    detail:
      "API, CLI, MCP, and Scalar/OpenAPI projections come from shared template registry metadata.",
  },
  {
    id: "provider-adapter-harness",
    evidence: [
      "packages/integrations/src/index.ts",
      "packages/integrations/src/index.test.ts",
      "docs/template/integrations.md",
    ],
    detail:
      "Provider integrations use Effect service boundaries with fake/test/live-ready adapter posture.",
  },
  {
    id: "app-factory-generators",
    evidence: [
      "tooling/generators/src/index.ts",
      "tooling/generators/src/index.test.ts",
      "docs/template/app-factory-guide.md",
      "docs/template/private-package-guide.md",
    ],
    detail:
      "App factory commands cover initialization, generated capabilities/workflows, promotion, upgrades, and private packages.",
  },
  {
    id: "security-and-rules",
    evidence: [
      "AGENTS.md",
      "docs/template/security.md",
      "docs/template/coding-standards.md",
      "docs/rule-coverage.md",
      "tooling/quality/check-secret-canaries.mts",
      "tooling/quality/check-auth-demo-bypass.mts",
    ],
    detail:
      "Coding rules, security posture, and static gates document and enforce the core safety model.",
  },
] as const;

const completionRequirements = [
  {
    id: "private-template-repo",
    requirement:
      "A private template repo exists and is navigable as an internal app factory, not a public starter kit.",
    evidence: [
      "README.md",
      "AGENTS.md",
      "docs/template/repo-map.md",
      "docs/template/investor-reviewer-packet.md",
    ],
    verification: ["pnpm review:readiness"],
    detail:
      "Repo entry points, agent rules, map, and investor packet are present.",
  },
  {
    id: "clear-sample-app",
    requirement:
      "The repo contains a clear, useful sample app that demonstrates Brain, workflow, capability, agent, integration, and safety surfaces.",
    evidence: [
      "apps/web/src/sample/App.tsx",
      "apps/web/src/sample/templateData.ts",
      "apps/web/src/sample/templateData.test.ts",
      "examples/generic-ai-ops/seed/workspace.json",
      "examples/generic-ai-ops/seed/brain-pages.md",
      "examples/generic-ai-ops/seed/workflows.json",
      "tests/e2e/hosted-reference-app.spec.ts",
      "tests/e2e/hosted-reference-app.visual.spec.ts",
    ],
    verification: [
      "pnpm --dir apps/web test src/sample/templateData.test.ts",
      "pnpm smoke:hosted:browser",
      "pnpm smoke:hosted:visual",
    ],
    detail:
      "Reference app data, seed fixtures, and browser/visual tests cover the investor-visible sample app.",
  },
  {
    id: "hosted-reference",
    requirement:
      "The sample app is hosted or can be immediately hosted from the static build.",
    evidence: [
      "docs/template/hosting.md",
      "tests/e2e/hosted-reference-app.spec.ts",
      "tests/e2e/hosted-reference-app.visual.spec.ts",
    ],
    verification: [
      "pnpm build",
      "pnpm smoke:web-static",
      "pnpm smoke:hosted",
      "pnpm smoke:hosted:browser",
      "pnpm smoke:hosted:visual",
    ],
    detail:
      "Cloudflare Pages URL and static/hosted smoke paths are documented and testable.",
  },
  {
    id: "confect-effect-framework",
    requirement:
      "The template uses Confect and Effect for typed contracts while preserving Convex component interop.",
    evidence: [
      "docs/template/confect-effect-guide.md",
      "packages/convex/confect/_generated/refs.ts",
      "packages/convex/test/confect-contracts.test.ts",
      "packages/convex/confect/jobs/workpool.spec.ts",
    ],
    verification: [
      "pnpm check:confect-contracts",
      "pnpm check:confect-compat",
      "pnpm --dir packages/convex test",
    ],
    detail:
      "Pinned compatibility, generated refs, contract tests, and plain Convex Workpool interop are present.",
  },
  {
    id: "workflow-capability-agent-primitives",
    requirement:
      "Reusable workflows, capabilities, agents, React Flow, API, CLI, MCP, and integration primitives are included without Maestro-specific business logic.",
    evidence: [
      "packages/workflow-ui/src/index.tsx",
      "packages/template-core/src/index.ts",
      "tooling/workflow/src/index.ts",
      "apps/cli/src/index.ts",
      "docs/template/workflow-authoring-guide.md",
      "docs/template/capability-authoring-guide.md",
    ],
    verification: [
      "pnpm test:workflow",
      "pnpm check:workflow-graph-boundary",
      "pnpm exec tsx apps/cli/src/index.ts describe",
      "pnpm exec tsx apps/cli/src/index.ts mcp tools",
    ],
    detail:
      "Workflow UI, headless registry, CLI/MCP projection, and authoring guides are present.",
  },
  {
    id: "app-factory",
    requirement:
      "The repo can be used to start custom client apps, promote generated capabilities/workflows, upgrade forks, and import private packages.",
    evidence: [
      "tooling/generators/src/index.ts",
      "tooling/generators/src/index.test.ts",
      "docs/template/app-factory-guide.md",
      "docs/template/private-package-guide.md",
    ],
    verification: [
      "pnpm check:generators",
      "pnpm --dir tooling/generators test",
      'pnpm template:init -- --name "Reviewer Brain"',
      "pnpm template:private-package:dry-run -- --fixture examples/generic-ai-ops",
    ],
    detail:
      "Generator implementation, tests, and app-factory/private-package docs are present.",
  },
  {
    id: "services-and-security",
    requirement:
      "Core services, provider adapters, CI/CD gates, security posture, and coding rules are documented and enforced.",
    evidence: [
      ".buildkite/pipeline.yml",
      "packages/integrations/src/index.ts",
      "packages/integrations/src/index.test.ts",
      "docs/template/security.md",
      "docs/template/coding-standards.md",
      "docs/rule-coverage.md",
    ],
    verification: [
      "pnpm lint",
      "pnpm typecheck",
      "pnpm check:secret-canaries",
      "pnpm check:auth-demo-bypass",
      "pnpm check:ci-completeness",
    ],
    detail:
      "Provider harnesses, CI config, security docs, coding standards, and static gates are present.",
  },
  {
    id: "investor-handoff",
    requirement:
      "An investor or technical reviewer has a clear entry point, review path, evidence packet, and explicit production limits.",
    evidence: [
      "docs/template/investor-reviewer-packet.md",
      "docs/template/reviewer-guide.md",
      "docs/template/confect-effect-guide.md",
      "docs/template/hosting.md",
    ],
    verification: ["pnpm review:readiness", "pnpm review:completion"],
    detail:
      "Investor packet, reviewer guide, typed-contract guide, hosting guide, and completion audit are present.",
  },
] as const;

export const reviewerCommands = [
  "pnpm check:format",
  "pnpm lint",
  "pnpm typecheck",
  "host-test-slot --class full pnpm test",
  "pnpm check:confect-contracts",
  "pnpm check:confect-compat",
  "pnpm check:workflow-graph-boundary",
  "pnpm check:secret-canaries",
  "pnpm build",
  "pnpm smoke:web-static",
  "pnpm smoke:hosted",
  "pnpm smoke:hosted:browser",
  "pnpm smoke:hosted:visual",
] as const;

const currentCommit = (repoRoot: string): string => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
};

export const buildReviewerReadinessReport = (options?: {
  readonly repoRoot?: string;
  readonly commit?: string;
  readonly hostedUrl?: string;
}): ReviewerReadinessReport => {
  const repoRoot = options?.repoRoot ?? process.cwd();
  const hostedUrl =
    options?.hostedUrl ??
    process.env.TEMPLATE_HOSTED_URL ??
    "https://maestro-template.pages.dev";
  const artifactStatus = (artifactPath: string) => {
    const fullPath = resolve(repoRoot, artifactPath);

    return existsSync(fullPath)
      ? {
          path: artifactPath,
          status: "pass" as const,
          detail: "present",
        }
      : {
          path: artifactPath,
          status: "fail" as const,
          detail: `missing ${fullPath}`,
        };
  };
  const artifacts = readinessArtifacts.map(artifactStatus);
  const claims = readinessClaims.map((claim) => {
    const missing = claim.evidence.filter(
      (artifactPath) => !existsSync(resolve(repoRoot, artifactPath)),
    );

    return {
      id: claim.id,
      status: missing.length === 0 ? ("pass" as const) : ("fail" as const),
      evidence: claim.evidence,
      detail:
        missing.length === 0
          ? claim.detail
          : `${claim.detail} Missing evidence: ${missing.join(", ")}`,
    };
  });

  return {
    ok:
      artifacts.every((artifact) => artifact.status === "pass") &&
      claims.every((claim) => claim.status === "pass"),
    repoRoot,
    commit: options?.commit ?? currentCommit(repoRoot),
    hostedUrl,
    artifacts,
    claims,
    commands: reviewerCommands,
  };
};

export const buildCompletionAuditReport = (options?: {
  readonly repoRoot?: string;
  readonly commit?: string;
  readonly hostedUrl?: string;
}): CompletionAuditReport => {
  const repoRoot = options?.repoRoot ?? process.cwd();
  const hostedUrl =
    options?.hostedUrl ??
    process.env.TEMPLATE_HOSTED_URL ??
    "https://maestro-template.pages.dev";
  const requirements = completionRequirements.map((requirement) => {
    const missing = requirement.evidence.filter(
      (artifactPath) => !existsSync(resolve(repoRoot, artifactPath)),
    );

    return {
      id: requirement.id,
      requirement: requirement.requirement,
      status: missing.length === 0 ? ("pass" as const) : ("fail" as const),
      evidence: requirement.evidence,
      verification: requirement.verification,
      detail:
        missing.length === 0
          ? requirement.detail
          : `${requirement.detail} Missing evidence: ${missing.join(", ")}`,
    };
  });

  return {
    ok: requirements.every((requirement) => requirement.status === "pass"),
    repoRoot,
    commit: options?.commit ?? currentCommit(repoRoot),
    hostedUrl,
    requirements,
  };
};

export const smokeWebStaticBuild = (options?: {
  readonly repoRoot?: string;
}): WebStaticSmokeReport => {
  const repoRoot = options?.repoRoot ?? process.cwd();
  const distPath = resolve(repoRoot, "apps/web/dist");
  const indexPath = join(distPath, "index.html");
  const assetsPath = join(distPath, "assets");
  const checks = [];

  if (!existsSync(indexPath)) {
    checks.push(fail("web:index", `Missing ${indexPath}. Run pnpm build.`));
  } else {
    const html = readFileSync(indexPath, "utf8");
    checks.push(pass("web:index", `Found ${indexPath}`));
    checks.push(
      html.includes('<div id="root"></div>')
        ? pass("web:root", "index.html contains the React root")
        : fail("web:root", "index.html is missing the React root"),
    );
    checks.push(
      html.includes("/assets/")
        ? pass("web:assets-linked", "index.html links built assets")
        : fail("web:assets-linked", "index.html does not link built assets"),
    );
  }

  const assets = existsSync(assetsPath) ? readdirSync(assetsPath) : [];
  checks.push(
    assets.length > 0
      ? pass("web:assets", `Found ${assets.length} built assets`)
      : fail("web:assets", `Missing built assets under ${assetsPath}`),
  );

  return {
    ok: checks.every((check) => check.status === "pass"),
    distPath,
    indexHtmlBytes: existsSync(indexPath) ? statSync(indexPath).size : 0,
    assetCount: assets.length,
    checks,
  };
};

export const runReleaseCli = (
  argv: readonly string[],
  cwd = process.cwd(),
): {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
} => {
  const [command] = argv;

  if (!command || command === "help" || command === "--help") {
    return {
      exitCode: 0,
      stdout:
        "release-tooling smoke-web-static | review-readiness | review-completion\n",
      stderr: "",
    };
  }

  if (command === "smoke-web-static") {
    const report = smokeWebStaticBuild({ repoRoot: cwd });

    return {
      exitCode: report.ok ? 0 : 1,
      stdout: `${JSON.stringify(report, null, 2)}\n`,
      stderr: "",
    };
  }

  if (command === "review-readiness") {
    const report = buildReviewerReadinessReport({ repoRoot: cwd });

    return {
      exitCode: report.ok ? 0 : 1,
      stdout: `${JSON.stringify(report, null, 2)}\n`,
      stderr: "",
    };
  }

  if (command === "review-completion") {
    const report = buildCompletionAuditReport({ repoRoot: cwd });

    return {
      exitCode: report.ok ? 0 : 1,
      stdout: `${JSON.stringify(report, null, 2)}\n`,
      stderr: "",
    };
  }

  return {
    exitCode: 1,
    stdout: "",
    stderr: `Unknown release command: ${command}\n`,
  };
};

if (
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js")
) {
  const result = runReleaseCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
