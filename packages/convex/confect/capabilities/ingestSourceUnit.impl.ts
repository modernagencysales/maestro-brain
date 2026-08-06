import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { Unauthorized, ValidationFailed } from "../errors";
import { buildCallSourceUnitRows } from "../sources/sourceUnit";
import {
  planSourceUnitIngestion,
  requireSourceIngestionCaller,
} from "./ingestSourceUnit.domain";
import ingestSourceUnitGroup, {
  ConnectionRevoked,
  DuplicateKeyConflict,
  TenantMismatch,
} from "./ingestSourceUnit.spec";

const ingestSourceUnitImpl = FunctionImpl.make(
  databaseSchema,
  ingestSourceUnitGroup,
  "ingestSourceUnit",
  ({ input, authority, caller, receivedAt }) =>
    Effect.gen(function* () {
      yield* Effect.try({
        try: () => requireSourceIngestionCaller(caller),
        catch: () => new Unauthorized(),
      });

      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      let connectionGeneration = 1;
      if (authority.kind === "provider") {
        if (authority.connectionKey !== input.connectionKey)
          return yield* Effect.fail(
            new TenantMismatch({ connectionKey: authority.connectionKey }),
          );
        const connection = yield* reader
          .table("providerConnections")
          .index("by_connection_key", (query) =>
            query.eq("connectionKey", authority.connectionKey),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie);
        if (
          connection !== null &&
          connection.organizationKey !== authority.organizationKey
        )
          return yield* Effect.fail(
            new TenantMismatch({ connectionKey: authority.connectionKey }),
          );
        if (
          connection === null ||
          connection.connectionGeneration !== authority.connectionGeneration ||
          connection.status !== "active"
        )
          return yield* Effect.fail(
            new ConnectionRevoked({ connectionKey: authority.connectionKey }),
          );
        connectionGeneration = authority.connectionGeneration;
      } else if (input.providerKey !== "manual-transcript") {
        return yield* Effect.fail(
          new TenantMismatch({ connectionKey: input.connectionKey }),
        );
      }

      const rows = yield* Effect.try({
        try: () =>
          buildCallSourceUnitRows(input, {
            organizationKey: authority.organizationKey,
            connectionGeneration,
            receivedAt,
          }),
        catch: () =>
          new ValidationFailed({
            field: "input",
            message: "Transcript payload is invalid.",
          }),
      });
      const current = yield* reader
        .table("sourceUnits")
        .index("by_unit_key", (query) =>
          query
            .eq("organizationKey", authority.organizationKey)
            .eq("unitKey", rows.unit.unitKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const knownRevision = yield* reader
        .table("sourceUnitRevisions")
        .index("by_unit_revision_key", (query) =>
          query
            .eq("organizationKey", authority.organizationKey)
            .eq("unitRevisionKey", rows.revision.unitRevisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        knownRevision !== null &&
        (knownRevision.contentHash !== rows.revision.contentHash ||
          knownRevision.tombstone !== rows.revision.tombstone)
      )
        return yield* Effect.fail(
          new DuplicateKeyConflict({ key: rows.revision.unitRevisionKey }),
        );
      if (
        current?.currentUnitRevisionKey === rows.revision.unitRevisionKey &&
        knownRevision === null
      )
        return yield* Effect.fail(
          new DuplicateKeyConflict({ key: rows.revision.unitRevisionKey }),
        );

      const plan = planSourceUnitIngestion({
        currentUnitRevisionKey: current?.currentUnitRevisionKey ?? null,
        incomingUnitRevisionKey: rows.revision.unitRevisionKey,
        incomingDeleted: rows.revision.tombstone,
        revisionAlreadyExists: knownRevision !== null,
      });
      if (plan.outcome === "duplicate")
        return {
          outcome: plan.outcome,
          unitKey: rows.unit.unitKey,
          unitRevisionKey: rows.revision.unitRevisionKey,
          segmentCount: rows.segments.length,
        };

      const lifecycleGeneration = (current?.lifecycle.generation ?? 0) + 1;
      yield* writer
        .table("sourceUnitRevisions")
        .insert(rows.revision)
        .pipe(Effect.orDie);
      for (const segment of rows.segments)
        yield* writer
          .table("sourceSegments")
          .insert(segment)
          .pipe(Effect.orDie);
      const unit = {
        ...rows.unit,
        createdAt: current?.createdAt ?? rows.unit.createdAt,
        lifecycle: { ...rows.unit.lifecycle, generation: lifecycleGeneration },
      };
      if (current === null)
        yield* writer.table("sourceUnits").insert(unit).pipe(Effect.orDie);
      else
        yield* writer
          .table("sourceUnits")
          .patch(current._id, unit)
          .pipe(Effect.orDie);

      const effectKey = `source-unit-ingest:${rows.revision.unitRevisionKey}`;
      yield* writer
        .table("sourceProcessingJobs")
        .insert({
          schemaVersion: 1,
          organizationKey: authority.organizationKey,
          unitKey: rows.unit.unitKey,
          stage: "assembled",
          executionStatus: "queued",
          effectKey,
          idempotencyKey: effectKey,
          organizationUnitIdempotencyKey: rows.revision.unitRevisionKey,
          // ponytail: initial epoch; routing replaces this with tenant policy.
          policyGeneration: 1,
          routeGeneration: 0,
          lifecycleGeneration,
          emergencyGeneration: 0,
          leaseGeneration: 0,
          attempt: 0,
          maxAttempts: 3,
          nextRetryAt: receivedAt,
          attemptReceipts: [],
          createdAt: receivedAt,
          updatedAt: receivedAt,
        })
        .pipe(Effect.orDie);

      return {
        outcome: plan.outcome,
        unitKey: rows.unit.unitKey,
        unitRevisionKey: rows.revision.unitRevisionKey,
        segmentCount: rows.segments.length,
      };
    }),
);

export default GroupImpl.make(databaseSchema, ingestSourceUnitGroup).pipe(
  Layer.provide(ingestSourceUnitImpl),
  GroupImpl.finalize,
);
