import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import { validateCallerIdempotencyKey } from "../shared/idempotencyKey";
import billing, { BillingError } from "./billing.spec";

const now = 1_700_000_000_000;

const recordUsage = FunctionImpl.make(
  databaseSchema,
  billing,
  "recordUsage",
  (input) => {
    const idempotencyKey = validateCallerIdempotencyKey(input.idempotencyKey);

    if (!idempotencyKey.ok) {
      return Effect.fail(
        new BillingError.ValidationFailed({
          field: "idempotencyKey",
          message: idempotencyKey.error.message,
        }),
      );
    }

    return Effect.succeed({
      workspaceId: input.workspaceId,
      usageEventId: `usage_${input.workspaceId}_${idempotencyKey.value}`,
      ledgerEntryId: `ledger_${input.workspaceId}_${idempotencyKey.value}`,
      idempotencyKey: idempotencyKey.value,
      provider: input.provider,
      units: input.units,
      costCredits: input.costCredits,
      entitlementKey: input.entitlementKey,
      appendOnly: true as const,
      createdAt: now,
    });
  },
);

const applyWebhook = FunctionImpl.make(
  databaseSchema,
  billing,
  "applyWebhook",
  (input) =>
    Effect.succeed({
      workspaceId: input.workspaceId,
      provider: input.provider,
      eventId: input.eventId,
      eventType: input.eventType,
      signatureTimestamp: input.signatureTimestamp,
      dedupeKey: input.dedupeKey,
      status: "processed" as const,
      createdAt: now,
    }),
);

const grantEntitlement = FunctionImpl.make(
  databaseSchema,
  billing,
  "grantEntitlement",
  (input) =>
    Effect.succeed({
      workspaceId: input.workspaceId,
      entitlementKey: input.entitlementKey,
      featureKey: input.featureKey,
      limit: input.limit,
      used: 0,
      source: input.source,
      status: "active" as const,
      createdAt: now,
    }),
);

const checkSeat = FunctionImpl.make(
  databaseSchema,
  billing,
  "checkSeat",
  (input) =>
    Effect.succeed({
      workspaceId: input.workspaceId,
      allowed: input.requestedSeats <= input.seatLimit,
      currentSeats: input.currentSeats,
      requestedSeats: input.requestedSeats,
      seatLimit: input.seatLimit,
    }),
);

export default GroupImpl.make(databaseSchema, billing).pipe(
  Layer.provide(recordUsage),
  Layer.provide(applyWebhook),
  Layer.provide(grantEntitlement),
  Layer.provide(checkSeat),
  GroupImpl.finalize,
);
