import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { loadOwnershipRehomeObservation } from "../src/ownership-rehome-observation.js";
import { DEFAULT_REVIEW_RUBRIC_IDS } from "../src/review-lens.js";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const sha = (digit: string): string => digit.repeat(40);

const fixture = () => {
  const sourceBaseSha = sha("1");
  const sourceHeadSha = sha("2");
  const sourceTreeSha = sha("3");
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
  const input = {
    task: {
      taskId: "S13-T03",
      fileLocks: ["packages/observability/src/brainMetrics.test.ts"],
      ownershipRehomeTransition: transition,
    },
    runRecordContent: JSON.stringify({
      baseSha: sourceBaseSha,
      mode: "authority-refresh",
      status: "launched",
      taskId: "S13-T03",
      workdir: "/worktree/s13-t03",
      runId: transition.sourceRunId,
    }),
    proofContent: proof,
    gateContent: gate,
    laneResultContent: laneResult,
    lensContents: lenses,
    expectedWorkdir: "/worktree/s13-t03",
    integratedTaskIds: ["S06-T02"],
    currentRejection: {
      transitionKind: "ownership-rehome" as const,
      taskId: "S13-T03",
      sourceRunId: transition.sourceRunId,
      workdir: "/worktree/s13-t03",
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
    readWorktree: () => ({ headSha: sourceHeadSha, treeSha: sourceTreeSha }),
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
        readWorktree: () => ({ headSha: sha("9"), treeSha: sha("3") }),
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
