import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import type {
  BrainTaskContract,
  BrainTaskManifestProjection,
  ProjectedBrainTaskContract,
  TaskCollisionMetadata,
} from "../src/manifest.js";
import { buildManifest, loadManifestProjection } from "../src/manifest.js";
import {
  availableDispatchSlots,
  frontierDiagnostics,
  selectReadyTasks,
} from "../src/scheduler.js";

const syntheticTask = (
  template: BrainTaskContract,
  input: {
    readonly estimatedSourceLines: number;
    readonly fileLocks: readonly string[];
    readonly taskId: string;
    readonly codeStartAfter?: readonly string[];
  },
): BrainTaskContract => ({
  ...template,
  codeStartAfter: input.codeStartAfter ?? [],
  estimatedSourceLines: input.estimatedSourceLines,
  fileLocks: input.fileLocks,
  taskId: input.taskId,
});

const artifactAvailability = (
  projection: BrainTaskManifestProjection,
): ReadonlyMap<string, string> =>
  new Map(
    projection.contract.edges.flatMap((edge) =>
      edge.classification === "contract"
        ? [[edge.producerTaskId, edge.artifact.sha256] as const]
        : [],
    ),
  );

const projectedSyntheticTask = (
  template: BrainTaskContract,
  input: {
    readonly collisions?: readonly TaskCollisionMetadata[];
    readonly fileInventoryStatus?: BrainTaskContract["fileInventoryStatus"];
    readonly taskId: string;
  },
): ProjectedBrainTaskContract => ({
  ...template,
  classifiedCodeStartAfter: [],
  codeStartAfter: [],
  collisions: input.collisions ?? [],
  fileInventoryStatus: input.fileInventoryStatus ?? "ready",
  fileLocks: [],
  taskId: input.taskId,
});

const sameWave = (otherTaskId: string): TaskCollisionMetadata => ({
  mandatorySameWave: true,
  otherTaskId,
  paths: [`shared/${otherTaskId}.ts`],
  policy: "same_wave_fail_closed",
});

const AUDITED_19_COMPLETED_TASK_IDS = new Set([
  "S00-T02",
  "S00-T03",
  "S00-T04",
  "S01-T01",
  "S01-T02",
  "S01-T03",
  "S01-T04",
  "S02-T01",
  "S02-T02",
  "S02-T04",
  "S03-T01",
  "S03-T02",
  "S03-T03",
  "S08-T01",
  "S08-T02",
  "S09-T01",
  "S11-T01",
  "S12-T01",
  "S13-T01",
]);

const AUDITED_ACTIVE_TASK_IDS = new Set(["S04-T01", "S04-T02", "S11-T02"]);

