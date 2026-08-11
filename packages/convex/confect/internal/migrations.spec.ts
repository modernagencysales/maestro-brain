import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  legacyApiKeysInertExpand,
  probeExpand,
  probeFail,
  stableTenantOrganizationKeysExpand,
  stableTenantWorkspaceKeysExpand,
} from "./migrations";
const NonEmpty = Schema.String.pipe(Schema.minLength(1));
const MigrationNameField = { migrationName: Schema.String };
export class MigrationNotFound extends Schema.TaggedError<MigrationNotFound>()(
  "MigrationNotFound",
  MigrationNameField,
) {}
export class MigrationAlreadyRunning extends Schema.TaggedError<MigrationAlreadyRunning>()(
  "MigrationAlreadyRunning",
  { ...MigrationNameField, leaseOwner: Schema.String },
) {}
export class MigrationCursorInvalid extends Schema.TaggedError<MigrationCursorInvalid>()(
  "MigrationCursorInvalid",
  { ...MigrationNameField, reason: Schema.String },
) {}
export class MigrationBatchFailed extends Schema.TaggedError<MigrationBatchFailed>()(
  "MigrationBatchFailed",
  {
    ...MigrationNameField,
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
export const MigrationMode = Schema.Literal("execute", "dryRun");
export type MigrationMode = Schema.Schema.Type<typeof MigrationMode>;
export const CountProvenance = Schema.Literal(
  "component",
  "definition",
  "unavailable",
);
export type CountProvenance = Schema.Schema.Type<typeof CountProvenance>;
const MigrationIdentityFields = {
  migrationName: NonEmpty,
  releaseCommit: NonEmpty,
  schemaBefore: NonEmpty,
  schemaAfter: NonEmpty,
  actor: NonEmpty,
  deploymentId: NonEmpty,
  buildId: NonEmpty,
};
const ModeAndBatchFields = {
  mode: Schema.optionalWith(MigrationMode, {
    default: () => "execute" as const,
  }),
  batchSize: Schema.Number,
};
const ForbiddenCallerControls = {
  cursor: Schema.optional(Schema.String),
  reset: Schema.optional(Schema.Boolean),
  next: Schema.optional(Schema.Array(Schema.String)),
};
export const ExecuteMigrationArgs = Schema.Struct({
  ...MigrationIdentityFields,
  ...ModeAndBatchFields,
  ...ForbiddenCallerControls,
});
export type ExecuteMigrationArgs = Schema.Schema.Type<
  typeof ExecuteMigrationArgs
>;
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
  changed: Schema.NullOr(Schema.Number),
  skipped: Schema.NullOr(Schema.Number),
  failed: Schema.Number,
  countProvenance: CountProvenance,
  childReceiptHash: Schema.String,
  parentReceiptHash: Schema.optional(Schema.String),
});
export const MigrationBatchReceipt = Schema.Struct({
  receiptKey: Schema.String,
  stableReleaseParentKey: Schema.String,
  migrationName: Schema.String,
  mode: MigrationMode,
  priorCursor: Schema.NullOr(Schema.String),
  nextCursor: Schema.NullOr(Schema.String),
  runKey: Schema.String,
  batchSequence: Schema.Number,
  fenceGeneration: Schema.Number,
  actor: Schema.String,
  deploymentId: Schema.String,
  buildId: Schema.String,
  scanned: Schema.Number,
  changed: Schema.NullOr(Schema.Number),
  skipped: Schema.NullOr(Schema.Number),
  failed: Schema.Number,
  countProvenance: CountProvenance,
  complete: Schema.Boolean,
  startedAt: Schema.Number,
  finishedAt: Schema.Number,
});
export type MigrationBatchReceipt = Schema.Schema.Type<
  typeof MigrationBatchReceipt
