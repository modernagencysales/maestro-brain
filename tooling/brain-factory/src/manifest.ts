import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLAN_RELATIVE =
  "docs/superpowers/plans/2026-07-14-maestro-brain-agency-context-os-implementation-plan.md";
export const MANIFEST_RELATIVE =
  "docs/superpowers/execution/maestro-brain/task-manifest.json";
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export type WorkClassification =
  "fixture-to-real" | "pattern-instance" | "template-gap";

export type GateProfile =
  | "cli"
  | "convex"
  | "docs"
  | "external"
  | "integrations"
  | "release"
  | "search"
  | "template-core"
  | "tooling"
  | "web";

export interface BrainTaskContract {
  readonly acceptanceAfter: string;
  readonly classification: WorkClassification;
  readonly codeStartAfter: readonly string[];
  readonly fileLocks: readonly string[];
  readonly gateProfiles: readonly GateProfile[];
  readonly kind: "docs" | "external" | "product" | "release";
  readonly lane: string;
  readonly requirements: readonly string[];
  readonly sourceLineBudget: number;
  readonly taskBlockHash: string;
  readonly taskId: string;
  readonly title: string;
  readonly tranche: string;
}

export interface BrainTaskManifest {
  readonly planPath: string;
  readonly planSha256: string;
  readonly schemaVersion: "maestro-brain-task-manifest/v1";
  readonly tasks: readonly BrainTaskContract[];
}

const START_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  "S00-T01": [],
  "S00-T02": [],
  "S00-T03": ["S00-T02"],
  "S00-T04": ["S00-T02"],
  "S01-T01": [],
  "S01-T02": ["S01-T01"],
  "S01-T03": ["S01-T02"],
  "S01-T04": ["S01-T02"],
  "S02-T01": [],
  "S02-T02": ["S02-T01", "S01-T03"],
  "S02-T03": ["S02-T02"],
  "S02-T04": ["S02-T02"],
  "S03-T01": [],
  "S03-T02": ["S03-T01", "S01-T03"],
  "S03-T03": ["S03-T01", "S02-T02"],
  "S03-T04": ["S03-T03", "S02-T03"],
  "S04-T01": ["S01-T02"],
  "S04-T02": ["S04-T01"],
  "S04-T03": ["S04-T02"],
  "S04-T04": ["S04-T02", "S03-T01"],
  "S05-T01": ["S04-T02"],
  "S05-T02": ["S05-T01", "S04-T03"],
  "S05-T03": ["S05-T02"],
  "S05-T04": ["S05-T03", "S04-T04"],
  "S06-T01": ["S05-T01"],
  "S06-T02": ["S06-T01"],
  "S06-T03": ["S06-T02", "S05-T02"],
  "S06-T04": ["S06-T03"],
  "S07-T01": ["S01-T02", "S02-T01", "S05-T01"],
  "S07-T02": ["S07-T01", "S05-T02"],
  "S07-T03": ["S07-T02", "S06-T01"],
  "S07-T04": ["S07-T01", "S03-T01"],
  "S08-T01": [],
  "S08-T02": ["S08-T01"],
  "S08-T03": ["S08-T02", "S05-T03", "S07-T01"],
  "S08-T04": ["S08-T02", "S02-T03", "S07-T01"],
  "S09-T01": [],
  "S09-T02": ["S09-T01", "S02-T02", "S07-T01"],
  "S09-T03": ["S09-T02", "S02-T03"],
  "S09-T04": ["S09-T03", "S08-T01"],
  "S10-T01": ["S04-T02", "S01-T02"],
  "S10-T02": ["S10-T01", "S09-T04"],
  "S10-T03": ["S10-T02"],
  "S10-T04": ["S10-T03", "S03-T01"],
  "S11-T01": [],
  "S11-T02": ["S11-T01", "S01-T02"],
  "S11-T03": ["S11-T02", "S09-T04"],
  "S11-T04": ["S11-T03"],
  "S12-T01": [],
  "S12-T02": ["S12-T01", "S11-T02", "S07-T01"],
  "S12-T03": ["S12-T02", "S03-T01"],
  "S13-T01": [],
  "S13-T02": ["S13-T01", "S06-T02"],
  "S13-T03": ["S06-T02", "S08-T01"],
  "S13-T04": ["S13-T03", "S03-T01"],
  "S14-T01": ["S10-T04", "S11-T04", "S12-T03", "S13-T04"],
};

const laneFor = (taskId: string): string => {
  const stack = taskId.slice(0, 3);
  return (
    (
      {
        S00: "foundation",
        S01: "identity",
        S02: "brain",
        S03: "web",
        S04: "slack-source",
        S05: "slack-source",
        S06: "slack-source",
        S07: "lifecycle",
        S08: "cognition",
        S09: "retrieval",
        S10: "slack-answer",
        S11: "headless",
        S12: "export",
        S13: "operations",
        S14: "release",
      } as const
    )[stack] ?? "unknown"
  );
};

