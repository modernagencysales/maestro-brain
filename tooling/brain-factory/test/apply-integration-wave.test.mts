import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyIntegrationWave,
  type ApplyIntegrationWaveHooks,
  type ApplyIntegrationWaveInput,
} from "../src/apply-integration-wave.js";
import { buildContractReproofRequest } from "../src/contract-reproof.js";
import { validateIntegrationResult } from "../src/integration-result-check.mjs";
import {
  INTEGRATION_WAVE_SCHEMA,
  selectionFileSha256,
  selectionPayload,
  selectionPayloadSha256,
  type IntegrationWaveTaskSnapshot,
} from "../src/integration-wave.js";

const roots: string[] = [];

const git = (root: string, ...args: string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: root,
    encoding: "utf8",
  }).trim();

const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const writeJson = (path: string, value: unknown): string => {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  write(path, content);
  return content;
};

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

interface LaneFixture {
  readonly commits: readonly string[];
  readonly headSha: string;
  readonly snapshot: IntegrationWaveTaskSnapshot;
  readonly taskId: string;
}

interface Fixture {
  readonly baseSha: string;
  readonly controlRoot: string;
  readonly evidenceDirectory: string;
  readonly events: string[];
  readonly input: ApplyIntegrationWaveInput;
  readonly lanes: readonly LaneFixture[];
  readonly selectionPath: string;
  readonly workdir: string;
}

