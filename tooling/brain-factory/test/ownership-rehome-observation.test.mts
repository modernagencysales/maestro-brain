import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { authorityRefreshCoordinates } from "../src/authority-refresh.js";
import type { OwnershipRehomeObservationInput } from "../src/ownership-rehome-observation.js";
import { loadOwnershipRehomeObservation } from "../src/ownership-rehome-observation.js";
import { observeControllerSnapshot } from "../src/controller-observation.js";
import { buildManifest } from "../src/manifest.js";
import { DEFAULT_REVIEW_RUBRIC_IDS } from "../src/review-lens.js";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const sha = (digit: string): string => digit.repeat(40);

const fixture = (
  coordinates: {
    readonly branch?: string;
    readonly commonDir?: string;
    readonly sourceBaseSha?: string;
    readonly sourceHeadSha?: string;
    readonly sourceTreeSha?: string;
    readonly workdir?: string;
  } = {},
) => {
  const sourceBaseSha = coordinates.sourceBaseSha ?? sha("1");
  const sourceHeadSha = coordinates.sourceHeadSha ?? sha("2");
  const sourceTreeSha = coordinates.sourceTreeSha ?? sha("3");
  const branch = coordinates.branch ?? "fabro/review-s13-t03-authority-test";
  const commonDir = coordinates.commonDir ?? "/repo/.git";
  const workdir = coordinates.workdir ?? "/worktree/s13-t03";
  const planSha256 = "4".repeat(64);
  const taskBlockHash = "5".repeat(64);
  const reviewAttempt = "attempt-v1";
  const proof = JSON.stringify({
    schemaVersion: "maestro-brain-ci-proof/v1",
    planSha256,
    taskBlockHash,
    taskId: "S13-T03",
    baseSha: sourceBaseSha,
    headSha: sourceHeadSha,
    changedFiles: [
      "packages/observability/src/brainMetrics.test.ts",
      "tooling/quality/check-logging-boundary.mts",
    ],
    reviewVerdict: "pass",
    reviewFindings: [],
    reviewHeadSha: sourceHeadSha,
  });
  const gate = JSON.stringify({
    schemaVersion: "maestro-brain-lane-gate/v1",
    currentHeadSha: sourceHeadSha,
    currentTreeSha: sourceTreeSha,
    headSha: sourceHeadSha,
    planSha256,
    stage: "final",
    status: "passed",
    taskId: "S13-T03",
    taskBlockHash,
  });
  const laneResult = JSON.stringify({
    schemaVersion: "maestro-brain-lane-result/v1",
    taskId: "S13-T03",
    headSha: sourceHeadSha,
    treeSha: sourceTreeSha,
    tranche: "X3-convergence",
    status: "lane_green",
  });
  const lens = (name: "contract" | "quality" | "safety") => ({
    lens: name,
    taskId: "S13-T03",
    planSha256,
    taskBlockHash,
    baseSha: sourceBaseSha,
    headSha: sourceHeadSha,
    treeSha: sourceTreeSha,
    reviewerRunId: `maestro/review/S13-T03/${sourceHeadSha}/${reviewAttempt}/${name}`,
    rubricDispositions: DEFAULT_REVIEW_RUBRIC_IDS[name].map((rubricId) => ({
      rubricId,
      disposition: "pass",
      evidence: [`${name}:${rubricId}`],
    })),
    findings: [],
    verdict: "pass",
  });
  const lenses = {
    contract: JSON.stringify(lens("contract")),
    quality: JSON.stringify(lens("quality")),
    safety: JSON.stringify(lens("safety")),
  };
  const finding = [
    "Maestro Brain S13-T03 ownership-rehome finding",
    "",
    "Task: S13-T03",
    `Current proven lane-green head: ${sourceHeadSha}`,
    `Current proven tree: ${sourceTreeSha}`,
    "Source run: 01KY0KKPKS1JMRX8M50XX5Y7YP (terminal status succeeded, reason completed)",
    `Source base: ${sourceBaseSha}`,
    `Source plan SHA-256: ${planSha256}`,
    `Source task-block SHA-256: ${taskBlockHash}`,
    `CI proof SHA-256: ${sha256(proof)}`,
    `Final lane-gate SHA-256: ${sha256(gate)}`,
    `Lane-result SHA-256: ${sha256(laneResult)}`,
    `Contract lens SHA-256: ${sha256(lenses.contract)}`,
    `Safety lens SHA-256: ${sha256(lenses.safety)}`,
    `Quality lens SHA-256: ${sha256(lenses.quality)}`,
    `Review attempt: ${reviewAttempt}`,
    "",
    "Authorized disposition: remove tooling/quality/check-logging-boundary.mts from S13-T03 ownership and rewrite only that one checker delta away. packages/observability/src/brainMetrics.test.ts remains S13-T03-owned and is the replacement proof location for prompt/source/token/header redaction canaries. S04-T03 remains sole owner of the checker. All other S13-T03 product changes, proof requirements, and prerequisite edges remain unchanged.",
  ].join("\n");
  const transition = {
    schemaVersion: "maestro-brain-ownership-rehome-transition/v1",
    classification: "ownership-rehome",
    fromPlanSha256: planSha256,
    fromTaskBlockHash: taskBlockHash,
    sourceRunId: "01KY0KKPKS1JMRX8M50XX5Y7YP",
    sourceBaseSha,
    sourceHeadSha,
    sourceTreeSha,
    requiredIntegratedTaskIds: ["S06-T02", "S08-T01"],
    immutableFinding: {
      kind: "git-blob",
      ref: "refs/maestro-brain/evidence/s13-t03-checker-rehome-20260720",
      objectSha: sha("6"),
      contentSha256: sha256(finding),
    },
    supersededPaths: [
      {
        path: "tooling/quality/check-logging-boundary.mts",
        replacementPath: "packages/observability/src/brainMetrics.test.ts",
        disposition: "replaced-by-current-owned-artifact",
      },
    ],
  } as const;
  const input: OwnershipRehomeObservationInput = {
    task: {
      taskId: "S13-T03",
      fileLocks: ["packages/observability/src/brainMetrics.test.ts"],
      ownershipRehomeTransition: transition,
    },
    runRecordContent: JSON.stringify({
      baseSha: sourceBaseSha,
      branch,
      mode: "authority-refresh",
      status: "launched",
      taskId: "S13-T03",
      workdir,
      runId: transition.sourceRunId,
    }),
    proofContent: proof,
    gateContent: gate,
    laneResultContent: laneResult,
    lensContents: lenses,
    expectedBranch: branch,
    expectedCommonDir: commonDir,
    expectedWorkdir: workdir,
    integratedTaskIds: ["S06-T02"],
    currentRejection: {
      transitionKind: "ownership-rehome" as const,
      taskId: "S13-T03",
      sourceRunId: transition.sourceRunId,
      workdir,
      sourceHeadSha,
      sourceTreeSha,
      missingPrerequisiteTaskIds: ["S08-T01"],
      message:
        "S13-T03: ownership-rehome prerequisite is not integrated: S08-T01",
    },
    inspectRun: () => ({ status: "succeeded" as const, reason: "completed" }),
    readImmutableRef: () => ({
      objectSha: transition.immutableFinding.objectSha,
      content: finding,
    }),
    readWorktree: (worktreePath: string) => ({
      branch,
      clean: true,
      commonDir,
      detached: false,
      headSha: sourceHeadSha,
      path: worktreePath,
      registered: true,
      treeSha: sourceTreeSha,
    }),
  };
  const rebindLens = (
    name: keyof typeof lenses,
    artifact: Record<string, unknown>,
  ) => {
    const content = JSON.stringify(artifact);
    const label = `${name.charAt(0).toUpperCase()}${name.slice(1)} lens SHA-256`;
    const findingContent = finding.replace(
      new RegExp(`${label}: [0-9a-f]{64}`),
      `${label}: ${sha256(content)}`,
    );
    const reboundTransition = {
      ...transition,
      immutableFinding: {
        ...transition.immutableFinding,
        contentSha256: sha256(findingContent),
      },
    };
    return {
      ...input,
      task: {
        ...input.task,
        ownershipRehomeTransition: reboundTransition,
      },
      lensContents: { ...input.lensContents, [name]: content },
      readImmutableRef: () => ({
        objectSha: reboundTransition.immutableFinding.objectSha,
        content: findingContent,
      }),
    };
  };
  return { input, lens, rebindLens, transition };
};

