import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { releaseReviewAggregationSocketLease } from "../src/review-aggregation-lease.js";
import {
  beginReviewAggregation,
  cleanupReviewWorktrees,
  prepareReviewWorktrees,
  reviewWorktreePath,
} from "../src/review-worktrees.js";

const roots: string[] = [];

const git = (directory: string, ...args: string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: directory,
    encoding: "utf8",
  }).trim();

const gitWithInput = (
  directory: string,
  args: readonly string[],
  input: string,
): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: directory,
    encoding: "utf8",
    input,
  }).trim();

const copyReceiptForAttempt = (
  root: string,
  sourceRef: string,
  targetRef: string,
  attemptId: string,
): void => {
  const sourceObject = git(root, "rev-parse", sourceRef);
  const metadata = JSON.parse(
    git(root, "cat-file", "blob", sourceObject),
  ) as Record<string, unknown>;
  const targetObject = gitWithInput(
    root,
    ["hash-object", "-w", "--stdin"],
    JSON.stringify({ ...metadata, attemptId }),
  );
  git(root, "update-ref", targetRef, targetObject);
};

const rewriteReceipt = (
  root: string,
  ref: string,
  rewrite: (metadata: Record<string, unknown>) => Record<string, unknown>,
): void => {
  const sourceObject = git(root, "rev-parse", ref);
  const metadata = JSON.parse(
    git(root, "cat-file", "blob", sourceObject),
  ) as Record<string, unknown>;
  const targetObject = gitWithInput(
    root,
    ["hash-object", "-w", "--stdin"],
    JSON.stringify(rewrite(metadata)),
  );
  git(root, "update-ref", ref, targetObject);
};

