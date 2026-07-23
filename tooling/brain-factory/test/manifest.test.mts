import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isIntegrationOwnedGeneratedFile } from "../src/lane-ownership.js";
import {
  buildManifest,
  loadManifestProjection,
  MANIFEST_RELATIVE,
  parseAuxiliaryControlTask,
  PLAN_RELATIVE,
  parseAuthorityRepairTransition,
  parseLaneGreenAuthorityReproofTransition,
  parseOwnershipRehomeTransition,
  parsePlanOnlyLaneAuthorityRegistry,
  parseTaskPacketAuditRows,
  REPO_ROOT,
  readyWidth,
  taskBlockHashWithoutLaneGreenAuthority,
  validateManifest,
} from "../src/manifest.js";
import { PARALLELISM_CONTRACT_RELATIVE } from "../src/parallelism-contract.js";

const copyFixture = (relative: string, root: string): void => {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(join(REPO_ROOT, relative)));
};

const generatorDryRunPaths = (args: readonly string[]): readonly string[] => {
  const output = execFileSync(
    resolve(REPO_ROOT, "node_modules/.bin/tsx"),
    [resolve(REPO_ROOT, "tooling/generators/src/index.ts"), ...args],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  const plan = JSON.parse(output) as {
    readonly files: readonly { readonly path: string }[];
  };
  return plan.files.map((file) => file.path);
};

describe("Maestro Brain execution manifest", () => {
  it("projects only exact final-pass plan-only authority records", () => {
    const manifest = buildManifest(REPO_ROOT);
    const authorized = manifest.tasks.filter(
      (task) => task.planOnlyLaneAuthorityTransition !== undefined,
    );
    expect(authorized.map(({ taskId }) => taskId)).toEqual([
      "S06-T01",
      "S11-T02",
      "S13-T02",
    ]);
    for (const task of authorized) {
      const transition = task.planOnlyLaneAuthorityTransition;
      expect(transition?.schemaVersion).toBe(
        "maestro-brain-plan-only-lane-authority/v1",
      );
      expect(transition?.fromPlanSha256).not.toBe(manifest.planSha256);
      expect(transition?.taskBlockHash).toBe(task.taskBlockHash);
      expect(transition?.requiredIntegratedTaskIds).toEqual(
        task.codeStartAfter,
      );
      expect(transition?.sourceCommits).toHaveLength(
        transition?.sourceCommitPatchSha256s.length ?? -1,
      );
    }
  });

  it("rejects malformed or unauthorized plan-only registry records", () => {
    const valid = {
      schemaVersion: "maestro-brain-plan-only-lane-authority/v1",
      taskId: "S06-T01",
      fromPlanSha256: "a".repeat(64),
      taskBlockHash: "b".repeat(64),
      sourceRunId: "01KXYX8E74VJ6XPM629VVMPYH5",
      sourceBaseSha: "c".repeat(40),
      sourceHeadSha: "d".repeat(40),
      sourceTreeSha: "e".repeat(40),
      sourceCommits: ["d".repeat(40)],
      sourceCommitPatchSha256s: ["f".repeat(64)],
      laneResultSha256: "1".repeat(64),
      ciProofPacketSha256: "2".repeat(64),
      laneGateReportSha256: "3".repeat(64),
      requiredIntegratedTaskIds: ["S05-T01"],
    };
    const registry = (records: readonly unknown[]): string =>
      `## Appendix Q — Plan-only lane authority registry\n\n\`\`\`json\n${JSON.stringify(records)}\n\`\`\``;
    expect(
      parsePlanOnlyLaneAuthorityRegistry(registry([valid])).get("S06-T01"),
    ).toEqual(expect.objectContaining({ sourceHeadSha: "d".repeat(40) }));
    for (const invalid of [
      { ...valid, taskId: "S05-T01" },
      { ...valid, taskId: "S13-T03" },
      { ...valid, fromPlanSha256: "a" },
      { ...valid, sourceCommits: [] },
      { ...valid, sourceCommitPatchSha256s: [] },
      { ...valid, unexpected: true },
    ]) {
      expect(() =>
        parsePlanOnlyLaneAuthorityRegistry(registry([invalid])),
      ).toThrow();
    }
    expect(() =>
      parsePlanOnlyLaneAuthorityRegistry(registry([valid, valid])),
    ).toThrow("duplicate plan-only authority task S06-T01");
  });

  const transitionBody = (overrides: Record<string, unknown> = {}): string =>
    `- **Authority-repair transition:**\n  \`\`\`json\n${JSON.stringify(
      {
        schemaVersion: "maestro-brain-authority-repair-transition/v1",
        mode: "path-rehome",
        fromPlanSha256: "a".repeat(64),
        fromTaskBlockHash: "b".repeat(64),
        sourceRunId: "01KXZP38CAC2GYAF2YA7NRTBQK",
        sourceBaseSha: "c".repeat(40),
        sourceHeadSha: "d".repeat(40),
        sourceTreeSha: "e".repeat(40),
        requiredIntegratedTaskIds: ["S05-T01"],
        immutableFindings: [
          {
            kind: "git-blob",
            objectSha: "f".repeat(40),
            contentSha256: "1".repeat(64),
          },
        ],
        supersededPaths: [
          {
            path: "packages/example/obsolete.ts",
            replacementPath: "packages/example/current.ts",
            disposition: "replaced-by-current-owned-artifact",
          },
        ],
        ...overrides,
      },
      null,
      2,
    )}\n  \`\`\``;

  const ownershipRehomeBody = (
    overrides: Record<string, unknown> = {},
  ): string =>
    `- **Ownership-rehome transition:**\n  \`\`\`json\n${JSON.stringify(
      {
        schemaVersion: "maestro-brain-ownership-rehome-transition/v1",
        classification: "ownership-rehome",
        fromPlanSha256: "a".repeat(64),
        fromTaskBlockHash: "b".repeat(64),
        sourceRunId: "01KY02VYKQ71T4SDE6ZPPBS205",
        sourceBaseSha: "c".repeat(40),
        sourceHeadSha: "d".repeat(40),
        sourceTreeSha: "e".repeat(40),
        requiredIntegratedTaskIds: ["S02-T02", "S02-T04"],
        immutableFinding: {
          kind: "git-blob",
          ref: "refs/maestro-brain/evidence/s03-t03-ownership-rehome-20260720",
          objectSha: "f".repeat(40),
          contentSha256: "1".repeat(64),
        },
        supersededPaths: [
          {
            path: "docs/old-plan.md",
            replacementPath:
              "docs/product/maestro-brain-lifecycle-adoption/S03-T03.md",
            disposition: "replaced-by-current-owned-artifact",
          },
        ],
        ...overrides,
      },
      null,
      2,
    )}\n  \`\`\``;

  const laneGreenAuthorityReproofBody = (
    overrides: Record<string, unknown> = {},
  ): string =>
    `- **Lane-green authority reproof transition:**\n\n  \`\`\`json\n${JSON.stringify(
      {
        schemaVersion: "maestro-brain-lane-green-authority-reproof/v1",
        proofBaseSha: "a".repeat(40),
        proofHeadSha: "b".repeat(40),
        proofPlanSha256: "c".repeat(64),
        proofTaskBlockHash: "d".repeat(64),
        proofFindingIds: ["OWNERSHIP-S05-T01-001"],
        proofGateStage: "pre-review",
        proofChangedFiles: [
          "packages/example/owned.ts",
          "packages/example/proof-only.ts",
        ],
        sourceBaseSha: "e".repeat(40),
        sourceCommits: ["f".repeat(40), "1".repeat(40)],
        sourceChangedFiles: ["packages/example/owned.ts"],
        sourceHeadSha: "1".repeat(40),
        sourceTreeSha: "2".repeat(40),
        ...overrides,
      },
      null,
      2,
    )}\n  \`\`\``;

  it("validates every lane-green authority transition field", () => {
    expect(
      parseLaneGreenAuthorityReproofTransition(
        laneGreenAuthorityReproofBody(),
        "S05-T01",
      ),
    ).toEqual(
      expect.objectContaining({
        proofHeadSha: "b".repeat(40),
        sourceHeadSha: "1".repeat(40),
      }),
    );
    const invalid: readonly Record<string, unknown>[] = [
      { schemaVersion: "wrong" },
      { proofBaseSha: "a" },
      { proofHeadSha: "b" },
      { proofPlanSha256: "c" },
      { proofTaskBlockHash: "d" },
      { proofFindingIds: [] },
      { proofGateStage: "final" },
      { proofChangedFiles: [] },
      { sourceBaseSha: "e" },
      { sourceCommits: [] },
      { sourceChangedFiles: [] },
      { sourceHeadSha: "3".repeat(40) },
      { sourceTreeSha: "2" },
      { unexpected: true },
    ];
    for (const override of invalid) {
      expect(() =>
        parseLaneGreenAuthorityReproofTransition(
          laneGreenAuthorityReproofBody(override),
          "S05-T01",
        ),
      ).toThrow();
    }
  });

  it("forbids combining lane-green and another authority transition", () => {
    const root = mkdtempSync(join(tmpdir(), "manifest-lane-green-exclusive-"));
    copyFixture(PLAN_RELATIVE, root);
    const path = join(root, PLAN_RELATIVE);
    const plan = readFileSync(path, "utf8").replace(
      "### S05-T02",
      `${transitionBody()}\n\n### S05-T02`,
    );
    writeFileSync(path, plan);
    expect(() => buildManifest(root)).toThrow(
      "S05-T01: multiple authority transitions are forbidden",
    );
  });

  it("distinguishes path-rehome and contract-only authority repairs", () => {
    expect(
      parseAuthorityRepairTransition(transitionBody(), "S10-T01")?.mode,
    ).toBe("path-rehome");
    expect(
      parseAuthorityRepairTransition(
        transitionBody({ mode: "contract-only", supersededPaths: [] }),
        "S03-T03",
      ),
    ).toEqual(
      expect.objectContaining({ mode: "contract-only", supersededPaths: [] }),
    );
    expect(() =>
      parseAuthorityRepairTransition(
        transitionBody({ supersededPaths: [] }),
        "S10-T01",
      ),
    ).toThrow("path-rehome repair requires superseded paths");
    expect(() =>
      parseAuthorityRepairTransition(
        transitionBody({ mode: "contract-only" }),
        "S03-T03",
      ),
    ).toThrow("contract-only repair cannot supersede paths");
  });

  it("parses a distinct immutable ownership-rehome transition", () => {
    expect(
      parseOwnershipRehomeTransition(ownershipRehomeBody(), "S03-T03"),
    ).toEqual(
      expect.objectContaining({
        classification: "ownership-rehome",
        requiredIntegratedTaskIds: ["S02-T02", "S02-T04"],
      }),
    );
    expect(() =>
      parseOwnershipRehomeTransition(
        ownershipRehomeBody({ classification: "authority-repair" }),
        "S03-T03",
      ),
    ).toThrow("invalid ownership-rehome transition classification");
    expect(() =>
      parseOwnershipRehomeTransition(
        ownershipRehomeBody({ immutableFinding: undefined }),
        "S03-T03",
      ),
    ).toThrow("ownership-rehome transition");
  });

  it("projects every dependency classification and collision without changing task contracts", () => {
    const projection = loadManifestProjection();
    const generated = buildManifest();

    expect(projection.manifest).toEqual(generated);
    expect(projection.tasks).toHaveLength(58);
    expect(
      projection.tasks.map(
        ({
          classifiedCodeStartAfter: _dependencies,
          collisions: _collisions,
          ...task
        }) => {
          void _dependencies;
          void _collisions;
          return task;
        },
      ),
    ).toEqual(generated.tasks);
    expect(
      projection.tasks.flatMap((task) => task.classifiedCodeStartAfter),
    ).toHaveLength(98);
    expect(
      projection.tasks
        .flatMap((task) => task.classifiedCodeStartAfter)
        .filter((dependency) => dependency.classification === "true"),
    ).toHaveLength(54);
    expect(
      projection.tasks
        .flatMap((task) => task.classifiedCodeStartAfter)
        .filter((dependency) => dependency.classification === "contract"),
    ).toHaveLength(44);

    const providerSetup = projection.tasks.find(
      (task) => task.taskId === "S04-T01",
    );
    expect(providerSetup?.classifiedCodeStartAfter).toEqual([
      expect.objectContaining({
        classification: "contract",
        producerTaskId: "S00-T03",
      }),
      expect.objectContaining({
        classification: "contract",
        producerTaskId: "S01-T02",
      }),
    ]);
    expect(providerSetup?.codeStartAfter).toEqual(["S00-T03", "S01-T02"]);
    expect(providerSetup?.acceptanceAfter).toBe(
      generated.tasks.find((task) => task.taskId === "S04-T01")
        ?.acceptanceAfter,
    );

    const headless = projection.tasks.find((task) => task.taskId === "S11-T02");
    expect(headless?.collisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          otherTaskId: "S02-T02",
          paths: expect.arrayContaining([
            "packages/convex/confect/http.ts",
            "packages/convex/confect/manifest/executor.ts",
          ]),
          policy: "serialize",
        }),
      ]),
    );
  });

  it("rejects checked-in manifest plan and task hash drift before projection", () => {
    const root = mkdtempSync(join(tmpdir(), "manifest-projection-"));
    for (const relative of [
      PLAN_RELATIVE,
      MANIFEST_RELATIVE,
      PARALLELISM_CONTRACT_RELATIVE,
    ]) {
      copyFixture(relative, root);
    }
    const path = join(root, MANIFEST_RELATIVE);
    const manifest = JSON.parse(readFileSync(path, "utf8")) as {
      planSha256: string;
      tasks: Array<{ taskBlockHash: string; taskId: string }>;
    };
    manifest.planSha256 = "0".repeat(64);
    const firstTask = manifest.tasks[0];
    if (!firstTask) throw new Error("manifest task fixture is empty");
    firstTask.taskBlockHash = "f".repeat(64);
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);

    expect(() => loadManifestProjection(root)).toThrow(
      /checked-in manifest plan hash .* generated plan hash/,
    );

    manifest.planSha256 = buildManifest(root).planSha256;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(() => loadManifestProjection(root)).toThrow(
      /S00-T01: checked-in task hash .* generated task hash/,
    );
  });

  it("preserves every audited task and classification", () => {
    const manifest = buildManifest();
    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.tasks).toHaveLength(58);
    expect(
      Object.fromEntries(
        ["template-gap", "pattern-instance", "fixture-to-real"].map((kind) => [
          kind,
          manifest.tasks.filter((task) => task.classification === kind).length,
        ]),
      ),
    ).toEqual({
      "fixture-to-real": 2,
      "pattern-instance": 8,
      "template-gap": 48,
    });
  });

  it("binds the S05 registry transition to its green head without an integration deadlock", () => {
    const manifest = buildManifest();
    const transition = manifest.tasks.find((task) => task.taskId === "S15-T02");

    expect(transition).toEqual(
      expect.objectContaining({
        taskId: "S15-T02",
        kind: "control",
        classification: "template-gap",
        sourceSliceBudget: 300,
        sourceSliceLimit: 1,
        gateProfiles: ["convex", "tooling"],
        fileLocks: [
          "packages/convex/confect/internal/migrations.ts",
          "tooling/brain-factory/src/integration-generated-proof.ts",
          "tooling/brain-factory/test/integration-generated-proof.test.mts",
        ],
        greenHeadAfter: "S05-T01",
        mandatorySameWaveAfter: "S05-T01",
      }),
    );
    expect(transition?.codeStartAfter).not.toContain("S05-T01");
    expect(validateManifest(manifest)).toEqual([]);
    expect(
      validateManifest({
        ...manifest,
        tasks: manifest.tasks.map((task) =>
          task.taskId === "S15-T02"
            ? { ...task, codeStartAfter: ["S05-T01"] }
            : task,
        ),
      }),
    ).toContain(
      "S15-T02: green-head prerequisite S05-T01 cannot also be an integrated code-start dependency",
    );

    const invalidTransitions = [
      { kind: "product" as const },
      { classification: "pattern-instance" as const },
      { gateProfiles: ["tooling"] as const },
      { fileLocks: ["wrong.ts"] as const },
      { sourceSliceBudget: 301 as never },
      { sourceSliceLimit: 2 },
    ];
    for (const override of invalidTransitions) {
      const invalid = {
        ...manifest,
        tasks: manifest.tasks.map((task) =>
          task.taskId === "S15-T02" ? { ...task, ...override } : task,
        ),
      };
      expect(
        validateManifest(invalid).join("\n"),
        JSON.stringify(override),
      ).toContain("S15-T02: invalid migration-registry transition contract");
    }
  });

  it("derives the S15-T02 task-block hash from its canonical plan block", () => {
    const plan = readFileSync(resolve(REPO_ROOT, PLAN_RELATIVE), "utf8");
    const transition = parseAuxiliaryControlTask(plan);
    const generated = buildManifest().tasks.find(
      (task) => task.taskId === "S15-T02",
    );
    expect(generated).toEqual(transition);
    expect(
      parseAuxiliaryControlTask(
        plan.replace(
          '"estimatedSourceLines": 180',
          '"estimatedSourceLines": 179',
        ),
      ).taskBlockHash,
    ).not.toBe(generated?.taskBlockHash);
  });

  it("keeps every focused verification packet executable", () => {
    const plan = readFileSync(resolve(REPO_ROOT, PLAN_RELATIVE), "utf8");
    const shorthand = [
      "accessibility smoke",
      "accessibility test",
      "all exact release commands",
      "codegen/manifest",
      "generator/codegen/manifest",
      "integration fake tests",
      "property/concurrency tests",
      "schema/property tests",
      "targeted web tests",
    ];
    for (const match of plan.matchAll(
      /^### (S\d{2}-T\d{2}) — [^\n]+\n([\s\S]*?)(?=^### S\d{2}-T\d{2} — |^---$)/gm,
    )) {
      const taskId = match[1];
      const body = match[2] ?? "";
      const focused = body.match(
        /- \*\*Focused verification:\*\*([\s\S]*?)(?=\n- \*\*)/,
      )?.[1];
      expect(focused, `${taskId}: focused verification missing`).toBeDefined();
      expect(focused, `${taskId}: no exact rtk verification command`).toContain(
        "`rtk ",
      );
      for (const phrase of shorthand) {
        expect(
          focused?.toLowerCase(),
          `${taskId}: shorthand ${phrase}`,
        ).not.toContain(phrase);
      }
      expect(
        focused,
        `${taskId}: mutating generated-file command must use the transient helper`,
      ).not.toMatch(
        /`rtk pnpm (?:(?:--dir packages\/convex )?(?:confect:codegen|check:convex)|confect:manifest)(?:[ `])/,
      );
      if (taskId === "S08-T03" || taskId === "S08-T04") {
        expect(
          focused,
          `${taskId}: mutating template generator is an implementation action, not a focused gate`,
        ).not.toMatch(/`rtk pnpm template:[^`]* --write`/);
      }
    }
  });

  it("locks every S08 cognition generator output to its owning task", () => {
    const manifest = buildManifest();
    const commands = {
      "S08-T03": [
        [
          "add-capability",
          "--",
          "--name",
          "classifySourceUnit",
          "--description",
          "Returns a typed zero-or-one route proposal from an immutable source unit.",
          "--exposure",
          "workflow",
        ],
        [
          "add-workflow",
          "--",
          "--name",
          "sourceClassification",
          "--description",
          "Gathers, classifies, reviews, and commits one source route.",
          "--exposure",
          "internal",
        ],
      ],
      "S08-T04": [
        [
          "add-capability",
          "--",
          "--name",
          "maintainBrainPage",
          "--description",
          "Returns cited Brain revision proposals from an immutable context pack.",
          "--exposure",
          "workflow",
        ],
        [
          "add-workflow",
          "--",
          "--name",
          "sourceToBrainMaintenance",
          "--description",
          "Gathers routed evidence and proposes cited Brain revisions.",
          "--exposure",
          "internal",
        ],
      ],
    } as const;

    for (const [taskId, taskCommands] of Object.entries(commands)) {
      const paths = taskCommands.flatMap(generatorDryRunPaths);
      expect(paths).toHaveLength(14);
      expect(new Set(paths).size).toBe(paths.length);
      for (const path of paths) {
        expect(
          manifest.tasks
            .filter((task) => task.fileLocks.includes(path))
            .map((task) => task.taskId),
          path,
        ).toEqual([taskId]);
      }
    }
  });

  it("exposes a real contract-first parallel frontier", () => {
    const manifest = buildManifest();
    expect(readyWidth(manifest)).toBeGreaterThanOrEqual(6);
    expect(
      manifest.tasks
        .filter((task) => task.codeStartAfter.length === 0)
        .map((task) => task.taskId),
    ).toEqual(
      expect.arrayContaining([
        "S01-T01",
        "S02-T01",
        "S03-T01",
        "S08-T01",
        "S09-T01",
      ]),
    );
  });

  it("reserves every generated output path for integration", () => {
    const manifest = buildManifest();
    expect(
      manifest.tasks.every(
        (task) =>
          !task.fileLocks.includes("@generated-confect") &&
          task.fileLocks.every(
            (file) =>
              !file.includes("/_generated/") &&
              (!isIntegrationOwnedGeneratedFile(file) ||
                file ===
                  "packages/convex/convex/workflowRunners/sourceClassification.ts" ||
                file ===
                  "packages/convex/convex/workflowRunners/sourceToBrainMaintenance.ts"),
          ),
      ),
    ).toBe(true);
    expect(
      manifest.tasks.some((task) => task.fileLocks.includes("@environment")),
    ).toBe(true);
    expect(
      readFileSync(resolve(REPO_ROOT, PLAN_RELATIVE), "utf8"),
    ).not.toContain("@generated-confect");
  });

  it("runs task-local generated checks and documents the sole zero-delta check", () => {
    const plan = readFileSync(resolve(REPO_ROOT, PLAN_RELATIVE), "utf8");
    const helperTests = [
      ...plan.matchAll(
        /^### (S\d{2}-T\d{2})[^\n]*\n([\s\S]*?)(?=^### S\d{2}-T\d{2}|^---$)/gm,
      ),
    ].flatMap((match) =>
      match[2]?.includes("brain:factory:check-confect-codegen -- --") &&
      match[2]?.includes("--test")
        ? [match[1]]
        : [],
    );
    expect(helperTests).toEqual([
      "S00-T04",
      "S01-T02",
      "S01-T03",
      "S02-T02",
      "S03-T03",
    ]);
    expect(plan.match(/`rtk pnpm check:confect-manifest`/g)).toHaveLength(1);
    expect(plan).toMatch(
      /the\s+Confect manifest check is a zero-delta assertion because this\s+task consumes/,
    );
  });

  it("serializes migrations behind deployment isolation", () => {
    const manifest = buildManifest();
    const sourceContract = manifest.tasks.find(
      (task) => task.taskId === "S00-T02",
    );
    const isolation = manifest.tasks.find((task) => task.taskId === "S00-T03");
    const migrations = manifest.tasks.find((task) => task.taskId === "S00-T04");
    expect(sourceContract?.kind).toBe("product");
    expect(sourceContract?.fileLocks).toEqual(
      expect.arrayContaining([
        "@dependencies",
        "package.json",
        "pnpm-workspace.yaml",
      ]),
    );
    expect(isolation?.fileLocks).toEqual(
      expect.arrayContaining([
        ".buildkite/pipeline.yml",
        "tooling/quality/check-config-drift.test.mts",
        "tooling/quality/src/check-definitions.mts",
      ]),
    );
    expect(migrations?.codeStartAfter).toEqual(["S00-T03"]);
    expect(migrations?.estimatedSourceLines).toBe(780);
    expect(migrations?.sourceSliceBudget).toBe(300);
    expect(migrations?.fileLocks).toContain(
      "packages/convex/confect/internal/migrations.ts",
    );
    expect(migrations?.fileLocks).not.toContain(
      "packages/convex/convex/migrations.ts",
    );
    expect(migrations?.fileLocks).toContain(
      "packages/convex/confect/tables/migrationRuns.ts",
    );
    const plan = readFileSync(resolve(REPO_ROOT, PLAN_RELATIVE), "utf8");
    const packet = plan.slice(
      plan.indexOf("### S00-T04"),
      plan.indexOf("### S01-T01"),
    );
    const normalizedPacket = packet.replace(/\s+/g, " ");
    for (const required of [
      "real generated",
      "`components.migrations`",
      "FunctionSpec.convexInternalMutation",
      "FunctionImpl.make",
      "generated Confect refs",
      "explicit `null` initial cursor",
      "dry-run rollback",
      "lease/fence generation",
      "one stable release-parent ID",
      "`failure_checkpoint`",
      "`release_parent`",
      "nullable with explicit `unavailable` provenance",
      "post-component/pre-settlement crash",
      "jobs/workpool",
      "four commits",
    ]) {
      expect(normalizedPacket, `S00-T04 missing ${required}`).toContain(
        required,
      );
    }
    const atFourSlices = {
      ...manifest,
      tasks: manifest.tasks.map((task) =>
        task.taskId === "S00-T04"
          ? { ...task, estimatedSourceLines: 1_200 }
          : task,
      ),
    };
    expect(validateManifest(atFourSlices)).not.toContain(
      "S00-T04: invalid source-line estimate 1200",
    );
    expect(
      validateManifest({
        ...atFourSlices,
        tasks: atFourSlices.tasks.map((task) =>
          task.taskId === "S00-T04"
            ? { ...task, estimatedSourceLines: 1_201 }
            : task,
        ),
      }),
    ).toContain("S00-T04: invalid source-line estimate 1201");
  });

  it("makes S05 the migration registry producer for the remaining frontier", () => {
    const projection = loadManifestProjection();
    const sourceLedger = projection.tasks.find(
      (task) => task.taskId === "S05-T01",
    );
    expect(sourceLedger?.title).toBe(
      "Add The Source Ledger And Prove The Integration-Owned Migration Registry",
    );
    expect(sourceLedger?.sourceSliceLimit).toBe(4);
    expect(sourceLedger?.laneGreenAuthorityReproofTransition).toMatchObject({
      sourceHeadSha: "d5efc88aff587f23541b363b41d296beb5eda5a5",
      proofHeadSha: "1578f7f20b8bd7b5580627030e9d40c040935ccd",
    });
    const transition = sourceLedger?.laneGreenAuthorityReproofTransition;
    expect(transition?.proofChangedFiles).toHaveLength(22);
    expect(transition?.sourceChangedFiles).toHaveLength(21);
    expect(transition?.proofChangedFiles).toContain(
      "packages/convex/confect/internal/migrations.spec.ts",
    );
    expect(transition?.sourceChangedFiles).not.toContain(
      "packages/convex/confect/internal/migrations.spec.ts",
    );
    const changedFiles = (range: string): string[] =>
      execFileSync(
        "rtk",
        ["proxy", "git", "diff", "--name-only", "--no-renames", range],
        { cwd: REPO_ROOT, encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
    expect(transition?.proofChangedFiles).toEqual(
      changedFiles(
        "5f682348711572faa32ac79066f8e470a1f2743f..1578f7f20b8bd7b5580627030e9d40c040935ccd",
      ),
    );
    expect(transition?.sourceChangedFiles).toEqual(
      changedFiles(
        "022a932c1e809c2093a10f5dea5d248b6c706f5f..d5efc88aff587f23541b363b41d296beb5eda5a5",
      ),
    );
    const sourceCommits = execFileSync(
      "rtk",
      [
        "proxy",
        "git",
        "rev-list",
        "--reverse",
        "022a932c1e809c2093a10f5dea5d248b6c706f5f..d5efc88aff587f23541b363b41d296beb5eda5a5",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .trim()
      .split("\n");
    expect(transition?.sourceCommits).toEqual(sourceCommits);
    for (const commit of sourceCommits) {
      expect(
        execFileSync("rtk", ["proxy", "git", "cat-file", "-t", commit], {
          cwd: REPO_ROOT,
          encoding: "utf8",
        }).trim(),
      ).toBe("commit");
    }
    const currentPlan = readFileSync(resolve(REPO_ROOT, PLAN_RELATIVE), "utf8");
    expect(taskBlockHashWithoutLaneGreenAuthority(currentPlan, "S05-T01")).toBe(
      "d5212dbc84a10771993658fc840e29bc81671c08e7962dbf96fd34de2dda9ce5",
    );
    expect(
      projection.tasks.find((task) => task.taskId === "S05-T02")
        ?.laneGreenAuthorityReproofTransition,
    ).toBeUndefined();
    expect(sourceLedger?.fileLocks).not.toContain(
      "packages/convex/confect/internal/migrations.ts",
    );
    expect(sourceLedger?.fileLocks).toEqual(
      expect.arrayContaining([
        "packages/convex/confect/internal/migrationFragment.ts",
        "packages/convex/confect/internal/migration-fragments/S00-T04.json",
        "packages/convex/confect/internal/migration-fragments/S01-T02.json",
        "packages/convex/confect/internal/migration-fragments/S02-T01.json",
        "packages/convex/confect/internal/migration-fragments/S02-T03.json",
        "packages/convex/confect/internal/migration-fragments/S05-T01.json",
        "packages/convex/confect/internal/migration-implementations/S00-T04.ts",
        "packages/convex/confect/internal/migration-implementations/S01-T02.ts",
        "packages/convex/confect/internal/migration-implementations/S02-T01.ts",
        "packages/convex/confect/internal/migration-implementations/S02-T03.ts",
        "packages/convex/confect/internal/migrationRuntime.ts",
        "packages/convex/confect/internal/migrations.impl.ts",
        "packages/convex/confect/internal/migrations.spec.ts",
        "packages/convex/scripts/generate-migration-registry.mts",
        "packages/convex/test/migration-registry.test.ts",
        "packages/convex/test/migrations.test.ts",
      ]),
    );

    for (const taskId of [
      "S02-T03",
      "S06-T01",
      "S07-T01",
      "S08-T03",
      "S08-T04",
      "S09-T02",
      "S10-T01",
    ]) {
      const consumer = projection.tasks.find((task) => task.taskId === taskId);
      expect(consumer?.codeStartAfter, taskId).toContain("S05-T01");
      expect(
        consumer?.classifiedCodeStartAfter.find(
          (edge) => edge.producerTaskId === "S05-T01",
        )?.classification,
        taskId,
      ).toBe("true");
    }

    const completedApiKeys = projection.tasks.find(
      (task) => task.taskId === "S11-T01",
    );
    expect(completedApiKeys?.codeStartAfter).not.toContain("S05-T01");

    const plan = readFileSync(resolve(REPO_ROOT, PLAN_RELATIVE), "utf8");
    const packet = plan.slice(
      plan.indexOf("### S05-T01"),
      plan.indexOf("### S05-T02"),
    );
    for (const historicalProof of [
      "44e9a84be7b079696ccad10841b22ff3f3b10071",
      "d0b158fdc0587860b27c4d65be149b5f5133e2ad",
      "67aafe40f75f63bc33639c9046c5aaaa2a62427b",
      "3e8643669a449717921c611e8708932517e72442",
      "a1591e4b94e3dafa190d5905e5774e9b8bab0e8a",
      "500bbc1100084287e5a088f4ff8c774f63464ed1",
      "e80347e265609ebf314983a20b5b58e25fe20ed4",
      "632d90f4b70073ea6daeadd24a8579e8166be9f6a56668c40d04d9ae70d2d1ac",
    ]) {
      expect(packet).toContain(historicalProof);
    }
    const normalizedPacket = packet.replace(/\s+/g, " ");
    expect(normalizedPacket).toContain(
      "S04-T02 requires no fragment or implementation module",
    );
    expect(normalizedPacket).toContain(
      "S11-T01 requires no fragment or implementation module",
    );

    const maintenance = projection.tasks.find(
      (task) => task.taskId === "S08-T04",
    );
    expect(maintenance?.sourceSliceLimit).toBe(5);
    expect(maintenance?.estimatedSourceLines).toBe(1_200);
  });

  it("separates Slack trust establishment from atomic capture", () => {
    const projection = loadManifestProjection();
    const plan = readFileSync(resolve(REPO_ROOT, PLAN_RELATIVE), "utf8");
    const packet = (taskId: string, nextTaskId: string): string =>
      plan.slice(
        plan.indexOf(`### ${taskId}`),
        plan.indexOf(`### ${nextTaskId}`),
      );
    const verifier = packet("S04-T03", "S04-T04").replace(/\s+/g, " ");
    const ledger = packet("S05-T01", "S05-T02").replace(/\s+/g, " ");
    const capture = packet("S05-T02", "S05-T03").replace(/\s+/g, " ");

    expect(verifier).toContain("BoundVerifiedSlackEnvelope");
    expect(verifier).toContain("current and previous webhook secrets");
    expect(verifier).toContain(
      "exactly one active organization/connection generation",
    );
    expect(verifier).toContain("zero tenant writes");
    expect(verifier).not.toContain("WebhookReplay");
    expect(verifier).not.toContain("tenant receipt outcome");
    expect(ledger).toContain("schema/registry-only");
    expect(ledger).toContain("does not perform secret lookup");
    expect(ledger).not.toContain("replay behavior");
    expect(ledger).toContain("replay-key and uniqueness constraints");
    expect(ledger).not.toContain(
      'scripts/generate-migration-registry.mts --root "$PWD" --check',
    );
    expect(ledger).toContain("missing generated target fails");
    expect(capture).toContain("BoundVerifiedSlackEnvelope");
    expect(capture).toContain("one Convex mutation");
    expect(capture).toContain("atomically claim replay");
    expect(capture).toContain("ReplayConflict");

    const appendixG = plan.slice(
      plan.indexOf("## Appendix G"),
      plan.indexOf("## Appendix H"),
    );
    const receiptRow = appendixG
      .split("\n")
      .find((line) => line.startsWith("| Provider event receipt"));
    const receiptOwner = receiptRow?.split("|")[3];
    expect(receiptRow).toContain(
      "S04-T03's `BoundVerifiedSlackEnvelope` is transient and non-durable",
    );
    expect(receiptRow).toContain("S05-T02");
    expect(receiptOwner).not.toContain("S04-T03");
    expect(receiptRow).not.toContain("verified ->");
    expect(receiptRow).toContain("rejections remain non-durable");

    for (const [consumerTaskId, producerTaskId] of [
      ["S04-T03", "S04-T02"],
      ["S05-T01", "S04-T02"],
      ["S05-T02", "S04-T03"],
    ] as const) {
      expect(
        projection.contract.edges.find(
          (edge) =>
            edge.consumerTaskId === consumerTaskId &&
            edge.producerTaskId === producerTaskId,
        ),
      ).toEqual({ consumerTaskId, producerTaskId, classification: "true" });
    }
    expect(
      projection.contract.collisions.find(
        (collision) =>
          collision.leftTaskId === "S04-T03" &&
          collision.rightTaskId === "S05-T02",
      )?.policy,
    ).toBe("dependency_order");
  });

  it("authorizes atomic Slack identity lifecycle revocation", () => {
    const manifest = buildManifest();
    const slackIdentity = manifest.tasks.find(
      (task) => task.taskId === "S10-T01",
    );
    expect(slackIdentity?.estimatedSourceLines).toBe(1_200);
    expect(slackIdentity?.sourceSliceBudget).toBe(300);
    expect(slackIdentity?.sourceSliceLimit).toBe(6);
    expect(slackIdentity?.authorityRepairTransition).toEqual({
      schemaVersion: "maestro-brain-authority-repair-transition/v1",
      mode: "path-rehome",
      fromPlanSha256:
        "5e3506ec26c1776547b03641707371efaebb1c490ce3da6b6a1e2ed0df2a8417",
      fromTaskBlockHash:
        "31d477606c8d812c0f800d81d3401104da038d29fbb39dce06e1292cbd8d6e04",
      sourceRunId: "01KXZP38CAC2GYAF2YA7NRTBQK",
      sourceBaseSha: "bc7631796e42ee5d33a006df85730dc1293f505e",
      sourceHeadSha: "ae416ba6efe4b822a339d127eb5d428589068c24",
      sourceTreeSha: "0fd4c83f8afa2b35d9aadc38a2d2a7a92da426c9",
      requiredIntegratedTaskIds: ["S05-T01"],
      immutableFindings: [
        {
          kind: "git-blob",
          objectSha: "643c702586f1e7a4ab1c3fb37843e612b9b974ba",
          contentSha256:
            "5e7b05f921760cf94f2eefd472ba511ccca84603c41ffbec5870dd51fb2fb4aa",
        },
      ],
      supersededPaths: [
        {
          path: "packages/convex/confect/internal/migrations.ts",
          replacementPath:
            "packages/convex/confect/internal/migration-fragments/S10-T01.json",
          disposition: "replaced-by-current-owned-artifact",
        },
      ],
    });
    expect(
      validateManifest({
        ...manifest,
        tasks: manifest.tasks.map((task) => {
          if (task.taskId !== "S10-T01") return task;
          const { sourceSliceLimit, ...withoutLimit } = task;
          expect(sourceSliceLimit).toBe(6);
          return withoutLimit;
        }),
      }),
    ).toContain("S10-T01: source slice limit must be 6");
    expect(slackIdentity?.fileLocks).toEqual([
      "apps/web/src/features/settings/slack-link-adapter.test.ts",
      "apps/web/src/features/settings/slack-link-adapter.ts",
      "apps/web/src/features/settings/slack-link-button.test.tsx",
      "apps/web/src/features/settings/slack-link-button.tsx",
      "apps/web/src/features/settings/slack-link-status.test.tsx",
      "apps/web/src/features/settings/slack-link-status.tsx",
      "docs/product/maestro-brain-lifecycle-adoption/S10-T01.md",
      "packages/convex/confect/access/identityLifecycle.impl.ts",
      "packages/convex/confect/access/identityLifecycle.spec.ts",
      "packages/convex/confect/access/identityLifecycle.ts",
      "packages/convex/confect/integrations/slackDirectory.impl.ts",
      "packages/convex/confect/internal/migration-fragments/S10-T01.json",
      "packages/convex/confect/slack/identityLink.ts",
      "packages/convex/confect/slack/identityLinks.impl.ts",
      "packages/convex/confect/slack/identityLinks.spec.ts",
      "packages/convex/confect/tables/slackIdentityBindings.ts",
      "packages/convex/test/access-identity-lifecycle.test.ts",
      "packages/convex/test/slack-directory.test.ts",
      "packages/convex/test/slack-identity-links.test.ts",
    ]);

    const plan = readFileSync(resolve(REPO_ROOT, PLAN_RELATIVE), "utf8");
    const packet = plan.slice(
      plan.indexOf("### S10-T01"),
      plan.indexOf("### S10-T02"),
    );
    const normalizedPacket = packet.replace(/\s+/g, " ");
    for (const required of [
      "atomic user-suspension/org-membership-revocation writer",
      "active and pending organization-scoped Slack bindings",
      "connection-replacement transaction",
      "replaced connection generation",
      "Workspace removal does not unlink",
      "post-S05 task-owned migration fragment",
    ]) {
      expect(normalizedPacket, `S10-T01 missing ${required}`).toContain(
        required,
      );
    }
  });

  it("keeps durable identity and provider work behind foundation gates", () => {
    const manifest = buildManifest();
    const stableIdentity = manifest.tasks.find(
      (task) => task.taskId === "S01-T02",
    );
    const providerSetup = manifest.tasks.find(
      (task) => task.taskId === "S04-T01",
    );
    const connectionDirectory = manifest.tasks.find(
      (task) => task.taskId === "S04-T02",
    );
    const authorizedTenancy = manifest.tasks.find(
      (task) => task.taskId === "S01-T03",
    );
    const rbacSettings = manifest.tasks.find(
      (task) => task.taskId === "S01-T04",
    );
    const pageCrud = manifest.tasks.find((task) => task.taskId === "S02-T02");
    const headlessPrincipal = manifest.tasks.find(
      (task) => task.taskId === "S11-T02",
    );
    expect(stableIdentity?.codeStartAfter).toEqual(["S00-T04", "S01-T01"]);
    expect(authorizedTenancy?.estimatedSourceLines).toBe(880);
    expect(
      (authorizedTenancy?.sourceSliceLimit ?? 4) *
        (authorizedTenancy?.sourceSliceBudget ?? 0),
    ).toBeGreaterThanOrEqual(authorizedTenancy?.estimatedSourceLines ?? 0);
    expect(authorizedTenancy?.fileLocks).toEqual(
      expect.arrayContaining([
        "packages/convex/confect/access/auth.ts",
        "packages/convex/confect/errors.ts",
        "packages/convex/confect/tables/workspaces.ts",
        "tooling/quality/check-auth-demo-bypass.mts",
        "tooling/quality/check-auth-demo-bypass.test.mts",
      ]),
    );
    expect(providerSetup?.codeStartAfter).toEqual(["S00-T03", "S01-T02"]);
    expect(rbacSettings?.sourceSliceLimit).toBe(11);
    expect(rbacSettings?.estimatedSourceLines).toBe(3_300);
    expect(pageCrud?.sourceSliceLimit).toBe(5);
    expect(rbacSettings?.fileLocks).toContain(
      "packages/convex/confect/access/auth.ts",
    );
    expect(providerSetup?.sourceSliceLimit).toBe(10);
    expect(providerSetup?.estimatedSourceLines).toBe(2_700);
    expect(connectionDirectory?.sourceSliceLimit).toBe(5);
    expect(connectionDirectory?.estimatedSourceLines).toBe(1_500);
    expect(providerSetup?.fileLocks).toContain(
      "packages/convex/confect/tables/providerConnections.ts",
    );
    expect(providerSetup?.fileLocks).not.toContain(
      "packages/convex/confect/internal/migrations.ts",
    );
    expect(stableIdentity?.sourceSliceLimit).toBeUndefined();
    expect(headlessPrincipal?.codeStartAfter).toEqual([
      "S11-T01",
      "S01-T02",
      "S01-T03",
      "S01-T04",
      "S02-T02",
    ]);
    expect(headlessPrincipal?.acceptanceAfter).toBe(
      "S11-T01, S01-T03, S01-T04, S02-T02",
    );
    expect(headlessPrincipal?.estimatedSourceLines).toBe(3_000);
    expect(headlessPrincipal?.sourceSliceLimit).toBe(10);
  });

  it("reserves explicit expanded slice contracts", () => {
    const manifest = buildManifest();
    const s01AtExpandedSlices = {
      ...manifest,
      tasks: manifest.tasks.map((task) =>
        task.taskId === "S01-T04"
          ? { ...task, estimatedSourceLines: 3_300 }
          : task,
      ),
    };
    expect(validateManifest(s01AtExpandedSlices)).not.toContain(
      "S01-T04: invalid source-line estimate 3300",
    );
    expect(
      validateManifest({
        ...s01AtExpandedSlices,
        tasks: s01AtExpandedSlices.tasks.map((task) =>
          task.taskId === "S01-T04"
            ? { ...task, estimatedSourceLines: 3_301 }
            : task,
        ),
      }),
    ).toContain("S01-T04: invalid source-line estimate 3301");
    const s04AtExpandedSlices = {
      ...manifest,
      tasks: manifest.tasks.map((task) =>
        task.taskId === "S04-T01"
          ? { ...task, estimatedSourceLines: 3_000 }
          : task,
      ),
    };
    expect(validateManifest(s04AtExpandedSlices)).not.toContain(
      "S04-T01: invalid source-line estimate 3000",
    );
    expect(
      validateManifest({
        ...s04AtExpandedSlices,
        tasks: s04AtExpandedSlices.tasks.map((task) =>
          task.taskId === "S04-T01"
            ? { ...task, estimatedSourceLines: 3_001 }
            : task,
        ),
      }),
    ).toContain("S04-T01: invalid source-line estimate 3001");
    const s04DirectoryAtExpandedSlices = {
      ...manifest,
      tasks: manifest.tasks.map((task) =>
        task.taskId === "S04-T02"
          ? { ...task, estimatedSourceLines: 1_500 }
          : task,
      ),
    };
    expect(validateManifest(s04DirectoryAtExpandedSlices)).not.toContain(
      "S04-T02: invalid source-line estimate 1500",
    );
    expect(
      validateManifest({
        ...s04DirectoryAtExpandedSlices,
        tasks: s04DirectoryAtExpandedSlices.tasks.map((task) =>
          task.taskId === "S04-T02"
            ? { ...task, estimatedSourceLines: 1_501 }
            : task,
        ),
      }),
    ).toContain("S04-T02: invalid source-line estimate 1501");
    expect(
      validateManifest({
        ...manifest,
        tasks: manifest.tasks.map((task) =>
          task.taskId === "S00-T04"
            ? { ...task, sourceSliceLimit: 10 as const }
            : task,
        ),
      }),
    ).toContain("S00-T04: source slice limit must be the default four");
    expect(
      validateManifest({
        ...manifest,
        tasks: manifest.tasks.map((task) => {
          if (task.taskId !== "S04-T01") return task;
          const { sourceSliceLimit, ...withoutLimit } = task;
          expect(sourceSliceLimit).toBe(10);
          return withoutLimit;
        }),
      }),
    ).toContain("S04-T01: source slice limit must be 10");
    expect(
      validateManifest({
        ...manifest,
        tasks: manifest.tasks.map((task) => {
          if (task.taskId !== "S04-T02") return task;
          const { sourceSliceLimit, ...withoutLimit } = task;
          expect(sourceSliceLimit).toBe(5);
          return withoutLimit;
        }),
      }),
    ).toContain("S04-T02: source slice limit must be 5");
  });

  it("gives S03-T03 the revision-fenced BlockNote seam", () => {
    const task = buildManifest().tasks.find(
      (candidate) => candidate.taskId === "S03-T03",
    );
    expect(task?.codeStartAfter).toContain("S02-T04");
    expect(task?.gateProfiles).toEqual(["convex", "web"]);
    expect(task?.estimatedSourceLines).toBe(1_800);
    expect(task?.sourceSliceLimit).toBe(7);
    expect(task?.fileLocks).toEqual(
      expect.arrayContaining([
        "docs/product/maestro-brain-lifecycle-adoption/S03-T03.md",
        "packages/editor-react/src/BlockNoteSyncEditor.test.tsx",
        "packages/editor-react/src/BlockNoteSyncEditor.tsx",
        "packages/convex/confect/brain/pages.impl.ts",
        "packages/convex/confect/brain/pages.spec.ts",
        "packages/convex/confect/editor/documentTargets.ts",
        "packages/convex/confect/editor/syncApi.ts",
        "packages/convex/test/brain-editor-revision-fence.test.ts",
      ]),
    );
    expect(task?.ownershipRehomeTransition).toEqual(
      expect.objectContaining({
        classification: "ownership-rehome",
        fromPlanSha256:
          "06d2877a2679fbd6017e4b220d7ef624772e526b2d8465423d2a767304d7366f",
        fromTaskBlockHash:
          "aa1a34eba8e9f1b7be8ce4818650cc062d0b74238531d81c76f031efc240f1ab",
        sourceRunId: "01KY02VYKQ71T4SDE6ZPPBS205",
        sourceBaseSha: "bc7631796e42ee5d33a006df85730dc1293f505e",
        sourceHeadSha: "c5af15a17df735df047407ab91f2948a5c2f8975",
        sourceTreeSha: "d525ae25217a4f08dd980e03aaa5f010014c33af",
        requiredIntegratedTaskIds: ["S02-T02", "S02-T04"],
      }),
    );
    for (const { path, replacementPath } of task?.ownershipRehomeTransition
      ?.supersededPaths ?? []) {
      expect(task?.fileLocks).not.toContain(path);
      expect(task?.fileLocks).toContain(replacementPath);
    }
    const plan = readFileSync(resolve(REPO_ROOT, PLAN_RELATIVE), "utf8");
    const packet = plan.slice(
      plan.indexOf("### S03-T03"),
      plan.indexOf("### S03-T04"),
    );
    for (const command of [
      "rtk pnpm brain:factory:check-confect-codegen -- --profile web --test brain-editor-revision-fence --test brain-pages-crud",
      "rtk pnpm --dir packages/editor-react typecheck",
      "rtk host-test-slot --class focused pnpm --dir packages/editor-react test",
    ]) {
      expect(packet).toContain(`\`${command}\``);
    }
  });

  it("keeps S13 lane proofs behind their real product dependencies", () => {
    const manifest = buildManifest();
    const semanticEvals = manifest.tasks.find(
      (task) => task.taskId === "S13-T01",
    );
    const capacity = manifest.tasks.find((task) => task.taskId === "S13-T02");
    const operations = manifest.tasks.find((task) => task.taskId === "S13-T03");
    expect(semanticEvals?.acceptanceAfter).toBe("S10, S11, S12 complete");
    expect(semanticEvals?.codeStartAfter).toEqual([
      "S08-T04",
      "S09-T04",
      "S11-T03",
    ]);
    expect(capacity?.acceptanceAfter).toBe("S13-T01, S06");
    expect(capacity?.codeStartAfter).toEqual(["S13-T01", "S06-T02", "S11-T04"]);
    expect(operations?.acceptanceAfter).toBe("S13-T02");
    expect(operations?.codeStartAfter).toEqual([
      "S06-T02",
      "S08-T01",
      "S11-T04",
      "S12-T02",
    ]);
    expect(
      manifest.tasks
        .filter((task) => task.taskId.startsWith("S13-"))
        .every((task) => task.tranche === "X3-convergence"),
    ).toBe(true);
  });

  it("rehomes S13 logging canaries without retaining checker ownership", () => {
    const manifest = buildManifest();
    const slack = manifest.tasks.find((task) => task.taskId === "S04-T03");
    const operations = manifest.tasks.find((task) => task.taskId === "S13-T03");
    expect(slack?.fileLocks).toContain(
      "tooling/quality/check-logging-boundary.mts",
    );
    expect(operations?.fileLocks).toContain(
      "packages/observability/src/brainMetrics.test.ts",
    );
    expect(operations?.fileLocks).not.toContain(
      "tooling/quality/check-logging-boundary.mts",
    );
    expect(operations?.ownershipRehomeTransition).toEqual({
      schemaVersion: "maestro-brain-ownership-rehome-transition/v1",
      classification: "ownership-rehome",
      fromPlanSha256:
        "a3d4af4aa5e526438aa5e06c8716a6a40500bc235d9933f8f8649e133263821b",
      fromTaskBlockHash:
        "44554749f4365ef357fd095d8ca8bd6dfdaec948b73797a8255e102eac74d080",
      sourceRunId: "01KY0KKPKS1JMRX8M50XX5Y7YP",
      sourceBaseSha: "022a932c1e809c2093a10f5dea5d248b6c706f5f",
      sourceHeadSha: "9a372756c24735077c875064a3080c49b812d85b",
      sourceTreeSha: "05238587cbebc3b0150bad33fd3575c5a3d50a70",
      requiredIntegratedTaskIds: ["S06-T02", "S08-T01", "S11-T04", "S12-T02"],
      immutableFinding: {
        kind: "git-blob",
        ref: "refs/maestro-brain/evidence/s13-t03-checker-rehome-20260720",
        objectSha: "90be0b093bd2706ca58f762a227355d3071bfbb6",
        contentSha256:
          "e67b89719952add30bc7a67923aa24465b386ed10d55d07b20c1abc7ea9bda37",
      },
      supersededPaths: [
        {
          path: "tooling/quality/check-logging-boundary.mts",
          replacementPath: "packages/observability/src/brainMetrics.test.ts",
          disposition: "replaced-by-current-owned-artifact",
        },
      ],
    });

    const plan = readFileSync(resolve(REPO_ROOT, PLAN_RELATIVE), "utf8");
    const packet = plan.slice(
      plan.indexOf("### S13-T03"),
      plan.indexOf("### S13-T04"),
    );
    expect(packet).toContain("**Redaction-canary ownership:**");
    expect(packet).toContain(
      "`packages/observability/src/brainMetrics.test.ts`; they exercise",
    );
    expect(packet).not.toContain(
      "modify\n  `tooling/quality/check-logging-boundary.mts`",
    );
  });

  it("gives lifecycle adoption work exact task-local locks", () => {
    const manifest = buildManifest();
    const lifecycleTasks = [
      "S02-T01",
      "S04-T02",
      "S04-T04",
      "S05-T01",
      "S05-T03",
      "S05-T04",
      "S06-T02",
      "S07-T01",
      "S07-T02",
      "S08-T01",
      "S08-T03",
      "S08-T04",
      "S09-T01",
      "S09-T02",
      "S09-T03",
      "S09-T04",
      "S10-T01",
      "S10-T02",
      "S11-T01",
      "S12-T02",
    ];
    const taskById = new Map(manifest.tasks.map((task) => [task.taskId, task]));
    for (const taskId of lifecycleTasks) {
      const task = taskById.get(taskId);
      expect(task?.fileLocks).toContain(
        `docs/product/maestro-brain-lifecycle-adoption/${taskId}.md`,
      );
      expect(task?.fileLocks).not.toContain(
        "docs/product/maestro-brain-lifecycle-adoption.md",
      );
      expect(
        manifest.tasks
          .filter((candidate) =>
            candidate.fileLocks.includes(
              `docs/product/maestro-brain-lifecycle-adoption/${taskId}.md`,
            ),
          )
          .map((candidate) => candidate.taskId),
      ).toEqual([taskId]);
    }
    expect(
      manifest.tasks.filter((task) =>
        task.fileLocks.includes(
          "docs/product/maestro-brain-lifecycle-adoption.md",
        ),
      ),
    ).toEqual([]);
  });

  it("binds S04-T04 checkpoint reproof to the lost-proof checkpoint", () => {
    const task = buildManifest().tasks.find(
      (candidate) => candidate.taskId === "S04-T04",
    );
    expect(task?.checkpointReproofTransition).toMatchObject({
      schemaVersion: "maestro-brain-checkpoint-reproof-transition/v1",
      sourceBaseSha: "e8f008574eff0d1a21700ff02926ac4c9870d425",
      sourceHeadSha: "44c1f6c7e982c7e1814455d2d29f56139d1b803c",
      sourceTreeSha: "6e1da7ee246d7784d8af528d36bb7c20c6a8de07",
      sourceCommits: [
        "7df17e8daee6be82447a8ade0271d6e756ef25ae",
        "cdebca71b3472563bd399399cfc9551015a35f79",
        "4056c4de06975ff0817712e8ade62b059ba148b9",
        "44c1f6c7e982c7e1814455d2d29f56139d1b803c",
      ],
      sourceSliceLines: [300, 287, 294, 285],
      requiredIntegratedTaskIds: ["S04-T02"],
    });
  });

  it("rejects cross-owned lifecycle adoption locks", () => {
    const manifest = buildManifest();
    const unsafe = {
      ...manifest,
      tasks: manifest.tasks.map((task) =>
        task.taskId === "S04-T02"
          ? {
              ...task,
              fileLocks: [
                ...task.fileLocks,
                "docs/product/maestro-brain-lifecycle-adoption/S02-T01.md",
              ],
            }
          : task,
      ),
    };

    expect(validateManifest(unsafe)).toEqual(
      expect.arrayContaining([
        "S04-T02: lifecycle record docs/product/maestro-brain-lifecycle-adoption/S02-T01.md belongs to S02-T01",
        "S04-T02: lifecycle record docs/product/maestro-brain-lifecycle-adoption/S02-T01.md also belongs to S02-T01",
      ]),
    );
  });

  it("uses only package-relevant profiles for the next frontier", () => {
    const manifest = buildManifest();
    const deployment = manifest.tasks.find((task) => task.taskId === "S00-T03");
    const generator = manifest.tasks.find((task) => task.taskId === "S08-T02");
    expect(deployment?.gateProfiles).toEqual(["release", "tooling"]);
    expect(generator?.gateProfiles).toEqual(["generators"]);
    expect(generator?.fileLocks).not.toContain("@dependencies");
  });

  it("binds completed packet audits and rejects unsafe ready pseudo-locks", () => {
    const manifest = buildManifest();
    expect(
      manifest.tasks.every((task) => task.fileInventoryStatus === "ready"),
    ).toBe(true);
    const unsafe = manifest.tasks.map((task) =>
      task.taskId === "S00-T03"
        ? {
            ...task,
            fileInventoryIssues: ["settings.test.ts: basename"],
          }
        : task,
    );
    expect(validateManifest({ ...manifest, tasks: unsafe })).toContain(
      "S00-T03: ready file inventory is unsafe: settings.test.ts: basename",
    );
  });

  it("rejects duplicate, unknown, missing, and misclassified audit rows", () => {
    const expected = new Map([
      ["S00-T01", "template-gap" as const],
      ["S00-T02", "pattern-instance" as const],
    ]);
    const heading = "### Task-packet audit\n";
    expect(
      parseTaskPacketAuditRows(
        `${heading}| S00-T01 | template-gap | ready | S00-T02 | pattern-instance | open:F |`,
        expected,
      ),
    ).toEqual(
      new Map([
        ["S00-T01", "ready"],
        ["S00-T02", "open:F"],
      ]),
    );
    expect(() =>
      parseTaskPacketAuditRows(
        `${heading}| S00-T01 | template-gap | ready | S00-T01 | template-gap | ready |`,
        expected,
      ),
    ).toThrow("duplicate task-packet audit row");
    expect(() =>
      parseTaskPacketAuditRows(
        `${heading}| S00-T01 | template-gap | ready | S00-T03 | template-gap | ready |`,
        expected,
      ),
    ).toThrow("S00-T03: unknown task-packet audit row");
    expect(() =>
      parseTaskPacketAuditRows(
        `${heading}| S00-T01 | fixture-to-real | ready | S00-T02 | pattern-instance | open:F |`,
        expected,
      ),
    ).toThrow(
      "audit classification fixture-to-real does not match template-gap",
    );
    expect(() =>
      parseTaskPacketAuditRows(
        `${heading}| S00-T01 | template-gap | ready | S00-T02 | pattern-instance | open:F |`,
        new Map([...expected, ["S00-T03", "template-gap" as const] as const]),
      ),
    ).toThrow("S00-T03: missing task-packet audit row");
  });
});
