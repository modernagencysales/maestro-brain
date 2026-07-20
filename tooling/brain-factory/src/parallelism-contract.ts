import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { BrainTaskManifest } from "./manifest.js";

export const PARALLELISM_CONTRACT_RELATIVE =
  "docs/superpowers/execution/maestro-brain/parallelism-contract.json";
export const TASK_PACKET_PATH =
  "docs/superpowers/plans/2026-07-14-maestro-brain-agency-context-os-implementation-plan.md";

export type DependencyClassification = "true" | "contract";
export type CollisionPolicy =
  | "dependency_order"
  | "serialize"
  | "same_wave_fail_closed"
  | "regenerate"
  | "registry_after_task6";

export interface TaskPacketArtifact {
  readonly kind: "task-packet";
  readonly path: string;
  readonly anchor: string;
  readonly sha256: string;
}

export interface TrueParallelismEdge {
  readonly consumerTaskId: string;
  readonly producerTaskId: string;
  readonly classification: "true";
}

export interface ContractParallelismEdge {
  readonly consumerTaskId: string;
  readonly producerTaskId: string;
  readonly classification: "contract";
  readonly artifact: TaskPacketArtifact;
}

export type ParallelismEdge = TrueParallelismEdge | ContractParallelismEdge;

export interface ParallelismCollision {
  readonly leftTaskId: string;
  readonly rightTaskId: string;
  readonly paths: readonly string[];
  readonly policy: CollisionPolicy;
  readonly mandatorySameWave?: true;
}

export interface ParallelismContract {
  readonly schemaVersion: "maestro-brain-parallelism-contract/v1";
  readonly manifestPlanSha256: string;
  readonly edges: readonly ParallelismEdge[];
  readonly collisions: readonly ParallelismCollision[];
}

const HEX_64 = /^[0-9a-f]{64}$/;
const TASK_ID = /^S\d{2}-T\d{2}$/;
const POLICIES = new Set<CollisionPolicy>([
  "dependency_order",
  "serialize",
  "same_wave_fail_closed",
  "regenerate",
  "registry_after_task6",
]);

const CONTRACT_EDGE_KEYS = new Set(
  `
S01-T02|S00-T04
S02-T02|S01-T03
S03-T02|S01-T03
S03-T03|S02-T02
S03-T03|S02-T04
S03-T04|S02-T03
S04-T01|S00-T03
S04-T01|S01-T02
S04-T04|S03-T01
S05-T01|S04-T02
S05-T02|S04-T03
S05-T04|S04-T04
S06-T03|S05-T02
S07-T01|S01-T02
S07-T01|S02-T01
S07-T02|S05-T02
S07-T03|S06-T01
S07-T04|S03-T01
S08-T03|S05-T03
S08-T03|S07-T01
S08-T04|S02-T03
S08-T04|S07-T01
S09-T02|S02-T02
S09-T02|S07-T01
S09-T03|S02-T03
S09-T04|S08-T01
S10-T02|S09-T04
S10-T04|S03-T01
S11-T02|S01-T02
S11-T02|S01-T03
S11-T02|S01-T04
S11-T02|S02-T02
S11-T03|S09-T04
S12-T02|S07-T01
S12-T02|S11-T02
S12-T03|S03-T01
S13-T01|S08-T04
S13-T01|S09-T04
S13-T01|S11-T03
S13-T02|S06-T02
S13-T02|S11-T04
S13-T03|S06-T02
S13-T03|S08-T01
S13-T03|S11-T04
S13-T03|S12-T02
S13-T04|S03-T01
`
    .trim()
    .split("\n"),
);

const SERIALIZE_PATHS = new Set([
  "packages/convex/confect/access/tenancySchemas.ts",
  "packages/convex/confect/access/auth.ts",
  "packages/convex/confect/access/audit.ts",
  "packages/convex/confect/http.ts",
  "packages/convex/confect/httpRequest.ts",
  "packages/convex/confect/headless/errorEnvelope.ts",
  "packages/convex/confect/manifest/executor.ts",
  "packages/convex/confect/slack/webhook.impl.ts",
  "packages/convex/confect/lifecycle/propagation.ts",
  "packages/convex/confect/answers/deliver.ts",
  "packages/convex/confect/sources/policyDispatch.ts",
]);
const MIGRATION_PATH = "packages/convex/confect/internal/migrations.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, at: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`${at}: expected object`);
  return value;
};

