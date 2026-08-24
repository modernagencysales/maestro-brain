import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import {
  requireWorkspaceAccess,
  requireWorkspaceActorAccess,
} from "../capabilities/_kit/workspaceAccess";
import { NotFound, ValidationFailed } from "../errors";
import {
  beginConnection,
  completeConnection,
  revokeConnection,
  type ProviderConnectionState,
  type ProviderKey,
} from "./connectionLifecycle";
import connections from "./connections.spec";

const withConfectClock = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Clock.Clock>> =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const currentConnection = (
  workspaceId: GenericId<"workspaces">,
  provider: ProviderKey,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const row = yield* reader
      .table("providerConnections")
      .index("by_workspace_and_provider", (q) =>
        q.eq("workspaceId", workspaceId).eq("provider", provider),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    return row !== null && "workspaceId" in row ? row : null;
  });

const toState = (row: {
  provider: ProviderKey;
  status: ProviderConnectionState["status"];
  generation: number;
  connectionRef?: string | undefined;
  errorCode?: string | undefined;
}): ProviderConnectionState => ({
  provider: row.provider,
  status: row.status,
  generation: row.generation,
  ...(row.connectionRef === undefined
    ? {}
    : { connectionRef: row.connectionRef }),
  ...(row.errorCode === undefined ? {} : { errorCode: row.errorCode }),
});

const transitionFailure = () =>
  new ValidationFailed({
    field: "generation",
    message: "Provider connection state changed. Refresh and try again.",
  });

const listConnectionRows = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("providerConnections")
      .index("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect()
      .pipe(Effect.orDie);
    return rows.filter((row) => "workspaceId" in row);
  });

