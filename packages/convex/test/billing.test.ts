import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import billingImpl from "../confect/ops/billing.impl";
import billing, {
  ApplyWebhookArgs,
  BillingError,
  BillingWebhookReturn,
  CheckSeatArgs,
  EntitlementReturn,
  GrantEntitlementArgs,
  RecordUsageArgs,
  SeatCheckReturn,
  UsageRecordReturn,
} from "../confect/ops/billing.spec";
import creditLedger from "../confect/tables/creditLedger";
import entitlements from "../confect/tables/entitlements";
import usageEvents from "../confect/tables/usageEvents";
import webhookEvents from "../confect/tables/webhookEvents";
import { testConfectLayer } from "./support/confect";

describe("billing Confect contracts", () => {
  it("declares entitlement, webhook, append-only ledger, and usage indexes", () => {
    expect(entitlements.indexes).toMatchObject({
      by_workspace: ["workspaceId"],
      by_workspace_feature: ["workspaceId", "featureKey"],
    });
    expect(webhookEvents.indexes).toMatchObject({
      by_provider_event: ["provider", "eventId", "signatureTimestamp"],
      by_dedupe_key: ["dedupeKey"],
      by_workspace: ["workspaceId"],
    });
    expect(creditLedger.indexes).toMatchObject({
      by_workspace: ["workspaceId"],
      by_idempotency: ["idempotencyKey"],
      by_workspace_created: ["workspaceId", "createdAt"],
      by_append_only: ["workspaceId", "appendOnly"],
    });
    expect(usageEvents.indexes).toMatchObject({
      by_workspace: ["workspaceId"],
      by_idempotency: ["idempotencyKey"],
      by_provider: ["provider"],
      by_entitlement: ["workspaceId", "entitlementKey"],
    });
  });

  it("validates usage, webhook, entitlement, and seat args with Effect schemas", () => {
    expect(
      Schema.decodeUnknownSync(RecordUsageArgs)({
        workspaceId: "workspace_123",
        idempotencyKey: "usage-001",
        provider: "openrouter",
        units: 10,
        costCredits: 2,
        entitlementKey: "llm_credits",
      }),
    ).toMatchObject({ entitlementKey: "llm_credits" });

    expect(
      Schema.decodeUnknownSync(ApplyWebhookArgs)({
        workspaceId: "workspace_123",
        provider: "dodo",
        eventId: "evt_123",
        eventType: "payment.succeeded",
        signatureTimestamp: "1700000000",
        dedupeKey: "dodo:evt_123:1700000000",
      }),
    ).toMatchObject({ dedupeKey: "dodo:evt_123:1700000000" });

    expect(
      Schema.decodeUnknownSync(GrantEntitlementArgs)({
        workspaceId: "workspace_123",
        entitlementKey: "seats",
        featureKey: "team_members",
        limit: 5,
        source: "dodo",
      }),
    ).toMatchObject({ limit: 5 });

    expect(
      Schema.decodeUnknownSync(CheckSeatArgs)({
        workspaceId: "workspace_123",
        currentSeats: 4,
        requestedSeats: 5,
        seatLimit: 5,
      }),
    ).toMatchObject({ requestedSeats: 5 });
  });

  it("declares billing return schemas for append-only ledger and idempotent webhooks", () => {
    expect(
      Schema.decodeUnknownSync(UsageRecordReturn)({
        workspaceId: "workspace_123",
        usageEventId: "usage_workspace_123_usage-001",
        ledgerEntryId: "ledger_workspace_123_usage-001",
        idempotencyKey: "usage-001",
        provider: "openrouter",
        units: 10,
        costCredits: 2,
        entitlementKey: "llm_credits",
        appendOnly: true,
        createdAt: 1,
      }),
    ).toMatchObject({ appendOnly: true });

    expect(
      Schema.decodeUnknownSync(BillingWebhookReturn)({
        workspaceId: "workspace_123",
        provider: "dodo",
        eventId: "evt_123",
        eventType: "payment.succeeded",
        signatureTimestamp: "1700000000",
        dedupeKey: "dodo:evt_123:1700000000",
        status: "processed",
        createdAt: 1,
      }),
    ).toMatchObject({ status: "processed" });

    expect(
      Schema.decodeUnknownSync(EntitlementReturn)({
        workspaceId: "workspace_123",
        entitlementKey: "seats",
        featureKey: "team_members",
        limit: 5,
        used: 0,
        source: "dodo",
        status: "active",
        createdAt: 1,
      }),
    ).toMatchObject({ status: "active" });

    expect(
      Schema.decodeUnknownSync(SeatCheckReturn)({
        workspaceId: "workspace_123",
        allowed: true,
        currentSeats: 4,
        requestedSeats: 5,
        seatLimit: 5,
      }),
    ).toMatchObject({ allowed: true });
  });

  it("declares public-safe typed billing failures", () => {
    const encoded = [
      new BillingError.DuplicateWebhook({
        dedupeKey: "dodo:evt_123:1700000000",
      }),
      new BillingError.InsufficientCredits({
        availableCredits: 1,
        requestedCredits: 2,
      }),
      new BillingError.SeatLimitExceeded({
        currentSeats: 4,
        requestedSeats: 6,
        seatLimit: 5,
      }),
      new BillingError.ValidationFailed({
        field: "idempotencyKey",
        message: "idempotencyKey is required.",
      }),
    ].map((error) => Schema.encodeSync(BillingError.Schema)(error));

    expect(encoded.map((error) => error._tag)).toEqual([
      "DuplicateWebhook",
      "InsufficientCredits",
      "SeatLimitExceeded",
      "ValidationFailed",
    ]);
    expect(JSON.stringify(encoded)).not.toContain("secret");
  });

  it("registers public Confect billing functions", () => {
    const serialized = JSON.stringify(billing);

    expect(serialized).toContain("recordUsage");
    expect(serialized).toContain("applyWebhook");
    expect(serialized).toContain("grantEntitlement");
    expect(serialized).toContain("checkSeat");
    expect(serialized).toContain("public");
  });

  it("exports a finalized fake/local Confect implementation", () => {
    expect(billingImpl).toMatchObject({
      _op_layer: "Fold",
    });
  });

  it("rejects padded usage idempotency keys before writing ledger-shaped IDs", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      return yield* confect
        .mutation(refs.public.ops.billing.recordUsage, {
          workspaceId: "workspace_123",
          idempotencyKey: " usage-001 ",
          provider: "openrouter",
          units: 10,
          costCredits: 2,
          entitlementKey: "llm_credits",
        })
        .pipe(Effect.flip);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result).toBeInstanceOf(BillingError.ValidationFailed);
    expect(result).toMatchObject({
      field: "idempotencyKey",
      message: "idempotencyKey must not have leading or trailing whitespace.",
    });
  });
});