const exactKeys = (
  record: Record<string, unknown>,
  allowed: readonly string[],
  at: string,
): void => {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) throw new Error(`${at}: unknown key ${key}`);
  }
};

const requireString = (value: unknown, at: string): string => {
  if (typeof value !== "string") throw new Error(`${at}: expected string`);
  return value;
};

const parseArtifact = (value: unknown, at: string): TaskPacketArtifact => {
  const artifact = requireRecord(value, at);
  exactKeys(artifact, ["kind", "path", "anchor", "sha256"], at);
  const kind = requireString(artifact.kind, `${at}.kind`);
  if (kind !== "task-packet") throw new Error(`${at}.kind must be task-packet`);
  return {
    kind,
    path: requireString(artifact.path, `${at}.path`),
    anchor: requireString(artifact.anchor, `${at}.anchor`),
    sha256: requireString(artifact.sha256, `${at}.sha256`),
  };
};

const parseEdge = (value: unknown, index: number): ParallelismEdge => {
  const at = `edges[${index}]`;
  const edge = requireRecord(value, at);
  const classification = requireString(
    edge.classification,
    `${at}.classification`,
  );
  if (classification !== "true" && classification !== "contract") {
    throw new Error(`${at}.classification must be true or contract`);
  }
  exactKeys(
    edge,
    classification === "contract"
      ? ["consumerTaskId", "producerTaskId", "classification", "artifact"]
      : ["consumerTaskId", "producerTaskId", "classification"],
    at,
  );
  const base = {
    consumerTaskId: requireString(edge.consumerTaskId, `${at}.consumerTaskId`),
    producerTaskId: requireString(edge.producerTaskId, `${at}.producerTaskId`),
  };
  return classification === "true"
    ? { ...base, classification }
    : {
        ...base,
        classification,
        artifact: parseArtifact(edge.artifact, `${at}.artifact`),
      };
};

const parseCollision = (
  value: unknown,
  index: number,
): ParallelismCollision => {
  const at = `collisions[${index}]`;
  const collision = requireRecord(value, at);
  exactKeys(
    collision,
    ["leftTaskId", "rightTaskId", "paths", "policy", "mandatorySameWave"],
    at,
  );
  if (!Array.isArray(collision.paths))
    throw new Error(`${at}.paths: expected array`);
  const paths = collision.paths.map((path, pathIndex) =>
    requireString(path, `${at}.paths[${pathIndex}]`),
  );
  const policy = requireString(collision.policy, `${at}.policy`);
  if (!POLICIES.has(policy as CollisionPolicy))
    throw new Error(`${at}.policy: unsupported policy ${policy}`);
  if (
    collision.mandatorySameWave !== undefined &&
    collision.mandatorySameWave !== true
  ) {
    throw new Error(`${at}.mandatorySameWave must be true when present`);
  }
  return {
    leftTaskId: requireString(collision.leftTaskId, `${at}.leftTaskId`),
    rightTaskId: requireString(collision.rightTaskId, `${at}.rightTaskId`),
    paths,
    policy: policy as CollisionPolicy,
    ...(collision.mandatorySameWave === true
      ? { mandatorySameWave: true as const }
      : {}),
  };
};

