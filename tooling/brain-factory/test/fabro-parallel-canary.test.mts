import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { collectParallelReviewLenses } from "../src/review-aggregate.mjs";
import {
  cleanupReviewWorktrees,
  prepareReviewWorktrees,
  reviewWorktreeRoot,
} from "../src/review-worktrees.js";

const git = (repo: string, ...args: string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: repo,
    encoding: "utf8",
  }).trim();

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const script = (value: string): string =>
  JSON.stringify(`set -euo pipefail; ${value}`);
const tsxImport = createRequire(import.meta.url).resolve("tsx");

describe("Fabro production parallel review path", () => {
  it("guards three branch artifacts and aggregates their checkpoint refs once", () => {
    const container = mkdtempSync(resolve(tmpdir(), "brain-fabro-production-"));
    const root = resolve(container, "review-repo");
    const evidence = resolve(container, "evidence with spaces;safe");
    const taskId = "S03-T03";
    const lane = resolve(evidence, "lane-results", taskId);
    mkdirSync(root, { recursive: true });
    mkdirSync(lane, { recursive: true });

    writeFileSync(resolve(root, "README.md"), "production-path canary\n");
    writeFileSync(
      resolve(root, "write-review-lens.mjs"),
      `import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const lens = process.argv[2];
const rubricIds = {
  contract: ["contract.task-packet", "contract.typed-api", "contract.schema", "contract.plan", "contract.ownership", "contract.failure-contract"],
  safety: ["safety.tenancy", "safety.authorization", "safety.lifecycle", "safety.privacy", "safety.concurrency", "safety.replay", "safety.fencing", "safety.provider-boundaries"],
  quality: ["quality.test-adequacy", "quality.layer-law", "quality.maintainability", "quality.observability", "quality.budgets", "quality.generated-file-discipline"],
};
if (!Object.hasOwn(rubricIds, lens)) throw new Error("unknown lens");
const git = (cwd, ...args) => execFileSync("rtk", ["proxy", "git", ...args], { cwd, encoding: "utf8" }).trim();
const proof = JSON.parse(readFileSync(resolve(process.env.BRAIN_EVIDENCE_DIR, "lane-results", process.env.BRAIN_TASK_ID, "ci-proof-packet.json"), "utf8"));
const reviewerRunId = git(process.cwd(), "branch", "--show-current");
const artifact = {
  lens,
  taskId: process.env.BRAIN_TASK_ID,
  planSha256: proof.planSha256,
  taskBlockHash: proof.taskBlockHash,
  baseSha: proof.baseSha,
  headSha: git(process.env.BRAIN_WORKDIR, "rev-parse", "HEAD"),
  treeSha: git(process.env.BRAIN_WORKDIR, "rev-parse", "HEAD^{tree}"),
  reviewerRunId,
  rubricDispositions: rubricIds[lens].map((rubricId) => ({ rubricId, disposition: "pass", evidence: [\`canary:\${lens}:\${rubricId}\`] })),
  findings: [],
  verdict: "pass",
};
const output = resolve(process.cwd(), ".brain-review-output");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, \`\${lens}.json\`), \`\${JSON.stringify(artifact, null, 2)}\\n\`);
`,
    );

    writeFileSync(
      resolve(root, "workflow.fabro"),
      `digraph ProductionCanary {
  graph [goal="production parallel review canary"]
  start [shape=Mdiamond]
  exit [shape=Msquare]
  snapshot [shape=parallelogram, script=${script('rtk proxy node --import "$TSX_IMPORT" "$CANARY_WORKTREE_GUARD" capture --workdir "$BRAIN_WORKDIR" --task "$BRAIN_TASK_ID" --evidence "$BRAIN_EVIDENCE_DIR"; REVIEW_HEAD=$(rtk proxy git -C "$BRAIN_WORKDIR" rev-parse HEAD); rtk proxy node --import "$TSX_IMPORT" "$CANARY_REVIEW_WORKTREES" prepare --workdir "$BRAIN_WORKDIR" --evidence "$BRAIN_EVIDENCE_DIR" --task "$BRAIN_TASK_ID" --head "$REVIEW_HEAD" --attempt "$BRAIN_REVIEW_ATTEMPT"')}]
  review_fork [shape=component, join_policy="wait_all", max_parallel=3]
  review_contract [shape=parallelogram, script=${script('REVIEW_HEAD=$(rtk proxy git -C "$BRAIN_WORKDIR" rev-parse HEAD); REVIEW_WORKTREE=$(rtk proxy node --import "$TSX_IMPORT" "$CANARY_REVIEW_WORKTREES" path --workdir "$BRAIN_WORKDIR" --evidence "$BRAIN_EVIDENCE_DIR" --task "$BRAIN_TASK_ID" --head "$REVIEW_HEAD" --attempt "$BRAIN_REVIEW_ATTEMPT" --lens contract); cd "$REVIEW_WORKTREE"; rtk proxy node "$CANARY_WRITER" contract; rtk proxy node --import "$TSX_IMPORT" "$CANARY_LENS_GUARD" --lens contract')}]
  review_safety [shape=parallelogram, script=${script('REVIEW_HEAD=$(rtk proxy git -C "$BRAIN_WORKDIR" rev-parse HEAD); REVIEW_WORKTREE=$(rtk proxy node --import "$TSX_IMPORT" "$CANARY_REVIEW_WORKTREES" path --workdir "$BRAIN_WORKDIR" --evidence "$BRAIN_EVIDENCE_DIR" --task "$BRAIN_TASK_ID" --head "$REVIEW_HEAD" --attempt "$BRAIN_REVIEW_ATTEMPT" --lens safety); cd "$REVIEW_WORKTREE"; rtk proxy node "$CANARY_WRITER" safety; rtk proxy node --import "$TSX_IMPORT" "$CANARY_LENS_GUARD" --lens safety')}]
  review_quality [shape=parallelogram, script=${script('REVIEW_HEAD=$(rtk proxy git -C "$BRAIN_WORKDIR" rev-parse HEAD); REVIEW_WORKTREE=$(rtk proxy node --import "$TSX_IMPORT" "$CANARY_REVIEW_WORKTREES" path --workdir "$BRAIN_WORKDIR" --evidence "$BRAIN_EVIDENCE_DIR" --task "$BRAIN_TASK_ID" --head "$REVIEW_HEAD" --attempt "$BRAIN_REVIEW_ATTEMPT" --lens quality); cd "$REVIEW_WORKTREE"; rtk proxy node "$CANARY_WRITER" quality; rtk proxy node --import "$TSX_IMPORT" "$CANARY_LENS_GUARD" --lens quality')}]
  review_merge [shape=tripleoctagon]
  review_aggregate [shape=parallelogram, script=${script('cd "$BRAIN_WORKDIR"; set +e; BRAIN_REVIEW_TEST_CRASH_AFTER_ARTIFACTS=1 rtk proxy node --import "$TSX_IMPORT" "$CANARY_AGGREGATE" --task "$BRAIN_TASK_ID" --attempt "$BRAIN_REVIEW_ATTEMPT" --workdir "$BRAIN_WORKDIR" --review-repo "$BRAIN_WORKDIR" --evidence "$BRAIN_EVIDENCE_DIR" >"$CANARY_DIR/crash-1.log" 2>&1; S1=$?; set -e; rtk proxy test "$S1" -ne 0; rtk proxy grep -q "after 1 artifacts" "$CANARY_DIR/crash-1.log"; set +e; BRAIN_REVIEW_TEST_CRASH_AFTER_ARTIFACTS=2 rtk proxy node --import "$TSX_IMPORT" "$CANARY_AGGREGATE" --task "$BRAIN_TASK_ID" --attempt "$BRAIN_REVIEW_ATTEMPT" --workdir "$BRAIN_WORKDIR" --review-repo "$BRAIN_WORKDIR" --evidence "$BRAIN_EVIDENCE_DIR" >"$CANARY_DIR/crash-2.log" 2>&1; S2=$?; set -e; rtk proxy test "$S2" -ne 0; rtk proxy grep -q "after 2 artifacts" "$CANARY_DIR/crash-2.log"; PAUSE="$CANARY_DIR/live-pause"; rtk proxy rm -f "$PAUSE.ready" "$PAUSE.release"; set +e; BRAIN_REVIEW_TEST_PAUSE_AFTER_ARTIFACTS="$PAUSE" BRAIN_REVIEW_TEST_CRASH_AFTER_ARTIFACTS=3 rtk proxy node --import "$TSX_IMPORT" "$CANARY_AGGREGATE" --task "$BRAIN_TASK_ID" --attempt "$BRAIN_REVIEW_ATTEMPT" --workdir "$BRAIN_WORKDIR" --review-repo "$BRAIN_WORKDIR" --evidence "$BRAIN_EVIDENCE_DIR" >"$CANARY_DIR/crash-3.log" 2>&1 & P0=$!; set -e; TRIES=0; until rtk proxy test -f "$PAUSE.ready"; do TRIES=$((TRIES + 1)); rtk proxy test "$TRIES" -lt 200; rtk sleep 0.05; done; set +e; rtk proxy node --import "$TSX_IMPORT" "$CANARY_AGGREGATE" --task "$BRAIN_TASK_ID" --attempt "$BRAIN_REVIEW_ATTEMPT" --workdir "$BRAIN_WORKDIR" --review-repo "$BRAIN_WORKDIR" --evidence "$BRAIN_EVIDENCE_DIR" >"$CANARY_DIR/live-duplicate.log" 2>&1; LIVE_STATUS=$?; set -e; rtk proxy test "$LIVE_STATUS" -ne 0; rtk proxy grep -q "already aggregating" "$CANARY_DIR/live-duplicate.log"; rtk proxy touch "$PAUSE.release"; set +e; wait "$P0"; S3=$?; set -e; rtk proxy test "$S3" -ne 0; rtk proxy grep -q "after 3 artifacts" "$CANARY_DIR/crash-3.log"; set +e; BRAIN_REVIEW_TEST_CRASH_AFTER_CLEANUP=1 rtk proxy node --import "$TSX_IMPORT" "$CANARY_AGGREGATE" --task "$BRAIN_TASK_ID" --attempt "$BRAIN_REVIEW_ATTEMPT" --workdir "$BRAIN_WORKDIR" --review-repo "$BRAIN_WORKDIR" --evidence "$BRAIN_EVIDENCE_DIR" >"$CANARY_DIR/cleanup-crash.log" 2>&1; CLEANUP_STATUS=$?; set -e; rtk proxy test "$CLEANUP_STATUS" -ne 0; rtk proxy grep -q "after cleanup" "$CANARY_DIR/cleanup-crash.log"; rtk proxy node --import "$TSX_IMPORT" "$CANARY_AGGREGATE" --task "$BRAIN_TASK_ID" --attempt "$BRAIN_REVIEW_ATTEMPT" --workdir "$BRAIN_WORKDIR" --review-repo "$BRAIN_WORKDIR" --evidence "$BRAIN_EVIDENCE_DIR" >"$CANARY_DIR/completed-retry.log" 2>&1; printf \'aggregate\\n\' >> "$CANARY_DIR/aggregate"')}]
  start -> snapshot -> review_fork
  review_fork -> review_contract
  review_fork -> review_safety
  review_fork -> review_quality
  review_contract -> review_merge
  review_safety -> review_merge
  review_quality -> review_merge
  review_merge -> review_aggregate -> exit
}\n`,
    );

    git(root, "init", "-q");
    git(root, "config", "core.hooksPath", "/dev/null");
    git(root, "config", "user.email", "canary@example.test");
    git(root, "config", "user.name", "Canary");
    git(root, "add", ".");
    git(root, "commit", "-qm", "seed");
    const seed = git(root, "rev-parse", "HEAD");
    const workdir = resolve(container, "product-worktree");
    git(root, "worktree", "add", "-q", "--detach", workdir, seed);
    const headSha = git(workdir, "rev-parse", "HEAD");
    const treeSha = git(workdir, "rev-parse", "HEAD^{tree}");
    writeFileSync(
      resolve(lane, "ci-proof-packet.json"),
      `${JSON.stringify({
        schemaVersion: "maestro-brain-ci-proof/v1",
        taskId,
        planSha256: "canary-plan",
        taskBlockHash: "canary-task-block",
        baseSha: "canary-base",
        headSha,
        reviewVerdict: "pending",
      })}\n`,
    );
    writeFileSync(
      resolve(root, "workflow.toml"),
      `_version = 1
[workflow]
graph = "workflow.fabro"
[environments.local.env]
BRAIN_WORKDIR = ${JSON.stringify(workdir)}
BRAIN_EVIDENCE_DIR = ${JSON.stringify(evidence)}
BRAIN_TASK_ID = ${JSON.stringify(taskId)}
BRAIN_REVIEW_ATTEMPT = "attempt-canary"
CANARY_DIR = ${JSON.stringify(evidence)}
CANARY_WRITER = ${JSON.stringify(resolve(root, "write-review-lens.mjs"))}
CANARY_LENS_GUARD = ${JSON.stringify(resolve(import.meta.dirname, "../src/review-lens-guard.mts"))}
CANARY_WORKTREE_GUARD = ${JSON.stringify(resolve(import.meta.dirname, "../src/review-worktree-guard.mts"))}
CANARY_REVIEW_WORKTREES = ${JSON.stringify(resolve(import.meta.dirname, "../src/review-worktrees.mts"))}
CANARY_AGGREGATE = ${JSON.stringify(resolve(import.meta.dirname, "../src/review-aggregate.mts"))}
TSX_IMPORT = ${JSON.stringify(tsxImport)}
`,
    );
    git(root, "add", "workflow.toml");
    git(root, "commit", "-qm", "configure canary");
    const origin = resolve(container, "origin.git");
    mkdirSync(origin);
    git(origin, "init", "--bare", "-q");
    git(root, "remote", "add", "origin", origin);
    git(root, "push", "-qu", "origin", "main");

    try {
      execFileSync(
        "rtk",
        [
          "proxy",
          "fabro",
          "run",
          resolve(root, "workflow.toml"),
          "--environment",
          "local",
          "--no-upgrade-check",
          "--quiet",
        ],
        { cwd: root, env: { ...process.env } },
      );

      const proof = readJson(resolve(lane, "ci-proof-packet.json"));
      expect(proof.reviewVerdict).toBe("pass");
      expect(proof.reviewFindings).toEqual([]);
      expect(readFileSync(resolve(evidence, "aggregate"), "utf8")).toBe(
        "aggregate\n",
      );
      for (const count of [1, 2, 3])
        expect(
          readFileSync(resolve(evidence, `crash-${count}.log`), "utf8"),
        ).toContain(`injected review promotion crash after ${count} artifacts`);
      expect(
        readFileSync(resolve(evidence, "live-duplicate.log"), "utf8"),
      ).toContain("already aggregating");
      expect(
        readFileSync(resolve(evidence, "cleanup-crash.log"), "utf8"),
      ).toContain("injected review promotion crash after cleanup");

      const reviewerRunIds: string[] = [];
      const artifactSha256: Record<string, string> = {};
      const commits: Record<string, string> = {};
      for (const lens of ["contract", "safety", "quality"] as const) {
        const artifactPath = resolve(
          lane,
          "review-lenses",
          headSha,
          `${lens}.json`,
        );
        const artifact = readJson(artifactPath);
        const reviewerRunId = artifact.reviewerRunId as string;
        reviewerRunIds.push(reviewerRunId);
        expect(artifact).toMatchObject({
          lens,
          taskId,
          headSha,
          treeSha,
          reviewerRunId,
          findings: [],
          verdict: "pass",
        });
        expect(reviewerRunId).toBe(
          `maestro/review/${taskId}/${headSha}/attempt-canary-v1/${lens}`,
        );
        artifactSha256[lens] = createHash("sha256")
          .update(readFileSync(artifactPath))
          .digest("hex");
        commits[lens] = git(workdir, "rev-parse", reviewerRunId);
      }
      expect(new Set(reviewerRunIds).size).toBe(3);
      expect(
        existsSync(
          reviewWorktreeRoot({
            attemptId: "attempt-canary",
            evidence,
            headSha,
            taskId,
            workdir,
          }),
        ),
      ).toBe(false);

      const receiptRef = git(
        workdir,
        "for-each-ref",
        "--format=%(refname)",
        "refs/maestro-brain/review-worktrees/",
      )
        .split("\n")
        .find((ref) => ref.endsWith("/attempts/attempt-canary-v1"));
      expect(receiptRef).toBeDefined();
      if (!receiptRef) throw new Error("canary review receipt ref is missing");
      const receipt = JSON.parse(
        git(workdir, "cat-file", "blob", receiptRef),
      ) as Record<string, unknown>;
      expect(receipt).toMatchObject({
        status: "cleaned",
        attemptId: "attempt-canary-v1",
        phase: "promoted",
      });
      expect(Object.keys(receipt).sort()).toEqual(
        [
          "attemptId",
          "evidenceSha256",
          "headSha",
          "leaseAuthority",
          "leaseToken",
          "phase",
          "planSha256",
          "preparedObject",
          "proofSha256",
          "requestedAttemptId",
          "result",
          "root",
          "status",
          "taskBlockHash",
          "taskId",
          "treeSha",
          "workdir",
        ].sort(),
      );
      expect(receipt.leaseAuthority).toMatch(/^127\.0\.0\.1:[1-9][0-9]{0,4}$/);
      expect(receipt.leaseToken).toEqual(expect.any(String));
      expect(receipt.preparedObject).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
      const finalProofSha256 = createHash("sha256")
        .update(readFileSync(resolve(lane, "ci-proof-packet.json")))
        .digest("hex");
      expect(receipt.result).toEqual({
        artifactSha256,
        commits,
        expectedProofSha256: finalProofSha256,
        outcome: "promoted",
        preProofSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        promotionCoreSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        proofSha256: finalProofSha256,
        reviewerRunIds: {
          contract: reviewerRunIds[0],
          safety: reviewerRunIds[1],
          quality: reviewerRunIds[2],
        },
        reviewVerdict: "pass",
      });

      const coordinates = {
        attemptId: "attempt-canary",
        evidence,
        headSha,
        taskId,
        workdir,
      };
      const second = prepareReviewWorktrees(coordinates);
      expect(second.attemptId).toBe("attempt-canary-v2");
      cleanupReviewWorktrees(coordinates);
      expect(() => cleanupReviewWorktrees(coordinates)).not.toThrow();
      expect(existsSync(second.root)).toBe(false);

      const forgedWorktree = resolve(container, "forged-contract");
      git(
        workdir,
        "worktree",
        "add",
        "-q",
        forgedWorktree,
        `maestro/review/${taskId}/${headSha}/attempt-canary-v1/contract`,
      );
      try {
        writeFileSync(
          resolve(forgedWorktree, ".brain-review-output/safety.json"),
          readFileSync(
            resolve(forgedWorktree, ".brain-review-output/contract.json"),
          ),
        );
        git(forgedWorktree, "add", ".brain-review-output/safety.json");
        git(forgedWorktree, "commit", "--amend", "--no-edit", "-q");
        expect(() =>
          collectParallelReviewLenses({
            attempt: "attempt-canary-v1",
            evidence,
            reviewRepo: workdir,
            taskId,
            workdir,
          }),
        ).toThrow("checkpoint delta");
      } finally {
        git(workdir, "worktree", "remove", "--force", forgedWorktree);
      }
    } finally {
      rmSync(container, { recursive: true, force: true });
    }
  }, 60_000);
});
