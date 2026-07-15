import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import type { probeExpand, probeFail } from "./migrations";

const NonEmpty = Schema.String.pipe(Schema.minLength(1));
const PositiveBatchSize = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
  Schema.lessThanOrEqualTo(100),
);

export class MigrationNotFound extends Schema.TaggedError<MigrationNotFound>()(
  "MigrationNotFound",
  { migrationName: Schema.String },
) {}

export class MigrationAlreadyRunning extends Schema.TaggedError<MigrationAlreadyRunning>()(
  "MigrationAlreadyRunning",
  { migrationName: Schema.String, leaseOwner: Schema.String },
) {}

export class MigrationCursorInvalid extends Schema.TaggedError<MigrationCursorInvalid>()(
  "MigrationCursorInvalid",
  { migrationName: Schema.String, reason: Schema.String },
) {}

export class MigrationBatchFailed extends Schema.TaggedError<MigrationBatchFailed>()(
  "MigrationBatchFailed",
  {
    migrationName: Schema.String,
    batchSequence: Schema.Number,
    failed: Schema.Number,
  },
) {}

export const MigrationError = Schema.Union(
  MigrationNotFound,
  MigrationAlreadyRunning,
  MigrationCursorInvalid,
  MigrationBatchFailed,
);

export const MigrationPhase = Schema.Literal("expand", "backfill", "contract");
export type MigrationPhase = Schema.Schema.Type<typeof MigrationPhase>;

export const MigrationMode = Schema.Literal("execute", "dryRun");
export type MigrationMode = Schema.Schema.Type<typeof MigrationMode>;

export const ExecuteMigrationArgs = Schema.Struct({
  migrationName: NonEmpty,
  releaseCommit: NonEmpty,
  schemaBefore: NonEmpty,
  schemaAfter: NonEmpty,
  actor: NonEmpty,
  deploymentId: NonEmpty,
  buildId: NonEmpty,
  mode: Schema.optionalWith(MigrationMode, {
    default: () => "execute" as const,
  }),
  batchSize: PositiveBatchSize,
  cursor: Schema.optional(Schema.String),
  reset: Schema.optional(Schema.Boolean),
  next: Schema.optional(Schema.Array(Schema.String)),
});

export const ExecuteMigrationResult = Schema.Struct({
  runKey: Schema.String,
  migrationName: Schema.String,
  status: Schema.Literal("running", "complete", "failed", "dryRunComplete"),
  initialCursor: Schema.Null,
  nextCursor: Schema.NullOr(Schema.String),
  componentCursor: Schema.NullOr(Schema.String),
  leaseOwner: Schema.NullOr(Schema.String),
  batchSequence: Schema.Number,
  fenceGeneration: Schema.Number,
  scanned: Schema.Number,
  changed: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
  childReceiptHash: Schema.String,
  parentReceiptHash: Schema.optional(Schema.String),
});

export const MigrationBatchReceipt = Schema.Struct({
  migrationName: Schema.String,
  mode: MigrationMode,
  cursor: Schema.NullOr(Schema.String),
  priorCursor: Schema.NullOr(Schema.String),
  nextCursor: Schema.NullOr(Schema.String),
  runKey: Schema.String,
  batchSequence: Schema.Number,
  fenceGeneration: Schema.Number,
  actor: Schema.String,
  deploymentId: Schema.String,
  buildId: Schema.String,
  scanned: Schema.Number,
  changed: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
  complete: Schema.Boolean,
  startedAt: Schema.Number,
  finishedAt: Schema.Number,
});
export type MigrationBatchReceipt = Schema.Schema.Type<
  typeof MigrationBatchReceipt
>;

export const MigrationParentReceipt = Schema.Struct({
  runKey: Schema.String,
  migrationName: Schema.String,
  releaseCommit: Schema.String,
  schemaBefore: Schema.String,
  schemaAfter: Schema.String,
  parityChecks: Schema.Array(Schema.String),
  rollbackOwner: Schema.String,
  observationEndsAt: Schema.Number,
  actor: Schema.String,
  deploymentId: Schema.String,
  buildId: Schema.String,
  fenceGeneration: Schema.Number,
  cursor: Schema.NullOr(Schema.String),
  batchSequence: Schema.Number,
  batchSize: Schema.Number,
  childReceiptHashes: Schema.Array(Schema.String),
  complete: Schema.Boolean,
});
export type MigrationParentReceipt = Schema.Schema.Type<
  typeof MigrationParentReceipt
>;

export const executableMigrations = {
  "probe.expand": {
    phase: "expand" as MigrationPhase,
    componentFunction: "internal/migrations:probeExpand",
  },
  "probe.fail": {
    phase: "expand" as MigrationPhase,
    componentFunction: "internal/migrations:probeFail",
  },
} as const;