export const parseParallelismContract = (
  value: unknown,
): ParallelismContract => {
  const contract = requireRecord(value, "parallelism contract");
  exactKeys(
    contract,
    ["schemaVersion", "manifestPlanSha256", "edges", "collisions"],
    "parallelism contract",
  );
  if (!Array.isArray(contract.edges))
    throw new Error("parallelism contract.edges: expected array");
  if (!Array.isArray(contract.collisions))
    throw new Error("parallelism contract.collisions: expected array");
  const schemaVersion = requireString(
    contract.schemaVersion,
    "parallelism contract.schemaVersion",
  );
  if (schemaVersion !== "maestro-brain-parallelism-contract/v1") {
    throw new Error(
      `parallelism contract: unsupported schema ${schemaVersion}`,
    );
  }
  return {
    schemaVersion,
    manifestPlanSha256: requireString(
      contract.manifestPlanSha256,
      "parallelism contract.manifestPlanSha256",
    ),
    edges: contract.edges.map(parseEdge),
    collisions: contract.collisions.map(parseCollision),
  };
};

export const loadParallelismContract = (root: string): ParallelismContract =>
  parseParallelismContract(
    JSON.parse(
      readFileSync(resolve(root, PARALLELISM_CONTRACT_RELATIVE), "utf8"),
    ) as unknown,
  );

const edgeKey = (consumerTaskId: string, producerTaskId: string): string =>
  `${consumerTaskId}|${producerTaskId}`;

const collisionKey = (leftTaskId: string, rightTaskId: string): string =>
  leftTaskId < rightTaskId
    ? `${leftTaskId}|${rightTaskId}`
    : `${rightTaskId}|${leftTaskId}`;

export const edgeFor = (
  contract: ParallelismContract,
  consumerTaskId: string,
  producerTaskId: string,
): ParallelismEdge | undefined =>
  contract.edges.find(
    (edge) =>
      edge.consumerTaskId === consumerTaskId &&
      edge.producerTaskId === producerTaskId,
  );

export const collisionFor = (
  contract: ParallelismContract,
  firstTaskId: string,
  secondTaskId: string,
): ParallelismCollision | undefined => {
  const key = collisionKey(firstTaskId, secondTaskId);
  return contract.collisions.find(
    (collision) =>
      collisionKey(collision.leftTaskId, collision.rightTaskId) === key,
  );
};

const trueAdjacency = (
  contract: ParallelismContract,
): Map<string, Set<string>> => {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of contract.edges) {
    if (edge.classification !== "true") continue;
    const consumers = adjacency.get(edge.producerTaskId) ?? new Set<string>();
    consumers.add(edge.consumerTaskId);
    adjacency.set(edge.producerTaskId, consumers);
  }
  return adjacency;
};

