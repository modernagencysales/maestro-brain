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
      stdout: "release-tooling smoke-web-static | review-readiness\n",
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
