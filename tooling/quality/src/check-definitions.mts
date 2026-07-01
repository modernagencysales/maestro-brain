import type { StaticCheckDescriptor } from "./gate.mts";

export const checkDescriptors = {
  "ci-completeness": {
    name: "check:ci-completeness",
    requirements: [
      {
        file: ".buildkite/pipeline.yml",
        includes: [
          "pnpm verify",
          "pnpm check:ci-completeness",
          "pnpm check:config-drift",
          "pnpm check:confect-contracts",
          "taste",
          "contract-review",
          "production-promote.sh",
        ],
        message: "Buildkite pipeline must include deterministic and AI gates",
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
          "contract-review",
          "taste:eval",
          "test:mutation",
        ],
        message: "package scripts must expose required quality gates",
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
        file: "pnpm-workspace.yaml",
        includes: ['"apps/*"', '"packages/*"', '"tooling/*"'],
        message:
          "workspace config must include app, package, and tooling roots",
      },
    ],
  },
  "route-tree": {
    name: "check:route-tree",
    requirements: [
      {
        file: "docs/template/repo-map.md",
        includes: ["/brain", "/workflows", "/api", "/admin"],
        message: "repo map must declare planned app routes",
      },
    ],
  },
  "coverage-ratchet": {
    name: "check:coverage-ratchet",
    requirements: [
      {
        file: "vitest.config.ts",
        includes: ["include", "exclude"],
        message: "vitest config must define test discovery boundaries",
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
        includes: ["template:init", "template:add-client-domain"],
        message: "app factory guide must document generator workflow",
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
        file: "AGENTS.md",
        includes: [
          "web routes -> screens -> features -> blocks",
          "agents -> workflows -> capabilities",
        ],
        message: "AGENTS.md must declare layer law",
      },
    ],
  },
  "secret-canaries": {
    name: "check:secret-canaries",
    requirements: [
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
} satisfies Record<string, StaticCheckDescriptor>;

export type CheckName = keyof typeof checkDescriptors;

export function descriptorFor(name: CheckName): StaticCheckDescriptor {
  return checkDescriptors[name];
}
