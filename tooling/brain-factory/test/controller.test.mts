import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  canonicalControllerJson,
  commandForControllerAction,
  executeControllerTick,
  planControllerTick,
  telemetryForControllerAction,
  tickIdForController,
  type ControllerAction,
  type ControllerPolicy,
} from "../src/controller.js";
import {
  normalizeControllerSnapshot,
  type ControllerSnapshot,
  type ControllerTaskObservation,
  type ControllerWaveObservation,
} from "../src/factory-state.js";

const git = "a".repeat(40);
const sha = "b".repeat(64);
const policy: ControllerPolicy = {
  maximumBatchSize: 4,
  minimumBatchSize: 1,
  totalActiveCapacity: 10,
};

const snapshot = (
  input: {
    readonly errors?: ControllerSnapshot["providerErrors"];
    readonly gate?: ControllerSnapshot["gateQueue"];
    readonly tasks?: readonly ControllerTaskObservation[];
    readonly waves?: readonly ControllerWaveObservation[];
  } = {},
): ControllerSnapshot =>
  normalizeControllerSnapshot({
    controlHeadSha: git,
    gateQueue: input.gate ?? { capacity: 2, inUse: 0, waiting: 0 },
    manifestSha256: sha,
    planSha256: "c".repeat(64),
    providerErrors: input.errors ?? [],
    tasks: input.tasks ?? [],
    waves: input.waves ?? [],
  });

const task = (
  taskId: string,
  status: ControllerTaskObservation["status"],
  extra: Partial<ControllerTaskObservation> = {},
): ControllerTaskObservation => ({ status, taskId, ...extra });

const wave = (
  integrationId: string,
  inspection: ControllerWaveObservation["inspection"],
): ControllerWaveObservation => ({
  headSha: "d".repeat(40),
  identity: "exact",
  inspection,
  integrationId,
  ownershipId: `owner-${integrationId}`,
  runId: `run-${integrationId}`,
});

const frontier = (): readonly ControllerTaskObservation[] => [
  task("S00-T01", "accepted"),
  task("S00-T02", "pending"),
  task("S01-T01", "pending"),
  task("S02-T01", "pending"),
];

describe("controller pure planner", () => {
  it("produces byte-identical plans and IDs for normalized input", () => {
    const left = snapshot({
      errors: [
        { category: "unavailable", provider: "fabro" },
        { category: "malformed", provider: "git" },
      ],
      tasks: [task("S01-T01", "pending"), task("S00-T02", "pending")],
    });
    const right = snapshot({
      errors: [...left.providerErrors].reverse(),
      tasks: [...left.tasks].reverse(),
    });
    const first = planControllerTick(left, policy);
    const second = planControllerTick(right, { ...policy });
    expect(canonicalControllerJson(first)).toBe(
      canonicalControllerJson(second),
    );
    expect(tickIdForController(left, policy)).toBe(
      tickIdForController(right, policy),
    );
  });

  it("orders all terminal archives before one recoverable lane", () => {
    const actions = planControllerTick(
      snapshot({
        tasks: [
          task("S03-T02", "failed", {
            baseSha: "1".repeat(40),
            findingSha256: "2".repeat(64),
            headSha: "3".repeat(40),
            runId: "lane-run",
          }),
          task("S02-T02", "terminal", { runId: "terminal-b" }),
          task("S01-T02", "terminal", { runId: "terminal-a" }),
        ],
      }),
      policy,
    );
    expect(actions.map(({ kind }) => kind)).toEqual([
      "archive_terminal",
      "archive_terminal",
      "recover_lane",
    ]);
    expect(actions.map(({ targetIds }) => targetIds[0])).toEqual([
      "S01-T02",
      "S02-T02",
      "S03-T02",
    ]);
    const changed = planControllerTick(
      snapshot({
        tasks: [
          task("S03-T02", "failed", {
            baseSha: "1".repeat(40),
            findingSha256: "4".repeat(64),
            headSha: "3".repeat(40),
            runId: "lane-run",
          }),
        ],
      }),
      policy,
    );
    expect(changed[0]?.actionId).not.toBe(actions[2]?.actionId);
  });

  it("fails closed on false green, provider errors, and gate saturation", () => {
    const falseGreen = planControllerTick(
      snapshot({
        tasks: [task("S04-T01", "lane_green", { admission: "rejected" })],
      }),
      policy,
    );
    expect(falseGreen).toMatchObject([
      { kind: "wait", targetIds: ["false_green:S04-T01"] },
    ]);
    expect(
      planControllerTick(
        snapshot({ errors: [{ category: "unavailable", provider: "fabro" }] }),
        policy,
      ),
    ).toMatchObject([
      { kind: "wait", targetIds: ["provider_error:fabro:unavailable"] },
    ]);
    expect(
      planControllerTick(
        snapshot({
          gate: { capacity: 1, inUse: 1, waiting: 2 },
          tasks: frontier(),
        }),
        policy,
      ),
    ).toMatchObject([{ kind: "wait", targetIds: ["gate_queue_saturated"] }]);
  });

  it("prioritizes promotion, recovery, and unresolved wave waits", () => {
    expect(
      planControllerTick(
        snapshot({ waves: [wave("wave-1", "succeeded")] }),
        policy,
      )[0],
    ).toMatchObject({
      kind: "promote_wave",
      targetIds: ["wave-1"],
    });
    expect(
      planControllerTick(
        snapshot({ waves: [wave("wave-2", "failed")] }),
        policy,
      )[0],
    ).toMatchObject({
      kind: "recover_wave",
      targetIds: ["wave-2"],
    });
    expect(
      planControllerTick(
        snapshot({ waves: [wave("wave-3", "running")] }),
        policy,
      )[0],
    ).toMatchObject({
      kind: "wait",
      targetIds: ["integration_active:wave-3"],
    });
  });

  it("batches sorted admissible lanes within policy and suppresses dispatch", () => {
    const actions = planControllerTick(
      snapshot({
        tasks: [
          task("S04-T02", "lane_green", {
            admission: "admissible",
            headSha: "4".repeat(40),
          }),
          task("S03-T03", "lane_green", {
            admission: "admissible",
            headSha: "3".repeat(40),
          }),
          ...frontier(),
        ],
      }),
      { ...policy, maximumBatchSize: 1 },
    );
    expect(actions).toMatchObject([
      { kind: "integrate_batch", targetIds: ["S03-T03"] },
    ]);
  });

  it("delegates remaining capacity to the manifest scheduler", () => {
    const actions = planControllerTick(snapshot({ tasks: frontier() }), {
      ...policy,
      totalActiveCapacity: 2,
    });
    expect(actions).toMatchObject([
      { kind: "dispatch_tasks", targetIds: ["S00-T02", "S01-T01"] },
    ]);
  });

  it("returns one stable wait for an empty frontier", () => {
    expect(planControllerTick(snapshot(), policy)).toMatchObject([
      { kind: "wait", targetIds: ["frontier_empty"] },
    ]);
  });
});