const makeFixture = (options?: {
  readonly deletedGenerated?: boolean;
  readonly generated?: boolean;
  readonly generatedBase?: boolean;
  readonly generatedFromExistingConfectImpl?: boolean;
  readonly globalConfectAggregates?: boolean;
  readonly historicalLaneWithoutTree?: boolean;
  readonly laneSpecs?: readonly {
    readonly files: readonly string[];
    readonly taskId: string;
  }[];
  readonly reverseCreation?: boolean;
  readonly reproof?: boolean;
  readonly secondPassConvergence?: boolean;
  readonly oscillatingGeneration?: boolean;
  readonly proofPlanSha256?: string;
  readonly transientFirstGeneration?: boolean;
}): Fixture => {
  const controlRoot = mkdtempSync(resolve(tmpdir(), "brain-wave-control-"));
  const workdir = mkdtempSync(resolve(tmpdir(), "brain-wave-apply-"));
  roots.push(controlRoot, workdir);
  const evidenceDirectory = resolve(controlRoot, ".fabro/state/evidence");
  const selectionPath = resolve(
    controlRoot,
    ".fabro/state/runs/selection.json",
  );
  const events: string[] = [];
  let confectGenerationRuns = 0;
  const planSha256 = "1".repeat(64);
  const proofPlanSha256 = options?.proofPlanSha256 ?? planSha256;
  git(workdir, "init", "-q");
  git(workdir, "config", "core.hooksPath", "/dev/null");
  git(workdir, "config", "user.email", "wave@example.test");
  git(workdir, "config", "user.name", "Wave Test");
  write(resolve(workdir, ".gitignore"), ".tokensave/\n");
  write(resolve(workdir, "base.txt"), "base\n");
  if (options?.generatedFromExistingConfectImpl) {
    write(
      resolve(
        workdir,
        "packages/convex/confect/integrations/slackConnections.impl.ts",
      ),
      "export const implementation = true;\n",
    );
  }
  if (options?.generatedBase) {
    write(
      resolve(
        workdir,
        "packages/template-core/src/generated/confectManifest.ts",
      ),
      "export const generated = true;\n",
    );
  }
  git(workdir, "add", ".");
  git(workdir, "commit", "-qm", "test: base");
  const baseSha = git(workdir, "rev-parse", "HEAD");
  const laneSpecs =
    options?.laneSpecs ??
    ([
      { files: ["a.ts"], taskId: "S01-T01" },
      { files: ["b.ts"], taskId: "S01-T02" },
    ] as const);
  const created = options?.reverseCreation
    ? [...laneSpecs].reverse()
    : laneSpecs;
  const laneById = new Map<string, LaneFixture>();
  for (const spec of created) {
    git(workdir, "checkout", "-qB", `lane-${spec.taskId}`, baseSha);
    const commits: string[] = [];
    for (const [index, file] of spec.files.entries()) {
      write(resolve(workdir, file), `export const value${index} = ${index};\n`);
      git(workdir, "add", file);
      git(workdir, "commit", "-qm", `test: ${spec.taskId} ${index}`);
      commits.push(git(workdir, "rev-parse", "HEAD"));
    }
    const headSha = git(workdir, "rev-parse", "HEAD");
    const treeSha = git(workdir, "rev-parse", "HEAD^{tree}");
    const laneDirectory = resolve(
      evidenceDirectory,
      "lane-results",
      spec.taskId,
    );
    const taskBlockHash = sha256(`block:${spec.taskId}`);
    const changedFiles = [...spec.files].sort();
    const focusedCommands = [
      "rtk pnpm --dir packages/search typecheck",
      ...(spec.taskId === "S01-T02"
        ? ["rtk pnpm --dir packages/search typecheck"]
        : []),
    ];
    const proofContent = writeJson(
      resolve(laneDirectory, "ci-proof-packet.json"),
      {
        schemaVersion: "maestro-brain-ci-proof/v1",
        taskId: spec.taskId,
        planSha256: proofPlanSha256,
        taskBlockHash,
        baseSha,
        changedFiles,
        headSha,
        reviewVerdict: "pass",
        reviewHeadSha: headSha,
        reviewFindings: [],
        focusedCommands,
      },
    );
    const gateContent = writeJson(
      resolve(laneDirectory, "lane-gate-report.json"),
      {
        schemaVersion: "maestro-brain-lane-gate/v1",
        taskId: spec.taskId,
        stage: "final",
        status: "passed",
        headSha,
        currentHeadSha: headSha,
        currentTreeSha: treeSha,
        planSha256: proofPlanSha256,
        taskBlockHash,
      },
    );
    const priorEvidencePath = resolve(
      evidenceDirectory,
      "archive",
      `${spec.taskId}.json`,
    );
    const priorArchiveContent = options?.reproof
      ? writeJson(priorEvidencePath, {
          taskId: spec.taskId,
          status: "accepted",
        })
      : undefined;
    const reproofRequest = priorArchiveContent
      ? buildContractReproofRequest({
          controlHeadSha: baseSha,
          planSha256: proofPlanSha256,
          priorArchiveSha256: sha256(priorArchiveContent),
          priorEvidencePath,
          priorIntegrationHeadSha: baseSha,
          priorIntegrationId: "wave-prior",
          priorIntegrationResultSha256: "2".repeat(64),
          priorLaneResultSha256: "3".repeat(64),
          reason: "reprove the canonical task contract",
          taskBlockHash,
          taskId: spec.taskId,
        })
      : undefined;
    const reproofRequestPath = resolve(
      evidenceDirectory,
      "reproofs",
      spec.taskId,
      "request.json",
    );
    if (reproofRequest) writeJson(reproofRequestPath, reproofRequest);
    const laneContent = writeJson(resolve(laneDirectory, "lane-result.json"), {
      schemaVersion: "maestro-brain-lane-result/v1",
      taskId: spec.taskId,
      tranche: "F0-foundation",
      status: "lane_green",
      headSha,
      ...(options?.historicalLaneWithoutTree ? {} : { treeSha }),
      ...(reproofRequest
        ? {
            reproof: {
              priorIntegrationHeadSha: reproofRequest.priorIntegrationHeadSha,
              priorIntegrationId: reproofRequest.priorIntegrationId,
              requestPath: reproofRequestPath,
              requestSha256: reproofRequest.requestSha256,
            },
          }
        : {}),
    });
    laneById.set(spec.taskId, {
      commits,
      headSha,
      snapshot: {
        changedFiles,
        codeStartAfter: [],
        fileLocks: changedFiles,
        gateHeadSha: headSha,
        gateSha256: sha256(gateContent),
        headSha,
        laneResultSha256: sha256(laneContent),
        planSha256: proofPlanSha256,
        proofHeadSha: headSha,
        proofSha256: sha256(proofContent),
        ...(reproofRequest
          ? { reproofRequestSha256: reproofRequest.requestSha256 }
          : {}),
        taskBlockHash,
        taskId: spec.taskId,
        tranche: "F0-foundation",
      },
      taskId: spec.taskId,
    });
  }
  const lanes = [...laneSpecs]
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
    .map((spec) => laneById.get(spec.taskId) as LaneFixture);
  writeJson(
    resolve(
      controlRoot,
      "docs/superpowers/execution/maestro-brain/task-manifest.json",
    ),
    {
      schemaVersion: "maestro-brain-task-manifest/v1",
      planSha256,
      tasks: lanes.map((lane) => ({
        taskId: lane.taskId,
        taskBlockHash: lane.snapshot.taskBlockHash,
        tranche: lane.snapshot.tranche,
        codeStartAfter: [],
        fileInventoryStatus: "ready",
        fileLocks: lane.snapshot.fileLocks,
        gateProfiles: ["tooling"],
        kind: "product",
      })),
    },
  );
  git(workdir, "checkout", "-qB", "integration", baseSha);
  const payload = selectionPayload({
    baseSha,
    deferredTaskIds: [],
    integrationId: "wave-000001",
    planSha256,
    requestedTaskIds: lanes.map((lane) => lane.taskId),
    selectedTasks: lanes.map((lane) => lane.snapshot),
  });
  const selection = {
    ...payload,
    schemaVersion: INTEGRATION_WAVE_SCHEMA,
    selectionPayloadSha256: selectionPayloadSha256(payload),
  };
  const selectionContent = writeJson(selectionPath, selection);
  const hooks: ApplyIntegrationWaveHooks = {
    hydrate: () => {
      events.push("hydrate");
    },
    run: (args, cwd) => {
      const key = args.join(" ");
      events.push(key);
      if (key === "pnpm confect:codegen") confectGenerationRuns += 1;
      if (key === "pnpm confect:codegen" && options?.generated) {
        write(
          resolve(
            cwd,
            "packages/template-core/src/generated/confectManifest.ts",
          ),
          "export const generated = true;\n",
        );
      }
      if (
        key === "pnpm confect:codegen" &&
        options?.generatedFromExistingConfectImpl
      ) {
        write(
          resolve(cwd, "packages/convex/confect/_generated/spec.ts"),
          "export const spec = true;\n",
        );
        write(
          resolve(
            cwd,
            "packages/convex/convex/integrations/slackConnections.ts",
          ),
          "export const registered = true;\n",
        );
      }
      if (key === "pnpm confect:codegen" && options?.globalConfectAggregates) {
        for (const file of ["convexSchema", "docs", "id", "schema"]) {
          write(
            resolve(cwd, `packages/convex/confect/_generated/${file}.ts`),
            `export const ${file} = true;\n`,
          );
        }
      }
      if (key === "pnpm confect:codegen" && options?.transientFirstGeneration) {
        const path = resolve(
          cwd,
          "packages/template-core/src/generated/confectManifest.ts",
        );
        if (confectGenerationRuns === 1) {
          write(path, "export const transient = true;\n");
        } else {
          rmSync(path, { force: true });
        }
      }
      if (
        key === "pnpm confect:codegen" &&
        (options?.secondPassConvergence || options?.oscillatingGeneration)
      ) {
        const generation = options.oscillatingGeneration
          ? confectGenerationRuns % 2
          : Math.min(confectGenerationRuns, 2);
        write(
          resolve(
            cwd,
            "packages/template-core/src/generated/confectManifest.ts",
          ),
          `export const generation = ${generation};\n`,
        );
      }
      if (key === "pnpm confect:codegen" && options?.deletedGenerated) {
        rmSync(
          resolve(
            cwd,
            "packages/template-core/src/generated/confectManifest.ts",
          ),
          { force: true },
        );
      }
      if (
        key.startsWith("pnpm exec prettier --write --") &&
        args.slice(5).some((file) => !existsSync(resolve(cwd, file)))
      ) {
        throw new Error("prettier received a missing generated file");
      }
      return "";
    },
  };
  return {
    baseSha,
    controlRoot,
    evidenceDirectory,
    events,
    input: {
      baseSha,
      controlRoot,
      evidenceDirectory,
      hooks,
      integrationId: "wave-000001",
      mode: "integrate",
      selectionFileSha256: selectionFileSha256(selectionContent),
      selectionPath,
      selectionPayloadSha256: selection.selectionPayloadSha256,
      workdir,
    },
    lanes,
    selectionPath,
    workdir,
  };
};

