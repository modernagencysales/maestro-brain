import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { GenericId } from "convex/values";

import { DatabaseReader } from "../_generated/services";
import { ValidationFailed } from "../errors";

export const reconcileHeadlessNoteRetry = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly idempotencyKey: string;
  readonly title: string;
  readonly markdown: string;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("brainSources")
      .index("by_workspace_idempotency", (query) =>
        query
          .eq("workspaceId", input.workspaceId)
          .eq("idempotencyKey", input.idempotencyKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (rows.length > 1)
      return yield* new ValidationFailed({
        field: "idempotencyKey",
        message: "Note idempotency state is inconsistent.",
      });
    const existing = Option.fromNullable(rows[0]).pipe(Option.getOrNull);
    if (existing === null) return null;
    if (existing.title !== input.title || existing.markdown !== input.markdown)
      return yield* new ValidationFailed({
        field: "idempotencyKey",
        message: "The idempotency key was already used for a different note.",
      });
    return { sourceKey: existing.sourceKey, status: existing.status };
  });