describe("ownership-rehome observation", () => {
  it("reaches a task-scoped hold through the production controller observer", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "ownership-controller-"));
    const controlRoot = join(sandbox, "control");
    const stateRoot = join(sandbox, "state");
    const git = (cwd: string, ...args: string[]): string =>
      execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    mkdirSync(controlRoot);
    git(controlRoot, "init", "-b", "control");
    git(controlRoot, "config", "user.email", "test@example.com");
    git(controlRoot, "config", "user.name", "Test");
    writeFileSync(join(controlRoot, ".gitignore"), ".tokensave\n");
    writeFileSync(join(controlRoot, "source.txt"), "base\n");
    git(controlRoot, "add", ".gitignore", "source.txt");
    git(controlRoot, "commit", "-m", "base");
    const sourceBaseSha = git(controlRoot, "rev-parse", "HEAD");
    writeFileSync(join(controlRoot, "source.txt"), "candidate\n");
    git(controlRoot, "commit", "-am", "candidate");
    const sourceHeadSha = git(controlRoot, "rev-parse", "HEAD");
    const sourceTreeSha = git(controlRoot, "rev-parse", "HEAD^{tree}");
    const seed = fixture({ sourceBaseSha, sourceHeadSha, sourceTreeSha });
    const coordinates = authorityRefreshCoordinates({
      controlHeadSha: sourceBaseSha,
      planSha256: seed.transition.fromPlanSha256,
      root: controlRoot,
      taskBlockHash: seed.transition.fromTaskBlockHash,
      taskId: "S13-T03",
    });
    const { branch, workdir } = coordinates;
    git(controlRoot, "worktree", "add", "-b", branch, workdir, "HEAD");
    const resolvedWorkdir = realpathSync(workdir);
    const commonDir = realpathSync(
      git(
        controlRoot,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ),
    );
    const value = fixture({
      branch,
      commonDir,
      sourceBaseSha,
      sourceHeadSha,
      sourceTreeSha,
      workdir: resolvedWorkdir,
    });
    const immutable = value.input.readImmutableRef(
      value.transition.immutableFinding.ref,
    );
    const objectSha = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: controlRoot,
      encoding: "utf8",
      input: immutable.content,
    }).trim();
    git(
      controlRoot,
      "update-ref",
      value.transition.immutableFinding.ref,
      objectSha,
    );
    const transition = {
      ...value.transition,
      requiredIntegratedTaskIds: ["S06-T02"],
      immutableFinding: {
        ...value.transition.immutableFinding,
        objectSha,
      },
    };
    const generated = buildManifest();
    const manifest = {
      ...generated,
      tasks: generated.tasks.map((task) =>
        task.taskId === "S13-T03"
          ? {
              ...task,
              fileLocks: value.input.task.fileLocks,
              ownershipRehomeTransition: transition,
            }
          : task,
      ),
    };
    const laneDirectory = join(
      stateRoot,
      "evidence",
      "lane-results",
      "S13-T03",
    );
    const runDirectory = join(stateRoot, "runs");
    const lensDirectory = join(laneDirectory, "review-lenses", sourceHeadSha);
    mkdirSync(lensDirectory, { recursive: true });
    mkdirSync(runDirectory, { recursive: true });
    writeFileSync(
      join(laneDirectory, "ci-proof-packet.json"),
      value.input.proofContent,
    );
    writeFileSync(
      join(laneDirectory, "lane-gate-report.json"),
      value.input.gateContent,
    );
    writeFileSync(
      join(laneDirectory, "lane-result.json"),
      value.input.laneResultContent,
    );
    for (const lens of ["contract", "quality", "safety"] as const)
      writeFileSync(
        join(lensDirectory, `${lens}.json`),
        value.input.lensContents[lens],
      );
    writeFileSync(
      join(runDirectory, "S13-T03.json.terminal-exact"),
      value.input.runRecordContent,
    );

    const task = observeControllerSnapshot({
      controlHeadSha: sourceHeadSha,
      controlRoot,
      inspect: () => "succeeded",
      manifest,
      stateRoot,
    }).tasks.find((candidate) => candidate.taskId === "S13-T03");

    expect(task).toMatchObject({
      globallyBlocking: false,
      headSha: sourceHeadSha,
      missingPrerequisiteTaskIds: ["S06-T02"],
      runId: transition.sourceRunId,
      stage: "authority_transition_held",
      status: "authority_transition_held",
      taskId: "S13-T03",
    });

    const readyManifest = {
      ...manifest,
      tasks: manifest.tasks.map((task) =>
        task.taskId === "S13-T03"
          ? {
              ...task,
              ownershipRehomeTransition: {
                ...transition,
                requiredIntegratedTaskIds: [],
              },
            }
          : task,
      ),
    };
    expect(
      observeControllerSnapshot({
        controlRoot,
        inspect: () => "succeeded",
        manifest: readyManifest,
        stateRoot,
      }).tasks.find((candidate) => candidate.taskId === "S13-T03"),
    ).toMatchObject({
      authorityTransition: "ownership-rehome",
      stage: "authority_transition_ready",
      status: "authority_transition_ready",
      taskId: "S13-T03",
    });

    const rogueWorkdir = join(sandbox, "rogue-source");
    const rogueBranch = "fabro/review-s13-t03-authority-rogue";
    git(
      controlRoot,
      "worktree",
      "add",
      "-b",
      rogueBranch,
      rogueWorkdir,
      sourceHeadSha,
    );
    writeFileSync(
      join(runDirectory, `S13-T03.json.terminal-${transition.sourceRunId}`),
      JSON.stringify({
        ...JSON.parse(value.input.runRecordContent),
        branch: rogueBranch,
        workdir: realpathSync(rogueWorkdir),
      }),
    );
    expect(
      observeControllerSnapshot({
        controlRoot,
        inspect: () => "succeeded",
        manifest,
        stateRoot,
      }).tasks.find((candidate) => candidate.taskId === "S13-T03"),
    ).toMatchObject({ status: "unknown", taskId: "S13-T03" });
  });

  it("holds only the task authority transition when prerequisites are unmet", () => {
    const { input } = fixture();

    expect(loadOwnershipRehomeObservation(input)).toEqual({
      globallyBlocking: false,
      missingPrerequisiteTaskIds: ["S08-T01"],
      sourceHeadSha: sha("2"),
      sourceRunId: "01KY0KKPKS1JMRX8M50XX5Y7YP",
      status: "authority_transition_held",
      taskId: "S13-T03",
    });
  });

  it("observes readiness only after every exact prerequisite is integrated", () => {
    const { input } = fixture();

    expect(
      loadOwnershipRehomeObservation({
        ...input,
        integratedTaskIds: ["S08-T01", "S06-T02"],
        currentRejection: undefined,
      }).status,
    ).toBe("authority_transition_ready");
  });

  it.each([
    [
      "incomplete",
      (artifact: Record<string, unknown>) => {
        delete artifact.rubricDispositions;
      },
    ],
    [
      "wrong-head",
      (artifact: Record<string, unknown>) => {
        artifact.headSha = sha("9");
      },
    ],
    [
      "wrong-reviewer-run",
      (artifact: Record<string, unknown>) => {
        artifact.reviewerRunId = "untrusted-review-run";
      },
    ],
    [
      "rework",
      (artifact: Record<string, unknown>) => {
        artifact.rubricDispositions = [
          {
            rubricId: DEFAULT_REVIEW_RUBRIC_IDS.contract[0],
            disposition: "finding",
            evidence: ["review evidence"],
            findingIds: ["finding-1"],
          },
          ...DEFAULT_REVIEW_RUBRIC_IDS.contract.slice(1).map((rubricId) => ({
            rubricId,
            disposition: "pass",
            evidence: ["review evidence"],
          })),
        ];
        artifact.findings = [
          {
            id: "finding-1",
            severity: "important",
            summary: "Review found drift",
            evidence: ["review evidence"],
          },
        ];
        artifact.verdict = "rework";
      },
    ],
  ])(
    "rejects a semantically %s review lens despite matching digests",
    (_label, mutate) => {
      const { lens, rebindLens } = fixture();
      const artifact = lens("contract") as Record<string, unknown>;
      mutate(artifact);

      expect(() =>
        loadOwnershipRehomeObservation(rebindLens("contract", artifact)),
      ).toThrow();
    },
  );

  it("requires a current exact unmet-prerequisite rejection before holding", () => {
    const { input } = fixture();

    expect(() =>
      loadOwnershipRehomeObservation({
        ...input,
        currentRejection: undefined,
      }),
    ).toThrow("current ownership-rehome rejection is missing");
  });

  it.each([
    ["transition kind", { transitionKind: "authority-repair" }],
    ["source head", { sourceHeadSha: sha("9") }],
    ["worktree", { workdir: "/worktree/other" }],
    ["missing prerequisites", { missingPrerequisiteTaskIds: ["S06-T02"] }],
    ["message", { message: "generic prerequisite rejection" }],
    ["shape", { unexpected: "not exact" }],
  ])("fails closed on drifted current rejection %s", (_label, drift) => {
    const { input } = fixture();

    expect(() =>
      loadOwnershipRehomeObservation({
        ...input,
        currentRejection: {
          ...input.currentRejection,
          ...drift,
        } as typeof input.currentRejection,
      }),
    ).toThrow("current ownership-rehome rejection provenance mismatch");
  });

  it.each([
    ["dirty", { clean: false }],
    ["unregistered", { registered: false }],
    ["wrong branch", { branch: "fabro/review-other" }],
    ["foreign common directory", { commonDir: "/foreign/.git" }],
    ["detached", { detached: true }],
    ["wrong path", { path: "/worktree/other" }],
  ])("rejects a %s source worktree", (_label, drift) => {
    const { input } = fixture();
    const exact = input.readWorktree(input.expectedWorkdir);

    expect(() =>
      loadOwnershipRehomeObservation({
        ...input,
        readWorktree: () => ({ ...exact, ...drift }),
      }),
    ).toThrow("source worktree identity mismatch");
  });

  it("rejects a mutually consistent archived branch substitution", () => {
    const { input } = fixture();
    const run = JSON.parse(input.runRecordContent) as Record<string, unknown>;
    run.branch = "fabro/review-s13-t03-authority-substituted";
    const exact = input.readWorktree(input.expectedWorkdir);

    expect(() =>
      loadOwnershipRehomeObservation({
        ...input,
        runRecordContent: JSON.stringify(run),
        readWorktree: () => ({ ...exact, branch: String(run.branch) }),
      }),
    ).toThrow("source worktree identity mismatch");
  });

  it("does not trust manifest transition presence without proof provenance", () => {
    const { input } = fixture();
    const proof = JSON.parse(input.proofContent) as Record<string, unknown>;
    proof.reviewVerdict = "rework";

    expect(() =>
      loadOwnershipRehomeObservation({
        ...input,
        proofContent: JSON.stringify(proof),
      }),
    ).toThrow("immutable finding CI proof digest mismatch");
  });

  it.each([
    [
      "source run",
      (input: ReturnType<typeof fixture>["input"]) => ({
        ...input,
        inspectRun: () => ({ status: "failed" as const, reason: "completed" }),
      }),
    ],
    [
      "source worktree",
      (input: ReturnType<typeof fixture>["input"]) => ({
        ...input,
        readWorktree: () => ({
          ...input.readWorktree(input.expectedWorkdir),
          headSha: sha("9"),
        }),
      }),
    ],
    [
      "source run worktree binding",
      (input: ReturnType<typeof fixture>["input"]) => ({
        ...input,
        expectedWorkdir: "/worktree/other",
      }),
    ],
    [
      "immutable ref",
      (input: ReturnType<typeof fixture>["input"]) => ({
        ...input,
        readImmutableRef: () => ({ objectSha: sha("9"), content: "tampered" }),
      }),
    ],
    [
      "lane gate",
      (input: ReturnType<typeof fixture>["input"]) => ({
        ...input,
        gateContent: `${input.gateContent}\n`,
      }),
    ],
    [
      "lane result",
      (input: ReturnType<typeof fixture>["input"]) => ({
        ...input,
        laneResultContent: `${input.laneResultContent}\n`,
      }),
    ],
    [
      "review lens",
      (input: ReturnType<typeof fixture>["input"]) => ({
        ...input,
        lensContents: {
          ...input.lensContents,
          safety: `${input.lensContents.safety}\n`,
        },
      }),
    ],
  ])("rejects drifted %s provenance", (_label, mutate) => {
    const { input } = fixture();
    expect(() => loadOwnershipRehomeObservation(mutate(input))).toThrow();
  });
});
