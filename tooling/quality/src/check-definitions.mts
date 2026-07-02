import type { StaticCheckDescriptor } from "./gate.mts";

export const checkDescriptors = {
  "ci-completeness": {
    name: "check:ci-completeness",
    requirements: [
      {
        file: ".buildkite/pipeline.yml",
        includes: [
          "ci-self-protection",
          "pnpm verify",
          "pnpm check:ci-completeness",
          "pnpm check:config-drift",
          "pnpm check:confect-contracts",
          "pnpm check:confect-compat",
          "pnpm check:workflow-graph-boundary",
          "taste",
          "contract-review",
          "staging-deploy",
          "production-promote.sh",
        ],
        message: "Buildkite pipeline must include deterministic and AI gates",
      },
      {
        file: ".buildkite/scripts/ci-self-protection.sh",
        includes: ["check:ci-completeness", "check:config-drift"],
        message: "secretless self-protection step must run the shape pins",
      },
      {
        file: "Justfile",
        includes: ["verify:", "check-fmt:", "lint:", "typecheck:", "test:"],
        message: "Justfile must keep the canonical gate recipe names",
      },
      {
        file: "lefthook.yml",
        includes: ["pre-push", "pre-push-rubric.sh", "check:debt"],
        message: "lefthook must run shifted-left gates and rubric injection",
      },
      {
        file: ".buildkite/scripts/taste.sh",
        includes: [
          "OPENAI_API_KEY",
          "extract-ai-verdict.mts",
          "pnpm taste -- --mode fake | pnpm exec tsx tooling/quality/extract-ai-verdict.mts",
        ],
        message: "taste AI gate must require provider auth and parse verdicts",
      },
      {
        file: ".buildkite/scripts/contract-review.sh",
        includes: [
          "OPENAI_API_KEY",
          "extract-ai-verdict.mts",
          "pnpm contract-review -- --mode fake | pnpm exec tsx tooling/quality/extract-ai-verdict.mts",
        ],
        message:
          "contract-review AI gate must require provider auth and parse verdicts",
      },
      {
        file: "docs/template/operations-runbook.md",
        includes: [
          "CI And AI Gate Verdicts",
          "buildkite-agent meta-data get staged-sha",
          "tooling/quality/extract-ai-verdict.mts",
          "gh pr checks --watch",
        ],
        message:
          "operations runbook must explain AI gate verdict retrieval and repair workflow",
      },
    ],
  },
  "config-drift": {
    name: "check:config-drift",
    requirements: [
      {
        file: "package.json",
        includes: [
          "check:ci-completeness",
          "check:config-drift",
          "check:confect-contracts",
          "check:confect-compat",
          "check:workflow-graph-boundary",
          "contract-review",
          "taste:eval",
          "test:mutation",
        ],
        message: "package scripts must expose required quality gates",
      },
      {
        file: ".buildkite/scripts/mutation.sh",
        includes: ["pnpm exec stryker run stryker.conf.mjs"],
        message: "mutation gate must run Stryker in scheduled/manual mode",
      },
      {
        file: "stryker.conf.mjs",
        includes: [
          "@stryker-mutator/vitest-runner",
          "@stryker-mutator/typescript-checker",
          "packages/convex/confect/access/lifecycle.ts",
          "packages/convex/confect/workflows/runGraph.ts",
        ],
        message: "Stryker config must target focused backend primitives",
      },
      {
        file: "project.config.json",
        includes: [
          "maestro-template-staging",
          "maestro-template-production",
          "CLOUDFLARE_API_TOKEN",
          "CONVEX_DEPLOY_KEY",
          "convexUrl",
        ],
        message:
          "project config must declare deploy environments, Convex URLs, and required secret names",
      },
      {
        file: ".buildkite/scripts/staging-deploy.sh",
        includes: [
          "deploy-doctor staging",
          "scripts/_project-config.mjs get staging cloudflarePagesProject",
          "scripts/_project-config.mjs get staging convexUrl",
          "convex deploy",
          "convex run demo/showcase:seed",
          "pages deploy apps/web/dist/client",
          "buildkite-agent meta-data set staged-sha",
        ],
        message:
          "staging deploy must deploy the Convex backend, bake the Convex URL, deploy the client build, and record the staged SHA",
      },
      {
        file: ".buildkite/scripts/production-promote.sh",
        includes: [
          "deploy-doctor production",
          "promote-plan",
          "scripts/_project-config.mjs get production convexUrl",
          "convex deploy",
          "convex run demo/showcase:seed",
          "pages deploy apps/web/dist/client",
          "buildkite-agent meta-data get staged-sha",
        ],
        message:
          "production promote must deploy the Convex backend, bake the Convex URL, deploy the client build, and verify the staged SHA",
      },
    ],
  },
  deps: {
    name: "check:deps",
    requirements: [
      {
        file: "package.json",
        includes: ["pnpm@10.12.1", "turbo", "typescript"],
        message: "root package metadata must pin core tooling",
      },
      {
        file: "pnpm-lock.yaml",
        includes: ["lockfileVersion"],
        message: "lockfile must exist",
      },
    ],
  },
  knip: {
    name: "check:knip",
    requirements: [
      {
        file: "knip.json",
        includes: ["entry", "project"],
        message: "knip must have a real workspace-aware config",
      },
      {
        file: "package.json",
        includes: ["knip --config knip.json"],
        message: "check:knip must invoke the real knip CLI",
      },
    ],
  },
  "route-tree": {
    name: "check:route-tree",
    requirements: [
      {
        file: "docs/template/repo-map.md",
        includes: [
          "/brain",
          "/workflows",
          "/capabilities",
          "/agents",
          "/runs",
          "/settings",
          "/api",
          "/admin",
        ],
        message: "repo map must declare planned app routes",
      },
      {
        file: "docs/template/frontend-architecture.md",
        includes: [
          "generated `routeTree`",
          'defaultPreload: "intent"',
          "scrollRestoration: true",
          "apps/web/src/routeTree.gen.ts",
        ],
        message:
          "frontend architecture must declare TanStack Start route tree invariants",
      },
      {
        file: "apps/web/package.json",
        includes: [
          '"@tanstack/react-start"',
          '"@tanstack/react-router"',
          '"@tanstack/react-query"',
          '"@convex-dev/react-query"',
          '"@workos/authkit-tanstack-react-start"',
          '"@notion-kit/ui"',
        ],
        message:
          "web package must include the committed TanStack Start and Notion Kit runtime dependencies",
      },
    ],
  },
  "types-coverage": {
    name: "check:types-coverage",
    requirements: [
      {
        file: "tsconfig.base.json",
        includes: [
          "strict",
          "noUncheckedIndexedAccess",
          "exactOptionalPropertyTypes",
        ],
        message: "TypeScript config must enforce strict typing",
      },
      {
        file: "package.json",
        includes: [
          "type-coverage --project tsconfig.type-coverage.json --at-least 99.7",
        ],
        message:
          "check:types-coverage must invoke type-coverage with an explicit threshold",
      },
      {
        file: "tsconfig.type-coverage.json",
        includes: ["include", "exclude"],
        message: "type coverage must inspect real project files",
      },
      {
        file: "docs/template/type-coverage-ratchet.md",
        includes: ["99.7", "100%"],
        message:
          "type coverage ratchet must be documented until it reaches 100%",
      },
    ],
  },
  gates: {
    name: "check:gates",
    requirements: [
      {
        file: "tooling/quality/src/gate.mts",
        includes: ["evaluateStaticCheck", "runStaticCheck"],
        message: "quality gate harness must exist",
      },
      {
        file: "package.json",
        includes: ["check:gates"],
        message: "gate scripts must be reachable from package.json",
      },
    ],
  },
  debt: {
    name: "check:debt",
    requirements: [
      {
        file: "docs/template/coding-standards.md",
        includes: ["No `any`", "Generated files are never edited directly"],
        message: "coding standards must encode debt-prevention rules",
      },
    ],
  },
  generators: {
    name: "check:generators",
    requirements: [
      {
        file: "docs/template/app-factory-guide.md",
        includes: [
          "template:quickstart",
          "template:init",
          "template:add-client-domain",
          "blueprint-catalog.md",
          "generator-output-contract.md",
        ],
        message: "app factory guide must document generator workflow",
      },
      {
        file: "docs/template/blueprint-catalog.md",
        includes: [
          "source-grounded-gtm-brain",
          "implementation-consulting-brain",
          "internal-ops-agent-workspace",
          "custom-domain-ai-app",
        ],
        message: "blueprint catalog must document core factory blueprints",
      },
      {
        file: "docs/template/generator-output-contract.md",
        includes: [
          "Confect spec/impl",
          "Effect schema",
          "typed errors",
          "headless registry entry",
        ],
        message: "generator output contract must protect generated slices",
      },
      {
        file: "docs/template/client-handoff-packet.md",
        includes: ["real", "fake", "seam", "planned", "Required secret names"],
        message: "handoff packet must define status labels and secret posture",
      },
      {
        file: "package.json",
        includes: [
          "template:quickstart",
          "template:seed-demo",
          "template:handoff",
          "template:add-client-domain",
        ],
        message: "package scripts must expose app factory quickstart commands",
      },
    ],
  },
  "docs-freshness": {
    name: "check:docs-freshness",
    requirements: [
      {
        file: "README.md",
        includes: ["AGENTS.md", "repo-map.md", "reviewer-guide.md"],
        message: "README must link primary navigation docs",
      },
      {
        file: "docs/template/env-manifest.md",
        includes: [
          "WorkOS",
          "PostHog",
          "Dodo",
          "MailerSend",
          "OpenRouter",
          "Cloudflare",
          "Buildkite",
          "fake mode",
          "rotation",
        ],
        message:
          "env manifest must document provider setup, fake-mode behavior, and rotation posture",
      },
      {
        file: ".env.example",
        includes: ["example.test", "fake_local_key", "acme-demo"],
        message:
          ".env.example must expose safe fake values for local quickstart",
      },
    ],
  },
  "generated-files": {
    name: "check:generated-files",
    requirements: [
      {
        file: "AGENTS.md",
        includes: ["Do not edit generated Confect or Convex files by hand"],
        message: "agent instructions must protect generated files",
      },
    ],
  },
  "confect-contracts": {
    name: "check:confect-contracts",
    requirements: [
      {
        file: "docs/template/confect-effect-guide.md",
        includes: [
          "Schema.Null",
          "import type",
          "GroupImpl.finalize",
          "confect/auth.ts",
          "confect/crons.ts",
          "confect/http.ts",
        ],
        message: "Confect guide must encode contract invariants",
      },
      {
        file: "packages/convex/confect/capabilities/catalog.spec.ts",
        includes: [
          "FunctionSpec.publicQuery",
          "Schema.Struct",
          "Schema.Array",
          "GroupSpec.make().addFunction",
        ],
        message: "capability catalog must be a Confect/Effect spec",
      },
      {
        file: "packages/convex/confect/brain/pages.spec.ts",
        includes: [
          "FunctionSpec.publicQuery",
          "FunctionSpec.publicMutation",
          "WorkspaceNotFound",
          "brainPages.Doc",
        ],
        message: "Brain pages must expose typed Confect contracts",
      },
      {
        file: "packages/convex/confect/jobs/workpool.spec.ts",
        includes: [
          "import type",
          "FunctionSpec.convexPublicMutation",
          "FunctionSpec.convexPublicQuery",
          "FunctionSpec.convexInternalAction",
          "FunctionSpec.convexInternalMutation",
        ],
        message:
          "plain Convex component functions must be type-only in Confect specs",
      },
      {
        file: "packages/convex/confect/jobs/workpool.impl.ts",
        includes: ["FunctionImpl.make", "GroupImpl.finalize"],
        message: "plain Convex component impls must finalize through Confect",
      },
      {
        file: "packages/convex/confect/_generated/refs.ts",
        includes: ["Refs.FromSpec", "Refs.make(spec)"],
        message: "generated Confect refs must be present",
      },
      {
        file: "packages/convex/confect/_generated/spec.ts",
        includes: ["capabilities", "brain", "jobs", "workpool"],
        message: "generated Confect spec must include core template groups",
      },
    ],
  },
  "confect-compat": {
    name: "check:confect-compat",
    requirements: [
      {
        file: "docs/template/confect-effect-guide.md",
        includes: [
          "@confect/server",
          "9.1.4",
          "effect",
          "3.21.4",
          "@effect/platform-node",
          "0.106.0",
          "convex-test",
          "0.0.54",
          "check:confect-compat",
        ],
        message:
          "Confect guide must record the resolved compatible package matrix",
      },
      {
        file: "packages/convex/package.json",
        includes: [
          '"@confect/core": "9.1.4"',
          '"@confect/server": "9.1.4"',
          '"@confect/test": "9.1.4"',
          '"@effect/platform-node": "0.106.0"',
          '"convex-test": "0.0.54"',
          '"confect:codegen"',
          '"check:convex"',
        ],
        message:
          "Convex package must pin Confect-compatible runtime and codegen scripts",
      },
      {
        file: "apps/web/package.json",
        includes: [
          '"@confect/react": "9.1.4"',
          '"effect": "3.21.4"',
          '"convex": "1.42.1"',
        ],
        message: "web package must pin the Confect React client set",
      },
      {
        file: "apps/cli/package.json",
        includes: [
          '"@confect/js": "9.1.4"',
          '"@effect/platform-node": "0.106.0"',
          '"effect": "3.21.4"',
        ],
        message: "CLI package must pin the Confect JavaScript client set",
      },
    ],
  },
  "schema-migration-notes": {
    name: "check:schema-migration-notes",
    requirements: [
      {
        file: "docs/template/data-lifecycle.md",
        includes: [
          "owner module",
          "retention",
          "export posture",
          "delete posture",
        ],
        message: "data lifecycle docs must require schema metadata",
      },
    ],
  },
  "layer-boundaries": {
    name: "check:layer-boundaries",
    requirements: [
      {
        file: "dependency-cruiser.config.cjs",
        includes: ["forbidden", "from", "to"],
        message: "dependency-cruiser config must enforce layer boundaries",
      },
      {
        file: "package.json",
        includes: ["depcruise --config dependency-cruiser.config.cjs"],
        message:
          "check:layer-boundaries must invoke dependency-cruiser instead of a placeholder check",
      },
    ],
  },
  "secret-canaries": {
    name: "check:secret-canaries",
    requirements: [
      {
        file: ".gitleaks.toml",
        includes: ["generic-api-key", "regex"],
        message: "gitleaks config must include a generic secret rule",
      },
      {
        file: "package.json",
        includes: ["gitleaks detect --config .gitleaks.toml"],
        message: "check:secret-canaries must run gitleaks",
      },
      {
        file: "docs/template/security.md",
        includes: ["Secrets never enter client bundles", "Logs redact secrets"],
        message: "security docs must define secret boundaries",
      },
    ],
  },
  "sbom-license": {
    name: "check:sbom-license",
    requirements: [
      {
        file: "docs/template/extraction/dependency-license-inventory.md",
        includes: ["Dependency And License Inventory", "Private Artifact Rule"],
        message: "dependency/license inventory must exist",
      },
    ],
  },
  "headless-surface-contract": {
    name: "check:headless-surface-contract",
    requirements: [
      {
        file: "README.md",
        includes: ["API/CLI/MCP -> headless registry"],
        message: "architecture docs must include headless projection",
      },
    ],
  },
  "posthog-readiness": {
    name: "check:posthog-readiness",
    requirements: [
      {
        file: "docs/template/integrations.md",
        includes: ["PostHog", "Analytics"],
        message: "integrations docs must include PostHog readiness",
      },
    ],
  },
  "auth-demo-bypass": {
    name: "check:auth-demo-bypass",
    requirements: [
      {
        file: "docs/template/security.md",
        includes: ["No caller-supplied tenant identity"],
        message: "security docs must forbid demo auth bypasses",
      },
    ],
  },
  "workflow-graph-boundary": {
    name: "check:workflow-graph-boundary",
    requirements: [
      {
        file: "packages/workflow-ui/src/index.tsx",
        includes: ["@xyflow/react", "ReactFlow", "WorkflowCanvas"],
        message: "workflow UI package must own React Flow canvas rendering",
      },
      {
        file: "packages/template-core/src/index.ts",
        includes: ["workflow", "nodes", "edges"],
        absent: ["@xyflow/react", "ReactFlow"],
        message:
          "durable workflow registry must not depend on React Flow runtime",
      },
      {
        file: "tooling/workflow/src/index.ts",
        includes: ["createSampleWorkflowRunReceipt"],
        absent: ["@xyflow/react", "ReactFlow"],
        message:
          "headless workflow projection must not depend on React Flow runtime",
      },
    ],
  },
} satisfies Record<string, StaticCheckDescriptor>;

export type CheckName = keyof typeof checkDescriptors;

export function descriptorFor(name: CheckName): StaticCheckDescriptor {
  return checkDescriptors[name];
}