describe("brain task scheduler", () => {
  it("treats max as total active capacity across repeated dispatches", () => {
    expect(availableDispatchSlots(20, 0)).toBe(20);
    expect(availableDispatchSlots(20, 7)).toBe(13);
    expect(availableDispatchSlots(20, 20)).toBe(0);
    expect(availableDispatchSlots(20, 23)).toBe(0);
    const dispatch = readFileSync(
      new URL("../src/dispatch.mts", import.meta.url),
      "utf8",
    );
    expect(dispatch).toContain("totalActiveCapacity: maximum");
    expect(dispatch).toContain("maximum: availableSlots");
    expect(dispatch).toContain("loadManifestProjection");
    expect(dispatch).toContain("contractArtifactSha256ByProducer");
    expect(dispatch).toContain("tasks: projection.tasks");
  });

  it("starts independent contract lanes together", () => {
    const manifest = buildManifest();
    const result = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(),
      maximum: 10,
      tasks: manifest.tasks,
    });
    expect(result.selected.map((task) => task.taskId)).toEqual(
      expect.arrayContaining([
        "S00-T02",
        "S01-T01",
        "S02-T01",
        "S03-T01",
        "S12-T01",
      ]),
    );
    expect(
      result.selected.every((task) => task.fileInventoryStatus === "ready"),
    ).toBe(true);
  });

  it("does not dispatch an overlapping shared lock", () => {
    const manifest = buildManifest();
    const s01 = manifest.tasks.find((task) => task.taskId === "S01-T01");
    const s08 = manifest.tasks.find((task) => task.taskId === "S08-T01");
    expect(s01).toBeDefined();
    expect(s08).toBeDefined();
    if (!s01 || !s08) throw new Error("test fixtures missing from manifest");
    const synthetic = {
      ...s08,
      fileLocks: s01.fileLocks,
    };
    const result = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(),
      maximum: 2,
      requestedTaskIds: new Set([s01.taskId, synthetic.taskId]),
      tasks: [s01, synthetic],
    });
    expect(result.selected).toHaveLength(1);
  });

  it("advances the weighted critical path at the W3 frontier", () => {
    const manifest = buildManifest();
    const completedTaskIds = new Set([
      "S00-T02",
      "S00-T03",
      "S00-T04",
      "S01-T01",
      "S01-T02",
      "S01-T03",
      "S01-T04",
      "S02-T01",
      "S02-T02",
      "S03-T01",
      "S03-T02",
      "S04-T01",
      "S04-T02",
      "S08-T01",
      "S08-T02",
      "S09-T01",
      "S11-T01",
      "S11-T02",
      "S12-T01",
      "S13-T01",
    ]);

    const result = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds,
      maximum: 1,
      tasks: manifest.tasks,
    });

    expect(result.ready.map((task) => task.taskId)).toEqual([
      "S02-T03",
      "S02-T04",
      "S04-T03",
      "S04-T04",
      "S05-T01",
      "S10-T01",
    ]);
    expect(result.selected.map((task) => task.taskId)).toEqual(["S05-T01"]);
  });

  it("maximizes safe parallelism at the audited Wave 5 frontier", () => {
    const manifest = buildManifest();
    const completedTaskIds = new Set([
      "S01-T02",
      "S02-T01",
      "S02-T03",
      "S03-T03",
      "S04-T02",
      "S05-T01",
      "S05-T02",
      "S06-T01",
    ]);
    const requestedTaskIds = new Set([
      "S03-T04",
      "S05-T03",
      "S06-T02",
      "S07-T01",
      "S10-T01",
    ]);

    const result = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds,
      maximum: 40,
      requestedTaskIds,
      tasks: manifest.tasks,
    });

    expect(result.ready.map((task) => task.taskId)).toEqual([
      "S03-T04",
      "S05-T03",
      "S06-T02",
      "S07-T01",
      "S10-T01",
    ]);
    expect(result.selected.map((task) => task.taskId)).toEqual([
      "S03-T04",
      "S06-T02",
      "S10-T01",
    ]);
  });

  it("finds the exact maximum-cardinality conflict-free subset", () => {
    const template = buildManifest().tasks.find(
      (task) => task.taskId === "S01-T01",
    );
    expect(template).toBeDefined();
    if (!template) throw new Error("scheduler template task missing");
    const broad = syntheticTask(template, {
      estimatedSourceLines: 300,
      fileLocks: ["shared-a", "shared-b"],
      taskId: "S20-T01",
    });
    const left = syntheticTask(template, {
      estimatedSourceLines: 150,
      fileLocks: ["shared-a"],
      taskId: "S20-T02",
    });
    const right = syntheticTask(template, {
      estimatedSourceLines: 150,
      fileLocks: ["shared-b"],
      taskId: "S20-T03",
    });

    expect(
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: new Set(),
        maximum: 3,
        tasks: [broad, left, right],
      }).selected.map((task) => task.taskId),
    ).toEqual(["S20-T02", "S20-T03"]);
  });

  it("is permutation-invariant with a stable task-ID tie-break", () => {
    const template = buildManifest().tasks.find(
      (task) => task.taskId === "S01-T01",
    );
    expect(template).toBeDefined();
    if (!template) throw new Error("scheduler template task missing");
    const earlier = syntheticTask(template, {
      estimatedSourceLines: 200,
      fileLocks: ["shared"],
      taskId: "S20-T01",
    });
    const later = syntheticTask(template, {
      estimatedSourceLines: 200,
      fileLocks: ["shared"],
      taskId: "S20-T02",
    });
    const independent = syntheticTask(template, {
      estimatedSourceLines: 100,
      fileLocks: ["independent"],
      taskId: "S20-T03",
    });
    const selections = [
      [later, independent, earlier],
      [independent, earlier, later],
      [earlier, later, independent],
    ].map((tasks) =>
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: new Set(),
        maximum: 3,
        tasks,
      }).selected.map((task) => task.taskId),
    );

    expect(selections).toEqual([
      ["S20-T01", "S20-T03"],
      ["S20-T01", "S20-T03"],
      ["S20-T01", "S20-T03"],
    ]);
  });

  it("gives zero-source contract work a minimum scheduling unit", () => {
    const template = buildManifest().tasks.find(
      (task) => task.taskId === "S01-T01",
    );
    expect(template).toBeDefined();
    if (!template) throw new Error("scheduler template task missing");
    const contract = syntheticTask(template, {
      estimatedSourceLines: 0,
      fileLocks: ["shared"],
      taskId: "S20-T01",
    });
    const contractConsumer = syntheticTask(template, {
      codeStartAfter: [contract.taskId],
      estimatedSourceLines: 300,
      fileLocks: ["consumer"],
      taskId: "S20-T02",
    });
    const standalone = syntheticTask(template, {
      estimatedSourceLines: 300,
      fileLocks: ["shared"],
      taskId: "S20-T03",
    });

    expect(
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: new Set(),
        maximum: 1,
        tasks: [standalone, contractConsumer, contract],
      }).selected.map((task) => task.taskId),
    ).toEqual(["S20-T01"]);
  });

  it("requires integrated code-start dependencies", () => {
    const manifest = buildManifest();
    const task = manifest.tasks.find(
      (candidate) => candidate.taskId === "S01-T02",
    );
    expect(task).toBeDefined();
    if (!task) throw new Error("S01-T02 missing from manifest");
    expect(
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: new Set(),
        maximum: 1,
        tasks: [task],
      }).selected,
    ).toEqual([]);
  });

  it("distinguishes true dependencies from exact contract artifacts", () => {
    const projection = loadManifestProjection();
    const availableArtifacts = artifactAvailability(projection);
    const contractReady = projection.tasks.find(
      (task) => task.taskId === "S04-T01",
    );
    const trueBlocked = projection.tasks.find(
      (task) => task.taskId === "S04-T02",
    );
    expect(contractReady).toBeDefined();
    expect(trueBlocked).toBeDefined();
    if (!contractReady || !trueBlocked) {
      throw new Error("classified scheduler fixtures missing");
    }

    expect(
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: new Set(),
        contractArtifactSha256ByProducer: availableArtifacts,
        maximum: 2,
        tasks: [contractReady, trueBlocked],
      }).ready.map((task) => task.taskId),
    ).toEqual(["S04-T01"]);

    const unspecified = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(),
      maximum: 1,
      tasks: [contractReady],
    });
    expect(unspecified.ready).toEqual([]);
    expect(unspecified.blockers[0]?.reasons.join("\n")).toContain("is missing");

    const missing = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(),
      contractArtifactSha256ByProducer: new Map(),
      maximum: 2,
      tasks: [contractReady],
    });
    expect(missing.ready).toEqual([]);
    expect(missing.blockers[0]?.reasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /S00-T03.*task-packet.*42193b160bc04a7d9bc3ef7f883545c8eaeb4506f9f848f6b02ba801d08410ac/,
        ),
      ]),
    );

    const drifted = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(),
      contractArtifactSha256ByProducer: new Map([
        ["S00-T03", "0".repeat(64)],
        ["S01-T02", "0".repeat(64)],
      ]),
      maximum: 2,
      tasks: [contractReady],
    });
    expect(drifted.ready).toEqual([]);
    expect(drifted.blockers[0]?.reasons.join("\n")).toMatch(
      /S01-T02.*expected f8dfea31b91e435c11203c1641f2b5fd1cefe5e966e26f4ba105b1e7088d7204.*got 0000/,
    );
  });

  it("enforces serialized active locks and atomically selects same-wave peers", () => {
    const projection = loadManifestProjection();
    const availableArtifacts = artifactAvailability(projection);
    const byId = new Map(projection.tasks.map((task) => [task.taskId, task]));
    const serialized = selectReadyTasks({
      activeTaskIds: new Set(["S11-T02"]),
      completedTaskIds: new Set(["S12-T01"]),
      contractArtifactSha256ByProducer: availableArtifacts,
      maximum: 2,
      tasks: projection.tasks,
    });
    expect(serialized.ready.map((task) => task.taskId)).not.toContain(
      "S12-T02",
    );
    expect(serialized.activeSerializedPaths.join("\n")).toMatch(
      /S11-T02.*S12-T02.*packages\/convex\/confect\/http\.ts/,
    );

    const peers = [byId.get("S08-T03"), byId.get("S08-T04")].filter(
      (task): task is NonNullable<typeof task> => task !== undefined,
    );
    expect(peers).toHaveLength(2);
    const oneSlot = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(["S08-T02"]),
      contractArtifactSha256ByProducer: availableArtifacts,
      maximum: 1,
      tasks: peers,
    });
    expect(oneSlot.ready.map((task) => task.taskId)).toEqual([
      "S08-T03",
      "S08-T04",
    ]);
    expect(oneSlot.selected).toEqual([]);

    const together = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(["S08-T02"]),
      contractArtifactSha256ByProducer: availableArtifacts,
      maximum: 2,
      tasks: peers,
    });
    expect(together.selected.map((task) => task.taskId)).toEqual([
      "S08-T03",
      "S08-T04",
    ]);
    expect(together.mandatoryIntegrationGroups).toEqual([
      ["S08-T03", "S08-T04"],
    ]);
    expect(() =>
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: new Set(["S08-T02"]),
        contractArtifactSha256ByProducer: availableArtifacts,
        maximum: 2,
        requestedTaskIds: new Set(["S08-T03"]),
        tasks: peers,
      }),
    ).toThrow("partial mandatory same-wave request: S08-T03,S08-T04");
  });

  it("serializes selected security owners and gates migration regeneration on Task 6", () => {
    const projection = loadManifestProjection();
    const availableArtifacts = artifactAvailability(projection);
    const byId = new Map(projection.tasks.map((task) => [task.taskId, task]));
    const securityOwners = [byId.get("S04-T03"), byId.get("S11-T02")].filter(
      (task): task is NonNullable<typeof task> => task !== undefined,
    );
    expect(securityOwners).toHaveLength(2);
    const serialized = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(["S04-T02", "S11-T01"]),
      contractArtifactSha256ByProducer: availableArtifacts,
      maximum: 2,
      tasks: securityOwners,
    });
    expect(serialized.ready).toHaveLength(2);
    expect(serialized.selected).toHaveLength(1);

    const migrationOwners = [byId.get("S02-T03"), byId.get("S04-T02")].filter(
      (task): task is NonNullable<typeof task> => task !== undefined,
    );
    expect(migrationOwners).toHaveLength(2);
    const beforeTask6 = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(["S02-T02", "S04-T01"]),
      contractArtifactSha256ByProducer: availableArtifacts,
      maximum: 2,
      tasks: migrationOwners,
    });
    expect(beforeTask6.ready).toHaveLength(2);
    expect(beforeTask6.selected).toHaveLength(1);

    const afterTask6 = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(["S02-T02", "S04-T01"]),
      contractArtifactSha256ByProducer: availableArtifacts,
      maximum: 2,
      task6RegistryReady: true,
      tasks: migrationOwners,
    });
    expect(afterTask6.selected.map((task) => task.taskId)).toEqual([
      "S02-T03",
      "S04-T02",
    ]);
    expect(afterTask6.mandatoryIntegrationGroups).toEqual([
      ["S02-T03", "S04-T02"],
    ]);

    const activeBeforeTask6 = selectReadyTasks({
      activeTaskIds: new Set(["S02-T03"]),
      completedTaskIds: new Set(["S04-T01"]),
      contractArtifactSha256ByProducer: availableArtifacts,
      maximum: 1,
      tasks: migrationOwners,
    });
    expect(activeBeforeTask6.ready.map((task) => task.taskId)).not.toContain(
      "S04-T02",
    );
    expect(activeBeforeTask6.activeSerializedPaths.join("\n")).toMatch(
      /S02-T03.*S04-T02.*migrations\.ts/,
    );
  });

  it("derives mandatory components through blocked bridge tasks", () => {
    const template = buildManifest().tasks.find(
      (task) => task.taskId === "S01-T01",
    );
    if (!template) throw new Error("scheduler template task missing");
    const left = projectedSyntheticTask(template, {
      collisions: [sameWave("S20-T02")],
      taskId: "S20-T01",
    });
    const bridge = projectedSyntheticTask(template, {
      collisions: [sameWave("S20-T01"), sameWave("S20-T03")],
      fileInventoryStatus: "open:F",
      taskId: "S20-T02",
    });
    const right = projectedSyntheticTask(template, {
      collisions: [sameWave("S20-T02")],
      taskId: "S20-T03",
    });

    const oneSlot = selectReadyTasks({
      activeTaskIds: new Set(),
      completedTaskIds: new Set(),
      contractArtifactSha256ByProducer: new Map(),
      maximum: 1,
      tasks: [left, bridge, right],
    });
    expect(oneSlot.ready.map((task) => task.taskId)).toEqual([
      "S20-T01",
      "S20-T03",
    ]);
    expect(oneSlot.selected).toEqual([]);
    expect(() =>
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: new Set(),
        contractArtifactSha256ByProducer: new Map(),
        maximum: 2,
        requestedTaskIds: new Set(["S20-T01"]),
        tasks: [left, bridge, right],
      }),
    ).toThrow("partial mandatory same-wave request: S20-T01,S20-T03");
  });

  it("completes a global mandatory component around active owners", () => {
    const template = buildManifest().tasks.find(
      (task) => task.taskId === "S01-T01",
    );
    if (!template) throw new Error("scheduler template task missing");
    const active = projectedSyntheticTask(template, {
      collisions: [sameWave("S20-T02")],
      taskId: "S20-T01",
    });
    const bridge = projectedSyntheticTask(template, {
      collisions: [
        sameWave("S20-T01"),
        sameWave("S20-T03"),
        sameWave("S20-T04"),
      ],
      fileInventoryStatus: "open:F",
      taskId: "S20-T02",
    });
    const right = projectedSyntheticTask(template, {
      collisions: [sameWave("S20-T02")],
      taskId: "S20-T03",
    });
    const farRight = projectedSyntheticTask(template, {
      collisions: [sameWave("S20-T02")],
      taskId: "S20-T04",
    });

    const result = selectReadyTasks({
      activeTaskIds: new Set([active.taskId]),
      completedTaskIds: new Set(),
      contractArtifactSha256ByProducer: new Map(),
      maximum: 1,
      tasks: [active, bridge, right, farRight],
    });
    expect(result.ready.map((task) => task.taskId)).toEqual([
      "S20-T03",
      "S20-T04",
    ]);
    expect(result.selected).toEqual([]);

    const twoSlots = selectReadyTasks({
      activeTaskIds: new Set([active.taskId]),
      completedTaskIds: new Set(),
      contractArtifactSha256ByProducer: new Map(),
      maximum: 2,
      tasks: [active, bridge, right, farRight],
    });
    expect(twoSlots.selected.map((task) => task.taskId)).toEqual([
      "S20-T03",
      "S20-T04",
    ]);
    expect(twoSlots.mandatoryIntegrationGroups).toEqual([
      ["S20-T01", "S20-T03", "S20-T04"],
    ]);
  });

  it("pins the current pre-Task-6 frontier at six with all registry exclusions", () => {
    const projection = loadManifestProjection();
    const availableArtifacts = artifactAvailability(projection);
    const result = selectReadyTasks({
      activeTaskIds: AUDITED_ACTIVE_TASK_IDS,
      completedTaskIds: AUDITED_19_COMPLETED_TASK_IDS,
      contractArtifactSha256ByProducer: availableArtifacts,
      maximum: 40,
      tasks: projection.tasks,
    });
    const diagnostic = frontierDiagnostics(result);
    expect(
      result.ready.map((task) => task.taskId),
      diagnostic,
    ).toEqual([
      "S03-T04",
      "S06-T01",
      "S08-T03",
      "S08-T04",
      "S13-T02",
      "S13-T03",
    ]);
    const registrySerializedExclusions = [
      "S02-T03",
      "S05-T01",
      "S07-T01",
      "S09-T02",
      "S10-T01",
    ];
    for (const taskId of registrySerializedExclusions) {
      const blocker = result.blockers.find((item) => item.taskId === taskId);
      expect(blocker?.reasons.join("\n")).toMatch(
        /S04-T02.*packages\/convex\/confect\/internal\/migrations\.ts/,
      );
    }
  });

  it("pins the audited post-Task-6 frontier at eleven with limiter diagnostics", () => {
    const projection = loadManifestProjection();
    const availableArtifacts = artifactAvailability(projection);
    const result = selectReadyTasks({
      activeTaskIds: AUDITED_ACTIVE_TASK_IDS,
      completedTaskIds: AUDITED_19_COMPLETED_TASK_IDS,
      contractArtifactSha256ByProducer: availableArtifacts,
      maximum: 40,
      task6RegistryReady: true,
      tasks: projection.tasks,
    });
    const diagnostic = frontierDiagnostics(result);
    expect(
      result.ready.map((task) => task.taskId),
      diagnostic,
    ).toEqual([
      "S02-T03",
      "S03-T04",
      "S05-T01",
      "S06-T01",
      "S07-T01",
      "S08-T03",
      "S08-T04",
      "S09-T02",
      "S10-T01",
      "S13-T02",
      "S13-T03",
    ]);
    expect(result.limitingTrueEdges).toEqual(
      [...result.limitingTrueEdges].sort(),
    );
    expect(result.activeSerializedPaths).toEqual(
      [...result.activeSerializedPaths].sort(),
    );
    expect(diagnostic).toContain("limiting true edges:");
    expect(diagnostic).toContain("active serialized paths:");
  });

  it("does not dispatch S13 operations before MCP and export contracts", () => {
    const manifest = buildManifest();
    const task = manifest.tasks.find(
      (candidate) => candidate.taskId === "S13-T03",
    );
    expect(task).toBeDefined();
    if (!task) throw new Error("S13-T03 missing from manifest");
    const completed = new Set(["S06-T02", "S08-T01", "S11-T04"]);
    expect(
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: completed,
        maximum: 1,
        tasks: [task],
      }).selected,
    ).toEqual([]);
    completed.add("S12-T02");
    expect(
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: completed,
        maximum: 1,
        tasks: [task],
      }).selected.map((candidate) => candidate.taskId),
    ).toEqual(["S13-T03"]);
  });

  it("does not dispatch a task whose exact file inventory is open", () => {
    const manifest = buildManifest();
    const task = manifest.tasks.find(
      (candidate) => candidate.taskId === "S01-T01",
    );
    expect(task?.fileInventoryStatus).toBe("ready");
    const openTask = task
      ? ({
          ...task,
          fileInventoryStatus: "open:F" as const,
        } satisfies typeof task)
      : undefined;
    expect(
      selectReadyTasks({
        activeTaskIds: new Set(),
        completedTaskIds: new Set(),
        maximum: 1,
        tasks: openTask ? [openTask] : [],
      }).selected,
    ).toEqual([]);
  });

  it("keeps locks held for lane-green tasks awaiting integration", () => {
    const manifest = buildManifest();
    const laneGreen = manifest.tasks.find(
      (candidate) => candidate.taskId === "S12-T01",
    );
    const candidate = manifest.tasks.find((task) => task.taskId === "S09-T01");
    expect(laneGreen).toBeDefined();
    expect(candidate).toBeDefined();
    if (!laneGreen || !candidate)
      throw new Error("scheduler fixtures missing from manifest");

    const overlappingCandidate = {
      ...candidate,
      fileLocks: laneGreen.fileLocks,
    };
    expect(
      selectReadyTasks({
        activeTaskIds: new Set([laneGreen.taskId]),
        completedTaskIds: new Set(),
        maximum: 1,
        tasks: [laneGreen, overlappingCandidate],
      }).selected,
    ).toEqual([]);
  });
});