const rewriteSelection = (
  value: Fixture,
  changes: {
    readonly baseSha?: string;
    readonly selectedTasks?: readonly IntegrationWaveTaskSnapshot[];
  },
): ApplyIntegrationWaveInput => {
  const current = JSON.parse(readFileSync(value.selectionPath, "utf8")) as {
    readonly baseSha: string;
    readonly deferredTaskIds: readonly string[];
    readonly integrationId: string;
    readonly planSha256: string;
    readonly requestedTaskIds?: readonly string[];
    readonly selectedTasks: readonly IntegrationWaveTaskSnapshot[];
  };
  const payload = selectionPayload({
    baseSha: changes.baseSha ?? current.baseSha,
    deferredTaskIds: current.deferredTaskIds,
    integrationId: current.integrationId,
    planSha256: current.planSha256,
    ...(current.requestedTaskIds === undefined
      ? {}
      : { requestedTaskIds: current.requestedTaskIds }),
    selectedTasks: changes.selectedTasks ?? current.selectedTasks,
  });
  const selection = {
    ...payload,
    selectionPayloadSha256: selectionPayloadSha256(payload),
  };
  const content = writeJson(value.selectionPath, selection);
  return {
    ...value.input,
    baseSha: payload.baseSha,
    selectionFileSha256: selectionFileSha256(content),
    selectionPayloadSha256: selection.selectionPayloadSha256,
  };
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("deterministic integration wave application", () => {
  it("admits a historical lane whose exact tree is bound by its final gate", () => {
    const value = makeFixture({ historicalLaneWithoutTree: true });

    expect(applyIntegrationWave(value.input).includedTasks).toHaveLength(2);
  });

  it("applies a task snapshot bound to its historical validated proof plan", () => {
    const proofPlanSha256 = "7".repeat(64);
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S04-T02" }],
      proofPlanSha256,
    });
    const selection = readJson(value.selectionPath);
    const snapshots = selection.selectedTasks as Array<Record<string, unknown>>;

    expect(selection.planSha256).toBe("1".repeat(64));
    expect(snapshots[0]?.planSha256).toBe(proofPlanSha256);
    expect(applyIntegrationWave(value.input).includedTasks[0]?.taskId).toBe(
      "S04-T02",
    );
  });

  it("rejects a final gate plan that differs from the validated proof plan", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S04-T02" }],
      proofPlanSha256: "7".repeat(64),
    });
    const gatePath = resolve(
      value.evidenceDirectory,
      "lane-results/S04-T02/lane-gate-report.json",
    );
    const gate = readJson(gatePath);
    gate.planSha256 = "8".repeat(64);
    const gateContent = writeJson(gatePath, gate);
    const snapshot = value.lanes[0]?.snapshot as IntegrationWaveTaskSnapshot;
    const input = rewriteSelection(value, {
      selectedTasks: [{ ...snapshot, gateSha256: sha256(gateContent) }],
    });

    expect(() => applyIntegrationWave(input)).toThrow(
      "final lane gate receipt is invalid",
    );
  });

  it("applies independent lanes in immutable selection order", () => {
    const value = makeFixture({ reverseCreation: true });
    const result = applyIntegrationWave(value.input);
    expect(result.includedTasks.map((task) => task.taskId)).toEqual([
      "S01-T01",
      "S01-T02",
    ]);
    expect(result.includedTasks.map((task) => task.patchState)).toEqual([
      "applied",
      "applied",
    ]);
    expect(readFileSync(resolve(value.workdir, "a.ts"), "utf8")).toContain(
      "value0",
    );
    expect(readFileSync(resolve(value.workdir, "b.ts"), "utf8")).toContain(
      "value0",
    );
  });

  it("applies and records every commit in a multi-commit lane", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts", "b.ts"], taskId: "S01-T01" }],
    });
    const result = applyIntegrationWave(value.input);
    expect(result.includedTasks[0]?.commitShas).toEqual(
      value.lanes[0]?.commits,
    );
  });

  it("normalizes manifest dependency order while preserving membership", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S03-T02" }],
    });
    const sortedDependencies = ["S02-T02", "S02-T04", "S03-T01"];
    const manifestPath = resolve(
      value.controlRoot,
      "docs/superpowers/execution/maestro-brain/task-manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      tasks: Array<Record<string, unknown>>;
    };
    const task = manifest.tasks[0] as Record<string, unknown>;
    task.codeStartAfter = ["S03-T01", "S02-T02", "S02-T04"];
    writeJson(manifestPath, manifest);
    for (const dependencyId of sortedDependencies) {
      writeJson(
        resolve(
          value.evidenceDirectory,
          "lane-results",
          dependencyId,
          "lane-result.json",
        ),
        {
          taskId: dependencyId,
          status: "accepted",
          integrationHeadSha: value.baseSha,
        },
      );
    }
    const snapshot = value.lanes[0]?.snapshot as IntegrationWaveTaskSnapshot;
    const input = rewriteSelection(value, {
      selectedTasks: [{ ...snapshot, codeStartAfter: sortedDependencies }],
    });

    expect(applyIntegrationWave(input).includedTasks[0]?.taskId).toBe(
      "S03-T02",
    );
  });

  it("rejects manifest dependency membership drift after normalization", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S03-T02" }],
    });
    const manifestPath = resolve(
      value.controlRoot,
      "docs/superpowers/execution/maestro-brain/task-manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      tasks: Array<Record<string, unknown>>;
    };
    const task = manifest.tasks[0] as Record<string, unknown>;
    task.codeStartAfter = ["S03-T01", "S02-T02"];
    writeJson(manifestPath, manifest);
    const snapshot = value.lanes[0]?.snapshot as IntegrationWaveTaskSnapshot;
    const input = rewriteSelection(value, {
      selectedTasks: [
        {
          ...snapshot,
          codeStartAfter: ["S02-T02", "S02-T04", "S03-T01"],
        },
      ],
    });

    expect(() => applyIntegrationWave(input)).toThrow(
      "immutable manifest contract drift",
    );
  });

  it("accepts a completely present range during recovery", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    git(value.workdir, "cherry-pick", value.lanes[0]?.headSha as string);
    const recovered = applyIntegrationWave({ ...value.input, mode: "recover" });
    expect(recovered.includedTasks[0]?.patchState).toBe("already-present");
  });

  it("rejects a partially present range and leaves no Git residue", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts", "b.ts"], taskId: "S01-T01" }],
    });
    git(value.workdir, "cherry-pick", value.lanes[0]?.commits[0] as string);
    expect(() =>
      applyIntegrationWave({ ...value.input, mode: "recover" }),
    ).toThrow(/S01-T01.*partial|partial.*S01-T01/);
    expect(git(value.workdir, "status", "--porcelain")).toBe("");
    expect(existsSync(resolve(value.workdir, ".git/CHERRY_PICK_HEAD"))).toBe(
      false,
    );
  });

  it("aborts a conflicting cherry-pick and reports task and commit", () => {
    const value = makeFixture({
      laneSpecs: [
        { files: ["conflict"], taskId: "S01-T01" },
        { files: ["conflict/child.ts"], taskId: "S01-T02" },
      ],
    });
    expect(() => applyIntegrationWave(value.input)).toThrow(
      new RegExp(`S01-T02.*${value.lanes[1]?.commits[0]}`),
    );
    expect(git(value.workdir, "status", "--porcelain")).toBe("");
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("restores a recovery head when a later missing lane conflicts", () => {
    const value = makeFixture({
      laneSpecs: [
        { files: ["conflict"], taskId: "S01-T01" },
        { files: ["conflict/child.ts"], taskId: "S01-T02" },
      ],
    });
    git(value.workdir, "cherry-pick", value.lanes[0]?.headSha as string);
    const recoveryHead = git(value.workdir, "rev-parse", "HEAD");

    expect(() =>
      applyIntegrationWave({ ...value.input, mode: "recover" }),
    ).toThrow(new RegExp(`S01-T02.*${value.lanes[1]?.commits[0]}`));
    expect(git(value.workdir, "status", "--porcelain")).toBe("");
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(recoveryHead);
  });

  it("rejects evidence digest drift before mutating that task", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    write(
      resolve(
        value.evidenceDirectory,
        "lane-results/S01-T01/ci-proof-packet.json",
      ),
      "{}\n",
    );
    expect(() => applyIntegrationWave(value.input)).toThrow(
      /proof.*digest|digest.*proof/,
    );
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("accepts a canonical reproof digest when pretty file bytes differ", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
      reproof: true,
    });
    const requestPath = resolve(
      value.evidenceDirectory,
      "reproofs/S01-T01/request.json",
    );
    const request = readJson(requestPath);

    expect(sha256(readFileSync(requestPath))).not.toBe(request.requestSha256);
    expect(applyIntegrationWave(value.input).includedTasks[0]?.taskId).toBe(
      "S01-T01",
    );
  });

  it("rejects a selection reproof request digest mismatch", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
      reproof: true,
    });
    const snapshot = value.lanes[0]?.snapshot as IntegrationWaveTaskSnapshot;
    const input = rewriteSelection(value, {
      selectedTasks: [{ ...snapshot, reproofRequestSha256: "f".repeat(64) }],
    });

    expect(() => applyIntegrationWave(input)).toThrow(
      "reproof request digest drift",
    );
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("rejects a lane reproof request digest mismatch", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
      reproof: true,
    });
    const lanePath = resolve(
      value.evidenceDirectory,
      "lane-results/S01-T01/lane-result.json",
    );
    const lane = readJson(lanePath);
    const reproof = lane.reproof as Record<string, unknown>;
    reproof.requestSha256 = "f".repeat(64);
    const laneContent = writeJson(lanePath, lane);
    const snapshot = value.lanes[0]?.snapshot as IntegrationWaveTaskSnapshot;
    const input = rewriteSelection(value, {
      selectedTasks: [{ ...snapshot, laneResultSha256: sha256(laneContent) }],
    });

    expect(() => applyIntegrationWave(input)).toThrow(
      "reproof request digest drift",
    );
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it.each([
    ["priorIntegrationId", "wave-forged"],
    ["priorIntegrationHeadSha", "f".repeat(40)],
  ] as const)("rejects a lane reproof %s mismatch", (field, forged) => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
      reproof: true,
    });
    const lanePath = resolve(
      value.evidenceDirectory,
      "lane-results/S01-T01/lane-result.json",
    );
    const lane = readJson(lanePath);
    const reproof = lane.reproof as Record<string, unknown>;
    reproof[field] = forged;
    const laneContent = writeJson(lanePath, lane);
    const snapshot = value.lanes[0]?.snapshot as IntegrationWaveTaskSnapshot;
    const input = rewriteSelection(value, {
      selectedTasks: [{ ...snapshot, laneResultSha256: sha256(laneContent) }],
    });

    expect(() => applyIntegrationWave(input)).toThrow(
      "lane reproof lineage drift",
    );
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("rejects prior archive bytes outside the bound digest", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
      reproof: true,
    });
    write(
      resolve(value.evidenceDirectory, "archive/S01-T01.json"),
      '{"status":"drifted"}\n',
    );

    expect(() => applyIntegrationWave(value.input)).toThrow(
      "prior reproof evidence drift",
    );
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("accepts a proof base shared by the lane and a later wave base", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    write(resolve(value.workdir, "descendant.txt"), "new wave base\n");
    git(value.workdir, "add", "descendant.txt");
    git(value.workdir, "commit", "-qm", "test: advance wave base");
    const descendantBase = git(value.workdir, "rev-parse", "HEAD");
    const input = rewriteSelection(value, { baseSha: descendantBase });

    expect(applyIntegrationWave(input).includedTasks[0]?.taskId).toBe(
      "S01-T01",
    );
    expect(
      git(value.workdir, "merge-base", value.baseSha, descendantBase),
    ).toBe(value.baseSha);
  });

  it("rejects a proof base outside the wave-base ancestry", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    git(value.workdir, "checkout", "-q", "--orphan", "unrelated-wave");
    git(value.workdir, "rm", "-qrf", ".");
    write(resolve(value.workdir, "unrelated.txt"), "unrelated wave base\n");
    git(value.workdir, "add", ".");
    git(value.workdir, "commit", "-qm", "test: unrelated wave base");
    const unrelatedBase = git(value.workdir, "rev-parse", "HEAD");
    const input = rewriteSelection(value, { baseSha: unrelatedBase });

    expect(() => applyIntegrationWave(input)).toThrow(
      /proof base.*ancestor.*wave base/,
    );
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(unrelatedBase);
  });

  it("hashes raw evidence bytes before lossy UTF-8 decoding", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    const proofPath = resolve(
      value.evidenceDirectory,
      "lane-results/S01-T01/ci-proof-packet.json",
    );
    const valid = readFileSync(proofPath);
    const first = Buffer.concat([valid, Buffer.from([0x80])]);
    const second = Buffer.concat([valid, Buffer.from([0x81])]);
    expect(first.toString("utf8")).toBe(second.toString("utf8"));
    expect(sha256(first)).not.toBe(sha256(second));
    const lossyDigest = sha256(first.toString("utf8"));
    const snapshot = value.lanes[0]?.snapshot as IntegrationWaveTaskSnapshot;
    const input = rewriteSelection(value, {
      selectedTasks: [{ ...snapshot, proofSha256: lossyDigest }],
    });

    for (const bytes of [first, second]) {
      writeFileSync(proofPath, bytes);
      expect(() => applyIntegrationWave(input)).toThrow("proof digest drift");
    }
  });

  it("accepts stable allowlisted generated output and commits it", () => {
    const value = makeFixture({
      generated: true,
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    const result = applyIntegrationWave(value.input);
    expect(result.generatedFiles).toEqual([
      "packages/template-core/src/generated/confectManifest.ts",
    ]);
    expect(git(value.workdir, "status", "--porcelain")).toBe("");
  });

  it("writes the integration-owned migration registry before Confect generation", () => {
    const script = "packages/convex/scripts/generate-migration-registry.mts";
    const registry = "packages/convex/confect/internal/migrations.generated.ts";
    const value = makeFixture({
      laneSpecs: [{ files: [script], taskId: "S05-T01" }],
    });
    const original = value.input.hooks as ApplyIntegrationWaveHooks;
    const hooks: ApplyIntegrationWaveHooks = {
      ...original,
      run: (args, cwd) => {
        const key = args.join(" ");
        if (
          key ===
          `pnpm --dir packages/convex exec tsx scripts/generate-migration-registry.mts --root ${cwd} --write`
        ) {
          write(resolve(cwd, registry), "export default [];\n");
        }
        return original.run(args, cwd);
      },
    };

    const applied = applyIntegrationWave({ ...value.input, hooks });
    expect(value.events.indexOf("pnpm confect:codegen")).toBeGreaterThan(
      value.events.findIndex((event) => event.includes("--write")),
    );
    expect(applied.generatedFiles).toContain(registry);
    expect(
      git(value.workdir, "show", "--name-only", "--format=", "HEAD")
        .split("\n")
        .filter(Boolean),
    ).toEqual([registry]);
  });

  it("rejects extra migration-generator output and restores the candidate", () => {
    const script = "packages/convex/scripts/generate-migration-registry.mts";
    const value = makeFixture({
      laneSpecs: [{ files: [script], taskId: "S05-T01" }],
    });
    const original = value.input.hooks as ApplyIntegrationWaveHooks;
    const hooks: ApplyIntegrationWaveHooks = {
      ...original,
      run: (args, cwd) => {
        if (args.includes("--write")) {
          write(
            resolve(
              cwd,
              "packages/convex/confect/internal/migrations.generated.ts",
            ),
            "export default [];\n",
          );
          write(resolve(cwd, "migration-generator-extra.ts"), "attack\n");
        }
        return original.run(args, cwd);
      },
    };

    expect(() => applyIntegrationWave({ ...value.input, hooks })).toThrow(
      /generation changed unauthorized files/,
    );
    expect(git(value.workdir, "status", "--porcelain")).toBe("");
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("rejects a migration generator that changes HEAD", () => {
    const script = "packages/convex/scripts/generate-migration-registry.mts";
    const value = makeFixture({
      laneSpecs: [{ files: [script], taskId: "S05-T01" }],
    });
    const original = value.input.hooks as ApplyIntegrationWaveHooks;
    const hooks: ApplyIntegrationWaveHooks = {
      ...original,
      run: (args, cwd) => {
        if (args.includes("--write")) {
          write(resolve(cwd, "generator-commit.ts"), "attack\n");
          git(cwd, "add", "generator-commit.ts");
          git(cwd, "commit", "-qm", "test: generator attack");
        }
        return original.run(args, cwd);
      },
    };

    expect(() => applyIntegrationWave({ ...value.input, hooks })).toThrow(
      /generator changed HEAD/,
    );
    expect(git(value.workdir, "status", "--porcelain")).toBe("");
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("applies and validates deterministic global Confect aggregates", () => {
    const value = makeFixture({
      globalConfectAggregates: true,
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    const generatedFiles = [
      "packages/convex/confect/_generated/convexSchema.ts",
      "packages/convex/confect/_generated/docs.ts",
      "packages/convex/confect/_generated/id.ts",
      "packages/convex/confect/_generated/schema.ts",
    ];

    const applied = applyIntegrationWave(value.input);
    expect(applied.generatedFiles).toEqual(generatedFiles);
    expect(
      value.events.filter((event) => event === "pnpm confect:codegen"),
    ).toHaveLength(2);
    expect(
      git(value.workdir, "show", "--name-only", "--format=", "HEAD")
        .split("\n")
        .filter(Boolean)
        .sort(),
    ).toEqual(generatedFiles);

    const resultPath = resolve(
      value.evidenceDirectory,
      "integration/wave-000001/integration-result.json",
    );
    const result = readJson(resultPath);
    Object.assign(result, {
      broadGate: {
        command: "rtk host-test-slot --class full pnpm verify",
        headSha: applied.headSha,
        status: "passed",
      },
      integrationWorkdir: realpathSync(value.workdir),
      manifestTranches: ["F0-foundation"],
      remainingFindings: [],
      reviewVerdict: "pass",
      status: "passed",
    });
    writeJson(resultPath, result);

    const lane = value.lanes[0] as LaneFixture;
    writeJson(
      resolve(value.evidenceDirectory, "lane-results/S01-T01/lane-result.json"),
      {
        acceptanceBlocker: "external acceptance evidence is not yet present",
        accepted: false,
        headSha: lane.headSha,
        integrationHeadSha: applied.headSha,
        integrationId: "wave-000001",
        preIntegrationLaneResultSha256: lane.snapshot.laneResultSha256,
        schemaVersion: "maestro-brain-lane-result/v1",
        status: "integrated",
        taskId: "S01-T01",
        tranche: "F0-foundation",
      },
    );

    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidenceDirectory,
        expectedWorkdir: value.workdir,
        integrationId: "wave-000001",
        selectionPath: value.selectionPath,
      }),
    ).not.toThrow();
  });

  it("allows deterministic output derived from pre-existing Confect implementations", () => {
    const value = makeFixture({
      generatedFromExistingConfectImpl: true,
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });

    expect(applyIntegrationWave(value.input).generatedFiles).toEqual([
      "packages/convex/confect/_generated/spec.ts",
      "packages/convex/convex/integrations/slackConnections.ts",
    ]);
  });

  it("reaches a bounded fixed point when generated output feeds later generation", () => {
    const value = makeFixture({
      secondPassConvergence: true,
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });

    expect(applyIntegrationWave(value.input).generatedFiles).toEqual([
      "packages/template-core/src/generated/confectManifest.ts",
    ]);
  });

  it("allows transient generated drift that converges back to the exact head", () => {
    const value = makeFixture({
      transientFirstGeneration: true,
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });

    expect(applyIntegrationWave(value.input).generatedFiles).toEqual([]);
  });

  it("rejects oscillating generated output and restores the base", () => {
    const value = makeFixture({
      oscillatingGeneration: true,
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });

    expect(() => applyIntegrationWave(value.input)).toThrow(/byte-stable/);
    expect(git(value.workdir, "status", "--porcelain")).toBe("");
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("records generated deletions without passing absent paths to Prettier", () => {
    const value = makeFixture({
      deletedGenerated: true,
      generatedBase: true,
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    const result = applyIntegrationWave(value.input);
    expect(result.generatedFiles).toEqual([
      "packages/template-core/src/generated/confectManifest.ts",
    ]);
    expect(
      existsSync(
        resolve(
          value.workdir,
          "packages/template-core/src/generated/confectManifest.ts",
        ),
      ),
    ).toBe(false);
  });

  it("rejects a generator that commits outside the allowlist", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    let generated = false;
    const hooks: ApplyIntegrationWaveHooks = {
      ...(value.input.hooks as ApplyIntegrationWaveHooks),
      run: (args, cwd) => {
        if (args.join(" ") === "pnpm confect:codegen" && !generated) {
          generated = true;
          write(
            resolve(cwd, "hand-authored.ts"),
            "export const attack = true;\n",
          );
          git(cwd, "add", "hand-authored.ts");
          git(cwd, "commit", "-qm", "test: generator attack");
        }
        return "";
      },
    };
    expect(() => applyIntegrationWave({ ...value.input, hooks })).toThrow(
      /generator.*HEAD|HEAD.*generator/,
    );
    expect(git(value.workdir, "status", "--porcelain")).toBe("");
    expect(existsSync(resolve(value.workdir, "hand-authored.ts"))).toBe(false);
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("rejects an unrelated generated-only commit during recovery", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    git(value.workdir, "cherry-pick", value.lanes[0]?.headSha as string);
    write(
      resolve(
        value.workdir,
        "packages/template-core/src/generated/confectManifest.ts",
      ),
      "export const forged = true;\n",
    );
    git(value.workdir, "add", ".");
    git(value.workdir, "commit", "-qm", "test: forged generated output");
    expect(() =>
      applyIntegrationWave({ ...value.input, mode: "recover" }),
    ).toThrow(/unrelated|unrecorded/);
  });

  it("rejects an exact-subject recovery commit with an underived generated path", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    git(value.workdir, "cherry-pick", value.lanes[0]?.headSha as string);
    write(
      resolve(value.workdir, "packages/convex/convex/forged.ts"),
      "export const forged = true;\n",
    );
    git(value.workdir, "add", ".");
    git(
      value.workdir,
      "commit",
      "-qm",
      "chore: refresh integration generated output",
    );

    expect(() =>
      applyIntegrationWave({ ...value.input, mode: "recover" }),
    ).toThrow(/unrelated|unrecorded/);
  });

  it("rejects a recovered route tree when no selected route input runs its generator", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    git(value.workdir, "cherry-pick", value.lanes[0]?.headSha as string);
    write(
      resolve(value.workdir, "apps/web/src/routeTree.gen.ts"),
      "export const forged = true;\n",
    );
    git(value.workdir, "add", ".");
    git(
      value.workdir,
      "commit",
      "-qm",
      "chore: refresh integration generated output",
    );

    expect(() =>
      applyIntegrationWave({ ...value.input, mode: "recover" }),
    ).toThrow(/unrelated|unrecorded/);
  });

  it("cleans tracked residue when hydration fails", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    const hooks: ApplyIntegrationWaveHooks = {
      ...(value.input.hooks as ApplyIntegrationWaveHooks),
      hydrate: (_root, workdir) => {
        write(resolve(workdir, "base.txt"), "dirty\n");
        throw new Error("hydrate failed");
      },
    };
    expect(() => applyIntegrationWave({ ...value.input, hooks })).toThrow(
      "hydrate failed",
    );
    expect(git(value.workdir, "status", "--porcelain")).toBe("");
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("cleans tracked residue when a focused check fails", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    const original = value.input.hooks as ApplyIntegrationWaveHooks;
    const hooks: ApplyIntegrationWaveHooks = {
      ...original,
      run: (args, workdir) => {
        if (args.join(" ") === "pnpm --dir packages/search typecheck") {
          write(resolve(workdir, "base.txt"), "dirty\n");
          throw new Error("focused failed");
        }
        return original.run(args, workdir);
      },
    };
    expect(() => applyIntegrationWave({ ...value.input, hooks })).toThrow(
      "focused failed",
    );
    expect(git(value.workdir, "status", "--porcelain")).toBe("");
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("restores the pre-call head when result persistence fails", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    const hooks: ApplyIntegrationWaveHooks & {
      readonly writeResult: () => never;
    } = {
      ...(value.input.hooks as ApplyIntegrationWaveHooks),
      writeResult: () => {
        throw new Error("receipt failed");
      },
    };

    expect(() => applyIntegrationWave({ ...value.input, hooks })).toThrow(
      "receipt failed",
    );
    expect(git(value.workdir, "status", "--porcelain")).toBe("");
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("rejects an invalid API mode before mutation", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    expect(() =>
      applyIntegrationWave({
        ...value.input,
        mode: "unsafe" as ApplyIntegrationWaveInput["mode"],
      }),
    ).toThrow(/mode.*integrate.*recover/);
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });

  it("hydrates once before generation and runs deduplicated focused checks", () => {
    const value = makeFixture();
    const result = applyIntegrationWave(value.input);
    expect(value.events).toEqual([
      "hydrate",
      "pnpm confect:codegen",
      "pnpm confect:manifest",
      "pnpm confect:codegen",
      "pnpm confect:manifest",
      "pnpm --dir packages/search typecheck",
    ]);
    expect(result.focusedChecks).toEqual([
      "rtk pnpm --dir packages/search typecheck",
    ]);
    expect(result.headSha).toBe(git(value.workdir, "rev-parse", "HEAD"));
    expect(result.conflicts).toEqual([]);
  });

  it("rejects file and payload hash swaps before mutation", () => {
    const value = makeFixture({
      laneSpecs: [{ files: ["a.ts"], taskId: "S01-T01" }],
    });
    expect(() =>
      applyIntegrationWave({
        ...value.input,
        selectionFileSha256: value.input.selectionPayloadSha256,
        selectionPayloadSha256: value.input.selectionFileSha256,
      }),
    ).toThrow(/selection file hash mismatch/);
    expect(git(value.workdir, "rev-parse", "HEAD")).toBe(value.baseSha);
  });
});
