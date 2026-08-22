import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildDeployDoctorReport,
  buildDeploymentIsolationReceipt,
  buildCompanyBrainRolloutPreflight,
  buildProductionPromotePlan,
  buildRollbackPlan,
  buildStagedReleasePacket,
  buildStagingDeployPlan,
  buildCompletionAuditReport,
  buildClientReleaseReport,
  buildReviewerReadinessReport,
  runReleaseCli,
  smokeWebStaticBuild,
} from "./index";

const makeRepo = (): string => {
  const repoRoot = join(
    tmpdir(),
    `maestro-template-release-${Math.random().toString(16).slice(2)}`,
  );
  const dist = join(repoRoot, "apps/web/dist");
  const assets = join(dist, "assets");

  mkdirSync(assets, { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    '<div id="root"></div><script type="module" src="/assets/index.js"></script>',
  );
  writeFileSync(join(assets, "index.js"), "console.log('ok');");

  return repoRoot;
};

const releaseToolingRepoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const readReleaseRepoFile = (path: string): string =>
  readFileSync(resolve(releaseToolingRepoRoot, path), "utf8");

const validCompanyBrainPilotConfig = {
  schemaVersion: 1,
  organizationKey: "org_apero",
  workspaceId: "workspace_apero",
  activeAgencyBrainKey: "brain_apero",
  owners: {
    context: "Apero context owner",
    engineering: "Maestro engineering",
    connector: "Apero systems owner",
  },
  evaluationSetRef: "restricted://ask-apero/e0-v1",
  dogfoodUsers: ["user-one", "user-two"],
  sourceSlos: Object.fromEntries(
    ["brain-pages", "slack", "transcripts", "documents"].map((corpus) => [
      corpus,
      {
        maxObservationToPublicationMinutes: 5,
        maxReconciliationAgeHours: 24,
        maxEditPropagationMinutes: 10,
        maxRemovalPropagationHours: 4,
        maxNonterminalObligationMinutes: 30,
        deadLetterEscalationMinutes: 60,
      },
    ]),
  ),
  drive: {
    connectionKey: "drive_connection",
    connectionGeneration: 1,
    allowlistGeneration: 1,
    driveId: "shared_drive",
    rootFolderIds: ["folder_b", "folder_a"],
    retentionClass: "internal-company-context",
    permissionPolicyDigest: `sha256:${"a".repeat(64)}`,
    expectedScopeGeneration: 0,
    expectedIntentGeneration: 0,
    expectedConfigurationGeneration: 0,
  },
};

const expectBuildkiteSigningSecretWiring = () => {
  const pipeline = readReleaseRepoFile(".buildkite/pipeline.yml");
  const stagingStep = pipeline.slice(
    pipeline.indexOf('key: "staging-deploy"'),
    pipeline.indexOf('key: "production-approval"'),
  );
  const productionStep = pipeline.slice(
    pipeline.indexOf('key: "production-promote"'),
    pipeline.indexOf("  - wait: ~"),
  );

  expect(stagingStep).toContain("MAESTRO_BRAIN_RELEASE_SIGNER");
  expect(stagingStep).toContain("MAESTRO_BRAIN_RELEASE_SIGNING_KEY_ID");
  expect(stagingStep).toContain("MAESTRO_BRAIN_RELEASE_SIGNING_SECRET");
  expect(productionStep).toContain("MAESTRO_BRAIN_RELEASE_SIGNING_KEY_ID");
  expect(productionStep).toContain("MAESTRO_BRAIN_RELEASE_SIGNING_SECRET");

  const stagingScript = readReleaseRepoFile(
    ".buildkite/scripts/staging-deploy.sh",
  );
  const productionScript = readReleaseRepoFile(
    ".buildkite/scripts/production-promote.sh",
  );
  expect(stagingScript).toContain(
    "MAESTRO_BRAIN_RELEASE_SIGNING_KEY_ID is required",
  );
  expect(stagingScript).toContain(
    "MAESTRO_BRAIN_RELEASE_SIGNING_SECRET is required",
  );
  expect(productionScript).toContain(
    "MAESTRO_BRAIN_RELEASE_SIGNING_KEY_ID is required",
  );
  expect(productionScript).toContain(
    "MAESTRO_BRAIN_RELEASE_SIGNING_SECRET is required",
  );
  expect(`${pipeline}
${stagingScript}
${productionScript}`).not.toContain("test-signing-secret");
};

const makeStartRepo = (): string => {
  const repoRoot = join(
    tmpdir(),
    `maestro-template-start-release-${Math.random().toString(16).slice(2)}`,
  );
  const client = join(repoRoot, "apps/web/dist/client");
  const assets = join(client, "assets");

  mkdirSync(assets, { recursive: true });
  writeFileSync(
    join(client, "_shell.html"),
    '<title>Maestro Template</title><script type="module" src="/assets/index.js"></script>',
  );
  writeFileSync(join(assets, "index.js"), "console.log('ok');");

  return repoRoot;
};

const makeReviewerRepo = (): string => {
  const repoRoot = join(
    tmpdir(),
    `maestro-template-review-${Math.random().toString(16).slice(2)}`,
  );
  const files = [
    "README.md",
    "AGENTS.md",
    "docs/template/investor-reviewer-packet.md",
    "docs/template/reviewer-guide.md",
    "docs/template/repo-map.md",
    "docs/template/confect-effect-guide.md",
    "docs/template/app-factory-guide.md",
    "docs/template/quickstart.md",
    "docs/template/private-package-guide.md",
    "docs/template/hosting.md",
    "docs/template/security.md",
    "docs/template/coding-standards.md",
    "docs/template/capability-authoring-guide.md",
    "docs/template/integrations.md",
    "docs/template/workflow-authoring-guide.md",
    "docs/rule-coverage.md",
    ".buildkite/pipeline.yml",
    "apps/cli/src/index.ts",
    "apps/web/src/routes/index.tsx",
    "apps/web/src/saas-ui/business-shell.tsx",
    "apps/web/src/sample/templateData.ts",
    "apps/web/src/sample/templateData.test.ts",
    "examples/generic-ai-ops/seed/workspace.json",
    "examples/generic-ai-ops/seed/brain-pages.md",
    "examples/generic-ai-ops/seed/workflows.json",
    "packages/convex/confect/http.ts",
    "packages/convex/confect/_generated/refs.ts",
    "packages/convex/confect/jobs/workpool.spec.ts",
    "packages/convex/test/confect-contracts.test.ts",
    "packages/integrations/src/index.ts",
    "packages/integrations/src/index.test.ts",
    "packages/workflow-ui/src/index.tsx",
    "packages/template-core/src/index.ts",
    "tooling/quality/check-auth-demo-bypass.mts",
    "tooling/quality/check-secret-canaries.mts",
    "tooling/quality/check-workflow-graph-boundary.mts",
    "tooling/workflow/src/index.ts",
    "tooling/generators/src/index.ts",
    "tooling/generators/src/index.test.ts",
    "tooling/release/src/index.ts",
    "tooling/release/src/index.test.ts",
    "tests/e2e/hosted-reference-app.spec.ts",
    "tests/e2e/hosted-reference-app.visual.spec.ts",
  ];

  for (const file of files) {
    const fullPath = join(repoRoot, file);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, "ok");
  }

  return repoRoot;
};