const fixture = () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "brain-review-worktrees-"));
  roots.push(fixtureRoot);
  const root = resolve(fixtureRoot, "product");
  const evidence = resolve(fixtureRoot, "evidence");
  const lane = resolve(evidence, "lane-results", "S03-T03");
  mkdirSync(root);
  mkdirSync(lane, { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "core.hooksPath", "/dev/null");
  git(root, "config", "user.email", "review-worktrees@example.test");
  git(root, "config", "user.name", "Review Worktrees Test");
  writeFileSync(resolve(root, "tracked.txt"), "seed\n");
  writeFileSync(resolve(root, ".gitignore"), ".tokensave/\n");
  git(root, "add", "tracked.txt", ".gitignore");
  git(root, "commit", "-qm", "test: seed managed review worktrees");
  const headSha = git(root, "rev-parse", "HEAD");
  writeFileSync(
    resolve(lane, "ci-proof-packet.json"),
    `${JSON.stringify({
      taskId: "S03-T03",
      headSha,
      planSha256: "plan-sha-256",
      taskBlockHash: "task-block-hash",
    })}\n`,
  );
  return {
    input: {
      workdir: root,
      evidence,
      taskId: "S03-T03",
      headSha,
      attemptId: "attempt-01",
    },
    root,
  };
};

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("managed review worktrees", () => {
  it("prepares exactly three deterministic branch-local worktrees at HEAD", () => {
    const { input, root } = fixture();
    const prepared = prepareReviewWorktrees(input);

    expect(Object.keys(prepared.paths)).toEqual([
      "contract",
      "safety",
      "quality",
    ]);
    for (const lens of ["contract", "safety", "quality"] as const) {
      const path = reviewWorktreePath({ ...input, lens });
      expect(path).toBe(prepared.paths[lens]);
      expect(path.startsWith(`${prepared.root}/`)).toBe(true);
      expect(git(path, "rev-parse", "HEAD")).toBe(input.headSha);
      expect(git(path, "branch", "--show-current")).toBe(
        `maestro/review/${input.taskId}/${input.headSha}/${prepared.attemptId}/${lens}`,
      );
    }
    expect(
      git(
        root,
        "for-each-ref",
        "--format=%(refname)",
        "refs/heads/maestro/review/",
      )
        .split("\n")
        .filter(Boolean),
    ).toHaveLength(3);
  });

  it("rejects dirty input and stale branch or directory collisions", () => {
    const dirty = fixture();
    writeFileSync(resolve(dirty.root, "dirty.txt"), "dirty\n");
    expect(() => prepareReviewWorktrees(dirty.input)).toThrow(
      "product worktree is not clean",
    );

    const stale = fixture();
    const prepared = prepareReviewWorktrees(stale.input);
    cleanupReviewWorktrees(stale.input);
    expect(existsSync(prepared.root)).toBe(false);
    const retried = prepareReviewWorktrees(stale.input);
    expect(retried.attemptId).toBe(`${stale.input.attemptId}-v2`);
    cleanupReviewWorktrees(stale.input);
  });

  it("removes all three worktrees but retains forensic branch refs", () => {
    const { input, root } = fixture();
    const prepared = prepareReviewWorktrees(input);
    cleanupReviewWorktrees(input);

    expect(existsSync(prepared.root)).toBe(false);
    for (const lens of ["contract", "safety", "quality"] as const) {
      expect(existsSync(prepared.paths[lens])).toBe(false);
      expect(
        git(
          root,
          "rev-parse",
          `refs/heads/maestro/review/${input.taskId}/${input.headSha}/${prepared.attemptId}/${lens}`,
        ),
      ).toBe(input.headSha);
    }
    expect(() => cleanupReviewWorktrees(input)).not.toThrow();
  });

  it("rejects invalid coordinates and symlinked managed paths", () => {
    const invalid = fixture();
    expect(() =>
      prepareReviewWorktrees({ ...invalid.input, taskId: "../escape" }),
    ).toThrow("invalid review task");
    expect(() =>
      prepareReviewWorktrees({ ...invalid.input, headSha: "HEAD" }),
    ).toThrow("invalid review head");
    expect(() =>
      prepareReviewWorktrees({ ...invalid.input, attemptId: "../escape" }),
    ).toThrow("invalid review attempt");
    expect(() =>
      reviewWorktreePath({ ...invalid.input, lens: "escape" as "contract" }),
    ).toThrow("invalid review lens");

    const linked = fixture();
    const link = resolve(linked.root, "workdir-link");
    symlinkSync(linked.root, link, "dir");
    expect(() =>
      prepareReviewWorktrees({ ...linked.input, workdir: link }),
    ).toThrow("product workdir must not contain symlinks");

    const managed = fixture();
    const prepared = prepareReviewWorktrees(managed.input);
    git(managed.root, "worktree", "remove", prepared.paths.contract);
    symlinkSync(prepared.paths.safety, prepared.paths.contract, "dir");
    expect(() => cleanupReviewWorktrees(managed.input)).toThrow(
      "managed review path must not contain symlinks",
    );
    expect(existsSync(prepared.paths.safety)).toBe(true);
    expect(existsSync(prepared.paths.quality)).toBe(true);
  });

  it("atomically binds the namespace to task proof and immutable evidence", () => {
    const { input, root } = fixture();
    const prepared = prepareReviewWorktrees(input);
    expect(prepared.attemptId).toBe(`${input.attemptId}-v1`);
    expect(prepared.metadata).toMatchObject({
      status: "prepared",
      taskId: input.taskId,
      headSha: input.headSha,
      treeSha: git(root, "rev-parse", "HEAD^{tree}"),
      planSha256: "plan-sha-256",
      taskBlockHash: "task-block-hash",
    });
    expect(prepared.metadata.proofSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.metadata.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.namespaceRef).toContain("/active");
    expect(prepared.receiptRef).toContain(prepared.attemptId);

    expect(() => prepareReviewWorktrees(input)).toThrow(
      "review namespace is already claimed",
    );
  });

  it("serializes attempts for one task head and releases only after cleanup", () => {
    const { input } = fixture();
    prepareReviewWorktrees(input);
    const next = { ...input, attemptId: "attempt-02" };
    expect(() => prepareReviewWorktrees(next)).toThrow(
      "review namespace is already claimed",
    );
    cleanupReviewWorktrees(input);
    expect(() => prepareReviewWorktrees(next)).not.toThrow();
    cleanupReviewWorktrees(next);
  });

  it("allocates visits by numeric maximum across gaps and v10", () => {
    const { input, root } = fixture();
    const receipts: string[] = [];
    for (let visit = 1; visit <= 10; visit += 1) {
      const prepared = prepareReviewWorktrees(input);
      expect(prepared.attemptId).toBe(`${input.attemptId}-v${visit}`);
      receipts.push(prepared.receiptRef);
      cleanupReviewWorktrees(input);
    }
    for (const visit of [2, 4, 7])
      git(root, "update-ref", "-d", receipts[visit - 1]!);
    const next = prepareReviewWorktrees(input);
    expect(next.attemptId).toBe(`${input.attemptId}-v11`);
    cleanupReviewWorktrees(input);
  }, 20_000);

  it("rejects a prior receipt with stale attempt-derived layout metadata", () => {
    const { input, root } = fixture();
    const first = prepareReviewWorktrees(input);
    cleanupReviewWorktrees(input);
    copyReceiptForAttempt(
      root,
      first.receiptRef,
      first.receiptRef.replace(/-v1$/, "-v3"),
      `${input.attemptId}-v3`,
    );
    expect(() => prepareReviewWorktrees(input)).toThrow(
      "invalid managed review attempt receipt",
    );
  });

  it("rejects unsafe and malformed visit refs without matching cross-attempt refs", () => {
    const malformed = fixture();
    const baseInput = { ...malformed.input, attemptId: "foo" };
    prepareReviewWorktrees(baseInput);
    cleanupReviewWorktrees(baseInput);
    const siblingInput = { ...baseInput, attemptId: "foo-victim" };
    prepareReviewWorktrees(siblingInput);
    cleanupReviewWorktrees(siblingInput);
    const second = prepareReviewWorktrees(baseInput);
    expect(second.attemptId).toBe("foo-v2");
    cleanupReviewWorktrees(baseInput);
    copyReceiptForAttempt(
      malformed.root,
      second.receiptRef,
      second.receiptRef.replace(/-v2$/, "-v02"),
      "foo-v02",
    );
    expect(() => prepareReviewWorktrees(baseInput)).toThrow(
      "invalid review visit ref",
    );

    const unsafe = fixture();
    const unsafeFirst = prepareReviewWorktrees(unsafe.input);
    cleanupReviewWorktrees(unsafe.input);
    copyReceiptForAttempt(
      unsafe.root,
      unsafeFirst.receiptRef,
      unsafeFirst.receiptRef.replace(/-v1$/, "-v9007199254740992"),
      `${unsafe.input.attemptId}-v9007199254740992`,
    );
    expect(() => prepareReviewWorktrees(unsafe.input)).toThrow(
      "unsafe review visit ref",
    );
  });

  it("recovers a missing active lock from the latest non-terminal receipt", () => {
    const { input, root } = fixture();
    const prepared = prepareReviewWorktrees(input);
    const receiptObject = git(root, "rev-parse", prepared.receiptRef);
    git(root, "update-ref", "-d", prepared.namespaceRef);

    expect(() => prepareReviewWorktrees(input)).toThrow(
      "review namespace is already claimed",
    );
    expect(git(root, "rev-parse", prepared.namespaceRef)).toBe(receiptObject);
    expect(() => cleanupReviewWorktrees(input)).not.toThrow();
  });

  it("does not steal a live aggregation lease after all artifacts appear", async () => {
    const { input } = fixture();
    prepareReviewWorktrees(input);
    const lease = await beginReviewAggregation(input);
    const reviewDirectory = resolve(
      input.evidence,
      "lane-results",
      input.taskId,
      "review-lenses",
      input.headSha,
    );
    mkdirSync(reviewDirectory, { recursive: true });
    for (const lens of ["contract", "safety", "quality"])
      writeFileSync(resolve(reviewDirectory, `${lens}.json`), "{}\n");

    await expect(beginReviewAggregation(input)).rejects.toThrow(
      "review aggregation is already aggregating",
    );
    await releaseReviewAggregationSocketLease(lease.token);
    cleanupReviewWorktrees(input);
  });

  it("rejects malformed bound results in forensic cleaned receipts", () => {
    const { input, root } = fixture();
    const prepared = prepareReviewWorktrees(input);
    cleanupReviewWorktrees(input);
    rewriteReceipt(root, prepared.receiptRef, (metadata) => ({
      ...metadata,
      leaseToken: "00000000-0000-4000-8000-000000000000",
      leaseAuthority: "127.0.0.1:54321",
      phase: "promoted",
      result: {},
    }));
    expect(() => cleanupReviewWorktrees(input)).toThrow(
      "invalid managed review attempt receipt",
    );
  });

  it("rejects a promoted forensic receipt with a false final proof digest", () => {
    const { input, root } = fixture();
    const prepared = prepareReviewWorktrees(input);
    cleanupReviewWorktrees(input);
    const lensRecord = {
      contract: "a".repeat(64),
      safety: "b".repeat(64),
      quality: "c".repeat(64),
    };
    rewriteReceipt(root, prepared.receiptRef, (metadata) => ({
      ...metadata,
      leaseAuthority: "127.0.0.1:54321",
      leaseToken: "00000000-0000-4000-8000-000000000000",
      phase: "promoted",
      result: {
        artifactSha256: lensRecord,
        commits: lensRecord,
        expectedProofSha256: "d".repeat(64),
        outcome: "promoted",
        preProofSha256: "e".repeat(64),
        promotionCoreSha256: "f".repeat(64),
        proofSha256: "0".repeat(64),
        reviewerRunIds: {
          contract: "contract-run",
          safety: "safety-run",
          quality: "quality-run",
        },
        reviewVerdict: "pass",
      },
    }));
    expect(() => cleanupReviewWorktrees(input)).toThrow(
      "invalid managed review attempt receipt",
    );
  });
});