const trancheFor = (taskId: string): string => {
  if (taskId.startsWith("S00")) return "F0-foundation";
  if (
    new Set([
      "S01-T01",
      "S01-T02",
      "S02-T01",
      "S03-T01",
      "S04-T01",
      "S05-T01",
      "S07-T01",
      "S08-T01",
      "S09-T01",
      "S11-T01",
      "S12-T01",
      "S13-T01",
    ]).has(taskId)
  )
    return "C1-contract-spine";
  if (taskId.startsWith("S14")) return "R4-release";
  if (
    /^S(?:08-T0[34]|09-T0[34]|10-|11-T0[34]|12-T0[23]|13-T0[234])/.test(taskId)
  )
    return "X3-convergence";
  return "D2-domain-bodies";
};

const inferProfiles = (
  taskId: string,
  lane: string,
  fileLocks: readonly string[],
): GateProfile[] => {
  if (taskId === "S00-T01") return ["external"];
  if (taskId === "S00-T02") return ["docs"];
  if (taskId === "S14-T01") return ["release"];
  const profiles = new Set<GateProfile>();
  const files = fileLocks.join(" ");
  if (files.includes("apps/web") || lane === "web") profiles.add("web");
  if (
    files.includes("packages/convex") ||
    ["brain", "identity", "lifecycle"].includes(lane)
  )
    profiles.add("convex");
  if (files.includes("packages/integrations") || lane.startsWith("slack"))
    profiles.add("integrations");
  if (files.includes("packages/search") || lane === "retrieval")
    profiles.add("search");
  if (files.includes("packages/template-core")) profiles.add("template-core");
  if (files.includes("apps/cli") || lane === "headless") profiles.add("cli");
  if (files.includes("tooling/") || lane === "operations")
    profiles.add("tooling");
  if (files.includes(".buildkite") || files.includes("tooling/release"))
    profiles.add("release");
  if (profiles.size === 0) profiles.add("docs");
  return [...profiles].sort();
};

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const required = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) throw new Error(message);
  return value;
};