const beginConnectionRow = (
  workspaceId: GenericId<"workspaces">,
  provider: ProviderKey,
) =>
  Effect.gen(function* () {
    const existing = yield* currentConnection(workspaceId, provider);
    const state = beginConnection(
      existing === null ? undefined : toState(existing),
      provider,
    );
    const now = yield* withConfectClock(Clock.currentTimeMillis);
    const writer = yield* DatabaseWriter;
    if (existing === null) {
      const id = yield* writer
        .table("providerConnections")
        .insert({ workspaceId, ...state, createdAt: now, updatedAt: now })
        .pipe(Effect.orDie);
      const reader = yield* DatabaseReader;
      const inserted = yield* reader
        .table("providerConnections")
        .get(id)
        .pipe(Effect.orDie);
      if (inserted !== null && "workspaceId" in inserted) return inserted;
    } else {
      yield* writer
        .table("providerConnections")
        .patch(existing._id, {
          status: state.status,
          generation: state.generation,
          connectionRef: undefined,
          errorCode: undefined,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
      const reader = yield* DatabaseReader;
      const updated = yield* reader
        .table("providerConnections")
        .get(existing._id)
        .pipe(Effect.orDie);
      if (updated !== null && "workspaceId" in updated) return updated;
    }
    return yield* new NotFound({
      resource: "providerConnections",
      id: provider,
    });
  });

const completeConnectionRow = (args: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly provider: ProviderKey;
  readonly generation: number;
  readonly completion:
    | { readonly status: "active"; readonly connectionRef: string }
    | { readonly status: "error"; readonly errorCode: string };
}) =>
  Effect.gen(function* () {
    const existing = yield* currentConnection(args.workspaceId, args.provider);
    if (existing === null) {
      return yield* new NotFound({
        resource: "providerConnections",
        id: args.provider,
      });
    }
    const current = toState(existing);
    const state = yield* Effect.try({
      try: () =>
        completeConnection(current, {
          generation: args.generation,
          ...args.completion,
        }),
      catch: () => transitionFailure(),
    });
    if (state === current) return existing;
    const now = yield* withConfectClock(Clock.currentTimeMillis);
    const writer = yield* DatabaseWriter;
    yield* writer
      .table("providerConnections")
      .patch(existing._id, {
        status: state.status,
        connectionRef: state.connectionRef,
        errorCode: state.errorCode,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const reader = yield* DatabaseReader;
    const updated = yield* reader
      .table("providerConnections")
      .get(existing._id)
      .pipe(Effect.orDie);
    return updated !== null && "workspaceId" in updated ? updated : existing;
  });

const revokeConnectionRow = (args: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly provider: ProviderKey;
  readonly generation: number;
}) =>
  Effect.gen(function* () {
    const existing = yield* currentConnection(args.workspaceId, args.provider);
    if (existing === null) {
      return yield* new NotFound({
        resource: "providerConnections",
        id: args.provider,
      });
    }
    const current = toState(existing);
    const state = yield* Effect.try({
      try: () => revokeConnection(current, args.generation),
      catch: () => transitionFailure(),
    });
    if (state === current) return existing;
    const now = yield* withConfectClock(Clock.currentTimeMillis);
    const writer = yield* DatabaseWriter;
    yield* writer
      .table("providerConnections")
      .patch(existing._id, {
        status: "revoked",
        connectionRef: undefined,
        errorCode: undefined,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const reader = yield* DatabaseReader;
    const updated = yield* reader
      .table("providerConnections")
      .get(existing._id)
      .pipe(Effect.orDie);
    return updated !== null && "workspaceId" in updated ? updated : existing;
  });

const list = FunctionImpl.make(
  databaseSchema,
  connections,
  "list",
  ({ workspaceId }) =>
    Effect.gen(function* () {
      yield* withConfectClock(requireWorkspaceAccess(workspaceId, "viewer"));
      return yield* listConnectionRows(workspaceId);
    }),
);

const begin = FunctionImpl.make(
  databaseSchema,
  connections,
  "begin",
  ({ workspaceId, provider }) =>
    Effect.gen(function* () {
      yield* withConfectClock(requireWorkspaceAccess(workspaceId, "editor"));
      return yield* beginConnectionRow(workspaceId, provider);
    }),
);

const complete = FunctionImpl.make(
  databaseSchema,
  connections,
  "complete",
  (args) =>
    Effect.gen(function* () {
      yield* withConfectClock(
        requireWorkspaceAccess(args.workspaceId, "editor"),
      );
      return yield* completeConnectionRow(args);
    }),
);

const revoke = FunctionImpl.make(
  databaseSchema,
  connections,
  "revoke",
  ({ workspaceId, provider, generation }) =>
    Effect.gen(function* () {
      yield* withConfectClock(requireWorkspaceAccess(workspaceId, "editor"));
      return yield* revokeConnectionRow({ workspaceId, provider, generation });
    }),
);

const listForActor = FunctionImpl.make(
  databaseSchema,
  connections,
  "listForActor",
  ({ workspaceId, userId }) =>
    Effect.gen(function* () {
      yield* withConfectClock(
        requireWorkspaceActorAccess(workspaceId, userId, "viewer"),
      );
      return yield* listConnectionRows(workspaceId);
    }),
);

const beginForActor = FunctionImpl.make(
  databaseSchema,
  connections,
  "beginForActor",
  ({ workspaceId, userId, provider }) =>
    Effect.gen(function* () {
      yield* withConfectClock(
        requireWorkspaceActorAccess(workspaceId, userId, "editor"),
      );
      return yield* beginConnectionRow(workspaceId, provider);
    }),
);

const completeForActor = FunctionImpl.make(
  databaseSchema,
  connections,
  "completeForActor",
  ({ userId, ...args }) =>
    Effect.gen(function* () {
      yield* withConfectClock(
        requireWorkspaceActorAccess(args.workspaceId, userId, "editor"),
      );
      return yield* completeConnectionRow(args);
    }),
);

const revokeForActor = FunctionImpl.make(
  databaseSchema,
  connections,
  "revokeForActor",
  ({ workspaceId, userId, provider, generation }) =>
    Effect.gen(function* () {
      yield* withConfectClock(
        requireWorkspaceActorAccess(workspaceId, userId, "editor"),
      );
      return yield* revokeConnectionRow({ workspaceId, provider, generation });
    }),
);

export default GroupImpl.make(databaseSchema, connections).pipe(
  Layer.provide(list),
  Layer.provide(begin),
  Layer.provide(complete),
  Layer.provide(revoke),
  Layer.provide(listForActor),
  Layer.provide(beginForActor),
  Layer.provide(completeForActor),
  Layer.provide(revokeForActor),
  GroupImpl.finalize,
);