const reservedMigrations = new Set([
  "future.agencyKeys.expand",
  "future.brainPageKeys.backfill",
  "future.sourceLedger.contract",
]);

export const assertExecutableMigration = (migrationName: string) => {
  if (reservedMigrations.has(migrationName)) {
    throw new MigrationNotFound({ migrationName });
  }
  const entry =
    executableMigrations[migrationName as keyof typeof executableMigrations];
  if (!entry || entry.phase === ("contract" as MigrationPhase)) {
    throw new MigrationNotFound({ migrationName });
  }
  return entry;
};

export const validateExecuteRequest = (input: unknown) => {
  const args = Schema.decodeUnknownSync(ExecuteMigrationArgs)(input);
  assertExecutableMigration(args.migrationName);
  if (args.cursor !== undefined) {
    throw new MigrationCursorInvalid({
      migrationName: args.migrationName,
      reason: "caller cursor is forbidden",
    });
  }
  if (args.reset === true) {
    throw new MigrationCursorInvalid({
      migrationName: args.migrationName,
      reason: "reset is forbidden",
    });
  }
  if (args.next !== undefined) {
    throw new MigrationCursorInvalid({
      migrationName: args.migrationName,
      reason: "next is forbidden",
    });
  }
  return { ...args, initialCursor: null as null };
};

export const makeInitialRun = (
  input: Schema.Schema.Type<typeof ExecuteMigrationArgs>,
  now: number,
) => ({
  runKey: `migration.${input.migrationName}.${input.releaseCommit}`,
  migrationName: input.migrationName,
  releaseCommit: input.releaseCommit,
  schemaBefore: input.schemaBefore,
  schemaAfter: input.schemaAfter,
  status: "planned" as const,
  cursor: null,
  leaseOwner: null,
  leaseStartedAt: null,
  leaseExpiresAt: null,
  fenceGeneration: 0,
  lastCommittedBatchSequence: 0,
  actor: input.actor,
  deploymentId: input.deploymentId,
  buildId: input.buildId,
  createdAt: now,
  updatedAt: now,
});

export const nextFenceGeneration = (
  run: Omit<ReturnType<typeof makeInitialRun>, "status" | "leaseOwner"> & {
    readonly status: "planned" | "running" | "complete" | "failed";
    readonly leaseOwner: string | null;
  },
  leaseOwner: string,
  now: number,
) => {
  if (run.status === "running" && run.leaseOwner !== null) {
    throw new MigrationAlreadyRunning({
      migrationName: run.migrationName,
      leaseOwner: run.leaseOwner,
    });
  }
  if (
    run.status !== "planned" &&
    run.status !== "failed" &&
    !(run.status === "running" && run.leaseOwner === null)
  ) {
    throw new MigrationCursorInvalid({
      migrationName: run.migrationName,
      reason: `cannot resume ${run.status}`,
    });
  }
  return {
    ...run,
    status: "running" as const,
    leaseOwner,
    leaseStartedAt: now,
    fenceGeneration: run.fenceGeneration + 1,
    updatedAt: now,
  };
};

export const recordBatchOutcome = (
  run: Omit<ReturnType<typeof makeInitialRun>, "status"> & {
    readonly status: "planned" | "running" | "complete" | "failed";
  },
  outcome: {
    readonly status: "complete" | "failed" | "running";
    readonly nextCursor: string | null;
    readonly scanned: number;
    readonly changed: number;
    readonly skipped: number;
    readonly failed: number;
    readonly now: number;
  },
) => {
  if (run.status !== "running") {
    throw new MigrationCursorInvalid({
      migrationName: run.migrationName,
      reason: "run is not leased",
    });
  }
  return {
    ...run,
    status: outcome.status,
    cursor: outcome.nextCursor,
    leaseOwner: null,
    leaseStartedAt: null,
    lastCommittedBatchSequence: run.lastCommittedBatchSequence + 1,
    updatedAt: outcome.now,
  };
};

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const stableJson = (value: JsonValue): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableJson((value as { readonly [key: string]: JsonValue })[key] ?? null)}`,
    )
    .join(",")}}`;
};

const rightRotate = (value: number, shift: number): number =>
  (value >>> shift) | (value << (32 - shift));

