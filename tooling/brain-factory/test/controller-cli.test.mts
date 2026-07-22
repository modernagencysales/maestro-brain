import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  acquireControllerLock,
  installControllerSignalHandlers,
  parseControllerCliArgs,
  runControllerCli,
  type ControllerCliRuntime,
} from "../src/controller.mjs";
import type { ControllerActionReceipt } from "../src/controller.js";
import { observeControllerSnapshot } from "../src/controller-observation.js";
import { normalizeControllerSnapshot } from "../src/factory-state.js";
import { buildManifest } from "../src/manifest.js";

const manifest = buildManifest();
const stateRoot = "/tmp/maestro-controller-state";
const snapshot = normalizeControllerSnapshot({
  controlHeadSha: "a".repeat(40),
  gateQueue: { capacity: 2, inUse: 0, waiting: 0 },
  manifestSha256: "b".repeat(64),
  planSha256: manifest.planSha256,
  providerErrors: [],
  tasks: [],
  waves: [],
});

describe("controller CLI contract", () => {
  it("maps terminal Fabro state authoritatively and fails inspection closed", () => {
    const root = mkdtempSync(join(tmpdir(), "brain-controller-observe-"));
    const runs = join(root, "runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(
      join(runs, "S00-T02.json"),
      `${JSON.stringify({
        baseSha: "a".repeat(40),
        branch: "fabro/brain-s00-t02",
        runId: "run-task",
        status: "launched",
        taskId: "S00-T02",
        workdir: "/tmp/s00-t02",
      })}\n`,
    );
    const invalidLaneDirectory = join(
      root,
      "evidence",
      "lane-results",
      "S01-T01",
    );
    mkdirSync(invalidLaneDirectory, { recursive: true });
    writeFileSync(
      join(invalidLaneDirectory, "lane-result.json"),
      `${JSON.stringify({
        headSha: "b".repeat(40),
        status: "lane_green",
        taskId: "S01-T01",
      })}\n`,
    );
    const observed = observeControllerSnapshot({
      controlHeadSha: "a".repeat(40),
      controlRoot: process.cwd(),
      inspect: () => "succeeded",
      manifest,
      stateRoot: root,
    });
    expect(
      observed.tasks.find(({ taskId }) => taskId === "S00-T02")?.stage,
    ).toBe("terminal");
    expect(
      observed.tasks.find(({ taskId }) => taskId === "S01-T01")?.stage,
    ).toBe("false_green");

    const unavailable = observeControllerSnapshot({
      controlHeadSha: "a".repeat(40),
      controlRoot: process.cwd(),
      inspect: () => {
        throw new Error("provider payload secret");
      },
      manifest,
      stateRoot: root,
    });
    expect(
      unavailable.tasks.find(({ taskId }) => taskId === "S00-T02")?.stage,
    ).toBe("unknown");
    expect(unavailable.providerErrors).toEqual([
      { category: "unavailable", provider: "fabro" },
    ]);
    expect(JSON.stringify(unavailable)).not.toContain(
      "provider payload secret",
    );
    rmSync(root, { force: true, recursive: true });
  });

  it("re-observes after archive and dispatches in the same once run", async () => {
    let state = 0;
    const observations = [
      normalizeControllerSnapshot({
        ...snapshot,
        tasks: [
          { runId: "terminal-run", status: "terminal", taskId: "S01-T02" },
        ],
      }),
      normalizeControllerSnapshot({
        ...snapshot,
        tasks: [
          { status: "accepted", taskId: "S00-T01" },
          { status: "pending", taskId: "S00-T02" },
        ],
      }),
      normalizeControllerSnapshot({
        ...snapshot,
        tasks: [
          { status: "accepted", taskId: "S00-T01" },
          { status: "running", taskId: "S00-T02" },
        ],
      }),
    ];
    const runtime: ControllerCliRuntime = {
      acquireLock: () => () => undefined,
      appendTelemetry: () => undefined,
      execute: ({ action, tickId }) => {
        state += 1;
        return {
          actionId: action.actionId,
          kind: action.kind,
          schemaVersion: "maestro-brain-controller-action-receipt/v1",
          status: "succeeded",
          tickId,
        };
      },
      manifest: () => manifest,
      now: () => "2026-07-18T00:00:00.000Z",
      observe: () => {
        const observed = observations[Math.min(state, 2)];
        if (!observed)
          throw new Error("missing controller observation fixture");
        return observed;
      },
      sleep: async () => false,
    };
    const output = await runControllerCli(
      parseControllerCliArgs(["--once", "--state", stateRoot]),
      runtime,
    );
    expect(output.map((line) => JSON.parse(line).kind)).toEqual([
      "archive_terminal",
      "dispatch_tasks",
    ]);
  });

  it("strictly parses once/watch, policy, interval, and recovery flags", () => {
    expect(
      parseControllerCliArgs(["--once", "--dry-run", "--state", stateRoot]),
    ).toMatchObject({ dryRun: true, mode: "once", stateRoot });
    expect(
      parseControllerCliArgs([
        "--watch",
        "--interval-ms",
        "1000",
        "--state",
        stateRoot,
        "--max-active",
        "4",
        "--batch-max",
        "3",
        "--batch-min",
        "2",
      ]),
    ).toMatchObject({
      intervalMs: 1000,
      mode: "watch",
      policy: {
        maximumBatchSize: 3,
        minimumBatchSize: 2,
        totalActiveCapacity: 4,
      },
    });
    expect(
      parseControllerCliArgs([
        "--",
        "--once",
        "--dry-run",
        "--state",
        ".fabro/state/maestro-brain",
      ]).stateRoot,
    ).toBe(resolve(".fabro/state/maestro-brain"));
    for (const args of [
      ["--once", "--watch", "--state", stateRoot],
      ["--once", "--interval-ms", "1000", "--state", stateRoot],
      ["--watch", "--interval-ms", "999", "--state", stateRoot],
      ["--watch", "--interval-ms", "3600001", "--state", stateRoot],
      ["--watch", "--dry-run", "--interval-ms", "1000", "--state", stateRoot],
      ["--once", "--state", stateRoot, "--unknown"],
      ["--once", "--state", stateRoot, "--recover-controller-lock"],
      [
        "--once",
        "--dry-run",
        "--state",
        stateRoot,
        "--recover-controller-lock",
        "--recovery-reason",
        "stale owner",
      ],
    ]) {
      expect(() => parseControllerCliArgs(args)).toThrow();
    }
  });

  it("produces byte-identical dry-runs without locks, telemetry, or writes", async () => {
    let mutations = 0;
    const runtime: ControllerCliRuntime = {
      acquireLock: () => {
        mutations += 1;
        return () => undefined;
      },
      appendTelemetry: () => {
        mutations += 1;
      },
      execute: () => {
        mutations += 1;
        throw new Error("dry-run executed an action");
      },
      manifest: () => manifest,
      now: () => "2026-07-18T00:00:00.000Z",
      observe: () =>
        normalizeControllerSnapshot({
          ...snapshot,
          tasks: [
            { status: "accepted", taskId: "S00-T01" },
            { status: "pending", taskId: "S00-T02" },
          ],
        }),
      sleep: async () => false,
    };
    const options = parseControllerCliArgs([
      "--once",
      "--dry-run",
      "--state",
      stateRoot,
    ]);
    const first = await runControllerCli(options, runtime);
    const second = await runControllerCli(options, runtime);
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatch(
      /^\{"actions":.+"schemaVersion":"maestro-brain-controller-dry-run\/v1"/,
    );
    expect(first[0]).not.toContain("2026-07-18");
    expect(mutations).toBe(0);
  });

  it("holds one watch lock, never overlaps ticks, and appends redacted telemetry", async () => {
    let locked = false;
    let active = 0;
    let maximumActive = 0;
    let executions = 0;
    let sleeps = 0;
    const telemetry: unknown[] = [];
    const runtime: ControllerCliRuntime = {
      acquireLock: () => {
        expect(locked).toBe(false);
        locked = true;
        return () => {
          locked = false;
        };
      },
      appendTelemetry: (value) => telemetry.push(value),
      execute: async ({ action, tickId }) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        executions += 1;
        await Promise.resolve();
        active -= 1;
        return {
          actionId: action.actionId,
          kind: action.kind,
          schemaVersion: "maestro-brain-controller-action-receipt/v1",
          status: "succeeded",
          tickId,
        } satisfies ControllerActionReceipt;
      },
      manifest: () => manifest,
      now: () => "2026-07-18T00:00:00.000Z",
      observe: () =>
        normalizeControllerSnapshot({
          ...snapshot,
          tasks: [
            { status: "accepted", taskId: "S00-T01" },
            { status: "pending", taskId: "S00-T02" },
          ],
        }),
      sleep: async () => {
        sleeps += 1;
        return sleeps < 2;
      },
    };
    const output = await runControllerCli(
      parseControllerCliArgs([
        "--watch",
        "--interval-ms",
        "1000",
        "--state",
        stateRoot,
      ]),
      runtime,
    );
    expect(executions).toBe(2);
    expect(maximumActive).toBe(1);
    expect(output).toHaveLength(2);
    expect(telemetry).toHaveLength(2);
    expect(JSON.stringify(telemetry)).not.toContain("payload");
    expect(locked).toBe(false);
  });

  it("requires explicit audited controller-lock recovery", () => {
    const root = mkdtempSync(join(tmpdir(), "brain-controller-cli-lock-"));
    const lockPath = join(root, "controller", "controller.lock");
    const auditPath = join(root, "controller", "lock-recovery.jsonl");
    const release = acquireControllerLock({
      auditPath,
      lockPath,
      now: "2026-07-18T00:00:00.000Z",
      owner: { action: "test-owner", pid: 1 },
    });
    expect(() =>
      acquireControllerLock({
        auditPath,
        lockPath,
        now: "2026-07-18T00:01:00.000Z",
        owner: { action: "second-owner", pid: 2 },
      }),
    ).toThrow("explicit audited recovery");
    const releaseRecovered = acquireControllerLock({
      auditPath,
      lockPath,
      now: "2026-07-18T00:02:00.000Z",
      owner: { action: "recovered-owner", pid: 3 },
      recoveryReason: "operator confirmed the prior process exited",
    });
    expect(readFileSync(auditPath, "utf8")).toContain("test-owner");
    releaseRecovered();
    release();
    expect(existsSync(lockPath)).toBe(false);
    rmSync(root, { force: true, recursive: true });
  });

  it("registers the checked package command", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "../../package.json"), "utf8"),
    ) as { readonly scripts?: Record<string, string> };
    expect(packageJson.scripts?.["brain:factory:control"]).toBe(
      "tsx tooling/brain-factory/src/controller.mts",
    );
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "%s stops watch mode and removes its handler",
    (signal) => {
      let stopped = 0;
      const before = process.listenerCount(signal);
      const dispose = installControllerSignalHandlers(() => {
        stopped += 1;
      });
      expect(process.listenerCount(signal)).toBe(before + 1);
      process.emit(signal);
      expect(stopped).toBe(1);
      dispose();
      expect(process.listenerCount(signal)).toBe(before);
    },
  );
});