describe("controller audited executor", () => {
  const dispatchAction = (): ControllerAction => {
    const action = planControllerTick(snapshot({ tasks: frontier() }), {
      ...policy,
      totalActiveCapacity: 1,
    })[0];
    if (!action) throw new Error("missing action fixture");
    return action;
  };

  it("maps every mutating action to argument-safe checked commands", () => {
    const stateRoot = "/tmp/state";
    const cases = [
      planControllerTick(snapshot({ tasks: frontier() }), policy)[0],
      planControllerTick(
        snapshot({ waves: [wave("wave-pass", "succeeded")] }),
        policy,
      )[0],
      planControllerTick(
        snapshot({ waves: [wave("wave-fail", "failed")] }),
        policy,
      )[0],
      planControllerTick(
        snapshot({
          tasks: [
            task("S03-T03", "lane_green", {
              admission: "admissible",
              headSha: "3".repeat(40),
            }),
          ],
        }),
        policy,
      )[0],
      planControllerTick(
        snapshot({
          tasks: [
            task("S03-T02", "failed", {
              baseSha: "f".repeat(40),
              findingSha256: "2".repeat(64),
              headSha: "1".repeat(40),
            }),
          ],
        }),
        policy,
      )[0],
    ].filter((value): value is ControllerAction => value !== undefined);
    for (const action of cases) {
      const command = commandForControllerAction(action, stateRoot);
      expect(command?.[0]).toBe("pnpm");
      expect(command).not.toContain(expect.stringContaining(";"));
      if (action.kind === "recover_lane") {
        expect(command?.[command.indexOf("--ref") + 1]).toBe("1".repeat(40));
        expect(command?.[command.indexOf("--base") + 1]).toBe("f".repeat(40));
      }
      if (action.kind === "dispatch_tasks") {
        expect(command?.[command.indexOf("--max") + 1]).toBe("10");
      }
    }
  });

  it("writes immutable tick/action receipts and skips succeeded replay", () => {
    const root = mkdtempSync(join(tmpdir(), "brain-controller-"));
    const observed = snapshot({ tasks: frontier() });
    let calls = 0;
    const run = () => {
      calls += 1;
      return { exitCode: 0, stderr: "", stdout: "launched" };
    };
    const reconcile = () =>
      ({ kind: calls > 0 ? "succeeded" : "not-started" }) as const;
    const first = executeControllerTick({
      action: dispatchAction(),
      now: "2026-07-18T00:00:00.000Z",
      observe: () => observed,
      plannedSnapshot: observed,
      policy: { ...policy, totalActiveCapacity: 1 },
      reconcile,
      run,
      stateRoot: root,
    });
    const replay = executeControllerTick({
      action: dispatchAction(),
      now: "2026-07-18T00:01:00.000Z",
      observe: () => observed,
      plannedSnapshot: observed,
      policy: { ...policy, totalActiveCapacity: 1 },
      reconcile,
      run,
      stateRoot: root,
    });
    expect(first.status).toBe("succeeded");
    expect(replay).toEqual(first);
    expect(calls).toBe(1);
  });

  it("reconciles reserved/executing crashes without duplicate child launch", () => {
    for (const status of ["reserved", "executing"] as const) {
      const root = mkdtempSync(join(tmpdir(), "brain-controller-crash-"));
      const observed = snapshot({ tasks: frontier() });
      const action = dispatchAction();
      const actionPath = join(
        root,
        "controller",
        "actions",
        `${action.actionId}.json`,
      );
      expect(() =>
        executeControllerTick({
          action,
          afterReceiptTransition: (receipt) => {
            if (receipt.status === status) throw new Error("simulated crash");
          },
          now: "2026-07-18T00:00:00.000Z",
          observe: () => observed,
          plannedSnapshot: observed,
          policy: { ...policy, totalActiveCapacity: 1 },
          reconcile: () => ({ kind: "not-started" }),
          run: () => ({ exitCode: 0, stderr: "", stdout: "unused" }),
          stateRoot: root,
        }),
      ).toThrow("simulated crash");
      let calls = 0;
      const replay = executeControllerTick({
        action,
        now: "2026-07-18T00:01:00.000Z",
        observe: () => observed,
        plannedSnapshot: observed,
        policy: { ...policy, totalActiveCapacity: 1 },
        reconcile: () => ({ kind: "succeeded" }),
        run: () => {
          calls += 1;
          return { exitCode: 0, stderr: "", stdout: "bad" };
        },
        stateRoot: root,
      });
      expect(replay.status).toBe("succeeded");
      expect(calls).toBe(0);
      expect(JSON.parse(readFileSync(actionPath, "utf8"))).toMatchObject({
        status: "succeeded",
      });
    }
  });

  it("supersedes control drift and rejects success without durable proof", () => {
    const observed = snapshot({ tasks: frontier() });
    const drifted = { ...observed, controlHeadSha: "f".repeat(40) };
    let calls = 0;
    const drift = executeControllerTick({
      action: dispatchAction(),
      now: "2026-07-18T00:00:00.000Z",
      observe: () => drifted,
      plannedSnapshot: observed,
      policy: { ...policy, totalActiveCapacity: 1 },
      reconcile: () => ({ kind: "not-started" }),
      run: () => {
        calls += 1;
        return { exitCode: 0, stderr: "", stdout: "" };
      },
      stateRoot: mkdtempSync(join(tmpdir(), "brain-controller-drift-")),
    });
    expect(drift.status).toBe("superseded");
    expect(calls).toBe(0);

    const failed = executeControllerTick({
      action: dispatchAction(),
      now: "2026-07-18T00:00:00.000Z",
      observe: () => observed,
      plannedSnapshot: observed,
      policy: { ...policy, totalActiveCapacity: 1 },
      reconcile: () => ({ kind: "not-started" }),
      run: () => ({
        exitCode: 0,
        stderr: "secret provider payload",
        stdout: "",
      }),
      stateRoot: mkdtempSync(join(tmpdir(), "brain-controller-unproved-")),
    });
    expect(failed.status).toBe("failed");
    expect(JSON.stringify(failed)).not.toContain("secret provider payload");
  });

  it("rejects conflicting same-ID receipts", () => {
    const root = mkdtempSync(join(tmpdir(), "brain-controller-corrupt-"));
    const action = dispatchAction();
    const dir = join(root, "controller", "actions");
    expect(() =>
      executeControllerTick({
        action,
        afterReceiptTransition: (receipt) => {
          if (receipt.status === "reserved") throw new Error("simulated crash");
        },
        now: "2026-07-18T00:00:00.000Z",
        observe: () => snapshot({ tasks: frontier() }),
        plannedSnapshot: snapshot({ tasks: frontier() }),
        policy: { ...policy, totalActiveCapacity: 1 },
        reconcile: () => ({ kind: "not-started" }),
        run: () => ({ exitCode: 0, stderr: "", stdout: "" }),
        stateRoot: root,
      }),
    ).toThrow("simulated crash");
    const path = join(dir, `${action.actionId}.json`);
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(
      path,
      JSON.stringify({ ...receipt, actionId: "x".repeat(64) }),
    );
    expect(() =>
      executeControllerTick({
        action,
        now: "2026-07-18T00:00:00.000Z",
        observe: () => snapshot({ tasks: frontier() }),
        plannedSnapshot: snapshot({ tasks: frontier() }),
        policy: { ...policy, totalActiveCapacity: 1 },
        reconcile: () => ({ kind: "not-started" }),
        run: () => ({ exitCode: 0, stderr: "", stdout: "" }),
        stateRoot: root,
      }),
    ).toThrow("action receipt identity mismatch");
  });

  it("rejects execution of an action absent from the immutable tick", () => {
    const observed = snapshot({ tasks: frontier() });
    const action = { ...dispatchAction(), actionId: "9".repeat(64) };
    expect(() =>
      executeControllerTick({
        action,
        now: "2026-07-18T00:00:00.000Z",
        observe: () => observed,
        plannedSnapshot: observed,
        policy: { ...policy, totalActiveCapacity: 1 },
        reconcile: () => ({ kind: "not-started" }),
        run: () => ({ exitCode: 0, stderr: "", stdout: "" }),
        stateRoot: mkdtempSync(join(tmpdir(), "brain-controller-unplanned-")),
      }),
    ).toThrow("not present in planned tick");
  });

  it("rejects same-ID action field drift", () => {
    const observed = snapshot({ tasks: frontier() });
    const action = { ...dispatchAction(), totalActiveCapacity: 99 };
    expect(() =>
      executeControllerTick({
        action,
        now: "2026-07-18T00:00:00.000Z",
        observe: () => observed,
        plannedSnapshot: observed,
        policy: { ...policy, totalActiveCapacity: 1 },
        reconcile: () => ({ kind: "not-started" }),
        run: () => ({ exitCode: 0, stderr: "", stdout: "" }),
        stateRoot: mkdtempSync(
          join(tmpdir(), "brain-controller-drifted-action-"),
        ),
      }),
    ).toThrow("action bytes differ from planned tick");
  });

  it("finishes an interrupted exact receipt rename", () => {
    const root = mkdtempSync(join(tmpdir(), "brain-controller-next-"));
    const observed = snapshot({ tasks: frontier() });
    const action = dispatchAction();
    expect(() =>
      executeControllerTick({
        action,
        afterReceiptTransition: (receipt) => {
          if (receipt.status === "reserved") throw new Error("simulated crash");
        },
        now: "2026-07-18T00:00:00.000Z",
        observe: () => observed,
        plannedSnapshot: observed,
        policy: { ...policy, totalActiveCapacity: 1 },
        reconcile: () => ({ kind: "not-started" }),
        run: () => ({ exitCode: 0, stderr: "", stdout: "" }),
        stateRoot: root,
      }),
    ).toThrow("simulated crash");
    const path = join(root, "controller", "actions", `${action.actionId}.json`);
    const reserved = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(
      `${path}.next`,
      `${canonicalControllerJson({ ...reserved, status: "executing" })}\n`,
    );
    let calls = 0;
    const result = executeControllerTick({
      action,
      now: "2026-07-18T00:01:00.000Z",
      observe: () => observed,
      plannedSnapshot: observed,
      policy: { ...policy, totalActiveCapacity: 1 },
      reconcile: () => ({ kind: "succeeded" }),
      run: () => {
        calls += 1;
        return { exitCode: 0, stderr: "", stdout: "" };
      },
      stateRoot: root,
    });
    expect(result.status).toBe("succeeded");
    expect(calls).toBe(0);
  });

  it("emits redacted telemetry with stable operational metrics", () => {
    const observed = snapshot({
      errors: [{ category: "unauthorized", provider: "fabro" }],
      gate: { capacity: 3, inUse: 1, waiting: 2 },
      tasks: [task("S01-T01", "running"), task("S02-T01", "pending")],
    });
    const action = planControllerTick(observed, policy)[0];
    if (!action) throw new Error("missing telemetry action");
    const value = telemetryForControllerAction({
      action,
      durationMs: 25,
      now: "2026-07-18T00:00:00.000Z",
      outcome: "failed",
      readyToLaunchLatencyMs: 40,
      snapshot: observed,
      tickId: tickIdForController(observed, policy),
    });
    expect(value).toMatchObject({
      activeCounts: { running: 1 },
      durationMs: 25,
      gateQueue: { capacity: 3, inUse: 1, waiting: 2 },
      providerErrorCategories: ["fabro:unauthorized"],
      readyToLaunchLatencyMs: 40,
      schemaVersion: "maestro-brain-controller-telemetry/v1",
    });
    expect(JSON.stringify(value)).not.toContain("payload");
  });
});
