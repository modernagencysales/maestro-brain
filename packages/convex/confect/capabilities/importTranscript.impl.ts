import { FunctionImpl, GroupImpl } from "@confect/server";
import { parseTranscriptImport } from "@maestro-template/integrations/transcripts/import";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { ValidationFailed } from "../errors";
import { requireBrainAccess } from "../brain/pages.impl";
import importTranscriptGroup from "./importTranscript.spec";
import { ingestSourceUnitEffect } from "./ingestSourceUnit.impl";
import { routeCallToBrainEffect } from "./routeCallToBrain.impl";

const withoutClock = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Clock.Clock>> =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const importTranscriptImpl = FunctionImpl.make(
  databaseSchema,
  importTranscriptGroup,
  "importTranscript",
  (input) =>
    Effect.gen(function* () {
      const access = yield* requireBrainAccess(input.brainKey, "editor");
      if (input.targetBrainKey)
        yield* requireBrainAccess(input.targetBrainKey, "editor");
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
