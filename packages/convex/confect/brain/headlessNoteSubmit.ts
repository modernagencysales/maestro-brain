import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { Forbidden, ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import { reconcileHeadlessNoteRetry } from "./headlessNoteRetry";
import { requireHeadlessBrainAccess } from "./pages.impl";

type HeadlessNoteArgs = {
  readonly brainKey: string;
  readonly title: string;
  readonly markdown: string;
  readonly organizationId: GenericId<"organizations">;
  readonly workspaceId: GenericId<"workspaces">;
  readonly idempotencyKey: string;
};

const unsafeAssumeClockProvided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const sourceKeyFor = (brainKey: string, idempotencyKey: string): string =>
  `src_${sha256Hex(JSON.stringify({ brainKey, idempotencyKey }))}`;

const invalidNote = (title: string, markdown: string) => {
  if (title.length === 0)
    return new ValidationFailed({
      field: "title",
      message: "title is required.",
    });
  return markdown.length === 0
    ? new ValidationFailed({
        field: "markdown",
        message: "markdown is required.",
      })
    : null;
};

export const headlessNoteSubmitEffect = (
  args: HeadlessNoteArgs,
): Effect.Effect<
  {
    readonly sourceKey: string;
    readonly status: "pending_review" | "published" | "rejected";
  },
  Forbidden | ValidationFailed,
  DatabaseReader | DatabaseWriter
> =>
  Effect.gen(function* () {
    const title = args.title.trim();
    const markdown = args.markdown.trim();
    const invalid = invalidNote(title, markdown);
    if (invalid !== null) return yield* invalid;
    const brain = yield* requireHeadlessBrainAccess(args);
    const existing = yield* reconcileHeadlessNoteRetry({
      workspaceId: brain.workspaceId,
      idempotencyKey: args.idempotencyKey,
      title,
      markdown,
    });
    if (existing !== null) return existing;
    const submittedAt = yield* unsafeAssumeClockProvided(
      Clock.currentTimeMillis,
    );
    const sourceKey = sourceKeyFor(brain.brainKey, args.idempotencyKey);
    const writer = yield* DatabaseWriter;
    yield* writer
      .table("brainSources")
      .insert({
        workspaceId: brain.workspaceId,
        organizationId: brain.organizationId,
        sourceKey,
        title,
        markdown,
        status: "pending_review",
        idempotencyKey: args.idempotencyKey,
        submittedAt,
        schemaVersion: 1,
      })
      .pipe(Effect.orDie);
    return { sourceKey, status: "pending_review" as const };
  });