>;
export const MigrationParentReceipt = Schema.Struct({
  receiptKey: Schema.String,
  runKey: Schema.String,
  migrationName: Schema.String,
  mode: MigrationMode,
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
const reservedMigrations = new Set([
  "future.agencyKeys.expand",
  "future.brainPageKeys.backfill",
  "future.sourceLedger.contract",
  "probe.contract",
]);
const probeSafe = {
  phase: "expand",
  hasExactExecuteCounters: false,
  dryRunSafety: "probeSafeNonSensitive",
  rollbackOwner: "platform-migrations",
  observationWindowMs: 5 * 60_000,
} as const;
const stableTenantExpand = {
  phase: "expand",
  hasExactExecuteCounters: true,
  dryRunSafety: "patchedNoRawDocumentLogs",
  rollbackOwner: "identity-tenancy",
  observationWindowMs: 24 * 60 * 60_000,
} as const;
const legacyApiKeysExpand = {
  phase: "expand",
  hasExactExecuteCounters: true,
  dryRunSafety: "patchedNoRawDocumentLogs",
  rollbackOwner: "headless-auth",
  observationWindowMs: 24 * 60 * 60_000,
} as const;
export const executableMigrations = {
  "probe.expand": probeSafe,
  "probe.fail": probeSafe,
  "legacyApiKeys.inert.expand": legacyApiKeysExpand,
  "stableTenant.organizationKeys.expand": stableTenantExpand,
  "stableTenant.workspaceKeys.expand": stableTenantExpand,
} as const;
type ExecutableMigrationDefinition =
  (typeof executableMigrations)[keyof typeof executableMigrations];
const forbiddenControls = [
  ["cursor", "caller cursor is forbidden"],
  ["reset", "reset is forbidden"],
  ["next", "next is forbidden"],
] as const;
export const findExecutableMigration = (
  migrationName: string,
): Effect.Effect<ExecutableMigrationDefinition, MigrationNotFound> => {
  const entry = reservedMigrations.has(migrationName)
    ? undefined
    : executableMigrations[migrationName as keyof typeof executableMigrations];
  return entry === undefined
    ? Effect.fail(new MigrationNotFound({ migrationName }))
    : Effect.succeed(entry);
};
export const validateExecuteRequest = (input: unknown) =>
  Effect.gen(function* () {
    const args = yield* Schema.decodeUnknown(ExecuteMigrationArgs)(input).pipe(
      Effect.mapError(
        () =>
          new MigrationCursorInvalid({
            migrationName: "<decode>",
            reason: "invalid migration request shape",
          }),
      ),
    );
    yield* findExecutableMigration(args.migrationName);
    const invalid = forbiddenControls.find(([key]) => args[key] !== undefined);
    if (invalid !== undefined)
      return yield* new MigrationCursorInvalid({
        migrationName: args.migrationName,
        reason: invalid[1],
      });
    if (
      !Number.isInteger(args.batchSize) ||
      args.batchSize < 1 ||
      args.batchSize > 100
    )
      return yield* new MigrationCursorInvalid({
        migrationName: args.migrationName,
        reason: "batch size must be 1..100",
      });
    return { ...args, initialCursor: null as null };
  });
export type ValidatedExecuteMigrationArgs = ExecuteMigrationArgs & {
  readonly initialCursor: null;
};
export const makeInitialRun = (input: ExecuteMigrationArgs, now: number) => ({
  runKey: `migration.${input.migrationName}.${input.releaseCommit}`,
  migrationName: input.migrationName,
  releaseCommit: input.releaseCommit,
  schemaBefore: input.schemaBefore,
  schemaAfter: input.schemaAfter,
  mode: input.mode,
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
  changed: Schema.optional(Schema.NullOr(Schema.Number)),
  skipped: Schema.optional(Schema.NullOr(Schema.Number)),
  failed: Schema.optional(Schema.Number),
  countProvenance: Schema.optional(CountProvenance),
  childReceiptHash: Schema.optional(Schema.String),
  parentReceiptHash: Schema.optional(Schema.String),
});
export type AcquireLeaseResult = Schema.Schema.Type<typeof AcquireLeaseResult>;
export const SettleBatchArgs = Schema.Struct({
  ...MigrationIdentityFields,
  mode: MigrationMode,
  batchSize: Schema.Number,
  expectedLeaseOwner: NonEmpty,
  expectedFenceGeneration: Schema.Number,
  expectedLeaseExpiresAt: Schema.Number,
  batchStartedAt: Schema.Number,
  priorCursor: Schema.NullOr(Schema.String),
  nextCursor: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
  scanned: Schema.Number,
  changed: Schema.NullOr(Schema.Number),
  skipped: Schema.NullOr(Schema.Number),
  failed: Schema.Number,
  countProvenance: CountProvenance,
});
const runRegisteredMigration = FunctionSpec.internalAction({
  name: "runRegisteredMigration",
  args: () => ExecuteMigrationArgs,
  returns: () => ExecuteMigrationResult,
  error: () => MigrationError,
});
const internalMutation = FunctionSpec.internalMutation;
const acquireLease = internalMutation({
  name: "acquireLease",
  args: () => AcquireLeaseArgs,
  returns: () => AcquireLeaseResult,
  error: () => MigrationError,
});
const maybeCrashAfterComponent = internalMutation({
  name: "maybeCrashAfterComponent",
  args: () =>
    Schema.extend(
      ExecuteMigrationArgs,
      Schema.Struct({ fenceGeneration: Schema.Number }),
    ),
  returns: () => Schema.Struct({ crashed: Schema.Boolean }),
  error: () => MigrationError,
});
const settleBatch = internalMutation({
  name: "settleBatch",
  args: () => SettleBatchArgs,
  returns: () => ExecuteMigrationResult,
  error: () => MigrationError,
});
const componentMutation = FunctionSpec.convexInternalMutation;
export default GroupSpec.make()
  .addFunction(componentMutation<typeof probeExpand>()("probeExpand"))
  .addFunction(componentMutation<typeof probeFail>()("probeFail"))
  .addFunction(
    componentMutation<typeof legacyApiKeysInertExpand>()(
      "legacyApiKeysInertExpand",
    ),
  )
  .addFunction(
    componentMutation<typeof stableTenantOrganizationKeysExpand>()(
      "stableTenantOrganizationKeysExpand",
    ),
  )
  .addFunction(
    componentMutation<typeof stableTenantWorkspaceKeysExpand>()(
      "stableTenantWorkspaceKeysExpand",
    ),
  )
  .addFunction(runRegisteredMigration)
  .addFunction(acquireLease)
  .addFunction(maybeCrashAfterComponent)
  .addFunction(settleBatch);