const writeEnvManifest = (
  repoRoot: string,
  variables: readonly {
    readonly name: string;
    readonly group: string;
    readonly requiredFor: readonly string[];
  }[],
): void => {
  const path = join(repoRoot, "docs/template/env-manifest.json");

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        schemaVersion: 1,
        variables,
      },
      null,
      2,
    ),
  );
};

const isolatedProjectConfig = {
  project: { name: "maestro-template" },
  environments: {
    staging: {
      name: "staging",
      domain: "staging.example.test",
      cloudflarePagesProject: "maestro-template-staging",
      cloudflareBranch: "staging",
      convexDeployName: "maestro-template-staging",
      convexUrl: "https://staging.convex.cloud",
      convexDeployKeyEnv: "MAESTRO_BRAIN_STAGING_CONVEX_DEPLOY_KEY",
      callbackOriginEnv: "MAESTRO_BRAIN_STAGING_CALLBACK_ORIGIN",
      requiredEnvGroups: ["cloudflare", "convex"],
      requiredSecrets: [
        "MAESTRO_BRAIN_STAGING_CONVEX_DEPLOY_KEY",
        "MAESTRO_BRAIN_STAGING_CLOUDFLARE_API_TOKEN",
        "MAESTRO_BRAIN_STAGING_CLOUDFLARE_ACCOUNT_ID",
      ],
    },
    production: {
      name: "production",
      domain: "example.test",
      cloudflarePagesProject: "maestro-template-production",
      cloudflareBranch: "main",
      convexDeployName: "maestro-template-production",
      convexUrl: "https://production.convex.cloud",
      convexDeployKeyEnv: "MAESTRO_BRAIN_PRODUCTION_CONVEX_DEPLOY_KEY",
      callbackOriginEnv: "MAESTRO_BRAIN_PRODUCTION_CALLBACK_ORIGIN",
      requiredEnvGroups: ["cloudflare", "convex"],
      requiredSecrets: [
        "MAESTRO_BRAIN_PRODUCTION_CONVEX_DEPLOY_KEY",
        "MAESTRO_BRAIN_PRODUCTION_CLOUDFLARE_API_TOKEN",
        "MAESTRO_BRAIN_PRODUCTION_CLOUDFLARE_ACCOUNT_ID",
      ],
    },
  },
};

const writeProjectConfig = (
  repoRoot: string,
  config: unknown = isolatedProjectConfig,
): void => {
  writeFileSync(
    join(repoRoot, "project.config.json"),
    JSON.stringify(config, null, 2),
  );
};