const sha256Hex = (input: string): string => {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = [...new TextEncoder().encode(input)];
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8)
    bytes.push((bitLength / 2 ** shift) & 0xff);
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = Array<number>(64).fill(0);
    for (let i = 0; i < 16; i += 1) {
      words[i] =
        ((bytes[offset + i * 4]! << 24) |
          (bytes[offset + i * 4 + 1]! << 16) |
          (bytes[offset + i * 4 + 2]! << 8) |
          bytes[offset + i * 4 + 3]!) >>>
        0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 =
        rightRotate(words[i - 15]!, 7) ^
        rightRotate(words[i - 15]!, 18) ^
        (words[i - 15]! >>> 3);
      const s1 =
        rightRotate(words[i - 2]!, 17) ^
        rightRotate(words[i - 2]!, 19) ^
        (words[i - 2]! >>> 10);
      words[i] = (words[i - 16]! + s0 + words[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rightRotate(e!, 6) ^ rightRotate(e!, 11) ^ rightRotate(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + s1 + ch + constants[i]! + words[i]!) >>> 0;
      const s0 = rightRotate(a!, 2) ^ rightRotate(a!, 13) ^ rightRotate(a!, 22);
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => {
      hash[index] = (hash[index]! + value!) >>> 0;
    });
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
};

export const canonicalReceiptHash = (value: JsonValue): string =>
  `sha256:${sha256Hex(stableJson(value))}`;

export const childReceiptHash = (receipt: MigrationBatchReceipt): string =>
  canonicalReceiptHash(receipt as unknown as JsonValue);

export const terminalParentReceipt = (input: {
  readonly runKey: string;
  readonly migrationName: string;
  readonly releaseCommit: string;
  readonly schemaBefore: string;
  readonly schemaAfter: string;
  readonly parityChecks: readonly string[];
  readonly rollbackOwner: string;
  readonly observationEndsAt: number;
  readonly actor: string;
  readonly deploymentId: string;
  readonly buildId: string;
  readonly fenceGeneration: number;
  readonly cursor: string | null;
  readonly batchSequence: number;
  readonly batchSize: number;
  readonly childReceipts: readonly MigrationBatchReceipt[];
}): MigrationParentReceipt => ({
  runKey: input.runKey,
  migrationName: input.migrationName,
  releaseCommit: input.releaseCommit,
  schemaBefore: input.schemaBefore,
  schemaAfter: input.schemaAfter,
  parityChecks: [...input.parityChecks],
  rollbackOwner: input.rollbackOwner,
  observationEndsAt: input.observationEndsAt,
  actor: input.actor,
  deploymentId: input.deploymentId,
  buildId: input.buildId,
  fenceGeneration: input.fenceGeneration,
  cursor: input.cursor,
  batchSequence: input.batchSequence,
  batchSize: input.batchSize,
  childReceiptHashes: input.childReceipts.map(childReceiptHash),
  complete: true,
});

export const AcquireLeaseArgs = Schema.extend(
  ExecuteMigrationArgs,
  Schema.Struct({ leaseOwner: NonEmpty }),
);
export const AcquireLeaseResult = Schema.Struct({
  runKey: Schema.String,
  migrationName: Schema.String,
  cursor: Schema.NullOr(Schema.String),
  leaseOwner: Schema.NullOr(Schema.String),
  leaseStartedAt: Schema.Number,
  leaseExpiresAt: Schema.Number,
  fenceGeneration: Schema.Number,
  batchSequence: Schema.Number,
  status: Schema.optional(Schema.Literal("running", "complete")),
  nextCursor: Schema.optional(Schema.NullOr(Schema.String)),
  componentCursor: Schema.optional(Schema.NullOr(Schema.String)),
  scanned: Schema.optional(Schema.Number),
  changed: Schema.optional(Schema.Number),
  skipped: Schema.optional(Schema.Number),
  failed: Schema.optional(Schema.Number),
  childReceiptHash: Schema.optional(Schema.String),
  parentReceiptHash: Schema.optional(Schema.String),
});
export const SettleBatchArgs = Schema.Struct({
  migrationName: NonEmpty,
  releaseCommit: NonEmpty,
  schemaBefore: NonEmpty,
  schemaAfter: NonEmpty,
  actor: NonEmpty,
  deploymentId: NonEmpty,
  buildId: NonEmpty,
  mode: MigrationMode,
  batchSize: PositiveBatchSize,
  expectedLeaseOwner: NonEmpty,
  expectedFenceGeneration: Schema.Number,
  batchStartedAt: Schema.Number,
  componentCursor: Schema.NullOr(Schema.String),
  nextCursor: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
  scanned: Schema.Number,
  changed: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
});

const runRegisteredMigration = FunctionSpec.internalAction({
  name: "runRegisteredMigration",
  args: () => ExecuteMigrationArgs,
  returns: () => ExecuteMigrationResult,
  error: () => MigrationError,
});
const acquireLease = FunctionSpec.internalMutation({
  name: "acquireLease",
  args: () => AcquireLeaseArgs,
  returns: () => AcquireLeaseResult,
  error: () => MigrationError,
});
const settleBatch = FunctionSpec.internalMutation({
  name: "settleBatch",
  args: () => SettleBatchArgs,
  returns: () => ExecuteMigrationResult,
  error: () => MigrationError,
});

export default GroupSpec.make()
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof probeExpand>()("probeExpand"),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof probeFail>()("probeFail"),
  )
  .addFunction(runRegisteredMigration)
  .addFunction(acquireLease)
  .addFunction(settleBatch);
