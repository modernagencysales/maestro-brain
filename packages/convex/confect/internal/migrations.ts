import { Migrations } from "@convex-dev/migrations";
import { ConvexError } from "convex/values";
import * as Schema from "effect/Schema";

import schema from "../../convex/schema";
import { components } from "../../convex/_generated/api";
import {
  deriveStableAgencyKey,
  deriveStableBrainKey,
} from "../identity/stableKeys";
import { sha256Hex } from "../shared/sha256";
import {
  type AcquireLeaseResult,
  type CountProvenance,
  type ExecuteMigrationArgs,
  type MigrationMode,
  MigrationBatchReceipt,
  MigrationParentReceipt,
} from "./migrations.spec";

export const componentMigrations = new Migrations(components.migrations, {
  schema,
});

export const probeExpand = componentMigrations.define({
  table: "migrationRuns",
  batchSize: 2,
  migrateOne: async (ctx, row) => {
    if (row.migrationName !== "probe-target") return;
    if (row.actor === "inject-component-failure") {
      throw new Error("injected production component failure");
    }
    if (row.schemaAfter === "sha256:after") return;
    await ctx.db.patch(row._id, {
      schemaAfter: "sha256:after",
      probeWriteCount: (row.probeWriteCount ?? 0) + 1,
      ...(row.actor === "inject-post-component-crash"
        ? { actor: "write-count:1" }
        : {}),
    });
  },
});

export const stableTenantOrganizationKeysExpand = componentMigrations.define({
  table: "organizations",
  batchSize: 100,
  migrateOne: async (ctx, row) => {
    if (row.agencyKey !== undefined) return;
    await ctx.db.patch(row._id, {
      agencyKey: deriveStableAgencyKey(row._id),
      lifecycleGeneration: row.lifecycleGeneration ?? 0,
      revocationGeneration: row.revocationGeneration ?? 0,
    });
  },
});

export const stableTenantWorkspaceKeysExpand = componentMigrations.define({
  table: "workspaces",
  batchSize: 100,
  migrateOne: async (ctx, row) => {
    if (row.brainKey !== undefined) return;
    await ctx.db.patch(row._id, {
      brainKey: deriveStableBrainKey(row._id),
      kind: row.kind ?? "agency",
      lifecycleGeneration: row.lifecycleGeneration ?? 0,
      revocationGeneration: row.revocationGeneration ?? 0,
    });
  },
});