const taskBlocks = (
  plan: string,
): Map<string, { body: string; title: string }> => {
  const matches = [...plan.matchAll(/^### (S\d{2}-T\d{2}) — ([^\n]+)\n/gm)];
  const appendix = plan.indexOf("## Appendix A");
  return new Map(
    matches.map((match, index) => {
      const next = matches[index + 1];
      const end = next?.index ?? appendix;
      const taskId = required(match[1], "task heading has no ID");
      const title = required(match[2], `${taskId}: task heading has no title`);
      const start = required(
        match.index,
        `${taskId}: task heading has no offset`,
      );
      return [taskId, { body: plan.slice(start, end), title: title.trim() }];
    }),
  );
};

const acceptanceRows = (
  plan: string,
): Map<string, { dependency: string; sourceLineBudget: number }> => {
  const appendix = plan.slice(
    plan.indexOf("## Appendix A"),
    plan.indexOf("## Appendix B"),
  );
  return new Map(
    appendix
      .split("\n")
      .filter((line) => /^\| S\d{2}-T\d{2} /.test(line))
      .map((line) => {
        const cells = line.split("|").map((cell) => cell.trim());
        const taskId = required(cells[1], "Appendix A row has no task ID");
        const dependency = required(
          cells[2],
          `${taskId}: Appendix A row has no dependency`,
        );
        const sourceLineBudget = Number(
          required(cells[4], `${taskId}: Appendix A row has no source budget`),
        );
        return [taskId, { dependency, sourceLineBudget }] as const;
      }),
  );
};

const fileLocksFor = (body: string): string[] => {
  const files = body.match(/- \*\*Files:\*\*([\s\S]*?)(?=\n- \*\*)/)?.[1] ?? "";
  const locks = new Set<string>();
  for (const match of files.matchAll(/`([^`]+)`/g)) {
    const value = required(match[1], "empty file lock capture").trim();
    if (
      (value.includes("/") || /\.[a-z]+(?:\}|$)/i.test(value)) &&
      !value.includes(" --") &&
      !value.startsWith("http")
    )
      locks.add(value);
  }
  if (
    /generated (?:Confect|Convex)|(?:Confect|Convex).{0,40}generated|confect:codegen/i.test(
      files,
    )
  )
    locks.add("@generated-confect");
  if (/route tree/i.test(files)) locks.add("@route-tree");
  if (/package\.json|pnpm-lock|pnpm-workspace/i.test(files))
    locks.add("@dependencies");
  if (/\.env|env-manifest|project\.config/i.test(files))
    locks.add("@environment");
  return [...locks].sort();
};

export const buildManifest = (root = REPO_ROOT): BrainTaskManifest => {
  const planPath = resolve(root, PLAN_RELATIVE);
  const plan = readFileSync(planPath, "utf8");
  const blocks = taskBlocks(plan);
  const acceptance = acceptanceRows(plan);
  const tasks = [...blocks].map(([taskId, { body, title }]) => {
    const classification = body.match(
      /- \*\*Classification:\*\* `(fixture-to-real|pattern-instance|template-gap)`/,
    )?.[1] as WorkClassification | undefined;
    if (!classification) throw new Error(`${taskId}: missing classification`);
    const fileLocks = fileLocksFor(body);
    const lane = laneFor(taskId);
    const acceptanceContract = acceptance.get(taskId);
    if (!acceptanceContract)
      throw new Error(`${taskId}: missing Appendix A acceptance row`);
    const requirements = [
      ...new Set(
        body
          .match(
            /- \*\*Outcome \/ requirements:\*\*([\s\S]*?)(?=\n- \*\*)/,
          )?.[1]
          ?.match(/\b(?:FND|IAM|UI|SLK|ZFC|AI|KNW|HLS|REL)-\d{2}\b/g) ?? [],
      ),
    ].sort();
    return {
      acceptanceAfter: acceptanceContract.dependency,
      classification,
      codeStartAfter: START_OVERRIDES[taskId] ?? [],
      fileLocks,
      gateProfiles: inferProfiles(taskId, lane, fileLocks),
      kind:
        taskId === "S00-T01"
          ? "external"
          : taskId === "S00-T02"
            ? "docs"
            : taskId === "S14-T01"
              ? "release"
              : "product",
      lane,
      requirements,
      sourceLineBudget: acceptanceContract.sourceLineBudget,
      taskBlockHash: hash(body),
      taskId,
      title,
      tranche: trancheFor(taskId),
    } satisfies BrainTaskContract;
  });
  return {
    planPath: PLAN_RELATIVE,
    planSha256: hash(plan),
    schemaVersion: "maestro-brain-task-manifest/v1",
    tasks,
  };
};

export const validateManifest = (manifest: BrainTaskManifest): string[] => {
  const errors: string[] = [];
  const ids = new Set(manifest.tasks.map((task) => task.taskId));
  if (manifest.tasks.length !== 56)
    errors.push(`expected 56 tasks, got ${manifest.tasks.length}`);
  if (ids.size !== manifest.tasks.length) errors.push("duplicate task IDs");
  for (const task of manifest.tasks) {
    if (task.lane === "unknown") errors.push(`${task.taskId}: unknown lane`);
    if (task.acceptanceAfter === "unknown")
      errors.push(`${task.taskId}: no acceptance prerequisite`);
    if (
      !Number.isInteger(task.sourceLineBudget) ||
      task.sourceLineBudget < 0 ||
      task.sourceLineBudget > 300
    )
      errors.push(
        `${task.taskId}: invalid source-line budget ${task.sourceLineBudget}`,
      );
    if (task.fileLocks.length === 0 && task.kind === "product")
      errors.push(`${task.taskId}: no file locks`);
    for (const dependency of task.codeStartAfter)
      if (!ids.has(dependency))
        errors.push(
          `${task.taskId}: unknown code-start dependency ${dependency}`,
        );
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(manifest.tasks.map((task) => [task.taskId, task]));
  const visit = (taskId: string): void => {
    if (visiting.has(taskId)) {
      errors.push(`${taskId}: code-start dependency cycle`);
      return;
    }
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dependency of byId.get(taskId)?.codeStartAfter ?? [])
      visit(dependency);
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const task of manifest.tasks) visit(task.taskId);
  return [...new Set(errors)];
};

export const readyWidth = (manifest: BrainTaskManifest): number => {
  const depths = new Map<string, number>();
  const byId = new Map(manifest.tasks.map((task) => [task.taskId, task]));
  const depth = (taskId: string): number => {
    const known = depths.get(taskId);
    if (known !== undefined) return known;
    const dependencies = byId.get(taskId)?.codeStartAfter ?? [];
    const value =
      dependencies.length === 0 ? 0 : 1 + Math.max(...dependencies.map(depth));
    depths.set(taskId, value);
    return value;
  };
  const widths = new Map<number, number>();
  for (const task of manifest.tasks) {
    const level = depth(task.taskId);
    widths.set(level, (widths.get(level) ?? 0) + 1);
  }
  return Math.max(...widths.values());
};
