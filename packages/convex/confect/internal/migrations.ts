import { Migrations } from "@convex-dev/migrations";
import { ConvexError } from "convex/values";
import * as Schema from "effect/Schema";

import schema from "../../convex/schema";
import { components } from "../../convex/_generated/api";
import {
  deriveStableAgencyKey,
  deriveStableBrainKey,
  isStableAgencyKey,
  isStableBrainKey,
  stableAgencyKeySeed,
  stableBrainKeySeed,
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
  batchSize: 1,
  migrateOne: async (ctx, row) => {
    if (row.workosOrganizationId !== undefined) {
      const sameWorkos = (await ctx.db.query("organizations").collect()).filter(
        (candidate) =>
          candidate.workosOrganizationId === row.workosOrganizationId,
      );
      if (sameWorkos.some((candidate) => candidate._id !== row._id)) {
        throw new Error("duplicate WorkOS organization binding");
      }
    }
    if (row.agencyKey !== undefined && !isStableAgencyKey(row.agencyKey)) {
      throw new Error("invalid agency key syntax");
    }
    const derivedAgencyKey =
      row.agencyKey ?? deriveStableAgencyKey(stableAgencyKeySeed(row));
    const sameAgencyKey = (
      await ctx.db.query("organizations").collect()
    ).filter((candidate) => candidate.agencyKey === derivedAgencyKey);
    if (sameAgencyKey.some((candidate) => candidate._id !== row._id)) {
      throw new Error("duplicate agency key binding");
    }
    const patch = {
      ...(row.agencyKey === undefined ? { agencyKey: derivedAgencyKey } : {}),
      ...(row.lifecycleGeneration === undefined
        ? { lifecycleGeneration: 0 }
        : {}),
      ...(row.revocationGeneration === undefined
        ? { revocationGeneration: 0 }
        : {}),
    };
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(row._id, patch);
  },
});

export const slackIdentityBindingsExpand = {
  table: "slackIdentityBindings",
  mode: "expand",
  batches: "new-table-no-backfill",
} as const;

export const stableTenantWorkspaceKeysExpand = componentMigrations.define({
  table: "workspaces",
  batchSize: 1,
  migrateOne: async (ctx, row) => {
    if (row.brainKey !== undefined && !isStableBrainKey(row.brainKey)) {
      throw new Error("invalid Brain key syntax");
    }
    const derivedBrainKey =
      row.brainKey ?? deriveStableBrainKey(stableBrainKeySeed(row));
    const sameBrainKey = (await ctx.db.query("workspaces").collect()).filter(
      (candidate) =>
        candidate.organizationId === row.organizationId &&
        candidate.brainKey === derivedBrainKey,
    );
    if (sameBrainKey.some((candidate) => candidate._id !== row._id)) {
      throw new Error("duplicate organization Brain key binding");
    }
    const patch = {
      ...(row.brainKey === undefined ? { brainKey: derivedBrainKey } : {}),
      ...(row.kind === undefined ? { kind: "agency" as const } : {}),
      ...(row.lifecycleGeneration === undefined
        ? { lifecycleGeneration: 0 }
        : {}),
      ...(row.revocationGeneration === undefined
        ? { revocationGeneration: 0 }
        : {}),
    };
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(row._id, patch);
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
  changed?: number;
  skipped?: number;
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
    Record<
      "continueCursor" | "isDone" | "processed" | "changed" | "skipped",
      unknown
    >
  >;
  return typeof result.continueCursor === "string" &&
    typeof result.isDone === "boolean" &&
    typeof result.processed === "number"
    ? {
        continueCursor: result.continueCursor,
        isDone: result.isDone,
        processed: result.processed,
        ...(typeof result.changed === "number"
          ? { changed: result.changed }
          : {}),
        ...(typeof result.skipped === "number"
          ? { skipped: result.skipped }
          : {}),
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
  readonly changed?: number | undefined;
  readonly skipped?: number | undefined;
  readonly failed?: number;
  readonly hasExactExecuteCounters?: boolean | undefined;
}) => {
  const failed = input.failed ?? 0;
  const counts =
    input.hasExactExecuteCounters !== true ||
    input.changed === undefined ||
    input.skipped === undefined
      ? unavailableMigrationCounts(input.processed, failed)
      : {
          scanned: input.processed,
          changed: input.changed,
          skipped: input.skipped,
          failed,
          countProvenance: "component" as const,
        };
  return {
    ...input.args,
    mode: input.mode,
    expectedLeaseOwner: input.lease.leaseOwner ?? input.args.actor,
    expectedFenceGeneration: input.lease.fenceGeneration,
    expectedLeaseExpiresAt: input.lease.leaseExpiresAt,
    batchStartedAt: input.lease.leaseStartedAt,
    priorCursor: input.lease.cursor,
    nextCursor: input.nextCursor,
    complete: input.complete,
    ...counts,
  };
};

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