export const probeFail = componentMigrations.define({
  table: "migrationRuns",
  batchSize: 2,
  migrateOne: async () => {
    throw new Error("unknown probe failure");
  },
});

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const stableJson = (value: JsonValue): string => {
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

export const canonicalReceiptHash = (value: JsonValue): string =>
  `sha256:${sha256Hex(stableJson(value))}`;

export const batchReceiptJson = (receipt: MigrationBatchReceipt): JsonValue =>
  Schema.encodeSync(MigrationBatchReceipt)(receipt) as JsonValue;
export const parentReceiptJson = (receipt: MigrationParentReceipt): JsonValue =>
  Schema.encodeSync(MigrationParentReceipt)(receipt) as JsonValue;
export const childReceiptHash = (receipt: MigrationBatchReceipt): string =>
  canonicalReceiptHash(batchReceiptJson(receipt));
export const parentReceiptHash = (receipt: MigrationParentReceipt): string =>
  canonicalReceiptHash(parentReceiptJson(receipt));

export const releaseParentKey = (runKey: string) =>
  `receipt.${runKey}.release_parent`;
export const failureCheckpointKey = (runKey: string, fenceGeneration: number) =>
  `receipt.${runKey}.${fenceGeneration}.failure_checkpoint`;
export const childReceiptKey = (runKey: string, batchSequence: number) =>
  `receipt.${runKey}.${batchSequence}.child`;

type ParentReceiptInput = Omit<MigrationParentReceipt, "childReceiptHashes"> & {
  readonly parityChecks: readonly string[];
  readonly childReceipts: readonly MigrationBatchReceipt[];
};
export const parentReceipt = (
  input: ParentReceiptInput,
): MigrationParentReceipt =>
  MigrationParentReceipt.make({
    ...input,
    parityChecks: [...input.parityChecks],
    childReceiptHashes: input.childReceipts.map(childReceiptHash),
  });

export type ComponentBatchResult = Readonly<{
  continueCursor: string;
  isDone: boolean;
  processed: number;
}>;

export const componentResultFromDryRun = (
  value: unknown,
): ComponentBatchResult | null => {
  if (!(value instanceof ConvexError)) return null;
  const tagged = value.data as
    { readonly kind?: unknown; readonly result?: unknown } | undefined;
  if (
    tagged?.kind !== "DRY RUN" ||
    !tagged.result ||
    typeof tagged.result !== "object"
  )
    return null;
  const result = tagged.result as Partial<
    Record<"continueCursor" | "isDone" | "processed", unknown>
  >;
  return typeof result.continueCursor === "string" &&
    typeof result.isDone === "boolean" &&
    typeof result.processed === "number"
    ? {
        continueCursor: result.continueCursor,
        isDone: result.isDone,
        processed: result.processed,
      }
    : null;
};

export type MigrationCountSummary = Readonly<{
  scanned: number;
  changed: number | null;
  skipped: number | null;
  failed: number;
  countProvenance: CountProvenance;
}>;
export const runKeyForMigration = (args: ExecuteMigrationArgs): string =>
  `migration.${args.migrationName}.${args.releaseCommit}.${args.schemaBefore}.${args.schemaAfter}.${args.mode}.${args.deploymentId}.${args.buildId}`;

export const unavailableMigrationCounts = (
  scanned: number,
  failed = 0,
): MigrationCountSummary => ({
  scanned,
  changed: null,
  skipped: null,
  failed,
  countProvenance: "unavailable",
});

type BatchReceiptInput = Omit<
  MigrationBatchReceipt,
  | "receiptKey"
  | "stableReleaseParentKey"
  | "scanned"
  | "changed"
  | "skipped"
  | "failed"
  | "countProvenance"
> & { readonly counts: MigrationCountSummary };
export const makeBatchReceipt = (
  input: BatchReceiptInput,
): MigrationBatchReceipt => ({
  ...input,
  ...input.counts,
  receiptKey: childReceiptKey(input.runKey, input.batchSequence),
  stableReleaseParentKey: releaseParentKey(input.runKey),
});

export type Lease = Pick<
  AcquireLeaseResult,
  | "runKey"
  | "cursor"
  | "leaseOwner"
  | "leaseStartedAt"
  | "leaseExpiresAt"
  | "batchSequence"
  | "fenceGeneration"
>;

export const makeSettlementInput = (input: {
  readonly args: ExecuteMigrationArgs;
  readonly lease: Lease;
  readonly mode: MigrationMode;
  readonly nextCursor: string | null;
  readonly complete: boolean;
  readonly processed: number;
  readonly failed?: number;
}) => ({
  ...input.args,
  mode: input.mode,
  expectedLeaseOwner: input.lease.leaseOwner ?? input.args.actor,
  expectedFenceGeneration: input.lease.fenceGeneration,
  expectedLeaseExpiresAt: input.lease.leaseExpiresAt,
  batchStartedAt: input.lease.leaseStartedAt,
  priorCursor: input.lease.cursor,
  nextCursor: input.nextCursor,
  complete: input.complete,
  ...unavailableMigrationCounts(input.processed, input.failed ?? 0),
});

export const completeActionResult = (
  args: ExecuteMigrationArgs,
  lease: AcquireLeaseResult & { readonly childReceiptHash: string },
) => ({
  runKey: lease.runKey,
  migrationName: args.migrationName,
  status: "complete" as const,
  initialCursor: null,
  nextCursor: lease.nextCursor ?? lease.cursor,
  componentCursor: lease.componentCursor ?? null,
  leaseOwner: null,
  batchSequence: lease.batchSequence,
  fenceGeneration: lease.fenceGeneration,
  scanned: lease.scanned ?? 0,
  changed: lease.changed ?? null,
  skipped: lease.skipped ?? null,
  failed: lease.failed ?? 0,
  countProvenance: lease.countProvenance ?? "unavailable",
  childReceiptHash: lease.childReceiptHash,
  parentReceiptHash: lease.parentReceiptHash,
});
