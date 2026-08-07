import { FunctionImpl, GroupImpl } from "@confect/server";
import { parseTranscriptImport } from "@maestro-template/integrations/transcripts/import";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import refs from "../_generated/refs";
import databaseSchema from "../_generated/schema";
import { Scheduler } from "../_generated/services";
import { ValidationFailed } from "../errors";
import { requireBrainAccess } from "../brain/pages.impl";
import { sha256Hex } from "../shared/sha256";
import importTranscriptGroup from "./importTranscript.spec";
import { ingestSourceUnitEffect } from "./ingestSourceUnit.impl";
import { routeCallToBrainEffect } from "./routeCallToBrain.impl";

const withoutClock = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Clock.Clock>> =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

export const scheduleManualTranscriptMaintenance = (
  runAfter: Scheduler["runAfter"],
  input: {
    readonly workspaceId: GenericId<"workspaces">;
    readonly proposalKey: string;
    readonly unitRevisionKey: string;
  },
) =>
  runAfter(
    Duration.zero,
    refs.internal.workflowContracts.sourceToBrainMaintenance.start,
    {
      workspaceId: input.workspaceId,
      idempotencyKey: `maintenance.${sha256Hex(
        JSON.stringify({
          proposalKey: input.proposalKey,
          unitRevisionKey: input.unitRevisionKey,
        }),
      )}`,
      unitRevisionKey: input.unitRevisionKey,
      caller: {
        kind: "system",
        name: "manual-transcript-import",
        surface: "internal",
      },
    },
  );

const importTranscriptImpl = FunctionImpl.make(
  databaseSchema,
  importTranscriptGroup,
  "importTranscript",
  (input) =>
    Effect.gen(function* () {
      const access = yield* requireBrainAccess(input.brainKey, "editor");
      const target = input.targetBrainKey
        ? yield* requireBrainAccess(input.targetBrainKey, "editor")
        : null;
      const imported = yield* Effect.try({
        try: () =>
          parseTranscriptImport({
            connectionKey: `manual_${access.organizationKey}`,
            title: input.title,
            occurredAt: input.occurredAt,
            participantEmails: input.participantEmails,
            format: input.format,
            content: input.content,
          }),
        catch: () =>
          new ValidationFailed({
            field: "content",
            message: "Transcript import could not be decoded.",
          }),
      });
      const receivedAt = yield* withoutClock(Clock.currentTimeMillis);
      const ingested = yield* ingestSourceUnitEffect({
        input: imported,
        authority: {
          kind: "manual_import",
          organizationKey: access.organizationKey,
          actorId: access.actorId,
        },
        caller: {
          kind: "system",
          name: "manual-transcript-import",
          surface: "internal",
        },
        receivedAt,
      });
      if (!input.targetBrainKey)
        return { ...ingested, routeOutcome: null, brainKey: null };
      const routed = yield* routeCallToBrainEffect({
        organizationKey: access.organizationKey,
        unitRevisionKey: ingested.unitRevisionKey,
        explicitBrainKey: input.targetBrainKey,
        agencyDomains: [],
        caller: {
          kind: "system",
          name: "manual-transcript-import",
          surface: "internal",
        },
        routedAt: receivedAt,
      });
      if (routed.outcome === "routed" && target)
        yield* scheduleManualTranscriptMaintenance(
          (yield* Scheduler).runAfter,
          {
            workspaceId: target.workspaceId,
            proposalKey: routed.proposalKey,
            unitRevisionKey: routed.unitRevisionKey,
          },
        );
      return {
        ...ingested,
        routeOutcome: routed.outcome,
        brainKey: routed.brainKey,
      };
    }),
);

export default GroupImpl.make(databaseSchema, importTranscriptGroup).pipe(
  Layer.provide(importTranscriptImpl),
  GroupImpl.finalize,
);