const trueOrdered = (
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  producerTaskId: string,
  consumerTaskId: string,
): boolean => {
  const seen = new Set([producerTaskId]);
  const queue = [producerTaskId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const next of adjacency.get(current) ?? []) {
      if (next === consumerTaskId) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
};

const regeneratePath = (path: string): boolean =>
  path === ".env.example" ||
  path === "@environment" ||
  path === "docs/template/env-manifest.json" ||
  path === "docs/template/env-manifest.md" ||
  path === "@dependencies" ||
  path === "pnpm-lock.yaml" ||
  path === "pnpm-workspace.yaml" ||
  path === "package.json" ||
  path.endsWith("/package.json") ||
  path === "docs/template/porting-backlog.md";

const requiredCollisionPolicy = (
  collision: Pick<ParallelismCollision, "leftTaskId" | "rightTaskId" | "paths">,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): CollisionPolicy => {
  if (
    trueOrdered(adjacency, collision.leftTaskId, collision.rightTaskId) ||
    trueOrdered(adjacency, collision.rightTaskId, collision.leftTaskId)
  ) {
    return "dependency_order";
  }
  if (collision.paths.some((path) => SERIALIZE_PATHS.has(path))) {
    return "serialize";
  }
  if (collision.paths.includes(MIGRATION_PATH)) return "registry_after_task6";
  if (collision.paths.some(regeneratePath)) return "regenerate";
  return "same_wave_fail_closed";
};

const sortedUnique = (values: readonly string[]): boolean =>
  values.every(
    (value, index) => index === 0 || (values[index - 1] ?? "") < value,
  );

const findTrueCycle = (
  contract: ParallelismContract,
  taskIds: readonly string[],
): readonly string[] | undefined => {
  const adjacency = trueAdjacency(contract);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (taskId: string): readonly string[] | undefined => {
    visiting.add(taskId);
    path.push(taskId);
    for (const next of [...(adjacency.get(taskId) ?? [])].sort()) {
      if (visiting.has(next)) {
        const start = path.indexOf(next);
        return [...path.slice(start), next];
      }
      if (!visited.has(next)) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    path.pop();
    visiting.delete(taskId);
    visited.add(taskId);
    return undefined;
  };
  for (const taskId of [...taskIds].sort()) {
    if (visited.has(taskId)) continue;
    const cycle = visit(taskId);
    if (cycle) return cycle;
  }
  return undefined;
};

export const validateParallelismContract = (
  contract: ParallelismContract,
  manifest: BrainTaskManifest,
): string[] => {
  const errors: string[] = [];
  const tasks = new Map(manifest.tasks.map((task) => [task.taskId, task]));
  const expectedEdges = new Set(
    manifest.tasks
      .filter((task) => task.kind !== "control")
      .flatMap((task) =>
        task.codeStartAfter.map((producerTaskId) =>
          edgeKey(task.taskId, producerTaskId),
        ),
      ),
  );
  if (contract.schemaVersion !== "maestro-brain-parallelism-contract/v1") {
    errors.push(`unsupported schema ${String(contract.schemaVersion)}`);
  }
  if (contract.manifestPlanSha256 !== manifest.planSha256) {
    errors.push(
      `manifest plan hash ${contract.manifestPlanSha256} does not match ${manifest.planSha256}`,
    );
  }
  if (!HEX_64.test(contract.manifestPlanSha256)) {
    errors.push("manifestPlanSha256 must be 64 lowercase hex characters");
  }

  const edgeCounts = new Map<string, number>();
  for (const [index, edge] of contract.edges.entries()) {
    const key = edgeKey(edge.consumerTaskId, edge.producerTaskId);
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    if (!TASK_ID.test(edge.consumerTaskId) || !tasks.has(edge.consumerTaskId)) {
      errors.push(`${key}: unknown consumer task ${edge.consumerTaskId}`);
    }
    if (!TASK_ID.test(edge.producerTaskId) || !tasks.has(edge.producerTaskId)) {
      errors.push(`${key}: unknown producer task ${edge.producerTaskId}`);
    }
    if (edge.consumerTaskId === edge.producerTaskId) {
      errors.push(`${key}: self-edge is forbidden`);
    }
    if (!expectedEdges.has(key)) {
      const reverse = edgeKey(edge.producerTaskId, edge.consumerTaskId);
      errors.push(
        expectedEdges.has(reverse)
          ? `${key}: reversed edge; manifest declares ${reverse}`
          : `${key}: extra edge absent from manifest`,
      );
    }
    const expectedClassification = CONTRACT_EDGE_KEYS.has(key)
      ? "contract"
      : "true";
    if (edge.classification !== expectedClassification) {
      errors.push(
        `${key}: classification ${edge.classification} does not match frozen ${expectedClassification}`,
      );
    }
    if (edge.classification === "contract") {
      const artifact = edge.artifact;
      const producer = tasks.get(edge.producerTaskId);
      if (!artifact || artifact.kind !== "task-packet") {
        errors.push(
          `${key}: contract edge requires exactly one task-packet artifact`,
        );
      } else {
        if (artifact.path !== TASK_PACKET_PATH)
          errors.push(`${key}: artifact path must be ${TASK_PACKET_PATH}`);
        if (artifact.anchor !== edge.producerTaskId)
          errors.push(`${key}: artifact anchor must be ${edge.producerTaskId}`);
        if (!HEX_64.test(artifact.sha256))
          errors.push(
            `${key}: artifact hash must be 64 lowercase hex characters`,
          );
        if (producer && artifact.sha256 !== producer.taskBlockHash) {
          errors.push(
            `${key}: artifact hash ${artifact.sha256} does not match producer taskBlockHash ${producer.taskBlockHash}`,
          );
        }
      }
    } else if ("artifact" in edge) {
      errors.push(`${key}: true edge must not carry a contract artifact`);
    }
    const prior = contract.edges[index - 1];
    if (prior && edgeKey(prior.consumerTaskId, prior.producerTaskId) >= key) {
      errors.push(
        `${key}: edges must be strictly sorted by consumer and producer`,
      );
    }
  }
  for (const [key, count] of edgeCounts) {
    if (count > 1) errors.push(`${key}: duplicate edge appears ${count} times`);
  }
  for (const key of expectedEdges) {
    if (!edgeCounts.has(key)) errors.push(`${key}: missing edge from contract`);
  }

  const cycle = findTrueCycle(contract, [...tasks.keys()]);
  if (cycle) errors.push(`true-edge cycle: ${cycle.join(" -> ")}`);

  const expectedCollisions = new Map<string, readonly string[]>();
  for (let leftIndex = 0; leftIndex < manifest.tasks.length; leftIndex += 1) {
    const left = manifest.tasks[leftIndex];
    if (!left) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < manifest.tasks.length;
      rightIndex += 1
    ) {
      const right = manifest.tasks[rightIndex];
      if (!right) continue;
      const rightLocks = new Set(right.fileLocks);
      const paths = left.fileLocks
        .filter((path) => rightLocks.has(path))
        .sort();
      if (paths.length > 0)
        expectedCollisions.set(collisionKey(left.taskId, right.taskId), paths);
    }
  }
  const adjacency = trueAdjacency(contract);
  const collisionCounts = new Map<string, number>();
  for (const [index, collision] of contract.collisions.entries()) {
    const key = collisionKey(collision.leftTaskId, collision.rightTaskId);
    collisionCounts.set(key, (collisionCounts.get(key) ?? 0) + 1);
    if (!tasks.has(collision.leftTaskId))
      errors.push(
        `${key}: unknown left collision task ${collision.leftTaskId}`,
      );
    if (!tasks.has(collision.rightTaskId))
      errors.push(
        `${key}: unknown right collision task ${collision.rightTaskId}`,
      );
    if (collision.leftTaskId === collision.rightTaskId)
      errors.push(`${key}: collision self-pair is forbidden`);
    if (collision.leftTaskId > collision.rightTaskId)
      errors.push(`${key}: collision task IDs must be canonical left-to-right`);
    if (!sortedUnique(collision.paths))
      errors.push(`${key}: collision paths must be sorted and unique`);
    const expectedPaths = expectedCollisions.get(key);
    if (!expectedPaths) {
      errors.push(`${key}: extra collision absent from manifest file locks`);
    } else if (
      JSON.stringify(collision.paths) !== JSON.stringify(expectedPaths)
    ) {
      errors.push(
        `${key}: collision paths ${JSON.stringify(collision.paths)} do not match manifest intersection ${JSON.stringify(expectedPaths)}`,
      );
    }
    if (!POLICIES.has(collision.policy))
      errors.push(
        `${key}: unsupported collision policy ${String(collision.policy)}`,
      );
    const requiredPolicy = requiredCollisionPolicy(collision, adjacency);
    if (collision.policy !== requiredPolicy) {
      errors.push(
        `${key}: collision policy ${collision.policy} does not match required ${requiredPolicy}`,
      );
    }
    if (
      collision.policy === "same_wave_fail_closed" &&
      collision.mandatorySameWave !== true
    ) {
      errors.push(
        `${key}: same_wave_fail_closed requires mandatorySameWave=true`,
      );
    }
    if (
      collision.policy !== "same_wave_fail_closed" &&
      collision.mandatorySameWave !== undefined
    ) {
      errors.push(
        `${key}: mandatorySameWave is only valid for same_wave_fail_closed`,
      );
    }
    const prior = contract.collisions[index - 1];
    if (prior && collisionKey(prior.leftTaskId, prior.rightTaskId) >= key) {
      errors.push(`${key}: collisions must be strictly sorted by task pair`);
    }
  }
  for (const [key, count] of collisionCounts) {
    if (count > 1)
      errors.push(`${key}: duplicate collision appears ${count} times`);
  }
  for (const key of expectedCollisions.keys()) {
    if (!collisionCounts.has(key)) errors.push(`${key}: missing collision`);
  }
  return errors;
};

export const effectiveCollisionPolicy = (
  collision: ParallelismCollision,
  task6RegistryReady: boolean,
): Exclude<CollisionPolicy, "registry_after_task6"> => {
  if (collision.policy !== "registry_after_task6") return collision.policy;
  return task6RegistryReady ? "regenerate" : "serialize";
};

export const mandatorySameWaveGroups = (
  contract: ParallelismContract,
): readonly (readonly string[])[] => {
  const adjacency = new Map<string, Set<string>>();
  for (const collision of contract.collisions) {
    if (
      collision.policy !== "same_wave_fail_closed" ||
      collision.mandatorySameWave !== true
    )
      continue;
    const left = adjacency.get(collision.leftTaskId) ?? new Set<string>();
    const right = adjacency.get(collision.rightTaskId) ?? new Set<string>();
    left.add(collision.rightTaskId);
    right.add(collision.leftTaskId);
    adjacency.set(collision.leftTaskId, left);
    adjacency.set(collision.rightTaskId, right);
  }
  const groups: string[][] = [];
  const seen = new Set<string>();
  for (const taskId of [...adjacency.keys()].sort()) {
    if (seen.has(taskId)) continue;
    const group: string[] = [];
    const queue = [taskId];
    seen.add(taskId);
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      group.push(current);
      for (const next of [...(adjacency.get(current) ?? [])].sort()) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    groups.push(group.sort());
  }
  return groups.sort((left, right) =>
    (left[0] ?? "").localeCompare(right[0] ?? ""),
  );
};

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const taskPacketBody = (plan: string, taskId: string): string | undefined => {
  const headings = [...plan.matchAll(/^### (S\d{2}-T\d{2}) — [^\n]+\n/gm)];
  const matchIndex = headings.findIndex((match) => match[1] === taskId);
  if (matchIndex < 0) return undefined;
  const match = headings[matchIndex];
  const start = match?.index;
  if (start === undefined) return undefined;
  const appendix = plan.indexOf("## Appendix A");
  const end = headings[matchIndex + 1]?.index ?? appendix;
  if (end < 0) return undefined;
  return plan.slice(start, end);
};

export const verifyParallelismContractArtifacts = (
  contract: ParallelismContract,
  manifest: BrainTaskManifest,
  root: string,
): string[] => {
  const errors: string[] = [];
  const tasks = new Map(manifest.tasks.map((task) => [task.taskId, task]));
  const planCache = new Map<string, string>();
  const verified = new Set<string>();
  for (const edge of contract.edges) {
    if (edge.classification !== "contract") continue;
    const artifact = edge.artifact;
    const identity = `${edge.producerTaskId}|${artifact.path}|${artifact.anchor}|${artifact.sha256}`;
    if (verified.has(identity)) continue;
    verified.add(identity);
    let plan = planCache.get(artifact.path);
    if (plan === undefined) {
      try {
        plan = readFileSync(resolve(root, artifact.path), "utf8");
        planCache.set(artifact.path, plan);
      } catch (error) {
        errors.push(
          `${edge.producerTaskId}: task-packet ${artifact.path} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
    }
    const body = taskPacketBody(plan, artifact.anchor);
    const actualHash = body === undefined ? undefined : hash(body);
    if (actualHash !== artifact.sha256) {
      errors.push(
        `${edge.producerTaskId}: task-packet ${artifact.path}#${artifact.anchor} hash drift; expected ${artifact.sha256}, got ${actualHash ?? "missing packet"}`,
      );
    }
    const producer = tasks.get(edge.producerTaskId);
    if (producer && artifact.sha256 !== producer.taskBlockHash) {
      errors.push(
        `${edge.producerTaskId}: task-packet artifact hash does not match manifest taskBlockHash ${producer.taskBlockHash}`,
      );
    }
  }
  return errors;
};
