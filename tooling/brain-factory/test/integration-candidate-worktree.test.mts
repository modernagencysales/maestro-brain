import { describe, expect, it } from "vitest";

import {
  durableTaskWorkdir,
  durableTaskWorktreeMatchesEvidence,
} from "../src/integration-candidate-worktree.js";

const HEAD = "a".repeat(40);

describe("integration candidate durable worktree guard", () => {
  it("accepts absent durable worktrees and clean matching worktrees", () => {
    expect(
      durableTaskWorktreeMatchesEvidence({
        evidenceHeadSha: HEAD,
        taskId: "S04-T01",
      }),
    ).toBe(true);
    expect(
      durableTaskWorktreeMatchesEvidence({
        evidenceHeadSha: HEAD,
        probe: () => ({ exists: false }),
        taskId: "S04-T01",
        workdir: "/tmp/s04-t01",
      }),
    ).toBe(true);
    expect(
      durableTaskWorktreeMatchesEvidence({
        evidenceHeadSha: HEAD,
        probe: () => ({ exists: true, headSha: HEAD, porcelain: "" }),
        taskId: "S04-T01",
        workdir: "/tmp/s04-t01",
      }),
    ).toBe(true);
  });

  it("rejects a dirty worktree even when its HEAD still matches evidence", () => {
    for (const porcelain of [
      " M packages/convex/confect/http.ts",
      "M  packages/convex/confect/http.ts",
      "?? repair-output.json",
    ]) {
      expect(
        durableTaskWorktreeMatchesEvidence({
          evidenceHeadSha: HEAD,
          probe: () => ({ exists: true, headSha: HEAD, porcelain }),
          taskId: "S04-T01",
          workdir: "/tmp/s04-t01",
        }),
      ).toBe(false);
    }
  });

  it("rejects clean stale or unreadable worktrees", () => {
    expect(
      durableTaskWorktreeMatchesEvidence({
        evidenceHeadSha: HEAD,
        probe: () => ({
          exists: true,
          headSha: "b".repeat(40),
          porcelain: "",
        }),
        taskId: "S04-T01",
        workdir: "/tmp/s04-t01",
      }),
    ).toBe(false);
    expect(
      durableTaskWorktreeMatchesEvidence({
        evidenceHeadSha: HEAD,
        probe: () => ({ exists: true }),
        taskId: "S04-T01",
        workdir: "/tmp/s04-t01",
      }),
    ).toBe(false);
  });

  it("binds the guard to the task's recorded durable workdir", () => {
    expect(
      durableTaskWorkdir(
        {
          taskId: "S04-T01",
          workdir: "/tmp/s04-t01",
        },
        "S04-T01",
      ),
    ).toBe("/tmp/s04-t01");
    expect(() =>
      durableTaskWorkdir(
        {
          taskId: "S04-T02",
          workdir: "/tmp/s04-t01",
        },
        "S04-T01",
      ),
    ).toThrow("reservation task identity mismatch");
    expect(() =>
      durableTaskWorkdir(
        {
          taskId: "S04-T01",
          workdir: "relative/s04-t01",
        },
        "S04-T01",
      ),
    ).toThrow("must be absolute");
  });

  it("rechecks selected worktrees before durable wave reservation", async () => {
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(
        new URL("../src/integrate-wave.mts", import.meta.url),
        "utf8",
      ),
    );
    const firstGuard = source.indexOf("!durableTaskWorktreeMatchesEvidence({");
    const selection = source.indexOf("const selection = planIntegrationWave({");
    const secondGuard = source.indexOf(
      "!durableTaskWorktreeMatchesEvidence({",
      firstGuard + 1,
    );
    const reservationWrite = source.indexOf("writeFileSync(recordPath");

    expect(firstGuard).toBeGreaterThan(-1);
    expect(firstGuard).toBeLessThan(selection);
    expect(secondGuard).toBeGreaterThan(selection);
    expect(secondGuard).toBeLessThan(reservationWrite);
  });
});