describe("release tooling", () => {
  it("fails the Company Brain rollout preflight on repository placeholders", () => {
    const result = runReleaseCli(
      [
        "company-brain-preflight",
        "company-context/pilot-config.example.v1.json",
      ],
      releaseToolingRepoRoot,
    );
    const report = JSON.parse(result.stdout) as {
      readonly ok: boolean;
      readonly errors: readonly { readonly path: string }[];
      readonly operations: readonly unknown[];
    };

    expect(result.exitCode).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.operations).toEqual([]);
    expect(report.errors.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        "organizationKey",
        "workspaceId",
        "activeAgencyBrainKey",
        "drive.driveId",
        "drive.permissionPolicyDigest",
      ]),
    );
  });

  it("emits deterministic ordered Drive rollout operations from real inputs", () => {
    const repoRoot = join(
      tmpdir(),
      `maestro-company-brain-rollout-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(repoRoot, { recursive: true });
    writeFileSync(
      join(repoRoot, "pilot.json"),
      JSON.stringify(validCompanyBrainPilotConfig),
    );

    try {
      const report = buildCompanyBrainRolloutPreflight({
        repoRoot,
        configPath: "pilot.json",
        now: 1_787_416_000_000,
      });
      expect(report).toMatchObject({
        ok: true,
        errors: [],
        derived: {
          rootFolderIds: ["folder_a", "folder_b"],
          connectorScopeKey: expect.stringMatching(/^gds_[a-f0-9]{64}$/),
          controllingConfigurationDigest: expect.stringMatching(
            /^sha256:[a-f0-9]{64}$/,
          ),
        },
      });
      expect(
        report.operations.map(({ order, functionName }) => ({
          order,
          functionName,
        })),
      ).toEqual([
        {
          order: 1,
          functionName:
            "integrations/providerReconciliation:activateRequiredScope",
        },
        {
          order: 2,
          functionName:
            "integrations/providerReconciliation:upsertDriveScopeConfiguration",
        },
        {
          order: 3,
          functionName:
            "integrations/providerReconciliationWorker:startProviderReconciliation",
        },
        {
          order: 4,
          functionName: "brain/rolloutStatus:getBrainRolloutStatus",
        },
      ]);
      expect(report.operations[0]?.args).toMatchObject({
        providerKind: "google_drive",
        corpusKey: "documents",
        providerContainerKey: "shared_drive",
        activationKind: "activate",
        expectedScopeGeneration: 0,
        now: 1_787_416_000_000,
      });
      expect(report.operations[1]?.args).toMatchObject({
        rootFolderIds: ["folder_a", "folder_b"],
        sharedDrive: true,
        expectedConfigurationGeneration: 0,
      });
      expect(report.operations[3]?.args).toEqual({
        organizationKey: "org_apero",
        workspaceId: "workspace_apero",
        brainKey: "brain_apero",
        now: 1_787_416_000_000,
      });

      const reversed = {
        ...validCompanyBrainPilotConfig,
        drive: {
          ...validCompanyBrainPilotConfig.drive,
          rootFolderIds: ["folder_a", "folder_b"],
        },
      };
      writeFileSync(join(repoRoot, "pilot.json"), JSON.stringify(reversed));
      expect(
        buildCompanyBrainRolloutPreflight({
          repoRoot,
          configPath: "pilot.json",
          now: 1_787_416_000_000,
        }).derived?.connectorScopeKey,
      ).toBe(report.derived?.connectorScopeKey);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects credentials from the Company Brain rollout config", () => {
    const repoRoot = join(
      tmpdir(),
      `maestro-company-brain-secret-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(repoRoot, { recursive: true });
    writeFileSync(
      join(repoRoot, "pilot.json"),
      JSON.stringify({
        ...validCompanyBrainPilotConfig,
        drive: {
          ...validCompanyBrainPilotConfig.drive,
          accessToken: "must-not-live-here",
        },
      }),
    );

    try {
      expect(
        buildCompanyBrainRolloutPreflight({
          repoRoot,
          configPath: "pilot.json",
        }),
      ).toMatchObject({
        ok: false,
        errors: expect.arrayContaining([
          {
            path: "drive.accessToken",
            message: expect.stringContaining("Credentials are forbidden"),
          },
        ]),
        operations: [],
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("passes for a built static web app", () => {
    const repoRoot = makeRepo();

    try {
      expect(smokeWebStaticBuild({ repoRoot })).toMatchObject({
        ok: true,
        assetCount: 1,
        checks: expect.arrayContaining([
          expect.objectContaining({ id: "web:index", status: "pass" }),
          expect.objectContaining({ id: "web:root", status: "pass" }),
          expect.objectContaining({
            id: "web:assets-linked",
            status: "pass",
          }),
        ]),
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("passes for a TanStack Start static shell build", () => {
    const repoRoot = makeStartRepo();

    try {
      expect(smokeWebStaticBuild({ repoRoot })).toMatchObject({
        ok: true,
        assetCount: 1,
        checks: expect.arrayContaining([
          expect.objectContaining({
            id: "web:start-shell",
            status: "pass",
          }),
          expect.objectContaining({
            id: "web:assets-linked",
            status: "pass",
          }),
        ]),
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails clearly before the static build exists", () => {
    const repoRoot = join(
      tmpdir(),
      `maestro-template-release-missing-${Math.random().toString(16).slice(2)}`,
    );

    expect(smokeWebStaticBuild({ repoRoot })).toMatchObject({
      ok: false,
      assetCount: 0,
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "web:index", status: "fail" }),
        expect.objectContaining({ id: "web:assets", status: "fail" }),
      ]),
    });
  });

  it("exposes a CLI smoke report", () => {
    const repoRoot = makeRepo();

    try {
      const result = runReleaseCli(["smoke-web-static"], repoRoot);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        assetCount: 1,
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects shared staging and production Convex backends", () => {
    const repoRoot = makeRepo();

    try {
      writeProjectConfig(repoRoot, {
        project: { name: "maestro-template" },
        environments: {
          staging: {
            ...isolatedProjectConfig.environments.staging,
            convexDeployName: "shared-demo",
            convexUrl: "https://shared.convex.cloud",
          },
          production: {
            ...isolatedProjectConfig.environments.production,
            convexDeployName: "shared-demo",
            convexUrl: "https://shared.convex.cloud",
          },
        },
      });

      expect(() =>
        buildDeployDoctorReport({ repoRoot, environment: "staging", env: {} }),
      ).toThrow(/SharedBackendForbidden/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("requires environment-scoped deploy credentials and callback origins", () => {
    const repoRoot = makeRepo();

    try {
      writeProjectConfig(repoRoot);
      writeEnvManifest(repoRoot, [
        {
          name: "MAESTRO_BRAIN_STAGING_CALLBACK_ORIGIN",
          group: "convex",
          requiredFor: ["deploy"],
        },
      ]);

      expect(
        buildDeployDoctorReport({
          repoRoot,
          environment: "staging",
          env: {
            MAESTRO_BRAIN_PRODUCTION_CONVEX_DEPLOY_KEY: "prod-key",
            MAESTRO_BRAIN_STAGING_CLOUDFLARE_API_TOKEN: "cf-token",
            MAESTRO_BRAIN_STAGING_CLOUDFLARE_ACCOUNT_ID: "cf-account",
          },
        }),
      ).toMatchObject({
        ok: false,
        requiredSecretNames: expect.arrayContaining([
          "MAESTRO_BRAIN_STAGING_CONVEX_DEPLOY_KEY",
        ]),
        missingSecretNames: ["MAESTRO_BRAIN_STAGING_CONVEX_DEPLOY_KEY"],
        requiredEnvNames: expect.arrayContaining([
          "MAESTRO_BRAIN_STAGING_CALLBACK_ORIGIN",
        ]),
        missingEnvNames: ["MAESTRO_BRAIN_STAGING_CALLBACK_ORIGIN"],
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("passes the committed staging deploy doctor with only staging-scoped deploy inputs", () => {
    const repoRoot = resolve(__dirname, "../../..");

    expect(
      buildDeployDoctorReport({
        repoRoot,
        environment: "staging",
        env: {
          MAESTRO_BRAIN_STAGING_CONVEX_DEPLOY_KEY: "staging-key",
          MAESTRO_BRAIN_STAGING_CLOUDFLARE_API_TOKEN: "cf-token",
          MAESTRO_BRAIN_STAGING_CLOUDFLARE_ACCOUNT_ID: "cf-account",
          MAESTRO_BRAIN_STAGING_CALLBACK_ORIGIN:
            "https://maestro-template-staging.pages.dev",
        },
      }),
    ).toMatchObject({
      ok: true,
      missingSecretNames: [],
      missingEnvNames: [],
      requiredEnvNames: ["MAESTRO_BRAIN_STAGING_CALLBACK_ORIGIN"],
      requiredSecretNames: [
        "MAESTRO_BRAIN_STAGING_CONVEX_DEPLOY_KEY",
        "MAESTRO_BRAIN_STAGING_CLOUDFLARE_API_TOKEN",
        "MAESTRO_BRAIN_STAGING_CLOUDFLARE_ACCOUNT_ID",
      ],
    });
  });

  it("passes staging deploy doctor with only staging-scoped deploy inputs", () => {
    const repoRoot = makeRepo();

    try {
      writeProjectConfig(repoRoot, {
        project: { name: "maestro-template" },
        environments: {
          staging: {
            ...isolatedProjectConfig.environments.staging,
            requiredEnvGroups: ["cloudflare", "convex", "fake-providers"],
          },
          production: isolatedProjectConfig.environments.production,
        },
      });
      writeEnvManifest(repoRoot, [
        {
          name: "MAESTRO_BRAIN_STAGING_CALLBACK_ORIGIN",
          group: "convex",
          requiredFor: ["deploy"],
        },
        {
          name: "MAESTRO_BRAIN_PRODUCTION_CALLBACK_ORIGIN",
          group: "convex",
          requiredFor: ["deploy"],
        },
        {
          name: "MAESTRO_BRAIN_PRODUCTION_CONVEX_DEPLOY_KEY",
          group: "convex",
          requiredFor: ["deploy", "live"],
        },
      ]);

      expect(
        buildDeployDoctorReport({
          repoRoot,
          environment: "staging",
          env: {
            MAESTRO_BRAIN_STAGING_CONVEX_DEPLOY_KEY: "staging-key",
            MAESTRO_BRAIN_STAGING_CLOUDFLARE_API_TOKEN: "cf-token",
            MAESTRO_BRAIN_STAGING_CLOUDFLARE_ACCOUNT_ID: "cf-account",
            MAESTRO_BRAIN_STAGING_CALLBACK_ORIGIN:
              "https://maestro-template-staging.pages.dev",
          },
        }),
      ).toMatchObject({
        ok: true,
        requiredSecretNames: expect.not.arrayContaining([
          "MAESTRO_BRAIN_PRODUCTION_CONVEX_DEPLOY_KEY",
        ]),
        requiredEnvNames: expect.not.arrayContaining([
          "MAESTRO_BRAIN_PRODUCTION_CALLBACK_ORIGIN",
        ]),
        missingSecretNames: [],
        missingEnvNames: [],
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects cross-environment Convex deploy key wiring", () => {
    const repoRoot = makeRepo();

    try {
      writeProjectConfig(repoRoot, {
        project: { name: "maestro-template" },
        environments: {
          staging: {
            ...isolatedProjectConfig.environments.staging,
            requiredSecrets: ["MAESTRO_BRAIN_PRODUCTION_CONVEX_DEPLOY_KEY"],
          },
          production: isolatedProjectConfig.environments.production,
        },
      });

      expect(() =>
        buildDeployDoctorReport({ repoRoot, environment: "staging", env: {} }),
      ).toThrow(/EnvironmentCredentialMismatch/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects tenant deploy scripts that seed demo showcase data", () => {
    const repoRoot = makeRepo();

    try {
      writeProjectConfig(repoRoot);
      const scriptPath = join(repoRoot, ".buildkite/scripts/staging-deploy.sh");
      mkdirSync(dirname(scriptPath), { recursive: true });
      writeFileSync(scriptPath, "pnpm exec convex run demo/showcase:seed\n");

      expect(() =>
        buildDeployDoctorReport({ repoRoot, environment: "staging", env: {} }),
      ).toThrow(/DemoSeedForbidden/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("requires an exact staged release packet before production promotion", () => {
    const repoRoot = makeRepo();

    try {
      writeProjectConfig(repoRoot);
      const staged = buildStagedReleasePacket({
        repoRoot,
        commitSha: "abc123",
        deploymentHash: "deploy-hash",
        schemaHash: "schema-hash",
        manifestHash: "manifest-hash",
        buildId: "build-1",
        timestamp: "2026-07-14T00:00:00.000Z",
        signing: {
          signer: "release-bot@example.test",
          keyId: "release-key-1",
          secret: "test-signing-secret",
        },
      });

      expect(
        buildProductionPromotePlan({
          repoRoot,
          stagedSha: "abc123",
          currentSha: "abc123",
          expectedSchemaHash: "schema-hash",
          expectedManifestHash: "manifest-hash",
          releasePacket: staged,
          trustedSigningKeys: { "release-key-1": "test-signing-secret" },
        }),
      ).toMatchObject({ ok: true, releasePacket: staged });
      expect(
        buildProductionPromotePlan({
          repoRoot,
          stagedSha: "abc123",
          currentSha: "abc123",
        }),
      ).toMatchObject({
        ok: false,
        failure: { code: "UnstagedCommit" },
        refusal: expect.stringMatching(/UnstagedCommit/),
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects signed production packets with stale schema or manifest hashes", () => {
    const repoRoot = makeRepo();

    try {
      writeProjectConfig(repoRoot);
      const stale = buildStagedReleasePacket({
        repoRoot,
        commitSha: "abc123",
        deploymentHash: "deploy-hash",
        schemaHash: "old-schema",
        manifestHash: "old-manifest",
        buildId: "build-1",
        timestamp: "2026-07-14T00:00:00.000Z",
        signing: {
          signer: "release-bot@example.test",
          keyId: "release-key-1",
          secret: "test-signing-secret",
        },
      });

      expect(
        buildProductionPromotePlan({
          repoRoot,
          stagedSha: "abc123",
          currentSha: "abc123",
          expectedSchemaHash: "schema-hash",
          expectedManifestHash: "manifest-hash",
          releasePacket: stale,
          trustedSigningKeys: { "release-key-1": "test-signing-secret" },
        }),
      ).toMatchObject({
        ok: false,
        failure: { code: "UnstagedCommit" },
        refusal: expect.stringMatching(/schema\/manifest/),
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects rollback candidates with incompatible schema or manifest", () => {
    const repoRoot = makeRepo();
    writeProjectConfig(repoRoot);
    const current = buildStagedReleasePacket({
      repoRoot,
      commitSha: "current",
      deploymentHash: "deploy-current",
      schemaHash: "schema-v2",
      manifestHash: "manifest-v2",
      buildId: "build-current",
      timestamp: "2026-07-14T01:00:00.000Z",
      signing: {
        signer: "release-bot@example.test",
        keyId: "release-key-1",
        secret: "test-signing-secret",
      },
    });
    const candidate = buildStagedReleasePacket({
      repoRoot,
      commitSha: "previous",
      deploymentHash: "deploy-previous",
      schemaHash: "schema-v1",
      manifestHash: "manifest-v2",
      buildId: "build-previous",
      timestamp: "2026-07-14T00:00:00.000Z",
      signing: {
        signer: "release-bot@example.test",
        keyId: "release-key-1",
        secret: "test-signing-secret",
      },
    });

    expect(buildRollbackPlan({ current, candidate })).toMatchObject({
      ok: false,
      refusal: expect.stringMatching(/IncompatibleRollback/),
    });
  });

  it("rejects rollback candidates that are not prior binaries", () => {
    const repoRoot = makeRepo();
    writeProjectConfig(repoRoot);
    const makePacket = (
      commitSha: string,
      buildId: string,
      timestamp: string,
    ) =>
      buildStagedReleasePacket({
        repoRoot,
        commitSha,
        deploymentHash: `deploy-${commitSha}`,
        schemaHash: "schema-v2",
        manifestHash: "manifest-v2",
        buildId,
        timestamp,
        signing: {
          signer: "release-bot@example.test",
          keyId: "release-key-1",
          secret: "test-signing-secret",
        },
      });
    const current = makePacket(
      "current",
      "build-2",
      "2026-07-14T01:00:00.000Z",
    );

    expect(buildRollbackPlan({ current, candidate: current })).toMatchObject({
      ok: false,
      refusal: expect.stringMatching(/prior binary/),
    });
    expect(
      buildRollbackPlan({
        current,
        candidate: makePacket("future", "build-3", "2026-07-14T02:00:00.000Z"),
      }),
    ).toMatchObject({
      ok: false,
      refusal: expect.stringMatching(/prior binary/),
    });
    expect(
      buildRollbackPlan({
        current,
        candidate: makePacket(
          "previous",
          "build-1",
          "2026-07-14T00:00:00.000Z",
        ),
      }),
    ).toMatchObject({ ok: true });

    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("requires signed release packets with trusted signer and key verification", () => {
    const repoRoot = makeRepo();

    try {
      writeProjectConfig(repoRoot);
      const packet = buildStagedReleasePacket({
        repoRoot,
        commitSha: "abc123",
        deploymentHash: "deploy-hash",
        schemaHash: "schema-hash",
        manifestHash: "manifest-hash",
        buildId: "build-1",
        timestamp: "2026-07-14T00:00:00.000Z",
        signing: {
          signer: "release-bot@example.test",
          keyId: "release-key-1",
          secret: "test-signing-secret",
        },
      });

      expect(packet.signature).toMatchObject({
        algorithm: "hmac-sha256",
        signer: "release-bot@example.test",
        keyId: "release-key-1",
      });
      expect(
        buildProductionPromotePlan({
          repoRoot,
          stagedSha: "abc123",
          currentSha: "abc123",
          releasePacket: { ...packet, manifestHash: "tampered" },
          trustedSigningKeys: { "release-key-1": "test-signing-secret" },
        }),
      ).toMatchObject({
        ok: false,
        failure: { code: "UnstagedCommit" },
      });
      expect(
        buildProductionPromotePlan({
          repoRoot,
          stagedSha: "abc123",
          currentSha: "abc123",
          releasePacket: packet,
          trustedSigningKeys: { "other-key": "test-signing-secret" },
        }),
      ).toMatchObject({
        ok: false,
        failure: { code: "UnstagedCommit" },
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("wires release signing secret names into scoped Buildkite deploy jobs", () => {
    expectBuildkiteSigningSecretWiring();
  });

  it("checks Buildkite release signing wiring independent of cwd", () => {
    const originalCwd = process.cwd();
    const repoRoot = makeRepo();

    try {
      process.chdir(repoRoot);
      expectBuildkiteSigningSecretWiring();
    } finally {
      process.chdir(originalCwd);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("records a deployment isolation receipt without raw URLs or secrets", () => {
    const repoRoot = makeRepo();

    try {
      writeProjectConfig(repoRoot);
      const receipt = buildDeploymentIsolationReceipt({
        repoRoot,
        commandResults: [
          { command: "rtk pnpm --dir tooling/release typecheck", ok: true },
          {
            command: "rtk pnpm deploy:doctor staging",
            ok: false,
            detail: "credentials unavailable",
          },
        ],
      });

      expect(receipt).toMatchObject({
        ok: true,
        environments: {
          staging: {
            convexUrlHash: expect.stringMatching(/^sha256:/),
            deployKeyOwner: "Backend owner",
          },
          production: {
            convexUrlHash: expect.stringMatching(/^sha256:/),
            deployKeyOwner: "Backend owner",
          },
        },
        negativeCrossDeployAttempts: expect.arrayContaining([
          expect.objectContaining({
            attemptedEnvironment: "staging",
            providedKeyEnv: "MAESTRO_BRAIN_PRODUCTION_CONVEX_DEPLOY_KEY",
            failure: expect.objectContaining({
              code: "EnvironmentCredentialMismatch",
            }),
          }),
        ]),
        noDemoSeedTranscript: expect.arrayContaining([
          expect.objectContaining({
            path: ".buildkite/scripts/staging-deploy.sh",
            status: "pass",
          }),
          expect.objectContaining({
            path: ".buildkite/scripts/production-promote.sh",
            status: "pass",
          }),
        ]),
        commandResults: expect.arrayContaining([
          expect.objectContaining({
            command: "rtk pnpm --dir tooling/release typecheck",
            ok: true,
          }),
        ]),
      });
      expect(JSON.stringify(receipt)).not.toContain(
        "https://staging.convex.cloud",
      );
      expect(JSON.stringify(receipt)).not.toContain("test-signing-secret");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("builds an investor readiness report", () => {
    const repoRoot = makeReviewerRepo();

    try {
      const report = buildReviewerReadinessReport({
        repoRoot,
        commit: "abc1234",
        hostedUrl: "https://example.test",
      });

      expect(report).toMatchObject({
        ok: true,
        auditKind: "presence",
        warning:
          "Presence audit only: this report checks required files and listed evidence paths. Run pnpm verify for behavior.",
        commit: "abc1234",
        hostedUrl: "https://example.test",
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            path: "docs/template/investor-reviewer-packet.md",
            status: "pass",
          }),
          expect.objectContaining({
            path: "docs/rule-coverage.md",
            status: "pass",
          }),
          expect.objectContaining({
            path: "packages/convex/confect/_generated/refs.ts",
            status: "pass",
          }),
        ]),
        claims: expect.arrayContaining([
          expect.objectContaining({
            id: "confect-effect-contracts",
            status: "pass",
            evidence: expect.arrayContaining([
              "packages/convex/confect/_generated/refs.ts",
              "packages/convex/test/confect-contracts.test.ts",
            ]),
          }),
          expect.objectContaining({
            id: "app-factory-generators",
            status: "pass",
            evidence: expect.arrayContaining([
              "tooling/generators/src/index.ts",
              "docs/template/private-package-guide.md",
            ]),
          }),
        ]),
        commands: expect.arrayContaining([
          "pnpm check:format",
          "pnpm check:confect-contracts",
          "pnpm check:confect-compat",
          "pnpm smoke:hosted:browser",
          "pnpm smoke:hosted:visual",
        ]),
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("exposes a CLI investor readiness report", () => {
    const repoRoot = makeReviewerRepo();

    try {
      const result = runReleaseCli(["review-readiness"], repoRoot);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        auditKind: "presence",
        warning:
          "Presence audit only: this report checks required files and listed evidence paths. Run pnpm verify for behavior.",
        hostedUrl: "https://maestro-template.pages.dev",
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("builds a completion audit report", () => {
    const repoRoot = makeReviewerRepo();

    try {
      const report = buildCompletionAuditReport({
        repoRoot,
        commit: "abc1234",
        hostedUrl: "https://example.test",
      });

      expect(report).toMatchObject({
        ok: true,
        auditKind: "presence",
        warning:
          "Presence audit only: this report checks evidence paths. It does not execute verification commands or inspect generated handoff content; run pnpm verify and client-release for behavior.",
        commit: "abc1234",
        hostedUrl: "https://example.test",
        requirements: expect.arrayContaining([
          expect.objectContaining({
            id: "private-template-repo",
            status: "pass",
          }),
          expect.objectContaining({
            id: "clear-sample-app",
            status: "pass",
            verification: expect.arrayContaining([
              "pnpm smoke:hosted:browser",
              "pnpm smoke:hosted:visual",
            ]),
          }),
          expect.objectContaining({
            id: "investor-handoff",
            status: "pass",
          }),
          expect.objectContaining({
            id: "day-0-factory-loop",
            status: "pass",
            evidence: expect.arrayContaining([
              "docs/template/quickstart.md",
              "tooling/generators/src/index.test.ts",
              "tooling/release/src/index.test.ts",
            ]),
            verification: expect.arrayContaining([
              'pnpm template:quickstart -- --blueprint source-grounded-gtm-brain --name "Reviewer Brain" --write',
              "pnpm template:doctor -- --mode fake",
              "pnpm template:handoff -- --mode fake --write",
            ]),
          }),
        ]),
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("exposes a CLI completion audit report", () => {
    const repoRoot = makeReviewerRepo();

    try {
      const result = runReleaseCli(["review-completion"], repoRoot);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        auditKind: "presence",
        warning:
          "Presence audit only: this report checks evidence paths. It does not execute verification commands or inspect generated handoff content; run pnpm verify and client-release for behavior.",
        hostedUrl: "https://maestro-template.pages.dev",
        requirements: expect.arrayContaining([
          expect.objectContaining({ id: "app-factory", status: "pass" }),
        ]),
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("builds deploy doctor reports without leaking secret values", () => {
    const repoRoot = makeReviewerRepo();
    writeEnvManifest(repoRoot, [
      {
        name: "CLOUDFLARE_API_TOKEN",
        group: "cloudflare",
        requiredFor: ["deploy"],
      },
      {
        name: "CONVEX_DEPLOY_KEY",
        group: "convex",
        requiredFor: ["deploy"],
      },
      {
        name: "WORKOS_API_KEY",
        group: "workos",
        requiredFor: ["live"],
      },
    ]);
    writeFileSync(
      join(repoRoot, "project.config.json"),
      JSON.stringify({
        project: { name: "maestro-template" },
        environments: {
          staging: {
            name: "staging",
            domain: "staging.example.test",
            cloudflarePagesProject: "maestro-template-staging",
            cloudflareBranch: "staging",
            convexDeployName: "maestro-template-staging",
            requiredEnvGroups: ["cloudflare", "convex"],
            requiredSecrets: ["CLOUDFLARE_API_TOKEN", "CONVEX_DEPLOY_KEY"],
          },
          production: {
            name: "production",
            domain: "app.example.test",
            cloudflarePagesProject: "maestro-template",
            cloudflareBranch: "main",
            convexDeployName: "maestro-template-production",
            requiredEnvGroups: ["cloudflare", "convex"],
            requiredSecrets: ["CLOUDFLARE_API_TOKEN", "CONVEX_DEPLOY_KEY"],
          },
        },
      }),
    );

    try {
      const report = buildDeployDoctorReport({
        repoRoot,
        environment: "staging",
        env: { CLOUDFLARE_API_TOKEN: "super-secret-value" },
      });

      expect(report).toMatchObject({
        ok: false,
        environment: "staging",
        cloudflarePagesProject: "maestro-template-staging",
        requiredEnvNames: ["CLOUDFLARE_API_TOKEN", "CONVEX_DEPLOY_KEY"],
        missingEnvNames: ["CONVEX_DEPLOY_KEY"],
        missingSecretNames: ["CONVEX_DEPLOY_KEY"],
        alert: {
          severity: "warning",
          title: "Deploy doctor failed: staging",
          dedupeKey: "deploy-doctor:staging:CONVEX_DEPLOY_KEY",
          metadata: {
            environment: "staging",
            missingEnvNames: ["CONVEX_DEPLOY_KEY"],
            missingSecretNames: ["CONVEX_DEPLOY_KEY"],
          },
        },
      });
      expect(JSON.stringify(report)).not.toContain("super-secret-value");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("uses manifest groups to require live provider env for production deploys", () => {
    const repoRoot = makeReviewerRepo();
    writeEnvManifest(repoRoot, [
      {
        name: "OPENROUTER_API_KEY",
        group: "openrouter",
        requiredFor: ["live"],
      },
      {
        name: "POSTHOG_PROJECT_TOKEN",
        group: "posthog",
        requiredFor: ["live"],
      },
      {
        name: "CLOUDFLARE_API_TOKEN",
        group: "cloudflare",
        requiredFor: ["deploy"],
      },
      {
        name: "LOCAL_ONLY_FAKE_KEY",
        group: "openrouter",
        requiredFor: ["fake"],
      },
    ]);
    writeFileSync(
      join(repoRoot, "project.config.json"),
      JSON.stringify({
        project: { name: "maestro-template" },
        environments: {
          staging: {
            name: "staging",
            domain: "staging.example.test",
            cloudflarePagesProject: "maestro-template-staging",
            cloudflareBranch: "staging",
            convexDeployName: "maestro-template-staging",
            requiredEnvGroups: ["cloudflare"],
            requiredSecrets: [],
          },
          production: {
            name: "production",
            domain: "app.example.test",
            cloudflarePagesProject: "maestro-template",
            cloudflareBranch: "main",
            convexDeployName: "maestro-template-production",
            requiredEnvGroups: ["cloudflare", "llm", "posthog"],
            requiredSecrets: [],
          },
        },
      }),
    );

    try {
      expect(
        buildDeployDoctorReport({
          repoRoot,
          environment: "production",
          env: {
            CLOUDFLARE_API_TOKEN: "cloudflare-secret",
            POSTHOG_PROJECT_TOKEN: "posthog-secret",
          },
        }),
      ).toMatchObject({
        ok: false,
        requiredEnvNames: [
          "CLOUDFLARE_API_TOKEN",
          "OPENROUTER_API_KEY",
          "POSTHOG_PROJECT_TOKEN",
        ],
        missingEnvNames: ["OPENROUTER_API_KEY"],
        alert: {
          severity: "critical",
          title: "Deploy doctor failed: production",
          dedupeKey: "deploy-doctor:production:OPENROUTER_API_KEY",
          metadata: {
            missingEnvNames: ["OPENROUTER_API_KEY"],
          },
        },
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("builds staging and production promotion plans from project config", () => {
    const repoRoot = makeReviewerRepo();
    writeFileSync(
      join(repoRoot, "project.config.json"),
      JSON.stringify({
        project: { name: "maestro-template" },
        environments: {
          staging: {
            name: "staging",
            domain: "staging.example.test",
            cloudflarePagesProject: "maestro-template-staging",
            cloudflareBranch: "staging",
            convexDeployName: "maestro-template-staging",
            requiredEnvGroups: ["cloudflare", "convex"],
            requiredSecrets: [],
          },
          production: {
            name: "production",
            domain: "app.example.test",
            cloudflarePagesProject: "maestro-template",
            cloudflareBranch: "main",
            convexDeployName: "maestro-template-production",
            requiredEnvGroups: ["cloudflare", "convex"],
            requiredSecrets: [],
          },
        },
      }),
    );

    try {
      expect(
        buildStagingDeployPlan({
          repoRoot,
          commitSha: "abc123",
        }),
      ).toMatchObject({
        environment: "staging",
        commitSha: "abc123",
        cloudflarePagesProject: "maestro-template-staging",
        cloudflareBranch: "staging",
        convexDeployName: "maestro-template-staging",
      });
      const releasePacket = buildStagedReleasePacket({
        repoRoot,
        commitSha: "abc123",
        deploymentHash: "deploy-hash",
        schemaHash: "schema-hash",
        manifestHash: "manifest-hash",
        buildId: "build-1",
        timestamp: "2026-07-14T00:00:00.000Z",
        signing: {
          signer: "release-bot@example.test",
          keyId: "release-key-1",
          secret: "test-signing-secret",
        },
      });
      expect(
        buildProductionPromotePlan({
          repoRoot,
          stagedSha: "abc123",
          currentSha: "abc123",
          expectedSchemaHash: "schema-hash",
          expectedManifestHash: "manifest-hash",
          releasePacket,
          trustedSigningKeys: { "release-key-1": "test-signing-secret" },
        }),
      ).toMatchObject({
        ok: true,
        environment: "production",
        commitSha: "abc123",
        cloudflarePagesProject: "maestro-template",
        cloudflareBranch: "main",
      });
      expect(
        buildProductionPromotePlan({
          repoRoot,
          stagedSha: "abc123",
          currentSha: "def456",
        }),
      ).toMatchObject({
        ok: false,
        failure: { code: "UnstagedCommit" },
        refusal:
          "UnstagedCommit: staged SHA abc123 does not match current SHA def456.",
        alert: {
          severity: "critical",
          title: "Production promotion refused",
          dedupeKey: "production-promote:def456:production",
          metadata: {
            environment: "production",
            commitSha: "def456",
            refusal:
              "UnstagedCommit: staged SHA abc123 does not match current SHA def456.",
          },
        },
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("builds a client release report with compatibility checks and handoff artifacts", () => {
    const repoRoot = makeReviewerRepo();
    const files = [
      "template-instance.json",
      "docs/template/generated/client-intake.md",
      "docs/template/generated/implementation-brief.md",
      "docs/template/generated/provider-setup-checklist.md",
      "docs/template/generated/handoff-packet.md",
      "docs/template/env-manifest.md",
      "docs/template/template-release-process.md",
    ];

    for (const file of files) {
      const fullPath = join(repoRoot, file);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(
        fullPath,
        file === "docs/template/generated/handoff-packet.md"
          ? "`real`\n`fake`\n`seam`\n`planned`\n"
          : "ok",
      );
    }

    try {
      const report = buildClientReleaseReport({
        repoRoot,
        templateVersion: "template-v1.2.0",
        clientVersion: "client-v0.1.0",
      });

      expect(report).toMatchObject({
        ok: true,
        templateVersion: "template-v1.2.0",
        clientVersion: "client-v0.1.0",
        compatibility: {
          status: "ready-for-review",
          requiredChecks: expect.arrayContaining([
            "pnpm check:generators",
            "pnpm check:confect-contracts",
            "pnpm check:workflow-graph-boundary",
          ]),
        },
        handoffArtifacts: expect.arrayContaining([
          expect.objectContaining({
            path: "docs/template/generated/client-intake.md",
            status: "pass",
          }),
          expect.objectContaining({
            path: "template-instance.json",
            status: "pass",
          }),
        ]),
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails client release when the handoff packet omits status labels", () => {
    const repoRoot = makeReviewerRepo();
    const files = [
      "template-instance.json",
      "docs/template/generated/client-intake.md",
      "docs/template/generated/implementation-brief.md",
      "docs/template/generated/provider-setup-checklist.md",
      "docs/template/generated/handoff-packet.md",
      "docs/template/env-manifest.md",
      "docs/template/template-release-process.md",
    ];

    for (const file of files) {
      const fullPath = join(repoRoot, file);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, "ok");
    }

    try {
      const report = buildClientReleaseReport({
        repoRoot,
        templateVersion: "template-v1.2.0",
        clientVersion: "client-v0.1.0",
      });

      expect(report).toMatchObject({
        ok: false,
        compatibility: {
          status: "missing-artifacts",
        },
        handoffArtifacts: expect.arrayContaining([
          expect.objectContaining({
            path: "docs/template/generated/handoff-packet.md",
            status: "fail",
            detail: "missing handoff status labels: real, fake, seam, planned",
          }),
        ]),
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("exposes a client release report through the release CLI", () => {
    const repoRoot = makeReviewerRepo();
    writeFileSync(join(repoRoot, "template-instance.json"), "ok");

    try {
      const result = runReleaseCli(
        ["client-release", "template-v1.2.0", "client-v0.1.0"],
        repoRoot,
      );

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        templateVersion: "template-v1.2.0",
        clientVersion: "client-v0.1.0",
        handoffArtifacts: expect.arrayContaining([
          expect.objectContaining({
            path: "docs/template/generated/client-intake.md",
            status: "fail",
          }),
        ]),
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("exposes deploy doctor and plan reports through the release CLI", () => {
    const repoRoot = makeReviewerRepo();
    writeFileSync(
      join(repoRoot, "project.config.json"),
      JSON.stringify({
        project: { name: "maestro-template" },
        environments: {
          staging: {
            name: "staging",
            domain: "staging.example.test",
            cloudflarePagesProject: "maestro-template-staging",
            cloudflareBranch: "staging",
            convexDeployName: "maestro-template-staging",
            requiredEnvGroups: ["cloudflare"],
            requiredSecrets: [],
          },
          production: {
            name: "production",
            domain: "app.example.test",
            cloudflarePagesProject: "maestro-template",
            cloudflareBranch: "main",
            convexDeployName: "maestro-template-production",
            requiredEnvGroups: ["cloudflare"],
            requiredSecrets: [],
          },
        },
      }),
    );

    try {
      expect(
        JSON.parse(
          runReleaseCli(["deploy-doctor", "staging"], repoRoot).stdout,
        ),
      ).toMatchObject({
        ok: true,
        environment: "staging",
        requiredSecretNames: [],
      });
      expect(
        JSON.parse(runReleaseCli(["deploy-doctor"], repoRoot).stdout),
      ).toMatchObject({
        ok: true,
        environment: "production",
        requiredSecretNames: [],
      });
      expect(
        JSON.parse(
          runReleaseCli(["deploy-plan", "staging", "abc123"], repoRoot).stdout,
        ),
      ).toMatchObject({
        ok: true,
        cloudflarePagesProject: "maestro-template-staging",
      });
      const stagedPacket = JSON.stringify({
        commitSha: "abc123",
        deploymentHash: "deploy-hash",
        schemaHash: "schema-hash",
        manifestHash: "manifest-hash",
        buildId: "build-1",
        timestamp: "2026-07-14T00:00:00.000Z",
      });
      expect(
        JSON.parse(
          runReleaseCli(
            [
              "promote-plan",
              "abc123",
              "def456",
              "schema-hash",
              "manifest-hash",
              stagedPacket,
            ],
            repoRoot,
          ).stdout,
        ),
      ).toMatchObject({
        ok: false,
        failure: { code: "UnstagedCommit" },
        refusal:
          "UnstagedCommit: staged SHA abc123 does not match current SHA def456.",
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
