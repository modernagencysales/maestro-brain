import { FunctionSpec, GroupSpec } from "@confect/core";
import * as S from "effect/Schema";
import { Id } from "../_generated/id";
import {
  MemberNotInWorkspace,
  NotFound,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import { BrainEvidenceProvider } from "../tables/brainEvidenceSources";

const AccessError = S.Union([
  Unauthorized,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  ValidationFailed,
]);
const ReadError = S.Union([AccessError, NotFound]);

export const EvidenceCitation = S.Struct({
  entryKey: S.String,
  sourceKey: S.String,
  revisionKey: S.String,
  provider: BrainEvidenceProvider,
  title: S.String,
  excerpt: S.String,
  startOffset: S.Number,
  endOffset: S.Number,
  contentHash: S.String,
  bodyIdentity: S.String,
  locator: S.optional(S.String),
  sourceModifiedAt: S.Number,
  observedAt: S.Number,
  freshness: S.Literals(["current", "review-due", "stale"]),
});

const SearchArgs = S.Struct({
  workspaceId: Id("workspaces"),
  query: S.String,
  limit: S.optional(S.Number),
  asOf: S.Number,
});
const SearchReturns = S.Array(EvidenceCitation);

const CurrentEvidenceSummary = S.Struct({
  entryKey: S.String,
  sourceKey: S.String,
  revisionKey: S.String,
  provider: BrainEvidenceProvider,
  title: S.String,
  excerpt: S.String,
  locator: S.optional(S.String),
  sourceModifiedAt: S.Number,
  observedAt: S.Number,
});
const ListCurrentArgs = S.Struct({
  workspaceId: Id("workspaces"),
  provider: S.optional(BrainEvidenceProvider),
  limit: S.optional(S.Number),
});
const ListCurrentReturns = S.Array(CurrentEvidenceSummary);
const CurrentGetArgs = S.Struct({
  workspaceId: Id("workspaces"),
  entryKey: S.String,
});

const SourceGetArgs = S.Struct({
  workspaceId: Id("workspaces"),
  sourceKey: S.String,
  revisionKey: S.String,
});
const SearchForActorArgs = S.Struct({
  ...SearchArgs.fields,
  userId: Id("users"),
});
const SourceGetForActorArgs = S.Struct({
  ...SourceGetArgs.fields,
  userId: Id("users"),
});
const SourceGetReturns = S.Struct({
  sourceKey: S.String,
  revisionKey: S.String,
  provider: BrainEvidenceProvider,
  scopeKey: S.String,
  title: S.String,
  markdown: S.String,
  contentHash: S.String,
  locator: S.optional(S.String),
  providerMetadataJson: S.optional(S.String),
  providerMetadataHash: S.optional(S.String),
  sourceModifiedAt: S.Number,
  observedAt: S.Number,
  tombstone: S.Boolean,
});

const HealthArgs = S.Struct({
  workspaceId: Id("workspaces"),
});
const HealthForActorArgs = S.Struct({
  ...HealthArgs.fields,
  userId: Id("users"),
});
const HealthReturns = S.Struct({
  countLimit: S.Number,
  providers: S.Array(
    S.Struct({
      provider: BrainEvidenceProvider,
      activeSourceCount: S.Number,
      removedSourceCount: S.Number,
      currentEntryCount: S.Number,
      capacityState: S.Literals(["within-bounds", "exceeded"]),
      coverageState: S.Literals([
        "unknown-capacity-exceeded",
        "no-active-sources",
        "active-sources-not-fully-indexed",
        "current-index-covers-active-sources",
        "current-index-has-extra-entries",
      ]),
      latestSourceModifiedAt: S.NullOr(S.Number),
      latestObservedAt: S.NullOr(S.Number),
      latestIndexedAt: S.NullOr(S.Number),
      lastSuccessfulReconciliationAt: S.NullOr(S.Number),
      freshnessState: S.Literal("unknown-no-policy"),
      lastConnectorRun: S.NullOr(
        S.Struct({
          runKey: S.String,
          scopeKey: S.String,
          status: S.Literals(["running", "complete", "failed"]),
          startedAt: S.Number,
          completedAt: S.optional(S.Number),
          updatedAt: S.Number,
          failureCode: S.optional(S.String),
        }),
      ),
    }),
  ),
});

const PublishInput = {
  workspaceId: Id("workspaces"),
  provider: BrainEvidenceProvider,
  scopeKey: S.String,
  sourceKey: S.String,
  revisionKey: S.String,
  title: S.String,
  markdown: S.String,
  locator: S.optional(S.String),
  providerMetadataJson: S.optional(S.String),
  providerMetadataHash: S.optional(S.String),
  sourceModifiedAt: S.Number,
  observedAt: S.Number,
} as const;

const beginRun = FunctionSpec.internalMutation({
  name: "beginRun",
  args: () =>
    S.Struct({
      workspaceId: Id("workspaces"),
      provider: BrainEvidenceProvider,
      scopeKey: S.String,
      connectionGeneration: S.optional(S.Number),
      runKey: S.String,
      startedAt: S.Number,
    }),
  returns: () => S.Struct({ runKey: S.String }),
  error: () => S.Union([ValidationFailed]),
});

const publishRunItem = FunctionSpec.internalMutation({
  name: "publishRunItem",
  args: () => S.Struct({ ...PublishInput, runKey: S.String }),
  returns: () => S.Struct({ changed: S.Boolean, entryKey: S.String }),
  error: () => S.Union([ValidationFailed, NotFound]),
});

const completeRun = FunctionSpec.internalMutation({
  name: "completeRun",
  args: () =>
    S.Struct({
      workspaceId: Id("workspaces"),
      runKey: S.String,
      discoveredCount: S.Number,
      completedAt: S.Number,
    }),
  returns: () =>
    S.Struct({
      publishedCount: S.Number,
      retiredCount: S.Number,
      completedAt: S.Number,
    }),
  error: () => S.Union([ValidationFailed, NotFound]),
});

const failRun = FunctionSpec.internalMutation({
  name: "failRun",
  args: () =>
    S.Struct({
      workspaceId: Id("workspaces"),
      runKey: S.String,
      failureCode: S.String,
      failedAt: S.Number,
    }),
  returns: () => S.Struct({ runKey: S.String }),
  error: () => S.Union([ValidationFailed, NotFound]),
});

const failActiveScopeRun = FunctionSpec.internalMutation({
  name: "failActiveScopeRun",
  args: () =>
    S.Struct({
      workspaceId: Id("workspaces"),
      provider: BrainEvidenceProvider,
      scopeKey: S.String,
      failureCode: S.String,
      failedAt: S.Number,
    }),
  returns: () => S.Struct({ failedCount: S.Number }),
  error: () => S.Union([ValidationFailed]),
});

const publishPage = FunctionSpec.internalMutation({
  name: "publishPage",
  args: () =>
    S.Struct({
      workspaceId: Id("workspaces"),
      pageId: Id("brainPages"),
    }),
  returns: () => S.Struct({ changed: S.Boolean, entryKey: S.String }),
  error: () => S.Union([ValidationFailed, NotFound]),
});

const search = FunctionSpec.publicQuery({
  name: "search",
  args: () => SearchArgs,
  returns: () => SearchReturns,
  error: () => AccessError,
});

const sourceGet = FunctionSpec.publicQuery({
  name: "sourceGet",
  args: () => SourceGetArgs,
  returns: () => SourceGetReturns,
  error: () => ReadError,
});

const listCurrent = FunctionSpec.publicQuery({
  name: "listCurrent",
  args: () => ListCurrentArgs,
  returns: () => ListCurrentReturns,
  error: () => AccessError,
});

const currentGet = FunctionSpec.publicQuery({
  name: "currentGet",
  args: () => CurrentGetArgs,
  returns: () => S.NullOr(SourceGetReturns),
  error: () => ReadError,
});

const searchForActor = FunctionSpec.internalQuery({
  name: "searchForActor",
  args: () => SearchForActorArgs,
  returns: () => SearchReturns,
  error: () => AccessError,
});

const sourceGetForActor = FunctionSpec.internalQuery({
  name: "sourceGetForActor",
  args: () => SourceGetForActorArgs,
  returns: () => SourceGetReturns,
  error: () => ReadError,
});

const health = FunctionSpec.publicQuery({
  name: "health",
  args: () => HealthArgs,
  returns: () => HealthReturns,
  error: () => AccessError,
});

const healthForActor = FunctionSpec.internalQuery({
  name: "healthForActor",
  args: () => HealthForActorArgs,
  returns: () => HealthReturns,
  error: () => AccessError,
});

export default GroupSpec.make()
  .addFunction(search)
  .addFunction(sourceGet)
  .addFunction(listCurrent)
  .addFunction(currentGet)
  .addFunction(searchForActor)
  .addFunction(sourceGetForActor)
  .addFunction(health)
  .addFunction(healthForActor)
  .addFunction(beginRun)
  .addFunction(publishRunItem)
  .addFunction(completeRun)
  .addFunction(failRun)
  .addFunction(failActiveScopeRun)
  .addFunction(publishPage);
