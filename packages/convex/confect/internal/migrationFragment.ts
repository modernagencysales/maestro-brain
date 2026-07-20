import * as Schema from "effect/Schema";

export const MigrationPhase = Schema.Literal(
  "expand",
  "backfill",
  "verify",
  "contract",
);
export type MigrationPhase = typeof MigrationPhase.Type;

export const MigrationFragment = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  taskId: Schema.String.pipe(Schema.pattern(/^S\d{2}-T\d{2}$/)),
  taskBlockHash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
  phase: MigrationPhase,
  migrations: Schema.Array(Schema.String),
  implementationModule: Schema.NullOr(Schema.String),
  dependsOn: Schema.Array(Schema.String),
  attestation: Schema.optional(Schema.String),
});
export type MigrationFragment = typeof MigrationFragment.Type;

const expectedTaskHashes: Record<string, string> = {
  "S00-T04": "14cb8f5699f656208b9a51eddb200035dfecef8159e0499a6099c3f545b2a613",
  "S01-T02": "f8dfea31b91e435c11203c1641f2b5fd1cefe5e966e26f4ba105b1e7088d7204",
  "S02-T01": "dc205e57f25f69ecba7f6237744e0ce28cd01e3fab0c6cf506b7d0d7906cf6c9",
  "S02-T03": "05e6e953af2e5fb125d0148d86d3b93a8488961fde0c7c29cb454d7d9170f5a1",
  "S05-T01": "af261b6e29dd92ad219255c8f0c731b09c5fd346780621976cb1693aa8d991cf",
};
const phaseRank: Record<MigrationPhase, number> = {
  expand: 0,
  backfill: 1,
  verify: 2,
  contract: 3,
};
const unsafeModule = (value: string | null) =>
  value !== null &&
  !/^\.\.\/migration-implementations\/S\d{2}-T\d{2}$/.test(value);

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const allowedKeys = new Set([
  "schemaVersion",
  "taskId",
  "taskBlockHash",
  "phase",
  "migrations",
  "implementationModule",
  "dependsOn",
  "attestation",
]);
const parseJsonObjectWithUniqueKeys = (value: string): unknown => {
  const seen = new Set<string>();
  const keyPattern = /(?:^|[{,])\s*"((?:\\.|[^"\\])*)"\s*:/g;
  for (const match of value.matchAll(keyPattern)) {
    const key = JSON.parse(`"${match[1]}"`) as string;
    if (seen.has(key)) throw new Error("duplicate JSON key");
    seen.add(key);
  }
  return JSON.parse(value);
};

export const decodeMigrationFragment = (value: unknown) => {
  const fragment =
    typeof value === "string" ? parseJsonObjectWithUniqueKeys(value) : value;
  if (!fragment || typeof fragment !== "object" || Array.isArray(fragment))
    throw new Error("invalid migration fragment");
  for (const key of Object.keys(fragment))
    if (!allowedKeys.has(key))
      throw new Error("unknown migration fragment field");
  return MigrationFragment.make(fragment as MigrationFragment);
};
export const assembleMigrationRegistry = (input: readonly unknown[]) => {
  const fragments = input.map(decodeMigrationFragment);
  const byTask = new Map<string, MigrationFragment>();
  const migrations = new Set<string>();
  for (const fragment of fragments) {
    if (byTask.has(fragment.taskId)) throw new Error("duplicate migration id");
    byTask.set(fragment.taskId, fragment);
    if (expectedTaskHashes[fragment.taskId] !== fragment.taskBlockHash)
      throw new Error("task-hash drift");
    if (unsafeModule(fragment.implementationModule))
      throw new Error("unsafe migration implementation path");
    for (const migration of fragment.migrations) {
      if (migration.includes("noop") || migration.includes("fake"))
        throw new Error("fake no-op migration");
      if (migrations.has(migration)) throw new Error("duplicate migration id");
      migrations.add(migration);
    }
  }
  const taskPhaseOrder = [...fragments].sort((a, b) =>
    a.taskId.localeCompare(b.taskId),
  );
  let previousPhase: MigrationPhase | undefined;
  for (const fragment of taskPhaseOrder) {
    if (
      previousPhase !== undefined &&
      phaseRank[previousPhase] > phaseRank[fragment.phase]
    )
      throw new Error("phase order");
    previousPhase = fragment.phase;
  }
  for (const fragment of fragments) {
    for (const dependency of fragment.dependsOn) {
      const parent = byTask.get(dependency);
      if (!parent) throw new Error("dangling dependency");
      if (phaseRank[parent.phase] > phaseRank[fragment.phase])
        throw new Error("phase-inverted dependency");
    }
  }
  const temporary = new Set<string>();
  const permanent = new Set<string>();
  const ordered: MigrationFragment[] = [];
  const visit = (taskId: string) => {
    if (permanent.has(taskId)) return;
    if (temporary.has(taskId)) throw new Error("cycle");
    temporary.add(taskId);
    const fragment = byTask.get(taskId);
    if (!fragment) throw new Error("dangling dependency");
    for (const dependency of [...fragment.dependsOn].sort()) visit(dependency);
    temporary.delete(taskId);
    permanent.add(taskId);
    ordered.push(fragment);
  };
  for (const taskId of [...byTask.keys()].sort()) visit(taskId);
  const bytes = `${canonicalJson({
    schemaVersion: 1,
    fragments: ordered.map((fragment) => ({
      taskId: fragment.taskId,
      phase: fragment.phase,
      migrations: fragment.migrations,
      implementationModule: fragment.implementationModule,
      attestation: fragment.attestation ?? null,
    })),
  })}\n`;
  return { taskIds: ordered.map((fragment) => fragment.taskId), bytes };
};
